'use strict';
/*
 * Ledger source: tournament results (tracking_entries joined to tournaments).
 *
 * One entry per tracking row, its NET in the event's own currency:
 *
 *     amount = (cashed ? cash_amount : 0) - buyin * max(1, num_entries)
 *
 * the same rule as the Results tab's summary (TrackingView: a cash counts only when `cashed`,
 * cost = buyin x num_entries with num_entries 0/null read as 1) and lib/analytics.js
 * normaliseRow(), so a bankroll's "results" equal the Results tab's profit for the same entries.
 * The currency is the venue's (analytics.nativeCurrency, mirroring the client's VENUE_CURRENCY).
 *
 * date: the event's date (free-text dates normalised as analytics does), else the day it was
 * logged. ts: the date plus the event's start time when one parses, as a zone-less local time.
 * Extra fields for the rules guide and the dashboard: units (bullets), cost, cash, buyin_per_entry.
 */
const { normaliseDate, nativeCurrency } = require('../analytics');

function startTs(date, time) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?/.exec(String(time || ''));
  if (!date || !m) return null;
  let h = Number(m[1]);
  if (h > 23) return null;
  if (m[3]) { h = h % 12; if (/p/i.test(m[3])) h += 12; }
  return `${date}T${String(h).padStart(2, '0')}:${String(Number(m[2] || 0)).padStart(2, '0')}:00`;
}

module.exports = {
  name: 'tournaments',
  entries(db, userId, opts = {}) {
    const params = [userId];
    let where = 'te.user_id = ?';
    if (opts.bankroll === 'main') where += ' AND te.bankroll_id IS NULL';
    else if (Number.isInteger(opts.bankroll)) { where += ' AND te.bankroll_id = ?'; params.push(opts.bankroll); }
    const s = db.prepare(`SELECT te.id, te.num_entries, te.cashed, te.cash_amount, te.bankroll_id, te.created_at,
        t.event_name, t.date, t.time, t.buyin, t.venue
      FROM tracking_entries te JOIN tournaments t ON t.id = te.tournament_id
      WHERE ${where}`);
    const out = [];
    try {
      s.bind(params);
      while (s.step()) {
        const r = s.getAsObject();
        const date = normaliseDate(r.date) || normaliseDate(String(r.created_at || '').slice(0, 10));
        if (!date) continue;
        if ((opts.from && date < opts.from) || (opts.to && date > opts.to)) continue;
        const units = Math.max(1, Number(r.num_entries) || 1);
        const buyin = Math.max(0, Number(r.buyin) || 0);
        const cash = Number(r.cashed) ? Math.max(0, Number(r.cash_amount) || 0) : 0;
        out.push({
          date,
          ts: startTs(date, r.time),
          amount: cash - buyin * units,
          currency: nativeCurrency(r.venue),
          bankroll_id: r.bankroll_id == null ? null : Number(r.bankroll_id),
          kind: 'tournament',
          label: String(r.event_name || 'Tournament'),
          ref: { table: 'tracking_entries', id: r.id },
          units, cost: buyin * units, cash, buyin_per_entry: buyin,
        });
      }
    } finally { s.free(); }
    return out;
  },
};
