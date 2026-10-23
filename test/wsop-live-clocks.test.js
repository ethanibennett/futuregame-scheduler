// lib/wsop-live-clocks.js: the pure halves, replayed against the 2026-10-22 Turning Stone capture
// (docs/wsop-live-clock.md). No network. Run by `npm run test:clocks` after live-clocks.test.js.
'use strict';
const assert = require('assert');
const zlib = require('zlib');
const W = require('../lib/wsop-live-clocks');

let passed = 0;
const eq = (label, a, b) => { assert.deepStrictEqual(a, b, label); passed++; };

// ── MessagePack and framing ──
const sample = [1, {}, null, 'Clock', [{ data: { eventFlightId: 6147, isStarted: true, level: 11, type: 0, duration: 1559, pauseStartTime: null, note: 'é' }, timestamp: 1792711447564 }], []];
eq('msgpack round-trips', W.decodeMsgpack(W.encodeMsgpack(sample)).value, sample);
eq('msgpack negative and float', W.decodeMsgpack(W.encodeMsgpack([-1, -40, 1.5, 70000, 4294967296])).value, [-1, -40, 1.5, 70000, 4294967296]);
// The client's Subscribe frame, byte for byte as the app sent it.
eq('the Subscribe invocation is the app’s bytes',
  W.hubInvocation('Subscribe', JSON.stringify({ events: ['AllTournament'], seriesId: 76 })).toString('hex'),
  '3b950180c0a953756273637269626591d92a7b226576656e7473223a5b22416c6c546f75726e616d656e74225d2c227365726965734964223a37367d');
// A server frame as captured: flag byte, uint32 LE length, SignalR varint framing, msgpack.
const frame = Buffer.from('00e3000000e101960180c0a5436c6f636b9182a4646174618cad6576656e74466c696768744964cd1800a9697353746172746564c3aa6c6576656c496e64657822a56c6576656c1ba47479706500ad6c6576656c4475726174696f6e28a86475726174696f6ecd0541ae7061757365537461727454696d65c0ad70617573654475726174696f6ec0aa73657276657254696d65bc323032362d31302d32325432333a32343a30362e373532393033335aae6c617465526567456e6454696d65c0b26c617465526567456e644475726174696f6e00a974696d657374616d70cf000001a165edd40990', 'hex');
const decoded = W.decodeHubMessage(frame);
eq('a captured Clock frame decodes', [decoded.length, decoded[0][3], decoded[0][4][0].data.eventFlightId, decoded[0][4][0].data.level, decoded[0][4][0].data.duration], [1, 'Clock', 6144, 27, 1345]);
eq('the handshake reply decodes', W.decodeHubMessage(Buffer.from('{}\x1e')), [{}]);
const inner = frame.subarray(5);
const gz = zlib.gzipSync(inner);
const wrapped = Buffer.concat([Buffer.from([1]), Buffer.alloc(4), gz]); wrapped.writeUInt32LE(gz.length, 1);
eq('a gzipped frame decodes', W.decodeHubMessage(wrapped)[0][4][0].data.eventFlightId, 6144);
const two = Buffer.concat([inner, inner]);
const both = Buffer.concat([Buffer.from([0]), Buffer.alloc(4), two]); both.writeUInt32LE(two.length, 1);
eq('two frames in one message', W.decodeHubMessage(both).length, 2);
eq('junk is nothing', [W.decodeHubMessage(Buffer.alloc(0)), W.decodeHubMessage(Buffer.from([0, 1]))], [[], []]);

