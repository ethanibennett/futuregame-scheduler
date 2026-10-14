// node --test src/utils/__tests__/bb-hr.test.mjs  (from vite-app/)
// bb/hr (utils/bb-hr.js): the big blind read from a stakes text, the unit a session is measured in,
// and the rate over many sessions. Definition and decisions: docs/bankrolls.md "bb/hr".
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bigBlindOf, unitOf, sessionBlinds, sessionBbHr, bbAccumulator, bbHourly, fmtBbRate, fmtBbHr, bbTone, bbFigures, bbBasis,
  unitLabel, bbColumn, cashBbGroups, UNIT_BB, UNIT_BIG_BET, MIN_SESSION_HOURS,
} from '../bb-hr.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

// ── bigBlindOf ─────────────────────────────────────────────────────────────────────────────
test('bigBlindOf: the second number is the big blind, whatever the separator or dressing', () => {
  const cases = [
    ['1/2', 2], ['2/5', 5], ['5/10', 10], ['25/50', 50], ['100/200', 200],
    ['$2/$5', 5], ['$1/$2', 2], ['$ 2 / $ 5', 5], ['2-5', 5], ['2 - 5', 5], ['2 / 5', 5],
    ['5/10 NLH', 10], ['1/2 PLO', 2], ['NL 2/5', 5], ['2/5 NL', 5], ['PLO 5/10', 10], ['5/10 PLO8', 10],
    ['2–5', 5], ['2—5', 5], // en dash, em dash
  ];
  for (const [text, want] of cases) assert.equal(bigBlindOf(text), want, text);
});

test('bigBlindOf: a third number still leaves the second as the big blind', () => {
  assert.equal(bigBlindOf('1/2/5'), 2);
  assert.equal(bigBlindOf('1/3/5'), 3);
  assert.equal(bigBlindOf('5/5/10'), 5);
  assert.equal(bigBlindOf('5/5/10 PLO'), 5);
  assert.equal(bigBlindOf('2-5-10'), 5);
  assert.equal(bigBlindOf('$1/$2/$5'), 2);
});

test('bigBlindOf: euros, pounds and other currencies read the same (the count of blinds has no currency)', () => {
  assert.equal(bigBlindOf('€2/€5'), 5);
  assert.equal(bigBlindOf('€1/€2'), 2);
  assert.equal(bigBlindOf('£1/£2'), 2);
  assert.equal(bigBlindOf('£2/£5 NLH'), 5);
  assert.equal(bigBlindOf('C$1/C$2'), 2);
  assert.equal(bigBlindOf('US$2/US$5'), 5);
  assert.equal(bigBlindOf('EUR 1/2'), 2);
  assert.equal(bigBlindOf('CHF2/CHF5'), 5);
  assert.equal(bigBlindOf('2/5 €'), 5);
  assert.equal(bigBlindOf('¥100/¥200'), 200);
});

test('bigBlindOf: limit stakes take the second number, the big bet', () => {
  assert.equal(bigBlindOf('4/8 LHE'), 8);
  assert.equal(bigBlindOf('4/8'), 8);
  assert.equal(bigBlindOf('10/20 Limit'), 20);
  assert.equal(bigBlindOf('FL 3/6'), 6);
  assert.equal(bigBlindOf('$4/$8 Stud'), 8);
  assert.equal(bigBlindOf('2/4 Razz'), 4);
});

test('bigBlindOf: decimals, a decimal comma, thousands and k', () => {
  assert.equal(bigBlindOf('0.25/0.50'), 0.5);
  assert.equal(bigBlindOf('$0.25/$0.50'), 0.5);
  assert.equal(bigBlindOf('.50/1'), 1);
  assert.equal(bigBlindOf('0.5/1'), 1);
  assert.equal(bigBlindOf('€0,50/€1'), 1);
  assert.equal(bigBlindOf('0,5/1'), 1);
  assert.equal(bigBlindOf('1.50/3'), 3);
  assert.equal(bigBlindOf('500/1,000'), 1000);
  assert.equal(bigBlindOf('1,000/2,000'), 2000);
  assert.equal(bigBlindOf('5k/10k'), 10000);
  assert.equal(bigBlindOf('1k/2k'), 2000);
});

