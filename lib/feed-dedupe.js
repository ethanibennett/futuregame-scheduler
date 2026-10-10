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

const roomKey = (row) => String(row.property || '').trim().toLowerCase();

/**
 * @param {Array<object>} rows  tournaments rows: id, source_pdf, venue, property, date, time, buyin, event_name
 * @param {object} opts
 * @param {string[]} opts.feedTags    source_pdf values that mark feed-owned rows ('mtt-feed', 'online-feed')
 * @returns {Array<{ hand: number, feed: number }>} each feed row that duplicates a hand-imported row
 */
function findHandImportTwins(rows, { feedTags }) {
  const feedSet = new Set(feedTags);
  const hand = new Map(); // room|day -> hand-imported rows
  for (const r of rows) {
    if (!r || feedSet.has(r.source_pdf) || !r.source_pdf || r.venue === 'Personal') continue;
    const room = roomKey(r);
    const day = isoDay(r.date);
    if (!room || !day) continue;
    const k = `${room}|${day}`;
    if (!hand.has(k)) hand.set(k, []);
    hand.get(k).push(r);
  }
  if (!hand.size) return [];
  const out = [];
  for (const f of rows) {
    if (!f || !feedSet.has(f.source_pdf)) continue;
    const room = roomKey(f);
    const day = isoDay(f.date);
    const cands = room && day ? hand.get(`${room}|${day}`) : null;
    if (!cands) continue;
    const fm = clockMinutes(f.time);
    const fr = restartDay(f);
    const match = cands.find((h) => {
      const hm = clockMinutes(h.time);
      if (fm == null || hm == null || Math.abs(fm - hm) > MAX_START_GAP) return false;
      const hr = restartDay(h);
      if (fr || hr) return fr === hr; // restart days pair only with the same restart day
      return Number(h.buyin) === Number(f.buyin);
    });
    if (match) out.push({ hand: match.id, feed: f.id });
  }
  return out;
}

module.exports = { findHandImportTwins, restartDay, MAX_START_GAP };
