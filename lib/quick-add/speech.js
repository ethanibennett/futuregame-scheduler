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

const { parseAmount } = require('./cards');

const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { thousand: 1e3, k: 1e3, grand: 1e3, million: 1e6, mil: 1e6 };

const isUnit = (w) => w in UNITS;
const isTeen = (w) => w in TEENS;
const isTens = (w) => w in TENS;
const isScale = (w) => w in SCALES;

/* One number phrase starting at tokens[i], or null. Returns { value, end, strong } where
   strong says the phrase is certainly a number (it has a scale, a tens word or a teen
   above ten) rather than a rank word. */
function readPhrase(tok, i) {
  let k = i;
  let total = 0, group = 0, strong = false, any = false;
  const peek = (d = 0) => tok[k + d];
  // A leading "a" counts as one only before a scale: "a hundred", "a thousand".
  if (peek() === 'a' && (peek(1) === 'hundred' || isScale(peek(1)))) { group = 1; k++; any = true; }
  for (;;) {
    const w = peek();
    if (w == null) break;
    if (w === 'hundred' && any && group > 0 && group < 100 && Number.isInteger(group)) {
      group *= 100; strong = true; k++;
      if (peek() === 'and') k++;
      continue;
    }
    if (isTens(w) && group % 100 === 0) {
      group += TENS[w]; strong = true; any = true; k++;
      if (isUnit(peek()) && peek() !== 'zero') { group += UNITS[peek()]; k++; }
      if (peek() === 'hundred' && group < 100) { group *= 100; k++; if (peek() === 'and') k++; continue; }
      continue;
    }
    if (isTeen(w) && group % 100 === 0) {
      group += TEENS[w]; any = true; if (w !== 'ten') strong = true; k++;
      if (peek() === 'hundred' && group < 100) { group *= 100; strong = true; k++; if (peek() === 'and') k++; }
      continue;
    }
    if (isUnit(w) && group % 100 === 0 && (group % 10 === 0)) {
      // A unit alone is a rank word unless a scale follows ("five hundred", "two k").
      const next = peek(1);
      if (!any && !(next === 'hundred' || isScale(next) || next === 'point')) break;
      group += UNITS[w]; any = true; k++;
      if (peek() === 'hundred' && group < 10) { group *= 100; strong = true; k++; if (peek() === 'and') k++; }
      continue;
    }
    if (w === 'point' && any && /^(zero|one|two|three|four|five|six|seven|eight|nine)$/.test(peek(1) || '')) {
      // "two point five k": a decimal is only meaningful before a scale.
      const frac = UNITS[peek(1)] / 10;
      if (!isScale(peek(2))) break;
      group += frac; k += 2;
      continue;
    }
    if (isScale(w) && any) {
      total += (group || 1) * SCALES[w]; group = 0; strong = true; k++;
      if (peek() === 'and') k++;
      continue;
    }
    break;
  }
  if (!any || k === i) return null;
  // Drop a trailing "and" the loop may have taken.
  while (k > i && tok[k - 1] === 'and') k--;
  return { value: Math.round((total + group) * 100) / 100, end: k, strong };
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
  for (let j = 0; j < words.length;) {
    // Phrases only run over consecutive words separated by spaces or hyphens.
    let end = j;
    while (end + 1 < words.length && /^[\s-]+$/.test(parts.slice(words[end].idx + 1, words[end + 1].idx).join('') || ' ')
      && words[end + 1].idx - words[end].idx === 2) end++;
    const tok = words.slice(j, end + 1).map((x) => x.w);
    const r = readPhrase(tok, 0);
    const prev = j > 0 ? words[j - 1].w : null;
    const idiom = r && (isUnit(prev) || isTeen(prev)) && isTens(tok[0]) && words[j].idx - words[j - 1].idx === 2;
    if (r && r.strong && !idiom) {
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
   "35 grand", "1.2k", "a hundred and twenty k". null otherwise. */
function spokenAmount(input) {
  if (input == null) return null;
  let s = String(input).toLowerCase().trim()
    .replace(/[.!]+$/, '')
    .replace(/\s+(?:dollars?|bucks|chips|euros?|pounds?|quid)$/, '')
    .replace(/^(?:it was|about|around|like|roughly|maybe)\s+/, '');
  const direct = parseAmount(s);
  if (direct != null) return direct;
  const toks = s.split(/[\s-]+/).filter(Boolean);
  // A lone unit word is an amount when it is the whole answer ("five").
  if (toks.length === 1 && (isUnit(toks[0]) || isTeen(toks[0]) || isTens(toks[0]))) {
    return UNITS[toks[0]] ?? TEENS[toks[0]] ?? TENS[toks[0]];
  }
  const r = readPhrase(toks, 0);
  if (r && r.end === toks.length) return r.value;
  // "one fifty" as a whole answer is 150 (prompt convention: "one fifty" usually 150).
  if (toks.length === 2 && (isUnit(toks[0]) || isTeen(toks[0])) && isTens(toks[1])) {
    return (UNITS[toks[0]] ?? TEENS[toks[0]]) * 100 + TENS[toks[1]];
  }
  return null;
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
  const allUnknown = cards.every((c) => c.s === 'x');
  if (allUnknown) return cards.map((c) => c.r).join('') + (suited && cards.length === 2 ? suited : '');
  return cards.map((c) => c.r + c.s).join('');
}

module.exports = { numberWords, spokenAmount, splitRankRun, spokenCards, _readPhrase: readPhrase };
