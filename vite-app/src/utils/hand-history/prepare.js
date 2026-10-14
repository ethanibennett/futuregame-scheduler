// ── Hand history: from a saved hand to the hand the text encodes ────────────
// prepareHand(hand, opts) normalises the shapes saves come in (section 2 of
// docs/hand-history-io.md), seats the table, replays the betting on quick-add's
// Table (vite-app/src/utils/quick-add/betting.js — the port of the replayer's
// own betting), inserts the folds and checks a description skipped on the first
// betting round, classifies every action into its PokerStars verb from the
// CHIPS (not from the stored verb), returns uncalled bets, and settles the pot
// (settle.js). Nothing is guessed: an amount, card or turn that does not add up
// is a HandExportError, never quietly "fixed".
//
// Output: { model, events, meta, settle, warnings }
//   model    the canonical replayer hand the text encodes: the same shape the
//            replayer saves, with implicit actions added, verbs from chips,
//            the board laid out per street, and only the cards the text carries
//   events   the forced bets and, per street reached, its actions, draws and
//            uncalled return, in text order
//   meta     everything else the writer renders from (names, seats, button…)
//
// The replay mirrors, and must stay in step with, the replayer's
// calcPotsAndStacks / getActionOrder (via betting.js) and the gaps engine's
// action rules (quick-add/actions.js) — see the comments there.

import { gameConfig, gameCategory, streetDef, positionLabels, studPositionLabels, isLowStud } from '../quick-add/game.js';
import { Table, seatOrder, straddles, lastStraddleSeat, findStudBringIn, findStudBestBoard, studUpCards } from '../quick-add/betting.js';
import { cardsOf, oppSlot, isMuck, computeDrawHand } from '../quick-add/cards.js';
import { seatIndexFor } from '../quick-add/seats.js';
import { remapSeats } from '../quick-add/edit.js';
import { GAME_EVAL, seatOrderFromButton, parseCardNotation } from '../poker-engine.js';
import {
  GAME_TABLE, CURRENCIES, NOT_WRITTEN, ENGINE_GAME_NAMES, canonicalGameName, toCents, starsGameType, isPt4Game, sanitizeName,
  truncateChars, cardText,
} from './ps-format.js';
import { HandExportError } from './errors.js';
import { settlePot, evaluate, scoreOf } from './settle.js';
import { describeEvals } from './describe.js';

const isIdx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
const known = (c) => c && c.suit !== 'x';
const key = (c) => c.rank + c.suit;
const cardsStr = (arr) => arr.map(key).join('');

// ── 1. The shapes saves come in ───────────────────────────────────────────────
/* A saved hand in the current shape, whatever shape it was saved in:
   - the old wrapper (a list row whose hand lives under .handData, no .streets),
   - actions keyed `playerIdx`, amounts as strings or missing,
   - the old result { winner: i | -1, amount, handName },
   - a missing heroIdx (read as 0), gameMode (read as a tournament) or
     currency (USD), as the replayer reads them. */
export function normalizeInput(input) {
  if (!input || typeof input !== 'object') throw new HandExportError('seating', { n: 0 });
  // A shallow copy: everything changed below (players, streets, actions,
  // draws, result) is rebuilt as new objects; the rest is only read.
  let h = { ...input };
  if (h.handData && typeof h.handData === 'object' && !Array.isArray(h.streets)) {
    const imp = h.import;
    h = { ...h.handData };
    if (imp && !h.import) h.import = imp;
  }
  const players = Array.isArray(h.players) ? h.players : [];
  const n = players.length;
  h.players = players.map(p => (p && typeof p === 'object' ? { ...p } : {}));
  const toNum = (v) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(/,/g, ''))) ? Number(v.replace(/,/g, '')) : v);
  h.players.forEach(p => { p.startingStack = toNum(p.startingStack); });
  h.heroIdx = isIdx(h.heroIdx, n) ? h.heroIdx : 0;
  h.gameType = canonicalGameName(h.gameType);   // "Big Easy" is PLO6 8/b
  h.gameMode = h.gameMode === 'cash' ? 'cash' : 'mtt';
  h.currency = typeof h.currency === 'string' && h.currency.trim() ? h.currency.trim().toUpperCase() : 'USD';
  const pidx = (o) => {
    const v = o.player != null ? o.player : o.playerIdx;
    const k = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
    return Number.isInteger(k) ? k : -1;
  };
  h.streets = (Array.isArray(h.streets) ? h.streets : []).map(st => {
    const s = st && typeof st === 'object' ? { ...st } : {};
    s.actions = (Array.isArray(s.actions) ? s.actions : []).filter(a => a && typeof a === 'object').map(a => ({
      player: pidx(a),
      action: typeof a.action === 'string' ? a.action.trim().toLowerCase() : '',
      amount: Number(toNum(a.amount)) || 0,
    }));
    s.draws = (Array.isArray(s.draws) ? s.draws : []).filter(d => d && typeof d === 'object').map(d => ({ ...d, player: pidx(d) }));
    return s;
  });
  let legacySplit = false;
  const r = h.result;
  if (r && typeof r === 'object' && !Array.isArray(r) && !Array.isArray(r.winners) && 'winner' in r) {
    const w = Number(r.winner);
    if (Number.isInteger(w) && w >= 0) h.result = { winners: [{ playerIdx: w, split: false }] };
    else { h.result = { winners: [] }; legacySplit = true; }
  }
  return { hand: h, legacySplit };
}

/* The layout the replayer reads without tripping (quick-add edit.js
   normalizeStructure, without its deep copy or its name-filling: the text
   names an empty seat itself): every street the game has, each with a name,
   hero and board strings, an opponent slot for every non-hero seat, action and
   draw arrays; an unreadable result dropped. Works on normalizeInput's copy. */
