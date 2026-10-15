// node --test src/utils/__tests__/bankroll-import-dashboard.test.mjs  (from vite-app/)
// The dashboard import's review (utils/bankroll-import-dashboard.js; docs/bankroll-merge.md §9.3,
// Phase 6): the pure parts of BankrollImportDashboard.jsx on plans shaped like
// GET /api/bankrolls/import/dashboard/:runId. Every name and figure is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtMoney, resultWords, toneOf, fmtDay, fmtWhen, fmtHours, plural, MINUS,
  currentRuns, runLine, mergePatch, isEmptyPatch, applyPatch, fillLikely, pairOptions, pairFields,
  groupPlan, backerOptions, slateOptions, sourceLabel, optionWord, itemLine,
  commitReadiness, reconciliationBlocks, REC_LINES, writesList, tableLabel, editedRows,
  fetchError, commitError, undoError, diffPlans, pageOf, FIRST_ROWS,
} from '../bankroll-import-dashboard.js';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
const pair = (id, o = {}) => ({
  id, kind: 'cash', class: 'likely', score: 8, decision: null, canTake: true, takeWhy: null,
  parts: { date: 3, room: 3, amount: 3, other: 1 },
  dash: { date: '2026-07-10', room: 'Wynn', game: '2/5 NLH', in: 200, out: 500, result: 300, hours: 5 },
  here: { date: '2026-07-10', room: 'Wynn', game: '2/5 NLH', in: 200, out: 500, result: 300, hours: 5 },
  same: { date: true, room: true, game: true, in: true, out: true, result: true, hours: true },
  ...o,
});
const backer = (fp, o = {}) => ({
  fp, status: 'new', name: 'Sam Lee', token: '••••ok01', stakes: '20% PLO', openingCents: 12550, delivery: { sms: false, email: true },
  source: 'roster', agreement: 'active', matches: [], default: 'new', choice: null, ...o,
});
const rec = (o = {}) => ({
  dashboard: { roll: 5000, fund: 1000 }, before: { roll: 1200, fund: 0 }, after: { roll: 5000, fund: 1000 },
  lines: { roll: { difference: 3800, opening: 3000, onlyHere: 800 }, fund: { difference: 1000, opening: 1000 } },
  unexplained: { roll: 0, fund: 0 }, fundWithinRemainder: true, lists: { onlyHere: [{ date: '2026-08-01', label: 'Aria', amount: 800 }] },
  ...o,
});
const plan = (o = {}) => ({
  planHash: 'abc', mode: 'full', undecided: 2,
  pairs: [pair('p1'), pair('p2', { class: 'possible', score: 5, kind: 'deposit', dash: { date: '2026-05-03', kind: 'deposit', amount: 500 }, here: { date: '2026-05-04', kind: 'deposit', amount: 500 }, same: { amount: true }, parts: { date: 2, amount: 4 } })],
  backers: [backer('b1'), backer('b2', { name: 'Lee Park', matches: [{ backerId: 7, name: 'Lee Park' }] }), backer('b3', { status: 'unchanged' }), backer('b4', { status: 'error', error: 'two backers share a link' })],
  slate: { deals: [{ fp: 'd1', event: 'Event 5', pctSold: 30, markup: '1.1', buyIn: 1500, backer: 'Sam Lee', status: 'new', settled: false }], backers: [{ key: 'Sam Lee', name: 'Sam Lee', options: ['new', 'roster:b1'], choice: 'roster:b1' }], unlinkedSettlements: [] },
  balances: [{ fp: 'l1', name: 'Safe', amount: 2000, status: 'new' }],
  changes: [], deletions: [],
  opening: { amount: 3000, date: '2026-03-01', kind: 'deposit', override: false, computed: { amount: 3000.4, date: '2026-03-01', startingRoll: 4200, priorBalance: 1200, parts: { starts: 1200, moved: 0, results: 0 } } },
  target: { bankroll: 'main', name: 'Main' }, fund: { create: true },
  reconciliation: rec(),
  counts: { sessions: { new: 4, toReview: 2 }, backers: { new: 2, toReview: 1 } },
  writes: { rows: 31, same: 1, taken: 0, fundCreated: true, tables: { insert: { cash_sessions: 4, bankroll_import_keys: 9, backers: 2 }, update: {}, delete: {} } },
  errors: [], blocking: [], flags: { signs: [], otherExpenses: { count: 0, total: 0, items: [] }, onlineRoomsUnknown: [], rows: [] },
  ...o,
});

