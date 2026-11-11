import { useEffect, useRef } from 'react';

/**
 * Back closes the panel in front (App improvements 454): Back with Notifications, the user menu, Live Update, the
 * filter panel or the game picker open left the app. While `open`, a history step is held; Back (or Android's back
 * gesture) pops it and calls `close`, and nothing else. Closing the panel its own way (its ✕, a tap outside) gives
 * the step back, so the history stays even and the next Back goes to the previous tab (453).
 */
export default function useBackToClose(open, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return undefined;
    let popped = false;
    try { window.history.pushState({ ...(window.history.state || {}), overlay: true }, '', window.location.href); } catch (_) { return undefined; }
    const onPop = () => { popped = true; if (closeRef.current) closeRef.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) { try { window.history.back(); } catch (_) { /* a sandboxed frame */ } }
    };
  }, [open]);
}