export function layOut(h) {
  const def = gameConfig(h.gameType) ? streetDef(h.gameType) : null;
  const n = h.players.length;
  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  while (def && h.streets.length < def.streets.length) h.streets.push({ actions: [], draws: [] });
  h.streets = h.streets.map((st, si) => {
    const cards = st.cards && typeof st.cards === 'object' ? st.cards : {};
    const opps = (Array.isArray(cards.opponents) ? cards.opponents : []).map(str);
    while (opps.length < n - 1) opps.push('');
    while (opps.length > n - 1 && !opps[opps.length - 1]) opps.pop();
    return {
      ...st,
      name: typeof st.name === 'string' && st.name ? st.name : (def && def.streets[si]) || 'Street ' + (si + 1),
      cards: { ...cards, hero: str(cards.hero), board: str(cards.board), opponents: opps },
      actions: st.actions || [], draws: st.draws || [],
    };
  });
  const r = h.result;
  if (r != null && (typeof r !== 'object' || Array.isArray(r) || (r.winners != null && !Array.isArray(r.winners)))) h.result = null;
  if (!h.blinds || typeof h.blinds !== 'object' || Array.isArray(h.blinds)) h.blinds = {};
  return h;
}

/* Seat the players at their table: index 0 first to act preflop, the last three
   BTN, SB, BB (stud: Seat 1..n). Players saved out of that order are mapped by
   their position labels (seats.js seatIndexFor, the server's own seating) and
   must land one to a seat. */
export function seatPlayers(h, isStud) {
  const n = h.players.length;
  if (n < 2 || n > 10) throw new HandExportError('seating', { n });
  const labels = isStud ? studPositionLabels(n) : positionLabels(n);
  if (h.players.every((p, i) => p.position === labels[i])) return h;
  const idx = h.players.map((_, i) => seatIndexFor(h, i, n, 'app'));
  const bijection = idx.every(v => isIdx(v, n)) && new Set(idx).size === n;
  if (!bijection) {
    // Stud seats carry no positions that matter: keep the saved order.
    if (isStud) { h.players.forEach((p, i) => { p.position = labels[i]; }); return h; }
    throw new HandExportError('seating', { n });
  }
  const order = new Array(n);
  idx.forEach((ni, oi) => { order[ni] = oi; });
  return remapSeats(h, order);
}

// ── 2. The table ─────────────────────────────────────────────────────────────
/* Table with the forced bets taken out of startStreet, so they are posted in
   PokerStars' order (antes, then the small and big blinds, then straddles)
   each capped at the poster's stack. Otherwise identical: startStreet below is
   Table.startStreet minus its blind/straddle posting, which postBlinds does. */
class ExportTable extends Table {
  constructor(hand, env) {
    super(hand, { ...env, ante: 0 });
    this.env = env;
    this.bbAnte = !env.isStud && (env.ante || 0) > 0;
  }
  startStreet(si, hand, order) {
    super.startStreet(si, { ...hand, players: hand.players.map(p => ({ ...p, position: null })), blinds: { ...hand.blinds, straddle: false } }, order);
    // super posted nothing (no SB/BB labels, no straddles); restore the opening
    // bet level the caller sets after posting.
    this.maxBet = 0;
  }
}

function buildEnv(h, cfg, category) {
  const b = h.blinds || {};
  const c = (v) => { const x = toCents(v); return Number.isFinite(x) && x > 0 ? x : 0; };
  const bb = c(b.bb);
  return {
    cfg, category, gameType: h.gameType,
    isStud: !!cfg.isStud,
    isDraw: category === 'draw_triple' || category === 'draw_single',
    betting: cfg.betting || 'nl',
    n: h.players.length,
    bb,
    sb: c(b.sb),
    ante: c(b.ante),
    bigBet: c(b.bigBet) || bb * 2,
    bringIn: c(b.bringIn) || Math.floor(bb / 4),
    betCap: Number(b.betCap) > 0 ? Number(b.betCap) : (cfg.raiseCap || 4),
    uncapHU: b.uncapHeadsUp !== false,
    flSmallStreets: cfg.flSmallStreets || [0, 1],
    numStreets: streetDef(h.gameType).streets.length,
  };
}

const STREET_WORDS = {
  community: ['preflop', 'flop', 'turn', 'river'],
  stud: ['3rd street', '4th street', '5th street', '6th street', '7th street'],
  draw_triple: ['first betting round', 'second betting round', 'third betting round', 'last betting round'],
  draw_single: ['first betting round', 'last betting round'],
};
export function streetWord(category, si) {
  return (STREET_WORDS[category] || STREET_WORDS.community)[si] || 'street ' + (si + 1);
}

// ── 3. Names ─────────────────────────────────────────────────────────────────
/* The names the text carries: sanitised (ps-format sanitizeName), an empty
   one 'Player{seat}', duplicates made unique (" 2", " 3", case-insensitive),
   the hero first so the hero keeps theirs, and the hero's own name replaced
   by opts.heroName when given. */
function textNames(h, seatNumbers, heroName) {
  const n = h.players.length;
  const used = new Set();
  const names = new Array(n);
  let changed = false;
  const order = [h.heroIdx, ...h.players.map((_, i) => i).filter(i => i !== h.heroIdx)];
  for (const i of order) {
    const stored = typeof h.players[i].name === 'string' ? h.players[i].name : '';
    const renamed = i === h.heroIdx && sanitizeName(heroName);
    let s = renamed || sanitizeName(stored);
    if (!s) s = 'Player' + seatNumbers[i];
    const base = s;
    for (let k = 2; used.has(s.toLowerCase()); k++) {
      const suffix = ' ' + k;
      s = truncateChars(base, 30 - suffix.length).trim() + suffix;
    }
    used.add(s.toLowerCase());
    if (!renamed && s !== stored) changed = true;
    names[i] = s;
  }
  return { names, changed };
}

function validSeatNumbers(v, n) {
  return Array.isArray(v) && v.length === n && v.every(x => Number.isInteger(x) && x >= 1 && x <= 10) && new Set(v).size === n ? v.slice() : null;
}

