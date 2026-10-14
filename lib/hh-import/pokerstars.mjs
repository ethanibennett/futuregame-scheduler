// ── Hand-history import: PokerStars-format text ───────────────────────────────
// Reads PokerStars hand histories (and the many sites and converters that write
// the same format) into the replayer's hand model. It round-trips the app's own
// writer (vite-app/src/utils/hand-history/): write(parse(text)) === text.
//
// Written from the format itself and the shared tables in ps-format.js. fpdb's
// PokerStarsToFpdb.py (GPL) was read as a reference for what genuine files
// contain; none of its code or test files are copied here.
//
// The replayer's model differs from the text in a few places, handled here:
//   - seats: the model's index 0 is the first to act preflop and the last three
//     are BTN, SB, BB, so the dealt-in seats are rotated to start after the BB
//     (stud keeps ascending seat order); the real seat numbers, table name and
//     size are kept in hand.import for the writer.
//   - amounts: the model holds the chips ADDED by each action ("raises 4 to 6"
//     after a posted 2 is 4 added).
//   - per-player antes in a flop game (pre-2018 Stars tournaments): the model
//     only has a big-blind ante, so they become one of the same total, each
//     player's stack moved so the chips behind are exact at the first action.
//   - stud showdown cards go back into the replayer's layout (hidden cards in
//     front of the door card on 3rd street, newest first).

import {
  HEADER_TO_GAME, UNSUPPORTED_FEATURE_GAMES, CURRENCIES, CURRENCY_SYMBOLS,
  parseMoney, fromCents, fromRoman, parseET, splitCards, sortedJSON,
} from '../../vite-app/src/utils/hand-history/ps-format.js';
import { prepareHand } from '../../vite-app/src/utils/hand-history/prepare.js';
import { HandExportError } from '../../vite-app/src/utils/hand-history/errors.js';
import { gameConfig, gameCategory, streetDef, positionLabels, studPositionLabels } from '../../vite-app/src/utils/quick-add/game.js';
import { straddles as priceStraddles } from '../../vite-app/src/utils/quick-add/betting.js';
import { HandHistoryError } from './errors.mjs';

