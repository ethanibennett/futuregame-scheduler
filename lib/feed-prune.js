// Which feed rows a prune may delete (server.js pruneFeedVenues and reconcileFeedSeries).
//
// The watcher emits each event for about 30 h after its start, so a row the feed no longer carries
// is one of two things: an UPCOMING event the source dropped or renumbered (prune it, or it lingers
// as a ghost), or a PAST event that simply aged out of the source's listing. Until 2026-10-23 both
// were pruned, so every event vanished from the Schedule the morning after it ran — while its clock
// could still be going (owner: "there are active clocks for events that started that day"). The
// rule now (owner): **an event stays in the schedule for 14 days after its date, then falls out**,
// whether its series is still in the feed or has left it. A row saved or logged against is kept
// regardless (feedRefGuardSql in server.js).

'use strict';

const RETAIN_DAYS = 14;
const DEFAULT_TZ = 'America/New_York';
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12 };

/** "October 22, 2026" | "2026-10-22" | "10/22/2026" → "2026-10-22", else null. Pure. */
function eventDayKey(date) {
  const s = String(date || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

/** A calendar date in a zone, "YYYY-MM-DD", `daysAgo` days before the instant. An unknown zone
 *  falls back to New York. */
function dayKeyIn(tz, now = Date.now(), daysAgo = 0) {
  const at = new Date(now - daysAgo * 86400000);
  for (const zone of [tz, DEFAULT_TZ]) {
    if (!zone) continue;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
      const get = (t) => parts.find((p) => p.type === t).value;
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch (_) { /* bad zone name: try the default */ }
  }
  return at.toISOString().slice(0, 10);
}
const todayKey = (tz, now = Date.now()) => dayKeyIn(tz, now, 0);

/** True when the row's date is before today in its room's zone. A row with no readable date is not
 *  past. */
function isPastFeedRow(row, now = Date.now()) {
  const day = eventDayKey(row && row.date);
  if (!day) return false;
  return day < todayKey(row.timezone, now);
}

/** True when a prune must leave this row alone for being a recent past event: dated before today
 *  and within the last RETAIN_DAYS days, in its room's zone. Today's and future rows are not
 *  retained (a source that dropped them meant it); older rows have fallen out. */
function retainsPastFeedRow(row, now = Date.now()) {
  const day = eventDayKey(row && row.date);
  if (!day) return false;
  const tz = row.timezone;
  return day < todayKey(tz, now) && day >= dayKeyIn(tz, now, RETAIN_DAYS);
}

module.exports = { RETAIN_DAYS, eventDayKey, todayKey, dayKeyIn, isPastFeedRow, retainsPastFeedRow };
