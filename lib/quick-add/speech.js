// Quick-add: deterministic readers for speech-recogniser output (2026-10-14).
//
// The phone's recogniser writes some numbers as words ("two hundred and ten", "fifty three
// hundred") and fuses others into digit runs ("king 75", "1087 all clubs"). The parse model
// reads the transcript itself; these helpers do the parts that are pure arithmetic, so they
// can be checked and need no model:
//   numberWords(text)      every number-word phrase that is certainly a number, as digits
//   spokenAmount(text)     a whole answer that is one amount ("twelve hundred", "35 grand")
//   splitRankRun("1087")   a fused run of card ranks, as ranks ("T87")
//   spokenCards(text)      a whole answer that names cards ("ace king of spades" → "AsKs")
// Rank words are never numbers here: "jack ten nine" stays cards, and a lone "five" or "ten"
// is never rewritten. Only phrases with a scale (hundred, thousand, k, grand, million), a
// tens word (twenty … ninety) or a teen (eleven … nineteen) are numbers.
'use strict';

const { parseAmount, parseStakes } = require('./cards');

const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { thousand: 1e3, k: 1e3, grand: 1e3, million: 1e6, mil: 1e6 };

const isUnit = (w) => w in UNITS;
const isTeen = (w) => w in TEENS;
const isTens = (w) => w in TENS;
const isScale = (w) => w in SCALES;

/* Words that follow a number word without being part of the number: "twenty six handed"
   is twenty and a six-handed table, not 26. */
const TABLE_WORD = new Set(['handed', 'max', 'way', 'ways', 'player', 'players']);

/* A number of 1..99 starting at tok[k]: "twenty five", "nineteen", "seven". `kind` is
   tens | teen | ten | unit; for "twenty one" `unit` is the unit word ("one"). */
function readSmall(tok, k) {
  const w = tok[k];
  if (isTens(w)) {
    const u = tok[k + 1];
    if (isUnit(u) && u !== 'zero' && !TABLE_WORD.has(tok[k + 2])) return { v: TENS[w] + UNITS[u], n: 2, kind: 'tens', unit: u };
    return { v: TENS[w], n: 1, kind: 'tens', unit: null };
  }
  if (isTeen(w)) return { v: TEENS[w], n: 1, kind: w === 'ten' ? 'ten' : 'teen', unit: null };
  if (isUnit(w) && w !== 'zero') return { v: UNITS[w], n: 1, kind: 'unit', unit: null };
  return null;
}

/* One number phrase starting at tokens[i], or null. Returns { value, end, strong, alt }
   where strong says the phrase is certainly a number (it has a scale, a tens word or a
   teen above ten) rather than a rank word, and alt, when set, is { numbers: [...] }: the
   same words read as two numbers ("fifty one hundred" is 5,100 or the stakes 50/100).
   The phrase stops where a second number begins (2026-10-14, review): a hundreds
   group is followed by no second "hundred" ("two hundred four hundred" is two numbers),
   a scale is never repeated at the same size or larger ("one thousand two thousand",
   "twenty thousand forty thousand"), and a unit or teen between a hundreds part and a
   bigger scale is the next number's ("five hundred one thousand" is 500 and 1,000, where
   "two hundred fifty thousand" is one number). opts.bareUnits lets a lone unit word
   start a phrase, for answers that are known to be a list of numbers (stakes).
   opts.afterNumber says another number phrase ended right before this one. */
