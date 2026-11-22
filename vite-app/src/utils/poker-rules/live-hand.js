// ── One hand, played live ───────────────────────────────────────────────────────────────────────
// The play-money dealer's hand: dealt from a deck it is GIVEN (the server shuffles with its CSPRNG; a test
// passes a fixed one), acted on by the players through the shared rules (betting.js), dealt street by street,
// run out when no betting is left, and settled by the export's own arithmetic (settle.js). Pure: no clock,
// no randomness, no I/O. The table runtime (lib/tables) owns those.
//
// The full state holds every card. What a player may see is viewFor(state, seat); what a player keeps is
// savedHandFor(state, seat). Neither ever carries a card that seat has not seen (docs/play-money-platform.md §1).
//
// v1 plays the board games (hold'em, the Omahas, short deck: category 'community'). Stud and the draw games
// follow, each behind the oracle (§8).

import { gameConfig, gameCategory, streetDef, positionLabels } from '../quick-add/game.js';
import { streetState, checkAction, chipRound } from './betting.js';
import { settleHand } from './settle.js';

export const LIVE_GAMES_V1 = ['NLH', 'PLH', 'LHE', 'PLO', 'PLO5', 'PLO6', 'PLO8', 'NLO8', 'O8', 'LO Hi', 'Big O', 'PLO6 8/b'];

export function canDeal(gameType) {
  return LIVE_GAMES_V1.includes(gameType) && gameCategory(gameType) === 'community';
}

const joinCards = (list) => (list || []).join('');

/**
 * A new hand. `seats` are the players dealt in, IN POSITION ORDER (the replayer's: index 0 is UTG, or the
 * button three-handed, or the button/small blind heads-up; the last three are BTN, SB, BB), each
 * { id, name, stack }. `deck` is 52 cards ('Ah', 'Td', ...), already shuffled.
 */
export function startHand({ gameType, gameMode = 'mtt', currency, blinds, seats, deck, handId = null }) {
  if (!canDeal(gameType)) throw new Error(`not dealt live yet: ${gameType}`);
  const n = seats.length;
  if (n < 2 || n > 10) throw new Error('2 to 10 players');
  if (!Array.isArray(deck) || deck.length < 52 || new Set(deck).size !== deck.length) throw new Error('a full deck');
  const cfg = gameConfig(gameType);
  const def = streetDef(gameType);
  const positions = positionLabels(n);
  let at = 0;
  const holes = seats.map(() => deck.slice(at, (at += cfg.heroCards)));
  const board = def.boardCards.map((k) => deck.slice(at, (at += k)));
  const state = {
    handId,
    gameType,
    gameMode,
    currency: gameMode === 'cash' ? (currency || 'USD') : undefined,
    blinds: { ...blinds },
    players: seats.map((s, i) => ({ name: s.name, position: positions[i], startingStack: s.stack })),
    ids: seats.map((s) => s.id),
    holes,
    board,
    streets: def.streets.map((name) => ({ name, actions: [] })),
    si: 0,
    phase: 'betting',     // 'betting' | 'over'
    runOut: false,        // the board was dealt out with no betting (everyone but one all in)
    result: null,         // { finals, won, net, shown, winners }
    seq: 0,               // bumps with every accepted change; a client sends the seq it saw
  };
  advance(state);
  return state;
}

/* The hand in the rules' form: what streetState reads (no cards are needed for the board games). */
function rulesHand(state) {
  return {
    gameType: state.gameType, gameMode: state.gameMode, blinds: state.blinds, players: state.players,
    streets: state.streets.map((s) => ({ name: s.name, actions: s.actions, cards: { hero: '', opponents: [], board: '' }, draws: [] })),
  };
}

export function currentState(state) {
  return streetState(rulesHand(state), state.si);
}

/* Move on as far as the hand goes without a player: close a street, deal the next, run the board out,
   settle. Stops at a decision or at the end. */
function advance(state) {
  for (;;) {
    const st = streetState(rulesHand(state), state.si);
    if (st.live.length <= 1) { finish(state, st); return; }
    if (st.legal) return;
    // The street is over.
    if (state.si >= state.streets.length - 1) { finish(state, st); return; }
    const withChips = st.live.filter((i) => !st.allIn.has(i));
    if (withChips.length <= 1) state.runOut = true;
    state.si++;
  }
}

/**
 * A player's action. `move` is { action, to } as betting.js checkAction takes it, plus `seq`, the state's seq
 * the player acted on (a stale one is refused, so a retry or a double tap never acts twice).
 * Returns { ok: true } or { error, range? }.
 */
export function act(state, seat, move) {
  if (state.phase !== 'betting') return { error: 'The hand is over' };
  if (move && move.seq != null && Number(move.seq) !== state.seq) return { error: 'stale', stale: true };
  const r = checkAction(rulesHand(state), state.si, seat, move || {});
  if (r.error) return r;
  state.streets[state.si].actions.push(r.action);
  state.seq++;
  advance(state);
  return { ok: true, action: r.action };
}

