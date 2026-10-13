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
      {/* 33g on the grid (see .modal-content); snap-place sets the centred box on the lines. */}
      <div className="modal-content snap-place" onClick={e => e.stopPropagation()} style={{ width: 'calc(var(--gu) * 33)' }}>
        <h3>What's your name?</h3>
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
          style={{ display: 'block', width: '100%', height: 'calc(var(--subrow) * 5)', padding: '0 var(--space-lg)', borderRadius: 'var(--radius-sm)', border: 'var(--bw-hair) solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 'calc(var(--gu) * 1.399)', boxSizing: 'border-box' }}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) handleSave(); }}
        />
        <div style={{ display: 'flex', gap: 'var(--gu)', marginTop: 'var(--space-xl)', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm snap-g" onClick={onDismiss}>Later</button>
          <button className="btn btn-primary btn-sm snap-g" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
