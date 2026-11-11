import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeBands, bandUnit } from '../chart-time.js';

const ms = (d) => Date.parse(d + 'T00:00:00Z');

test('the unit follows the span', () => {
  assert.equal(bandUnit(30), 'week');
  assert.equal(bandUnit(90), 'month');
  assert.equal(bandUnit(365), 'month');
  assert.equal(bandUnit(800), 'quarter');
  assert.equal(bandUnit(2000), 'year');
});

test('YTD to Nov 10 is eleven month bands, the last one partial, edges inside the span only', () => {
  const { unit, bands, year } = timeBands(ms('2026-01-01'), ms('2026-11-10'));
  assert.equal(unit, 'month');
  assert.equal(bands.length, 11);
  assert.equal(bands[0].short, 'J');
  assert.equal(bands[0].long, 'Jan');
  assert.equal(bands[0].edge, false, 'Jan 1 is the plot edge, not a hairline');
  assert.equal(bands[1].edge, true);
  assert.equal(bands[10].short, 'N');
  assert.equal(bands[10].to, ms('2026-11-10'));
  assert.equal(year, '2026');
});

test('a year across two calendar years names both in the gutter', () => {
  const { bands, year } = timeBands(ms('2025-11-10'), ms('2026-11-10'));
  assert.equal(year, '2025–26');
  assert.equal(bands[0].from, ms('2025-11-10'));
  assert.equal(bands[0].short, 'N');
});

test('a month is cut into weeks from each Monday', () => {
  const { unit, bands } = timeBands(ms('2026-10-10'), ms('2026-11-10'));
  assert.equal(unit, 'week');
  assert.equal(bands[0].from, ms('2026-10-10'));       // Saturday: clipped to the span
  assert.equal(bands[1].start, '2026-10-12');          // the first Monday
  assert.equal(bands[1].short, 'Oct 12');
  assert.ok(bands.every((b) => b.to > b.from));
});

test('a long history is cut into years, with no gutter label', () => {
  const { unit, bands, year } = timeBands(ms('2019-06-01'), ms('2026-11-10'));
  assert.equal(unit, 'year');
  assert.equal(year, '');
  assert.equal(bands[0].short, '2019');
  assert.equal(bands[bands.length - 1].short, '2026');
});
