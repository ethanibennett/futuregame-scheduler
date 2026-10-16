import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { THEME_ORDER, THEME_LABEL, THEME_ICON, getStoredSeasonLabel } from '../utils/utils.js';
import { nextTheme } from '../utils/theme.js';

// The sign-up's "How did you hear about us?" choices; the values are lib/growth.js HEARD.
const HEARD_OPTIONS = [
  ['friend', 'A friend'], ['room', 'At a poker room'], ['instagram', 'Instagram'], ['facebook', 'Facebook'],
  ['reddit', 'Reddit'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['podcast', 'A podcast'],
  ['press', 'A news story'], ['appstore', 'The App Store'], ['search', 'A web search'], ['other', 'Somewhere else'],
];

export default function AuthScreen({ onSubmit, error, success, theme, toggleTheme, onForgotPassword, onGuestLogin, initialRegister }) {
  const [isRegister, setIsRegister] = useState(!!initialRegister);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const nextThemeLabel = THEME_LABEL[nextTheme(theme)];

  return (
    <div className="auth-wrap">
      <div className="auth-card snap-place">
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'var(--space-md)'}}>
          <button className="btn btn-ghost btn-icon" onClick={toggleTheme} title={`Switch to ${nextThemeLabel} mode`}>
            {React.createElement(Icon[THEME_ICON[theme]] || Icon.moon)}
          </button>
        </div>
        <div className="auth-logo">
          <h1>futurega.me</h1>
          <p>{getStoredSeasonLabel()}</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <form onSubmit={e => onSubmit(e, isRegister, keepSignedIn)}>
          {isRegister && (
            <div className="form-field">
              <label>Full Name</label>
              <input type="text" name="realName" placeholder="Your real name" required maxLength="40" autoComplete="name" />
            </div>
          )}
          {isRegister && (
            <div className="form-field">
              <label>Username</label>
              <input type="text" name="username" placeholder="Choose a username" required autoComplete="username" />
            </div>
          )}
          <div className="form-field">
            <label>Email</label>
            <input type="email" name="email" placeholder="you@example.com" required autoComplete="email" />
          </div>
          <div className="form-field">
            <label>Password</label>
            <input type="password" name="password" placeholder={isRegister ? 'At least 8 characters' : 'Your password'} required minLength={isRegister ? 8 : 6} autoComplete={isRegister ? 'new-password' : 'current-password'} />
          </div>
          {isRegister && (
            <div className="form-field">
              {/* Where the player heard of the app (launch plan, growth measurement; optional). */}
              <label htmlFor="auth-heard">How did you hear about us?</label>
              <select id="auth-heard" name="heard" defaultValue="">
                <option value="">Prefer not to say</option>
                {HEARD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          )}
          {!isRegister && (
            <label className="auth-keep" style={{display:'flex',alignItems:'center',gap:'var(--space-sm)',fontSize:'calc(var(--gu) * 1.178)',color:'var(--text-muted)',cursor:'pointer'}}>
              <input type="checkbox" checked={keepSignedIn} onChange={e => setKeepSignedIn(e.target.checked)}
                style={{accentColor:'var(--accent)',cursor:'pointer'}} />
              Keep me signed in
            </label>
          )}
          <button type="submit" className="btn btn-primary btn-full" style={{marginTop:'var(--space-md)'}}>
            {isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {!isRegister && (
          <p className="auth-hint" style={{textAlign:'center',marginTop:'calc(var(--subrow) * 2)'}}>
            <button onClick={onForgotPassword}
              className="auth-link-quiet">
              Forgot password?
            </button>
          </p>
        )}

        <p className="auth-hint" style={{textAlign:'center',marginTop:'calc(var(--subrow) * 2)'}}>
          {isRegister ? 'Already have an account? ' : "Don't have an account? "}
          <button onClick={() => setIsRegister(r => !r)}
            className="auth-link">
            {isRegister ? 'Sign in' : 'Register'}
          </button>
        </p>

        <div className="auth-divider">
          <button onClick={onGuestLogin} className="btn btn-ghost btn-full"
            >
            Continue as Guest
          </button>
          <p style={{textAlign:'center',marginTop:'var(--space-md)',fontSize:'calc(var(--gu) * 1.060)',color:'var(--text-muted)',opacity:0.7}}>
            Browse tournaments without an account
          </p>
        </div>
      </div>
    </div>
  );
}
