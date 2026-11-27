'use strict';
/*
 * Play-money tables, the scheduler's half (docs/play-money-platform.md §5 and §11). The live tables run in their
 * own service (tables/server.mjs); this side owns the PEOPLE: who may play, the chip balance, the invite, the
 * blocks check, the seat ticket, and the archive of every hand played.
 *
 * Off unless TABLES=1 and TABLES_URL and TABLES_SECRET (>= 32 characters) are set; every boot logs which. Open to
 * every registered account (owner, 2026-11-26, decision 3: "Every account, full access"): any account plays, hosts
 * and invites; a guest does not. A host keeps HOST_MAX tables open at once.
 *
 * The chips (decision 2): a balance on the account, never bought, cashed out, transferred or shown to anyone
 * else. It starts at TABLES_CHIPS_START (20,000) and once a day a balance under TABLES_CHIPS_FLOOR (5,000) is
 * raised to it. Chips leave the balance only to sit at a table and come back when the player leaves it.
 *
 *   play_tables        (id, host_id, name, game_type, config JSON, invite_token, status, created_at)
 *   play_table_members (table_id, user_id, joined_at): who may join (the host, and anyone who took the invite)
 *   play_chips         (user_id, balance, floor_day)
 *   play_chip_moves    (id, user_id, delta, kind 'start'|'floor'|'buy-in'|'cash-out'|'refund'|'prize', table_id, at)
 *   (play_tables.status: 'open', 'closed', or 'finished' for a sit and go played out; its places in config.results)
 *
 * Routes (signed in, registered):
 *   GET  /api/tables/availability          -> { on, url }
 *   GET  /api/tables/chips                 -> { balance, floor, start }
 *   GET  /api/tables                       -> the tables the player hosts or joined
 *   POST /api/tables                       -> create { name, gameType, sb, bb, ante, maxSeats, buyIn, decision, bank,
 *                                             format?: 'sng', sng?: { buyIn, stack, levelMins } }
 *   GET  /api/tables/invite/:token         -> the table an invite opens
 *   POST /api/tables/invite/:token/accept  -> joins its members
 *   POST /api/tables/:id/ticket            -> { ticket, url } a 2-minute seat ticket for the tables service
 *   POST /api/tables/:id/report            -> a table message to Admin's inbox { msgId, text? }
 *   POST /api/tables/:id/close             (host)
 *   GET/POST /api/tables/push, POST /api/tables/push/off: the play page's "your turn" switch (lib/play-push.js)
 * Internal (Bearer TABLES_SECRET, from the tables service):
 *   POST /api/tables/internal/buy-in   { userId, tableId, amount }  -> { balance } | 409
 *   POST /api/tables/internal/cash-out { userId, tableId, amount }
 *   POST /api/tables/internal/hand     { tableId, tableName, handNo, handId, players: [{ userId, hand, net }] }
 *   POST /api/tables/internal/turn     { tableId, handNo, userId }: "your turn" while away: a web push from the play
 *                                      origin, once a hand (lib/play-push.js; the service reports only an away player)
 */
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const playPushLib = require('./play-push');

