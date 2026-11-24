// The Cash tab for every player (owner, 2026-11-24: "Bring the cash tab online for non-admin users", each with a
// location of their own, game alerts included; lib/cash-locations.js). Boots server.js on a scratch port against a
// stub cash watcher in this process and checks:
//   - a player's pick is kept here, and the watcher is sent only the set of rounded points (no id, no label);
//   - a player's reads go up with near= their own point, and two players never see each other's;
//   - the admins' path is the one it was (the watcher's own location, no near=);
//   - guests are refused; a player's location writes are limited; the alerts open to players;
//   - an instance that is not Render sends nothing (this box, every scratch server).
//
//   node test/cash-players.test.js      (npm run test:cash-players; ports 4800-4809)
'use strict';
const assert = require('assert');
const http = require('http');
const { boot, createScratch, rowsOf, runner } = require('./helpers/scratch-server');
const cashAlerts = require('../lib/cash-alerts');
const cashLocations = require('../lib/cash-locations');

const PORTS = [4800, 4809];
const t = runner('cash players');

// ── the stub watcher ────────────────────────────────────────────────────────
const seen = [];              // every request: { method, path, query, cookie }
let points = [];              // what futurega.me last PUT
let applied = null;           // which point keys the "box" has derived
let ownerLocation = { lat: 40.1, lon: -75, radiusMiles: 100, label: 'Owner' };
function startStub() {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), cookie: !!req.headers.cookie, body });
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (!req.headers.cookie || !/fg_session=/.test(req.headers.cookie)) return send(401, { error: 'unauthorized' });
      const near = url.searchParams.get('near');
      const tag = near || 'owner';
      switch (url.pathname) {
        case '/api/player-locations':
          if (req.method === 'PUT') { points = JSON.parse(body || '{}').points || []; return send(200, { points, applied, derivedAt: null, venueCount: 0 }); }
          return send(200, { points, applied, derivedAt: null, venueCount: 0 });
        case '/api/location':
          if (req.method === 'POST') { ownerLocation = { ...ownerLocation, ...JSON.parse(body || '{}') }; return send(200, ownerLocation); }
          return send(200, { ...ownerLocation, pending: false });
        case '/api/current': return send(200, { ts: new Date().toISOString(), venues: [{ slug: `room-${tag}`, name: `Room ${tag}`, ok: true, lastPollTs: null, games: [{ gameType: 'NLH', gameRaw: '1-3 NLH', stakes: '1/3', tablesRunning: 2, waitlistLen: 0 }] }] });
        case '/api/history': return send(200, { rows: [{ venueSlug: `room-${tag}` }] });
        case '/api/venues': return send(200, { venues: [{ slug: `room-${tag}`, name: `Room ${tag}` }] });
        case '/api/games': return send(200, { games: [{ venueSlug: 'room-owner', gameType: 'NLH', stakes: '1/3', samples: 9 }] });
        case '/api/heatmap': return send(200, { cells: [], venue: url.searchParams.get('venue') });
        default: return send(404, { error: 'not found' });
      }
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

