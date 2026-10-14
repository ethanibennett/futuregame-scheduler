// The settlement panel's view logic (utils/staking-settlement.js), docs/bankroll-merge.md §10 item 8:
// the Paid toggle renders for a stored row (id), Finalize for an unsettled sheet (isSettled), the
// headline says who pays whom, and the inputs go back as the server's body. Entries are shaped like
// GET /api/staking/series/:id/settlement answers (lib/staking/settlement.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// utils.js (CURRENCY_CONFIG, MINUS) reads localStorage at module scope for a debug clock; stub it,
// and import dynamically so the stub comes first. Nothing here touches it.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const {
  BACKER_TYPE_LABELS, fmtSettle, canMarkPaid, showFinalize, typeLine, owedLine, settlementLines,
  inputsBody, missingPartner, paidLine, totalsLine, isMutual,
} = await import('../staking-settlement.js');

const MINUS = '−';
const entry = (o = {}) => ({
  id: null, agreementId: 7, backerId: 3, backerName: 'Sam Example', backerType: 'pay_per_play', percentage: 10, markup: 1.2,
  grossInvestment: 120, markupAmount: 20, grossReturn: 0, prepaid: 120, prepaidDefault: 120, refund: 0, unpaid: 0,
  budgetCap: null, amountOwed: 0, direction: 'none', adjustment: 0, isPaid: false, ...o,
});

test('the Paid toggle renders only for a stored row (it has an id)', () => {
  assert.equal(canMarkPaid(entry()), false);
  assert.equal(canMarkPaid(entry({ id: 41 })), true);
  assert.equal(canMarkPaid(null), false);
});

test('Finalize shows on an unsettled sheet with entries, never on a settled one (isSettled, not status)', () => {
  assert.equal(showFinalize({ isSettled: false, status: 'active', settlements: [entry()] }), true);
  assert.equal(showFinalize({ isSettled: true, status: 'settled', settlements: [entry({ id: 1 })] }), false);
  assert.equal(showFinalize({ isSettled: false, settlements: [] }), false);
  assert.equal(showFinalize(null), false);
});

test('the headline says who pays whom, with the amount unsigned', () => {
  assert.deepEqual(owedLine(entry({ amountOwed: 490, direction: 'to_backer' })), { text: 'You pay Sam Example $490', tone: 'out' });
  assert.deepEqual(owedLine(entry({ amountOwed: -120, direction: 'to_player' })), { text: 'Sam Example pays you $120', tone: 'in' });
  assert.deepEqual(owedLine(entry()), { text: 'Nothing to pay', tone: 'none' });
  assert.deepEqual(owedLine(entry({ amountOwed: 299.5, direction: 'to_backer' }), 'EUR'), { text: 'You pay Sam Example €299.50', tone: 'out' });
});

test('money: cents only when there are some, the minus sign U+2212, suffix currencies', () => {
  assert.equal(fmtSettle(1455), '$1,455');
  assert.equal(fmtSettle(299.5), '$299.50');
  assert.equal(fmtSettle(-120), MINUS + '$120');
  assert.equal(fmtSettle(40, 'USD', { sign: true }), '+$40');
  assert.equal(fmtSettle(1000, 'SEK'), '1,000 kr');
  assert.equal(fmtSettle(null), '—');
});

test('the type line', () => {
  assert.equal(typeLine(entry()), 'Pay Per Play · 10% · 1.2x');
  assert.equal(typeLine(entry({ markup: 1 })), 'Pay Per Play · 10%');
  assert.equal(typeLine(entry({ backerType: 'swap', myPct: 5, theirPct: 5 })), 'Swap · 5% / 5%');
  assert.equal(typeLine(entry({ backerType: 'profit_share_only', percentage: 5 })), 'Profit Share · 5% of profit');
  assert.equal(Object.keys(BACKER_TYPE_LABELS).length, 9);
  assert.ok(isMutual({ backerType: 'crossbook' }) && !isMutual({ backerType: 'makeup' }));
});

