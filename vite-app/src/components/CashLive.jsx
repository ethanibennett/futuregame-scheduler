// Cash sessions (beta, app admins): the two pieces that load with the app shell. The Cash view
// itself (CashSessions.jsx) is lazy, so nobody else downloads it.
//   ResultsKindTabs  Tournaments | Cash, the strip at the top of the Results tab.
//   LiveCashBar      while a session is running: a 5r bar directly above the bottom nav, on every
//                    tab, with the running clock and what is on the table; Open goes to Results ›
//                    Cash, where rebuy and cash-out live. Hidden on that view (it shows the full
//                    live card) and on Hands (whose tool row and replayer controls own that edge).
// Why there: the top bar has no room for a clock, and a banner under it would push every tab's
// content down. Above the nav is where a "now playing" bar sits in every phone app — out of the
// content's way, under the thumb at the table, and it only exists while a session does.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './CashSessions.css';
import useLiveCashSession, { RESULTS_SECTIONS, useResultsKind, setResultsKind } from '../hooks/useLiveCashSession.js';
import { formatClock, liveElapsed, sessionGame } from '../utils/cash-sessions.js';
import { formatCurrencyAmount } from '../utils/utils.js';
import { useSessionStop, stopState, stopLine, StopSheet } from './SessionStop.jsx';
import useTick from '../hooks/useTick.js';

// The sections grouped (owner, 2026-10-20: nine chips over three rows were too many): four 8g chips in
// one row (35g with the gaps): MTT/Cash ⌄, Overview, Insights ⌄ and Manage ⌄. A group's chip shows the section last used in it (remembered on the
// device), so one tap returns there and its caret opens the group's menu, the way the Schedule's
// Online chip works. The chip of the group in view is lit.
export const RESULTS_GROUPS = [
  { id: 'logs', label: 'Logs', keys: ['tournaments', 'cash', 'all'] },   // All: both together (ResultsAll.jsx)
  { id: 'overview', label: 'Overview', keys: ['balance'] },
  { id: 'insights', label: 'Insights', keys: ['reports', 'locations', 'goals'] },
  { id: 'manage', label: 'Manage', keys: ['backers', 'rules', 'data'] },
];
// Tournaments reads MTT on the strip and in its menu (owner, 2026-10-20), so every chip fits its 8g.
export const SECTION_LABEL = { ...Object.fromEntries(RESULTS_SECTIONS), tournaments: 'MTT' };
const LAST_KEY = 'resultsGroupLast';
const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY)) || {}; } catch { return {}; } };

const Caret = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 4.5 6 7.5 9 4.5" /></svg>
);

