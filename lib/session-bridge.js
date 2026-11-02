'use strict';
/*
 * The session bridge (owner, 2026-11-02: "build the MCP connector so that I can talk to this code session
 * with Claude chat"). claude.ai chat cannot reach a Claude Code session on the PC, so futurega.me relays:
 *
 *   claude.ai chat ──(MCP connector, lib/mcp: session_send / session_read / session_approve / session_status)──▶
 *   futurega.me  session_bridge table  ◀──(polls, BRIDGE_TOKEN)── scripts/session-bridge-channel.mjs ──(stdio
 *   channel: notifications/claude/channel)──▶ a Claude Code CLI session on the PC
 *
 * Replies come back the same way: the session calls the channel's `reply` tool, the channel posts them here,
 * session_read hands them to chat. Tool approvals too (Claude Code's permission relay): the session's
 * permission request is posted here, chat answers with session_approve, the channel delivers the verdict.
 *
 *   session_bridge  one row per item: kind 'message' (chat → session), 'reply' (session → chat), 'permission'
 *                   (the session asks to use a tool), 'verdict' (chat's answer); taken_at = delivered to the
 *                   other side (a permission row is closed by its verdict instead).
 *
 * The PC's side authenticates with BRIDGE_TOKEN (Authorization: Bearer, constant time, 32+ characters; unset =
 * the routes are OFF and answer 404). Chat's side is the MCP connector's own secret (MCP_TOKEN). Both act as
 * the owner, so both are passwords. Nothing here is logged but counts.
 */
const { checkSharedToken, bearerOf } = require('./shared-token');

const MAX_TEXT = 20000;
const ONLINE_MS = 30 * 1000;
let lastPoll = 0;   // when the PC's channel last asked for its inbox (ms), in memory: a restart reads offline

