// node --test src/utils/__tests__/bankroll-sessions.test.mjs  (from vite-app/)
// The bankroll dashboard's Sessions tab: utils/bankroll-sessions.js, on rows shaped like
// GET /api/bankrolls/reports (facts), GET /api/tracking and GET /api/cash-sessions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isoDay, dayLabel, clockMinutes, ordinal, compactMoney, shortBuyin, cashTitle, tournamentTitle, finishLabel,
  buildSessions, filterSessions, groupByYear, countLabel, tournamentFigures, cashFigures, tournamentPlace, MINUS, CHUNK,
} from '../bankroll-sessions.js';

const CONFIG = { USD: { symbol: '$', pos: 'pre' }, EUR: { symbol: '€', pos: 'pre' }, SEK: { symbol: 'kr', pos: 'suf' } };
const nativeOf = (venue) => ({ 'WSOP Europe': 'EUR', 'Irish Poker Open': 'EUR' }[venue] || 'USD');
// The viewer's zone is fixed for the tests: America/New_York in October (UTC-4) / winter (UTC-5).
const nyMinutes = (iso) => {
  const d = new Date(iso);
  const off = d.getUTCMonth() >= 2 && d.getUTCMonth() <= 10 ? 4 : 5;
  return (((d.getUTCHours() - off) + 24) % 24) * 60 + d.getUTCMinutes();
};
const OPTS = { currency: 'USD', config: CONFIG, nativeOf, localMinutes: nyMinutes };

// Facts as the reports route returns them (money in USD, date normalised, the room resolved).
const T = (id, date, o = {}) => ({ id: 't' + id, type: 'tournament', bankroll: 'main', date, label: 'Event', profit: 0, room: 'Seed Casino',
  game: 'NLH', online: false, hour: 12, started_at: null, hours: null, stakes: '', buyin: 200, buyin_usd: 200, bullets: 1, cost: 200, cash: 0, category: '', ...o });
const C = (id, date, o = {}) => ({ id: 'c' + id, type: 'cash', bankroll: 'main', date, label: 'Cash', profit: 0, room: 'Parx', game: 'NLH',
  online: false, hour: null, started_at: `${date}T23:00:00.000Z`, hours: 4, stakes: '2/5', buyin: null, buyin_usd: null, bullets: null, cost: null, cash: null, category: '', ...o });
const X = (id, date, type = 'expense') => ({ id: 'x' + id, type, bankroll: 'main', date, label: 'Hotel', profit: type === 'income' ? 340 : -100, room: '', game: '' });

// Tracking rows (GET /api/tracking) and cash sessions (GET /api/cash-sessions), native money.
const E = (id, o = {}) => ({ id, num_entries: 1, cashed: 0, finish_place: null, cash_amount: 0, notes: null, bankroll_id: null, event_number: '',
  event_name: 'Event', date: '2026-01-01', time: '12:00 PM', buyin: 200, game_variant: 'NLH', venue: 'Seed Casino', is_satellite: 0, total_entries: null, ...o });
const S = (id, o = {}) => ({ id, bankroll_id: 'main', started_at: '2026-09-10T18:00:00.000Z', ended_at: '2026-09-10T22:00:00.000Z', session_date: '2026-09-10',
  room: 'Parx', game: 'NLH', stakes: '2/5', buy_in: 500, rebuys: 0, cash_out: 500, tips: 0, expenses: 0, currency: 'USD', notes: null, tags: [], live: false, ...o });

test('isoDay: ISO and month-named dates; nothing else', () => {
  assert.equal(isoDay('2026-05-30'), '2026-05-30');
  assert.equal(isoDay('2026-05-30T19:00:00Z'), '2026-05-30');
  assert.equal(isoDay('May 28, 2026'), '2026-05-28');
  assert.equal(isoDay('Sept 3 2026'), '2026-09-03');
  assert.equal(isoDay(''), null);
  assert.equal(isoDay('TBD'), null);
});

