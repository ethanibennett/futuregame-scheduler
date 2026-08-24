import React from 'react';
import { createPortal } from 'react-dom';
import { drawMilestoneImage, shareOrDownloadCanvas } from '../utils/export.js';

export default function MilestoneCelebration({ milestone, onShare, onDismiss }) {
  if (!milestone) return null;

  const icons = {
    'break-even': '\u2696\uFE0F',
    'first-profit': '\uD83D\uDCB0',
    'career-high': '\uD83C\uDFC6',
    'game-best': '\uD83C\uDFAF'
  };

  const handleShare = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    drawMilestoneImage(ctx, 1080, 1080, milestone);
    await shareOrDownloadCanvas(canvas, 'milestone.png');
    if (onShare) onShare();
  };

  return createPortal(
    <div className="milestone-modal-backdrop" onClick={onDismiss}>
      <div className="milestone-modal" onClick={e => e.stopPropagation()}>
        <div className="milestone-icon">{icons[milestone.type] || '\u2B50'}</div>
        <div className="milestone-title">{milestone.title}</div>
        <div className="milestone-desc">{milestone.description}</div>
        {milestone.value && (
          <div style={{
            // was green regardless of sign, on a component that fires for
            // break-even as well as first-profit
            fontSize: 'var(--fs-2xl)',
            fontWeight: 'var(--fw-bold)',
            color: String(milestone.value).trim().startsWith('-') ? 'var(--danger)' : 'var(--ok)',
            fontFamily: 'var(--font-condensed)',
            fontVariantNumeric: 'var(--num-tabular)',
            marginBottom: 'var(--space-xl)',
          }}>
            {milestone.value}
          </div>
        )}
        <div className="milestone-actions">
          <button className="btn btn-primary btn-brand btn-sm" onClick={handleShare}>Share</button>
          <button className="btn btn-ghost btn-sm" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