test('bigBlindOf: reads the first group and ignores the words around it', () => {
  assert.equal(bigBlindOf('6-max 1/2'), 2);
  assert.equal(bigBlindOf('1/2 NL $300 max'), 2);
  assert.equal(bigBlindOf('1/2 NL 9-handed'), 2);
  assert.equal(bigBlindOf('NL $300 max, 1/2'), 2);
  assert.equal(bigBlindOf('2/5 cap'), 5);
  assert.equal(bigBlindOf('  2/5  '), 5);
  assert.equal(bigBlindOf('2/5 kill'), 5, 'a k after a space is a word, not thousands');
});

test('bigBlindOf: junk and missing stakes are null, never a guess', () => {
  const junk = [
    '', '   ', null, undefined, 5, 2.5, {}, [], true,
    'NL200', 'NL10', '5', '$5', 'high stakes', 'cash', 'abc/def', '/', '-', '//', '2/', '/5',
    '5/2',                // a small blind above the big blind
    '0/0', '0/2', '2/0',  // zeros
    '6-max', '9-handed', '1-on-1',
    'PLO5/10',            // glued to a word: not a group
    'Oct-14',
  ];
  for (const x of junk) assert.equal(bigBlindOf(x), null, JSON.stringify(x));
});

test('bigBlindOf: equal blinds are fine (5/5 straddle games), a tiny stake too', () => {
  assert.equal(bigBlindOf('5/5'), 5);
  assert.equal(bigBlindOf('0.01/0.02'), 0.02);
});

// ── unitOf ─────────────────────────────────────────────────────────────────────────────────
test('unitOf: no-limit and pot-limit are big blinds', () => {
  for (const [game, stakes] of [['NLH', '2/5'], ['PLO', '1/2'], ['PLO5', '2/5'], ['PLO6', '5/10'], ['PLO8', '1/2'], ['Big O', '2/5'],
    ['NLHE', ''], ['', '2/5 NL'], ['', '1/2 PLO'], ['', '5/10 NLH'], ['', '5/5/10 PLO'], ['No Limit Hold\'em', '1/2'], ['Pot-Limit Omaha', '2/5'],
    ['NLH', '2/5 cap'], ['', '2/5']]) {
    assert.equal(unitOf(game, stakes), UNIT_BB, `${game} ${stakes}`);
  }
});

test('unitOf: limit games are big bets', () => {
  for (const [game, stakes] of [['LHE', '4/8'], ['', '4/8 LHE'], ['Limit', '10/20'], ['', '4/8 Limit'], ['FL', '3/6'], ['Stud Hi', '4/8'],
    ['Stud 8', '10/20'], ['Razz', '5/10'], ['O8', '4/8'], ['Omaha 8', '4/8'], ['Omaha Hi-Lo', '10/20'], ['HORSE', '4/8'], ['8-Game', '4/8'],
    ['Mixed', '4/8'], ['Fixed Limit', '2/4']]) {
    assert.equal(unitOf(game, stakes), UNIT_BIG_BET, `${game} ${stakes}`);
  }
});

test('unitOf: a mixed game is judged on its own text: no-limit and pot-limit in it make it big-blind', () => {
  assert.equal(unitOf('Mixed', '4/8'), UNIT_BIG_BET);
  assert.equal(unitOf('Mixed', '2/5 NLH/PLO'), UNIT_BB);
  assert.equal(unitOf('Mixed NL/PL', '1/2'), UNIT_BB);
  assert.equal(unitOf('', 'Mixed PLO/NLH 2/5'), UNIT_BB);
});

test('unitOf: PLO8 and the like are pot-limit, not O8', () => {
  assert.equal(unitOf('PLO8', '1/2'), UNIT_BB);
  assert.equal(unitOf('PLO8', '2/5'), UNIT_BB);
});

