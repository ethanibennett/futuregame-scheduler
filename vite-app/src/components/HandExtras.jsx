import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';
import useBackToClose from '../hooks/useBackToClose.js';
import { normaliseDate, getVenueInfo } from '../utils/utils.js';

/* The replay's Features (2026-11-11): a note pinned to a moment (29), a hand's tags (31) and the event it was
   played in (30), sending it to friends or a group (26), and asking what they would do (27). */

const authHdr = (token) => ({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' });

/** The note written at this street and action, or null. */
export function noteAt(hand, streetIdx, actionIdx) {
  return ((hand && hand.annotations) || []).find((n) => n.street === streetIdx && n.action === actionIdx) || null;
}

/** Whether the replay is paused right before the hero acts (where a question can stop). */
export function heroDecisionNext(hand, streetIdx, actionIdx) {
  const st = hand && hand.streets && hand.streets[streetIdx];
  if (!st) return false;
  const next = (st.actions || [])[actionIdx + 1];
  const hero = hand.heroIdx != null ? hand.heroIdx : 0;
  return !!(next && next.player === hero);
}

/** The hand as far as the hero's decision, with the opponents' cards face down (Features 27). */
export function questionHand(hand, streetIdx, actionIdx) {
  const streets = (hand.streets || []).slice(0, streetIdx + 1).map((st, i) => ({
    ...st,
    actions: i === streetIdx ? (st.actions || []).slice(0, actionIdx + 1) : st.actions,
    opponents: Array.isArray(st.opponents) ? st.opponents.map(() => '') : st.opponents,
  }));
  const { result, annotations, ...rest } = hand;
  void result; void annotations;
  return { ...rest, streets, players: (hand.players || []).map((p) => ({ ...p, cards: undefined })) };
}

export function MomentNote({ note, onEdit }) {
  if (!note) return null;
  return (
    <div className="mn-card" role="note">
      <div className="mn-label">Your note on this moment</div>
      <div className="mn-text">{note.text}</div>
      {onEdit && <button type="button" className="mn-edit" onClick={onEdit}><span>Edit</span></button>}
    </div>
  );
}

/** A street track with a dot on every street that has a note; a tap jumps there. */
export function NoteTrack({ hand, streetIdx, onJump }) {
  const notes = (hand && hand.annotations) || [];
  if (!notes.length) return null;
  return (
    <div className="mn-track" aria-label="Streets with notes">
      {(hand.streets || []).map((st, i) => {
        const has = notes.some((n) => n.street === i);
        return (
          <button key={i} type="button" className={'mn-pill' + (i === streetIdx ? ' is-now' : '')} disabled={!has} onClick={() => { const n = notes.find((x) => x.street === i); if (n) onJump(n.street, n.action); }}>
            <span>{String(st.name || '').replace(/ Street$/, '')}</span>{has && <i className="mn-dot" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

export function NoteSheet({ initial, where, onSave, onClose }) {
  useBackToClose(true, onClose);
  const [text, setText] = useState(initial || '');
  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet mn-sheet" role="dialog" aria-label="A note on this moment">
        <h3>A note on this moment</h3>
        <p className="rp-note">{where}</p>
        <textarea className="rp-text" value={text} maxLength={600} autoFocus placeholder="What you thought here" onChange={(e) => setText(e.target.value)} />
        <div className="rp-actions">
          <button type="button" className="btn btn-ghost ctl rp-btn" onClick={() => { onSave(''); onClose(); }}><span>{initial ? 'Remove' : 'Cancel'}</span></button>
          <button type="button" className="btn btn-primary ctl rp-btn" disabled={!text.trim()} onClick={() => { onSave(text.trim()); onClose(); }}><span>Save</span></button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* Tags (31) and the event it was played in (30), one sheet from the replay. The events are the player's own
   My Schedule, the ones that had started by the hand's time first. */
export function DetailsSheet({ hand, token, allTags = [], onSave, onClose }) {
  useBackToClose(true, onClose);
  const [tags, setTags] = useState(() => (Array.isArray(hand.tags) ? hand.tags : []));
  const [draft, setDraft] = useState('');
  const [mine, setMine] = useState([]);
  const [event, setEvent] = useState(hand.event || null);
  useEffect(() => {
    if (!token) return;
    const claims = (() => { try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; } })();
    if (!claims || !claims.id) return;
    fetch(`${API_URL}/schedule/${claims.id}`, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : [])).then((rows) => {
        const today = new Date().toISOString().slice(0, 10);
        setMine((Array.isArray(rows) ? rows : []).filter((t) => t.venue !== 'Personal' && (normaliseDate(t.date) || '') <= today)
          .sort((a, b) => String(normaliseDate(b.date)).localeCompare(String(normaliseDate(a.date)))).slice(0, 30));
      }).catch(() => {});
  }, [token]);
  const add = (t) => { const v = String(t || '').trim().slice(0, 24); if (v && !tags.includes(v)) setTags([...tags, v].slice(0, 6)); setDraft(''); };
  const suggestions = allTags.filter((t) => !tags.includes(t)).slice(0, 8);
  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet hx-sheet" role="dialog" aria-label="Tags and event">
        <h3>Tags and event</h3>
        <div className="hx-label">Tags</div>
        <div className="hx-tags">
          {tags.map((t) => <button key={t} type="button" className="hx-tag is-on" onClick={() => setTags(tags.filter((x) => x !== t))}><span>{t} ×</span></button>)}
          {suggestions.map((t) => <button key={t} type="button" className="hx-tag" onClick={() => add(t)}><span>+ {t}</span></button>)}
        </div>
        <form className="hx-add" onSubmit={(e) => { e.preventDefault(); add(draft); }}>
          <input value={draft} maxLength={24} placeholder="A new tag: for the crew, study, a series" onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="btn btn-ghost ctl hx-add-btn" disabled={!draft.trim()}><span>Add</span></button>
        </form>
        <div className="hx-label">Played in</div>
        <div className="hx-events">
          <button type="button" className={'hx-ev' + (!event ? ' is-on' : '')} onClick={() => setEvent(null)}><span>Not set</span></button>
          {event && !mine.some((t) => t.id === event.tournamentId) && (
            <button type="button" className="hx-ev is-on"><span>{`${event.title} · ${event.date}`}</span></button>
          )}
          {mine.map((t) => (
            <button key={t.id} type="button" className={'hx-ev' + (event && event.tournamentId === t.id ? ' is-on' : '')}
              onClick={() => setEvent({ tournamentId: t.id, title: t.event_name, venue: t.venue, room: getVenueInfo(t.venue, t.property).longName || t.property || t.venue, date: normaliseDate(t.date) })}>
              <span>{`${t.event_name} · ${normaliseDate(t.date)}`}</span>
            </button>
          ))}
        </div>
        <div className="rp-actions">
          <button type="button" className="btn btn-ghost ctl rp-btn" onClick={onClose}><span>Cancel</span></button>
          <button type="button" className="btn btn-primary ctl rp-btn" onClick={() => { onSave({ tags, event }); onClose(); }}><span>Save</span></button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* Send in the app (26): connections and groups; the hand goes as its short link, to a friend's "Sent to you"
   and the bell, to a group's Live Feed as a hand card. */
export function SendHandSheet({ token, mintLink, title, step, onClose, toast }) {
  useBackToClose(true, onClose);
  const [people, setPeople] = useState([]);
  const [groups, setGroups] = useState([]);
  const [pick, setPick] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`${API_URL}/share-buddies`, { headers: { Authorization: 'Bearer ' + token } }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { const list = (d && (d.buddies || d.accepted || d)) || []; setPeople(Array.isArray(list) ? list : []); }).catch(() => {});
    fetch(`${API_URL}/groups`, { headers: { Authorization: 'Bearer ' + token } }).then((r) => (r.ok ? r.json() : [])).then((d) => setGroups(Array.isArray(d) ? d : [])).catch(() => {});
  }, [token]);
  const toggle = (k) => setPick((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const send = async () => {
    setBusy(true);
    try {
      const linkId = await mintLink();
      if (!linkId) { if (toast) toast.error('The hand could not be shared; check the connection'); return; }
      const toUserIds = [...pick].filter((k) => k.startsWith('u')).map((k) => Number(k.slice(1)));
      const groupIds = [...pick].filter((k) => k.startsWith('g')).map((k) => Number(k.slice(1)));
      const r = await fetch(`${API_URL}/hand-shares`, { method: 'POST', headers: authHdr(token), body: JSON.stringify({ linkId, toUserIds, groupIds, title, step }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { if (toast) toast.error(d.error || 'Not sent'); return; }
      if (toast) toast.success(`Sent to ${d.sent} ${d.sent === 1 ? 'place' : 'places'}`);
      onClose();
    } finally { setBusy(false); }
  };
  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet hx-sheet" role="dialog" aria-label="Send in the app">
        <h3>Send in the app</h3>
        {groups.length > 0 && <div className="hx-label">Groups</div>}
        <div className="hx-events">
          {groups.map((g) => <button key={'g' + g.id} type="button" className={'hx-ev' + (pick.has('g' + g.id) ? ' is-on' : '')} onClick={() => toggle('g' + g.id)}><span>{g.name}</span></button>)}
        </div>
        <div className="hx-label">Friends</div>
        <div className="hx-events">
          {people.length === 0 && <p className="rp-note">Your connections appear here.</p>}
          {people.map((p) => <button key={'u' + p.id} type="button" className={'hx-ev' + (pick.has('u' + p.id) ? ' is-on' : '')} onClick={() => toggle('u' + p.id)}><span>{p.real_name || p.username}</span></button>)}
        </div>
        <p className="rp-note">They open it on the replay and can reply on the street you are on.</p>
        <div className="rp-actions">
          <button type="button" className="btn btn-ghost ctl rp-btn" onClick={onClose}><span>Cancel</span></button>
          <button type="button" className="btn btn-primary ctl rp-btn" disabled={!pick.size || busy} onClick={send}><span>{busy ? 'Sending…' : `Send${pick.size ? ` to ${pick.size}` : ''}`}</span></button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* A question link opened (27): instead of the transport, the bet faced and Fold / Call / Raise; after an answer
   the tally. The rest of the hand arrives only after the answer. */
export function QuestionCard({ linkId, token, answered, tally, onAnswered }) {
  const [busy, setBusy] = useState(false);
  const device = useMemo(() => {
    try { let d = localStorage.getItem('deviceId'); if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('deviceId', d); } return d; } catch { return null; }
  }, []);
  const answer = async (choice) => {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/hand-links/${linkId}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(device ? { 'X-Device-Id': device } : {}) }, body: JSON.stringify({ choice, device }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && onAnswered) onAnswered(choice, d.tally);
    } finally { setBusy(false); }
  };
  if (answered && tally) {
    const total = (tally.fold || 0) + (tally.call || 0) + (tally.raise || 0);
    return (
      <div className="qc-card" role="status">
        <div className="qc-label">{`What people did · ${total}`}</div>
        <div className="qc-tally">{['call', 'fold', 'raise'].map((k) => <span key={k}><b>{tally[k] || 0}</b> {k}</span>)}</div>
      </div>
    );
  }
  return (
    <div className="qc-card" role="group" aria-label="What would you do?">
      <div className="qc-label">What would you do?</div>
      <div className="qc-btns">
        {['fold', 'call', 'raise'].map((k) => (
          <button key={k} type="button" className="btn btn-ghost ctl qc-btn" disabled={busy} onClick={() => answer(k)}><span>{k[0].toUpperCase() + k.slice(1)}</span></button>
        ))}
      </div>
    </div>
  );
}

/* Import hand histories (32): a file or pasted PokerStars-format text; a dry run says what would come in, then
   Import saves them, tagged "Imported <date>". Opponents' screen names can be replaced by Opp 1…. */
export function ImportHandsSheet({ token, onDone, onClose }) {
  useBackToClose(true, onClose);
  const [text, setText] = useState('');
  const [anon, setAnon] = useState(true);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (dryRun) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_URL}/replayer/import`, { method: 'POST', headers: authHdr(token), body: JSON.stringify({ text, anonymise: anon, dryRun }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || `Not imported (${r.status})`); return; }
      if (dryRun) setPlan(d);
      else { if (onDone) onDone(d); onClose(); }
    } catch { setErr('No connection. Nothing was saved.'); }
    finally { setBusy(false); }
  };
  const onFile = (f) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setErr('That file is over 2 MB; split it and import the parts'); return; }
    const rd = new FileReader();
    rd.onload = () => { setText(String(rd.result || '')); setPlan(null); };
    rd.readAsText(f);
  };
  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet hx-sheet hx-import" role="dialog" aria-label="Import hand histories"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}>
        <h3>Import hand histories</h3>
        <label className="hx-drop">
          <input type="file" accept=".txt,text/plain" onChange={(e) => onFile(e.target.files && e.target.files[0])} />
          <span>{text ? `${text.length.toLocaleString('en-US')} characters ready` : 'Drop a PokerStars-format file here, or choose one'}</span>
        </label>
        <textarea className="rp-text hx-paste" value={text} placeholder="…or paste the text" onChange={(e) => { setText(e.target.value); setPlan(null); }} />
        <label className="rp-attach"><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /><span>Replace opponents’ screen names with Opp 1, Opp 2…</span></label>
        {plan && (
          <div className="hx-plan">
            <div className="bx-line"><span>Hands read</span><b>{plan.read}</b></div>
            <div className="bx-line"><span>Ready to import</span><b>{plan.saved}</b></div>
            {plan.duplicates > 0 && <div className="bx-line"><span>Already saved</span><b>{plan.duplicates}</b></div>}
            {plan.skipped.length > 0 && <div className="bx-line"><span>Skipped</span><b>{plan.skipped.length}</b></div>}
            {[...new Set(plan.skipped.map((x) => x.why))].slice(0, 4).map((w) => <p key={w} className="rp-note">{`Skipped: ${w}`}</p>)}
          </div>
        )}
        {err && <p className="rp-note rp-err" role="alert">{err}</p>}
        <div className="rp-actions">
          <button type="button" className="btn btn-ghost ctl rp-btn" onClick={onClose}><span>Cancel</span></button>
          {plan
            ? <button type="button" className="btn btn-primary ctl rp-btn" disabled={busy || !plan.saved} onClick={() => run(false)}><span>{busy ? 'Importing…' : `Import ${plan.saved} hand${plan.saved === 1 ? '' : 's'}`}</span></button>
            : <button type="button" className="btn btn-primary ctl rp-btn" disabled={busy || !text.trim()} onClick={() => run(true)}><span>{busy ? 'Reading…' : 'Read them'}</span></button>}
        </div>
      </div>
    </>,
    document.body,
  );
}

/* Sent to you (26): hands friends sent, newest first, each opening its replay. */
export function SentToYou({ token }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/hand-shares/inbox`, { headers: { Authorization: 'Bearer ' + token } }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setRows(d.hands || [])).catch(() => {});
  }, [token]);
  if (!rows.length) return null;
  return (
    <div className="hx-inbox">
      <div className="replayer-list-heading"><span>Sent to you</span></div>
      {rows.slice(0, 8).map((h) => (
        <a key={h.id} className="hx-inbox-row" href={`/h/${h.link_id}`}>
          <span className="hx-inbox-who">{h.real_name || h.username}</span>
          <span className="hx-inbox-what">{[h.title, h.replies ? `${h.replies} repl${h.replies === 1 ? 'y' : 'ies'}` : null].filter(Boolean).join(' · ')}</span>
        </a>
      ))}
    </div>
  );
}
