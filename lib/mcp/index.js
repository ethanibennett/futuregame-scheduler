'use strict';
/*
 * The app's MCP server (owner, 2026-10-23: "an MCP so that I can use Claude chat to communicate with the
 * app"): claude.ai's custom connectors speak MCP over Streamable HTTP, so this mounts one on the app
 * itself, and every tool is a thin call on the app's own REST API, made as the owner.
 *
 *   URL     https://futurega.me/mcp/<MCP_TOKEN>    (POST = the MCP request; stateless, one transport
 *           per request, JSON responses, no session). The connector is added in claude.ai under
 *           Settings > Connectors > Add custom connector, with that URL and no authentication: the
 *           secret is the path, the way a backer page's is (claude.ai cannot send a custom header
 *           without an OAuth server, which this is not — docs/mcp.md says what that would take).
 *   auth    MCP_TOKEN (MCP_TOKEN_PREVIOUS accepted inbound, for rotation), the constant-time check
 *           every shared secret here gets (lib/shared-token.js). Unset = the route is OFF and every
 *           call is a 404; a wrong token is a 404 too, so nothing says whether the route exists.
 *           60 requests a minute per IP. The token never appears in a log line.
 *   as whom The console owner (HAM_OWNER_ID): a short-lived JWT is minted per call and the tools go
 *           through http://127.0.0.1:PORT/api/... like any client, so every route's own checks,
 *           side effects (growth, buddies, saves) and figures apply unchanged.
 *   tools   find_events, my_schedule, add_to_schedule, remove_from_schedule, live_clock,
 *           bankroll_summary, recent_results, backers. Reads, plus the schedule's add/remove; money
 *           is never written here (a result or a settlement stays a press in the app).
 *           `backers` strips every link and token: a backer's page link is the whole of their auth.
 */
const rateLimit = require('express-rate-limit');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { checkSharedToken } = require('../shared-token');

const MAX_EVENTS = 40;
const DEFAULT_TZ = 'America/New_York';

function rowsOf(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}

/** "October 23, 2026" + "4:00 PM" in a zone -> epoch ms (NaN when unreadable). */
function startMsOf(date, time, tz) {
  const t = time && time !== 'TBD' ? time : '12:00 PM';
  const naive = Date.parse(`${date} ${t} UTC`);
  if (!Number.isFinite(naive)) return NaN;
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz || DEFAULT_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(new Date(naive)).map((x) => [x.type, x.value]));
    const asTz = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return naive - (asTz - naive);
  } catch (_) { return naive; }
}

/** The event fields a chat needs, nothing bulky. */
function compactEvent(t) {
  return {
    id: t.id,
    date: t.date,
    time: t.time,
    name: t.event_name,
    eventNumber: t.event_number,
    series: t.venue,
    room: t.property || null,
    buyin: t.buyin,
    guarantee: t.prize_pool || null,
    game: t.game_variant || null,
    online: !!t.is_online,
    satellite: !!t.is_satellite,
    restart: !!t.is_restart,
    lateReg: t.late_reg || null,
    startingChips: t.starting_chips || null,
    levelMinutes: t.level_duration || null,
    timezone: t.timezone || null,
  };
}

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const failure = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

/**
 * mountMcp(app, { getDb, getOwnerId, signToken, port, log })
 *   signToken(payload, { expiresIn })  the app's own jwt.sign with its secret
 */
