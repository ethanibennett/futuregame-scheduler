/* The trip each upcoming Travel Day opens (Features 5). A trip is a PLACE, not a room (owner, 2026-11-19: "Should be
   based on location, not venue. A trip to Vegas should include all events/days during that trip"): every saved event
   within TRIP_RADIUS_MILES of where the trip's first placed event is, at any room, from the Travel Day on. It ends at
   the next Travel Day (the trip home, or on to the next place: the trip runs to that day), at the first saved event
   placed further away, or at a gap of more than a week between events (owner, 2026-11-13: it had "reflected the whole
   series" and run on into the next ones, Nov 17 to Mar 25, 129 nights). A Day Off inside it does not end it; an online
   event is neither in it nor ends it. An event with no coordinates is measured by its room instead: the same room as
   the trip's is in it, and any other room is in it too, since nothing says it is elsewhere.
   Pure: dateOf (ISO day), placeOf (the room), coordsOf ({lat, lng} or null) and isOnline are passed in. */
export const TRIP_GAP_DAYS = 7;
// The Strip to Henderson or Summerlin is under 20 miles, LA's card rooms are within 25 of each other; Philadelphia to
// Atlantic City is 55, two trips.
export const TRIP_RADIUS_MILES = 40;

const dayMs = (iso) => Date.parse(iso + 'T12:00:00');
const days = (a, b) => Math.round((dayMs(b) - dayMs(a)) / 864e5);

function miles(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const placed = (c) => !!c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng));

export function tripRuns(sorted, todayISO, { dateOf, placeOf, coordsOf = () => null, isOnline = () => false }) {
  const out = new Map();
  const list = (sorted || []).filter(Boolean);
  const isTravel = (t) => t.venue === 'Personal' && /travel/i.test(t.event_name || '');
  for (let i = 0; i < list.length; i += 1) {
    const t = list[i];
    if (!isTravel(t)) continue;
    const start = dateOf(t);
    if (!start || start < todayISO) continue;
    const events = [];
    let room = null, at = null, last = null, home = null;
    for (let j = i + 1; j < list.length; j += 1) {
      const u = list[j];
      if (isTravel(u)) { home = dateOf(u) || null; break; }
      if (u.venue === 'Personal' || isOnline(u)) continue;
      const d = dateOf(u);
      if (!d) continue;
      if (last && days(last, d) > TRIP_GAP_DAYS) break;
      const c = coordsOf(u);
      if (room == null) room = placeOf(u);
      else if (at && placed(c) && miles(at, c) > TRIP_RADIUS_MILES) break;
      if (!at && placed(c)) at = { lat: Number(c.lat), lng: Number(c.lng) };
      events.push(u);
      last = d;
    }
    if (!events.length) continue;
    // The Travel Day that follows within a week is the way home (or on): the trip runs to it.
    const end = home && home >= last && days(last, home) <= TRIP_GAP_DAYS ? home : last;
    const rooms = [...new Set(events.map(placeOf).filter(Boolean))];
    const nights = Math.max(1, end === last ? days(start, end) + 1 : days(start, end));
    out.set(t.id, { travelDay: t, events, start, end, nights, room, rooms, homeDay: end === last ? null : end });
  }
  return out;
}
