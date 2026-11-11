import React, { useEffect, useMemo } from 'react';
import CalendarEventRow from './CalendarEventRow.jsx';
import { FirstRun } from './EmptyState.jsx';
import { normaliseDate, getToday, extractConditions } from '../utils/utils.js';

/*
 * The desktop Schedule tab's middle pane (docs/desktop-layout.md): the selected
 * event, rendered by the SAME CalendarEventRow the phone expands inline, held
 * open (`detail`), so the detail has one implementation on every surface.
 *
 * Geometry: a 6r head (title baseline on the 4r line, 2r below it), then the
 * card. The pane itself is 9N+1 g wide with 1g margins, so the card spans
 * 9N-1 g — 35g at N=4, the phone card width exactly.
 */
export default function DesktopEventDetail({
  selectedId, onSelect, tournaments, mySchedule, ...rowProps
}) {
  // The same derivations TournamentsView makes from the saved schedule.
  const scheduleIds = useMemo(() => new Set((mySchedule || []).map(x => x.id)), [mySchedule]);
  const saved = useMemo(() => (mySchedule || []).find(x => x.id === selectedId) || null, [mySchedule, selectedId]);
  const t = useMemo(
    () => (selectedId == null ? null : (tournaments || []).find(x => x.id === selectedId)
      || (mySchedule || []).find(x => x.id === selectedId) || null),
    [selectedId, tournaments, mySchedule]
  );

  // Closing from inside the detail puts focus back on the event's card, so a keyboard user keeps their place
  // in the list (App improvements 58); from anywhere else focus stays where it is.
  const closeKeepingPlace = () => {
    const detail = document.querySelector('.dk-detail');
    const inside = !!(detail && detail.contains(document.activeElement));
    const id = selectedId;
    onSelect(null);
    if (!inside || id == null) return;
    requestAnimationFrame(() => {
      const bar = document.querySelector(`.dk-pane-main [data-tid="${id}"] .cal-event-bar`) || document.querySelector(`[data-tid="${id}"] .cal-event-bar`);
      if (bar) bar.focus({ preventScroll: true });
    });
  };
  // Esc clears the selection — the keyboard way out of the detail pane.
  useEffect(() => {
    if (!t) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // An overlay in front takes the Escape: the filter panel, Location, Travel, Export, the venue map, any
      // modal (App improvements 53).
      if (document.querySelector('.filter-panel, .share-menu-panel, .vm-sheet, .location-dropdown, [role="dialog"][aria-modal="true"]')) return;
      closeKeepingPlace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [t, onSelect]);

  if (!t) {
    return (
      <div className="dk-detail dk-detail-empty">
        <FirstRun
          icon="calendar"
          title="No event selected"
          body="Pick an event in the schedule to see its structure, late registration and actions here."
          compact
        />
      </div>
    );
  }

  const today = getToday();
  const date = normaliseDate(t.date);
  return (
    <div className="dk-detail">
      <div className="dk-pane-head">
        <h2 className="dk-pane-title">Selected event</h2>
        <button type="button" className="dk-pane-close" onClick={closeKeepingPlace} aria-label="Close event (Esc)" title="Close (Esc)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </button>
      </div>
      <CalendarEventRow
        key={t.id}
        detail
        tournament={t}
        isInSchedule={scheduleIds.has(t.id)}
        isPast={date < today}
        showMiniLateReg={date === today}
        conditions={saved ? extractConditions(saved) : []}
        isAnchor={!!(saved && saved.is_anchor)}
        plannedEntries={(saved && saved.planned_entries) || 1}
        allTournaments={tournaments}
        scheduleIds={scheduleIds}
        {...rowProps}
      />
    </div>
  );
}
