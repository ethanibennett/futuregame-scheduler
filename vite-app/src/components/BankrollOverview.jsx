import React, { useMemo, useState } from 'react';
import {
  RANGES, RANGE_NOUN, rangeWindow, within, balanceSeries, profitSeries, drawdowns,
  overviewStats, recentResults,
} from '../utils/bankroll-ledger.js';
import { setResultsKind } from '../hooks/useLiveCashSession.js';
import BankrollChart from './BankrollChart.jsx';
import BankrollOverviewTables from './BankrollOverviewTables.jsx';

/**
 * The bankroll dashboard's Overview tab (beta, app admins). The layout of a serious poker tracker,
 * in this app's own type and grid:
 *   - a hero: the balance now, and the profit over the chosen range, coloured by its sign
 *   - the graph, front and centre: cumulative profit (the "chip graph") or the balance, with a
 *     range picker under it (1M / 3M / YTD / 1Y / All)
 *   - the figures as collapsible Cash | Tournaments | Total tables (Summary, Sessions, Games, Rooms,
 *     Bankroll, By month / By year): BankrollOverviewTables.jsx, arithmetic in
 *     utils/bankroll-overview.js
 *   - the latest sessions, each led by its signed profit, with links to the full lists.
 * Everything comes from the combined ledger (GET /api/bankrolls/ledger, every source: tournaments,
 * cash sessions, expenses and income, deposits) plus the risk-of-ruin estimate (GET /risk).
 * The arithmetic is utils/bankroll-ledger.js (overviewStats, profitSeries, rangeWindow), tested.
 */

