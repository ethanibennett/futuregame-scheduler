// node --test src/utils/__tests__/home-log.test.mjs   (from vite-app/; or `npm run test:home` from the root)
// The home's To log and Last result arithmetic (utils/home.js, verdict sections 2 and 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isoDay, minutesOf, whenKey, newestFirst, bulletsFromUpdate, awaitingResults,
  fmtMoney, ordinal, topPercent, dayName, eventNo, tournamentReceipt, cashReceipt,
  receiptMilestone, lastResult, playingEnded,
} from '../home.js';

const TODAY = '2026-10-12';

test('dates in any stored shape sort by the day, then the start time', () => {
  assert.equal(isoDay('2026-10-09'), '2026-10-09');
  assert.equal(isoDay('2026-10-09T18:00:00Z'), '2026-10-09');
  assert.equal(isoDay('Oct 9, 2026'), '2026-10-09');
  assert.equal(isoDay(''), '');
  assert.equal(isoDay('not a date'), '');
  assert.equal(minutesOf('7:00 PM'), 19 * 60);
  assert.equal(minutesOf('12:00 AM'), 0);
  assert.equal(minutesOf('12:30 PM'), 12 * 60 + 30);
  assert.equal(minutesOf('19:05'), 19 * 60 + 5);
  assert.equal(minutesOf('TBD'), 0);
  assert.equal(whenKey({ date: 'Oct 9, 2026', time: '2:00 PM' }), '2026-10-09T14:00');
  // The server orders by t.date as TEXT: 'Oct 9, 2026' sorts before '2026-...' and '10:00 AM'
  // after '2:00 PM'. The client order is by the real day and time.
  const rows = [
    { id: 1, date: 'Oct 9, 2026', time: '10:00 AM' },
    { id: 2, date: '2026-10-09', time: '2:00 PM' },
    { id: 3, date: '2026-09-30', time: '11:00 PM' },
    { id: 4, date: '2026-10-10', time: '' },
    { id: 5, date: '', time: '9:00 PM' },        // no day: cannot be placed, left out
  ];
  assert.deepEqual(newestFirst(rows).map((r) => r.id), [4, 2, 1, 3]);
  // Same day and time: the later logged first, then the higher id.
  const tie = [
    { id: 7, date: '2026-10-01', time: '1:00 PM', created_at: '2026-10-01 20:00:00' },
    { id: 8, date: '2026-10-01', time: '1:00 PM', created_at: '2026-10-01 23:00:00' },
  ];
  assert.deepEqual(newestFirst(tie).map((r) => r.id), [8, 7]);
});

test('bullets: after a bust the bust count is the bullets; while running it is one more', () => {
  assert.equal(bulletsFromUpdate(null), 1);
  assert.equal(bulletsFromUpdate({ is_busted: 1, bust_count: 1 }), 1);
  assert.equal(bulletsFromUpdate({ is_busted: 1, bust_count: 3 }), 3);
  assert.equal(bulletsFromUpdate({ is_busted: 1, bust_count: 0 }), 1);   // a bust is at least one
  assert.equal(bulletsFromUpdate({ is_busted: 0, bust_count: 1 }), 2);   // re-entered, playing #2
});

