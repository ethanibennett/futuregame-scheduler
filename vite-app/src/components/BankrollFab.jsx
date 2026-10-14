import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { useLiveSessionNow } from '../hooks/useLiveCashSession.js';
import { useBankrollFabHeld } from '../hooks/useBankrollFab.js';
import { fabItems, fabHasMenu } from '../utils/bankroll-fab.js';
import { gridGeom, gridPanelStyle } from '../utils/grid-panel.js';
import './bankroll-fab.css';

// ── The floating "+" on the bankroll pages (owner, 2026-10-14) ──────────────────────────────────
// A round 5g x 7r button at the foot-right of the Results tab (scope 'page': mounted by App in the
// main pane, so on desktop it sits inside that pane) and of the bankroll dashboard sheet (scope
// 'sheet': mounted inside the sheet). Tapping it opens a small menu of what can be added, each
// choice an intent for the form that already exists (App's resultsIntent -> TrackingView, the cash
// sessions view, the expenses section); nothing is built twice. Cash sessions and expenses are
// admin-only, so for everyone else the + opens the Log Result form directly and has no menu.
//
// onPick(intent) is the whole hand-off: the page's is App's, which sets the intent and shows
// Results; the sheet's closes the sheet first (BankrollDashboard), as the Overview's buttons do.
// A form or sheet the + would open holds it away (hooks/useBankrollFab.js), and a hidden + takes
// its open menu with it.
//
// The menu is portalled to the body like the user menu in App.jsx: 16g wide, 5r rows, an inset
// hairline ring, its right edge on the + and 1r above it. Escape or a tap outside closes it and
// returns focus to the +; the arrow keys, Home and End move between the choices.

const ROW_R = 5;
const WIDTH_G = 16;

function FabMenu({ id, anchor, items, onPick, onClose }) {
  const ref = useRef(null);
  const [style, setStyle] = useState(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const { G } = gridGeom();
    // Right edge on the + (a g line), one row per choice, its foot 1r above the +'s top (an r line).
    setStyle(gridPanelStyle(r, items.length * ROW_R, r.right / G - WIDTH_G));
  }, [anchor, items.length]);
  const placed = !!style;
  useEffect(() => {
    if (placed) ref.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [placed]);
  useEffect(() => {
    // Capture phase and stopped: with the menu in the dashboard sheet the sheet's own Escape would
    // otherwise close the sheet as well.
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); }
    };
    const onResize = () => onClose(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);
  const onKeyDown = (e) => {
    const rows = [...ref.current.querySelectorAll('[role="menuitem"]')];
    const at = rows.indexOf(document.activeElement);
    const go = (i) => { e.preventDefault(); rows[(i + rows.length) % rows.length].focus({ preventScroll: true }); };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(-1);
    else if (e.key === 'Tab') { e.preventDefault(); onClose(true); }
  };
  return createPortal(
    <>
      <div className="bk-fab-scrim" onClick={() => onClose(true)} />
      {placed && (
        <div ref={ref} id={id} className="bk-fab-menu" role="menu" aria-label="Add a session" style={style} onKeyDown={onKeyDown}>
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" className="bk-fab-item" onClick={() => onPick(it.intent)}>
              <span className="bk-fab-item-t">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </>,
    document.body
  );
}

export default function BankrollFab({ scope = 'page', isAdmin, onPick }) {
  const held = useBankrollFabHeld(scope);
  const live = useLiveSessionNow();
  const items = useMemo(() => fabItems({ isAdmin: !!isAdmin, live: !!live }), [isAdmin, live]);
  const menu = fabHasMenu(items);
  const menuId = useId();
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const close = useCallback((refocus) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  }, []);
  // A form or sheet opened under an open menu (or the + hidden some other way): the menu goes too.
  useEffect(() => { if (held) setOpen(false); }, [held]);
  // The choice to a single one (the live session ended under an open menu, say): nothing to show.
  useEffect(() => { if (!menu) setOpen(false); }, [menu]);
  if (held) return null;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={'bk-fab bk-fab--' + scope}
        aria-label="Add a session"
        aria-haspopup={menu ? 'menu' : undefined}
        aria-expanded={menu ? open : undefined}
        aria-controls={menu && open ? menuId : undefined}
        onClick={() => (menu ? setOpen((o) => !o) : onPick(items[0].intent))}
      >
        <Icon.plus />
      </button>
      {menu && open && (
        <FabMenu id={menuId} anchor={btnRef.current} items={items} onClose={close}
          onPick={(intent) => { setOpen(false); onPick(intent); }} />
      )}
    </>
  );
}
