/* The casino-clay chip's six white edge inserts (owner, 2026-11-13: replayer chips catalogue pick 1, with the
   face's inserts lined up with the side's). Pure; `npm test` holds it.

   A chip is a cylinder seen from above at the face ratio K (minor/major of the top ellipse). An insert at angle
   th round the chip, measured from the front (th = 0 faces the viewer), sits at x = R sin th on both the side and
   the face's rim, so one angle places it in both drawings:
   - the side: a vertical band centred at 50% + 50% sin th, its width foreshortened by cos th (hidden round the back);
   - the face: an arc of the rim from th - HALF to th + HALF, as conic-gradient angles on the face ellipse.
   HALF is the insert's half-angle: 0.16 rad, so an insert is 0.32 R of arc, 16% of the width when it faces you. */

export const CHIP_FACE_K = 0.62;
const N = 6, HALF = 0.16, INSERT = '#f4f1ea';

const r2 = n => Math.round(n * 100) / 100;

// pip: the chip's turn as pipShift gives it, 0 to 1/3 (a fraction of the width). Six-fold symmetry means a sixth
// of a turn is every pose there is, so the turn is pip / 2 of a revolution.
export function chipInsertAngles(pip) {
  const phase = (Number(pip) || 0) / 2;
  return Array.from({ length: N }, (_, j) => (phase + j / N) * Math.PI * 2);
}

export function chipSide(pip) {
  const stops = [];
  chipInsertAngles(pip)
    .map(th => ({ c: 50 + 50 * Math.sin(th), w: 100 * HALF * Math.cos(th) / 2 }))
    .filter(b => b.w > 0.4)
    .sort((a, b) => a.c - b.c)
    .forEach(({ c, w }) => {
      const a = r2(Math.max(0, c - w)), b = r2(Math.min(100, c + w));
      stops.push(`transparent ${a}%`, `${INSERT} ${a}% ${b}%`, `transparent ${b}%`);
    });
  return stops.length ? `linear-gradient(90deg, ${stops.join(', ')})` : 'none';
}

// A rim angle th to the conic-gradient angle on the face ellipse (degrees clockwise from 12 o'clock).
function faceDeg(th, k) {
  const d = Math.atan2(Math.sin(th), -k * Math.cos(th)) * 180 / Math.PI;
  return (d + 360) % 360;
}

export function chipRim(pip, k = CHIP_FACE_K) {
  const arcs = [];
  for (const th of chipInsertAngles(pip)) {
    // Turning th forward runs the face angle backward (th = 0 is 180deg, the front), so th + HALF starts the arc.
    const a = faceDeg(th + HALF, k), b = faceDeg(th - HALF, k);
    if (a <= b) arcs.push([a, b]); else { arcs.push([a, 360]); arcs.push([0, b]); }
  }
  arcs.sort((x, y) => x[0] - y[0]);
  const stops = arcs.map(([a, b]) => `transparent ${r2(a)}deg, ${INSERT} ${r2(a)}deg ${r2(b)}deg, transparent ${r2(b)}deg`);
  return `conic-gradient(${stops.join(', ')})`;
}

export function chipInsertVars(pip) {
  return { '--chip-side': chipSide(pip), '--chip-rim': chipRim(pip) };
}

export function applyChipInserts(el, pip) {
  const v = chipInsertVars(pip);
  for (const k in v) el.style.setProperty(k, v[k]);
}
