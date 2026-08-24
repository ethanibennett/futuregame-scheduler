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
          <h3 style={{margin:0,fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:1}}>Create Group</h3>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text)',fontSize:20,cursor:'pointer',padding:4}}>&#x2715;</button>
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
            <label className="create-group-label" style={{marginTop:12}}>Add Members</label>
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

        {error && <div style={{color:'#ef4444',fontSize:13,marginTop:8}}>{error}</div>}

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
        <div style={{flex:1}}>
          <div className="social-buddy-name" style={{fontSize:16}}>{group.name}</div>
          <div style={{fontSize:12,color:'var(--text-secondary)'}}>{group.member_count} member{group.member_count !== 1 ? 's' : ''}{group.owner_name ? ` \u00b7 Owner: ${group.owner_name}` : ''}</div>
        </div>
        {isOwner ? (
          <button onClick={handleDeleteGroup} style={{background:'none',border:'none',color:'var(--text-secondary)',fontSize:13,cursor:'pointer'}}>Delete</button>
        ) : (
          <button onClick={handleLeaveGroup} style={{background:'none',border:'none',color:'var(--text-secondary)',fontSize:13,cursor:'pointer'}}>Leave</button>
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
              <div style={{textAlign:'center',color:'var(--text-secondary)',padding:'40px 20px',fontSize:13}}>
                No messages yet. Say something!
              </div>
            ) : groupFeed.map((item, i) => (
              <div key={item.id || i} className={`group-feed-item ${item.type}`}>
                <Avatar src={item.avatar} username={item.username || '?'} size={28} />
                <div className="group-feed-item-body">
                  <div className="group-feed-item-header">
                    <span className="group-feed-item-name">{displayName(item)}</span>
                    <span className="group-feed-item-time">{timeAgo(item.created_at)}</span>
                  </div>
                  {item.type === 'message' ? (
                    <div className="group-feed-item-text">{item.content}</div>
                  ) : item.type === 'live-update' && item.liveData ? (
                    <div className="group-feed-item-text" style={{color:'var(--accent)',fontSize:12}}>
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
            <div style={{textAlign:'center',color:'var(--text-secondary)',padding:'40px 20px',fontSize:13}}>
              No members have scheduled any tournaments yet.
            </div>
          ) : groupSchedule.map(t => (
            <div key={t.id} className="group-schedule-card">
              <div className="group-schedule-card-top">
                <div>
                  <div style={{fontWeight: 'var(--fw-bold)',fontSize:14}}>{t.event_name}</div>
                  <div style={{fontSize:12,color:'var(--text-secondary)'}}>{t.date} \u00b7 {t.time} \u00b7 ${Number(t.buyin).toLocaleString()}</div>
                </div>
                <div style={{fontSize:11,color:'var(--text-secondary)'}}>{getVenueInfo(t.venue).abbr}</div>
              </div>
              <div className="group-schedule-members">
                {t.members.map(m => (
                  <div key={m.id} className="group-schedule-member" title={displayName(m)}>
                    <Avatar src={m.avatar} username={m.username} size={22} />
                  </div>
                ))}
                <span style={{fontSize:11,color:'var(--text-secondary)',marginLeft:4}}>
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
            <div style={{textAlign:'center',color:'var(--text-secondary)',padding:'40px 20px',fontSize:13}}>
              No results tracked yet. Members' tournament results will appear here.
            </div>
          ) : (() => {
            const maxWon = Math.max(...leaderboardData.map(m => m.total_won), 1);
            return leaderboardData.map((m, i) => (
              <div key={m.id} className="leaderboard-card">
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div className="leaderboard-rank">
                    {i === 0 ? '\ud83c\udfc6' : `#${i + 1}`}
                  </div>
                  <Avatar src={m.avatar} username={m.username} size={32} />
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight: 'var(--fw-bold)',fontSize:14}}>{displayName(m)}</div>
                    <div className="leaderboard-stats">
                      <span className={m.net_pl >= 0 ? 'leaderboard-net-pos' : 'leaderboard-net-neg'}>
                        {m.net_pl >= 0 ? '+' : ''}{formatBuyin(m.net_pl)} net
                      </span>
                      {' \u00b7 '}{m.cashes} cash{m.cashes !== 1 ? 'es' : ''}
                      {' \u00b7 '}{m.final_tables} FT{m.final_tables !== 1 ? 's' : ''}
                      {' \u00b7 '}{m.wins}W
                    </div>
                    <div className="leaderboard-bar-wrap">
                      <div className="leaderboard-bar" style={{width: `${Math.max((m.total_won / maxWon) * 100, 2)}%`}} />
                    </div>
                    <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
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
          <div style={{marginBottom:12}}>
            <button
              className="create-group-submit"
              style={{fontSize:13,padding:'8px 16px',marginBottom:8}}
              onClick={() => setShowAddMember(!showAddMember)}
            >
              {showAddMember ? 'Cancel' : '+ Invite Buddy'}
            </button>

            {showAddMember && (
              <div className="create-group-buddies" style={{marginBottom:12}}>
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
                    <span style={{marginLeft:'auto',fontSize:12,color:'var(--accent)'}}>Invite</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:1,fontFamily:'Univers Condensed, Univers, sans-serif',marginBottom:6}}>
            Members ({members.length || group.member_count})
          </div>
          {members.map(m => (
            <div key={m.id} className="group-member-card">
              <Avatar src={m.avatar} username={m.username} size={28} />
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight: 'var(--fw-regular)'}}>{displayName(m)}</div>
                {m.role === 'owner' && <div style={{fontSize:11,color:'var(--accent)'}}>Owner</div>}
              </div>
              {isOwner && m.role !== 'owner' && (
                <button onClick={() => handleRemoveMember(m.id)} style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:11}}>Remove</button>
              )}
            </div>
          ))}

          {/* Pending invites */}
          {pendingInvites.length > 0 && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:1,fontFamily:'Univers Condensed, Univers, sans-serif',marginBottom:6}}>
                Pending Invites
              </div>
              {pendingInvites.map(inv => (
                <div key={inv.id} className="group-member-card" style={{opacity:0.6}}>
                  <Avatar src={inv.avatar} username={inv.username} size={28} />
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight: 'var(--fw-regular)'}}>{displayName(inv)}</div>
                    <div style={{fontSize:11,color:'var(--text-muted)'}}>Invited by {inv.invited_by_real_name || inv.invited_by_username}</div>
                  </div>
                  <span style={{fontSize:11,color:'var(--text-muted)',fontStyle:'italic'}}>Pending</span>
                </div>
              ))}
            </div>
          )}

          {/* Owner settings */}
          {isOwner && (
            <div className="leaderboard-toggle-section">
              <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:1,fontFamily:'Univers Condensed, Univers, sans-serif',marginBottom:8}}>
                Owner Settings
              </div>
              <div className="leaderboard-toggle-row">
                <span style={{fontSize:13}}>Enable Leaderboard</span>
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
              style={{background:'none',border:'1px solid var(--border)',borderRadius:8,color:'#ef4444',cursor:'pointer',padding:'8px 16px',fontSize:13,width:'100%',marginTop:12}}
            >
              Leave Group
            </button>
          )}
          {isOwner && (
            <button
              onClick={handleDeleteGroup}
              style={{background:'none',border:'1px solid #ef4444',borderRadius:8,color:'#ef4444',cursor:'pointer',padding:'8px 16px',fontSize:13,width:'100%',marginTop:12}}
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
    <div style={{position:'relative',marginBottom:'12px'}}>
      <input
        type="text"
        placeholder="Search by username or name..."
        value={searchQuery}
        onChange={e => handleSearchChange(e.target.value)}
        style={{
          width:'100%',boxSizing:'border-box',padding:'8px 12px',
          border:'1.5px solid var(--border)',borderRadius:'var(--radius-sm)',
          background:'var(--bg)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif",
          fontSize:'0.82rem',outline:'none',
        }}
      />
      {searchMsg && (
        <div style={{fontSize:'0.7rem',color:'var(--accent)',fontFamily:"'Univers Condensed','Univers',sans-serif",marginTop:'4px'}}>{searchMsg}</div>
      )}
      {(searchResults.length > 0 || searchLoading) && searchQuery.trim().length >= 2 && (
        <div style={{
          position:'absolute',top:'100%',left:0,right:0,zIndex:20,
          background:'var(--surface)',border:'1px solid var(--border)',
          borderRadius:'var(--radius-sm)',marginTop:'2px',
          maxHeight:'240px',overflowY:'auto',
          boxShadow:'0 4px 16px rgba(0,0,0,0.3)',
        }}>
          {searchLoading && !searchResults.length && (
            <div style={{padding:'10px 12px',fontSize:'0.75rem',color:'var(--text-muted)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>Searching...</div>
          )}
          {searchResults.map(u => (
            <div key={u.id} style={{
              display:'flex',alignItems:'center',gap:'8px',padding:'8px 12px',
              borderBottom:'1px solid var(--border)',cursor:'default',
            }}>
              <Avatar src={u.avatar} username={u.username} size={28} />
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:'0.78rem',fontWeight: 'var(--fw-bold)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif",overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {u.real_name || u.username}
                </div>
                {u.real_name && (
                  <div style={{fontSize:'0.62rem',color:'var(--text-muted)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>@{u.username}</div>
                )}
              </div>
              <button
                onClick={() => handleSendRequest(u.username)}
                style={{
                  padding:'3px 10px',borderRadius:'6px',border:'1px solid var(--accent)',
                  background:'transparent',color:'var(--accent)',fontFamily:"'Univers Condensed','Univers',sans-serif",
                  fontSize:'0.65rem',cursor:'pointer',whiteSpace:'nowrap',
                }}
              >Connect</button>
            </div>
          ))}
          {!searchLoading && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
            <div style={{padding:'10px 12px',fontSize:'0.75rem',color:'var(--text-muted)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>No users found</div>
          )}
        </div>
      )}
    </div>
  );

  const shareSection = (
    <>
      <div className="dashboard-section-header" style={{marginBottom:'8px',marginTop:20}}>
        <div className="dashboard-section-title">Share</div>
      </div>
      <div style={{
        background:'var(--surface)',border:'1px solid var(--border)',
        borderRadius:'var(--radius-sm)',padding:'16px 14px',
        textAlign:'center',color:'var(--text-muted)',fontSize:'0.78rem',
        lineHeight:1.5,
      }}>
        Social media integrations coming soon
      </div>
    </>
  );

  if (!hasBuddies && !hasGroups) {
    return (
      <div style={{maxWidth:'600px',margin:'0 auto'}}>
        <div className="dashboard-section-header" style={{marginBottom:'12px'}}>
          <div className="dashboard-section-title">Connections</div>
        </div>
        {searchBar}
        <div style={{textAlign:'center',color:'var(--text-muted)',fontSize:'0.82rem',padding:'24px 0'}}>
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
      <div className="dashboard-section-header" style={{marginBottom:'8px'}}>
        <div className="dashboard-section-title">Groups</div>
        {hasBuddies && (
          <button
            className="dashboard-section-badge"
            style={{cursor:'pointer',background:'var(--accent)',color:'#fff',border:'none',borderRadius:12,padding:'2px 10px',fontSize:12,fontWeight:700}}
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
            <span style={{marginLeft:'auto',color:'var(--text-secondary)',fontSize:18}}>&rsaquo;</span>
          </div>
        </button>
      )) : (
        <div style={{color:'var(--text-secondary)',fontSize:13,padding:'8px 0 16px'}}>
          {hasBuddies ? 'No groups yet. Create one to share schedules and chat with friends.' : 'Add connections first to create groups.'}
        </div>
      )}

      {/* Connections section */}
      <div className="dashboard-section-header" style={{marginBottom:'8px',marginTop:12}}>
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
                  <Avatar src={buddy.avatar} username={buddy.username} size={36} />
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
                  <span style={{marginLeft:'auto',color:'var(--text-muted)',fontSize:'0.7rem',transition:'transform 0.15s',transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'}}>&#x25BC;</span>
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
                    return <div style={{padding:'12px',fontSize:'0.8rem',color:'var(--text-muted)'}}>Loading schedule...</div>;
                  }
                  if (!sched || sched.length === 0) {
                    return <div style={{padding:'12px',fontSize:'0.8rem',color:'var(--text-muted)'}}>No events scheduled</div>;
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
                    return <div style={{padding:'12px',fontSize:'0.8rem',color:'var(--text-muted)'}}>No upcoming events</div>;
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
                    <div style={{borderTop:'1px solid var(--border)',marginTop:'4px',paddingTop:'4px'}}>
                      <div style={{padding:'6px 12px 4px',fontSize:'0.72rem',fontWeight: 'var(--fw-bold)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',fontFamily:'Univers Condensed, Univers, sans-serif'}}>
                        Upcoming Schedule ({upcoming.length} event{upcoming.length !== 1 ? 's' : ''})
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'auto auto auto auto 1fr auto',gap:'0 6px',padding:'0 12px',fontSize:'0.8rem',alignItems:'center'}}>
                      {groups.map(group => {
                        const dateObj = new Date(group.date + 'T12:00:00');
                        const dayAbbr = group.date === todayISO ? '' : ['Su','M','Tu','W','Th','F','Sa'][dateObj.getDay()];
                        const dateLabel = group.date === todayISO ? 'Today' :
                          ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dateObj.getMonth()] + ' ' + dateObj.getDate();
                        return (
                          <React.Fragment key={group.date}>
                            {group.events.map((t, i) => {
                              const v = getVenueInfo(t.venue);
                              return (
                                <React.Fragment key={t.id}>
                                  <span style={{fontSize:'0.72rem',fontWeight:700,color:'var(--text-muted)',fontFamily:"'Libre Baskerville', Georgia, serif",whiteSpace:'nowrap',padding:'4px 0'}}>{i === 0 ? dayAbbr : ''}</span>
                                  <span style={{fontSize:'0.72rem',fontWeight:700,color:'var(--text)',fontFamily:"'Libre Baskerville', Georgia, serif",whiteSpace:'nowrap',padding:'4px 0'}}>{i === 0 ? dateLabel : ''}</span>
                                  <span style={{color: getVenueBrandColor(v.abbr),fontWeight: 'var(--fw-bold)',fontSize:'0.65rem',whiteSpace:'nowrap',textAlign:'center'}}>{v.abbr}</span>
                                  <span style={{color:'var(--text-muted)',fontSize:'0.72rem',whiteSpace:'nowrap',textAlign:'right'}}>{t.time || 'TBD'}</span>
                                  <span style={{color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{t.event_name}</span>
                                  <span style={{color:'var(--text-muted)',fontSize:'0.72rem',fontWeight: 'var(--fw-bold)',whiteSpace:'nowrap',textAlign:'right'}}>{formatBuyin(t.buyin, t.venue)}</span>
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
                  <div style={{borderTop:'1px solid var(--border)',marginTop:'4px',padding:'8px 12px',display:'flex',flexDirection:'column',gap:'6px'}}>
                    {myGroups && myGroups.length > 0 && (
                      addToGroupBuddyId === buddy.id ? (
                        <div>
                          <div style={{fontSize:'0.72rem',fontWeight: 'var(--fw-bold)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',fontFamily:'Univers Condensed, Univers, sans-serif',marginBottom:'6px'}}>
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
                                  padding:'6px 8px',background:'none',border:'1px solid var(--border)',borderRadius:'6px',
                                  color:'var(--text)',cursor: status ? 'default' : 'pointer',fontSize:'0.8rem',marginBottom:'4px',
                                  opacity: status ? 0.6 : 1}}
                              >
                                <span>{g.name}</span>
                                <span style={{fontSize:'0.72rem',color: status === 'sent' ? '#22c55e' : status === 'member' ? 'var(--text-muted)' : status === 'error' ? '#ef4444' : 'var(--accent)'}}>
                                  {status === 'sent' ? 'Invited' : status === 'member' ? 'Already in group' : status === 'error' ? 'Failed' : 'Invite'}
                                </span>
                              </button>
                            );
                          })}
                          <button
                            onClick={(e) => { e.stopPropagation(); setAddToGroupBuddyId(null); }}
                            style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'0.75rem',marginTop:'4px',padding:0}}
                          >Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setAddToGroupBuddyId(buddy.id); }}
                          style={{background:'none',border:'1px solid var(--border)',borderRadius:'6px',
                            color:'var(--text)',cursor:'pointer',fontSize:'0.8rem',padding:'6px 12px',width:'100%',
                            fontFamily:'Univers Condensed, Univers, sans-serif'}}
                        >+ Add to Group</button>
                      )
                    )}
                    {confirmRemoveId === buddy.id ? (
                      <div style={{display:'flex',alignItems:'center',gap:'8px',justifyContent:'space-between'}}>
                        <span style={{fontSize:'0.75rem',color:'#ef4444'}}>Remove {displayName(buddy)}?</span>
                        <div style={{display:'flex',gap:'6px'}}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(null); }}
                            style={{background:'none',border:'1px solid var(--border)',borderRadius:'6px',
                              color:'var(--text-muted)',cursor:'pointer',fontSize:'0.75rem',padding:'4px 10px'}}
                          >Cancel</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onRemoveBuddy(buddy.id); setConfirmRemoveId(null); setExpandedId(null); }}
                            style={{background:'#b91c1c',border:'none',borderRadius:'6px',
                              color:'#fff',cursor:'pointer',fontSize:'0.75rem',padding:'4px 10px',fontWeight: 'var(--fw-bold)'}}
                          >Remove</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(buddy.id); }}
                        style={{background:'none',border:'1px solid var(--border)',borderRadius:'6px',
                          color:'#b91c1c',cursor:'pointer',fontSize:'0.8rem',padding:'6px 12px',width:'100%',
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
