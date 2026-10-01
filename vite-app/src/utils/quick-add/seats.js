// ── Quick-add: positions and seat order ───────────────────────────────────
// The replayer derives everything about a seat from its INDEX: index 0 is the
// first to act preflop, the last three are BTN, SB, BB (getPositionLabels and
// getActionOrder in HandReplayerView.jsx), and the blinds are found by the
// 'SB'/'BTN/SB'/'BB' labels. A described hand names positions in the words the
// player used ("UTG" at a six-max table is the replayer's LJ).
//
// The vocabulary and the seating below are a PORT of the server's quick-add
// normaliser (lib/quick-add/games.js canonicalPosition / roleIndex / roleRank and
// lib/quick-add/normalize.js seatInternal), so a table seated here — by an
// option answered in the client — comes out exactly as the server would seat it.

import { positionLabels, studPositionLabels, gameConfig } from './game.js';
import { cardsOf, slotPlayer } from './cards.js';

const POSITION_ALIASES = {
  utg: 'UTG', underthegun: 'UTG', ep: null, earlyposition: null, lp: null, lateposition: null,
  utg1: 'UTG+1', utgplus1: 'UTG+1', underthegunplus1: 'UTG+1', underthegunplusone: 'UTG+1', utgplusone: 'UTG+1',
  utg2: 'UTG+2', utgplus2: 'UTG+2', utgplustwo: 'UTG+2', underthegunplustwo: 'UTG+2',
  utg3: 'UTG+3', utgplus3: 'UTG+3', utgplusthree: 'UTG+3',
  mp: 'MP', mp1: 'MP', middle: 'MP', middleposition: 'MP', mid: 'MP',
  mp2: 'MP2', mp3: 'MP2',
  lj: 'LJ', lojack: 'LJ', lowjack: 'LJ',
  hj: 'HJ', hijack: 'HJ', highjack: 'HJ', hijak: 'HJ',
  co: 'CO', cutoff: 'CO', cut: 'CO',
  btn: 'BTN', bu: 'BTN', bn: 'BTN', button: 'BTN', dealer: 'BTN', d: 'BTN', onthebutton: 'BTN',
  sb: 'SB', smallblind: 'SB', small: 'SB',
  bb: 'BB', bigblind: 'BB', big: 'BB',
  btnsb: 'BTN/SB', sbbtn: 'BTN/SB', buttonsmallblind: 'BTN/SB',
  straddle: 'UTG', straddler: 'UTG',
};

/* A position as a player says it, reduced to one token (UTG, UTG+1..3, MP, MP2,
   LJ, HJ, CO, BTN, SB, BB, BTN/SB or 'Seat N'), or null. */
export function canonicalPosition(pos) {
  if (pos == null) return null;
  const s = String(pos).trim();
  if (!s) return null;
  const seat = /^seat\s*#?\s*(\d{1,2})$/i.exec(s);
  if (seat) return 'Seat ' + Number(seat[1]);
  const key = s.toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
  if (Object.prototype.hasOwnProperty.call(POSITION_ALIASES, key)) return POSITION_ALIASES[key];
  return null;
}

/* The seat index a vernacular position names at an n-handed table, or null if
   it does not exist there. Late positions count back from the button, early ones
   forward from the first seat to act. */
export function roleIndex(token, n) {
  if (!token || !(n >= 2)) return null;
  if (n === 2) return (token === 'BTN' || token === 'SB' || token === 'BTN/SB') ? 0 : token === 'BB' ? 1 : null;
  if (n === 3) { const t = { BTN: 0, 'BTN/SB': null, UTG: 0, SB: 1, BB: 2 }[token]; return t == null ? null : t; }
  const late = { BB: n - 1, SB: n - 2, BTN: n - 3, CO: n - 4, HJ: n - 5, LJ: n - 6 };
  if (token in late) return late[token] >= 0 ? late[token] : null;
  const early = { UTG: 0, 'UTG+1': 1, 'UTG+2': 2, 'UTG+3': 3 };
  let idx = null;
  if (token in early) idx = early[token];
  else if (token === 'MP') idx = n >= 8 ? 2 : n >= 6 ? 1 : null;
  else if (token === 'MP2') idx = n >= 9 ? 3 : n >= 7 ? 2 : null;
  if (idx == null || idx > n - 4) return null;
  return idx;
}

