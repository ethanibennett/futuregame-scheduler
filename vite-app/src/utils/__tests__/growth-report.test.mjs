import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growthRows, topSources, weekLabel } from '../growth-report.js';

const REPORT = {
  weeks: [
    { week: '2026-12-21', signups: 1, activated7: 0, d7: 0, d30: 0, d7Ready: 0, d30Ready: 0, sources: { reddit: 1 } },
    { week: '2026-11-09', signups: 3, activated7: 1, d7: 1, d30: 1, d7Ready: 3, d30Ready: 3, sources: { 'meta-m1': 1, friend: 1, unknown: 1 } },
  ],
  totals: { signups: 4, sources: { 'meta-m1': 1, friend: 1, unknown: 1, reddit: 1 } },
};

test('growthRows: percentages, and a dash until a week is old enough', () => {
  assert.deepEqual(growthRows(REPORT), [
    { key: '2026-12-21', week: 'Dec 21', signups: '1', activated: '0%', d7: '—', d30: '—' },
    { key: '2026-11-09', week: 'Nov 9', signups: '3', activated: '33%', d7: '33%', d30: '33%' },
  ]);
  assert.deepEqual(growthRows(null), []);
});

test('topSources: most first, ties by name', () => {
  assert.equal(topSources(REPORT), 'friend 1 · meta-m1 1 · reddit 1 · unknown 1');
  assert.equal(topSources({}), '');
  assert.equal(weekLabel('2026-10-12'), 'Oct 12');
});

test('firstWeekLine: the first-week rates and saves per activated account', async () => {
  const { firstWeekLine } = await import('../growth-report.js');
  assert.equal(firstWeekLine({ totals: { signups: 0 } }), '');
  assert.equal(firstWeekLine({ totals: { signups: 4, activated7: 2, savesFirst7: 7, onboarded7: 3, results7: 1, shared7: 1, followed7: 0 } }),
    'First week: set up 75% · logged a result 25% · shared 25% · sent a buddy request 0% · 3.5 saves per activated account');
});
