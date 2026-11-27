// The play-money table's runtime with a fake clock (lib/tables/runtime.mjs; docs/play-money-platform.md §3, §9):
// a seat that sits into a game waits for the big blind, the button moves one regular seat, two timeouts sit a
// player out, a time bank is spent before the clock acts, and a player leaving mid-hand is paid out after it.
//
//   node test/tables-runtime.test.mjs      (in npm run test:tables)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../lib/tables/runtime.mjs';
import { currentState, toAct } from '../vite-app/src/utils/poker-rules/live-hand.js';

const FULL = [...'23456789TJQKA'].flatMap((r) => [...'hdcs'].map((s) => r + s));

function harness(over = {}) {
  let now = 0, nextId = 1;
  const timers = new Map();
  const done = [], cashOuts = [];
  const env = {
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    shuffle: () => FULL.slice(),
    commit: () => ({ salt: 's', hash: 'h' }),
    onChange: () => {},
    onHandDone: (_t, rec) => done.push(rec),
    onCashOut: (_t, c) => cashOuts.push({ ...c, handsDone: done.length }),
    handGapMs: 1000,
  };
  // Run the clock forward, firing every timer due, in time order.
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  };
  const table = new Table({
    id: 't1', name: 'Test', hostId: 1, gameType: 'NLH', blinds: { sb: 50, bb: 100, ante: 0 }, maxSeats: 6,
    buyIn: { min: 1000, max: 10000 }, clock: { decision: 30, bank: 60 }, ...over,
  }, env);
  return { table, env, advance, done, cashOuts };
}

// Everyone checks or folds (stud: brings it in; a draw: stands pat) until the hand is over.
function playOut(table) {
  for (let k = 0; k < 200 && table.hand && table.hand.phase !== 'over'; k++) {
    const t = toAct(table.hand);
    const userId = table.seats[table.handSeats[t.player]].userId;
    const move = t.kind === 'draw' ? { action: 'draw', discard: [] }
      : t.legal.bringIn ? { action: 'bring-in' } : { action: t.legal.canCheck ? 'check' : 'fold' };
    const r = table.act(userId, move);
    assert.ok(!r.error, r.error);
  }
}
// The table seats in this hand, as the replayer orders them: the last three are BTN, SB, BB (heads-up BTN/SB, BB).
const roles = (table) => {
  const s = table.handSeats;
  return s.length === 2 ? { btn: s[0], bb: s[1] } : { btn: s[s.length - 3], sb: s[s.length - 2], bb: s[s.length - 1] };
};

test('a seat that sits into a game waits for the big blind, then is dealt in on it', () => {
  const { table, advance } = harness();
  table.sit(1, 'Ava', 5000, 0);
  table.sit(2, 'Bo', 5000, 1);
  advance(1000);
  assert.equal(table.handNo, 1);
  assert.deepEqual(table.handSeats.slice().sort(), [0, 1]);
  // Cy sits mid-hand into seat 2: waiting.
  table.sit(3, 'Cy', 5000, 2);
  assert.equal(table.seats[2].waiting, true);
  assert.equal(table.viewFor(3).table.seats[2].waiting, true);
  playOut(table);
  // Each next hand: Cy is dealt in only as the big blind; until then Ava and Bo play heads-up.
  let cameIn = false;
  for (let h = 0; h < 3 && !cameIn; h++) {
    advance(1000);
    if (table.handSeats.includes(2)) {
      cameIn = true;
      assert.equal(roles(table).bb, 2, 'Cy comes in on the big blind');
      assert.equal(table.seats[2].waiting, false);
    } else {
      assert.equal(table.handSeats.length, 2);
    }
    playOut(table);
  }
  assert.ok(cameIn, 'Cy was dealt in within three hands');
});

