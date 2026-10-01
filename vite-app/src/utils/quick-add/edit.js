// ── Quick-add: edits ──────────────────────────────────────────────────────
// Every option a gap offers carries a plain-JSON value { op, ...args }; this
// file applies one to a COPY of the hand. Nothing here decides anything — the
// rules in gaps.js pick the values; these only carry them out.

import { gameConfig, streetDef, positionLabels, studPositionLabels } from './game.js';
import { oppSlot, slotPlayer, removeCardFrom, cardsOf } from './cards.js';
import { orderFromButton } from './seats.js';
import { seatTable } from './pending.js';

export const DISMISSED_KEY = 'quickAddDismissed';

export function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function splitPath(path) {
  return String(path).split('.').filter(s => s !== '').map(s => (/^\d+$/.test(s) ? Number(s) : s));
}

export function getPath(obj, path) {
  let cur = obj;
  for (const k of splitPath(path)) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

export function setPath(obj, path, value) {
  const keys = splitPath(path);
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = typeof keys[i + 1] === 'number' ? [] : {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

const isIdx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

function toNumberMaybe(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(v.replace(/,/g, ''))) return Number(v.replace(/,/g, ''));
  return v;
}

/* What the replayer needs to be present for it to read the hand without
   tripping: arrays where it maps, card objects where it indexes, a name on
   every seat, and an opponent slot for every non-hero seat. Lossless — nothing
   known is changed or dropped. Returns { hand, changed }. */
export function normalizeStructure(input) {
  const isPlain = input != null && typeof input === 'object' && !Array.isArray(input);
  const hand = isPlain ? clone(input) : {};
  let changed = !isPlain;
  const mark = () => { changed = true; };
  if (hand.result != null && (typeof hand.result !== 'object' || Array.isArray(hand.result) ||
      (hand.result.winners != null && !Array.isArray(hand.result.winners)))) { hand.result = null; mark(); }
  if (hand.quickAdd != null && (typeof hand.quickAdd !== 'object' || Array.isArray(hand.quickAdd))) { delete hand.quickAdd; mark(); }
  if (!Array.isArray(hand.players)) { hand.players = []; mark(); }
  const n = hand.players.length;
  const heroIdx = isIdx(hand.heroIdx, n) ? hand.heroIdx : 0;
  hand.players = hand.players.map((p, i) => {
    let q = p && typeof p === 'object' ? p : (mark(), {});
    if (typeof q.name !== 'string' || !q.name.trim()) {
      mark();
      q = { ...q, name: i === heroIdx ? 'Hero' : 'Opp ' + (i < heroIdx ? i + 1 : i) };
    }
    // position may be null: the server leaves an unplaced player's seat open.
    if (typeof q.startingStack === 'string') {
      const v = toNumberMaybe(q.startingStack);
      if (typeof v === 'number') { mark(); q = { ...q, startingStack: v }; }
    }
    return q;
  });
  // Unknown blinds (null) are the blinds rule's to ask about, not a layout fault.
  if (hand.blinds == null) hand.blinds = {};
  else if (typeof hand.blinds !== 'object' || Array.isArray(hand.blinds)) { hand.blinds = {}; mark(); }
  for (const k of ['sb', 'bb', 'ante', 'bigBet', 'bringIn', 'betCap']) {
    if (typeof hand.blinds[k] === 'string') {
      const v = toNumberMaybe(hand.blinds[k]);
      if (typeof v === 'number') { hand.blinds[k] = v; mark(); }
    }
  }
  if (!Array.isArray(hand.streets)) { hand.streets = []; mark(); }
  const def = gameConfig(hand.gameType) ? streetDef(hand.gameType) : null;
  if (def) {
    while (hand.streets.length < def.streets.length) { hand.streets.push({}); mark(); }
  }
  hand.streets = hand.streets.map((s, si) => {
    let st = s && typeof s === 'object' ? { ...s } : (mark(), {});
    if (typeof st.name !== 'string' || !st.name) {
      const nm = def && def.streets[si] ? def.streets[si] : 'Street ' + (si + 1);
      st.name = nm; mark();
    }
    let cards = st.cards && typeof st.cards === 'object' ? { ...st.cards } : (mark(), {});
    if (typeof cards.hero !== 'string') { cards.hero = cards.hero == null ? '' : String(cards.hero); mark(); }
    if (typeof cards.board !== 'string') { cards.board = cards.board == null ? '' : String(cards.board); mark(); }
    let opps = Array.isArray(cards.opponents) ? cards.opponents.slice() : (mark(), []);
    const want = Math.max(0, n - 1);
    // Only ever pad: a surplus slot holding cards is a rule's business, not ours.
    while (opps.length < want) { opps.push(''); mark(); }
    while (opps.length > want && !opps[opps.length - 1]) { opps.pop(); mark(); }
    opps = opps.map(o => (typeof o === 'string' ? o : (o == null ? '' : (mark(), String(o)))));
    cards.opponents = opps;
    st.cards = cards;
    if (!Array.isArray(st.actions)) { st.actions = []; mark(); }
    st.actions = st.actions.map(a => {
      if (!a || typeof a !== 'object') { mark(); return a; }
      let b = a;
      const pv = toNumberMaybe(a.player);
      if (pv !== a.player && typeof pv === 'number') { b = { ...b, player: pv }; mark(); }
      if (typeof a.amount === 'string') {
        const v = toNumberMaybe(a.amount);
        if (typeof v === 'number') { b = { ...b, amount: v }; mark(); }
      }
      return b;
    }).filter(a => a && typeof a === 'object');
    if (!Array.isArray(st.draws)) { st.draws = []; mark(); }
    st.draws = st.draws.filter(d => d && typeof d === 'object').map(d => {
      let e = d;
      for (const k of ['discardedCards', 'newCards']) {
        if (e[k] != null && typeof e[k] !== 'string') { e = { ...e, [k]: '' }; mark(); }
      }
      const pv = toNumberMaybe(e.player);
      if (pv !== e.player && typeof pv === 'number') { e = { ...e, player: pv }; mark(); }
      return e;
    });
    return st;
  });
  return { hand, changed };
}

function newOppName(players) {
  const used = new Set(players.map(p => p && p.name));
  for (let j = 1; ; j++) if (!used.has('Opp ' + j)) return 'Opp ' + j;
}

/* Rebuild the hand on a new seat order. order[newIdx] = old index, or null for
   an empty seat that becomes a new, unknown player. Everything that refers to a
   player by index travels with them — the hero, every action and draw, the
   result, and the opponent card slots (which are relative to the hero, so they
   go through absolute seats on the way across). Same idea as reorderSeats in
   GTOEntryView. */
export function remapSeats(input, order, opts) {
  const hand = clone(input);
  const oldPlayers = hand.players || [];
  const oldN = oldPlayers.length;
  const n = order.length;
  const heroValid = isIdx(hand.heroIdx, oldN);
  const oldHero = heroValid ? hand.heroIdx : 0;
  const oldToNew = {};
  order.forEach((o, ni) => { if (o != null) oldToNew[o] = ni; });
  let newHeroIdx = hand.heroIdx;
  if (heroValid) newHeroIdx = oldToNew[oldHero];
  else if (oldN === 1) newHeroIdx = oldToNew[0]; // a one-player hand is the hero's
  const newHeroEff = isIdx(newHeroIdx, n) ? newHeroIdx : 0;
  const isStud = !!(gameConfig(hand.gameType) || {}).isStud;
  const labels = (opts && opts.positions) || (isStud ? studPositionLabels(n) : positionLabels(n));
  const keep = !!(opts && opts.keepPositions);
  const players = [];
  order.forEach((o, ni) => {
    const pos = keep ? (o != null && oldPlayers[o] ? oldPlayers[o].position : null) : (labels[ni] == null ? null : labels[ni]);
    if (o != null && oldPlayers[o]) players.push({ ...oldPlayers[o], position: pos });
    else players.push({ name: newOppName(oldPlayers.concat(players)), position: pos, startingStack: null });
  });
  hand.players = players;
  hand.heroIdx = newHeroIdx;
  hand.streets = (hand.streets || []).map(st => {
    if (!st || typeof st !== 'object') return st;
    const cards = st.cards || {};
    const abs = {};
    (cards.opponents || []).forEach((c, slot) => { abs[slotPlayer(slot, oldHero)] = c; });
    const opponents = [];
    for (let ni = 0; ni < n; ni++) {
      if (ni === newHeroEff) continue;
      const o = order[ni];
      opponents.push(o != null && abs[o] != null ? abs[o] : '');
    }
    return {
      ...st,
      cards: { ...cards, opponents },
      actions: (st.actions || []).map(a => (a && oldToNew[a.player] != null ? { ...a, player: oldToNew[a.player] } : a)),
      draws: (st.draws || []).map(d => (d && oldToNew[d.player] != null ? { ...d, player: oldToNew[d.player] } : d)),
    };
  });
  if (hand.result && Array.isArray(hand.result.winners)) {
    hand.result = { ...hand.result, winners: hand.result.winners.map(w => (w && oldToNew[w.playerIdx] != null ? { ...w, playerIdx: oldToNew[w.playerIdx] } : w)) };
  }
  if (hand.quickAdd && Array.isArray(hand.quickAdd.straddles)) {
    hand.quickAdd = { ...hand.quickAdd, straddles: hand.quickAdd.straddles.map(st => (st && Number.isInteger(st.player) && oldToNew[st.player] != null ? { ...st, player: oldToNew[st.player] } : st)) };
  }
  return hand;
}

/* Make `newHero` the hero. cards.hero and cards.opponents[] are slots relative
   to the hero, so every card string moves to the slot its player now has. With
   no valid hero the slots read as if seat 0 were the hero - how the replayer
   reads them (heroIdx ?? 0) and how the server lays them out (reslotCards in
   lib/quick-add/patch.js, which this mirrors). */
function setHero(input, newHero) {
  const hand = clone(input);
  const n = (hand.players || []).length;
  if (!isIdx(newHero, n)) return hand;
  const oldHero = isIdx(hand.heroIdx, n) ? hand.heroIdx : 0;
  if (oldHero !== newHero) {
    hand.streets = (hand.streets || []).map(st => {
      if (!st || typeof st !== 'object') return st;
      const cards = { ...(st.cards || {}) };
      const opp = Array.isArray(cards.opponents) ? cards.opponents : [];
      const bySeat = Array.from({ length: n }, (_, i) => (i === oldHero ? cards.hero : opp[oppSlot(i, oldHero)]) || '');
      return { ...st, cards: { ...cards, hero: bySeat[newHero], opponents: bySeat.filter((_, i) => i !== newHero) } };
    });
  }
  hand.heroIdx = newHero;
  return hand;
}

function streetAt(hand, si) {
  if (!hand.streets[si]) hand.streets[si] = { name: '', cards: { hero: '', opponents: [], board: '' }, actions: [], draws: [] };
  const st = hand.streets[si];
  if (!Array.isArray(st.actions)) st.actions = [];
  if (!Array.isArray(st.draws)) st.draws = [];
  return st;
}

/* All board cards, in deal order, re-dealt as flop / turn / river. */
function redistributeBoard(hand) {
  const def = streetDef(hand.gameType);
  const all = [];
  hand.streets.forEach(st => { cardsOf(st && st.cards && st.cards.board).forEach(c => all.push(c.rank + c.suit)); });
  let k = 0;
  hand.streets.forEach((st, si) => {
    const want = def.boardCards[si] || 0;
    const take = all.slice(k, k + want);
    k += take.length;
    st.cards = { ...(st.cards || {}), board: take.join('') };
  });
}

export function applyOp(input, value, gap) {
  let hand = clone(input);
  if (!value || typeof value !== 'object') return hand;
  switch (value.op) {
    case 'set':
      setPath(hand, value.path, clone(value.value));
      return hand;
    case 'setMany':
      for (const s of (value.sets || [])) setPath(hand, s.path, clone(s.value));
      return hand;
    case 'batch':
      for (const v of (value.ops || [])) hand = applyOp(hand, v, gap);
      return hand;
    case 'normalize':
      return normalizeStructure(hand).hand;
    case 'setGame': {
      hand.gameType = value.gameType;
      // Street names follow the game; a hand parsed under the wrong game gets
      // the right labels without losing anything in its streets.
      const def = streetDef(value.gameType);
      if (Array.isArray(hand.streets)) hand.streets.forEach((st, si) => { if (st && def.streets[si]) st.name = def.streets[si]; });
      return hand;
    }
    case 'setHero':
      return setHero(hand, value.heroIdx);
    case 'seatByButton': {
      // Clockwise from the button; then the table is seated, so whatever was
      // waiting on the seating (antes per player, straddles, "folds to me")
      // is finished the server's way.
      const n = (hand.players || []).length;
      const seated = remapSeats(hand, orderFromButton(n, value.button));
      if (seated.quickAdd) delete seated.quickAdd.positions;
      return seatTable(seated, n, remapSeats);
    }
    case 'seatByPosition':
      return seatTable(hand, (hand.players || []).length, remapSeats);
    case 'setTableSize':
    case 'setPlayerCount': {
      const n = value.n;
      if (!(Number.isInteger(n) && n >= 2 && n <= 10 && n >= (hand.players || []).length)) return hand;
      return seatTable(hand, n, remapSeats);
    }
    case 'swapSeats': {
      // Put player a in seat b (whoever was there takes a's place), with b's label.
      const n = (hand.players || []).length;
      if (!isIdx(value.a, n) || !isIdx(value.b, n)) return hand;
      const order = Array.from({ length: n }, (_, i) => i);
      order[value.a] = value.b; order[value.b] = value.a;
      const out = remapSeats(hand, order, { keepPositions: true });
      const isStud = !!(gameConfig(out.gameType) || {}).isStud;
      const label = (isStud ? studPositionLabels(n) : positionLabels(n))[value.b];
      out.players[value.b] = { ...out.players[value.b], position: label };
      if (value.a !== value.b && out.players[value.a] && out.players[value.a].position === label) out.players[value.a] = { ...out.players[value.a], position: null };
      return out;
    }
    case 'replaceAction': {
      const st = streetAt(hand, value.street);
      st.actions[value.index] = clone(value.action);
      return hand;
    }
    case 'removeAction': {
      const st = streetAt(hand, value.street);
      st.actions.splice(value.index, 1);
      return hand;
    }
    case 'truncateActions': {
      hand.streets.forEach((st, si) => {
        if (si === value.street) st.actions = (st.actions || []).slice(0, value.index);
        else if (si > value.street) st.actions = [];
      });
      return hand;
    }
    case 'insertActions': {
      const st = streetAt(hand, value.street);
      st.actions.splice(value.index, 0, ...clone(value.actions || []));
      return hand;
    }
    case 'appendActions': {
      const st = streetAt(hand, value.street);
      st.actions.push(...clone(value.actions || []));
      return hand;
    }
    case 'moveActionsToNextStreet': {
      const st = streetAt(hand, value.street);
      const moved = st.actions.splice(value.index);
      const next = streetAt(hand, value.street + 1);
      next.actions = moved.concat(next.actions);
      return hand;
    }
    case 'removeCard': {
      setPath(hand, value.path, removeCardFrom(getPath(hand, value.path), value.card));
      return hand;
    }
    case 'redistributeBoard':
      redistributeBoard(hand);
      return hand;
    case 'clearBoards':
      hand.streets.forEach(st => { if (st && st.cards) st.cards.board = ''; });
      return hand;
    case 'shiftDraws': {
      // Every street's draws move to the street before (by = -1): the
      // convention is that a draw is recorded on the betting round BEFORE it.
      const by = value.by || -1;
      const moved = hand.streets.map(() => []);
      hand.streets.forEach((st, si) => {
        const to = si + by;
        if (to >= 0 && to < hand.streets.length) moved[to] = moved[to].concat(st.draws || []);
      });
      hand.streets.forEach((st, si) => { st.draws = moved[si]; });
      return hand;
    }
    case 'setDraw': {
      const st = streetAt(hand, value.street);
      const i = st.draws.findIndex(d => d && d.player === value.player);
      const base = i >= 0 ? st.draws[i] : { player: value.player, discarded: 0, discardedCards: '', newCards: '' };
      const next = { ...base, ...clone(value.draw || {}), player: value.player };
      if (i >= 0) st.draws[i] = next; else st.draws.push(next);
      return hand;
    }
    case 'removeDraw': {
      const st = streetAt(hand, value.street);
      if (value.index != null) st.draws.splice(value.index, 1);
      else st.draws = st.draws.filter(d => !(d && d.player === value.player));
      return hand;
    }
    case 'removeDrawsOnStreet': {
      streetAt(hand, value.street).draws = [];
      return hand;
    }
    case 'moveCards': {
      const from = getPath(hand, value.from);
      setPath(hand, value.to, from);
      setPath(hand, value.from, '');
      return hand;
    }
    case 'truncateStreets':
      hand.streets = (hand.streets || []).slice(0, value.count);
      return hand;
    case 'setResult':
      hand.result = { ...(hand.result || {}), winners: clone(value.winners || []) };
      return hand;
    case 'dismiss': {
      const id = value.id || (gap && gap.id);
      if (!id) return hand;
      const list = Array.isArray(hand[DISMISSED_KEY]) ? hand[DISMISSED_KEY].slice() : [];
      if (!list.includes(id)) list.push(id);
      hand[DISMISSED_KEY] = list;
      return hand;
    }
    default:
      return hand;
  }
}

/* A free value typed against a gap (not one of its options): written to the
   gap's field, as a number where the field holds one. */
export function readTableSize(v) {
  if (Number.isInteger(v)) return v >= 2 && v <= 10 ? v : null;
  const words = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, 'heads up': 2, 'heads-up': 2, hu: 2, 'full ring': 9 };
  const s = String(v == null ? '' : v).toLowerCase().trim();
  const m = /^(\d{1,2})(?:\s*-?\s*(?:handed|max|players?|way))?$/.exec(s);
  if (m) { const n = Number(m[1]); return n >= 2 && n <= 10 ? n : null; }
  const w = s.replace(/[\s-]*(handed|max|players?)$/, '').trim();
  return words[w] || null;
}

export function applyFreeValue(input, gap, value) {
  const hand = clone(input);
  if (gap && gap.field === 'tableSize') {
    const n = readTableSize(value);
    return n ? applyOp(hand, { op: 'setTableSize', n }, gap) : hand;
  }
  if (!gap || !gap.field || /[*]/.test(gap.field)) return hand;
  const cur = getPath(hand, gap.field);
  const numericField = typeof cur === 'number' || /(?:startingStack|amount|\.sb|\.bb|\.ante|bigBet|bringIn|betCap|discarded|heroIdx|player)$/.test(gap.field);
  setPath(hand, gap.field, numericField ? toNumberMaybe(value) : value);
  return hand;
}

