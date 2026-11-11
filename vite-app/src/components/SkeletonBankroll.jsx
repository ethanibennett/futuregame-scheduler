import React from 'react';
import './skeleton-bankroll.css';

/**
 * The Bankroll tab while its data is on the way (Bankroll design 4 and 95), beside SkeletonSchedule and
 * SkeletonDashboard: the page holds its shape, still (no shimmer: one motion family), and a figure not
 * yet known is a quiet block, never "$0".
 *
 *   <Bone w h />        a block where text will be: w whole g wide, h r tall (1 or 2), --radius-xs; on the
 *                       page in --border, inside a SkeletonBlocks block in --surface2.
 *   <BoneLine h w />    a cell h r tall whose bone sits on its last line (the text's r line), right-aligned
 *                       with `end`.
 *   <SkeletonBlocks blocks />   a section's blocks at their real heights: [{ h, card, bars: [[w, h], …] }]
 *                       — the heights are the blocks' own constants, so nothing jumps when the data lands.
 */
export function Bone({ w = 4, h = 1, className = '' }) {
  return <i className={'sk-bone ' + className} aria-hidden="true" style={{ '--w': w, '--h': h }} />;
}

export function BoneLine({ h = 2, w = 4, bh = 1, end = false, className = '' }) {
  return (
    <div className={'sk-line' + (end ? ' is-end' : '') + (className ? ' ' + className : '')} aria-hidden="true" style={{ '--lh': h }}>
      <Bone w={w} h={bh} />
    </div>
  );
}

export function SkeletonBlocks({ blocks, label = 'Loading' }) {
  return (
    <div className="sk-blocks" role="status" aria-busy="true" aria-label={label}>
      {blocks.map((b, i) => (
        <div key={i} className={'sk-block' + (b.card ? ' is-card' : '')} style={{ '--bh': b.h }}>
          {(b.bars || []).map(([w, h, at], j) => (
            <Bone key={j} w={w} h={h || 1} className={at === 'end' ? 'is-end' : ''} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default SkeletonBlocks;
