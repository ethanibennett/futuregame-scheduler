// node --test src/utils/__tests__/reset-results.test.mjs   (from vite-app/; or `npm run test:home`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetScope, resetPhrase, phraseMatches, resetPath, resetSummary } from '../reset-results.js';

const bankrolls = [{ id: 'main', name: 'Main' }, { id: 7, name: 'Staked' }];

test('scope follows the selected bankroll; All is the only unscoped ask', () => {
  assert.deepEqual(resetScope(7, { bankrolls, enabled: true }), { key: 7, query: 'bankroll=7', name: 'Staked' });
  assert.deepEqual(resetScope('7', { bankrolls, enabled: true }), { key: 7, query: 'bankroll=7', name: 'Staked' });
  assert.deepEqual(resetScope('main', { bankrolls, enabled: true }), { key: 'main', query: 'bankroll=main', name: 'Main' });
  assert.deepEqual(resetScope('all', { bankrolls, enabled: true }), { key: 'all', query: 'all=true', name: 'every bankroll' });
  // Outside the beta there is no switcher and one pot.
  assert.deepEqual(resetScope(7, { bankrolls, enabled: false }), { key: 'all', query: 'all=true', name: null });
  // A bankroll the list does not know (yet) is still scoped, never widened to all.
  assert.equal(resetScope(9, { bankrolls, enabled: true }).query, 'bankroll=9');
});

test('the phrase names the exact count', () => {
  assert.equal(resetPhrase(214), 'DELETE 214 RESULTS');
  assert.equal(resetPhrase(1), 'DELETE 1 RESULT');
  assert.equal(resetPhrase(1234), 'DELETE 1234 RESULTS');
});

test('typing: case, spaces and a thousands comma forgiven; the number is not', () => {
  const p = resetPhrase(214);
  assert.ok(phraseMatches('DELETE 214 RESULTS', p));
  assert.ok(phraseMatches('  delete   214 results ', p));
  assert.ok(!phraseMatches('DELETE 213 RESULTS', p));
  assert.ok(!phraseMatches('DELETE RESULTS', p));
  assert.ok(!phraseMatches('', p));
  assert.ok(phraseMatches('delete 1,234 results', resetPhrase(1234)));
  assert.ok(!phraseMatches('DELETE 214 RESULTS', ''));
});

test('the request carries the scope and the count it showed', () => {
  assert.equal(resetPath(resetScope(7, { bankrolls, enabled: true }), 214), '/tracking?bankroll=7&expect=214');
  assert.equal(resetPath(resetScope('all', { enabled: true }), 3), '/tracking?all=true&expect=3');
  assert.equal(resetPath(resetScope('main', { enabled: true }), 0), '/tracking?bankroll=main&expect=0');
});

test('the sentence says how many, from where, how many were imported, and what stays', () => {
  const staked = resetScope(7, { bankrolls, enabled: true });
  assert.equal(resetSummary(214, staked, 120),
    'Deletes the 214 tournament results in Staked, 120 of them imported. Other bankrolls, cash sessions, expenses and deposits stay. This cannot be undone.');
  assert.equal(resetSummary(1214, resetScope('all', { enabled: true }), 0),
    'Deletes all 1,214 tournament results in every bankroll. Cash sessions, expenses and deposits stay. This cannot be undone.');
  assert.equal(resetSummary(3, resetScope('x', { enabled: false }), 3),
    'Deletes all 3 of your tournament results, all of them imported. This cannot be undone.');
  assert.equal(resetSummary(1, resetScope('main', { enabled: true }), 0),
    'Deletes the 1 tournament result in Main. Other bankrolls, cash sessions, expenses and deposits stay. This cannot be undone.');
});
