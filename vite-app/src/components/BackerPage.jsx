import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import GridOverlay from './GridOverlay.jsx';
import ThemeButton from './ThemeButton.jsx';
import BackerChart from './BackerChart.jsx';
import useBackerPush from '../hooks/useBackerPush.js';
import useInkBalance from '../hooks/useInkBalance.js';
import useThemeChoice from '../hooks/useThemeChoice.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { API_URL } from '../utils/api.js';
import { VENUE_MAP, getVenueBrandColor, getVenueInfo, getStripAbbr } from '../utils/utils.js';
import {
  summarize, groupByMonth, shareSeries, rangeOptions, stripFor, monthLabel, RANGE_NOUN,
  fmtSignedCents, fmtHours, fmtDay, plural, tone, bbStats, eventBb,
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
function RangeStrip({ options, value, onChange }) {
  return (
    <div className="bp-seg" data-n={options.length} role="radiogroup" aria-label="Range">
      {options.map(([k, text]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k}
          className={value === k ? 'is-on' : ''} onClick={() => onChange(k)}>
          <span>{text}</span>
        </button>
      ))}
    </div>
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
  return (
    <header className="top-bar bp-top">
      <div className="top-bar-title">
        <h1>futurega.me</h1>
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

/** One session, as an event card: the room's strip, then the game and the share, the date and
 *  hours and what the share is of. Not interactive (the strip carries no action here). */
function SessionCard({ e }) {
  const strip = stripFor(e.venue, VENUE_MAP);
  const share = Number(e.shareCents) || 0;
  const result = Number(e.sessionResultCents) || 0;
  const pct = Number(e.pct) || 0;
  const pctText = (Math.round(pct * 100) / 100).toString();
  // The player's bb/hr for this session, when its game names a big blind (utils/bb-hr.js).
  const bb = eventBb(e);
  // The strip runs down the card's left side, the room's short code in it, as on the Schedule
  // (owner, 2026-10-14). A room VENUE_MAP doesn't name takes the Schedule's derived code
  // (getVenueInfo); the full name is the line under the game, so nothing is lost.
  const abbr = strip.abbr || (strip.name ? getVenueInfo(strip.name).abbr : null) || null;
  return (
    <li className="bp-card">
      <div className={'cal-venue-strip bp-strip' + (abbr ? '' : ' is-neutral')} aria-hidden="true"
        style={abbr ? { background: getVenueBrandColor(abbr) } : undefined}>
        <span className="venue-strip-abbr">{abbr ? getStripAbbr(abbr) : ''}</span>
      </div>
      <div className="bp-card-body">
        <div className="bp-card-row">
          <span className="an-cell bp-game an-clip" title={e.game || ''}>{e.game || 'Session'}</span>
          <span className={'an-cell bp-share ' + tone(share)}>{fmtSignedCents(share)}</span>
        </div>
        <div className="bp-card-row bp-card-row--one">
          <span className="an-cell an-note an-clip" title={strip.label}>{strip.label}</span>
        </div>
        <div className="bp-card-row">
          <span className="an-cell an-note an-clip">
            {fmtDay(e.date)} · {fmtHours(e.hours)}
            {bb && <>{' · '}<span className={'bp-bb ' + bb.tone}>{bb.text}</span></>}
          </span>
          <span className="an-cell an-note an-num">{pctText}% of {fmtSignedCents(result)}</span>
        </div>
      </div>
    </li>
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
  const theme = useThemeChoice({ followDevice: true });
  const shellRef = useRef(null);
  useScrollbarAllowance(shellRef);
  const toast = useToast();
  const push = useBackerPush(token);
  const [feed, setFeed] = useState(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState('all');
  const today = useMemo(todayISO, []);
  const gridOverlay = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get('gridOverlay') === '1'; } catch { return false; }
  }, []);

  const load = useCallback(() => {
    setFailed(false);
    setFeed(null);
    fetch(`${API_URL}/backer/${token}/feed`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => setFeed(d))
      .catch(() => setFailed(true));
  }, [token]);
  useEffect(() => { load(); }, [load]);

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
    const label = view.range === 'all' ? 'Your share' : `Your share, ${RANGE_NOUN[view.range]}`;
    body = (
      <>
        <div className="bp-hero">
          <h2 className="an-cell bp-name an-clip">{name}</h2>
          {feed.stakes ? <p className="an-cell bp-stakes an-clip">{feed.stakes}</p> : null}
        </div>

        {(events.length > 0 || sum.opening !== 0) && (
          <section className="bp-total" aria-label="Running total">
            <div className="an-cell an-lbl an-lbl-3">Running total</div>
            <div className={'an-cell bp-total-val ' + tone(sum.total)}>{fmtSignedCents(sum.total)}</div>
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
                </>
              ) : `Opening balance · no sessions yet`}
            </div>
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

            <section className="bp-sessions" aria-labelledby="bp-sessions-h">
              <div className="bp-section-head">
                <h3 className="an-cell an-sec" id="bp-sessions-h">Sessions</h3>
                <span className="an-cell an-note an-num">Newest first</span>
              </div>
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
    </div>
  );
}
