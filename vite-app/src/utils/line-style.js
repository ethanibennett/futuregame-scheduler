// How every line graph draws its line (owner, 2026-10-17: "cycle through the line graphs we have,
// direct non-horizontal connections between points, and Bézier curves"):
//   steps   the total holds until a result moves it (the graphs' first shape);
//   lines   a straight line from one result to the next;
//   curves  a smooth curve through the results: a monotone cubic Bézier (Fritsch–Carlson), so the
//           curve never swings above or below the results on either side of it, and a reading is
//           never shown that did not happen.
// One choice for the whole app, kept on this device (localStorage graphLineStyle) and shared live by
// every graph on screen. The path maths are utils/line-shape.js (test: utils/__tests__/line-shape.test.mjs).
import { useCallback, useEffect, useState } from 'react';

export const LINE_STYLES = [['steps', 'Steps'], ['lines', 'Lines'], ['curves', 'Curves']];
const KEYS = LINE_STYLES.map(([k]) => k);
const STORE = 'graphLineStyle';
const EVENT = 'graph-line-style';

export const lineStyleLabel = (s) => (LINE_STYLES.find(([k]) => k === s) || LINE_STYLES[0])[1];
export const nextLineStyle = (s) => KEYS[(KEYS.indexOf(s) + 1) % KEYS.length];

export function readLineStyle() {
  try { const v = localStorage.getItem(STORE); return KEYS.includes(v) ? v : 'steps'; } catch { return 'steps'; }
}

/** [style, cycle]: the shared line style, and a function that moves every graph to the next one. */
export function useLineStyle() {
  const [style, setStyle] = useState(readLineStyle);
  useEffect(() => {
    const sync = () => setStyle(readLineStyle());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const cycle = useCallback(() => {
    const next = nextLineStyle(readLineStyle());
    try { localStorage.setItem(STORE, next); } catch { /* private mode: this visit only */ }
    setStyle(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [style, cycle];
}

export { shapePath } from './line-shape.js';
