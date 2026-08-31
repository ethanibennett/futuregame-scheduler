import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import TableScanner from './TableScanner.jsx';
import { FirstRun } from './EmptyState.jsx';
import {
  getVenueInfo, getVenueBrandColor, normaliseDate, getToday, getNow,
  formatBuyin, currencySymbol, nativeCurrency, haptic, fmtShortDate,
  parseTournamentTime, parseDateTimeInTz, parseDateTime, parseLateRegEnd,
  getMaxEntries, getVenueTzAbbr,
  estimateBlindLevel, formatChips,
  convertAmount, formatCurrencyAmount, CURRENCY_CONFIG,
} from '../utils/utils.js';
import { API_URL } from '../utils/api.js';
import { useDisplayName } from '../contexts/DisplayNameContext.jsx';

// ── Format event name: split "Name - Flight A" into two lines ──
function formatEventName(name) {
  if (!name) return name;
  const match = name.match(/^(.+?)\s*-\s*(Flight\s+\w+|Day\s+\d+|Final(?:\s+Day)?|Round\s+\d+|Quarter-?Final|Semi-?Final)$/i);
  if (match) {
    return (
      <>
        {match[1].trim()}
        <br />
        <span style={{ fontSize: '0.78em', opacity: 0.7 }}>{match[2]}</span>
      </>
    );
  }
  return name;
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
function LateRegBar({ lateRegEnd, date, time, venueAbbr, venue }) {
  const [now, setNow] = useState(getNow());
  useEffect(() => {
    const id = setInterval(() => setNow(getNow()), 30000);
    return () => clearInterval(id);
  }, []);

  // Pre-start countdown
  if (date) {
    const startMs = venue ? parseDateTimeInTz(date, time, venue) : parseDateTime(date, time || '12:00 AM');
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
function MiniLateRegBar({ lateRegEnd, date, time, venueAbbr, openOnly, venue }) {
  const [now, setNow] = useState(getNow());
  useEffect(() => {
    const id = setInterval(() => setNow(getNow()), 30000);
    return () => clearInterval(id);
  }, []);

  if (date) {
    const startMs = venue ? parseDateTimeInTz(date, time, venue) : parseDateTime(date, time || '12:00 AM');
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
  onOpenInSchedule
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
    events.sort((a, b) => (typeOrder[a._type] || 2) - (typeOrder[b._type] || 2));

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
  }, [baggedEvents, activePrevDayEvents, todayEvents, mySchedule, todayISO]);

  // Next upcoming event (when nothing today)
  function parseLevelDuration(t) {
    if (!t.level_duration) return null;
    const match = t.level_duration.match(/(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  function isLateRegClosed(t) {
    if (!t.late_reg_end) return false;
    const endMs = parseLateRegEnd(t.late_reg_end, t.date);
    return !isNaN(endMs) && now > endMs;
  }

  // Active event map
  const activeEventMap = useMemo(() => {
    const map = {};
    (myActiveUpdates || []).forEach(u => {
      if (!u.is_busted && !u.is_bagged) map[u.tournament_id] = u;
    });
    return map;
  }, [myActiveUpdates]);

  // Busted event map
  const bustedEventMap = useMemo(() => {
    const map = {};
    (myActiveUpdates || []).forEach(u => {
      if (u.is_busted) map[u.tournament_id] = u;
    });
    return map;
  }, [myActiveUpdates]);

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
    const startMs = parseTournamentTime(event);
    const started = now >= startMs;
    const regClosed = isLateRegClosed(event);
    const levelDuration = parseLevelDuration(event);
    const blindInfo = started && levelDuration ? estimateBlindLevel(startMs, levelDuration) : null;
    const startingChips = event.starting_chips || 20000;

    const currentStack = (activeEventMap[event.id]?.stack) ? Number(activeEventMap[event.id].stack) : startingChips;
    const bbCount = blindInfo ? Math.floor(currentStack / blindInfo.bb) : null;
    const isCurrentlyPlaying = !!activeEventMap[event.id];
    const isExpanded = true;
    const isConditionalOnPlaying = !isCurrentlyPlaying && hasActivePlaying && event._type !== 'bagged';
    const bustedUpdate = bustedEventMap[event.id];
    const isBustedDone = bustedUpdate && (bustedUpdate.bust_count || 1) >= getMaxEntries(event.reentry);

    const venueInfo = getVenueInfo(event.venue, event.property);
    const venueColor = getVenueBrandColor(venueInfo.abbr);
    const venueStripText = venueInfo.abbr === 'WSOP' ? 'var(--bg)' : 'rgba(255,255,255,0.85)';

    const cardClass = [
      'dash-event-card',
      isBustedDone ? 'done' : '',
      event._type === 'bagged' ? 'bagged' : '',
      event._type === 'anchor' && !isConditionalOnPlaying ? 'anchor' : '',
      isConditionalOnPlaying ? 'conditional' : '',
      isCurrentlyPlaying ? 'playing' : 'next-up',
      regClosed && event._type !== 'bagged' ? 'reg-closed' : '',
    ].filter(Boolean).join(' ');

    const cardStyle = isBustedDone ? { borderColor: 'var(--border)' } : {};

    const activeUpdate = activeEventMap[event.id];
    const liveStack = activeUpdate?.stack;
    const stackBB = blindInfo && liveStack ? Math.floor(liveStack / blindInfo.bb) : null;

    // Tapping the card opens this event in My Schedule, expanded. Guarded on
    // swipeDx so finishing a carousel drag over the card does not navigate —
    // the drag distance is reset on every touchstart, so a genuine tap reads 0.
    const openInSchedule = () => {
      if (Math.abs(swipeDx.current || 0) > 10) return;
      if (onOpenInSchedule) onOpenInSchedule(event.id);
    };

    return (
      <div
        key={event.id}
        className={cardClass}
        style={cardStyle}
        role={onOpenInSchedule ? 'button' : undefined}
        tabIndex={onOpenInSchedule ? 0 : undefined}
        /* Raw name, not formatEventName — that returns JSX for "… - Flight A"
           names, which stringifies to [object Object] in an attribute. */
        aria-label={onOpenInSchedule ? `Open ${event.event_name} in My Schedule` : undefined}
        onClick={onOpenInSchedule ? openInSchedule : undefined}
        onKeyDown={onOpenInSchedule ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInSchedule(); }
        } : undefined}
      >
        <div className="dash-venue-strip" style={{background: venueColor, color: venueStripText}}>{venueInfo.abbr}</div>
        <div className="dash-card-content" style={isConditionalOnPlaying ? {borderColor: venueInfo.abbr === 'WSOP' ? 'var(--venue-wsop-cond)' : venueColor} : undefined}>
        {!isConditionalOnPlaying && (
          <div style={{display:'flex',flexWrap:'wrap',gap:'4px',alignItems:'center'}}>
            {event._type === 'bagged' && (
              <span className="dash-event-tag bagged">Bagged — Day {event._bagUpdate?.bag_day || '?'}</span>
            )}
            {event._type === 'anchor' && !event._conditionalOnBag && (
              <span className="dash-event-tag anchor">Locked In</span>
            )}
            {event._type === 'conditional' && (
              <span className="dash-event-tag conditional">
                {event._conditionalOnBag ? 'Conditional on bag' : 'Conditional'}
              </span>
            )}
            {regClosed && event._type !== 'bagged' && (
              <span className="dash-event-tag reg-closed">Reg Closed</span>
            )}
          </div>
        )}

        <div className="dash-event-header">
          <div style={{flex:1}}>
            <div className="dash-event-name">{formatEventName(event.event_name)}</div>
            {!isConditionalOnPlaying && (
              <div className="dash-event-meta" style={{marginTop:'2px'}}>
                {/* The carousel now runs the whole schedule, so a card can be
                    weeks out — time alone would be ambiguous. */}
                {normaliseDate(event.date) !== todayISO && (
                  <span><Icon.calendar /> {fmtShortDate(normaliseDate(event.date))}</span>
                )}
                <span><Icon.clock /> {event.time || 'TBD'}{event.venue ? ' ' + getVenueTzAbbr(event.venue) : ''}</span>
              </div>
            )}
          </div>
          <div className="dash-event-buyin">{formatBuyin(event.buyin, event.venue)}</div>
          {onToggle && (
            <button className="dash-undo-x muted" onClick={(e) => { e.stopPropagation(); if (confirm('Remove from schedule?')) onToggle(event.id); }} title="Remove from schedule">&#10005;</button>
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
              <div className="dash-stat-label">Clock</div>
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
                  <Icon.restart /> Restart in {h}:{String(m).padStart(2, '0')}
                  <button className="dash-unbag-x" onClick={(e) => { e.stopPropagation(); if (confirm('Undo bag?')) undoBag(); }} title="Undo bag">&#10005;</button>
                </div>
              );
            }
          }
          return (
            <div className="dash-restart-badge">
              <Icon.restart /> Bagged
              <button className="dash-unbag-x" onClick={(e) => { e.stopPropagation(); if (confirm('Undo bag?')) undoBag(); }} title="Undo bag">&#10005;</button>
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
                  Finished
                  <button className="dash-undo-x muted" onClick={(e) => {
                    e.stopPropagation();
                    if (bustedUpd?.id && onDeleteUpdate && confirm('Undo finish? This will restore the event to playing.')) onDeleteUpdate(bustedUpd.id);
                  }} title="Undo finish">&#10005;</button>
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
                  }}>Rebuys: {maxEntries >= 99 ? 'Unlimited' : maxEntries - usedEntries}</button>
                ) : (
                  <div className="dash-no-rebuy">All entries used</div>
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
                  <button className="dash-update-btn" onClick={() => setBustMenuEventId(null)}>Cancel</button>
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
                    }}>Rebuys: {maxEntries >= 99 ? 'Unlimited' : maxEntries - bulletNum}</button>
                  )}
                  <button className="dash-bust-btn" onClick={() => {
                    haptic(25);
                    window.dispatchEvent(new CustomEvent('openLiveUpdate', {
                      detail: { tab: 'finish', tournamentId: event.id }
                    }));
                    setBustMenuEventId(null);
                  }}>Finish</button>
                </div>
              );
            }

            return (
              <div className="dash-status-stack">
                <div className="dash-playing-badge">
                  <span className="dash-playing-dot" /> Currently Playing{bulletNum > 1 ? `; Bullet ${bulletNum}` : ''}
                  <button className="dash-undo-x" onClick={(e) => {
                    e.stopPropagation();
                    if (activeUpd?.id && onDeleteUpdate && confirm('Undo playing status for this event?')) onDeleteUpdate(activeUpd.id);
                  }} title="Undo start">&#10005;</button>
                </div>
                <div className="dash-action-row">
                  <button className="dash-update-btn" onClick={() => {
                    window.dispatchEvent(new CustomEvent('openLiveUpdate', {
                      detail: { tab: 'update', tournamentId: event.id }
                    }));
                  }}>Update</button>
                  <button className="dash-bag-btn" onClick={() => {
                    haptic(25);
                    const nextBagDay = (activeUpd?.bag_day || 0) + 1 || 1;
                    window.dispatchEvent(new CustomEvent('openLiveUpdate', {
                      detail: { tab: 'update', tournamentId: event.id, bag: nextBagDay }
                    }));
                  }}>Bag</button>
                  {!regClosed ? (
                    <button className="dash-bust-btn" onClick={() => { haptic(); setBustMenuEventId(event.id); }}>Bust</button>
                  ) : (
                    <button className="dash-bust-btn" onClick={() => {
                      haptic(25);
                      window.dispatchEvent(new CustomEvent('openLiveUpdate', {
                        detail: { tab: 'finish', tournamentId: event.id }
                      }));
                    }}>Finish</button>
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
              <Icon.play /> Start Event
            </button>
          );
        })()}

        {event._type !== 'bagged' && !isBustedDone && !(isConditionalOnPlaying && regClosed) && (
          (bustedEventMap[event.id] || isConditionalOnPlaying) ? (
            <MiniLateRegBar
              lateRegEnd={event.late_reg_end}
              date={event.date}
              time={event.time}
              venueAbbr={getVenueInfo(event.venue, event.property).abbr}
            />
          ) : (
            <LateRegBar
              lateRegEnd={event.late_reg_end}
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
  const plPanelStyle = () => {
    if (!plRect) return { position: 'fixed' };
    const openAbove = plRect.top > window.innerHeight / 2;
    return {
      position: 'fixed',
      left: Math.min(Math.max(8, plRect.left + plRect.width / 2 - 110), window.innerWidth - 228),
      transform: 'none',
      ...(openAbove
        ? { bottom: window.innerHeight - plRect.top + 4 }
        : { top: plRect.bottom + 4 }),
    };
  };

  // Friends currently playing
  const activeFriends = useMemo(() => {
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
  }, [shareBuddies, buddyLiveUpdates]);

  // Friends with events scheduled today
  const scheduledFriends = useMemo(() => {
    if (!shareBuddies || !buddyEvents || !tournaments) return [];
    const buddyToday = {};
    Object.entries(buddyEvents).forEach(([tid, buddies]) => {
      const t = tournaments.find(x => x.id === Number(tid));
      if (!t || t.date !== todayISO) return;
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
            <span className="dashboard-section-badge">{whatsNextEvents.length} event{whatsNextEvents.length !== 1 ? 's' : ''}</span>
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
              style={{overflow:'hidden', touchAction:'pan-y', padding:'0 12px 12px', margin:'0 -12px -12px'}}
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
                  >&#8249;</button>
                  <span className="dash-upnext-pos">{safeIdx + 1} / {whatsNextEvents.length}</span>
                  <button
                    type="button"
                    className="dash-upnext-step"
                    onClick={() => setSelectedUpNextIdx(i => Math.min(whatsNextEvents.length - 1, i + 1))}
                    disabled={safeIdx === whatsNextEvents.length - 1}
                    aria-label="Next event"
                  >&#8250;</button>
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
                  <Avatar src={f.avatar} username={f.username} size={28} />
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
          <div className="dashboard-section-title">Table Scanner <span style={{fontWeight:400,fontSize:'0.7rem',color:'var(--text-muted)'}}>(WSOP Live / PokerStars Live)</span></div>
        </div>
        <TableScanner />
      </div>

      <div className="dash-bottom-stack">
      {/* Results */}
      <div className="dashboard-section">
        {/* Header laid out as a 3-column grid that mirrors the P&L grid
            below: title + Reset on the left (Reset right-aligned to the
            Total Buyins col), empty middle, currency dropdown flush
            right with the Net card. */}
        <div className="dashboard-section-header dash-results-header">
          <div className="dash-results-head-left">
            <div className="dashboard-section-title">Results</div>
            {plData.count > 0 && onResetResults && (
              resetConfirmOpen ? (
                <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}>
                  <button
                    onClick={() => { onResetResults(); setResetConfirmOpen(false); }}
                    style={{fontSize:'0.7rem',fontWeight:700,padding:'3px 8px',border:'1px solid #b91c1c',borderRadius:'5px',background:'#b91c1c',color:'#fff',cursor:'pointer'}}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setResetConfirmOpen(false)}
                    style={{fontSize:'0.7rem',padding:'3px 8px',border:'1px solid var(--border)',borderRadius:'5px',background:'var(--surface)',color:'var(--text-muted)',cursor:'pointer'}}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setResetConfirmOpen(true)}
                  title="Clear all logged results"
                  style={{fontSize:'0.7rem',fontWeight: 'var(--fw-bold)',padding:'3px 8px',border:'1px solid var(--border)',borderRadius:'5px',background:'var(--surface)',color:'var(--text-muted)',cursor:'pointer'}}
                >
                  Reset
                </button>
              )
            )}
          </div>
          <div />{/* empty middle column to mirror the Cashes button */}
          <div style={{justifySelf:'end', alignSelf:'center'}}>
            {plData.count > 0 && dashRates && (
              <select value={dashCurrency} onChange={e => onDashCurrencyChange(e.target.value)}
                style={{fontSize:'0.65rem',padding:'2px 4px',border:'1px solid var(--border)',borderRadius:'5px',
                  background:'var(--surface)',color:'var(--text)',cursor:'pointer',fontWeight: 'var(--fw-bold)'}}>
                <option value="NATIVE">Native</option>
                {Object.keys(CURRENCY_CONFIG).map(c => (
                  <option key={c} value={c}>{(CURRENCY_CONFIG[c]||{}).symbol} {c}</option>
                ))}
              </select>
            )}
            {plData.count > 0 && !dashRates && (
              <span className="dashboard-section-badge">{plData.count} result{plData.count !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
        {plData.count > 0 ? (
          <>
          <div className="dash-pl-grid">
            {(() => { const fmtPl = (v) => formatCurrencyAmount(v, dashCurrency === 'NATIVE' ? 'USD' : dashCurrency); return (<>
            <button type="button" className="dash-pl-card dash-pl-btn" onClick={togglePl('buyins')} aria-expanded={plDropdown === 'buyins'}>
              <div className="dash-pl-value">{fmtPl(plData.invested)}</div>
              <div className="dash-pl-label">Total Buyins &#9662;</div>
              {plDropdown === 'buyins' && createPortal(
                <div className="dash-pl-dropdown portalled" style={plPanelStyle()} onClick={e => e.stopPropagation()}>
                  {Object.entries(plData.byVenue)
                    .filter(([, v]) => v.invested > 0)
                    .sort((a, b) => b[1].invested - a[1].invested)
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
                <div className="dash-pl-dropdown portalled" style={plPanelStyle()} onClick={e => e.stopPropagation()}>
                  {Object.entries(plData.byVenue)
                    .filter(([, v]) => v.cashed > 0)
                    .sort((a, b) => b[1].cashed - a[1].cashed)
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
              <div className="dash-pl-label">
                Net
                <span className={`dash-pl-roi ${plData.roi >= 0 ? 'pos' : 'neg'}`}>
                  {plData.roi >= 0 ? '+' : ''}{plData.roi.toFixed(1)}% ROI
                </span>
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
            {allConnections.slice(0, 10).map(f => (
              <button
                key={f.id}
                className="dash-conn-avatar"
                onClick={() => setConnDropdownId(connDropdownId === f.id ? null : f.id)}
                ref={connDropdownId === f.id ? connDropdownRef : undefined}
              >
                <Avatar src={f.avatar} username={f.username} size={32} />
                {f.isPlaying && <span className="playing-dot" />}
                <span className="conn-name">{displayName(f)}</span>
                {connDropdownId === f.id && (() => {
                  const rect = connDropdownRef.current?.getBoundingClientRect();
                  if (!rect) return null;
                  const openAbove = rect.top > window.innerHeight / 2;
                  // Anchored to the trigger's rect and rendered at the document
                  // root, so no ancestor's overflow can clip it. left is clamped
                  // rather than centred with a transform, which keeps the panel
                  // on screen for the first and last avatar in the row.
                  const pos = {
                    position: 'fixed',
                    left: Math.min(Math.max(8, rect.left + rect.width / 2 - 100), window.innerWidth - 212),
                    transform: 'none',
                    ...(openAbove
                      ? { bottom: window.innerHeight - rect.top + 4 }
                      : { top: rect.bottom + 4 }),
                  };
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
            {allConnections.length > 10 && (
              <button className="dash-conn-overflow" onClick={() => onNavigate('social')}>
                +{allConnections.length - 10}
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
