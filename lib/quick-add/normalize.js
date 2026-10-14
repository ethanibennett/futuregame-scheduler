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
const { parseCards, knownCards, parseAmount, parseAmountInfo, parseStakes, roundChips, cleanText, isInt } = require('./cards');
const DECISIONS = require('./decisions'); // the owner's open decisions and their defaults

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

const PENDING_ACTION_KEYS = ['toAmount', 'toAmountBB', 'potFraction', 'sizeChoices'];
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
  if (!game && d.variant != null) game = G.canonicalGameName(d.variant) || G.canonicalGameName(variantGame(d.variant)); // decision E
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
  readStakesText(it, b.stakes, hints, notes);
  if (b.anteType === 'per_player' && it.blinds.ante) it.quick.antePerPlayer = it.blinds.ante;
  else if (b.anteType !== 'bb' && it.blinds.ante > 0 && it.blinds.bb > 0 && it.blinds.ante < it.blinds.bb
    && it.category !== 'stud') {
    /* An ante nobody called a big blind ante or a per-player ante: a 5,000 ante at a
       40,000 big blind is every player's, a 40,000 one the big blind's. Below the big
       blind it is asked (2026-10-14: web-022 stored a per-player ante as a BB ante). */
    it.quick.anteUnclear = it.blinds.ante;
  }
  it.straddles = (Array.isArray(b.straddles) ? b.straddles : []).filter(isObj).slice(0, 4)
    .map((s) => ({ type: ['utg', 'button', 'mississippi', 'rock'].includes(s.type) ? s.type : null, p: isInt(s.player) ? s.player : null }))
    .filter((s) => s.type);

  const rawPlayers = Array.isArray(d.players) ? d.players : [];
  if (rawPlayers.length > 10) notes.add('More than ten players were described; only the first ten are kept.');
  it.seats = rawPlayers.slice(0, 10).map((p) => {
    const q = isObj(p) ? p : {};
    const token = G.canonicalPosition(q.position);
    if (token === 'UTG' && /^\s*(?:ep|early(?:\s*position)?)\s*$/i.test(String(q.position || ''))) {
      notes.add(`"${cleanText(q.position, 30)}" was seated as UTG.`);
    }
    if (q.position != null && String(q.position).trim() && !token) {
      notes.add(`"${cleanText(q.position, 30)}" does not name a seat, so that position is left open.`);
    }
    const st = parseAmountInfo(q.startingStack);
    if (st && st.approx) hedge(it, notes, 'A stack said as about ' + st.value + ' was recorded as ' + st.value + '.', 'stack:' + st.value);
    return {
      name: cleanText(q.name, 40),
      pos: token, // narrator vocabulary
      stack: st ? st.value : null,
      stackBB: readNumber(q.startingStackBB),
      cards: {},
      isHero: q.isHero === true,
      seatNumber: readInt(q.seatNumber, 1, 10),
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
  if (d.observer === true && it.heroIdx == null) {
    if (DECISIONS.OBSERVER_HANDS === 'refuse') it.quick.notRecordable = it.quick.notRecordable || 'the narrator was not in the hand'; // decision C
    else it.heroless = true; // decision C: stored hero-less, no hero question
  }
  if (d.recordable === false) it.quick.notRecordable = cleanText(d.whyNot, 160) || true;
  const otherRaw = (Array.isArray(d.otherHands) ? d.otherHands : []).slice(0, 6)
    .map((h) => ({ text: cleanText(isObj(h) ? h.summary : h, 120), index: isObj(h) ? readInt(h.index, 1, 8) : null })).filter((h) => h.text);
  if (otherRaw.length) {
    it.quick.otherHands = otherRaw.map((h) => h.text);
    // Which hand number each one is (1-based, in the order told), so the player can ask for it.
    if (otherRaw.every((h) => h.index != null)) it.quick.otherHandIndexes = otherRaw.map((h) => h.index);
  }
  if (DECISIONS.UTG_WITH_STRADDLE === 'next-seat') nextSeatAfterStraddler(it, notes); // decision A
  readFormat(it, d, notes);
  seatByNumbers(it, d, notes);

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
      // A board given as ranks alone ("river 6", "842") is kept; pickSuits fills the suits.
      if (!pc) notes.add(`The board "${cleanText(st.board, 20)}" is not card notation and was left out.`);
      else {
        street.board = street.board.concat(pc.cards);
        if (pc.texture && !street.texture) street.texture = { kind: pc.texture };
        if (pc.unknownCount) notes.add(`${pc.unknownCount === 1 ? 'A board card' : pc.unknownCount + ' board cards'} with no rank given ("${cleanText(st.board, 20)}") could not be recorded.`);
      }
    }
    const tex = readTexture(st.texture, st.suitCounts);
    if (tex) street.texture = tex;
    const pot = parseAmountInfo(isObj(st.potBefore) ? st.potBefore.value : st.potBefore);
    if (pot && pot.value > 0) street.potBefore = { value: pot.value, approx: pot.approx || !!(isObj(st.potBefore) && st.potBefore.approx) };
    const bc = readChoices(st.boardChoices);
    if (bc && !street.board.length) street.boardChoices = bc;
    (Array.isArray(st.cards) ? st.cards : []).forEach((c) => {
      if (!isObj(c) || !inRange(c.player)) return;
      const ch = readChoices(c.choices);
      if (ch && (c.cards == null || !String(c.cards).trim())) { (it.seats[c.player].cardChoices ||= {})[si] = ch; return; }
      const pc = parseCards(c.cards);
      if (!pc) { notes.add(`"${cleanText(c.cards, 20)}" is not card notation and was left out.`); return; }
      if (!pc.cards.length) return;
      const seat = it.seats[c.player];
      if (seat.cards[si] && seat.cards[si].join('') !== pc.cards.join('')) {
        notes.add('Two different sets of cards were given for one player on one street; the first is kept.');
        return;
      }
      seat.cards[si] = pc.cards;
      if (pc.suitedness) seat.suitedness = pc.suitedness;
      const pat = readPattern(c.suitPattern, c.suitCounts) || (pc.suitPattern ? readPattern(pc.suitPattern) : null);
      if (pat) seat.pattern = pat;
      if (pc.hiddenCount && it.category === 'stud') notes.add(`Face-down cards written as x were left as unknown.`);
      if (pc.bothSuited) notes.add(`"${cleanText(c.cards, 12)}" has one suit letter, read as both cards of that suit (${pc.cards.join(' ')}); edit it if that is wrong.`);
      if (pc.partialSuits) notes.add(`"${cleanText(c.cards, 12)}" does not say which cards had the ${pc.cards.filter((x) => x[1] !== 'x').length > 1 ? 'suits' : 'suit'} given, so ${pc.cards.filter((x) => x[1] !== 'x').join(' ')} were taken.`);
    });
    (Array.isArray(st.actions) ? st.actions : []).forEach((a) => {
      if (!isObj(a)) return;
      const action = canonicalAction(a.action);
      const group = readGroup(a, action);
      if (group && !inRange(a.player)) { street.actions.push(group); return; }
      if (!action || !inRange(a.player)) {
        notes.add('An action without a known player or type was left out.');
        return;
      }
      const ra = readAction(a, action);
      const amt = parseAmountInfo(a.toAmount);
      if (a.approx === true || (amt && amt.approx)) {
        const said = ra.toAmount ?? ra.amount ?? '?';
        hedge(it, notes, 'A size said as about ' + said + ' was recorded as said.', 'size:' + si + ':' + said);
      }
      const behind = readNumber(a.behind);
      if (behind != null) ra.behind = behind;
      street.actions.push(ra);
    });
    dedupeRestatements(street, notes, (G.STREETS[it.category] || [])[si]);
  });
  tidyBoards(it, notes, hints);

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
  it.pots = readPots(d.result, inRange);
  if (!(it.winners && it.winners.length) && it.pots.length) it.winners = it.pots[0].winners.slice();
  return it;
}

function readFraction(v) {
  const n = readNumber(v);
  return n != null && n > 0 && n <= 10 ? n : null;
}
/* Both readings of a size shorthand that is ambiguous ("b40": 40% of the pot, or 40 / 40k
   chips). Two or more distinct readings, or null — one reading is just a size. */
