// ── The bankroll Reports filters (beta, app admins) ───────────────────────────────────────
// Pure and dependency-free (runs under `node --test`). Works on the facts of
// GET /api/bankrolls/reports (lib/bankroll-reports.js): one per tournament result, ended cash
// session and expense / income row, amounts in the dashboard's currency.
//
// The model: every dimension is a multi-select of keys — OR within a dimension, AND across them —
// plus one date range. An empty dimension does not filter. A fact with no value for a dimension
// (an expense has no room) never matches an active filter on it. Chip counts are FACETED: an
// option's count is what you would get if you tapped it, i.e. the facts passing every OTHER
// dimension's filter with that option's value.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// When a session starts, in the player's own day. Late night wraps midnight.
export const DAYPARTS = [
  { key: 'morning', label: 'Morning', from: 6, to: 12 },
  { key: 'afternoon', label: 'Afternoon', from: 12, to: 17 },
  { key: 'evening', label: 'Evening', from: 17, to: 22 },
  { key: 'night', label: 'Late night', from: 22, to: 6 },
];
// Per-bullet tournament buy-in, cut on USD — the same bands as lib/analytics.js BUYIN_BANDS.
export const BUYIN_BANDS = [
  { key: 'b0', label: 'Under $100', min: 0, max: 100 },
  { key: 'b1', label: '$100–299', min: 100, max: 300 },
  { key: 'b2', label: '$300–799', min: 300, max: 800 },
  { key: 'b3', label: '$800–1,999', min: 800, max: 2000 },
  { key: 'b4', label: '$2,000–4,999', min: 2000, max: 5000 },
  { key: 'b5', label: '$5,000–9,999', min: 5000, max: 10000 },
  { key: 'b6', label: '$10,000+', min: 10000, max: Infinity },
];
export const TYPES = [
  { key: 'tournament', label: 'Tournaments' },
  { key: 'cash', label: 'Cash' },
  { key: 'expenses', label: 'Expenses' },
];
export const FORMATS = [{ key: 'live', label: 'Live' }, { key: 'online', label: 'Online' }];
export const DATE_PRESETS = [
  { key: 'all', label: 'All time' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '12m', label: '12 months' },
];

const pad = (n) => String(n).padStart(2, '0');

