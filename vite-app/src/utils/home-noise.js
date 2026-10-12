// ── The home's signal-or-noise line (verdict section 6; admins) ────────────────────────────────
// One plain sentence under the period block that answers "is this real?" for the window it shows
// (the month, the trip or the series): how often the player's own long-run rate produces a
// stretch like this one, and whether that long-run rate can yet be told apart from break-even.
// Written as description, never as advice. Pure and dependency-free past fmtPct/plural, so it runs
// under `node --test` (src/utils/__tests__/home-noise.test.mjs; `npm run test:home`).
//
// TOURNAMENTS come from GET /api/analytics?from=&to=[&venue=][&bankroll=] (lib/analytics.js): the
// window's buy-ins and bullets, and the share of resampled stretches of as many events, drawn from
// the whole history, that do no better (pct) or as well (pctAbove) — the same percentile bootstrap
// over events as the Analytics sheet's ROI interval, so the two never disagree.
// CASH comes from the combined ledger's cash entries (cashSpread here): a per-hour spread, and a
// normal approximation for a window of H hours. Tournament returns are too skewed for that; a cash
// session's are not, and it is the standard SD-per-hour model.
//
// The same too-few rule as Analytics' edge verdicts: under MIN (30) entries — or 30 timed sessions
// for cash — nothing is judged, and the line becomes progress ('18 of 30 entries before this can
// separate skill from luck'). An interval (95%, the Analytics sheet's) is above, below or includes
// break-even; nothing else. The sentence is kept to two 35g lines at the phone's width: the window
// with its sample, how often the long-run rate does as badly (or as well), and that rate's interval
// with its sample.
import { fmtPct, plural } from './home-period.js';

export const MIN_SAMPLE = 30;
const MINUS = '−';

// ── Versions (what the cached answers are keyed on) ─────────────────────────────────────────
/** FNV-1a over a string, as 8 hex digits. */
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
/**
 * A version of the user's results (GET /api/tracking rows): changes whenever a result is added,
 * removed or edited in anything the analytics read. Order-free.
 */
export function resultsVersion(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean).map((r) => [
    r.id, r.tournament_id, r.num_entries, r.cashed, r.cash_amount, r.finish_place, r.date, r.buyin, r.venue, r.bankroll_id,
  ].map((v) => (v == null ? '' : String(v))).join(','));
  list.sort();
  return `${list.length}.${fnv(list.join(';'))}`;
}
/** A version of the bankroll summary's totals (any game, expense or move changes it). */
export function summaryVersion(summary) {
  const a = summary && summary.all;
  if (!a) return '0';
  return fnv(JSON.stringify([a.count, a.results, a.moved, a.by_source || null]));
}

// ── Cash: a per-hour spread over the ledger's cash entries ────────────────────────────────
/**
 * Every timed cash session in `entries` (GET /api/bankrolls/ledger rows with source
 * 'cash-sessions' and hours > 0; amount_display is the session's net in the display currency).
 * Each session's result is modelled as rate x hours plus noise whose variance grows with its hours:
 *   hourly = sum(profit) / sum(hours)
 *   sd     = sqrt( sum((p - hourly x h)^2 / h) / (n - 1) )   per hour of play
 * -> { sessions, hours, profit, hourly, sd } (sd null under 2 sessions); null with no timed session.
 */
export function cashSpread(entries) {
  const xs = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || e.source !== 'cash-sessions') continue;
    const h = Number(e.hours);
    if (!(h > 0)) continue;
    xs.push({ p: Number(e.amount_display) || 0, h });
  }
  if (!xs.length) return null;
  const hours = xs.reduce((a, x) => a + x.h, 0);
  const profit = xs.reduce((a, x) => a + x.p, 0);
  const hourly = profit / hours;
  let ss = 0;
  for (const x of xs) ss += ((x.p - hourly * x.h) ** 2) / x.h;
  return { sessions: xs.length, hours, profit, hourly, sd: xs.length > 1 ? Math.sqrt(ss / (xs.length - 1)) : null };
}

