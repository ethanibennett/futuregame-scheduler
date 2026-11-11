'use strict';
/*
 * Hands, between people (Features 26, 27, 32; 2026-11-11).
 *
 * Import hand histories (32): POST /api/replayer/import { text, anonymise } reads PokerStars-format text with
 *   the strict reader in lib/hh-import (every game docs/hand-history-io.md §3 lists, refusals by code), keeps
 *   each hand's site, hand number and time, tags the batch "Imported <date>", and skips a hand already saved
 *   (by site and hand number). anonymise: opponents become "Opp 1…". 2 MB and 400 hands a request.
 *
 * Send a hand in the app (26): a hand link (hand_links, which already carries a hand) sent to friends or a
 *   group. hand_shares (link_id, from_user_id, to_user_id, group_id, step, created_at): a friend finds it
 *   under "Sent to you" and in the bell; a group gets it in its Live Feed (group_messages.kind = 'hand').
 *   hand_replies (link_id, user_id, street, action_idx, text, created_at): replies pinned to the street on
 *   screen when written. Only the sender, the people it was sent to and the group's members read them;
 *   anyone blocked either way is left out.
 *
 * Ask what they would do (27): a hand link with a stop (street, action). Opened, the replay plays to the
 *   stop and asks Fold / Call / Raise; GET /api/hand-links/:id hides the actions after the stop until the
 *   viewer has answered (POST /api/hand-links/:id/answer, one per device or account). hand_answers keeps the
 *   tally, which the sharer sees on the hand's row and everyone sees after answering.
 */
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS hand_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id TEXT NOT NULL,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER,
    group_id INTEGER,
    step INTEGER,
    title TEXT,
    created_at INTEGER NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_hand_shares_to ON hand_shares(to_user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hand_shares_link ON hand_shares(link_id)');
  db.run(`CREATE TABLE IF NOT EXISTS hand_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    street INTEGER,
    action_idx INTEGER,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_hand_replies_link ON hand_replies(link_id)');
  db.run(`CREATE TABLE IF NOT EXISTS hand_answers (
    link_id TEXT NOT NULL,
    who TEXT NOT NULL,
    choice TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (link_id, who)
  )`);
  // A group message can be a hand (Features 26).
  const info = db.exec('PRAGMA table_info(group_messages)');
  const have = new Set(info.length ? info[0].values.map((r) => r[1]) : []);
  if (info.length && !have.has('kind')) db.run("ALTER TABLE group_messages ADD COLUMN kind TEXT DEFAULT 'text'");
  if (info.length && !have.has('hand_link_id')) db.run('ALTER TABLE group_messages ADD COLUMN hand_link_id TEXT');
  const hl = db.exec('PRAGMA table_info(shared_hands)');
  const hlHave = new Set(hl.length ? hl[0].values.map((r) => r[1]) : []);
  if (hl.length && !hlHave.has('stop_street')) db.run('ALTER TABLE shared_hands ADD COLUMN stop_street INTEGER');
  if (hl.length && !hlHave.has('stop_action')) db.run('ALTER TABLE shared_hands ADD COLUMN stop_action INTEGER');
  if (hl.length && !hlHave.has('question_shorthand')) db.run('ALTER TABLE shared_hands ADD COLUMN question_shorthand TEXT');
}

/** A request's optional account, without refusing anyone (Features 27). */
function optionalAuthWith(jwt, secret) {
  return (req, res, next) => {
    const h = req.headers.authorization;
    const t = h && h.split(' ')[1];
    if (t) { try { req.user = jwt.verify(t, secret); } catch (_) { req.user = null; } }
    next();
  };
}

/**
 * GET /api/hand-links/:id's answer (Features 27). A question link gives the hand only as far as the stop until
 * this viewer has answered (or is its sharer); then the whole hand and the tally.
 */
function resolveLink(db, id, req) {
  const r = all(db, 'SELECT shorthand, question_shorthand, stop_street, stop_action, uploaded_by FROM shared_hands WHERE id = ?', [String(id)])[0];
  if (!r) return null;
  if (r.stop_street == null || !r.question_shorthand) return { shorthand: r.shorthand };
  const who = whoOf(req);
  const owner = req.user && !req.user.isGuest && Number(req.user.id) === Number(r.uploaded_by);
  const mine = who ? all(db, 'SELECT choice FROM hand_answers WHERE link_id = ? AND who = ?', [String(id), who])[0] : null;
  const question = { street: Number(r.stop_street), action: Number(r.stop_action) };
  if (!mine && !owner) return { shorthand: r.question_shorthand, question, answered: false };
  return { shorthand: r.shorthand, question, answered: true, choice: mine ? mine.choice : null, tally: tally(db, String(id)) };
}

function all(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

let importerP = null;
const importer = () => {
  if (!importerP) importerP = import(pathToFileURL(path.join(__dirname, 'hh-import', 'index.mjs')).href);
  return importerP;
};

const WORDS = {
  'unknown-format': 'not a hand history the app reads',
  'needs-sample': 'a site the app cannot read yet',
  malformed: 'the text is damaged',
  'unsupported-feature': 'a feature not yet replayable (run it twice, a straddle the site writes differently)',
  'unsupported-game': 'a game the replayer does not play',
  'unsupported-currency': 'a currency the replayer does not show',
  seating: 'the seats do not add up',
  inconsistent: 'the pot does not come out as the site says',
  duplicate: 'already saved',
};

/** Who answered: the account, else the device's id (one answer each). */
function whoOf(req) {
  if (req.user && !req.user.isGuest && req.user.id) return `u:${req.user.id}`;
  const d = String((req.body && req.body.device) || req.get('X-Device-Id') || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
  return d ? `d:${d}` : null;
}

function tally(db, linkId) {
  const out = { fold: 0, call: 0, raise: 0 };
  for (const r of all(db, 'SELECT choice, COUNT(*) AS n FROM hand_answers WHERE link_id = ? GROUP BY choice', [linkId])) out[r.choice] = Number(r.n);
  return out;
}

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireRegistered, blockSet, notify, broadcastToGroup, optionalAuth } = deps;
  const importsBy = new Map();

  // ── Import (32) ──
  app.post('/api/replayer/import', authenticateToken, requireRegistered, async (req, res) => {
    try {
      const uid = req.user.id;
      const now = Date.now();
      const recent = (importsBy.get(uid) || []).filter((t) => t > now - 3600e3);
      if (recent.length >= 20) return res.status(429).json({ error: 'That is twenty imports this hour. Try again later.' });
      const text = String((req.body && req.body.text) || '');
      if (!text.trim()) return res.status(400).json({ error: 'Paste or choose a hand-history file' });
      if (text.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'That file is over 2 MB; split it and import the parts' });
      const { parseHandHistory, HandHistoryError } = await importer();
      let parsed;
      try { parsed = parseHandHistory(text); }
      catch (e) {
        if (e instanceof HandHistoryError) return res.status(400).json({ error: `Not imported: ${WORDS[e.code] || e.message}`, code: e.code });
        throw e;
      }
      const db = getDb();
      const day = new Date().toISOString().slice(0, 10);
      const tag = `Imported ${day}`;
      const skipped = parsed.errors.map((e) => ({ handId: e.handId || null, code: e.code, why: WORDS[e.code] || e.message }));
      let saved = 0, dupes = 0;
      const dryRun = !!(req.body && req.body.dryRun);
      for (const h of parsed.hands.slice(0, 400)) {
        const hid = h.import && h.import.handId ? String(h.import.handId) : null;
        if (hid && all(db, 'SELECT 1 FROM saved_hands WHERE user_id = ? AND instr(hand_data, ?) > 0 LIMIT 1', [uid, `"handId":"${hid}"`]).length) {
          dupes += 1; continue;
        }
        if (dryRun) { saved += 1; continue; }
        const hand = { ...h, tags: [...new Set([...(h.tags || []), tag])] };
        if (req.body && req.body.anonymise && Array.isArray(hand.players)) {
          let n = 0;
          hand.players = hand.players.map((p, i) => (i === hand.heroIdx ? p : { ...p, name: `Opp ${++n}` }));
        }
        const when = h.import && h.import.playedAt ? new Date(h.import.playedAt) : null;
        const stamp = when && !Number.isNaN(when.getTime()) ? when.toISOString().replace('T', ' ').slice(0, 19) : null;
        db.run(`INSERT INTO saved_hands (user_id, hand_data, game_type, title, notes, is_public${stamp ? ', created_at' : ''}) VALUES (?, ?, ?, ?, ?, 0${stamp ? ', ?' : ''})`,
          [uid, JSON.stringify(hand), hand.gameType || 'custom', hand.title || null, null, ...(stamp ? [stamp] : [])]);
        saved += 1;
      }
      if (!dryRun && saved) await saveDatabase();
      recent.push(now);
      importsBy.set(uid, recent);
      res.json({ site: parsed.site, read: parsed.hands.length + parsed.errors.length, saved, duplicates: dupes, skipped, tag, more: parsed.hands.length > 400 });
    } catch (err) {
      console.error('[import] failed:', err.message);
      res.status(500).json({ error: 'The import failed. Nothing was saved.' });
    }
  });

  // ── Send a hand in the app (26) ──
  app.post('/api/hand-shares', authenticateToken, requireRegistered, async (req, res) => {
    try {
      const db = getDb();
      const b = req.body || {};
      const linkId = String(b.linkId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
      if (!linkId || !all(db, 'SELECT 1 FROM shared_hands WHERE id = ?', [linkId]).length) return res.status(400).json({ error: 'Share the hand as a link first' });
      const title = typeof b.title === 'string' ? b.title.slice(0, 80) : null;
      const step = Number.isInteger(b.step) ? b.step : null;
      const hidden = blockSet(db, req.user.id);
      const friends = (Array.isArray(b.toUserIds) ? b.toUserIds : []).map(Number).filter((n) => n > 0 && !hidden.has(n)).slice(0, 30);
      const groups = (Array.isArray(b.groupIds) ? b.groupIds : []).map(Number).filter((n) => n > 0).slice(0, 10);
      const now = Date.now();
      let sent = 0;
      for (const to of friends) {
        // Only to a connection.
        const conn = all(db, "SELECT 1 FROM share_requests WHERE status = 'accepted' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)) LIMIT 1", [req.user.id, to, to, req.user.id]);
        if (!conn.length) continue;
        db.run('INSERT INTO hand_shares (link_id, from_user_id, to_user_id, step, title, created_at) VALUES (?, ?, ?, ?, ?, ?)', [linkId, req.user.id, to, step, title, now]);
        sent += 1;
        notify(to, 'hand', { title: `${req.user.username} sent you a hand`, body: title || 'Open it on the replay', url: `/h/${linkId}`, ref: `${linkId}:${req.user.id}`, pushKind: 'hands' });
      }
      for (const gid of groups) {
        if (!all(db, 'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [gid, req.user.id]).length) continue;
        db.run('INSERT INTO hand_shares (link_id, from_user_id, group_id, step, title, created_at) VALUES (?, ?, ?, ?, ?, ?)', [linkId, req.user.id, gid, step, title, now]);
        db.run("INSERT INTO group_messages (group_id, user_id, message, kind, hand_link_id) VALUES (?, ?, ?, 'hand', ?)", [gid, req.user.id, title || 'A hand', linkId]);
        const msgId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        sent += 1;
        if (broadcastToGroup) broadcastToGroup(gid, 'group-message', { groupId: gid, userId: req.user.id, username: req.user.username, message: title || 'A hand', kind: 'hand', handLinkId: linkId, createdAt: new Date().toISOString(), id: msgId });
      }
      await saveDatabase();
      res.json({ sent });
    } catch (err) {
      console.error('[hand-shares] send failed:', err.message);
      res.status(500).json({ error: 'The hand was not sent' });
    }
  });

  app.get('/api/hand-shares/inbox', authenticateToken, requireRegistered, (req, res) => {
    const hidden = blockSet(getDb(), req.user.id);
    const rows = all(getDb(), `SELECT s.id, s.link_id, s.title, s.step, s.created_at, u.id AS from_id, u.username, u.real_name, u.avatar,
        (SELECT COUNT(*) FROM hand_replies r WHERE r.link_id = s.link_id) AS replies
      FROM hand_shares s JOIN users u ON u.id = s.from_user_id WHERE s.to_user_id = ? ORDER BY s.created_at DESC LIMIT 60`, [req.user.id]);
    res.json({ hands: rows.filter((r) => !hidden.has(Number(r.from_id))) });
  });

  // Who may read a hand's replies: its sharer, anyone it was sent to, and members of a group it went to.
  const mayRead = (db, linkId, uid) => {
    if (all(db, 'SELECT 1 FROM shared_hands WHERE id = ? AND uploaded_by = ?', [linkId, uid]).length) return true;
    if (all(db, 'SELECT 1 FROM hand_shares WHERE link_id = ? AND (to_user_id = ? OR from_user_id = ?) LIMIT 1', [linkId, uid, uid]).length) return true;
    return all(db, 'SELECT 1 FROM hand_shares s JOIN group_members m ON m.group_id = s.group_id WHERE s.link_id = ? AND m.user_id = ? LIMIT 1', [linkId, uid]).length > 0;
  };

  app.get('/api/hand-links/:id/replies', authenticateToken, requireRegistered, (req, res) => {
    const db = getDb();
    const id = String(req.params.id);
    if (!mayRead(db, id, req.user.id)) return res.json({ replies: [], canReply: false });
    const hidden = blockSet(db, req.user.id);
    const rows = all(db, `SELECT r.id, r.street, r.action_idx, r.text, r.created_at, u.id AS user_id, u.username, u.real_name
      FROM hand_replies r JOIN users u ON u.id = r.user_id WHERE r.link_id = ? ORDER BY r.created_at`, [id]);
    res.json({ replies: rows.filter((r) => !hidden.has(Number(r.user_id))), canReply: true });
  });

  app.post('/api/hand-links/:id/replies', authenticateToken, requireRegistered, async (req, res) => {
    const db = getDb();
    const id = String(req.params.id);
    if (!mayRead(db, id, req.user.id)) return res.status(403).json({ error: 'This hand was not sent to you' });
    const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 500) : '';
    if (!text) return res.status(400).json({ error: 'Write something' });
    const street = Number.isInteger(req.body.street) ? req.body.street : null;
    const action = Number.isInteger(req.body.action) ? req.body.action : null;
    db.run('INSERT INTO hand_replies (link_id, user_id, street, action_idx, text, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, req.user.id, street, action, text, Date.now()]);
    await saveDatabase();
    // Everyone else on the hand hears of it (their Hands switch).
    const people = new Set();
    for (const r of all(db, 'SELECT from_user_id, to_user_id FROM hand_shares WHERE link_id = ?', [id])) { people.add(Number(r.from_user_id)); if (r.to_user_id) people.add(Number(r.to_user_id)); }
    people.delete(Number(req.user.id));
    const hidden = blockSet(db, req.user.id);
    for (const p of people) if (!hidden.has(p)) notify(p, 'hand', { title: `${req.user.username} replied on a hand`, body: text.slice(0, 120), url: `/h/${id}`, ref: `reply:${id}`, pushKind: 'hands' });
    res.status(201).json({ ok: true });
  });

  // ── Ask what they would do (27) ──
  app.post('/api/hand-links/:id/answer', optionalAuth, async (req, res) => {
    const db = getDb();
    const id = String(req.params.id);
    const link = all(db, 'SELECT stop_street FROM shared_hands WHERE id = ?', [id])[0];
    if (!link || link.stop_street == null) return res.status(404).json({ error: 'This hand asks nothing' });
    const choice = String((req.body && req.body.choice) || '');
    if (!['fold', 'call', 'raise'].includes(choice)) return res.status(400).json({ error: 'Fold, Call or Raise' });
    const who = whoOf(req);
    if (!who) return res.status(400).json({ error: 'No device id' });
    db.run('INSERT OR IGNORE INTO hand_answers (link_id, who, choice, created_at) VALUES (?, ?, ?, ?)', [id, who, choice, Date.now()]);
    await saveDatabase();
    res.json({ tally: tally(db, id) });
  });

  app.get('/api/hand-links/:id/tally', optionalAuth, (req, res) => {
    const db = getDb();
    const id = String(req.params.id);
    const who = whoOf(req);
    const mine = who ? all(db, 'SELECT choice FROM hand_answers WHERE link_id = ? AND who = ?', [id, who])[0] : null;
    const owner = req.user && all(db, 'SELECT 1 FROM shared_hands WHERE id = ? AND uploaded_by = ?', [id, req.user.id]).length > 0;
    // The tally is shown after an answer, and always to the sharer.
    if (!mine && !owner) return res.json({ answered: false });
    res.json({ answered: !!mine, choice: mine ? mine.choice : null, tally: tally(db, id) });
  });
}

module.exports = { migrate, mountRoutes, tally, WORDS, resolveLink, optionalAuthWith };
