import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import useWordmarkFit from '../hooks/useWordmarkFit.js';
import Icon from './Icon.jsx';
import GridOverlay from './GridOverlay.jsx';
import ThemeButton from './ThemeButton.jsx';
import BackerChart, { RangeStrip } from './BackerChart.jsx';
import useBackerPush from '../hooks/useBackerPush.js';
import useInkBalance from '../hooks/useInkBalance.js';
import useThemeChoice from '../hooks/useThemeChoice.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { API_URL } from '../utils/api.js';
import { settleView } from '../utils/backer-settle.js';
import { VENUE_MAP, getVenueBrandColor, getVenueInfo, getStripAbbr } from '../utils/utils.js';
import {
  summarize, groupByMonth, shareSeries, rangeOptions, stripFor, monthLabel, RANGE_NOUN,
  fmtSignedCents, fmtHours, fmtDay, plural, tone, bbStats, eventBb, settlementCountdown, weekRunning,
} from '../utils/backer-page.js';
import './backer-page.css';

/**
 * A backer's private page, /b/<token> (owner, 2026-10-13: "the full futuregame design treatment.
 * Every session is an event card", and a graph). No login, nav or rail: App.jsx renders this
 * before anything else when the path is a backer link, and the server serves the app shell there
 * (server.js app.get('/b/:token')) with no-store, noindex and no-referrer, since the token in the
 * URL is the backer's whole authentication.
 *
 * Phone first; on a desktop window the same 37g column, centred (.app-shell without is-desktop):
 * this is a page to read, one column wide.
 *
 *   top bar     the wordmark, "your action with Ethan Bennett", the notifications pill and the theme
 *               button (8r)
 *   hero        the name (display face) and the stakes summary
 *   total       running total, signed and toned, over sessions · hours · the player's bb/hr (BB/hr for
 *               limit games; computed here from the feed's events, utils/bb-hr.js) · opening (a 12r card)
 *   graph       the share over time (BackerChart), with 1M / 3M / YTD / All when history allows
 *   sessions    month breaks in the Schedule's date-break language, sticky, each session an event
 *               card: the room's strip, the game, the date, hours and bb/hr, the result and the share
 *
 * Themes: the top bar carries the app's own theme button (ThemeButton, hooks/useThemeChoice.js: dark,
 * dusk, light, cloudy, stored as localStorage['theme'] like the app's, so one device has one
 * preference). With nothing stored the page follows the device (prefers-color-scheme); contrast
 * always follows the device (prefers-contrast). Both are set before first paint by index.html's head
 * script and kept in step by the hook and by useDeviceContrast below.
 * Arithmetic and formatting: utils/backer-page.js (tested). Layout: backer-page.css.
 */

/* The admin-only layout grid (owner, 2026-10-15), as the app has it: shown to a device signed in to
   the app as an admin (the app's own token, read here only to decide whether to offer the overlay;
   mirrors App.jsx tokenUsername and APP_ADMIN_USERNAMES), on and off with the app's own setting
   (localStorage gridOverlay), and ?gridOverlay=1 still forces it for anyone (the guards). */
const APP_ADMIN_USERNAMES = ['ham', 'ham5', 'claude'];
function deviceIsAppAdmin() {
  try {
    const tok = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    const part = tok.split('.')[1];
    if (!part) return false;
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return !!claims && !claims.isGuest && typeof claims.username === 'string' && APP_ADMIN_USERNAMES.includes(claims.username.toLowerCase());
  } catch { return false; }
}

function useDeviceContrast() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const more = window.matchMedia ? window.matchMedia('(prefers-contrast: more)') : { matches: false, addEventListener() {}, removeEventListener() {} };
    const apply = () => root.setAttribute('data-contrast', more.matches ? 'high' : 'normal');
    apply();
    more.addEventListener('change', apply);
    return () => more.removeEventListener('change', apply);
  }, []);
}

/* A classic scrollbar's width, in g (0 where scrollbars overlay, as on every phone). On a window
   with room for it the shell is widened by that much (backer-page.css --bp-sb-g), so the content
   beside the scrollbar keeps its whole 35g, as the desktop panes do (useDesktopLayout.js). */
