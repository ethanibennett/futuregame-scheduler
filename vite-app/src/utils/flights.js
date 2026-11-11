/**
 * A multi-flight event's flights (Features 2, 2026-11-11): every Day 1 / Flight row of the same event,
 * grouped by room and event number first (flight naming varies by room: "Day 1A", "Flight A",
 * "Round 1"), by room and the title less its stage only when there is no number. Day 2 is the restart
 * row of the same event, when the feed has one.
 */
import { splitEventStage, normaliseDate, parseTournamentTime } from './utils.js';

const DAY1 = /^(day\s*1\s*[a-z]?|flight\s*[a-z0-9]{1,2}|round\s*1)$/i;

export function isDayOne(t) {
  if (!t || t.is_restart) return false;
  const { stage } = splitEventStage(t.event_name || '');
  if (!stage) return false;
  return stage.split(' - ').some((s) => DAY1.test(s.trim()));
}

/** The letter a flight is known by: "Day 1C" -> "C", "Flight B" -> "B", "Round 1" -> "1". */
export function flightLetter(t) {
  const { stage } = splitEventStage(t.event_name || '');
  const m = /(?:day\s*1\s*([a-z])|flight\s*([a-z0-9]{1,2}))/i.exec(stage || '');
  return m ? (m[1] || m[2]).toUpperCase() : '1';
}

const sameEvent = (a, b) => {
  if (!a || !b || a.venue !== b.venue) return false;
  const na = String(a.event_number || '').trim().replace(/[A-Za-z]+$/, '');
  const nb = String(b.event_number || '').trim().replace(/[A-Za-z]+$/, '');
  if (na && nb) return na === nb;
  return splitEventStage(a.event_name || '').base === splitEventStage(b.event_name || '').base;
};

/** { flights: [t, ...] in start order, dayTwo: t | null } for an opened flight, or null if it has no siblings. */
export function flightsOf(t, all) {
  if (!isDayOne(t)) return null;
  const flights = (all || []).filter((x) => isDayOne(x) && sameEvent(x, t));
  if (flights.length < 2) return null;
  flights.sort((a, b) => parseTournamentTime(a) - parseTournamentTime(b));
  const dayTwo = (all || []).filter((x) => sameEvent(x, t) && (x.is_restart || /day\s*2/i.test(splitEventStage(x.event_name || '').stage || '')))
    .sort((a, b) => parseTournamentTime(a) - parseTournamentTime(b))[0] || null;
  return { flights, dayTwo, base: splitEventStage(t.event_name || '').base };
}

/** The saved event a flight overlaps (same day, starting within 8 hours either way), or null. */
export function clashWith(flight, saved) {
  const start = parseTournamentTime(flight);
  const day = normaliseDate(flight.date);
  for (const s of saved || []) {
    if (!s || s.id === flight.id || s.venue === 'Personal') continue;
    if (normaliseDate(s.date) !== day) continue;
    const st = parseTournamentTime(s);
    if (Math.abs(st - start) < 8 * 3600e3) return s;
  }
  return null;
}
