// ── Hand history: the PokerStars text format, both directions ───────────────
// The tables and formatters the writer (pokerstars-writer.js) and the parser
// (lib/hh-import/pokerstars.mjs) share, so the two cannot drift apart: a game
// name, a street header, a fold phrase or a money format is defined once, here.
//
// Every construct was checked against genuine PokerStars hand histories (fpdb's
// regression samples, 2005-2024) and fpdb's PokerStars parser; see
// docs/hand-history-io.md for the sources and the constructs still unverified.
// Pure: no DOM, no React, no Date.now(). Loads under plain Node and Vite.

// ── Games ───────────────────────────────────────────────────────────────────
/* The replayer's game -> the header's game and limit words.
   `pt4`: PokerTracker 4 imports the game. It analyses Hold'em, Omaha and Omaha
   Hi/Lo in the three limit structures and nothing else: stud and draw it never
   read, and five- and six-card Omaha its staff block on import (so they cannot
   corrupt the four-card data). `pt4Why` says which of those it is, for the copy.
   `unverified`: the header wording was not seen in a genuine PokerStars hand.
   Every other wording here was: 5 and 6 Card Omaha and their Hi/Lo forms and
   Omaha Hi/Lo No Limit are all in fpdb's Stars samples (docs/hand-history-io.md).

   Names are the replayer's. Six-card PLO hi-lo is "PLO6 8/b", never "Big Easy"
   (owner, 2026-10-14); a hand saved before that still says "Big Easy" and
   LEGACY_GAME_NAMES reads it as the new name. */
export const GAME_TABLE = {
  'NLH':        { game: "Hold'em", limit: 'No Limit', pt4: true },
  'PLH':        { game: "Hold'em", limit: 'Pot Limit', pt4: true },
  'LHE':        { game: "Hold'em", limit: 'Limit', pt4: true },
  'PLO':        { game: 'Omaha', limit: 'Pot Limit', pt4: true },
  'PLO5':       { game: '5 Card Omaha', limit: 'Pot Limit', pt4: false, pt4Why: 'big-omaha' },
  'PLO6':       { game: '6 Card Omaha', limit: 'Pot Limit', pt4: false, pt4Why: 'big-omaha' },
  'PLO8':       { game: 'Omaha Hi/Lo', limit: 'Pot Limit', pt4: true },
  'NLO8':       { game: 'Omaha Hi/Lo', limit: 'No Limit', pt4: true },
  'O8':         { game: 'Omaha Hi/Lo', limit: 'Limit', pt4: true },
  'Big O':      { game: '5 Card Omaha Hi/Lo', limit: 'Pot Limit', pt4: false, pt4Why: 'big-omaha' },
  'PLO6 8/b':   { game: '6 Card Omaha Hi/Lo', limit: 'Pot Limit', pt4: false, pt4Why: 'big-omaha' },
  'LO Hi':      { game: 'Omaha', limit: 'Limit', pt4: true },
  'Stud Hi':    { game: '7 Card Stud', limit: 'Limit', pt4: false, pt4Why: 'stud-draw' },
  'Stud 8':     { game: '7 Card Stud Hi/Lo', limit: 'Limit', pt4: false, pt4Why: 'stud-draw' },
  'Stud Hi-Lo': { game: '7 Card Stud Hi/Lo', limit: 'Limit', pt4: false, pt4Why: 'stud-draw' },
  'Razz':       { game: 'Razz', limit: 'Limit', pt4: false, pt4Why: 'stud-draw' },
  '2-7 TD':     { game: 'Triple Draw 2-7 Lowball', limit: 'Limit', pt4: false, pt4Why: 'stud-draw' },
  'L 2-7 TD':   { game: 'Triple Draw 2-7 Lowball', limit: 'Limit', pt4: false, pt4Why: 'stud-draw' },
  'PL 2-7 TD':  { game: 'Triple Draw 2-7 Lowball', limit: 'Pot Limit', pt4: false, pt4Why: 'stud-draw', unverified: true },
  'NL 2-7 SD':  { game: 'Single Draw 2-7 Lowball', limit: 'No Limit', pt4: false, pt4Why: 'stud-draw' },
  'PL 5CD Hi':  { game: '5 Card Draw', limit: 'Pot Limit', pt4: false, pt4Why: 'stud-draw' },
  'Badugi':     { game: 'Badugi', limit: 'Limit', pt4: false, pt4Why: 'stud-draw' },
};