function useScrollbarAllowance(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;overflow:scroll;width:calc(var(--gu) * 10);height:calc(var(--gu) * 10)';
      document.body.appendChild(probe);
      const g = probe.getBoundingClientRect().width / 10;
      const px = probe.offsetWidth - probe.clientWidth;
      probe.remove();
      const sbG = px > 0 && g ? Math.round((px / g) * 1e4) / 1e4 : 0;
      const room = g && window.innerWidth / g >= 37 + sbG - 1e-6;
      el.style.setProperty('--bp-sb-g', room ? String(sbG) : '0');
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref]);
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The graph's range: one 35g x 4r strip of whole-g segments (the bankroll overview's segmented
 *  strip, drawn here so the page does not load the bankroll chunk). A radio group. */
/* The live beacon (owner, 2026-10-16): the player is at a table now, and what. From
   GET /api/backer/:token/live (lib/backer-live.js), polled each minute while the page is visible.
   A card under the name, before the running total: "Playing now" with a pulsing dot, the game or the
   event in the display face, the room and when it started. Nothing about money. */
const LIVE_POLL_MS = 60000;
function useLiveSession(token) {
  const [live, setLive] = useState(null);
  useEffect(() => {
    let off = false;
    const check = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetch(`${API_URL}/backer/${token}/live`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!off) setLive(d && d.live ? d.live : null); })
        .catch(() => {});
    };
    check();
    const id = setInterval(check, LIVE_POLL_MS);
    const onVis = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { off = true; clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [token]);
  return live;
}
function liveSince(since, now = Date.now()) {
  const t = Date.parse(since);
  if (!Number.isFinite(t)) return '';
  const clock = new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const mins = Math.max(0, Math.round((now - t) / 60000));
  const run = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
  return `since ${clock} · ${run}`;
}
/** The minutes past the hour since the session started, as an angle (the Swiss theme draws the
 *  beacon as a filling clock face from it; catalogue item 44). */
function liveSweep(since) {
  const t = Date.parse(since);
  if (!Number.isFinite(t)) return '0deg';
  const min = Math.max(0, (Date.now() - t) / 60000) % 60;
  return Math.round((min / 60) * 360) + 'deg';
}

function LiveBeacon({ live }) {
  const what = live.kind === 'cash' ? 'Cash game' : 'Tournament';
  return (
    <section className="bp-live" aria-live="polite" aria-label="Playing now">
      <span className="bp-live-dot" aria-hidden="true" style={{ '--sweep': liveSweep(live.since) }} />
      <div className="an-cell an-lbl an-lbl-3">Playing now · {what}</div>
      <div className="an-cell an-val bp-live-title an-clip">{live.title}</div>
      <div className="an-cell an-note an-clip">{[live.room, liveSince(live.since)].filter(Boolean).join(' · ')}</div>
    </section>
  );
}

function PushPill({ push }) {
  const { state } = push;
  if (state === 'unsupported' || state === 'unavailable' || state === 'checking') return null;
  const on = state === 'on';
  const blocked = state === 'blocked';
  const busy = state === 'busy';
  const label = blocked ? 'Notifications blocked' : on ? 'Notifications on' : busy ? 'One moment' : 'Notify me';
  return (
    <button type="button" className={'bp-push snap-g' + (on ? ' is-on' : '') + (blocked ? ' is-blocked' : '')}
      aria-pressed={blocked ? undefined : on} disabled={blocked || busy}
      title={blocked ? 'Allow notifications for futurega.me in your browser settings to get them' : on ? 'Turn notifications off' : 'Get a notification after each session'}
      onClick={on ? push.disable : push.enable}>
      <Icon.bell /><span className="bp-push-label">{label}</span>
    </button>
  );
}

function TopBar({ push, theme }) {
  const wordmarkRef = useRef(null);
  useWordmarkFit(wordmarkRef);
  return (
    <header className="top-bar bp-top">
      <div className="top-bar-title">
        <h1 ref={wordmarkRef}>futurega.me</h1>
        {/* The player's full name (owner, 2026-10-14). One player today; when backers belong to other
            players after the bankroll merge, this comes from the feed. */}
        <small>your action with Ethan Bennett</small>
      </div>
      {/* The pill and the theme button, right-aligned on the 1g margin and centred on the bar's 4r
          line; the button is last, so it holds still when the pill comes and goes. */}
      <div className="bp-top-actions">
        {push && <PushPill push={push} />}
        <ThemeButton theme={theme.theme} nextThemeLabel={theme.nextThemeLabel} onToggle={theme.toggleTheme} />
      </div>
    </header>
  );
}

