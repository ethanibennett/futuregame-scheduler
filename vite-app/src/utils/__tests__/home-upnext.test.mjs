// node --test src/utils/__tests__/home-upnext.test.mjs   (from vite-app/; or `npm run test:home` from the root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConditions, serverTime, parentOutcome, resolveCondition, resolveConditions, offLast, planKind,
  cashCard, weekAhead, weekAheadLine, DAY_ONE_HOURS, wasBagged, openBags,
} from '../home-upnext.js';

const H = 36e5;
// Starts in epoch ms, as utils.js parseTournamentTime gives them (the test's own fixed instants).
const T12 = Date.parse('2026-10-11T16:00:00Z');   // #12 at noon EDT yesterday
const T14 = Date.parse('2026-10-11T23:00:00Z');   // #14 at 7 PM EDT yesterday
const START = { 12: T12, 14: T14, 23: Date.parse('2026-10-12T22:00:00Z') };
const startOf = (e) => START[e.event_number] ?? null;
const sqlite = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const ev = (id, num, extra = {}) => ({ id, event_number: String(num), event_name: `Event ${num}`, date: '2026-10-12', venue: 'Borgata', ...extra });
const plan = (id, num, conds, extra = {}) => ev(id, num, { conditions_json: JSON.stringify(conds), ...extra });

test('conditions_json: a list of known conditions, else nothing', () => {
  assert.deepEqual(parseConditions(null), []);
  assert.deepEqual(parseConditions(''), []);
  assert.deepEqual(parseConditions('not json'), []);
  assert.deepEqual(parseConditions('{"type":"IF_BUST"}'), []);
  assert.deepEqual(parseConditions('[{"type":"IF_BUST","dependsOnId":3},{"type":"MYSTERY"},null]'), [{ type: 'IF_BUST', dependsOnId: 3 }]);
  assert.deepEqual(parseConditions([{ type: 'PROFIT_THRESHOLD', profitThreshold: 500 }]).length, 1);
});

test('server timestamps: SQLite text is UTC, ISO passes through', () => {
  assert.equal(serverTime('2026-10-11 16:40:00'), Date.parse('2026-10-11T16:40:00Z'));
  assert.equal(serverTime('2026-10-11T16:40:00.000Z'), Date.parse('2026-10-11T16:40:00Z'));
  assert.equal(serverTime(''), null);
  assert.equal(serverTime('soon'), null);
});

test('a parent\'s outcome: a result is final, then the latest update', () => {
  assert.deepEqual(parentOutcome(null, null), { state: null, cashed: null, bustAt: null, bagged: null });
  assert.equal(parentOutcome(null, { is_busted: 0, is_bagged: 0, stack: 40000 }).state, 'playing');
  assert.equal(parentOutcome(null, { is_busted: 0, is_bagged: 1, bag_day: 1 }).state, 'bagged');
  const bust = { is_busted: 1, created_at: sqlite(T12 + 4 * H) };
  assert.deepEqual(parentOutcome(null, bust), { state: 'over', cashed: false, bustAt: T12 + 4 * H, bagged: null });
  // A Finish with a deal payout is a cash.
  assert.equal(parentOutcome(null, { ...bust, deal_payout: 5200 }).cashed, true);
  // A result wins over a bag or a no-payout bust (the Cashed form logged after it).
  assert.deepEqual(parentOutcome({ cashed: 1 }, { is_bagged: 1 }), { state: 'over', cashed: true, bustAt: null, bagged: true });
  assert.equal(parentOutcome({ cashed: 1 }, bust).cashed, true);
  assert.equal(parentOutcome({ cashed: 1 }, bust).bustAt, T12 + 4 * H);
  assert.equal(parentOutcome({ cashed: 0 }, null).cashed, false);
});

