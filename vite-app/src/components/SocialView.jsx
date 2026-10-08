import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar.jsx';
import { API_URL } from '../utils/api.js';
import { getVenueInfo, getVenueBrandColor, normaliseDate, getToday, formatBuyin, formatLiveUpdate, parseTournamentTime } from '../utils/utils.js';

// Avatars on the r grid (a px size floored each card to 7.18r): 5r, centred in
// a 4g cell (a circle can't be whole g and whole r), the initial a trimmed
// block with its baseline on the avatar's +3r — the dashboard's recipe.
const AVATAR_5R = 'calc(var(--subrow) * 5)';
const AVATAR_3R = 'calc(var(--subrow) * 3)';
const seatedInitial = (baselineR) => ({
  display: 'block', textAlign: 'center', boxSizing: 'border-box',
  paddingTop: `calc(var(--subrow) * ${baselineR} - 1cap)`,
  textBoxTrim: 'trim-both', textBoxEdge: 'cap alphabetic',
});
// Initial baselines: 5r avatar +3r, 3r avatar +2r (cap 0.94r, centred).
const SEATED_INITIAL_5R = seatedInitial(3);
const SEATED_INITIAL_3R = seatedInitial(2);

// ── Create Group Modal ──────────────────────────────────────
function CreateGroupModal({ shareBuddies, displayName, token, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) { setError('Group name is required'); return; }
    setLoading(true);
    setError('');
    try {
      const createRes = await fetch(`${API_URL}/groups`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });
      if (!createRes.ok) {
        const d = await createRes.json();
        setError(d.error || 'Failed to create group');
        setLoading(false);
        return;
      }
      const { id: groupId } = await createRes.json();

      // Send invites to selected buddies
      let inviteCount = 0;
      for (const buddy of shareBuddies) {
        if (selected.has(buddy.id)) {
          const invRes = await fetch(`${API_URL}/groups/${groupId}/members`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: buddy.username })
          });
          if (invRes.ok) inviteCount++;
        }
      }

      onCreated(inviteCount);
    } catch {
      setError('Something went wrong');
    }
    setLoading(false);
  };

  const toggleBuddy = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="create-group-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="create-group-panel">
        <div className="create-group-header">
          <h3 className="create-group-title">Create Group</h3>
          <button className="create-group-close" onClick={onClose} aria-label="Close"><span>&#x2715;</span></button>
        </div>

        <label className="create-group-label">Group Name</label>
        <input
          className="create-group-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Vegas Crew"
          maxLength={40}
          autoFocus
        />

        {shareBuddies.length > 0 && (
          <React.Fragment>
            <label className="create-group-label create-group-label--gap">Add Members</label>
            <div className="create-group-buddies">
              {shareBuddies.map(b => (
                <button
                  key={b.id}
                  className={`create-group-buddy-btn${selected.has(b.id) ? ' selected' : ''}`}
                  onClick={() => toggleBuddy(b.id)}
                >
                  <span className="create-group-buddy-avatar">
                    <Avatar src={b.avatar} username={b.username} size={AVATAR_3R} style={b.avatar ? undefined : SEATED_INITIAL_3R} />
                  </span>
                  <span className="create-group-buddy-name">{displayName(b)}</span>
                  {selected.has(b.id) && <span className="create-group-buddy-mark">&#x2713;</span>}
                </button>
              ))}
            </div>
          </React.Fragment>
        )}

        {error && <div className="create-group-error">{error}</div>}

        <button
          className="create-group-submit"
          onClick={handleCreate}
          disabled={loading || !name.trim()}
        >
          <span>{loading ? 'Creating…' : 'Create Group'}</span>
        </button>
      </div>
    </div>
  );
}

