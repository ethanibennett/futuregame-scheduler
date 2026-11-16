// Hand imports vs the feed (lib/feed-dedupe.js + refreshHandImportTwins in server.js).
// Unit tests on the matcher, then server.js on a scratch port and DB: a feed copy of a hand-imported
// event is not listed, an event only the feed has still is, and a save of the hidden copy moves to
// the hand-imported one. Never port 3001, never poker-tournaments.db.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { findHandImportTwins, restartDay, namesAgree, pickTwin } = require('../lib/feed-dedupe');
const feedDuplicates = require('../lib/feed-duplicates');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}
const FEED = ['mtt-feed', 'online-feed'];
const row = (id, src, o) => ({ id, source_pdf: src, venue: src === 'mtt-feed' ? 'Feed Series' : 'Hand Series', property: 'Borgata Hotel Casino & Spa', ...o });

(async () => {
  await test('same room, day, buy-in, start within an hour: the feed row is the duplicate', () => {
    const r = findHandImportTwins([
      row(1, 'Borgata sheet', { date: '2026-11-05', time: '11:15 AM', buyin: 600, event_name: 'NLH Kickoff - Day 1C' }),
      row(2, 'mtt-feed', { date: 'November 5, 2026', time: '11:15 AM', buyin: 600, event_name: 'NLH Fall Deep Stack Kickoff - Flight C' }),
    ], { feedTags: FEED });
    assert.deepStrictEqual(r, [{ hand: 1, feed: 2 }]);
  });
  await test('a different buy-in, room or day is a different event', () => {
    const base = row(1, 'Borgata sheet', { date: '2026-11-05', time: '11:15 AM', buyin: 600, event_name: 'A' });
    for (const o of [{ buyin: 350 }, { property: 'Parx Casino' }, { date: 'November 6, 2026' }, { time: '1:00 PM' }]) {
      const r = findHandImportTwins([base, row(2, 'mtt-feed', { date: 'November 5, 2026', time: '11:15 AM', buyin: 600, event_name: 'A', ...o })], { feedTags: FEED });
      assert.deepStrictEqual(r, [], JSON.stringify(o));
    }
  });
  await test('restart days pair by "Day N" (hand imports carry $0, the feed the parent buy-in)', () => {
    const r = findHandImportTwins([
      row(1, 'Borgata sheet', { date: '2026-11-07', time: '12:00 PM', buyin: 0, event_name: 'NLH Kickoff - Day 2' }),
      row(2, 'mtt-feed', { date: 'November 7, 2026', time: '12:00 PM', buyin: 600, event_name: 'NLH Kickoff - Day 2' }),
      row(3, 'mtt-feed', { date: 'November 7, 2026', time: '12:00 PM', buyin: 600, event_name: 'NLH Other - Day 3' }),
    ], { feedTags: FEED });
    assert.deepStrictEqual(r, [{ hand: 1, feed: 2 }]);
  });
  await test('"Day 1C" is a flight, not a restart; "Final Table" is', () => {
    assert.strictEqual(restartDay({ event_name: 'NLH Kickoff - Day 1C' }), null);
    assert.strictEqual(restartDay({ event_name: 'NLH Kickoff - Day 2' }), 'day2');
    assert.strictEqual(restartDay({ event_name: 'Main Event Final Table' }), 'final');
  });
  await test('two feed rows on one hand slot (a feed error) are both duplicates', () => {
    const r = findHandImportTwins([
      row(1, 'Borgata sheet', { date: '2026-11-06', time: '11:15 AM', buyin: 600, event_name: 'Day 1E' }),
      row(2, 'mtt-feed', { date: 'November 6, 2026', time: '11:15 AM', buyin: 600, event_name: 'Flight E' }),
      row(3, 'mtt-feed', { date: 'November 6, 2026', time: '11:15 AM', buyin: 600, event_name: 'Flight F' }),
    ], { feedTags: FEED });
    assert.deepStrictEqual(r.map(x => x.feed).sort(), [2, 3]);
  });
  await test('feed rows alone, or rows with no room, are never touched', () => {
    assert.deepStrictEqual(findHandImportTwins([
      row(2, 'mtt-feed', { date: 'November 6, 2026', time: '11:15 AM', buyin: 600, event_name: 'x' }),
      row(3, 'online-feed', { date: 'November 6, 2026', time: '11:15 AM', buyin: 600, event_name: 'x' }),
    ], { feedTags: FEED }), []);
    assert.deepStrictEqual(findHandImportTwins([
      row(1, 'Vision Upload', { property: null, date: '2026-11-06', time: '11:15 AM', buyin: 600, event_name: 'x' }),
      row(2, 'mtt-feed', { property: null, date: 'November 6, 2026', time: '11:15 AM', buyin: 600, event_name: 'x' }),
    ], { feedTags: FEED }), []);
  });

  // The owner's Dec 13 at Wynn (2026-11-15): a hand-added bridge row "TORSE (2 Day)" (no property,
  // the feed's series title) beside the feed's "TORSE", with the Ladies Championship in the same
  // $1,100 / 11 AM slot.
  const W = (id, src, o) => ({ id, source_pdf: src, venue: '2026 WPT World Championship', date: 'December 13, 2026', time: '11:00 AM', buyin: 1100, ...o });
  const bridge = W(1, 'WPT World Championship 2026', { property: null, event_name: 'TORSE (2 Day)' });
  const torse = W(2, 'mtt-feed', { property: 'Wynn Las Vegas', event_name: 'TORSE' });
  const ladies = W(3, 'mtt-feed', { property: 'Wynn Las Vegas', event_name: 'NLH Ladies Championship' });
  await test('names agree once labels are set aside; different events do not', () => {
    assert.ok(namesAgree('TORSE (2 Day)', 'TORSE'));
    assert.ok(namesAgree("Event #28: $1,100 No-Limit Hold'em Ladies Championship", 'NLH Ladies Championship'));
    assert.ok(namesAgree('NLH Kickoff - Day 1C', 'NLH Kickoff - Flight C'));
    assert.ok(!namesAgree('TORSE', 'NLH Ladies Championship', { loose: true }));
    assert.ok(!namesAgree('TORSE', 'TORSE Championship'));
    assert.ok(namesAgree('TORSE', 'TORSE Championship', { loose: true }));
  });
  await test('a saved row moves only to the twin named like it, never to another event in the slot', () => {
    assert.strictEqual(pickTwin(bridge, [ladies, torse]).id, 2);
    assert.strictEqual(pickTwin(bridge, [ladies]), null, 'Ladies is not TORSE');
    assert.strictEqual(pickTwin(bridge, [W(4, 'mtt-feed', { property: 'Wynn Las Vegas', event_name: 'TORSE', buyin: 600 })]), null, 'another buy-in');
    assert.strictEqual(pickTwin(bridge, [W(5, 'mtt-feed', { venue: 'Other Series', property: 'Aria', event_name: 'TORSE' })]), null, 'another room');
  });
  await test('two feed rows on one hand slot: only the one carrying its name is hidden', () => {
    const hand = row(1, 'Wynn sheet', { property: 'Wynn Las Vegas', date: '2026-12-13', time: '11:00 AM', buyin: 1100, event_name: 'TORSE (2 Day)' });
    const r = findHandImportTwins([hand, { ...torse, property: 'Wynn Las Vegas' }, ladies], { feedTags: FEED });
    assert.deepStrictEqual(r, [{ hand: 1, feed: 2 }]);
  });
  await test('the duplicate check sees a saved bridge row beside the feed copy, and not Ladies', async () => {
    const SQLm = await require(path.join(__dirname, '..', 'node_modules', 'sql.js'))();
    const m = new SQLm.Database();
    m.run(`CREATE TABLE tournaments (id INTEGER PRIMARY KEY, source_pdf TEXT, venue TEXT, property TEXT, event_number TEXT,
      event_name TEXT, date TEXT, time TEXT, buyin INTEGER, timezone TEXT)`);
    const ins = (id, src, prop, num, name, time = '11:00 AM', buyin = 1100, venue = '2026 WPT World Championship') =>
      m.run('INSERT INTO tournaments VALUES (?,?,?,?,?,?,?,?,?,?)', [id, src, venue, prop, num, name, 'December 13, 2099', time, buyin, 'America/Los_Angeles']);
    ins(1, 'WPT World Championship 2026', null, '29', 'TORSE (2 Day)');
    ins(2, 'mtt-feed', 'Wynn Las Vegas', '29-300620', 'TORSE');
    ins(3, 'mtt-feed', 'Wynn Las Vegas', '28-300618', 'NLH Ladies Championship');
    ins(4, 'mtt-feed', 'Aria Casino', 'PA-1', 'TORSE', '11:00 AM', 1100, '2099 Aria Poker Open');
    ins(5, 'Personal', null, null, 'TORSE', '11:00 AM', 1100, 'Personal');
    const groups = feedDuplicates.find(m);
    assert.deepStrictEqual(groups.map(g => g.key), ['1,2']);
    assert.deepStrictEqual(feedDuplicates.find(m, Date.now(), new Set([2])), [], 'a hidden row is not listed');
  });

  // ── server ──
  const ROOT = path.join(__dirname, '..');
  const PORT = 46000 + Math.floor(Math.random() * 2000);
  assert.notStrictEqual(PORT, 3001);
  const request = (method, p, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-dedupe-'));
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  // SYNC_TOKEN opens feed-sync for the bridge test below. With a token the server also pushes its
  // feed rows at boot — FEED_SYNC_BASE_URL points that at a closed local port, never futurega.me.
  Object.assign(env, { JWT_SECRET: 'dedupe-test-secret', PORT: String(PORT), DB_PATH: path.join(tmp, 'scratch.db'), DISABLE_FEED_INGEST: '1',
    SYNC_TOKEN: 'dedupe-test-sync', FEED_SYNC_BASE_URL: 'http://127.0.0.1:9' });
  const boot = () => { const c = spawn(process.execPath, ['-r', path.join(__dirname, 'stub-solver-preload.js'), 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); c.stdout.on('data', () => {}); c.stderr.on('data', () => {}); return c; };
  const up = async (c) => { const until = Date.now() + 60000; while (Date.now() < until) { if (c.exitCode != null) throw new Error('server exited'); try { if ((await request('GET', '/health')).status === 200) return; } catch (_) {} await new Promise(r => setTimeout(r, 300)); } throw new Error('server did not come up'); };
  const down = (c) => new Promise((r) => { if (c.exitCode != null) return r(); c.once('exit', r); c.kill(); });

  let child = boot();
  const pw = 'dedupe-test-password';
  try {
    await up(child);
    assert.strictEqual((await request('POST', '/api/register', { body: { username: 'adminx', email: 'adminx@x.test', password: pw, realName: 'A' } })).status, 201);
  } finally { await down(child); }
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  const db = new SQL.Database(fs.readFileSync(env.DB_PATH));
  db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
  fs.writeFileSync(env.DB_PATH, Buffer.from(db.export()));

  child = boot();
  try {
    await up(child);
    const admin = { Authorization: 'Bearer ' + JSON.parse((await request('POST', '/api/login', { body: { email: 'adminx@x.test', password: pw } })).body).token };
    const ev = (o) => ({ venue: 'X', property: 'Borgata Hotel Casino & Spa', game_variant: 'NLH', ...o });
    // The feed's copy first (imported under the feed's tag, which is what owns a row), then a save of it.
    await request('POST', '/api/import-parsed-schedule', { headers: admin, body: { sourceFile: 'mtt-feed', events: [
      ev({ stable_id: 'F-1', venue: '2026 Fall Poker Open (Borgata)', event_name: 'NLH Kickoff - Flight C', date: '2099-11-05', time: '11:15 AM', buyin: 600 }),
      ev({ stable_id: 'F-2', venue: '2026 Fall Poker Open (Borgata)', event_name: 'NLH Only In The Feed', date: '2099-11-05', time: '7:00 PM', buyin: 150 }),
    ] } });
    const list1 = JSON.parse((await request('GET', '/api/tournaments?startDate=2099-01-01&endDate=2099-12-31', { headers: admin })).body);
    const feedCopy = list1.find(t => t.stable_id === 'F-1');
    assert.ok(feedCopy, 'feed copy listed before the hand import');
    assert.strictEqual((await request('POST', '/api/schedule', { headers: admin, body: { tournamentId: feedCopy.id } })).status, 200, 'saved the feed copy');
    // Then the room's own sheet.
    await request('POST', '/api/import-parsed-schedule', { headers: admin, body: { sourceFile: 'Borgata sheet', events: [
      ev({ stable_id: 'H-1', venue: 'Borgata Fall Poker Open 2099', event_name: 'NLH Kickoff - Day 1C', date: '2099-11-05', time: '11:15 AM', buyin: 600 }),
    ] } });
    const list2 = JSON.parse((await request('GET', '/api/tournaments?startDate=2099-01-01&endDate=2099-12-31', { headers: admin })).body);
    await test('server: the feed copy of a hand-imported event is not listed; the hand copy is', () => {
      const ids = list2.map(t => t.stable_id);
      assert.ok(!ids.includes('F-1'), 'F-1 hidden');
      assert.ok(ids.includes('H-1'), 'H-1 listed');
    });
    await test('server: an event only the feed carries is still listed', () => {
      assert.ok(list2.some(t => t.stable_id === 'F-2'));
    });
    await test('server: a save of the hidden feed copy moves to the hand-imported copy', async () => {
      const mine = JSON.parse((await request('GET', '/api/my-schedule', { headers: admin })).body);
      const rows = Array.isArray(mine) ? mine : (mine.tournaments || mine.schedule || []);
      const sids = rows.map(t => t.stable_id);
      assert.ok(sids.includes('H-1'), 'saved hand copy: ' + JSON.stringify(sids));
      assert.ok(!sids.includes('F-1'), 'no save left on the hidden copy');
    });

    // A bridge series (hand-added ahead of the feed) with one row saved, then the feed takes over.
    const wv = '2026 WPT World Championship';
    await request('POST', '/api/import-parsed-schedule', { headers: admin, body: { sourceFile: 'WPT World Championship 2026', events: [
      { stable_id: 'B-TORSE', venue: wv, game_variant: 'HORSE', event_name: 'TORSE (2 Day)', date: '2099-12-13', time: '11:00 AM', buyin: 1100 },
      { stable_id: 'B-LADIES', venue: wv, game_variant: 'NLH', event_name: 'NLH Ladies Championship', date: '2099-12-13', time: '11:00 AM', buyin: 1100 },
    ] } });
    const list3 = JSON.parse((await request('GET', '/api/tournaments?startDate=2099-01-01&endDate=2099-12-31', { headers: admin })).body);
    const bridgeTorse = list3.find(t => t.stable_id === 'B-TORSE');
    assert.ok(bridgeTorse, 'bridge row listed');
    assert.strictEqual((await request('POST', '/api/schedule', { headers: admin, body: { tournamentId: bridgeTorse.id } })).status, 200, 'saved the bridge row');
    const feedRow = (o) => ({ venue: wv, property: 'Wynn Las Vegas', source_pdf: 'mtt-feed', date: 'December 13, 2099', time: '11:00 AM', buyin: 1100, ...o });
    const sync = await request('POST', '/api/tournaments/feed-sync/dedupe-test-sync', { body: { feedVenues: [wv], tournaments: [
      feedRow({ stable_id: 'MTT-WPT-29', event_number: '29-300620-20991213', event_name: 'TORSE', game_variant: 'HORSE' }),
      feedRow({ stable_id: 'MTT-WPT-28', event_number: '28-300618-20991213', event_name: 'NLH Ladies Championship', game_variant: 'NLH' }),
    ] } });
    await test('server: feed-sync accepted the takeover push', () => assert.strictEqual(sync.status, 200, sync.body));
    const list4 = JSON.parse((await request('GET', '/api/tournaments?startDate=2099-01-01&endDate=2099-12-31', { headers: admin })).body);
    await test('server: a saved bridge row moves to the feed\'s copy and goes — the event is listed once', () => {
      const dec13 = list4.filter(t => t.venue === wv).map(t => `${t.stable_id}:${t.event_name}`).sort();
      assert.deepStrictEqual(dec13, ['MTT-WPT-28:NLH Ladies Championship', 'MTT-WPT-29:TORSE']);
    });
    await test('server: the save now points at the feed\'s TORSE, not Ladies', async () => {
      const mine = JSON.parse((await request('GET', '/api/my-schedule', { headers: admin })).body);
      const sids = (Array.isArray(mine) ? mine : (mine.tournaments || mine.schedule || [])).map(t => t.stable_id);
      assert.ok(sids.includes('MTT-WPT-29'), JSON.stringify(sids));
      assert.ok(!sids.includes('MTT-WPT-28') && !sids.includes('B-TORSE'), JSON.stringify(sids));
    });
  } finally {
    await down(child);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