// A schedule around TODAY. Ids are tournament ids.
const sched = [
  { id: 1, date: '2026-10-08', time: '11:00 AM', venue: 'Borgata', event_number: '8' },          // past, no update
  { id: 2, date: '2026-10-10', time: '3:00 PM', venue: 'Borgata', event_number: '10' },          // past, no update
  { id: 3, date: '2026-10-11', time: '12:00 PM', venue: 'Borgata', event_number: '12' },         // busted yesterday
  { id: 4, date: '2026-10-11', time: '7:00 PM', venue: 'Borgata', event_number: '14' },          // still playing
  { id: 5, date: '2026-10-11', time: '6:00 PM', venue: 'Borgata', event_number: '16' },          // bagged
  { id: 6, date: '2026-10-12', time: '12:00 PM', venue: 'Borgata', event_number: '21' },         // today, not started
  { id: 7, date: '2026-10-12', time: '11:00 AM', venue: 'Borgata', event_number: '20' },         // today, busted
  { id: 8, date: '2026-10-13', time: '11:00 AM', venue: 'Borgata', event_number: '30' },         // tomorrow
  { id: 9, date: '2026-10-09', time: '11:00 AM', venue: 'Borgata', event_number: '9' },          // logged
  { id: 10, date: '2026-10-07', time: '1:00 PM', venue: 'Personal', event_name: 'Travel day' },  // personal
  { id: 11, date: '2026-10-09', time: '12:00 PM', venue: 'Borgata', is_restart: 1 },             // a Day 2 row
  { id: 12, date: '2026-10-05', time: '12:00 PM', venue: 'Borgata', not_played: 1 },             // didn't play
  { id: 13, date: '2026-08-01', time: '12:00 PM', venue: 'Borgata' },                            // too old
  { id: 14, date: '2026-10-12', time: '9:00 AM', venue: 'Borgata', clock_ended_at: '2026-10-12T15:00:00Z' }, // today, room says ended
];
const results = [{ tournament_id: 9, cashed: 1, cash_amount: 2400, buyin: 600, num_entries: 2 }];
const updates = [
  { id: 100, tournament_id: 3, is_busted: 1, bust_count: 2, places_left: 212, total_entries: 812 },
  { id: 101, tournament_id: 4, is_busted: 0, bust_count: 0, stack: 46500 },
  { id: 102, tournament_id: 5, is_busted: 0, is_bagged: 1, bag_day: 1 },
  { id: 103, tournament_id: 7, is_busted: 1, bust_count: 1, deal_place: 3, deal_payout: 5200 },
];

test('To log: over, unlogged, on the schedule — newest first', () => {
  const list = awaitingResults(sched, results, updates, { today: TODAY });
  // Today 11 AM (busted), today 9 AM (the room's clock ended), yesterday's bust, then older days.
  assert.deepEqual(list.map((x) => x.id), [7, 14, 3, 2, 1]);
  const busted = list.find((x) => x.id === 3);
  assert.equal(busted.busted, true);
  assert.equal(busted.bullets, 2);
  assert.equal(busted.place, 212);
  assert.equal(busted.field, 812);
  const deal = list.find((x) => x.id === 7);
  assert.equal(deal.place, 3);
  assert.equal(deal.payout, 5200);
  const quiet = list.find((x) => x.id === 1);
  assert.equal(quiet.busted, false);
  assert.equal(quiet.bullets, 1);
  assert.equal(quiet.update, null);
});

test('To log: playing, bagged, today-not-started, future, logged, personal, restart, not played, old: all wait or never show', () => {
  const ids = new Set(awaitingResults(sched, results, updates, { today: TODAY }).map((x) => x.id));
  for (const id of [4, 5, 6, 8, 9, 10, 11, 12, 13]) assert.equal(ids.has(id), false, `event ${id}`);
});

test('To log: a row just logged on this device leaves at once (opts.logged), before the refetch', () => {
  const list = awaitingResults(sched, results, updates, { today: TODAY, logged: [3, 2] });
  assert.deepEqual(list.map((x) => x.id), [7, 14, 1]);
});

test('To log: the latest update decides (a re-entry after a bust is playing again)', () => {
  const ups = [
    { id: 200, tournament_id: 3, is_busted: 1, bust_count: 1 },
    { id: 201, tournament_id: 3, is_busted: 0, bust_count: 1 },     // Re-entry - Bullet 2
  ];
  assert.equal(awaitingResults(sched, [], ups, { today: TODAY }).some((x) => x.id === 3), false);
});

test('To log: a venue-zone start time orders across rooms when given', () => {
  const two = [
    { id: 1, date: '2026-10-10', time: '4:00 PM', venue: 'A' },
    { id: 2, date: '2026-10-10', time: '2:00 PM', venue: 'B' },  // 2 PM Pacific = 5 PM Eastern
  ];
  const startOf = (e) => ({ 1: Date.UTC(2026, 9, 10, 20), 2: Date.UTC(2026, 9, 10, 21) })[e.id];
  assert.deepEqual(awaitingResults(two, [], [], { today: TODAY }).map((x) => x.id), [1, 2]);
  assert.deepEqual(awaitingResults(two, [], [], { today: TODAY, startOf }).map((x) => x.id), [2, 1]);
});

