// node --test src/utils/__tests__/home-period.test.mjs   (from vite-app/; or `npm run test:home` from the root)
// The home's NUMBERS: the bankroll line and the period block (utils/home-period.js, verdict
// sections 4 and 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, monthsBack, dayRange, paceWindows, ledgerFrom, currentTrip, currentSeries,
  ledgerStats, resultStats, periodRows, leadSample, fmtPct, plural, scheduleAhead, buildPeriod,
  goalLines, bankrollLine, tripStats, compareSide,
} from '../home-period.js';
import { fmtMoney } from '../home.js';
import { tripPnl } from '../transactions.js';

const TODAY = '2026-10-12';
const money = (v, signed) => fmtMoney(v, null, { signed: !!signed });

test('day arithmetic and the month windows compare like for like', () => {
  assert.equal(addDays('2026-10-12', -12), '2026-09-30');
  assert.equal(daysBetween('2026-09-30', '2026-10-12'), 12);
  assert.equal(monthsBack('2026-03-31', 1), '2026-02-28');
  assert.equal(monthsBack('2026-01-15', 1), '2025-12-15');
  assert.equal(dayRange('2026-09-01', '2026-09-12'), 'Sep 1–12');
  assert.equal(dayRange('2026-09-01', '2026-09-01'), 'Sep 1');
  assert.equal(dayRange('2026-09-28', '2026-10-03'), 'Sep 28 – Oct 3');
  const w = paceWindows(TODAY);
  assert.deepEqual(w.cur, { from: '2026-10-01', to: '2026-10-12' });
  assert.deepEqual(w.prev, { from: '2026-09-01', to: '2026-09-12' });
  assert.deepEqual(w.prevFull, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(w.name, 'October');
  assert.equal(w.prevLabel, 'Sep 1–12');
  // The last day of a long month meets the whole of a short one, never a day past its end.
  const m = paceWindows('2026-03-31');
  assert.deepEqual(m.prev, { from: '2026-02-01', to: '2026-02-28' });
  // January looks back into last year.
  assert.deepEqual(paceWindows('2026-01-09').prevFull, { from: '2025-12-01', to: '2025-12-31' });
});

test('the ledger reaches back far enough for last month, a yearly goal and a trip', () => {
  assert.equal(ledgerFrom(TODAY), '2026-09-01');
  assert.equal(ledgerFrom(TODAY, { goals: [{ period: 'month' }] }), '2026-09-01');
  assert.equal(ledgerFrom(TODAY, { goals: [{ period: 'year' }] }), '2026-01-01');
  assert.equal(ledgerFrom(TODAY, { trip: { start_date: '2026-08-28' } }), '2026-08-28');
  assert.equal(ledgerFrom(TODAY, { trip: { start_date: '2026-10-08' } }), '2026-09-01');
});

test('the current trip is the one covering today', () => {
  const trips = [
    { id: 1, name: 'Fall Open', start_date: '2026-09-20', end_date: '2026-09-28' },
    { id: 2, name: 'Vegas', start_date: '2026-10-08', end_date: '2026-10-16' },
    { id: 3, name: 'Long', start_date: '2026-10-01', end_date: '2026-11-30' },
    { id: 4, name: 'Next', start_date: '2026-10-13', end_date: '2026-10-15' },
  ];
  assert.equal(currentTrip(trips, TODAY).id, 2);            // started last of the two covering today
  assert.equal(currentTrip([trips[0], trips[3]], TODAY), null);
  assert.equal(currentTrip([{ id: 5, start_date: TODAY, end_date: TODAY }], TODAY).id, 5);
  assert.equal(currentTrip(null, TODAY), null);
});

// A series: feed rows of one venue (the series title), numbered, today inside them.
const SER = 'Borgata Fall Poker Open 2026';
const row = (id, date, o = {}) => ({ id, date, venue: SER, property: 'Borgata Hotel Casino & Spa', source_pdf: 'mtt-feed', event_number: String(id), buyin: 300, ...o });
const seriesSchedule = () => [row(1, '2026-10-09'), row(2, '2026-10-10'), row(3, '2026-10-11'), row(4, '2026-10-12'), row(5, '2026-10-14', { planned_entries: 2, buyin: 400 })];

test('a series is detected only with confidence', () => {
  const s = currentSeries(seriesSchedule(), [], TODAY);
  assert.deepEqual(s, { venue: SER, from: '2026-10-09', to: '2026-10-14', events: 5, behind: 3, ahead: 2, ids: [1, 2, 3, 4, 5] });
  // Rows nobody tagged (user-made, or a room's daily) are not a series.
  assert.equal(currentSeries(seriesSchedule().map((e) => ({ ...e, source_pdf: null })), [], TODAY), null);
  // A venue that is only the room's name is not a series title.
  assert.equal(currentSeries(seriesSchedule().map((e) => ({ ...e, property: SER })), [], TODAY), null);
  // Online rows are a site, not a series to count a trip in.
  assert.equal(currentSeries(seriesSchedule().map((e) => ({ ...e, is_online: 1 })), [], TODAY), null);
  // Today on the series' first day: nothing behind yet, so the month stays.
  assert.equal(currentSeries(seriesSchedule().filter((e) => e.date >= TODAY), [], TODAY), null);
  // All of it behind: over, not running.
  assert.equal(currentSeries(seriesSchedule().filter((e) => e.date < TODAY), [], TODAY), null);
  // Too few rows, or mostly unnumbered.
  assert.equal(currentSeries(seriesSchedule().slice(2, 4).concat(row(9, '2026-10-13')).slice(0, 2), [], TODAY), null);
  assert.equal(currentSeries(seriesSchedule().map((e, i) => ({ ...e, event_number: i < 3 ? '' : e.event_number })), [], TODAY), null);
  // Two series at once: ambiguous.
  const other = [10, 11, 12].map((id, i) => row(id, ['2026-10-10', '2026-10-12', '2026-10-13'][i], { venue: 'Wynn Fall Classic', property: 'Wynn' }));
  assert.equal(currentSeries([...seriesSchedule(), ...other], [], TODAY), null);
  // The week mostly elsewhere (results not on the schedule count as activity): not the unit.
  const elsewhere = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ tournament_id: 100 + i, venue: 'Seed Casino', date: '2026-10-1' + (i % 2) }));
  assert.equal(currentSeries(seriesSchedule(), elsewhere, TODAY), null);
  // Restarts and Personal rows are not counted; a logged event counts as behind.
  const s2 = currentSeries([...seriesSchedule(), row(6, '2026-10-13', { is_restart: 1 }), { id: 7, date: '2026-10-11', venue: 'Personal' }],
    [{ tournament_id: 4, venue: SER, date: TODAY }], TODAY);
  assert.equal(s2.events, 5);
  assert.equal(s2.behind, 4);
  assert.equal(s2.ahead, 1);
  // A span beyond 45 days is a season, not a series; rows further out than that are not looked at.
  assert.equal(currentSeries([row(1, '2026-08-30'), row(2, '2026-09-30'), row(3, '2026-10-12'), row(4, '2026-10-20')], [], TODAY), null);
  assert.equal(currentSeries([row(1, '2025-10-10'), row(2, '2026-10-11'), row(3, '2026-10-12'), row(4, '2026-10-20')], [], TODAY).from, '2026-10-11');
});

