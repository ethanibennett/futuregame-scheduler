// Phase 3 of the bankroll merge: the staking settlement (docs/bankroll-merge.md §10).
//
//   node test/staking-settlement.test.js        (npm run test:staking-settlement)
//
// Two parts.
//
//   A  THE CALCULATOR, pure (lib/staking/settlement.js computeEntry). Every expected figure is
//      worked by hand in the comment beside it, from the formulas in the spec's §10, for every
//      backer_type the code supports, and for each rule that is a switch. Nothing here is the
//      code's own output pasted back.
//
//   B  THE REAL SERVER over HTTP, booted on a scratch port (4570-4579, never 3001) against a
//      scratch database in a temp dir (never poker-tournaments.db or a copy), with the production
//      secrets scrubbed and ./solver stubbed: the sheet, preview, settle (recomputed, one row per
//      agreement, client figures ignored, 409 on a re-settle), a re-read with no drift, the paid
//      toggle writing exactly one ledger row, makeup carried across two series, an unplayed
//      event's refund, currency_rate, a budget cap, swap and crossbook, the bankroll a series
//      posts to, a cross-currency payment, reopening, and the migration on rows the old code
//      wrote.
//
// Every name and figure is invented.
'use strict';
const assert = require('assert');
const fs = require('fs');
const S = require('../lib/staking/settlement');
const { createScratch, boot, sqlJs, rowsOf, one, runner } = require('./helpers/scratch-server');

const PORTS = [4570, 4579];
const PW = 'settlement-test-password-1';

// ── Part A fixtures ──────────────────────────────────────────────────────────────────────
let nextId = 1;
const ag = (o = {}) => ({ id: 1, backer_id: 10, backer_name: 'Sam Example', backer_type: 'pay_per_play', percentage: 10, markup: 1, is_active: 1, ...o });
const ev = (o = {}) => {
  const id = nextId++;
  return { id, agreement_id: 1, tournament_id: id, bullets_used: 1, buyin_amount: null, t_buyin: 1000, cash_amount: 0, tip_amount: 0,
    currency_rate: 1, status: 'busted', date: '2026-06-01', time: '12:00 PM', event_name: 'Event ' + id, ...o };
};
const calc = (a, evs, input = {}, rules = S.DEFAULT_RULES, overrides = new Map()) => S.computeEntry(ag(a), evs, overrides, input, rules);
const withRules = (o) => { const r = S.resolveRules(o); assert.deepStrictEqual(r.errors, []); return r.rules; };
/** Asserts a subset of an entry's fields, each to the cent. */
function figures(e, want, label = '') {
  for (const [k, v] of Object.entries(want)) {
    if (typeof v === 'number') assert.ok(Math.abs(e[k] - v) < 0.005, `${label}${k}: got ${e[k]}, want ${v}`);
    else assert.deepStrictEqual(e[k], v, `${label}${k}`);
  }
}