const store = {
  get(k, d, ok) { try { const v = localStorage.getItem(k); return ok(v) ? v : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const RANGE_KEYS = new Set(RANGES.map((r) => r[0]));
const tone = (v) => (v > 0 ? ' an-pos' : v < 0 ? ' an-neg' : '');
const hrs = (h) => `${h >= 100 ? Math.round(h).toLocaleString() : h.toFixed(1)} h`;
const count = (n) => Math.round(n).toLocaleString();

/** A joined segmented control: N whole-g segments filling 35g (bankroll-dashboard.css .bd-seg). */
export function Segmented({ options, value, onChange, label, className = '', btnClass = 'bd-seg-btn' }) {
  return (
    <div className={'bd-seg ' + className} data-n={options.length} role="radiogroup" aria-label={label}>
      {options.map(([k, text]) => (
        <button key={String(k)} type="button" role="radio" aria-checked={value === k}
          className={btnClass + (value === k ? ' is-on' : '')} onClick={() => onChange(k)}>
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
}

export default function BankrollOverview({ d, risk, bk, bkKey, b, currency, money, signed, today, fmtDate, onClose }) {
  const [range, setRangeState] = useState(() => store.get('bankrollRange', 'ytd', (v) => RANGE_KEYS.has(v)));
  const [mode, setModeState] = useState(() => store.get('bankrollChart', 'profit', (v) => v === 'profit' || v === 'balance'));
  const setRange = (v) => { setRangeState(v); store.set('bankrollRange', v); };
  const setMode = (v) => { setModeState(v); store.set('bankrollChart', v); };

  const entries = d.entries;
  const view = useMemo(() => {
    const w = rangeWindow(range, today);
    const win = within(entries, w);
    // The balance carried into the window: the last running total before it.
    let opening = d.opening.total_display;
    if (w.from) for (const e of entries) { if (e.date < w.from) opening = e.total_display; else break; }
    const start = w.from || (entries[0] ? entries[0].date : today);
    const balPts = balanceSeries(win, { opening, from: w.from });
    const profPts = profitSeries(win, { from: w.from });
    const points = mode === 'profit' ? profPts : balPts;
    return {
      w, win, start, points, dd: drawdowns(points),
      stats: overviewStats(win),
      recent: recentResults(win, 6),
    };
  }, [d, entries, range, mode, today]);

  const s = view.stats;
  const noun = RANGE_NOUN[range];
  const rangeLabel = (RANGES.find((r) => r[0] === range) || [])[1];
  const open = (kind) => { if (bk.setSelected) bk.setSelected(bkKey); setResultsKind(kind); onClose(); };

  return (
    <>
      {/* Hero: the balance now | the range's profit. */}
      <div className="bd-hero">
        <div className="bd-hero-col">
          <div className="an-cell an-lbl an-lbl-2 an-clip">Balance</div>
          <div className={'an-cell bd-hero-val an-clip' + (d.closing.total_display < 0 ? ' an-neg' : '')}>{money(d.closing.total_display)}</div>
          <div className="an-cell an-note bd-note-3 an-clip">{currency} · {b ? b.name : 'every bankroll'}</div>
        </div>
        <div className="bd-hero-col an-num">
          <div className="an-cell an-lbl an-lbl-2 an-clip">Profit · {rangeLabel}</div>
          <div className={'an-cell bd-hero-val an-clip' + tone(s.results)}>{signed(s.results)}</div>
          <div className="an-cell an-note bd-note-3 an-clip">
            {count(s.mtt.events)} {s.mtt.events === 1 ? 'event' : 'events'} · {count(s.cash.sessions)} cash {s.cash.sessions === 1 ? 'session' : 'sessions'}
          </div>
        </div>
      </div>

      <BankrollChart points={view.points} dd={view.dd} start={view.start} end={view.w.to || today}
        money={mode === 'profit' ? signed : money} fmtDate={fmtDate} zero={mode === 'profit'}
        what={mode === 'profit' ? 'Cumulative profit' : 'Balance'}
        control={<Segmented className="bd-mode" label="Graph" options={[['profit', 'Profit'], ['balance', 'Balance']]} value={mode} onChange={setMode} />} />
      <Segmented className="bd-range" label="Range" options={RANGES} value={range} onChange={setRange} />

      {view.win.length === 0 && <p className="an-p bd-after">Nothing in the ledger for {noun}.</p>}

      {/* The figures: collapsible Cash | Tournaments | Total tables (Summary, Sessions, Games, Rooms,
          Bankroll, By month / By year) — BankrollOverviewTables.jsx. */}
      <BankrollOverviewTables d={d} risk={risk} range={range} today={today} bk={bk} bkKey={bkKey} b={b}
        currency={currency} fmtDate={fmtDate} />

      <section className="bd-section" aria-labelledby="bd-recent">
        <h3 className="an-cell an-sec" id="bd-recent">Latest sessions</h3>
        {view.recent.length === 0 && <p className="an-p">No tournaments or cash sessions {noun}.</p>}
        {view.recent.length > 0 && (
          <ul className="bd-recent" aria-label="Latest sessions">
            {view.recent.map((e) => (
              <li key={e.source + ':' + e.ref.id} className="bd-recent-row">
                <div className="bd-recent-l">
                  <span className={'an-cell bd-recent-amt an-clip' + tone(e.amount_display)}>{signed(e.amount_display)}</span>
                  <span className="an-cell an-note an-clip">{fmtDate(e.date)}</span>
                </div>
                <div className="bd-recent-r an-num">
                  <span className="an-cell bd-recent-name an-clip" title={e.label}>{e.label.replace(/^Cash /, '')}</span>
                  <span className="an-cell an-note an-clip">
                    {e.source === 'cash-sessions'
                      ? `Cash${Number(e.hours) > 0 ? ' · ' + hrs(Number(e.hours)) : ''}`
                      : `Tournament${Number(e.units) > 1 ? ` · ${e.units} bullets` : ''}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="bd-actions">
          <button type="button" className="bk-btn bd-w17" onClick={() => open('tournaments')}><span>Tournament results</span></button>
          <button type="button" className="bk-btn bd-w17" onClick={() => open('cash')}><span>Cash sessions</span></button>
        </div>
      </section>
    </>
  );
}