function rowsOf(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const one = (db, sql, params) => rowsOf(db, sql, params)[0] || null;
const now = () => new Date().toISOString();

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS session_bridge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    body TEXT,
    request_id TEXT,
    meta TEXT,
    created_at TEXT NOT NULL,
    taken_at TEXT)`);
  db.run('CREATE INDEX IF NOT EXISTS idx_session_bridge_kind ON session_bridge(kind, taken_at)');
}

const tokenOn = () => String(process.env.BRIDGE_TOKEN || '').trim().length >= 32;
const lastId = (db) => (one(db, 'SELECT last_insert_rowid() AS id') || {}).id;
const clip = (v, max = MAX_TEXT) => String(v == null ? '' : v).slice(0, max);

// ── what chat's tools call (lib/mcp) ─────────────────────────────────────────────────────────

function status(db) {
  const pendingMessages = (one(db, "SELECT COUNT(*) AS n FROM session_bridge WHERE kind = 'message' AND taken_at IS NULL") || {}).n || 0;
  const unreadReplies = (one(db, "SELECT COUNT(*) AS n FROM session_bridge WHERE kind = 'reply' AND taken_at IS NULL") || {}).n || 0;
  const openPermissions = openPermissionRows(db).length;
  return {
    bridgeOn: tokenOn(),
    sessionOnline: Date.now() - lastPoll < ONLINE_MS,
    lastPollAt: lastPoll ? new Date(lastPoll).toISOString() : null,
    pendingMessages, unreadReplies, openPermissions,
  };
}

function send(db, text) {
  const body = clip(text).trim();
  if (!body) return { error: 'Nothing to send' };
  db.run("INSERT INTO session_bridge (kind, body, created_at) VALUES ('message', ?, ?)", [body, now()]);
  return { id: lastId(db), ...status(db) };
}

function openPermissionRows(db) {
  return rowsOf(db, `SELECT p.id, p.request_id, p.body, p.meta, p.created_at FROM session_bridge p
    WHERE p.kind = 'permission' AND NOT EXISTS (SELECT 1 FROM session_bridge v WHERE v.kind = 'verdict' AND v.request_id = p.request_id)
    ORDER BY p.id`, []);
}

/** Unread replies (marked read) and the permission requests still waiting for an answer. */
function read(db) {
  const replies = rowsOf(db, "SELECT id, body, created_at FROM session_bridge WHERE kind = 'reply' AND taken_at IS NULL ORDER BY id", []);
  if (replies.length) db.run(`UPDATE session_bridge SET taken_at = ? WHERE id IN (${replies.map(() => '?').join(',')})`, [now(), ...replies.map((r) => r.id)]);
  const permissions = openPermissionRows(db).map((p) => {
    let m = {};
    try { m = JSON.parse(p.meta || '{}'); } catch (_) { /* */ }
    return { requestId: p.request_id, tool: m.tool_name || null, description: p.body || '', inputPreview: m.input_preview || '', at: p.created_at };
  });
  return { replies: replies.map((r) => ({ id: r.id, text: r.body, at: r.created_at })), permissions };
}

function approve(db, requestId, allow) {
  const rid = clip(requestId, 100);
  const open = openPermissionRows(db).find((p) => p.request_id === rid);
  if (!open) return { error: 'No open permission request with that id' };
  db.run("INSERT INTO session_bridge (kind, request_id, body, created_at) VALUES ('verdict', ?, ?, ?)", [rid, allow ? 'allow' : 'deny', now()]);
  return { ok: true, requestId: rid, behavior: allow ? 'allow' : 'deny' };
}

// ── the PC's channel ──────────────────────────────────────────────────────────────────────────

function mountRoutes(app, { getDb, saveDatabase, log = console.log }) {
  log(tokenOn() ? '[session-bridge] ON: the PC channel may poll /api/session-bridge/*'
    : '[session-bridge] OFF: BRIDGE_TOKEN is not set (32+ characters turn it on)');
  const gate = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!tokenOn()) return res.status(404).json({ error: 'Not found' });
    const ok = checkSharedToken(bearerOf(req), { current: String(process.env.BRIDGE_TOKEN || '').trim(), previous: String(process.env.BRIDGE_TOKEN_PREVIOUS || '').trim() });
    if (!ok.ok) return res.status(404).json({ error: 'Not found' });
    next();
  };

  // Everything waiting for the session: chat's messages and chat's verdicts, each handed over once.
  app.get('/api/session-bridge/inbox', gate, async (req, res) => {
    const db = getDb();
    lastPoll = Date.now();
    const messages = rowsOf(db, "SELECT id, body, created_at FROM session_bridge WHERE kind = 'message' AND taken_at IS NULL ORDER BY id", []);
    const verdicts = rowsOf(db, "SELECT id, request_id, body FROM session_bridge WHERE kind = 'verdict' AND taken_at IS NULL ORDER BY id", []);
    const ids = [...messages, ...verdicts].map((r) => r.id);
    if (ids.length) {
      db.run(`UPDATE session_bridge SET taken_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`, [now(), ...ids]);
      await saveDatabase();
    }
    res.json({
      messages: messages.map((m) => ({ id: m.id, text: m.body, at: m.created_at })),
      verdicts: verdicts.map((v) => ({ requestId: v.request_id, behavior: v.body === 'allow' ? 'allow' : 'deny' })),
    });
  });

  app.post('/api/session-bridge/reply', gate, async (req, res) => {
    const text = clip(req.body && req.body.text).trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const db = getDb();
    db.run("INSERT INTO session_bridge (kind, body, created_at) VALUES ('reply', ?, ?)", [text, now()]);
    await saveDatabase();
    res.json({ ok: true, id: lastId(db) });
  });

  app.post('/api/session-bridge/permission', gate, async (req, res) => {
    const b = req.body || {};
    const rid = clip(b.request_id, 100).trim();
    if (!rid) return res.status(400).json({ error: 'request_id is required' });
    const db = getDb();
    if (!one(db, "SELECT id FROM session_bridge WHERE kind = 'permission' AND request_id = ?", [rid])) {
      db.run("INSERT INTO session_bridge (kind, request_id, body, meta, created_at) VALUES ('permission', ?, ?, ?, ?)",
        [rid, clip(b.description, 2000), JSON.stringify({ tool_name: clip(b.tool_name, 100), input_preview: clip(b.input_preview, 2000) }), now()]);
      await saveDatabase();
    }
    res.json({ ok: true });
  });
}

module.exports = { migrate, mountRoutes, status, send, read, approve, tokenOn };