// ── formatting ──────────────────────────────────────────────────────────────────────────────
test('money: whole dollars without cents, cents when there are any, a true minus, + on request', () => {
  assert.equal(fmtMoney(1234), '$1,234');
  assert.equal(fmtMoney(449.85), '$449.85');
  assert.equal(fmtMoney(-37.4), `${MINUS}$37.40`);
  assert.equal(fmtMoney(0), '$0');
  assert.equal(fmtMoney(-0.004), '$0');
  assert.equal(fmtMoney(800, { sign: true }), '+$800');
  assert.equal(fmtMoney(-800, { sign: true }), `${MINUS}$800`);
  assert.equal(fmtMoney('x'), '—');
});
test('a result in words as well as colour', () => {
  assert.equal(resultWords(800), '+$800 won');
  assert.equal(resultWords(-1200), `${MINUS}$1,200 lost`);
  assert.equal(resultWords(0), '$0 even');
  assert.deepEqual([toneOf(1), toneOf(-1), toneOf(0.004)], ['pos', 'neg', '']);
});
test('days, times and hours', () => {
  assert.equal(fmtDay('2026-03-05'), 'Mar 5, 2026');
  assert.equal(fmtDay('2026-03-05T12:00:00Z'), 'Mar 5, 2026');
  assert.equal(fmtDay(null), '—');
  assert.equal(fmtWhen('2026-10-14T19:05:00Z', 'America/New_York'), 'Oct 14, 2026, 3:05 PM');
  assert.equal(fmtWhen('nope'), '—');
  assert.deepEqual([fmtHours(5), fmtHours(2.333), fmtHours(null)], ['5 h', '2.33 h', '—']);
  assert.deepEqual([plural(1, 'pair'), plural(2, 'pair'), plural(1200, 'row'), plural(1, 'row has', 'rows have')], ['1 pair', '2 pairs', '1,200 rows', '1 row has']);
});

// ── runs ────────────────────────────────────────────────────────────────────────────────────
test('the run in review and the newest committed one; a run as a line', () => {
  const runs = [
    { id: 3, status: 'staged', mode: 'delta', fetchedAt: '2026-10-14T19:05:00Z', undecided: 2 },
    { id: 2, status: 'committed', mode: 'full', committedAt: '2026-10-13T19:05:00Z', undoCount: 131 },
    { id: 1, status: 'undone', undoneAt: '2026-10-12T19:05:00Z' },
  ];
  const c = currentRuns(runs);
  assert.deepEqual([c.staged.id, c.committed.id], [3, 2]);
  assert.deepEqual(currentRuns(null), { staged: null, committed: null });
  const tz = 'America/New_York';
  assert.deepEqual(runLine(runs[0], tz), { id: 3, title: '#3 In review (changes)', detail: '2 pairs to answer', status: 'staged' });
  assert.deepEqual(runLine(runs[1], tz), { id: 2, title: '#2 Imported', detail: '131 rows · Oct 13, 2026, 3:05 PM', status: 'committed' });
  assert.equal(runLine(runs[2], tz).detail, 'undone Oct 12, 2026, 3:05 PM');
});

