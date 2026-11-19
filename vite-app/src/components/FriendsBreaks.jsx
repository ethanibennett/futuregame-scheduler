import React, { useMemo } from 'react';
import { getVenueCoords, parseTournamentTime } from '../utils/utils.js';
import { useLiveClocks } from '../utils/live-clocks.js';
import { breakWindows, alignBreaks, breakNote, breakTimeline } from '../utils/break-align.js';
import './home.css';

/* Friends' breaks and dinner breaks against yours (owner, 2026-11-19: "show connected friends' breaks/dinner breaks
   and how they align"; "Add the breaks timeline to Social too"). Drawn on Home's Friends section (HomeFriends) and at
   the top of Social's Connections (SocialView); the arithmetic is utils/break-align.js.

   useFriendsBreaks asks the room clock of each event a friend is playing (their live update today) and of yours, and
   returns each friend's one-line note against your breaks and the timeline; BreaksTimeline draws the timeline card
   (home.css .hm-breaks: you on top, a dinner break outlined, the time shared with you filled). */

// The admin demo states: breaks as a WSOP clock would give them, minutes from now (made up).
const demoClock = (breaks, extra = {}) => ({ state: 'running', receivedAt: Date.now(), onBreak: false, breaks, ...extra });
export const DEMO_BREAK_CLOCKS = {
  me: demoClock([{ inMins: 25, mins: 20 }, { inMins: 170, mins: 60 }]),
  'demo-f1': demoClock([{ inMins: 25, mins: 20 }, { inMins: 185, mins: 60 }]),
  'demo-f3': demoClock([{ inMins: 70, mins: 20 }], { onBreak: true, remainingSecs: 540, breakMins: 15 }),
};

const target = (id, t) => {
  const c = t ? getVenueCoords(t.venue, t.property) : null;
  return { id, lat: c?.lat, lng: c?.lng, ...(t ? { startMs: parseTournamentTime(t) } : {}) };
};

/**
 * friends:  [{ buddy, live }] (live = the friend's latest live update today, not busted; its tournamentId)
 * myClock:  your event's clock answer, when the caller already has it (Home); else
 * myEvent:  your event ({ id, venue, property, date, time }), whose clock is asked for here (Social)
 * nameOf:   buddy -> the name shown
 * → { notes: Map(buddyId -> line), people, timeline, mine }
 */
export function useFriendsBreaks({ friends, tournaments, myClock = null, myEvent = null, demo = false, nameOf }) {
  const clockKey = useMemo(() => {
    if (demo) return '';
    const tById = new Map((tournaments || []).map((t) => [Number(t.id), t]));
    const ids = [...new Set((friends || []).filter((f) => f.live && f.live.tournamentId).map((f) => Number(f.live.tournamentId)))].slice(0, 20);
    const list = ids.map((id) => target(id, tById.get(id)));
    if (!myClock && myEvent && Number.isFinite(Number(myEvent.id)) && !ids.includes(Number(myEvent.id))) {
      list.push(target(Number(myEvent.id), tById.get(Number(myEvent.id)) || myEvent));
    }
    return JSON.stringify(list);
  }, [demo, friends, tournaments, myClock, myEvent]);
  const clocks = useLiveClocks(clockKey ? JSON.parse(clockKey) : [], clockKey);
  const now = Date.now();
  const mineClock = demo ? DEMO_BREAK_CLOCKS.me : (myClock || (myEvent ? clocks[Number(myEvent.id)] : null));
  const mine = breakWindows(mineClock, now);
  const notes = new Map();
  const people = mine.length ? [{ key: 'me', name: 'You', me: true, windows: mine }] : [];
  for (const f of friends || []) {
    if (!f || !f.live) continue;
    const w = breakWindows(demo ? DEMO_BREAK_CLOCKS[f.buddy.id] : clocks[Number(f.live.tournamentId)], now);
    if (!w.length) continue;
    notes.set(f.buddy.id, breakNote(alignBreaks(mine, w), now));
    people.push({ key: f.buddy.id, name: (nameOf && nameOf(f.buddy)) || f.buddy.username, windows: w });
  }
  const timeline = people.some((p) => !p.me) ? breakTimeline(people, now) : null;
  return { notes, people, timeline, mine };
}

/** The timeline card: "Breaks · next N h" and the "With you" key, a row per person, the hours under them. */
export function BreaksTimeline({ data, className = '' }) {
  const { timeline, people, notes, mine } = data || {};
  if (!timeline) return null;
  return (
    <div className={'hm-breaks' + (className ? ' ' + className : '')} role="img"
      aria-label={`Breaks, the next ${timeline.hours} hours. ${people.filter((p) => !p.me).map((p) => `${p.name}: ${notes.get(p.key) || ''}`).join('; ')}`}>
      <div className="hm-breaks-head">
        <span className="hm-cell hm-f-2xs hm-bank-k"><span className="hm-clip">Breaks · next {timeline.hours} h</span></span>
        {mine.length > 0 && (
          <span className="hm-cell hm-f-2xs hm-bank-k hm-breaks-key"><span className="hm-clip"><i className="hm-breaks-swatch" aria-hidden="true" />With you</span></span>
        )}
      </div>
      {timeline.rows.map((row) => (
        <div key={row.key} className={'hm-breaks-row' + (row.me ? ' is-me' : '')}>
          <span className="hm-cell hm-f-2xs hm-bank-k hm-breaks-who"><span className="hm-clip">{row.name}</span></span>
          <span className="hm-breaks-track">
            {row.blocks.map((b, i) => (
              <span key={'b' + i} className={'hm-breaks-block' + (b.open ? ' is-open' : '') + (b.dinner ? ' is-dinner' : '') + (b.now ? ' is-now' : '')}
                style={{ left: `${b.left}%`, ...(b.open ? {} : { width: `${b.width}%` }) }} />
            ))}
            {row.shared.map((sh, i) => (
              <span key={'s' + i} className="hm-breaks-shared" style={{ left: `${sh.left}%`, width: `${sh.width}%` }} />
            ))}
          </span>
        </div>
      ))}
      <div className="hm-breaks-axis">
        <span className="hm-breaks-who" />
        <span className="hm-breaks-ticks">
          <span className="hm-cell hm-f-2xs hm-bank-k hm-breaks-tick is-now">Now</span>
          {timeline.ticks.map((t) => (
            <span key={t.left} className="hm-cell hm-f-2xs hm-bank-k hm-breaks-tick" style={{ left: `${t.left}%` }}>{t.label}</span>
          ))}
        </span>
      </div>
    </div>
  );
}
