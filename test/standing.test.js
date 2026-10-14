// lib/staking/standing.js — the standing-% share math (docs/bankroll-merge.md §6.4).
//
//   node --test test/standing.test.js test/classify.test.js        (or: npm run test:standing)
//
// 1. The 14 cases of the dashboard's WC:app/src/db/backers.test.ts, ported (money in integer
//    cents; the stakes are the standing_stakes shape; deliveryChannels reads this app's backers).
// 2. Dated stakes, the overlap rule, exclusions, and the rest of the decision list in resultCuts.
// 3. Rounding: exact boundaries, loss/win symmetry, and a 10,000-pair parity sweep against the
//    dashboard's float formula (|difference| <= 1 cent).
// 4. The three SELECT-only readers, against a scratch sql.js database built from the real DDL.
//
// Owner answers of 2026-10-14 that show up here: Q8 (a stake matches only its exact game) and Q7
// (a standing stake and a series agreement on one tournament are both returned, flagged `ask`).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const initSqlJs = require('sql.js');
const S = require('../lib/staking/standing');
const moneyMerge = require('../lib/money-merge');

// ── fixtures (made up) ──
const mk = (stakes, name = 'B') => ({ id: 1, name, stakes });
const sess = (p = {}) => ({ date: '2026-07-05', channel: 'live', format: 'PLO', resultCents: 124000, ...p });
const stake = (format, channel, pct, extra = {}) => ({ format, channel, pct, ...extra });

// ───────────────────────────── 1. the 14 ported cases ─────────────────────────────

test('matchPct: matches an exact format', () => {
  assert.strictEqual(S.matchPct([stake('PLO', 'any', 20)], sess()), 20);
});
test('matchPct: does not match a different format', () => {
  assert.strictEqual(S.matchPct([stake('NLH', 'any', 20)], sess()), null);
});
test('matchPct: matches the "all games" wildcard', () => {
  assert.strictEqual(S.matchPct([stake('all', 'any', 10)], sess()), 10);
});
test('matchPct: respects the channel scope', () => {
  const b = [stake('PLO', 'online', 20)];
  assert.strictEqual(S.matchPct(b, sess({ channel: 'live' })), null);
  assert.strictEqual(S.matchPct(b, sess({ channel: 'online' })), 20);
});
test('matchPct: prefers the most specific matching stake over the wildcard', () => {
  assert.strictEqual(S.matchPct([stake('all', 'any', 10), stake('PLO', 'any', 25)], sess()), 25);
});
test('matchPct: prefers an exact channel over "any" at equal format specificity', () => {
  assert.strictEqual(S.matchPct([stake('PLO', 'any', 15), stake('PLO', 'live', 22)], sess({ channel: 'live' })), 22);
});

test('backerShare: computes the cut of a winning session', () => {
  assert.strictEqual(S.backerShare([stake('PLO', 'any', 20)], sess()), 24800); // 20% of $1,240.00 = $248.00
});
test('backerShare: is negative on a losing session (makeup)', () => {
  assert.strictEqual(S.backerShare([stake('PLO', 'any', 20)], sess({ resultCents: -100000 })), -20000);
});
test('backerShare: returns null when not staked', () => {
  assert.strictEqual(S.backerShare([stake('NLH', 'any', 20)], sess()), null);
});

test('cutsForSession: includes only matching backers, sorted by |share|', () => {
  const backers = [
    mk([stake('PLO', 'any', 10)], 'Small'),
    mk([stake('PLO', 'any', 30)], 'Big'),
    mk([stake('NLH', 'any', 50)], 'Other'),
  ];
  const cuts = S.cutsForSession(backers, sess());
  assert.deepStrictEqual(cuts.map((c) => c.backer.name), ['Big', 'Small']);
  assert.strictEqual(cuts[0].shareCents, 37200);
  assert.deepStrictEqual(cuts.map((c) => c.pct), [30, 10]);
});

test('sessionGameLabel: labels a cash game with its stake', () => {
  assert.strictEqual(S.sessionGameLabel({ format: 'PLO', gameLabel: '5/5/10 PLO', stakeLevel: '5/5/10' }), '5/5/10 PLO');
});
test('sessionGameLabel: labels an MTT', () => {
  assert.ok(S.sessionGameLabel({ isMTT: true, format: 'PLO', stakeLevel: undefined, gameLabel: 'Sunday Major' }).includes('MTT'));
});

