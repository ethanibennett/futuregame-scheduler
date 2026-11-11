import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import ScanTableSheet from './ScanTableSheet.jsx';
import {
  getVenueInfo, getVenueBrandColor, normaliseDate, getToday, getNow,
  formatBuyin, haptic, fmtShortDate,
  parseTournamentTime, parseDateTimeInTz, parseDateTime, parseLateRegEnd, lateRegCtx, lateRegCloseOf,
  getMaxEntries, getVenueTzAbbr, getVenueCoords,
  estimateBlindLevel, formatChips,
  CURRENCY_CONFIG, splitEventStage,
} from '../utils/utils.js';
import { API_URL } from '../utils/api.js';
import { homeCurrency, playingEnded } from '../utils/home.js';
import { gridGeom } from '../utils/grid-panel.js';
import { resolveConditions, offLast, planKind, openBags } from '../utils/home-upnext.js';
import useLiveCashSession from '../hooks/useLiveCashSession.js';
import useDisplayCurrency from '../hooks/useDisplayCurrency.js';
import HomeCashCard from './HomeCashCard.jsx';
import HomeFriends from './HomeFriends.jsx';
import TableScanner from './TableScanner.jsx';
import HomeNothingNext from './HomeNothingNext.jsx';
import HomeToLog from './HomeToLog.jsx';
import HomeLastResult from './HomeLastResult.jsx';
import useHomeNumbers from './HomeNumbers.jsx';
import HomeBankrollLine from './HomeBankrollLine.jsx';
import HomePeriod from './HomePeriod.jsx';
import LateRegBar from './LateRegBar.jsx';
import { resolve as resolveLayout, bankrollAbovePeriod } from '../utils/home-layout.js';
import { useLiveClocks, liveView, clockStartMs as clockStartFrom, clockRegEnd, clockFieldLabel, lateRegOver, isCompleted } from '../utils/live-clocks.js';
import { hasVenueMap, venueRoomName } from '../utils/venue-place.js';
import { openVenueMap } from '../utils/venue-map/open.js';
import './home.css';

// ── Format event name: the stage of a multi-flight event goes underneath ──
// splitEventStage is shared with CalendarEventRow and mirrors the server's
// normaliser; the regex that used to live here required the token to be
// dash-separated and last, which 259 of 1,000 stored titles are not.
function formatEventName(name) {
  const { base, stage } = splitEventStage(name);
  if (!stage) return name;
  return (
    <>
      {base}
      <br />
      <span className="dash-event-stage">{stage}</span>
    </>
  );
}

// ── Mini Late Reg Bar ──
function MiniLateRegBar({ lateRegEnd, date, time, openOnly, venue, startAt, completed, levelMin = null, reentry = null }) {
  const [now, setNow] = useState(getNow());
  useEffect(() => {
    const id = setInterval(() => setNow(getNow()), 30000);
    return () => clearInterval(id);
  }, []);

  if (completed) {
    if (openOnly) return null;
    return <div className="mini-late-reg closed"><span className="mini-late-reg-label event-completed-label">Event Completed</span></div>;
  }

  if (date || startAt) {
    const startMs = startAt ?? (venue ? parseDateTimeInTz(date, time, venue) : parseDateTime(date, time || '12:00 AM'));
    if (now < startMs) {
      if (openOnly) return null;
      return (
        <div className="mini-late-reg pending">
          <span className="mini-late-reg-label pending">Until Start</span>
        </div>
      );
    }
  }
  if (!lateRegEnd) return null;
  const endMs = parseLateRegEnd(lateRegEnd, date, venue, lateRegCtx({ date, time, venue, level_duration: levelMin, reentry }));
  if (isNaN(endMs)) return null;
  const diffMs = endMs - now;
  if (diffMs <= 0) {
    if (openOnly) return null;
    return <div className="mini-late-reg closed"><span className="mini-late-reg-label closed">Reg Closed</span></div>;
  }
  const diffMin = Math.floor(diffMs / 60000);
  const status = diffMin < 30 ? 'urgent' : diffMin < 120 ? 'soon' : 'open';
  const h = Math.floor(diffMin / 60); const m = diffMin % 60;
  const timeLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return (
    <div className={`mini-late-reg ${status}`}>
      <span className={`mini-late-reg-label ${status}`}>Reg: {timeLabel}</span>
    </div>
  );
}


