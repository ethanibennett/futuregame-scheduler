'use strict';
/*
 * Money homes (docs/bankroll-merge.md §15 row 10; Phase 10): the three places the dashboard's money
 * screens had and this app lacked, as data for the bankroll dashboard and the tax report.
 *
 *   GET /api/bankrolls/money/homes       { fund, locations, locationsTotal, roll, drift, taxSetAsidePct }
 *       fund      the bankroll with role 'fund' (one per player): saved (its ledger balance), target,
 *                 targetDate, firstActivityDate and the pace (what a month must add to land the
 *                 target on its date)
 *       locations "Where's the money" (money_locations, the dashboard's wsop-balances): where the
 *                 cash physically sits; locationsTotal and drift = total − roll, the owner's check
 *                 that the places add up to the ledger
 *       taxSetAsidePct   money_settings.taxSetAsidePct (default 30, the dashboard's wsop-admin-taxrate)
 *   PUT /api/bankrolls/money/locations   { locations: [{ id?, name, amount, currency? }] } replaces the set
 *   PUT /api/bankrolls/money/settings    { taxSetAsidePct?, defaultBankroll? }
 *
 * The fund's target lives on the bankroll row (target_amount, target_date; PUT /api/bankrolls/:id
 * takes role, targetAmount, targetDate and inRoll, lib/bankrolls.js). The figures are the ledger's
 * (lib/owner-api totals). Every route is the signed-in admin's own (req.user.id).
 */
