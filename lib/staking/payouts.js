'use strict';
/*
 * Standing payouts (docs/bankroll-merge.md §15 row 14; owner answer Q10: record them). Money that
 * changes hands between the player and a standing backer, so the backer's running total drops when
 * they are paid and the bankroll shows the money leaving.
 *
 *   standing_payments  one row per payout: agreement_id, amount_cents (signed: + = the player paid the
 *                      backer, − = the backer paid the player, a makeup), paid_on, note
 *   the ledger         each payout writes ONE `settlement` adjustment into the chosen bankroll (Main by
 *                      default), settlement_ref 'sp:<id>': −amount when the player pays, + when the
 *                      backer does, the way a series settlement's Paid does ('bs:<id>',
 *                      lib/staking/settlement.js). A settlement moves a balance and is never profit.
 *   the running total  shares + opening − payouts. lib/backer-surface.js backerCumulativeCents
 *                      subtracts them, so the page, the push wording, the weekly digest and the
 *                      Standing view all agree; the feed carries paidCents when there are any.
 *
 * Routes (the player's own, under the /api/staking admin gate):
 *   GET    /api/staking/standing/:id/payments           the agreement's payouts, newest first
 *   POST   /api/staking/standing/:id/payments           { amountCents, paidOn?, note?, bankroll? }
 *   DELETE /api/staking/standing/payments/:paymentId    removes it and its adjustment
 */
const { hasTable, hasColumn } = require('../money-merge');

const MIGRATION_NAME = 'standing-payouts-2026-10';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CENTS = 1e10;

