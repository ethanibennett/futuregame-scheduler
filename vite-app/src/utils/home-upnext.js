// ── The home's Up Next (verdict section 1): plans that resolve themselves, the running cash
// session's card, and the prompt for an empty schedule ──────────────────────────────────────────
// Pure and dependency-free past ./home.js (no utils.js, which reads localStorage at import), so it
// runs under `node --test` (src/utils/__tests__/home-upnext.test.mjs; `npm run test:home`).
//
// CONDITIONS. An event on the schedule can carry a plan (schedule_conditions, sent with GET
// /api/my-schedule as conditions_json): a list of conditions, each one "I'll play this if ...".
//   IF_BUST      {dependsOnId}  ... I bust from that event (an earlier one, same day and room)
//   IF_BAG       {dependsOnId}  ... I bag that event (a multi-day event's Day 1)
//   IF_WIN_SEAT  {dependsOnId}  ... I win a seat in that satellite
//   IF_NO_SEAT   {dependsOnId}  ... I don't
//   PROFIT_THRESHOLD {profitThreshold}  ... I'm up $X. NOT evaluated: whether "up" is measured over
//                the series, the day or all time is undecided (owner, 2026-10-12), so it keeps its
//                label, "If up $5,000", and never turns on or off by itself.
// Until now nothing evaluated any of them, so after a bust the home still offered both branches.
//
// What became of the event a condition depends on (its PARENT) is read from what the app already
// has: the result logged for it (GET /api/tracking), else its latest live update (GET
// /api/live-updates/active: the latest update per event). A result is final, so it wins.
//   over     a result, or a bust update. cashed: the result's Cashed, or the bust's deal payout
//            (the live-update Finish posts the payout as deal_payout and logs the same result).
//   bagged   the latest update is a bag (and nothing has been logged)
//   playing  any other update: still in it
//   unknown  nothing yet
// Beside the state, whether the parent was EVER bagged (outcome.bagged): /active sends each event's
// bag history with its latest update (bag_count, every bag posted for it), because the latest
// update alone forgets a bag as soon as Day 2 brings a bust or a result. true: bagged at some
// point; false: the history is known and holds no bag; null: unknown (no update, or a reply with no
// bag_count, from before the field existed).
// Each condition then reads on, off or pending (still waiting on its parent):
//   IF_BUST      bagged at any point -> off ("Off: bagged #12": the flight was bagged, so the
//                branch was off that day, whatever Day 2 then brought); otherwise over -> on
//                ("On: busted #12", "On: cashed #12": out of it either way)
//   IF_BAG       bagged at any point -> on. Over and never bagged -> off ("Off: busted #14").
//                Only when the history is unknown does the time of the bust decide: within
//                DAY_ONE_HOURS of the parent's start it was on Day 1 (off), later than that it
//                came on a later day (on). A result with no bust update and no history says
//                nothing about when, so the condition stays pending rather than guess.
//   IF_WIN_SEAT  over -> cashed: on ("On: won seat #23"), else off ("Off: no seat #23")
//   IF_NO_SEAT   the reverse
// Several conditions on one event are several routes in (a seat, OR being up $X), so the event is
// on when any condition is on, off only when every condition is off, and otherwise pending. An off
// event dims and sorts last on Up Next (offLast); an on event sorts as a plain one.
import { eventNo, isoDay } from './home.js';

/**
 * A Day 1 runs well under this many hours from its start; a bust later than that was on Day 2+.
 * Only a fallback, for an update that carries no bag history (see wasBagged).
 */
export const DAY_ONE_HOURS = 18;

/**
 * Whether an event was ever bagged, from its latest live update (GET /api/live-updates/active):
 * its bag_count (every bag update posted for it) when the reply carries one, else only what the
 * update itself says (a bag). true | false | null (unknown: no update, or no history to read).
 */
export function wasBagged(update) {
  const u = update || null;
  if (!u) return null;
  if (Number(u.is_bagged)) return true;
  if (u.bag_count != null) return Number(u.bag_count) > 0;
  return null;
}