test('unitOf: text that says tournament has no unit', () => {
  for (const [game, stakes] of [['NLH MTT', ''], ['PLO MTT', ''], ['Tournament', '100/200'], ['NLH', 'Satellite 2/5'], ['Sit & Go', ''], ['NLH', 'freezeout'], ['Main Event', '']]) {
    assert.equal(unitOf(game, stakes), null, `${game} ${stakes}`);
  }
});

test('unitOf: words that merely contain a marker do not count', () => {
  assert.equal(unitOf('Plenty of play', '2/5'), UNIT_BB);
  assert.equal(unitOf('Casino limit break', ''), UNIT_BIG_BET, 'the word limit by itself is a limit game');
  assert.equal(unitOf('casino', '1/2'), UNIT_BB);
  assert.equal(unitOf('Flop', '1/2'), UNIT_BB);
  assert.equal(unitOf('Mixers', '1/2'), UNIT_BB);
});

// ── a session ──────────────────────────────────────────────────────────────────────────────
test('sessionBlinds: the net over the session\'s own big blind', () => {
  const b = sessionBlinds({ game: 'NLH', stakes: '2/5', net: 500, hours: 4 });
  assert.deepEqual(b, { unit: 'bb', bigBlind: 5, blinds: 100, hours: 4 });
  const lim = sessionBlinds({ game: 'LHE', stakes: '4/8', net: -160, hours: 5 });
  assert.deepEqual(lim, { unit: 'BB', bigBlind: 8, blinds: -20, hours: 5 });
});

test('sessionBlinds: null without a readable blind, a net, positive hours, or for a tournament', () => {
  assert.equal(sessionBlinds({ game: 'NLH', stakes: '', net: 100, hours: 3 }), null);
  assert.equal(sessionBlinds({ game: 'NLH', stakes: 'NL200', net: 100, hours: 3 }), null);
  assert.equal(sessionBlinds({ game: 'NLH', stakes: '2/5', net: null, hours: 3 }), null);
  assert.equal(sessionBlinds({ game: 'NLH', stakes: '2/5', net: NaN, hours: 3 }), null);
  assert.equal(sessionBlinds({ game: 'NLH', stakes: '2/5', net: 100, hours: 0 }), null);
  assert.equal(sessionBlinds({ game: 'NLH', stakes: '2/5', net: 100, hours: null }), null);
  assert.equal(sessionBlinds({ game: 'NLH', stakes: '2/5', net: 100, hours: -1 }), null);
  assert.equal(sessionBlinds({ game: 'NLH MTT', stakes: '100/200', net: 100, hours: 3 }), null);
  assert.equal(sessionBlinds(null), null);
  assert.deepEqual(sessionBlinds({ game: 'NLH', stakes: '2/5', net: 0, hours: 3 }), { unit: 'bb', bigBlind: 5, blinds: 0, hours: 3 }, 'a break-even session is 0, not unknown');
});

test('sessionBbHr: one session\'s rate, none under a quarter of an hour', () => {
  const r = sessionBbHr({ game: 'NLH', stakes: '1/2', net: 120, hours: 3 });
  assert.equal(r.unit, 'bb'); close(r.rate, 20); close(r.blinds, 60);
  assert.equal(sessionBbHr({ game: 'NLH', stakes: '1/2', net: 120, hours: 0.2 }), null);
  assert.ok(sessionBbHr({ game: 'NLH', stakes: '1/2', net: 120, hours: MIN_SESSION_HOURS }));
  assert.equal(sessionBbHr({ game: 'NLH', stakes: '', net: 120, hours: 3 }), null);
});

