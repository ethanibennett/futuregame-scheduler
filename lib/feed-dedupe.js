'use strict';
// One event, two rows: a series added by hand from the room's own published schedule (an
// /api/import-parsed-schedule "bridge", e.g. Borgata Fall Poker Open 2026) and the same series
// arriving later through a feed. Before this, retiring a bridge needed a hand-written
// BRIDGE_SUPERSEDE entry naming the exact venue string the feed would use — and the feed rarely
// uses the name anyone expects (Borgata came as TWO PokerAtlas series, "2026 Borgata Poker
// Open-Fall" and "2026 Fall Poker Open (Borgata Hotel Casino & Spa)"), so every event listed
// twice or three times with clashing event numbers.
//
// This matches EVENTS, not series names, so nothing has to be maintained per series:
//   same room (property, case-insensitive), same calendar day,
//   start times within MAX_START_GAP minutes,
//   and either the same buy-in, or both are restart days with the same "Day N" label
//   (hand imports carry restart days at $0; the feed repeats the parent's buy-in).
//
// Which copy stays: the hand import. It is transcribed from the room's own sheet, and the feed's
// copy of a festival can be worse (Borgata on PokerAtlas: Flight F at Flight E's 11:15, #5 filed as
// Stud 8 when Borgata's #5 is the HORSE Championship). The feed row is hidden from the schedule
// list, not deleted — the next hourly sync would only re-insert it. Pure: rows in, decisions out.

const MAX_START_GAP = 60; // minutes

