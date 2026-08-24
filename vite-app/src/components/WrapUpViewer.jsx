import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  computeScorecardData, drawWrapSlide1, drawWrapSlide2, drawWrapSlide3,
  drawWrapSlide4, drawWrapSlide5, shareOrDownloadCanvas, ensureExportFonts,
} from '../utils/export.js';

export default function WrapUpViewer({ trackingData, tournaments, onClose }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const data = useMemo(() => computeScorecardData(trackingData, null, tournaments), [trackingData, tournaments]);

  const slideNames = ['Overview', 'Numbers', 'Best Moment', 'Game Mix', 'Fun Facts'];
  const slideFns = [drawWrapSlide1, drawWrapSlide2, drawWrapSlide3, drawWrapSlide4, drawWrapSlide5];

  const handleShare = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    slideFns[currentSlide](ctx, 1080, 1920, data);
    await shareOrDownloadCanvas(canvas, 'series-wrap-' + (currentSlide + 1) + '.png');
  };

  const handleShareAll = async () => {
    for (let i = 0; i < slideFns.length; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 1080; canvas.height = 1920;
      const ctx = canvas.getContext('2d');
      slideFns[i](ctx, 1080, 1920, data);
      await shareOrDownloadCanvas(canvas, 'series-wrap-' + (i + 1) + '.png');
    }
  };

  // Preview canvas
  const previewRef = useRef(null);
  useEffect(() => {
    // Canvas neither triggers webfont loading nor waits for it, so drawing
    // synchronously here set five 1080x1920 slides in Arial whenever the face
    // had not already resolved on screen. `cancelled` guards the await: the
    // slide can change while the fonts are still loading.
    let cancelled = false;
    (async () => {
      await ensureExportFonts();
      if (cancelled) return;
      const cvs = previewRef.current;
      if (!cvs) return;
      cvs.width = 1080; cvs.height = 1920;
      const ctx = cvs.getContext('2d');
      slideFns[currentSlide](ctx, 1080, 1920, data);
    })();
    return () => { cancelled = true; };
  }, [currentSlide, data]);

  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel" style={{ maxHeight: '85vh' }}>
        <h3>Series Wrap-Up</h3>
        <div className="wrapup-slide-picker">
          {slideNames.map((name, i) => (
            <button
              key={i}
              className={currentSlide === i ? 'active' : ''}
              onClick={() => setCurrentSlide(i)}
            >{name}</button>
          ))}
        </div>
        <div style={{ textAlign: 'center', margin: '12px 0' }}>
          <canvas
            ref={previewRef}
            style={{ width: '200px', height: '356px', borderRadius: '8px', border: '1px solid var(--border)' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
          <button className="btn btn-primary btn-sm" onClick={handleShare}>Share This Slide</button>
          <button className="btn btn-ghost btn-sm" onClick={handleShareAll}>Download All</button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </>,
    document.body
  );
}
