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

import { useEffect, useState, useSyncExternalStore } from 'react';
import { fetchApi } from './api.js';

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
  const list = [...registry].map(([id, v]) => ({ id, lat: v.lat, lng: v.lng }));
  if (!list.length) return;
  inFlight = true;
  try {
    const next = { ...clocks };
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      const res = await fetchApi('/live-clocks', { method: 'POST', body: { events: chunk } });
      if (!res.ok) continue; // keep what we had; the estimate covers a clock we never got
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
    /* network blip: keep the last answers */
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
    registry.set(id, { n: 1, lat: coords?.lat, lng: coords?.lng });
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

/** Re-render every second while `active` — for a countdown that is actually ticking. */
export function useSecondTick(active) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

/** The clock while it is actually running (or paused) and can be timed, with `remaining` aged
 *  from when the answer arrived — only while it runs. Null for no clock, a clock that has not
 *  started, or one that reports no time; callers then keep their estimate. */
export function liveView(c) {
  if (!c || c.level == null || (c.state !== 'running' && c.state !== 'paused')) return null;
  if (c.remainingSecs == null) return null;
  const aged = c.state === 'running' ? (Date.now() - c.receivedAt) / 1000 : 0;
  return { ...c, remaining: Math.max(0, Math.round(c.remainingSecs - aged)) };
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
  if (live.level >= closeAt) return new Date(Date.now() - 1000).toISOString();
  if (!levelSecs) return null;
  const secs = live.remaining + (closeAt - live.level - 1) * levelSecs;
  return new Date(Date.now() + secs * 1000).toISOString();
}

/** "17:04" / "1:02:30". */
export function fmtClock(secs) {
  const s = Math.max(0, Math.round(secs || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
