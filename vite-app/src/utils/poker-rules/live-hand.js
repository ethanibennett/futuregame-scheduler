// ── One hand, played live ───────────────────────────────────────────────────────────────────────
// The play-money dealer's hand: dealt from a deck it is GIVEN (the server shuffles with its CSPRNG; a test
// passes a fixed one), acted on by the players through the shared rules (betting.js), dealt street by street,
// run out when no betting is left, and settled by the export's own arithmetic (settle.js). Pure: no clock,
// no I/O, and no randomness of its own (a draw game's reshuffle of the discards takes the caller's shuffle).
// The table runtime (lib/tables) owns those.
//
// The full state holds every card. What a player may see is viewFor(state, seat); what a player keeps is
// savedHandFor(state, seat). Neither ever carries a card that seat has not seen (docs/play-money-platform.md §1).
//
// The games are the ones the oracle holds (decision 10: board, then stud, then draw): every hand is written in
// the replayer's saved form, the form settle.js and the export already settle as PokerKit does.
//   board  hold'em, the Omahas: the board dealt from the deck at the start, shown street by street.
//   stud   two down and one up on 3rd street, one up on 4th to 6th, one down on 7th, to the players still in.
//   draw   a draw after each betting round but the last: each player still in, in the post-flop order, throws
//          any of their cards and is dealt as many. When the stub runs out, the discards (and folded hands) are
//          shuffled and dealt from, never the drawer's own discards of that draw (they go in after).

import { gameConfig, gameCategory, isDrawCategory, streetDef, positionLabels } from '../quick-add/game.js';
import { streetState, checkAction, chipRound } from './betting.js';
import { seatOrder } from './forced.js';
import { settleHand } from './settle.js';

const BOARD_GAMES = ['NLH', 'PLH', 'LHE', 'PLO', 'PLO5', 'PLO6', 'PLO8', 'NLO8', 'O8', 'LO Hi', 'Big O', 'PLO6 8/b'];
const STUD_GAMES = ['Stud Hi', 'Stud 8', 'Razz'];
const DRAW_GAMES = ['2-7 TD', 'PL 2-7 TD', 'Badugi', 'NL 2-7 SD', 'PL 5CD Hi'];
export const LIVE_GAMES = [...BOARD_GAMES, ...STUD_GAMES, ...DRAW_GAMES];

export function gameKind(gameType) {
  const c = gameCategory(gameType);
  if (c === 'stud') return 'stud';
  if (isDrawCategory(c)) return 'draw';
  return c === 'community' ? 'board' : null;
}

export function canDeal(gameType) {
  return LIVE_GAMES.includes(gameType) && !!gameKind(gameType);
}

/* Seats a table of this game may have: stud deals up to seven cards a player from one deck (seven seats, 49
   cards, never short); a draw game reshuffles its discards, and six seats keep that within the deck. */
export function maxSeatsFor(gameType) {
  const k = gameKind(gameType);
  return k === 'stud' ? 7 : k === 'draw' ? 6 : 10;
}

/* A table's stakes in the form the rules read, from what the host sets: the small and big blind and the ante.
   Stud has no blinds: the first figure is the bring-in and the second the small bet. A limit game's big bet is
   twice its small one. */
export function tableStakes(gameType, { sb, bb, ante = 0 }) {
  const cfg = gameConfig(gameType) || {};
  if (gameKind(gameType) === 'stud') return { sb: 0, bb, ante, bringIn: sb, bigBet: bb * 2 };
  return cfg.betting === 'fl' ? { sb, bb, ante, bigBet: bb * 2 } : { sb, bb, ante };
}

const joinCards = (list) => (list || []).join('');

/**
 * A new hand. `seats` are the players dealt in, IN POSITION ORDER (the replayer's: index 0 is UTG, or the
 * button three-handed, or the button/small blind heads-up; the last three are BTN, SB, BB; in stud, table
 * order), each { id, name, stack, position? }. `deck` is 52 cards ('Ah', 'Td', ...), already shuffled.
 */
