import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchApi } from '../utils/api.js';
import { formatCurrencyAmount, MINUS, ordinalSuffix } from '../utils/utils.js';
import './analytics.css';

/**
 * Results analytics — BETA, app admins only (the server route is requireAppAdmin and
 * TrackingView renders the launcher only when isAdmin). Everything is computed server
 * side by lib/analytics.js from the user's own results; this file only lays it out.
 *
 * A full-height sheet (portalled to the app root, see portalTarget) rather than
 * a section inside the Results list: it starts at the app's origin, so its own r-grid
 * IS the overlay's grid, which the Results list above it is not yet on.
 *
 * Wording is descriptive throughout — what the numbers are and how big the sample is —
 * never what to play.
 */

const DIMENSIONS = [
  ['buyin', 'Buy-in'], ['variant', 'Game'], ['room', 'Room'],
  ['format', 'Live / online'], ['weekday', 'Weekday'], ['field', 'Field size'],
];
const MISSING_NOTE = {
  buyin: (n) => `${n} freeroll event${n === 1 ? '' : 's'} not banded.`,
  field: (n) => `${n} event${n === 1 ? ' has' : 's have'} no recorded field size.`,
  weekday: (n) => `${n} event${n === 1 ? ' has' : 's have'} no date.`,
};

// Portalled to the app's root container, not to <body>: that container is position:fixed, so it
// is a stacking context, and the admin grid overlay (z 9997) lives inside it. A sheet on <body>
// at any z-index would paint over the overlay and the layout could not be checked against it.
// The root has no transform or overflow, so nothing clips a fixed sheet inside it.
function portalTarget() {
  const shell = document.querySelector('.app-shell');
  return (shell && shell.parentElement) || document.body;
}

// The display currency the Results tab's summary uses ('NATIVE' shows as USD there too).
function displayCurrency() {
  try {
    const c = localStorage.getItem('trackingCurrency');
    return c && c !== 'NATIVE' ? c : 'USD';
  } catch (_) { return 'USD'; }
}

const pct = (x, digits = 1) => (x == null ? '—' : (x < 0 ? MINUS : x > 0 ? '+' : '') + Math.abs(x * 100).toFixed(digits) + '%');
const plainPct = (x, digits = 1) => (x == null ? '—' : (x * 100).toFixed(digits) + '%');
const tone = (x) => (x == null || x === 0 ? '' : x > 0 ? ' an-pos' : ' an-neg');
const count = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
function fmtDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function Stat({ label, value, valueTone = '', note }) {
  return (
    <div className="an-stat">
      <div className="an-cell an-lbl an-lbl-2 an-clip">{label}</div>
      <div className={'an-cell an-val' + valueTone}>{value}</div>
      {note && <div className="an-cell an-note">{note}</div>}
    </div>
  );
}

