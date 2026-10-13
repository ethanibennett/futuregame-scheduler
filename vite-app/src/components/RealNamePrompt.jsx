import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';

/* The name buddies and groups see. Asked after a password sign-in to an account that has none
   (accounts from before registration required one); "Later" asks again at the next sign-in.
   Settings' "Edit name" opens it on the current name (initialName), titled "Your name". */
export default function RealNamePrompt({ onSave, onDismiss, token, initialName }) {
  const editing = initialName !== undefined;
  const [name, setName] = useState(initialName || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true); setErr('');
    try {
      const res = await fetch(`${API_URL}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ realName: name.trim() })
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Failed to save'); setSaving(false); return; }
      onSave(data.realName);
    } catch (e) { console.error('Profile save:', e); setErr('Network error'); setSaving(false); }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onDismiss}>
      {/* 33g on the grid (.modal-content.ob-name); snap-place sets the centred box on the lines.
          Its text is seated as first-run setup's (.ob-title, .ob-lead). */}
      <div className="modal-content snap-place ob ob-name" role="dialog" aria-modal="true" aria-labelledby="name-title" onClick={e => e.stopPropagation()}>
        <h3 id="name-title" className="ob-title">{editing ? 'Your name' : "What's your name?"}</h3>
        <p className="ob-lead">Buddies and groups see this instead of your username.</p>
        {err && <div className="alert alert-error">{err}</div>}
        <input
          className="ob-search ob-input"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your real name"
          aria-label="Your real name"
          maxLength={40}
          autoFocus
          autoComplete="name"
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) handleSave(); }}
        />
        <div className="ob-foot ob-foot--end">
          <button className="btn btn-ghost btn-sm snap-g" onClick={onDismiss}>{editing ? 'Cancel' : 'Later'}</button>
          <button className="btn btn-primary btn-sm snap-g" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
