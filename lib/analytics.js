'use strict';
/*
 * Results analytics (BETA, app admins only) — everything past the Results tab's
 * totals / profit / ROI / P&L curve, computed from one user's own tracking_entries.
 *
 * Pure functions, no DB and no I/O: server.js selects the rows and the exchange
 * rates and hands them in (GET /api/analytics). test/analytics.test.js covers the
 * math directly and the route end to end.
 *
 * ── Units ────────────────────────────────────────────────────────────────────
 * A tracking row is ONE EVENT the user played: `num_entries` bullets of `buyin`
 * each, and at most one cash (`cash_amount`, counted only when `cashed` — the same
 * rule as the Results tab's summary, so the totals here equal the totals there).
 *   - "events"  = rows.
 *   - "entries" = bullets (sum of num_entries). Every sample size shown is entries,
 *                 with events beside it; ITM % is cashes per ENTRY, as a re-entry
 *                 that cashes once is one cash in three bullets, not one in one.
 *   - ROI       = (total cashes - total buy-ins) / total buy-ins: cost-weighted, so
 *                 it equals the Results tab's ROI, not the mean of per-event ROIs.
 * Money is converted from each event's native currency (VENUE_CURRENCY below,
 * mirroring vite-app/src/utils/utils.js) into the requested display currency
 * through USD, the same way convertAmount() does on the client. Buy-in BANDS are
 * always cut on the USD value, so a band means the same stake in every currency.
 *
 * ── Bankroll filter (not wired yet) ─────────────────────────────────────────
 * A parallel branch adds `tracking_entries.bankroll_id`. computeAnalytics() takes
 * an optional `bankroll` option: when it is set AND the rows carry a `bankroll_id`
 * field, only that bankroll's rows are analysed. Until the column exists the rows
 * have no such field and the filter is a no-op, reported as
 * `bankroll: { requested, applied: false }` so a client can tell. The route selects
 * `te.*`, so the column flows through without another server change.
 */

// Mirrors VENUE_CURRENCY in vite-app/src/utils/utils.js (every other venue is USD).
const VENUE_CURRENCY = { 'Irish Poker Open': 'EUR', 'WSOP Europe': 'EUR' };
function nativeCurrency(venue) { return VENUE_CURRENCY[venue] || 'USD'; }

// Same arithmetic as the client's convertAmount(): rates are units per 1 USD.
function convert(amount, from, to, rates) {
  if (!amount || !rates || from === to) return amount || 0;
  const inUSD = from === 'USD' ? amount : amount / (rates[from] || 1);
  return to === 'USD' ? inUSD : inUSD * (rates[to] || 1);
}

// Below this many entries a group's ROI is not estimated at all: a percentile
// bootstrap on fewer than ~30 resampling units has too few distinct resamples to
// describe a tail, and a single cash moves the figure by tens of points.
const MIN_ENTRIES = 30;
const BOOTSTRAP_RESAMPLES = 2000;