function request(port, method, p, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (_) { /* not json */ } resolve({ status: res.statusCode, json, body: b }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

(async () => {
  // ── pure pieces ──
  await t.test('a location as stored: a whole 5..150 mile radius, a short label, never a non-place', async () => {
    assert.deepStrictEqual(cashLocations.normalize({ lat: 39.95258, lon: -75.16522, radiusMiles: 400, label: ' Philadelphia ' }),
      { lat: 39.95258, lon: -75.16522, radiusMiles: 150, label: 'Philadelphia' });
    assert.strictEqual(cashLocations.normalize({ lat: 'x', lon: 1 }), null);
    assert.strictEqual(cashLocations.normalize({ lat: 1, lon: 2 }).radiusMiles, 100);
    assert.strictEqual(cashLocations.nearParam({ lat: 39.95258, lon: -75.16522, radius_miles: 150 }), '40,-75.2,150');
  });
  await t.test('alerts: each alert reads its own player\'s board, and a player with none is left alone', async () => {
    const { sqlJs } = require('./helpers/scratch-server');
    const S = await sqlJs(); const db = new S.Database();
    cashAlerts.migrate(db);
    db.run("INSERT INTO cash_alerts (user_id, kind, game, created_at) VALUES (1, 'opens', 'NLH', 0), (2, 'opens', 'NLH', 0), (3, 'opens', 'NLH', 0)");
    const board = (slug) => [{ slug, name: slug, games: [{ gameType: 'NLH', stakes: '1/3', tablesRunning: 1 }] }];
    const boards = { 1: board('philly'), 2: board('vegas'), 3: null };
    let out = [];
    for (let i = 0; i < 2; i++) out = cashAlerts.evaluate(db, (uid) => boards[uid]);
    assert.deepStrictEqual(out.map((s) => [s.userId, s.reading.room]).sort(), [[1, 'philly'], [2, 'vegas']]);
    assert.strictEqual(rowsOf(db, 'SELECT * FROM cash_alert_state WHERE alert_id = 3').length, 0);
  });

  const stub = await startStub();
  const CASHWATCHER_URL = `http://127.0.0.1:${stub.address().port}`;
  const scratch = await createScratch({ ports: PORTS, prefix: 'fg-cash-players-', env: { CASHWATCHER_URL } });
  let srv = await boot(scratch.dbPath, { CASHWATCHER_URL }, { ports: PORTS });
  const pw = 'cash-players-test-password';
  try {
    for (const u of ['ownerx', 'adminx', 'pat', 'sam']) {
      const r = await request(srv.port, 'POST', '/api/register', { body: { username: u, email: `${u}@x.test`, password: pw, realName: u } });
      assert.strictEqual(r.status, 201, `register ${u}: ${r.body}`);
    }
  } finally { await srv.stop(); }
  const db = scratch.open();
  db.run("UPDATE users SET username = 'ham' WHERE username = 'ownerx'");
  db.run("UPDATE users SET username = 'ham5' WHERE username = 'adminx'");
  scratch.save(db); db.close();

  srv = await boot(scratch.dbPath, { CASHWATCHER_URL, CASH_PLAYER_SYNC: '1' }, { ports: PORTS });
  const P = srv.port;
  const login = async (email) => (await request(P, 'POST', '/api/login', { body: { email, password: pw } })).json.token;
  const ADMIN = await login('adminx@x.test'), PAT = await login('pat@x.test'), SAM = await login('sam@x.test');
  const GUEST = (await request(P, 'POST', '/api/guest-login')).json.token;
  const get = (p, token) => request(P, 'GET', p, { token });
  const post = (p, token, body) => request(P, 'POST', p, { token, body });
  try {
    await t.test('the boot says the locations go to the watcher (CASH_PLAYER_SYNC=1)', async () => {
      assert.ok(/\[cash-players\] sending players' locations to the watcher is ON/.test(srv.log()), srv.log().slice(-800));
    });
    await t.test('no token 401; a guest is refused', async () => {
      assert.strictEqual((await get('/api/cash/current')).status, 401);
      const g = await get('/api/cash/current', GUEST);
      assert.strictEqual(g.status, 403);
      assert.strictEqual((await post('/api/cash/location', GUEST, { lat: 1, lon: 2 })).status, 403);
    });
    await t.test('a player with no pick: no location, an empty board that asks for one, nothing sent upstream', async () => {
      const before = seen.length;
      assert.deepStrictEqual((await get('/api/cash/location', PAT)).json, {});
      const cur = await get('/api/cash/current', PAT);
      assert.strictEqual(cur.status, 200);
      assert.deepStrictEqual(cur.json.venues, []);
      assert.strictEqual(cur.json.needsLocation, true);
      assert.deepStrictEqual((await get('/api/cash/history?from=x', PAT)).json, { rows: [] });
      assert.deepStrictEqual((await get('/api/cash/venues', PAT)).json, { venues: [] });
      assert.strictEqual(seen.slice(before).length, 0);
    });
    await t.test('a player picks Philadelphia: kept here exact, the watcher told only the rounded point', async () => {
      const r = await post('/api/cash/location', PAT, { lat: 39.95258, lon: -75.16522, radiusMiles: 400, label: 'Philadelphia' });
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.json.lat, 39.95258);
      assert.strictEqual(r.json.radiusMiles, 150);
      assert.strictEqual(r.json.pending, true);
      assert.ok(await waitFor(() => points.length === 1), 'the PUT arrived');
      assert.deepStrictEqual(points, [{ lat: 40, lon: -75.2, radiusMiles: 150 }]);
      const put = seen.filter((s) => s.method === 'PUT').pop();
      assert.ok(!/Philadelphia|pat|user/i.test(put.body), put.body);
      assert.strictEqual(seen.some((s) => s.path === '/api/location' && s.method === 'POST'), false, 'the owner\'s location never moved');
    });
    await t.test('pending until the watcher has derived the point\'s rooms', async () => {
      assert.strictEqual((await get('/api/cash/location', PAT)).json.pending, true);
      applied = ['40|-75.2|150'];
      await new Promise((r) => setTimeout(r, 1100)); // the state is cached for a second
      const l = (await get('/api/cash/location', PAT)).json;
      assert.strictEqual(l.pending, false);
      assert.strictEqual(l.label, 'Philadelphia');
    });
    await t.test('a player\'s reads go up with near= their point', async () => {
      const cur = await get('/api/cash/current', PAT);
      assert.strictEqual(cur.json.venues[0].slug, 'room-40,-75.2,150');
      const h = await get('/api/cash/history?from=2026-11-24T00:00:00Z&limit=10000', PAT);
      assert.strictEqual(h.json.rows[0].venueSlug, 'room-40,-75.2,150');
      const last = seen.filter((s) => s.path === '/api/history').pop();
      assert.strictEqual(last.query.from, '2026-11-24T00:00:00Z');
      assert.strictEqual(last.query.limit, '10000');
      assert.strictEqual((await get('/api/cash/venues', PAT)).json.venues[0].slug, 'room-40,-75.2,150');
    });
    await t.test('a second player in Las Vegas sees Las Vegas; the first still sees Philadelphia; both points sent', async () => {
      assert.strictEqual((await post('/api/cash/location', SAM, { lat: 36.1699, lon: -115.1398, radiusMiles: 25, label: 'Las Vegas' })).status, 200);
      assert.strictEqual((await get('/api/cash/current', SAM)).json.venues[0].slug, 'room-36.2,-115.1,25');
      assert.strictEqual((await get('/api/cash/current', PAT)).json.venues[0].slug, 'room-40,-75.2,150');
      assert.ok(await waitFor(() => points.length === 2), JSON.stringify(points));
    });
    await t.test('the catalog and a room\'s heatmap are read as they are', async () => {
      assert.strictEqual((await get('/api/cash/games', PAT)).json.games.length, 1);
      const hm = await get('/api/cash/heatmap?venue=parx&game=NLH&stakes=1%2F3', PAT);
      assert.strictEqual(hm.json.venue, 'parx');
      assert.strictEqual(seen.filter((s) => s.path === '/api/heatmap').pop().query.near, undefined);
    });
    await t.test('a player cannot reach anything else, write anything else, or send a non-place', async () => {
      assert.strictEqual((await get('/api/cash/', PAT)).status, 404);
      assert.strictEqual((await get('/api/cash/ingest', PAT)).status, 404);
      assert.strictEqual((await post('/api/cash/current', PAT, {})).status, 405);
      assert.strictEqual((await post('/api/cash/location', PAT, { lat: 'nowhere' })).status, 400);
    });
    await t.test('the admins\' path is unchanged: the owner\'s board, the watcher\'s own location', async () => {
      const cur = await get('/api/cash/current', ADMIN);
      assert.strictEqual(cur.json.venues[0].slug, 'room-owner');
      assert.strictEqual(seen.filter((s) => s.path === '/api/current').pop().query.near, undefined);
      const r = await post('/api/cash/location', ADMIN, { lat: 41, lon: -74, radiusMiles: 120, label: 'Owner pick' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(ownerLocation.label, 'Owner pick');
      const d = scratch.open();
      try {
        assert.strictEqual(rowsOf(d, "SELECT 1 FROM cash_locations WHERE label = 'Owner pick'").length, 0, 'an admin\'s pick is not a player\'s');
        assert.strictEqual(rowsOf(d, 'SELECT 1 FROM cash_locations').length, 2, 'the two players\' picks are kept');
      } finally { d.close(); }
    });
    await t.test('the alerts open to players (and not to guests)', async () => {
      const r = await post('/api/cash-alerts', PAT, { kind: 'opens', game: 'PLO' });
      assert.strictEqual(r.status, 201, r.body);
      assert.strictEqual((await get('/api/cash-alerts', PAT)).json.alerts.length, 1);
      assert.strictEqual((await get('/api/cash-alerts', SAM)).json.alerts.length, 0);
      assert.strictEqual((await get('/api/cash-alerts', GUEST)).status, 403);
    });
    await t.test('a player\'s location writes are limited (30 in 10 minutes)', async () => {
      let last = null;
      for (let i = 0; i < 31; i++) last = await post('/api/cash/location', SAM, { lat: 36.1, lon: -115.1, radiusMiles: 10 + i, label: 'Las Vegas' });
      assert.strictEqual(last.status, 429);
    });
  } finally { await srv.stop(); }

  // Nothing is sent from an instance that is not Render (this box, a scratch server).
  srv = await boot(scratch.dbPath, { CASHWATCHER_URL }, { ports: PORTS });
  try {
    await t.test('off Render: the pick is kept but nothing is sent to the watcher', async () => {
      assert.ok(/sending players' locations to the watcher is OFF \(not on Render\)/.test(srv.log()), srv.log().slice(-800));
      const puts = seen.filter((s) => s.method === 'PUT').length;
      const tok = (await request(srv.port, 'POST', '/api/login', { body: { email: 'pat@x.test', password: pw } })).json.token;
      const r = await request(srv.port, 'POST', '/api/cash/location', { token: tok, body: { lat: 47.6, lon: -122.3, radiusMiles: 50, label: 'Seattle' } });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.pending, false);
      await new Promise((res) => setTimeout(res, 2500));
      assert.strictEqual(seen.filter((s) => s.method === 'PUT').length, puts);
    });
  } finally { await srv.stop(); stub.close(); scratch.cleanup(); }
  t.done();
})().catch((err) => { console.error(err); process.exit(1); });
