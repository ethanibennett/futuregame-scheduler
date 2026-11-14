import React, { useRef, useState } from 'react';

/* Swipe left to remove (owner, 2026-11-14: "build in a swipe left to delete from my schedule"): the card slides left
   over a 6g Remove button at its right edge, the iOS Mail pattern the saved hands list uses (SwipeDeleteRow in
   HandReplayerView). A drag past half the button leaves it open; a tap on the card then closes it instead of opening
   the card, and a tap on Remove removes. A mostly vertical move is a scroll and is left alone (touch-action: pan-y). */
export default function SwipeToRemove({ onRemove, label, children, disabled = false }) {
  const [shift, setShift] = useState(0);      // in g, 0 to -6
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const moved = useRef(false);
  const btnRef = useRef(null);
  if (disabled) return children;
  // The button is 7g wide, 1g of it under the card's rounded edge, so the card slides 6g.
  const gPx = () => (btnRef.current ? btnRef.current.offsetWidth / 7 : 0) || 1;
  const open = shift <= -3;
  const onPointerDown = (e) => {
    if (e.button !== 0 || (btnRef.current && btnRef.current.contains(e.target))) return;
    drag.current = { x: e.clientX, y: e.clientY, from: shift, live: false, id: e.pointerId };
    moved.current = false;
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.live) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > gPx() * 0.5) { drag.current = null; return; }
      if (Math.abs(dx) < gPx()) return;
      d.live = true; moved.current = true; setDragging(true);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
    }
    setShift(Math.max(-6, Math.min(0, d.from + dx / gPx())));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && d.live) setShift(s => (s <= -3 ? -6 : 0));
  };
  return (
    <div className={'swipe-remove' + (open ? ' is-swiped' : '') + (dragging ? ' is-dragging' : '')}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onClickCapture={(e) => {
        if (btnRef.current && btnRef.current.contains(e.target)) return;
        // The click that ends a drag, or a tap while Remove shows, does not reach the card.
        if (moved.current) { moved.current = false; e.stopPropagation(); e.preventDefault(); return; }
        if (open) { e.stopPropagation(); e.preventDefault(); setShift(0); }
      }}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) setShift(0); }}>
      <button ref={btnRef} type="button" className="swipe-remove-btn" tabIndex={open ? 0 : -1} aria-hidden={open ? undefined : true}
        aria-label={'Remove ' + label + ' from My Schedule'}
        onClick={(e) => { e.stopPropagation(); setShift(0); onRemove(); }}><span>Remove</span></button>
      <div className="swipe-remove-slide" style={shift ? { transform: 'translateX(calc(var(--gu) * ' + shift.toFixed(3) + '))' } : undefined}>
        {children}
      </div>
    </div>
  );
}