test('money: whole units, $12.4k from ten thousand, a real minus, + only when asked', () => {
  assert.equal(fmtMoney(600), '$600');
  assert.equal(fmtMoney(1199.6), '$1,200');
  assert.equal(fmtMoney(9999), '$9,999');
  assert.equal(fmtMoney(10000), '$10k');
  assert.equal(fmtMoney(12449), '$12.4k');
  assert.equal(fmtMoney(-12449), '−$12.4k');
  assert.equal(fmtMoney(1250000), '$1.3M');
  assert.equal(fmtMoney(2400, null, { signed: true }), '+$2,400');
  assert.equal(fmtMoney(-600, null, { signed: true }), '−$600');
  assert.equal(fmtMoney(0, null, { signed: true }), '$0');
  assert.equal(fmtMoney(0.4, null, { signed: true }), '$0');
  assert.equal(fmtMoney(1150, { symbol: '€', pos: 'pre' }), '€1,150');
  assert.equal(fmtMoney(500, { symbol: 'kr', pos: 'suf' }), '500 kr');
  assert.equal(fmtMoney(null), '—');
  assert.equal(fmtMoney(NaN), '—');
});

test('labels: ordinals, top %, day names, event numbers', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 34, 101, 111].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '34th', '101st', '111th']);
  assert.equal(topPercent(34, 812), '4.2%');
  assert.equal(topPercent(1, 812), '0.1%');
  assert.equal(topPercent(212, 812), '26%');
  assert.equal(topPercent(900, 812), null);
  assert.equal(topPercent(null, 812), null);
  assert.equal(dayName('2026-10-12', TODAY), 'Today');
  assert.equal(dayName('2026-10-11', TODAY), 'Yesterday');
  assert.equal(dayName('2026-10-08', TODAY), 'Thu');
  assert.equal(dayName('2026-10-05', TODAY), 'Oct 5');
  assert.equal(dayName('2025-10-05', TODAY), 'Oct 5, 2025');
  assert.equal(eventNo('MTT-12'), '#12');
  assert.equal(eventNo('34'), '#34');
  assert.equal(eventNo(''), '');
  assert.equal(eventNo(null), '');
  // A series' compound id shows its number alone; a side event's (letters for a number) shows none.
  assert.equal(eventNo('5-293156-20261018'), '#5');
  assert.equal(eventNo('6-293157-20261019-1000'), '#6');
  assert.equal(eventNo('6C-x-20261020'), '#6C');
  assert.equal(eventNo('PA-293170-20261019'), '');
});

test('receipt: a near miss reads as one (finish and field), not just a loss', () => {
  const r = tournamentReceipt({ buyin: 600, num_entries: 2, cashed: 0, finish_place: 34, total_entries: 812 });
  assert.equal(r.net, -1200);
  assert.deepEqual(r.facts.map((f) => [f.key, f.value, f.label]), [
    ['entry', '2 × $600', 'Bullets'],
    ['cash', 'No cash', ''],
    ['finish', '34th of 812', 'Top 4.2%'],
  ]);
});

test('receipt: a cash without a place shows the multiple; a bust with nothing known shows a dash and why', () => {
  const c = tournamentReceipt({ buyin: 600, num_entries: 1, cashed: 1, cash_amount: 2400 });
  assert.equal(c.net, 1800);
  assert.deepEqual(c.facts.map((f) => [f.value, f.label]), [['$600', 'Buy-in'], ['$2,400', 'Cashed'], ['4×', 'Buy-in']]);
  const b = tournamentReceipt({ buyin: 400, num_entries: 1, cashed: 0 });
  const fin = b.facts.find((f) => f.key === 'finish');
  assert.equal(fin.value, '—');
  assert.equal(fin.label, 'No finish logged');
  assert.ok(fin.title);
  // Field known, no place: the field is the fact.
  assert.equal(tournamentReceipt({ buyin: 400, cashed: 0, total_entries: 1200 }).facts[2].value, '1,200');
  // A stray cash_amount on an entry that did not cash is not shown as a cash.
  assert.equal(tournamentReceipt({ buyin: 400, cashed: 0, cash_amount: 900 }).facts[1].value, 'No cash');
  // A freeroll is 'Free', not '$0'.
  assert.equal(tournamentReceipt({ buyin: 0, cashed: 0 }).facts[0].value, 'Free');
});

