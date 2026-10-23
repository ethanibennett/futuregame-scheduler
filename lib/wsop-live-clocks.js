// WSOP+ ("WSOP Live") tournament clocks, the third provider behind lib/live-clocks.js.
//
// The WSOP+ app (iOS, GGPoker's Flutter client) is the only place the clocks of a WSOP-run series
// (Circuit stops, the summer WSOP, Paradise, Europe) can be read; Bravo and PokerAtlas have none of
// them. Reverse-engineered from the app's traffic on 2026-10-22 (a WireGuard capture of the Turning
// Stone Circuit stop); the protocol is written up in docs/wsop-live-clock.md.
//
//   REST   https://papi.wsopplus.com  — MessagePack bodies, one header `x-api-key` (the app's public
//          constant), NO login for anything used here:
//            GET /Series?hasActiveTicketOnly=false    every series the app lists, with venueName,
//                                                     city, timeZone, beginAt/endAt
//            GET /EventFlights?seriesId=<id>          every flight of a series (eventNo, fullName,
//                                                     startTime, status, entries, playersLeftCount…)
//            GET /EventFlights/<flightId>             one flight in full (flightStack, totalPrize,
//                                                     option.isHideClock, completedAt, lateRegClosedAt)
//            GET /EventFlights/<flightId>/BlindStructure   levels and breaks; blinds as a JSON string
//   Hub    https://psignal.wsopplus.com/AnonPlayerHub — a SignalR hub (MessagePack protocol), anonymous
//          with the same x-api-key. `Subscribe({"events":["AllTournament"],"seriesId":<id>})` is
//          answered at once with one `Clock` message per flight whose clock is running in the series.
//          Server frames are wrapped: 1 byte (1 = gzip) + uint32 LE length + the SignalR frame.
//
// The Clock message carries the level and the seconds left in it but NOT the blinds, which come
// from the flight's blind structure at the clock's levelIndex (an index into the structure list,
// breaks included). Nothing here throws: a failed or unrecognisable answer is null and the caller
// falls back (lib/live-clocks.js clockForEvent).

'use strict';

const zlib = require('zlib');

const WSOP_API = process.env.WSOP_API_BASE || 'https://papi.wsopplus.com';
const WSOP_HUB = process.env.WSOP_HUB_BASE || 'https://psignal.wsopplus.com/AnonPlayerHub';
// The app's public constant (every request of every user carries it; it is not a credential).
const WSOP_API_KEY = process.env.WSOP_API_KEY || 'vd0IjnDghYEGKTvTmI3f';
const WSOP_UA = 'Dart/3.13 (dart:io)';

const FETCH_TIMEOUT_MS = 8000;
const HUB_SETTLE_MS = 700;        // after the last Clock message, the burst is over
const HUB_TIMEOUT_MS = 6000;
const SERIES_TTL_MS = 6 * 60 * 60 * 1000;
const FLIGHTS_TTL_MS = 5 * 60 * 1000;
const DETAIL_TTL_MS = 60 * 1000;
const BLINDS_TTL_MS = 60 * 60 * 1000;
const CLOCKS_TTL_MS = 10 * 1000;

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ms = (s) => { const t = s ? Date.parse(String(s)) : NaN; return Number.isFinite(t) ? t : NaN; };

// ── MessagePack (the subset WSOP+ uses; no dependency) ───────────────────────

