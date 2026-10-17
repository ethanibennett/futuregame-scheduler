// node --test src/utils/__tests__/standing-ui.test.mjs  (from vite-app/)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseList, stakeWords, agreementView, toCreateBody, toStakesBody, correctionText, eventView, driftView, stateLine,
  tournamentPreviewQuery, cashPreviewQuery, toQueryString, confirmActions, toPaymentBody, paymentView,
} from '../standing-ui.js';

const formats = [{ key: 'all', label: 'Every game' }, { key: 'PLO', label: 'PLO' }, { key: 'NLH', label: 'NLH' }];
const raw = {
  formats, channels: ['any', 'live', 'online'],
  agreements: [{
    id: 3, backer: { id: 7, key: 'b7', name: 'Lee Park', link: '••••ve01', hasLink: true }, status: 'active', active: true,
    effectiveFrom: '2026-01-01', effectiveTo: null, openingCents: 12550, stakes: [{ id: 1, format: 'NLH', channel: 'live', pct: 25, validFrom: '2026-01-01', validTo: '2026-10-13', inForce: false }, { id: 2, format: 'NLH', channel: 'live', pct: 35, validFrom: '2026-10-14', validTo: null, inForce: true }],
    inForce: '35% NLH (live)', sharesCount: 2, sharesCents: 115000, runningCents: 127550, delivery: { sms: true, email: false },
  }, { id: 4, backer: { id: 9, name: '', hasLink: false }, status: 'ended', effectiveFrom: '2026-05-01', effectiveTo: '2026-06-30', stakes: [] }],
};

