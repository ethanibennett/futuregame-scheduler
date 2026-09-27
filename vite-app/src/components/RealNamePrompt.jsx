import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';

export default function RealNamePrompt({ onSave, onDismiss, token }) {
  const [name, setName] = useState('');
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
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 'calc(var(--subrow) * 47.5)' }}>
        <h3 style={{ marginBottom: 'var(--space-xs)' }}>What's your name?</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--gu) * 1.252)', marginBottom: 'var(--space-xl)' }}>
          Your connections and group members will see this.
        </p>
        {err && <div className="alert alert-error" style={{ marginBottom: 'var(--space-lg)' }}>{err}</div>}
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your real name"
          maxLength={40}
          autoFocus
          style={{ width: '100%', padding: 'var(--space-ml) var(--space-lg)', borderRadius: 'var(--radius-sm)', border: 'var(--bw-hair) solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 'calc(var(--gu) * 1.399)', boxSizing: 'border-box' }}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) handleSave(); }}
        />
        <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-xl)', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={onDismiss}>Later</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
