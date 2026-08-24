import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { parseCardNotation } from '../utils/poker-engine.js';
import { formatLiveUpdate, formatChips, ordinalSuffix, VENUE_TO_SERIES } from '../utils/utils.js';
import {
  drawStatsOnCanvas, drawDeepRunOverlay, drawFinalTableOverlay,
  drawCountdownOverlay, drawChipStackStory, drawHandOverlay, loadCardImages,
  drawRegistrationOverlay,
} from '../utils/export.js';

// ── Pinch-to-zoom hook for camera video element ──
export function usePinchZoom(videoRef, streamRef) {
  const zoomRef = useRef(1);
  const baseDist = useRef(null);
  const baseZoom = useRef(1);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const getTrack = () => streamRef.current && streamRef.current.getVideoTracks()[0];
    const hasTrackZoom = () => {
      const track = getTrack();
      if (!track || typeof track.getCapabilities !== 'function') return false;
      const caps = track.getCapabilities();
      return caps && caps.zoom;
    };
    const getZoomRange = () => {
      const track = getTrack();
      if (!track) return null;
      const caps = track.getCapabilities();
      return caps && caps.zoom ? caps.zoom : null;
    };
    const applyZoom = (z) => {
      if (hasTrackZoom()) {
        // Native track zoom (Android Chrome)
        const range = getZoomRange();
        const clamped = Math.min(Math.max(z, range.min), range.max);
        zoomRef.current = clamped;
        getTrack().applyConstraints({ advanced: [{ zoom: clamped }] }).catch(() => {});
      } else {
        // CSS transform fallback (iOS Safari)
        const clamped = Math.min(Math.max(z, 1), 5);
        zoomRef.current = clamped;
        el.style.transform = 'scale(' + clamped + ')';
      }
    };
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        baseDist.current = dist(e.touches[0], e.touches[1]);
        baseZoom.current = zoomRef.current;
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 2 && baseDist.current) {
        e.preventDefault();
        const scale = dist(e.touches[0], e.touches[1]) / baseDist.current;
        applyZoom(baseZoom.current * scale);
      }
    };
    const onTouchEnd = () => { baseDist.current = null; };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);
  const resetZoom = useCallback(() => {
    zoomRef.current = 1;
    if (videoRef.current) videoRef.current.style.transform = '';
  }, []);
  return resetZoom;
}