const KNOWN = new Set(['IF_BUST', 'IF_BAG', 'IF_WIN_SEAT', 'IF_NO_SEAT', 'PROFIT_THRESHOLD']);
const WAITING = { IF_BUST: 'If bust', IF_BAG: 'If bag', IF_WIN_SEAT: 'If seat', IF_NO_SEAT: 'If no seat' };

/** conditions_json as a list of known conditions ([] when absent, unreadable or empty). */
export function parseConditions(json) {
  if (!json) return [];
  let list = json;
  if (typeof json === 'string') {
    try { list = JSON.parse(json); } catch { return []; }
  }
  return Array.isArray(list) ? list.filter((c) => c && KNOWN.has(c.type)) : [];
}

/**
 * A server timestamp in epoch ms: ISO ('2026-10-11T16:40:00.000Z'), or SQLite's CURRENT_TIMESTAMP
 * ('2026-10-11 16:40:00', which is UTC with no zone written). null when it cannot be read.
 */
export function serverTime(s) {
  if (!s) return null;
  const str = String(s).trim();
  const sqlite = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(str);
  const ms = Date.parse(sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : str);
  return Number.isFinite(ms) ? ms : null;
}

// The latest update per event (the endpoint already sends one each; a list with more is tolerated).
function latestUpdates(updates) {
  const latest = new Map();
  for (const u of Array.isArray(updates) ? updates : []) {
    if (!u) continue;
    const k = Number(u.tournament_id);
    const prev = latest.get(k);
    if (!prev || (Number(u.id) || 0) > (Number(prev.id) || 0)) latest.set(k, u);
  }
  return latest;
}

/**
 * What became of an event, from its result and its latest live update (see the header):
 * { state: 'over' | 'bagged' | 'playing' | null, cashed, bustAt, bagged } (bagged: wasBagged).
 */
export function parentOutcome(result, update) {
  const u = update || null;
  const bust = u && Number(u.is_busted) ? u : null;
  const bagged = wasBagged(u);
  if (result) {
    return { state: 'over', cashed: !!Number(result.cashed), bustAt: bust ? serverTime(bust.created_at) : null, bagged };
  }
  if (bust) return { state: 'over', cashed: Number(bust.deal_payout) > 0, bustAt: serverTime(bust.created_at), bagged };
  if (u && Number(u.is_bagged)) return { state: 'bagged', cashed: null, bustAt: null, bagged: true };
  if (u) return { state: 'playing', cashed: null, bustAt: null, bagged };
  return { state: null, cashed: null, bustAt: null, bagged: null };
}

// How a condition names its parent: '#12'; a parent with no number by its name, shortened; '#?'.
function refFor(row) {
  if (!row) return '#?';
  const n = eventNo(row.event_number);
  if (n) return n;
  const name = String(row.event_name || row.name || '').trim();
  if (!name) return '#?';
  if (name.length <= 18) return name;
  // Cut at a word where one is near (a tag cannot truncate: it is as wide as its label).
  let cut = name.slice(0, 17);
  const sp = cut.lastIndexOf(' ');
  if (sp >= 8 && name[17] !== ' ') cut = cut.slice(0, sp);
  return `${cut.trimEnd()}…`;
}

