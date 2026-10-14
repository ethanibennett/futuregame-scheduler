// Quick-add: card notation, amounts and other small value parsers.
'use strict';

const RANK_RE = '[2-9TJQKA]';
// U+2764 is the heavy black heart (❤), which forum posts use for hearts.
const SUITS = { '♠': 's', '♤': 's', '♥': 'h', '♡': 'h', '❤': 'h', '♦': 'd', '♢': 'd', '♣': 'c', '♧': 'c' };
// Emoji presentation selectors: "Q♣️" is Q, ♣, U+FE0F. They carry no meaning here.
const VARIATION_SELECTORS = /[︎️]/g;

/* A board's suit texture written after its ranks: "873r", "569 rainbow", "T5Ttt",
   "Q72 mono". Only lower-case "tt" counts, so "QTT" stays three ranks. */
const TEXTURE_SUFFIX = /(rainbow|rb|r|tt|twotone|monotone|mono)$/;
const TEXTURE_OF = { rainbow: 'rainbow', rb: 'rainbow', r: 'rainbow', tt: 'two-tone', twotone: 'two-tone', monotone: 'monotone', mono: 'monotone' };

/* Card text in any of the forms the replayer and players use, as a list of two-char
   cards in the replayer's notation (rank upper case, suit h/d/c/s, 'x' for a suit
   that is not known). Accepts interleaved "AhKs" / "Ah Ks" / "ah,ks", grouped "AKhs"
   (the replayer's placeholder form), "10h", suit symbols (with or without the emoji
   selector), and ranks with no suits at all ("AK", "AKs", "99") which become
   unknown-suit cards ("AxKx").
   Returns { cards, ranksOnly, suitedness?, suitPattern?, partialSuits?, bothSuited?, texture?,
   unknownCount?, hiddenCount? } or null when the text is not cards. An empty string is zero cards.
   - texture: 'rainbow' | 'two-tone' | 'monotone' from a suffix ("873r", "T5Ttt").
   - unknownCount: standalone "x" cards ("Q 10 x" is a queen, a ten and a card nobody
     named). A rankless card is not representable — the replayer's parser drops it — so
     it is counted, never stored.
   - hiddenCount: stud's face-down cards written as "(xx)", "[xx xx]", "xx…" or "(x)",
     which are stripped.
   A bare "xx" with nothing else is still rejected: it is no card at all. */
