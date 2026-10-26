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

  // ── Sunday noon, both parties (owner, 2026-10-25) ──
  const noon = Date.UTC(2026, 10, 1, 17, 0); // Sun 1 Nov 2026, 12:00 New York (EST)
  const noonBackers = [
    { name: 'Sam Okafor', dueCents: 734890, token: 'TokSam00001' },
    { name: 'Dan Whitcombe', dueCents: -49925, token: 'TokDan00001' },
    { name: 'Priya Raman', dueCents: 0, token: 'TokPri00001' },
    { name: 'Lee Nogood', dueCents: 10000, token: 'TokLee00001' },
  ];
  await test('a backer\'s Discord id: digits only, set and cleared, shown by its last four', () => {
    assert.strictEqual(ds.setBackerDiscord(db, 'TokSam00001', 'not-an-id').ok, false);
    assert.strictEqual(ds.setBackerDiscord(db, 'TokSam00001', '111111111111111111').ok, true);
    assert.strictEqual(ds.setBackerDiscord(db, 'TokDan00001', '222222222222223333').ok, true);
    assert.strictEqual(ds.discordHint(db, 'TokDan00001'), '3333');
    assert.strictEqual(ds.setBackerDiscord(db, 'TokPri00001', '444444444444444444').ok, true);
    assert.deepStrictEqual(ds.setBackerDiscord(db, 'TokPri00001', ''), { ok: true, cleared: true });
    assert.strictEqual(ds.backerDiscordId(db, 'TokPri00001'), null);
  });
  await test('the gentle texts: each backer in their own terms; the player hears who pays whom and who was reached', () => {
    assert.strictEqual(ds.noonBackerText(noonBackers[0]), 'Hi Sam, a gentle reminder that today is settling day. Ethan owes you $7,349 for the week. Once it arrives, press Settled on your page.');
    assert.strictEqual(ds.noonBackerText(noonBackers[1]), 'Hi Dan, a gentle reminder that today is settling day. The week comes to $499 from you to Ethan. Once it is sent, press Settled on your page, or Partial payment if it goes in parts.');
    assert.strictEqual(ds.noonBackerText(noonBackers[2]), null);
    assert.strictEqual(ds.noonPlayerText(noonBackers, ['Sam Okafor']),
      '**A gentle reminder: it is settling day.**\n• You pay Sam Okafor $7,349\n• Dan Whitcombe pays you $499\n• You pay Lee Nogood $100\nReminded on Discord: Sam Okafor.');
  });
  await test('the owner\'s test goes to the player only, never to a backer', async () => {
    calls.length = 0;
    const r = await ds.runNoonReminder(db, { backers: () => noonBackers, nowMs: noon, env: ENV, force: true });
    assert.strictEqual(r.sent, true);
    const opens = calls.filter((c) => c.url === '/users/@me/channels');
    assert.deepStrictEqual(opens.map((c) => c.body.recipient_id), [ENV.DISCORD_USER_ID]);
    const text = calls.find((c) => c.url === '/channels/777/messages').body.content;
    assert.match(text, /^_\(test\)_ /);
    assert.match(text, /Lee Nogood \(no Discord id on file, would not be sent\)/);
  });
  await test('Sunday noon: each backer with an id and a balance gets their DM, then the player; once per Sunday', async () => {
    calls.length = 0;
    const r = await ds.runNoonReminder(db, { backers: () => noonBackers, nowMs: noon, env: ENV });
    assert.deepStrictEqual([r.sent, r.reached, r.missing, r.failed], [true, ['Sam Okafor', 'Dan Whitcombe'], ['Lee Nogood'], []]);
    const opens = calls.filter((c) => c.url === '/users/@me/channels').map((c) => c.body.recipient_id);
    assert.deepStrictEqual(opens, ['111111111111111111', '222222222222223333', ENV.DISCORD_USER_ID]);
    const texts = calls.filter((c) => c.url === '/channels/777/messages').map((c) => c.body.content);
    assert.match(texts[0], /^Hi Sam/);
    assert.match(texts[1], /^Hi Dan/);
    assert.match(texts[2], /Reminded on Discord: Sam Okafor, Dan Whitcombe\./);
    assert.ok(texts.every((t) => !/\/b\//.test(t) && !/Tok[A-Z]/.test(t)), 'no link, no token');
    calls.length = 0;
    const again = await ds.runNoonReminder(db, { backers: () => noonBackers, nowMs: noon + 600e3, env: ENV });
    assert.strictEqual(calls.length, 0, 'nobody hears twice');
    assert.strictEqual(again.why, 'already sent today');
  });
  await test('everyone at $0: nothing at noon', async () => {
    calls.length = 0;
    const r = await ds.runNoonReminder(db, { backers: () => [{ name: 'P', dueCents: 0, token: 'TokP0000001' }], nowMs: noon + 7 * 86400e3, env: ENV });
    assert.deepStrictEqual([r.sent, r.why, calls.length], [false, 'every backer is at $0', 0]);
  });

  stub.close();
  console.log(`\ndiscord-settle.test.js - ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