test('the bag history: /active\'s bag_count outlives the bag update itself', () => {
  assert.equal(wasBagged(null), null);
  assert.equal(wasBagged({ is_bagged: 1, bag_count: 1 }), true);
  assert.equal(wasBagged({ is_bagged: 1 }), true);                    // no history, but the update is the bag
  assert.equal(wasBagged({ is_busted: 1, bag_count: 1 }), true);      // bagged Day 1, busted Day 2
  assert.equal(wasBagged({ is_busted: 1, bag_count: 0 }), false);     // known: never bagged
  assert.equal(wasBagged({ is_busted: 1 }), null);                    // an older reply: unknown
  assert.equal(wasBagged({ is_busted: 0, bag_count: '2' }), true);    // back in it on Day 3
  // The outcome carries it beside the state: a Day 2 bust is still 'over', and bagged.
  assert.deepEqual(parentOutcome(null, { is_busted: 1, bag_count: 1, created_at: sqlite(T14 + 20 * H) }),
    { state: 'over', cashed: false, bustAt: T14 + 20 * H, bagged: true });
  assert.equal(parentOutcome({ cashed: 1 }, { is_busted: 1, bag_count: 1, deal_payout: 9000 }).bagged, true);
  assert.equal(parentOutcome(null, { is_busted: 0, is_bagged: 0, bag_count: 1 }).state, 'playing');
  assert.equal(parentOutcome(null, { is_busted: 0, is_bagged: 0, bag_count: 1 }).bagged, true);
});

test('IF_BUST: on once the parent is over, off when it bagged (then, or on any day before)', () => {
  const c = { type: 'IF_BUST', dependsOnId: 1 };
  assert.deepEqual(resolveCondition(c, { state: null }), { state: 'pending' });
  assert.deepEqual(resolveCondition(c, { state: 'playing' }), { state: 'pending' });
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: false }), { state: 'on', verb: 'busted' });
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: true }), { state: 'on', verb: 'cashed' });
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: false, bagged: false }), { state: 'on', verb: 'busted' });
  assert.deepEqual(resolveCondition(c, { state: 'bagged' }), { state: 'off', verb: 'bagged' });
  // Bagged 1A, so 1B was off; Day 2 then brought a bust, or a cash: 1B stays off.
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: false, bagged: true }), { state: 'off', verb: 'bagged' });
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: true, bagged: true }), { state: 'off', verb: 'bagged' });
  assert.deepEqual(resolveCondition(c, { state: 'playing', bagged: true }), { state: 'off', verb: 'bagged' });
});

test('IF_BAG: on from a bag at any point; off from a bust that never bagged; the hour only without a history', () => {
  const c = { type: 'IF_BAG', dependsOnId: 1 };
  assert.deepEqual(resolveCondition(c, { state: 'bagged' }, T14), { state: 'on', verb: 'bagged' });
  assert.deepEqual(resolveCondition(c, { state: 'playing' }, T14), { state: 'pending' });
  // The history: bagged, then a Day 2 bust 10 h after an evening start (inside DAY_ONE_HOURS, which
  // the old guess read as a Day 1 bust), or a cash: on either way.
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: false, bustAt: T14 + 10 * H, bagged: true }, T14), { state: 'on', verb: 'bagged' });
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: true, bustAt: null, bagged: true }, T14), { state: 'on', verb: 'bagged' });
  // Never bagged: off, however late the bust (no 30 h "both branches on").
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: false, bustAt: T14 + 30 * H, bagged: false }, T14), { state: 'off', verb: 'busted' });
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: true, bustAt: null, bagged: false }, T14), { state: 'off', verb: 'cashed' });
  // No history (an older reply): the bust's hour is the fallback.
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: false, bustAt: T14 + 5 * H }, T14), { state: 'off', verb: 'busted' });
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: true, bustAt: T14 + 9 * H }, T14), { state: 'off', verb: 'cashed' });
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: false, bustAt: T14 + (DAY_ONE_HOURS + 2) * H }, T14), { state: 'on', verb: 'bagged' });
  // A result logged with no live update, or no start time to measure from: not known, so pending.
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: false, bustAt: null }, T14), { state: 'pending' });
  assert.deepEqual(resolveCondition(c, { state: 'over', cashed: false, bustAt: T14 + H }, null), { state: 'pending' });
});

