import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import DateBreak from './DateBreak.jsx';
import CalendarEventRow, { CalendarEventRowLite } from './CalendarEventRow.jsx';
import ScheduleExportModal from './ScheduleExportModal.jsx';
import { FirstRun } from './EmptyState.jsx';
import {
  getVenueInfo, normaliseDate, getToday, fmtShortDate, formatBuyin, currencySymbol,
  parseTournamentTime, findClosestFlight, extractConditions, detectConflicts,
  measureStickyStack,
} from '../utils/utils.js';
import { useDisplayName } from '../contexts/DisplayNameContext.jsx';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Travel Day Picker ──
function TravelDayPicker({ onSave, onCancel }) {
  const [date, setDate] = useState('');
  const [depHour, setDepHour] = useState(8);
  const [depMinute, setDepMinute] = useState(0);
  const [depAmPm, setDepAmPm] = useState('AM');
  const [arrHour, setArrHour] = useState(2);
  const [arrMinute, setArrMinute] = useState(0);
  const [arrAmPm, setArrAmPm] = useState('PM');
  const dateRef = useRef(null);

  const hours = [1,2,3,4,5,6,7,8,9,10,11,12];
  const minutes = [0, 15, 30, 45];
  const fmtTime = (h, m, ap) => `${h}:${String(m).padStart(2,'0')} ${ap}`;

  const handleSave = () => {
    if (!date) return;
    const notes = `Depart ${fmtTime(depHour, depMinute, depAmPm)} → Arrive ${fmtTime(arrHour, arrMinute, arrAmPm)}`;
    onSave(date, notes);
  };

  const selectStyle = {
    padding: '6px 4px', fontSize: '0.85rem', borderRadius: '6px',
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text)', outline: 'none', cursor: 'pointer',
    WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none',
    textAlign: 'center', minWidth: '44px'
  };

  const TimeSelector = ({ hour, minute, amPm, onHour, onMinute, onAmPm, label }) => (
    <div>
      <div style={{fontSize:'0.72rem', color:'var(--text-muted)', marginBottom:'4px', fontWeight: 'var(--fw-bold)'}}>{label}</div>
      <div style={{display:'flex', gap:'3px', alignItems:'center'}}>
        <select value={hour} onChange={e => onHour(Number(e.target.value))} style={selectStyle}>
          {hours.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <span style={{color:'var(--text-muted)', fontWeight:700}}>:</span>
        <select value={minute} onChange={e => onMinute(Number(e.target.value))} style={selectStyle}>
          {minutes.map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
        </select>
        <select value={amPm} onChange={e => onAmPm(e.target.value)} style={{...selectStyle, minWidth:'50px'}}>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </div>
  );

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: '10px', padding: '14px', marginBottom: '12px'
    }}>
      <div style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'12px'}}>
        <span style={{fontSize:'1rem'}}>&#9992;&#65039;</span>
        <span style={{fontWeight:700, fontSize:'0.88rem', color:'var(--text)'}}>Add Travel Day</span>
      </div>
      <div style={{marginBottom:'14px'}}>
        <div style={{fontSize:'0.72rem', color:'var(--text-muted)', marginBottom:'4px', fontWeight: 'var(--fw-bold)'}}>Date</div>
        <input ref={dateRef} type="date" value={date} onChange={e => setDate(e.target.value)}
          // iOS WKWebView frequently fails to open the native date picker
          // for `<input type="date">` inside a fixed-position overlay. Force
          // it with showPicker() — the click handler still counts as a user
          // gesture, and onMouseDown beats the focus race on iOS 17+.
          onMouseDown={e => { try { e.currentTarget.showPicker?.(); } catch {} }}
          onClick={e => { try { e.currentTarget.showPicker?.(); } catch {} }}
          style={{
            padding:'6px 10px', fontSize:'0.85rem', borderRadius:'6px',
            border:'1px solid var(--border)', background:'var(--surface)',
            color:'var(--text)', outline:'none', width:'100%', boxSizing:'border-box'
          }}
        />
      </div>
      <div style={{display:'flex', gap:'16px', marginBottom:'14px', flexWrap:'wrap'}}>
        <TimeSelector label="DEPART" hour={depHour} minute={depMinute} amPm={depAmPm}
          onHour={setDepHour} onMinute={setDepMinute} onAmPm={setDepAmPm} />
        <div style={{display:'flex', alignItems:'flex-end', paddingBottom:'2px'}}>
          <span style={{color:'var(--text-muted)', fontSize:'0.9rem'}}>&rarr;</span>
        </div>
        <TimeSelector label="ARRIVE" hour={arrHour} minute={arrMinute} amPm={arrAmPm}
          onHour={setArrHour} onMinute={setArrMinute} onAmPm={setArrAmPm} />
      </div>
      <div style={{display:'flex', gap:'8px', justifyContent:'flex-end'}}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}
          style={{fontSize:'0.8rem'}}>Cancel</button>
        <button className="btn btn-sm" onClick={handleSave}
          style={{
            fontSize:'0.8rem', background:'var(--accent)', color:'#fff',
            border:'none', borderRadius:'6px', padding:'6px 16px', cursor:'pointer',
            opacity: date ? 1 : 0.4
          }}
          disabled={!date}>Save</button>
      </div>
    </div>
  );
}


