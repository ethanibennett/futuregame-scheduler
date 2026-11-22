import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { rowStrip, recentRows, historyFromHands } from '../utils/variant-catalog.js';
import { STRUCTURES, STRUCTURE_SHORT, buildWheels, positionOf, structuresOf, turnGame, turnVariant, turnStructure, quickPicks, variantLabel } from '../utils/variant-wheels.js';
import './variant-picker.css';

/*
 * The New Hand variant wheels (owner, 2026-11-22: "Let's build the wheels picker"), built from the
 * owner's revision of direction 9 (docs/prototypes/variant-wheels.html): the structure on the left,
 * the game on the right, read as one phrase across the band ("POT LIMIT | Omaha"); a game with
 * relatives has a › beside it that opens its variants on a third wheel to the right.
 *
 *   Quick picks   the player's last three games (this device's picks, else the saved hands'), or
 *                 NLH, PLO and 2-7 TD; then Search, the palette (VariantPicker.jsx Palette): search by
 *                 slang, the mixes, a game's rules.
 *   The wheels    flick, drag or mouse-wheel a wheel, tap a row, or focus a wheel and use the arrow
 *                 keys (Home / End). Turning the game or a variant brings the structure to its usual
 *                 one, and any structure the game has a game type for can be turned to (owner, 2026-11-22: "Default
 *                 to the standard limit for each game but allow users to change it"); a structure it has none for
 *                 (No Limit Badugi: it would be dealt with another game's betting) is struck through and springs back.
 *                 No line under the wheels (owner, 2026-11-22: "get rid of the 'X is only played limit' etc line").
 *
 * Every position is a catalog row (utils/variant-wheels.js), and a pick goes through the same
 * onPick(row) the palette uses, so the hand made is the one the palette would make.
 */

const reduceMotion = () => {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
};

/* One wheel: a scroll-snapped list whose middle row (under the band) is the pick. `index` is the
   pick; `onTurn(i)` asks for row i and returns false to refuse it (the wheel springs back). */