// ── 4. The replay ─────────────────────────────────────────────────────────────
export function prepareHand(input, opts = {}) {
  // opts.shared: the hand came by someone else's share link (the UI says so). Refused before anything
  // is read: the writer renames the hero to opts.heroName, so a shared hand would be filed as the
  // viewer's own.
  if (opts.shared) throw new HandExportError('not-yours');
  const warnings = new Set();
  const { hand: raw, legacySplit } = normalizeInput(input);
  if (NOT_WRITTEN[raw.gameType]) throw new HandExportError('unsupported-game', { game: raw.gameType, ...NOT_WRITTEN[raw.gameType] });
  const cfg0 = gameConfig(raw.gameType);
  if (!cfg0 || !GAME_TABLE[raw.gameType]) throw new HandExportError('unsupported-game', { game: raw.gameType || 'game' });
  const category = gameCategory(raw.gameType);
  const isStud = !!cfg0.isStud;
  const cash = raw.gameMode === 'cash';
  if (cash && !CURRENCIES[raw.currency]) throw new HandExportError('unsupported-currency', { currency: raw.currency });

  let h = seatPlayers(layOut(raw), isStud);
  const seated = { ...h, players: h.players.map(p => ({ ...p })) };   // what the hand id hashes
  const n = h.players.length;
  const heroIdx = isIdx(h.heroIdx, n) ? h.heroIdx : 0;
  h.heroIdx = heroIdx;

  // ── Game, by the hole-card count (a PLO hand dealt five is 5 Card Omaha) ──
  const heroBase = cardsOf(((h.streets[0] || {}).cards || {}).hero);
  const gameType = isStud || category !== 'community' ? raw.gameType : starsGameType(raw.gameType, heroBase.length);
  const cfg = gameConfig(gameType) || cfg0;
  const stars = GAME_TABLE[gameType];
  if (!stars) throw new HandExportError('unsupported-game', { game: raw.gameType });
  if (stars.unverified) warnings.add('description-unverified');
  const evalCfg = GAME_EVAL[gameType] || GAME_EVAL[raw.gameType] || GAME_EVAL[ENGINE_GAME_NAMES[gameType]] || null;
  const holeCount = isStud ? 7 : cfg.heroCards;

  // ── Seats, names ──
  const imp = h.import && typeof h.import === 'object' ? h.import : {};
  const anteFirst = !!imp.anteFirst;
  const seatNumbers = validSeatNumbers(imp.seatNumbers, n) || h.players.map((_, i) => i + 1);
  const { names, changed } = textNames(h, seatNumbers, opts.heroName);
  if (changed) warnings.add('names-changed');
  const btnIdx = isStud ? -1 : (n <= 3 ? 0 : n - 3);
  const sbIdx = isStud ? -1 : h.players.findIndex(p => p.position === 'SB' || p.position === 'BTN/SB');
  const bbIdx = isStud ? -1 : h.players.findIndex(p => p.position === 'BB');

  // ── Stacks and stakes, in hundredths ──
  h.players.forEach((p, i) => {
    const s = toCents(p.startingStack);
    if (!(s > 0)) throw new HandExportError('stack-missing', { name: names[i] });
  });
  const env = buildEnv(h, cfg, category);
  if (!(env.bb > 0)) throw new HandExportError('blinds-missing', { stud: isStud });
  const scaled = {
    ...h,
    players: h.players.map(p => ({ ...p, startingStack: toCents(p.startingStack) })),
    blinds: { ...(h.blinds || {}), sb: env.sb, bb: env.bb, ante: env.ante, bigBet: env.bigBet, bringIn: env.bringIn },
  };
  const unitCents = cash ? 1 : (isWholeChips(h) ? 100 : 1);
  const stLabel = (si) => streetWord(category, si);

  // ── Cards ──
  const heroCardsAt = (si) => cardsOf(((h.streets[si] || {}).cards || {}).hero);
  const oppStr = (pi, si) => {
    const opps = (((h.streets[si] || {}).cards || {}).opponents) || [];
    return opps[oppSlot(pi, heroIdx)];
  };
  const boardAll = category === 'community' ? h.streets.reduce((acc, st) => acc.concat(cardsOf((st.cards || {}).board)), []) : [];

  // Hero cards: every one known, the count the game deals.
  if (!isStud) {
    const want = category === 'community' ? cfg.heroCards : cfg.heroCards;
    if (heroBase.length !== want || !heroBase.every(known)) throw new HandExportError('hero-cards-unknown');
  } else {
    const third = heroCardsAt(0);
    if (third.length !== 3 || !third.every(known)) throw new HandExportError('hero-cards-unknown');
  }

  // ── Replay ──
  const t = new ExportTable(scaled, env);
  const total = new Array(n).fill(0);       // layered chips in, after returns
  const beyondAnte = new Array(n).fill(0);  // chips in other than antes
  let dead = 0;                              // a big-blind ante: dead money, main pot
  const forced = [];
  const foldedOn = new Array(n).fill(null);
  const streetEvents = [];
  const studOrders = [];

  const post = (p, kind, amount) => {
    const a = Math.min(amount, t.stacks[p]);
    if (!(a > 0)) return;
    if (kind === 'ante') {
      t.post(p, a);
      if (env.isStud) total[p] += a; else dead += a;
    } else {
      t.put(p, a);
      total[p] += a; beyondAnte[p] += a;
    }
    forced.push({ kind, p, amount: a, allIn: t.stacks[p] === 0 });
  };

  if (isStud && env.ante > 0) for (let p = 0; p < n; p++) post(p, 'ante', env.ante);

  const strads = isStud ? [] : straddles(scaled.players, scaled.blinds);
  const low = isLowStud(gameType);
  let lastStreet = -1;
  let handOverAt = null;

  for (let si = 0; si < env.numStreets; si++) {
    const st = h.streets[si] || { actions: [], draws: [], cards: {} };
    const acts = st.actions || [];
    if (t.live().length <= 1) {
      if (acts.length) {
        const a = acts[0];
        throw new HandExportError('out-of-turn', { name: isIdx(a.player, n) ? names[a.player] : 'A player', street: stLabel(si) });
      }
      continue;
    }
    lastStreet = si;

    // Seat order for the street (mirrors checkActions in quick-add/actions.js).
    let order;
    if (isStud) {
      let start;
      if (si === 0) {
        const bi = findStudBringIn(scaled, low);
        const first = acts[0];
        if (first && first.action === 'bring-in' && isIdx(first.player, n)) start = first.player;
        else if (bi >= 0) start = bi;
        else if (first && isIdx(first.player, n)) start = first.player;
        else start = 0;
      } else {
        const liveCan = t.live().filter(pi => !t.allIn.has(pi));
        const first = acts.find(a => isIdx(a.player, n) && !t.folded.has(a.player));
        const upKnown = liveCan.every(pi => studUpCards(scaled, pi, si).length >= Math.min(si, 3) + 1);
        if (first) start = first.player;
        else if (upKnown && liveCan.length) start = findStudBestBoard(scaled, si, t.folded, low);
        else start = liveCan.length ? liveCan[0] : t.live()[0];
        if (!(start >= 0)) start = t.live()[0];
      }
      order = [];
      for (let i = 0; i < n; i++) order.push((start + i) % n);
      studOrders[si] = order;
    } else {
      order = seatOrder(n, si === 0, si === 0 ? lastStraddleSeat(strads) : -1);
    }
    t.startStreet(si, scaled, order);

    if (si === 0 && !isStud) {
      // Antes first, as Stars writes them; then the blinds; then straddles,
      // priced bb*2^k in seat order (betting.js straddles()). A big blind who
      // cannot cover blind and ante posts the blind first and the ante comes
      // out of what is left: that is the replayer's own order (betting.js,
      // Table.startStreet; the TDA rule), and it keeps the big blind line
      // written, so a stack no bigger than the ante never turns into an
      // ante-only hand the parser refuses. A hand imported from Stars' older
      // per-player antes (import.anteFirst) keeps Stars' order, the ante out
      // of the stack first: its short big blinds ("posts big blind 160 and is
      // all-in" after a 40 ante) replay to the pot Stars states.
      if (env.ante > 0 && bbIdx >= 0) post(bbIdx, 'ante', anteFirst ? env.ante : Math.min(env.ante, Math.max(0, t.stacks[bbIdx] - env.bb)));
      if (sbIdx >= 0 && env.sb > 0) post(sbIdx, 'sb', env.sb);
      if (bbIdx >= 0) post(bbIdx, 'bb', env.bb);
      t.maxBet = env.bb;
      let prevLevel = 0;
      for (const s of strads) {
        prevLevel = t.maxBet;
        post(s.seat, 'straddle', s.amount);
        if (s.amount > t.maxBet) t.maxBet = s.amount;
      }
      if (prevLevel > 0) t.lastRaise = Math.max(env.bb, t.maxBet - prevLevel);
    }

    const sev = { si, order, actions: [], uncalled: null, draws: [] };
    streetEvents.push(sev);

    for (let ai = 0; ai < acts.length; ai++) {
      const a = acts[ai];
      const p = a.player;
      const who = isIdx(p, n) ? names[p] : 'A player';
      if (!isIdx(p, n)) throw new HandExportError('bad-action', { name: who, action: a.action || 'action', street: stLabel(si) });
      // A fold by a player already all-in: PokerStars writes one for a player
      // sitting out who was put all-in by a blind or ante. It forfeits their
      // claim to the pot and is written where it stands, out of turn.
      if (a.action === 'fold' && t.allIn.has(p) && !t.folded.has(p)) {
        t.folded.add(p); foldedOn[p] = si;
        sev.actions.push({ p, verb: 'fold', amount: 0 });
        continue;
      }
      let nx = t.nextToAct();
      if (!nx) throw new HandExportError('out-of-turn', { name: who, street: stLabel(si) });
      if (nx.p !== p) {
        // The first betting round: seats a description skipped fold (facing a
        // bet) or check (nothing to call), in turn — quick-add's
        // insertImplicitFolds draws the same line. Later rounds: out of turn.
        if (si === 0 && t.needsToAct(p)) {
          for (const q of t.owingBefore(p)) {
            if (!t.needsToAct(q)) continue;
            // Stud's 3rd street opens with the bring-in: nobody checks before it.
            if (env.isStud && t.callAmount(q) === 0) throw new HandExportError('out-of-turn', { name: who, street: stLabel(si) });
            if (t.callAmount(q) > 0) {
              t.apply(q, 'fold', 0); foldedOn[q] = si;
              sev.actions.push({ p: q, verb: 'fold', amount: 0, implicit: true });
            } else {
              t.apply(q, 'check', 0);
              sev.actions.push({ p: q, verb: 'check', amount: 0, implicit: true });
            }
          }
          nx = t.nextToAct();
        }
        if (!nx || nx.p !== p) throw new HandExportError('out-of-turn', { name: who, street: stLabel(si) });
      }
      const ev = classify(t, env, a, p, si, ai, who, stLabel(si));
      if (ev.verb === 'fold') foldedOn[p] = si;
      if (ev.amount > 0) { total[p] += ev.amount; beyondAnte[p] += ev.amount; }
      sev.actions.push(ev);
    }

    // ── The street closes ──
    const over = t.live().length <= 1;
    if (!over && t.nextToAct()) throw new HandExportError('unfinished', { street: stLabel(si) });
    // An uncalled bet: the top contribution on the street above the second
    // highest (folded players' included) goes back.
    let top = -1, topV = -1, second = 0;
    for (let i = 0; i < n; i++) {
      const v = t.contrib[i];
      if (v > topV) { second = Math.max(second, topV); topV = v; top = i; } else if (v > second) second = v;
    }
    if (top >= 0 && topV > second) {
      const diff = topV - second;
      t.contrib[top] -= diff; t.stacks[top] += diff; t.pot -= diff;
      total[top] -= diff; beyondAnte[top] -= diff;
      if (t.stacks[top] > 0) t.allIn.delete(top);
      sev.uncalled = { p: top, amount: diff };
    }
    if (over) { handOverAt = si; break; }
  }

  const live = t.live();
  const showdown = live.length >= 2;
  if (lastStreet < 0) lastStreet = 0;

  // ── The cards the reached streets need ──
  const reachedBy = (p) => (foldedOn[p] == null ? lastStreet : foldedOn[p]);
  if (category === 'community') {
    const need = [0, 3, 4, 5][lastStreet] || 0;
    const kb = boardAll.filter(known);
    if (kb.length < need || boardAll.slice(0, need).some(c => !known(c))) {
      const missing = kb.length < 3 ? 'flop' : kb.length < 4 ? 'turn' : 'river';
      throw new HandExportError('board-missing', { street: missing });
    }
  }
  const board = category === 'community' ? boardAll.slice(0, [0, 3, 4, 5][lastStreet] || 0) : [];

  // Stud: the cards dealt face up on every street a player reached, and the
  // hero's own on every street the hero reached.
  const stud = isStud ? studCards(h, n, heroIdx, names, reachedBy, oppStr, heroCardsAt, stLabel) : null;

  // Draws: who drew what, on each draw the hand reached.
  const draw = env.isDraw ? drawsFor(h, n, heroIdx, gameType, streetEvents, foldedOn, lastStreet, oppStr, heroBase, live, showdown) : null;
  if (draw) draw.events.forEach((list, si) => { if (streetEvents[si]) streetEvents[si].draws = list; });
  // A single draw has no draw header: its first discard line is the only thing
  // that separates the two betting rounds. A hand that reached the draw with no
  // draw recorded for anyone would run them together ("calls $2" straight into
  // "bets $4"), which no reader can take.
  if (category === 'draw_single' && lastStreet >= 1 && !(draw.events[0] && draw.events[0].length)) {
    throw new HandExportError('draw-cards-unknown', { nobody: true, short: "The draw isn't recorded" });
  }

  // ── Final hands, as the text shows them ──
  const holeOf = (p) => {
    if (isStud) return stud.full[p];
    if (env.isDraw) return p === heroIdx ? draw.heroFinal : draw.oppFinal[p];
    if (p === heroIdx) return heroBase;
    const s = oppStr(p, 0);
    if (isMuck(s)) return null;
    const c = cardsOf(s);
    return c.length === cfg.heroCards && c.every(known) ? c : null;
  };
  if (env.isDraw && showdown && live.includes(heroIdx) && !(draw.heroFinal && draw.heroFinal.every(known))) {
    throw new HandExportError('draw-cards-unknown');
  }

  // No card twice among the cards the text shows: the board, the hero's, every
  // hand tabled (a draw's discards can be dealt again from a reshuffled stub,
  // so only the final hands count there).
  {
    const seen = new Set();
    const add = (arr) => { for (const c of arr || []) { if (!known(c)) continue; const k = key(c); if (seen.has(k)) throw new HandExportError('duplicate-cards', { card: k }); seen.add(k); } };
    add(board);
    if (isStud) { for (let p = 0; p < n; p++) add(stud.visible[p]); }
    else {
      add(env.isDraw ? draw.heroFinal : heroBase);
      for (let p = 0; p < n; p++) if (p !== heroIdx && showdown && live.includes(p)) add(holeOf(p));
    }
  }

  // ── Settle ──
  const allInEnd = new Set(live.filter(p => t.stacks[p] === 0));
  // Every hand tabled is evaluated once: its score settles the pot (when all of
  // them can be scored) and its description goes in the text.
  let scores = null;
  const descs = {};
  if (showdown && evalCfg) {
    const sc = {};
    let ok = ['high', 'hilo', 'low', 'badugi'].includes(evalCfg.type);
    for (const p of live) {
      const c = holeOf(p);
      const full = c && c.length >= holeCount && c.every(known);
      const evs = full ? evaluate(evalCfg, c, board) : null;
      if (evs) { descs[p] = describeEvals(evalCfg, evs); if (descs[p] && descs[p].unverified) warnings.add('description-unverified'); }
      const s = scoreOf(evs);
      if (!s) { ok = false; continue; }
      sc[p] = s;
    }
    if (ok) scores = sc;
  }
  if (showdown && !scores && legacySplit) throw new HandExportError('no-winner');
  const order = seatOrderFromButton(n, btnIdx);
  const settled = settlePot({
    n, live, contrib: total, dead, allInEnd, scores,
    winners: (h.result && h.result.winners) || [], order, unit: unitCents,
  });
  if (settled.winnersDiffer) warnings.add('winners-from-cards');
  // Chips in = chips out.
  {
    const posted = forced.reduce((s, f) => s + f.amount, 0)
      + streetEvents.reduce((s, e) => s + e.actions.reduce((x, a) => x + (a.amount || 0), 0), 0);
    const returned = streetEvents.reduce((s, e) => s + (e.uncalled ? e.uncalled.amount : 0), 0);
    if (posted !== settled.total + returned) throw new Error('hand-history: ' + posted + ' posted, ' + (settled.total + returned) + ' paid out');
  }

  // Opponent cards the text drops: folded players' (unless asked for) and a
  // winner's who was never called.
  for (let p = 0; p < n; p++) {
    if (p === heroIdx || isStud) continue;
    const s = oppStr(p, 0);
    const hasCards = cardsOf(s).some(known);
    if (!hasCards) continue;
    if (foldedOn[p] != null && !opts.showFoldedCards) warnings.add('folded-cards-dropped');
    if (foldedOn[p] == null && !showdown) warnings.add('folded-cards-dropped');
  }
  if (showdown && live.some(p => p !== heroIdx && !holeOf(p))) warnings.add('opponent-cards-unknown');

  // ── The model the text encodes ──
  const model = buildModel({
    h, gameType, names, n, heroIdx, isStud, category, env, cash, streetEvents, forced, board, lastStreet,
    live, showdown, foldedOn, holeOf, stud, draw, settled, evalCfg, opts, oppStr, imp, seatNumbers, raw,
  });

  const meta = {
    gameType, rawGameType: raw.gameType, stars, category, cfg, evalCfg, isStud, isDraw: env.isDraw,
    n, heroIdx, names, seatNumbers, btnIdx, sbIdx, bbIdx, cash, currency: raw.currency,
    sym: cash ? CURRENCIES[raw.currency].sym : '', env, board, lastStreet, handOverAt, live, showdown,
    foldedOn, beyondAnte, total, dead, stud, draw, holeOf, holeCount, studOrders, order, imp, descs, seated,
    pt4: isPt4Game(gameType), straddles: strads,
  };
  return { model, events: { forced, streets: streetEvents }, meta, settle: settled, warnings: [...warnings] };
}