test('resolveConditions: bag 1A, then Day 2 busts or cashes — 1B (IF_BUST) stays off, the IF_BAG branch on', () => {
  const a = ev(1, '1A', { event_name: 'Main Event - Flight 1A', date: '2026-10-10' });
  const schedule = [
    a,
    plan(10, '1B', [{ type: 'IF_BUST', dependsOnId: 1 }], { date: '2026-10-11' }),
    plan(11, 77, [{ type: 'IF_BAG', dependsOnId: 1 }], { date: '2026-10-12' }),
  ];
  const T1A = Date.parse('2026-10-10T23:00:00Z'); // 7 PM EDT
  const opts = { startOf: (e) => (e.id === 1 ? T1A : null) };
  // Day 2 bust 10 h after the evening start (the 18 h guess called that a Day 1 bust).
  const bustD2 = [{ id: 5, tournament_id: 1, is_busted: 1, bust_count: 1, bag_count: 1, created_at: sqlite(T1A + 10 * H) }];
  let res = resolveConditions(schedule, bustD2, [], opts);
  assert.equal(res.get(10).state, 'off');
  assert.equal(res.get(10).items[0].label, 'Off: bagged #1A');
  assert.equal(res.get(11).state, 'on');
  assert.equal(res.get(11).items[0].label, 'On: bagged #1A');
  // Day 2 cashed, logged as a result (with a Finish update carrying the deal).
  const cashD2 = [{ id: 6, tournament_id: 1, is_busted: 1, bust_count: 1, bag_count: 1, deal_payout: 9000, created_at: sqlite(T1A + 30 * H) }];
  res = resolveConditions(schedule, cashD2, [{ tournament_id: 1, cashed: 1, cash_amount: 9000 }], opts);
  assert.equal(res.get(10).state, 'off');
  assert.equal(res.get(11).state, 'on');
  // A bust on Day 1 (never bagged), 30 h in by the clock (a long day, a late reg): 1B on, the IF_BAG branch off.
  const bustD1 = [{ id: 7, tournament_id: 1, is_busted: 1, bust_count: 1, bag_count: 0, created_at: sqlite(T1A + 30 * H) }];
  res = resolveConditions(schedule, bustD1, [], opts);
  assert.equal(res.get(10).state, 'on');
  assert.equal(res.get(11).state, 'off');
});

test('satellites: a cash is a seat', () => {
  const win = { type: 'IF_WIN_SEAT', dependsOnId: 1 }, none = { type: 'IF_NO_SEAT', dependsOnId: 1 };
  assert.deepEqual(resolveCondition(win, { state: 'over', cashed: true }), { state: 'on', verb: 'won seat' });
  assert.deepEqual(resolveCondition(win, { state: 'over', cashed: false }), { state: 'off', verb: 'no seat' });
  assert.deepEqual(resolveCondition(none, { state: 'over', cashed: true }), { state: 'off', verb: 'won seat' });
  assert.deepEqual(resolveCondition(none, { state: 'over', cashed: false }), { state: 'on', verb: 'no seat' });
  assert.deepEqual(resolveCondition(win, { state: 'playing' }), { state: 'pending' });
  assert.deepEqual(resolveCondition(none, { state: 'bagged' }), { state: 'pending' });
});

test('resolveConditions: the seeded day (bust on #12, #14 still playing, a satellite running)', () => {
  const e12 = ev(1, 12, { date: '2026-10-11' }), e14 = ev(2, 14, { date: '2026-10-11' }), s23 = ev(3, 23, { is_satellite: 1 });
  const schedule = [
    e12, e14, s23,
    plan(10, 21, [{ type: 'IF_BUST', dependsOnId: 1 }]),
    plan(11, 22, [{ type: 'IF_BAG', dependsOnId: 2 }]),
    plan(12, 26, [{ type: 'IF_BAG', dependsOnId: 1 }]),
    plan(13, 30, [{ type: 'IF_WIN_SEAT', dependsOnId: 3 }]),
    plan(14, 42, [{ type: 'PROFIT_THRESHOLD', profitThreshold: 5000 }]),
    plan(15, 43, 'garbage'),
  ];
  const updates = [
    { id: 1, tournament_id: 1, is_busted: 0, created_at: sqlite(T12 + 5 * 6e4) },
    { id: 2, tournament_id: 1, is_busted: 1, created_at: sqlite(T12 + 4.6 * H) },
    { id: 3, tournament_id: 2, is_busted: 0, is_bagged: 0, stack: 46500 },
  ];
  const res = resolveConditions(schedule, updates, [], { startOf });
  assert.deepEqual(res.get(10), { state: 'on', items: [{ type: 'IF_BUST', dependsOnId: 1, state: 'on', label: 'On: busted #12', title: 'Plan: if bust #12. #12: busted, so this is on' }] });
  assert.equal(res.get(11).state, 'pending');
  assert.equal(res.get(11).items[0].label, 'If bag #14');
  assert.equal(res.get(12).state, 'off');
  assert.equal(res.get(12).items[0].label, 'Off: busted #12');
  assert.equal(res.get(13).items[0].label, 'If seat #23');
  assert.deepEqual(res.get(14), { state: 'pending', items: [{ type: 'PROFIT_THRESHOLD', dependsOnId: null, state: 'pending', manual: true,
    label: 'If up $5,000', title: 'If up $5,000 (not tracked: set by hand)' }] });
  // No plan, or an unreadable one: not in the map.
  assert.equal(res.has(1), false);
  assert.equal(res.has(15), false);
  // Without startOf, IF_BAG cannot tell a Day 1 bust from a later one.
  assert.equal(resolveConditions(schedule, updates, [], {}).get(12).state, 'pending');
});

