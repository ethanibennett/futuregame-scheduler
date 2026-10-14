import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrencyAmount, MINUS, getToday } from '../utils/utils.js';
import {
  prepareFacts, applyFilters, normaliseFilters, emptyFilters, activeCount, summaryParts, fixedLabel, optionsFor, clearAll,
} from '../utils/bankroll-filters.js';
import { REPORTS, buildReport, summaryStats, barLayout, reportAvailability } from '../utils/bankroll-reports.js';
import { bbColumn, bbFigures, bbBasis } from '../utils/bb-hr.js';
import BankrollFilters, { Chip } from './BankrollFilters.jsx';
import './analytics.css';
import './bankroll-reports.css';

/**
 * The bankroll dashboard's Reports tab — BETA, app admins (the dashboard is admin-only and
 * GET /api/bankrolls/reports is requireAppAdmin).
 *
 * The serious-tracker pattern: one filter model over everything played and spent (date, type,
 * bankroll, game, stakes / buy-in, room, live / online, day of week, start time), a compact bar
 * that says what is on, and breakdowns that answer "where do I win and lose": by room, game,
 * stakes, buy-in, day, start time, session length, month and expense category, each a table of
 * label | played | profit | rate with a bar per row and the best and worst rows marked.
 *
 * Data: GET /api/bankrolls/reports (lib/bankroll-reports.js) once per currency; everything else is
 * client-side (utils/bankroll-filters.js, utils/bankroll-reports.js). Filters and the chosen
 * report are remembered per viewer (localStorage, best effort).
 *
 * Layout (35g content): bar 5r — Filters 8g | 1g | summary 17g | 1g | Clear 8g; 2r; the report
 * picker 3 x 11g chips, 4r, 1r between rows; then the figures (the dashboard's 2 x 17g stats),
 * the insight line and the table: a 3r head, 5r rows (a 4r text line, baseline on its line 3, over
 * a 1r bar), a 4r total. Columns 13g | 4g | 9g | 9g.
 */

const STORE = 'bankrollReports';
function load() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) { return null; }
}
function save(v) {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (_) { /* private mode: not remembered */ }
}

const RATE_HEAD = { hourly: 'Per hour', roi: 'ROI', avg: 'Average', share: 'Share' };
const pct = (x) => (x == null ? '—' : (x < 0 ? MINUS : x > 0 ? '+' : '') + Math.abs(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0) + '%');
const share = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
const tone = (v) => (v > 0 ? ' an-pos' : v < 0 ? ' an-neg' : '');

function Stat({ label, value, tone: t = '', note }) {
  return (
    <div className="an-stat">
      <div className="an-cell an-lbl an-lbl-2 an-clip">{label}</div>
      <div className={'an-cell an-val an-clip' + t}>{value}</div>
      {note && <div className="an-cell an-note an-clip">{note}</div>}
    </div>
  );
}