test('dayLabel: from the parts, so Jan 1 stays Jan 1 in every zone', () => {
  assert.equal(dayLabel('2026-05-30'), 'Sat, May 30, 2026');
  assert.equal(dayLabel('2026-01-01'), 'Thu, Jan 1, 2026');
  assert.equal(dayLabel('2025-12-31'), 'Wed, Dec 31, 2025');
  assert.equal(dayLabel('2026-09-29'), 'Tue, Sep 29, 2026');
});

test('clockMinutes and ordinal', () => {
  assert.equal(clockMinutes('12:00 PM'), 720);
  assert.equal(clockMinutes('12:30 am'), 30);
  assert.equal(clockMinutes('7:30 PM'), 1170);
  assert.equal(clockMinutes('14:05'), 845);
  assert.equal(clockMinutes('TBA'), null);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
});

test('compactMoney: whole units under 10k, compact from 10k, the app minus, + only when signed', () => {
  const $ = CONFIG.USD;
  assert.equal(compactMoney(2410, $), '$2,410');
  assert.equal(compactMoney(9400, $, { signed: true }), '+$9,400');
  assert.equal(compactMoney(-4600, $), `${MINUS}$4,600`);
  assert.equal(compactMoney(9999.6, $), '$10k');
  assert.equal(compactMoney(12850, $, { signed: true }), '+$12.9k');
  assert.equal(compactMoney(-10049, $), `${MINUS}$10k`);
  assert.equal(compactMoney(125400, $), '$125k');
  assert.equal(compactMoney(99949, $), '$99.9k');
  assert.equal(compactMoney(99950, $), '$100k');
  assert.equal(compactMoney(999499, $), '$999k');
  assert.equal(compactMoney(999500, $), '$1M');
  assert.equal(compactMoney(2345678, $), '$2.3M');
  assert.equal(compactMoney(0, $, { signed: true }), '$0');
  assert.equal(compactMoney(520.93, $), '$521');
  assert.equal(compactMoney(-12500, CONFIG.SEK), `${MINUS}12.5k kr`);
});

