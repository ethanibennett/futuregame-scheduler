import React, { useCallback, useEffect, useMemo } from 'react';
import CalendarEventRow from './CalendarEventRow.jsx';
import { FirstRun } from './EmptyState.jsx';
import { findClosestFlight, parseTournamentTime, normaliseDate, getToday, extractConditions } from '../utils/utils.js';

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

  // Esc clears the selection — the keyboard way out of the detail pane.
  useEffect(() => {
    if (!t) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [t, onSelect]);

  // A related-event badge (satellite -> target flight) selects that flight here,
  // the same closest-flight rule the list uses.
  const onNavigateToEvent = useCallback((num, sat) => {
    const flights = (tournaments || []).filter(x => x.event_number === num);
    const best = findClosestFlight(flights, parseTournamentTime(sat));
    if (best) onSelect(best.id);
  }, [tournaments, onSelect]);

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
        <h2 className="dk-pane-title">Event</h2>
        <button type="button" className="dk-pane-close" onClick={() => onSelect(null)} aria-label="Close event (Esc)" title="Close (Esc)">
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
        onNavigateToEvent={onNavigateToEvent}
        {...rowProps}
      />
    </div>
  );
}
