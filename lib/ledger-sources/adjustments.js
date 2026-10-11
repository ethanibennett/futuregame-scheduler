'use strict';
/*
 * Ledger source: the bankroll ledger proper — deposits, withdrawals and both legs of every
 * transfer (bankroll_adjustments, lib/bankrolls.js). `amount` is already signed and in the
 * bankroll's currency (Main is USD), so it passes straight through. ts is null: occurred_on is a
 * day, and created_at is when it was typed in, not when the money moved.
 */
const KIND_LABEL = { deposit: 'Deposit', withdrawal: 'Withdrawal', transfer_in: 'Transfer in', transfer_out: 'Transfer out' };

module.exports = {
  name: 'adjustments',
  entries(db, userId, opts = {}) {
    const params = [userId];
    let where = 'a.user_id = ?';
    if (opts.bankroll === 'main') where += ' AND a.bankroll_id IS NULL';
    else if (Number.isInteger(opts.bankroll)) { where += ' AND a.bankroll_id = ?'; params.push(opts.bankroll); }
    if (opts.from) { where += ' AND a.occurred_on >= ?'; params.push(opts.from); }
    if (opts.to) { where += ' AND a.occurred_on <= ?'; params.push(opts.to); }
    const s = db.prepare(`SELECT a.id, a.bankroll_id, a.kind, a.amount, a.occurred_on, a.note, a.transfer_id,
        COALESCE(b.currency, 'USD') AS currency
      FROM bankroll_adjustments a LEFT JOIN bankrolls b ON b.id = a.bankroll_id AND b.user_id = a.user_id
      WHERE ${where}`);
    const out = [];
    try {
      s.bind(params);
      while (s.step()) {
        const r = s.getAsObject();
        out.push({
          date: r.occurred_on,
          ts: null,
          amount: Number(r.amount) || 0,
          currency: r.currency,
          bankroll_id: r.bankroll_id == null ? null : Number(r.bankroll_id),
          kind: r.kind,
          label: (KIND_LABEL[r.kind] || r.kind) + (r.note ? ` · ${r.note}` : ''),
          ref: { table: 'bankroll_adjustments', id: r.id },
          transfer_id: r.transfer_id || null,
        });
      }
    } finally { s.free(); }
    return out;
  },
};
