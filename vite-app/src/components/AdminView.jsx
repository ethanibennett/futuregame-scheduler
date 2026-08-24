import React, { useState, useEffect } from 'react';
import { API_URL } from '../utils/api.js';

export default function AdminView({ token, onNavigate }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/admin/users-list`, {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (res.ok) setUsers(await res.json());
      } catch {}
      setLoading(false);
    })();
  }, [token]);

  const timeAgo = (dateStr) => {
    if (!dateStr) return '\u2014';
    const now = new Date();
    const d = new Date(dateStr);
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const filtered = users.filter(u => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (u.username || '').toLowerCase().includes(q) ||
           (u.real_name || '').toLowerCase().includes(q) ||
           (u.email || '').toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortField] || '', bv = b[sortField] || '';
    if (sortField === 'created_at') { av = new Date(av); bv = new Date(bv); }
    else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });

  const handleSort = (field) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(field !== 'created_at'); }
  };

  const sortArrow = (field) => sortField === field ? (sortAsc ? ' \u25b2' : ' \u25bc') : '';

  const toggleReplayerAccess = async (userId, enabled) => {
    try {
      await fetch(`${API_URL}/admin/users/${userId}/replayer-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ enabled })
      });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, hand_replayer_access: enabled ? 1 : 0 } : u));
    } catch (e) {
      console.error('Toggle replayer access error:', e);
    }
  };

  // Six rows shaped like real rows, rather than a bare string in an app that
  // ships a full skeleton kit.
  if (loading) return (
    <div style={{ padding: 'var(--space-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {[0,1,2,3,4,5].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div className="skeleton skeleton-circle" style={{ width: 24, height: 24, animationDelay: `${i * 80}ms` }} />
          <div className="skeleton skeleton-text" style={{ flex: 1, height: 12, animationDelay: `${i * 80 + 40}ms` }} />
          <div className="skeleton skeleton-text" style={{ width: 70, height: 12, animationDelay: `${i * 80 + 80}ms` }} />
        </div>
      ))}
    </div>
  );

return (
    <div style={{padding:'16px',maxWidth:'100%'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <h2 style={{fontFamily:'var(--font-condensed)',fontWeight:700,fontSize:'1.2rem',color:'var(--text)',margin:0}}>
          ADMIN &mdash; {users.length} Users
        </h2>
        {onNavigate && (
          <button onClick={() => onNavigate('hands')} style={{padding:'6px 12px',borderRadius:'var(--radius-sm)',border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:'0.78rem',fontFamily:'var(--font-condensed)',fontWeight: 'var(--fw-bold)',cursor:'pointer'}}>
            Hand Replayer
          </button>
        )}
      </div>
      <input
        type="text"
        placeholder="Filter by username, name, or email..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{width:'100%',padding:'8px 12px',marginBottom:'12px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'8px',color:'var(--text)',fontSize:'0.85rem',boxSizing:'border-box'}}
      />
      <div style={{overflowX:'auto'}}>
        <table className="admin-table" style={{width:'100%',borderCollapse:'collapse',fontSize:'0.8rem'}}>
          <thead>
            <tr>
              <th onClick={() => handleSort('username')}>Username{sortArrow('username')}</th>
              <th onClick={() => handleSort('real_name')}>Name{sortArrow('real_name')}</th>
              <th onClick={() => handleSort('email')}>Email{sortArrow('email')}</th>
              <th style={{textAlign:'center',cursor:'default'}}>Replayer</th>
              <th style={{textAlign:'right'}} onClick={() => handleSort('created_at')}>Joined{sortArrow('created_at')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(u => (
              <tr key={u.id}>
                <td style={{padding:'8px',display:'flex',alignItems:'center',gap:'8px'}}>
                  {u.avatar ? (
                    <img src={u.avatar} style={{width:24,height:24,borderRadius:'50%',objectFit:'cover'}} alt={u.username} />
                  ) : (
                    <div style={{width:24,height:24,borderRadius:'50%',background:'var(--accent)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.65rem',fontWeight:700,color:'var(--bg)'}}>
                      {(u.username || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <span style={{fontWeight: 'var(--fw-bold)',color:'var(--text)'}}>{u.username}</span>
                </td>
                <td style={{padding:'8px',color:'var(--text-muted)'}}>{u.real_name || '\u2014'}</td>
                <td style={{padding:'8px',color:'var(--text-muted)',fontSize:'0.75rem'}}>{u.email}</td>
                <td style={{padding:'8px',textAlign:'center'}}>
                  <button
                    onClick={() => toggleReplayerAccess(u.id, !u.hand_replayer_access)}
                    className={'settings-toggle admin-toggle' + (u.hand_replayer_access ? ' on' : '')}
                    aria-pressed={!!u.hand_replayer_access}
                    aria-label={`Replayer access for ${u.username}`}>
                  </button>
                </td>
                <td style={{padding:'8px',color:'var(--text-muted)',textAlign:'right',whiteSpace:'nowrap'}} title={u.created_at}>{timeAgo(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && <div style={{padding:'20px',textAlign:'center',color:'var(--text-muted)'}}>No users found</div>}
    </div>
  );
}