// ── many sessions ──────────────────────────────────────────────────────────────────────────
test('bbHourly: mixed stakes are normalised by each session\'s OWN big blind, never an average blind', () => {
  // +$500 at 2/5 (+100 bb) in 4 h and -$200 at 1/2 (-100 bb) in 2 h: 0 bb over 6 h.
  // An average-blind shortcut ($300 / 3.5) would be +85.7 bb / 6 h, a different (wrong) answer.
  const r = bbHourly([
    { game: 'NLH', stakes: '2/5', net: 500, hours: 4 },
    { game: 'NLH', stakes: '1/2', net: -200, hours: 2 },
  ]);
  assert.equal(r.BB, null);
  close(r.bb.rate, 0); assert.equal(r.bb.n, 2); close(r.bb.hours, 6); close(r.bb.blinds, 0);
  // Another pair: +$1000 at 5/10 (+100 bb) in 5 h; +$100 at 1/2 (+50 bb) in 5 h → 150 bb / 10 h = 15.
  const r2 = bbHourly([
    { game: 'PLO', stakes: '5/10', net: 1000, hours: 5 },
    { game: 'NLH', stakes: '1/2', net: 100, hours: 5 },
  ]);
  close(r2.bb.rate, 15);
});

test('bbHourly: a session with no readable big blind is left out of the numerator AND the hours', () => {
  const r = bbHourly([
    { game: 'NLH', stakes: '2/5', net: 500, hours: 5 },     // +100 bb in 5 h
    { game: 'NLH', stakes: '', net: 9999, hours: 100 },     // no blind: out
    { game: 'NLH', stakes: 'NL200', net: -9999, hours: 100 },
  ]);
  close(r.bb.rate, 20); assert.equal(r.bb.n, 1); close(r.bb.hours, 5);
});

test('bbHourly: zero hours leave a session out (no rate over no time); none qualifying is null, not 0', () => {
  const r = bbHourly([
    { game: 'NLH', stakes: '2/5', net: 500, hours: 0 },
    { game: 'NLH', stakes: '2/5', net: -500, hours: null },
  ]);
  assert.deepEqual(r, { bb: null, BB: null });
  assert.deepEqual(bbHourly([]), { bb: null, BB: null });
  assert.deepEqual(bbHourly(null), { bb: null, BB: null });
  assert.deepEqual(bbFigures(r), []);
});

test('bbHourly: a limit game is measured in big bets and never added to the big blinds', () => {
  const r = bbHourly([
    { game: 'NLH', stakes: '2/5', net: 250, hours: 5 },        // +50 bb
    { game: 'LHE', stakes: '4/8', net: 160, hours: 4 },        // +20 BB
    { game: 'NLH', stakes: '1/2', net: -100, hours: 5 },       // -50 bb
    { game: 'Stud Hi', stakes: '10/20', net: -400, hours: 2 }, // -20 BB
  ]);
  close(r.bb.rate, 0); assert.equal(r.bb.n, 2); close(r.bb.hours, 10);
  close(r.BB.rate, 0); assert.equal(r.BB.n, 2); close(r.BB.hours, 6);
  const r2 = bbHourly([
    { game: 'NLH', stakes: '2/5', net: 500, hours: 5 },        // +100 bb → 20 bb/hr
    { game: 'LHE', stakes: '4/8', net: 80, hours: 4 },         // +10 BB → 2.5 BB/hr
  ]);
  close(r2.bb.rate, 20); close(r2.BB.rate, 2.5);
  assert.deepEqual(bbFigures(r2).map((f) => [f.unit, f.text, f.full, f.label]),
    [['bb', '+20.0', '+20.0 bb/hr', 'bb/hr'], ['BB', '+2.5', '+2.5 BB/hr', 'BB/hr']]);
});

test('bbHourly: only the units that qualify are shown', () => {
  const onlyLimit = bbHourly([{ game: 'LHE', stakes: '4/8', net: 80, hours: 4 }]);
  assert.equal(onlyLimit.bb, null);
  assert.deepEqual(bbFigures(onlyLimit).map((f) => f.unit), ['BB']);
  const onlyBlinds = bbHourly([{ game: 'NLH', stakes: '2/5', net: 80, hours: 4 }]);
  assert.deepEqual(bbFigures(onlyBlinds).map((f) => f.unit), ['bb']);
});