test('what a series still holds: planned entries, converted; logged, busted and restarts left out', () => {
  const sch = [...seriesSchedule(), row(6, '2026-10-15', { is_restart: 1 }), row(7, '2026-10-16', { not_played: 1 })];
  const ahead = scheduleAhead(sch, [], [], SER, TODAY);
  assert.deepEqual(ahead, { count: 2, upTo: 300 + 800 });
  // Today's event busted (latest update a bust): it waits in To log, not here.
  assert.deepEqual(scheduleAhead(sch, [], [{ id: 9, tournament_id: 4, is_busted: 1 }], SER, TODAY), { count: 1, upTo: 800 });
  // Logged already.
  assert.deepEqual(scheduleAhead(sch, [{ tournament_id: 5 }], [], SER, TODAY), { count: 1, upTo: 300 });
  // A euro buy-in with no rates: the count stands, the amount is a dash.
  const eur = { currencyOf: (e) => (e.id === 5 ? 'EUR' : 'USD'), currency: 'USD', rates: null };
  assert.deepEqual(scheduleAhead(sch, [], [], SER, TODAY, eur), { count: 2, upTo: null });
  assert.deepEqual(scheduleAhead(sch, [], [], SER, TODAY, { ...eur, rates: { EUR: 0.8 } }), { count: 2, upTo: 300 + 1000 });
  assert.equal(scheduleAhead(sch, [], [], 'Nowhere', TODAY), null);
});