function Overview({ a, money }) {
  const t = a.totals;
  const v = a.variance;
  const ci = v.roiCI;
  const big = v.biggestScore;
  const fp = v.finishPercentile;
  const md = v.maxDrawdown;
  const cd = v.currentDrawdown;
  const bigNote = big ? [
    big.place ? `${big.place}${ordinalSuffix(big.place)}${big.field ? ' of ' + big.field.toLocaleString() : ''}` : null,
    big.multiple != null ? `${big.multiple.toFixed(big.multiple >= 10 ? 0 : 1)}× buy-in` : null,
  ].filter(Boolean).join(' · ') : 'No cashes yet';
  return (
    <section className="an-section" aria-labelledby="an-overview">
      <h3 className="an-cell an-sec" id="an-overview">Overview</h3>
      <div className="an-stats">
        <Stat label="ROI" value={pct(t.roi)} valueTone={tone(t.roi)}
          note={ci ? `95% CI ${pct(ci.low, 0)} to ${pct(ci.high, 0)}` : 'Needs 2+ events for a CI'} />
        <Stat label="In the money" value={plainPct(t.itm)}
          note={`${count(t.cashes, 'cash', 'cashes')} · ${count(t.entries, 'entry', 'entries')}`} />
        <Stat label="Std dev per entry" value={v.perEntry.sd == null ? '—' : `${v.perEntry.sd.toFixed(1)} buy-ins`}
          note={v.perEntry.sdAmount == null ? `${count(v.perEntry.n, 'entry', 'entries')}` : `${money(v.perEntry.sdAmount)} · n ${v.perEntry.n.toLocaleString()}`} />
        <Stat label="Biggest score" value={big ? money(big.amount) : '—'} valueTone={big ? ' an-pos' : ''} note={bigNote} />
        <Stat label="Max downswing" value={md.amount ? money(-md.amount) : 'None'} valueTone={md.amount ? ' an-neg' : ''}
          note={md.amount ? `${md.inBuyins != null ? md.inBuyins.toFixed(1) + ' buy-ins · ' : ''}${count(md.events, 'event')}${md.recovered === false ? ' · ongoing' : ''}` : 'Never below a prior high'} />
        <Stat label="Current downswing" value={cd.amount ? money(-cd.amount) : 'At a high'} valueTone={cd.amount ? ' an-neg' : ''}
          note={cd.amount ? `Since ${fmtDate(cd.from) || 'the start'} · ${count(cd.events, 'event')}` : 'Cumulative P&L at its peak'} />
        <Stat label="Avg finish" value={fp.avgTop == null ? '—' : `Top ${(fp.avgTop * 100).toFixed(fp.avgTop < 0.1 ? 1 : 0)}%`}
          note={fp.n ? `${count(fp.n, 'event')} with place + field` : 'No place + field recorded'} />
        <Stat label="Sample" value={count(t.entries, 'entry', 'entries')}
          note={`${count(t.events, 'event')} · avg ${money(v.avgBuyin)} buy-in`} />
      </div>
      <p className="an-p">
        ROI interval: percentile bootstrap over your events, {(ci ? ci.resamples : 2000).toLocaleString()} resamples. It cannot
        see a tail your results have not reached yet, so with no big score in the sample the upper end reads low.
        Downswings are peak-to-trough on cumulative P&amp;L, in event order.
      </p>
    </section>
  );
}

