// The top bar's wordmark loop (owner, 2026-11-20: "cycle through an animated loop of the word futuregame with no dot,
// then show the me slide right to accommodate the blue dot, then have it shrink to nothing and the me slide back";
// "Should play in the top bar forever"). The dot sits with the same clear space to the "a" as to the "m" ("put the dot
// evenly spaced between the a and m"), measured on the ink in the rows the dot covers: Libre Baskerville's "a" has a
// tail along the baseline that ran under a dot set where the period sits, and the m starts past its own side bearing.
// dotGeometry is the arithmetic (pure, `npm test`); measureWordmarkDot reads the ink off a canvas in the browser, so
// every display face (Baskerville, Univers, Century Gothic, Swiss's) gets its own spacing.

// The clear space each side of the dot, in em: what Baskerville's period already had to the m.
export const DOT_SPACE_EM = 0.05;

/**
 * All in em of the word's font size, x measured from each glyph's own origin.
 *   aAdv, dotAdv       the a's and the dot's advances
 *   aRight             the a's rightmost ink in the rows the dot covers
 *   mLeft              the m's leftmost ink in those rows
 *   dotLeft, dotRight  the dot's ink
 *   tracking           the word's letter-spacing
 * Returns { gap, dotX }: how far "me" moves right to open the room, and how far the dot moves right from where it is
 * drawn at rest (a 0-wide box at the a's end, the dot's advance centred on it).
 */
export function dotGeometry({ aAdv, aRight, mLeft, dotAdv, dotLeft, dotRight, tracking = 0, space = DOT_SPACE_EM }) {
  const aInk = aRight - aAdv - tracking;           // the a's ink edge, from where "me" starts at rest
  const dotInk = dotRight - dotLeft;
  const gap = aInk + space + dotInk + space - mLeft;
  const dotAtRest = -dotAdv / 2 + (dotLeft + dotRight) / 2;   // the dot's ink centre as drawn at rest
  const dotX = aInk + space + dotInk / 2 - dotAtRest;
  return { gap, dotX };
}

// The ink of one glyph, drawn on a canvas in the word's face: each row's leftmost and rightmost inked column.
const S = 160, OX = 80, BY = 200, W = 400, H = 280;
function inkOf(font, ch) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true });
  if (!c) return null;
  c.font = font;
  c.fillText(ch, OX, BY);
  const m = c.measureText(ch);
  const d = c.getImageData(0, 0, W, H).data;
  const rows = new Array(H).fill(null);
  for (let y = 0; y < H; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 96) { if (l < 0) l = x; r = x; }
    if (l >= 0) rows[y] = [l, r + 1];
  }
  return { adv: m.width / S, rows, ascent: m.fontBoundingBoxAscent / S, descent: m.fontBoundingBoxDescent / S };
}

/**
 * The loop's geometry for the word as set in `el` (its computed face, weight and tracking), in em:
 * { gap, dotX, base, originY }, base being the baseline's distance below the middle of a line box of the word's own
 * line height, and originY the dot's ink centre's. null where it cannot be read (no canvas, no ink yet).
 */
export function measureWordmarkDot(el) {
  if (typeof document === 'undefined' || !el) return null;
  const cs = getComputedStyle(el);
  const fs = parseFloat(cs.fontSize);
  if (!(fs > 0)) return null;
  const tracking = (parseFloat(cs.letterSpacing) || 0) / fs;
  const fontOf = (c) => `${c.fontStyle} ${c.fontWeight} ${S}px ${c.fontFamily}`;
  // The dot in its own weight: Swiss draws it thin beside a bold word.
  const dotEl = el.querySelector('.wm-dot');
  const font = fontOf(cs), dotFont = dotEl ? fontOf(getComputedStyle(dotEl)) : font;
  const a = inkOf(font, 'a'), m = inkOf(font, 'm'), dot = inkOf(dotFont, '.');
  if (!a || !m || !dot) return null;
  let y0 = -1, y1 = -1, dl = Infinity, dr = -Infinity;
  dot.rows.forEach((r, y) => { if (r) { if (y0 < 0) y0 = y; y1 = y; dl = Math.min(dl, r[0]); dr = Math.max(dr, r[1]); } });
  if (y0 < 0) return null;
  let ar = -Infinity, ml = Infinity;
  for (let y = y0; y <= y1; y++) {
    if (a.rows[y]) ar = Math.max(ar, a.rows[y][1]);
    if (m.rows[y]) ml = Math.min(ml, m.rows[y][0]);
  }
  if (!Number.isFinite(ar) || !Number.isFinite(ml)) return null;
  const { gap, dotX } = dotGeometry({
    aAdv: a.adv, aRight: (ar - OX) / S, mLeft: (ml - OX) / S,
    dotAdv: dot.adv, dotLeft: (dl - OX) / S, dotRight: (dr - OX) / S, tracking,
  });
  const base = Number.isFinite(dot.ascent) && Number.isFinite(dot.descent) ? (dot.ascent - dot.descent) / 2 : null;
  const inkMid = (BY - (y0 + y1 + 1) / 2) / S;
  return { gap, dotX, base, originY: base == null ? null : base - inkMid };
}
