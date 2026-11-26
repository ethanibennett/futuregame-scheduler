// play.futurega.me: the play-money tables' own site (owner, 2026-11-22: "deploy to play.futurega.me, no effect on the
// mobile app"). Its own page (src/play-main.jsx, built to play.html), so the app, and the iOS app built from it, carry
// no table and no link to one. A sign-in (the futurega.me account, by its email and password: this origin has its own
// storage, so a session on futurega.me does not carry over), then the tables (TablesView), for the accounts the server
// says may play (decision 3: every registered account since 2026-11-26). Everything it asks is futurega.me's own API, on
// this same server (server.js servePlay answers for the play host); the table itself streams from the tables service.
import React, { useEffect, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { tablesApi } from '../utils/play-tables.js';
import useDesktopLayout from '../hooks/useDesktopLayout.js';
import { T } from './StudyHead.jsx';
import TablesView from './TablesView.jsx';
import './tables.css';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage off */ } };

function SignIn({ onIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API_URL}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.token) throw new Error(d.error || 'That email and password did not sign in');
      onIn(d);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="hs-view rd-setup tb-lobby" onSubmit={submit} aria-busy={busy}>
      <h2 className="screen-title hs-t hs-title" style={T(4)}>Sign in to play</h2>
      <div className="hs-t hs-sm hs-mut rd-wrap">Your futurega.me account. The chips here are free: never bought, cashed out or sent to anyone.</div>
      <label className="tb-field"><span className="tb-field-label">Email</span>
        <input type="email" autoComplete="username" value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="tb-field"><span className="tb-field-label">Password</span>
        <input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <div className="hs-t hs-sm rd-wrap rd-warn">{error}</div>}
      <button type="submit" className="hs-btn rd-primary" disabled={busy}><span className="hs-t" style={T(3)}>{busy ? 'Signing in…' : 'Sign in'}</span></button>
      <div className="hs-t hs-xs hs-mut rd-wrap">No account, or no password? Make one, or reset it, at <a href="https://futurega.me" target="_blank" rel="noopener noreferrer">futurega.me</a>.</div>
    </form>
  );
}

export default function PlayApp() {
  const [token, setToken] = useState(() => read('token'));
  const [name, setName] = useState(() => read('playName') || '');
  const [open, setOpen] = useState(null); // null: asking; true: tables on for this account; false: not
  const cardSplay = read('cardSplay') !== 'off';
  /* A desktop window (>= 1024 wide, landscape) gets the app's desktop frame: a shell a whole number of g wide, centred
     (.app-shell.is-desktop, --dk-shell-n), and the flags the replay's desktop table and the portalled panels key on
     (html[data-layout="desktop"], .dk-on), set as App.jsx sets them; so the felt, its transport and the chat land on
     the grid as they do in the app. A phone is the phone layout. */
  const dk = useDesktopLayout();
  useEffect(() => {
    const root = document.documentElement;
    if (!dk.desktop) { delete root.dataset.layout; root.classList.remove('dk-on'); return; }
    root.dataset.layout = 'desktop';
    root.classList.add('dk-on');
    root.style.setProperty('--dk-shell-n', String(dk.shellG));
    root.style.setProperty('--dk-sheet-x', String(Math.max(0, Math.round((dk.shellG - 46) / 2))));
    root.style.setProperty('--dk-sb-g', String(dk.sbG));
  }, [dk.desktop, dk.shellG, dk.sbG]);

  useEffect(() => {
    if (!token) { setOpen(null); return undefined; }
    let live = true;
    tablesApi.availability()
      .then((a) => { if (live) setOpen(!!(a && a.on)); })
      .catch((e) => {
        if (!live) return;
        // An expired or revoked session: back to the sign-in.
        if (e.status === 401 || e.status === 403) { write('token', null); setToken(null); } else setOpen(false);
      });
    return () => { live = false; };
  }, [token]);

  const signIn = (d) => {
    const who = d.realName || d.username || '';
    write('token', d.token); write('playName', who);
    setName(who); setToken(d.token);
  };
  const signOut = () => {
    fetch(`${API_URL}/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
    write('token', null); write('playName', null);
    setToken(null); setOpen(null);
  };

  return (
    <div className={'app-shell play-shell' + (dk.desktop ? ' is-desktop' : '')}>
      <header className="play-top hs-view">
        <span className="play-mark hs-t" style={T(4)}>futurega.me <span className="play-mark-sub">play</span></span>
        {token && <button type="button" className="hs-btn play-out" onClick={signOut}><span className="hs-t" style={T(3)}>Sign out</span></button>}
      </header>
      <main className="play-main">
        {!token && <SignIn onIn={signIn} />}
        {token && open === null && <div className="hs-view rd-setup tb-lobby"><div className="hs-t hs-sm hs-mut" style={T(3)}>Opening…</div></div>}
        {token && open === false && (
          <div className="hs-view rd-setup tb-lobby">
            <h2 className="screen-title hs-t hs-title" style={T(4)}>Closed for now</h2>
            <div className="hs-t hs-sm hs-mut rd-wrap">The play-money tables are closed right now. Try again later.</div>
          </div>
        )}
        {token && open === true && <TablesView heroName={name || 'Hero'} cardSplay={cardSplay} />}
      </main>
    </div>
  );
}