test('resolveConditions: a satellite resolved by its result, and several routes into one event', () => {
  const s19 = ev(5, 19, { is_satellite: 1, date: '2026-10-10' });
  const schedule = [
    s19,
    plan(20, 40, [{ type: 'IF_WIN_SEAT', dependsOnId: 5 }]),
    plan(21, 41, [{ type: 'IF_NO_SEAT', dependsOnId: 5 }]),
    // A seat OR being up $5,000: the seat did not come, the profit route is never evaluated.
    plan(22, 44, [{ type: 'IF_NO_SEAT', dependsOnId: 5 }, { type: 'PROFIT_THRESHOLD', profitThreshold: 5000 }]),
    // Two routes, one on.
    plan(23, 45, [{ type: 'IF_NO_SEAT', dependsOnId: 5 }, { type: 'IF_WIN_SEAT', dependsOnId: 5 }]),
  ];
  const results = [{ tournament_id: 5, cashed: 1, cash_amount: 1100 }];
  const res = resolveConditions(schedule, [], results, { startOf });
  assert.equal(res.get(20).state, 'on');
  assert.equal(res.get(20).items[0].label, 'On: won seat #19');
  assert.equal(res.get(21).state, 'off');
  assert.equal(res.get(21).items[0].label, 'Off: won seat #19');
  assert.equal(res.get(22).state, 'pending');
  assert.deepEqual(res.get(22).items.map((i) => i.state), ['off', 'pending']);
  assert.equal(res.get(23).state, 'on');
});

test('resolveConditions: a parent off the schedule is named from the feed, a result or an update', () => {
  const schedule = [
    plan(30, 50, [{ type: 'IF_BUST', dependsOnId: 101 }]),
    plan(31, 51, [{ type: 'IF_BUST', dependsOnId: 102 }]),
    plan(32, 52, [{ type: 'IF_BUST', dependsOnId: 103 }]),
    plan(33, 53, [{ type: 'IF_BUST', dependsOnId: 104 }]),
    plan(34, 54, [{ type: 'IF_BUST', dependsOnId: 105 }]),
  ];
  const events = [{ id: 101, event_number: 'MTT-7', event_name: 'NLH' }];
  const results = [{ tournament_id: 102, event_number: '', event_name: 'Wednesday Night Deepstack Bounty', cashed: 0 }];
  const updates = [{ id: 9, tournament_id: 103, event_name: 'Daily', is_busted: 1 }];
  const res = resolveConditions(schedule, updates, results, { events });
  assert.equal(res.get(30).items[0].label, 'If bust #7');
  assert.equal(res.get(31).items[0].label, 'On: busted Wednesday Night…');
  assert.equal(res.get(32).items[0].label, 'On: busted Daily');
  assert.equal(res.get(33).items[0].label, 'If bust #?');
  // A live update with no row behind it on the schedule still resolves (keyed by tournament_id).
  assert.equal(res.get(34).state, 'pending');
});

