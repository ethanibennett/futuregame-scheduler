'use strict';
// node test/watch.test.js — hands said on the Apple Watch (owner, 2026-11-19: "Apple Watch: dictation through
// quick add"; lib/watch.js). Part 1 boots server.js on a scratch port (no ANTHROPIC_API_KEY: a hand is kept,
// not read): pairing by code, the one-time token, the Watch's hand in the phone's inbox, unpairing. Part 2
// mounts the routes on a bare app with a stand-in parser: the summary the Watch shows. Names are made up.
const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');
const initSqlJs = require('sql.js');
const { createScratch, boot, runner } = require('./helpers/scratch-server');
const watch = require('../lib/watch');
const { validateParseBody } = require('../lib/quick-add');

const SECRET = 'backer-surface-test-secret-not-for-prod';

(async () => {
  const t = runner('watch');
  const scratch = await createScratch({ prefix: 'fg-watch-' });
  // Admin names are reserved at sign-up: the admin account goes into the database before the server boots.
  {
    const d = scratch.open();
    d.run("INSERT INTO users (username, email, password, created_at) VALUES ('ham5', 'watchadmin@example.test', 'x', datetime('now'))");
    scratch.save(d);
  }
  const srv = await boot(scratch.dbPath, {}, {});
  const base = `http://127.0.0.1:${srv.port}`;
  const call = async (method, p, { token, body } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  try {
    // An ordinary account, and a token for the scratch database's own ham5 account (one of quick add's admins):
    // the Watch's checks look the account up by its id, so the token must carry ham5's real id.
    await call('POST', '/api/register', { body: { username: 'watchprobe', email: 'watchprobe@example.test', password: 'watch-probe-pw-1', realName: 'W P' } });
    const plain = (await call('POST', '/api/login', { body: { email: 'watchprobe@example.test', password: 'watch-probe-pw-1' } })).body.token;
    const claims = JSON.parse(Buffer.from(plain.split('.')[1], 'base64url').toString());
    const seeded = scratch.open().exec("SELECT id FROM users WHERE username = 'ham5'");
    void boot;
    const adminId = seeded.length && seeded[0].values.length ? seeded[0].values[0][0] : null;
    assert.ok(adminId != null, 'the scratch database has a ham5 account');
    // No session id: a sid names the probe's session, and the server refuses it for another account.
    const { sid: _sid, ...rest } = claims;
    void _sid;
    const admin = jwt.sign({ ...rest, id: adminId, username: 'ham5', tv: 0 }, SECRET, { algorithm: 'HS256' });

    let pair, watchToken;
    await t.test('the Watch asks for a code: six digits, waiting', async () => {
      const r = await call('POST', '/api/watch/pair', { body: { device: 'Probe Watch' } });
      assert.strictEqual(r.status, 200);
      assert.match(r.body.code, /^\d{6}$/);
      pair = r.body;
      const w = await call('GET', '/api/watch/pair/' + pair.pairId);
      assert.strictEqual(w.body.status, 'waiting');
    });
    await t.test('only a quick add admin can claim it, and only with the right code', async () => {
      assert.strictEqual((await call('POST', '/api/watch/pair/claim', { token: plain, body: { code: pair.code } })).status, 403);
      const wrong = String((Number(pair.code) + 1) % 1e6).padStart(6, '0');
      assert.strictEqual((await call('POST', '/api/watch/pair/claim', { token: admin, body: { code: wrong } })).status, 404);
      assert.strictEqual((await call('POST', '/api/watch/pair/claim', { token: admin, body: { code: '12' } })).status, 400);
      const ok = await call('POST', '/api/watch/pair/claim', { token: admin, body: { code: pair.code } });
      assert.strictEqual(ok.status, 200);
      assert.strictEqual(ok.body.device, 'Probe Watch');
    });
    await t.test('the Watch gets its token once; the code cannot be claimed again', async () => {
      const w = await call('GET', '/api/watch/pair/' + pair.pairId);
      assert.strictEqual(w.body.status, 'paired');
      assert.match(w.body.token, /^fgw_[0-9a-f]{64}$/);
      watchToken = w.body.token;
      assert.strictEqual((await call('GET', '/api/watch/pair/' + pair.pairId)).status, 404);
      assert.strictEqual((await call('POST', '/api/watch/pair/claim', { token: admin, body: { code: pair.code } })).status, 404);
    });
    await t.test('a Watch token opens the Watch routes only, and an app token does not open them', async () => {
      assert.ok([401, 403].includes((await call('GET', '/api/quick-add/inbox', { token: watchToken })).status));
      assert.strictEqual((await call('GET', '/api/watch/hands', { token: admin })).status, 401);
      assert.strictEqual((await call('GET', '/api/watch/hands')).status, 401);
    });
    let handId;
    await t.test('a hand said on the Watch is kept at once (no parser here) and waits on the phone', async () => {
      const text = 'one three live I raise to fifteen on the button with ace king of spades the big blind calls';
      const r = await call('POST', '/api/watch/hands', { token: watchToken, body: { text } });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.kept, true);
      assert.strictEqual(r.body.status, 'new');
      handId = r.body.id;
      const list = await call('GET', '/api/watch/hands', { token: watchToken });
      assert.strictEqual(list.body.hands[0].id, handId);
      const inbox = await call('GET', '/api/quick-add/inbox', { token: admin });
      assert.strictEqual(inbox.status, 200);
      assert.strictEqual(inbox.body.hands[0].text, text);
      assert.strictEqual((await call('POST', '/api/watch/hands', { token: watchToken, body: { text: '   ' } })).status, 400);
    });
    await t.test('Done takes it out of the inbox', async () => {
      assert.strictEqual((await call('POST', `/api/quick-add/inbox/${handId}/done`, { token: admin })).status, 200);
      const inbox = await call('GET', '/api/quick-add/inbox', { token: admin });
      assert.strictEqual(inbox.body.hands.length, 0);
    });
    await t.test('Unpair ends the Watch token at once', async () => {
      const d = await call('GET', '/api/watch/devices', { token: admin });
      assert.strictEqual(d.body.devices.length, 1);
      assert.strictEqual((await call('DELETE', '/api/watch/devices/' + d.body.devices[0].id, { token: admin })).status, 200);
      assert.strictEqual((await call('GET', '/api/watch/hands', { token: watchToken })).status, 401);
      assert.strictEqual((await call('GET', '/api/watch/devices', { token: admin })).body.devices.length, 0);
    });
  } finally {
    await srv.stop();
    scratch.cleanup && scratch.cleanup();
  }

  // Part 2: the read hand and what the Watch is told, with a stand-in parser.
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
  db.run("INSERT INTO users (id, username) VALUES (7, 'ham5')");
  watch.migrate(db);
  const app = express();
  app.use(express.json());
  const user = { id: 7, username: 'ham5' };
  let parsed = 0;
  watch.mountRoutes(app, {
    getDb: () => db, saveDatabase: () => {}, authenticateToken: (req, res, next) => { req.user = user; next(); }, requireRegistered: (req, res, next) => next(),
    isAdmin: (u) => u.username === 'ham5', getClient: () => ({}), validateParseBody, log: { log() {}, error() {} },
    parseHand: async ({ source }) => {
      parsed++;
      assert.strictEqual(source, 'speech');
      return {
        hand: {
          gameType: 'NLH', gameMode: 'cash', blinds: { sb: 1, bb: 3, ante: 0 }, heroIdx: 0,
          players: [{ name: 'Hero', position: 'BTN', startingStack: 300 }, { name: 'Opp 1', position: 'BB', startingStack: 300 }],
          streets: [
            { name: 'Preflop', cards: { hero: 'AsKs', opponents: [''], board: '' }, actions: [{ player: 0, action: 'raise', amount: 15 }, { player: 1, action: 'call', amount: 12 }], draws: [] },
            { name: 'Flop', cards: { hero: '', opponents: [''], board: 'Kd7c2h' }, actions: [{ player: 1, action: 'check', amount: 0 }, { player: 0, action: 'bet', amount: 20 }, { player: 1, action: 'call', amount: 20 }], draws: [] },
          ],
          result: null,
        },
        notes: [],
      };
    },
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    db.run('INSERT INTO watch_tokens (user_id, token_hash, device, created_at) VALUES (7, ?, ?, ?)', [require('crypto').createHash('sha256').update('fgw_' + 'a'.repeat(64)).digest('hex'), 'W', Date.now()]);
    const r = await fetch(`http://127.0.0.1:${port}/api/watch/hands`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer fgw_' + 'a'.repeat(64) }, body: JSON.stringify({ text: 'one three I raise to fifteen with ace king of spades' }) });
    const body = await r.json();
    await t.test('a read hand: the Watch is told the game, the cards and what is left to answer', () => {
      assert.strictEqual(parsed, 1);
      assert.strictEqual(body.status, 'parsed');
      assert.strictEqual(body.summary.title, 'NLH 1/3');
      assert.deepStrictEqual(body.summary.lines.slice(0, 2), ['You: As Ks', 'Board: Kd 7c 2h']);
      assert.ok(Number.isInteger(body.summary.questions), 'the gaps engine counted the questions');
      assert.match(body.summary.next, /Hands/);
    });
    await t.test('the phone gets the read hand to finish in Quick Add', async () => {
      const inbox = await (await fetch(`http://127.0.0.1:${port}/api/quick-add/inbox`)).json();
      assert.strictEqual(inbox.hands[0].status, 'parsed');
      assert.strictEqual(inbox.hands[0].hand.gameType, 'NLH');
    });
  } finally {
    server.close();
  }
  t.done();
})().catch((e) => { console.error(e); process.exit(1); });