function decodeMsgpack(buf) {
  let i = 0;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const need = (n) => { if (i + n > b.length) throw new Error('msgpack: truncated'); };
  const str = (n) => { need(n); const s = b.toString('utf8', i, i + n); i += n; return s; };
  const bin = (n) => { need(n); const s = b.subarray(i, i + n); i += n; return Buffer.from(s); };
  const arr = (n) => { const a = new Array(n); for (let k = 0; k < n; k++) a[k] = read(); return a; };
  const map = (n) => { const o = {}; for (let k = 0; k < n; k++) { const key = read(); o[typeof key === 'string' ? key : String(key)] = read(); } return o; };
  const u = (n) => { need(n); let v = 0; for (let k = 0; k < n; k++) v = v * 256 + b[i + k]; i += n; return v; };
  function read() {
    need(1);
    const c = b[i++];
    if (c <= 0x7f) return c;
    if (c >= 0xe0) return c - 0x100;
    if ((c & 0xf0) === 0x80) return map(c & 0x0f);
    if ((c & 0xf0) === 0x90) return arr(c & 0x0f);
    if ((c & 0xe0) === 0xa0) return str(c & 0x1f);
    switch (c) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return bin(u(1));
      case 0xc5: return bin(u(2));
      case 0xc6: return bin(u(4));
      case 0xc7: { const n = u(1); i += 1; return bin(n); }
      case 0xc8: { const n = u(2); i += 1; return bin(n); }
      case 0xc9: { const n = u(4); i += 1; return bin(n); }
      case 0xca: { need(4); const v = b.readFloatBE(i); i += 4; return v; }
      case 0xcb: { need(8); const v = b.readDoubleBE(i); i += 8; return v; }
      case 0xcc: return u(1);
      case 0xcd: return u(2);
      case 0xce: return u(4);
      case 0xcf: { need(8); const v = b.readBigUInt64BE(i); i += 8; return Number(v); }
      case 0xd0: { need(1); const v = b.readInt8(i); i += 1; return v; }
      case 0xd1: { need(2); const v = b.readInt16BE(i); i += 2; return v; }
      case 0xd2: { need(4); const v = b.readInt32BE(i); i += 4; return v; }
      case 0xd3: { need(8); const v = b.readBigInt64BE(i); i += 8; return Number(v); }
      case 0xd4: i += 2; return null;  // fixext: not used by WSOP+, skipped
      case 0xd5: i += 3; return null;
      case 0xd6: i += 5; return null;
      case 0xd7: i += 9; return null;
      case 0xd8: i += 17; return null;
      case 0xd9: return str(u(1));
      case 0xda: return str(u(2));
      case 0xdb: return str(u(4));
      case 0xdc: return arr(u(2));
      case 0xdd: return arr(u(4));
      case 0xde: return map(u(2));
      case 0xdf: return map(u(4));
      default: throw new Error(`msgpack: unsupported byte 0x${c.toString(16)}`);
    }
  }
  const value = read();
  return { value, end: i };
}

function encodeMsgpack(v) {
  const parts = [];
  const push = (...bytes) => parts.push(Buffer.from(bytes));
  function write(x) {
    if (x === null || x === undefined) return push(0xc0);
    if (x === true) return push(0xc3);
    if (x === false) return push(0xc2);
    if (typeof x === 'number') {
      if (Number.isInteger(x)) {
        if (x >= 0 && x <= 0x7f) return push(x);
        if (x < 0 && x >= -32) return push(0x100 + x);
        if (x >= 0 && x <= 0xff) return push(0xcc, x);
        if (x >= 0 && x <= 0xffff) return push(0xcd, x >> 8, x & 0xff);
        if (x >= 0 && x <= 0xffffffff) { const b = Buffer.alloc(5); b[0] = 0xce; b.writeUInt32BE(x, 1); return parts.push(b); }
        const b = Buffer.alloc(9); b[0] = 0xd3; b.writeBigInt64BE(BigInt(x), 1); return parts.push(b);
      }
      const b = Buffer.alloc(9); b[0] = 0xcb; b.writeDoubleBE(x, 1); return parts.push(b);
    }
    if (typeof x === 'string') {
      const s = Buffer.from(x, 'utf8');
      if (s.length <= 31) push(0xa0 | s.length);
      else if (s.length <= 0xff) push(0xd9, s.length);
      else if (s.length <= 0xffff) push(0xda, s.length >> 8, s.length & 0xff);
      else { const b = Buffer.alloc(5); b[0] = 0xdb; b.writeUInt32BE(s.length, 1); parts.push(b); }
      return parts.push(s);
    }
    if (Array.isArray(x)) {
      if (x.length <= 15) push(0x90 | x.length);
      else push(0xdc, x.length >> 8, x.length & 0xff);
      for (const e of x) write(e);
      return;
    }
    if (typeof x === 'object') {
      const keys = Object.keys(x);
      if (keys.length <= 15) push(0x80 | keys.length);
      else push(0xde, keys.length >> 8, keys.length & 0xff);
      for (const k of keys) { write(k); write(x[k]); }
      return;
    }
    throw new Error(`msgpack: cannot encode ${typeof x}`);
  }
  write(v);
  return Buffer.concat(parts);
}

