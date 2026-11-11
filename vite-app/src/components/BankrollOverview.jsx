import React, { useEffect, useMemo, useState } from 'react';
import { MoneyParts } from './SwissParts.jsx';
import { API_URL } from '../utils/api.js';
import { normaliseHomes, fundView, fundPaceToday } from '../utils/money-homes.js';
import { BoneLine } from './SkeletonBankroll.jsx';
import { CURRENCY_CONFIG, formatCurrencyAmount } from '../utils/utils.js';
import {
  RANGES, RANGE_NOUN, rangeWindow, within, balanceSeries, chartSpan,
  overviewStats, recentResults, SERIES, SERIES_KEYS, gameSeries, seriesLine, parseSeriesPref, compactMoney,
} from '../utils/bankroll-ledger.js';
import { ledgerScope } from '../utils/bankroll-overview.js';
import { setResultsKind } from '../hooks/useLiveCashSession.js';
import BankrollChart from './BankrollChart.jsx';
import BankrollOverviewTables, { OverviewTablesFrame } from './BankrollOverviewTables.jsx';
import { SidePortal } from '../hooks/useBankrollSide.js';

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
  // Phase 10: the fund's target and pace, where the money sits, the drift (lib/money-homes.js).
  const [homes, setHomes] = useState(null);
  const [homesVersion, setHomesVersion] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/bankrolls/money/homes`, { headers: { Authorization: `Bearer ${bk.token}` } })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setHomes(normaliseHomes(j)); }).catch(() => { if (live) setHomes(null); });
    return () => { live = false; };
  }, [bk.token, d, homesVersion]);
  const saveLocations = async (locations) => {
    const r = await fetch(`${API_URL}/bankrolls/money/locations`, { method: 'PUT', headers: { Authorization: `Bearer ${bk.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ locations }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not save');
    setHomesVersion((v) => v + 1);
  };
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

  // The WSOP fund's own Overview (Bankroll design 14): the bankroll in hand is the one whose Role is the
  // fund. Its hero names the target, and its graph opens in Balance from its first entry, against the pace.
  const bRow = sc.key !== 'all' ? (bk.bankrolls || []).find((x) => String(x.id) === sc.key) : null;
  const fund = bRow && bRow.role === 'fund' && homes && homes.fund && String(homes.fund.bankrollId) === sc.key && homes.fund.target > 0 ? homes.fund : null;
  const [fundMode, setFundMode] = useState('balance');
  const gMode = fund ? fundMode : mode;
  const chartRange = fund && gMode === 'balance' ? 'all' : range;

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
  // The graph's own window: the range's, except the fund's Balance, which runs from its first entry.
  const gView = useMemo(() => {
    if (chartRange === range) return view;
    const w = rangeWindow(chartRange, today);
    const win = within(entries, w);
    const { start, end } = chartSpan(w, win, today);
    return { ...view, start, end, rows: gameSeries(win, { from: start }), balPts: balanceSeries(win, { opening: d.opening.total_display, from: w.from }) };
  }, [view, chartRange, range, entries, today, d]);
  // A young bankroll (Bankroll design 12): its first entry is later than the range's start, so the axis
  // starts there (with 1g of lead-in) instead of months of flat zero.
  const firstDay = entries.length ? entries[0].date : null;
  const young = !!(firstDay && chartRange !== 'all' && firstDay > gView.start && firstDay <= gView.end);
  const gStart = young ? firstDay : gView.start;

  const s = view.stats;
  const noun = RANGE_NOUN[range];
  const rangeLabel = (RANGES.find((r) => r[0] === range) || [])[1];
  const open = (kind) => { if (bk.setSelected) bk.setSelected(bkKey); setResultsKind(kind); onClose(); };

  // The graph. Profit: the three lines, each ending at its column's Result in the Summary table
  // (Total = the hero's profit; Tournaments; Cash); expenses & income sit inside Total with no line
  // of their own, so the note says so whenever they move it. Balance: one line, deposits included.
  const cfg = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG.USD;
  const tick = (v, step) => compactMoney(v, { ...cfg, step });
  const compact = (v) => compactMoney(v, cfg);
  const lastRow = gView.rows[gView.rows.length - 1];
  const has = { total: gView.rows.length > 1, tourn: s.mtt.events > 0, cash: s.cash.sessions > 0 };
  const balLine = { key: 'balance', label: 'Balance', on: true, has: gView.balPts.length > 1 || gView.balPts[0].value !== 0, points: gView.balPts, end: gView.balPts[gView.balPts.length - 1].value };
  // The fund's pace (Bankroll design 14): the server's own test drawn, from nothing on its first entry to
  // where the target says it should stand today (utils/money-homes fundPaceToday).
  const paceToday = fund ? fundPaceToday(fund, today) : null;
  const paceLine = fund && paceToday != null && fund.firstActivityDate
    ? { key: 'pace', label: 'Pace today', on: true, has: true, straight: true, fixed: true, points: [{ date: fund.firstActivityDate, value: 0 }, { date: today, value: paceToday }], end: paceToday }
    : null;
  const chartLines = gMode === 'profit'
    ? SERIES.map(([key, label]) => ({ key, label, on: shown.includes(key), has: has[key], points: seriesLine(gView.rows, key), end: lastRow[key] }))
    // A range with no entries still has a balance, the one carried in: it draws flat at that and the
    // pill shows it (the hero on the same screen does). Only an empty, zero bankroll says nothing.
    : [balLine, ...(paceLine ? [paceLine] : [])];
  const chartNote = fund && gMode === 'balance' ? 'Balance against the pace to the target'
    : gMode === 'balance' ? 'Balance, deposits and withdrawals included'
      : shown.includes('total') && lastRow.other !== 0 ? `Total includes expenses & income ${signed(lastRow.other)}`
        : 'Cumulative results';
  const usd = (x) => formatCurrencyAmount(Math.round(x || 0), 'USD');

  return (
    <>
      {/* Hero: the balance now | the range's profit. */}
      {/* The balance leads (Bankroll design 5): one figure at the top size; the range's profit a step down.
          On the fund's own page the second column is the target (Bankroll design 14). */}
      <div className={'bd-hero' + (busy ? ' is-busy' : '')} aria-busy={busy ? 'true' : undefined}>
        <div className="bd-hero-col">
          <div className="an-cell an-lbl an-lbl-2 an-clip">Balance</div>
          <div className={'an-cell bd-hero-val bd-hero-bal an-clip' + (d.closing.total_display < 0 ? ' an-neg' : '')}><MoneyParts text={money(d.closing.total_display)} /></div>
          <div className="an-cell an-note bd-note-3 an-clip">{currency} · {sc.key === 'all' ? 'every bankroll' : sc.name}</div>
        </div>
        {fund ? (
          <div className="bd-hero-col an-num">
            <div className="an-cell an-lbl an-lbl-2 an-clip">Target{fund.targetDate ? ' · ' + fmtDate(fund.targetDate) : ''}</div>
            <div className="an-cell bd-hero-val bd-hero-pl an-clip"><MoneyParts text={usd(fund.target)} /></div>
            <div className="an-cell an-note bd-note-3 an-clip">
              {fund.pace && fund.pace.left > 0
                ? `${usd(fund.pace.left)} to go${fund.pace.needPerMonth != null && fund.pace.monthsLeft > 0 ? ' · ' + usd(fund.pace.needPerMonth) + ' a month' : ''}`
                : 'The target is met'}
            </div>
          </div>
        ) : (
          <div className="bd-hero-col an-num">
            <div className="an-cell an-lbl an-lbl-2 an-clip">Profit · {rangeLabel}</div>
            <div className={'an-cell bd-hero-val bd-hero-pl an-clip' + tone(s.results)}><MoneyParts text={signed(s.results)} /></div>
            <div className="an-cell an-note bd-note-3 an-clip">
              {count(s.mtt.events)} {s.mtt.events === 1 ? 'event' : 'events'} · {count(s.cash.sessions)} cash {s.cash.sessions === 1 ? 'session' : 'sessions'}
            </div>
          </div>
        )}
      </div>

      {/* The WSOP fund as a goal you can see (UX pick 87): its bar, with a tick at the share of the time
          gone, at the top of the Overview, where it was three rows of text in a folded table. Not on the
          fund's own page, whose hero and graph say it (Bankroll design 14). */}
      {!fund && (() => {
        const f = homes && homes.fund && homes.fund.target > 0 ? homes.fund : null;
        if (!f) return null;
        const usdM = (x) => formatCurrencyAmount(Math.round(x || 0), 'USD');
        const v = fundView(f, usdM, fmtDate);
        const p = f.pace || {};
        const months = p.perMonthSoFar > 0 ? f.saved / p.perMonthSoFar : null;
        const gone = months != null && p.monthsLeft != null && months + p.monthsLeft > 0 ? months / (months + p.monthsLeft) : null;
        const pct = v.pct || 0;
        return (
          <section className="bd-fund" aria-label={v.label}>
            <div className="an-cell an-lbl an-lbl-3 an-clip">{[v.label, v.pace && v.pace.text !== '\u2014' ? v.pace.text : null, f.targetDate ? 'by ' + fmtDate(f.targetDate) : null].filter(Boolean).join(' \u00b7 ')}</div>
            <div className="an-cell an-td an-num bd-fund-fig an-clip">{v.text + (v.pct != null ? ' \u00b7 ' + v.pct + '%' : '')}</div>
            <div className="bd-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className={'bd-bar-fill' + (pct >= 100 ? ' is-done' : '')} style={{ width: pct + '%' }} />
              {gone != null && gone < 1 && <div className="bd-bar-pace" style={{ left: (gone * 100).toFixed(2) + '%' }} />}
            </div>
            {v.pace && <div className="an-cell an-note bd-note-3 an-clip">{v.pace.note.charAt(0).toUpperCase() + v.pace.note.slice(1)}</div>}
          </section>
        );
      })()}

      <BankrollChart lines={chartLines} onToggle={gMode === 'profit' ? toggleSeries : null} fill={fill} onFill={toggleFill}
        start={gStart} end={gView.end} lead={young} money={gMode === 'profit' ? signed : money} tick={tick} compact={compact} fmtDate={fmtDate}
        zero={gMode === 'profit'} what={gMode === 'profit' ? 'Cumulative results' : 'Balance'} note={chartNote} busy={busy}
        markPeaks={gMode === 'balance' && !fund} endDots={!!paceLine && gMode === 'balance'}
        control={<Segmented className="bd-mode" label="Graph" options={[['profit', 'Profit'], ['balance', 'Balance']]} value={gMode} onChange={fund ? setFundMode : setMode} />} />
      <Segmented className="bd-range" label="Range" options={RANGES} value={range} onChange={setRange} />

      {view.win.length === 0 && <p className="an-p bd-after">Nothing in the ledger for {noun}.</p>}

      {/* The figures: collapsible Cash | Tournaments | Total tables (Summary, Sessions, Games, Rooms,
          Bankroll, By month / By year) — BankrollOverviewTables.jsx. */}
      {/* On desktop the tables scroll beside the balance and the graph (Bankroll design 83). */}
      <SidePortal>
        <div className="bk-side-sec bd-side-tables">
          <BankrollOverviewTables d={d} risk={risk} range={range} today={today} bk={bk} bkKey={bkKey}
            currency={asked} fmtDate={fmtDate} homes={homes} onSaveLocations={saveLocations} />
        </div>
      </SidePortal>

      <section className="bd-section" aria-labelledby="bd-recent">
        <h3 className="an-cell an-sec" id="bd-recent">Latest sessions</h3>
        {view.recent.length === 0 && <p className="an-p">No tournaments or cash sessions {noun}.</p>}
        {view.recent.length > 0 && (
          <ul className={'bd-recent' + (busy ? ' is-busy' : '')} aria-label="Latest sessions" aria-busy={busy ? 'true' : undefined}>
            {view.recent.map((e) => (
              /* Read like the tables (Bankroll design 23): the name and what it was on the left, the amount and
                 its day on the right, every amount ending on the column's edge. */
              <li key={e.source + ':' + e.ref.id} className="bd-recent-row">
                <div className="bd-recent-l">
                  <span className="an-cell bd-recent-name an-clip" title={e.label}>{e.label.replace(/^Cash /, '')}</span>
                  <span className="an-cell an-note an-clip">
                    {e.source === 'cash-sessions'
                      ? `Cash${Number(e.hours) > 0 ? ' · ' + hrs(Number(e.hours)) : ''}`
                      : `Tournament${Number(e.units) > 1 ? ` · ${e.units} bullets` : ''}`}
                  </span>
                </div>
                <div className="bd-recent-r an-num">
                  <span className={'an-cell bd-recent-amt an-clip' + tone(e.amount_display)}>{signed(e.amount_display)}</span>
                  <span className="an-cell an-note an-clip">{fmtDate(e.date)}</span>
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


/**
 * The Overview while its ledger is on the way (Bankroll design 4): the page's frame at its loaded heights
 * (the hero 9r, the graph 26r under its head and pills, the range 4r, each section header 5r). Labels,
 * controls and section names are real; every figure not yet known is a quiet block on its text's r line,
 * never "$0". The heights come from the same rules as the loaded page, so nothing jumps when it lands.
 */
export function OverviewFrame({ today, fmtDate }) {
  const lines = SERIES.map(([key, label]) => ({ key, label, on: true, has: false, points: [], end: 0 }));
  const range = store.get('bankrollRange', 'ytd', (v) => RANGE_KEYS.has(v));
  const mode = store.get('bankrollChart', 'profit', (v) => v === 'profit' || v === 'balance');
  const none = () => {};
  return (
    <div className="bd-frame" role="status" aria-busy="true" aria-label="Loading the bankroll">
      <div className="bd-hero">
        <div className="bd-hero-col">
          <div className="an-cell an-lbl an-lbl-2">Balance</div>
          <BoneLine h={4} w={9} bh={2} />
          <BoneLine h={3} w={8} />
        </div>
        <div className="bd-hero-col">
          <div className="an-cell an-lbl an-lbl-2 an-num">Profit</div>
          <BoneLine h={4} w={9} bh={2} end />
          <BoneLine h={3} w={14} end />
        </div>
      </div>
      <BankrollChart loading lines={lines} start={today} end={today} money={() => ''} tick={() => ''} fmtDate={fmtDate}
        fill onFill={none} note={mode === 'balance' ? 'Balance, deposits and withdrawals included' : 'Cumulative results'}
        control={<Segmented className="bd-mode" label="Graph" options={[['profit', 'Profit'], ['balance', 'Balance']]} value={mode} onChange={none} />} />
      <Segmented className="bd-range" label="Range" options={RANGES} value={range} onChange={none} />
      <OverviewTablesFrame />
    </div>
  );
}
