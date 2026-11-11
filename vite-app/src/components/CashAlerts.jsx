import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';
import useBackToClose from '../hooks/useBackToClose.js';

/* Cash game alerts (Features 14, 2026-11-11): from the Live board, "tell me when 2/5 PLO or bigger opens",
   "when the list is under 3", or "when an interest list starts", at any room or the ones picked. The server
   watches the board and pushes once per opening (two snapshots in a row, so a flicker does not count). */
const KIND = { opens: 'opens', short: 'list under', interest: 'interest list starts' };

export default function CashAlertsButton({ token, venues }) {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const load = useCallback(() => {
    fetch(`${API_URL}/cash-alerts`, { headers: { Authorization: 'Bearer ' + token } }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setAlerts(d.alerts || [])).catch(() => {});
  }, [token]);
  useEffect(() => { load(); }, [load]);
  const armed = alerts.filter((a) => a.on).length;
  return (
    <>
      <button type="button" className={'cb-refresh ca-btn' + (armed ? ' is-armed' : '')} onClick={() => setOpen(true)} aria-label="Game alerts">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {armed > 0 && <span className="ca-n">{armed}</span>}
      </button>
      {open && <CashAlertsSheet token={token} venues={venues} alerts={alerts} onChanged={load} onClose={() => setOpen(false)} />}
    </>
  );
}

function CashAlertsSheet({ token, venues, alerts, onChanged, onClose }) {
  useBackToClose(true, onClose);
  const games = useMemo(() => [...new Set((venues || []).flatMap((v) => (v.games || []).map((g) => g.gameType)).filter(Boolean))].sort(), [venues]);
  const [f, setF] = useState({ kind: 'opens', game: games[0] || 'NLH', minBb: '', threshold: '3', rooms: [] });
  const [adding, setAdding] = useState(false);
  const hdr = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const add = async () => {
    await fetch(`${API_URL}/cash-alerts`, { method: 'POST', headers: hdr, body: JSON.stringify({ ...f, minBb: f.minBb || null }) }).catch(() => {});
    setAdding(false); onChanged();
  };
  const toggle = async (a) => { await fetch(`${API_URL}/cash-alerts/${a.id}`, { method: 'PUT', headers: hdr, body: JSON.stringify({ on: !a.on }) }).catch(() => {}); onChanged(); };
  const remove = async (a) => { await fetch(`${API_URL}/cash-alerts/${a.id}`, { method: 'DELETE', headers: hdr }).catch(() => {}); onChanged(); };
  const roomName = (slug) => ((venues || []).find((v) => v.slug === slug) || {}).name || slug;
  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet hx-sheet" role="dialog" aria-label="Game alerts">
        <h3>Game alerts</h3>
        {alerts.map((a) => (
          <div key={a.id} className="tk-row">
            <span className="tk-main">
              <b>{`${a.game}${a.min_bb ? ` ${a.min_bb}+ big blind` : ''} ${KIND[a.kind]}${a.kind === 'short' ? ` ${a.threshold}` : ''}`}</b>
              <span>{a.rooms && a.rooms.length ? a.rooms.map(roomName).join(', ') : 'any room'}</span>
            </span>
            <span className="tk-acts">
              <button type="button" className={'settings-toggle' + (a.on ? ' on' : '')} role="switch" aria-checked={a.on} aria-label="On" onClick={() => toggle(a)} />
              <button type="button" className="tq-mark" onClick={() => remove(a)}><span>Delete</span></button>
            </span>
          </div>
        ))}
        {!alerts.length && !adding && <p className="mi-note">Nothing watched yet. The board is read about every 10 minutes; an alert counts a change once it shows twice.</p>}
        {adding ? (
          <div className="tk-form">
            <div className="tk-kinds">{Object.entries(KIND).map(([k, l]) => <button key={k} type="button" className={'hx-tag' + (f.kind === k ? ' is-on' : '')} onClick={() => setF({ ...f, kind: k })}><span>{l}</span></button>)}</div>
            <select value={f.game} onChange={(e) => setF({ ...f, game: e.target.value })} aria-label="Game">
              {(games.length ? games : ['NLH', 'PLO']).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <input inputMode="decimal" placeholder="Big blind at least (5 for 2/5), optional" value={f.minBb} onChange={(e) => setF({ ...f, minBb: e.target.value.replace(/[^\d.]/g, '') })} />
            {f.kind === 'short' && <input inputMode="numeric" placeholder="List under" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value.replace(/\D/g, '') })} />}
            <div className="hx-events">
              {(venues || []).map((v) => (
                <button key={v.slug} type="button" className={'hx-ev' + (f.rooms.includes(v.slug) ? ' is-on' : '')}
                  onClick={() => setF({ ...f, rooms: f.rooms.includes(v.slug) ? f.rooms.filter((x) => x !== v.slug) : [...f.rooms, v.slug] })}><span>{v.name}</span></button>
              ))}
            </div>
            <p className="mi-note">{f.rooms.length ? `${f.rooms.length} room${f.rooms.length === 1 ? '' : 's'}` : 'Any room (pick rooms to narrow it)'}</p>
            <div className="mi-btns">
              <button type="button" className="btn btn-ghost ctl mi-btn" onClick={() => setAdding(false)}><span>Cancel</span></button>
              <button type="button" className="btn btn-primary ctl mi-btn" onClick={add}><span>Save the alert</span></button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost ctl mi-btn tk-add" onClick={() => setAdding(true)}><span>+ New alert</span></button>
        )}
      </div>
    </>,
    document.body,
  );
}
