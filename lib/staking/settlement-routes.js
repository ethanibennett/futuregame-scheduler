'use strict';
/*
 * The staking settlement routes (docs/bankroll-merge.md §10), mounted from server.js under the
 * /api/staking admin gate. The arithmetic and the writes are lib/staking/settlement.js; this file
 * is only HTTP.
 *
 *   GET  /api/staking/series/:seriesId/settlement          the sheet (stored rows once settled)
 *   POST /api/staking/series/:seriesId/settlement/preview  the sheet with the inputs, writes nothing
 *   POST /api/staking/series/:seriesId/settle              recompute with the inputs, store, settle
 *   PUT  /api/staking/settlements/:id/paid                 { isPaid, amount?, date? } -> the ledger
 *
 * The inputs (preview and settle) are the only things a person supplies:
 *   { prepaid?: [{ agreementId, amount }], adjustments?: [{ agreementId, amount, note }],
 *     partner?: [{ agreementId, amount }] }
 */
const settlement = require('./settlement');

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered, getRules }) {
  const rulesNow = () => (getRules ? getRules() : settlement.DEFAULT_RULES);
  const idOf = (raw) => { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : null; };
  const fail = (res, status, error, extra) => res.status(status).json({ error, ...(extra || {}) });

  app.get('/api/staking/series/:seriesId/settlement', authenticateToken, (req, res) => {
    try {
      const id = idOf(req.params.seriesId);
      const sheet = id && settlement.computeSheet(getDb(), id, req.user.id, { rules: rulesNow() });
      if (!sheet) return fail(res, 404, 'Series not found');
      res.set('Cache-Control', 'no-store');
      res.json(sheet);
    } catch (e) {
      console.error('Settlement sheet error:', e);
      fail(res, 500, 'Something went wrong. Please try again.');
    }
  });

  app.post('/api/staking/series/:seriesId/settlement/preview', authenticateToken, (req, res) => {
    try {
      const db = getDb();
      const id = idOf(req.params.seriesId);
      const series = id && db.exec('SELECT status FROM staking_series WHERE id = ? AND user_id = ?', [id, req.user.id]);
      if (!series || !series.length || !series[0].values.length) return fail(res, 404, 'Series not found');
      if (series[0].values[0][0] === 'settled') return fail(res, 409, 'This series is already settled');
      const rules = rulesNow();
      const parsed = settlement.parseInputs(req.body, settlement.entriesMeta(db, id, rules));
      if (parsed.error) return fail(res, 400, parsed.error);
      res.set('Cache-Control', 'no-store');
      res.json(settlement.computeSheet(db, id, req.user.id, { inputs: parsed.inputs, rules }));
    } catch (e) {
      console.error('Settlement preview error:', e);
      fail(res, 500, 'Something went wrong. Please try again.');
    }
  });

  app.post('/api/staking/series/:seriesId/settle', authenticateToken, requireRegistered, async (req, res) => {
    try {
      const id = idOf(req.params.seriesId);
      if (!id) return fail(res, 404, 'Series not found');
      const sheet = settlement.settleSeries(getDb(), id, req.user.id, req.body, rulesNow());
      await saveDatabase();
      res.json({ message: 'Settlement finalized', settledCount: sheet.settlements.length, ...sheet });
    } catch (e) {
      if (e instanceof settlement.SettleError) return fail(res, e.status, e.message, e.extra);
      console.error('Finalize settlement error:', e);
      fail(res, 500, 'Something went wrong. Please try again.');
    }
  });

  app.put('/api/staking/settlements/:id/paid', authenticateToken, requireRegistered, async (req, res) => {
    try {
      const id = idOf(req.params.id);
      if (!id) return fail(res, 404, 'Settlement not found');
      const b = req.body || {};
      const r = settlement.setPaid(getDb(), req.user.id, id, { isPaid: b.isPaid !== false, amount: b.amount, date: b.date });
      if (r.status === 200) await saveDatabase();
      res.status(r.status).json(r.status === 200 ? { message: b.isPaid !== false ? 'Marked as paid' : 'Marked as unpaid', ...r.body } : r.body);
    } catch (e) {
      console.error('Mark paid error:', e);
      fail(res, 500, 'Something went wrong. Please try again.');
    }
  });
}

module.exports = { mountRoutes };