/** One condition against its parent's outcome: { state: 'on'|'off'|'pending', verb } (verb on a resolution). */
export function resolveCondition(c, outcome, parentStart = null) {
  const o = outcome || { state: null };
  const over = o.state === 'over';
  // Bagged at some point (the history), or bagged now (an outcome built without one).
  const bagged = o.bagged === true || o.state === 'bagged';
  switch (c && c.type) {
    case 'IF_BUST':
      if (bagged) return { state: 'off', verb: 'bagged' };
      if (over) return { state: 'on', verb: o.cashed ? 'cashed' : 'busted' };
      return { state: 'pending' };
    case 'IF_BAG':
      if (bagged) return { state: 'on', verb: 'bagged' };
      if (over && o.bagged === false) return { state: 'off', verb: o.cashed ? 'cashed' : 'busted' };
      // No history to read (an older reply): when the bust came is the only clue.
      if (over && o.bagged == null && o.bustAt != null && Number.isFinite(parentStart)) {
        const hours = (o.bustAt - parentStart) / 36e5;
        if (hours > DAY_ONE_HOURS) return { state: 'on', verb: 'bagged' };
        return { state: 'off', verb: o.cashed ? 'cashed' : 'busted' };
      }
      return { state: 'pending' };
    case 'IF_WIN_SEAT':
      if (over) return o.cashed ? { state: 'on', verb: 'won seat' } : { state: 'off', verb: 'no seat' };
      return { state: 'pending' };
    case 'IF_NO_SEAT':
      if (over) return o.cashed ? { state: 'off', verb: 'won seat' } : { state: 'on', verb: 'no seat' };
      return { state: 'pending' };
    default:
      return { state: 'pending' };
  }
}

/**
 * Resolve the plans on the user's schedule.
 *   schedule  GET /api/my-schedule rows (conditions_json)
 *   updates   GET /api/live-updates/active (the latest update per event)
 *   results   GET /api/tracking rows (tournament_id, cashed)
 *   opts.events   more rows to name a parent from and time it by (GET /api/tournaments)
 *   opts.startOf  event -> epoch ms of its start (utils.js parseTournamentTime, venue-zone aware);
 *                 without it IF_BAG can only resolve from a bag
 * Returns Map(event id -> { state: 'on'|'off'|'pending', items }), only for events with a plan.
 * Each item: { type, dependsOnId, state, label, title, manual? } where label is the card's tag:
 * 'If bust #12' while waiting, 'On: busted #12' / 'Off: bagged #12' once resolved, and for a
 * PROFIT_THRESHOLD always 'If up $5,000' (manual: never evaluated).
 */
export function resolveConditions(schedule, updates, results, opts = {}) {
  const rows = new Map();
  const know = (r, key = 'id') => {
    if (!r) return;
    const id = Number(r[key]);
    if (Number.isInteger(id) && !rows.has(id)) rows.set(id, r);
  };
  for (const r of Array.isArray(schedule) ? schedule : []) know(r);
  for (const r of Array.isArray(opts.events) ? opts.events : []) know(r);
  const resultBy = new Map();
  for (const r of Array.isArray(results) ? results : []) {
    if (!r) continue;
    const id = Number(r.tournament_id);
    if (!Number.isInteger(id)) continue;
    if (!resultBy.has(id)) resultBy.set(id, r);
    know(r, 'tournament_id');
  }
  const latest = latestUpdates(updates);
  for (const u of latest.values()) know(u, 'tournament_id');
  const startOf = typeof opts.startOf === 'function' ? opts.startOf : null;

  const out = new Map();
  for (const e of Array.isArray(schedule) ? schedule : []) {
    if (!e) continue;
    const conds = parseConditions(e.conditions_json);
    if (!conds.length) continue;
    const items = conds.map((c) => {
      if (c.type === 'PROFIT_THRESHOLD') {
        const n = Number(c.profitThreshold) || 0;
        const label = `If up $${n.toLocaleString('en-US')}`;
        return { type: c.type, dependsOnId: null, state: 'pending', manual: true, label, title: `${label} (not tracked: set by hand)` };
      }
      const pid = Number(c.dependsOnId);
      const parent = rows.get(pid) || null;
      const ref = refFor(parent);
      const outcome = parentOutcome(resultBy.get(pid) || null, latest.get(pid) || null);
      let start = null;
      if (startOf && parent && parent.date) {
        const v = startOf(parent);
        if (Number.isFinite(v)) start = v;
      }
      const r = resolveCondition(c, outcome, start);
      const plan = `${WAITING[c.type]} ${ref}`;
      if (r.state === 'pending') return { type: c.type, dependsOnId: pid, state: 'pending', label: plan, title: `Plan: ${plan.toLowerCase()}. Waiting on ${ref}` };
      const label = `${r.state === 'on' ? 'On' : 'Off'}: ${r.verb} ${ref}`;
      return { type: c.type, dependsOnId: pid, state: r.state, label, title: `Plan: ${plan.toLowerCase()}. ${ref}: ${r.verb}, so this is ${r.state}` };
    });
    const state = items.some((i) => i.state === 'on') ? 'on'
      : items.every((i) => i.state === 'off') ? 'off' : 'pending';
    out.set(Number(e.id), { state, items });
  }
  return out;
}

