// Quick-add: turn a model's draft (or a client's partial hand) into the replayer's hand
// object, deterministically. See docs/quick-add-contract.md for the hand shape.
//
// The model describes the hand the way a player tells it — players in any order with
// the positions they were named by, cards per player, bet sizes as "raise TO" — and
// this file does the three conversions that are easy to get wrong and are pure
// arithmetic: seat order (the replayer's index 0 is the first to act preflop, the last
// three are BTN, SB, BB), the hero/opponent card slots (opponents[] skips the hero),
// and each action's `amount`, which is the chips ADDED by that action.
//
// Everything that cannot be placed, parsed or computed is left empty and explained in
// a note — never guessed. Anything malformed is dropped.
'use strict';

const G = require('./games');
const { parseCards, knownCards, parseAmount, roundChips, cleanText, isInt } = require('./cards');

const ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'all-in', 'bring-in'];
const ACTION_ALIASES = {
  fold: 'fold', folds: 'fold', f: 'fold', muck: 'fold', mucks: 'fold',
  check: 'check', checks: 'check', x: 'check',
  call: 'call', calls: 'call', c: 'call', limp: 'call', limps: 'call', overlimp: 'call', flat: 'call', flats: 'call', complete: 'call',
  bet: 'bet', bets: 'bet', b: 'bet', lead: 'bet', leads: 'bet', donk: 'bet', cbet: 'bet', stab: 'bet', probe: 'bet',
  raise: 'raise', raises: 'raise', r: 'raise', open: 'raise', opens: 'raise', '3bet': 'raise', '4bet': 'raise', '5bet': 'raise',
  threebet: 'raise', fourbet: 'raise', iso: 'raise', isolate: 'raise', squeeze: 'raise', checkraise: 'raise', minraise: 'raise', reraise: 'raise',
  allin: 'all-in', jam: 'all-in', jams: 'all-in', shove: 'all-in', shoves: 'all-in', a: 'all-in',
  bringin: 'bring-in', bi: 'bring-in',
};
function canonicalAction(a) {
  if (a == null) return null;
  if (ACTIONS.includes(a)) return a;
  return ACTION_ALIASES[String(a).toLowerCase().replace(/[^a-z0-9]/g, '')] || null;
}

const PENDING_ACTION_KEYS = ['toAmount', 'toAmountBB', 'potFraction'];
const DEFAULT_NAME = /^(hero|opp(onent)?\s*\d*|player\s*\d*|villain\s*\d*|seat\s*\d+)$/i;
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

class Notes {
  constructor() { this.list = []; }
  add(msg) { if (msg && !this.list.includes(msg)) this.list.push(msg); }
}

function streetIndexByName(name, category) {
  if (name == null) return null;
  const key = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  const names = G.STREETS[category] || G.STREETS.community;
  const i = names.findIndex((n) => n.toLowerCase().replace(/[^a-z0-9]/g, '') === key);
  if (i >= 0) return i;
  const extra = {
    community: { pre: 0, preflop: 0, pf: 0 },
    draw_triple: { predraw: 0, firstdraw: 1, draw1: 1, seconddraw: 2, draw2: 2, thirddraw: 3, draw3: 3, finaldraw: 3 },
    draw_single: { predraw: 0, draw: 1, afterthedraw: 1 },
    stud: { thirdstreet: 0, '3rd': 0, fourthstreet: 1, '4th': 1, fifthstreet: 2, '5th': 2, sixthstreet: 3, '6th': 3, seventhstreet: 4, '7th': 4, river: 4 },
  }[category] || {};
  return Object.prototype.hasOwnProperty.call(extra, key) ? extra[key] : null;
}

/* With no game named, the street names the model used say which family it is in. */
function inferCategory(streets) {
  const names = (Array.isArray(streets) ? streets : []).map((s) => (isObj(s) ? s.name : null)).filter(Boolean);
  for (const cat of ['stud', 'draw_triple', 'draw_single']) {
    if (names.some((n) => streetIndexByName(n, cat) != null && streetIndexByName(n, 'community') == null)) return cat;
  }
  return 'community';
}

function blankStreets(category) {
  return G.STREETS[category].map(() => ({ board: [], actions: [], draws: [] }));
}

function readNumber(v) { return parseAmount(v); }
function readInt(v, lo, hi) {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return isInt(n) && n >= lo && n <= hi ? n : null;
}

/* ── Draft (the model's tool input) → internal ─────────────────────────────── */