const ROLE_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'MP', 'MP2', 'LJ', 'HJ', 'CO', 'BTN', 'BTN/SB', 'SB', 'BB'];
export function roleRank(token) {
  const i = ROLE_ORDER.indexOf(token);
  return i < 0 ? ROLE_ORDER.length : i;
}

const DEFAULT_NAME = /^(hero|opp(onent)?\s*\d*|player\s*\d*|villain\s*\d*|seat\s*\d+)$/i;
const isIdx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

/* How the hand's position words are to be read: 'narrator' while quick-add
   still lists only the players mentioned, in their own words; 'app' once the
   table is seated (the replayer's labels, with the vernacular as a fallback). */
export function positionMode(hand) {
  const qa = hand && hand.quickAdd;
  return qa && qa.positions === 'narrator' ? 'narrator' : 'app';
}

export function pendingTableSize(hand) {
  const qa = hand && hand.quickAdd;
  const v = qa && qa.tableSize;
  return Number.isInteger(v) && v >= 2 && v <= 10 ? v : null;
}

/* Seats anything in the hand refers to by index (the server's referencedSeats). */
export function referencedSeats(hand) {
  const used = new Set();
  const arr = (v) => (Array.isArray(v) ? v : []);
  arr(hand.streets).forEach(st => {
    arr(st && st.actions).forEach(a => { if (a) used.add(a.player); });
    arr(st && st.draws).forEach(d => { if (d) used.add(d.player); });
  });
  arr(hand.result && hand.result.winners).forEach(w => { if (w) used.add(w.playerIdx); });
  arr(hand.quickAdd && hand.quickAdd.straddles).forEach(s => { if (s && Number.isInteger(s.player)) used.add(s.player); });
  return used;
}

/* Does player i hold any cards anywhere in the hand? (Slots are laid out with
   seat 0 as the hero when no hero is known, as the server does.) */
export function hasCards(hand, i) {
  const n = (hand.players || []).length;
  const hero = isIdx(hand.heroIdx, n) ? hand.heroIdx : 0;
  return (hand.streets || []).some(st => {
    const c = (st && st.cards) || {};
    if (i === hero) return cardsOf(c.hero).length > 0;
    return (c.opponents || []).some((o, k) => slotPlayer(k, hero) === i && cardsOf(o).length > 0);
  });
}

/* A seat nobody described — no name, stack, cards, part in the hand, and not the
   hero — is interchangeable with any other such seat. */
export function isAnonymous(hand, i, used) {
  const p = (hand.players || [])[i] || {};
  const named = typeof p.name === 'string' && p.name.trim() && !DEFAULT_NAME.test(p.name.trim());
  return !named && p.startingStack == null && p.startingStackBB == null && i !== hand.heroIdx
    && !hasCards(hand, i) && !(used || referencedSeats(hand)).has(i);
}

/* The seat a player's position names at an n-handed table (server seatIndexFor). */
export function seatIndexFor(hand, i, n, mode) {
  const p = (hand.players || [])[i] || {};
  const pos = typeof p.position === 'string' ? p.position.trim() : '';
  if (!pos) return null;
  const isStud = !!(gameConfig(hand.gameType) || {}).isStud;
  if (isStud) {
    const m = /^Seat (\d+)$/.exec(canonicalPosition(pos) || '');
    const k = m ? Number(m[1]) - 1 : null;
    return k != null && k < n ? k : null;
  }
  if (mode === 'app') {
    const labels = positionLabels(n);
    if (labels[i] === pos && (hand.players || []).length === n) return i;
    const j = labels.indexOf(pos);
    if (j >= 0) return j;
  }
  return roleIndex(canonicalPosition(pos), n);
}