function readPhrase(tok, i, opts = {}) {
  let k = i;
  let total = 0, group = 0, strong = false, any = false;
  let lastBig = Infinity; // the biggest scale already applied to `total`
  let groupStart = i;     // where the unflushed group began
  let trail = null;       // a small number added after a hundreds part
  let lastSmall = null;
  let alt = null;
  const peek = (d = 0) => tok[k + d];
  const skipAnd = () => { if (peek() === 'and') k++; };
  // A leading "a" counts as one only before a scale: "a hundred", "a thousand".
  if (peek() === 'a' && (peek(1) === 'hundred' || isScale(peek(1)))) { group = 1; k++; any = true; }
  for (;;) {
    const w = peek();
    if (w == null) break;
    if (w === 'hundred') {
      if (any && group > 0 && group < 100 && Number.isInteger(group) && !trail) {
        // "fifty one hundred": 5,100 as an amount, 50 and 100 as stakes.
        if (total === 0 && lastSmall && lastSmall.kind === 'tens' && lastSmall.unit === 'one') alt = { numbers: [lastSmall.v - 1, 100] };
        group *= 100; strong = true; k++; skipAnd();
        lastSmall = null;
        continue;
      }
      // "two hundred four hundred": the "four" begins the next number.
      if (trail) { k = trail.start; group -= trail.v; trail = null; }
      break;
    }
    if (w === 'point' && any && /^(zero|one|two|three|four|five|six|seven|eight|nine)$/.test(peek(1) || '')) {
      // "two point five k": a decimal is only meaningful before a scale.
      const frac = UNITS[peek(1)] / 10;
      if (!isScale(peek(2))) break;
      group += frac; k += 2;
      continue;
    }
    if (w === 'and' && any && peek(1) === 'a' && peek(2) === 'half' && isScale(peek(3))) {
      group += 0.5; k += 3; // "two and a half k"
      continue;
    }
    if (isScale(w)) {
      if (!any) break;
      const S = SCALES[w];
      if (S >= lastBig) { k = groupStart; group = 0; trail = null; break; } // the group is the next number's
      if (group >= 1000) break; // "fifteen hundred thousand" is nothing we read
      total += (group || 1) * S; group = 0; strong = true; lastBig = S; k++;
      skipAnd();
      groupStart = k; trail = null; lastSmall = null;
      continue;
    }
    const s = readSmall(tok, k);
    if (!s || group % 100 !== 0 || !Number.isInteger(group)) break;
    const nxt = tok[k + s.n];
    if (group === 0) {
      // A unit alone is a rank word unless a scale follows ("five hundred", "two k").
      const andAHalf = nxt === 'and' && tok[k + s.n + 1] === 'a' && tok[k + s.n + 2] === 'half' && isScale(tok[k + s.n + 3]);
      if (!any && s.kind === 'unit' && !(opts.bareUnits || nxt === 'hundred' || isScale(nxt) || nxt === 'point' || andAHalf)) break;
      if (isScale(nxt) && SCALES[nxt] >= lastBig) break; // "one thousand two thousand"
      groupStart = k;
      group = s.v; lastSmall = s; any = true; k += s.n;
      if (s.kind === 'tens' || s.kind === 'teen') strong = true;
      continue;
    }
    // Something follows a hundreds part: "two hundred ten", "five hundred fifty thousand".
    if (nxt === 'hundred' || TABLE_WORD.has(nxt)) break;
    // Straight after another number ("one hundred two hundred twenty five ante"), a
    // trailing small number is the next number's, not this one's.
    if (opts.afterNumber) break;
    if (isScale(nxt) && (group >= 1000 || s.v < 20)) break;
    trail = { start: k, v: s.v };
    group += s.v; lastSmall = s; k += s.n;
    if (s.kind === 'tens' || s.kind === 'teen') strong = true;
  }
  if (!any || k === i) return null;
  // Drop a trailing "and" the loop may have taken.
  while (k > i && tok[k - 1] === 'and') k--;
  return { value: Math.round((total + group) * 100) / 100, end: k, strong, alt };
}

const WORD_RE = /[a-z]+|\d+(?:\.\d+)?|[^\sa-z\d]+|\s+/gi;

/* Every phrase in the text that is certainly a number, rewritten as digits.
   Returns { text, conversions: [{ from, to }] }. "one fifty" (150 or 1.50) and other
   unit-then-tens idioms are left alone: they are not certain. */