const MOVES_CHIPS = new Set(['call', 'bet', 'raise', 'all-in', 'bring-in']);
function isWholeChips(h) {
  const vals = [];
  for (const p of h.players) vals.push(Number(p.startingStack));
  const b = h.blinds || {};
  for (const k of ['sb', 'bb', 'ante', 'bigBet', 'bringIn']) if (b[k] != null) vals.push(Number(b[k]));
  // Only the actions that move chips: a stray amount on a check or a fold moves
  // nothing and must not turn a whole-chip tournament into cents.
  for (const st of h.streets) for (const a of st.actions || []) if (MOVES_CHIPS.has(a.action)) vals.push(Number(a.amount) || 0);
  return vals.every(v => !Number.isFinite(v) || Number.isInteger(v));
}

/* One recorded action as PokerStars will write it, applied to the table. */
function classify(t, env, a, p, si, ai, who, street) {
  const kind = a.action;
  const stack = t.stacks[p];
  const call = t.callAmount(p);
  const before = t.contrib[p];
  const maxBet = t.maxBet;
  let amt = toCents(a.amount);
  if (!Number.isFinite(amt)) amt = 0;
  const bad = (code, action) => new HandExportError(code, { name: who, action: action || kind || 'action', street });
  if (kind === 'fold') { t.apply(p, 'fold', 0); return { p, verb: 'fold', amount: 0 }; }
  if (kind === 'check') {
    if (call > 0) throw bad('bad-action', 'check');
    t.apply(p, 'check', 0);
    return { p, verb: 'check', amount: 0 };
  }
  if (kind === 'bring-in') {
    if (!env.isStud || si !== 0 || maxBet > 0) throw bad('bad-action', 'bring-in');
    if (!(amt > 0) || amt > stack) throw bad('bad-amount', 'bring-in');
    t.apply(p, 'bring-in', amt);
    return { p, verb: 'bring-in', amount: amt, to: amt, allIn: t.stacks[p] === 0 };
  }
  if (!['call', 'bet', 'raise', 'all-in'].includes(kind)) throw bad('bad-action', kind || 'action');
  if (amt <= 0) {
    if (kind === 'call' && call === 0) { t.apply(p, 'check', 0); return { p, verb: 'check', amount: 0 }; }
    throw bad('bad-amount');
  }
  if (amt > stack + 1) throw bad('bad-amount');
  if (amt > stack) amt = stack;
  // When everyone else still in is all-in, a call is capped at the most any of
  // them has in (a big blind all-in for less leaves the bet level at the full
  // blind, but nobody has to match chips no one can contest) — PokerStars'
  // "calls 180" to a 480 all-in over a short 360 big blind.
  const others = t.live().filter(q => q !== p);
  const capped = others.length > 0 && others.every(q => t.allIn.has(q));
  const level = capped ? Math.min(maxBet, Math.max(...others.map(q => t.contrib[q]))) : maxBet;
  const owe = Math.max(0, level - before);
  const to = before + amt;
  let verb;
  if (to <= maxBet) {
    // The full call (what the replayer's entry form records) or the capped
    // one (what Stars writes) — the excess of the first comes back uncalled.
    const full = Math.min(call, stack);
    const cappedNeed = Math.min(owe, stack);
    if (Math.abs(amt - full) <= 1) amt = full;
    else if (capped && Math.abs(amt - cappedNeed) <= 1) amt = cappedNeed;
    else throw bad('bad-amount', kind === 'all-in' ? 'all-in' : 'call');
    verb = 'call';
  } else verb = maxBet === 0 ? 'bet' : 'raise';
  if (amt === 0) { t.apply(p, 'check', 0); return { p, verb: 'check', amount: 0 }; }
  t.apply(p, verb, amt);
  if (capped && verb === 'call' && t.contrib[p] < t.maxBet) t.maxBet = t.contrib[p];
  return { p, verb, amount: amt, to: before + amt, by: before + amt - maxBet, allIn: t.stacks[p] === 0 };
}