test('cash receipt: hours, $/h to the whole unit, stakes and game; no time is a dash with a reason', () => {
  const r = cashReceipt({ net: 465, hours: 5, stakes: '2/5', game: 'NLH' });
  assert.equal(r.net, 465);
  assert.deepEqual(r.facts.map((f) => [f.value, f.label]), [['5', 'Hours'], ['$93', 'Per hour'], ['2/5', 'NLH']]);
  const n = cashReceipt({ net: -200, hours: 0, game: 'PLO' });
  assert.equal(n.facts[0].value, '—');
  assert.equal(n.facts[1].value, '—');
  assert.ok(n.facts[1].title);
  assert.deepEqual([n.facts[2].value, n.facts[2].label], ['PLO', 'Game']);
  assert.equal(cashReceipt({ net: 30, hours: 1, stakes: '1/3', game: 'NLH' }).facts[0].label, 'Hour');
});

test('milestones: biggest cash, back to break-even, and nothing claimed when money will not convert', () => {
  const rows = [
    { id: 1, date: '2026-09-01', time: '12:00 PM', buyin: 500, cashed: 0 },
    { id: 2, date: '2026-09-02', time: '12:00 PM', buyin: 500, cashed: 1, cash_amount: 700 },
    { id: 3, date: '2026-09-03', time: '12:00 PM', buyin: 500, cashed: 0 },
  ];
  // Running net before #4: -500 + 200 - 500 = -800.
  const big = { id: 4, date: '2026-09-04', time: '12:00 PM', buyin: 500, cashed: 1, cash_amount: 1300 };
  assert.equal(receiptMilestone([...rows, big], big), 'Biggest cash');
  const even = { id: 4, date: '2026-09-04', time: '12:00 PM', buyin: 100, cashed: 1, cash_amount: 650 };
  assert.equal(receiptMilestone([...rows, even], even), null, '650 is not above 700, and -800 + 550 is still below zero');
  const even2 = { id: 4, date: '2026-09-04', time: '12:00 PM', buyin: 100, cashed: 1, cash_amount: 690 };
  assert.equal(receiptMilestone([...rows.slice(0, 2), even2], even2), 'Back to break-even'); // -300 + 590
  // The first cash ever is not "biggest": there was nothing to beat.
  const first = { id: 9, date: '2026-09-05', buyin: 100, cashed: 1, cash_amount: 300 };
  assert.equal(receiptMilestone([rows[0], first], first), null);
  // A row that cannot be converted: no claim at all.
  assert.equal(receiptMilestone([...rows, big], big, (r, f) => (r.id === 2 ? null : (f === 'cost' ? r.buyin : (r.cashed ? r.cash_amount : 0)))), null);
});

test('last result: the newest tournament, or a newer ended cash session (admins)', () => {
  const t = [
    { id: 1, date: '2026-10-09', time: '11:00 AM' },
    { id: 2, date: 'Oct 10, 2026', time: '12:00 PM' },
  ];
  assert.equal(lastResult(t, null).row.id, 2);
  const local = (y, m, d, h) => new Date(y, m - 1, d, h).toISOString();
  const cash = [
    { id: 50, session_date: '2026-10-10', started_at: local(2026, 10, 10, 19), live: false },
    { id: 51, session_date: '2026-10-11', started_at: local(2026, 10, 11, 19), live: true },
  ];
  const r = lastResult(t, cash);
  assert.equal(r.kind, 'cash');
  assert.equal(r.session.id, 50);
  // An earlier cash session loses to the tournament.
  assert.equal(lastResult(t, [{ id: 49, session_date: '2026-10-09', started_at: local(2026, 10, 9, 19) }]).kind, 'tournament');
  assert.equal(lastResult([], []), null);
  assert.equal(lastResult([], [{ id: 49, session_date: '2026-10-09', started_at: local(2026, 10, 9, 19) }]).kind, 'cash');
});

