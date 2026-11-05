'use strict';
// The sign-in screen's date range against the Schedule header's: the server's copy of the wording
// (lib/season-label.js) and the client's (vite-app/src/utils/season-label.js) must never drift.
const assert = require('node:assert');
const { test } = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const server = require('../lib/season-label');

const client = () => import(pathToFileURL(path.join(__dirname, '..', 'vite-app', 'src', 'utils', 'season-label.js')).href);

const CASES = [
  [[], '2026-11-04'],
  [['2026-01-01'], '2026-11-04'],
  [['2026-11-04'], '2026-11-04'],
  [['2026-11-03', '2026-11-04'], '2026-11-04'],
  [['2026-11-04', '2027-03-20'], '2026-11-04'],
  [['2026-08-01', '2026-11-30', '2026-09-09'], '2026-08-01'],
  [['2026-12-31', '2027-02-01'], '2026-12-01'],
  [['', null, undefined, '2026-12-05'], '2026-12-01'],
  [['2026-13-40'], '2026-01-01'],
];

test('the two copies word every case the same', async () => {
  const c = await client();
  for (const [days, today] of CASES) {
    assert.strictEqual(server.seasonLabelOf(days, today), c.seasonLabelOf(days, today), JSON.stringify([days, today]));
  }
});

test('the wording', () => {
  assert.strictEqual(server.seasonLabelOf(['2026-08-02'], '2026-08-01'), 'aug 2026');
  assert.strictEqual(server.seasonLabelOf(['2026-08-02', '2026-11-30'], '2026-08-01'), 'aug-nov 2026');
  assert.strictEqual(server.seasonLabelOf(['2026-11-04', '2027-03-20'], '2026-11-04'), 'nov 2026-mar 2027');
  assert.strictEqual(server.seasonLabelOf(['2026-01-01'], '2026-11-04'), '');
});

test('stored dates are read as the client reads them', () => {
  assert.strictEqual(server.isoDay('November 4, 2026'), '2026-11-04');
  assert.strictEqual(server.isoDay('2026-11-04T10:00'), '2026-11-04');
  assert.strictEqual(server.isoDay('TBD'), '');
  assert.strictEqual(server.isoDay(null), '');
});

test("today is New York's, not the server's UTC date", () => {
  assert.strictEqual(server.todayEastern(new Date('2026-12-01T02:00:00Z')), '2026-11-30');
  assert.strictEqual(server.todayEastern(new Date('2026-12-01T06:00:00Z')), '2026-12-01');
});

test('the rows: hidden ids are left out, past and unreadable dates ignored', () => {
  const rows = [[1, 'November 10, 2026'], [2, 'January 5, 2027'], [3, 'March 20, 2027'], [4, 'March 1, 2026'], [5, 'TBD']];
  const db = { exec: (sql) => { assert.match(sql, /venue != 'Personal'/); return [{ values: rows }]; } };
  const now = new Date('2026-11-04T15:00:00Z');
  assert.strictEqual(server.currentSeasonLabel(db, new Set(), now), 'nov 2026-mar 2027');
  assert.strictEqual(server.currentSeasonLabel(db, new Set([3]), now), 'nov 2026-jan 2027');
  assert.strictEqual(server.currentSeasonLabel({ exec: () => [] }, new Set(), now), '');
});