function Wheel({ id, label, items, index, onTurn, listKey, className = '', hidden = false }) {
  const ref = useRef(null);
  // keyTo: where the last key sent the pick, until the pick arrives, so presses faster than a render add up.
  // glide: the row the wheel is gliding to on its own (a pick made elsewhere), until it gets there: a slow
  // frame mid-glide must not read as the player stopping the wheel on the row it is leaving.
  const st = useRef({ timer: 0, raf: 0, placedAt: -1, keyTo: null, glide: null });
  const indexRef = useRef(index);
  indexRef.current = index;
  const turnRef = useRef(onTurn);
  turnRef.current = onTurn;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // A row's height, read from its computed style (whole r in the CSS; a transform does not change it).
  const rowPx = () => {
    const li = ref.current && ref.current.querySelector('li');
    const h = li ? parseFloat(getComputedStyle(li).height) : 0;
    return Number.isFinite(h) ? h : 0;
  };
  // The rows tilt and fade away from the band, as a drum would.
  const paint = useCallback(() => {
    const el = ref.current;
    const h = rowPx();
    if (!el || !h) return;
    const at = el.scrollTop / h;
    const still = reduceMotion();
    el.querySelectorAll('li').forEach((li, i) => {
      const d = i - at;
      const a = Math.min(Math.abs(d), 3);
      li.style.opacity = String(Math.max(0.22, 1 - a * 0.3));
      li.style.transform = still ? '' : `rotateX(${(-d * 16).toFixed(1)}deg) scale(${(1 - a * 0.05).toFixed(3)})`;
    });
  }, []);
  const place = useCallback((i, smooth) => {
    const el = ref.current;
    const h = rowPx();
    if (!el || !h) return false;
    const top = i * h;
    const far = Math.abs(el.scrollTop - top) > 0.5;
    const glide = far && smooth && !reduceMotion();
    if (far) el.scrollTo({ top, behavior: glide ? 'smooth' : 'auto' });
    st.current.glide = glide ? { i, until: performance.now() + 1500 } : null;
    st.current.placedAt = i;
    paint();
    return true;
  }, [paint]);

  // To the pick when it changes from outside (a pick elsewhere, a structure that follows its game),
  // or the list does. The first placing is instant.
  useLayoutEffect(() => {
    st.current.keyTo = null;
    place(index, st.current.placedAt >= 0);
  }, [index, listKey, place]);
  // Painted after every render (React re-creates a row whose key changed), and placed again when the
  // wheel is first laid out or changes size (the tab shown, the window resized: a row is a whole r).
  useLayoutEffect(() => { paint(); });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (el.clientHeight) place(indexRef.current, false); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [place]);
  useEffect(() => () => { clearTimeout(st.current.timer); cancelAnimationFrame(st.current.raf); }, []);

  const settle = () => {
    const el = ref.current;
    const h = rowPx();
    if (!el || !h) return;
    const list = itemsRef.current;
    const i = Math.max(0, Math.min(list.length - 1, Math.round(el.scrollTop / h)));
    const g = st.current.glide;
    if (g) {
      if (i === g.i) { st.current.glide = null; return; }
      if (performance.now() < g.until) { st.current.timer = setTimeout(settle, 120); return; }
      st.current.glide = null;
      place(indexRef.current, false);
      return;
    }
    if (i === indexRef.current) return;
    if (list[i].off || turnRef.current(i) === false) place(indexRef.current, true);
  };
  const onScroll = () => {
    if (!st.current.raf) st.current.raf = requestAnimationFrame(() => { st.current.raf = 0; paint(); });
    clearTimeout(st.current.timer);
    st.current.timer = setTimeout(settle, 120);
  };
  // A finger, the mouse or its wheel on the wheel takes it over from a glide.
  const grab = () => { st.current.glide = null; };
  // The keys: up and down to the next row that can be picked, Home and End to the first and last.
  const onKeyDown = (e) => {
    const list = itemsRef.current;
    const ok = (i) => i >= 0 && i < list.length && !list[i].off;
    const from = st.current.keyTo != null ? st.current.keyTo : indexRef.current;
    let to = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1;
      for (let i = from + step; i >= 0 && i < list.length; i += step) if (ok(i)) { to = i; break; }
    } else if (e.key === 'Home') to = list.findIndex((x) => !x.off);
    else if (e.key === 'End') { for (let i = list.length - 1; i >= 0; i -= 1) if (ok(i)) { to = i; break; } }
    else return;
    e.preventDefault();
    if (to >= 0 && to !== from && turnRef.current(to) !== false) st.current.keyTo = to;
  };

  return (
    <div ref={ref} id={id} className={'vw-wheel ' + className} role="listbox" aria-label={label}
      tabIndex={hidden ? -1 : 0} aria-hidden={hidden || undefined}
      aria-activedescendant={items[index] ? `${id}-${index}` : undefined}
      onScroll={onScroll} onKeyDown={onKeyDown} onPointerDown={grab} onTouchStart={grab} onWheel={grab}>
      <ul>
        {items.map((it, i) => (
          <li key={it.key} id={`${id}-${i}`} role="option" aria-selected={i === index} aria-disabled={it.off || undefined}
            className={(it.off ? 'is-off' : '') + (it.cls ? ' ' + it.cls : '')}
            onClick={() => { if (!it.off && i !== indexRef.current) turnRef.current(i); }}>
            {it.node}
          </li>
        ))}
      </ul>
    </div>
  );
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
);

/** The wheels, the quick picks over them and the line under them. `current` is the picked row
 *  (HandReplayerView's currentRow); `onPick(row, { mix, create })` is the palette's pickVariant. */
