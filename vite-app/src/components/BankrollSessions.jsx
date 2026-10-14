import React, { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { CURRENCY_CONFIG, VENUE_MAP, nativeCurrency, formatCurrencyAmount, MINUS } from '../utils/utils.js';
import { getSite } from '../utils/online-sites.js';
import { bankrollQuery } from '../utils/bankrolls.js';
import {
  CHUNK, SESSION_TYPES, buildSessions, filterSessions, groupByYear, countLabel, compactMoney, finishLabel,
  tournamentFigures, cashFigures,
} from '../utils/bankroll-sessions.js';
import { formatHours, swingSeries, swingSummary, chartPath } from '../utils/cash-sessions.js';
import { fmtBbHr, bbTone } from '../utils/bb-hr.js';
import { openInResults } from '../hooks/useResultsFocus.js';
import './bankroll-sessions.css';

/**
 * The bankroll dashboard's Sessions tab (beta, app admins): every tournament result and every
 * finished cash session of the selected bankroll in one list, newest first, under a centred pill
 * per year — the session list of a dedicated bankroll tracker, in this app's type, tokens and grid.
 *
 *   bar      All | Tournaments | Cash (one-select, remembered per device) and the count
 *   list     year pill; rows as cards: a type icon (a $ coin for cash, a stopwatch for a tournament,
 *            in the series colours), the title (cash: stakes + game; tournament: compact buy-in +
 *            event) over the room (with the finish when a tournament cashed), the result (green /
 *            red, compact from 10k) over the date. 150 rows, then "Show more".
 *   detail   tap a row: every field we hold for it, read-only, in the sheet; "Edit in Results"
 *            closes the dashboard and opens that entry's edit form on the Results tab.
 *
 * Data and arithmetic: utils/bankroll-sessions.js (tested) over three existing routes — the
 * reports facts (dates, rooms, results in the dashboard's currency), /api/tracking and
 * /api/cash-sessions (the fields the facts do not carry). Expenses, income and deposits are not
 * sessions and are not listed.
 *
 * Layout (35g content; bankroll-sessions.css): bar All 6g | Tournaments 9g | Cash 6g | count 11g
 * (1g apart), 4r; rows 7r cards, 1r apart, columns 1g | icon 3g | 1g | text 18g | 1g | result 10g |
 * 1g; year pill 7g x 3r on 14g.
 *
 * "Edit in Results" is offered only when the sheet is over the Results tab (TrackingView mounts it);
 * over the home (HomeNumbers) the detail says where to edit instead.
 */

const STORE = 'bankrollSessionsType';
const TYPE_KEYS = new Set(SESSION_TYPES.map((t) => t[0]));
const loadType = () => { try { const v = localStorage.getItem(STORE); return TYPE_KEYS.has(v) ? v : 'all'; } catch { return 'all'; } };
const saveType = (v) => { try { localStorage.setItem(STORE, v); } catch { /* private mode: not remembered */ } };

const cfgOf = (code) => CURRENCY_CONFIG[code] || CURRENCY_CONFIG.USD;
// The room a tournament row shows (utils/bankroll-sessions.js tournamentPlace): an online event's
// fact room is the site KEY ("wsop_com"), which the app names "WSOP.com"; a feed row with no room
// has its series title there, and the curated VENUE_MAP knows that series' room.
const siteName = (key) => { const s = getSite(key); return s && s.key === key ? s.name : ''; };
const roomOf = (venue) => (Object.prototype.hasOwnProperty.call(VENUE_MAP, venue) && VENUE_MAP[venue].longName) || '';
// The Results tab's panel is laid out (App hides every other tab's panel with display: none).
const resultsOnScreen = () => {
  const el = document.querySelector('.tab-panel[data-tab="tracking"]');
  return !!(el && el.getClientRects().length);
};
const money = (v, cur) => formatCurrencyAmount(Math.round(v || 0), cur);
const signed = (v, cur) => (v > 0 ? '+' : '') + formatCurrencyAmount(Math.round(v || 0), cur);
const tone = (v) => (v > 0 ? ' an-pos' : v < 0 ? ' an-neg' : '');
// ROI: whole percent (one decimal under 10%), with thousands separators as Field and Cashed have.
const pct = (x) => {
  if (x == null) return '—';
  const digits = Math.abs(x) < 0.1 ? 1 : 0;
  const body = Math.abs(x * 100).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (x > 0 ? '+' : x < 0 ? MINUS : '') + body + '%';
};
const clock = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Type icons, drawn on a 24-unit box and sized in r by the stylesheet.
const CoinIcon = () => (
  <svg className="bs-ico is-cash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9.25" />
    <path d="M14.75 9.2c-.45-.85-1.5-1.4-2.75-1.4-1.55 0-2.7.8-2.7 2.05 0 2.8 5.65 1.45 5.65 4.3 0 1.25-1.2 2.1-2.95 2.1-1.4 0-2.55-.6-3.05-1.55M12 6.1v1.7M12 16.25v1.7" />
  </svg>
);
const WatchIcon = () => (
  <svg className="bs-ico is-tourn" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="13.5" r="7.75" />
    <path d="M12 13.5V9.25M9.75 2.75h4.5M12 2.75v3M18.25 6.75l1.5-1.5" />
  </svg>
);

const Row = memo(function Row({ row, currency, onOpen }) {
  const result = compactMoney(row.result, cfgOf(currency), { signed: true });
  // No room recorded (a cash session left blank, a private or imported result): said so, unless a
  // tournament's finish fills the line.
  const room = row.room || (row.finish ? '' : 'Room not recorded');
  return (
    <li className="bs-li">
      <div className={'bs-row is-' + row.type} data-key={row.key} role="button" tabIndex={0} onClick={() => onOpen(row.key, false)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(row.key, true); } }}
        aria-label={`${row.title}${row.room ? ', ' + row.room : ''}${row.finish ? ', ' + row.finish : ''}, ${row.dateLabel}, ${result.replace(MINUS, '-')}`}>
        <span className="bs-icocell">{row.type === 'cash' ? <CoinIcon /> : <WatchIcon />}</span>
        <span className="bs-main">
          <span className="an-cell bs-title an-clip">{row.title}</span>
          <span className={'an-cell an-note an-clip' + (row.room || row.finish ? '' : ' is-none')}>
            {row.finish && <span className="bs-finish">{row.finish}</span>}{row.finish && room ? ' · ' : ''}{room}
          </span>
        </span>
        <span className="bs-side">
          <span className={'an-cell an-val an-num an-clip' + tone(row.result)}>{result}</span>
          <span className="an-cell an-note an-num an-clip">{row.dateLabel}</span>
        </span>
      </div>
    </li>
  );
});