// Friends Playing and Connections left the home (verdict "placement"): they live in Social, one
// tap from the tab bar. The Table Scanner left it too: it is the Playing card's Scan action now,
// and a tool in Hands.
export default function DashboardView({
  mySchedule, myActiveUpdates, trackingData, onPost, onDeleteUpdate,
  onAddTracking, onNavigate, tournaments, onToggle,
  onOpenInSchedule, demoStates = false, demoCard = false,
  updatesFailed = false, onRetryUpdates = null,
  homeRight = null, // desktop: the second pane's element, which the NUMBERS column portals into
  // The Friends section (an Edit home option): the people sharing with this account, their latest
  // live updates, and who is on which event (App fetches all three for Schedule and Social anyway).
  shareBuddies = null, buddyLiveUpdates = null, buddyEvents = null,
  // Step 3 (To log, Last result): admin gating for the cash/expense paths, the token for the
  // admin-only cash-sessions read, whether this account can log at all (guests cannot), the
  // route into Results' forms (App's resultsIntent) and the "Didn't play" flag.
  isAdmin = false, token = null, canLog = true, onLog = null, onSetPlayed = null, onDeleteTracking = null,
  // Step 4: App's useBankrolls (the summary the Results tab shares) for the bankroll line and the
  // period block. Admins only; for everyone else it is disabled and fetches nothing.
  bk = null,
  // Edit home (utils/home-layout.js): the user's layout (null = the default home), whether the app
  // is in its desktop layout (each section then keeps its pane), and the opener of the Edit home
  // sheet (App; null for a guest, who gets the default home and no control).
  layout = null, isDesktop = false, onEditHome = null,
}) {
  const [selectedUpNextIdx, setSelectedUpNextIdx] = useState(0);
  // Scan table: the screenshot picked from a Playing card, while its sheet is open.
  const [scanFile, setScanFile] = useState(null);
  const scanInputRef = useRef(null);
  const [now, setNow] = useState(getNow());
  // The shared display currency (the Results tab's setting), never Native here: a total of euros
  // and dollars is in no currency (utils/home.js). The home has no currency menu of its own, and
  // follows a change made in Results at once (hooks/useDisplayCurrency.js), not on the next reload.
  const storedCurrency = useDisplayCurrency();
  const dashCurrency = useMemo(() => homeCurrency(storedCurrency, Object.keys(CURRENCY_CONFIG)), [storedCurrency]);
  const [dashRates, setDashRates] = useState(null);
  useEffect(() => {
    fetch(API_URL + '/exchange-rates')
      .then(r => r.json())
      .then(data => { setDashRates(data.rates); })
      .catch(() => { setDashRates({ EUR:0.91, GBP:0.79, CAD:1.36, AUD:1.53, JPY:149.5, USD:1 }); });
  }, []);
  const rebuyingRef = useRef(false);
  const [bustMenuEventId, setBustMenuEventId] = useState(null);

  // Smooth swipe handling for carousel
  const swipeRef = useRef(null);
  const swipeStart = useRef(null);
  const swipeDx = useRef(0);
  const trackRef = useRef(null);
  // The home scrolls now, so a vertical drag that starts on a card is the page's: the first 1r of
  // movement decides the gesture, and a vertical one leaves the carousel where it is (pan-y).
  // (1r is read off the grid once, in px, because touch coordinates are px.)
  const swipeStartY = useRef(0);
  const swipeAxis = useRef(null);
  const swipeSlop = useRef(0);
  // The track's height (home.css): the card on show, in whole r; during a drag, the taller of it and
  // the neighbour being pulled in. fit.shown / fit.peer are slide indexes; fitTrack() measures them.
  // fit.frozen: a mouse is over the dots or the counter. The track then grows but never shrinks, so
  // the ‹ › under the pointer stays put while it clicks through shorter cards, and a taller card is
  // never cut (it pushes the pager down once); when the pointer leaves, the track eases to the card
  // on show. (It used to hold the height outright, and a taller card was clipped through its stats
  // with its Bust and Bag row hidden under the pager until the pointer left.)
  const fit = useRef({ shown: 0, peer: null, rPx: 0, frozen: false });
  const fitTrack = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const f = fit.current;
    if (!f.rPx) {
      // r as layout resolves --subrow (WebKit snaps it to 1/64 px: 7.71875 at 402 wide, where
      // 0.71g is 7.7141), read off a 100r probe, so a 23r card reads 23.000, not 23.014.
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
      document.body.appendChild(probe);
      f.rPx = probe.getBoundingClientRect().height / 100;
      probe.remove();
    }
    // Every card is whole r tall; its measured height (px, as layout gives it) back in r, rounded
    // up past a tenth so a card that is not whole r is never cut short.
    const rOf = (i) => {
      const el = i != null ? track.children[i] : null;
      return el && f.rPx ? Math.ceil(el.getBoundingClientRect().height / f.rPx - 0.1) : 0;
    };
    const n = Math.max(rOf(f.shown), rOf(f.peer));
    if (!(n > 0)) return;
    // Held (a mouse on the pager): grow to a taller card, keep the height for a shorter one.
    const held = f.frozen && track.classList.contains('is-fitted') ? Number(track.style.getPropertyValue('--track-r')) || 0 : 0;
    track.style.setProperty('--track-r', String(Math.max(n, held)));
    track.classList.add('is-fitted');
  }, []);
  // The dots' and the counter's hover: hold the height while a mouse (or pen) is over them.
  const holdFit = useCallback((e) => {
    if (e.pointerType === 'touch') return;
    fit.current.frozen = true;
    fitTrack();
  }, [fitTrack]);
  const releaseFit = useCallback(() => {
    if (!fit.current.frozen) return;
    fit.current.frozen = false;
    fitTrack();
  }, [fitTrack]);
  useEffect(() => {
    const onResize = () => { fit.current.rPx = 0; swipeSlop.current = 0; fitTrack(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitTrack]);
  const onTouchStart = useCallback((e) => {
    swipeStart.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
    swipeAxis.current = null;
    if (!swipeSlop.current) swipeSlop.current = gridGeom().R;
    swipeDx.current = 0;
    if (trackRef.current) trackRef.current.classList.add('swiping');
  }, []);
  const onTouchMove = useCallback((e) => {
    if (swipeStart.current === null) return;
    const dx = e.touches[0].clientX - swipeStart.current;
    if (!swipeAxis.current) {
      const dy = e.touches[0].clientY - swipeStartY.current;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < swipeSlop.current) return;
      swipeAxis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (swipeAxis.current === 'y') {
        swipeStart.current = null;
        if (trackRef.current) trackRef.current.classList.remove('swiping');
        return;
      }
    }
    swipeDx.current = dx;
    // The neighbour coming in: the track grows to it if it is taller, so it never covers the dots.
    const f = fit.current, len = swipeRef.current || 1;
    const peer = dx < 0 ? (f.shown + 1 < len ? f.shown + 1 : null) : (f.shown > 0 ? f.shown - 1 : null);
    if (peer !== f.peer) { f.peer = peer; fitTrack(); }
    // The drag moves the whole track; each slide keeps its own offset from the one shown.
    if (trackRef.current) {
      const pct = (dx / trackRef.current.parentElement.offsetWidth) * 100;
      trackRef.current.style.transform = `translateX(${pct}%)`;
    }
  }, []);
  const onTouchEnd = useCallback((e) => {
    if (swipeStart.current === null) return;
    const dx = swipeDx.current;
    swipeStart.current = null;
    // Back to the card on show (a page turn re-fits to the new one as it renders).
    if (fit.current.peer != null) { fit.current.peer = null; fitTrack(); }
    if (trackRef.current) {
      trackRef.current.classList.remove('swiping');
      // Back to rest, animated: on a page turn the slides' own offsets animate at the same time with
      // the same curve, so the two add up to one smooth move to the next card.
      trackRef.current.style.transform = 'translateX(0%)';
    }
    const threshold = 40;
    if (Math.abs(dx) < threshold) return;
    setSelectedUpNextIdx(i => {
      const len = swipeRef.current || 1;
      return dx < 0 ? Math.min(i + 1, len - 1) : Math.max(i - 1, 0);
    });
  }, [fitTrack]);

  useEffect(() => {
    const id = setInterval(() => setNow(getNow()), 1000);
    return () => clearInterval(id);
  }, []);

  const todayISO = getToday();
  const nowTen = Math.floor(now / 600000);

  // The plans on the schedule, resolved (verdict §1(a); utils/home-upnext.js): "If bust #12" turns
  // on once #12 is over, a branch whose parent went the other way is off ("Off: busted #12"),
  // dims and sorts last. Read from what the app already has: the results (a satellite's cash is
  // its seat), the latest live update per event, and the feed to name a parent off the schedule.
  // PROFIT_THRESHOLD ("If up $X") keeps its label and is never evaluated (owner, 2026-10-12).
  const resolvedPlans = useMemo(
    () => resolveConditions(mySchedule, myActiveUpdates, trackingData, { events: tournaments, startOf: parseTournamentTime }),
    [mySchedule, myActiveUpdates, trackingData, tournaments]);

  // The running cash session (admins, the cash beta): it takes the first card (§1(b)), and the bar
  // over the nav (LiveCashBar) stays off the home. The store is shared with that bar and the Cash
  // view, so a stack update here moves them too.
  const { session: cashSession, stacks: cashStacks, skew: cashSkew } = useLiveCashSession({ enabled: !!(isAdmin && token), token });

  // Build bagged events from previous days: the bags still open (utils/home-upnext.js openBags). A
  // result is final, as resolveConditions and To log read it, so a bag whose result is logged is
  // over. It used to stay a 'Bagged — Day 1' card for good, and while it stayed, today's other
  // events were marked conditional on it.
  const baggedEvents = useMemo(() => {
    return [...openBags(myActiveUpdates, trackingData)]
      .map(([tid, update]) => {
        const t = (mySchedule || []).find(x => x.id === tid) || (tournaments || []).find(x => x.id === tid);
        if (!t) return null;
        return { ...t, _bagUpdate: update, _type: 'bagged' };
      })
      .filter(Boolean);
  }, [myActiveUpdates, mySchedule, tournaments, trackingData]);

  // Today's events from user schedule
  const todayEvents = useMemo(() => {
    return (mySchedule || [])
      .filter(t => normaliseDate(t.date) === todayISO && t.venue !== 'Personal' && !t.is_restart)
      .map(t => {
        const isBagged = baggedEvents.some(b => b.id === t.id);
        if (isBagged) return null;
        // A plan that came on makes the event a plain one; one still waiting, or off, conditional.
        return { ...t, _type: planKind(t, resolvedPlans) };
      })
      .filter(Boolean);
  }, [mySchedule, todayISO, baggedEvents, resolvedPlans]);

  // Active previous-day events
  const activePrevDayEvents = useMemo(() => {
    const todayIds = new Set((mySchedule || []).filter(t => normaliseDate(t.date) === todayISO).map(t => t.id));
    const baggedIds = new Set(baggedEvents.map(b => b.id));
    return (myActiveUpdates || [])
      .filter(u => !u.is_busted && !u.is_bagged && !todayIds.has(u.tournament_id) && !baggedIds.has(u.tournament_id))
      .map(u => {
        const t = (mySchedule || []).find(x => x.id === u.tournament_id) || (tournaments || []).find(x => x.id === u.tournament_id);
        if (!t) return null;
        // A run that cannot still be going (the forgotten bust: utils/home.js playingEnded) is To
        // log's to ask about, not a Currently Playing card. An update posted in the last 18 h keeps
        // it here whatever its day (nowTen: the clock, in 10-minute steps).
        if (playingEnded(t, u, todayISO, nowTen * 600000)) return null;
        return { ...t, _type: 'normal' };
      })
      .filter(Boolean);
  }, [myActiveUpdates, mySchedule, tournaments, todayISO, baggedEvents, nowTen]);

  // Combined "What's Next" list
  const whatsNextEvents = useMemo(() => {
    // Dev-only fixtures for grid measurement on iOS. The admin "D" toggle
    // (demoStates) injects the conditional card states — playing, busted,
    // expanded stats — that Ethan's all-future schedule never renders, so the
    // grid overlay can measure them in the native app. The ?democard URL path
    // stays as the single seated anchor card (safaridriver use) — App passes it
    // in as demoCard, admin-gated: read here directly, any visitor's URL could
    // replace their real Up Next with a fake event.
    const demo = demoStates || demoCard;
    if (demo) {
      const mk = (o) => {
        const d = new Date(); d.setDate(d.getDate() + (o.days ?? 11));
        return {
          id: o.id, event_name: o.name, buyin: o.buyin ?? 500, venue: 'WSOP.COM',
          date: d.toISOString().slice(0, 10), time: o.time ?? '18:30',
          _type: o._type ?? 'anchor', _future: (o.days ?? 11) > 0,
          prize_pool: o.prize_pool ?? null, game_variant: 'PLO', starting_chips: 20000,
          level_duration: o.level_duration ?? null, late_reg_end: o.late_reg_end ?? null,
          reentry: o.reentry,
        };
      };
      if (!demoStates) return [mk({ id: 'demo-1', name: 'PLO 6-Max' })];
      // Playing (badge + action buttons + stats), busted (rebuy/finished),
      // a long 2-line name to exercise the wrap seat, and a seated anchor.
      return [
        mk({ id: 'demo-playing', name: 'PLO 6-Max', days: -1, time: '12:00', level_duration: '40 min' }),
        mk({ id: 'demo-busted', name: 'NLH Mystery Bounty', days: -1, time: '12:00', level_duration: '40 min', reentry: 'unlimited' }),
        mk({ id: 'demo-stats', name: 'PLO $200K GTD Mystery Bounty 6-Max', days: -1, time: '12:00', level_duration: '40 min' }),
        mk({ id: 'demo-anchor', name: 'PLO 6-Max', days: 11 }),
      ];
    }
    const events = [...baggedEvents, ...activePrevDayEvents];
    // Only a bag that restarts TODAY makes today's other events conditional on it (UX pick 37): one that
    // restarts tomorrow used to dash every event of today as "Conditional on bag".
    const bagRestartsToday = baggedEvents.some(b => (tournaments || []).some(t =>
      t.is_restart && t.parent_event === b.event_number && normaliseDate(t.date) === todayISO));
    if (bagRestartsToday) {
      // With a bag to come back to, today's other events are conditional on it — unless an event
      // carries its own plan, which says (or will say) for itself whether it is on.
      events.push(...todayEvents.map(t => (resolvedPlans.has(Number(t.id)) ? t : {
        ...t,
        _type: t._type === 'anchor' ? 'anchor' : 'conditional',
        _conditionalOnBag: true,
      })));
    } else {
      events.push(...todayEvents);
    }
    const typeOrder = { bagged: 0, anchor: 1, normal: 2, conditional: 3 };
    /* Within a type, by when the event STARTS — an absolute instant, not the clock time in
       its own room: 4:00 PM EDT comes before 2:00 PM PDT (5:00 PM EDT). The type sort alone
       left them in the server's order, which compares times as text ("10:00 AM" < "2:00 PM"
       < "4:00 PM" whatever the zone). */
    const startOf = new Map(events.map(e => [e, parseTournamentTime(e)]));
    const at = (e) => { const v = startOf.get(e); return Number.isFinite(v) ? v : Infinity; };
    events.sort((a, b) => ((typeOrder[a._type] || 2) - (typeOrder[b._type] || 2)) || (at(a) - at(b)));

    // Everything still to come, appended after today's in date order, so the
    // carousel swipes through the whole schedule. Today keeps its priority
    // ordering at the front — what is live or bagged stays the first card.
    const seen = new Set(events.map(e => e.id));
    const later = (mySchedule || [])
      .filter(t => !seen.has(t.id)
        && normaliseDate(t.date) > todayISO
        && t.venue !== 'Personal'
        && !t.is_restart)
      .map(t => ({
        ...t,
        _type: planKind(t, resolvedPlans),
        _future: true,
      }))
      .sort((a, b) => {
        const ta = a.venue ? parseDateTimeInTz(a.date, a.time, a.venue) : parseDateTime(a.date, a.time);
        const tb = b.venue ? parseDateTimeInTz(b.date, b.time, b.venue) : parseDateTime(b.date, b.time);
        return ta - tb;
      });

    // A plan that is off (its parent went the other way) goes to the very end, dimmed.
    return offLast([...events, ...later], resolvedPlans);
  }, [baggedEvents, activePrevDayEvents, todayEvents, mySchedule, todayISO, demoStates, demoCard, resolvedPlans, tournaments]);

  // The carousel's slides: the running cash session's card first (admins), then the events.
  const showCash = !!cashSession && !demoStates && !demoCard;
  const slides = useMemo(
    () => (showCash ? [{ id: `cash-${cashSession.id}`, _cash: true }, ...whatsNextEvents] : whatsNextEvents),
    [showCash, cashSession, whatsNextEvents]);

  const [numbersReady, setNumbersReady] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setNumbersReady(true)); return () => cancelAnimationFrame(id); }, []);
  // The card's More menu (UX pick 41): { id, top, right } while open.
  const [moreMenu, setMoreMenu] = useState(null);
  // One title for every card (UX pick 36): it flipped between Today, Tomorrow and Up Next as you paged.
  const upNextTitle = 'Up Next';
  const prevUpNextTitle = useRef(upNextTitle);
  const [upNextTitleOut, setUpNextTitleOut] = useState(null); // { text, key } while fading out
  useLayoutEffect(() => {
    const prev = prevUpNextTitle.current; // read now: the updater below runs after the ref moves on
    if (prev === upNextTitle) return;
    setUpNextTitleOut(o => ({ text: prev, key: (o ? o.key : 0) + 1 }));
    prevUpNextTitle.current = upNextTitle;
  }, [upNextTitle]);

  /* Live tournament clocks (server: lib/live-clocks.js). For every selected event that has
     passed its scheduled start, ask for the real clock — PokerAtlas by the event's own clock id,
     Bravo by the room at the venue's coordinates — every 15 s, which is the rate Bravo's own app
     polls at. The stats and late-reg bar use it in place of estimateBlindLevel() when it answers;
     an event with no clock, or whose clock has not started, keeps the estimate and its "Until
     Start" countdown to the scheduled time. Keyed by the id list so the poll restarts only when
     the set of started events changes, not every second. */
  const nowMinute = Math.floor(now / 60000);
  const clockTargetsKey = useMemo(() => {
    if (demoStates) return '';
    const DAY = 24 * 60 * 60 * 1000;
    return JSON.stringify(whatsNextEvents
      .filter(e => e._type !== 'bagged' && Number.isInteger(e.id) && !e.is_online && !e.clock_ended_at) // online rooms have no Bravo/Atlas clock; a completed event is done asking
      .filter(e => {
        const s = parseTournamentTime(e), t = nowMinute * 60000;
        if (s <= t) return t - s < DAY;
        // A PokerAtlas clock is worth asking for before the start too: the room's own countdown
        // replaces the published time when it has one.
        return !!e.clock_ref && s - t < 6 * 60 * 60 * 1000;
      })
      .slice(0, 40)
      .map(e => { const c = getVenueCoords(e.venue, e.property); return { id: e.id, lat: c?.lat, lng: c?.lng, startMs: parseTournamentTime(e) }; }));
  }, [whatsNextEvents, nowMinute, demoStates]);
  // Shared poller (utils/live-clocks.js): a schedule card showing the same event costs nothing more.
  const liveClocks = useLiveClocks(clockTargetsKey ? JSON.parse(clockTargetsKey) : [], clockTargetsKey);

  // Seat multi-line hero event names on the grid. The name's text is a trimmed
  // block (.dash-t: cap-top .. last baseline) bottom-aligned in a cell of whole
  // 3r lines, so its last baseline sits on the cell's bottom r-line. An explicit
  // "- Day 1" <br> is caught by :has(br) → 6r, but a name that WRAPS on width
  // carries no <br>, and CSS can't count wrapped lines. The trimmed block is
  // (lines − 1) × 3r + one cap height (1.815r for --fs-lg display, < 3r), so
  // ceil(height / 3r) is exactly the line count. Runs after layout, before paint.
  // --subrow is a calc() string on :root, so read r from the grid unit instead:
  // r = 0.71g, g = innerWidth / 37 (capped at 430, as --gu is).
  useLayoutEffect(() => {
    const subrow = (Math.min(window.innerWidth, 430) / 37) * 0.71;
    if (!subrow) return;
    document.querySelectorAll(
      '.dash-event-card.playing .dash-event-name, .dash-event-card.next-up .dash-event-name, .dash-event-card.manually-expanded .dash-event-name'
    ).forEach((el) => {
      const text = el.querySelector('.dash-t');
      if (!text) return;
      const lines = Math.max(1, Math.ceil(text.getBoundingClientRect().height / (subrow * 3) - 0.01));
      el.style.minHeight = `calc(var(--subrow) * ${lines * 3})`;
    });
  }, [slides, selectedUpNextIdx]);

  // The carousel's height follows the card on show (home.css "HEIGHT"): fitted before paint on a
  // page turn or a new set of slides, and whenever any slide's own height changes (the Bust menu, a
  // live clock arriving, the cash card's stack entry), via one observer, whose notes land after
  // layout and before paint too.
  const shownIdx = slides.length ? Math.min(selectedUpNextIdx, slides.length - 1) : 0;
  const slideKey = slides.map((x) => x.id).join('|');
  // A new set of slides can swap the counter for the dots (or the reverse) under the pointer, and a
  // control that unmounts never gets its pointerleave: start unheld.
  useLayoutEffect(() => { fit.current.frozen = false; }, [slideKey]);
  useLayoutEffect(() => {
    fit.current.shown = shownIdx;
    fitTrack();
  }, [shownIdx, slideKey, fitTrack]);
  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => fitTrack());
    for (const el of track.children) ro.observe(el);
    return () => ro.disconnect();
  }, [slideKey, fitTrack]);

  // Next upcoming event (when nothing today)
  function parseLevelDuration(t) {
    if (!t.level_duration) return null;
    const match = t.level_duration.match(/(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  // The helpers live in utils/live-clocks.js, shared with the schedule cards.
  const clockStartMs = (t) => clockStartFrom(liveClocks[t.id]);
  const liveClockFor = (t) => liveView(liveClocks[t.id]);

  function effectiveLateRegEnd(t) {
    return clockRegEnd(t, liveClockFor(t)) || t.late_reg_end;
  }

  function isLateRegClosed(t) {
    const end = effectiveLateRegEnd(t);
    if (!end) return false;
    const endMs = lateRegCloseOf(t, end);
    return !isNaN(endMs) && now > endMs;
  }

  // Active event map
  const activeEventMap = useMemo(() => {
    const map = {};
    (myActiveUpdates || []).forEach(u => {
      if (!u.is_busted && !u.is_bagged) map[u.tournament_id] = u;
    });
    if (demoStates) map['demo-playing'] = { tournament_id: 'demo-playing', stack: '42000', is_busted: 0, is_bagged: 0 };
    return map;
  }, [myActiveUpdates, demoStates]);

  // Busted event map
  const bustedEventMap = useMemo(() => {
    const map = {};
    (myActiveUpdates || []).forEach(u => {
      if (u.is_busted) map[u.tournament_id] = u;
    });
    if (demoStates) map['demo-busted'] = { tournament_id: 'demo-busted', is_busted: 1, bust_count: 1 };
    return map;
  }, [myActiveUpdates, demoStates]);

  const hasActivePlaying = useMemo(() =>
    whatsNextEvents.some(e => !!activeEventMap[e.id]),
    [whatsNextEvents, activeEventMap]
  );

  const nextUpEventId = useMemo(() => {
    if (hasActivePlaying) return null;
    const nextUp = whatsNextEvents.find(e =>
      e._type !== 'bagged' && !bustedEventMap[e.id]
    );
    return nextUp?.id || null;
  }, [whatsNextEvents, hasActivePlaying, bustedEventMap]);

  // Auto-advance carousel when current event finishes
  const prevBustedRef = useRef(new Set());
  useEffect(() => {
    if (rebuyingRef.current) return;
    const curBusted = new Set(Object.keys(bustedEventMap).map(Number));
    const prev = prevBustedRef.current;
    if (slides.length > 1) {
      const safeIdx = Math.min(selectedUpNextIdx, slides.length - 1);
      const current = slides[safeIdx];
      if (current && !current._cash && curBusted.has(current.id) && !prev.has(current.id)) {
        const nextIdx = slides.findIndex((e, i) => i !== safeIdx && !e._cash && !curBusted.has(e.id));
        if (nextIdx >= 0) setSelectedUpNextIdx(nextIdx);
      }
    }
    prevBustedRef.current = curBusted;
  }, [bustedEventMap, slides, selectedUpNextIdx]);

  // Render a single event card
  function renderEventCard(event) {
    const clockStart = clockStartMs(event);
    const startMs = clockStart ?? parseTournamentTime(event);
    const started = now >= startMs;
    const regClosed = isLateRegClosed(event);
    const levelDuration = parseLevelDuration(event);
    const live = started ? liveClockFor(event) : null;
    const blindInfo = live
      ? { level: live.level, sb: live.sb, bb: live.bb, ante: live.ante,
          remainingMin: Math.floor(live.remaining / 60), remainingSec: live.remaining % 60,
          live: true, onBreak: live.onBreak, paused: live.state === 'paused', stale: !!live.stale }
      : (started && levelDuration ? estimateBlindLevel(startMs, levelDuration) : null);
    const startingChips = event.starting_chips || 20000;

    const currentStack = (activeEventMap[event.id]?.stack) ? Number(activeEventMap[event.id].stack) : startingChips;
    const stackUnknown = updatesFailed && !activeEventMap[event.id];
    const bbCount = blindInfo ? Math.floor(currentStack / blindInfo.bb) : null;
    const isCurrentlyPlaying = !!activeEventMap[event.id];
    const isExpanded = true;
    const isConditionalOnPlaying = !isCurrentlyPlaying && hasActivePlaying && event._type !== 'bagged';
    const bustedUpdate = bustedEventMap[event.id];
    const isBustedDone = bustedUpdate && (bustedUpdate.bust_count || 1) >= getMaxEntries(event.reentry);
    // The room's clock showed it finished: dimmed like a busted-out card, "Event Completed" below.
    const completed = isCompleted(event, liveClocks[event.id]);
    // The room's clock and the player (App improvements 105, 106): the room says it ended while the player's
    // last word is neither a bust nor a bag, so the card asks how it went; or the player started and the
    // room's clock has not, so the card says registered, with the stack posted, not "playing".
    const roomClock = liveClocks[event.id] || null;
    const lastUpd = activeEventMap[event.id];
    const askEnded = !!roomClock && roomClock.state === 'ended' && !!lastUpd && !lastUpd.is_busted && !lastUpd.is_bagged && event._type !== 'bagged';
    const roomNotStarted = !!roomClock && roomClock.state === 'not-started' && !!lastUpd;

    const venueInfo = getVenueInfo(event.venue, event.property);
    const venueColor = getVenueBrandColor(venueInfo.abbr);
    const venueStripText = '#ffffff'; // venue strip text is always white
    // Its plan, resolved: each condition a tag ('If bust #12', 'On: busted #12', 'Off: bagged #14',
    // 'If up $5,000'). A plan that is off dims the card, all but those tags, which say why.
    const plan = resolvedPlans.get(Number(event.id)) || null;
    const planOff = !!plan && plan.state === 'off';

    const cardClass = [
      'dash-event-card',
      planOff ? 'plan-off' : '',
      isBustedDone ? 'done' : (completed && !askEnded ? 'completed' : ''),
      event._type === 'bagged' ? 'bagged' : '',
      event._type === 'anchor' && !isConditionalOnPlaying ? 'anchor' : '',
      isConditionalOnPlaying ? 'conditional' : '',
      isCurrentlyPlaying ? 'playing' : 'next-up',
      regClosed && event._type !== 'bagged' ? 'reg-closed' : '',
    ].filter(Boolean).join(' ');

    // Status tags above the name. Built as a list so the row is rendered only when
    // it has something in it: an empty flex row still took the content's 1r gap.
    // [class, label, title?, key?]. A plan's tags show on a card dimmed behind the event being
    // played too: which branch is on is exactly what is worth knowing mid-session.
    const tags = [];
    if (!isConditionalOnPlaying) {
      if (event._type === 'bagged') tags.push(['bagged', `Bagged — Day ${event._bagUpdate?.bag_day || '?'}`]);
      if (event._type === 'anchor' && !event._conditionalOnBag) tags.push(['anchor', 'Locked In']);
      if (event._type === 'conditional' && !plan) tags.push(event._conditionalOnBag ? ['conditional on-bag', 'Conditional on bag'] : ['conditional', 'Conditional']);
    }
    if (plan) plan.items.forEach((it, i) => tags.push([`plan snap-g is-${it.state}`, it.label, it.title, `plan-${i}`]));
    if (!isConditionalOnPlaying && regClosed && event._type !== 'bagged') tags.push(['reg-closed', 'Reg Closed']);

    const activeUpdate = activeEventMap[event.id];
    const liveStack = activeUpdate?.stack;
    const stackBB = blindInfo && liveStack ? Math.floor(liveStack / blindInfo.bb) : null;

    // Tapping the card opens this event in My Schedule, expanded. Guarded on
    // swipeDx so finishing a carousel drag over the card does not navigate —
    // the drag distance is reset on every touchstart, so a genuine tap reads 0.
    const openInSchedule = (e) => {
      if (Math.abs(swipeDx.current || 0) > 10) return;
      // A tap on one of the card's own controls (Bust, Update, Bag, Finish,
      // Cancel, Rebuys...) is that control's, not "open this event": it used
      // to bubble here and jump the user to My Schedule mid-action.
      if (e && e.target !== e.currentTarget && e.target.closest('button, input, select, textarea, a, label')) return;
      if (onOpenInSchedule) onOpenInSchedule(event.id);
    };

    return (
      <div
        key={event.id}
        className={cardClass}
        role={onOpenInSchedule ? 'button' : undefined}
        tabIndex={onOpenInSchedule ? 0 : undefined}
        /* Raw name, not formatEventName — that returns JSX for "… - Flight A"
           names, which stringifies to [object Object] in an attribute. */
        aria-label={onOpenInSchedule ? `Open ${event.event_name} in My Schedule` : undefined}
        onClick={onOpenInSchedule ? openInSchedule : undefined}
        onKeyDown={onOpenInSchedule ? (e) => {
          // Only when the card itself has focus; Enter on an inner button is that button's.
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInSchedule(); }
        } : undefined}
      >
        {/* The Up Next banner shows the FULL venue name, never the strip
            abbreviation — abbr stays only for the brand colour + WSOP casing.
            At a real room it is a button that opens the venue map (utils/venue-map/open.js); the
            card's own tap ignores taps on buttons, so it does not also open My Schedule. */}
        {hasVenueMap(event) ? (
          <button
            type="button"
            className="dash-venue-strip has-map"
            style={{background: venueColor, color: venueStripText}}
            aria-haspopup="dialog"
            aria-label={`Show ${venueRoomName(event)} on a map`}
            onClick={(e) => { e.stopPropagation(); openVenueMap(event, e.currentTarget); }}
          ><span className="dash-t">{venueInfo.longName || venueInfo.abbr}</span></button>
        ) : (
          <div className="dash-venue-strip" style={{background: venueColor, color: venueStripText}}><span className="dash-t">{venueInfo.longName || venueInfo.abbr}</span></div>
        )}
        <div className="dash-card-content" style={isConditionalOnPlaying ? {borderColor: venueInfo.abbr === 'WSOP' ? 'var(--venue-wsop-cond)' : venueColor} : undefined}>
        {tags.length > 0 && (
          <div className="dash-event-tags">
            {tags.map(([cls, label, title, key]) => (
              <span key={key || cls} className={`dash-event-tag ${cls}`} title={title}><span className="dash-t">{label}</span></span>
            ))}
          </div>
        )}

        <div className="dash-event-header">
          <div className="dash-event-title">
            <div className="dash-event-name"><span className="dash-t">{formatEventName(event.event_name)}</span></div>
            {!isConditionalOnPlaying && (
              <div className="dash-event-meta">
                {/* The carousel now runs the whole schedule, so a card can be
                    weeks out — time alone would be ambiguous. */}
                {normaliseDate(event.date) !== todayISO && (
                  <span><Icon.calendar /><span className="dash-t">{fmtShortDate(normaliseDate(event.date))}</span></span>
                )}
                <span><Icon.clock /><span className="dash-t">{event.time || 'TBD'}{event.venue ? ' ' + getVenueTzAbbr(event.venue, event.date) : ''}</span></span>
              </div>
            )}
          </div>
          <div className="dash-event-buyin"><span className="dash-t">{formatBuyin(event.buyin, event.venue)}</span></div>
          {onToggle && (
            <button className="dash-undo-x muted dash-more-btn" aria-haspopup="menu" aria-label="More for this event"
              onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMoreMenu({ id: event.id, top: r.bottom, right: window.innerWidth - r.right }); }}
              title="More">
              {/* Three drawn dots, centred by the box: the \u22EF glyph sat 1px under the middle. */}
              <svg className="dash-more-dots" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            </button>
          )}
        </div>

        {/* A bagged event is stopped: its boxes read the bag, its size in big blinds at the level it was
            bagged, and when it restarts, not a running clock (UX pick 37). */}
        {isExpanded && event._type === 'bagged' && event._bagUpdate && Number(event._bagUpdate.stack) > 0 && (() => {
          const bu = event._bagUpdate;
          const bag = Number(bu.stack);
          const bagBb = Number(bu.bb) || 0;
          const restartT = (tournaments || []).find(t => t.is_restart && t.parent_event === event.event_number && normaliseDate(t.date) > normaliseDate(event.date));
          const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const rd = restartT ? normaliseDate(restartT.date) : null;
          const restartLabel = restartT ? `${WD[new Date(rd + 'T12:00:00').getDay()]} ${(restartT.time || '').replace(':00 ', ' ')}` : '\u2014';
          return (
            <div className="dash-event-stats">
              <div className="dash-stat-box">
                <div className="dash-stat-value">{bag.toLocaleString()}</div>
                <div className="dash-stat-label">Bag</div>
              </div>
              <div className="dash-stat-box">
                <div className="dash-stat-value">{bagBb ? `${Math.floor(bag / bagBb).toLocaleString()} BB` : '\u2014'}</div>
                <div className="dash-stat-label">{bagBb ? `At ${formatChips(Number(bu.sb) || 0)}/${formatChips(bagBb)}${Number(bu.bb_ante) ? '/' + formatChips(Number(bu.bb_ante)) : ''}` : 'Big blinds'}</div>
              </div>
              <div className="dash-stat-box">
                <div className="dash-stat-value">{restartLabel}</div>
                <div className="dash-stat-label">Day {bu.bag_day || 2}</div>
              </div>
            </div>
          );
        })()}
        {isExpanded && blindInfo && !(event._type === 'bagged' && event._bagUpdate && Number(event._bagUpdate.stack) > 0) && (
          <div className="dash-event-stats">
            <div className="dash-stat-box">
              <div className="dash-stat-value">{blindInfo.ante ? `${formatChips(blindInfo.sb)}/${formatChips(blindInfo.bb)}/${formatChips(blindInfo.ante)}` : `${formatChips(blindInfo.sb)}/${formatChips(blindInfo.bb)}`}</div>
              <div className="dash-stat-label">Level {blindInfo.level}</div>
            </div>
            <div className="dash-stat-box">
              <div className="dash-stat-value">{stackUnknown ? '—' : currentStack.toLocaleString()}</div>
              <div className="dash-stat-label">{stackUnknown ? 'Stack' : bbCount ? `${bbCount} BB` : 'START STACK'}</div>
            </div>
            <div className="dash-stat-box">
              <div className="dash-stat-value">
                {blindInfo.stale ? '—' : `${blindInfo.remainingMin}:${String(blindInfo.remainingSec).padStart(2, '0')}`}
              </div>
              <div className="dash-stat-label">{blindInfo.stale ? 'No signal' : blindInfo.live ? (blindInfo.paused ? 'Paused' : blindInfo.onBreak ? 'Break' : 'Live') : 'Clock'}</div>
            </div>
          </div>
        )}
        {/* A room clock gone quiet says when it was last heard (App improvements 104), never a frozen LIVE. */}
        {isExpanded && live && live.stale && (
          <div className="dash-live-field is-stale"><span className="dash-t">Room clock last heard {Math.max(1, Math.round((now - live.heardAt) / 60000))} min ago ({new Date(live.heardAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})</span></div>
        )}
        {/* The boxes above carry the rest of the room's clock: its field, where the room publishes it. */}
        {isExpanded && live && clockFieldLabel(live, lateRegOver(event, live)) && <div className="dash-live-field"><span className="dash-t">{clockFieldLabel(live, lateRegOver(event, live))}</span></div>}

        {event._type === 'bagged' && (() => {
          const restartT = (tournaments || []).find(t =>
            t.is_restart && t.parent_event === event.event_number &&
            normaliseDate(t.date) > normaliseDate(event.date)
          );
          const undoBag = () => {
            const bu = event._bagUpdate;
            if (bu?.id && onDeleteUpdate) onDeleteUpdate(bu.id);
          };
          if (restartT) {
            const restartMs = parseTournamentTime(restartT);
            const diffMs = restartMs - now;
            if (diffMs > 0) {
              const h = Math.floor(diffMs / 3600000);
              const m = Math.floor((diffMs % 3600000) / 60000);
              return (
                <div className="dash-restart-badge">
                  <Icon.restart /><span className="dash-t">Restarts in {h > 0 ? `${h} h ${m} m` : `${m} m`}</span>
                  <button className="dash-unbag-x is-word snap-g" onClick={(e) => { e.stopPropagation(); if (confirm('Undo bag?')) undoBag(); }} title="Undo bag"><span className="dash-t">Undo</span></button>
                </div>
              );
            }
          }
          return (
            <div className="dash-restart-badge">
              <Icon.restart /><span className="dash-t">Bagged</span>
              <button className="dash-unbag-x is-word snap-g" onClick={(e) => { e.stopPropagation(); if (confirm('Undo bag?')) undoBag(); }} title="Undo bag"><span className="dash-t">Undo</span></button>
            </div>
          );
        })()}

        {event._type !== 'bagged' && (() => {
          const isActive = !!activeEventMap[event.id];
          const isBusted = !!bustedEventMap[event.id];

          if (isBusted) {
            const bustedUpd = bustedEventMap[event.id];
            const maxEntries = getMaxEntries(event.reentry);
            const usedEntries = bustedUpd?.bust_count || 1;
            const canRebuy = usedEntries < maxEntries && !regClosed;
            const nextBullet = usedEntries + 1;
            return (
              <div className="dash-status-row">
                <div className="dash-finished-badge">
                  <span className="dash-t">Finished</span>
                  <button className="dash-undo-x muted is-word snap-g" onClick={(e) => {
                    e.stopPropagation();
                    if (bustedUpd?.id && onDeleteUpdate && confirm('Undo finish? This will restore the event to playing.')) onDeleteUpdate(bustedUpd.id);
                  }} title="Undo finish"><span className="dash-t">Undo</span></button>
                </div>
                {canRebuy ? (
                  <button className="dash-rebuy-btn" onClick={() => {
                    if (onPost) {
                      onPost({
                        tournamentId: event.id,
                        stack: event.starting_chips || 20000,
                        update_text: `Bullet ${nextBullet}`,
                        playStartedAt: new Date().toISOString(),
                      });
                    }
                  }}><span className="dash-t">Re-enter · {maxEntries >= 99 ? 'unlimited' : `${maxEntries - usedEntries} left`}</span></button>
                ) : (
                  <div className="dash-no-rebuy"><span className="dash-t">All entries used</span></div>
                )}
              </div>
            );
          }

          if (isActive) {
            const activeUpd = activeEventMap[event.id];
            const bulletNum = (activeUpd?.bust_count || 0) + 1;
            const showBustMenu = bustMenuEventId === event.id;
            const maxEntries = getMaxEntries(event.reentry);
            const canRebuy = bulletNum < maxEntries && !regClosed;

            if (showBustMenu) {
              return (
                /* The two outcomes as a player says them, Cancel quiet (UX pick 40). */
                <div className="dash-status-row is-bust-menu">
                  <button className="dash-cancel-quiet" onClick={() => setBustMenuEventId(null)}><span className="dash-t">Cancel</span></button>
                  {canRebuy && (
                    <button className="dash-rebuy-btn" onClick={() => {
                      haptic(25);
                      if (onPost) {
                        rebuyingRef.current = true;
                        onPost({
                          tournamentId: event.id,
                          stack: event.starting_chips || 20000,
                          update_text: `Bullet ${bulletNum + 1}`,
                          isBusted: true,
                        });
                        setTimeout(() => {
                          onPost({
                            tournamentId: event.id,
                            stack: event.starting_chips || 20000,
                            update_text: `Re-entry — Bullet ${bulletNum + 1}`,
                            playStartedAt: new Date().toISOString(),
                          });
                          setTimeout(() => { rebuyingRef.current = false; }, 500);
                        }, 300);
                      }
                      setBustMenuEventId(null);
                    }}><span className="dash-t">Re-enter · {maxEntries >= 99 ? 'unlimited' : `${maxEntries - bulletNum} left`}</span></button>
                  )}
                  <button className="dash-bust-btn" onClick={() => {
                    haptic(25);
                    window.dispatchEvent(new CustomEvent('openLiveUpdate', {
                      detail: { tab: 'finish', tournamentId: event.id }
                    }));
                    setBustMenuEventId(null);
                  }}><span className="dash-t">Out for good</span></button>
                </div>
              );
            }

            if (askEnded) {
              const n = Number(roomClock.entries) > 0 ? ` (${Number(roomClock.entries).toLocaleString('en-US')} entries)` : '';
              const finish = () => { haptic(25); window.dispatchEvent(new CustomEvent('openLiveUpdate', { detail: { tab: 'finish', tournamentId: event.id } })); };
              return (
                <div className="dash-status-stack">
                  <p className="dash-ended-ask"><span className="dash-t">The room&rsquo;s clock says this event is over{n}. How did it go?</span></p>
                  <div className="dash-action-row dash-ended-row">
                    <button type="button" className="dash-bust-btn" onClick={finish}><span className="dash-t">Busted</span></button>
                    <button type="button" className="dash-update-btn dash-cashed-btn" onClick={finish}><span className="dash-t">Cashed</span></button>
                  </div>
                </div>
              );
            }
            const startsAt = roomNotStarted ? clockStartFrom(roomClock) : null;
            return (
              <div className="dash-status-stack">
                {roomNotStarted && (
                  <p className="dash-registered-note"><span className="dash-t">{Number(lastUpd.stack || 0).toLocaleString('en-US')} posted{startsAt ? ` · the room’s clock starts in ${Math.max(1, Math.round((startsAt - now) / 60000))} min` : ''}</span></p>
                )}
                <div className={'dash-playing-badge' + (roomNotStarted ? ' is-registered' : '')}>
                  {roomNotStarted
                    ? <span className="dash-t">Registered{startsAt ? ` · starts ${new Date(startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
                    : <><span className="dash-playing-dot" /><span className="dash-t">Currently Playing{bulletNum > 1 ? `; Bullet ${bulletNum}` : ''}</span></>}
                  <button className="dash-undo-x is-word snap-g" onClick={(e) => {
                    e.stopPropagation();
                    if (activeUpd?.id && onDeleteUpdate && confirm('Undo the start? Every update you posted for this event is removed.')) onDeleteUpdate(activeUpd.id, { all: true });
                  }} title="Undo start"><span className="dash-t">Undo</span></button>
                </div>
                <div className="dash-action-row dash-action-row--4">
                  {/* Scan table (was the home's Table Scanner section): opens the photo picker
                      at once; the sheet runs the scan on the screenshot chosen. */}
                  <button type="button" className="dash-scan-btn" aria-label="Scan table" title="Scan the table (WSOP Live / PokerStars Live screenshot)"
                    onClick={() => { haptic(); scanInputRef.current?.click(); }}>
                    <Icon.camera /><span className="dash-t">Scan</span>
                  </button>
                  <button className="dash-update-btn" onClick={() => {
                    window.dispatchEvent(new CustomEvent('openLiveUpdate', {
                      detail: { tab: 'update', tournamentId: event.id }
                    }));
                  }}><span className="dash-t">Update</span></button>
                  <button className="dash-bag-btn" onClick={() => {
                    haptic(25);
                    const nextBagDay = (activeUpd?.bag_day || 0) + 1 || 1;
                    window.dispatchEvent(new CustomEvent('openLiveUpdate', {
                      detail: { tab: 'update', tournamentId: event.id, bag: nextBagDay }
                    }));
                  }}><span className="dash-t">Bag</span></button>
                  {!regClosed ? (
                    <button className="dash-bust-btn" onClick={() => { haptic(); setBustMenuEventId(event.id); }}><span className="dash-t">Bust</span></button>
                  ) : (
                    <button className="dash-bust-btn" onClick={() => {
                      haptic(25);
                      window.dispatchEvent(new CustomEvent('openLiveUpdate', {
                        detail: { tab: 'finish', tournamentId: event.id }
                      }));
                    }}><span className="dash-t">Finish</span></button>
                  )}
                </div>
              </div>
            );
          }

          if (regClosed) return null;
          // Hide Start Event until the event's scheduled start time has
          // arrived — pressing it earlier creates a phantom "playing"
          // status before the cards are even in the air.
          const eventStartMs = event.venue
            ? parseDateTimeInTz(event.date, event.time, event.venue)
            : parseDateTime(event.date, event.time || '12:00 AM');
          if (Number.isFinite(eventStartMs) && Date.now() < eventStartMs) return null;
          // Your updates did not load: Start is not offered until a read succeeds (App improvements 111).
          if (updatesFailed) {
            return (
              <div className="dash-updates-failed" role="alert">
                <span className="dash-t">Couldn&rsquo;t load your updates for this event.</span>
                {onRetryUpdates && <button type="button" className="dash-update-btn" onClick={() => onRetryUpdates()}><span className="dash-t">Retry</span></button>}
              </div>
            );
          }
          return (
            <button
              className="dash-start-btn"
              onClick={() => {
                haptic(25);
                if (onPost) {
                  onPost({
                    tournamentId: event.id,
                    stack: event.starting_chips || 20000,
                    update_text: 'Registered — GL!',
                    playStartedAt: new Date().toISOString(),
                  });
                }
              }}
            >
              <Icon.play /><span className="dash-t">Start Event</span>
            </button>
          );
        })()}

        {event._type !== 'bagged' && !isBustedDone && !askEnded && !roomNotStarted && !(isConditionalOnPlaying && regClosed) && (
          (bustedEventMap[event.id] || isConditionalOnPlaying) ? (
            <MiniLateRegBar
              completed={completed}
              startAt={clockStart}
              lateRegEnd={effectiveLateRegEnd(event)}
              date={event.date}
              time={event.time}
              venue={event.venue}
              levelMin={event.level_duration}
              reentry={event.reentry}
            />
          ) : (
            <LateRegBar
              completed={completed}
              startAt={clockStart}
              lateRegEnd={effectiveLateRegEnd(event)}
              date={event.date}
              time={event.time}
              venueAbbr={getVenueInfo(event.venue, event.property).abbr}
              venue={event.venue}
              levelMin={event.level_duration}
              reentry={event.reentry}
            />
          )
        )}
        </div>
      </div>
    );
  }

  // The home's sections (verdict "placement"), each a keyed element so a reorder moves it without
  // remounting it (To log's held Undo rows and "+N more", the carousel's page, survive): NOW (Up
  // Next, To log and the last result) and the NUMBERS (the bankroll line, the period block with
  // its noise line and goals as parts, and, section 7, not yet built, Trend). Which show, and in
  // what order, is the user's (Edit home, utils/home-layout.js resolve): on the phone one scrolling
  // column in that order; on desktop (>= 1024) each section keeps its pane, NOW the main pane and
  // the NUMBERS portalled into a second 37g pane App renders beside it (homeRight), each in the
  // user's relative order (docs/desktop-layout.md "Dashboard"). A hidden section is not rendered at
  // all, so it asks the server for nothing. No section is wrapped: To log and the bankroll line
  // render null when they have nothing, and an empty wrapper would still take the column's 2r gap.
  const num = useHomeNumbers({ isAdmin, token, bk, onLog });
  const registered = !!(onLog && canLog);
  // Whether To log has any row to show (it reports it: HomeToLog renders nothing when nothing waits).
  // A section that renders nothing is not "directly above" another one, whatever the order says.
  const [toLogShown, setToLogShown] = useState(true);
  const view = useMemo(() => resolveLayout(layout, { admin: num.admin, registered }), [layout, num.admin, registered]);
  const upNextSection = (
        <div key="upnext" className="dashboard-section">
          <div className="dashboard-section-header">
            <div className="dashboard-section-title dash-title-swap" aria-live="polite">
              <span key={upNextTitle} className={upNextTitleOut ? 'dash-title-in' : undefined}>{upNextTitle}</span>
              {upNextTitleOut && (
                <span key={'out' + upNextTitleOut.key} className="dash-title-out" aria-hidden="true"
                  onAnimationEnd={() => setUpNextTitleOut(null)}>{upNextTitleOut.text}</span>
              )}
            </div>
            {whatsNextEvents.length > 0 && (
              <span className="dashboard-section-badge dashboard-section-badge--wide">{whatsNextEvents.length} event{whatsNextEvents.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          {slides.length > 0 ? (() => {
            const safeIdx = Math.min(selectedUpNextIdx, slides.length - 1);
            swipeRef.current = slides.length;
            return (
              <div
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                // The shadow's room sideways is a whole g (it was 1.5r): the track, and so every card
                // in it, is then the section's whole-g width exactly. 1.5r a side made it 35.02g.
                style={{overflow:'hidden', touchAction:'pan-y', padding:'0 var(--gu) var(--space-lg)', margin:'0 calc(var(--gu) * -1) calc(var(--subrow) * -1.5)'}}
              >
                {/* Every slide sits in the track's one grid cell, moved by its own whole multiple of
                    its width from the one shown (home.css), so the card shown is exactly where
                    the first one is. A flex row of fractional-width slides, translated by -idx
                    x 100%, drifted 0.005g a slide off the grid (0.11g by the 24th card). */}
                <div
                  className="dash-carousel-track"
                  ref={trackRef}
                  data-idx={safeIdx}
                >
                  {/* The slides not on show are inert and hidden from assistive tech (no Tab into an
                      unseen Bust), and invisible once a drag or a page turn is over (home.css): the
                      neighbour, taller than the track that fits the card on show, painted a band of
                      itself and its shadow below it. */}
                  {slides.map((evt, i) => (
                    <div className={'dash-carousel-slide' + (i === safeIdx ? '' : ' is-off')} key={evt.id}
                      inert={i === safeIdx ? undefined : ''} aria-hidden={i === safeIdx ? undefined : 'true'}
                      style={{ transform: `translateX(${(i - safeIdx) * 100}%)` }}>
                      {evt._cash ? (
                        <HomeCashCard session={cashSession} stacks={cashStacks} skew={cashSkew} token={token}
                          dragged={() => Math.abs(swipeDx.current || 0) > 10}
                          onOpen={() => onLog && onLog({ kind: 'cash-live' })}
                          onCashOut={() => onLog && onLog({ kind: 'cash-end' })} />
                      ) : renderEventCard(evt)}
                    </div>
                  ))}
                </div>
                {/* Dots only while they stay countable. The carousel now runs
                    the whole schedule, so a full season would be forty dots —
                    past the cap it becomes a position readout instead. */}
                {slides.length > 1 && slides.length <= 8 && (
                  <div className="dash-upnext-dots" style={{ '--n': slides.length }} onPointerEnter={holdFit} onPointerLeave={releaseFit}>
                    {slides.map((_, i) => (
                      <button type="button" key={i} className={'dash-upnext-dot' + (i === safeIdx ? ' active' : '')} onClick={() => setSelectedUpNextIdx(i)}
                        aria-label={showCash ? (i === 0 ? 'Show the cash session' : `Show event ${i}`) : `Show event ${i + 1}`} aria-current={i === safeIdx} />
                    ))}
                  </div>
                )}
                {slides.length > 8 && (
                  <div className="dash-upnext-counter snap-g-centred" onPointerEnter={holdFit} onPointerLeave={releaseFit}>
                    <button
                      type="button"
                      className="dash-upnext-step"
                      onClick={() => setSelectedUpNextIdx(i => Math.max(0, i - 1))}
                      disabled={safeIdx === 0}
                      aria-label="Previous event"
                    ><Icon.chevLeft /></button>
                    {/* Events are numbered, as the header's badge counts them ('26 events'): the
                        running cash session's card is a slide, not an event, so it reads CASH and
                        the events run 1 / 26 to 26 / 26 (it used to read 1 / 27 under '26 events'). */}
                    <span className="dash-upnext-pos">{`${safeIdx + 1} / ${slides.length}`}</span>
                    <button
                      type="button"
                      className="dash-upnext-step"
                      onClick={() => setSelectedUpNextIdx(i => Math.min(slides.length - 1, i + 1))}
                      disabled={safeIdx === slides.length - 1}
                      aria-label="Next event"
                    ><Icon.chevRight /></button>
                  </div>
                )}
                {/* What comes after the card on show (UX pick 36): the next three in the period card's 4r
                    rows, each paging the carousel to it, then the way to the whole schedule. Only while
                    there are at least two other cards. */}
                {slides.length >= 3 && safeIdx < slides.length - 1 && (() => {
                  const next = slides.slice(safeIdx + 1, safeIdx + 4).map((s, k) => ({ s, i: safeIdx + 1 + k }));
                  const more = slides.length - (safeIdx + 1 + next.length);
                  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                  const when = (e) => {
                    if (activeEventMap[e.id]) return 'Playing';
                    const d = normaliseDate(e.date);
                    if (d === todayISO) return e.time || 'Today';
                    const wd = d ? WD[new Date(d + 'T12:00:00').getDay()] : '';
                    return [wd, e.time].filter(Boolean).join(' ');
                  };
                  return (
                    <div className="hm-then" role="list" aria-label="Then">
                      {next.map(({ s, i }) => (
                        <button key={s.id} type="button" role="listitem" className="hm-prow hm-then-row" onClick={() => setSelectedUpNextIdx(i)}>
                          <span className="hm-cell hm-f-sm hm-prow-l">
                            <span className="hm-clip">{s._cash ? 'Cash session' : s.event_name}
                              {!s._cash && <span className="hm-prow-s">{(getVenueInfo(s.venue, s.property) || {}).abbr || s.venue}</span>}
                            </span>
                          </span>
                          <span className="hm-cell hm-f-sm-b hm-prow-v"><span className="hm-clip">{s._cash ? 'Now' : when(s)}</span></span>
                        </button>
                      ))}
                      <button type="button" role="listitem" className="hm-prow hm-then-row" onClick={() => onNavigate && onNavigate('schedule')}>
                        <span className="hm-cell hm-f-sm hm-prow-l is-muted"><span className="hm-clip">{more > 0 ? `${more} more on your schedule` : 'Your whole schedule'}</span></span>
                        <span className="hm-cell hm-f-sm-b hm-prow-v"><span className="hm-clip">{'All \u203A'}</span></span>
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          })() : (
            // Nothing scheduled (§1(d)): one 5r prompt with the week's events near the user, which
            // opens the Schedule.
            <HomeNothingNext tournaments={tournaments} today={todayISO} onOpen={() => onNavigate('tournaments')} />
          )}
          {moreMenu && createPortal(
            <>
              <div className="dropdown-backdrop" style={{ zIndex: 'var(--z-scrim)' }} onClick={() => setMoreMenu(null)} />
              <div className="dash-more-menu" role="menu" style={{ top: `calc(${moreMenu.top}px + var(--subrow))`, right: `${moreMenu.right}px` }}>
                {onOpenInSchedule && (
                  <button type="button" role="menuitem" className="dash-more-item" onClick={() => { const id = moreMenu.id; setMoreMenu(null); onOpenInSchedule(id); }}>Open in My Schedule</button>
                )}
                {onToggle && (
                  <button type="button" role="menuitem" className="dash-more-item is-danger" onClick={() => {
                    const id = moreMenu.id; setMoreMenu(null);
                    if (confirm('Remove from schedule?')) onToggle(id);
                  }}>Remove from schedule\u2026</button>
                )}
              </div>
            </>,
            document.body
          )}
        </div>
  );
  const SECTIONS = {
    upnext: () => upNextSection,
    // To log (verdict §2; 0r when nothing waits) and the last result (§3). To log reads the resolved
    // plans: a branch that is off was never played, so it is not asked about.
    tolog: () => (onLog ? (
      <HomeToLog
        key="tolog"
        schedule={mySchedule}
        results={trackingData}
        updates={myActiveUpdates}
        plans={resolvedPlans}
        today={todayISO}
        canLog={canLog}
        onAddTracking={onAddTracking}
        onDeleteTracking={onDeleteTracking}
        onSetPlayed={onSetPlayed}
        onLog={onLog}
        onShown={setToLogShown}
      />
    ) : null),
    last: () => (onLog ? (
      <HomeLastResult key="last" results={trackingData} rates={dashRates} isAdmin={isAdmin} token={token} canLog={canLog} onLog={onLog} bk={bk} />
    ) : null),
    // Friends and the Table scanner: Edit home options that start off (owner, 2026-10-20).
    friends: () => (
      <HomeFriends key="friends" buddies={shareBuddies} liveUpdates={buddyLiveUpdates} buddyEvents={buddyEvents}
        tournaments={tournaments} today={todayISO} demo={!!demoStates} onOpenSocial={() => onNavigate && onNavigate('social')} />
    ),
    scanner: () => (
      <section key="scanner" className="dashboard-section hm-scanner" aria-label="Table scanner">
        <div className="dashboard-section-header hm-period-head">
          <div className="hm-cell hm-sec-title"><span className="hm-clip">Table scanner</span></div>
        </div>
        <TableScanner />
      </section>
    ),
    // The bankroll line (admins; verdict section 4).
    bankroll: () => (num.admin ? <HomeBankrollLine key="bankroll" summary={bk.summary} onOpen={num.onOpenRules} /> : null),
    // The period block with its goals (section 5) and its noise line (section 6), which replaced the
    // one-line Results bar. plans: Up Next's resolved plans, so "Still on your schedule" leaves out a
    // branch that is off, as Up Next and To log do. Its header leaves the scope out only when the
    // bankroll line renders immediately above it in the same column (that line already says it).
    period: (column) => (
      <HomePeriod key="period" admin={num.admin} bk={bk} results={trackingData} schedule={mySchedule} updates={myActiveUpdates}
        plans={resolvedPlans} rates={dashRates} currency={dashCurrency} today={todayISO}
        scopeAbove={bankrollAbovePeriod(column.filter(rendersSomething)) && num.bankLine ? `All bankrolls · ${num.bankLine.currency}` : null}
        showNoise={view.on.has('noise')} showGoals={view.on.has('goals')}
        onOpen={num.onOpenBlock} onOpenGoals={num.onOpenGoals} onOpenNoise={num.onOpenNoise} />
    ),
    // ── SLOT: section 7, Trend (last 3 months) — NOT BUILT YET ────────────────────────
    // TODO(home trend): build here once the BankrollChart.jsx rebuild has merged: one registry
    // entry in utils/home-layout.js (pane 'numbers', placed after 'period') and one element here.
    // Placement: after the period block (section 5) and its noise line; the right pane on
    // desktop, the first thing below the fold on the phone. It reuses BankrollChart.jsx,
    // which another workflow is rebuilding, so it waits for that to land. Verdict "home" §7:
    // a 3r title ("Last 3 months · N entries · H h") over a 35g x 14r cumulative profit
    // chart, a 4r figures row, a 3r downswing line in buy-ins; taps open the Overview at 3M.
    // Admins: ledger + rangeWindow('3m'); non-admins: a compact BankrollGraph (ResultCardParts.jsx),
    // the results graph that replaced the old ResultsCurve.
  };
  // Which of a column's sections take room: To log when something waits, Last result when there is a
  // way to log, the bankroll line when it has a line. (Up Next and the period block always do.)
  const rendersSomething = (id) => (id === 'tolog' ? !!onLog && toLogShown : id === 'last' ? !!onLog : id === 'bankroll' ? !!num.bankLine : true);
  // Up Next first, the NUMBERS a frame later (UX pick 46): the first frame carries what is next.
  const numbersIds = new Set(view.numbers);
  const renderColumn = (ids) => ids.filter((id) => numbersReady || !numbersIds.has(id)).map((id) => (SECTIONS[id] ? SECTIONS[id](ids) : null));

  // The Edit home control: the main column's last item (the phone's one column, desktop's NOW pane),
  // 11g x 4r centred in the 35g column (13..24g of the canvas), in the home's control face.
  const editHome = onEditHome ? (
    <button key="edit-home" type="button" className="hm-btn hm-edit" aria-label="Edit home: choose and order its sections"
      onClick={(e) => onEditHome(e.currentTarget)}>
      <Icon.sliders /><span className="hm-edit-t">Edit home</span>
    </button>
  ) : null;

  // Desktop: until App's second pane has mounted (its first frame) NOW renders alone; falling back
  // to the phone's order there would flash the NUMBERS in the main pane.
  const desktop = !!isDesktop;
  const nowCol = (
    <div className="home-col home-col--now">
      {renderColumn(desktop ? view.now : view.phone)}
      {editHome}
    </div>
  );
  // Every NUMBERS section hidden (a non-admin who hid This month; an admin who hid Bankroll and This
  // month): the pane says so, and opens the sheet. NOW is never empty: Up Next is locked on.
  const numbersEmpty = onEditHome ? (
    <section key="numbers-empty" className="dashboard-section hm-numbers-empty" aria-label="Numbers">
      <div className="dashboard-section-header">
        <div className="dashboard-section-title">Numbers</div>
      </div>
      <button type="button" className="hm-next-empty" aria-label="Your numbers are hidden. Edit home"
        onClick={(e) => onEditHome(e.currentTarget)}>
        <span className="hm-next-col">
          <span className="hm-cell hm-f-2xs hm-next-k"><span className="hm-clip">Nothing here</span></span>
          <span className="hm-cell hm-f-md-b hm-next-v"><span className="hm-clip">Your numbers are hidden</span></span>
        </span>
        <span className="hm-next-pill snap-g"><span className="hm-tag-t">Edit</span></span>
      </button>
    </section>
  ) : null;
  const numbersCol = desktop && homeRight ? (
    <div className="home-col home-col--numbers">
      {view.numbers.length ? renderColumn(view.numbers) : numbersEmpty}
    </div>
  ) : null;

  return (
    <div className="dashboard-view home">
      {nowCol}
      {numbersCol && createPortal(<div className="dashboard-view home home--numbers">{numbersCol}</div>, homeRight)}
      {/* The sheets the NUMBERS open (the bankroll dashboard, Analytics): portalled to the body. */}
      {num.sheets}
      {/* The Playing card's Scan table action: one hidden picker for every card, and the sheet
          that runs the scan once a screenshot is chosen (the Table Scanner, moved off the home). */}
      <input ref={scanInputRef} className="dash-scan-input" type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) setScanFile(f); }} />
      {scanFile && <ScanTableSheet file={scanFile} onClose={() => setScanFile(null)} />}
    </div>
  );
}
