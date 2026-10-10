import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './TaxReportView.css';
import { API_URL } from '../utils/api.js';
import { getToday, nativeCurrency, getVenueInfo } from '../utils/utils.js';
import { buildTaxReport, availableYears, defaultTaxYear } from '../utils/tax-report.js';
import {
  TAX_DISCLAIMER, TAX_SOURCES, MONTH_SHORT, usd, signedUsd, shortDate, filingRows, w2gRuleText, lossRuleText,
} from '../utils/tax-report-text.js';

// BETA "tax-ready year-end report" — app admins only (TrackingView shows the entry point only when
// isAdmin; GET /api/tax-report/entries is requireAppAdmin). Every figure comes from
// utils/tax-report.js; this file only lays it out on the g/r grid (TaxReportView.css).
//
// Bankroll filter: `bankrollId` is accepted and passed straight to buildTaxReport, but nothing sets
// it yet. When multiple bankrolls land, pass the selected bankroll's id (null = all bankrolls).

// A block held to whole r (after AdminBatchesView's WholeRows): WebKit lays boxes out in 1/64px
// units, so each calc(r * n) row lands a hair short (measured at 402 wide: a 3r row 2.9998r, a 4-line
// paragraph 7.997r) and a long report drifts off the grid — 0.02r by the month table. The outer box
// is sized so its bottom lands on a whole r from the view's top, so every block starts on a line.
function WholeRows({ className, children }) {
  const outer = useRef(null);
  const inner = useRef(null);
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return undefined;
    const apply = () => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
      o.appendChild(probe);
      const r = probe.getBoundingClientRect().height / 100;
      probe.remove();
      if (!(r > 0)) return;
      // Snap the block's BOTTOM to a whole r from the view's top, not just its height: whole-r
      // heights still floor one by one, and over a dozen blocks that adds up to 0.03r. Anchoring
      // each bottom to the view keeps the error at one rounding (< 0.003r) wherever the block sits.
      const view = o.closest('.taxr-view') || o.parentElement;
      const top = view.getBoundingClientRect().top;
      const ot = o.getBoundingClientRect().top;
      const bottom = top + Math.round((i.getBoundingClientRect().bottom - top) / r) * r;
      o.style.height = `calc(var(--subrow) * ${((bottom - ot) / r).toFixed(4)})`;
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    // Next frame: re-sizing here resizes the enclosing block, whose observer would otherwise fire
    // inside this same delivery ("ResizeObserver loop completed with undelivered notifications").
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(apply); });
    ro.observe(i);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return <div ref={outer} className="taxr-whole"><div ref={inner} className={className}>{children}</div></div>;
}

// Long lists in runs of 10 whole-r groups, so drift inside a list never reaches 0.01r.
function chunks(list, n = 10) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

const signClass = (n) => (n > 0 ? ' tracking-profit-pos' : n < 0 ? ' tracking-profit-neg' : '');

function Header({ title, right }) {
  return (
    <div className="taxr-head">
      <div className="taxr-t taxr-t3 taxr-title">{title}</div>
      {right}
    </div>
  );
}

function Row({ label, value, cls = '' }) {
  return (
    <div className="taxr-row">
      <div className="taxr-t taxr-t3 taxr-row-label">{label}</div>
      <div className={'taxr-t taxr-t3 taxr-row-value' + cls}>{value}</div>
    </div>
  );
}

function Para({ children, muted, strong }) {
  return <p className={'taxr-p' + (muted ? ' is-muted' : '') + (strong ? ' is-strong' : '')}>{children}</p>;
}

