import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import ScanTableSheet from './ScanTableSheet.jsx';
import {
  getVenueInfo, getVenueBrandColor, normaliseDate, getToday, getNow,
  formatBuyin, haptic, fmtShortDate,
  parseTournamentTime, parseDateTimeInTz, parseDateTime, parseLateRegEnd,
  getMaxEntries, getVenueTzAbbr, getVenueCoords,
  estimateBlindLevel, formatChips,
  CURRENCY_CONFIG, splitEventStage,
} from '../utils/utils.js';
import { API_URL } from '../utils/api.js';
import { homeCurrency } from '../utils/home.js';
import { gridGeom } from '../utils/grid-panel.js';
import { resolveConditions, offLast, planKind } from '../utils/home-upnext.js';
import useLiveCashSession from '../hooks/useLiveCashSession.js';
import useDisplayCurrency from '../hooks/useDisplayCurrency.js';
import HomeCashCard from './HomeCashCard.jsx';
import HomeNothingNext from './HomeNothingNext.jsx';
import HomeToLog from './HomeToLog.jsx';
import HomeLastResult from './HomeLastResult.jsx';
import HomeNumbers from './HomeNumbers.jsx';
import { useLiveClocks, liveView, clockStartMs as clockStartFrom, clockRegEnd, isCompleted } from '../utils/live-clocks.js';
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


// ── Countdown Clock (collapsed card) ──
function CountdownClock({ startMs }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const diff = startMs - Date.now();
    const interval = diff < 3600000 ? 1000 : 30000;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [startMs]);

  const diff = startMs - now;
  if (diff <= 0) return <span className="dash-collapsed-countdown live">LIVE</span>;

  const totalSec = Math.floor(diff / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  let label;
  if (d > 0) label = `${d}d ${h}h`;
  else if (h > 0) label = `${h}h ${m}m`;
  else if (m > 0) label = `${m}m ${s}s`;
  else label = `${s}s`;

  const cls = 'dash-collapsed-countdown' + (h === 0 && d === 0 ? ' soon' : '');
  return <span className={cls}>{label}</span>;
}

// ── Late Reg Bar ──
function LateRegBar({ lateRegEnd, date, time, venueAbbr, venue, startAt, completed }) {
  const [now, setNow] = useState(getNow());
  useEffect(() => {
    const id = setInterval(() => setNow(getNow()), 30000);
    return () => clearInterval(id);
  }, []);

  // The room's clock showed the tournament finished (server: clock_ended_at / state 'ended').
  if (completed) {
    return (
      <div className="late-reg-wrap">
        <div className="late-reg-label-row">
          <span className="late-reg-label event-completed-label">Event Completed</span>
        </div>
        <div className="late-reg-bar-bg">
          <div className="late-reg-bar-fill" style={{ width: '0%', background: 'var(--border)' }} />
        </div>
      </div>
    );
  }


  // Pre-start countdown
  // startAt: the room's own clock start (PokerAtlas), when it has one, over the published time.
  if (date || startAt) {
    const startMs = startAt ?? (venue ? parseDateTimeInTz(date, time, venue) : parseDateTime(date, time || '12:00 AM'));
    if (now < startMs) {
      const totalSec = Math.floor((startMs - now) / 1000);
      const d = Math.floor(totalSec / 86400);
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const parts = [];
      if (d > 0) parts.push(`${d} day${d !== 1 ? 's' : ''}`);
      if (h > 0) parts.push(`${h} hour${h !== 1 ? 's' : ''}`);
      parts.push(`${m} minute${m !== 1 ? 's' : ''}`);
      return (
        <div className="late-reg-wrap">
          <div className="late-reg-label-row">
            <span className="late-reg-label pending">Until Start</span>
            <span className="late-reg-sep"></span>
            <span className="late-reg-time pending">{parts.join(', ')}</span>
          </div>
        </div>
      );
    }
  }

  if (!lateRegEnd) return null;
  const endMs = parseLateRegEnd(lateRegEnd, date);
  if (isNaN(endMs)) return null;
  const diffMs = endMs - now;
  const diffMin = Math.floor(diffMs / 60000);
  const endDate = new Date(endMs);
  const endClock = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  let status, label, timeStr;
  if (diffMs <= 0) {
    status = 'closed'; label = 'Late Reg Closed'; timeStr = null;
  } else if (diffMin < 30) {
    status = 'urgent'; label = 'Late Reg — Closing Soon';
    timeStr = `${diffMin}m left | ${endClock}`;
  } else if (diffMin < 120) {
    const h = Math.floor(diffMin / 60); const m2 = diffMin % 60;
    status = 'soon'; label = 'Late Reg Open';
    timeStr = (h > 0 ? `${h}h ${m2}m left` : `${m2}m left`) + ` | ${endClock}`;
  } else {
    const h = Math.floor(diffMin / 60); const m2 = diffMin % 60;
    status = 'open'; label = 'Late Reg Open';
    timeStr = (h > 0 ? `${h}h ${m2}m left` : `${m2}m left`) + ` | ${endClock}`;
  }

  const windowMs = 12 * 60 * 60 * 1000;
  const pct = status === 'closed' ? 0 : Math.min(100, Math.max(0, (diffMs / windowMs) * 100));
  const brandColor = getVenueBrandColor(venueAbbr);
  const critical = status !== 'closed' && pct <= 15;

  return (
    <div className="late-reg-wrap">
      <div className="late-reg-label-row">
        <span className={`late-reg-label ${status}`}>{label}</span>
        {timeStr && <span className={`late-reg-time ${status}`}>{timeStr}</span>}
      </div>
      <div className="late-reg-bar-bg">
        <div
          className={`late-reg-bar-fill ${critical ? 'critical' : ''}`}
          style={{ width: `${pct}%`, background: critical ? undefined : (status === 'closed' ? 'var(--border)' : brandColor) }}
        />
      </div>
    </div>
  );
}

