import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CURRENCY_CONFIG, getToday } from '../utils/utils.js';
import { prepareFacts } from '../utils/bankroll-filters.js';
import { RANGES, RANGE_NOUN, rangeWindow } from '../utils/bankroll-ledger.js';
import {
  SORTS, NO_ROOM, FIRST_ROWS, buildLocations, sortLocations, locationsSummary, normaliseSort, compactMoney, metaLine,
  resultWhat, rowsPage, statCells, resultScale, runningResult, monthGroups, fmtWeekday, SMALL_SAMPLE,
} from '../utils/bankroll-locations.js';
import { roomStrip } from './ResultCardParts.jsx';
import { getVenueBrandColor, getStripAbbr } from '../utils/utils.js';
import { LoadFailed, FirstRun } from './EmptyState.jsx';
import { SkeletonBlocks } from './SkeletonBankroll.jsx';
import TabStrip from './BankrollTabStrip.jsx';
import './analytics.css';
import './bankroll-locations.css';

/**
 * The bankroll dashboard's Locations tab — BETA, app admins (the dashboard is admin-only and
 * GET /api/bankrolls/reports is requireAppAdmin).
 *
 * One card per room, in this app's own type, tokens and grid (Bankroll design 61-69, 71):
 *   - the room's strip down the card's left edge, its code as the Schedule wears it (62);
 *   - the name, "Live • USD" with the kind dots, a sparkline of the room's running result (64), the total;
 *   - the card's hairline carries the room's result on one scale for the list in view (63);
 *   - the stats as six labelled columns, every card one height (61); under five entries the rates lose
 *     their colour, Won/ITM becomes a count and the card says "Small sample" (65).
 * Tap a card for its results, newest first, broken by month with each month's net (66); while it is open its
 * head stays at the top of the scroller with how much of the list has loaded (67). The range and the sort
 * share one set of column edges (68).
 * On a desktop pane wide enough the rooms are one ranking table whose column heads sort (69), and the
 * selected room opens in a pane beside it while the ranking stays whole (71); a pane too narrow for both
 * falls back to the table alone, and the room opens in place.
 *
 * Data: GET /api/bankrolls/reports for the dashboard's bankroll and display currency — the same facts as the
 * Reports tab. Tournament results and ended cash sessions only (utils/bankroll-locations.js).
 */

const STORE = 'bankrollLocations';
const RANGE_KEYS = new Set(RANGES.map((r) => r[0]));
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null') || {};
    return { sort: normaliseSort(v.sort), range: RANGE_KEYS.has(v.range) ? v.range : 'all' };
  } catch (_) { return { sort: 'result', range: 'all' }; }
}
function save(v) {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (_) { /* private mode: not remembered */ }
}
const tone = (v) => (v > 0 ? ' an-pos' : v < 0 ? ' an-neg' : '');
const toneOf = (t) => (t > 0 ? ' an-pos' : t < 0 ? ' an-neg' : '');

/** A type dot: tournaments in the tournament series colour, cash in the cash one. */
function Dot({ kind }) {
  return (
    <svg className={'bl-dot is-' + kind} viewBox="0 0 10 10" aria-hidden="true" focusable="false"><circle cx="5" cy="5" r="3.5" /></svg>
  );
}
function TypeMark({ kinds }) {
  const label = kinds.tournament && kinds.cash ? 'Tournaments and cash' : kinds.cash ? 'Cash' : 'Tournaments';
  return (
    <span className="bl-mark" role="img" aria-label={label}>
      {kinds.tournament && <Dot kind="tourn" />}
      {kinds.cash && <Dot kind="cash" />}
    </span>
  );
}

/** The room's strip (Bankroll design 62): its Schedule colour and code down the card's left edge. */
function RoomStrip({ loc }) {
  const { abbr } = loc.key === NO_ROOM ? { abbr: null } : roomStrip(loc.label);
  return (
    <span className={'bl-strip' + (abbr ? '' : ' is-neutral')} aria-hidden="true"
      style={abbr ? { background: getVenueBrandColor(abbr) } : undefined}>
      <span className="bl-strip-code">{abbr ? getStripAbbr(abbr) : ''}</span>
    </span>
  );
}