export default function ScheduleView({
  mySchedule, onToggle, shareBuddies, pendingIncoming, lastSeenShares,
  onAcceptRequest, onRejectRequest, token, onSetCondition, onRemoveCondition,
  allTournaments, onToggleAnchor, onSetPlannedEntries,
  onAddPersonalEvent, onUpdatePersonalEvent,
  buddyEvents, buddyLiveUpdates, onBuddySwap, isAdmin, onAdminEdit, onClearOverrides,
  onNavigate, focusTournamentId, onFocusConsumed
}) {
  const displayName = useDisplayName();
  const { conflicts, expectedConflicts } = useMemo(() => detectConflicts(mySchedule), [mySchedule]);
  const scheduleIds = useMemo(() => new Set(mySchedule.map(t => t.id)), [mySchedule]);
  const todayRef = useRef(null);
  const hasScrolled = useRef(false);
  const dayOffDateRef = useRef(null);
  const schedHeaderRef = useRef(null);
  const [focusEventId, setFocusEventId] = useState(null);
  const [showTravelPicker, setShowTravelPicker] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [schedDateTop, setSchedDateTop] = useState(0);
  const fabContainerRef = useRef(null);

  // Track which rows have been expanded — only those get the full (heavy)
  // CalendarEventRow component. All others render CalendarEventRowLite
  // (zero hooks, zero context subscriptions).
  const [activatedIds, setActivatedIds] = useState(() => new Set());
  const activateRow = useCallback((id) => {
    setActivatedIds(prev => { const s = new Set(prev); s.add(id); return s; });
  }, []);

  // Progressive rendering: mount first batch instantly, then fill in the rest
  // via animation frames so the tab opens immediately.
  // (The matching useEffect that grows visibleCount lives below the `sorted`
  // declaration — it has to, because its dep array reads `sorted.length`,
  // which would be a TDZ ReferenceError if read here.)
  const [visibleCount, setVisibleCount] = useState(3);
  useLayoutEffect(() => { setVisibleCount(3); setActivatedIds(new Set()); }, [mySchedule]);

  useEffect(() => {
    const measure = () => {
      const el = schedHeaderRef.current;
      if (!el) return;
      // Mirror TournamentsView: offsetHeight + marginTop (margin-top is negative,
      // matching the sticky top: offset, giving the visible header height).
      const mt = parseFloat(getComputedStyle(el).marginTop) || 0;
      setSchedDateTop(Math.max(0, el.offsetHeight + mt));
    };
    measure();
    const t = setTimeout(measure, 60);
    window.addEventListener('resize', measure);
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && schedHeaderRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(schedHeaderRef.current);
    }
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      if (ro) ro.disconnect();
    };
  }, [mySchedule]);

  const todayISO = getToday();

  const sorted = useMemo(() => {
    // Pre-compute timestamps once (O(n)) instead of per-comparison (O(n log n))
    const withTs = mySchedule.map(t => ({ t, ts: parseTournamentTime(t) }));
    withTs.sort((a, b) => a.ts - b.ts);
    return withTs.map(x => x.t);
  }, [mySchedule]);

  // Grow visibleCount by 10 per frame until we've mounted every event.
  // Lives here (not next to setVisibleCount above) because the dep array
  // reads `sorted.length`, which would TDZ-throw if read earlier.
  useEffect(() => {
    if (visibleCount >= sorted.length) return;
    const id = requestAnimationFrame(() => setVisibleCount(v => Math.min(v + 10, sorted.length)));
    return () => cancelAnimationFrame(id);
  }, [visibleCount, sorted.length]);

  // Memoize the non-restart count so the header doesn't run two
  // identical filters every render (audit finding #3).
  const nonRestartCount = useMemo(() => sorted.filter(t => !t.is_restart).length, [sorted]);

  // Pre-group events by date so the render body doesn't re-run the loop.
  const groups = useMemo(() => {
    const result = [];
    let currentGroup = null;
    let globalIdx = 0;
    for (const t of sorted) {
      const d = normaliseDate(t.date);
      if (!currentGroup || currentGroup.date !== d) {
        currentGroup = { date: d, events: [] };
        result.push(currentGroup);
      }
      currentGroup.events.push({ t, globalIdx });
      globalIdx++;
    }
    return result;
  }, [sorted]);

  // Today/Next FAB — mirrors TournamentsView. Renders a button into
  // fabContainerRef, then toggles its `.visible` class based on whether
  // the target group is on screen.
  useEffect(() => {
    const container = document.querySelector('.content-area');
    if (!container) return;
    const panel = container.querySelector('.tab-panel[data-tab="schedule"]') || container;
    const hasTodayEvents = sorted.some(t => normaliseDate(t.date) === todayISO);
    const findTarget = () => {
      if (hasTodayEvents) return panel.querySelector('[data-today-scroll]');
      const groups = panel.querySelectorAll('[data-date-group]');
      for (const g of groups) {
        if (g.getAttribute('data-date-group') >= todayISO) return g;
      }
      return groups.length ? groups[groups.length - 1] : null;
    };
    const fabLabel = hasTodayEvents ? 'Today' : 'Next';
    const fab = document.createElement('button');
    fab.className = 'back-to-today-fab';
    fab.dataset.dir = 'up';
    fab.innerHTML = '<svg class="fab-arrow-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="18 15 12 9 6 15"/></svg><svg class="fab-arrow-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="6 9 12 15 18 9"/></svg>' + fabLabel;
    fab.addEventListener('click', () => {
      const target = findTarget();
      if (!target) return;
      const stickyEl = container.querySelector('.schedule-sticky-header');
      const stickyH = stickyEl ? Math.max(0, stickyEl.getBoundingClientRect().bottom - container.getBoundingClientRect().top) : 0;
      const groupAbsTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: Math.max(0, groupAbsTop - stickyH), behavior: 'smooth' });
    });
    if (fabContainerRef.current) fabContainerRef.current.appendChild(fab);
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const target = findTarget();
        if (!target) { fab.classList.remove('visible'); return; }
        const rect = target.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const pastTarget = rect.bottom < containerRect.top + 120;
        const beforeTarget = rect.top > containerRect.bottom - 60;
        fab.dataset.dir = pastTarget ? 'up' : 'down';
        if (pastTarget || beforeTarget) fab.classList.add('visible');
        else fab.classList.remove('visible');
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    requestAnimationFrame(() => onScroll());
    return () => {
      container.removeEventListener('scroll', onScroll);
      fab.remove();
    };
  }, [sorted, todayISO]);

  useEffect(() => {
    if (sorted.length === 0 || hasScrolled.current || !todayRef.current) return;
    hasScrolled.current = true;
    // Re-fire over a few frames: rows use contentVisibility:auto with a
    // 72px intrinsic placeholder, so the first measured offset is short
    // until the browser materialises them. Same pattern as TournamentsView.
    const settle = (remaining) => {
      const el = todayRef.current;
      if (!el) return;
      const container = el.closest('.content-area') || document.querySelector('.content-area');
      if (!container) return;
      const cRect = container.getBoundingClientRect();
      const sticky = container.querySelector('.schedule-sticky-header');
      const stickyH = sticky ? Math.max(0, sticky.getBoundingClientRect().bottom - cRect.top) : 0;
      const elAbsTop = el.getBoundingClientRect().top - cRect.top + container.scrollTop;
      container.scrollTop = Math.max(0, elAbsTop - stickyH);
      if (remaining > 0) requestAnimationFrame(() => settle(remaining - 1));
    };
    settle(4);
  }, [sorted]);

  const findBestFlightSchedule = useCallback((eventNum, sat) => {
    const flights = sorted.filter(t => t.event_number === eventNum);
    const best = findClosestFlight(flights, parseTournamentTime(sat));
    return best ? best.id : null;
  }, [sorted]);

  const handleNavigateToEvent = useCallback((num, sat) => {
    const targetId = findBestFlightSchedule(num, sat);
    if (targetId) { setFocusEventId(null); setTimeout(() => setFocusEventId(targetId), 0); }
  }, [findBestFlightSchedule]);

  // Arriving from the dashboard's Up Next card. Same null-then-set as above so
  // the row's focus effect re-fires when the same event is opened twice in a
  // row; the row handles expanding and scrolling itself.
  useEffect(() => {
    if (!focusTournamentId) return;
    setFocusEventId(null);
    const t = setTimeout(() => setFocusEventId(focusTournamentId), 0);
    if (onFocusConsumed) onFocusConsumed();
    return () => clearTimeout(t);
  }, [focusTournamentId, onFocusConsumed]);

  return (
    <div>
      {pendingIncoming && pendingIncoming.length > 0 && (
        <div style={{marginBottom:'16px'}}>
          <div className="section-header">
            <h2>Share Requests</h2>
          </div>
          {pendingIncoming.map(req => (
            <div key={req.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              background:'var(--surface)',border:'1px solid var(--border)',
              borderRadius:'var(--radius-sm)',padding:'10px 12px',marginBottom:'8px',
              fontSize:'0.85rem',color:'var(--text)'}}>
              <span style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <Avatar src={req.avatar} username={req.username} size={26} />
                <strong>{displayName(req)}</strong>
                <span style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>wants to share schedules</span>
              </span>
              <span style={{display:'flex',gap:'6px'}}>
                <button className="btn btn-ghost btn-sm" style={{color:'#22c55e',padding:'4px 10px',fontWeight: 'var(--fw-bold)'}} onClick={() => onAcceptRequest(req.id)}>Accept</button>
                <button className="btn btn-ghost btn-sm" style={{color:'#b91c1c',padding:'4px 8px'}} onClick={() => onRejectRequest(req.id)}>Decline</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <FirstRun
          icon="star"
          title="Build your schedule"
          body="Add events from All Tournaments and they collect here, sorted by date with your travel days in between."
          actionLabel="Browse tournaments"
          onAction={onNavigate ? () => onNavigate('tournaments') : undefined}
        />
      ) : (
      <div>
      <div className="schedule-sticky-header" ref={schedHeaderRef}>
        <div className="section-header" style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:0}}>
          <h2 style={{marginRight:'auto',display:'flex',alignItems:'baseline',gap:'6px'}}>
            My Schedule
            <span style={{fontSize:'0.72rem',fontWeight:400,color:'var(--text-muted)'}}>
              · {nonRestartCount} event{nonRestartCount !== 1 ? 's' : ''}
            </span>
          </h2>
          {onAddPersonalEvent && (
            <>
              <button className="btn btn-ghost btn-sm"
                style={{display:'inline-flex',alignItems:'center',gap:'4px',fontSize:'0.78rem',padding:'4px 10px'}}
                onClick={() => setShowTravelPicker(v => !v)}>
                Travel
              </button>
              <button className="btn btn-ghost btn-sm"
                style={{display:'inline-flex',alignItems:'center',gap:'4px',fontSize:'0.78rem',padding:'4px 10px'}}
                onClick={() => dayOffDateRef.current?.showPicker()}>
                Day Off
              </button>
              <input ref={dayOffDateRef} type="date"
                style={{position:'absolute', opacity:0, pointerEvents:'none', width:0, height:0}}
                onChange={e => { if (e.target.value) { onAddPersonalEvent(e.target.value, 'Day Off'); e.target.value = ''; }}} />
            </>
          )}
          <button className="btn btn-ghost btn-sm"
            style={{display:'inline-flex',alignItems:'center',gap:'4px',fontSize:'0.78rem',padding:'4px 10px'}}
            onClick={() => setShowExportModal(true)}
            title="Export schedule">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export
          </button>
        </div>
      </div>
      {onAddPersonalEvent && showTravelPicker && createPortal(
        // Rendered into document.body so opening the picker doesn't grow the
        // sticky header's parent container. iOS WKWebView re-runs sticky
        // layout on container resize, which made the Travel button "jump
        // around" instead of revealing an inline picker below it.
        <div
          style={{
            position:'fixed', inset:0, zIndex:9999,
            background:'rgba(0,0,0,0.55)',
            display:'flex', alignItems:'flex-start', justifyContent:'center',
            padding:'80px 16px 16px', overflowY:'auto'
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowTravelPicker(false); }}
        >
          <div style={{width:'100%', maxWidth:'420px'}}>
            <TravelDayPicker
              onSave={(date, notes) => {
                onAddPersonalEvent(date, 'Travel Day', notes);
                setShowTravelPicker(false);
              }}
              onCancel={() => setShowTravelPicker(false)}
            />
          </div>
        </div>,
        document.body
      )}
      {conflicts.size > 0 && (
        <div className="alert alert-error" style={{marginBottom:'12px'}}>
          <Icon.warn /> {conflicts.size} event{conflicts.size !== 1 ? 's have' : ' has'} a time conflict
        </div>
      )}
      <div style={{minHeight:'100vh', paddingBottom:'100vh'}}>
        {(() => {
          let scrollRefAssigned = false;
          return groups.map((group, gi) => {
            const isGroupToday = group.date === todayISO;
            const dateObj = new Date(group.date + 'T12:00:00');
            const monthAbbr = MONTHS[dateObj.getMonth()];
            const dayOfWeek = ['Su','M','Tu','W','Th','F','Sa'][dateObj.getDay()];
            const dayNum = String(dateObj.getDate()).padStart(2, '0');
            const past = group.date < todayISO;
            const needsRef = !scrollRefAssigned && group.date >= todayISO;
            if (needsRef) scrollRefAssigned = true;
            return (
              <div key={group.date} ref={needsRef ? todayRef : null} data-today-scroll={needsRef ? 'true' : undefined} data-date-group={group.date} style={{marginTop: gi === 0 ? 0 : '8px'}}>
                <DateBreak date={group.date} top={schedDateTop} isToday={isGroupToday} />
                {group.events.map(({ t, globalIdx: gIdx }) => {
                  if (gIdx >= visibleCount) return null;
                  // Today's rows need the full component for MiniLateRegBar timers.
                  // Focused rows need full component for auto-expand.
                  // Activated rows have been tapped open at least once.
                  const needsFull = isGroupToday || activatedIds.has(t.id) || focusEventId === t.id;
                  return (
                  <div key={t.id} style={{contentVisibility:'auto', containIntrinsicSize:'auto 94px'}}>
                    {needsFull ? (
                      <CalendarEventRow
                        tournament={t}
                        isInSchedule={true}
                        onToggle={onToggle}
                        isPast={past}
                        showMiniLateReg={isGroupToday}
                        focusEventId={focusEventId}
                        onNavigateToEvent={handleNavigateToEvent}
                        conditionsJson={t.conditions_json}
                        onSetCondition={onSetCondition}
                        onRemoveCondition={onRemoveCondition}
                        allTournaments={allTournaments}
                        isAnchor={!!t.is_anchor}
                        onToggleAnchor={onToggleAnchor}
                        plannedEntries={t.planned_entries || 1}
                        onSetPlannedEntries={onSetPlannedEntries}
                        onUpdatePersonalEvent={onUpdatePersonalEvent}
                        buddyEvents={buddyEvents}
                        buddyLiveUpdates={buddyLiveUpdates}
                        onBuddySwap={onBuddySwap}
                        scheduleIds={scheduleIds}
                        isAdmin={isAdmin}
                        onAdminEdit={onAdminEdit}
                        onClearOverrides={onClearOverrides}
                        initialOpen={activatedIds.has(t.id)}
                      />
                    ) : (
                      <CalendarEventRowLite
                        tournament={t}
                        isInSchedule={true}
                        isPast={past}
                        isAnchor={!!t.is_anchor}
                        conditionsJson={t.conditions_json}
                        onExpand={() => activateRow(t.id)}
                      />
                    )}
                  </div>
                  );
                })}
              </div>
            );
          });
        })()}
      </div>
      </div>
      )}

      {showExportModal && <ScheduleExportModal events={sorted} onClose={() => setShowExportModal(false)} />}
      <div ref={fabContainerRef} />
    </div>
  );
}
