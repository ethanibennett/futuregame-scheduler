import React, { useState } from 'react';
import { API_URL } from '../utils/api.js';
import { normaliseDate, formatBuyin, getVenueInfo } from '../utils/utils.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { tripRuns as tripRunsAt } from '../utils/trip-runs.js';

/* A trip's budget before you go (Features 5, 2026-11-11): above a Travel Day that opens a run of saved
   events, what the run costs: the buy-ins at each event's planned bullets (restarts left out), and the
   lodging and travel the player enters (a nightly rate and a fare, kept on this device). An admin can save
   it as a Bankroll trip with these dates, its planned figure in the note, so Trips later shows it beside
   the real net. Facts only: no advice. */
const KEY = (id) => `tripBudget:${id}`;
const read = (id) => { try { return JSON.parse(localStorage.getItem(KEY(id)) || '{}') || {}; } catch { return {}; } };

// The run a Travel Day opens: the saved events at one room, ending at another room, a week's gap or
// the next Travel Day (utils/trip-runs.js; owner, 2026-11-13).
export function tripRuns(sorted, todayISO) {
  return tripRunsAt(sorted, todayISO, {
    dateOf: (t) => normaliseDate(t.date),
    placeOf: (e) => e.property || getVenueInfo(e.venue, e.property).longName || e.venue,
  });
}

export default function TripBudgetCard({ trip, token, isAdmin }) {
  const toast = useToast();
  const [v, setV] = useState(() => read(trip.travelDay.id));
  const [saved, setSaved] = useState(!!v.savedTripId);
  const nights = Math.max(1, Math.round((Date.parse(trip.end + 'T12:00:00') - Date.parse(trip.start + 'T12:00:00')) / 864e5) + 1);
  const play = trip.events.filter((e) => !e.is_restart);
  const bullets = play.reduce((a, e) => a + (Number(e.planned_entries) || 1), 0);
  const byCur = new Map();
  for (const e of play) {
    const cur = String(e.currency || 'USD').toUpperCase();
    byCur.set(cur, (byCur.get(cur) || 0) + (Number(e.buyin) || 0) * (Number(e.planned_entries) || 1));
  }
  const usdOnly = [...byCur.keys()].every((c) => c === 'USD');
  const buyins = byCur.get('USD') || 0;
  const lodging = (Number(v.rate) || 0) * nights;
  const travel = Number(v.travel) || 0;
  const total = buyins + lodging + travel;
  const set = (k, val) => { const n = { ...v, [k]: val }; setV(n); try { localStorage.setItem(KEY(trip.travelDay.id), JSON.stringify(n)); } catch { /* storage off */ } };
  const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  const saveTrip = async () => {
    const note = `Planned: ${money(buyins)} buy-ins (${play.length} events, ${bullets} bullets)${lodging ? `, ${money(lodging)} lodging` : ''}${travel ? `, ${money(travel)} travel` : ''}; total ${money(total)}`;
    try {
      const r = await fetch(`${API_URL}/bankrolls/trips`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${trip.room} ${day(trip.start)}`, start_date: trip.start, end_date: trip.end, note }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { if (toast) toast.error(d.error || 'The trip was not saved'); return; }
      set('savedTripId', d.trip && d.trip.id);
      setSaved(true);
      if (toast) toast.success('Saved to Bankroll › Trips');
    } catch { if (toast) toast.error('No connection. The trip was not saved.'); }
  };
  return (
    <div className="trip-card" data-money-zone="">
      <div className="trip-label">{`Trip · ${day(trip.start)} – ${day(trip.end)} · ${nights} night${nights === 1 ? '' : 's'} · ${trip.room}`}</div>
      <div className="trip-total">{usdOnly ? money(total) : [...byCur.entries()].map(([c, n]) => formatBuyin(n, c === 'USD' ? '' : c)).join(' + ')}</div>
      <div className="trip-row"><span>{`${play.length} event${play.length === 1 ? '' : 's'} · ${bullets} bullet${bullets === 1 ? '' : 's'}`}</span><b>{usdOnly ? money(buyins) : 'see above'}</b></div>
      <div className="trip-row">
        <label htmlFor={`trip-rate-${trip.travelDay.id}`}>Lodging, a night</label>
        <span className="trip-in"><input id={`trip-rate-${trip.travelDay.id}`} inputMode="decimal" value={v.rate || ''} placeholder="0" onChange={(e) => set('rate', e.target.value.replace(/[^\d.]/g, ''))} /><b>{money(lodging)}</b></span>
      </div>
      <div className="trip-row">
        <label htmlFor={`trip-travel-${trip.travelDay.id}`}>Travel</label>
        <span className="trip-in"><input id={`trip-travel-${trip.travelDay.id}`} inputMode="decimal" value={v.travel || ''} placeholder="0" onChange={(e) => set('travel', e.target.value.replace(/[^\d.]/g, ''))} /><b>{money(travel)}</b></span>
      </div>
      {isAdmin && token && (
        <button type="button" className="btn btn-ghost ctl trip-save" onClick={saveTrip} disabled={saved}>
          <span>{saved ? 'Saved to Bankroll › Trips' : 'Save as a Bankroll trip'}</span>
        </button>
      )}
    </div>
  );
}