function isoDay(v) {
  const s = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clockMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(String(t || '').trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (!m[3]) h = Number(m[1]);
  else if (/p/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}

// "Day 2", "Day 3"… for a restart day; null for a starting flight ("Day 1A", "Flight C") or a one-day event.
function restartDay(row) {
  const m = /\bDay\s*([2-9])\b(?![A-Z])/i.exec(String(row.event_name || ''));
  if (m) return `day${m[1]}`;
  if (/\bfinal\s+table\b/i.test(String(row.event_name || ''))) return 'final';
  return null;
}

const lc = (s) => String(s || '').trim().toLowerCase();

// One room: the same property, or — for a row imported without one — the same series title. The
// 2026-09-14 WPT World Championship bridge was filed under exactly the venue string PokerAtlas uses,
// and matching on property alone never saw it beside the feed's copy (owner's screenshot,
// 2026-11-15: "TORSE" and the saved "TORSE (2 Day)", both Dec 13 11 AM $1,100).
function sameRoom(a, b) {
  const pa = lc(a.property), pb = lc(b.property);
  if (pa && pb) return pa === pb;
  const va = lc(a.venue), vb = lc(b.venue);
  return !!va && va === vb && va !== 'personal';
}

// What a title names once the labels around it are set aside: "(2 Day)", "$1,100", "Event #29",
// "Day 1A"/"Flight C"/"Final Table", and game names one copy spells out and the other abbreviates
// (No-Limit Hold'em → nlh). Two rows in one slot with the same signature are one event; "TORSE" and
// "NLH Ladies Championship" (Wynn runs both at 11 AM for $1,100 on Dec 13) are not.
const FILLER = new Set(['the', 'a', 'event', 'gtd', 'guaranteed', 'and', 'of']);
function nameSig(name) {
  const s = String(name || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\$\s?[\d,.]+\s*[km]?\b/g, ' ')
    .replace(/\bevent\s*#?\s*\d+[a-z]?\b/g, ' ')
    .replace(/\b(day|flight)\s*\d*[a-z]?\b/g, ' ')
    .replace(/\bfinal\s+table\b/g, ' ')
    .replace(/\b(no[\s-]*limit|nl)\s+hold'?\s*em\b/g, ' nlh ')
    .replace(/\bhold'?\s*em\b/g, ' nlh ')
    .replace(/\bpot[\s-]*limit\s+omaha\b/g, ' plo ');
  return [...new Set(s.split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w)))].sort();
}
// The flight a title names, whichever way it spells it: "Day 1C" and "Flight C" are both 'c'.
// nameSig sets the label aside, so this is what keeps same-time Flight A and Flight B apart.
function flightOf(name) {
  const m = /\b(?:day\s*1\s*|flight\s*)([a-z])\b/i.exec(String(name || '').replace(/\([^)]*\)/g, ' '));
  return m ? m[1].toLowerCase() : null;
}
// Equal signatures; with `loose`, also one wholly inside the other. An empty signature never
// matches, and two titles naming different flights never agree.
function namesAgree(a, b, { loose = false } = {}) {
  const fa = flightOf(a), fb = flightOf(b);
  if (fa && fb && fa !== fb) return false;
  const x = nameSig(a), y = nameSig(b);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  if (!loose) return false;
  const [small, big] = x.length <= y.length ? [x, y] : [y, x];
  return small.every((w) => big.includes(w));
}

// Same room, same day, starts within MAX_START_GAP, and the same buy-in — or both restart days with
// the same "Day N" label (hand imports carry restart days at $0; the feed repeats the parent buy-in).
function sameSlot(a, b) {
  if (!sameRoom(a, b)) return false;
  const da = isoDay(a.date), db = isoDay(b.date);
  if (!da || da !== db) return false;
  const ma = clockMinutes(a.time), mb = clockMinutes(b.time);
  if (ma == null || mb == null || Math.abs(ma - mb) > MAX_START_GAP) return false;
  const ra = restartDay(a), rb = restartDay(b);
  if (ra || rb) return ra === rb;
  return Number(a.buyin) === Number(b.buyin);
}

// The ONE row of `candidates` that is `row`'s event, or null. Strict: the slot must agree AND the
// names must (loosely) agree — this decides where a person's saved event goes, so a slot shared by
// two events (TORSE / Ladies) or a name that matches nothing moves nothing.
function pickTwin(row, candidates) {
  const hits = candidates.filter((c) => c && c.id !== row.id && sameSlot(row, c) && namesAgree(row.event_name, c.event_name, { loose: true }));
  if (hits.length === 1) return hits[0];
  const exact = hits.filter((c) => namesAgree(row.event_name, c.event_name));
  return exact.length === 1 ? exact[0] : null;
}

/**
 * @param {Array<object>} rows  tournaments rows: id, source_pdf, venue, property, date, time, buyin, event_name
 * @param {object} opts
 * @param {string[]} opts.feedTags    source_pdf values that mark feed-owned rows ('mtt-feed', 'online-feed')
 * @returns {Array<{ hand: number, feed: number }>} each feed row that duplicates a hand-imported row
 */
function findHandImportTwins(rows, { feedTags }) {
  const feedSet = new Set(feedTags);
  const hand = new Map(); // day -> hand-imported rows
  for (const r of rows) {
    if (!r || feedSet.has(r.source_pdf) || !r.source_pdf || r.venue === 'Personal') continue;
    const day = isoDay(r.date);
    if (!day || !(lc(r.property) || lc(r.venue))) continue;
    if (!hand.has(day)) hand.set(day, []);
    hand.get(day).push(r);
  }
  if (!hand.size) return [];
  const pairs = [];
  for (const f of rows) {
    if (!f || !feedSet.has(f.source_pdf)) continue;
    const day = isoDay(f.date);
    const cands = day ? (hand.get(day) || []).filter((h) => sameSlot(h, f)) : [];
    if (!cands.length) continue;
    // Two hand rows in this slot: the one this feed row is named like, else the first (as before).
    const named = cands.filter((h) => namesAgree(h.event_name, f.event_name, { loose: true }));
    pairs.push({ hand: (named.length === 1 ? named[0] : cands[0]).id, feed: f.id, named: named.length > 0 });
  }
  // A hand row several feed rows land on: when some of them carry its name, only those are its copy —
  // the rest are other events sharing the slot (Dec 13 at Wynn: TORSE and the Ladies Championship,
  // both $1,100 at 11 AM; hiding Ladies under a hand-made TORSE would drop a real event). When none
  // carries its name, every one stays a duplicate, as before (Borgata's PokerAtlas Flight F filed at
  // Flight E's time).
  const byHand = new Map();
  for (const p of pairs) (byHand.get(p.hand) || byHand.set(p.hand, []).get(p.hand)).push(p);
  const out = [];
  for (const group of byHand.values()) {
    const named = group.filter((p) => p.named);
    for (const p of (group.length > 1 && named.length ? named : group)) out.push({ hand: p.hand, feed: p.feed });
  }
  return out;
}

module.exports = { findHandImportTwins, restartDay, MAX_START_GAP, isoDay, clockMinutes, sameRoom, sameSlot, nameSig, namesAgree, pickTwin, flightOf };
