import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar.jsx';
import { API_URL } from '../utils/api.js';
import { getVenueInfo, getVenueBrandColor, normaliseDate, getToday, formatBuyin, formatLiveUpdate, parseTournamentTime } from '../utils/utils.js';

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
          <h3 style={{margin:0,fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'calc(var(--subrow) * 0.125)'}}>Create Group</h3>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text)',fontSize:'calc(var(--subrow) * 2.5)',cursor:'pointer',padding:'var(--space-xs)'}}>&#x2715;</button>
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
            <label className="create-group-label" style={{marginTop:'var(--space-lg)'}}>Add Members</label>
            <div className="create-group-buddies">
              {shareBuddies.map(b => (
                <button
                  key={b.id}
                  className={`create-group-buddy-btn${selected.has(b.id) ? ' selected' : ''}`}
                  onClick={() => toggleBuddy(b.id)}
                >
                  <Avatar src={b.avatar} username={b.username} size={24} />
                  <span>{displayName(b)}</span>
                  {selected.has(b.id) && <span style={{marginLeft:'auto',color:'var(--accent)'}}>&#x2713;</span>}
                </button>
              ))}
            </div>
          </React.Fragment>
        )}

        {error && <div style={{color:'#ef4444',fontSize:'calc(var(--subrow) * 1.625)',marginTop:'var(--space-md)'}}>{error}</div>}

        <button
          className="create-group-submit"
          onClick={handleCreate}
          disabled={loading || !name.trim()}
        >
          {loading ? 'Creating\u2026' : 'Create Group'}
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
        <button className="group-back-btn" onClick={onBack}>&larr;</button>
        <div style={{flex:1,position:'relative',top:'calc(var(--subrow) * -0.125)'}}>
          <div className="social-buddy-name" style={{fontSize:'calc(var(--subrow) * 2)',lineHeight:'calc(var(--subrow) * 2)'}}>{group.name}</div>
          <div style={{fontSize:'calc(var(--subrow) * 1.5)',lineHeight:'calc(var(--subrow) * 2)',marginTop:'calc(var(--subrow) * 0.1875)',color:'var(--text-secondary)'}}>{group.member_count} member{group.member_count !== 1 ? 's' : ''}{group.owner_name ? ` \u00b7 Owner: ${group.owner_name}` : ''}</div>
        </div>
        {isOwner ? (
          <button onClick={handleDeleteGroup} style={{background:'none',border:'none',color:'var(--text-secondary)',fontSize:'calc(var(--subrow) * 1.625)',cursor:'pointer'}}>Delete</button>
        ) : (
          <button onClick={handleLeaveGroup} style={{background:'none',border:'none',color:'var(--text-secondary)',fontSize:'calc(var(--subrow) * 1.625)',cursor:'pointer'}}>Leave</button>
        )}
      </div>

      {/* Segment tabs */}
      <div className="group-segments">
        {(() => {
          const segs = ['feed', 'schedule'];
          if (group.leaderboard_enabled) segs.push('leaderboard');
          segs.push('members');
          return segs;
        })().map(s => (
          <button
            key={s}
            className={`group-segment-btn${segment === s ? ' active' : ''}`}
            onClick={() => setSegment(s)}
          >
            {s === 'feed' ? 'Live Feed' : s === 'schedule' ? 'Schedule' : s === 'leaderboard' ? 'Leaderboard' : 'Members'}
          </button>
        ))}
      </div>

      {/* Feed tab */}
      {segment === 'feed' && (
        <div className="group-feed-container">
          <div className="group-feed">
            {groupFeed.length === 0 ? (
              <div style={{textAlign:'center',color:'var(--text-secondary)',padding:'calc(var(--subrow) * 5) var(--space-2xl)',fontSize:'calc(var(--subrow) * 1.625)'}}>
                No messages yet. Say something!
              </div>
            ) : groupFeed.map((item, i) => (
              <div key={item.id || i} className={`group-feed-item ${item.type}`}>
                <Avatar src={item.avatar} username={item.username || '?'} size={32} />
                <div className="group-feed-item-body">
                  <div className="group-feed-item-header">
                    <span className="group-feed-item-name">{displayName(item)}</span>
                    <span className="group-feed-item-time">{timeAgo(item.created_at)}</span>
                  </div>
                  {item.type === 'message' ? (
                    <div className="group-feed-item-text">{item.content}</div>
                  ) : item.type === 'live-update' && item.liveData ? (
                    <div className="group-feed-item-text" style={{color:'var(--accent)',fontSize:'calc(var(--subrow) * 1.5)'}}>
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
              placeholder="Type a message\u2026"
              maxLength={500}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            />
            <button onClick={handleSend} disabled={sending || !msgText.trim()}>Send</button>
          </div>
        </div>
      )}

      {/* Schedule tab */}
      {segment === 'schedule' && (
        <div className="group-schedule">
          {groupSchedule.length === 0 ? (
            <div style={{textAlign:'center',color:'var(--text-secondary)',padding:'calc(var(--subrow) * 5) var(--space-2xl)',fontSize:'calc(var(--subrow) * 1.625)'}}>
              No members have scheduled any tournaments yet.
            </div>
          ) : groupSchedule.map(t => (
            <div key={t.id} className="group-schedule-card">
              <div className="group-schedule-card-top">
                <div>
                  <div style={{fontWeight: 'var(--fw-bold)',fontSize:'calc(var(--subrow) * 1.75)',lineHeight:'calc(var(--subrow) * 2)'}}>{t.event_name}</div>
                  <div style={{fontSize:'calc(var(--subrow) * 1.5)',lineHeight:'calc(var(--subrow) * 2)',color:'var(--text-secondary)'}}>{t.date} \u00b7 {t.time} \u00b7 ${Number(t.buyin).toLocaleString()}</div>
                </div>
                <div style={{fontSize:'calc(var(--subrow) * 1.375)',lineHeight:'calc(var(--subrow) * 2)',color:'var(--text-secondary)'}}>{getVenueInfo(t.venue, t.property).abbr}</div>
              </div>
              <div className="group-schedule-members">
                {t.members.map(m => (
                  <div key={m.id} className="group-schedule-member" title={displayName(m)}>
                    <Avatar src={m.avatar} username={m.username} size={24} />
                  </div>
                ))}
                <span style={{fontSize:'calc(var(--subrow) * 1.375)',color:'var(--text-secondary)',marginLeft:'var(--space-xs)'}}>
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
            <div style={{textAlign:'center',color:'var(--text-secondary)',padding:'calc(var(--subrow) * 5) var(--space-2xl)',fontSize:'calc(var(--subrow) * 1.625)'}}>
              No results tracked yet. Members' tournament results will appear here.
            </div>
          ) : (() => {
            const maxWon = Math.max(...leaderboardData.map(m => m.total_won), 1);
            // Scale the diverging bar by the largest ABSOLUTE net in the
            // group, so the axis means the same thing for every member.
            const maxAbsNet = Math.max(...leaderboardData.map(m => Math.abs(m.net_pl || 0)), 1);
            return leaderboardData.map((m, i) => (
              <div key={m.id} className="leaderboard-card">
                <div style={{display:'flex',alignItems:'center',gap:'var(--gu)'}}>
                  <div className="leaderboard-rank">
                    {i === 0 ? '\ud83c\udfc6' : `#${i + 1}`}
                  </div>
                  <Avatar src={m.avatar} username={m.username} size={32} />
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight: 'var(--fw-bold)',fontSize:'calc(var(--subrow) * 1.75)',lineHeight:'calc(var(--subrow) * 2)'}}>{displayName(m)}</div>
                    <div className="leaderboard-stats">
                      <span className={m.net_pl >= 0 ? 'leaderboard-net-pos' : 'leaderboard-net-neg'}>
                        {m.net_pl >= 0 ? '+' : ''}{formatBuyin(m.net_pl)} net
                      </span>
                      {' \u00b7 '}{m.cashes} cash{m.cashes !== 1 ? 'es' : ''}
                      {' \u00b7 '}{m.final_tables} FT{m.final_tables !== 1 ? 's' : ''}
                      {' \u00b7 '}{m.wins}W
                    </div>
                    {/* Diverging on NET, the figure directly above it. Scaled
                        by gross winnings, this bar said the opposite: buy in
                        for 60k, win 50k, and you got the longest bar on the
                        board under a headline reading minus 10,000. */}
                    <div className="leaderboard-bar-track">
                      <div
                        className={'leaderboard-bar-fill ' + (m.net_pl >= 0 ? 'pos' : 'neg')}
                        style={{width: `${Math.min(50, Math.max(Math.abs(m.net_pl) / (maxAbsNet || 1) * 50, 1))}%`}}
                      />
                    </div>
                    <div style={{fontSize:'calc(var(--subrow) * 1.375)',color:'var(--text-muted)',lineHeight:'calc(var(--subrow) * 2)',marginTop:'var(--space-2xs)'}}>
                      {formatBuyin(m.total_won)} won \u00b7 {m.events_played} event{m.events_played !== 1 ? 's' : ''}
                    </div>
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
          <div style={{marginBottom:'var(--space-lg)'}}>
            <button
              className="create-group-submit"
              style={{fontSize:'calc(var(--subrow) * 1.625)',padding:'var(--space-md) var(--space-xl)',marginBottom:'var(--space-md)'}}
              onClick={() => setShowAddMember(!showAddMember)}
            >
              {showAddMember ? 'Cancel' : '+ Invite Buddy'}
            </button>

            {showAddMember && (
              <div className="create-group-buddies" style={{marginBottom:'var(--space-lg)'}}>
                {shareBuddies
                  .filter(b => !members.some(m => m.id === b.id) && !pendingInvites.some(p => p.invited_user_id === b.id))
                  .map(b => (
                  <button
                    key={b.id}
                    className="create-group-buddy-btn"
                    onClick={() => handleAddMember(b)}
                  >
                    <Avatar src={b.avatar} username={b.username} size={24} />
                    <span>{displayName(b)}</span>
                    <span style={{marginLeft:'auto',fontSize:'calc(var(--subrow) * 1.5)',color:'var(--accent)'}}>Invite</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{fontSize:'calc(var(--subrow) * 1.375)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'calc(var(--subrow) * 0.125)',fontFamily:'Univers Condensed, Univers, sans-serif',lineHeight:'calc(var(--subrow) * 2)',marginBottom:'var(--space-md)'}}>
            Members ({members.length || group.member_count})
          </div>
          {members.map(m => (
            <div key={m.id} className="group-member-card">
              <Avatar src={m.avatar} username={m.username} size={32} />
              <div style={{flex:1}}>
                <div style={{fontSize:'calc(var(--subrow) * 1.625)',lineHeight:'calc(var(--subrow) * 2)',fontWeight: 'var(--fw-regular)'}}>{displayName(m)}</div>
                {m.role === 'owner' && <div style={{fontSize:'calc(var(--subrow) * 1.375)',lineHeight:'calc(var(--subrow) * 2)',color:'var(--accent)'}}>Owner</div>}
              </div>
              {isOwner && m.role !== 'owner' && (
                <button onClick={() => handleRemoveMember(m.id)} style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'calc(var(--subrow) * 1.375)'}}>Remove</button>
              )}
            </div>
          ))}

          {/* Pending invites */}
          {pendingInvites.length > 0 && (
            <div style={{marginBottom:'var(--space-lg)'}}>
              <div style={{fontSize:'calc(var(--subrow) * 1.375)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'calc(var(--subrow) * 0.125)',fontFamily:'Univers Condensed, Univers, sans-serif',lineHeight:'calc(var(--subrow) * 2)',marginBottom:'var(--space-md)'}}>
                Pending Invites
              </div>
              {pendingInvites.map(inv => (
                <div key={inv.id} className="group-member-card" style={{opacity:0.6}}>
                  <Avatar src={inv.avatar} username={inv.username} size={32} />
                  <div style={{flex:1}}>
                    <div style={{fontSize:'calc(var(--subrow) * 1.625)',lineHeight:'calc(var(--subrow) * 2)',fontWeight: 'var(--fw-regular)'}}>{displayName(inv)}</div>
                    <div style={{fontSize:'calc(var(--subrow) * 1.375)',lineHeight:'calc(var(--subrow) * 2)',color:'var(--text-muted)'}}>Invited by {inv.invited_by_real_name || inv.invited_by_username}</div>
                  </div>
                  <span style={{fontSize:'calc(var(--subrow) * 1.375)',color:'var(--text-muted)',fontStyle:'italic'}}>Pending</span>
                </div>
              ))}
            </div>
          )}

          {/* Owner settings */}
          {isOwner && (
            <div className="leaderboard-toggle-section">
              <div style={{fontSize:'calc(var(--subrow) * 1.375)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'calc(var(--subrow) * 0.125)',fontFamily:'Univers Condensed, Univers, sans-serif',lineHeight:'calc(var(--subrow) * 2)',marginBottom:'var(--space-md)'}}>
                Owner Settings
              </div>
              <div className="leaderboard-toggle-row">
                <span style={{fontSize:'calc(var(--subrow) * 1.625)'}}>Enable Leaderboard</span>
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
            <button
              onClick={handleLeaveGroup}
              style={{background:'none',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius-sm)',color:'#ef4444',cursor:'pointer',padding:'var(--space-md) var(--space-xl)',fontSize:'calc(var(--subrow) * 1.625)',width:'100%',marginTop:'var(--space-lg)'}}
            >
              Leave Group
            </button>
          )}
          {isOwner && (
            <button
              onClick={handleDeleteGroup}
              style={{background:'none',border:'var(--bw-hair) solid #ef4444',borderRadius:'var(--radius-sm)',color:'#ef4444',cursor:'pointer',padding:'var(--space-md) var(--space-xl)',fontSize:'calc(var(--subrow) * 1.625)',width:'100%',marginTop:'var(--space-lg)'}}
            >
              Delete Group
            </button>
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
    <div style={{position:'relative',marginBottom:'var(--space-xl)'}}>
      <input
        type="text"
        placeholder="Search by username or name..."
        value={searchQuery}
        onChange={e => handleSearchChange(e.target.value)}
        style={{
          width:'100%',height:'calc(var(--subrow) * 5)',boxSizing:'border-box',padding:'0 var(--gu)',
          border:'var(--bw-1) solid var(--border)',borderRadius:'var(--radius-sm)',
          background:'var(--bg)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif",
          fontSize:'calc(var(--gu) * 1.208)',outline:'none',lineHeight:'calc(var(--subrow) * 2)',
        }}
      />
      {searchMsg && (
        <div style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--accent)',fontFamily:"'Univers Condensed','Univers',sans-serif",marginTop:'var(--space-xs)'}}>{searchMsg}</div>
      )}
      {(searchResults.length > 0 || searchLoading) && searchQuery.trim().length >= 2 && (
        <div style={{
          position:'absolute',top:'100%',left:0,right:0,zIndex:20,
          background:'var(--surface)',border:'var(--bw-hair) solid var(--border)',
          borderRadius:'var(--radius-sm)',marginTop:'var(--space-2xs)',
          maxHeight:'calc(var(--subrow) * 30)',overflowY:'auto',
          boxShadow:'0 calc(var(--subrow) * 0.5) var(--space-xl) rgba(0,0,0,0.3)',
        }}>
          {searchLoading && !searchResults.length && (
            <div style={{padding:'var(--space-ml) var(--space-lg)',fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>Searching...</div>
          )}
          {searchResults.map(u => (
            <div key={u.id} style={{
              display:'flex',alignItems:'center',gap:'var(--space-md)',padding:'var(--space-md) var(--space-lg)',
              borderBottom:'var(--bw-hair) solid var(--border)',cursor:'default',
            }}>
              <Avatar src={u.avatar} username={u.username} size={32} />
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:'calc(var(--gu) * 1.149)',fontWeight: 'var(--fw-bold)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif",overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {u.real_name || u.username}
                </div>
                {u.real_name && (
                  <div style={{fontSize:'calc(var(--gu) * 0.913)',color:'var(--text-muted)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>@{u.username}</div>
                )}
              </div>
              <button
                onClick={() => handleSendRequest(u.username)}
                style={{
                  padding:'calc(var(--subrow) * 0.375) var(--space-ml)',borderRadius:'calc(var(--subrow) * 0.75)',border:'var(--bw-hair) solid var(--accent)',
                  background:'transparent',color:'var(--accent)',fontFamily:"'Univers Condensed','Univers',sans-serif",
                  fontSize:'calc(var(--gu) * 0.957)',cursor:'pointer',whiteSpace:'nowrap',
                }}
              >Connect</button>
            </div>
          ))}
          {!searchLoading && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
            <div style={{padding:'var(--space-ml) var(--space-lg)',fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>No users found</div>
          )}
        </div>
      )}
    </div>
  );

  const shareSection = (
    <>
      <div className="dashboard-section-header" style={{marginBottom:'var(--space-md)',marginTop:'var(--space-xl)'}}>
        <div className="dashboard-section-title">Share</div>
      </div>
      <div style={{
        background:'var(--surface)',boxShadow:'inset 0 0 0 calc(var(--subrow) * 0.125) var(--border)',
        borderRadius:'var(--radius-sm)',padding:'var(--space-xl) var(--gu)',
        textAlign:'center',color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.149)',
        lineHeight:'calc(var(--subrow) * 3)',
      }}>
        Social media integrations coming soon
      </div>
    </>
  );

  if (!hasBuddies && !hasGroups) {
    return (
      <div style={{maxWidth:'calc(var(--subrow) * 75)',margin:'0 auto'}}>
        <div className="dashboard-section-header" style={{marginBottom:'var(--space-md)'}}>
          <div className="dashboard-section-title">Connections</div>
        </div>
        {searchBar}
        <div style={{textAlign:'left',color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.208)',lineHeight:'calc(var(--subrow) * 3)',padding:'var(--space-xl) 0 var(--space-3xl)'}}>
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
      <div className="dashboard-section-header" style={{marginBottom:'var(--space-md)'}}>
        <div className="dashboard-section-title">Groups</div>
        {hasBuddies && (
          <button
            className="dashboard-section-badge"
            style={{cursor:'pointer',background:'var(--brand)',color:'var(--on-brand)',border:'none',borderRadius:'var(--radius-pill)',padding:'0 var(--gu)',height:'calc(var(--subrow) * 2)',lineHeight:'calc(var(--subrow) * 2)',fontSize:'calc(var(--subrow) * 1.5)',fontWeight:700}}
            onClick={() => setShowCreateGroup(true)}
          >+ New</button>
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
            <div className="social-group-avatar">{g.name.charAt(0).toUpperCase()}</div>
            <div className="social-buddy-info">
              <div className="social-buddy-name">{g.name}</div>
              <div className="social-group-meta">
                {g.member_count} member{g.member_count !== 1 ? 's' : ''}{g.owner_name ? ` \u00b7 Owner: ${g.owner_name}` : ''}
                {g.last_message && (
                  <span> \u00b7 {g.last_message_by}: &quot;{g.last_message.length > 25 ? g.last_message.slice(0, 25) + '\u2026' : g.last_message}&quot; {timeAgo(g.last_message_at)}</span>
                )}
              </div>
            </div>
            <span style={{marginLeft:'auto',color:'var(--text-secondary)',fontSize:'calc(var(--subrow) * 2.25)'}}>&rsaquo;</span>
          </div>
        </button>
      )) : (
        <div style={{color:'var(--text-secondary)',fontSize:'calc(var(--subrow) * 1.625)',padding:'var(--space-md) 0 var(--space-xl)'}}>
          {hasBuddies ? 'No groups yet. Create one to share schedules and chat with friends.' : 'Add connections first to create groups.'}
        </div>
      )}

      {/* Connections section */}
      <div className="dashboard-section-header" style={{marginBottom:'var(--space-md)',marginTop:'var(--space-xl)'}}>
        <div className="dashboard-section-title">Connections</div>
        {hasBuddies && <span className="dashboard-section-badge">{shareBuddies.length} friend{shareBuddies.length !== 1 ? 's' : ''}</span>}
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
                  <Avatar src={buddy.avatar} username={buddy.username} size={40} />
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
                  <span style={{marginLeft:'auto',color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.031)',transition:'transform 0.15s',transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'}}>&#x25BC;</span>
                </div>
                {isExpanded && isLive && (
                  <div className="social-buddy-detail">
                    <div className="social-detail-row">
                      <span className="social-detail-label">Stack</span>
                      <span className="social-detail-value">{lu.stack ? Number(lu.stack).toLocaleString() : '\u2014'}</span>
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
                      <span className="social-detail-value">{lu.venue || '\u2014'}</span>
                    </div>
                  </div>
                )}
                {isExpanded && (() => {
                  const sched = buddySchedules[buddy.id];
                  const todayISO = getToday();
                  if (loadingSchedule === buddy.id) {
                    return <div style={{padding:'var(--space-lg)',fontSize:'calc(var(--gu) * 1.178)',color:'var(--text-muted)'}}>Loading schedule...</div>;
                  }
                  if (!sched || sched.length === 0) {
                    return <div style={{padding:'var(--space-lg)',fontSize:'calc(var(--gu) * 1.178)',color:'var(--text-muted)'}}>No events scheduled</div>;
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
                    return <div style={{padding:'var(--space-lg)',fontSize:'calc(var(--gu) * 1.178)',color:'var(--text-muted)'}}>No upcoming events</div>;
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
                    <div style={{borderTop:'var(--bw-hair) solid var(--border)',marginTop:'var(--space-xs)',paddingTop:'var(--space-xs)'}}>
                      <div style={{padding:'var(--space-sm) var(--space-lg) var(--space-xs)',fontSize:'calc(var(--gu) * 1.060)',fontWeight: 'var(--fw-bold)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',fontFamily:'Univers Condensed, Univers, sans-serif'}}>
                        Upcoming Schedule ({upcoming.length} event{upcoming.length !== 1 ? 's' : ''})
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'auto auto auto auto 1fr auto',gap:'0 var(--space-sm)',padding:'0 var(--space-lg)',fontSize:'calc(var(--gu) * 1.178)',alignItems:'center'}}>
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
                                  <span style={{fontSize:'calc(var(--gu) * 1.060)',fontWeight:700,color:'var(--text-muted)',fontFamily:"'Libre Baskerville', Georgia, serif",whiteSpace:'nowrap',padding:'var(--space-xs) 0'}}>{i === 0 ? dayAbbr : ''}</span>
                                  <span style={{fontSize:'calc(var(--gu) * 1.060)',fontWeight:700,color:'var(--text)',fontFamily:"'Libre Baskerville', Georgia, serif",whiteSpace:'nowrap',padding:'var(--space-xs) 0'}}>{i === 0 ? dateLabel : ''}</span>
                                  <span style={{color: getVenueBrandColor(v.abbr),fontWeight: 'var(--fw-bold)',fontSize:'calc(var(--gu) * 0.957)',whiteSpace:'nowrap',textAlign:'center'}}>{v.abbr}</span>
                                  <span style={{color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.060)',whiteSpace:'nowrap',textAlign:'right'}}>{t.time || 'TBD'}</span>
                                  <span style={{color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{t.event_name}</span>
                                  <span style={{color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.060)',fontWeight: 'var(--fw-bold)',whiteSpace:'nowrap',textAlign:'right'}}>{formatBuyin(t.buyin, t.venue)}</span>
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
                  <div style={{boxShadow:'inset 0 calc(var(--subrow) * 0.125) 0 0 var(--border)',marginTop:'var(--space-xs)',padding:'var(--space-md) var(--gu)',display:'flex',flexDirection:'column',gap:'var(--space-md)'}}>
                    {myGroups && myGroups.length > 0 && (
                      addToGroupBuddyId === buddy.id ? (
                        <div>
                          <div style={{fontSize:'calc(var(--gu) * 1.060)',fontWeight: 'var(--fw-bold)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',fontFamily:'Univers Condensed, Univers, sans-serif',marginBottom:'var(--space-sm)'}}>
                            Add to Group
                          </div>
                          {myGroups.map(g => {
                            const status = inviteStatus[buddy.id]?.[g.id];
                            return (
                              <button
                                key={g.id}
                                disabled={!!status}
                                onClick={(e) => { e.stopPropagation(); handleInviteToGroup(buddy.id, g.id, buddy.username); }}
                                style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',
                                  padding:'var(--space-sm) var(--space-md)',background:'none',border:'var(--bw-hair) solid var(--border)',borderRadius:'calc(var(--subrow) * 0.75)',
                                  color:'var(--text)',cursor: status ? 'default' : 'pointer',fontSize:'calc(var(--gu) * 1.178)',marginBottom:'var(--space-xs)',
                                  opacity: status ? 0.6 : 1}}
                              >
                                <span>{g.name}</span>
                                <span style={{fontSize:'calc(var(--gu) * 1.060)',color: status === 'sent' ? '#22c55e' : status === 'member' ? 'var(--text-muted)' : status === 'error' ? '#ef4444' : 'var(--accent)'}}>
                                  {status === 'sent' ? 'Invited' : status === 'member' ? 'Already in group' : status === 'error' ? 'Failed' : 'Invite'}
                                </span>
                              </button>
                            );
                          })}
                          <button
                            onClick={(e) => { e.stopPropagation(); setAddToGroupBuddyId(null); }}
                            style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.104)',marginTop:'var(--space-xs)',padding:0}}
                          >Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setAddToGroupBuddyId(buddy.id); }}
                          style={{background:'none',border:'var(--bw-hair) solid var(--border)',borderRadius:'calc(var(--subrow) * 0.75)',
                            color:'var(--text)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.178)',height:'calc(var(--subrow) * 4)',lineHeight:'calc(var(--subrow) * 2)',padding:'0 var(--gu)',width:'100%',
                            fontFamily:'Univers Condensed, Univers, sans-serif'}}
                        >+ Add to Group</button>
                      )
                    )}
                    {confirmRemoveId === buddy.id ? (
                      <div style={{display:'flex',alignItems:'center',gap:'var(--space-md)',justifyContent:'space-between'}}>
                        <span style={{fontSize:'calc(var(--gu) * 1.104)',color:'#ef4444'}}>Remove {displayName(buddy)}?</span>
                        <div style={{display:'flex',gap:'var(--space-sm)'}}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(null); }}
                            style={{background:'none',border:'var(--bw-hair) solid var(--border)',borderRadius:'calc(var(--subrow) * 0.75)',
                              color:'var(--text-muted)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.104)',padding:'var(--space-xs) var(--space-ml)'}}
                          >Cancel</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onRemoveBuddy(buddy.id); setConfirmRemoveId(null); setExpandedId(null); }}
                            style={{background:'#b91c1c',border:'none',borderRadius:'calc(var(--subrow) * 0.75)',
                              color:'#fff',cursor:'pointer',fontSize:'calc(var(--gu) * 1.104)',padding:'var(--space-xs) var(--space-ml)',fontWeight: 'var(--fw-bold)'}}
                          >Remove</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(buddy.id); }}
                        style={{background:'none',border:'var(--bw-hair) solid var(--border)',borderRadius:'calc(var(--subrow) * 0.75)',
                          color:'#b91c1c',cursor:'pointer',fontSize:'calc(var(--gu) * 1.178)',height:'calc(var(--subrow) * 4)',lineHeight:'calc(var(--subrow) * 2)',padding:'0 var(--gu)',width:'100%',
                          fontFamily:'Univers Condensed, Univers, sans-serif'}}
                      >Remove Connection</button>
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
