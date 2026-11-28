// node --test src/utils/__tests__/super-stud.test.mjs   (from vite-app/)
//
// Super Stud (owner, 2026-11-28: "discard is after 3rd street betting, before 4th is dealt, applies to any stud game"):
// four down and the door on 3rd street, two down cards thrown after its betting. 3rd street's cards.hero stays two down
// and the door, the throw beside it, so the hand scores and replays as its own game from 4th street on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPER_THROW, SUPER_DOWN, SUPER_THROWN_IDX, SUPER_DOWN_IDX, superDealText, splitSuperDeal, superDowns, applySuperThrow,
  superThrowAsked, superThirdOnFelt, superName,
} from '../super-stud.js';
import { evaluateShowdown, parseCardNotation as P } from '../poker-engine.js';

globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {} };
const { encodeHand, decodeHand } = await import('../hand-shorthand.js');
const { prepareHand } = await import('../hand-history/index.js');
const { autoTitle } = await import('../hand-title.js');

const C = (s) => s.match(/../g);

test('the published deal: four down and one up, two thrown', () => {
  assert.equal(SUPER_THROW, 2);
  assert.equal(SUPER_DOWN, 4);
  assert.deepEqual(SUPER_THROWN_IDX, [2, 3]);
  assert.deepEqual(SUPER_DOWN_IDX, [0, 1, 2, 3]);
});

test('the five dealt split into 3rd street (two down and the door) and the two thrown, until the throw', () => {
  const split = splitSuperDeal(C('AhAd2c2d7s'), {});
  assert.deepEqual(split, { hero: 'AhAd7s', heroThrown: '2c2d' });
  assert.deepEqual(splitSuperDeal([], {}), { hero: '', heroThrown: '' });
  // The throw chosen after the betting stands when the same five are entered again.
  const thrown = applySuperThrow(split, ['Ah', 'Ad']);
  assert.deepEqual(thrown, { hero: '2c2d7s', heroThrown: 'AhAd' });
  assert.deepEqual(splitSuperDeal(C('AhAd2c2d7s'), thrown), thrown);
  // Other cards: split afresh.
  assert.deepEqual(splitSuperDeal(C('AhAd2c3d7s'), thrown), { hero: 'AhAd7s', heroThrown: '2c3d' });
});

test('the entry field and the throw screen read the deal back', () => {
  assert.equal(superDealText({ hero: '2c2d7s', heroThrown: 'AhAd' }), '2c2dAhAd7s');
  assert.equal(superDealText({ heroSuper: 'Ah7', hero: '', heroThrown: '' }), 'Ah7');
  assert.deepEqual(superDowns({ hero: '2c2d7s', heroThrown: 'AhAd' }), ['2c', '2d', 'Ah', 'Ad']);
  assert.equal(superThrowAsked({ superStud: true, streets: [{ cards: { hero: '2c2d7s', heroThrown: 'AhAd' } }] }, false), true);
  assert.equal(superThrowAsked({ superStud: true, streets: [{ cards: { hero: '2c2d7s', heroThrown: 'AhAd' } }] }, true), false, 'a folded hero throws nothing');
  assert.equal(superThrowAsked({ superStud: true, streets: [{ cards: { hero: '', heroThrown: '' } }] }, false), false, 'unknown cards: nothing to ask');
  assert.equal(superThrowAsked({ streets: [{ cards: { hero: '2c2d7s', heroThrown: 'AhAd' } }] }, false), false);
});

test('on the felt, 3rd street holds four down and the door before the throw', () => {
  assert.equal(superThirdOnFelt('2c2d7s', 'AhAd'), '2c2dAhAd7s');
  assert.equal(superThirdOnFelt('2c2d7s', ''), '2c2dAxAx7s', 'a throw not recorded is two backs');
  assert.equal(superThirdOnFelt('', 'AhAd'), '');
  assert.equal(superName({ superStud: true }, 'Razz'), 'Super Razz');
  assert.equal(superName({}, 'Razz'), 'Razz');
});

/* A heads-up Super Stud Hi hand: the hero throws two aces and keeps a pair of deuces; the opponent's kings win. Had the
   aces stayed, the hero's two pair would. */
function superHand() {
  const st = (name, hero, opp, actions) => ({ name, cards: { hero, opponents: [opp], board: '' }, actions, draws: [] });
  return {
    gameType: 'Stud Hi', gameMode: 'mtt', superStud: true, heroIdx: 0,
    blinds: { sb: 0, bb: 200, ante: 25, bigBet: 400, bringIn: 50 },
    players: [{ name: 'Hero', position: 'Seat 1', startingStack: 10000 }, { name: 'Opp 1', position: 'Seat 2', startingStack: 10000 }],
    streets: [
      { ...st('3rd Street', '2c2d7s', 'KhKcQs', [{ player: 0, action: 'bring-in', amount: 50 }, { player: 1, action: 'call', amount: 50 }]), cards: { hero: '2c2d7s', heroThrown: 'AhAd', opponents: ['KhKcQs'], board: '' } },
      st('4th Street', '3d', '5c', [{ player: 1, action: 'check' }, { player: 0, action: 'check' }]),
      st('5th Street', '4c', '8d', [{ player: 1, action: 'check' }, { player: 0, action: 'check' }]),
      st('6th Street', '9h', 'Td', [{ player: 1, action: 'check' }, { player: 0, action: 'check' }]),
      st('7th Street', 'Jc', '6s', [{ player: 1, action: 'check' }, { player: 0, action: 'check' }]),
    ],
    result: { winners: [{ playerIdx: 1, split: false }] },
  };
}

test('a share link carries Super and the throw, and an older link reads as before', () => {
  const h = superHand();
  const link = encodeHand(h);
  assert.match(link.split('.')[1], /\*S$/, 'the S flag');
  assert.match(link.split('.')[2].split('/')[0], /,qAhAd$/, "3rd street's q token");
  const back = decodeHand(link);
  assert.equal(back.superStud, true);
  assert.equal(back.streets[0].cards.hero, '2c2d7s');
  assert.equal(back.streets[0].cards.heroThrown, 'AhAd');
  assert.deepEqual(back.streets[0].cards.opponents, ['KhKcQs']);
  assert.equal(encodeHand(back), link, 'round trip');
  // A plain stud hand's link is unchanged by any of it.
  const plain = { ...superHand() };
  delete plain.superStud;
  const plainLink = encodeHand(plain);
  assert.doesNotMatch(plainLink, /\*S|,q/);
  assert.equal(decodeHand(plainLink).superStud, undefined);
});

test('the thrown cards never score: the hand is its game from 4th street on', () => {
  const h = superHand();
  const heroSeven = P(h.streets.map((s) => s.cards.hero).join(''));
  const oppSeven = P('KhKcQs5c8dTd6s');
  assert.equal(heroSeven.length, 7);
  assert.deepEqual(evaluateShowdown('Stud Hi', [{ idx: 0, cards: heroSeven }, { idx: 1, cards: oppSeven }], []).map((w) => w.playerIdx), [1]);
});

test('PokerStars format has no Super Stud: the export refuses it, and the title says Super', () => {
  assert.throws(() => prepareHand(superHand(), {}), (e) => e.code === 'unsupported-game' || /Super Stud/.test(e.message));
  const plain = superHand();
  delete plain.superStud;
  assert.doesNotThrow(() => prepareHand(plain, {}));
  assert.match(autoTitle(superHand()), /^Super Stud Hi \| /);
});
