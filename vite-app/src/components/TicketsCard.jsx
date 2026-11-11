import React, { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { normaliseDate } from '../utils/utils.js';

/* Tickets (Features 16, 2026-11-11): satellite seats, tournament chips and vouchers kept, valued and used. A
   seat won at a satellite can count as that result's cash: the seat is winnings at its value, and the entry it
   pays for keeps its buy-in, so the two net to zero in the bankroll and the tax report. */
export default function TicketsCard({ token, events }) {
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ kind: 'seat', value: '', target: '', expiresOn: '', sourceEntryId: '', countAsCash: true });
  const [using, setUsing] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    fetch(`${API_URL}/tickets`, { headers: { Authorization: 'Bearer ' + token } }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setList(d.tickets || [])).catch(() => {});
  }, [token]);
  useEffect(() => { load(); }, [load]);
  const sats = (events || []).filter((e) => e && (e.is_satellite || /satellite|sat\b|mega/i.test(e.event_name || ''))).slice(0, 30);
  const recent = (events || []).filter((e) => e && e.id).slice(0, 40);
  const save = async () => {
    setErr('');
    const r = await fetch(`${API_URL}/tickets`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...f, value: Number(String(f.value).replace(/[^\d.]/g, '')), sourceEntryId: f.sourceEntryId ? Number(f.sourceEntryId) : null }),
    }).catch(() => null);
    const d = r && (await r.json().catch(() => ({})));
    if (!r || !r.ok) { setErr((d && d.error) || 'Not saved'); return; }
    setAdding(false);
    setF({ kind: 'seat', value: '', target: '', expiresOn: '', sourceEntryId: '', countAsCash: true });
    load();
  };
  const use = async (t, entryId) => {
    await fetch(`${API_URL}/tickets/${t.id}/use`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: entryId || null }) }).catch(() => {});
    setUsing(null);
    load();
  };
  const remove = async (t) => {
    if (t.counted && !window.confirm(`This ticket counted as ${t.source_event || 'its satellite'}'s cash. Delete it and take $${t.value} back off that result?`)) return;
    await fetch(`${API_URL}/tickets/${t.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
    load();
  };
  const open = (list || []).filter((t) => !t.used_entry_id);
  const used = (list || []).filter((t) => t.used_entry_id);
  const money = (t) => `${t.currency === 'USD' ? '$' : ''}${Number(t.value).toLocaleString('en-US')}${t.currency !== 'USD' ? ' ' + t.currency : ''}`;
  return (
    <div className="mi-card tk-card">
      <div className="mi-label">{`Tickets · ${open.length} open`}</div>
      {open.map((t) => (
        <div key={t.id} className="tk-row">
          <span className="tk-main">
            <b>{`${money(t)} ${t.kind}`}</b>
            <span>{[t.target ? `for ${t.target}` : null, t.source_event ? `won at ${t.source_event}` : null, t.expires_on ? `expires ${t.expires_on}` : null].filter(Boolean).join(' · ') || ' '}</span>
          </span>
          {using === t.id ? (
            <select className="tk-select" defaultValue="" onChange={(e) => use(t, e.target.value)} aria-label="The entry it paid for">
              <option value="" disabled>The entry it paid for…</option>
              {recent.map((e) => <option key={e.id} value={e.id}>{`${normaliseDate(e.date) || ''} ${e.event_name || ''}`}</option>)}
            </select>
          ) : (
            <span className="tk-acts">
              <button type="button" className="tq-mark" onClick={() => setUsing(t.id)}><span>Use</span></button>
              <button type="button" className="tq-mark" onClick={() => remove(t)}><span>Delete</span></button>
            </span>
          )}
        </div>
      ))}
      {used.length > 0 && <p className="mi-note">{`${used.length} used: ${used.slice(0, 3).map((t) => `${money(t)} on ${t.used_event || 'an entry'}`).join(', ')}`}</p>}
      {!adding ? (
        <button type="button" className="btn btn-ghost ctl mi-btn tk-add" onClick={() => setAdding(true)}><span>+ A ticket</span></button>
      ) : (
        <div className="tk-form">
          <div className="tk-kinds">
            {['seat', 'chips', 'voucher'].map((k) => <button key={k} type="button" className={'hx-tag' + (f.kind === k ? ' is-on' : '')} onClick={() => setF({ ...f, kind: k })}><span>{k}</span></button>)}
          </div>
          <input inputMode="decimal" placeholder="Worth, e.g. 1100" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          <input placeholder="For which event or room (optional)" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
          <label className="tk-lbl"><span>Expires</span><input type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></label>
          <select value={f.sourceEntryId} onChange={(e) => setF({ ...f, sourceEntryId: e.target.value })} aria-label="Won at">
            <option value="">Not from a result</option>
            {(sats.length ? sats : recent).map((e) => <option key={e.id} value={e.id}>{`Won at ${normaliseDate(e.date) || ''} ${e.event_name || ''}`}</option>)}
          </select>
          {f.sourceEntryId && (
            <label className="rp-attach"><input type="checkbox" checked={f.countAsCash} onChange={(e) => setF({ ...f, countAsCash: e.target.checked })} /><span>Count the seat as that result’s cash (a won seat is winnings at its value)</span></label>
          )}
          {err && <p className="mi-note rp-err">{err}</p>}
          <div className="mi-btns">
            <button type="button" className="btn btn-ghost ctl mi-btn" onClick={() => setAdding(false)}><span>Cancel</span></button>
            <button type="button" className="btn btn-primary ctl mi-btn" onClick={save} disabled={!f.value}><span>Save</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