/* Names a hand may still carry for a game that has been renamed. The owner's
   name for six-card PLO hi-lo is PLO6 8/b; hands saved as "Big Easy" read as it,
   before they are hashed, seated or written, so the same hand gets the same
   hand number under either name. (utils.js LEGACY_GAME_NAMES is the replayer's
   copy: that module touches localStorage and cannot load in Node.) */
export const LEGACY_GAME_NAMES = { 'Big Easy': 'PLO6 8/b' };
export function canonicalGameName(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_GAME_NAMES, name) ? LEGACY_GAME_NAMES[name] : name;
}

/* Games the app plays that the writer deliberately does not write yet, with
   why. The hand is refused as 'unsupported-game' with this reason, so a Short
   Deck hand says so instead of being written as hold'em with the wrong
   rankings. Short Deck is a PokerStars game ("6+ Hold'em"), but it posts a
   button blind or an ante from everyone and ranks a flush over a full house,
   and the scorer here (fast-high.js, settle.js) is the 52-card one. */
export const NOT_WRITTEN = {
  'Short Deck': {
    short: "Short Deck isn't exported yet",
    why: "Short Deck isn't exported yet: it ranks hands differently and PokerStars posts its blinds another way",
  },
};

/* The engine's (poker-engine.js GAME_EVAL) name for the scoring rules of a game
   it may not list under that name. Until the engine names PLO6 8/b and NLO8
   itself, they score as the games they are: six-card and four-card Omaha
   hi-lo with an 8-or-better low. Only consulted when GAME_EVAL has no entry. */
export const ENGINE_GAME_NAMES = { 'PLO6 8/b': 'Big Easy', 'NLO8': 'PLO8' };

/* Header words -> the replayer's game (the first name in GAME_TABLE wins, so
   '7 Card Stud Hi/Lo Limit' reads as 'Stud 8' and the triple draw as '2-7 TD'). */
export const HEADER_TO_GAME = (() => {
  const out = {};
  for (const [gt, g] of Object.entries(GAME_TABLE)) {
    const k = g.game + ' ' + g.limit;
    if (!(k in out)) out[k] = gt;
  }
  return out;
})();

/* Games whose PokerStars header is a GAME this format knows in another limit,
   or a variant the replayer cannot hold: the parser skips those hands as
   'unsupported-feature' rather than 'unsupported-game'. Omaha Hi/Lo No Limit
   is not here: it is NLO8, a game of its own since 2026-10-14. */
export const UNSUPPORTED_FEATURE_GAMES = [
  /^Omaha No Limit$/, /^(5|6) Card Omaha( Hi\/Lo)? No Limit$/,
  /^5 Card Draw (No Limit|Limit)$/, /^Courchevel/, /^6\+ Hold'em/, /^Split /,
];

/* The game a hand is written as. A PLO hand dealt five or six hole cards is
   5 or 6 Card Omaha whatever the hand calls itself (the replayer's game picker
   stores PLO5 and PLO6 as PLO until it plays them natively). */
export function starsGameType(gameType, holeCount) {
  const base = canonicalGameName(String(gameType || ''));
  if (base === 'PLO' && holeCount === 5) return 'PLO5';
  if (base === 'PLO' && holeCount === 6) return 'PLO6';
  return base;
}

export function isPt4Game(gameType) {
  const g = GAME_TABLE[canonicalGameName(gameType)];
  return !!(g && g.pt4);
}

// ── Currencies ──────────────────────────────────────────────────────────────
export const CURRENCIES = {
  USD: { sym: '$' },
  EUR: { sym: '€' },
  GBP: { sym: '£' },
  CAD: { sym: '$' },
  CNY: { sym: '¥' },
};
export const CURRENCY_SYMBOLS = ['$', '€', '£', '¥'];

// ── Money: integer hundredths everywhere ──────────────────────────────────────
/* A model amount (chips or dollars, possibly fractional) to integer hundredths.
   Every sum, comparison and split is done on these, so float noise (0.1 + 0.2)
   never reaches the text. */
export function toCents(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return NaN;
  return Math.round(v * 100);
}
export function fromCents(c) {
  return c / 100;
}

