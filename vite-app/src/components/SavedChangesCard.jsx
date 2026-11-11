import React, { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../utils/api.js';

/* What changed in the saved events (Features 4, 2026-11-11): a card under My Schedule's header, one row per
   change the player has not seen, the old value struck through. Got it clears a row; an event the room no
   longer lists offers Remove (off My Schedule) and Keep. The changed cards carry a "Moved" tag until seen
   (`onChangedIds`). */
export default function SavedChangesCard({ token, onRemove, onChangedIds }) {
  const [changes, setChanges] = useState([]);
  const load = useCallback(() => {
    if (!token) return;
    fetch(`${API_URL}/event-changes`, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setChanges(d.changes || []); }).catch(() => {});
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (onChangedIds) onChangedIds(new Set(changes.filter((c) => c.field !== 'event_name').map((c) => c.tournament_id)));
  }, [changes, onChangedIds]);
  const seen = async (ids) => {
    setChanges((cs) => cs.filter((c) => !ids.includes(c.id)));
    await fetch(`${API_URL}/event-changes/seen`, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).catch(() => {});
  };
  if (!changes.length) return null;
  const fmt = (c, v) => (c.field === 'buyin' && v != null && v !== '' ? `$${Number(v).toLocaleString('en-US')}` : (v == null || v === '' ? '—' : v));
  return (
    <div className="chg-card" role="status">
      <div className="chg-label">{`Changed since you saved · ${changes.length}`}</div>
      {changes.map((c) => (
        <div key={c.id} className={'chg-row' + (c.field === 'gone' ? ' is-gone' : '')}>
          <div className="chg-text">
            <span className="chg-name">{c.event_name}</span>
            <span className="chg-what">
              {c.field === 'gone' ? 'No longer on the room’s schedule'
                : c.field === 'event_name' ? <>Renamed from <s>{c.old}</s></>
                  : <>{c.field === 'date' ? 'Date ' : c.field === 'time' ? 'Start ' : c.field === 'buyin' ? 'Buy-in ' : 'Late reg closes '}<s>{fmt(c, c.old)}</s>{' → '}{fmt(c, c.new)}</>}
            </span>
          </div>
          {c.field === 'gone' ? (
            <span className="chg-actions">
              <button type="button" className="btn btn-ghost ctl chg-btn chg-btn--danger" onClick={() => { if (onRemove) onRemove(c.tournament_id); seen([c.id]); }}><span>Remove</span></button>
              <button type="button" className="btn btn-ghost ctl chg-btn" onClick={() => seen([c.id])}><span>Keep</span></button>
            </span>
          ) : (
            <button type="button" className="btn btn-ghost ctl chg-btn" onClick={() => seen([c.id])}><span>Got it</span></button>
          )}
        </div>
      ))}
    </div>
  );
}
