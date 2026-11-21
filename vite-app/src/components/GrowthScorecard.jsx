import React, { useEffect, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { scorecardRows, spendLine, channelName, weekLabel } from '../utils/growth-report.js';
import MoneyField from './MoneyField.jsx';
import './analytics.css';

/*
 * The Monday scorecard (launch plan v2, sections 7 and 12; 2026-11-21): GET /api/admin/growth/scorecard,
 * lib/growth.js scorecard. Last week's new accounts and each cohort figure from the newest week old enough
 * to have it, against the day-90 KPIs (On target / Watch / Act, from launch day). Last week's ad spend is
 * entered here per channel, as read off each platform, so the cost per activated account can be worked
 * out; what only the platforms and App Store Connect know is listed with where to read it.
 */
export default function GrowthScorecard({ token }) {
  const [sc, setSc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [channel, setChannel] = useState('meta');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let on = true;
    fetch(`${API_URL}/admin/growth/scorecard`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (on) setSc(d); })
      .catch(() => { if (on) setFailed(true); });
    return () => { on = false; };
  }, [token]);
  if (failed || !sc) return null;
  const rows = scorecardRows(sc);
  const spent = spendLine(sc);
  const save = async () => {
    const cents = Math.round(Number(amount) * 100);
    if (amount === '' || !Number.isFinite(cents) || cents < 0) { setError('Enter the amount spent, in dollars.'); return; }
    setBusy(true); setError('');
    try {
      const r = await fetch(`${API_URL}/admin/growth/spend`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: sc.week, channel, cents }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not save that.');
      setSc(d); setAmount('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="growth-scorecard" aria-label="Monday scorecard">
      <h3 className="an-cell an-sec">Monday scorecard, week of {weekLabel(sc.week)}</h3>
      {!sc.live && <p className="an-p">Statuses start on launch day, {weekLabel(sc.launch)}; until then the figures are the TestFlight baseline.</p>}
      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table growth-table growth-scorecard-table">
          <colgroup>
            <col />
            <col style={{ width: 'calc(var(--gu) * 6)' }} />
            <col style={{ width: 'calc(var(--gu) * 6)' }} />
            <col style={{ width: 'calc(var(--gu) * 13)' }} />
            <col style={{ width: 'calc(var(--gu) * 6)' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Figure</th>
              <th style={{ textAlign: 'right' }}>Value</th>
              <th style={{ textAlign: 'right' }} title="The sign-up week the figure is read from: each needs a different age">Cohort</th>
              <th>Target</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ color: 'var(--text)' }}>{r.label}</td>
                <td style={{ textAlign: 'right' }}>{r.value}</td>
                <td style={{ textAlign: 'right' }}>{r.week}</td>
                <td>{r.target}</td>
                <td className={r.status ? `growth-status is-${r.status}` : undefined}>{r.statusWord}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="an-p">Ad spend, week of {weekLabel(sc.week)}: {spent || 'none entered'}.</p>
      <div className="growth-spend">
        <select className="growth-spend-channel" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
          {(sc.channels || []).map((c) => <option key={c} value={c}>{channelName(c)}</option>)}
        </select>
        <MoneyField className="growth-spend-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Spent" aria-label="Amount spent" />
        <button type="button" className="parser-eval-btn ctl is-primary" disabled={busy} onClick={save}>Save spend</button>
      </div>
      {error && <p className="an-p" role="alert">{error}</p>}
      <p className="an-p">Read elsewhere: {(sc.elsewhere || []).map((e) => `${e.what} (${e.where})`).join('; ')}.</p>
    </section>
  );
}
