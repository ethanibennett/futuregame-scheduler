'use strict';
/*
 * Play-money tables, end to end over the real routes and streams (docs/play-money-platform.md §9):
 * a scratch scheduler (ports 4940-4944) and the tables service beside it (4945-4949), two accounts at one
 * private table playing a full NLH hand from a fixed deck.
 *
 *   - the gate: open to every registered account, never a guest, five open tables a host; a blocked player is told the table is full;
 *   - nothing is dealt until the host starts the game;
 *   - chips: the balance starts at 20,000, a buy-in takes from it, leaving gives the stack back;
 *   - each stream's raw events never hold the other player's unshown cards;
 *   - the chips at the end are what the export's PokerStars text says (the oracle-checked writer, read back);
 *   - a saved_hands row for each player, holding only what they saw.
 *
 *   npm run test:tables
 */
const assert = require('assert');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const { pathToFileURL } = require('url');
const { createScratch, boot, freePort, scrubbedEnv, ROOT, runner } = require('./helpers/scratch-server');

const SECRET = 'tables-test-secret-0123456789abcdef0123456789';
const JWT_SECRET = 'backer-surface-test-secret-not-for-prod';
const RANKS = '23456789TJQKA', SUITS = 'hdcs';
const FULL = [...RANKS].flatMap((r) => [...SUITS].map((s) => r + s));
// Ava (seat 0, the button and small blind) AhAd; Bo KcKs; board 2c 7d 9h | 3s | 4d.
const TOP = ['Ah', 'Ad', 'Kc', 'Ks', '2c', '7d', '9h', '3s', '4d'];
const DECK = [...TOP, ...FULL.filter((c) => !TOP.includes(c))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bootTables(port, schedulerPort, dataDir) {
  const env = scrubbedEnv({
    PORT: String(port), TABLES_SECRET: SECRET, TABLES_SCHEDULER_URL: `http://127.0.0.1:${schedulerPort}`,
    TABLES_DATA_DIR: dataDir, TABLES_HAND_GAP_MS: '60000', TABLES_TEST_DECK: DECK.join(','),
  });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'tables', 'server.mjs')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('tables did not start\n' + log)); }, 20000);
    const on = (b) => { log += b.toString(); if (log.includes(`Tables running on port ${port}`)) { clearTimeout(timer); resolve({ child, log: () => log, stop: () => new Promise((r) => { if (child.exitCode != null) return r(); child.on('exit', () => r()); child.kill(); }) }); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`tables exited ${code}\n${log}`)); });
  });
}

/* An SSE stream read raw: every 'view' event kept, parsed and as the bytes that came. */
function stream(url) {
  const ctl = new AbortController();
  const events = [];
  const done = (async () => {
    const r = await fetch(url, { signal: ctl.signal });
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
        if (data) events.push({ raw: data, view: JSON.parse(data) });
      }
    }
  })();
  return { events, close: () => ctl.abort(), done };
}

async function waitFor(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await sleep(50);
  }
}

