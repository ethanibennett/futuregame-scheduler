// "Edit in Results" from the bankroll dashboard (beta, app admins): open the Results tab on ONE
// entry. The dashboard sheet lives inside the Results tab, so closing it lands there already; this
// store carries which entry to open across that close, and switches the Results tab to the right
// half (Tournaments | Cash) with the same setResultsKind the Overview's "latest sessions" buttons
// use. TrackingView opens a tournament result's edit form and scrolls to it; CashSessionsView opens
// a cash session's edit screen. The focus is taken once, by whichever half it names.
import { useSyncExternalStore } from 'react';
import { setResultsKind } from './useLiveCashSession.js';

let pending = null;                 // { kind: 'tournaments' | 'cash', id: number } | null
const subs = new Set();
const emit = () => { for (const f of subs) f(); };
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

/** Ask the Results tab to open entry `id` of `kind` ('tournaments' | 'cash'), and show that half. */
export function openInResults(kind, id) {
  const k = kind === 'cash' ? 'cash' : 'tournaments';
  pending = { kind: k, id: Number(id) };
  setResultsKind(k);
  emit();
}

/** Drop the request once it has been acted on. */
export function clearResultsFocus() {
  if (!pending) return;
  pending = null;
  emit();
}

/** The id waiting to be opened in this half of the Results tab, or null. */
export function useResultsFocus(kind) {
  return useSyncExternalStore(subscribe, () => (pending && pending.kind === kind ? pending.id : null));
}

/**
 * Scroll `el` into view inside its nearest scrolling ancestor only — Element.scrollIntoView would
 * also nudge the window (11px measured in WebKit) and move the .top-bar off the grid origin. The
 * element's top lands `at` (a fraction of the scroller's height) below the scroller's top; every
 * offset is read from layout, nothing is a literal.
 */
export function revealInScroller(el, at = 0.25) {
  if (!el) return;
  let s = el.parentElement;
  while (s && s !== document.body) {
    const oy = getComputedStyle(s).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && s.scrollHeight > s.clientHeight) break;
    s = s.parentElement;
  }
  const scroller = s && s !== document.body ? s : (document.scrollingElement || document.documentElement);
  const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
  scroller.scrollTop += el.getBoundingClientRect().top - top - scroller.clientHeight * at;
}
