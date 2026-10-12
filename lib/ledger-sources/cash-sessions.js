'use strict';
/*
 * Ledger source: cash game sessions (lib/cash-sessions.js) for the combined bankroll ledger
 * (lib/bankroll-ledger.js auto-loads every module in this directory).
 *
 * One entry per ENDED session, dated on the session's own day (session_date, the player's local
 * day it started), signed in the session's currency:
 *
 *     amount = cash_out - buy_in - tips - expenses
 *
 * A live session (ended_at NULL) contributes nothing until it is ended — the money is on the table,
 * not won or lost yet. Extra fields: started_at and hours (ended - started, for the dashboard's
 * hourly rate), and the session's own money in its currency (multiply by the ledger's fx_display for
 * the display scale): buy_in (rebuys included), rebuys (a count), cash_out, tips and expenses, so the
 * dashboard's Summary can show buy-ins and cash-outs that add up to the net.
 *
 * opts = { bankroll, from, to }:
 *   bankroll  the shared ?bankroll= value: undefined / 'all' (every session), 'main' (bankroll_id
 *             NULL) or a bankroll id (number or numeric string). An id that is not this user's, or
 *             a malformed value, yields NO entries rather than an error — the ledger never shows one
 *             user another's rows.
 *   from, to  YYYY-MM-DD, inclusive, on session_date.
 */
const bankrolls = require('../bankrolls');

const name = 'cash-sessions';

// Hours played, to the hundredth; null when either end is missing or the span is not positive.
function hoursBetween(start, end) {
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 36e3) / 100 : null;
}

function entries(db, userId, opts = {}) {
  if (!db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cash_sessions'").length) return [];
  const f = bankrolls.filterFromQuery(db, userId, opts.bankroll == null ? undefined : opts.bankroll, 'cs.bankroll_id');
  if (f.error) return [];
  let sql = `SELECT cs.id, cs.bankroll_id, cs.session_date, cs.started_at, cs.ended_at, cs.room, cs.game, cs.stakes, cs.buy_in, cs.rebuys, cs.cash_out,
                    cs.tips, cs.expenses, cs.currency
             FROM cash_sessions cs WHERE cs.user_id = ? AND cs.ended_at IS NOT NULL${f.sql}`;
  const params = [userId, ...f.params];
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (opts.from && day.test(String(opts.from))) { sql += ' AND cs.session_date >= ?'; params.push(String(opts.from)); }
  if (opts.to && day.test(String(opts.to))) { sql += ' AND cs.session_date <= ?'; params.push(String(opts.to)); }
  sql += ' ORDER BY cs.session_date, cs.ended_at, cs.id';
  const out = [];
  const s = db.prepare(sql);
  try {
    s.bind(params);
    while (s.step()) {
      const r = s.getAsObject();
      const what = [r.game, r.stakes].filter(Boolean).join(' ');
      out.push({
        date: r.session_date,
        ts: r.ended_at || null,
        amount: (r.cash_out || 0) - (r.buy_in || 0) - (r.tips || 0) - (r.expenses || 0),
        currency: r.currency || 'USD',
        bankroll_id: r.bankroll_id == null ? null : r.bankroll_id,
        kind: 'cash_session',
        label: `Cash ${what || 'session'}${r.room ? ' · ' + r.room : ''}`,
        ref: { table: 'cash_sessions', id: r.id },
        // Extra fields (the contract passes them through): when it was played, for hourly rates.
        started_at: r.started_at || null,
        hours: hoursBetween(r.started_at, r.ended_at),
        // The money behind the net, in the session's currency: amount = cash_out - buy_in - tips - expenses.
        buy_in: Number(r.buy_in) || 0,
        rebuys: Number(r.rebuys) || 0,
        cash_out: Number(r.cash_out) || 0,
        tips: Number(r.tips) || 0,
        expenses: Number(r.expenses) || 0,
      });
    }
  } finally { s.free(); }
  return out;
}

module.exports = { name, entries };