test('titles: compact buy-in + event name; stakes + game; fallbacks', () => {
  assert.equal(shortBuyin(1500, CONFIG.USD), '$1.5k');
  assert.equal(shortBuyin(400, CONFIG.USD), '$400');
  assert.equal(shortBuyin(10000, CONFIG.USD), '$10k');
  assert.equal(shortBuyin(1100, CONFIG.EUR), '€1.1k');
  assert.equal(shortBuyin(0, CONFIG.USD), '');
  assert.equal(tournamentTitle('Limit Badugi', 1500, CONFIG.USD), '$1.5k Limit Badugi');
  assert.equal(tournamentTitle('NLH Satellite - $10k O8', 1100, CONFIG.USD), '$1.1k NLH Satellite - $10k O8');
  assert.equal(tournamentTitle('$1,500 NLH Monster Stack', 1500, CONFIG.USD), '$1.5k NLH Monster Stack');
  // A leading buy-in goes, but a name that starts with K / k / M / m after it keeps its letter.
  assert.equal(tournamentTitle('$1,500 Mystery Bounty', 1500, CONFIG.USD), '$1.5k Mystery Bounty');
  assert.equal(tournamentTitle('$10,000 Main Event', 10000, CONFIG.USD), '$10k Main Event');
  assert.equal(tournamentTitle('$400 Knockout Turbo', 400, CONFIG.USD), '$400 Knockout Turbo');
  assert.equal(tournamentTitle('€1,100 Monster Stack', 1100, CONFIG.EUR), '€1.1k Monster Stack');
  assert.equal(tournamentTitle('$1,100 - Monster Stack', 1100, CONFIG.USD), '$1.1k Monster Stack');
  assert.equal(tournamentTitle('$250 mini Main', 250, CONFIG.USD), '$250 mini Main');
  assert.equal(tournamentTitle('$1.5k Mixed Games', 1500, CONFIG.USD), '$1.5k Mixed Games');
  assert.equal(tournamentTitle('$10K-Main Event', 10000, CONFIG.USD), '$10k Main Event');
  assert.equal(tournamentTitle('€1.100 Monster Stack', 1100, CONFIG.EUR), '€1.1k Monster Stack');
  // ...only when it IS the buy-in (to the title's rounding) and not a guarantee.
  assert.equal(tournamentTitle('$1,525 Bounty', 1500, CONFIG.USD), '$1.5k Bounty');
  assert.equal(tournamentTitle('$20,000 GTD', 215, CONFIG.USD), '$215 $20,000 GTD');
  assert.equal(tournamentTitle('$10,000 GTD', 215, CONFIG.USD), '$215 $10,000 GTD');
  assert.equal(tournamentTitle('$10k Guaranteed', 10000, CONFIG.USD), '$10k $10k Guaranteed');
  assert.equal(tournamentTitle('$215 $20,000 GTD', 215, CONFIG.USD), '$215 $20,000 GTD');
  assert.equal(tournamentTitle('$1,000 NLH Bounty', 1100, CONFIG.USD), '$1.1k $1,000 NLH Bounty');
  assert.equal(tournamentTitle('$5,000 Freeroll', 0, CONFIG.USD), '$5,000 Freeroll');
  assert.equal(tournamentTitle('$1,500', 1500, CONFIG.USD), '$1.5k Tournament');
  assert.equal(tournamentTitle('NLH Freeroll', 0, CONFIG.USD), 'NLH Freeroll');
  assert.equal(tournamentTitle('', 300, CONFIG.USD), '$300 Tournament');
  assert.equal(cashTitle('2/5', 'NLH', CONFIG.USD), '$2/5 NLH');
  assert.equal(cashTitle('5/5', 'PL 5 Card Omaha/Big O', CONFIG.USD), '$5/5 PL 5 Card Omaha/Big O');
  assert.equal(cashTitle('1/2', 'PLO', CONFIG.EUR), '€1/2 PLO');
  assert.equal(cashTitle('', '', CONFIG.USD), 'Cash game');
  assert.equal(cashTitle('', 'Mixed', CONFIG.USD), 'Mixed');
  assert.equal(finishLabel(12, 845), '12th / 845');
  assert.equal(finishLabel(37, 1210), '37th / 1,210');
  assert.equal(finishLabel(5, null), '5th');
  assert.equal(finishLabel(null, 845), '');
});

