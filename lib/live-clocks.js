// Live tournament clocks: the dashboard reads these in place of estimateBlindLevel().
//
// Two providers, both reverse-engineered from their iOS apps on 2026-09-29 and written up in
// mtt-series-watcher: docs/bravo-tournaments-blocker.md and docs/pokeratlas-clock.md.
//
//   PokerAtlas (TableCaptain)  wss://tourn-clock.pokeratlas.com/, one "Instance" query by tc_id.
//                              An event carries its tc_id as tournaments.clock_ref = 'pa:<tc_id>'.
//   Bravo                      POST www.bravopokerlive.com:2083/AmazonEC2BPL.svc/GetClocksByCasinoDetailID
//                              {mgmtID:'x', casinoID}: every clock running in that room. Events do not
//                              carry a Bravo id, so the room is found from the venue's coordinates and
//                              the event matched to a clock by event number, then by name.
//
// Neither needs a login. Both are cached ~10 s per clock/room, so any number of dashboards costs
// one upstream request per clock per 10 s. Everything here is total: a failed or unrecognisable
// answer is null, and the dashboard falls back to its estimate.
//
// The normalised clock (what /api/live-clocks returns per event):
//   { source, name, state, onBreak, level, sb, bb, ante, levelSecs, remainingSecs, fetchedAt,
//     nextBlinds, nextAnte, minsToBreak, entries, playersLeft, avgStack, prizePool, regEndsAt }
// remainingSecs is correct AT fetchedAt (server epoch ms); a client counts down from there only
// while state === 'running'.

'use strict';

const BRAVO_BASE = 'https://www.bravopokerlive.com:2083/AmazonEC2BPL.svc/';
const BRAVO_ROSTER = 'https://bravopokerlive.appspot.com/service/getcasinolistbylocation';
const BRAVO_APIKEY = '11111111111'; // public app constant (docs/bravo-decryption.md)
const BRAVO_UA = 'App/417 (iPhone; iOS 27.2; Scale/3.00)';
const PA_CLOCK_WS = 'wss://tourn-clock.pokeratlas.com/';

const CLOCK_TTL_MS = 10 * 1000;
const ROSTER_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
/** Bravo stamps UTC without an offset ("2026-09-29T22:10:03.211622"). */
const utcMs = (s) => {
  if (!s) return NaN;
  const t = String(s).trim();
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
};

// ── Bravo ────────────────────────────────────────────────────────────────────

/** One Bravo clock object → the normalised clock. Pure. */
function normalizeBravoClock(c, now = Date.now()) {
  if (!c || typeof c !== 'object' || !c.TName) return null;
  const state = c.ClockState === 'R' ? 'running' : c.ClockState === 'P' ? 'paused' : 'unknown';
  // LevelRemainingSecs holds at WebTime, the venue workstation's last report (it stays constant
  // across requests until the next report). Carry it forward to now while the clock runs.
  const asOf = utcMs(c.WebTime);
  const reported = num(c.LevelRemainingSecs);
  let remainingSecs = reported;
  if (reported != null && state === 'running' && Number.isFinite(asOf) && asOf <= now) {
    remainingSecs = Math.max(0, reported - (now - asOf) / 1000);
  }
  const show = (flag) => String(flag).toLowerCase() !== 'false';
  return {
    source: 'bravo',
    name: String(c.TName),
    state,
    // "A" is a playing level, "B" a break: the one "B" captured (JCIN PLO, level 12, MinsToBreak 0,
    // a 30-minute level at 18:10 local) is its dinner break. INFERRED from that one sample.
    onBreak: c.LevelType === 'B',
    level: num(c.LevelCurrent),
    sb: num(c.SmallBlind),
    bb: num(c.BigBlind),
    ante: num(c.Ante) || null,
    levelSecs: num(c.LevelTotalSecs),
    remainingSecs,
    fetchedAt: now,
    nextBlinds: str(c.NextBlinds),
    nextAnte: num(c.NextAnte) || null,
    minsToBreak: num(c.MinsToBreak),
    entries: num(c.NumEntrants),
    playersLeft: num(c.NumRemaining),
    avgStack: show(c.ShowAverageChips) ? num(c.AverageChips) : null,
    prizePool: show(c.ShowPrizePool) ? num(c.PrizePool) : null,
    regEndsAt: null, // Bravo's clock does not publish it; the client derives it from the level
  };
}