// ── Series: the room's words find the series; a shared first word alone does not ──
const seriesList = [
  { id: 76, name: 'WSOP Circuit - Turning Stone Resort Casino', venueName: 'Turning Stone Resort Casino', beginAt: '2026-10-15T00:00:00Z', endAt: '2026-10-26T00:00:00Z' },
  { id: 79, name: 'WSOP Circuit - Caesars Southern Indiana', venueName: 'Caesars Southern Indiana', beginAt: '2026-10-22T00:00:00Z', endAt: '2026-11-02T00:00:00Z' },
  { id: 85, name: 'WSOP Circuit - Caesars New Orleans', venueName: 'Caesars New Orleans', beginAt: '2026-11-12T00:00:00Z', endAt: '2026-11-23T00:00:00Z' },
];
const oct23 = Date.parse('2026-10-23T16:00:00Z');
eq('the room finds its series', W.pickWsopSeries(seriesList, { property: 'Turning Stone Casino', venue: '2026-27 WSOPC Upstate NY-Fall', startMs: oct23 })?.id, 76);
eq('the series title is a second chance', W.pickWsopSeries(seriesList, { property: null, venue: 'WSOPC Turning Stone 2026', startMs: oct23 })?.id, 76);
eq('a room with no series gets none', W.pickWsopSeries(seriesList, { property: 'Parx Casino', venue: 'Parx Big Stax', startMs: oct23 }), null);
eq('"Caesars" alone is not a match', W.pickWsopSeries(seriesList, { property: 'Caesars Palace', venue: 'x', startMs: oct23 }), null);
eq('outside the window, no series', W.pickWsopSeries(seriesList, { property: 'Turning Stone Casino', venue: 'x', startMs: Date.parse('2026-11-25T16:00:00Z') }), null);
eq('Caesars Southern Indiana finds its own', W.pickWsopSeries(seriesList, { property: 'Caesars Southern Indiana', venue: 'WSOPC Southern Indiana', startMs: Date.parse('2026-10-25T16:00:00Z') })?.id, 79);