function ReportTable({ rep, signed, rate }) {
  const layout = barLayout(rep.rows.map((r) => r.profit), 35);
  const countOf = (r) => (rep.key === 'category' ? r.count : r.n);
  // A per-hour table (every row cash) carries bb/hr beside it: a fifth column, 6g, taken from the label's
  // room. A row with both units (rare) runs onto a second 4r line for the big-bet figure; the bar moves down.
  const hourly = rep.rateKind === 'hourly';
  const col = hourly ? bbColumn([...rep.rows.map((r) => r.bbhr), rep.total.bbhr]) : null;
  const cols = 'br-cols' + (hourly ? ' br-cols-bb' : '');
  const bbCells = (res, tonedCls, key) => {
    const lines = col.lines(res);
    const cell = (l, i) => (
      <span key={key + i} className={'an-cell an-td an-num an-clip' + (i ? ' br-bb2' : '') + tonedCls(l)} role="cell"
        title={l.unit ? bbBasis(res[l.unit]) : undefined}>{l.text}</span>
    );
    return lines.map(cell);
  };
  const toneCls = (l) => (l.tone > 0 ? ' an-pos' : l.tone < 0 ? ' an-neg' : '');
  return (
    <div className="br-table" role="table" aria-label={`Profit by ${rep.label.toLowerCase()}`}>
      <div className={'an-row is-head ' + cols} role="row">
        <span className="an-cell an-lbl an-lbl-3b" role="columnheader">{rep.label}</span>
        <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">{rep.key === 'category' ? 'Rows' : 'Played'}</span>
        <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">{rep.key === 'month' ? 'Net' : 'Profit'}</span>
        <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">{RATE_HEAD[rep.rateKind] || ''}</span>
        {hourly && <span className="an-cell an-lbl an-lbl-3b an-num br-unit" role="columnheader">{col.label}</span>}
      </div>
      {rep.rows.map((r, i) => {
        const b = layout.bars[i];
        const two = hourly && col.lines(r.bbhr).length > 1;
        return (
          <div key={r.key} className={'br-row ' + cols + (two ? ' is-2' : '') + (r.best ? ' is-best' : '') + (r.worst ? ' is-worst' : '')} role="row">
            <span className="an-cell an-td an-clip" role="cell" title={r.label}
              aria-label={r.label + (r.best ? ', best' : r.worst ? ', worst' : '')}>{r.label}</span>
            <span className="an-cell an-td an-num an-clip" role="cell">{countOf(r) || '—'}</span>
            <span className={'an-cell an-td an-num an-clip' + tone(r.profit)} role="cell">{signed(r.profit)}</span>
            <span className={'an-cell an-td an-num an-clip' + (rep.rateKind === 'share' ? '' : tone(r.rate))} role="cell">{rate(rep.rateKind, r.rate)}</span>
            {hourly && bbCells(r.bbhr, toneCls, 'b')}
            <span className="br-track" aria-hidden="true">
              {b.width > 0 && (
                <span className={'br-fill' + (r.profit < 0 ? ' is-neg' : '')}
                  style={{ left: `calc(var(--gu) * ${b.start})`, width: `calc(var(--gu) * ${b.width})` }} />
              )}
              {layout.zero > 0 && layout.zero < 35 && <span className="br-zero" style={{ left: `calc(var(--gu) * ${layout.zero})` }} />}
            </span>
          </div>
        );
      })}
      <div className={'an-row is-body ' + cols + ' br-total' + (hourly && col.lines(rep.total.bbhr).length > 1 ? ' is-2' : '')} role="row">
        <span className="an-cell an-td an-clip" role="cell">All</span>
        <span className="an-cell an-td an-num an-clip" role="cell">{(rep.key === 'category' ? rep.total.count : rep.total.n) || '—'}</span>
        <span className={'an-cell an-td an-num an-clip' + tone(rep.total.profit)} role="cell">{signed(rep.total.profit)}</span>
        <span className={'an-cell an-td an-num an-clip' + tone(rep.total.rate)} role="cell">{rep.rateKind === 'share' ? '100%' : rate(rep.rateKind, rep.total.rate)}</span>
        {hourly && bbCells(rep.total.bbhr, toneCls, 't')}
      </div>
    </div>
  );
}

