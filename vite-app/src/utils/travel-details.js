/* A Travel Day's flights, stays and rental cars, as the open card shows and edits them (owner, 2026-11-27: "Add the
   option to enter flight information, stay information (hotel name, check in time etc), rental car info etc").
   Stored by lib/travel-details.js, its owner's only. Pure: no imports. */

/** Each kind: its name, its fields in order (key, label, input type, placeholder, whole row), and the field that
    names it on the card. Times are an <input type="time"> ("08:05"); a check-in, a check-out, a pick-up and a
    drop-off are a date and a time (<input type="datetime-local">, "2026-12-08T15:00"). */
export const KINDS = {
  flight: {
    title: 'Flight',
    fields: [
      { key: 'number', label: 'Flight number', placeholder: 'AA 1234' },
      { key: 'conf', label: 'Confirmation', placeholder: 'ABC123' },
      { key: 'from', label: 'From', placeholder: 'PHL' },
      { key: 'to', label: 'To', placeholder: 'LAS' },
      { key: 'departs', label: 'Departs', type: 'time' },
      { key: 'arrives', label: 'Arrives', type: 'time' },
    ],
  },
  stay: {
    title: 'Stay',
    fields: [
      { key: 'name', label: 'Hotel', placeholder: 'Wynn Las Vegas', wide: true },
      { key: 'address', label: 'Address', placeholder: '3131 Las Vegas Blvd S', wide: true },
      { key: 'checkIn', label: 'Check in', type: 'datetime-local' },
      { key: 'checkOut', label: 'Check out', type: 'datetime-local' },
      { key: 'conf', label: 'Confirmation', placeholder: '81234567' },
    ],
  },
  car: {
    title: 'Rental car',
    fields: [
      { key: 'company', label: 'Company', placeholder: 'Hertz' },
      { key: 'conf', label: 'Confirmation', placeholder: 'K1234567' },
      { key: 'pickUp', label: 'Pick up', type: 'datetime-local' },
      { key: 'pickUpAt', label: 'Pick-up place', placeholder: 'LAS airport' },
      { key: 'dropOff', label: 'Drop off', type: 'datetime-local' },
      { key: 'dropOffAt', label: 'Drop-off place', placeholder: 'LAS airport' },
    ],
  },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "08:05" or "2026-12-08T08:05" to "8:05 AM"; anything else as it was typed. */
export function fmtClock(v) {
  const m = /(?:^|T)(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m || Number(m[1]) > 23) return String(v || '').trim();
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2026-12-08T15:00" to "Dec 8, 3:00 PM"; a time alone as fmtClock. */
export function fmtWhen(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{1,2}:\d{2}))?$/.exec(String(v || '').trim());
  if (!m) return fmtClock(v);
  const day = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return m[4] ? `${day}, ${fmtClock(m[4])}` : day;
}

/** An item's text for one field, ready to show. */
function shown(item, f) {
  const v = item[f.key];
  if (!v) return '';
  return f.type === 'time' ? fmtClock(v) : f.type === 'datetime-local' ? fmtWhen(v) : String(v);
}

/** The card's cells for an item (its kind is the line over them): every field that has something, in the form's
    order, the flight's From and To as one Route. */
export function cellsOf(item) {
  const kind = KINDS[item && item.kind];
  if (!kind) return [];
  const cells = [];
  for (const f of kind.fields) {
    if (item.kind === 'flight' && f.key === 'to') continue;
    if (item.kind === 'flight' && f.key === 'from') {
      const route = [item.from, item.to].filter(Boolean).join(' → ');
      if (route) cells.push({ label: 'Route', value: route, wide: false });
      continue;
    }
    const v = shown(item, f);
    if (v) cells.push({ label: f.label, value: v, wide: !!f.wide });
  }
  return cells;
}

/** The day's way, flight by flight: "PHL → LAS", "PHL → DFW → LAS"; null with no airports. */
export function routeOf(items) {
  const stops = [];
  for (const f of (items || []).filter((i) => i.kind === 'flight')) {
    for (const s of [f.from, f.to]) if (s && stops[stops.length - 1] !== s) stops.push(s);
  }
  return stops.length >= 2 ? stops.join(' → ') : null;
}

/** The picker's note ("Depart 8:00 AM → Arrive 2:00 PM") read back as the card's times, else null. */
const NOTE = /^Depart\s+(.+?)\s*→\s*Arrive\s+(.+)$/;
export function timesOf(notes) {
  const m = NOTE.exec(String(notes || '').trim());
  return m ? { depart: m[1], arrive: m[2] } : null;
}

/** An empty item of a kind, for the form. */
export function blankItem(kind) {
  const out = { kind };
  for (const f of KINDS[kind].fields) out[f.key] = '';
  return out;
}

/** The item as sent: trimmed, empty fields dropped; null when nothing was filled in. */
export function cleanItem(item) {
  const kind = KINDS[item && item.kind];
  if (!kind) return null;
  const out = { kind: item.kind };
  let any = false;
  for (const f of kind.fields) {
    const v = String(item[f.key] == null ? '' : item[f.key]).trim();
    if (v) { out[f.key] = v; any = true; }
  }
  return any ? out : null;
}
