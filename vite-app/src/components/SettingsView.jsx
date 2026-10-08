import React, { useState, useRef } from 'react';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { THEME_ORDER, THEME_LABEL, THEME_ICON, SERIF_LABEL, SERIF_STACK, SERIF_ORDER, setDebugNow, getDebugNow, haptic, getStoredSeasonLabel } from '../utils/utils.js';
import { useDisplayName } from '../contexts/DisplayNameContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { SITE_URL, API_URL } from '../utils/api.js';

// Avatars on the r grid (a px size floored the account row to 8.22r). A circle
// can't be whole g AND whole r, so each sits centred in a whole-g cell (CSS).
// The initial is a trimmed block whose baseline lands on the avatar's +3r
// (5r avatar) / +2r (3r avatar) line, the dashboard's seated-initial recipe.
const AVATAR_5R = 'calc(var(--subrow) * 5)';
const AVATAR_3R = 'calc(var(--subrow) * 3)';
const seatedInitial = (baselineR) => ({
  display: 'block', textAlign: 'center', boxSizing: 'border-box',
  paddingTop: `calc(var(--subrow) * ${baselineR} - 1cap)`,
  textBoxTrim: 'trim-both', textBoxEdge: 'cap alphabetic',
});

export default function SettingsView({ username, avatar, realName, nameMode, onToggleNameMode, onAvatarUpload, onAvatarRemove, theme, toggleTheme, contrast, toggleContrast, cardSplay, toggleCardSplay, serifFont, toggleSerifFont, onLogout, onDebugTimeChange, onUpload, uploadError, uploadSuccess, uploadVenue, onUploadVenueChange, shareToken, onGenerateShareToken, onRevokeShareToken, onSendShareRequest, pendingOutgoing, onCancelRequest, shareBuddies, onRemoveBuddy, shareError, shareSuccess, token, onRefreshTournaments, isAdmin, seasonLabel, isGuest }) {
  const toast = useToast();
  const displayName = useDisplayName();
  const [debugInput, setDebugInput] = useState(getDebugNow());
  // Account deletion (App Store 5.1.1(v)): an in-page confirmation, not a
  // dialog, that only arms once the user has typed their own username.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteArmed = !!username && deleteTyped.trim().replace(/^@/, '').toLowerCase() === String(username).toLowerCase();

  const closeDelete = () => { setDeleteOpen(false); setDeleteTyped(''); setDeleteError(''); };
  const confirmDelete = async (e) => {
    if (e) e.preventDefault();
    if (!deleteArmed || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const res = await fetch(`${API_URL}/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: deleteTyped.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.deleted) {
        setDeleteError(data.error || 'Could not delete the account. Please try again.');
        setDeleteBusy(false);
        return;
      }
      haptic(30);
      if (toast?.success) toast.success('Your account has been deleted');
      // The view stays mounted across sign-out, so leave nothing armed behind.
      closeDelete();
      setDeleteBusy(false);
      onLogout();
    } catch {
      setDeleteError('Network error — nothing was deleted. Please try again.');
      setDeleteBusy(false);
    }
  };

  const applyDebugTime = (val) => {
    setDebugInput(val);
    setDebugNow(val);
    if (onDebugTimeChange) onDebugTimeChange(val);
  };

  return (
    <div className="settings-view">

      <div className="settings-section">
        <div className="settings-section-label">Account</div>
        <div className="settings-card">
          <div className="settings-row settings-acct">
            <div className="settings-acct-avatar">
              <Avatar src={avatar} username={username} size={AVATAR_5R} style={avatar ? undefined : seatedInitial(3)} />
            </div>
            <div className="settings-acct-info">
              <div className="settings-acct-name">{realName || username}</div>
              <div className="settings-acct-handle">@{username}</div>
            </div>
            <div className="settings-acct-actions">
              <label className="btn btn-ghost btn-sm settings-btn settings-btn--w7">
                <span>{avatar ? 'Change' : 'Add photo'}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatarUpload} style={{display:'none'}} />
              </label>
              {avatar && (
                <button className="btn btn-ghost btn-sm settings-btn settings-btn--danger" onClick={onAvatarRemove}><span>Remove</span></button>
              )}
            </div>
          </div>
          <div className="settings-row settings-namemode">
            <div className="settings-namemode-text">
              <span className="settings-row-label">Display names</span>
              <p className="settings-help">
                Show {nameMode === 'real' ? 'real names' : 'usernames'} throughout the app
              </p>
            </div>
            <div className="settings-seg">
              <button className={'settings-seg-btn' + (nameMode === 'real' ? ' is-on' : '')} onClick={() => onToggleNameMode('real')}>
                <span>Real</span>
              </button>
              <button className={'settings-seg-btn' + (nameMode === 'username' ? ' is-on' : '')} onClick={() => onToggleNameMode('username')}>
                <span>Username</span>
              </button>
            </div>
          </div>
          <button className="settings-row-btn danger" onClick={onLogout}>
            <span>Sign out</span>
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">Sharing</div>
        <div className="settings-card">
          <div className="settings-row settings-row--stack">
            <span className="settings-row-label">Share link</span>
            <p className="settings-help">
              Anyone with this link can view your schedule &mdash; no account needed.
            </p>
            {shareToken ? (
              <div className="settings-inline-row">
                <input
                  className="settings-debug-input settings-share-input"
                  readOnly
                  value={`${SITE_URL}/shared/${shareToken}`}
                  onClick={e => e.target.select()}
                />
                <button className="btn btn-ghost btn-sm settings-btn" onClick={() => {
                  navigator.clipboard.writeText(`${SITE_URL}/shared/${shareToken}`);
                }}><Icon.copy /><span>Copy</span></button>
                <button className="btn btn-ghost btn-sm settings-btn settings-btn--danger" onClick={onRevokeShareToken}><span>Revoke</span></button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm settings-btn settings-btn--start settings-btn--w14" onClick={onGenerateShareToken}>
                <Icon.link /><span>Generate Share Link</span>
              </button>
            )}
          </div>
          <div className="settings-row settings-row--stack">
            <span className="settings-row-label">Connect with a user</span>
            <p className="settings-help">
              Send a request &mdash; if they accept, you both see each other's schedules.
            </p>
            <form onSubmit={onSendShareRequest} className="settings-inline-row">
              <input className="settings-debug-input settings-share-input" name="shareUsername" placeholder="Enter username" />
              <button type="submit" className="btn btn-ghost btn-sm settings-btn"><span>Send</span></button>
            </form>
            {pendingOutgoing && pendingOutgoing.length > 0 && (
              <div className="settings-people">
                <span className="settings-people-hd">Pending</span>
                {pendingOutgoing.map(r => (
                  <div key={r.id} className="settings-people-item">
                    <span className="settings-people-avatar">
                      <Avatar src={r.avatar} username={r.username} size={AVATAR_3R} style={r.avatar ? undefined : seatedInitial(2)} />
                    </span>
                    <span className="settings-people-name">{displayName(r)}</span>
                    <button className="btn btn-ghost btn-sm settings-btn settings-btn--danger" onClick={() => onCancelRequest(r.id)}><span>Cancel</span></button>
                  </div>
                ))}
              </div>
            )}
            {shareBuddies && shareBuddies.length > 0 && (
              <div className="settings-people">
                <span className="settings-people-hd">Connected</span>
                {shareBuddies.map(b => (
                  <div key={b.id} className="settings-people-item">
                    <span className="settings-people-avatar">
                      <Avatar src={b.avatar} username={b.username} size={AVATAR_3R} style={b.avatar ? undefined : seatedInitial(2)} />
                    </span>
                    <span className="settings-people-name">{displayName(b)}</span>
                    <button className="btn btn-ghost btn-sm settings-btn settings-btn--danger" onClick={() => onRemoveBuddy(b.id)}><span>Remove</span></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">Appearance</div>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row-label">Theme</span>
            <button className="btn btn-ghost btn-sm settings-btn settings-btn--icon" onClick={toggleTheme}>
              {React.createElement(Icon[THEME_ICON[theme]] || Icon.moon, {key: theme})}
              <span>{THEME_LABEL[theme]}</span>
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">High contrast</span>
            <button
              className={`settings-toggle ${contrast === 'high' ? 'on' : ''}`}
              onClick={toggleContrast}
            />
          </div>
          <div className="settings-row settings-row--stack">
            <span className="settings-row-label">Display font</span>
            {/* Each tile renders the WORDMARK in its own stack, so you see what
                you are switching TO. The old control previewed the font you
                already had. */}
            <div className="font-pick">
              {/* The parent exposes a cycle, not a setter, so a tile toggles when
                  it is not already active. That is exact while SERIF_ORDER holds
                  two faces; a third would need a real setter. */}
              {SERIF_ORDER.map(key => (
                <button
                  key={key}
                  type="button"
                  className={'font-pick-tile' + (serifFont === key ? ' is-on' : '')}
                  aria-pressed={serifFont === key}
                  onClick={() => { if (serifFont !== key) toggleSerifFont(); }}
                  style={{ fontFamily: SERIF_STACK[key] }}
                >
                  <span className="font-pick-word">futurega.me</span>
                  <i>{SERIF_LABEL[key]}</i>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {isAdmin && (
      <div className="settings-section">
        <div className="settings-section-label">Debug Tools</div>
        <div className="settings-card">
          <div className="settings-row settings-row--stack">
            <span className="settings-row-label">Simulated date &amp; time</span>
            <input
              className="settings-debug-input"
              type="datetime-local"
              value={debugInput ? debugInput.slice(0,16) : ''}
              onChange={e => {
                const v = e.target.value ? e.target.value + ':00' : '';
                applyDebugTime(v);
              }}
            />
            {debugInput && (
              <button
                className="btn btn-ghost btn-sm settings-btn settings-btn--start settings-btn--w12"
                onClick={() => applyDebugTime('')}
              ><span>Reset to real time</span></button>
            )}
          </div>
        </div>
      </div>
      )}

      {!isGuest && username && (
      <div className="settings-section">
        <div className="settings-section-label">Delete account</div>
        <div className="settings-card">
          {!deleteOpen ? (
            <button className="settings-row-btn danger" onClick={() => setDeleteOpen(true)}>
              <span>Delete account</span>
            </button>
          ) : (
            <form className="settings-row settings-row--stack" onSubmit={confirmDelete}>
              <span className="settings-row-label">Delete your account permanently?</span>
              <p className="settings-help">
                Your schedules, saved hands, results, staking records, buddies and the
                groups you own are removed for good. This cannot be undone.
              </p>
              <p className="settings-help">Type <b>{username}</b> to confirm.</p>
              <input
                className="settings-debug-input"
                value={deleteTyped}
                onChange={e => setDeleteTyped(e.target.value)}
                placeholder={username}
                aria-label="Type your username to confirm"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={deleteBusy}
              />
              {deleteError && <p className="settings-help settings-help--danger" role="alert">{deleteError}</p>}
              <div className="settings-inline-row">
                <button type="button" className="btn btn-ghost btn-sm settings-btn" onClick={closeDelete} disabled={deleteBusy}>
                  <span>Cancel</span>
                </button>
                <button type="submit" className="btn btn-sm settings-btn settings-btn--destroy" disabled={!deleteArmed || deleteBusy}>
                  <span>{deleteBusy ? 'Deleting…' : 'Delete account'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
      )}

      <div className="settings-section">
        <div className="settings-about">
          <h3>futurega.me</h3>
          <p>{seasonLabel || getStoredSeasonLabel()} &mdash; wsop tournament scheduler</p>
          <p className="settings-about-ver">v0.1.0</p>
        </div>
      </div>

    </div>
  );
}
