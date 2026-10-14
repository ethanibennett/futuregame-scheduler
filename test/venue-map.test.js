'use strict';
/*
 * The venue map's server half (docs/venue-map.md).
 *
 *   node test/venue-map.test.js
 *
 * Part 1, unit: lib/map-providers.js (the MapKit JS token, signed with a throwaway EC P-256 key
 * generated here; the Google Maps browser-key config) and lib/venue-coords.js's place helpers.
 * Part 2 boots server.js on a SCRATCH port against a SCRATCH database (never 3001, never
 * poker-tournaments.db) with MapKit configured and Google not, and drives the routes over HTTP;
 * then a bare Express app mounts the same routes with the opposite configuration.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const jwt = require('jsonwebtoken');
const maps = require(path.join(ROOT, 'lib', 'map-providers'));
const vc = require(path.join(ROOT, 'lib', 'venue-coords'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : err}`); }
}

// A throwaway key, as Apple's .p8 is: PKCS#8 PEM, EC P-256.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const ESCAPED = PEM.trim().replace(/\n/g, '\\n'); // how Render / dotenv carry it on one line
const ENV = { MAPKIT_TEAM_ID: 'TEAM123456', MAPKIT_KEY_ID: 'KEY1234567', MAPKIT_PRIVATE_KEY: ESCAPED };

function checkToken(token, { iat } = {}) {
  const dec = jwt.decode(token, { complete: true });
  assert.strictEqual(dec.header.alg, 'ES256');
  assert.strictEqual(dec.header.kid, 'KEY1234567');
  assert.strictEqual(dec.header.typ, 'JWT');
  assert.strictEqual(dec.payload.iss, 'TEAM123456');
  assert.ok(Number.isInteger(dec.payload.iat));
  if (iat != null) assert.strictEqual(dec.payload.iat, iat);
  assert.strictEqual(dec.payload.exp - dec.payload.iat, 30 * 60, 'exp is 30 minutes on');
  assert.ok(!('origin' in dec.payload), 'no origin claim: one token for the web, the Capacitor app and the Mac app');
  // The signature verifies with the public half (jsonwebtoken checks exp against the real clock).
  jwt.verify(token, PUB, { algorithms: ['ES256'], ignoreExpiration: iat != null });
  return dec;
}

async function unit() {
  console.log('lib/map-providers.js');

  await test('a .p8 with literal \\n escapes is restored to PEM; a bare body is armoured', () => {
    assert.strictEqual(maps.normalisePrivateKey(ESCAPED), PEM.trim());
    const body = PEM.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    const armoured = maps.normalisePrivateKey(body);
    assert.ok(armoured.startsWith('-----BEGIN PRIVATE KEY-----\n'));
    assert.ok(crypto.createPrivateKey(armoured), 'the armoured body is a usable key');
    assert.strictEqual(maps.normalisePrivateKey(''), null);
    assert.strictEqual(maps.normalisePrivateKey('not a key!'), null);
  });

  await test('the token: ES256, kid = key ID, typ JWT; iss = team ID, iat, exp + 30 min, no origin', () => {
    let t = 1_760_000_000_000;
    const issuer = maps.createMapkitTokenIssuer(ENV, { now: () => t });
    const { token, expiresAt } = issuer.get();
    const dec = checkToken(token, { iat: 1_760_000_000 });
    assert.strictEqual(expiresAt, dec.payload.exp);
  });

  await test('one token is served for its lifetime and re-signed in its last 5 minutes', () => {
    let t = 1_760_000_000_000;
    const issuer = maps.createMapkitTokenIssuer(ENV, { now: () => t });
    const a = issuer.get().token;
    t += 24 * 60_000;
    assert.strictEqual(issuer.get().token, a, 'cached at 24 min');
    t += 2 * 60_000; // 26 min: under 5 min left
    const b = issuer.get().token;
    assert.notStrictEqual(b, a, 're-signed at 26 min');
    checkToken(b, { iat: 1_760_000_000 + 26 * 60 });
  });

  await test('MAPKIT_ORIGIN adds origin and scope mapkit_js (Apple\'s current token format)', () => {
    const issuer = maps.createMapkitTokenIssuer({ ...ENV, MAPKIT_ORIGIN: 'futurega.me,localhost' });
    const dec = jwt.decode(issuer.get().token);
    assert.strictEqual(dec.origin, 'futurega.me,localhost');
    assert.strictEqual(dec.scope, 'mapkit_js');
  });

  await test('any MapKit variable missing: not configured', () => {
    for (const k of Object.keys(ENV)) {
      const env = { ...ENV, [k]: '' };
      assert.strictEqual(maps.mapkitConfig(env), null, k);
      assert.strictEqual(maps.createMapkitTokenIssuer(env), null, k);
    }
  });

  await test('Google: the browser key and an optional Map ID', () => {
    assert.strictEqual(maps.googleMapsConfig({}), null);
    assert.deepStrictEqual(maps.googleMapsConfig({ GOOGLE_MAPS_BROWSER_KEY: ' AIzaTest ' }), { key: 'AIzaTest', mapId: null });
    assert.deepStrictEqual(maps.googleMapsConfig({ GOOGLE_MAPS_BROWSER_KEY: 'AIzaTest', GOOGLE_MAPS_MAP_ID: 'abc123' }), { key: 'AIzaTest', mapId: 'abc123' });
  });

  console.log('lib/venue-coords.js place helpers');

  await test('regionLabel: states, provinces, colliding countries, ISO codes', () => {
    assert.strictEqual(vc.regionLabel('NJ'), 'New Jersey');
    assert.strictEqual(vc.regionLabel('CA-QC'), 'Quebec, Canada');
    assert.strictEqual(vc.regionLabel('MALTA'), 'Malta');
    assert.strictEqual(vc.regionLabel('CZ'), 'Czechia');
    assert.strictEqual(vc.regionLabel(null), null);
  });

  await test('townFromAddress: "Town, ST" in the US and Canada, "Town, Country" elsewhere', () => {
    assert.strictEqual(vc.townFromAddress({ city: 'Atlantic City', state: 'New Jersey', 'ISO3166-2-lvl4': 'US-NJ', country_code: 'us' }), 'Atlantic City, NJ');
    assert.strictEqual(vc.townFromAddress({ town: 'Kahnawake', 'ISO3166-2-lvl4': 'CA-QC', country_code: 'ca' }), 'Kahnawake, QC');
    assert.strictEqual(vc.townFromAddress({ village: 'Rozvadov', country: 'Czechia', country_code: 'cz' }), 'Rozvadov, Czechia');
    assert.strictEqual(vc.townFromAddress({ state: 'Nevada', country_code: 'us' }), null);
  });

  await test('describePlace: the PokerAtlas town for the room; the source\'s town; approx for a town-centre placement', () => {
    const dir = vc.loadVenueDirectory({ pokeratlas: [[1, 'Borgata Hotel Casino & Spa', 'Atlantic City, NJ', 39.3786, -74.4349]], wsop_stops: {} });
    const row = { lat: 39.3786, lng: -74.4349, region: 'NJ', source: 'pokeratlas', detail: 'pa:1 Borgata Hotel Casino & Spa, Atlantic City, NJ' };
    const a = vc.describePlace({ venue: 'Borgata Fall Poker Open 2026', property: 'Borgata Hotel Casino & Spa', row, directory: dir });
    assert.strictEqual(a.town, 'Atlantic City, NJ');
    assert.strictEqual(a.region, 'New Jersey');
    assert.strictEqual(a.approx, false);
    const b = vc.describePlace({ venue: 'X Series', property: 'Unlisted Room', directory: dir,
      row: { lat: 29.76, lng: -95.37, region: 'TX', source: 'nominatim-city', detail: 'Houston, TX' } });
    assert.strictEqual(b.town, 'Houston, TX');
    assert.strictEqual(b.approx, true);
    const c = vc.describePlace({ venue: 'Nowhere Open', property: null, row: null, directory: dir });
    assert.deepStrictEqual([c.town, c.lat, c.approx], [null, null, false]);
  });
}

/* ── Part 2: the routes ─────────────────────────────────────────────────────── */

