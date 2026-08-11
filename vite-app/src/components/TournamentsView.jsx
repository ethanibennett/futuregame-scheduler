import React, { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import CalendarEventRow, { CalendarEventRowLite } from './CalendarEventRow.jsx';
import LocationDropdown from './LocationDropdown.jsx';
import {
  getVenueInfo, normaliseDate, getToday, haptic, fmtShortDate, daysBetween, addDays,
  parseTournamentTime, parseDateTimeInTz, parseDateTime, findClosestFlight,
  extractConditions, getVenueCoords, haversineDistance, VENUE_TO_SERIES, LOCATION_REGIONS,
} from '../utils/utils.js';
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

// ── Inline Filters (portal-based, matching original) ──
function Filters({ filters, setFilters, gameVariants, venues, buyinOptions, tournaments, open, setOpen, toggleRef, search, setSearch }) {
  const panelRef = useRef(null);
  const [whereOpen, setWhereOpen] = useState(false);
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

  const availableVenues = useMemo(() => {
    const today = getToday();
    const countMap = {};
    (tournaments || []).forEach(t => {
      const d = normaliseDate(t.date);
      if (d < today) return;
      if (filters.dateFrom && d < filters.dateFrom) return;
      if (filters.dateTo && d > filters.dateTo) return;
      countMap[t.venue] = (countMap[t.venue] || 0) + 1;
    });
    return Object.keys(countMap)
      .sort((a, b) => countMap[b] - countMap[a])
      .map(v => ({ venue: v, series: VENUE_TO_SERIES[v] || v, count: countMap[v] }));
  }, [tournaments, filters.dateFrom, filters.dateTo]);

  const availableGameVariants = useMemo(() => {
    const variantSet = new Set();
    (tournaments || []).forEach(t => {
      const d = normaliseDate(t.date);
      if (filters.dateFrom && d < filters.dateFrom) return;
      if (filters.dateTo && d > filters.dateTo) return;
      if (t.game_variant) variantSet.add(t.game_variant);
    });
    return variantSet;
  }, [tournaments, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (toggleRef.current && toggleRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const hasActive = filters.minBuyin || filters.maxBuyin || (filters.buyinRanges && filters.buyinRanges.length > 0) || (filters.rakeRanges && filters.rakeRanges.length > 0) ||
    filters.selectedGames.length > 0 || (filters.hiddenVenues && filters.hiddenVenues.length > 0) || filters.bountyOnly || filters.mysteryBountyOnly || filters.headsUpOnly || filters.tagTeamOnly || filters.employeesOnly || !filters.hideSatellites || !filters.hideRestarts || !filters.hideSideEvents || filters.ladiesOnly || filters.seniorsOnly || filters.mixedOnly || filters.dateFrom || filters.dateTo;

  return (
    <>
      <div className="filter-row" style={{gap:'8px',marginBottom:'0',width:'100%',alignItems:'center'}}>
        <div style={{flex:1,display:'flex',alignItems:'center',gap:'8px',justifyContent:'flex-end'}}>
          {filters.selectedGames.length > 0 && (
            <span className="filter-chip active">
              {filters.selectedGames.length === 1 ? filters.selectedGames[0] : `${filters.selectedGames.length} games`}
              <span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, selectedGames:[]}))}>&#10005;</span>
            </span>
          )}
          {filters.buyinRanges && filters.buyinRanges.length > 0 && (
            <span className="filter-chip active">
              {filters.buyinRanges.length === 1 ? ({'0-500':'< $500','500-1500':'$500\u2013$1.5K','1500-5000':'$1.5K\u2013$5K','5000-10000':'$5K\u2013$10K','10000+':'$10K+'})[filters.buyinRanges[0]] : `${filters.buyinRanges.length} buy-ins`}
              <span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, buyinRanges:[]}))}>&#10005;</span>
            </span>
          )}
          {filters.rakeRanges && filters.rakeRanges.length > 0 && (
            <span className="filter-chip active">
              {filters.rakeRanges.length === 1 ? ({'0-5':'< 5%','5-8':'5\u20138%','8-10':'8\u201310%','10-13':'10\u201313%','13+':'13%+'})[filters.rakeRanges[0]] : `${filters.rakeRanges.length} rake ranges`}
              <span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, rakeRanges:[]}))}>&#10005;</span>
            </span>
          )}
          {filters.bountyOnly && (
            <span className="filter-chip active">Bounty<span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, bountyOnly:false}))}>&#10005;</span></span>
          )}
          {filters.mysteryBountyOnly && (
            <span className="filter-chip active">Mystery Bounty<span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, mysteryBountyOnly:false}))}>&#10005;</span></span>
          )}
          {filters.headsUpOnly && (
            <span className="filter-chip active">Heads Up<span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, headsUpOnly:false}))}>&#10005;</span></span>
          )}
          {filters.tagTeamOnly && (
            <span className="filter-chip active">Tag Team<span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, tagTeamOnly:false}))}>&#10005;</span></span>
          )}
          {filters.employeesOnly && (
            <span className="filter-chip active">Employees<span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, employeesOnly:false}))}>&#10005;</span></span>
          )}
          {filters.hiddenVenues && filters.hiddenVenues.length > 0 && (
            <span className="filter-chip active">
              {availableVenues.length - filters.hiddenVenues.filter(v => availableVenues.some(av => av.venue === v)).length} of {availableVenues.length} venues
              <span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, hiddenVenues:[]}))}>&#10005;</span>
            </span>
          )}
          {filters.ladiesOnly && (
            <span className="filter-chip active">Ladies Only<span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, ladiesOnly:false}))}>&#10005;</span></span>
          )}
          {filters.seniorsOnly && (
            <span className="filter-chip active">Seniors Only<span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, seniorsOnly:false}))}>&#10005;</span></span>
          )}
          {filters.mixedOnly && (
            <span className="filter-chip active">Mixed<span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, mixedOnly:false}))}>&#10005;</span></span>
          )}
          {(filters.dateFrom || filters.dateTo) && (
            <span className="filter-chip active">
              {filters.dateFrom && filters.dateTo ? `${fmtShortDate(filters.dateFrom)} \u2014 ${fmtShortDate(filters.dateTo)}` : filters.dateFrom ? `From ${fmtShortDate(filters.dateFrom)}` : `Until ${fmtShortDate(filters.dateTo)}`}
              <span style={{marginLeft:'4px',cursor:'pointer'}} onClick={() => setFilters(f => ({...f, dateFrom:'', dateTo:''}))}>&#10005;</span>
            </span>
          )}
        </div>
      </div>

      {open && createPortal(
        <div className="dropdown-backdrop" onClick={() => setOpen(false)} />,
        document.body
      )}
      {open && createPortal(
        <div ref={panelRef} className="filter-panel" style={(() => {
          const r = toggleRef.current?.getBoundingClientRect();
          if (!r) return { top: 60, left: 8, right: 8 };
          const vh = window.innerHeight || document.documentElement.clientHeight || 700;
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
            ];
            return (
              <div style={{display:'flex',gap:'6px',marginBottom:'10px',gridColumn:'1 / -1'}}>
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
          <div className="filter-group filter-row filter-search-cell" style={{marginBottom:'6px'}}>
            <div className="search-bar" style={{marginBottom:0,height:'32px'}}>
              <Icon.search />
              <input type="text" placeholder={"Search events, games\u2026"} value={search} onChange={e => setSearch(e.target.value)} style={{padding:'4px 0'}} />
              {search && (
                <button onClick={() => setSearch('')} style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'1rem',padding:'0 2px'}}>&#10005;</button>
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
              <div className="filter-group filter-row filter-daterange-cell" style={{marginBottom:'6px'}}>
                <label style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'6px',display:'block',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em'}}>Date Range</label>
                <div style={{padding:'0 6px'}}>
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

          {/* Series */}
          <div className="filter-group filter-span2">
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'6px'}} onClick={() => setWhereOpen(w => !w)}>
              Series
              <span style={{fontSize:'0.7rem',transition:'transform 0.15s',transform: whereOpen ? 'rotate(180deg)' : 'rotate(0deg)'}}>{'\u25BC'}</span>
            </label>
            {whereOpen && (<div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
              <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'0.82rem',fontWeight:600,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                <input type="checkbox"
                  checked={!filters.hiddenVenues || filters.hiddenVenues.length === 0}
                  ref={el => { if (el) el.indeterminate = filters.hiddenVenues && filters.hiddenVenues.length > 0 && filters.hiddenVenues.length < availableVenues.length; }}
                  onChange={e => setFilters(f => ({...f, hiddenVenues: e.target.checked ? [] : availableVenues.map(v => v.venue)}))}
                  style={{marginTop:'1px'}}
                /> All
              </label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px 12px'}}>
                {availableVenues.map(({ venue, series }) => {
                  const hidden = (filters.hiddenVenues || []).includes(venue);
                  return (
                    <label key={venue} style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'0.82rem',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                      <input type="checkbox" checked={!hidden}
                        onChange={e => setFilters(f => {
                          const hv = f.hiddenVenues || [];
                          return {...f, hiddenVenues: e.target.checked ? hv.filter(v => v !== venue) : [...hv, venue]};
                        })}
                        style={{marginTop:'1px',flexShrink:0}}
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
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'6px'}} onClick={() => setHowMuchOpen(h => !h)}>
              Buy-in / Rake
              <span style={{fontSize:'0.7rem',transition:'transform 0.15s',transform: howMuchOpen ? 'rotate(180deg)' : 'rotate(0deg)'}}>{'\u25BC'}</span>
            </label>
            {howMuchOpen && (() => {
              const buyinOpts = [
                { key: '0-500', label: 'Under $500' },
                { key: '500-1500', label: '$500 \u2013 $1.5K' },
                { key: '1500-5000', label: '$1.5K \u2013 $5K' },
                { key: '5000-10000', label: '$5K \u2013 $10K' },
                { key: '10000+', label: '$10K+' },
              ];
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
              return (<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 12px'}}>
                <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                  <label style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'2px'}}>Buy-in</label>
                  <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'0.82rem',fontWeight:600,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                    <input type="checkbox" checked={allBuyinChecked}
                      onChange={() => setFilters(f => ({...f, buyinRanges: [], minBuyin: '', maxBuyin: ''}))}
                      style={{marginTop:'1px',flexShrink:0}}
                    /><span>All</span>
                  </label>
                  {buyinOpts.map(opt => (
                    <label key={opt.key} style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'0.82rem',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                      <input type="checkbox" checked={(filters.buyinRanges || []).includes(opt.key)}
                        onChange={() => setFilters(f => ({...f, buyinRanges: toggleArr(f.buyinRanges || [], opt.key), minBuyin: '', maxBuyin: ''}))}
                        style={{marginTop:'1px',flexShrink:0}}
                      /><span>{opt.label}</span>
                    </label>
                  ))}
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                  <label style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'2px'}}>Rake</label>
                  <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'0.82rem',fontWeight:600,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                    <input type="checkbox" checked={allRakeChecked}
                      onChange={() => setFilters(f => ({...f, rakeRanges: []}))}
                      style={{marginTop:'1px',flexShrink:0}}
                    /><span>All</span>
                  </label>
                  {rakeOpts.map(opt => (
                    <label key={opt.key} style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'0.82rem',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                      <input type="checkbox" checked={(filters.rakeRanges || []).includes(opt.key)}
                        onChange={() => setFilters(f => ({...f, rakeRanges: toggleArr(f.rakeRanges || [], opt.key)}))}
                        style={{marginTop:'1px',flexShrink:0}}
                      /><span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>);
            })()}
          </div>

          {/* Variant */}
          <div className="filter-group filter-span2">
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'6px'}} onClick={() => setWhichOpen(w => !w)}>
              Variant
              <span style={{fontSize:'0.7rem',transition:'transform 0.15s',transform: whichOpen ? 'rotate(180deg)' : 'rotate(0deg)'}}>{'\u25BC'}</span>
            </label>
            {whichOpen && (() => {
              const allSelected = filters.selectedGames.length === 0;
              const toggleVariant = (v, checked) => {
                setFilters(f => ({...f, selectedGames: checked ? [...f.selectedGames, v] : f.selectedGames.filter(g => g !== v)}));
              };
              return (<div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'0.82rem',fontWeight:600,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                  <input type="checkbox" checked={allSelected}
                    onChange={() => setFilters(f => ({...f, selectedGames:[]}))}
                    style={{marginTop:'1px'}}
                  /> All
                </label>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px 12px',paddingLeft:'21px'}}>
                {GAME_GROUPS.map(group => {
                  const availVars = group.variants.filter(v => availableGameVariants.has(v));
                  if (availVars.length === 0) return null;
                  const isSingle = availVars.length === 1 && group.variants.length === 1;
                  const groupChecked = availVars.every(v => filters.selectedGames.includes(v));
                  const groupPartial = availVars.some(v => filters.selectedGames.includes(v)) && !groupChecked;
                  if (isSingle) {
                    const v = availVars[0];
                    return (
                      <label key={group.label} style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'0.82rem',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)',marginBottom:'6px'}}>
                        <input type="checkbox" checked={filters.selectedGames.includes(v)}
                          onChange={e => toggleVariant(v, e.target.checked)}
                          style={{marginTop:'1px'}}
                        /> {group.label}
                      </label>
                    );
                  }
                  const needsTopGap = group.label === 'Draw' || group.label === 'Mixed';
                  return (
                    <div key={group.label} style={needsTopGap ? {marginTop:'6px'} : undefined}>
                      <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'0.82rem',fontWeight:600,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                        <input type="checkbox" checked={groupChecked}
                          ref={el => { if (el) el.indeterminate = groupPartial; }}
                          onChange={e => {
                            const checked = e.target.checked;
                            setFilters(f => {
                              const without = f.selectedGames.filter(v => !availVars.includes(v));
                              return {...f, selectedGames: checked ? [...without, ...availVars] : without};
                            });
                          }}
                          style={{marginTop:'1px'}}
                        /> {group.label}
                      </label>
                      <div style={{display:'flex',flexDirection:'column',gap:'2px',paddingLeft:'21px',marginTop:'2px'}}>
                        {availVars.map(v => (
                          <label key={v} style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'0.78rem',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text-muted)'}}>
                            <input type="checkbox" checked={filters.selectedGames.includes(v)}
                              onChange={e => toggleVariant(v, e.target.checked)}
                              style={{marginTop:'1px'}}
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
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'6px'}} onClick={() => setSpecialOpen(s => !s)}>
              Special
              <span style={{fontSize:'0.7rem',transition:'transform 0.15s',transform: specialOpen ? 'rotate(180deg)' : 'rotate(0deg)'}}>{'\u25BC'}</span>
            </label>
            {specialOpen && (
              <div style={{display:'flex',flexDirection:'column',gap:'4px',marginTop:'4px'}}>
                {[
                  ['ladiesOnly', 'Ladies'],
                  ['seniorsOnly', 'Seniors'],
                  ['bountyOnly', 'Bounty'],
                  ['mysteryBountyOnly', 'Mystery Bounty'],
                  ['headsUpOnly', 'Heads Up'],
                  ['tagTeamOnly', 'Tag Team'],
                  ['employeesOnly', 'Casino Employees'],
                ].map(([key, label]) => (
                  <label key={key} style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'0.82rem',fontWeight:400,textTransform:'none',letterSpacing:0,cursor:'pointer',color:'var(--text)'}}>
                    <input type="checkbox" checked={!!filters[key]}
                      onChange={() => setFilters(f => ({...f, [key]: !f[key]}))}
                      style={{marginTop:'1px'}}
                    /> {label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="filter-group filter-actions" style={{gridColumn:'1 / -1',display:'flex',flexDirection:'row',gap:'8px',justifyContent:'flex-end',alignItems:'center',marginTop:'4px'}}>
            {hasActive && (
              <button className="btn btn-ghost btn-sm" onClick={() =>
                setFilters({minBuyin:'',maxBuyin:'',buyinRanges:[],rakeRanges:[],selectedGames:[],hiddenVenues:[],bountyOnly:false,mysteryBountyOnly:false,headsUpOnly:false,tagTeamOnly:false,employeesOnly:false,hideSatellites:true,hideRestarts:true,hideSideEvents:true,hiddenMonths:[],ladiesOnly:false,seniorsOnly:false,mixedOnly:false,dateFrom:'',dateTo:'',maxDistance:'',userLocation:null,locationRegion:null})
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
        position:'fixed',top:'64px',left:'50%',transform:'translateX(-50%)',
        zIndex:999,background:'var(--surface)',border:'1px solid var(--border)',
        borderRadius:'var(--radius)',padding:'12px',width:'min(380px, calc(100vw - 24px))',
        boxShadow:'0 8px 24px rgba(0,0,0,0.3)',maxHeight:'calc(100vh - 80px)',overflowY:'auto',
      }}>
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight:700,fontSize:'0.9rem',color:'var(--text)'}}>Import Schedule</span>
            <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'1rem',padding:'0 2px'}}>&#10005;</button>
          </div>
          <p style={{fontSize:'0.75rem',color:'var(--text-muted)',lineHeight:1.4,margin:0}}>
            Upload a PDF/image or paste a web link. AI extracts event data automatically.
          </p>
          <input type="text" placeholder="Venue (optional -- auto-detected from document)"
            value={visionVenue} onChange={e => setVisionVenue(e.target.value)}
            style={{padding:'6px 10px',borderRadius:'6px',border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:'0.8rem',width:'100%',boxSizing:'border-box'}} />
          <input type="file" id="vision-schedule-upload-dropdown" className="file-input"
            accept=".pdf,.png,.jpg,.jpeg,.webp" multiple onChange={handleVisionUpload} disabled={visionParsing} />
          <label htmlFor="vision-schedule-upload-dropdown" className="btn btn-ghost btn-sm"
            style={{alignSelf:'flex-start',display:'inline-flex',alignItems:'center',gap:'6px',opacity:visionParsing?0.5:1,pointerEvents:visionParsing?'none':'auto'}}>
            <Icon.upload /> {visionParsing ? 'Scanning...' : 'Upload File(s)'}
          </label>
          <div style={{display:'flex',alignItems:'center',gap:'8px',width:'100%'}}>
            <span style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:600}}>or</span>
            <input type="text" placeholder="Paste schedule URL..." value={visionUrl}
              onChange={e => setVisionUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && visionUrl.trim()) handleVisionUrl(); }}
              disabled={visionParsing}
              style={{flex:1,padding:'6px 10px',borderRadius:'6px',border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:'0.8rem',opacity:visionParsing?0.5:1}} />
            <button className="btn btn-ghost btn-sm" onClick={handleVisionUrl}
              disabled={visionParsing || !visionUrl.trim()}
              style={{whiteSpace:'nowrap',opacity:(visionParsing||!visionUrl.trim())?0.5:1}}>
              Fetch
            </button>
          </div>

          {visionParsing && (
            <div style={{padding:'12px',background:'var(--bg)',borderRadius:'8px',border:'1px solid var(--border)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
                <span style={{fontSize:'0.8rem',color:'var(--text-muted)'}}>{visionStage}</span>
                <span style={{fontSize:'0.75rem',color:'var(--text-muted)',fontVariantNumeric:'tabular-nums'}}>{visionProgress}%</span>
              </div>
              <div style={{height:'6px',background:'var(--border)',borderRadius:'3px',overflow:'hidden'}}>
                <div style={{
                  height:'100%',width:visionProgress+'%',
                  background:'linear-gradient(90deg, var(--accent), var(--accent-hover, var(--accent)))',
                  borderRadius:'3px',transition:visionProgress===100?'width 0.3s ease':'width 0.4s ease-out',
                }} />
              </div>
            </div>
          )}

          {visionError && (
            <div style={{padding:'8px 12px',background:'rgba(220,38,38,0.1)',border:'1px solid rgba(220,38,38,0.3)',borderRadius:'6px',color:'#ef4444',fontSize:'0.8rem'}}>
              {visionError}
            </div>
          )}

          {visionResults && visionResults.events.length > 0 && (
            <div style={{marginTop:'4px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
                <div>
                  <span style={{fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight:700,fontSize:'0.9rem',color:'var(--text)'}}>
                    {visionResults.eventCount} Events Found
                  </span>
                  {visionResults.detectedVenue && (
                    <span style={{fontSize:'0.75rem',color:'var(--text-muted)',marginLeft:'8px'}}>
                      at {visionResults.detectedVenue}
                    </span>
                  )}
                </div>
                <span style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>
                  {visionResults.pageCount} page{visionResults.pageCount !== 1 ? 's' : ''} scanned
                </span>
              </div>

              {visionResults.warnings && visionResults.warnings.length > 0 && (
                <div style={{padding:'6px 10px',background:'rgba(234,179,8,0.1)',border:'1px solid rgba(234,179,8,0.3)',borderRadius:'6px',marginBottom:'8px',fontSize:'0.75rem',color:'#eab308'}}>
                  {visionResults.warnings.length} warning{visionResults.warnings.length !== 1 ? 's' : ''}: {visionResults.warnings.slice(0,3).map(w => w.warnings.join(', ')).join('; ')}{visionResults.warnings.length > 3 ? ` (+${visionResults.warnings.length - 3} more)` : ''}
                </div>
              )}

              <div style={{maxHeight:'300px',overflowY:'auto',border:'1px solid var(--border)',borderRadius:'8px'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.75rem'}}>
                  <thead>
                    <tr style={{borderBottom:'2px solid var(--border)',position:'sticky',top:0,background:'var(--bg)'}}>
                      <th style={{padding:'6px 8px',textAlign:'left',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight:600,fontSize:'0.65rem',textTransform:'uppercase'}}>Date</th>
                      <th style={{padding:'6px 8px',textAlign:'left',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight:600,fontSize:'0.65rem',textTransform:'uppercase'}}>Time</th>
                      <th style={{padding:'6px 8px',textAlign:'left',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight:600,fontSize:'0.65rem',textTransform:'uppercase'}}>Event</th>
                      <th style={{padding:'6px 8px',textAlign:'right',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',fontWeight:600,fontSize:'0.65rem',textTransform:'uppercase'}}>Buy-in</th>
                      <th style={{padding:'6px 4px',textAlign:'center',width:'30px'}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visionResults.events.map((ev, i) => (
                      <React.Fragment key={i}>
                        <tr
                          style={{borderBottom:'1px solid var(--border)',cursor:'pointer',background:visionEditIdx===i?'var(--surface)':'transparent'}}
                          onClick={() => setVisionEditIdx(visionEditIdx === i ? -1 : i)}>
                          <td style={{padding:'6px 8px',whiteSpace:'nowrap',color:'var(--text)',fontSize:'0.73rem'}}>{ev.date ? ev.date.replace(/, \d{4}$/, '') : '?'}</td>
                          <td style={{padding:'6px 8px',whiteSpace:'nowrap',color:'var(--text-muted)',fontSize:'0.73rem'}}>{ev.time || '?'}</td>
                          <td style={{padding:'6px 8px',color:'var(--text)',fontSize:'0.73rem',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {ev.is_satellite && <span style={{fontSize:'0.6rem',padding:'1px 4px',borderRadius:'3px',background:'rgba(139,92,246,0.2)',color:'#a78bfa',marginRight:'4px',fontWeight:600}}>SAT</span>}
                            {ev.is_restart && <span style={{fontSize:'0.6rem',padding:'1px 4px',borderRadius:'3px',background:'rgba(234,179,8,0.2)',color:'#eab308',marginRight:'4px',fontWeight:600}}>Restart</span>}
                            {ev.event_name || '(unnamed)'}
                            {ev._warnings && ev._warnings.length > 0 && <span style={{color:'#eab308',marginLeft:'4px'}} title={ev._warnings.join(', ')}>!</span>}
                          </td>
                          <td style={{padding:'6px 8px',textAlign:'right',color:'var(--text)',fontWeight:600,fontSize:'0.73rem'}}>{ev.buyin != null ? `$${ev.buyin.toLocaleString()}` : '\u2014'}</td>
                          <td style={{padding:'6px 4px',textAlign:'center'}}>
                            <button onClick={(e) => { e.stopPropagation(); removeVisionEvent(i); }}
                              style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:'0.7rem',padding:'2px 4px',lineHeight:1}}
                              title="Remove event">x</button>
                          </td>
                        </tr>
                        {visionEditIdx === i && (
                          <tr style={{borderBottom:'1px solid var(--border)',background:'var(--surface)'}}>
                            <td colSpan={5} style={{padding:'8px'}}>
                              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px',fontSize:'0.75rem'}}>
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
                                  <label key={field} style={{display:'flex',flexDirection:'column',gap:'2px'}}>
                                    <span style={{color:'var(--text-muted)',fontSize:'0.65rem',textTransform:'uppercase'}}>{label}</span>
                                    <input type={type} value={ev[field] || (type === 'number' ? 0 : '')}
                                      onChange={e => updateVisionEvent(i, field, type === 'number' ? (parseInt(e.target.value) || (field === 'buyin' ? 0 : null)) : e.target.value)}
                                      style={{padding:'4px 6px',borderRadius:'4px',border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:'0.75rem'}} />
                                  </label>
                                ))}
                                <label key="category" style={{display:'flex',flexDirection:'column',gap:'2px'}}>
                                  <span style={{color:'var(--text-muted)',fontSize:'0.65rem',textTransform:'uppercase'}}>Category</span>
                                  <select value={ev.category || ''} onChange={e => updateVisionEvent(i, 'category', e.target.value || null)}
                                    style={{padding:'4px 6px',borderRadius:'4px',border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:'0.75rem'}}>
                                    <option value="">{'\u2014'}</option>
                                    <option value="main">Main Event</option>
                                    <option value="side">Side Event</option>
                                  </select>
                                </label>
                              </div>
                              <div style={{display:'flex',flexWrap:'wrap',gap:'12px',marginTop:'8px',fontSize:'0.75rem'}}>
                                <label style={{display:'flex',alignItems:'center',gap:'4px',cursor:'pointer',color:'var(--text-muted)'}}>
                                  <input type="checkbox" checked={!!ev.is_satellite} onChange={e => { updateVisionEvent(i, 'is_satellite', e.target.checked); if (e.target.checked) updateVisionEvent(i, 'is_restart', false); }} />
                                  Satellite
                                </label>
                                <label style={{display:'flex',alignItems:'center',gap:'4px',cursor:'pointer',color:'var(--text-muted)'}}>
                                  <input type="checkbox" checked={!!ev.is_restart} onChange={e => { updateVisionEvent(i, 'is_restart', e.target.checked); if (e.target.checked) { updateVisionEvent(i, 'is_satellite', false); updateVisionEvent(i, 'buyin', 0); } }} />
                                  Restart (Day 2+)
                                </label>
                                <label style={{display:'flex',alignItems:'center',gap:'4px',cursor:'pointer',color:'var(--text-muted)'}}>
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

              <div style={{display:'flex',gap:'8px',marginTop:'12px',justifyContent:'flex-end'}}>
                <button className="btn btn-ghost btn-sm" onClick={() => { setVisionResults(null); setVisionFile(null); }}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleVisionImport}
                  disabled={visionImporting || !visionResults.events.length}
                  style={{display:'inline-flex',alignItems:'center',gap:'6px'}}>
                  {visionImporting ? 'Importing...' : `Add ${visionResults.events.length} Events`}
                </button>
              </div>
            </div>
          )}

          {visionResults && visionResults.events.length === 0 && (
            <div style={{padding:'12px',background:'var(--bg)',borderRadius:'8px',border:'1px solid var(--border)',color:'var(--text-muted)',fontSize:'0.8rem',textAlign:'center'}}>
              No tournament events found. Try a different file or check that it contains a tournament schedule.
              {visionResults.pageErrors && visionResults.pageErrors.length > 0 && (
                <div style={{marginTop:'8px',fontSize:'0.75rem',color:'var(--accent)',textAlign:'left'}}>
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

// LocationDropdown lives in its own file now (shared with CalendarView).
export default function TournamentsView({
  tournaments, mySchedule, onToggle, gameVariants, venues,
  onSetCondition, onRemoveCondition, onToggleAnchor, onSetPlannedEntries,
  buddyEvents, buddyLiveUpdates, onBuddySwap, isAdmin, onAdminEdit,
  token, onRefreshTournaments, onOpenCalendarView
}) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const deferredSearch = React.useDeferredValue ? React.useDeferredValue(search) : search;
  const [filters, setFilters] = useState(() => {
    // Restore previously-chosen location from localStorage so users don't have
    // to re-enter distance/region on every launch.
    let savedLoc = {};
    try {
      const raw = localStorage.getItem('savedLocation');
      if (raw) savedLoc = JSON.parse(raw);
    } catch(e) {}
    return {
      minBuyin: '', maxBuyin: '', buyinRanges: [], rakeRanges: [], selectedGames: [],
      hiddenVenues: [], bountyOnly: false, mysteryBountyOnly: false, headsUpOnly: false,
      tagTeamOnly: false, employeesOnly: false, hideSatellites: true, hideRestarts: true,
      hideSideEvents: false, hiddenMonths: [], ladiesOnly: false, seniorsOnly: false,
      mixedOnly: false, dateFrom: '', dateTo: '',
      maxDistance: savedLoc.maxDistance || '',
      userLocation: savedLoc.userLocation || null,
      locationRegion: savedLoc.locationRegion || null,
      locationLabel: savedLoc.locationLabel || null,
    };
  });
  // Persist location selection across sessions
  useEffect(() => {
    const { userLocation, locationRegion, maxDistance, locationLabel } = filters;
    if (userLocation || locationRegion) {
      localStorage.setItem('savedLocation', JSON.stringify({ userLocation, locationRegion, maxDistance, locationLabel }));
    } else {
      localStorage.removeItem('savedLocation');
    }
  }, [filters.userLocation, filters.locationRegion, filters.maxDistance, filters.locationLabel]);
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
  // Formula: scrollTo(groupAbsTop - filtersH - 2). The date-break
  // (first child of the group) sits at filtersH + 2; first event sits
  // at filtersH + dateBreakH + 2.
  const scrollDateGroupToTop = useCallback((dateGroupEl, behavior = 'smooth') => {
    const container = document.querySelector('.content-area');
    if (!container || !dateGroupEl) return;
    const stickyEl = container.querySelector('.sticky-filters');
    const filtersH = stickyEl ? stickyEl.getBoundingClientRect().height : 0;
    const cTop = container.getBoundingClientRect().top;
    const groupAbsTop = dateGroupEl.getBoundingClientRect().top - cTop + container.scrollTop;
    container.scrollTo({ top: Math.max(0, groupAbsTop - filtersH - 2), behavior });
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
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setRenderedGroupCount(prev => prev + 30);
      }
    }, { rootMargin: '1200px' });
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
    const measure = () => {
      if (stickyFiltersRef.current) {
        const h = stickyFiltersRef.current.offsetHeight;
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
        // Unknown location excludes from both filters — see the note in CalendarView.
        if (filters.maxDistance && filters.userLocation) {
          const coords = getVenueCoords(t.venue);
          if (!coords) return false;
          const dist = haversineDistance(filters.userLocation.lat, filters.userLocation.lng, coords.lat, coords.lng);
          if (dist > Number(filters.maxDistance)) return false;
        }
        if (filters.locationRegion) {
          const coords = getVenueCoords(t.venue);
          const regionDef = LOCATION_REGIONS[filters.locationRegion];
          if (regionDef) { if (!coords || !regionDef.test(coords)) return false; }
        }
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
        if (filters.hideSideEvents && t.category === 'side') return false;
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
    fab.innerHTML = '<svg class="fab-arrow-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="18 15 12 9 6 15"/></svg><svg class="fab-arrow-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="6 9 12 15 18 9"/></svg>' + fabLabel;
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
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
          <button
            ref={locationBtnRef}
            className={`filter-chip filter-chip-square ${filters.locationRegion || filters.userLocation ? 'active' : ''}`}
            onClick={() => setLocationDropdownOpen(o => !o)}
            style={{flexShrink:0}}
            title={filters.locationRegion && LOCATION_REGIONS[filters.locationRegion]
              ? LOCATION_REGIONS[filters.locationRegion].label
              : filters.userLocation && filters.maxDistance
                ? `${filters.locationLabel || 'Location'} \u00B7 ${filters.maxDistance}mi`
                : 'All Locations'}
          >
            <Icon.mapPin />
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
          <button
            ref={filterToggleRef}
            className={`filter-chip filter-chip-square ${filterPanelOpen ? 'active' : ''}`}
            onClick={() => setFilterPanelOpen(o => !o)}
            style={{flexShrink:0}}
          >
            <Icon.filter />
          </button>
          <button
            ref={importBtnRef}
            className={`filter-chip filter-chip-square ${importDropdownOpen ? 'active' : ''}`}
            onClick={() => setImportDropdownOpen(o => !o)}
            style={{flexShrink:0}}
            title="Import schedule"
          >
            <Icon.upload />
          </button>
          <div style={{display:'flex',gap:'10px',alignItems:'center',marginLeft:'auto'}}>
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'4px',fontSize:'0.78rem',color:'var(--text)',whiteSpace:'nowrap'}}>
              <input type="checkbox" checked={!filters.hideSatellites}
                onChange={e => setFilters(f => ({...f, hideSatellites:!e.target.checked}))}
                style={{margin:0}}
              /> Satellites
            </label>
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'4px',fontSize:'0.78rem',color:'var(--text)',whiteSpace:'nowrap'}}>
              <input type="checkbox" checked={!filters.hideRestarts}
                onChange={e => setFilters(f => ({...f, hideRestarts:!e.target.checked}))}
                style={{margin:0}}
              /> Restarts
            </label>
            <label style={{cursor:'pointer',display:'flex',alignItems:'center',gap:'4px',fontSize:'0.78rem',color:'var(--text)',whiteSpace:'nowrap'}}>
              <input type="checkbox" checked={!filters.hideSideEvents}
                onChange={e => setFilters(f => ({...f, hideSideEvents:!e.target.checked}))}
                style={{margin:0}}
              /> Side Events
            </label>
          </div>
        </div>

        <Filters filters={filters} setFilters={setFiltersWithScroll} gameVariants={gameVariants} venues={venues} buyinOptions={buyinOptions} tournaments={tournaments} open={filterPanelOpen} setOpen={setFilterPanelOpen} toggleRef={filterToggleRef} search={search} setSearch={setSearch} />

        <ImportSchedulePanel isOpen={importDropdownOpen} onClose={() => setImportDropdownOpen(false)} token={token} onRefreshTournaments={onRefreshTournaments} />

        {locationDropdownOpen && createPortal(
          <div style={{position:'fixed',inset:0,zIndex:998}} onClick={() => setLocationDropdownOpen(false)} />,
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
        <div className="empty-state">
          <Icon.empty />
          <h3>No events found</h3>
          <p>Try adjusting your search or filters</p>
        </div>
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
                <div key={group.date} ref={needsRef ? todayScrollRef : undefined} data-today-scroll={needsRef ? 'true' : undefined} data-date-group={group.date} style={{marginTop: gi === 0 ? 0 : '8px'}}>
                  <div className="schedule-date-break" onClick={() => toggleDateCollapsed(group.date)} style={{
                    position: 'sticky', top: dateBreakTop + 'px', zIndex: 5,
                    padding: '12px 12px 8px 2px',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontWeight: 700,
                    borderBottom: 'none',
                    display: 'flex', alignItems: 'baseline', gap: '4px',
                    cursor: 'pointer', userSelect: 'none'
                  }}>
                    {isToday ? (
                      <>
                        <span style={{
                          background: 'var(--accent)', display: 'inline-flex', alignItems: 'baseline', gap: '4px',
                          padding: '4px 12px', borderRadius: '999px', cursor: 'pointer'
                        }} onClick={(e) => {
                          e.stopPropagation();
                          const grp = e.currentTarget.closest('[data-date-group]');
                          if (grp) scrollDateGroupToTop(grp);
                        }}>
                          <span style={{fontSize: '1.7rem', lineHeight: 1, fontFamily: "var(--serif)", color: 'var(--bg)'}}>{dayNum}</span>
                          <span style={{fontSize: '0.85rem', lineHeight: 1, fontFamily: "var(--serif)", textTransform: 'capitalize', color: 'var(--bg)'}}>{monthAbbr}</span>
                        </span>
                        <span style={{fontSize:'0.7rem',color:'var(--text-muted)',fontWeight:600,marginLeft:'4px'}}>{dayEventCount} event{dayEventCount !== 1 ? 's' : ''}</span>
                        <span style={{marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: '8px'}}>
                          <span style={{fontSize: '0.85rem', lineHeight: 1, fontFamily: "var(--serif)"}}>{dayOfWeek}</span>
                          <span aria-label={isCollapsed ? 'Expand' : 'Collapse'} style={{
                            display: 'inline-block', fontSize: '1.1rem', lineHeight: 1, color: 'var(--accent)',
                            transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                            transition: 'transform 0.15s ease'
                          }}>{'▶'}</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{fontSize: '1.7rem', lineHeight: 1, fontFamily: "var(--serif)"}}>{dayNum}</span>
                        <span style={{fontSize: '0.85rem', lineHeight: 1, fontFamily: "var(--serif)", textTransform: 'capitalize'}}>{monthAbbr}</span>
                        <span style={{fontSize:'0.7rem',color:'var(--text-muted)',fontWeight:600,marginLeft:'4px'}}>{dayEventCount} event{dayEventCount !== 1 ? 's' : ''}</span>
                        <span style={{marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: '8px'}}>
                          <span style={{fontSize: '0.85rem', lineHeight: 1, fontFamily: "var(--serif)"}}>{dayOfWeek}</span>
                          <span aria-label={isCollapsed ? 'Expand' : 'Collapse'} style={{
                            display: 'inline-block', fontSize: '1.1rem', lineHeight: 1, color: 'var(--accent)',
                            transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                            transition: 'transform 0.15s ease'
                          }}>{'▶'}</span>
                        </span>
                      </>
                    )}
                  </div>
                  {!isCollapsed && group.events.map(t => {
                    const needsFull = isToday || activatedIds.has(t.id) || focusEventId === t.id;
                    return (
                    <div key={t.id} style={{contentVisibility:'auto', containIntrinsicSize:'auto 72px'}}>
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
                          initialOpen={activatedIds.has(t.id)}
                        />
                      ) : (
                        <CalendarEventRowLite
                          tournament={t}
                          isInSchedule={scheduleIds.has(t.id)}
                          isPast={past}
                          isAnchor={anchorSet.has(t.id)}
                          conditions={conditionMap[t.id]}
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
          <div ref={loadMoreRef} style={{height: 1}} />
        </div>
      )}

      <div ref={fabContainerRef} />
    </div>
  );
}
