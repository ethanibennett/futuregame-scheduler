/**
 * Plans in common (Features 40, 2026-11-11): a friend's upcoming events against the player's own My
 * Schedule. Each of theirs is 'both' (the same event), 'flight' (the same event on another flight: same
 * room and event number, else the same name less its "- Day 1A" / "Flight B" part) or 'theirs'; the
 * player's own events that match none of theirs are `onlyMine`. Personal days never count.
 */
import { normaliseDate } from './utils.js';

const FLIGHT_RE = /\s*[-–—:]?\s*(?:day\s*\d+\s*[a-z]?|flight\s*[a-z0-9]+|round\s*\d+)\b.*$/i;

export function flightLabel(name) {
  const m = /(day\s*\d+\s*[a-z]?|flight\s*[a-z0-9]+|round\s*\d+)/i.exec(String(name || ''));
  return m ? m[1].replace(/\s+/g, ' ').replace(/^day/i, 'Day').replace(/^flight/i, 'Flight').replace(/^round/i, 'Round') : null;
}

/** The key two flights of one event share, or null when there is nothing to match on. */
export function eventKey(t) {
  if (!t || t.venue === 'Personal') return null;
  const room = String(t.venue || '').trim().toLowerCase();
  if (t.event_number != null && String(t.event_number).trim() !== '') return `${room}#${String(t.event_number).trim().replace(/[A-Za-z]+$/, '')}`;
  const base = String(t.event_name || '').replace(FLIGHT_RE, '').trim().toLowerCase();
  return base ? `${room}|${base}` : null;
}

export function plansInCommon(theirs, mine, todayISO) {
  const myIds = new Set();
  const myByKey = new Map();
  const myUpcoming = [];
  for (const t of mine || []) {
    if (!t || t.venue === 'Personal') continue;
    const id = Number(t.id);
    myIds.add(id);
    const k = eventKey(t);
    if (k) { if (!myByKey.has(k)) myByKey.set(k, []); myByKey.get(k).push(t); }
    const d = normaliseDate(t.date);
    if (!todayISO || (d && d >= todayISO)) myUpcoming.push(t);
  }
  const mark = new Map();
  const note = new Map();
  const theirIds = new Set();
  const theirKeys = new Set();
  let together = 0, onlyThem = 0;
  for (const t of theirs || []) {
    if (!t || t.venue === 'Personal') continue;
    const id = Number(t.id);
    theirIds.add(id);
    const k = eventKey(t);
    if (k) theirKeys.add(k);
    if (myIds.has(id)) { mark.set(t.id, 'both'); together += 1; continue; }
    const mineSame = k ? (myByKey.get(k) || []) : [];
    if (mineSame.length) {
      mark.set(t.id, 'flight');
      const lbl = flightLabel(mineSame[0].event_name);
      note.set(t.id, lbl ? `you play ${lbl}` : 'you play another flight');
      onlyThem += 1;
      continue;
    }
    mark.set(t.id, 'theirs');
    onlyThem += 1;
  }
  const onlyMine = myUpcoming.filter((t) => !theirIds.has(Number(t.id)) && !(eventKey(t) && theirKeys.has(eventKey(t))));
  return { together, onlyThem, onlyMine, mark, note };
}