// ── answers ─────────────────────────────────────────────────────────────────────────────────
test('two batches of answers merge map by map; the whole opening is replaced; null clears', () => {
  const m = mergePatch({ pairs: { p1: 'same-keep', p2: 'different' }, opening: { amount: 10, date: '2026-01-01' } }, { pairs: { p2: null }, opening: null, target: 'fund' });
  assert.deepEqual(m, { pairs: { p1: 'same-keep', p2: null }, opening: null, target: 'fund' });
  assert.equal(isEmptyPatch(null), true);
  assert.equal(isEmptyPatch({ pairs: {} }), true);
  assert.equal(isEmptyPatch({ pairs: { p1: null } }), false);
  assert.equal(isEmptyPatch({ opening: null }), false);
});
test('the plan as it reads with unsaved answers: decisions, the opening and its kind, undecided recounted; no figure touched', () => {
  const p = plan();
  const v = applyPatch(p, { pairs: { p1: 'same-keep' }, backers: { b2: 7 }, slate: { 'Sam Lee': 'new' }, opening: { amount: -250, date: '' } });
  assert.equal(v.pairs[0].decision, 'same-keep');
  assert.equal(v.pairs[1].decision, null);
  assert.equal(v.undecided, 1);
  assert.equal(v.backers[1].choice, 7);
  assert.equal(v.slate.backers[0].choice, 'new');
  assert.deepEqual([v.opening.amount, v.opening.date, v.opening.override, v.opening.kind], [-250, '2026-03-01', true, 'withdrawal']);
  assert.equal(v.reconciliation, p.reconciliation, 'the figures are the server\'s');
  const back = applyPatch(p, { opening: null });
  assert.deepEqual([back.opening.amount, back.opening.override, back.opening.kind], [3000, false, 'deposit']);
  assert.equal(applyPatch(p, {}), p);
});
test('"Fill the likely ones": only unanswered Likely pairs, as Same keep; nothing to fill is null', () => {
  const p = plan({ pairs: [pair('a'), pair('b', { decision: 'different' }), pair('c', { class: 'possible' })] });
  assert.deepEqual(fillLikely(p), { pairs: { a: 'same-keep' } });
  assert.equal(fillLikely(plan({ pairs: [pair('c', { class: 'possible' })] })), null);
});
test('a pair\'s answers worded for its kind, Take off where the server says so', () => {
  const o = pairOptions(pair('x', { canTake: false, takeWhy: 'the row here is not yours' }));
  assert.deepEqual(o.map((x) => [x.value, x.top, x.disabled]), [['same-keep', 'Same night', false], ['same-take', 'Same night', true], ['different', 'Different', false]]);
  assert.equal(o[1].why, 'the row here is not yours');
  assert.equal(pairOptions({ kind: 'deposit', canTake: true })[0].top, 'Same deposit');
  assert.equal(pairOptions({ kind: 'expense', canTake: true })[0].top, 'Same expense');
});
test('a pair\'s fields, both sides, with the same marks and tones', () => {
  const f = pairFields(pair('x', { here: { date: '2026-07-10', room: 'Wynn', game: '2/5 NLH', in: 200, out: 650, result: 450, hours: 5 }, same: { date: true, room: true, game: true, in: true, hours: true } }));
  assert.deepEqual(f.map((x) => x.key), ['date', 'room', 'game', 'in', 'result', 'hours']);
  assert.deepEqual(f.map((x) => x.same), [true, true, true, false, false, true]);
  assert.equal(f[3].dash, '$200 → $500');
  assert.deepEqual([f[4].dash, f[4].here, f[4].dashTone, f[4].hereTone], ['+$300 won', '+$450 won', 'pos', 'pos']);
  const d = pairFields({ kind: 'deposit', dash: { date: '2026-05-03', kind: 'deposit', amount: 500 }, here: { date: '2026-05-04', kind: 'deposit', amount: 500 }, same: { amount: true } });
  assert.deepEqual(d.map((x) => [x.key, x.same]), [['date', false], ['kind', false], ['amount', true], ['note', false]]);
  assert.deepEqual([d[1].dash, d[2].dash, d[3].dash], ['Deposit', '+$500', '—']);
  const e = pairFields({ kind: 'expense', dash: { date: '2026-05-03', category: 'travel', amount: 120.5, note: 'train' }, here: {}, same: {} });
  assert.deepEqual([e[1].dash, e[2].dash, e[3].dash, e[2].here], ['travel', '$120.50', 'train', '—']);
});

