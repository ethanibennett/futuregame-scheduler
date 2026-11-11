import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { normaliseDate } from '../utils/utils.js';
import { useToast } from '../contexts/ToastContext.jsx';

/* Sell a package (Features 20, 2026-11-11). The owner's panel under Staking's series, and the page a link
   opens. A record, not a marketplace: payment is between the player and the backer, outside the app. */
const money = (n) => `$${(Math.round(Number(n) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const hdr = (token) => ({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' });

export function PackagesPanel({ token, series, mySchedule }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [making, setMaking] = useState(false);
  const [f, setF] = useState({ seriesId: '', pct: '40', markup: '1.1', note: '' });
  const load = useCallback(() => {
    fetch(`${API_URL}/staking/packages`, { headers: hdr(token) }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setList(d.packages || [])).catch(() => {});
  }, [token]);
  useEffect(() => { load(); }, [load]);
  const s = (series || []).find((x) => String(x.id) === String(f.seriesId));
  // The saved events inside the series' dates, with their planned bullets.
  const events = useMemo(() => (mySchedule || []).filter((t) => t.venue !== 'Personal' && s && (!s.start_date || (normaliseDate(t.date) || '') >= s.start_date) && (!s.end_date || (normaliseDate(t.date) || '') <= s.end_date))
    .map((t) => ({ name: t.event_name, date: normaliseDate(t.date), buyin: Number(t.buyin) || 0, bullets: Number(t.planned_entries) || 1 })), [mySchedule, s]);
  const total = events.reduce((a, e) => a + e.buyin * e.bullets, 0);
  const one = (total / 100) * (Number(f.markup) || 1);
  const make = async () => {
    const r = await fetch(`${API_URL}/staking/packages`, { method: 'POST', headers: hdr(token), body: JSON.stringify({ seriesId: Number(f.seriesId) || null, pct: Number(f.pct), markup: Number(f.markup), note: f.note, events }) }).catch(() => null);
    const d = r && (await r.json().catch(() => ({})));
    if (!r || !r.ok) { if (toast) toast.error((d && d.error) || 'Not made'); return; }
    setMaking(false);
    navigator.clipboard.writeText(d.package.url).then(() => toast && toast.success('Package link copied'), () => {});
    load();
  };
  const decide = async (pkg, req, status) => {
    let agreementId = null;
    if (status === 'accepted' && pkg.seriesId) {
      // The backer and the series agreement the player would have typed, through the usual routes.
      const b = await fetch(`${API_URL}/staking/backers`, { method: 'POST', headers: hdr(token), body: JSON.stringify({ name: req.name, notes: req.contact }) }).then((r) => r.json()).catch(() => null);
      const backerId = b && (b.id || (b.backer && b.backer.id));
      if (backerId) {
        const a = await fetch(`${API_URL}/staking/series/${pkg.seriesId}/agreements`, { method: 'POST', headers: hdr(token), body: JSON.stringify({ backerId, backerType: 'pay_per_play', percentage: req.pct, markup: pkg.markup }) }).then((r) => r.json()).catch(() => null);
        agreementId = a && (a.id || (a.agreement && a.agreement.id)) || null;
      }
    }
    await fetch(`${API_URL}/staking/package-requests/${req.id}`, { method: 'PUT', headers: hdr(token), body: JSON.stringify({ status, agreementId }) }).catch(() => {});
    if (toast) toast.success(status === 'accepted' ? `${req.name}'s ${req.pct}% is an agreement in the series` : 'Declined');
    load();
  };
  return (
    <section className="pk-panel">
      <div className="pk-head"><span className="pk-title">Packages</span>
        {!making && <button type="button" className="btn btn-ghost ctl pk-btn" onClick={() => setMaking(true)}><span>Sell a package</span></button>}
      </div>
      {making && (
        <div className="pk-form">
          <select value={f.seriesId} onChange={(e) => setF({ ...f, seriesId: e.target.value })} aria-label="Series">
            <option value="">Choose the series</option>
            {(series || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <div className="pk-two">
            <label><span>For sale, %</span><input inputMode="decimal" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></label>
            <label><span>Markup</span><input inputMode="decimal" value={f.markup} onChange={(e) => setF({ ...f, markup: e.target.value })} /></label>
          </div>
          <p className="mi-note">{s ? `${events.length} saved event${events.length === 1 ? '' : 's'} in its dates · ${money(total)} in buy-ins · 1% costs ${money(one)}` : 'The series’ dates choose the events from My Schedule.'}</p>
          <input placeholder="A line for backers (optional): PLO and HORSE only" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <p className="mi-note">The page lists the events and the price; anyone can ask for a share, and you accept or decline. Payment is between you, outside the app.</p>
          <div className="mi-btns">
            <button type="button" className="btn btn-ghost ctl mi-btn" onClick={() => setMaking(false)}><span>Cancel</span></button>
            <button type="button" className="btn btn-primary ctl mi-btn" disabled={!s || !events.length} onClick={make}><span>Make the link</span></button>
          </div>
        </div>
      )}
      {(list || []).map((p) => (
        <div key={p.id} className="pk-card">
          <div className="pk-line"><b>{`Selling ${p.pct}%`}</b><span>{`1% ${money(p.onePct)}`}</span></div>
          <div className="gw-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round((p.sold / p.pct) * 100))}%`, background: 'var(--brand)' }} /></div>
          <div className="pk-line"><span>{`${p.sold}% sold`}</span>
            <button type="button" className="tq-mark" onClick={() => navigator.clipboard.writeText(p.url).then(() => toast && toast.success('Link copied'), () => {})}><span>Copy link</span></button>
          </div>
          {p.requests.filter((r) => r.status === 'new').map((r) => (
            <div key={r.id} className="tk-row">
              <span className="tk-main"><b>{`${r.name} · ${r.pct}%`}</b><span>{[r.contact, r.note].filter(Boolean).join(' · ')}</span></span>
              <span className="tk-acts">
                <button type="button" className="tq-mark" onClick={() => decide(p, r, 'accepted')}><span>Accept</span></button>
                <button type="button" className="tq-mark" onClick={() => decide(p, r, 'declined')}><span>Decline</span></button>
              </span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

export function PackagePage({ token }) {
  const [pkg, setPkg] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ name: '', contact: '', pct: '', note: '' });
  const [sent, setSent] = useState(false);
  useEffect(() => {
    fetch(`${API_URL}/package/${encodeURIComponent(token)}`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))).then(({ ok, j }) => (ok ? setPkg(j) : setErr(j.error || 'This link does not open'))).catch(() => setErr('No connection'));
  }, [token]);
  const ask = async () => {
    const r = await fetch(`${API_URL}/package/${encodeURIComponent(token)}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, pct: Number(f.pct) }) }).catch(() => null);
    const d = r && (await r.json().catch(() => ({})));
    if (!r || !r.ok) { setErr((d && d.error) || 'Not sent'); return; }
    setSent(true);
  };
  return (
    <div className="app-shell pk-shell">
      <main className="content-area pk-page">
        {err && !pkg && <p className="mi-note">{err}</p>}
        {pkg && (
          <>
            <h1 className="pk-h1">{`${pkg.player}${pkg.series ? ` · ${pkg.series}` : ''}`}</h1>
            <p className="mi-note">{`${pkg.left}% of ${pkg.pct}% left · 1% costs ${money(pkg.onePct)}${pkg.markup > 1 ? ` (${pkg.markup} markup)` : ''}`}</p>
            {pkg.note && <p className="mi-note">{pkg.note}</p>}
            <div className="pk-card">
              {pkg.events.map((e, i) => (
                <div key={i} className="mi-row"><span>{e.date ? new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span><span className="mi-room">{e.name}</span><b>{`${money(e.buyin)}${e.bullets > 1 ? ` x${e.bullets}` : ''}`}</b></div>
              ))}
            </div>
            {sent ? <p className="mi-note">Sent. The player answers you directly; payment is between the two of you.</p> : pkg.closed || pkg.left <= 0 ? <p className="mi-note">This package is closed.</p> : (
              <div className="pk-form">
                <input placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                <input placeholder="How the player reaches you (phone or email)" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
                <input inputMode="decimal" placeholder={`Percent, up to ${pkg.left}`} value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} />
                <input placeholder="A note (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
                {err && <p className="mi-note rp-err">{err}</p>}
                <button type="button" className="btn btn-primary ctl mi-btn" disabled={!f.name || !f.contact || !f.pct} onClick={ask}><span>Ask for a share</span></button>
                <p className="mi-note">A request, not a payment: nothing is paid through futurega.me.</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
