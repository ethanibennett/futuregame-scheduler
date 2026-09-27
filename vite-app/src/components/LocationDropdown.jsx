import React, { useState, useRef, useCallback } from 'react';
import { LOCATION_REGIONS } from '../utils/utils.js';
import { US_STATES, stateCodeFrom } from '../utils/online-sites.js';
import { API_URL } from '../utils/api.js';
import Icon from './Icon.jsx';

// ── Location Dropdown ────────────────────────────────────────
// Shared between Schedule (TournamentsView) and Calendar (CalendarView).
// `setFilters` may be a plain setter or one wrapped to trigger
// scroll-to-today after a filter change — both work the same way from
// here.
export default function LocationDropdown({ rect, filters, setFilters, onClose, toast, token, pointOnly = false }) {
  const [geoQuery, setGeoQuery] = useState('');
  const [geoResults, setGeoResults] = useState([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [radius, setRadius] = useState(filters.maxDistance || '100');
  const searchTimerRef = useRef(null);

  const doGeoSearch = useCallback((q) => {
    if (!q || q.length < 2) { setGeoResults([]); return; }
    setGeoLoading(true);
    fetch(`${API_URL}/geocode?q=${encodeURIComponent(q)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => { setGeoResults(data.results || []); setGeoLoading(false); })
      .catch(() => { setGeoLoading(false); });
  }, [token]);

  const onQueryChange = (val) => {
    setGeoQuery(val);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => doGeoSearch(val), 400);
  };

  /* Where the user IS decides which online rooms they can enter, so a location
     the user sets by hand also answers the jurisdiction question — unless they
     have answered it themselves. A manual pick outranks a derived one in both
     directions: someone registered in Nevada and sitting in an airport in Ohio
     wants the Nevada answer, and a lookup must not quietly take it away. */
  const learnJurisdiction = (f, code) => (
    !code || f.jurisdictionManual ? f : { ...f, jurisdiction: code }
  );

  const selectGeoResult = (r) => {
    setFilters(f => learnJurisdiction({
      ...f,
      userLocation: { lat: r.lat, lng: r.lng },
      maxDistance: radius || '100',
      locationRegion: null,
      locationLabel: r.short || r.display,
    }, r.country === 'US' ? stateCodeFrom(r.region) : null));
    onClose();
  };

  /* Browser geolocation gives coordinates and nothing else. One reverse lookup
     turns them into a state. It runs after the location is already set and
     never blocks it: if it fails, the radius filter still works and the
     availability toggle is simply left without an answer. */
  const reverseLookup = (lat, lng) => {
    fetch(`${API_URL}/geocode/reverse?lat=${lat}&lng=${lng}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => {
        const code = d && d.country === 'US' ? stateCodeFrom(d.region) : null;
        if (code) setFilters(f => learnJurisdiction(f, code));
      })
      .catch(() => { /* the location stands; only the state is unknown */ });
  };

  return (
    /* The panel that opens this is portalled to document.body, and so is this
       — so a click in here is not inside the panel's DOM and its outside-click
       handler read every tap as a tap outside. The mark is what tells it
       otherwise. */
    <div className="location-dropdown" data-filter-portal="" style={{
      position:'fixed', top: rect.bottom + 4, left: rect.left,
      // var(--z-panel), not a 999 literal: an off-scale number is what the
      // layer tokens were introduced to end, and this one only happened to be
      // above the scrim.
      zIndex:'var(--z-panel)', background:'var(--surface)', border:'var(--bw-hair) solid var(--border)',
      borderRadius:'var(--radius)', padding:'calc(var(--subrow) * 0.75) 0', minWidth:'calc(var(--subrow) * 30)', maxWidth:'calc(var(--subrow) * 40)',
      boxShadow:'var(--elev-2)',
    }}>
      <div style={{padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1.25) calc(var(--subrow) * 1)'}}>
        <div style={{display:'flex',gap:'calc(var(--subrow) * 0.75)',alignItems:'center',marginBottom:'calc(var(--subrow) * 0.75)'}}>
          <input type="text" value={geoQuery} onChange={e => onQueryChange(e.target.value)}
            placeholder="City or postal code..." autoFocus
            style={{flex:1,padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.208)',background:'var(--bg)',color:'var(--text)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius)',outline:'none',minWidth:0}} />
          <input type="number" value={radius}
            onChange={e => {
              setRadius(e.target.value);
              if (filters.userLocation) {
                setFilters(f => ({...f, maxDistance: e.target.value}));
              }
            }}
            style={{width:'calc(var(--subrow) * 6.25)',padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 0.5)',fontSize:'calc(var(--gu) * 1.208)',textAlign:'center',background:'var(--bg)',color:'var(--text)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius)'}}
            min="1" placeholder="100" />
          <span style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',flexShrink:0}}>mi</span>
        </div>
        {geoLoading && <div style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',padding:'calc(var(--subrow) * 0.25) 0'}}>Searching...</div>}
        {geoResults.length > 0 && (
          <div style={{maxHeight:'calc(var(--subrow) * 18.75)',overflowY:'auto'}}>
            {geoResults.map((r, i) => (
              <button key={i} onClick={() => selectGeoResult(r)} style={{
                display:'block',width:'100%',padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 0.5)',background:'none',border:'none',
                color:'var(--text)',fontSize:'calc(var(--gu) * 1.149)',cursor:'pointer',textAlign:'left',borderRadius:'calc(var(--subrow) * 0.5)',
              }}>
                {r.short || r.display}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{height:1,background:'var(--border)',margin:'calc(var(--subrow) * 0.25) 0'}} />
      <button onClick={() => {
        if (filters.userLocation && !filters.locationRegion) {
          setFilters(f => ({...f, userLocation: null, maxDistance: '', locationRegion: null, locationLabel: null}));
          onClose();
        } else {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setFilters(f => ({...f, userLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude }, maxDistance: radius || '100', locationRegion: null, locationLabel: 'Current Location'}));
                reverseLookup(pos.coords.latitude, pos.coords.longitude);
                onClose();
              },
              () => { toast.error('Could not get your location'); },
              { enableHighAccuracy: false, timeout: 10000 }
            );
          } else {
            toast.error('Geolocation not supported');
          }
        }
      }} style={{
        display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 1)',width:'100%',
        padding:'var(--space-lg) var(--space-xl)',background:'none',border:'none',
        color: (filters.userLocation && !filters.locationRegion) ? 'var(--accent)' : 'var(--text)',
        fontWeight: (filters.userLocation && !filters.locationRegion) ? 700 : 400,
        fontSize:'calc(var(--gu) * 1.252)',cursor:'pointer',textAlign:'left',
      }}>
        <span style={{width:'calc(var(--subrow) * 2)',height:'calc(var(--subrow) * 2)',flexShrink:0}}><Icon.mapPin /></span>
        Current Location
        {(filters.userLocation && !filters.locationRegion) && <span style={{marginLeft:'auto',fontSize:'calc(var(--gu) * 1.104)'}}>{'✓'}</span>}
      </button>
      <div style={{height:1,background:'var(--border)',margin:'calc(var(--subrow) * 0.25) 0'}} />
      {!pointOnly && Object.entries(LOCATION_REGIONS).map(([key, { label }]) => (
        <button key={key} onClick={() => {
          setFilters(f => ({...f, locationRegion: f.locationRegion === key ? null : key, userLocation: null, maxDistance: '', locationLabel: null}));
          onClose();
        }} style={{
          display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 1)',width:'100%',
          padding:'var(--space-lg) var(--space-xl)',background:'none',border:'none',
          color: filters.locationRegion === key ? 'var(--accent)' : 'var(--text)',
          fontWeight: filters.locationRegion === key ? 700 : 400,
          fontSize:'calc(var(--gu) * 1.252)',cursor:'pointer',textAlign:'left',
        }}>
          <span style={{width:'calc(var(--subrow) * 2)',height:'calc(var(--subrow) * 2)',flexShrink:0}}><Icon.mapPin /></span>
          {label}
          {filters.locationRegion === key && <span style={{marginLeft:'auto',fontSize:'calc(var(--gu) * 1.104)'}}>{'✓'}</span>}
        </button>
      ))}
      {/* Jurisdiction. Physically separate from the region buttons above it
          because it answers a different question: those filter which VENUES to
          show, this one says which state's rules apply to the user. The two are
          usually the same place and occasionally not, which is exactly why the
          override exists. Hidden in pointOnly mode (Cash) — the cash location is
          a single poll point for the watcher, not a jurisdiction question. */}
      {!pointOnly && (<>
      <div style={{height:1,background:'var(--border)',margin:'calc(var(--subrow) * 0.25) 0'}} />
      <div style={{padding:'var(--space-lg) var(--space-xl)'}}>
        <label htmlFor="jurisdiction-select" style={{
          display:'block',fontSize:'calc(var(--gu) * 1.031)',letterSpacing:'0.06em',textTransform:'uppercase',
          color:'var(--text-muted)',marginBottom:'calc(var(--subrow) * 0.75)',
        }}>
          Your state {filters.jurisdiction && !filters.jurisdictionManual && (
            <span style={{textTransform:'none',letterSpacing:0}}>· from location</span>
          )}
        </label>
        <select id="jurisdiction-select" value={filters.jurisdiction || ''}
          onChange={e => {
            const v = e.target.value || null;
            setFilters(f => ({ ...f, jurisdiction: v, jurisdictionManual: !!v }));
          }}
          style={{
            width:'100%',padding:'calc(var(--subrow) * 0.75) calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.208)',background:'var(--bg)',
            color:'var(--text)',border:'var(--bw-hair) solid var(--border)',
            borderRadius:'var(--radius)',outline:'none',
          }}>
          <option value="">Not set</option>
          {US_STATES.map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
        <div style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',marginTop:'calc(var(--subrow) * 0.75)',lineHeight:1.4}}>
          Decides which online rooms are marked available to you.
        </div>
      </div>
      </>)}
      {(filters.locationRegion || filters.userLocation) && (
        <>
          <div style={{height:1,background:'var(--border)',margin:'calc(var(--subrow) * 0.25) 0'}} />
          <button onClick={() => {
            setFilters(f => ({...f, locationRegion: null, userLocation: null, maxDistance: '', locationLabel: null}));
            onClose();
          }} style={{
            display:'block',width:'100%',padding:'var(--space-lg) var(--space-xl)',
            background:'none',border:'none',color:'var(--text-muted)',
            fontSize:'calc(var(--gu) * 1.178)',cursor:'pointer',textAlign:'left',
          }}>
            Clear location filter
          </button>
        </>
      )}
      {!pointOnly && <div style={{height:1,background:'var(--border)',margin:'calc(var(--subrow) * 0.25) 0'}} />}
      {!pointOnly && <button onClick={() => { window.dispatchEvent(new Event('reopen-onboarding')); onClose(); }} style={{
        display:'block',width:'100%',padding:'var(--space-lg) var(--space-xl)',
        background:'none',border:'none',color:'var(--text-muted)',
        fontSize:'calc(var(--gu) * 1.178)',cursor:'pointer',textAlign:'left',
      }}>
        Re-run filter setup
      </button>}
    </div>
  );
}
