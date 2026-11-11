import React, { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { getVenueCoords, haversineDistance, normaliseDate, getVenueInfo } from '../utils/utils.js';
import { shareOrDownloadBlob } from '../utils/export.js';

/* A mileage log written for you (Features 17, 2026-11-11): every room played this year, a round trip from
   home, the total and its value at the IRS standard rate, the last five drives, Add to the tax report and the
   log as CSV (date, destination, purpose, miles: what a contemporaneous log needs). Miles are the straight
   line x 1.2, said so, until a map key gives road miles. Driving from home to a regular place of play can be
   commuting: the log records, the player or preparer decides. */
export const IRS_RATE = { 2023: 0.655, 2024: 0.67, 2025: 0.70 };
export const rateFor = (year) => IRS_RATE[year] != null ? { rate: IRS_RATE[year], year } : { rate: IRS_RATE[2025], year: 2025, stale: true };
const HOME_KEY = 'mileageHome';
const readHome = () => { try { return JSON.parse(localStorage.getItem(HOME_KEY) || 'null'); } catch { return null; } };
export const mileageKey = (year) => `mileage:${year}`;

export function tripsOf(events, cash, home, year) {
  if (!home) return [];
  const out = [];
  const seen = new Set();
  const add = (date, room, venue, purpose) => {
    if (!date || String(date).slice(0, 4) !== String(year)) return;
    const c = getVenueCoords(venue || room, room) || getVenueCoords(room, room);
    if (!c || c.lat == null) return;
    const k = `${date}|${room}`;
    if (seen.has(k)) return;
    seen.add(k);
    const miles = Math.round(haversineDistance(home.lat, home.lng, c.lat, c.lng) * 1.2 * 2 * 10) / 10;
    if (miles < 1 || miles > 1500) return;
    out.push({ date, room, miles, purpose });
  };
  for (const e of events || []) {
    if (!e || e.is_online || e.venue === 'Personal') continue;
    const room = e.property || getVenueInfo(e.venue, e.property).longName || e.venue;
    add(normaliseDate(e.date), room, e.venue, `Tournament: ${e.event_name || 'event'}`);
  }
  for (const s of cash || []) {
    if (!s || !s.room) continue;
    add(normaliseDate(s.session_date), s.room, s.room, `Cash game: ${[s.stakes, s.game].filter(Boolean).join(' ')}`);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export default function MileageCard({ token, events, year }) {
  const [home, setHome] = useState(readHome);
  const [cash, setCash] = useState([]);
  const [added, setAdded] = useState(() => { try { return !!localStorage.getItem(mileageKey(year)); } catch { return false; } });
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/cash-sessions?from=${year}-01-01&to=${year}-12-31`, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setCash(d.sessions || [])).catch(() => {});
  }, [token, year]);
  const trips = useMemo(() => tripsOf(events, cash, home, year), [events, cash, home, year]);
  const miles = Math.round(trips.reduce((a, t) => a + t.miles, 0));
  const r = rateFor(year);
  const value = miles * r.rate;
  const setHere = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => {
      const h = { lat: p.coords.latitude, lng: p.coords.longitude, label: 'Home' };
      try { localStorage.setItem(HOME_KEY, JSON.stringify(h)); } catch { /* storage off */ }
      setHome(h);
    }, () => {}, { enableHighAccuracy: false, timeout: 10000 });
  };
  const csv = () => {
    const lines = ['Date,Destination,Purpose,Miles (round trip)', ...[...trips].reverse().map((t) => [t.date, t.room, t.purpose, t.miles].map((v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(','))];
    lines.push('', `Total,,,${miles}`, '"Miles are the straight line from home x 1.2, round trip; replace with odometer readings where you have them."');
    shareOrDownloadBlob(new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }), `mileage-${year}.csv`, 'text/csv', { mode: 'download' });
  };
  const addToReport = () => {
    try {
      if (added) localStorage.removeItem(mileageKey(year));
      else localStorage.setItem(mileageKey(year), JSON.stringify({ miles, rate: r.rate, amount: Math.round(value * 100) / 100 }));
    } catch { /* storage off */ }
    setAdded(!added);
  };
  return (
    <div className="mi-card">
      <div className="mi-label">{`Miles · ${year} · from home`}</div>
      {!home ? (
        <>
          <p className="mi-note">Set your home once (it stays on this device) and every room you played this year becomes a round trip in the log.</p>
          <button type="button" className="btn btn-ghost ctl mi-btn" onClick={setHere}><span>Use where I am as home</span></button>
        </>
      ) : (
        <>
          <div className="mi-total">{`${miles.toLocaleString('en-US')} mi`}<span>{`$${Math.round(value).toLocaleString('en-US')} at ${Math.round(r.rate * 1000) / 10}¢${r.stale ? ` (${r.year} rate)` : ''}`}</span></div>
          {trips.slice(0, 5).map((t) => (
            <div key={t.date + t.room} className="mi-row"><span>{new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span><span className="mi-room">{t.room}</span><b>{`${t.miles} mi`}</b></div>
          ))}
          {!trips.length && <p className="mi-note">No room with a known place played this year yet.</p>}
          <p className="mi-note">Straight line x 1.2, round trip. Driving to a regular place of play can count as commuting; the log records, you or your preparer decide.</p>
          <div className="mi-btns">
            <button type="button" className={'btn ctl mi-btn' + (added ? ' btn-ghost' : ' btn-primary')} onClick={addToReport} disabled={!trips.length}><span>{added ? 'In the tax report ✓' : 'Add to the tax report'}</span></button>
            <button type="button" className="btn btn-ghost ctl mi-btn" onClick={csv} disabled={!trips.length}><span>Mileage log CSV</span></button>
          </div>
          <button type="button" className="mi-text" onClick={setHere}><span>Move home to where I am</span></button>
        </>
      )}
    </div>
  );
}
