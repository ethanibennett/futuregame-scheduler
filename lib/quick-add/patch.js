// Quick-add: applying an answer to a hand — validated path operations, and a
// deterministic fast path for answers that need no model at all ("50k", "AhKd").
'use strict';

const { parseCards, parseAmount, cleanText, isInt } = require('./cards');
const { canonicalAction } = require('./normalize');

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/* Every path an answer may touch, and what kind of value it takes. Anything else
   is refused: the model edits fields, never structure it was not asked about. */
const RULES = [
  [/^(gameType|gameMode|currency|title)$/, 'string'],
  [/^heroIdx$/, 'heroIdx'],
  [/^(tableSize|othersFolded)$/, 'quickAdd'],
  [/^blinds\.(sb|bb|ante|bigBet|bringIn)$/, 'amount'],
  [/^players\.(\d+)\.(name|position)$/, 'playerString'],
  [/^players\.(\d+)\.(startingStack|startingStackBB)$/, 'playerAmount'],
  [/^streets\.(\d+)\.cards\.(hero|board)$/, 'cards'],
  [/^streets\.(\d+)\.cards\.opponents\.(\d+)$/, 'cards'],
  [/^streets\.(\d+)\.cards\.player\.(\d+)$/, 'playerCards'],
  [/^streets\.(\d+)\.actions\.(\d+)$/, 'action'],
  [/^streets\.(\d+)\.actions\.(\d+)\.(player|action|amount|toAmount|toAmountBB|potFraction)$/, 'actionField'],
  [/^streets\.(\d+)\.draws\.(\d+)$/, 'draw'],
  [/^streets\.(\d+)\.draws\.(\d+)\.(player|discarded|discardedCards|newCards)$/, 'drawField'],
  [/^result$/, 'result'],
];
function ruleFor(path) {
  if (typeof path !== 'string' || path.length > 80) return null;
  for (const [re, kind] of RULES) {
    const m = re.exec(path);
    if (m) return { kind, m };
  }
  return null;
}

const NUM_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, 'heads up': 2, hu: 2, 'full ring': 9 };
function readTableSize(v) {
  if (isInt(v)) return v >= 2 && v <= 10 ? v : null;
  const s = String(v == null ? '' : v).toLowerCase().trim();
  const m = /^(\d{1,2})(?:\s*-?\s*(?:handed|max|players?|way))?$/.exec(s);
  if (m) { const n = Number(m[1]); return n >= 2 && n <= 10 ? n : null; }
  const w = s.replace(/[\s-]*(handed|max|players?)$/, '').trim();
  return NUM_WORDS[w] || null;
}

function cardString(v) {
  if (v === '' || v == null) return '';
  const pc = parseCards(v);
  return pc ? pc.cards.join('') : null;
}
function readActionObject(v) {
  if (!isObj(v)) return null;
  const action = canonicalAction(v.action);
  if (!action || !isInt(v.player) || v.player < 0) return null;
  const a = { player: v.player, action, amount: parseAmount(v.amount) };
  for (const k of ['toAmount', 'toAmountBB', 'potFraction']) {
    const n = parseAmount(v[k]);
    if (n != null) { a[k] = n; a.amount = null; }
  }
  if (action === 'fold' || action === 'check') a.amount = 0;
  return a;
}
function readDrawObject(v) {
  if (!isObj(v) || !isInt(v.player) || v.player < 0) return null;
  const dc = cardString(v.discardedCards), nc = cardString(v.newCards);
  if (dc == null || nc == null) return null;
  const discarded = v.discarded == null ? null : (isInt(v.discarded) && v.discarded >= 0 && v.discarded <= 7 ? v.discarded : NaN);
  if (Number.isNaN(discarded)) return null;
  return { player: v.player, discarded, discardedCards: dc, newCards: nc };
}

/* cards.hero and cards.opponents[] are slots relative to the hero (opponents skips
   the hero's seat), so naming a different hero moves every card string to the slot
   its player now has. Without a hero the normaliser lays slots out as if seat 0 were
   the hero, and so does this. */