test("between hands, a player who takes a seat someone left is not shown that seat's last hand", () => {
  // Found by test:tables-eight (2026-11-26): the last hand is shown until the next is dealt, and the viewer was found in
  // it by the seat they sit in NOW, so a newcomer in a seat just left was shown the hand as its last player saw it,
  // their unshown cards included.
  const { table, advance } = harness();
  table.sit(1, 'Ava', 5000, 0);
  table.sit(2, 'Bo', 5000, 1);
  advance(1000);
  assert.equal(table.handNo, 1);
  const boCards = table.viewFor(2).hand.hand.streets[0].cards.hero;
  assert.match(boCards, /^([2-9TJQKA][hdcs]){2}$/);
  playOut(table);                       // Ava folds: nobody shows
  assert.equal(table.hand, null);
  table.leave(2);                       // Bo goes between hands...
  assert.equal(table.seats[1], null);
  assert.ok(!table.sit(3, 'Cy', 5000, 1).error);   // ...and Cy takes his seat before the next is dealt
  const cy = table.viewFor(3);
  assert.equal(cy.hand.you, -1, 'Cy was not dealt the last hand');
  const shown = JSON.stringify(cy.hand);
  for (const c of boCards.match(/../g)) assert.ok(!shown.includes(`"${c}`) && !shown.includes(`${c}"`) && !new RegExp(`[2-9TJQKA][hdcs]${c}|${c}[2-9TJQKA][hdcs]`).test(shown), `Cy was shown Bo's ${c}`);
  // Ava still sees her own last hand, and Bo, back in another seat, his.
  assert.equal(table.viewFor(1).hand.you >= 0, true);
  assert.ok(!table.sit(2, 'Bo', 5000, 4).error);
  assert.equal(table.viewFor(2).hand.hand.streets[0].cards.hero, boCards);
});

test('a waiting seat never takes the button, and a table of one regular starts afresh', () => {
  const { table, advance } = harness();
  table.sit(1, 'Ava', 5000, 0);
  table.sit(2, 'Bo', 5000, 1);
  advance(1000);
  table.sit(3, 'Cy', 5000, 2);
  playOut(table);
  let cyIn = false;
  for (let h = 0; h < 4; h++) {
    advance(1000);
    if (!cyIn) assert.notEqual(table.button, 2, 'the button skips a seat that has not been dealt in');
    if (table.handSeats.includes(2)) { if (!cyIn) assert.equal(roles(table).bb, 2); cyIn = true; }
    playOut(table);
  }
  assert.ok(cyIn);
  // Bo leaves; Dee sits while only Ava is in play: no game is going, so Dee does not wait.
  const fresh = harness();
  fresh.table.sit(1, 'Ava', 5000, 0);
  fresh.table.sit(2, 'Bo', 5000, 1);
  fresh.advance(1000);
  playOut(fresh.table);
  fresh.table.leave(2);
  fresh.table.sit(4, 'Dee', 5000, 3);
  assert.equal(fresh.table.seats[3].waiting, false);
});

test('the button moves one seat a hand', () => {
  const { table, advance } = harness();
  table.sit(1, 'Ava', 5000, 0);
  table.sit(2, 'Bo', 5000, 1);
  table.sit(3, 'Cy', 5000, 2);
  advance(1000);
  const seen = [];
  for (let h = 0; h < 3; h++) { seen.push(table.button); playOut(table); advance(1000); }
  assert.deepEqual(seen, [0, 1, 2]);
});

test('the clock spends the time bank, then acts; two timeouts sit a player out', () => {
  const { table, advance } = harness();
  table.sit(1, 'Ava', 5000, 0);
  table.sit(2, 'Bo', 5000, 1);
  advance(1000);
  const first = currentState(table.hand).legal.player;
  const seat = table.seats[table.handSeats[first]];
  advance(30 * 1000);
  assert.equal(currentState(table.hand).legal.player, first, 'into the bank, not acted for');
  assert.equal(seat.bank, 0);
  advance(60 * 1000);
  assert.equal(seat.timeouts, 1);
  assert.equal(seat.status, 'playing');
  // Hands until this seat times out again (its bank is gone).
  for (let k = 0; k < 6 && seat.status === 'playing'; k++) {
    if (!table.hand) advance(1000);
    if (!table.hand) break;
    const st = currentState(table.hand);
    if (table.seats[table.handSeats[st.legal.player]] === seat) advance(30 * 1000);
    else playOut(table);
  }
  assert.equal(seat.status, 'sitting-out');
});

