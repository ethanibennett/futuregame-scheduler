'use strict';
// The privacy fixes (owner, 2026-11-10), end to end against server.js on a scratch port and a scratch
// database (test/helpers/scratch-server.js: ports 4740-4749, never 3001, never poker-tournaments.db):
//   - a plan marked private never leaves the server for anyone but its player: not by the share
//     link, not to a friend;
//   - a Didn't play marker is left out of the share link, a friend's view and a group's schedule,
//     and a Personal day's note (a flight, a booking code) is the player's alone;
//   - a guest has no schedule on the server: its writes are refused and its list is empty, even
//     with rows an older build wrote under the shared guest id 0;
//   - a password reset ends every session signed before it, and only that account's; signing in
//     again works; Sign out clears the session cookie.
//
//   node test/privacy.test.js        (npm run test:privacy)
const assert = require('assert');
const { boot, createScratch, runner, rowsOf, one } = require('./helpers/scratch-server');

const PORTS = [4740, 4749];

(async () => {
  const { test, done } = runner('privacy.test.js');
  const sc = await createScratch({ prefix: 'fg-privacy-', ports: PORTS });
  let srv = null;
  let base = '';
  const call = async (method, p, { token, body, headers = {} } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
    return { status: res.status, json, headers: res.headers };
  };
  try {
    // ── Seed. Two feed events; two accounts, made through the API so their passwords are real. ──
    let db = sc.open();
    db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue)
            VALUES ('7', 'NLH Main Event - Day 1', 'December 1, 2099', '12:00 PM', 1000, 'NLH', 'Privacy Test Series')`);
    db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue)
            VALUES ('8', 'NLH Main Event - Day 2', 'December 2, 2099', '12:00 PM', 0, 'NLH', 'Privacy Test Series')`);
    const day1 = one(db, "SELECT id FROM tournaments WHERE event_number = '7'");
    const day2 = one(db, "SELECT id FROM tournaments WHERE event_number = '8'");
    sc.save(db);

    srv = await boot(sc.dbPath, {}, { ports: PORTS });
    base = `http://127.0.0.1:${srv.port}`;
    const reg = async (username, email) => {
      const r = await call('POST', '/api/register', { body: { username, email, password: 'privacy-pass-1', realName: username } });
      assert.strictEqual(r.status, 201, JSON.stringify(r.json));
      return r.json;
    };
    const marcus = await reg('marcusp', 'marcus@privacy.test');
    const dana = await reg('danak', 'dana@privacy.test');
    const M = marcus.token;
    for (const id of [day1, day2]) assert.strictEqual((await call('POST', '/api/schedule', { token: M, body: { tournamentId: id } })).status, 200);
    assert.strictEqual((await call('PUT', `/api/schedule/${day1}/condition`, { token: M, body: { conditions: [{ type: 'profit', profitThreshold: 20000 }], isPublic: false } })).status, 200);
    assert.strictEqual((await call('PUT', `/api/schedule/${day2}/condition`, { token: M, body: { conditions: [{ type: 'bag', dependsOnId: day1 }], isPublic: true } })).status, 200);
    assert.strictEqual((await call('POST', '/api/personal-event', { token: M, body: { date: '2099-11-29', type: 'Travel Day', notes: 'PHL to LAS, AA 1234, conf. KX7Q2P' } })).status, 201);
    assert.strictEqual((await call('POST', '/api/personal-event', { token: M, body: { date: '2099-12-03', type: "Didn't play", notes: '' } })).status, 201);
    const share = (await call('POST', '/api/share-token', { token: M })).json.token;
    assert.ok(share, 'a share token');
    await srv.stop();

    // Friends, a group of the two, a reset link for Marcus, and a row an older build saved under the
    // guest id 0.
    db = sc.open();
    db.run("INSERT INTO share_requests (from_user_id, to_user_id, status) VALUES (?, ?, 'accepted')", [marcus.userId, dana.userId]);
    db.run('INSERT INTO groups (name, created_by) VALUES (?, ?)', ['Vegas Crew', marcus.userId]);
    const gid = one(db, "SELECT id FROM groups WHERE name = 'Vegas Crew'");
    db.run("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin'), (?, ?, 'member')", [gid, marcus.userId, gid, dana.userId]);
    db.run('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)', [marcus.userId, 'privacy-reset-link', new Date(Date.now() + 3600e3).toISOString()]);
    db.run('INSERT INTO user_schedules (user_id, tournament_id) VALUES (0, ?)', [day1]);
    sc.save(db);
    srv = await boot(sc.dbPath, {}, { ports: PORTS });
    base = `http://127.0.0.1:${srv.port}`;

    const isTravel = (t) => t.venue === 'Personal' && t.event_name === 'Travel Day';
    const isDnp = (t) => t.venue === 'Personal' && t.event_name === "Didn't play";
    const heldBack = (rows, who) => {
      assert.ok(Array.isArray(rows) && rows.length === 3, `${who}: Day 1, Day 2 and the Travel Day, got ${JSON.stringify(rows && rows.map((t) => t.event_name))}`);
      assert.ok(!rows.some(isDnp), `${who}: no Didn't play marker`);
      const d1 = rows.find((t) => t.id === day1);
      const d2 = rows.find((t) => t.id === day2);
      assert.strictEqual(d1.conditions_json, null, `${who}: the private plan is not sent`);
      assert.ok(d2.conditions_json && /bag/.test(d2.conditions_json), `${who}: the public plan is`);
      assert.strictEqual(rows.find(isTravel).notes, null, `${who}: the Travel Day's note is not sent`);
    };

    await test('the share link, signed out: no private plan, no Didn\'t play marker, no Travel Day note', async () => {
      const r = await call('GET', `/api/shared/${share}`);
      assert.strictEqual(r.status, 200);
      heldBack(r.json.tournaments, 'share link');
    });

    await test('a friend\'s view: the same held back', async () => {
      const r = await call('GET', `/api/schedule/${marcus.userId}`, { token: dana.token });
      assert.strictEqual(r.status, 200);
      heldBack(r.json, 'friend');
    });

    await test('the player\'s own views keep everything', async () => {
      for (const p of [`/api/schedule/${marcus.userId}`, '/api/my-schedule']) {
        const rows = (await call('GET', p, { token: M })).json;
        assert.strictEqual(rows.length, 4, `${p}: all four rows`);
        assert.ok(/20000/.test(rows.find((t) => t.id === day1).conditions_json), `${p}: the private plan`);
        assert.strictEqual(rows.find(isTravel).notes, 'PHL to LAS, AA 1234, conf. KX7Q2P', `${p}: the note`);
        assert.ok(rows.some(isDnp), `${p}: the marker`);
      }
    });

    await test('a group\'s schedule: no Didn\'t play marker, no Travel Day note', async () => {
      const r = await call('GET', `/api/groups/${gid}/schedule`, { token: dana.token });
      assert.strictEqual(r.status, 200);
      assert.ok(!r.json.some(isDnp), 'no marker');
      // A group's schedule lists events only, no Personal days (App improvements 358), so the note cannot leak.
      assert.ok(!r.json.some(isTravel), 'no Travel Day at all');
      assert.ok(!r.json.some((t) => t.venue === 'Personal'), 'no Personal day');
    });

    await test('a guest: no schedule on the server, writes refused, older id-0 rows never served', async () => {
      const g = (await call('POST', '/api/guest-login')).json.token;
      assert.ok(g);
      assert.deepStrictEqual((await call('GET', '/api/my-schedule', { token: g })).json, []);
      assert.strictEqual((await call('POST', '/api/schedule', { token: g, body: { tournamentId: day2 } })).status, 403);
      assert.strictEqual((await call('DELETE', `/api/schedule/${day1}`, { token: g })).status, 403);
      assert.strictEqual((await call('PUT', `/api/schedule/${day1}/condition`, { token: g, body: { conditions: [{ type: 'bag' }] } })).status, 403);
      assert.strictEqual((await call('PUT', `/api/schedule/${day1}/anchor`, { token: g, body: { isAnchor: true } })).status, 403);
      assert.strictEqual((await call('PUT', `/api/schedule/${day1}/entries`, { token: g, body: { plannedEntries: 2 } })).status, 403);
      assert.strictEqual((await call('DELETE', `/api/schedule/${day1}/condition`, { token: g })).status, 403);
    });

    await test('a password reset ends the old sessions, only that account\'s; signing in again works', async () => {
      assert.strictEqual((await call('GET', '/api/my-schedule', { token: M })).status, 200, 'before the reset');
      const r = await call('POST', '/api/reset-password', { body: { token: 'privacy-reset-link', password: 'privacy-pass-2' } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const old = await call('GET', '/api/my-schedule', { token: M });
      assert.strictEqual(old.status, 401, 'the old token is refused');
      assert.match(old.json.error, /password was changed/);
      assert.strictEqual((await call('GET', '/api/my-schedule', { token: dana.token })).status, 200, 'another account is untouched');
      const again = await call('POST', '/api/login', { body: { email: 'marcus@privacy.test', password: 'privacy-pass-2' } });
      assert.strictEqual(again.status, 200);
      assert.strictEqual((await call('GET', '/api/my-schedule', { token: again.json.token })).status, 200, 'the new session works');
      assert.strictEqual((await call('POST', '/api/login', { body: { email: 'marcus@privacy.test', password: 'privacy-pass-1' } })).status, 401, 'the old password does not');
    });

    await test('Sign out clears the session cookie', async () => {
      const r = await call('POST', '/api/logout');
      assert.strictEqual(r.status, 200);
      assert.match(r.headers.get('set-cookie') || '', /fg_session=;.*Expires=Thu, 01 Jan 1970/);
    });

    await srv.stop();
    db = sc.open();
    await test('the reset bumped only that account\'s session version', async () => {
      const v = rowsOf(db, 'SELECT username, token_version FROM users ORDER BY id');
      assert.deepStrictEqual(v.map((u) => [u.username, u.token_version]), [['marcusp', 1], ['danak', 0]]);
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
