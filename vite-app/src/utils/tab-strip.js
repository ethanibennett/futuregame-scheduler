// ── A strip of tabs on the grid: divided while the labels fit, a scrolling row when they do not ──
// Pure and dependency-free (runs under `node --test`); components/BankrollTabStrip.jsx measures and
// draws. Widths are in g.
//
// Divided: one 35g segmented control whose N segments share the width in whole g — the first
// (35 mod N) segments get one g more (4 tabs 9+9+9+8, 5 tabs 5 x 7, 6 tabs 5 x 6 + 5, 7 tabs 7 x 5).
// That holds only while every label fits its segment unclipped with `pad` g of room around it;
// otherwise the strip is a row of content-sized pills that scrolls sideways.

/** Whole-g segment widths for n segments across `total` g. */
export function segmentWidths(n, total = 35) {
  if (!(n > 0)) return [];
  const base = Math.floor(total / n), extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Whether labels of these natural widths (g, as measured) fit the divided strip: each label plus
 * `pad` g (the room around it, both sides together) within its own segment.
 */
export function fitsDivided(labelWidths, { total = 35, pad = 1 } = {}) {
  const w = segmentWidths(labelWidths.length, total);
  if (!w.length || w.some((x) => x < 1)) return false;
  return labelWidths.every((lw, i) => Number.isFinite(lw) && lw + pad <= w[i] + 1e-6);
}

/**
 * The scrollLeft that brings one item fully into view, in px, or null when it already is. `edge`
 * px are kept clear on a side that has more beyond it (the fade's width), and the result is a whole
 * number of g so the pills come to rest on g lines (rounded the way that reveals, never short).
 */
export function revealScroll({ itemLeft, itemWidth, scrollLeft, viewWidth, contentWidth, edge = 0, g = 0 }) {
  const max = Math.max(0, contentWidth - viewWidth);
  const lo = itemLeft - (itemLeft > 0.5 ? edge : 0);
  const end = itemLeft + itemWidth;
  const hi = end + (end < contentWidth - 0.5 ? edge : 0);
  let target;
  if (lo < scrollLeft - 0.5) target = lo;
  else if (hi > scrollLeft + viewWidth + 0.5) target = hi - viewWidth;
  else return null;
  if (g > 0) target = (target < scrollLeft ? Math.floor(target / g + 0.01) : Math.ceil(target / g - 0.01)) * g;
  target = Math.min(max, Math.max(0, target));
  return Math.abs(target - scrollLeft) < 0.5 ? null : target;
}

/** Arrow keys over a radio group: the index to select, or null for a key it does not handle. */
export function keyStep(key, index, n) {
  if (!(n > 0)) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % n;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}
