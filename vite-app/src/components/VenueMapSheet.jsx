import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import VenueMap from './VenueMap.jsx';
import './venue-map.css';
import { API_URL } from '../utils/api.js';
import { venuePlace, distanceLine, mapsLinks, mapTheme } from '../utils/venue-place.js';
import { readLocalLocation } from '../utils/location-prefs.js';

/* The venue map popup (docs/venue-map.md), opened by a venue strip on an event card
 * (utils/venue-map/open.js). A bottom sheet on the phone layout, a centred dialog on the desktop
 * one (html[data-layout="desktop"]); 37g wide either way, every row whole r (venue-map.css).
 *
 *   the room's name            the feed's property, else the curated long name
 *   its town                   GET /api/venue-place: the PokerAtlas town for the room, the town the
 *                              source named, else the town the coordinates stand in
 *   the distance               from the user's saved location, when one is set
 *   "Approximate location"     when the coordinate is a town centre (city-level)
 *   the map                    one pin, about zoom 13 (VenueMap)
 *   Open in Apple Maps · Google Maps   (Search in … when there is no coordinate at all)
 *
 * Close button, Esc and a tap on the backdrop close it; Tab stays inside; focus returns to the
 * strip (open.js).
 */
const answers = new Map(); // venue|property → /api/venue-place, for this page's life

export default function VenueMapSheet({ event, onClose }) {
  const local = useMemo(() => venuePlace(event), [event]);
  const key = `${local.venue}|${local.property || ''}`;
  const [server, setServer] = useState(() => answers.get(key) || null);
  const [asked, setAsked] = useState(() => answers.has(key));
  useEffect(() => {
    if (answers.has(key)) return undefined;
    let dead = false;
    const q = new URLSearchParams({ venue: local.venue || '' });
    if (local.property) q.set('property', local.property);
    if (local.coords) { q.set('lat', String(local.coords.lat)); q.set('lng', String(local.coords.lng)); }
    fetch(`${API_URL}/venue-place?${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j) => {
        if (j && j.town) answers.set(key, j);
        if (!dead) { setServer(j); setAsked(true); }
      });
    return () => { dead = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Which coordinate the map shows. The client's own (curated, else server-placed) when it is
     exact. A curated town centre (city-level) gives way to the server's exact placement of the
     room when it has one — most of those rooms are in the PokerAtlas directory — so the popup
     waits for that answer (at most 2 s) before drawing rather than drawing twice. With no
     coordinate of its own (the shared-schedule page loads no /api/venue-coords) it takes the
     server's. */
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!local.coords || !local.approx || asked) return undefined;
    const t = setTimeout(() => setWaited(true), 2000);
    return () => clearTimeout(t);
  }, [local.coords, local.approx, asked]);
  const serverCoords = server && server.lat != null && server.lng != null ? { lat: server.lat, lng: server.lng } : null;
  let coords = null, approx = false;
  if (local.coords && !local.approx) { coords = local.coords; }
  else if (serverCoords && !server.approx) { coords = serverCoords; }
  else if (local.coords && (asked || waited)) { coords = local.coords; approx = true; }
  else if (serverCoords) { coords = serverCoords; approx = true; }
  const pending = !coords && !asked && !waited;
  const town = server && server.town ? server.town : null;
  const placeText = town || (server && server.region) || '';
  const saved = useMemo(() => readLocalLocation(), []);
  const dist = distanceLine(coords, saved);
  // While the map waits on the server, the hand-offs already point at the client's coordinate.
  const links = mapsLinks({ name: local.name, town, coords: coords || local.coords });
  const theme = useMemo(() => mapTheme(), []);

  // A name too long for one line takes two (3r apart), measured once the face has loaded.
  const titleRef = useRef(null);
  const [wrap, setWrap] = useState(false);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return undefined;
    let dead = false;
    const measure = () => {
      if (dead || !el.isConnected) return;
      el.classList.remove('is-wrap');
      const over = el.scrollWidth > el.clientWidth + 1;
      if (over) el.classList.add('is-wrap');
      setWrap(over);
    };
    measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    return () => { dead = true; };
  }, [local.name]);

  // Focus in, Esc out, Tab kept inside.
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    if (closeRef.current) closeRef.current.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const f = [...sheetRef.current.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.getClientRects().length > 0);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (!sheetRef.current.contains(at)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const titleId = 'vm-title';
  const placeId = 'vm-place';
  const showPlace = !asked || !!placeText;
  return (
    <div className="vm-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={sheetRef} className="vm-sheet snap-place" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={showPlace ? placeId : undefined}>
        <div className="vm-body">
          <div className={`vm-head${wrap ? ' is-wrap' : ''}`}>
            <h2 ref={titleRef} id={titleId} className={`vm-title${wrap ? ' is-wrap' : ''}`}>{local.name}</h2>
            <button ref={closeRef} type="button" className="vm-close" aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          {showPlace && <p id={placeId} className="vm-line vm-place">{placeText}</p>}
          {dist && <p className="vm-line vm-dist">{dist}</p>}
          {coords && approx && <p className="vm-line vm-approx">Approximate location — town centre</p>}
          <div className="vm-map">
            {coords
              ? <VenueMap lat={coords.lat} lng={coords.lng} title={local.name} theme={theme} />
              : <p className="vm-map-note">{pending ? 'Finding the room…' : 'No map location on file for this room.'}</p>}
          </div>
          <div className="vm-actions">
            <a className="vm-btn vm-btn--brand" href={links.apple} target="_blank" rel="noopener noreferrer">
              <span>{links.search ? 'Search in Apple Maps' : 'Open in Apple Maps'}</span>
            </a>
            <a className="vm-btn" href={links.google} target="_blank" rel="noopener noreferrer">
              <span>{links.search ? 'Search in Google Maps' : 'Google Maps'}</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
