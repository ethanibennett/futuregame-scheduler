// A sit and go's arithmetic (owner, 2026-11-26: "either in a cash game or sit and go format"; "Buy in, top 3 paid"):
// the blinds at each level, the prizes, and the places of the players a hand knocks out. Pure: the runtime
// (runtime.mjs) keeps the tournament's state and calls these.
import { tableStakes } from '../../vite-app/src/utils/poker-rules/live-hand.js';

/* Each level's stakes as a multiple of the first level's (the host sets level 1). */
export const LADDER = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500];

/* The stakes at a level (0-based), in the form the rules read: whole chips, the big blind at least the small. */
export function stakesAt(gameType, base, level) {
  const m = LADDER[Math.max(0, Math.min(level, LADDER.length - 1))];
  const sb = Math.max(1, Math.round(base.sb * m));
  const bb = Math.max(sb, Math.round(base.bb * m));
  const ante = Math.round((base.ante || 0) * m);
  return tableStakes(gameType, { sb, bb, ante });
}

/* The level the clock is on (0-based): a level lasts levelMins from the start; the last one lasts for ever. */
export function levelAt(sng, now) {
  if (!sng || sng.startedAt == null) return 0;
  return Math.max(0, Math.min(LADDER.length - 1, Math.floor((now - sng.startedAt) / (sng.levelMins * 60000))));
}

/* When the clock's level ends (ms since the epoch), or null on the last. */
export function levelEndsAt(sng, now) {
  const lv = levelAt(sng, now);
  if (!sng || sng.startedAt == null || lv >= LADDER.length - 1) return null;
  return sng.startedAt + (lv + 1) * sng.levelMins * 60000;
}

/* Who is paid, as percentages of the pool, by the number who entered: seven or more pay three (50/30/20, the owner's
   pick), five or six pay two (65/35), four or fewer pay the winner alone. */
export function payoutPcts(entrants) {
  return entrants <= 4 ? [100] : entrants <= 6 ? [65, 35] : [50, 30, 20];
}

/* The prizes in chips, first place first: the pool (every buy-in) split by payoutPcts, whole chips, the odd chips
   to first, so the prizes add up to the pool exactly. */
export function prizesFor(entrants, buyIn) {
  const pool = entrants * buyIn;
  const out = payoutPcts(entrants).map((p) => Math.floor((pool * p) / 100));
  out[0] += pool - out.reduce((a, b) => a + b, 0);
  return out;
}

/**
 * The places of the players one hand knocked out. `busts`: [{ userId, name, start, seat }] with each one's stack
 * when the hand began; `left`: how many still have chips. The one who began the hand with more finishes higher;
 * players who began it level tie, each placed at the best of the places they span, sharing those places' prizes
 * (the odd chip to the first of them in seat order). -> [{ userId, name, place, prize }], best place first.
 */
export function placeBusts(busts, left, prizes) {
  const sorted = busts.slice().sort((a, b) => b.start - a.start || a.seat - b.seat);
  const out = [];
  let next = left + 1;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].start === sorted[i].start) j++;
    const group = sorted.slice(i, j + 1);
    let pot = 0;
    for (let k = 0; k < group.length; k++) pot += prizes[next + k - 1] || 0;
    const each = Math.floor(pot / group.length);
    group.forEach((g, k) => out.push({ userId: g.userId, name: g.name, place: next, prize: each + (k === 0 ? pot - each * group.length : 0) }));
    next += group.length;
    i = j + 1;
  }
  return out;
}

/* "1st", "2nd", "3rd", "4th" … */
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
