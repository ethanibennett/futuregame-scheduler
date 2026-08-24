import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { THEME_ORDER, THEME_LABEL, THEME_ICON, getStoredSeasonLabel } from '../utils/utils.js';

export default function AuthScreen({ onSubmit, error, success, theme, toggleTheme, onForgotPassword, onGuestLogin, initialRegister }) {
  const [isRegister, setIsRegister] = useState(!!initialRegister);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const nextThemeLabel = THEME_LABEL[THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]];

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'8px'}}>
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
            <input type="password" name="password" placeholder={isRegister ? 'Min. 6 characters' : 'Your password'} required minLength="6" autoComplete={isRegister ? 'new-password' : 'current-password'} />
          </div>
          {!isRegister && (
            <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'0.8rem',color:'var(--text-muted)',marginTop:'10px',cursor:'pointer'}}>
              <input type="checkbox" checked={keepSignedIn} onChange={e => setKeepSignedIn(e.target.checked)}
                style={{accentColor:'var(--accent)',cursor:'pointer'}} />
              Keep me signed in
            </label>
          )}
          <button type="submit" className="btn btn-primary btn-full" style={{marginTop:'8px'}}>
            {isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {!isRegister && (
          <p className="auth-hint" style={{textAlign:'center',marginTop:'var(--space-lg)'}}>
            <button onClick={onForgotPassword}
              className="auth-link-quiet">
              Forgot password?
            </button>
          </p>
        )}

        <p className="auth-hint" style={{textAlign:'center',marginTop:'var(--space-2xl)'}}>
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
          <p style={{textAlign:'center',marginTop:'8px',fontSize:'0.72rem',color:'var(--text-muted)',opacity:0.7}}>
            Browse tournaments without an account
          </p>
        </div>
      </div>
    </div>
  );
}