test('what a series still holds leaves out a plan that resolved off, as Up Next and To log do', () => {
  // #5 ($400 x 2) is "If seat #2" and #2 missed: off. A pending plan still counts (it may be played).
  const plans = new Map([[5, { state: 'off' }], [4, { state: 'pending' }]]);
  assert.deepEqual(scheduleAhead(seriesSchedule(), [], [], SER, TODAY, { plans }), { count: 1, upTo: 300 });
  assert.deepEqual(scheduleAhead(seriesSchedule(), [], [], SER, TODAY, { plans: new Map([[5, { state: 'on' }]]) }), { count: 2, upTo: 300 + 800 });
  // buildPeriod reads the same plans: the series row says 1 event, up to $300.
  const money = (v) => `$${Math.round(v)}`;
  const p = buildPeriod({ today: TODAY, isAdmin: false, money, results: [], schedule: seriesSchedule(), updates: [], plans });
  assert.equal(p.mode, 'series');
  assert.deepEqual(p.ahead, { count: 1, upTo: 300 });
  // Everything still ahead is off: the series has nothing left to play, so it is not running.
  const allOff = new Map([[4, { state: 'off' }], [5, { state: 'off' }]]);
  assert.equal(currentSeries(seriesSchedule(), [], TODAY, { plans: allOff }), null);
});

// Ledger entries as GET /api/bankrolls/ledger returns them (display currency USD).
const L = (date, source, amount, extra = {}) => ({ date, source, kind: { tournaments: 'tournament', 'cash-sessions': 'cash_session', transactions: amount < 0 ? 'expense' : 'income', adjustments: 'deposit' }[source], amount_display: amount, fx_display: 1, ...extra });
const ledger = [
  L('2026-09-03', 'tournaments', -300, { units: 1, cost: 300, cash: 0 }),
  L('2026-09-10', 'tournaments', 900, { units: 1, cost: 300, cash: 1200 }),
  L('2026-09-25', 'cash-sessions', -400, { hours: 5 }),
  L('2026-10-02', 'tournaments', -1200, { units: 2, cost: 1200, cash: 0 }),
  L('2026-10-05', 'tournaments', 1000, { units: 1, cost: 400, cash: 1400 }),
  L('2026-10-06', 'cash-sessions', 250, { hours: 4 }),
  L('2026-10-07', 'cash-sessions', -90, {}),                       // no end time
  L('2026-10-08', 'transactions', -400),
  L('2026-10-09', 'adjustments', 5000),                            // a deposit: money moved, not won
];

test('ledger stats: results only, the Overview arithmetic', () => {
  const s = ledgerStats(ledger, paceWindows(TODAY).cur);
  assert.equal(s.net, -1200 + 1000 + 250 - 90 - 400);
  assert.equal(s.count, 5);
  assert.equal(s.mtt.events, 2);
  assert.equal(s.mtt.bullets, 3);
  assert.equal(s.mtt.cashes, 1);
  assert.equal(Math.round(s.mtt.roi * 100), Math.round(-200 / 1600 * 100));
  assert.equal(s.cash.sessions, 2);
  assert.equal(s.cash.hours, 4);
  assert.equal(s.cash.hourly, 250 / 4);                           // only the timed session
  assert.deepEqual(s.other, { net: -400, count: 1 });
  assert.equal(ledgerStats(ledger, paceWindows(TODAY).prev).net, 600);
  assert.equal(ledgerStats(ledger, { from: '2026-11-01', to: '2026-11-30' }).count, 0);
});

