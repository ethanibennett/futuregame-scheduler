import React, { useState, useRef } from 'react';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { THEME_ORDER, THEME_LABEL, THEME_ICON, SERIF_LABEL, SERIF_STACK, SERIF_ORDER, setDebugNow, getDebugNow, haptic, getStoredSeasonLabel } from '../utils/utils.js';
import { useDisplayName } from '../contexts/DisplayNameContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { SITE_URL } from '../utils/api.js';

export default function SettingsView({ username, avatar, realName, nameMode, onToggleNameMode, onAvatarUpload, onAvatarRemove, theme, toggleTheme, contrast, toggleContrast, cardSplay, toggleCardSplay, serifFont, toggleSerifFont, onLogout, onDebugTimeChange, onUpload, uploadError, uploadSuccess, uploadVenue, onUploadVenueChange, shareToken, onGenerateShareToken, onRevokeShareToken, onSendShareRequest, pendingOutgoing, onCancelRequest, shareBuddies, onRemoveBuddy, shareError, shareSuccess, token, onRefreshTournaments, isAdmin, seasonLabel }) {
  const toast = useToast();
  const displayName = useDisplayName();
  const [debugInput, setDebugInput] = useState(getDebugNow());

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
            <Avatar src={avatar} username={username} size={48} />
            <div className="settings-acct-info">
              <div className="settings-acct-name">{realName || username}</div>
              <div className="settings-acct-handle">@{username}</div>
            </div>
            <div className="settings-acct-actions">
              <label className="btn btn-ghost btn-sm settings-btn">
                {avatar ? 'Change' : 'Add photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatarUpload} style={{display:'none'}} />
              </label>
              {avatar && (
                <button className="btn btn-ghost btn-sm settings-btn settings-btn--danger" onClick={onAvatarRemove}>Remove</button>
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
                Real
              </button>
              <button className={'settings-seg-btn' + (nameMode === 'username' ? ' is-on' : '')} onClick={() => onToggleNameMode('username')}>
                Username
              </button>
            </div>
          </div>
          <button className="settings-row-btn danger" onClick={onLogout}>
            Sign out
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
                }}><Icon.copy /> Copy</button>
                <button className="btn btn-ghost btn-sm settings-btn settings-btn--danger" onClick={onRevokeShareToken}>Revoke</button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm settings-btn settings-btn--start" onClick={onGenerateShareToken}>
                <Icon.link /> Generate Share Link
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
              <button type="submit" className="btn btn-ghost btn-sm settings-btn">Send</button>
            </form>
            {pendingOutgoing && pendingOutgoing.length > 0 && (
              <div className="settings-people">
                <span className="settings-people-hd">Pending</span>
                {pendingOutgoing.map(r => (
                  <div key={r.id} className="settings-people-item">
                    <span className="settings-people-name">
                      <Avatar src={r.avatar} username={r.username} size={24} />
                      {displayName(r)}
                    </span>
                    <button className="btn btn-ghost btn-sm settings-btn settings-btn--danger" onClick={() => onCancelRequest(r.id)}>Cancel</button>
                  </div>
                ))}
              </div>
            )}
            {shareBuddies && shareBuddies.length > 0 && (
              <div className="settings-people">
                <span className="settings-people-hd">Connected</span>
                {shareBuddies.map(b => (
                  <div key={b.id} className="settings-people-item">
                    <span className="settings-people-name">
                      <Avatar src={b.avatar} username={b.username} size={24} />
                      {displayName(b)}
                    </span>
                    <button className="btn btn-ghost btn-sm settings-btn settings-btn--danger" onClick={() => onRemoveBuddy(b.id)}>Remove</button>
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
              {THEME_LABEL[theme]}
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
                  futurega.me
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
                className="btn btn-ghost btn-sm settings-btn settings-btn--start"
                onClick={() => applyDebugTime('')}
              >Reset to real time</button>
            )}
          </div>
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
