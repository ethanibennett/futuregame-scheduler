import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { RESULTS_GROUPS, SECTION_LABEL } from './CashLive.jsx';
import { useResultsKind, setResultsKind } from '../hooks/useLiveCashSession.js';

/* The Bankroll tab's ten sections under its item (Bankroll design 86): 3r rows in four groups, 1r apart,
   the labels at the rail label's x in its type; the open one bold on the hover fill with the rail's brand
   bar. One click from anywhere: a row off the tab goes to the tab and that section. In a window under
   88r tall the list folds to the open section's group. The phone keeps its strip. */
const RAIL_GROUPS = ['overview', 'logs', 'insights', 'manage'].map((id) => RESULTS_GROUPS.find((g) => g.id === id)).filter(Boolean);
function useShortWindow(rows = 88) {
  const [short, setShort] = useState(false);
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;height:calc(var(--subrow) * ${rows})`;
    const measure = () => {
      document.body.appendChild(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      setShort(window.innerHeight < h);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [rows]);
  return short;
}
function RailSections({ onTab, go }) {
  const kind = useResultsKind();
  const short = useShortWindow();
  return (
    <div className="dk-rail-sub" aria-label="Bankroll sections" role="group">
      {RAIL_GROUPS.filter((g) => !short || g.keys.includes(kind)).map((g) => (
        <div key={g.id} className="dk-rail-subgroup">
          {g.keys.map((k) => {
            const on = onTab && kind === k;
            return (
              <button key={k} type="button" className={'dk-rail-subitem' + (on ? ' is-active' : '')} aria-current={on ? 'page' : undefined}
                onClick={() => go(k)}>
                <span>{k === 'tournaments' ? 'MTT' : SECTION_LABEL[k]}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}


/*
 * Desktop side navigation (docs/desktop-layout.md). Replaces the bottom nav at
 * the desktop breakpoint; the phone keeps BottomNav and never renders this.
 *
 * Geometry: the rail is 10g — one 8g column inside 1g margins, the same column
 * the wordmark above it fills. Each item is one Row (4r) tall: a 2g x 2r icon
 * cell and the label, both bottom-seated on the 3r line (the label trimmed to
 * cap..baseline in a grid cell, so its baseline IS that line).
 *
 * The primary group mirrors BottomNav (same ids, same admin gating). The
 * secondary group holds what the phone keeps in the avatar menu, because a
 * desktop has room to show it and a menu hides it.
 *
 * The admin dev keys (#, D, i) are not here: they float over the main column's
 * foot as on the phone (App.jsx devToggles).
 */
export default function DesktopRail({ current, onChange, isAdmin, evalPct = null }) {
  const primary = [
    { id: 'dashboard', label: 'Home', icon: Icon.home },
    { id: 'tournaments', label: 'Schedule', icon: Icon.calendar },
    { id: 'tracking', label: 'Bankroll', icon: Icon.tracking },
    { id: 'hands', label: 'Hands', icon: Icon.cards },
    ...(isAdmin ? [{ id: 'cash', label: 'Cash', icon: Icon.dollarSign }] : []),
  ];
  // Yours, then the admin tools under their own caption (UX pick 106, as the avatar menu, pick 49).
  const secondary = [
    { id: 'social', label: 'Social', icon: Icon.people },
    { id: 'settings', label: 'Settings', icon: Icon.gear },
  ];
  const adminTools = isAdmin ? [
    // Staking had no way in once Cash took its primary slot (App.jsx's username menu has it too).
    { id: 'staking', label: 'Staking', icon: Icon.handshake },
    { id: 'admin', label: 'Admin', icon: Icon.lock },
    // The admin alerts' "what this batch added" lists (AdminBatchesView); App opens the newest.
    { id: 'batches', label: 'New Events', icon: Icon.bell },
  ] : [];
  const item = (tab) => (
    <React.Fragment key={tab.id}>
    <button
      type="button"
      className={'dk-rail-item' + (current === tab.id ? ' is-active' : '')}
      aria-current={current === tab.id ? 'page' : undefined}
      onClick={() => onChange(tab.id)}
    >
      <span className="dk-rail-icon"><tab.icon /></span>
      <span className="dk-rail-label">{tab.label}</span>
      {tab.id === 'admin' && evalPct != null && <span className="dk-rail-eval" aria-label={`Parser eval ${evalPct}%`}>{'eval ' + evalPct + '%'}</span>}
    </button>
    {tab.id === 'tracking' && isAdmin && (
      <RailSections onTab={current === 'tracking'} go={(k) => { setResultsKind(k); if (current !== 'tracking') onChange('tracking'); }} />
    )}
    </React.Fragment>
  );
  return (
    <nav className="dk-rail" aria-label="Main">
      <div className="dk-rail-group">{primary.map(item)}</div>
      <div className="dk-rail-group dk-rail-secondary">{secondary.map(item)}</div>
      {adminTools.length > 0 && (
        <div className="dk-rail-group dk-rail-admin">
          <div className="dk-rail-caption">Admin</div>
          {adminTools.map(item)}
        </div>
      )}
    </nav>
  );
}
