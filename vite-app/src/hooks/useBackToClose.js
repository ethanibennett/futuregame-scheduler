import { useEffect, useRef } from 'react';

let seq = 0;

/**
 * Back closes the panel in front (App improvements 454): Back with Notifications, the user menu, Live Update, the
 * filter panel or the game picker open left the app. While `open`, a history step is held; Back (or Android's back
 * gesture) pops it and calls `close`, and nothing else. Closing the panel its own way (its ✕, a tap outside) gives
 * the step back, so the history stays even and the next Back goes to the previous tab (453).
 *
 * The step is given back only while it is still the one on top, and only after the commit's other effects: a menu row
 * that closes the menu AND opens a tab replaces this step with the tab's address in the same commit, and an immediate
 * back() (it is asynchronous) then landed on the step before, the old tab, so every user-menu row snapped back to Home.
 */
export default function useBackToClose(open, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return undefined;
    let popped = false;
    const id = ++seq;
    try { window.history.pushState({ ...(window.history.state || {}), overlay: id }, '', window.location.href); } catch (_) { return undefined; }
    const onPop = () => { popped = true; if (closeRef.current) closeRef.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (popped) return;
      setTimeout(() => {
        try { if (window.history.state && window.history.state.overlay === id) window.history.back(); } catch (_) { /* a sandboxed frame */ }
      }, 0);
    };
  }, [open]);
}
