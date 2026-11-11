import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockAvailability, lockSettings, unlock, biometryName } from '../utils/app-lock.js';

/* The app lock's veil (Features 43, 2026-11-11): while locked, the app sits blurred behind a veil with the
   wordmark and one button. It locks at launch and when the app comes back after the chosen minutes away.
   Native apps only; off unless the player turned it on in Settings › Privacy. */
export default function AppLockVeil() {
  const [locked, setLocked] = useState(() => lockSettings().on);
  const [bio, setBio] = useState('faceID');
  const hiddenAt = useRef(0);
  const asking = useRef(false);
  const ask = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    const ok = await unlock('Unlock futurega.me');
    asking.current = false;
    if (ok) setLocked(false);
  }, []);
  useEffect(() => {
    lockAvailability().then((a) => {
      if (!a || !a.available) { setLocked(false); return; }
      setBio(a.biometry);
      if (lockSettings().on) ask();
    });
    const onVis = () => {
      const s = lockSettings();
      if (!s.on) return;
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return; }
      if (hiddenAt.current && Date.now() - hiddenAt.current >= s.after * 60e3) { setLocked(true); ask(); }
      hiddenAt.current = 0;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [ask]);
  if (!locked) return null;
  return createPortal(
    <div className="app-lock-veil" role="dialog" aria-modal="true" aria-label="futurega.me is locked">
      <div className="app-lock-word">futurega.me</div>
      <div className="app-lock-line">{`Locked. Unlock with ${biometryName(bio)}.`}</div>
      <button type="button" className="btn btn-primary ctl app-lock-btn" onClick={ask}><span>{`Unlock with ${biometryName(bio)}`}</span></button>
    </div>,
    document.body,
  );
}
