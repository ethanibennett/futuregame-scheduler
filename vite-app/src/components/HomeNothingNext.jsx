import React, { useMemo } from 'react';
import { matchesLocation, isOnline } from '../utils/utils.js';
import { readLocalLocation } from '../utils/location-prefs.js';
import { weekAhead, weekAheadLine } from '../utils/home-upnext.js';

// ── Up Next with nothing on the schedule (verdict section 1(d)) ────────────────────────────────
// One 35g x 5r prompt in place of the carousel: "Nothing scheduled" over what the week holds near
// the user ("38 events this week near you"), and a Schedule pill; the whole card opens the
// Schedule. "Near" is the user's own standing location (the Schedule's saved location filter: a
// radius around a place, or a region), and an online event is near nobody; with no location set
// it counts the week's events everywhere and says so ("12 events this week"). Restart rows (a
// Day 2) and Personal entries are not events to go and play.
export default function HomeNothingNext({ tournaments, today, onOpen }) {
  const loc = readLocalLocation();
  const located = !!(loc && ((loc.userLocation && loc.maxDistance) || loc.locationRegion));
  const locKey = located ? JSON.stringify([loc.userLocation, loc.maxDistance, loc.locationRegion]) : '';
  const { count } = useMemo(
    () => weekAhead(tournaments, today, located ? { near: (e) => !isOnline(e) && matchesLocation(e, loc) } : {}),
    [tournaments, today, locKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const line = weekAheadLine(count, located);
  return (
    <button type="button" className="hm-next-empty" onClick={onOpen} aria-label={`Nothing scheduled. ${line}. Open the schedule`}>
      <span className="hm-next-col">
        <span className="hm-cell hm-f-2xs hm-next-k"><span className="hm-clip">Nothing scheduled</span></span>
        <span className="hm-cell hm-f-md-b hm-next-v"><span className="hm-clip">{line}</span></span>
      </span>
      <span className="hm-next-pill snap-g"><span className="hm-tag-t">Schedule</span></span>
    </button>
  );
}
