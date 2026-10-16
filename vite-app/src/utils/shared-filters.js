import { useCallback, useEffect, useState } from 'react';
import { readLocalLocation, readLocalFilters } from './location-prefs.js';

/*
 * The Schedule list's filters, shared with the Calendar tab (owner, 2026-10-16: "the filters
 * applied on the schedule tab should stay active on the calendar page"). Both tabs stay mounted,
 * and each kept its own copy, read once from this browser's saved choices: a filter set on the
 * Schedule tab never reached the Calendar (the date range, games, venues, bounties and the rest),
 * and only the location and online choices were ever read across. Now there is one value: either
 * tab's setter changes it for both, and whichever tab mounts first builds it, the same way.
 *
 * Persistence is unchanged: TournamentsView and CalendarView still write the location and the
 * standing choices to localStorage and the account; a one-look date range stays session-only.
 */

export const DEFAULT_FILTERS = {
  minBuyin: '', maxBuyin: '', buyinRanges: [], rakeRanges: [], selectedGames: [],
  hiddenVenues: [], bountyOnly: false, mysteryBountyOnly: false, headsUpOnly: false,
  tagTeamOnly: false, employeesOnly: false, hideSatellites: true, hideRestarts: true,
  hideSideEvents: false, hiddenMonths: [], ladiesOnly: false, seniorsOnly: false,
  mixedOnly: false, dateFrom: '', dateTo: '',
  maxDistance: '', userLocation: null, locationRegion: null, locationLabel: null,
  // Live only by default (launch plan, 2026-10-15): online play shows once the player says yes,
  // in setup or the Online menu. A browser that used the app before keeps its choice
  // (location-prefs.js migrateLiveOnlyDefaults). It is deliberately NOT a location field: an
  // online event has no place, so every location filter would otherwise hide all of it.
  showOnline: false,
  /* "Available in <state>": only online rooms that can serve the user's
     jurisdiction. Set from the Online menu (2026-09-30; it was dark from 09-25
     when its filter-row checkbox was removed) and persisted with the other
     online choices. matchesOnline ignores it while no jurisdiction is known. On by default
     (launch plan, 2026-10-15): a room that cannot serve the player's state stays out of the list. */
  onlyAvailableOnline: true,
  /* Two-letter state code, or null. A standing fact about the user rather than
     a filter, which is why it survives "Clear all" alongside the location. */
  jurisdiction: null,
  /* True when the user chose the state by hand. A derived lookup must not
     overwrite a deliberate choice. */
  jurisdictionManual: false,
  /* Per-room overrides: { [siteKey]: { minBuyin, seriesOnly } }. Empty means no
     restriction anywhere, which is what a filter set saved before this existed
     also means. */
  siteRules: {},
};

/** The starting filters: the defaults, this browser's saved standing choices, and its location. */
export function initialFilters() {
  const savedLoc = readLocalLocation() || {};
  const savedFilters = readLocalFilters() || {};
  return {
    ...DEFAULT_FILTERS,
    ...savedFilters,
    maxDistance: savedLoc.maxDistance || '',
    userLocation: savedLoc.userLocation || null,
    locationRegion: savedLoc.locationRegion || null,
    locationLabel: savedLoc.locationLabel || null,
    jurisdiction: savedLoc.jurisdiction || null,
    jurisdictionManual: !!savedLoc.jurisdictionManual,
  };
}

/** "Clear all": every filter back to its default, except the standing choices (the location, the
 *  state, and the online answers setup asks for), which are facts about the player. */
export function clearedFilters(f) {
  return {
    ...DEFAULT_FILTERS,
    maxDistance: f.maxDistance,
    userLocation: f.userLocation,
    locationRegion: f.locationRegion,
    locationLabel: f.locationLabel,
    jurisdiction: f.jurisdiction,
    jurisdictionManual: f.jurisdictionManual,
    showOnline: f.showOnline,
    onlyAvailableOnline: f.onlyAvailableOnline,
    siteRules: f.siteRules,
  };
}

let current = null;
const subscribers = new Set();

/** [filters, setFilters], shared by every component that calls it. setFilters takes a value or an
 *  updater, like useState's. */
export function useSharedFilters(init = initialFilters) {
  const [value, setValue] = useState(() => {
    if (current === null) current = init();
    return current;
  });
  useEffect(() => {
    subscribers.add(setValue);
    if (current !== null && current !== value) setValue(current);   // changed before this mounted
    return () => { subscribers.delete(setValue); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = useCallback((u) => {
    const base = current === null ? init() : current;
    const next = typeof u === 'function' ? u(base) : u;
    if (next === current) return;
    current = next;
    subscribers.forEach((fn) => fn(next));
  }, [init]);
  return [value, set];
}

/** Tests only: forget the shared value. */
export function resetSharedFilters() { current = null; }