// One bankroll's worth, with the critic's edge cases.
const FACTS = [
  T(141, '2026-05-30', { label: 'Limit Badugi', profit: 7900, room: 'Horseshoe Las Vegas', game: 'Badugi', buyin: 1500, cost: 1500, cash: 9400 }),
  T(143, '2026-06-05', { label: 'NLH Satellite - $10k O8', profit: 1310, room: 'Horseshoe Las Vegas', buyin: 1100, cost: 1100, cash: 2410 }),
  T(144, '2025-10-20', { label: 'NLH Monster Stack', profit: 2688.69, room: "King's Resort Rozvadov", buyin: 1232.31, bullets: 2, cost: 2464.63, cash: 5153.32, bankroll: 1 }),
  T(146, '2026-05-28', { label: 'PLO Bounty', profit: 750, game: 'PLO', buyin: 400, cost: 400, cash: 1150 }),
  T(147, '2026-01-01', { label: 'NLH New Year Turbo', profit: 975, hour: 14, buyin: 300, cost: 300, cash: 1275 }),
  T(148, '2025-12-31', { label: 'NLH New Year Eve Deepstack', profit: -500, hour: 19, buyin: 250, bullets: 2, cost: 500 }),
  T(151, '2026-04-11', { label: 'NLH Freeroll', profit: 85, buyin: 0, cost: 0, cash: 85 }),
  T(152, '2026-04-18', { label: 'Bubble Event NLH', profit: -200, buyin: 200, cost: 200, cash: 0 }),
  C(20, '2026-09-10', { label: 'Cash PLO 1/2 · Dublin Poker Club', profit: 520.93, room: 'Dublin Poker Club', game: 'PLO', stakes: '1/2', started_at: '2026-09-10T18:00:00.000Z', hours: 5.5 }),
  C(21, '2026-09-29', { profit: 325, room: 'Borgata', started_at: '2026-09-30T03:30:00.000Z', hours: 4.5 }),
  C(22, '2026-09-05', { profit: 4560, room: 'Live! Casino & Hotel Philadelphia Poker Room and Sportsbook', game: 'PL 5 Card Omaha/Big O', stakes: '5/5', started_at: '2026-09-05T20:00:00.000Z', hours: 6.25 }),
  C(23, '2026-08-01', { label: 'Cash session', profit: -180, room: '', game: '', stakes: '', started_at: '2026-08-01T17:00:00.000Z', hours: 4 }),
  C(24, '2026-07-20', { profit: 0, stakes: '1/3', started_at: '2026-07-20T17:00:00.000Z', hours: 0 }),
  C(25, '2025-12-31', { profit: 1420, started_at: '2026-01-01T04:00:00.000Z', hours: 5.5, bankroll: 1 }),
  X(1, '2026-09-20'), X(2, '2026-09-30', 'income'),
];
const TRACKING = [
  E(141, { event_name: 'Limit Badugi', buyin: 1500, cashed: 1, cash_amount: 9400, finish_place: 12, total_entries: 845, venue: 'WSOP', notes: 'Ran deep, busted 12th.', event_number: '33' }),
  E(143, { event_name: 'NLH Satellite - $10k O8', buyin: 1100, cashed: 1, cash_amount: 2410, venue: 'WSOP', is_satellite: 1 }),
  E(144, { event_name: 'NLH Monster Stack', buyin: 1100, num_entries: 2, cashed: 1, cash_amount: 4600, finish_place: 37, total_entries: 1210, venue: 'WSOP Europe' }),
  E(146, { event_name: 'PLO Bounty', date: 'May 28, 2026', buyin: 400, cashed: 1, cash_amount: 1150, finish_place: 5 }),
  E(147, { event_name: 'NLH New Year Turbo', date: '2026-01-01', time: '2:00 PM', buyin: 300, cashed: 1, cash_amount: 1275, finish_place: 3 }),
  E(148, { event_name: 'NLH New Year Eve Deepstack', date: '2025-12-31', time: '7:00 PM', buyin: 250, num_entries: 2 }),
  E(151, { event_name: 'NLH Freeroll', buyin: 0, cashed: 1, cash_amount: 85, finish_place: 9 }),
  E(152, { event_name: 'Bubble Event NLH', buyin: 200, cashed: 0, cash_amount: 500, finish_place: 41 }),
];
const SESSIONS = [
  S(20, { started_at: '2026-09-10T18:00:00.000Z', ended_at: '2026-09-10T23:30:00.000Z', session_date: '2026-09-10', room: 'Dublin Poker Club', game: 'PLO', stakes: '1/2', buy_in: 400, rebuys: 1, cash_out: 900, tips: 20, expenses: 15, currency: 'EUR', notes: 'EUR session.' }),
  S(21, { started_at: '2026-09-30T03:30:00.000Z', ended_at: '2026-09-30T08:00:00.000Z', session_date: '2026-09-29', room: 'Borgata', buy_in: 1000, cash_out: 1350, tips: 25 }),
  S(22, { started_at: '2026-09-05T20:00:00.000Z', ended_at: '2026-09-06T02:15:00.000Z', session_date: '2026-09-05', room: 'Live! Casino & Hotel Philadelphia Poker Room and Sportsbook', game: 'PL 5 Card Omaha/Big O', stakes: '5/5', buy_in: 2000, cash_out: 6600, tips: 40 }),
  S(23, { started_at: '2026-08-01T17:00:00.000Z', ended_at: '2026-08-01T21:00:00.000Z', session_date: '2026-08-01', room: '', game: '', stakes: '', buy_in: 300, cash_out: 120 }),
  S(24, { started_at: '2026-07-20T17:00:00.000Z', ended_at: '2026-07-20T17:00:00.000Z', session_date: '2026-07-20', stakes: '1/3', buy_in: 300, cash_out: 300 }),
  S(25, { started_at: '2026-01-01T04:00:00.000Z', ended_at: '2026-01-01T09:30:00.000Z', session_date: '2025-12-31', buy_in: 1000, cash_out: 2450, tips: 30, bankroll_id: 1 }),
  S(99, { ended_at: null, cash_out: null, live: true, session_date: '2026-10-11' }),   // live: never a row
];
const rows = buildSessions(FACTS, TRACKING, SESSIONS, OPTS);
const byKey = new Map(rows.map((r) => [r.key, r]));