test('To log: a branch whose plan is off was never played, so it is not asked about', async () => {
  const { resolveConditions } = await import('../home-upnext.js');
  // #12 started yesterday at noon and busted 4.6 h in: Day 1, so it never bagged. #5 was the
  // IF_BAG branch (play it if #12 bags), and #6 the IF_BUST one; both were yesterday.
  const start12 = Date.UTC(2026, 9, 11, 16);
  const schedule = [
    { id: 12, event_number: '12', event_name: 'NLH Deepstack', date: '2026-10-11', time: '12:00 PM', venue: 'V' },
    { id: 5, event_number: '5', event_name: 'NLH Daily', date: '2026-10-11', time: '7:00 PM', venue: 'V',
      conditions_json: JSON.stringify([{ type: 'IF_BAG', dependsOnId: 12 }]) },
    { id: 6, event_number: '6', event_name: 'PLO Turbo', date: '2026-10-11', time: '6:00 PM', venue: 'V',
      conditions_json: JSON.stringify([{ type: 'IF_BUST', dependsOnId: 12 }]) },
  ];
  const ups = [{ id: 300, tournament_id: 12, is_busted: 1, bust_count: 1, created_at: new Date(start12 + 4.6 * 36e5).toISOString() }];
  const startOf = (e) => (e.id === 12 ? start12 : Date.UTC(2026, 9, 11, e.id === 5 ? 23 : 22));
  const plans = resolveConditions(schedule, ups, [], { startOf });
  assert.equal(plans.get(5).state, 'off');
  assert.equal(plans.get(6).state, 'on');
  const ids = awaitingResults(schedule, [], ups, { today: TODAY, startOf, plans }).map((x) => x.id);
  // #12 (the bust) and #6 (the branch that came on) wait for a result; #5 never happened.
  assert.deepEqual(ids, [6, 12]);
  // Without the plans it would be offered (the bug: a one-tap phantom -$120 result).
  assert.equal(awaitingResults(schedule, [], ups, { today: TODAY, startOf }).some((x) => x.id === 5), true);
  // A plan still waiting stays asked about: the app does not know it was skipped.
  const pending = new Map([[5, { state: 'pending' }]]);
  assert.equal(awaitingResults(schedule, [], ups, { today: TODAY, startOf, plans: pending }).some((x) => x.id === 5), true);
});

test('To log: bag 1A, then Day 2 busts or cashes — the bagged flight is asked about, 1B never is', async () => {
  const { resolveConditions } = await import('../home-upnext.js');
  // 1A two days ago at 7 PM, bagged; Day 2 yesterday. 1B (IF_BUST on 1A) was yesterday; #77 (IF_BAG
  // on 1A) was yesterday too. The bust came 10 h after 1A's start by the clock (the old 18 h guess
  // read that as a Day 1 bust and turned 1B on).
  const start1A = Date.UTC(2026, 9, 10, 23);
  const schedule = [
    { id: 1, event_number: '1A', event_name: 'Main Event - Flight 1A', date: '2026-10-10', time: '7:00 PM', venue: 'V', buyin: 1700 },
    { id: 2, event_number: '1B', event_name: 'Main Event - Flight 1B', date: '2026-10-11', time: '11:00 AM', venue: 'V', buyin: 1700,
      conditions_json: JSON.stringify([{ type: 'IF_BUST', dependsOnId: 1 }]) },
    { id: 3, event_number: '77', event_name: 'NLH Deepstack', date: '2026-10-11', time: '1:00 PM', venue: 'V', buyin: 400,
      conditions_json: JSON.stringify([{ type: 'IF_BAG', dependsOnId: 1 }]) },
  ];
  const startOf = (e) => ({ 1: start1A, 2: Date.UTC(2026, 9, 11, 15), 3: Date.UTC(2026, 9, 11, 17) })[e.id];
  const bust = [{ id: 400, tournament_id: 1, is_busted: 1, bust_count: 1, bag_count: 1, places_left: 140, created_at: new Date(start1A + 10 * 36e5).toISOString() }];
  let plans = resolveConditions(schedule, bust, [], { startOf });
  // The bagged flight (busted on Day 2) and the IF_BAG branch wait; 1B was never played.
  assert.deepEqual(awaitingResults(schedule, [], bust, { today: TODAY, startOf, plans }).map((x) => x.id), [3, 1]);
  // Cashed on Day 2 and logged: 1A is done; the IF_BAG branch still waits, 1B still is not asked.
  const cash = [{ ...bust[0], deal_payout: 9000 }];
  const results = [{ tournament_id: 1, cashed: 1, cash_amount: 9000 }];
  plans = resolveConditions(schedule, cash, results, { startOf });
  assert.deepEqual(awaitingResults(schedule, results, cash, { today: TODAY, startOf, plans }).map((x) => x.id), [3]);
  // Busted on Day 1 instead (never bagged): 1A and 1B wait, the IF_BAG branch never happened.
  const d1 = [{ ...bust[0], bag_count: 0 }];
  plans = resolveConditions(schedule, d1, [], { startOf });
  assert.deepEqual(awaitingResults(schedule, [], d1, { today: TODAY, startOf, plans }).map((x) => x.id), [2, 1]);
});

