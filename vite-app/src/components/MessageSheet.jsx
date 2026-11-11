import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import useBackToClose from '../hooks/useBackToClose.js';

/* Press and hold a group message (Features 38, 2026-11-11): Report this message (to futuregame, never to the
   writer), Block the writer, and Mute or unmute the group's pushes (Features 39). Blocking ends the
   connection and hides each from the other; the blocked person is not told. */
export default function MessageSheet({ token, item, group, isOwn, onClose, onBlocked }) {
  const toast = useToast();
  const [stage, setStage] = useState('menu');   // menu | report | block | done
  const [why, setWhy] = useState('');
  const [muted, setMuted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useBackToClose(true, onClose);
  const who = item.real_name || item.username || 'them';
  useEffect(() => {
    fetch(`${API_URL}/notification-prefs`, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setMuted(d.prefs.mutedGroups.includes(Number(group.id)))).catch(() => {});
  }, [token, group.id]);
  const call = async (method, path, body) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_URL}${path}`, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || `It did not work (${r.status})`); return false; }
      return true;
    } catch { setErr('No connection. Nothing was sent.'); return false; }
    finally { setBusy(false); }
  };
  const report = async () => {
    if (await call('POST', '/reports', { kind: 'message', refId: item.id, text: why.trim() })) {
      if (toast) toast.success('Reported. Only futuregame sees it.');
      onClose();
    }
  };
  const block = async () => {
    if (await call('POST', '/blocks', { userId: item.user_id })) {
      if (toast) toast.success(`${who} is blocked`);
      if (onBlocked) onBlocked(item.user_id);
      onClose();
    }
  };
  const mute = async () => {
    if (await call('PUT', '/notification-prefs', { kind: `group:${group.id}`, value: muted ? 'default' : 'off' })) {
      if (toast) toast.success(muted ? `${group.name} unmuted` : `${group.name} muted on your phone`);
      onClose();
    }
  };
  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet msg-sheet" role="dialog" aria-label="Message">
        <div className="msg-quote"><b>{who}</b>{`: ${String(item.content || '').slice(0, 140)}`}</div>
        {stage === 'menu' && (
          <div className="msg-rows">
            {!isOwn && <button type="button" className="msg-row" onClick={() => setStage('report')}><span>Report this message</span><i>to futuregame, never to {who}</i></button>}
            {!isOwn && <button type="button" className="msg-row is-danger" onClick={() => setStage('block')}><span>{`Block ${who}`}</span></button>}
            {muted != null && <button type="button" className="msg-row" onClick={mute} disabled={busy}><span>{muted ? `Unmute ${group.name}` : `Mute ${group.name}`}</span><i>{muted ? 'its messages reach your phone again' : 'no pushes from this group'}</i></button>}
            <button type="button" className="msg-row is-quiet" onClick={onClose}><span>Cancel</span></button>
          </div>
        )}
        {stage === 'report' && (
          <div className="msg-form">
            <textarea className="rp-text msg-why" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} placeholder="What is wrong with it? (optional)" />
            {err && <p className="rp-note rp-err" role="alert">{err}</p>}
            <div className="rp-actions">
              <button type="button" className="btn btn-ghost ctl rp-btn" onClick={() => setStage('menu')} disabled={busy}><span>Back</span></button>
              <button type="button" className="btn btn-primary ctl rp-btn" onClick={report} disabled={busy}><span>{busy ? 'Sending…' : 'Report'}</span></button>
            </div>
          </div>
        )}
        {stage === 'block' && (
          <div className="msg-form">
            <p className="rp-note">{`You and ${who} stop being connected. Neither sees the other’s messages or schedule, and ${who} cannot send you requests. ${who} is not told.`}</p>
            {err && <p className="rp-note rp-err" role="alert">{err}</p>}
            <div className="rp-actions">
              <button type="button" className="btn btn-ghost ctl rp-btn" onClick={() => setStage('menu')} disabled={busy}><span>Back</span></button>
              <button type="button" className="btn ctl rp-btn rp-btn--danger" onClick={block} disabled={busy}><span>{busy ? 'Blocking…' : 'Block'}</span></button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