function draftToInternal(draft, hints, notes) {
  const d = isObj(draft) ? draft : {};
  const it = { extras: {}, quick: {}, posMode: 'narrator' };

  let game = G.canonicalGameName(d.gameType);
  if (!game && d.gameType != null && String(d.gameType).trim()) {
    notes.add(`"${cleanText(d.gameType, 40)}" is not a game the replayer plays, so the game is left open.`);
  }
  if (!game && hints.gameType) game = G.canonicalGameName(hints.gameType);
  it.gameType = game;
  it.category = game ? G.GAMES[game].category : inferCategory(d.streets);
  it.gameMode = d.gameMode === 'cash' || d.gameMode === 'mtt' ? d.gameMode : null;
  it.currency = readCurrency(d.currency);
  it.title = cleanText(d.title, 80);
  it.tableSize = readInt(d.tableSize, 2, 10);
  if (d.tableSize != null && it.tableSize == null) notes.add('The table size given was not 2 to 10 players, so it is left open.');
  it.othersFolded = d.othersFolded === true;

  const b = isObj(d.blinds) ? d.blinds : {};
  it.blinds = { sb: readNumber(b.sb), bb: readNumber(b.bb), ante: readNumber(b.ante) };
  if (readNumber(b.bigBet) != null) it.blinds.bigBet = readNumber(b.bigBet);
  if (readNumber(b.bringIn) != null) it.blinds.bringIn = readNumber(b.bringIn);
  if (b.anteType === 'per_player' && it.blinds.ante) it.quick.antePerPlayer = it.blinds.ante;
  it.straddles = (Array.isArray(b.straddles) ? b.straddles : []).filter(isObj).slice(0, 4)
    .map((s) => ({ type: ['utg', 'button', 'mississippi', 'rock'].includes(s.type) ? s.type : null, p: isInt(s.player) ? s.player : null }))
    .filter((s) => s.type);

  const rawPlayers = Array.isArray(d.players) ? d.players : [];
  if (rawPlayers.length > 10) notes.add('More than ten players were described; only the first ten are kept.');
  it.seats = rawPlayers.slice(0, 10).map((p) => {
    const q = isObj(p) ? p : {};
    const token = G.canonicalPosition(q.position);
    if (q.position != null && String(q.position).trim() && !token) {
      notes.add(`"${cleanText(q.position, 30)}" does not name a seat, so that position is left open.`);
    }
    return {
      name: cleanText(q.name, 40),
      pos: token, // narrator vocabulary
      stack: readNumber(q.startingStack),
      stackBB: readNumber(q.startingStackBB),
      cards: {},
      isHero: q.isHero === true,
    };
  });
  const n = it.seats.length;
  const heroes = it.seats.map((s, i) => (s.isHero ? i : -1)).filter((i) => i >= 0);
  if (heroes.length > 1) notes.add('More than one player was marked as the hero; the first is kept.');
  it.heroIdx = heroes.length ? heroes[0] : null;
  if (it.heroIdx == null && hints.heroName) {
    const want = String(hints.heroName).trim().toLowerCase();
    const i = it.seats.findIndex((s) => s.name && s.name.toLowerCase() === want);
    if (i >= 0) it.heroIdx = i;
  }
  it.seats.forEach((s, i) => { s.isHero = i === it.heroIdx; });

  it.streets = blankStreets(it.category);
  const inRange = (p) => isInt(p) && p >= 0 && p < n;
  (Array.isArray(d.streets) ? d.streets : []).forEach((st, k) => {
    if (!isObj(st)) return;
    let si = streetIndexByName(st.name, it.category);
    if (si == null && st.name == null && k < it.streets.length) si = k;
    if (si == null) { notes.add(`A street called "${cleanText(st.name, 20)}" does not exist in this game and was left out.`); return; }
    const street = it.streets[si];
    if (st.board != null && String(st.board).trim()) {
      const pc = parseCards(st.board);
      if (!pc || pc.ranksOnly) notes.add(`The board "${cleanText(st.board, 20)}" is not card notation and was left out.`);
      else street.board = street.board.concat(pc.cards);
    }
    (Array.isArray(st.cards) ? st.cards : []).forEach((c) => {
      if (!isObj(c) || !inRange(c.player)) return;
      const pc = parseCards(c.cards);
      if (!pc) { notes.add(`"${cleanText(c.cards, 20)}" is not card notation and was left out.`); return; }
      if (!pc.cards.length) return;
      if (pc.ranksOnly && pc.suitedness === 's') notes.add('Suited, but the suit was not given: those suits are unknown (x).');
      const seat = it.seats[c.player];
      if (seat.cards[si] && seat.cards[si].join('') !== pc.cards.join('')) {
        notes.add('Two different sets of cards were given for one player on one street; the first is kept.');
        return;
      }
      seat.cards[si] = pc.cards;
    });
    (Array.isArray(st.actions) ? st.actions : []).forEach((a) => {
      if (!isObj(a)) return;
      const action = canonicalAction(a.action);
      if (!action || !inRange(a.player)) {
        notes.add('An action without a known player or type was left out.');
        return;
      }
      street.actions.push({
        p: a.player, action,
        amount: readNumber(a.amount),
        toAmount: readNumber(a.toAmount),
        toAmountBB: readNumber(a.toAmountBB),
        potFraction: readFraction(a.potFraction),
      });
    });
  });

  (Array.isArray(d.draws) ? d.draws : []).forEach((dr) => {
    if (!isObj(dr) || !inRange(dr.player)) return;
    const num = readInt(dr.drawNumber, 1, 3);
    if (it.category !== 'draw_triple' && it.category !== 'draw_single') {
      notes.add('Draws were described, but this is not a draw game; they were left out.');
      return;
    }
    if (num == null || num > it.streets.length - 1) { notes.add('A draw past the last draw of this game was left out.'); return; }
    // A draw is recorded on the betting round BEFORE it: the first draw on street 0.
    it.streets[num - 1].draws.push(readDraw({ ...dr, p: dr.player }, notes));
  });

  it.winners = readWinners(d.result, inRange);
  return it;
}

function readFraction(v) {
  const n = readNumber(v);
  return n != null && n > 0 && n <= 10 ? n : null;
}
function readCurrency(v) {
  const s = cleanText(v, 8);
  if (!s) return null;
  const sym = { '$': 'USD', '€': 'EUR', '£': 'GBP', 'C$': 'CAD', 'A$': 'AUD' }[s];
  if (sym) return sym;
  return /^[A-Za-z]{3}$/.test(s) ? s.toUpperCase() : null;
}
function readDraw(dr, notes) {
  const dc = parseCards(dr.discardedCards);
  const nc = parseCards(dr.newCards);
  if (dr.discardedCards && (!dc || dc.ranksOnly)) notes.add('Discarded cards that were not card notation were left out.');
  if (dr.newCards && (!nc || nc.ranksOnly)) notes.add('Drawn cards that were not card notation were left out.');
  return {
    p: dr.p,
    discarded: readInt(dr.discarded, 0, 7),
    discardedCards: dc && !dc.ranksOnly ? dc.cards : [],
    newCards: nc && !nc.ranksOnly ? nc.cards : [],
  };
}
function readWinners(result, inRange) {
  const ws = isObj(result) && Array.isArray(result.winners) ? result.winners : [];
  const out = [];
  for (const w of ws) {
    const p = isObj(w) ? (isInt(w.playerIdx) ? w.playerIdx : w.player) : w;
    if (!inRange(p) || out.some((o) => o.p === p)) continue;
    out.push({ p, split: !!(isObj(w) && w.split) });
  }
  return out.length ? out : null;
}