function parseCards(input) {
  if (input == null) return { cards: [], ranksOnly: false };
  let s = String(input).replace(VARIATION_SELECTORS, '').trim();
  if (!s) return { cards: [], ranksOnly: false };
  for (const [sym, suit] of Object.entries(SUITS)) s = s.split(sym).join(suit);
  const extra = {};
  // Stud's hidden cards: "(xx)", "[xx xx]", "(x)".
  let hidden = 0;
  s = s.replace(/[([{]\s*((?:x\s*){1,4})[)\]}]/gi, (m, xs) => { hidden += xs.replace(/\s/g, '').length; return ' '; });
  // Standalone x tokens are whole unknown cards.
  const tokens = s.split(/[\s,;/|]+/).filter(Boolean);
  const unknown = tokens.filter((t) => /^[x?]$/i.test(t)).length;
  if (unknown && unknown < tokens.length) s = tokens.filter((t) => !/^[x?]$/i.test(t)).join(' ');
  s = s.replace(/10/g, 'T').replace(/[\s,;:/|.()[\]{}+-]/g, '');
  // Leading face-down cards in stud shorthand: "xxJc9c".
  const lead = /^(x{2,3})(?=[2-9tjqkaTJQKA])/i.exec(s);
  if (lead) { hidden += lead[1].length; s = s.slice(lead[1].length); }
  if (!s) return hidden || unknown ? { cards: [], ranksOnly: false, ...(hidden ? { hiddenCount: hidden } : {}), ...(unknown ? { unknownCount: unknown } : {}) } : { cards: [], ranksOnly: false };
  const tex = /(rainbow|rb|r|twotone|monotone|mono)$/i.exec(s) || TEXTURE_SUFFIX.exec(s);
  if (tex && tex.index > 0) {
    const rest = s.slice(0, tex.index);
    const inner = parseCards(rest);
    if (inner && inner.cards.length) {
      extra.texture = TEXTURE_OF[tex[1].toLowerCase()];
      return finish(inner, extra, hidden, unknown);
    }
  }
  const up = s.replace(/[a-z]/gi, (ch) => ('tjqka'.includes(ch.toLowerCase()) ? ch.toUpperCase() : ch.toLowerCase()));
  // Interleaved: rank suit rank suit …
  if (new RegExp('^(' + RANK_RE + '[hdcsx])+$').test(up)) {
    return finish({ cards: up.match(/../g), ranksOnly: false }, extra, hidden, unknown);
  }
  // Grouped: all ranks then as many suits.
  const g = new RegExp('^(' + RANK_RE + '+)([hdcsx]+)$').exec(up);
  if (g && g[1].length === g[2].length) {
    return finish({ cards: g[1].split('').map((r, i) => r + g[2][i]), ranksOnly: false }, extra, hidden, unknown);
  }
  // Ranks only, optionally "s"/"o" for suited/offsuit (AKs, AKo, 99).
  const r = new RegExp('^(' + RANK_RE + '{1,7})([so]?)$').exec(up);
  if (r) return finish({ cards: r[1].split('').map((rk) => rk + 'x'), ranksOnly: true, suitedness: r[2] || null }, extra, hidden, unknown);
  /* Omaha's pattern letters after four to six ranks: "AAKKds" is double suited, "AJT9ss"
     single suited — a pattern, not a diamond and a spade
     (2026-10-14, review). Ranks stay unknown-suit and `suitPattern` carries the pattern;
     the other fewer-suits-than-ranks shorthand ("KQJ2dd") is below. ("ts" cannot be
     told from a ten of spades, so triple suited is not read here.) */
  const pat = new RegExp('^(' + RANK_RE + '{4,6})(ds|ss)$').exec(up);
  if (pat) return finish({ cards: pat[1].split('').map((rk) => rk + 'x'), ranksOnly: true, suitedness: null, suitPattern: pat[2] }, extra, hidden, unknown);
  /* Two shorthands where the suit count does not match the rank count (2026-10-02,
     a PLO hand typed as "4dd" and "KQJ2dd"; both were dropped as "not card notation"):
     - MORE suits than ranks, all one suit — "4dd", "7cc" — is the card plus a texture
       note: the turn is the 4 of diamonds and the board now has two of them.
     - FEWER suits than ranks — "KQJ2dd" — says how many share that suit, not which.
       The suits go to the first cards as written and the rest stay unknown, and
       `partialSuits` lets the caller say so. Two cards of one rank never take the same
       suit ("AA92hh" is Ah Ax 9h 2x, not two aces of hearts — 2026-10-14). */
  const m = new RegExp('^(' + RANK_RE + '+)([hdcsx]+)$').exec(up);
  if (m) {
    const ranks = m[1].split(''), suits = m[2].split('');
    /* One suit letter after a two-card holding means BOTH cards have that suit (owner, 2026-10-14):
       "AKh" is AhKh, "A10h" is AhTh, "J 10d" is JdTd. The player can edit it. */
    if (ranks.length === 2 && suits.length === 1 && suits[0] !== 'x' && ranks[0] !== ranks[1]) {
      return finish({ cards: ranks.map((rk) => rk + suits[0]), ranksOnly: false, bothSuited: true }, extra, hidden, unknown);
    }
    if (suits.length > ranks.length && new Set(suits).size === 1 && suits[0] !== 'x') {
      return finish({ cards: ranks.map((rk) => rk + suits[0]), ranksOnly: false }, extra, hidden, unknown);
    }
    if (suits.length < ranks.length) {
      const out = ranks.map((rk) => rk + 'x');
      const queue = suits.slice();
      for (let i = 0; i < out.length && queue.length; i++) {
        const su = queue[0];
        if (su !== 'x' && out.some((c) => c === ranks[i] + su)) continue;
        out[i] = ranks[i] + su;
        queue.shift();
      }
      return finish({ cards: out, ranksOnly: false, partialSuits: true }, extra, hidden, unknown);
    }
  }
  /* Mixed: some cards with a suit and some without ("KdJ97", "Ad9x5"): each rank
     takes the suit right after it, if any. */
  if (/^([2-9TJQKA][hdcsx]?)+$/.test(up) && /[hdcs]/.test(up)) {
    const out = up.match(/[2-9TJQKA][hdcsx]?/g).map((c) => (c.length === 2 ? c : c + 'x'));
    return finish({ cards: out, ranksOnly: false }, extra, hidden, unknown);
  }
  return null;
}
function finish(res, extra, hidden, unknown) {
  const out = { ...res, ...extra };
  if (hidden) out.hiddenCount = (out.hiddenCount || 0) + hidden;
  if (unknown) out.unknownCount = (out.unknownCount || 0) + unknown;
  return out;
}

const cardKey = (c) => c; // two-char card, already canonical

/** The known (suit not 'x') cards in a list, for collision checks. */
function knownCards(cards) {
  return (cards || []).filter((c) => c[1] !== 'x');
}

/* A chip or money amount from a number or loose text, with whether it was said as an
   estimate: 1200, "1,200", "1.2k", "$1,100", "2k", "1.5m", "€500", "t2090" (tournament
   chips), "400 000" (spaced thousands), "1,2" (a decimal comma: 1.2), "35 grand",
   "1.2 mil", and "~450" / "about 450" / "like 7500" / "450ish" (approx: true).
   null for anything else, including negatives and NaN. */