test('deliveryChannels: always includes the link, adds text/email when opted in and reachable', () => {
  assert.deepStrictEqual(S.deliveryChannels({}), ['link']);
  assert.deepStrictEqual(S.deliveryChannels({ notify_sms: 1, phone: '+15550100' }), ['link', 'text']);
  assert.deepStrictEqual(S.deliveryChannels({ notify_email: 1, email: 'a@b.test' }), ['link', 'email digest']);
  assert.deepStrictEqual(S.deliveryChannels({ notify_sms: 1, phone: '+1', notify_email: 1, email: 'a@b.test' }), ['link', 'text', 'email digest']);
  // new here: delivery is opt-in, and an address is needed too (§4.2)
  assert.deepStrictEqual(S.deliveryChannels({ notify_email: 0, email: 'a@b.test', notify_sms: 0, phone: '+1' }), ['link']);
  assert.deepStrictEqual(S.deliveryChannels({ notify_email: 1, email: '', notify_sms: 1, phone: null }), ['link']);
});

test('newToken: is 8 base62 chars and unique', () => {
  const a = S.newToken();
  const b = S.newToken();
  assert.match(a, /^[A-Za-z0-9]{8}$/);
  assert.notStrictEqual(a, b);
});

// ───────────────────────────── 2. stakes, windows, owner Q8 ─────────────────────────────

test('Q8: a stake matches only its exact game, or "all"', () => {
  assert.strictEqual(S.matchPct([stake('PLO', 'any', 20)], sess({ format: 'PLO5' })), null, 'PLO5 is not PLO');
  assert.strictEqual(S.matchPct([stake('PLO', 'any', 20)], sess({ format: 'PLO6' })), null);
  assert.strictEqual(S.matchPct([stake('PLO8', 'any', 20)], sess({ format: 'PLO6_8' })), null, 'PLO6 8/b is not PLO8');
  assert.strictEqual(S.matchPct([stake('PLO6_8', 'any', 20)], sess({ format: 'PLO6_8' })), 20);
  assert.strictEqual(S.matchPct([stake('mixed', 'any', 20)], sess({ format: 'HORSE' })), null, 'HORSE is not "mixed"');
  assert.strictEqual(S.matchPct([stake('all', 'any', 5)], sess({ format: 'PLO6_8' })), 5);
});

test('ties: a larger pct wins at equal specificity; the first listed wins an exact tie', () => {
  assert.strictEqual(S.matchPct([stake('PLO', 'any', 10), stake('PLO', 'any', 15)], sess()), 15);
  assert.strictEqual(S.matchPct([stake('PLO', 'any', 15), stake('PLO', 'any', 10)], sess()), 15);
  const a = stake('PLO', 'any', 10, { id: 1 }), b = stake('PLO', 'any', 10, { id: 2 });
  assert.strictEqual(S.matchStake([a, b], sess()).id, 1);
  // format outranks channel: 2 > 1
  assert.strictEqual(S.matchPct([stake('PLO', 'any', 11), stake('all', 'live', 40)], sess()), 11);
});

test('matchStake returns the winning stake (its id is what a posted share records)', () => {
  const s = S.matchStake([stake('all', 'any', 10, { id: 5 }), stake('PLO', 'live', 25, { id: 6 })], sess());
  assert.strictEqual(s.id, 6);
  assert.strictEqual(S.matchStake([], sess()), null);
  assert.strictEqual(S.matchStake(null, sess()), null);
});

test('dated stakes: both ends inclusive, open ends, and a "from today" switch', () => {
  const old = stake('PLO', 'any', 10, { id: 1, valid_from: '2026-01-01', valid_to: '2026-06-30' });
  const now = stake('PLO', 'any', 20, { id: 2, valid_from: '2026-07-01', valid_to: null });
  const at = (date) => S.matchStake([old, now], sess({ date }));
  assert.strictEqual(at('2025-12-31'), null, 'before the first stake');
  assert.strictEqual(at('2026-01-01').id, 1, 'first day, inclusive');
  assert.strictEqual(at('2026-06-30').id, 1, 'last day, inclusive');
  assert.strictEqual(at('2026-07-01').id, 2, 'the day the new stake opens');
  assert.strictEqual(at('2031-01-01').id, 2, 'open-ended');
});