const PORT = Number(process.env.TEST_PORT || 3200 + Math.floor(Math.random() * 600));
if (PORT === 3001) throw new Error('refusing to test on 3001 — the pm2 server owns it');

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let b = '';
      res.on('data', (c) => b += c);
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, headers: res.headers, json, body: b }); });
    }).on('error', reject);
  });
}

async function integration() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-venue-map-test-'));
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY',
    'MAPKIT_ORIGIN', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAPS_MAP_ID']) delete env[k];
  Object.assign(env, { JWT_SECRET: 'test-secret-not-for-prod', PORT: String(PORT), DB_PATH: path.join(tmp, 'scratch.db'), DISABLE_FEED_INGEST: '1', ...ENV });

  const log = [];
  const child = spawn(process.execPath, ['-r', path.join(__dirname, 'stub-solver-preload.js'), 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => log.push(d.toString()));
  child.stderr.on('data', (d) => log.push(d.toString()));
  try {
    const until = Date.now() + 60_000;
    for (;;) {
      if (child.exitCode != null) throw new Error(`server exited with ${child.exitCode}\n${log.join('').slice(-2000)}`);
      try { if ((await request(PORT, '/health')).status === 200) break; } catch (_) {}
      if (Date.now() > until) throw new Error('server did not come up');
      await new Promise((r) => setTimeout(r, 300));
    }
    console.log(`\nserver.js on :${PORT} (MapKit configured, Google not)`);

    await test('GET /api/mapkit-token: 200 with a verifiable token, never cached by the browser', async () => {
      const r = await request(PORT, '/api/mapkit-token');
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.json.configured, true);
      assert.match(r.headers['cache-control'] || '', /no-store/);
      const dec = checkToken(r.json.token);
      assert.strictEqual(r.json.expiresAt, dec.payload.exp);
      const again = await request(PORT, '/api/mapkit-token');
      assert.strictEqual(again.json.token, r.json.token, 'the cached token');
    });

    await test('GET /api/google-maps-config without a key: 404 { configured: false }', async () => {
      const r = await request(PORT, '/api/google-maps-config');
      assert.strictEqual(r.status, 404);
      assert.deepStrictEqual(r.json, { configured: false });
    });

    await test('GET /api/venue-place: its shape; a venue the schedule does not hold is never reverse-geocoded', async () => {
      const t0 = Date.now();
      const r = await request(PORT, '/api/venue-place?venue=' + encodeURIComponent('Nowhere Open 2099') + '&lat=36.1073&lng=-115.1765');
      assert.ok(Date.now() - t0 < 2000, 'answered without a Nominatim round trip');
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual(Object.keys(r.json).sort(), ['approx', 'lat', 'lng', 'name', 'region', 'source', 'town']);
      assert.strictEqual(r.json.town, null);
      const bad = await request(PORT, '/api/venue-place');
      assert.strictEqual(bad.status, 400);
    });

    await test('the private key is never logged', async () => {
      const body = PEM.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
      const all = log.join('');
      assert.ok(!all.includes(body.slice(10, 50)), 'key material in the log');
      assert.match(all, /MapKit JS configured, Google Maps not configured/);
    });
  } finally {
    child.kill();
    await new Promise((r) => (child.exitCode != null ? r() : child.once('exit', r)));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // The opposite configuration, on a bare Express app: MapKit unset, Google set.
  const express = require('express');
  const app = express();
  maps.mountMapRoutes(app, { GOOGLE_MAPS_BROWSER_KEY: 'AIzaTestKey', GOOGLE_MAPS_MAP_ID: 'map123' });
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = srv.address().port;
  try {
    console.log(`\nbare app on :${port} (Google configured, MapKit not)`);
    await test('GET /api/mapkit-token without the MapKit env: 404 { configured: false }', async () => {
      const r = await request(port, '/api/mapkit-token');
      assert.strictEqual(r.status, 404);
      assert.deepStrictEqual(r.json, { configured: false });
    });
    await test('GET /api/google-maps-config: the browser key and Map ID', async () => {
      const r = await request(port, '/api/google-maps-config');
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.json, { configured: true, key: 'AIzaTestKey', mapId: 'map123' });
    });
  } finally { srv.close(); }
}

(async () => {
  await unit();
  await integration();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
