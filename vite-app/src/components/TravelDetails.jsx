import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { fetchApi } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { KINDS, cellsOf, blankItem, cleanItem } from '../utils/travel-details.js';

/* A Travel Day's flights, stays and rental cars, in its open card (owner, 2026-11-27: "Add the option to enter
   flight information, stay information (hotel name, check in time etc), rental car info etc"). Each item reads
   as an event's detail cells under a kind line with Edit; the card's action row adds a Flight, a Stay or a Car,
   or removes the day. Stored by lib/travel-details.js for the owner only; a save whose flights give a
   departure and an arrival rewrites the day's note, and onNotes refreshes the schedule so the band and the card's
   times follow. onItems hands the list up for the card's route line. */
export default function TravelDetails({ tournament, onRemove, onNotes, onItems }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null); // { index (-1 = new), item }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let off = false;
    fetchApi(`/personal-event/${tournament.id}/travel`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (!off) setItems(d.items || []); })
      .catch(() => { if (!off) setItems([]); });
    return () => { off = true; };
  }, [tournament.id]);
  useEffect(() => { if (items && onItems) onItems(items); }, [items, onItems]);

  const save = async (next) => {
    setSaving(true);
    try {
      const r = await fetchApi(`/personal-event/${tournament.id}/travel`, { method: 'PUT', body: { items: next } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || "Couldn't save the travel details. Nothing changed."); return false; }
      setItems(d.items || []);
      if (onNotes && d.notes != null && d.notes !== (tournament.notes || '')) onNotes(d.notes);
      return true;
    } catch {
      toast.error("Couldn't save the travel details. Nothing changed.");
      return false;
    } finally { setSaving(false); }
  };

  const list = items || [];
  const commit = async () => {
    const it = cleanItem(editing.item);
    const next = editing.index < 0 ? (it ? [...list, it] : list) : list.map((x, i) => (i === editing.index ? it : x)).filter(Boolean);
    if (await save(next)) setEditing(null);
  };
  const drop = async () => { if (await save(list.filter((_, i) => i !== editing.index))) setEditing(null); };
  const add = (kind) => setEditing({ index: -1, item: blankItem(kind) });

  const form = editing && (
    <div className="travel-item travel-form" key="form">
      <div className="travel-item-head"><span className="travel-item-kind">{KINDS[editing.item.kind].title}</span></div>
      <div className="travel-fields">
        {KINDS[editing.item.kind].fields.map((f) => (
          <label key={f.key} className={'travel-field' + (f.wide || f.type === 'datetime-local' ? ' is-wide' : '')}>
            <span className="travel-field-label">{f.label}</span>
            <input className="travel-input focus-inset" type={f.type || 'text'} value={editing.item[f.key] || ''}
              placeholder={f.placeholder || ''} maxLength={120} autoComplete="off"
              onChange={(e) => setEditing((s) => ({ ...s, item: { ...s.item, [f.key]: e.target.value } }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
          </label>
        ))}
      </div>
      <div className="travel-form-actions">
        {editing.index >= 0 && <button type="button" className="btn btn-ghost btn-sm ctl travel-delete" disabled={saving} onClick={drop}>Delete</button>}
        <button type="button" className="btn btn-ghost btn-sm ctl" disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm ctl" disabled={saving} onClick={commit}>Save</button>
      </div>
    </div>
  );

  return (
    <>
      {list.map((it, i) => (editing && editing.index === i ? form : (
        <div className="travel-item" key={i}>
          <div className="travel-item-head">
            <span className="travel-item-kind">{KINDS[it.kind].title}</span>
            <button type="button" className="kind-toggle travel-edit" disabled={!!editing}
              onClick={() => setEditing({ index: i, item: { ...blankItem(it.kind), ...it } })}
              aria-label={`Edit ${KINDS[it.kind].title.toLowerCase()}`}><span className="kind-toggle-label">Edit</span></button>
          </div>
          <div className="cal-detail-grid">
            {cellsOf(it).map((c) => (
              <div className={'cal-detail-item' + (c.wide ? ' is-wide' : '')} key={c.label}>
                <span className="cal-detail-label">{c.label}</span>
                <span className="cal-detail-value travel-value">{c.value}</span>
              </div>
            ))}
          </div>
        </div>
      )))}
      {editing && editing.index < 0 && form}
      {items && !list.length && !editing && <p className="travel-empty"><span>Only you see the travel details you add.</span></p>}
      <div className="cal-action-row">
        <button type="button" className="cal-action-btn" disabled={!!editing} onClick={() => add('flight')}>
          <span className="cal-action-icon"><Icon.plane /></span><span className="cal-action-label">Flight</span>
        </button>
        <button type="button" className="cal-action-btn" disabled={!!editing} onClick={() => add('stay')}>
          <span className="cal-action-icon"><Icon.bed /></span><span className="cal-action-label">Stay</span>
        </button>
        <button type="button" className="cal-action-btn" disabled={!!editing} onClick={() => add('car')}>
          <span className="cal-action-icon"><Icon.car /></span><span className="cal-action-label">Car</span>
        </button>
        <button type="button" className="cal-action-btn remove" onClick={onRemove}>
          <span className="cal-action-icon"><Icon.x /></span><span className="cal-action-label">Remove</span>
        </button>
      </div>
    </>
  );
}
