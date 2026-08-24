import React, { useState, useRef, useEffect } from 'react';
import { API_URL } from '../utils/api.js';

function detectImageFormat(img) {
  var canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  var pixels = ctx.getImageData(0, 0, img.width, img.height).data;
  var total = img.width * img.height;

  var greenFeltCount = 0;
  var whiteCount = 0;
  var purpleCount = 0;

  for (var i = 0; i < pixels.length; i += 4) {
    var r = pixels[i], g = pixels[i+1], b = pixels[i+2];
    if (g > r * 1.2 && g > b * 1.2 && g > 30) greenFeltCount++;
    if (r > 220 && g > 220 && b > 220) whiteCount++;
    if (r > 80 && b > 80 && g < 60 && Math.abs(r - b) < 40) purpleCount++;
  }

  var greenRatio = greenFeltCount / total;
  var whiteRatio = whiteCount / total;
  var purpleRatio = purpleCount / total;

  var aspectRatio = img.height / img.width;
  var isPortrait = aspectRatio > 1.3;

  if (greenRatio > 0.05) return 'wsop';
  if (isPortrait && (whiteRatio > 0.15 || purpleRatio > 0.02)) return 'pokerstars';
  if (greenRatio < 0.03) return 'pokerstars';
  return 'wsop';
}

