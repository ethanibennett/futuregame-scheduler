// The session bridge end to end, without Claude Code: the relay (lib/session-bridge.js) on a scratch server,
// chat's MCP tools (lib/mcp: session_send / session_read / session_approve / session_status) through the SDK's
// HTTP client, and the PC's channel (scripts/session-bridge-channel.mjs) spawned over stdio with an SDK client
// standing in for Claude Code: it must receive the message as notifications/claude/channel, its `reply` must
// reach chat, and a permission request must round-trip to a verdict. Scratch ports 4800-4809.
//
//   node test/session-bridge.test.js        (npm run test:session-bridge)
'use strict';
const assert = require('assert');
const path = require('path');
const { createScratch, boot, runner } = require('./helpers/scratch-server');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const PORTS = [4800, 4809];
const PW = 'session-bridge-test-password-1';
const MCP_TOKEN = 'BridgeMcpToken0123456789';
const BRIDGE_TOKEN = 'BridgeRelayToken0123456789abcdefXYZ';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(100); }
  return null;
}

(async () => {
  const { test, done } = runner('session-bridge.test.js');
  const scratch = await createScratch({ ports: PORTS, prefix: 'fg-bridge-' });
  const servers = [], clients = [];
  try {
    let srv = await boot(scratch.dbPath, {}, { ports: PORTS });
    servers.push(srv);
    await fetch(`http://127.0.0.1:${srv.port}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'bridgex', email: 'bridgex@x.test', password: PW, realName: 'Bridge' }) });
    await test('without BRIDGE_TOKEN the relay is off (404) and says so', async () => {
      assert.ok(srv.log().includes('[session-bridge] OFF'));
      const r = await fetch(`http://127.0.0.1:${srv.port}/api/session-bridge/inbox`, { headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` } });
      assert.strictEqual(r.status, 404);
    });
    await srv.stop();
    { const db = scratch.open(); db.run("UPDATE users SET username = 'ham' WHERE username = 'bridgex'"); scratch.save(db); db.close(); }
    const owner = (() => { const db = scratch.open(); try { return db.exec("SELECT id FROM users WHERE username = 'ham'")[0].values[0][0]; } finally { db.close(); } })();
    srv = await boot(scratch.dbPath, { MCP_TOKEN, BRIDGE_TOKEN, CONSOLE_OWNER_USER_ID: String(owner) }, { ports: PORTS });
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.port}`;

    const chat = new Client({ name: 'chat', version: '1.0.0' });
    await chat.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${MCP_TOKEN}`)));
    clients.push(chat);
    const call = async (name, args = {}) => {
      const r = await chat.callTool({ name, arguments: args });
      if (r.isError) return { isError: true, message: r.content[0].text };
      return { ...JSON.parse(r.content[0].text), isError: false };
    };

    await test('the relay is on; a wrong token is a 404; the token is never logged', async () => {
      assert.ok(srv.log().includes('[session-bridge] ON'));
      assert.ok(!srv.log().includes(BRIDGE_TOKEN));
      const bad = await fetch(`${base}/api/session-bridge/inbox`, { headers: { Authorization: 'Bearer WrongToken0123456789abcdefghijklmnop' } });
      assert.strictEqual(bad.status, 404);
    });

    await test('chat sends before the session is up: queued, session offline', async () => {
      const st = await call('session_status');
      assert.deepStrictEqual([st.bridgeOn, st.sessionOnline], [true, false]);
      const sent = await call('session_send', { text: 'Run the backer tests and tell me how they went.' });
      assert.deepStrictEqual([typeof sent.queued, sent.sessionOnline], ['number', false]);
    });

    // The channel, spawned as Claude Code would spawn it, with a client standing in for Claude Code.
    const got = [];
    const cc = new Client({ name: 'claude-code-standin', version: '1.0.0' });
    cc.fallbackNotificationHandler = async (n) => { got.push(n); };
    await cc.connect(new StdioClientTransport({
      command: process.execPath, args: [path.join(__dirname, '..', 'scripts', 'session-bridge-channel.mjs')],
      env: { ...process.env, SESSION_BRIDGE_URL: base, SESSION_BRIDGE_TOKEN: BRIDGE_TOKEN, SESSION_BRIDGE_POLL_MS: '300' },
      stderr: 'pipe',
    }));
    clients.push(cc);

    await test('the channel declares itself a two-way channel with the permission relay, and offers reply', async () => {
      const caps = cc.getServerCapabilities();
      assert.ok(caps.experimental && caps.experimental['claude/channel'] && caps.experimental['claude/channel/permission']);
      assert.match(cc.getInstructions(), /reply tool/);
      assert.deepStrictEqual((await cc.listTools()).tools.map((t) => t.name), ['reply']);
    });

    await test('the queued message arrives in the session as a channel event; the session reads as online', async () => {
      const n = await until(() => got.find((x) => x.method === 'notifications/claude/channel'));
      assert.ok(n, 'no channel notification arrived');
      assert.strictEqual(n.params.content, 'Run the backer tests and tell me how they went.');
      assert.match(n.params.meta.message_id, /^\d+$/);
      assert.strictEqual((await call('session_status')).sessionOnline, true);
      await wait(800);
      assert.strictEqual(got.filter((x) => x.method === 'notifications/claude/channel').length, 1, 'delivered once');
    });

    await test("the session's reply reaches chat, once", async () => {
      const r = await cc.callTool({ name: 'reply', arguments: { text: 'Backer tests: 17 passed, 0 failed.' } });
      assert.strictEqual(r.content[0].text, 'sent');
      const read = await call('session_read', { wait_seconds: 5 });
      assert.deepStrictEqual(read.replies.map((x) => x.text), ['Backer tests: 17 passed, 0 failed.']);
      const again = await call('session_read', { wait_seconds: 0 });
      assert.strictEqual(again.replies.length, 0);
    });

    await test('a tool approval round-trips: the request shows in chat, the verdict reaches the session', async () => {
      await cc.notification({ method: 'notifications/claude/channel/permission_request',
        params: { request_id: 'req-1', tool_name: 'Bash', description: 'Run npm test', input_preview: 'npm run test:backers' } });
      const read = await until(async () => { const x = await call('session_read', { wait_seconds: 0 }); return x.permissions.length ? x : null; });
      assert.deepStrictEqual(read.permissions.map((p) => [p.requestId, p.tool, p.inputPreview]), [['req-1', 'Bash', 'npm run test:backers']]);
      assert.strictEqual((await call('session_approve', { request_id: 'nope', allow: true })).isError, true);
      const ok = await call('session_approve', { request_id: 'req-1', allow: true });
      assert.deepStrictEqual([ok.ok, ok.behavior], [true, 'allow']);
      const v = await until(() => got.find((x) => x.method === 'notifications/claude/channel/permission'));
      assert.deepStrictEqual(v && v.params, { request_id: 'req-1', behavior: 'allow' });
      assert.strictEqual((await call('session_read', { wait_seconds: 0 })).permissions.length, 0, 'answered requests drop off');
    });
  } catch (e) {
    console.log('  FAIL (setup)', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n       ') : e);
    process.exitCode = 1;
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    for (const s of servers) await s.stop().catch(() => {});
    scratch.cleanup();
  }
  if (process.exitCode) { process.stdout.write('\nsession-bridge.test.js - setup failed\n', () => process.exit(1)); return; }
  done();
})();
