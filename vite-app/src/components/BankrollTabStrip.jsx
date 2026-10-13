import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { segmentWidths, fitsDivided, revealScroll, keyStep, pageScroll, wheelToStrip } from '../utils/tab-strip.js';
import './bankroll-tabstrip.css';

/**
 * The bankroll dashboard's tab strip (beta, app admins), for any number of tabs.
 *
 * While every label fits, it is the dashboard's 35g segmented control (bankroll-dashboard.css
 * .bd-seg): the segments share the width in whole g, the first (35 mod N) one g wider. When a label
 * would not fit its segment unclipped with a g of room (7 tabs at 5g: "Locations" is wider), it
 * becomes ONE row of content-sized pills that scrolls sideways: each pill's width is rounded up to a
 * whole g by the app's snap-g utility (utils/grid-snap.js), the selected one is scrolled into view
 * when the strip opens and whenever it changes (to a whole-g offset, so the pills come to rest on
 * g lines), the edges fade where there is more, and there is no scrollbar. Touch and trackpads
 * scroll it natively; a plain mouse wheel turned over it scrolls it sideways while it can move
 * (then the page scrolls on); the chevron at an edge with more beyond it is a button that pages
 * the strip by whole g (pointer only: tabindex -1, outside the radio group); the arrow keys, Home
 * and End move the selection (one tab stop, roving). Keyboard focus on a pill is a ring of its own
 * inside the selection's ring, since roving focus always lands on the selected pill.
 *
 * The decision is measured, not guessed: a hidden copy of the labels in the tabs' own type is
 * measured in g on mount, when the labels change, on resize and once the webfonts have loaded.
 * The arithmetic is utils/tab-strip.js (tested).
 *
 * Props as the Overview's Segmented: options [[key, label]], value, onChange, label (the group's
 * accessible name), className (the strip's place: bd-tabs), btnClass (each tab's classes).
 */
const TOTAL = 35;
const smooth = () => {
  try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return true; }
};

function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 6 10" aria-hidden="true" focusable="false">
      <path d={dir === 'left' ? 'M5 1L1 5l4 4' : 'M1 1l4 4-4 4'} />
    </svg>
  );
}

