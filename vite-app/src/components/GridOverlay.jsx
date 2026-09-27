import React, { useLayoutEffect, useState } from 'react';

/**
 * Admin-only layout-grid overlay. Draws the app's real content grid faintly
 * over the screen so alignment can be checked against it and detailed layout
 * fixes made by eye.
 *
 * Matches the .content-area rails exactly: 12px side margins on phone
 * (16/20 vertical, 20 horizontal at >=640; 32 horizontal at >=1024), four
 * columns with 12px gutters, and an 8px vertical baseline with every fourth
 * line (32px) drawn stronger. pointer-events:none so it never blocks the UI.
 *
 * The baseline is anchored to the APP's real top — the rendered top of the
 * `.top-bar`, which is the origin every seated element is measured from (the
 * wordmark on 32, the date block on 160, all relative to it). `.app-shell` pads
 * the whole app down by the safe-area inset, so on a phone that origin sits
 * 47–59px below the screen. Earlier this was computed as
 * shell.top + parseFloat(paddingTop); on the device that computed value and the
 * actually-rendered content origin differed by a couple of device px (env()
 * resolves fractionally, parseFloat rounds), so the whole ruler read a hair low
 * and everything looked "slightly above the grid". Measuring the top-bar's own
 * getBoundingClientRect().top is the origin by construction — no computation to
 * drift. Falls back to the shell's content top if the bar isn't present.
 */
export default function GridOverlay() {
  const [top, setTop] = useState(0);
  const [dbg, setDbg] = useState('');
  useLayoutEffect(() => {
    // Live device readout: prints the actual numbers the pill/scroll math depends
    // on, measured on THIS device, so a screenshot shows the truth instead of a
    // Windows-WebKit guess. Reads r from a probe styled with the real --subrow.
    const readDbg = () => {
      try {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;height:var(--subrow);width:0;visibility:hidden';
        document.body.appendChild(probe);
        const cssR = probe.getBoundingClientRect().height;
        document.body.removeChild(probe);
        const jsR = (window.innerWidth / 37) * 0.71;
        const bar = document.querySelector('.top-bar');
        const barTop = bar ? bar.getBoundingClientRect().top : 0;
        const ca = document.querySelector('.content-area');
        const caTop = ca ? ca.getBoundingClientRect().top : 0;
        const sf = document.querySelector('.tab-panel.tab-active .sticky-filters, .sticky-filters');
        const sfr = sf ? sf.getBoundingClientRect() : null;
        const db = [...document.querySelectorAll('.schedule-date-break')]
          .map(x => x.getBoundingClientRect())
          .filter(r => r.top > barTop - 5 && r.top < barTop + 400)
          .sort((a, b) => a.top - b.top)[0];
        const R = v => (v == null ? '—' : (v / cssR).toFixed(2));
        setDbg(
          `iw=${window.innerWidth} cssR=${cssR.toFixed(3)} jsR=${jsR.toFixed(3)}` +
          ` | bar=${barTop.toFixed(1)} ca=${caTop.toFixed(1)} scroll=${ca ? ca.scrollTop.toFixed(0) : '—'}` +
          ` | sf ${sfr ? R(sfr.top - barTop) + '→' + R(sfr.bottom - barTop) + 'r' : '—'}` +
          ` | db ${db ? R(db.top - barTop) + '→' + R(db.bottom - barTop) + 'r' : '—'}`
        );
      } catch (e) { setDbg('dbg err: ' + e.message); }
    };
    const measure = () => {
      const bar = document.querySelector('.top-bar');
      if (bar) { setTop(bar.getBoundingClientRect().top); } else {
        const shell = document.querySelector('.app-shell');
        const pad = shell ? parseFloat(getComputedStyle(shell).paddingTop) || 0 : 0;
        setTop(shell ? shell.getBoundingClientRect().top + pad : 0);
      }
      readDbg();
    };
    // Measure now, then again after layout settles. A WKWebView applies the
    // safe-area inset AFTER first layout, so a single mount-time measurement
    // catches the top-bar before it has been pushed down and the whole ruler
    // ends up offset — which reads as "everything is off the grid". Re-measure
    // across a few frames/timeouts and whenever the bar actually moves.
    measure();
    const rafs = [requestAnimationFrame(() => { measure(); requestAnimationFrame(measure); })];
    const timers = [setTimeout(measure, 150), setTimeout(measure, 500), setTimeout(measure, 1200)];
    const bar = document.querySelector('.top-bar');
    let ro;
    if (bar && 'ResizeObserver' in window) { ro = new ResizeObserver(measure); ro.observe(bar); }
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    // Update the readout live during scroll so a mid-scroll screenshot captures
    // the peek/pin state.
    const ca = document.querySelector('.content-area');
    if (ca) ca.addEventListener('scroll', readDbg, { passive: true });
    const dbgTimer = setInterval(readDbg, 500);
    return () => {
      rafs.forEach(cancelAnimationFrame);
      timers.forEach(clearTimeout);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      if (ca) ca.removeEventListener('scroll', readDbg);
      clearInterval(dbgTimer);
    };
  }, []);
  return (
    <div aria-hidden="true" className="grid-dev-overlay">
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(var(--nav-h) + var(--subrow))', zIndex: 99999, font: '10px/1.3 ui-monospace,Menlo,monospace', color: '#0ff', background: 'rgba(0,0,0,0.82)', padding: '4px 6px', pointerEvents: 'none', wordBreak: 'break-all' }}>{dbg}</div>
      <div className="grid-dev-baseline" style={{ top }} />
      <div className="grid-dev-cols">
        <span className="grid-dev-col" />
        <span className="grid-dev-col" />
        <span className="grid-dev-col" />
        <span className="grid-dev-col" />
      </div>
    </div>
  );
}