// ── Stud cards ──────────────────────────────────────────────────────────────
/* Every player's cards by street, as the replayer stores them: the hero's in
   cards.hero (3rd street down-down-door, then one a street); an opponent's up
   cards in their slot (door on 3rd, one on each of 4th to 6th), and — once a
   showdown has been entered — their hidden cards PREPENDED to 3rd street, each
   pick going in front of the last (HandReplayerView.jsx's stud showdown form,
   toggleSdCard), so 3rd street reads h3 h2 h1 door. A card on 7th street in an
   opponent's slot is their 7th-street down card. */
function studCards(h, n, heroIdx, names, reachedBy, oppStr, heroCardsAt, stLabel) {
  const up = [], down = [], full = [], visible = [], heroStreets = [];
  for (let p = 0; p < n; p++) {
    const r = reachedBy(p);
    if (p === heroIdx) {
      const per = [];
      for (let si = 0; si <= r; si++) {
        const c = heroCardsAt(si);
        const want = si === 0 ? 3 : 1;
        if (c.length < want || !c.slice(0, want).every(known)) throw new HandExportError('hero-cards-unknown');
        per.push(c.slice(0, want));
      }
      heroStreets[p] = per;
      const flat = per.flat();
      up[p] = per.slice(0, Math.min(r, 3) + 1).map((c, si) => (si === 0 ? c[2] : c[0]));
      down[p] = [flat[0], flat[1]].concat(r >= 4 ? [per[4][0]] : []);
      full[p] = r >= 4 ? [flat[0], flat[1], flat[2], flat[3], flat[4], flat[5], flat[6]] : null;
      visible[p] = flat;
      continue;
    }
    const s0 = cardsOf(isMuck(oppStr(p, 0)) ? '' : oppStr(p, 0));
    const door = s0.length ? s0[s0.length - 1] : null;
    if (!known(door)) throw new HandExportError('cards-missing', { name: names[p], street: stLabel(0) });
    const ups = [door];
    for (let si = 1; si <= Math.min(r, 3); si++) {
      const c = cardsOf(oppStr(p, si));
      if (!c.length || !known(c[0])) throw new HandExportError('cards-missing', { name: names[p], street: stLabel(si) });
      ups.push(c[0]);
    }
    up[p] = ups;
    // Down cards: 3rd street before the door holds them newest pick first.
    const hidden = s0.slice(0, -1).reverse();             // h1, h2 (, h7) in pick order
    const seventh = cardsOf(oppStr(p, 4));
    let dn = null;
    if (seventh.length) dn = hidden.length >= 2 ? [hidden[0], hidden[1], seventh[0]] : null;
    else if (hidden.length >= 3) dn = [hidden[0], hidden[1], hidden[2]];
    if (dn && !dn.every(known)) dn = null;
    down[p] = dn;
    full[p] = dn && r >= 4 && ups.length === 4 ? [dn[0], dn[1], ups[0], ups[1], ups[2], ups[3], dn[2]] : null;
    visible[p] = ups.concat(full[p] ? dn : []);
  }
  return { up, down, full, visible, heroStreets };
}