/* What the clock does when a player's time runs out: check if it is free, else fold. */
export function timeoutMove(state) {
  const st = currentState(state);
  if (!st.legal) return null;
  return st.legal.canCheck ? { action: 'check' } : { action: 'fold' };
}

/* The full hand, every card known: what the export settles. */
function fullHand(state) {
  const n = state.players.length;
  const shownBoardTo = state.si; // every street up to the last dealt
  return {
    gameType: state.gameType, gameMode: state.gameMode, ...(state.currency ? { currency: state.currency } : {}),
    blinds: state.blinds, players: state.players, heroIdx: 0,
    streets: state.streets.map((s, si) => ({
      name: s.name,
      cards: si === 0
        ? { hero: joinCards(state.holes[0]), opponents: state.holes.slice(1, n).map(joinCards), board: '' }
        : { hero: '', opponents: new Array(n - 1).fill(''), board: si <= shownBoardTo ? joinCards(state.board[si]) : '' },
      actions: s.actions.map((a) => ({ ...a })),
      draws: [],
    })),
    result: null,
  };
}

/* TDA, auto-muck (owner, 2026-11-22, decision 5): everyone still in is shown when the board was run out with
   no betting (all in); otherwise a hand that won any part of a pot is shown and a losing one is mucked.
   Mucked cards are never sent, nor saved. */
function finish(state, st) {
  state.phase = 'over';
  state.seq++;
  const full = fullHand(state);
  const settled = settleHand(full);
  const live = st.live;
  const showdown = live.length > 1;
  const shown = !showdown ? [] : (state.runOut ? live.slice() : live.filter((p) => settled.won[p] > 0));
  const winners = settled.won.map((w, p) => (w > 0 ? p : -1)).filter((p) => p >= 0);
  state.result = { finals: settled.finals, won: settled.won, net: settled.net, shown, winners, showdown };
}

/* The seat's slot in a hand stored with `hero` as the hero: opponents are every other seat, in order. */
const slotOf = (p, hero) => (p > hero ? p - 1 : p);

function cardsFor(state, p, viewer) {
  if (p === viewer) return joinCards(state.holes[p]);
  if (state.result && state.result.shown.includes(p)) return joinCards(state.holes[p]);
  return '';
}

/**
 * The hand as one seat may see it, in the app's saved form with that seat as hero (seat -1: a spectator,
 * hero 0 with no cards). Opponents' cards are '' until shown; the board only as far as it is dealt.
 * Adds `live`: { seq, si, toAct, legal (only for the seat to act), stacks, pot, over }.
 */
export function viewFor(state, seat) {
  const n = state.players.length;
  const hero = seat >= 0 && seat < n ? seat : 0;
  const viewer = seat >= 0 && seat < n ? seat : -1;
  const streets = state.streets.map((s, si) => {
    const dealt = si <= state.si;
    const opponents = new Array(n - 1).fill('');
    if (si === 0) for (let p = 0; p < n; p++) if (p !== hero) opponents[slotOf(p, hero)] = cardsFor(state, p, viewer);
    return {
      name: s.name,
      cards: { hero: si === 0 && viewer >= 0 ? joinCards(state.holes[hero]) : '', opponents, board: dealt && si > 0 ? joinCards(state.board[si]) : '' },
      actions: dealt ? s.actions.map((a) => ({ ...a })) : [],
      draws: [],
    };
  });
  const st = currentState(state);
  const over = state.phase === 'over';
  const view = {
    gameType: state.gameType, gameMode: state.gameMode, ...(state.currency ? { currency: state.currency } : {}),
    blinds: state.blinds, players: state.players.map((p) => ({ ...p })), heroIdx: hero, streets,
    result: over ? { winners: state.result.winners.map((p) => ({ playerIdx: p, split: state.result.winners.length > 1 })) } : null,
  };
  const live = {
    seq: state.seq, si: state.si, over, runOut: state.runOut,
    toAct: over ? -1 : st.actor,
    legal: !over && st.legal && st.legal.player === viewer ? st.legal : null,
    stacks: over ? state.result.finals.slice() : st.stacks.map(chipRound),
    pot: over ? 0 : st.pot,
    result: over ? { won: state.result.won, net: state.result.net, shown: state.result.shown, showdown: state.result.showdown } : null,
  };
  return { hand: view, live };
}

/**
 * The hand one player keeps in Hands once it is over: as they saw it, the result settled. Their own cards,
 * the board as dealt, every action, and an opponent's cards only if shown.
 */
export function savedHandFor(state, seat) {
  if (state.phase !== 'over') throw new Error('the hand is not over');
  const { hand } = viewFor(state, seat);
  return hand;
}