/* ── Hand (a partial replayer hand from the client) → internal ─────────────── */

const HAND_KEYS = new Set(['gameType', 'gameMode', 'currency', 'title', 'blinds', 'players', 'heroIdx', 'streets', 'result', 'quickAdd']);
const BLIND_KEYS = new Set(['sb', 'bb', 'ante', 'bigBet', 'bringIn', 'straddle', 'straddle_utg', 'straddle_button', 'straddle_rock', 'straddle_mississippi', 'straddleSeats']);

function handToInternal(hand, notes) {
  const h = isObj(hand) ? hand : {};
  const it = { extras: {}, quick: {}, straddles: [] };
  for (const k of Object.keys(h)) if (!HAND_KEYS.has(k)) it.extras[k] = h[k];

  it.gameType = G.canonicalGameName(h.gameType);
  const players = Array.isArray(h.players) ? h.players.slice(0, 10) : [];
  const n = players.length;
  it.category = it.gameType ? G.GAMES[it.gameType].category : inferCategory(h.streets);
  it.gameMode = h.gameMode === 'cash' || h.gameMode === 'mtt' ? h.gameMode : null;
  it.currency = readCurrency(h.currency);
  it.title = cleanText(h.title, 80);

  const qa = isObj(h.quickAdd) ? h.quickAdd : {};
  it.quick.antePerPlayer = readNumber(qa.antePerPlayer);
  if (it.quick.antePerPlayer == null) delete it.quick.antePerPlayer;
  it.othersFolded = qa.othersFolded === true;
  it.posMode = qa.positions === 'narrator' ? 'narrator' : 'app';
  // A hand is seated — its player count IS the table size — unless quick add marked it
  // as listing only the players mentioned. (A replayer hand is always seated.)
  it.tableSize = readInt(qa.tableSize, 2, 10) ?? (it.posMode === 'app' && n >= 2 ? n : null);

  const b = isObj(h.blinds) ? h.blinds : {};
  it.blinds = { sb: readNumber(b.sb), bb: readNumber(b.bb), ante: readNumber(b.ante) };
  if (b.bigBet != null) it.blinds.bigBet = readNumber(b.bigBet);
  if (b.bringIn != null) it.blinds.bringIn = readNumber(b.bringIn);
  it.blindExtras = {};
  for (const k of Object.keys(b)) if (!BLIND_KEYS.has(k)) it.blindExtras[k] = b[k];
  // The replayer's own straddle flags are kept as they are; seats move with players below.
  for (const t of ['utg', 'button', 'rock', 'mississippi']) {
    if (b['straddle_' + t]) {
      const seat = isObj(b.straddleSeats) && isInt(b.straddleSeats[t]) ? b.straddleSeats[t] : null;
      it.straddles.push({ type: t, p: seat });
    }
  }
  // Straddles described before the table was seated, waiting to be placed.
  (Array.isArray(qa.straddles) ? qa.straddles : []).filter(isObj).slice(0, 4).forEach((s) => {
    if (!['utg', 'button', 'rock', 'mississippi'].includes(s.type) || it.straddles.some((x) => x.type === s.type)) return;
    it.straddles.push({ type: s.type, p: isInt(s.player) && s.player >= 0 && s.player < n ? s.player : null });
  });

  it.seats = players.map((p) => {
    const q = isObj(p) ? p : {};
    const name = cleanText(q.name, 40);
    return {
      name: name && !DEFAULT_NAME.test(name) ? name : null,
      pos: cleanText(q.position, 12),
      stack: readNumber(q.startingStack),
      stackBB: readNumber(q.startingStackBB),
      cards: {},
      isHero: false,
    };
  });
  const inRange = (p) => isInt(p) && p >= 0 && p < n;
  it.heroIdx = inRange(h.heroIdx) ? h.heroIdx : null;
  if (it.heroIdx != null) it.seats[it.heroIdx].isHero = true;
  const slotHero = it.heroIdx != null ? it.heroIdx : 0; // provisional slot layout without a hero
  const seatOfSlot = (k) => (k < slotHero ? k : k + 1);

  it.streets = blankStreets(it.category);
  (Array.isArray(h.streets) ? h.streets : []).slice(0, it.streets.length).forEach((st, si) => {
    if (!isObj(st)) return;
    const street = it.streets[si];
    const c = isObj(st.cards) ? st.cards : {};
    const bc = parseCards(c.board);
    if (bc && !bc.ranksOnly) street.board = bc.cards;
    else if (c.board) notes.add(`The ${G.STREETS[it.category][si]} board was not card notation and was left out.`);
    const put = (seatIdx, str) => {
      if (!inRange(seatIdx) || str == null || str === '') return;
      const pc = parseCards(str);
      if (!pc) { notes.add(`"${cleanText(str, 20)}" is not card notation and was left out.`); return; }
      if (pc.cards.length) it.seats[seatIdx].cards[si] = pc.cards;
    };
    if (n) put(slotHero, c.hero);
    (Array.isArray(c.opponents) ? c.opponents : []).forEach((str, k) => put(seatOfSlot(k), str));
    (Array.isArray(st.actions) ? st.actions : []).forEach((a) => {
      if (!isObj(a)) return;
      const action = canonicalAction(a.action);
      if (!action || !inRange(a.player)) { notes.add('An action without a known player or type was left out.'); return; }
      street.actions.push({
        p: a.player, action,
        amount: readNumber(a.amount),
        toAmount: readNumber(a.toAmount),
        toAmountBB: readNumber(a.toAmountBB),
        potFraction: readFraction(a.potFraction),
      });
    });
    (Array.isArray(st.draws) ? st.draws : []).forEach((dr) => {
      if (!isObj(dr) || !inRange(dr.player)) return;
      street.draws.push(readDraw({ ...dr, p: dr.player }, notes));
    });
  });
  it.winners = readWinners(h.result, inRange);
  return it;
}

function expectedLabels(category, n) {
  return category === 'stud' ? G.studLabels(n) : G.positionLabels(n);
}

