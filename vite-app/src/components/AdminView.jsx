import React, { useState, useEffect, useRef } from 'react';
import GrowthReport from './GrowthReport.jsx';
import GrowthScorecard from './GrowthScorecard.jsx';
import ParserEval from './ParserEval.jsx';
import AdminInbox from './AdminInbox.jsx';
import { API_URL } from '../utils/api.js';

/* The users table's columns, with widths the viewer can drag (owner, 2026-11-21: "This table should have adjustable
   columns so that I can see the full username/email etc"). Each header's right edge is a handle: drag it (mouse or
   touch) and the column follows in whole g; double-click it to fit the column to its longest entry. Widths are kept
   on the device (localStorage, in g). Email takes what is left until it is set, and never less than 13g; once it is,
   a filler column before Joined takes the rest, so Joined stays on the table's right edge. A table wider than the
   pane scrolls sideways (its wrapper). Defaults 9g + 6g + the rest + 7g = 35g on a phone, as before. */
const ADMIN_COLS = [
  { key: 'username', label: 'Username', def: 9 },
  { key: 'real_name', label: 'Name', def: 6 },
  { key: 'email', label: 'Email', def: null },
  { key: 'created_at', label: 'Joined', def: 7, right: true },
];
const COL_MIN_G = 4;
const COL_MAX_G = 80;
const EMAIL_MIN_G = 13;
const COL_WIDTHS_KEY = 'adminColWidths';
const clampG = (n) => Math.max(COL_MIN_G, Math.min(COL_MAX_G, Math.round(n)));
function readColWidths() {
  try {
    const raw = JSON.parse(localStorage.getItem(COL_WIDTHS_KEY)) || {};
    const out = {};
    for (const c of ADMIN_COLS) if (Number.isFinite(raw[c.key])) out[c.key] = clampG(raw[c.key]);
    return out;
  } catch { return {}; }
}

