// Quick-add: card notation, amounts and other small value parsers.
'use strict';

const RANK_RE = '[2-9TJQKA]';
const SUITS = { '♠': 's', '♤': 's', '♥': 'h', '♡': 'h', '♦': 'd', '♢': 'd', '♣': 'c', '♧': 'c' };

/* Card text in any of the forms the replayer and players use, as a list of two-char
   cards in the replayer's notation (rank upper case, suit h/d/c/s, 'x' for a suit
   that is not known). Accepts interleaved "AhKs" / "Ah Ks" / "ah,ks", grouped "AKhs"
   (the replayer's placeholder form), "10h", suit symbols, and ranks with no suits at
   all ("AK", "AKs", "99") which become unknown-suit cards ("AxKx").
   Returns { cards, ranksOnly } or null when the text is not cards. An empty string
   is zero cards. A rankless card ('xx') is not representable — the replayer's parser
   drops it — so it is rejected rather than silently shortening the hand. */
function parseCards(input) {
  if (input == null) return { cards: [], ranksOnly: false };
  let s = String(input).trim();
  if (!s) return { cards: [], ranksOnly: false };
  for (const [sym, suit] of Object.entries(SUITS)) s = s.split(sym).join(suit);
  s = s.replace(/10/g, 'T').replace(/[\s,;:/|.()[\]{}+-]/g, '');
  if (!s) return { cards: [], ranksOnly: false };
  const up = s.replace(/[a-z]/gi, (ch) => ('tjqka'.includes(ch.toLowerCase()) ? ch.toUpperCase() : ch.toLowerCase()));
  // Interleaved: rank suit rank suit …
  if (new RegExp('^(' + RANK_RE + '[hdcsx])+$').test(up)) {
    return { cards: up.match(/../g), ranksOnly: false };
  }
  // Grouped: all ranks then as many suits.
  const g = new RegExp('^(' + RANK_RE + '+)([hdcsx]+)$').exec(up);
  if (g && g[1].length === g[2].length) {
    return { cards: g[1].split('').map((r, i) => r + g[2][i]), ranksOnly: false };
  }
  // Ranks only, optionally "s"/"o" for suited/offsuit (AKs, AKo, 99).
  const r = new RegExp('^(' + RANK_RE + '{1,7})([so]?)$').exec(up);
  if (r) return { cards: r[1].split('').map((rk) => rk + 'x'), ranksOnly: true, suitedness: r[2] || null };
  return null;
}

const cardKey = (c) => c; // two-char card, already canonical

/** The known (suit not 'x') cards in a list, for collision checks. */
function knownCards(cards) {
  return (cards || []).filter((c) => c[1] !== 'x');
}

/* A chip or money amount from a number or loose text: 1200, "1,200", "1.2k", "$1,100",
   "2k", "1.5m", "€500". null for anything else, including negatives and NaN. */
function parseAmount(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^\s*[$€£]?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|\.\d+)\s*([kKmM])?\s*$/.exec(v);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1e3 : 1e6;
  return Number.isFinite(n) && n >= 0 ? roundMoney(n) : null;
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

module.exports = { parseCards, knownCards, cardKey, parseAmount, roundChips, roundMoney, cleanText, isInt };