// ── Bands ───────────────────────────────────────────────────────────────────
// Buy-in (per bullet, USD). Cut where live and online schedules actually step:
// online micros and dailies (<$100), deepstacks/dailies ($100-299), mid series
// events ($300-799: the $400/$600 WSOP and WSOPC tier), the core $1k-$1.7k
// series tier ($800-1,999), the $2k-$5k tier, the $5k-$10k tier, high rollers.
const BUYIN_BANDS = [
  { key: 'b0', label: 'Under $100', min: 0, max: 100 },
  { key: 'b1', label: '$100–299', min: 100, max: 300 },
  { key: 'b2', label: '$300–799', min: 300, max: 800 },
  { key: 'b3', label: '$800–1,999', min: 800, max: 2000 },
  { key: 'b4', label: '$2,000–4,999', min: 2000, max: 5000 },
  { key: 'b5', label: '$5,000–9,999', min: 5000, max: 10000 },
  { key: 'b6', label: '$10,000+', min: 10000, max: Infinity },
];
// Field size (tournaments.total_entries), only where the event recorded one.
const FIELD_BANDS = [
  { key: 'f0', label: 'Under 100', min: 1, max: 100 },
  { key: 'f1', label: '100–299', min: 100, max: 300 },
  { key: 'f2', label: '300–999', min: 300, max: 1000 },
  { key: 'f3', label: '1,000–2,999', min: 1000, max: 3000 },
  { key: 'f4', label: '3,000+', min: 3000, max: Infinity },
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function band(bands, v) {
  for (let i = 0; i < bands.length; i++) if (v >= bands[i].min && v < bands[i].max) return { ...bands[i], order: i };
  return null;
}

// ── Dates ───────────────────────────────────────────────────────────────────
// tournaments.date is usually YYYY-MM-DD but older imports carry free text
// ("Jun 3, 2026"); same rule as the client's normaliseDate().
function normaliseDate(d) {
  if (!d) return '';
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dt = new Date(s + ' 12:00:00');
  if (isNaN(dt.getTime())) return '';
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
// Monday-first index 0..6, from the calendar date alone (UTC, so no zone can shift the day).
function weekdayIndex(iso) {
  if (!iso) return -1;
  const [y, m, d] = iso.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (js + 6) % 7;
}
// "11:00 AM", "7:30 pm", "14:00" → minutes after midnight; unknown → 0. Only orders
// two events on the same day.
function timeMinutes(t) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?/.exec(String(t || ''));
  if (!m) return 0;
  let h = Number(m[1]) % 24;
  const min = Number(m[2] || 0);
  if (m[3]) { h = h % 12; if (/p/i.test(m[3])) h += 12; }
  return h * 60 + min;
}

// ── Normalisation ───────────────────────────────────────────────────────────
// One flat record per event, amounts in the display currency.
function normaliseRow(r, currency, rates) {
  const from = nativeCurrency(r.venue);
  const bullets = Math.max(1, Number(r.num_entries) || 1);
  const buyinNative = Math.max(0, Number(r.buyin) || 0);
  const cashed = !!Number(r.cashed);
  const cashNative = cashed ? Math.max(0, Number(r.cash_amount) || 0) : 0;
  const buyin = convert(buyinNative, from, currency, rates);
  const cash = convert(cashNative, from, currency, rates);
  const cost = buyin * bullets;
  const date = normaliseDate(r.date);
  const field = Number(r.total_entries) > 0 ? Number(r.total_entries) : null;
  const place = Number(r.finish_place) > 0 ? Number(r.finish_place) : null;
  const online = !!Number(r.is_online);
  const variant = String(r.game_variant || '').trim() || 'Unknown';
  // The poker ROOM, not the series title: `property` when the feed named one, the
  // operator for an online event, else the venue string as stored.
  const room = String((online ? (r.site || r.property) : r.property) || r.venue || '').trim() || 'Unknown';
  return {
    id: r.id, eventName: r.event_name || '', date, time: r.time || '',
    createdAt: r.created_at || '', bullets, buyin, buyinUSD: convert(buyinNative, from, 'USD', rates),
    cost, cash, profit: cash - cost, cashed, field, place, online, variant, room,
  };
}

// ── Aggregation ─────────────────────────────────────────────────────────────
function summarise(rows) {
  let events = 0, entries = 0, cost = 0, cash = 0, cashes = 0;
  for (const r of rows) {
    events++; entries += r.bullets; cost += r.cost; cash += r.cash; if (r.cashed) cashes++;
  }
  const profit = cash - cost;
  return {
    events, entries, cashes, cost, cash, profit,
    roi: cost > 0 ? profit / cost : null,
    itm: entries > 0 ? cashes / entries : null,
  };
}

/** Group rows by a key function → [{ key, label, order, ...summarise }], best order first. */
function breakdown(rows, keyOf) {
  const groups = new Map();
  let missing = 0;
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) { missing++; continue; }
    if (!groups.has(k.key)) groups.set(k.key, { key: k.key, label: k.label, order: k.order, rows: [] });
    groups.get(k.key).rows.push(r);
  }
  const out = [...groups.values()].map(g => {
    const s = summarise(g.rows);
    return { key: g.key, label: g.label, order: g.order, ...s, small: s.entries < MIN_ENTRIES, _rows: g.rows };
  });
  // Ordered dimensions (bands, weekdays) keep their order; categorical ones sort by
  // sample size, largest first, so the rows you can trust lead.
  out.sort((a, b) => (a.order != null && b.order != null) ? a.order - b.order : (b.entries - a.entries) || a.label.localeCompare(b.label));
  return { groups: out, missing };
}