test('dated stakes: an edit "from today" never changes a past share', () => {
  const stakes = [
    stake('PLO', 'any', 10, { id: 1, valid_from: '2026-01-01', valid_to: '2026-07-04' }),
    stake('PLO', 'any', 25, { id: 2, valid_from: '2026-07-05' }),
  ];
  assert.strictEqual(S.backerShare(stakes, sess({ date: '2026-07-04', resultCents: 100000 })), 10000);
  assert.strictEqual(S.backerShare(stakes, sess({ date: '2026-07-05', resultCents: 100000 })), 25000);
});

test('dated stakes: a windowed stake needs a dated result; an undated stake always applies', () => {
  const windowed = stake('PLO', 'any', 30, { valid_from: '2026-01-01' });
  assert.strictEqual(S.matchPct([windowed], sess({ date: undefined })), null);
  assert.strictEqual(S.matchPct([windowed], sess({ date: 'July 5' })), null);
  assert.strictEqual(S.matchPct([stake('PLO', 'any', 30)], sess({ date: undefined })), 30);
  assert.deepStrictEqual(S.stakesInForce([windowed, stake('all', 'any', 1)], '2025-01-01').map((s) => s.pct), [1]);
});

test('matching ignores a stake with a non-numeric or negative pct, and keeps a 0% override', () => {
  assert.strictEqual(S.matchPct([stake('PLO', 'any', 'abc'), stake('all', 'any', 10)], sess()), 10);
  assert.strictEqual(S.matchPct([stake('PLO', 'any', -5), stake('all', 'any', 10)], sess()), 10);
  assert.strictEqual(S.matchPct([stake('PLO', 'any', 0), stake('all', 'any', 10)], sess()), 0, 'the dashboard\'s behaviour: a specific 0% beats the wildcard');
});

// ───────────────────────────── 3. money ─────────────────────────────

test('shareCents: round half up on the magnitude, so a loss mirrors the equal win', () => {
  assert.strictEqual(S.shareCents(5, 10), 1); // 0.5 -> 1
  assert.strictEqual(S.shareCents(-5, 10), -1); // the dashboard's float gives -0 here
  assert.strictEqual(S.shareCents(15, 10), 2); // 1.5 -> 2
  assert.strictEqual(S.shareCents(-15, 10), -2);
  assert.strictEqual(S.shareCents(4, 10), 0);
  assert.strictEqual(S.shareCents(-4, 10), 0);
  assert.ok(Object.is(S.shareCents(-4, 10), 0), 'zero is +0, never -0');
  for (const r of [1, 7, 99, 12345, 999999]) for (const p of [0.5, 12.5, 20, 33.33, 66.67]) {
    assert.strictEqual(S.shareCents(-r, p), 0 - S.shareCents(r, p), `${r} @ ${p}`); // 0 - 0 is +0, as shareCents returns
  }
});

test('shareCents: exact at decimal boundaries where floats drift', () => {
  // 33.3% of 15 cents = 4.995 -> 5; 12.5% of 4 = 0.5 -> 1; 0.1+0.2 style noise does not tip a half
  assert.strictEqual(S.shareCents(15, 33.3), 5);
  assert.strictEqual(S.shareCents(4, 12.5), 1);
  assert.strictEqual(S.shareCents(1005, 10), 101); // 100.5 -> 101
  assert.strictEqual(S.shareCents(1015, 10), 102); // 101.5 -> 102
  assert.strictEqual(S.shareCents(3, 50), 2); // 1.5
  assert.strictEqual(S.shareCents(1, 50), 1); // 0.5
  assert.strictEqual(S.shareCents(124000, 20), 24800);
  assert.strictEqual(S.shareCents(124000, 100), 124000);
  assert.strictEqual(S.shareCents(0, 20), 0);
  assert.strictEqual(S.shareCents(124000, 0), 0);
  assert.strictEqual(S.shareCents(Number.MAX_SAFE_INTEGER, 100), Number.MAX_SAFE_INTEGER, 'no overflow at the top of the range');
});

test('shareCents refuses what is not cents', () => {
  assert.throws(() => S.shareCents(12.5, 10), TypeError);
  assert.throws(() => S.shareCents('100', 10), TypeError);
  assert.throws(() => S.shareCents(NaN, 10), TypeError);
  assert.throws(() => S.shareCents(100, -1), RangeError);
  assert.throws(() => S.shareCents(100, NaN), RangeError);
  assert.throws(() => S.shareCents(100, 1001), RangeError);
});