const DETECT_RE = /^\s*([A-Za-z][\w .'-]*?) (?:Zoom |Rush |Home Game )?(?:Hand|Game) #(\d+):\s/;
const HEADER_RE = /^([A-Za-z][\w .'-]*?) (?:(Zoom|Rush) )?(?:(Home Game) )?(?:Hand|Game) #(\d+):\s+(.*)$/;

const GAME_WORDS = [
  '6 Card Omaha Hi/Lo', '5 Card Omaha Hi/Lo', 'Triple Draw 2-7 Lowball', 'Single Draw 2-7 Lowball',
  '7 Card Stud Hi/Lo', 'Courchevel Hi/Lo', 'Omaha Hi/Lo', '6 Card Omaha', '5 Card Omaha', 'Omaha 5 Cards',
  'Omaha 6 Cards', 'Courchevel', '7 Card Stud', '5 Card Draw', "Split Hold'em", "6+ Hold'em", "Hold'em",
  'Omaha', 'Razz', 'Badugi',
].map(s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
const LIMIT_WORDS = 'No Limit|Pot Limit|Fixed Limit|Limit|Pot Limit Pre-Flop, No Limit Post-Flop';
const MIX_WORDS = "HORSE|8-Game|HOSE|Mixed NLH/PLO|Mixed PLH/PLO|Mixed Omaha H/L|Mixed Hold'em|Mixed Omaha|Triple Stud";
const GAME_TAIL_RE = new RegExp(`^(.*?)\\s*(?:(${MIX_WORDS.replace(/\//g, '\\/')})\\s+\\()?(${GAME_WORDS.join('|')}) (${LIMIT_WORDS})\\)?$`);
const SYM_TO_ISO = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'CNY' };
const MONEY = '(?:Rs\\. )?[$€£¥₹]?[\\d.,]+';

const ok = (s) => typeof s === 'string';
const stripBom = (s) => s.replace(/^﻿/, '');

// ── Detection and splitting ──────────────────────────────────────────────────
export function detect(text) {
  if (!ok(text)) return false;
  const lines = stripBom(text).split(/\r\n|\r|\n/);
  const first = lines.find(l => l.trim() !== '');
  return !!first && DETECT_RE.test(stripBom(first)) && text.includes('*** SUMMARY ***');
}

/* Each hand's lines: a hand starts at a header line; blank lines are dropped. */
export function splitHands(text) {
  const lines = stripBom(String(text)).split(/\r\n|\r|\n/).map(l => stripBom(l).replace(/\s+$/, ''));
  const hands = [];
  let cur = null;
  for (const l of lines) {
    if (HEADER_RE.test(l) && DETECT_RE.test(l)) { cur = [l]; hands.push(cur); continue; }
    if (!cur || l.trim() === '') continue;
    cur.push(l);
  }
  return hands;
}

// ── Header ───────────────────────────────────────────────────────────────────
function parseHeader(line) {
  const m = HEADER_RE.exec(line);
  if (!m) throw new HandHistoryError('malformed', 'Not a PokerStars header line', line);
  const [, siteName, zoom, home, handId, restRaw] = m;
  let rest = restRaw.replace(/^\{[^}]*\}\s+/, '');
  const out = { siteName, zoom: !!zoom, home: !!home, handId };
  // The time: the ET one wins (non-US accounts write local time first, ET in brackets).
  // (2007 files: "2007/10/15 - 05:34:03 (ET)".)
  const etAll = [...rest.matchAll(/(\d{4}\/\d{2}\/\d{2})(?: - | )(\d{1,2}:\d{2}(?::\d{2})?) \(?ET\)?/g)];
  const lastEt = etAll[etAll.length - 1];
  out.playedAt = lastEt ? parseET(lastEt[1] + ' ' + lastEt[2]) : null;
  const tour = /^(?:(?:Zoom|Rush) )?Tournament #(\d+), (.+?) - (?:Match Round [IVXLC]+, )?Level ([IVXLC\d]*) ?\(([^)]*)\)(?: \[[^\]]*\])? - (.+)$/.exec(rest);
  if (tour) {
    out.tournament = true;
    out.tournamentId = tour[1];
    out.level = tour[3] ? fromRoman(tour[3]) : null;
    const g = GAME_TAIL_RE.exec(tour[2].trim());
    if (!g) throw new HandHistoryError('unsupported-game', 'A game this format reader does not know', tour[2]);
    out.buyIn = g[1].trim() || 'Freeroll';
    out.mix = g[2] || null;
    out.game = g[3]; out.limit = g[4];
    const st = /^([\d.,]+)\/([\d.,]+)$/.exec(tour[4].trim());
    if (!st) throw new HandHistoryError('malformed', 'Unreadable tournament stakes', tour[4]);
    out.a = parseMoney(st[1]); out.b = parseMoney(st[2]);
    return out;
  }
  const cash = new RegExp(`^(?:(${MIX_WORDS}) \\()?(${GAME_WORDS.join('|')}) (${LIMIT_WORDS})\\)? \\(([^)]*)\\) - (.+)$`).exec(rest)
    // A mixed cash game: "8-Game (7 Card Stud Hi/Lo Limit, $400/$800 USD)".
    || new RegExp(`^(${MIX_WORDS}) \\((${GAME_WORDS.join('|')}) (${LIMIT_WORDS}), ([^)]*)\\) - (.+)$`).exec(rest);
  if (!cash) {
    if (/Tournament #/.test(rest)) throw new HandHistoryError('malformed', 'Unreadable tournament header', line);
    throw new HandHistoryError('unsupported-game', 'A game this format reader does not know', rest);
  }
  out.tournament = false;
  out.mix = cash[1] || null;
  out.game = cash[2]; out.limit = cash[3];
  const stakes = cash[4].trim();
  if (/Button Blind/.test(stakes)) throw new HandHistoryError('unsupported-feature', 'Button-blind games', stakes);
  if (/Cap/.test(stakes)) throw new HandHistoryError('unsupported-feature', 'Capped cash games', stakes);
  const st = /^((?:Rs\. )?[^\d\s/]?)([\d.,]+)\/((?:Rs\. )?[^\d\s/]?)([\d.,]+)(?:\s+([A-Z]{3}))?$/.exec(stakes);
  if (!st) throw new HandHistoryError('malformed', 'Unreadable stakes', stakes);
  if (st[1] && !SYM_TO_ISO[st[1]] && !(st[5] && CURRENCIES[st[5]])) {
    throw new HandHistoryError('unsupported-currency', 'Cash games in ' + (st[5] || st[1].trim()) + ' have no app currency', stakes);
  }
  out.a = parseMoney(st[2]); out.b = parseMoney(st[4]);
  out.currency = st[5] || SYM_TO_ISO[st[1]] || null;
  if (!out.currency || !CURRENCIES[out.currency]) throw new HandHistoryError('unsupported-currency', 'Cash games in ' + (out.currency || 'play money') + ' have no app currency', stakes);
  return out;
}

function gameFromHeader(hd) {
  const words = hd.game + ' ' + (hd.limit === 'Fixed Limit' ? 'Limit' : hd.limit);
  if (UNSUPPORTED_FEATURE_GAMES.some(re => re.test(words))) throw new HandHistoryError('unsupported-feature', words + ' is not a game the replayer holds', words);
  let gt = HEADER_TO_GAME[words];
  if (!gt && hd.game === 'Omaha 5 Cards') gt = HEADER_TO_GAME['5 Card Omaha ' + hd.limit];
  if (!gt && hd.game === 'Omaha 6 Cards') gt = HEADER_TO_GAME['6 Card Omaha ' + hd.limit];
  if (!gt) throw new HandHistoryError('unsupported-game', 'PokerStars ' + words + ' has no replayer game', words);
  return gt;
}

// ── One hand ─────────────────────────────────────────────────────────────────
const IGNORED = [
  / said, "/, / joins the table at seat #\d+/, / leaves the table/, / has returned$/, / is (dis)?connected$/,
  / has timed out( while (dis)?connected| while being disconnected)?$/, / is sitting out$/, / sits out$/,
  / was removed from the table/, / will be allowed to play after the button$/, /^Betting is capped$/,
  / finished the tournament/, / wins the tournament/, / wins the .* bounty/, / wins .* for (splitting the elimination of|eliminating)/,
  / re-buys and receives/, / takes the add-on/, / split the .* bounty/, /^No low hand qualified$/,
  /^The deck is reshuffled$/, /^Pair on board - a double bet is allowed$/,
];
const IGNORED_VERBS = [/^is sitting out$/, /^sits out$/, /^doesn't show hand$/, /^is disconnected$/, /^is connected$/, /^has timed out$/];

export function parseHand(lines) {
  const hd = parseHeader(lines[0]);
  const gameType = gameFromHeader(hd);
  const cfg = gameConfig(gameType);
  const category = gameCategory(gameType);
  const isStud = !!cfg.isStud;
  const isDraw = category === 'draw_triple' || category === 'draw_single';
  const fl = cfg.betting === 'fl' || isStud;
  const notes = [];

  // ── Table and seats ──
  const tl = /^Table '(.+?)'(?:\(\d+\))?\s+(?:(\d+)-[Mm]ax\s*)?(?:\((?:Play|Real) Money\)\s*)?(?:Seat #(\d+) is the button)?\s*$/.exec(lines[1] || '');
  if (!tl) throw new HandHistoryError('malformed', 'No table line', lines[1] || '');
  const tableName = tl[1];
  const maxSeats = tl[2] ? Number(tl[2]) : null;
  const buttonSeat = tl[3] ? Number(tl[3]) : null;
  let li = 2;
  const seats = [];
  for (; li < lines.length; li++) {
    const m = /^Seat (\d+): (.+) \((?:Rs\. )?[$€£¥₹]?([\d.,]+) in chips(?:, [^)]*)?\)(.*)$/.exec(lines[li]);
    if (!m) break;
    seats.push({ seat: Number(m[1]), name: m[2], stack: parseMoney(m[3]), tail: m[4].trim() });
  }
  if (!seats.length) throw new HandHistoryError('malformed', 'No seats', lines[2] || '');
  const names = seats.map(s => s.name).sort((a, b) => b.length - a.length);
  const who = (line) => names.find(nm => line.startsWith(nm + ': ') || line.startsWith(nm + ' ') || line === nm + ':') || null;
  const bySeatName = new Map(seats.map(s => [s.name, s]));

  // ── Sections ──
  const sections = [];   // [{ head, lines }]
  let cur = { head: 'pre', lines: [] };
  sections.push(cur);
  for (; li < lines.length; li++) {
    const l = lines[li];
    const h = /^\*\*\* (.+?) \*\*\*(.*)$/.exec(l);
    if (h) { cur = { head: h[1], rest: h[2].trim(), lines: [] }; sections.push(cur); continue; }
    cur.lines.push(l);
  }
  const heads = sections.map(s => s.head);
  if (heads.some(x => /^(FIRST|SECOND) (FLOP|TURN|RIVER|SHOW DOWN)$/.test(x))) throw new HandHistoryError('unsupported-feature', 'Run it twice', 'FIRST/SECOND board');
  if (!heads.includes('SUMMARY')) throw new HandHistoryError('malformed', 'No summary', lines[0]);
  if (lines.some(l => /^Hand cancelled/.test(l))) throw new HandHistoryError('unsupported-feature', 'Hand cancelled', 'Hand cancelled');
  if (lines.some(l => / cashed out the hand/.test(l))) throw new HandHistoryError('unsupported-feature', 'Cash out', 'cashed out the hand');

  // ── Summary: who was dealt in, the pot, shown and mucked cards ──
  const summary = sections.find(s => s.head === 'SUMMARY');
  let totalPot = null, rake = 0;
  const summarySeats = new Map();  // seat -> line rest
  for (const l of summary.lines) {
    const tp = new RegExp(`^Total pot (${MONEY})`).exec(l);
    if (tp) {
      totalPot = parseMoney(tp[1]);
      const rk = new RegExp(`Rake (${MONEY})`).exec(l);
      rake = rk ? parseMoney(rk[1]) : 0;
      continue;
    }
    const sl = /^Seat (\d+): (.*)$/.exec(l);
    if (sl) summarySeats.set(Number(sl[1]), sl[2]);
  }
  if (totalPot == null) throw new HandHistoryError('malformed', 'No total pot line', 'SUMMARY');
  const dealt = seats.filter(s => summarySeats.has(s.seat)).sort((a, b) => a.seat - b.seat);
  const n = dealt.length;
  if (n < 2) throw new HandHistoryError('seating', 'Fewer than two players dealt in', lines[1]);

  // ── Forced bets ──
  const pre = sections[0].lines;
  const posts = [];
  for (const l of pre) {
    const name = who(l);
    if (IGNORED.some(re => re.test(l))) continue;
    if (!name) continue;
    const rest = l.slice(name.length);
    if (!rest.startsWith(': ')) continue;
    const verb = rest.slice(2);
    if (IGNORED_VERBS.some(re => re.test(verb))) continue;
    let m;
    if ((m = new RegExp(`^posts the ante (${MONEY})( and is all-in)?$`).exec(verb))) posts.push({ kind: 'ante', name, amount: parseMoney(m[1]), allIn: !!m[2] });
    else if ((m = new RegExp(`^posts small blind (${MONEY})( and is all-in)?$`).exec(verb))) posts.push({ kind: 'sb', name, amount: parseMoney(m[1]), allIn: !!m[2] });
    else if ((m = new RegExp(`^posts big blind (${MONEY})( and is all-in)?$`).exec(verb))) posts.push({ kind: 'bb', name, amount: parseMoney(m[1]), allIn: !!m[2] });
    else if ((m = new RegExp(`^posts straddle (${MONEY})( and is all-in)?$`).exec(verb))) posts.push({ kind: 'straddle', name, amount: parseMoney(m[1]), allIn: !!m[2] });
    else if (/^posts small & big blinds/.test(verb)) throw new HandHistoryError('unsupported-feature', 'A dead small and big blind posted together', l);
    else if (/^posts button blind/.test(verb)) throw new HandHistoryError('unsupported-feature', 'Button blind', l);
    else throw new HandHistoryError('malformed', 'An unknown line before the deal', l);
  }

  // ── Seat order ──
  let order;   // model index -> dealt entry
  if (isStud) order = dealt.slice();
  else {
    const sbs = posts.filter(p => p.kind === 'sb'), bbs = posts.filter(p => p.kind === 'bb');
    if (bbs.length > 1) throw new HandHistoryError('unsupported-feature', 'More than one big blind posted', bbs.map(b => b.name).join(', '));
    if (sbs.length > 1) throw new HandHistoryError('unsupported-feature', 'More than one small blind posted', sbs.map(b => b.name).join(', '));
    const pos = (name) => dealt.findIndex(d => d.name === name);
    let btn = buttonSeat != null ? dealt.findIndex(d => d.seat === buttonSeat) : -1;
    if (btn < 0 && sbs.length) btn = n === 2 ? pos(sbs[0].name) : (pos(sbs[0].name) - 1 + n) % n;
    if (btn < 0) throw new HandHistoryError('seating', 'No button', lines[1]);
    const sbAt = n === 2 ? btn : (btn + 1) % n;
    const bbAt = (sbAt + 1) % n;
    if (sbs.length && pos(sbs[0].name) !== sbAt) throw new HandHistoryError('seating', 'The small blind is not the seat after the button', sbs[0].name);
    if (!bbs.length) throw new HandHistoryError('unsupported-feature', 'No big blind posted', lines[0]);
    if (pos(bbs[0].name) !== bbAt) throw new HandHistoryError('seating', 'The big blind is not the seat after the small blind', bbs[0].name);
    order = [];
    for (let k = 1; k <= n; k++) order.push(dealt[(bbAt + k) % n]);
  }
  const idxOf = new Map(order.map((d, i) => [d.name, i]));
  const labels = isStud ? studPositionLabels(n) : positionLabels(n);
  const heroName = findHero(sections, isStud, isDraw, names);
  const heroIdx = heroName != null && idxOf.has(heroName) ? idxOf.get(heroName) : null;
  if (heroIdx == null) notes.push('No hero: no "Dealt to" line names a player dealt in.');
  const hero = heroIdx == null ? 0 : heroIdx;
  const slot = (pi) => (pi < hero ? pi : pi - 1);
  const ix = (name) => (idxOf.has(name) ? idxOf.get(name) : -1);

  // ── The model ──
  const def = streetDef(gameType);
  const streets = def.streets.map(name => ({ name, cards: { hero: '', opponents: new Array(n - 1).fill(''), board: '' }, actions: [], draws: [] }));
  const players = order.map((d, i) => ({ name: d.name, position: labels[i], startingStack: d.stack }));
  const blinds = {};
  const C = (c) => fromCents(c);
  if (fl) { blinds.bb = C(hd.a); blinds.bigBet = C(hd.b); } else { blinds.sb = C(hd.a); blinds.bb = C(hd.b); }

  // Antes.
  const antes = posts.filter(p => p.kind === 'ante');
  if (antes.length) {
    if (isStud) blinds.ante = C(Math.max(...antes.map(a => a.amount)));
    else {
      const bbName = order[n - 1].name;
      if (antes.length === 1 && antes[0].name === bbName) blinds.ante = C(antes[0].amount);
      else {
        // Per-player antes: one big-blind ante of the same total, stacks moved
        // so every player's chips behind are exact at the first action.
        if (antes.some(a => a.allIn)) throw new HandHistoryError('unsupported-feature', 'A player all-in on a per-player ante', antes.find(a => a.allIn).name);
        const sum = antes.reduce((s, a) => s + a.amount, 0);
        const own = antes.find(a => a.name === bbName);
        for (const a of antes) { const i = ix(a.name); if (i >= 0 && i !== n - 1) players[i].startingStack -= a.amount; }
        players[n - 1].startingStack += sum - (own ? own.amount : 0);
        blinds.ante = C(sum);
        notes.push('Per-player antes of ' + antes.map(a => a.amount / 100).join('/') + ' became one big-blind ante of ' + sum / 100 + '.');
      }
    }
  }
  /* The order of ante and blind shows only when the big blind could not cover both: Stars takes the
     ante out of the stack first and the blind gets what is left ("posts the ante 40", then "posts big
     blind 160 and is all-in" on a 200 stack). The replayer's own order is the blind first, so the
     hand is marked, and the writer replays it Stars' way. A whole blind reads the same either way. */
  const bbPost = posts.find(p => p.kind === 'bb');
  const anteFirst = !isStud && antes.length > 0 && !!bbPost && bbPost.allIn && bbPost.amount < (fl ? hd.a : hd.b);
  if (!isStud) {
    const sbp = posts.find(p => p.kind === 'sb');
    if (fl) blinds.sb = sbp && !sbp.allIn ? C(sbp.amount) : C(Math.floor(hd.a / 2));
    else if (sbp && sbp.amount !== hd.a && !sbp.allIn) blinds.sb = C(sbp.amount);
    if (!sbp) blinds.sb = 0;
  }
  // Straddles: flags by seat, priced bb*2^k in seat order (betting.js).
  const strads = posts.filter(p => p.kind === 'straddle');
  if (strads.length) {
    let other = 0;
    for (const s of strads) {
      const i = ix(s.name);
      if (i < 0 || n < 4) throw new HandHistoryError('unsupported-feature', 'A straddle the replayer cannot seat', s.name);
      if (i === 0) blinds.straddle_utg = true;
      else if (i === n - 3) blinds.straddle_button = true;
      else {
        const type = other++ === 0 ? 'mississippi' : 'rock';
        if (other > 2) throw new HandHistoryError('unsupported-feature', 'More straddles than the replayer holds', s.name);
        blinds['straddle_' + type] = true;
        blinds.straddleSeats = { ...(blinds.straddleSeats || {}), [type]: i };
      }
    }
    blinds.straddle = true;
    const priced = priceStraddles(players, { ...blinds, bb: fl ? hd.a : hd.b });
    for (const s of strads) {
      const want = priced.find(x => x.seat === ix(s.name));
      if (!want || (want.amount !== s.amount && !s.allIn)) throw new HandHistoryError('unsupported-feature', 'A straddle size the replayer does not price (bb x 2^k)', s.name);
    }
  }

  // Contributions per street, to turn "raises X to Y" into chips added.
  const sbIdx = isStud ? -1 : (n === 2 ? 0 : n - 2);
  const bbIdx = isStud ? -1 : n - 1;
  let contrib = new Array(n).fill(0);
  const seedStreet0 = () => {
    contrib = new Array(n).fill(0);
    for (const p of posts) {
      if (p.kind === 'ante') continue;
      const i = ix(p.name);
      if (i >= 0) contrib[i] += p.amount;
    }
  };

  // ── Streets ──
  const shows = new Map(), mucks = new Set(), collects = [], uncalled = [];
  let si = -1;
  let drawStreet = -1;   // the betting round a draw line belongs to
  const studHeads = { '3rd STREET': 0, '4th STREET': 1, '5th STREET': 2, '6th STREET': 3, 'RIVER': 4 };
  const commHeads = { 'HOLE CARDS': 0, 'FLOP': 1, 'TURN': 2, 'RIVER': 3 };
  const drawHeads = { 'DEALING HANDS': 0, 'FIRST DRAW': 1, 'SECOND DRAW': 2, 'THIRD DRAW': 3 };
  const board = [];
  for (const sec of sections.slice(1)) {
    if (sec.head === 'SUMMARY') break;
    const sd = sec.head === 'SHOW DOWN';
    if (!sd) {
      const map = isStud ? studHeads : isDraw ? drawHeads : commHeads;
      if (!(sec.head in map)) throw new HandHistoryError('malformed', 'An unknown street', '*** ' + sec.head + ' ***');
      si = map[sec.head];
      if (si >= streets.length) throw new HandHistoryError('malformed', 'A street this game does not have', '*** ' + sec.head + ' ***');
      if (si === 0) seedStreet0(); else contrib = new Array(n).fill(0);
      drawStreet = isDraw && si > 0 ? si - 1 : -1;
      if (!isStud && !isDraw && si > 0) {
        const brs = [...sec.rest.matchAll(/\[([^\]]*)\]/g)].map(x => splitCards(x[1]));
        const all = [].concat(...brs.map(b => b || []));
        const want = [0, 3, 4, 5][si];
        if (all.length !== want) throw new HandHistoryError('malformed', 'A board that does not add up', '*** ' + sec.head + ' *** ' + sec.rest);
        board.splice(0, board.length, ...all);
        streets[si].cards.board = (si === 1 ? all.slice(0, 3) : all.slice(want - 1)).join('');
      }
    }
    for (const l of sec.lines) {
      if (IGNORED.some(re => re.test(l))) continue;
      let m;
      if (l.startsWith('Dealt to ')) {
        // By the seated names: a name can hold brackets ("PC [Mittel]").
        const nm = names.find(x => l.startsWith('Dealt to ' + x + ' ['));
        if (!nm) throw new HandHistoryError('malformed', 'Cards dealt to a player not seated', l);
        const tail = l.slice(('Dealt to ' + nm).length);
        if (!/^(?: \[[^\]]*\])+$/.test(tail)) throw new HandHistoryError('malformed', 'Unreadable cards', l);
        const brs = [...tail.matchAll(/\[([^\]]*)\]/g)].map(x => splitCards(x[1]));
        if (brs.some(b => b == null)) throw new HandHistoryError('malformed', 'Unreadable cards', l);
        const i = ix(nm);
        if (i < 0) continue;
        dealtTo(streets, { isStud, isDraw, si, i, hero, slot, brs, drawStreet, l });
        continue;
      }
      if ((m = new RegExp(`^Uncalled bet \\((${MONEY})\\) returned to (.+)$`).exec(l))) { uncalled.push({ amount: parseMoney(m[1]), name: m[2] }); continue; }
      const nm = who(l);
      if (!nm) {
        if (/^\*\*\*/.test(l)) throw new HandHistoryError('malformed', 'An unknown section', l);
        throw new HandHistoryError('malformed', 'A line about no player at the table', l);
      }
      const i = ix(nm);
      const rest = l.slice(nm.length);
      if ((m = new RegExp(`^ collected (${MONEY}) from (pot|main pot|side pot(?:-(\\d+))?)$`).exec(rest))) {
        collects.push({ i, amount: parseMoney(m[1]), pot: m[2] });
        continue;
      }
      if (!rest.startsWith(': ')) {
        if (/^ (has|is|was|will|joins|leaves|sits|finished|wins|re-buys|takes)\b/.test(rest)) continue;
        throw new HandHistoryError('malformed', 'An unknown line', l);
      }
      const verb = rest.slice(2);
      if (IGNORED_VERBS.some(re => re.test(verb))) continue;
      if ((m = /^shows \[([^\]]*)\](?: \(.*\))?$/.exec(verb))) {
        // A partial show ("shows [XX Qs]") is not a hand the model can hold.
        const c = splitCards(m[1]);
        if (c && c.length && i >= 0) shows.set(i, c);
        continue;
      }
      if (/^mucks hand$/.test(verb)) { if (i >= 0) mucks.add(i); continue; }
      if (i < 0) throw new HandHistoryError('malformed', 'An action by a player not dealt in', l);
      if (si < 0) throw new HandHistoryError('malformed', 'An action before the deal', l);
      // Draws.
      if ((m = /^discards (\d+) cards?(?: \[([^\]]*)\])?$/.exec(verb)) || (m = /^stands pat(?: on \[([^\]]*)\])?$/.exec(verb))) {
        if (!isDraw) throw new HandHistoryError('malformed', 'A draw in a game without one', l);
        const pat = /^stands pat/.test(verb);
        if (category === 'draw_single' && si === 0) { drawStreet = 0; }
        if (drawStreet < 0) throw new HandHistoryError('malformed', 'A draw before the deal is bet', l);
        const d = { player: i, discarded: pat ? 0 : Number(m[1]) };
        if (!pat && m[2]) { const c = splitCards(m[2]); if (c && c.length) d.discardedCards = c.join(''); }
        streets[drawStreet].draws.push(d);
        if (category === 'draw_single' && si === 0) { si = 1; contrib = new Array(n).fill(0); }
        continue;
      }
      // Betting.
      const allIn = / and is all-in$/.test(verb);
      const v = verb.replace(/ and is all-in$/, '').replace(/ and has reached the .* cap$/, '');
      let action, added;
      if (v === 'folds' || /^folds \[[^\]]*\]$/.test(v)) { action = 'fold'; added = 0; }
      else if (v === 'checks') { action = 'check'; added = 0; }
      else if ((m = new RegExp(`^calls (${MONEY})$`).exec(v))) { action = 'call'; added = parseMoney(m[1]); }
      else if ((m = new RegExp(`^bets (${MONEY})$`).exec(v))) { action = 'bet'; added = parseMoney(m[1]); }
      else if ((m = new RegExp(`^raises (${MONEY}) to (${MONEY})$`).exec(v))) { action = 'raise'; added = parseMoney(m[2]) - contrib[i]; }
      else if ((m = new RegExp(`^brings[- ]in(?: low)? for (${MONEY})$`).exec(v))) { action = 'bring-in'; added = parseMoney(m[1]); }
      else throw new HandHistoryError('malformed', 'An unknown action', l);
      if (!Number.isFinite(added) || added < 0) throw new HandHistoryError('malformed', 'An amount that does not add up', l);
      contrib[i] += added;
      if (action === 'bring-in' && blinds.bringIn == null) blinds.bringIn = C(added);
      streets[si].actions.push({ player: i, action: allIn && action !== 'bring-in' ? 'all-in' : action, amount: C(added) });
    }
  }
  if (!isStud && streets[0].cards.hero === '' && heroIdx != null) throw new HandHistoryError('malformed', 'The hero has no cards', lines[0]);

  // Summary cards: showed / mucked [cards].
  for (const d of dealt) {
    const s = summarySeats.get(d.seat) || '';
    const m = /(?:showed|mucked) \[([^\]]*)\]/.exec(s);
    const i = ix(d.name);
    if (m && i >= 0 && !shows.has(i)) { const c = splitCards(m[1]); if (c && c.length) shows.set(i, c); }
  }

  // Opponents' shown cards into the model. With no hero, seat 0's cards take
  // the hero's place (the replayer reads a missing hero as seat 0).
  for (let i = 0; i < n; i++) {
    if (heroIdx == null && i === 0 && !isStud) { const c0 = shows.get(0); if (c0) streets[0].cards.hero = c0.join(''); continue; }
    if (i === hero) continue;
    const c = shows.get(i);
    if (isStud) {
      if (c && c.length === 7) {
        const ups = [];
        for (let k = 0; k < 4; k++) ups.push(k === 0 ? lastCard(streets[0].cards.opponents[slot(i)]) : streets[k].cards.opponents[slot(i)]);
        if (ups[0] && ups[0] !== c[2]) throw new HandHistoryError('malformed', 'Shown cards that are not the cards dealt', players[i].name);
        streets[0].cards.opponents[slot(i)] = c[6] + c[1] + c[0] + c[2];
        for (let k = 1; k <= 3; k++) if (!streets[k].cards.opponents[slot(i)]) streets[k].cards.opponents[slot(i)] = c[2 + k];
      }
      continue;
    }
    if (c) streets[0].cards.opponents[slot(i)] = c.join('');
    else if (mucks.has(i)) streets[0].cards.opponents[slot(i)] = 'MUCK';
  }

  // Result: the collectors.
  const won = new Map();
  for (const c of collects) if (c.i >= 0) won.set(c.i, (won.get(c.i) || 0) + c.amount);
  const winners = [...won.keys()].sort((a, b) => a - b);
  const hand = {
    gameType,
    gameMode: hd.tournament ? 'mtt' : 'cash',
    ...(hd.tournament ? {} : { currency: hd.currency }),
    blinds,
    players: players.map(p => ({ ...p, startingStack: C(p.startingStack) })),
    heroIdx,
    streets,
    result: { winners: winners.map(p => ({ playerIdx: p, split: winners.length > 1 })) },
    import: {
      site: 'pokerstars',
      siteName: hd.siteName,
      handId: hd.handId,
      tableName,
      maxSeats,
      seatNumbers: order.map(d => d.seat),
      playedAt: hd.playedAt ? hd.playedAt.toISOString() : null,
      ...(hd.tournament ? { tournamentId: hd.tournamentId, buyIn: hd.buyIn, level: hd.level } : {}),
      ...(hd.mix ? { mix: hd.mix } : {}),
      ...(rake ? { rake: C(rake) } : {}),
      ...(anteFirst ? { anteFirst: true } : {}),
      notes,
    },
  };

  // ── Consistency: replay it the writer's way; the pot must come out as stated ──
  if (heroIdx == null) {
    notes.push('Not replayed for consistency: the replay needs the hero\'s cards.');
    return hand;
  }
  let prep;
  try {
    prep = prepareHand(hand, {});
  } catch (e) {
    if (e instanceof HandExportError) throw new HandHistoryError(e.code, e.message, lines[0]);
    throw e;
  }
  const collected = collects.reduce((s, c) => s + c.amount, 0);
  if (prep.settle.total !== totalPot) throw new HandHistoryError('inconsistent', 'The total pot is ' + totalPot / 100 + ', the betting makes it ' + prep.settle.total / 100, 'Total pot');
  if (collected + rake !== totalPot) throw new HandHistoryError('inconsistent', 'The collects and rake do not add up to the pot', 'Total pot');
  if (!rake) {
    for (const [p, a] of won) if ((prep.settle.won[p] || 0) !== a) throw new HandHistoryError('inconsistent', players[p].name + ' collects ' + a / 100 + ', the cards pay ' + (prep.settle.won[p] || 0) / 100, players[p].name);
  }
  if (prep.settle.from === 'cards') hand.result = prep.model.result;
  return hand;
}

