import React, { useEffect, useRef, useState } from 'react';
import { mountVenueMap } from '../utils/venue-map/providers.js';

/* The map in the venue popup: one pin on the room, about zoom 13. Which map draws it is decided in
 * one place (utils/venue-map/providers.js: Google Maps on Android, MapKit JS elsewhere, OpenStreetMap
 * whenever a key is not configured or a provider fails), and the provider's code loads only now.
 * The canvas holds no React children: a provider owns everything drawn inside it.
 */
export default function VenueMap({ lat, lng, title, theme }) {
  const ref = useRef(null);
  const [state, setState] = useState('loading'); // loading | ready | failed
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let dead = false;
    let handle = null;
    setState('loading');
    mountVenueMap(el, { lat, lng, title, theme }).then((h) => {
      if (dead) { h.destroy(); return; }
      handle = h;
      el.dataset.provider = h.provider;
      setState('ready');
    }, () => { if (!dead) setState('failed'); });
    return () => { dead = true; if (handle) handle.destroy(); };
  }, [lat, lng, title, theme]);
  return (
    <>
      <div ref={ref} className="vm-map-canvas" role="img" aria-label={`Map showing ${title}`} />
      {state !== 'ready' && (
        <p className="vm-map-note" aria-live="polite">
          {state === 'loading' ? 'Loading map…' : 'The map could not load. Open it in Maps below.'}
        </p>
      )}
    </>
  );
}
