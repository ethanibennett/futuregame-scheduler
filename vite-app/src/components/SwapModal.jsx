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
      <div style={{position:'relative',minHeight:'100%',display:'flex',alignItems:'center',justifyContent:'center',padding:'var(--space-3xl) var(--gu)'}}>
      {/* On the grid (owner rule, 2026-10-10): 33g wide, 29g inside 2g sides, every row inside a
          whole number of r; snap-place (utils/grid-snap.js) sets the centred box on the lines. */}
      <div className="snap-place" style={{position:'relative',width:'calc(var(--gu) * 33)',maxWidth:'100%',boxSizing:'border-box',background:'var(--surface)',borderRadius:'var(--radius-lg)',padding:'calc(var(--subrow) * 2) calc(var(--gu) * 2)'}} onClick={e => e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',gap:'var(--space-ml)',height:'calc(var(--subrow) * 5)',marginBottom:'calc(var(--subrow) * 2)'}}>
          <Avatar src={buddy.avatar} username={buddy.username} size={32} />
          <div>
            <div style={{fontWeight:700,color:'var(--text)',fontSize:'calc(var(--gu) * 1.325)'}}>{dn(buddy)}</div>
            <div style={{color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.060)'}}>@{buddy.username}</div>
          </div>
        </div>
        <div style={{background:'var(--surface2)',borderRadius:'var(--radius-sm)',padding:'var(--space-md) var(--space-lg)',marginBottom:'calc(var(--subrow) * 2)',fontSize:'calc(var(--gu) * 1.208)',lineHeight:'calc(var(--subrow) * 2)'}}>
          <div style={{color:'var(--text)',fontWeight: 'var(--fw-bold)'}}>{tournament.event_name}</div>
          <div style={{color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.060)'}}>{tournament.date} · {tournament.time} · {formatBuyin(tournament.buyin, tournament.venue)}</div>
        </div>
        {/* Two 14g x 4r segments, 1g apart, their labels centred. */}
        <div style={{display:'flex',gap:'var(--gu)',marginBottom:'calc(var(--subrow) * 2)'}}>
          {['swap', 'crossbook'].map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              flex:1,display:'flex',alignItems:'center',justifyContent:'center',height:'calc(var(--subrow) * 4)',boxSizing:'border-box',lineHeight:1,
              padding:0,borderRadius:'var(--radius-sm)',border:'var(--bw-hair) solid var(--border)',
              background: type === t ? 'var(--accent)' : 'var(--surface)',
              color: type === t ? 'var(--bg)' : 'var(--text)',
              fontWeight: 'var(--fw-bold)',fontSize:'calc(var(--gu) * 1.252)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',cursor:'pointer'
            }}>{t}</button>
          ))}
        </div>
        {type === 'swap' ? (
          <div style={{display:'flex',gap:'var(--space-lg)',marginBottom:'calc(var(--subrow) * 2)'}}>
            <div style={{flex:1}}>
              <label style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',lineHeight:'calc(var(--subrow) * 2)',marginBottom:'var(--space-xs)'}}>You give</label>
              <div style={{display:'flex',alignItems:'center',gap:'var(--space-xs)'}}>
                <input type="number" min="1" max="100" value={myPct} onChange={e => setMyPct(e.target.value)}
                  style={{width:'100%',height:'calc(var(--subrow) * 4.5)',boxSizing:'border-box',padding:'0 var(--space-md)',background:'var(--surface2)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.473)',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>%</span>
              </div>
            </div>
            <div style={{flex:1}}>
              <label style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',lineHeight:'calc(var(--subrow) * 2)',marginBottom:'var(--space-xs)'}}>They give</label>
              <div style={{display:'flex',alignItems:'center',gap:'var(--space-xs)'}}>
                <input type="number" min="1" max="100" value={theirPct} onChange={e => setTheirPct(e.target.value)}
                  style={{width:'100%',height:'calc(var(--subrow) * 4.5)',boxSizing:'border-box',padding:'0 var(--space-md)',background:'var(--surface2)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.473)',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>%</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{display:'flex',gap:'var(--space-lg)',marginBottom:'calc(var(--subrow) * 2)'}}>
            <div style={{flex:1}}>
              <label style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',lineHeight:'calc(var(--subrow) * 2)',marginBottom:'var(--space-xs)'}}>Percentage</label>
              <div style={{display:'flex',alignItems:'center',gap:'var(--space-xs)'}}>
                <input type="number" min="1" max="100" value={cbPct} onChange={e => setCbPct(e.target.value)}
                  style={{width:'100%',height:'calc(var(--subrow) * 4.5)',boxSizing:'border-box',padding:'0 var(--space-md)',background:'var(--surface2)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.473)',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>%</span>
              </div>
            </div>
            <div style={{flex:1}}>
              <label style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',lineHeight:'calc(var(--subrow) * 2)',marginBottom:'var(--space-xs)'}}>Cap (optional)</label>
              <div style={{display:'flex',alignItems:'center',gap:'var(--space-xs)'}}>
                <input type="number" min="0" value={cbCap} onChange={e => setCbCap(e.target.value)} placeholder={'\u2014'}
                  style={{width:'100%',height:'calc(var(--subrow) * 4.5)',boxSizing:'border-box',padding:'0 var(--space-md)',background:'var(--surface2)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.473)',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>{currencySymbol(tournament.venue)}</span>
              </div>
            </div>
          </div>
        )}
        {msg && <div style={{textAlign:'center',fontSize:'calc(var(--gu) * 1.208)',lineHeight:'calc(var(--subrow) * 2)',color: msg === 'Sent!' ? '#22c55e' : '#ef4444',marginBottom:'var(--subrow)'}}>{msg}</div>}
        {/* 29g x 5r, the label centred. */}
        <button onClick={handleSend} disabled={sending} style={{
          display:'flex',alignItems:'center',justifyContent:'center',width:'100%',height:'calc(var(--subrow) * 5)',boxSizing:'border-box',lineHeight:1,
          padding:0,borderRadius:'calc(var(--subrow) * 1.25)',border:'none',
          background:'var(--accent)',color:'var(--bg)',fontWeight:700,fontSize:'calc(var(--gu) * 1.325)',
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
