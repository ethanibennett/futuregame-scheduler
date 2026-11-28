// ── Super Stud ──────────────────────────────────────────────────────────────────────────────────────
// Owner, 2026-11-28: "discard is after 3rd street betting, before 4th is dealt, applies to any stud game". Any stud game
// dealt two extra down cards on 3rd street, four down and the door, each player still in throwing two of their down
// cards after 3rd street's betting, before 4th is dealt; from there it plays and scores as its own game. The deal and the
// count are the published rules' (BARGE rulebook, Super Stud: "four cards face down then one card up", "discard two
// cards before fourth street is dealt"; the Asian Poker Tour's handbook: "discard 2 of their down cards").
//
// A hand is marked `superStud: true`. 3rd street's `cards.hero` stays what it is in every stud hand, the two down cards
// kept and the door, so whatever scores, settles, exports or replays a stud hand reads it unchanged; the hero's two
// thrown cards are `cards.heroThrown` beside it. An opponent's throw is never seen, so it is never recorded. While the
// hand is typed, the five cards dealt are `cards.heroSuper` (the entry's field) until the deal is split.
// Pure: src/utils/__tests__/super-stud.test.mjs.
import { parseCardNotation } from './poker-engine.js';

/** How many down cards each player throws: the extra down cards 3rd street deals. */
export const SUPER_THROW = 2;
/** Down cards on 3rd street before the throw. */
export const SUPER_DOWN = 2 + SUPER_THROW;
/** Where the thrown cards sit in a 3rd street row before the throw (superThirdOnFelt): after the two kept. */
export const SUPER_THROWN_IDX = Array.from({ length: SUPER_THROW }, (_, i) => 2 + i);
/** The down slots of that row (CardRow's `studDown`): every card but the door. */
export const SUPER_DOWN_IDX = Array.from({ length: SUPER_DOWN }, (_, i) => i);

const known = (s) => parseCardNotation(s || '').filter((c) => c.suit !== 'x').map((c) => c.rank + c.suit);

/** 3rd street as dealt, for the entry's field: the field's own text while it is being typed, else the kept down cards,
 *  the thrown ones and the door. */
export function superDealText(cards) {
  const c = cards || {};
  if (typeof c.heroSuper === 'string') return c.heroSuper;
  const h = known(c.hero), t = known(c.heroThrown);
  if (h.length !== 3) return (c.hero || '') + (c.heroThrown || '');
  return [h[0], h[1], ...t, h[2]].join('');
}

/** The five cards dealt (down cards first, the door last) as 3rd street's own and the throw: the first two down cards
 *  kept until the throw says otherwise. The same five split before keep that split (the throw is chosen later, after
 *  the betting, and going back to the deal must not undo it). None dealt: none either way. */
export function splitSuperDeal(dealt, prev) {
  const d = dealt || [];
  if (d.length !== SUPER_DOWN + 1) return { hero: d.join(''), heroThrown: '' };
  const p = prev || {};
  const ph = known(p.hero), pt = known(p.heroThrown);
  const was = [...ph, ...pt];
  if (was.length === d.length && d.every((x) => was.includes(x)) && ph[2] === d[SUPER_DOWN]) return { hero: ph.join(''), heroThrown: pt.join('') };
  return { hero: d[0] + d[1] + d[SUPER_DOWN], heroThrown: d.slice(2, SUPER_DOWN).join('') };
}

/** The hero's down cards before the throw, for the throw screen: the kept ones, then the thrown. */
export function superDowns(cards) {
  const c = cards || {};
  const h = known(c.hero);
  return [h[0], h[1], ...known(c.heroThrown)].filter(Boolean);
}

/** The throw: 3rd street's own (the down cards not picked, then the door) and the picked cards. */
export function applySuperThrow(cards, pick) {
  const c = cards || {};
  const door = known(c.hero)[2] || '';
  const kept = superDowns(c).filter((x) => !pick.includes(x));
  return { hero: kept.join('') + door, heroThrown: pick.join('') };
}

/** Whether the hero has a throw to record: in the hand at the end of 3rd street, with all five cards known. */
export function superThrowAsked(hand, heroFolded) {
  if (!hand || !hand.superStud || heroFolded) return false;
  const c = ((hand.streets || [])[0] || {}).cards || {};
  return known(c.hero).length === 3 && known(c.heroThrown).length === SUPER_THROW;
}

/** The hero's 3rd street on the felt before the throw: the kept down cards, the thrown ones (backs where none were
 *  recorded), the door. `third` is 3rd street's cards.hero; with its three cards not there, it is left as it is. */
export function superThirdOnFelt(third, thrown) {
  const h = parseCardNotation(third || '');
  if (h.length !== 3) return third || '';
  const t = parseCardNotation(thrown || '');
  const throwText = t.length === SUPER_THROW ? t.map((c) => c.rank + c.suit).join('') : 'Ax'.repeat(SUPER_THROW);
  const tok = (c) => c.rank + c.suit;
  return tok(h[0]) + tok(h[1]) + throwText + tok(h[2]);
}

/** The game's name with Super in front, for a Super hand ("Super Stud Hi", "Super Razz"). */
export const superName = (hand, name) => (hand && hand.superStud ? 'Super ' + name : name);
