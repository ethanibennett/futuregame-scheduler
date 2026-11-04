// npm run test:replayer-drill. A saved hand -> the spot "Study this draw" sends. Pure, no solver.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDrawStudySpot } from '../draw-study-spot.js';

const fixture = () => JSON.parse(readFileSync(new URL('../../../../test/hh-io/fixtures/28-27td.json', import.meta.url), 'utf8'));
const unwrap = (h) => h.hand || h;
const spotAt = (streetIdx, hand = unwrap(fixture())) => buildDrawStudySpot({ hand, game: 'td27', streetIdx, heroIdx: hand.heroIdx });

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };

t('the first draw: the betting, then the opponent who draws first, and the hero open', () => {
  const s = spotAt(0);
  assert.equal(s.seat, 0);
  assert.equal(s.hero, '2h 4c 7d Ks Qs');
  assert.equal(s.hist, '0:r 1:c 1:d2');
  assert.equal(s.drawn, '');
  assert.equal(s.now, '2h 4c 7d Ks Qs');
  assert.equal(s.street, 0);
});

t('a later draw starts from the STARTING hand, with the real replacements in order', () => {
  const s = spotAt(1);
  assert.equal(s.hero, '2h 4c 7d Ks Qs');
  assert.equal(s.hist, '0:r 1:c 1:d2 0:d:KsQs 1:k 0:b 1:c 1:d1');
  assert.equal(s.drawn, '8d 3c');
  assert.equal(s.now, '2h 4c 7d 8d 3c');
});

t('the third draw, after a stand-pat-free line, reads a raise over a bet', () => {
  const s = spotAt(2);
  assert.equal(s.hist, '0:r 1:c 1:d2 0:d:KsQs 1:k 0:b 1:c 1:d1 0:d:8d 1:b 0:r 1:c 1:d0');
  assert.equal(s.drawn, '8d 3c 5s');
  assert.equal(s.now, '2h 4c 7d 3c 5s');
});

t('the opponent goes over as counts, never their cards, even when known', () => {
  const hand = unwrap(fixture());
  hand.streets[0].draws[0].discardedCards = 'KhQh';
  hand.streets[0].draws[0].newCards = '9c9d';
  hand.streets[0].cards.opponents = ['', '', '3s5d6h8cTh'];
  assert.ok(spotAt(1, hand).hist.includes('1:d2'));
  assert.ok(!/Kh|Qh|9c|9d|3s/.test(JSON.stringify(spotAt(1, hand))));
});

t('the hero in the big blind draws first, with nothing of the opponent on this street', () => {
  const hand = unwrap(fixture());
  hand.heroIdx = 2;
  hand.streets[0].cards.hero = '3s5d6hJcTh';
  hand.streets[0].draws[0] = { player: 2, discarded: 2, discardedCards: 'JcTh', newCards: '4h2c' };
  hand.streets[0].draws[1] = { player: 0, discarded: 2, discardedCards: '', newCards: '' };
  const first = buildDrawStudySpot({ hand, game: 'td27', streetIdx: 0, heroIdx: 2 });
  assert.equal(first.seat, 1);
  assert.equal(first.hist, '0:r 1:c');
  const second = buildDrawStudySpot({ hand, game: 'td27', streetIdx: 1, heroIdx: 2 });
  assert.equal(second.hist.split(' ').slice(0, 4).join(' '), '0:r 1:c 1:d:JcTh 0:d2');
  assert.equal(second.drawn, '4h 2c');
  assert.equal(second.hist.split(' ').at(-1), '1:c'); // the street's betting closes it, and the hero draws next
});

t('it refuses what it cannot know, and says which', () => {
  assert.match(spotAt(3).refused, /final betting round/);

  let hand = unwrap(fixture());
  hand.streets[0].draws[1].newCards = '';
  assert.match(spotAt(1, hand).refused, /cards you drew on the first draw/);
  assert.ok(!spotAt(0, hand).refused, 'the first draw needs nothing recorded of itself');

  hand = unwrap(fixture());
  hand.streets[0].draws[1].discardedCards = '';
  assert.match(spotAt(1, hand).refused, /cards you threw on the first draw/);

  hand = unwrap(fixture());
  hand.streets[0].cards.hero = '2h4c7dKxQx';
  assert.match(spotAt(0, hand).refused, /starting cards/);

  hand = unwrap(fixture());
  hand.streets[0].draws.splice(0, 1);
  assert.match(spotAt(0, hand).refused, /opponent's first draw is not recorded/);

  hand = unwrap(fixture());
  hand.streets[0].actions = [{ player: 0, action: 'fold', amount: 0 }, { player: 1, action: 'call', amount: 1 }, { player: 2, action: 'check', amount: 0 }];
  assert.match(spotAt(0, hand).refused, /You folded/);

  hand = unwrap(fixture());
  hand.streets[1].actions.push({ player: 2, action: 'fold', amount: 0 });
  assert.match(spotAt(1, hand).refused, /ended before/);
  assert.ok(!spotAt(0, hand).refused, 'a fold later on does not touch an earlier draw');
});

t('a third player with chips in makes it multiway; a third who only folded does not', () => {
  const hand = unwrap(fixture());
  hand.streets[0].actions[1] = { player: 1, action: 'call', amount: 1.5 };
  assert.match(spotAt(0, hand).refused, /heads-up, and 3 players/);
  assert.match(spotAt(0).notes.join(' '), /1 player folded without putting chips in/);
});

t('a street with no betting recorded reads as two checks, and says so', () => {
  const hand = unwrap(fixture());
  hand.streets[1].actions = [];
  const s = spotAt(1, hand);
  assert.ok(s.hist.endsWith('0:d:KsQs 1:k 0:k 1:d1'));
  assert.match(s.notes.join(' '), /two checks/);
});

t('an all-in reads as the call or raise its chips make it, and says so', () => {
  let hand = unwrap(fixture());
  hand.streets[1].actions = [
    { player: 2, action: 'bet', amount: 1 },
    { player: 0, action: 'all-in', amount: 1 },
  ];
  assert.ok(spotAt(1, hand).hist.endsWith('1:b 0:c 1:d1'));
  assert.match(spotAt(1, hand).notes.join(' '), /read as a call/);
  hand = unwrap(fixture());
  hand.streets[1].actions = [
    { player: 2, action: 'bet', amount: 1 },
    { player: 0, action: 'all-in', amount: 9 },
    { player: 2, action: 'call', amount: 8 },
  ];
  assert.ok(spotAt(1, hand).hist.endsWith('1:b 0:r 1:c 1:d1'));
});

t('an action the betting has no word for refuses', () => {
  const hand = unwrap(fixture());
  hand.streets[0].actions[0] = { player: 0, action: 'straddle', amount: 2 };
  assert.match(spotAt(0, hand).refused, /"straddle"/);
});

console.log(`draw-study-spot: ${n} ok`);
