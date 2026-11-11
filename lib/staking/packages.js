'use strict';
/*
 * Sell a package: one link for a series' action, requests the player accepts into agreements (Features 20,
 * owner pick 2026-11-11). A record, never a marketplace: no payment moves through the app, no browsing of
 * anyone's packages, the link shared only by the player. The page says payment is between the two of them.
 *
 *   staking_packages (id, user_id, series_id, token, pct, markup, events JSON, note, created_at, closed_at)
 *     events: the saved events in the series' dates when the package was made [{ name, date, buyin, bullets }]
 *   package_requests (id, package_id, name, contact, pct, note, status 'new'|'accepted'|'declined', created_at,
 *     decided_at, agreement_id)
 *
 * Accepting is done by the app with the routes that already make a backer and a series agreement (the
 * player sees and can change them); this module records the decision. 1% costs the events' buy-ins x
 * bullets / 100 x the markup.
 */
const crypto = require('crypto');

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS staking_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    series_id INTEGER,
    token TEXT NOT NULL UNIQUE,
    pct REAL NOT NULL,
    markup REAL NOT NULL DEFAULT 1,
    events TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS package_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    contact TEXT,
    pct REAL NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    agreement_id INTEGER
  )`);
}

function all(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

const parse = (s) => { try { return JSON.parse(s || '[]'); } catch (_) { return []; } };
function priceOf(pkg) {
  const total = parse(pkg.events).reduce((a, e) => a + (Number(e.buyin) || 0) * (Number(e.bullets) || 1), 0);
  return { total, onePct: Math.round((total / 100) * (Number(pkg.markup) || 1) * 100) / 100 };
}
function soldOf(db, id) {
  const r = all(db, "SELECT COALESCE(SUM(pct), 0) AS s FROM package_requests WHERE package_id = ? AND status = 'accepted'", [id])[0];
  return r ? Number(r.s) : 0;
}

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireAppAdmin, publicLimiter, siteUrl, notify }) {
  const lim = publicLimiter || ((req, res, next) => next());
  const shape = (db, p) => ({
    id: p.id, seriesId: p.series_id, pct: p.pct, markup: p.markup, note: p.note, events: parse(p.events), closed: !!p.closed_at,
    url: `${siteUrl()}/p/${p.token}`, ...priceOf(p), sold: soldOf(db, p.id),
    requests: all(db, 'SELECT id, name, contact, pct, note, status, created_at, agreement_id FROM package_requests WHERE package_id = ? ORDER BY created_at DESC', [p.id]),
  });

  app.get('/api/staking/packages', authenticateToken, requireAppAdmin, (req, res) => {
    const db = getDb();
    res.json({ packages: all(db, 'SELECT * FROM staking_packages WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]).map((p) => shape(db, p)) });
  });

  app.post('/api/staking/packages', authenticateToken, requireAppAdmin, async (req, res) => {
    const db = getDb();
    const b = req.body || {};
    const pct = Number(b.pct);
    if (!(pct > 0 && pct <= 100)) return res.status(400).json({ error: 'The share for sale, 1 to 100%' });
    const markup = Number(b.markup) || 1;
    if (!(markup >= 1 && markup <= 3)) return res.status(400).json({ error: 'A markup from 1.0 to 3.0' });
    const events = (Array.isArray(b.events) ? b.events : []).slice(0, 80).map((e) => ({
      name: String(e.name || '').slice(0, 120), date: String(e.date || '').slice(0, 10), buyin: Math.max(0, Number(e.buyin) || 0), bullets: Math.max(1, Math.min(10, Math.round(Number(e.bullets) || 1))),
    }));
    if (!events.length) return res.status(400).json({ error: 'Choose the events the package covers' });
    if (b.seriesId && !all(db, 'SELECT 1 FROM staking_series WHERE id = ? AND user_id = ?', [Number(b.seriesId), req.user.id]).length) return res.status(404).json({ error: 'Series not found' });
    const token = crypto.randomBytes(12).toString('base64url');
    db.run('INSERT INTO staking_packages (user_id, series_id, token, pct, markup, events, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, b.seriesId ? Number(b.seriesId) : null, token, pct, markup, JSON.stringify(events), typeof b.note === 'string' ? b.note.slice(0, 300) : null, Date.now()]);
    await saveDatabase();
    const p = all(db, 'SELECT * FROM staking_packages WHERE token = ?', [token])[0];
    res.status(201).json({ package: shape(db, p) });
  });

  app.put('/api/staking/packages/:id', authenticateToken, requireAppAdmin, async (req, res) => {
    const db = getDb();
    const p = all(db, 'SELECT * FROM staking_packages WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id])[0];
    if (!p) return res.status(404).json({ error: 'No such package' });
    db.run('UPDATE staking_packages SET closed_at = ? WHERE id = ?', [req.body && req.body.closed ? Date.now() : null, p.id]);
    await saveDatabase();
    res.json({ package: shape(db, all(db, 'SELECT * FROM staking_packages WHERE id = ?', [p.id])[0]) });
  });

  app.put('/api/staking/package-requests/:rid', authenticateToken, requireAppAdmin, async (req, res) => {
    const db = getDb();
    const r = all(db, `SELECT r.* FROM package_requests r JOIN staking_packages p ON p.id = r.package_id WHERE r.id = ? AND p.user_id = ?`, [Number(req.params.rid), req.user.id])[0];
    if (!r) return res.status(404).json({ error: 'No such request' });
    const status = req.body && ['accepted', 'declined', 'new'].includes(req.body.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'Accepted or declined' });
    db.run('UPDATE package_requests SET status = ?, decided_at = ?, agreement_id = COALESCE(?, agreement_id) WHERE id = ?',
      [status, Date.now(), req.body.agreementId ? Number(req.body.agreementId) : null, r.id]);
    await saveDatabase();
    res.json({ ok: true });
  });

  // The page anyone with the link sees: the events, the price of 1%, what is left; and a request.
  app.get('/api/package/:token', lim, (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
    const db = getDb();
    const p = all(db, 'SELECT p.*, u.real_name, u.username, s.name AS series_name FROM staking_packages p JOIN users u ON u.id = p.user_id LEFT JOIN staking_series s ON s.id = p.series_id WHERE p.token = ?', [String(req.params.token || '')])[0];
    if (!p) return res.status(404).json({ error: 'This package link does not open' });
    const sold = soldOf(db, p.id);
    res.json({ player: p.real_name || p.username, series: p.series_name || null, pct: p.pct, markup: p.markup, note: p.note, events: parse(p.events), ...priceOf(p), sold, left: Math.max(0, p.pct - sold), closed: !!p.closed_at });
  });

  app.post('/api/package/:token/request', lim, async (req, res) => {
    const db = getDb();
    const p = all(db, 'SELECT * FROM staking_packages WHERE token = ?', [String(req.params.token || '')])[0];
    if (!p || p.closed_at) return res.status(404).json({ error: 'This package is closed' });
    const b = req.body || {};
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
    const contact = typeof b.contact === 'string' ? b.contact.trim().slice(0, 120) : '';
    const pct = Math.round(Number(b.pct) * 100) / 100;
    if (!name || !contact) return res.status(400).json({ error: 'Your name, and how the player reaches you' });
    if (!(pct > 0 && pct <= Math.max(0, p.pct - soldOf(db, p.id)))) return res.status(400).json({ error: 'More than is left, or none' });
    const recent = all(db, 'SELECT COUNT(*) AS n FROM package_requests WHERE package_id = ? AND created_at > ?', [p.id, Date.now() - 3600e3])[0];
    if (recent && Number(recent.n) >= 30) return res.status(429).json({ error: 'Too many requests this hour' });
    db.run('INSERT INTO package_requests (package_id, name, contact, pct, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [p.id, name, contact, pct, typeof b.note === 'string' ? b.note.slice(0, 200) : null, Date.now()]);
    await saveDatabase();
    if (notify) notify(p.user_id, 'package', { title: `${name} asks for ${pct}% of your package`, body: contact, url: '/?view=staking', ref: `pkg:${p.id}:${Date.now()}`, pushKind: 'requests' });
    res.status(201).json({ ok: true });
  });
}

module.exports = { migrate, mountRoutes, priceOf };