const config = (env = process.env) => {
  const secret = env.TABLES_SECRET || '';
  const url = (env.TABLES_URL || '').replace(/\/$/, '');
  const on = env.TABLES === '1' && !!url && secret.length >= 32;
  const why = env.TABLES !== '1' ? 'TABLES is not 1' : !url ? 'TABLES_URL is not set' : secret.length < 32 ? 'TABLES_SECRET is unset or short' : '';
  return {
    on, why, secret, url, publicUrl: (env.TABLES_PUBLIC_URL || url).replace(/\/$/, ''),
    // Where the tables are played: their own site (owner, 2026-11-22: "play.futurega.me"); an invite is <playUrl>/join/<token>.
    playUrl: (env.PLAY_URL || 'https://play.futurega.me').replace(/\/$/, ''),
    start: Number(env.TABLES_CHIPS_START) || 20000, floor: Number(env.TABLES_CHIPS_FLOOR) || 5000,
  };
};

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS play_tables (
    id TEXT PRIMARY KEY, host_id INTEGER NOT NULL, name TEXT NOT NULL, game_type TEXT NOT NULL, config TEXT NOT NULL,
    invite_token TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS play_table_members (
    table_id TEXT NOT NULL, user_id INTEGER NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (table_id, user_id))`);
  db.run('CREATE INDEX IF NOT EXISTS idx_play_table_members_user ON play_table_members(user_id)');
  db.run(`CREATE TABLE IF NOT EXISTS play_chips (user_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL, floor_day TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS play_chip_moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta INTEGER NOT NULL, kind TEXT NOT NULL,
    table_id TEXT, at INTEGER NOT NULL)`);
  db.run('CREATE INDEX IF NOT EXISTS idx_play_chip_moves_user ON play_chip_moves(user_id, at)');
  // A reported table message's table, so Admin's Remove can reach it (the report itself is in `reports`).
  db.run('CREATE TABLE IF NOT EXISTS play_chat_reports (msg_id INTEGER PRIMARY KEY, table_id TEXT NOT NULL)');
  playPushLib.migrate(db);
}

/* Admin's Remove on a 'table-message' report (lib/safety.js calls it): set by mountRoutes, which has the service. */
let removeReported = async () => ({ removed: 0 });
const removeReportedMessage = (db, msgId) => removeReported(db, msgId);
/* A deleted account's tables, closed in the service as its Close does (server.js deleteUserAccount has already
   removed their rows): best effort, each on its own; set by mountRoutes, which has the service. */
let closeInService = async () => false;
const closeTablesInService = (ids) => Promise.all((ids || []).map((id) => closeInService(id).catch(() => false)));

const rows = (db, sql, params) => {
  const st = db.prepare(sql);
  const out = [];
  try { st.bind(params || []); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
  return out;
};
const one = (db, sql, params) => rows(db, sql, params)[0] || null;
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
/* The day a floor top-up belongs to: New York's, as the app's other days are. */
const nyDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** The balance, starting it and applying the day's floor first. */
function balanceOf(db, userId, cfg, now = Date.now()) {
  const day = nyDay(now);
  let r = one(db, 'SELECT balance, floor_day FROM play_chips WHERE user_id = ?', [userId]);
  if (!r) {
    db.run('INSERT INTO play_chips (user_id, balance, floor_day) VALUES (?, ?, ?)', [userId, cfg.start, day]);
    db.run('INSERT INTO play_chip_moves (user_id, delta, kind, at) VALUES (?, ?, ?, ?)', [userId, cfg.start, 'start', now]);
    return cfg.start;
  }
  if (r.floor_day !== day) {
    if (r.balance < cfg.floor) {
      db.run('INSERT INTO play_chip_moves (user_id, delta, kind, at) VALUES (?, ?, ?, ?)', [userId, cfg.floor - r.balance, 'floor', now]);
      r = { balance: cfg.floor };
    }
    db.run('UPDATE play_chips SET balance = ?, floor_day = ? WHERE user_id = ?', [r.balance, day, userId]);
  }
  return r.balance;
}

function move(db, userId, delta, kind, tableId, now = Date.now()) {
  db.run('UPDATE play_chips SET balance = balance + ? WHERE user_id = ?', [delta, userId]);
  db.run('INSERT INTO play_chip_moves (user_id, delta, kind, table_id, at) VALUES (?, ?, ?, ?, ?)', [userId, delta, kind, tableId, now]);
}

/* Open tables one account may host at once (every account may host since 2026-11-26). */
const HOST_MAX = 5;

let liveModule = null;
async function liveGames() {
  if (!liveModule) liveModule = await import(pathToFileURL(path.join(__dirname, '..', 'vite-app', 'src', 'utils', 'poker-rules', 'live-hand.js')).href);
  return liveModule;
}

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireRegistered, jwt, isBlocked } = deps;
  const cfg = config();
  console.log(cfg.on ? `[tables] play-money tables are ON (${cfg.url}), every account` : `[tables] play-money tables are OFF: ${cfg.why}`);

  const allowed = (req) => cfg.on && !!req.user && !req.user.isGuest;
  const gate = (req, res, next) => (allowed(req) ? next() : res.status(404).json({ error: 'Not found' }));
  const user = [authenticateToken, requireRegistered];

  // "Your turn" while away (lib/play-push.js): the play page's switch, and the sender internal/turn calls.
  const playPush = playPushLib.createPlayPush({ getDb, saveDatabase, webpush: deps.webpush, vapidPublicKey: () => process.env.VAPID_PUBLIC_KEY });
  const pushGate = playPushLib.deliveryDecision();
  console.log(`[tables] your-turn push is ${pushGate.on ? 'ON' : 'OFF'} (${pushGate.why})${pushGate.on && !process.env.VAPID_PUBLIC_KEY ? ', but VAPID keys are missing: nothing is sent' : ''}`);
  playPushLib.mountRoutes(app, { getDb, saveDatabase, guard: [...user, gate], playPush });

  const tableRow = (db, id) => one(db, 'SELECT * FROM play_tables WHERE id = ?', [String(id)]);
  const inviteOf = (db, id) => (tableRow(db, id) || {}).invite_token;
  const isMember = (db, tableId, userId) => !!one(db, 'SELECT 1 AS x FROM play_table_members WHERE table_id = ? AND user_id = ?', [tableId, userId]);
  const members = (db, tableId) => rows(db, 'SELECT user_id FROM play_table_members WHERE table_id = ?', [tableId]).map((r) => r.user_id);
  /* Blocks apply both ways: a player blocked by, or blocking, anyone at the table is told it is full. */
  const blockedAt = (db, tableId, userId) => members(db, tableId).some((m) => m !== userId && isBlocked(db, m, userId));
  const summary = (t) => {
    const c = JSON.parse(t.config);
    return {
      id: t.id, name: t.name, gameType: t.game_type, blinds: c.blinds, maxSeats: c.maxSeats, buyIn: c.buyIn, clock: c.clock, status: t.status, hostId: t.host_id,
      format: c.format || 'cash', ...(c.sng ? { sng: c.sng } : {}), ...(c.results ? { results: c.results } : {}),
    };
  };
  /* A finished sit and go stays in its players' list for a day, with its places. */
  const FINISHED_SHOWN_MS = 24 * 3600 * 1000;
  const internal = (path, body) => fetch(`${cfg.url}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.secret}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  closeInService = async (tableId) => {
    if (!cfg.on) return false;
    const r = await internal(`/internal/tables/${encodeURIComponent(tableId)}/close`, {});
    return r.ok;
  };

  app.get('/api/tables/availability', ...user, (req, res) => res.json({ on: allowed(req), url: allowed(req) ? cfg.publicUrl : null }));

  app.get('/api/tables/chips', ...user, gate, async (req, res) => {
    const db = getDb();
    const balance = balanceOf(db, req.user.id, cfg);
    await saveDatabase();
    res.json({ balance, floor: cfg.floor, start: cfg.start });
  });

  app.get('/api/tables', ...user, gate, (req, res) => {
    const db = getDb();
    const list = rows(db, `SELECT t.* FROM play_tables t JOIN play_table_members m ON m.table_id = t.id
      WHERE m.user_id = ? AND t.status IN ('open', 'finished') ORDER BY t.created_at DESC`, [req.user.id])
      .map(summary).filter((t) => t.status === 'open' || (t.results && Date.now() - t.results.at < FINISHED_SHOWN_MS));
    res.json({ tables: list.map((t) => ({ ...t, invite: t.hostId === req.user.id && t.status === 'open' ? `${cfg.playUrl}/join/${inviteOf(db, t.id)}` : undefined })) });
  });

  app.post('/api/tables', ...user, gate, async (req, res) => {
    const b = req.body || {};
    const { canDeal, maxSeatsFor, tableStakes, gameKind } = await liveGames();
    const gameType = String(b.gameType || 'NLH');
    if (!canDeal(gameType)) return res.status(400).json({ error: `${gameType} is not dealt at the tables yet` });
    const sb = Number(b.sb), bb = Number(b.bb), ante = Number(b.ante) || 0;
    const stud = gameKind(gameType) === 'stud';
    if (!(Number.isInteger(sb) && Number.isInteger(bb) && Number.isInteger(ante) && sb > 0 && bb >= sb && ante >= 0)) {
      return res.status(400).json({ error: stud ? 'Stakes in whole chips, the small bet at least the bring-in' : 'Blinds in whole chips, the big at least the small' });
    }
    const maxSeats = Math.max(2, Math.min(9, maxSeatsFor(gameType), Number(b.maxSeats) || 6));
    /* A sit and go (owner, 2026-11-26): a fixed buy-in from the balance, a fixed stack of tournament chips, and the
       minutes each level of blinds lasts (the blinds set here are level 1; lib/tables/sng.mjs has the rest). */
    let sng = null;
    if (b.format === 'sng') {
      const s = b.sng || {};
      sng = { buyIn: Number(s.buyIn), stack: Number(s.stack), levelMins: Number(s.levelMins) };
      if (!(Number.isInteger(sng.buyIn) && sng.buyIn >= 1 && sng.buyIn <= 1000000)) return res.status(400).json({ error: 'The buy-in, in whole chips' });
      if (!(Number.isInteger(sng.stack) && sng.stack >= bb * 10 && sng.stack <= 10000000)) return res.status(400).json({ error: 'A starting stack of 10 big blinds or more' });
      if (!(sng.levelMins >= 1 && sng.levelMins <= 60)) return res.status(400).json({ error: 'Levels of 1 to 60 minutes' });
    }
    const buyIn = sng ? { min: sng.stack, max: sng.stack } : { min: Number(b.buyIn && b.buyIn.min) || bb * 20, max: Number(b.buyIn && b.buyIn.max) || bb * 100 };
    if (!(buyIn.min > 0 && buyIn.max >= buyIn.min)) return res.status(400).json({ error: 'The buy-in range' });
    const clock = { decision: Math.max(10, Math.min(120, Number(b.decision) || 30)), bank: Math.max(0, Math.min(300, Number(b.bank) || 0)) };
    const name = String(b.name || `${req.user.username}'s table`).slice(0, 40);
    const hosting = one(getDb(), "SELECT COUNT(*) AS n FROM play_tables WHERE host_id = ? AND status = 'open'", [req.user.id]).n;
    if (hosting >= HOST_MAX) return res.status(409).json({ error: `You host ${HOST_MAX} open tables. Close one first.` });
    const id = crypto.randomBytes(8).toString('hex');
    const invite = crypto.randomBytes(18).toString('base64url');
    const c = { blinds: tableStakes(gameType, { sb, bb, ante }), maxSeats, buyIn, clock, ...(sng ? { format: 'sng', sng } : {}) };
    try {
      const r = await internal('/internal/tables', { id, name, hostId: req.user.id, gameType, ...c });
      if (!r.ok) return res.status(502).json({ error: 'The tables service refused the table' });
    } catch (_) { return res.status(502).json({ error: 'The tables service is not reachable' }); }
    const db = getDb();
    db.run('INSERT INTO play_tables (id, host_id, name, game_type, config, invite_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.user.id, name, gameType, JSON.stringify(c), invite, Date.now()]);
    db.run('INSERT INTO play_table_members (table_id, user_id, joined_at) VALUES (?, ?, ?)', [id, req.user.id, Date.now()]);
    await saveDatabase();
    res.status(201).json({ ...summary(tableRow(db, id)), invite: `${cfg.playUrl}/join/${invite}` });
  });

  const byInvite = (db, token) => one(db, "SELECT * FROM play_tables WHERE invite_token = ? AND status = 'open'", [String(token)]);
  app.get('/api/tables/invite/:token', ...user, gate, (req, res) => {
    const db = getDb();
    const t = byInvite(db, req.params.token);
    if (!t || blockedAt(db, t.id, req.user.id)) return res.status(404).json({ error: 'This table is full or closed' });
    res.json(summary(t));
  });
  app.post('/api/tables/invite/:token/accept', ...user, gate, async (req, res) => {
    const db = getDb();
    const t = byInvite(db, req.params.token);
    if (!t || blockedAt(db, t.id, req.user.id)) return res.status(404).json({ error: 'This table is full or closed' });
    db.run('INSERT OR IGNORE INTO play_table_members (table_id, user_id, joined_at) VALUES (?, ?, ?)', [t.id, req.user.id, Date.now()]);
    await saveDatabase();
    res.json(summary(t));
  });

  app.post('/api/tables/:id/ticket', ...user, gate, (req, res) => {
    const db = getDb();
    const t = tableRow(db, req.params.id);
    // A finished sit and go can still be opened to see its places, while the service keeps it.
    if (!t || (t.status !== 'open' && t.status !== 'finished') || !isMember(db, t.id, req.user.id) || blockedAt(db, t.id, req.user.id)) {
      return res.status(404).json({ error: 'This table is full or closed' });
    }
    const ticket = jwt.sign({ kind: 'ticket', sub: req.user.id, name: req.user.username, table: t.id }, cfg.secret, { expiresIn: '2m' });
    res.json({ ticket, url: cfg.publicUrl, table: summary(t) });
  });

  /* A table message reported (decision 6's moderation, App Review guideline 1.2): the text is read from the tables
     service, never taken from the reporter, and goes to Admin's inbox as a 'table-message' report. */
  app.post('/api/tables/:id/report', ...user, gate, async (req, res) => {
    const db = getDb();
    const t = tableRow(db, req.params.id);
    const msgId = Number((req.body || {}).msgId);
    if (!t || !isMember(db, t.id, req.user.id) || !(msgId > 0)) return res.status(404).json({ error: 'Not found' });
    let m;
    try {
      const r = await fetch(`${cfg.url}/internal/tables/${t.id}/chat/${msgId}`, { headers: { authorization: `Bearer ${cfg.secret}` }, signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return res.status(404).json({ error: 'That message is no longer there' });
      m = await r.json();
    } catch (_) { return res.status(502).json({ error: 'The tables service is not reachable' }); }
    if (m.userId === req.user.id) return res.status(400).json({ error: 'That is your own' });
    const reason = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 500) : '';
    if (!one(db, "SELECT id FROM reports WHERE reporter_id = ? AND kind = 'table-message' AND ref_id = ? AND status = 'open'", [req.user.id, msgId])) {
      db.run('INSERT INTO reports (reporter_id, kind, ref_id, target_user_id, group_id, snapshot, text, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
        [req.user.id, 'table-message', msgId, m.userId, String(m.text || '').slice(0, 500), reason || null, Date.now()]);
      db.run('INSERT OR IGNORE INTO play_chat_reports (msg_id, table_id) VALUES (?, ?)', [msgId, t.id]);
      await saveDatabase();
      if (deps.sendPushToAdmin) deps.sendPushToAdmin('A report', 'A table message was reported', '/?view=admin').catch(() => {});
    }
    res.status(201).json({ ok: true });
  });

  removeReported = async (db, msgId) => {
    const row = one(db, 'SELECT table_id FROM play_chat_reports WHERE msg_id = ?', [Number(msgId)]);
    if (!row || !cfg.on) return { removed: 0 };
    const r = await internal(`/internal/tables/${row.table_id}/chat/${Number(msgId)}/remove`, {});
    return r.ok ? r.json() : { removed: 0 };
  };

  app.post('/api/tables/:id/close', ...user, gate, async (req, res) => {
    const db = getDb();
    const t = tableRow(db, req.params.id);
    if (!t || t.host_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    try { await internal(`/internal/tables/${t.id}/close`, {}); } catch (_) { return res.status(502).json({ error: 'The tables service is not reachable' }); }
    db.run("UPDATE play_tables SET status = 'closed' WHERE id = ?", [t.id]);
    await saveDatabase();
    res.json({ ok: true });
  });

  // ── Internal: the tables service ──
  const fromService = (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!cfg.on || !sameSecret(h.startsWith('Bearer ') ? h.slice(7) : '', cfg.secret)) return res.status(404).end();
    next();
  };

  /* Your turn, while away: the service reports a turn only when none of the player's streams at the table is on a
     visible page (lib/tables/service.mjs onTurn). A web push from play.futurega.me's own origin (its service worker
     opens the table when tapped), once a hand, to the browsers the player opted in; never the phone app's, which has no
     table (owner, 2026-11-22: "no effect on the mobile app"). Always 200, so the service's outbox drops the report. */
  app.post('/api/tables/internal/turn', fromService, async (req, res) => {
    const { tableId, handNo, userId } = req.body || {};
    const db = getDb();
    const t = tableRow(db, tableId);
    const uid = Number(userId), hand = Number(handNo);
    if (!t || t.status !== 'open' || !(uid > 0) || !isMember(db, t.id, uid) || !(Number.isInteger(hand) && hand > 0)) {
      return res.json({ ok: true, sent: false, why: 'not at this table' });
    }
    // The push lives as long as the turn can: the decision clock and the time bank, and a little for the network.
    const clock = JSON.parse(t.config).clock || {};
    const r = await playPush.sendTurn({ userId: uid, tableId: t.id, tableName: t.name, handNo: hand, ttl: (Number(clock.decision) || 30) + (Number(clock.bank) || 0) + 15 });
    res.json({ ok: true, ...r });
  });

  app.post('/api/tables/internal/buy-in', fromService, async (req, res) => {
    const { userId, tableId, amount } = req.body || {};
    const db = getDb();
    const t = tableRow(db, tableId);
    const amt = Number(amount);
    if (!t || !isMember(db, t.id, Number(userId)) || !(Number.isInteger(amt) && amt > 0)) return res.status(409).json({ error: 'Not at this table' });
    const bal = balanceOf(db, Number(userId), cfg);
    if (bal < amt) { await saveDatabase(); return res.status(409).json({ error: `You have ${bal.toLocaleString('en-US')} chips` }); }
    move(db, Number(userId), -amt, 'buy-in', t.id);
    await saveDatabase();
    res.json({ ok: true, balance: bal - amt });
  });

  app.post('/api/tables/internal/cash-out', fromService, async (req, res) => {
    const { userId, tableId, amount, kind } = req.body || {};
    const db = getDb();
    const amt = Math.round(Number(amount));
    if (!(amt > 0)) return res.json({ ok: true });
    balanceOf(db, Number(userId), cfg);
    // 'cash-out' (a stack, leaving a cash table), 'refund' (a sit and go's buy-in, off its list) or 'prize' (a place paid).
    move(db, Number(userId), amt, ['refund', 'prize'].includes(kind) ? kind : 'cash-out', String(tableId));
    await saveDatabase();
    res.json({ ok: true });
  });

  /* A sit and go is over: its places kept with the table (shown in its players' lists for a day), and the table
     marked finished, so it no longer counts among its host's open tables. */
  app.post('/api/tables/internal/sng-result', fromService, async (req, res) => {
    const r = req.body || {};
    const db = getDb();
    const t = tableRow(db, r.tableId);
    if (!t) return res.json({ ok: true });
    const c = JSON.parse(t.config);
    c.results = { places: Array.isArray(r.places) ? r.places : [], prizes: r.prizes || [], entrants: Number(r.entrants) || 0, buyIn: Number(r.buyIn) || 0, at: Number(r.at) || Date.now() };
    db.run("UPDATE play_tables SET config = ?, status = CASE WHEN status = 'open' THEN 'finished' ELSE status END WHERE id = ?", [JSON.stringify(c), t.id]);
    await saveDatabase();
    res.json({ ok: true });
  });

  /* Every hand to every player dealt in (decision 4), as they saw it, tagged with the table so Hands can filter it.
     The handId is the key: the outbox may send a hand twice. */
  app.post('/api/tables/internal/hand', fromService, async (req, res) => {
    const r = req.body || {};
    const db = getDb();
    let saved = 0;
    for (const p of r.players || []) {
      const uid = Number(p.userId);
      if (!uid || !p.hand) continue;
      // An account deleted while it sat at a table gets no hands written for it.
      if (!one(db, 'SELECT id FROM users WHERE id = ?', [uid])) continue;
      const hand = { ...p.hand, table: { id: r.tableId, name: r.tableName, handNo: r.handNo, handId: r.handId }, playedAt: new Date().toISOString() };
      const dup = one(db, "SELECT id FROM saved_hands WHERE user_id = ? AND json_extract(hand_data, '$.table.handId') = ?", [uid, r.handId]);
      if (dup) continue;
      db.run('INSERT INTO saved_hands (user_id, hand_data, game_type, title, notes, is_public) VALUES (?, ?, ?, ?, ?, 0)',
        [uid, JSON.stringify(hand), hand.gameType, `${r.tableName} · hand ${r.handNo}`, null]);
      saved++;
    }
    await saveDatabase();
    res.json({ ok: true, saved });
  });
}

module.exports = { migrate, mountRoutes, config, balanceOf, nyDay, removeReportedMessage, closeTablesInService };