test('leaving mid-hand pays the stack out after the hand, not before', () => {
  const { table, advance, cashOuts, done } = harness();
  table.sit(1, 'Ava', 5000, 0);
  table.sit(2, 'Bo', 5000, 1);
  advance(1000);
  const r = table.leave(1);
  assert.equal(r.after, true);
  // Heads-up her leave folds her at once, so the hand may end here; either way the pay-out follows the hand.
  playOut(table);
  assert.equal(done.length, 1);
  assert.equal(cashOuts.length, 1);
  assert.equal(cashOuts[0].userId, 1);
  assert.equal(cashOuts[0].handsDone, 1, 'paid out after the hand was recorded');
  assert.equal(table.seats[0], null);
  const net = done[0].players.find((p) => p.userId === 1).net;
  assert.equal(cashOuts[0].amount, 5000 + net);
});

test('chat: a message is shown to every viewer, kept within bounds, slowed, muted by the host only, and removable', () => {
  const { table, advance } = harness();
  table.sit(1, 'Ava', 5000, 0);
  table.sit(2, 'Bo', 5000, 1);
  assert.equal(table.say(2, 'Bo', '   ').error, 'Type a message');
  assert.match(table.say(2, 'Bo', 'x'.repeat(281)).error, /280/);
  const r = table.say(2, 'Bo', '  nice   hand  ');
  assert.ok(r.ok);
  const seen = table.viewFor(1).chat;
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].name, seen[0].text, seen[0].mine], ['Bo', 'nice hand', false]);
  assert.equal(table.viewFor(2).chat[0].mine, true);
  // Five a ten seconds, then slowed; ten seconds on, free again.
  for (let k = 0; k < 4; k++) assert.ok(table.say(2, 'Bo', `m${k}`).ok);
  assert.equal(table.say(2, 'Bo', 'one more').error, 'Slow down a little');
  advance(10000);
  assert.ok(table.say(2, 'Bo', 'again').ok);
  // Ids increase, so a report names one message alone.
  const ids = table.viewFor(1).chat.map((m) => m.id);
  assert.deepEqual(ids, ids.slice().sort((a, b) => a - b));
  assert.equal(new Set(ids).size, ids.length);
  // Only the host (user 1) mutes; the host sees whom, nobody else is told.
  assert.equal(table.mute(2, 1, true).error, 'Only the host can mute');
  assert.ok(table.mute(1, 2, true).ok);
  assert.equal(table.say(2, 'Bo', 'hello?').error, 'The host has muted you at this table');
  assert.equal(table.viewFor(2).table.muted, true);
  assert.deepEqual(table.viewFor(1).table.mutedIds, [2]);
  assert.equal(table.viewFor(2).table.mutedIds, undefined);
  assert.ok(table.mute(1, 2, false).ok);
  advance(10000);
  assert.ok(table.say(2, 'Bo', 'thanks').ok);
  // Removed (Admin's inbox, through the service): gone from every view, and from the journal.
  const first = ids[0];
  assert.equal(table.removeMessage(first).removed, 1);
  assert.ok(!table.viewFor(1).chat.some((m) => m.id === first));
  const saved = JSON.parse(JSON.stringify(table));
  assert.ok(!saved.chat.some((m) => m.id === first));
  assert.equal(saved.chat.length, table.chat.length);
});

test('each new turn is offered to the service (which pushes only to a player who is away); a resumed clock is not', () => {
  const turns = [];
  const { table, env, advance } = harness();
  env.onTurn = (_t, userId) => turns.push(userId);
  table.sit(1, 'Ava', 5000, 0);
  table.sit(2, 'Bo', 5000, 1);
  advance(1000);
  assert.equal(turns.length, 1);
  const first = turns[0];
  const st = currentState(table.hand);
  table.act(first, { action: st.legal.canCheck ? 'check' : 'call' });
  assert.equal(turns.length, 2);
  assert.notEqual(turns[1], first);
  // A table reloaded from its journal re-arms the clock as a resume: no second "your turn".
  const saved = JSON.parse(JSON.stringify(table));
  const before = turns.length;
  const again = new Table(saved.cfg, env, saved);
  assert.ok(again.hand);
  assert.equal(turns.length, before);
  again.clearTimers();
});

