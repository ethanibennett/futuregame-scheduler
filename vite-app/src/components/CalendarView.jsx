import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import CalendarEventRow from './CalendarEventRow.jsx';
import {
  getVenueInfo, normaliseDate, parseDateTime, parseTournamentTime, parseDateTimeInTz,
  getToday, getNow, fmtShortDate, addDays, daysBetween,
  isBraceletEvent, extractConditions, detectConflicts, findClosestFlight,
  haptic, VENUE_MAP, getVenueBrandColor, getVenueCoords, haversineDistance,
  VENUE_TO_SERIES, LOCATION_REGIONS,
  isSideEvent, isOnline, passesSiteRule,
} from '../utils/utils.js';
import { isSiteAvailable } from '../utils/online-sites.js';
import { readLocalLocation, writeLocalLocation, pushServerLocation,
  fetchServerLocation, sameLocation, readLocalFilters } from '../utils/location-prefs.js';
import { API_URL } from '../utils/api.js';

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const GAME_GROUPS = [
  { label: 'NLH', variants: ['NLH'] },
  { label: 'PLO', variants: ['PLO'] },
  { label: 'Omaha', variants: ['O8', 'PLO8', 'Big O'] },
  { label: 'Stud', variants: ['7-Card Stud', 'Razz', 'Stud 8'] },
  { label: 'Draw', variants: ['2-7 Triple Draw', 'Mixed Triple Draw', 'NL 2-7 Single Draw', 'Badugi'] },
  { label: 'Mixed', variants: ['8-Game Mix', '9-Game Mix', 'HORSE', 'TORSE', 'Mixed', "Dealer's Choice", 'Limit Hold\'em'] },
];

