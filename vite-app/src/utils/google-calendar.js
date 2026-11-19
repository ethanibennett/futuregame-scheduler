/* "Add to Google Calendar" on an open event card (owner, 2026-11-19: "can we add a google calendar button to the
   expanded event cards?"): Google's new-event page, filled in. The times are the room's wall clock with the room's
   zone (ctz), so nothing here converts zones. The end is the calendar feed's (lib/calendar-feed.js buildIcs): when late
   registration closes, else 8 hours on, never under an hour, so a one-off add and the subscribed feed agree.
   Pure; tested by __tests__/google-calendar.test.mjs. */

/** Minutes after midnight for "7:00 PM", "19:00", "11 AM"; null for TBD. (lib/calendar-feed.js clockMinutes) */
export function clockMinutes(s) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?\s*$/i.exec(String(s || '')) || /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s || ''));
  if (!m) return null;
  let h = Number(m[1]) % 24;
  const min = Number(m[2] || 0);
  if (m[3]) { const pm = /p/i.test(m[3]); h = (h % 12) + (pm ? 12 : 0); }
  return h * 60 + min;
}

/** Minutes after the start's midnight when late reg closes (may pass 1440); null when the event does not say. */
function lateRegCloseMin(t, startMin) {
  const s = String(t.late_reg_end || '').trim();
  if (!s) return null;
  const lv = /level\s*(\d{1,2})/i.exec(s);
  const len = Number(String(t.level_duration || '').replace(/[^\d.]/g, '')) || 0;
  if (lv && len) return startMin + Number(lv[1]) * len;
  const cm = clockMinutes(s.replace(/^(end|close)s?\s*(at)?\s*/i, ''));
  if (cm == null) return null;
  return cm <= startMin ? cm + 1440 : cm;
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(day, minutes) {
  const d = new Date(Date.parse(day + 'T12:00:00Z') + Math.floor(minutes / 1440) * 864e5);
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
}

/**
 * The link, or null when there is nothing to add (a Personal row, no date or a time it cannot read).
 *   t     the event row (event_number, event_name, date as YYYY-MM-DD, time, buyin, late_reg_end, level_duration,
 *         property, venue)
 *   opts  { zone: the room's IANA zone, money: (amount) => "$1,500", site: 'futurega.me' }
 */
export function googleCalendarUrl(t, { zone, money = (n) => `$${Number(n || 0).toLocaleString('en-US')}`, site = 'futurega.me' } = {}) {
  if (!t || t.venue === 'Personal') return null;
  const day = String(t.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const startMin = clockMinutes(t.time);
  if (startMin == null) return null;
  const close = lateRegCloseMin(t, startMin);
  const endMin = Math.max(close != null ? close : startMin + 8 * 60, startMin + 60);
  const title = (t.event_number ? `#${t.event_number} ` : '') + (t.event_name || 'Tournament');
  const where = [t.property, t.venue].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
  const details = [
    Number(t.buyin) ? `Buy-in ${money(t.buyin)}` : null,
    t.late_reg_end ? `Late reg: ${t.late_reg_end}` : null,
    `From ${site}`,
  ].filter(Boolean).join('\n');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${stamp(day, startMin)}/${stamp(day, endMin)}` });
  if (zone) q.set('ctz', zone);
  if (where) q.set('location', where);
  q.set('details', details);
  return `https://calendar.google.com/calendar/render?${q}`;
}
