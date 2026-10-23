// lib/mcp/index.js through the real server: the MCP endpoint at /mcp/<MCP_TOKEN>, spoken to with the
// SDK's own client. Off without the token, 404 on a wrong one; the tools read the schedule and the
// backers (links stripped) and add/remove on My Schedule as the owner. Scratch ports 4760-4769.
//
//   node test/mcp.test.js        (npm run test:mcp)
'use strict';
const assert = require('assert');
const { createScratch, boot, one, runner } = require('./helpers/scratch-server');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const PORTS = [4760, 4769];
const PW = 'mcp-test-password-1';
const TOKEN = 'McpTestToken0123456789';

(async () => {
  const { test, done } = runner('mcp.test.js');
  const scratch = await createScratch({ ports: PORTS, prefix: 'fg-mcp-' });
  const servers = [];
  const clients = [];
  try {
    let srv = await boot(scratch.dbPath, {}, { ports: PORTS });
    servers.push(srv);
    const api = (p, { token, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${srv.port}${p}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* */ } return { status: r.status, json, text }; });
    assert.strictEqual((await api('/api/register', { method: 'POST', body: { username: 'adminx', email: 'adminx@x.test', password: PW, realName: 'adminx' } })).status, 201);
    await srv.stop();
    const db = scratch.open();
    db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
    const ham = one(db, "SELECT id FROM users WHERE username = 'ham'");
    const soon = new Date(Date.now() + 2 * 86400000);
    const date = soon.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
    db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, venue, property, game_variant, source_pdf, timezone)
            VALUES ('9-1-1', 'WSOPC Main Event - Flight A', ?, '12:00 PM', 1700, 'MCP Test Series', 'Turning Stone Casino', 'NLH', 'mtt-feed', 'America/New_York')`, [date]);
    db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, venue, property, game_variant, source_pdf, timezone, is_online)
            VALUES ('PA-1-1', 'Sunday Million', ?, '2:00 PM', 215, 'ACR', NULL, 'NLH', 'online-feed', 'America/New_York', 1)`, [date]);
    db.run("INSERT INTO console_records (store, id, data, updated_at, deleted) VALUES ('backers', 'rec-pat', ?, 1, 0)",
      [JSON.stringify({ token: 'McpBackerPat1', name: 'Pat Backer', opening: 50, stakes: [] })]);
    const mainId = one(db, "SELECT id FROM tournaments WHERE event_number = '9-1-1'");
    scratch.save(db); db.close();

    await test('without MCP_TOKEN the route is off (404)', async () => {
      srv = await boot(scratch.dbPath, { CONSOLE_OWNER_USER_ID: String(ham) }, { ports: PORTS });
      servers.push(srv);
      assert.ok(srv.log().includes('[mcp] OFF'));
      const r = await api(`/mcp/${TOKEN}`, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
      assert.strictEqual(r.status, 404);
      await srv.stop();
    });

    const connect = async (tok) => {
      const client = new Client({ name: 'mcp-test', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.port}/mcp/${tok}`));
      await client.connect(transport);
      clients.push(client);
      return client;
    };
    const parse = (r) => JSON.parse(r.content[0].text);

    await test('with the token: the client connects and lists the tools; a wrong token is a 404', async () => {
      srv = await boot(scratch.dbPath, { CONSOLE_OWNER_USER_ID: String(ham), MCP_TOKEN: TOKEN }, { ports: PORTS });
      servers.push(srv);
      assert.ok(srv.log().includes('[mcp] ON'));
      assert.ok(!srv.log().includes(TOKEN), 'the token is never logged');
      const r = await api('/mcp/WrongToken0123456789', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
      assert.strictEqual(r.status, 404);
      const client = await connect(TOKEN);
      const { tools } = await client.listTools();
      assert.deepStrictEqual(tools.map((t) => t.name).sort(),
        ['add_to_schedule', 'backers', 'bankroll_summary', 'find_events', 'live_clock', 'my_schedule', 'recent_results', 'remove_from_schedule']);
    });

    await test('find_events: words match name, series and room; online rooms only when asked', async () => {
      const client = await connect(TOKEN);
      let out = parse(await client.callTool({ name: 'find_events', arguments: { text: 'turning stone main' } }));
      assert.strictEqual(out.total, 1);
      assert.deepStrictEqual([out.events[0].id, out.events[0].room, out.events[0].buyin], [mainId, 'Turning Stone Casino', 1700]);
      out = parse(await client.callTool({ name: 'find_events', arguments: { text: 'sunday million' } }));
      assert.strictEqual(out.total, 0, 'online hidden by default');
      out = parse(await client.callTool({ name: 'find_events', arguments: { text: 'sunday million', includeOnline: true } }));
      assert.strictEqual(out.total, 1);
      assert.strictEqual(out.events[0].online, true);
    });

    await test('add_to_schedule, my_schedule, remove_from_schedule act on the owner\'s My Schedule', async () => {
      const client = await connect(TOKEN);
      assert.deepStrictEqual(parse(await client.callTool({ name: 'add_to_schedule', arguments: { tournamentId: mainId } })), { ok: true, tournamentId: mainId });
      let mine = parse(await client.callTool({ name: 'my_schedule', arguments: {} }));
      assert.deepStrictEqual(mine.events.map((e) => e.id), [mainId]);
      assert.deepStrictEqual(parse(await client.callTool({ name: 'remove_from_schedule', arguments: { tournamentId: mainId } })), { ok: true, tournamentId: mainId });
      mine = parse(await client.callTool({ name: 'my_schedule', arguments: {} }));
      assert.strictEqual(mine.count, 0);
    });

    await test('backers: names and figures, never a link or a token', async () => {
      const client = await connect(TOKEN);
      const r = await client.callTool({ name: 'backers', arguments: {} });
      const out = parse(r);
      assert.strictEqual(out.count, 1);
      assert.strictEqual(out.backers[0].name, 'Pat Backer');
      assert.ok(!r.content[0].text.includes('McpBackerPat1'), 'no token');
      assert.ok(!/link/i.test(r.content[0].text), 'no link');
    });

    await test('live_clock for an event that has not started says so; bankroll_summary and recent_results answer', async () => {
      const client = await connect(TOKEN);
      const c = parse(await client.callTool({ name: 'live_clock', arguments: { tournamentId: mainId } }));
      assert.strictEqual(c.clock, null);
      const b = await client.callTool({ name: 'bankroll_summary', arguments: {} });
      assert.ok(!b.isError, b.content[0].text);
      const res = parse(await client.callTool({ name: 'recent_results', arguments: { limit: 5 } }));
      assert.strictEqual(res.count, 0);
    });
  } catch (e) {
    console.log('  FAIL (setup)', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n       ') : e);
    process.exitCode = 1;
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    for (const s of servers) await s.stop().catch(() => {});
    scratch.cleanup();
  }
  if (process.exitCode) { process.stdout.write('\nmcp.test.js - setup failed\n', () => process.exit(1)); return; }
  done();
})();