test('a stud table: no button, each player named by their seat, and a new seat is dealt the next hand', () => {
  const { table, advance, done } = harness({ gameType: 'Stud Hi', blinds: { sb: 0, bb: 100, ante: 10, bringIn: 50, bigBet: 200 } });
  table.sit(1, 'Ava', 5000, 0);
  table.sit(2, 'Bo', 5000, 3);
  advance(1000);
  assert.equal(table.button, -1);
  assert.deepEqual(table.hand.players.map((p) => p.position), ['Seat 1', 'Seat 4']);
  assert.equal(toAct(table.hand).legal.bringIn, 50, 'the low door brings it in');
  table.sit(3, 'Cy', 5000, 1);
  assert.equal(table.seats[1].waiting, false, 'stud has no big blind to wait for');
  playOut(table);
  assert.equal(done.length, 1);
  advance(1000);
  assert.deepEqual(table.handSeats, [0, 1, 3], 'Cy is dealt in, in table order');
  playOut(table);
  const sum = table.seats.filter(Boolean).reduce((a, s) => a + s.stack, 0);
  assert.equal(sum, 15000);
});

test('a draw table: the clock runs at a draw too, and a draw timed out (or a seat sitting out) stands pat', () => {
  const { table, advance } = harness({ gameType: '2-7 TD', blinds: { sb: 50, bb: 100, ante: 0, bigBet: 200 } });
  table.sit(1, 'Ava', 5000, 0);
  table.sit(2, 'Bo', 5000, 1);
  advance(1000);
  // Before the draw: the button calls, the big blind checks.
  for (const move of [{ action: 'call' }, { action: 'check' }]) {
    const t = toAct(table.hand);
    assert.ok(table.act(table.seats[table.handSeats[t.player]].userId, move).ok);
  }
  assert.equal(table.hand.phase, 'drawing');
  const t = toAct(table.hand);
  assert.equal(t.kind, 'draw');
  const seat = table.seats[table.handSeats[t.player]];
  const before = table.hand.holes[t.player].slice();
  assert.ok(table.deadline != null, 'the clock is running on the draw');
  advance(30 * 1000 + 60 * 1000);
  assert.deepEqual(table.hand.holes[t.player], before, 'timed out: stood pat');
  assert.equal(seat.timeouts, 1);
  // The other player sits out: their draw is made for them at once, standing pat.
  const other = toAct(table.hand);
  const otherSeat = table.seats[table.handSeats[other.player]];
  table.sitOut(otherSeat.userId);
  assert.equal(table.hand.phase, 'betting');
  assert.equal(table.hand.si, 1);
  const drew = table.hand.streets[0].draws.map((d) => d.discarded);
  assert.deepEqual(drew, [0, 0]);
});

/* Posting to come in at once (owner, 2026-11-22): a waiting seat that posts is dealt the next hand that does not put it
   in the small blind, with a live big blind (players[i].post) unless that hand makes it the big blind anyway. */
test('a waiting seat that posts comes in on the next hand that does not make it the small blind', () => {
  for (const startButtons of [0, 1, 2, 3]) {
    const { table, advance, done } = harness();
    for (let i = 0; i < 4; i++) table.sit(i + 1, 'P' + i, 5000, i);
    advance(1000);
    for (let h = 0; h < startButtons; h++) { playOut(table); advance(1000); }
    table.sit(9, 'Dee', 5000, 4);
    assert.equal(table.seats[4].waiting, true);
    assert.equal(table.postIn(1, true).error, 'You are already dealt in', 'only a waiting seat posts');
    assert.ok(table.postIn(9, true).ok);
    assert.equal(table.viewFor(9).table.seats[4].postNow, true);
    playOut(table);
    let cameIn = false;
    for (let h = 0; h < 3 && !cameIn; h++) {
      advance(1000);
      const p = table.handSeats.indexOf(4);
      if (p < 0) {
        // Out only where the hand would have made Dee the small blind: the next seat after the button.
        assert.equal([1, 2, 3, 4].map((k) => (table.button + k) % 6).find((i) => table.seats[i]), 4, `button ${table.button}: Dee waits only for the small blind`);
      } else {
        cameIn = true;
        const player = table.hand.players[p];
        if (roles(table).bb === 4) assert.equal(player.post, undefined, 'on the big blind there is nothing to post');
        else assert.equal(player.post, 100, 'a live big blind from her own seat');
        assert.equal(table.seats[4].waiting, false);
        assert.equal(table.seats[4].postNow, false);
      }
      playOut(table);
    }
    assert.ok(cameIn, `button run ${startButtons}: Dee was dealt in`);
    // Every hand kept its chips.
    for (const rec of done) assert.equal(rec.players.reduce((a, x) => a + x.net, 0), 0);
  }
});