function reslotCards(h, oldHero, newHero) {
  const n = Array.isArray(h.players) ? h.players.length : 0;
  if (oldHero === newHero || !n) return;
  for (const st of Array.isArray(h.streets) ? h.streets : []) {
    if (!isObj(st) || !isObj(st.cards)) continue;
    const opp = Array.isArray(st.cards.opponents) ? st.cards.opponents : [];
    const bySeat = Array.from({ length: n }, (_, i) => (i === oldHero ? st.cards.hero : opp[i < oldHero ? i : i - 1]) || '');
    st.cards.hero = bySeat[newHero];
    st.cards.opponents = bySeat.filter((_, i) => i !== newHero);
  }
}

/* Applies ops to a copy of the hand. Returns { hand, applied, rejected }. Values are
   checked here for type and shape; the normaliser then checks them against the game
   (card counts, positions that exist, sizes that add up). */
function applyOps(hand, ops) {
  const h = JSON.parse(JSON.stringify(hand));
  let applied = 0;
  const rejected = [];
  for (const raw of Array.isArray(ops) ? ops.slice(0, 12) : []) {
    const op = isObj(raw) ? raw : {};
    const kind = op.op || 'set';
    const r = ruleFor(op.path);
    if (!r || !['set', 'insert', 'remove'].includes(kind) || !applyOne(h, kind, r, op.value)) {
      rejected.push(typeof op.path === 'string' ? op.path.slice(0, 80) : '?');
      continue;
    }
    applied++;
  }
  return { hand: h, applied, rejected };
}

function applyOne(h, kind, { kind: rk, m }, value) {
  const streetOf = (s) => (Array.isArray(h.streets) && isObj(h.streets[Number(s)]) ? h.streets[Number(s)] : null);
  const players = Array.isArray(h.players) ? h.players : [];
  const arrayOp = (arr, idx, item) => {
    const i = Number(idx);
    if (kind === 'remove') { if (i >= arr.length) return false; arr.splice(i, 1); return true; }
    if (item == null) return false;
    if (kind === 'insert') { if (i > arr.length) return false; arr.splice(i, 0, item); return true; }
    if (i > arr.length) return false;
    arr[i] = item; return true;
  };
  if (kind !== 'set' && !['action', 'draw', 'result'].includes(rk)) return false;

  switch (rk) {
    case 'string': {
      const v = cleanText(value, 80);
      if (value != null && v == null) return false;
      h[m[1]] = v; return true;
    }
    case 'heroIdx':
      if (value !== null && !(isInt(value) && value >= 0 && value < players.length)) return false;
      reslotCards(h, isInt(h.heroIdx) ? h.heroIdx : 0, value != null ? value : 0);
      h.heroIdx = value; return true;
    case 'quickAdd': {
      const qa = isObj(h.quickAdd) ? { ...h.quickAdd } : {};
      if (m[1] === 'tableSize') {
        const n = readTableSize(value);
        if (n == null) return false;
        qa.tableSize = n;
      } else {
        if (typeof value !== 'boolean') return false;
        qa.othersFolded = value;
      }
      h.quickAdd = qa; return true;
    }
    case 'amount': {
      const v = parseAmount(value);
      if (value != null && v == null) return false;
      h.blinds = isObj(h.blinds) ? h.blinds : {};
      h.blinds[m[1]] = v; return true;
    }
    case 'playerString':
    case 'playerAmount': {
      const p = players[Number(m[1])];
      if (!isObj(p)) return false;
      if (rk === 'playerString') {
        const v = cleanText(value, 40);
        if (value != null && v == null) return false;
        p[m[2]] = v;
      } else {
        const v = parseAmount(value);
        if (value != null && v == null) return false;
        p[m[2]] = v;
        if (m[2] === 'startingStackBB' && v != null) p.startingStack = null; // converted by the normaliser
      }
      return true;
    }
    case 'cards':
    case 'playerCards': {
      const st = streetOf(m[1]);
      const v = cardString(value);
      if (!st || v == null) return false;
      st.cards = isObj(st.cards) ? st.cards : {};
      let slot = m[2];
      if (rk === 'playerCards') {
        const n = Number(m[2]);
        if (n >= players.length) return false;
        const hero = isInt(h.heroIdx) ? h.heroIdx : 0;
        if (n === hero) slot = 'hero';
        else { st.cards.opponents = Array.isArray(st.cards.opponents) ? st.cards.opponents : []; st.cards.opponents[n < hero ? n : n - 1] = v; return true; }
      }
      if (slot === 'hero' || slot === 'board') { st.cards[slot] = v; return true; }
      const k = Number(slot);
      if (k >= Math.max(0, players.length - 1)) return false;
      st.cards.opponents = Array.isArray(st.cards.opponents) ? st.cards.opponents : [];
      st.cards.opponents[k] = v; return true;
    }
    case 'action':
    case 'draw': {
      const st = streetOf(m[1]);
      if (!st) return false;
      const key = rk === 'action' ? 'actions' : 'draws';
      st[key] = Array.isArray(st[key]) ? st[key] : [];
      const item = kind === 'remove' ? null : (rk === 'action' ? readActionObject(value) : readDrawObject(value));
      if (item && item.player >= players.length) return false;
      return arrayOp(st[key], m[2], item);
    }
    case 'actionField':
    case 'drawField': {
      const st = streetOf(m[1]);
      const arr = st && (rk === 'actionField' ? st.actions : st.draws);
      const a = Array.isArray(arr) ? arr[Number(m[2])] : null;
      if (!isObj(a)) return false;
      const f = m[3];
      if (f === 'player') {
        if (!(isInt(value) && value >= 0 && value < players.length)) return false;
        a.player = value; return true;
      }
      if (f === 'action') {
        const act = canonicalAction(value);
        if (!act) return false;
        a.action = act;
        if (act === 'fold' || act === 'check') a.amount = 0;
        else if (a.amount === 0) a.amount = null;
        return true;
      }
      if (f === 'discardedCards' || f === 'newCards') {
        const v = cardString(value);
        if (v == null) return false;
        a[f] = v; return true;
      }
      if (f === 'discarded') {
        if (value !== null && !(isInt(value) && value >= 0 && value <= 7)) return false;
        a.discarded = value; return true;
      }
      const v = parseAmount(value);
      if (value != null && v == null) return false;
      a[f] = v;
      if (f !== 'amount' && v != null) a.amount = null; // re-derived from the new size
      return true;
    }
    case 'result': {
      if (kind === 'remove' || value == null) { h.result = null; return true; }
      if (!isObj(value) || !Array.isArray(value.winners)) return false;
      h.result = { winners: value.winners.filter(isObj).map((w) => ({ playerIdx: w.playerIdx, split: !!w.split })) };
      return true;
    }
    default: return false;
  }
}

