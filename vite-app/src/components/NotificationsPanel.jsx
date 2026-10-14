import React from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import Avatar from './Avatar.jsx';
import { API_URL } from '../utils/api.js';
import { useDisplayName } from '../contexts/DisplayNameContext.jsx';

// A whole 3r disc, so an avatar row is a whole number of r (24px was 3.1r on a phone) and every
// item and its Accept / Decline under it stays on the grid.
const AVATAR_3R = { width: 'calc(var(--subrow) * 3)', height: 'calc(var(--subrow) * 3)' };

export default function NotificationsPanel({ notifications, token, onClose, fetchNotifications, fetchShareBuddies, fetchMyGroups, onEnablePush }) {
  const displayName = useDisplayName();
  const { groupInvites = [], buddyRequests = [], acceptedBuddies = [], swapSuggestions = [] } = notifications || {};
  const isEmpty = groupInvites.length === 0 && buddyRequests.length === 0 && acceptedBuddies.length === 0 && swapSuggestions.length === 0;

  const handleAcceptGroupInvite = async (inviteId) => {
    try {
      const res = await fetch(`${API_URL}/group-invites/${inviteId}/accept`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchNotifications();
        fetchMyGroups();
      }
    } catch {}
  };

  const handleDeclineGroupInvite = async (inviteId) => {
    try {
      const res = await fetch(`${API_URL}/group-invites/${inviteId}/decline`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) fetchNotifications();
    } catch {}
  };

  const handleAcceptBuddy = async (requestId) => {
    try {
      const res = await fetch(`${API_URL}/share-request/${requestId}/accept`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchNotifications();
        fetchShareBuddies();
      }
    } catch {}
  };

  const handleDeclineBuddy = async (requestId) => {
    try {
      const res = await fetch(`${API_URL}/share-request/${requestId}/reject`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchNotifications();
        fetchShareBuddies();
      }
    } catch {}
  };

  const handleSwapRespond = async (id, response) => {
    try {
      const res = await fetch(`${API_URL}/swap-suggest/${id}/respond`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ response })
      });
      if (res.ok) fetchNotifications();
    } catch {}
  };

  const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const now = new Date();
    const d = new Date(dateStr);
    const diffMs = now - d;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return createPortal(
    <>
      <div className="notif-backdrop" onClick={onClose} />
      {/* Its right edge on the shell's 1g margin. The shell is centred in the window — 37g, or on
          desktop the --dk-shell-n App sets on it — so that edge is half the window less half the
          shell in from the right (the right inset alone put the panel off the g lines there). */}
      <div className="notif-panel" style={{ right: `calc(50% - var(--gu) * ${Number(document.querySelector('.app-shell')?.style.getPropertyValue('--dk-shell-n')) || 37} / 2 + var(--gu))` }}>
        <div className="notif-panel-header">
          <span className="notif-panel-title">Notifications</span>
          {/* The close mark is the icon, not a "×" character: that glyph's ink sits on the math
              axis, below the middle of the box, and an icon's box is its ink. */}
          <button
            className="btn btn-ghost btn-sm notif-close"
            onClick={onClose}
            aria-label="Close"
          ><Icon.x /></button>
        </div>
        {onEnablePush && (
          // Push permission must be requested from a tap — iOS drops a load-time request — so
          // this button, rendered only while permission is still undecided, IS the request path.
          // 1r above and below, 1g in: the 30g x 4r button on the panel's lines.
          <div className="notif-section" style={{ padding: 'var(--subrow) var(--gu)' }}>
            <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={onEnablePush}>
              Enable push notifications on this device
            </button>
          </div>
        )}
        {isEmpty ? (
          <div className="notif-empty">
            <div style={{ width: 'calc(var(--subrow) * 2.5)', height: 'calc(var(--subrow) * 2.5)', margin: '0 auto var(--space-md)', color: 'var(--text-muted)' }}>
              <Icon.check />
            </div>
            All caught up!
          </div>
        ) : (
          <div className="notif-list">
            {groupInvites.length > 0 && (
              <div className="notif-section">
                <div className="notif-section-title">Group Invites</div>
                {groupInvites.map(inv => (
                  <div key={`gi-${inv.id}`} className="notif-item">
                    <div className="notif-item-content">
                      <div className="notif-item-text">
                        <strong>{inv.invited_by_real_name || inv.invited_by_username}</strong>
                        {' invited you to '}
                        <strong>{inv.group_name}</strong>
                      </div>
                      <div className="notif-item-time">{timeAgo(inv.created_at)}</div>
                    </div>
                    <div className="notif-item-actions">
                      <button className="btn btn-primary btn-xs" onClick={() => handleAcceptGroupInvite(inv.id)}>Accept</button>
                      <button className="btn btn-ghost btn-xs" onClick={() => handleDeclineGroupInvite(inv.id)}>Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {buddyRequests.length > 0 && (
              <div className="notif-section">
                <div className="notif-section-title">Connection Requests</div>
                {buddyRequests.map(req => (
                  <div key={`br-${req.id}`} className="notif-item">
                    <div className="notif-item-content">
                      <div className="notif-item-who" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <Avatar src={req.avatar} username={req.username} size={24} style={AVATAR_3R} />
                        <div className="notif-item-text">
                          <strong>{displayName(req)}</strong>
                          {' wants to connect'}
                        </div>
                      </div>
                      <div className="notif-item-time">{timeAgo(req.created_at)}</div>
                    </div>
                    <div className="notif-item-actions">
                      <button className="btn btn-primary btn-xs" onClick={() => handleAcceptBuddy(req.id)}>Accept</button>
                      <button className="btn btn-ghost btn-xs" onClick={() => handleDeclineBuddy(req.id)}>Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {acceptedBuddies.length > 0 && (
              <div className="notif-section">
                <div className="notif-section-title">Recent Activity</div>
                {acceptedBuddies.map(ab => (
                  <div key={`ab-${ab.id}`} className="notif-item notif-item-info">
                    <div className="notif-item-content">
                      <div className="notif-item-who" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <Avatar src={ab.avatar} username={ab.username} size={24} style={AVATAR_3R} />
                        <div className="notif-item-text">
                          <strong>{displayName(ab)}</strong>
                          {' accepted your request'}
                        </div>
                      </div>
                      <div className="notif-item-time">{timeAgo(ab.responded_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {swapSuggestions.length > 0 && (
              <div className="notif-section">
                <div className="notif-section-title">Swap Offers</div>
                {swapSuggestions.map(ss => (
                  <div key={`ss-${ss.id}`} className="notif-item">
                    <div className="notif-item-content">
                      <div className="notif-item-who" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <Avatar src={ss.from_avatar} username={ss.from_username} size={24} style={AVATAR_3R} />
                        <div className="notif-item-text">
                          <strong>{ss.from_real_name || ss.from_username}</strong>
                          {` wants a ${ss.type} \u2014 ${ss.my_pct}%/${ss.their_pct}%`}
                          <div style={{ fontSize: 'calc(var(--gu) * 1.031)', color: 'var(--text-muted)', marginTop: 0 }}>
                            {ss.event_name} {'\u00B7'} {ss.date}
                          </div>
                        </div>
                      </div>
                      <div className="notif-item-time">{timeAgo(ss.created_at)}</div>
                    </div>
                    <div className="notif-item-actions">
                      <button className="btn btn-primary btn-xs" onClick={() => handleSwapRespond(ss.id, 'accepted')}>Accept</button>
                      <button className="btn btn-ghost btn-xs" onClick={() => handleSwapRespond(ss.id, 'declined')}>Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