export function ResultsKindTabs() {
  const kind = useResultsKind();
  const [last, setLast] = useState(readLast);
  const [menu, setMenu] = useState(null); // { id, top }
  const stripRef = useRef(null);
  const groupOf = (k) => RESULTS_GROUPS.find((g) => g.keys.includes(k));
  // Remember the section in view as its group's last.
  useEffect(() => {
    const g = groupOf(kind);
    if (!g || g.keys.length < 2 || last[g.id] === kind) return;
    const next = { ...last, [g.id]: kind };
    setLast(next);
    try { localStorage.setItem(LAST_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (g) => (g.keys.includes(kind) ? kind : (g.keys.includes(last[g.id]) ? last[g.id] : g.keys[0]));
  // The menu hangs from its own chip (Bankroll design 2): a chip in the strip's left half opens it from the
  // strip's left edge, one in the right half from its right edge, so the 17g panel's edge is the chip's.
  const openMenu = (g, el) => {
    const r = stripRef.current ? stripRef.current.getBoundingClientRect() : null;
    const c = el ? el.getBoundingClientRect() : null;
    const right = !!(r && c && c.left + c.width / 2 > r.left + r.width / 2);
    const pos = !r ? { left: 0 } : right ? { right: document.documentElement.clientWidth - r.right } : { left: r.left };
    setMenu((m) => (m && m.id === g.id ? null : { id: g.id, top: r ? r.bottom : 0, right, pos }));
  };
  const pick = (k) => { setMenu(null); setResultsKind(k); };
  const open = menu && RESULTS_GROUPS.find((g) => g.id === menu.id);
  return (
    // The Schedule's kind toggles (owner, 2026-10-16: the Bankroll tab in the Schedule's scheme): 2r
    // caps chips, the active one in the accent, as Satellites / Restarts / Side Events / Online.
    <>
      <div ref={stripRef} className="kind-toggles results-kind-tabs is-grouped" role="tablist" aria-label="Results">
        {RESULTS_GROUPS.map((g) => {
          const k = shown(g);
          const on = g.keys.includes(kind);
          if (g.keys.length === 1) {
            return (
              <button key={g.id} type="button" role="tab" aria-selected={on} className={'kind-toggle rk-' + g.id + (on ? ' active' : '')}
                onClick={() => pick(k)}><span className="kind-toggle-label">{SECTION_LABEL[k]}</span></button>
            );
          }
          return (
            <div key={g.id} className={'kind-toggle-split rk-' + g.id}>
              <button type="button" role="tab" aria-selected={on} className={'kind-toggle' + (on ? ' active' : '')}
                onClick={() => pick(k)}><span className="kind-toggle-label">{SECTION_LABEL[k]}</span></button>
              <button type="button" className={'kind-toggle-caret' + (on ? ' active' : '')} aria-haspopup="menu"
                aria-expanded={!!(menu && menu.id === g.id)} aria-label={`${g.label}: ${g.keys.map((x) => SECTION_LABEL[x]).join(', ')}`}
                onClick={(e) => openMenu(g, e.currentTarget.parentElement)}><Caret /></button>
            </div>
          );
        })}
      </div>
      {open && createPortal(
        <>
          <div className="dropdown-backdrop" style={{ zIndex: 'var(--z-scrim)' }} onClick={() => setMenu(null)} />
          <div className={'online-room-menu rk-menu' + (menu.right ? ' is-right' : '')} role="menu" aria-label={open.label} style={{ top: menu.top, ...menu.pos }}>
            {open.keys.map((k) => (
              <button key={k} type="button" role="menuitemradio" aria-checked={kind === k}
                className={'rk-menu-item' + (kind === k ? ' is-on' : '')} onClick={() => pick(k)}>
                {SECTION_LABEL[k]}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

export function LiveCashBar({ enabled, token, currentView, onOpen }) {
  const { session, skew, stacks } = useLiveCashSession({ enabled, token });
  // Your stop (Features 15): the nearer line, and a sheet that asks once when either is reached.
  const { stop, save } = useSessionStop(token, session && session.id);
  const [stopOpen, setStopOpen] = useState(false);
  const kind = useResultsKind();
  // Off on the home too: the session is its first Up Next card there (HomeCashCard), which says the
  // same and more.
  const hidden = !session || currentView === 'hands' || currentView === 'dashboard' || (currentView === 'tracking' && kind === 'cash');
  useTick(!hidden);
  const st = stopState(stop, session, stacks, Date.now());
  const askedKey = session && st && st.reached ? `stopAsked:${session.id}:${st.reached}` : null;
  useEffect(() => {
    if (!askedKey || hidden) return;
    try { if (sessionStorage.getItem(askedKey)) return; sessionStorage.setItem(askedKey, '1'); } catch { /* storage off */ }
    setStopOpen(true);
  }, [askedKey, hidden]);
  if (hidden) return null;
  const what = [sessionGame(session), session.room].filter(Boolean).join(' · ');
  const line = stopLine(st, session);
  return (
    <div className={'cs-bar' + (st && st.reached ? ' is-at-stop' : '')} role="status" aria-label="Cash session running">
      <button type="button" className="cs-t cs-bar-text cs-bar-tap" onClick={() => setStopOpen(true)} aria-label="Your stop">
        <span className="cs-dot" aria-hidden="true">●</span>{' '}
        <b className="cs-bar-clock">{formatClock(liveElapsed(session, Date.now(), skew))}</b>
        {line ? ` · ${line}` : `${what ? ` · ${what}` : ''} · ${formatCurrencyAmount(session.buy_in, session.currency)} in`}
      </button>
      {stopOpen && <StopSheet stop={stop} session={session} stacks={stacks} onSave={save} onCashOut={() => { setResultsKind('cash'); onOpen(); }} onClose={() => setStopOpen(false)} />}
      <button type="button" className="cs-btn cs-btn--brand" style={{ '--w': 6, '--h': 3 }}
        onClick={() => { setResultsKind('cash'); onOpen(); }}><span>Open</span></button>
    </div>
  );
}