test('result stats: the ledger formula on each row, converted; mixed currency without rates is a dash', () => {
  const rows = [
    { date: '2026-10-02', buyin: 400, num_entries: 2, cashed: 0, cash_amount: 500, venue: 'A' }, // stray cash ignored
    { date: 'Oct 5, 2026', buyin: 300, num_entries: 1, cashed: 1, cash_amount: 1000, venue: 'A' },
    { date: '2026-09-30', buyin: 999, num_entries: 1, cashed: 0, venue: 'A' },                  // last month
  ];
  const s = resultStats(rows, paceWindows(TODAY).cur);
  assert.equal(s.net, 1000 - 800 - 300);
  assert.equal(s.mtt.bullets, 3);
  assert.equal(s.mtt.cashes, 1);
  assert.equal(Math.round(s.mtt.roi * 1000), Math.round((-100 / 1100) * 1000));
  const mixed = resultStats([...rows, { date: '2026-10-06', buyin: 500, venue: 'EU', cashed: 0 }], paceWindows(TODAY).cur,
    { currency: 'USD', rates: null, currencyOf: (r) => (r.venue === 'EU' ? 'EUR' : 'USD') });
  assert.equal(mixed.net, null);
  assert.equal(mixed.unconverted, 1);
});

test('rows show only what happened; a rate carries its sample; empty figures are dashes with reasons', () => {
  const s = ledgerStats(ledger, paceWindows(TODAY).cur);
  const rows = periodRows(s, money);
  // The verdict's three groups: the tournaments' net (beside other sources), ROI with the ITM fact
  // folded into its sample, cash as one row with its rate, then expenses and income.
  assert.deepEqual(rows.map((r) => r.key), ['mtt', 'roi', 'cash', 'other']);
  assert.deepEqual(rows.find((r) => r.key === 'roi'), { key: 'roi', label: 'ROI', sample: '3 bullets · cashed 1 of 2', value: '−13%' });
  assert.deepEqual(rows.find((r) => r.key === 'mtt'), { key: 'mtt', label: 'Tournaments', sample: '', value: '−$200' });
  assert.deepEqual(rows.find((r) => r.key === 'cash'), { key: 'cash', label: 'Cash games', sample: '2 sessions · 4 h', value: '+$160 · $63/h' });
  assert.equal(rows.find((r) => r.key === 'other').sample, '1 entry');
  // Tournaments only (a non-admin): no Tournaments row (it would be the lead's net again), no cash
  // or expense rows at all, not zeros.
  const t = periodRows(resultStats([{ date: '2026-10-02', buyin: 0, cashed: 0 }], paceWindows(TODAY).cur), money);
  assert.deepEqual(t.map((r) => r.key), ['roi']);
  // A freeroll has no spend to divide by: ROI is a dash whose reason is on screen, never 0%.
  assert.equal(t[0].value, '—');
  assert.equal(t[0].sample, 'no buy-ins · cashed 0 of 1');
  assert.equal(t[0].muted, true);
  // Cash with no end times: no rate, and the sample says why.
  const c = periodRows(ledgerStats([L('2026-10-07', 'cash-sessions', -90, {})], paceWindows(TODAY).cur), money);
  assert.deepEqual(c.map((r) => [r.key, r.sample, r.value]), [['cash', '1 session · no end times', '−$90']]);
  // Figures that cannot be added up yet: a dash, and the visible reason.
  const w = periodRows({ unconverted: 1, mtt: { events: 2, bullets: 2, cashes: 1, profit: null, roi: null }, cash: { sessions: 1, hours: 2, profit: null, hourly: null }, other: { count: 0 } }, money);
  assert.deepEqual(w.map((r) => [r.key, r.value, r.sample]), [
    ['mtt', '—', 'waiting for exchange rates'], ['roi', '—', 'waiting for exchange rates · cashed 1 of 2'], ['cash', '—', '1 session · waiting for exchange rates']]);
  assert.equal(periodRows(ledgerStats([], paceWindows(TODAY).cur), money).length, 0);
  assert.equal(leadSample(ledgerStats(ledger, paceWindows(TODAY).cur)), '2 events · 2 sessions · 4 h');
  assert.equal(fmtPct(0.004), '0%');
  assert.equal(fmtPct(0.125), '+13%');
  assert.equal(plural(1, 'entry', 'entries'), '1 entry');
});