/** The fact's group for the Type filter: expense and income rows are both "Expenses". */
export function kindOf(f) {
  return f.type === 'tournament' ? 'tournament' : f.type === 'cash' ? 'cash' : 'expenses';
}
/** Monday-first 0..6 from the calendar date alone (UTC, so no zone moves the day). */
export function weekdayOf(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return -1;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
export function daypartOf(hour) {
  if (hour == null || !(hour >= 0 && hour <= 23)) return null;
  for (const p of DAYPARTS) {
    if (p.from < p.to ? hour >= p.from && hour < p.to : hour >= p.from || hour < p.to) return p.key;
  }
  return null;
}
export function hourLabel(h) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? 'AM' : 'PM'}`;
}
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
export function buyinBand(usd) {
  if (!(usd > 0)) return null;
  for (let i = 0; i < BUYIN_BANDS.length; i++) if (usd >= BUYIN_BANDS[i].min && usd < BUYIN_BANDS[i].max) return { ...BUYIN_BANDS[i], order: i };
  return null;
}
/** '2/5' → [2, 5]; '1/2/5' → [1, 2, 5]. For ordering stakes small to large. */
export function stakesParts(s) {
  return String(s || '').split('/').map((x) => Number(String(x).replace(/[^\d.]/g, ''))).filter((x) => Number.isFinite(x));
}
function stakesOrder(s) {
  const p = stakesParts(s);
  if (!p.length) return 1e12;
  return p[p.length - 1] * 1e6 + (p[0] || 0);
}

/**
 * Adds the derived dimensions to each fact (a new object; the input is not changed):
 *   kind, weekday (0..6), hour (cash: the LOCAL hour of started_at, in the viewer's zone), daypart,
 *   month ('YYYY-MM'), year, roomKey, gameKey, format ('live'|'online'|null), stakesKey
 *   ('cs:2/5' for a cash stake, 'bi:b2' for a tournament buy-in band) with its label and order.
 * `localHour(iso)` is injectable for tests; the default reads the Date in the page's zone.
 */
export function prepareFacts(facts, { localHour } = {}) {
  const lh = localHour || ((iso) => { const t = new Date(iso); return isNaN(t.getTime()) ? null : t.getHours(); });
  return (facts || []).map((f) => {
    const kind = kindOf(f);
    const hour = kind === 'cash' ? (f.started_at ? lh(f.started_at) : null) : kind === 'tournament' ? (f.hour == null ? null : Number(f.hour)) : null;
    let stakesKey = null, stakesLabel = '', stakesOrd = 0;
    if (kind === 'cash' && f.stakes) { stakesKey = 'cs:' + f.stakes; stakesLabel = f.stakes; stakesOrd = stakesOrder(f.stakes); }
    if (kind === 'tournament') {
      const b = buyinBand(f.buyin_usd);
      if (b) { stakesKey = 'bi:' + b.key; stakesLabel = b.label; stakesOrd = 1e13 + b.order; }
    }
    const room = String(f.room || '').trim();
    const game = String(f.game || '').trim();
    return {
      ...f,
      kind,
      weekday: weekdayOf(f.date),
      hour,
      daypart: daypartOf(hour),
      month: f.date ? f.date.slice(0, 7) : '',
      year: f.date ? f.date.slice(0, 4) : '',
      roomKey: room ? room.toLowerCase() : null,
      gameKey: game ? game.toLowerCase() : null,
      format: kind === 'expenses' ? null : f.online ? 'online' : 'live',
      stakesKey, stakesLabel, stakesOrd,
    };
  });
}

// ── The filter dimensions ───────────────────────────────────────────────────────────────
// key: the filters field; valueOf: a prepared fact's value (null = none); options: the chips.
const BY_KEY = (list) => new Map(list.map((x, i) => [x.key, { ...x, order: i }]));
const TYPE_MAP = BY_KEY(TYPES), FORMAT_MAP = BY_KEY(FORMATS), PART_MAP = BY_KEY(DAYPARTS);

export const DIMENSIONS = [
  { key: 'types', label: 'Type', valueOf: (f) => f.kind, ordered: true, fixed: TYPES },
  { key: 'bankrolls', label: 'Bankroll', valueOf: (f) => String(f.bankroll), ordered: true },
  { key: 'games', label: 'Game', valueOf: (f) => f.gameKey },
  { key: 'stakes', label: 'Stakes / buy-in', valueOf: (f) => f.stakesKey, ordered: true },
  { key: 'rooms', label: 'Room', valueOf: (f) => f.roomKey },
  { key: 'formats', label: 'Live / online', valueOf: (f) => f.format, ordered: true, fixed: FORMATS },
  { key: 'weekdays', label: 'Day of week', valueOf: (f) => (f.weekday >= 0 ? String(f.weekday) : null), ordered: true,
    fixed: WEEKDAYS.map((label, i) => ({ key: String(i), label })) },
  { key: 'dayparts', label: 'Start time', valueOf: (f) => f.daypart, ordered: true, fixed: DAYPARTS },
];
export const DIM_KEYS = DIMENSIONS.map((d) => d.key);
const DIM = new Map(DIMENSIONS.map((d) => [d.key, d]));

export function emptyFilters() {
  const f = { range: 'all' };
  for (const k of DIM_KEYS) f[k] = [];
  return f;
}
/** A stored or partial value made whole and safe (unknown fields dropped, arrays of strings). */
export function normaliseFilters(raw) {
  const f = emptyFilters();
  if (!raw || typeof raw !== 'object') return f;
  if (typeof raw.range === 'string' && (DATE_PRESETS.some((p) => p.key === raw.range) || /^y\d{4}$/.test(raw.range))) f.range = raw.range;
  for (const k of DIM_KEYS) if (Array.isArray(raw[k])) f[k] = [...new Set(raw[k].map(String))];
  return f;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
/** The dates a range covers, inclusive; null bounds are open. `today` is YYYY-MM-DD. */
export function rangeWindow(range, today) {
  if (range === '30d') return { from: addDays(today, -29), to: today };
  if (range === '90d') return { from: addDays(today, -89), to: today };
  if (range === '12m') return { from: addDays(today, -364), to: today };
  const y = /^y(\d{4})$/.exec(range || '');
  if (y) return { from: `${y[1]}-01-01`, to: `${y[1]}-12-31` };
  return { from: null, to: null };
}
export function rangeLabel(range) {
  const p = DATE_PRESETS.find((x) => x.key === range);
  if (p) return p.label;
  const y = /^y(\d{4})$/.exec(range || '');
  return y ? y[1] : 'All time';
}
/** The years the facts span, newest first, as range keys. */
export function yearOptions(facts) {
  return [...new Set(facts.map((f) => f.year).filter(Boolean))].sort().reverse().map((y) => ({ key: 'y' + y, label: y }));
}

function passes(f, filters, win, skip) {
  if (win.from && f.date < win.from) return false;
  if (win.to && f.date > win.to) return false;
  for (const d of DIMENSIONS) {
    if (d.key === skip) continue;
    const want = filters[d.key];
    if (!want || !want.length) continue;
    const v = d.valueOf(f);
    if (v == null || !want.includes(v)) return false;
  }
  return true;
}
/** The facts that pass every filter. */
export function applyFilters(facts, filters, today) {
  const win = rangeWindow(filters.range, today);
  return facts.filter((f) => passes(f, filters, win, null));
}
/** Faceted count per option of one dimension: { [key]: n } over the facts passing the others. */
export function facetCounts(facts, filters, dimKey, today) {
  const d = DIM.get(dimKey);
  const win = rangeWindow(filters.range, today);
  const out = {};
  for (const f of facts) {
    if (!passes(f, filters, win, dimKey)) continue;
    const v = d.valueOf(f);
    if (v != null) out[v] = (out[v] || 0) + 1;
  }
  return out;
}
/** Range chips' counts: the facts passing every dimension filter inside each range. */
export function rangeCounts(facts, filters, today, ranges) {
  const out = {};
  for (const r of ranges) {
    const win = rangeWindow(r.key, today);
    out[r.key] = facts.reduce((n, f) => n + (passes(f, filters, win, null) ? 1 : 0), 0);
  }
  return out;
}

/**
 * The chips for one dimension: [{ key, label }] over EVERY fact (so a chip does not vanish when
 * another filter empties it; it shows 0). Fixed lists keep their order; stakes run cash small to
 * large then tournament bands; rooms and games run most played first. Selected keys with no fact
 * left are kept so they can be cleared. `names` maps a bankroll key to its name.
 */
export function optionsFor(facts, dimKey, { selected = [], names = null } = {}) {
  const d = DIM.get(dimKey);
  let list;
  if (d.fixed) {
    list = d.fixed.map((o) => ({ key: o.key, label: o.label }));
  } else {
    const seen = new Map();
    for (const f of facts) {
      const v = d.valueOf(f);
      if (v == null) continue;
      const cur = seen.get(v);
      if (cur) { cur.n++; continue; }
      let label = v, order = 0;
      if (dimKey === 'rooms') label = String(f.room).trim();
      else if (dimKey === 'games') label = String(f.game).trim();
      else if (dimKey === 'stakes') { label = f.stakesLabel; order = f.stakesOrd; }
      else if (dimKey === 'bankrolls') { label = names && names.get ? (names.get(v) || v) : v; order = v === 'main' ? -1 : Number(v) || 0; }
      seen.set(v, { key: v, label, order, n: 1 });
    }
    list = [...seen.values()];
    if (d.ordered) list.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    else list.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    list = list.map(({ key, label }) => ({ key, label }));
  }
  for (const k of selected) if (!list.some((o) => o.key === k)) list.push({ key: k, label: k });
  return list;
}

export function toggle(filters, dimKey, key) {
  const cur = filters[dimKey] || [];
  return { ...filters, [dimKey]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
}
export function setRange(filters, range) { return { ...filters, range }; }
export function clearDim(filters, dimKey) { return dimKey === 'range' ? { ...filters, range: 'all' } : { ...filters, [dimKey]: [] }; }
export function clearAll() { return emptyFilters(); }
/** How many filters are on: one per dimension with a selection, plus a range other than all. */
export function activeCount(filters) {
  return DIM_KEYS.filter((k) => filters[k] && filters[k].length).length + (filters.range && filters.range !== 'all' ? 1 : 0);
}

/**
 * The compact bar's text: one part per active filter, in the sheet's order, e.g.
 * ['2026', 'Cash', 'Borgata, Parx', 'Sat, Sun']; more than `max` values in a dimension read
 * "3 rooms". `labelOf(dimKey, key)` names a key (the sheet's option labels).
 */
const PLURAL = { types: 'types', bankrolls: 'bankrolls', games: 'games', stakes: 'stakes', rooms: 'rooms', formats: 'formats', weekdays: 'days', dayparts: 'times' };
export function summaryParts(filters, labelOf, { max = 2 } = {}) {
  const out = [];
  if (filters.range && filters.range !== 'all') out.push({ dim: 'range', text: rangeLabel(filters.range) });
  for (const d of DIMENSIONS) {
    const keys = filters[d.key] || [];
    if (!keys.length) continue;
    const text = keys.length > max ? `${keys.length} ${PLURAL[d.key]}` : keys.map((k) => labelOf(d.key, k)).join(', ');
    out.push({ dim: d.key, text });
  }
  return out;
}
/** The label a dimension gives a key, from the fixed lists (others come from optionsFor). */
export function fixedLabel(dimKey, key) {
  const m = dimKey === 'types' ? TYPE_MAP : dimKey === 'formats' ? FORMAT_MAP : dimKey === 'dayparts' ? PART_MAP : null;
  if (m) return m.has(key) ? m.get(key).label : key;
  if (dimKey === 'weekdays') return WEEKDAYS[Number(key)] || key;
  return null;
}