/** The running result, entry by entry (Bankroll design 64): a 7g x 3r line, coloured by where it ends. */
function Sparkline({ loc, w = 7, h = 3 }) {
  const pts = runningResult(loc);
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts);
  const span = hi - lo || 1;
  const X = w * 10, Y = h * 10;
  const xy = pts.map((v, i) => [pts.length > 1 ? (i / (pts.length - 1)) * X : X / 2, Y - ((v - lo) / span) * Y]);
  const end = pts[pts.length - 1];
  const cls = end > 0 ? 'is-pos' : end < 0 ? 'is-neg' : 'is-flat';
  const zy = Y - ((0 - lo) / span) * Y;
  return (
    <span className={'bl-spark ' + cls} aria-hidden="true">
      <svg viewBox={`0 0 ${X} ${Y}`} preserveAspectRatio="none">
        <line x1="0" y1={zy} x2={X} y2={zy} className="bl-spark-zero" vectorEffect="non-scaling-stroke" />
        {pts.length > 3 && <polyline points={xy.map((p) => p.map((n) => n.toFixed(2)).join(',')).join(' ')} vectorEffect="non-scaling-stroke" />}
      </svg>
      {(pts.length <= 3 ? xy.slice(1) : xy.slice(-1)).map(([x, y], i) => (
        <i key={i} className="bl-spark-dot" style={{ left: `calc(var(--gu) * ${(x / 10).toFixed(3)})`, top: `calc(var(--subrow) * ${(y / 10).toFixed(3)})` }} />
      ))}
    </span>
  );
}

/** The six labelled columns (Bankroll design 61). */
function StatGrid({ cells }) {
  return (
    <span className="bl-grid" role="list">
      {cells.map((c) => (
        <span key={c.key} className="bl-gcell" role="listitem" aria-label={`${c.label} ${c.text}`}>
          <span className="an-cell an-lbl an-lbl-2 an-num an-clip">{c.label}</span>
          <span className={'an-cell an-num an-clip bl-gval' + (c.dash ? ' is-dash' : toneOf(c.tone))}>{c.text}</span>
        </span>
      ))}
    </span>
  );
}

/** A room's results, by month (Bankroll design 66). */
function MonthRows({ loc, rows, cur }) {
  const groups = monthGroups(rows, loc.results);
  return (
    <ul className="bl-results" aria-label={`Results at ${loc.label}, newest first`}>
      {groups.map((g) => (
        <React.Fragment key={g.key}>
          <li className="bl-month" aria-label={`${g.label}, ${g.count} ${g.count === 1 ? 'entry' : 'entries'}`}>
            <span className="an-cell an-lbl an-lbl-3b an-clip bl-month-name">{g.label}<span className="bl-month-n"> · {g.count} {g.count === 1 ? 'entry' : 'entries'}</span></span>
            <span className={'an-cell an-lbl an-lbl-3b an-num bl-month-net' + tone(Math.round(g.net))}>{compactMoney(g.net, cur, { sign: true })}</span>
          </li>
          {g.rows.map((f) => (
            <li key={f.id} className="bl-res">
              <span className="an-cell bl-res-date an-clip">{fmtWeekday(f.date)}</span>
              <span className="an-cell an-td bl-res-what an-clip" title={resultWhat(f)}>
                <Dot kind={f.kind === 'cash' ? 'cash' : 'tourn'} />{resultWhat(f)}
              </span>
              <span className={'an-cell an-td an-num bl-res-amt an-clip' + tone(Math.round(f.profit))}>{compactMoney(f.profit, cur, { sign: true })}</span>
            </li>
          ))}
        </React.Fragment>
      ))}
    </ul>
  );
}