// A small deterministic generator, so the sweep is the same on every run.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('rounding parity sweep: 10,000 random result x pct pairs differ from the dashboard formula by at most one cent', () => {
  const rnd = prng(20261014);
  let differ = 0;
  let worst = 0;
  for (let i = 0; i < 10000; i++) {
    const r = Math.round((rnd() * 2 - 1) * 5e7); // up to +-$500,000
    const kind = i % 4;
    const pct = kind === 0 ? Math.round(rnd() * 100) // whole
      : kind === 1 ? Math.round(rnd() * 200) / 2 // halves
        : kind === 2 ? Math.round(rnd() * 10000) / 100 // two decimals
          : rnd() * 100; // any double
    const mine = S.shareCents(r, pct);
    const dashboard = Math.round(((r / 100) * pct) / 100 * 100); // WC: Math.round(result x pct / 100 x 100)
    const d = Math.abs(mine - dashboard);
    if (d > 0) differ++;
    worst = Math.max(worst, d);
    assert.ok(d <= 1, `r=${r} pct=${pct}: mine ${mine}, dashboard ${dashboard}`);
  }
  assert.ok(worst <= 1);
  assert.ok(differ < 100, `only the half-cent and float-noise cases differ (${differ})`);
});

test('exactness: for pct to two decimals, the result is the integer round-half-up of |r| x pct / 100', () => {
  const rnd = prng(7);
  for (let i = 0; i < 10000; i++) {
    const r = Math.round((rnd() * 2 - 1) * 5e7);
    const p100 = Math.round(rnd() * 10000); // pct in hundredths of a percent
    const pct = p100 / 100;
    const n = BigInt(Math.abs(r)) * BigInt(p100); // |r| x pct x 100
    const q = Number((2n * n + 10000n) / 20000n); // floor(n / 10000 + 1/2)
    assert.strictEqual(S.shareCents(r, pct), r < 0 ? (q === 0 ? 0 : -q) : q, `r=${r} pct=${pct}`);
  }
});

test('the documented difference: the dashboard rounds a half-cent loss toward zero, this does not', () => {
  const r = -5, pct = 10;
  const dashboard = Math.round(((r / 100) * pct) / 100 * 100);
  assert.ok(Object.is(dashboard, -0) || dashboard === 0);
  assert.strictEqual(S.shareCents(r, pct), -1);
  assert.ok(Math.abs(S.shareCents(r, pct) - dashboard) <= 1);
});

test('net of a result in cents: the ledger\'s two formulas (§6.4, Q12)', () => {
  // tournament: (cashed ? cash : 0) - buyin x max(1, entries)
  assert.strictEqual(S.tournamentNetCents({ cashed: 1, cash_amount: 5000, buyin: 1000, num_entries: 2 }), 300000);
  assert.strictEqual(S.tournamentNetCents({ cashed: 0, cash_amount: 5000, buyin: 1000, num_entries: 3 }), -300000);
  assert.strictEqual(S.tournamentNetCents({ cashed: 0, cash_amount: 0, buyin: 500, num_entries: 0 }), -50000, 'zero entries read as one');
  assert.strictEqual(S.tournamentNetCents({ cashed: 1, cash_amount: null, buyin: 100 }), -10000);
  // cash: after tips and session expenses
  assert.strictEqual(S.cashNetCents({ buy_in: 500, cash_out: 800, tips: 10, expenses: 5 }), 28500);
  assert.strictEqual(S.cashNetCents({ buy_in: 300, cash_out: 0 }), -30000);
  assert.strictEqual(S.cashNetCents({}), 0);
});

test('usdCents converts at the given rates (units per USD) and leaves USD alone', () => {
  assert.strictEqual(S.usdCents(12345, 'USD', null), 12345);
  assert.strictEqual(S.usdCents(12345, undefined, { EUR: 0.9 }), 12345);
  assert.strictEqual(S.usdCents(9000, 'EUR', { EUR: 0.9 }), 10000);
  assert.strictEqual(S.usdCents(-9000, 'EUR', { EUR: 0.9 }), -10000);
  assert.throws(() => S.usdCents(100, 'XYZ', { EUR: 0.9 }), RangeError);
});