test('To log: a Start never busted is asked about once it cannot still be running', () => {
  const s = [
    { id: 1, date: '2026-10-09', time: '11:00 AM', venue: 'V', event_number: '7' },                                         // 3 days ago
    { id: 2, date: '2026-10-11', time: '7:00 PM', venue: 'V', event_number: '14' },                                          // last night
    { id: 3, date: '2026-10-12', time: '9:00 AM', venue: 'V', event_number: '20', clock_ended_at: '2026-10-12T17:00:00Z' },  // today, the room's clock ended
    { id: 4, date: '2026-10-08', time: '12:00 PM', venue: 'V', event_number: '1C', event_name: 'Main Event - Flight 1C' },   // bagged once, back on a later day
    { id: 5, date: '2026-10-09', time: '12:00 PM', venue: 'V', event_number: '9' },                                          // an older reply (no bag history)
  ];
  const ups = [
    { id: 1, tournament_id: 1, is_busted: 0, bust_count: 1, bag_count: 0, stack: 30000 },  // re-entered once, never busted again
    { id: 2, tournament_id: 2, is_busted: 0, bust_count: 0, bag_count: 0, stack: 46500 },
    { id: 3, tournament_id: 3, is_busted: 0, bust_count: 0, bag_count: 0 },
    { id: 4, tournament_id: 4, is_busted: 0, bust_count: 0, bag_count: 1, stack: 88000 },
    { id: 5, tournament_id: 5, is_busted: 0, bust_count: 0 },
  ];
  const list = awaitingResults(s, [], ups, { today: TODAY });
  assert.deepEqual(list.map((x) => x.id), [3, 1]);
  const old = list.find((x) => x.id === 1);
  assert.equal(old.busted, false);        // not a bust: Didn't play is still offered
  assert.equal(old.bullets, 2);           // on bullet 2 when last seen
  assert.equal(old.place, null);
  assert.equal(playingEnded(s[0], ups[0], TODAY), true);
  assert.equal(playingEnded(s[1], ups[1], TODAY), false);   // yesterday's can run past midnight
  assert.equal(playingEnded(s[2], ups[2], TODAY), true);
  assert.equal(playingEnded(s[3], ups[3], TODAY), false);   // multi-day: bagged between days
  assert.equal(playingEnded(s[4], ups[4], TODAY), false);   // no history: only the clock can say
  assert.equal(playingEnded(s[0], { is_busted: 1, bag_count: 0 }, TODAY), false);
  assert.equal(playingEnded(s[0], { is_bagged: 1, bag_count: 1 }, TODAY), false);
  assert.equal(playingEnded(s[0], null, TODAY), false);
});

test('To log: a fresh update keeps a never-bagged run playing, whatever its day', () => {
  // Dated 3 days ago, never bagged, a stack update posted minutes ago: still being played (a Day 3
  // updated without a Bag between days), so not a forgotten bust and not asked about.
  const now = Date.parse('2026-10-12T14:40:00Z');
  const e = { id: 1, date: '2026-10-09', time: '11:00 AM', venue: 'V', event_number: '7' };
  const fresh = { id: 9, tournament_id: 1, is_busted: 0, bust_count: 0, bag_count: 0, stack: 88000, created_at: '2026-10-12 14:37:05' };
  assert.equal(playingEnded(e, fresh, TODAY, now), false);
  assert.deepEqual(awaitingResults([e], [], [fresh], { today: TODAY, now }).map((x) => x.id), []);
  // The same update 19 h old: the day decides again, and the run is over.
  const stale = { ...fresh, created_at: '2026-10-11 19:40:00' };
  assert.equal(playingEnded(e, stale, TODAY, now), true);
  assert.deepEqual(awaitingResults([e], [], [stale], { today: TODAY, now }).map((x) => x.id), [1]);
  // ISO timestamps read the same; the room's clock ending still wins over a fresh update.
  assert.equal(playingEnded(e, { ...fresh, created_at: '2026-10-12T14:00:00.000Z' }, TODAY, now), false);
  assert.equal(playingEnded({ ...e, clock_ended_at: '2026-10-12T14:00:00Z' }, fresh, TODAY, now), true);
});