// ── CameraOverlay — full-screen camera with stats/deep-run/final-table/countdown/hand/graph overlays ──
export function CameraOverlay({ updateData, tournamentName, tournament, stackHistory, defaultOverlay, handData, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const [captured, setCaptured] = useState(null);
  const [error, setError] = useState(null);
  const [overlayType, setOverlayType] = useState(defaultOverlay || 'stats');
  const resetZoom = usePinchZoom(videoRef, streamRef);

  const startCamera = (onError) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      (onError || setError)('Camera requires a secure (HTTPS) connection.');
      return Promise.resolve(null);
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    }).catch(err => {
      (onError || setError)('Camera access denied. Please allow camera permission and try again.');
      return null;
    });
  };

  useEffect(() => {
    let cancelled = false;
    startCamera(msg => { if (!cancelled) setError(msg); }).then(s => {
      if (!s) return;
      if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play();
      }
    });
    return () => { cancelled = true; stopStream(); };
  }, []);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  // Compute countdown for "Next Up" overlay
  const countdownText = useMemo(() => {
    if (!tournament) return '\u2014';
    const dateStr = tournament.date;
    const timeStr = tournament.time;
    if (!dateStr || !timeStr) return '\u2014';
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return '\u2014';
    let h = parseInt(match[1]); const m = parseInt(match[2]);
    if (match[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
    const parts = dateStr.split('-');
    const target = new Date(parts[0], parts[1] - 1, parts[2], h, m);
    const diff = target - new Date();
    if (diff <= 0) return 'now';
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hrs > 24) return Math.floor(hrs / 24) + 'd ' + (hrs % 24) + 'h';
    if (hrs > 0) return hrs + 'h ' + mins + 'm';
    return mins + 'm';
  }, [tournament]);

  // Check which overlay types are available
  const canDeepRun = !!(updateData.totalEntries && updateData.stack);
  const canFinalTable = !!(updateData.isFinalTable);
  const canStackGraph = (stackHistory || []).filter(u => u.stack && Number(u.stack) > 0).length >= 2;

  // Shared overlay-drawing logic used by both camera capture and gallery pick
  const applyOverlay = async (ctx, outW, outH) => {
    try {
      if (overlayType === 'stackgraph') {
        // Standalone stack graph story (no camera background, renders own bg)
        drawChipStackStory(ctx, outW, outH, {
          tournamentName,
          stackHistory: stackHistory || [],
          startingStack: tournament?.starting_chips,
          bb: updateData.bb
        });
      } else if (overlayType === 'hand' && handData) {
        const allCards = [
          ...parseCardNotation(handData.heroHand),
          ...(handData.opponents || []).flatMap(h => h ? parseCardNotation(h) : []),
          ...(handData.boardCards ? parseCardNotation(handData.boardCards) : [])
        ];
        const images = await loadCardImages(allCards);
        drawHandOverlay(ctx, outW, outH, handData, images);
      } else if (overlayType === 'deeprun') {
        drawDeepRunOverlay(ctx, outW, outH, {
          tournamentName,
          stack: updateData.stack,
          totalEntries: updateData.totalEntries,
          placesLeft: updateData.placesLeft || updateData.totalEntries,
          stackHistory: stackHistory || [],
          startingStack: tournament?.starting_chips
        });
      } else if (overlayType === 'finaltable') {
        drawFinalTableOverlay(ctx, outW, outH, {
          tournamentName,
          buyin: tournament?.buyin,
          placesLeft: updateData.placesLeft,
          stack: updateData.stack,
          firstPlacePrize: updateData.firstPlacePrize,
          totalEntries: updateData.totalEntries,
          bb: updateData.bb
        });
      } else if (overlayType === 'countdown') {
        drawCountdownOverlay(ctx, outW, outH, {
          tournamentName,
          buyin: tournament?.buyin,
          venue: tournament?.venue,
          timeUntil: countdownText
        });
      } else {
        drawStatsOnCanvas(ctx, outW, outH, updateData, tournamentName, formatLiveUpdate);
      }
    } catch (e) { console.error('Overlay draw error:', e); }
  };

  // Draw source image crop-to-fill onto canvas
  const drawCropToFill = (ctx, source, srcW, srcH, outW, outH) => {
    const targetRatio = outW / outH;
    const srcRatio = srcW / srcH;
    let sx, sy, sw, sh;
    if (srcRatio > targetRatio) {
      sh = srcH; sw = srcH * targetRatio; sx = (srcW - sw) / 2; sy = 0;
    } else {
      sw = srcW; sh = srcW / targetRatio; sx = 0; sy = (srcH - sh) / 2;
    }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
  };

  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video) return;
    const outW = 1080, outH = 1920;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    drawCropToFill(ctx, video, video.videoWidth || 1080, video.videoHeight || 1920, outW, outH);
    await applyOverlay(ctx, outW, outH);
    setCaptured(canvas.toDataURL('image/png'));
    stopStream();
  };

  const handleGalleryPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const outW = 1080, outH = 1920;
        const canvas = canvasRef.current || document.createElement('canvas');
        canvas.width = outW; canvas.height = outH;
        const ctx = canvas.getContext('2d');
        drawCropToFill(ctx, img, img.width, img.height, outW, outH);
        await applyOverlay(ctx, outW, outH);
        setCaptured(canvas.toDataURL('image/png'));
        stopStream();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRetake = () => {
    setCaptured(null);
    setError(null);
    resetZoom();
    startCamera().then(s => {
      if (!s) return;
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play();
      }
    });
  };

  const handleShare = async () => {
    if (!captured) return;
    const fname = overlayType === 'hand' ? 'hand-history.png'
      : overlayType === 'finaltable' ? 'final-table.png'
      : overlayType === 'deeprun' ? 'deep-run.png'
      : overlayType === 'countdown' ? 'next-event.png'
      : overlayType === 'stackgraph' ? 'stack-graph.png'
      : 'poker-update.png';
    try {
      const blob = await (await fetch(captured)).blob();
      const file = new File([blob], fname, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const a = document.createElement('a');
        a.href = captured;
        a.download = fname;
        a.click();
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        const a = document.createElement('a');
        a.href = captured;
        a.download = fname;
        a.click();
      }
    }
  };

  const handleClose = () => {
    stopStream();
    onClose();
  };

  const statsText = formatLiveUpdate(updateData);

  if (error) {
    return (
      <div className="camera-overlay">
        <div className="camera-error">
          <div>
            <div style={{fontSize:'2rem',marginBottom:'12px'}}>📷</div>
            <div>{error}</div>
          </div>
        </div>
        <input type="file" accept="image/*" ref={fileInputRef} style={{display:'none'}} onChange={handleGalleryPick} />
        <div className="camera-actions">
          <button className="camera-btn-close" onClick={handleClose}>Close</button>
          <button className="camera-btn-gallery" onClick={() => fileInputRef.current?.click()}>Choose Photo</button>
        </div>
      </div>
    );
  }

  if (captured) {
    return (
      <div className="camera-overlay">
        <div className="camera-preview">
          <img src={captured} alt="Captured" />
        </div>
        <div className="camera-actions">
          <button className="camera-btn-retake" onClick={handleRetake}>Retake</button>
          <button className="camera-btn-share" onClick={handleShare}>Share</button>
        </div>
      </div>
    );
  }

  // Live preview bar content based on overlay type
  const renderPreviewBar = () => {
    if (overlayType === 'stackgraph') {
      const history = (stackHistory || []).filter(u => u.stack && Number(u.stack) > 0);
      return (
        <div className="camera-stats-bar">
          <div style={{color:'#22c55e',fontWeight: 'var(--fw-bold)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'0.65rem',letterSpacing:'1px'}}>STACK GRAPH</div>
          <div className="tournament-name">{tournamentName}</div>
          <div className="stats-line">{history.length} update{history.length !== 1 ? 's' : ''} tracked</div>
        </div>
      );
    }
    if (overlayType === 'hand' && handData) {
      const hCards = parseCardNotation(handData.heroHand);
      const oppGroups = (handData.opponents || []).map(h => h ? parseCardNotation(h) : []);
      const bCards = handData.boardCards ? parseCardNotation(handData.boardCards) : [];
      const cardImg = (c, i) => c.suit !== 'x'
        ? React.createElement('img', { key: i, src: '/cards/cards_gui_' + c.rank + c.suit + '.svg', alt: c.rank + c.suit, style: { height: '22px', borderRadius: '2px' } })
        : React.createElement('span', { key: i, style: { display: 'inline-block', width: '16px', height: '22px', background: 'rgba(255,255,255,0.15)', borderRadius: '2px', textAlign: 'center', fontSize: '0.55rem', lineHeight: '22px', color: 'rgba(255,255,255,0.5)' } }, '?');
      const results = Array.isArray(handData.handResult) ? handData.handResult : [];
      return (
        React.createElement('div', { className: 'camera-stats-bar' },
          React.createElement('div', { style: { fontSize: '0.6rem', color: 'rgba(255,255,255,0.5)', fontFamily: "'Univers Condensed','Univers',sans-serif", marginBottom: '2px' } }, handData.activeGame),
          React.createElement('div', { style: { display: 'flex', gap: '2px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '2px' } },
            hCards.map(cardImg),
            bCards.length > 0 && React.createElement('span', { key: 'sep', style: { margin: '0 4px', color: 'rgba(255,255,255,0.3)', fontSize: '0.6rem' } }, '|'),
            bCards.map((c, i) => cardImg(c, 'b' + i)),
            ...oppGroups.flatMap((oCards, oi) => oCards.length > 0 ? [
              React.createElement('span', { key: 'vs' + oi, style: { margin: '0 4px', color: 'rgba(255,255,255,0.4)', fontSize: '0.55rem', fontFamily: "'Univers Condensed','Univers',sans-serif" } }, 'vs'),
              ...oCards.map((c, ci) => cardImg(c, 'o' + oi + '_' + ci))
            ] : [])
          ),
          results.length > 0 && results.map((r, ri) =>
            React.createElement('div', { key: ri, style: { fontSize: '0.65rem', fontFamily: "'Univers Condensed','Univers',sans-serif", fontWeight: 'var(--fw-bold)', color: r.result.color === 'green' ? '#4ade80' : r.result.color === 'red' ? '#f87171' : '#facc15' } },
              (results.length > 1 ? 'vs Opp ' + (r.index + 1) + ': ' : '') + r.result.text
            )
          )
        )
      );
    }
    if (overlayType === 'deeprun') {
      const posNum = updateData.placesLeft || updateData.totalEntries || '?';
      const totalNum = updateData.totalEntries ? Number(updateData.totalEntries).toLocaleString() : '?';
      const pct = (updateData.totalEntries && updateData.placesLeft)
        ? Math.max(2, Math.round((1 - (Number(updateData.placesLeft) - 1) / Number(updateData.totalEntries)) * 100))
        : 0;
      return (
        <div className="camera-stats-bar">
          <div className="tournament-name">{tournamentName}</div>
          <div className="stats-line">{posNum}{typeof posNum === 'number' ? ordinalSuffix(posNum) : ''} of {totalNum}</div>
          <div style={{marginTop:'4px',height:'6px',borderRadius:'3px',background:'rgba(255,255,255,0.15)',overflow:'hidden'}}>
            <div style={{height:'100%',width:pct+'%',background:'#22c55e',borderRadius:'3px'}} />
          </div>
          {updateData.stack && <div style={{marginTop:'2px',fontSize:'0.7rem',color:'#22c55e',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>{formatChips(updateData.stack)} chips</div>}
        </div>
      );
    }
    if (overlayType === 'finaltable') {
      return (
        <div className="camera-stats-bar">
          <div style={{color:'#f59e0b',fontWeight: 'var(--fw-bold)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'0.9rem'}}>🏆 FINAL TABLE</div>
          <div className="tournament-name">{tournament?.buyin ? '$' + Number(tournament.buyin).toLocaleString() + ' ' : ''}{tournamentName}</div>
          <div className="stats-line">
            {updateData.placesLeft ? updateData.placesLeft + ' remain' : ''}
            {updateData.stack ? '  \u00b7  ' + formatChips(updateData.stack) : ''}
            {updateData.firstPlacePrize ? '  \u00b7  1st: $' + Number(updateData.firstPlacePrize).toLocaleString() : ''}
          </div>
        </div>
      );
    }
    if (overlayType === 'countdown') {
      return (
        <div className="camera-stats-bar">
          <div style={{color:'#22c55e',fontWeight: 'var(--fw-bold)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'0.65rem',letterSpacing:'1px'}}>NEXT UP</div>
          <div className="tournament-name">{tournament?.buyin ? '$' + Number(tournament.buyin).toLocaleString() + ' ' : ''}{tournamentName}</div>
          <div className="stats-line">in {countdownText}</div>
        </div>
      );
    }
    // Default: stats
    return (
      <div className="camera-stats-bar">
        <div className="tournament-name">{tournamentName}</div>
        <div className="stats-line">{statsText}</div>
      </div>
    );
  };

  return (
    <div className="camera-overlay">
      <video ref={videoRef} autoPlay playsInline muted />
      <canvas ref={canvasRef} style={{display:'none'}} />
      <div className="camera-watermark">snbwsop.com</div>
      <div className="camera-overlay-picker">
        <button className={overlayType === 'stats' ? 'active' : ''} onClick={() => setOverlayType('stats')}>Stats</button>
        <button className={overlayType === 'deeprun' ? 'active' : ''} onClick={() => setOverlayType('deeprun')} disabled={!canDeepRun}>Deep Run</button>
        <button className={overlayType === 'finaltable' ? 'active' : ''} onClick={() => setOverlayType('finaltable')} disabled={!canFinalTable}>Final Table</button>
        <button className={overlayType === 'countdown' ? 'active' : ''} onClick={() => setOverlayType('countdown')}>Countdown</button>
        <button className={overlayType === 'hand' ? 'active' : ''} onClick={() => setOverlayType('hand')} disabled={!handData}>Hand</button>
        <button className={overlayType === 'stackgraph' ? 'active' : ''} onClick={() => setOverlayType('stackgraph')} disabled={!canStackGraph}>Graph</button>
      </div>
      {renderPreviewBar()}
      <input type="file" accept="image/*" ref={fileInputRef} style={{display:'none'}} onChange={handleGalleryPick} />
      <div className="camera-actions">
        <button className="camera-btn-close" onClick={handleClose}>✕</button>
        <button className="camera-btn-capture" onClick={handleCapture}>Capture</button>
        <button className="camera-btn-gallery" onClick={() => fileInputRef.current?.click()} title="Choose from gallery">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        </button>
      </div>
    </div>
  );
}

// ── RegistrationCameraFlow — 2-step receipt + starting stack camera flow ──
export function RegistrationCameraFlow({ tournament, guarantee, joiningSb, joiningBb, joiningAnte, entryNumber, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const [step, setStep] = useState(1);
  const [captured, setCaptured] = useState(null);
  const [error, setError] = useState(null);
  const resetZoom = usePinchZoom(videoRef, streamRef);

  const joiningBlinds = useMemo(() => {
    if (!joiningSb && !joiningBb) return null;
    const parts = [joiningSb ? formatChips(Number(joiningSb)) : null, joiningBb ? formatChips(Number(joiningBb)) : null].filter(Boolean);
    if (joiningAnte) parts.push(formatChips(Number(joiningAnte)));
    return parts.join('/');
  }, [joiningSb, joiningBb, joiningAnte]);

  const registrationData = useMemo(() => ({
    seriesName: VENUE_TO_SERIES[tournament.venue] || tournament.venue,
    eventNumber: tournament.event_number,
    buyin: tournament.buyin,
    eventName: tournament.event_name,
    startingChips: tournament.starting_chips,
    levelDuration: tournament.level_duration,
    guarantee: guarantee || null,
    joiningBlinds: joiningBlinds,
    entryNumber: entryNumber || 1,
  }), [tournament, guarantee, joiningBlinds, entryNumber]);

  const startCam = (onErr) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      (onErr || setError)('Camera requires a secure (HTTPS) connection.');
      return Promise.resolve(null);
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    }).catch(() => { (onErr || setError)('Camera access denied. Please allow camera permission.'); return null; });
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    stopStream();
    setCaptured(null);
    setError(null);
    resetZoom();
    let cancelled = false;
    startCam(msg => { if (!cancelled) setError(msg); }).then(s => {
      if (!s || cancelled) { if (s) s.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); }
    });
    return () => { cancelled = true; stopStream(); };
  }, [step]);

  const drawCropToFill = (ctx, source, srcW, srcH, outW, outH) => {
    const targetRatio = outW / outH, srcRatio = srcW / srcH;
    let sx, sy, sw, sh;
    if (srcRatio > targetRatio) { sh = srcH; sw = srcH * targetRatio; sx = (srcW - sw) / 2; sy = 0; }
    else { sw = srcW; sh = srcW / targetRatio; sx = 0; sy = (srcH - sh) / 2; }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
  };

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video) return;
    const outW = 1080, outH = 1920;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    drawCropToFill(ctx, video, video.videoWidth || 1080, video.videoHeight || 1920, outW, outH);
    if (step === 2) drawRegistrationOverlay(ctx, outW, outH, registrationData);
    setCaptured(canvas.toDataURL('image/png'));
    stopStream();
  };

  const handleGalleryPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const outW = 1080, outH = 1920;
        const canvas = canvasRef.current || document.createElement('canvas');
        canvas.width = outW; canvas.height = outH;
        const ctx = canvas.getContext('2d');
        drawCropToFill(ctx, img, img.width, img.height, outW, outH);
        if (step === 2) drawRegistrationOverlay(ctx, outW, outH, registrationData);
        setCaptured(canvas.toDataURL('image/png'));
        stopStream();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRetake = () => {
    setCaptured(null); setError(null); resetZoom();
    startCam().then(s => {
      if (!s) return;
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); }
    });
  };

  const handleShare = async () => {
    if (!captured) return;
    const fname = step === 1 ? 'registration-receipt.png' : 'starting-stack.png';
    try {
      const blob = await (await fetch(captured)).blob();
      const file = new File([blob], fname, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const a = document.createElement('a'); a.href = captured; a.download = fname; a.click();
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        const a = document.createElement('a'); a.href = captured; a.download = fname; a.click();
      }
    }
  };

  const handleClose = () => { stopStream(); onClose(); };

  // Overlay preview text for step 2 live viewfinder
  const overlayLine1 = registrationData.seriesName;
  const overlayLine2 = (registrationData.eventNumber ? '#' + registrationData.eventNumber + ' \u00b7 ' : '')
    + (registrationData.startingChips ? formatChips(registrationData.startingChips) + ' ss' : '')
    + (registrationData.levelDuration ? ' / ' + registrationData.levelDuration + 'm lvls' : '');

  if (error) {
    return (
      <div className="camera-overlay">
        <div className="camera-error"><div><div style={{fontSize:'2rem',marginBottom:'12px'}}>📷</div><div>{error}</div></div></div>
        <input type="file" accept="image/*" ref={fileInputRef} style={{display:'none'}} onChange={handleGalleryPick} />
        <div className="camera-actions">
          <button className="camera-btn-close" onClick={handleClose}>Close</button>
          <button className="camera-btn-gallery" onClick={() => fileInputRef.current?.click()}>Choose Photo</button>
        </div>
      </div>
    );
  }

  if (captured) {
    return (
      <div className="camera-overlay">
        <div className="camera-preview"><img src={captured} alt="Captured" /></div>
        <div className="camera-step-indicator">Step {step} of 2</div>
        <div className="camera-actions">
          <button className="camera-btn-retake" onClick={handleRetake}>Retake</button>
          <button className="camera-btn-share" onClick={handleShare}>Save</button>
          {step === 1 && <button className="camera-btn-next" onClick={() => setStep(2)}>Next →</button>}
          {step === 2 && <button className="camera-btn-close" onClick={handleClose}>Done</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="camera-overlay">
      <video ref={videoRef} autoPlay playsInline muted />
      <canvas ref={canvasRef} style={{display:'none'}} />
      <div className="camera-watermark">snbwsop.com</div>
      <div className="camera-step-indicator">
        {step === 1 ? 'Step 1 of 2 \u2014 Receipt' : 'Step 2 of 2 \u2014 Starting Stack'}
      </div>
      {step === 2 && (
        <div className="camera-stats-bar">
          <div className="tournament-name">{overlayLine1}</div>
          <div className="stats-line">{overlayLine2}</div>
        </div>
      )}
      <input type="file" accept="image/*" ref={fileInputRef} style={{display:'none'}} onChange={handleGalleryPick} />
      <div className="camera-actions">
        <button className="camera-btn-close" onClick={handleClose}>✕</button>
        <button className="camera-btn-capture" onClick={handleCapture}>Capture</button>
        <button className="camera-btn-gallery" onClick={() => fileInputRef.current?.click()} title="Choose from gallery">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        </button>
      </div>
    </div>
  );
}
