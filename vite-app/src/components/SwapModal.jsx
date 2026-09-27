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
      <div style={{position:'relative',minHeight:'100%',display:'flex',alignItems:'center',justifyContent:'center',padding:'var(--space-3xl) var(--space-xl)'}}>
      <div style={{position:'relative',width:'100%',maxWidth:'calc(var(--subrow) * 47.5)',background:'var(--surface)',borderRadius:'var(--radius-lg)',padding:'var(--space-xl) var(--space-2xl)'}} onClick={e => e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',gap:'var(--space-ml)',marginBottom:'var(--space-lg)'}}>
          <Avatar src={buddy.avatar} username={buddy.username} size={32} />
          <div>
            <div style={{fontWeight:700,color:'var(--text)',fontSize:'calc(var(--gu) * 1.325)'}}>{dn(buddy)}</div>
            <div style={{color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.060)'}}>@{buddy.username}</div>
          </div>
        </div>
        <div style={{background:'var(--surface2)',borderRadius:'var(--radius-sm)',padding:'var(--space-md) var(--space-lg)',marginBottom:'var(--space-lg)',fontSize:'calc(var(--gu) * 1.208)'}}>
          <div style={{color:'var(--text)',fontWeight: 'var(--fw-bold)'}}>{tournament.event_name}</div>
          <div style={{color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.060)',marginTop:'var(--space-2xs)'}}>{tournament.date} · {tournament.time} · {formatBuyin(tournament.buyin, tournament.venue)}</div>
        </div>
        <div style={{display:'flex',gap:'var(--space-md)',marginBottom:'var(--space-lg)'}}>
          {['swap', 'crossbook'].map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              flex:1,padding:'var(--space-md)',borderRadius:'var(--radius-sm)',border:'var(--bw-hair) solid var(--border)',
              background: type === t ? 'var(--accent)' : 'var(--surface)',
              color: type === t ? 'var(--bg)' : 'var(--text)',
              fontWeight: 'var(--fw-bold)',fontSize:'calc(var(--gu) * 1.252)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',cursor:'pointer'
            }}>{t}</button>
          ))}
        </div>
        {type === 'swap' ? (
          <div style={{display:'flex',gap:'var(--space-lg)',marginBottom:'var(--space-lg)'}}>
            <div style={{flex:1}}>
              <label style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:'var(--space-xs)'}}>You give</label>
              <div style={{display:'flex',alignItems:'center',gap:'var(--space-xs)'}}>
                <input type="number" min="1" max="100" value={myPct} onChange={e => setMyPct(e.target.value)}
                  style={{width:'100%',padding:'var(--space-md)',background:'var(--surface2)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.473)',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>%</span>
              </div>
            </div>
            <div style={{flex:1}}>
              <label style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:'var(--space-xs)'}}>They give</label>
              <div style={{display:'flex',alignItems:'center',gap:'var(--space-xs)'}}>
                <input type="number" min="1" max="100" value={theirPct} onChange={e => setTheirPct(e.target.value)}
                  style={{width:'100%',padding:'var(--space-md)',background:'var(--surface2)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.473)',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>%</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{display:'flex',gap:'var(--space-lg)',marginBottom:'var(--space-lg)'}}>
            <div style={{flex:1}}>
              <label style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:'var(--space-xs)'}}>Percentage</label>
              <div style={{display:'flex',alignItems:'center',gap:'var(--space-xs)'}}>
                <input type="number" min="1" max="100" value={cbPct} onChange={e => setCbPct(e.target.value)}
                  style={{width:'100%',padding:'var(--space-md)',background:'var(--surface2)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.473)',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>%</span>
              </div>
            </div>
            <div style={{flex:1}}>
              <label style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:'var(--space-xs)'}}>Cap (optional)</label>
              <div style={{display:'flex',alignItems:'center',gap:'var(--space-xs)'}}>
                <input type="number" min="0" value={cbCap} onChange={e => setCbCap(e.target.value)} placeholder={'\u2014'}
                  style={{width:'100%',padding:'var(--space-md)',background:'var(--surface2)',border:'var(--bw-hair) solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text)',fontSize:'calc(var(--gu) * 1.473)',textAlign:'center'}} />
                <span style={{color:'var(--text-muted)',fontWeight: 'var(--fw-bold)'}}>{currencySymbol(tournament.venue)}</span>
              </div>
            </div>
          </div>
        )}
        {msg && <div style={{textAlign:'center',fontSize:'calc(var(--gu) * 1.208)',color: msg === 'Sent!' ? '#22c55e' : '#ef4444',marginBottom:'var(--space-sm)'}}>{msg}</div>}
        <button onClick={handleSend} disabled={sending} style={{
          width:'100%',padding:'var(--space-ml)',borderRadius:'calc(var(--subrow) * 1.25)',border:'none',
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
