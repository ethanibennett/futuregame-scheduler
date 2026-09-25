import React from 'react';

/**
 * Admin-only layout-grid overlay. Draws the app's real content grid faintly
 * over the screen so alignment can be checked against it and detailed layout
 * fixes made by eye.
 *
 * Matches the .content-area rails exactly: 12px side margins on phone
 * (16/20 vertical, 20 horizontal at >=640; 32 horizontal at >=1024), four
 * columns with 12px gutters, and an 8px vertical baseline with every fourth
 * line (32px) drawn stronger. pointer-events:none so it never blocks the UI.
 */
export default function GridOverlay() {
  return (
    <div aria-hidden="true" className="grid-dev-overlay">
      <div className="grid-dev-baseline" />
      <div className="grid-dev-cols">
        <span className="grid-dev-col" />
        <span className="grid-dev-col" />
        <span className="grid-dev-col" />
        <span className="grid-dev-col" />
      </div>
    </div>
  );
}
