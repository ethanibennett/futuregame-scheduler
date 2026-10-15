// The Admin screen's growth table (components/GrowthReport.jsx) from GET /api/admin/growth
// (lib/growth.js report). Pure, so Node can test it.

const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 12" from a week's Monday, YYYY-MM-DD. */
export function weekLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}` : String(iso || '');
}

/** One row per sign-up week, newest first: { key, week, signups, activated, d7, d30 } as display text.
 *  D7 and D30 show only once some of the week's sign-ups are old enough to have them. */
export function growthRows(report) {
  const weeks = (report && Array.isArray(report.weeks)) ? report.weeks : [];
  return weeks.map((w) => ({
    key: w.week,
    week: weekLabel(w.week),
    signups: String(w.signups || 0),
    activated: pct(w.activated7, w.signups),
    d7: pct(w.d7, w.d7Ready),
    d30: pct(w.d30, w.d30Ready),
  }));
}

/** The first-week line under the table: set up, logged a result, shared, sent a buddy request (as a
 *  share of sign-ups) and saves per activated account. '' with no sign-ups. */
export function firstWeekLine(report) {
  const t = report && report.totals;
  if (!t || !t.signups) return '';
  const p = (n) => `${Math.round((n / t.signups) * 100)}%`;
  const saves = t.activated7 ? (Math.round((t.savesFirst7 / t.activated7) * 10) / 10).toString() : '—';
  return `First week: set up ${p(t.onboarded7 || 0)} · logged a result ${p(t.results7 || 0)} · shared ${p(t.shared7 || 0)} · sent a buddy request ${p(t.followed7 || 0)} · ${saves} saves per activated account`;
}

/** "meta-m1 4 · friend 2 · reddit 1": the sources across the report, most first, at most `n`. */
export function topSources(report, n = 6) {
  const src = (report && report.totals && report.totals.sources) || {};
  return Object.entries(src).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n)
    .map(([k, v]) => `${k} ${v}`).join(' · ');
}
