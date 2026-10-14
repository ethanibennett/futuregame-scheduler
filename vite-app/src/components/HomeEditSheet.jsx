import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { haptic } from '../utils/utils.js';
import { gridGeom } from '../utils/grid-panel.js';
import { sheetRows, move, moveTo, toggle, isDefault } from '../utils/home-layout.js';
import './analytics.css';
import './home.css';
import './home-edit.css';

// ── Edit home: which sections the Dashboard shows, and in what order ────────────────────────────
// The analytics sheet's chrome (an-scrim / an-sheet: 37g, the 8r head with the title and Done, the
// body 1g in from each side, 2r down), portalled to the body. Every change applies to the home at
// once (App's useHomeLayout: cached at once, saved after 600 ms); there is no Cancel. Done, Escape
// and the scrim close it, and App returns focus to the control that opened it.
//
// One row a section (35g x 5r cards, 1r apart): a drag handle 0..3g, the name 3..22g seated on +3r,
// Move up 23..26g and Move down 26..29g (3g x 3r at +1r), the switch 30..34g (4g x 3r at +1r, 1g in
// from the card's edge: Settings' switch, 31..35g of the canvas). This month carries its parts (Signal or noise, Goals) as 5r bands inside its card,
// each with only a switch, disabled while This month is off. Up Next is locked on, and can move.
// Phone: one list, in the home's own order. Desktop: two groups, NOW (left pane) and NUMBERS (right
// pane), each reordered within itself (utils/home-layout.js: a group move rewrites only that
// group's slots); the sheet docks to the shell's right edge so the panes it edits stay in view
// behind the scrim.
//
// Drag: pointer only, by the handle (the arrows are the keyboard and screen-reader path). The card
// lifts (elev-2) and follows the pointer in r; its neighbours shift by its height + 1r as its leading
// edge crosses their midpoints; near the body's top or bottom edge (4r) the body scrolls 1r a frame;
// drop commits, Escape or pointercancel puts it back. Nothing waits on transitionend: under reduced
// motion every duration token is 0ms, and a 0s transition never fires one.

const SAY_PAD = ' ';