test('buildSessions: tournaments and finished cash only; expenses, income and the live session left out', () => {
  assert.equal(rows.length, 14);
  assert.equal(rows.filter((r) => r.type === 'tournament').length, 8);
  assert.equal(rows.filter((r) => r.type === 'cash').length, 6);
  assert.ok(!rows.some((r) => r.key.startsWith('x')));
  assert.ok(!byKey.has('c99'));
});

test('buildSessions: newest first on the normalised day, then the start time', () => {
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].date >= rows[i].date, `${rows[i - 1].key} before ${rows[i].key}`);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.key), ['c21', 'c20', 'c22']);
  // "May 28, 2026" sorts as 2026-05-28: after (older than) the Badugi of May 30.
  const keys = rows.map((r) => r.key);
  assert.ok(keys.indexOf('t141') < keys.indexOf('t146'));
  assert.equal(byKey.get('t146').date, '2026-05-28');
  // New Year: the Jan 1 turbo is 2026; the Dec 31 event and the Dec 31 session (UTC start Jan 1) are 2025.
  assert.equal(byKey.get('t147').year, '2026');
  assert.equal(byKey.get('t147').dateLabel, 'Thu, Jan 1, 2026');
  assert.equal(byKey.get('t148').dateLabel, 'Wed, Dec 31, 2025');
  assert.equal(byKey.get('c25').year, '2025');
  assert.equal(byKey.get('c25').dateLabel, 'Wed, Dec 31, 2025');
  // A session begun at 23:30 local on Sep 29 is Sep 29, not its UTC Sep 30.
  assert.equal(byKey.get('c21').dateLabel, 'Tue, Sep 29, 2026');
  // Same day: the later start first (c25 23:00 local on Dec 31 vs the 7 PM tournament).
  assert.ok(keys.indexOf('c25') < keys.indexOf('t148'));
});

test('buildSessions: titles, rooms, results and finishes', () => {
  const r = (k) => byKey.get(k);
  assert.equal(r('t141').title, '$1.5k Limit Badugi');
  assert.equal(r('t141').room, 'Horseshoe Las Vegas');
  assert.equal(r('t141').finish, '12th / 845');
  assert.equal(r('t141').result, 7900);
  assert.equal(r('t143').title, '$1.1k NLH Satellite - $10k O8');
  assert.equal(r('t143').finish, '');                 // cashed, no place recorded
  assert.equal(r('t144').title, '€1.1k NLH Monster Stack');   // the event's own currency
  assert.equal(r('t144').finish, '37th / 1,210');
  assert.equal(r('t144').result, 2688.69);           // the fact's USD result, not 2,400
  assert.equal(r('t146').finish, '5th');
  assert.equal(r('t151').title, 'NLH Freeroll');
  assert.equal(r('t152').finish, '');                 // a bubble: an amount and a place, but no cash
  assert.equal(r('t152').result, -200);
  assert.equal(r('c20').title, '€1/2 PLO');
  assert.equal(r('c20').result, 520.93);
  assert.equal(r('c22').title, '$5/5 PL 5 Card Omaha/Big O');
  assert.equal(r('c23').title, 'Cash game');
  assert.equal(r('c23').room, '');
});