export default function AdminView({ token, onNavigate }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  // A refused list says so (UX pick 105): a 403 read as "0 Users" told an app admin the app had none.
  const [refused, setRefused] = useState(false);
  const [filter, setFilter] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortAsc, setSortAsc] = useState(false);
  const [colW, setColW] = useState(readColWidths);
  const [resizing, setResizing] = useState(null); // the column being dragged
  const tableWrap = useRef(null);
  useEffect(() => { try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colW)); } catch { /* fine */ } }, [colW]);

  // One g in CSS pixels where the table sits, from a 100g probe (the drag arrives in pixels; widths are kept in g).
  const gPx = () => {
    const host = tableWrap.current;
    if (!host) return 0;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:0;width:calc(var(--gu) * 100)';
    host.appendChild(probe);
    const g = probe.getBoundingClientRect().width / 100;
    probe.remove();
    return g;
  };
  const startResize = (e, key) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const th = handle.parentElement;
    const g = gPx();
    if (!(g > 0) || !th) return;
    const startX = e.clientX;
    const startG = th.getBoundingClientRect().width / g;
    try { handle.setPointerCapture(e.pointerId); } catch { /* fine */ }
    setResizing(key);
    const move = (ev) => {
      const w = clampG(startG + (ev.clientX - startX) / g);
      setColW(prev => (prev[key] === w ? prev : { ...prev, [key]: w }));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setResizing(null);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  // Double-click: the column as wide as its longest entry (header included), in whole g.
  const fitColumn = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.parentElement;
    const table = th && th.closest('table');
    const g = gPx();
    if (!table || !(g > 0)) return;
    // A cell's own need: its text's laid-out extent (nowrap, so a cut entry is still laid out whole) plus its side
    // padding. Not scrollWidth, which never reads less than the column already is, so fit could only widen.
    const need = (cell) => {
      const cs = getComputedStyle(cell);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      let left = Infinity, right = -Infinity;
      const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent.trim() || (n.parentElement && n.parentElement.closest('.admin-avatar, .admin-col-handle'))) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const b = range.getBoundingClientRect();
        if (b.width > 0) { left = Math.min(left, b.left); right = Math.max(right, b.right); }
      }
      return pad + (right > left ? right - left : 0);
    };
    const idx = th.cellIndex;
    let widest = need(th);
    for (const row of table.tBodies[0] ? table.tBodies[0].rows : []) {
      const cell = row.cells[idx];
      if (cell) widest = Math.max(widest, need(cell));
    }
    const w = clampG(Math.ceil(widest / g));
    setColW(prev => ({ ...prev, [key]: w }));
  };
  const widthOf = (c) => colW[c.key] ?? c.def;
  const emailSet = colW.email != null;
  const fixedSum = ADMIN_COLS.reduce((s, c) => s + (widthOf(c) || 0), 0);
  const tableWidth = `max(100%, calc(var(--gu) * ${emailSet ? fixedSum : fixedSum + EMAIL_MIN_G}))`;

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
      <div ref={tableWrap} style={{overflowX:'auto',position:'relative'}}>
        <table className={'admin-table' + (resizing ? ' is-resizing' : '')} style={{width:tableWidth,borderCollapse:'separate',borderSpacing:0,fontSize:'calc(var(--gu) * 1.178)'}}>
          <colgroup>
            {/* Four columns, as the headers (UX pick 104), each its own width in g (ADMIN_COLS above);
                Email the free one until it is set, then a filler before Joined takes what is left. */}
            {ADMIN_COLS.map(c => (
              <React.Fragment key={c.key}>
                {c.key === 'created_at' && emailSet && <col className="admin-col-fill" />}
                <col style={widthOf(c) ? {width:`calc(var(--gu) * ${widthOf(c)})`} : undefined} />
              </React.Fragment>
            ))}
          </colgroup>
          <thead>
            <tr>
              {ADMIN_COLS.map(c => (
                <React.Fragment key={c.key}>
                  {c.key === 'created_at' && emailSet && <th className="admin-col-fill" aria-hidden="true" />}
                  <th style={c.right ? {textAlign:'right'} : undefined} onClick={() => handleSort(c.key)}>
                    {c.label}{sortArrow(c.key)}
                    <span className={'admin-col-handle' + (resizing === c.key ? ' is-active' : '')} role="separator" aria-orientation="vertical"
                      aria-label={`Resize the ${c.label} column`} title="Drag to resize; double-click to fit"
                      onPointerDown={(e) => startResize(e, c.key)} onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => fitColumn(e, c.key)} />
                  </th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(u => (
              <tr key={u.id}>
                <td className="admin-user-cell" title={u.username}>
                  {u.avatar ? (
                    <img className="admin-avatar" src={u.avatar} alt={u.username} />
                  ) : (
                    <div className="admin-avatar admin-avatar-fallback">
                      {(u.username || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <span style={{fontWeight: 'var(--fw-bold)',color:'var(--text)'}}>{u.username}</span>
                </td>
                <td style={{color:'var(--text-muted)'}} title={u.real_name || undefined}>{u.real_name || '\u2014'}</td>
                <td style={{color:'var(--text-muted)'}} title={u.email || undefined}>{u.email}</td>
                {emailSet && <td className="admin-col-fill" />}
                <td style={{color:'var(--text-muted)',textAlign:'right',whiteSpace:'nowrap'}} title={u.created_at}>{timeAgo(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && <div style={{height:'calc(var(--subrow) * 9)',lineHeight:'calc(var(--subrow) * 3)',padding:'calc(var(--subrow) * 2.75) var(--gu) 0',boxSizing:'border-box',textAlign:'center',color:'var(--text-muted)'}}>No users found</div>}
      </>)}
      <AdminInbox token={token} />
      <GrowthScorecard token={token} />
      <GrowthReport token={token} />
      <ParserEval token={token} />
    </div>
  );
}