// One label | value row of the detail (the Overview's statistics rows: 21g | 14g, 4r).
function KV({ label, value, toneOf }) {
  return (
    <div className="an-row is-body bd-cols-kv">
      <dt className="an-cell an-td an-clip">{label}</dt>
      <dd className={'an-cell an-td an-num an-clip' + (toneOf != null ? tone(toneOf) : '')} title={typeof value === 'string' ? value : undefined}>{value}</dd>
    </div>
  );
}

// A session's stack over time (its stack updates), above zero in the win colour, below in the
// loss colour — the Cash view's swing graph, from the same series (utils/cash-sessions.js).
const VW = 1000, VH = 300;
function SwingChart({ session, stacks }) {
  const id = 'bs' + useId().replace(/[^\w-]/g, '');
  const p = chartPath(swingSeries(session, stacks), { W: VW, H: VH, x: 't' });
  if (!p) return null;
  const sides = [['is-pos', -VH, p.zeroY + VH], ['is-neg', p.zeroY, VH * 2 - p.zeroY]];
  return (
    <div className="bs-chart">
      <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" role="img" aria-label="Stack over the session">
        <defs>
          {sides.map(([k, y, h]) => <clipPath key={k} id={`${id}-${k}`}><rect x={-VW} y={y} width={VW * 3} height={h} /></clipPath>)}
        </defs>
        <line x1="0" x2={VW} y1={p.zeroY} y2={p.zeroY} className="bs-chart-zero" vectorEffect="non-scaling-stroke" />
        {sides.map(([k]) => (
          <g key={k} clipPath={`url(#${id}-${k})`}>
            <path d={`${p.d} L${VW} ${p.zeroY} L0 ${p.zeroY} Z`} className={'bs-chart-area ' + k} />
            <path d={p.d} className={'bs-chart-line ' + k} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
    </div>
  );
}

function Detail({ row, currency, bankrollName, stacks, onBack, onEdit, rootRef, backRef }) {
  const isCash = row.type === 'cash';
  const t = isCash ? null : tournamentFigures(row);
  const c = isCash ? cashFigures(row) : null;
  const cur = row.currency;
  const converted = cur !== currency;
  // The hero is in the dashboard's currency, as the row; the rows below are in the money played.
  const hourlyShown = isCash && c.hours >= 0.25 ? row.result / c.hours : null;
  const heroRight = isCash
    ? { label: 'Per hour', value: hourlyShown == null ? '—' : `${signed(hourlyShown, currency)}/h`, n: hourlyShown || 0, note: c.hours > 0 ? formatHours(c.hours) : 'No length recorded' }
    // ROI is a percentage, not money: never green / red (the Overview's rule).
    : { label: 'ROI', value: pct(t.roi), n: 0, note: t.place ? finishLabel(t.place, t.field) : t.cashed ? 'Cashed' : 'No cash' };
  const sw = isCash && stacks.length ? swingSummary(stacks) : null;
  return (
    // Focusable (-1) so the focus stays in it (a click anywhere in it lands here), where Escape is
    // heard: Escape goes back to the list and stops there, before the dashboard's window listener
    // would close the whole sheet.
    <div ref={rootRef} className="bs-detail" role="group" aria-label={row.title} tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onBack(true); } }}>
      <div className="bs-dhead">
        {/* A click from Enter / Space carries no click count (detail 0). */}
        <button ref={backRef} type="button" className="bk-btn bs-w9" onClick={(e) => onBack(e.detail === 0)} aria-label="Back to Sessions"><span>‹ Sessions</span></button>
        {onEdit && <button type="button" className="bk-btn bk-btn--brand bs-w12" onClick={onEdit}><span>Edit in Results</span></button>}
      </div>

      <h4 className="bs-dtitle">{row.title}</h4>
      <p className="an-p bs-dsub">
        {[isCash ? 'Cash game' : 'Tournament', row.room || 'Room not recorded'].join(' · ')}
      </p>

      <div className="bd-hero bs-hero">
        <div className="bd-hero-col">
          <div className="an-cell an-lbl an-lbl-2 an-clip">{isCash ? 'Net' : 'Result'}</div>
          <div className={'an-cell bd-hero-val an-clip' + tone(row.result)}>{signed(row.result, currency)}</div>
          <div className="an-cell an-note bd-note-3 an-clip">{row.dateLabel}</div>
        </div>
        <div className="bd-hero-col an-num">
          <div className="an-cell an-lbl an-lbl-2 an-clip">{heroRight.label}</div>
          <div className={'an-cell bd-hero-val an-clip' + tone(heroRight.n)}>{heroRight.value}</div>
          <div className="an-cell an-note bd-note-3 an-clip">{heroRight.note}</div>
        </div>
      </div>

      <section className="bd-section" aria-labelledby="bs-fields">
        <h3 className="an-cell an-sec" id="bs-fields">Details</h3>
        <dl className="bd-kv">
          <KV label="Date" value={row.dateLabel} />
          {isCash ? (
            <>
              {!c.partial && <KV label="Played" value={`${clock(c.startedAt)} – ${clock(c.endedAt)}`} />}
              <KV label="Length" value={c.hours > 0 ? formatHours(c.hours) : '0m'} />
              <KV label="Game" value={c.game || '—'} />
              <KV label="Stakes" value={c.stakes || '—'} />
              {!c.partial && (
                <>
                  <KV label="Buy-in" value={money(c.buyIn, cur) + (c.rebuys ? ` (${plural(c.rebuys, 'rebuy')})` : '')} />
                  <KV label="Cash-out" value={money(c.cashOut, cur)} />
                  <KV label="Tips" value={money(c.tips, cur)} />
                  <KV label="Expenses" value={money(c.expenses, cur)} />
                </>
              )}
              <KV label="Net" value={signed(c.partial ? row.result : c.net, c.partial ? currency : cur)} toneOf={c.net} />
              <KV label="Per hour" value={c.hourly == null ? '—' : `${signed(c.hourly, c.partial ? currency : cur)}/h`} toneOf={c.hourly || 0} />
              {/* bb/hr: this session's net over its own big blind (read from the stakes), over its length; limit games in
                  big bets (BB/hr). "—" when the stakes name no blind or the session is under a quarter hour. */}
              <KV label={c.bb && c.bb.unit === 'BB' ? 'Big bets per hour' : 'Big blinds per hour'}
                value={c.bb ? fmtBbHr(c.bb.rate, c.bb.unit) : '—'} toneOf={c.bb ? bbTone(c.bb.rate) : 0} />
              {converted && !c.partial && <KV label={`Net in ${currency}`} value={signed(row.result, currency)} toneOf={row.result} />}
              {sw && <KV label="High / low" value={`${signed(sw.high, cur)} / ${signed(sw.low, cur)}`} />}
              {c.tags.length > 0 && <KV label="Tags" value={c.tags.join(', ')} />}
            </>
          ) : (
            <>
              {t.time && <KV label="Start" value={t.time} />}
              {row.series && <KV label="Series" value={row.series} />}
              {t.eventNumber && <KV label="Event" value={`#${t.eventNumber}`} />}
              <KV label="Game" value={t.game || '—'} />
              <KV label="Buy-in" value={money(t.buyin, cur)} />
              <KV label="Bullets" value={String(t.bullets)} />
              <KV label="Cost" value={money(t.cost, cur)} />
              <KV label="Cashed" value={t.cashed ? money(t.cash, cur) : 'No'} />
              <KV label="Finish" value={t.place ? finishLabel(t.place, t.field) : '—'} />
              {t.field && !t.place && <KV label="Field" value={t.field.toLocaleString('en-US')} />}
              <KV label="Profit" value={signed(t.net, cur)} toneOf={t.net} />
              <KV label="ROI" value={pct(t.roi)} />
              {converted && <KV label={`Profit in ${currency}`} value={signed(row.result, currency)} toneOf={row.result} />}
            </>
          )}
          <KV label="Bankroll" value={bankrollName} />
        </dl>
        {converted && (
          <p className="an-p bd-after">{isCash ? 'Played' : 'Paid'} in {cur}; the {currency} figure is at today&apos;s rate, as every bankroll total.</p>
        )}
        {!onEdit && <p className="an-p bd-after">To change it, open Results{isCash ? ' › Cash' : ''} and edit it there.</p>}
      </section>

      {isCash && stacks.length > 0 && (
        <section className="bd-section" aria-labelledby="bs-swing">
          <h3 className="an-cell an-sec" id="bs-swing">Stack over the session · {plural(stacks.length, 'update')}</h3>
          <SwingChart session={row.session} stacks={stacks} />
        </section>
      )}

      <section className="bd-section" aria-labelledby="bs-notes">
        <h3 className="an-cell an-sec" id="bs-notes">Notes</h3>
        <p className={'an-p bs-notes' + ((isCash ? c.notes : t.notes) ? '' : ' is-none')}>{(isCash ? c.notes : t.notes) || 'No notes.'}</p>
      </section>
    </div>
  );
}

