import React from 'react';
import Icon from './Icon.jsx';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Su','M','Tu','W','Th','F','Sa'];

/**
 * The date break between day groups.
 *
 * This block was byte-identical in ScheduleView and TournamentsView and had
 * already started to drift between them, and SharedScheduleView — the only page
 * a non-user ever loads — had no date grouping at all, so a thirty-event trip
 * rendered as thirty undifferentiated cards with no way to see where Tuesday
 * ended. One component, three callers.
 *
 * Three fixes ride along:
 *   - Today's marker was `--accent`, the same neutral grey as the buy-in, the
 *     active filter chip, the active date button and the FAB. It is the one
 *     mark the whole list is scrolled to on mount, so it is the strongest
 *     candidate on this surface for the focal colour --brand exists to supply.
 *   - The pinned header had no edge: rows scrolled UNDER it against a flat
 *     --bg, and the rows are 1.08:1 against that background. Both sticky
 *     ancestors above it had deleted their box-shadow because the variable
 *     resolved late (see the comments on .sticky-filters), so this uses a
 *     gradient scrim, which cannot suffer the same fallback bug.
 *   - The collapse affordance was a raw ▶ glyph rendered in Univers while
 *     every other chevron on the surface is an SVG.
 */
export default function DateBreak({
  date,
  top = 0,
  isToday = false,
  eventCount = null,
  collapsed = null,
  onToggle = null,
  onPillClick = null,
}) {
  const d = new Date(date + 'T12:00:00');
  const dayNum = String(d.getDate()).padStart(2, '0');
  const monthAbbr = MONTHS[d.getMonth()];
  const dayOfWeek = DOW[d.getDay()];
  const collapsible = collapsed !== null && typeof onToggle === 'function';

  const pill = (
    <span className="date-break-pill">
      <b className="date-break-day">{dayNum}</b>
      <span className="date-break-mon">{monthAbbr}</span>
    </span>
  );

  return (
    <div
      className={`schedule-date-break${isToday ? ' is-today' : ''}`}
      style={{ top: top + 'px' }}
      {...(collapsible ? { onClick: onToggle } : {})}
    >
      {onPillClick ? (
        <button type="button" className="date-break-pill-btn" onClick={onPillClick} aria-label={`Scroll to ${monthAbbr} ${dayNum}`}>
          {pill}
        </button>
      ) : pill}

      {eventCount !== null && (
        <span className="date-break-count">{eventCount} event{eventCount !== 1 ? 's' : ''}</span>
      )}

      <span className="date-break-end">
        <span className="date-break-dow">{dayOfWeek}</span>
        {collapsible && (
          <span className={`date-break-chev${collapsed ? '' : ' open'}`} aria-hidden="true">
            {Icon.chevRight ? Icon.chevRight() : null}
          </span>
        )}
      </span>
    </div>
  );
}
