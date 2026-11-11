import React, { useState, useEffect } from 'react';
import GrowthReport from './GrowthReport.jsx';
import ParserEval from './ParserEval.jsx';
import AdminInbox from './AdminInbox.jsx';
import { API_URL } from '../utils/api.js';

export default function AdminView({ token, onNavigate }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  // A refused list says so (UX pick 105): a 403 read as "0 Users" told an app admin the app had none.
  const [refused, setRefused] = useState(false);
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
        else if (res.status === 403) setRefused(true);
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

  // Six rows shaped like real rows, rather than a bare string in an app that
  // ships a full skeleton kit.
  if (loading) return (
    <div style={{ padding: 'var(--space-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {[0,1,2,3,4,5].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div className="skeleton skeleton-circle" style={{ width: 'calc(var(--subrow) * 3)', height: 'calc(var(--subrow) * 3)', animationDelay: `${i * 80}ms` }} />
          <div className="skeleton skeleton-text" style={{ flex: 1, height: 'calc(var(--subrow) * 1.5)', animationDelay: `${i * 80 + 40}ms` }} />
          <div className="skeleton skeleton-text" style={{ width: 'calc(var(--subrow) * 8.75)', height: 'calc(var(--subrow) * 1.5)', animationDelay: `${i * 80 + 80}ms` }} />
        </div>
      ))}
    </div>
  );

return (
    <div style={{padding:'calc(var(--subrow) * 2) 0',maxWidth:'100%'}}>
      {/* A 4r row with no offset: the button is its full height (on the r lines), its label
          centred; the title a trimmed block whose baseline lands 3r down, on a line. (The row
          used to be nudged 0.375r down to seat the title, which took the button off the grid.) */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',height:'calc(var(--subrow) * 4)',marginBottom:'calc(var(--subrow) * 2)'}}>
        {/* "Admin" (UX pick 104): the count goes with what it counts, the users, first under their own
            heading; the Hand Replayer button repeated the Hands tab. */}
        <h2 className="screen-title" style={{fontSize:'calc(var(--gu) * 1.767)',lineHeight:'calc(var(--subrow) * 3)',margin:0,paddingTop:'calc(var(--subrow) * 3 - 1cap)',textBoxTrim:'trim-both',textBoxEdge:'cap alphabetic'}}>
          Admin
        </h2>
      </div>
      <h3 className="an-cell an-sec admin-users-head">{refused ? 'Users' : `Users \u00b7 ${users.length}`}</h3>
      {refused ? (
        <p className="an-p admin-refused">The user list is open to event editors only.</p>
      ) : (<>
      <input
        type="text"
        placeholder="Filter by username, name, or email..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{width:'100%',height:'calc(var(--subrow) * 5)',lineHeight:'calc(var(--subrow) * 3)',padding:'0 var(--gu) var(--space-sm)',marginBottom:'calc(var(--subrow) * 2)',background:'var(--surface)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.252)',boxSizing:'border-box'}}
      />
      <div style={{overflowX:'auto'}}>
        <table className="admin-table" style={{width:'100%',borderCollapse:'separate',borderSpacing:0,fontSize:'calc(var(--gu) * 1.178)'}}>
          <colgroup>
            {/* Email takes whatever the table has over 26g (9g on a phone), so the columns after
                it stay on whole g on a wider pane too; Replayer is the 4g toggle's own column. */}
            {/* Four columns, as the headers (UX pick 104): the retired Replayer toggle's 4g col was
                still 4th, so Joined fell into it and every column was cut. 9g + 6g + 13g + 7g = 35g. */}
            <col style={{width:'calc(var(--gu) * 9)'}} />
            <col style={{width:'calc(var(--gu) * 6)'}} />
            <col />
            <col style={{width:'calc(var(--gu) * 7)'}} />
          </colgroup>
          <thead>
            <tr>
              <th onClick={() => handleSort('username')}>Username{sortArrow('username')}</th>
              <th onClick={() => handleSort('real_name')}>Name{sortArrow('real_name')}</th>
              <th onClick={() => handleSort('email')}>Email{sortArrow('email')}</th>
              <th style={{textAlign:'right'}} onClick={() => handleSort('created_at')}>Joined{sortArrow('created_at')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(u => (
              <tr key={u.id}>
                <td className="admin-user-cell">
                  {u.avatar ? (
                    <img className="admin-avatar" src={u.avatar} alt={u.username} />
                  ) : (
                    <div className="admin-avatar admin-avatar-fallback">
                      {(u.username || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <span style={{fontWeight: 'var(--fw-bold)',color:'var(--text)'}}>{u.username}</span>
                </td>
                <td style={{color:'var(--text-muted)'}}>{u.real_name || '\u2014'}</td>
                <td style={{color:'var(--text-muted)'}}>{u.email}</td>
                <td style={{color:'var(--text-muted)',textAlign:'right',whiteSpace:'nowrap'}} title={u.created_at}>{timeAgo(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && <div style={{height:'calc(var(--subrow) * 9)',lineHeight:'calc(var(--subrow) * 3)',padding:'calc(var(--subrow) * 2.75) var(--gu) 0',boxSizing:'border-box',textAlign:'center',color:'var(--text-muted)'}}>No users found</div>}
      </>)}
      <AdminInbox token={token} />
      <GrowthReport token={token} />
      <ParserEval token={token} />
    </div>
  );
}
