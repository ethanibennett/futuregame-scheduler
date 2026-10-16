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
import React, { useEffect, useState } from 'react';
import './CashSessions.css';
import useLiveCashSession, { useResultsKind, setResultsKind } from '../hooks/useLiveCashSession.js';
import { formatClock, liveElapsed, sessionGame } from '../utils/cash-sessions.js';
import { formatCurrencyAmount } from '../utils/utils.js';

/** Re-render every `ms` while `active`. */
export function useTick(active, ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

export function ResultsKindTabs() {
  const kind = useResultsKind();
  return (
    // The Schedule's kind toggles (owner, 2026-10-16: the Bankroll tab in the Schedule's scheme): 8g x 2r
    // caps chips, the active one in the accent, as Satellites / Restarts / Side Events / Online.
    <div className="kind-toggles results-kind-tabs" role="tablist" aria-label="Results">
      {[['tournaments', 'Tournaments'], ['cash', 'Cash']].map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={kind === k} className={'kind-toggle' + (kind === k ? ' active' : '')}
          onClick={() => setResultsKind(k)}><span className="kind-toggle-label">{label}</span></button>
      ))}
    </div>
  );
}

export function LiveCashBar({ enabled, token, currentView, onOpen }) {
  const { session, skew } = useLiveCashSession({ enabled, token });
  const kind = useResultsKind();
  // Off on the home too: the session is its first Up Next card there (HomeCashCard), which says the
  // same and more.
  const hidden = !session || currentView === 'hands' || currentView === 'dashboard' || (currentView === 'tracking' && kind === 'cash');
  useTick(!hidden);
  if (hidden) return null;
  const what = [sessionGame(session), session.room].filter(Boolean).join(' · ');
  return (
    <div className="cs-bar" role="status" aria-label="Cash session running">
      <span className="cs-t cs-bar-text">
        <span className="cs-dot" aria-hidden="true">●</span>{' '}
        <b className="cs-bar-clock">{formatClock(liveElapsed(session, Date.now(), skew))}</b>
        {what ? ` · ${what}` : ''} · {formatCurrencyAmount(session.buy_in, session.currency)} in
      </span>
      <button type="button" className="cs-btn cs-btn--brand" style={{ '--w': 6, '--h': 3 }}
        onClick={() => { setResultsKind('cash'); onOpen(); }}><span>Open</span></button>
    </div>
  );
}
