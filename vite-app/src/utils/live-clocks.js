// Live tournament clocks on the client: one shared poller behind every view that shows them.
//
// Components REGISTER the events they are showing (registerClock / useLiveClocks) and read the
// answers back; one interval posts every registered id to /api/live-clocks (server:
// lib/live-clocks.js) every 15 s, the rate Bravo's own app polls at. Registration is ref-counted,
// so the dashboard and a schedule card showing the same event cost one request, and a card that
// scrolls away unregisters and stops costing anything. Polling pauses while the page is hidden.
//
// A clock answer is { source, name, state, onBreak, level, sb, bb, ante, levelSecs,
// remainingSecs, fetchedAt, nextBlinds, minsToBreak, entries, playersLeft, avgStack, prizePool,
// regEndsAt, startsAt } plus receivedAt (client ms) added here.

import { useEffect, useSyncExternalStore } from 'react';
import { fetchApi } from './api.js';
import { lateRegCloseOf, parseTournamentTime } from './utils.js';

/** How long after its start an event is worth asking the room's clock about. A Day 1 that starts
 *  at 4 PM plays past 2 AM, so this is NOT "today's events": until 2026-10-23 a card asked only
 *  while its date group was today, and an event running past midnight lost its clock at 00:00
 *  (owner: the Turning Stone NLH/PLO Mix, live in the WSOP app, showed none). */
export const CLOCK_ASK_WINDOW_MS = 18 * 60 * 60 * 1000;

/** Should a card ask for this event's clock? A live-room event (not online, not Personal) that has
 *  started within the window and is not already known to be complete. */
export function clockAskable(t, now = Date.now()) {
  if (!t || t.venue === 'Personal' || t.is_online || t.clock_ended_at) return false;
  const s = parseTournamentTime(t);
  return Number.isFinite(s) && s <= now && now - s < CLOCK_ASK_WINDOW_MS;
}

const POLL_MS = 15000;
const CHUNK = 40; // the server's per-call cap

const registry = new Map(); // id -> { n, lat, lng }
let clocks = {};
const listeners = new Set();
let timer = null;
let kickTimer = null;
let inFlight = false;
let again = false;

function emit() { for (const l of listeners) l(); }

async function pollOnce() {
  if (inFlight) { again = true; return; }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const list = [...registry].map(([id, v]) => ({ id, lat: v.lat, lng: v.lng, ...(Number.isFinite(v.startMs) ? { startMs: v.startMs } : {}) }));
  if (!list.length) return;
  inFlight = true;
  try {
    const next = { ...clocks };
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      const res = await fetchApi('/live-clocks', { method: 'POST', body: { events: chunk } });
      // Keep what we had, marked as not heard from since (App improvements 104); liveView says how stale.
      if (!res.ok) { const at = Date.now(); for (const { id } of chunk) if (next[id]) next[id] = { ...next[id], failedAt: at }; continue; }
      const { clocks: got } = await res.json();
      const receivedAt = Date.now();
      for (const { id } of chunk) {
        if (got && got[id]) next[id] = { ...got[id], receivedAt };
        else delete next[id];
      }
    }
    clocks = next;
    emit();
  } catch (_) {
    /* network blip: keep the last answers, marked as not heard from since */
    const at = Date.now();
    clocks = Object.fromEntries(Object.entries(clocks).map(([id, c]) => [id, { ...c, failedAt: at }]));
    emit();
  } finally {
    inFlight = false;
    if (again) { again = false; pollOnce(); }
  }
}

function syncLoop() {
  if (registry.size && !timer) timer = setInterval(pollOnce, POLL_MS);
  if (!registry.size && timer) { clearInterval(timer); timer = null; }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && registry.size) pollOnce();
  });
}

/** Start asking for an event's clock. Returns the matching unregister. */
export function registerClock(id, coords) {
  const cur = registry.get(id);
  if (cur) cur.n++;
  else {
    // startMs: the event's start, which tells flights of one event apart on Bravo (server side).
    registry.set(id, { n: 1, lat: coords?.lat, lng: coords?.lng, startMs: coords?.startMs });
    // A newly shown event gets its answer now, not up to 15 s later; a burst of cards mounting
    // together is coalesced into one request.
    clearTimeout(kickTimer);
    kickTimer = setTimeout(pollOnce, 250);
  }
  syncLoop();
  return () => {
    const c = registry.get(id);
    if (!c) return;
    if (--c.n <= 0) registry.delete(id);
    syncLoop();
  };
}

function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const snapshot = () => clocks;

