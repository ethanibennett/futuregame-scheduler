import { createContext, useContext, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * The Bankroll tab's second pane on desktop (Bankroll design 83, 84, 85): the shell's .dk-pane-side, as
 * Hands and Cash have it. TrackingView provides { node, claim } when App gives it a pane; a section that
 * wants two panes calls useBankrollSide(true) and portals its right-hand blocks into the node it returns.
 * While any section holds a claim App shows the pane (the main pane narrows to the list's 37g); with none
 * the tab is one pane to the shell's edge again. On the phone, and on desktop without a pane, it is null.
 */
export const BankrollSideContext = createContext(null);

export function useBankrollSide(want = true) {
  const ctx = useContext(BankrollSideContext);
  const on = !!(ctx && ctx.node && want);
  useLayoutEffect(() => {
    if (!on) return undefined;
    return ctx.claim();
  }, [on, ctx]);
  return on ? ctx.node : null;
}

/** Its children in the second pane when there is one, else where they stand. */
export function SidePortal({ children, want = true }) {
  const node = useBankrollSide(want);
  return node ? createPortal(children, node) : children;
}
