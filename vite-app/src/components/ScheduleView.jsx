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

  // The picker on the grid (pills-and-buttons rule): every select and button box is whole g by
  // whole r on grid lines, so the form is too — 2r / 1g padding, its outline an inset ring that
  // takes no room, and every row a whole number of r. Selects 4r tall: 4g (hour, minute), 5g
  // (AM/PM), with the ":" in a 1g cell, so one time is 15g and two plus the arrow's 3g fill the
  // phone's 33g. A select's value is centred in it by the select itself (padding 0).
  const selectStyle = {
    padding: 0, fontSize: 'calc(var(--gu) * 1.252)', borderRadius: 'calc(var(--subrow) * 0.75)',
    border: 'var(--bw-hair) solid var(--border)', background: 'var(--surface)',
    color: 'var(--text)', outline: 'none', cursor: 'pointer',
    WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none',
    textAlign: 'center', boxSizing: 'border-box', margin: 0,
    width: 'calc(var(--gu) * 4)', height: 'calc(var(--subrow) * 4)', flex: '0 0 auto'
  };
  const labelStyle = {fontSize:'calc(var(--gu) * 1.060)', color:'var(--text-muted)', lineHeight:'calc(var(--subrow) * 2)', fontWeight: 'var(--fw-bold)'};

  const TimeSelector = ({ hour, minute, amPm, onHour, onMinute, onAmPm, label }) => (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{display:'flex', gap:0, alignItems:'center'}}>
        <select value={hour} onChange={e => onHour(Number(e.target.value))} style={selectStyle}>
          {hours.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <span style={{color:'var(--text-muted)', fontWeight:700, width:'var(--gu)', textAlign:'center', flex:'0 0 auto'}}>:</span>
        <select value={minute} onChange={e => onMinute(Number(e.target.value))} style={selectStyle}>
          {minutes.map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
        </select>
        <select value={amPm} onChange={e => onAmPm(e.target.value)} style={{...selectStyle, width:'calc(var(--gu) * 5)', marginLeft:'var(--gu)'}}>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </div>
  );

  return (
    <div style={{
      background: 'var(--surface)', border: 0, boxShadow: 'inset 0 0 0 var(--bw-hair) var(--border)',
      borderRadius: 'calc(var(--subrow) * 1.25)', padding: 'calc(var(--subrow) * 2) var(--gu)', marginBottom: 'calc(var(--subrow) * 2)'
    }}>
      <div style={{display:'flex', alignItems:'center', gap:'calc(var(--subrow) * 1)', height:'calc(var(--subrow) * 3)', marginBottom:'var(--subrow)'}}>
        <span style={{fontSize:'calc(var(--gu) * 1.473)'}}>&#9992;&#65039;</span>
        <span style={{fontWeight:700, fontSize:'calc(var(--gu) * 1.296)', color:'var(--text)'}}>Add Travel Day</span>
      </div>
      <div style={{marginBottom:'calc(var(--subrow) * 2)'}}>
        <div style={labelStyle}>Date</div>
        <input ref={dateRef} type="date" value={date} onChange={e => setDate(e.target.value)}
          // iOS WKWebView frequently fails to open the native date picker
          // for `<input type="date">` inside a fixed-position overlay. Force
          // it with showPicker() — the click handler still counts as a user
          // gesture, and onMouseDown beats the focus race on iOS 17+.
          onMouseDown={e => { try { e.currentTarget.showPicker?.(); } catch {} }}
          onClick={e => { try { e.currentTarget.showPicker?.(); } catch {} }}
          style={{
            padding:'0 calc(var(--subrow) * 1.25)', fontSize:'calc(var(--gu) * 1.252)', borderRadius:'calc(var(--subrow) * 0.75)',
            border:'var(--bw-hair) solid var(--border)', background:'var(--surface)',
            color:'var(--text)', outline:'none', width:'100%', boxSizing:'border-box',
            height:'calc(var(--subrow) * 4)', margin:0
          }}
        />
      </div>
      <div style={{display:'flex', columnGap:'var(--gu)', rowGap:'var(--subrow)', marginBottom:'calc(var(--subrow) * 2)', flexWrap:'wrap'}}>
        <TimeSelector label="DEPART" hour={depHour} minute={depMinute} amPm={depAmPm}
          onHour={setDepHour} onMinute={setDepMinute} onAmPm={setDepAmPm} />
        <div style={{display:'flex', alignItems:'center', justifyContent:'center', alignSelf:'flex-end', width:'var(--gu)', height:'calc(var(--subrow) * 4)'}}>
          <span style={{color:'var(--text-muted)', fontSize:'calc(var(--gu) * 1.325)', lineHeight:1}}>&rarr;</span>
        </div>
        <TimeSelector label="ARRIVE" hour={arrHour} minute={arrMinute} amPm={arrAmPm}
          onHour={setArrHour} onMinute={setArrMinute} onAmPm={setArrAmPm} />
      </div>
      <div style={{display:'flex', gap:'var(--gu)', justifyContent:'flex-end'}}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}
          style={{fontSize:'calc(var(--gu) * 1.178)', width:'calc(var(--gu) * 7)', padding:0}}>Cancel</button>
        <button className="btn btn-sm" onClick={handleSave}
          style={{
            fontSize:'calc(var(--gu) * 1.178)', background:'var(--accent)', color:'#fff',
            border:'none', borderRadius:'calc(var(--subrow) * 0.75)', padding:0, width:'calc(var(--gu) * 6)', cursor:'pointer',
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
  onNavigate, focusTournamentId, onFocusConsumed,
  // Desktop only (docs/desktop-layout.md): rows select into the detail pane.
  onSelectEvent, selectedEventId
}) {
  // The scroll container is whatever pane this view is mounted in: the phone's
  // .content-area, or a desktop pane's .dk-scroll. Resolved from the view's own
  // root, so two scrollers on one page never answer for each other.
  const rootRef = useRef(null);
  const scroller = () => (rootRef.current && rootRef.current.closest('.content-area, .dk-scroll')) || document.querySelector('.content-area');
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
      // Mirror TournamentsView: FRACTIONAL height (getBoundingClientRect) +
      // marginTop, so the date break pins flush against the sub-pixel bar bottom.
      // offsetHeight rounds to an integer and leaves a hairline seam that clips
      // the pill's top (see the TournamentsView note).
      const mt = parseFloat(getComputedStyle(el).marginTop) || 0;
      setSchedDateTop(Math.max(0, el.getBoundingClientRect().height + mt));
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
    const container = scroller();
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
    fab.innerHTML = '<svg class="fab-arrow-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:calc(var(--subrow) * 1.75);height:calc(var(--subrow) * 1.75)"><polyline points="18 15 12 9 6 15"/></svg><svg class="fab-arrow-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:calc(var(--subrow) * 1.75);height:calc(var(--subrow) * 1.75)"><polyline points="6 9 12 15 18 9"/></svg><span class="ctl-cap">' + fabLabel + '</span>';
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
    // In a desktop pane this view mounts at page load, not on a tap, so the rows
    // above today are still mounting in batches; land once they all exist.
    if (onSelectEvent && visibleCount < sorted.length) return;
    hasScrolled.current = true;
    // Re-fire over a few frames: rows use contentVisibility:auto with a
    // 72px intrinsic placeholder, so the first measured offset is short
    // until the browser materialises them. Same pattern as TournamentsView.
    const settle = (remaining) => {
      const el = todayRef.current;
      if (!el) return;
      const container = el.closest('.content-area, .dk-scroll') || document.querySelector('.content-area');
      if (!container) return;
      const cRect = container.getBoundingClientRect();
      const sticky = container.querySelector('.schedule-sticky-header');
      // Where the header's bottom sits once it is STUCK: its sticky `top` plus its height. Measuring
      // its bottom at scrollTop 0 counted whatever sits above it in flow too, and landed the next
      // event 26px low on a phone, with a strip of the past day still showing above it.
      const stuckTop = sticky ? (parseFloat(getComputedStyle(sticky).top) || 0) : 0;
      const stickyH = sticky ? Math.max(0, stuckTop + sticky.getBoundingClientRect().height) : 0;
      const elAbsTop = el.getBoundingClientRect().top - cRect.top + container.scrollTop;
      container.scrollTop = Math.max(0, elAbsTop - stickyH);
      if (remaining > 0) requestAnimationFrame(() => settle(remaining - 1));
    };
    settle(4);
  }, [sorted, visibleCount, onSelectEvent]);

  const findBestFlightSchedule = useCallback((eventNum, sat) => {
    const flights = sorted.filter(t => t.event_number === eventNum);
    const best = findClosestFlight(flights, parseTournamentTime(sat));
    return best ? best.id : null;
  }, [sorted]);

  const handleNavigateToEvent = useCallback((num, sat) => {
    const targetId = findBestFlightSchedule(num, sat);
    if (targetId && onSelectEvent) { onSelectEvent(targetId); return; }
    if (targetId) { setFocusEventId(null); setTimeout(() => setFocusEventId(targetId), 0); }
  }, [findBestFlightSchedule, onSelectEvent]);

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
    <div ref={rootRef}>
      {pendingIncoming && pendingIncoming.length > 0 && (
        <div style={{marginBottom:'calc(var(--subrow) * 2)'}}>
          {/* Whole r, so My Schedule below stays on the grid: a 4r header and a 6r row (1r padding
              round the 4r buttons, the outline an inset ring that takes no room). It was
              3.40r + 6.76r, which put every card, pill and strip under it 0.16r off its line. */}
          <div className="section-header" style={{height:'calc(var(--subrow) * 4)'}}>
            <h2>Share Requests</h2>
          </div>
          {pendingIncoming.map(req => (
            <div key={req.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              background:'var(--surface)',border:0,boxShadow:'inset 0 0 0 var(--bw-hair) var(--border)',
              // 1g sides (it was 1.5r, 1.065g): Accept and Decline, flush right, end on a g line.
              borderRadius:'var(--radius-sm)',padding:'var(--subrow) var(--gu)',marginBottom:'calc(var(--subrow) * 1)',
              fontSize:'calc(var(--gu) * 1.252)',color:'var(--text)'}}>
              <span style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 1)'}}>
                <Avatar src={req.avatar} username={req.username} size={26} />
                <strong>{displayName(req)}</strong>
                <span style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)'}}>wants to share schedules</span>
              </span>
              <span style={{display:'flex',gap:'var(--gu)'}}>
                <button className="btn btn-ghost btn-sm" style={{color:'#22c55e',width:'calc(var(--gu) * 6)',padding:0,fontWeight: 'var(--fw-bold)'}} onClick={() => onAcceptRequest(req.id)}>Accept</button>
                <button className="btn btn-ghost btn-sm" style={{color:'#b91c1c',width:'calc(var(--gu) * 6)',padding:0}} onClick={() => onRejectRequest(req.id)}>Decline</button>
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
        <div className="section-header" style={{display:'flex',alignItems:'center',gap:'var(--gu)',marginBottom:0}}>
          <h2 style={{marginRight:'auto',display:'flex',alignItems:'baseline',gap:'calc(var(--subrow) * 0.75)'}}>
            My Schedule
            <span style={{fontSize:'calc(var(--gu) * 1.060)',fontWeight:400,color:'var(--text-muted)'}}>
              · {nonRestartCount} event{nonRestartCount !== 1 ? 's' : ''}
            </span>
          </h2>
          {onAddPersonalEvent && (
            <>
              <button className="btn btn-ghost btn-sm"
                style={{width:'calc(var(--gu) * 5)',flex:'0 0 auto',gap:'calc(var(--subrow) * 0.5)',fontSize:'calc(var(--gu) * 1.149)',padding:0}}
                onClick={() => setShowTravelPicker(v => !v)}>
                Travel
              </button>
              <button className="btn btn-ghost btn-sm"
                style={{width:'calc(var(--gu) * 6)',flex:'0 0 auto',gap:'calc(var(--subrow) * 0.5)',fontSize:'calc(var(--gu) * 1.149)',padding:0}}
                onClick={() => dayOffDateRef.current?.showPicker()}>
                Day Off
              </button>
              <input ref={dayOffDateRef} type="date"
                style={{position:'absolute', opacity:0, pointerEvents:'none', width:0, height:0}}
                onChange={e => { if (e.target.value) { onAddPersonalEvent(e.target.value, 'Day Off'); e.target.value = ''; }}} />
            </>
          )}
          <button className="btn btn-ghost btn-sm"
            style={{width:'calc(var(--gu) * 7)',flex:'0 0 auto',gap:'calc(var(--subrow) * 0.5)',fontSize:'calc(var(--gu) * 1.149)',padding:0}}
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
            // 1g sides and a 37g cap (an odd number of g, so centred in the window it still starts
            // on a g line of the centred shell): the picker's controls land on the grid.
            padding:'calc(var(--subrow) * 10) var(--gu) calc(var(--subrow) * 2)', overflowY:'auto'
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowTravelPicker(false); }}
        >
          <div style={{width:'100%', maxWidth:'calc(var(--gu) * 37)'}}>
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
        <div className="alert alert-error" style={{marginBottom:'var(--subrow)'}}>
          <Icon.warn /> {conflicts.size} event{conflicts.size !== 1 ? 's have' : ' has'} a time conflict
        </div>
      )}
      <div style={{minHeight:'100vh', paddingBottom:'100vh'}}>
        {(() => {
          // Land on the next event; with nothing upcoming, on the most recent one (the end of the
          // list) rather than leaving the oldest past event on top.
          const nextIdx = groups.findIndex(g => g.date >= todayISO);
          const anchorIdx = nextIdx >= 0 ? nextIdx : groups.length - 1;
          return groups.map((group, gi) => {
            const isGroupToday = group.date === todayISO;
            const dateObj = new Date(group.date + 'T12:00:00');
            const monthAbbr = MONTHS[dateObj.getMonth()];
            const dayOfWeek = ['Su','M','Tu','W','Th','F','Sa'][dateObj.getDay()];
            const dayNum = String(dateObj.getDate()).padStart(2, '0');
            const past = group.date < todayISO;
            const needsRef = gi === anchorIdx;
            return (
              <div key={group.date} ref={needsRef ? todayRef : null} data-today-scroll={needsRef ? 'true' : undefined} data-date-group={group.date} style={{marginTop: gi === 0 ? 0 : 'calc(var(--subrow) * 1)'}}>
                <DateBreak date={group.date} top={schedDateTop} isToday={isGroupToday} />
                {group.events.map(({ t, globalIdx: gIdx }) => {
                  if (gIdx >= visibleCount) return null;
                  // Today's rows need the full component for MiniLateRegBar timers.
                  // Focused rows need full component for auto-expand.
                  // Activated rows have been tapped open at least once.
                  const needsFull = isGroupToday || activatedIds.has(t.id) || focusEventId === t.id;
                  return (
                  // A row not yet rendered stands in at a whole 13r (a 12r card and its 1r gap, as
                  // the Schedule tab's list does): at 11.75r every unrendered row above the one
                  // scrolled to put everything under it a fraction of an r off the grid.
                  <div key={t.id} style={{contentVisibility:'auto', containIntrinsicSize:'auto calc(var(--subrow) * 13)'}}>
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
                        onSelect={onSelectEvent}
                        selected={onSelectEvent ? selectedEventId === t.id : undefined}
                      />
                    ) : (
                      <CalendarEventRowLite
                        tournament={t}
                        isInSchedule={true}
                        isPast={past}
                        isAnchor={!!t.is_anchor}
                        conditionsJson={t.conditions_json}
                        onExpand={() => activateRow(t.id)}
                        onSelect={onSelectEvent}
                        selected={onSelectEvent ? selectedEventId === t.id : undefined}
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