test('newToken: all 62 characters turn up and none is favoured', () => {
  const seen = new Map();
  for (let i = 0; i < 4000; i++) for (const ch of S.newToken()) seen.set(ch, (seen.get(ch) || 0) + 1);
  assert.strictEqual(seen.size, 62);
  const counts = [...seen.values()];
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  assert.ok(Math.max(...counts) < mean * 1.25 && Math.min(...counts) > mean * 0.75, 'roughly even');
  assert.strictEqual(new Set(Array.from({ length: 2000 }, () => S.newToken())).size, 2000);
});

// ───────────────────────────── 4. resultCuts: windows, exclusions, overlap ─────────────────────────────

const agreement = (id, backerId, stakes, extra = {}) => ({
  id, backerId, status: 'active', effectiveFrom: '2026-01-01', effectiveTo: null, stakes, ...extra,
});
const tournament = (p = {}) => ({ table: 'tracking_entries', id: 40, kind: 'tournament', date: '2026-07-05', format: 'PLO', channel: 'live', resultCents: 124000, ...p });

test('resultCuts: one cut per matching active agreement, biggest |share| first', () => {
  const r = S.resultCuts({
    agreements: [agreement(1, 11, [stake('PLO', 'any', 10, { id: 100 })]), agreement(2, 12, [stake('all', 'any', 30, { id: 101 })]), agreement(3, 13, [stake('NLH', 'any', 50)])],
    result: tournament(),
  });
  assert.deepStrictEqual(r.cuts.map((c) => [c.agreementId, c.backerId, c.stakeId, c.pct, c.shareCents, c.ask]),
    [[2, 12, 101, 30, 37200, false], [1, 11, 100, 10, 12400, false]]);
  assert.deepStrictEqual(r.skipped, [{ agreementId: 3, backerId: 13, reason: 'not-staked' }]);
  assert.strictEqual(r.needsAsk, false);
});

test('resultCuts: an ended agreement and a result outside its window never derive', () => {
  const stakes = [stake('all', 'any', 20)];
  const r = S.resultCuts({
    agreements: [
      agreement(1, 11, stakes, { status: 'ended' }),
      agreement(2, 12, stakes, { effectiveFrom: '2026-07-06' }), // starts the day after
      agreement(3, 13, stakes, { effectiveTo: '2026-07-04' }), // ended the day before
      agreement(4, 14, stakes, { effectiveFrom: '2026-07-05', effectiveTo: '2026-07-05' }), // exactly that day: inclusive both ends
    ],
    result: tournament(),
  });
  assert.deepStrictEqual(r.cuts.map((c) => c.agreementId), [4]);
  assert.deepStrictEqual(r.skipped.map((s) => [s.agreementId, s.reason]), [[1, 'ended'], [2, 'outside-window'], [3, 'outside-window']]);
  const undated = S.resultCuts({ agreements: [agreement(1, 11, stakes)], result: tournament({ date: null }) });
  assert.deepStrictEqual(undated.skipped.map((s) => s.reason), ['outside-window']);
});

test('resultCuts: the stake in force on the result\'s date sets the pct', () => {
  const a = agreement(1, 11, [
    stake('PLO', 'any', 10, { id: 1, valid_from: '2026-01-01', valid_to: '2026-07-04' }),
    stake('PLO', 'any', 25, { id: 2, valid_from: '2026-07-05' }),
  ]);
  const before = S.resultCuts({ agreements: [a], result: tournament({ date: '2026-07-04' }) }).cuts[0];
  const after = S.resultCuts({ agreements: [a], result: tournament({ date: '2026-07-05' }) }).cuts[0];
  assert.deepStrictEqual([before.stakeId, before.pct], [1, 10]);
  assert.deepStrictEqual([after.stakeId, after.pct], [2, 25]);
});

test('resultCuts: exclusions drop one backer from one result, only', () => {
  const stakes = [stake('all', 'any', 20)];
  const agreements = [agreement(1, 11, stakes), agreement(2, 12, stakes)];
  const excl = new Set([S.exclusionKey(1, 'tracking_entries', 40)]);
  const r = S.resultCuts({ agreements, result: tournament(), exclusions: excl });
  assert.deepStrictEqual(r.cuts.map((c) => c.agreementId), [2]);
  assert.deepStrictEqual(r.skipped, [{ agreementId: 1, backerId: 11, reason: 'excluded' }]);
  // another result, the same backer: still staked
  assert.strictEqual(S.resultCuts({ agreements, result: tournament({ id: 41 }), exclusions: excl }).cuts.length, 2);
  // the same id in the other table is another result
  assert.strictEqual(S.resultCuts({ agreements, result: tournament({ table: 'cash_sessions', kind: 'cash' }), exclusions: excl }).cuts.length, 2);
  // an array works as well as a Set
  assert.strictEqual(S.resultCuts({ agreements, result: tournament(), exclusions: [S.exclusionKey(2, 'tracking_entries', 40)] }).cuts[0].agreementId, 1);
});

