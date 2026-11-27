// The tables service (docs/play-money-platform.md §4-5; owner, 2026-11-22, decision 1: its own service).
//
// It holds the live tables and streams each viewer its own view of them. It never sees an account password,
// session or the user table: the scheduler (futurega.me) vouches for a player with a SEAT TICKET, a 2-minute
// JWT signed with TABLES_SECRET, which this service trades for a table token. Chips and hands go back to the
// scheduler over its internal routes, with TABLES_SECRET as the bearer, through an outbox that survives the
// scheduler being mid-deploy.
//
// Routes (public, CORS for TABLES_ORIGINS):
//   POST /tables/:id/join   { ticket }                 -> { token, view }
//   GET  /tables/:id/state  (Bearer table token)       -> the viewer's view
//   GET  /tables/:id/events?token=&sid=&visible=0|1    -> SSE: 'view' events, each the viewer's whole view
//   POST /tables/:id/presence?token=&sid=&visible=0|1  -> the page that opened stream `sid` was hidden or shown again
//                                                         (a beacon, so the token rides in the URL as the stream's does)
//   POST /tables/:id/sit    { seat?, buyIn }           -> buys in from the player's balance, then seats them
//   POST /tables/:id/rebuy  { amount }
//   POST /tables/:id/act    { action, to?, seq }
//   POST /tables/:id/sit-out | /sit-in | /leave
//   POST /tables/:id/start: deals the first hand of a table made with the start gate (the host, or anyone seated when the host is not)
//   POST /tables/:id/post   { on }: a seat waiting for the big blind posts one to come in at once (or waits again)
// Internal (Bearer TABLES_SECRET, from the scheduler):
//   POST /internal/tables   { table config }  -> creates it
//   POST /internal/tables/:id/close
//   GET  /health
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Table } from './runtime.mjs';
import { shuffledDeck, deckCommitment } from './dealer.mjs';
import { maxSeatsFor } from '../../vite-app/src/utils/poker-rules/live-hand.js';

/* A stream's id, chosen by the page that opened it: letters, digits, - and _, at most 40. */
const streamId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

/**
 * opts: { secret, schedulerUrl, dataDir, origins: string[], handGapMs, testDeck?: () => deck, now?, setTimer?, clearTimer?, fetch? }
 */
