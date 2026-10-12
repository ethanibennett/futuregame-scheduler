import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';
import {
  getVenueInfo, nativeCurrency, CURRENCY_CONFIG, getToday,
} from '../utils/utils.js';
import {
  lastResult, tournamentReceipt, cashReceipt, receiptMilestone, resultMoney, convertMoney,
  fmtMoney, dayName, eventNo, isoDay,
} from '../utils/home.js';
import { gridGeom, gridPanelStyle } from '../utils/grid-panel.js';
import useLiveCashSession from '../hooks/useLiveCashSession.js';

// ── The home's Last result (verdict section 3): the receipt ────────────────────────────────
// A 3r title row (LAST RESULT, a milestone tag when one applies, the Log pill), then the card:
// the signed net leads in the display face, coloured, with the name, room and day beside it, and
// one 4r fact bar on the Results bar's 11g | 11g | 13g split, holding only facts that exist
// (utils/home.js tournamentReceipt / cashReceipt). A 34th-of-812 bust then reads as the near miss
// it was, not just as -$1,200. Tapping the card opens the entry in Results.
// The Log pill: admins get Tournament result, Cash session (log one, or start the clock — or open
// the one running), Expense or income; everyone else has only results, so it opens that form.
// Each choice routes into the existing form in Results (App's resultsIntent).
// Admins' last result can be a cash session (GET /api/cash-sessions, admin-gated, fetched only for
// them); everyone else's is their newest tournament result.

const curOf = (code) => CURRENCY_CONFIG[code] || CURRENCY_CONFIG.USD;
const YEAR_MS = 365 * 864e5;

