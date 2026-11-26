import React, { useState, useRef, useCallback } from 'react';
import { LOCATION_REGIONS, REGION_JURISDICTION } from '../utils/utils.js';
import { placesOf, addPlace, removePlace, togglePlace, setPlaceRadius, withPlaces, placeName, placeText } from '../utils/location-places.js';
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

  /* The Schedule names several places (owner, 2026-11-26: "Philadelphia + 300 miles, Las Vegas + 20
     miles, Hollywood, FL + 30 miles"; utils/location-places.js): a place found here, the device's
     position or a region is ADDED to the list, each point with the radius in the field beside the
     search; the list at the top changes a radius or takes a place off. Only the first place answers
     the state (where the player is); a second place is somewhere they travel to. The Cash tab
     (pointOnly) keeps one point, replaced by each pick. */
  const places = pointOnly ? [] : placesOf(filters);
  const firstPlace = (f) => placesOf(f).length === 0;
  const regionOn = (key) => places.some(p => p.locationRegion === key);
  const currentOn = places.some(p => p.locationLabel === 'Current Location');

  const selectGeoResult = (r) => {
    const place = { userLocation: { lat: r.lat, lng: r.lng }, maxDistance: radius || '100', locationLabel: r.short || r.display };
    const code = r.country === 'US' ? stateCodeFrom(r.region) : null;
    if (pointOnly) {
      setFilters(f => learnJurisdiction({ ...f, ...place, locationRegion: null }, code));
      onClose();
      return;
    }
    setFilters(f => firstPlace(f) ? learnJurisdiction(addPlace(f, place), code) : addPlace(f, place));
    // Stays open: the new place joins the list above, where its radius can change and another follow.
    setGeoQuery('');
    setGeoResults([]);
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
            placeholder={places.length ? 'Add a city or postal code...' : 'City or postal code...'} autoFocus className="focus-inset"
            style={{flex:1,height:'calc(var(--subrow) * 4)',boxSizing:'border-box',padding:'0 calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.208)',background:'var(--bg)',color:'var(--text)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius)',minWidth:0}} />
          <input type="number" value={radius}
            onChange={e => {
              setRadius(e.target.value);
              // On the Schedule this is the next place's radius; each listed place has its own.
              if (pointOnly && filters.userLocation) {
                setFilters(f => ({...f, maxDistance: e.target.value}));
              }
            }}
            aria-label={places.length ? 'Radius for the next place, in miles' : 'Radius in miles'}
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
      {/* The Schedule's places, first one first: each a 5r row with its name, a point's own radius and a
          remove button (3g x the row's 5r, 1g in from the panel's right edge, so it sits on g and r lines). A name that runs long ends in an ellipsis inside a 4r line box, so its
          descenders are painted (the clipping guard's rule). */}
      {places.length > 0 && (
        <>
          {places.map((p, i) => {
            const name = placeName(p, LOCATION_REGIONS);
            return (
              <div key={p.locationRegion || `${p.userLocation.lat},${p.userLocation.lng}`} className="loc-place" style={{ ...ROW, gap: 'calc(var(--subrow) * 1)', padding: '0 var(--gu) 0 var(--space-xl)', color: 'var(--accent)', fontWeight: 700, fontSize: 'calc(var(--gu) * 1.252)' }}>
                <span style={{width:'calc(var(--subrow) * 2)',height:'calc(var(--subrow) * 2)',flexShrink:0}}><Icon.mapPin /></span>
                <span title={placeText(p, LOCATION_REGIONS)} style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:'calc(var(--subrow) * 4)'}}>{name}</span>
                {p.userLocation && (
                  <>
                    <input type="number" min="1" value={p.maxDistance} className="focus-inset"
                      onChange={e => { const v = e.target.value; setFilters(f => setPlaceRadius(f, i, v)); }}
                      // A radius left empty or at 0 would narrow nothing: it goes back to 100.
                      onBlur={e => { if (!(Number(e.target.value) > 0)) setFilters(f => setPlaceRadius(f, i, '100')); }}
                      aria-label={`Radius around ${name}, in miles`}
                      style={{width:'calc(var(--subrow) * 6.25)',height:'calc(var(--subrow) * 4)',boxSizing:'border-box',padding:'0 calc(var(--subrow) * 0.5)',fontSize:'calc(var(--gu) * 1.208)',fontWeight:400,textAlign:'center',background:'var(--bg)',color:'var(--text)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius)',flexShrink:0}} />
                    <span style={{fontSize:'calc(var(--gu) * 1.104)',fontWeight:400,color:'var(--text-muted)',flexShrink:0}}>mi</span>
                  </>
                )}
                <button type="button" className="ctl" aria-label={`Remove ${name}`} onClick={() => setFilters(f => removePlace(f, i))}
                  style={{flexShrink:0,width:'calc(var(--gu) * 3)',height:'calc(var(--subrow) * 5)',padding:0,background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer'}}>
                  <span style={{width:'calc(var(--subrow) * 2)',height:'calc(var(--subrow) * 2)',display:'flex'}}><Icon.x /></span>
                </button>
              </div>
            );
          })}
          <div style={DIVIDER} />
        </>
      )}
      {/* Cash (pointOnly; UX pick 92): the first row names the point that is set and carries the tick.
          The tick sat on "Current Location", meaning "some point is set". */}
      {pointOnly && filters.userLocation && (
        <>
          <div style={{ ...ROW, gap: 'calc(var(--subrow) * 1)', padding: '0 var(--space-xl)', color: 'var(--accent)', fontWeight: 700, fontSize: 'calc(var(--gu) * 1.252)' }}>
            <span style={{width:'calc(var(--subrow) * 2)',height:'calc(var(--subrow) * 2)',flexShrink:0}}><Icon.mapPin /></span>
            {(filters.locationLabel && filters.locationLabel !== 'Current Location' ? filters.locationLabel : 'Your location') + (filters.maxDistance ? ` \u00b7 ${filters.maxDistance} mi` : '')}
            <span style={{marginLeft:'auto',fontSize:'calc(var(--gu) * 1.104)'}}>{'\u2713'}</span>
          </div>
          <div style={DIVIDER} />
        </>
      )}
      <button onClick={() => {
        if (!pointOnly && currentOn) {
          // The device's position is one of the places: this takes it off.
          setFilters(f => removePlace(f, placesOf(f).findIndex(p => p.locationLabel === 'Current Location')));
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
                const here = { userLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude }, maxDistance: radius || '100', locationLabel: 'Current Location' };
                setFilters(f => pointOnly ? ({...f, ...here, locationRegion: null}) : addPlace(f, here));
                reverseLookup(pos.coords.latitude, pos.coords.longitude);
                if (pointOnly) onClose();
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
        color: currentOn ? 'var(--accent)' : 'var(--text)',
        fontWeight: currentOn ? 700 : 400,
        fontSize:'calc(var(--gu) * 1.252)',cursor:'pointer',textAlign:'left',
      }}>
        <span style={{width:'calc(var(--subrow) * 2)',height:'calc(var(--subrow) * 2)',flexShrink:0}}><Icon.mapPin /></span>
        {pointOnly ? 'Use my current location' : 'Current Location'}
        {currentOn && <span style={{marginLeft:'auto',fontSize:'calc(var(--gu) * 1.104)'}}>{'✓'}</span>}
      </button>
      <div style={DIVIDER} />
      {!pointOnly && Object.entries(LOCATION_REGIONS).map(([key, { label }]) => (
        <button key={key} onClick={() => {
          // On or off, beside the other places. As the first place, a region also answers the state
          // where it implies one (Las Vegas: Nevada), as a place looked up does; a state picked by
          // hand stays.
          setFilters(f => {
            const next = togglePlace(f, { locationRegion: key });
            return firstPlace(f) ? learnJurisdiction(next, REGION_JURISDICTION[key] || null) : next;
          });
        }} aria-pressed={regionOn(key)} style={{
          ...ROW,gap:'calc(var(--subrow) * 1)',
          padding:'0 var(--space-xl)',background:'none',border:'none',
          color: regionOn(key) ? 'var(--accent)' : 'var(--text)',
          fontWeight: regionOn(key) ? 700 : 400,
          fontSize:'calc(var(--gu) * 1.252)',cursor:'pointer',textAlign:'left',
        }}>
          <span style={{width:'calc(var(--subrow) * 2)',height:'calc(var(--subrow) * 2)',flexShrink:0}}><Icon.mapPin /></span>
          {label}
          {regionOn(key) && <span style={{marginLeft:'auto',fontSize:'calc(var(--gu) * 1.104)'}}>{'✓'}</span>}
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
        <select id="jurisdiction-select" className="focus-inset" value={filters.jurisdiction || ''}
          onChange={e => {
            const v = e.target.value || null;
            setFilters(f => ({ ...f, jurisdiction: v, jurisdictionManual: !!v }));
          }}
          style={{
            display:'block',width:'100%',height:'calc(var(--subrow) * 4)',boxSizing:'border-box',padding:'0 calc(var(--subrow) * 1)',fontSize:'calc(var(--gu) * 1.208)',background:'var(--bg)',
            color:'var(--text)',border:'var(--bw-hair) solid var(--border)',
            borderRadius:'var(--radius)',
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
      {/* No Clear on Cash (UX pick 92): a cleared point could not be saved there, so the screen said "no
          location" while the watcher kept polling the old one. */}
      {!pointOnly && places.length > 0 && (
        <>
          <div style={DIVIDER} />
          <button onClick={() => {
            setFilters(f => withPlaces(f, []));
            onClose();
          }} style={{
            ...ROW,padding:'0 var(--space-xl)',
            background:'none',border:'none',color:'var(--text-muted)',
            fontSize:'calc(var(--gu) * 1.178)',cursor:'pointer',textAlign:'left',
          }}>
            {places.length > 1 ? 'Clear every place' : 'Clear location filter'}
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
