import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { wsopStructureUrlFor } from '../utils/wsop-structure-pages.js';
import {
  getVenueInfo, getVenueClass, getVenueBrandColor, getVariantColor, isBraceletEvent, isRingEvent,
  normaliseDate, parseDateTime, parseDateTimeInTz, parseLateRegEnd, parseTournamentTime,
  getMaxEntries, getVenueTimezone, getVenueTzAbbr, getNow,
  extractConditions, formatConditionLabel, formatConditionBadge,
  getIfIBustEvents, getIfIBagEvents, getGamePills, calculateCountdown, haptic,
  currencySymbol, nativeCurrency, CURRENCY_CONFIG, formatCurrencyAmount,
  VENUE_TO_SERIES, VENUE_BRAND_VAR, isPOYEligible, calculatePOYPoints, isSixMax,
  HAND_CONFIG, HAND_CONFIG_DEFAULT,
} from '../utils/utils.js';
import { API_URL } from '../utils/api.js';
import { useDisplayName } from '../contexts/DisplayNameContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

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

// Build-29 behavior: sum the bounding heights of every sticky element
// above the card and subtract from the card's absolute top. The natural
// 12-20px gap that falls out of using offsetHeight (which includes the
// sticky's negative margin-top extension) is the "looks right" buffer
// the user signed off on for the Schedule tab. Same code path is used
// by every view; gap scales with that view's sticky stack.
function scrollBelowSticky(el) {
  const container = el.closest('.content-area');
  if (!container) return;
  const caTop = container.getBoundingClientRect().top;
  // CRITICAL: every tab-panel lives inside .content-area, just hidden
  // via display:none. Searching from .content-area returns the FIRST
  // matching sticky in document order — which is the HIDDEN Schedule
  // tab's .sticky-filters whenever the user is on My Schedule or
  // Calendar, with offsetHeight = 0. Scope the lookup to the row's
  // own tab-panel so we measure the visible sticky on every view.
  const scope = el.closest('.tab-panel') || container;
  let filtersH = 0;
  const sticky = scope.querySelector('.sticky-filters')
              || scope.querySelector('.schedule-sticky-header');
  if (sticky) filtersH = sticky.getBoundingClientRect().height;
  let dateBreakH = 0;
  const dateGroup = el.closest('[data-date-group]');
  if (dateGroup) {
    const db = dateGroup.querySelector('.schedule-date-break');
    if (db) dateBreakH = db.getBoundingClientRect().height;
  }
  const elAbsTop = el.getBoundingClientRect().top - caTop + container.scrollTop;
  // Calendar has NO date-break and the page sticky carries a 4px
  // box-shadow that extends below the bounding rect, eating the
  // natural gap. Add 4px back so the gap matches Schedule/My Schedule.
  const stickyShadowComp = (dateBreakH === 0) ? 4 : 0;
  const target = elAbsTop - filtersH - dateBreakH - 2 - stickyShadowComp;
  if (Math.abs(container.scrollTop - target) <= 2) return;
  container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

// ── Late Reg Bar (expanded view) ──
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
  const brandColor = getVenueBrandColor(venueAbbr);

  let status, label, timeStr;
  if (diffMs <= 0) {
    status = 'closed';
    label = 'Late Reg Closed';
    timeStr = null;
  } else if (diffMin < 30) {
    status = 'urgent';
    label = 'Late Reg \u2014 Closing Soon';
    timeStr = `${diffMin}m left | ${endClock}`;
  } else if (diffMin < 120) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    status = 'soon';
    label = 'Late Reg Open';
    timeStr = (h > 0 ? `${h}h ${m}m left` : `${m}m left`) + ` | ${endClock}`;
  } else {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    status = 'open';
    label = 'Late Reg Open';
    timeStr = (h > 0 ? `${h}h ${m}m left` : `${m}m left`) + ` | ${endClock}`;
  }

  const windowMs = 12 * 60 * 60 * 1000;
  const pct = status === 'closed' ? 0 : Math.min(100, Math.max(0, (diffMs / windowMs) * 100));
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