function Edge({ a }) {
  return (
    <section className="an-section" aria-labelledby="an-edge">
      <h3 className="an-cell an-sec" id="an-edge">Where your edge is</h3>
      <p className="an-p">
        Groups with at least <strong>{a.edge.minEntries} entries</strong>, ranked by ROI. One is called out only when its
        whole 95% interval sits above break-even.
      </p>
      {a.edge.dimensions.map((d) => (
        <div key={d.key} className="an-sub">
          <div className="an-cell an-lbl an-lbl-3">By {d.label.toLowerCase()}</div>
          <p className="an-p"><strong>{d.sentence}</strong></p>
          {d.ranked.length > 0 && (
            <div className="an-table" role="table" aria-label={`ROI by ${d.label.toLowerCase()}`}>
              <div className="an-row is-head an-cols-edge" role="row">
                <span className="an-cell an-lbl an-lbl-3b" role="columnheader">{d.label}</span>
                <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">Entries</span>
                <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">ROI</span>
                <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">95% CI</span>
              </div>
              {d.ranked.slice(0, 5).map((g) => (
                <div key={g.key} className={'an-row is-body an-cols-edge' + (g.status === 'clear' ? ' is-clear' : '')} role="row">
                  <span className="an-cell an-td an-clip" role="cell">{g.label}</span>
                  <span className="an-cell an-td an-num" role="cell">{g.entries.toLocaleString()}</span>
                  <span className={'an-cell an-td an-num' + tone(g.roi)} role="cell">{pct(g.roi, 0)}</span>
                  <span className={'an-cell an-td an-num' + (g.status === 'clear' ? ' an-pos' : '')} role="cell">
                    {g.ci ? `${pct(g.ci.low, 0)} to ${pct(g.ci.high, 0)}` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
          {d.tooSmall.length > 0 && (
            <p className="an-p">
              Under {a.edge.minEntries} entries, no estimate: {d.tooSmall.map(g => `${g.label} (${g.entries})`).join(', ')}.
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

function Breakdowns({ a, money }) {
  const [dim, setDim] = useState('buyin');
  const b = a.breakdowns[dim];
  const missingNote = b && b.missing > 0 && MISSING_NOTE[dim] ? MISSING_NOTE[dim](b.missing) : null;
  return (
    <section className="an-section" aria-labelledby="an-bd">
      <h3 className="an-cell an-sec" id="an-bd">Breakdowns</h3>
      <div className="an-chips" role="group" aria-label="Break down by">
        {DIMENSIONS.map(([key, label]) => (
          <button key={key} type="button" className="an-cell an-chip" aria-pressed={dim === key} onClick={() => setDim(key)}>
            {label}
          </button>
        ))}
      </div>
      {b && b.rows.length > 0 ? (
        <div className="an-table" role="table" aria-label={`Results by ${b.label.toLowerCase()}`}>
          <div className="an-row is-head an-cols-bd" role="row">
            <span className="an-cell an-lbl an-lbl-3b" role="columnheader">{b.label}</span>
            <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">Entries</span>
            <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">ITM</span>
            <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">ROI</span>
            <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">Profit</span>
          </div>
          {b.rows.map((r) => (
            <div key={r.key} className={'an-row is-body an-cols-bd' + (r.small ? ' is-small' : '')} role="row">
              <span className="an-cell an-td an-clip" role="cell" title={r.label}>{r.label}</span>
              <span className="an-cell an-td an-num" role="cell">{r.entries.toLocaleString()}</span>
              <span className="an-cell an-td an-num" role="cell">{plainPct(r.itm, 0)}</span>
              <span className={'an-cell an-td an-num' + tone(r.roi)} role="cell">{pct(r.roi, 0)}</span>
              <span className={'an-cell an-td an-num an-clip' + tone(r.profit)} role="cell">{money(r.profit)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="an-p">No events carry this detail yet.</p>
      )}
      <p className="an-p">
        Grey rows have fewer than {a.edge.minEntries} entries.{missingNote ? ' ' + missingNote : ''}
      </p>
    </section>
  );
}

export default function AnalyticsView({ onClose, bankroll = 'all' }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const closeRef = useRef(null);
  const currency = displayCurrency();

  useEffect(() => {
    let live = true;
    fetchApi(`/analytics?currency=${encodeURIComponent(currency)}${bankroll && bankroll !== 'all' ? `&bankroll=${encodeURIComponent(bankroll)}` : ''}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (live) setState({ status: 'ready', data });
      })
      .catch(() => { if (live) setState({ status: 'error', data: null }); });
    return () => { live = false; };
  }, [currency, bankroll]);

  useEffect(() => {
    closeRef.current && closeRef.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const a = state.data;
  const money = (v) => formatCurrencyAmount(v, (a && a.currency) || currency);

  return createPortal(
    <>
      <div className="an-scrim" onClick={onClose} />
      <div className="an-sheet" role="dialog" aria-modal="true" aria-labelledby="an-title">
        <header className="an-head">
          <h2 className="an-cell an-title" id="an-title">
            Analytics<span className="an-beta">Beta</span>
          </h2>
          <button ref={closeRef} type="button" className="an-cell an-close" onClick={onClose}>Done</button>
        </header>
        <div className="an-body">
          {state.status === 'loading' && <p className="an-p">Loading your results…</p>}
          {state.status === 'error' && <p className="an-p">Analytics could not load. Close and try again.</p>}
          {a && a.totals.events === 0 && <p className="an-p">Log a result and the analysis starts here.</p>}
          {a && a.totals.events > 0 && (
            <>
              <Overview a={a} money={money} />
              <Edge a={a} />
              <Breakdowns a={a} money={money} />
            </>
          )}
        </div>
      </div>
    </>,
    portalTarget(),
  );
}
