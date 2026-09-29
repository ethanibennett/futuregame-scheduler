// lib/live-clocks.js: the pure halves, replayed against payloads captured 2026-09-29.
// Bravo: mtt-series-watcher fixtures/bravo/jcin-clocks.json (copied inline, no player data).
// PokerAtlas: mtt-series-watcher fixtures/pokeratlas-clock/instance-reply-prestart.json.
'use strict';
const assert = require('assert');
const {
  normalizeBravoClock, normalizePaClock, matchBravoClock, pickBravoCasino, eventNumberOf,
} = require('../lib/live-clocks');

let passed = 0;
const eq = (label, a, b) => { assert.deepStrictEqual(a, b, label); passed++; };

const plo = {
  Ante: '3000', AverageChips: '221250', BigBlind: '3000', ClockState: 'R', LevelCurrent: '12',
  LevelRemainingSecs: '586', LevelTotalSecs: '1800', LevelType: 'B', MinsToBreak: '0',
  NextAnte: '4000', NextBlinds: '2,000 - 4,000', NumEntrants: '59', NumRemaining: '8',
  PrizePool: '14160', ShowAverageChips: 'True', ShowPrizePool: 'True', SmallBlind: '1500',
  TName: '2026 HRFC Event #06 PLO 10K', WebTime: '2026-09-29T22:10:03.211622', casinoID: 'JCIN',
};
const mini = {
  ...plo, Ante: '500', AverageChips: '44000', BigBlind: '500', LevelCurrent: '4',
  LevelRemainingSecs: '295', LevelType: 'A', MinsToBreak: '5', NextBlinds: '300 - 600',
  NumEntrants: '22', NumRemaining: '20', PrizePool: '9130', ShowPrizePool: 'False',
  SmallBlind: '300', TName: '2026 HRFC Event #04 Mini Main 100K',
};

// ── Bravo normalise ──
const at = Date.parse('2026-09-29T22:10:13.211Z'); // 10 s after the venue's report
const n = normalizeBravoClock(plo, at);
eq('level', n.level, 12);
eq('blinds and ante', [n.sb, n.bb, n.ante], [1500, 3000, 3000]);
eq('remaining ages from the venue report while running', Math.round(n.remainingSecs), 576);
eq('"B" is a break', n.onBreak, true);
eq('field', [n.entries, n.playersLeft, n.avgStack], [59, 8, 221250]);
eq('shown prize pool', n.prizePool, 14160);
eq('a hidden prize pool stays hidden', normalizeBravoClock(mini, at).prizePool, null);
eq('a paused clock does not age', normalizeBravoClock({ ...plo, ClockState: 'P' }, at).remainingSecs, 586);
eq('junk is null', normalizeBravoClock({}, at), null);

// ── Bravo match ──
const clocks = [plo, mini];
eq('feed number "6-…" finds Event #06', matchBravoClock({ event_number: '6-293602-20260929', event_name: 'PLO' }, clocks)?.TName, plo.TName);
eq('a flight finds its event', matchBravoClock({ event_number: '4-293600-20260929', event_name: 'NLH Mini Main Event - Flight C' }, clocks)?.TName, mini.TName);
eq('an unnumbered satellite takes no series clock',
  matchBravoClock({ event_number: 'PA-293614-20260929', event_name: 'NLH Main Event Satellite (3 seats)' }, clocks), null);
eq('a numbered event with no running clock gets none',
  matchBravoClock({ event_number: '9-1-20260929', event_name: 'PLO' }, clocks), null);
eq('an unnumbered daily matches an unnumbered clock by name',
  matchBravoClock({ event_number: 'PA-1-20260929', event_name: '$140 NL Holdem' }, [{ ...mini, TName: 'Tuesday $140 NL Holdem' }])?.TName,
  'Tuesday $140 NL Holdem');
eq('two equally-good name matches are not guessed',
  matchBravoClock({ event_number: '', event_name: 'NLH' }, [{ ...mini, TName: 'NLH Turbo' }, { ...mini, TName: 'NLH Deep' }]), null);
eq('event numbers', [eventNumberOf('2026 HRFC Event #06 PLO'), eventNumberOf('6-2936', { leading: true }), eventNumberOf('PA-1', { leading: true })], [6, 6, null]);

// ── roster ──
const roster = [
  { casinoID: 'JCIN', description: 'Hard Rock Casino Cincinnati', distance: 0.5 },
  { casinoID: 'XXXX', description: 'Somewhere Else', distance: 0.2 },
];
eq('the named room wins over a nearer one', pickBravoCasino(roster, 'Hard Rock Casino Cincinnati')?.casinoID, 'JCIN');
eq('otherwise the nearest within a mile', pickBravoCasino(roster, null)?.casinoID, 'XXXX');
eq('nothing close is nothing', pickBravoCasino([{ casinoID: 'FAR', description: 'x', distance: 2.5 }], null), null);

// ── PokerAtlas ──
const pre = {
  Name: 'Tuesday $100+$25+$25 Progressive', Status: 0, CurrentLevel: null, RemainingTime: null,
  LevelEndDateTime: null, ServerTime: '2026-09-29T22:14:32.7320084Z', Entries: 1,
  EntriesRemaining: 1, ChipsAverage: 20000, TotalPrizePool: 75, RegistrationEndTime: '2026-09-30T00:45:00Z',
};
const p = normalizePaClock(pre, Date.parse('2026-09-29T22:15:00Z'));
eq('before the start it is not started', p.state, 'not-started');
eq('with no remaining time', p.remainingSecs, null);
eq('registration end is exact', p.regEndsAt, '2026-09-30T00:45:00.000Z');
eq('the clock own start', normalizePaClock({ ...pre, StartTime: '2026-09-29T23:15:00Z' }).startsAt, '2026-09-29T23:15:00.000Z');
const run = normalizePaClock({ ...pre, Status: 1, CurrentLevel: 3, LevelSmallBlind: 100, LevelBigBlind: 200,
  LevelAnte: 200, LevelEndDateTime: '2026-09-29T22:20:00Z', LevelDuration: '00:20:00' }, Date.parse('2026-09-29T22:15:00Z'));
eq('running: level and blinds', [run.state, run.level, run.sb, run.bb, run.ante], ['running', 3, 100, 200, 200]);
eq('running: remaining from the level end', Math.round(run.remainingSecs), 327);
eq('running: level length', run.levelSecs, 1200);

console.log(`live-clocks.test.js — ${passed} assertions passed`);