(async () => {
  const { test, done } = runner('staking-settlement.test.js');

  // ══ A. The calculator ═════════════════════════════════════════════════════════════════
  console.log('A. the calculator, by hand');

  await test('the headline: 10% of $1,000 at 1.2 with no cash. Prepaid (the normal case) owes nothing; netted, the BACKER pays the player $120, not $100', () => {
    // price = 1000 x 1 bullet x 0.10 x 1.2 = 120; markup inside it = 1000 x 0.10 x 0.2 = 20.
    // Prepaid 120 (default): owed = 0 - (120 - 120) = 0. The backer's loss of 120 was settled up front.
    const pre = calc({ markup: 1.2 }, [ev()]);
    figures(pre, { grossInvestment: 120, markupAmount: 20, grossReturn: 0, prepaidDefault: 120, prepaid: 120, owed: 0, amountOwed: 0, direction: 'none', netPnl: -120 });
    // Netted (prepaid 0): owed = 0 - (120 - 0) = -120: the backer pays the player 120. The old
    // formula (return - investment + markup) said -100, handing the markup back.
    const net = calc({ markup: 1.2 }, [ev()], { prepaid: 0 });
    figures(net, { owed: -120, amountOwed: -120, direction: 'to_player', unpaid: 120, refund: 0 });
    assert.notStrictEqual(net.amountOwed, -100);
  });

  await test('markup with cash: 10% of $1,000 at 1.2, cash $5,000, tip $100', () => {
    // price 120 (markup 20); return = (5000 - 100) x 0.10 = 490.
    // prepaid 120 -> owed = 490 - 0 = 490 to the backer; the backer nets 490 - 120 = 370.
    figures(calc({ markup: 1.2 }, [ev({ cash_amount: 5000, tip_amount: 100, status: 'cashed' })]),
      { grossInvestment: 120, markupAmount: 20, grossReturn: 490, owed: 490, amountOwed: 490, direction: 'to_backer', netPnl: 370 });
    // netted: 490 - 120 = 370 (the old code said 390: + markup).
    figures(calc({ markup: 1.2 }, [ev({ cash_amount: 5000, tip_amount: 100, status: 'cashed' })], { prepaid: 0 }), { amountOwed: 370 });
  });

  await test('an unplayed event refunds what was prepaid for it (pay_per_play 10% at 1.1)', () => {
    // played  $1,500: price 1500 x .10 x 1.1 = 165, no cash.
    // cancelled $2,500: price 2500 x .10 x 1.1 = 275, prepaid but not played.
    // prepaid default = 165 + 275 = 440; owed = 0 - (165 - 440) = +275: the 275 goes back.
    const e = calc({ markup: 1.1 }, [ev({ t_buyin: 1500 }), ev({ t_buyin: 2500, status: 'cancelled' })]);
    figures(e, { grossInvestment: 165, unplayed: 275, prepaidDefault: 440, refund: 275, owed: 275, amountOwed: 275, direction: 'to_backer', netPnl: -165 });
    // The owner says the backer only paid for the first: prepaid 165 -> owed 0.
    figures(calc({ markup: 1.1 }, [ev({ t_buyin: 1500 }), ev({ t_buyin: 2500, status: 'cancelled' })], { prepaid: 165 }), { amountOwed: 0, refund: 0 });
  });

  await test('currency_rate and bullets: 25% at 1.0 of a EUR 1,100 event fired twice, rate 1.08, cash EUR 4,000', () => {
    // buy-in = 1100 x 2 x 1.08 = 2376.00; cash = 4000 x 1.08 = 4320.00.
    // price = 2376 x .25 = 594; return = 4320 x .25 = 1080; prepaid 594 -> owed 1080.
    const e = calc({ percentage: 25 }, [ev({ buyin_amount: 1100, bullets_used: 2, currency_rate: 1.08, cash_amount: 4000, status: 'cashed' })]);
    figures(e, { grossInvestment: 594, grossReturn: 1080, prepaid: 594, amountOwed: 1080 });
    figures(e.events[0], { buyin: 2376, cash: 4320, rate: 1.08, bullets: 2 }, 'event ');
  });

  await test('open_commitment: 15% at 1.0, $500 fired twice, cash $2,000', () => {
    // price = 500 x 2 x .15 = 150; return = 2000 x .15 = 300; prepaid 150 -> owed 300.
    figures(calc({ backer_type: 'open_commitment', percentage: 15 }, [ev({ t_buyin: 500, bullets_used: 2, cash_amount: 2000 })]),
      { grossInvestment: 150, grossReturn: 300, amountOwed: 300 });
  });

  await test('tiered_markup: 1.1 up to $1,500, 1.25 above; an event-level markup override beats the tier', () => {
    const tiers = JSON.stringify([{ minBuyin: 0, maxBuyin: 1500, markup: 1.1 }, { minBuyin: 1501, maxBuyin: 100000, markup: 1.25 }]);
    const evs = () => [ev({ t_buyin: 1000, tournament_id: 501 }), ev({ t_buyin: 10000, cash_amount: 30000, tournament_id: 502 })];
    // $1,000 -> 1.1: price 110 (markup 10). $10,000 -> 1.25: price 1250 (markup 250), return 3000.
    // investment 1360, markup 260, prepaid 1360 -> owed 3000.
    figures(calc({ backer_type: 'tiered_markup', tiered_rules: tiers, markup: 1 }, evs()),
      { grossInvestment: 1360, markupAmount: 260, grossReturn: 3000, amountOwed: 3000 });
    // override markup 1.0 on the $10,000: price 1000 -> investment 1110, markup 10.
    const ov = new Map([[502, { tournament_id: 502, override_markup: 1.0, override_percentage: null, opt_out: 0 }]]);
    figures(calc({ backer_type: 'tiered_markup', tiered_rules: tiers, markup: 1 }, evs(), {}, S.DEFAULT_RULES, ov),
      { grossInvestment: 1110, markupAmount: 10 });
  });

  await test('flat_package: 20% at 1.15, one $1,500 played, one $1,500 not; rule flatPackageUnplayed refund (default) or keep', () => {
    const evs = () => [ev({ t_buyin: 1500 }), ev({ t_buyin: 1500, status: 'cancelled' })];
    // price each = 1500 x .20 x 1.15 = 345. refund: investment 345, unplayed 345, prepaid 690 -> owed +345.
    figures(calc({ backer_type: 'flat_package', percentage: 20, markup: 1.15 }, evs()),
      { grossInvestment: 345, unplayed: 345, prepaid: 690, amountOwed: 345 });
    // keep: the unplayed one is charged like a bust: investment 690, prepaid 690 -> owed 0.
    figures(calc({ backer_type: 'flat_package', percentage: 20, markup: 1.15 }, evs(), {}, withRules({ flatPackageUnplayed: 'keep' })),
      { grossInvestment: 690, unplayed: 0, prepaid: 690, amountOwed: 0 });
  });

  await test('budget_capped: 10% at 1.0, cap $1,000; events in DATE order, the crossing one pro-rated, the rest unbacked', () => {
    // Given out of order on purpose.
    const evs = () => [
      ev({ date: '2026-06-03', t_buyin: 5000, cash_amount: 20000, tournament_id: 603 }), // 3rd: price 500 > 200 left -> f = .4: price 200, share 20000 x .1 x .4 = 800
      ev({ date: '2026-06-01', t_buyin: 5000, tournament_id: 601 }),                      // 1st: price 500, no cash; 500 left
      ev({ date: '2026-06-04', t_buyin: 2000, cash_amount: 6000, tournament_id: 604 }),  // 4th: budget spent -> nothing
      ev({ date: '2026-06-02', t_buyin: 3000, cash_amount: 9000, tournament_id: 602 }),  // 2nd: price 300, share 900; 200 left
    ];
    // investment 500 + 300 + 200 = 1000; return 900 + 800 = 1700; prepaid = the cap, 1000 -> owed 1700.
    const e = calc({ backer_type: 'budget_capped', budget_cap: 1000 }, evs());
    figures(e, { grossInvestment: 1000, grossReturn: 1700, prepaidDefault: 1000, amountOwed: 1700, budgetLeft: 0, budgetCap: 1000 });
    assert.deepStrictEqual(e.events.map((d) => d.tournamentId), [601, 602, 603, 604]);
    figures(e.events[2], { pct: 4, price: 200, share: 800 }, '3rd ');
    figures(e.events[3], { pct: 0, price: 0, share: 0 }, '4th ');
    // rule budgetCrossing exclude: the 3rd does not fit (500 > 200) and is skipped; the 4th (200) fits:
    // investment 500 + 300 + 200 = 1000; return 900 + 600 = 1500.
    figures(calc({ backer_type: 'budget_capped', budget_cap: 1000 }, evs(), {}, withRules({ budgetCrossing: 'exclude' })),
      { grossInvestment: 1000, grossReturn: 1500, amountOwed: 1500 });
    // Only the first two: investment 800, return 900, prepaid the cap 1000 -> owed 900 + 200 unused = 1100.
    figures(calc({ backer_type: 'budget_capped', budget_cap: 1000 }, evs().filter((x) => x.tournament_id <= 602)),
      { grossInvestment: 800, refund: 200, amountOwed: 1100, budgetLeft: 200 });
  });

  await test('budget order inside one day is by start time (10:00 PM after 9:00 AM, which text order gets wrong)', () => {
    // cap 300, 10%: 9:00 AM $2,000 bust (price 200), then 10:00 PM $2,000 cash $10,000: 100 left of
    // a 200 price -> f = .5: price 100, share 10000 x .1 x .5 = 500. investment 300, owed 500.
    const e = calc({ backer_type: 'budget_capped', budget_cap: 300 }, [
      ev({ time: '10:00 PM', t_buyin: 2000, cash_amount: 10000 }), ev({ time: '9:00 AM', t_buyin: 2000 })]);
    figures(e, { grossInvestment: 300, grossReturn: 500, amountOwed: 500 });
    assert.deepStrictEqual(S.minutesOf('12:00 AM'), 0);
    assert.deepStrictEqual(S.minutesOf('12:30 PM'), 750);
    assert.deepStrictEqual(S.minutesOf('19:05'), 1145);
  });

  await test('makeup: a netted loss carries (closing), a later profit repays it first, a prepaid loss carries nothing', () => {
    // 20% at 1.0, opening 0, $5,000 bust, netted (prepaid 0): owed = 0 - 1000 = -1000;
    // total = -1000 + 0 -> amount max(0, -1000) = 0, closing min(0, -1000) = -1000.
    figures(calc({ backer_type: 'makeup', percentage: 20, makeup_opening: 0 }, [ev({ t_buyin: 5000 })], { prepaid: 0 }),
      { owed: -1000, makeupOpening: 0, computedOwed: 0, makeupClosing: -1000, amountOwed: 0 });
    // Next series, opening -1000, $5,000 cash $12,000, prepaid 1000 (default): owed = 2400;
    // total = 2400 - 1000 = 1400 -> amount 1400, closing 0.
    figures(calc({ backer_type: 'makeup', percentage: 20, makeup_opening: -1000 }, [ev({ t_buyin: 5000, cash_amount: 12000 })]),
      { grossInvestment: 1000, grossReturn: 2400, owed: 2400, computedOwed: 1400, makeupClosing: 0, amountOwed: 1400 });
    // Partial: opening -300, 10% of $1,000 cash $2,000 prepaid: owed 200; total -100 -> pay 0, carry -100.
    figures(calc({ backer_type: 'makeup', makeup_opening: -300 }, [ev({ cash_amount: 2000 })]),
      { owed: 200, amountOwed: 0, makeupClosing: -100 });
    // Fully prepaid losing series: owed 0, nothing carries.
    figures(calc({ backer_type: 'makeup', percentage: 20, makeup_opening: 0 }, [ev({ t_buyin: 5000 })]),
      { owed: 0, amountOwed: 0, makeupClosing: 0 });
    // Rule prepaid.makeup 'none' (a running account, nothing paid up front): the same bust carries -1000.
    figures(calc({ backer_type: 'makeup', percentage: 20, makeup_opening: 0 }, [ev({ t_buyin: 5000 })], {}, withRules({ prepaid: { makeup: 'none' } })),
      { prepaidDefault: 0, makeupClosing: -1000, amountOwed: 0 });
  });

  await test('profit_share_only: 10% of the series’ net, never negative; rule profitShareBasis event = the old per-event way', () => {
    // A: $1,000 bust (net -1000). B: $1,000, cash 2500, tip 100 (net 1400). Series net 400 -> 40.
    const evs = () => [ev(), ev({ cash_amount: 2500, tip_amount: 100 })];
    figures(calc({ backer_type: 'profit_share_only' }, evs()), { grossInvestment: 0, prepaidDefault: 0, grossReturn: 40, amountOwed: 40 });
    // per event: max(0, -100) + max(0, 140) = 140.
    figures(calc({ backer_type: 'profit_share_only' }, evs(), {}, withRules({ profitShareBasis: 'event' })), { grossReturn: 140, amountOwed: 140 });
    // A losing series pays nothing (and never asks the backer for anything).
    figures(calc({ backer_type: 'profit_share_only' }, [ev()]), { grossReturn: 0, amountOwed: 0, direction: 'none' });
  });

  await test('swap: 5% each way of winnings (cashes net of tips); the other player’s cashes are an input', () => {
    // Mine: $1,500 cash 10,000 tip 200 (9,800) + $3,000 bust = 9,800. Theirs: 4,000.
    // 5% x 9800 = 490 to them, 5% x 4000 = 200 to me: owed 290 (the player pays).
    const evs = () => [ev({ t_buyin: 1500, cash_amount: 10000, tip_amount: 200 }), ev({ t_buyin: 3000 })];
    const a = { backer_type: 'swap', percentage: 0, swap_my_pct: 5, swap_their_pct: 5 };
    figures(calc(a, evs(), { partner: 4000 }), { myResult: 9800, partnerResult: 4000, mineToThem: 490, theirsToMe: 200, amountOwed: 290, direction: 'to_backer', prepaidDefault: 0 });
    // Without their figure the entry says so (settle refuses it; preview shows it).
    assert.deepStrictEqual(calc(a, evs()).needs, ['partnerResult']);
    // rule swapBasis net: mine 9800 - 4500 = 5300 -> 265; theirs -1000 -> -50; owed 315.
    figures(calc(a, evs(), { partner: -1000 }, withRules({ swapBasis: 'net' })), { myResult: 5300, mineToThem: 265, theirsToMe: -50, amountOwed: 315 });
  });

  await test('crossbook: a bet on who does better (net results); the worse result pays its pct of the difference', () => {
    // Mine: $1,000 cash 6,000 (net 5,000) + $1,000 bust (-1,000) = 4,000.
    const evs = () => [ev({ cash_amount: 6000 }), ev()];
    const a = { backer_type: 'crossbook', percentage: 0, crossbook_my_pct: 10, crossbook_their_pct: 10 };
    // Theirs -500: D = 4000 - (-500) = 4500 > 0 -> they pay me 10% x 4500 = 450: owed -450.
    figures(calc(a, evs(), { partner: -500 }), { myResult: 4000, difference: 4500, amountOwed: -450, direction: 'to_player' });
    // Theirs 6,000: D = -2000 -> I pay 10% x 2000 = 200.
    figures(calc(a, evs(), { partner: 6000 }), { difference: -2000, amountOwed: 200, direction: 'to_backer' });
    // Asymmetric, theirs 20%: they pay 20% x 4500 = 900.
    figures(calc({ ...a, crossbook_their_pct: 20 }, evs(), { partner: -500 }), { amountOwed: -900 });
    // rule crossbookBasis cash: mine 6000, theirs 2000 -> D 4000 -> -400.
    figures(calc(a, evs(), { partner: 2000 }, withRules({ crossbookBasis: 'cash' })), { myResult: 6000, amountOwed: -400 });
    // rule crossbookMode swap: the old reading. 10% x 4000 - 10% x (-500) = 450, the OPPOSITE way.
    figures(calc(a, evs(), { partner: -500 }, withRules({ crossbookMode: 'swap' })), { amountOwed: 450, direction: 'to_backer' });
  });

  await test('an adjustment is added last, with its note; an opt-out is out of the deal; an override % applies', () => {
    figures(calc({ markup: 1.2 }, [ev({ cash_amount: 5000, tip_amount: 100 })], { adjustment: -40, adjustmentNote: 'rounded down' }),
      { computedOwed: 490, adjustment: -40, adjustmentNote: 'rounded down', amountOwed: 450 });
    // Two $1,000 events: one opted out (not in the price, not in prepaid), one at an override 5%.
    const ov = new Map([[901, { opt_out: 1 }], [902, { opt_out: 0, override_percentage: 5, override_markup: null }]]);
    // 902: price 1000 x .05 = 50, cash 3000 x .05 = 150 -> owed 150.
    figures(calc({}, [ev({ tournament_id: 901, cash_amount: 99999 }), ev({ tournament_id: 902, cash_amount: 3000 })], {}, S.DEFAULT_RULES, ov),
      { grossInvestment: 50, prepaid: 50, grossReturn: 150, amountOwed: 150 });
  });

  await test('events still pending, bought in or playing count as played and are reported', () => {
    const e = calc({}, [ev({ status: 'pending' }), ev({ status: 'playing' }), ev({ status: 'busted' }), ev({ status: 'cancelled' })]);
    assert.strictEqual(e.unfinishedEvents, 2);
    figures(e, { grossInvestment: 300, unplayed: 100 });
  });

  await test('rules: an override is merged and checked; a bad key or value is reported and dropped', () => {
    const r = S.resolveRules('{"crossbookMode":"swap","prepaid":{"open_commitment":"none","swap":"price"},"nope":1,"swapBasis":"gross"}');
    assert.strictEqual(r.rules.crossbookMode, 'swap');
    assert.strictEqual(r.rules.prepaid.open_commitment, 'none');
    assert.strictEqual(r.rules.prepaid.pay_per_play, 'price');
    assert.strictEqual(r.rules.swapBasis, 'cash');
    assert.strictEqual(r.custom, true);
    assert.strictEqual(r.errors.length, 3, r.errors.join('; '));
    assert.strictEqual(S.resolveRules(null).custom, false);
    assert.match(S.resolveRules('{oops').errors[0], /not JSON/);
  });

  await test('rounding: cents half away from zero, never -0; the ledger in whole units', () => {
    assert.strictEqual(S.r2(1.005), 1.01);
    assert.strictEqual(S.r2(-1.005), -1.01);
    assert.ok(Object.is(S.r2(-0.001), 0));
    assert.strictEqual(S.r2(0.1 * 3 * 1.2), 0.36);
    assert.strictEqual(S.wholeUnits(133.33), 133);
    assert.strictEqual(S.wholeUnits(2.5), 3);
    assert.strictEqual(S.wholeUnits(-2.5), -3);
    assert.ok(Object.is(S.wholeUnits(-0.4), 0));
    // 33.33% of $1,000 at 1.1: 366.63 to the cent, and owed adds up from the rounded parts.
    const e = calc({ percentage: 33.33, markup: 1.1 }, [ev({ cash_amount: 2000 })], { prepaid: 0 });
    figures(e, { grossInvestment: 366.63, grossReturn: 666.6, amountOwed: 299.97 });
  });

  // ══ B. The real server ════════════════════════════════════════════════════════════════
  console.log('B. the real server');
  const scratch = await createScratch({ ports: PORTS, prefix: 'fg-staking-settle-' });
  let srv = null;
  try {
    await test('the first boot ran the migration and logged counts', () => {
      assert.match(scratch.bootLog, /Migration "staking-settlement-2026-10" applied/);
      assert.match(scratch.bootLog, /Staking settlement: 0 settlement row\(s\) from before/);
    });

    // Accounts: an admin (ham5), another admin (claude), an ordinary user.
    srv = await boot(scratch.dbPath, {}, { ports: PORTS });
    for (const [u, e] of [['adminx', 'adminx@x.test'], ['otheradmin', 'otheradmin@x.test'], ['plainuser', 'plainuser@x.test']]) {
      const r = await fetch(`http://127.0.0.1:${srv.port}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, email: e, password: PW, realName: u }) });
      assert.strictEqual(r.status, 201, `register ${u}`);
    }
    await srv.stop();

    // Tournaments (shared rows, as the feed would have them) and the admin names.
    const db = scratch.open();
    db.run("UPDATE users SET username = 'ham5' WHERE username = 'adminx'");
    db.run("UPDATE users SET username = 'claude' WHERE username = 'otheradmin'");
    const T = {};
    const addT = (key, date, time, buyin) => {
      db.run("INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, notes) VALUES ('', ?, ?, ?, ?, 'NLH', 'Test Casino', '')", ['Settle ' + key, date, time, buyin]);
      T[key] = one(db, 'SELECT last_insert_rowid()');
    };
    addT('t1', '2026-06-01', '12:00 PM', 1000);
    addT('t2', '2026-06-02', '12:00 PM', 1000);
    addT('t3', '2026-06-03', '12:00 PM', 5000);
    addT('t4', '2026-07-01', '12:00 PM', 5000);
    addT('eur', '2026-06-05', '12:00 PM', 1100);
    addT('t7', '2026-06-06', '12:00 PM', 1500);
    addT('e5', '2026-06-07', '12:00 PM', 2000);
    addT('s8', '2026-06-08', '12:00 PM', 1500);
    addT('s9', '2026-06-09', '12:00 PM', 3000);
    addT('d1', '2026-06-10', '11:00 AM', 5000);
    addT('d2', '2026-06-11', '11:00 AM', 3000);
    addT('d3', '2026-06-12', '11:00 AM', 5000);
    addT('d4', '2026-06-13', '11:00 AM', 2000);
    scratch.save(db);
    db.close();

    srv = await boot(scratch.dbPath, {}, { ports: PORTS });
    const base = `http://127.0.0.1:${srv.port}`;
    const api = (method, p, { token, body } = {}) => fetch(base + p, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* */ } return { status: r.status, json, text }; });
    const login = async (email) => (await api('POST', '/api/login', { body: { email, password: PW } })).json.token;
    const ham = await login('adminx@x.test');
    const other = await login('otheradmin@x.test');
    const plain = await login('plainuser@x.test');
    const ok = (r, status = 200) => { assert.strictEqual(r.status, status, `HTTP ${r.status}: ${r.text.slice(0, 300)}`); return r.json; };
    const post = async (p, body, status = 201) => ok(await api('POST', p, { token: ham, body }), status);
    const readDb = async () => { const Q = await sqlJs(); return new Q.Database(fs.readFileSync(scratch.dbPath)); };
    const backer = async (name) => (await post('/api/staking/backers', { name })).id;
    const series = async (name, extra = {}) => (await post('/api/staking/series', { name, startDate: '2026-06-01', endDate: '2026-07-31', ...extra })).id;
    const agreement = async (seriesId, body) => post(`/api/staking/series/${seriesId}/agreements`, body);
    const log = async (agreementId, tId, body) => ok(await api('POST', `/api/staking/events/${agreementId}/${tId}/status`, { token: ham, body }));
    const sheet = async (seriesId, token = ham) => api('GET', `/api/staking/series/${seriesId}/settlement`, { token });
    const byAgreement = (sh, id) => sh.settlements.find((e) => e.agreementId === id);

    // ── S1: markup, two agreements for one backer ──
    const sam = await backer('Sam Example');
    const lee = await backer('Lee Example');
    const s1 = await series('Test Series One');
    const a1 = (await agreement(s1, { backerId: sam, backerType: 'pay_per_play', percentage: 10, markup: 1.2 })).id;
    const a2 = (await agreement(s1, { backerId: lee, backerType: 'pay_per_play', percentage: 10, markup: 1.0 })).id;
    const a3 = (await agreement(s1, { backerId: lee, backerType: 'profit_share_only', percentage: 5 })).id;
    await log(a1, T.t1, { bulletsUsed: 1, buyinAmount: 1000, status: 'busted' });
    await log(a2, T.t2, { bulletsUsed: 1, buyinAmount: 1000, cashAmount: 3000, status: 'cashed' });
    await log(a3, T.t2, { bulletsUsed: 1, buyinAmount: 1000, cashAmount: 3000, status: 'cashed' });

    await test('who may read a sheet: no login 401, a plain user 403, another admin 404 (not theirs)', async () => {
      assert.strictEqual((await sheet(s1, null)).status, 401);
      assert.strictEqual((await sheet(s1, plain)).status, 403);
      assert.strictEqual((await sheet(s1, other)).status, 404);
    });

    await test('the unsettled sheet: isSettled false, no ids, one entry per agreement, figures by hand', async () => {
      const sh = ok(await sheet(s1));
      assert.strictEqual(sh.isSettled, false);
      assert.strictEqual(sh.status, 'pre');
      assert.strictEqual(sh.settlements.length, 3);
      for (const e of sh.settlements) { assert.strictEqual(e.id, null); assert.strictEqual(e.isPaid, false); }
      // Sam 10% @1.2 of a $1,000 bust, prepaid 120: 0. Lee pay-per-play 10% of $1,000 cash 3,000: 300.
      // Lee profit share 5% of (3000 - 1000): 100.
      figures(byAgreement(sh, a1), { grossInvestment: 120, markupAmount: 20, prepaid: 120, amountOwed: 0 }, 'Sam ');
      figures(byAgreement(sh, a2), { grossInvestment: 100, grossReturn: 300, amountOwed: 300 }, 'Lee ppp ');
      figures(byAgreement(sh, a3), { grossInvestment: 0, grossReturn: 100, amountOwed: 100 }, 'Lee ps ');
      figures(sh.totals, { toBackers: 400, toPlayer: 0, net: 400 }, 'totals ');
      assert.deepStrictEqual(sh.bankroll, { id: null, name: 'Main', currency: 'USD', missing: false });
    });

    await test('preview recomputes with the inputs and writes nothing; a bad input is a 400', async () => {
      const r = ok(await api('POST', `/api/staking/series/${s1}/settlement/preview`, { token: ham, body: { prepaid: [{ agreementId: a1, amount: 0 }] } }));
      figures(byAgreement(r, a1), { prepaid: 0, amountOwed: -120, direction: 'to_player' });
      const d = await readDb();
      assert.strictEqual(one(d, 'SELECT COUNT(*) FROM backer_settlements'), 0);
      d.close();
      assert.strictEqual((await api('POST', `/api/staking/series/${s1}/settlement/preview`, { token: ham, body: { prepaid: [{ agreementId: a1, amount: -5 }] } })).status, 400);
      assert.strictEqual((await api('POST', `/api/staking/series/${s1}/settlement/preview`, { token: ham, body: { prepaid: [{ agreementId: 999999, amount: 5 }] } })).status, 400);
      assert.strictEqual((await api('POST', `/api/staking/series/${s1}/settlement/preview`, { token: ham, body: { partner: [{ agreementId: a1, amount: 5 }] } })).status, 400);
      assert.strictEqual((await api('POST', `/api/staking/series/${s1}/settlement/preview`, { token: ham, body: { adjustments: [{ agreementId: a1, amount: 'x' }] } })).status, 400);
    });

    await test('a series cannot be marked settled by a status flip', async () => {
      assert.strictEqual((await api('PUT', `/api/staking/series/${s1}`, { token: ham, body: { status: 'settled' } })).status, 400);
    });

    let settled1;
    await test('settle recomputes on the server: the old client’s figures are ignored; one row per agreement (two for Lee)', async () => {
      const r = await api('POST', `/api/staking/series/${s1}/settle`, { token: ham, body: {
        // The old client's body: a figure per backer. None of it may land.
        settlements: [{ backerId: sam, amountOwed: 99999, grossReturn: 99999, netPnl: 99999 }, { backerId: lee, amountOwed: 12345 }],
        prepaid: [{ agreementId: a1, amount: 0 }],
        adjustments: [{ agreementId: a2, amount: -0.5, note: 'rounding' }],
      } });
      settled1 = ok(r);
      assert.strictEqual(settled1.isSettled, true);
      const d = await readDb();
      const rows = rowsOf(d, 'SELECT * FROM backer_settlements WHERE series_id = ? ORDER BY agreement_id', [s1]);
      const status = one(d, 'SELECT status FROM staking_series WHERE id = ?', [s1]);
      d.close();
      assert.strictEqual(status, 'settled');
      assert.strictEqual(rows.length, 3);
      assert.deepStrictEqual(rows.map((x) => x.agreement_id), [a1, a2, a3].sort((x, y) => x - y));
      const row = (id) => rows.find((x) => x.agreement_id === id);
      // Sam netted: -120, the backer pays the player.
      figures({ a: row(a1).amount_owed, c: row(a1).computed_owed, p: row(a1).prepaid, g: row(a1).gross_investment, m: row(a1).markup_amount }, { a: -120, c: -120, p: 0, g: 120, m: 20 });
      // Lee, two rows: 300 - 0.50 and 100.
      figures({ a: row(a2).amount_owed, c: row(a2).computed_owed, adj: row(a2).adjustment }, { a: 299.5, c: 300, adj: -0.5 });
      assert.strictEqual(row(a2).adjustment_note, 'rounding');
      figures({ a: row(a3).amount_owed }, { a: 100 });
      for (const x of rows) { assert.ok(x.settled_at); assert.ok(x.snapshot); assert.strictEqual(x.is_paid, 0); }
    });

    await test('the settled sheet carries ids and paid flags, and equals what settle returned', async () => {
      const sh = ok(await sheet(s1));
      assert.strictEqual(sh.isSettled, true);
      assert.strictEqual(sh.status, 'settled');
      for (const e of sh.settlements) { assert.ok(Number.isInteger(e.id) && e.id > 0); assert.strictEqual(e.isPaid, false); assert.ok(e.settledAt); }
      assert.deepStrictEqual(sh.settlements, settled1.settlements);
      figures(byAgreement(sh, a1), { amountOwed: -120, direction: 'to_player', prepaid: 0 });
      figures(byAgreement(sh, a2), { amountOwed: 299.5 });
    });

    await test('re-reading a settled series never drifts: an event and the agreement edited afterwards change nothing', async () => {
      const before = ok(await sheet(s1));
      await log(a1, T.t1, { cashAmount: 50000, status: 'cashed' });
      ok(await api('PUT', `/api/staking/agreements/${a1}`, { token: ham, body: { markup: 1.5, percentage: 20 } }));
      const after1 = ok(await sheet(s1));
      const after2 = ok(await sheet(s1));
      assert.deepStrictEqual(after1.settlements, before.settlements);
      assert.deepStrictEqual(after2.settlements, before.settlements);
    });

    await test('settling a settled series again is a 409, and writes nothing', async () => {
      assert.strictEqual((await api('POST', `/api/staking/series/${s1}/settle`, { token: ham, body: {} })).status, 409);
      const d = await readDb();
      assert.strictEqual(one(d, 'SELECT COUNT(*) FROM backer_settlements WHERE series_id = ?', [s1]), 3);
      d.close();
      assert.strictEqual((await api('POST', `/api/staking/series/${s1}/settlement/preview`, { token: ham, body: {} })).status, 409);
    });

    await test('the legacy per-agreement backer link reads its OWN agreement’s row (two agreements, two rows)', async () => {
      const t2 = ok(await api('POST', `/api/staking/agreements/${a2}/token`, { token: ham }));
      const t3 = ok(await api('POST', `/api/staking/agreements/${a3}/token`, { token: ham }));
      const p2 = ok(await api('GET', `/api/backer/${t2.token}`));
      const p3 = ok(await api('GET', `/api/backer/${t3.token}`));
      figures({ a: p2.settlement.amount_owed, b: p3.settlement.amount_owed }, { a: 299.5, b: 100 });
    });

    // ── the paid toggle ──
    const ledgerRows = async (ref) => { const d = await readDb(); const r = rowsOf(d, 'SELECT * FROM bankroll_adjustments WHERE settlement_ref = ?', [ref]); d.close(); return r; };
    const idOf = async (seriesId, agreementId) => byAgreement(ok(await sheet(seriesId)), agreementId).id;
    const paid = (id, body) => api('PUT', `/api/staking/settlements/${id}/paid`, { token: ham, body });

    await test('paid writes exactly ONE settlement row into the ledger, and paying again writes none', async () => {
      const id = await idOf(s1, a1); // -120: the backer pays the player, so +120 into Main
      const r = ok(await paid(id, { isPaid: true, date: '2026-07-02' }));
      assert.strictEqual(r.settlement.isPaid, true);
      assert.ok(r.settlement.paidAt);
      let rows = await ledgerRows('bs:' + id);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].kind, 'settlement');
      assert.strictEqual(rows[0].amount, 120);
      assert.strictEqual(rows[0].bankroll_id, null);
      assert.strictEqual(rows[0].occurred_on, '2026-07-02');
      assert.match(rows[0].note, /^Test Series One: received from Sam Example$/);
      ok(await paid(id, { isPaid: true }));
      ok(await paid(id, { isPaid: true }));
      rows = await ledgerRows('bs:' + id);
      assert.strictEqual(rows.length, 1, 'still one');
      figures(r.settlement.ledger, { amount: 120 });
      // The sheet shows it.
      const e = byAgreement(ok(await sheet(s1)), a1);
      assert.strictEqual(e.isPaid, true);
      assert.strictEqual(e.ledger.amount, 120);
    });

    await test('paying a backer is money OUT (-), in whole units with the exact figure in the note', async () => {
      const id = await idOf(s1, a2); // 299.50 to Lee
      ok(await paid(id, { isPaid: true }));
      const rows = await ledgerRows('bs:' + id);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].amount, -300); // 299.50 rounds half away from zero
      assert.match(rows[0].note, /paid to Lee Example \(exact USD 299\.50\)/);
      // The ledger route lists it, as money moved (lib/bankroll-ledger.js MOVE_KINDS).
      const list = ok(await api('GET', '/api/bankrolls/adjustments?bankroll=main', { token: ham }));
      assert.ok(list.adjustments.some((a) => a.kind === 'settlement' && a.amount === -300));
    });

    await test('unpaid removes that row; paid again writes one again', async () => {
      const id = await idOf(s1, a1);
      const r = ok(await paid(id, { isPaid: false }));
      assert.strictEqual(r.settlement.isPaid, false);
      assert.strictEqual(r.settlement.ledger, null);
      assert.strictEqual((await ledgerRows('bs:' + id)).length, 0);
      ok(await paid(id, { isPaid: false }));
      assert.strictEqual((await ledgerRows('bs:' + id)).length, 0);
      ok(await paid(id, { isPaid: true }));
      assert.strictEqual((await ledgerRows('bs:' + id)).length, 1);
    });

    await test('another admin cannot mark my settlement paid (404); a same-currency amount is refused (400)', async () => {
      const id = await idOf(s1, a3);
      assert.strictEqual((await api('PUT', `/api/staking/settlements/${id}/paid`, { token: other, body: { isPaid: true } })).status, 404);
      assert.strictEqual((await paid(id, { isPaid: true, amount: 100 })).status, 400);
      assert.strictEqual((await paid(id, { isPaid: true, date: '14/10/2026' })).status, 400);
      assert.strictEqual((await ledgerRows('bs:' + id)).length, 0);
    });

    await test('reopening is refused while a payment is marked; once unpaid it drops the stored rows', async () => {
      assert.strictEqual((await api('PUT', `/api/staking/series/${s1}`, { token: ham, body: { status: 'active' } })).status, 409);
      for (const a of [a1, a2]) ok(await paid(await idOf(s1, a), { isPaid: false }));
      ok(await api('PUT', `/api/staking/series/${s1}`, { token: ham, body: { status: 'active' } }));
      const sh = ok(await sheet(s1));
      assert.strictEqual(sh.isSettled, false);
      for (const e of sh.settlements) assert.strictEqual(e.id, null);
      const d = await readDb();
      assert.strictEqual(one(d, 'SELECT COUNT(*) FROM backer_settlements WHERE series_id = ?', [s1]), 0);
      assert.strictEqual(one(d, "SELECT COUNT(*) FROM bankroll_adjustments WHERE kind = 'settlement'"), 0);
      d.close();
    });

    // ── makeup across two series ──
    const max = await backer('Max Example');
    let m1a, m2a;
    await test('makeup carried across two settles: the closing of one is the opening of the next, and neither is counted twice', async () => {
      const m1 = await series('Makeup One');
      m1a = (await agreement(m1, { backerId: max, backerType: 'makeup', percentage: 20, markup: 1.0, makeupOpening: 0 })).id;
      await log(m1a, T.t3, { bulletsUsed: 1, buyinAmount: 5000, status: 'busted' });
      // Netted (the backer did not pay up front): owed -1000 -> pay 0, carry -1000.
      const s = ok(await api('POST', `/api/staking/series/${m1}/settle`, { token: ham, body: { prepaid: [{ agreementId: m1a, amount: 0 }] } }));
      figures(byAgreement(s, m1a), { amountOwed: 0, makeupOpening: 0, makeupClosing: -1000 });

      const m2 = await series('Makeup Two');
      const created = await agreement(m2, { backerId: max, backerType: 'makeup', percentage: 20, markup: 1.0 });
      m2a = created.id;
      assert.strictEqual(created.makeupOpening, -1000, 'the new agreement opens with the last closing');
      await log(m2a, T.t4, { bulletsUsed: 1, buyinAmount: 5000, cashAmount: 12000, status: 'cashed' });
      // Prepaid 1000 (default): owed 2400; total 2400 - 1000 = 1400; closing 0.
      figures(byAgreement(ok(await sheet(m2)), m2a), { makeupOpening: -1000, owed: 2400, amountOwed: 1400, makeupClosing: 0 });
      ok(await api('POST', `/api/staking/series/${m2}/settle`, { token: ham, body: {} }));
      // Re-read both: nothing moved.
      figures(byAgreement(ok(await sheet(m1)), m1a), { amountOwed: 0, makeupClosing: -1000 }, 'M1 again ');
      figures(byAgreement(ok(await sheet(m2)), m2a), { amountOwed: 1400, makeupOpening: -1000, makeupClosing: 0 }, 'M2 again ');
      figures(byAgreement(ok(await sheet(m2)), m2a), { amountOwed: 1400 }, 'M2 a third time ');
      // Settle never wrote the agreements (makeup_balance is left as created, unread).
      const d = await readDb();
      assert.strictEqual(one(d, 'SELECT makeup_balance FROM backer_agreements WHERE id = ?', [m1a]), 0);
      assert.strictEqual(one(d, 'SELECT makeup_opening FROM backer_agreements WHERE id = ?', [m1a]), 0);
      d.close();
    });

    // ── S2: its own bankroll, currency_rate, an unplayed event ──
    await test('a series filed under a bankroll posts its payment there; currency_rate; an unplayed event is refunded', async () => {
      const br = ok(await api('POST', '/api/bankrolls', { token: ham, body: { name: 'Staked', currency: 'USD' } }), 201).bankroll.id;
      assert.strictEqual((await api('POST', '/api/staking/series', { token: ham, body: { name: 'x', bankrollId: 99999 } })).status, 404);
      const s2 = await series('Series Two');
      ok(await api('PUT', `/api/staking/series/${s2}`, { token: ham, body: { bankrollId: br } }));
      const kim = await backer('Kim Example');
      const a = (await agreement(s2, { backerId: kim, backerType: 'pay_per_play', percentage: 25, markup: 1.0 })).id;
      // EUR 1,100 x 2 at 1.08 = 2376 -> price 594; cash EUR 4,000 x 1.08 = 4320 -> 1080.
      await log(a, T.eur, { bulletsUsed: 2, buyinAmount: 1100, cashAmount: 4000, currencyRate: 1.08, status: 'cashed' });
      // $1,500 cancelled: 1500 x .25 = 375 prepaid, refunded.
      await log(a, T.t7, { bulletsUsed: 1, buyinAmount: 1500, status: 'cancelled' });
      const sh = ok(await sheet(s2));
      assert.deepStrictEqual(sh.bankroll, { id: br, name: 'Staked', currency: 'USD', archived: false, missing: false });
      // prepaid 594 + 375 = 969; owed = 1080 - (594 - 969) = 1455.
      figures(byAgreement(sh, a), { grossInvestment: 594, grossReturn: 1080, unplayed: 375, prepaid: 969, refund: 375, amountOwed: 1455 });
      ok(await api('POST', `/api/staking/series/${s2}/settle`, { token: ham, body: {} }));
      const id = await idOf(s2, a);
      ok(await paid(id, { isPaid: true }));
      const rows = await ledgerRows('bs:' + id);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].bankroll_id, br);
      assert.strictEqual(rows[0].amount, -1455);
    });

    await test('a EUR series paid out of a USD bankroll needs the amount that moved (409 without it)', async () => {
      const s3 = await series('Euro Series', { currency: 'EUR' });
      const pat = await backer('Pat Example');
      const a = (await agreement(s3, { backerId: pat, backerType: 'pay_per_play', percentage: 10, markup: 1.0 })).id;
      await log(a, T.e5, { bulletsUsed: 1, buyinAmount: 2000, cashAmount: 6000, status: 'cashed' });
      const s = ok(await api('POST', `/api/staking/series/${s3}/settle`, { token: ham, body: {} }));
      figures(byAgreement(s, a), { amountOwed: 600 });
      assert.strictEqual(s.currency, 'EUR');
      const id = byAgreement(s, a).id;
      const r = await paid(id, { isPaid: true });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.json.needsAmount, true);
      assert.strictEqual(r.json.currency, 'USD');
      assert.strictEqual((await ledgerRows('bs:' + id)).length, 0);
      ok(await paid(id, { isPaid: true, amount: 650 }));
      const rows = await ledgerRows('bs:' + id);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].amount, -650);
      assert.match(rows[0].note, /paid to Pat Example \(EUR 600\.00\)/);
      assert.strictEqual((await api('PUT', `/api/staking/series/${s3}`, { token: ham, body: { currency: 'USD' } })).status, 409);
    });

    await test('swap and crossbook through the server: the other player’s result is required, prepaid is refused', async () => {
      const s4 = await series('Swap Series');
      const pat2 = await backer('Swap Partner');
      const kim2 = await backer('Crossbook Partner');
      const sw = (await agreement(s4, { backerId: pat2, backerType: 'swap', swapMyPct: 5, swapTheirPct: 5 })).id;
      const cb = (await agreement(s4, { backerId: kim2, backerType: 'crossbook', crossbookMyPct: 10, crossbookTheirPct: 10 })).id;
      for (const a of [sw, cb]) {
        await log(a, T.s8, { bulletsUsed: 1, buyinAmount: 1500, cashAmount: 10000, tipAmount: 200, status: 'cashed' });
        await log(a, T.s9, { bulletsUsed: 1, buyinAmount: 3000, status: 'busted' });
      }
      const r = await api('POST', `/api/staking/series/${s4}/settle`, { token: ham, body: {} });
      assert.strictEqual(r.status, 400);
      assert.match(r.json.error, /Swap Partner, Crossbook Partner/);
      assert.deepStrictEqual(r.json.needs.sort(), [sw, cb].sort());
      assert.strictEqual((await api('POST', `/api/staking/series/${s4}/settle`, { token: ham, body: { prepaid: [{ agreementId: sw, amount: 10 }] } })).status, 400);
      assert.strictEqual((await api('POST', `/api/staking/series/${s4}/settle`, { token: ham, body: { partner: [{ agreementId: sw, amount: -1 }, { agreementId: cb, amount: 0 }] } })).status, 400, 'their cashes cannot be negative on a swap of winnings');
      // swap: 5% x 9800 - 5% x 4000 = 290. crossbook (net): mine (10000-200-1500) + (-3000) = 5300; theirs -500;
      // D = 5800 -> they pay me 10% = 580.
      const s = ok(await api('POST', `/api/staking/series/${s4}/settle`, { token: ham, body: { partner: [{ agreementId: sw, amount: 4000 }, { agreementId: cb, amount: -500 }] } }));
      figures(byAgreement(s, sw), { myResult: 9800, partnerResult: 4000, amountOwed: 290, direction: 'to_backer' }, 'swap ');
      figures(byAgreement(s, cb), { myResult: 5300, partnerResult: -500, difference: 5800, amountOwed: -580, direction: 'to_player' }, 'crossbook ');
      figures(byAgreement(ok(await sheet(s4)), cb), { amountOwed: -580, partnerResult: -500 }, 'crossbook re-read ');
    });

    await test('a budget cap through the server: $1,000 at 10%, the crossing event pro-rated', async () => {
      const s5 = await series('Budget Series');
      const b5 = await backer('Budget Backer');
      assert.strictEqual((await api('POST', `/api/staking/series/${s5}/agreements`, { token: ham, body: { backerId: b5, backerType: 'budget_capped', percentage: 10 } })).status, 400, 'a cap is required');
      const a = (await agreement(s5, { backerId: b5, backerType: 'budget_capped', percentage: 10, markup: 1.0, budgetCap: 1000 })).id;
      await log(a, T.d3, { buyinAmount: 5000, cashAmount: 20000, status: 'cashed' });
      await log(a, T.d1, { buyinAmount: 5000, status: 'busted' });
      await log(a, T.d4, { buyinAmount: 2000, cashAmount: 6000, status: 'cashed' });
      await log(a, T.d2, { buyinAmount: 3000, cashAmount: 9000, status: 'cashed' });
      figures(byAgreement(ok(await sheet(s5)), a), { grossInvestment: 1000, grossReturn: 1700, prepaid: 1000, amountOwed: 1700, budgetLeft: 0 });
    });

    await srv.stop();
    srv = null;

    // ── the migration on rows the old code wrote ──
    await test('the migration: old rows linked to their agreement where unambiguous; makeup moved to opening/closing; idempotent', async () => {
      const d = scratch.open();
      const uid = one(d, "SELECT id FROM users WHERE username = 'ham5'");
      const now = '2026-09-01T00:00:00.000Z';
      const mk = (sql, args) => { d.run(sql, args); return one(d, 'SELECT last_insert_rowid()'); };
      // L1: settled by the old code. A makeup agreement opened at -300; its series raw = 20% of
      // ($5,000 cash 6,000) = 1200 - 1000 = +200, so the old settle wrote makeup_balance = 200 + -300 = -100.
      const l1 = mk("INSERT INTO staking_series (user_id, name, status) VALUES (?, 'Legacy One', 'settled')", [uid]);
      const lb = mk("INSERT INTO backers (user_id, name) VALUES (?, 'Legacy Backer')", [uid]);
      const la = mk("INSERT INTO backer_agreements (series_id, backer_id, backer_type, percentage, markup, makeup_balance) VALUES (?, ?, 'makeup', 20, 1.0, -100)", [l1, lb]);
      d.run("INSERT INTO backer_event_status (agreement_id, tournament_id, bullets_used, buyin_amount, cash_amount, status) VALUES (?, ?, 1, 5000, 6000, 'cashed')", [la, T.t3]);
      const lr = mk("INSERT INTO backer_settlements (series_id, backer_id, gross_investment, gross_return, markup_amount, net_pnl, amount_owed) VALUES (?, ?, 1000, 1200, 0, -100, 200)", [l1, lb]);
      // L2: settled, one backer with two agreements and the ONE row the old upsert left.
      const l2 = mk("INSERT INTO staking_series (user_id, name, status) VALUES (?, 'Legacy Two', 'settled')", [uid]);
      d.run("INSERT INTO backer_agreements (series_id, backer_id, backer_type, percentage, markup) VALUES (?, ?, 'pay_per_play', 10, 1.0)", [l2, lb]);
      d.run("INSERT INTO backer_agreements (series_id, backer_id, backer_type, percentage, markup) VALUES (?, ?, 'profit_share_only', 5, 1.0)", [l2, lb]);
      const lr2 = mk("INSERT INTO backer_settlements (series_id, backer_id, amount_owed, is_paid, paid_at) VALUES (?, ?, 75, 1, ?)", [l2, lb, now]);
      // L3: not settled, a makeup agreement whose balance the old code kept in makeup_balance.
      const l3 = mk("INSERT INTO staking_series (user_id, name, status) VALUES (?, 'Legacy Three', 'active')", [uid]);
      const la3 = mk("INSERT INTO backer_agreements (series_id, backer_id, backer_type, percentage, markup, makeup_balance) VALUES (?, ?, 'makeup', 10, 1.0, -250)", [l3, lb]);
      // Make the migration run again on this file.
      d.run("DELETE FROM _applied_migrations WHERE name = 'staking-settlement-2026-10'");
      d.run('DROP INDEX IF EXISTS idx_backer_settlements_agreement');
      d.run('DROP INDEX IF EXISTS idx_bankroll_adj_settlement_ref');
      scratch.save(d);
      d.close();

      srv = await boot(scratch.dbPath, {}, { ports: PORTS });
      assert.match(srv.log(), /Staking settlement: 2 settlement row\(s\) from before \(1 linked to their agreement, 1 left unlinked: a backer with two agreements in one series, or none\); makeup agreements moved to opening\/closing: 1 unsettled, 1 settled/);
      const q = await readDb();
      const r1 = rowsOf(q, 'SELECT * FROM backer_settlements WHERE id = ?', [lr])[0];
      assert.strictEqual(r1.agreement_id, la);
      // closing = the old makeup_balance (-100); opening = -100 - raw(+200) = -300.
      assert.strictEqual(r1.makeup_closing, -100);
      assert.strictEqual(r1.makeup_opening, -300);
      assert.strictEqual(one(q, 'SELECT makeup_opening FROM backer_agreements WHERE id = ?', [la]), -300);
      assert.strictEqual(one(q, 'SELECT makeup_balance FROM backer_agreements WHERE id = ?', [la]), -100, 'makeup_balance is left in place');
      assert.strictEqual(one(q, 'SELECT agreement_id FROM backer_settlements WHERE id = ?', [lr2]), null);
      assert.strictEqual(one(q, 'SELECT makeup_opening FROM backer_agreements WHERE id = ?', [la3]), -250);
      assert.strictEqual(r1.amount_owed, 200, 'a stored figure is never rewritten');
      q.close();
      // The sheet shows the old rows as stored, flagged legacy.
      const hamTok = (await (await fetch(`http://127.0.0.1:${srv.port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'adminx@x.test', password: PW }) })).json()).token;
      const sh = await (await fetch(`http://127.0.0.1:${srv.port}/api/staking/series/${l1}/settlement`, { headers: { Authorization: `Bearer ${hamTok}` } })).json();
      assert.strictEqual(sh.isSettled, true);
      assert.strictEqual(sh.settlements.length, 1);
      figures(sh.settlements[0], { id: lr, legacy: true, amountOwed: 200, makeupOpening: -300, makeupClosing: -100, agreementId: la });
      const sh2 = await (await fetch(`http://127.0.0.1:${srv.port}/api/staking/series/${l2}/settlement`, { headers: { Authorization: `Bearer ${hamTok}` } })).json();
      figures(sh2.settlements[0], { id: lr2, agreementId: null, isPaid: true, amountOwed: 75 });
      await srv.stop();
      srv = await boot(scratch.dbPath, {}, { ports: PORTS });
      assert.ok(!/Migration "staking-settlement-2026-10" applied/.test(srv.log()), 'ran once');
      await srv.stop();
      srv = null;
    });

    await test('the pure migrate() is idempotent on its own', async () => {
      const d = scratch.open();
      const r = S.migrate(d);
      assert.deepStrictEqual({ col: r.snapshotColumn, linked: r.agreementLinked, mu: r.makeupUnsettled, ms: r.makeupSettled }, { col: false, linked: 0, mu: 0, ms: 0 });
      d.close();
    });
  } finally {
    if (srv) await srv.stop();
    scratch.cleanup();
  }
  done();
})().catch((e) => { console.error(e); process.exit(1); });