export default function TabStrip({ options, value, onChange, label, className = '', btnClass = 'bk-seg-btn' }) {
  const wrapRef = useRef(null);
  const scrollRef = useRef(null);
  const measureRef = useRef(null);
  const btnRefs = useRef([]);
  const [mode, setMode] = useState('divided');
  const [edges, setEdges] = useState({ start: false, end: false });
  const sig = options.map((o) => o[1]).join('\u0001');
  const n = options.length;
  const active = Math.max(0, options.findIndex((o) => o[0] === value));

  const unit = () => {
    const w = wrapRef.current;
    return w ? w.getBoundingClientRect().width / TOTAL : 0;
  };

  // Divided or scrolling: every label's natural width against its own segment.
  const decide = useCallback(() => {
    const m = measureRef.current;
    const g = unit();
    if (!m || !(g > 0)) return;
    const widths = [...m.children].map((s) => s.getBoundingClientRect().width / g);
    setMode(fitsDivided(widths, { total: TOTAL, pad: 1 }) ? 'divided' : 'scroll');
  }, []);
  useLayoutEffect(() => { decide(); }, [decide, sig]);
  useEffect(() => {
    let live = true;
    window.addEventListener('resize', decide);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (live) decide(); });
    return () => { live = false; window.removeEventListener('resize', decide); };
  }, [decide]);

  // The fades: shown on a side only while there is more beyond it.
  const updateEdges = useCallback(() => {
    const s = scrollRef.current;
    const next = s
      ? { start: s.scrollLeft > 1, end: s.scrollLeft < s.scrollWidth - s.clientWidth - 1 }
      : { start: false, end: false };
    setEdges((e) => (e.start === next.start && e.end === next.end ? e : next));
  }, []);

  // Bring the selected pill into view. Runs a frame after the change, once grid-snap has sized the
  // pills (it does so from a MutationObserver, after React's commit).
  const firstReveal = useRef(true);
  useEffect(() => {
    if (mode !== 'scroll') { firstReveal.current = true; return undefined; }
    const animate = !firstReveal.current && smooth();
    firstReveal.current = false;
    const raf = requestAnimationFrame(() => {
      const s = scrollRef.current, el = btnRefs.current[active];
      if (!s || !el) return;
      const g = unit();
      const sr = s.getBoundingClientRect(), er = el.getBoundingClientRect();
      const target = revealScroll({
        itemLeft: er.left - sr.left + s.scrollLeft, itemWidth: er.width,
        scrollLeft: s.scrollLeft, viewWidth: s.clientWidth, contentWidth: s.scrollWidth, edge: 3 * g, g,
      });
      if (target != null) s.scrollTo({ left: target, behavior: animate ? 'smooth' : 'auto' });
      updateEdges();
    });
    return () => cancelAnimationFrame(raf);
  }, [mode, active, sig, updateEdges]);

  // Content or width changes (fonts, rotation, grid-snap) move the edges.
  useEffect(() => {
    const s = scrollRef.current;
    if (mode !== 'scroll' || !s || typeof ResizeObserver === 'undefined') { updateEdges(); return undefined; }
    const ro = new ResizeObserver(() => updateEdges());
    ro.observe(s);
    [...s.children].forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [mode, sig, updateEdges]);

  // A vertical mouse wheel over the strip scrolls it sideways while it can still move that way
  // (React's onWheel is passive, so the listener is attached here to be able to take the turn).
  useEffect(() => {
    const s = scrollRef.current;
    if (mode !== 'scroll' || !s) return undefined;
    const onWheel = (e) => {
      const by = wheelToStrip(e, { scrollLeft: s.scrollLeft, viewWidth: s.clientWidth, contentWidth: s.scrollWidth });
      if (!by) return;
      e.preventDefault();
      s.scrollLeft += by;
    };
    s.addEventListener('wheel', onWheel, { passive: false });
    return () => s.removeEventListener('wheel', onWheel);
  }, [mode]);

  // The chevrons: a page of tabs that way, to a whole-g offset.
  const page = (dir) => {
    const s = scrollRef.current;
    if (!s) return;
    const g = unit();
    const left = pageScroll({ scrollLeft: s.scrollLeft, viewWidth: s.clientWidth, contentWidth: s.scrollWidth, edge: 3 * g, g, dir });
    s.scrollTo({ left, behavior: smooth() ? 'smooth' : 'auto' });
  };
  const keepFocus = (e) => e.preventDefault();   // a pointer press on a chevron leaves focus where it was

  const onKeyDown = (e) => {
    const j = keyStep(e.key, active, n);
    if (j == null) return;
    e.preventDefault();
    onChange(options[j][0]);
    const el = btnRefs.current[j];
    if (el) el.focus({ preventScroll: true });
  };

  const buttons = options.map(([k, text], i) => (
    <button key={String(k)} ref={(el) => { btnRefs.current[i] = el; }} type="button" role="radio" aria-checked={value === k}
      tabIndex={i === active ? 0 : -1}
      className={btnClass + (mode === 'scroll' ? ' bt-pill snap-g' : '') + (value === k ? ' is-on' : '')}
      onClick={() => onChange(k)}>
      <span>{text}</span>
    </button>
  ));
  const measurer = (
    <div ref={measureRef} className="bt-measure" aria-hidden="true">
      {options.map(([k, text]) => <span key={String(k)}>{text}</span>)}
    </div>
  );

  if (mode === 'divided') {
    const cols = segmentWidths(n, TOTAL).map((w) => `calc(var(--gu) * ${w})`).join(' ');
    return (
      <div ref={wrapRef} className={'bd-seg bt-strip is-divided ' + className} data-n={n} role="radiogroup" aria-label={label}
        onKeyDown={onKeyDown} style={{ gridTemplateColumns: cols }}>
        {buttons}
        {measurer}
      </div>
    );
  }
  return (
    <div ref={wrapRef} className={'bt-strip is-scroll ' + className}>
      <div ref={scrollRef} className="bt-scroll" role="radiogroup" aria-label={label} onKeyDown={onKeyDown} onScroll={updateEdges}>
        {buttons}
      </div>
      <span className={'bt-fade is-start' + (edges.start ? ' is-on' : '')} aria-hidden="true" />
      <span className={'bt-fade is-end' + (edges.end ? ' is-on' : '')} aria-hidden="true" />
      <button type="button" className={'bt-page is-start' + (edges.start ? ' is-on' : '')} tabIndex={-1}
        aria-label="Earlier tabs" aria-hidden={edges.start ? undefined : true} disabled={!edges.start}
        onMouseDown={keepFocus} onClick={() => page(-1)}>
        <Chevron dir="left" />
      </button>
      <button type="button" className={'bt-page is-end' + (edges.end ? ' is-on' : '')} tabIndex={-1}
        aria-label="More tabs" aria-hidden={edges.end ? undefined : true} disabled={!edges.end}
        onMouseDown={keepFocus} onClick={() => page(1)}>
        <Chevron dir="right" />
      </button>
      {measurer}
    </div>
  );
}