test('buildSessions: a Personal venue (imported, private events) is no room and no series', () => {
  // As POST /api/bankrolls/import writes them: venue 'Personal', the name as typed, no property, so
  // the reports fact's room falls back to 'Personal'.
  const facts = [
    T(155, '2026-03-02', { label: '$1,500 Mystery Bounty', room: 'Personal', game: 'NLH', buyin: 1500, cost: 1500, cash: 6100, profit: 4600 }),
    T(156, '2026-03-01', { label: '$20,000 GTD', room: 'Personal', game: 'NLH', buyin: 215, cost: 215, profit: -215 }),
    T(157, '2026-02-28', { label: '$400 Knockout Turbo', room: 'Personal', game: 'Personal', buyin: 400, cost: 400, profit: -400 }),
    T(141, '2026-05-30', { label: 'Limit Badugi', room: 'Horseshoe Las Vegas', buyin: 1500, cost: 1500, cash: 9400, profit: 7900 }),
  ];
  const tracking = [
    E(155, { event_name: '$1,500 Mystery Bounty', buyin: 1500, cashed: 1, cash_amount: 6100, finish_place: 4, total_entries: 210, venue: 'Personal' }),
    E(156, { event_name: '$20,000 GTD', buyin: 215, venue: 'Personal' }),
    E(157, { event_name: '$400 Knockout Turbo', buyin: 400, venue: 'Personal', game_variant: 'Personal' }),
    E(141, { event_name: 'Limit Badugi', buyin: 1500, cashed: 1, cash_amount: 9400, venue: 'WSOP' }),
  ];
  const got = new Map(buildSessions(facts, tracking, [], OPTS).map((r) => [r.key, r]));
  assert.deepEqual(['t155', 't156', 't157'].map((k) => [got.get(k).title, got.get(k).room, got.get(k).series]), [
    ['$1.5k Mystery Bounty', '', ''],
    ['$215 $20,000 GTD', '', ''],
    ['$400 Knockout Turbo', '', ''],
  ]);
  assert.equal(got.get('t155').finish, '4th / 210');
  assert.equal(tournamentFigures(got.get('t157')).game, '');          // 'Personal' is not a game either
  assert.equal(tournamentFigures(got.get('t155')).game, 'NLH');
  // A real venue that differs from the room is the series; one that is the room is not repeated.
  assert.equal(got.get('t141').series, 'WSOP');
  assert.equal(byKey.get('t146').series, '');                           // venue 'Seed Casino' = room
  // Without the tracking join the fact alone says Personal: still no room.
  const bare = buildSessions(facts, [], [], OPTS);
  assert.deepEqual(bare.filter((r) => r.key !== 't141').map((r) => r.room), ['', '', '']);
  assert.equal(bare.find((r) => r.key === 't141').room, 'Horseshoe Las Vegas');
  // A cash session's room is free text: one typed "Personal" is the player's own word, kept.
  assert.equal(buildSessions([C(30, '2026-03-03', { room: 'Personal' })], [], [], OPTS)[0].room, 'Personal');
});

