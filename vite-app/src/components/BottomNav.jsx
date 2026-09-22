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
              position:'absolute', top:'4px', right:'50%', marginRight:'-16px',
              background:'#ef4444', color:'#fff', fontSize:'0.55rem', fontWeight:700,
              width:'14px', height:'14px', borderRadius:'50%',
              display:'flex', alignItems:'center', justifyContent:'center',
              lineHeight:1
            }}>{tab.badge}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
