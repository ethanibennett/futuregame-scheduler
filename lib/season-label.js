'use strict';
/*
 * The Schedule header's date range, for the screens before sign-in (owner, 2026-11-04). The app works it out
 * from the events it loads (utils/utils.js formatSeasonLabel), which needs a login; a first-time visitor has no
 * events and no stored label. This is the same wording from the same rows, and test/season-label.test.js holds
 * the two copies together. The client's is ESM and this server is CommonJS, hence two.
 */

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function seasonLabelOf(days, today) {
  let min = '';
  let max = '';
  for (const d of days || []) {
    if (!d || d < today) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  if (!min) return '';
  const fromYear = min.slice(0, 4);
  const toYear = max.slice(0, 4);
  const fromMonth = MONTH_NAMES[Number(min.slice(5, 7)) - 1];
  const toMonth = MONTH_NAMES[Number(max.slice(5, 7)) - 1];
  if (!fromMonth || !toMonth) return '';
  if (fromYear !== toYear) return `${fromMonth} ${fromYear}-${toMonth} ${toYear}`;
  return fromMonth === toMonth ? `${fromMonth} ${fromYear}` : `${fromMonth}-${toMonth} ${fromYear}`;
}

/** A stored date ("April 1, 2026", or ISO) as an ISO day; '' if it cannot be read. */
function isoDay(date) {
  const s = String(date || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ms = Date.parse(`${s} 12:00 UTC`);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
}

/** Today in New York: the server runs in UTC, whose date turns over in the American evening. */
function todayEastern(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * The label for the rows /api/tournaments lists: everything but Personal rows and the feed rows it hides.
 * Hidden rows are passed in as a Set of ids. '' when nothing is upcoming, or the database is not ready.
 */
function currentSeasonLabel(db, hiddenIds, now = new Date()) {
  const q = db.exec("SELECT id, date FROM tournaments WHERE venue != 'Personal'");
  const days = [];
  for (const [id, date] of (q[0] ? q[0].values : [])) {
    if (hiddenIds && hiddenIds.has(id)) continue;
    days.push(isoDay(date));
  }
  return seasonLabelOf(days, todayEastern(now));
}

module.exports = { seasonLabelOf, isoDay, todayEastern, currentSeasonLabel };