const DIMENSIONS = [
  { key: 'buyin', label: 'Buy-in', keyOf: (r) => { if (!(r.buyinUSD > 0)) return null; const b = band(BUYIN_BANDS, r.buyinUSD); return b && { key: b.key, label: b.label, order: b.order }; } },
  { key: 'variant', label: 'Game', keyOf: (r) => ({ key: r.variant.toLowerCase(), label: r.variant }) },
  { key: 'room', label: 'Room', keyOf: (r) => ({ key: r.room.toLowerCase(), label: r.room }) },
  { key: 'format', label: 'Live / online', keyOf: (r) => (r.online ? { key: 'online', label: 'Online', order: 1 } : { key: 'live', label: 'Live', order: 0 }) },
  { key: 'weekday', label: 'Day of week', keyOf: (r) => { const i = weekdayIndex(r.date); return i < 0 ? null : { key: WEEKDAYS[i], label: WEEKDAYS[i], order: i }; } },
  { key: 'field', label: 'Field size', keyOf: (r) => { if (!r.field) return null; const b = band(FIELD_BANDS, r.field); return b && { key: b.key, label: b.label, order: b.order }; } },
];

// ── Variance ────────────────────────────────────────────────────────────────

/**
 * Per-ENTRY return, in buy-ins: each bullet is one sample. A row of k bullets and
 * one cash C contributes one bullet worth (C - B) / B and k - 1 bullets worth -1
 * (which bullet cashed is unknowable and irrelevant to the moments). Freerolls
 * (B = 0) cannot be expressed in buy-ins and are left out of this sample.
 * Also returns the same spread in money (per-entry profit, display currency).
 */
function perEntryReturns(rows) {
  const xs = [], money = [];
  for (const r of rows) {
    if (!(r.buyin > 0)) continue;
    for (let i = 0; i < r.bullets; i++) {
      const payout = i === 0 ? r.cash : 0;
      xs.push((payout - r.buyin) / r.buyin);
      money.push(payout - r.buyin);
    }
  }
  return { xs, money };
}
function meanSd(xs) {
  const n = xs.length;
  if (n === 0) return { n, mean: null, sd: null };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  if (n < 2) return { n, mean, sd: null };
  let ss = 0;
  for (const x of xs) ss += (x - mean) * (x - mean);
  return { n, mean, sd: Math.sqrt(ss / (n - 1)) }; // sample sd (n - 1)
}

// mulberry32: a small seeded PRNG, so the same results always give the same
// interval (a reload must not move the CI) and the tests are exact.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 95% confidence interval on ROI — PERCENTILE BOOTSTRAP over events.
 *
 * Why the bootstrap and not the normal approximation (ROI ± 1.96·SE):
 *   1. Tournament returns are bounded below at -100% and have a long right tail —
 *      one deep run is worth 50-500 buy-ins while most events lose exactly one.
 *      At the sample sizes players have (tens to a few hundred events) the sampling
 *      distribution of ROI is still visibly skewed, so a symmetric ± interval is
 *      wrong in shape: it routinely dips below -100% (impossible) and misplaces
 *      the upper end. The percentile bootstrap inherits the skew from the data and
 *      cannot leave the possible range.
 *   2. ROI here is a RATIO of sums (profit / cost, with cost varying by event), so
 *      the normal route would also need a delta-method variance for the ratio. The
 *      bootstrap recomputes the exact same ratio on every resample instead.
 * The resampling unit is the EVENT (tracking row), not the bullet: a row records one
 * cash against all its bullets, so bullets within a row are not separable, while
 * separate events are the independent draws.
 * Known limit, stated rather than hidden: a bootstrap cannot see a tail the sample
 * never reached. A player with no big score yet gets an interval that is too narrow
 * on the upside. That is one more reason the edge section demands MIN_ENTRIES.
 * Deterministic: seeded from the row count, B = 2000 resamples.
 */
function roiBootstrapCI(rows, { resamples = BOOTSTRAP_RESAMPLES, level = 0.95, seed } = {}) {
  const n = rows.length;
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  if (n < 2 || !(cost > 0)) return null;
  const rand = rng(seed != null ? seed : 0x9E3779B9 ^ n);
  const P = rows.map(r => r.profit), C = rows.map(r => r.cost);
  const stats = [];
  for (let b = 0; b < resamples; b++) {
    let p = 0, c = 0;
    for (let i = 0; i < n; i++) { const j = Math.floor(rand() * n); p += P[j]; c += C[j]; }
    if (c > 0) stats.push(p / c);
  }
  if (stats.length < resamples / 2) return null;
  stats.sort((a, b) => a - b);
  const q = (p) => {
    // Linear interpolation between order statistics (type 7, the R / NumPy default).
    const h = (stats.length - 1) * p;
    const lo = Math.floor(h), hi = Math.ceil(h);
    return stats[lo] + (stats[hi] - stats[lo]) * (h - lo);
  };
  const alpha = (1 - level) / 2;
  return { low: q(alpha), high: q(1 - alpha), level, method: 'percentile bootstrap over events', resamples, n };
}