test('the period block: month for admins from the ledger, with the like-for-like line', () => {
  const p = buildPeriod({ today: TODAY, isAdmin: true, currency: 'USD', money, ledger, results: [], schedule: [] });
  assert.equal(p.mode, 'month');
  assert.equal(p.title, 'October');
  assert.equal(p.scope, 'All bankrolls · USD');
  assert.equal(p.net, -440);
  assert.equal(p.sample, '2 events · 2 sessions · 4 h');
  assert.deepEqual(p.side.map((x) => x.text), ['Sep 1–12 +$600', 'all Sep +$200']);
  // While the ledger loads there is nothing to show yet (not zeros).
  assert.equal(buildPeriod({ today: TODAY, isAdmin: true, money, ledger: null }), null);
  // An empty month: a dash with the reason in the sample line.
  const e = buildPeriod({ today: '2026-11-03', isAdmin: true, currency: 'USD', money, ledger, results: [], schedule: [] });
  assert.equal(e.net, null);
  assert.equal(e.sample, 'Nothing logged in November yet');
  assert.deepEqual(e.side.map((x) => x.text), ['Oct 1–3 −$1,200', 'all Oct −$440']);
  assert.equal(e.rows.length, 0);
  // Nothing last month either: one line that says so, never bare dashes.
  const none = buildPeriod({ today: '2027-03-03', isAdmin: true, currency: 'USD', money, ledger });
  assert.deepEqual(none.side, [{ text: 'Feb: nothing logged', title: 'Nothing logged in February' }, { text: '' }]);
  // The same days empty, the rest of last month not: that side says why in words.
  const pw = paceWindows(TODAY);
  const side = compareSide(pw, { count: 0, net: 0 }, { count: 2, net: -300 }, (v) => money(v, true));
  assert.deepEqual(side.map((x) => x.text), ['Sep 1–12: nothing logged', 'all Sep −$300']);
  assert.deepEqual(compareSide(pw, { count: 1, net: null }, { count: 2, net: null }, (v) => money(v, true)).map((x) => x.text),
    ['Sep 1–12: waiting for rates', 'all Sep: waiting for rates']);
});

test('the period block: non-admins get their tournaments, never the ledger', () => {
  const results = [
    { tournament_id: 1, date: '2026-10-02', buyin: 200, num_entries: 1, cashed: 1, cash_amount: 700, venue: 'Seed Casino' },
    { tournament_id: 2, date: '2026-09-05', buyin: 100, num_entries: 1, cashed: 0, venue: 'Seed Casino' },
  ];
  const p = buildPeriod({ today: TODAY, isAdmin: false, currency: 'USD', money, ledger: null, results, schedule: [] });
  assert.equal(p.mode, 'month');
  assert.equal(p.scope, 'Tournaments · USD');
  assert.equal(p.net, 500);
  assert.equal(p.sample, '1 event');
  // The lead is the tournaments' net, so there is no Tournaments row repeating it.
  assert.deepEqual(p.rows.map((r) => r.key), ['roi']);
  assert.equal(p.rows[0].sample, '1 bullet · cashed 1 of 1');
  assert.deepEqual(p.side.map((x) => x.text), ['Sep 1–12 −$100', 'all Sep −$100']);
});

test('the period block: a series, with what is still on the schedule', () => {
  const results = [{ tournament_id: 2, date: '2026-10-10', buyin: 300, num_entries: 2, cashed: 0, venue: SER },
    { tournament_id: 3, date: '2026-10-11', buyin: 300, num_entries: 1, cashed: 1, cash_amount: 1500, venue: SER },
    { tournament_id: 99, date: '2026-10-11', buyin: 50, num_entries: 1, cashed: 0, venue: 'Online' }];
  for (const isAdmin of [false, true]) {
    const p = buildPeriod({ today: TODAY, isAdmin, currency: 'USD', money, ledger: [], results, schedule: seriesSchedule() });
    assert.equal(p.mode, 'series');
    assert.equal(p.title, SER);
    assert.equal(p.scope, 'Tournaments · USD');
    assert.equal(p.net, 1500 - 900);                                 // the series' own results only
    assert.deepEqual(p.side.map((x) => x.text), ['Oct 9–14', 'day 4 of 6']);
    const ahead = p.rows.find((r) => r.key === 'ahead');
    assert.deepEqual(ahead, { key: 'ahead', label: 'Still on your schedule', sample: '2 events', value: 'up to $1,100' });
  }
  // A result belongs to the series by its event even when its venue reads differently.
  const byId = buildPeriod({ today: TODAY, isAdmin: false, currency: 'USD', money, results: [{ ...results[1], venue: 'Borgata' }], schedule: seriesSchedule() });
  assert.equal(byId.net, 1200);
});