const NONE = [];

export default function BankrollSessions({ bk, bankrollKey, currency, onClose }) {
  // The rows with the bankroll and currency they were built for: on a switch the old rows are not
  // shown (not even for the frame before the new read starts), so none is labelled in the new currency.
  const [state, setState] = useState({ status: 'loading', rows: NONE, key: null, currency: null });
  const [type, setTypeState] = useState(loadType);
  const [limit, setLimit] = useState(CHUNK);
  const [openKey, setOpenKey] = useState(null);
  const [stacks, setStacks] = useState({ key: null, list: [] });
  // "Edit in Results" only where it can land: under the Results tab (TrackingView's sheet). Over the
  // home (HomeNumbers opens this sheet too) closing it would leave the player on the home.
  const [onResults] = useState(resultsOnScreen);
  const sectionRef = useRef(null);
  const detailRef = useRef(null);        // the detail, and its Back button: one of them takes the focus when it opens
  const backRef = useRef(null);
  const listRef = useRef(null);          // the list, which takes the focus back from a tapped Back
  const listScroll = useRef(null);       // the sheet's scroll position when a row was opened
  const lastOpen = useRef(null);         // the row opened (and whether from the keyboard), focused again on Back
  const moreFrom = useRef(null);         // a keyboard "Show more": the index of the first row it adds
  const setType = (v) => { setTypeState(v); saveType(v); setLimit(CHUNK); };

  const get = useCallback(async (path) => {
    const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${bk.token}` } });
    if (!res.ok) throw new Error('Request failed');
    return res.json();
  }, [bk.token]);

  useEffect(() => {
    let live = true;
    const built = { key: bankrollKey, currency };
    setState({ status: 'loading', rows: NONE, ...built });
    setOpenKey(null);
    listScroll.current = null;
    lastOpen.current = null;
    setLimit(CHUNK);
    const q = bankrollQuery(bankrollKey);
    const sep = q ? '&' : '?';
    Promise.allSettled([
      bk.call('GET', `/reports${q}${sep}currency=${encodeURIComponent(currency)}`),
      bk.token ? get(`/tracking${q}`) : Promise.reject(new Error('no token')),
      bk.token ? get(`/cash-sessions${q}`) : Promise.reject(new Error('no token')),
    ]).then(([facts, tracking, cash]) => {
      if (!live) return;
      if (facts.status !== 'fulfilled') { setState({ status: 'error', rows: NONE, ...built }); return; }
      const rows = buildSessions(facts.value.facts || [],
        tracking.status === 'fulfilled' && Array.isArray(tracking.value) ? tracking.value : [],
        cash.status === 'fulfilled' ? cash.value.sessions || [] : [],
        { currency, config: CURRENCY_CONFIG, nativeOf: nativeCurrency, siteName, roomOf });
      setState({ status: 'ready', rows, partial: tracking.status !== 'fulfilled' || cash.status !== 'fulfilled', ...built });
    });
    return () => { live = false; };
  }, [bankrollKey, currency, get]); // eslint-disable-line react-hooks/exhaustive-deps

  const fresh = state.key === bankrollKey && state.currency === currency;
  const status = fresh ? state.status : 'loading';
  const allRows = fresh ? state.rows : NONE;
  const shown = useMemo(() => filterSessions(allRows, type), [allRows, type]);
  const years = useMemo(() => groupByYear(shown.slice(0, limit)), [shown, limit]);
  const row = openKey ? allRows.find((r) => r.key === openKey) : null;

  // A cash session's stack updates, read when its detail opens.
  useEffect(() => {
    if (!row || row.type !== 'cash' || !row.session || !bk.token) return undefined;
    let on = true;
    get(`/cash-sessions/${row.id}`).then((d) => { if (on) setStacks({ key: row.key, list: d.stacks || [] }); }).catch(() => {});
    return () => { on = false; };
  }, [row, get, bk.token]);

  // The sheet's scroller: the detail opens at the top of this tab, and Back returns the list to where it was.
  const scroller = () => (sectionRef.current ? sectionRef.current.closest('.an-body') : null);
  // Focus follows the detail, after the scroll is set and without scrolling (the hidden list drops
  // the focus to the body, out of the dialog). Opened from the keyboard, the focus goes to Back (a
  // visible ring, the next Tab reaching Edit in Results); from a tap, to the detail itself, which
  // draws no ring but hears Escape. Back or Escape from the keyboard returns it to the row that was
  // opened; a tap on Back to the list itself (no ring on a row the player did not reach by key, and
  // the focus still inside the dialog). Never taken from elsewhere: a bankroll chip keeps it when a
  // switch closes the detail (WebKit gives a clicked chip none: see the switch effect below).
  const rowEl = (key) => (sectionRef.current ? [...sectionRef.current.querySelectorAll('.bs-row')].find((el) => el.dataset.key === key) : null);
  const focusLost = () => {
    const a = document.activeElement;
    return !a || a === document.body || !!(sectionRef.current && sectionRef.current.contains(a));
  };
  const onOpen = useCallback((key, byKey) => {
    const s = scroller();
    listScroll.current = s ? s.scrollTop : null;
    lastOpen.current = { key, byKey, backByKey: false };
    setOpenKey(key);
  }, []);
  const onBack = (byKey) => {
    if (lastOpen.current) lastOpen.current.backByKey = byKey;
    setOpenKey(null);
  };
  useLayoutEffect(() => {
    const s = scroller();
    if (!s || !sectionRef.current) return;
    const last = lastOpen.current;
    if (openKey) {
      // The section's own top (its heading), less the body's top padding: the same place the tab opens at.
      const pad = parseFloat(getComputedStyle(s).paddingTop) || 0;
      const top = sectionRef.current.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop - pad;
      if (s.scrollTop > top) s.scrollTop = top;
      const to = last && last.byKey ? backRef.current : detailRef.current;
      if (to) to.focus({ preventScroll: true });
    } else {
      if (listScroll.current != null) { s.scrollTop = listScroll.current; listScroll.current = null; }
      lastOpen.current = null;
      const el = !last || !focusLost() ? null : last.backByKey ? rowEl(last.key) : listRef.current;
      if (el) el.focus({ preventScroll: true });
    }
  }, [openKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A bankroll switch unmounts an open detail in the render it happens in (the rows on hand are
  // not the new roll's). Where a clicked chip takes the focus (Chromium) nothing moves; in WebKit a
  // clicked button takes none, the detail's focus falls to the body outside the dialog, and the
  // list takes it.
  useLayoutEffect(() => {
    if (openKey && listRef.current && focusLost()) listRef.current.focus({ preventScroll: true });
  }, [bankrollKey, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Show more" from the keyboard: when the button goes (nothing left), the focus goes on to the
  // first row it added; while rows remain the button stays, and keeps it.
  const showMore = (e) => {
    if (e.detail === 0 || document.activeElement === e.currentTarget) moreFrom.current = limit;
    setLimit((n) => n + CHUNK);
  };
  useLayoutEffect(() => {
    const i = moreFrom.current;
    moreFrom.current = null;
    if (i == null || !sectionRef.current || sectionRef.current.querySelector('.bs-more')) return;
    const el = sectionRef.current.querySelectorAll('.bs-row')[i];
    if (el) el.focus({ preventScroll: true });
  }, [limit]);

  const names = useMemo(() => new Map((bk.bankrolls || []).map((b) => [String(b.id), b.name])), [bk.bankrolls]);
  const bankrollName = row ? names.get(String(row.fact.bankroll)) || (String(row.fact.bankroll) === 'main' ? 'Main' : '—') : '';
  const edit = () => {
    if (!row) return;
    if (bk.setSelected) bk.setSelected(bankrollKey);
    openInResults(row.type === 'cash' ? 'cash' : 'tournaments', row.id);
    onClose();
  };

  const rest = shown.length - limit;
  return (
    <section ref={sectionRef} className="bd-section bs-sessions" aria-labelledby="bs-title">
      <h3 className="an-cell an-sec" id="bs-title">Sessions</h3>
      {row && (
        <Detail row={row} currency={currency} bankrollName={bankrollName}
          stacks={stacks.key === row.key ? stacks.list : []} onBack={onBack} onEdit={onResults ? edit : null}
          rootRef={detailRef} backRef={backRef} />
      )}
      <div ref={listRef} className="bs-listview" hidden={!!row} tabIndex={-1}>
        <div className="bs-bar">
          <div className="bs-chips" role="radiogroup" aria-label="Show">
            {SESSION_TYPES.map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={type === k}
                className={'bk-seg-btn bs-chip' + (type === k ? ' is-on' : '')} onClick={() => setType(k)}>
                <span>{label}</span>
              </button>
            ))}
          </div>
          <span className="an-cell an-note bd-note-4 an-num an-clip bs-count">{status === 'ready' ? countLabel(shown.length, type) : ''}</span>
        </div>
        <p className="an-p bs-note">Not listed: expenses, income and deposits (they are not sessions).</p>

        {status === 'loading' && <p className="an-p">Loading…</p>}
        {status === 'error' && <p className="an-p">The sessions could not load. Close the dashboard and try again.</p>}
        {status === 'ready' && shown.length === 0 && (
          <p className="an-p">
            {type === 'cash' ? 'No finished cash sessions' : type === 'tournament' ? 'No tournament results' : 'No tournament results or cash sessions'} in
            {String(bankrollKey) === 'all' ? ' any bankroll' : ' this bankroll'} yet.
          </p>
        )}
        {fresh && state.partial && allRows.length > 0 && (
          <p className="an-p">Some details (finishes, notes, rebuys, the currency each was played in) could not load; the results are complete.</p>
        )}

        {years.map((y) => (
          <section key={y.year} className="bs-year" aria-label={y.year}>
            <div className="bs-year-head"><span className="bs-year-pill">{y.year}</span></div>
            <ul className="bs-list">
              {y.rows.map((r) => <Row key={r.key} row={r} currency={currency} onOpen={onOpen} />)}
            </ul>
          </section>
        ))}
        {rest > 0 && (
          <button type="button" className="bk-btn bs-more" onClick={showMore}>
            <span>{rest > CHUNK ? `Show ${CHUNK.toLocaleString('en-US')} more · ${rest.toLocaleString('en-US')} left` : rest === 1 ? 'Show the last one' : `Show the last ${rest.toLocaleString('en-US')}`}</span>
          </button>
        )}
      </div>
    </section>
  );
}
