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
  useLayoutEffect(() => {
    const measure = () => {
      const bar = document.querySelector('.top-bar');
      if (bar) { setTop(bar.getBoundingClientRect().top); return; }
      const shell = document.querySelector('.app-shell');
      const pad = shell ? parseFloat(getComputedStyle(shell).paddingTop) || 0 : 0;
      setTop(shell ? shell.getBoundingClientRect().top + pad : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);
  return (
    <div aria-hidden="true" className="grid-dev-overlay">
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
