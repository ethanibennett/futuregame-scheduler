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

  return (
    <nav className="bottom-nav">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`nav-tab ${current === tab.id ? 'active' : ''}${tab.center ? ' nav-tab-center' : ''}`}
          onClick={() => { haptic(10); onChange(tab.id); }}
          style={{position:'relative'}}
        >
          <tab.icon />
          {tab.label}
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