/* ── Seating ───────────────────────────────────────────────────────────────── */

/* Which seats are referred to by anything other than their position — such a
   seat is a real, described player; one that is not is an anonymous filler. */
function referencedSeats(it) {
  const used = new Set();
  it.streets.forEach((st) => {
    st.actions.forEach((a) => used.add(a.p));
    st.draws.forEach((d) => used.add(d.p));
  });
  (it.winners || []).forEach((w) => used.add(w.p));
  it.straddles.forEach((s) => { if (s.p != null) used.add(s.p); });
  return used;
}

function seatIndexFor(seat, i, n, it) {
  if (!seat.pos) return null;
  if (it.category === 'stud') {
    const m = /^Seat (\d+)$/.exec(G.canonicalPosition(seat.pos) || '');
    const k = m ? Number(m[1]) - 1 : null;
    return k != null && k < n ? k : null;
  }
  if (it.posMode === 'app') {
    // An app label is a seat index at this table size: its own seat first.
    const labels = G.positionLabels(n);
    if (labels[i] === seat.pos && it.tableSize === n) return i;
    const j = labels.indexOf(seat.pos);
    if (j >= 0) return j;
  }
  return G.roleIndex(G.canonicalPosition(seat.pos), n);
}

function seatInternal(it, notes) {
  const seats = it.seats;
  let n = it.tableSize;
  if (n != null && seats.length > n) {
    notes.add(`${seats.length} players were described, more than the ${n}-handed table; the table size is left open.`);
    n = null;
  }
  const used = referencedSeats(it);
  // A seat nobody described (no name, stack, cards or action) is interchangeable with
  // any other such seat, whatever label it was last given: it fills what is left.
  const anon = (s, i) => !s.name && s.stack == null && s.stackBB == null && !s.isHero
    && !Object.keys(s.cards).length && !used.has(i);
  const who = (s) => (s.isHero ? 'Your' : s.name ? s.name + "'s" : "A player's");

  let order; // order[newIndex] = old index, or -1 for a new filler
  let complete = false;
  if (n == null) {
    // Table size unknown: described players only, earliest position first.
    order = seats.map((_, i) => i);
    if (it.category !== 'stud') {
      const rank = (s) => G.roleRank(G.canonicalPosition(s.pos));
      order.sort((a, b) => rank(seats[a]) - rank(seats[b]) || a - b);
    }
  } else {
    const slots = new Array(n).fill(null);
    const unplaced = [], fillers = [];
    // Described players first, so a seat known only by a label (or a filler that was
    // given one last time) gives way to a player who is actually in the story.
    const described = seats.map((_, i) => i).filter((i) => !anon(seats[i], i));
    const labelled = seats.map((_, i) => i).filter((i) => anon(seats[i], i));
    for (const i of described.concat(labelled)) {
      const s = seats[i];
      const weak = anon(s, i);
      const idx = seatIndexFor(s, i, n, it);
      if (idx == null) {
        if (s.pos) notes.add(`${who(s)} position "${s.pos}" does not exist at a ${n}-handed table.`);
        (weak ? fillers : unplaced).push(i);
        continue;
      }
      if (slots[idx] != null) {
        if (!weak || anon(seats[slots[idx]], slots[idx])) notes.add(`Two players were placed in the same seat (${expectedLabels(it.category, n)[idx]}).`);
        (weak ? fillers : unplaced).push(i);
        continue;
      }
      slots[idx] = i;
    }
    const free = slots.map((v, k) => (v == null ? k : -1)).filter((k) => k >= 0);
    // Deduction, not a guess: everyone else is placed and one seat is left.
    if (unplaced.length === 1 && free.length === 1 && fillers.length === 0 && seats.length === n && it.category !== 'stud') {
      slots[free[0]] = unplaced.pop();
      notes.add(`${who(seats[slots[free[0]]])} seat is the one left: ${G.positionLabels(n)[free[0]]}.`);
      free.length = 0;
    }
    // Stud seats are numbers, not roles — nobody tells a stud hand by seat — so a
    // player with no seat number simply takes the next free one.
    complete = unplaced.length === 0 || it.category === 'stud';
    const queue = unplaced.concat(fillers);
    for (const k of free) slots[k] = queue.length ? queue.shift() : -1;
    order = slots;
  }

  const labels = n != null ? expectedLabels(it.category, n) : null;
  const unplacedSet = new Set();
  const newSeats = order.map((old, k) => {
    // Partial seating: only a described player placed by their own position carries a
    // label; who else sits where is not known until the open seats are.
    if (old === -1) return { name: null, pos: complete ? labels[k] : null, stack: null, stackBB: null, cards: {}, isHero: false };
    const s = seats[old];
    let pos;
    if (labels && complete) pos = labels[k];
    else if (labels) {
      const placedHere = s.pos && seatIndexFor(s, old, n, it) === k;
      pos = placedHere ? labels[k] : null;
      if (!pos) unplacedSet.add(k);
    } else pos = it.category === 'stud' ? (G.canonicalPosition(s.pos) || null) : (G.canonicalPosition(s.pos) || null);
    return { ...s, pos };
  });
  const map = new Map(order.map((old, k) => [old, k]));
  remapPlayers(it, (p) => (map.has(p) ? map.get(p) : null));
  it.seats = newSeats;
  it.heroIdx = it.heroIdx != null && map.has(it.heroIdx) ? map.get(it.heroIdx) : null;
  it.tableSize = n;
  it.complete = complete && n != null;
  if (!it.complete && n == null) it.posMode = 'narrator';
  else it.posMode = 'app';
}

function remapPlayers(it, f) {
  it.streets.forEach((st) => {
    st.actions.forEach((a) => { a.p = f(a.p); });
    st.actions = st.actions.filter((a) => a.p != null);
    st.draws.forEach((d) => { d.p = f(d.p); });
    st.draws = st.draws.filter((d) => d.p != null);
  });
  if (it.winners) it.winners = it.winners.map((w) => ({ ...w, p: f(w.p) })).filter((w) => w.p != null);
  it.straddles.forEach((s) => { if (s.p != null) s.p = f(s.p); });
}