function mountMcp(app, { getDb, getOwnerId, signToken, port, log = console.log }) {
  const current = () => String(process.env.MCP_TOKEN || '').trim();
  const on = () => current().length >= 16;
  log(on() ? `[mcp] ON at /mcp/<token> (${current().length} characters)` : '[mcp] OFF: MCP_TOKEN is not set (16+ characters turn it on)');

  const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });

  /** A call on the app's own API as the owner. -> { status, json } */
  async function api(path, { method = 'GET', body } = {}) {
    const db = getDb();
    const owner = getOwnerId();
    const u = owner != null ? rowsOf(db, 'SELECT id, username FROM users WHERE id = ?', [owner])[0] : null;
    if (!u) return { status: 503, json: { error: 'The owner account is not resolved yet' } };
    const jwt = signToken({ id: u.id, username: u.username }, { expiresIn: '2m' });
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${jwt}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const txt = await res.text();
    let json = null;
    try { json = JSON.parse(txt); } catch (_) { json = { raw: txt.slice(0, 500) }; }
    return { status: res.status, json };
  }

  function buildServer() {
    const server = new McpServer({ name: 'futurega.me', version: '1.0.0' });

    server.registerTool('find_events', {
      title: 'Find tournaments',
      description: 'Search the live tournament schedule (every room the feeds cover, plus online). Upcoming events only unless a date range is given. Dates are "YYYY-MM-DD". Returns at most 40 events, soonest first.',
      inputSchema: {
        text: z.string().optional().describe('Words to match in the event name, series or room, e.g. "main event", "turning stone", "PLO"'),
        dateFrom: z.string().optional().describe('Earliest date, YYYY-MM-DD'),
        dateTo: z.string().optional().describe('Latest date, YYYY-MM-DD'),
        minBuyin: z.number().optional(),
        maxBuyin: z.number().optional(),
        game: z.string().optional().describe('Game variant as the app names it: NLH, PLO, PLO8, HORSE, …'),
        includeOnline: z.boolean().optional().describe('Include online rooms (default false)'),
        limit: z.number().int().min(1).max(MAX_EVENTS).optional(),
      },
    }, async (a) => {
      const q = new URLSearchParams();
      if (a.minBuyin != null) q.set('minBuyin', String(a.minBuyin));
      if (a.maxBuyin != null) q.set('maxBuyin', String(a.maxBuyin));
      if (a.game) q.set('gameVariant', a.game.toUpperCase());
      const r = await api(`/api/tournaments${q.toString() ? '?' + q : ''}`);
      if (r.status !== 200 || !Array.isArray(r.json)) return failure(`The schedule did not answer (${r.status}).`);
      const words = String(a.text || '').toLowerCase().split(/\s+/).filter(Boolean);
      const dayKey = (d) => { const ms = Date.parse(`${d} 12:00 UTC`); return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null; };
      let rows = r.json.filter((t) => {
        if (!a.includeOnline && t.is_online) return false;
        const k = dayKey(t.date);
        if (a.dateFrom && k && k < a.dateFrom) return false;
        if (a.dateTo && k && k > a.dateTo) return false;
        if (words.length) {
          const hay = `${t.event_name || ''} ${t.venue || ''} ${t.property || ''} ${t.game_variant || ''}`.toLowerCase();
          if (!words.every((w) => hay.includes(w))) return false;
        }
        return true;
      });
      rows.sort((x, y) => (startMsOf(x.date, x.time, x.timezone) || 0) - (startMsOf(y.date, y.time, y.timezone) || 0));
      const total = rows.length;
      rows = rows.slice(0, a.limit || MAX_EVENTS);
      return text({ total, shown: rows.length, events: rows.map(compactEvent) });
    });

    server.registerTool('my_schedule', {
      title: 'My schedule',
      description: "The owner's saved events (My Schedule), with the last 7 days, soonest first.",
      inputSchema: { includePast: z.boolean().optional().describe('Include every past event too (default: the last 7 days only)') },
    }, async (a) => {
      const owner = getOwnerId();
      const r = await api(`/api/schedule/${owner}`);
      if (r.status !== 200 || !Array.isArray(r.json)) return failure(`My Schedule did not answer (${r.status}).`);
      const cutoff = Date.now() - 7 * 86400000;
      const rows = r.json
        .filter((t) => a.includePast || !Number.isFinite(startMsOf(t.date, t.time, t.timezone)) || startMsOf(t.date, t.time, t.timezone) >= cutoff)
        .sort((x, y) => (startMsOf(x.date, x.time, x.timezone) || 0) - (startMsOf(y.date, y.time, y.timezone) || 0));
      return text({ count: rows.length, events: rows.map((t) => ({ ...compactEvent(t), anchor: !!t.is_anchor, plannedEntries: t.planned_entries || 1, notPlayed: !!t.not_played })) });
    });

    server.registerTool('add_to_schedule', {
      title: 'Add to My Schedule',
      description: 'Save a tournament (by its id from find_events) to the owner\'s My Schedule.',
      inputSchema: { tournamentId: z.number().int() },
    }, async (a) => {
      const r = await api('/api/schedule', { method: 'POST', body: { tournamentId: a.tournamentId } });
      return r.status === 200 ? text({ ok: true, tournamentId: a.tournamentId }) : failure(`Could not add it (${r.status}): ${(r.json && r.json.error) || ''}`);
    });

    server.registerTool('remove_from_schedule', {
      title: 'Remove from My Schedule',
      description: 'Take a tournament (by id) off the owner\'s My Schedule.',
      inputSchema: { tournamentId: z.number().int() },
    }, async (a) => {
      const r = await api(`/api/schedule/${a.tournamentId}`, { method: 'DELETE' });
      return r.status === 200 ? text({ ok: true, tournamentId: a.tournamentId }) : failure(`Could not remove it (${r.status}): ${(r.json && r.json.error) || ''}`);
    });

    server.registerTool('live_clock', {
      title: 'Live tournament clock',
      description: "The room's real clock for a tournament that has started (level, blinds, time left, players left), from PokerAtlas, WSOP+ or Bravo. Nothing for an event that has not started or a room with no clock online.",
      inputSchema: { tournamentId: z.number().int() },
    }, async (a) => {
      const db = getDb();
      const t = rowsOf(db, 'SELECT id, date, time, timezone, venue, property, event_name FROM tournaments WHERE id = ?', [a.tournamentId])[0];
      if (!t) return failure('No such tournament.');
      const vc = rowsOf(db, 'SELECT lat, lng FROM venue_coords WHERE venue = ?', [t.venue])[0];
      const startMs = startMsOf(t.date, t.time, t.timezone);
      const r = await api('/api/live-clocks', { method: 'POST', body: { events: [{ id: t.id, lat: vc ? vc.lat : undefined, lng: vc ? vc.lng : undefined, startMs }] } });
      if (r.status !== 200) return failure(`The clock did not answer (${r.status}).`);
      const c = r.json && r.json.clocks && r.json.clocks[t.id];
      if (!c) return text({ event: t.event_name, clock: null, note: 'No clock for this event right now (not started, or the room has none online).' });
      return text({ event: t.event_name, clock: c });
    });

    server.registerTool('bankroll_summary', {
      title: 'Bankroll summary',
      description: "The owner's bankrolls and their balances, as the Bankroll tab's summary shows them.",
      inputSchema: {},
    }, async () => {
      const r = await api('/api/bankrolls/summary');
      return r.status === 200 ? text(r.json) : failure(`The bankroll did not answer (${r.status}).`);
    });

    server.registerTool('recent_results', {
      title: 'Recent tournament results',
      description: "The owner's logged tournament results, newest first.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    }, async (a) => {
      const r = await api('/api/tracking');
      if (r.status !== 200 || !Array.isArray(r.json)) return failure(`Results did not answer (${r.status}).`);
      const keep = ['id', 'tournament_id', 'date', 'time', 'event_name', 'event_number', 'venue', 'property', 'buyin', 'game_variant',
        'result', 'profit', 'net', 'prize', 'cash', 'cashed', 'place', 'finish', 'entries', 'total_entries', 'rebuys', 'reentries', 'bust_level', 'notes', 'subtitle', 'bankroll_id'];
      const rows = r.json.slice(0, a.limit || 20).map((e) => Object.fromEntries(keep.filter((k) => e[k] !== undefined && e[k] !== null).map((k) => [k, e[k]])));
      return text({ count: r.json.length, shown: rows.length, results: rows });
    });

    server.registerTool('backers', {
      title: 'Backers',
      description: "Each backer's standing: what is owed either way (+ = the owner pays the backer), and any Settled press in progress. Never their page links.",
      inputSchema: {},
    }, async () => {
      const r = await api('/api/staking/standing/backers');
      if (r.status !== 200 || !r.json || !Array.isArray(r.json.backers)) return failure(`Backers did not answer (${r.status}).`);
      const rows = r.json.backers.map((b) => ({
        id: b.id, name: b.name, cumulativeCents: b.cumulativeCents, dueCents: b.dueCents, thisWeekCents: b.thisWeekCents,
        settlement: b.settlement ? { open: b.settlement.open || null, last: b.settlement.last || null } : null,
        delivery: b.delivery || null,
      }));
      return text({ count: rows.length, backers: rows });
    });

    return server;
  }

  app.all('/mcp/:token', limiter, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!on()) return res.status(404).json({ error: 'Not found' });
    const ok = checkSharedToken(req.params.token, { current: current(), previous: String(process.env.MCP_TOKEN_PREVIOUS || '').trim() });
    if (!ok.ok) return res.status(404).json({ error: 'Not found' });
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').json({ error: 'Method not allowed' });
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request failed:', err && err.message);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
}

module.exports = { mountMcp, startMsOf, compactEvent };
