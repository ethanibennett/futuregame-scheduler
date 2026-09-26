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
 * The baseline is anchored to the APP's top, not the screen's. `.app-shell`
 * pads the whole app down by the safe-area inset (index.html: env() in the
 * browser, max(env(), 47px) standalone), so on a phone the app's y=0 sits
 * 47–59px below the screen top — neither a multiple of 8. A ruler starting at
 * screen y=0 then reads every on-grid element as 3–7px off, everywhere, which
 * is what "nothing hits the grid in the PWA" looked like. The offset is
 * MEASURED off the shell (its computed padding-top) rather than restated
 * here, so the overlay follows whatever rule the shell uses.
 */
export default function GridOverlay() {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const shell = document.querySelector('.app-shell');
      const pad = shell ? parseFloat(getComputedStyle(shell).paddingTop) || 0 : 0;
      const y = shell ? shell.getBoundingClientRect().top + pad : 0;
      setTop(y);
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
