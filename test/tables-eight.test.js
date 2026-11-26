'use strict';
/*
 * Eight players at once (owner, 2026-11-26: "we want 8 players to be able to play at once"): a scratch scheduler
 * (ports 4970-4974) and the tables service (4975-4979), eight ORDINARY accounts (no admin among them) at one table,
 * each a client of the real routes with its own SSE stream, playing random legal moves on the service's own random
 * deals: raising, folding, going all in, busting and buying in again, sitting out and back in, leaving and coming
 * back, sitting into a game going and posting to come in, dropping its stream and reopening it, chatting, and now
 * and then letting the clock run out. What it holds, on every event or at the end:
 *
 *   - nothing stalls: a hand never waits longer than the clock allows, and a table with two players deals;
 *   - privacy: no event carries a card its viewer has not seen (an opponent's before it is shown, the board
 *     before it is dealt), nor the dealer's own state (holes, stub, muck, deck);
 *   - agreement: every viewer sees the same seats, stacks, pot, board and turn at the same table version;
 *   - chips within a hand: the stacks and the pot always add up to the stacks the hand started with;
 *   - chips in all: once everyone has left, the balances are 8 x 20,000 again, and each is its journal's sum;
 *   - Hands: every hand is saved once to every player dealt in, and the saved copies' nets (the export's own
 *     settlement) add up to 0;
 *   - neither server logs an error.
 *
 *   npm run test:tables-eight                         (NLH, 9 seats, 120 hands)
 *   node test/tables-eight.test.js --game PLO --hands 300 --players 8 --seats 9
 *   node test/tables-eight.test.js --sng          (a sit and go, played to a winner: the places and prizes held too)
 */
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const { pathToFileURL } = require('url');
const { createScratch, boot, freePort, scrubbedEnv, ROOT, runner, rowsOf } = require('./helpers/scratch-server');

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const GAME = arg('game', 'NLH');
const HANDS = Number(arg('hands', 120));
const PLAYERS = Number(arg('players', 8));
const SEATS = Number(arg('seats', 9));
const SEED = Number(arg('seed', Date.now() % 1e9));
const SECRET = 'tables-eight-secret-0123456789abcdef0123456789';
const JWT_SECRET = 'backer-surface-test-secret-not-for-prod';
const DECISION = 10, BANK = 5, GAP = 150;     // the clock (s, the least the scheduler takes) and the gap between hands (ms)
const BUY = { min: 2000, max: 10000 };
const START = 1000000;                        // each account's opening balance (TABLES_CHIPS_START), so nobody runs out
const VERBOSE = process.argv.includes('--verbose');
// --sng: a sit and go instead (owner, 2026-11-26): a 1,000 buy-in, 3,000 chips, one-minute levels, played to a winner.
const SNG = process.argv.includes('--sng');
const SNG_CFG = { buyIn: 1000, stack: 3000, levelMins: 1 };
const STALL = 1 / 80;                         // a turn left to the clock
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The bots' choices only (the deals are the service's own CSPRNG): a seeded generator, so a run's choices can be had again.
let seed = SEED >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (list) => list[Math.floor(rnd() * list.length)];

function bootTables(port, schedulerPort, dataDir) {
  const env = scrubbedEnv({
    PORT: String(port), TABLES_SECRET: SECRET, TABLES_SCHEDULER_URL: `http://127.0.0.1:${schedulerPort}`,
    TABLES_DATA_DIR: dataDir, TABLES_HAND_GAP_MS: String(GAP),
  });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'tables', 'server.mjs')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('tables did not start\n' + log)); }, 20000);
    const on = (b) => { log += b.toString(); if (log.includes(`Tables running on port ${port}`)) { clearTimeout(timer); resolve({ child, log: () => log, stop: () => new Promise((r) => { if (child.exitCode != null || child.signalCode != null) return r(); child.removeAllListeners('exit'); child.on('exit', () => r()); child.kill(); }) }); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`tables exited ${code}\n${log}`)); });
  });
}

/* An SSE stream: each 'view' event parsed and handed on with its raw text. */
function openStream(url, onView) {
  const ctl = new AbortController();
  const done = (async () => {
    let r;
    try { r = await fetch(url, { signal: ctl.signal }); } catch (_) { return; }
    if (!r.ok) return;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done: end } = await reader.read().catch(() => ({ done: true }));
      if (end) return;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, k); buf = buf.slice(k + 2);
        const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
        if (data) onView(JSON.parse(data), data);
      }
    }
  })();
  return { close: () => ctl.abort(), done };
}

