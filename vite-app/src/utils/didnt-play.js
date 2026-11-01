// A "Didn't play" day with no venue (owner, 2026-11-01: "a blank-venue did-not-play session card in the
// bankroll tracker"): a Personal event (venue 'Personal', the way a Travel Day or a Day Off is kept)
// named DNP_TYPE, created already marked not played (user_schedules.not_played, its note in
// not_played_note), so it is the Results list's Didn't play card without a scheduled event behind
// it. It is a marker, not a schedule entry: the Schedule, the Calendar, the home and the exports never
// show it (App.jsx scheduleShown), only the Bankroll tab's results list does.
export const DNP_TYPE = "Didn't play";

/** Is this schedule row a no-venue Didn't play marker? */
export const isDnpMarker = (e) => !!e && e.venue === 'Personal' && e.event_name === DNP_TYPE;

/** The schedule without its Didn't play markers: what every screen but Results shows. */
export const withoutDnpMarkers = (rows) => (Array.isArray(rows) ? rows.filter((e) => !isDnpMarker(e)) : rows);