/* "12500", "0.50", "1916.50": whole amounts without decimals, anything else
   with two; no thousands separators. Matches genuine Stars amounts ($6, $0.95,
   $1916.50, 2383). */
export function formatCents(c) {
  const neg = c < 0;
  const a = Math.abs(c);
  const s = a % 100 === 0 ? String(a / 100) : (Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0'));
  return (neg ? '-' : '') + s;
}
export function money(c, sym) {
  return (sym || '') + formatCents(c);
}

/* "$1,916.50" / "€0.05" / "2383" -> hundredths. Strips any currency symbol,
   'Rs. ', and thousands commas. */
export function parseMoney(str) {
  if (str == null) return NaN;
  const s = String(str).trim().replace(/^Rs\.\s*/, '').replace(/[$€£¥₹]/g, '').replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

// ── Roman numerals (tournament levels) ────────────────────────────────────────
const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function toRoman(n) {
  let v = Math.max(1, Math.floor(Number(n) || 1));
  let out = '';
  for (const [k, s] of ROMAN) while (v >= k) { out += s; v -= k; }
  return out;
}
export function fromRoman(s) {
  if (/^\d+$/.test(s)) return Number(s);
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = map[s[i]], nx = map[s[i + 1]] || 0;
    if (!v) return NaN;
    total += v < nx ? -v : v;
  }
  return total;
}

// ── Time: the wall clock in America/New_York, labelled ET all year ──────────────
let _etFmt = null;
const _etCache = new Map();   // a file's hands share a handful of timestamps
function etParts(date) {
  const k = date.getTime();
  const hit = _etCache.get(k);
  if (hit) return hit;
  const v = etPartsUncached(date);
  if (_etCache.size > 4000) _etCache.clear();
  _etCache.set(k, v);
  return v;
}
function etPartsUncached(date) {
  if (!_etFmt) {
    _etFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', second: '2-digit',
    });
  }
  const o = {};
  for (const p of _etFmt.formatToParts(date)) if (p.type !== 'literal') o[p.type] = p.value;
  return {
    y: Number(o.year), mo: Number(o.month), d: Number(o.day),
    h: Number(o.hour) % 24, mi: Number(o.minute), s: Number(o.second),
  };
}
const pad2 = (n) => String(n).padStart(2, '0');

/* "2026/10/13 9:05:07" — the date and minutes/seconds zero-padded, the hour not,
   as Stars writes it ("2013/03/29 3:47:12 ET"). */
export function formatET(date) {
  const p = etParts(date);
  return p.y + '/' + pad2(p.mo) + '/' + pad2(p.d) + ' ' + p.h + ':' + pad2(p.mi) + ':' + pad2(p.s);
}
/* The ET calendar day, 'YYYY-MM-DD'. */
export function etDay(date) {
  const p = etParts(date);
  return p.y + '-' + pad2(p.mo) + '-' + pad2(p.d);
}
/* "2026/10/13 9:05:07" read as ET -> a Date. ET is UTC-4 (EDT) or UTC-5
   (EST); the offset is the one whose round trip through formatET gives the
   same wall clock. In the repeated fall-back hour both do and EDT is taken. */
export function parseET(text) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})[ -]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text).trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] || '0'].map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  for (const off of [4, 5]) {
    const cand = new Date(wall + off * 3600e3);
    const p = etParts(cand);
    if (p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi && p.s === s) return cand;
  }
  return new Date(wall + 5 * 3600e3);
}

// ── Names ───────────────────────────────────────────────────────────────────
/* A name PokerStars text can carry: no control characters, colons, parentheses
   or brackets (each breaks a line's grammar), whitespace collapsed, 30
   characters. Counted in code points, not UTF-16 units: a name whose 30th
   character is an emoji must not keep half of its surrogate pair (the file's
   UTF-8 encoder turns a lone surrogate into U+FFFD). */
