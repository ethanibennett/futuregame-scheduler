import React, { useMemo } from 'react';
import { getVenueInfo, normaliseDate, parseTournamentTime } from '../utils/utils.js';
import { useDisplayName } from '../contexts/DisplayNameContext.jsx';

/**
 * The home's Friends section (owner, 2026-10-20: "bring back the option to add friends events to the
 * dashboard"), an Edit home option that starts off. It came off the home with Home step 2 (290ba92),
 * when Friends Playing and Connections moved to Social; this is the two of them in the home's own
 * anatomy, the bankroll line's 35g x 5r bars:
 *
 *   - who is playing now (their latest live update, not busted): the event, and their stack at
 *     the blinds when they posted one; a LIVE pill;
 *   - then who has an event today on the schedule they share: the first one with the room and the
 *     time, and how many events on the name line when there are more; a TODAY pill.
 *
 * Five rows at most, then a row that says how many more and opens Social. Every row opens Social,
 * where the friend's card has the rest. Nothing to show: a single row that says so.
 */
const MAX_ROWS = 5;

export function friendsToday({ buddies, liveUpdates, buddyEvents, tournaments, today }) {
  const list = Array.isArray(buddies) ? buddies : [];
  const byId = new Map();
  for (const b of list) {
    const lu = liveUpdates && liveUpdates[b.id];
    if (lu && !lu.isBusted) byId.set(b.id, { buddy: b, live: lu, events: [] });
  }
  if (buddyEvents && Array.isArray(tournaments)) {
    const tById = new Map(tournaments.map((t) => [Number(t.id), t]));
    for (const [tid, who] of Object.entries(buddyEvents)) {
      const t = tById.get(Number(tid));
      // Stored dates read "September 30, 2026"; today is ISO: compare normalised.
      if (!t || normaliseDate(t.date) !== today) continue;
      for (const b of who || []) {
        const buddy = list.find((x) => x.id === b.id) || b;
        const row = byId.get(buddy.id) || { buddy, live: null, events: [] };
        row.events.push(t);
        byId.set(buddy.id, row);
      }
    }
  }
  const rows = [...byId.values()];
  for (const r of rows) r.events.sort((a, b) => parseTournamentTime(a) - parseTournamentTime(b));
  // Playing first, then by their first event's start.
  rows.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0)
    || (a.events[0] ? parseTournamentTime(a.events[0]) : Infinity) - (b.events[0] ? parseTournamentTime(b.events[0]) : Infinity));
  return rows;
}

const num = (v) => (v == null || v === '' ? null : Number(v).toLocaleString('en-US'));

function liveLine(lu) {
  const stack = num(lu.stack);
  const blinds = lu.bb ? [num(lu.sb) || '?', num(lu.bb), num(lu.bbAnte || lu.bb_ante)].filter(Boolean).join('/') : null;
  return [lu.eventName || 'Playing', stack ? `${stack}${blinds ? ` @ ${blinds}` : ''}` : null].filter(Boolean).join(' · ');
}

function todayLine(events) {
  const t = events[0];
  const room = getVenueInfo(t.venue, t.property).abbr;
  return `${t.time ? `${t.time} · ` : ''}${room ? `${room} · ` : ''}${t.event_name}`;
}

// The admin demo states (DashboardView demoStates), as the old Friends Playing had: made-up people.
const DEMO = [
  { buddy: { id: 'demo-f1', username: 'demo_alice', display_name: 'Alice D.' }, live: { stack: '85000', sb: '500', bb: '1000', bbAnte: '1000', eventName: 'PLO 6-Max - Day 1' }, events: [] },
  { buddy: { id: 'demo-f2', username: 'demo_bob', display_name: 'Bob R.' }, live: null,
    events: [{ id: -1, time: '7:00 PM', venue: 'Borgata', event_name: '$600 NLH Deepstack' }, { id: -2, time: '9:00 PM', venue: 'Borgata', event_name: '$250 NLH Turbo' }] },
];

export default function HomeFriends({ buddies, liveUpdates, buddyEvents, tournaments, today, onOpenSocial, demo = false }) {
  const displayName = useDisplayName();
  const rows = useMemo(() => (demo ? DEMO : friendsToday({ buddies, liveUpdates, buddyEvents, tournaments, today })),
    [demo, buddies, liveUpdates, buddyEvents, tournaments, today]);
  const live = rows.filter((r) => r.live).length;
  const shown = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS - 1) : rows;
  const rest = rows.length - shown.length;
  return (
    <section className="dashboard-section hm-friends" aria-label="Friends">
      <div className="dashboard-section-header hm-period-head">
        <div className="hm-cell hm-sec-title"><span className="hm-clip">Friends</span></div>
        {rows.length > 0 && (
          <span className="hm-cell hm-f-2xs hm-period-scope">{live ? `${live} playing` : `${rows.length} on today`}</span>
        )}
      </div>
      <div className="hm-friends-list">
        {rows.length === 0 ? (
          <button type="button" className="hm-bank-bar" onClick={onOpenSocial} aria-label="No friends playing or on today. Open Social">
            <span className="hm-bank-col">
              <span className="hm-cell hm-f-2xs hm-bank-k"><span className="hm-clip">Today</span></span>
              <span className="hm-cell hm-f-md-b hm-bank-v"><span className="hm-clip">No friends playing or on today</span></span>
            </span>
          </button>
        ) : shown.map((r) => {
          const name = displayName(r.buddy) || r.buddy.username;
          const line = r.live ? liveLine(r.live) : todayLine(r.events);
          return (
            <button key={r.buddy.id} type="button" className="hm-bank-bar" onClick={onOpenSocial}
              aria-label={`${name}: ${r.live ? 'playing now' : 'on today'}, ${line}. Open Social`}>
              <span className="hm-bank-col">
                {/* More than one event today: the count rides on the name line, which never fills, rather
                    than at the end of the event line, where a long name cut it off. */}
                <span className="hm-cell hm-f-2xs hm-bank-k"><span className="hm-clip">{name}{!r.live && r.events.length > 1 ? ` · ${r.events.length} events` : ''}</span></span>
                <span className="hm-cell hm-f-md-b hm-bank-v"><span className="hm-clip">{line}</span></span>
              </span>
              <span className={'hm-bank-pill snap-g' + (r.live ? ' is-up' : '')}><span className="hm-tag-t">{r.live ? 'Live' : 'Today'}</span></span>
            </button>
          );
        })}
        {rest > 0 && (
          <button type="button" className="hm-bank-bar" onClick={onOpenSocial} aria-label={`${rest} more friends. Open Social`}>
            <span className="hm-bank-col">
              <span className="hm-cell hm-f-2xs hm-bank-k"><span className="hm-clip">And</span></span>
              <span className="hm-cell hm-f-md-b hm-bank-v"><span className="hm-clip">{rest} more in Social</span></span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