/** Up Next's order with every event whose plan is off moved to the end (both parts keep their order). */
export function offLast(list, resolved) {
  const keep = [], off = [];
  for (const e of Array.isArray(list) ? list : []) {
    const r = resolved && e ? resolved.get(Number(e.id)) : null;
    (r && r.state === 'off' ? off : keep).push(e);
  }
  return keep.concat(off);
}

/**
 * The card's kind on Up Next: 'anchor' (Locked In), 'conditional' (a plan still waiting, or one
 * that is off), else 'normal' (no plan, or one that came on: it is simply part of the day now).
 */
export function planKind(event, resolved) {
  if (event && Number(event.is_anchor)) return 'anchor';
  const r = resolved && event ? resolved.get(Number(event.id)) : null;
  if (r) return r.state === 'on' ? 'normal' : 'conditional';
  return event && event.conditions_json ? 'conditional' : 'normal';
}

// ── The running cash session's card (admins) ──

/**
 * What the home's cash card shows for the live session (GET /api/cash-sessions/live; hooks/
 * useLiveCashSession): the game and stakes ('NLH 2/5', else 'Cash game'), the room, what is in
 * play (the buy-in plus every rebuy: the server's buy_in), the last stack update and what it stood
 * at against what was in at that moment. null without a session. A session with no stack update
 * yet has stack and result null (the card shows a dash with its reason, never $0).
 */
export function cashCard(session, stacks) {
  if (!session) return null;
  const list = Array.isArray(stacks) ? stacks : [];
  const last = list.length ? list[list.length - 1] : null;
  const name = [session.game, session.stakes].filter(Boolean).join(' ');
  return {
    id: session.id,
    name: name || 'Cash game',
    room: String(session.room || '').trim(),
    currency: session.currency || 'USD',
    inPlay: Math.max(0, Number(session.buy_in) || 0),
    rebuys: Math.max(0, Number(session.rebuys) || 0),
    stack: last ? Number(last.amount) || 0 : null,
    result: last ? (last.result != null ? Number(last.result) : (Number(last.amount) || 0) - (Number(last.invested) || 0)) : null,
    stackAt: last ? last.at : null,
  };
}

// ── Nothing scheduled ──

const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/**
 * Events in the week from today (today and the next six days) that a user with nothing scheduled
 * could look at: not a restart row (a Day 2), not a Personal entry, and, when `near` is given
 * (the user's saved location: utils.js matchesLocation on a live event), near them.
 *   events  GET /api/tournaments rows
 * Returns { count, from, to }.
 */
export function weekAhead(events, today, opts = {}) {
  const days = Math.max(1, Number(opts.days) || 7);
  const from = today, to = addDays(today, days - 1);
  const near = typeof opts.near === 'function' ? opts.near : null;
  let count = 0;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || Number(e.is_restart) || e.venue === 'Personal') continue;
    const d = isoDay(e.date);
    if (!d || d < from || d > to) continue;
    if (near && !near(e)) continue;
    count += 1;
  }
  return { count, from, to };
}

/** The empty prompt's second line: '38 events this week near you', or what to do when it is 0. */
export function weekAheadLine(count, located) {
  const n = Number(count) || 0;
  if (n > 0) return `${n.toLocaleString('en-US')} event${n === 1 ? '' : 's'} this week${located ? ' near you' : ''}`;
  return located ? 'No events near you this week' : 'Browse the schedule';
}
