// The settling-day Discord DM (lib/discord-settle.js), against a stand-in Discord on localhost: the gate,
// the message, the two API calls (the token in the header only), one reminder per Sunday, and the test
// send. No real Discord, no real token: every value here is made up.
//
//   node test/discord-settle.test.js        (npm run test:discord-settle)
'use strict';
const assert = require('assert');
const http = require('http');
const initSqlJs = require('sql.js');

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e && e.message}`); }
}

(async () => {
  const calls = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/users/@me/channels') return res.end(JSON.stringify({ id: '777' }));
      if (req.url === '/channels/777/messages') return res.end(JSON.stringify({ id: '1' }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  process.env.DISCORD_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  const ds = require('../lib/discord-settle');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const ENV = { RENDER: 'true', DISCORD_BOT_TOKEN: 'made-up-bot-token', DISCORD_USER_ID: '123456789012345678' };
  const backers = [
    { name: 'Sam Okafor', cumulativeCents: 734890 },
    { name: 'Dan Whitcombe', cumulativeCents: -49925 },
    { name: 'Priya Raman', cumulativeCents: 0 },
  ];
  const sunday = Date.UTC(2026, 9, 25, 13, 0); // Sun 25 Oct 2026, 09:00 New York

  await test('off without the token or the user id, and off locally without RENDER or DISCORD_DM', () => {
    assert.strictEqual(ds.decision({ RENDER: 'true' }).on, false);
    assert.strictEqual(ds.decision({ RENDER: 'true', DISCORD_BOT_TOKEN: 'x' }).on, false);
    assert.strictEqual(ds.decision({ DISCORD_BOT_TOKEN: 'x', DISCORD_USER_ID: '123456' }).on, false);
    assert.strictEqual(ds.decision({ DISCORD_BOT_TOKEN: 'x', DISCORD_USER_ID: '123456', DISCORD_DM: '1' }).on, true);
    assert.strictEqual(ds.decision({ ...ENV, DISCORD_DM: '0' }).on, false);
    assert.strictEqual(ds.decision(ENV).on, true);
  });
  await test('the message: who pays whom, $0 backers left out, nothing when everyone is at $0', () => {
    assert.strictEqual(ds.reminderText(backers), '**Settling today at noon ET:**\n• You pay Sam Okafor $7,349\n• Dan Whitcombe pays you $499');
    assert.strictEqual(ds.reminderText([{ name: 'A', cumulativeCents: 40 }]), null, 'under a dollar reads $0');
  });
  await test('the Sunday run DMs once: the channel, then the message, the token in the header only', async () => {
    calls.length = 0;
    const r = await ds.runReminder(db, { backers: () => backers, nowMs: sunday, env: ENV });
    assert.deepStrictEqual(r, { sent: true, why: 'sent' });
    assert.deepStrictEqual(calls.map((c) => c.url), ['/users/@me/channels', '/channels/777/messages']);
    assert.strictEqual(calls[0].body.recipient_id, ENV.DISCORD_USER_ID);
    assert.ok(calls.every((c) => c.auth === 'Bot made-up-bot-token'));
    assert.ok(calls.every((c) => !c.url.includes('made-up-bot-token')));
    assert.match(calls[1].body.content, /You pay Sam Okafor \$7,349/);
    assert.ok(!/\/b\//.test(calls[1].body.content), 'no page link');
    const again = await ds.runReminder(db, { backers: () => backers, nowMs: sunday + 3600e3, env: ENV });
    assert.deepStrictEqual(again, { sent: false, why: 'already sent today' });
  });
  await test('everyone at $0: nothing sent; the owner’s test still sends, marked as a test', async () => {
    calls.length = 0;
    const nextSunday = sunday + 7 * 86400e3;
    const r = await ds.runReminder(db, { backers: () => [{ name: 'P', cumulativeCents: 0 }], nowMs: nextSunday, env: ENV });
    assert.deepStrictEqual(r, { sent: false, why: 'every backer is at $0' });
    assert.strictEqual(calls.length, 0);
    const t = await ds.runReminder(db, { backers: () => backers, nowMs: nextSunday, env: ENV, force: true });
    assert.strictEqual(t.sent, true);
    assert.match(calls[1].body.content, /^_\(test\)_ /);
  });

  stub.close();
  console.log(`\ndiscord-settle.test.js - ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