function numberWords(input) {
  const text = String(input == null ? '' : input);
  const parts = text.match(WORD_RE) || [];
  // Indices of word parts, lower-cased, with hyphens split ("twenty-five").
  const words = [];
  parts.forEach((p, idx) => { if (/^[a-z]+$/i.test(p)) words.push({ w: p.toLowerCase(), idx }); });
  const conversions = [];
  const replace = new Map(); // part index → replacement (or '' to drop)
  let lastEnd = -1; // word index where the previous number phrase ended
  for (let j = 0; j < words.length;) {
    // Phrases only run over consecutive words separated by spaces or hyphens.
    let end = j;
    while (end + 1 < words.length && /^[\s-]+$/.test(parts.slice(words[end].idx + 1, words[end + 1].idx).join('') || ' ')
      && words[end + 1].idx - words[end].idx === 2) end++;
    const tok = words.slice(j, end + 1).map((x) => x.w);
    const r = readPhrase(tok, 0, { afterNumber: lastEnd === j });
    if (r) lastEnd = j + r.end;
    const prev = j > 0 ? words[j - 1].w : null;
    const idiom = r && (isUnit(prev) || isTeen(prev)) && isTens(tok[0]) && words[j].idx - words[j - 1].idx === 2;
    if (r && r.alt) {
      j += r.end; // "fifty one hundred" might be the stakes 50/100: not certain, left to the model
    } else if (r && r.end === 1 && (isUnit(tok[0]) || isTeen(tok[0])) && isTens(tok[1])) {
      j += 1; // "fifteen thirty": two numbers or one idiom, so neither is rewritten
    } else if (r && r.strong && !idiom) {
      const first = words[j].idx, last = words[j + r.end - 1].idx;
      conversions.push({ from: parts.slice(first, last + 1).join(''), to: r.value });
      replace.set(first, String(r.value));
      for (let q = first + 1; q <= last; q++) replace.set(q, '');
      j += r.end;
    } else {
      j += 1;
    }
  }
  const out = parts.map((p, idx) => (replace.has(idx) ? replace.get(idx) : p)).join('');
  return { text: out, conversions };
}

/* A whole answer that is one amount: "twelve hundred", "two hundred and ten dollars",
   "35 grand", "1.2k", "a hundred and twenty k", "15 hundred", "500 eff", "a buck fifty",
   "two and a half k". null otherwise.
   opts.strict is for an answer where two numbers are as likely as one (the blinds): a
   phrase that might be two numbers ("fifty one hundred") and the "one fifty" idiom are
   not read. */
function spokenAmount(input, opts = {}) {
  if (input == null) return null;
  const s = String(input).toLowerCase().trim()
    .replace(/[.!]+$/, '')
    .replace(/\s+(?:dollars?|bucks|chips|euros?|pounds?|quid)$/, '')
    .replace(/\s+(?:eff(?:ective)?(?:\s+stack)?|deep|behind|back)$/, '')
    .replace(/^(?:it was|about|around|like|roughly|maybe)\s+/, '');
  const direct = parseAmount(s);
  if (direct != null) return direct;
  const hun = /^(\d+(?:\.\d+)?)\s*hundred$/.exec(s);
  if (hun) return Math.round(Number(hun[1]) * 100 * 100) / 100;
  const toks = s.split(/[\s-]+/).filter(Boolean);
  // "a buck fifty" is a dollar fifty: 1.5.
  const buck = /^(?:a|one)\s+(?:buck|dollar)(?:\s+and)?\s+([a-z\s-]+)$/.exec(s);
  if (buck) {
    const c = readSmall(buck[1].split(/[\s-]+/).filter(Boolean), 0);
    if (c && c.n === buck[1].split(/[\s-]+/).filter(Boolean).length) return 1 + c.v / 100;
  }
  // A lone unit word is an amount when it is the whole answer ("five").
  if (toks.length === 1 && (isUnit(toks[0]) || isTeen(toks[0]) || isTens(toks[0]))) {
    return UNITS[toks[0]] ?? TEENS[toks[0]] ?? TENS[toks[0]];
  }
  const r = readPhrase(toks, 0);
  if (r && r.end === toks.length && !(r.alt && opts.strict)) return r.value;
  // "one fifty" as a whole answer is 150 (prompt convention: "one fifty" usually 150).
  // Only a unit then a tens word: "ten twenty" is two numbers, not 1,020.
  if (!opts.strict && toks.length === 2 && isUnit(toks[0]) && toks[0] !== 'zero' && isTens(toks[1])) {
    return UNITS[toks[0]] * 100 + TENS[toks[1]];
  }
  return null;
}