function readSizeChoices(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const c of v.slice(0, 4)) {
    if (!isObj(c)) continue;
    const pf = readFraction(c.potFraction), to = readNumber(c.toAmount);
    if (pf != null && !out.some((o) => o.potFraction === pf)) out.push({ potFraction: pf });
    else if (to != null && to > 0 && !out.some((o) => o.toAmount === to)) out.push({ toAmount: to });
  }
  return out.length >= 2 ? out : null;
}
/* An action as read from the draft or a hand: when the size is ambiguous, no single reading
   may be applied, so the plain size fields are dropped and the gap engine asks. */
function readAction(a, action) {
  const o = {
    p: a.player, action,
    amount: readNumber(a.amount),
    toAmount: readNumber(a.toAmount),
    toAmountBB: readNumber(a.toAmountBB),
    potFraction: readFraction(a.potFraction),
    sizeChoices: readSizeChoices(a.sizeChoices),
  };
  if (o.sizeChoices && o.amount == null) { o.toAmount = null; o.toAmountBB = null; o.potFraction = null; }
  else o.sizeChoices = null;
  return o;
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
/* result.pots = [{ name, winners: [{ playerIdx, split }] }]: "main", "side 1", "board 2", "run 1" …
   (decision G, 2026-10-14). At most eight, each with at least one winner in range. */
function readPots(result, inRange) {
  const ps = isObj(result) && Array.isArray(result.pots) ? result.pots.slice(0, 8) : [];
  const out = [];
  for (const pot of ps) {
    if (!isObj(pot)) continue;
    const winners = readWinners({ winners: pot.winners }, inRange);
    if (!winners || !winners.length) continue;
    out.push({ name: cleanText(pot.name, 20) || (out.length ? 'side ' + out.length : 'main'), winners });
  }
  return out;
}
/* Everyone who won any pot, for the checks that ask who was involved. */
function allWinners(it) {
  const seen = new Set(), out = [];
  for (const w of (it.winners || []).concat(...(it.pots || []).map((p) => p.winners))) if (!seen.has(w.p)) { seen.add(w.p); out.push(w); }
  return out;
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

/* ── Draft extras (2026-10-14, from the collected corpora) ─────────────────── */

/* The stakes as the player wrote them ("6/12k", "1/2/5", "8-16", "5/T"). The model
   reads the numbers too, but a "k" after the last number is easy to apply to one of
   them only: "6/12k" came back as sb 6, bb 12,000. The written stakes win where the
   model's numbers are the same digits at another scale. */
function readStakesText(it, text, hints, notes) {
  if (text == null || !String(text).trim()) return;
  const ps = parseStakes(text, { fused: hints && hints.source === 'speech' });
  if (!ps) return;
  const b = it.blinds;
  /* "1/2/4/800" is a tower of straddles in thousands (100/200 with a 400 and an 800 straddle): four
     or more numbers are never read as sb/bb here, only used to fill what the model left empty. */
  const tower = ps.numbers.length >= 4;
  const info = it.gameType ? G.GAMES[it.gameType] : null;
  if (tower) {
    if (b.bb == null && b.sb == null) { b.sb = ps.sb; b.bb = ps.bb; }
    return;
  }
  if (info && info.betting === 'fl') {
    /* Limit stakes name the BETS ("4/8", "2-7 TD 1224", stud "10/20"): the first is the
       small bet, which is the big blind, and the second the big bet. Hold'em and draw
       games post half a small bet as the small blind; stud has no small blind. */
    let fixedLimit = false;
    if (b.bb == null) {
      b.bb = ps.sb;
      if (b.bigBet == null) b.bigBet = ps.bb;
      if (b.sb == null && it.category !== 'stud') b.sb = roundChips(ps.sb / 2, b);
    } else if (b.bb !== ps.sb && sameDigits(b.bb, ps.sb)) {
      b.bb = ps.sb; fixedLimit = true;
      if (b.bigBet != null && b.bigBet !== ps.bb && sameDigits(b.bigBet, ps.bb)) b.bigBet = ps.bb;
    }
    if (fixedLimit && notes) notes.add(`The stakes "${cleanText(text, 20)}" were read as bets of ${b.bb}/${b.bigBet}.`);
    return;
  }
  let fixed = false;
  if (b.bb == null) b.bb = ps.bb;
  else if (b.bb !== ps.bb && sameDigits(b.bb, ps.bb)) { b.bb = ps.bb; fixed = true; }
  if (b.sb == null) b.sb = ps.sb;
  else if (b.sb !== ps.sb && sameDigits(b.sb, ps.sb)) { b.sb = ps.sb; fixed = true; }
  if (fixed && notes) notes.add(`The stakes "${cleanText(text, 20)}" were read as ${b.sb}/${b.bb}.`);
}
/* 6 and 6,000 (or 0.5 and 500) are the same number at another scale. */
function sameDigits(a, b) {
  if (!(a > 0 && b > 0)) return false;
  const r = a > b ? a / b : b / a;
  return [10, 100, 1000, 1e4, 1e6].some((k) => Math.abs(r - k) < 1e-9);
}

/* Decision A (owner, 2026-10-14): with a UTG straddle on, the player called "UTG" is the seat
   AFTER the straddler. The prompt says so; this is the safety net for a draft that lists the
   straddler (straddles[].player) and still gives another player the position UTG. */
function nextSeatAfterStraddler(it, notes) {
  const st = it.straddles.find((s) => s.type === 'utg');
  if (!st || st.p == null || !it.seats[st.p]) return;
  const taken = new Set(it.seats.map((s) => s.pos));
  it.seats.forEach((s, i) => {
    if (i === st.p || s.pos !== 'UTG') return;
    if (taken.has('UTG+1')) { notes.add('Two players were placed at UTG with a UTG straddle on; check who sat where.'); return; }
    s.pos = 'UTG+1';
    taken.add('UTG+1');
    notes.add('With a UTG straddle on, the player called UTG sits after the straddler: seated as UTG+1.');
  });
}

/* Decision B: an estimate ("about 150") is recorded and noted; with HEDGED_VALUES = 'ask' it is
   also a non-blocking question, so the player confirms it. */
function hedge(it, notes, text, key) {
  notes.add(text);
  if (DECISIONS.HEDGED_VALUES !== 'ask') return;
  (it.quick.questions ||= []).push({
    id: 'approx:' + key, kind: 'ambiguous', field: 'quickAdd.questions',
    question: text + ' Is that right?',
    options: [{ label: 'Keep it as said', value: { op: 'dismiss' } }],
    allowFree: true, blocking: false,
  });
}

/* Decision E: the nearest game a variant with no game of its own is recorded as ("Courchevel" → PLO), or null. */
function variantGame(variant) {
  const k = String(variant == null ? '' : variant).trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  for (const [name, game] of Object.entries(DECISIONS.VARIANT_GAMES)) if (name.toLowerCase() === k) return game;
  return null;
}

/* TODO(deferred by the owner on 2026-10-14 — "mark this as something to come back to"):
   bomb pots, double boards, run it twice, button blinds and rock straddles. Until the owner
   decides, the CURRENT behaviour stays: the hand is recorded as told and the player is told
   what was dropped (quickAdd.unsupported). See decisions.js, UNSUPPORTED_FORMATS.

   Formats and variants the replayer cannot store, said so instead of approximated
   silently. The hand is still recorded as told; the client lists these as a note. */
function readFormat(it, d, notes) {
  const f = isObj(d.format) ? d.format : {};
  const out = [];
  if (f.bombPot) out.push('a bomb pot (everyone in before the flop, no preflop betting)');
  if (f.doubleBoard) out.push('a double board (only the first board is recorded)');
  if (f.runouts != null && Number(f.runouts) >= 2) out.push('running it ' + (Number(f.runouts) === 2 ? 'twice' : Number(f.runouts) + ' times') + ' (only the first runout is recorded)');
  if (f.buttonBlind) out.push('a button blind');
  const v = cleanText(d.variant, 30);
  if (v && !G.canonicalGameName(v)) out.push(v + ' (recorded as ' + (it.gameType || 'the nearest game the replayer plays') + ')');
  if (out.length) {
    if (DECISIONS.UNSUPPORTED_FORMATS === 'refuse') it.quick.notRecordable = it.quick.notRecordable || 'the replayer cannot store ' + out.join('; '); // decision D
    else it.quick.unsupported = out;
    notes.add('The replayer cannot store ' + out.join('; ') + '.');
  }
}

/* A pasted hand history names seats by number and the button by seat ("Seat #7 is
   the button"). With every player's seat number and the button's, positions are
   arithmetic: clockwise from the button come BTN, SB, BB, then the first to act. */
function seatByNumbers(it, d, notes) {
  const btn = readInt(d.buttonSeat, 1, 10);
  if (btn == null || it.category === 'stud') return;
  const seats = it.seats;
  const n = seats.length;
  if (n < 2 || seats.some((s) => s.seatNumber == null)) return;
  if (new Set(seats.map((s) => s.seatNumber)).size !== n) return;
  if (it.tableSize != null && it.tableSize !== n) return;
  const sorted = seats.map((s, i) => i).sort((a, b) => seats[a].seatNumber - seats[b].seatNumber);
  const b0 = sorted.findIndex((i) => seats[i].seatNumber === btn);
  if (b0 < 0) { notes.add('The button\'s seat (' + btn + ') is not one of the players\' seats, so positions are left as given.'); return; }
  const labels = G.positionLabels(n);
  sorted.forEach((i, k) => {
    const off = (k - b0 + n) % n;
    seats[i].pos = labels[n === 2 ? off : (off + n - 3) % n];
  });
  it.posMode = 'app';
  it.tableSize = n;
}

const SUIT_KEYS = ['s', 'h', 'd', 'c'];
function readCounts(v) {
  if (!isObj(v)) return null;
  const out = {};
  for (const k of Object.keys(v)) {
    const su = { s: 's', spade: 's', spades: 's', h: 'h', heart: 'h', hearts: 'h', d: 'd', diamond: 'd', diamonds: 'd', c: 'c', club: 'c', clubs: 'c' }[String(k).toLowerCase()];
    const n = readInt(v[k], 0, 7);
    if (su && n != null) out[su] = n;
  }
  return Object.keys(out).length ? out : null;
}
/* A board's suits as described: "rainbow", "two-tone", "monotone", or counts per suit
   ({ c: 2 } = exactly two clubs). On the flop it is the flop; on a later street it is
   the whole board by then. */
function readTexture(t, counts) {
  const c = readCounts(counts);
  const k = typeof t === 'string' ? t.toLowerCase().replace(/[^a-z]/g, '') : '';
  const kind = { rainbow: 'rainbow', rb: 'rainbow', twotone: 'two-tone', monotone: 'monotone', mono: 'monotone' }[k] || null;
  if (!kind && !c) return null;
  return { ...(kind ? { kind } : {}), ...(c ? { counts: c } : {}) };
}
/* A holding's suits as described: suited, offsuit, ds (two suits, two cards each), ss
   (exactly one pair of a suit), ts (three pairs, six-card games), rainbow (no two
   alike), monotone, or counts per suit. */
function readPattern(p, counts) {
  const c = readCounts(counts);
  const k = typeof p === 'string' ? p.toLowerCase().replace(/[^a-z]/g, '') : '';
  const kind = {
    suited: 'suited', offsuit: 'offsuit', off: 'offsuit',
    ds: 'ds', doublesuited: 'ds', ss: 'ss', singlesuited: 'ss', ts: 'ts', triplesuited: 'ts',
    rainbow: 'rainbow', foursuits: 'rainbow', monotone: 'monotone',
  }[k] || null;
  if (!kind && !c) return null;
  return { ...(kind ? { kind } : {}), ...(c ? { counts: c } : {}) };
}
/* Two or more readings of a card string said two ways ("a six or a seven"). */
function readChoices(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const x of v.slice(0, 4)) {
    const pc = parseCards(x);
    if (!pc || !pc.cards.length) continue;
    const key = pc.cards.join('');
    if (!out.some((o) => o.join('') === key)) out.push(pc.cards);
  }
  return out.length >= 2 ? out : null;
}
/* A collective action ("whole table calls", "4 callers", "checks around", "all others
   fold"): a marker in the street's actions, expanded to one action per seat once the
   table is seated (expandGroups). count null = everyone still to act. */
function readGroup(a, action) {
  const kind = typeof a.group === 'string' ? a.group.toLowerCase() : null;
  const count = readInt(a.count, 1, 9);
  if (!['rest', 'all', 'others', 'count'].includes(kind || '') && count == null) return null;
  if (!['call', 'fold', 'check'].includes(action)) return null;
  return { group: true, action, count };
}

/* A transcript repeats itself ("I bet 50. 50. okay", "Ernie checks … Ernie checks"):
   two identical actions by the same player one after the other cannot both have
   happened, so they are one. */
function dedupeRestatements(street, notes, name) {
  const out = [];
  let dropped = 0;
  for (const a of street.actions) {
    const prev = out[out.length - 1];
    if (prev && !a.group && !prev.group && prev.p === a.p && prev.action === a.action
        && ['check', 'call', 'bet', 'all-in', 'fold'].includes(a.action)
        && prev.toAmount === a.toAmount && prev.amount === a.amount && prev.potFraction === a.potFraction) { dropped++; continue; }
    out.push(a);
  }
  if (dropped) {
    street.actions = out;
    notes.add('An action said twice in a row on the ' + String(name || 'street').toLowerCase() + ' was recorded once.');
  }
}

/* Boards as players write them, before suits are filled in:
   - a board read twice in a row ("Jh3s2h Jh3s2h") is one board;
   - a later street written with the earlier cards again ("Turn: KsJc4h 7s",
     "KQ6Q => KQ6QJ") keeps only its new cards;
   - in a transcript, a "flop" of four cards whose last is a deuce with no suit is
     usually three cards and a suit count ("queen 982 diamonds"): the flop keeps three
     and the player is asked whether the deuce was the turn. */
function tidyBoards(it, notes, hints) {
  if (it.category !== 'community') return;
  const s = it.streets;
  const sameCard = (a, b) => a[0] === b[0] && (a[1] === b[1] || a[1] === 'x' || b[1] === 'x');
  const startsWith = (arr, pre) => pre.length > 0 && arr.length > pre.length && pre.every((c, k) => sameCard(arr[k], c));
  s.forEach((st, si) => {
    const bd = st.board;
    if (bd.length >= 2 && bd.length % 2 === 0) {
      const h = bd.length / 2;
      /* Two equal halves are a board read twice only when they cannot be two different
         cards: suits known ("Jh3s2h Jh3s2h"), or more cards than the street deals. "KKx"
         is [Kx, Kx] on a flop — two kings of unknown suits, not one — so it stays. */
      const readTwice = bd.every((c) => c[1] !== 'x') || bd.length > G.BOARD_COUNTS[si];
      if (readTwice && bd.slice(0, h).every((c, k) => c === bd[h + k])) {
        st.board = bd.slice(0, h);
        notes.add('The ' + G.STREETS.community[si].toLowerCase() + ' was given twice; it is recorded once.');
      }
    }
  });
  let before = [];
  for (let si = 0; si < s.length; si++) {
    const bd = s[si].board;
    if (before.length && startsWith(bd, before)) {
      s[si].board = bd.slice(before.length);
      notes.add('The ' + G.STREETS.community[si].toLowerCase() + ' was written with the earlier board cards again; only its new card' + (s[si].board.length > 1 ? 's are' : ' is') + ' kept.');
    }
    before = before.concat(s[si].board);
  }
  const flop = s[1].board;
  if (hints && hints.source === 'speech' && flop.length === 4 && flop[3] === '2x' && !s[2].board.length && !s[3].board.length) {
    s[1].board = flop.slice(0, 3);
    it.quick.pendingDeuce = true;
  }
}

/* ── Hand (a partial replayer hand from the client) → internal ─────────────── */

const HAND_KEYS = new Set(['gameType', 'gameMode', 'currency', 'title', 'blinds', 'players', 'heroIdx', 'heroless', 'streets', 'result', 'quickAdd']);
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
  if (qa.observer === true) it.heroless = true; // an older client state: now hand.heroless
  if (qa.notRecordable) it.quick.notRecordable = typeof qa.notRecordable === 'string' ? cleanText(qa.notRecordable, 160) : true;
  if (Array.isArray(qa.otherHands)) it.quick.otherHands = qa.otherHands.map((x) => cleanText(x, 120)).filter(Boolean).slice(0, 6);
  if (Array.isArray(qa.otherHandIndexes) && qa.otherHandIndexes.length === (it.quick.otherHands || []).length) it.quick.otherHandIndexes = qa.otherHandIndexes.map((x) => readInt(x, 1, 8));
  if (Array.isArray(qa.unsupported)) it.quick.unsupported = qa.unsupported.map((x) => cleanText(x, 160)).filter(Boolean).slice(0, 6);
  if (readNumber(qa.anteUnclear) != null) it.quick.anteUnclear = readNumber(qa.anteUnclear);
  if (Array.isArray(qa.questions)) {
    it.quick.questions = qa.questions.filter((x) => isObj(x) && typeof x.id === 'string' && typeof x.question === 'string').slice(0, 12);
  }
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
  if (h.heroless === true && it.heroIdx == null) it.heroless = true;
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
      street.actions.push(readAction(a, action));
    });
    (Array.isArray(st.draws) ? st.draws : []).forEach((dr) => {
      if (!isObj(dr) || !inRange(dr.player)) return;
      street.draws.push(readDraw({ ...dr, p: dr.player }, notes));
    });
  });
  it.winners = readWinners(h.result, inRange);
  it.pots = readPots(h.result, inRange);
  insertGroups(it, qa.groups);
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
  allWinners(it).forEach((w) => used.add(w.p));
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
    st.actions.forEach((a) => { if (!a.group) a.p = f(a.p); });
    st.actions = st.actions.filter((a) => a.group || a.p != null);
    st.draws.forEach((d) => { d.p = f(d.p); });
    st.draws = st.draws.filter((d) => d.p != null);
  });
  if (it.winners) it.winners = it.winners.map((w) => ({ ...w, p: f(w.p) })).filter((w) => w.p != null);
  if (it.pots) it.pots = it.pots.map((pot) => ({ ...pot, winners: pot.winners.map((w) => ({ ...w, p: f(w.p) })).filter((w) => w.p != null) })).filter((pot) => pot.winners.length);
  it.straddles.forEach((s) => { if (s.p != null) s.p = f(s.p); });
}

