import React, { useEffect, useState, useCallback } from 'react';
import { API_URL } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { moneyHidden, setMoneyHidden } from '../utils/hide-money.js';
import { lockAvailability, lockSettings, saveLockSettings, biometryName } from '../utils/app-lock.js';
import Icon from './Icon.jsx';

/* Settings sections the Features catalogue added (2026-11-11): Notifications (39), the account's email,
   password and devices (42), Privacy (43, 44), the invite link (37) and the people blocked (38), and
   Your data (45). Each loads its own data, so Settings opens at once and a failed load stays local. */

const authHdr = (token, json) => ({ Authorization: 'Bearer ' + token, ...(json ? { 'Content-Type': 'application/json' } : {}) });
const when = (ms) => {
  if (!ms) return '';
  const d = Date.now() - ms;
  if (d < 120e3) return 'now';
  if (d < 3600e3) return `${Math.round(d / 60e3)} min ago`;
  if (d < 86400e3) return `${Math.round(d / 3600e3)} h ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function Toggle({ on, onClick, label, disabled = false }) {
  return <button type="button" className={'settings-toggle' + (on ? ' on' : '')} role="switch" aria-checked={!!on} aria-label={label} onClick={onClick} disabled={disabled} />;
}

/* ── Notifications (39) ──────────────────────────────────────────────────── */
export function NotificationsSection({ token, pushPerm, onEnablePush }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    fetch(`${API_URL}/notification-prefs`, { headers: authHdr(token) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData, () => setFailed(true));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  const set = async (kind, value) => {
    setData((d) => d && ({ ...d, prefs: { ...d.prefs, [kind]: value } }));
    // Turning the first one on asks the system for permission, from this tap (iOS drops a load-time ask).
    if (value !== 'off' && pushPerm === 'default' && onEnablePush) onEnablePush();
    try {
      const r = await fetch(`${API_URL}/notification-prefs`, { method: 'PUT', headers: authHdr(token, true), body: JSON.stringify({ kind, value }) });
      if (r.ok) { const j = await r.json(); setData((d) => d && ({ ...d, prefs: j.prefs })); }
      else load();
    } catch { load(); }
  };
  return (
    <div className="settings-section">
      <div className="settings-section-label">Notifications</div>
      <div className="settings-card">
        {failed && (
          <div className="settings-row settings-row--stack">
            <span className="settings-row-label">Could not load your switches</span>
            <button type="button" className="btn btn-ghost btn-sm settings-btn settings-btn--start settings-btn--w7" onClick={load}><span>Try again</span></button>
          </div>
        )}
        {!failed && !data && <div className="settings-row"><span className="settings-row-label settings-muted">Loading…</span></div>}
        {data && (
          <>
            {pushPerm === 'denied' && (
              <div className="settings-row settings-row--stack">
                <span className="settings-row-label">This device does not allow notifications</span>
                <p className="settings-help">Turn them on for futurega.me in the device’s settings; these switches say which kinds come through.</p>
              </div>
            )}
            {data.kinds.map((k) => (
              k.values.length === 2 ? (
                <div key={k.kind} className="settings-row">
                  <span className="settings-row-label">{k.label}</span>
                  <Toggle on={data.prefs[k.kind] === 'on'} label={k.label} onClick={() => set(k.kind, data.prefs[k.kind] === 'on' ? 'off' : 'on')} />
                </div>
              ) : (
                <div key={k.kind} className="settings-row settings-namemode">
                  <div className="settings-namemode-text">
                    <span className="settings-row-label">{k.label}</span>
                    <p className="settings-help">{data.prefs.mutedGroups.length ? `${data.prefs.mutedGroups.length} group${data.prefs.mutedGroups.length === 1 ? '' : 's'} muted; hold a message to mute one` : 'Hold a message in a group to mute that group'}</p>
                  </div>
                  <div className="settings-seg settings-seg--3" role="radiogroup" aria-label={k.label}>
                    {k.values.map((v) => (
                      <button key={v} type="button" role="radio" aria-checked={data.prefs[k.kind] === v}
                        className={'settings-seg-btn' + (data.prefs[k.kind] === v ? ' is-on' : '')} onClick={() => set(k.kind, v)}>
                        <span>{v === 'all' ? 'All' : v === 'mentions' ? '@ me' : 'Off'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Email, password, devices (42) ───────────────────────────────────────── */
export function AccountSecurityRows({ token, onToken }) {
  const toast = useToast();
  const [sec, setSec] = useState(null);
  const [open, setOpen] = useState(null);   // 'email' | 'password' | null
  const [f, setF] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetch(`${API_URL}/account/security`, { headers: authHdr(token) }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setSec(d)).catch(() => {});
  }, [token]);
  useEffect(() => { load(); }, [load]);
  // Back from the confirmation link: "#/settings?email=changed".
  useEffect(() => {
    const m = /[?&]email=(changed|expired|taken)/.exec(window.location.hash || '');
    if (!m) return;
    if (toast) {
      if (m[1] === 'changed') toast.success('Your email is changed');
      else toast.error(m[1] === 'taken' ? 'That address now belongs to another account' : 'That link has expired. Ask for a new one.');
    }
    try { window.history.replaceState(window.history.state, '', window.location.pathname + '#/settings'); } catch { /* sandboxed */ }
  }, [toast]);
  const close = () => { setOpen(null); setF({}); setErr(''); };
  const post = async (method, path, body) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_URL}${path}`, { method, headers: authHdr(token, true), body: JSON.stringify(body || {}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || `It did not work (${r.status})`); return null; }
      return d;
    } catch { setErr('No connection. Nothing changed.'); return null; }
    finally { setBusy(false); }
  };
  const saveEmail = async (e) => {
    e.preventDefault();
    const d = await post('POST', '/account/email', { email: f.email, password: f.password });
    if (d) { close(); load(); if (toast) toast.success(`Open the link we sent to ${d.pendingEmail}`); }
  };
  const savePassword = async (e) => {
    e.preventDefault();
    if ((f.next || '') !== (f.again || '')) { setErr('The two new passwords differ'); return; }
    const d = await post('PUT', '/account/password', { current: f.current, next: f.next });
    if (d && d.token) { onToken && onToken(d.token); close(); load(); if (toast) toast.success('Password changed. Other devices are signed out.'); }
  };
  const signOutOthers = async () => {
    const d = await post('POST', '/account/sessions/sign-out-others', {});
    if (d && d.token) { onToken && onToken(d.token); load(); if (toast) toast.success('Every other device is signed out'); }
  };
  const endOne = async (id) => { if (await post('DELETE', `/account/sessions/${id}`)) load(); };
  if (!sec) return null;
  const others = sec.sessions.filter((s) => !s.current);
  return (
    <>
      <div className="settings-row settings-row--stack">
        <div className="settings-inline-row settings-spread">
          <span className="settings-row-label">Email</span>
          {open !== 'email' && <button type="button" className="btn btn-ghost btn-sm settings-btn" onClick={() => { close(); setOpen('email'); }}><span>Change</span></button>}
        </div>
        <p className="settings-help">{sec.email}{sec.pendingEmail ? ` · waiting for ${sec.pendingEmail} to be confirmed` : ''}</p>
        {open === 'email' && (
          <form className="settings-form" onSubmit={saveEmail}>
            <input className="settings-debug-input" type="email" placeholder="New email" autoComplete="email" required value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <input className="settings-debug-input" type="password" placeholder="Your password" autoComplete="current-password" required value={f.password || ''} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <p className="settings-help">The new address takes over once you open the link we send to it.</p>
            {err && <p className="settings-help settings-help--danger" role="alert">{err}</p>}
            <div className="settings-inline-row">
              <button type="button" className="btn btn-ghost btn-sm settings-btn" onClick={close} disabled={busy}><span>Cancel</span></button>
              <button type="submit" className="btn btn-primary btn-sm settings-btn settings-btn--w7" disabled={busy}><span>{busy ? 'Sending…' : 'Send link'}</span></button>
            </div>
          </form>
        )}
      </div>
      <div className="settings-row settings-row--stack">
        <div className="settings-inline-row settings-spread">
          <span className="settings-row-label">Password</span>
          {open !== 'password' && <button type="button" className="btn btn-ghost btn-sm settings-btn" onClick={() => { close(); setOpen('password'); }}><span>Change</span></button>}
        </div>
        {open === 'password' && (
          <form className="settings-form" onSubmit={savePassword}>
            <input className="settings-debug-input" type="password" placeholder="Current password" autoComplete="current-password" required value={f.current || ''} onChange={(e) => setF({ ...f, current: e.target.value })} />
            <input className="settings-debug-input" type="password" placeholder="New password, 8 or more characters" autoComplete="new-password" minLength={8} required value={f.next || ''} onChange={(e) => setF({ ...f, next: e.target.value })} />
            <input className="settings-debug-input" type="password" placeholder="New password again" autoComplete="new-password" minLength={8} required value={f.again || ''} onChange={(e) => setF({ ...f, again: e.target.value })} />
            <p className="settings-help">Every other device is signed out; this one stays in.</p>
            {err && <p className="settings-help settings-help--danger" role="alert">{err}</p>}
            <div className="settings-inline-row">
              <button type="button" className="btn btn-ghost btn-sm settings-btn" onClick={close} disabled={busy}><span>Cancel</span></button>
              <button type="submit" className="btn btn-primary btn-sm settings-btn settings-btn--w7" disabled={busy}><span>{busy ? 'Saving…' : 'Save'}</span></button>
            </div>
          </form>
        )}
      </div>
      <div className="settings-row settings-row--stack">
        <span className="settings-row-label">{`Signed in on ${sec.sessions.length || 1} device${(sec.sessions.length || 1) === 1 ? '' : 's'}`}</span>
        <div className="settings-people">
          {sec.sessions.map((s) => (
            <div key={s.id} className="settings-people-item settings-device">
              <span className="settings-people-name">{s.device}{s.current ? ' · this device' : ` · ${when(s.lastSeen)}`}</span>
              {!s.current && <button type="button" className="btn btn-ghost btn-sm settings-btn settings-btn--danger" onClick={() => endOne(s.id)} disabled={busy}><span>Sign out</span></button>}
            </div>
          ))}
        </div>
        {!sec.currentListed && <p className="settings-help">Sign-ins from before this list began are not shown; Sign out others ends them too.</p>}
        {(others.length > 0 || !sec.currentListed) && (
          <button type="button" className="btn btn-ghost btn-sm settings-btn settings-btn--start settings-btn--w12" onClick={signOutOthers} disabled={busy}><span>Sign out others</span></button>
        )}
      </div>
    </>
  );
}

