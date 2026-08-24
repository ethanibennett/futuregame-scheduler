import React, { useState, useRef } from 'react';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { THEME_ORDER, THEME_LABEL, THEME_ICON, SERIF_LABEL, SERIF_STACK, SERIF_ORDER, setDebugNow, getDebugNow, haptic, getStoredSeasonLabel } from '../utils/utils.js';
import { useDisplayName } from '../contexts/DisplayNameContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

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
          <div className="settings-row" style={{gap:'12px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'12px',flex:1}}>
              <Avatar src={avatar} username={username} size={44} />
              <div>
                <div style={{fontSize:'0.85rem',fontWeight: 'var(--fw-bold)',color:'var(--text)'}}>{realName || username}</div>
                <div style={{fontSize:'0.7rem',color:'var(--text-muted)',marginTop:'2px'}}>@{username}</div>
              </div>
            </div>
            <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
              <label className="btn btn-ghost btn-sm" style={{cursor:'pointer',fontSize:'0.75rem',padding:'4px 10px'}}>
                {avatar ? 'Change' : 'Add photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatarUpload} style={{display:'none'}} />
              </label>
              {avatar && (
                <button className="btn btn-ghost btn-sm" style={{color:'var(--danger)',fontSize:'0.75rem',padding:'4px 10px'}} onClick={onAvatarRemove}>Remove</button>
              )}
            </div>
          </div>
          <div className="settings-row" style={{justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <span className="settings-row-label">Display names</span>
              <p style={{fontSize:'0.72rem',color:'var(--text-muted)',margin:'2px 0 0'}}>
                Show {nameMode === 'real' ? 'real names' : 'usernames'} throughout the app
              </p>
            </div>
            <div style={{display:'flex',gap:'4px',background:'var(--bg)',borderRadius:'6px',padding:'2px'}}>
              <button onClick={() => onToggleNameMode('real')}
                style={{padding:'4px 10px',borderRadius:'5px',border:'none',cursor:'pointer',fontSize:'0.72rem',fontWeight: 'var(--fw-bold)',
                  background: nameMode === 'real' ? 'var(--accent)' : 'transparent',
                  color: nameMode === 'real' ? '#000' : 'var(--text-muted)'}}>
                Real
              </button>
              <button onClick={() => onToggleNameMode('username')}
                style={{padding:'4px 10px',borderRadius:'5px',border:'none',cursor:'pointer',fontSize:'0.72rem',fontWeight: 'var(--fw-bold)',
                  background: nameMode === 'username' ? 'var(--accent)' : 'transparent',
                  color: nameMode === 'username' ? '#000' : 'var(--text-muted)'}}>
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
          <div className="settings-row" style={{flexDirection:'column',alignItems:'stretch',gap:'8px'}}>
            <span className="settings-row-label">Share link</span>
            <p style={{fontSize:'0.75rem',color:'var(--text-muted)',lineHeight:1.4}}>
              Anyone with this link can view your schedule &mdash; no account needed.
            </p>
            {shareToken ? (
              <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
                <input
                  className="settings-debug-input"
                  readOnly
                  value={`${window.location.origin}/shared/${shareToken}`}
                  style={{flex:1,fontSize:'0.72rem',minWidth:0}}
                  onClick={e => e.target.select()}
                />
                <button className="btn btn-ghost btn-sm" style={{display:'inline-flex',alignItems:'center',gap:'4px'}} onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/shared/${shareToken}`);
                }}><Icon.copy /> Copy</button>
                <button className="btn btn-ghost btn-sm" style={{color:'var(--danger)'}} onClick={onRevokeShareToken}>Revoke</button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" style={{alignSelf:'flex-start',display:'inline-flex',alignItems:'center',gap:'6px'}} onClick={onGenerateShareToken}>
                <Icon.link /> Generate Share Link
              </button>
            )}
          </div>
          <div style={{borderTop:'1px solid var(--border)'}} />
          <div className="settings-row" style={{flexDirection:'column',alignItems:'stretch',gap:'8px'}}>
            <span className="settings-row-label">Connect with a user</span>
            <p style={{fontSize:'0.75rem',color:'var(--text-muted)',lineHeight:1.4}}>
              Send a request &mdash; if they accept, you both see each other's schedules.
            </p>
            <form onSubmit={onSendShareRequest} style={{display:'flex',gap:'6px'}}>
              <input className="settings-debug-input" name="shareUsername" placeholder="Enter username" style={{flex:1}} />
              <button type="submit" className="btn btn-ghost btn-sm">Send</button>
            </form>
            {pendingOutgoing && pendingOutgoing.length > 0 && (
              <div style={{marginTop:'4px'}}>
                <span style={{fontSize:'0.7rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Pending</span>
                {pendingOutgoing.map(r => (
                  <div key={r.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                    padding:'6px 0',borderBottom:'1px solid var(--border)',fontSize:'0.82rem',color:'var(--text)'}}>
                    <span style={{display:'flex',alignItems:'center',gap:'8px',color:'var(--text-muted)'}}>
                      <Avatar src={r.avatar} username={r.username} size={22} />
                      {displayName(r)}
                    </span>
                    <button className="btn btn-ghost btn-sm" style={{color:'var(--danger)',padding:'4px 8px'}} onClick={() => onCancelRequest(r.id)}>Cancel</button>
                  </div>
                ))}
              </div>
            )}
            {shareBuddies && shareBuddies.length > 0 && (
              <div style={{marginTop:'8px'}}>
                <span style={{fontSize:'0.7rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Connected</span>
                {shareBuddies.map(b => (
                  <div key={b.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                    padding:'6px 0',borderBottom:'1px solid var(--border)',fontSize:'0.82rem',color:'var(--text)'}}>
                    <span style={{display:'flex',alignItems:'center',gap:'8px'}}>
                      <Avatar src={b.avatar} username={b.username} size={22} />
                      {displayName(b)}
                    </span>
                    <button className="btn btn-ghost btn-sm" style={{color:'var(--danger)',padding:'4px 8px'}} onClick={() => onRemoveBuddy(b.id)}>Remove</button>
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
            <button
              className="btn btn-ghost btn-sm"
              onClick={toggleTheme}
              style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'13px',padding:'4px 10px',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)'}}
            >
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
          <div className="settings-row" style={{flexDirection:'column',alignItems:'stretch',gap:'8px'}}>
            <span className="settings-row-label">Simulated date & time</span>
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
                className="btn btn-ghost btn-sm"
                style={{alignSelf:'flex-start',marginTop:'4px'}}
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
          <p style={{marginTop:'8px',fontSize:'0.7rem',opacity:0.5}}>v0.1.0</p>
        </div>
      </div>

    </div>
  );
}
