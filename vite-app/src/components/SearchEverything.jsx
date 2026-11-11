import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';
import { getVenueInfo, normaliseDate } from '../utils/utils.js';

/* Desktop: one search box for events, hands, people, groups and settings (Features 49, 2026-11-11). ⌘K or
   Ctrl+K anywhere, or / outside a field; ↑ ↓ ↵ and Esc. Events say "on your schedule" or which friend plays;
   hands are fetched on first use (the list loads only when Hands is opened). */
const SETTINGS_ROWS = [
  ['Notifications', 'Which kinds reach your phone'], ['Email', 'Change your address'], ['Password', 'Change it, sign out other devices'],
  ['Invite link', 'Bring a friend, connected'], ['Theme', 'Dark, dusk, light, cloudy'], ['Hide money', 'Mask results and balances'],
  ['Download everything', 'Your data as a ZIP'], ['Delete account', 'For good'],
];

export default function SearchEverything({ open, onClose, token, tournaments, mySchedule, buddies, groups, buddyEvents, onEvent, onHand, onPerson, onGroup, onSettings }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [hands, setHands] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    setQ(''); setHi(0);
    requestAnimationFrame(() => inputRef.current && inputRef.current.focus());
    if (hands == null && token) {
      fetch(`${API_URL}/replayer/hands`, { headers: { Authorization: 'Bearer ' + token } }).then((r) => (r.ok ? r.json() : [])).then((d) => setHands(Array.isArray(d) ? d : [])).catch(() => setHands([]));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = useMemo(() => new Set((mySchedule || []).map((t) => t.id)), [mySchedule]);
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const has = (s) => { const h = String(s || '').toLowerCase(); return words.every((w) => h.includes(w)); };
    const today = new Date().toISOString().slice(0, 10);
    const ev = (tournaments || []).filter((t) => (normaliseDate(t.date) || '') >= today && has(`${t.event_name} ${t.venue} ${t.property || ''} ${t.event_number || ''}`)).slice(0, 6)
      .map((t) => {
        const friend = (buddyEvents || []).find((b) => (b.tournament_id || b.id) === t.id);
        return { kind: 'Events', key: 'e' + t.id, label: t.event_name, detail: [mine.has(t.id) ? 'on your schedule' : friend ? `${friend.username || 'a friend'} plays` : null, getVenueInfo(t.venue, t.property).abbr, normaliseDate(t.date)].filter(Boolean).join(' · '), go: () => onEvent(t) };
      });
    const hs = (hands || []).filter((h) => has(`${h.title || ''} ${h.gameType || ''} ${(h.tags || []).join(' ')}`)).slice(0, 5)
      .map((h) => ({ kind: 'Hands', key: 'h' + h.id, label: h.title || h.gameType || 'A hand', detail: [h.gameType, (h.tags || [])[0]].filter(Boolean).join(' · '), go: () => onHand(h) }));
    const ppl = (buddies || []).filter((b) => has(`${b.username} ${b.real_name || ''}`)).slice(0, 4)
      .map((b) => ({ kind: 'People and groups', key: 'u' + b.id, label: b.real_name || b.username, detail: '@' + b.username, go: () => onPerson(b) }));
    const grp = (groups || []).filter((g) => has(g.name)).slice(0, 3)
      .map((g) => ({ kind: 'People and groups', key: 'g' + g.id, label: g.name, detail: `${g.member_count || ''} members`, go: () => onGroup(g) }));
    const set = SETTINGS_ROWS.filter(([l, d]) => has(`${l} ${d}`)).slice(0, 3)
      .map(([l, d]) => ({ kind: 'Settings', key: 's' + l, label: l, detail: d, go: () => onSettings(l) }));
    return [...ev, ...hs, ...ppl, ...grp, ...set];
  }, [q, tournaments, hands, buddies, groups, mine, buddyEvents, onEvent, onHand, onPerson, onGroup, onSettings]);
  if (!open) return null;
  const pick = (r) => { if (!r) return; onClose(); r.go(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[hi]); }
  };
  let last = null;
  return createPortal(
    <div className="se-scrim" onClick={onClose}>
      <div className="se-box" role="dialog" aria-label="Search everything" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <input ref={inputRef} className="se-input" value={q} placeholder="Search events, hands, people, groups and settings" onChange={(e) => { setQ(e.target.value); setHi(0); }} aria-label="Search everything" />
        <div className="se-list" role="listbox">
          {q && !results.length && <div className="se-empty">Nothing matches “{q}”</div>}
          {results.map((r, i) => {
            const head = r.kind !== last ? <div key={'k' + r.kind} className="se-kind">{r.kind}</div> : null;
            last = r.kind;
            return (
              <React.Fragment key={r.key}>
                {head}
                <button type="button" role="option" aria-selected={i === hi} className={'se-row' + (i === hi ? ' is-hi' : '')} onMouseEnter={() => setHi(i)} onClick={() => pick(r)}>
                  <span className="se-label">{r.label}</span><span className="se-detail">{r.detail}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="se-foot">↑↓ move · ↵ open · esc close</div>
      </div>
    </div>,
    document.body,
  );
}