/* ── Stakes, stacks, straddles ─────────────────────────────────────────────── */

function resolveStakes(it, notes) {
  const b = it.blinds;
  limitStakesFromSizes(it, notes);
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

/* A fixed-limit hand told with sizes but no stakes ("bets 4k on the flop") states the
   limits: the first bet after the flop is one small bet, a first turn or river bet one big
   bet. The blinds are then half a small bet and a small bet, as fixed-limit games post
   them. A preflop raise is the last resort and only a guess: the model leaves out an
   open nobody is named for, so the first raise it records may already be a 3-bet ("I
   3-bet to 12" at 4/8 is not a raise to two small bets of 6) — the note says so. */
function limitStakesFromSizes(it, notes) {
  const b = it.blinds;
  const info = it.gameType ? G.GAMES[it.gameType] : null;
  if (!info || info.betting !== 'fl' || b.bb != null) return;
  if (it.category === 'stud') return; // stud's bring-in and completion are their own
  const first = (si, kinds) => (it.streets[si] ? it.streets[si].actions.find((a) => kinds.includes(a.action)) : null);
  const size = (a) => (a && a.toAmount > 0 ? a.toAmount : a && a.amount > 0 ? a.amount : null);
  let small = null, how = '', guess = false;
  for (let si = 1; si < it.streets.length && small == null; si++) {
    const bet = size(first(si, ['bet']));
    if (!bet) continue;
    small = G.SMALL_BET_STREETS.has(si) ? bet : bet / 2;
    how = 'the first bet after the first round, ' + bet;
  }
  if (small == null) {
    const pre = first(0, ['raise', 'bet']);
    const preSize = size(pre);
    if (preSize && !it.streets[0].actions.slice(0, it.streets[0].actions.indexOf(pre)).some((a) => a.action === 'raise' || a.action === 'bet')) {
      small = preSize / 2; guess = true; how = 'the first raise recorded, to ' + preSize + ' (it may be a re-raise)';
    }
  }
  if (small == null) return;
  b.bb = small;
  if (b.bigBet == null) b.bigBet = small * 2;
  if (b.sb == null) b.sb = roundChips(small / 2, b);
  notes.add(`No limits were said; ${how}, makes them ${b.bb}/${b.bigBet} (blinds ${b.sb}/${b.bb}).${guess ? ' This is a guess.' : ''}`);
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
  allWinners(it).forEach((w) => other.add(w.p));
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
        const fromIP = acts.every((a, k) => a.p === live[(k + 1) % 2]);
        const name = (G.STREETS[it.category] || [])[si] || 'later street';
        if (!alternates && fromIP && ['bet', 'all-in'].includes(acts[0].action)) {
          /* "He bets, I call" with the bettor in position: the player out of position
             checked first, which went unsaid (2026-10-14). Moving the bet to the other
             player instead would change who bet. */
          st.actions = [{ p: live[0], action: 'check', amount: 0 }, ...acts];
          notes.add(`The ${name} check before the first bet was not said; it is recorded.`);
        } else if (!alternates) {
          acts.forEach((a, k) => { a.p = live[k % 2]; });
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

/* ── Collective and implied actions (2026-10-14) ───────────────────────────── */

/* Seats in acting order on street si of a seated table: preflop from the left of the
   last straddle (or of the big blind), after the flop from the small blind. */
function actingOrder(it, si) {
  const n = it.seats.length;
  if (si === 0) {
    const sl = straddleList(it);
    const start = sl.length ? (sl[sl.length - 1].seat + 1) % n : 0;
    return Array.from({ length: n }, (_, k) => (start + k) % n);
  }
  if (n === 2) return [1, 0];
  return [n - 2, n - 1, ...Array.from({ length: n - 2 }, (_, i) => i)];
}
/* Who owes action, as a story tells it: no amounts, only turns. A bet, raise or all-in
   reopens the action for everyone who acted before it. */
function turnTracker(order, folded0, allIn, preflop) {
  const folded = new Set(folded0);
  const acted = new Set(), last = {};
  let agg = preflop ? 1 : 0, ptr = 0;
  const owes = (p) => !folded.has(p) && !allIn.has(p) && (!acted.has(p) || (last[p] ?? -1) < agg);
  return {
    owes,
    get agg() { return agg; },
    apply(p, action) {
      /* Seats the turn passed over before p never acted: before the flop they folded
         ("folds to me"), after it they checked. They are not still to act. */
      const k0 = order.indexOf(p);
      for (let k = ptr; k0 >= 0 && k < ptr + order.length; k++) {
        const q = order[k % order.length];
        if (q === p) break;
        if (!acted.has(q) && owes(q)) {
          if (preflop) folded.add(q); else { acted.add(q); last[q] = agg; }
        }
      }
      if (action === 'bet' || action === 'raise' || action === 'all-in') agg++;
      acted.add(p); last[p] = agg;
      if (action === 'fold') folded.add(p);
      if (action === 'all-in') allIn.add(p);
      const k = order.indexOf(p);
      if (k >= 0) ptr = k + 1;
    },
    /* Seats that owe action from the pointer on, in order, up to (not including) stop. */
    upTo(stop) {
      const out = [];
      for (let k = 0; k < order.length; k++) {
        const p = order[(ptr + k) % order.length];
        if (p === stop) break;
        if (owes(p) && !out.includes(p)) out.push(p);
      }
      return out;
    },
  };
}
function foldedBefore(it, si) {
  const folded = new Set(), allIn = new Set();
  for (let k = 0; k < si; k++) for (const a of it.streets[k].actions) {
    if (a.action === 'fold') folded.add(a.p);
    if (a.action === 'all-in') allIn.add(a.p);
  }
  return { folded, allIn };
}

/* "Whole table calls", "4 callers", "checks around", "all others fold": one action per
   seat, in turn order, once the table is seated. Everyone still to act before the next
   player named (or round to the last bettor) takes the group's action; with a count
   that leaves a choice, the seats that play on later go first, then the earliest, the
   others fold, and the player is told who was recorded (group-seats). */
function expandGroups(it, notes) {
  if (it.category === 'stud') return;
  it.streets.forEach((st, si) => {
    if (!st.actions.some((a) => a.group)) return;
    const { folded, allIn } = foldedBefore(it, si);
    const order = actingOrder(it, si);
    const t = turnTracker(order, folded, allIn, si === 0);
    const later = new Set();
    it.streets.forEach((s2, k) => s2.actions.forEach((a, j) => { if (!a.group && (k > si)) later.add(a.p); }));
    if (it.heroIdx != null) later.add(it.heroIdx);
    it.seats.forEach((s, i) => { if (Object.keys(s.cards).length) later.add(i); });
    allWinners(it).forEach((w) => later.add(w.p));
    const out = [];
    st.actions.forEach((a, j) => {
      if (!a.group) { out.push(a); t.apply(a.p, a.action); return; }
      const next = st.actions.slice(j + 1).find((x) => !x.group);
      const cands = t.upTo(next ? next.p : null);
      let chosen = cands;
      if (a.count != null && a.count < cands.length) {
        const pref = cands.filter((p) => later.has(p) || st.actions.slice(j + 1).some((x) => !x.group && x.p === p));
        const pick = pref.slice(0, a.count);
        for (const p of cands) if (pick.length < a.count && !pick.includes(p)) pick.push(p);
        chosen = cands.filter((p) => pick.includes(p));
        const names = chosen.map((p) => it.seats[p].pos || 'a player');
        const q = it.quick.questions || (it.quick.questions = []);
        q.push({
          id: 'group-seats:' + si + ':' + j, kind: 'ambiguous', field: 'streets.' + si + '.actions',
          question: `${a.count} player${a.count > 1 ? 's' : ''} ${a.action === 'fold' ? 'folded' : a.action === 'check' ? 'checked' : 'called'} on the ${String(G.STREETS[it.category][si]).toLowerCase()} without being named; recorded as ${names.join(', ')}. Is that right?`,
          options: [{ label: 'Yes', value: { op: 'dismiss' } }],
          allowFree: true, blocking: false,
        });
      } else if (a.count != null && a.count > cands.length) {
        notes.add(`${a.count} players were said to ${a.action} on the ${String(G.STREETS[it.category][si]).toLowerCase()}, but only ${cands.length} could have.`);
      }
      for (const p of cands) {
        let action = chosen.includes(p) ? a.action : 'fold';
        if (action === 'call' && t.agg === 0) action = 'check';
        out.push({ p, action, amount: null, toAmount: null, toAmountBB: null, potFraction: null, sizeChoices: null });
        t.apply(p, action);
      }
    });
    st.actions = out;
  });
}
/* With the table not seated yet, a group cannot be placed: it waits in quickAdd.groups
   at its place in the street, and seating (here or in the client) expands it. */
function extractGroups(it) {
  const groups = [];
  it.streets.forEach((st, si) => {
    const kept = [];
    st.actions.forEach((a) => {
      if (a.group) groups.push({ street: si, at: kept.length, action: a.action, ...(a.count != null ? { count: a.count } : {}) });
      else kept.push(a);
    });
    st.actions = kept;
  });
  if (groups.length) it.quick.groups = groups;
  else delete it.quick.groups;
}
function insertGroups(it, groups) {
  if (!Array.isArray(groups)) return;
  const bySt = {};
  for (const g of groups) {
    if (!isObj(g) || !isInt(g.street) || !it.streets[g.street] || !['call', 'fold', 'check'].includes(g.action)) continue;
    (bySt[g.street] ||= []).push(g);
  }
  for (const [si, list] of Object.entries(bySt)) {
    const acts = it.streets[si].actions;
    list.sort((x, y) => (y.at ?? 0) - (x.at ?? 0)).forEach((g) => {
      const at = Math.max(0, Math.min(isInt(g.at) ? g.at : acts.length, acts.length));
      acts.splice(at, 0, { group: true, action: g.action, count: isInt(g.count) ? g.count : null });
    });
  }
}

/* After the flop, a player named first on a street with nothing bet yet acted after
   everyone before them, who checked: "UTG checks, I bet" three-way means the big blind
   checked first. Only seats that do not act again on the street before a bet (that
   would be the same seat twice) and only multiway — heads-up streets are
   alternateHeadsUp's. */
function insertImpliedChecks(it, notes) {
  if (!it.complete || it.category === 'stud') return;
  for (let si = 1; si < it.streets.length; si++) {
    const st = it.streets[si];
    if (!st.actions.length) continue;
    const { folded, allIn } = foldedBefore(it, si);
    const order = actingOrder(it, si);
    const live = order.filter((p) => !folded.has(p));
    if (live.length < 3) continue;
    const t = turnTracker(order, folded, new Set(allIn), false);
    const out = [];
    let inserted = 0;
    st.actions.forEach((a, j) => {
      if (t.agg === 0 && t.owes(a.p)) {
        for (const q of t.upTo(a.p)) {
          const rest = st.actions.slice(j);
          const nextQ = rest.findIndex((x) => x.p === q);
          const betBefore = rest.slice(0, nextQ < 0 ? rest.length : nextQ).some((x) => ['bet', 'raise', 'all-in'].includes(x.action));
          if (nextQ >= 0 && !betBefore) break;
          out.push({ p: q, action: 'check', amount: 0 });
          t.apply(q, 'check');
          inserted++;
        }
      }
      out.push(a);
      t.apply(a.p, a.action);
    });
    if (inserted) {
      st.actions = out;
      notes.add(`On the ${String(G.STREETS[it.category][si]).toLowerCase()}, ${inserted === 1 ? 'a player' : inserted + ' players'} before the first one named checked; ${inserted === 1 ? 'that check is' : 'those checks are'} recorded.`);
    }
  }
}

/* ── Stated pots (2026-10-14) ──────────────────────────────────────────────── */

/* The pot at the start of each street from the recorded amounts, or null where an
   amount before it is unknown. */
function streetPots(it) {
  const b = it.blinds;
  const n = it.seats.length;
  const pots = [];
  let pot = 0, known = b.sb != null && b.bb != null;
  if (it.category === 'stud') { known = b.ante != null; pot = (b.ante || 0) * n; }
  else {
    pot = (b.sb || 0) + (b.bb || 0) + (b.ante || 0);
    if (b.ante == null) known = false;
    for (const sd of straddleList(it)) pot += sd.amount;
  }
  it.streets.forEach((st, si) => {
    pots[si] = known ? pot : null;
    for (const a of st.actions) {
      if (a.amount == null && a.action !== 'fold' && a.action !== 'check') known = false;
      else pot += a.amount || 0;
    }
    // A preflop all-in call for less, and the blinds' own chips, are already counted.
  });
  return pots;
}
const potTolerance = (stated, bb) => Math.max(0.1 * stated, bb || 0);
/* How far the recorded actions are from the pots the player stated: the largest
   miss as a share of the stated pot, or null when no stated pot can be compared. */
function potError(it, pots) {
  let worst = null;
  for (let si = 0; si < it.streets.length; si++) {
    const sp = it.streets[si].potBefore;
    if (!sp || pots[si] == null) continue;
    const e = Math.abs(pots[si] - sp.value) / sp.value;
    worst = worst == null ? e : Math.max(worst, e);
  }
  return worst;
}
/* Of two or more readings, the one the stated pots single out: within 10% of them,
   and at least twice as close as every other reading. -1 when none is. */
function bestReading(errors) {
  const order = errors.map((e, i) => [e, i]).filter(([e]) => e != null).sort((a, b) => a[0] - b[0]);
  if (order.length < 2 || order[0][0] > 0.1) return -1;
  return order[1][0] >= Math.max(2 * order[0][0], 0.02) ? order[0][1] : -1;
}

/* What a pot the player stated proves, settled with a note: whether an ante was every
   player's or the big blind's, and which reading of a two-way size ("b61": 61% of the
   pot or 61 chips) was meant. A stated pot the actions cannot reach is asked about,
   not forced (pot-mismatch). Rake and rounding are allowed for: 10% or a big blind. */
function reconcilePots(it, notes, snapshot) {
  if (!it.streets.some((st) => st.potBefore)) return;
  const rerun = (mutate) => {
    const copy = { ...it, blinds: { ...it.blinds }, quick: { ...it.quick } };
    copy.streets = it.streets.map((st, si) => ({ ...st, actions: snapshot.actions[si].map((a) => ({ ...a })) }));
    copy.seats = it.seats.map((s, i) => ({ ...s, stack: snapshot.stacks[i] }));
    mutate(copy);
    resolveAmounts(copy, new Notes());
    return copy;
  };
  const adopt = (copy) => { it.streets = copy.streets; it.seats = copy.seats; it.blinds = copy.blinds; it.quick = copy.quick; };

  if (it.quick.anteUnclear != null && it.complete && it.category !== 'stud') {
    const per = it.quick.anteUnclear;
    const perCopy = rerun((c) => { c.blinds.ante = roundChips(per * c.seats.length, c.blinds); });
    const pick = bestReading([potError(it, streetPots(it)), potError(perCopy, streetPots(perCopy))]);
    if (pick === 1) {
      adopt(perCopy);
      delete it.quick.anteUnclear;
      notes.add(`The pot you gave shows the ante of ${per} was posted by every player: recorded as a big blind ante of ${it.blinds.ante}.`);
    } else if (pick === 0) {
      delete it.quick.anteUnclear;
      notes.add(`The pot you gave shows the ante of ${per} was a big blind ante.`);
    }
  }

  // Two-way sizes the stated pots decide.
  const pending = [];
  it.streets.forEach((st, si) => st.actions.forEach((a, j) => { if (a.amount == null && Array.isArray(a.sizeChoices)) pending.push([si, j, a]); }));
  pending.forEach(([si, j, a]) => {
    const errors = a.sizeChoices.map((ch) => {
      const c = rerun((cc) => {
        const x = cc.streets[si].actions[j];
        x.sizeChoices = null; x.toAmount = ch.toAmount ?? null; x.potFraction = ch.potFraction ?? null;
      });
      return potError(c, streetPots(c));
    });
    const pick = bestReading(errors);
    if (pick >= 0) {
      const ch = a.sizeChoices[pick];
      const snapA = snapshot.actions[si][j];
      snapA.sizeChoices = null; snapA.toAmount = ch.toAmount ?? null; snapA.potFraction = ch.potFraction ?? null;
      adopt(rerun(() => {}));
      notes.add(`The pots you gave show the ${String(G.STREETS[it.category][si]).toLowerCase()} size meant ${ch.potFraction != null ? Math.round(ch.potFraction * 100) + '% of the pot' : ch.toAmount + ' chips'}.`);
    }
  });

  if (it.quick.anteUnclear != null) return; // the ante question comes first
  const pots = streetPots(it);
  for (let si = 0; si < it.streets.length; si++) {
    const sp = it.streets[si].potBefore;
    if (!sp || pots[si] == null) continue;
    if (Math.abs(pots[si] - sp.value) <= potTolerance(sp.value, it.blinds.bb)) continue;
    const name = String(G.STREETS[it.category][si]).toLowerCase();
    const q = it.quick.questions || (it.quick.questions = []);
    q.push({
      id: 'pot-mismatch:' + si, kind: 'impossible', field: si > 0 ? 'streets.' + (si - 1) + '.actions' : 'blinds',
      question: si > 0
        ? `You said the pot on the ${name} was ${sp.value}, but the actions before it add up to ${pots[si]}. Is an action or a size missing?`
        : `You said the pot before any action was ${sp.value}, but the blinds and antes add up to ${pots[si]}. Are the stakes right?`,
      options: [{ label: 'The actions are right', value: { op: 'dismiss' } }],
      allowFree: true, blocking: false,
    });
    break;
  }
}

/* ── Questions only the parse can ask (2026-10-14) ──────────────────────────
   Readings the text gave two ways ("a six or a seven", a four-card flop in a
   transcript): the server knows them, the client's rules cannot, so they travel in
   hand.quickAdd.questions as ready-made gaps. A question with `unless` goes away once
   that field is filled some other way. */
function boardQuestions(it, hand) {
  const qs = [];
  const used = new Set();
  const addUsed = (str) => (str.match(/../g) || []).forEach((c) => { if (c[1] !== 'x') used.add(c); });
  hand.streets.forEach((st) => { addUsed(st.cards.board || ''); addUsed(st.cards.hero || ''); (st.cards.opponents || []).forEach(addUsed); });
  const fill = (cards) => {
    const out = cards.slice();
    const local = new Set(used);
    out.forEach((c, k) => {
      if (c[1] !== 'x') return;
      const su = ['s', 'h', 'd', 'c'].find((x) => !local.has(c[0] + x));
      if (su) { out[k] = c[0] + su; local.add(out[k]); }
    });
    return out.join('');
  };
  if (it.quick.pendingDeuce && it.category === 'community' && !hand.streets[2].cards.board) {
    const flop = (hand.streets[1].cards.board.match(/../g) || []).join(' ');
    const deuce = fill(['2x']);
    qs.push({
      id: 'board-count:1', kind: 'ambiguous', field: 'streets.2.cards.board',
      question: `The flop was said with four cards. Was it ${flop} (the "two" counting a suit), or ${flop} with the ${deuce} coming on the turn?`,
      options: [
        { label: `The flop was ${flop}`, value: { op: 'dismiss' } },
        { label: `The ${deuce} was the turn`, value: { op: 'answerQuestion', id: 'board-count:1', sets: [{ path: 'streets.2.cards.board', value: deuce }] } },
      ],
      allowFree: true, blocking: false, unless: 'streets.2.cards.board',
    });
  }
  it.streets.forEach((st, si) => {
    if (!st.boardChoices || hand.streets[si].cards.board) return;
    const id = 'choice:streets.' + si + '.cards.board';
    const name = String(G.STREETS[it.category][si]).toLowerCase();
    qs.push({
      id, kind: 'ambiguous', field: 'streets.' + si + '.cards.board',
      question: `The ${name} was said two ways. Which was it?`,
      options: st.boardChoices.map((cs) => { const v = fill(cs); return { label: v.match(/../g).join(' '), value: { op: 'answerQuestion', id, sets: [{ path: 'streets.' + si + '.cards.board', value: v }] } }; }),
      allowFree: true, blocking: true, unless: 'streets.' + si + '.cards.board',
    });
  });
  const slotHero = it.heroIdx != null ? it.heroIdx : 0;
  const slotPath = (i, si) => (i === slotHero ? 'streets.' + si + '.cards.hero' : 'streets.' + si + '.cards.opponents.' + (i < slotHero ? i : i - 1));
  for (const c of it.quick.holdingConflicts || []) {
    const i = it.seats.findIndex((s) => s.cards === c.seat.cards);
    if (i < 0) continue;
    const path = slotPath(i, 0);
    qs.push({
      id: 'texture-conflict:' + path, kind: 'impossible', field: path,
      question: c.what + ' Edit the cards, or keep them as given?',
      options: [{ label: 'Keep them as given', value: { op: 'dismiss' } }],
      allowFree: true, blocking: false,
    });
  }
  it.seats.forEach((s, i) => {
    if (!s.cardChoices) return;
    for (const [k, choices] of Object.entries(s.cardChoices)) {
      const si = Number(k);
      if (si !== 0 && it.category !== 'stud') continue;
      const path = i === slotHero ? 'streets.' + si + '.cards.hero' : 'streets.' + si + '.cards.opponents.' + (i < slotHero ? i : i - 1);
      const id = 'choice:' + path;
      const whose = i === it.heroIdx ? 'Your cards were' : (s.name || s.pos || 'A player') + '’s cards were';
      qs.push({
        id, kind: 'ambiguous', field: path,
        question: `${whose} said two ways. Which was it?`,
        options: choices.map((cs) => { const v = fill(cs); return { label: v.match(/../g).join(' '), value: { op: 'answerQuestion', id, sets: [{ path, value: v }] } }; }),
        allowFree: true, blocking: i === it.heroIdx, unless: path,
      });
    }
  });
  return qs;
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
        /* "Raises to 120k and has about 200k behind": the starting stack is what went in
           plus what was left, which is arithmetic, not a guess (2026-10-14). */
        const seat = it.seats[p];
        if (a.behind != null && seat && seat.stack == null && cKnown[p]) {
          seat.stack = r(committed[p] + a.behind);
          notes.add(`${seat.isHero ? 'Your' : seat.name ? seat.name + "'s" : (seat.pos || 'A player') + "'s"} starting stack is what went in plus the ${a.behind} behind: ${seat.stack}.`);
        }
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
  if (it.heroless && heroIdx == null) hand.heroless = true; // decision C: no hero; slot 0 is seat 0
  hand.streets = streets;
  hand.result = it.winners && it.winners.length
    ? { winners: it.winners.map((w) => ({ playerIdx: w.p, split: w.split })) }
    : null;
  /* Decision G: when different pots went to different players (side pots, run it twice) the
     winners are kept per pot beside the main pot's. TODO(replayer follow-up): display and edit. */
  if (hand.result && DECISIONS.PER_POT_WINNERS && it.pots && it.pots.length > 1) {
    hand.result.pots = it.pots.map((pot) => ({ name: pot.name, winners: pot.winners.map((w) => ({ playerIdx: w.p, split: w.split })) }));
  }

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
  const q = it.quick;
  if (q.notRecordable) qa.notRecordable = q.notRecordable;
  if (q.otherHands) {
    qa.otherHands = q.otherHands;
    if (q.otherHandIndexes && q.otherHandIndexes.every((x) => x != null)) qa.otherHandIndexes = q.otherHandIndexes;
    if (DECISIONS.SEVERAL_HANDS === 'ask') qa.otherHandsBlocking = true; // decision F
  }
  if (q.unsupported) qa.unsupported = q.unsupported;
  if (q.anteUnclear != null && (it.blinds.ante > 0 || q.antePerPlayer == null)) qa.anteUnclear = q.anteUnclear;
  if (q.groups && q.groups.length) qa.groups = q.groups;
  const questions = (q.questions || []).concat(opts.parse ? boardQuestions(it, hand) : [])
    .filter((x) => !x.unless || isEmptyPath(hand, x.unless));
  if (questions.length) qa.questions = questions.slice(0, 12);
  if (Object.keys(qa).length) hand.quickAdd = qa;
  return hand;
}
function isEmptyPath(hand, path) {
  let cur = hand;
  for (const k of String(path).split('.')) { if (cur == null) return true; cur = cur[/^\d+$/.test(k) ? Number(k) : k]; }
  return cur == null || cur === '';
}

/* ── Entry points ──────────────────────────────────────────────────────────── */

function finish(it, notes, opts) {
  const before = it.streets.length ? it.streets[0].actions.length : 0;
  stripImplicitFolds(it);
  const stripped = before - (it.streets.length ? it.streets[0].actions.length : 0);
  seatInternal(it, notes);
  resolveStakes(it, notes);
  validateCards(it, notes);
  if (it.complete) expandGroups(it, notes); else extractGroups(it);
  insertImplicitFolds(it, notes, stripped);
  alternateHeadsUp(it, notes);
  insertImpliedChecks(it, notes);
  const snapshot = {
    actions: it.streets.map((st) => st.actions.map((a) => ({ ...a }))),
    stacks: it.seats.map((s) => s.stack),
  };
  resolveAmounts(it, notes);
  reconcilePots(it, notes, snapshot);
  if (it.heroIdx == null && it.seats.length && !it.heroless) notes.add('No hero was identified: whose hand is this?');
  return internalToHand(it, opts);
}

/* Suits for cards whose RANK was given and suit was not ("AKo", "river 6", "842").
   The hand format has no suitless card: a card with suit x is drawn FACE DOWN, so those
   cards replayed as backs — the hero's AKo and a stated river among them (2026-10-02).
   Each gets a real suit that fits what was said: no duplicate of any known card, suited
   or offsuit as the player wrote it (offsuit when unsaid), and on the board the suit the
   board has least of, so no flush or flush draw appears that the story did not have.
   What the player said about suits without placing them is a constraint the fill must
   satisfy (2026-10-14: "ace four deuce, one spade, two clubs" came back As 4h 2d, the
   least-used rule removing exactly the flush draw the story had):
     streets[i].texture  rainbow / two-tone / monotone / counts per suit, on the board
                         as it stands after that street;
     seat.pattern        suited / offsuit / ds / ss / ts / rainbow / monotone / counts,
                         on the holding.
   Least-used is then only the tie-break. A constraint the given cards already break is
   noted and asked about (texture-conflict), never forced.
   Parse only: in a hand coming back from the client an x card may be a deliberate "I
   don't remember", which must stay face down. */
const SUIT_ORDER = ['s', 'h', 'd', 'c'];
const SUIT_WORD = { s: 'spade', h: 'heart', d: 'diamond', c: 'club' };

function suitCounts(cards) {
  const n = { s: 0, h: 0, d: 0, c: 0 };
  for (const c of cards) if (n[c[1]] != null) n[c[1]]++;
  return n;
}
function fitsTexture(t, cards) {
  const n = suitCounts(cards);
  const vals = SUIT_ORDER.map((s) => n[s]);
  const distinct = vals.filter((v) => v > 0).length;
  if (t.kind === 'rainbow' && vals.some((v) => v > 1)) return false;
  if (t.kind === 'two-tone' && distinct !== 2) return false;
  if (t.kind === 'monotone' && distinct !== 1) return false;
  if (t.counts) for (const [s, k] of Object.entries(t.counts)) if (n[s] !== k) return false;
  return true;
}
function fitsPattern(p, cards) {
  const n = suitCounts(cards);
  const vals = SUIT_ORDER.map((s) => n[s]);
  const pairs = vals.filter((v) => v === 2).length;
  const max = Math.max(...vals);
  const distinct = vals.filter((v) => v > 0).length;
  switch (p.kind) {
    case 'suited': case 'monotone': if (distinct !== 1) return false; break;
    case 'offsuit': if (cards.length === 2 ? distinct !== 2 : max > 1) return false; break;
    case 'rainbow': if (max > 1) return false; break;
    case 'ds': if (pairs !== 2 || max > 2) return false; break;
    case 'ss': if (pairs !== 1 || max > 2) return false; break;
    case 'ts': if (pairs !== 3 || max > 2) return false; break;
    default: break;
  }
  if (p.counts) for (const [s, k] of Object.entries(p.counts)) if (n[s] !== k) return false;
  return true;
}
const COUNT_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const countWords = (counts) => Object.entries(counts).map(([s, k]) => (COUNT_WORD[k] || k) + ' ' + SUIT_WORD[s] + (k === 1 ? '' : 's'));
/* "was rainbow", "had two clubs and one spade". */
function describeTexture(t) {
  const bits = [];
  if (t.kind) bits.push('was ' + t.kind);
  if (t.counts) bits.push('had ' + countWords(t.counts).join(' and '));
  return bits.join(' and ');
}
function describePattern(p) {
  const words = { suited: 'suited', offsuit: 'offsuit', ds: 'double-suited', ss: 'single-suited', ts: 'triple-suited', rainbow: 'four different suits', monotone: 'all one suit' };
  const bits = [];
  if (p.kind) bits.push(words[p.kind] || p.kind);
  if (p.counts) bits.push(...countWords(p.counts));
  return bits.join(', ');
}

/* Every way to give the x cards in `cards` a suit (at most 4^6), in a fixed order, with
   none of them a card already in `used` and no card twice. */
function* suitAssignments(cards, used) {
  const holes = [];
  cards.forEach((c, k) => { if (c[1] === 'x') holes.push(k); });
  const total = Math.pow(4, holes.length);
  if (holes.length > 7) return;
  for (let m = 0; m < total; m++) {
    const out = cards.slice();
    let x = m, ok = true;
    for (const k of holes) {
      out[k] = cards[k][0] + SUIT_ORDER[x % 4];
      x = Math.floor(x / 4);
    }
    const seen = new Set();
    for (const c of out) {
      if (c[1] === 'x') continue;
      if (seen.has(c)) { ok = false; break; }
      seen.add(c);
    }
    if (!ok) continue;
    for (const k of holes) if (used.has(out[k])) { ok = false; break; }
    if (ok) yield out;
  }
}

function pickSuits(it, notes) {
  if (it.category === 'stud') return;
  const SUITS = SUIT_ORDER;
  const used = new Set();
  it.streets.forEach((st) => st.board.forEach((c) => { if (c[1] !== 'x') used.add(c); }));
  it.seats.forEach((s) => Object.values(s.cards).forEach((cs) => cs.forEach((c) => { if (c[1] !== 'x') used.add(c); })));
  const onBoard = (su) => it.streets.reduce((n, st) => n + st.board.filter((c) => c[1] === su).length, 0);
  const inHands = (su) => it.seats.reduce((n, s) => n + (s.cards[0] || []).filter((c) => c[1] === su).length, 0);
  const best = (ok) => SUITS.filter(ok).sort((a, b) => onBoard(a) - onBoard(b) || inHands(a) - inHands(b))[0] || null;
  const said = [];
  const conflict = (si, what, field) => {
    const q = it.quick.questions || (it.quick.questions = []);
    const id = 'texture-conflict:' + field;
    if (q.some((x) => x.id === id)) return;
    q.push({
      id, kind: 'impossible', field,
      question: what + ' Edit the cards, or keep them as given?',
      options: [{ label: 'Keep them as given', value: { op: 'dismiss' } }],
      allowFree: true, blocking: false,
    });
    notes.add(what);
  };
  /* A holding's slot (cards.hero or opponents[k]) is only known once the table is
     seated, so the question is finished in boardQuestions. */
  const holdingConflict = (seat, what) => {
    (it.quick.holdingConflicts ||= []).push({ seat, what });
    notes.add(what);
  };

  // The board first, street by street, so hole cards then avoid what it took.
  const boardBefore = it.streets.map((st) => st.board.join(''));
  const textured = it.streets.map((st, si) => (st.texture ? si : -1)).filter((si) => si >= 0);
  let solved = false;
  if (textured.length) {
    const flat = [];
    it.streets.forEach((st, si) => st.board.forEach((c, k) => flat.push({ si, k, c })));
    const cards = flat.map((f) => f.c);
    const fitsAll = (cs) => textured.every((si) => {
      const upto = cs.filter((_, j) => flat[j].si <= si);
      return fitsTexture(it.streets[si].texture, upto);
    });
    let bestCs = null, bestScore = Infinity;
    const others = new Set([...used].filter((c) => !cards.includes(c)));
    for (const cs of suitAssignments(cards, others)) {
      if (!fitsAll(cs)) continue;
      const n = suitCounts(cs);
      const score = SUITS.reduce((acc, su) => acc + (n[su] * (n[su] - 1)) / 2, 0);
      if (score < bestScore) { bestScore = score; bestCs = cs; }
    }
    if (bestCs) {
      flat.forEach((f, j) => { it.streets[f.si].board[f.k] = bestCs[j]; });
      bestCs.forEach((c) => used.add(c));
      solved = true;
    } else {
      for (const si of textured) {
        const upto = cards.filter((_, j) => flat[j].si <= si);
        if (upto.every((c) => c[1] !== 'x') && !fitsTexture(it.streets[si].texture, upto)) {
          const name = String(G.STREETS[it.category][si] || 'board').toLowerCase();
          conflict(si, `You said the ${name === 'flop' ? 'flop' : 'board by the ' + name} ${describeTexture(it.streets[si].texture)}, but the cards given are ${upto.join(' ')}.`, 'streets.' + si + '.cards.board');
        }
      }
      if (!it.quick.questions || !it.quick.questions.some((q) => /^texture-conflict:streets/.test(q.id))) {
        const si = textured[0];
        conflict(si, `The board's suits as said (it ${describeTexture(it.streets[si].texture)}) do not fit the other cards in the hand.`, 'streets.' + si + '.cards.board');
      }
    }
  }
  if (!solved) {
    it.streets.forEach((st) => {
      for (let k = 0; k < st.board.length; k++) {
        const c = st.board[k];
        if (c[1] !== 'x') continue;
        const su = best((s) => !used.has(c[0] + s));
        if (!su) continue;
        st.board[k] = c[0] + su; used.add(st.board[k]);
      }
    });
  }
  it.streets.forEach((st, si) => {
    if (st.board.join('') !== boardBefore[si]) said.push('the ' + String(G.STREETS[it.category][si] || 'board').toLowerCase() + ' ' + st.board.join(' '));
  });

  // Every street a player's cards sit on: shown cards are moved to the first street
  // later (validateCards), after this runs.
  it.seats.forEach((s, i) => Object.keys(s.cards).forEach((k) => {
    const cs = s.cards[k];
    const pattern = s.pattern && Number(k) === Math.min(...Object.keys(s.cards).map(Number)) ? s.pattern : null;
    const whose = s.isHero ? 'your ' : s.name ? s.name + "'s " : (s.pos ? s.pos + "'s " : "an opponent's ");
    if (pattern && !cs.some((c) => c[1] === 'x')) {
      if (!fitsPattern(pattern, cs)) holdingConflict(s, `You said ${whose.trim()} hand was ${describePattern(pattern)}, but the cards given are ${cs.join(' ')}.`);
      return;
    }
    if (!cs || !cs.some((c) => c[1] === 'x')) return;
    let holes = cs.slice();
    let done = false;
    if (pattern) {
      let bestCs = null, bestScore = Infinity;
      for (const cand of suitAssignments(holes, used)) {
        if (!fitsPattern(pattern, cand)) continue;
        const score = cand.reduce((acc, c, j) => acc + (cs[j][1] === 'x' ? onBoard(c[1]) * 4 + inHands(c[1]) : 0), 0);
        if (score < bestScore) { bestScore = score; bestCs = cand; }
      }
      if (bestCs) { holes = bestCs; done = true; }
      else holdingConflict(s, `You said ${whose.trim()} hand was ${describePattern(pattern)}, which the other cards in the hand rule out.`);
    }
    if (!done && s.suitedness === 's') {
      const su = best((x) => holes.every((c) => c[1] !== 'x' || !used.has(c[0] + x)));
      if (su) holes.forEach((c, j) => { if (c[1] === 'x') holes[j] = c[0] + su; });
    } else if (!done) {
      const taken = new Set(holes.filter((c) => c[1] !== 'x').map((c) => c[1]));
      holes.forEach((c, j) => {
        if (c[1] !== 'x') return;
        const su = best((x) => !used.has(c[0] + x) && !taken.has(x) && !holes.includes(c[0] + x)) || best((x) => !used.has(c[0] + x) && !holes.includes(c[0] + x));
        if (!su) return;
        holes[j] = c[0] + su; taken.add(su);
      });
    }
    holes.forEach((c) => { if (c[1] !== 'x') used.add(c); });
    s.cards[k] = holes;
    said.push(whose + 'hand ' + holes.join(' '));
  }));

  if (said.length) notes.add('Suits that were not given were filled in: ' + said.join('; ') + '. Edit the hand if they matter.');
}

/** The model's record_hand input → { hand, notes } (server notes only). */
function normalizeDraft(draft, opts = {}) {
  const notes = new Notes();
  const hints = { ...(isObj(opts.hints) ? opts.hints : {}), source: opts.source === 'speech' ? 'speech' : 'text' };
  const it = draftToInternal(draft, hints, notes);
  pickSuits(it, notes);
  const hand = finish(it, notes, { heroName: hints.heroName, parse: true });
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
  _internal: { draftToInternal, handToInternal, seatInternal, resolveAmounts, straddleList, ord, streetPots, actingOrder },
};
