import React, { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../utils/api.js';

/* Admin's inbox (Features 38 and 48, 2026-11-11): reported messages and people, with Remove and Dismiss,
   and the problems players reported from the app, each with its picture on request and a reply that goes
   to their bell. Open ones first. */
const ago = (ms) => {
  const d = (Date.now() - Number(ms)) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return new Date(Number(ms)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function AdminInbox({ token }) {
  const [reports, setReports] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [img, setImg] = useState({});
  const [reply, setReply] = useState({});
  const hdr = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const load = useCallback(() => {
    fetch(`${API_URL}/admin/reports`, { headers: { Authorization: 'Bearer ' + token } }).then((r) => (r.ok ? r.json() : null)).then((d) => setReports(d ? d.reports : [])).catch(() => setReports([]));
    fetch(`${API_URL}/admin/feedback`, { headers: { Authorization: 'Bearer ' + token } }).then((r) => (r.ok ? r.json() : null)).then((d) => setFeedback(d ? d.feedback : [])).catch(() => setFeedback([]));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  const act = async (id, action) => {
    if (action === 'remove' && !window.confirm('Remove this message from the group for everyone?')) return;
    await fetch(`${API_URL}/admin/reports/${id}`, { method: 'PUT', headers: hdr, body: JSON.stringify({ action }) }).catch(() => {});
    load();
  };
  const showImg = async (id) => {
    const r = await fetch(`${API_URL}/admin/feedback/${id}/image`, { headers: { Authorization: 'Bearer ' + token } }).catch(() => null);
    if (r && r.ok) { const d = await r.json(); setImg((m) => ({ ...m, [id]: d.image })); }
  };
  const sendReply = async (id, status) => {
    await fetch(`${API_URL}/admin/feedback/${id}`, { method: 'PUT', headers: hdr, body: JSON.stringify({ reply: reply[id] || '', status }) }).catch(() => {});
    setReply((m) => ({ ...m, [id]: '' }));
    load();
  };
  const openReports = (reports || []).filter((r) => r.status === 'open');
  const openFb = (feedback || []).filter((f) => f.status === 'open');
  return (
    <div className="adm-inbox">
      <h3 className="an-cell an-sec">{`Reports · ${openReports.length} open`}</h3>
      {reports && reports.length === 0 && <p className="an-p">No reports.</p>}
      {(reports || []).slice(0, 40).map((r) => (
        <div key={r.id} className={'adm-item' + (r.status !== 'open' ? ' is-done' : '')}>
          <div className="adm-line"><b>{r.kind === 'message' ? `Message in ${r.group_name || 'a group'}` : 'A person'}</b>{` · by ${r.reporter || '?'} about ${r.target || '?'} · ${ago(r.created_at)}${r.status !== 'open' ? ` · ${r.status}` : ''}`}</div>
          {r.snapshot && <div className="adm-quote">{r.snapshot}</div>}
          {r.text && <div className="adm-why">{`Why: ${r.text}`}</div>}
          {Number(r.blocked_by) > 0 && <div className="adm-why">{`Blocked by ${r.blocked_by} account${Number(r.blocked_by) === 1 ? '' : 's'}`}</div>}
          {r.status === 'open' && (
            <div className="adm-actions">
              {r.kind === 'message' && <button type="button" className="btn btn-sm ctl adm-btn adm-btn--danger" onClick={() => act(r.id, 'remove')}><span>Remove</span></button>}
              <button type="button" className="btn btn-ghost btn-sm ctl adm-btn" onClick={() => act(r.id, 'dismiss')}><span>Dismiss</span></button>
            </div>
          )}
        </div>
      ))}
      <h3 className="an-cell an-sec">{`Problems reported · ${openFb.length} open`}</h3>
      {feedback && feedback.length === 0 && <p className="an-p">None yet.</p>}
      {(feedback || []).slice(0, 40).map((f) => (
        <div key={f.id} className={'adm-item' + (f.status !== 'open' ? ' is-done' : '')}>
          <div className="adm-line"><b>{f.username || '?'}</b>{` · ${f.view || '?'} · ${ago(f.created_at)}${f.status !== 'open' ? ` · ${f.status}` : ''}`}</div>
          <div className="adm-quote">{f.text}</div>
          {(f.version || f.platform) && <div className="adm-why">{[f.version, f.platform].filter(Boolean).join(' · ')}</div>}
          {f.reply && <div className="adm-why">{`You replied: ${f.reply}`}</div>}
          {Number(f.has_image) > 0 && (img[f.id]
            ? <img className="adm-shot" src={img[f.id]} alt="The screen it was sent from" />
            : <button type="button" className="btn btn-ghost btn-sm ctl adm-btn" onClick={() => showImg(f.id)}><span>Show the screen</span></button>)}
          {f.status !== 'closed' && (
            <div className="adm-reply">
              <input className="settings-debug-input" placeholder="Reply (goes to their bell)" value={reply[f.id] || ''} onChange={(e) => setReply((m) => ({ ...m, [f.id]: e.target.value }))} />
              <div className="adm-actions">
                <button type="button" className="btn btn-primary btn-sm ctl adm-btn" disabled={!(reply[f.id] || '').trim()} onClick={() => sendReply(f.id, 'open')}><span>Reply</span></button>
                <button type="button" className="btn btn-ghost btn-sm ctl adm-btn" onClick={() => sendReply(f.id, 'closed')}><span>Close</span></button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