export default function BankrollReports({ bk, bankrollKey, currency }) {
  const today = getToday();
  const stored = useRef(load());
  const [state, setState] = useState({ status: 'loading', facts: [] });
  const [filters, setFilters] = useState(() => {
    if (stored.current && stored.current.filters) return normaliseFilters(stored.current.filters);
    const f = emptyFilters();
    if (bankrollKey != null && String(bankrollKey) !== 'all') f.bankrolls = [String(bankrollKey)];
    return f;
  });
  const [report, setReport] = useState(() => (stored.current && REPORTS.some((r) => r.key === stored.current.report) ? stored.current.report : 'room'));
  const [sheet, setSheet] = useState(false);
  const closeSheet = useCallback(() => setSheet(false), []);

  // The dashboard's bankroll selector drives the Bankroll filter when it changes.
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) { firstKey.current = false; return; }
    setFilters((f) => ({ ...f, bankrolls: String(bankrollKey) === 'all' ? [] : [String(bankrollKey)] }));
  }, [bankrollKey]);
  useEffect(() => { save({ filters, report }); }, [filters, report]);

  useEffect(() => {
    let live = true;
    setState((s) => ({ status: 'loading', facts: s.facts }));
    bk.call('GET', `/reports?currency=${encodeURIComponent(currency)}`)
      .then((d) => { if (live) setState({ status: 'ready', facts: prepareFacts(d.facts || []) }); })
      .catch(() => { if (live) setState({ status: 'error', facts: [] }); });
    return () => { live = false; };
  }, [currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const money = useCallback((v) => formatCurrencyAmount(Math.round(v || 0), currency), [currency]);
  const signed = useCallback((v) => (v > 0 ? '+' : '') + formatCurrencyAmount(Math.round(v || 0), currency), [currency]);
  const rate = useCallback((kind, v) => {
    if (v == null) return '—';
    if (kind === 'roi') return pct(v);
    if (kind === 'share') return share(v);
    if (kind === 'hourly') return signed(v) + '/h';
    return signed(v);
  }, [signed]);

  const names = useMemo(() => new Map([['main', 'Main'], ...(bk.bankrolls || []).filter((b) => b.id !== 'main').map((b) => [String(b.id), b.name])]), [bk.bankrolls]);
  const facts = state.facts;
  const shown = useMemo(() => applyFilters(facts, filters, today), [facts, filters, today]);
  const stats = useMemo(() => summaryStats(shown), [shown]);
  const avail = useMemo(() => reportAvailability(shown), [shown]);
  const rep = useMemo(() => buildReport(shown, report), [shown, report]);

  const labelOf = useCallback((dim, key) => {
    const fixed = fixedLabel(dim, key);
    if (fixed) return fixed;
    const o = optionsFor(facts, dim, { names }).find((x) => x.key === key);
    return o ? o.label : key;
  }, [facts, names]);
  const active = activeCount(filters);
  const summary = summaryParts(filters, labelOf).map((p) => p.text).join(' · ');

  const best = rep.rows.find((r) => r.best), worst = rep.rows.find((r) => r.worst);
  const t = stats.tournament, c = stats.cash;
  // bb/hr tiles beside Cash per hour: one per unit that qualifies (bb, and BB for limit), else one dash tile.
  const bbFigs = bbFigures(c.bbhr);
  const bbTiles = (bbFigs.length ? bbFigs : [null]).map((f) => (
    // The unit keeps its case in a caps label: bb/hr (big blinds) and BB/hr (big bets) are two units.
    <Stat key={f ? f.unit : 'bb'} label={<>Cash <span className="br-unit">{f ? f.label : 'bb/hr'}</span></>} value={f ? f.text : '—'} tone={f ? tone(f.tone) : ''}
      note={f ? bbBasis(c.bbhr[f.unit]) : c.n ? 'No big blind in the stakes' : 'No cash sessions'} />
  ));

  return (
    <section className="bd-section br-reports" aria-labelledby="br-title">
      <h3 className="an-cell an-sec" id="br-title">Reports</h3>
      <div className="br-bar">
        <button type="button" className="bk-btn bk-w8" aria-haspopup="dialog" onClick={() => setSheet(true)}>
          <span>{active ? `Filters · ${active}` : 'Filters'}</span>
        </button>
        <span className={'an-cell an-td an-clip br-summary' + (active ? '' : ' is-none')} title={summary || undefined}>
          {active ? summary : 'Everything, all time'}
        </span>
        <button type="button" className="bk-btn bk-w8" disabled={!active} onClick={() => setFilters(clearAll())}><span>Clear</span></button>
      </div>

      <div className="br-grid br-grid-3 br-picker" role="radiogroup" aria-label="Report">
        {REPORTS.map((r) => (
          <Chip key={r.key} on={report === r.key} disabled={!avail[r.key] && report !== r.key} onClick={() => setReport(r.key)}>{r.label}</Chip>
        ))}
      </div>

      {state.status === 'error' && <p className="an-p">The reports could not load. Close the dashboard and try again.</p>}
      {state.status === 'loading' && !facts.length && <p className="an-p">Loading…</p>}
      {state.status !== 'error' && (facts.length > 0 || state.status === 'ready') && (
        <>
          <div className="an-stats br-stats">
            <Stat label="Net" value={signed(stats.net)} tone={tone(stats.net)}
              note={stats.expenses.n ? `Expenses and income ${signed(stats.expenses.net)}` : `${currency}, filtered`} />
            <Stat label="Played" value={stats.played.toLocaleString()}
              note={[t.n && `${t.n} events`, c.n && `${c.n} sessions`].filter(Boolean).join(' · ') || 'Nothing played'} />
            <Stat label="Cash per hour" value={c.hourly == null ? '—' : signed(c.hourly)} tone={tone(c.hourly)}
              note={c.n ? `${c.hours.toFixed(1)} h · ${c.wins} of ${c.n} up` : 'No cash sessions'} />
            {bbTiles}
            <Stat label="Tournament ROI" value={pct(t.roi)} tone={tone(t.roi)}
              note={t.n ? `${signed(t.profit)} on ${money(t.cost)}` : 'No tournaments'} />
          </div>

          {shown.length === 0 && (
            <p className="an-p br-gap"><strong>Nothing matches these filters.</strong> Clear one, or all of them, to see results again.</p>
          )}
          {shown.length > 0 && rep.empty && (
            <p className="an-p br-gap">No {rep.label.toLowerCase()} figures under these filters{rep.key === 'length' || rep.key === 'stakes' ? ' (cash sessions only)' : rep.key === 'buyin' ? ' (tournaments only)' : rep.key === 'category' ? ' (expenses and income only)' : ''}.</p>
          )}
          {!rep.empty && (
            <>
              <p className="an-p br-gap">
                {best && worst
                  ? <><strong>Best</strong> {best.label} {signed(best.profit)}. <strong>Worst</strong> {worst.label} {signed(worst.profit)}.</>
                  : rep.key === 'category' ? <>Expenses and income by category, largest first.</>
                    : rep.rows.length === 1 ? <>Only <strong>{rep.rows[0].label}</strong> under these filters.</>
                      : <>Every {rep.label.toLowerCase()} came out level.</>}
                {rep.missing > 0 && ` ${rep.missing} without a ${rep.key === 'hour' ? 'start time' : rep.label.toLowerCase()} left out.`}
              </p>
              <ReportTable rep={rep} signed={signed} rate={rate} />
              <p className="an-p">
                {rep.rateKind === 'hourly' && 'Per hour is profit over hours played. bb/hr is the net of each session over its own big blind, over the hours (sessions whose stakes name no blind are left out); limit games count big bets, BB. '}
                {rep.rateKind === 'roi' && 'ROI is profit over buy-ins, re-entries included. '}
                {rep.rateKind === 'avg' && 'Average is profit per event or session; filter by type for per hour or ROI. '}
                {rep.key === 'month' && 'Net includes expenses and income; the rate is the games alone. '}
                {rep.key === 'hour' && 'Start time is the event\'s scheduled start, or when a cash session began, in your time. '}
                Small samples swing: read a row with its count.
              </p>
            </>
          )}
        </>
      )}

      {sheet && (
        <BankrollFilters facts={facts} filters={filters} onChange={setFilters} onClose={closeSheet} today={today} names={names} />
      )}
    </section>
  );
}