// ── Mini Late Reg Bar (collapsed view) ──
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
      const totalSec = Math.floor((startMs - now) / 1000);
      const d = Math.floor(totalSec / 86400);
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      let label;
      if (d > 0) label = `${d}d ${h}h`;
      else if (h > 0) label = `${h}h ${m}m`;
      else label = `${m}m`;
      const diffMs = startMs - now;
      const windowMs = 12 * 60 * 60 * 1000;
      const pct = Math.min(100, Math.max(0, (diffMs / windowMs) * 100));
      const brandColor = getVenueBrandColor(venueAbbr);
      return (
        <div className="mini-late-reg">
          <span className="mini-late-reg-time" style={{opacity:0.5}}>starts in {label}</span>
          <div className="mini-late-reg-track">
            <div className="mini-late-reg-fill" style={{ width: `${pct}%`, background: brandColor }} />
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
  const endClock = new Date(endMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (diffMs <= 0) {
    if (openOnly) return null;
    return (
      <div className="mini-late-reg">
        <span className="mini-late-reg-time" style={{opacity:0.4}}>late reg closed</span>
        <div className="mini-late-reg-track">
          <div className="mini-late-reg-fill" style={{ width: '0%' }} />
        </div>
      </div>
    );
  }

  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  const timeStr = (h > 0 ? `${h}h ${m}m` : `${m}m`) + ` | ${endClock}`;
  const windowMs = 12 * 60 * 60 * 1000;
  const pct = Math.min(100, Math.max(0, (diffMs / windowMs) * 100));
  const brandColor = getVenueBrandColor(venueAbbr);
  const critical = pct <= 15;

  return (
    <div className="mini-late-reg">
      <span className="mini-late-reg-time">late reg {timeStr}</span>
      <div className="mini-late-reg-track">
        <div className={`mini-late-reg-fill ${critical ? 'critical' : ''}`} style={{ width: `${pct}%`, background: critical ? undefined : brandColor }} />
      </div>
    </div>
  );
}

// ── Buddy Avatar Row ──
// Connected accounts who are also playing this event. Renders each as a
// rounded chip: the proper Avatar component (image if buddy.avatar is set,
// otherwise an initial-colored circle from Avatar's hue fallback) followed by
// their display name. Previously rendered raw <span> elements with classes
// like `.buddy-chip-avatar` that have no matching CSS, which made the chip
// collapse to the bare username text in the flow.
function BuddyAvatarRow({ buddies, liveUpdates, onBuddyClick }) {
  if (!buddies || buddies.length === 0) return null;
  return (
    <div
      className="buddy-avatar-row"
      style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px', alignItems: 'center' }}
    >
      {buddies.map((b, i) => {
        const name = b.username || b.real_name || '?';
        return (
          <span
            key={b.id ?? i}
            className="buddy-chip"
            style={{
              cursor: onBuddyClick ? 'pointer' : 'default',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 10px 3px 3px',
              borderRadius: '999px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              fontSize: '0.78rem',
              color: 'var(--text)',
              userSelect: 'none',
            }}
            onClick={() => onBuddyClick && onBuddyClick(b)}
            title={name}
          >
            <Avatar src={b.avatar} username={name} size={22} />
            <span>{name}</span>
          </span>
        );
      })}
    </div>
  );
}

// ── ConditionPicker (full version matching original) ──
function ConditionPicker({ tournament, conditions, allTournaments, onSet, onRemove, onClose, scheduleIds, onToggle }) {
  const existingSat = conditions.find(c => c.type === 'IF_WIN_SEAT' || c.type === 'IF_NO_SEAT');
  const existingProfit = conditions.find(c => c.type === 'PROFIT_THRESHOLD');
  const existingBust = conditions.find(c => c.type === 'IF_BUST');
  const existingBag = conditions.find(c => c.type === 'IF_BAG');

  const [satEnabled, setSatEnabled] = useState(!!existingSat);
  const [satType, setSatType] = useState(existingSat ? existingSat.type : 'IF_WIN_SEAT');
  const [selectedSatId, setSelectedSatId] = useState(existingSat ? existingSat.dependsOnId : null);
  const [satSearch, setSatSearch] = useState('');
  const [profitEnabled, setProfitEnabled] = useState(!!existingProfit);
  const [profitAmount, setProfitAmount] = useState(existingProfit ? existingProfit.profitThreshold : '');
  const [bustEnabled, setBustEnabled] = useState(!!existingBust);
  const [selectedBustId, setSelectedBustId] = useState(existingBust ? existingBust.dependsOnId : null);
  const [bagEnabled, setBagEnabled] = useState(!!existingBag);
  const [selectedBagId, setSelectedBagId] = useState(existingBag ? existingBag.dependsOnId : null);

  const bustEvents = useMemo(() => {
    return getIfIBustEvents(tournament, allTournaments, scheduleIds);
  }, [tournament, allTournaments, scheduleIds]);
  const bagEvents = useMemo(() => {
    return getIfIBagEvents(tournament, allTournaments, scheduleIds);
  }, [tournament, allTournaments, scheduleIds]);
  const [isPublic, setIsPublic] = useState(
    tournament.condition_is_public !== undefined && tournament.condition_is_public !== null
      ? !!tournament.condition_is_public
      : true
  );

  const suggestedSatellites = useMemo(() =>
    allTournaments.filter(t => t.is_satellite && t.target_event === tournament.event_number),
    [allTournaments, tournament.event_number]
  );

  const searchResults = useMemo(() => {
    if (!satSearch.trim()) return [];
    const q = satSearch.toLowerCase();
    return allTournaments.filter(t =>
      t.id !== tournament.id &&
      ((t.event_number || '').toLowerCase().includes(q) || (t.event_name || '').toLowerCase().includes(q))
    ).slice(0, 8);
  }, [allTournaments, satSearch, tournament.id]);

  const canSubmit = (satEnabled && selectedSatId) || (profitEnabled && profitAmount && parseInt(profitAmount) !== 0) || (bustEnabled && selectedBustId) || (bagEnabled && selectedBagId);

  const handleSubmit = () => {
    if (!canSubmit) return;
    const result = [];
    if (satEnabled && selectedSatId) {
      result.push({ type: satType, dependsOnId: selectedSatId });
    }
    if (profitEnabled && profitAmount && parseInt(profitAmount) !== 0) {
      result.push({ type: 'PROFIT_THRESHOLD', profitThreshold: parseInt(profitAmount) });
    }
    if (bustEnabled && selectedBustId) {
      result.push({ type: 'IF_BUST', dependsOnId: selectedBustId });
    }
    if (bagEnabled && selectedBagId) {
      result.push({ type: 'IF_BAG', dependsOnId: selectedBagId });
    }
    onSet(result, isPublic);
  };

  const renderItem = (t) => (
    <div
      key={t.id}
      className={`condition-sat-item ${selectedSatId === t.id ? 'selected' : ''}`}
      onClick={() => setSelectedSatId(t.id)}
    >
      <span style={{fontWeight:600,flexShrink:0}}>#{t.event_number}</span>
      <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.event_name}</span>
      <span style={{flexShrink:0,color:'var(--text-muted)',fontSize:'0.72rem'}}>${t.buyin}</span>
    </div>
  );

  const checkboxStyle = {
    width: '16px', height: '16px', accentColor: 'var(--accent)', cursor: 'pointer'
  };
  const sectionLabelStyle = {
    fontSize: '0.82rem', fontFamily: "'Univers Condensed','Univers',sans-serif", fontWeight: 600, color: 'var(--text)', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '8px'
  };

  return (
    <div className="condition-picker">
      <div className="condition-picker-title">Set Conditions</div>

      {/* Satellites checkbox */}
      <label style={{...sectionLabelStyle, marginBottom: satEnabled ? '8px' : '12px'}}>
        <input type="checkbox" checked={satEnabled} onChange={e => setSatEnabled(e.target.checked)} style={checkboxStyle} />
        Satellites
      </label>

      {satEnabled && (
        <div style={{paddingLeft:'24px',marginBottom:'12px'}}>
          <div className="condition-type-row" style={{marginBottom:'8px'}}>
            <button className={`condition-type-btn ${satType === 'IF_WIN_SEAT' ? 'active' : ''}`} onClick={() => setSatType('IF_WIN_SEAT')}>
              If I win a seat
            </button>
            <button className={`condition-type-btn ${satType === 'IF_NO_SEAT' ? 'active' : ''}`} onClick={() => setSatType('IF_NO_SEAT')}>
              If I don't win a seat
            </button>
          </div>

          {suggestedSatellites.length > 0 && (
            <>
              <div style={{fontSize:'0.68rem',fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'4px'}}>
                Related Satellites
              </div>
              <div className="condition-sat-list">
                {suggestedSatellites.map(renderItem)}
              </div>
            </>
          )}

          <div style={{fontSize:'0.68rem',fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'4px'}}>
            {suggestedSatellites.length > 0 ? 'Or search any event' : 'Search for an event'}
          </div>
          <input
            className="condition-search"
            placeholder="Event name or number..."
            value={satSearch}
            onChange={e => setSatSearch(e.target.value)}
          />
          {searchResults.length > 0 && (
            <div className="condition-sat-list">
              {searchResults.map(renderItem)}
            </div>
          )}
        </div>
      )}

      {/* Profit / Loss checkbox */}
      <label style={{...sectionLabelStyle, marginBottom: profitEnabled ? '8px' : '12px'}}>
        <input type="checkbox" checked={profitEnabled} onChange={e => setProfitEnabled(e.target.checked)} style={checkboxStyle} />
        Profit / Loss
      </label>

      {profitEnabled && (
        <div style={{paddingLeft:'24px',marginBottom:'12px'}}>
          <div style={{fontSize:'0.68rem',fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'4px'}}>
            Profit threshold ($)
          </div>
          <input
            className="condition-search"
            type="number"
            placeholder="e.g. 5000"
            value={profitAmount}
            onChange={e => setProfitAmount(e.target.value)}
          />
          <span style={{fontSize:'0.7rem',color:'var(--text-muted)',display:'block',marginTop:'2px'}}>
            I'll play this event if I'm up at least this amount
          </span>
        </div>
      )}

      {/* If I Bust checkbox */}
      {bustEvents.length > 0 && (
        <>
        <label style={{...sectionLabelStyle, marginBottom: bustEnabled ? '8px' : '12px'}}>
          <input type="checkbox" checked={bustEnabled} onChange={e => setBustEnabled(e.target.checked)} style={checkboxStyle} />
          If I Bust
        </label>

        {bustEnabled && (
          <div style={{paddingLeft:'24px',marginBottom:'12px'}}>
            <div style={{fontSize:'0.68rem',fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'4px'}}>
              I'll play this if I bust from:
            </div>
            <div className="condition-sat-list">
              {bustEvents.map(t => (
                <div
                  key={t.id}
                  className={`condition-sat-item ${selectedBustId === t.id ? 'selected' : ''}`}
                  onClick={() => setSelectedBustId(t.id === selectedBustId ? null : t.id)}
                >
                  <span style={{fontWeight:600,flexShrink:0,fontSize:'0.72rem',color:'var(--text-muted)'}}>{t.time}</span>
                  <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.event_name}</span>
                  <span style={{flexShrink:0,color:'var(--text-muted)',fontSize:'0.72rem'}}>{currencySymbol(t.venue)}{Number(t.buyin).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </>
      )}

      {/* If I Bag checkbox */}
      {bagEvents.length > 0 && (
        <>
        <label style={{...sectionLabelStyle, marginBottom: bagEnabled ? '8px' : '12px'}}>
          <input type="checkbox" checked={bagEnabled} onChange={e => setBagEnabled(e.target.checked)} style={checkboxStyle} />
          If I Bag
        </label>

        {bagEnabled && (
          <div style={{paddingLeft:'24px',marginBottom:'12px'}}>
            <div style={{fontSize:'0.68rem',fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'4px'}}>
              I'll play this if I bag from:
            </div>
            <div className="condition-sat-list">
              {bagEvents.map(t => (
                <div
                  key={t.id}
                  className={`condition-sat-item ${selectedBagId === t.id ? 'selected' : ''}`}
                  onClick={() => setSelectedBagId(t.id === selectedBagId ? null : t.id)}
                >
                  <span style={{fontWeight:600,flexShrink:0,fontSize:'0.72rem',color:'var(--text-muted)'}}>#{t.event_number}</span>
                  <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.event_name}</span>
                  <span style={{flexShrink:0,color:'var(--text-muted)',fontSize:'0.72rem'}}>{currencySymbol(t.venue)}{Number(t.buyin).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </>
      )}

      {/* Public toggle */}
      <div
        style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'4px',fontSize:'0.75rem',fontFamily:"'Univers Condensed','Univers',sans-serif",color:'var(--text-muted)',cursor:'pointer',userSelect:'none'}}
        onClick={() => setIsPublic(p => !p)}
      >
        <div style={{
          width:'32px',height:'18px',borderRadius:'9px',
          background: isPublic ? 'var(--accent)' : 'var(--border)',
          position:'relative',transition:'background 0.2s'
        }}>
          <div style={{
            width:'14px',height:'14px',borderRadius:'50%',background:'#fff',
            position:'absolute',top:'2px',
            left: isPublic ? '16px' : '2px',
            transition:'left 0.2s'
          }} />
        </div>
        <span style={{color:'var(--text)'}}>Show conditions on shared schedule</span>
      </div>

      {/* Action buttons */}
      <div style={{display:'flex',gap:'8px',marginTop:'8px'}}>
        <button
          className="condition-type-btn active"
          style={{flex:1,opacity:canSubmit ? 1 : 0.4,pointerEvents:canSubmit ? 'auto' : 'none'}}
          onClick={handleSubmit}
        >
          Set Conditions
        </button>
        <button className="condition-type-btn" style={{flex:'0 0 auto'}} onClick={onClose}>
          Cancel
        </button>
      </div>

      {conditions.length > 0 && (
        <button
          style={{marginTop:'8px',background:'none',border:'none',color:'var(--accent2)',fontSize:'0.75rem',cursor:'pointer',padding:'4px 0',fontFamily:"'Univers Condensed','Univers',sans-serif",fontWeight:600}}
          onClick={onRemove}
        >
          Remove All Conditions
        </button>
      )}
    </div>
  );
}

function CalendarEventRow_({ tournament, isInSchedule, onToggle, isPast, showMiniLateReg, focusEventId, readOnly, conditions: conditionsProp, conditionsJson, onSetCondition, onRemoveCondition, allTournaments, isAnchor, onToggleAnchor, plannedEntries, onSetPlannedEntries, onUpdatePersonalEvent, buddyEvents, buddyLiveUpdates, onBuddySwap, scheduleIds, isAdmin, onAdminEdit, onNavigateToEvent, initialOpen }) {
  // Support both conditions array (legacy) and conditionsJson string (memo-friendly)
  const conditions = conditionsProp || React.useMemo(() => {
    if (!conditionsJson) return [];
    try { const c = JSON.parse(conditionsJson); return Array.isArray(c) ? c : []; }
    catch { return []; }
  }, [conditionsJson]);
  const [open, setOpen] = useState(!!initialOpen);
  const [showConditionUI, setShowConditionUI] = useState(false);
  const [showRakeBreakdown, setShowRakeBreakdown] = useState(false);
  const [travelNotes, setTravelNotes] = useState(tournament.notes || '');
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const displayName = useDisplayName();
  const rowRef = useRef(null);

  // Auto-expand when programmatically focused (e.g. navigating to a
  // related satellite).
  useEffect(() => {
    if (focusEventId && tournament.id === focusEventId) {
      setOpen(true);
    }
  }, [focusEventId]);

  // Always scroll on expand — every view uses the same rule with the
  // build-29 sticky-stack math; the natural gap below the sticky stack
  // scales per view (Schedule = filters + date-break, My Schedule =
  // schedule-header + date-break, Calendar = filters only).
  useEffect(() => {
    if (!open || !rowRef.current) return;
    const raf = requestAnimationFrame(() => {
      if (rowRef.current) scrollBelowSticky(rowRef.current);
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const tzAbbr = getVenueTzAbbr(tournament.venue);
  const timeLabel = (tournament.time || '\u2014') + (tzAbbr ? ' ' + tzAbbr : '');
  const bracelet = isBraceletEvent(tournament);
  const venueClass = getVenueClass(tournament);
  const venue = getVenueInfo(tournament.venue);
  const isBounty = /bounty|mystery millions/i.test(tournament.event_name);
  const isSat = !!tournament.is_satellite;
  const isRestart = !!tournament.is_restart;
  const ringEvent = isRingEvent(tournament);

  const rowClasses = [
    'cal-event-row',
    open ? 'open' : '',
    isInSchedule ? 'saved' : '',
    isAnchor ? 'anchor' : (conditions && conditions.length > 0 ? 'conditional' : ''),
    venueClass,
    bracelet ? 'bracelet' : '',
    isPast ? 'past' : '',
  ].filter(Boolean).join(' ');

  const stripColor = getVenueBrandColor(venue.abbr);
  const stripTextColor = venue.abbr === 'WSOP' ? 'var(--bg)' : 'rgba(255,255,255,0.85)';

  return (
    <div ref={rowRef} className={rowClasses} style={isInSchedule && isAnchor ? {'--anchor-color': stripColor} : undefined}>
      <div
        className={`cal-venue-strip venue-strip-${venue.abbr.toLowerCase().replace(/\s+/g, '-')}`}
        style={{ background: stripColor, color: stripTextColor, cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      ><span className="venue-strip-abbr">{venue.abbr}</span>{open && <span className="venue-strip-full">{venue.longName || venue.abbr}</span>}</div>
      <div className="cal-event-row-content" style={isInSchedule ? {borderColor: conditions && conditions.length > 0 ? (venue.abbr === 'WSOP' ? 'var(--venue-wsop-cond)' : stripColor) : stripColor} : undefined}>
        {/* Collapsed bar -- always visible */}
        <div className="cal-event-bar" onClick={() => setOpen(o => !o)}>
          {tournament.venue === 'Personal' ? (
            <div className="cal-bar-row2" style={{display:'flex', alignItems:'center', gap:'8px'}}>
              <span className="cal-event-name" style={{fontSize:'0.88rem'}}>
                {tournament.event_name === 'Travel Day' ? '\u2708\uFE0F' : '\uD83C\uDFD6\uFE0F'} {tournament.event_name}
              </span>
              {tournament.notes && (
                <span style={{fontSize:'0.78rem', color:'var(--text-muted)', fontStyle:'italic', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  \u2014 {tournament.notes}
                </span>
              )}
            </div>
          ) : (
            <>
              <div className="cal-bar-row1">
                <span className="cal-event-time">{timeLabel}</span>
                <span className="cal-event-buyin">{currencySymbol(tournament.venue)}{Number(tournament.buyin).toLocaleString()}</span>
              </div>
              <div className="cal-bar-row2">
                <span className="cal-event-name">{formatEventName(tournament.event_name)}</span>
                {isBounty && !isSat && <span className="cal-bounty-icon"><Icon.crosshairs /></span>}
                {isSat && <span className="cal-bounty-icon"><Icon.satellite /></span>}
                {isRestart && <span className="cal-bounty-icon"><Icon.restart /></span>}
                {bracelet && <span className="cal-bracelet-icon"><Icon.bracelet /></span>}
                {ringEvent && <span className="cal-ring-icon"><Icon.ring /></span>}
              </div>
              {showMiniLateReg && !open && <MiniLateRegBar lateRegEnd={tournament.late_reg_end} date={tournament.date} time={tournament.time} venueAbbr={venue.abbr} venue={tournament.venue} />}
            </>
          )}
        </div>
        <div className={`cal-event-chevron ${open ? 'open' : ''}`} onClick={() => setOpen(o => !o)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>

        {/* Expanded detail panel -- animated */}
        <div className={`cal-event-detail-wrap ${open ? 'open' : ''}`} onClick={e => {
          const tag = e.target.tagName;
          if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT') return;
          if (e.target.closest('.badge-clickable') || e.target.closest('.condition-picker') || e.target.closest('.cal-action-row') || e.target.closest('.admin-edit-panel')) return;
          setOpen(false);
        }}>
          <div className="cal-event-detail-inner">
            <div className="cal-event-detail">
              {tournament.venue === 'Personal' ? (
                <>
                  {tournament.event_name === 'Travel Day' && !readOnly && onUpdatePersonalEvent ? (
                    <div style={{marginBottom:'12px'}}>
                      <label style={{fontSize:'0.78rem', color:'var(--text-muted)', display:'block', marginBottom:'4px'}}>Travel details</label>
                      <div style={{display:'flex', gap:'6px', alignItems:'center'}}>
                        <input
                          type="text"
                          value={travelNotes}
                          onChange={e => setTravelNotes(e.target.value)}
                          onBlur={() => { if (travelNotes !== (tournament.notes || '')) onUpdatePersonalEvent(tournament.id, travelNotes); }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); }}}
                          placeholder="e.g. 6h flight LAX \u2192 LAS"
                          style={{
                            flex:1, padding:'6px 10px', fontSize:'0.83rem',
                            borderRadius:'6px', border:'1px solid var(--border)',
                            background:'var(--surface)', color:'var(--text)', outline:'none'
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'12px'}}>
                      {tournament.event_name === 'Travel Day'
                        ? (tournament.notes || 'Travel day \u2014 no tournaments planned')
                        : 'Day off \u2014 rest and recover'}
                    </p>
                  )}
                  {!readOnly && (
                    <div className="cal-action-row">
                      <button className="cal-action-btn remove" onClick={() => onToggle(tournament.id)}>
                        <span className="cal-action-icon">{'\u2715'}</span>
                        <span className="cal-action-label">Remove</span>
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="cal-detail-badges">
                    <div className="cal-badges-left">
                      {tournament.event_number && (
                        <span className="badge badge-event" style={{background: stripColor, color: stripTextColor}}>#{tournament.event_number.replace(/^[A-Za-z]+-/, '')}</span>
                      )}
                      {tournament.game_variant && getGamePills(tournament.game_variant, tournament.event_name).map((g, i) => (
                        <span key={i} className="badge badge-variant">{g}</span>
                      ))}
                    </div>
                    <div className="cal-badges-right">
                      {tournament.rake_pct != null && tournament.rake_pct > 0 && (
                        <span
                          className={`badge badge-rake badge-clickable ${tournament.rake_pct <= 8 ? 'rake-low' : tournament.rake_pct <= 13 ? 'rake-mid' : 'rake-high'}`}
                          style={{cursor:'pointer'}}
                          onClick={e => { e.stopPropagation(); setShowRakeBreakdown(v => !v); }}
                        >
                          {tournament.rake_pct}% rake {showRakeBreakdown ? '\u25BE' : '\u25B8'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="cal-detail-grid">
                    {tournament.starting_chips && (
                      <div className="cal-detail-item">
                        <span className="cal-detail-label">Starting Chips</span>
                        <span className="cal-detail-value">{Number(tournament.starting_chips).toLocaleString()}</span>
                      </div>
                    )}
                    {tournament.level_duration && (
                      <div className="cal-detail-item">
                        <span className="cal-detail-label">Levels</span>
                        <span className="cal-detail-value">{tournament.level_duration} min</span>
                      </div>
                    )}
                    {tournament.reentry && (
                      <div className="cal-detail-item">
                        <span className="cal-detail-label">Re-entry</span>
                        <span className="cal-detail-value">{tournament.reentry === 'N/A' ? 'Freezeout' : tournament.reentry}</span>
                      </div>
                    )}
                    {tournament.late_reg && (
                      <div className="cal-detail-item">
                        <span className="cal-detail-label">Late Reg</span>
                        <span className="cal-detail-value">{tournament.late_reg}</span>
                      </div>
                    )}
                    {showRakeBreakdown && tournament.prize_pool > 0 && (
                      <div className="cal-detail-item">
                        <span className="cal-detail-label">Prize Pool</span>
                        <span className="cal-detail-value">{currencySymbol(tournament.venue)}{Number(tournament.prize_pool).toLocaleString()}</span>
                      </div>
                    )}
                    {showRakeBreakdown && tournament.house_fee > 0 && (
                      <div className="cal-detail-item">
                        <span className="cal-detail-label">House Fee</span>
                        <span className="cal-detail-value">{currencySymbol(tournament.venue)}{Number(tournament.house_fee).toLocaleString()}</span>
                      </div>
                    )}
                    {showRakeBreakdown && tournament.opt_add_on > 0 && (
                      <div className="cal-detail-item">
                        <span className="cal-detail-label">Staff Fee</span>
                        <span className="cal-detail-value">{currencySymbol(tournament.venue)}{Number(tournament.opt_add_on).toLocaleString()}</span>
                      </div>
                    )}
                  </div>

                  {conditions && conditions.length > 0 && (
                    <div style={{display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'10px'}}>
                      {conditions.map((c, ci) => (
                        <span key={ci} className="badge badge-condition">
                          {formatConditionBadge(c, allTournaments)}
                        </span>
                      ))}
                    </div>
                  )}

                  {tournament.notes && (
                    <p style={{fontSize:'0.78rem', color:'var(--text-muted)', fontStyle:'italic', marginBottom:'10px'}}>
                      {tournament.notes}
                    </p>
                  )}

                  <LateRegBar lateRegEnd={tournament.late_reg_end} date={tournament.date} time={tournament.time} venueAbbr={venue.abbr} venue={tournament.venue} />

                  {buddyEvents && buddyEvents[tournament.id] && buddyEvents[tournament.id].length > 0 && (
                    <BuddyAvatarRow buddies={buddyEvents[tournament.id]} liveUpdates={buddyLiveUpdates}
                      onBuddyClick={isInSchedule && onBuddySwap ? (buddy) => onBuddySwap(buddy, tournament) : undefined} />
                  )}

                  {venue.abbr === 'WSOP' && (
                    <a
                      href={wsopStructureUrlFor(tournament.event_number)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cal-structure-link"
                    >
                      View Structure Sheet {'\u2197'}
                    </a>
                  )}
                  {venue.abbr !== 'WSOP' && tournament.structure_sheet_path && (() => {
                    // structure_sheet_path may be:
                    //   'schedule-docs/Aria/structures/$X NLH \u2026pdf'                              (per-event PDF on our server)
                    //   'schedule-docs/Wynn Las Vegas/structures/Wynn_Summer_Classic.pdf#page=12' (bundled PDF + page)
                    //   'https://www.venetianlasvegas.com/.../structures/dscps_2026-structure_3.pdf'  (off-site CDN PDF)
                    // For off-site URLs (http/https), use as-is. For our
                    // schedule-docs paths, map to the served API route and
                    // URL-encode each segment so spaces / $ / ( ) / commas
                    // survive routing. The #page=N fragment passes through
                    // unencoded so the browser jumps to the right page.
                    const raw = String(tournament.structure_sheet_path);
                    let url;
                    if (/^https?:\/\//i.test(raw)) {
                      url = raw;
                    } else {
                      const hashIdx = raw.indexOf('#');
                      const pathPart = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
                      const fragPart = hashIdx >= 0 ? raw.slice(hashIdx) : '';
                      const parts = pathPart.split('/');
                      if (parts.length < 4 || parts[0] !== 'schedule-docs') return null;
                      url = `${API_URL}/schedule-docs/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}/${encodeURIComponent(parts.slice(3).join('/'))}${fragPart}`;
                    }
                    return (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cal-structure-link"
                      >
                        View Structure Sheet {'\u2197'}
                      </a>
                    );
                  })()}

                  {/* Admin edit panel */}
                  {isAdmin && editing && (() => {
                    const f = { ...tournament, ...editFields };
                    const field = (label, key, type) => (
                      <div className="cal-detail-item" key={key}>
                        <span className="cal-detail-label">{label}</span>
                        {type === 'select-category' ? (
                          <select value={f[key] || ''} onChange={e => setEditFields(p => ({...p, [key]: e.target.value}))}
                            style={{fontSize:'0.83rem', padding:'4px 8px', borderRadius:'6px', border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)'}}>
                            <option value="primary">Primary</option>
                            <option value="side">Side</option>
                          </select>
                        ) : (
                          <input type={type || 'text'} value={f[key] ?? ''} onChange={e => setEditFields(p => ({...p, [key]: e.target.value}))}
                            style={{width:'100%', fontSize:'0.83rem', padding:'4px 8px', borderRadius:'6px', border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', outline:'none'}} />
                        )}
                      </div>
                    );
                    return (
                      <div className="admin-edit-panel" onClick={e => e.stopPropagation()} style={{marginBottom:'10px', padding:'10px', borderRadius:'8px', background:'var(--surface)', border:'1px solid var(--border)'}}>
                        <div style={{fontSize:'0.75rem', fontWeight:700, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'8px'}}>Admin Edit</div>
                        <div className="cal-detail-grid" style={{gap:'8px'}}>
                          {field('Event Name', 'event_name')}
                          {field('Event #', 'event_number')}
                          {field('Buy-in', 'buyin', 'number')}
                          {field('Game Variant', 'game_variant')}
                          {field('Date', 'date', 'date')}
                          {field('Time', 'time')}
                          {field('Starting Chips', 'starting_chips', 'number')}
                          {field('Level Duration', 'level_duration')}
                          {field('Re-entry', 'reentry')}
                          {field('Late Reg', 'late_reg')}
                          {field('Venue', 'venue')}
                          {field('Category', 'category', 'select-category')}
                          {field('Notes', 'notes')}
                        </div>
                        {/* Venue strip color picker */}
                        {(() => {
                          const venueInfo = getVenueInfo(tournament.venue);
                          const abbr = venueInfo.abbr;
                          const cssVar = VENUE_BRAND_VAR[abbr] || `--venue-${abbr.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`;
                          const computed = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
                          const currentColor = computed || stripColor;
                          return (
                            <div style={{marginTop:'10px', display:'flex', alignItems:'center', gap:'10px'}}>
                              <label style={{fontSize:'0.78rem', color:'var(--text-muted)', whiteSpace:'nowrap'}}>Strip Color ({abbr})</label>
                              <input type="color" defaultValue={currentColor}
                                onChange={async (e) => {
                                  const color = e.target.value;
                                  if (!VENUE_BRAND_VAR[abbr]) VENUE_BRAND_VAR[abbr] = cssVar;
                                  document.documentElement.style.setProperty(cssVar, color);
                                  try {
                                    await fetch(`${API_URL}/venue-colors/${encodeURIComponent(abbr)}`, {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
                                      body: JSON.stringify({ color })
                                    });
                                  } catch (err) { console.error('Failed to save venue color', err); }
                                }}
                                style={{width:'36px', height:'28px', padding:0, border:'1px solid var(--border)', borderRadius:'4px', cursor:'pointer', background:'transparent'}} />
                            </div>
                          );
                        })()}
                        <div style={{display:'flex', gap:'8px', marginTop:'10px'}}>
                          <button disabled={saving} onClick={async () => {
                            if (Object.keys(editFields).length === 0) { setEditing(false); return; }
                            setSaving(true);
                            try {
                              await onAdminEdit(tournament.id, editFields);
                              setEditing(false);
                              setEditFields({});
                            } catch(e) { alert('Save failed: ' + e.message); }
                            setSaving(false);
                          }} style={{flex:1, padding:'8px', borderRadius:'6px', border:'none', background:'var(--accent)', color:'#fff', fontWeight:600, fontSize:'0.83rem', cursor:'pointer', opacity: saving ? 0.6 : 1}}>
                            {saving ? 'Saving\u2026' : 'Save'}
                          </button>
                          <button onClick={() => { setEditing(false); setEditFields({}); }} style={{padding:'8px 16px', borderRadius:'6px', border:'1px solid var(--border)', background:'transparent', color:'var(--text)', fontSize:'0.83rem', cursor:'pointer'}}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Action row */}
                  {!readOnly && (
                    <div className="cal-action-row">
                      <button
                        className={`cal-action-btn ${isInSchedule ? 'remove' : ''}`}
                        onClick={() => onToggle(tournament.id)}
                      >
                        <span className="cal-action-icon">{isInSchedule ? '\u2715' : '+'}</span>
                        <span className="cal-action-label">{isInSchedule ? 'Remove' : 'Add'}</span>
                      </button>
                      {isInSchedule && onToggleAnchor && (
                        <button
                          className={`cal-action-btn anchor-btn ${isAnchor ? 'locked' : ''}`}
                          onClick={() => onToggleAnchor(tournament.id, !isAnchor)}
                        >
                          <span className="cal-action-icon">{'\uD83D\uDD12'}</span>
                          <span className="cal-action-label">Priority</span>
                        </button>
                      )}
                      {isAdmin && onAdminEdit && !editing && (
                        <button
                          className="cal-action-btn"
                          onClick={() => setEditing(true)}
                        >
                          <span className="cal-action-icon">{'\u270E'}</span>
                          <span className="cal-action-label">Edit</span>
                        </button>
                      )}
                      {isInSchedule && onSetCondition && (
                        <button
                          className="cal-action-btn condition-btn"
                          onClick={() => setShowConditionUI(prev => !prev)}
                        >
                          <span className="cal-action-icon"><Icon.condition /></span>
                          <span className="cal-action-label">Condition</span>
                        </button>
                      )}
                      {isInSchedule && onSetPlannedEntries && tournament.reentry && tournament.reentry !== 'N/A' && (() => {
                        const maxE = getMaxEntries(tournament.reentry);
                        const cur = plannedEntries || 1;
                        return (
                          <div className="cal-entries-counter" onClick={e => e.stopPropagation()}>
                            <div className="cal-entries-stepper">
                              <div className="cal-entries-display">
                                <span className={`minus ${cur <= 1 ? 'disabled' : ''}`}>{'\u2212'}</span>
                                <span className="value">{cur}</span>
                                <span className={`plus ${cur >= maxE ? 'disabled' : ''}`}>+</span>
                              </div>
                              <div className="cal-entries-overlay">
                                <button
                                  onClick={() => onSetPlannedEntries(tournament.id, Math.max(1, cur - 1))}
                                  disabled={cur <= 1}
                                  aria-label="Decrease entries"
                                />
                                <button
                                  onClick={() => onSetPlannedEntries(tournament.id, Math.min(maxE, cur + 1))}
                                  disabled={cur >= maxE}
                                  aria-label="Increase entries"
                                />
                              </div>
                            </div>
                            <span className="cal-action-label">Max Entries</span>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {showConditionUI && isInSchedule && onSetCondition && (
                    <ConditionPicker
                      tournament={tournament}
                      conditions={conditions || []}
                      allTournaments={allTournaments || []}
                      onSet={(conditionsArr, pub) => { onSetCondition(tournament.id, conditionsArr, pub); setShowConditionUI(false); }}
                      onRemove={() => { onRemoveCondition(tournament.id); setShowConditionUI(false); }}
                      onClose={() => setShowConditionUI(false)}
                      scheduleIds={scheduleIds}
                      onToggle={onToggle}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Lightweight collapsed-only renderer ──
// Zero hooks, zero context. ScheduleView renders this for rows that
// haven't been expanded yet, swapping in the full CalendarEventRow on
// first tap. Eliminates ~15 hook calls per row on initial mount.
function CalendarEventRowLite({ tournament, isInSchedule, isPast, isAnchor, conditionsJson, conditions, onExpand }) {
  const venue = getVenueInfo(tournament.venue);
  const venueClass = getVenueClass(tournament);
  const stripColor = getVenueBrandColor(venue.abbr);
  const stripTextColor = venue.abbr === 'WSOP' ? 'var(--bg)' : 'rgba(255,255,255,0.85)';
  const bracelet = isBraceletEvent(tournament);
  const isBounty = /bounty|mystery millions/i.test(tournament.event_name);
  const isSat = !!tournament.is_satellite;
  const isRestart = !!tournament.is_restart;
  const ringEvent = isRingEvent(tournament);
  const tzAbbr = getVenueTzAbbr(tournament.venue);
  const timeLabel = (tournament.time || '—') + (tzAbbr ? ' ' + tzAbbr : '');
  let hasConditions = false;
  if (conditions && conditions.length > 0) {
    hasConditions = true;
  } else if (conditionsJson) {
    try { const c = JSON.parse(conditionsJson); hasConditions = Array.isArray(c) && c.length > 0; } catch {}
  }
  const rowClasses = [
    'cal-event-row',
    isInSchedule ? 'saved' : '',
    isAnchor ? 'anchor' : (hasConditions ? 'conditional' : ''),
    venueClass,
    bracelet ? 'bracelet' : '',
    isPast ? 'past' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={rowClasses} style={isInSchedule && isAnchor ? {'--anchor-color': stripColor} : undefined}>
      <div
        className={`cal-venue-strip venue-strip-${venue.abbr.toLowerCase().replace(/\s+/g, '-')}`}
        style={{ background: stripColor, color: stripTextColor, cursor: 'pointer' }}
        onClick={onExpand}
      ><span className="venue-strip-abbr">{venue.abbr}</span></div>
      <div className="cal-event-row-content" style={isInSchedule ? {borderColor: hasConditions ? (venue.abbr === 'WSOP' ? 'var(--venue-wsop-cond)' : stripColor) : stripColor} : undefined}>
        <div className="cal-event-bar" onClick={onExpand}>
          {tournament.venue === 'Personal' ? (
            <div className="cal-bar-row2" style={{display:'flex', alignItems:'center', gap:'8px'}}>
              <span className="cal-event-name" style={{fontSize:'0.88rem'}}>
                {tournament.event_name === 'Travel Day' ? '✈️' : '🏖️'} {tournament.event_name}
              </span>
              {tournament.notes && (
                <span style={{fontSize:'0.78rem', color:'var(--text-muted)', fontStyle:'italic', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  {'—'} {tournament.notes}
                </span>
              )}
            </div>
          ) : (
            <>
              <div className="cal-bar-row1">
                <span className="cal-event-time">{timeLabel}</span>
                <span className="cal-event-buyin">{currencySymbol(tournament.venue)}{Number(tournament.buyin).toLocaleString()}</span>
              </div>
              <div className="cal-bar-row2">
                <span className="cal-event-name">{formatEventName(tournament.event_name)}</span>
                {isBounty && !isSat && <span className="cal-bounty-icon"><Icon.crosshairs /></span>}
                {isSat && <span className="cal-bounty-icon"><Icon.satellite /></span>}
                {isRestart && <span className="cal-bounty-icon"><Icon.restart /></span>}
                {bracelet && <span className="cal-bracelet-icon"><Icon.bracelet /></span>}
                {ringEvent && <span className="cal-ring-icon"><Icon.ring /></span>}
              </div>
            </>
          )}
        </div>
        <div className="cal-event-chevron" onClick={onExpand}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </div>
    </div>
  );
}

const CalendarEventRow = React.memo(CalendarEventRow_, (prev, next) => {
  // Check props that actually affect the collapsed row render.
  // Skip allTournaments/buddyLiveUpdates (large, only used when expanded).
  if (prev.tournament !== next.tournament) return false;
  if (prev.isInSchedule !== next.isInSchedule) return false;
  if (prev.isPast !== next.isPast) return false;
  if (prev.isAnchor !== next.isAnchor) return false;
  if (prev.plannedEntries !== next.plannedEntries) return false;
  if (prev.conditionsJson !== next.conditionsJson) return false;
  if (prev.showMiniLateReg !== next.showMiniLateReg) return false;
  if (prev.readOnly !== next.readOnly) return false;
  if (prev.isAdmin !== next.isAdmin) return false;
  // focusEventId: only re-render if focus state changed for THIS row
  if ((prev.focusEventId === prev.tournament.id) !== (next.focusEventId === next.tournament.id)) return false;
  // buddyEvents: only check this tournament's entry
  if (prev.buddyEvents?.[prev.tournament.id] !== next.buddyEvents?.[next.tournament.id]) return false;
  // scheduleIds: used for condition picker, check reference
  if (prev.scheduleIds !== next.scheduleIds) return false;
  // Callbacks are all useCallback in App.jsx — stable references, skip check.
  // allTournaments, buddyLiveUpdates: only used in expanded state, skip.
  return true;
});
export { CalendarEventRowLite };
export default CalendarEventRow;
