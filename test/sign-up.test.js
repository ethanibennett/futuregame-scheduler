'use strict';
// Sign-up and sign-in (Laws of UX picks 1 and 11, owner 2026-11-10), against server.js on a scratch port
// and a scratch database (test/helpers/scratch-server.js: ports 4760-4769, never 3001):
//   - Create Account takes a name, an email and a password: the username is made from the name
//     (pat.player, pat.player2 when taken, never a reserved admin name);
//   - an email signs in, and asks for a reset, whatever its case; it is kept in lower case, and an
//     older row kept as typed is lowered at boot.
//
//   node test/sign-up.test.js        (npm run test:sign-up)
const assert = require('assert');
const { boot, createScratch, runner, rowsOf, one } = require('./helpers/scratch-server');

const PORTS = [4760, 4769];

(async () => {
  const { test, done } = runner('sign-up.test.js');
  const sc = await createScratch({ prefix: 'fg-sign-up-', ports: PORTS });
  let srv = null;
  let base = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch (_) { /* not JSON */ }
    return { status: res.status, json };
  };
  try {
    srv = await boot(sc.dbPath, {}, { ports: PORTS });
    base = `http://127.0.0.1:${srv.port}`;

    await test('a name, an email and a password make an account; the username comes from the name', async () => {
      const r = await call('POST', '/api/register', { realName: 'Pat Player', email: 'Pat.Player@Example.TEST', password: 'sign-up-pass-1' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.json));
      assert.strictEqual(r.json.username, 'pat.player');
      assert.ok(r.json.token, 'signed in');
    });

    await test('a taken name gets the first free number', async () => {
      const r = await call('POST', '/api/register', { realName: 'Pat  Player', email: 'other.pat@example.test', password: 'sign-up-pass-1' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.json));
      assert.strictEqual(r.json.username, 'pat.player2');
    });

    await test('a reserved admin name is never made', async () => {
      const r = await call('POST', '/api/register', { realName: 'Ham', email: 'ham.someone@example.test', password: 'sign-up-pass-1' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.json));
      assert.notStrictEqual(r.json.username.toLowerCase(), 'ham');
      assert.match(r.json.username, /^ham\d+$/);
    });

    await test('accents and punctuation fold into a username the rules allow', async () => {
      const r = await call('POST', '/api/register', { realName: "Zoë O'Brien-Núñez", email: 'zoe@example.test', password: 'sign-up-pass-1' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.json));
      assert.match(r.json.username, /^[a-z0-9._-]{2,20}$/);
      assert.ok(r.json.username.startsWith('zoe.o.brien'), r.json.username);
    });

    await test('an explicit username still works as before', async () => {
      const r = await call('POST', '/api/register', { username: 'chosen_name', realName: 'Chosen', email: 'chosen@example.test', password: 'sign-up-pass-1' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.json));
      assert.strictEqual(r.json.username, 'chosen_name');
    });

    await test('the email signs in whatever its case', async () => {
      for (const email of ['pat.player@example.test', 'PAT.PLAYER@EXAMPLE.TEST', '  Pat.Player@example.test ']) {
        const r = await call('POST', '/api/login', { email, password: 'sign-up-pass-1' });
        assert.strictEqual(r.status, 200, `${email}: ${JSON.stringify(r.json)}`);
        assert.strictEqual(r.json.username, 'pat.player');
      }
      assert.strictEqual((await call('POST', '/api/login', { email: 'PAT.PLAYER@example.test', password: 'wrong-pass-1' })).status, 401);
    });

    await test('a reset is asked for whatever the case', async () => {
      const r = await call('POST', '/api/forgot-password', { email: 'PAT.Player@EXAMPLE.test' });
      assert.strictEqual(r.status, 200);
    });

    await srv.stop();
    let db = sc.open();
    await test('the address is kept in lower case, and the reset link was made for it', async () => {
      assert.strictEqual(one(db, "SELECT email FROM users WHERE username = 'pat.player'"), 'pat.player@example.test');
      const uid = one(db, "SELECT id FROM users WHERE username = 'pat.player'");
      assert.strictEqual(one(db, 'SELECT COUNT(*) FROM password_resets WHERE user_id = ?', [uid]), 1);
    });

    // An older row kept as typed, and a pair that differs only in case.
    db.run("UPDATE users SET email = 'Chosen@Example.TEST' WHERE username = 'chosen_name'");
    db.run("UPDATE users SET email = 'Zoe@Example.test' WHERE username LIKE 'zoe%'");
    db.run("UPDATE users SET email = 'ZOE@example.test' WHERE username = 'pat.player2'");
    sc.save(db);
    srv = await boot(sc.dbPath, {}, { ports: PORTS });
    base = `http://127.0.0.1:${srv.port}`;
    await test('an older address is lowered at boot; it signs in in any case', async () => {
      const r = await call('POST', '/api/login', { email: 'chosen@example.test', password: 'sign-up-pass-1' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });
    await srv.stop();
    db = sc.open();
    await test('a case-only twin pair is left as typed', async () => {
      assert.strictEqual(one(db, "SELECT email FROM users WHERE username = 'chosen_name'"), 'chosen@example.test');
      const twins = rowsOf(db, "SELECT email FROM users WHERE LOWER(email) = 'zoe@example.test' ORDER BY id").map((r) => r.email);
      assert.deepStrictEqual(twins.sort(), ['ZOE@example.test', 'Zoe@Example.test'].sort());
    });
  } catch (err) {
    console.log('  FAIL setup\n       ' + (err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n       ') : err));
    process.exitCode = 1;
  } finally {
    if (srv) await srv.stop();
    sc.cleanup();
  }
  if (process.exitCode) process.exit(1);
  done();
})();
