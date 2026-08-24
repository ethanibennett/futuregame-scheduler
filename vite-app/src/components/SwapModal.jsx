import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';
import { useDisplayName } from '../contexts/DisplayNameContext.jsx';
import Avatar from './Avatar.jsx';
import { currencySymbol, formatBuyin } from '../utils/utils.js';

export default function SwapModal({ buddy, tournament, token, onClose }) {
  const dn = useDisplayName();
  const [type, setType] = useState('swap');
  const [myPct, setMyPct] = useState('5');
  const [theirPct, setTheirPct] = useState('5');
  const [cbPct, setCbPct] = useState('50');
  const [cbCap, setCbCap] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');

  const handleSend = async () => {
    setSending(true);
    setMsg('');
    const sendMyPct = type === 'crossbook' ? cbPct : myPct;
    const sendTheirPct = type === 'crossbook' ? cbPct : theirPct;
    try {
      const res = await fetch(`${API_URL}/swap-suggest`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ toUserId: buddy.id, tournamentId: tournament.id, type, myPct: sendMyPct, theirPct: sendTheirPct, cap: type === 'crossbook' && cbCap ? Number(cbCap) : undefined })
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || 'Failed'); setSending(false); return; }
      setMsg('Sent!');
      setTimeout(onClose, 800);
    } catch (e) { console.error('Send failed:', e); setMsg('Failed to send'); setSending(false); }
  };

  return createPortal(
    <div style={{position:'fixed',inset:0,zIndex:9999,overflowY:'auto',WebkitOverflowScrolling:'touch'}} onClick={onClose}>
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)'}} />
      <div style={{position:'relative',minHeight:'100%',display:'flex',alignItems:'center',justifyContent:'center',padding:'24px 16px'}}>
      <div style={{position:'relative',width:'100%',maxWidth:380,background:'var(--surface)',borderRadius:16,padding:'16px 20px'}} onClick={e => e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'12px'}}>
          <Avatar src={buddy.avatar} username={buddy.username} size={32} />
          <div>
            <div style={{fontWeight:700,color:'var(--text)',fontSize:'0.9rem'}}>{dn(buddy)}</div>
            <div style={{color:'var(--text-muted)',fontSize:'0.72rem'}}>@{buddy.username}</div>
          </div>
        </div>
        <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px 12px',marginBottom:'12px',fontSize:'0.82rem'}}>
          <div style={{color:'var(--text)',fontWeight: 'var(--fw-bold)'}}>{tournament.event_name}</div>
          <div style={{color:'var(--text-muted)',fontSize:'0.72rem',marginTop:2}}>{tournament.date} · {tournament.time} · {formatBuyin(tournament.buyin, tournament.venue)}</div>
        </div>
        <div style={{display:'flex',gap:'8px',marginBottom:'12px'}}>
          {['swap', 'crossbook'].map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              flex:1,padding:'8px',borderRadius:8,border:'1px solid var(--border)',
              background: type === t ? 'var(--accent)' : 'var(--surface)',
              color: type === t ? 'var(--bg)' : 'var(--text)',
              fontWeight: 'var(--fw-bold)',fontSize:'0.85rem',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',cursor:'pointer'
            }}>{t}</button>
          ))}
        </div>
        {type === 'swap' ? (
          <div style={{display:'flex',gap:'12px',marginBottom:'12px'}}>
            <div style={{flex:1}}>
              <label style={{fontSize:'0.7rem',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:4}}>You give</label>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <input type="number" min="1" max="100" value={myPct} onChange={e => setMyPct(e.target.value)}
                  style={{width:'100%',padding:'8px',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text)',fontSize:'1rem',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>%</span>
              </div>
            </div>
            <div style={{flex:1}}>
              <label style={{fontSize:'0.7rem',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:4}}>They give</label>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <input type="number" min="1" max="100" value={theirPct} onChange={e => setTheirPct(e.target.value)}
                  style={{width:'100%',padding:'8px',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text)',fontSize:'1rem',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>%</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{display:'flex',gap:'12px',marginBottom:'12px'}}>
            <div style={{flex:1}}>
              <label style={{fontSize:'0.7rem',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:4}}>Percentage</label>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <input type="number" min="1" max="100" value={cbPct} onChange={e => setCbPct(e.target.value)}
                  style={{width:'100%',padding:'8px',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text)',fontSize:'1rem',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>%</span>
              </div>
            </div>
            <div style={{flex:1}}>
              <label style={{fontSize:'0.7rem',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:4}}>Cap (optional)</label>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <input type="number" min="0" value={cbCap} onChange={e => setCbCap(e.target.value)} placeholder={'\u2014'}
                  style={{width:'100%',padding:'8px',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text)',fontSize:'1rem',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>{currencySymbol(tournament.venue)}</span>
              </div>
            </div>
          </div>
        )}
        {msg && <div style={{textAlign:'center',fontSize:'0.82rem',color: msg === 'Sent!' ? '#22c55e' : '#ef4444',marginBottom:6}}>{msg}</div>}
        <button onClick={handleSend} disabled={sending} style={{
          width:'100%',padding:'10px',borderRadius:10,border:'none',
          background:'var(--accent)',color:'var(--bg)',fontWeight:700,fontSize:'0.9rem',
          fontFamily:'Univers Condensed, Univers, sans-serif',cursor: sending ? 'wait' : 'pointer',opacity: sending ? 0.6 : 1
        }}>
          {sending ? 'Sending...' : `Send ${type === 'swap' ? 'Swap' : 'Crossbook'} Offer`}
        </button>
      </div>
      </div>
    </div>,
    document.body
  );
}
