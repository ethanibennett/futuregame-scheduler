'use strict';
/*
 * Hands said on the Apple Watch (owner, 2026-11-19: "Apple Watch: dictation through quick add").
 *
 * Pairing, with nothing typed on the Watch:
 *   POST /api/watch/pair                 (no account)  → { pairId, code, expiresAt }: the Watch shows the code
 *   GET  /api/watch/pair/:pairId         (no account)  → { status: 'waiting' } until claimed, then
 *                                                        { status: 'paired', token } ONCE (the row goes)
 *   POST /api/watch/pair/claim { code }  (signed in, quick add's admins) → { ok, device }
 *   GET  /api/watch/devices · DELETE /api/watch/devices/:id   (signed in) the paired Watches, Unpair
 * A Watch token is not a session: it opens /api/watch/hands only, is kept hashed (watch_tokens), stops
 * working the moment its Watch is unpaired, and stops when the account is no longer a quick add admin.
 *
 * A hand:
 *   POST /api/watch/hands { text }       (Watch token) the dictation is kept in quick_add_inbox at once, then
 *                                        read by quick add's parser as speech; the Watch is told what was
 *                                        understood and how many questions wait on the phone
 *   GET  /api/watch/hands                (Watch token) the last few, for the Watch's list
 *   GET  /api/quick-add/inbox            (signed in)   what the phone has to finish (Hands › From your Watch)
 *   POST /api/quick-add/inbox/:id/done   (signed in)   finished (saved) or thrown away
 */

const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');

