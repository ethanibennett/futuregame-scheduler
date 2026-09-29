import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { wsopStructureUrlFor } from '../utils/wsop-structure-pages.js';
import {
  getVenueInfo, getVenueClass, getVenueBrandColor, getStripAbbr, formatGuarantee, shortEventNumber, getVariantColor, isBraceletEvent, isRingEvent,
  normaliseDate, parseDateTime, parseDateTimeInTz, parseLateRegEnd, parseTournamentTime,
  getMaxEntries, getVenueTimezone, getVenueTzAbbr, getNow,
  extractConditions, formatConditionLabel, formatConditionBadge,
  getIfIBustEvents, getIfIBagEvents, getGamePills, calculateCountdown, haptic,
  currencySymbol, nativeCurrency, CURRENCY_CONFIG, formatCurrencyAmount,
  VENUE_TO_SERIES, VENUE_BRAND_VAR, isPOYEligible, calculatePOYPoints, isSixMax,
  HAND_CONFIG, HAND_CONFIG_DEFAULT, splitEventStage, formatChips, getVenueCoords,
} from '../utils/utils.js';
import { registerClock, useClockStore, useSecondTick, liveView, clockRegEnd, fmtClock } from '../utils/live-clocks.js';
import { API_URL } from '../utils/api.js';
import { useDisplayName } from '../contexts/DisplayNameContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