/** The standard normal CDF (Abramowitz and Stegun 7.1.26, |error| < 1.5e-7). */
export function normCdf(z) {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * A window of cash play (its profit over its hours) against the long-run spread: the share of
 * stretches of as many hours, at the long-run rate, that end at or below it (pct) and at or above
 * it (pctAbove). -> { rate, hours, pct, pctAbove } or null when it cannot be said (no hours, or no
 * spread yet). A spread of zero is a point: the window is on it (both 1) or off it.
 */
export function cashWindowOdds(spread, profit, hours) {
  if (!spread || spread.sd == null || !(hours > 0)) return null;
  const mean = spread.hourly * hours;
  const p = Number(profit) || 0;
  if (!(spread.sd > 0)) {
    const on = Math.abs(p - mean) < 1e-6;
    return { rate: p / hours, hours, pct: on || p < mean ? 1 : 0, pctAbove: on || p > mean ? 1 : 0 };
  }
  const z = (p - mean) / (spread.sd * Math.sqrt(hours));
  return { rate: p / hours, hours, pct: normCdf(z), pctAbove: 1 - normCdf(z) };
}

/** The long-run hourly rate's 95% interval: hourly +/- 1.96 sd / sqrt(hours). */
export function cashInterval(spread) {
  if (!spread || spread.sd == null || !(spread.hours > 0)) return null;
  const half = 1.959964 * spread.sd / Math.sqrt(spread.hours);
  return { low: spread.hourly - half, high: spread.hourly + half };
}

// ── Words ───────────────────────────────────────────────────────────────────────────────
/** 'includes' when the interval reaches break-even from either side, else 'above' / 'below'. */
export function ciVerdict(low, high) {
  if (low > 0) return 'above';
  if (high < 0) return 'below';
  return 'includes';
}
const VERDICT = { above: 'is above break-even', below: 'is below break-even', includes: 'includes break-even' };

/**
 * How often, as words: 'most', 'about half of', 'about 2 in 5', 'about 1 in 3', 'about 1 in 40',
 * 'fewer than 1 in 100'. Under 1 in 20 it rounds to tens, since a bootstrap's tail is not more
 * precise than that. ('most': ties make both sides large, e.g. two bullets without a cash, which
 * most two-event stretches share.)
 */
export function oneIn(p) {
  if (p == null || !(p >= 0)) return null;
  if (p >= 0.55) return 'most';
  if (p >= 0.45) return 'about half of';
  if (p >= 0.35) return 'about 2 in 5';
  if (p < 0.01) return 'fewer than 1 in 100';
  const n = 1 / p;
  return `about 1 in ${n < 20 ? Math.round(n) : Math.round(n / 10) * 10}`;
}

function trim1(x) { const r = Math.round(x * 10) / 10; return r % 1 === 0 ? String(r) : r.toFixed(1); }
/** '−11 buy-ins', '+2.5 buy-ins', '−1 buy-in': whole from 10, one decimal under it. */
export function fmtBuyins(x) {
  const v = Number(x);
  if (x == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const body = a >= 10 ? String(Math.round(a)) : trim1(a);
  const sign = body === '0' ? '' : v < 0 ? MINUS : '+';
  return `${sign}${body} buy-in${body === '1' ? '' : 's'}`;
}
/** Hours as the home writes them: '8 h', '2.5 h', '212 h'. */
export function fmtHours(h) { return `${h >= 100 ? Math.round(h).toLocaleString('en-US') : trim1(h)} h`; }

// ── The line ──────────────────────────────────────────────────────────────────────────────
// A sentence is a list of segments: plain strings, and { em } for a figure (drawn in the full ink
// colour so the numbers can be read at a glance). `text` is the same sentence as one string.
const em = (s) => ({ em: s });
const finish = (kind, game, segs) => ({ kind, game, segs, text: segs.map((s) => (typeof s === 'string' ? s : s.em)).join('') });

/** Which game the window is about: the one that moved its net more (only games that happened). */
export function windowGame(stats) {
  const m = stats && stats.mtt && stats.mtt.events > 0 ? stats.mtt : null;
  const c = stats && stats.cash && stats.cash.sessions > 0 && stats.cash.hours > 0 ? stats.cash : null;
  if (m && c) return Math.abs(Number(c.profit) || 0) > Math.abs(Number(m.profit) || 0) ? 'cash' : 'mtt';
  return m ? 'mtt' : c ? 'cash' : null;
}

/**
 * The sentence for the period block's window, or null when there is nothing to say yet (still
 * loading, or no history at all). input:
 *   stats      the period's own figures for the window (home-period.js: { mtt, cash })
 *   analytics  GET /api/analytics?from=&to= payload (null while it loads; false when it failed)
 *   cash       cashSpread over every timed cash session (null while it loads; false if it failed)
 *   money(v, signed)  money in the display currency, whole units
 * -> { kind: 'progress' | 'window' | 'longrun', game: 'mtt' | 'cash', segs, text } | null
 */
export function noiseLine({ stats, analytics, cash, money, min = MIN_SAMPLE }) {
  let game = windowGame(stats);
  // The cash history could not load: say what can be said about the window's tournaments, if any.
  if (game === 'cash' && cash === false) game = stats.mtt && stats.mtt.events > 0 ? 'mtt' : null;
  if (game === 'cash') {
    if (cash == null) return null;
    const n = cash.sessions;
    if (n < min) return finish('progress', 'cash', [em(`${n} of ${min}`), ' sessions before this can separate skill from luck.']);
    const odds = cashWindowOdds(cash, stats.cash.profit, stats.cash.hours);
    const ci = cashInterval(cash);
    if (!odds || !ci) return null;
    const low = odds.pct <= odds.pctAbove;
    const p = low ? odds.pct : odds.pctAbove;
    return finish('window', 'cash', [
      em(`${money(odds.rate, true)}/h`), ' over ', em(fmtHours(odds.hours)), ': ', em(oneIn(p)),
      ` stretches this long do ${low ? 'no better' : 'as well'} at your long-run rate. Its interval over `, em(fmtHours(cash.hours)), ', ',
      em(`${money(ci.low, true)} to ${money(ci.high, true)} an hour`), `, ${VERDICT[ciVerdict(ci.low, ci.high)]}.`,
    ]);
  }
  if (!analytics) return null;
  const entries = analytics.totals ? Number(analytics.totals.entries) || 0 : 0;
  if (!entries) return null;
  const progress = () => finish('progress', 'mtt', [em(`${entries} of ${min}`), ' entries before this can separate skill from luck.']);
  if (entries < min) return progress();
  const ciObj = analytics.variance && analytics.variance.roiCI;
  const ciSegs = ciObj
    ? ['Its interval over ', em(plural(entries, 'entry', 'entries')), ', ', em(`${fmtPct(ciObj.low)} to ${fmtPct(ciObj.high)}`),
      `, ${VERDICT[ciVerdict(ciObj.low, ciObj.high)]}.`]
    : null;
  const w = analytics.window;
  if (game === 'mtt' && w && w.events > 0 && w.pct != null && w.sumBuyins != null) {
    const low = w.pct <= w.pctAbove;
    const p = low ? w.pct : w.pctAbove;
    return finish('window', 'mtt', [
      em(fmtBuyins(w.sumBuyins)), ' over ', em(plural(w.n, 'bullet')), ': ', em(oneIn(p)),
      ` stretches this long do ${low ? 'no better' : 'as well'} at your long-run rate.`, ...(ciSegs ? [' ', ...ciSegs] : []),
    ]);
  }
  // Nothing in the window to judge (or freerolls only): the long run on its own.
  if (!ciObj) return null;
  const roi = analytics.totals.roi;
  return finish('longrun', 'mtt', [
    'Your ROI over ', em(plural(entries, 'entry', 'entries')), ' is ', em(roi == null ? '—' : fmtPct(roi)), '; its interval, ',
    em(`${fmtPct(ciObj.low)} to ${fmtPct(ciObj.high)}`), `, ${VERDICT[ciVerdict(ciObj.low, ciObj.high)]}.`,
  ]);
}

/** The analytics request for a window: GET /api/analytics?... (the bankroll scope only when narrowed). */
export function analyticsPath(win, currency) {
  const q = [`currency=${encodeURIComponent(currency || 'USD')}`, `from=${win.from}`, `to=${win.to}`];
  if (win.venue) q.push(`venue=${encodeURIComponent(win.venue)}`);
  if (win.scope && win.scope !== 'all') q.push(`bankroll=${encodeURIComponent(win.scope)}`);
  return `/analytics?${q.join('&')}`;
}
