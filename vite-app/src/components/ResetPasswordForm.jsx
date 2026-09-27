import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { THEME_ORDER, THEME_LABEL, THEME_ICON } from '../utils/utils.js';
import { API_URL } from '../utils/api.js';

export default function ResetPasswordForm({ resetToken, theme, toggleTheme }) {
  const nextThemeLabel = THEME_LABEL[THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]];
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (password !== confirmPassword) {
      setError('Passwords do not match'); return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters'); return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Reset failed'); }
      else { setSuccess(data.message); }
    } catch (e) {
      console.error('Reset password:', e);
      setError('Network error. Please try again.');
    } finally { setLoading(false); }
  };

  const goToLogin = () => {
    window.location.hash = '';
    window.location.reload();
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'var(--space-md)'}}>
          <button className="btn btn-ghost btn-sm" onClick={toggleTheme} title={`Switch to ${nextThemeLabel} mode`}>
            {React.createElement(Icon[THEME_ICON[theme]] || Icon.moon)}
          </button>
        </div>
        <div className="auth-logo">
          <h1>futurega.me</h1>
          <p>set new password</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {!success ? (
          <form onSubmit={handleSubmit}>
            <div className="form-field">
              <label>New Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters" required minLength="8" autoComplete="new-password" />
            </div>
            <div className="form-field">
              <label>Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password" required minLength="8" autoComplete="new-password" />
            </div>
            <button type="submit" className="btn btn-primary btn-full"
              style={{marginTop:'var(--space-md)'}} disabled={loading}>
              {loading ? 'Updating...' : 'Set New Password'}
            </button>
          </form>
        ) : (
          <button onClick={goToLogin} className="btn btn-primary btn-full" style={{marginTop:'var(--space-md)'}}>
            Go to Sign In
          </button>
        )}
      </div>
    </div>
  );
}
