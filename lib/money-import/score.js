'use strict';
/*
 * The duplicate review's scoring (docs/bankroll-merge.md §9.1): which dashboard rows are probably
 * a night, a deposit or an expense this app already holds. Pure.
 *
 *   room      roomKey(): lowercase, punctuation and the words casino / poker room / resort / hotel /
 *             & spa / the stripped, then the alias fold (room-aliases.js, the server copy of
 *             VENUE_MAP). Exact 3; one contains the other or token Jaccard >= 0.5: 2; either side
 *             unknown: 0; a mismatch: -3.
 *   classes   shown at >= 5 within the date window; Likely >= 7, Possible 5-6.
 *   pairing   one to one, best first (score, then the closer date, then the older ids).
 */
const ALIASES = require('./room-aliases');

const STOP = /\b(?:casino|poker room|resort|hotel|the)\b/g;
function normalise(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/&\s*spa\b/g, ' ')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(STOP, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const FOLD = new Map();
for (const [alias, canonical] of ALIASES) {
  const k = normalise(alias);
  if (k && !FOLD.has(k)) FOLD.set(k, normalise(canonical));
}
function roomKey(s) {
  const k = normalise(s);
  return FOLD.get(k) || k;
}
function tokens(s) { return new Set(String(s || '').split(' ').filter(Boolean)); }
function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / (A.size + B.size - n);
}
function roomScore(a, b) {
  const x = roomKey(a), y = roomKey(b);
  if (!x || !y) return 0;
  if (x === y) return 3;
  if (x.includes(y) || y.includes(x) || jaccard(x, y) >= 0.5) return 2;
  return -3;
}
/** The best room score of a dashboard venue against any of several names here (property, site, venue). */
function bestRoomScore(venue, names) {
  const list = names.filter((n) => n && normalise(n) && normalise(n) !== 'personal');
  if (!list.length) return 0;
  return Math.max(...list.map((n) => roomScore(venue, n)));
}
function dayDiff(a, b) {
  const x = Date.parse(a + 'T00:00:00Z'), y = Date.parse(b + 'T00:00:00Z');
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round(Math.abs(x - y) / 864e5) : Infinity;
}
const within = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= tol + 1e-9;
const classOf = (score) => (score >= 7 ? 'likely' : score >= 5 ? 'possible' : null);

/** dashboard cash (mapped view) vs an ended cash_sessions row here. -> { score, parts } | null */
function scoreCash(d, h) {
  const dd = dayDiff(d.date, h.date);
  if (dd > 1) return null;
  const parts = { date: dd === 0 ? 3 : 2, room: roomScore(d.room, h.room), amount: 0, other: 0 };
  if (within(d.result, h.result, 1)) parts.amount = 3; else parts.amount = -2;
  if (within(d.in, h.in, 1) && within(d.out, h.out, 1)) parts.amount += 1;
  if (d.hours != null && h.hours != null && within(d.hours, h.hours, 0.5)) parts.other += 1;
  return { score: parts.date + parts.room + parts.amount + parts.other, parts, dayDiff: dd };
}
/** dashboard MTT vs a tracking entry here. */
function scoreTournament(d, h) {
  const dd = dayDiff(d.date, h.date);
  if (dd > 1) return null;
  const parts = { date: dd === 0 ? 3 : 2, room: bestRoomScore(d.room, [h.property, h.site, h.venue]), amount: 0, other: 0 };
  if (within(d.result, h.result, 1)) parts.amount = 3;
  if (within(d.buyinPerEntry, h.buyinPerEntry, 0.005)) parts.amount += 1;
  if (jaccard(normalise(d.game), normalise(h.game)) >= 0.5) parts.other += 1;
  return { score: parts.date + parts.room + parts.amount + parts.other, parts, dayDiff: dd };
}
/** dashboard deposit / withdrawal vs a bankroll_adjustments row of the same kind. */
function scoreAdjustment(d, h) {
  if (d.kind !== h.kind) return null;
  const dd = dayDiff(d.date, h.date);
  if (dd > 3) return null;
  const parts = { date: 2, room: 0, amount: Math.abs(d.amount) === Math.abs(h.amount) ? 4 : 0, other: 0 };
  return { score: parts.date + parts.amount, parts, dayDiff: dd };
}
// Categories that mean the same thing on both sides.
const COMPATIBLE = { food: ['food'], travel: ['travel'], lodging: ['lodging'], coaching: ['coaching'], equipment: ['equipment', 'software'], fees: ['fees', 'entry_fees'], other: ['other'] };
/** dashboard expense vs a bankroll_transactions expense. */
function scoreExpense(d, h) {
  const dd = dayDiff(d.date, h.date);
  if (dd !== 0) return null;
  const parts = { date: 3, room: 0, amount: Math.round(d.amount * 100) === Math.round(h.amount * 100) ? 4 : 0, other: 0 };
  if ((COMPATIBLE[d.category] || [d.category]).includes(h.category)) parts.other = 1;
  return { score: parts.date + parts.amount + parts.other, parts, dayDiff: dd };
}

/**
 * One-to-one pairing. candidates: [{ dashKey, hereKey, score, dayDiff, ... }]. Each side ends in at
 * most one pair; the best candidates are taken first. Only shown classes (>= 5) are considered.
 */
function pairUp(candidates) {
  const shown = candidates.filter((c) => classOf(c.score));
  shown.sort((a, b) => b.score - a.score || a.dayDiff - b.dayDiff || String(a.dashKey).localeCompare(String(b.dashKey)) || String(a.hereKey).localeCompare(String(b.hereKey)));
  const usedD = new Set(), usedH = new Set();
  const out = [];
  for (const c of shown) {
    if (usedD.has(c.dashKey) || usedH.has(c.hereKey)) continue;
    usedD.add(c.dashKey); usedH.add(c.hereKey);
    out.push({ ...c, class: classOf(c.score) });
  }
  return out;
}

module.exports = { normalise, roomKey, roomScore, bestRoomScore, jaccard, dayDiff, classOf, scoreCash, scoreTournament, scoreAdjustment, scoreExpense, pairUp };
