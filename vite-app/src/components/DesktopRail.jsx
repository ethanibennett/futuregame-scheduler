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
 */
export default function DesktopRail({ current, onChange, isAdmin, children }) {
  const primary = [
    { id: 'tournaments', label: 'Schedule', icon: Icon.calendar },
    { id: 'social', label: 'Social', icon: Icon.people },
    { id: 'dashboard', label: 'Dashboard', icon: Icon.home },
    ...(isAdmin ? [{ id: 'hands', label: 'Hands', icon: Icon.cards }] : []),
    ...(isAdmin ? [{ id: 'cash', label: 'Cash', icon: Icon.dollarSign }] : []),
  ];
  const secondary = [
    { id: 'tracking', label: 'Results', icon: Icon.tracking },
    { id: 'settings', label: 'Settings', icon: Icon.gear },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: Icon.lock }] : []),
  ];
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
    </button>
  );
  return (
    <nav className="dk-rail" aria-label="Main">
      <div className="dk-rail-group">{primary.map(item)}</div>
      <div className="dk-rail-group dk-rail-secondary">{secondary.map(item)}</div>
      {children ? <div className="dk-rail-dev">{children}</div> : null}
    </nav>
  );
}
