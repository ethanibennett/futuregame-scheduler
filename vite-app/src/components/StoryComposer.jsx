// ── Story Composer ──
// Full-screen interactive composer for the Save-to-Photos flow. The user:
//   1. Picks a background (solid color swatch or photo from library)
//   2. Drags and pinches a felt-shaped placeholder to position/size the
//      replay overlay on the 9:16 Story canvas
//   3. Taps "Save" — the parent component runs the native capture/encode
//      with the chosen background + placement and saves the MP4 to Photos
//
// All math happens in Story-canvas pixel space (1080×1920). The preview
// scales that down to fit the screen. Touch coordinates are converted via
// the preview's bounding rect.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

const STORY_W = 1080;
const STORY_H = 1920;
const FELT_ASPECT = 2 / 3; // approx .replayer-table aspect (3:4.5 → 0.667)

const SWATCHES = ['#0f172a', '#1e293b', '#7c3aed', '#15803d', '#b91c1c', '#1d4ed8', '#000000', '#ffffff'];

/** Distance between two touch points. */
function touchDist(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.hypot(dx, dy);
}

/** Midpoint of two touches. */
function touchMid(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  };
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(opts:{background:string|HTMLImageElement, placement:{x,y,width,height}}) => void} props.onSave
 * @param {string} [props.initialColor]
 * @param {() => Promise<string|null>} [props.getFeltPreview]
 *   Optional: parent supplies a function that returns a data-URL PNG of the
 *   current felt (with the rail mask already applied). The composer shows it
 *   inside the placement rectangle so the user sees a true WYSIWYG preview.
 */