// ── grouping ────────────────────────────────────────────────────────────────────────────────
test('the review\'s sections: pairs Likely first then by score, backers split by status, counts in their fixed order', () => {
  const p = plan({ pairs: [pair('low', { class: 'possible', score: 5 }), pair('hi', { score: 9 }), pair('mid', { score: 7, decision: 'same-keep' })] });
  const g = groupPlan(p);
  assert.deepEqual(g.pairs.list.map((x) => x.id), ['hi', 'mid', 'low']);
  assert.deepEqual([g.pairs.likely, g.pairs.possible, g.pairs.answered, g.pairs.fillable], [2, 1, 1, 1]);
  assert.deepEqual(g.backers.review.map((b) => b.fp), ['b1', 'b2']);
  assert.deepEqual(g.backers.other.map((b) => b.fp), ['b3', 'b4']);
  assert.deepEqual(g.counts, [{ key: 'sessions', label: 'Cash sessions', new: 4, toReview: 2, unchanged: 0 }, { key: 'backers', label: 'Backers', new: 2, toReview: 1, unchanged: 0 }]);
  assert.equal(g.info.flags.signs.length, 0);
  assert.equal(g.opening, p.opening);
});
test('changes and deletions grouped by what they are', () => {
  const g = groupPlan(plan({
    changes: [{ itemId: 'c1', store: 'sessions', cat: 'sessions' }, { itemId: 'c2', store: 'backers', cat: 'backer' }, { itemId: 'c3', store: 'sessions', cat: 'sessions' }],
    deletions: [{ itemId: 'd1', store: 'wsop-balances' }],
  }));
  assert.deepEqual(g.changes.map((x) => [x.label, x.items.length]), [['Results', 2], ['Backers', 1]]);
  assert.deepEqual(g.deletions.map((x) => [x.label, x.items.length]), [['Balances', 1]]);
});
test('a backer\'s choices: New, Same as a name match; a link already owned is locked to its owner', () => {
  assert.deepEqual(backerOptions(backer('b1')), { options: [{ value: 'new', label: 'New backer' }], value: 'new', locked: false });
  const m = backerOptions(backer('b2', { matches: [{ backerId: 7, name: 'Lee Park' }], choice: 7 }));
  assert.deepEqual(m.options.map((o) => o.label), ['New backer', 'Same as Lee Park']);
  assert.deepEqual([m.value, m.locked], ['7', false]);
  const owned = backerOptions(backer('b5', { default: 12 }));
  assert.deepEqual([owned.locked, owned.options.at(-1).label], [true, 'Already yours (this link)']);
  assert.deepEqual([sourceLabel('roster'), sourceLabel('deleted-in-dashboard'), sourceLabel('history-only'), sourceLabel('?')], ['Live in the dashboard', 'Deleted in the dashboard', 'History only', 'Dashboard']);
});
test('a slate backer\'s choices worded, the current answer kept even when the server no longer offers it', () => {
  const p = plan();
  const s = slateOptions({ key: 'Sam Lee', name: 'Sam Lee', options: ['new', 'roster:b1', '9'], choice: 'key:4' }, p);
  assert.deepEqual(s.options.map((o) => o.label), ['New staking backer', 'Sam Lee (from the dashboard)', 'Your staking backer Sam Lee', 'The one an earlier import made']);
  assert.equal(s.value, 'key:4');
  assert.deepEqual(['apply', 'keep', 'remove', 'end', 'odd'].map(optionWord), ['Apply', 'Keep mine', 'Remove', 'End it', 'odd']);
});
test('what a change or a deletion names', () => {
  assert.deepEqual(itemLine({ store: 'backers', to: { name: 'Sam Lee', stakes: '20% PLO', openingCents: 12550 } }), { title: 'Sam Lee', detail: '20% PLO · opening +$125.50' });
  assert.deepEqual(itemLine({ store: 'sessions', to: { date: '2026-07-10', room: 'Wynn', game: '2/5 NLH', result: 450 } }), { title: 'Jul 10, 2026 · 2/5 NLH', detail: 'Wynn · +$450 won' });
  assert.deepEqual(itemLine({ store: 'adjustments', to: { date: '2026-05-03', type: 'Deposit', amount: 500 } }), { title: 'May 3, 2026 · Deposit', detail: '+$500' });
  assert.deepEqual(itemLine({ store: 'sessions', id: 's-9', was: { date: '2026-07-10', label: '2/5 NLH at Wynn', amount: -80 } }), { title: 'Jul 10, 2026 · 2/5 NLH at Wynn', detail: `${MINUS}$80` });
  assert.deepEqual(itemLine({ store: 'wsop-balances', to: { money_locations: { name: 'Safe', amount: 2000 } } }), { title: 'Safe', detail: '$2,000' });
  assert.deepEqual(itemLine({ store: 'wsop-admin-taxrate', to: { value: 30 } }), { title: 'Tax set-aside', detail: '30%' });
  assert.deepEqual(itemLine({ store: 'sessions', id: 's-1' }), { title: 'sessions s-1', detail: '' });
});