/* ── Stakes, stacks, straddles ─────────────────────────────────────────────── */

function resolveStakes(it, notes) {
  const b = it.blinds;
  if (it.quick.antePerPlayer != null) {
    if (it.category === 'stud') {
      b.ante = it.quick.antePerPlayer; delete it.quick.antePerPlayer;
    } else if (it.complete) {
      b.ante = roundChips(it.quick.antePerPlayer * it.seats.length, b);
      notes.add(`The ante of ${it.quick.antePerPlayer} per player is recorded as a big blind ante of ${b.ante} (${it.seats.length} players).`);
      delete it.quick.antePerPlayer;
    } else {
      b.ante = null; // stays pending until the table size is known
    }
  }
  for (const s of it.seats) {
    if (s.stack == null && s.stackBB != null && b.bb != null) s.stack = roundChips(s.stackBB * b.bb, b);
    if (s.stack != null) s.stackBB = null;
  }
  // Straddles need four or more seats and a seat in front of the blinds.
  const n = it.seats.length;
  it.straddleFlags = {};
  it.pendingStraddles = [];
  for (const st of it.straddles) {
    if (!it.complete) { it.pendingStraddles.push(st); continue; } // placed once the table is
    if (n < 4) { notes.add('A straddle needs at least four players; it was left out.'); continue; }
    if (st.type === 'utg' || st.type === 'button') { it.straddleFlags['straddle_' + st.type] = true; continue; }
    if (st.p != null && st.p >= 0 && st.p <= n - 3) {
      it.straddleFlags['straddle_' + st.type] = true;
      it.straddleFlags.straddleSeats = { ...(it.straddleFlags.straddleSeats || {}), [st.type]: st.p };
    } else notes.add('A straddle from a seat that cannot straddle was left out.');
  }
  if (Object.keys(it.straddleFlags).length) it.straddleFlags.straddle = true;
}

/* The replayer's straddles: [{ seat, amount }] in posting order (getStraddles). */
function straddleList(it) {
  const n = it.seats.length;
  const bb = it.blinds.bb || 0;
  const f = it.straddleFlags || {};
  if (!f.straddle || !bb || n < 4) return [];
  const seats = f.straddleSeats || {};
  const picked = [], taken = new Set();
  for (const t of ['utg', 'button', 'rock', 'mississippi']) {
    if (!f['straddle_' + t]) continue;
    let seat = t === 'utg' ? 0 : t === 'button' ? n - 3 : seats[t];
    if (!(isInt(seat) && seat >= 0 && seat <= n - 3)) seat = 0;
    if (taken.has(seat)) continue;
    taken.add(seat);
    picked.push({ seat });
  }
  picked.sort((a, c) => a.seat - c.seat);
  return picked.map((s, i) => ({ ...s, amount: bb * Math.pow(2, i + 1) }));
}

/* ── Cards ─────────────────────────────────────────────────────────────────── */

function validateCards(it, notes) {
  const info = it.gameType ? G.GAMES[it.gameType] : null;
  const cat = it.category;
  const streetName = (si) => G.STREETS[cat][si];

  // A whole board given on one street is a runout: flop, turn, river.
  if (cat === 'community') {
    const s = it.streets;
    if (s[0].board.length) {
      if (!s[1].board.length && !s[2].board.length && !s[3].board.length) s[1].board = s[0].board;
      else notes.add('Board cards given before the flop were left out.');
      s[0].board = [];
    }
    if (s[1].board.length > 3 && !s[2].board.length && !s[3].board.length) {
      const all = s[1].board;
      s[1].board = all.slice(0, 3); s[2].board = all.slice(3, 4); s[3].board = all.slice(4, 5);
      if (all.length > 5) notes.add('More than five board cards were given; the extras were left out.');
    }
    if (s[2].board.length > 1 && !s[3].board.length) { s[3].board = s[2].board.slice(1, 2); s[2].board = s[2].board.slice(0, 1); }
    G.BOARD_COUNTS.forEach((max, si) => {
      if (s[si].board.length > max) { notes.add(`The ${streetName(si)} had more board cards than it deals; they were left out.`); s[si].board = []; }
    });
  } else {
    it.streets.forEach((st, si) => {
      if (st.board.length) { notes.add(`This game has no board; the cards given as a ${streetName(si)} board were left out.`); st.board = []; }
    });
  }

  // Player cards: how many each street may hold.
  const maxFor = (si, hero) => {
    if (cat === 'stud') {
      if (si === 0) return hero ? 3 : 1;
      if (si === 4) return hero ? 1 : 0;
      return 1;
    }
    if (si > 0) return 0;
    return info ? info.cards : 7;
  };
  it.seats.forEach((s, i) => {
    const hero = i === it.heroIdx || (it.heroIdx == null && i === 0);
    /* Hole cards told where they were SHOWN ("River 2d, win vs AKhd") are still hole cards.
       The model files them on the showdown street and the rule below used to drop them,
       losing the opponent's hand (2026-10-01). Outside stud, a later street's cards move to
       the first street when that street holds none for this player — one hand, never merged. */
    if (cat !== 'stud') {
      for (const k of Object.keys(s.cards)) {
        if (Number(k) > 0 && !(s.cards[0] && s.cards[0].length) && s.cards[k].length <= maxFor(0, hero)) {
          s.cards[0] = s.cards[k];
          delete s.cards[k];
        }
      }
    }
    for (const k of Object.keys(s.cards)) {
      const si = Number(k);
      const max = maxFor(si, hero);
      if (s.cards[k].length > max) {
        const whose = s.isHero ? 'your' : s.name ? s.name + "'s" : "an opponent's";
        if (cat === 'stud' && !hero && max <= 1) notes.add(`Stud stores only an opponent's up cards, one per street; ${whose} ${streetName(si)} cards were left out.`);
        else if (max === 0) notes.add(`Cards given for ${whose} hand on the ${streetName(si)} were left out (hole cards belong to the first street).`);
        else notes.add(`${s.cards[k].length} cards is too many for ${whose} hand in ${it.gameType}; they were left out.`);
        delete s.cards[k];
      }
    }
  });

  // Draws: counts within the hand size and cards within the counts.
  const hand = info ? info.cards : 5;
  it.streets.forEach((st, si) => {
    if (si >= it.streets.length - 1 && st.draws.length) { notes.add('A draw after the last betting round was left out.'); st.draws = []; }
    const seen = new Set();
    st.draws = st.draws.filter((d) => {
      if (seen.has(d.p)) { notes.add('A player had two draws on one round; the first is kept.'); return false; }
      seen.add(d.p);
      if (d.discarded == null && (d.discardedCards.length || d.newCards.length)) {
        d.discarded = Math.max(d.discardedCards.length, d.newCards.length);
      }
      if (d.discarded != null && d.discarded > hand) { notes.add('A draw of more cards than the hand holds was left out.'); return false; }
      if (d.discarded != null && (d.discardedCards.length > d.discarded || d.newCards.length > d.discarded)) {
        notes.add('A draw listed more cards than were drawn; its cards were left out.');
        d.discardedCards = []; d.newCards = [];
      }
      return true;
    });
  });

  // The same card twice is impossible; it is not ours to pick which one is wrong.
  const count = new Map();
  const add = (cards) => knownCards(cards).forEach((c) => count.set(c, (count.get(c) || 0) + 1));
  it.seats.forEach((s) => Object.values(s.cards).forEach(add));
  it.streets.forEach((st) => { add(st.board); st.draws.forEach((d) => add(d.newCards)); });
  const dup = [...count].filter(([, k]) => k > 1).map(([c]) => c);
  if (dup.length) notes.add(`${dup.join(', ')} ${dup.length > 1 ? 'appear' : 'appears'} more than once in the hand.`);
}