export function createTablesService(opts) {
  const secret = opts.secret;
  if (!secret || secret.length < 32) throw new Error('TABLES_SECRET must be at least 32 characters');
  const now = opts.now || (() => Date.now());
  const setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer || ((h) => clearTimeout(h));
  const doFetch = opts.fetch || fetch;
  const dataDir = opts.dataDir;
  fs.mkdirSync(dataDir, { recursive: true });
  const tables = new Map();
  const streams = new Map(); // tableId -> Set<{ res, userId, sid, visible }>
  /* A player is at the table while one of their streams there is on a visible page: a tab in the background or a
     phone locked with its stream still open is away, as one with no stream is (the page says which, by presence). */
  const present = (tableId, userId) => [...(streams.get(tableId) || [])].some((s) => s.userId === userId && s.visible !== false);

  // ── The outbox: chips and hands owed to the scheduler, kept on disk until it says ok ──
  const outboxFile = path.join(dataDir, 'outbox.json');
  let outbox = [];
  try { outbox = JSON.parse(fs.readFileSync(outboxFile, 'utf8')); } catch (_) { outbox = []; }
  const saveOutbox = () => writeAtomic(outboxFile, JSON.stringify(outbox));
  let flushing = false;
  let flushTimer = null;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (outbox.length) {
        const item = outbox[0];
        let ok = false;
        try {
          const r = await doFetch(`${opts.schedulerUrl}/api/tables/internal/${item.kind}`, {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
            body: JSON.stringify(item.body), signal: AbortSignal.timeout(15000),
          });
          ok = r.ok || (r.status >= 400 && r.status < 500 && r.status !== 404 && r.status !== 429);
          if (!r.ok) console.log(`[tables] scheduler answered ${r.status} to ${item.kind}${ok ? ' (dropped)' : ''}`);
        } catch (e) { console.log(`[tables] scheduler unreachable for ${item.kind}: ${e.message}`); }
        if (!ok) break;
        outbox.shift();
        saveOutbox();
      }
    } finally { flushing = false; }
    if (outbox.length && !flushTimer) flushTimer = setTimer(() => { flushTimer = null; flush(); }, 5000);
  }
  const send = (kind, body) => { outbox.push({ kind, body, at: now() }); saveOutbox(); flush(); };

  // ── The journal: each table as one file, written whole on every change, read back at boot ──
  function writeAtomic(file, text) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }
  const tableFile = (id) => path.join(dataDir, `table-${id}.json`);

  const env = {
    now, setTimer, clearTimer,
    shuffle: opts.testDeck || shuffledDeck,
    commit: deckCommitment,
    handGapMs: opts.handGapMs != null ? opts.handGapMs : 4000,
    onChange: (t) => { writeAtomic(tableFile(t.cfg.id), JSON.stringify(t.toJSON())); broadcast(t); },
    onHandDone: (t, record) => send('hand', record),
    // kind: 'cash-out' (a stack, leaving), 'refund' (a sit and go's buy-in, off its list) or 'prize' (a place paid).
    onCashOut: (t, { userId, amount, kind }) => send('cash-out', { tableId: t.cfg.id, userId, amount, ...(kind ? { kind } : {}) }),
    // A sit and go is over: its places, for the scheduler to keep with the table.
    onFinish: (t, result) => send('sng-result', { tableId: t.cfg.id, tableName: t.cfg.name, ...result, at: now() }),
    // The player to act is away (no stream open, or every one of theirs on a hidden page: another tab, a locked phone):
    // the scheduler pushes "your turn" from play.futurega.me (lib/play-push.js), once a hand.
    onTurn: (t, userId) => {
      if (present(t.cfg.id, userId)) return;
      send('turn', { tableId: t.cfg.id, tableName: t.cfg.name, handNo: t.handNo, userId });
    },
  };

  for (const f of fs.readdirSync(dataDir)) {
    if (!/^table-.+\.json$/.test(f)) continue;
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      if (saved.closed) continue;
      tables.set(saved.cfg.id, new Table(saved.cfg, env, saved));
    } catch (e) { console.log(`[tables] could not reload ${f}: ${e.message}`); }
  }
  if (tables.size) console.log(`[tables] reloaded ${tables.size} table(s)`);
  if (outbox.length) flush();

  function broadcast(t) {
    const set = streams.get(t.cfg.id);
    if (!set) return;
    for (const s of set) {
      try { s.res.write(`event: view\ndata: ${JSON.stringify(t.viewFor(s.userId))}\n\n`); } catch (_) { /* gone; cleaned on close */ }
    }
  }

  // ── Auth ──
  const tableToken = (userId, name, tableId) => jwt.sign({ kind: 'table', sub: userId, name, table: tableId }, secret, { expiresIn: '12h' });
  function readTableToken(req, tableId) {
    const h = req.headers.authorization || '';
    const raw = h.startsWith('Bearer ') ? h.slice(7) : (req.query && req.query.token) || '';
    try {
      const p = jwt.verify(String(raw), secret);
      if (p.kind !== 'table' || p.table !== tableId) return null;
      return { userId: p.sub, name: p.name };
    } catch (_) { return null; }
  }
  const internalOnly = (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!sameSecret(h.startsWith('Bearer ') ? h.slice(7) : '', secret)) return res.status(404).end();
    next();
  };

  const app = express();
  app.disable('x-powered-by');
  const origins = new Set(opts.origins || []);
  app.use((req, res, next) => {
    const o = req.headers.origin;
    if (o && origins.has(o)) {
      res.set('Access-Control-Allow-Origin', o);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'authorization, content-type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => res.json({ ok: true, tables: tables.size, outbox: outbox.length }));

  app.post('/internal/tables', internalOnly, (req, res) => {
    const c = req.body || {};
    if (!c.id || tables.has(c.id)) return res.status(409).json({ error: 'exists' });
    // A sit and go: a fixed buy-in from the balance, a fixed stack of tournament chips, and the minutes a level lasts.
    const sng = c.format === 'sng' && c.sng ? { buyIn: Number(c.sng.buyIn), stack: Number(c.sng.stack), levelMins: Number(c.sng.levelMins) } : null;
    if (sng && !(sng.buyIn > 0 && sng.stack > 0 && sng.levelMins > 0)) return res.status(400).json({ error: 'sit and go settings' });
    const t = new Table({
      id: String(c.id), name: String(c.name || 'Table'), hostId: c.hostId, gameType: c.gameType,
      blinds: {
        sb: Number(c.blinds.sb) || 0, bb: Number(c.blinds.bb) || 0, ante: Number(c.blinds.ante) || 0,
        ...(c.blinds.bringIn ? { bringIn: Number(c.blinds.bringIn) } : {}), ...(c.blinds.bigBet ? { bigBet: Number(c.blinds.bigBet) } : {}),
      },
      maxSeats: Math.max(2, Math.min(9, maxSeatsFor(c.gameType), Number(c.maxSeats) || 6)),
      buyIn: sng ? { min: sng.stack, max: sng.stack } : { min: Number(c.buyIn.min), max: Number(c.buyIn.max) },
      clock: { decision: Number(c.clock.decision) || 30, bank: Number(c.clock.bank) || 0 },
      // Every table made from 2026-11-26 waits to be started (runtime.mjs startGame).
      startGate: true,
      ...(sng ? { format: 'sng', sng } : {}),
    }, env);
    tables.set(t.cfg.id, t);
    env.onChange(t);
    res.json({ ok: true });
  });

  app.post('/internal/tables/:id/close', internalOnly, (req, res) => {
    const t = tables.get(req.params.id);
    if (!t) return res.status(404).json({ error: 'No such table' });
    t.close();
    res.json({ ok: true });
  });

  const withTable = (req, res) => {
    const t = tables.get(req.params.id);
    if (!t || t.closed) { res.status(404).json({ error: 'No such table' }); return null; }
    return t;
  };
  const withViewer = (req, res) => {
    const t = withTable(req, res);
    if (!t) return null;
    const who = readTableToken(req, t.cfg.id);
    if (!who) { res.status(401).json({ error: 'Join the table first' }); return null; }
    return { t, who };
  };

  app.post('/tables/:id/join', (req, res) => {
    const t = withTable(req, res);
    if (!t) return;
    let p;
    try { p = jwt.verify(String((req.body || {}).ticket || ''), secret); } catch (_) { return res.status(401).json({ error: 'Ticket refused' }); }
    if (p.kind !== 'ticket' || p.table !== t.cfg.id) return res.status(401).json({ error: 'Ticket refused' });
    res.json({ token: tableToken(p.sub, p.name, t.cfg.id), view: t.viewFor(p.sub) });
  });

  app.get('/tables/:id/state', (req, res) => {
    const v = withViewer(req, res);
    if (v) res.json(v.t.viewFor(v.who.userId));
  });

  app.get('/tables/:id/events', (req, res) => {
    const v = withViewer(req, res);
    if (!v) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: view\ndata: ${JSON.stringify(v.t.viewFor(v.who.userId))}\n\n`);
    const entry = { res, userId: v.who.userId, sid: streamId(req.query.sid), visible: req.query.visible !== '0' };
    if (!streams.has(v.t.cfg.id)) streams.set(v.t.cfg.id, new Set());
    streams.get(v.t.cfg.id).add(entry);
    const beat = setInterval(() => { try { res.write(': beat\n\n'); } catch (_) { /* closed */ } }, 15000);
    req.on('close', () => { clearInterval(beat); const set = streams.get(v.t.cfg.id); if (set) set.delete(entry); });
  });

  /* The page that opened a stream was hidden (another tab, the phone locked) or shown again. Sent as a beacon, which
     carries no header and may carry no body, so everything is in the URL. Only the caller's own streams change. */
  app.post('/tables/:id/presence', (req, res) => {
    const v = withViewer(req, res);
    if (!v) return;
    const sid = streamId(req.query.sid);
    const visible = req.query.visible !== '0';
    let n = 0;
    for (const s of streams.get(v.t.cfg.id) || []) if (s.userId === v.who.userId && sid && s.sid === sid) { s.visible = visible; n++; }
    res.json({ ok: true, streams: n });
  });

  // Buying in takes the chips from the player's balance at the scheduler FIRST; only a yes seats them.
  async function takeChips(userId, tableId, amount) {
    try {
      const r = await doFetch(`${opts.schedulerUrl}/api/tables/internal/buy-in`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify({ userId, tableId, amount }), signal: AbortSignal.timeout(15000),
      });
      const body = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, balance: body.balance } : { error: body.error || 'Could not buy in' };
    } catch (_) { return { error: 'Could not reach your chips; try again in a moment' }; }
  }

  app.post('/tables/:id/sit', async (req, res) => {
    const v = withViewer(req, res);
    if (!v) return;
    // A sit and go's entry is its fixed buy-in, for its fixed stack of tournament chips; a cash table's is the stack.
    const sng = v.t.sng;
    const amount = sng ? sng.buyIn : Number((req.body || {}).buyIn);
    const stack = sng ? sng.stack : amount;
    const seat = (req.body || {}).seat;
    const { min, max } = v.t.cfg.buyIn;
    if (!sng && !(amount >= min && amount <= max)) return res.status(400).json({ error: `Buy in for ${min} to ${max}` });
    if (sng && v.t.started) return res.status(409).json({ error: 'This sit and go has started' });
    if (v.t.seatOf(v.who.userId) >= 0) return res.status(409).json({ error: 'You are already seated' });
    if (seat != null && v.t.seats[Number(seat)]) return res.status(409).json({ error: 'That seat is taken' });
    const paid = await takeChips(v.who.userId, v.t.cfg.id, amount);
    if (paid.error) return res.status(409).json({ error: paid.error });
    const r = v.t.sit(v.who.userId, v.who.name, stack, seat);
    if (r.error) { send('cash-out', { tableId: v.t.cfg.id, userId: v.who.userId, amount, ...(sng ? { kind: 'refund' } : {}) }); return res.status(409).json(r); }
    res.json({ ...r, balance: paid.balance, view: v.t.viewFor(v.who.userId) });
  });

  app.post('/tables/:id/rebuy', async (req, res) => {
    const v = withViewer(req, res);
    if (!v) return;
    const amount = Number((req.body || {}).amount);
    const i = v.t.seatOf(v.who.userId);
    if (v.t.sng) return res.status(409).json({ error: 'No rebuys in a sit and go' });
    if (i < 0) return res.status(409).json({ error: 'Not seated' });
    if (!(amount > 0 && v.t.seats[i].stack + amount <= v.t.cfg.buyIn.max)) return res.status(400).json({ error: `Up to ${v.t.cfg.buyIn.max} at the table` });
    if (v.t.inHand(i)) return res.status(409).json({ error: 'After this hand' });
    const paid = await takeChips(v.who.userId, v.t.cfg.id, amount);
    if (paid.error) return res.status(409).json({ error: paid.error });
    const r = v.t.rebuy(v.who.userId, amount);
    if (r.error) { send('cash-out', { tableId: v.t.cfg.id, userId: v.who.userId, amount }); return res.status(409).json(r); }
    res.json({ ...r, balance: paid.balance });
  });

  app.post('/tables/:id/act', (req, res) => {
    const v = withViewer(req, res);
    if (!v) return;
    const b = req.body || {};
    // A draw's throw is a list of the player's own cards (the dealer checks each is in their hand).
    const discard = Array.isArray(b.discard) ? b.discard.slice(0, 7).map((c) => String(c).slice(0, 2)) : undefined;
    const r = v.t.act(v.who.userId, { action: String(b.action || ''), to: b.to, seq: b.seq, ...(discard ? { discard } : {}) });
    if (r.error) return res.status(r.stale ? 409 : 400).json({ ...r, view: v.t.viewFor(v.who.userId) });
    res.json({ ok: true });
  });

  // ── Chat ──
  app.post('/tables/:id/chat', (req, res) => {
    const v = withViewer(req, res);
    if (!v) return;
    const r = v.t.say(v.who.userId, v.who.name, (req.body || {}).text);
    if (r.error) return res.status(r.error === 'Slow down a little' ? 429 : 400).json(r);
    res.json(r);
  });

  app.post('/tables/:id/mute', (req, res) => {
    const v = withViewer(req, res);
    if (!v) return;
    const b = req.body || {};
    const r = v.t.mute(v.who.userId, Number(b.userId), b.muted !== false);
    if (r.error) return res.status(403).json(r);
    res.json(r);
  });

  // The scheduler reads a reported message from here (never the reporter's copy) and removes one for Admin.
  app.get('/internal/tables/:id/chat/:msgId', internalOnly, (req, res) => {
    const t = tables.get(req.params.id);
    const m = t && t.message(req.params.msgId);
    if (!m) return res.status(404).json({ error: 'That message is no longer there' });
    res.json(m);
  });

  app.post('/internal/tables/:id/chat/:msgId/remove', internalOnly, (req, res) => {
    const t = tables.get(req.params.id);
    if (!t) return res.json({ ok: true, removed: 0 });
    res.json(t.removeMessage(req.params.msgId));
  });

  app.post('/tables/:id/post', (req, res) => {
    const v = withViewer(req, res);
    if (!v) return;
    const r = v.t.postIn(v.who.userId, !!(req.body && req.body.on));
    if (r.error) return res.status(409).json(r);
    res.json(r);
  });

  for (const [route, fn] of [['sit-out', 'sitOut'], ['sit-in', 'sitIn'], ['leave', 'leave'], ['start', 'startGame']]) {
    app.post(`/tables/:id/${route}`, (req, res) => {
      const v = withViewer(req, res);
      if (!v) return;
      const r = v.t[fn](v.who.userId);
      if (r.error) return res.status(409).json(r);
      res.json(r);
    });
  }

  return {
    app,
    tables,
    flush,
    outbox: () => outbox,
    /* Before a restart (doc §5): deal no new hand, let the hands in progress play out (their clocks still run),
       and send what is owed to the scheduler, for up to `ms`. Whatever is still going then is in the journal and
       resumes after the restart. Resolves { playing, owed }: what was left. */
    async drain(ms) {
      for (const t of tables.values()) t.drain();
      const until = now() + ms;
      const left = () => [...tables.values()].filter((t) => t.hand && t.hand.phase !== 'over').length;
      while (now() < until && (left() > 0 || outbox.length > 0)) {
        if (!left() && outbox.length) await flush();
        await new Promise((r) => setTimeout(r, 250));
      }
      return { playing: left(), owed: outbox.length };
    },
    shutdown() {
      for (const t of tables.values()) t.clearTimers();
      for (const set of streams.values()) for (const s of set) { try { s.res.end(); } catch (_) { /* gone */ } }
      streams.clear();
    },
  };
}