// ── SignalR framing ──────────────────────────────────────────────────────────

/** SignalR's binary framing: a varint byte length before each message. */
function signalrFrame(payload) {
  let n = payload.length;
  const head = [];
  do { let c = n & 0x7f; n >>>= 7; if (n) c |= 0x80; head.push(c); } while (n);
  return Buffer.concat([Buffer.from(head), payload]);
}

function splitSignalrFrames(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    let n = 0, shift = 0, c;
    do { c = buf[i++]; n |= (c & 0x7f) << shift; shift += 7; } while (c & 0x80 && i < buf.length);
    out.push(buf.subarray(i, i + n));
    i += n;
  }
  return out;
}

/** One WebSocket message from the WSOP+ hub → the decoded SignalR messages in it. Pure.
 *  WSOP+ wraps the server's frames (compressionType=gzip): byte 0 is 1 when the rest is gzipped,
 *  then a uint32 LE length, then standard SignalR MessagePack framing. The handshake answer and
 *  anything already starting with a JSON brace are passed as text. */
function decodeHubMessage(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buf.length) return [];
  if (buf[0] === 0x7b) { // '{' — the JSON handshake reply, "{}\x1e"
    try { return [JSON.parse(buf.toString('utf8').replace(/\x1e$/, ''))]; } catch (_) { return []; }
  }
  if (buf.length < 5) return [];
  const flag = buf[0];
  const len = buf.readUInt32LE(1);
  let body = buf.subarray(5, 5 + len);
  if (flag === 1) {
    try { body = zlib.gunzipSync(body); } catch (_) { return []; }
  }
  const out = [];
  for (const frame of splitSignalrFrames(body)) {
    try { out.push(decodeMsgpack(frame).value); } catch (_) { /* a frame we cannot read is skipped */ }
  }
  return out;
}

/** A non-blocking SignalR invocation (type 1, no invocation id), framed for the wire. */
function hubInvocation(target, ...args) {
  return signalrFrame(encodeMsgpack([1, {}, null, target, args]));
}

// ── transport (cached, never throws) ─────────────────────────────────────────

function makeCache(ttl) {
  const store = new Map();
  return async (key, load) => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.promise;
    const promise = Promise.resolve().then(load).catch(() => null);
    store.set(key, { at: Date.now(), promise });
    // A failure is not kept for the whole TTL: the next caller tries again.
    promise.then((v) => { if (v == null && store.get(key)?.promise === promise) store.delete(key); });
    if (store.size > 500) store.delete(store.keys().next().value);
    return promise;
  };
}
const seriesCache = makeCache(SERIES_TTL_MS);
const flightsCache = makeCache(FLIGHTS_TTL_MS);
const detailCache = makeCache(DETAIL_TTL_MS);
const blindsCache = makeCache(BLINDS_TTL_MS);
const clocksCache = makeCache(CLOCKS_TTL_MS);