/* ── Implicit folds ────────────────────────────────────────────────────────── */

/* The reverse of insertImplicitFolds, run before seating: a seat nobody described
   (no name, stack or cards) whose only part in the hand is one fold before the flop
   is a "folds to me" seat. Its fold is dropped and re-derived after seating, so a
   corrected position moves the folds with the table instead of leaving them pinned to
   seat numbers that now belong to someone else. Only when that is all such seats do
   (or the description already said the others folded) — otherwise a seat that never
   acted would gain a fold. Re-deriving reproduces the same folds on a hand that has
   not changed, so this is idempotent. */
function stripImplicitFolds(it) {
  if (it.category === 'stud' || !it.streets.length) return;
  const n = it.seats.length;
  const pre = it.streets[0].actions;
  const other = new Set();
  it.streets.forEach((st, si) => {
    st.actions.forEach((a) => { if (si > 0 || a.action !== 'fold') other.add(a.p); });
    st.draws.forEach((d) => other.add(d.p));
  });
  (it.winners || []).forEach((w) => other.add(w.p));
  it.straddles.forEach((s) => { if (s.p != null) other.add(s.p); });
  const foldCount = new Array(n).fill(0);
  pre.forEach((a) => { if (a.action === 'fold') foldCount[a.p]++; });
  const silent = it.seats.map((s, i) => !s.name && s.stack == null && s.stackBB == null && !s.isHero
    && !Object.keys(s.cards).length && !other.has(i));
  const folders = new Set(it.seats.map((_, i) => i).filter((i) => silent[i] && foldCount[i] === 1));
  if (!folders.size) return;
  if (!it.othersFolded && it.seats.some((_, i) => silent[i] && foldCount[i] === 0)) return;
  it.streets[0].actions = pre.filter((a) => !(a.action === 'fold' && folders.has(a.p)));
  it.othersFolded = true;
}

/* "Folds to me": seats the description never mentions fold preflop, in turn. Only
   with the whole table seated, only on the first betting round, and only for seats
   that do nothing anywhere in the hand. A skipped seat that acts later is an action
   out of turn, which is the gap engine's to raise, so insertion stops there. */
function insertImplicitFolds(it, notes, rederived = 0) {
  if (!it.othersFolded || !it.complete || it.category === 'stud') return;
  const n = it.seats.length;
  const involved = referencedSeats(it);
  it.seats.forEach((s, i) => { if (s.isHero || Object.keys(s.cards).length) involved.add(i); });
  const st = it.streets[0];
  const sl = straddleList(it);
  let ptr = sl.length ? (sl[sl.length - 1].seat + 1) % n : 0;
  const out = [], gone = new Set();
  let inserted = 0, broken = false;
  const foldUntil = (target) => {
    for (let guard = 0; guard < n && ptr !== target; guard++) {
      if (gone.has(ptr)) { ptr = (ptr + 1) % n; continue; }
      if (involved.has(ptr)) { broken = true; return; }
      out.push({ p: ptr, action: 'fold', amount: 0 });
      gone.add(ptr); inserted++;
      ptr = (ptr + 1) % n;
    }
  };
  for (const a of st.actions) {
    if (!broken) foldUntil(a.p);
    out.push(a);
    if (a.action === 'fold' || a.action === 'all-in') gone.add(a.p);
    ptr = (a.p + 1) % n;
  }
  if (!broken) {
    // Anyone still to act who never does anything folded too.
    for (let k = 0; k < n; k++, ptr = (ptr + 1) % n) {
      if (!gone.has(ptr) && !involved.has(ptr)) { out.push({ p: ptr, action: 'fold', amount: 0 }); gone.add(ptr); inserted++; }
    }
  }
  st.actions = out;
  // Folds that were already in the hand and only re-derived are not news.
  if (inserted > rederived) notes.add(`The ${inserted} player${inserted > 1 ? 's' : ''} not mentioned ${inserted > 1 ? 'are' : 'is'} recorded as folding before the flop.`);
}