/* Answers that need no interpretation: a number for a stack or a blind, cards for a
   card field, a count for the table size. Returns ops, or null to ask the model. */
function fastAnswerOps(hand, gap, answer) {
  const field = gap && typeof gap.field === 'string' ? gap.field : '';
  const text = String(answer || '').trim().replace(/[.!]+$/, '');
  if (!field || !text) return null;
  if (/^players\.\d+\.startingStack$/.test(field) || /^blinds\.(sb|bb|ante|bigBet|bringIn)$/.test(field)) {
    const bbm = /^(.*?)\s*(?:bb|big blinds?|bigs|blinds)(?:\s+deep)?$/i.exec(text);
    if (bbm && field.startsWith('players.')) {
      const n = parseAmount(bbm[1]);
      return n != null && n > 0 ? [{ op: 'set', path: field + 'BB', value: n }] : null;
    }
    const n = parseAmount(text);
    return n != null && (n > 0 || /ante$/.test(field)) ? [{ op: 'set', path: field, value: n }] : null;
  }
  if (/^streets\.\d+\.cards\.(hero|board|opponents\.\d+|player\.\d+)$/.test(field)) {
    const pc = parseCards(text);
    if (pc && !pc.ranksOnly && pc.cards.length && pc.cards.every((c) => c[1] !== 'x')) {
      return [{ op: 'set', path: field, value: pc.cards.join('') }];
    }
    return null;
  }
  if (field === 'tableSize') {
    const n = readTableSize(text);
    return n != null ? [{ op: 'set', path: 'tableSize', value: n }] : null;
  }
  return null;
}

module.exports = { applyOps, fastAnswerOps, ruleFor, readTableSize };