async function getMsgpack(path) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${WSOP_API}${path}`, {
      headers: { accept: 'application/x-msgpack', 'x-api-key': WSOP_API_KEY, 'user-agent': WSOP_UA },
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const body = Buffer.from(await res.arrayBuffer());
    return decodeMsgpack(body).value;
  } finally {
    clearTimeout(timer);
  }
}

function fetchSeriesList() {
  return seriesCache('series', async () => {
    const o = await getMsgpack('/Series?hasActiveTicketOnly=false');
    return o && Array.isArray(o.seriesList) ? o.seriesList : null;
  });
}
function fetchFlights(seriesId) {
  return flightsCache(`flights:${seriesId}`, async () => {
    const o = await getMsgpack(`/EventFlights?seriesId=${encodeURIComponent(seriesId)}`);
    return o && Array.isArray(o.eventFlightList) ? o.eventFlightList : null;
  });
}
function fetchFlightDetail(flightId) {
  return detailCache(`detail:${flightId}`, async () => {
    const o = await getMsgpack(`/EventFlights/${encodeURIComponent(flightId)}`);
    return o && o.eventFlightId != null ? o : null;
  });
}
function fetchBlindStructure(flightId) {
  return blindsCache(`blinds:${flightId}`, async () => {
    const o = await getMsgpack(`/EventFlights/${encodeURIComponent(flightId)}/BlindStructure`);
    return o && Array.isArray(o.blindStructureDetailList) ? o.blindStructureDetailList : null;
  });
}

/** Every running clock in a series: Map<eventFlightId, Clock data>, or null when the hub did not
 *  answer. One short connection: negotiate, handshake, Subscribe, collect the burst, close. */
function fetchSeriesClocks(seriesId) {
  return clocksCache(`clocks:${seriesId}`, async () => {
    if (typeof WebSocket !== 'function') return null; // Node < 22
    const ctl = new AbortController();
    const t0 = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let neg, cookie = '';
    try {
      const res = await fetch(`${WSOP_HUB}/negotiate?compressionType=gzip&negotiateVersion=1`, {
        method: 'POST', body: '',
        headers: { 'x-api-key': WSOP_API_KEY, 'user-agent': WSOP_UA, 'content-type': 'text/plain;charset=UTF-8' },
        signal: ctl.signal,
      });
      if (!res.ok) return null;
      neg = await res.json();
      // The hub sits behind an AWS load balancer whose sticky cookie (AWSALB) ties the WebSocket to
      // the node that negotiated; without it the upgrade is refused (non-101).
      cookie = (res.headers.get('set-cookie') || '').split(/,(?=\s*\w+=)/).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
    } finally {
      clearTimeout(t0);
    }
    const token = neg && (neg.connectionToken || neg.connectionId);
    if (!token) return null;
    const url = `${WSOP_HUB.replace(/^http/, 'ws')}?compressionType=gzip&id=${encodeURIComponent(token)}`;
    return new Promise((resolve) => {
      const clocks = new Map();
      let ws, settle = null, handshook = false;
      const done = (v) => {
        clearTimeout(timer); clearTimeout(settle);
        try { ws && ws.close(); } catch (_) {}
        resolve(v);
      };
      const timer = setTimeout(() => done(clocks.size || handshook ? clocks : null), HUB_TIMEOUT_MS);
      try {
        // Node's WebSocket (undici) takes headers since 22.4; older builds ignore them, and the hub
        // then refuses (the key and the cookie are both required), which reads as "no answer".
        ws = new WebSocket(url, { headers: { 'x-api-key': WSOP_API_KEY, 'user-agent': WSOP_UA, ...(cookie ? { cookie } : {}) } });
      } catch (_) { return done(null); }
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws.send(`${JSON.stringify({ protocol: 'messagepack', version: 1 })}\x1e`);
      ws.onmessage = (e) => {
        const data = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : Buffer.from(e.data);
        for (const m of decodeHubMessage(data)) {
          if (!handshook) {
            // The handshake reply is "{}" (an error carries { error }).
            if (m && typeof m === 'object' && !Array.isArray(m)) {
              if (m.error) return done(null);
              handshook = true;
              ws.send(hubInvocation('Subscribe', JSON.stringify({ events: ['AllTournament'], seriesId: Number(seriesId) })));
            }
            continue;
          }
          if (!Array.isArray(m) || m[0] !== 1 || m[3] !== 'Clock') continue;
          const payload = Array.isArray(m[4]) ? m[4][0] : null;
          const d = payload && payload.data;
          if (d && d.eventFlightId != null) {
            clocks.set(Number(d.eventFlightId), { ...d, receivedAt: Date.now() });
            clearTimeout(settle);
            settle = setTimeout(() => done(clocks), HUB_SETTLE_MS);
          }
        }
        // Subscribed but nothing running: the hub sends no Clock at all, so settle on the ack silence.
        if (handshook && !settle) settle = setTimeout(() => done(clocks), HUB_SETTLE_MS * 2);
      };
      ws.onerror = () => done(clocks.size ? clocks : null);
      ws.onclose = () => done(handshook ? clocks : null);
    });
  });
}

// ── matching (pure) ──────────────────────────────────────────────────────────

const STOP = new Set(['the', 'and', 'of', 'event', 'day', 'flight', 'gtd', 'guaranteed', 'tournament',
  'casino', 'poker', 'room', 'series', 'resort', 'hotel', 'wsop', 'wsopc', 'circuit', 'side', 'satellite']);
/** WSOP+ spells games out ("No-Limit Hold'em", "Pot-Limit Omaha 8 or Better"); the feed abbreviates
 *  them (NLH, PLO8). One spelling before tokenising, so the words can meet. */
function canon(s) {
  return String(s || '').toLowerCase()
    .replace(/no[\s-]*limit\s+hold\s*'?em/g, ' nlh ').replace(/\bnl\s*hold\s*'?em\b/g, ' nlh ').replace(/\bnl\s*he?\b/g, ' nlh ')
    .replace(/pot[\s-]*limit\s+omaha(\s+(8|hi[\s-]*lo|8\s*or\s*better))?/g, (m, g1, g2) => (g2 ? ' plo8 ' : ' plo '))
    .replace(/\bplo\s*8\s*(or\s*better|\/b|hi[\s-]*lo)?\b/g, ' plo8 ').replace(/\bomaha\s*8\b/g, ' plo8 ')
    .replace(/\bhold\s*'?em\b/g, ' holdem ');
}
function tokens(s) {
  return new Set(canon(s)
    .replace(/\$[\d,.]+k?/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => w && !/^\d+$/.test(w) && !STOP.has(w)));
}
function overlap(a, b) {
  const A = tokens(a), B = tokens(b);
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n;
}

const SERIES_SLACK_MS = 36 * 3600 * 1000;

/** The WSOP+ series this event is part of, or null. Pure.
 *  Needs the room (`property`, the feed's PokerAtlas room name) to share its distinctive words
 *  with the series' venueName — "Turning Stone Casino" ↔ "Turning Stone Resort Casino" — and the
 *  event's date (or now) to fall in the series' window. The series title is a second chance for a
 *  feed whose property is empty. */
function pickWsopSeries(seriesList, event, now = Date.now()) {
  if (!Array.isArray(seriesList) || !event) return null;
  const when = Number.isFinite(event.startMs) ? event.startMs : now;
  let best = null, bestScore = 0, tie = false;
  for (const s of seriesList) {
    if (!s || !s.venueName) continue;
    const begin = ms(s.beginAt), end = ms(s.endAt);
    if (Number.isFinite(begin) && when < begin - SERIES_SLACK_MS) continue;
    if (Number.isFinite(end) && when > end + SERIES_SLACK_MS) continue;
    const venueWords = tokens(s.venueName).size;
    if (!venueWords) continue;
    const byRoom = overlap(event.property, s.venueName);
    const byTitle = overlap(event.venue, s.venueName);
    const hit = Math.max(byRoom, byTitle);
    // Every distinctive word of the shorter name must be in the other: "Turning Stone" alone is
    // enough, "Caesars" alone is not (there are several Caesars).
    const shorter = Math.min(venueWords, tokens(byRoom >= byTitle ? event.property : event.venue).size || venueWords);
    if (hit < Math.max(1, Math.min(2, shorter))) continue;
    if (hit > bestScore) { best = s; bestScore = hit; tie = false; } else if (hit === bestScore) tie = true;
  }
  return tie ? null : best;
}

/** The flight's suffix as the feed would write it: "Day1A" → { day: 1, letter: 'A' }, "Day2" →
 *  { day: 2 }, "Final Day" → { final: true }. */
function flightSuffix(fullName) {
  const m = /-\s*(?:day\s*(\d+)\s*([a-z])?|(final)\s*day)\s*$/i.exec(String(fullName || ''));
  if (!m) return {};
  if (m[3]) return { final: true };
  return { day: Number(m[1]), letter: m[2] ? m[2].toUpperCase() : null };
}
function eventSuffix(name) {
  const m = /-\s*(?:flight\s*([a-z])|day\s*(\d+)\s*([a-z])?)\s*$/i.exec(String(name || ''));
  if (!m) return {};
  if (m[1]) return { day: 1, letter: m[1].toUpperCase() };
  return { day: Number(m[2]), letter: m[3] ? m[3].toUpperCase() : null };
}
function leadingNumber(s) {
  const m = /^\s*0*(\d{1,3})(?:\D|$)/.exec(String(s || ''));
  return m ? Number(m[1]) : null;
}
function hashNumber(s) {
  const m = /#\s*0*(\d{1,3})\b/.exec(String(s || ''));
  return m ? Number(m[1]) : null;
}

const SAME_START_MS = 3 * 3600 * 1000;
const DAILY_START_MS = 90 * 60 * 1000;

/** Do the two buy-ins agree? Unknown on either side agrees; otherwise within 10% (fees are
 *  sometimes in one figure and not the other). */
function buyinAgrees(a, b) {
  const x = num(a), y = num(b);
  if (!x || !y) return true;
  return Math.abs(x - y) <= Math.max(x, y) * 0.1 + 1;
}

/** The WSOP+ flight this feed event is, or null. Pure.
 *  Numbered events ("9-293160-20261023" ↔ "#9: … - Day1B") match by number, then the flight by its
 *  suffix (Flight B ↔ Day1B, Day 2 ↔ Day2 or Final Day) or, failing that, by the nearest start
 *  within 3 h of the event's own (opts.startMs). An unnumbered daily ("PA-…", "NLH Cash Survivor")
 *  is taken only when exactly one flight starting within 90 min, with an agreeing buy-in, shares the
 *  most name words with it (checked 2026-10-23 on Turning Stone's dailies: three Cash Survivors a
 *  day at different prices, the Nightly, the Landmark Mega satellites). */
function matchWsopFlight(event, flights, { startMs = NaN } = {}) {
  if (!event || !Array.isArray(flights) || !flights.length) return null;
  const n = leadingNumber(event.event_number);
  const near = (f) => {
    const t = ms(f.startTime);
    return !Number.isFinite(startMs) || !Number.isFinite(t) ? Infinity : Math.abs(t - startMs);
  };
  const nearest = (cands) => {
    if (!cands.length) return null;
    if (!Number.isFinite(startMs)) return cands.length === 1 ? cands[0] : null;
    const within = cands.filter((f) => near(f) <= SAME_START_MS);
    if (!within.length) return null;
    within.sort((a, b) => near(a) - near(b));
    return within[0];
  };
  if (n != null) {
    let cands = flights.filter((f) => Number(f.eventNo) === n || hashNumber(f.fullName) === n);
    if (!cands.length) return null;
    if (cands.length === 1) return near(cands[0]) <= SAME_START_MS * 8 ? cands[0] : null;
    const want = eventSuffix(event.event_name);
    if (want.day != null) {
      const bySuffix = cands.filter((f) => {
        const s = flightSuffix(f.fullName);
        if (s.final) return want.day >= 2;
        if (s.day !== want.day) return false;
        return want.letter ? s.letter === want.letter : !s.letter;
      });
      if (bySuffix.length === 1 && near(bySuffix[0]) <= SAME_START_MS * 8) return bySuffix[0];
      if (bySuffix.length > 1) cands = bySuffix;
    }
    return nearest(cands);
  }
  // Unnumbered: a daily or a satellite. Name words decide, among the flights starting near it at
  // its price.
  if (!Number.isFinite(startMs)) return null;
  const close = flights.filter((f) => near(f) <= DAILY_START_MS && buyinAgrees(event.buyin, f.buyIn));
  let best = [], bestScore = 0;
  for (const f of close) {
    const score = overlap(event.event_name, f.fullName);
    if (score > bestScore) { best = [f]; bestScore = score; } else if (score === bestScore && score > 0) best.push(f);
  }
  return bestScore > 0 && best.length === 1 ? best[0] : null;
}

// ── normalise (pure) ─────────────────────────────────────────────────────────

/** A structure row's blinds: the blindJson's keys are prefixed by the game ("nlHoldemSmallBlind",
 *  "ploBigBlind", "limitHoldemAnte"…), so the suffix is what is read. */
function blindsOf(row) {
  if (!row || !row.blindJson) return { sb: null, bb: null, ante: null };
  let o;
  try { o = typeof row.blindJson === 'string' ? JSON.parse(row.blindJson) : row.blindJson; } catch (_) { return { sb: null, bb: null, ante: null }; }
  const find = (suffix) => {
    for (const k of Object.keys(o)) if (k.toLowerCase().endsWith(suffix.toLowerCase())) return num(o[k]);
    return null;
  };
  return { sb: find('SmallBlind'), bb: find('BigBlind'), ante: find('Ante') || null };
}

/** The structure row the clock is on: the levelIndex first (the app's own pointer), checked
 *  against the level and type, else the first row with that level and type. */
function structureRowAt(structure, clock) {
  if (!Array.isArray(structure) || !structure.length) return { row: null, index: -1 };
  const idx = num(clock.levelIndex);
  const lvl = num(clock.level), type = num(clock.type) ?? 0;
  if (idx != null && structure[idx] && (lvl == null || num(structure[idx].level) === lvl) && (num(structure[idx].type) ?? 0) === type) {
    return { row: structure[idx], index: idx };
  }
  const i = structure.findIndex((r) => num(r.level) === lvl && (num(r.type) ?? 0) === type);
  return i >= 0 ? { row: structure[i], index: i } : { row: null, index: -1 };
}

/** One hub Clock `data` (+ the flight's structure and detail) → the normalised clock. Pure.
 *  Verified against two running flights (Turning Stone, 2026-10-22 23:24Z): `duration` is the
 *  seconds left in the level at `serverTime` (1559 → 1524 over 35 s), `levelDuration` is minutes,
 *  `type` 0 is a level and 1 a break (as in the structure), `levelIndex` indexes the structure
 *  list with breaks counted, `level` is the printed level. A paused clock carries pauseStartTime. */
function normalizeWsopClock(clock, { structure = null, detail = null, flight = null, now = Date.now() } = {}) {
  if (!clock || typeof clock !== 'object' || clock.eventFlightId == null) return null;
  const info = detail || flight || {};
  if (info.option && info.option.isHideClock === true) return null; // the room hides this clock
  const name = info.fullName || `WSOP flight ${clock.eventFlightId}`;
  if (info.completedAt) return { source: 'wsop', name, state: 'ended', fetchedAt: now };

  const started = clock.isStarted === true;
  const paused = started && !!clock.pauseStartTime;
  const state = !started ? 'not-started' : paused ? 'paused' : 'running';
  const onBreak = num(clock.type) === 1;
  const serverAt = ms(clock.serverTime);
  const asOf = Number.isFinite(serverAt) ? serverAt : (clock.receivedAt || now);
  let remainingSecs = num(clock.duration);
  if (remainingSecs != null && state === 'running') remainingSecs = Math.max(0, remainingSecs - (now - asOf) / 1000);

  const { row, index } = structureRowAt(structure, clock);
  const cur = blindsOf(onBreak ? null : row);
  // Next level: the first level row after this one; minutes to the next break: this level's rest
  // plus every level before the next break row.
  let nextBlinds = null, nextAnte = null, minsToBreak = null;
  if (index >= 0) {
    const nextLevel = structure.slice(index + 1).find((r) => (num(r.type) ?? 0) === 0);
    if (nextLevel) {
      const nb = blindsOf(nextLevel);
      if (nb.sb != null && nb.bb != null) nextBlinds = `${nb.sb.toLocaleString('en-US')} - ${nb.bb.toLocaleString('en-US')}`;
      nextAnte = nb.ante;
    }
    if (!onBreak && started) {
      let secs = remainingSecs ?? 0, found = false;
      for (const r of structure.slice(index + 1)) {
        if ((num(r.type) ?? 0) === 1) { found = true; break; }
        secs += (num(r.duration) ?? 0) * 60;
      }
      if (found) minsToBreak = Math.round(secs / 60);
    }
  }
  const levelSecs = num(clock.levelDuration) != null ? num(clock.levelDuration) * 60 : (row ? (num(row.duration) ?? 0) * 60 : null);
  const playersLeft = num(info.playersLeftCount);
  const stack = num(info.flightStack);
  const hideMoney = info.option && info.option.isHideChipsPrize === true;
  const regEnd = ms(clock.lateRegEndTime);
  return {
    source: 'wsop',
    name,
    state,
    onBreak,
    level: num(clock.level),
    sb: cur.sb,
    bb: cur.bb,
    ante: cur.ante,
    levelSecs,
    remainingSecs: started ? remainingSecs : null,
    fetchedAt: now,
    nextBlinds,
    nextAnte,
    minsToBreak,
    entries: num(info.entries) ?? num(info.clockEntries) ?? num(info.totalEntries),
    playersLeft,
    avgStack: !hideMoney && stack && playersLeft ? Math.round(stack / playersLeft) : null,
    prizePool: hideMoney ? null : (num(info.flightPrize) || num(info.totalPrize) || null),
    regEndsAt: Number.isFinite(regEnd) ? new Date(regEnd).toISOString() : (info.lateRegClosedAt || null),
    startsAt: info.startTime || null,
    flightId: Number(clock.eventFlightId),
  };
}

// ── the provider ─────────────────────────────────────────────────────────────

/** { clock, answered, matched } for one feed event.
 *  matched: a WSOP+ series AND flight were found for it, so the caller should not try another
 *  provider (a Bravo "no clock" after a hub failure would end the event). Not matched: nothing
 *  here concerns this event, try the next provider. */
async function wsopClockForEvent(t, startMs = NaN) {
  const none = { clock: null, answered: false, matched: false };
  if (!t || !(t.property || t.venue)) return none;
  const seriesList = await fetchSeriesList();
  if (!seriesList) return none;
  const series = pickWsopSeries(seriesList, { property: t.property, venue: t.venue, startMs });
  if (!series) return none;
  const flights = await fetchFlights(series.id);
  if (!flights) return none;
  const flight = matchWsopFlight(t, flights, { startMs });
  if (!flight) return none;
  const clocks = await fetchSeriesClocks(series.id);
  if (!clocks) return { clock: null, answered: false, matched: true };
  const clock = clocks.get(Number(flight.eventFlightId));
  if (!clock) {
    // No running clock: finished, or not yet started. The flight list says which.
    const detail = await fetchFlightDetail(flight.eventFlightId);
    const info = detail || flight;
    if (info.completedAt) return { clock: { source: 'wsop', name: info.fullName, state: 'ended', fetchedAt: Date.now() }, answered: true, matched: true };
    return { clock: null, answered: true, matched: true };
  }
  const [structure, detail] = await Promise.all([fetchBlindStructure(flight.eventFlightId), fetchFlightDetail(flight.eventFlightId)]);
  return { clock: normalizeWsopClock(clock, { structure, detail, flight }), answered: true, matched: true };
}

/** For the admin probe: can this host reach the REST API and the hub? Counts only. */
async function probeWsop(seriesId = null) {
  const t0 = Date.now();
  const list = await fetchSeriesList();
  const out = { series: Array.isArray(list) ? list.length : null, ms: Date.now() - t0 };
  const id = seriesId || (Array.isArray(list) && list[0] ? list[0].id : null);
  if (id != null) {
    const t1 = Date.now();
    const clocks = await fetchSeriesClocks(id);
    out.hub = { seriesId: id, ok: !!clocks, clocks: clocks ? clocks.size : null, ms: Date.now() - t1 };
  }
  return out;
}

module.exports = {
  wsopClockForEvent, probeWsop,
  // pure, exported for tests
  decodeMsgpack, encodeMsgpack, decodeHubMessage, hubInvocation, signalrFrame,
  pickWsopSeries, matchWsopFlight, normalizeWsopClock, flightSuffix, eventSuffix, blindsOf,
  // the fetchers, for a live probe
  fetchSeriesList, fetchFlights, fetchFlightDetail, fetchBlindStructure, fetchSeriesClocks,
};