/* Stakes said aloud: "ten twenty", "fifty one hundred", "five hundred one thousand",
   "one and two", "6/12k". Returns { sb, bb, rest, numbers } like parseStakes, or null
   when the answer is not two to five numbers in rising order. Only for an answer known
   to be stakes: a bare "one two" is not a hand-text reading, it is 1/2 here. */
const STAKES_NOISE = new Set(['the', 'blind', 'blinds', 'stake', 'stakes', 'are', 'were', 'is', 'was', 'its', 'it', 'at', 'nl', 'nlh', 'plo',
  'game', 'dollar', 'dollars', 'buck', 'bucks', 'chips', 'and', 'to', 'over', 'by', 'slash', 'no', 'limit', 'pot', 'it\'s']);
function spokenStakes(input) {
  if (input == null) return null;
  const s = String(input).toLowerCase().replace(/[$€£]/g, '').replace(/[.!?,;]+/g, ' ').trim();
  if (!s) return null;
  const ps = parseStakes(s);
  if (ps) return ps;
  const toks = s.split(/[\s-]+/).filter((t) => t && !STAKES_NOISE.has(t));
  if (!toks.length) return null;
  const items = [];
  for (let k = 0; k < toks.length;) {
    const t = toks[k];
    const d = /^(\d+(?:\.\d+)?)(k?)$/.exec(t);
    if (d) { items.push({ value: Number(d[1]) * (d[2] ? 1e3 : 1) }); k++; continue; }
    const r = readPhrase(toks, k, { bareUnits: true, afterNumber: items.length > 0 });
    if (!r) return null;
    items.push(r);
    k = r.end;
  }
  // "fifty one hundred" alone is 50 and 100 when two numbers are what an answer needs.
  if (items.length === 1 && items[0].alt) return stakesResult(items[0].alt.numbers);
  return stakesResult(items.map((x) => x.value));
}
function stakesResult(numbers) {
  if (numbers.length < 2 || numbers.length > 5 || numbers.some((x) => !(x > 0))) return null;
  if (numbers[0] > numbers[1]) return null;
  return { sb: numbers[0], bb: numbers[1], rest: numbers.slice(2), numbers };
}

/* A fused run of ranks as the recogniser writes it: "1087" → "T87", "109" → "T9",
   "910" → "9T", "2359" → "2359". A 1 that does not start a 10 is not a rank: null. */
function splitRankRun(digits) {
  const s = String(digits == null ? '' : digits);
  if (!/^\d+$/.test(s)) return null;
  let out = '';
  for (let i = 0; i < s.length;) {
    if (s[i] === '1' && s[i + 1] === '0') { out += 'T'; i += 2; continue; }
    if (s[i] >= '2' && s[i] <= '9') { out += s[i]; i += 1; continue; }
    return null;
  }
  return out;
}

