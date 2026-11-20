// The late-reg close (App improvements 1, 2): a clock time is the room's, a bare number is a level.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { parseLateRegEnd, lateRegCloseOf, lateRegLevel, fmtCloseInRoom, isTbd, matchesBuyin } = await import('../utils.js');

const LA = 'A Room Nobody Mapped';   // an unknown venue is Pacific (getVenueTimezone)

test('a clock time is read in the room’s zone, not the phone’s', () => {
  assert.equal(new Date(parseLateRegEnd('19:45', '2026-11-10', LA)).toISOString(), '2026-11-11T03:45:00.000Z');
  assert.equal(new Date(parseLateRegEnd('7:45 PM', '2026-11-10', LA)).toISOString(), '2026-11-11T03:45:00.000Z');
  assert.equal(fmtCloseInRoom(parseLateRegEnd('19:45', '2026-11-10', LA), LA, '2026-11-10'), '7:45 PM PST');
});

test('a close earlier than the start is the next day’s', () => {
  const t = { date: '2026-11-10', time: '11:00 PM', venue: LA, late_reg_end: '01:30' };
  assert.equal(new Date(lateRegCloseOf(t)).toISOString(), '2026-11-11T09:30:00.000Z');
});

test('a bare number is a level, read as the room-clock path reads it (it closes as that level starts)', () => {
  const t = { date: '2026-11-10', time: '2:00 PM', venue: LA, level_duration: '10 min', late_reg_end: '12' };
  assert.equal(new Date(lateRegCloseOf(t)).toISOString(), '2026-11-10T23:50:00.000Z');
  // "end of level" in the re-entry text: one level later (clockRegEnd's rule).
  assert.equal(new Date(lateRegCloseOf({ ...t, reentry: 'Unlimited through end of level 12' })).toISOString(), '2026-11-11T00:00:00.000Z');
  // App improvements 102: PLO at 6:30 AM, 40-min levels, late reg 10: 12:30 PM, not 10 AM.
  const p = { date: '2026-11-10', time: '6:30 AM', venue: LA, level_duration: 40, late_reg_end: '10' };
  assert.equal(new Date(lateRegCloseOf(p)).toISOString(), '2026-11-10T20:30:00.000Z');
  assert.equal(lateRegLevel('12'), 12);
  assert.equal(lateRegLevel('Level 8'), 8);
  assert.equal(lateRegLevel('19:45'), null);
  // No level length: nobody can say, never "closed".
  assert.ok(Number.isNaN(lateRegCloseOf({ ...t, level_duration: null })));
});

test('an instant stands as given; nothing is NaN', () => {
  assert.equal(parseLateRegEnd('2026-11-10T22:45:00Z', '2026-11-10'), Date.parse('2026-11-10T22:45:00Z'));
  assert.ok(Number.isNaN(parseLateRegEnd('', '2026-11-10')));
  assert.ok(Number.isNaN(parseLateRegEnd('sometime', '2026-11-10', LA)));
});

test('a start not announced is TBD (App improvements 9)', () => {
  assert.equal(isTbd('TBD'), true);
  assert.equal(isTbd(' tbd '), true);
  assert.equal(isTbd(''), true);
  assert.equal(isTbd('7:00 PM'), false);
});

test('every buy-in band holds its lower edge only: $10,000 is $10K+ (App improvements 7)', () => {
  const at = (b, r) => matchesBuyin({ buyin: b }, { buyinRanges: [r] });
  assert.equal(at(10000, '10000+'), true);
  assert.equal(at(10000, '5000-10000'), false);
  assert.equal(at(9999, '5000-10000'), true);
  assert.equal(at(5000, '5000-10000'), true);
});

test('a server stamp with no zone is UTC (App improvements 353)', async () => {
  const { parseServerStamp } = await import('../utils.js');
  assert.equal(parseServerStamp('2026-11-10 16:04:48'), Date.parse('2026-11-10T16:04:48Z'));
  assert.equal(parseServerStamp('2026-11-10T16:04:48.000Z'), Date.parse('2026-11-10T16:04:48Z'));
  assert.ok(Number.isNaN(parseServerStamp('')));
});

// Re-entry policies (owner, 2026-11-20, the Wynn WPT: "Unless an event explicitly says a number of maximum entries it
// is always unlimited"). The feed sent none for all 149 WPT World Championship events, and a missing policy read as a
// freezeout: no Max Entries stepper on the Schedule card, no Re-enter on Home.
test('re-entry is unlimited unless the event states a number; a stated freezeout is one entry', async () => {
  const { getMaxEntries, isFreezeout, reentriesLeftText } = await import('../utils.js');
  // Nothing stated, or words with no number: unlimited.
  for (const r of [null, undefined, '', '  ', 'Re-Entry', 'Unlimited', 'Unlimited Re-Entry', 'Bust A Play B',
    'Bust B Play C', 'Re-entry until level 8', 'Unlimited through end of level 12']) {
    assert.equal(isFreezeout(r), false, String(r));
    assert.equal(getMaxEntries(r), 99, String(r));
    assert.equal(reentriesLeftText(r, 3), 'unlimited', String(r));
  }
  // A stated freezeout.
  for (const r of ['N/A', 'Freezeout', 'freeze-out', 'None', 'No re-entry']) {
    assert.equal(isFreezeout(r), true, r);
    assert.equal(getMaxEntries(r), 1, r);
  }
  // A stated number: re-entries, one more entry than that; "N entries" is entries.
  assert.equal(getMaxEntries('1'), 2);
  assert.equal(getMaxEntries('2'), 3);
  assert.equal(getMaxEntries('Single'), 2);
  assert.equal(getMaxEntries('Single Re-Entry'), 2);
  assert.equal(getMaxEntries('1 Per Flight'), 2);
  assert.equal(getMaxEntries('2 Per Flight'), 3);
  assert.equal(getMaxEntries('Max 2 re-entries'), 3);
  assert.equal(getMaxEntries('3 entries max'), 3);
  assert.equal(reentriesLeftText('2', 1), '2 left');
});
