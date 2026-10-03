import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import TableScanner from './TableScanner.jsx';
import { FirstRun } from './EmptyState.jsx';
import {
  getVenueInfo, getVenueBrandColor, normaliseDate, getToday, getNow,
  formatBuyin, currencySymbol, nativeCurrency, haptic, fmtShortDate,
  parseTournamentTime, parseDateTimeInTz, parseDateTime, parseLateRegEnd,
  getMaxEntries, getVenueTzAbbr, getVenueCoords,
  estimateBlindLevel, formatChips,
  convertAmount, formatCurrencyAmount, CURRENCY_CONFIG, splitEventStage,
} from '../utils/utils.js';
import { API_URL } from '../utils/api.js';
import { useLiveClocks, liveView, clockStartMs as clockStartFrom, clockRegEnd, isCompleted } from '../utils/live-clocks.js';
import { useDisplayName } from '../contexts/DisplayNameContext.jsx';

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

// ── Grid placement for the portalled dropdowns ──
// g is read from a 100g probe (what --gu really resolves to), r = 0.71g, and the
// origin is the top bar — the overlay's origin. A panel's top is snapped to a
// whole r from the bar (1r below / above its trigger) and emitted as calc() in r,
// its left edge as calc() in g on a column line; nothing is written in px.
function gridGeom() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:0;width:calc(var(--gu) * 100)';
  document.body.appendChild(probe);
  const G = probe.getBoundingClientRect().width / 100;
  probe.remove();
  const barTop = document.querySelector('.top-bar')?.getBoundingClientRect().top || 0;
  return { G, R: G * 0.71, barTop };
}
function gridPanelStyle(anchorRect, heightR, leftG) {
  const { R, barTop } = gridGeom();
  const openAbove = anchorRect.top > window.innerHeight / 2;
  const topR = openAbove
    ? Math.round((anchorRect.top - barTop) / R) - 1 - heightR
    : Math.round((anchorRect.bottom - barTop) / R) + 1;
  const barR = barTop / R; // 0 when the bar sits at the viewport top
  return {
    position: 'fixed',
    left: `calc(var(--gu) * ${+leftG.toFixed(4)})`,
    top: `calc(var(--subrow) * ${+(topR + barR).toFixed(4)})`,
    transform: 'none',
  };
}
// A letter avatar's initial, seated: trimmed to cap..alphabetic with its baseline
// on +3r of the 5r circle (cap 0.94r -> 2.06r above, 2r below = centred).
const SEATED_INITIAL = {
  display: 'block', textAlign: 'center', boxSizing: 'border-box',
  paddingTop: 'calc(var(--subrow) * 3 - 1cap)',
  textBoxTrim: 'trim-both', textBoxEdge: 'cap alphabetic',
};
const AVATAR_5R = 'calc(var(--subrow) * 5)';

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