function buildAllDates(tournaments) {
  if (!tournaments || tournaments.length === 0) return [];
  let min = null, max = null;
  for (const t of tournaments) {
    const d = normaliseDate(t.date);
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  if (!min || !max) return [];
  const dates = [];
  // Format using LOCAL date components (UTC via toISOString rolls over
  // for users east of UTC and produces a duplicate or skipped date).
  for (let d = new Date(min + 'T12:00:00'); d <= new Date(max + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
}

/* g and r in px, read from the live tokens (a 100-unit probe, so nothing is rounded) - the JS
   that positions the filter panel and its pills must use exactly the units the CSS does. */
function gridUnitsPx() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;width:calc(var(--gu) * 100);height:calc(var(--subrow) * 100)';
  document.body.appendChild(probe);
  const b = probe.getBoundingClientRect();
  probe.remove();
  return { g: b.width / 100, r: b.height / 100 };
}
/* The vertical lines an edge may sit on, in g from the app's left edge: each 8g column
   (starting 1g, 10g, 19g, 28g) has a line every 2g - 1,3,5,7,9 | 10..18 | 19..27 | 28..36. */
const GRID_LINES = [-4, -3, -2, -1, 0, 1, 2, 3].flatMap(c => [0, 2, 4, 6, 8].map(s => 1 + 9 * c + s));
/* (continued leftwards past the screen edge, so pills scrolled out of the strip keep the pattern) */
function prevGridLine(x) {
  let best = GRID_LINES[0];
  for (const l of GRID_LINES) if (l <= x + 1e-6) best = l;
  return best;
}

/* Where the filter panel opens: 35g wide on the 1g margins, its top on the first whole r at
   least 1r below the filter button (counted from the .top-bar top, the overlay's origin), its
   max height the whole r that ends at least 1r above the bottom nav. Its content is whole r,
   so the panel's height is whole r whether it fits or scrolls. */
function calPanelPos(btn) {
  const { r } = gridUnitsPx();
  const bar = document.querySelector('.top-bar');
  const shell = document.querySelector('.app-shell');
  const nav = document.querySelector('.bottom-nav');
  const barTop = bar ? bar.getBoundingClientRect().top : 0;
  const x0 = shell ? shell.getBoundingClientRect().left : 0;
  const limit = nav ? nav.getBoundingClientRect().top : (window.innerHeight || document.documentElement.clientHeight);
  const b = btn ? btn.getBoundingClientRect() : null;
  const topR = b ? Math.ceil((b.bottom - barTop) / r - 0.01) + 1 : 8;
  const maxR = Math.max(8, Math.floor((limit - barTop) / r + 0.01) - topR - 1);
  return {
    top: `calc(${barTop}px + var(--subrow) * ${topR})`,
    left: `calc(${x0}px + var(--gu))`,
    maxHeight: `calc(var(--subrow) * ${maxR})`,
  };
}
/* A disclosure row (Series / Buy-in / Variant / Special): 4r, label and chevron seated 1r up. */
function calHead(label, isOpen, toggle) {
  return (
    <button type="button" className="cal-fp-head" aria-expanded={isOpen} onClick={toggle}>
      <span className="cal-fp-cap">{label}</span>
      <span className={`cal-fp-cap cal-fp-chev${isOpen ? ' is-open' : ''}`} aria-hidden="true">{'▼'}</span>
    </button>
  );
}
/* One checkbox option: a 2g checkbox cell, then the label on 2r lines - 3r for one line,
   +2r per wrapped line, first baseline 2r down. */
function calOpt(key, checked, onChange, text, cls = '', inputRef) {
  return (
    <label key={key} className={`cal-fp-opt ${cls}`}>
      <input type="checkbox" checked={checked} onChange={onChange} ref={inputRef} />
      <span className="cal-fp-txt">{text}</span>
    </label>
  );
}

// ── Inline Filters component (matches original exactly) ──
function Filters({ filters, setFilters, gameVariants, venues, buyinOptions, tournaments, search, setSearch }) {
  const panelRef = useRef(null);
  const toggleRef = useRef(null);
  const [open, setOpen] = useState(false);
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
    filters.selectedGames.length > 0 || (filters.hiddenVenues && filters.hiddenVenues.length > 0) || filters.bountyOnly || filters.mysteryBountyOnly || filters.headsUpOnly || filters.tagTeamOnly || filters.employeesOnly || !filters.hideSatellites || !filters.hideRestarts || filters.hideSideEvents || filters.ladiesOnly || filters.seniorsOnly || filters.mixedOnly || filters.dateFrom || filters.dateTo ||
    filters.showOnline === false || filters.onlyAvailableOnline === true ||
    Object.keys(filters.siteRules || {}).length > 0;
  /* Location is deliberately NOT counted here. It survives "Clear all",
     so counting it would show a Clear button that then appears to do
     nothing when a location is the only thing set. TournamentsView's
     equivalent already omits it. */

  /* Active-filter pills, in the order they have always shown. Each is [label, clear-patch]. */
  const pills = [];
  if (filters.selectedGames.length > 0) pills.push([filters.selectedGames.length === 1 ? filters.selectedGames[0] : `${filters.selectedGames.length} games`, { selectedGames: [] }]);
  if (filters.buyinRanges && filters.buyinRanges.length > 0) pills.push([filters.buyinRanges.length === 1 ? ({'0-500':'< $500','500-1500':'$500\u2013$1.5K','1500-5000':'$1.5K\u2013$5K','5000-10000':'$5K\u2013$10K','10000+':'$10K+'})[filters.buyinRanges[0]] : `${filters.buyinRanges.length} buy-ins`, { buyinRanges: [] }]);
  if (filters.rakeRanges && filters.rakeRanges.length > 0) pills.push([filters.rakeRanges.length === 1 ? ({'0-5':'< 5%','5-8':'5\u20138%','8-10':'8\u201310%','10-13':'10\u201313%','13+':'13%+'})[filters.rakeRanges[0]] : `${filters.rakeRanges.length} rake ranges`, { rakeRanges: [] }]);
  if (filters.bountyOnly) pills.push(['Bounty', { bountyOnly: false }]);
  if (filters.mysteryBountyOnly) pills.push(['Mystery Bounty', { mysteryBountyOnly: false }]);
  if (filters.headsUpOnly) pills.push(['Heads Up', { headsUpOnly: false }]);
  if (filters.tagTeamOnly) pills.push(['Tag Team', { tagTeamOnly: false }]);
  if (filters.employeesOnly) pills.push(['Employees', { employeesOnly: false }]);
  if (filters.hiddenVenues && filters.hiddenVenues.length > 0) pills.push([`${availableVenues.length - filters.hiddenVenues.filter(v => availableVenues.some(av => av.venue === v)).length} of ${availableVenues.length} venues`, { hiddenVenues: [] }]);
  if (filters.ladiesOnly) pills.push(['Ladies Only', { ladiesOnly: false }]);
  if (filters.seniorsOnly) pills.push(['Seniors Only', { seniorsOnly: false }]);
  if (filters.mixedOnly) pills.push(['Mixed', { mixedOnly: false }]);
  if (filters.dateFrom || filters.dateTo) pills.push([filters.dateFrom && filters.dateTo ? `${fmtShortDate(filters.dateFrom)} \u2014 ${fmtShortDate(filters.dateTo)}` : filters.dateFrom ? `From ${fmtShortDate(filters.dateFrom)}` : `Until ${fmtShortDate(filters.dateTo)}`, { dateFrom: '', dateTo: '' }]);

  /* Seat the pills on the vertical grid lines. A pill's width follows its label, so CSS alone
     cannot land its edges on a line: walking right-to-left from the filter button, each pill's
     right edge takes the nearest valid line clear of its neighbour (1g across a column gutter,
     2g inside a column - the same spacing the lines themselves have) and its left edge the valid
     line that just clears the label. Widths are written in g, so they scale with the screen. */
  const pillsRef = useRef(null);
  const [, bumpPills] = useState(0);
  useEffect(() => {
    const onResize = () => bumpPills(n => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  React.useLayoutEffect(() => {
    const box = pillsRef.current, btn = toggleRef.current;
    if (!box || !btn) return;
    const els = [...box.querySelectorAll('[data-cal-pill]')];
    if (!els.length) return;
    const { g } = gridUnitsPx();
    const shell = document.querySelector('.app-shell');
    const x0 = shell ? shell.getBoundingClientRect().left : 0;
    els.forEach(el => { el.style.width = ''; el.style.marginRight = ''; });
    const natural = els.map(el => el.getBoundingClientRect().width / g);
    let edge = (btn.getBoundingClientRect().left - x0) / g;
    for (let i = els.length - 1; i >= 0; i--) {
      const right = prevGridLine(edge - 0.999);
      const left = prevGridLine(right - natural[i] + 0.001);
      els[i].style.width = `calc(var(--gu) * ${right - left})`;
      els[i].style.marginRight = `calc(var(--gu) * ${Math.round(edge - right)})`;
      edge = left;
    }
    // Overflowing (more pills than the 17g cell holds): rest at the right end, where the walk
    // above put every edge on a line; the rest scroll in from the left.
    box.scrollLeft = box.scrollWidth;
  });

  return (
    <>
      <div className="filter-row cal-fp-bar" style={{gap:'calc(var(--subrow) * 1)',marginBottom:'0',width:'100%',alignItems:'center'}}>
        <div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:0,justifyContent:'flex-end'}}>
          <div ref={pillsRef} className="cal-fp-pills">
          {pills.map(([label, patch]) => (
            <span key={Object.keys(patch)[0]} className="filter-chip active cal-fp-pill" data-cal-pill="">
              <span className="cal-fp-cap">{label}</span>
              <span className="cal-fp-cap cal-fp-pill-x" role="button" aria-label={`Clear ${label}`}
                onClick={() => setFilters(f => ({...f, ...patch}))}>&#10005;</span>
            </span>
          ))}
          </div>
          <button
            ref={toggleRef}
            className={`filter-chip filter-chip-square ${open ? 'active' : ''}`}
            onClick={() => setOpen(o => !o)}
            style={{flexShrink:0,width:'calc(var(--gu) * 4)'}}
          >
            <Icon.filter />
          </button>
        </div>
      </div>

      {open && createPortal(
        <div className="dropdown-backdrop" onClick={() => setOpen(false)} />,
        document.body
      )}
      {open && createPortal(
        <div ref={panelRef} className="cal-fp" style={calPanelPos(toggleRef.current)}>
          {/* Quick filter chips: five 5g chips on 2g gaps fill the 33g content (5x5 + 4x2 = 33),
              so every inner edge sits on a column line (7|9, 14|16, 21|23, 28|30). */}
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
              <div className="cal-fp-chips">
                {quickFilters.map(qf => (
                  <button key={qf.label} type="button" className={`filter-chip cal-fp-chip ${qf.isActive ? 'active' : ''}`}
                    onClick={qf.toggle}
                  ><span className="cal-fp-cap">{qf.label}</span></button>
                ))}
              </div>
            );
          })()}

          {/* Search */}
          <div className="search-bar cal-fp-search">
            <Icon.search />
            <input
              type="text"
              placeholder={"Search events, games…"}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="cal-fp-search-x" aria-label="Clear search" onClick={() => setSearch('')}>
                <span className="cal-fp-cap">&#10005;</span>
              </button>
            )}
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
              <div className="cal-fp-date">
                <span className="cal-fp-subtxt">Date Range</span>
                <div className="date-slider-wrap cal-fp-slider">
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
                <div className="cal-fp-dates">
                  <label className="date-slider-date-link cal-fp-cap">
                    {fmtShortDate(fromDate)}
                    <input type="date" value={fromDate} min={minDate} max={toDate}
                      onChange={e => {
                        const v = e.target.value;
                        if (!v) { setFilters(f => ({...f, dateFrom: ''})); return; }
                        const idx = daysBetween(minDate, v);
                        setFilters(f => ({...f, dateFrom: idx <= 0 ? '' : v}));
                      }}
                    />
                  </label>
                  <label className="date-slider-date-link cal-fp-cap">
                    {fmtShortDate(toDate)}
                    <input type="date" value={toDate} min={fromDate} max={maxDate}
                      onChange={e => {
                        const v = e.target.value;
                        if (!v) { setFilters(f => ({...f, dateTo: ''})); return; }
                        const idx = daysBetween(minDate, v);
                        setFilters(f => ({...f, dateTo: idx >= totalDays ? '' : v}));
                      }}
                    />
                  </label>
                </div>
              </div>
            );
          })()}

          <div className="cal-fp-groups">
            {/* Series */}
            {calHead('Series', whereOpen, () => setWhereOpen(w => !w))}
            {whereOpen && (<div className="cal-fp-body">
              {calOpt('all', !filters.hiddenVenues || filters.hiddenVenues.length === 0,
                e => setFilters(f => ({...f, hiddenVenues: e.target.checked ? [] : availableVenues.map(v => v.venue)})),
                'All', 'is-bold',
                el => { if (el) el.indeterminate = filters.hiddenVenues && filters.hiddenVenues.length > 0 && filters.hiddenVenues.length < availableVenues.length; })}
              <div className="cal-fp-cols">
                {availableVenues.map(({ venue, series }) => {
                  const hidden = (filters.hiddenVenues || []).includes(venue);
                  return calOpt(venue, !hidden,
                    e => setFilters(f => {
                      const hv = f.hiddenVenues || [];
                      return {...f, hiddenVenues: e.target.checked ? hv.filter(v => v !== venue) : [...hv, venue]};
                    }),
                    series);
                })}
              </div>
            </div>)}

            {/* Buy-in / Rake */}
            {calHead('Buy-in / Rake', howMuchOpen, () => setHowMuchOpen(h => !h))}
            {howMuchOpen && (() => {
              const buyinOpts = [
                { key: '0-500', label: 'Under $500' },
                { key: '500-1500', label: '$500 – $1.5K' },
                { key: '1500-5000', label: '$1.5K – $5K' },
                { key: '5000-10000', label: '$5K – $10K' },
                { key: '10000+', label: '$10K+' },
              ];
              const rakeOpts = [
                { key: '0-5', label: 'Under 5%' },
                { key: '5-8', label: '5% – 8%' },
                { key: '8-10', label: '8% – 10%' },
                { key: '10-13', label: '10% – 13%' },
                { key: '13+', label: '13%+' },
              ];
              const toggleArr = (arr, key) => arr.includes(key) ? arr.filter(k => k !== key) : [...arr, key];
              const allBuyinChecked = (filters.buyinRanges || []).length === 0;
              const allRakeChecked = (filters.rakeRanges || []).length === 0;
              return (<div className="cal-fp-body cal-fp-cols">
                <div>
                  <span className="cal-fp-subtxt">Buy-in</span>
                  {calOpt('all', allBuyinChecked, () => setFilters(f => ({...f, buyinRanges: [], minBuyin: '', maxBuyin: ''})), 'All', 'is-bold')}
                  {buyinOpts.map(opt => calOpt(opt.key, (filters.buyinRanges || []).includes(opt.key),
                    () => setFilters(f => ({...f, buyinRanges: toggleArr(f.buyinRanges || [], opt.key), minBuyin: '', maxBuyin: ''})),
                    opt.label))}
                </div>
                <div>
                  <span className="cal-fp-subtxt">Rake</span>
                  {calOpt('all', allRakeChecked, () => setFilters(f => ({...f, rakeRanges: []})), 'All', 'is-bold')}
                  {rakeOpts.map(opt => calOpt(opt.key, (filters.rakeRanges || []).includes(opt.key),
                    () => setFilters(f => ({...f, rakeRanges: toggleArr(f.rakeRanges || [], opt.key)})),
                    opt.label))}
                </div>
              </div>);
            })()}

            {/* Variant */}
            {calHead('Variant', whichOpen, () => setWhichOpen(w => !w))}
            {whichOpen && (() => {
              const allSelected = filters.selectedGames.length === 0;
              const toggleVariant = (v, checked) => {
                setFilters(f => ({...f, selectedGames: checked ? [...f.selectedGames, v] : f.selectedGames.filter(g => g !== v)}));
              };
              return (<div className="cal-fp-body">
                {calOpt('all', allSelected, () => setFilters(f => ({...f, selectedGames:[]})), 'All', 'is-bold')}
                <div className="cal-fp-cols is-spaced">
                {GAME_GROUPS.map(group => {
                  const availVars = group.variants.filter(v => availableGameVariants.has(v));
                  if (availVars.length === 0) return null;
                  const isSingle = availVars.length === 1 && group.variants.length === 1;
                  const groupChecked = availVars.every(v => filters.selectedGames.includes(v));
                  const groupPartial = availVars.some(v => filters.selectedGames.includes(v)) && !groupChecked;
                  if (isSingle) {
                    const v = availVars[0];
                    return calOpt(group.label, filters.selectedGames.includes(v), e => toggleVariant(v, e.target.checked), group.label);
                  }
                  return (
                    <div key={group.label}>
                      {calOpt('group', groupChecked,
                        e => {
                          const checked = e.target.checked;
                          setFilters(f => {
                            const without = f.selectedGames.filter(v => !availVars.includes(v));
                            return {...f, selectedGames: checked ? [...without, ...availVars] : without};
                          });
                        },
                        group.label, 'is-bold',
                        el => { if (el) el.indeterminate = groupPartial; })}
                      <div className="cal-fp-subs">
                        {availVars.map(v => calOpt(v, filters.selectedGames.includes(v), e => toggleVariant(v, e.target.checked), v, 'is-muted'))}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>);
            })()}

            {/* Special */}
            {calHead('Special', specialOpen, () => setSpecialOpen(s => !s))}
            {specialOpen && (
              <div className="cal-fp-body">
                {calOpt('ladies', !!filters.ladiesOnly, () => setFilters(f => ({...f, ladiesOnly:!f.ladiesOnly})), 'Ladies')}
                {calOpt('seniors', !!filters.seniorsOnly, () => setFilters(f => ({...f, seniorsOnly:!f.seniorsOnly})), 'Seniors')}
                {calOpt('bounty', !!filters.bountyOnly, e => setFilters(f => ({...f, bountyOnly:e.target.checked})), 'Bounty')}
                {calOpt('mystery', !!filters.mysteryBountyOnly, e => setFilters(f => ({...f, mysteryBountyOnly:e.target.checked})), 'Mystery Bounty')}
                {calOpt('headsup', !!filters.headsUpOnly, e => setFilters(f => ({...f, headsUpOnly:e.target.checked})), 'Heads Up')}
                {calOpt('tagteam', !!filters.tagTeamOnly, e => setFilters(f => ({...f, tagTeamOnly:e.target.checked})), 'Tag Team')}
                {calOpt('employees', !!filters.employeesOnly, e => setFilters(f => ({...f, employeesOnly:e.target.checked})), 'Casino Employees')}
              </div>
            )}
          </div>

          {/* Clear all + Save & Close, one per half of the 2-column split (2..18 | 19..35) */}
          <div className="cal-fp-actions">
            {hasActive && (
              <button type="button" className="btn btn-ghost btn-sm cal-fp-clear" onClick={() =>
                setFilters(f => ({minBuyin:'',maxBuyin:'',buyinRanges:[],rakeRanges:[],selectedGames:[],hiddenVenues:[],bountyOnly:false,mysteryBountyOnly:false,headsUpOnly:false,tagTeamOnly:false,employeesOnly:false,hideSatellites:true,hideRestarts:true,hideSideEvents:false,hiddenMonths:[],ladiesOnly:false,seniorsOnly:false,mixedOnly:false,dateFrom:'',dateTo:'',/* Location survives a clear: it is a standing choice about where the user IS, not a filter they set for one look at the list. It changes only when they change it. */maxDistance:f.maxDistance,userLocation:f.userLocation,locationRegion:f.locationRegion,locationLabel:f.locationLabel}))
              }><span className="cal-fp-cap">Clear all filters</span></button>
            )}
            <button type="button" className="btn btn-primary btn-sm cal-fp-save" onClick={() => setOpen(false)}><span className="cal-fp-cap">Save &amp; Close</span></button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default function CalendarView({ token, allTournaments, mySchedule, onToggle, gameVariants, venues, onSetCondition, onRemoveCondition, onToggleAnchor, onSetPlannedEntries, buddyEvents, buddyLiveUpdates, onOpenScheduleView, initialSearch, onSearchConsumed }) {
  // Search: owned here (not in the Filters sheet) because it drives what the calendar SHOWS —
  // the per-day density counts and the day's event list — not just a sheet control. Matches the
  // event name, the venue strip, the series name (which rides in notes), and the game.
  const [search, setSearch] = useState('');
  const searchNeedle = search.trim().toLowerCase();
  const matchesSearch = useCallback((t) => {
    if (!searchNeedle) return true;
    return [t.event_name, t.venue, t.notes, t.game_variant]
      .some(f => f && String(f).toLowerCase().includes(searchNeedle));
  }, [searchNeedle]);
  const searchedTournaments = useMemo(
    () => (searchNeedle ? (allTournaments || []).filter(matchesSearch) : allTournaments),
    [allTournaments, searchNeedle, matchesSearch]
  );

  // Deep link (notification tap → /?find=<series>): apply the query and jump to the first
  // upcoming day that matches, so a "New series" alert lands on the series itself.
  useEffect(() => {
    if (initialSearch == null) return;
    setSearch(initialSearch);
    const q = initialSearch.trim().toLowerCase();
    if (q) {
      const today = getToday();
      const dates = (allTournaments || [])
        .filter(t => [t.event_name, t.venue, t.notes, t.game_variant]
          .some(f => f && String(f).toLowerCase().includes(q)))
        .map(t => normaliseDate(t.date))
        .filter(d => d && d >= today)
        .sort();
      if (dates.length) setSelectedDate(dates[0]);
    }
    if (onSearchConsumed) onSearchConsumed();
  }, [initialSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const allDates = useMemo(() => buildAllDates(allTournaments), [allTournaments]);
  // Per-day event counts for the strip's density mark.
  const dateCounts = React.useMemo(() => {
    const m = {};
    for (const t of (searchedTournaments || [])) {
      const d = normaliseDate(t.date);
      if (d) m[d] = (m[d] || 0) + 1;
    }
    return m;
  }, [searchedTournaments]);
  const maxDateCount = React.useMemo(
    () => Object.values(dateCounts).reduce((a, b) => Math.max(a, b), 0) || 1,
    [dateCounts]);
  const today = getToday();
  const defaultDate = allDates.includes(today) ? today : allDates[0] || today;
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const activeDateRef = useRef(null);
  const [focusEventId, setFocusEventId] = useState(null);

  // Always snap to today when the tab is visited
  useEffect(() => {
    const t = getToday();
    if (allDates.includes(t)) setSelectedDate(t);
  }, []);

  // Track direction of last month change so the month row slides in
  // from the appropriate side (next → from right, prev → from left).
  const monthDirRef = useRef('next');
  const lastMonthKeyRef = useRef(null);
  {
    const selObj = new Date(selectedDate + 'T12:00:00');
    const curKey = `${selObj.getFullYear()}-${selObj.getMonth()}`;
    if (lastMonthKeyRef.current && lastMonthKeyRef.current !== curKey) {
      const [py, pm] = lastMonthKeyRef.current.split('-').map(Number);
      const [cy, cm] = curKey.split('-').map(Number);
      monthDirRef.current = (cy * 12 + cm) >= (py * 12 + pm) ? 'next' : 'prev';
    }
    lastMonthKeyRef.current = curKey;
  }

  // Scroll the active date into the strip's third slot (two days back, three
  // ahead), resting on the grid. The strip shows six 5g buttons on a 6g pitch
  // starting at 1g, so it may only rest at whole multiples of that pitch - the
  // same points its scroll-snap uses. scrollIntoView({inline:'center'}) aimed
  // the button's centre at the strip's centre (18.5g), a half-pitch off every
  // line, and left the snap to pull it somewhere else. The pitch is read from
  // the laid-out buttons (fractional rects, not rounded offsetLeft) so the
  // target is exactly k x 6g at any width.
  const stripRef = useRef(null);
  const stripPitch = (strip) => (strip && strip.children.length >= 2)
    ? strip.children[1].getBoundingClientRect().left - strip.children[0].getBoundingClientRect().left
    : 0;
  useEffect(() => {
    const btn = activeDateRef.current;
    const strip = stripRef.current;
    const pitch = stripPitch(strip);
    if (!btn || !(pitch > 0)) return;
    const idx = Array.prototype.indexOf.call(strip.children, btn);
    const maxK = Math.round((strip.scrollWidth - strip.clientWidth) / pitch);
    const k = Math.max(0, Math.min(maxK, idx - 2));
    strip.scrollTo({ left: k * pitch, behavior: 'smooth' });
  }, [selectedDate, allDates.length]);

  // WebKit keeps a scroller's offset in WHOLE px, so a rest at k x 6g
  // (6g = 65.19px at 402) lands up to half a px short or long - measured 130px
  // for 12g = 130.38px, putting every button 0.035g off its line. When the strip
  // comes to rest, carry that remainder as a translate on the buttons, in g
  // (--cal-strip-fix), so what is drawn sits exactly on k x 6g. Recomputed on
  // every rest, so it never accumulates; |fix| <= 0.5px, invisible mid-scroll.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    let t = null;
    const settle = () => {
      const pitch = stripPitch(strip);
      if (!(pitch > 0)) return;
      const g = pitch / 6; // the pitch is 6g by construction (styles.css .cal-date-strip)
      const off = (strip.scrollLeft - Math.round(strip.scrollLeft / pitch) * pitch) / g;
      // Only the rounding remainder (<= half a px, ~0.05g) is corrected; a bigger
      // offset means the strip is still moving, and gets no fix.
      strip.style.setProperty('--cal-strip-fix', `calc(var(--gu) * ${Math.abs(off) <= 0.1 ? off.toFixed(4) : 0})`);
    };
    const onScroll = () => { clearTimeout(t); t = setTimeout(settle, 120); };
    strip.addEventListener('scroll', onScroll, { passive: true });
    settle();
    return () => { clearTimeout(t); strip.removeEventListener('scroll', onScroll); };
  }, [allDates.length]);

  // Reset the page scroll when the selected date changes so the new
  // day's events always start at the top of the viewport (just below
  // the sticky filters). Without this, the previous day's scroll
  // position carries over and the new events can render below the fold.
  useEffect(() => {
    const container = document.querySelector('.content-area');
    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedDate]);

  const [filters, setFilters] = useState(() => {
    // Restore previously-chosen location from localStorage so users don't have
    // to re-enter distance/region on every launch.
    const savedLoc = readLocalLocation() || {};
    // The online choices made on the Schedule tab (the Online switch, per-room rules, "available
    // in my state") are saved there; start from them so this tab lists the same online events.
    const savedFilters = readLocalFilters() || {};
    return {
      minBuyin: '', maxBuyin: '', buyinRanges: [], rakeRanges: [], selectedGames: [],
      hiddenVenues: [], bountyOnly: false, mysteryBountyOnly: false, headsUpOnly: false,
      tagTeamOnly: false, employeesOnly: false, hideSatellites: true, hideRestarts: true,
      hideSideEvents: false,
      // Must match TournamentsView's DEFAULT_FILTERS: the two views filter the same
      // tournaments from the same array, and a field present in one and absent in the
      // other produces two different lists from identical data.
      showOnline: savedFilters.showOnline !== false,
      onlyAvailableOnline: !!savedFilters.onlyAvailableOnline,
      siteRules: savedFilters.siteRules || {},
      maxDistance: savedLoc.maxDistance || '',
      userLocation: savedLoc.userLocation || null,
      locationRegion: savedLoc.locationRegion || null,
      locationLabel: savedLoc.locationLabel || null,
      jurisdiction: savedLoc.jurisdiction || null,
      jurisdictionManual: !!savedLoc.jurisdictionManual,
    };
  });
  // Persist location selection across sessions
  useEffect(() => {
    const { userLocation, locationRegion, maxDistance, locationLabel, jurisdiction, jurisdictionManual } = filters;
    const loc = { userLocation, locationRegion, maxDistance, locationLabel, jurisdiction, jurisdictionManual };
    writeLocalLocation(loc);
    // Follows the user: localStorage is per-browser, so without this a region
    // picked on the desktop does not exist on the phone.
    pushServerLocation(token, loc);
  }, [filters.userLocation, filters.locationRegion, filters.maxDistance, filters.locationLabel, filters.jurisdiction, filters.jurisdictionManual]);
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


  const buyinOptions = useMemo(() =>
    [...new Set(allTournaments.map(t => parseInt(t.buyin, 10)).filter(n => n > 0 && !isNaN(n)))].sort((a, b) => a - b),
    [allTournaments]
  );

  // Map normalised date -> all tournaments
  const byDate = useMemo(() => {
    const map = {};
    for (const t of (searchedTournaments || [])) {
      const key = normaliseDate(t.date);
      if (!map[key]) map[key] = [];
      map[key].push(t);
    }
    return map;
  }, [searchedTournaments]);

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

  // Per-date "representative" scheduled event: the priority/anchor
  // event takes precedence; otherwise the first chronological one.
  // Used to colour the date carousel buttons by venue brand.
  const myScheduleByDate = useMemo(() => {
    const buckets = {};
    for (const t of mySchedule) {
      const d = normaliseDate(t.date);
      if (!d) continue;
      (buckets[d] = buckets[d] || []).push(t);
    }
    const out = {};
    for (const d of Object.keys(buckets)) {
      // Decorate-sort-undecorate so parseTournamentTime fires once per row.
      const decorated = buckets[d].map(t => ({ t, ts: parseTournamentTime(t) }));
      decorated.sort((a, b) => {
        if (!!a.t.is_anchor !== !!b.t.is_anchor) return a.t.is_anchor ? -1 : 1;
        return a.ts - b.ts;
      });
      out[d] = decorated[0]?.t;
    }
    return out;
  }, [mySchedule]);

  // Hide series that have ended (2 days after their last Day 1 / flight)
  const calEndedVenues = useMemo(() => {
    const todayISO = getToday();
    const lastDay1ByVenue = {};
    for (const t of allTournaments) {
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
      if (todayISO > `${cy}-${cm}-${cd}`) ended.add(venue);
    }
    return ended;
  }, [allTournaments]);

  const selDateObj = new Date(selectedDate + 'T12:00:00');
  const todayEvents = byDate[selectedDate] || [];

  // Filter + sort by time
  const sortedEvents = useMemo(() => {
    return [...todayEvents]
      .filter(t => {
        if (calEndedVenues.has(t.venue)) return false;
        if (filters.minBuyin && t.buyin < Number(filters.minBuyin)) return false;
        if (filters.maxBuyin && t.buyin > Number(filters.maxBuyin)) return false;
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
        if (filters.selectedGames.length > 0 && !filters.selectedGames.includes(t.game_variant)) return false;
        if (filters.hiddenVenues && filters.hiddenVenues.length > 0 && filters.hiddenVenues.includes(t.venue)) return false;
        // Both location filters treat an unknown location the same way: it can't be shown
        // to match, so it's excluded. Previously distance kept un-located events (listing
        // events nationwide under "within 50 miles") while region dropped them.
        // Online events have no place, so the location tests below cannot speak for them;
        // they are governed by the Online switch instead. Same rule as matchesLocation().
        if (isOnline(t)) {
          if (filters.showOnline === false) return false;
          /* Same predicate as matchesOnline()'s availability arm. Open-coded
             here only because the rest of this block is; the two views must
             agree or the same data produces two lists. */
          if (filters.onlyAvailableOnline && filters.jurisdiction
              && !isSiteAvailable(t.site, filters.jurisdiction)) return false;
          // Per-room rules — the SAME function matchesOnline calls.
          if (!passesSiteRule(t, filters.siteRules && t.site ? filters.siteRules[t.site] : null)) return false;
        }
        if (!isOnline(t) && filters.maxDistance && filters.userLocation) {
          const coords = getVenueCoords(t.venue, t.property);
          if (!coords) return false;
          const dist = haversineDistance(filters.userLocation.lat, filters.userLocation.lng, coords.lat, coords.lng);
          if (dist > Number(filters.maxDistance)) return false;
        }
        if (!isOnline(t) && filters.locationRegion) {
          const coords = getVenueCoords(t.venue, t.property);
          const regionDef = typeof LOCATION_REGIONS !== 'undefined' && LOCATION_REGIONS[filters.locationRegion];
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
        if (filters.hideSideEvents && isSideEvent(t)) return false;
        return true;
      })
      .sort((a, b) => {
        const ta = a.venue ? parseDateTimeInTz(a.date, a.time, a.venue) : parseDateTime(a.date, (a.time || '').replace(/\s*GMT\s*$/i, ''));
        const tb = b.venue ? parseDateTimeInTz(b.date, b.time, b.venue) : parseDateTime(b.date, (b.time || '').replace(/\s*GMT\s*$/i, ''));
        if (ta !== tb) return ta - tb;
        const na = (a.event_number || '').startsWith('SAT') ? 10000 + parseInt((a.event_number || '').slice(4)) : (parseInt(a.event_number) || 9999);
        const nb = (b.event_number || '').startsWith('SAT') ? 10000 + parseInt((b.event_number || '').slice(4)) : (parseInt(b.event_number) || 9999);
        return na - nb;
      });
  }, [todayEvents, filters, calEndedVenues]);

  const myTodayCount = sortedEvents.filter(t => scheduleIds.has(t.id)).length;

  // Split events for "My Events" section on today's date
  const isToday = selectedDate === getToday();
  const myEvents = useMemo(() => sortedEvents.filter(t => scheduleIds.has(t.id)), [sortedEvents, scheduleIds]);
  const otherEvents = useMemo(() => sortedEvents.filter(t => !scheduleIds.has(t.id)), [sortedEvents, scheduleIds]);
  const showMySection = isToday && myEvents.length > 0;

  const renderEvent = (t) => (
    <CalendarEventRow
      key={t.id}
      tournament={t}
      isInSchedule={scheduleIds.has(t.id)}
      onToggle={onToggle}
      showMiniLateReg={selectedDate === today}
      isPast={selectedDate < today}
      focusEventId={focusEventId}
      onNavigateToEvent={(num, sat) => {
        const flights = allTournaments.filter(f => f.event_number === num);
        const best = findClosestFlight(flights, parseTournamentTime(sat));
        if (best) {
          if (best.date !== selectedDate) setSelectedDate(best.date);
          setFocusEventId(null);
          setTimeout(() => setFocusEventId(best.id), 50);
        }
      }}
      conditions={conditionMap[t.id] || []}
      onSetCondition={onSetCondition}
      onRemoveCondition={onRemoveCondition}
      allTournaments={allTournaments}
      isAnchor={anchorSet.has(t.id)}
      onToggleAnchor={onToggleAnchor}
      plannedEntries={plannedEntriesMap[t.id] || 1}
      onSetPlannedEntries={onSetPlannedEntries}
      buddyEvents={buddyEvents}
      buddyLiveUpdates={buddyLiveUpdates}
      scheduleIds={scheduleIds}
    />
  );

  function move(dir) {
    const idx = allDates.indexOf(selectedDate);
    const next = idx + dir;
    if (next >= 0 && next < allDates.length) setSelectedDate(allDates[next]);
  }

  return (
    <div>
      <div className="sticky-filters">
        {/* Month row: calendar-icon date picker on the left, then three
            month buttons — previous (muted), current (full name),
            next. Clicking prev/next jumps to the first available date
            in that month. Past months are still clickable (so the user
            can scroll backwards), but rendered muted. */}
        {(() => {
          const curY = selDateObj.getFullYear();
          const curM = selDateObj.getMonth();
          const prev = new Date(curY, curM - 1, 1);
          const next = new Date(curY, curM + 1, 1);
          const todayISO = getToday();
          const findInMonth = (y, m) => {
            const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
            // Prefer today's date in the month, else first date in month
            const inMonth = allDates.filter(d => d.startsWith(ym));
            if (inMonth.length === 0) return null;
            const future = inMonth.find(d => d >= todayISO);
            return future || inMonth[0];
          };
          const jumpTo = (y, m) => {
            const target = findInMonth(y, m);
            if (target) setSelectedDate(target);
          };
          const prevTarget = findInMonth(prev.getFullYear(), prev.getMonth());
          const nextTarget = findInMonth(next.getFullYear(), next.getMonth());
          // Last day of the previous month, formatted in LOCAL date.
          const lastDayPrev = new Date(prev.getFullYear(), prev.getMonth() + 1, 0);
          const lpY = lastDayPrev.getFullYear();
          const lpM = String(lastDayPrev.getMonth() + 1).padStart(2, '0');
          const lpD = String(lastDayPrev.getDate()).padStart(2, '0');
          const monthPast = `${lpY}-${lpM}-${lpD}` < todayISO;
          return (
            <div
              key={`${curY}-${curM}`}
              className="cal-month-row"
              data-direction={monthDirRef.current}
            >
              {/* Far left of the month row: the date-picker (swapped with the
                  schedule-list button, now on the right). The icon is decorative;
                  the <input type="date"> is overlaid invisibly with
                  pointer-events:auto so a tap hits the input and iOS opens its
                  native picker directly. */}
              <div
                className="cal-month-icon-btn"
                title="Pick a date"
                style={{position: 'relative'}}
              >
                <Icon.pointer />
                <input
                  type="date"
                  value={selectedDate}
                  min={allDates[0]}
                  max={allDates[allDates.length - 1]}
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={e => {
                    const v = e.target.value;
                    if (!v) return;
                    if (allDates.includes(v)) {
                      setSelectedDate(v);
                    } else {
                      const later = allDates.find(d => d >= v);
                      const earlier = [...allDates].reverse().find(d => d <= v);
                      setSelectedDate(later || earlier || allDates[0]);
                    }
                    e.target.blur();
                  }}
                  style={{
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    opacity: 0, border: 'none',
                    background: 'transparent', cursor: 'pointer',
                    pointerEvents: 'auto',
                  }}
                />
              </div>
              <div className="cal-month-row-buttons">
                <button
                  className={`cal-month-btn cal-month-btn-side ${monthPast ? 'muted' : ''}`}
                  onClick={() => prevTarget && jumpTo(prev.getFullYear(), prev.getMonth())}
                  disabled={!prevTarget}
                  title={`Jump to ${MONTHS[prev.getMonth()]} ${prev.getFullYear()}`}
                >
                  <span className="cal-month-label">{MONTHS[prev.getMonth()]}</span>
                </button>
                <span className="cal-month-btn cal-month-btn-current">
                  <span className="cal-month-label">{MONTHS_FULL[curM]} {curY}</span>
                </span>
                <button
                  className="cal-month-btn cal-month-btn-side"
                  onClick={() => nextTarget && jumpTo(next.getFullYear(), next.getMonth())}
                  disabled={!nextTarget}
                  title={`Jump to ${MONTHS[next.getMonth()]} ${next.getFullYear()}`}
                >
                  <span className="cal-month-label">{MONTHS[next.getMonth()]}</span>
                </button>
              </div>
              {/* Far right of the month row: jump to the Schedule tab's list view
                  (swapped with the date-picker, now on the left). */}
              <button
                type="button"
                className="cal-month-icon-btn"
                title="Switch to schedule list"
                onClick={() => onOpenScheduleView && onOpenScheduleView()}
              >
                <Icon.list />
              </button>
            </div>
          );
        })()}

        {/* Scrollable date strip — date buttons. If the user has an
            event in their schedule on this date, the button border
            takes the venue brand color of the priority event (or, if
            no priority is set, the first chronological event). */}
        {/* One pass for the per-day counts, off the same list the strip
            already walks - this is the information the control was missing. */}
        {null}
        <div className="cal-date-strip" ref={stripRef}>
          {allDates.map(d => {
            const dObj = new Date(d + 'T12:00:00');
            const isSel = d === selectedDate;
            const myEvent = myScheduleByDate[d];
            const venueColor = myEvent
              ? getVenueBrandColor(getVenueInfo(myEvent.venue, myEvent.property).abbr)
              : null;
            // The user's-event signal moves off the border so the active
            // state's own border stays unambiguous - the two used to compete.
            const density = dateCounts[d] ? Math.min(1, dateCounts[d] / maxDateCount) : 0;
            return (
              <button
                key={d}
                ref={isSel ? activeDateRef : null}
                className={`cal-date-btn ${isSel ? 'active' : ''} ${myEvent ? 'has-mine' : ''}`}
                onClick={() => setSelectedDate(d)}
              >
                {venueColor && <span className="cal-date-mine" style={{background: venueColor}} aria-hidden="true" />}
                <span className="dow">{DOW[dObj.getDay()]}</span>
                <span className="dom">{dObj.getDate()}</span>
                <span className="cal-date-density" aria-hidden="true">
                  <span className="cal-date-density-track">
                    <span style={{width: `${Math.round(density * 100)}%`}} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom row below the carousel:
              [Today icon-btn]   [centered events count]   [Filter btn]
            Today jumps the selection to today (or the next available
            date if today has no events). Disabled when already on
            target. Filter is the same Filters component that lived in
            the month row earlier. */}
        <div className="cal-bottom-row">
          {(() => {
            const todayISO = getToday();
            const target = allDates.includes(todayISO)
              ? todayISO
              : (allDates.find(d => d >= todayISO) || allDates[allDates.length - 1]);
            const onTarget = !target || selectedDate === target;
            return (
              <button
                type="button"
                className="cal-month-icon-btn cal-month-today-btn"
                title={allDates.includes(todayISO) ? 'Jump to today' : 'Jump to next event'}
                disabled={onTarget}
                onClick={() => target && setSelectedDate(target)}
              >
                <Icon.calendarCheck />
              </button>
            );
          })()}
          <span className="cal-event-count cal-event-count-inline">
            <span className="cal-event-count-text">
              {sortedEvents.length} event{sortedEvents.length !== 1 ? 's' : ''}
              {myTodayCount > 0 && ` · ${myTodayCount} in my schedule`}
            </span>
          </span>
          <Filters filters={filters} setFilters={setFilters} gameVariants={gameVariants || []} venues={venues || []} buyinOptions={buyinOptions} tournaments={allTournaments} search={search} setSearch={setSearch} />
        </div>

      </div>

      {sortedEvents.length === 0 ? (
        <div className="empty-state cal-empty">
          <Icon.empty />
          <h3>No events on this date</h3>
          <p>Other dates in this range have events — try moving forward or back.</p>
        </div>
      ) : showMySection ? (
        <div style={{minHeight:'100vh', paddingTop:'var(--subrow)', paddingBottom:'100vh'}}>
          {/* No top margin: the list's 1r top pad is the whole gap under the
              sticky block (r29), so this header sits r30-r34 like a first card. */}
          <div className="section-header cal-list-section-header">
            <h2>My Events</h2>
            <span className="cal-list-section-count">{myEvents.length} event{myEvents.length !== 1 ? 's' : ''}</span>
          </div>
          {myEvents.map(renderEvent)}

          {otherEvents.length > 0 && (
            <React.Fragment>
              <div className="section-header cal-list-section-header" style={{marginTop:'calc(var(--subrow) * 2)'}}>
                <h2>All Events</h2>
                <span className="cal-list-section-count">{otherEvents.length} event{otherEvents.length !== 1 ? 's' : ''}</span>
              </div>
              {otherEvents.map(renderEvent)}
            </React.Fragment>
          )}
        </div>
      ) : (
        <div style={{minHeight:'100vh', paddingTop:'var(--subrow)', paddingBottom:'100vh'}}>
          {sortedEvents.map(renderEvent)}
        </div>
      )}

    </div>
  );
}