test('tournamentPlace: an online event shows the site name, a propertyless feed row its curated room', () => {
  // The component's helpers (utils.js and online-sites.js cannot load under node --test).
  const siteName = (k) => ({ wsop_com: 'WSOP.com', ggpoker: 'GGPoker', acr: 'ACR', clubwpt_gold: 'ClubWPT Gold' }[k] || '');
  const roomOf = (v) => ({ '2026-27 WSOPC Atlantic City': "WSOPC Harrah's Atlantic City", '2026 Great Lakes Poker Classic - Summer': 'FireKeepers Casino' }[v] || '');
  const o = { ...OPTS, siteName, roomOf };
  const facts = [
    // Online: the fact's room is the site key (lib/analytics.js normaliseRow); the join's property is the name.
    T(170, '2026-07-04', { label: 'Sunday Million', room: 'wsop_com', online: true, buyin: 215, cost: 215 }),
    T(171, '2026-07-03', { label: 'Sunday Special', room: 'ggpoker', online: true, buyin: 109, cost: 109 }),
    T(172, '2026-07-02', { label: 'Mini', room: 'clubwpt_gold', online: true, buyin: 11, cost: 11 }),
    // A feed row that names no room: the fact fell back to the series title, which is also the venue.
    T(173, '2026-07-01', { label: 'Event #12', room: '2026-27 WSOPC Atlantic City', buyin: 1200, cost: 1200 }),
    T(174, '2026-06-30', { label: 'Event #3', room: '2026 Great Lakes Poker Classic - Summer', buyin: 600, cost: 600 }),
    // The same, but no curated room for the series: the venue stays the room.
    T(175, '2026-06-29', { label: 'Event #1', room: 'Some Uncurated Series', buyin: 300, cost: 300 }),
    // A feed row WITH a room: that room, and the series is the venue.
    T(176, '2026-06-28', { label: 'Event #5', room: 'Horseshoe Las Vegas', buyin: 500, cost: 500 }),
  ];
  const tracking = [
    E(170, { venue: 'WSOP.com Online Series', property: 'WSOP.com' }),
    E(171, { venue: 'GGPoker Series', property: 'GGPoker' }),
    E(172, { venue: 'ClubWPT Gold', property: 'ClubWPT Gold' }),
    E(173, { venue: '2026-27 WSOPC Atlantic City', property: null }),
    E(174, { venue: '2026 Great Lakes Poker Classic - Summer', property: '' }),
    E(175, { venue: 'Some Uncurated Series' }),
    E(176, { venue: 'WSOP Summer 2026', property: 'Horseshoe Las Vegas' }),
  ];
  const got = new Map(buildSessions(facts, tracking, [], o).map((r) => [r.key, [r.room, r.series]]));
  assert.deepEqual([...got], [
    ['t170', ['WSOP.com', 'WSOP.com Online Series']],
    ['t171', ['GGPoker', 'GGPoker Series']],
    ['t172', ['ClubWPT Gold', '']],                                   // venue = room: not repeated
    ['t173', ["WSOPC Harrah's Atlantic City", '2026-27 WSOPC Atlantic City']],
    ['t174', ['FireKeepers Casino', '2026 Great Lakes Poker Classic - Summer']],
    ['t175', ['Some Uncurated Series', '']],
    ['t176', ['Horseshoe Las Vegas', 'WSOP Summer 2026']],
  ]);
  // Without the tracking join an online fact still reads as its site, never the key; a live room is as the fact has it.
  const bare = new Map(buildSessions(facts, [], [], o).map((r) => [r.key, r.room]));
  assert.equal(bare.get('t170'), 'WSOP.com');
  assert.equal(bare.get('t172'), 'ClubWPT Gold');
  assert.equal(bare.get('t176'), 'Horseshoe Las Vegas');
  assert.equal(bare.get('t173'), '2026-27 WSOPC Atlantic City');       // the series is all the fact holds
  // Called bare (no helpers): the fact's room, or the venue.
  assert.deepEqual(tournamentPlace({ room: 'wsop_com' }, { venue: 'V', property: '' }), { room: 'wsop_com', series: 'V', personal: false });
  assert.deepEqual(tournamentPlace({ room: '' }, { venue: 'V' }), { room: 'V', series: '', personal: false });
  // Personal is never given a room by the curated map, even if one is named Personal.
  assert.equal(tournamentPlace({ room: 'Personal' }, { venue: 'Personal' }, { roomOf: () => 'Nowhere' }).room, '');
});