// ── Format event name: the stage of a multi-flight event goes underneath ──
// splitEventStage is shared with CalendarEventRow and mirrors the server's
// normaliser; the regex that used to live here required the token to be
// dash-separated and last, which 259 of 1,000 stored titles are not.
function formatEventName(name) {
  const { base, stage } = splitEventStage(name);
  if (!stage) return name;
  return (
    <>
      <span className="cal-event-base">{base}</span>
      <span className="cal-event-stage">{stage}</span>
    </>
  );
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
  // Land the card's top EXACTLY on the bottom edge of the sticky rows. filtersH +
  // dateBreakH are the rows' real rendered heights (the DOM reports layout only in
  // px — that is not a hardcoded grid dimension, it is reading where the grid
  // actually landed, which is immune to any device viewport quirk). Calendar has
  // no date-break and its page-sticky draws a box-shadow half a subrow below its
  // rect; add that back so its stop matches, in r.
  const r = (window.innerWidth / 37) * 0.71;
  const stickyShadowComp = (dateBreakH === 0) ? r * 0.5 : 0;
  const target = elAbsTop - filtersH - dateBreakH - stickyShadowComp;
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

// ── Live clock footer (collapsed view, running events) ──
// Replaces the mini late-reg bar while the room's clock is running: level, blinds, time left and
// players, then the late-reg track timed from that clock. Same .mini-late-reg box, so the card
// heights that seat the footer on the grid apply unchanged.
function LiveClockFooter({ live, regEnd, date, venueAbbr }) {
  const stakes = live.onBreak ? 'Break'
    : `L${live.level} ${formatChips(live.sb)}/${formatChips(live.bb)}${live.ante ? '/' + formatChips(live.ante) : ''}`;
  const parts = [stakes, live.state === 'paused' ? `${fmtClock(live.remaining)} paused` : fmtClock(live.remaining)];
  if (live.playersLeft != null && live.entries != null) parts.push(`${live.playersLeft}/${live.entries}`);
  const endMs = regEnd ? parseLateRegEnd(regEnd, date) : NaN;
  const diffMs = Number.isFinite(endMs) ? endMs - Date.now() : NaN;
  const windowMs = 12 * 60 * 60 * 1000;
  const pct = diffMs > 0 ? Math.min(100, Math.max(0, (diffMs / windowMs) * 100)) : 0;
  const critical = diffMs > 0 && pct <= 15;
  return (
    <div className="mini-late-reg live" title="Live tournament clock">
      <span className="mini-late-reg-time live">{parts.join(' · ')}</span>
      {diffMs > 0 && (
        <div className="mini-late-reg-track">
          <div className={`mini-late-reg-fill ${critical ? 'critical' : ''}`}
               style={{ width: `${pct}%`, background: critical ? undefined : getVenueBrandColor(venueAbbr) }} />
        </div>
      )}
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
      style={{ display: 'flex', gap: 'calc(var(--subrow) * 0.75)', flexWrap: 'wrap', marginBottom: 'calc(var(--subrow) * 1.25)', alignItems: 'center' }}
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
              gap: 'calc(var(--subrow) * 0.75)',
              padding: 'calc(var(--subrow) * 0.375) calc(var(--subrow) * 1.25) calc(var(--subrow) * 0.375) calc(var(--subrow) * 0.375)',
              borderRadius: 'calc(var(--subrow) * 128)',
              background: 'var(--surface)',
              border: 'var(--bw-hair) solid var(--border)',
              fontSize: 'calc(var(--gu) * 1.149)',
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
      <span style={{fontWeight: 'var(--fw-bold)',flexShrink:0}}>#{t.event_number}</span>
      <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.event_name}</span>
      <span style={{flexShrink:0,color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.060)'}}>${t.buyin}</span>
    </div>
  );

  const checkboxStyle = {
    width: 'calc(var(--subrow) * 2)', height: 'calc(var(--subrow) * 2)', accentColor: 'var(--accent)', cursor: 'pointer'
  };
  const sectionLabelStyle = {
    fontSize: 'calc(var(--gu) * 1.208)', fontFamily: "'Univers Condensed','Univers',sans-serif", fontWeight: 'var(--fw-bold)', color: 'var(--text)', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 'calc(var(--subrow) * 1)'
  };

  return (
    <div className="condition-picker">
      <div className="condition-picker-title">Set Conditions</div>

      {/* Satellites checkbox */}
      <label style={{...sectionLabelStyle, marginBottom: satEnabled ? 'calc(var(--subrow) * 1)' : 'calc(var(--subrow) * 1.5)'}}>
        <input type="checkbox" checked={satEnabled} onChange={e => setSatEnabled(e.target.checked)} style={checkboxStyle} />
        Satellites
      </label>

      {satEnabled && (
        <div style={{paddingLeft:'calc(var(--subrow) * 3)',marginBottom:'calc(var(--subrow) * 1.5)'}}>
          <div className="condition-type-row" style={{marginBottom:'calc(var(--subrow) * 1)'}}>
            <button className={`condition-type-btn ${satType === 'IF_WIN_SEAT' ? 'active' : ''}`} onClick={() => setSatType('IF_WIN_SEAT')}>
              If I win a seat
            </button>
            <button className={`condition-type-btn ${satType === 'IF_NO_SEAT' ? 'active' : ''}`} onClick={() => setSatType('IF_NO_SEAT')}>
              If I don't win a seat
            </button>
          </div>

          {suggestedSatellites.length > 0 && (
            <>
              <div style={{fontSize:'calc(var(--gu) * 1.001)',fontWeight: 'var(--fw-bold)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'calc(var(--subrow) * 0.5)'}}>
                Related Satellites
              </div>
              <div className="condition-sat-list">
                {suggestedSatellites.map(renderItem)}
              </div>
            </>
          )}

          <div style={{fontSize:'calc(var(--gu) * 1.001)',fontWeight: 'var(--fw-bold)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'calc(var(--subrow) * 0.5)'}}>
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
      <label style={{...sectionLabelStyle, marginBottom: profitEnabled ? 'calc(var(--subrow) * 1)' : 'calc(var(--subrow) * 1.5)'}}>
        <input type="checkbox" checked={profitEnabled} onChange={e => setProfitEnabled(e.target.checked)} style={checkboxStyle} />
        Profit / Loss
      </label>

      {profitEnabled && (
        <div style={{paddingLeft:'calc(var(--subrow) * 3)',marginBottom:'calc(var(--subrow) * 1.5)'}}>
          <div style={{fontSize:'calc(var(--gu) * 1.001)',fontWeight: 'var(--fw-bold)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'calc(var(--subrow) * 0.5)'}}>
            Profit threshold ($)
          </div>
          <input
            className="condition-search"
            type="number"
            placeholder="e.g. 5000"
            value={profitAmount}
            onChange={e => setProfitAmount(e.target.value)}
          />
          <span style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',display:'block',marginTop:'calc(var(--subrow) * 0.25)'}}>
            I'll play this event if I'm up at least this amount
          </span>
        </div>
      )}

      {/* If I Bust checkbox */}
      {bustEvents.length > 0 && (
        <>
        <label style={{...sectionLabelStyle, marginBottom: bustEnabled ? 'calc(var(--subrow) * 1)' : 'calc(var(--subrow) * 1.5)'}}>
          <input type="checkbox" checked={bustEnabled} onChange={e => setBustEnabled(e.target.checked)} style={checkboxStyle} />
          If I Bust
        </label>

        {bustEnabled && (
          <div style={{paddingLeft:'calc(var(--subrow) * 3)',marginBottom:'calc(var(--subrow) * 1.5)'}}>
            <div style={{fontSize:'calc(var(--gu) * 1.001)',fontWeight: 'var(--fw-bold)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'calc(var(--subrow) * 0.5)'}}>
              I'll play this if I bust from:
            </div>
            <div className="condition-sat-list">
              {bustEvents.map(t => (
                <div
                  key={t.id}
                  className={`condition-sat-item ${selectedBustId === t.id ? 'selected' : ''}`}
                  onClick={() => setSelectedBustId(t.id === selectedBustId ? null : t.id)}
                >
                  <span style={{fontWeight: 'var(--fw-bold)',flexShrink:0,fontSize:'calc(var(--gu) * 1.060)',color:'var(--text-muted)'}}>{t.time}</span>
                  <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.event_name}</span>
                  <span style={{flexShrink:0,color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.060)'}}>{currencySymbol(t.venue)}{Number(t.buyin).toLocaleString()}</span>
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
        <label style={{...sectionLabelStyle, marginBottom: bagEnabled ? 'calc(var(--subrow) * 1)' : 'calc(var(--subrow) * 1.5)'}}>
          <input type="checkbox" checked={bagEnabled} onChange={e => setBagEnabled(e.target.checked)} style={checkboxStyle} />
          If I Bag
        </label>

        {bagEnabled && (
          <div style={{paddingLeft:'calc(var(--subrow) * 3)',marginBottom:'calc(var(--subrow) * 1.5)'}}>
            <div style={{fontSize:'calc(var(--gu) * 1.001)',fontWeight: 'var(--fw-bold)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'calc(var(--subrow) * 0.5)'}}>
              I'll play this if I bag from:
            </div>
            <div className="condition-sat-list">
              {bagEvents.map(t => (
                <div
                  key={t.id}
                  className={`condition-sat-item ${selectedBagId === t.id ? 'selected' : ''}`}
                  onClick={() => setSelectedBagId(t.id === selectedBagId ? null : t.id)}
                >
                  <span style={{fontWeight: 'var(--fw-bold)',flexShrink:0,fontSize:'calc(var(--gu) * 1.060)',color:'var(--text-muted)'}}>#{t.event_number}</span>
                  <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.event_name}</span>
                  <span style={{flexShrink:0,color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.060)'}}>{currencySymbol(t.venue)}{Number(t.buyin).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </>
      )}

      {/* Public toggle */}
      <div
        style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 1)',marginTop:'calc(var(--subrow) * 0.5)',fontSize:'calc(var(--gu) * 1.104)',fontFamily:"'Univers Condensed','Univers',sans-serif",color:'var(--text-muted)',cursor:'pointer',userSelect:'none'}}
        onClick={() => setIsPublic(p => !p)}
      >
        <div style={{
          width:'calc(var(--subrow) * 4)',height:'calc(var(--subrow) * 2.25)',borderRadius:'calc(var(--subrow) * 1.125)',
          background: isPublic ? 'var(--accent)' : 'var(--border)',
          position:'relative',transition:'background 0.2s'
        }}>
          <div style={{
            width:'calc(var(--subrow) * 1.75)',height:'calc(var(--subrow) * 1.75)',borderRadius:'50%',background:'#fff',
            position:'absolute',top:'calc(var(--subrow) * 0.25)',
            left: isPublic ? 'calc(var(--subrow) * 2)' : 'calc(var(--subrow) * 0.25)',
            transition:'left 0.2s'
          }} />
        </div>
        <span style={{color:'var(--text)'}}>Show conditions on shared schedule</span>
      </div>

      {/* Action buttons */}
      <div style={{display:'flex',gap:'calc(var(--subrow) * 1)',marginTop:'calc(var(--subrow) * 1)'}}>
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
          style={{marginTop:'calc(var(--subrow) * 1)',background:'none',border:'none',color:'var(--accent2)',fontSize:'calc(var(--gu) * 1.104)',cursor:'pointer',padding:'calc(var(--subrow) * 0.5) 0',fontFamily:"'Univers Condensed','Univers',sans-serif",fontWeight: 'var(--fw-bold)'}}
          onClick={onRemove}
        >
          Remove All Conditions
        </button>
      )}
    </div>
  );
}

function CalendarEventRow_({ tournament, isInSchedule, onToggle, isPast, showMiniLateReg, focusEventId, readOnly, conditions: conditionsProp, conditionsJson, onSetCondition, onRemoveCondition, allTournaments, isAnchor, onToggleAnchor, plannedEntries, onSetPlannedEntries, onUpdatePersonalEvent, buddyEvents, buddyLiveUpdates, onBuddySwap, scheduleIds, isAdmin, onAdminEdit, onClearOverrides, onNavigateToEvent, initialOpen }) {
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
  // Per-field messages from a rejected save (400/409), plus a form-level one for errors the server
  // could not attribute to a field (403, network).
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [clearing, setClearing] = useState(false);
  const toast = useToast();
  const displayName = useDisplayName();
  const rowRef = useRef(null);

  /* Live clock (utils/live-clocks.js). A card asks only while it is on screen and its event is
     today's and past its start, so a day of 150 events costs the dozen the user can see. */
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = rowRef.current;
    if (!showMiniLateReg || !el || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: '200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [showMiniLateReg]);
  const startMsForClock = showMiniLateReg && tournament.venue !== 'Personal' ? parseTournamentTime(tournament) : NaN;
  const clockCandidate = onScreen && Number.isInteger(tournament.id) && Number.isFinite(startMsForClock)
    && startMsForClock <= Date.now() && Date.now() - startMsForClock < 18 * 60 * 60 * 1000;
  useEffect(() => {
    if (!clockCandidate) return undefined;
    return registerClock(tournament.id, getVenueCoords(tournament.venue, tournament.property));
  }, [clockCandidate, tournament.id]);
  const clockStore = useClockStore();
  const live = clockCandidate ? liveView(clockStore[tournament.id]) : null;
  useSecondTick(!!live && live.state === 'running' && !open);

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
  const venue = getVenueInfo(tournament.venue, tournament.property);
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
  // Opaque, not 0.85. The venue palette is tuned so WHITE text clears 4.5:1
  // on every swatch; the alpha cost ~0.6:1 and bought nothing, and because it
  // was set inline it silently beat the stylesheet rule that removed it.
  const stripTextColor = venue.abbr === 'WSOP' ? 'var(--bg)' : '#ffffff';

  return (
    <div ref={rowRef} className={rowClasses} style={isInSchedule && isAnchor ? {'--anchor-color': stripColor} : undefined}>
      <div
        className={`cal-venue-strip venue-strip-${venue.abbr.toLowerCase().replace(/\s+/g, '-')}`}
        style={{ background: stripColor, color: stripTextColor, cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
      ><span className="venue-strip-abbr">{getStripAbbr(venue.abbr)}</span>{open && <span className="venue-strip-full">{venue.longName || venue.abbr}</span>}</div>
      <div className="cal-event-row-content" style={isInSchedule ? {'--card-outline': conditions && conditions.length > 0 ? (venue.abbr === 'WSOP' ? 'var(--venue-wsop-cond)' : stripColor) : stripColor} : undefined}>
        {/* Collapsed bar -- always visible */}
        <div className="cal-event-bar" onClick={() => setOpen(o => !o)} role="button" tabIndex={0} aria-expanded={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}>
          {tournament.venue === 'Personal' ? (
            <div className="cal-bar-row2" style={{display:'flex', alignItems:'center', gap:'calc(var(--subrow) * 1)'}}>
              <span className="cal-event-name" style={{fontSize:'calc(var(--gu) * 1.296)'}}>
                {tournament.event_name === 'Travel Day' ? '\u2708\uFE0F' : '\uD83C\uDFD6\uFE0F'} {tournament.event_name}
              </span>
              {tournament.notes && (
                <span style={{fontSize:'calc(var(--gu) * 1.149)', color:'var(--text-muted)', fontStyle:'italic', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  \u2014 {tournament.notes}
                </span>
              )}
            </div>
          ) : (
            <>
              <div className="cal-bar-row1">
                <span className="cal-event-time">{timeLabel}</span>
                <span className="cal-event-money">
                  <span className="cal-event-buyin">{currencySymbol(tournament.venue)}{Number(tournament.buyin).toLocaleString()}</span>
                  {Number(tournament.prize_pool) > 0 && (
                    <span className="cal-event-gtd">{formatGuarantee(tournament.prize_pool, tournament.venue)}</span>
                  )}
                </span>
              </div>
              <div className="cal-bar-row2">
                <span className="cal-event-name">{formatEventName(tournament.event_name)}</span>
                {(isBounty || isSat || isRestart || bracelet || ringEvent) && (
                  <span className="cal-accolades">
                    {isBounty && !isSat && <span className="cal-bounty-icon"><Icon.crosshairs /></span>}
                    {isSat && <span className="cal-bounty-icon"><Icon.satellite /></span>}
                    {isRestart && <span className="cal-bounty-icon"><Icon.restart /></span>}
                    {bracelet && <span className="cal-bracelet-icon"><Icon.bracelet /></span>}
                    {ringEvent && <span className="cal-ring-icon"><Icon.ring /></span>}
                  </span>
                )}
              </div>
              {showMiniLateReg && !open && (live
                ? <LiveClockFooter live={live} regEnd={clockRegEnd(tournament, live) || tournament.late_reg_end} date={tournament.date} venueAbbr={venue.abbr} />
                : <MiniLateRegBar lateRegEnd={tournament.late_reg_end} date={tournament.date} time={tournament.time} venueAbbr={venue.abbr} venue={tournament.venue} />)}
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
                    <div style={{marginBottom:'calc(var(--subrow) * 1.5)'}}>
                      <label style={{fontSize:'calc(var(--gu) * 1.149)', color:'var(--text-muted)', display:'block', marginBottom:'calc(var(--subrow) * 0.5)'}}>Travel details</label>
                      <div style={{display:'flex', gap:'calc(var(--subrow) * 0.75)', alignItems:'center'}}>
                        <input
                          type="text"
                          value={travelNotes}
                          onChange={e => setTravelNotes(e.target.value)}
                          onBlur={() => { if (travelNotes !== (tournament.notes || '')) onUpdatePersonalEvent(tournament.id, travelNotes); }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); }}}
                          placeholder="e.g. 6h flight LAX \u2192 LAS"
                          style={{
                            flex:1, padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1.25)', fontSize:'calc(var(--gu) * 1.222)',
                            borderRadius:'calc(var(--subrow) * 0.75)', border:'var(--bw-hair) solid var(--border)',
                            background:'var(--surface)', color:'var(--text)', outline:'none'
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p style={{fontSize:'calc(var(--gu) * 1.252)', color:'var(--text-muted)', lineHeight:'calc(var(--subrow) * 2)', margin:0}}>
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
                      {/* The event-number PILL, restored. It was a tinted badge
                          until 18df4f0 flattened it into a plain meta line, and
                          the number is the thing you say out loud at the desk —
                          it earns the strip colour. Rendered only when
                          shortEventNumber finds a real number: most online rooms
                          publish none, and the old first-dash-segment rule turned
                          those into "#bounty" and "#WSOP_COM". */}
                      {shortEventNumber(tournament.event_number) && (
                        <span className="badge badge-event"
                              style={{ background: stripColor, color: stripTextColor }}>
                          #{shortEventNumber(tournament.event_number)}
                        </span>
                      )}
                      {tournament.game_variant && getGamePills(tournament.game_variant, tournament.event_name).map((g, i) => (
                        <span key={i} className="cal-meta-line">{g}</span>
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
                    {/* Derived, not stored. This line is the per-entry split of the
                        buy-in -- it sits beside House Fee and Staff Fee and adds up to
                        the entry -- whereas prize_pool is the advertised GUARANTEE the
                        collapsed row prints as "GTD". Reading the guarantee column here
                        is what let the two meanings share one field, and a $600 event
                        ended up advertising a $504 guarantee. buyin - rake_dollars is
                        exactly this number and cannot drift from the rake beside it. */}
                    {showRakeBreakdown && tournament.buyin > 0 && tournament.rake_dollars > 0 && (
                      <div className="cal-detail-item">
                        <span className="cal-detail-label">Prize Pool</span>
                        <span className="cal-detail-value">{currencySymbol(tournament.venue)}{(Number(tournament.buyin) - Number(tournament.rake_dollars)).toLocaleString()}</span>
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
                    <div style={{display:'flex', gap:'calc(var(--subrow) * 0.75)', flexWrap:'wrap'}}>
                      {conditions.map((c, ci) => (
                        <span key={ci} className="badge badge-condition">
                          {formatConditionBadge(c, allTournaments)}
                        </span>
                      ))}
                    </div>
                  )}

                  {tournament.notes && (
                    <p style={{fontSize:'calc(var(--gu) * 1.149)', color:'var(--text-muted)', fontStyle:'italic', lineHeight:'calc(var(--subrow) * 2)', margin:0}}>
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
                    // The server's own ownership test (source_pdf === 'mtt-feed'), applied client
                    // side. Feed rows are re-UPSERTed hourly, which is why they behave differently.
                    const feedOwned = tournament.source_pdf === 'mtt-feed';
                    const overridden = new Set(tournament.overridden_fields || []);
                    // venue and event_number are the feed's match key. Editing them does not get
                    // reverted — it makes the feed stop recognising the row — so they are shown as
                    // text rather than offered and refused. The server 409s as the backstop.
                    const locked = key => feedOwned && (key === 'venue' || key === 'event_number');
                    const clearFieldError = key => setFieldErrors(prev => {
                      if (!prev[key]) return prev;
                      const next = { ...prev }; delete next[key]; return next;
                    });
                    const inputStyle = key => ({
                      width:'100%', fontSize:'calc(var(--gu) * 1.222)', padding:'calc(var(--subrow) * 0.5) calc(var(--subrow) * 1)', borderRadius:'calc(var(--subrow) * 0.75)',
                      // Inline rather than a CSS class: the base border is inline too, so a class
                      // would lose the specificity fight and silently do nothing.
                      border:`var(--bw-hair) solid ${fieldErrors[key] ? '#ef4444' : 'var(--border)'}`,
                      background:'var(--surface)', color:'var(--text)', outline:'none',
                    });
                    const field = (label, key, type) => (
                      <div className="cal-detail-item" key={key}>
                        <span className="cal-detail-label">
                          {label}
                          {overridden.has(key) && (
                            <span className="badge badge-override"
                              title="Pinned by an admin edit — survives the feed's hourly sync">override</span>
                          )}
                        </span>
                        {locked(key) ? (
                          <span className="cal-detail-value" title="Set by the feed — this is how the watcher identifies the event">
                            {f[key] || '—'}
                          </span>
                        ) : type === 'select-category' ? (
                          <select value={f[key] || ''}
                            onChange={e => { clearFieldError(key); setEditFields(p => ({...p, [key]: e.target.value})); }}
                            style={{fontSize:'calc(var(--gu) * 1.222)', padding:'calc(var(--subrow) * 0.5) calc(var(--subrow) * 1)', borderRadius:'calc(var(--subrow) * 0.75)', border:`var(--bw-hair) solid ${fieldErrors[key] ? '#ef4444' : 'var(--border)'}`, background:'var(--surface)', color:'var(--text)'}}>
                            <option value="primary">Primary</option>
                            <option value="side">Side</option>
                          </select>
                        ) : (
                          <input type={type || 'text'} value={f[key] ?? ''} aria-invalid={!!fieldErrors[key]}
                            onChange={e => { clearFieldError(key); setEditFields(p => ({...p, [key]: e.target.value})); }}
                            style={inputStyle(key)} />
                        )}
                        {fieldErrors[key] && <div className="admin-field-error">{fieldErrors[key]}</div>}
                      </div>
                    );
                    return (
                      <div className="admin-edit-panel" onClick={e => e.stopPropagation()} style={{marginBottom:'calc(var(--subrow) * 1.25)', padding:'calc(var(--subrow) * 1.25)', borderRadius:'calc(var(--subrow) * 1)', background:'var(--surface)', border:'var(--bw-hair) solid var(--border)'}}>
                        <div style={{fontSize:'calc(var(--gu) * 1.104)', fontWeight:700, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'calc(var(--subrow) * 1)'}}>Admin Edit</div>
                        {formError && <div className="admin-field-error" style={{marginBottom:'calc(var(--subrow) * 1)'}}>{formError}</div>}
                        <div className="cal-detail-grid" style={{gap:'calc(var(--subrow) * 1)'}}>
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
                        {feedOwned && (
                          <div style={{fontSize:'calc(var(--gu) * 1.031)', color:'var(--text-muted)', marginTop:'calc(var(--subrow) * 1)', lineHeight:1.4}}>
                            Venue and Event # are the feed&rsquo;s match key &mdash; correct them in mtt-series-watcher.
                            Everything else is pinned here and survives the hourly sync.
                          </div>
                        )}
                        {/* Clear overrides. Deliberately outside the Save/Cancel transaction: like
                            the strip-color picker below it writes immediately, so it must not look
                            like part of the pending edit. */}
                        {overridden.size > 0 && onClearOverrides && (
                          <div style={{marginTop:'calc(var(--subrow) * 1)'}}>
                            <button className="admin-revert-btn" disabled={saving || clearing} onClick={async () => {
                              const n = overridden.size;
                              const plural = n === 1 ? '' : 's';
                              if (!window.confirm(`Clear ${n} override${plural} on this event?

The feed's own values return at the next hourly sync — your edits stay visible until then.`)) return;
                              setClearing(true);
                              try { await onClearOverrides(tournament.id); }
                              catch (e) { toast.error(e.message); }
                              setClearing(false);
                            }}>
                              {clearing ? 'Clearing…' : `Clear ${overridden.size} override${overridden.size === 1 ? '' : 's'}`}
                            </button>
                          </div>
                        )}
                        {/* Venue strip color picker */}
                        {(() => {
                          const venueInfo = getVenueInfo(tournament.venue, tournament.property);
                          const abbr = venueInfo.abbr;
                          const cssVar = VENUE_BRAND_VAR[abbr] || `--venue-${abbr.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`;
                          const computed = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
                          const currentColor = computed || stripColor;
                          return (
                            <div style={{marginTop:'calc(var(--subrow) * 1.25)', display:'flex', alignItems:'center', gap:'calc(var(--subrow) * 1.25)'}}>
                              <label style={{fontSize:'calc(var(--gu) * 1.149)', color:'var(--text-muted)', whiteSpace:'nowrap'}}>Strip Color ({abbr})</label>
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
                                style={{width:'calc(var(--subrow) * 4.5)', height:'calc(var(--subrow) * 3.5)', padding:0, border:'var(--bw-hair) solid var(--border)', borderRadius:'calc(var(--subrow) * 0.5)', cursor:'pointer', background:'transparent'}} />
                            </div>
                          );
                        })()}
                        <div style={{display:'flex', gap:'calc(var(--subrow) * 1)', marginTop:'calc(var(--subrow) * 1.25)'}}>
                          <button disabled={saving} onClick={async () => {
                            if (Object.keys(editFields).length === 0) { setEditing(false); return; }
                            setSaving(true);
                            setFieldErrors({}); setFormError('');
                            try {
                              await onAdminEdit(tournament.id, editFields);
                              setEditing(false);
                              setEditFields({});
                            } catch(e) {
                              // Prefer the server's key→message map; fall back to painting every
                              // named field with the sentence; fall back again to a form-level line
                              // for errors with no field at all (403, network).
                              const fe = Object.keys(e.fieldErrors || {}).length
                                ? e.fieldErrors
                                : Object.fromEntries((e.fields || []).map(k => [k, e.message]));
                              setFieldErrors(fe);
                              if (!Object.keys(fe).length) setFormError(e.message);
                              toast.error(e.message);
                            }
                            setSaving(false);
                          }} style={{flex:1, padding:'calc(var(--subrow) * 1)', borderRadius:'calc(var(--subrow) * 0.75)', border:'none', background:'var(--accent)', color:'#fff', fontWeight: 'var(--fw-bold)', fontSize:'calc(var(--gu) * 1.222)', cursor:'pointer', opacity: saving ? 0.6 : 1}}>
                            {saving ? 'Saving\u2026' : 'Save'}
                          </button>
                          <button disabled={saving}
                            onClick={() => { setEditing(false); setEditFields({}); setFieldErrors({}); setFormError(''); }}
                            style={{padding:'calc(var(--subrow) * 1) calc(var(--subrow) * 2)', borderRadius:'calc(var(--subrow) * 0.75)', border:'var(--bw-hair) solid var(--border)', background:'transparent', color:'var(--text)', fontSize:'calc(var(--gu) * 1.222)', cursor:'pointer', opacity: saving ? 0.6 : 1}}>
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
  const venue = getVenueInfo(tournament.venue, tournament.property);
  const venueClass = getVenueClass(tournament);
  const stripColor = getVenueBrandColor(venue.abbr);
  // Opaque, not 0.85. The venue palette is tuned so WHITE text clears 4.5:1
  // on every swatch; the alpha cost ~0.6:1 and bought nothing, and because it
  // was set inline it silently beat the stylesheet rule that removed it.
  const stripTextColor = venue.abbr === 'WSOP' ? 'var(--bg)' : '#ffffff';
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
        onClick={onExpand} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand && onExpand(e); } }}
      ><span className="venue-strip-abbr">{getStripAbbr(venue.abbr)}</span></div>
      <div className="cal-event-row-content" style={isInSchedule ? {'--card-outline': hasConditions ? (venue.abbr === 'WSOP' ? 'var(--venue-wsop-cond)' : stripColor) : stripColor} : undefined}>
        <div className="cal-event-bar" onClick={onExpand} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand && onExpand(e); } }}>
          {tournament.venue === 'Personal' ? (
            <div className="cal-bar-row2" style={{display:'flex', alignItems:'center', gap:'calc(var(--subrow) * 1)'}}>
              <span className="cal-event-name" style={{fontSize:'calc(var(--gu) * 1.296)'}}>
                {tournament.event_name === 'Travel Day' ? '✈️' : '🏖️'} {tournament.event_name}
              </span>
              {tournament.notes && (
                <span style={{fontSize:'calc(var(--gu) * 1.149)', color:'var(--text-muted)', fontStyle:'italic', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  {'—'} {tournament.notes}
                </span>
              )}
            </div>
          ) : (
            <>
              <div className="cal-bar-row1">
                <span className="cal-event-time">{timeLabel}</span>
                <span className="cal-event-money">
                  <span className="cal-event-buyin">{currencySymbol(tournament.venue)}{Number(tournament.buyin).toLocaleString()}</span>
                  {Number(tournament.prize_pool) > 0 && (
                    <span className="cal-event-gtd">{formatGuarantee(tournament.prize_pool, tournament.venue)}</span>
                  )}
                </span>
              </div>
              <div className="cal-bar-row2">
                <span className="cal-event-name">{formatEventName(tournament.event_name)}</span>
                {(isBounty || isSat || isRestart || bracelet || ringEvent) && (
                  <span className="cal-accolades">
                    {isBounty && !isSat && <span className="cal-bounty-icon"><Icon.crosshairs /></span>}
                    {isSat && <span className="cal-bounty-icon"><Icon.satellite /></span>}
                    {isRestart && <span className="cal-bounty-icon"><Icon.restart /></span>}
                    {bracelet && <span className="cal-bracelet-icon"><Icon.bracelet /></span>}
                    {ringEvent && <span className="cal-ring-icon"><Icon.ring /></span>}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        <div className="cal-event-chevron" onClick={onExpand} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand && onExpand(e); } }}>
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
