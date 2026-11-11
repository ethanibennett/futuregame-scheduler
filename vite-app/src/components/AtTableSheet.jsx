import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import qrcode from 'qrcode-generator';
import { API_URL } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import useBackToClose from '../hooks/useBackToClose.js';

/* Add a friend at the table (Features 36, 2026-11-11): "My code" draws the player's invite link (Features
   37) as a QR code; "Scan a code" reads a friend's with the camera and sends them a connection request,
   which they accept as any other. A phone camera without the app reads the same code as the invite link. */

function QrSvg({ text }) {
  const { n, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    }
    return { n: count + 4, path: d };
  }, [text]);
  return (
    <svg className="att-qr" viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="Your code">
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** The invite token in a scanned text, or null: "https://futurega.me/i/<token>" or a bare token. */
export function inviteTokenFrom(text) {
  const s = String(text || '').trim();
  const m = /\/i\/([A-Za-z0-9_-]{6,40})(?:[/?#]|$)/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{8,40}$/.test(s) ? s : null;
}

function Scanner({ onToken }) {
  const videoRef = useRef(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream = null, timer = null, alive = true;
    (async () => {
      try {
        const { default: jsQR } = await import('jsqr');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!alive) return;
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play().catch(() => {});
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const tick = () => {
          if (!alive) return;
          if (v.readyState >= 2 && v.videoWidth) {
            const w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * (w / v.videoWidth));
            canvas.width = w; canvas.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            const tok = found && inviteTokenFrom(found.data);
            if (tok) { onToken(tok); return; }
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch {
        setErr('The camera is not available. Ask for their link instead, or allow the camera in the device’s settings.');
      }
    })();
    return () => { alive = false; if (timer) clearTimeout(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [onToken]);
  return (
    <div className="att-scan">
      {err ? <p className="att-line">{err}</p> : <video ref={videoRef} className="att-video" playsInline muted />}
    </div>
  );
}

export default function AtTableSheet({ token, name, onClose, onConnected }) {
  const toast = useToast();
  const [mode, setMode] = useState('mine');
  const [inv, setInv] = useState(null);
  const [result, setResult] = useState(null);
  useBackToClose(true, onClose);
  useEffect(() => {
    fetch(`${API_URL}/invite`, { headers: { Authorization: 'Bearer ' + token } }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setInv(d)).catch(() => {});
  }, [token]);
  const rotate = async () => {
    const r = await fetch(`${API_URL}/invite/rotate`, { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(() => null);
    if (r && r.ok) setInv(await r.json());
  };
  const onToken = useCallback(async (tok) => {
    setMode('done');
    try {
      const r = await fetch(`${API_URL}/invite/${encodeURIComponent(tok)}/connect`, { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setResult({ ok: false, text: d.error || 'That code did not work' }); return; }
      const text = d.status === 'connected' ? `You and ${d.username} are already connected`
        : d.status === 'pending' ? `A request to ${d.username} is already waiting`
          : `Request sent to ${d.username}. You are connected once they accept.`;
      setResult({ ok: true, text });
      if (toast && d.status === 'sent') toast.success(`Request sent to ${d.username}`);
      if (onConnected) onConnected();
    } catch { setResult({ ok: false, text: 'No connection. Try again.' }); }
  }, [token, toast, onConnected]);
  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet att-sheet" role="dialog" aria-label="Add at the table">
        <h3>Add at the table</h3>
        <div className="att-switch" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'mine'} className={'att-tab ctl' + (mode === 'mine' ? ' is-on' : '')} onClick={() => setMode('mine')}><span>My code</span></button>
          <button type="button" role="tab" aria-selected={mode !== 'mine'} className={'att-tab ctl' + (mode !== 'mine' ? ' is-on' : '')} onClick={() => { setResult(null); setMode('scan'); }}><span>Scan a code</span></button>
        </div>
        {mode === 'mine' && (
          <div className="att-mine">
            <div className="att-name">{name}</div>
            {inv ? <QrSvg text={inv.url} /> : <div className="att-qr att-qr--wait" />}
            <p className="att-line">Their camera opens your invite: they send a request, and you are connected once you accept.</p>
            <div className="att-actions">
              <button type="button" className="btn btn-ghost ctl att-btn" onClick={rotate}><span>New code</span></button>
              <button type="button" className="btn btn-primary ctl att-btn" onClick={() => { setResult(null); setMode('scan'); }}><span>Scan theirs</span></button>
            </div>
          </div>
        )}
        {mode === 'scan' && <Scanner onToken={onToken} />}
        {mode === 'done' && (
          <div className="att-mine">
            <p className={'att-line' + (result && !result.ok ? ' att-err' : '')}>{result ? result.text : 'Sending…'}</p>
            <div className="att-actions">
              <button type="button" className="btn btn-ghost ctl att-btn" onClick={() => { setResult(null); setMode('scan'); }}><span>Scan another</span></button>
              <button type="button" className="btn btn-primary ctl att-btn" onClick={onClose}><span>Done</span></button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