/** Ten rows, then fifty more a tap; closing starts it over. Keeps the keyboard on a button still there. */
function usePager(open, total, itemRef) {
  const [shown, setShown] = useState(FIRST_ROWS);
  useEffect(() => { if (!open) setShown(FIRST_ROWS); }, [open]);
  const pg = rowsPage(shown, total);
  const moreRef = useRef(null), fewerRef = useRef(null);
  const after = useRef(null);
  useLayoutEffect(() => {
    const a = after.current;
    after.current = null;
    if (!a) return;
    if (a.what === 'fewer' && itemRef.current) itemRef.current.scrollIntoView({ block: 'nearest' });
    if (!a.focused || document.activeElement === a.from) return;
    const to = (a.what === 'more' ? moreRef.current || fewerRef.current : moreRef.current);
    if (to) to.focus({ preventScroll: true });
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const note = (what, e) => { after.current = { what, from: e.currentTarget, focused: document.activeElement === e.currentTarget }; };
  return {
    pg, moreRef, fewerRef,
    more: (e) => { note('more', e); setShown(pg.more.next); },
    fewer: (e) => { note('fewer', e); setShown(FIRST_ROWS); },
  };
}
function Pager({ p }) {
  const { pg } = p;
  if (!pg.more && !pg.fewer) return null;
  return (
    <div className="bl-pager">
      {pg.more && <button ref={p.moreRef} type="button" className="bk-btn bl-more" onClick={p.more}><span>{pg.more.label}</span></button>}
      {pg.fewer && <button ref={p.fewerRef} type="button" className="bk-btn bl-more bl-fewer" onClick={p.fewer}><span>Show fewer</span></button>}
      {pg.count && <span className="an-cell bl-count" aria-live="polite">{pg.count}</span>}
    </div>
  );
}

function LocationCard({ loc, cur, open, onToggle, scale }) {
  const id = 'bl-res-' + (loc.key || 'none').replace(/[^\w-]+/g, '-');
  const cells = statCells(loc, cur);
  const small = loc.entries < SMALL_SAMPLE;
  const itemRef = useRef(null);
  const p = usePager(open, loc.results.length, itemRef);
  const rows = loc.results.slice(0, p.pg.rows);
  const rule = scale.at(loc.total);
  // Stuck (Bankroll design 67): a sentinel above the open card's head says when the head has reached the top.
  const sentRef = useRef(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!open || !sentRef.current || typeof IntersectionObserver === 'undefined') { setStuck(false); return undefined; }
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds ? e.rootBounds.top + 1 : 1)), { threshold: 0 });
    io.observe(sentRef.current);
    return () => io.disconnect();
  }, [open]);
  const loaded = Math.min(rows.length, loc.results.length);
  return (
    <li ref={itemRef} className={'bl-item has-strip' + (open ? ' is-open' : '') + (stuck ? ' is-stuck' : '')}>
      {open && <span ref={sentRef} className="bl-sentinel" aria-hidden="true" />}
      <RoomStrip loc={loc} />
      <button type="button" className="bl-card" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
        <span className="bl-head has-spark">
          <span className={'an-cell bl-name an-clip' + (loc.key === NO_ROOM ? ' is-none' : '')} title={loc.label}>{loc.label}</span>
          <span className="an-cell bl-meta an-clip">
            {metaLine(loc)}<TypeMark kinds={loc.kinds} />
            {small && <span className="bl-small"> · Small sample</span>}
            {open && loc.results.length > FIRST_ROWS && <span> · {loaded} of {loc.results.length} shown</span>}
          </span>
          <Sparkline loc={loc} />
          <span className={'an-cell bl-total' + tone(Math.round(loc.total))}>{compactMoney(loc.total, cur, { sign: true })}</span>
        </span>
        {/* The result on one scale (Bankroll design 63): over the hairline, from the zero tick. */}
        <span className="bl-rule" aria-hidden="true">
          <i className="bl-rule-zero" style={{ left: `${(scale.zero * 100).toFixed(2)}%` }} />
          {loc.total !== 0 && <i className={'bl-rule-bar' + (loc.total < 0 ? ' is-neg' : '')} style={{ left: `${(rule.from * 100).toFixed(2)}%`, width: `${((rule.to - rule.from) * 100).toFixed(2)}%` }} />}
        </span>
        <StatGrid cells={cells} />
        {open && loc.results.length > FIRST_ROWS && (
          <span className="bl-progress" aria-hidden="true"><i style={{ width: `${((loaded / loc.results.length) * 100).toFixed(2)}%` }} /></span>
        )}
      </button>
      {open && (
        <div className="bl-detail" id={id}>
          <MonthRows loc={loc} rows={rows} cur={cur} />
          <Pager p={p} />
        </div>
      )}
    </li>
  );
}