(async () => {
  const t = runner('play-tables');
  const scratch = await createScratch({ ports: [4940, 4944], prefix: 'fg-play-tables-' });
  const db = scratch.open();
  db.run("INSERT INTO users (id, username, email, password) VALUES (101, 'ham', 'a@x.test', 'x'), (102, 'ham5', 'b@x.test', 'x'), (103, 'claude', 'c@x.test', 'x'), (104, 'pat', 'd@x.test', 'x'), (105, 'Dana', 'e@x.test', 'x')");
  db.run('INSERT INTO user_blocks (user_id, blocked_id, created_at) VALUES (103, 101, 0)');
  scratch.save(db);
  const tok = (id, username) => jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '1h' });
  const AVA = tok(101, 'ham'), BO = tok(102, 'ham5'), BLOCKED = tok(103, 'claude'), PAT = tok(104, 'pat'), DANA = tok(105, 'Dana');

  const tport = await freePort([4945, 4949]);
  const srv = await boot(scratch.dbPath, { TABLES: '1', TABLES_URL: `http://127.0.0.1:${tport}`, TABLES_SECRET: SECRET, PLAY_HOSTS: 'play.test' }, { ports: [4940, 4944] });
  const dataDir = path.join(scratch.tmp, 'tables-data');
  const tables = await bootTables(tport, srv.port, dataDir);
  const S = `http://127.0.0.1:${srv.port}`, T = `http://127.0.0.1:${tport}`;
  const call = async (base, method, p, body, bearer) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (_) { /* empty */ }
    return { status: r.status, body: j };
  };
  const streams = [];

  try {
    let table, invite;
    await t.test('the boot line says the tables are on, for every account', async () => {
      assert.match(srv.log(), /\[tables\] play-money tables are ON \(.*\), every account/);
    });

    await t.test('open to every registered account (owner, 2026-11-26, decision 3), with the service URL; a guest is refused', async () => {
      for (const who of [AVA, PAT, DANA]) assert.deepEqual((await call(S, 'GET', '/api/tables/availability', null, who)).body, { on: true, url: T });
      assert.equal((await call(S, 'GET', '/api/tables', null, PAT)).status, 200);
      // Nothing else of an admin's opens with it.
      assert.equal((await call(S, 'GET', '/api/admin/reports', null, PAT)).status, 403);
      assert.equal((await call(S, 'GET', '/api/solver/availability', null, PAT)).status, 403);
      const guest = jwt.sign({ id: 0, username: 'dana', isGuest: true }, JWT_SECRET, { expiresIn: '1h' });
      assert.notEqual((await call(S, 'GET', '/api/tables', null, guest)).status, 200);
      assert.notEqual((await call(S, 'POST', '/api/tables', { gameType: 'NLH', sb: 5, bb: 10 }, guest)).status, 201);
      // The app is untouched (owner, 2026-11-22: "no effect on the mobile app"): no tables row in its Notifications.
      const kinds = async (bearer) => (await call(S, 'GET', '/api/notification-prefs', null, bearer)).body.kinds.map((k) => k.kind);
      assert.ok(!(await kinds(AVA)).includes('tables'));
    });

    await t.test('any account hosts, up to five open tables at once', async () => {
      const made = [];
      for (let k = 0; k < 5; k++) {
        const r = await call(S, 'POST', '/api/tables', { gameType: 'NLH', sb: 5, bb: 10, name: `Pat ${k}` }, PAT);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        made.push(r.body.id);
      }
      const sixth = await call(S, 'POST', '/api/tables', { gameType: 'NLH', sb: 5, bb: 10 }, PAT);
      assert.equal(sixth.status, 409);
      assert.match(sixth.body.error, /Close one first/);
      assert.equal((await call(S, 'POST', `/api/tables/${made[0]}/close`, null, PAT)).status, 200);
      assert.equal((await call(S, 'POST', '/api/tables', { gameType: 'NLH', sb: 5, bb: 10 }, PAT)).status, 201);
    });

    await t.test('the balance starts at 20,000', async () => {
      const c = await call(S, 'GET', '/api/tables/chips', null, AVA);
      assert.equal(c.body.balance, 20000);
    });

    await t.test('the host creates a private NLH table; a game not dealt live is refused; stud takes its own stakes', async () => {
      assert.equal((await call(S, 'POST', '/api/tables', { gameType: 'A-5 TD', sb: 5, bb: 10 }, AVA)).status, 400);
      // Stud: the first figure is the bring-in, the second the small bet; seven seats at most.
      const razz = await call(S, 'POST', '/api/tables', { name: 'Razz table', gameType: 'Razz', sb: 5, bb: 10, ante: 2, maxSeats: 9, buyIn: { min: 200, max: 1000 }, decision: 30, bank: 0 }, AVA);
      assert.equal(razz.status, 201, JSON.stringify(razz.body));
      assert.deepEqual(razz.body.blinds, { sb: 0, bb: 10, ante: 2, bringIn: 5, bigBet: 20 });
      assert.equal(razz.body.maxSeats, 7);
      assert.equal((await call(S, 'POST', `/api/tables/${razz.body.id}/close`, null, AVA)).status, 200);
      const r = await call(S, 'POST', '/api/tables', { name: 'Test table', gameType: 'NLH', sb: 5, bb: 10, maxSeats: 6, buyIn: { min: 200, max: 1000 }, decision: 30, bank: 0 }, AVA);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      table = r.body;
      assert.ok(table.invite.startsWith('https://play.futurega.me/join/'), 'an invite opens play.futurega.me');
      invite = table.invite.split('/join/')[1];
      assert.ok(invite && invite.length > 20);
    });

    await t.test('a friend takes the invite; a player blocked either way is told the table is full', async () => {
      assert.equal((await call(S, 'GET', `/api/tables/invite/${invite}`, null, BO)).body.name, 'Test table');
      assert.equal((await call(S, 'POST', `/api/tables/invite/${invite}/accept`, null, BO)).status, 200);
      const b = await call(S, 'GET', `/api/tables/invite/${invite}`, null, BLOCKED);
      assert.equal(b.status, 404);
      assert.match(b.body.error, /full/);
      assert.equal((await call(S, 'POST', `/api/tables/${table.id}/ticket`, null, BLOCKED)).status, 404);
    });

    const seats = {};
    await t.test('tickets trade for table tokens; a forged ticket is refused', async () => {
      const forged = jwt.sign({ kind: 'ticket', sub: 102, name: 'ham5', table: table.id }, 'not-the-secret-not-the-secret-not-the-secret');
      assert.equal((await call(T, 'POST', `/tables/${table.id}/join`, { ticket: forged })).status, 401);
      for (const [who, bearer] of [['ava', AVA], ['bo', BO]]) {
        const tk = await call(S, 'POST', `/api/tables/${table.id}/ticket`, null, bearer);
        assert.equal(tk.status, 200);
        const j = await call(T, 'POST', `/tables/${table.id}/join`, { ticket: tk.body.ticket });
        assert.equal(j.status, 200);
        seats[who] = j.body.token;
      }
      seats.avaStream = stream(`${T}/tables/${table.id}/events?token=${encodeURIComponent(seats.ava)}`);
      seats.boStream = stream(`${T}/tables/${table.id}/events?token=${encodeURIComponent(seats.bo)}`);
      streams.push(seats.avaStream, seats.boStream);
    });

    await t.test('buying in takes the chips from the balance', async () => {
      assert.equal((await call(T, 'POST', `/tables/${table.id}/sit`, { seat: 0, buyIn: 5000 }, seats.ava)).status, 400, 'over the table maximum');
      const a = await call(T, 'POST', `/tables/${table.id}/sit`, { seat: 0, buyIn: 1000 }, seats.ava);
      assert.equal(a.status, 200, JSON.stringify(a.body));
      assert.equal(a.body.balance, 19000);
      const b = await call(T, 'POST', `/tables/${table.id}/sit`, { seat: 1, buyIn: 1000 }, seats.bo);
      assert.equal(b.status, 200, JSON.stringify(b.body));
    });

    await t.test('nothing is dealt until the host starts the game; a guest at the table cannot', async () => {
      await sleep(300);
      const v = (await call(T, 'GET', `/tables/${table.id}/state`, null, seats.ava)).body;
      assert.equal(v.table.started, false);
      assert.equal(v.hand, null);
      assert.equal(v.table.canStart, true);
      assert.equal((await call(T, 'POST', `/tables/${table.id}/start`, null, seats.bo)).status, 409, 'the host is seated: only the host');
      assert.equal((await call(T, 'POST', `/tables/${table.id}/start`, null, seats.ava)).status, 200);
    });

    const state = async (who) => (await call(T, 'GET', `/tables/${table.id}/state`, null, seats[who])).body;
    const play = async (who, action, to) => {
      const v = await state(who);
      const r = await call(T, 'POST', `/tables/${table.id}/act`, { action, to, seq: v.hand.live.seq }, seats[who]);
      assert.equal(r.status, 200, `${who} ${action}: ${JSON.stringify(r.body && r.body.error)}`);
    };

    await t.test('a full NLH hand: the turns, the stale-seq refusal, the showdown', async () => {
      await waitFor(async () => { const v = await state('ava'); return v.hand && v.hand.live && v.hand.live.toAct >= 0; }, 'the first hand');
      const v0 = await state('ava');
      assert.deepEqual(v0.hand.hand.streets[0].cards.hero, 'AhAd');
      assert.equal(v0.hand.hand.streets[0].cards.opponents[0], '', 'the opponent is face down');
      assert.equal((await call(T, 'POST', `/tables/${table.id}/act`, { action: 'call', seq: v0.hand.live.seq }, seats.bo)).status, 400, 'not your turn');
      assert.equal((await call(T, 'POST', `/tables/${table.id}/act`, { action: 'raise', to: 30, seq: v0.hand.live.seq + 5 }, seats.ava)).status, 409, 'a stale seq');
      await play('ava', 'raise', 30);
      await play('bo', 'call');
      await play('bo', 'check'); await play('ava', 'check');
      await play('bo', 'bet', 50); await play('ava', 'call');
      await play('bo', 'check'); await play('ava', 'check');
      const end = await state('ava');
      assert.equal(end.hand.live.over, true);
      assert.deepEqual(end.table.seats.slice(0, 2).map((s) => s.stack), [1080, 920]);
    });

    await t.test('the chips are what the oracle-checked writer says', async () => {
      const bo = await state('bo');
      const hand = bo.hand.hand; // Bo saw Ava's aces at the showdown: every live card is known
      const { writePokerStarsHand } = await import(pathToFileURL(path.join(ROOT, 'vite-app', 'src', 'utils', 'hand-history', 'index.js')).href);
      const { goldenFinals } = await import(pathToFileURL(path.join(ROOT, 'test', 'hh-io', 'golden-finals.mjs')).href);
      const { finals } = goldenFinals(writePokerStarsHand(hand, { playedAt: new Date() }).text);
      assert.equal(finals.get('ham'), 1080);
      assert.equal(finals.get('ham5'), 920);
    });

    await t.test("no stream ever carried a card its viewer had not seen", async () => {
      await sleep(200);
      assert.ok(seats.avaStream.events.length > 5 && seats.boStream.events.length > 5, 'both streams got the hand');
      for (const e of seats.avaStream.events) assert.ok(!/Kc|Ks/.test(e.raw), "Ava's stream holds Bo's mucked kings");
      for (const e of seats.boStream.events) {
        const over = e.view.hand && e.view.hand.live && e.view.hand.live.over;
        if (!over) assert.ok(!/Ah|Ad/.test(e.raw), "Bo's stream holds Ava's aces before the showdown");
      }
      // Cards only from strings made of cards: the table's id is random hex, which can begin or end with "5d" or
      // "9c" (a quoted-text search failed about one run in eight on that).
      const cardsIn = (v, out = []) => {
        if (typeof v === 'string') { if (/^(?:[2-9TJQKA][hdcsx])+$/.test(v)) out.push(...(v.match(/[2-9TJQKA][hdcs]/g) || [])); }
        else if (Array.isArray(v)) v.forEach((x) => cardsIn(x, out));
        else if (v && typeof v === 'object') Object.values(v).forEach((x) => cardsIn(x, out));
        return out;
      };
      const undealt = new Set(DECK.slice(TOP.length));
      for (const e of [...seats.avaStream.events, ...seats.boStream.events]) for (const c of cardsIn(e.view)) assert.ok(!undealt.has(c), `undealt ${c} sent`);
    });

    await t.test('each player keeps the hand in Hands, as they saw it', async () => {
      const list = async (bearer) => (await call(S, 'GET', '/api/hands', null, bearer)).body;
      const avaList = await waitFor(async () => { const l = await list(AVA); return l.length ? l : null; }, "Ava's saved hand");
      const boList = await waitFor(async () => { const l = await list(BO); return l.length ? l : null; }, "Bo's saved hand");
      assert.equal(avaList[0].title, 'Test table · hand 1');
      const avaHand = JSON.parse((await call(S, 'GET', `/api/hands/${avaList[0].id}`, null, AVA)).body.hand_data);
      const boHand = JSON.parse((await call(S, 'GET', `/api/hands/${boList[0].id}`, null, BO)).body.hand_data);
      assert.equal(avaHand.streets[0].cards.hero, 'AhAd');
      assert.equal(avaHand.streets[0].cards.opponents[0], 'MUCK', "Bo's mucked kings are not in Ava's copy: marked mucked");
      assert.equal(boHand.streets[0].cards.hero, 'KcKs');
      assert.equal(boHand.streets[0].cards.opponents[0], 'AhAd', 'the winner showed');
      assert.equal(avaHand.table.handNo, 1);
      assert.equal(avaHand.streets[3].cards.board, '4d');
    });

    await t.test("chat: a reported message reaches Admin's inbox as the service holds it, and Remove takes it off the table", async () => {
      const said = await call(T, 'POST', `/tables/${table.id}/chat`, { text: 'rude words' }, seats.bo);
      assert.equal(said.status, 200, JSON.stringify(said.body));
      const msgId = said.body.id;
      const seen = (await call(T, 'GET', `/tables/${table.id}/state`, null, seats.ava)).body.chat;
      assert.equal(seen.find((m) => m.id === msgId).text, 'rude words');
      // Bo cannot report his own; Ava reports it, and the snapshot is the service's text, not anything she sends.
      assert.equal((await call(S, 'POST', `/api/tables/${table.id}/report`, { msgId }, BO)).status, 400);
      assert.equal((await call(S, 'POST', `/api/tables/${table.id}/report`, { msgId, text: 'abusive', snapshot: 'forged' }, AVA)).status, 201);
      assert.equal((await call(S, 'POST', `/api/tables/${table.id}/report`, { msgId: 1 }, AVA)).status, 404);
      const inbox = (await call(S, 'GET', '/api/admin/reports', null, AVA)).body.reports;
      const rep = inbox.find((r) => r.kind === 'table-message' && r.ref_id === msgId);
      assert.ok(rep, 'the report is in the inbox');
      assert.equal(rep.snapshot, 'rude words');
      assert.equal(rep.target_user_id, 102);
      assert.equal(rep.text, 'abusive');
      const rm = await call(S, 'PUT', `/api/admin/reports/${rep.id}`, { action: 'remove' }, AVA);
      assert.equal(rm.status, 200, JSON.stringify(rm.body));
      const after = (await call(T, 'GET', `/tables/${table.id}/state`, null, seats.bo)).body.chat;
      assert.ok(!after.some((m) => m.id === msgId), 'gone from the table');
      // The host mutes; a muted player cannot write.
      assert.equal((await call(T, 'POST', `/tables/${table.id}/mute`, { userId: 101 }, seats.bo)).status, 403);
      assert.equal((await call(T, 'POST', `/tables/${table.id}/mute`, { userId: 102 }, seats.ava)).status, 200);
      assert.equal((await call(T, 'POST', `/tables/${table.id}/chat`, { text: 'hi' }, seats.bo)).status, 400);
      assert.equal((await call(T, 'POST', `/tables/${table.id}/mute`, { userId: 102, muted: false }, seats.ava)).status, 200);
    });

    await t.test('posting to come in: only a seat waiting for the big blind may', async () => {
      const r = await call(T, 'POST', `/tables/${table.id}/post`, { on: true }, seats.ava);
      assert.equal(r.status, 409);
      assert.equal(r.body.error, 'You are already dealt in');
    });

    await t.test('play.futurega.me answers with the play page, never the app; its API is the same server', async () => {
      const get = (host, p, bearer) => new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: srv.port, path: p, headers: { host, ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) } }, (res) => {
          let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b, robots: res.headers['x-robots-tag'] }));
        }).on('error', reject);
      });
      for (const p of ['/', `/join/${invite}`, '/anything']) {
        const r = await get('play.test', p);
        assert.equal(r.status, 200, p);
        assert.ok(r.body.includes('<title>futurega.me | play</title>'), `${p}: the play page`);
        assert.equal(r.robots, 'noindex');
      }
      const app = await get(`127.0.0.1:${srv.port}`, '/');
      assert.ok(!app.body.includes('futurega.me | play'), 'futurega.me itself is the app');
      assert.equal((await get(`127.0.0.1:${srv.port}`, '/play.html')).status, 404, 'the play page is not on futurega.me');
      const api = await get('play.test', '/api/tables/availability', AVA);
      assert.equal(JSON.parse(api.body).on, true, 'the API answers on the play host');
    });

    await t.test('leaving returns the stack to the balance', async () => {
      assert.equal((await call(T, 'POST', `/tables/${table.id}/leave`, null, seats.ava)).status, 200);
      await waitFor(async () => (await call(S, 'GET', '/api/tables/chips', null, AVA)).body.balance === 20080, 'the cash-out');
    });
  } finally {
    for (const s of streams) s.close();
    await tables.stop();
    await srv.stop();
    scratch.cleanup();
  }
  t.done();
})().catch((e) => { console.error(e); process.exit(1); });