/** Chronological order: date, then start time, then when it was logged, then id. */
function chronological(rows) {
  return [...rows].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') ||
    timeMinutes(a.time) - timeMinutes(b.time) ||
    String(a.createdAt).localeCompare(String(b.createdAt)) ||
    (Number(a.id) || 0) - (Number(b.id) || 0));
}

/**
 * Downswings on the cumulative P&L, in event order. The starting balance (0, before
 * the first event) counts as a peak, so a losing start is a downswing from zero.
 *   max:     the largest peak-to-trough fall anywhere in the history.
 *   current: the fall from the highest point so far to now (amount 0 at a new high).
 * Each carries the dates it spans and how many events it took.
 */
function drawdowns(ordered) {
  const cum = [];
  let run = 0, peak = 0, peakIdx = -1;
  let max = { amount: 0, peakIdx: -1, troughIdx: -1 };
  ordered.forEach((r, i) => {
    run += r.profit;
    cum.push(run);
    if (run > peak) { peak = run; peakIdx = i; }
    const dd = peak - run;
    if (dd > max.amount) max = { amount: dd, peakIdx, troughIdx: i };
  });
  const at = (i) => (i >= 0 && ordered[i] ? ordered[i].date || null : null);
  let maxOut = { amount: 0, from: null, to: null, events: 0, recovered: null };
  if (max.amount > 0) {
    const peakVal = max.peakIdx < 0 ? 0 : cum[max.peakIdx];
    maxOut = {
      amount: max.amount,
      from: at(max.peakIdx),               // null = from the very start
      to: at(max.troughIdx),
      events: max.troughIdx - max.peakIdx, // events after the peak, through the trough
      recovered: cum.slice(max.troughIdx + 1).some(v => v >= peakVal),
    };
  }
  const currentAmount = peak - run;
  const current = currentAmount > 0
    ? { amount: currentAmount, from: at(peakIdx), events: ordered.length - 1 - peakIdx }
    : { amount: 0, from: null, events: 0 };
  return { max: maxOut, current, final: run, peak };
}

function biggestScore(rows) {
  let best = null;
  for (const r of rows) {
    if (!r.cashed || !(r.cash > 0)) continue;
    if (!best || r.cash > best.cash) best = r;
  }
  if (!best) return null;
  return {
    amount: best.cash, eventName: best.eventName, date: best.date || null,
    place: best.place, field: best.field,
    multiple: best.buyin > 0 ? best.cash / best.buyin : null, // in buy-ins
  };
}

/**
 * Average finish percentile, over events with BOTH a finish place and a field size
 * (place <= field). Reported as "top X%": place / field, so 1st of 1,000 is 0.1%.
 * Players tend to record a place mostly when they cash, so this describes the
 * events with a recorded place, not every event — the count travels with it.
 */
function finishPercentile(rows) {
  const xs = [];
  for (const r of rows) if (r.place && r.field && r.place <= r.field) xs.push(r.place / r.field);
  if (!xs.length) return { n: 0, avgTop: null, medianTop: null };
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return {
    n: xs.length,
    avgTop: xs.reduce((s, x) => s + x, 0) / xs.length,
    medianTop: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
  };
}

// ── Where the edge is ───────────────────────────────────────────────────────
/**
 * For the buy-in and game dimensions: each group's ROI with its own 95% bootstrap
 * interval, ranked by ROI, and a plain status —
 *   'clear'     ≥ MIN_ENTRIES and the interval lies wholly above 0
 *   'unclear'   ≥ MIN_ENTRIES but the interval includes 0
 *   'too-small' < MIN_ENTRIES: no ROI estimate is offered
 * Descriptive only: what the numbers are and how much they can be trusted.
 */