test('bbHourly: a EUR session needs no conversion: the net and the blind are in the same money', () => {
  // EUR 1/2 night: +EUR 200 in 4 h = +100 bb / 4 h = 25 bb/hr. The same night in USD at 1/2 reads the same.
  const eur = bbHourly([{ game: 'NLH', stakes: '€1/€2', net: 200, hours: 4 }]);
  const usd = bbHourly([{ game: 'NLH', stakes: '$1/$2', net: 200, hours: 4 }]);
  close(eur.bb.rate, 25); close(usd.bb.rate, 25);
  // And EUR and USD sessions combine in blinds.
  const both = bbHourly([
    { game: 'NLH', stakes: '€1/€2', net: 200, hours: 4 },
    { game: 'NLH', stakes: '$2/$5', net: -50, hours: 1 },
  ]);
  close(both.bb.rate, (100 - 10) / 5);
});

test('bbHourly: the sign agrees with the session\'s net (a winning night is positive, a losing one negative)', () => {
  assert.ok(bbHourly([{ game: 'NLH', stakes: '2/5', net: 1, hours: 9 }]).bb.rate > 0);
  assert.ok(bbHourly([{ game: 'NLH', stakes: '2/5', net: -1, hours: 9 }]).bb.rate < 0);
  assert.equal(bbHourly([{ game: 'NLH', stakes: '2/5', net: 0, hours: 9 }]).bb.rate, 0);
});

test('bbAccumulator: add() as the tables loop; the same answer as bbHourly', () => {
  const list = [
    { game: 'NLH', stakes: '2/5', net: 500, hours: 4 },
    { game: 'NLH', stakes: '', net: 5, hours: 4 },
    { game: 'LHE', stakes: '4/8', net: 80, hours: 4 },
  ];
  const acc = bbAccumulator();
  for (const s of list) acc.add(s);
  assert.deepEqual(acc.result(), bbHourly(list));
  assert.deepEqual(bbAccumulator().result(), { bb: null, BB: null });
});

// ── showing it ─────────────────────────────────────────────────────────────────────────────
test('fmtBbRate: one decimal, signed, U+2212 for a loss, a dash for unknown (never 0)', () => {
  assert.equal(fmtBbRate(3.44), '+3.4');
  assert.equal(fmtBbRate(3.46), '+3.5');
  assert.equal(fmtBbRate(-1.24), '−1.2');
  assert.equal(fmtBbRate(12), '+12.0');
  assert.equal(fmtBbRate(1234.56), '+1,234.6');
  assert.equal(fmtBbRate(null), '—');
  assert.equal(fmtBbRate(undefined), '—');
  assert.equal(fmtBbRate(NaN), '—');
  assert.equal(fmtBbRate('x'), '—');
});

test('fmtBbRate: a rate that rounds to zero is "0.0", unsigned (and bbTone sees no sign)', () => {
  assert.equal(fmtBbRate(0), '0.0');
  assert.equal(fmtBbRate(0.04), '0.0');
  assert.equal(fmtBbRate(-0.04), '0.0');
  assert.equal(bbTone(0.04), 0);
  assert.equal(bbTone(-0.04), 0);
  assert.equal(bbTone(0.06), 1);
  assert.equal(bbTone(-0.06), -1);
  assert.equal(bbTone(null), 0);
});

test('fmtBbHr: the unit goes with the figure; unknown is just a dash', () => {
  assert.equal(fmtBbHr(3.4), '+3.4 bb/hr');
  assert.equal(fmtBbHr(-1.2, 'bb'), '−1.2 bb/hr');
  assert.equal(fmtBbHr(0.8, 'BB'), '+0.8 BB/hr');
  assert.equal(fmtBbHr(null), '—');
  assert.equal(unitLabel('bb'), 'bb/hr');
  assert.equal(unitLabel('BB'), 'BB/hr');
});