function rowsOf(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const oneRow = (db, sql, params) => rowsOf(db, sql, params)[0] || null;
const fail = (status, error) => ({ status, body: { error } });

function migrate(db) {
  db.run('SAVEPOINT standing_payouts');
  try {
    db.run(`CREATE TABLE IF NOT EXISTS standing_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agreement_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,        -- + the player paid the backer, − the backer paid the player
      paid_on TEXT NOT NULL,                -- YYYY-MM-DD
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (agreement_id) REFERENCES standing_agreements(id))`);
    db.run('CREATE INDEX IF NOT EXISTS idx_standing_payments_agreement ON standing_payments(agreement_id)');
    db.run('RELEASE standing_payouts');
  } catch (e) {
    try { db.run('ROLLBACK TO standing_payouts'); db.run('RELEASE standing_payouts'); } catch (_) { /* */ }
    throw e;
  }
}

/** Σ payouts to the backer whose public link this is, in cents (0 without the table). */
function paidCentsForToken(db, token) {
  if (!hasTable(db, 'standing_payments') || !hasColumn(db, 'backers', 'public_token')) return 0;
  const r = oneRow(db, `SELECT COALESCE(SUM(p.amount_cents), 0) AS c FROM standing_payments p
    JOIN standing_agreements a ON a.id = p.agreement_id JOIN backers b ON b.id = a.backer_id WHERE b.public_token = ?`, [token]);
  return (r && r.c) || 0;
}
/** Σ payouts on one agreement. */
function paidCentsForAgreement(db, agreementId) {
  if (!hasTable(db, 'standing_payments')) return 0;
  const r = oneRow(db, 'SELECT COALESCE(SUM(amount_cents), 0) AS c FROM standing_payments WHERE agreement_id = ?', [agreementId]);
  return (r && r.c) || 0;
}

const view = (p) => ({ id: p.id, amountCents: p.amount_cents, paidOn: p.paid_on, note: p.note || null, bankroll: p.bankroll == null ? 'main' : p.bankroll, createdAt: p.created_at });

function agreementOf(db, uid, id) {
  return oneRow(db, 'SELECT a.*, b.name AS backer_name FROM standing_agreements a JOIN backers b ON b.id = a.backer_id WHERE a.id = ? AND a.user_id = ?', [Number(id), uid]);
}

function listPayments(db, uid, agreementId) {
  const a = agreementOf(db, uid, agreementId);
  if (!a) return fail(404, 'No such agreement');
  const ledger = hasColumn(db, 'bankroll_adjustments', 'settlement_ref');
  const rows = rowsOf(db, 'SELECT * FROM standing_payments WHERE agreement_id = ? ORDER BY paid_on DESC, id DESC', [a.id]).map((p) => {
    const adj = ledger ? oneRow(db, 'SELECT bankroll_id FROM bankroll_adjustments WHERE user_id = ? AND settlement_ref = ?', [uid, 'sp:' + p.id]) : null;
    return view({ ...p, bankroll: adj ? adj.bankroll_id : null });
  });
  return { status: 200, body: { agreementId: a.id, paidCents: paidCentsForAgreement(db, a.id), payments: rows } };
}

/**
 * Records a payout and its ledger entry in one savepoint. body: { amountCents (signed, not 0),
 * paidOn (YYYY-MM-DD, default today), note?, bankroll ('main' | an id of the player's, USD only) }.
 */
function addPayment(db, uid, agreementId, body, { today, now = new Date().toISOString() } = {}) {
  const a = agreementOf(db, uid, agreementId);
  if (!a) return fail(404, 'No such agreement');
  const b = body || {};
  const cents = Number(b.amountCents);
  if (!Number.isSafeInteger(cents) || cents === 0 || Math.abs(cents) > MAX_CENTS) return fail(400, 'amountCents must be a whole, non-zero number of cents');
  if (cents % 100 !== 0) return fail(400, 'a payout is in whole dollars, as the ledger keeps a settlement');
  const paidOn = b.paidOn == null || b.paidOn === '' ? today : String(b.paidOn);
  if (!DATE_RE.test(paidOn)) return fail(400, 'paidOn must be YYYY-MM-DD');
  let bankrollId = null;
  if (b.bankroll != null && b.bankroll !== 'main') {
    const row = oneRow(db, 'SELECT id, currency FROM bankrolls WHERE id = ? AND user_id = ?', [Number(b.bankroll), uid]);
    if (!row) return fail(400, 'bankroll must be main or one of yours');
    if ((row.currency || 'USD') !== 'USD') return fail(400, 'a payout is in USD; pick a USD bankroll');
    bankrollId = row.id;
  }
  const note = b.note == null ? null : String(b.note).trim().slice(0, 200) || null;
  db.run('SAVEPOINT standing_payment');
  try {
    db.run('INSERT INTO standing_payments (agreement_id, amount_cents, paid_on, note, created_at) VALUES (?, ?, ?, ?, ?)', [a.id, cents, paidOn, note, now]);
    const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    if (hasColumn(db, 'bankroll_adjustments', 'settlement_ref')) {
      const word = cents > 0 ? `Paid ${a.backer_name}` : `${a.backer_name} paid`;
      db.run(`INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, created_at, settlement_ref)
        VALUES (?, ?, 'settlement', ?, ?, ?, ?, ?)`, [uid, bankrollId, -cents / 100, paidOn, `${word} (standing)${note ? ': ' + note : ''}`.slice(0, 200), now, 'sp:' + id]);
    }
    db.run('RELEASE standing_payment');
    return { status: 201, body: { payment: view({ id, amount_cents: cents, paid_on: paidOn, note, created_at: now, bankroll: bankrollId }), paidCents: paidCentsForAgreement(db, a.id) } };
  } catch (e) {
    try { db.run('ROLLBACK TO standing_payment'); db.run('RELEASE standing_payment'); } catch (_) { /* */ }
    throw e;
  }
}

/** Removes a payout and its ledger entry. */
function removePayment(db, uid, paymentId) {
  const p = oneRow(db, `SELECT p.id, p.agreement_id FROM standing_payments p JOIN standing_agreements a ON a.id = p.agreement_id
    WHERE p.id = ? AND a.user_id = ?`, [Number(paymentId), uid]);
  if (!p) return fail(404, 'No such payout');
  db.run('SAVEPOINT standing_payment_rm');
  try {
    if (hasColumn(db, 'bankroll_adjustments', 'settlement_ref')) db.run('DELETE FROM bankroll_adjustments WHERE user_id = ? AND settlement_ref = ?', [uid, 'sp:' + p.id]);
    db.run('DELETE FROM standing_payments WHERE id = ?', [p.id]);
    db.run('RELEASE standing_payment_rm');
  } catch (e) {
    try { db.run('ROLLBACK TO standing_payment_rm'); db.run('RELEASE standing_payment_rm'); } catch (_) { /* */ }
    throw e;
  }
  return { status: 200, body: { ok: true, paidCents: paidCentsForAgreement(db, p.agreement_id) } };
}

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireAppAdmin, requireRegistered, limiter, todayET } = deps;
  const noop = (req, res, next) => next();
  const wr = [authenticateToken, requireAppAdmin, requireRegistered || noop, limiter || noop];
  const wrap = (fn) => async (req, res) => {
    try { res.set('Cache-Control', 'no-store'); await fn(req, res, getDb(), req.user.id); } catch (err) {
      console.error('[standing] payouts:', err && err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  app.get('/api/staking/standing/:id/payments', authenticateToken, requireAppAdmin, wrap((req, res, db, uid) => {
    const id = idOf(req.params.id); if (id == null) return res.status(400).json({ error: 'Bad agreement id' });
    const out = listPayments(db, uid, id);
    res.status(out.status).json(out.body);
  }));
  app.post('/api/staking/standing/:id/payments', ...wr, wrap(async (req, res, db, uid) => {
    const id = idOf(req.params.id); if (id == null) return res.status(400).json({ error: 'Bad agreement id' });
    const out = addPayment(db, uid, id, req.body, { today: todayET() });
    if (out.status === 201) { await saveDatabase(); console.log(`[standing] payout recorded on agreement #${id}`); }
    res.status(out.status).json(out.body);
  }));
  app.delete('/api/staking/standing/payments/:paymentId', ...wr, wrap(async (req, res, db, uid) => {
    const id = idOf(req.params.paymentId); if (id == null) return res.status(400).json({ error: 'Bad payout id' });
    const out = removePayment(db, uid, id);
    if (out.status === 200) await saveDatabase();
    res.status(out.status).json(out.body);
  }));
}

module.exports = { MIGRATION_NAME, migrate, paidCentsForToken, paidCentsForAgreement, listPayments, addPayment, removePayment, mountRoutes };
