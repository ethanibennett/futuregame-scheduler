import React from 'react';
import { getVenueInfo, getVenueBrandColor, getStripAbbr, splitEventStage, VENUE_MAP } from '../utils/utils.js';
import { monthLabel, stripFor } from '../utils/backer-page.js';
import useInkBalance from '../hooks/useInkBalance.js';

/*
 * The Schedule's event card, in parts, for the Bankroll tab's lists (owner, 2026-10-16): a result
 * (TrackingView) and a cash session (CashSessions) are drawn with CalendarEventRow's markup and
 * classes, under the backer page's month pills. tracking-cards.css styles what differs.
 */

/** A room's strip, as the backer page's session card finds it (VENUE_MAP by name, else the Schedule's
 *  derived code). */
export function roomStrip(room) {
  const r = String(room || '').trim();
  if (!r) return { abbr: null, name: '' };
  const st = stripFor(r, VENUE_MAP);
  const info = getVenueInfo(r) || {};
  return { abbr: st.abbr || info.abbr || null, name: info.longName || r };
}

export function stripOf(venue, property) {
  const info = getVenueInfo(venue, property) || {};
  const abbr = info.abbr || null;
  return { abbr, name: info.longName || venue || '' };
}
export function CardStrip({ venue, property, room, open, onToggle }) {
  // A cash session names a ROOM (Parx), which VENUE_MAP knows by its long name; a tournament names a
  // series and its property (getVenueInfo). Either way the Schedule's strip.
  const { abbr, name } = room !== undefined ? roomStrip(room) : stripOf(venue, property);
  return (
    <div className={'cal-venue-strip' + (abbr ? '' : ' is-neutral')} aria-hidden="true" onClick={onToggle}
      style={{ background: abbr ? getVenueBrandColor(abbr) : 'var(--border-strong)', color: '#ffffff', cursor: 'pointer' }}>
      <span className="venue-strip-abbr">{abbr ? getStripAbbr(abbr) : ''}</span>
      {open && <span className="venue-strip-full">{name}</span>}
    </div>
  );
}
export function CardName({ name }) {
  const { base, stage } = splitEventStage(name || '');
  return (
    <span className="cal-event-name" title={name || ''}>
      {stage ? (<><span className="cal-event-base">{base}</span><span className="cal-event-stage">{stage}</span></>) : name}
    </span>
  );
}
export function CardChevron({ open, onToggle }) {
  return (
    <div className={'cal-event-chevron' + (open ? ' open' : '')} onClick={onToggle}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
    </div>
  );
}
/* A month break, as the backer page draws its sessions (owner, 2026-10-16): the Schedule's date-break
   pill with the month where the day number sits, the count on the pill's line, the month's net at its
   right end; sticky at the scroller's top. */
export function MonthBreak({ monthKey, count, net, fmtNet, noun = 'event' }) {
  const { mon, year } = monthLabel(monthKey);
  const labelRef = React.useRef(null);
  useInkBalance(labelRef, [mon, year]);
  return (
    <div className="schedule-date-break tr-month-break" style={{ top: 0 }}>
      <span className="date-break-pill tr-month-pill">
        <span className="date-break-label" ref={labelRef}>
          <b className="date-break-day">{mon}</b>
          <span className="date-break-mon">{year}</span>
        </span>
      </span>
      <span className="date-break-count">{count === 1 ? '1 ' + noun : count + ' ' + noun + 's'}</span>
      <span className="date-break-end tr-month-end">
        <span className={'date-break-dow tr-month-net' + (net > 0 ? ' is-pos' : net < 0 ? ' is-neg' : '')}>{fmtNet(net)}</span>
      </span>
    </div>
  );
}
export const barKeys = (toggle) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
export const stop = (fn) => (e) => { e.stopPropagation(); fn && fn(e); };
