// ── Hand history: the comparison form of a hand ─────────────────────────────
// canonicalHand(hand) reduces a hand to the poker it holds, so that a hand and
// the same hand read back from PokerStars text compare equal although they
// differ in everything the format does not carry: the title, notes, felt and
// visuals, quick-add state, the straddle's TYPE (only its seat and size are in
// the text), the verb a player was recorded with (bet / raise / call / all-in
// come from the chips), a board saved all on the flop street, the order a
// stud showdown's hidden cards were picked in.
//
// It goes through prepareHand, the writer's own normalisation, and reads the
// result: the stakes, every seat, each street's actions as { player, verb,
// amount, allIn }, the uncalled returns, the draws, the cards the text shows
// and what each player is paid ([{ playerIdx, amount }]). Amounts in
// hundredths.

import { prepareHand } from './prepare.js';

const ck = (c) => c.rank + c.suit;
const cards = (arr) => (arr ? arr.map(ck).join(' ') : null);

export function canonicalHand(hand, opts = {}) {
  const prep = prepareHand(hand, { showFoldedCards: !!opts.showFoldedCards });
  const m = prep.meta, ev = prep.events, s = prep.settle;
  const fl = m.cfg.betting === 'fl' || m.isStud;
  const stakes = { bb: m.env.bb, ante: m.env.ante };
  if (!m.isStud) stakes.sb = m.env.sb;
  if (fl) stakes.bigBet = m.env.bigBet;
  const shown = m.names.map((_, p) => {
    if (!m.showdown || !m.live.includes(p)) return null;
    const c = m.holeOf(p);
    return c && c.every(x => x.suit !== 'x') ? cards(c) : null;
  });
  const out = {
    gameType: m.gameType,
    gameMode: m.cash ? 'cash' : 'mtt',
    currency: m.cash ? m.currency : null,
    stakes,
    straddles: m.straddles.map(x => ({ seat: x.seat, amount: x.amount })),
    heroIdx: m.heroIdx,
    players: m.names.map((name, i) => ({ name, position: prep.model.players[i].position, stack: Math.round(prep.model.players[i].startingStack * 100) })),
    forced: ev.forced.map(f => ({ kind: f.kind, p: f.p, amount: f.amount, allIn: !!f.allIn })),
    board: cards(m.board),
    hero: m.isStud ? m.stud.heroStreets[m.heroIdx].map(cards) : cards(m.holeOf(m.heroIdx) && !m.isDraw ? m.holeOf(m.heroIdx) : null),
    heroDealt: m.isDraw ? prep.model.streets[0].cards.hero : null,
    studUp: m.isStud ? m.names.map((_, p) => (p === m.heroIdx ? null : cards(m.stud.up[p]))) : null,
    shown,
    streets: ev.streets.map(e => ({
      si: e.si,
      actions: e.actions.map(a => ({ player: a.p, verb: a.verb, amount: a.amount, allIn: !!a.allIn })),
      uncalled: e.uncalled ? { player: e.uncalled.p, amount: e.uncalled.amount } : null,
      draws: (e.draws || []).map(d => ({
        player: d.p, discarded: d.discarded,
        discardedCards: d.discardedCards ? cards(d.discardedCards) : null,
        newCards: d.newCards ? cards(d.newCards) : null,
      })),
    })),
    pots: s.pots.map(p => p.amount),
    awards: Object.keys(s.won).map(Number).sort((a, b) => a - b).map(p => ({ playerIdx: p, amount: s.won[p] })),
  };
  return out;
}