const PAIR_TTL_MS = 10 * 60 * 1000;
const PARSE_BUDGET_MS = 25 * 1000; // the Watch waits this long for a summary; the hand is kept regardless
const INBOX_KEEP_MS = 30 * 24 * 3600 * 1000;

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS watch_pairings (
    pair_id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_id INTEGER,
    token TEXT,
    device TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS watch_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    device TEXT,
    created_at INTEGER NOT NULL,
    last_used INTEGER,
    revoked_at INTEGER
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_watch_tokens_user ON watch_tokens(user_id)');
  db.run(`CREATE TABLE IF NOT EXISTS quick_add_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    origin TEXT NOT NULL DEFAULT 'watch',
    text TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'speech',
    status TEXT NOT NULL DEFAULT 'new',
    hand TEXT,
    notes TEXT,
    summary TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_quick_add_inbox_user ON quick_add_inbox(user_id, status)');
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rows = (db, sql, params) => {
  const st = db.prepare(sql);
  const out = [];
  try { st.bind(params || []); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
  return out;
};
const json = (s) => { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } };

/* A small sliding-window limiter per key, in memory (a restart forgives everyone). */
function limiter(limit, windowMs) {
  const hits = new Map();
  return (key) => {
    const t = Date.now();
    const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (list.length >= limit) { hits.set(key, list); return false; }
    list.push(t); hits.set(key, list);
    return true;
  };
}

/* The gaps engine is the client's (ESM, vite-app); the server loads it once, lazily, to count the questions
   a hand still has. Missing or failing, the Watch is simply not told the count. */
let gapsModule = null;
async function questionsFor(hand) {
  try {
    if (!gapsModule) gapsModule = await import(pathToFileURL(path.join(__dirname, '..', 'vite-app', 'src', 'utils', 'quick-add', 'gaps.js')).href);
    return gapsModule.findGaps(hand).filter((g) => g.blocking && !g.provisional).length;
  } catch (_) {
    return null;
  }
}

const chips = (v) => {
  const n = Number(v);
  if (!(n > 0)) return null;
  if (n >= 1e6) return +(n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M';
  if (n >= 1e4) return +(n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'k';
  return n.toLocaleString('en-US');
};
const spaced = (s) => (String(s || '').match(/[2-9TJQKA][hdcsx]/g) || []).join(' ');

/** What the Watch shows for a parsed hand: a title and two or three short lines. */
function summarize(hand, questions) {
  if (!hand) return null;
  const b = hand.blinds || {};
  const stakes = b.bb ? `${chips(b.sb) || '?'}/${chips(b.bb)}` : null;
  const title = [hand.gameType || 'Hand', stakes].filter(Boolean).join(' ');
  const streets = Array.isArray(hand.streets) ? hand.streets : [];
  const hero = spaced(streets[0] && streets[0].cards && streets[0].cards.hero);
  const board = spaced(streets.map((s) => (s && s.cards && s.cards.board) || '').join(''));
  const lines = [];
  if (hero) lines.push('You: ' + hero);
  if (board) lines.push('Board: ' + board);
  const acted = streets.filter((s) => s && Array.isArray(s.actions) && s.actions.length).length;
  if (acted) lines.push(acted === 1 ? '1 street of action' : `${acted} streets of action`);
  const next = questions == null ? 'Finish it in Hands on your phone.'
    : questions === 0 ? 'Ready: open it in Hands to save.'
      : `${questions} question${questions === 1 ? '' : 's'} to answer in Hands on your phone.`;
  return { title, lines, questions, next };
}

function mountRoutes(app, deps) {
  const { getDb, authenticateToken, requireRegistered, isAdmin, getClient, parseHand, validateParseBody, log = console } = deps;
  const saveDatabase = () => Promise.resolve(deps.saveDatabase()).catch((e) => log.error('[watch] save failed:', e && e.message));
  const pairLimit = limiter(12, 60 * 60 * 1000);
  const claimLimit = limiter(10, 10 * 60 * 1000);
  const handLimit = limiter(30, 60 * 60 * 1000);
  const ip = (req) => String(req.ip || (req.socket && req.socket.remoteAddress) || '?');
  const admin = (req, res, next) => (req.user && isAdmin(req.user) ? next() : res.status(403).json({ error: 'Hands from the Watch are for quick add\'s admins for now.' }));

  const sweep = (db) => {
    db.run('DELETE FROM watch_pairings WHERE expires_at < ?', [Date.now()]);
    db.run("DELETE FROM quick_add_inbox WHERE status = 'done' AND updated_at < ?", [Date.now() - INBOX_KEEP_MS]);
  };

  // ── Pairing ──
  app.post('/api/watch/pair', (req, res) => {
    if (!pairLimit(ip(req))) return res.status(429).json({ error: 'Too many pairing codes; try again later.' });
    const db = getDb();
    sweep(db);
    const live = new Set(rows(db, 'SELECT code FROM watch_pairings').map((r) => r.code));
    let code;
    do { code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'); } while (live.has(code));
    const pairId = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const device = typeof (req.body && req.body.device) === 'string' ? req.body.device.replace(/[^\w .'’()+-]/g, '').slice(0, 40) || null : null;
    db.run('INSERT INTO watch_pairings (pair_id, code, created_at, expires_at, device) VALUES (?, ?, ?, ?, ?)', [pairId, code, now, now + PAIR_TTL_MS, device]);
    saveDatabase();
    res.json({ pairId, code, expiresAt: now + PAIR_TTL_MS });
  });

  app.get('/api/watch/pair/:pairId', (req, res) => {
    const db = getDb();
    const r = rows(db, 'SELECT * FROM watch_pairings WHERE pair_id = ?', [String(req.params.pairId)])[0];
    if (!r || r.expires_at < Date.now()) return res.status(404).json({ error: 'That code has expired. Ask for a new one.' });
    if (!r.token) return res.json({ status: 'waiting', expiresAt: r.expires_at });
    // The token goes to the Watch once; the row that held it goes with it.
    db.run('DELETE FROM watch_pairings WHERE pair_id = ?', [r.pair_id]);
    saveDatabase();
    res.json({ status: 'paired', token: r.token });
  });

  app.post('/api/watch/pair/claim', authenticateToken, requireRegistered, admin, (req, res) => {
    if (!claimLimit(String(req.user.id))) return res.status(429).json({ error: 'Too many tries; wait a few minutes.' });
    const code = String((req.body && req.body.code) || '').replace(/\D/g, '');
    if (code.length !== 6) return res.status(400).json({ error: 'The code on your Watch has six digits.' });
    const db = getDb();
    sweep(db);
    const r = rows(db, 'SELECT * FROM watch_pairings WHERE code = ? AND token IS NULL AND expires_at >= ?', [code, Date.now()])[0];
    if (!r) return res.status(404).json({ error: 'No Watch is showing that code. Check it, or ask the Watch for a new one.' });
    const token = 'fgw_' + crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const device = r.device || 'Apple Watch';
    db.run('INSERT INTO watch_tokens (user_id, token_hash, device, created_at) VALUES (?, ?, ?, ?)', [Number(req.user.id), sha(token), device, now]);
    db.run('UPDATE watch_pairings SET user_id = ?, token = ? WHERE pair_id = ?', [Number(req.user.id), token, r.pair_id]);
    saveDatabase();
    res.json({ ok: true, device });
  });

  app.get('/api/watch/devices', authenticateToken, requireRegistered, admin, (req, res) => {
    const list = rows(getDb(), 'SELECT id, device, created_at, last_used FROM watch_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC', [Number(req.user.id)]);
    res.json({ devices: list.map((d) => ({ id: d.id, device: d.device || 'Apple Watch', pairedAt: d.created_at, lastUsed: d.last_used || null })) });
  });

  app.delete('/api/watch/devices/:id', authenticateToken, requireRegistered, admin, (req, res) => {
    const db = getDb();
    db.run('UPDATE watch_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [Date.now(), Number(req.params.id), Number(req.user.id)]);
    saveDatabase();
    res.json({ ok: true });
  });

  // ── The Watch's own routes: its token, never a session ──
  const watchAuth = (req, res, next) => {
    const m = /^Bearer\s+(fgw_[0-9a-f]{64})$/.exec(String(req.headers.authorization || ''));
    if (!m) return res.status(401).json({ error: 'This Watch is not paired.' });
    const db = getDb();
    const t = rows(db, 'SELECT id, user_id FROM watch_tokens WHERE token_hash = ? AND revoked_at IS NULL', [sha(m[1])])[0];
    if (!t) return res.status(401).json({ error: 'This Watch is not paired.' });
    const u = rows(db, 'SELECT id, username FROM users WHERE id = ?', [t.user_id])[0];
    if (!u || !isAdmin({ username: u.username })) return res.status(403).json({ error: 'Hands from the Watch are for quick add\'s admins for now.' });
    db.run('UPDATE watch_tokens SET last_used = ? WHERE id = ?', [Date.now(), t.id]);
    req.watch = { tokenId: t.id, userId: u.id, username: u.username };
    next();
  };

  const view = (r) => ({
    id: r.id, createdAt: r.created_at, status: r.status,
    text: r.text, summary: json(r.summary), error: r.error || null,
  });

  app.post('/api/watch/hands', watchAuth, async (req, res) => {
    let input;
    try {
      input = validateParseBody({ text: req.body && req.body.text, source: 'speech' });
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    if (!handLimit(String(req.watch.userId))) return res.status(429).json({ error: 'Too many hands in an hour; it was not kept. Try again later.' });
    const db = getDb();
    const now = Date.now();
    db.run('INSERT INTO quick_add_inbox (user_id, origin, text, source, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.watch.userId, 'watch', input.text, 'speech', 'new', now, now]);
    const id = rows(db, 'SELECT last_insert_rowid() AS id')[0].id;
    saveDatabase();

    const client = getClient();
    if (!client) return res.json({ id, status: 'new', summary: null, kept: true, message: 'Kept. Read it in Hands on your phone.' });
    const t0 = Date.now();
    let out = null, error = null;
    try {
      out = await Promise.race([
        parseHand({ client, text: input.text, source: 'speech', hints: {}, log }),
        new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('The hand reader took too long; it waits in Hands.'), { status: 504 })), PARSE_BUDGET_MS)),
      ]);
    } catch (e) {
      error = (e && e.message) || 'The hand could not be read.';
    }
    const db2 = getDb();
    if (out && out.hand) {
      const questions = await questionsFor(out.hand);
      const summary = summarize(out.hand, questions);
      db2.run("UPDATE quick_add_inbox SET status = 'parsed', hand = ?, notes = ?, summary = ?, error = NULL, updated_at = ? WHERE id = ?",
        [JSON.stringify(out.hand), JSON.stringify(out.notes || []), JSON.stringify(summary), Date.now(), id]);
      saveDatabase();
      log.log(`[watch] hand ${id} user=${req.watch.username} chars=${input.text.length} parsed ms=${Date.now() - t0} questions=${questions}`);
      return res.json({ id, status: 'parsed', summary, kept: true });
    }
    db2.run("UPDATE quick_add_inbox SET status = 'failed', error = ?, updated_at = ? WHERE id = ?", [String(error).slice(0, 300), Date.now(), id]);
    saveDatabase();
    log.log(`[watch] hand ${id} user=${req.watch.username} chars=${input.text.length} not read: ${error}`);
    res.json({ id, status: 'failed', summary: null, kept: true, message: 'Kept, but not read yet. It waits in Hands on your phone.' });
  });

  app.get('/api/watch/hands', watchAuth, (req, res) => {
    const list = rows(getDb(), "SELECT * FROM quick_add_inbox WHERE user_id = ? AND origin = 'watch' ORDER BY id DESC LIMIT 10", [req.watch.userId]);
    res.json({ hands: list.map((r) => ({ ...view(r), text: r.text.slice(0, 140) })) });
  });

  // The Watch's own Unpair: its token stops working at once.
  app.delete('/api/watch/self', watchAuth, (req, res) => {
    getDb().run('UPDATE watch_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [Date.now(), req.watch.tokenId]);
    saveDatabase();
    res.json({ ok: true });
  });

  // ── The phone's side ──
  app.get('/api/quick-add/inbox', authenticateToken, requireRegistered, admin, (req, res) => {
    const list = rows(getDb(), "SELECT * FROM quick_add_inbox WHERE user_id = ? AND status != 'done' ORDER BY id DESC LIMIT 20", [Number(req.user.id)]);
    res.json({ hands: list.map((r) => ({ ...view(r), hand: json(r.hand), notes: json(r.notes) || [] })) });
  });

  app.post('/api/quick-add/inbox/:id/done', authenticateToken, requireRegistered, admin, (req, res) => {
    const db = getDb();
    db.run("UPDATE quick_add_inbox SET status = 'done', updated_at = ? WHERE id = ? AND user_id = ?", [Date.now(), Number(req.params.id), Number(req.user.id)]);
    saveDatabase();
    res.json({ ok: true });
  });
}

module.exports = { migrate, mountRoutes, summarize, PAIR_TTL_MS };
