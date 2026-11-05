// Saving a hand answers with its real id. It answered 0: last_insert_rowid() was read after saveDatabase(), whose
// db.export() resets it (a sql.js quirk), and a hand with id 0 looks unsaved to the app, so the next edit saved a
// second copy. The same order was wrong on the other saved-hand route, custom games and group invites.
//
//   node test/hand-save.test.js        (npm run test:hand-save; ports 4740-4749)
'use strict';
const assert = require('assert');
const { boot, createScratch, runner } = require('./helpers/scratch-server');

const SECRET = 'hand-save-test-secret';

(async () => {
  const { test, done } = runner('hand-save');
  const scratch = await createScratch();
  const srv = await boot(scratch.dbPath, { JWT_SECRET: SECRET }, { ports: [4740, 4749] });
  const api = async (method, p, body, token) => {
    const r = await fetch(`http://127.0.0.1:${srv.port}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    const reg = await api('POST', '/api/register', { username: 'savetest', email: 'save@x.test', password: 'a-long-test-password-1', realName: 'Save Test' });
    assert.strictEqual(reg.status, 201);
    const token = reg.json.token;
    const hand = (n) => ({ gameType: 'NLH', players: [{ name: 'A' }, { name: 'B' }], streets: [] });

    await test('a new replayer hand answers with its real id, and ids count up', async () => {
      const a = await api('POST', '/api/replayer/hands', { handData: hand(1), gameType: 'NLH', title: 'One' }, token);
      const b = await api('POST', '/api/replayer/hands', { handData: hand(2), gameType: 'NLH', title: 'Two' }, token);
      assert.strictEqual(a.status, 201);
      assert.ok(a.json.id > 0, 'id ' + a.json.id);
      assert.strictEqual(b.json.id, a.json.id + 1);
    });

    await test('editing with the id it answered changes that hand; no second copy appears', async () => {
      const a = await api('POST', '/api/replayer/hands', { handData: hand(3), gameType: 'NLH', title: 'Before' }, token);
      const before = (await api('GET', '/api/replayer/hands', null, token)).json.length;
      const put = await api('PUT', '/api/replayer/hands/' + a.json.id, { handData: hand(3), gameType: 'NLH', title: 'After' }, token);
      assert.strictEqual(put.status, 200);
      const list = (await api('GET', '/api/replayer/hands', null, token)).json;
      assert.strictEqual(list.length, before);
      assert.strictEqual(list.find((h) => h.id === a.json.id).title, 'After');
    });

    await test('the older hands route answers with its real id too', async () => {
      const a = await api('POST', '/api/hands', { handData: hand(4), gameType: 'NLH', title: 'Older' }, token);
      assert.strictEqual(a.status, 201);
      assert.ok(a.json.id > 0, 'id ' + a.json.id);
    });

    await test('a custom game answers with its real id', async () => {
      const a = await api('POST', '/api/replayer/games', { name: 'House game' }, token);
      assert.strictEqual(a.status, 201);
      assert.ok(a.json.id > 0, 'id ' + a.json.id);
    });
  } finally {
    await srv.stop();
    scratch.cleanup();
  }
  done();
})().catch((e) => { console.error(e); process.exit(1); });
