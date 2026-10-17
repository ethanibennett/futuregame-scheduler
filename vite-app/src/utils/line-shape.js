// The path maths behind utils/line-style.js: pure and dependency-free, so utils/cash-sessions.js
// (also pure) and node --test can use it. See line-style.js for what the three shapes are.

const f3 = (n) => (Math.round(n * 1000) / 1000).toString();

/**
 * An SVG path through `knots` ([x, y] in order of x, the results and the ends), in `style`.
 * `move: false` continues a path already started (it opens with L, not M), for closing an area
 * along a second edge. Two knots on one x are a vertical jump in every style.
 */
export function shapePath(knots, style = 'steps', { move = true, fmt = f3 } = {}) {
  const k = (knots || []).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!k.length) return '';
  const pt = ([x, y]) => `${fmt(x)},${fmt(y)}`;
  let d = `${move ? 'M' : 'L'}${pt(k[0])}`;
  if (k.length === 1) return d;
  if (style === 'lines') {
    for (let i = 1; i < k.length; i += 1) d += ` L${pt(k[i])}`;
    return d;
  }
  if (style !== 'curves') {
    for (let i = 1; i < k.length; i += 1) d += ` L${fmt(k[i][0])},${fmt(k[i - 1][1])} L${pt(k[i])}`;
    return d;
  }
  // Monotone cubic (Fritsch–Carlson). Works whichever way x runs, so an area can come back along
  // a second edge drawn right to left.
  const n = k.length;
  const h = []; const s = [];
  for (let i = 0; i < n - 1; i += 1) {
    h[i] = k[i + 1][0] - k[i][0];
    s[i] = h[i] === 0 ? 0 : (k[i + 1][1] - k[i][1]) / h[i];
  }
  const m = new Array(n);
  m[0] = s[0];
  m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = (h[i - 1] === 0 || h[i] === 0 || s[i - 1] * s[i] <= 0) ? 0 : (s[i - 1] + s[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (s[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / s[i]; const b = m[i + 1] / s[i];
    const r = a * a + b * b;
    if (r > 9) { const t = 3 / Math.sqrt(r); m[i] = t * a * s[i]; m[i + 1] = t * b * s[i]; }
  }
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = k[i]; const [x1, y1] = k[i + 1];
    if (h[i] === 0) { d += ` L${pt(k[i + 1])}`; continue; }
    const c = h[i] / 3;
    d += ` C${fmt(x0 + c)},${fmt(y0 + m[i] * c)} ${fmt(x1 - c)},${fmt(y1 - m[i + 1] * c)} ${pt(k[i + 1])}`;
  }
  return d;
}
