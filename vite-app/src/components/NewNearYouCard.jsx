import React, { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { getVenueInfo, normaliseDate, parseServerStamp } from '../utils/utils.js';

/* New near you (Features 8, 2026-11-11): series first seen in the last 7 days among the rooms the Schedule
   shows (its location filter decides "near"), plus any new series at a room the player follows. One row per
   series with its room, dates and event count, and Follow, which puts that room's next new series in the
   bell. Hidden when empty; ✕ hides the series shown until a new one arrives. */
const DAY = 864e5;
const HIDE_KEY = 'newNearHidden';

function readHidden() { try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]')); } catch { return new Set(); } }

export default function NewNearYouCard({ tournaments, shownVenues, token, onOpenSeries }) {
  const [follows, setFollows] = useState(() => new Set());
  const [hidden, setHidden] = useState(readHidden);
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/room-follows`, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setFollows(new Set((d.rooms || []).map((x) => x.toLowerCase()))); }).catch(() => {});
  }, [token]);
  const series = useMemo(() => {
    const by = new Map();
    for (const t of tournaments || []) {
      if (!t || t.venue === 'Personal' || !t.created_at) continue;
      const s = by.get(t.venue) || { venue: t.venue, property: t.property || null, first: Infinity, days: [], n: 0 };
      const c = Number(parseServerStamp(t.created_at));
      if (Number.isFinite(c) && c < s.first) s.first = c;
      const d = normaliseDate(t.date);
      if (d) s.days.push(d);
      s.n += 1;
      if (!s.property && t.property) s.property = t.property;
      by.set(t.venue, s);
    }
    const now = Date.now();
    const out = [];
    for (const s of by.values()) {
      if (!(s.first > now - 7 * DAY)) continue;
      const room = s.property || getVenueInfo(s.venue, s.property).longName || s.venue;
      const followed = follows.has(String(room).toLowerCase()) || follows.has(String(s.venue).toLowerCase());
      if (!followed && !(shownVenues && shownVenues.has(s.venue))) continue;
      s.days.sort();
      out.push({ ...s, room, followed });
    }
    return out.sort((a, b) => b.first - a.first);
  }, [tournaments, shownVenues, follows]);
  const shown = series.filter((s) => !hidden.has(s.venue));
  if (!shown.length) return null;
  const toggleFollow = async (s) => {
    const on = !s.followed;
    setFollows((f) => { const n = new Set(f); if (on) n.add(String(s.room).toLowerCase()); else { n.delete(String(s.room).toLowerCase()); n.delete(String(s.venue).toLowerCase()); } return n; });
    await fetch(`${API_URL}/room-follows`, { method: on ? 'POST' : 'DELETE', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ room: s.room }) }).catch(() => {});
  };
  const hideAll = () => {
    const n = new Set([...hidden, ...shown.map((s) => s.venue)]);
    setHidden(n);
    try { localStorage.setItem(HIDE_KEY, JSON.stringify([...n].slice(-200))); } catch { /* storage off */ }
  };
  const span = (days) => {
    if (!days.length) return '';
    const f = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return days[0] === days[days.length - 1] ? f(days[0]) : `${f(days[0])} – ${f(days[days.length - 1])}`;
  };
  return (
    <div className="nny-card">
      <div className="nny-head">
        <span className="nny-label">{`New near you · this week · ${shown.length}`}</span>
        <button type="button" className="nny-x" onClick={hideAll} aria-label="Hide these">×</button>
      </div>
      {shown.slice(0, 6).map((s) => (
        <div key={s.venue} className="nny-row">
          <button type="button" className="nny-main" onClick={() => onOpenSeries && onOpenSeries(s.venue)}>
            <span className="nny-name">{s.venue}</span>
            <span className="nny-meta">{[s.room !== s.venue ? s.room : null, span(s.days), `${s.n} event${s.n === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
          </button>
          {token && (
            <button type="button" className={'btn btn-ghost ctl nny-follow' + (s.followed ? ' is-on' : '')} aria-pressed={s.followed} onClick={() => toggleFollow(s)}>
              <span>{s.followed ? '★ Following' : '☆ Follow'}</span>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