// ── Draws ───────────────────────────────────────────────────────────────────
/* The draw lines each draw the hand reached carries, in postflop order, for the
   players still in; and every player's hand after the last draw where it can be
   known. A draw is recorded on the betting round BEFORE it (the first draw on
   street 0). The hero's hand runs forward from the deal (computeDrawHand, as
   the replayer shows it); an opponent's runs backward from their showdown hand,
   as far as their discards and draws are known. */
function drawsFor(h, n, heroIdx, gameType, streetEvents, foldedOn, lastStreet, oppStr, heroBase, live, showdown) {
  const events = [];
  const postflop = seatOrder(n, false, -1);
  const reachedDraw = (si) => si < lastStreet;                     // the draw after betting round si
  const inAt = (p, si) => foldedOn[p] == null || foldedOn[p] > si;  // still in when draw si comes
  const recorded = (p, si) => ((h.streets[si] || {}).draws || []).find(d => d && d.player === p) || null;
  const parse = (s) => (typeof s === 'string' ? cardsOf(s) : []);
  const allKnown = (arr, k) => arr.length === k && arr.every(known);

  // The hero, forward. The cards kept stay in the order they were held (Stars:
  // "Dealt to Hero [5c 7s 2h] [8s]" after throwing the Ks of 5c Ks 7s 2h).
  // Where the thrown cards are not recorded, the replayer's own rule picks them
  // (computeDrawHand: thrown from the top of the sorted hand).
  let heroHand = heroBase.slice();
  const heroSteps = [];
  for (let si = 0; si < lastStreet; si++) {
    const d = recorded(heroIdx, si);
    if (!inAt(heroIdx, si) || !d) { heroSteps[si] = null; continue; }
    const before = heroHand;
    const count = Number.isInteger(d.discarded) && d.discarded > 0 ? d.discarded : 0;
    let after = before, kept = before;
    if (count) {
      const th = parse(d.discardedCards), nw = parse(d.newCards);
      const rest = before.map(key);
      if (allKnown(th, count) && th.every(c => { const i = rest.indexOf(key(c)); if (i < 0) return false; rest.splice(i, 1); return true; })) {
        const drop = th.map(key);
        kept = [];
        for (const c of before) { const i = drop.indexOf(key(c)); if (i >= 0) drop.splice(i, 1); else kept.push(c); }
      } else {
        const sim = cardsOf(computeDrawHand(cardsStr(before), { 0: { ...d, discardedCards: '', newCards: '' } }, 0, gameType));
        kept = sim.slice(0, Math.max(0, sim.length - count));   // less the face-down cards it drew
      }
      after = kept.concat(allKnown(nw, count) ? nw : Array.from({ length: count }, () => ({ rank: 'A', suit: 'x' })));
    }
    heroSteps[si] = { before, after, kept };
    heroHand = after;
  }

  // Opponents, backward from the showdown hand.
  const oppFinal = [];
  const oppSteps = [];
  for (let p = 0; p < n; p++) {
    if (p === heroIdx) continue;
    const s = oppStr(p, 0);
    const f = isMuck(s) ? [] : cardsOf(s);
    const fin = allKnown(f, heroBase.length) ? f : null;
    oppFinal[p] = fin;
    oppSteps[p] = [];
    let after = fin;
    for (let si = lastStreet - 1; si >= 0; si--) {
      const d = recorded(p, si);
      if (!inAt(p, si)) { oppSteps[p][si] = null; continue; }
      // No record of this draw: what they held before it is unknown.
      if (!d) { oppSteps[p][si] = null; after = null; continue; }
      const count = Number.isInteger(d.discarded) ? d.discarded : 0;
      const nw = parse(d.newCards), th = parse(d.discardedCards);
      const newKnown = count > 0 && allKnown(nw, count);
      const thrownKnown = count > 0 && allKnown(th, count);
      oppSteps[p][si] = { after, newKnown, thrownKnown, nw, th };
      if (!after) continue;
      if (count === 0) continue;
      if (!newKnown || !thrownKnown) { after = null; continue; }
      const keys = after.map(key);
      if (!nw.every(c => keys.includes(key(c)))) { after = null; continue; }
      const rest = after.filter(c => !nw.some(x => key(x) === key(c)));
      after = rest.concat(th);
    }
  }

  for (let si = 0; si < lastStreet; si++) {
    const list = [];
    if (reachedDraw(si)) {
      for (const p of postflop) {
        if (!inAt(p, si)) continue;
        const d = recorded(p, si);
        if (!d) continue;
        const count = Number.isInteger(d.discarded) && d.discarded > 0 ? d.discarded : 0;
        const ev = { p, discarded: count, discardedCards: null, newCards: null, kept: null, pat: null };
        if (p === heroIdx) {
          const step = heroSteps[si];
          const th = parse(d.discardedCards), nw = parse(d.newCards);
          if (count === 0) ev.pat = step ? step.before : heroHand;
          else {
            if (allKnown(th, count)) ev.discardedCards = th;
            if (allKnown(nw, count) && step) { ev.newCards = nw; ev.kept = step.kept; }
          }
        } else {
          const step = oppSteps[p][si];
          if (count > 0 && step) {
            if (step.thrownKnown) ev.discardedCards = step.th;
            if (step.after && step.newKnown) {
              const newKeys = step.nw.map(key);
              const kept = step.after.filter(c => !newKeys.includes(key(c)));
              if (kept.length === step.after.length - count) { ev.newCards = step.nw; ev.kept = kept; }
            }
          }
        }
        list.push(ev);
      }
    }
    events[si] = list;
  }
  return { events, heroFinal: heroHand, oppFinal };
}