test('a seat can take its post back and wait for the big blind again', () => {
  const { table, advance } = harness();
  for (let i = 0; i < 4; i++) table.sit(i + 1, 'P' + i, 5000, i);
  advance(1000);
  table.sit(9, 'Dee', 5000, 4);
  table.postIn(9, true);
  assert.ok(table.postIn(9, false).ok);
  playOut(table);
  for (let h = 0; h < 4; h++) {
    advance(1000);
    const p = table.handSeats.indexOf(4);
    if (p >= 0) { assert.equal(roles(table).bb, 4, 'back to waiting: only on the big blind'); break; }
    playOut(table);
  }
});

test('a table with the start gate deals nothing until the host starts it, and then deals everyone seated in', () => {
  const { table, advance } = harness({ startGate: true, hostId: 1 });
  table.sit(2, 'Bo', 5000, 0);
  table.sit(3, 'Cy', 5000, 1);
  advance(60000);
  assert.equal(table.handNo, 0, 'two seated, nobody started it: no hand');
  assert.equal(table.viewFor(2).table.canStart, true, 'the host is not seated: anyone seated may start');
  table.sit(1, 'Ava', 5000, 2);
  assert.equal(table.viewFor(2).table.canStart, false, 'the host is seated: only the host');
  assert.equal(table.viewFor(9).table.canStart, false, 'nor someone not seated');
  assert.match(table.startGame(2).error, /host/);
  table.sit(4, 'Dee', 5000, 3);
  assert.ok(table.seats.every((s) => !s || !s.waiting), 'before the start nobody waits for the big blind');
  assert.ok(table.startGame(1).ok);
  assert.equal(table.viewFor(1).table.started, true);
  assert.match(table.startGame(1).error, /started/);
  advance(1000);
  assert.equal(table.handNo, 1);
  assert.deepEqual(table.handSeats.slice().sort(), [0, 1, 2, 3], 'all four dealt the first hand');
  table.sit(5, 'Eve', 5000, 4);
  assert.equal(table.seats[4].waiting, true, 'after the start a newcomer waits for the big blind');
});

test('a gated table starts by itself once every seat is taken; one player cannot start it', () => {
  const { table, advance } = harness({ startGate: true, hostId: 1, maxSeats: 3 });
  table.sit(1, 'Ava', 5000, 0);
  assert.match(table.startGame(1).error, /Two players/);
  table.sit(2, 'Bo', 5000, 1);
  advance(5000);
  assert.equal(table.handNo, 0);
  table.sit(3, 'Cy', 5000, 2);
  advance(1000);
  assert.equal(table.handNo, 1, 'the last seat taken started it');
  assert.equal(table.handSeats.length, 3);
});

test('a table journaled before the gate (no started field) and a table without it have always started', () => {
  const { table, advance } = harness();
  assert.equal(table.started, true);
  const saved = { ...table.toJSON() };
  delete saved.started;
  const again = new Table({ ...table.cfg, startGate: true }, table.env, saved);
  assert.equal(again.started, true);
  table.sit(1, 'Ava', 5000, 0);
  table.sit(2, 'Bo', 5000, 1);
  advance(1000);
  assert.equal(table.handNo, 1);
});

// ── Sit and go (owner, 2026-11-26: "either in a cash game or sit and go format"; "Buy in, top 3 paid") ──
import { prizesFor, payoutPcts, placeBusts, stakesAt, LADDER } from '../lib/tables/sng.mjs';