// ── readiness ───────────────────────────────────────────────────────────────────────────────
test('the import can go only with every pair answered, nothing blocking, the reconciliation balanced and no answer in flight', () => {
  const r0 = commitReadiness(plan());
  assert.deepEqual([r0.ok, r0.reasons, r0.undecided, r0.label], [false, ['2 pairs still to answer.'], 2, 'Import 31 records']);
  const answered = plan({ pairs: [pair('p1', { decision: 'same-keep' })] });
  assert.equal(commitReadiness(answered).ok, true);
  assert.deepEqual(commitReadiness(answered, { pending: true }), { ...commitReadiness(answered), ok: false, waiting: true });
  const blocked = commitReadiness(plan({ pairs: [], blocking: ['Two dashboard backers share a link.'] }));
  assert.deepEqual([blocked.ok, blocked.reasons], [false, ['Two dashboard backers share a link.']]);
  const off = commitReadiness(plan({ pairs: [], reconciliation: rec({ unexplained: { roll: 12.5, fund: 0 } }) }));
  assert.deepEqual([off.ok, off.reasons], [false, ['The reconciliation does not balance: $12.50 on the roll and $0 on the fund are unexplained.']]);
  const fund = commitReadiness(plan({ pairs: [], reconciliation: rec({ fundWithinRemainder: false }) }));
  assert.deepEqual(fund.reasons, ['The fund does not match the dashboard’s within its rounding remainder.']);
  assert.deepEqual(commitReadiness(null).reasons, ['There is nothing to import yet.']);
  assert.equal(reconciliationBlocks(rec()), false);
  assert.equal(reconciliationBlocks(rec({ unexplained: { roll: 0, fund: 0.01 } })), true);
  assert.equal(reconciliationBlocks(rec({ fundWithinRemainder: false })), true);
  assert.equal(REC_LINES[0][0], 'opening');
});

// ── what is written ─────────────────────────────────────────────────────────────────────────
test('the per-table counts as lines in a fixed order, worded; an unknown table by its name', () => {
  const w = writesList({ insert: { bankroll_import_keys: 9, cash_sessions: 4, backers: 2, odd_table: 1 }, update: { cash_sessions: 1 }, delete: {} });
  assert.deepEqual(w.insert.map((x) => x.text), ['4 cash sessions', '2 staking backers', '9 import keys', '1 odd table']);
  assert.deepEqual(w.update.map((x) => x.text), ['1 cash session']);
  assert.deepEqual([w.delete, w.created], [[], 16]);
  assert.deepEqual(writesList(null), { insert: [], update: [], delete: [], created: 0 });
  assert.deepEqual([tableLabel('staking_series', 1), tableLabel('staking_series', 2), tableLabel('bankrolls', 1), tableLabel('session_extras', 3)], ['1 staking series', '2 staking series', '1 bankroll (the WSOP fund)', '3 result details']);
});
test('an undo\'s refusal: each edited row with where it lives and, for a result, the Results entry to open', () => {
  const rows = editedRows([{ table: 'cash_sessions', id: 41, why: 'edited since the import' }, { table: 'backers', id: 3 }, { table: 'money_settings' }]);
  assert.deepEqual(rows[0], { key: 'cash_sessions:41', label: 'Cash session #41', where: 'Results › Cash', why: 'edited since the import', open: { kind: 'cash', id: 41 } });
  assert.deepEqual([rows[1].label, rows[1].where, rows[1].open, rows[1].why], ['Staking backer #3', 'Staking', null, 'edited since the import']);
  assert.deepEqual([rows[2].key, rows[2].label], ['money_settings:2', 'Money settings']);
  assert.deepEqual(editedRows(null), []);
});