// ── The model ──────────────────────────────────────────────────────────────
function buildModel(x) {
  const { h, gameType, names, n, heroIdx, isStud, category, env, cash, streetEvents, board, lastStreet, live, showdown, foldedOn, holeOf, stud, draw, settled, evalCfg, opts, raw } = x;
  const def = streetDef(gameType);
  const evBySi = {};
  for (const e of streetEvents) evBySi[e.si] = e;
  const blinds = { ...(raw.blinds || {}) };
  const out = {
    gameType,
    gameMode: cash ? 'cash' : 'mtt',
    ...(cash ? { currency: raw.currency } : {}),
    blinds,
    players: h.players.map((p, i) => ({ name: names[i], position: p.position, startingStack: Number(p.startingStack) })),
    heroIdx,
    streets: [],
    result: null,
  };
  const boardSplit = [[], board.slice(0, 3), board.slice(3, 4), board.slice(4, 5)];
  for (let si = 0; si < def.streets.length; si++) {
    const e = evBySi[si];
    const opponents = new Array(Math.max(0, n - 1)).fill('');
    let hero = '';
    if (isStud) {
      const hs = stud.heroStreets[heroIdx];
      hero = hs && hs[si] ? cardsStr(hs[si]) : '';
      for (let p = 0; p < n; p++) {
        if (p === heroIdx) continue;
        const ups = stud.up[p] || [];
        let s = '';
        if (si === 0) {
          const showsFull = showdown && live.includes(p) && stud.full[p];
          s = (showsFull ? cardsStr([stud.down[p][2], stud.down[p][1], stud.down[p][0]]) : '') + (ups[0] ? key(ups[0]) : '');
        } else if (si <= 3 && ups[si]) s = key(ups[si]);
        opponents[oppSlot(p, heroIdx)] = s;
      }
    } else if (si === 0) {
      hero = cardsStr(cardsOf((h.streets[0].cards || {}).hero));
      for (let p = 0; p < n; p++) {
        if (p === heroIdx) continue;
        let s = '';
        if (showdown && live.includes(p)) {
          const c = holeOf(p);
          if (c) s = cardsStr(c);
          else s = settled.won[p] ? '' : 'MUCK';
        } else if (foldedOn[p] != null && opts.showFoldedCards) {
          const c = cardsOf((h.streets[0].cards.opponents || [])[oppSlot(p, heroIdx)]);
          if (c.length && c.every(known)) s = cardsStr(c);
        }
        opponents[oppSlot(p, heroIdx)] = s;
      }
    }
    const actions = e ? e.actions.map(a => ({ player: a.p, action: a.allIn ? 'all-in' : a.verb, amount: a.amount / 100 })) : [];
    const draws = draw && draw.events[si] ? draw.events[si].map(d => {
      const o = { player: d.p, discarded: d.discarded };
      if (d.discardedCards) o.discardedCards = cardsStr(d.discardedCards);
      if (d.newCards) o.newCards = cardsStr(d.newCards);
      return o;
    }) : [];
    out.streets.push({
      name: def.streets[si],
      cards: { hero, opponents, board: category === 'community' ? cardsStr(boardSplit[si] || []) : '' },
      actions,
      draws,
    });
  }
  // The stud and draw opponents' showdown hands, where the text shows them.
  if (draw) {
    for (let p = 0; p < n; p++) {
      if (p === heroIdx) continue;
      let s = '';
      if (showdown && live.includes(p)) s = draw.oppFinal[p] ? cardsStr(draw.oppFinal[p]) : (settled.won[p] ? '' : 'MUCK');
      out.streets[0].cards.opponents[oppSlot(p, heroIdx)] = s;
    }
  }
  const winners = Object.keys(settled.won).map(Number).sort((a, b) => a - b);
  const halves = {};
  for (const l of settled.lines) { if (!halves[l.p]) halves[l.p] = { hi: false, lo: false }; if (l.half === 'hi') halves[l.p].hi = true; if (l.half === 'lo') halves[l.p].lo = true; }
  out.result = {
    winners: winners.map(p => {
      const w = { playerIdx: p, split: winners.length > 1 };
      if (evalCfg && evalCfg.type === 'hilo' && settled.lines.some(l => l.half)) { w.hi = halves[p].hi; w.lo = halves[p].lo; }
      return w;
    }),
  };
  return out;
}

export { cardText };
