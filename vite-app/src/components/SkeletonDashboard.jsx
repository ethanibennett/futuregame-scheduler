import React from 'react';

/**
 * The dashboard's loading state.
 *
 * It used to disagree with the card it stands in for on six counts: a 6px
 * rounded venue band against a real 18px square full-bleed strip, 14/16 padding
 * against 28/16/14, a 10px gap against 6px, a flat 180px against a real card
 * that runs 230–280px, and a third section made of two 60px slabs where the
 * real screen has a scanner, a 3-up results grid and an avatar row.
 *
 * The worst of it was that the container carried `skeleton` as well as its
 * children, so card and children shimmered in phase and the whole block
 * flashed as one rectangle — which says "one thing is loading" when four are.
 * The container is now a real surface and only the children animate, staggered.
 *
 * 2026-09-30: on the grid. Every box is whole r tall and whole g wide with its
 * edges on grid lines (sizes live in styles.css, .skeleton-hero-* / -title /
 * -slab / -pl-grid): the hero is the real plain card's 12r, the scanner slab
 * the real 5r button, the results grid the real 8g | 8g | 17g x 9r cards.
 */
export default function SkeletonDashboard() {
  return (
    <div className="dashboard-view">
      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div className="skeleton skeleton-title" style={{width: 'calc(var(--gu) * 6)'}} />
        </div>
        <div className="skeleton-hero-card">
          <div className="skeleton skeleton-hero-strip" />
          <div className="skeleton-hero-body">
            <div className="skeleton skeleton-hero-name" style={{animationDelay: '0ms'}} />
            <div className="skeleton skeleton-hero-meta" style={{animationDelay: '90ms'}} />
            <div className="skeleton skeleton-hero-bar" style={{animationDelay: '180ms'}} />
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div className="skeleton skeleton-title" style={{width: 'calc(var(--gu) * 11)'}} />
        </div>
        <div className="skeleton skeleton-slab" />
      </div>

      {/* The results section is a 3-up grid, not another slab. */}
      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div className="skeleton skeleton-title" style={{width: 'calc(var(--gu) * 6)'}} />
        </div>
        <div className="skeleton-pl-grid">
          <div className="skeleton" style={{animationDelay: '0ms'}} />
          <div className="skeleton" style={{animationDelay: '90ms'}} />
          <div className="skeleton" style={{animationDelay: '180ms'}} />
        </div>
      </div>
    </div>
  );
}