/* Seat the hand's players at an n-handed table (server seatInternal, table size
   known). Returns { order, positions, complete, unplaced } where order[newIdx] =
   old index or -1 for a new, unknown player; positions[newIdx] is the label the
   seat gets (null for a player whose seat is still open when incomplete); and
   unplaced lists the old indices of described players no position placed. */
export function seatHand(hand, n, mode) {
  const players = hand.players || [];
  const isStud = !!(gameConfig(hand.gameType) || {}).isStud;
  if (players.length > n) return null;
  const used = referencedSeats(hand);
  const anon = (i) => isAnonymous(hand, i, used);
  const slots = new Array(n).fill(null);
  const unplaced = [], fillers = [], conflicts = [];
  const described = players.map((_, i) => i).filter(i => !anon(i));
  const labelled = players.map((_, i) => i).filter(i => anon(i));
  for (const i of described.concat(labelled)) {
    const weak = anon(i);
    const idx = seatIndexFor(hand, i, n, mode);
    if (idx == null || slots[idx] != null) {
      if (idx != null && !weak) conflicts.push(i);
      (weak ? fillers : unplaced).push(i);
      continue;
    }
    slots[idx] = i;
  }
  const free = slots.map((v, k) => (v == null ? k : -1)).filter(k => k >= 0);
  const openSeats = free.slice();
  const stillOpen = unplaced.slice();
  let deducedPlayer = null;
  if (unplaced.length === 1 && free.length === 1 && fillers.length === 0 && players.length === n && !isStud) {
    deducedPlayer = unplaced[0];
    slots[free[0]] = unplaced.pop();
    free.length = 0;
  }
  const complete = unplaced.length === 0 || isStud;
  const queue = unplaced.concat(fillers);
  for (const k of free) slots[k] = queue.length ? queue.shift() : -1;
  const labels = isStud ? studPositionLabels(n) : positionLabels(n);
  const positions = slots.map((old, k) => {
    if (complete) return labels[k];
    if (old === -1) return null;
    return seatIndexFor(hand, old, n, mode) === k ? labels[k] : null;
  });
  /* deduced: the one seat left went to the one player left (the server calls
     that a deduction). conflicts: described players whose position was already
     taken — a deduction then is really a guess between two claimants. */
  return { order: slots, positions, complete, unplaced: complete ? [] : unplaced, deduced: stillOpen.length > unplaced.length, deducedPlayer, conflicts, openSeats };
}

/* Does every player already sit where their label says? */
export function positionsCanonical(players) {
  const n = players.length;
  const labels = positionLabels(n);
  return players.every((p, i) => p && p.position === labels[i]);
}

/* Seat order when the list is clockwise and `button` holds the button:
   order[newIdx] = old index. */
export function orderFromButton(n, button) {
  const order = new Array(n).fill(null);
  for (let j = 0; j < n; j++) {
    const k = ((j - button) % n + n) % n;
    const newIdx = n === 2 ? k : (k - 3 + n) % n;
    order[newIdx] = j;
  }
  return order;
}

/* Table sizes where every named position exists and no two players share a
   seat (a fit that needs the server's last-seat deduction does not count: that
   puts a player where their own words say they were not). Best guess first:
   six- and nine-handed before the rest. */
export function fittingTableSizes(hand, minN, mode) {
  const prefer = [6, 9, 2, 8, 7, 10, 5, 4, 3];
  const players = hand.players || [];
  return prefer.filter(n => n >= Math.max(2, minN, players.length) && (() => {
    const s = seatHand(hand, n, mode);
    return s && s.complete && !s.deduced && !s.conflicts.length;
  })());
}