/* Heads-up after the flop, the two players' actions can only alternate, first to act
   the one out of position. Shorthand gives the actions without names ("Flop QJ3, x, b 4k,
   c") and the model has handed all three to one player — the SB checking, then betting
   into nobody — which the gaps engine then asks about as an action out of turn
   (2026-10-01). With exactly two players left in, both with chips, and every action on
   the street theirs, the order is certain, so the actions are re-attributed in turn.
   Anything else (three-way, an unseated table, stud's board-driven order) is left as told. */
function alternateHeadsUp(it, notes) {
  if (!it.complete || it.category === 'stud') return;
  const n = it.seats.length;
  if (n < 2) return;
  const order = n === 2 ? [1, 0] : [n - 2, n - 1, ...Array.from({ length: n - 2 }, (_, i) => i)];
  const out = new Set(), allIn = new Set();
  it.streets.forEach((st, si) => {
    if (si > 0) {
      const live = order.filter((p) => !out.has(p));
      const acts = st.actions;
      if (live.length === 2 && acts.length && !live.some((p) => allIn.has(p))
          && acts.every((a) => live.includes(a.p))) {
        const alternates = acts.every((a, k) => a.p === live[k % 2]);
        if (!alternates) {
          acts.forEach((a, k) => { a.p = live[k % 2]; });
          const name = (G.STREETS[it.category] || [])[si] || 'later street';
          notes.add(`The ${name} actions were put in turn order, alternating between the two players.`);
        }
      }
    }
    st.actions.forEach((a) => {
      if (a.action === 'fold') out.add(a.p);
      if (a.action === 'all-in') allIn.add(a.p);
    });
  });
}

/* ── Amounts ───────────────────────────────────────────────────────────────── */

/* Walks the hand as the replayer does (calcPotsAndStacks / bettingContext) and fills
   in each action's chips-added `amount` from what was said: a "to" size, a size in big
   blinds, a fraction of the pot, a call of the bet faced, an all-in of the stack left,
   or the fixed bet of a limit game. Anything that depends on an unknown stays null and
   keeps its sizing so it can be finished once the unknown is answered. */
function resolveAmounts(it, notes) {
  const b = it.blinds;
  const cat = it.category;
  const info = it.gameType ? G.GAMES[it.gameType] : null;
  const n = it.seats.length;
  const committed = new Array(n).fill(0);
  const cKnown = new Array(n).fill(true);
  let pot = 0, potKnown = true;
  const r = (x) => roundChips(x, b);

  const sbIdx = it.seats.findIndex((s) => s.pos === 'SB' || s.pos === 'BTN/SB');
  const bbIdx = it.seats.findIndex((s) => s.pos === 'BB');
  if (cat === 'stud') {
    if (b.ante == null) { potKnown = false; cKnown.fill(false); } else { committed.fill(b.ante); pot += b.ante * n; }
  } else if (b.ante == null) {
    potKnown = false; if (bbIdx >= 0) cKnown[bbIdx] = false;
  } else if (b.ante > 0) {
    pot += b.ante; if (bbIdx >= 0) committed[bbIdx] += b.ante;
  }
  const remaining = (p) => {
    const s = it.seats[p];
    return s && s.stack != null && cKnown[p] ? r(s.stack - committed[p]) : null;
  };

  it.streets.forEach((st, si) => {
    const contrib = new Array(n).fill(0);
    const known = new Array(n).fill(true);
    let maxBet = 0, maxKnown = true;
    const post = (p, amt) => {
      if (p < 0) return;
      if (amt == null) { known[p] = false; cKnown[p] = false; potKnown = false; return; }
      contrib[p] = amt; committed[p] += amt; pot += amt;
      if (amt > maxBet) maxBet = amt;
    };
    if (si === 0 && cat !== 'stud') {
      post(sbIdx, b.sb);
      post(bbIdx, b.bb);
      if (b.bb == null) maxKnown = false; else maxBet = Math.max(maxBet, b.bb);
      if (sbIdx < 0 || bbIdx < 0) {
        // Blinds whose seats are unknown are still in the pot, from someone.
        if (sbIdx < 0) { if (b.sb == null) potKnown = false; else pot += b.sb; }
        if (bbIdx < 0) { if (b.bb == null) potKnown = false; else pot += b.bb; }
        it.seats.forEach((s, p) => { if (!s.pos) { known[p] = false; cKnown[p] = false; } });
      }
      for (const sd of straddleList(it)) { contrib[sd.seat] = sd.amount; committed[sd.seat] += sd.amount; pot += sd.amount; maxBet = Math.max(maxBet, sd.amount); }
    }
    const fixedBet = () => {
      if (!info || info.betting !== 'fl' || b.bb == null) return null;
      return G.SMALL_BET_STREETS.has(si) ? b.bb : (b.bigBet || b.bb * 2);
    };

    for (const a of st.actions) {
      const p = a.p;
      if (a.action === 'fold' || a.action === 'check') {
        a.amount = 0;
        clearPending(a);
        continue;
      }
      let amt = a.amount != null && (a.amount > 0 || a.action === 'bring-in') ? a.amount : null;
      if (a.action === 'bring-in') {
        if (amt == null && b.bringIn != null) amt = b.bringIn;
      } else if (a.action === 'call') {
        // A call is whatever was bet into the caller, capped by their stack: derived
        // whenever it can be, so a bet corrected later carries its calls with it.
        if (maxKnown && known[p]) {
          const toCall = Math.max(0, maxBet - contrib[p]);
          const rem = remaining(p);
          amt = rem != null ? Math.min(toCall, rem) : toCall;
        }
      } else {
        // bet, raise, all-in
        let to = null;
        if (a.toAmount != null) to = a.toAmount;
        else if (a.toAmountBB != null && b.bb != null) to = r(a.toAmountBB * b.bb);
        else if (a.potFraction != null && potKnown && maxKnown && known[p]) {
          const toCall = Math.max(0, maxBet - contrib[p]);
          to = maxBet === 0 || a.action === 'bet'
            ? contrib[p] + r(a.potFraction * pot)
            : r(maxBet + a.potFraction * (pot + toCall));
        }
        if (to != null && known[p]) {
          if (to - contrib[p] > 0) amt = r(to - contrib[p]);
          else notes.add(`A ${a.action} to ${to} on the ${G.STREETS[cat][si]} is no more than that player had already put in; its size is left open.`);
        } else if (to == null && amt == null) {
          if (a.action === 'all-in') amt = remaining(p);
          else {
            const fb = fixedBet();
            if (fb != null && a.action === 'bet') amt = fb;
            else if (fb != null && a.action === 'raise' && maxKnown && known[p]) amt = r(maxBet + fb - contrib[p]);
          }
        }
      }
      if (amt != null) {
        a.amount = amt;
        clearPending(a);
        if (a.action === 'bring-in') { committed[p] += amt - contrib[p]; pot += amt - contrib[p]; contrib[p] = amt; }
        else { contrib[p] += amt; committed[p] += amt; pot += amt; }
        if (contrib[p] > maxBet) maxBet = contrib[p];
      } else {
        a.amount = null;
        known[p] = false; cKnown[p] = false; potKnown = false;
        if (a.action !== 'call') maxKnown = false;
      }
    }
  });
}
function clearPending(a) { for (const k of PENDING_ACTION_KEYS) a[k] = null; }