test('resultCuts: a live cash session never derives a share', () => {
  const r = S.resultCuts({
    agreements: [agreement(1, 11, [stake('all', 'any', 20)])],
    result: tournament({ table: 'cash_sessions', kind: 'cash', ended: false }),
  });
  assert.deepStrictEqual(r.cuts, []);
  assert.deepStrictEqual(r.skipped.map((s) => s.reason), ['live']);
  assert.strictEqual(S.resultCuts({ agreements: [agreement(1, 11, [stake('all', 'any', 20)])], result: tournament({ table: 'cash_sessions', kind: 'cash', ended: true }) }).cuts.length, 1);
});

test('overlap rule, owner Q7: a standing stake AND a series agreement on one tournament return both, flagged to ask', () => {
  const agreements = [agreement(1, 11, [stake('PLO', 'any', 10)]), agreement(2, 12, [stake('PLO', 'any', 20)])];
  const r = S.resultCuts({ agreements, result: tournament(), seriesBackerIds: new Set([12]) });
  // backer 12 holds a series agreement on this tournament: the standing cut is NOT dropped and the
  // series agreement is NOT chosen over it — it is flagged, and the owner answers each time
  assert.deepStrictEqual(r.cuts.map((c) => [c.backerId, c.shareCents, c.ask, c.seriesOverlap]), [[12, 24800, true, true], [11, 12400, false, false]]);
  assert.strictEqual(r.needsAsk, true);
  assert.deepStrictEqual(r.skipped, []);
});

test('overlap rule: only the same backer, only tournaments, and only when the standing stake matches', () => {
  const agreements = [agreement(1, 11, [stake('PLO', 'any', 10)])];
  assert.strictEqual(S.resultCuts({ agreements, result: tournament(), seriesBackerIds: [99] }).needsAsk, false, 'another backer\'s series deal');
  const cash = tournament({ table: 'cash_sessions', kind: 'cash' });
  assert.strictEqual(S.resultCuts({ agreements, result: cash, seriesBackerIds: [11] }).needsAsk, false, 'cash sessions are never in a series');
  const nlhOnly = [agreement(1, 11, [stake('NLH', 'any', 10)])];
  const r = S.resultCuts({ agreements: nlhOnly, result: tournament(), seriesBackerIds: [11] });
  assert.deepStrictEqual([r.cuts.length, r.needsAsk], [0, false], 'no standing match, nothing to ask');
});

test('resultCuts: the result\'s own game decides (Q8): a PLO5 night is not a PLO backer\'s', () => {
  const agreements = [agreement(1, 11, [stake('PLO', 'any', 10)]), agreement(2, 12, [stake('all', 'any', 5)])];
  const r = S.resultCuts({ agreements, result: tournament({ format: 'PLO5' }) });
  assert.deepStrictEqual(r.cuts.map((c) => c.backerId), [12]);
});

test('resultCuts: a loss derives a negative share, signed like the result', () => {
  const r = S.resultCuts({ agreements: [agreement(1, 11, [stake('all', 'any', 20)])], result: tournament({ resultCents: -50050 }) });
  assert.strictEqual(r.cuts[0].shareCents, -10010);
});

// ───────────────────────────── 5. the readers ─────────────────────────────

async function scratchDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE users (id INTEGER PRIMARY KEY)');
  db.run('CREATE TABLE backers (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL)');
  db.run('CREATE TABLE staking_series (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL)');
  db.run('CREATE TABLE backer_agreements (id INTEGER PRIMARY KEY AUTOINCREMENT, series_id INTEGER NOT NULL, backer_id INTEGER NOT NULL, backer_type TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1)');
  db.run('CREATE TABLE backer_event_status (id INTEGER PRIMARY KEY AUTOINCREMENT, agreement_id INTEGER NOT NULL, tournament_id INTEGER NOT NULL)');
  for (const name of ['standing_agreements', 'standing_stakes', 'standing_exclusions']) {
    for (const stmt of moneyMerge.TABLES.find((t) => t.name === name).ddl) db.run(stmt);
  }
  return db;
}