// ── refusals ────────────────────────────────────────────────────────────────────────────────
test('the server\'s refusals as sentences', () => {
  assert.equal(fetchError(503, { error: 'LEDGER_TOKEN is not set.' }), 'LEDGER_TOKEN is not set. Nothing was fetched.');
  assert.equal(fetchError(502, { error: 'the export failed its checks.' }), 'The dashboard did not hand over a usable export (the export failed its checks). Nothing was staged.');
  assert.match(fetchError(504, {}), /did not answer in time/);
  assert.equal(fetchError(409, {}), 'A pull is already running. Wait for it to finish, then look again.');
  assert.equal(fetchError(403, {}), 'Only the account that owns the dashboard can import from it.');
  assert.equal(fetchError(0, {}), 'The server could not be reached. Nothing was fetched.');
  assert.deepEqual(commitError(409, { stale: true }), { kind: 'stale', text: 'The plan changed; review the highlighted items.' });
  assert.deepEqual(commitError(409, { undecided: 3 }), { kind: 'undecided', text: '3 pairs still to answer.' });
  assert.deepEqual(commitError(409, { blocking: ['x'], error: 'Two backers share a link.' }), { kind: 'blocking', text: 'Two backers share a link.' });
  assert.equal(commitError(410, {}).kind, 'gone');
  assert.equal(commitError(500, {}).text, 'Something went wrong. Nothing was written.');
  const u = undoError(409, { edited: [{ table: 'cash_sessions', id: 41 }] });
  assert.equal(u.kind, 'edited');
  assert.match(u.text, /^1 row has been changed since the import/);
  assert.equal(u.rows[0].label, 'Cash session #41');
  assert.deepEqual(undoError(409, { expect: 130 }).expect, 130);
  assert.deepEqual([undoError(409, { later: 5 }).kind, undoError(409, { later: 5 }).text], ['later', 'Undo the later import (#5) first.']);
  assert.equal(undoError(0, {}).text, 'The server could not be reached. Nothing was undone.');
});

// ── a stale plan ────────────────────────────────────────────────────────────────────────────
test('what moved between two plans: an item whose facts changed, a new item, the opening, the reconciliation; answers do not count', () => {
  const a = plan();
  const b = plan({
    pairs: [pair('p1', { decision: 'same-keep' }), pair('p2', { class: 'possible', score: 6, kind: 'deposit', dash: { date: '2026-05-03', kind: 'deposit', amount: 500 }, here: { date: '2026-05-04', kind: 'deposit', amount: 500 }, same: { amount: true } }), pair('p3')],
    reconciliation: rec({ before: { roll: 1325, fund: 0 } }),
    opening: { ...a.opening, computed: { ...a.opening.computed, amount: 2875.4 } },
  });
  const d = diffPlans(a, b);
  assert.deepEqual([...d].sort(), ['opening', 'pair:p2', 'pair:p3', 'reconciliation']);
  assert.equal(diffPlans(a, plan()).size, 0);
  assert.equal(diffPlans(null, b).size, 0);
  const c = plan({ backers: [backer('b1', { stakes: '25% PLO' })], counts: { sessions: { new: 5 } }, writes: { ...a.writes, rows: 32 } });
  assert.deepEqual([...diffPlans(a, c)].sort(), ['backer:b1', 'counts', 'writes']);
});

// ── paging ──────────────────────────────────────────────────────────────────────────────────
test('the pager: ten, then fifty more a tap', () => {
  assert.equal(pageOf(FIRST_ROWS, 5).rows, 5);
  const pg = pageOf(FIRST_ROWS, 80);
  assert.equal(pg.rows, FIRST_ROWS);
  assert.ok(pg.more && pg.more.next > FIRST_ROWS);
});
