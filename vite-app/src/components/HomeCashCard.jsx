import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { useTick } from './CashLive.jsx';
import { setLiveSession } from '../hooks/useLiveCashSession.js';
import { formatClock, liveElapsed } from '../utils/cash-sessions.js';
import { cashCard } from '../utils/home-upnext.js';
import { fmtMoney } from '../utils/home.js';
import { getVenueInfo, getVenueBrandColor, CURRENCY_CONFIG, haptic } from '../utils/utils.js';
import { API_URL } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

// ── The running cash session, as the first Up Next card (verdict section 1(b); admins) ─────────
// While a session runs it leads the carousel, in the tournament card's own anatomy: the room on
// the strip, the game and stakes as the name with when it started under it, then three 9g x 6r
// boxes (the clock, what is in play, the last stack against what was in) and two actions. The bar
// above the nav (LiveCashBar) hides on the home, since this card says the same and more.
//   Update stack   turns the actions into a stack entry, sent to POST /api/cash-sessions/:id/stack
//                  (the same call the Cash view's live screen makes); the shared store
//                  (hooks/useLiveCashSession) takes the answer, so Results > Cash moves with it.
//   Cash out       opens that live screen with its cash-out panel open (tips, expenses, notes).
// Tapping the card elsewhere opens the live screen (not the end of a carousel drag: `dragged`).
export default function HomeCashCard({ session, stacks, skew = 0, token, onOpen, onCashOut, dragged = null }) {
  useTick(!!session);
  const toast = useToast();
  const [entry, setEntry] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const c = cashCard(session, stacks);
  if (!c) return null;
  const cur = CURRENCY_CONFIG[c.currency] || CURRENCY_CONFIG.USD;
  const money = (v) => fmtMoney(v, cur);
  const venue = c.room ? getVenueInfo(c.room) : null;
  const stripColor = venue ? getVenueBrandColor(venue.abbr) : undefined;
  const since = new Date(session.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const ok = amount !== '' && Number(amount) >= 0;

  const save = async (e) => {
    if (e) e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/cash-sessions/${c.id}/stack`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The stack was not saved');
      setLiveSession(data.session, null, data.stacks);
      haptic(25);
      setEntry(false);
      setAmount('');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  // A tap on the card opens the live screen; a tap on one of its controls is that control's.
  const open = (e) => {
    if (dragged && dragged()) return;
    if (e && e.target !== e.currentTarget && e.target.closest('button, input, select, textarea, a, label, form')) return;
    if (onOpen) onOpen();
  };

  return (
    <div className="dash-event-card playing hm-cash-card" role="button" tabIndex={0}
      aria-label={`Cash game running: ${c.name}${c.room ? ` at ${c.room}` : ''}. Open the live session`}
      onClick={open}
      onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
      <div className="dash-venue-strip" style={stripColor ? { background: stripColor } : undefined}>
        <span className="dash-t">{c.room || 'Cash game'}</span>
      </div>
      <div className="dash-card-content">
        <div className="dash-event-header">
          <div className="dash-event-title">
            <div className="dash-event-name"><span className="dash-t">{c.name}</span></div>
            <div className="dash-event-meta">
              <span><Icon.clock /><span className="dash-t">Since {since}{c.rebuys ? ` · ${c.rebuys} rebuy${c.rebuys === 1 ? '' : 's'}` : ''}</span></span>
            </div>
          </div>
        </div>

        <div className="dash-event-stats">
          <div className="dash-stat-box">
            <div className="dash-stat-value" role="timer">{formatClock(liveElapsed(session, Date.now(), skew))}</div>
            <div className="dash-stat-label">Session</div>
          </div>
          <div className="dash-stat-box">
            <div className="dash-stat-value">{money(c.inPlay)}</div>
            <div className="dash-stat-label">In play</div>
          </div>
          <div className="dash-stat-box" title={c.stack == null ? 'No stack update yet this session' : undefined}>
            <div className={'dash-stat-value' + (c.stack == null ? ' is-empty' : '')}>{c.stack == null ? '—' : money(c.stack)}</div>
            <div className="dash-stat-label">{c.stack == null ? 'No update yet' : `Stack ${fmtMoney(c.result, cur, { signed: true })}`}</div>
          </div>
        </div>

        {entry ? (
          <form className="hm-cash-entry" onSubmit={save}>
            <input className="hm-cash-input" type="number" inputMode="numeric" min="0" autoFocus aria-label={`Stack now (${c.currency})`}
              placeholder={c.stack != null ? String(c.stack) : String(c.inPlay)} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button type="submit" className="hm-cash-btn hm-cash-btn--brand" disabled={!ok || busy}><span className="dash-t">Save</span></button>
            <button type="button" className="hm-cash-btn" onClick={() => { setEntry(false); setAmount(''); }}><span className="dash-t">Cancel</span></button>
          </form>
        ) : (
          <div className="dash-status-row hm-cash-actions">
            <button type="button" className="hm-cash-btn" onClick={() => { haptic(); setEntry(true); }}><span className="dash-t">Update stack</span></button>
            <button type="button" className="hm-cash-btn hm-cash-btn--brand" onClick={() => { haptic(); if (onCashOut) onCashOut(); }}><span className="dash-t">Cash out</span></button>
          </div>
        )}
      </div>
    </div>
  );
}