function parseAmountInfo(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? { value: v, approx: false } : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[   ]/g, ' ').trim().toLowerCase();
  let approx = false;
  const pre = /^(?:~|≈|about|around|roughly|approx(?:imately)?\.?|like|circa|ca\.)\s*/;
  if (pre.test(s)) { approx = true; s = s.replace(pre, ''); }
  if (/(?:\s*-?\s*ish|\s*\+?\s*or so)$/.test(s)) { approx = true; s = s.replace(/(?:\s*-?\s*ish|\s*\+?\s*or so)$/, ''); }
  s = s.replace(/^[$€£]\s*/, '').replace(/^t\s*(?=\d)/, '');
  const m = /^(\d{1,3}(?:,\d{3})+|\d{1,3}(?: \d{3})+|\d+,\d{1,2}|\d+(?:\.\d+)?|\.\d+)\s*(k|m|mil|million|grand|thousand)?\s*$/.exec(s);
  if (!m) return null;
  let num = m[1];
  if (/^\d+,\d{1,2}$/.test(num)) num = num.replace(',', '.');
  let n = Number(num.replace(/[, ]/g, ''));
  const unit = m[2];
  if (unit === 'k' || unit === 'grand' || unit === 'thousand') n *= 1e3;
  else if (unit) n *= 1e6;
  return Number.isFinite(n) && n >= 0 ? { value: roundMoney(n), approx } : null;
}
function parseAmount(v) {
  const r = parseAmountInfo(v);
  return r ? r.value : null;
}

/* Stakes as written: "1/3", "$2/$5", "6/12k" (the k carries back to every number that
   would otherwise be smaller than it should: 6,000/12,000), "1.5/3k", "8-16", "5/T"
   (T is ten), "2/5/10", "25/50/50", "1/2/4/800". With { fused: true }, a speech run
   that glued the two numbers together is split when the second is twice the first:
   "1224" 12/24, "510" 5/10, "2040" 20/40.
   Returns { sb, bb, rest: [...], numbers: [...] } or null. */
function parseStakes(input, opts = {}) {
  if (input == null) return null;
  let s = String(input).replace(/[   ]/g, ' ').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/[$€£]/g, '').replace(/\b(?:nl|nlh|nlhe|plo|pl|fl|limit|blinds?|stakes|cash|game|hold'?em)\b/g, ' ').trim();
  let parts = s.split(/\s*(?:\/|-|–|:|\bby\b)\s*/).filter(Boolean);
  if (parts.length === 1 && opts.fused && /^\d{2,6}$/.test(parts[0])) {
    const d = parts[0];
    for (let cut = 1; cut < d.length; cut++) {
      const a = Number(d.slice(0, cut)), b = Number(d.slice(cut));
      if (a > 0 && b === 2 * a && d[cut] !== '0') { parts = [String(a), String(b)]; break; }
    }
  }
  if (parts.length < 2 || parts.length > 5) return null;
  const vals = [];
  for (const p of parts) {
    if (p === 't') { vals.push({ n: 10, mult: 1, own: false }); continue; }
    const m = /^(\d+(?:\.\d+)?|\.\d+)\s*(k|m)?$/.exec(p.replace(/,(?=\d{3}\b)/g, ''));
    if (!m) return null;
    vals.push({ n: Number(m[1]), mult: m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1, own: !!m[2] });
  }
  const last = vals[vals.length - 1];
  if (last.own) {
    const lastVal = last.n * last.mult;
    for (const v of vals) if (!v.own && v.n * last.mult <= lastVal) v.mult = last.mult;
  }
  const numbers = vals.map((v) => roundMoney(v.n * v.mult));
  if (numbers.some((x) => !(x > 0))) return null;
  return { sb: numbers[0], bb: numbers[1], rest: numbers.slice(2), numbers };
}

/* Rounds a computed amount the way the table would: whole chips unless the stakes
   themselves have cents (a $0.50 small blind), then cents. */
function roundChips(x, blinds) {
  if (!Number.isFinite(x)) return null;
  const b = blinds || {};
  const fractional = [b.sb, b.bb, b.ante, b.bigBet, b.bringIn].some((v) => typeof v === 'number' && !Number.isInteger(v));
  return fractional ? roundMoney(x) : Math.round(x);
}
function roundMoney(x) { return Math.round(x * 100) / 100; }

/** A short display string: printable, single-line, at most `max` characters. */
function cleanText(v, max) {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max).trim() : s;
}

function isInt(v) { return typeof v === 'number' && Number.isInteger(v); }

module.exports = {
  parseCards, knownCards, cardKey, parseAmount, parseAmountInfo, parseStakes,
  roundChips, roundMoney, cleanText, isInt,
};
