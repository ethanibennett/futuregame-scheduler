// npm run test:replayer-drill: the drill's hand builder and the words on its two graders.
import assert from 'node:assert/strict';
import {
  encodeDiscard, parseDrillAction, drillStart, drillStep, buildDrillHand, opponentDrawNote,
  heroActionIndexForStreet, discardWords, studyVerdict, drillOptimalCaveat, drillGradeSource,
} from '../replayer-drill.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n', e.message); process.exitCode = 1; }
};

test('a discard is encoded the way the server parses it', () => {
  assert.equal(encodeDiscard([]), 'd:');
  assert.equal(encodeDiscard(['Kc', '9s']), 'd:9sKc');
  assert.equal(encodeDiscard(['7h', '7c', '7s']), 'd:7c7h7s');
});

test('the engine\'s labels give the replayer its actions and figures', () => {
  assert.deepEqual(parseDrillAction('Raise to 6', 'r'), { action: 'raise', amount: 6 });
  assert.deepEqual(parseDrillAction('Raise to 4', 'b'), { action: 'raise', amount: 4 }); // an opponent's 'b' can read as a raise
  assert.deepEqual(parseDrillAction('Call 2', 'c'), { action: 'call', amount: 2 });
  assert.deepEqual(parseDrillAction('Bet 8', 'b'), { action: 'bet', amount: 8 });
  assert.deepEqual(parseDrillAction('Check', 'k'), { action: 'check', amount: 0 });
  assert.deepEqual(parseDrillAction('Fold', 'f'), { action: 'fold', amount: 0 });
  assert.deepEqual(parseDrillAction('Bring-in 2', 'br'), { action: 'bring-in', amount: 2 });
  assert.deepEqual(parseDrillAction('Complete to 4', 'co'), { action: 'raise', amount: 4 });
});

const bet = (seat, street, actionId, label) => ({ seat, street, phase: 'bet', actionId, label });
const draw = (seat, street, actionId) => ({ seat, street, phase: 'draw', actionId, label: 'Draw' });

// Seat 0 is the hero: small blind, calls, faces a raise, calls, the opponent draws 2, the hero 1.
function playedDrawHand() {
  let d = drillStart('td27', { seed: 8, heroSeat: 0 });
  d = drillStep(d, {
    state: { street: 0, phase: 'bet', pot: 3, heroCards: ['8h', '7s', '9s', 'Jc', '7c'], oppDrawCounts: [], log: [] },
    legalActions: [{ id: 'c', label: 'Call 1' }],
  });
  d = drillStep(d, {
    state: {
      street: 0, phase: 'draw', pot: 8, heroCards: ['8h', '7s', '9s', 'Jc', '7c'], oppDrawCounts: [2],
      log: [bet(0, 0, 'c', 'Call 1'), bet(1, 0, 'b', 'Raise to 4'), bet(0, 0, 'c', 'Call 2'), draw(1, 0, 'd2')],
    },
    drawDecision: { heroCards: ['8h', '7s', '9s', 'Jc', '7c'] },
    legalActions: [{ id: 'd0' }, { id: 'd3' }],
  }, 'c');
  return d;
}

test('a hand in progress: real cards, a count for the opponent, nothing revealed', () => {
  const d = playedDrawHand();
  const hand = buildDrillHand(d, 'E. Bennett');
  assert.equal(hand.gameType, '2-7 TD');
  assert.equal(hand.heroIdx, 0);
  assert.deepEqual(hand.players.map((p) => p.position), ['SB', 'BB']);
  assert.equal(hand.players[0].name, 'E. Bennett');
  assert.equal(hand.players[1].name, 'Solver');
  assert.equal(hand.streets.length, 1);
  assert.equal(hand.streets[0].cards.hero, '8h7s9sJc7c');
  assert.deepEqual(hand.streets[0].cards.opponents, ['']);
  assert.deepEqual(hand.streets[0].actions, [
    { player: 0, action: 'call', amount: 1 },
    { player: 1, action: 'raise', amount: 2 }, // a raise to 4 from the big blind adds 2
    { player: 0, action: 'call', amount: 2 },
  ]);
  const inPot = hand.blinds.sb + hand.blinds.bb + hand.streets[0].actions.reduce((sum, a) => sum + a.amount, 0);
  assert.equal(inPot, d.state.pot);
  assert.deepEqual(hand.streets[0].draws, [{ player: 1, discarded: 2, discardedCards: '', newCards: '' }]);
  assert.equal(hand.result, undefined);
  assert.equal(opponentDrawNote(d.state), 'Solver drew 2');
});