test('loadAgreements and loadExclusions read the player\'s own rows only, stakes attached', async () => {
  const db = await scratchDb();
  db.run('INSERT INTO users (id) VALUES (1), (2)');
  db.run("INSERT INTO backers (user_id, name) VALUES (1, 'Dan'), (1, 'Eve'), (2, 'Fay')");
  db.run("INSERT INTO standing_agreements (user_id, backer_id, effective_from, status, opening_cents, created_at) VALUES (1, 1, '2026-01-01', 'active', -2500, 'x'), (1, 2, '2026-02-01', 'ended', 0, 'x'), (2, 3, '2026-01-01', 'active', 0, 'x')");
  db.run("INSERT INTO standing_stakes (agreement_id, format, channel, pct, valid_from, created_at) VALUES (1, 'PLO', 'any', 20, '2026-01-01', 'x'), (1, 'all', 'online', 5, '2026-01-01', 'x'), (3, 'NLH', 'any', 50, '2026-01-01', 'x')");
  db.run("INSERT INTO standing_exclusions (agreement_id, ref_table, ref_id, created_at) VALUES (1, 'tracking_entries', 40, 'x'), (3, 'tracking_entries', 40, 'x')");
  const mine = S.loadAgreements(db, 1);
  assert.deepStrictEqual(mine.map((a) => [a.id, a.backerId, a.status, a.openingCents, a.effectiveTo, a.stakes.length]), [[1, 1, 'active', -2500, null, 2], [2, 2, 'ended', 0, null, 0]]);
  assert.deepStrictEqual(mine[0].stakes.map((s) => [s.format, s.channel, s.pct]), [['PLO', 'any', 20], ['all', 'online', 5]]);
  assert.deepStrictEqual([...S.loadExclusions(db, 1)], [S.exclusionKey(1, 'tracking_entries', 40)]);
  assert.strictEqual(S.loadAgreements(db, 9).length, 0);
  // end to end: what is read feeds the engine
  const r = S.resultCuts({ agreements: mine, result: tournament(), exclusions: S.loadExclusions(db, 1) });
  assert.deepStrictEqual(r.skipped.map((s) => [s.agreementId, s.reason]), [[1, 'excluded'], [2, 'ended']]);
  db.close();
});

test('one ACTIVE agreement per (player, backer): the partial unique index', async () => {
  const db = await scratchDb();
  const ins = (status) => db.run(`INSERT INTO standing_agreements (user_id, backer_id, effective_from, status, created_at) VALUES (1, 1, '2026-01-01', '${status}', 'x')`);
  ins('active');
  assert.throws(() => ins('active'), /UNIQUE/);
  ins('ended');
  ins('ended'); // history is not limited
  db.run("UPDATE standing_agreements SET status = 'ended' WHERE status = 'active'");
  ins('active'); // ending one frees the slot for the next
  db.close();
});

test('seriesBackerIds: backers with an active series agreement that has a status row for the tournament', async () => {
  const db = await scratchDb();
  db.run("INSERT INTO staking_series (user_id, name) VALUES (1, 'WSOP'), (2, 'Other player')");
  db.run("INSERT INTO backers (user_id, name) VALUES (1, 'Dan'), (1, 'Eve'), (1, 'Gus'), (2, 'Fay')");
  // agreements: Dan (active) and Eve (inactive) in series 1; Fay in another player's series 2
  db.run("INSERT INTO backer_agreements (series_id, backer_id, backer_type, is_active) VALUES (1, 1, 'stake', 1), (1, 2, 'stake', 0), (2, 4, 'stake', 1), (1, 1, 'stake', 1)");
  db.run('INSERT INTO backer_event_status (agreement_id, tournament_id) VALUES (1, 700), (2, 700), (3, 700), (4, 700), (1, 701)');
  assert.deepStrictEqual([...S.seriesBackerIds(db, 1, 700)], [1], 'Dan once (two agreements, one backer); Eve inactive; Fay is another player\'s');
  assert.deepStrictEqual([...S.seriesBackerIds(db, 1, 701)], [1]);
  assert.deepStrictEqual([...S.seriesBackerIds(db, 1, 702)], []);
  assert.deepStrictEqual([...S.seriesBackerIds(db, 2, 700)], [4], 'scoped to the player');
  db.close();
});