/** Every clock answer, re-rendering when a poll lands. */
export function useClockStore() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Register a list of {id, lat, lng}. `key` must change whenever the list does. */
export function useLiveClocks(targets, key) {
  useEffect(() => {
    const offs = (targets || []).map((t) => registerClock(t.id, t));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useClockStore();
}

/** The clock while it is actually running (or paused) and can be timed, with `remaining` aged
 *  from when the answer arrived — only while it runs. Null for no clock, a clock that has not
 *  started, or one that reports no time; callers then keep their estimate. */
export function liveView(c, now = Date.now()) {
  if (!c || c.level == null || (c.state !== 'running' && c.state !== 'paused')) return null;
  if (c.remainingSecs == null) return null;
  const sinceS = (now - c.receivedAt) / 1000;
  const aged = c.state === 'running' ? sinceS : 0;
  // A clock that stopped answering (App improvements 104): its level ran out with no fresh answer, or polls
  // have failed for 2 minutes. Stale, it says so ("No signal", when it was last heard); older than the level
  // it described and one more, it is dropped and the card goes back to its estimate.
  const levelSecs = Number(c.levelSecs) || 0;
  if (c.state === 'running' && sinceS > c.remainingSecs + Math.max(levelSecs, 600)) return null;
  const stale = (c.state === 'running' && sinceS > c.remainingSecs + 30) || (!!c.failedAt && sinceS > 120);
  return { ...c, remaining: Math.max(0, Math.round(c.remainingSecs - aged)), stale, heardAt: c.receivedAt };
}

/** The field on the room's clock, for the card's live row: "187 left of 412", or whichever half the
 *  room publishes. Null when it publishes neither; a 0 means not reported yet, never an empty event.
 *  Nobody is out yet (left = entries), or a left above the entries, reads as the entries alone.
 *  Players left only once late reg is over (owner, 2026-11-05: `regOver`, see lateRegOver): before
 *  then the rooms' figure is not who is left. Measured the same day at Borgata on Bravo, the Deepstack's
 *  218 entries at Level 4 read 3 remaining, then 63 a few minutes later, rising. */
export function clockFieldLabel(c, regOver = false) {
  const entries = c && Number(c.entries) > 0 ? Number(c.entries) : null;
  const left = regOver && c && Number(c.playersLeft) > 0 ? Number(c.playersLeft) : null;
  const n = (v) => v.toLocaleString('en-US');
  if (entries && left && left < entries) return `${n(left)} left of ${n(entries)}`;
  if (entries) return `${n(entries)} ${entries === 1 ? 'entry' : 'entries'}`;
  return left ? `${n(left)} left` : null;
}

/** Has the room's clock shown this tournament finished? Either stored on the row (clock_ended_at,
 *  from the tournament list) or just reported by a poll (state 'ended'). */
export function isCompleted(t, c) {
  return !!(t && t.clock_ended_at) || !!(c && c.state === 'ended');
}

/** The room's own start time from a clock that has not started yet (PokerAtlas), or null. */
export function clockStartMs(c) {
  if (!c || c.state !== 'not-started' || !c.startsAt) return null;
  const ms = Date.parse(c.startsAt);
  return Number.isFinite(ms) ? ms : null;
}

function levelMinutes(t) {
  const m = String(t.level_duration || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** When late registration closes, from the real clock (ISO), or null to keep the event's own.
 *  PokerAtlas publishes the instant; Bravo does not, so it is counted forward from the current
 *  level to the event's late-reg level — the feed's number means "until the START of Level N"
 *  unless the notes say "end of"/"through". Levels ahead are timed at the event's level length;
 *  breaks between them are not published. */
export function clockRegEnd(t, live) {
  if (!live) return null;
  if (live.regEndsAt) return live.regEndsAt;
  const n = /^\s*(\d{1,2})\s*$/.exec(String(t.late_reg_end ?? ''));
  if (!n) return null;
  const closeAt = Number(n[1]) + (/(end of|through)\s*level/i.test(t.reentry || '') ? 1 : 0);
  const levelSecs = (levelMinutes(t) || 0) * 60 || (!live.onBreak && live.levelSecs) || null;
  // `remaining` runs to the start of level+1 whether a level or a break is on: during a break
  // Bravo keeps `level` at the level just played (JCIN Mini Main: "A" L4, then "B" L4).
  // Already closed: WHEN is unknown, and "a second ago" read as "0m left" on a bar whose own
  // clock refreshes every 30 s (seen 2026-09-29). An instant firmly in the past reads as closed.
  if (live.level >= closeAt) return new Date(0).toISOString();
  if (!levelSecs) return null;
  const secs = live.remaining + (closeAt - live.level - 1) * levelSecs;
  return new Date(Date.now() + secs * 1000).toISOString();
}

/** Is late registration known to be over, from the real clock first, then the event's own close?
 *  False when nobody can say: an unknown close never counts as closed. */
export function lateRegOver(t, live, now = Date.now()) {
  const end = clockRegEnd(t, live) || (t && t.late_reg_end);
  if (!end) return false;
  const ms = lateRegCloseOf(t, end);
  return !Number.isNaN(ms) && now > ms;
}

/** "17:04" / "1:02:30". */
export function fmtClock(secs) {
  const s = Math.max(0, Math.round(secs || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