(async () => {
  const t = runner(`tables-eight (${SNG ? 'sit and go, ' : ''}${GAME}, ${PLAYERS} players, ${SEATS} seats, seed ${SEED})`);
  const scratch = await createScratch({ ports: [4970, 4974], prefix: 'fg-tables-eight-' });
  const db0 = scratch.open();
  const people = Array.from({ length: PLAYERS }, (_, i) => ({ id: 301 + i, name: `Player${i + 1}` }));
  for (const p of people) db0.run('INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)', [p.id, p.name.toLowerCase(), `${p.name.toLowerCase()}@eight.test`, 'x']);
  scratch.save(db0);
  db0.close();

  const tport = await freePort([4975, 4979]);
  const srv = await boot(scratch.dbPath, { TABLES: '1', TABLES_URL: `http://127.0.0.1:${tport}`, TABLES_SECRET: SECRET, TABLES_CHIPS_START: String(START) }, { ports: [4970, 4974] });
  const dataDir = path.join(scratch.tmp, 'tables-data');
  const tables = await bootTables(tport, srv.port, dataDir);
  const S = `http://127.0.0.1:${srv.port}`, T = `http://127.0.0.1:${tport}`;
  const call = async (base, method, p, body, bearer) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (_) { /* empty */ }
    return { status: r.status, body: j };
  };

  // ── What is held on every event ──
  const problems = [];
  const fail = (msg) => { if (problems.length < 40) problems.push(msg); };
  const prints = new Map();      // table version -> { fp, by }: what every viewer must agree on
  const seen = new Map();        // `${handNo}|${userId}` -> the cards that viewer was shown before the hand was over
  const holes = new Map();       // `${handNo}|${userId}` -> that player's own cards, from their own view
  const dealtIn = new Map();     // userId -> Set of hand numbers they were dealt into
  let lastVersion = 0, lastChange = Date.now();
  const stats = { acts: 0, stalls: 0, allIns: 0, folds: 0, raises: 0, leaves: 0, leftMidHand: 0, sitOuts: 0, reconnects: 0, rebuys: 0, sits: 0, posts: 0, chats: 0, broke: 0, refused: 0, most: 0, full: 0 };
  const cardsOf = (s) => String(s || '').match(/[2-9TJQKA][hdcs]/g) || [];

  let gapStart = Date.now(), gapWhy = '', longest = { ms: 0, why: '' }, handAt = Date.now(), handSeen = 0;
  function check(bot, v, raw) {
    const tv = v.table;
    if (tv.version > lastVersion) {
      const ms = Date.now() - gapStart;
      if (ms > longest.ms) longest = { ms, why: gapWhy };
      if (VERBOSE && ms > 1500) console.log(`       ${ms} ms quiet before v${tv.version}: ${gapWhy}`);
      lastVersion = tv.version; lastChange = gapStart = Date.now();
      const hv = v.hand;
      gapWhy = hv && !hv.live.over ? `hand ${hv.handNo}, ${hv.seatOf.length} in, seat ${hv.seatOf[hv.live.toAct]} to act (${(tv.seats[hv.seatOf[hv.live.toAct]] || {}).status})`
        : `between hands; seats ${tv.seats.map((s) => (s ? `${s.status}${s.waiting ? '/w' : ''}:${s.stack}` : '-')).join(' ')}`;
      if (VERBOSE && tv.handNo > handSeen) { console.log(`       hand ${tv.handNo} after ${Date.now() - handAt} ms`); handSeen = tv.handNo; handAt = Date.now(); }
    }
    if (raw && /"(holes|stub|muck|deck|salt|start)"\s*:/.test(raw)) fail(`${bot.name}'s stream carried the dealer's state: ${raw.match(/"(holes|stub|muck|deck|salt|start)"/)[0]}`);
    const h = v.hand;
    const pub = JSON.stringify({
      seats: tv.seats, button: tv.button, handNo: tv.handNo, closed: tv.closed,
      live: h && { seq: h.live.seq, si: h.live.si, toAct: h.live.toAct, stacks: h.live.stacks, pot: h.live.pot, over: h.live.over, seatOf: h.seatOf, handNo: h.handNo },
      board: h && h.hand.streets.map((st) => st.cards.board), actions: h && h.hand.streets.map((st) => st.actions),
    });
    const prev = prints.get(tv.version);
    if (!prev) prints.set(tv.version, { fp: pub, by: bot.name });
    else if (prev.fp !== pub) fail(`version ${tv.version}: ${bot.name} and ${prev.by} disagree\n         ${pub.slice(0, 400)}\n         ${prev.fp.slice(0, 400)}`);
    if (!h) return;
    const { live } = h;
    const you = h.you;
    const hero = you >= 0 ? you : 0;
    const shown = new Set(live.over && live.result ? live.result.shown : []);
    h.hand.streets.forEach((st, si) => {
      st.cards.opponents.forEach((c, k) => {
        const p = k >= hero ? k + 1 : k;
        if (c && c !== 'MUCK' && !shown.has(p)) fail(`${bot.name} saw player ${p}'s cards (${c}) in hand ${h.handNo} before they were shown`);
      });
      if (you < 0 && st.cards.hero) fail(`${bot.name}, not in hand ${h.handNo}, was shown cards ${st.cards.hero}`);
      if (si > live.si && (st.cards.board || st.cards.hero || st.actions.length)) fail(`${bot.name} saw street ${si} of hand ${h.handNo} before it was dealt`);
      for (const d of st.draws || []) if (d.player !== you && (d.discardedCards || d.newCards)) fail(`${bot.name} saw player ${d.player}'s draw in hand ${h.handNo}`);
    });
    const start = h.hand.players.reduce((a, p) => a + (Number(p.startingStack) || 0), 0);
    const now = live.stacks.reduce((a, s) => a + s, 0) + (live.pot || 0);
    if (Math.abs(now - start) > 0.01) fail(`hand ${h.handNo} at seq ${live.seq}: stacks and pot add to ${now}, the hand started with ${start}`);
    const key = `${h.handNo}|${bot.id}`;
    if (you >= 0) {
      if (!dealtIn.has(bot.id)) dealtIn.set(bot.id, new Set());
      dealtIn.get(bot.id).add(h.handNo);
      const mine = h.hand.streets[0].cards.hero;
      if (mine) {
        const was = holes.get(key);
        if (was && was !== mine) fail(`${bot.name}'s cards changed in hand ${h.handNo}: ${was} to ${mine}`);
        holes.set(key, mine);
      }
    }
    if (!live.over) {
      let set = seen.get(key);
      if (!set) seen.set(key, set = new Set());
      for (const st of h.hand.streets) for (const c of [st.cards.hero, st.cards.board, ...st.cards.opponents]) for (const x of cardsOf(c)) set.add(x);
    }
    stats.most = Math.max(stats.most, h.seatOf.length);
    if (h.seatOf.length >= 8) fullHands.add(h.handNo);
    if (h.handNo === 1) firstHand = h.seatOf.length;
  }
  let firstHand = 0;               // how many the first hand was dealt to
  const fullHands = new Set();     // hands dealt to eight players or more

  // ── The players ──
  let tableId = null, invite = null, finishing = false;
  let t0 = Infinity;      // when play began: the host starts the game once everyone is seated, or 30 s after
  class Bot {
    constructor(p) {
      Object.assign(this, p);
      this.token = jwt.sign({ id: p.id, username: p.name.toLowerCase() }, JWT_SECRET, { expiresIn: '6h' });
      this.view = null; this.stream = null; this.busy = false; this.tt = null;
      this.actedSeq = null; this.stallSeq = null; this.rolled = -1; this.backAt = 0; this.sitInAt = 0; this.gone = false; this.posted = false;
    }
    async connect() {
      const tk = await call(S, 'POST', `/api/tables/${tableId}/ticket`, null, this.token);
      if (tk.status !== 200) throw new Error(`${this.name}: ticket ${tk.status} ${JSON.stringify(tk.body)}`);
      const j = await call(T, 'POST', `/tables/${tableId}/join`, { ticket: tk.body.ticket });
      if (j.status !== 200) throw new Error(`${this.name}: join ${j.status}`);
      this.tt = j.body.token;
      this.onView(j.body.view, null);
      this.stream = openStream(`${T}/tables/${tableId}/events?token=${encodeURIComponent(this.tt)}`, (v, raw) => this.onView(v, raw));
    }
    onView(v, raw) {
      if (!v || !v.table) return;
      if (this.view && v.table.version < this.view.table.version) return;
      this.view = v;
      check(this, v, raw);
    }
    async reconnect() { if (this.stream) this.stream.close(); this.view = null; await sleep(200 + rnd() * 2000); await this.connect(); }
    act(route, body) { return call(T, 'POST', `/tables/${tableId}/${route}`, body || {}, this.tt); }
  }
  const bots = people.map((p) => new Bot(p));
  const say = (r, what, bot) => { if (r.status >= 500 || r.status === 401 || r.status === 404) fail(`${bot.name} ${what}: ${r.status} ${JSON.stringify(r.body)}`); return r; };

  function choose(L) {
    const x = rnd();
    const raise = (to) => ({ action: L.raiseWord === 'Bet' ? 'bet' : L.raiseWord === 'Complete' ? 'complete' : 'raise', to });
    const sized = () => {
      if (L.fixedTo != null) return raise(L.fixedTo);
      const y = rnd();
      const to = y < 0.55 ? L.minTo : y < 0.85 ? Math.round(L.minTo + rnd() * (L.maxTo - L.minTo)) : L.maxTo;
      if (to >= L.contrib + L.stack) stats.allIns++;
      return raise(Math.max(L.minTo, Math.min(L.maxTo, to)));
    };
    if (L.bringIn) return { action: 'bring-in' };
    if (L.canCheck) return L.canRaise && x < 0.35 ? (stats.raises++, sized()) : { action: 'check' };
    if (L.canFold && x < 0.22) { stats.folds++; return { action: 'fold' }; }
    if (L.canRaise && x > 0.72) { stats.raises++; return sized(); }
    return { action: 'call' };
  }

  async function step(bot) {
    const v = bot.view;
    if (!v || bot.gone) return;
    const tv = v.table;
    const me = tv.you >= 0 ? tv.seats[tv.you] : null;
    const h = v.hand;
    const between = !h || h.live.over;
    if (me && me.status === 'leaving') return;   // up from the table once this hand is over
    if (finishing) {
      if (me && me.status !== 'leaving') { say(await bot.act('leave'), 'leave', bot); await sleep(100); }
      return;
    }
    // The host deals the first hand once everyone is seated (or after a while).
    if (!tv.started && tv.canStart && me) {
      const seated = tv.seats.filter(Boolean).length;
      if (seated >= Math.min(PLAYERS, SEATS) || Date.now() - t0 > 30000) say(await bot.act('start'), 'start', bot);
      return;
    }
    // My turn.
    if (h && !h.live.over && h.you >= 0 && h.live.toAct === h.you && h.live.legal) {
      const turn = `${h.handNo}:${h.live.seq}`;
      if (turn === bot.actedSeq || turn === bot.stallSeq) return;
      if (rnd() < STALL) { bot.stallSeq = turn; stats.stalls++; return; }
      bot.actedSeq = turn;
      await sleep(rnd() * 40);
      const move = choose(h.live.legal);
      const r = await bot.act('act', { ...move, seq: h.live.seq });
      stats.acts++;
      if (r.status !== 200 && r.status !== 409) { stats.refused++; fail(`${bot.name}'s ${JSON.stringify(move)} on ${JSON.stringify(h.live.legal)} refused: ${r.status} ${JSON.stringify(r.body && r.body.error)}`); }
      return;
    }
    // Not seated: back when due, in a free seat, with a buy-in the balance covers.
    if (!me) {
      if (SNG && tv.started) { bot.gone = true; return; }
      if (Date.now() < bot.backAt) return;
      const free = tv.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
      if (!free.length) return;
      const buyIn = Math.round((BUY.min + rnd() * (BUY.max - BUY.min)) / 100) * 100;
      const r = await bot.act('sit', { buyIn, ...(rnd() < 0.5 ? { seat: pick(free) } : {}) });
      if (r.status === 200) { stats.sits++; bot.posted = false; return; }
      if (r.status === 409 && /You have/.test(r.body && r.body.error)) { bot.gone = true; stats.broke++; return; }
      if (r.status !== 409) say(r, 'sit', bot);
      bot.backAt = Date.now() + 300;
      return;
    }
    if (!between) {
      // In a hand someone else is acting in: now and then walk away from it.
      if (h && h.you >= 0 && me.status === 'playing' && bot.rolled !== `mid${tv.handNo}`) {
        bot.rolled = `mid${tv.handNo}`;
        const x = rnd();
        if (x < 0.006) { say(await bot.act('leave'), 'leave', bot); stats.leftMidHand++; bot.backAt = Date.now() + 1000 + rnd() * 4000; }
        else if (x < 0.012) { say(await bot.act('sit-out'), 'sit-out', bot); stats.sitOuts++; bot.sitInAt = Date.now() + 500 + rnd() * 3000; }
      }
      return;
    }
    // Between hands (from the first on): once a hand, maybe leave, sit out, drop the stream or chat.
    if (tv.started && bot.rolled !== tv.handNo) {
      bot.rolled = tv.handNo;
      const x = rnd();
      if (x < 0.02) { say(await bot.act('leave'), 'leave', bot); stats.leaves++; bot.backAt = Date.now() + 1000 + rnd() * 5000; return; }
      if (x < 0.045) { say(await bot.act('sit-out'), 'sit-out', bot); stats.sitOuts++; bot.sitInAt = Date.now() + 500 + rnd() * 3000; return; }
      if (x < 0.07) { stats.reconnects++; await bot.reconnect(); return; }
      if (x < 0.09) { say(await bot.act('chat', { text: pick(['nh', 'gg', 'ty', 'wow', 'one more']) }), 'chat', bot); stats.chats++; }
    }
    if (me.status === 'busted') {
      const amount = Math.round((BUY.min + rnd() * (BUY.max - BUY.min)) / 100) * 100;
      const r = await bot.act('rebuy', { amount });
      if (r.status === 200) { stats.rebuys++; return; }
      if (r.status === 409 && /You have/.test(r.body && r.body.error)) { say(await bot.act('leave'), 'leave', bot); bot.gone = true; stats.broke++; return; }
      if (r.status !== 409) say(r, 'rebuy', bot);
      return;
    }
    if (me.status === 'sitting-out' && Date.now() >= bot.sitInAt && me.stack > 0) { say(await bot.act('sit-in'), 'sit-in', bot); return; }
    if (me.waiting && !me.postNow && !bot.posted) {
      bot.posted = true;
      if (rnd() < 0.5) { say(await bot.act('post', { on: true }), 'post', bot); stats.posts++; }
    }
    if (!me.waiting) bot.posted = false;
  }

  try {
    await t.test(`${PLAYERS} ordinary accounts reach one ${SEATS}-seat ${GAME} table`, async () => {
      const host = bots[0];
      const made = await call(S, 'POST', '/api/tables', { name: 'Eight', gameType: GAME, sb: SNG ? 10 : 50, bb: SNG ? 20 : 100, maxSeats: SEATS, buyIn: BUY, decision: DECISION, bank: BANK,
        ...(SNG ? { format: 'sng', sng: SNG_CFG } : {}) }, host.token);
      assert.equal(made.status, 201, JSON.stringify(made.body));
      tableId = made.body.id;
      assert.equal(made.body.maxSeats, SEATS);
      invite = made.body.invite.split('/join/')[1];
      for (const b of bots.slice(1)) assert.equal((await call(S, 'POST', `/api/tables/invite/${invite}/accept`, null, b.token)).status, 200);
      await Promise.all(bots.map((b) => b.connect()));
      for (const b of bots) assert.ok(b.view && b.view.table.id === tableId);
    });

    await t.test(SNG ? 'the sit and go, played to a winner, and nothing stalls' : `${HANDS} hands with everyone at once, and nothing stalls`, async () => {
      const limit = SNG ? Date.now() + 45 * 60000 : Date.now() + HANDS * 8000 + 120000;
      let done = 0, lastReport = Date.now();
      t0 = Date.now();
      const top = () => bots.map((b) => b.view).filter(Boolean).sort((a, b) => b.table.version - a.table.version)[0];
      for (;;) {
        for (const b of bots) {
          if (b.busy) continue;
          b.busy = true;
          step(b).catch((e) => fail(`${b.name}: ${e.message}`)).finally(() => { b.busy = false; });
        }
        await sleep(20);
        const v = top();
        if (!v) continue;
        done = v.table.handNo - (v.hand && !v.hand.live.over ? 1 : 0);
        if (SNG ? v.table.sng && v.table.sng.finished : done >= HANDS) break;
        const handOn = !!(v.hand && !v.hand.live.over);
        // A sit and go deals a seat sitting out too.
        const dealable = v.table.seats.filter((s) => s && (SNG ? v.table.started : s.status === 'playing') && s.stack > 0).length;
        const quiet = Date.now() - lastChange;
        if (handOn && quiet > (DECISION + BANK + 6) * 1000) throw new Error(`hand ${v.table.handNo} stalled ${quiet} ms: ${JSON.stringify({ toAct: v.hand.live.toAct, seatOf: v.hand.seatOf, seats: v.table.seats })}`);
        if (!handOn && dealable >= 2 && quiet > GAP + 8000) throw new Error(`no hand dealt for ${quiet} ms with ${dealable} players ready: ${JSON.stringify(v.table.seats)}`);
        if (!SNG && bots.filter((b) => !b.gone).length < 2) { console.log(`       everyone but one is out of chips after ${done} hands`); break; }
        if (Date.now() > limit) throw new Error(`only ${done} hands in the time allowed`);
        if (Date.now() - lastReport > 30000) { lastReport = Date.now(); console.log(`       ${done} hands…`); }
        if (problems.length >= 40) break;
      }
      stats.hands = done;
      stats.full = fullHands.size;
      console.log(`       ${JSON.stringify(stats)}`);
      console.log(`       the longest quiet spell: ${longest.ms} ms, ${longest.why}`);
      assert.ok(stats.most >= Math.min(8, PLAYERS), `the most dealt into one hand was ${stats.most}`);
      assert.ok(firstHand >= Math.min(PLAYERS, SEATS), `the first hand was dealt to ${firstHand}: the start should wait for everyone seated`);
    });

    let final = null;   // a sit and go's places, as the table shows them at the end
    if (SNG) await t.test('the sit and go: every entrant placed once, the winner first, the prizes the whole pool', async () => {
      const v = bots.map((b) => b.view).filter(Boolean).sort((a, b) => b.table.version - a.table.version)[0];
      final = v.table.sng;
      assert.equal(final.finished, true);
      assert.equal(final.entrants, PLAYERS);
      assert.equal(final.places.length, PLAYERS, JSON.stringify(final.places));
      assert.equal(new Set(final.places.map((p) => p.userId)).size, PLAYERS, 'nobody placed twice');
      assert.equal(final.places.filter((p) => p.place === 1).length, 1);
      assert.equal(final.places.reduce((a, p) => a + p.prize, 0), PLAYERS * SNG_CFG.buyIn, 'the prizes are the pool');
      console.log(`       ${final.places.map((p) => `${p.place}. ${p.name}${p.prize ? ` +${p.prize}` : ''}`).join(', ')}; level ${v.table.sng.level}, ${v.table.handNo} hands`);
    });

    await t.test('every event: privacy, agreement and the chips in each hand', async () => {
      // The cards each viewer was shown before a hand ended, against every other player's own cards in it.
      for (const [key, set] of seen) {
        const [hand, viewer] = key.split('|');
        for (const [k2, mine] of holes) {
          const [h2, owner] = k2.split('|');
          if (h2 !== hand || owner === viewer) continue;
          for (const c of cardsOf(mine)) if (set.has(c)) fail(`player ${viewer} was shown ${c}, player ${owner}'s card, in hand ${hand}`);
        }
      }
      assert.deepEqual(problems, []);
    });

    await t.test('everyone leaves; the balances are what everyone started with, each its journal\'s sum', async () => {
      finishing = true;
      const until = Date.now() + 120000;
      for (;;) {
        for (const b of bots) {
          if (b.busy || !b.view) continue;
          b.busy = true;
          step(b).catch((e) => fail(`${b.name}: ${e.message}`)).finally(() => { b.busy = false; });
          // A hand still going plays out (the leavers are folded by the table).
          const h = b.view.hand;
          if (h && !h.live.over && h.you >= 0 && h.live.toAct === h.you && h.live.legal && `${h.handNo}:${h.live.seq}` !== b.actedSeq) {
            b.actedSeq = `${h.handNo}:${h.live.seq}`;
            b.act('act', { action: h.live.legal.canCheck ? 'check' : 'fold', seq: h.live.seq }).catch(() => {});
          }
        }
        await sleep(100);
        const v = bots.map((b) => b.view).filter(Boolean).sort((a, b) => b.table.version - a.table.version)[0];
        if (v && v.table.seats.every((s) => !s)) break;
        if (Date.now() > until) throw new Error('the table never emptied: ' + JSON.stringify(v && v.table.seats));
      }
      for (let k = 0; k < 100; k++) { const hs = await (await fetch(`${T}/health`)).json(); if (!hs.outbox) break; await sleep(200); }
      let sum = 0;
      for (const b of bots) {
        const c = await call(S, 'GET', '/api/tables/chips', null, b.token);
        assert.equal(c.status, 200);
        sum += c.body.balance;
      }
      assert.equal(sum, PLAYERS * START, `the balances add to ${sum}`);
    });

    await t.test('Hands: each hand saved once to every player dealt in, and its copies\' nets add up to 0', async () => {
      for (const b of bots) if (b.stream) b.stream.close();
      await srv.stop();
      const db = scratch.open();
      const moves = rowsOf(db, 'SELECT c.user_id AS u, c.balance AS bal, (SELECT SUM(delta) FROM play_chip_moves m WHERE m.user_id = c.user_id) AS journal FROM play_chips c');
      for (const m of moves) assert.equal(m.bal, m.journal, `user ${m.u}: balance ${m.bal}, journal ${m.journal}`);
      if (SNG) {
        // Each place's prize reached its player's balance, once; every entrant is down one buy-in before it.
        for (const p of final.places) {
          const got = rowsOf(db, "SELECT delta FROM play_chip_moves WHERE user_id = ? AND kind = 'prize' AND table_id = ?", [p.userId, tableId]).map((r) => r.delta);
          assert.deepEqual(got, p.prize ? [p.prize] : [], `${p.name} (${p.place}): prizes ${got.join(', ')}`);
          const net = rowsOf(db, "SELECT SUM(delta) AS n FROM play_chip_moves WHERE user_id = ? AND kind IN ('buy-in', 'refund') AND table_id = ?", [p.userId, tableId])[0].n;
          assert.equal(net, -SNG_CFG.buyIn, `${p.name}: buy-ins less refunds ${net}`);
        }
        const row = rowsOf(db, 'SELECT status, config FROM play_tables WHERE id = ?', [tableId])[0];
        assert.equal(row.status, 'finished');
        assert.equal(JSON.parse(row.config).results.places.length, PLAYERS, 'the scheduler keeps the places');
      }
      const saved = rowsOf(db, "SELECT user_id, hand_data FROM saved_hands WHERE json_extract(hand_data, '$.table.id') = ?", [tableId]);
      db.close();
      const { heroNet } = await import(pathToFileURL(path.join(ROOT, 'vite-app', 'src', 'utils', 'hand-net.js')).href);
      const byHand = new Map();
      for (const r of saved) {
        const hand = JSON.parse(r.hand_data);
        const k = hand.table.handNo;
        if (!byHand.has(k)) byHand.set(k, []);
        byHand.get(k).push({ user: r.user_id, hand });
      }
      assert.ok(byHand.size >= stats.hands, `${byHand.size} hands saved of ${stats.hands} played`);
      let settled = 0;
      for (const [k, copies] of byHand) {
        const n = copies[0].hand.players.length;
        assert.equal(copies.length, n, `hand ${k}: ${copies.length} copies for ${n} players`);
        assert.equal(new Set(copies.map((c) => c.user)).size, n, `hand ${k}: a player saved it twice`);
        const nets = copies.map((c) => heroNet(c.hand));
        if (nets.every((x) => x != null)) {
          settled++;
          const total = nets.reduce((a, x) => a + x, 0);
          assert.ok(Math.abs(total) < 0.01, `hand ${k}: the copies' nets add to ${total} (${nets.join(', ')})`);
        }
      }
      for (const [uid, set] of dealtIn) for (const k of set) assert.ok((byHand.get(k) || []).some((c) => c.user === uid), `player ${uid} was dealt hand ${k} and does not have it`);
      console.log(`       ${byHand.size} hands saved, ${saved.length} copies; ${settled} settled by the export, every one to 0`);
    });

    await t.test('neither server logged an error', async () => {
      const bad = (log) => log.split('\n').filter((l) => /TypeError|ReferenceError|RangeError|Unhandled|uncaught|scheduler answered 5|unreachable|could not reload/i.test(l));
      assert.deepEqual(bad(tables.log()), []);
      assert.deepEqual(bad(srv.log()).filter((l) => /tables/i.test(l)), []);
    });
  } finally {
    for (const b of bots) if (b.stream) b.stream.close();
    await srv.stop().catch(() => {});
    await tables.stop().catch(() => {});
    scratch.cleanup();
    if (problems.length) console.log('       ' + problems.join('\n       '));
    t.done();
  }
})();