const SNG = (over = {}) => ({ startGate: true, hostId: 1, format: 'sng', sng: { buyIn: 1000, stack: 1500, levelMins: 5 },
  blinds: { sb: 10, bb: 20, ante: 0 }, buyIn: { min: 1500, max: 1500 }, maxSeats: 8, ...over });

// A seeded shuffle: the harness deals one deck every hand, and with everyone all in every pot would split.
function seeded(table, seed = 7) {
  let x = seed;
  const r = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  table.env.shuffle = () => { const d = FULL.slice(); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; };
}

// Everyone all in or calling: hands that knock players out quickly.
// Now and then a shove (every seventh decision), and the shove called one time in three; otherwise check or fold.
let turns = 0;
function shoveOut(table) {
  for (let k = 0; k < 200 && table.hand && table.hand.phase !== 'over'; k++) {
    const t = toAct(table.hand);
    const userId = table.seats[table.handSeats[t.player]].userId;
    const L = t.legal;
    turns++;
    const move = L.canRaise && L.maxTo > 0 && turns % 7 === 0 ? { action: L.raiseWord === 'Bet' ? 'bet' : 'raise', to: L.maxTo }
      : L.canCheck ? { action: 'check' } : turns % 3 === 0 ? { action: 'call' } : { action: 'fold' };
    const r = table.act(userId, move);
    assert.ok(!r.error, `${JSON.stringify(move)}: ${r.error}`);
  }
}

test('sit and go arithmetic: the prizes add up to the pool; three paid from seven, two from five, one from four; a tie shares', () => {
  assert.deepEqual(payoutPcts(8), [50, 30, 20]);
  assert.deepEqual(payoutPcts(6), [65, 35]);
  assert.deepEqual(payoutPcts(4), [100]);
  assert.deepEqual(prizesFor(8, 1000), [4000, 2400, 1600]);
  for (let n = 2; n <= 9; n++) for (const b of [1, 7, 333, 1000]) assert.equal(prizesFor(n, b).reduce((a, x) => a + x, 0), n * b);
  // Two out in one hand: the bigger stack at its start finishes higher.
  assert.deepEqual(placeBusts([{ userId: 5, name: 'E', start: 300, seat: 4 }, { userId: 6, name: 'F', start: 900, seat: 5 }], 2, [4000, 2400, 1600])
    .map((p) => [p.userId, p.place, p.prize]), [[6, 3, 1600], [5, 4, 0]]);
  // Level at the start: a tie, both third, sharing third's and fourth's prizes (1,600 + 0).
  assert.deepEqual(placeBusts([{ userId: 5, name: 'E', start: 500, seat: 4 }, { userId: 6, name: 'F', start: 500, seat: 2 }], 2, [4000, 2400, 1600])
    .map((p) => [p.userId, p.place, p.prize]), [[6, 3, 800], [5, 3, 800]]);
  // The stakes climb the ladder from the host's level 1.
  assert.deepEqual(stakesAt('NLH', { sb: 10, bb: 20, ante: 0 }, 0), { sb: 10, bb: 20, ante: 0 });
  assert.deepEqual(stakesAt('NLH', { sb: 10, bb: 20, ante: 0 }, 1), { sb: 15, bb: 30, ante: 0 });
  assert.equal(stakesAt('NLH', { sb: 10, bb: 20, ante: 0 }, 99).bb, 20 * LADDER[LADDER.length - 1]);
});