/** Admins: their cash sessions of the last year, newest first; refetched when a live one ends. */
function useCashSessions(enabled, token, version) {
  const [sessions, setSessions] = useState(null);
  useEffect(() => {
    if (!enabled || !token) { setSessions(null); return undefined; }
    let on = true;
    const from = isoDay(new Date(Date.now() - YEAR_MS).toISOString());
    fetch(`${API_URL}/cash-sessions?from=${from}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (on) setSessions(d && Array.isArray(d.sessions) ? d.sessions : []); })
      .catch(() => { if (on) setSessions([]); });
    return () => { on = false; };
  }, [enabled, token, version]);
  return sessions;
}

function LogMenu({ anchor, isAdmin, live, onPick, onClose }) {
  const ref = useRef(null);
  const items = [
    { key: 'tournament', label: 'Tournament result', intent: { kind: 'tournament' } },
    ...(isAdmin ? [
      { key: 'cash-add', label: 'Cash session', intent: { kind: 'cash-add' } },
      live
        ? { key: 'cash-live', label: 'Open the live session', intent: { kind: 'cash-live' } }
        : { key: 'cash-start', label: 'Start a live session', intent: { kind: 'cash-start' } },
      { key: 'expense', label: 'Expense or income', intent: { kind: 'expense' } },
    ] : []),
  ];
  const ROW = 4, W = 17;
  const [style, setStyle] = useState(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const { G } = gridGeom();
    // Right-aligned to the pill (its right edge on 36g), 17g wide, one 4r row per choice.
    setStyle(gridPanelStyle(r, items.length * ROW, r.right / G - W));
  }, [anchor, items.length]);
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') { onClose(); anchor.focus({ preventScroll: true }); } };
    const scroll = () => onClose();
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', scroll);
    document.addEventListener('scroll', scroll, true);
    ref.current?.querySelector('button')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', scroll);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [anchor, onClose]);
  if (!style) return null;
  return createPortal(
    <div ref={ref} className="hm-logmenu" role="menu" aria-label="Log" style={style}>
      {items.map((it) => (
        <button key={it.key} type="button" role="menuitem" className="hm-logmenu-item"
          onClick={() => { onClose(); onPick(it.intent); }}>
          <span className="hm-seg-t hm-logmenu-t">{it.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}

function Facts({ facts }) {
  return (
    <div className="hm-facts">
      {facts.map((f) => (
        <div key={f.key} className={'hm-fact' + (f.muted ? ' is-muted' : '')} title={f.title}>
          <span className="hm-cell hm-f-md-b hm-fact-v"><span className="hm-clip">{f.value}</span></span>
          {f.label ? <span className="hm-cell hm-f-2xs hm-fact-l"><span className="hm-clip">{f.label}</span></span> : null}
        </div>
      ))}
    </div>
  );
}

export default function HomeLastResult({ results, rates, isAdmin, token, canLog = true, onLog }) {
  const today = getToday();
  const { session: live } = useLiveCashSession({ enabled: !!isAdmin, token });
  const cash = useCashSessions(!!isAdmin, token, live ? `live-${live.id}` : 'idle');
  const last = useMemo(() => lastResult(results, isAdmin ? cash : null), [results, cash, isAdmin]);

  // A milestone is claimed only when every earlier result converts into one currency.
  const milestone = useMemo(() => {
    if (!last || last.kind !== 'tournament') return null;
    const value = (r, f) => convertMoney(resultMoney(r)[f], nativeCurrency(r.venue), 'USD', rates);
    return receiptMilestone(results, last.row, value);
  }, [last, results, rates]);

  const pillRef = useRef(null);
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const onPill = () => {
    if (isAdmin) setMenu((m) => !m);
    else onLog({ kind: 'tournament' });
  };

  let card;
  if (!last) {
    card = (
      <div className="hm-receipt hm-receipt--empty">
        <div className="hm-cell hm-f-md-b hm-empty-title">Log your first result</div>
        <div className="hm-cell hm-f-xs hm-empty-note">Cashes and bust-outs both count.</div>
        {canLog && (
          <div className="hm-empty-actions">
            <button type="button" className="hm-btn hm-btn--brand hm-w10" onClick={() => onLog({ kind: 'tournament' })}>
              <span className="hm-seg-t">Log a result</span>
            </button>
            {isAdmin && (
              <button type="button" className="hm-btn hm-w23" onClick={() => onLog({ kind: 'import' })}>
                <span className="hm-seg-t">Import from Poker Bankroll Tracker</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  } else {
    let net, cur, name, where, day, facts, open, label;
    if (last.kind === 'tournament') {
      const r = last.row;
      cur = curOf(nativeCurrency(r.venue));
      const money = (v) => fmtMoney(v, cur);
      const rc = tournamentReceipt(r, money);
      net = rc.net;
      facts = rc.facts;
      name = [eventNo(r.event_number), r.event_name].filter(Boolean).join(' ');
      where = r.venue === 'Personal' ? (Number(r.imported) ? 'Imported' : '') : (getVenueInfo(r.venue, r.property).longName || r.venue);
      day = dayName(r.date, today);
      open = { kind: 'entry', entryId: r.id };
      label = `Last result: ${name}, ${fmtMoney(net, cur, { signed: true })}. Open it in Results`;
    } else {
      const s = last.session;
      cur = curOf(s.currency);
      const rc = cashReceipt(s, (v) => fmtMoney(v, cur));
      net = rc.net;
      facts = rc.facts;
      name = [s.stakes, s.game, 'cash'].filter(Boolean).join(' ');
      where = s.room || '';
      day = dayName(s.session_date, today);
      open = { kind: 'cash-session', id: s.id };
      label = `Last result: ${name}, ${fmtMoney(net, cur, { signed: true })}. Open the session`;
    }
    const tone = net > 0 ? ' is-pos' : net < 0 ? ' is-neg' : '';
    card = (
      <button type="button" className="hm-receipt" onClick={() => onLog(open)} aria-label={label}>
        <span className="hm-receipt-lead">
          <span className={'hm-cell hm-f-disp hm-receipt-net' + tone}>{fmtMoney(net, cur, { signed: true })}</span>
          <span className="hm-receipt-what">
            <span className="hm-cell hm-f-sm-b hm-receipt-name"><span className="hm-clip">{name}</span></span>
            <span className="hm-cell hm-f-xs hm-receipt-meta"><span className="hm-clip">{[where, day].filter(Boolean).join(' · ')}</span></span>
          </span>
        </span>
        <Facts facts={facts} />
      </button>
    );
  }

  return (
    <section className="dashboard-section hm-last" aria-label="Last result">
      <div className="dashboard-section-header">
        <div className="dashboard-section-title">Last result</div>
        <span className="hm-head-right">
          {milestone && <span className="hm-tag snap-g"><span className="hm-tag-t">{milestone}</span></span>}
          {canLog && (
            <button ref={pillRef} type="button" className="hm-head-pill hm-head-pill--log" onClick={onPill}
              aria-haspopup={isAdmin ? 'menu' : undefined} aria-expanded={isAdmin ? menu : undefined}
              aria-label={isAdmin ? 'Log: a result, a cash session, an expense or income' : 'Log a tournament result'}>
              <span className="hm-hp-t">Log</span>
            </button>
          )}
        </span>
      </div>
      {card}
      {menu && pillRef.current && (
        <LogMenu anchor={pillRef.current} isAdmin={isAdmin} live={!!live} onPick={onLog} onClose={closeMenu} />
      )}
    </section>
  );
}
