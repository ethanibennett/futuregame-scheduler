// ── Quick-add: shared bits for the rules ──────────────────────────────────

/* Order of the gap list. A gap's sort key is [stage, street, index, sub]; the
   list is asked first-to-last, most fundamental first. */
export const STAGE = {
  game: 0,
  structure: 1,
  blinds: 2,
  players: 3,
  hero: 4,
  positions: 5,
  stacks: 6,
  heroCards: 7,
  cards: 8,
  actions: 9,
  draws: 10,
  board: 11,
  showdown: 12,
  result: 13,
};

/* A gap as the contract defines it, plus an internal sort key that findGaps
   strips. `auto: true` (an addition to the contract, optional for callers)
   marks a gap whose first option is a mechanical fix the UI may apply without
   asking — the answer follows from the hand itself. */
export function makeGap({ id, kind, field, question, options, allowFree, blocking, auto }, key) {
  const g = { id, kind, field, question, blocking: !!blocking };
  if (options && options.length) g.options = dedupeOptions(options);
  if (allowFree) g.allowFree = true;
  if (auto) g.auto = true;
  Object.defineProperty(g, '_key', { value: key || [99], enumerable: false });
  return g;
}

function dedupeOptions(options) {
  const seen = new Set();
  const out = [];
  for (const o of options) {
    if (!o) continue;
    const k = JSON.stringify(o.value);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  return out;
}

export function compareKeys(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] == null ? -1 : a[i];
    const y = b[i] == null ? -1 : b[i];
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/* 12500 -> "12,500"; 0.5 -> "0.5". Locale-free so Node and browsers agree. */
export function fmt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const frac = abs - whole;
  let s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (frac > 1e-9) s += String(Math.round(frac * 100) / 100).slice(1);
  return (neg ? '-' : '') + s;
}

/* A round number near x, for best guesses (125 -> 125, 23 -> 25, 2730 -> 2,700). */
export function niceRound(x) {
  if (!(x > 0)) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(x)));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
  let best = mag, bestErr = Infinity;
  for (const s of steps) {
    const v = s * mag;
    const err = Math.abs(v - x);
    if (err < bestErr) { best = v; bestErr = err; }
  }
  return Math.round(best * 100) / 100;
}

export function playerName(hand, pi) {
  const p = (hand.players || [])[pi];
  if (!p) return 'Seat ' + (pi + 1);
  if (typeof p.name === 'string' && p.name.trim()) return p.name.trim();
  if (typeof p.position === 'string' && p.position.trim()) return p.position.trim();
  return 'Seat ' + (pi + 1);
}

export function streetName(hand, si) {
  const st = (hand.streets || [])[si];
  return (st && typeof st.name === 'string' && st.name) || ['Preflop', 'Flop', 'Turn', 'River'][si] || 'Street ' + (si + 1);
}

/* "A", "A and B", "A, B and C". */
export function listWords(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

export function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return NaN;
}

export const dismissOption = (label) => ({ label: label || 'Skip', value: { op: 'dismiss' } });