export function startHand({ gameType, gameMode = 'mtt', currency, blinds, seats, deck, handId = null }) {
  if (!canDeal(gameType)) throw new Error(`not dealt live yet: ${gameType}`);
  const kind = gameKind(gameType);
  const n = seats.length;
  if (n < 2 || n > maxSeatsFor(gameType)) throw new Error(`2 to ${maxSeatsFor(gameType)} players`);
  if (!Array.isArray(deck) || deck.length < 52 || new Set(deck).size !== deck.length) throw new Error('a full deck');
  const cfg = gameConfig(gameType);
  const def = streetDef(gameType);
  const labels = kind === 'stud' ? seats.map((_, i) => `Seat ${i + 1}`) : positionLabels(n);
  const stub = deck.slice();
  const take = (k) => stub.splice(0, k);
  const holes = seats.map(() => take(kind === 'stud' ? 3 : cfg.heroCards));
  const board = def.boardCards.map((k) => (kind === 'board' ? take(k) : []));
  const state = {
    handId,
    gameType,
    kind,
    gameMode,
    currency: gameMode === 'cash' ? (currency || 'USD') : undefined,
    blinds: { ...blinds },
    players: seats.map((s, i) => ({ name: s.name, position: s.position || labels[i], startingStack: s.stack })),
    ids: seats.map((s) => s.id),
    holes,                               // board: the hole cards; stud: every card dealt, in order; draw: the hand now
    start: holes.map((h) => h.slice()),  // the cards first dealt (a draw game's starting hands)
    board,
    stub,                                // the undealt cards
    muck: [],                            // a draw game's discards and folded hands, for a reshuffle
    reshuffles: 0,
    streets: def.streets.map((name) => ({ name, actions: [], draws: [] })),
    si: 0,
    phase: 'betting',     // 'betting' | 'drawing' | 'over'
    drawers: null,        // the players drawing this round, in order (draw games, phase 'drawing')
    runOut: false,        // the rest was dealt with no betting (everyone but one all in)
    result: null,         // { finals, won, net, shown, winners }
    seq: 0,               // bumps with every accepted change; a client sends the seq it saw
  };
  advance(state);
  return state;
}

// ── The hand in the replayer's saved form ──
/* The seat's slot in a hand stored with `hero` as the hero: opponents are every other seat, in order. */
const slotOf = (p, hero) => (p > hero ? p - 1 : p);

/* The hand stored with `hero` as its hero. `sees(p)` says whether p's hidden cards are written (the hero's own
   always are, unless `hero` is a stand-in for a viewer with no seat). Streets past the one in play are empty. */
function storedHand(state, hero, sees, heroSeated = true, mucked = new Set()) {
  const n = state.players.length;
  // A hand mucked at the showdown is marked as the replayer marks one: 'MUCK' in its slot (stud on 7th street,
  // so the door stays on 3rd). The export and the felt then settle the pot among the hands shown (TDA).
  const muckAt = state.kind === 'stud' ? 4 : 0;
  const streets = state.streets.map((s, si) => {
    const dealt = si <= state.si;
    const opponents = new Array(n - 1).fill('');
    let heroCards = '';
    let board = '';
    for (let p = 0; p < n; p++) {
      const own = p === hero;
      const c = !own && si === muckAt && mucked.has(p) ? 'MUCK' : cardsOn(state, p, si, own ? heroSeated : sees(p), own, dealt);
      if (own) heroCards = c; else opponents[slotOf(p, hero)] = c;
    }
    if (state.kind === 'board' && dealt && si > 0) board = joinCards(state.board[si]);
    // The hero's own draws in full; anyone else's as a count (a shown hand is its final cards, as the corpus has it).
    const draws = dealt ? s.draws.map((d) => (d.player === hero && heroSeated
      ? { ...d } : { player: d.player, discarded: d.discarded, discardedCards: '', newCards: '' })) : [];
    return { name: s.name, cards: { hero: heroCards, opponents, board }, actions: dealt ? s.actions.map((a) => ({ ...a })) : [], draws };
  });
  return {
    gameType: state.gameType, gameMode: state.gameMode, ...(state.currency ? { currency: state.currency } : {}),
    blinds: state.blinds, players: state.players.map((p) => ({ ...p })), heroIdx: hero, streets,
  };
}

