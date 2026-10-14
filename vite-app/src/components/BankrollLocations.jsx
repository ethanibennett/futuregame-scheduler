import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CURRENCY_CONFIG, getToday } from '../utils/utils.js';
import { prepareFacts } from '../utils/bankroll-filters.js';
import { RANGES, RANGE_NOUN, rangeWindow } from '../utils/bankroll-ledger.js';
import {
  SORTS, NO_ROOM, FIRST_ROWS, buildLocations, sortLocations, locationsSummary, normaliseSort, compactMoney, statItems, bbItems, metaLine,
  resultWhat, fmtDay, rowsPage,
} from '../utils/bankroll-locations.js';
import TabStrip from './BankrollTabStrip.jsx';
import './analytics.css';
import './bankroll-locations.css';

/**
 * The bankroll dashboard's Locations tab — BETA, app admins (the dashboard is admin-only and
 * GET /api/bankrolls/reports is requireAppAdmin).
 *
 * One card per room, the way Poker Bankroll Tracker lists its locations, in this app's own type,
 * tokens and grid: the room's name, "Live • USD" (live or online, and the currency it was played
 * in), the total result at the right, a hairline, then one line of stats — entries, cash hours,
 * per hour, ROI, won % — with a mark for which kinds of game the room has. Tap a card for its
 * results, newest first. A room with cash sessions that name their big blind gets a second stats line:
 * bb/hr, and BB/hr for limit games (utils/bb-hr.js; docs/bankrolls.md "bb/hr"). Sorted by result,
 * entries, hours or name; the range and the sort are remembered per device.
 *
 * Data: GET /api/bankrolls/reports for the dashboard's bankroll and display currency — the same
 * facts as the Reports tab, so a room here is a row of its Room report. Tournament results and
 * ended cash sessions only: expenses and income are not sessions (utils/bankroll-locations.js).
 *
 * Layout (35g content; bankroll-locations.css lists every row): the range strip 4r; the summary;
 * the sort strip 4r; the cards, 35g x 11r with 1r between, opening to 4r result rows (ten, then
 * fifty more a tap) — and an open card's name wraps, so a long one is read whole.
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
function Clock() {
  return (
    <svg className="bl-clock" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <circle cx="6" cy="6" r="5" /><path d="M6 3.2V6l1.9 1.3" />
    </svg>
  );
}

function LocationCard({ loc, cur, open, onToggle }) {
  const id = 'bl-res-' + (loc.key || 'none').replace(/[^\w-]+/g, '-');
  const items = statItems(loc, cur);
  // bb/hr (BB/hr for limit): a second stats line, only for a room with a cash session that has a readable big blind.
  const bbs = bbItems(loc);
  // Ten rows, then fifty more a tap (the last tap "Show all N"); closing the card starts it over.
  const [shown, setShown] = useState(FIRST_ROWS);
  useEffect(() => { if (!open) setShown(FIRST_ROWS); }, [open]);
  const pg = rowsPage(shown, loc.results.length);
  const rows = loc.results.slice(0, pg.rows);
  // After a page button: keep the keyboard on a button that is still there, and after Show fewer
  // bring the card back into view (the rows it hid may have held the whole screen).
  const itemRef = useRef(null), moreRef = useRef(null), fewerRef = useRef(null);
  const after = useRef(null);
  useLayoutEffect(() => {
    const a = after.current;
    after.current = null;
    if (!a) return;
    if (a.what === 'fewer' && itemRef.current) itemRef.current.scrollIntoView({ block: 'nearest' });
    if (!a.focused || document.activeElement === a.from) return;   // still there, or never focused
    const to = (a.what === 'more' ? moreRef.current || fewerRef.current : moreRef.current);
    if (to) to.focus({ preventScroll: true });
  }, [shown]);
  const note = (what, e) => { after.current = { what, from: e.currentTarget, focused: document.activeElement === e.currentTarget }; };
  const more = (e) => { note('more', e); setShown(pg.more.next); };
  const fewer = (e) => { note('fewer', e); setShown(FIRST_ROWS); };
  return (
    <li ref={itemRef} className={'bl-item' + (open ? ' is-open' : '')}>
      <button type="button" className={'bl-card' + (bbs.length ? ' has-bb' : '')} aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
        <span className="bl-head">
          <span className={'an-cell bl-name an-clip' + (loc.key === NO_ROOM ? ' is-none' : '')} title={loc.label}>{loc.label}</span>
          <span className="an-cell bl-meta an-clip">{metaLine(loc)}<TypeMark kinds={loc.kinds} /></span>
          <span className={'an-cell bl-total snap-g' + tone(Math.round(loc.total))}>{compactMoney(loc.total, cur, { sign: true })}</span>
        </span>
        <span className="an-cell bl-stats an-clip">
          {items.map((it, i) => (
            <React.Fragment key={it.key}>
              {i > 0 && <span className="bl-sep" aria-hidden="true">{' • '}</span>}
              <span className={'bl-stat' + toneOf(it.tone)}>
                {it.icon === 'clock' ? <><Clock />{it.text} h</> : it.text}
              </span>
            </React.Fragment>
          ))}
        </span>
        {bbs.length > 0 && (
          <span className="an-cell bl-stats bl-stats-bb an-clip">
            {bbs.map((it, i) => (
              <React.Fragment key={it.key}>
                {i > 0 && <span className="bl-sep" aria-hidden="true">{' • '}</span>}
                <span className={'bl-stat' + toneOf(it.tone)} aria-label={it.label}>{it.text}</span>
              </React.Fragment>
            ))}
          </span>
        )}
      </button>
      {open && (
        <div className="bl-detail" id={id}>
          <ul className="bl-results" aria-label={`Results at ${loc.label}, newest first`}>
            {rows.map((f) => (
              <li key={f.id} className="bl-res">
                <span className="an-cell bl-res-date an-clip">{fmtDay(f.date)}</span>
                <span className="an-cell an-td bl-res-what an-clip" title={resultWhat(f)}>
                  <Dot kind={f.kind === 'cash' ? 'cash' : 'tourn'} />{resultWhat(f)}
                </span>
                <span className={'an-cell an-td an-num bl-res-amt an-clip' + tone(Math.round(f.profit))}>{compactMoney(f.profit, cur, { sign: true })}</span>
              </li>
            ))}
          </ul>
          {(pg.more || pg.fewer) && (
            <div className="bl-pager">
              {pg.more && (
                <button ref={moreRef} type="button" className="bk-btn bl-more" onClick={more}><span>{pg.more.label}</span></button>
              )}
              {pg.fewer && (
                <button ref={fewerRef} type="button" className="bk-btn bl-more bl-fewer" onClick={fewer}><span>Show fewer</span></button>
              )}
              {pg.count && <span className="an-cell bl-count" aria-live="polite">{pg.count}</span>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function BankrollLocations({ bk, bankrollKey, currency }) {
  const today = getToday();
  const [prefs, setPrefs] = useState(load);
  const [state, setState] = useState({ status: 'loading', facts: [] });
  const [open, setOpen] = useState(() => new Set());
  useEffect(() => { save(prefs); }, [prefs]);

  useEffect(() => {
    let live = true;
    setState((s) => ({ status: 'loading', facts: s.facts }));
    const q = `bankroll=${encodeURIComponent(String(bankrollKey))}&currency=${encodeURIComponent(currency)}`;
    bk.call('GET', `/reports?${q}`)
      .then((d) => { if (live) setState({ status: 'ready', facts: prepareFacts(d.facts || []) }); })
      .catch(() => { if (live) setState({ status: 'error', facts: [] }); });
    return () => { live = false; };
  }, [bankrollKey, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG.USD;
  const win = rangeWindow(prefs.range, today);
  const list = useMemo(() => sortLocations(buildLocations(state.facts, win), prefs.sort),
    [state.facts, win.from, win.to, prefs.sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = locationsSummary(list);
  const flip = (set, setter, key) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  const ready = state.status === 'ready' || (state.status === 'loading' && state.facts.length > 0);
  return (
    <section className="bd-section bl-locations" aria-labelledby="bl-title">
      <h3 className="an-cell an-sec" id="bl-title">Locations</h3>
      <TabStrip className="bl-range" label="Range" options={RANGES} value={prefs.range}
        onChange={(range) => setPrefs((p) => ({ ...p, range }))} btnClass="bd-seg-btn" />

      {state.status === 'error' && <p className="an-p bl-gap">The locations could not load. Close the dashboard and try again.</p>}
      {state.status === 'loading' && !state.facts.length && <p className="an-p bl-gap">Loading…</p>}
      {ready && list.length === 0 && (
        <p className="an-p bl-gap">
          <strong>{state.facts.some((f) => f.kind === 'tournament' || f.kind === 'cash') ? 'Nothing played in this range.' : 'Nothing played yet.'}</strong>
          {' '}Rooms come from tournament results and finished cash sessions{prefs.range !== 'all' ? '; try a longer range' : ''}.
          {' '}Expenses aren't included.
        </p>
      )}
      {ready && list.length > 0 && (
        <>
          <p className="an-p bl-gap">
            <strong>{sum.rooms.toLocaleString()} {sum.rooms === 1 ? 'room' : 'rooms'}</strong>
            {' · '}{sum.entries.toLocaleString()} {sum.entries === 1 ? 'entry' : 'entries'}
            {' · '}<span className={'bl-sum' + tone(Math.round(sum.total))}>{compactMoney(sum.total, cur, { sign: true })}</span>
            {' · '}{RANGE_NOUN[prefs.range] || 'all time'}
          </p>
          <div className="an-cell an-lbl an-lbl-3b" aria-hidden="true">Sort by</div>
          <TabStrip className="bl-sort" label="Sort the rooms by" options={SORTS} value={prefs.sort}
            onChange={(sort) => setPrefs((p) => ({ ...p, sort }))} btnClass="bd-seg-btn" />
          <ul className="bl-list">
            {list.map((loc) => (
              <LocationCard key={loc.key || '-'} loc={loc} cur={cur} open={open.has(loc.key)}
                onToggle={() => flip(open, setOpen, loc.key)} />
            ))}
          </ul>
          <p className="an-p bl-note">
            <Dot kind="tourn" /> Tournaments <Dot kind="cash" /> Cash. Expenses aren't included.
          </p>
        </>
      )}
    </section>
  );
}