const RANK_WORDS = {
  ace: 'A', aces: 'A', king: 'K', kings: 'K', queen: 'Q', queens: 'Q', jack: 'J', jacks: 'J',
  ten: 'T', tens: 'T', nine: '9', nines: '9', eight: '8', eights: '8', seven: '7', sevens: '7',
  six: '6', sixes: '6', five: '5', fives: '5', four: '4', fours: '4', three: '3', threes: '3',
  trey: '3', treys: '3', tray: '3', two: '2', twos: '2', deuce: '2', deuces: '2',
  // Recogniser spellings from the collected transcripts.
  deed: '2', goose: '2', zeus: '2', duce: '2', coin: 'Q', jackie: 'J', kay: 'K', queue: 'Q', cue: 'Q', jay: 'J',
};
const SUIT_WORDS = { spade: 's', spades: 's', space: 's', heart: 'h', hearts: 'h', harts: 'h', diamond: 'd', diamonds: 'd', club: 'c', clubs: 'c' };
const PLURALS = new Set(['aces', 'kings', 'queens', 'jacks', 'tens', 'nines', 'eights', 'sevens', 'sixes', 'fives', 'fours', 'threes', 'treys', 'twos', 'deuces']);
const FILLER = new Set(['and', 'with', 'a', 'an', 'the', 'i', 'had', 'have', 'held', 'it', 'was', 'of', 'pocket', 'pair', 'my', 'he', 'she', 'they', 'showed', 'shows', 'is', 'in', 'hand', 'cards', 'card', 'board', 'flop', 'turn', 'river', 'x']);

/* A whole answer that names cards, as notation: "ace king of spades" → "AsKs", "ace of
   spades king of hearts" → "AsKh", "pocket nines" → "99", "king queen suited" → "KQs",
   "1087" → "T87", "jack ten of diamonds" → "JdTd". "Of <suit>" after two or more ranks
   with no suit yet gives them all that suit ("ace king of spades"). null when a word is
   not a card word. */
function spokenCards(input) {
  if (input == null) return null;
  const toks = String(input).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
  if (!toks.length) return null;
  const cards = []; // { r, s }
  let pendingFrom = 0; // first card not yet given a suit by an "of <suit>" group
  let suited = null;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (/^\d+$/.test(w)) {
      const run = splitRankRun(w);
      if (!run) return null;
      for (const r of run) cards.push({ r, s: 'x' });
      continue;
    }
    if (w in RANK_WORDS) {
      const r = RANK_WORDS[w];
      cards.push({ r, s: 'x' });
      // "pocket nines", "nines": a plural rank is a pair.
      if (PLURALS.has(w)) cards.push({ r, s: 'x' });
      continue;
    }
    if (w === 'of' && toks[i + 1] in SUIT_WORDS) {
      const su = SUIT_WORDS[toks[i + 1]];
      for (let k = pendingFrom; k < cards.length; k++) if (cards[k].s === 'x') cards[k].s = su;
      pendingFrom = cards.length;
      i++;
      continue;
    }
    if (w in SUIT_WORDS && cards.length) {
      // "ace spades": a suit word straight after a rank.
      const last = cards[cards.length - 1];
      if (last.s === 'x') last.s = SUIT_WORDS[w];
      pendingFrom = cards.length;
      continue;
    }
    if (w === 'suited' || w === 'suit' || w === 'sooted') { suited = 's'; continue; }
    if (w === 'offsuit' || w === 'off' || w === 'offsuited' || w === 'offuit' || w === 'offit') { suited = 'o'; continue; }
    if (FILLER.has(w)) continue;
    return null;
  }
  if (!cards.length) return null;
  // The same card twice is not a hand ("ace king with the ace of spades").
  const known = cards.filter((c) => c.s !== 'x').map((c) => c.r + c.s);
  if (new Set(known).size !== known.length) return null;
  const allUnknown = cards.every((c) => c.s === 'x');
  if (allUnknown) return cards.map((c) => c.r).join('') + (suited && cards.length === 2 ? suited : '');
  return cards.map((c) => c.r + c.s).join('');
}

module.exports = { numberWords, spokenAmount, spokenStakes, splitRankRun, spokenCards, _readPhrase: readPhrase };
