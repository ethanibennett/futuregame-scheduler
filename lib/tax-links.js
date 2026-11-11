'use strict';
/*
 * A read-only link for your tax preparer: one year's report, and nothing else (Features 19, 2026-11-11).
 *
 *   tax_links (token, user_id, year, label, created_at, expires_at, opened_at, open_count, revoked_at)
 *
 * futurega.me/t/<token> opens the tax report for that year, read-only, with its CSV and PDF: the results
 * dated in the year and the expenses and income logged in it, the set-aside rate. Never a backer's name or
 * link, a schedule, a hand or anything else of the account. Short-lived (April 30 of the next year unless
 * set sooner), one tap to turn off, and the owner sees when it was last opened. Like /b/: noindex, no-store,
 * no referrer.
 */
const crypto = require('crypto');

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS tax_links (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    label TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    opened_at INTEGER,
    open_count INTEGER NOT NULL DEFAULT 0,
    revoked_at INTEGER
  )`);
}

function all(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

const live = (r, now = Date.now()) => r && !r.revoked_at && r.expires_at > now;

// What a preparer sees of a result: the money and where, never notes, subtitles or a backer's share.
const KEEP = ['id', 'tournament_id', 'event_number', 'event_name', 'date', 'time', 'buyin', 'game_variant', 'venue', 'property', 'is_online', 'site',
  'region', 'city_state', 'country', 'currency', 'cashed', 'cash_amount', 'num_entries', 'rebuys', 'reentries', 'addon', 'add_on', 'finish_place',
  'place', 'total_entries', 'is_satellite', 'bankroll_id', 'staked_pct', 'tax_withheld', 'w2g', 'created_at'];

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered, requireAppAdmin, taxEntriesFor, listTransactions, readSettings, publicLimiter, siteUrl }) {
  app.get('/api/tax-links', authenticateToken, requireAppAdmin, (req, res) => {
    const rows = all(getDb(), 'SELECT token, year, label, created_at, expires_at, opened_at, open_count FROM tax_links WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC', [req.user.id]);
    res.json({ links: rows.filter((r) => r.expires_at > Date.now()).map((r) => ({ ...r, url: `${siteUrl()}/t/${r.token}` })) });
  });
  app.post('/api/tax-links', authenticateToken, requireAppAdmin, async (req, res) => {
    const year = Math.round(Number(req.body && req.body.year));
    if (!(year >= 2000 && year <= 2100)) return res.status(400).json({ error: 'Which tax year?' });
    const label = typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 60) : null;
    const token = crypto.randomBytes(18).toString('base64url');
    const expires = Date.parse(`${year + 1}-04-30T23:59:59Z`);
    getDb().run('INSERT INTO tax_links (token, user_id, year, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [token, req.user.id, year, label || null, Date.now(), Math.max(expires, Date.now() + 30 * 864e5)]);
    await saveDatabase();
    res.status(201).json({ token, url: `${siteUrl()}/t/${token}` });
  });
  app.delete('/api/tax-links/:token', authenticateToken, requireAppAdmin, async (req, res) => {
    getDb().run('UPDATE tax_links SET revoked_at = ? WHERE token = ? AND user_id = ?', [Date.now(), String(req.params.token), req.user.id]);
    await saveDatabase();
    res.json({ ok: true });
  });

  // The preparer's read: no account, the link is the whole of it.
  app.get('/api/tax-link/:token', publicLimiter || ((req, res, next) => next()), async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
    const db = getDb();
    const r = all(db, 'SELECT * FROM tax_links WHERE token = ?', [String(req.params.token || '')])[0];
    if (!live(r)) return res.status(404).json({ error: 'This link has expired or was turned off. Ask for a new one.' });
    const y = String(r.year);
    const entries = taxEntriesFor(r.user_id).filter((e) => String(e.date || '').slice(0, 4) === y)
      .map((e) => Object.fromEntries(KEEP.filter((k) => e[k] !== undefined).map((k) => [k, e[k]])));
    const transactions = (listTransactions ? listTransactions(db, r.user_id, { from: `${y}-01-01`, to: `${y}-12-31` }) : [])
      .map(({ note, notes, ...t }) => { void note; void notes; return t; });
    const settings = readSettings ? readSettings(db, r.user_id) : {};
    db.run('UPDATE tax_links SET opened_at = ?, open_count = open_count + 1 WHERE token = ?', [Date.now(), r.token]);
    await saveDatabase();
    res.json({ year: r.year, label: r.label, entries, transactions, taxSetAsidePct: Number.isFinite(Number(settings.taxSetAsidePct)) ? Number(settings.taxSetAsidePct) : 30 });
  });
}

module.exports = { migrate, mountRoutes, KEEP };