// ── Group Detail View ───────────────────────────────────────
function GroupDetailView({
  group, groupFeed, groupSchedule, fetchGroupFeed, fetchGroupSchedule,
  fetchMyGroups, shareBuddies, buddyLiveUpdates, displayName, token, onBack
}) {
  const [segment, setSegment] = useState('feed');
  const [members, setMembers] = useState([]);
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [leaderboardData, setLeaderboardData] = useState([]);
  const feedEndRef = React.useRef(null);

  const groupId = group?.id;

  // Fetch members + pending invites when component mounts or group changes
  useEffect(() => {
    if (!groupId) return;
    fetchGroupFeed(groupId);
    fetchMembers();
    fetchPendingInvites();
  }, [groupId]);

  // Scroll feed to bottom when new messages arrive
  useEffect(() => {
    if (segment === 'feed' && feedEndRef.current) {
      feedEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [groupFeed, segment]);

  // Fetch schedule when switching to schedule tab
  useEffect(() => {
    if (segment === 'schedule' && groupId) {
      fetchGroupSchedule(groupId);
    }
  }, [segment, groupId]);

  // Fetch leaderboard when switching to leaderboard tab
  useEffect(() => {
    if (segment === 'leaderboard' && groupId && group.leaderboard_enabled) {
      fetchLeaderboard();
    }
  }, [segment, groupId]);

  const fetchMembers = async () => {
    try {
      const res = await fetch(`${API_URL}/groups/${groupId}/members`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setMembers(await res.json());
    } catch {}
  };

  const fetchPendingInvites = async () => {
    try {
      const res = await fetch(`${API_URL}/groups/${groupId}/invites`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPendingInvites(Array.isArray(data) ? data : []);
      }
    } catch {}
  };

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch(`${API_URL}/groups/${groupId}/leaderboard`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setLeaderboardData(await res.json());
    } catch {}
  };

  const toggleLeaderboard = async (enabled) => {
    try {
      const res = await fetch(`${API_URL}/groups/${groupId}/leaderboard`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (res.ok) fetchMyGroups();
    } catch {}
  };

  const handleSend = async () => {
    if (!msgText.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`${API_URL}/groups/${groupId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msgText.trim() })
      });
      setMsgText('');
      fetchGroupFeed(groupId);
    } catch {}
    setSending(false);
  };

  const handleDeleteGroup = async () => {
    if (!confirm('Delete this group? This cannot be undone.')) return;
    try {
      await fetch(`${API_URL}/groups/${groupId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchMyGroups();
      onBack();
    } catch {}
  };

  const handleLeaveGroup = async () => {
    if (!confirm('Leave this group?')) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      await fetch(`${API_URL}/groups/${groupId}/members/${payload.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchMyGroups();
      onBack();
    } catch {}
  };

  const handleAddMember = async (buddy) => {
    try {
      const res = await fetch(`${API_URL}/groups/${groupId}/members`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: buddy.username })
      });
      if (res.ok) {
        setShowAddMember(false);
        fetchMyGroups();
        fetchPendingInvites();
      }
    } catch {}
  };

  const handleRemoveMember = async (userId) => {
    if (!confirm('Remove this member from the group?')) return;
    try {
      await fetch(`${API_URL}/groups/${groupId}/members/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchMyGroups();
      fetchMembers();
    } catch {}
  };

  if (!group) return <div className="placeholder-view"><p>Group not found</p><button onClick={onBack}>Back</button></div>;

  const isOwner = group.my_role === 'owner';

  const timeAgo = (ts) => {
    if (!ts) return '';
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    return Math.floor(diff / 86400) + 'd';
  };

  return (
    <div className="group-detail-view">
      {/* Header */}
      <div className="group-detail-header">
        <button className="group-back-btn" onClick={onBack} aria-label="Back"><span>&larr;</span></button>
        <div className="group-detail-title">
          <div className="social-buddy-name">{group.name}</div>
          <div className="social-buddy-status">{group.member_count} member{group.member_count !== 1 ? 's' : ''}{group.owner_name ? ` · Owner: ${group.owner_name}` : ''}</div>
        </div>
        {isOwner ? (
          <button className="group-header-btn" onClick={handleDeleteGroup}><span>Delete</span></button>
        ) : (
          <button className="group-header-btn" onClick={handleLeaveGroup}><span>Leave</span></button>
        )}
      </div>

      {/* Segment tabs */}
      {(() => {
        const segs = ['feed', 'schedule'];
        if (group.leaderboard_enabled) segs.push('leaderboard');
        segs.push('members');
        return (
          <div className={`group-segments segs-${segs.length}`}>
            {segs.map(s => (
              <button
                key={s}
                className={`group-segment-btn${segment === s ? ' active' : ''}`}
                onClick={() => setSegment(s)}
              >
                <span>{s === 'feed' ? 'Live Feed' : s === 'schedule' ? 'Schedule' : s === 'leaderboard' ? 'Leaderboard' : 'Members'}</span>
              </button>
            ))}
          </div>
        );
      })()}

      {/* Feed tab */}
      {segment === 'feed' && (
        <div className="group-feed-container">
          <div className="group-feed">
            {groupFeed.length === 0 ? (
              <div className="group-empty">
                No messages yet. Say something!
              </div>
            ) : groupFeed.map((item, i) => (
              <div key={item.id || i} className={`group-feed-item ${item.type}`}>
                <div className="group-feed-avatar">
                  <Avatar src={item.avatar} username={item.username || '?'} size={AVATAR_5R} style={item.avatar ? undefined : SEATED_INITIAL_5R} />
                </div>
                <div className="group-feed-item-body">
                  <div className="group-feed-item-header">
                    <span className="group-feed-item-name">{displayName(item)}</span>
                    <span className="group-feed-item-time">{timeAgo(item.created_at)}</span>
                  </div>
                  {item.type === 'message' ? (
                    <div className="group-feed-item-text">{item.content}</div>
                  ) : item.type === 'live-update' && item.liveData ? (
                    <div className="group-feed-item-text">
                      &#x2660; {item.liveData.eventName || 'Tournament'} &mdash; {formatLiveUpdate(item.liveData)}
                    </div>
                  ) : (
                    <div className="group-feed-item-text">{item.content}</div>
                  )}
                </div>
              </div>
            ))}
            <div ref={feedEndRef} />
          </div>
          <div className="group-feed-input">
            <input
              value={msgText}
              onChange={e => setMsgText(e.target.value)}
              placeholder="Type a message…"
              maxLength={500}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            />
            <button onClick={handleSend} disabled={sending || !msgText.trim()}><span>Send</span></button>
          </div>
        </div>
      )}

      {/* Schedule tab */}
      {segment === 'schedule' && (
        <div className="group-schedule">
          {groupSchedule.length === 0 ? (
            <div className="group-empty">
              No members have scheduled any tournaments yet.
            </div>
          ) : groupSchedule.map(t => (
            <div key={t.id} className="group-schedule-card">
              <div className="group-schedule-card-top">
                <div className="group-schedule-name">{t.event_name}</div>
                <div className="group-schedule-venue">{getVenueInfo(t.venue, t.property).abbr}</div>
              </div>
              <div className="group-schedule-meta">{`${t.date} · ${t.time} · $${Number(t.buyin).toLocaleString()}`}</div>
              <div className="group-schedule-members">
                {t.members.map(m => (
                  <div key={m.id} className="group-schedule-member" title={displayName(m)}>
                    <Avatar src={m.avatar} username={m.username} size={AVATAR_3R} style={m.avatar ? undefined : SEATED_INITIAL_3R} />
                  </div>
                ))}
                <span className="group-schedule-names">
                  {t.members.map(m => m.username).join(', ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Leaderboard tab */}
      {segment === 'leaderboard' && (
        <div className="group-leaderboard">
          {leaderboardData.length === 0 ? (
            <div className="group-empty">
              No results tracked yet. Members' tournament results will appear here.
            </div>
          ) : (() => {
            // Scale the diverging bar by the largest ABSOLUTE net in the
            // group, so the axis means the same thing for every member.
            const maxAbsNet = Math.max(...leaderboardData.map(m => Math.abs(m.net_pl || 0)), 1);
            return leaderboardData.map((m, i) => (
              <div key={m.id} className="leaderboard-card">
                <div className="leaderboard-rank">
                  {i === 0 ? '🏆' : `#${i + 1}`}
                </div>
                <div className="social-avatar-cell">
                  <Avatar src={m.avatar} username={m.username} size={AVATAR_5R} style={m.avatar ? undefined : SEATED_INITIAL_5R} />
                </div>
                <div className="leaderboard-body">
                  <div className="social-buddy-name">{displayName(m)}</div>
                  <div className="leaderboard-stats">
                    <span className={m.net_pl >= 0 ? 'leaderboard-net-pos' : 'leaderboard-net-neg'}>
                      {m.net_pl >= 0 ? '+' : ''}{formatBuyin(m.net_pl)} net
                    </span>
                    {' · '}{m.cashes} cash{m.cashes !== 1 ? 'es' : ''}
                    {' · '}{m.final_tables} FT{m.final_tables !== 1 ? 's' : ''}
                    {' · '}{m.wins}W
                  </div>
                  {/* Diverging on NET, the figure directly above it. Scaled
                      by gross winnings, this bar said the opposite: buy in
                      for 60k, win 50k, and you got the longest bar on the
                      board under a headline reading minus 10,000. */}
                  <div className="leaderboard-bar-cell">
                    <div className="leaderboard-bar-track">
                      <div
                        className={'leaderboard-bar-fill ' + (m.net_pl >= 0 ? 'pos' : 'neg')}
                        style={{width: `${Math.min(50, Math.max(Math.abs(m.net_pl) / (maxAbsNet || 1) * 50, 1))}%`}}
                      />
                    </div>
                  </div>
                  <div className="leaderboard-won">
                    {`${formatBuyin(m.total_won)} won · ${m.events_played} event${m.events_played !== 1 ? 's' : ''}`}
                  </div>
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      {/* Members tab */}
      {segment === 'members' && (
        <div className="group-members-list">
          <button
            className="create-group-submit group-invite-btn"
            onClick={() => setShowAddMember(!showAddMember)}
          >
            <span>{showAddMember ? 'Cancel' : '+ Invite Buddy'}</span>
          </button>

          {showAddMember && (
            <div className="create-group-buddies group-invite-list">
              {shareBuddies
                .filter(b => !members.some(m => m.id === b.id) && !pendingInvites.some(p => p.invited_user_id === b.id))
                .map(b => (
                <button
                  key={b.id}
                  className="create-group-buddy-btn"
                  onClick={() => handleAddMember(b)}
                >
                  <span className="create-group-buddy-avatar">
                    <Avatar src={b.avatar} username={b.username} size={AVATAR_3R} style={b.avatar ? undefined : SEATED_INITIAL_3R} />
                  </span>
                  <span className="create-group-buddy-name">{displayName(b)}</span>
                  <span className="create-group-buddy-mark">Invite</span>
                </button>
              ))}
            </div>
          )}

          <div className="group-list-hd">
            Members ({members.length || group.member_count})
          </div>
          {members.map(m => (
            <div key={m.id} className="group-member-card">
              <div className="social-avatar-cell">
                <Avatar src={m.avatar} username={m.username} size={AVATAR_5R} style={m.avatar ? undefined : SEATED_INITIAL_5R} />
              </div>
              <div className="social-buddy-info">
                <div className="group-member-name">{displayName(m)}</div>
                {m.role === 'owner' && <div className="group-member-sub is-owner">Owner</div>}
              </div>
              {isOwner && m.role !== 'owner' && (
                <button className="group-member-btn" onClick={() => handleRemoveMember(m.id)}><span>Remove</span></button>
              )}
            </div>
          ))}

          {/* Pending invites */}
          {pendingInvites.length > 0 && (
            <div className="group-pending">
              <div className="group-list-hd">
                Pending Invites
              </div>
              {pendingInvites.map(inv => (
                <div key={inv.id} className="group-member-card" style={{opacity:0.6}}>
                  <div className="social-avatar-cell">
                    <Avatar src={inv.avatar} username={inv.username} size={AVATAR_5R} style={inv.avatar ? undefined : SEATED_INITIAL_5R} />
                  </div>
                  <div className="social-buddy-info">
                    <div className="group-member-name">{displayName(inv)}</div>
                    <div className="group-member-sub">Invited by {inv.invited_by_real_name || inv.invited_by_username}</div>
                  </div>
                  <span className="group-member-tag">Pending</span>
                </div>
              ))}
            </div>
          )}

          {/* Owner settings */}
          {isOwner && (
            <div className="leaderboard-toggle-section">
              <div className="group-list-hd">
                Owner Settings
              </div>
              <div className="leaderboard-toggle-row">
                <span className="leaderboard-toggle-label">Enable Leaderboard</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={!!group.leaderboard_enabled}
                    onChange={e => toggleLeaderboard(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>
          )}

          {!isOwner && (
            <button className="group-exit-btn" onClick={handleLeaveGroup}><span>Leave Group</span></button>
          )}
          {isOwner && (
            <button className="group-exit-btn is-delete" onClick={handleDeleteGroup}><span>Delete Group</span></button>
          )}
        </div>
      )}
    </div>
  );
}


// ── Social View (main export) ───────────────────────────────
export default function SocialView({
  shareBuddies, buddyLiveUpdates, displayName, myGroups, activeGroupId, setActiveGroupId,
  groupFeed, groupSchedule, fetchGroupFeed, fetchGroupSchedule, fetchMyGroups,
  token, onRemoveBuddy, fetchShareBuddies, onNavigate
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [buddySchedules, setBuddySchedules] = useState({});
  const [loadingSchedule, setLoadingSchedule] = useState(null);
  const [addToGroupBuddyId, setAddToGroupBuddyId] = useState(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const [inviteStatus, setInviteStatus] = useState({}); // { buddyId: { groupId: 'sent' | 'error' | 'member' } }
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchMsg, setSearchMsg] = useState('');
  const searchTimerRef = useRef(null);

  const handleSearchChange = (val) => {
    setSearchQuery(val);
    setSearchMsg('');
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (val.trim().length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/users/search?q=${encodeURIComponent(val.trim())}`, {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (res.ok) setSearchResults(await res.json());
        else setSearchResults([]);
      } catch { setSearchResults([]); }
      setSearchLoading(false);
    }, 300);
  };

  const handleSendRequest = async (username) => {
    try {
      const res = await fetch(`${API_URL}/share-request`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      if (!res.ok) { setSearchMsg(data.error || 'Failed'); return; }
      setSearchMsg('Request sent to ' + username);
      setSearchResults(prev => prev.filter(u => u.username !== username));
      if (fetchShareBuddies) fetchShareBuddies();
    } catch { setSearchMsg('Failed to send request'); }
  };

  const handleInviteToGroup = async (buddyId, groupId, username) => {
    try {
      const res = await fetch(`${API_URL}/groups/${groupId}/members`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      if (res.ok) {
        setInviteStatus(prev => ({ ...prev, [buddyId]: { ...prev[buddyId], [groupId]: 'sent' } }));
      } else {
        const data = await res.json();
        if (data.error && /already/i.test(data.error)) {
          setInviteStatus(prev => ({ ...prev, [buddyId]: { ...prev[buddyId], [groupId]: 'member' } }));
        } else {
          setInviteStatus(prev => ({ ...prev, [buddyId]: { ...prev[buddyId], [groupId]: 'error' } }));
        }
      }
    } catch {
      setInviteStatus(prev => ({ ...prev, [buddyId]: { ...prev[buddyId], [groupId]: 'error' } }));
    }
  };

  const toggleBuddy = (buddyId) => {
    if (expandedId === buddyId) { setExpandedId(null); return; }
    setExpandedId(buddyId);
    if (!buddySchedules[buddyId]) {
      setLoadingSchedule(buddyId);
      fetch(`${API_URL}/schedule/${buddyId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(data => {
          setBuddySchedules(prev => ({ ...prev, [buddyId]: Array.isArray(data) ? data : [] }));
          setLoadingSchedule(null);
        })
        .catch(() => {
          setBuddySchedules(prev => ({ ...prev, [buddyId]: [] }));
          setLoadingSchedule(null);
        });
    }
  };

  // If a group is active, show GroupDetailView
  if (activeGroupId) {
    const group = myGroups.find(g => g.id === activeGroupId);
    return (
      <GroupDetailView
        group={group}
        groupFeed={groupFeed}
        groupSchedule={groupSchedule}
        fetchGroupFeed={fetchGroupFeed}
        fetchGroupSchedule={fetchGroupSchedule}
        fetchMyGroups={fetchMyGroups}
        shareBuddies={shareBuddies}
        buddyLiveUpdates={buddyLiveUpdates}
        displayName={displayName}
        token={token}
        onBack={() => { setActiveGroupId(null); setExpandedId(null); }}
      />
    );
  }

  const hasBuddies = shareBuddies && shareBuddies.length > 0;
  const hasGroups = myGroups && myGroups.length > 0;

  const searchBar = (
    <div className="social-search">
      <input
        type="text"
        className="social-search-input"
        placeholder="Search by username or name..."
        value={searchQuery}
        onChange={e => handleSearchChange(e.target.value)}
      />
      {searchMsg && (
        <div className="social-search-msg">{searchMsg}</div>
      )}
      {(searchResults.length > 0 || searchLoading) && searchQuery.trim().length >= 2 && (
        <div className="social-search-results">
          {searchLoading && !searchResults.length && (
            <div className="social-search-note">Searching...</div>
          )}
          {searchResults.map(u => (
            <div key={u.id} className="social-search-row">
              <div className="social-avatar-cell">
                <Avatar src={u.avatar} username={u.username} size={AVATAR_5R} style={u.avatar ? undefined : SEATED_INITIAL_5R} />
              </div>
              <div className="social-buddy-info">
                <div className="social-buddy-name">{u.real_name || u.username}</div>
                {u.real_name && (
                  <div className="social-buddy-status">@{u.username}</div>
                )}
              </div>
              <button className="social-connect-btn" onClick={() => handleSendRequest(u.username)}>
                <span>Connect</span>
              </button>
            </div>
          ))}
          {!searchLoading && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
            <div className="social-search-note">No users found</div>
          )}
        </div>
      )}
    </div>
  );

  const shareSection = (
    <>
      <div className="dashboard-section-header social-section-gap">
        <div className="dashboard-section-title">Share</div>
      </div>
      <div className="social-share-box">
        <div className="social-cell">Social media integrations coming soon</div>
      </div>
    </>
  );

  if (!hasBuddies && !hasGroups) {
    return (
      <div className="social-view">
        <div className="dashboard-section-header">
          <div className="dashboard-section-title">Connections</div>
        </div>
        {searchBar}
        <div className="social-empty">
          No connections yet. Search for friends above to get started.
        </div>
        {shareSection}
      </div>
    );
  }

  const timeAgo = (ts) => {
    if (!ts) return '';
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  };

  return (
    <div className="social-view">
      {/* Groups section */}
      <div className="dashboard-section-header">
        <div className="dashboard-section-title">Groups</div>
        {hasBuddies && (
          <button
            className="dashboard-section-badge social-new-btn"
            onClick={() => setShowCreateGroup(true)}
          ><span>+ New</span></button>
        )}
      </div>

      {hasGroups ? myGroups.map(g => (
        <button
          key={g.id}
          className="social-group-card"
          onClick={() => {
            setActiveGroupId(g.id);
            fetchGroupFeed(g.id);
          }}
        >
          <div className="social-buddy-row">
            <div className="social-avatar-cell">
              <div className="social-group-avatar">{g.name.charAt(0).toUpperCase()}</div>
            </div>
            <div className="social-buddy-info">
              <div className="social-buddy-name">{g.name}</div>
              <div className="social-group-meta">
                {g.member_count} member{g.member_count !== 1 ? 's' : ''}{g.owner_name ? ` · Owner: ${g.owner_name}` : ''}
                {g.last_message && (
                  <span>{` · ${g.last_message_by}: `}&quot;{g.last_message.length > 25 ? g.last_message.slice(0, 25) + '…' : g.last_message}&quot; {timeAgo(g.last_message_at)}</span>
                )}
              </div>
            </div>
            <span className="social-chev social-chev--go" aria-hidden="true">&rsaquo;</span>
          </div>
        </button>
      )) : (
        <div className="social-empty">
          {hasBuddies ? 'No groups yet. Create one to share schedules and chat with friends.' : 'Add connections first to create groups.'}
        </div>
      )}

      {/* Connections section */}
      <div className="dashboard-section-header social-section-gap">
        <div className="dashboard-section-title">Connections</div>
        {hasBuddies && <span className="dashboard-section-badge dashboard-section-badge--wide">{shareBuddies.length} friend{shareBuddies.length !== 1 ? 's' : ''}</span>}
      </div>
      {searchBar}
      {hasBuddies && (
        <React.Fragment>
          {shareBuddies.map(buddy => {
            const lu = buddyLiveUpdates?.[buddy.id];
            const isLive = lu && !lu.isBusted;
            const isExpanded = expandedId === buddy.id;
            return (
              <div
                key={buddy.id}
                className={`social-buddy-card${isLive ? ' live' : ''}`}
              >
                <div className="social-buddy-row" onClick={() => toggleBuddy(buddy.id)} style={{cursor:'pointer'}}>
                  <div className="social-avatar-cell">
                    <Avatar src={buddy.avatar} username={buddy.username} size={AVATAR_5R} style={buddy.avatar ? undefined : SEATED_INITIAL_5R} />
                  </div>
                  <div className="social-buddy-info">
                    <div className="social-buddy-name">{displayName(buddy)}</div>
                    {isLive ? (
                      <div className="social-buddy-status live">
                        <span className="social-live-dot" />
                        {getVenueInfo(lu.venue).abbr} | {lu.eventName}
                      </div>
                    ) : lu?.isBusted ? (
                      <div className="social-buddy-status busted">Busted</div>
                    ) : (
                      <div className="social-buddy-status idle">
                        {buddySchedules[buddy.id] ? `${buddySchedules[buddy.id].length} event${buddySchedules[buddy.id].length !== 1 ? 's' : ''} scheduled` : 'View schedule'}
                      </div>
                    )}
                  </div>
                  <span className={'social-chev' + (isExpanded ? ' open' : '')} aria-hidden="true">{isExpanded ? '▲' : '▼'}</span>
                </div>
                {isExpanded && isLive && (
                  <div className="social-buddy-detail">
                    <div className="social-detail-row">
                      <span className="social-detail-label">Stack</span>
                      <span className="social-detail-value">{lu.stack ? Number(lu.stack).toLocaleString() : '—'}</span>
                    </div>
                    {lu.bb && (
                      <div className="social-detail-row">
                        <span className="social-detail-label">Blinds</span>
                        <span className="social-detail-value">
                          {lu.sb ? Number(lu.sb).toLocaleString() : '?'}/{Number(lu.bb).toLocaleString()}
                          {(lu.bbAnte || lu.bb_ante) ? '/' + Number(lu.bbAnte || lu.bb_ante).toLocaleString() : ''}
                        </span>
                      </div>
                    )}
                    {lu.bb && lu.stack && (
                      <div className="social-detail-row">
                        <span className="social-detail-label">BB</span>
                        <span className="social-detail-value">{(Number(lu.stack) / Number(lu.bb)).toFixed(1).replace(/\.0$/, '')}bb</span>
                      </div>
                    )}
                    {(lu.isItm || lu.is_itm) && (
                      <div className="social-detail-row">
                        <span className="social-detail-label">Status</span>
                        <span className="social-detail-value" style={{color:'#22c55e'}}>In the Money</span>
                      </div>
                    )}
                    {(lu.isFinalTable || lu.is_final_table) && (
                      <div className="social-detail-row">
                        <span className="social-detail-label">Final Table</span>
                        <span className="social-detail-value" style={{color:'#f59e0b'}}>
                          {(lu.placesLeft || lu.places_left) ? (lu.placesLeft || lu.places_left) + ' left' : 'Yes'}
                        </span>
                      </div>
                    )}
                    <div className="social-detail-row">
                      <span className="social-detail-label">Venue</span>
                      <span className="social-detail-value">{lu.venue || '—'}</span>
                    </div>
                  </div>
                )}
                {isExpanded && (() => {
                  const sched = buddySchedules[buddy.id];
                  const todayISO = getToday();
                  if (loadingSchedule === buddy.id) {
                    return <div className="social-sched-msg">Loading schedule...</div>;
                  }
                  if (!sched || sched.length === 0) {
                    return <div className="social-sched-msg">No events scheduled</div>;
                  }
                  // Decorate-sort-undecorate with parseTournamentTime so the
                  // sort uses each event's VENUE timezone (matches My
                  // Schedule + TournamentsView), not the user's local clock.
                  const upcoming = sched
                    .filter(t => normaliseDate(t.date) >= todayISO)
                    .map(t => ({ t, ts: parseTournamentTime(t) }))
                    .sort((a, b) => a.ts - b.ts)
                    .map(x => x.t);
                  if (upcoming.length === 0) {
                    return <div className="social-sched-msg">No upcoming events</div>;
                  }
                  // Group by date
                  const groups = [];
                  let cur = null;
                  for (const t of upcoming) {
                    const d = normaliseDate(t.date);
                    if (!cur || cur.date !== d) { cur = { date: d, events: [] }; groups.push(cur); }
                    cur.events.push(t);
                  }
                  return (
                    <div className="social-sched">
                      <div className="social-sched-hd">
                        Upcoming Schedule ({upcoming.length} event{upcoming.length !== 1 ? 's' : ''})
                      </div>
                      <div className="social-sched-grid">
                      {groups.map(group => {
                        const dateObj = new Date(group.date + 'T12:00:00');
                        const dayAbbr = group.date === todayISO ? '' : ['Su','M','Tu','W','Th','F','Sa'][dateObj.getDay()];
                        const dateLabel = group.date === todayISO ? 'Today' :
                          ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dateObj.getMonth()] + ' ' + dateObj.getDate();
                        return (
                          <React.Fragment key={group.date}>
                            {group.events.map((t, i) => {
                              const v = getVenueInfo(t.venue, t.property);
                              return (
                                <React.Fragment key={t.id}>
                                  <span className="social-sched-dow">{i === 0 ? dayAbbr : ''}</span>
                                  <span className="social-sched-date">{i === 0 ? dateLabel : ''}</span>
                                  <span className="social-sched-abbr" style={{color: getVenueBrandColor(v.abbr)}}>{v.abbr}</span>
                                  <span className="social-sched-time">{t.time || 'TBD'}</span>
                                  <span className="social-sched-name">{t.event_name}</span>
                                  <span className="social-sched-buyin">{formatBuyin(t.buyin, t.venue)}</span>
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                      </div>
                    </div>
                  );
                })()}
                {isExpanded && (
                  <div className="social-actions">
                    {myGroups && myGroups.length > 0 && (
                      addToGroupBuddyId === buddy.id ? (
                        <div className="social-actions-list">
                          <div className="social-sched-hd">Add to Group</div>
                          {myGroups.map(g => {
                            const status = inviteStatus[buddy.id]?.[g.id];
                            return (
                              <button
                                key={g.id}
                                className="social-action-btn is-split"
                                disabled={!!status}
                                onClick={(e) => { e.stopPropagation(); handleInviteToGroup(buddy.id, g.id, buddy.username); }}
                                style={{cursor: status ? 'default' : 'pointer', opacity: status ? 0.6 : 1}}
                              >
                                <span>{g.name}</span>
                                <span className="social-action-status" style={{color: status === 'sent' ? '#22c55e' : status === 'member' ? 'var(--text-muted)' : status === 'error' ? '#ef4444' : 'var(--accent)'}}>
                                  {status === 'sent' ? 'Invited' : status === 'member' ? 'Already in group' : status === 'error' ? 'Failed' : 'Invite'}
                                </span>
                              </button>
                            );
                          })}
                          <button
                            className="social-text-btn"
                            onClick={(e) => { e.stopPropagation(); setAddToGroupBuddyId(null); }}
                          ><span>Cancel</span></button>
                        </div>
                      ) : (
                        <button
                          className="social-action-btn"
                          onClick={(e) => { e.stopPropagation(); setAddToGroupBuddyId(buddy.id); }}
                        ><span>+ Add to Group</span></button>
                      )
                    )}
                    {confirmRemoveId === buddy.id ? (
                      <div className="social-confirm">
                        <span className="social-confirm-text">Remove {displayName(buddy)}?</span>
                        <button
                          className="social-confirm-btn"
                          onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(null); }}
                        ><span>Cancel</span></button>
                        <button
                          className="social-confirm-btn is-danger"
                          onClick={(e) => { e.stopPropagation(); onRemoveBuddy(buddy.id); setConfirmRemoveId(null); setExpandedId(null); }}
                        ><span>Remove</span></button>
                      </div>
                    ) : (
                      <button
                        className="social-action-btn is-danger"
                        onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(buddy.id); }}
                      ><span>Remove Connection</span></button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </React.Fragment>
      )}

      {/* Share section — social media integration placeholder */}
      {shareSection}

      {/* Create Group Modal */}
      {showCreateGroup && createPortal(
        <CreateGroupModal
          shareBuddies={shareBuddies}
          displayName={displayName}
          token={token}
          onClose={() => setShowCreateGroup(false)}
          onCreated={() => { setShowCreateGroup(false); fetchMyGroups(); }}
        />,
        document.body
      )}
    </div>
  );
}