test('the period block: a trip covering today wins (admins), net after its expenses', () => {
  const trip = { id: 3, name: 'Vegas', start_date: '2026-10-05', end_date: '2026-10-16', bankroll: 'all' };
  // GET /api/bankrolls/trips/:id: the results and the ended cash sessions dated inside it, and the
  // expenses and income tagged to it, each in its own currency.
  const tripData = {
    trip,
    results: [
      { venue: 'Vegas', buyin: 400, num_entries: 1, cashed: 1, cash_amount: 1400 },
      { venue: 'Dublin', buyin: 100, num_entries: 2, cashed: 0, cash_amount: 0 },   // EUR: 200 EUR = 400 USD
    ],
    cash_sessions: [{ amount: 250, currency: 'USD', hours: 4 }, { amount: -90, currency: 'USD', hours: null }],
    transactions: [
      { kind: 'expense', category: 'lodging', amount: 400, currency: 'USD' },
      { kind: 'expense', category: 'food', amount: 100, currency: 'EUR' },          // 200 USD
    ],
  };
  const rates = { EUR: 0.5 };
  const currencyOf = (r) => (r.venue === 'Dublin' ? 'EUR' : 'USD');
  const p = buildPeriod({ today: TODAY, isAdmin: true, currency: 'USD', money, ledger, results: [], schedule: seriesSchedule(), trip, tripData, rates, currencyOf });
  assert.equal(p.mode, 'trip');
  assert.equal(p.title, 'Vegas');
  // Tournaments +1000 - 400, cash +250 - 90, the tagged spend -400 and -200.
  assert.equal(p.net, 1000 - 400 + 250 - 90 - 400 - 200);
  // ONE definition: the trip page's 'Trip net' (tripPnl over the same payload, the same rates).
  const page = tripPnl(tripData, { currency: 'USD', nativeCurrency: (v) => currencyOf({ venue: v }), convert: (v, f, t) => (f === t ? v : (f === 'USD' ? v : v / rates[f]) * (t === 'USD' ? 1 : rates[t])) });
  assert.equal(p.net, page.net);
  assert.equal(p.sample, '2 events · 2 sessions · 4 h');
  assert.deepEqual(p.side.map((x) => x.text), ['Net after expenses', 'Oct 5–16 · day 8 of 12']);
  assert.deepEqual(p.rows.map((r) => r.key), ['mtt', 'roi', 'cash', 'other']);
  assert.deepEqual(p.rows.find((r) => r.key === 'other'), { key: 'other', label: 'Expenses & income', sample: '2 entries', value: '−$600' });
  assert.equal(p.rows.find((r) => r.key === 'mtt').value, '+$600');
  assert.equal(p.rows.find((r) => r.key === 'cash').value, '+$160 · $63/h');
  assert.deepEqual(p.window, { from: '2026-10-05', to: '2026-10-16', venue: null, scope: 'all' });
  // An amount that cannot be converted: the net is a dash with its reason, not a part-total.
  const q = buildPeriod({ today: TODAY, isAdmin: true, currency: 'USD', money, trip, tripData, rates: null, currencyOf });
  assert.equal(q.net, null);
  assert.equal(q.sample, 'Waiting for exchange rates');
  // While the trip's payload loads there is nothing to show yet.
  assert.equal(buildPeriod({ today: TODAY, isAdmin: true, currency: 'USD', money, trip, tripData: null }), null);
  // Nothing inside it yet.
  const e = buildPeriod({ today: TODAY, isAdmin: true, currency: 'USD', money, trip, tripData: { results: [], cash_sessions: [], transactions: [] } });
  assert.equal(e.net, null);
  assert.equal(e.sample, 'Nothing logged on this trip yet');
  // A trip scoped to one bankroll is named in the scope (the server scoped its payload).
  const scoped = buildPeriod({ today: TODAY, isAdmin: true, currency: 'USD', money, trip: { ...trip, bankroll: 'main' }, tripScopeName: 'Main',
    tripData: { results: [], cash_sessions: [{ amount: 250, currency: 'USD', hours: 4 }], transactions: [] } });
  assert.equal(scoped.scope, 'Main · USD');
  assert.equal(scoped.net, 250);
  assert.equal(scoped.window.scope, 'main');
  // Non-admins never get a trip.
  assert.equal(buildPeriod({ today: TODAY, isAdmin: false, currency: 'USD', money, trip, results: [], schedule: [] }).mode, 'month');
  // tripStats alone: the shape the noise line reads.
  const st = tripStats(tripData, { currency: 'USD', rates, currencyOf });
  assert.equal(st.mtt.events, 2);
  assert.equal(st.mtt.bullets, 3);
  assert.equal(st.mtt.cashes, 1);
  assert.equal(st.cash.sessions, 2);
  assert.equal(st.cash.hours, 4);
  assert.equal(st.count, 6);
});

