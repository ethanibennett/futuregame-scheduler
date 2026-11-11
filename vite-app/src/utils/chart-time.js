/**
 * The bankroll graph's time axis (Bankroll design 7): the plot is cut into calendar bands, each drawn as a
 * hairline at its start and named under the plot, so a step in a line can be read against its month.
 *
 *   span up to 62 days     weeks, from each Monday       "Oct 13"
 *   up to 400 days         months                        "J" (or "Jan" where the band is wide)
 *   up to 3 years          quarters                      "Q1"
 *   longer                 years                         "2025"
 *
 * Dates are ISO days (YYYY-MM-DD) read as UTC midnight, as the chart reads them. Pure; tested in
 * __tests__/chart-time.test.mjs.
 */
const DAY = 864e5;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The unit for a span of `days`. */
export function bandUnit(days) {
  if (days <= 62) return 'week';
  if (days <= 400) return 'month';
  if (days <= 3 * 366) return 'quarter';
  return 'year';
}

// The first boundary at or after `ms`, and the one after a boundary, per unit.
function firstAtOrAfter(ms, unit) {
  const d = new Date(ms);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  let b;
  if (unit === 'week') {
    const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
    b = Date.UTC(y, m, d.getUTCDate() - dow);
  } else if (unit === 'month') b = Date.UTC(y, m, 1);
  else if (unit === 'quarter') b = Date.UTC(y, m - (m % 3), 1);
  else b = Date.UTC(y, 0, 1);
  return b;
}
function next(ms, unit) {
  const d = new Date(ms);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (unit === 'week') return ms + 7 * DAY;
  if (unit === 'month') return Date.UTC(y, m + 1, 1);
  if (unit === 'quarter') return Date.UTC(y, m + 3, 1);
  return Date.UTC(y + 1, 0, 1);
}
function names(ms, unit) {
  const d = new Date(ms);
  const m = d.getUTCMonth();
  if (unit === 'week') return { short: `${MON[m]} ${d.getUTCDate()}`, long: `${MON[m]} ${d.getUTCDate()}` };
  if (unit === 'month') return { short: MON[m][0], long: MON[m] };
  if (unit === 'quarter') return { short: `Q${Math.floor(m / 3) + 1}`, long: `Q${Math.floor(m / 3) + 1}` };
  return { short: String(d.getUTCFullYear()), long: String(d.getUTCFullYear()) };
}

/**
 * The bands between t0 and t1 (ms, UTC). Each: { from, to } clipped to the span, `edge` (true where a
 * calendar boundary falls inside the span, so a hairline is drawn there), and its names { short, long }.
 * `year` is the label for the axis's gutter: the year, or "2025–26" across two, or '' when the bands are years.
 */
export function timeBands(t0, t1) {
  const span = Math.max(DAY, t1 - t0);
  const unit = bandUnit(span / DAY);
  const bands = [];
  let b = firstAtOrAfter(t0, unit);
  let guard = 0;
  while (b < t1 && guard++ < 400) {
    const n = next(b, unit);
    const from = Math.max(b, t0);
    const to = Math.min(n, t1);
    if (to > from) bands.push({ from, to, edge: b > t0, start: iso(b), ...names(b, unit) });
    b = n;
  }
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1 - 1).getUTCFullYear();
  const year = unit === 'year' ? '' : y0 === y1 ? String(y0) : `${y0}–${String(y1).slice(2)}`;
  return { unit, bands, year };
}