export default function StoryComposer({ open, onClose, onSave, initialColor = '#0f172a', getFeltPreview }) {
  const [bgColor, setBgColor] = useState(initialColor);
  const [bgImage, setBgImage] = useState(null);          // HTMLImageElement
  const [bgImageUrl, setBgImageUrl] = useState(null);    // object URL for preview
  // Placement = where the felt sits in 1080×1920 canvas space.
  const [placement, setPlacement] = useState(() => {
    const w = STORY_W * 0.92;
    const h = w / FELT_ASPECT;
    return { x: (STORY_W - w) / 2, y: (STORY_H - h) / 2, width: w, height: h };
  });

  // Gesture state — refs (not state) so we don't re-render mid-drag.
  const gestureRef = useRef(null);
  const previewRef = useRef(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [feltPreviewUrl, setFeltPreviewUrl] = useState(null);

  // When the composer opens, ask the parent for a felt-only PNG so we can
  // show a true WYSIWYG preview inside the placement rectangle.
  useEffect(() => {
    if (!open || !getFeltPreview) { setFeltPreviewUrl(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const url = await getFeltPreview();
        if (!cancelled) setFeltPreviewUrl(url || null);
      } catch (e) {
        console.warn('[story-composer] preview failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [open, getFeltPreview]);

  // Recompute preview scale on mount and resize.
  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      if (!previewRef.current) return;
      const r = previewRef.current.getBoundingClientRect();
      setPreviewScale(r.width / STORY_W);
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [open]);

  const handlePickPhoto = useCallback((file) => {
    if (!file) return;
    if (bgImageUrl) URL.revokeObjectURL(bgImageUrl);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setBgImage(img); setBgImageUrl(url); };
    img.src = url;
  }, [bgImageUrl]);

  const handlePickColor = useCallback((c) => {
    if (bgImageUrl) { URL.revokeObjectURL(bgImageUrl); setBgImageUrl(null); }
    setBgImage(null);
    setBgColor(c);
  }, [bgImageUrl]);

  // ── Drag / pinch handlers ──

  const onTouchStart = useCallback((e) => {
    e.preventDefault();
    const ts = e.touches;
    if (ts.length === 1) {
      gestureRef.current = {
        kind: 'drag',
        startTouch: { x: ts[0].clientX, y: ts[0].clientY },
        startPlacement: placement,
      };
    } else if (ts.length === 2) {
      gestureRef.current = {
        kind: 'pinch',
        startDist: touchDist(ts[0], ts[1]),
        startMid: touchMid(ts[0], ts[1]),
        startPlacement: placement,
      };
    }
  }, [placement]);

  const onTouchMove = useCallback((e) => {
    if (!gestureRef.current) return;
    e.preventDefault();
    const g = gestureRef.current;
    const ts = e.touches;
    if (g.kind === 'drag' && ts.length === 1) {
      const dxScreen = ts[0].clientX - g.startTouch.x;
      const dyScreen = ts[0].clientY - g.startTouch.y;
      const dx = dxScreen / previewScale;
      const dy = dyScreen / previewScale;
      setPlacement({
        x: g.startPlacement.x + dx,
        y: g.startPlacement.y + dy,
        width: g.startPlacement.width,
        height: g.startPlacement.height,
      });
    } else if (g.kind === 'pinch' && ts.length === 2) {
      const curDist = touchDist(ts[0], ts[1]);
      const scale = curDist / g.startDist;
      // Pinch around the center of the placement at gesture start so the
      // resize feels anchored to where the fingers are.
      const newW = Math.max(STORY_W * 0.20,
                            Math.min(STORY_W * 1.4, g.startPlacement.width * scale));
      const newH = newW / FELT_ASPECT;
      const cx = g.startPlacement.x + g.startPlacement.width / 2;
      const cy = g.startPlacement.y + g.startPlacement.height / 2;
      setPlacement({ x: cx - newW / 2, y: cy - newH / 2, width: newW, height: newH });
    } else if (g.kind === 'drag' && ts.length === 2) {
      // Promote to pinch mid-gesture if a second finger lands.
      gestureRef.current = {
        kind: 'pinch',
        startDist: touchDist(ts[0], ts[1]),
        startMid: touchMid(ts[0], ts[1]),
        startPlacement: placement,
      };
    }
  }, [previewScale, placement]);

  const onTouchEnd = useCallback((e) => {
    if (e.touches.length === 0) gestureRef.current = null;
  }, []);

  // ── Save ──

  const handleSave = useCallback(() => {
    onSave({
      background: bgImage || bgColor,
      placement,
    });
  }, [bgImage, bgColor, placement, onSave]);

  if (!open) return null;

  // Preview shows the 9:16 Story canvas scaled to fit on screen.
  return createPortal(
    <div style={{
      position:'fixed', inset:0, background:'#000', zIndex:9999,
      display:'flex', flexDirection:'column', alignItems:'center',
      paddingTop:'env(safe-area-inset-top, 0px)',
      paddingBottom:'env(safe-area-inset-bottom, 0px)',
    }}>
      {/* Header */}
      <div style={{
        width:'100%', display:'flex', justifyContent:'space-between',
        alignItems:'center', padding:'12px 16px',
      }}>
        <button type="button" onClick={onClose}
          style={{background:'transparent',border:'none',color:'rgba(255,255,255,0.85)',
                  fontSize:'1rem',fontFamily:"'Univers Condensed','Univers',sans-serif",
                  cursor:'pointer',padding:'8px'}}>
          Cancel
        </button>
        <div style={{color:'#fff',fontFamily:"'Univers Condensed','Univers',sans-serif",
                     fontSize:'0.9rem',letterSpacing:'0.08em',textTransform:'uppercase'}}>
          Story
        </div>
        <button type="button" onClick={handleSave}
          style={{background:'var(--accent, #a78bfa)',border:'none',color:'#fff',
                  fontSize:'0.95rem',fontFamily:"'Univers Condensed','Univers',sans-serif",
                  cursor:'pointer',padding:'8px 16px',borderRadius:'6px',fontWeight:600}}>
          Save
        </button>
      </div>

      {/* 9:16 preview surface — drag the felt placeholder here */}
      <div ref={previewRef}
        style={{
          position:'relative',
          width: 'min(85vw, calc((100vh - 250px) * 9 / 16))',
          aspectRatio: '9 / 16',
          background: bgImage ? '#000' : bgColor,
          backgroundImage: bgImage ? `url(${bgImageUrl})` : 'none',
          backgroundSize:'cover', backgroundPosition:'center',
          borderRadius:'12px', overflow:'hidden',
          touchAction:'none',
          userSelect:'none', WebkitUserSelect:'none',
          boxShadow:'0 8px 32px rgba(0,0,0,0.6)',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {/* Felt preview — actual snapshot of the current replay state with a
            capsule mask applied so the user sees a true WYSIWYG composition.
            Falls back to a dashed-outline placeholder if no preview is
            available (e.g. capture failed). */}
        <div style={{
          position:'absolute',
          left: (placement.x / STORY_W) * 100 + '%',
          top:  (placement.y / STORY_H) * 100 + '%',
          width:  (placement.width  / STORY_W) * 100 + '%',
          height: (placement.height / STORY_H) * 100 + '%',
          // Capsule clip on the preview matches the native mask exactly.
          borderRadius:'100%',
          overflow:'hidden',
          pointerEvents:'none',
          background: feltPreviewUrl ? 'transparent' : 'rgba(124,58,237,0.18)',
          border: feltPreviewUrl ? 'none' : '1.5px dashed rgba(255,255,255,0.55)',
          display:'flex',alignItems:'center',justifyContent:'center',
        }}>
          {feltPreviewUrl
            ? <img src={feltPreviewUrl}
                   alt="Felt preview"
                   style={{width:'100%',height:'100%',objectFit:'fill',pointerEvents:'none'}}/>
            : <span style={{color:'rgba(255,255,255,0.7)', fontSize:'0.75rem',
                            fontFamily:"'Univers Condensed','Univers',sans-serif",
                            textTransform:'uppercase', letterSpacing:'0.08em'}}>
                Replay
              </span>}
        </div>

        {/* Hint */}
        <div style={{
          position:'absolute', bottom:'10px', left:'50%', transform:'translateX(-50%)',
          color:'rgba(255,255,255,0.5)', fontSize:'0.65rem',
          fontFamily:"'Univers Condensed','Univers',sans-serif",
          textTransform:'uppercase', letterSpacing:'0.05em',
          background:'rgba(0,0,0,0.4)', padding:'4px 10px', borderRadius:'10px',
          whiteSpace:'nowrap', pointerEvents:'none',
        }}>
          Drag · pinch to resize
        </div>
      </div>

      {/* Background controls */}
      <div style={{
        marginTop:'18px', display:'flex', flexDirection:'column',
        alignItems:'center', gap:'10px', padding:'0 20px', width:'100%',
      }}>
        <div style={{color:'rgba(255,255,255,0.55)', fontSize:'0.7rem',
                     fontFamily:"'Univers Condensed','Univers',sans-serif",
                     letterSpacing:'0.08em', textTransform:'uppercase'}}>
          Background
        </div>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap',justifyContent:'center',maxWidth:'340px'}}>
          {SWATCHES.map(c => (
            <button key={c} type="button" title={c}
              onClick={() => handlePickColor(c)}
              style={{
                width:'34px',height:'34px',borderRadius:'8px',
                background:c,
                border: (bgColor === c && !bgImage)
                  ? '2px solid #fff'
                  : '1px solid rgba(255,255,255,0.2)',
                padding:0,cursor:'pointer',
              }}/>
          ))}
          <label style={{
            width:'34px', height:'34px', borderRadius:'8px',
            border: bgImage ? '2px solid #fff' : '1px dashed rgba(255,255,255,0.4)',
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', background:'rgba(255,255,255,0.05)',
            color:'rgba(255,255,255,0.7)', fontSize:'0.75rem',
          }}>
            📷
            <input type="file" accept="image/*" style={{display:'none'}}
              onChange={(e) => handlePickPhoto(e.target.files?.[0])} />
          </label>
        </div>
      </div>
    </div>,
    document.body
  );
}
