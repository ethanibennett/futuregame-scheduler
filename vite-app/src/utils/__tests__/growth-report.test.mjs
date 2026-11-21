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

import { scorecardRows, spendLine } from '../growth-report.js';

test('scorecardRows: each figure as text, with its target, its status word and the cohort week', () => {
  const sc = {
    figures: [
      { key: 'newAccounts', week: '2027-01-18', value: 2, status: 'act', target: 190, act: 150 },
      { key: 'activation', week: '2027-01-04', value: 0.75, status: 'ok', target: 0.55, act: 0.4 },
      { key: 'savesPerActivated', week: '2027-01-04', value: 2.333, status: null },
      { key: 'costPerActivated', week: '2027-01-04', value: 1500, status: 'watch', target: 1200, act: 2000 },
      { key: 'd30', week: '2026-12-07', value: null, status: null, target: 0.12, act: 0.08 },
      { key: 'unknownFigure', week: '2027-01-04', value: 1 },
    ],
  };
  assert.deepEqual(scorecardRows(sc), [
    { key: 'newAccounts', label: 'New accounts', value: '2', target: '190 · act <150', status: 'act', statusWord: 'Act', week: 'Jan 18' },
    { key: 'activation', label: 'Activation (a save within 7 days)', value: '75%', target: '55% · act <40%', status: 'ok', statusWord: 'On target', week: 'Jan 4' },
    { key: 'savesPerActivated', label: 'Saves per activated account, first 7 days', value: '2.3', target: '', status: null, statusWord: '', week: 'Jan 4' },
    { key: 'costPerActivated', label: 'Cost per activated account (paid)', value: '$15', target: '$12 · act >$20', status: 'watch', statusWord: 'Watch', week: 'Jan 4' },
    { key: 'd30', label: 'D30 retention', value: '—', target: '12% · act <8%', status: null, statusWord: '', week: 'Dec 7' },
  ]);
  assert.deepEqual(scorecardRows(null), []);
});

test('spendLine: the week by channel, largest first, and the total', () => {
  assert.equal(spendLine({ spend: { channels: { apple: 1000, meta: 4550 }, totalCents: 5550 } }), 'Meta $45.50 · Apple Ads $10 · total $55.50');
  assert.equal(spendLine({ spend: { channels: {}, totalCents: 0 } }), '');
});