/** One session, as the Schedule's event card (owner, 2026-10-15: "as close to the schedule card as
 *  possible, just swapping out information"). The same markup and classes as CalendarEventRow, so
 *  it is the same card on the same grid: the room's strip down the left (its full name when open),
 *  the date and hours where the start time goes, the backer's share where the buy-in goes and what
 *  it is a share of where the guarantee goes, the game as the title with the room under it as a
 *  flight's stage line, and the bb/hr where the late-reg line goes. A tap opens it like the
 *  Schedule's: the session's figures in the detail grid, then the owner's notes in the notes line. */
function SessionCard({ e }) {
  const strip = stripFor(e.venue, VENUE_MAP);
  const share = Number(e.shareCents) || 0;
  const result = Number(e.sessionResultCents) || 0;
  const pct = Number(e.pct) || 0;
  const pctText = (Math.round(pct * 100) / 100).toString();
  // The player's bb/hr for this session, when its game names a big blind (utils/bb-hr.js).
  const bb = eventBb(e);
  // A room VENUE_MAP doesn't name takes the Schedule's derived code (getVenueInfo).
  const abbr = strip.abbr || (strip.name ? getVenueInfo(strip.name).abbr : null) || null;
  const notes = typeof e.notes === 'string' ? e.notes.trim() : '';
  const subtitle = typeof e.subtitle === 'string' ? e.subtitle.trim() : '';
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((v) => !v);
  // The notes line seated on the grid however many lines it wraps to, as CalendarEventRow seats
  // its own: the cell is 2r + 3r per extra line, measured after layout.
  const notesCellRef = useRef(null);
  useLayoutEffect(() => {
    const cell = notesCellRef.current;
    if (!open || !cell) return;
    const p = cell.firstElementChild;
    if (!p) return;
    cell.style.minHeight = '';
    const r = parseFloat(getComputedStyle(cell).minHeight) / 2;
    if (!r) return;
    cell.style.minHeight = '0px';
    const lines = Math.max(1, Math.round((p.getBoundingClientRect().height - 1.2 * r) / (3 * r)) + 1);
    cell.style.minHeight = `calc(var(--subrow) * ${2 + (lines - 1) * 3})`;
  }, [open, notes]);
  return (
    <li className={'cal-event-row bp-session' + (open ? ' open' : '')}>
      <div className={'cal-venue-strip' + (abbr ? '' : ' is-neutral')} aria-hidden="true" onClick={toggle}
        style={{ background: abbr ? getVenueBrandColor(abbr) : 'var(--border-strong)', color: '#ffffff', cursor: 'pointer' }}>
        <span className="venue-strip-abbr">{abbr ? getStripAbbr(abbr) : ''}</span>
        {open && <span className="venue-strip-full">{(strip.name && getVenueInfo(strip.name).longName) || strip.name || strip.label}</span>}
      </div>
      <div className="cal-event-row-content">
        <div className="cal-event-bar" onClick={toggle} role="button" tabIndex={0} aria-expanded={open}
          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } }}>
          <div className="cal-bar-row1">
            <span className="cal-event-time">{fmtDay(e.date)} · {fmtHours(e.hours)}</span>
            <span className="cal-event-money">
              <span className={'cal-event-buyin bp-amt ' + tone(share)}>{fmtSignedCents(share)}</span>
              <span className="cal-event-gtd">{pctText}% of {fmtSignedCents(result)}</span>
            </span>
          </div>
          <div className="cal-bar-row2">
            {/* The game as the title; the owner's subheading for the session under it, as a flight's
                stage line, typed in the result's or the session's form (owner, 2026-10-15). */}
            <span className="cal-event-name" title={e.game || ''}>
              {subtitle ? (
                <>
                  <span className="cal-event-base">{e.game || 'Session'}</span>
                  <span className="cal-event-stage">{subtitle}</span>
                </>
              ) : (e.game || 'Session')}
            </span>
            {/* bb/hr under the share and what it is of (owner, 2026-10-15), in the money column on
                the title's line, as the Schedule's accolades sit under its guarantee. */}
            {bb && (
              <span className="bp-bb-cell">
                <span className={'cal-event-gtd bp-bb ' + bb.tone}>{bb.text}</span>
              </span>
            )}
          </div>
        </div>
        <div className={'cal-event-chevron' + (open ? ' open' : '')} onClick={toggle}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        <div className={'cal-event-detail-wrap' + (open ? ' open' : '')} onClick={() => setOpen(false)}>
          <div className="cal-event-detail-inner">
            <div className="cal-event-detail">
              <div className="cal-detail-grid">
                <div className="cal-detail-item">
                  <span className="cal-detail-label">Session</span>
                  <span className={'cal-detail-value bp-amt ' + tone(result)}>{fmtSignedCents(result)}</span>
                </div>
                <div className="cal-detail-item">
                  <span className="cal-detail-label">Your piece</span>
                  <span className="cal-detail-value">{pctText}%</span>
                </div>
                <div className="cal-detail-item">
                  <span className="cal-detail-label">Hours</span>
                  <span className="cal-detail-value">{fmtHours(e.hours)}</span>
                </div>
                {bb && (
                  <div className="cal-detail-item">
                    <span className="cal-detail-label">Win rate</span>
                    <span className={'cal-detail-value bp-bb ' + bb.tone}>{bb.text}</span>
                  </div>
                )}
              </div>
              {notes && (
                <div className="cal-detail-notes-cell" ref={notesCellRef}>
                  <p className="cal-detail-notes bp-detail-notes">{notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/** The time until settlement (owner, 2026-10-15: "we settle on Sundays at noon"), at the foot of the
 *  running total card: the Schedule's late-reg bar (styles.css .late-reg-*), its label and countdown on
 *  one 2r row and the bar under it, draining from a full week to empty at Sunday noon, Eastern. */
function SettlementBar() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const c = settlementCountdown(now);
  return (
    <div className="late-reg-wrap bp-settle" aria-label={`Settlement in ${c.text}, Sunday at noon Eastern`}>
      <div className="late-reg-label-row">
        <span className="late-reg-label open">Settle</span>
        <span className="late-reg-sep" />
        <span className="late-reg-time open">{c.text}</span>
      </div>
      <div className="late-reg-bar-bg">
        <div className="late-reg-bar-fill open" style={{ width: `${c.pct}%` }} />
      </div>
    </div>
  );
}

/** The card's large figure. While earlier weeks are unsettled (utils/backer-page.js weekRunning; owner,
 *  2026-10-20) it is two rows, never added together: To be settled from last week (what earlier weeks
 *  still owe), then This week (shares since Sunday noon, New York). Otherwise the one running total. Re-checked
 *  every 30 s, so Sunday noon starts a new week on an open page. */
function TotalFigures({ feed, total }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const w = weekRunning(feed, now);
  if (!w.show) {
    return (
      <>
        <div className="an-cell an-lbl an-lbl-3">Running total</div>
        <div className={'an-cell bp-total-val ' + tone(total)}>{fmtSignedCents(total)}</div>
      </>
    );
  }
  return (
    <div className="bp-total-rows">
      <div className="an-cell an-lbl an-lbl-3">To be settled from last week</div>
      <div className={'an-cell bp-total-val ' + tone(w.carriedCents)}>{fmtSignedCents(w.carriedCents)}</div>
      <div className="an-cell an-lbl an-lbl-3 bp-total-row2">This week</div>
      <div className={'an-cell bp-total-val ' + tone(w.weekCents)}>{fmtSignedCents(w.weekCents)}</div>
    </div>
  );
}

/** Settled (owner, 2026-10-19): the backer's half of the handshake, under the settlement bar. The
 *  balance goes to $0 once the player has pressed it too (Bankroll > Backers); either side can undo
 *  its press until then. utils/backer-settle.js words it; lib/staking/backer-settle.js keeps it. */
function SettleRow({ token, feed, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // What a press settles: what earlier weeks owe, never this week's (owner, 2026-10-20). The server
  // works the same figure out (lib/staking/backer-settle.js dueCents) and refuses a different one.
  const total = weekRunning(feed, Date.now()).carriedCents;
  const v = settleView({ settlement: feed.settlement, totalCents: total, side: 'backer' });
  if (!v) return null;
  const press = async () => {
    if (!v.button || busy) return;
    if (v.confirm && !window.confirm(v.confirm)) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/backer/${token}/settle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ action: v.button.action, amountCents: total }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { if (toast) toast.error(d.error || 'That did not go through. Try again.'); }
      else if (d.completed && toast) toast.success('Settled. Last week is cleared; this week carries on.');
      onChange();
    } catch { if (toast) toast.error('That did not go through. Check your connection.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="bp-settled-row">
      {v.button && (
        <button type="button" className={'bp-settled-btn' + (v.button.primary ? ' is-primary' : '')} onClick={press} disabled={busy}>
          {v.button.label}
        </button>
      )}
      <span className="an-cell bp-settled-status an-clip" title={v.status}>{v.status}</span>
    </div>
  );
}

/** A month break: the Schedule's date-break pill and count (styles.css .schedule-date-break),
 *  sticky at the scroller's top, the month's share at its right end. Its label, "Oct 2026", is
 *  centred on its ink like the Schedule's "DD Mon" (utils/ink-balance.js): a month name starts on
 *  a letter whose bearing differs by month (J reaches left of its origin, A sits on it), ends on
 *  the year's figure, and some rise above the cap height (the l of Jul, the b of Feb). */
function MonthBreak({ g }) {
  const { mon, year } = monthLabel(g.key);
  const labelRef = useRef(null);
  useInkBalance(labelRef, [mon, year]);
  return (
    <div className="schedule-date-break bp-month-break" style={{ top: 0 }}>
      <span className="date-break-pill bp-month-pill">
        <span className="date-break-label bp-month-label" ref={labelRef}>
          <b className="date-break-day">{mon}</b>
          <span className="date-break-mon">{year}</span>
        </span>
      </span>
      <span className="date-break-count">{plural(g.events.length, 'session')}</span>
      <span className="date-break-end bp-month-end">
        <span className={'date-break-dow bp-month-net ' + tone(g.shareCents)}>{fmtSignedCents(g.shareCents)}</span>
      </span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="bp-skeleton" aria-busy="true" aria-label="Loading your page">
      <div className="bp-hero">
        <div className="skeleton bp-sk-name" />
        <div className="skeleton bp-sk-stakes" />
      </div>
      <div className="skeleton bp-sk-total" />
      <div className="skeleton bp-sk-chart" />
      <ul className="bp-cards">
        {[0, 1, 2].map((i) => (
          <li key={i} className="bp-card bp-sk-card">
            <div className="skeleton bp-sk-strip" style={{ animationDelay: `${i * 90}ms` }} />
            <div className="bp-card-body">
              <div className="skeleton bp-sk-line" style={{ animationDelay: `${i * 90 + 60}ms` }} />
              <div className="skeleton bp-sk-line is-short" style={{ animationDelay: `${i * 90 + 120}ms` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BackerPage({ token }) {
  useDeviceContrast();
  const theme = useThemeChoice({ followDevice: true, admin: deviceIsAppAdmin() });
  const shellRef = useRef(null);
  useScrollbarAllowance(shellRef);
  const toast = useToast();
  const push = useBackerPush(token);
  const [feed, setFeed] = useState(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState('all');
  const today = useMemo(todayISO, []);
  const isAdmin = useMemo(deviceIsAppAdmin, []);
  const forcedGrid = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get('gridOverlay') === '1'; } catch { return false; }
  }, []);
  const [adminGrid, setAdminGrid] = useState(() => { try { return localStorage.getItem('gridOverlay') === 'on'; } catch { return false; } });
  const gridOverlay = forcedGrid || (isAdmin && adminGrid);
  const toggleGrid = () => setAdminGrid((g) => { const next = !g; try { localStorage.setItem('gridOverlay', next ? 'on' : 'off'); } catch { /* private mode */ } return next; });

  const live = useLiveSession(token);
  const load = useCallback(() => {
    setFailed(false);
    setFeed(null);
    fetch(`${API_URL}/backer/${token}/feed`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => setFeed(d))
      .catch(() => setFailed(true));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  // After a Settled press: the feed again, without the skeleton in between.
  const reload = useCallback(() => {
    fetch(`${API_URL}/backer/${token}/feed`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setFeed(d); }).catch(() => {});
  }, [token]);

  useEffect(() => { if (push.error && toast) toast.error(push.error); }, [push.error, toast]);

  const view = useMemo(() => {
    if (!feed) return null;
    const events = Array.isArray(feed.events) ? feed.events : [];
    const sum = summarize(feed);
    const options = rangeOptions(events, today);
    const r = options.some(([k]) => k === range) ? range : 'all';
    const series = shareSeries(events, { base: sum.base, range: r, today });
    // The player's bb/hr over the sessions the page holds (the newest 200), from the feed as it is.
    return { events, sum, options, range: r, series, months: groupByMonth(events), bbs: bbStats(events) };
  }, [feed, range, today]);

  useEffect(() => {
    const name = feed && feed.name;
    document.title = name ? `${name} · futurega.me` : 'Your action · futurega.me';
  }, [feed]);

  let body;
  if (failed) {
    body = (
      <section className="bp-message" aria-live="polite">
        <h2 className="an-cell bp-message-title">This page did not load</h2>
        <p className="an-p">Your sessions could not be fetched just now. Check your connection, then try again. Nothing is lost.</p>
        <button type="button" className="bp-retry" onClick={load}>Try again</button>
      </section>
    );
  } else if (!view) {
    body = <Skeleton />;
  } else {
    const { events, sum, options, series, months, bbs } = view;
    const name = feed.name || 'Your action';
    const baseNote = view.range !== 'all' ? 'start' : !sum.complete ? 'carried in' : sum.opening ? 'opening' : 'start';
    const label = view.range === 'all' ? 'Balance' : `Balance, ${RANGE_NOUN[view.range]}`;
    body = (
      <>
        <div className="bp-hero">
          <h2 className="an-cell bp-name an-clip">{name}</h2>
          {feed.stakes ? <p className="an-cell bp-stakes an-clip">{feed.stakes}</p> : null}
        </div>

        {live && <LiveBeacon live={live} />}

        {(events.length > 0 || sum.opening !== 0) && (
          <section className="bp-total" aria-label="Running total">
            <TotalFigures feed={feed} total={sum.total} />
            <div className="an-cell an-note an-clip">
              {events.length > 0 ? (
                <>
                  {`${plural(sum.sessions, 'session')} · ${fmtHours(sum.hours)}`}
                  {/* The player's bb/hr (BB/hr for limit games), over the cash sessions that name a big blind. */}
                  {bbs.map((f) => (
                    <React.Fragment key={f.unit}>
                      {' · '}
                      <span className={'bp-bb ' + f.tone}
                        title={`${plural(f.n, 'session')}, ${fmtHours(f.hours)}${sum.sessions > events.length ? `; the newest ${events.length} of ${sum.sessions}` : ''}`}>{f.full}</span>
                    </React.Fragment>
                  ))}
                  {sum.opening ? ` · opening ${fmtSignedCents(sum.opening)}` : ''}
                  {sum.paid ? ` · paid ${fmtSignedCents(-sum.paid)}` : ''}
                </>
              ) : `Opening balance · no sessions yet`}
            </div>
            <SettlementBar />
            <SettleRow token={token} feed={feed} onChange={reload} />
          </section>
        )}

        {events.length === 0 ? (
          <section className="bp-message bp-empty">
            <h3 className="an-cell bp-message-title">No sessions yet</h3>
            <p className="an-p">Sessions will appear here after the next one is logged.</p>
          </section>
        ) : (
          <>
            <BackerChart series={series} label={label} today={today} baseNote={baseNote}
              control={options.length > 0 && (
                <RangeStrip options={options} value={view.range} onChange={setRange} />
              )} />

            {/* No heading row: the month breaks lead straight in (owner, 2026-10-14). */}
            <section className="bp-sessions" aria-label="Sessions, newest first">
              {months.map((g) => (
                <div key={g.key} className="bp-month">
                  <MonthBreak g={g} />
                  <ul className="bp-cards">
                    {g.events.map((e, i) => <SessionCard key={(e.ts || '') + ':' + e.date + ':' + i} e={e} />)}
                  </ul>
                </div>
              ))}
            </section>
          </>
        )}
      </>
    );
  }

  return (
    <div className="app-shell bp-shell" ref={shellRef}>
      <TopBar push={failed ? null : push} theme={theme} />
      <main className="content-area bp-content">
        {body}
      </main>
      {gridOverlay && <GridOverlay showReadout={false} />}
      {isAdmin && (
        <button type="button" className={'grid-dev-toggle bp-grid-toggle' + (adminGrid ? ' is-on' : '')}
          title={`${adminGrid ? 'Hide' : 'Show'} layout grid (admin)`} aria-pressed={adminGrid} onClick={toggleGrid}>#</button>
      )}
    </div>
  );
}
