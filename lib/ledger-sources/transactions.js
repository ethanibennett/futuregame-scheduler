'use strict';
/*
 * Ledger source: expenses and non-game income (bankroll_transactions, lib/bankroll-transactions.js).
 *
 * The shared contract (lib/bankroll-ledger.js loads every module in lib/ledger-sources/):
 *   module.exports = { name, entries(db, userId, opts) }
 *   opts = { bankroll, from, to }
 *     bankroll  'all' | 'main' | <id> — the same meaning as ?bankroll= (bankrolls.filterFromQuery);
 *               absent = all. A bankroll that is not the user's THROWS (err.status 404; 400 when
 *               malformed), so a caller that forgot to validate cannot read someone else's rows.
 *     from, to  'YYYY-MM-DD', inclusive, on occurred_on; either may be absent.
 *   -> [{ date, ts, amount, currency, bankroll_id, kind, label, ref: { table, id } }]
 *     amount    SIGNED, in `currency`: an expense is negative, income positive.
 *     ts        null — a transaction carries a day, not a time.
 *     kind      'expense' | 'income'; `category` is passed along too (beyond the contract).
 *
 * A row with affects_balance = 0 (an expense paid from outside the roll, e.g. one imported from the
 * dashboard, whose roll never included expenses) is SKIPPED: it moves no balance. The Expenses list
 * and the tax report read bankroll_transactions directly and still count it.
 *
 * Ordered by date, then id. Returns [] before the table exists (a DB that predates the migration).
 */
const bankrolls = require('../bankrolls');
const moneyMerge = require('../money-merge');

const LABELS = {
  expense: {
    travel: 'Travel', lodging: 'Lodging', food: 'Food', entry_fees: 'Entry fees', coaching: 'Coaching',
    software: 'Software', tips: 'Dealer tips', equipment: 'Equipment', fees: 'Fees', other: 'Other expense',
  },
  income: {
    rakeback: 'Rakeback', bonus: 'Bonus', staking: 'Staking settlement', sponsorship: 'Sponsorship',
    coaching: 'Coaching income', other: 'Other income',
  },
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function entries(db, userId, opts = {}) {
  const exists = db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bankroll_transactions'");
  if (!exists.length) return [];
  const f = bankrolls.filterFromQuery(db, userId, opts.bankroll, 'bankroll_id');
  if (f.error) { const e = new Error(f.error); e.status = f.status; throw e; }
  let sql = `SELECT id, bankroll_id, occurred_on, kind, category, amount, currency, note, series
    FROM bankroll_transactions WHERE user_id = ?${f.sql}`;
  // The column arrives with 'money-merge-2026-10'; before it every row moves its balance.
  if (moneyMerge.hasColumn(db, 'bankroll_transactions', 'affects_balance')) sql += ' AND COALESCE(affects_balance, 1) <> 0';
  const params = [userId, ...f.params];
  for (const [key, op] of [['from', '>='], ['to', '<=']]) {
    const v = opts[key];
    if (v === undefined || v === null || v === '') continue;
    if (!ISO.test(String(v))) { const e = new Error(`${key} must be YYYY-MM-DD`); e.status = 400; throw e; }
    sql += ` AND occurred_on ${op} ?`; params.push(String(v));
  }
  sql += ' ORDER BY occurred_on, id';
  const out = [];
  const s = db.prepare(sql);
  try {
    s.bind(params);
    while (s.step()) {
      const r = s.getAsObject();
      const amt = Math.round(Number(r.amount) * 100) / 100;
      const base = (LABELS[r.kind] && LABELS[r.kind][r.category]) || r.category;
      out.push({
        date: r.occurred_on,
        ts: null,
        amount: r.kind === 'expense' ? -amt : amt,
        currency: r.currency || 'USD',
        bankroll_id: r.bankroll_id == null ? null : Number(r.bankroll_id),
        kind: r.kind,
        category: r.category,
        label: [base, r.note || r.series].filter(Boolean).join(' · '),
        ref: { table: 'bankroll_transactions', id: r.id },
      });
    }
  } finally { s.free(); }
  return out;
}

module.exports = { name: 'transactions', entries, LABELS };
