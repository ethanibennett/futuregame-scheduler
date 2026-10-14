// A date pill's label centred on its INK (owner rule 2026-10-10: a pill's label is centred both
// ways). The Schedule's date break ("13 Oct", DateBreak.jsx) and the backer page's month break
// ("Oct 2026", BackerPage.jsx) are one line of two runs in the display face, inside a pill that
// centres the line's BOX (styles.css .date-break-pill / .date-break-label). The box is not the ink:
//
//   along the line  it runs from the first run's origin to the last run's advance, but the ink
//                   starts one side bearing in and stops another short, and both vary with the
//                   glyph: Libre Baskerville's 1 stands 69 units in, its 2 50; the n of Jun ends
//                   24 short, the g of Aug 10 PAST its advance, the p of Sep 49 short (and the
//                   face has no tabular or lining figures to even them out: tnum and lnum are
//                   not in it). One fixed pad left "28 Sep" 0.58px left of centre and "14 Aug"
//                   0.37px right (WebKit, 1440 wide).
//   across it       the label is trimmed to cap height (text-box-edge: cap alphabetic), but the
//                   figures rise 10 units above it and a 7's flag 60, so a day with a 7 sat 0.8px
//                   high until it was given a class of its own (has-tall-figure, now gone).
//
// So the bearings and the rise are read from the face itself, in the fonts the runs render in,
// and given back as the label's padding in em: the side with the smaller bearing is padded by the
// difference, and the top by the rise above the cap height. The box the pill centres is then the
// ink, for every date and at every width (em scales with the type). No per-date or per-glyph
// numbers: whatever the runs hold, in whatever face loads.
//
// The bearings come from PIXELS: each run is drawn once on a canvas at 200px and its painted
// columns found. Not from measureText's actualBoundingBoxLeft/Right: WebKit (Safari, iOS, the
// Mac app, and the guards' WebKit) clamps both to the advance, so an ink that starts inside its
// box reads as starting AT it ("10" at 200px: left 0, right 232 = the width; the ink is 13.8 in),
// and only overhangs (the J of Jan) come through. The rise is measureText's ascent, which WebKit
// reports true (and which is what check:controls holds the label to). Canvas cannot apply
// font-variant-numeric, so it draws the face's default figures; in Libre Baskerville, which has no
// numeric features, those are the figures the page sets.
//
// Plain DOM, no imports (the React side is hooks/useInkBalance.js), so a test page can load it as is.

let ctx2d = null;
const BIG = 200;          // measured at a large size and scaled: the bearings are linear in size
const INK_ALPHA = 8;      // a column with more coverage than this (of 255) is painted
const cache = new Map();  // font + text -> metrics in em of that font, once the face is loaded

function canvas2d() {
  if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  return ctx2d;
}

// The painted extent of `text` across the line, in px at BIG from its origin: [inkLeft, inkRight],
// each edge placed within its pixel by that column's coverage. null when nothing painted.
function paintedSpan(font, text, width) {
  const c = canvas2d();
  const pad = Math.ceil(BIG * 0.5);                    // room for an overhang either side
  const w = Math.ceil(width) + 2 * pad, h = Math.ceil(BIG * 1.5);
  const base = Math.ceil(BIG * 1.1);                   // ascenders above, descenders below
  if (c.canvas.width < w) c.canvas.width = w;
  if (c.canvas.height < h) c.canvas.height = h;
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  c.font = font;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#000';
  c.fillText(text, pad, base);
  const data = c.getImageData(0, 0, w, h).data;
  const col = new Uint8Array(w);                       // each column's strongest coverage
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) { const a = data[row + x * 4 + 3]; if (a > col[x]) col[x] = a; }
  }
  let x0 = 0; while (x0 < w && col[x0] <= INK_ALPHA) x0++;
  let x1 = w - 1; while (x1 >= 0 && col[x1] <= INK_ALPHA) x1--;
  if (x0 > x1) return null;
  return [x0 + 1 - col[x0] / 255 - pad, x1 + col[x1] / 255 - pad];
}

function fontOf(cs, size) {
  return `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
}

function cased(text, transform) {
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') return text.replace(/(^|\s)(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
  return text;
}

// The run's ink against its own box, in em of its own font size: lsb (ink start right of the
// origin), rsb (advance end right of the ink end) and asc (ink top above the baseline).
function inkOf(el, text) {
  const cs = getComputedStyle(el);
  const t = cased(text, cs.textTransform);
  const key = fontOf(cs, BIG) + '|' + t;
  if (cache.has(key)) return cache.get(key);
  const c = canvas2d();
  const font = fontOf(cs, BIG);
  c.font = font;
  const m = c.measureText(t);
  const cap = c.measureText('H').actualBoundingBoxAscent / BIG;
  const span = paintedSpan(font, t, m.width);
  // A bearing past 0.3em is no glyph's (the J of Jan overhangs 0.11em): a canvas that would not
  // read back true (a browser's anti-fingerprinting noise) leaves the sides to the stylesheet.
  const sane = (v) => (Math.abs(v) < 0.3 ? v : null);
  const out = {
    lsb: span ? sane(span[0] / BIG) : null,
    rsb: span ? sane((m.width - span[1]) / BIG) : null,
    asc: m.actualBoundingBoxAscent / BIG,
    cap,
  };
  // Kept only once the face is in: measured against the fallback while the web font is still on
  // its way, the numbers are the fallback's, and the label is measured again when it lands.
  const loaded = !document.fonts || !document.fonts.check || document.fonts.check(fontOf(cs, BIG), t);
  if (loaded) cache.set(key, out);
  return out;
}

/**
 * Pads a .date-break-label so its box is its ink. The label's runs are its element children (the
 * day and the month, or the month and the year), set on one baseline; the first run's start and
 * the last run's end are the line's ends, and the tallest run's top is its top.
 */
export function balanceDateInk(label) {
  if (!label || !label.children || !label.children.length) return;
  const runs = [...label.children].filter(el => (el.textContent || '').trim());
  if (!runs.length) return;
  const em = parseFloat(getComputedStyle(label).fontSize) || 1;
  // Each run's metrics, from its own em into the label's.
  const k = (el) => (parseFloat(getComputedStyle(el).fontSize) || em) / em;
  const first = runs[0], last = runs[runs.length - 1];
  const a = inkOf(first, first.textContent.trim());
  const z = last === first ? a : inkOf(last, last.textContent.trim());
  // The trim's cap edge is the label's own font's (the first run's: same face and size).
  const cap = inkOf(label, 'H').cap;
  let top = 0;
  for (const el of runs) top = Math.max(top, inkOf(el, el.textContent.trim()).asc * k(el));
  const r = (v) => `${Math.max(0, v).toFixed(4)}em`;
  label.style.paddingTop = r(top - cap);
  if (a.lsb == null || z.rsb == null) return;
  const lsb = a.lsb * k(first);
  const rsb = z.rsb * k(last);
  label.style.paddingRight = r(lsb - rsb);
  label.style.paddingLeft = r(rsb - lsb);
}

/** The fonts a label's runs render in, with their text: what to wait for before measuring. */
export function dateInkFonts(label) {
  if (!label || !label.children) return [];
  return [...label.children].map((el) => {
    const cs = getComputedStyle(el);
    return { font: fontOf(cs, parseFloat(cs.fontSize) || 16), text: cased((el.textContent || '').trim(), cs.textTransform) || 'H' };
  });
}