export function sanitizeName(name) {
  return truncateChars(String(name == null ? '' : name)
    .replace(/[\x00-\x1f\x7f:()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim(), 30)
    .trim();
}
/* The first n code points of s. */
export function truncateChars(s, n) {
  const str = String(s);
  if (str.length <= n) return str;   // n code points are at most n UTF-16 units
  return Array.from(str).slice(0, n).join('');
}

/* Site name for the header: a word PT4 and HM recognise ('PokerStars') or
   another plain name. */
export const SITE_RE = /^[A-Za-z][A-Za-z0-9 .'-]{0,30}$/;

// ── Streets ─────────────────────────────────────────────────────────────────
export const COMMUNITY_HEADERS = ['*** HOLE CARDS ***', '*** FLOP ***', '*** TURN ***', '*** RIVER ***'];
export const STUD_HEADERS = ['*** 3rd STREET ***', '*** 4th STREET ***', '*** 5th STREET ***', '*** 6th STREET ***', '*** RIVER ***'];
export const DRAW_HEADERS = ['*** DEALING HANDS ***', '*** FIRST DRAW ***', '*** SECOND DRAW ***', '*** THIRD DRAW ***'];
export const SHOWDOWN_HEADER = '*** SHOW DOWN ***';
export const SUMMARY_HEADER = '*** SUMMARY ***';

/* The summary's fold phrase for a player who folded on street si. `category`
   is the replayer's (community, stud, draw_triple, draw_single). */
export function foldPhrase(category, gameType, si, didntBet) {
  const tail = didntBet ? " (didn't bet)" : '';
  if (category === 'stud') {
    const names = ['3rd Street', '4th Street', '5th Street', '6th Street', 'River'];
    return 'folded on the ' + names[si] + tail;
  }
  if (category === 'draw_triple') {
    if (si === 0) return 'folded before the Draw' + tail;
    return 'folded after the ' + ['1st', '2nd', '3rd'][si - 1] + ' Draw';
  }
  if (category === 'draw_single') {
    if (si === 0) return (gameType === 'NL 2-7 SD' ? 'folded before Flop' : 'folded before the Draw') + tail;
    return 'folded after the Draw';
  }
  if (si === 0) return 'folded before Flop' + tail;
  return 'folded on the ' + ['Flop', 'Turn', 'River'][si - 1];
}

// ── Cards ───────────────────────────────────────────────────────────────────
/* [{rank,suit}] -> "Ah Kd" (space-separated, T for ten). */
export function cardText(cards) {
  return cards.map(c => c.rank + c.suit).join(' ');
}
/* "Ah Kd" / "AhKd" -> ['Ah','Kd']; null when anything is not a card. */
export function splitCards(text) {
  const s = String(text || '').replace(/\s+/g, '');
  if (!s) return [];
  if (s.length % 2) return null;
  const out = [];
  for (let i = 0; i < s.length; i += 2) {
    const r = s[i].toUpperCase(), u = s[i + 1].toLowerCase();
    if (!'23456789TJQKA'.includes(r) || !'hdcs'.includes(u)) return null;
    out.push(r + u);
  }
  return out;
}

// ── Hashing (hand and tournament ids) ─────────────────────────────────────────
/* JSON with object keys sorted at every level, so the same content always
   hashes the same whatever order its fields were written in. */
export function sortedJSON(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(sortedJSON).join(',') + ']';
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + sortedJSON(v[k])).join(',') + '}';
}

function utf8(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = [];
  for (const ch of unescape(encodeURIComponent(str))) out.push(ch.charCodeAt(0));
  return out;
}

/* 64-bit FNV-1a over the UTF-8 bytes, as a BigInt. The arithmetic runs on four
   16-bit limbs (the prime is 2^40 + 0x1b3, so a multiply is two shifted
   adds per limb) — the same value as the BigInt loop, many times faster. */
export function fnv1a64(str) {
  let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;   // 0xcbf29ce484222325
  for (const b of utf8(str)) {
    h0 ^= b;
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    const t2 = h2 * 0x1b3 + h0 * 0x100 + (t1 >>> 16);
    const t3 = h3 * 0x1b3 + h1 * 0x100 + (t2 >>> 16);
    h0 = t0 & 0xffff; h1 = t1 & 0xffff; h2 = t2 & 0xffff; h3 = t3 & 0xffff;
  }
  return (BigInt(h3) << 48n) | (BigInt(h2) << 32n) | (BigInt(h1) << 16n) | BigInt(h0);
}

/* The plain BigInt definition, kept for the test that holds the two equal. */
export function fnv1a64Reference(str) {
  let h = 0xcbf29ce484222325n;
  for (const b of utf8(str)) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h;
}