function lastCard(s) {
  const t = String(s || '');
  return t.length >= 2 ? t.slice(-2) : '';
}

/* Who the "Dealt to" lines name as the hero: the one dealt hole cards (stud: the
   one dealt three cards on 3rd street). */
function findHero(sections, isStud, isDraw, names) {
  const first = sections.find(s => s.head === (isStud ? '3rd STREET' : isDraw ? 'DEALING HANDS' : 'HOLE CARDS'));
  if (!first) return null;
  for (const l of first.lines) {
    const m = /^Dealt to (.+?) \[([^\]]*)\]$/.exec(l);
    if (!m) continue;
    const c = splitCards(m[2]);
    if (!c) continue;
    if (isStud ? c.length === 3 : c.length >= 2) return names.find(x => x === m[1]) || null;
  }
  return null;
}

/* A "Dealt to" line into the model's cards. */
function dealtTo(streets, x) {
  const { isStud, isDraw, si, i, hero, slot, brs, drawStreet, l } = x;
  const last = brs[brs.length - 1];
  if (isStud) {
    if (i === hero) streets[si].cards.hero = last.join('');
    else streets[si].cards.opponents[slot(i)] = last.join('');
    return;
  }
  if (isDraw && drawStreet >= 0) {
    // After a discard: [kept] [new] (or [new] alone when all were thrown).
    const d = [...streets[drawStreet].draws].reverse().find(dd => dd.player === i);
    if (!d) throw new HandHistoryError('malformed', 'New cards with no discard', l);
    d.newCards = last.join('');
    return;
  }
  if (i === hero) streets[0].cards.hero = last.join('');
  else if (!isDraw) streets[0].cards.opponents[slot(i)] = last.join('');
  // (A converter dealing every draw hand face up: only the hero's is kept.)
}

// ── The parser ───────────────────────────────────────────────────────────────
export function parse(text, { onError } = {}) {
  const out = [];
  const chunks = splitHands(text);
  chunks.forEach((lines, index) => {
    try {
      out.push(parseHand(lines));
    } catch (e) {
      const err = e instanceof HandHistoryError ? e : new HandHistoryError('malformed', e && e.message ? e.message : String(e));
      const id = (DETECT_RE.exec(lines[0] || '') || [])[2] || null;
      const rec = { index, handId: id, code: err.code, message: err.message, excerpt: err.detail != null ? String(err.detail).slice(0, 200) : (lines[0] || '').slice(0, 200) };
      if (onError) onError(rec); else throw err;
    }
  });
  return out;
}

export const pokerstars = {
  id: 'pokerstars',
  label: 'PokerStars format',
  detect,
  parse,
};

export default pokerstars;

// For tests: a stable fingerprint of a parsed hand.
export function fingerprint(hand) { return sortedJSON(hand); }
