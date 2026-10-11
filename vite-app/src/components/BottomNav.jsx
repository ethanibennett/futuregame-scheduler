import React from 'react';
import Icon from './Icon.jsx';
import { haptic } from '../utils/utils.js';

export default function BottomNav({ current, onChange, scheduleCount, newShareCount, isAdmin }) {
  const tabs = [
    { id: 'tournaments', label: 'Schedule', icon: Icon.calendar },
    { id: 'social', label: 'Social', icon: Icon.people },
    { id: 'dashboard', label: 'Dashboard', icon: Icon.home },
    // Hand Replayer — admin-only entry in the footer until the
    // feature ships to all users.
    ...(isAdmin ? [{ id: 'hands', label: 'Hands', icon: Icon.cards }] : []),
    // Cash watcher replaced Staking in this slot — admin-only for now.
    ...(isAdmin ? [{ id: 'cash', label: 'Cash', icon: Icon.dollarSign }] : []),
  ];

  // Whole-g tabs (owner rule, 2026-10-10: every button's box on the grid). The widest whole-g
  // tab that fits n across the 35g between the 1g margins; when what is left over is odd, 1g
  // gutters go between the tabs instead, so the margins either side are whole too (3 tabs: 11g
  // with 2g margins; 4: 8g + 1g gutters, the column grid; 5: 7g).
  const n = tabs.length;
  let tabW = Math.floor(35 / n), navGap = 0;
  if ((37 - n * tabW) % 2) { navGap = 1; tabW = Math.floor((35 - (n - 1)) / n); }

  return (
    <nav className="bottom-nav" style={{ '--nav-tab-w': tabW, '--nav-gap': navGap }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`nav-tab ${current === tab.id ? 'active' : ''}${tab.center ? ' nav-tab-center' : ''}`}
          onClick={() => { haptic(10); onChange(tab.id); }}
          style={{position:'relative'}}
        >
          <tab.icon />
          <span className="nav-tab-label">{tab.label}</span>
          {tab.badge > 0 && (
            <span style={{
              position:'absolute', top:'calc(var(--subrow) * 0.5)', right:'50%', marginRight:'calc(var(--subrow) * -2)',
              background:'#ef4444', color:'#fff', fontSize:'calc(var(--gu) * 0.810)', fontWeight:700,
              width:'calc(var(--subrow) * 1.75)', height:'calc(var(--subrow) * 1.75)', borderRadius:'50%',
              display:'flex', alignItems:'center', justifyContent:'center',
              lineHeight:1
            }}>{tab.badge}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
