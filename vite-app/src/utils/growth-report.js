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

/* ── The Monday scorecard (GET /api/admin/growth/scorecard; lib/growth.js scorecard) ── */

const dollars = (cents) => (cents == null ? '—' : '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }));
const pctOf = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const one = (v) => (v == null ? '—' : String(Math.round(v * 10) / 10));
const SCORE = {
  newAccounts: { label: 'New accounts', fmt: (v) => String(v ?? 0), target: (k) => String(k.target), act: (k) => '<' + k.act },
  organicShare: { label: 'Organic share of new accounts', fmt: pctOf, target: (k) => pctOf(k.target), act: (k) => '<' + pctOf(k.act) },
  activation: { label: 'Activation (a save within 7 days)', fmt: pctOf, target: (k) => pctOf(k.target), act: (k) => '<' + pctOf(k.act) },
  savesPerActivated: { label: 'Saves per activated account, first 7 days', fmt: one },
  sharesPer100: { label: 'Schedules shared per 100 new accounts', fmt: one },
  followsPer100: { label: 'Buddy requests per 100 new accounts', fmt: one },
  d1: { label: 'D1 retention', fmt: pctOf },
  d7: { label: 'D7 retention', fmt: pctOf, target: (k) => pctOf(k.target), act: (k) => '<' + pctOf(k.act) },
  d30: { label: 'D30 retention', fmt: pctOf, target: (k) => pctOf(k.target), act: (k) => '<' + pctOf(k.act) },
  costPerPaidSignup: { label: 'Ad spend per paid sign-up', fmt: dollars },
  costPerActivated: { label: 'Cost per activated account (paid)', fmt: dollars, target: (k) => dollars(k.target), act: (k) => '>' + dollars(k.act) },
};
const STATUS_WORD = { ok: 'On target', watch: 'Watch', act: 'Act' };

/** The scorecard's rows as display text: { key, label, value, target, status, statusWord, week }. The
 *  week is the cohort the figure is read from ("Jan 4"), since each needs a different age. */
export function scorecardRows(sc) {
  const figs = (sc && Array.isArray(sc.figures)) ? sc.figures : [];
  return figs.filter((f) => SCORE[f.key]).map((f) => {
    const d = SCORE[f.key];
    const k = { target: f.target, act: f.act };
    return {
      key: f.key,
      label: d.label,
      value: d.fmt(f.value),
      target: d.target && f.target != null ? `${d.target(k)} · act ${d.act(k)}` : '',
      status: f.status || null,
      statusWord: f.status ? STATUS_WORD[f.status] : '',
      week: weekLabel(f.week),
    };
  });
}

/** "Meta $45 · Apple Ads $10 · total $55" for the week's spend, or '' with none entered. */
const CHANNEL_NAME = { apple: 'Apple Ads', meta: 'Meta', creators: 'Creators', podcasts: 'Podcasts', reddit: 'Reddit', x: 'X', other: 'Other' };
export function channelName(c) { return CHANNEL_NAME[c] || c; }
export function spendLine(sc) {
  const ch = (sc && sc.spend && sc.spend.channels) || {};
  const parts = Object.entries(ch).sort((a, b) => b[1] - a[1]).map(([c, cents]) => `${channelName(c)} ${dollars(cents)}`);
  return parts.length ? `${parts.join(' · ')} · total ${dollars(sc.spend.totalCents)}` : '';
}