test('the list normalised: formats, a nameless backer, an ended agreement', () => {
  const l = normaliseList(raw);
  assert.equal(l.formats.length, 3);
  assert.equal(l.agreements[1].backer.name, 'Unnamed backer');
  assert.deepEqual([l.agreements[1].status, l.agreements[1].sharesCount, l.agreements[1].delivery], ['ended', 0, { sms: false, email: false }]);
  assert.deepEqual(normaliseList(null).formats, [{ key: 'all', label: 'Every game' }]);
});
test('a stake and an agreement in words', () => {
  assert.equal(stakeWords({ format: 'PLO', channel: 'any', pct: 20 }, formats), '20% PLO, live and online');
  assert.equal(stakeWords({ format: 'all', channel: 'online', pct: 12.5 }, formats), '12.5% every game, online');
  const v = agreementView(normaliseList(raw).agreements[0], { thisYear: 2026, today: '2026-10-14' });
  assert.deepEqual([v.name, v.status, v.stakes, v.money, v.running, v.runningTone, v.link, v.delivery],
    ['Lee Park', 'Since Jan 1', '35% NLH (live)', '2 shares · +$1,150 · opening +$126', '+$1,276', 'is-pos', 'Link ••••ve01', 'texts on']);
  const e = agreementView(normaliseList(raw).agreements[1], { thisYear: 2026, today: '2026-10-14' });
  assert.deepEqual([e.status, e.stakes, e.link, e.delivery], ['Ended Jun 30', 'No stakes in force', 'No link yet', 'no delivery set']);
  assert.equal(agreementView({ ...normaliseList(raw).agreements[0], active: false, effectiveFrom: '2026-12-01' }, { thisYear: 2026, today: '2026-10-14' }).status, 'Starts Dec 1');
});
test('the add form to a body: a new backer or an existing one; what it refuses', () => {
  assert.deepEqual(toCreateBody({ backerId: 'new', newName: ' New Backer ', newPhone: '+15555550199', effectiveFrom: '2026-10-01', openingCents: '125.5', stakes: [{ format: 'PLO', channel: 'any', pct: '15' }] }).body,
    { effectiveFrom: '2026-10-01', openingCents: 12550, stakes: [{ format: 'PLO', channel: 'any', pct: 15 }], newBacker: { name: 'New Backer', phone: '+15555550199' } });
  assert.deepEqual(toCreateBody({ backerId: '7', effectiveFrom: '2026-10-01', openingCents: '', stakes: [{ format: 'all', channel: 'live', pct: 5 }] }).body, { effectiveFrom: '2026-10-01', openingCents: 0, stakes: [{ format: 'all', channel: 'live', pct: 5 }], backerId: 7 });
  assert.equal(toCreateBody({ backerId: '7', effectiveFrom: '2026-10-01', stakes: [] }).error, 'Add at least one stake.');
  assert.equal(toCreateBody({ backerId: '7', effectiveFrom: '2026-10-01', stakes: [{ format: 'all', channel: 'any', pct: 0 }] }).error, 'Each stake needs a percentage above 0 and at most 100.');
  assert.equal(toCreateBody({ backerId: '7', effectiveFrom: '2026-10-01', stakes: [{ format: 'all', channel: 'any', pct: 5 }, { format: 'all', channel: 'any', pct: 6 }] }).error, 'Two stakes name the same game and channel.');
  assert.equal(toCreateBody({ backerId: '7', effectiveFrom: '', stakes: [{ format: 'all', channel: 'any', pct: 5 }] }).error, 'Pick the day the agreement starts.');
  assert.equal(toCreateBody({ backerId: 'new', newName: '', effectiveFrom: '2026-10-01', stakes: [{ format: 'all', channel: 'any', pct: 5 }] }).error, 'Name the backer.');
  assert.deepEqual(toStakesBody([{ format: 'NLH', channel: 'live', pct: 25 }], 'correct', true).body, { mode: 'correct', stakes: [{ format: 'NLH', channel: 'live', pct: 25 }], confirm: true });
  assert.equal(toStakesBody([{ format: 'NLH', channel: 'live', pct: 25 }], 'from-today').body.mode, 'from-today');
});
test('the correction preview, a share, a drift line, the state line', () => {
  assert.equal(correctionText({ count: 2, totalDeltaCents: -15500 }), '2 shares change: −$155 in all for this backer.');
  assert.equal(correctionText({ count: 1, totalDeltaCents: 500 }), '1 share changes: +$5 in all for this backer.');
  assert.equal(correctionText({ count: 0 }), 'No recorded share changes.');
  const e = eventView({ refTable: 'tracking_entries', refId: 12, source: 'ledger', date: '2026-10-10', game: 'NLH MTT', venue: 'Borgata', resultCents: 240000, pct: 30, shareCents: 72000, sentShareCents: 54000, revisions: [{}, {}] }, { thisYear: 2026 });
  assert.deepEqual([e.when, e.what, e.detail, e.share, e.shareTone, e.canExclude, e.revisions], ['Oct 10', 'NLH MTT · Borgata', '30% of +$2,400 · told +$540', '+$720', 'is-pos', true, 2]);
  const d = eventView({ source: 'dashboard', date: '2026-09-05', game: 'PLO MTT', resultCents: -40000, pct: 20, shareCents: -8000 }, { thisYear: 2026 });
  assert.deepEqual([d.detail, d.dashboard, d.canExclude], ['20% of −$400 · from the dashboard', true, false]);
  assert.equal(driftView({ refTable: 'tracking_entries', refId: 12, key: 'b7', name: 'Sam', date: '2026-10-10', game: 'NLH MTT', shareCents: 24000, freshShareCents: 22000, action: 'revise' }, { thisYear: 2026 }).text, 'Oct 10 · NLH MTT · Sam: +$240 → +$220');
  assert.equal(driftView({ refTable: 'cash_sessions', refId: 1, date: '2026-10-08', game: '2/5 NLH', shareCents: 7000, action: 'void' }, { thisYear: 2026 }).text, 'Oct 8 · 2/5 NLH · a backer: +$70 → removed');
  assert.equal(stateLine({ posting: 'off', cutover: 'none' }), 'Posting is off: Notify is refused until you turn it on.');
  assert.equal(stateLine({ posting: null, cutover: 'live' }), 'Posting is on (unset). Cutover live: this app owns the backers.');
});
test('the preview queries for unsaved results', () => {
  const t = { id: 5, date: '2026-10-20', game_variant: 'NLH', is_online: 0, buyin: 600 };
  assert.deepEqual(tournamentPreviewQuery({ tournament: t, numEntries: '2', cashed: true, cashAmount: '3000', currency: 'USD' }),
    { kind: 'tournament', date: '2026-10-20', game: 'NLH', online: '0', resultCents: '180000', currency: 'USD', tournamentId: '5' });
  assert.equal(tournamentPreviewQuery({ tournament: t, numEntries: 1, cashed: false }).resultCents, '-60000');
  assert.equal(tournamentPreviewQuery({ tournament: null }), null);
  assert.deepEqual(cashPreviewQuery({ date: '2026-10-08', room: 'Parx', game: 'NLH', buyIn: '1000', cashOut: '1800', tips: '40', expenses: '60' }),
    { kind: 'cash', date: '2026-10-08', game: 'NLH', room: 'Parx', resultCents: '70000', currency: 'USD' });
  assert.equal(cashPreviewQuery({ cashOut: '' }), null);
  assert.equal(toQueryString({ a: 'x y', b: '', c: '1' }), 'a=x%20y&c=1');
});
test('a payout: the body and the line; the agreement\'s money line names what was paid', () => {
  assert.deepEqual(toPaymentBody({ amount: '$1,500', direction: 'out', paidOn: '2026-10-14', note: ' cash ' }).body, { amountCents: 150000, paidOn: '2026-10-14', note: 'cash' });
  assert.deepEqual(toPaymentBody({ amount: '200', direction: 'in' }).body, { amountCents: -20000 });
  assert.equal(toPaymentBody({ amount: '0' }).error, 'Enter how much changed hands.');
  assert.equal(toPaymentBody({ amount: '12.50' }).error, 'A payout is in whole dollars.');
  assert.deepEqual(paymentView({ id: 1, amountCents: 150000, paidOn: '2026-10-14', note: 'cash' }, { thisYear: 2026 }), { key: 1, when: 'Oct 14', what: 'You paid · cash', amount: '−$1,500', tone: 'is-neg' });
  assert.equal(paymentView({ id: 2, amountCents: -20000, paidOn: '2026-10-01' }, { thisYear: 2026 }).what, 'They paid you');
  const a = normaliseList({ agreements: [{ ...raw.agreements[0], paidCents: 50000 }] }).agreements[0];
  assert.equal(agreementView(a, { thisYear: 2026, today: '2026-10-14' }).money, '2 shares · +$1,150 · opening +$126 · paid −$500');
});
test('the Q7 ask: a series overlap offers Both or Series only; a dashboard night offers Send anyway', () => {
  const s = confirmActions({ key: 'b7', warnings: [{ kind: 'series', series: ['Fall'] }] });
  assert.deepEqual(s.map((a) => [a.label, a.body]), [['Both', { confirm: true, answers: { b7: 'standing' } }], ['Series only', { answers: { b7: 'series' } }]]);
  assert.deepEqual(confirmActions({ key: 'r1', warnings: [{ kind: 'dashboard' }] }).map((a) => a.label), ['Send anyway']);
});