function edgeFor(dim, groups) {
  const ranked = groups.map((g) => {
    const big = g.entries >= MIN_ENTRIES;
    const ci = big ? roiBootstrapCI(g._rows, { seed: hashSeed(dim + ':' + g.key) }) : null;
    let status = 'too-small';
    if (big) status = ci && ci.low > 0 ? 'clear' : 'unclear';
    return { key: g.key, label: g.label, entries: g.entries, events: g.events, roi: g.roi, ci, status };
  });
  const sized = ranked.filter(g => g.status !== 'too-small' && g.roi != null).sort((a, b) => b.roi - a.roi);
  const small = ranked.filter(g => g.status === 'too-small');
  return { ranked: sized, tooSmall: small.map(g => ({ label: g.label, entries: g.entries })) };
}
function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pct(x) { return (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(0) + '%'; }

/** One plain sentence per dimension. */
function edgeSentence(label, e) {
  const top = e.ranked[0];
  if (!top) {
    return `No ${label.toLowerCase()} group has ${MIN_ENTRIES} entries yet, so none has an ROI estimate.`;
  }
  const clear = e.ranked.filter(g => g.status === 'clear');
  if (clear.length) {
    const g = clear[0];
    return `${g.label} has the highest ROI whose 95% interval is above break-even: ${pct(g.roi)} over ${g.entries} entries (${pct(g.ci.low)} to ${pct(g.ci.high)}).`;
  }
  return `${top.label} has the highest ROI, ${pct(top.roi)} over ${top.entries} entries, but its 95% interval (${top.ci ? pct(top.ci.low) + ' to ' + pct(top.ci.high) : 'n/a'}) includes break-even — the sample cannot tell it apart from zero.`;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * @param {object[]} rawRows  tracking_entries joined to tournaments (see server.js GET /api/analytics)
 * @param {object}   [opts]
 * @param {string}   [opts.currency='USD']  display currency (one of the exchange-rate keys)
 * @param {object}   [opts.rates]           units per 1 USD; without it, no conversion happens
 * @param {*}        [opts.bankroll]        optional bankroll id — see the header comment
 */
function computeAnalytics(rawRows, opts = {}) {
  const currency = opts.currency || 'USD';
  const rates = opts.rates || null;
  const requested = opts.bankroll == null || opts.bankroll === '' || opts.bankroll === 'all' ? null : String(opts.bankroll);
  let source = rawRows || [];
  const canFilter = requested != null && source.some(r => r && Object.prototype.hasOwnProperty.call(r, 'bankroll_id'));
  if (canFilter) source = source.filter(r => String(r.bankroll_id) === requested);

  const rows = source.map(r => normaliseRow(r, currency, rates));
  const ordered = chronological(rows);
  const totals = summarise(rows);

  const breakdowns = {};
  const edgeDims = {};
  for (const d of DIMENSIONS) {
    const { groups, missing } = breakdown(rows, d.keyOf);
    breakdowns[d.key] = {
      label: d.label,
      missing,
      rows: groups.map(({ _rows, order, ...g }) => g),
    };
    if (d.key === 'buyin' || d.key === 'variant') edgeDims[d.key] = { label: d.label, groups };
  }

  const per = perEntryReturns(rows);
  const ms = meanSd(per.xs);
  const msMoney = meanSd(per.money);
  const dd = drawdowns(ordered);
  const avgBuyin = totals.entries > 0 ? totals.cost / totals.entries : 0;
  const inBuyins = (amt) => (avgBuyin > 0 ? amt / avgBuyin : null);

  const edge = {
    minEntries: MIN_ENTRIES,
    dimensions: Object.entries(edgeDims).map(([key, { label, groups }]) => {
      const e = edgeFor(key, groups);
      return { key, label, ...e, sentence: edgeSentence(label, e) };
    }),
  };

  return {
    beta: true,
    currency,
    bankroll: { requested, applied: canFilter },
    totals,
    breakdowns,
    variance: {
      perEntry: { n: ms.n, mean: ms.mean, sd: ms.sd, sdAmount: msMoney.sd },
      roiCI: roiBootstrapCI(rows),
      maxDrawdown: { ...dd.max, inBuyins: inBuyins(dd.max.amount) },
      currentDrawdown: { ...dd.current, inBuyins: inBuyins(dd.current.amount) },
      biggestScore: biggestScore(rows),
      finishPercentile: finishPercentile(rows),
      avgBuyin,
    },
    edge,
  };
}

module.exports = {
  computeAnalytics,
  // exported for the unit tests
  normaliseRow, summarise, breakdown, perEntryReturns, meanSd, roiBootstrapCI,
  drawdowns, chronological, biggestScore, finishPercentile, edgeFor, edgeSentence,
  weekdayIndex, timeMinutes, normaliseDate, convert, nativeCurrency,
  BUYIN_BANDS, FIELD_BANDS, MIN_ENTRIES, BOOTSTRAP_RESAMPLES,
};
