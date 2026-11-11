import React, { useState, useEffect } from 'react';
import ThemeButton from './ThemeButton.jsx';
import { THEME_LABEL, getStoredSeasonLabel } from '../utils/utils.js';
import { nextTheme } from '../utils/theme.js';
import { API_URL } from '../utils/api.js';

// The sign-up's "How did you hear about us?" choices; the values are lib/growth.js HEARD.
const HEARD_OPTIONS = [
  ['friend', 'A friend'], ['room', 'At a poker room'], ['instagram', 'Instagram'], ['facebook', 'Facebook'],
  ['reddit', 'Reddit'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['podcast', 'A podcast'],
  ['press', 'A news story'], ['appstore', 'The App Store'], ['search', 'A web search'], ['other', 'Somewhere else'],
];

/* Whether this browser already knows where the player came from (a campaign tag kept by
   utils/live-page.js captureLanding, or the web app's ?src=). Then sign-up does not ask. */
function campaignKnown() {
  try {
    const first = JSON.parse(localStorage.getItem('acqSource') || '{}') || {};
    if (first.ct || first.utm_source || first.src) return true;
  } catch { /* storage off */ }
  try { return !!new URLSearchParams(window.location.search).get('src'); } catch { return false; }
}

/* Sign In and Create Account (Laws of UX picks 7, 8, 11, 14; owner, 2026-11-10): the two account
   actions are the card's two first buttons, sign-up asks for a name, an email and a password, and a
   tap is answered at once ("Signing in…", the fields locked) while the request runs. */
/* Apple's mark for the Sign in with Apple button (Features 41), drawn in the button's text colour. */
const AppleMark = () => (
  <svg viewBox="0 0 17 20" aria-hidden="true" className="auth-apple-mark"><path fill="currentColor" d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.8 2 5.8 1.1 7.4c-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.7-1-2.7-4.3zM11.6 3c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z" /></svg>
);

export default function AuthScreen({ onSubmit, error, success, theme, toggleTheme, onForgotPassword, onGuestLogin, initialRegister, busy = false, onRegisterShown, onModeChange = null,
  invite = null, onAppleSignIn = null }) {
  // An invite link (Features 37): who invited you, shown above the form before the account exists.
  const [inviter, setInviter] = useState(null);
  useEffect(() => {
    if (!invite) return undefined;
    let on = true;
    fetch(`${API_URL}/invite/${encodeURIComponent(invite)}/info`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (on && d) setInviter(d); }).catch(() => {});
    return () => { on = false; };
  }, [invite]);
  const [isRegister, setIsRegister] = useState(!!initialRegister);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [email, setEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const nextThemeLabel = THEME_LABEL[nextTheme(theme)];
  const [season, setSeason] = useState(getStoredSeasonLabel);
  const askHeard = isRegister && !campaignKnown() && !inviter;
  // The Schedule's date range. On the web it is already in the page; the native app's page ships in the
  // app, so it asks, and a failed ask leaves the last label it knew.
  useEffect(() => {
    if (document.querySelector('meta[name="season-label"]')) return undefined;
    let on = true;
    fetch(`${API_URL}/public/live-summary`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!on || !d || !d.seasonLabel) return;
      setSeason(d.seasonLabel);
      try { localStorage.setItem('seasonLabel', d.seasonLabel); } catch { /* private mode */ }
      document.title = `futurega.me | ${d.seasonLabel}`;
    }).catch(() => {});
    return () => { on = false; };
  }, []);
  // Create Account shown: fetch first-run setup's code now, so it opens the moment the account exists.
  useEffect(() => { if (isRegister && onRegisterShown) onRegisterShown(); }, [isRegister, onRegisterShown]);

  const submitLabel = busy
    ? (isRegister ? 'Creating your account…' : 'Signing in…')
    : (isRegister ? 'Create Account' : 'Sign In');

  return (
    <div className="auth-wrap">
      <div className="auth-card snap-place">
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'var(--space-md)'}}>
          <ThemeButton theme={theme} nextThemeLabel={nextThemeLabel} onToggle={toggleTheme} />
        </div>
        <div className="auth-logo">
          <h1>futurega.me</h1>
          <p>{isRegister ? 'Create your free account' : season}</p>
        </div>

        {inviter && isRegister && (
          <div className="auth-invite">
            {inviter.avatar ? <img className="auth-invite-av" src={inviter.avatar} alt="" /> : <span className="auth-invite-av auth-invite-av--init">{String(inviter.name || '?').charAt(0).toUpperCase()}</span>}
            <span className="auth-invite-text">
              <b>{`${inviter.name} invited you`}</b>
              <span>{`Your account is connected to ${inviter.name.split(' ')[0]} when it is made, and opens on their week.`}</span>
            </span>
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {onAppleSignIn && (
          <>
            {/* Sign in with Apple (Features 41): Apple's own wording, black, above the email form. */}
            <button type="button" className="auth-apple" onClick={onAppleSignIn} disabled={busy}>
              <AppleMark /><span>{isRegister ? 'Sign up with Apple' : 'Sign in with Apple'}</span>
            </button>
            <div className="auth-or"><span>or with email</span></div>
          </>
        )}

        <form onSubmit={e => onSubmit(e, isRegister, keepSignedIn)} aria-busy={busy}>
          <fieldset className="auth-fields" disabled={busy}>
            {isRegister && (
              <div className="form-field">
                <label htmlFor="auth-name">Your name</label>
                <input id="auth-name" type="text" name="realName" placeholder="First and last name" required maxLength="40" autoComplete="name" />
              </div>
            )}
            <div className="form-field">
              <label htmlFor="auth-email">Email</label>
              <input id="auth-email" type="email" name="email" placeholder="you@example.com" required autoComplete="email"
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="auth-password">Password</label>
              <div className="auth-pw">
                <input id="auth-password" type={showPassword ? 'text' : 'password'} name="password"
                  placeholder={isRegister ? 'At least 8 characters' : 'Your password'} required minLength={isRegister ? 8 : 6}
                  autoComplete={isRegister ? 'new-password' : 'current-password'} />
                <button type="button" className="auth-pw-toggle" onClick={() => setShowPassword(v => !v)}
                  aria-pressed={showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {askHeard && (
              <div className="form-field">
                {/* Where the player heard of the app (launch plan, growth measurement; optional), asked
                    only when no campaign tag already says. No preset answer. */}
                <label htmlFor="auth-heard">How did you hear about us?</label>
                <select id="auth-heard" name="heard" defaultValue="">
                  <option value="">Choose one (optional)</option>
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
          </fieldset>
          <button type="submit" className="btn btn-primary btn-full auth-submit" style={{marginTop:'var(--space-md)'}} disabled={busy}>
            {busy && <span className="auth-spinner" aria-hidden="true" />}
            {submitLabel}
          </button>
        </form>

        {isRegister ? (
          <p className="auth-hint" style={{textAlign:'center',marginTop:'calc(var(--subrow) * 2)'}}>
            {'Already have an account? '}
            <button type="button" onClick={() => { setIsRegister(false); if (onModeChange) onModeChange(); }} className="auth-link">Sign in</button>
          </p>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-full auth-create" onClick={() => { setIsRegister(true); if (onModeChange) onModeChange(); }}>
              Create an account
            </button>
            <button type="button" className="auth-link-quiet auth-forgot" onClick={() => onForgotPassword(email)}>
              Forgot password?
            </button>
          </>
        )}

        <div className="auth-divider">
          <button type="button" onClick={onGuestLogin} className="btn btn-ghost btn-full">
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
