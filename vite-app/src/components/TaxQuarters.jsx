import React, { useState } from 'react';
import { API_URL } from '../utils/api.js';

/* Estimated tax by quarter (Features 18, 2026-11-11): the IRS's four periods with what each earned, what the
   player's rate sets aside, the due date, and Mark paid on the period that is due (a record only). It says
   "set aside", never "owe": the safe-harbour rules can make the right payment differ. */
export const PERIODS = [
  { q: 1, months: [1, 2, 3], label: 'Jan–Mar', due: (y) => `${y}-04-15` },
  { q: 2, months: [4, 5], label: 'Apr–May', due: (y) => `${y}-06-15` },
  { q: 3, months: [6, 7, 8], label: 'Jun–Aug', due: (y) => `${y}-09-15` },
  { q: 4, months: [9, 10, 11, 12], label: 'Sep–Dec', due: (y) => `${y + 1}-01-15` },
];

export function quartersOf(year, months, pct) {
  return PERIODS.map((p) => {
    const net = months.filter((m) => p.months.includes(m.month)).reduce((a, m) => a + (Number(m.net) || 0), 0);
    return { ...p, net, setAside: Math.max(0, net) * (Number(pct) || 0) / 100, dueDate: p.due(year), key: `${year}-Q${p.q}` };
  });
}

export default function TaxQuarters({ year, months, pct, paid = {}, token, usd, onPaid }) {
  const [busy, setBusy] = useState(null);
  const today = new Date().toISOString().slice(0, 10);
  const qs = quartersOf(year, months, pct);
  // The period that is due: the first whose due date has not passed, while its months have started.
  const dueQ = qs.find((q) => q.dueDate >= today && `${year}-${String(q.months[0]).padStart(2, '0')}-01` <= today);
  const next = qs.find((q) => q.dueDate >= today);
  const days = next ? Math.round((Date.parse(next.dueDate + 'T12:00:00') - Date.now()) / 864e5) : null;
  const mark = async (q, clear = false) => {
    setBusy(q.key);
    try {
      const r = await fetch(`${API_URL}/bankrolls/money/settings`, {
        method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxPaid: { period: q.key, amount: clear ? null : Math.round(q.setAside), date: today } }),
      });
      if (r.ok) { const d = await r.json(); if (onPaid) onPaid(d.taxPaid || {}); }
    } finally { setBusy(null); }
  };
  return (
    <div className="taxr-block tq-block">
      <div className="tq-head"><span className="taxr-t">Estimated tax by quarter</span><span className="taxr-t tq-rate">{`set aside at ${pct}%`}</span></div>
      <div className="tq-row is-head"><span>Period</span><span>Net</span><span>Set aside</span><span>Due</span><span /></div>
      {qs.map((q) => {
        const p = paid[q.key];
        return (
          <div key={q.key} className={'tq-row' + (dueQ && dueQ.key === q.key ? ' is-due' : '')}>
            <span>{`Q${q.q} · ${q.label}`}</span>
            <span className={q.net > 0 ? 'an-pos' : q.net < 0 ? 'an-neg' : ''}>{usd(q.net)}</span>
            <span>{usd(q.setAside)}</span>
            <span>{new Date(q.dueDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            <span className="tq-act">
              {p ? <button type="button" className="tq-paid" onClick={() => mark(q, true)} disabled={busy === q.key} title="Clear this record">{`Paid ${usd(p.amount)}`}</button>
                : dueQ && dueQ.key === q.key && token ? <button type="button" className="tq-mark" onClick={() => mark(q)} disabled={busy === q.key}><span>Mark paid</span></button> : null}
            </span>
          </div>
        );
      })}
      {days != null && <p className="tq-note">{`${days} day${days === 1 ? '' : 's'} to the next due date. A record of what you set aside, not tax advice: the prior-year safe harbour can make the right payment differ.`}</p>}
    </div>
  );
}
