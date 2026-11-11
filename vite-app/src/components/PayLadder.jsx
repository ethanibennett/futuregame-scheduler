import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';
import { ladder } from '../utils/pay-ladder.js';
import { formatBuyin } from '../utils/utils.js';
import useBackToClose from '../hooks/useBackToClose.js';

/* The pay ladder in the money (Features 13, 2026-11-11): on the playing card once the player is in the
   money, what the next player out takes, the next two jumps and how many more must go first, the final
   table and first, from a board the player types once (the room's board, when it was typed). */
function BoardSheet({ rows, onSave, onClose }) {
  useBackToClose(true, onClose);
  const [list, setList] = useState(() => {
    const base = (rows || []).map((r) => ({ from: String(r.from), to: String(r.to === r.from ? '' : r.to), amount: String(r.amount) }));
    while (base.length < 12) base.push({ from: '', to: '', amount: '' });
    return base;
  });
  const set = (i, k, v) => setList((l) => l.map((r, j) => (j === i ? { ...r, [k]: v.replace(/[^\d]/g, '') } : r)));
  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet pl-sheet" role="dialog" aria-label="The payouts board">
        <h3>The payouts board</h3>
        <p className="pl-sub">Places and what they pay, as the room posts them. 1st first; a range like 10 to 12 pays each the same.</p>
        <div className="pl-grid">
          <span className="pl-h">Place</span><span className="pl-h">to</span><span className="pl-h">Pays</span>
          {list.map((r, i) => (
            <React.Fragment key={i}>
              <input inputMode="numeric" value={r.from} placeholder={String(i + 1)} onChange={(e) => set(i, 'from', e.target.value)} aria-label={`Row ${i + 1} place`} />
              <input inputMode="numeric" value={r.to} placeholder="" onChange={(e) => set(i, 'to', e.target.value)} aria-label={`Row ${i + 1} to place`} />
              <input inputMode="numeric" value={r.amount} placeholder="0" onChange={(e) => set(i, 'amount', e.target.value)} aria-label={`Row ${i + 1} pays`} />
            </React.Fragment>
          ))}
        </div>
        <div className="rp-actions">
          <button type="button" className="btn btn-ghost ctl rp-btn" onClick={() => setList((l) => [...l, ...Array.from({ length: 6 }, () => ({ from: '', to: '', amount: '' }))])}><span>More rows</span></button>
          <button type="button" className="btn btn-primary ctl rp-btn" onClick={() => onSave(list.filter((r) => r.from && r.amount).map((r) => ({ from: Number(r.from), to: Number(r.to || r.from), amount: Number(r.amount) })))}><span>Save</span></button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export default function PayLadder({ token, event, left }) {
  const [board, setBoard] = useState(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => {
    if (!token) return;
    fetch(`${API_URL}/event-payouts/${event.id}`, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setBoard(d)).catch(() => {});
  }, [token, event.id]);
  useEffect(() => { load(); }, [load]);
  const save = async (rows) => {
    setEditing(false);
    const r = await fetch(`${API_URL}/event-payouts/${event.id}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) }).catch(() => null);
    if (r && r.ok) setBoard(await r.json());
  };
  const m = (n) => formatBuyin(n, event.venue);
  const L = board && board.rows ? ladder(board.rows, left) : null;
  return (
    <div className="pl-block" data-money-zone="" onClick={(e) => e.stopPropagation()}>
      <div className="pl-label">{L ? `In the money · ${L.paid} paid` : 'In the money'}</div>
      {!L && <div className="pl-row"><span>Type the room’s payouts board for the next out and the jumps.</span></div>}
      {L && left > 0 && (
        <>
          {L.nextOut != null && <div className="pl-row"><span>{`The next out (${left}${left === 1 ? 'st' : left === 2 ? 'nd' : left === 3 ? 'rd' : 'th'})`}</span><b>{m(L.nextOut)}</b></div>}
          {L.jumps.map((j) => <div key={j.place} className="pl-row"><span>{`Next jump, ${j.moreOut} more out`}</span><b>{m(j.amount)}</b></div>)}
          {L.ft != null && L.paid >= 9 && <div className="pl-row"><span>Final table</span><b>{m(L.ft)}</b></div>}
          {L.first != null && <div className="pl-row"><span>First</span><b>{m(L.first)}</b></div>}
        </>
      )}
      <div className="pl-foot">
        <span>{board && board.updatedAt ? `Your board, typed ${new Date(board.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${left ? ` · ${left} left` : ''}` : 'Places left come from the room’s clock or your count'}</span>
        <button type="button" className="seat-btn" onClick={() => setEditing(true)}><span className="dash-t">{board && board.rows ? 'Edit board' : 'Type the board'}</span></button>
      </div>
      {editing && <BoardSheet rows={board && board.rows} onSave={save} onClose={() => setEditing(false)} />}
    </div>
  );
}
