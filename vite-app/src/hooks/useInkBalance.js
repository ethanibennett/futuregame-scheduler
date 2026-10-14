import { useLayoutEffect } from 'react';
import { balanceDateInk, dateInkFonts } from '../utils/ink-balance.js';

/**
 * Keeps a date pill's label centred on its ink (utils/ink-balance.js): balanced before the first
 * paint, and again once the fonts its runs render in have loaded, since a label measured while the
 * web font is still on its way (font-display: swap) is measured in the fallback. `deps` are the
 * label's texts.
 */
export default function useInkBalance(ref, deps) {
  useLayoutEffect(() => {
    const label = ref.current;
    if (!label) return undefined;
    balanceDateInk(label);
    const fonts = document.fonts;
    if (!fonts || !fonts.load) return undefined;
    const want = dateInkFonts(label);
    if (fonts.check && want.every(f => fonts.check(f.font, f.text))) return undefined;
    let live = true;
    Promise.all(want.map(f => fonts.load(f.font, f.text)))
      .catch(() => {})
      .then(() => { if (live && ref.current) balanceDateInk(ref.current); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
