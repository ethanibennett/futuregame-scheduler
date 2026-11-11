import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import useBackToClose from '../hooks/useBackToClose.js';

/* Report a problem (Features 48, 2026-11-11): from the user menu, a sheet with what went wrong, a picture of
   the screen it was opened from (one JPEG, taken before the sheet drew over it) and a ticked "Attach this
   screen, the app version and the device". The owner reads them in Admin; a reply comes back in the bell. */

async function snapScreen() {
  try {
    const { domToJpeg } = await import('modern-screenshot');
    const el = document.querySelector('.app-shell') || document.body;
    const w = el.clientWidth || window.innerWidth;
    const scale = Math.min(1, 720 / Math.max(1, w));
    return await domToJpeg(el, { quality: 0.6, scale, width: w, height: Math.min(el.clientHeight || window.innerHeight, window.innerHeight) });
  } catch { return null; }
}

const platform = () => {
  const C = window.Capacitor;
  if (C && C.isNativePlatform && C.isNativePlatform()) return C.getPlatform ? C.getPlatform() : 'native';
  return 'web';
};

export default function ReportProblemSheet({ token, view, onClose }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [shot, setShot] = useState(null);
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useBackToClose(true, onClose);
  useEffect(() => { let on = true; snapScreen().then((s) => { if (on) setShot(s); }); return () => { on = false; }; }, []);
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_URL}/feedback`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(), view,
          image: attach && shot && shot.length < 1.2e6 ? shot : null,
          version: attach ? (import.meta.env.VITE_APP_VERSION || document.querySelector('meta[name="build"]')?.content || 'web') : null,
          platform: attach ? `${platform()} · ${navigator.userAgent.slice(0, 120)}` : null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || `Not sent (${r.status}). Your words are still here.`); return; }
      if (toast) toast.success('Sent. Thank you; a reply will come to the bell.');
      onClose();
    } catch { setErr('No connection. Your words are still here.'); }
    finally { setBusy(false); }
  };
  return createPortal(
    <>
      <div className="share-menu-backdrop rp-backdrop" onClick={onClose} />
      <form className="share-menu-panel rp-sheet" onSubmit={send} role="dialog" aria-label="Report a problem">
        <div className="rp-title">Report a problem</div>
        <div className="rp-body">
          <textarea className="rp-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000}
            placeholder="What went wrong, and what did you expect?" autoFocus />
          {shot && attach && <img className="rp-shot" src={shot} alt="The screen this was opened from" />}
        </div>
        <label className="rp-attach">
          <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
          <span>Attach this screen, the app version and the device</span>
        </label>
        <p className="rp-note">Only futuregame reads it. The picture can show other people’s names; untick it to leave it out.</p>
        {err && <p className="rp-note rp-err" role="alert">{err}</p>}
        <div className="rp-actions">
          <button type="button" className="btn btn-ghost ctl rp-btn" onClick={onClose} disabled={busy}><span>Cancel</span></button>
          <button type="submit" className="btn btn-primary ctl rp-btn" disabled={busy || !text.trim()}><span>{busy ? 'Sending…' : 'Send'}</span></button>
        </div>
      </form>
    </>,
    document.body,
  );
}
