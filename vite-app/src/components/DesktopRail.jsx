import React from 'react';
import Icon from './Icon.jsx';

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
    <button
      key={tab.id}
      type="button"
      className={'dk-rail-item' + (current === tab.id ? ' is-active' : '')}
      aria-current={current === tab.id ? 'page' : undefined}
      onClick={() => onChange(tab.id)}
    >
      <span className="dk-rail-icon"><tab.icon /></span>
      <span className="dk-rail-label">{tab.label}</span>
      {tab.id === 'admin' && evalPct != null && <span className="dk-rail-eval" aria-label={`Parser eval ${evalPct}%`}>{'eval ' + evalPct + '%'}</span>}
    </button>
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