// ── Mini Late Reg Bar ──
function MiniLateRegBar({ lateRegEnd, date, time, venueAbbr, openOnly, venue, startAt, completed }) {
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
  const endMs = parseLateRegEnd(lateRegEnd, date);
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
  onAddTracking, onNavigate, tournaments, onToggle, onRefresh,
  onOpenInSchedule, demoStates = false, demoCard = false,
  homeRight = null, // desktop: the second pane's element, which the NUMBERS column portals into
  // Step 3 (To log, Last result): admin gating for the cash/expense paths, the token for the
  // admin-only cash-sessions read, whether this account can log at all (guests cannot), the
  // route into Results' forms (App's resultsIntent) and the "Didn't play" flag.
  isAdmin = false, token = null, canLog = true, onLog = null, onSetPlayed = null, onDeleteTracking = null,
  // Step 4: App's useBankrolls (the summary the Results tab shares) for the bankroll line and the
  // period block. Admins only; for everyone else it is disabled and fetches nothing.
  bk = null,
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
  // fit.frozen: a mouse is over the dots or the counter. The height holds still then, so the ‹ ›
  // under the pointer does not move between two clicks (a taller card is clipped at the held height
  // until the pointer leaves, and the track then eases to the card on show).
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
    track.classList.toggle('is-frozen', !!f.frozen && track.classList.contains('is-fitted'));
    if (f.frozen && track.classList.contains('is-fitted')) return;
    const n = Math.max(rOf(f.shown), rOf(f.peer));
    if (!(n > 0)) return;
    track.style.setProperty('--track-r', String(n));
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

  // Build bagged events from previous days
  const baggedEvents = useMemo(() => {
    const bustedMap = {};
    const baggedMap = {};
    (myActiveUpdates || []).forEach(u => {
      if (u.is_busted) bustedMap[u.tournament_id] = true;
      if (u.is_bagged) baggedMap[u.tournament_id] = u;
    });
    return Object.entries(baggedMap)
      .filter(([tid]) => !bustedMap[tid])
      .map(([tid, update]) => {
        const t = (mySchedule || []).find(x => x.id === Number(tid)) || (tournaments || []).find(x => x.id === Number(tid));
        if (!t) return null;
        return { ...t, _bagUpdate: update, _type: 'bagged' };
      })
      .filter(Boolean);
  }, [myActiveUpdates, mySchedule, tournaments]);

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
        return { ...t, _type: 'normal' };
      })
      .filter(Boolean);
  }, [myActiveUpdates, mySchedule, tournaments, todayISO, baggedEvents]);

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
    if (baggedEvents.length > 0) {
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
  }, [baggedEvents, activePrevDayEvents, todayEvents, mySchedule, todayISO, demoStates, demoCard, resolvedPlans]);

  // The carousel's slides: the running cash session's card first (admins), then the events.
  const showCash = !!cashSession && !demoStates && !demoCard;
  const slides = useMemo(
    () => (showCash ? [{ id: `cash-${cashSession.id}`, _cash: true }, ...whatsNextEvents] : whatsNextEvents),
    [showCash, cashSession, whatsNextEvents]);

  // The section title names the next event's day (owner, 2026-10-11): TODAY or TOMORROW while the
  // carousel shows the first card and that event is today or tomorrow; any later card, or a next
  // event further out, is UP NEXT. A change crossfades: the outgoing title fades out over the
  // incoming one, both seated on the same baseline.
  const tomorrowISO = useMemo(() => {
    const [y, m, d] = todayISO.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }, [todayISO]);
  const upNextTitle = (() => {
    if (!slides.length || Math.min(selectedUpNextIdx, slides.length - 1) !== 0) return 'Up Next';
    if (slides[0]._cash) return 'Today'; // the session running now
    const day = normaliseDate(slides[0].date);
    return day === todayISO ? 'Today' : day === tomorrowISO ? 'Tomorrow' : 'Up Next';
  })();
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
      .map(e => { const c = getVenueCoords(e.venue, e.property); return { id: e.id, lat: c?.lat, lng: c?.lng }; }));
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
    const endMs = parseLateRegEnd(end, t.date);
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
          live: true, onBreak: live.onBreak, paused: live.state === 'paused' }
      : (started && levelDuration ? estimateBlindLevel(startMs, levelDuration) : null);
    const startingChips = event.starting_chips || 20000;

    const currentStack = (activeEventMap[event.id]?.stack) ? Number(activeEventMap[event.id].stack) : startingChips;
    const bbCount = blindInfo ? Math.floor(currentStack / blindInfo.bb) : null;
    const isCurrentlyPlaying = !!activeEventMap[event.id];
    const isExpanded = true;
    const isConditionalOnPlaying = !isCurrentlyPlaying && hasActivePlaying && event._type !== 'bagged';
    const bustedUpdate = bustedEventMap[event.id];
    const isBustedDone = bustedUpdate && (bustedUpdate.bust_count || 1) >= getMaxEntries(event.reentry);
    // The room's clock showed it finished: dimmed like a busted-out card, "Event Completed" below.
    const completed = isCompleted(event, liveClocks[event.id]);

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
      isBustedDone ? 'done' : (completed ? 'completed' : ''),
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
            abbreviation — abbr stays only for the brand colour + WSOP casing. */}
        <div className="dash-venue-strip" style={{background: venueColor, color: venueStripText}}><span className="dash-t">{venueInfo.longName || venueInfo.abbr}</span></div>
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
            <button className="dash-undo-x muted" onClick={(e) => { e.stopPropagation(); if (confirm('Remove from schedule?')) onToggle(event.id); }} title="Remove from schedule"><span className="dash-t">&#10005;</span></button>
          )}
        </div>

        {isExpanded && blindInfo && (
          <div className="dash-event-stats">
            <div className="dash-stat-box">
              <div className="dash-stat-value">{blindInfo.ante ? `${formatChips(blindInfo.sb)}/${formatChips(blindInfo.bb)}/${formatChips(blindInfo.ante)}` : `${formatChips(blindInfo.sb)}/${formatChips(blindInfo.bb)}`}</div>
              <div className="dash-stat-label">Level {blindInfo.level}</div>
            </div>
            <div className="dash-stat-box">
              <div className="dash-stat-value">{currentStack.toLocaleString()}</div>
              <div className="dash-stat-label">{bbCount ? `${bbCount} BB` : 'START STACK'}</div>
            </div>
            <div className="dash-stat-box">
              <div className="dash-stat-value">
                {blindInfo.remainingMin}:{String(blindInfo.remainingSec).padStart(2, '0')}
              </div>
              <div className="dash-stat-label">{blindInfo.live ? (blindInfo.paused ? 'Paused' : blindInfo.onBreak ? 'Break' : 'Live') : 'Clock'}</div>
            </div>
          </div>
        )}

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
                  <Icon.restart /><span className="dash-t">Restart in {h}:{String(m).padStart(2, '0')}</span>
                  <button className="dash-unbag-x" onClick={(e) => { e.stopPropagation(); if (confirm('Undo bag?')) undoBag(); }} title="Undo bag"><span className="dash-t">&#10005;</span></button>
                </div>
              );
            }
          }
          return (
            <div className="dash-restart-badge">
              <Icon.restart /><span className="dash-t">Bagged</span>
              <button className="dash-unbag-x" onClick={(e) => { e.stopPropagation(); if (confirm('Undo bag?')) undoBag(); }} title="Undo bag"><span className="dash-t">&#10005;</span></button>
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
                  <button className="dash-undo-x muted" onClick={(e) => {
                    e.stopPropagation();
                    if (bustedUpd?.id && onDeleteUpdate && confirm('Undo finish? This will restore the event to playing.')) onDeleteUpdate(bustedUpd.id);
                  }} title="Undo finish"><span className="dash-t">&#10005;</span></button>
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
                  }}><span className="dash-t">Rebuys: {maxEntries >= 99 ? 'Unlimited' : maxEntries - usedEntries}</span></button>
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
                <div className="dash-status-row">
                  <button className="dash-update-btn" onClick={() => setBustMenuEventId(null)}><span className="dash-t">Cancel</span></button>
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
                    }}><span className="dash-t">Rebuys: {maxEntries >= 99 ? 'Unlimited' : maxEntries - bulletNum}</span></button>
                  )}
                  <button className="dash-bust-btn" onClick={() => {
                    haptic(25);
                    window.dispatchEvent(new CustomEvent('openLiveUpdate', {
                      detail: { tab: 'finish', tournamentId: event.id }
                    }));
                    setBustMenuEventId(null);
                  }}><span className="dash-t">Finish</span></button>
                </div>
              );
            }

            return (
              <div className="dash-status-stack">
                <div className="dash-playing-badge">
                  <span className="dash-playing-dot" /><span className="dash-t">Currently Playing{bulletNum > 1 ? `; Bullet ${bulletNum}` : ''}</span>
                  <button className="dash-undo-x" onClick={(e) => {
                    e.stopPropagation();
                    if (activeUpd?.id && onDeleteUpdate && confirm('Undo playing status for this event?')) onDeleteUpdate(activeUpd.id);
                  }} title="Undo start"><span className="dash-t">&#10005;</span></button>
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

        {event._type !== 'bagged' && !isBustedDone && !(isConditionalOnPlaying && regClosed) && (
          (bustedEventMap[event.id] || isConditionalOnPlaying) ? (
            <MiniLateRegBar
              completed={completed}
              startAt={clockStart}
              lateRegEnd={effectiveLateRegEnd(event)}
              date={event.date}
              time={event.time}
              venueAbbr={getVenueInfo(event.venue, event.property).abbr}
            />
          ) : (
            <LateRegBar
              completed={completed}
              startAt={clockStart}
              lateRegEnd={effectiveLateRegEnd(event)}
              date={event.date}
              time={event.time}
              venueAbbr={getVenueInfo(event.venue, event.property).abbr}
            />
          )
        )}
        </div>
      </div>
    );
  }

  // The home's two halves (verdict "placement"): NOW — Up Next, then To log and the last result —
  // and the NUMBERS — the bankroll line, the period block with its noise line, and (section 7, not yet built)
  // Trend. On the phone they are one scrolling
  // column, NOW first. On desktop (>= 1024) NOW is the main pane and the NUMBERS are portalled
  // into a second 37g pane App renders beside it (homeRight), each pane its own scroller.
  const nowCol = (
    <div className="home-col home-col--now">
        {/* Up Next */}
        <div className="dashboard-section">
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
                style={{overflow:'hidden', touchAction:'pan-y', padding:'0 var(--space-lg) var(--space-lg)', margin:'0 calc(var(--subrow) * -1.5) calc(var(--subrow) * -1.5)'}}
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
                  {slides.map((evt, i) => (
                    <div className="dash-carousel-slide" key={evt.id} style={{ transform: `translateX(${(i - safeIdx) * 100}%)` }}>
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
                      <button type="button" key={i} className={'dash-upnext-dot' + (i === safeIdx ? ' active' : '')} onClick={() => setSelectedUpNextIdx(i)} aria-label={`Show event ${i + 1}`} aria-current={i === safeIdx} />
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
                    <span className="dash-upnext-pos">{safeIdx + 1} / {slides.length}</span>
                    <button
                      type="button"
                      className="dash-upnext-step"
                      onClick={() => setSelectedUpNextIdx(i => Math.min(slides.length - 1, i + 1))}
                      disabled={safeIdx === slides.length - 1}
                      aria-label="Next event"
                    ><Icon.chevRight /></button>
                  </div>
                )}
              </div>
            );
          })() : (
            // Nothing scheduled (§1(d)): one 5r prompt with the week's events near the user, which
            // opens the Schedule.
            <HomeNothingNext tournaments={tournaments} today={todayISO} onOpen={() => onNavigate('tournaments')} />
          )}
        </div>
      {/* To log (verdict §2; 0r when nothing waits) and the last result (§3), under Up Next. To log
          reads the resolved plans: a branch that is off was never played, so it is not asked about. */}
      {onLog && (
        <HomeToLog
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
          onMore={() => onLog({ kind: 'awaiting' })}
        />
      )}
      {onLog && (
        <HomeLastResult results={trackingData} rates={dashRates} isAdmin={isAdmin} token={token} canLog={canLog} onLog={onLog} />
      )}
    </div>
  );
  const numbersCol = (
    <div className="home-col home-col--numbers">
      {/* The bankroll line (admins) and the period block with its goals (verdict sections 4 and
          5; components/HomeNumbers.jsx). The period block replaced the one-line Results bar. */}
      <HomeNumbers isAdmin={isAdmin} token={token} bk={bk} results={trackingData} schedule={mySchedule}
        updates={myActiveUpdates} rates={dashRates} currency={dashCurrency} today={todayISO} onLog={onLog} />

      {/* ── SLOT: section 7, Trend (last 3 months) — NOT BUILT YET ────────────────────────
          TODO(home trend): build here once the BankrollChart.jsx rebuild has merged.
          Placement: after the period block (section 5) and its noise line; the right pane on
          desktop, the first thing below the fold on the phone. It reuses BankrollChart.jsx,
          which another workflow is rebuilding, so it waits for that to land. Verdict "home" §7:
          a 3r title ("Last 3 months · N entries · H h") over a 35g x 14r cumulative profit
          chart, a 4r figures row, a 3r downswing line in buy-ins; taps open the Overview at 3M.
          Admins: ledger + rangeWindow('3m'); non-admins: a compact ResultsCurve. */}
    </div>
  );

  return (
    <div className="dashboard-view home">
      {nowCol}
      {homeRight
        ? createPortal(<div className="dashboard-view home home--numbers">{numbersCol}</div>, homeRight)
        : numbersCol}
      {/* The Playing card's Scan table action: one hidden picker for every card, and the sheet
          that runs the scan once a screenshot is chosen (the Table Scanner, moved off the home). */}
      <input ref={scanInputRef} className="dash-scan-input" type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) setScanFile(f); }} />
      {scanFile && <ScanTableSheet file={scanFile} onClose={() => setScanFile(null)} />}
    </div>
  );
}