const { hasTable } = require('./money-merge');
const live = require('./staking/live');

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
function rowsOf(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Months from `today` to `targetDate` (fractional, at least 0). */
function monthsUntil(targetDate, today) {
  if (!DATE_RE.test(String(targetDate || '')) || !DATE_RE.test(String(today || ''))) return null;
  const a = new Date(today + 'T12:00:00Z'), b = new Date(targetDate + 'T12:00:00Z');
  return Math.max(0, (b - a) / (365.25 / 12 * 864e5));
}
/** What a month must add for `saved` to reach `target` by `targetDate`: { needPerMonth, monthsLeft, onTrack } */
function fundPace({ saved, target, targetDate, firstActivityDate }, today) {
  if (!(Number(target) > 0)) return null;
  const left = Math.max(0, round2(target - saved));
  const months = monthsUntil(targetDate, today);
  const elapsed = firstActivityDate ? monthsUntil(today, firstActivityDate) : null;
  const perMonthSoFar = elapsed && elapsed > 0 ? saved / elapsed : null;
  return {
    left, monthsLeft: months == null ? null : round2(months),
    needPerMonth: months == null ? null : months > 0 ? round2(left / months) : left,
    perMonthSoFar: perMonthSoFar == null ? null : round2(perMonthSoFar),
    onTrack: months == null || perMonthSoFar == null ? null : perMonthSoFar * months >= left,
  };
}

function listLocations(db, uid) {
  if (!hasTable(db, 'money_locations')) return [];
  return rowsOf(db, 'SELECT id, name, amount, currency, sort_order FROM money_locations WHERE user_id = ? ORDER BY sort_order, id', [uid])
    .map((l) => ({ id: l.id, name: l.name, amount: round2(l.amount), currency: l.currency || 'USD' }));
}

/** GET /homes. `totals` is lib/owner-api money() without sessions. */
function homes(db, uid, { totals, today }) {
  const fund = totals.fund ? { ...totals.fund, name: totals.bankrolls.find((b) => b.isFund)?.name || 'WSOP fund', pace: fundPace(totals.fund, today) } : null;
  const locations = listLocations(db, uid);
  const total = round2(locations.reduce((s, l) => s + (l.currency === 'USD' ? l.amount : 0), 0));
  const settings = live.readSettings(db, uid);
  const pct = Number.isFinite(Number(settings.taxSetAsidePct)) ? Number(settings.taxSetAsidePct) : 30;
  return {
    fund, locations, locationsTotal: total, roll: totals.roll, wsopFund: totals.wsopFund,
    drift: round2(total - totals.roll - totals.wsopFund), foreign: locations.filter((l) => l.currency !== 'USD').length,
    taxSetAsidePct: pct, defaultBankroll: settings.defaultBankroll == null ? 'main' : settings.defaultBankroll,
  };
}

/** PUT /locations: the whole set, in order. -> { status, body: { locations } } */
function setLocations(db, uid, body, { now = new Date().toISOString() } = {}) {
  const list = body && Array.isArray(body.locations) ? body.locations : null;
  if (!list) return { status: 400, body: { error: 'locations must be a list' } };
  if (list.length > 50) return { status: 400, body: { error: 'at most 50 locations' } };
  const clean = [];
  for (const l of list) {
    const name = String(l && l.name != null ? l.name : '').trim().slice(0, 60);
    const amount = Number(l && l.amount);
    const currency = String(l && l.currency ? l.currency : 'USD').toUpperCase();
    if (!name) return { status: 400, body: { error: 'each location needs a name' } };
    if (!Number.isFinite(amount) || Math.abs(amount) > 1e8) return { status: 400, body: { error: `${name}: the amount must be a number` } };
    if (!/^[A-Z]{3}$/.test(currency)) return { status: 400, body: { error: `${name}: a bad currency` } };
    clean.push({ id: l && Number.isInteger(Number(l.id)) ? Number(l.id) : null, name, amount: round2(amount), currency });
  }
  db.run('SAVEPOINT money_locations');
  try {
    const keep = [];
    clean.forEach((l, i) => {
      if (l.id != null && rowsOf(db, 'SELECT id FROM money_locations WHERE id = ? AND user_id = ?', [l.id, uid]).length) {
        db.run('UPDATE money_locations SET name = ?, amount = ?, currency = ?, sort_order = ?, updated_at = ? WHERE id = ?', [l.name, l.amount, l.currency, i, now, l.id]);
        keep.push(l.id);
      } else {
        db.run('INSERT INTO money_locations (user_id, name, amount, currency, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [uid, l.name, l.amount, l.currency, i, now]);
        keep.push(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
      }
    });
    db.run(`DELETE FROM money_locations WHERE user_id = ?${keep.length ? ` AND id NOT IN (${keep.map(() => '?').join(',')})` : ''}`, [uid, ...keep]);
    db.run('RELEASE money_locations');
  } catch (e) {
    try { db.run('ROLLBACK TO money_locations'); db.run('RELEASE money_locations'); } catch (_) { /* */ }
    throw e;
  }
  return { status: 200, body: { locations: listLocations(db, uid) } };
}

/** PUT /settings: { taxSetAsidePct?, defaultBankroll? } */
function setSettings(db, uid, body, { now = new Date().toISOString() } = {}) {
  const b = body || {};
  const data = live.readSettings(db, uid);
  if (b.taxSetAsidePct !== undefined) {
    const p = Number(b.taxSetAsidePct);
    if (!Number.isFinite(p) || p < 0 || p > 100) return { status: 400, body: { error: 'taxSetAsidePct must be 0 to 100' } };
    data.taxSetAsidePct = Math.round(p * 10) / 10;
  }
  if (b.defaultBankroll !== undefined) {
    if (b.defaultBankroll === 'main' || b.defaultBankroll === null) data.defaultBankroll = 'main';
    else {
      const id = Number(b.defaultBankroll);
      if (!Number.isInteger(id) || !rowsOf(db, 'SELECT id FROM bankrolls WHERE id = ? AND user_id = ?', [id, uid]).length) return { status: 400, body: { error: 'defaultBankroll must be main or one of your bankrolls' } };
      data.defaultBankroll = id;
    }
  }
  db.run(`INSERT INTO money_settings (user_id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, [uid, JSON.stringify(data), now]);
  return { status: 200, body: { taxSetAsidePct: data.taxSetAsidePct == null ? 30 : data.taxSetAsidePct, defaultBankroll: data.defaultBankroll == null ? 'main' : data.defaultBankroll } };
}

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireAppAdmin, getRates, loaded, todayET } = deps;
  const ownerApi = require('./owner-api');
  const wrap = (fn) => async (req, res) => {
    try { res.set('Cache-Control', 'no-store'); await fn(req, res, getDb(), req.user.id); } catch (err) {
      console.error('[money-homes]', err && err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  app.get('/api/bankrolls/money/homes', authenticateToken, requireAppAdmin, wrap(async (req, res, db, uid) => {
    const cache = getRates ? await getRates() : null;
    const totals = ownerApi.money(db, uid, { rates: cache && cache.rates, loaded, withSessions: false });
    res.json(homes(db, uid, { totals, today: todayET() }));
  }));
  app.put('/api/bankrolls/money/locations', authenticateToken, requireAppAdmin, wrap(async (req, res, db, uid) => {
    const out = setLocations(db, uid, req.body);
    if (out.status === 200) await saveDatabase();
    res.status(out.status).json(out.body);
  }));
  app.put('/api/bankrolls/money/settings', authenticateToken, requireAppAdmin, wrap(async (req, res, db, uid) => {
    const out = setSettings(db, uid, req.body);
    if (out.status === 200) await saveDatabase();
    res.status(out.status).json(out.body);
  }));
}

module.exports = { fundPace, monthsUntil, homes, listLocations, setLocations, setSettings, mountRoutes };
