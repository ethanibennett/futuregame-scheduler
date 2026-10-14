import React, { useState, useRef, useCallback } from 'react';
import { LOCATION_REGIONS, REGION_JURISDICTION } from '../utils/utils.js';
import { US_STATES, stateCodeFrom } from '../utils/online-sites.js';
import { API_URL } from '../utils/api.js';
import Icon from './Icon.jsx';

// A divider: a 1r row with the hairline across its middle, so the rows after it stay on r lines.
const DIVIDER = { height: 'var(--subrow)', background: 'linear-gradient(var(--border), var(--border)) center / 100% var(--bw-hair) no-repeat' };
// A menu row: 5r, its label centred vertically (a row's label is set at the start by design).
const ROW = { display: 'flex', alignItems: 'center', width: '100%', height: 'calc(var(--subrow) * 5)', boxSizing: 'border-box', lineHeight: 1 };

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
    /* On the grid (owner rule, 2026-10-10): the field's own 26g, its left edge (the field sits on a
       g line), 1r under it. Every row inside is whole r — the search row 6r, each item 5r, each
       divider a 1r row with the hairline drawn across its middle — and the ring is an inset
       shadow, not a border, so the rows start on the panel's own lines. */
    <div className="location-dropdown" data-filter-portal="" style={{
      position:'fixed', top: `calc(${rect.bottom}px + var(--subrow))`, left: rect.left,
      // var(--z-panel), not a 999 literal: an off-scale number is what the
      // layer tokens were introduced to end, and this one only happened to be
      // above the scrim.
      zIndex:'var(--z-panel)', background:'var(--surface)',
      borderRadius:'var(--radius)', padding:0, width:'calc(var(--gu) * 26)', boxSizing:'border-box',
      boxShadow:'inset 0 0 0 var(--bw-hair) var(--border), var(--elev-2)',
    }}>
      <div style={{padding:'var(--subrow) var(--gu)'}}>
        <div style={{display:'flex',gap:'calc(var(--subrow) * 0.75)',alignItems:'center',height:'calc(var(--subrow) * 4)',marginBottom: geoLoading || geoResults.length > 0 ? 'var(--subrow)' : 0}}>
          <input type="text" value={geoQuery} onChange={e => onQueryChange(e.target.value)}
            placeholder="City or postal code..." autoFocus
            style={{flex:1,height:'calc(var(--subrow) * 4)',boxSizing:'border-box',padding:'0 calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.208)',background:'var(--bg)',color:'var(--text)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius)',outline:'none',minWidth:0}} />
          <input type="number" value={radius}
            onChange={e => {
              setRadius(e.target.value);
              if (filters.userLocation) {
                setFilters(f => ({...f, maxDistance: e.target.value}));
              }
            }}
            style={{width:'calc(var(--subrow) * 6.25)',height:'calc(var(--subrow) * 4)',boxSizing:'border-box',padding:'0 calc(var(--subrow) * 0.5)',fontSize:'calc(var(--gu) * 1.208)',textAlign:'center',background:'var(--bg)',color:'var(--text)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius)'}}
            min="1" placeholder="100" />
          <span style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',flexShrink:0}}>mi</span>
        </div>
        {geoLoading && <div style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',lineHeight:'calc(var(--subrow) * 2)'}}>Searching...</div>}
        {geoResults.length > 0 && (
          <div style={{maxHeight:'calc(var(--subrow) * 20)',overflowY:'auto'}}>
            {geoResults.map((r, i) => (
              <button key={i} onClick={() => selectGeoResult(r)} style={{
                // One 4r line (a long place name ends in an ellipsis): the line box is the row, so
                // the name sits in its middle.
                display:'block',width:'100%',height:'calc(var(--subrow) * 4)',boxSizing:'border-box',lineHeight:'calc(var(--subrow) * 4)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',padding:'0 calc(var(--subrow) * 0.5)',background:'none',border:'none',
                color:'var(--text)',fontSize:'calc(var(--gu) * 1.149)',cursor:'pointer',textAlign:'left',borderRadius:'calc(var(--subrow) * 0.5)',
              }}>
                {r.short || r.display}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={DIVIDER} />
      <button onClick={() => {
        if (filters.userLocation && !filters.locationRegion) {
          setFilters(f => ({...f, userLocation: null, maxDistance: '', locationRegion: null, locationLabel: null}));
          onClose();
        } else {
          /* WebKit only grants geolocation to a secure page. The installed app
             (capacitor:// or https) is one; a live-reload build served over
             http from a LAN/Tailscale address is not, and fails before iOS even
             asks — so say that rather than a bare "could not get". */
          if (typeof window !== 'undefined' && window.isSecureContext === false) {
            toast.error('Location needs a secure page. It works in the installed app, not over the http dev server.');
          } else if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setFilters(f => ({...f, userLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude }, maxDistance: radius || '100', locationRegion: null, locationLabel: 'Current Location'}));
                reverseLookup(pos.coords.latitude, pos.coords.longitude);
                onClose();
              },
              (err) => {
                // The three GeolocationPositionError codes each need a different fix.
                const why = err && err.code === 1 ? 'Location permission is off for futurega.me (Settings → Privacy → Location Services).'
                  : err && err.code === 2 ? 'No location fix available. In the iOS Simulator, set one under Features → Location.'
                  : err && err.code === 3 ? 'Timed out getting your location. Try again.'
                  : 'Could not get your location.';
                toast.error(why);
              },
              { enableHighAccuracy: false, timeout: 10000 }
            );
          } else {
            toast.error('Geolocation not supported');
          }
        }
      }} style={{
        ...ROW,gap:'calc(var(--subrow) * 1)',
        padding:'0 var(--space-xl)',background:'none',border:'none',
        color: (filters.userLocation && !filters.locationRegion) ? 'var(--accent)' : 'var(--text)',
        fontWeight: (filters.userLocation && !filters.locationRegion) ? 700 : 400,
        fontSize:'calc(var(--gu) * 1.252)',cursor:'pointer',textAlign:'left',
      }}>
        <span style={{width:'calc(var(--subrow) * 2)',height:'calc(var(--subrow) * 2)',flexShrink:0}}><Icon.mapPin /></span>
        Current Location
        {(filters.userLocation && !filters.locationRegion) && <span style={{marginLeft:'auto',fontSize:'calc(var(--gu) * 1.104)'}}>{'✓'}</span>}
      </button>
      <div style={DIVIDER} />
      {!pointOnly && Object.entries(LOCATION_REGIONS).map(([key, { label }]) => (
        <button key={key} onClick={() => {
          // A region also answers the state where it implies one (Las Vegas: Nevada), as a place
          // looked up does; a state picked by hand stays.
          setFilters(f => {
            const picking = f.locationRegion !== key;
            const next = {...f, locationRegion: picking ? key : null, userLocation: null, maxDistance: '', locationLabel: null};
            return picking ? learnJurisdiction(next, REGION_JURISDICTION[key] || null) : next;
          });
          onClose();
        }} style={{
          ...ROW,gap:'calc(var(--subrow) * 1)',
          padding:'0 var(--space-xl)',background:'none',border:'none',
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
      <div style={DIVIDER} />
      {/* 1g in from the panel's edges, so the select (a 24g x 4r field) starts on a g line; the
          label above it and the note below are whole-r lines. */}
      <div style={{padding:'var(--subrow) var(--gu)'}}>
        <label htmlFor="jurisdiction-select" style={{
          display:'block',fontSize:'calc(var(--gu) * 1.031)',letterSpacing:'0.06em',textTransform:'uppercase',
          color:'var(--text-muted)',lineHeight:'calc(var(--subrow) * 2)',marginBottom:'var(--subrow)',
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
            display:'block',width:'100%',height:'calc(var(--subrow) * 4)',boxSizing:'border-box',padding:'0 calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.208)',background:'var(--bg)',
            color:'var(--text)',border:'var(--bw-hair) solid var(--border)',
            borderRadius:'var(--radius)',outline:'none',
          }}>
          <option value="">Not set</option>
          {US_STATES.map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
        <div style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',marginTop:'var(--subrow)',lineHeight:'calc(var(--subrow) * 2)'}}>
          Decides which online rooms are marked available to you.
        </div>
      </div>
      </>)}
      {(filters.locationRegion || filters.userLocation) && (
        <>
          <div style={DIVIDER} />
          <button onClick={() => {
            setFilters(f => ({...f, locationRegion: null, userLocation: null, maxDistance: '', locationLabel: null}));
            onClose();
          }} style={{
            ...ROW,padding:'0 var(--space-xl)',
            background:'none',border:'none',color:'var(--text-muted)',
            fontSize:'calc(var(--gu) * 1.178)',cursor:'pointer',textAlign:'left',
          }}>
            Clear location filter
          </button>
        </>
      )}
      {!pointOnly && <div style={DIVIDER} />}
      {!pointOnly && <button onClick={() => { window.dispatchEvent(new Event('reopen-onboarding')); onClose(); }} style={{
        ...ROW,padding:'0 var(--space-xl)',
        background:'none',border:'none',color:'var(--text-muted)',
        fontSize:'calc(var(--gu) * 1.178)',cursor:'pointer',textAlign:'left',
      }}>
        Run setup again
      </button>}
    </div>
  );
}
