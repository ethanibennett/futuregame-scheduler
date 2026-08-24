import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { THEME_ORDER, THEME_LABEL, THEME_ICON } from '../utils/utils.js';
import { API_URL } from '../utils/api.js';

export default function ForgotPasswordForm({ onBack, theme, toggleTheme }) {
  const nextThemeLabel = THEME_LABEL[THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]];
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      const res = await fetch(`${API_URL}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Request failed'); }
      else { setSuccess(data.message); }
    } catch (e) {
      console.error('Forgot password:', e);
      setError('Network error. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'8px'}}>
          <button className="btn btn-ghost btn-sm" onClick={toggleTheme} title={`Switch to ${nextThemeLabel} mode`}>
            {React.createElement(Icon[THEME_ICON[theme]] || Icon.moon)}
          </button>
        </div>
        <div className="auth-logo">
          <h1>futurega.me</h1>
          <p>reset password</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {!success && (
          <form onSubmit={handleSubmit}>
            <div className="form-field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required autoComplete="email" />
            </div>
            <button type="submit" className="btn btn-primary btn-full"
              style={{marginTop:'8px'}} disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        )}

        <p className="auth-hint" style={{textAlign:'center',marginTop:'var(--space-2xl)'}}>
          <button onClick={onBack}
            className="auth-link">
            Back to Sign In
          </button>
        </p>
      </div>
    </div>
  );
}