/* One player's cards on one street, as the replayer stores them. `known`: their hidden cards may be written. */
function cardsOn(state, p, si, known, isHero, dealt) {
  if (!dealt) return '';
  const h = state.holes[p];
  if (state.kind === 'board') return si === 0 && known ? joinCards(h) : '';
  if (state.kind === 'draw') {
    // The hero's starting hand (the felt plays the draws over it); an opponent's hand at the end, once shown.
    if (si !== 0 || !known) return '';
    return joinCards(isHero ? state.start[p] : h);
  }
  // Stud: 3rd street down-down-door (an opponent's down cards, when shown, in front of the door, newest first:
  // the export's form), one up card on each of 4th to 6th, the 7th-street card down.
  if (si === 0) {
    if (isHero) return known ? joinCards(h.slice(0, 3)) : `AxAx${h[2]}`;
    return known ? `${h[1]}${h[0]}${h[2]}` : h[2];
  }
  const c = h[si + 2];
  if (!c) return '';
  if (si <= 3) return c;
  return known ? c : (isHero ? 'Ax' : '');
}

/* The rules read only what is public (who acted, and in stud the up cards). */
function rulesHand(state) {
  return storedHand(state, 0, () => true);
}

export function currentState(state) {
  return streetState(rulesHand(state), state.si);
}

/* Who must decide now, and what: { player, kind: 'bet' | 'draw', legal? }, or null. */
export function toAct(state) {
  if (state.phase === 'over') return null;
  if (state.phase === 'drawing') {
    const p = nextDrawer(state);
    return p == null ? null : { player: p, kind: 'draw', max: state.holes[p].length };
  }
  const st = currentState(state);
  return st.legal ? { player: st.legal.player, kind: 'bet', legal: st.legal } : null;
}

function nextDrawer(state) {
  const done = new Set(state.streets[state.si].draws.map((d) => d.player));
  const p = (state.drawers || []).find((q) => !done.has(q));
  return p == null ? null : p;
}

/* Cards from the stub; when it is short, the muck shuffled under it first (`reshuffle` orders it; the server
   passes its CSPRNG). Fewer than asked only if the stub and the muck together are short. */
function dealCards(state, k, reshuffle) {
  if (state.stub.length < k && state.muck.length) {
    const pile = state.muck.splice(0);
    state.stub = state.stub.concat(reshuffle ? reshuffle(pile) : pile);
    state.reshuffles++;
  }
  return state.stub.splice(0, k);
}

/* Move on as far as the hand goes without a player: close a street, draw, deal the next, run out, settle.
   Stops at a decision or at the end. */
function advance(state) {
  for (;;) {
    if (state.phase === 'drawing') {
      if (nextDrawer(state) != null) return;
      state.phase = 'betting';
      state.drawers = null;
      state.si++;
      continue;
    }
    const st = streetState(rulesHand(state), state.si);
    if (st.live.length <= 1) { finish(state, st); return; }
    if (st.legal) return;
    // The street's betting is over.
    if (state.si >= state.streets.length - 1) { finish(state, st); return; }
    const withChips = st.live.filter((i) => !st.allIn.has(i));
    if (withChips.length <= 1) state.runOut = true;
    if (state.kind === 'draw') {
      // Everyone still in draws, all in or not, in the post-flop order.
      const live = new Set(st.live);
      state.drawers = seatOrder(state.players.length, false, -1).filter((p) => live.has(p));
      state.phase = 'drawing';
      continue;
    }
    state.si++;
    if (state.kind === 'stud') for (const p of st.live) state.holes[p].push(...state.stub.splice(0, 1));
  }
}

/**
 * A player's action. `move` is { action, to } as betting.js checkAction takes it, or, at a draw,
 * { action: 'draw', discard: ['Kh', ...] } (none: stand pat); plus `seq`, the state's seq the player acted on
 * (a stale one is refused, so a retry or a double tap never acts twice). `opts.reshuffle(cards)` orders a
 * reshuffled muck. Returns { ok: true } or { error, range? }.
 */