export default function TableScanner() {
  const [state, setState] = useState('idle'); // idle | processing | tableSelect | results
  const [progress, setProgress] = useState(0);
  const [players, setPlayers] = useState([]);
  const [eventTitle, setEventTitle] = useState('');
  const [error, setError] = useState('');
  const [availableTables, setAvailableTables] = useState(null);
  const [allParsedPlayers, setAllParsedPlayers] = useState([]);
  const [feltColor, setFeltColor] = useState(() => {
    try { return localStorage.getItem('scannerFeltColor') || '#1a5c2e'; } catch { return '#1a5c2e'; }
  });
  const [portrait, setPortrait] = useState(false);
  const ovalRef = useRef(null);
  const fileRef = useRef(null);
  const colorRef = useRef(null);

  // Persist scan results so the hand replayer can use them
  useEffect(() => {
    if (state === 'results' && players.length > 0) {
      try {
        localStorage.setItem('tableScanPlayers', JSON.stringify(players));
      } catch {}
    }
  }, [state, players]);

  const SCANNER_LAYOUTS = {
    2:  [[50,12],[50,88]],
    3:  [[50,12],[85,75],[15,75]],
    4:  [[50,12],[98,50],[50,88],[2,50]],
    5:  [[50,8],[98,50],[80,92],[20,92],[2,50]],
    6:  [[30,12],[70,12],[98,50],[70,88],[30,88],[2,50]],
    7:  [[50,5],[98,35],[98,65],[72,95],[28,95],[2,65],[2,35]],
    8:  [[30,10],[70,10],[98,37],[98,63],[70,90],[30,90],[2,63],[2,37]],
    9:  [[50,10],[82,10],[98,37],[98,63],[72,90],[28,90],[2,63],[2,37],[18,10]],
    10: [[35,2],[65,2],[98,26],[98,50],[98,74],[65,98],[35,98],[2,74],[2,50],[2,26]],
  };

  function getDisplayPlayers(rawPlayers) {
    const hasSeatData = rawPlayers.some(p => p.seat);
    const sorted = [...rawPlayers].sort((a, b) => {
      if (hasSeatData) {
        const sA = a.seat ? parseInt(a.seat.split('-')[1]) || 0 : (a.position || 99);
        const sB = b.seat ? parseInt(b.seat.split('-')[1]) || 0 : (b.position || 99);
        return sA - sB;
      }
      return (a.position || 0) - (b.position || 0);
    });
    const n = Math.min(Math.max(sorted.length, 2), 10);
    const heroIdx = sorted.findIndex(p => p.isHero);

    const PORTRAIT_LAYOUTS = {
      2:  [[50,5],[50,95]],
      3:  [[50,5],[98,50],[2,50]],
      4:  [[50,5],[98,50],[50,95],[2,50]],
      5:  [[50,5],[98,35],[98,65],[50,95],[2,50]],
      6:  [[50,5],[98,35],[98,65],[50,95],[2,65],[2,35]],
      7:  [[50,5],[98,28],[98,50],[98,72],[50,95],[2,50],[2,28]],
      8:  [[50,5],[98,23],[98,50],[98,77],[50,95],[2,77],[2,50],[2,23]],
      9:  [[30,5],[98,23],[98,50],[98,77],[50,95],[2,77],[2,50],[2,23],[70,5]],
      10: [[30,5],[70,5],[98,23],[98,50],[98,77],[70,95],[30,95],[2,77],[2,50],[2,23]],
    };

    const PORTRAIT_STAGGERED = {
      2:  [[50,5],[50,95]],
      3:  [[50,5],[98,50],[2,50]],
      4:  [[50,5],[98,45],[50,95],[2,55]],
      5:  [[50,5],[98,33],[98,67],[50,95],[2,50]],
      6:  [[50,5],[98,28],[98,68],[50,95],[2,72],[2,32]],
      7:  [[50,5],[98,26],[98,50],[98,74],[50,95],[2,55],[2,28]],
      8:  [[50,5],[98,20],[98,46],[98,72],[50,95],[2,80],[2,54],[2,28]],
      9:  [[30,5],[98,20],[98,46],[98,72],[50,95],[2,80],[2,54],[2,28],[70,5]],
      10: [[30,5],[70,5],[98,20],[98,46],[98,72],[70,95],[30,95],[2,80],[2,54],[2,28]],
    };

    function resolveCollisions(rawCoords, minX, minY) {
      const s = rawCoords.map(c => [c[0], c[1]]);
      for (let pass = 0; pass < 8; pass++) {
        for (let i = 0; i < s.length; i++) {
          for (let j = i + 1; j < s.length; j++) {
            const dx = s[j][0] - s[i][0];
            const dy = s[j][1] - s[i][1];
            const adx = Math.abs(dx), ady = Math.abs(dy);
            if (adx < minX && ady < minY) {
              if (adx / minX < ady / minY) {
                const pushX = (minX - adx) / 2 * 0.7;
                s[i][0] -= Math.sign(dx || 1) * pushX;
                s[j][0] += Math.sign(dx || 1) * pushX;
              } else {
                const pushY = (minY - ady) / 2 * 0.7;
                s[i][1] -= Math.sign(dy || 1) * pushY;
                s[j][1] += Math.sign(dy || 1) * pushY;
              }
              s[i][0] = Math.max(1, Math.min(99, s[i][0]));
              s[i][1] = Math.max(2, Math.min(96, s[i][1]));
              s[j][0] = Math.max(1, Math.min(99, s[j][0]));
              s[j][1] = Math.max(2, Math.min(96, s[j][1]));
            }
          }
        }
      }
      return s;
    }

    function hasCollision(s, minX, minY) {
      for (let i = 0; i < s.length; i++)
        for (let j = i + 1; j < s.length; j++)
          if (Math.abs(s[j][0] - s[i][0]) < minX && Math.abs(s[j][1] - s[i][1]) < minY) return true;
      return false;
    }

    function needsStagger(layout, players) {
      for (let i = 0; i < players.length; i++) {
        const pi = layout[i];
        if (!pi || (pi[0] > 15 && pi[0] < 85)) continue;
        for (let j = i + 1; j < players.length; j++) {
          const pj = layout[j];
          if (!pj || (pj[0] > 15 && pj[0] < 85)) continue;
          const oneLeft = pi[0] <= 15, oneRight = pj[0] >= 85;
          const otherWay = pi[0] >= 85 && pj[0] <= 15;
          if ((oneLeft && oneRight) || otherWay) {
            if (Math.abs(pi[1] - pj[1]) < 5) {
              if (players[i].name.length + players[j].name.length > 34) return true;
            }
          }
        }
      }
      return false;
    }

    let usePortrait = portrait;
    const rawSeats = usePortrait
      ? (PORTRAIT_LAYOUTS[n] || PORTRAIT_LAYOUTS[9])
      : (SCANNER_LAYOUTS[n] || SCANNER_LAYOUTS[9]);
    let seats = resolveCollisions(rawSeats, usePortrait ? 28 : 22, usePortrait ? 14 : 18);

    if (!usePortrait && hasCollision(seats, 20, 16)) {
      usePortrait = true;
      const portraitSeats = PORTRAIT_LAYOUTS[n] || PORTRAIT_LAYOUTS[9];
      seats = resolveCollisions(portraitSeats, 28, 14);
    }

    if (usePortrait && needsStagger(seats, sorted)) {
      const staggered = PORTRAIT_STAGGERED[n] || PORTRAIT_STAGGERED[9];
      seats = resolveCollisions(staggered, 28, 14);
    }

    if (heroIdx < 0) return { display: sorted, n, seats, autoPortrait: usePortrait };
    const targetIdx = Math.floor(n / 2);
    const delta = (heroIdx - targetIdx + n) % n;
    const display = [...sorted.slice(delta), ...sorted.slice(0, delta)];
    return { display, n, seats, autoPortrait: usePortrait };
  }

  function handleExport() {
    const el = ovalRef.current;
    if (!el) return;

    const ovalRect = el.getBoundingClientRect();
    const seatEls = el.querySelectorAll('.table-scanner-seat');
    let minX = ovalRect.left, minY = ovalRect.top, maxX = ovalRect.right, maxY = ovalRect.bottom;
    seatEls.forEach(s => {
      const r = s.getBoundingClientRect();
      if (r.left < minX) minX = r.left;
      if (r.top < minY) minY = r.top;
      if (r.right > maxX) maxX = r.right;
      if (r.bottom > maxY) maxY = r.bottom;
    });
    minX -= 8; minY -= 8; maxX += 8; maxY += 8;

    const W = maxX - minX, H = maxY - minY;
    const SCALE = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * SCALE);
    canvas.height = Math.round(H * SCALE);
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);

    const feltEl = el.querySelector('.table-scanner-felt');
    const feltRect = feltEl.getBoundingClientRect();
    const fx = feltRect.left - minX, fy = feltRect.top - minY;
    const fw = feltRect.width, fh = feltRect.height;
    const feltStyle = getComputedStyle(feltEl);
    const borderW = parseFloat(feltStyle.borderWidth) || 10;
    const pillR = fh / 2;

    const hexToRgb = h => { const m = h.match(/\w\w/g); return m ? m.map(x => parseInt(x, 16)) : [0,0,0]; };
    const [fr,fg,fb] = hexToRgb(feltColor);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(fx, fy, fw, fh, pillR);
    else ctx.rect(fx, fy, fw, fh);
    ctx.fillStyle = feltStyle.borderColor || feltColor;
    ctx.fill();
    ctx.restore();

    const ix = fx + borderW, iy = fy + borderW;
    const iw = fw - borderW * 2, ih = fh - borderW * 2;
    const innerR = ih / 2;
    const grad = ctx.createRadialGradient(ix + iw/2, iy + ih*0.4, 0, ix + iw/2, iy + ih/2, Math.max(iw, ih)/2);
    grad.addColorStop(0, `rgba(${Math.min(255,fr+30)},${Math.min(255,fg+30)},${Math.min(255,fb+30)},0.8)`);
    grad.addColorStop(1, feltColor);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(ix, iy, iw, ih, innerR);
    else ctx.rect(ix, iy, iw, ih);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(ix, iy, iw, ih, innerR);
    else ctx.rect(ix, iy, iw, ih);
    ctx.clip();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(ix - 20, iy - 20, iw + 40, ih + 40, innerR + 20);
    else ctx.rect(ix - 20, iy - 20, iw + 40, ih + 40);
    if (ctx.roundRect) ctx.roundRect(ix, iy, iw, ih, innerR);
    else ctx.rect(ix, iy, iw, ih);
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fill('evenodd');
    ctx.restore();

    const isPortraitExport = ih > iw;
    const firstNameEl = el.querySelector('.table-scanner-name-stack > span:first-child');
    const nameTextSize = firstNameEl ? parseFloat(getComputedStyle(firstNameEl).fontSize) : 11;
    const logoSize = Math.round(nameTextSize * 1.2);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${logoSize}px "Libre Baskerville",Georgia,serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${-0.05 * logoSize}px`;
    ctx.fillText('futurega.me', ix + iw / 2, iy + ih * (isPortraitExport ? 0.7 : 0.55));
    ctx.restore();

    const FONT = '"Univers Condensed",Univers,-apple-system,system-ui,sans-serif';
    seatEls.forEach(seat => {
      const btn = seat.querySelector('.table-scanner-link');
      if (!btn) return;
      const btnRect = btn.getBoundingClientRect();
      const linkIcon = btn.querySelector('svg');
      const iconW = linkIcon ? linkIcon.getBoundingClientRect().width + 3 : 0;
      const bx = btnRect.left - minX, by = btnRect.top - minY;
      const bw = btnRect.width - iconW, bh = btnRect.height;
      const bs = getComputedStyle(btn);

      const nameEl = seat.querySelector('.table-scanner-name-stack > span:first-child');
      const chipsEl = seat.querySelector('.table-scanner-chips');

      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 6);
      else ctx.rect(bx, by, bw, bh);
      ctx.fillStyle = bs.backgroundColor;
      ctx.fill();
      ctx.strokeStyle = bs.borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (btn.style.outline && btn.style.outline.includes('accent')) {
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#10b981';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();

      const nameSize = nameEl ? parseFloat(getComputedStyle(nameEl).fontSize) : parseFloat(bs.fontSize);
      ctx.fillStyle = bs.color;
      ctx.font = `500 ${nameSize}px ${FONT}`;
      ctx.fillText(nameEl?.textContent || '', bx + 8, by + nameSize + 2, bw - 16);

      if (chipsEl) {
        const cs = getComputedStyle(chipsEl);
        const chipsSize = parseFloat(cs.fontSize);
        ctx.fillStyle = cs.color;
        ctx.font = `400 ${chipsSize}px ${FONT}`;
        ctx.fillText(chipsEl.textContent, bx + 8, by + nameSize + chipsSize + 4, bw - 16);
      }
    });

    canvas.toBlob(async blob => {
      try {
        const file = new File([blob], 'table.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'table.png'; a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setState('processing');
    setProgress(0);
    setError('');
    setPlayers([]);
    setEventTitle('');

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
      });
      const formatImg = new Image();
      await new Promise((resolve, reject) => { formatImg.onload = resolve; formatImg.onerror = reject; formatImg.src = dataUrl; });
      const format = detectImageFormat(formatImg);

      if (format === 'pokerstars') {
        setProgress(30);
        const formData = new FormData();
        formData.append('image', file);
        const token = localStorage.getItem('token');
        const resp = await fetch(API_URL + '/scan-table', {
          method: 'POST',
          headers: token ? { Authorization: 'Bearer ' + token } : {},
          body: formData,
        });
        setProgress(90);
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || 'Scan failed (' + resp.status + ')');
        }
        const { players: rawPlayers } = await resp.json();
        setProgress(100);

        const extracted = (rawPlayers || []).map((p, i) => ({
          name: p.name || '',
          chips: p.chips || null,
          seat: p.seat || null,
          isHero: p.isHero || false,
          prize: null, country: null,
          position: i + 1, px: null, py: null,
        })).filter(p => p.name.length > 1);

        const tableGroups = {};
        extracted.forEach(function(p) {
          if (p.seat && p.seat.includes('-')) {
            var tbl = p.seat.split('-')[0];
            if (!tableGroups[tbl]) tableGroups[tbl] = [];
            tableGroups[tbl].push(p);
          }
        });
        var tableNums = Object.keys(tableGroups).sort(function(a, b) { return parseInt(a) - parseInt(b); });

        if (tableNums.length > 1) {
          setAvailableTables(tableGroups);
          setAllParsedPlayers(extracted);
          setEventTitle('PokerStars Live');
          setState('tableSelect');
        } else if (extracted.length === 0) {
          setError('No players found in image. Make sure the full seating list is visible.');
          setState('idle');
        } else if (extracted.length > 11 && tableNums.length <= 1) {
          if (tableNums.length === 1) {
            setAvailableTables(tableGroups);
            setAllParsedPlayers(extracted);
            setEventTitle('PokerStars Live');
            setState('tableSelect');
          } else {
            setEventTitle('PokerStars Live');
            setPlayers(extracted);
            setState('results');
          }
        } else {
          setEventTitle('PokerStars Live');
          setPlayers(extracted);
          setState('results');
        }
      } else {
        setProgress(30);
        const formData = new FormData();
        formData.append('image', file);
        formData.append('format', 'wsop');
        const token = localStorage.getItem('token');
        const resp = await fetch(API_URL + '/scan-table', {
          method: 'POST',
          headers: token ? { Authorization: 'Bearer ' + token } : {},
          body: formData,
        });
        setProgress(90);
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || 'Scan failed (' + resp.status + ')');
        }
        const { players: rawPlayers, tableNumber } = await resp.json();
        setProgress(100);

        const extracted = (rawPlayers || []).map((p, i) => ({
          name: p.name || '',
          chips: p.chips || null,
          seat: p.seat ? (tableNumber ? tableNumber + '-' + p.seat : String(p.seat)) : null,
          prize: null, country: null,
          position: p.seat || p.position || (i + 1), px: null, py: null,
        })).filter(p => p.name.length > 1)
          .sort((a, b) => a.position - b.position);

        if (extracted.length === 0) {
          setError('No players found. Try a clearer screenshot of the table view.');
          setState('idle');
        } else {
          setEventTitle(tableNumber ? 'Table ' + tableNumber : '');
          setPlayers(extracted);
          setState('results');
        }
      }
    } catch (err) {
      console.error('OCR error:', err);
      setError('Scan failed: ' + err.message);
      setState('idle');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="table-scanner">
      <input ref={fileRef} type="file" accept="image/*"
        style={{display:'none'}} onChange={handleFile} />

      {state === 'idle' && (
        <button className="cal-structure-link" onClick={() => fileRef.current?.click()}
          style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'6px',background:'none',border:'1px solid var(--accent)',borderRadius:'6px',padding:'10px 12px',cursor:'pointer',color:'var(--accent)',font:'inherit',fontSize:'0.78rem',width:'100%'}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          Upload Table Screenshot (WSOP Live / PokerStars Live)
        </button>
      )}

      {state === 'processing' && (
        <div className="table-scanner-progress">
          <div className="table-scanner-progress-label">Scanning image...</div>
          <div className="table-scanner-bar-track">
            <div className="table-scanner-bar-fill" style={{width: progress + '%'}} />
          </div>
          <div className="table-scanner-progress-pct">{progress}%</div>
        </div>
      )}

      {state === 'tableSelect' && availableTables && (
        <div className="table-scanner-table-select">
          <div style={{fontWeight:700,fontSize:'0.9rem',color:'var(--text)',marginBottom:'8px'}}>
            Multiple tables detected — select yours:
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
            {(() => {
              var heroP = (allParsedPlayers || []).find(function(p) { return p.isHero; });
              var heroTbl = heroP && heroP.seat && heroP.seat.includes('-') ? heroP.seat.split('-')[0] : null;
              return Object.keys(availableTables).sort(function(a, b) { return parseInt(a) - parseInt(b); }).map(function(tbl) {
                var isHeroTable = tbl === heroTbl;
                return (
                  <button key={tbl}
                    className={isHeroTable ? 'btn btn-accent btn-sm' : 'btn btn-primary btn-sm'}
                    style={{minWidth:'60px',padding:'8px 16px', border: isHeroTable ? '2px solid var(--accent)' : undefined}}
                    onClick={() => {
                      var tablePlayers = availableTables[tbl];
                      setPlayers(tablePlayers);
                      setEventTitle('Table ' + tbl);
                      setAvailableTables(null);
                      setState('results');
                    }}>
                    {'Table ' + tbl + ' (' + availableTables[tbl].length + ')' + (isHeroTable ? ' \u2605' : '')}
                  </button>
                );
              });
            })()}
          </div>
          <button className="btn btn-ghost btn-sm" style={{marginTop:'8px'}} onClick={() => { setState('idle'); setAvailableTables(null); }}>Cancel</button>
        </div>
      )}

      {state === 'results' && (
        <div className="table-scanner-results">
          <div className="table-scanner-results-header">
            <span style={{fontWeight: 'var(--fw-bold)',fontSize:'0.82rem',color:'var(--text)',flex:1,minWidth:0}}>
              {eventTitle ? `${eventTitle}: ` : ''}{players.length} player{players.length !== 1 ? 's' : ''} found
            </span>
            <button className="table-scanner-rescan" onClick={() => setPortrait(p => !p)} style={{padding:'4px 6px',marginRight:'4px'}} title={portrait ? 'Landscape' : 'Portrait'}>
              {portrait
                ? <svg width="16" height="10" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="22" height="12" rx="6"/></svg>
                : <svg width="10" height="16" viewBox="0 0 14 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="12" height="22" rx="6"/></svg>
              }
            </button>
            <button className="table-scanner-rescan" onClick={handleExport} style={{padding:'4px 6px',marginRight:'4px'}} title="Export as PNG">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button className="table-scanner-rescan" onClick={() => { if (fileRef.current) fileRef.current.value = ''; fileRef.current?.click(); }}>
              Rescan
            </button>
          </div>
          {(() => {
            const { display, seats, autoPortrait } = getDisplayPlayers(players);
            const isPortrait = autoPortrait || portrait;
            return (
              <div className="table-scanner-oval" ref={ovalRef} style={isPortrait ? {aspectRatio:'4 / 5', width:'92%', maxHeight:'62vh', margin:'4px auto'} : undefined}>
                <label className="table-scanner-felt" title="Change felt colour"
                  style={{
                    background: `radial-gradient(ellipse at ${isPortrait ? '40% 50%' : '50% 40%'}, ${feltColor}cc 0%, ${feltColor} 100%)`,
                    borderColor: feltColor,
                    cursor: 'pointer',
                    display: 'block',
                    ...(isPortrait ? {inset:'12% 16%'} : {}),
                  }}>
                  <input type="color" value={feltColor}
                    onChange={e => { setFeltColor(e.target.value); try { localStorage.setItem('scannerFeltColor', e.target.value); } catch {} }}
                    style={{opacity:0,position:'absolute',width:'100%',height:'100%',top:0,left:0,cursor:'pointer',border:'none',padding:0}} />
                </label>
                {display.map((player, i) => {
                  const pos = seats[i] || [50, 50];
                  const align = pos[0] <= 15 ? ' seat-left' : pos[0] >= 85 ? ' seat-right' : ' seat-center';
                  const words = player.name.trim().split(/\s+/);
                  const isNickname = words.length < 2 || !words.every(w => /^[A-Z][a-zA-Z'-]+$/.test(w));
                  return (
                    <div key={i} className={'table-scanner-seat' + align}
                      style={{left: pos[0] + '%', top: pos[1] + '%'}}>
                      <button className="table-scanner-link"
                        disabled={isNickname}
                        style={{...(isNickname ? {cursor:'default'} : {}), ...(player.isHero ? {outline:'2px solid var(--accent)',outlineOffset:'2px'} : {})}}
                        onClick={isNickname ? undefined : () => window.open(`/api/hendon-redirect?name=${encodeURIComponent(player.name)}`, '_blank', 'noopener,noreferrer')}>
                        <span className="table-scanner-name-stack">
                          <span>{player.name}</span>
                          {player.chips && <span className="table-scanner-chips">{player.chips}{player.seat ? ` \u00B7 Seat ${player.seat}` : ''}</span>}
                          {!player.chips && player.seat && <span className="table-scanner-chips">Seat {player.seat}</span>}
                          {player.prize && <span className="table-scanner-chips" style={{color:'var(--accent)'}}>{player.prize}</span>}
                        </span>
                        {!isNickname && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,opacity:0.4}}>
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                          <polyline points="15 3 21 3 21 9"/>
                          <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {error && <div style={{fontSize:'0.78rem',color:'#ef4444',marginTop:4}}>{error}</div>}
    </div>
  );
}
