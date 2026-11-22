// The play-money table's runtime with a fake clock (lib/tables/runtime.mjs; docs/play-money-platform.md §3, §9):
// a seat that sits into a game waits for the big blind, the button moves one regular seat, two timeouts sit a
// player out, a time bank is spent before the clock acts, and a player leaving mid-hand is paid out after it.
//
//   node test/tables-runtime.test.mjs      (in npm run test:tables)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../lib/tables/runtime.mjs';
import { currentState } from '../vite-app/src/utils/poker-rules/live-hand.js';

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

// Everyone checks or folds until the hand is over.
function playOut(table) {
  for (let k = 0; k < 200 && table.hand && table.hand.phase === 'betting'; k++) {
    const st = currentState(table.hand);
    const p = st.legal.player;
    const userId = table.seats[table.handSeats[p]].userId;
    const r = table.act(userId, { action: st.legal.canCheck ? 'check' : 'fold' });
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
