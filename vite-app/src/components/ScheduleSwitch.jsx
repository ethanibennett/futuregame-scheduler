import React from 'react';

/* The Schedule tab's three views side by side (Laws of UX picks 20 and 95, owner 2026-11-10): every
   event, the Calendar, and the player's own schedule with its count, so "my schedule" is where its
   name says. 35g x 4r, three 11g segments 1g apart, the one on show filled. On the desktop My schedule
   is the right pane already, so the switch is the first two, 17g each. */
export default function ScheduleSwitch({ view, mineCount = 0, onChange, desktop = false }) {
  const items = [
    ['tournaments', 'All events'],
    ['calendar', 'Calendar'],
    ...(desktop ? [] : [['schedule', `My schedule · ${mineCount.toLocaleString()}`]]),
  ];
  return (
    <div className={'sched-switch' + (desktop ? ' is-two' : '')} role="tablist" aria-label="Schedule views">
      {items.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={view === id}
          className={'sched-switch-seg' + (view === id ? ' is-on' : '')}
          onClick={() => { if (view !== id) onChange(id); }}>
          {label}
        </button>
      ))}
    </div>
  );
}
