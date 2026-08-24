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
 */
export default function SkeletonDashboard() {
  return (
    <div className="dashboard-view">
      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div className="skeleton skeleton-text" style={{width: 80, height: 14}} />
        </div>
        {/* Hero card: 18px full-bleed strip, then the real padding. */}
        <div className="skeleton-hero-card">
          <div className="skeleton" style={{height: 18, borderRadius: 0}} />
          <div className="skeleton-hero-body">
            <div className="skeleton skeleton-text" style={{width: '55%', height: 15, animationDelay: '0ms'}} />
            <div className="skeleton skeleton-text" style={{width: '35%', height: 11, animationDelay: '90ms'}} />
            <div className="skeleton-hero-stats">
              <div className="skeleton skeleton-text" style={{animationDelay: '180ms'}} />
              <div className="skeleton skeleton-text" style={{animationDelay: '230ms'}} />
              <div className="skeleton skeleton-text" style={{animationDelay: '280ms'}} />
            </div>
            <div className="skeleton" style={{height: 6, borderRadius: 'var(--radius-xs)', animationDelay: '330ms'}} />
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div className="skeleton skeleton-text" style={{width: 70, height: 14}} />
        </div>
        <div className="skeleton" style={{height: 60, borderRadius: 'var(--radius-sm)'}} />
      </div>

      {/* The results section is a 3-up grid, not another slab. */}
      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div className="skeleton skeleton-text" style={{width: 100, height: 14}} />
        </div>
        <div className="skeleton-pl-grid">
          <div className="skeleton" style={{height: 52, borderRadius: 'var(--radius)', animationDelay: '0ms'}} />
          <div className="skeleton" style={{height: 52, borderRadius: 'var(--radius)', animationDelay: '90ms'}} />
          <div className="skeleton" style={{height: 52, borderRadius: 'var(--radius)', animationDelay: '180ms'}} />
        </div>
      </div>
    </div>
  );
}