// ── Flights: the live list on 2026-10-23 (names, numbers, starts, prices) ──
const flights = [
  { eventFlightId: 6147, eventNo: 9, fullName: "#9: $1,700 No-Limit Hold'em Main Event $1M GTD - Day1A", startTime: '2026-10-22T15:00:00Z', buyIn: 1700 },
  { eventFlightId: 6148, eventNo: 9, fullName: "#9: $1,700 No-Limit Hold'em Main Event $1M GTD - Day1B", startTime: '2026-10-23T15:00:00Z', buyIn: 1700 },
  { eventFlightId: 6149, eventNo: 9, fullName: "#9: $1,700 No-Limit Hold'em Main Event $1M GTD - Day1C", startTime: '2026-10-24T15:00:00Z', buyIn: 1700 },
  { eventFlightId: 6150, eventNo: 9, fullName: "#9: $1,700 No-Limit Hold'em Main Event $1M GTD - Day2", startTime: '2026-10-25T16:00:00Z', buyIn: 1700 },
  { eventFlightId: 6151, eventNo: 9, fullName: "#9: $1,700 No-Limit Hold'em Main Event $1M GTD - Final Day", startTime: '2026-10-26T16:00:00Z', buyIn: 1700 },
  { eventFlightId: 6152, eventNo: 10, fullName: "#10: $400 No-Limit Hold'em/Pot-Limit Omaha Mixed $50K GTD - Day1", startTime: '2026-10-22T20:00:00Z', buyIn: 400 },
  { eventFlightId: 6153, eventNo: 10, fullName: "#10: $400 No-Limit Hold'em/Pot-Limit Omaha Mixed $50K GTD - Final Day", startTime: '2026-10-23T17:00:00Z', buyIn: 400 },
  { eventFlightId: 6155, eventNo: 12, fullName: "#12: $400 No-Limit Hold'em $50K GTD", startTime: '2026-10-23T20:00:00Z', buyIn: 400 },
  { eventFlightId: 6177, eventNo: 0, fullName: "$140 No-Limit Hold'em Nightly", startTime: '2026-10-22T23:00:00Z', buyIn: 140, isSideEvent: true },
  { eventFlightId: 6192, eventNo: 0, fullName: "$100 No-Limit Hold'em Cash Survivor", startTime: '2026-10-22T18:00:00Z', buyIn: 100, isSideEvent: true },
  { eventFlightId: 6935, eventNo: 0, fullName: '$250 NLH Cash Survivor', startTime: '2026-10-22T21:00:00Z', buyIn: 250, isSideEvent: true },
  { eventFlightId: 6206, eventNo: 0, fullName: '$250 NLH Landmark Mega Satellite', startTime: '2026-10-23T01:00:00Z', buyIn: 250 },
];
const m = (ev, start) => W.matchWsopFlight(ev, flights, { startMs: Date.parse(start) })?.eventFlightId ?? null;
// The feed says noon ET for the Main Event flights; WSOP+ lists them at 11 AM. The suffix decides.
eq('Flight B is Day1B', m({ event_number: '9-293160-20261023', event_name: 'WSOPC Main Event - Flight B', buyin: 1700 }, '2026-10-23T16:00:00Z'), 6148);
eq('Flight A is Day1A', m({ event_number: '9-293160-20261022', event_name: 'WSOPC Main Event - Flight A', buyin: 1700 }, '2026-10-22T16:00:00Z'), 6147);
eq('Day 2 is Day2', m({ event_number: '9-293160-20261025', event_name: 'WSOPC Main Event - Day 2', buyin: 1700 }, '2026-10-25T16:00:00Z'), 6150);
eq('Day 3 is the Final Day', m({ event_number: '9-293160-20261026', event_name: 'WSOPC Main Event - Day 3', buyin: 1700 }, '2026-10-26T16:00:00Z'), 6151);
eq('a Day 2 of a one-flight event is its Final Day', m({ event_number: '10-293161-20261023', event_name: 'NLH-PLO Mix - Day 2', buyin: 400 }, '2026-10-23T16:00:00Z'), 6153);
eq('no suffix: the nearest start among the number', m({ event_number: '10-293161-20261022', event_name: 'NLH-PLO Mix', buyin: 400 }, '2026-10-22T20:00:00Z'), 6152);
eq('a lone flight for the number', m({ event_number: '12-293163-20261023', event_name: 'NLH', buyin: 400 }, '2026-10-23T20:00:00Z'), 6155);
eq('a number WSOP+ has not got', m({ event_number: '44-1-20261023', event_name: 'NLH', buyin: 400 }, '2026-10-23T20:00:00Z'), null);
eq('a daily by name, price and hour: the $100 Survivor', m({ event_number: 'PA-293171-20261022', event_name: 'NLH Cash Survivor', buyin: 100 }, '2026-10-22T18:00:00Z'), 6192);
eq('the $250 Survivor three hours later', m({ event_number: 'PA-293177-20261022', event_name: 'NLH Cash Survivor', buyin: 250 }, '2026-10-22T21:00:00Z'), 6935);
eq('the Nightly, NLH spelled out on their side', m({ event_number: 'PA-293173-20261022', event_name: 'NLH Side Event - Nightly Deep Stack', buyin: 140 }, '2026-10-22T23:00:00Z'), 6177);
eq('the Mega satellite', m({ event_number: 'PA-293179-20261022', event_name: 'NLH Landmark Mega', buyin: 250 }, '2026-10-23T01:00:00Z'), 6206);
eq('a daily with no start is not guessed', W.matchWsopFlight({ event_number: 'PA-1', event_name: 'NLH Cash Survivor', buyin: 100 }, flights), null);
eq('a daily at a price WSOP+ has not got', m({ event_number: 'PA-1', event_name: 'NLH Cash Survivor', buyin: 60 }, '2026-10-22T18:00:00Z'), null);
eq('two equally-named dailies in one hour are not guessed',
  W.matchWsopFlight({ event_number: 'PA-1', event_name: 'NLH Cash Survivor' }, [flights[9], { ...flights[9], eventFlightId: 1 }], { startMs: Date.parse('2026-10-22T18:00:00Z') }), null);
eq('suffixes', [W.flightSuffix('x - Day1B'), W.flightSuffix('x - Day2'), W.flightSuffix('x - Final Day'), W.flightSuffix('x'), W.eventSuffix('x - Flight C'), W.eventSuffix('x - Day 2')],
  [{ day: 1, letter: 'B' }, { day: 2, letter: null }, { final: true }, {}, { day: 1, letter: 'C' }, { day: 2, letter: null }]);