/** The selected room in the pane beside the ranking (Bankroll design 71). */
function RoomPane({ loc, cur, onClose }) {
  const itemRef = useRef(null);
  const p = usePager(true, loc.results.length, itemRef);
  const rows = loc.results.slice(0, p.pg.rows);
  const pts = runningResult(loc);
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), span = hi - lo || 1;
  const X = 350, Y = 160;
  const xy = pts.map((v, i) => [pts.length > 1 ? (i / (pts.length - 1)) * X : X / 2, Y - ((v - lo) / span) * Y]);
  const zy = Y - ((0 - lo) / span) * Y;
  const line = xy.map((q) => q.map((n) => n.toFixed(2)).join(',')).join(' ');
  const first = loc.results.length ? loc.results[loc.results.length - 1].date : '';
  const last = loc.results.length ? loc.results[0].date : '';
  return (
    <aside className="bl-pane" ref={itemRef} aria-label={`${loc.label}, all its results`}>
      <div className="bl-pane-head">
        <h4 className="an-cell bl-pane-name an-clip">{loc.label}</h4>
        <button type="button" className="bk-btn bk-w6 bl-pane-close" onClick={onClose}><span>Close</span></button>
      </div>
      <div className="an-cell an-note an-clip">{metaLine(loc)} · {loc.entries.toLocaleString('en-US')} {loc.entries === 1 ? 'entry' : 'entries'}</div>
      <div className="an-cell an-lbl an-lbl-2 bl-pane-lbl">Result · all time</div>
      <div className={'an-cell bl-pane-total' + tone(Math.round(loc.total))}>{compactMoney(loc.total, cur, { sign: true })}</div>
      <div className={'bl-pane-chart' + (pts[pts.length - 1] < 0 ? ' is-neg' : '')} aria-hidden="true">
        <svg viewBox={`0 0 ${X} ${Y}`} preserveAspectRatio="none">
          {pts.length > 1 && <path d={`M${line.replace(/ /g, ' L')} L${X},${zy.toFixed(2)} L0,${zy.toFixed(2)} Z`} className="bl-pane-area" />}
          <line x1="0" y1={zy} x2={X} y2={zy} className="bl-pane-zero" vectorEffect="non-scaling-stroke" />
          {pts.length > 1 && <polyline points={line} className="bl-pane-line" vectorEffect="non-scaling-stroke" />}
        </svg>
      </div>
      <div className="bl-pane-dates"><span className="an-cell an-note">{first}</span><span className="an-cell an-note an-num">{last}</span></div>
      <StatGrid cells={statCells(loc, cur)} />
      <h5 className="an-cell an-sec bl-pane-sec">Results</h5>
      <MonthRows loc={loc} rows={rows} cur={cur} />
      <Pager p={p} />
    </aside>
  );
}

