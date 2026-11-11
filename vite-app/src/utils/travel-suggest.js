/* The travel day the schedule already implies (Laws of UX pick 33, owner 2026-11-10): the first upcoming
   day whose first event is far from the event before it (over 30 miles by the rooms' coordinates; a
   different room when either has none), with an arrival an hour before that event and a departure three
   hours before the arrival. Nothing when the schedule implies no move or a travel day is already there.
   Pure: the date, time, place and coordinate helpers are passed in. */
const MILES_PER_KM = 0.621371;
function miles(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * MILES_PER_KM;
}

// "10:15 AM" -> minutes after midnight, or null.
export function clockMinutes(time) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i.exec(String(time || ''));
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}
// Minutes after midnight -> { hour, minute, amPm } on the picker's quarter hours.
export function pickerTime(mins) {
  const q = Math.max(0, Math.floor(mins / 15) * 15);
  const h24 = Math.floor(q / 60) % 24;
  return { hour: h24 % 12 === 0 ? 12 : h24 % 12, minute: q % 60, amPm: h24 < 12 ? 'AM' : 'PM' };
}

export function suggestTravelDay(sorted, { todayIso, dateOf, placeOf, coordsOf }) {
  const events = (sorted || []).filter((t) => t && t.venue !== 'Personal' && !t.is_restart);
  const travelDays = new Set((sorted || []).filter((t) => t && t.venue === 'Personal' && t.event_name === 'Travel Day').map(dateOf));
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1], t = events[i];
    const day = dateOf(t);
    if (!day || day < todayIso || day === dateOf(prev)) continue;
    const a = coordsOf(prev), b = coordsOf(t);
    const far = a && b ? miles(a, b) > 30 : placeOf(prev) !== placeOf(t);
    if (!far) continue;
    if (travelDays.has(day)) return null;
    const start = clockMinutes(t.time);
    if (start == null || start < 4 * 60) continue;
    return {
      date: day,
      arrive: pickerTime(start - 60),
      depart: pickerTime(start - 60 - 180),
      note: `Before ${t.event_name} · ${placeOf(t)} · ${t.time} · from ${placeOf(prev)}`,
    };
  }
  return null;
}
