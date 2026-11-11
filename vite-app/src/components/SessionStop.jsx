import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';
import { formatCurrencyAmount } from '../utils/utils.js';
import useBackToClose from '../hooks/useBackToClose.js';

/* Your stop (Features 15, 2026-11-11): a time and a loss line for the session, kept for you. The live bar
   says how far the nearer one is; at either, it turns and asks once, Cash out or Move the line. Nothing
   ends by itself, and a line the player moves is theirs to move. */

export function useSessionStop(token, sessionId) {
  const [stop, setStop] = useState(null);
  const load = useCallback(() => {
    if (!token || !sessionId) { setStop(null); return; }
    fetch(`${API_URL}/cash-sessions/${sessionId}/stop`, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setStop(d ? d.stop : null)).catch(() => {});
  }, [token, sessionId]);
  useEffect(() => { load(); }, [load]);
  const save = useCallback(async (body) => {
    const r = await fetch(`${API_URL}/cash-sessions/${sessionId}/stop`, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const d = r && (await r.json().catch(() => null));
    if (r && r.ok) { setStop(d.stop); return null; }
    return (d && d.error) || 'It was not saved';
  }, [token, sessionId]);
  return { stop, save };
}

/** Where the session stands against its lines: { timeLeftMs, lossLeft, reached: 'time'|'loss'|null }. */
export function stopState(stop, session, stacks, now) {
  if (!stop || !session) return null;
  const timeLeftMs = stop.stopAt ? Date.parse(stop.stopAt) - now : null;
  const last = (stacks || []).length ? stacks[stacks.length - 1] : null;
  const result = last ? Number(last.result) : null;
  const lossLeft = stop.loss != null && result != null ? stop.loss + result : null;
  const reached = timeLeftMs != null && timeLeftMs <= 0 ? 'time' : (lossLeft != null && lossLeft <= 0 ? 'loss' : null);
  return { timeLeftMs, lossLeft, result, reached };
}

const hm = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };

export function stopLine(st, session) {
  if (!st) return '';
  if (st.reached === 'time') return 'At your stop time';
  if (st.reached === 'loss') return 'At your loss line';
  const parts = [];
  if (st.timeLeftMs != null) parts.push(`${hm(st.timeLeftMs)} to your stop`);
  if (st.lossLeft != null) parts.push(`${formatCurrencyAmount(st.lossLeft, session.currency)} to your loss line`);
  return parts[0] || '';
}

export function StopSheet({ stop, session, stacks, onSave, onCashOut, onClose }) {
  useBackToClose(true, onClose);
  const now = Date.now();
  const st = stopState(stop, session, stacks, now);
  const [hours, setHours] = useState(() => (stop && stop.stopAt ? String(Math.round((Date.parse(stop.stopAt) - Date.parse(session.started_at)) / 6e4) / 60) : ''));
  const [loss, setLoss] = useState(() => (stop && stop.loss != null ? String(stop.loss) : ''));
  const [err, setErr] = useState('');
  const save = async () => {
    const e = await onSave({ stopMinutes: hours ? Math.round(Number(hours) * 60) : null, loss: loss ? Number(loss) : null });
    if (e) setErr(e); else onClose();
  };
  const startMs = Date.parse(session.started_at);
  const timeShare = stop && stop.stopAt ? Math.min(1, (now - startMs) / Math.max(1, Date.parse(stop.stopAt) - startMs)) : null;
  const lossShare = st && st.lossLeft != null && stop.loss ? Math.min(1, Math.max(0, -st.result / stop.loss)) : null;
  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet stop-sheet" role="dialog" aria-label="Your stop">
        <h3>{st && st.reached ? (st.reached === 'time' ? 'You are at your stop time' : 'You are at your loss line') : 'Your stop'}</h3>
        {timeShare != null && (
          <div className="stop-row"><span>{`Stop at ${new Date(stop.stopAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}</span><b>{st.timeLeftMs > 0 ? hm(st.timeLeftMs) + ' left' : 'now'}</b>
            <i className="stop-bar is-time"><em style={{ width: `${Math.round(timeShare * 100)}%` }} /></i></div>
        )}
        {lossShare != null && (
          <div className="stop-row"><span>{`Loss line ${formatCurrencyAmount(stop.loss, session.currency)}`}</span><b>{`${formatCurrencyAmount(Math.max(0, st.lossLeft), session.currency)} left`}</b>
            <i className="stop-bar is-loss"><em style={{ width: `${Math.round(lossShare * 100)}%` }} /></i></div>
        )}
        {stop && stop.loss != null && lossShare == null && <p className="rp-note">The loss line counts from your last stack update; there is none yet.</p>}
        <div className="stop-fields">
          <label><span>Play for, hours</span><input inputMode="decimal" value={hours} placeholder="6" onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ''))} /></label>
          <label><span>{`Loss line, ${session.currency || 'USD'}`}</span><input inputMode="numeric" value={loss} placeholder="1000" onChange={(e) => setLoss(e.target.value.replace(/[^\d]/g, ''))} /></label>
        </div>
        {err && <p className="rp-note rp-err" role="alert">{err}</p>}
        <div className="rp-actions">
          {st && st.reached
            ? <button type="button" className="btn btn-ghost ctl rp-btn" onClick={() => { onClose(); onCashOut(); }}><span>Cash out</span></button>
            : <button type="button" className="btn btn-ghost ctl rp-btn" onClick={onClose}><span>Close</span></button>}
          <button type="button" className="btn btn-primary ctl rp-btn" onClick={save}><span>{stop ? 'Move the line' : 'Set'}</span></button>
        </div>
      </div>
    </>,
    document.body,
  );
}