const COLS = [
  ['rank', '#', null], ['name', 'Room', 'name'], ['entries', 'Entries', 'entries'], ['hours', 'Hours', 'hours'],
  ['hourly', '$/hour', null], ['roi', 'ROI', null], ['won', 'Won/ITM', null], ['bb', 'bb/hr', null], ['result', 'Result', 'result'],
];
/** Desktop: the rooms as one ranking table (Bankroll design 69). The column heads sort; the sorted one says so. */
function RankTable({ list, cur, sort, onSort, selected, onSelect, renderOpen }) {
  return (
    <div className="bl-table" role="table" aria-label="Rooms, ranked">
      <div className="bl-trow is-head" role="row">
        {COLS.map(([k, label, key]) => (
          key ? (
            <span key={k} role="columnheader" tabIndex={0} aria-sort={sort === key ? (key === 'name' ? 'ascending' : 'descending') : 'none'}
              className={'an-cell an-lbl an-lbl-3b bl-th' + (k === 'name' ? '' : ' an-num') + (sort === key ? ' is-on' : '')} onClick={() => onSort(key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(key); } }}>
              {label}{sort === key ? (key === 'name' ? ' ▴' : ' ▾') : ''}
            </span>
          ) : <span key={k} role="columnheader" className={'an-cell an-lbl an-lbl-3b' + (k === 'rank' ? '' : ' an-num')}>{label}</span>
        ))}
      </div>
      {list.map((loc, i) => {
        const cells = statCells(loc, cur);
        const on = selected === loc.key;
        return (
          <React.Fragment key={loc.key || '-'}>
            <div role="row" tabIndex={0} aria-selected={on} className={'bl-trow' + (on ? ' is-on' : '')}
              onClick={() => onSelect(loc.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(loc.key); } }}>
              <span role="cell" className="an-cell an-td bl-rank">{i + 1}</span>
              <span role="cell" className={'an-cell an-td an-clip bl-tname' + (loc.key === NO_ROOM ? ' is-none' : '')} title={loc.label}>{loc.label}<TypeMark kinds={loc.kinds} /></span>
              {cells.map((c) => <span key={c.key} role="cell" className={'an-cell an-td an-num an-clip' + (c.dash ? ' is-dash' : toneOf(c.tone))}>{c.text}</span>)}
              <span role="cell" className={'an-cell an-td an-num an-clip bl-tres' + tone(Math.round(loc.total))}>{compactMoney(loc.total, cur, { sign: true })}</span>
            </div>
            {on && renderOpen && <div className="bl-trow-open">{renderOpen(loc)}</div>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/** The width the Bankroll pane leaves on desktop, in g: the table needs 62g, the table and a room 101g. */
export function usePaneWidth(ref) {
  const [g, setG] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el && (el.closest('.dk-pane-wide') || el.closest('.tab-panel'));
    if (!host || !el.closest('.app-shell.is-desktop')) { setG(0); return undefined; }
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:calc(var(--gu) * 100)';
    el.appendChild(probe);
    const gu = probe.getBoundingClientRect().width / 100;
    probe.remove();
    const measure = () => {
      const left = el.getBoundingClientRect().left - host.getBoundingClientRect().left;
      setG(gu > 0 ? Math.floor((host.clientWidth - left) / gu) : 0);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [ref]);
  return g;
}

export default function BankrollLocations({ bk, bankrollKey, currency }) {
  const today = getToday();
  const [prefs, setPrefs] = useState(load);
  const [state, setState] = useState({ status: 'loading', facts: [] });
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(() => new Set());
  const [selected, setSelected] = useState(null);
  useEffect(() => { save(prefs); }, [prefs]);
  const secRef = useRef(null);
  const paneG = usePaneWidth(secRef);
  const wide = paneG >= 62;            // the ranking table (69)
  const twoPane = paneG >= 101;        // and the selected room beside it (71)

  useEffect(() => {
    let live = true;
    setState((s) => ({ status: 'loading', facts: s.facts }));
    const q = `bankroll=${encodeURIComponent(String(bankrollKey))}&currency=${encodeURIComponent(currency)}`;
    bk.call('GET', `/reports?${q}`)
      .then((d) => { if (live) setState({ status: 'ready', facts: prepareFacts(d.facts || []) }); })
      .catch(() => { if (live) setState((s) => ({ status: 'error', facts: s.facts })); });
    return () => { live = false; };
  }, [bankrollKey, currency, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG.USD;
  const win = rangeWindow(prefs.range, today);
  const list = useMemo(() => sortLocations(buildLocations(state.facts, win), prefs.sort),
    [state.facts, win.from, win.to, prefs.sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = locationsSummary(list);
  const scale = useMemo(() => resultScale(list), [list]);
  const flip = (key) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key); else next.add(key);
    setOpen(next);
  };
  const sel = selected != null ? list.find((l) => l.key === selected) : null;

  const ready = state.status === 'ready' || (state.status === 'loading' && state.facts.length > 0);
  return (
    <section ref={secRef} className={'bd-section bl-locations' + (wide ? ' is-wide' : '') + (twoPane && sel ? ' has-pane' : '')} aria-labelledby="bl-title">
      <div className="bl-main">
        <h3 className="an-cell an-sec" id="bl-title">Locations</h3>
        {/* The range and the sort share one set of column edges (Bankroll design 68): the range's five 7g
            buttons, then "Sort by" in 7g and the sort's four 7g buttons, its dividers on the range's. On the
            desktop table the column heads sort, so the range stands alone. */}
        <TabStrip className="bl-range" label="Range" options={RANGES} value={prefs.range}
          onChange={(range) => setPrefs((p) => ({ ...p, range }))} btnClass="bd-seg-btn" />
        {!wide && ready && list.length > 0 && (
          <div className="bl-sortrow">
            <span className="an-cell an-lbl an-lbl-3b bl-sortlbl" aria-hidden="true">Sort by</span>
            <TabStrip className="bl-sort" label="Sort the rooms by" options={SORTS} value={prefs.sort}
              onChange={(sort) => setPrefs((p) => ({ ...p, sort }))} btnClass="bd-seg-btn" />
          </div>
        )}

        {state.status === 'error' && !state.facts.length && <div className="bl-gap"><LoadFailed title="Your rooms did not load" onRetry={() => setRetry((n) => n + 1)} /></div>}
        {state.status === 'error' && state.facts.length > 0 && <LoadFailed inline title="Your rooms did not refresh" onRetry={() => setRetry((n) => n + 1)} />}
        {state.status === 'loading' && !state.facts.length && (
          <div className="bl-gap"><SkeletonBlocks label="Loading your rooms" blocks={[0, 1, 2, 3].map(() => ({ h: 12, card: true, bars: [[14, 1], [8, 1], [30, 2]] }))} /></div>
        )}
        {ready && list.length === 0 && (
          <div className="bl-gap">
            <FirstRun block icon="mapPin"
              title={state.facts.some((f) => f.kind === 'tournament' || f.kind === 'cash') ? 'Nothing played in this range' : 'No rooms yet'}
              body={`Rooms come from tournament results and finished cash sessions${prefs.range !== 'all' ? '; try a longer range' : ''}. Expenses aren't included.`} />
          </div>
        )}
        {ready && list.length > 0 && (
          <>
            <p className="an-p bl-gap">
              <strong>{sum.rooms.toLocaleString()} {sum.rooms === 1 ? 'room' : 'rooms'}</strong>
              {' · '}{sum.entries.toLocaleString()} {sum.entries === 1 ? 'entry' : 'entries'}
              {' · '}<span className={'bl-sum' + tone(Math.round(sum.total))}>{compactMoney(sum.total, cur, { sign: true })}</span>
              {' · '}{RANGE_NOUN[prefs.range] || 'all time'}
            </p>
            {wide ? (
              <RankTable list={list} cur={cur} sort={prefs.sort} onSort={(sort) => setPrefs((p) => ({ ...p, sort }))}
                selected={selected} onSelect={(k) => setSelected(selected === k ? null : k)}
                renderOpen={twoPane ? null : (loc) => <RoomPane loc={loc} cur={cur} onClose={() => setSelected(null)} />} />
            ) : (
              <ul className="bl-list">
                {list.map((loc) => (
                  <LocationCard key={loc.key || '-'} loc={loc} cur={cur} open={open.has(loc.key)} onToggle={() => flip(loc.key)} scale={scale} />
                ))}
              </ul>
            )}
            <p className="an-p bl-note">
              <Dot kind="tourn" /> Tournaments <Dot kind="cash" /> Cash. The bar under each room is its result on one scale
              for the rooms shown. Expenses aren't included.
            </p>
          </>
        )}
      </div>
      {twoPane && sel && <RoomPane key={sel.key || '-'} loc={sel} cur={cur} onClose={() => setSelected(null)} />}
    </section>
  );
}