export default function DashboardView({
  mySchedule, myActiveUpdates, trackingData, shareBuddies,
  buddyLiveUpdates, buddyEvents, displayName, onPost, onDeleteUpdate,
  onAddTracking, onResetResults, onNavigate, tournaments, onToggle, onRefresh,
  onOpenInSchedule, demoStates = false
}) {
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [selectedUpNextIdx, setSelectedUpNextIdx] = useState(0);
  const [connDropdownId, setConnDropdownId] = useState(null);
  const [now, setNow] = useState(getNow());
  const [dashCurrency, setDashCurrency] = useState(() => localStorage.getItem('trackingCurrency') || 'USD');
  const [dashRates, setDashRates] = useState(null);
  const [dashRatesStale, setDashRatesStale] = useState(false);
  useEffect(() => {
    fetch(API_URL + '/exchange-rates')
      .then(r => r.json())
      .then(data => { setDashRates(data.rates); setDashRatesStale(data.stale); })
      .catch(() => { setDashRates({ EUR:0.91, GBP:0.79, CAD:1.36, AUD:1.53, JPY:149.5, USD:1 }); setDashRatesStale(true); });
  }, []);
  const onDashCurrencyChange = useCallback((c) => {
    setDashCurrency(c);
    localStorage.setItem('trackingCurrency', c);
  }, []);
  const rebuyingRef = useRef(false);
  const [bustMenuEventId, setBustMenuEventId] = useState(null);

  // Smooth swipe handling for carousel
  const swipeRef = useRef(null);
  const swipeStart = useRef(null);
  const swipeDx = useRef(0);
  const trackRef = useRef(null);
  const onTouchStart = useCallback((e) => {
    swipeStart.current = e.touches[0].clientX;
    swipeDx.current = 0;
    if (trackRef.current) trackRef.current.classList.add('swiping');
  }, []);
  const onTouchMove = useCallback((e) => {
    if (swipeStart.current === null) return;
    const dx = e.touches[0].clientX - swipeStart.current;
    swipeDx.current = dx;
    if (trackRef.current) {
      const len = swipeRef.current || 1;
      const idx = parseInt(trackRef.current.dataset.idx || '0', 10);
      const pct = -(idx * 100) + (dx / trackRef.current.parentElement.offsetWidth) * 100;
      trackRef.current.style.transform = `translateX(${pct}%)`;
    }
  }, []);
  const onTouchEnd = useCallback((e) => {
    if (swipeStart.current === null) return;
    const dx = swipeDx.current;
    swipeStart.current = null;
    if (trackRef.current) trackRef.current.classList.remove('swiping');
    const threshold = 40;
    if (Math.abs(dx) < threshold) {
      if (trackRef.current) {
        const idx = parseInt(trackRef.current.dataset.idx || '0', 10);
        trackRef.current.style.transform = `translateX(${-(idx * 100)}%)`;
      }
      return;
    }
    setSelectedUpNextIdx(i => {
      const len = swipeRef.current || 1;
      return dx < 0 ? Math.min(i + 1, len - 1) : Math.max(i - 1, 0);
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(getNow()), 1000);
    return () => clearInterval(id);
  }, []);

  const todayISO = getToday();

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
        const isAnchor = !!t.is_anchor;
        const hasCondition = !!(t.conditions_json);
        return { ...t, _type: isAnchor ? 'anchor' : (hasCondition ? 'conditional' : 'normal') };
      })
      .filter(Boolean);
  }, [mySchedule, todayISO, baggedEvents]);

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
    // stays as the single seated anchor card (safaridriver use).
    const demo = demoStates || (typeof window !== 'undefined' && window.location.search.includes('democard'));
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
      events.push(...todayEvents.map(t => ({
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
        _type: t.is_anchor ? 'anchor' : (t.conditions_json ? 'conditional' : 'normal'),
        _future: true,
      }))
      .sort((a, b) => {
        const ta = a.venue ? parseDateTimeInTz(a.date, a.time, a.venue) : parseDateTime(a.date, a.time);
        const tb = b.venue ? parseDateTimeInTz(b.date, b.time, b.venue) : parseDateTime(b.date, b.time);
        return ta - tb;
      });

    return [...events, ...later];
  }, [baggedEvents, activePrevDayEvents, todayEvents, mySchedule, todayISO, demoStates]);

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
  }, [whatsNextEvents, selectedUpNextIdx]);

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
    if (whatsNextEvents.length > 1) {
      const safeIdx = Math.min(selectedUpNextIdx, whatsNextEvents.length - 1);
      const current = whatsNextEvents[safeIdx];
      if (current && curBusted.has(current.id) && !prev.has(current.id)) {
        const nextIdx = whatsNextEvents.findIndex((e, i) => i !== safeIdx && !curBusted.has(e.id));
        if (nextIdx >= 0) setSelectedUpNextIdx(nextIdx);
      }
    }
    prevBustedRef.current = curBusted;
  }, [bustedEventMap, whatsNextEvents, selectedUpNextIdx]);

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

    const cardClass = [
      'dash-event-card',
      isBustedDone ? 'done' : (completed ? 'completed' : ''),
      event._type === 'bagged' ? 'bagged' : '',
      event._type === 'anchor' && !isConditionalOnPlaying ? 'anchor' : '',
      isConditionalOnPlaying ? 'conditional' : '',
      isCurrentlyPlaying ? 'playing' : 'next-up',
      regClosed && event._type !== 'bagged' ? 'reg-closed' : '',
    ].filter(Boolean).join(' ');

    // Status tags above the name. Built as a list so the row is rendered only when
    // it has something in it: an empty flex row still took the content's 1r gap.
    const tags = [];
    if (!isConditionalOnPlaying) {
      if (event._type === 'bagged') tags.push(['bagged', `Bagged — Day ${event._bagUpdate?.bag_day || '?'}`]);
      if (event._type === 'anchor' && !event._conditionalOnBag) tags.push(['anchor', 'Locked In']);
      if (event._type === 'conditional') tags.push(event._conditionalOnBag ? ['conditional on-bag', 'Conditional on bag'] : ['conditional', 'Conditional']);
      if (regClosed && event._type !== 'bagged') tags.push(['reg-closed', 'Reg Closed']);
    }

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
        <div className="dash-venue-strip" style={{background: venueColor, color: venueStripText, letterSpacing: '0.06em'}}><span className="dash-t">{venueInfo.longName || venueInfo.abbr}</span></div>
        <div className="dash-card-content" style={isConditionalOnPlaying ? {borderColor: venueInfo.abbr === 'WSOP' ? 'var(--venue-wsop-cond)' : venueColor} : undefined}>
        {tags.length > 0 && (
          <div className="dash-event-tags">
            {tags.map(([cls, label]) => (
              <span key={cls} className={`dash-event-tag ${cls}`}><span className="dash-t">{label}</span></span>
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
                <span><Icon.clock /><span className="dash-t">{event.time || 'TBD'}{event.venue ? ' ' + getVenueTzAbbr(event.venue) : ''}</span></span>
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
                <div className="dash-action-row">
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

  // P&L data
  const plData = useMemo(() => {
    if (!trackingData || trackingData.length === 0) {
      return { invested: 0, cashed: 0, net: 0, roi: 0, count: 0, byVenue: {} };
    }
    let invested = 0;
    let cashed = 0;
    const byVenue = {};
    trackingData.forEach(entry => {
      const t = (tournaments || []).find(x => x.id === entry.tournament_id);
      const buyin = t ? t.buyin : 0;
      const venueRaw = t ? t.venue : '';
      const venue = t ? getVenueInfo(t.venue, t.property).abbr : 'Other';
      const from = nativeCurrency(venueRaw);
      const to = dashCurrency === 'NATIVE' ? from : dashCurrency;
      const entryBuyin = convertAmount(buyin * (entry.num_entries || 1), from, to, dashRates);
      const entryCash = convertAmount(entry.cash_amount || 0, from, to, dashRates);
      invested += entryBuyin;
      cashed += entryCash;
      if (!byVenue[venue]) byVenue[venue] = { invested: 0, cashed: 0 };
      byVenue[venue].invested += entryBuyin;
      byVenue[venue].cashed += entryCash;
    });
    const net = cashed - invested;
    const roi = invested > 0 ? ((net / invested) * 100) : 0;
    return { invested, cashed, net, roi, count: trackingData.length, byVenue };
  }, [trackingData, tournaments, dashCurrency, dashRates]);

  const [plDropdown, setPlDropdown] = useState(null);
  // The trigger's rect, captured on click, so the panel can be rendered at
  // the document root instead of inside .dashboard-view's overflow:hidden.
  const [plRect, setPlRect] = useState(null);
  const togglePl = (key) => (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPlRect({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width });
    setPlDropdown(d => (d === key ? null : key));
  };
  // Anchored panel, flipped above the trigger when it would run off the bottom.
  // Left-aligned to its card (1g or 10g, a column line); 17g wide so it ends on
  // 18g or 27g. Height = rows x 3r, so the above-case top is exact too.
  const plPanelStyle = (rows) => {
    if (!plRect) return { position: 'fixed' };
    const { G } = gridGeom();
    return gridPanelStyle(plRect, rows * 3, plRect.left / G);
  };
  const plRows = (field) => Object.entries(plData.byVenue)
    .filter(([, v]) => v[field] > 0)
    .sort((a, b) => b[1][field] - a[1][field]);

  // Friends currently playing
  const activeFriends = useMemo(() => {
    if (demoStates) {
      return [
        { id: 'demo-f1', username: 'demo_alice', display_name: 'Alice D.', avatar: null,
          liveUpdate: { stack: '85000', sb: '500', bb: '1000', bbAnte: '1000', eventName: 'PLO 6-Max Day 1', isBusted: false } },
        { id: 'demo-f2', username: 'demo_bob', display_name: 'Bob R.', avatar: null,
          liveUpdate: { stack: '32000', bb: '800', eventName: 'NLH Championship', isBusted: false } },
      ];
    }
    if (!shareBuddies || !buddyLiveUpdates) return [];
    return shareBuddies
      .filter(b => {
        const lu = buddyLiveUpdates[b.id];
        return lu && !lu.isBusted;
      })
      .map(b => ({
        ...b,
        liveUpdate: buddyLiveUpdates[b.id],
      }));
  }, [shareBuddies, buddyLiveUpdates, demoStates]);

  // Friends with events scheduled today
  const scheduledFriends = useMemo(() => {
    if (!shareBuddies || !buddyEvents || !tournaments) return [];
    const buddyToday = {};
    Object.entries(buddyEvents).forEach(([tid, buddies]) => {
      const t = tournaments.find(x => x.id === Number(tid));
      // Stored dates are "September 30, 2026"; todayISO is ISO — compare normalised.
      if (!t || normaliseDate(t.date) !== todayISO) return;
      buddies.forEach(b => {
        if (!buddyToday[b.id]) buddyToday[b.id] = [];
        buddyToday[b.id].push(t);
      });
    });
    return shareBuddies
      .filter(b => buddyToday[b.id] && buddyToday[b.id].length > 0)
      .map(b => ({
        ...b,
        // parseTournamentTime is venue-TZ aware AND memoized — sorts
        // by absolute start instant instead of string-comparing "10:00 AM"
        // against "9:00 AM" (which used to put 10 AM before 9 AM).
        todayEvents: (() => {
          const decorated = buddyToday[b.id].map(t => ({ t, ts: parseTournamentTime(t) }));
          decorated.sort((a, c) => a.ts - c.ts);
          return decorated.map(x => x.t);
        })(),
      }));
  }, [shareBuddies, buddyEvents, tournaments]);

  // Merged connections
  const allConnections = useMemo(() => {
    const map = {};
    activeFriends.forEach(f => {
      map[f.id] = { ...f, isPlaying: true, liveUpdate: f.liveUpdate, todayEvents: [] };
    });
    scheduledFriends.forEach(f => {
      if (map[f.id]) {
        map[f.id].todayEvents = f.todayEvents || [];
      } else {
        map[f.id] = { ...f, isPlaying: false, liveUpdate: null, todayEvents: f.todayEvents || [] };
      }
    });
    return Object.values(map).sort((a, b) => (b.isPlaying ? 1 : 0) - (a.isPlaying ? 1 : 0));
  }, [activeFriends, scheduledFriends]);

  const connDropdownRef = useRef(null);
  // The tapped avatar's rect (and its row's left), captured on click like plRect.
  const [connRect, setConnRect] = useState(null);

  useEffect(() => {
    if (!connDropdownId) return;
    const handler = (e) => {
      if (connDropdownRef.current && !connDropdownRef.current.contains(e.target)) {
        setConnDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [connDropdownId]);

  return (
    <div className="dashboard-view">

      {/* Up Next */}
      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div className="dashboard-section-title">Up Next</div>
          {whatsNextEvents.length > 0 && (
            <span className="dashboard-section-badge dashboard-section-badge--wide">{whatsNextEvents.length} event{whatsNextEvents.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        {whatsNextEvents.length > 0 ? (() => {
          const safeIdx = Math.min(selectedUpNextIdx, whatsNextEvents.length - 1);
          swipeRef.current = whatsNextEvents.length;
          return (
            <div
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              style={{overflow:'hidden', touchAction:'pan-y', padding:'0 var(--space-lg) var(--space-lg)', margin:'0 calc(var(--subrow) * -1.5) calc(var(--subrow) * -1.5)'}}
            >
              <div
                className="dash-carousel-track"
                ref={trackRef}
                data-idx={safeIdx}
                style={{transform: `translateX(${-(safeIdx * 100)}%)`}}
              >
                {whatsNextEvents.map((evt, i) => (
                  <div className="dash-carousel-slide" key={evt.id}>
                    {renderEventCard(evt)}
                  </div>
                ))}
              </div>
              {/* Dots only while they stay countable. The carousel now runs
                  the whole schedule, so a full season would be forty dots —
                  past the cap it becomes a position readout instead. */}
              {whatsNextEvents.length > 1 && whatsNextEvents.length <= 8 && (
                <div className="dash-upnext-dots">
                  {whatsNextEvents.map((_, i) => (
                    <button type="button" key={i} className={'dash-upnext-dot' + (i === safeIdx ? ' active' : '')} onClick={() => setSelectedUpNextIdx(i)} aria-label={`Show event ${i + 1}`} aria-current={i === safeIdx} />
                  ))}
                </div>
              )}
              {whatsNextEvents.length > 8 && (
                <div className="dash-upnext-counter">
                  <button
                    type="button"
                    className="dash-upnext-step"
                    onClick={() => setSelectedUpNextIdx(i => Math.max(0, i - 1))}
                    disabled={safeIdx === 0}
                    aria-label="Previous event"
                  ><span className="dash-t">&#8249;</span></button>
                  <span className="dash-upnext-pos">{safeIdx + 1} / {whatsNextEvents.length}</span>
                  <button
                    type="button"
                    className="dash-upnext-step"
                    onClick={() => setSelectedUpNextIdx(i => Math.min(whatsNextEvents.length - 1, i + 1))}
                    disabled={safeIdx === whatsNextEvents.length - 1}
                    aria-label="Next event"
                  ><span className="dash-t">&#8250;</span></button>
                </div>
              )}
            </div>
          );
        })() : (
          <FirstRun
            icon="calendar"
            title="Add your first event"
            body="Anything on your schedule shows up here with its start time, so you know what is next without opening the calendar."
            actionLabel="Browse tournaments"
            onAction={() => onNavigate('tournaments')}
            compact
          />
        )}
      </div>

      {/* Friends Playing */}
      {activeFriends.length > 0 && (
        <div className="dashboard-section" style={{flexShrink: 0}}>
          <div className="dashboard-section-header">
            <div className="dashboard-section-title">Friends Playing</div>
            <span className="dashboard-section-badge">{activeFriends.length} live</span>
          </div>
          <div className="dash-friends-scroll">
            {activeFriends.map(f => {
              const lu = f.liveUpdate;
              const stack = lu?.stack ? Number(lu.stack).toLocaleString() : null;
              const blinds = lu?.bb ? `${lu.sb ? Number(lu.sb).toLocaleString() : '?'}/${Number(lu.bb).toLocaleString()}${(lu.bbAnte || lu.bb_ante) ? '/' + Number(lu.bbAnte || lu.bb_ante).toLocaleString() : ''}` : null;
              return (
                <button type="button" key={f.id} className="dash-friend-chip" onClick={() => onNavigate('social')}>
                  <Avatar src={f.avatar} username={f.username} size={AVATAR_5R} style={f.avatar ? undefined : SEATED_INITIAL} />
                  <div className="friend-info">
                    <div className="friend-name">{displayName(f)}</div>
                    <div className="friend-event">{lu?.eventName || 'Playing'}</div>
                    {stack && (
                      <div className="friend-stack">
                        {stack}{blinds ? ` @ ${blinds}` : ''}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Table Scanner */}
      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div className="dashboard-section-title">Table Scanner <span style={{fontWeight:400,fontSize:'var(--fs-xs)',color:'var(--text-muted)'}}>(WSOP Live / PokerStars Live)</span></div>
        </div>
        <TableScanner />
      </div>

      <div className="dash-bottom-stack">
      {/* Results */}
      <div className="dashboard-section">
        {/* Header on the P&L columns (8g | 8g | 17g): title in col 1, Reset
            right-aligned in col 2 (14-18g) — or Confirm 12-18g + Cancel
            19-25g — and the currency flush right with the Net card (30-36g).
            Every control is a 3r block with its label seated on +2r. */}
        <div className="dashboard-section-header dash-results-header">
          <div className="dashboard-section-title">Results</div>
          {plData.count > 0 && onResetResults && (
            resetConfirmOpen ? (
              <>
                <button
                  type="button"
                  className="dash-results-btn dash-results-reset dash-results-confirm"
                  onClick={() => { onResetResults(); setResetConfirmOpen(false); }}
                ><span>Confirm</span></button>
                <button
                  type="button"
                  className="dash-results-btn dash-results-cancel"
                  onClick={() => setResetConfirmOpen(false)}
                ><span>Cancel</span></button>
              </>
            ) : (
              <button
                type="button"
                className="dash-results-btn dash-results-reset"
                onClick={() => setResetConfirmOpen(true)}
                title="Clear all logged results"
              ><span>Reset</span></button>
            )
          )}
          {plData.count > 0 && dashRates && (
            <label className="dash-results-right dash-results-currency">
              <span aria-hidden="true">
                {dashCurrency === 'NATIVE' ? 'Native' : `${(CURRENCY_CONFIG[dashCurrency] || {}).symbol || ''} ${dashCurrency}`} &#9662;
              </span>
              <select value={dashCurrency} onChange={e => onDashCurrencyChange(e.target.value)} aria-label="Results currency">
                <option value="NATIVE">Native</option>
                {Object.keys(CURRENCY_CONFIG).map(c => (
                  <option key={c} value={c}>{(CURRENCY_CONFIG[c]||{}).symbol} {c}</option>
                ))}
              </select>
            </label>
          )}
          {plData.count > 0 && !dashRates && (
            <span className="dash-results-right dashboard-section-badge dashboard-section-badge--wide">{plData.count} result{plData.count !== 1 ? 's' : ''}</span>
          )}
        </div>
        {plData.count > 0 ? (
          <>
          <div className="dash-pl-grid">
            {(() => { const fmtPl = (v) => formatCurrencyAmount(v, dashCurrency === 'NATIVE' ? 'USD' : dashCurrency); return (<>
            <button type="button" className="dash-pl-card dash-pl-btn" onClick={togglePl('buyins')} aria-expanded={plDropdown === 'buyins'}>
              <div className="dash-pl-value">{fmtPl(plData.invested)}</div>
              <div className="dash-pl-label">Total Buyins &#9662;</div>
              {plDropdown === 'buyins' && createPortal(
                <div className="dash-pl-dropdown portalled" style={plPanelStyle(plRows('invested').length)} onClick={e => e.stopPropagation()}>
                  {plRows('invested')
                    .map(([venue, v]) => (
                      <div key={venue} className="dash-pl-dropdown-row">
                        <span className="dash-pl-dropdown-venue">{venue}</span>
                        <span className="dash-pl-dropdown-amount">{fmtPl(v.invested)}</span>
                      </div>
                    ))
                  }
                </div>,
                document.body
              )}
            </button>
            <button type="button" className="dash-pl-card dash-pl-btn" onClick={togglePl('cashes')} aria-expanded={plDropdown === 'cashes'}>
              <div className="dash-pl-value">{fmtPl(plData.cashed)}</div>
              <div className="dash-pl-label">Cashes &#9662;</div>
              {plDropdown === 'cashes' && createPortal(
                <div className="dash-pl-dropdown portalled" style={plPanelStyle(plRows('cashed').length)} onClick={e => e.stopPropagation()}>
                  {plRows('cashed')
                    .map(([venue, v]) => (
                      <div key={venue} className="dash-pl-dropdown-row">
                        <span className="dash-pl-dropdown-venue">{venue}</span>
                        <span className="dash-pl-dropdown-amount">{fmtPl(v.cashed)}</span>
                      </div>
                    ))
                  }
                </div>,
                document.body
              )}
            </button>
            <div className="dash-pl-card dash-pl-card--net">
              <div className={`dash-pl-value ${plData.net >= 0 ? 'positive' : 'negative'}`}>
                {plData.net >= 0 ? '+' : ''}{fmtPl(plData.net)}
              </div>
              <div className="dash-pl-label">Net</div>
              <div className={`dash-pl-roi ${plData.roi >= 0 ? 'pos' : 'neg'}`}>
                {plData.roi >= 0 ? '+' : ''}{plData.roi.toFixed(1)}% ROI
              </div>
            </div>
            </>); })()}
          </div>
          </>
        ) : (
          <FirstRun
            icon="tracking"
            title="Log your first result"
            body="Cashes and bust-outs both count — your ROI needs a few before it tells you anything."
            actionLabel="Log a result"
            onAction={() => onNavigate('tracking')}
            compact
          />
        )}
      </div>

      {/* Connections */}
      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div className="dashboard-section-title">Connections</div>
          {allConnections.length > 0 && (
            <span className="dashboard-section-badge">
              {activeFriends.length > 0 ? `${activeFriends.length} live` : `${allConnections.length}`}
            </span>
          )}
        </div>
        {allConnections.length > 0 ? (
          <div className="dash-connections-row">
            {/* Eight 4g cells fit 1-36g; past eight, seven avatars and "+N". */}
            {allConnections.slice(0, allConnections.length > 8 ? 7 : 8).map(f => (
              <button
                key={f.id}
                className="dash-conn-avatar"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const row = e.currentTarget.parentElement.getBoundingClientRect();
                  setConnRect({ left: r.left, top: r.top, bottom: r.bottom, rowLeft: row.left });
                  setConnDropdownId(connDropdownId === f.id ? null : f.id);
                }}
                ref={connDropdownId === f.id ? connDropdownRef : undefined}
              >
                <Avatar src={f.avatar} username={f.username} size={AVATAR_5R} style={f.avatar ? undefined : SEATED_INITIAL} />
                {f.isPlaying && <span className="playing-dot" />}
                <span className="conn-name">{displayName(f)}</span>
                {connDropdownId === f.id && connRect && (() => {
                  // Rendered at the document root, so no ancestor's overflow can
                  // clip it. 26g wide, left on the start line of the avatar's own
                  // column (1g or 10g from the row; a col-3/4 avatar uses 10g so
                  // the panel ends on 36g). Height in r is counted from its rows.
                  const { G } = gridGeom();
                  const col = Math.floor(((connRect.left - connRect.rowLeft) / G + 0.5) / 9);
                  const leftG = connRect.rowLeft / G + Math.min(col, 1) * 9;
                  const nToday = (f.todayEvents || []).length;
                  const heightR = 2
                    + (f.isPlaying && f.liveUpdate ? 3 + 2 : 0)
                    + (nToday > 0 ? 3 + 2 * nToday : 0)
                    + (!f.isPlaying && nToday === 0 ? 2 : 0)
                    + 1;
                  const pos = gridPanelStyle(connRect, heightR, leftG);
                  return createPortal(
                    <div className="dash-conn-dropdown portalled" style={pos} onClick={e => e.stopPropagation()}>
                      <div className="dash-conn-dropdown-name">{displayName(f)}</div>
                      {f.isPlaying && f.liveUpdate && (
                        <>
                          <div className="dash-conn-dropdown-label">Now Playing</div>
                          <div className="dash-conn-dropdown-event">
                            {f.liveUpdate.eventName}
                            {f.liveUpdate.stack && <span className="muted"> — {Number(f.liveUpdate.stack).toLocaleString()}</span>}
                          </div>
                        </>
                      )}
                      {f.todayEvents && f.todayEvents.length > 0 && (
                        <>
                          <div className="dash-conn-dropdown-label">{f.isPlaying ? 'Also Scheduled' : 'Scheduled Today'}</div>
                          {f.todayEvents.map((t, i) => {
                            const v = getVenueInfo(t.venue, t.property);
                            return <div key={i} className="dash-conn-dropdown-event">{v.abbr} | {currencySymbol(t.venue)}{Number(t.buyin).toLocaleString()} {t.event_name}</div>;
                          })}
                        </>
                      )}
                      {!f.isPlaying && (!f.todayEvents || f.todayEvents.length === 0) && (
                        <div className="dash-conn-dropdown-event" style={{color:'var(--text-muted)'}}>No events today</div>
                      )}
                    </div>,
                    document.body
                  );
                })()}
              </button>
            ))}
            {allConnections.length > 8 && (
              <button className="dash-conn-overflow" onClick={() => onNavigate('social')} aria-label={`${allConnections.length - 7} more connections`}>
                <span>+{allConnections.length - 7}</span>
              </button>
            )}
          </div>
        ) : (
          <FirstRun
            icon="people"
            title="Connect with other players"
            body="Follow people you play with to see where they are seated and how they are running."
            actionLabel="Find players"
            onAction={() => onNavigate('social')}
            compact
          />
        )}
      </div>
      </div>
    </div>
  );
}
