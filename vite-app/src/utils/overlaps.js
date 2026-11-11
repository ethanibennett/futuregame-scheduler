/* Events of the player's that start while an earlier one of theirs is still in late registration (Laws of
   UX pick 21, owner 2026-11-10). detectConflicts (utils.js) catches two events at the same instant; this
   catches the commoner clash, an event starting while another is still open to enter: Flight C (11:15 AM)
   in late reg until 5:45 PM runs over the O8 at 12:15 PM.

   B overlaps A when both are on the schedule, A is not a restart (a Day 2 is not a choice to bust from),
   B starts after A, and B starts before A's late registration closes: its stated close, else four hours
   after A's start. An event that already has a plan (a condition) is not flagged: the plan answers it.
   Each B is reported once, against the earliest A it overlaps.

   Pure: the time helpers are passed in (utils.js parseTournamentTime and parseLateRegEnd, extractConditions). */
const FALLBACK_REG_MS = 4 * 3600e3;

export function detectOverlaps(schedule, { startOf, regCloseOf, hasConditions = () => false }) {
  const rows = (schedule || [])
    .filter((t) => t && t.venue !== 'Personal')
    .map((t) => ({ t, ts: startOf(t) }))
    .filter((x) => Number.isFinite(x.ts))
    .sort((a, b) => a.ts - b.ts);
  const out = new Map();
  for (let i = 0; i < rows.length; i++) {
    const A = rows[i];
    if (A.t.is_restart) continue;
    let close = regCloseOf(A.t);
    if (!Number.isFinite(close) || close <= A.ts) close = A.ts + FALLBACK_REG_MS;
    for (let j = i + 1; j < rows.length; j++) {
      const B = rows[j];
      if (B.ts >= close) break;
      if (B.ts <= A.ts) continue; // the same instant is detectConflicts' clash
      if (out.has(B.t.id) || hasConditions(B.t)) continue;
      out.set(B.t.id, { parent: A.t, parentStart: A.ts });
    }
  }
  return out;
}
