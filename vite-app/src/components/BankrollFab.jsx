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
// The menu is portalled to the body: a raised layer over a page that dims behind it (Bankroll design
// 37), 20g wide, 6r rows each led by its kind's mark in a 3g x 4r --brand-quiet cell, its right edge on
// the + and 1r above it (below the desktop bar's Add button). It arrives from the button's corner in the
// 200 ms the + takes to turn (38). Escape or a tap outside closes it and returns focus to the +; the arrow
// keys, Home and End move between the choices.
//
// variant 'bar' (Bankroll design 49 and 87): on desktop the + is a labelled "+ Add" in the bankroll's band
// at the top of the pane (Bankrolls.jsx BankrollSwitcher), and the floating one is not drawn there.

const ROW_R = 6;
const WIDTH_G = 20;
const MARK = { tournament: 'ring', 'cash-add': 'cards', 'cash-start': 'clock', expense: 'dollarSign' };

function FabMenu({ id, anchor, items, onPick, onClose, leaving = false }) {
  const ref = useRef(null);
  const [style, setStyle] = useState(null);
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const { G } = gridGeom();
    // Right edge on the + (a g line), one row per choice, its foot 1r above the +'s top (an r line), or
    // its top 1r under a button in the top half (the desktop bar's Add).
    setStyle(gridPanelStyle(r, items.length * ROW_R, r.right / G - WIDTH_G));
    setBelow(r.top < window.innerHeight / 2);
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
      <div className={'bk-fab-scrim' + (leaving ? ' is-leaving' : '')} onClick={() => onClose(true)} />
      {placed && (
        <div ref={ref} id={id} className={'bk-fab-menu' + (below ? ' is-below' : '') + (leaving ? ' is-leaving' : '')} role="menu" aria-label="Add a session" style={style} onKeyDown={onKeyDown}>
          {items.map((it) => {
            const Mark = Icon[MARK[it.key]] || Icon.plus;
            return (
              <button key={it.key} type="button" role="menuitem" className="bk-fab-item" onClick={() => onPick(it.intent)}>
                <span className="bk-fab-mark" aria-hidden="true"><Mark /></span>
                <span className="bk-fab-item-t">{it.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </>,
    document.body
  );
}

export default function BankrollFab({ scope = 'page', isAdmin, onPick, variant = 'float' }) {
  const held = useBankrollFabHeld(scope);
  const live = useLiveSessionNow();
  const items = useMemo(() => fabItems({ isAdmin: !!isAdmin, live: !!live }), [isAdmin, live]);
  const menu = fabHasMenu(items);
  const menuId = useId();
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // It leaves in --dur-fast (Bankroll design 38): the menu fades out before it goes.
  const close = useCallback((refocus) => {
    setLeaving(true);
    setTimeout(() => { setOpen(false); setLeaving(false); }, 120);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  }, []);
  // A form or sheet opened under an open menu (or the + hidden some other way): the menu goes too.
  useEffect(() => { if (held) setOpen(false); }, [held]);
  // The choice to a single one (the live session ended under an open menu, say): nothing to show.
  useEffect(() => { if (!menu) setOpen(false); }, [menu]);
  if (held && variant !== 'bar') return null;
  const bar = variant === 'bar';
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={bar ? 'bk-add-btn ctl' : 'bk-fab bk-fab--' + scope}
        aria-label="Add a session"
        aria-haspopup={menu ? 'menu' : undefined}
        aria-expanded={menu ? open && !leaving : undefined}
        aria-controls={menu && open ? menuId : undefined}
        onClick={() => (menu ? (open ? close(false) : setOpen(true)) : onPick(items[0].intent))}
      >
        {bar ? <span className="bk-add-label">+ Add</span> : <Icon.plus />}
      </button>
      {menu && open && (
        <FabMenu id={menuId} anchor={btnRef.current} items={items} onClose={close} leaving={leaving}
          onPick={(intent) => { setOpen(false); setLeaving(false); onPick(intent); }} />
      )}
    </>
  );
}