test('bbBasis: sessions and hours behind a figure, for a title', () => {
  assert.equal(bbBasis({ n: 1, hours: 1 }), '1 session, 1 hour');
  assert.equal(bbBasis({ n: 3, hours: 12.54 }), '3 sessions, 12.5 hours');
  assert.equal(bbBasis(null), '');
});

test('bbColumn: the head and the cells of a table column that holds one unit or both', () => {
  const blinds = { bb: { rate: 3.4, n: 2, hours: 5, blinds: 17 }, BB: null };
  const bigBets = { bb: null, BB: { rate: 0.8, n: 1, hours: 4, blinds: 3.2 } };
  const both = { bb: { rate: -1.2, n: 1, hours: 2, blinds: -2.4 }, BB: { rate: 0.8, n: 1, hours: 4, blinds: 3.2 } };
  const none = { bb: null, BB: null };

  const a = bbColumn([blinds, none]);
  assert.equal(a.label, 'bb/hr'); assert.equal(a.mixed, false);
  assert.deepEqual(a.lines(blinds).map((l) => l.text), ['+3.4']);
  assert.deepEqual(a.lines(none).map((l) => [l.text, l.unit, l.tone]), [['—', null, 0]], 'unknown is one dash');

  const b = bbColumn([bigBets, none]);
  assert.equal(b.label, 'BB/hr');
  assert.deepEqual(b.lines(bigBets).map((l) => l.text), ['+0.8'], 'a column of big bets is headed BB/hr; no suffix needed');

  const c = bbColumn([blinds, bigBets]);
  assert.equal(c.label, 'bb/hr'); assert.equal(c.mixed, true);
  assert.deepEqual(c.lines(bigBets).map((l) => l.text), ['+0.8 BB'], 'in a mixed column a big-bet figure carries its unit');
  assert.deepEqual(c.lines(blinds).map((l) => l.text), ['+3.4']);
  assert.deepEqual(c.lines(both).map((l) => l.text), ['−1.2', '+0.8 BB'], 'a room with both gets both, one per line, never summed');
  assert.deepEqual(c.lines(both).map((l) => l.tone), [-1, 1]);

  assert.equal(bbColumn([]).label, 'bb/hr');
  assert.equal(bbColumn(null).label, 'bb/hr');
});

test('cashBbGroups: overall and the three breakdowns, by the server\'s own group keys; live sessions are skipped', () => {
  const S = (o) => ({ live: false, ended_at: 'x', game: 'NLH', stakes: '2/5', room: 'Borgata', venue_slug: null, net: 0, hours: 4, ...o });
  const g = cashBbGroups([
    S({ net: 500 }),                                              // +100 bb
    S({ game: 'nlh', room: 'BORGATA', net: 250, hours: 5 }),      // +50 bb: the same game and room, spelled differently
    S({ game: 'PLO', stakes: '1/2', room: 'Parx', venue_slug: 'parx', net: -200, hours: 2 }),   // -100 bb
    S({ game: 'LHE', stakes: '4/8', room: 'Parx', venue_slug: 'parx', net: 80, hours: 4 }),     // +10 BB
    S({ live: true, ended_at: null, net: 9999 }),
  ]);
  assert.equal(g.overall.bb.n, 3);
  close(g.overall.bb.rate, 50 / 11);
  close(g.overall.BB.rate, 2.5);
  assert.deepEqual([...g.stakes.keys()].sort(), ['lhe|4/8', 'nlh|2/5', 'plo|1/2']);
  close(g.stakes.get('nlh|2/5').bb.rate, 150 / 9);
  assert.deepEqual([...g.game.keys()].sort(), ['lhe', 'nlh', 'plo']);
  assert.deepEqual([...g.room.keys()].sort(), ['room:borgata', 'slug:parx']);
  close(g.room.get('slug:parx').bb.rate, -50);
  close(g.room.get('slug:parx').BB.rate, 2.5);
  assert.deepEqual(cashBbGroups(null).overall, { bb: null, BB: null });
});