test('the hero\'s draw records what they threw and what they were dealt', () => {
  let d = playedDrawHand();
  d = drillStep(d, {
    state: {
      street: 1, phase: 'bet', pot: 8, heroCards: ['8h', '7s', '9s', 'Jc', 'Tc'], oppDrawCounts: [2],
      log: [...d.state.log, draw(0, 0, 'd:7c')],
    },
    legalActions: [{ id: 'k', label: 'Check' }],
  }, 'd:7c');
  const hand = buildDrillHand(d);
  assert.deepEqual(d.heroActions, ['c', 'd:7c']);
  assert.equal(hand.streets.length, 2);
  assert.equal(hand.streets[1].name, 'First Draw');
  assert.deepEqual(hand.streets[0].draws[1], { player: 0, discarded: 1, discardedCards: '7c', newCards: 'Tc' });
  assert.equal(heroActionIndexForStreet(d.state, 0, 0), 2); // Call 1, Call 2, then the draw
  assert.equal(heroActionIndexForStreet(d.state, 0, 2), -1);
});

test('a showdown reveals the opponent and names the winner; a stand pat reads as one', () => {
  let d = playedDrawHand();
  d = drillStep(d, {
    state: { street: 0, phase: 'bet', pot: 8, heroCards: ['8h', '7s', '9s', 'Jc', '7c'], oppDrawCounts: [0], log: [bet(0, 0, 'f', 'Fold')] },
    legalActions: null, handOver: true,
    result: { heroDelta: -6, winner: 'opp', endType: 'showdown', showdown: { oppCards: ['2c', '3c', '5s', '7h', '8c'] } },
    grades: [],
  }, 'f');
  const hand = buildDrillHand(d);
  assert.deepEqual(hand.streets[0].cards.opponents, ['2c3c5s7h8c']);
  assert.deepEqual(hand.result, { winners: [{ playerIdx: 1, split: false }] });
  assert.equal(opponentDrawNote({ phase: 'draw', street: 0, oppDrawCounts: [0] }), 'Solver stood pat');
  assert.equal(opponentDrawNote({ phase: 'bet', street: 0, oppDrawCounts: [0] }), null);
});

test('stud: each street\'s own cards; hole cards hidden until a showdown', () => {
  const live = { street: 1, pot: 6, heroUp: ['Kc', '5c'], heroDown: ['7h', 'Ts'], oppUp: ['8c', 'Kh'], deadCards: [], toAct: 1, log: [bet(1, 0, 'br', 'Bring-in 2'), bet(0, 0, 'c', 'Call 2')] };
  let d = drillStart('razz', { seed: 3, heroSeat: 1 });
  d = drillStep(d, { state: { ...live, street: 0, pot: 2, heroUp: ['Kc'], oppUp: ['8c'], log: [] }, legalActions: [] });
  d = drillStep(d, { state: live, legalActions: [] }, 'br');
  const hand = buildDrillHand(d);
  assert.equal(hand.gameType, 'Razz');
  assert.equal(hand.heroIdx, 1);
  assert.equal(hand.blinds.ante, 1);
  assert.equal(hand.blinds.bringIn, 2);
  assert.equal(hand.streets[0].cards.hero, '7hTsKc');
  assert.deepEqual(hand.streets[0].cards.opponents, ['8c']);
  assert.equal(hand.streets[1].cards.hero, '5c');
  assert.deepEqual(hand.streets[1].cards.opponents, ['Kh']);
  assert.deepEqual(hand.streets[0].actions[0], { player: 1, action: 'bring-in', amount: 2 });

  const over = { street: 4, pot: 62, heroUp: ['Kc', '5c', 'Kd', '6c'], heroDown: ['7h', 'Ts', 'Th'], oppUp: ['8c', 'Kh', '8s', 'Td'], deadCards: [], log: live.log };
  d = drillStep(d, { state: over, handOver: true, result: { winner: 'hero', showdown: { oppDown: ['5d', '3c', '4h'] } }, grades: [] }, 'c');
  const end = buildDrillHand(d);
  assert.deepEqual(end.streets[0].cards.opponents, ['5d3c8c']);
  assert.deepEqual(end.streets[4].cards.opponents, ['4h']);
  assert.equal(end.streets[4].cards.hero, 'Th');
  assert.deepEqual(end.result, { winners: [{ playerIdx: 1, split: false }] });
});

