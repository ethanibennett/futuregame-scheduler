import React, { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import DateBreak from './DateBreak.jsx';
import CalendarEventRow, { CalendarEventRowLite } from './CalendarEventRow.jsx';
import LocationDropdown from './LocationDropdown.jsx';
import { ONLINE_SITES, stateName } from '../utils/online-sites.js';
import { Filtered } from './EmptyState.jsx';
import {
  getVenueInfo, normaliseDate, getToday, haptic, fmtShortDate, daysBetween, addDays,
  parseTournamentTime, parseDateTimeInTz, parseDateTime, findClosestFlight,
  extractConditions, getVenueCoords, haversineDistance, VENUE_TO_SERIES, LOCATION_REGIONS,

  isSideEvent,
  matchesLocation,
  matchesOnline,
  siteRuleIsEmpty,
} from '../utils/utils.js';
import { readLocalLocation, writeLocalLocation, pushServerLocation,
  fetchServerLocation, sameLocation, readLocalFilters, writeLocalFilters } from '../utils/location-prefs.js';
import { API_URL } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const GAME_GROUPS = [
  { label: 'NLH', variants: ['NLH'] },
  { label: 'PLO', variants: ['PLO'] },
  { label: 'Omaha', variants: ['O8', 'PLO8', 'Big O'] },
  { label: 'Stud', variants: ['7-Card Stud', 'Razz', 'Stud 8'] },
  { label: 'Draw', variants: ['2-7 Triple Draw', 'Mixed Triple Draw', 'NL 2-7 Single Draw', 'Badugi'] },
  { label: 'Mixed', variants: ['8-Game Mix', '9-Game Mix', 'HORSE', 'TORSE', 'Mixed', "Dealer's Choice", 'Limit Hold\'em'] },
];

/* Per-room online rules — show/hide, a buy-in floor and ceiling, and series-only — as ONE grid,
   rendered by both the Online menu and the Filters sheet so the two can never offer different
   controls. Headers are said once, over their columns, so the room name keeps the width. */
function OnlineRoomRules({ sites, siteRules, setFilters, disabled }) {
  const setRule = (key, patch) => setFilters(f => {
    const next = { ...(f.siteRules || {}) };
    const merged = { ...(next[key] || {}), ...patch };
    if (siteRuleIsEmpty(merged)) delete next[key];
    else next[key] = merged;
    // Switching a room ON while Online is off would change nothing on screen, so it turns Online on.
    return { ...f, siteRules: next, showOnline: patch.hidden === false ? true : f.showOnline };
  });
  return (
    <div className={`online-rules${disabled ? ' is-disabled' : ''}`}>
      <span className="online-rules-h online-rules-h-room">Room</span>
      <span className="online-rules-h">Min $</span>
      <span className="online-rules-h">Max $</span>
      <span className="online-rules-h">Series</span>
      {sites.map(({ key, name, count }) => {
        const rule = (siteRules || {})[key] || {};
        const on = !rule.hidden;
        // Floor, ceiling and series are refinements WITHIN a room: disabled with the room off, but
        // their values are kept, so switching the room back on restores what the user set.
        const live = !disabled && on;
        return (
          <React.Fragment key={key}>
            <label className={`online-rules-room${on ? ' on' : ''}`}>
              <input type="checkbox" checked={on} disabled={disabled}
                     onChange={e => setRule(key, { hidden: !e.target.checked })} />
              <span className="online-rules-name">{name}</span>
              <span className="online-rules-count">{count}</span>
            </label>
            <input className="online-rules-num" type="number" min="0" inputMode="numeric" placeholder="any"
                   disabled={!live} value={rule.minBuyin ?? ''} aria-label={`Minimum buy-in for ${name}`}
                   onChange={e => setRule(key, { minBuyin: e.target.value })} />
            <input className="online-rules-num" type="number" min="0" inputMode="numeric" placeholder="any"
                   disabled={!live} value={rule.maxBuyin ?? ''} aria-label={`Maximum buy-in for ${name}`}
                   onChange={e => setRule(key, { maxBuyin: e.target.value })} />
            <input className="online-rules-series" type="checkbox" disabled={!live}
                   checked={!!rule.seriesOnly} aria-label={`Show only series events for ${name}`}
                   onChange={e => setRule(key, { seriesOnly: e.target.checked })} />
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Inline Filters (portal-based, matching original) ──
function Filters({ filters, setFilters, setFiltersRaw, gameVariants, venues, buyinOptions, tournaments, open, setOpen, toggleRef, search, setSearch }) {
  const panelRef = useRef(null);
  // A tap on the Online toggle opens the per-room menu (below), anchored under the button. Online
  // itself is switched from the menu's first row, so the tap no longer toggles it directly.
  const onlineBtnRef = useRef(null);
  const [onlineMenu, setOnlineMenu] = useState(null); // null | { top } (viewport px, measured)
  const openOnlineMenu = useCallback(() => {
    const el = onlineBtnRef.current;
    if (!el) return;
    setOnlineMenu({ top: el.getBoundingClientRect().bottom });
  }, []);
  const [whereOpen, setWhereOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [howMuchOpen, setHowMuchOpen] = useState(false);
  const [whichOpen, setWhichOpen] = useState(false);
  const [specialOpen, setSpecialOpen] = useState(false);

  const dateBounds = useMemo(() => {
    const today = getToday();
    let earliest = null, latestDay1 = null;
    for (const t of (tournaments || [])) {
      const d = normaliseDate(t.date);
      if (!d) continue;
      if (!earliest || d < earliest) earliest = d;
      if (!t.is_restart && (!latestDay1 || d > latestDay1)) latestDay1 = d;
    }
    const minDate = (!earliest || earliest < today) ? today : earliest;
    const maxDate = latestDay1 || today;
    const totalDays = daysBetween(minDate, maxDate);
    return { minDate, maxDate, totalDays };
  }, [tournaments]);

  /* The events the chosen location actually leaves on the table. Every option
     list below is built from THIS rather than from the whole feed, so the panel
     can only ever offer a venue, variant or buy-in band that exists where the
     user is — picking one and getting an empty list is the failure this
     prevents. Date range scopes it too, for the same reason. */
  const locationPool = useMemo(() => {
    const today = getToday();
    return (tournaments || []).filter(t => {
      const d = normaliseDate(t.date);
      if (!d || d < today) return false;
      if (filters.dateFrom && d < filters.dateFrom) return false;
      if (filters.dateTo && d > filters.dateTo) return false;
      return matchesLocation(t, filters) && matchesOnline(t, filters);
    });
  }, [tournaments, filters.dateFrom, filters.dateTo,
      filters.locationRegion, filters.userLocation, filters.maxDistance]);

  const availableVenues = useMemo(() => {
    const countMap = {};
    locationPool.forEach(t => { countMap[t.venue] = (countMap[t.venue] || 0) + 1; });
    return Object.keys(countMap)
      .sort((a, b) => countMap[b] - countMap[a])
      .map(v => ({ venue: v, series: VENUE_TO_SERIES[v] || v, count: countMap[v] }));
  }, [locationPool]);

  const availableGameVariants = useMemo(() => {
    const variantSet = new Set();
    locationPool.forEach(t => { if (t.game_variant) variantSet.add(t.game_variant); });
    return variantSet;
  }, [locationPool]);

  /* Which of the fixed buy-in bands and quick pills have anything behind them
     here. A band with no events is not a choice, it is a dead end. */
  /* Which online rooms are actually represented, and how many events each has.
     Derived from the tournaments in hand rather than from the site registry, so
     the panel offers a control for a room only when that room has events to
     control — and the count tells the user what a floor is about to act on. */
  const onlineSitesInPool = useMemo(() => {
    const counts = new Map();
    for (const t of tournaments || []) {
      if (!t || !t.site) continue;
      counts.set(t.site, (counts.get(t.site) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count, name: (ONLINE_SITES[key] && ONLINE_SITES[key].name) || key }))
      .sort((a, b) => b.count - a.count);
  }, [tournaments]);

  const activeSiteRuleCount = useMemo(() => {
    const r = filters.siteRules || {};
    return Object.keys(r).filter(k => !siteRuleIsEmpty(r[k])).length;
  }, [filters.siteRules]);

  const poolFacts = useMemo(() => {
    const bands = new Set();
    let ladies = false, seniors = false;
    const games = new Set();
    locationPool.forEach(t => {
      const b = Number(t.buyin) || 0;
      if (b < 500) bands.add('0-500');
      else if (b < 1500) bands.add('500-1500');
      else if (b < 5000) bands.add('1500-5000');
      else if (b <= 10000) bands.add('5000-10000');
      else bands.add('10000+');
      const n = t.event_name || '';
      if (/women|ladies/i.test(n)) ladies = true;
      if (/senior/i.test(n)) seniors = true;
      if (t.game_variant) games.add(t.game_variant);
    });
    // Same test the list itself uses: anything that is not NLH or PLO.
    const mixed = [...games].some(g => g !== 'NLH' && g !== 'PLO');
    return { bands, ladies, seniors, games, mixed };
  }, [locationPool]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (toggleRef.current && toggleRef.current.contains(e.target)) return;
      /* Anything this panel portalled to document.body belongs to the panel
         even though it is not inside it. The location dropdown is rendered
         that way — to escape the stacking context, which is the convention
         here — so contains() said every tap in it was a tap outside, and
         choosing a location closed the filters. */
      if (e.target.closest && e.target.closest('[data-filter-portal]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const hasActive = filters.minBuyin || filters.maxBuyin || (filters.buyinRanges && filters.buyinRanges.length > 0) || (filters.rakeRanges && filters.rakeRanges.length > 0) ||
    filters.selectedGames.length > 0 || (filters.hiddenVenues && filters.hiddenVenues.length > 0) || filters.bountyOnly || filters.mysteryBountyOnly || filters.headsUpOnly || filters.tagTeamOnly || filters.employeesOnly || !filters.hideSatellites || !filters.hideRestarts || filters.hideSideEvents || filters.ladiesOnly || filters.seniorsOnly || filters.mixedOnly || filters.dateFrom || filters.dateTo ||
    filters.showOnline === false || filters.onlyAvailableOnline === true ||
    Object.keys(filters.siteRules || {}).length > 0;

  return (
    <>
      {/* All event-kind + online switches on one line below the buttons.
          setFiltersRaw (not the scroll-wrapped setter) so toggling doesn't jump
          the list back to today. */}
      <div className="filter-row" style={{gap:'0',marginTop:'calc(var(--subrow) * 2)',marginBottom:'0',width:'100%',alignItems:'center',flexWrap:'nowrap'}}>
        {/* Satellites / Restarts / Side Events / Online as four toggle BUTTONS, one per primary
            column: each exactly 8g x 2r, with the 1g gutters between them, so the four fill the
            35g between the margins (4 x 8g + 3 x 1g) and each button IS a column. aria-pressed
            carries the state. "Available to me" used to sit here; it is gone from the UI — see
            the note on onlyAvailableOnline in DEFAULT_FILTERS. */}
        <div className="kind-toggles">
          {[
            ['Satellites', !filters.hideSatellites, (on) => ({ hideSatellites: !on })],
            ['Restarts', !filters.hideRestarts, (on) => ({ hideRestarts: !on })],
            ['Side Events', !filters.hideSideEvents, (on) => ({ hideSideEvents: !on })],
            ['Online', filters.showOnline !== false, (on) => ({ showOnline: on })],
          ].map(([label, on, patch]) => {
            const toggle = (
              <button key={label} type="button"
                      className={`kind-toggle${on ? ' active' : ''}`} aria-pressed={on}
                      onClick={() => setFiltersRaw(f => ({ ...f, ...patch(!on) }))}>
                <span className="kind-toggle-label">{label}</span>
              </button>
            );
            // Online is ONE 8g button with two targets: a tap anywhere toggles Online like its
            // neighbours, and the caret in its right-hand 2g cell opens the per-room menu. The
            // label stays centred on the full 8g (it spans ~2g..6g, clear of the caret cell).
            if (label !== 'Online' || onlineSitesInPool.length === 0) return toggle;
            return (
              <div key={label} className="kind-toggle-split" ref={onlineBtnRef}>
                {toggle}
                <button type="button" className={`kind-toggle-caret${on ? ' active' : ''}`}
                        aria-label="Online rooms" aria-haspopup="dialog" aria-expanded={!!onlineMenu}
                        onClick={openOnlineMenu}>
                  <Icon.chevronDown />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {onlineMenu && createPortal(
        <>
          <div className="dropdown-backdrop" style={{ zIndex: 'var(--z-scrim)' }} onClick={() => setOnlineMenu(null)} />
          <div className="online-room-menu" role="dialog" aria-label="Online rooms"
               style={{ top: onlineMenu.top, maxHeight: `calc(100dvh - ${onlineMenu.top}px - var(--subrow) * 4)` }}>
            <div className="online-room-head">
              <label className="online-room-master">
                <input type="checkbox" checked={filters.showOnline !== false}
                       onChange={e => setFiltersRaw(f => ({ ...f, showOnline: e.target.checked }))} />
                <span>Show online events</span>
              </label>
              {/* Only rooms that can serve the state the schedule's location is in. The state is
                  the jurisdiction derived from (or chosen for) that location; with none there is
                  nothing to test against, so the box is disabled and says why rather than
                  filtering on a blank. Offshore rooms that publish no state list stay visible. */}
              {(() => {
                const st = stateName(filters.jurisdiction);
                const usable = !!st && filters.showOnline !== false;
                return (
                  <label className={`online-room-master${st ? '' : ' is-unset'}`}>
                    <input type="checkbox" disabled={!usable} checked={!!st && !!filters.onlyAvailableOnline}
                           onChange={e => setFiltersRaw(f => ({ ...f, onlyAvailableOnline: e.target.checked }))} />
                    <span>{st ? `Available in ${st}, USA` : 'Available in my state (set a location)'}</span>
                  </label>
                );
              })()}
            </div>
            <OnlineRoomRules sites={onlineSitesInPool} siteRules={filters.siteRules}
                             setFilters={setFiltersRaw} disabled={filters.showOnline === false} />
            {activeSiteRuleCount > 0 && (
              <button type="button" className="online-room-clear"
                      onClick={() => setFiltersRaw(f => ({ ...f, siteRules: {} }))}>
                Clear room rules
              </button>
            )}
          </div>
        </>,
        document.body
      )}

      {open && createPortal(
        <div className="dropdown-backdrop" onClick={() => setOpen(false)} />,
        document.body
      )}
      {open && createPortal(
        <div ref={panelRef} className="filter-panel" style={(() => {
          const r = toggleRef.current?.getBoundingClientRect();
          if (!r) return { top: 60, left: 8, right: 8 };
          const vh = window.innerHeight || document.documentElement.clientHeight || 700;
          const pane = toggleRef.current.closest('.dk-pane');
          if (pane) {
            const pr = pane.getBoundingClientRect();
            const g = pr.width / 37;
            return { top: r.bottom + g, left: pr.left + g, width: pr.width - 2 * g, maxHeight: vh - r.bottom - 2 * g };
          }
          return { top: r.bottom + 10, left: 8, right: 8, maxHeight: vh - r.bottom - 22 };
        })()}>
          {/* Quick filter pills */}
          {(() => {
            const quickFilters = [
              { label: 'NLH', isActive: filters.selectedGames.includes('NLH'),
                toggle: () => setFilters(f => ({ ...f, selectedGames: f.selectedGames.includes('NLH') ? f.selectedGames.filter(g => g !== 'NLH') : [...f.selectedGames, 'NLH'] })) },
              { label: 'PLO', isActive: filters.selectedGames.includes('PLO'),
                toggle: () => setFilters(f => ({ ...f, selectedGames: f.selectedGames.includes('PLO') ? f.selectedGames.filter(g => g !== 'PLO') : [...f.selectedGames, 'PLO'] })) },
              { label: 'Mixed', isActive: !!filters.mixedOnly,
                toggle: () => setFilters(f => ({ ...f, mixedOnly: !f.mixedOnly })) },
              { label: 'Ladies', isActive: !!filters.ladiesOnly,
                toggle: () => setFilters(f => ({ ...f, ladiesOnly: !f.ladiesOnly })) },
              { label: 'Seniors', isActive: !!filters.seniorsOnly,
                toggle: () => setFilters(f => ({ ...f, seniorsOnly: !f.seniorsOnly })) },
            ].filter(qf => {
              /* A pill with nothing behind it here is not a choice. An ACTIVE
                 one always stays, or turning it on would make the control that
                 turns it off disappear. */
              if (qf.isActive) return true;
              if (qf.label === 'NLH') return poolFacts.games.has('NLH');
              if (qf.label === 'PLO') return poolFacts.games.has('PLO');
              if (qf.label === 'Mixed') return poolFacts.mixed;
              if (qf.label === 'Ladies') return poolFacts.ladies;
              if (qf.label === 'Seniors') return poolFacts.seniors;
              return true;
            });
            return (
              <div style={{display:'flex',gap:'calc(var(--subrow) * 0.75)',marginBottom:'calc(var(--subrow) * 1.25)',gridColumn:'1 / -1'}}>
                {quickFilters.map(qf => (
                  <button key={qf.label} className={`filter-chip ${qf.isActive ? 'active' : ''}`}
                    style={{flex:'1 1 0',minWidth:0,justifyContent:'center',textAlign:'center'}}
                    onClick={qf.toggle}
                  >{qf.label}</button>
                ))}
              </div>
            );
          })()}

          {/* Search — desktop pairs with Date Range via .filter-row layout */}
          <div className="filter-group filter-row filter-search-cell" style={{marginBottom:'calc(var(--subrow) * 0.75)'}}>
            <div className="search-bar" style={{marginBottom:0,height:'calc(var(--subrow) * 4)'}}>
              <Icon.search />
              <input type="text" placeholder={"Search events, games\u2026"} value={search} onChange={e => setSearch(e.target.value)} style={{padding:'calc(var(--subrow) * 0.5) 0'}} />
              {search && (
                <button onClick={() => setSearch('')} style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.473)',padding:'0 calc(var(--subrow) * 0.25)'}}>&#10005;</button>
              )}
            </div>
          </div>

          {/* Date Range Slider */}
          {dateBounds.totalDays > 0 && (() => {
            const { minDate, maxDate, totalDays } = dateBounds;
            const fromIdx = filters.dateFrom ? Math.max(0, daysBetween(minDate, filters.dateFrom)) : 0;
            const toIdx = filters.dateTo ? Math.min(totalDays, daysBetween(minDate, filters.dateTo)) : totalDays;
            const fromDate = addDays(minDate, fromIdx);
            const toDate = addDays(minDate, toIdx);
            const pctL = (fromIdx / totalDays) * 100;
            const pctR = (toIdx / totalDays) * 100;
            return (
              <div className="filter-group filter-row filter-daterange-cell" style={{marginBottom:'calc(var(--subrow) * 0.75)'}}>
                <label style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',marginBottom:'calc(var(--subrow) * 0.75)',display:'block',fontWeight: 'var(--fw-bold)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Date Range</label>
                <div style={{padding:'0 calc(var(--subrow) * 0.75)'}}>
                  <div className="date-slider-wrap">
                    <div className="date-slider-track" />
                    <div className="date-slider-fill" style={{left: pctL + '%', right: (100 - pctR) + '%'}} />
                    <input type="range" className="date-slider-input" min={0} max={totalDays} value={fromIdx}
                      onChange={e => {
                        const v = Math.min(Number(e.target.value), toIdx);
                        setFilters(f => ({...f, dateFrom: v <= 0 ? '' : addDays(minDate, v)}));
                      }}
                    />
                    <input type="range" className="date-slider-input" min={0} max={totalDays} value={toIdx}
                      onChange={e => {
                        const v = Math.max(Number(e.target.value), fromIdx);
                        setFilters(f => ({...f, dateTo: v >= totalDays ? '' : addDays(minDate, v)}));
                      }}
                    />
                  </div>
                  <div className="date-slider-labels">
                    <label className="date-slider-date-link">
                      {fmtShortDate(fromDate)}
                      <input type="date" value={fromDate} min={minDate} max={toDate}
                        onChange={e => {
                          const v = e.target.value;
                          if (!v) { setFilters(f => ({...f, dateFrom: ''})); return; }
                          setFilters(f => ({...f, dateFrom: daysBetween(minDate, v) <= 0 ? '' : v}));
                        }}
                      />
                    </label>
                    <label className="date-slider-date-link">
                      {fmtShortDate(toDate)}
                      <input type="date" value={toDate} min={fromDate} max={maxDate}
                        onChange={e => {
                          const v = e.target.value;
                          if (!v) { setFilters(f => ({...f, dateTo: ''})); return; }
                          setFilters(f => ({...f, dateTo: daysBetween(minDate, v) >= totalDays ? '' : v}));
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Online rooms — a floor and a series switch, per site.
              Only rendered when online events are actually in the pool and
              showing: a control for rooms that are not on screen is noise, and
              one that cannot change anything reads as broken. */}
          {filters.showOnline !== false && onlineSitesInPool.length > 0 && (
          <div className="filter-group filter-span2">
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)'}} onClick={() => setOnlineOpen(o => !o)}>
              Online rooms
              {activeSiteRuleCount > 0 && (
                <span style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--accent)',textTransform:'none',letterSpacing:0}}>
                  {activeSiteRuleCount} set
                </span>
              )}
              <span style={{fontSize:'calc(var(--gu) * 1.031)',transition:'transform 0.15s',transform: onlineOpen ? 'rotate(180deg)' : 'rotate(0deg)'}}>{'▼'}</span>
            </label>
            {onlineOpen && (<div style={{display:'flex',flexDirection:'column',gap:'calc(var(--subrow) * 1)'}}>
              <div style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',textTransform:'none',letterSpacing:0,lineHeight:1.4}}>
                One buy-in floor cannot fit every room — these run from $1 to $25,500.
              </div>
              <label style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)',fontSize:'calc(var(--gu) * 1.149)',textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                <input type="checkbox"
                  checked={onlineSitesInPool.every(s => !(filters.siteRules || {})[s.key]?.hidden)}
                  ref={el => { if (el) {
                    const off = onlineSitesInPool.filter(s => (filters.siteRules || {})[s.key]?.hidden).length;
                    el.indeterminate = off > 0 && off < onlineSitesInPool.length;
                  } }}
                  onChange={e => setFilters(f => {
                    const next = { ...(f.siteRules || {}) };
                    for (const s of onlineSitesInPool) {
                      const merged = { ...(next[s.key] || {}), hidden: !e.target.checked };
                      if (siteRuleIsEmpty(merged)) delete next[s.key];
                      else next[s.key] = merged;
                    }
                    return { ...f, siteRules: next };
                  })}
                  style={{margin:0}} />
                All rooms
              </label>
              <OnlineRoomRules sites={onlineSitesInPool} siteRules={filters.siteRules} setFilters={setFilters} />
              {activeSiteRuleCount > 0 && (
                <button onClick={() => setFilters(f => ({ ...f, siteRules: {} }))} style={{
                  alignSelf:'flex-start',background:'none',border:'none',color:'var(--text-muted)',
                  fontSize:'calc(var(--gu) * 1.149)',cursor:'pointer',padding:0,textTransform:'none',letterSpacing:0,
                }}>
                  Clear room rules
                </button>
              )}
            </div>)}
          </div>
          )}

          {/* Series */}
          <div className="filter-group filter-span2">
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)'}} onClick={() => setWhereOpen(w => !w)}>
              Series
              <span style={{fontSize:'calc(var(--gu) * 1.031)',transition:'transform 0.15s',transform: whereOpen ? 'rotate(180deg)' : 'rotate(0deg)'}}>{'\u25BC'}</span>
            </label>
            {whereOpen && (<div style={{display:'flex',flexDirection:'column',gap:'calc(var(--subrow) * 0.75)'}}>
              <label style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.208)',fontWeight: 'var(--fw-bold)',textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                <input type="checkbox"
                  checked={!filters.hiddenVenues || filters.hiddenVenues.length === 0}
                  ref={el => { if (el) el.indeterminate = filters.hiddenVenues && filters.hiddenVenues.length > 0 && filters.hiddenVenues.length < availableVenues.length; }}
                  onChange={e => setFilters(f => ({...f, hiddenVenues: e.target.checked ? [] : availableVenues.map(v => v.venue)}))}
                  style={{marginTop:'calc(var(--subrow) * 0.125)'}}
                /> All
              </label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'calc(var(--subrow) * 0.5) calc(var(--subrow) * 1.5)'}}>
                {availableVenues.map(({ venue, series }) => {
                  const hidden = (filters.hiddenVenues || []).includes(venue);
                  return (
                    <label key={venue} style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)',fontSize:'calc(var(--gu) * 1.208)',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                      <input type="checkbox" checked={!hidden}
                        onChange={e => setFilters(f => {
                          const hv = f.hiddenVenues || [];
                          return {...f, hiddenVenues: e.target.checked ? hv.filter(v => v !== venue) : [...hv, venue]};
                        })}
                        style={{marginTop:'calc(var(--subrow) * 0.125)',flexShrink:0}}
                      />
                      <span style={{lineHeight:1.3}}>{series}</span>
                    </label>
                  );
                })}
              </div>
            </div>)}
          </div>

          {/* Buy-in / Rake */}
          <div className="filter-group filter-span2">
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)'}} onClick={() => setHowMuchOpen(h => !h)}>
              Buy-in / Rake
              <span style={{fontSize:'calc(var(--gu) * 1.031)',transition:'transform 0.15s',transform: howMuchOpen ? 'rotate(180deg)' : 'rotate(0deg)'}}>{'\u25BC'}</span>
            </label>
            {howMuchOpen && (() => {
              /* Only bands that exist here — see poolFacts. */
              const buyinOpts = [
                { key: '0-500', label: 'Under $500' },
                { key: '500-1500', label: '$500 \u2013 $1.5K' },
                { key: '1500-5000', label: '$1.5K \u2013 $5K' },
                { key: '5000-10000', label: '$5K \u2013 $10K' },
                { key: '10000+', label: '$10K+' },
              ].filter(o => poolFacts.bands.has(o.key) || (filters.buyinRanges || []).includes(o.key));
              const rakeOpts = [
                { key: '0-5', label: 'Under 5%' },
                { key: '5-8', label: '5% \u2013 8%' },
                { key: '8-10', label: '8% \u2013 10%' },
                { key: '10-13', label: '10% \u2013 13%' },
                { key: '13+', label: '13%+' },
              ];
              const toggleArr = (arr, key) => arr.includes(key) ? arr.filter(k => k !== key) : [...arr, key];
              const allBuyinChecked = (filters.buyinRanges || []).length === 0;
              const allRakeChecked = (filters.rakeRanges || []).length === 0;
              return (<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 calc(var(--subrow) * 1.5)'}}>
                <div style={{display:'flex',flexDirection:'column',gap:'calc(var(--subrow) * 0.5)'}}>
                  <label style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',fontWeight: 'var(--fw-bold)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'calc(var(--subrow) * 0.25)'}}>Buy-in</label>
                  <label style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)',fontSize:'calc(var(--gu) * 1.208)',fontWeight: 'var(--fw-bold)',textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                    <input type="checkbox" checked={allBuyinChecked}
                      onChange={() => setFilters(f => ({...f, buyinRanges: [], minBuyin: '', maxBuyin: ''}))}
                      style={{marginTop:'calc(var(--subrow) * 0.125)',flexShrink:0}}
                    /><span>All</span>
                  </label>
                  {buyinOpts.map(opt => (
                    <label key={opt.key} style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)',fontSize:'calc(var(--gu) * 1.208)',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                      <input type="checkbox" checked={(filters.buyinRanges || []).includes(opt.key)}
                        onChange={() => setFilters(f => ({...f, buyinRanges: toggleArr(f.buyinRanges || [], opt.key), minBuyin: '', maxBuyin: ''}))}
                        style={{marginTop:'calc(var(--subrow) * 0.125)',flexShrink:0}}
                      /><span>{opt.label}</span>
                    </label>
                  ))}
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:'calc(var(--subrow) * 0.5)'}}>
                  <label style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',fontWeight: 'var(--fw-bold)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'calc(var(--subrow) * 0.25)'}}>Rake</label>
                  <label style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)',fontSize:'calc(var(--gu) * 1.208)',fontWeight: 'var(--fw-bold)',textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                    <input type="checkbox" checked={allRakeChecked}
                      onChange={() => setFilters(f => ({...f, rakeRanges: []}))}
                      style={{marginTop:'calc(var(--subrow) * 0.125)',flexShrink:0}}
                    /><span>All</span>
                  </label>
                  {rakeOpts.map(opt => (
                    <label key={opt.key} style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)',fontSize:'calc(var(--gu) * 1.208)',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                      <input type="checkbox" checked={(filters.rakeRanges || []).includes(opt.key)}
                        onChange={() => setFilters(f => ({...f, rakeRanges: toggleArr(f.rakeRanges || [], opt.key)}))}
                        style={{marginTop:'calc(var(--subrow) * 0.125)',flexShrink:0}}
                      /><span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>);
            })()}
          </div>

          {/* Variant */}
          <div className="filter-group filter-span2">
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)'}} onClick={() => setWhichOpen(w => !w)}>
              Variant
              <span style={{fontSize:'calc(var(--gu) * 1.031)',transition:'transform 0.15s',transform: whichOpen ? 'rotate(180deg)' : 'rotate(0deg)'}}>{'\u25BC'}</span>
            </label>
            {whichOpen && (() => {
              const allSelected = filters.selectedGames.length === 0;
              const toggleVariant = (v, checked) => {
                setFilters(f => ({...f, selectedGames: checked ? [...f.selectedGames, v] : f.selectedGames.filter(g => g !== v)}));
              };
              return (<div style={{display:'flex',flexDirection:'column',gap:'calc(var(--subrow) * 0.5)'}}>
                <label style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.208)',fontWeight: 'var(--fw-bold)',textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                  <input type="checkbox" checked={allSelected}
                    onChange={() => setFilters(f => ({...f, selectedGames:[]}))}
                    style={{marginTop:'calc(var(--subrow) * 0.125)'}}
                  /> All
                </label>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'calc(var(--subrow) * 0.5) calc(var(--subrow) * 1.5)',paddingLeft:'calc(var(--subrow) * 2.625)'}}>
                {GAME_GROUPS.map(group => {
                  const availVars = group.variants.filter(v => availableGameVariants.has(v));
                  if (availVars.length === 0) return null;
                  const isSingle = availVars.length === 1 && group.variants.length === 1;
                  const groupChecked = availVars.every(v => filters.selectedGames.includes(v));
                  const groupPartial = availVars.some(v => filters.selectedGames.includes(v)) && !groupChecked;
                  if (isSingle) {
                    const v = availVars[0];
                    return (
                      <label key={group.label} style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.208)',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)',marginBottom:'calc(var(--subrow) * 0.75)'}}>
                        <input type="checkbox" checked={filters.selectedGames.includes(v)}
                          onChange={e => toggleVariant(v, e.target.checked)}
                          style={{marginTop:'calc(var(--subrow) * 0.125)'}}
                        /> {group.label}
                      </label>
                    );
                  }
                  const needsTopGap = group.label === 'Draw' || group.label === 'Mixed';
                  return (
                    <div key={group.label} style={needsTopGap ? {marginTop:'calc(var(--subrow) * 0.75)'} : undefined}>
                      <label style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.208)',fontWeight: 'var(--fw-bold)',textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                        <input type="checkbox" checked={groupChecked}
                          ref={el => { if (el) el.indeterminate = groupPartial; }}
                          onChange={e => {
                            const checked = e.target.checked;
                            setFilters(f => {
                              const without = f.selectedGames.filter(v => !availVars.includes(v));
                              return {...f, selectedGames: checked ? [...without, ...availVars] : without};
                            });
                          }}
                          style={{marginTop:'calc(var(--subrow) * 0.125)'}}
                        /> {group.label}
                      </label>
                      <div style={{display:'flex',flexDirection:'column',gap:'calc(var(--subrow) * 0.25)',paddingLeft:'calc(var(--subrow) * 2.625)',marginTop:'calc(var(--subrow) * 0.25)'}}>
                        {availVars.map(v => (
                          <label key={v} style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.149)',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text-muted)'}}>
                            <input type="checkbox" checked={filters.selectedGames.includes(v)}
                              onChange={e => toggleVariant(v, e.target.checked)}
                              style={{marginTop:'calc(var(--subrow) * 0.125)'}}
                            /> {v}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>);
            })()}
          </div>

          {/* Special */}
          <div className="filter-group filter-span2">
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)'}} onClick={() => setSpecialOpen(s => !s)}>
              Special
              <span style={{fontSize:'calc(var(--gu) * 1.031)',transition:'transform 0.15s',transform: specialOpen ? 'rotate(180deg)' : 'rotate(0deg)'}}>{'\u25BC'}</span>
            </label>
            {specialOpen && (
              <div style={{display:'flex',flexDirection:'column',gap:'calc(var(--subrow) * 0.5)',marginTop:'calc(var(--subrow) * 0.5)'}}>
                {[
                  ['ladiesOnly', 'Ladies'],
                  ['seniorsOnly', 'Seniors'],
                  ['bountyOnly', 'Bounty'],
                  ['mysteryBountyOnly', 'Mystery Bounty'],
                  ['headsUpOnly', 'Heads Up'],
                  ['tagTeamOnly', 'Tag Team'],
                  ['employeesOnly', 'Casino Employees'],
                ].map(([key, label]) => (
                  <label key={key} style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.208)',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                    <input type="checkbox" checked={!!filters[key]}
                      onChange={() => setFilters(f => ({...f, [key]: !f[key]}))}
                      style={{marginTop:'calc(var(--subrow) * 0.125)'}}
                    /> {label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="filter-group filter-actions" style={{gridColumn:'1 / -1',display:'flex',flexDirection:'row',gap:'calc(var(--subrow) * 1)',justifyContent:'flex-end',alignItems:'center',marginTop:'calc(var(--subrow) * 0.5)'}}>
            {hasActive && (
              <button className="btn btn-ghost btn-sm" onClick={() =>
                setFilters(f => ({minBuyin:'',maxBuyin:'',buyinRanges:[],rakeRanges:[],selectedGames:[],hiddenVenues:[],bountyOnly:false,mysteryBountyOnly:false,headsUpOnly:false,tagTeamOnly:false,employeesOnly:false,hideSatellites:true,hideRestarts:true,hideSideEvents:false,hiddenMonths:[],ladiesOnly:false,seniorsOnly:false,mixedOnly:false,dateFrom:'',dateTo:'',/* Location survives a clear: it is a standing choice about where the user IS, not a filter they set for one look at the list. It changes only when they change it. */maxDistance:f.maxDistance,userLocation:f.userLocation,locationRegion:f.locationRegion,locationLabel:f.locationLabel,jurisdiction:f.jurisdiction,jurisdictionManual:f.jurisdictionManual,showOnline:true,onlyAvailableOnline:false,siteRules:{}}))
              }>Clear all filters</button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>Save &amp; Close</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Import Schedule Panel (dropdown from upload button) ───
function ImportSchedulePanel({ isOpen, onClose, token, onRefreshTournaments }) {
  const toast = useToast();
  const [visionFile, setVisionFile] = useState(null);
  const [visionVenue, setVisionVenue] = useState('');
  const [visionUrl, setVisionUrl] = useState('');
  const [visionParsing, setVisionParsing] = useState(false);
  const [visionResults, setVisionResults] = useState(null);
  const [visionError, setVisionError] = useState('');
  const [visionImporting, setVisionImporting] = useState(false);
  const [visionEditIdx, setVisionEditIdx] = useState(-1);
  const [visionProgress, setVisionProgress] = useState(0);
  const [visionStage, setVisionStage] = useState('');
  const visionProgressRef = useRef(null);

  const handleVisionUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setVisionFile(files.length === 1 ? files[0] : { name: `${files.length} files` });
    setVisionError('');
    setVisionResults(null);
    setVisionParsing(true);
    setVisionProgress(0);
    setVisionStage('Uploading...');

    const hasPdf = files.some(f => f.name.toLowerCase().endsWith('.pdf'));
    const stages = [
      { at: 5,  label: `Uploading ${files.length > 1 ? files.length + ' files' : 'file'}...` },
      { at: 10, label: hasPdf ? 'Reading PDF pages...' : `Processing ${files.length > 1 ? files.length + ' images' : 'image'}...` },
      { at: 20, label: 'Pass 1: Transcribing schedule...' },
      { at: 40, label: 'Pass 1: Reading event details...' },
      { at: 55, label: 'Pass 2: Structuring events...' },
      { at: 70, label: 'Pass 2: Mapping variants...' },
      { at: 82, label: 'Validating data...' },
      { at: 92, label: 'Finalizing...' },
    ];
    let stageIdx = 0;
    const startTime = Date.now();
    const estDuration = hasPdf ? 60000 : Math.max(30000, files.length * 15000);

    visionProgressRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const raw = 95 * (1 - Math.exp(-2.5 * elapsed / estDuration));
      const pct = Math.min(95, Math.round(raw));
      setVisionProgress(pct);
      while (stageIdx < stages.length && pct >= stages[stageIdx].at) {
        setVisionStage(stages[stageIdx].label);
        stageIdx++;
      }
    }, 200);

    const fd = new FormData();
    for (const file of files) {
      fd.append('file', file);
    }
    if (visionVenue) fd.append('venue', visionVenue);

    try {
      const res = await fetch(`${API_URL}/parse-schedule`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parse failed');
      clearInterval(visionProgressRef.current);
      setVisionProgress(100);
      setVisionStage(data.eventCount > 0 ? `Found ${data.eventCount} events` : 'No events found');
      await new Promise(r => setTimeout(r, 400));
      setVisionResults(data);
      if (data.detectedVenue && !visionVenue) setVisionVenue(data.detectedVenue);
    } catch (err) {
      clearInterval(visionProgressRef.current);
      setVisionProgress(0);
      setVisionStage('');
      setVisionError(err.message || 'Failed to parse schedule');
    } finally {
      clearInterval(visionProgressRef.current);
      setVisionParsing(false);
      e.target.value = '';
    }
  };

  const handleVisionUrl = async () => {
    if (!visionUrl.trim()) return;
    setVisionError('');
    setVisionResults(null);
    setVisionParsing(true);
    setVisionProgress(0);
    setVisionStage('Fetching URL...');

    const isUrlPdf = visionUrl.toLowerCase().endsWith('.pdf');
    const stages = [
      { at: 5,  label: 'Fetching URL...' },
      { at: 12, label: isUrlPdf ? 'Reading PDF...' : 'Extracting page content...' },
      { at: 20, label: 'Analyzing schedule...' },
      { at: 35, label: 'Reading event details...' },
      { at: 50, label: 'Structuring events...' },
      { at: 65, label: 'Processing events...' },
      { at: 78, label: 'Mapping variants...' },
      { at: 88, label: 'Validating data...' },
      { at: 94, label: 'Finalizing...' },
    ];
    let stageIdx = 0;
    const startTime = Date.now();
    const estDuration = isUrlPdf ? 90000 : 45000;

    visionProgressRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const raw = 95 * (1 - Math.exp(-2.0 * elapsed / estDuration));
      const pct = Math.min(95, Math.round(raw));
      setVisionProgress(pct);
      while (stageIdx < stages.length && pct >= stages[stageIdx].at) {
        setVisionStage(stages[stageIdx].label);
        stageIdx++;
      }
    }, 200);

    try {
      const res = await fetch(`${API_URL}/parse-schedule-url`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: visionUrl.trim(), venue: visionVenue })
      });
      const rawText = await res.text();
      let data;
      try { data = JSON.parse(rawText); } catch { throw new Error('Server error -- please try again'); }
      if (!res.ok) throw new Error(data.error || 'Parse failed');
      clearInterval(visionProgressRef.current);
      setVisionProgress(100);
      setVisionStage(data.eventCount > 0 ? `Found ${data.eventCount} events` : 'No events found');
      await new Promise(r => setTimeout(r, 400));
      setVisionResults(data);
      if (data.detectedVenue && !visionVenue) setVisionVenue(data.detectedVenue);
    } catch (err) {
      clearInterval(visionProgressRef.current);
      setVisionProgress(0);
      setVisionStage('');
      setVisionError(err.message || 'Failed to parse URL');
    } finally {
      clearInterval(visionProgressRef.current);
      setVisionParsing(false);
    }
  };

  const removeVisionEvent = (idx) => {
    if (!visionResults) return;
    const newEvents = visionResults.events.filter((_, i) => i !== idx);
    setVisionResults({ ...visionResults, events: newEvents, eventCount: newEvents.length });
  };

  const updateVisionEvent = (idx, field, value) => {
    if (!visionResults) return;
    const newEvents = [...visionResults.events];
    newEvents[idx] = { ...newEvents[idx], [field]: value };
    setVisionResults({ ...visionResults, events: newEvents });
  };

  const handleVisionImport = async () => {
    if (!visionResults || !visionResults.events.length) return;
    setVisionImporting(true);
    setVisionError('');

    try {
      const checkRes = await fetch(`${API_URL}/check-schedule-duplicates`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: visionResults.events })
      });
      const dupCheck = await checkRes.json();

      if (dupCheck.existing > 0 && dupCheck.new === 0) {
        const proceed = window.confirm(
          `All ${dupCheck.existing} events already exist in the schedule (${dupCheck.existingVenues?.join(', ') || 'unknown venue'}). Importing will update them with the new data.\n\nContinue?`
        );
        if (!proceed) { setVisionImporting(false); return; }
      } else if (dupCheck.existing > 0) {
        const proceed = window.confirm(
          `${dupCheck.existing} of ${dupCheck.total} events already exist in the schedule. ${dupCheck.new} are new.\n\nImporting will add new events and update existing ones. Continue?`
        );
        if (!proceed) { setVisionImporting(false); return; }
      }

      const res = await fetch(`${API_URL}/import-parsed-schedule`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: visionResults.events,
          sourceFile: visionResults.sourceFile || 'Vision Upload'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      const parts = [];
      if (data.inserted) parts.push(`${data.inserted} new`);
      if (data.updated) parts.push(`${data.updated} updated`);
      if (data.skipped) parts.push(`${data.skipped} skipped`);
      toast.success(`Import complete: ${parts.join(', ')}`);
      setVisionResults(null);
      setVisionFile(null);
      setVisionVenue('');
      if (onRefreshTournaments) onRefreshTournaments();
      onClose();
    } catch (err) {
      setVisionError(err.message || 'Failed to import events');
    } finally {
      setVisionImporting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <>
      <div style={{position:'fixed',inset:0,zIndex:998}} onClick={() => { if (!visionParsing && !visionImporting) onClose(); }} />
      <div style={{
        position:'fixed',top:'calc(var(--subrow) * 8)',left:'50%',transform:'translateX(-50%)',
        zIndex:999,background:'var(--surface)',border:'var(--bw-hair) solid var(--border)',
        borderRadius:'var(--radius)',padding:'calc(var(--subrow) * 1.5)',width:'min(calc(var(--subrow) * 47.5), calc(100vw - calc(var(--subrow) * 3)))',
        boxShadow:'0 calc(var(--subrow) * 1) calc(var(--subrow) * 3) rgba(0,0,0,0.3)',maxHeight:'calc(100vh - calc(var(--subrow) * 10))',overflowY:'auto',
      }}>
        <div style={{display:'flex',flexDirection:'column',gap:'calc(var(--subrow) * 1)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight:700,fontSize:'calc(var(--gu) * 1.325)',color:'var(--text)'}}>Import Schedule</span>
            <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.473)',padding:'0 calc(var(--subrow) * 0.25)'}}>&#10005;</button>
          </div>
          <p style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',lineHeight:1.4,margin:0}}>
            Upload a PDF/image or paste a web link. AI extracts event data automatically.
          </p>
          <input type="text" placeholder="Venue (optional -- auto-detected from document)"
            value={visionVenue} onChange={e => setVisionVenue(e.target.value)}
            style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1.25)',borderRadius:'calc(var(--subrow) * 0.75)',border:'var(--bw-hair) solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.178)',width:'100%',boxSizing:'border-box'}} />
          <input type="file" id="vision-schedule-upload-dropdown" className="file-input"
            accept=".pdf,.png,.jpg,.jpeg,.webp" multiple onChange={handleVisionUpload} disabled={visionParsing} />
          <label htmlFor="vision-schedule-upload-dropdown" className="btn btn-ghost btn-sm"
            style={{alignSelf:'flex-start',display:'inline-flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)',opacity:visionParsing?0.5:1,pointerEvents:visionParsing?'none':'auto'}}>
            <Icon.upload /> {visionParsing ? 'Scanning...' : 'Upload File(s)'}
          </label>
          <div style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 1)',width:'100%'}}>
            <span style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>or</span>
            <input type="text" placeholder="Paste schedule URL..." value={visionUrl}
              onChange={e => setVisionUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && visionUrl.trim()) handleVisionUrl(); }}
              disabled={visionParsing}
              style={{flex:1,padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1.25)',borderRadius:'calc(var(--subrow) * 0.75)',border:'var(--bw-hair) solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.178)',opacity:visionParsing?0.5:1}} />
            <button className="btn btn-ghost btn-sm" onClick={handleVisionUrl}
              disabled={visionParsing || !visionUrl.trim()}
              style={{whiteSpace:'nowrap',opacity:(visionParsing||!visionUrl.trim())?0.5:1}}>
              Fetch
            </button>
          </div>

          {visionParsing && (
            <div style={{padding:'calc(var(--subrow) * 1.5)',background:'var(--bg)',borderRadius:'calc(var(--subrow) * 1)',border:'var(--bw-hair) solid var(--border)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'calc(var(--subrow) * 0.75)'}}>
                <span style={{fontSize:'calc(var(--gu) * 1.178)',color:'var(--text-muted)'}}>{visionStage}</span>
                <span style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',fontVariantNumeric:'tabular-nums'}}>{visionProgress}%</span>
              </div>
              <div style={{height:'calc(var(--subrow) * 0.75)',background:'var(--border)',borderRadius:'calc(var(--subrow) * 0.375)',overflow:'hidden'}}>
                <div style={{
                  height:'100%',width:visionProgress+'%',
                  background:'linear-gradient(90deg, var(--accent), var(--accent-hover, var(--accent)))',
                  borderRadius:'calc(var(--subrow) * 0.375)',transition:visionProgress===100?'width 0.3s ease':'width 0.4s ease-out',
                }} />
              </div>
            </div>
          )}

          {visionError && (
            <div style={{padding:'calc(var(--subrow) * 1) calc(var(--subrow) * 1.5)',background:'rgba(220,38,38,0.1)',border:'var(--bw-hair) solid rgba(220,38,38,0.3)',borderRadius:'calc(var(--subrow) * 0.75)',color:'#ef4444',fontSize:'calc(var(--gu) * 1.178)'}}>
              {visionError}
            </div>
          )}

          {visionResults && visionResults.events.length > 0 && (
            <div style={{marginTop:'calc(var(--subrow) * 0.5)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'calc(var(--subrow) * 1)'}}>
                <div>
                  <span style={{fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight:700,fontSize:'calc(var(--gu) * 1.325)',color:'var(--text)'}}>
                    {visionResults.eventCount} Events Found
                  </span>
                  {visionResults.detectedVenue && (
                    <span style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',marginLeft:'calc(var(--subrow) * 1)'}}>
                      at {visionResults.detectedVenue}
                    </span>
                  )}
                </div>
                <span style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)'}}>
                  {visionResults.pageCount} page{visionResults.pageCount !== 1 ? 's' : ''} scanned
                </span>
              </div>

              {visionResults.warnings && visionResults.warnings.length > 0 && (
                <div style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1.25)',background:'rgba(234,179,8,0.1)',border:'var(--bw-hair) solid rgba(234,179,8,0.3)',borderRadius:'calc(var(--subrow) * 0.75)',marginBottom:'calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.104)',color:'#eab308'}}>
                  {visionResults.warnings.length} warning{visionResults.warnings.length !== 1 ? 's' : ''}: {visionResults.warnings.slice(0,3).map(w => w.warnings.join(', ')).join('; ')}{visionResults.warnings.length > 3 ? ` (+${visionResults.warnings.length - 3} more)` : ''}
                </div>
              )}

              <div style={{maxHeight:'calc(var(--subrow) * 37.5)',overflowY:'auto',border:'var(--bw-hair) solid var(--border)',borderRadius:'calc(var(--subrow) * 1)'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'calc(var(--gu) * 1.104)'}}>
                  <thead>
                    <tr style={{borderBottom:'calc(var(--subrow) * 0.25) solid var(--border)',position:'sticky',top:0,background:'var(--bg)'}}>
                      <th style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1)',textAlign:'left',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight: 'var(--fw-bold)',fontSize:'calc(var(--gu) * 0.957)',textTransform:'uppercase'}}>Date</th>
                      <th style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1)',textAlign:'left',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight: 'var(--fw-bold)',fontSize:'calc(var(--gu) * 0.957)',textTransform:'uppercase'}}>Time</th>
                      <th style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1)',textAlign:'left',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight: 'var(--fw-bold)',fontSize:'calc(var(--gu) * 0.957)',textTransform:'uppercase'}}>Event</th>
                      <th style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1)',textAlign:'right',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight: 'var(--fw-bold)',fontSize:'calc(var(--gu) * 0.957)',textTransform:'uppercase'}}>Buy-in</th>
                      <th style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 0.5)',textAlign:'center',width:'calc(var(--subrow) * 3.75)'}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visionResults.events.map((ev, i) => (
                      <React.Fragment key={i}>
                        <tr
                          style={{borderBottom:'var(--bw-hair) solid var(--border)',cursor:'pointer',background:visionEditIdx===i?'var(--surface)':'transparent'}}
                          onClick={() => setVisionEditIdx(visionEditIdx === i ? -1 : i)}>
                          <td style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1)',whiteSpace:'nowrap',color:'var(--text)',fontSize:'calc(var(--gu) * 1.075)'}}>{ev.date ? ev.date.replace(/, \d{4}$/, '') : '?'}</td>
                          <td style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1)',whiteSpace:'nowrap',color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.075)'}}>{ev.time || '?'}</td>
                          <td style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.075)',maxWidth:'calc(var(--subrow) * 20)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {ev.is_satellite && <span style={{fontSize:'calc(var(--gu) * 0.884)',padding:'calc(var(--subrow) * 0.125) calc(var(--subrow) * 0.5)',borderRadius:'calc(var(--subrow) * 0.375)',background:'rgba(139,92,246,0.2)',color:'#a78bfa',marginRight:'calc(var(--subrow) * 0.5)',fontWeight: 'var(--fw-bold)'}}>SAT</span>}
                            {ev.is_restart && <span style={{fontSize:'calc(var(--gu) * 0.884)',padding:'calc(var(--subrow) * 0.125) calc(var(--subrow) * 0.5)',borderRadius:'calc(var(--subrow) * 0.375)',background:'rgba(234,179,8,0.2)',color:'#eab308',marginRight:'calc(var(--subrow) * 0.5)',fontWeight: 'var(--fw-bold)'}}>Restart</span>}
                            {ev.event_name || '(unnamed)'}
                            {ev._warnings && ev._warnings.length > 0 && <span style={{color:'#eab308',marginLeft:'calc(var(--subrow) * 0.5)'}} title={ev._warnings.join(', ')}>!</span>}
                          </td>
                          <td style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1)',textAlign:'right',color:'var(--text)',fontWeight: 'var(--fw-bold)',fontSize:'calc(var(--gu) * 1.075)'}}>{ev.buyin != null ? `$${ev.buyin.toLocaleString()}` : '\u2014'}</td>
                          <td style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 0.5)',textAlign:'center'}}>
                            <button onClick={(e) => { e.stopPropagation(); removeVisionEvent(i); }}
                              style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.031)',padding:'calc(var(--subrow) * 0.25) calc(var(--subrow) * 0.5)',lineHeight:1}}
                              title="Remove event">x</button>
                          </td>
                        </tr>
                        {visionEditIdx === i && (
                          <tr style={{borderBottom:'var(--bw-hair) solid var(--border)',background:'var(--surface)'}}>
                            <td colSpan={5} style={{padding:'calc(var(--subrow) * 1)'}}>
                              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'calc(var(--subrow) * 0.75)',fontSize:'calc(var(--gu) * 1.104)'}}>
                                {[
                                  ['Event Name', 'event_name', 'text'],
                                  ['Variant', 'game_variant', 'text'],
                                  ['Date', 'date', 'text'],
                                  ['Time', 'time', 'text'],
                                  ['Buy-in ($)', 'buyin', 'number'],
                                  ['Venue', 'venue', 'text'],
                                  ['Starting Chips', 'starting_chips', 'number'],
                                  ['Guarantee ($)', 'guarantee', 'number'],
                                  ['Level Duration', 'level_duration', 'text'],
                                  ['Re-entry', 'reentry', 'text'],
                                  ['Event #', 'event_number', 'text'],
                                ].map(([label, field, type]) => (
                                  <label key={field} style={{display:'flex',flexDirection:'column',gap:'calc(var(--subrow) * 0.25)'}}>
                                    <span style={{color:'var(--text-muted)',fontSize:'calc(var(--gu) * 0.957)',textTransform:'uppercase'}}>{label}</span>
                                    <input type={type} value={ev[field] || (type === 'number' ? 0 : '')}
                                      onChange={e => updateVisionEvent(i, field, type === 'number' ? (parseInt(e.target.value) || (field === 'buyin' ? 0 : null)) : e.target.value)}
                                      style={{padding:'calc(var(--subrow) * 0.5) calc(var(--subrow) * 0.75)',borderRadius:'calc(var(--subrow) * 0.5)',border:'var(--bw-hair) solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.104)'}} />
                                  </label>
                                ))}
                                <label key="category" style={{display:'flex',flexDirection:'column',gap:'calc(var(--subrow) * 0.25)'}}>
                                  <span style={{color:'var(--text-muted)',fontSize:'calc(var(--gu) * 0.957)',textTransform:'uppercase'}}>Category</span>
                                  <select value={ev.category || ''} onChange={e => updateVisionEvent(i, 'category', e.target.value || null)}
                                    style={{padding:'calc(var(--subrow) * 0.5) calc(var(--subrow) * 0.75)',borderRadius:'calc(var(--subrow) * 0.5)',border:'var(--bw-hair) solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.104)'}}>
                                    <option value="">{'\u2014'}</option>
                                    <option value="main">Main Event</option>
                                    <option value="side">Side Event</option>
                                  </select>
                                </label>
                              </div>
                              <div style={{display:'flex',flexWrap:'wrap',gap:'calc(var(--subrow) * 1.5)',marginTop:'calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.104)'}}>
                                <label style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.5)',cursor:'pointer',color:'var(--text-muted)'}}>
                                  <input type="checkbox" checked={!!ev.is_satellite} onChange={e => { updateVisionEvent(i, 'is_satellite', e.target.checked); if (e.target.checked) updateVisionEvent(i, 'is_restart', false); }} />
                                  Satellite
                                </label>
                                <label style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.5)',cursor:'pointer',color:'var(--text-muted)'}}>
                                  <input type="checkbox" checked={!!ev.is_restart} onChange={e => { updateVisionEvent(i, 'is_restart', e.target.checked); if (e.target.checked) { updateVisionEvent(i, 'is_satellite', false); updateVisionEvent(i, 'buyin', 0); } }} />
                                  Restart (Day 2+)
                                </label>
                                <label style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.5)',cursor:'pointer',color:'var(--text-muted)'}}>
                                  <input type="checkbox" checked={!!ev.is_multi_flight} onChange={e => updateVisionEvent(i, 'is_multi_flight', e.target.checked)} />
                                  Multi-flight
                                </label>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{display:'flex',gap:'calc(var(--subrow) * 1)',marginTop:'calc(var(--subrow) * 1.5)',justifyContent:'flex-end'}}>
                <button className="btn btn-ghost btn-sm" onClick={() => { setVisionResults(null); setVisionFile(null); }}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleVisionImport}
                  disabled={visionImporting || !visionResults.events.length}
                  style={{display:'inline-flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)'}}>
                  {visionImporting ? 'Importing...' : `Add ${visionResults.events.length} Events`}
                </button>
              </div>
            </div>
          )}

          {visionResults && visionResults.events.length === 0 && (
            <div style={{padding:'calc(var(--subrow) * 1.5)',background:'var(--bg)',borderRadius:'calc(var(--subrow) * 1)',border:'var(--bw-hair) solid var(--border)',color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.178)',textAlign:'center'}}>
              No tournament events found. Try a different file or check that it contains a tournament schedule.
              {visionResults.pageErrors && visionResults.pageErrors.length > 0 && (
                <div style={{marginTop:'calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.104)',color:'var(--accent)',textAlign:'left'}}>
                  {visionResults.pageErrors.map((pe, i) => <div key={i}>{'\u26A0'} {pe.error}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

// Baseline filter state. Shared by the initial useState and clearAllFilters so
// the two cannot drift — hideSatellites/hideRestarts are on by default, and
// "clear filters" means back to these, not maximally permissive.
const DEFAULT_FILTERS = {
  minBuyin: '', maxBuyin: '', buyinRanges: [], rakeRanges: [], selectedGames: [],
  hiddenVenues: [], bountyOnly: false, mysteryBountyOnly: false, headsUpOnly: false,
  tagTeamOnly: false, employeesOnly: false, hideSatellites: true, hideRestarts: true,
  hideSideEvents: false, hiddenMonths: [], ladiesOnly: false, seniorsOnly: false,
  mixedOnly: false, dateFrom: '', dateTo: '',
  maxDistance: '', userLocation: null, locationRegion: null, locationLabel: null,
  // Online play is shown by default. It is deliberately NOT a location field: an online
  // event has no place, so every location filter would otherwise hide all of it.
  showOnline: true,
  /* "Available in <state>": only online rooms that can serve the user's
     jurisdiction. Set from the Online menu (2026-09-30; it was dark from 09-25
     when its filter-row checkbox was removed) and persisted with the other
     online choices. matchesOnline ignores it while no jurisdiction is known. */
  onlyAvailableOnline: false,
  /* Two-letter state code, or null. A standing fact about the user rather than
     a filter, which is why it survives "Clear all" alongside the location. */
  jurisdiction: null,
  /* True when the user chose the state by hand. A derived lookup must not
     overwrite a deliberate choice. */
  jurisdictionManual: false,
  /* Per-room overrides: { [siteKey]: { minBuyin, seriesOnly } }. Empty means no
     restriction anywhere, which is what a filter set saved before this existed
     also means. */
  siteRules: {},
};

// LocationDropdown lives in its own file now (shared with CalendarView).
export default function TournamentsView({
  tournaments, mySchedule, onToggle, gameVariants, venues,
  onSetCondition, onRemoveCondition, onToggleAnchor, onSetPlannedEntries,
  buddyEvents, buddyLiveUpdates, onBuddySwap, isAdmin, onAdminEdit, onClearOverrides,
  token, onRefreshTournaments, onOpenCalendarView,
  // Desktop only (docs/desktop-layout.md): a row click selects the event into
  // the detail pane instead of expanding inline. Absent on the phone.
  onSelectEvent, selectedEventId
}) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const deferredSearch = React.useDeferredValue ? React.useDeferredValue(search) : search;
  const [filters, setFilters] = useState(() => {
    // Restore previously-chosen location from localStorage so users don't have
    // to re-enter distance/region on every launch.
    const savedLoc = readLocalLocation() || {};
    // Non-location answers from the first-run wizard (games, buy-in band, online).
    const savedFilters = readLocalFilters() || {};
    return {
      ...DEFAULT_FILTERS,
      ...savedFilters,
      maxDistance: savedLoc.maxDistance || '',
      userLocation: savedLoc.userLocation || null,
      locationRegion: savedLoc.locationRegion || null,
      locationLabel: savedLoc.locationLabel || null,
      jurisdiction: savedLoc.jurisdiction || null,
      jurisdictionManual: !!savedLoc.jurisdictionManual,
    };
  });
  // Offered as the way out of the filtered-empty state. Clears the search box
  // and every filter back to defaults, including the saved location — a
  // distance radius is usually the thing hiding everything, and leaving it set
  // would make "clear filters" appear to do nothing.
  const clearAllFilters = () => {
    setSearch('');
    /* Everything except the location, which is a standing choice about where
       the user is rather than a filter on one look at the list. The old
       comment here argued the opposite — that a distance radius is usually
       what hides everything, so clearing had to include it — but that made the
       choice disposable, and it is the one filter a user expects to outlive
       the session. */
    setFilters(f => ({
      ...DEFAULT_FILTERS,
      maxDistance: f.maxDistance,
      userLocation: f.userLocation,
      locationRegion: f.locationRegion,
      locationLabel: f.locationLabel,
      jurisdiction: f.jurisdiction,
      jurisdictionManual: f.jurisdictionManual,
    }));
  };
  // Persist location selection across sessions
  useEffect(() => {
    const { userLocation, locationRegion, maxDistance, locationLabel, jurisdiction, jurisdictionManual } = filters;
    const loc = { userLocation, locationRegion, maxDistance, locationLabel, jurisdiction, jurisdictionManual };
    writeLocalLocation(loc);
    // Follows the user: localStorage is per-browser, so without this a region
    // picked on the desktop does not exist on the phone.
    pushServerLocation(token, loc);
  }, [filters.userLocation, filters.locationRegion, filters.maxDistance, filters.locationLabel, filters.jurisdiction, filters.jurisdictionManual]);
  // Persist the standing-preference filters — the online toggle and per-site room
  // rules especially, plus the filter-bar checkboxes and the wizard's game/buy-in
  // answers — so a selection made in the bar survives a reload, not just one made
  // in the onboarding wizard. Only non-default fields are stored (matching the
  // wizard), so the saved blob stays small and a field reset to default really
  // clears. Location has its own persistence above;   // and never stored; a one-look date range stays session-only.
  useEffect(() => {
    const KEYS = ['showOnline', 'siteRules', 'onlyAvailableOnline', 'hideSatellites', 'hideRestarts',
      'hideSideEvents', 'selectedGames', 'mixedOnly', 'buyinRanges'];
    const out = {};
    for (const k of KEYS) {
      const v = filters[k];
      if (v !== undefined && JSON.stringify(v) !== JSON.stringify(DEFAULT_FILTERS[k])) out[k] = v;
    }
    writeLocalFilters(out);
  }, [filters.showOnline, filters.siteRules, filters.onlyAvailableOnline, filters.hideSatellites, filters.hideRestarts,
    filters.hideSideEvents, filters.selectedGames, filters.mixedOnly, filters.buyinRanges]);
  /* The account's copy, once we have a token. localStorage has already painted
     so there is no flash; this only corrects it when the choice was made on
     another device.

     Three cases, and the third is the one that matters. undefined means the
     server has no opinion (guest, offline, failed) — leave the local value
     alone. null means the account explicitly has none — adopt that, because
     the user cleared it somewhere else. And a local value against an empty
     account is the migration case: every existing user has a localStorage
     choice and an empty column, so pushing local UP is right, where clearing
     would throw away a setting they made. */
  const locationSynced = useRef(false);
  useEffect(() => {
    if (locationSynced.current || !token) return;
    locationSynced.current = true;
    let cancelled = false;
    fetchServerLocation(token).then(remote => {
      if (cancelled || remote === undefined) return;
      const local = readLocalLocation();
      if (!remote && local && (local.userLocation || local.locationRegion || local.jurisdiction)) {
        pushServerLocation(token, local);
        return;
      }
      setFilters(f => sameLocation(f, remote) ? f : ({
        ...f,
        userLocation: (remote && remote.userLocation) || null,
        locationRegion: (remote && remote.locationRegion) || null,
        maxDistance: (remote && remote.maxDistance) || '',
        locationLabel: (remote && remote.locationLabel) || null,
        jurisdiction: (remote && remote.jurisdiction) || null,
        jurisdictionManual: !!(remote && remote.jurisdictionManual),
      }));
    });
    return () => { cancelled = true; };
  }, [token]);

  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const filterToggleRef = useRef(null);
  const [focusEventId, setFocusEventId] = useState(null);
  const [renderedGroupCount, setRenderedGroupCount] = useState(8);
  // Track which rows have been tapped open — only those get the full
  // CalendarEventRow with hooks/context. All others render the zero-hook
  // CalendarEventRowLite shell.
  const [activatedIds, setActivatedIds] = useState(() => new Set());
  const activateRow = useCallback((id) => {
    setActivatedIds(prev => { const s = new Set(prev); s.add(id); return s; });
  }, []);
  const loadMoreRef = useRef(null);
  const todayScrollRef = useRef(null);
  const hasScrolled = useRef(false);
  const stickyFiltersRef = useRef(null);
  // Past dates aren't visible after the initial scroll-to-today and
  // rendering ~50 days of pre-today rows is the bulk of first-paint cost
  // (~250 rows of DOM + reconciliation). Render today onwards first, then
  // backfill past on the next idle tick — useLayoutEffect re-pins today
  // so the user doesn't see the layout shift.
  const [includePast, setIncludePast] = useState(false);

  // Single source of truth for "scroll a date group to the top of the
  // events area" — same landing y as scrollBelowSticky uses for an
  // expanded card, so an intentional day change drops the first event
  // exactly where it would be if the user had just expanded it.
  // Formula: scrollTo(groupAbsTop - filtersH + 4). The date-break (first child
  // of the group) lands 4px ABOVE filtersH below the scrollport top: with the
  // content-area top at viewport 64 and the sticky filters 100px tall, that is
  // 64 + 100 - 4 = 160 — exactly the block's sticky pin line, the 5th primary
  // row (the overlay grid runs from viewport 0 at 8px). Landing == pin, so the block
  // sits flush under the filters from the first paint and does not jump when
  // the user starts scrolling. filtersH is MEASURED, so a change to the
  // filters' padding moves the landing and the pin together. The old "- 2"
  // landed it 6px shy of the pin, off every grid line.
  const scrollDateGroupToTop = useCallback((dateGroupEl, behavior = 'smooth') => {
    const container = document.querySelector('.content-area');
    if (!container || !dateGroupEl) return;
    // Self-measuring landing that worked on device for months: read the actual
    // sticky height from the DOM and land the group's top 2px below it. Robust to
    // whatever the real device layout/safe-area produces (a computed r-target was
    // not, and floated the whole day off the grid on device).
    const stickyEl = container.querySelector('.sticky-filters');
    const filtersH = stickyEl ? stickyEl.getBoundingClientRect().height : 0;
    const cTop = container.getBoundingClientRect().top;
    const groupAbsTop = dateGroupEl.getBoundingClientRect().top - cTop + container.scrollTop;
    // Stop the group's top EXACTLY on the bottom edge of the sticky filter rows —
    // filtersH is that block's real rendered height, so the stop is the exact
    // grid line the CSS drew, on any device. No fudge pixels.
    container.scrollTo({ top: Math.max(0, groupAbsTop - filtersH), behavior });
  }, []);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const locationBtnRef = useRef(null);
  const [importDropdownOpen, setImportDropdownOpen] = useState(false);
  const importBtnRef = useRef(null);
  const [dateBreakTop, setDateBreakTop] = useState(0);
  const scrollAnchorRef = useRef(null);
  const fabContainerRef = useRef(null);
  const [collapsedDates, setCollapsedDates] = useState(() => {
    try {
      const raw = localStorage.getItem('tournamentsCollapsedDates');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  const toggleDateCollapsed = (date) => {
    const wasCollapsed = collapsedDates.has(date);
    setCollapsedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      try { localStorage.setItem('tournamentsCollapsedDates', JSON.stringify([...next])); } catch {}
      return next;
    });
    // When collapsing, follow up by scrolling the NEXT date group to the
    // sticky-filter line so the user lands on the next day's events
    // instead of staring at a stack of collapsed headers.
    if (!wasCollapsed) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const container = document.querySelector('.content-area');
        if (!container) return;
        const groups = [...container.querySelectorAll('[data-date-group]')];
        const idx = groups.findIndex(g => g.getAttribute('data-date-group') === date);
        const nextGroup = groups[idx + 1];
        if (nextGroup) scrollDateGroupToTop(nextGroup);
      }));
    }
  };

  // Scroll to today's date group or the next upcoming one — uses the
  // shared helper so the landing y matches scrollBelowSticky.
  const scrollToTodayOrNext = useCallback(() => {
    const container = document.querySelector('.content-area');
    if (!container) return;
    requestAnimationFrame(() => {
      const todayISO = getToday();
      const groups = container.querySelectorAll('[data-date-group]');
      let target = null;
      for (const g of groups) {
        if (g.getAttribute('data-date-group') >= todayISO) { target = g; break; }
      }
      if (!target && groups.length) target = groups[0];
      if (target) {
        scrollDateGroupToTop(target, 'auto');
      } else {
        container.scrollTop = 0;
      }
    });
  }, [scrollDateGroupToTop]);

  // Progressive rendering — load more date groups as user scrolls near
  // bottom. Bump aggressively (+30) so a single IO fire actually grows the
  // visible slice past initialCount (previously +10 was a no-op for the
  // first few fires when initialCount was already 30+).
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    // rootMargin is an IntersectionObserver API value — the spec requires an
    // absolute px/% length and rejects calc()/var(), so derive the 150-subrow
    // pre-load buffer from r in JS and emit it as the px the API demands.
    const r = (window.innerWidth / 37) * 0.71;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setRenderedGroupCount(prev => prev + 30);
      }
    }, { rootMargin: `${Math.round(r * 150)}px` });
    observer.observe(el);
    return () => observer.disconnect();
  }, [renderedGroupCount]);

  // When search changes, scroll to today/next
  const prevSearchRef = useRef(deferredSearch);
  useEffect(() => {
    if (deferredSearch === prevSearchRef.current) return;
    prevSearchRef.current = deferredSearch;
    scrollToTodayOrNext();
  }, [deferredSearch]);

  // Wrap setFilters - after filter change, scroll to today/next
  const filterChangeRef = useRef(false);
  const setFiltersWithScroll = useCallback((updater) => {
    filterChangeRef.current = true;
    setFilters(updater);
  }, []);

  useEffect(() => {
    if (!filterChangeRef.current) return;
    filterChangeRef.current = false;
    scrollToTodayOrNext();
  }, [filters]);

  useEffect(() => {
    // The date-break pins under the filter block, so its sticky `top` is the
    // filter block's height. Use the FRACTIONAL height (getBoundingClientRect),
    // not offsetHeight: the bar's real height is sub-pixel (~91.5px from r-based
    // padding), and offsetHeight rounds it to an integer, so the pill pinned ~0.5px
    // off the bar's true bottom — leaving a hairline seam that any cover painted
    // over the pill's top (the clip). Pinning to the exact fractional bottom seats
    // the pill flush against the bar: no gap to cover, nothing clipping the pill.
    const measure = () => {
      if (stickyFiltersRef.current) {
        const h = stickyFiltersRef.current.getBoundingClientRect().height;
        const style = getComputedStyle(stickyFiltersRef.current);
        const mt = parseFloat(style.marginTop) || 0;
        setDateBreakTop(h + mt);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [filters, search]);

  const buyinOptions = useMemo(() =>
    [...new Set(tournaments.map(t => parseInt(t.buyin, 10)).filter(n => n > 0 && !isNaN(n)))].sort((a, b) => a - b),
    [tournaments]
  );

  const scheduleIds = useMemo(() => new Set(mySchedule.map(t => t.id)), [mySchedule]);
  const anchorSet = useMemo(() => new Set(mySchedule.filter(t => t.is_anchor).map(t => t.id)), [mySchedule]);
  const plannedEntriesMap = useMemo(() => {
    const m = {};
    for (const t of mySchedule) m[t.id] = t.planned_entries || 1;
    return m;
  }, [mySchedule]);
  const conditionMap = useMemo(() => {
    const m = {};
    for (const t of mySchedule) {
      const c = extractConditions(t);
      if (c.length > 0) m[t.id] = c;
    }
    return m;
  }, [mySchedule]);

  // Hide series that have ended
  const endedVenues = useMemo(() => {
    const todayISO = getToday();
    const lastDay1ByVenue = {};
    for (const t of tournaments) {
      if (t.is_restart || t.is_satellite) continue;
      const d = normaliseDate(t.date);
      if (!d) continue;
      if (!lastDay1ByVenue[t.venue] || d > lastDay1ByVenue[t.venue]) lastDay1ByVenue[t.venue] = d;
    }
    const ended = new Set();
    for (const [venue, lastDate] of Object.entries(lastDay1ByVenue)) {
      const cutoff = new Date(lastDate + 'T12:00:00');
      cutoff.setDate(cutoff.getDate() + 2);
      // Local date format — toISOString uses UTC and would roll over.
      const cy = cutoff.getFullYear();
      const cm = String(cutoff.getMonth() + 1).padStart(2, '0');
      const cd = String(cutoff.getDate()).padStart(2, '0');
      const cutoffISO = `${cy}-${cm}-${cd}`;
      if (todayISO > cutoffISO) ended.add(venue);
    }
    return ended;
  }, [tournaments]);

  const filtered = useMemo(() => {
    const passed = tournaments
      .filter(t => {
        if (endedVenues.has(t.venue)) return false;
        if (deferredSearch) {
          const q = deferredSearch.toLowerCase();
          if (!t.event_name?.toLowerCase().includes(q) &&
              !String(t.event_number).includes(q) &&
              !t.game_variant?.toLowerCase().includes(q)) return false;
        }
        if (filters.buyinRanges && filters.buyinRanges.length > 0) {
          const b = Number(t.buyin) || 0;
          const matchesBuyin = filters.buyinRanges.some(r => {
            if (r === '0-500') return b < 500;
            if (r === '500-1500') return b >= 500 && b < 1500;
            if (r === '1500-5000') return b >= 1500 && b < 5000;
            if (r === '5000-10000') return b >= 5000 && b <= 10000;
            if (r === '10000+') return b > 10000;
            return true;
          });
          if (!matchesBuyin) return false;
        }
        if (filters.rakeRanges && filters.rakeRanges.length > 0) {
          if (t.rake_pct == null) return false;
          const r = Number(t.rake_pct);
          const matchesRake = filters.rakeRanges.some(rng => {
            if (rng === '0-5') return r < 5;
            if (rng === '5-8') return r >= 5 && r < 8;
            if (rng === '8-10') return r >= 8 && r < 10;
            if (rng === '10-13') return r >= 10 && r < 13;
            if (rng === '13+') return r >= 13;
            return true;
          });
          if (!matchesRake) return false;
        }
        if (filters.selectedGames.length > 0 || filters.mixedOnly) {
          const isMixed = t.game_variant !== 'NLH' && t.game_variant !== 'PLO';
          const matchesGame = filters.selectedGames.length > 0 && filters.selectedGames.includes(t.game_variant);
          const matchesMixed = filters.mixedOnly && isMixed;
          if (!matchesGame && !matchesMixed) return false;
        }
        if (filters.hiddenVenues && filters.hiddenVenues.length > 0 && filters.hiddenVenues.includes(t.venue)) return false;
        // One predicate, shared with the panel that builds the option lists, so
        // the two cannot drift and offer an option the list would refuse.
        if (!matchesLocation(t, filters)) return false;
        if (!matchesOnline(t, filters)) return false;
        {
          const specialActive = filters.bountyOnly || filters.mysteryBountyOnly || filters.headsUpOnly || filters.tagTeamOnly || filters.employeesOnly || filters.ladiesOnly || filters.seniorsOnly;
          if (specialActive) {
            let matchesSpecial = false;
            if (filters.bountyOnly && /bounty|mystery millions/i.test(t.event_name)) matchesSpecial = true;
            if (filters.mysteryBountyOnly && /mystery bounty|mystery millions/i.test(t.event_name)) matchesSpecial = true;
            if (filters.headsUpOnly && /heads.up/i.test(t.event_name)) matchesSpecial = true;
            if (filters.tagTeamOnly && /tag.team/i.test(t.event_name)) matchesSpecial = true;
            if (filters.employeesOnly && /employee/i.test(t.event_name)) matchesSpecial = true;
            if (filters.ladiesOnly && /women|ladies/i.test(t.event_name)) matchesSpecial = true;
            if (filters.seniorsOnly && /senior/i.test(t.event_name)) matchesSpecial = true;
            if (!matchesSpecial) return false;
          }
        }
        if (filters.hideSatellites && t.is_satellite) return false;
        if (filters.hideRestarts && t.is_restart) return false;
        if (filters.hideSideEvents && isSideEvent(t)) return false;
        if (filters.hiddenMonths && filters.hiddenMonths.length > 0) {
          const m = new Date(t.date).getMonth();
          if (filters.hiddenMonths.includes(m)) return false;
        }
        if (filters.dateFrom && normaliseDate(t.date) < filters.dateFrom) return false;
        if (filters.dateTo && normaliseDate(t.date) > filters.dateTo) return false;
        return true;
      });
    // parseTournamentTime() → parseDateTimeInTz() calls toLocaleString twice
    // per invocation (~1ms each). Array.sort calls the comparator O(n log n)
    // times — for ~500 events that's ~9000 calls × 2 toLocaleStrings = 4s of
    // main-thread blocking. Decorate-sort-undecorate: compute each event's
    // timestamp ONCE up front, sort by the cached values, drop the wrapper.
    const decorated = passed.map(t => {
      const en = t.event_number || '';
      const num = en.startsWith('SAT')
        ? 10000 + parseInt(en.slice(4))
        : (parseInt(en) || 9999);
      return { t, ts: parseTournamentTime(t), num };
    });
    decorated.sort((a, b) => (a.ts - b.ts) || (a.num - b.num));
    return decorated.map(x => x.t);
  }, [tournaments, deferredSearch, filters, endedVenues]);

  // Back-to-today FAB
  useEffect(() => {
    const container = document.querySelector('.content-area');
    if (!container) return;

    const todayISO = getToday();
    const hasTodayEvents = filtered.some(t => normaliseDate(t.date) === todayISO);

    const findTarget = () => {
      if (hasTodayEvents) return container.querySelector('[data-today-scroll]');
      const groups = container.querySelectorAll('[data-date-group]');
      for (const g of groups) {
        if (g.getAttribute('data-date-group') >= todayISO) return g;
      }
      return groups.length ? groups[groups.length - 1] : null;
    };

    const fabLabel = hasTodayEvents ? 'Today' : 'Next';

    const fab = document.createElement('button');
    fab.className = 'back-to-today-fab';
    fab.dataset.dir = 'up';
    fab.innerHTML = '<svg class="fab-arrow-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:calc(var(--subrow) * 1.75);height:calc(var(--subrow) * 1.75)"><polyline points="18 15 12 9 6 15"/></svg><svg class="fab-arrow-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:calc(var(--subrow) * 1.75);height:calc(var(--subrow) * 1.75)"><polyline points="6 9 12 15 18 9"/></svg>' + fabLabel;
    fab.addEventListener('click', () => {
      const target = findTarget();
      if (target) scrollDateGroupToTop(target);
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
        if (pastTarget || beforeTarget) {
          fab.classList.add('visible');
        } else {
          fab.classList.remove('visible');
        }
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    requestAnimationFrame(() => onScroll());
    return () => {
      container.removeEventListener('scroll', onScroll);
      fab.remove();
    };
  }, [filtered]);

  function findBestFlight(eventNum, satTournament) {
    const flights = filtered.filter(t => t.event_number === eventNum);
    const best = findClosestFlight(flights, parseTournamentTime(satTournament));
    return best ? best.id : null;
  }

  // Auto-scroll to today's date group on first mount. Repeat over a few
  // frames: when past dates backfill (and any contentVisibility:auto rows
  // materialise from their intrinsic placeholder), the absolute position
  // of today shifts down; re-firing the scroll converges on the correct
  // spot before the browser paints.
  useLayoutEffect(() => {
    if (hasScrolled.current || !todayScrollRef.current) return;
    hasScrolled.current = true;
    const settle = (remaining) => {
      const el = todayScrollRef.current;
      if (!el) return;
      scrollDateGroupToTop(el, 'auto');
      if (remaining > 0) requestAnimationFrame(() => settle(remaining - 1));
    };
    settle(4);
  }, [filtered, scrollDateGroupToTop]);

  // Re-pin today after past dates backfill so the just-inserted history
  // above doesn't push the visible content down. Multi-frame settle for
  // the same reason as the initial scroll (contentVisibility rows
  // materialise to real sizes over a few frames).
  useLayoutEffect(() => {
    if (!includePast || !todayScrollRef.current) return;
    const settle = (remaining) => {
      const el = todayScrollRef.current;
      if (!el) return;
      scrollDateGroupToTop(el, 'auto');
      if (remaining > 0) requestAnimationFrame(() => settle(remaining - 1));
    };
    settle(4);
  }, [includePast, scrollDateGroupToTop]);

  // Backfill past dates on next idle tick so they don't block first paint.
  useEffect(() => {
    if (includePast) return;
    const ric = window.requestIdleCallback;
    if (ric) {
      const id = ric(() => setIncludePast(true), { timeout: 400 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(() => setIncludePast(true), 50);
    return () => clearTimeout(id);
  }, [includePast]);

  return (
    <div>
      <div className="sticky-filters" ref={stickyFiltersRef}>
        {/* wrap + rowGap: on a narrow phone the event-kind switches drop to their
            own line below the icon buttons instead of overflowing and clipping
            "Side Events" off the right edge. */}
        <div style={{display:'flex',gap:'var(--gu)',alignItems:'center',flexWrap:'wrap',rowGap:'calc(var(--subrow) * 1)'}}>
          {/* Location | filter | calendar, on the column grid: location spans three
              primary columns (26g, 1-27g), then the 1g gutter, a 4g filter button
              (28-32g), 1g, and the 3g calendar button (33-36g) — 35g, rail to rail. */}
          <button
            ref={locationBtnRef}
            className={`filter-chip ${filters.locationRegion || filters.userLocation ? 'active' : ''}`}
            onClick={() => setLocationDropdownOpen(o => !o)}
            style={{flex:'0 0 auto',width:'calc(var(--col) * 3 + var(--gu) * 2)',minWidth:0,height:'calc(var(--subrow) * 4)',boxSizing:'border-box',display:'flex',alignItems:'center',justifyContent:'flex-start',gap:'calc(var(--subrow) * 1)',padding:'0 calc(var(--subrow) * 1.25)'}}
            title={filters.locationRegion && LOCATION_REGIONS[filters.locationRegion]
              ? LOCATION_REGIONS[filters.locationRegion].label
              : filters.userLocation && filters.maxDistance
                ? `${filters.locationLabel || 'Location'} \u00B7 ${filters.maxDistance}mi`
                : 'All Locations'}
          >
            <Icon.mapPin />
            <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:'calc(var(--gu) * 1.149)',fontFamily:'var(--font-condensed)',lineHeight:'calc(var(--subrow) * 2)'}}>
              {filters.locationRegion && LOCATION_REGIONS[filters.locationRegion]
                ? LOCATION_REGIONS[filters.locationRegion].label
                : filters.userLocation && filters.maxDistance
                  ? `${filters.locationLabel || 'Location'} \u00B7 ${filters.maxDistance} mi`
                  : 'All locations'}
            </span>
          </button>
          <button
            ref={filterToggleRef}
            className={`filter-chip filter-chip-square ${filterPanelOpen ? 'active' : ''}`}
            onClick={() => setFilterPanelOpen(o => !o)}
            style={{flexShrink:0,width:'calc(var(--gu) * 4)'}}
          >
            <Icon.filter />
          </button>
          {/* Calendar chip: tap → switch to Calendar view. Long-press
              (≥500ms) → open a native date picker scoped to today and
              future dates only. Picking a date scrolls the schedule
              list to that date's group. */}
          {/* Calendar chip: tap → switch to Calendar view. Long-press
              date-picker shortcut was removed — the native <input
              type="date"> picker repeatedly broke scrolling on Firefox
              after dismissal (and earlier on iOS Safari). Users pick
              specific dates from Calendar view's calendar icon, which
              opens the same native picker but from a deliberate single
              tap that doesn't run into the same gesture-capture state. */}
          <button
            type="button"
            className="filter-chip filter-chip-square"
            style={{flexShrink:0}}
            title="Calendar view"
            onClick={() => onOpenCalendarView && onOpenCalendarView()}
          >
            <Icon.calendar />
          </button>
        </div>

        <Filters filters={filters} setFilters={setFiltersWithScroll} setFiltersRaw={setFilters} gameVariants={gameVariants} venues={venues} buyinOptions={buyinOptions} tournaments={tournaments} open={filterPanelOpen} setOpen={setFilterPanelOpen} toggleRef={filterToggleRef} search={search} setSearch={setSearch} />

        {locationDropdownOpen && createPortal(
          /* var(--z-scrim), not 998. The PANEL was moved off a 999 literal onto
             var(--z-panel) — which is 400 — and this backdrop was left behind at
             998, so the thing whose only job is to catch taps OUTSIDE the panel
             was sitting on top of it. Every tap inside the dropdown hit this
             div and closed it, which is not an outside-click bug at all: the
             handler never ran, because the tap never reached the panel.
             The two now sit on the token scale in the order they are meant to:
             scrim 300 under panel 400. The target check is belt and braces — it
             closes only for a tap on the backdrop itself, never one that
             reached it from something drawn above. */
          <div data-filter-portal="" style={{position:'fixed',inset:0,zIndex:'var(--z-scrim)'}}
            onClick={(e) => { if (e.target === e.currentTarget) setLocationDropdownOpen(false); }} />,
          document.body
        )}
        {locationDropdownOpen && (() => {
          const btn = locationBtnRef.current;
          const rect = btn ? btn.getBoundingClientRect() : { left: 60, bottom: 100 };
          return createPortal(
            <LocationDropdown
              rect={rect}
              filters={filters}
              setFilters={setFiltersWithScroll}
              onClose={() => setLocationDropdownOpen(false)}
              toast={toast}
              token={token}
            />,
            document.body
          );
        })()}
      </div>

      {filtered.length === 0 ? (
        <Filtered
          title="No events match your filters"
          hint="Every event is still here — the current search, venue, date or location filter is hiding them."
          actions={[{ label: 'Clear filters', onClick: clearAllFilters }]}
        />
      ) : (
        <div style={{minHeight:'100vh', paddingBottom:'60vh'}}>
          {(() => {
            const todayISO = getToday();
            // Some tournament rows have legacy non-ISO date strings
            // ("May 4, 2026"). Sort by the NORMALISED ISO form so date
            // groups land in true chronological order — otherwise events
            // past the last ISO-formatted date appear out of sequence and
            // look like the schedule was cut off.
            const sorted = [...filtered].sort((a, b) => {
              const an = normaliseDate(a.date);
              const bn = normaliseDate(b.date);
              if (an !== bn) return an < bn ? -1 : 1;
              return 0;
            });
            const groups = [];
            let cur = null;
            for (const t of sorted) {
              const d = normaliseDate(t.date);
              if (!cur || cur.date !== d) {
                cur = { date: d, events: [] };
                groups.push(cur);
              }
              cur.events.push(t);
            }
            // Find today's group index so we render enough to include it
            const todayGroupIdx = groups.findIndex(g => g.date >= todayISO);
            const initialCount = Math.max(8, todayGroupIdx + 4);
            // First paint: skip past dates so initial reconciliation only
            // covers the rows the user can actually see after scroll-to-today.
            // Past gets backfilled on the next idle tick (see includePast).
            const startIdx = includePast || todayGroupIdx < 0 ? 0 : todayGroupIdx;
            const endIdx = Math.min(groups.length, Math.max(renderedGroupCount, initialCount));
            let scrollRefAssigned = false;
            return groups.slice(startIdx, endIdx).map((group, gi) => {
              const isToday = group.date === todayISO;
              const past = group.date < todayISO;
              const dateObj = new Date(group.date + 'T12:00:00');
              const monthAbbr = MONTHS[dateObj.getMonth()];
              const dayOfWeek = ['Su','M','Tu','W','Th','F','Sa'][dateObj.getDay()];
              const dayNum = String(dateObj.getDate()).padStart(2, '0');
              const needsRef = !scrollRefAssigned && group.date >= todayISO;
              if (needsRef) scrollRefAssigned = true;
              const dayEventCount = group.events.filter(t => !t.is_restart).length;
              const isCollapsed = collapsedDates.has(group.date);
              return (
                <div key={group.date} ref={needsRef ? todayScrollRef : undefined} data-today-scroll={needsRef ? 'true' : undefined} data-date-group={group.date} style={{marginTop: gi === 0 ? 0 : 'var(--subrow)'}}>
                  <DateBreak date={group.date} top={dateBreakTop} isToday={isToday} eventCount={dayEventCount} collapsed={isCollapsed} onToggle={() => toggleDateCollapsed(group.date)} onPillClick={(e) => { e.stopPropagation(); const grp = e.currentTarget.closest('[data-date-group]'); if (grp) scrollDateGroupToTop(grp); }} />
                  {!isCollapsed && group.events.map(t => {
                    const needsFull = isToday || activatedIds.has(t.id) || focusEventId === t.id;
                    return (
                    <div key={t.id} style={{contentVisibility:'auto', containIntrinsicSize:'auto calc(var(--subrow) * 13)'}}>
                      {needsFull ? (
                        <CalendarEventRow
                          tournament={t}
                          isInSchedule={scheduleIds.has(t.id)}
                          onToggle={onToggle}
                          isPast={past}
                          showMiniLateReg={isToday}
                          focusEventId={focusEventId}
                          onNavigateToEvent={(num, sat) => {
                            const targetId = findBestFlight(num, sat);
                            if (targetId && onSelectEvent) { onSelectEvent(targetId); return; }
                            if (targetId) { setFocusEventId(null); setTimeout(() => setFocusEventId(targetId), 0); }
                          }}
                          conditions={conditionMap[t.id] || []}
                          onSetCondition={onSetCondition}
                          onRemoveCondition={onRemoveCondition}
                          allTournaments={tournaments}
                          isAnchor={anchorSet.has(t.id)}
                          onToggleAnchor={onToggleAnchor}
                          plannedEntries={plannedEntriesMap[t.id] || 1}
                          onSetPlannedEntries={onSetPlannedEntries}
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
                          isInSchedule={scheduleIds.has(t.id)}
                          isPast={past}
                          isAnchor={anchorSet.has(t.id)}
                          conditions={conditionMap[t.id]}
                          onExpand={() => (onSelectEvent ? onSelectEvent(t.id) : activateRow(t.id))}
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
          <div ref={loadMoreRef} style={{height: 1}} />
        </div>
      )}

      <div ref={fabContainerRef} />
    </div>
  );
}
