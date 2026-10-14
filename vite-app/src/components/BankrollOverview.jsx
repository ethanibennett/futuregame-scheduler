import React, { useMemo, useState } from 'react';
import { CURRENCY_CONFIG, formatCurrencyAmount } from '../utils/utils.js';
import {
  RANGES, RANGE_NOUN, rangeWindow, within, balanceSeries, chartSpan,
  overviewStats, recentResults, SERIES, SERIES_KEYS, gameSeries, seriesLine, parseSeriesPref, compactMoney,
} from '../utils/bankroll-ledger.js';
import { ledgerScope } from '../utils/bankroll-overview.js';
import { setResultsKind } from '../hooks/useLiveCashSession.js';
import BankrollChart from './BankrollChart.jsx';
import BankrollOverviewTables from './BankrollOverviewTables.jsx';

/**
 * The bankroll dashboard's Overview tab (beta, app admins). The layout of a serious poker tracker,
 * in this app's own type and grid:
 *   - a hero: the balance now, and the profit over the chosen range, coloured by its sign
 *   - the graph, front and centre: cumulative profit (the "chip graph") as Total, Tournaments and
 *     Cash lines (any mix; pills toggle them, and Fill shades under them), or the balance, with
 *     a range picker under it (1M / 3M / YTD / 1Y / All)
 *   - the figures as collapsible Cash | Tournaments | Total tables (Summary, Sessions, Games, Rooms,
 *     Bankroll, By month / By year): BankrollOverviewTables.jsx, arithmetic in
 *     utils/bankroll-overview.js
 *   - the latest sessions, each led by its signed profit, with links to the full lists.
 * Everything comes from the combined ledger (GET /api/bankrolls/ledger, every source: tournaments,
 * cash sessions, expenses and income, deposits) plus the risk-of-ruin estimate (GET /risk).
 * The arithmetic is utils/bankroll-ledger.js (overviewStats, gameSeries, niceTicks, rangeWindow,
 * chartSpan), tested.
 *
 * Whose figures: the bankroll chip and its currency change one round trip before the ledger does,
 * and the previous ledger stays on screen meanwhile. So, as BankrollOverviewTables, every figure
 * here (hero, graph pills, gridlines, head note, latest sessions) is formatted in the currency of
 * the ledger IN HAND and named by its scope (ledgerScope), and the hero, graph and list dim with
 * aria-busy until the ledger is the one asked for — never the old numbers in the new currency.
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

export default function BankrollOverview({ d, risk, bk, bkKey, currency: asked, today, fmtDate, onClose }) {
  // The ledger in hand's bankroll and currency (they lag the chip by a round trip), and its money.
  const sc = ledgerScope(d, { key: bkKey, currency: asked, bankrolls: bk.bankrolls });
  const currency = sc.currency;
  const busy = sc.stale;
  const money = (v) => formatCurrencyAmount(Math.round(v || 0), currency);
  const signed = (v) => (v > 0 ? '+' : '') + formatCurrencyAmount(Math.round(v || 0), currency);
  const [range, setRangeState] = useState(() => store.get('bankrollRange', 'ytd', (v) => RANGE_KEYS.has(v)));
  const [mode, setModeState] = useState(() => store.get('bankrollChart', 'profit', (v) => v === 'profit' || v === 'balance'));
  // The graph's lines and fill, per device like the range and mode: 'total,tourn,cash' (known keys
  // only, never empty — parseSeriesPref) and '1' / '0'.
  const [shown, setShown] = useState(() => parseSeriesPref(store.get('bankrollSeries', null, (v) => v != null)));
  const [fill, setFillState] = useState(() => store.get('bankrollFill', '1', (v) => v === '1' || v === '0') === '1');
  const setRange = (v) => { setRangeState(v); store.set('bankrollRange', v); };
  const setMode = (v) => { setModeState(v); store.set('bankrollChart', v); };
  const toggleSeries = (k) => {
    const on = shown.includes(k);
    if (on && shown.length === 1) return; // one line always stays on
    const next = SERIES_KEYS.filter((x) => (x === k ? !on : shown.includes(x)));
    setShown(next);
    store.set('bankrollSeries', next.join(','));
  };
  const toggleFill = () => { const v = !fill; setFillState(v); store.set('bankrollFill', v ? '1' : '0'); };

  const entries = d.entries;
  const view = useMemo(() => {
    const w = rangeWindow(range, today);
    const win = within(entries, w);
    // The balance carried into the window: the last running total before it.
    let opening = d.opening.total_display;
    if (w.from) for (const e of entries) { if (e.date < w.from) opening = e.total_display; else break; }
    // The date axis: the window's days; All runs on to an entry dated after today (chartSpan).
    const { start, end } = chartSpan(w, win, today);
    const balPts = balanceSeries(win, { opening, from: w.from });
    // Total / Tournaments / Cash / other (expenses & income) on one date axis, from 0 at start.
    const rows = gameSeries(win, { from: start });
    return {
      w, win, start, end, rows, balPts,
      stats: overviewStats(win),
      recent: recentResults(win, 6),
    };
  }, [d, entries, range, today]);

  const s = view.stats;
  const noun = RANGE_NOUN[range];
  const rangeLabel = (RANGES.find((r) => r[0] === range) || [])[1];
  const open = (kind) => { if (bk.setSelected) bk.setSelected(bkKey); setResultsKind(kind); onClose(); };

  // The graph. Profit: the three lines, each ending at its column's Result in the Summary table
  // (Total = the hero's profit; Tournaments; Cash); expenses & income sit inside Total with no line
  // of their own, so the note says so whenever they move it. Balance: one line, deposits included.
  const cfg = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG.USD;
  const tick = (v) => compactMoney(v, cfg);
  const lastRow = view.rows[view.rows.length - 1];
  const has = { total: view.rows.length > 1, tourn: s.mtt.events > 0, cash: s.cash.sessions > 0 };
  const chartLines = mode === 'profit'
    ? SERIES.map(([key, label]) => ({ key, label, on: shown.includes(key), has: has[key], points: seriesLine(view.rows, key), end: lastRow[key] }))
    : [{ key: 'balance', label: 'Balance', on: true, has: view.balPts.length > 1, points: view.balPts, end: view.balPts[view.balPts.length - 1].value }];
  const chartNote = mode === 'balance' ? 'Balance, deposits and withdrawals included'
    : shown.includes('total') && lastRow.other !== 0 ? `Total includes expenses & income ${signed(lastRow.other)}`
      : 'Cumulative results';

  return (
    <>
      {/* Hero: the balance now | the range's profit. */}
      <div className={'bd-hero' + (busy ? ' is-busy' : '')} aria-busy={busy ? 'true' : undefined}>
        <div className="bd-hero-col">
          <div className="an-cell an-lbl an-lbl-2 an-clip">Balance</div>
          <div className={'an-cell bd-hero-val an-clip' + (d.closing.total_display < 0 ? ' an-neg' : '')}>{money(d.closing.total_display)}</div>
          <div className="an-cell an-note bd-note-3 an-clip">{currency} · {sc.key === 'all' ? 'every bankroll' : sc.name}</div>
        </div>
        <div className="bd-hero-col an-num">
          <div className="an-cell an-lbl an-lbl-2 an-clip">Profit · {rangeLabel}</div>
          <div className={'an-cell bd-hero-val an-clip' + tone(s.results)}>{signed(s.results)}</div>
          <div className="an-cell an-note bd-note-3 an-clip">
            {count(s.mtt.events)} {s.mtt.events === 1 ? 'event' : 'events'} · {count(s.cash.sessions)} cash {s.cash.sessions === 1 ? 'session' : 'sessions'}
          </div>
        </div>
      </div>

      <BankrollChart lines={chartLines} onToggle={mode === 'profit' ? toggleSeries : null} fill={fill} onFill={toggleFill}
        start={view.start} end={view.end} money={mode === 'profit' ? signed : money} tick={tick} fmtDate={fmtDate}
        zero={mode === 'profit'} what={mode === 'profit' ? 'Cumulative results' : 'Balance'} note={chartNote} busy={busy}
        control={<Segmented className="bd-mode" label="Graph" options={[['profit', 'Profit'], ['balance', 'Balance']]} value={mode} onChange={setMode} />} />
      <Segmented className="bd-range" label="Range" options={RANGES} value={range} onChange={setRange} />

      {view.win.length === 0 && <p className="an-p bd-after">Nothing in the ledger for {noun}.</p>}

      {/* The figures: collapsible Cash | Tournaments | Total tables (Summary, Sessions, Games, Rooms,
          Bankroll, By month / By year) — BankrollOverviewTables.jsx. */}
      <BankrollOverviewTables d={d} risk={risk} range={range} today={today} bk={bk} bkKey={bkKey}
        currency={asked} fmtDate={fmtDate} />

      <section className="bd-section" aria-labelledby="bd-recent">
        <h3 className="an-cell an-sec" id="bd-recent">Latest sessions</h3>
        {view.recent.length === 0 && <p className="an-p">No tournaments or cash sessions {noun}.</p>}
        {view.recent.length > 0 && (
          <ul className={'bd-recent' + (busy ? ' is-busy' : '')} aria-label="Latest sessions" aria-busy={busy ? 'true' : undefined}>
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

