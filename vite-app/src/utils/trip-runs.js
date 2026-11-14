/* The trip each upcoming Travel Day opens (Features 5; owner, 2026-11-13: it "reflected the whole series"
   and ran on into the next ones, Nov 17 to Mar 25, 129 nights). A trip is the saved events at the room the
   first event after the Travel Day is at, and ends at the first saved event anywhere else, at a gap of
   more than a week between them (the same room on a later visit), or at the next Travel Day. A Day Off
   inside it does not end it. Pure: dateOf (ISO day) and placeOf (the room) are passed in. */
export const TRIP_GAP_DAYS = 7;

const dayMs = (iso) => Date.parse(iso + 'T12:00:00');

export function tripRuns(sorted, todayISO, { dateOf, placeOf }) {
  const out = new Map();
  const list = (sorted || []).filter(Boolean);
  const isTravel = (t) => t.venue === 'Personal' && /travel/i.test(t.event_name || '');
  for (let i = 0; i < list.length; i += 1) {
    const t = list[i];
    if (!isTravel(t)) continue;
    const start = dateOf(t);
    if (!start || start < todayISO) continue;
    const events = [];
    let room = null, last = null;
    for (let j = i + 1; j < list.length; j += 1) {
      const u = list[j];
      if (isTravel(u)) break;
      if (u.venue === 'Personal') continue;
      const d = dateOf(u);
      if (!d) continue;
      if (room == null) room = placeOf(u);
      else if (placeOf(u) !== room) break;
      if (last && (dayMs(d) - dayMs(last)) / 864e5 > TRIP_GAP_DAYS) break;
      events.push(u);
      last = d;
    }
    if (!events.length) continue;
    out.set(t.id, { travelDay: t, events, start, end: last, room });
  }
  return out;
}
