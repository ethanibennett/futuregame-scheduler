// The hand ENTRY screens, held to an outside engine: each PokerKit hand is entered the way a user enters it
// (taps and typed numbers on the real screens, in WebKit at phone size), and before every action the entry
// screen has to agree with PokerKit on whose turn it is, what may be done and what it costs.
//
//   node scripts/check-replayer-entry-oracle.mjs [--corpus <file>] [--per-game 25] [--games "NLH,Razz"]
//        [--ids "NLH#3,Razz#40"] [--jobs 3] [--build <folder>]
//        [--all-in-button] [--as-shown] [--model-only] [--trace] [--shots <folder>] [--json <file>]
//
// check-replayer-oracle.mjs proves the REPLAY of a saved hand (every seat's last stack). This proves the step
// before it: that the hand can be put in at all. For each hand it
//   1. picks the game and sets the table up from the corpus: mode, seats, the hero's seat, every stack, the
//      blinds / ante / bets / bring-in, each typed key by key as a thumb would;
//   2. walks the corpus action by action. Before each one it reads the screen and checks the seat to act, the
//      street, the pot and that seat's stack, then that the corpus action is on offer at the right price: the
//      call, the bring-in and completion, a limit game's bet and raise sizes and its cap, the smallest raise
//      in no-limit, the pot figure in pot-limit; and that nothing is on offer that PokerKit would refuse
//      (a raise after the cap, over a short all-in that did not reopen the betting, or with nobody left to
//      call it). The betting round has to close, and the next cards, draw or showdown come, exactly when the
//      corpus's does;
//   3. deals boards, stud streets and draws, shows the hands the corpus shows, reads who the Result screen
//      says won, presses Save & Replay, takes the replay to its End and holds every seat to the corpus's
//      stack, to the cent; then fetches the saved hand back and compares it with the corpus hand.
//
// The rules it holds the screens to are PokerKit's own (pokerkit/state.py), restated in model() below and
// checked there against every action of the corpus (`--model-only` runs just that: it must print 0 warnings).
//
// What is printed, per game: `ok N/N`, or the hands that were not clean, grouped by cause. Kinds:
//   fail     the hand could not be entered as played, or the saved hand replays to other stacks
//   cannot   a value or a step the screens have no way to take (the hand goes on where it can)
//   offer    the screen offered something PokerKit refuses, or showed a wrong figure, though the corpus
//            action could still be entered
//   driver   this script lost its place (a selector, a timeout): not a statement about the app
//   note     a difference of representation; never fails the run
// Each cause carries a corpus id with the street and action (NLH#12@s1a3 = street 1, action 3, both from 0),
// what the screen offered and what the corpus needed. Exit code 1 on any fail, cannot, offer or driver.
//
// Two settings are changed from their defaults in a fixed-limit game, to match PokerKit: Cap is typed as 4
// and "Uncapped heads-up" is switched off. Opponents' discards and replacement cards, and the hole cards of
// a player who folded, have no place on the entry screens; they are left out and counted as notes. Hands
// with a straddle are left out of the run (the committed corpus has 61).
//
//   --all-in-button  where the corpus puts a whole stack in and the screen has an "All-in" button, press it
//                    even when the move is a call for less (the default presses "Call X" there)
//   --as-shown       leave the app's number formatting alone (whole numbers, 2.4K): figures then compare
//                    after rounding. The default makes the labels exact so cents can be checked.
//   --build <folder> serve another build folder (test/helpers/public-dir-preload.js), for a run while
//                    something else reads public-vite
//
// Hands are chosen per game, most telling first, and spread over the kinds that go wrong: side pots and
// ties, an all-in for less than a call, an all-in raise for less than a full raise (does the betting
// reopen?), a capped limit round, heads-up, a hand ended by a fold, a full table, cash and tournament.
//
// It boots its own scratch server on ports 4860-4869 and stops it when it ends, a crash included. The
// server's pid is printed first: if this script is killed outright, stop that one process by its pid.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const has = (f) => args.includes(f);
const list = (f) => (opt(f, '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const CORPUS = path.resolve(opt('--corpus', path.join(ROOT, 'test', 'replayer-oracle', 'corpus.jsonl')));
const PER = Number(opt('--per-game', 25));
const ONLY = list('--games');
const IDS = list('--ids');
const JOBS = Math.max(1, Number(opt('--jobs', 3)));
const BUILD = opt('--build', '');
const SHOTS = opt('--shots', '');
const JSON_OUT = opt('--json', '');
const TRACE = has('--trace');
const AS_SHOWN = has('--as-shown');
const ALLIN_BUTTON = has('--all-in-button');
const PORTS = [4860, 4869];
const W = 402, H = 874;

// corpus game -> [family, betting, the picker's row]
const GAMES = {
  NLH: ['flop', 'nl', "No Limit Hold'em"], PLH: ['flop', 'pl', "Pot Limit Hold'em"], LHE: ['flop', 'fl', "Limit Hold'em"],
  PLO: ['flop', 'pl', 'Pot Limit Omaha'], PLO5: ['flop', 'pl', 'PLO5'], PLO6: ['flop', 'pl', 'PLO6'], 'LO Hi': ['flop', 'fl', 'Limit Omaha Hi'],
  PLO8: ['flop', 'pl', 'PLO8'], NLO8: ['flop', 'nl', 'NLO8'], O8: ['flop', 'fl', 'O8'], 'Big O': ['flop', 'pl', 'Big O'], 'PLO6 8/b': ['flop', 'pl', 'PLO6 8/b'],
  'Stud Hi': ['stud', 'fl', 'Stud Hi'], 'Stud 8': ['stud', 'fl', 'Stud 8/b'], Razz: ['stud', 'fl', 'Razz'],
  '2-7 TD': ['draw3', 'fl', '2-7 Triple Draw'], 'PL 2-7 TD': ['draw3', 'pl', 'Pot Limit 2-7 Triple Draw'], Badugi: ['draw3', 'fl', 'Badugi'],
  'NL 2-7 SD': ['draw1', 'nl', 'No Limit 2-7 Single Draw'], 'PL 5CD Hi': ['draw1', 'pl', 'Pot Limit 5-Card Draw'],
};
const STREETS = {
  flop: ['Preflop', 'Flop', 'Turn', 'River'], stud: ['3rd Street', '4th Street', '5th Street', '6th Street', '7th Street'],
  draw3: ['Pre-Draw', 'First Draw', 'Second Draw', 'Third Draw'], draw1: ['Pre-Draw', 'Draw'],
};
const cardsOf = (s) => (s || '').match(/[2-9TJQKA][hdcs]/g) || [];
const slotOf = (i, hero) => (i > hero ? i - 1 : i);
const sum = (a) => a.reduce((x, y) => x + y, 0);

// ── The corpus hand as PokerKit played it ───────────────────────────────────────────────────────────────
// Whole units (cents in a cash game, chips in a tournament). Each action carries the table as it stood
// before it: the price to call, whether a raise was allowed and why not, the smallest and the pot-sized
// raise. The raise rules are PokerKit's, line for line:
//   - a round starts with no raise size on record, so its first bet or raise is always a full one;
//   - the smallest raise is to (the largest raise so far this round, or the street's bet if larger) over the
//     current bet; over a stud bring-in the completion is to the street's bet itself;
//   - no raise: for a player who cannot cover the call; when nobody else could call more; in a limit game
//     after four bets and raises (a stud completion counts); and when what the player faces is less than a
//     full raise over what they already answered: an all-in for less does not reopen the betting, unless
//     several of them add up to a full raise.
function model(rec) {
  const [family, betting] = GAMES[rec.game];
  const h = rec.hand;
  const U = rec.mode === 'cash' ? 100 : 1;
  const c = (v) => Math.round((v || 0) * U);
  const n = h.players.length;
  const b = h.blinds || {};
  const sb = c(b.sb), bb = c(b.bb), big = c(b.bigBet || b.bb * 2), ante = c(b.ante), bringIn = c(b.bringIn);
  const start = h.players.map((p) => c(p.startingStack));
  const stacks = start.slice();
  const folded = new Array(n).fill(false);
  const events = [], warn = [], flags = new Set();
  let pot = 0;
  let contrib = new Array(n).fill(0);
  let sbIdx = -1, bbIdx = -1;
  if (family === 'stud') {
    for (let i = 0; i < n; i++) { const a = Math.min(ante, stacks[i]); stacks[i] -= a; pot += a; }
    events.push({ type: 'third' });
  } else {
    sbIdx = h.players.findIndex((p) => p.position === 'SB' || p.position === 'BTN/SB');
    bbIdx = h.players.findIndex((p) => p.position === 'BB');
    const s = Math.min(sb, stacks[sbIdx]); stacks[sbIdx] -= s; contrib[sbIdx] = s; pot += s;
    const g = Math.min(bb, stacks[bbIdx]); stacks[bbIdx] -= g; contrib[bbIdx] = g; pot += g;
    const a = Math.min(ante, stacks[bbIdx]); stacks[bbIdx] -= a; pot += a;      // a big-blind ante: dead money, after the blind
    if (s < sb || g < bb) flags.add('short-blind');
  }
  const posted = stacks.slice();
  // Stud: a door card paired by the 4th-street card. PokerKit bets the small bet there all the same; the
  // entry screen moves the whole street to the big bet, so a 4th-street bet in such a hand is where they part.
  let openPair4 = false;
  if (family === 'stud' && h.streets[1]) {
    for (let i = 0; i < n; i++) {
      const of = (si) => cardsOf(i === h.heroIdx ? h.streets[si].cards.hero : (h.streets[si].cards.opponents || [])[slotOf(i, h.heroIdx)]);
      const c0 = of(0), c1 = of(1);
      const door = i === h.heroIdx ? c0[2] : c0[c0.length - 1];
      if (door && c1[0] && door[0] === c1[0][0]) openPair4 = true;
    }
    if (openPair4 && (h.streets[1].actions || []).some((a) => a.action === 'bet' || a.action === 'raise')) flags.add('open-pair-4th');
  }
  let over = false;
  const last = h.streets.length - 1;
  for (let si = 0; si <= last && !over; si++) {
    const st = h.streets[si];
    if (si > 0) contrib = new Array(n).fill(0);
    const streetMin = betting === 'fl' ? (si <= 1 ? bb : big) : bb;
    let cbra = 0, count = 0, shorts = [], acted = new Set(), shortSeen = false;
    let completion = family === 'stud' && si === 0 && bringIn > 0;
    for (let ai = 0; ai < (st.actions || []).length; ai++) {
      const a = st.actions[ai];
      const p = a.player, amt = c(a.amount);
      const at = `${rec.id} s${si}a${ai}`;
      const maxBet = Math.max(...contrib);
      const oweFull = maxBet - contrib[p];
      const owe = Math.min(stacks[p], oweFull);
      const allInTo = contrib[p] + stacks[p];
      const others = [...Array(n).keys()].filter((i) => i !== p && !folded[i]);
      let noRaise = null;
      if (stacks[p] <= oweFull) noRaise = 'covered';
      else if (!others.some((i) => stacks[i] + contrib[i] > maxBet)) noRaise = 'no-one-to-call';
      else if (betting === 'fl' && count >= 4) noRaise = 'cap';
      else if (owe < cbra || (shorts.length && sum(shorts) < cbra && acted.has(p))) noRaise = 'not-reopened';
      const minTo = Math.min(allInTo, Math.max(cbra, streetMin) + (completion ? 0 : maxBet));
      const potTo = Math.min(allInTo, Math.max(minTo, 2 * maxBet - contrib[p] + pot));
      const ev = { type: 'act', street: si, index: ai, player: p, action: a.action, amount: amt, stackBefore: stacks[p], contribBefore: contrib[p],
        maxBet, oweFull, owe, pot, noRaise, minTo, potTo, allInTo, count, shortSeen, firstOfStreet: ai === 0,
        // TDA rule 47-B: in a limit game half a bet reopens the betting. PokerKit asks for a whole one.
        halfBet: betting === 'fl' && noRaise === 'not-reopened' && owe * 2 >= streetMin };
      if (noRaise === 'not-reopened') flags.add('closed-raise-spot');
      if (noRaise === 'cap') flags.add('capped');
      if (noRaise === 'no-one-to-call') flags.add('no-one-to-call');
      if (a.action === 'fold') { ev.kind = 'fold'; folded[p] = true; if (owe <= 0) warn.push(`${at}: a fold with nothing to call`); }
      else if (a.action === 'check') { ev.kind = 'check'; if (amt !== 0 || owe !== 0) warn.push(`${at}: a check owing ${owe}`); }
      else if (a.action === 'bring-in') {
        ev.kind = 'bringin';
        if (amt !== Math.min(bringIn, ev.stackBefore)) warn.push(`${at}: bring-in ${amt}, the table's is ${bringIn}`);
        stacks[p] -= amt; contrib[p] += amt; pot += amt;
      } else {
        const to = contrib[p] + amt;
        if (amt > ev.stackBefore) warn.push(`${at}: more than the stack`);
        if (to <= maxBet) {
          ev.kind = 'call';
          if (amt !== owe || amt === 0) warn.push(`${at}: ${a.action} ${amt}, the price is ${owe}`);
          if (amt < oweFull) flags.add('call-for-less');
        } else {
          ev.kind = completion ? 'complete' : (maxBet === 0 ? 'bet' : 'raise');
          ev.to = to;
          ev.isAllIn = amt === ev.stackBefore;
          if (noRaise) warn.push(`${at}: a raise where the model allows none (${noRaise})`);
          if (betting === 'fl' && to !== minTo) warn.push(`${at}: limit ${a.action} to ${to}, the model says ${minTo}`);
          if (betting !== 'fl' && to < minTo) warn.push(`${at}: ${a.action} to ${to}, under the minimum ${minTo}`);
          if (betting === 'pl' && to > potTo) warn.push(`${at}: ${a.action} to ${to}, over the pot ${potTo}`);
          if (betting === 'pl' && to === potTo) { ev.potSized = true; flags.add('pot-raise'); }
          const r = to - maxBet;
          if (cbra > 0 && r < cbra) { flags.add('short-raise'); shortSeen = true; ev.short = true; }
          completion = false;
          if (r >= cbra) acted = new Set();
          cbra = Math.max(cbra, r);
          count++;
          if (ev.stackBefore - amt > 0) shorts = []; else shorts.push(r);
          if (sum(shorts) >= cbra) shorts = [];
        }
        stacks[p] -= amt; contrib[p] += amt; pot += amt;
      }
      acted.add(p);
      ev.stackAfter = stacks[p];
      ev.potAfter = pot;
      events.push(ev);
      if (folded.filter((f) => !f).length === 1) { over = true; break; }
    }
    if (over) break;
    if (si < last) {
      if (family === 'flop') events.push({ type: 'board', street: si + 1, cards: h.streets[si + 1].cards.board });
      else if (family === 'stud') events.push({ type: 'deal', street: si + 1 });
      else events.push({ type: 'draw', street: si, draws: st.draws || [] });
    }
  }
  const live = [...Array(n).keys()].filter((i) => !folded[i]);
  if (!over) events.push({ type: 'showdown', live });
  events.push({ type: 'result', live, winners: (h.result && h.result.winners) || [] });
  if (family === 'flop' && betting === 'fl' && b.bigBet && c(b.bigBet) !== 2 * bb) flags.add('odd-big-bet');
  return { events, warn, flags, family, betting, U, n, sb, bb, big, ante, bringIn, start, posted, sbIdx, bbIdx, live, folded, openPair4 };
}

// ── Which hands ─────────────────────────────────────────────────────────────────────────────────────────
const score = (r) => (r.tags.includes('stud-odd-chip-by-suit') ? 16 : 0) + (r.tags.includes('odd-chip') ? 8 : 0) + (r.tags.includes('tie') ? 4 : 0) + (r.tags.includes('side-pots') ? 4 : 0)
  + (r.tags.includes('straddle') ? 3 : 0) + (r.tags.includes('multiway') ? 2 : 0) + (r.tags.includes('showdown') ? 1 : 0);
const idNum = (r) => Number(String(r.id).split('#')[1]) || 0;
function choose(pool, per) {
  const telling = (a, b) => score(b.rec) - score(a.rec) || idNum(a.rec) - idNum(b.rec);
  const F = (x, f) => x.m.flags.has(f);
  const most = Math.max(...pool.map((x) => x.m.n));
  const kinds = [
    () => true,                                                       // the oddest settlements first
    (x) => F(x, 'closed-raise-spot'),                                 // someone acts over an all-in that did not reopen the betting
    (x) => F(x, 'short-raise'),                                       // an all-in raise for less than a full raise
    (x) => F(x, 'call-for-less'),                                     // an all-in for less than the call
    (x) => x.m.n === 2,
    (x) => !x.rec.tags.includes('showdown'),                          // ended by a fold
    (x) => x.m.n >= 3 && !x.rec.tags.includes('all-in'),              // an ordinary hand
    (x) => x.m.n === most,
    (x) => F(x, 'capped'),
    (x) => F(x, 'pot-raise') || F(x, 'no-one-to-call') || F(x, 'open-pair-4th'),
  ].map((f) => { const hit = pool.filter(f).sort(telling); return { cash: hit.filter((x) => x.rec.mode === 'cash'), mtt: hit.filter((x) => x.rec.mode !== 'cash') }; });
  const out = [], seen = new Set();
  let turn = 0;
  for (let took = true; took && out.length < per;) {
    took = false;
    for (const k of kinds) {
      if (out.length >= per) break;
      const order = turn++ % 2 ? ['mtt', 'cash'] : ['cash', 'mtt'];
      for (const mode of order) {
        let x = k[mode].shift();
        while (x && seen.has(x.rec.id)) x = k[mode].shift();
        if (x) { seen.add(x.rec.id); out.push(x); took = true; break; }
      }
    }
  }
  return out;
}

const read = fs.readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// A straddle is not set up by this script (its model posts the two blinds only): those hands are left out.
const all = read.filter((r) => !(r.hand.blinds && r.hand.blinds.straddle));
if (all.length < read.length) console.log(`${read.length - all.length} hands with a straddle left out: this script does not enter a straddle`);
const unknown = [...new Set(all.map((r) => r.game))].filter((g) => !GAMES[g]);
if (unknown.length) console.log('games in the corpus this script does not know: ' + unknown.join(', '));
const known = all.filter((r) => GAMES[r.game] && (!ONLY.length || ONLY.includes(r.game))).map((rec) => ({ rec, m: model(rec) }));

if (has('--model-only')) {
  const byKind = new Map(); const flagCount = {};
  for (const x of known) {
    for (const f of x.m.flags) flagCount[f] = (flagCount[f] || 0) + 1;
    for (const w of x.m.warn) { const k = x.rec.game + ': ' + w.replace(/^.*?: /, '').replace(/\d+/g, 'N'); byKind.set(k, [...(byKind.get(k) || []), w]); }
  }
  const total = sum([...byKind.values()].map((v) => v.length));
  console.log(`${known.length} hands, ${sum(known.map((x) => x.m.events.filter((e) => e.type === 'act').length))} actions: ${total} warnings`);
  console.log('hands with: ' + Object.entries(flagCount).map(([k, v]) => `${k} ${v}`).join(', '));
  for (const g of [...new Set(known.map((x) => x.rec.game))]) {
    const pool = known.filter((x) => x.rec.game === g);
    console.log(`  ${g.padEnd(10)} ${String(pool.length).padStart(5)} hands: ` + Object.keys(flagCount).map((f) => `${f} ${pool.filter((x) => x.m.flags.has(f)).length}`).join(', '));
  }
  for (const [k, v] of [...byKind].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) console.log(String(v.length).padStart(6), k, ' e.g.', v[0]);
  process.exit(total ? 1 : 0);
}

const byGame = new Map();
for (const x of known) byGame.set(x.rec.game, [...(byGame.get(x.rec.game) || []), x]);
let hands = [];
if (IDS.length) hands = IDS.map((id) => known.find((x) => x.rec.id === id) || (console.log('not in the corpus: ' + id), null)).filter(Boolean);
else {
  const picked = [...byGame.values()].map((pool) => choose(pool, PER));
  // one game after another would leave the slow games to one worker: deal them out in turn
  for (let i = 0; picked.some((g) => i < g.length); i++) for (const g of picked) if (i < g.length) hands.push(g[i]);
}
if (!hands.length) { console.log('no hands to enter'); process.exit(1); }

// ── The browser side ────────────────────────────────────────────────────────────────────────────────────
const { webkit } = require('../vite-app/node_modules/playwright');
const { createScratch, boot } = require('../test/helpers/scratch-server.js');
// The port is found here, on the address the server binds. The helper's own search binds 127.0.0.1, which
// Windows allows while another server holds the port on 0.0.0.0, and Express 5 then prints "Server running"
// over the failed listen: a second run at the same time would quietly talk to the first run's server.
const net = require('node:net');
const portFree = (p) => new Promise((res) => {
  const s = net.createServer();
  s.once('error', () => res(false));
  s.listen({ port: p, host: '0.0.0.0', exclusive: true }, () => s.close(() => res(true)));
});
let PORT = 0;
for (let p = PORTS[0]; p <= PORTS[1] && !PORT; p++) if (await portFree(p)) PORT = p;
if (!PORT) { console.log(`no free port in ${PORTS[0]}-${PORTS[1]}`); process.exit(1); }
const scratch = await createScratch({ ports: [PORT, PORT], prefix: 'fg-entry-oracle-' });
const srv = await boot(scratch.dbPath, BUILD ? { PUBLIC_VITE_DIR: path.resolve(BUILD) } : {},
  { ports: [PORT, PORT], preloads: BUILD ? [path.join(ROOT, 'test', 'helpers', 'public-dir-preload.js')] : [] });
const base = 'http://127.0.0.1:' + srv.port;
let serverDied = false;
srv.child.on('exit', () => { serverDied = true; });
console.log(`scratch server pid ${srv.child.pid} on port ${srv.port}; ${hands.length} hands, ${JOBS} at a time`);
let stopping = false;
const stopAll = async (code) => { if (stopping) return; stopping = true; try { await srv.stop(); } catch { /* gone */ } try { scratch.cleanup(); } catch { /* held */ } process.exit(code); };
process.on('SIGINT', () => stopAll(130));
process.on('SIGTERM', () => stopAll(143));
process.on('SIGBREAK', () => stopAll(149));
process.on('uncaughtException', (e) => { console.log('crashed: ' + (e && e.stack || e)); stopAll(1); });
process.on('unhandledRejection', (e) => { console.log('crashed: ' + (e && e.stack || e)); stopAll(1); });
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const api = async (p, o = {}) => {
  const r = await fetch(base + p, { method: o.method || 'GET',
    headers: { 'content-type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const num = (t) => { const m = /(-?[\d,]*\.?\d+)\s*([kKmM]?)/.exec(t || ''); return m ? parseFloat(m[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1) : NaN; };
// The app rounds what it shows (whole numbers; 2.4K from 100,000 up). The checks are on exact figures, so the
// formatter is made exact before the app loads; --as-shown leaves it alone.
const exactNumbers = () => {
  const NF = Intl.NumberFormat;
  const Exact = function (loc, o) {
    if (!o) return new NF(loc, o);
    const x = { ...o };
    if (x.notation === 'compact') { delete x.notation; delete x.compactDisplay; x.maximumFractionDigits = 2; }
    if (x.maximumFractionDigits === 0) x.maximumFractionDigits = 2;
    if (x.maximumSignificantDigits) delete x.maximumSignificantDigits;
    return new NF(loc, x);
  };
  Exact.prototype = NF.prototype; Exact.supportedLocalesOf = NF.supportedLocalesOf;
  Intl.NumberFormat = Exact;
};

// One look at the entry screen: which step it is on and everything a check reads from it.
const readScreen = (page) => page.evaluate(() => {
  const shown = (el) => !!el && el.getBoundingClientRect().height > 0;
  const q = (sel, root) => [...(root || document).querySelectorAll(sel)].filter(shown);
  const t = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const titles = q('.replayer-section-title').map(t);
  const labels = q('.gto-street-label').map(t);
  const prim = q('button.btn-primary').map((b) => ({ text: t(b), off: !!b.disabled }));
  const seats = q('.gto-seat').map((s) => ({ name: t(s.querySelector('.gto-seat-name')), pos: t(s.querySelector('.gto-seat-pos')),
    stack: t(s.querySelector('.gto-seat-stack')), cls: s.className.replace(/\s+/g, ' ') }));
  const on = q('.gto-seat.active')[0] || null;
  const active = on ? {
    name: t(on.querySelector('.gto-seat-name')), stack: t(on.querySelector('.gto-seat-stack')),
    labels: q('.gto-action-btn .gto-action-label', on).map(t), picker: q('.gto-hero-picker:not(.has-cards)', on).length > 0,
    draw: q('.gto-draw-btn', on).map(t), input: q('.gto-raise-input-row input', on).map((i) => i.value)[0] ?? null,
  } : null;
  const deal = q('.gto-deal-row').map((r) => ({ name: t(r.querySelector('.gto-deal-name')), text: t(r), cls: r.className.replace(/\s+/g, ' ') }));
  const sd = q('.gto-sd-head').map((hd) => ({ name: t(hd.querySelector('.gto-sd-name')), btn: t(hd.querySelector('.gto-undo-btn')) }));
  const some = (arr, re) => arr.some((x) => re.test(x));
  let phase = 'wait';
  if (q('button[title="End"]').length) phase = 'replay';
  else if (some(titles, /^Players/)) phase = 'setup';
  else if (prim.some((b) => /^Enter Door Cards$/.test(b.text))) phase = 'hero_cards';
  else if (some(titles, /^Opponent Door Cards$/)) phase = 'doors';
  else if (some(titles, /^Deal /)) phase = 'stud_deal';
  else if (some(labels, /^Deal the /)) phase = 'board';
  else if (some(titles, /^Draw Round/)) phase = 'draw';
  else if (some(titles, /^Card [Dd]etails/)) phase = 'draw_cards';
  else if (some(labels, /^Showdown$/)) phase = 'showdown';
  else if (some(titles, /^Result$/)) phase = 'result';
  else if (active && active.labels.length) phase = 'action';
  return { phase, titles, labels, prim, street: t(q('.gto-street-name')[0]), pot: t(q('.gto-pot-label')[0]), seats, active, deal, sd,
    winners: q('.gto-winner-btn').map(t), auto: t(q('.gto-result-win')[0]), autoSub: t(q('.gto-result-sub')[0]),
    picked: q('.card-picker-btn.selected').length, used: q('.card-picker-btn.used').length };
});
const readSeats = (page) => page.evaluate(() => [...document.querySelectorAll('.replayer-seat')].map((s) => {
  const c = s.querySelector('.replayer-seat-stack');
  return { seat: Number(s.getAttribute('data-seat')), name: s.querySelector('.replayer-seat-name')?.getAttribute('title') || '', text: (c?.textContent || '').trim() };
}).sort((a, b) => a.seat - b.seat));

class Stop extends Error {}
const SCREEN = { setup: 'the table setup', hero_cards: "the hero's 3rd-street cards", doors: 'the door cards', stud_deal: 'the next stud street', board: 'the board cards',
  draw: 'the draw', draw_cards: 'the draw card details', showdown: 'the showdown', result: 'the result', action: 'a betting decision', replay: 'the replay', wait: 'nothing this script recognises' };

const browser = await webkit.launch();
const results = [];
let next = 0;
const t0 = Date.now();
const runTag = Date.now().toString(36);

async function worker(w) {
  const email = `entry${w}@x.test`;
  await api('/api/register', { method: 'POST', body: { username: 'entry' + w, email, password: 'entry-password-1', realName: 'E O' } });
  const { body: { token } } = await api('/api/login', { method: 'POST', body: { email, password: 'entry-password-1' } });
  if (!token) throw new Error('no token for worker ' + w);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true });
  // Every hand starts on a fresh load: a hand stopped part way is kept as the app's unfinished-hand draft,
  // which would otherwise be offered back (and asked about) before the next hand could start.
  await ctx.addInitScript((t) => { localStorage.setItem('token', t); localStorage.setItem('authToken', t); localStorage.setItem('tutorialDone', '1'); localStorage.removeItem('replayerDraft'); }, token);
  if (!AS_SHOWN) await ctx.addInitScript(exactNumbers);
  const p = await ctx.newPage();
  p.setDefaultTimeout(6000);
  p.on('dialog', (d) => (/unfinished hand/i.test(d.message()) ? d.accept() : d.dismiss()).catch(() => {}));
  const errs = [];
  p.on('pageerror', (e) => { if (!/access control/.test(e.message)) errs.push(e.message.split('\n')[0]); });

  // Wait for the screen to stop changing; with `prev`, for it to differ from that look first.
  const settle = async (prev, ms = 3500) => {
    const from = Date.now();
    let s = await readScreen(p), sig = JSON.stringify(s);
    for (;;) {
      await p.waitForTimeout(40);
      const now = await readScreen(p), nsig = JSON.stringify(now);
      const still = nsig === sig;
      s = now; sig = nsig;
      if (still && s.phase !== 'wait' && (!prev || sig !== prev)) return Object.assign(s, { sig });
      if (Date.now() - from > ms) return Object.assign(s, { sig, stuck: true });
    }
  };

  async function enter({ rec, m }) {
    const h = rec.hand, U = m.U, [family, betting, rowName] = GAMES[rec.game];
    const res = { id: rec.id, game: rec.game, n: m.n, mode: rec.mode, tags: rec.tags, flags: [...m.flags], findings: [], reached: 'open', chips: null, saved: null };
    const shot = async (name) => {
      if (!SHOTS) return;
      // the seat being asked, where there is one, in the middle of the picture
      await p.evaluate(() => { const a = document.querySelector('.gto-seat.active'); if (a) a.scrollIntoView({ block: 'center' }); }).catch(() => {});
      await p.screenshot({ path: path.join(SHOTS, `${rec.id}-${name}`.replace(/[^\w.-]+/g, '_') + '.png') }).catch(() => {});
    };
    const seen = new Set();
    const find = async (sev, cause, at, detail) => {
      res.findings.push({ sev, cause, at, detail });
      if (TRACE) console.log(`  [${rec.id}] ${sev.toUpperCase()} ${cause} @${at}: ${detail}`);
      if (sev !== 'note' && !seen.has(cause)) { seen.add(cause); await shot(`${at}-${cause}`); }
    };
    const stop = async (sev, cause, at, detail) => { await find(sev, cause, at, detail); throw new Stop(cause); };
    const began = Date.now();
    const trace = (line) => { if (TRACE) console.log(`  [${rec.id}] ${String(Date.now() - began).padStart(6)} ${line}`); };
    const show = (u) => String(u / U);
    const same = (shown, units) => (AS_SHOWN ? Math.abs(shown - units / U) <= Math.max(0.5, (units / U) * 0.06) : Math.abs(shown - units / U) < 0.005);
    const tap = async (loc, label) => {
      try { await loc.click({ timeout: 2500 }); }
      catch (e) {
        if (!(await loc.count())) throw new Error('nothing to tap: ' + label);
        res.findings.push({ sev: 'note', cause: 'a tap had to be forced', at: res.reached, detail: label });
        await loc.evaluate((el) => el.click());
      }
    };
    const primary = (text) => p.locator('button.btn-primary:visible').filter({ hasText: text }).first();
    // A card on the picker in view. 'refused' = the screen has it greyed out as already used.
    const pick = async (card, scope = '') => {
      const btn = p.locator(`${scope} .card-picker-btn:visible:has(img[alt="${card}"])`).first();
      if (!(await btn.count())) return 'missing';
      const st = await btn.evaluate((el) => ({ off: el.disabled, cls: el.className }));
      if (/\bselected\b/.test(st.cls)) return 'already';
      if (st.off || /\bused\b/.test(st.cls)) return 'refused';
      await tap(btn, 'card ' + card);
      await p.waitForTimeout(35);
      return 'ok';
    };
    const pickAll = async (cards, scope, at, what) => {
      for (const cd of cards) {
        const r = await pick(cd, scope);
        if (r === 'missing' || r === 'refused') await stop('cannot', 'a card the screen will not take', at, `${what}: ${cd} is ${r === 'missing' ? 'not on the picker' : 'greyed out as already used'}`);
      }
    };

    try {
      // ── the game ──
      await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('.bottom-nav .nav-tab', { timeout: 20000 });
      await p.waitForTimeout(500);
      await p.addStyleTag({ content: '.grid-dev-toggle{display:none!important}' });
      // A new account is asked where it plays, on a sheet that comes up over the tabs a moment after the app
      // does: it is skipped whenever it is in the way, and the way in is walked again.
      const skipSheet = async () => {
        const skip = p.getByRole('button', { name: 'Skip', exact: true }).first();
        if (!(await skip.isVisible().catch(() => false))) return false;
        await skip.click({ timeout: 1500 }).catch(() => {});
        await p.waitForTimeout(300);
        return true;
      };
      const row = p.locator('.vp-list button').filter({ has: p.locator(`.vp-row-name:text-is("${rowName}")`) }).first();
      for (let go = 0; ; go++) {
        try {
          await skipSheet();
          await p.locator('.bottom-nav .nav-tab:has-text("Hands")').first().click({ timeout: 3000 });
          await p.waitForSelector('.vp-launcher', { timeout: 10000 });
          await p.waitForTimeout(300);
          await skipSheet();
          await p.locator('.vp-launcher').first().click({ timeout: 3000 });
          await p.locator('input[aria-label="Search games"]').fill(rowName, { timeout: 3000 });
          await p.waitForTimeout(150);
          if (!(await row.count())) await stop('cannot', 'the game is not in the picker', 'setup', `no picker row named "${rowName}"`);
          await row.click({ timeout: 3000 });
          break;
        } catch (e) {
          if (e instanceof Stop || go >= 3) throw e;
          await skipSheet();
          await p.keyboard.press('Escape').catch(() => {});
          await p.waitForTimeout(400);
        }
      }
      await p.waitForTimeout(450);
      if (!(await p.locator('.gto-entry').count())) { await p.locator('.replayer-list-create button').first().click(); await p.waitForTimeout(450); }
      if (!(await p.locator('.gto-entry').count())) throw new Error('the entry screen did not open');
      res.reached = 'setup';

      // ── the table ──
      const modeBtn = p.locator('.entry-game-row .live-update-tabs button').filter({ hasText: rec.mode === 'cash' ? /^\s*Cash\s*$/ : /^\s*MTT\s*$/ }).first();
      if (!/\bactive\b/.test((await modeBtn.getAttribute('class')) || '')) await tap(modeBtn, 'mode');
      const title = `EO ${rec.id} ${runTag}`;
      await p.locator('input[placeholder="e.g. Huge pot with AA"]').fill(title);
      const seatsSel = p.locator('.gto-blinds-grid select').first();
      const options = await seatsSel.locator('option').allTextContents();
      if (!options.includes(String(m.n))) await stop('cannot', 'the number of players', 'setup', `${m.n} players; the list offers ${options.join(', ')}`);
      await seatsSel.selectOption(String(m.n));
      await p.waitForTimeout(80);
      const rows = p.locator('.replayer-player-row');
      if ((await rows.count()) !== m.n) throw new Error(`asked for ${m.n} players, the form has ${await rows.count()} rows`);
      const heroPos = rows.nth(h.heroIdx).locator('.replayer-player-pos').first();
      if (!/\bhero\b/.test((await heroPos.getAttribute('class')) || '')) {
        await heroPos.click();
        await p.waitForTimeout(120);
        if (!/\bhero\b/.test((await heroPos.getAttribute('class')) || '')) await stop('cannot', "the hero's seat", 'setup', `tapped row ${h.heroIdx + 1} (${h.players[h.heroIdx].position}); it did not become the hero`);
      }
      // A figure typed key by key, as a thumb types it. Where the field loses what was typed the finding is
      // recorded and the value is put in whole (as a paste would), so the rest of the hand can be checked.
      // The app empties a number field when it takes the focus (the old value shows as its placeholder until a
      // key is pressed, and comes back if none is), so a tap and the digits replace what was there; a field is
      // read back only after the focus has left it.
      const blur = async () => { await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await p.waitForTimeout(40); };
      const lost = [];                                    // figures the form did not keep as typed (one finding a hand)
      const typeNumber = async (loc, units, what, money = true) => {
        const want = money ? units / U : units;
        const text = String(want);
        const cur = await loc.inputValue();
        if (cur !== '' && Math.abs(Number(cur) - want) < 1e-9) return;
        if (cur === '' && want === 0) return;
        await loc.click();
        await loc.pressSequentially(text);
        await blur();
        let got = await loc.inputValue();
        if (Math.abs((Number(got) || 0) - want) < 1e-9) return;
        lost.push({ cents: text.includes('.'), line: `${what}: typed "${text}", the field reads "${got}"` });
        await loc.fill(text);
        await blur();
        got = await loc.inputValue();
        if (Math.abs((Number(got) || 0) - want) > 1e-9) await stop('cannot', 'a figure the field will not hold', 'setup', `${what}: "${text}" put in whole, the field reads "${got}"`);
      };
      const sizeField = (label) => p.locator('.gto-blinds-grid .replayer-field').filter({ has: p.locator(`label:text-is("${label}")`) }).locator('input').first();
      const fieldNames = await p.locator('.gto-blinds-grid .replayer-field label').allTextContents();
      const need = family === 'stud'
        ? [['Small Bet', m.bb], ['Big Bet', m.big], ['Bring-in', m.bringIn], ['Ante (each)', m.ante]]
        : [['SB', m.sb], ['BB', m.bb], ['BB Ante', m.ante]];
      for (const [label, units] of need) {
        if (!fieldNames.includes(label)) {
          if (units) await stop('cannot', 'a stake the form has no field for', 'setup', `${label} ${show(units)}; the form has ${fieldNames.join(', ')}`);
          continue;
        }
        await typeNumber(sizeField(label), units, label);
      }
      if (m.flags.has('odd-big-bet')) await find('cannot', 'a big bet that is not twice the small bet', 'setup', `big bet ${show(m.big)} over ${show(m.bb)}: a flop game has no big-bet field`);
      if (betting === 'fl') {
        if (fieldNames.includes('Cap')) await typeNumber(sizeField('Cap'), 4, 'Cap', false);
        const un = p.locator('button[aria-label="Uncapped heads-up on the last street"]').first();
        if ((await un.count()) && (await un.getAttribute('aria-pressed')) === 'true') await tap(un, 'uncapped heads-up');
      }
      for (let i = 0; i < m.n; i++) await typeNumber(rows.nth(i).locator('.gto-stack-wrap input').first(), m.start[i], `the stack of seat ${i + 1}`);
      for (const cents of [true, false]) {
        const l = lost.filter((x) => x.cents === cents);
        if (l.length) await find('cannot', cents ? 'a figure with cents cannot be typed' : 'a typed figure is not kept', 'setup',
          `key by key, ${l.slice(0, 3).map((x) => x.line).join('; ')}${l.length > 3 ? `; and ${l.length - 3} more fields` : ''} (the script then put each figure in whole, as a paste does, and went on)`);
      }
      const form = await p.evaluate(() => ({
        rows: [...document.querySelectorAll('.replayer-player-row')].map((r) => { const pos = r.querySelector('.replayer-player-pos'); return { pos: (pos?.textContent || '').trim(), hero: !!pos?.classList.contains('hero'),
          name: r.querySelector('input[placeholder="Name"]')?.value || '', stack: r.querySelector('.gto-stack-wrap input')?.value || '' }; }),
        fields: [...document.querySelectorAll('.gto-blinds-grid .replayer-field')].map((f) => ({ label: (f.querySelector('label')?.textContent || '').trim(), value: (f.querySelector('input,select') || {}).value })),
      }));
      const names = form.rows.map((r) => r.name);
      const who = (i) => `${names[i]} (${h.players[i].name}, ${h.players[i].position})`;
      if (new Set(names).size !== m.n) throw new Error('the seats do not have distinct names: ' + names.join(', '));
      form.rows.forEach((r, i) => { if (Math.abs((Number(r.stack) || 0) - m.start[i] / U) > 1e-9) throw new Error(`seat ${i + 1} stack reads ${r.stack}, typed ${show(m.start[i])}`); });
      if (form.rows.findIndex((r) => r.hero) !== h.heroIdx) throw new Error('the hero is not on the corpus seat');
      for (const [label, units] of need) { const f = form.fields.find((x) => x.label === label); if (f && Math.abs((Number(f.value) || 0) - units / U) > 1e-9) throw new Error(`${label} reads "${f.value}" before Next, typed ${show(units)}`); }
      if (family === 'stud') { if (form.rows.some((r) => /BTN|SB|BB|UTG|CO|HJ|LJ|MP/.test(r.pos))) res.findings.push({ sev: 'note', cause: "stud seats carry hold'em position names", at: 'setup', detail: form.rows.map((r) => r.pos).join(' ') }); }
      else form.rows.forEach((r, i) => { if (r.pos !== h.players[i].position) res.findings.push({ sev: 'note', cause: 'a seat has another position name', at: 'setup', detail: `row ${i + 1} reads ${r.pos}, the corpus ${h.players[i].position}` }); });
      trace(`setup ${rec.mode} ${m.n} seats, hero row ${h.heroIdx + 1}; ${form.fields.map((f) => f.label + '=' + f.value).join(' ')}; ${form.rows.map((r) => `${r.pos}:${r.name}:${r.stack}`).join(' ')}`);
      await tap(p.locator('.gto-btn-row button.btn-primary:visible').filter({ hasText: 'Next' }).first(), 'Next');

      // ── the hand ──
      const heroCards0 = cardsOf(h.streets[0].cards.hero);
      const oppCards = (i, si) => cardsOf(((h.streets[si] || {}).cards || {}).opponents?.[slotOf(i, h.heroIdx)]);
      const everyCard = new Set(h.streets.flatMap((st) => [...cardsOf(st.cards.hero), ...cardsOf(st.cards.board), ...(st.cards.opponents || []).flatMap(cardsOf),
        ...(st.draws || []).flatMap((d) => [...cardsOf(d.discardedCards), ...cardsOf(d.newCards)])]));
      const spare = () => { for (const r of '23456789TJQKA') for (const su of 'cdhs') if (!everyCard.has(r + su)) { everyCard.add(r + su); return r + su; } return null; };
      const liveNow = new Array(m.n).fill(true);
      let heroIn = false, potFlagged = false;
      const wrongScreen = async (s, at, want, expected) => {
        const cause = s.phase === 'action' ? 'the betting round did not close when the corpus\'s did'
          : want === 'action' ? 'the betting round closed while the corpus has a player still to act' : `the screen is not on ${SCREEN[want]}`;
        const here = s.phase === 'action' ? `${s.active.name} to act on ${s.street} [${s.active.labels.join(', ')}]` : `${SCREEN[s.phase]}${s.titles.length ? ' ("' + s.titles.join('", "') + '")' : ''}${s.labels.length ? ' ("' + s.labels.join('", "') + '")' : ''}`;
        await stop(s.stuck && s.phase === 'wait' ? 'driver' : 'fail', s.stuck && s.phase === 'wait' ? 'the screen never settled' : cause, at, `the corpus: ${expected}; the screen: ${here}`);
      };

      for (const ev of m.events) {
        const at = ev.type === 'act' ? `s${ev.street}a${ev.index}` : (ev.type === 'third' ? 's0' : ev.type === 'result' || ev.type === 'showdown' ? ev.type : `s${ev.street} ${ev.type}`);
        res.reached = at;
        let s = await settle();

        if (ev.type === 'third') {                        // stud: the hero's three cards, then every door card
          if (s.phase !== 'hero_cards') await wrongScreen(s, at, 'hero_cards', "the hero's first three cards");
          if (heroCards0.length !== 3) throw new Error('the corpus hero does not have three cards on 3rd street');
          await pickAll(heroCards0, '', at, "the hero's 3rd street");
          await tap(primary('Enter Door Cards'), 'Enter Door Cards');
          s = await settle(s.sig);
          if (s.phase !== 'doors') await wrongScreen(s, at, 'doors', 'the opponents\' door cards');
          for (let i = 0; i < m.n; i++) {
            if (i === h.heroIdx) continue;
            const door = oppCards(i, 0).slice(-1);
            if (!door.length) throw new Error(`the corpus has no door card for ${h.players[i].name}`);
            await pickAll(door, '', at, `the door card of ${who(i)}`);
          }
          heroIn = true;
          await tap(primary('Start Action'), 'Start Action');
          continue;
        }

        if (ev.type === 'act') {
          const need = `${who(ev.player)} to act on ${STREETS[family][ev.street]}: ${ev.action}${ev.amount ? ' ' + show(ev.amount) : ''}`;
          if (s.phase !== 'action') await wrongScreen(s, at, 'action', need);
          if (s.street && s.street !== STREETS[family][ev.street]) await stop('fail', 'the betting is on another street', at, `the corpus: ${need}; the screen: ${s.active.name} to act on ${s.street}`);
          if (s.active.name !== names[ev.player]) await stop('fail', 'another seat is asked to act', at, `the corpus: ${need}; the screen asks ${s.active.name} (${(h.players[names.indexOf(s.active.name)] || {}).position || '?'}) [${s.active.labels.join(', ')}]`);
          if (!potFlagged && !same(num(s.pot), ev.pot)) { potFlagged = true; await find('fail', 'the pot shown is not the pot', at, `pot ${show(ev.pot)} before ${need}; the screen shows ${s.pot}`); }
          if (!same(num(s.active.stack), ev.stackBefore)) await find('fail', 'a stack shown is not the stack', at, `${who(ev.player)} has ${show(ev.stackBefore)} behind; the screen shows ${s.active.stack}`);
          if (ev.player === h.heroIdx && s.active.picker && family !== 'stud') {
            await pickAll(heroCards0, '.gto-seat.active .gto-hero-picker', at, "the hero's cards");
            heroIn = true;
            s = await settle();
            if (s.phase !== 'action' || s.active.name !== names[ev.player]) await stop('fail', 'entering the hero\'s cards moved the action', at, `after the hero's cards the screen is on ${SCREEN[s.phase]}${s.active ? ', ' + s.active.name + ' to act' : ''}`);
          }
          const labels = s.active.labels;
          const o = { other: [] };
          for (const l of labels) {
            let x;
            if (/^Fold$/.test(l)) o.fold = true;
            else if (/^Check$/.test(l)) o.check = true;
            else if ((x = /^Call (.+)$/.exec(l))) o.call = num(x[1]);
            else if ((x = /^Bring In (.+)$/.exec(l))) o.bringin = num(x[1]);
            else if ((x = /^Complete (.+)$/.exec(l))) o.complete = num(x[1]);
            // Stud high with an open pair on 4th street offers two: "Bet <small>" and "Bet <big>".
            else if ((x = /^Bet (.+)$/.exec(l))) { if (o.betX == null) o.betX = num(x[1]); (o.betXs = o.betXs || []).push({ v: num(x[1]), label: l }); }
            else if ((x = /^Raise to (.+)$/.exec(l))) o.raiseTo = num(x[1]);
            else if ((x = /^Pot (.+)$/.exec(l))) o.pot = num(x[1]);
            else if (/^Bet$/.test(l)) o.bet = true;
            else if (/^Raise$/.test(l)) o.raise = true;
            else if (/^All-in$/i.test(l)) o.allin = true;
            else o.other.push(l);
          }
          const offered = `[${labels.join(', ')}]`;
          const btn = (re) => p.locator('.gto-seat.active .gto-action-btn:visible').filter({ has: p.locator('.gto-action-label', { hasText: re }) }).first();
          trace(`${at} ${STREETS[family][ev.street]} pot ${s.pot} | ${s.active.name} ${s.active.stack} ${offered} | corpus ${ev.action} ${show(ev.amount)}${ev.to ? ' (to ' + show(ev.to) + ')' : ''} [${ev.kind}${ev.noRaise ? ', no raise: ' + ev.noRaise : ''}]`);

          // (c) nothing on offer that PokerKit refuses; a raise on offer where it allows one
          const raising = labels.filter((l) => /^(Bet|Raise|Pot|Complete|All-in)/i.test(l) && !(ev.noRaise === 'covered' && /^All-in$/i.test(l)));
          if (ev.kind !== 'bringin') {
            if (ev.halfBet) {
              // The two rule books part here, so neither answer is held against the screen.
              res.findings.push({ sev: 'note', cause: `limit, an all-in of half a bet or more: the TDA reopens the betting, PokerKit does not; the screen ${raising.length ? 'offers' : 'does not offer'} a raise`, at, detail: `${who(ev.player)} owes ${show(ev.owe)}; ${offered}` });
            } else if (ev.noRaise && raising.length) {
              const why = { covered: 'the player cannot cover the call', 'no-one-to-call': 'nobody else has chips to call a raise', cap: 'the limit round is capped (4 bets and raises are in)', 'not-reopened': 'the all-in they face was less than a full raise, so the betting is not reopened to them' }[ev.noRaise];
              await find('offer', { covered: 'a raise is offered to a player who cannot cover the call', 'no-one-to-call': 'a raise is offered with nobody left to call it', cap: 'a raise is offered past the cap',
                'not-reopened': 'a raise is offered over a short all-in that did not reopen the betting' }[ev.noRaise], at, `${who(ev.player)} owes ${show(ev.owe)} with ${show(ev.stackBefore)} behind: ${why}; the screen offers ${offered}`);
            } else if (!ev.noRaise && !raising.length) {
              await find(/^(bet|raise|complete)$/.test(ev.kind) ? 'fail' : 'offer', 'no raise is offered where one is allowed', at, `${who(ev.player)} may raise to ${show(ev.minTo)}${betting === 'fl' ? '' : ' or more'} (${ev.count} bets and raises in); the screen offers ${offered}`);
            }
          }
          if (ev.owe > 0 && o.check) await find('offer', 'a check is offered facing a bet', at, `${who(ev.player)} owes ${show(ev.owe)}; the screen offers ${offered}`);
          // the pot-limit ceiling, wherever it is shown
          if (betting === 'pl' && o.pot != null && !ev.noRaise) {
            const want = ev.oweFull === 0 ? Math.min(ev.potTo - ev.contribBefore, ev.stackBefore) : ev.potTo;
            if (!same(o.pot, want)) await find('offer', 'the pot-limit figure is not the pot', at,
              `${who(ev.player)}: a pot-sized ${ev.oweFull === 0 ? 'bet is ' + show(want) : 'raise is to ' + show(want)} (pot ${show(ev.pot)}, ${show(ev.oweFull)} to call, ${show(ev.stackBefore)} behind); the screen says "Pot ${o.pot}"`);
          }
          // the smallest raise, read off the amount box (opened only where it tells something)
          const minInc = Math.min(ev.minTo - ev.contribBefore, ev.stackBefore);
          const readMin = async () => {
            await tap(btn(/^(Bet|Raise)$/), 'Bet / Raise');
            const box = p.locator('.gto-seat.active .gto-raise-input-row input').first();
            await box.waitFor({ timeout: 2500 });
            await p.waitForTimeout(60);
            // the box takes the focus as it opens, which moves its figure into the placeholder until a key is pressed
            const raw = (await box.inputValue()) || (await box.getAttribute('placeholder')) || '';
            const v = Number(raw || NaN);
            if (/\.\d{3,}/.test(raw)) await find('offer', 'the amount box shows a figure with a long tail of decimals', at, `${who(ev.player)}: the box opens on "${raw}"`);
            if (!(Math.abs(v - minInc / U) <= 0.005)) await find('offer', 'the smallest raise shown is not the minimum', at,
              `${who(ev.player)}: the smallest ${ev.oweFull === 0 ? 'bet' : 'raise'} puts in ${show(minInc)} (to ${show(ev.minTo)}); the amount box opens on ${v}`);
            return box;
          };
          const typed = /^(bet|raise)$/.test(ev.kind) && betting !== 'fl';
          if (betting !== 'fl' && !typed && !ev.noRaise && ev.shortSeen && (o.bet || o.raise)) {
            await readMin();
            await tap(p.locator('.gto-seat.active .gto-raise-input-row button').filter({ hasText: 'Cancel' }).first(), 'Cancel');
            await p.waitForTimeout(60);
          }

          // (b) the corpus action, at its price
          const missing = async (what) => stop('fail', 'the corpus action is not on offer', at, `${need}: needs ${what}; the screen offers ${offered}`);
          const before = (await readScreen(p));
          const sig = JSON.stringify(before);
          if (ev.kind === 'fold') { if (!o.fold) await missing('"Fold"'); await tap(btn(/^Fold$/), 'Fold'); }
          else if (ev.kind === 'check') { if (!o.check) await missing('"Check"'); await tap(btn(/^Check$/), 'Check'); }
          else if (ev.kind === 'call') {
            if (ALLIN_BUTTON && o.allin && ev.amount === ev.stackBefore) { res.findings.push({ sev: 'note', cause: 'All-in pressed for an all-in call', at, detail: need }); await tap(btn(/^All-in$/i), 'All-in'); }
            else {
              if (o.call == null) await missing(`"Call ${show(ev.amount)}"`);
              if (!same(o.call, ev.amount)) await stop('fail', 'the call is not the price', at, `${need}; the screen says "Call ${o.call}" ${offered}`);
              await tap(btn(/^Call /), 'Call');
            }
          } else if (ev.kind === 'bringin') {
            if (o.bringin == null) await missing(`"Bring In ${show(ev.amount)}"`);
            if (!same(o.bringin, ev.amount)) await stop('fail', 'the bring-in is not the bring-in', at, `${need}; the screen says "Bring In ${o.bringin}"`);
            await tap(btn(/^Bring In /), 'Bring In');
          } else if (ev.kind === 'complete') {
            if (o.complete == null) await missing(`"Complete ${show(ev.to)}"`);
            if (!same(o.complete, ev.to)) await stop('fail', 'the completion is not the small bet', at, `${need} (to ${show(ev.to)}); the screen says "Complete ${o.complete}" ${offered}`);
            await tap(btn(/^Complete /), 'Complete');
          } else if (betting === 'fl') {
            // Stud, 4th street, a door card paired: the screen has only the big bet, the corpus bet the small one.
            const pair4 = family === 'stud' && ev.street === 1 && m.openPair4;
            const onlyBig = 'stud, an open pair on 4th street: only the big bet can be entered';
            if (ev.oweFull === 0) {
              if (o.betX == null) await missing(`"Bet ${show(ev.amount)}"`);
              const hit = (o.betXs || []).find((b) => same(b.v, ev.amount));
              if (!hit) await stop(pair4 ? 'cannot' : 'fail', pair4 ? onlyBig : 'the limit bet is not the bet size', at, `${need}; the screen says "Bet ${o.betX}" ${offered}`);
              await tap(btn(new RegExp('^' + hit.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')), 'Bet');
            } else {
              if (o.raiseTo == null) await missing(`"Raise to ${show(ev.to)}"`);
              if (!same(o.raiseTo, ev.to)) await stop(pair4 ? 'cannot' : 'fail', pair4 ? onlyBig : 'the limit raise is not the raise size', at, `${need} (to ${show(ev.to)}); the screen says "Raise to ${o.raiseTo}" ${offered}`);
              await tap(btn(/^Raise to /), 'Raise to');
            }
          } else if (betting === 'nl' && ev.isAllIn && o.allin) {
            await tap(btn(/^All-in$/i), 'All-in');
          } else if (betting === 'pl' && ev.potSized && o.pot != null && same(o.pot, ev.oweFull === 0 ? ev.amount : ev.to)) {
            await tap(btn(/^Pot /), 'Pot');
          } else {
            if (!o.bet && !o.raise) await missing(`"${ev.oweFull === 0 ? 'Bet' : 'Raise'}" and an amount of ${show(ev.amount)}`);
            const box = await readMin();
            // a click that cannot land in time (a busy machine: seen once in 500 hands) falls back to the focus
            await box.click({ timeout: 2500 }).catch(() => box.focus());
            if ((await box.inputValue()) !== '') await box.press('ControlOrMeta+a');
            await box.pressSequentially(show(ev.amount));
            const got = await box.inputValue();
            if (Math.abs(Number(got) - ev.amount / U) > 1e-9) {
              await find('cannot', 'a bet with cents cannot be typed', at, `${need}: typed "${show(ev.amount)}", the amount box reads "${got}"`);
              await box.fill(show(ev.amount));
            }
            await tap(p.locator('.gto-seat.active .gto-raise-input-row button.btn-primary').filter({ hasText: 'Confirm' }).first(), 'Confirm');
          }
          if (ev.kind === 'fold') liveNow[ev.player] = false;
          const after = await settle(sig, 3000);
          if (after.stuck && after.sig === sig) await stop('fail', 'a tap on the corpus action did nothing', at, `${need}; the screen still offers ${offered}`);
          // what went in is what the corpus put in
          const seat = after.phase === 'action' ? after.seats.find((x) => x.name === names[ev.player]) : null;
          if (seat && ev.kind !== 'fold' && !same(num(seat.stack), ev.stackAfter)) {
            await stop('fail', typed ? 'the amount entered was changed' : 'a button put in another amount', at,
              `${need}: ${who(ev.player)} should have ${show(ev.stackAfter)} behind; the screen shows ${seat.stack} (it took ${show(ev.stackBefore - Math.round(num(seat.stack) * U))} for ${show(ev.amount)})`);
          }
          continue;
        }

        if (ev.type === 'board') {
          if (s.phase !== 'board') await wrongScreen(s, at, 'board', `the ${STREETS.flop[ev.street]} is dealt (${ev.cards})`);
          const label = s.labels.find((l) => /^Deal the /.test(l)) || '';
          if (!new RegExp(STREETS.flop[ev.street] + '$', 'i').test(label)) await stop('fail', 'the board is on another street', at, `the corpus deals the ${STREETS.flop[ev.street]}; the screen says "${label}"`);
          await pickAll(cardsOf(ev.cards), '', at, `the ${STREETS.flop[ev.street]}`);
          const go = p.locator('.gto-btn-row button.btn-primary:visible').filter({ hasText: /^Continue$/ }).first();
          if (await go.isDisabled()) await stop('fail', 'the board will not continue', at, `the ${STREETS.flop[ev.street]} ${ev.cards} is in and Continue is still off`);
          await tap(go, 'Continue');
          await settle(s.sig, 2500);
          continue;
        }

        if (ev.type === 'deal') {                         // stud: one card to every player still in
          const name = STREETS.stud[ev.street];
          if (s.phase !== 'stud_deal') await wrongScreen(s, at, 'stud_deal', `${name} is dealt`);
          if (!s.titles.some((t) => t === 'Deal ' + name)) await stop('fail', 'the stud deal is on another street', at, `the corpus deals ${name}; the screen says "${s.titles.join('", "')}"`);
          const rowsNow = s.deal.map((r) => names.indexOf(r.name));
          const want = liveNow.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
          if (rowsNow.some((i) => i < 0) || rowsNow.slice().sort().join() !== want.slice().sort().join()) await stop('fail', 'the stud deal lists other players', at, `still in: ${want.map((i) => names[i]).join(', ')}; the screen deals to ${s.deal.map((r) => r.name).join(', ')}`);
          for (const i of rowsNow) {
            let card;
            if (i === h.heroIdx) card = cardsOf(h.streets[ev.street].cards.hero)[0];
            else {
              card = oppCards(i, ev.street)[0];
              if (!card && ev.street === 4 && oppCards(i, 0).length === 4) card = oppCards(i, 0)[0];
            }
            let made = false;
            if (!card) {
              if (ev.street !== 4) throw new Error(`the corpus has no ${name} card for ${h.players[i].name}`);
              // 7th street is dealt face down: an opponent's card nobody saw is left blank, as a player
              // would. The screen needs only the hero's; Continue is checked below.
              continue;
            }
            const line = p.locator('.gto-deal-row:visible').filter({ has: p.locator(`.gto-deal-name:text-is("${names[i]}")`) }).first();
            await tap(line, 'deal row');
            await p.waitForTimeout(30);
            await pickAll([card], '', at, `${name} for ${who(i)}`);
            if (made) await find('cannot', 'a face-down 7th-street card nobody saw has to be given', at, `${who(i)} is dealt 7th street face down and never shows; Continue stays off until a card is chosen (the script gave ${card})`);
          }
          const go = p.locator('.gto-btn-row button.btn-primary:visible').filter({ hasText: /^Continue$/ }).first();
          if (await go.isDisabled()) await stop('fail', 'the stud deal will not continue', at, `${name}: every card is in and Continue is still off`);
          await tap(go, 'Continue');
          await settle(s.sig, 2500);
          continue;
        }

        if (ev.type === 'draw') {
          const name = STREETS[family][ev.street + 1];
          if (s.phase !== 'draw') await wrongScreen(s, at, 'draw', `the draw before ${name} (${ev.draws.map((d) => names[d.player] + ' ' + d.discarded).join(', ')})`);
          const order = [];
          for (let guard = 0; guard < 12; guard++) {
            const d = await p.evaluate(() => {
              const a = [...document.querySelectorAll('.gto-seat.active')].find((el) => el.querySelector('.gto-draw-buttons') && el.getBoundingClientRect().height > 0);
              return a ? { name: (a.querySelector('.gto-seat-name')?.textContent || '').trim(), buttons: [...a.querySelectorAll('.gto-draw-btn')].map((x) => x.textContent.trim()) } : null;
            });
            if (!d) break;
            const pi = names.indexOf(d.name);
            const mine = ev.draws.find((x) => x.player === pi);
            if (!mine) await stop('fail', 'the draw asks a player who is not drawing', at, `the screen asks ${d.name}; the corpus draws ${ev.draws.map((x) => names[x.player] + ' ' + x.discarded).join(', ')}`);
            if (order.includes(pi)) throw new Error('the draw asked ' + d.name + ' twice');
            order.push(pi);
            const seat = p.locator('.gto-seat.active:visible').filter({ has: p.locator('.gto-draw-buttons') }).first();
            const b = mine.discarded === 0 ? seat.locator('.gto-draw-btn.pat').first() : seat.locator('.gto-draw-btn').filter({ hasText: new RegExp('^\\s*' + mine.discarded + '\\s*$') }).first();
            if (!(await b.count())) await stop('cannot', 'a draw the screen does not offer', at, `${who(pi)} draws ${mine.discarded}; the screen offers ${d.buttons.join(', ')}`);
            await tap(b, 'draw ' + mine.discarded);
            await p.waitForTimeout(70);
          }
          const missed = ev.draws.filter((x) => !order.includes(x.player));
          if (missed.length) await stop('fail', 'the draw skips a player', at, `the screen never asked ${missed.map((x) => names[x.player]).join(', ')}; it asked ${order.map((i) => names[i]).join(', ')}`);
          if (order.join() !== ev.draws.map((x) => x.player).join()) res.findings.push({ sev: 'note', cause: 'the draw is declared in another order', at, detail: `the screen: ${order.map((i) => names[i]).join(', ')}; the corpus: ${ev.draws.map((x) => names[x.player]).join(', ')}` });
          const go = p.locator('.gto-btn-row button.btn-primary:visible').first();
          if (await go.isDisabled()) await stop('fail', 'the draw will not continue', at, 'every player has declared and the button is still off');
          const sigDraw = (await readScreen(p));
          await tap(go, 'Continue / Enter Cards');
          s = await settle(JSON.stringify(sigDraw), 2500);
          const hd = ev.draws.find((x) => x.player === h.heroIdx);
          if (s.phase === 'draw_cards') {
            if (hd && hd.discarded > 0) {
              const box = p.locator('.gto-dce-box:visible').filter({ has: p.locator('.gto-dce-hand') }).first();
              for (const cd of cardsOf(hd.discardedCards)) {
                const img = box.locator(`.gto-dce-hand img[alt="${cd}"]`).first();
                if (!(await img.count())) await stop('fail', "the hero's hand at the draw is not the hand held", at, `the hero discards ${hd.discardedCards}; ${cd} is not among the cards shown`);
                await tap(img, 'discard ' + cd);
                await p.waitForTimeout(30);
              }
              const field = box.locator('.gto-dce-fields .replayer-field').nth(1).locator('input').first();
              await field.click();
              await field.press('ControlOrMeta+a');
              await field.pressSequentially(cardsOf(hd.newCards).join(''));
              await p.waitForTimeout(60);
              const got = cardsOf(await field.inputValue()).join('');
              if (got !== cardsOf(hd.newCards).join('')) {
                const msg = await p.locator('.replayer-field-error:visible').allTextContents();
                await find('cannot', 'a card the screen will not take', at, `the hero draws ${hd.newCards}; the field reads "${got}"${msg.length ? ' ("' + msg.join('; ') + '")' : ''}`);
              }
            }
            await tap(p.locator('.gto-btn-row button.btn-primary:visible').filter({ hasText: 'Continue' }).first(), 'Continue');
            await settle(s.sig, 2500);
          } else if (hd && hd.discarded > 0 && heroIn) {
            await find('fail', "the hero's draw cards are not asked for", at, `the hero draws ${hd.discarded} (${hd.discardedCards} for ${hd.newCards}); after the draw the screen is on ${SCREEN[s.phase]}`);
          }
          if (ev.draws.some((x) => x.player !== h.heroIdx && (x.discardedCards || x.newCards))) res.findings.push({ sev: 'note', cause: "an opponent's discards and new cards have no place on the entry screens", at, detail: '' });
          continue;
        }

        if (ev.type === 'showdown') {
          if (s.phase !== 'showdown') await wrongScreen(s, at, 'showdown', `showdown between ${ev.live.map((i) => names[i]).join(', ')}`);
          const wantOpp = ev.live.filter((i) => i !== h.heroIdx).map((i) => names[i]);
          const have = s.sd.map((x) => x.name);
          if (have.slice().sort().join() !== wantOpp.slice().sort().join()) await stop('fail', 'the showdown lists other players', at, `still in: ${wantOpp.join(', ')}; the screen shows ${have.join(', ') || 'nobody'}`);
          for (const i of ev.live) {
            if (i === h.heroIdx) continue;
            let known;
            if (family === 'stud') { const c0 = oppCards(i, 0); known = c0.length === 4 ? [c0[1], c0[2], c0[0]] : c0.length === 3 ? [c0[0], c0[1], ...oppCards(i, 4)] : []; }
            else known = oppCards(i, 0);
            const card = p.locator('.gto-phase-card:visible').filter({ has: p.locator(`.gto-sd-name:text-is("${names[i]}")`) }).first();
            if (!known.length) {
              await tap(card.locator('.gto-undo-btn').filter({ hasText: /^Muck$/ }).first(), 'Muck');
              res.findings.push({ sev: 'note', cause: 'a hand the corpus does not show was mucked', at, detail: who(i) });
              continue;
            }
            for (const cd of known) {
              const b = card.locator(`.card-picker-btn:has(img[alt="${cd}"])`).first();
              if (!(await b.count())) continue;                   // the picker closes once the hand is whole
              const st = await b.evaluate((el) => ({ off: el.disabled, cls: el.className }));
              if (/\bselected\b/.test(st.cls)) continue;
              if (st.off || /\bused\b/.test(st.cls)) await stop('cannot', 'a card the screen will not take', at, `${who(i)} shows ${known.join('')}; ${cd} is greyed out as already used`);
              await tap(b, 'card ' + cd);
              await p.waitForTimeout(35);
            }
          }
          const sdNow = await readScreen(p);
          await tap(primary('Continue'), 'Continue');
          await settle(JSON.stringify(sdNow), 3000);
          continue;
        }

        if (ev.type === 'result') {
          if (s.phase !== 'result') await wrongScreen(s, at, 'result', `the hand is over (${ev.live.map((i) => names[i]).join(', ')} left)`);
          const corpusWin = ev.winners.map((x) => names[x.playerIdx]).sort();
          let uiWin;
          if (s.auto) uiWin = [s.auto.replace(/\s+wins?$/i, '')];
          else uiWin = s.winners.filter((t) => /\((Win|Split)\)/.test(t)).map((t) => t.replace(/\s*\((Win|Split)\)\s*$/, '')).sort();
          trace(`result: screen ${s.auto ? '"' + s.auto + '"' : '[' + s.winners.join(' | ') + ']'}; corpus winners ${ev.winners.map((x) => names[x.playerIdx] + (x.split ? ' (split)' : '')).join(', ')}`);
          res.uiWinners = uiWin; res.corpusWinners = corpusWin;
          if (!s.auto && !uiWin.length && s.winners.length) {
            // "Auto-evaluated" with nobody marked: the screen did pick a winner, one who is not on it. Only the
            // players still in are listed, so it picked a player who folded.
            const evaluated = await p.getByText(/Auto-evaluated|Worked out from the cards/).count();
            if (evaluated) await find('fail', 'the Result screen marks no winner: the hand it scored best is a folded player\'s', at, `the screen says "Auto-evaluated" over [${s.winners.join(' | ')}], none marked${m.folded[h.heroIdx] ? '; the hero folded' : ''}; the corpus pays ${corpusWin.join(', ')}`);
            for (const x of ev.winners) {
              const b = p.locator('.gto-winner-btn:visible').filter({ hasText: new RegExp('^\\s*' + names[x.playerIdx].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(\\(|$)') }).first();
              if (await b.count()) await tap(b, 'winner');   // a second player tapped makes it a split
            }
            res.findings.push({ sev: 'note', cause: 'the Result screen named no winner; the corpus winners were tapped', at, detail: corpusWin.join(', ') });
          } else if (uiWin.join('|') !== corpusWin.join('|')) res.winnersDiffer = `the Result screen says ${uiWin.join(', ') || 'nobody'}; the corpus ${corpusWin.join(', ')}`;
          // The corpus lists every seat that is paid anything, a side pot included; the screen marks the best
          // hand. Fewer names is that difference. A name the corpus pays nothing is a wrong winner.
          const unpaid = uiWin.filter((x) => !corpusWin.includes(x));
          if (unpaid.length) await find('fail', 'the Result screen names a winner who is paid nothing', at, `the screen marks ${uiWin.join(', ')}; the corpus pays ${corpusWin.join(', ')}`);
          await shot('result');
          await tap(primary('Save & Replay'), 'Save & Replay');
          await p.waitForSelector('button[title="End"], :text("Error loading replay")', { timeout: 10000 });
          res.reached = 'replay';
        }
      }

      // ── the replay, and the hand as saved ──
      const bad = await p.locator(':text("Error loading replay")').count();
      if (bad) await stop('fail', 'the saved hand does not replay', 'replay', (await p.locator(':text("Error loading replay")').first().locator('..').innerText()).split('\n').slice(0, 2).join(': '));
      // The replay opens on its deal, and a press made during it is lost: press End until the hand is over.
      for (let t = 0; t < 6; t++) {
        await p.waitForTimeout(t ? 800 : 400);
        await p.locator('button[title="End"]').first().click({ force: true });
        await p.waitForTimeout(700);
        if (await p.locator('button[title="Forward"]').first().isDisabled().catch(() => false)) break;
      }
      await p.waitForTimeout(900);
      const felt = await readSeats(p);
      await shot('replay-end');
      const off = [];
      h.players.forEach((pl, i) => {
        const want = rec.expected[pl.name];
        const seat = felt.find((x) => x.name === names[i]) || felt.find((x) => x.seat === i);
        if (!seat) { off.push(`${names[i]} is not on the felt`); return; }
        const haveNow = /all-?in/i.test(seat.text) ? 0 : num(seat.text);
        if (!(AS_SHOWN ? Math.abs(haveNow - want) <= Math.max(0.5, want * 0.06) : Math.abs(haveNow - want) <= 0.005)) off.push(`${names[i]} (${pl.name}) ends on "${seat.text}", the corpus ${want}`);
      });
      res.chips = off.length === 0;
      const got = await api('/api/replayer/hands', { token });
      const saved = Array.isArray(got.body) ? got.body.find((x) => x.title === title) : null;
      const diffs = saved ? diffSaved(rec, m, saved, names) : [{ kind: 'fail', what: 'the hand is not among the saved hands' }];
      if (saved) res.saved = saved.id;
      if (off.length) await find('fail', 'the saved hand replays to other stacks', 'replay', off.join('; ') + (res.winnersDiffer ? '; ' + res.winnersDiffer : '') + (diffs.length ? '; saved differs: ' + diffs.map((d) => d.what).slice(0, 4).join(' | ') : ''));
      else if (res.winnersDiffer) res.findings.push({ sev: 'note', cause: 'the Result screen marks fewer winners than are paid (a side pot, or half a pot); the chips are right', at: 'result', detail: res.winnersDiffer });
      for (const d of diffs) {
        if (d.kind === 'fail') await find('fail', d.cause || 'the saved hand is not the hand entered', 'saved', d.what);
        else res.findings.push({ sev: 'note', cause: 'saved hand: ' + d.kind, at: 'saved', detail: d.what });
      }
      if (saved) await api('/api/replayer/hands/' + saved.id, { method: 'DELETE', token });
      res.reached = 'end';
    } catch (e) {
      if (!(e instanceof Stop)) {
        const s = await readScreen(p).catch(() => null);
        await find('driver', 'the script lost its place', res.reached, `${String(e.message).split('\n')[0]}${s ? ' (on ' + SCREEN[s.phase] + ')' : ''}`);
      }
      await shot('stopped-' + res.reached);
    }
    return res;
  }

  while (next < hands.length && !serverDied) {
    const x = hands[next++];
    const before = errs.length;
    const res = await enter(x);
    if (errs.length > before) res.findings.push({ sev: 'fail', cause: 'the page threw an error', at: res.reached, detail: [...new Set(errs.slice(before))].join(' | ') });
    results.push(res);
    const hard = res.findings.filter((f) => f.sev !== 'note');
    if (hard.length) console.log(`${hard.some((f) => f.sev === 'fail' || f.sev === 'driver') ? 'FAIL' : 'FIND'} ${res.id} (${res.n} seats, ${res.mode}; ${res.flags.join(',') || 'plain'})\n       - ${hard.map((f) => `${f.sev} @${f.at}: ${f.cause}: ${f.detail}`).join('\n       - ')}`);
    else if (TRACE) console.log(` ok  ${res.id}`);
    if (results.length % 25 === 0) console.log(`  … ${results.length}/${hands.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  await ctx.close();
}

// The saved hand against the corpus hand, field by field. 'fail' = the table itself differs (it cannot replay
// to the same chips); every other kind is a difference of representation, listed as a note.
function diffSaved(rec, m, saved, names) {
  const h = rec.hand, out = [];
  const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
  const add = (kind, what) => out.push({ kind, what });
  if (saved.gameType !== h.gameType) add('fail', `game ${saved.gameType}, the corpus ${h.gameType}`);
  if ((saved.gameMode || '') !== (h.gameMode || '')) add('the mode', `mode ${saved.gameMode}, the corpus ${h.gameMode}`);
  const sb = saved.blinds || {}, cb = h.blinds || {};
  for (const k of ['sb', 'bb', 'ante', 'bigBet', 'bringIn']) {
    if (cb[k] == null && !sb[k]) continue;
    if (k === 'sb' && m.family === 'stud') { if (sb[k]) add('a stud hand is saved with a small blind', `sb ${sb[k]} (no seat posts it)`); continue; }
    if (k === 'bigBet' && sb[k] == null && near(cb[k], (cb.bb || 0) * 2)) continue;
    if (!near(sb[k], cb[k])) add('fail', `${k} ${sb[k]}, the corpus ${cb[k]}`);
  }
  if ((saved.players || []).length !== h.players.length) add('fail', `${(saved.players || []).length} players, the corpus ${h.players.length}`);
  else h.players.forEach((pl, i) => { if (!near(saved.players[i].startingStack, pl.startingStack)) add('fail', `${names[i]} starts with ${saved.players[i].startingStack}, the corpus ${pl.startingStack}`); });
  if (saved.heroIdx !== h.heroIdx) add('fail', `hero seat ${saved.heroIdx}, the corpus ${h.heroIdx}`);
  const setOf = (s) => cardsOf(s).slice().sort().join('');
  const whole = (hand, i) => hand.streets.map((st) => (i === hand.heroIdx ? st.cards.hero : (st.cards.opponents || [])[slotOf(i, hand.heroIdx)]) || '').join('');
  const verbs = new Set();
  h.streets.forEach((st, si) => {
    const sv = (saved.streets || [])[si] || { cards: {}, actions: [], draws: [] };
    const ca = st.actions || [], sa = sv.actions || [];
    if (ca.length !== sa.length) add('actions', `street ${si}: ${sa.length} actions saved, the corpus ${ca.length}`);
    else ca.forEach((a, ai) => {
      const x = sa[ai];
      if (x.player !== a.player || !near(x.amount, a.amount)) add('actions', `s${si}a${ai}: saved ${names[x.player]} ${x.action} ${x.amount || 0}, the corpus ${names[a.player]} ${a.action} ${a.amount || 0}`);
      else if (x.action !== a.action) verbs.add(`${a.action} saved as ${x.action}`);
    });
    if (setOf((sv.cards || {}).board) !== setOf(st.cards.board)) add('cards', `street ${si} board: saved "${(sv.cards || {}).board || ''}", the corpus "${st.cards.board || ''}"`);
    const cd = st.draws || [], sd = sv.draws || [];
    for (const d of cd) {
      const x = sd.find((y) => y.player === d.player);
      if (!x) { add('draws', `street ${si}: no draw saved for ${names[d.player]} (the corpus: ${d.discarded})`); continue; }
      if ((x.discarded || 0) !== (d.discarded || 0)) add('draws', `street ${si}: ${names[d.player]} draws ${x.discarded}, the corpus ${d.discarded}`);
      else if (d.player === h.heroIdx && (setOf(x.discardedCards) !== setOf(d.discardedCards) || setOf(x.newCards) !== setOf(d.newCards))) add('draws', `street ${si}: the hero's draw saved as ${x.discardedCards || '-'} for ${x.newCards || '-'}, the corpus ${d.discardedCards || '-'} for ${d.newCards || '-'}`);
      else if (d.player !== h.heroIdx && (d.discardedCards || d.newCards) && setOf(x.newCards) !== setOf(d.newCards)) add("an opponent's draw cards are not saved", `street ${si}: ${names[d.player]}`);
    }
    for (const x of sd) if (!cd.find((d) => d.player === x.player)) add('draws', `street ${si}: a draw saved for ${names[x.player]} that the corpus does not have`);
  });
  if (verbs.size) add('another verb for the same chips', [...verbs].join('; '));
  h.players.forEach((pl, i) => {
    const want = setOf(whole(h, i)), have = setOf(whole(saved, i));
    if (want === have) return;
    if (m.folded[i] && i !== h.heroIdx && cardsOf(whole(saved, i)).every((cd) => want.includes(cd))) add("a folded opponent's cards are not saved", `${names[i]}: the corpus knows ${cardsOf(whole(h, i)).length} cards, ${cardsOf(whole(saved, i)).length} are saved`);
    else add('cards', `${names[i]}: saved "${whole(saved, i)}", the corpus "${whole(h, i)}"`);
  });
  const cw = ((h.result || {}).winners || []).map((x) => x.playerIdx + (x.split ? 's' : '')).sort().join(',');
  const sw = ((saved.result || {}).winners || []).map((x) => x.playerIdx + (x.split ? 's' : '')).sort().join(',');
  const gone = ((saved.result || {}).winners || []).filter((x) => m.folded[x.playerIdx]).map((x) => names[x.playerIdx]);
  if (gone.length) out.push({ kind: 'fail', cause: 'a player who folded is saved as a winner', what: `${gone.join(', ')} folded; saved winners [${sw}], the corpus [${cw}]` });
  else if (cw !== sw) add('the winners list', `saved [${sw}], the corpus [${cw}]`);
  return out;
}

try {
  await Promise.all(Array.from({ length: Math.min(JOBS, hands.length) }, (_, w) => worker(w)));
} finally {
  await browser.close().catch(() => {});
  await srv.stop();
  scratch.cleanup();
}

// ── What was found ──────────────────────────────────────────────────────────────────────────────────────
const order = { fail: 0, cannot: 1, offer: 2, driver: 3, note: 4 };
const group = (rs, sevs) => {
  const g = new Map();
  for (const r of rs) for (const f of r.findings) {
    if (!sevs.includes(f.sev)) continue;
    const k = f.sev + '|' + f.cause;
    const e = g.get(k) || { sev: f.sev, cause: f.cause, ids: new Set(), first: null };
    e.ids.add(r.id);
    if (!e.first) e.first = `${r.id}@${f.at}: ${f.detail}`;
    g.set(k, e);
  }
  return [...g.values()].sort((a, b) => order[a.sev] - order[b.sev] || b.ids.size - a.ids.size);
};
const HARD = ['fail', 'cannot', 'offer', 'driver'];
const clean = (r) => !r.findings.some((f) => HARD.includes(f.sev));
console.log('');
for (const g of [...new Set(hands.map((x) => x.rec.game))]) {
  const rs = results.filter((r) => r.game === g);
  const ok = rs.filter(clean).length;
  if (ok === rs.length) { console.log(` ok  ${g.padEnd(10)} ${ok}/${rs.length}`); continue; }
  console.log(`FAIL ${g.padEnd(10)} ${ok}/${rs.length} entered clean; ${rs.filter((r) => r.chips).length}/${rs.length} saved and replayed to the corpus's stacks`);
  for (const e of group(rs, HARD)) console.log(`       ${e.sev.padEnd(6)} ${String(e.ids.size).padStart(3)}  ${e.cause}\n                   ${e.first}`);
}
const notes = group(results, ['note']);
if (notes.length) { console.log('\nnotes (representation; they fail nothing):'); for (const e of notes) console.log(`  ${String(e.ids.size).padStart(4)}  ${e.cause}${e.first && TRACE ? '  e.g. ' + e.first : ''}`); }
const allHard = group(results, HARD);
if (allHard.length) { console.log('\nevery cause, all games:'); for (const e of allHard) console.log(`  ${e.sev.padEnd(6)} ${String(e.ids.size).padStart(4)}  ${e.cause}   (${[...e.ids].slice(0, 6).join(', ')}${e.ids.size > 6 ? ', …' : ''})`); }
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ corpus: CORPUS, per: PER, results }, null, 1));
const bad = results.filter((r) => !clean(r)).length;
if (serverDied) console.log('the scratch server died during the run');
console.log(`\n${results.length - bad} of ${results.length} hands entered clean; ${results.filter((r) => r.chips).length} saved and replayed to the corpus's stacks${serverDied || results.length < hands.length ? ' (INCOMPLETE)' : ''}`);
process.exit(bad || serverDied || results.length < hands.length ? 1 : 0);