export function VariantWheels({ rows, current, onPick, history, hands, onSearch, name }) {
  const wheels = useMemo(() => buildWheels(rows), [rows]);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const pos = useMemo(() => positionOf(wheels, current) || { g: 0, v: 0, s: 0 }, [wheels, current]);
  const grp = wheels.groups[pos.g] || wheels.groups[0];
  const hasVariants = !!grp && grp.games.length > 1;
  const [open, setOpen] = useState(pos.v > 0);
  // A pick of a variant from anywhere (the guess, a quick pick, the palette) opens its wheel; a game
  // with none closes it. Turning to another family keeps it open, on that family's first game.
  useEffect(() => {
    if (pos.v > 0) setOpen(true);
    else if (!hasVariants) setOpen(false);
  }, [pos.g, pos.v, hasVariants]);
  const isOpen = open && hasVariants;

  const pick = (row) => { if (row) onPick(row, { mix: null, create: false }); return !!row; };
  const toggle = () => {
    if (isOpen) {
      setOpen(false);
      if (pos.v > 0) pick(turnVariant(wheels, pos.g, 0));   // folded away: back to the game itself
    } else setOpen(true);
  };

  const played = current ? structuresOf(wheels, current.game) : new Set(STRUCTURES);
  const structItems = STRUCTURES.map((s) => ({
    key: s, off: !played.has(s),
    node: <><span className="vw-s-long">{s}</span><span className="vw-s-short">{STRUCTURE_SHORT[s]}</span></>,
  }));
  const gameItems = wheels.groups.map((g) => ({
    key: g.key,
    node: <><span className="vw-name">{g.label}</span>{g.games.length > 1 && <span className="vw-more" aria-hidden="true">{g.games.length - 1} ›</span>}</>,
  }));
  const varItems = (grp ? grp.games : []).map((game, i) => ({
    key: game, cls: i === 0 ? 'is-base' : '', node: <span className="vw-name">{variantLabel(grp, game)}</span>,
  }));

  const seeded = !(history && history.length) && !!(hands && hands.length);
  const recent = useMemo(() => recentRows(rows, seeded ? historyFromHands(rows, hands) : history), [rows, history, hands, seeded]);
  const quick = useMemo(() => quickPicks(rows, recent, 3), [rows, recent]);
  const band = current ? rowStrip(current).color : undefined;

  return (
    <div className={'vw' + (isOpen ? ' is-open' : '')}>
      <div className="vw-label"><span>{quick.recent ? 'Recent' : 'Popular'}</span></div>
      <div className="vw-quick" role="group" aria-label={quick.recent ? 'Recent games' : 'Popular games'}>
        {quick.rows.map((r) => {
          const s = rowStrip(r);
          const on = !!current && current.key === r.key && !current.mix;
          return (
            <button key={r.key} type="button" className={'vw-chip ctl' + (on ? ' is-on' : '')} aria-pressed={on}
              aria-label={r.name} onClick={() => onPick(r, { mix: null, create: false })}>
              <i style={{ background: s.color }} aria-hidden="true" /><span>{s.abbr}</span>
            </button>
          );
        })}
        <button type="button" className="vw-chip vw-search ctl" onClick={onSearch} aria-haspopup="dialog" aria-label="Search games and mixes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>
          <span>Search</span>
        </button>
      </div>
      <div className="vw-cols" aria-hidden="true">
        <span className="vw-col is-struct"><span>Structure</span></span>
        <span className="vw-col"><span>Game</span></span>
        <span />
        <span className="vw-col is-var"><span>{grp && grp.custom ? 'Your games' : `${grp ? grp.label : ''} variants`}</span></span>
      </div>
      <div className="vw-wheels">
        <div className="vw-band" style={band ? { '--vw-fam': band } : undefined} aria-hidden="true" />
        <Wheel id={`vw-struct-${uid}`} label="Betting structure" className="vw-struct" items={structItems} index={Math.max(0, pos.s)}
          listKey={current ? current.game : ''} onTurn={(i) => pick(turnStructure(wheels, current, i))} />
        <Wheel id={`vw-game-${uid}`} label="Game" className="vw-game" items={gameItems} index={pos.g}
          listKey={wheels.groups.length} onTurn={(i) => pick(turnGame(wheels, i))} />
        <button type="button" className="vw-exp ctl" hidden={!hasVariants} aria-expanded={isOpen} aria-controls={`vw-var-${uid}`}
          aria-label={isOpen ? `Hide ${grp.label} variants` : `Show ${grp ? grp.label : ''} variants${grp ? ': ' + grp.games.slice(1).map((g) => variantLabel(grp, g)).join(', ') : ''}`}
          onClick={toggle}>
          <Chevron />
        </button>
        <Wheel id={`vw-var-${uid}`} label={`${grp ? grp.label : ''} variants`} className="vw-var" items={varItems} index={isOpen ? pos.v : 0}
          listKey={grp ? grp.key : ''} hidden={!isOpen} onTurn={(i) => pick(turnVariant(wheels, pos.g, i))} />
      </div>
      <span className="vw-sr" aria-live="polite">{name}</span>
    </div>
  );
}

export default VariantWheels;