/* ── Internal → hand ───────────────────────────────────────────────────────── */

function internalToHand(it, opts) {
  const n = it.seats.length;
  const heroIdx = it.heroIdx;
  const slotHero = heroIdx != null ? heroIdx : 0;
  let opp = 0;
  const players = it.seats.map((s, i) => {
    let name = s.name;
    if (!name) name = i === heroIdx ? (cleanText(opts.heroName, 40) || 'Hero') : 'Opp ' + (++opp);
    else if (i !== heroIdx) ++opp;
    const p = { name, position: s.pos || null, startingStack: s.stack != null ? s.stack : null };
    if (s.stack == null && s.stackBB != null) p.startingStackBB = s.stackBB;
    return p;
  });
  const str = (cards) => (cards && cards.length ? cards.join('') : '');
  const streets = it.streets.map((st, si) => ({
    name: G.STREETS[it.category][si],
    cards: {
      hero: n ? str(it.seats[slotHero].cards[si]) : '',
      opponents: it.seats.filter((_, i) => i !== slotHero).map((s) => str(s.cards[si])),
      board: str(st.board),
    },
    actions: st.actions.map((a) => {
      const o = { player: a.p, action: a.action, amount: a.amount != null ? a.amount : null };
      if (a.amount == null) for (const k of PENDING_ACTION_KEYS) if (a[k] != null) o[k] = a[k];
      return o;
    }),
    draws: st.draws.map((d) => ({
      player: d.p, discarded: d.discarded, discardedCards: str(d.discardedCards), newCards: str(d.newCards),
    })),
  }));
  const blinds = { ...it.blindExtras, sb: it.blinds.sb, bb: it.blinds.bb, ante: it.blinds.ante };
  if (it.blinds.bigBet != null || (it.gameType && G.GAMES[it.gameType].betting === 'fl' && it.category !== 'community')) blinds.bigBet = it.blinds.bigBet ?? null;
  if (it.category === 'stud') blinds.bringIn = it.blinds.bringIn ?? null;
  else if (it.blinds.bringIn != null) blinds.bringIn = it.blinds.bringIn;
  Object.assign(blinds, it.straddleFlags || {});

  const hand = { ...it.extras };
  hand.gameType = it.gameType;
  hand.gameMode = it.gameMode;
  if (it.currency) hand.currency = it.currency;
  if (it.title) hand.title = it.title;
  hand.blinds = blinds;
  hand.players = players;
  hand.heroIdx = heroIdx;
  hand.streets = streets;
  hand.result = it.winners && it.winners.length
    ? { winners: it.winners.map((w) => ({ playerIdx: w.p, split: w.split })) }
    : null;

  const qa = {};
  if (!it.complete) {
    if (it.tableSize != null) qa.tableSize = it.tableSize;
    if (it.posMode === 'narrator') qa.positions = 'narrator';
    if (it.othersFolded) qa.othersFolded = true;
  }
  if (it.quick.antePerPlayer != null) qa.antePerPlayer = it.quick.antePerPlayer;
  if (it.pendingStraddles && it.pendingStraddles.length) {
    qa.straddles = it.pendingStraddles.map((s) => (s.p != null ? { type: s.type, player: s.p } : { type: s.type }));
  }
  if (Object.keys(qa).length) hand.quickAdd = qa;
  return hand;
}

/* ── Entry points ──────────────────────────────────────────────────────────── */

function finish(it, notes, opts) {
  const before = it.streets.length ? it.streets[0].actions.length : 0;
  stripImplicitFolds(it);
  const stripped = before - (it.streets.length ? it.streets[0].actions.length : 0);
  seatInternal(it, notes);
  resolveStakes(it, notes);
  validateCards(it, notes);
  insertImplicitFolds(it, notes, stripped);
  alternateHeadsUp(it, notes);
  resolveAmounts(it, notes);
  if (it.heroIdx == null && it.seats.length) notes.add('No hero was identified: whose hand is this?');
  return internalToHand(it, opts);
}

/** The model's record_hand input → { hand, notes } (server notes only). */
function normalizeDraft(draft, opts = {}) {
  const notes = new Notes();
  const hints = isObj(opts.hints) ? opts.hints : {};
  const it = draftToInternal(draft, hints, notes);
  const hand = finish(it, notes, { heroName: hints.heroName });
  return { hand, notes: notes.list };
}

/** A partial replayer hand → the same hand, normalised (idempotent on its own output). */
function normalizeHand(hand, opts = {}) {
  const notes = new Notes();
  const it = handToInternal(hand, notes);
  const out = finish(it, notes, { heroName: opts.heroName });
  return { hand: out, notes: notes.list };
}

module.exports = {
  normalizeDraft, normalizeHand, canonicalAction, ACTIONS, streetIndexByName,
  // exposed for tests
  _internal: { draftToInternal, handToInternal, seatInternal, resolveAmounts, straddleList, ord },
};