/* ── Privacy: hide money (44) and the app lock (43) ──────────────────────── */
export function PrivacySection() {
  const [hidden, setHidden] = useState(moneyHidden);
  const [avail, setAvail] = useState(null);
  const [lock, setLock] = useState(lockSettings);
  useEffect(() => { lockAvailability().then(setAvail); }, []);
  const saveLock = (next) => { setLock(next); saveLockSettings(next); };
  const bio = avail ? biometryName(avail.biometry) : '';
  return (
    <div className="settings-section">
      <div className="settings-section-label">Privacy</div>
      <div className="settings-card">
        <div className="settings-row settings-namemode">
          <div className="settings-namemode-text">
            <span className="settings-row-label">Hide money</span>
            <p className="settings-help">Results and balances show as $••• on this device. Hold one to see it.</p>
          </div>
          <Toggle on={hidden} label="Hide money" onClick={() => { setMoneyHidden(!hidden); setHidden(!hidden); }} />
        </div>
        {avail && avail.available && (
          <>
            <div className="settings-row settings-namemode">
              <div className="settings-namemode-text">
                <span className="settings-row-label">{`Lock with ${bio}`}</span>
                <p className="settings-help">The app asks for {bio} when it opens and after time away.</p>
              </div>
              <Toggle on={lock.on} label={`Lock with ${bio}`} onClick={() => saveLock({ ...lock, on: !lock.on })} />
            </div>
            {lock.on && (
              <div className="settings-row settings-namemode">
                <div className="settings-namemode-text">
                  <span className="settings-row-label">After time away</span>
                </div>
                <div className="settings-seg settings-seg--3" role="radiogroup" aria-label="Lock after">
                  {[1, 5, 15].map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={lock.after === m}
                      className={'settings-seg-btn' + (lock.after === m ? ' is-on' : '')} onClick={() => saveLock({ ...lock, after: m })}>
                      <span>{`${m} min`}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── The invite link (37) ────────────────────────────────────────────────── */
export function InviteRow({ token, onShowCode }) {
  const toast = useToast();
  const [inv, setInv] = useState(null);
  const load = useCallback(() => {
    fetch(`${API_URL}/invite`, { headers: authHdr(token) }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setInv(d)).catch(() => {});
  }, [token]);
  useEffect(() => { load(); }, [load]);
  const rotate = async () => {
    const r = await fetch(`${API_URL}/invite/rotate`, { method: 'POST', headers: authHdr(token) }).catch(() => null);
    if (r && r.ok) { setInv(await r.json()); if (toast) toast.success('New link made; the old one no longer works'); }
  };
  return (
    <div className="settings-row settings-row--stack">
      <span className="settings-row-label">Invite link</span>
      <p className="settings-help">A friend who signs up from it is connected to you and opens on your week.</p>
      {inv && (
        <div className="settings-inline-row">
          <input className="settings-debug-input settings-share-input" readOnly value={inv.url} onClick={(e) => e.target.select()} />
          <button type="button" className="btn btn-ghost btn-sm settings-btn" onClick={() => { navigator.clipboard.writeText(inv.url).then(() => toast && toast.success('Invite link copied'), () => {}); }}><Icon.copy /><span>Copy</span></button>
        </div>
      )}
      <div className="settings-inline-row">
        {onShowCode && <button type="button" className="btn btn-ghost btn-sm settings-btn settings-btn--w7" onClick={onShowCode}><span>Show code</span></button>}
        <button type="button" className="btn btn-ghost btn-sm settings-btn settings-btn--w7" onClick={rotate}><span>New link</span></button>
      </div>
    </div>
  );
}

/* ── People blocked (38) ─────────────────────────────────────────────────── */
export function BlockedRow({ token, onChange }) {
  const [list, setList] = useState([]);
  const load = useCallback(() => {
    fetch(`${API_URL}/blocks`, { headers: authHdr(token) }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setList(d.blocked || [])).catch(() => {});
  }, [token]);
  useEffect(() => { load(); }, [load]);
  if (!list.length) return null;
  const unblock = async (id) => {
    await fetch(`${API_URL}/blocks/${id}`, { method: 'DELETE', headers: authHdr(token) }).catch(() => {});
    load();
    if (onChange) onChange();
  };
  return (
    <div className="settings-row settings-row--stack">
      <span className="settings-row-label">Blocked</span>
      <p className="settings-help">They cannot find you, message you or see your schedule. They are not told.</p>
      <div className="settings-people">
        {list.map((u) => (
          <div key={u.id} className="settings-people-item">
            <span className="settings-people-name">{u.real_name || u.username}</span>
            <button type="button" className="btn btn-ghost btn-sm settings-btn settings-btn--w7" onClick={() => unblock(u.id)}><span>Unblock</span></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Your data (45) ──────────────────────────────────────────────────────── */
export function DataSection({ token }) {
  const [state, setState] = useState({ phase: 'idle' });
  const [pw, setPw] = useState('');
  const prepare = async (e) => {
    e.preventDefault();
    setState({ phase: 'busy' });
    try {
      const r = await fetch(`${API_URL}/account/export`, { method: 'POST', headers: authHdr(token, true), body: JSON.stringify({ password: pw }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setState({ phase: 'ask', error: d.error || `It did not work (${r.status})` }); return; }
      setPw('');
      // The link is the server's path; the native app's API lives on futurega.me, not in the app.
      setState({ phase: 'ready', url: API_URL.replace(/\/api$/, '') + d.url, size: d.bytes, files: d.files });
    } catch { setState({ phase: 'ask', error: 'No connection. Please try again.' }); }
  };
  const open = (url) => {
    // A native app hands the file to the system browser, which saves it; the web downloads it in place.
    const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (native) window.open(url, '_system'); else window.location.assign(url);
  };
  return (
    <div className="settings-section">
      <div className="settings-section-label">Your data</div>
      <div className="settings-card">
        <div className="settings-row settings-row--stack">
          <span className="settings-row-label">Download everything</span>
          <p className="settings-help">One ZIP: My Schedule and results as CSV, the bankroll’s ledger, every saved hand as JSON and as hand-history text where the game has one. It holds backers’ names; keep it safe.</p>
          {state.phase === 'idle' && (
            <button type="button" className="btn btn-ghost btn-sm settings-btn settings-btn--start settings-btn--w7" onClick={() => setState({ phase: 'ask' })}><span>Prepare</span></button>
          )}
          {(state.phase === 'ask' || state.phase === 'busy') && (
            <form className="settings-form" onSubmit={prepare}>
              <input className="settings-debug-input" type="password" placeholder="Your password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} disabled={state.phase === 'busy'} />
              {state.error && <p className="settings-help settings-help--danger" role="alert">{state.error}</p>}
              <div className="settings-inline-row">
                <button type="button" className="btn btn-ghost btn-sm settings-btn" onClick={() => setState({ phase: 'idle' })} disabled={state.phase === 'busy'}><span>Cancel</span></button>
                <button type="submit" className="btn btn-primary btn-sm settings-btn settings-btn--w7" disabled={state.phase === 'busy'}><span>{state.phase === 'busy' ? 'Preparing…' : 'Prepare'}</span></button>
              </div>
            </form>
          )}
          {state.phase === 'ready' && (
            <>
              <p className="settings-help">{`Ready: ${state.files} files, ${Math.max(1, Math.round(state.size / 1024))} KB. The link lasts 24 hours.`}</p>
              <button type="button" className="btn btn-primary btn-sm settings-btn settings-btn--start settings-btn--w7" onClick={() => open(state.url)}><span>Download</span></button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