test('filterSessions, groupByYear, countLabel', () => {
  assert.equal(filterSessions(rows, 'all').length, 14);
  assert.equal(filterSessions(rows, 'tournament').length, 8);
  assert.equal(filterSessions(rows, 'cash').length, 6);
  const years = groupByYear(rows);
  assert.deepEqual(years.map((y) => [y.year, y.rows.length]), [['2026', 11], ['2025', 3]]);
  assert.deepEqual(groupByYear(filterSessions(rows, 'cash')).map((y) => y.year), ['2026', '2025']);
  assert.equal(countLabel(176, 'all'), '176 sessions');
  assert.equal(countLabel(152, 'tournament'), '152 tournaments');
  assert.equal(countLabel(1, 'cash'), '1 session');
  assert.equal(countLabel(1234, 'all'), '1,234 sessions');
  assert.equal(CHUNK, 150);
});

test('tournamentFigures: native money, ROI null for a freeroll, no finish without a cash', () => {
  const b = tournamentFigures(byKey.get('t141'));
  assert.deepEqual([b.currency, b.buyin, b.bullets, b.cost, b.cash, b.net, b.place, b.field, b.notes, b.eventNumber],
    ['USD', 1500, 1, 1500, 9400, 7900, 12, 845, 'Ran deep, busted 12th.', '33']);
  assert.ok(Math.abs(b.roi - 7900 / 1500) < 1e-12);
  const m = tournamentFigures(byKey.get('t144'));
  assert.deepEqual([m.currency, m.buyin, m.bullets, m.cost, m.cash, m.net, m.display], ['EUR', 1100, 2, 2200, 4600, 2400, 2688.69]);
  const fr = tournamentFigures(byKey.get('t151'));
  assert.equal(fr.roi, null);
  assert.equal(fr.net, 85);
  const bub = tournamentFigures(byKey.get('t152'));
  assert.deepEqual([bub.cashed, bub.cash, bub.net, bub.place], [false, 0, -200, null]);
  assert.equal(bub.roi, -1);
});

test('cashFigures: hours from start to end, per hour null for no length, the EUR session in EUR', () => {
  const bigO = cashFigures(byKey.get('c22'));
  assert.equal(bigO.hours, 6.25);
  assert.equal(bigO.net, 4560);
  assert.ok(Math.abs(bigO.hourly - 729.6) < 1e-9);
  const eur = cashFigures(byKey.get('c20'));
  assert.deepEqual([eur.currency, eur.hours, eur.buyIn, eur.rebuys, eur.cashOut, eur.tips, eur.expenses, eur.net, eur.display],
    ['EUR', 5.5, 400, 1, 900, 20, 15, 465, 520.93]);
  const zero = cashFigures(byKey.get('c24'));
  assert.equal(zero.hours, 0);
  assert.equal(zero.hourly, null);
  assert.equal(zero.net, 0);
  // Without the cash-sessions join (that request failed): the fact's figures, flagged partial.
  const bare = buildSessions([FACTS[10]], [], [], OPTS)[0];
  const p = cashFigures(bare);
  assert.equal(p.partial, true);
  assert.equal(p.net, 4560);
  assert.equal(p.hours, 6.25);
});

test('buildSessions: rows still build without the tracking and cash joins', () => {
  const bare = buildSessions(FACTS, [], [], OPTS);
  assert.equal(bare.length, 14);
  const b = bare.find((r) => r.key === 't141');
  assert.equal(b.title, '$1.5k Limit Badugi');
  assert.equal(b.finish, '');
  const c = bare.find((r) => r.key === 'c20');
  assert.equal(c.title, '$1/2 PLO');                  // the display currency without the session's own
  assert.equal(bare.find((r) => r.key === 'c21').dateLabel, 'Tue, Sep 29, 2026');
});