test('goals: a volume goal is coloured by pace, a profit goal stays muted', () => {
  const goals = [{ id: 'v', period: 'month', metric: 'volume', target: 10 }, { id: 'p', period: 'month', metric: 'profit', target: 5000 }];
  const [v, p] = goalLines(goals, ledger, TODAY, (x) => fmtMoney(x));
  // Volume: tournament bullets (3) + cash sessions (2) = 5 of 10, with 12 of 31 days gone: ahead.
  assert.equal(v.value, '5 of 10 played');
  assert.equal(v.fill, 0.5);
  assert.equal(v.tone, 'ahead');
  assert.equal(v.note, 'ahead of pace');
  assert.ok(Math.abs(v.tick - 12 / 31) < 1e-9);
  assert.equal(p.tone, 'muted');
  assert.equal(p.note, 'pace is mostly variance');
  assert.equal(p.value, '−$440 of $5,000');
  assert.equal(p.fill, 0);                                          // below zero: an empty bar
  const behind = goalLines([{ id: 'b', period: 'month', metric: 'volume', target: 40 }], ledger, TODAY, fmtMoney)[0];
  assert.equal(behind.tone, 'behind');
  assert.deepEqual(goalLines(null, ledger, TODAY, fmtMoney), []);
  // Nothing logged this month: a profit goal is a dash with its reason, never '$0'; volume says 0.
  const [v0, p0] = goalLines(goals, ledger.filter((e) => e.date < '2026-10-01'), TODAY, (x) => fmtMoney(x));
  assert.equal(v0.value, '0 of 10 played');
  assert.equal(p0.value, 'nothing yet of $5,000');
  assert.equal(p0.muted, true);
  assert.equal(p0.title, 'Nothing logged this month yet');
});

test('the bankroll line: balance, the cap a bullet and the signal; no signal under the minimum', () => {
  const sum = (mtt, balance = 44216.4) => ({ currency: 'USD', all: { balance }, guide: { byKey: { all: { mtt } } } });
  const m = (v) => fmtMoney(v);
  const hold = bankrollLine(sum({ buyins: 100, cap: 442.16, signal: 'hold', reason: 'within', recentN: 20, recentAvg: 330 }), m);
  assert.equal(hold.balance, 44216.4);
  assert.deepEqual(hold.cap, { value: '$442' });
  assert.equal(hold.rule, '1%');
  assert.equal(hold.signal.label, 'Hold');
  assert.equal(hold.signal.title, 'Your last 20 entries averaged $330, inside the cap');
  const up = bankrollLine(sum({ buyins: 50, cap: 2100, signal: 'up', recentN: 20, recentAvg: 900, nextTier: { label: '$2,000–4,999', min: 2000 } }, 105000), m);
  assert.equal(up.signal.label, 'Move up to $2,000+');
  assert.equal(up.rule, '2%');
  const down = bankrollLine(sum({ buyins: 100, cap: 0, signal: 'down', reason: 'empty', recentN: 9, recentAvg: 200 }, -50), m);
  assert.deepEqual(down.cap, { value: '—', note: 'no balance', title: 'No balance to size a bullet from' });
  assert.equal(down.signal.title, 'The roll is at or below zero');
  const few = bankrollLine(sum({ buyins: 100, cap: 442, signal: null, reason: 'few', recentN: 3 }), m);
  assert.equal(few.signal, null);
  assert.equal(bankrollLine(null, m), null);
  assert.equal(bankrollLine({ all: {} }, m), null);
});
