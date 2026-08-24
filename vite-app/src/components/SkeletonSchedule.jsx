import React from 'react';

/**
 * A skeleton whose only job is to reserve the right space was reserving the
 * wrong space: 52px + 4px against a real row of 88 + 6, a 38px error per row
 * that compounded to ~340px across a nine-row skeleton, and the placeholder
 * had no venue strip so the left edge changed at hand-off too.
 *
 * The children are staggered because the container used to carry the shimmer
 * as well, so card and children animated in phase and the whole block flashed
 * as one rectangle - which says "one thing is loading" when four are.
 */
export default function SkeletonSchedule() {
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
      {[0,1,2].map(g => (
        <div key={g}>
          <div style={{display: 'flex', alignItems: 'baseline', gap: 4, padding: '12px 12px 16px 2px'}}>
            <div className="skeleton" style={{width: 62, height: 30, borderRadius: 'var(--radius-pill)'}} />
            <div className="skeleton skeleton-text" style={{width: 28, height: 12}} />
          </div>
          {[0,1,2].map(i => (
            <div
              key={i}
              style={{
                display: 'flex',
                height: 88,
                marginBottom: 6,
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                background: 'var(--surface)',
                boxShadow: 'var(--elev-1)',
              }}
            >
              <div className="skeleton" style={{width: 26, flex: 'none', borderRadius: 0, animationDelay: `${i * 90}ms`}} />
              <div style={{flex: 1, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center'}}>
                <div className="skeleton skeleton-text" style={{width: '38%', height: 11, animationDelay: `${i * 90 + 60}ms`}} />
                <div className="skeleton skeleton-text" style={{width: '64%', height: 13, animationDelay: `${i * 90 + 120}ms`}} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