test('stud: the ante is what was in before anyone acted, even when the opponent has brought in', () => {
  let d = drillStart('razz', { seed: 4, heroSeat: 0 });
  d = drillStep(d, {
    state: { street: 0, pot: 4, heroUp: ['Kc'], heroDown: ['7h', 'Ts'], oppUp: ['8c'], deadCards: [], log: [bet(1, 0, 'br', 'Bring-in 2')] },
    legalActions: [],
  });
  const hand = buildDrillHand(d);
  assert.equal(hand.blinds.ante, 1);
  assert.equal(hand.blinds.bringIn, 2);
  // Everything on the table adds up to the server's pot.
  const inPot = 2 * hand.blinds.ante + hand.streets[0].actions.reduce((sum, a) => sum + a.amount, 0);
  assert.equal(inPot, d.state.pot);
});

const table = (rows, bandWidth) => ({ rows, nRows: rows.length, bandWidth });
const row = (action, tied, diff = 0, se = 0.5) => ({ action, tied, diff, se, seIsLowerBound: true, ev: 1 + diff, offered: false });

test('inside a band of several there is no rank to give, and it says so with no figure', () => {
  const v = studyVerdict(table([row('d:Jc', true), row('d:9sJc', true, -0.2), row('d:', false, -4)], 2), 'd:9sJc');
  assert.equal(v.kind, 'not-rankable');
  assert.equal(v.headline, 'Not rankable');
  assert.match(v.detail, /2 of 3/);
  assert.doesNotMatch(v.headline + v.detail, /−/);
  assert.deepEqual(v.band, ['Throw Jc']);
});

test('outside the band it reports the loss; alone at the top it says best', () => {
  const t = table([row('d:Jc', true), row('d:', false, -4.55, 0.81)], 1);
  const below = studyVerdict(t, 'd:');
  assert.equal(below.kind, 'below');
  assert.equal(below.headline, '−4.55 chips');
  assert.match(below.detail, /±0\.81 at least/);
  const best = studyVerdict(t, 'd:Jc');
  assert.equal(best.kind, 'best');
});

test('a discard the table does not hold is never reported as fine', () => {
  assert.equal(studyVerdict(table([row('d:Jc', true)], 1), 'd:9s').kind, 'unpriced');
  assert.equal(studyVerdict(null, 'd:9s').kind, 'unpriced');
});

test('the drill\'s floor at 0 is called out only when it hid something', () => {
  const g = {
    kind: 'draw', explicitDiscard: true, evLoss: 0, heroActionId: 'd:7c', bestActionId: 'd3',
    gtoMix: { actions: ['d0', 'd3'] }, perActionEV: { d0: -3, d3: 1, 'd:7c': 2.5 },
  };
  assert.match(drillOptimalCaveat(g), /all 2 options/);
  assert.equal(drillOptimalCaveat({ ...g, perActionEV: { d0: -3, d3: 1, 'd:7c': 1 } }), null);
  assert.equal(drillOptimalCaveat({ ...g, evLoss: 3 }), null);
  assert.equal(drillOptimalCaveat({ ...g, kind: 'bet' }), null);
  assert.equal(drillOptimalCaveat({ ...g, explicitDiscard: false }), null);
});

test('which tool answered is named', () => {
  assert.equal(drillGradeSource({}), 'blueprint');
  assert.equal(drillGradeSource({ gradeSource: 'blueprint' }), 'blueprint');
  assert.equal(drillGradeSource({ gradeSource: 'oracle' }), 'exact re-solve');
  assert.equal(drillGradeSource({ gradeSource: 'certified-net' }), 'certified net');
});

test('discards read as words', () => {
  assert.equal(discardWords('d:'), 'Stand pat');
  assert.equal(discardWords('d0'), 'Stand pat');
  assert.equal(discardWords('d:7c9sJc'), 'Throw 7c 9s Jc');
});

console.log(`replayer-drill: ${passed} passed`);
