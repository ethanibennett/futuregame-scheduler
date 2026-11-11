'use strict';
/*
 * Download everything the account holds (Features 45, 2026-11-11). POST /api/account/export asks for the
 * password (the file holds results, backers' names and their links), builds one ZIP and answers with a link
 * that lasts 24 hours: GET /api/account/export/<token>. The ZIP is kept in this process only, one per
 * account; a restart forgets it and Prepare makes another.
 *
 * In it: README.txt (what each file is), my-schedule.csv (the saved events with their names), every
 * table of the account's own rows as CSV (results, live updates, cash sessions and stacks, the bankrolls
 * and their ledger, trips, expenses, staking and backers, tickets, notes), hands.json (every saved hand,
 * every game) and hands-pokerstars.txt (those the hand-history writer can write: hold'em and Omaha).
 */
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const { zip } = require('./zip');

const TTL = 24 * 3600e3;
const ready = new Map();   // token -> { userId, buf, at, name }

// Tables whose rows carry the account's user_id. Missing tables are skipped.
const TABLES = [
  'tracking_entries', 'live_updates', 'cash_sessions', 'cash_session_stacks', 'bankrolls', 'bankroll_transactions',
  'bankroll_adjustments', 'bankroll_trips', 'bankroll_prefs', 'money_locations', 'money_settings', 'session_extras',
  'staking_series', 'backers', 'standing_agreements', 'tickets', 'room_follows', 'tax_paid', 'packages',
  'notification_prefs', 'replayer_games', 'trainer_hands',
];
// Never in the file: secrets of the account's own, and what other people wrote.
const DROP_COLS = new Set(['password', 'token_version', 'app_account_token']);

function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]).filter((c) => !DROP_COLS.has(c));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

function all(db, sql, params) {
  const st = db.prepare(sql);
  try { st.bind(params || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

function tableHasUserId(db, t) {
  const info = db.exec(`PRAGMA table_info(${t})`);
  return info.length ? info[0].values.some((r) => r[1] === 'user_id') : false;
}

let writerP = null;
function handWriter() {
  if (!writerP) {
    const file = path.join(__dirname, '..', 'vite-app', 'src', 'utils', 'hand-history', 'index.js');
    const rows = path.join(__dirname, '..', 'vite-app', 'src', 'utils', 'hand-history', 'rows.js');
    writerP = Promise.all([import(pathToFileURL(file).href), import(pathToFileURL(rows).href)]).catch(() => null);
  }
  return writerP;
}

async function buildExport(db, userId, { heroName = null } = {}) {
  const uid = Number(userId);
  const files = [];
  const sched = all(db, `SELECT t.date, t.time, t.venue, t.event_number, t.event_name, t.buyin, t.currency, t.game_variant,
      us.planned_entries, us.not_played, us.added_at AS saved_at
    FROM user_schedules us JOIN tournaments t ON t.id = us.tournament_id WHERE us.user_id = ? ORDER BY t.date, t.time`, [uid]);
  files.push({ name: 'my-schedule.csv', data: toCsv(sched) });
  for (const t of TABLES) {
    if (!all(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [t]).length) continue;
    if (!tableHasUserId(db, t)) continue;
    const rows = all(db, `SELECT * FROM ${t} WHERE user_id = ?`, [uid]);
    if (rows.length) files.push({ name: `${t.replace(/_/g, '-')}.csv`, data: toCsv(rows) });
  }
  const hands = all(db, 'SELECT id, title, game_type, hand_data, notes, created_at FROM saved_hands WHERE user_id = ? ORDER BY id', [uid]);
  const parsed = hands.map((h) => { let d = null; try { d = JSON.parse(h.hand_data); } catch (_) { /* kept raw */ } return { ...h, hand_data: d || h.hand_data }; });
  files.push({ name: 'hands.json', data: JSON.stringify(parsed, null, 2) });
  let hhNote = 'No hands could be written as hand-history text.';
  const w = await handWriter();
  if (w && hands.length) {
    const [hh, rows] = w;
    const entries = parsed.filter((h) => h.hand_data && typeof h.hand_data === 'object')
      .map((h) => ({ hand: rows.handOfRow(h.hand_data), playedAt: rows.playedAtOf(h) || new Date() }));
    try {
      const r = hh.writePokerStarsFile(entries, heroName ? { heroName } : {});
      if (r.written.length) {
        files.push({ name: 'hands-pokerstars.txt', data: r.text });
        hhNote = `${r.written.length} of ${entries.length} hands are in hands-pokerstars.txt; the rest (games PokerTracker does not read) are in hands.json only.`;
      }
    } catch (e) { hhNote = 'The hand-history text could not be written: ' + e.message; }
  }
  const readme = [
    'futurega.me: everything this account holds',
    `Made ${new Date().toISOString()} for @${heroName || 'you'}.`,
    '',
    'my-schedule.csv        the events saved to My Schedule',
    'tracking-entries.csv   tournament results; cash-sessions.csv the cash sessions',
    'bankroll-*.csv         the bankrolls, their ledger, trips and adjustments',
    'staking-series.csv, backers.csv, standing-agreements.csv   staking (backers\' names and their page links)',
    'hands.json             every saved hand, every game, as the app keeps it',
    'hands-pokerstars.txt   hands as PokerStars-format text for PokerTracker 4 or Hold\'em Manager',
    '',
    hhNote,
    'These are your records as the app keeps them, not an audited statement.',
  ].join('\r\n');
  files.unshift({ name: 'README.txt', data: readme });
  return { buf: zip(files), files: files.length };
}

function mountRoutes(app, { getDb, authenticateToken, requireRegistered, bcrypt, limiter }) {
  const lim = limiter || ((req, res, next) => next());
  app.post('/api/account/export', lim, authenticateToken, requireRegistered, async (req, res) => {
    try {
      const db = getDb();
      const u = all(db, 'SELECT id, username, password FROM users WHERE id = ?', [req.user.id])[0];
      if (!u) return res.status(404).json({ error: 'Account not found' });
      const pw = req.body && req.body.password;
      if (typeof pw !== 'string' || !(await bcrypt.compare(pw, u.password))) return res.status(400).json({ error: 'The password is not right' });
      if (req.authLimit) req.authLimit.refund();
      const { buf, files } = await buildExport(db, u.id, { heroName: u.username });
      for (const [k, v] of ready) if (v.userId === u.id || v.at < Date.now() - TTL) ready.delete(k);
      const token = crypto.randomBytes(20).toString('hex');
      const day = new Date().toISOString().slice(0, 10);
      ready.set(token, { userId: u.id, buf, at: Date.now(), name: `futuregame-${u.username}-${day}.zip` });
      res.json({ url: `/api/account/export/${token}`, bytes: buf.length, files });
    } catch (err) {
      console.error('[export] failed:', err.message);
      res.status(500).json({ error: 'The file could not be made. Please try again.' });
    }
  });
  app.get('/api/account/export/:token', (req, res) => {
    const e = ready.get(String(req.params.token || ''));
    if (!e || e.at < Date.now() - TTL) return res.status(404).type('text/plain').send('This download link has expired. Prepare a new one in Settings.');
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${e.name}"`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.send(e.buf);
  });
}

module.exports = { buildExport, toCsv, mountRoutes, TABLES };