test('open bags: a bag with a result logged is over, as resolveConditions reads it', () => {
  const ups = [
    { id: 1, tournament_id: 46, is_bagged: 1, bag_day: 1, stack: 182000 },   // bagged, then cashed and logged
    { id: 2, tournament_id: 47, is_bagged: 1, bag_day: 1, stack: 90000 },    // bagged, Day 2 to come
    { id: 3, tournament_id: 48, is_busted: 1 },                               // busted
    { id: 4, tournament_id: 49, stack: 30000 },                               // playing
  ];
  const results = [{ tournament_id: 46, cashed: 1, cash_amount: 1450, finish_place: 88 }];
  const open = openBags(ups, results);
  assert.deepEqual([...open.keys()], [47]);
  assert.equal(open.get(47).stack, 90000);
  // Without the result, #46 is still a bag to come back to; and its plan child agrees with it.
  assert.deepEqual([...openBags(ups, []).keys()], [46, 47]);
  const sch = [ev(46, 46, { event_name: 'NLH Colossus Day 1C' }), plan(60, 60, [{ type: 'IF_BAG', dependsOnId: 46 }])];
  assert.equal(resolveConditions(sch, ups, results).get(60).state, 'on');
  // A bust after the bag closes it too; nothing in, nothing out.
  assert.deepEqual([...openBags([...ups, { id: 5, tournament_id: 47, is_busted: 1 }], results).keys()], []);
  assert.deepEqual([...openBags(null, null).keys()], []);
});

test('offLast and planKind', () => {
  const res = new Map([[2, { state: 'off', items: [] }], [3, { state: 'on', items: [] }], [4, { state: 'pending', items: [] }], [6, { state: 'off', items: [] }]]);
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }];
  assert.deepEqual(offLast(list, res).map((e) => e.id), [1, 3, 4, 5, 2, 6]);
  assert.deepEqual(offLast(list, null).map((e) => e.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(planKind({ id: 1 }, res), 'normal');
  assert.equal(planKind({ id: 1, conditions_json: '[{"type":"MYSTERY"}]' }, res), 'conditional');
  assert.equal(planKind({ id: 2 }, res), 'conditional');
  assert.equal(planKind({ id: 3 }, res), 'normal');
  assert.equal(planKind({ id: 4 }, res), 'conditional');
  assert.equal(planKind({ id: 3, is_anchor: 1 }, res), 'anchor');
});

test('the cash card: what is in play, the last stack against what was in, a dash before any update', () => {
  assert.equal(cashCard(null, []), null);
  const s = { id: 7, game: 'NLH', stakes: '2/5', room: 'Maryland Live', buy_in: 1000, rebuys: 1, currency: 'USD' };
  const stacks = [{ at: 'a', amount: 620, invested: 500, result: 120 }, { at: 'b', amount: 1085, invested: 1000 }];
  assert.deepEqual(cashCard(s, stacks), { id: 7, name: 'NLH 2/5', room: 'Maryland Live', currency: 'USD', inPlay: 1000, rebuys: 1, stack: 1085, result: 85, stackAt: 'b' });
  const bare = cashCard({ id: 8, buy_in: 300 }, []);
  assert.equal(bare.name, 'Cash game');
  assert.equal(bare.room, '');
  assert.equal(bare.stack, null);
  assert.equal(bare.result, null);
  assert.equal(bare.currency, 'USD');
});

test('nothing scheduled: the week ahead, near the user when they set a place', () => {
  const rows = [
    { date: '2026-10-12', venue: 'Borgata' },
    { date: '2026-10-18', venue: 'Parx' },
    { date: '2026-10-19', venue: 'Borgata' },          // the eighth day: out
    { date: '2026-10-11', venue: 'Borgata' },          // yesterday: out
    { date: '2026-10-13', venue: 'Borgata', is_restart: 1 },
    { date: '2026-10-13', venue: 'Personal' },
    { date: 'Oct 14, 2026', venue: 'WSOP.com', is_online: 1 },
  ];
  assert.deepEqual(weekAhead(rows, '2026-10-12'), { count: 3, from: '2026-10-12', to: '2026-10-18' });
  assert.equal(weekAhead(rows, '2026-10-12', { near: (e) => !e.is_online && e.venue === 'Borgata' }).count, 1);
  assert.equal(weekAhead([], '2026-10-12').count, 0);
  assert.equal(weekAheadLine(38, true), '38 events this week near you');
  assert.equal(weekAheadLine(1, false), '1 event this week');
  assert.equal(weekAheadLine(1250, false), '1,250 events this week');
  assert.equal(weekAheadLine(0, true), 'No events near you this week');
  assert.equal(weekAheadLine(0, false), 'Browse the schedule');
});