test('a sit and go: eight enter, it starts full, the blinds climb with the clock, players go out in order, the prizes are the pool', () => {
  const { table, advance, cashOuts } = harness(SNG());
  seeded(table);
  for (let i = 1; i <= 7; i++) assert.ok(table.sit(i, 'P' + i, 1500, i - 1).ok);
  assert.equal(table.started, false);
  // Before the start everyone sees who has entered and what that would pay.
  const before = table.viewFor(99).table.sng;
  assert.equal(before.entrants, 7);
  assert.deepEqual(before.prizes, [3500, 2100, 1400]);
  assert.deepEqual(before.places, []);
  assert.ok(table.leave(7).ok, 'off the list before the start');
  assert.deepEqual(cashOuts.pop(), { userId: 7, amount: 1000, kind: 'refund', handsDone: 0 });
  table.sit(7, 'P7', 1500, 6);
  table.sit(8, 'P8', 1500, 7);
  assert.equal(table.started, true, 'every seat taken: it starts');
  assert.deepEqual(table.sng.prizes, [4000, 2400, 1600]);
  assert.match(table.sit(9, 'Late', 1500).error, /started|full/);
  assert.match(table.leave(3).error, /sit out/);
  assert.match(table.rebuy(3, 100).error, /rebuys/);
  const outOrder = [];
  let lastLevel = 0;
  for (let h = 0; h < 400 && !table.sng.finished; h++) {
    advance(60000);                                        // a minute a hand: a level every five
    if (!table.hand) continue;                             // between two hands (the clock played some out)
    // The hand was dealt at the level the clock was on then (a moment ago, or a level back across a boundary).
    const lv = Math.min(LADDER.length - 1, Math.floor((table.env.now() - table.sng.startedAt) / 300000));
    assert.ok(table.sng.level === lv || table.sng.level === lv - 1, `hand ${table.handNo}: level ${table.sng.level + 1}, the clock's ${lv + 1}`);
    assert.deepEqual(table.hand.blinds, stakesAt('NLH', { sb: 10, bb: 20, ante: 0 }, table.sng.level), `hand ${table.handNo} at level ${table.sng.level + 1}`);
    assert.ok(table.sng.level >= lastLevel);
    lastLevel = table.sng.level;
    const before = table.sng.places.length;
    shoveOut(table);
    for (const p of table.sng.places.slice(before)) outOrder.push(p.place);
    // The tournament's chips stay 12,000 among those still in.
    const inPlay = table.seats.filter(Boolean).reduce((a, s) => a + s.stack, 0);
    assert.equal(inPlay, 12000);
  }
  assert.equal(table.sng.finished, true);
  assert.ok(lastLevel >= 1, 'the blinds went up');
  const places = table.sng.places.map((p) => p.place).sort((a, b) => a - b);
  assert.equal(table.sng.places.length, 8, 'every entrant placed');
  assert.equal(places[0], 1);
  for (let k = 1; k < outOrder.length; k++) assert.ok(outOrder[k] <= outOrder[k - 1], 'each knock-out places below the ones before it');
  const prizes = cashOuts.filter((c) => c.kind === 'prize');
  assert.equal(prizes.reduce((a, c) => a + c.amount, 0), 8000, 'the prizes are the whole pool');
  assert.ok(cashOuts.every((c) => c.kind === 'prize' || c.kind === 'refund'), 'no stack is ever cashed out of a sit and go');
  const handNo = table.handNo;
  advance(120000);
  assert.equal(table.handNo, handNo, 'nothing is dealt once it is won');
  assert.equal(table.closed, false, 'it stays to be looked at');
  advance(30 * 60000);
  assert.equal(table.closed, true, 'then closes');
});

test('a sit and go: a seat sitting out is still dealt and blinded; the host calling it off chops the pool by chips', () => {
  const { table, advance, cashOuts } = harness(SNG({ maxSeats: 4 }));
  seeded(table, 11);
  for (let i = 1; i <= 3; i++) table.sit(i, 'P' + i, 1500, i - 1);
  assert.ok(table.startGame(1).ok);
  assert.deepEqual(table.sng.prizes, [3000], 'three entered: the winner takes it all');
  table.sitOut(3);
  advance(1000);
  assert.ok(table.handSeats.includes(2), 'sitting out, still dealt');
  playOut(table);
  advance(5000);
  playOut(table);
  const stacks = table.seats.filter(Boolean).map((s) => s.stack);
  assert.equal(stacks.reduce((a, b) => a + b, 0), 4500);
  advance(5000);
  table.close();
  playOut(table);
  const paid = cashOuts.filter((c) => c.kind === 'prize');
  assert.equal(paid.reduce((a, c) => a + c.amount, 0), 3000, 'the pool, chopped');
  assert.ok(table.closed);
  assert.equal(table.sng.cancelled, true);
});