export default function TaxReportView({ token, onClose, bankrollId = null }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [rates, setRates] = useState(null);
  const [year, setYear] = useState(() => defaultTaxYear(getToday()));
  const [basis, setBasis] = useState('gross');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/tax-report/entries`, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? 'The tax report is in beta for admins only.' : 'Could not load your results.'))))
      .then((j) => { if (live) setEntries(j.entries || []); })
      .catch((e) => { if (live) setError(e.message); });
    fetch(`${API_URL}/exchange-rates`).then((r) => r.json()).then((j) => { if (live) setRates(j.rates || null); }).catch(() => {});
    return () => { live = false; };
  }, [token]);

  const withCurrency = useMemo(() => (entries || []).map((e) => ({ ...e, currency: nativeCurrency(e.venue) })), [entries]);
  const years = useMemo(() => availableYears(withCurrency, getToday()), [withCurrency]);
  const report = useMemo(() => buildTaxReport(withCurrency, {
    year,
    bankrollId,
    // rates are units per USD (the Tracking tab's /exchange-rates).
    toUSD: rates ? (v, cur) => (rates[cur] ? v / rates[cur] : NaN) : null,
  }), [withCurrency, year, bankrollId, rates]);

  const yi = years.indexOf(year);
  const older = yi >= 0 && yi < years.length - 1 ? years[yi + 1] : null;
  const newer = yi > 0 ? years[yi - 1] : null;

  const run = async (kind) => {
    if (busy) return;
    setBusy(kind);
    try {
      const m = await import('../utils/tax-report-export.js');
      if (kind === 'csv') await m.exportTaxCsv(report);
      else await m.exportTaxPdf(report, { basis });
    } catch (e) {
      console.error('Tax report export failed:', e);
    } finally { setBusy(''); }
  };

  const t = report.totals;
  const f = report.filing[basis];
  const months = report.months.filter((m) => m.sessions);
  const roomOf = (s) => (s.online ? `Online · ${s.site}` : (s.room || getVenueInfo(s.venue).longName || s.venue));
  const placeOf = (s) => [shortDate(s.date), roomOf(s), s.location].filter(Boolean).join(' · ');
  const money = (s, v) => (s.currency === 'USD' ? usd(v) : `${v.toLocaleString('en-US')} ${s.currency}`);

  return (
    <div className="taxr-view">
      <Header title="Tax Report" right={<span className="taxr-badge">Beta</span>} />

      <div className="taxr-bar">
        <button type="button" className="taxr-btn" onClick={onClose}><span className="taxr-t">‹ Results</span></button>
        <div className="taxr-year">
          <button type="button" className="taxr-btn" disabled={!older} onClick={() => older && setYear(older)} aria-label="Earlier year"><span className="taxr-t">‹</span></button>
          <span className="taxr-t taxr-year-label">{year}</span>
          <button type="button" className="taxr-btn" disabled={!newer} onClick={() => newer && setYear(newer)} aria-label="Later year"><span className="taxr-t">›</span></button>
        </div>
        <button type="button" className="taxr-btn is-brand" disabled={!entries || !!busy} onClick={() => run('csv')}><span className="taxr-t">{busy === 'csv' ? 'Saving…' : 'CSV'}</span></button>
        <button type="button" className="taxr-btn is-brand" disabled={!entries || !!busy} onClick={() => run('pdf')}><span className="taxr-t">{busy === 'pdf' ? 'Saving…' : 'PDF'}</span></button>
      </div>

      <WholeRows className="taxr-card">
        <Para strong>{TAX_DISCLAIMER}</Para>
      </WholeRows>

      {error && <div className="taxr-t taxr-t3 taxr-msg">{error}</div>}
      {!error && !entries && <div className="taxr-t taxr-t3 taxr-msg">Loading…</div>}

      {entries && (
        <>
          <WholeRows className="taxr-block">
            <Header title={`Totals ${year}`} />
            <Row label="Gross winnings (cashes)" value={usd(t.grossWinnings)} />
            <Row label="Total buy-ins (wagers)" value={usd(t.totalBuyins)} />
            <Row label="Net" value={signedUsd(t.net)} cls={signClass(t.net)} />
            <Row label="Sessions · cashes" value={`${t.sessions} · ${t.cashes}`} />
            <Row label="Winning sessions, net" value={usd(t.sessionWinnings)} />
            <Row label="Losing sessions, net" value={usd(t.sessionLosses)} />
            {(report.notes.converted > 0 || report.notes.unconverted > 0 || report.notes.undated > 0) && (
              <Para muted>
                {report.notes.converted > 0 && `${report.notes.converted} result${report.notes.converted === 1 ? ' is' : 's are'} in another currency, converted at today's rate — the IRS wants the rate on the day you were paid. `}
                {report.notes.unconverted > 0 && `${report.notes.unconverted} result${report.notes.unconverted === 1 ? '' : 's'} in another currency ${report.notes.unconverted === 1 ? 'is' : 'are'} left out of the totals (no exchange rate). `}
                {report.notes.undated > 0 && `${report.notes.undated} result${report.notes.undated === 1 ? ' has' : 's have'} no readable date and ${report.notes.undated === 1 ? 'is' : 'are'} left out.`}
              </Para>
            )}
          </WholeRows>

          {months.length > 0 && (
            <WholeRows className="taxr-block">
              <Header title="By Month" />
              <div className="taxr-mrow is-head">
                <span className="taxr-t">Month</span><span className="taxr-t">Sess.</span><span className="taxr-t">Won</span><span className="taxr-t">Buy-ins</span><span className="taxr-t">Net</span>
              </div>
              {months.map((m) => (
                <div key={m.month} className="taxr-mrow">
                  <span className="taxr-t">{MONTH_SHORT[m.month - 1]}</span>
                  <span className="taxr-t">{m.sessions}</span>
                  <span className="taxr-t">{usd(m.winnings)}</span>
                  <span className="taxr-t">{usd(m.buyins)}</span>
                  <span className={'taxr-t' + signClass(m.net)}>{signedUsd(m.net)}</span>
                </div>
              ))}
            </WholeRows>
          )}

          <WholeRows className="taxr-block">
            <Header title="Possible W-2Gs" right={<span className="taxr-badge">{report.w2g.length}</span>} />
            <Para muted>{w2gRuleText(report)}</Para>
            {report.w2g.map((s) => (
              <div key={s.id} className="taxr-item">
                <span className="taxr-t taxr-item-name">{s.event}</span>
                <span className="taxr-t taxr-item-amt">{usd(s.cash)}</span>
                <span className="taxr-t taxr-item-meta">{placeOf(s)}</span>
                <span className="taxr-t taxr-item-meta is-right">{usd(s.w2gNet)} net of buy-in</span>
              </div>
            ))}
          </WholeRows>

          <WholeRows className="taxr-block">
            <Header title="Recreational vs Pro" />
            <div className="taxr-seg">
              <button type="button" className={'taxr-btn' + (basis === 'gross' ? ' is-on' : '')} onClick={() => setBasis('gross')}><span className="taxr-t">Gross</span></button>
              <button type="button" className={'taxr-btn' + (basis === 'session' ? ' is-on' : '')} onClick={() => setBasis('session')}><span className="taxr-t">Per event</span></button>
            </div>
            <Para muted>
              {basis === 'gross'
                ? 'Gross: every cash is a win and every buy-in a loss.'
                : 'Per event: each tournament netted on its own — cash minus that event\'s buy-ins.'}
              {' '}{lossRuleText(report, f)}
            </Para>
            <div className="taxr-frow is-head">
              <span className="taxr-t" /><span className="taxr-t">Recreational</span><span className="taxr-t">Professional</span>
            </div>
            <div className="taxr-frow">
              <span className="taxr-t">Where it goes</span><span className="taxr-t">Sch. 1 + Sch. A</span><span className="taxr-t">Sch. C + SE</span>
            </div>
            {filingRows(f).map((r) => (
              <div key={r.key} className="taxr-frow">
                <span className="taxr-t">{r.label}</span><span className="taxr-t">{r.rec}</span><span className="taxr-t">{r.pro}</span>
              </div>
            ))}
            <Para muted>
              Recreational: losses count only if you itemize. Professional: business expenses (travel,
              lodging) count as wagering losses under the same cap; they aren&apos;t tracked here.
              Which one applies to you is a question for a tax professional.
            </Para>
          </WholeRows>

          <WholeRows className="taxr-block">
            <Header title="Session Log" right={<span className="taxr-badge">{report.sessions.length}</span>} />
            {report.sessions.length === 0 && <div className="taxr-t taxr-t3 taxr-msg">No results logged in {year}.</div>}
            {chunks(report.sessions).map((run) => (
              <WholeRows key={run[0].id} className="taxr-run">
                {run.map((s) => (
                  <div key={s.id} className="taxr-item">
                    <span className="taxr-t taxr-item-name">{s.event}</span>
                    <span className={'taxr-t taxr-item-amt' + signClass(s.net)}>{s.currency === 'USD' ? signedUsd(s.net) : `${s.net.toLocaleString('en-US')} ${s.currency}`}</span>
                    <span className="taxr-t taxr-item-meta">{placeOf(s)}{s.likelyW2G ? ' · W-2G?' : ''}</span>
                    <span className="taxr-t taxr-item-meta is-right">{money(s, s.buyin)} × {s.entries}{s.cash ? ` · ${money(s, s.cash)}` : ''}</span>
                  </div>
                ))}
              </WholeRows>
            ))}
          </WholeRows>

          <WholeRows className="taxr-block">
            <Header title="Sources" />
            {TAX_SOURCES.map((s) => <div key={s.url} className="taxr-t taxr-src">{s.label}</div>)}
          </WholeRows>
        </>
      )}
    </div>
  );
}