// ── Normalise: the Main Event Day1A clock as pushed at 23:24:07Z (level 11, 1559 s left) ──
// with a structure of 40-min levels and a 15-min break after every third.
const structure = [];
for (let L = 1; L <= 17; L++) {
  structure.push({ level: L, type: 0, duration: 40, blindJson: JSON.stringify({ nlHoldemSmallBlind: 100 * L, nlHoldemBigBlind: 200 * L, nlHoldemAnte: 200 * L }) });
  if (L % 3 === 0) structure.push({ level: L, type: 1, duration: 15, blindJson: null });
}
const clock = { eventFlightId: 6147, isStarted: true, levelIndex: 13, level: 11, type: 0, levelDuration: 40, duration: 1559, pauseStartTime: null, pauseDuration: null, serverTime: '2026-10-22T23:24:07.4326482Z', lateRegEndTime: '2026-10-23T00:45:06.7134439Z', lateRegEndDuration: 4859 };
const detail = { eventFlightId: 6147, fullName: "#9: $1,700 No-Limit Hold'em Main Event $1M GTD - Day1A", startTime: '2026-10-22T15:00:00.0000000Z', entries: 186, playersLeftCount: 66, flightStack: 7440000, flightPrize: 281790, totalPrize: 292395, completedAt: null, option: { isHideClock: false, isHideChipsPrize: false } };
const at = Date.parse('2026-10-22T23:24:17.432Z'); // 10 s after the server stamped it
const n = W.normalizeWsopClock(clock, { structure, detail, now: at });
eq('source and state', [n.source, n.state, n.onBreak, n.level], ['wsop', 'running', false, 11]);
eq('blinds from the structure at levelIndex', [n.sb, n.bb, n.ante], [1100, 2200, 2200]);
eq('time left ages from serverTime', Math.round(n.remainingSecs), 1549);
eq('level length in seconds', n.levelSecs, 2400);
eq('next level', [n.nextBlinds, n.nextAnte], ['1,200 - 2,400', 2400]);
eq('minutes to the break after level 12', n.minsToBreak, Math.round((1549 + 2400) / 60));
eq('field and money', [n.entries, n.playersLeft, n.avgStack, n.prizePool], [186, 66, 112727, 281790]);
eq('registration end and the flight start', [n.regEndsAt, n.startsAt], ['2026-10-23T00:45:06.713Z', '2026-10-22T15:00:00.0000000Z']);
{
  const b = W.normalizeWsopClock({ ...clock, levelIndex: 15, level: 12, type: 1, levelDuration: 15, duration: 211 }, { structure, detail, now: at });
  eq('a break carries no blinds and no time to the break', [b.onBreak, b.sb, b.minsToBreak, b.nextBlinds, b.levelSecs], [true, null, null, '1,300 - 2,600', 900]);
}
eq('a paused clock holds its time', W.normalizeWsopClock({ ...clock, pauseStartTime: '2026-10-22T23:24:00Z' }, { structure, detail, now: at }).remainingSecs, 1559);
{
  const s = W.normalizeWsopClock({ ...clock, isStarted: false, levelIndex: 0, level: 1, duration: 2400 }, { structure, detail, now: at });
  eq('a clock not yet started', [s.state, s.remainingSecs, s.sb], ['not-started', null, 100]);
}
eq('a completed flight has ended', W.normalizeWsopClock(clock, { structure, detail: { ...detail, completedAt: '2026-10-23T04:17:55Z' }, now: at }).state, 'ended');
eq('a hidden clock is no clock', W.normalizeWsopClock(clock, { structure, detail: { ...detail, option: { isHideClock: true } }, now: at }), null);
{
  const h = W.normalizeWsopClock(clock, { structure, detail: { ...detail, option: { isHideChipsPrize: true } }, now: at });
  eq('hidden money stays hidden', [h.avgStack, h.prizePool], [null, null]);
}
eq('a levelIndex off the structure falls back to the level', W.normalizeWsopClock({ ...clock, levelIndex: 2 }, { structure, detail, now: at }).sb, 1100);
eq('no structure: level and time still come through', (() => { const x = W.normalizeWsopClock(clock, { detail, now: at }); return [x.level, x.sb, Math.round(x.remainingSecs), x.levelSecs]; })(), [11, null, 1549, 2400]);
eq('PLO blinds read by suffix', W.blindsOf({ blindJson: '{"ploAnte":200,"ploSmallBlind":100,"ploBigBlind":200,"ploCall":200,"ploMakeIt":700}' }), { sb: 100, bb: 200, ante: 200 });
eq('junk is null', W.normalizeWsopClock({}, {}), null);

console.log(`wsop-live-clocks.test.js — ${passed} assertions passed`);