/** The event number a name or event_number carries: "Event #06" → 6, "6-293602-20260929" → 6. */
function eventNumberOf(s, { leading = false } = {}) {
  if (!s) return null;
  const m = leading ? String(s).match(/^\s*0*(\d{1,3})(?:\D|$)/) : String(s).match(/(?:#|\bevent\s*)\s*0*(\d{1,3})\b/i);
  return m ? Number(m[1]) : null;
}

const STOP = new Set(['the', 'and', 'of', 'event', 'day', 'flight', 'gtd', 'guaranteed', 'tournament',
  'casino', 'poker', 'room', 'series', 'classic', 'championship', 'k', 'x']);
function tokens(s) {
  return new Set(String(s || '').toLowerCase()
    .replace(/\$[\d,.]+k?/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => w && !/^\d+$/.test(w) && !STOP.has(w)));
}
function overlap(a, b) {
  const A = tokens(a), B = tokens(b);
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n;
}

/** Pick the Bravo clock that belongs to this event, or null. Pure.
 *  The event number decides when both sides have one (HRFC "Event #06" ↔ feed "6-293602-…").
 *  Without one, a clock is taken only if it alone shares a game word with the event's name, so a
 *  daily is never shown another event's clock. */
function matchBravoClock(event, clocks) {
  if (!Array.isArray(clocks) || !clocks.length) return null;
  const evNum = eventNumberOf(event.event_number, { leading: true }) ?? eventNumberOf(event.event_name);
  if (evNum != null) {
    const byNum = clocks.filter((c) => eventNumberOf(c.TName) === evNum);
    if (byNum.length === 1) return byNum[0];
    if (byNum.length > 1) return byNum.sort((a, b) => overlap(event.event_name, b.TName) - overlap(event.event_name, a.TName))[0];
    // The event has a number and no clock carries it: a different event is running.
    if (clocks.some((c) => eventNumberOf(c.TName) != null)) return null;
  }
  // An unnumbered event (a daily, a satellite) never takes a numbered series event's clock: on
  // 2026-09-29 "NLH Main Event Satellite" otherwise matched "Event #04 Mini Main" on "main".
  const isSat = (s) => /\bsat(ellite)?s?\b|\bstep\b/i.test(String(s || ''));
  const eligible = clocks.filter((c) =>
    (evNum != null || eventNumberOf(c.TName) == null) && isSat(c.TName) === isSat(event.event_name));
  const scored = eligible.map((c) => ({ c, s: overlap(event.event_name, c.TName) })).filter((x) => x.s > 0);
  if (scored.length === 1) return scored[0].c;
  if (scored.length > 1) {
    scored.sort((a, b) => b.s - a.s);
    return scored[0].s > scored[1].s ? scored[0].c : null;
  }
  return null;
}

function nameScore(a, b) { return overlap(a, b); }

/** The Bravo room for a venue: the nearest casino in Bravo's roster within 3 miles, preferring one
 *  whose name shares words with the property's when several are close. Pure over the roster. */
function pickBravoCasino(roster, property) {
  if (!Array.isArray(roster)) return null;
  const near = roster
    .filter((c) => c && c.casinoID && !c.hiddenFromList && Number(c.distance) <= 3)
    .sort((a, b) => Number(a.distance) - Number(b.distance));
  if (!near.length) return null;
  if (property) {
    const named = near.filter((c) => nameScore(property, c.description || c.shortName) > 0);
    if (named.length) return named[0];
  }
  return Number(near[0].distance) <= 1 ? near[0] : null;
}

// ── PokerAtlas ───────────────────────────────────────────────────────────────

/** "00:12:34" / "12:34" / 754 → seconds. */
function hmsToSecs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const parts = String(v).trim().split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return num(v);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** One TableCaptain clock Data object → the normalised clock. Pure. */
function normalizePaClock(d, now = Date.now()) {
  if (!d || typeof d !== 'object' || !d.Name) return null;
  const level = num(d.CurrentLevel);
  const started = level != null;
  const levelEnd = utcMs(d.LevelEndDateTime);
  const serverNow = utcMs(d.ServerTime);
  let remainingSecs = hmsToSecs(d.RemainingTime);
  // Prefer the level's end instant: it does not age while the answer is in flight or cached.
  if (Number.isFinite(levelEnd)) remainingSecs = Math.max(0, (levelEnd - (Number.isFinite(serverNow) ? serverNow : now)) / 1000);
  const type = String(d.LevelType || '').toLowerCase();
  const status = num(d.Status);
  const state = !started ? 'not-started' : status === 2 ? 'paused' : status === 3 ? 'ended' : 'running';
  const hidePay = d.HidePayoutsOnClock === true;
  return {
    source: 'pokeratlas',
    name: String(d.Name),
    state,
    onBreak: /break/.test(type) || /break/i.test(String(d.LevelName || '')),
    level,
    sb: num(d.LevelSmallBlind),
    bb: num(d.LevelBigBlind),
    ante: num(d.LevelAnte) || null,
    levelSecs: hmsToSecs(d.LevelDuration),
    remainingSecs: started ? remainingSecs : null,
    fetchedAt: now,
    nextBlinds: str(d.NextSmallBlind10K) && str(d.NextBigBlind10K) ? `${d.NextSmallBlind10K} - ${d.NextBigBlind10K}` : null,
    nextAnte: null,
    minsToBreak: (() => {
      const nb = utcMs(d.NextBreakTime);
      return started && Number.isFinite(nb) && Number.isFinite(serverNow) && nb > serverNow ? Math.round((nb - serverNow) / 60000) : null;
    })(),
    entries: num(d.Entries),
    playersLeft: num(d.EntriesRemaining),
    avgStack: num(d.ChipsAverage),
    prizePool: hidePay ? null : num(d.TotalPrizePool),
    regEndsAt: (() => {
      const t = utcMs(d.RegistrationEndTime);
      return Number.isFinite(t) ? new Date(t).toISOString() : null;
    })(),
    // The clock's own start, which the room can move off the published schedule. Before the start
    // the dashboard counts down to this rather than to the scheduled time.
    startsAt: (() => {
      const t = utcMs(d.StartTime);
      return Number.isFinite(t) ? new Date(t).toISOString() : null;
    })(),
  };
}

// ── transport (cached, never throws) ─────────────────────────────────────────

function makeCache(ttl) {
  const store = new Map();
  return async (key, load) => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.promise;
    const promise = Promise.resolve().then(load).catch(() => null);
    store.set(key, { at: Date.now(), promise });
    if (store.size > 500) store.delete(store.keys().next().value);
    return promise;
  };
}
const clockCache = makeCache(CLOCK_TTL_MS);
const rosterCache = makeCache(ROSTER_TTL_MS);

async function postJson(url, body, headers) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function fetchBravoClocks(casinoID) {
  return clockCache(`bravo:${casinoID}`, async () => {
    const arr = await postJson(`${BRAVO_BASE}GetClocksByCasinoDetailID`,
      JSON.stringify({ mgmtID: 'x', casinoID }),
      { accept: 'application/json', 'content-type': 'application/json', 'user-agent': BRAVO_UA });
    return Array.isArray(arr) ? arr : null;
  });
}

function fetchBravoRoster(lat, lng) {
  // ~100 m buckets: every event at one room shares one roster lookup.
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  return rosterCache(key, async () => {
    const arr = await postJson(BRAVO_ROSTER, `apikey=${BRAVO_APIKEY}&lat=${lat}&lon=${lng}&mile=3`,
      { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': BRAVO_UA });
    return Array.isArray(arr) ? arr : null;
  });
}

function fetchPaClock(tcId) {
  return clockCache(`pa:${tcId}`, () => new Promise((resolve) => {
    if (typeof WebSocket !== 'function') return resolve(null); // Node < 22
    let ws;
    const done = (v) => { clearTimeout(timer); try { ws && ws.close(); } catch (_) {} resolve(v); };
    const timer = setTimeout(() => done(null), FETCH_TIMEOUT_MS);
    try {
      ws = new WebSocket(PA_CLOCK_WS);
    } catch (_) { return done(null); }
    const id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).toUpperCase();
    ws.onopen = () => ws.send(JSON.stringify({
      Msg_ObjectId: '', Msg_ClientId: id, Msg_Type: 'Query', Msg_ActionId: tcId,
      Msg_Created: new Date().toISOString(), Msg_SourceId: id, Msg_Action: 'Instance',
    }));
    ws.onmessage = (e) => {
      try {
        const o = JSON.parse(String(e.data));
        if (o.Msg_ActionId && o.Msg_ActionId !== tcId) return;
        const r = Array.isArray(o.Results) ? o.Results[0] : null;
        done(r && r.Data ? (typeof r.Data === 'string' ? JSON.parse(r.Data) : r.Data) : null);
      } catch (_) { done(null); }
    };
    ws.onerror = () => done(null);
    ws.onclose = () => done(null);
  }));
}

/** The live clock for one tournament row, or null. `coords` is {lat, lng} for the venue. */
async function clockForEvent(t, coords) {
  const ref = str(t.clock_ref);
  if (ref && ref.startsWith('pa:')) {
    const d = await fetchPaClock(ref.slice(3));
    return d ? normalizePaClock(d) : null;
  }
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return null;
  const roster = await fetchBravoRoster(coords.lat, coords.lng);
  const casino = pickBravoCasino(roster, t.property);
  if (!casino) return null;
  const clocks = await fetchBravoClocks(casino.casinoID);
  const hit = matchBravoClock(t, clocks);
  return hit ? normalizeBravoClock(hit) : null;
}

module.exports = {
  clockForEvent,
  // pure, exported for tests
  normalizeBravoClock, normalizePaClock, matchBravoClock, pickBravoCasino, eventNumberOf,
};
