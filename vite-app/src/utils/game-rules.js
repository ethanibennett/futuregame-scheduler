/**
 * The rules of every game, one tap from the game picker (Features 33, 2026-11-11). Built from what the
 * replayer itself plays: the betting structure of the row, the family's order of play with the game's card
 * counts, and how the pot is won from poker-engine.js GAME_EVAL, so the words and the engine cannot drift
 * apart (test: utils/__tests__/game-rules.test.mjs holds every row's halves to GAME_EVAL).
 */
import { gameEvalFor } from './poker-engine.js';

const STRUCTURE = {
  'No Limit': 'No limit: any bet or raise up to all your chips. A raise is at least the last full bet or raise.',
  'Pot Limit': 'Pot limit: a bet or raise is at most the pot, counting the call first.',
  Limit: 'Limit: fixed bets, the small bet on the early streets and the big bet on the late ones, with a cap on raises.',
};

const HOLE = {
  "Hold'em": 2, Pineapple: 3, 'Short Deck': 2, Omaha: 4, 'Omaha 8/b': 4, 'Big O': 5, PLO5: 5, PLO6: 6, 'PLO6 8/b': 6, Courchevel: 5,
  Badugi: 4, 'Badeucy': 5, 'Badacey': 5, 'Dramaha Hi': 5, 'Dramaha 2-7': 5, 'Dramaha 49': 5, 'Dramaha 0': 5, Dramadugi: 5, Omajack: 4,
};

const HALF = {
  high: ['High', 'The best five-card poker hand.'],
  short: ['High, short deck', 'The best five-card hand from a 36-card deck (sixes up): a flush beats a full house, and A-6-7-8-9 is the lowest straight.'],
  lo8: ['Low, 8 or better', 'The lowest five unpaired cards eight or under, aces low; straights and flushes do not count. No such hand, and the high takes all.'],
  a5: ['Low, ace to five', 'The lowest five cards, aces low; straights and flushes do not count. A-2-3-4-5 is the best.'],
  '27': ['Low, deuce to seven', 'The lowest five cards with aces high; straights and flushes count against you. 7-5-4-3-2 is the best.'],
  badugi: ['Badugi', 'Four cards of different suits and ranks, the lowest wins; with none, the best three-card badugi, and so on.'],
  points: ['Points', 'Each card counts its points as the game sets them; the target total wins.'],
  blackjack: ['Blackjack', 'The hand nearest 21 without going over, as blackjack counts.'],
  omaha: ['Omaha high', 'The best hand of exactly two hole cards and three from the board.'],
};

function halvesOf(cfg) {
  if (!cfg) return [['Open-face', 'Scored by rows; the replayer shows the hands as dealt.']];
  if (cfg.type === 'high') return [cfg.method === 'short' ? HALF.short : (cfg.method === 'omaha' ? HALF.omaha : HALF.high)];
  if (cfg.type === 'low') return [cfg.lowType === 'a5' ? HALF.a5 : HALF['27']];
  if (cfg.type === 'badugi') return [HALF.badugi];
  if (cfg.type === 'hilo') {
    const hi = cfg.method === 'omaha' ? HALF.omaha : HALF.high;
    return [hi, cfg.anyLow ? ['Low', 'The lowest hand, aces low, with no qualifier: there is always a low.'] : HALF.lo8];
  }
  if (cfg.type === 'split-badugi') return [HALF.badugi, cfg.otherLow === '27' ? HALF['27'] : HALF.a5];
  if (cfg.type === 'halves') {
    const pick = (h) => (h && h.kind === 'low-a5' ? HALF.a5 : h && h.kind === 'low-27' ? HALF['27'] : h && h.kind === 'badugi' ? HALF.badugi
      : h && /points/.test(h.kind) ? HALF.points : h && h.kind === 'blackjack' ? HALF.blackjack : h && h.kind === 'omaha' ? HALF.omaha : HALF.high);
    const out = [pick(cfg.a), pick(cfg.b)];
    if (Array.isArray(cfg.labels)) out.forEach((h, i) => { out[i] = [cfg.labels[i] || h[0], h[1]]; });
    return out;
  }
  return [HALF.high];
}

function orderOf(row, n) {
  const g = row.game;
  if (row.family === 'stud') {
    return ['Everyone antes; each player gets two cards down and one up.', 'The lowest up card brings it in (the highest in a low game); third street is bet.',
      'Fourth, fifth and sixth streets: one card up each, a round of betting after each; the best showing hand acts first.',
      'Seventh street: one card down, a last round, then the showdown.'];
  }
  if (row.family === 'draw' || /^Archie|^Ari$/.test(g)) {
    const triple = /Triple|Badugi|Badeucy|Badacey|Archie|Ari/.test(g) && !/Single/.test(g);
    return [`Blinds; each player gets ${HOLE[g] || 5} cards down.`, 'A round of betting.',
      triple ? 'Three draws, each followed by a round of betting: discard any number and take as many.' : 'One draw: discard any number and take as many, then a last round.',
      'The showdown.'];
  }
  const omaha = row.family === 'omaha' || /^Dramaha|^Omajack/.test(g);
  const steps = [`Blinds; each player gets ${n} cards down.`, 'Preflop betting.', 'The flop: three cards up, a round of betting.', 'The turn and the river, one card each, a round after each.', 'The showdown.'];
  if (g === 'Courchevel') steps.splice(1, 0, 'The first flop card is shown before any betting.');
  if (g === 'Pineapple') steps.splice(3, 0, 'After the flop’s betting, each player throws one card away.');
  if (omaha && !/^Dramaha/.test(g)) steps.push('A hand uses exactly two hole cards and three from the board.');
  if (/^Dramaha/.test(g)) steps.splice(4, 0, 'After the flop, one draw: the hole cards play the other half as a five-card draw hand.');
  return steps;
}

export function rulesFor(row) {
  if (!row) return null;
  const cfg = gameEvalFor(row.gameType, {});
  const n = HOLE[row.game] || (row.family === 'omaha' ? 4 : 2);
  const halves = halvesOf(cfg);
  return {
    title: row.name,
    structure: STRUCTURE[row.structure] || STRUCTURE['No Limit'],
    order: orderOf(row, n),
    halves,
    split: halves.length > 1 ? 'The pot is split between the halves; one hand can win both (a scoop).' : null,
  };
}