export function act(state, seat, move, opts = {}) {
  if (state.phase === 'over') return { error: 'The hand is over' };
  if (move && move.seq != null && Number(move.seq) !== state.seq) return { error: 'stale', stale: true };
  const m = move || {};
  if (state.phase === 'drawing') {
    if (m.action !== 'draw') return { error: 'Draw or stand pat' };
    if (nextDrawer(state) !== seat) return { error: 'It is not your draw' };
    const hand = state.holes[seat];
    const thrown = Array.isArray(m.discard) ? m.discard.map(String) : [];
    if (new Set(thrown).size !== thrown.length || !thrown.every((c) => hand.includes(c))) return { error: 'Throw cards from your hand' };
    const fresh = dealCards(state, thrown.length, opts.reshuffle);
    const out = thrown.slice(0, fresh.length);   // only if the deck itself ran short: keep the rest
    state.holes[seat] = hand.filter((c) => !out.includes(c)).concat(fresh);
    state.streets[state.si].draws.push({ player: seat, discarded: out.length, discardedCards: joinCards(out), newCards: joinCards(fresh) });
    state.muck.push(...out);
    state.seq++;
    advance(state);
    return { ok: true };
  }
  if (m.action === 'draw') return { error: 'Not a draw yet' };
  const r = checkAction(rulesHand(state), state.si, seat, m);
  if (r.error) return r;
  state.streets[state.si].actions.push(r.action);
  if (r.action.action === 'fold' && state.kind === 'draw') state.muck.push(...state.holes[seat]);
  state.seq++;
  advance(state);
  return { ok: true, action: r.action };
}

/* What the clock does when a player's time runs out: check if it is free, else fold; at a draw, stand pat. */
export function timeoutMove(state) {
  const t = toAct(state);
  if (!t) return null;
  if (t.kind === 'draw') return { action: 'draw', discard: [] };
  return t.legal.canCheck ? { action: 'check' } : { action: 'fold' };
}

/* TDA, auto-muck (owner, 2026-11-22, decision 5): everyone still in is shown when the hand was run out with
   no betting (all in); otherwise a hand that won any part of a pot is shown and a losing one is mucked.
   Mucked cards are never sent, nor saved. */
function finish(state, st) {
  state.phase = 'over';
  state.seq++;
  const live = new Set(st.live);
  // The full hand: every live seat's cards known (a folded seat's are not needed to settle), stored from a live
  // seat's side (a folded hand in a draw game went into the muck, and a reshuffle can deal its cards again).
  const settled = settleHand({ ...storedHand(state, st.live[0], (p) => live.has(p)), result: null });
  const showdown = st.live.length > 1;
  const shown = !showdown ? [] : (state.runOut ? st.live.slice() : st.live.filter((p) => settled.won[p] > 0));
  const winners = settled.won.map((w, p) => (w > 0 ? p : -1)).filter((p) => p >= 0);
  state.result = { finals: settled.finals, won: settled.won, net: settled.net, shown, winners, showdown, live: st.live.slice() };
}

/**
 * The hand as one seat may see it, in the app's saved form with that seat as hero (seat -1: a spectator,
 * hero 0 with no hidden cards). An opponent's hidden cards are '' until shown; the board only as far as it is
 * dealt; an opponent's draws as counts. Adds `live`: { seq, si, toAct, legal (only for the seat to act),
 * draw (only for the seat to draw: { max }), drawing, stacks, pot, over }.
 */
export function viewFor(state, seat) {
  const n = state.players.length;
  const seated = seat >= 0 && seat < n;
  const hero = seated ? seat : 0;
  const shown = new Set(state.result ? state.result.shown : []);
  const mucked = new Set(state.result && state.result.showdown ? (state.result.live || []).filter((p) => !shown.has(p)) : []);
  const view = storedHand(state, hero, (p) => shown.has(p), seated, mucked);
  const over = state.phase === 'over';
  view.result = over ? { winners: state.result.winners.map((p) => ({ playerIdx: p, split: state.result.winners.length > 1 })) } : null;
  const st = currentState(state);
  const t = toAct(state);
  const live = {
    seq: state.seq, si: state.si, over, runOut: state.runOut, drawing: state.phase === 'drawing',
    toAct: t ? t.player : -1,
    legal: t && t.kind === 'bet' && seated && t.player === seat ? t.legal : null,
    draw: t && t.kind === 'draw' && seated && t.player === seat ? { max: t.max } : null,
    stacks: over ? state.result.finals.slice() : st.stacks.map(chipRound),
    pot: over ? 0 : st.pot,
    result: over ? { won: state.result.won, net: state.result.net, shown: state.result.shown, showdown: state.result.showdown } : null,
  };
  return { hand: view, live };
}

/**
 * The hand one player keeps in Hands once it is over: as they saw it, the result settled. Their own cards,
 * the board as dealt, every action, their own draws, and an opponent's cards only if shown.
 */
export function savedHandFor(state, seat) {
  if (state.phase !== 'over') throw new Error('the hand is not over');
  const { hand } = viewFor(state, seat);
  return hand;
}