test('the lines of an action deal: piece, markup, prepaid, share, refund, unpaid, makeup', () => {
  const keys = (e) => settlementLines(e).map((l) => l.key);
  assert.deepEqual(keys(entry()), ['investment', 'markup', 'prepaid', 'return']);
  assert.deepEqual(keys(entry({ refund: 275 })), ['investment', 'markup', 'prepaid', 'return', 'refund']);
  assert.deepEqual(keys(entry({ prepaid: 0, unpaid: 120 })), ['investment', 'markup', 'prepaid', 'return', 'unpaid']);
  const mk = settlementLines(entry({ backerType: 'makeup', markup: 1, markupAmount: 0, makeupOpening: -1000, makeupClosing: 0 }));
  assert.deepEqual(mk.slice(-2).map((l) => [l.label, l.value]), [['Makeup in', MINUS + '$1,000'], ['Makeup out', '$0']]);
  const b = settlementLines(entry({ backerType: 'budget_capped', markupAmount: 0, budgetCap: 1000, budgetLeft: 200, refund: 200 }));
  assert.deepEqual(b.filter((l) => ['budget', 'refund'].includes(l.key)).map((l) => [l.label, l.value]), [['Budget left', '$200 of $1,000'], ['Unused budget', '$200']]);
  const adj = settlementLines(entry({ adjustment: -40, adjustmentNote: 'rounded' }));
  assert.deepEqual(adj[adj.length - 1], { key: 'adjustment', label: 'Adjusted: rounded', value: MINUS + '$40' });
});

test('the lines of a swap and a crossbook, and a row settled before the merge', () => {
  const sw = settlementLines(entry({ backerType: 'swap', resultBasis: 'cash', mode: 'swap', myResult: 9800, partnerResult: 4000, mineToThem: 490, theirsToMe: 200 }));
  assert.deepEqual(sw.map((l) => [l.label, l.value]), [['My cashes', '$9,800'], ['Their cashes', '$4,000'], ['Mine to them', '$490'], ['Theirs to me', '$200']]);
  const cb = settlementLines(entry({ backerType: 'crossbook', resultBasis: 'net', mode: 'bet', myResult: 5300, partnerResult: null, difference: 5300 }));
  assert.deepEqual(cb.map((l) => [l.label, l.value]), [['My net', '$5,300'], ['Their net', '—'], ['Difference', '+$5,300']]);
  const old = settlementLines(entry({ legacy: true, grossInvestment: 1000, grossReturn: 1200, markupAmount: 0 }));
  assert.deepEqual(old.map((l) => l.key), ['investment', 'return']);
});

test('the body sent to preview and settle: typed strings to numbers, blanks left out, a bad value reported', () => {
  const { body, errors } = inputsBody({
    7: { prepaid: '0', adjustment: '-0.50', note: ' rounding ' },
    8: { partner: '4,000' },
    9: { prepaid: '', adjustment: '' },
    10: { prepaid: 'abc' },
    11: { partner: '−500' },
  });
  assert.deepEqual(body, {
    prepaid: [{ agreementId: 7, amount: 0 }],
    adjustments: [{ agreementId: 7, amount: -0.5, note: 'rounding' }],
    partner: [{ agreementId: 8, amount: 4000 }, { agreementId: 11, amount: -500 }],
  });
  assert.deepEqual(errors, [10]);
  assert.deepEqual(inputsBody({}).body, {});
});

test('Finalize waits for the other player’s result on every swap and crossbook', () => {
  const data = { isSettled: false, settlements: [entry(), entry({ agreementId: 8, backerType: 'swap' }), entry({ agreementId: 9, backerType: 'crossbook' })] };
  assert.deepEqual(missingPartner(data, {}), [8, 9]);
  assert.deepEqual(missingPartner(data, { 8: { partner: '0' } }), [9]);
  assert.deepEqual(missingPartner(data, { 8: { partner: '0' }, 9: { partner: '-20' } }), []);
  assert.deepEqual(missingPartner({ ...data, isSettled: true }, {}), []);
});

test('the paid line names the bankroll and the signed ledger amount, or says there is none', () => {
  assert.equal(paidLine(entry({ id: 1 })), null);
  assert.deepEqual(paidLine(entry({ id: 1, isPaid: true, amountOwed: 300, paidAt: '2026-07-02T10:00:00Z', ledger: { amount: -300, date: '2026-07-02' } }), { name: 'Main', currency: 'USD' }),
    { text: 'Paid · 2026-07-02 · Main ' + MINUS + '$300' });
  assert.deepEqual(paidLine(entry({ id: 1, isPaid: true, amountOwed: 75, paidAt: '2026-01-02T00:00:00Z', ledger: null })),
    { text: 'Paid · 2026-01-02 · not in the ledger (marked before it was)' });
});

test('the totals line', () => {
  assert.equal(totalsLine({ currency: 'USD', totals: { toBackers: 400, toPlayer: 0 } }), 'You pay $400');
  assert.equal(totalsLine({ currency: 'USD', totals: { toBackers: 400, toPlayer: 120 } }), 'You pay $400 · backers pay you $120');
  assert.equal(totalsLine({ currency: 'USD', totals: { toBackers: 0, toPlayer: 120 } }), 'Backers pay you $120');
  assert.equal(totalsLine({ currency: 'USD', totals: { toBackers: 0, toPlayer: 0 } }), 'Nothing changes hands');
});