export default function HomeEditSheet({ layout, set, status = 'synced', ctx, isDesktop = false, onClose }) {
  const doneRef = useRef(null);
  const bodyRef = useRef(null);
  const listRefs = useRef(new Map()); // group key -> <ol>
  const drag = useRef(null);
  const pendingFocus = useRef(null);
  const [say, setSay] = useState('');
  const [undo, setUndo] = useState(null); // { prev } while Undo reset is offered
  const [dock, setDock] = useState(null); // desktop: the sheet's left edge, in g from the window's

  const rows = useMemo(() => sheetRows(layout, ctx), [layout, ctx]);
  const groups = isDesktop
    ? [{ key: 'now', group: 'now', title: 'Now · left pane', list: rows.now }, { key: 'numbers', group: 'numbers', title: 'Numbers · right pane', list: rows.numbers }]
    : [{ key: 'all', group: null, title: null, list: rows.all }];
  const atDefault = isDefault(layout, ctx);

  const announce = useCallback((text) => setSay((prev) => (prev === text ? text + SAY_PAD : text)), []);

  // Focus Done on open; Escape closes (or, mid-drag, puts the card back); Tab stays inside the sheet
  // (it is aria-modal: on desktop the home is still on screen behind the scrim, and its Busted /
  // Cashed buttons would otherwise be one Tab past Show Goals). Same handler as VenueMapSheet's: a
  // capture-phase keydown that wraps Tab and Shift+Tab between the sheet's first and last visible
  // control, and pulls focus back in if it ever sits outside.
  const sheetRef = useRef(null);
  useEffect(() => { doneRef.current && doneRef.current.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (drag.current) { e.preventDefault(); cancelDrag(); return; }
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const f = [...sheetRef.current.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.getClientRects().length > 0);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (!sheetRef.current.contains(at)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // Desktop: dock to the shell's right edge (a g line of the shell, so the sheet's own lines are the
  // shell's), recomputed on resize; the phone keeps the sheet's own centring.
  useLayoutEffect(() => {
    const place = () => {
      const shell = isDesktop ? document.querySelector('.app-shell') : null;
      if (!shell) { setDock(null); return; }
      const { G } = gridGeom();
      const left = shell.getBoundingClientRect().right / G - 37;
      setDock(left > 0 ? +left.toFixed(4) : null);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [isDesktop]);

  // Undo reset holds for 8 s, as To log's Undo does.
  useEffect(() => {
    if (!undo) return undefined;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);

  // After an arrow moved a row: focus stays on the same arrow of the row that moved, or its other
  // arrow when that one is now disabled (the row reached the end of its list).
  useLayoutEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    pendingFocus.current = null;
    const q = (dir) => document.querySelector(`.he-sheet [data-move="${f.id}:${dir}"]`);
    const same = q(f.dir), other = q(f.dir === 'up' ? 'down' : 'up');
    const el = same && !same.disabled ? same : other && !other.disabled ? other : same;
    if (el) el.focus({ preventScroll: false });
  });

  const posIn = (list, id) => list.findIndex((r) => r.id === id) + 1;

  const moveBy = (row, dir, g) => {
    const next = move(layout, row.id, dir, ctx, { group: g.group });
    if (next === layout) return;
    pendingFocus.current = { id: row.id, dir: dir < 0 ? 'up' : 'down' };
    setUndo(null);
    set(next);
    const list = (sheetRows(next, ctx)[g.group || 'all']) || [];
    announce(`${row.name} moved ${dir < 0 ? 'up' : 'down'}, ${posIn(list, row.id)} of ${list.length}.`);
  };
  const toggleRow = (row, on) => {
    if (row.locked) return;
    const next = toggle(layout, row.id, on, ctx);
    if (next === layout) return;
    setUndo(null);
    set(next);
    announce(`${row.name} ${on ? 'shown' : 'hidden'}.`);
  };
  const onReset = () => {
    if (undo) {
      set(undo.prev);
      setUndo(null);
      announce('Reset undone.');
      return;
    }
    if (atDefault) return;
    setUndo({ prev: layout });
    set(null);
    announce('Home reset to default.');
  };

  // ── Drag ──
  const setShift = (el, n) => { el.style.transform = n ? `translateY(calc(var(--subrow) * ${+n.toFixed(4)}))` : ''; };
  const layoutDrag = () => {
    const d = drag.current;
    if (!d) return;
    const body = bodyRef.current;
    const dyPx = (d.lastY - d.startY) + ((body ? body.scrollTop : 0) - d.scroll0);
    const me = d.items[d.from];
    // Clamped to its list (on desktop, its group): the card never leaves the cards it moves among.
    const lo = -me.top, hi = d.listH - (me.top + me.h);
    const off = Math.max(lo, Math.min(hi, dyPx));
    setShift(me.el, off / d.R);
    // Its slot: past each neighbour whose midpoint its LEADING edge has crossed (its top going up,
    // its bottom going down). The card's centre would do for cards of one height, but This month is
    // 15r among 5r cards, and its centre could never reach the midpoint of a 5r card above it before
    // the clamp at the list's top stopped it.
    const topNow = me.top + off, botNow = topNow + me.h;
    let to = d.from;
    d.items.forEach((it, k) => {
      const mid = it.top + it.h / 2;
      if (k < d.from && topNow < mid) to--;
      else if (k > d.from && botNow > mid) to++;
    });
    const step = Math.round(me.h / d.R) + 1; // its height + the 1r between cards, in whole r
    d.items.forEach((it, k) => {
      if (k === d.from) return;
      let n = 0;
      if (d.from < to && k > d.from && k <= to) n = -step;
      else if (to < d.from && k >= to && k < d.from) n = step;
      setShift(it.el, n);
    });
    if (to !== d.to) { d.to = to; haptic(); }
  };
  const tick = () => {
    const d = drag.current;
    if (!d) return;
    const body = bodyRef.current;
    if (body) {
      const b = body.getBoundingClientRect(), edge = 4 * d.R;
      let v = 0;
      if (d.lastY < b.top + edge) v = -d.R;
      else if (d.lastY > b.bottom - edge) v = d.R;
      if (v) {
        const before = body.scrollTop;
        body.scrollTop = before + v;
        if (body.scrollTop !== before) layoutDrag();
      }
    }
    d.raf = requestAnimationFrame(tick);
  };
  const endDrag = (commit) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    cancelAnimationFrame(d.raf);
    try { d.grip.releasePointerCapture(d.pointerId); } catch { /* already released */ }
    const me = d.items[d.from];
    if (commit && d.to !== d.from) {
      // Drop: the transforms go with no transition, in the same frame as the new order renders,
      // so nothing slides back; the transitions return a frame later.
      d.list.dataset.settling = '';
      d.items.forEach((it) => setShift(it.el, 0));
      delete me.el.dataset.lifted;
      delete d.list.dataset.drag;
      const row = d.rows[d.from];
      set(moveTo(layout, row.id, d.to, ctx, { group: d.group }));
      setUndo(null);
      announce(`${row.name} moved to ${d.to + 1} of ${d.items.length}.`);
      requestAnimationFrame(() => requestAnimationFrame(() => { delete d.list.dataset.settling; }));
    } else {
      // Cancel (or dropped where it started): every card eases back to its place.
      delete me.el.dataset.lifted;
      delete d.list.dataset.drag;
      d.items.forEach((it) => setShift(it.el, 0));
    }
  };
  function cancelDrag() { endDrag(false); }
  const startDrag = (e, g, rowIndex) => {
    if (drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const list = listRefs.current.get(g.key);
    if (!list) return;
    e.preventDefault();
    const lr = list.getBoundingClientRect();
    const items = [...list.children].map((el) => {
      const r = el.getBoundingClientRect();
      return { el, top: r.top - lr.top, h: r.height };
    });
    if (!items[rowIndex]) return;
    const grip = e.currentTarget;
    try { grip.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    drag.current = {
      group: g.group, list, rows: g.list, items, from: rowIndex, to: rowIndex, grip, pointerId: e.pointerId,
      R: gridGeom().R, startY: e.clientY, lastY: e.clientY, scroll0: bodyRef.current ? bodyRef.current.scrollTop : 0,
      listH: lr.height, raf: 0,
    };
    list.dataset.drag = '';
    items[rowIndex].el.dataset.lifted = '';
    haptic();
    drag.current.raf = requestAnimationFrame(tick);
  };
  const onGripMove = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastY = e.clientY;
    layoutDrag();
  };
  const onGripUp = (e) => { const d = drag.current; if (d && e.pointerId === d.pointerId) endDrag(true); };
  const onGripCancel = (e) => { const d = drag.current; if (d && e.pointerId === d.pointerId) endDrag(false); };
  useEffect(() => () => { if (drag.current) cancelAnimationFrame(drag.current.raf); }, []);

  const statusText = status === 'synced'
    ? 'Saved to your account, so your other devices show the same home.'
    : 'Saved on this device. It reaches your account when you are back online.';

  const renderRow = (row, i, g) => (
    <li key={row.id} className={'he-card' + (row.on ? '' : ' is-off')} data-id={row.id}>
      <div className="he-row">
        <span className="he-grip" aria-hidden="true"
          onPointerDown={(e) => startDrag(e, g, i)} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripCancel}>
          <Icon.grip />
        </span>
        <span className="hm-cell hm-f-sm-b he-name">
          <span className="hm-clip">{row.name}{row.note ? <span className="he-note">{row.note}</span> : null}</span>
        </span>
        <button type="button" className="he-move he-move--up" data-move={`${row.id}:up`} aria-label={`Move ${row.name} up`}
          disabled={i === 0} onClick={() => moveBy(row, -1, g)}><Icon.chevronUp /></button>
        <button type="button" className="he-move he-move--down" data-move={`${row.id}:down`} aria-label={`Move ${row.name} down`}
          disabled={i === g.list.length - 1} onClick={() => moveBy(row, 1, g)}><Icon.chevronDown /></button>
        <button type="button" role="switch" aria-checked={row.on} aria-label={`Show ${row.name}`}
          className={'he-switch' + (row.on ? ' on' : '')}
          aria-disabled={row.locked ? 'true' : undefined} title={row.locked ? 'Up Next is always on the home' : undefined}
          onClick={() => toggleRow(row, !row.on)} />
      </div>
      {row.parts.map((part) => (
        <div key={part.id} className={'he-row he-sub' + (part.on ? '' : ' is-off') + (part.enabled ? '' : ' is-disabled')}>
          <span className="hm-cell hm-f-sm-b he-name">
            <span className="hm-clip">{part.name}{part.note ? <span className="he-note">{part.note}</span> : null}</span>
          </span>
          <button type="button" role="switch" aria-checked={part.on} aria-label={`Show ${part.name}`}
            className={'he-switch' + (part.on ? ' on' : '')} disabled={!part.enabled}
            onClick={() => toggleRow(part, !part.on)} />
        </div>
      ))}
    </li>
  );

  return createPortal(
    <>
      <div className="an-scrim" onClick={onClose} />
      <div ref={sheetRef} className="an-sheet he-sheet" role="dialog" aria-modal="true" aria-labelledby="he-title"
        style={dock != null ? { left: `calc(var(--gu) * ${dock})`, right: 'auto', marginInline: 0 } : undefined}>
        <header className="an-head">
          <h2 className="an-title-row" id="he-title"><span className="an-cell an-title snap-g">Edit home</span></h2>
          <button ref={doneRef} type="button" className="bk-btn bk-w8 he-close" onClick={onClose}><span>Done</span></button>
        </header>
        <div className="an-body he-body" ref={bodyRef}>
          <p className="an-p he-intro">
            Choose what your home shows, and in what order. Drag a row by its handle, or use the arrows.
            {isDesktop ? ' On a wide screen the home has two panes: Now on the left, Numbers on the right.' : ''}
          </p>
          {groups.map((g) => (
            <section key={g.key} className="he-group" aria-label={g.title || 'Sections'}>
              {g.title && <h3 className="an-cell an-sec he-group-h">{g.title}</h3>}
              <ol className="he-list" ref={(el) => { if (el) listRefs.current.set(g.key, el); else listRefs.current.delete(g.key); }}>
                {g.list.map((row, i) => renderRow(row, i, g))}
              </ol>
            </section>
          ))}
          <button type="button" className="bk-btn he-reset" disabled={atDefault && !undo} onClick={onReset}>
            <span>{undo ? 'Undo reset' : 'Reset to default'}</span>
          </button>
          <p className="an-p he-status">{statusText}</p>
          <div className="he-sr" role="status" aria-live="polite">{say}</div>
        </div>
      </div>
    </>,
    document.body,
  );
}
