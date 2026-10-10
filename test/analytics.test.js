// Results analytics (BETA): lib/analytics.js math, then GET /api/analytics end to end.
//
//   node test/analytics.test.js        (or: npm run test:analytics)
//
// Part 1 is pure: hand-computed fixtures for every figure the view shows.
// Part 2 boots server.js twice on a scratch port against a scratch DB (never 3001,
// never poker-tournaments.db), same pattern as test/server-gates.test.js: once to
// register two accounts, then — with one renamed to the admin username 'ham' and
// results seeded straight into the file — again to exercise the gate and the payload.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const A = require('../lib/analytics');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : err}`); }
}
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !== ${b}`);

// Five events, hand-computed below.
//   #  buy-in  bullets  cash   profit  date (weekday)
//   1   100      1        0    -100    2026-01-05 Mon
//   2   100      2      500    +300    2026-01-06 Tue
//   3  1000      1        0   -1000    2026-01-10 Sat
//   4  1000      1        0   -1000    2026-01-11 Sun
//   5  1500      1     6000   +4500    2026-01-12 Mon  (3rd of 300)
// cost 3,800 · cash 6,500 · profit 2,700 · 6 entries · 2 cashes
// cumulative: -100, 200, -800, -1800, 2700
const FIX = [
  { id: 1, buyin: 100, num_entries: 1, cashed: 0, cash_amount: 0, date: '2026-01-05', time: '11:00 AM', game_variant: 'NLH', venue: 'Series A', property: 'Room One', is_online: 0 },
  { id: 2, buyin: 100, num_entries: 2, cashed: 1, cash_amount: 500, date: '2026-01-06', time: '7:00 PM', game_variant: 'PLO', venue: 'Series A', property: 'Room One', is_online: 0 },
  { id: 3, buyin: 1000, num_entries: 1, cashed: 0, cash_amount: 0, date: '2026-01-10', time: '12:00 PM', game_variant: 'NLH', venue: 'Series B', property: null, is_online: 0 },
  { id: 4, buyin: 1000, num_entries: 1, cashed: 0, cash_amount: 0, date: '2026-01-11', time: '12:00 PM', game_variant: 'NLH', venue: 'Big Series', property: null, is_online: 1, site: 'GGPoker' },
  { id: 5, buyin: 1500, num_entries: 1, cashed: 1, cash_amount: 6000, finish_place: 3, total_entries: 300, date: '2026-01-12', time: '10:00 AM', game_variant: 'NLH', venue: 'Series B', property: null, is_online: 0, event_name: 'NLH Championship' },
];

(async () => {
  console.log('lib/analytics.js');

  await test('totals match the Results tab rule (cash counts only when cashed)', () => {
    const a = A.computeAnalytics(FIX);
    assert.strictEqual(a.totals.events, 5);
    assert.strictEqual(a.totals.entries, 6);
    assert.strictEqual(a.totals.cashes, 2);
    close(a.totals.cost, 3800); close(a.totals.cash, 6500); close(a.totals.profit, 2700);
    close(a.totals.roi, 2700 / 3800); close(a.totals.itm, 2 / 6);
    // A cash_amount on a row not marked cashed is ignored, as the summary card does.
    const b = A.computeAnalytics([{ ...FIX[0], cash_amount: 999 }]);
    close(b.totals.cash, 0);
  });

  await test('buy-in bands: per-bullet USD, ordered, sample sizes on every row', () => {
    const rows = A.computeAnalytics(FIX).breakdowns.buyin.rows;
    assert.deepStrictEqual(rows.map(r => r.label), ['$100–299', '$800–1,999']);
    assert.deepStrictEqual(rows.map(r => [r.events, r.entries]), [[2, 3], [3, 3]]);
    close(rows[0].profit, 200); close(rows[0].roi, 200 / 300); close(rows[0].itm, 1 / 3);
    close(rows[1].profit, 2500); close(rows[1].roi, 2500 / 3500);
    for (const r of rows) assert.strictEqual(r.small, true); // < 30 entries
    // Band edges are [min, max): $300 is the $300-799 band, $99 is under $100.
    assert.strictEqual(A.computeAnalytics([{ ...FIX[0], buyin: 300 }]).breakdowns.buyin.rows[0].label, '$300–799');
    assert.strictEqual(A.computeAnalytics([{ ...FIX[0], buyin: 99 }]).breakdowns.buyin.rows[0].label, 'Under $100');
    assert.strictEqual(A.computeAnalytics([{ ...FIX[0], buyin: 10000 }]).breakdowns.buyin.rows[0].label, '$10,000+');
  });

  await test('game, room (property > site > venue), live/online, weekday, field size', () => {
    const b = A.computeAnalytics(FIX).breakdowns;
    assert.deepStrictEqual(b.variant.rows.map(r => [r.label, r.entries]), [['NLH', 4], ['PLO', 2]]);
    assert.deepStrictEqual(b.room.rows.map(r => r.label).sort(), ['GGPoker', 'Room One', 'Series B']);
    assert.deepStrictEqual(b.format.rows.map(r => [r.label, r.events]), [['Live', 4], ['Online', 1]]);
    assert.deepStrictEqual(b.weekday.rows.map(r => [r.label, r.events]), [['Mon', 2], ['Tue', 1], ['Sat', 1], ['Sun', 1]]);
    assert.deepStrictEqual(b.field.rows.map(r => [r.label, r.events]), [['300–999', 1]]);
    assert.strictEqual(b.field.missing, 4);
  });

  await test('dates, weekdays and start times', () => {
    assert.strictEqual(A.weekdayIndex('2026-01-05'), 0); // Monday
    assert.strictEqual(A.weekdayIndex('2026-01-11'), 6); // Sunday
    assert.strictEqual(A.normaliseDate('Jun 3, 2026'), '2026-06-03');
    assert.strictEqual(A.timeMinutes('11:00 AM'), 660);
    assert.strictEqual(A.timeMinutes('12:30 PM'), 750);
    assert.strictEqual(A.timeMinutes('12:00 AM'), 0);
    assert.strictEqual(A.timeMinutes('7:30 pm'), 1170);
    assert.strictEqual(A.timeMinutes('14:00'), 840);
    // Same day: the later start is the later event, whatever order the rows came in.
    const o = A.chronological([{ id: 2, date: '2026-01-01', time: '7:00 PM' }, { id: 1, date: '2026-01-01', time: '11:00 AM' }]);
    assert.deepStrictEqual(o.map(r => r.id), [1, 2]);
  });

  await test('per-entry return sd: one sample per bullet, in buy-ins', () => {
    // xs = [-1, 4, -1, -1, -1, 3]: mean 0.5, sum of squares 27.5, sample var 5.5
    const v = A.computeAnalytics(FIX).variance.perEntry;
    assert.strictEqual(v.n, 6);
    close(v.mean, 0.5); close(v.sd, Math.sqrt(5.5));
    // money: [-100, 400, -100, -1000, -1000, 4500]
    const m = [-100, 400, -100, -1000, -1000, 4500];
    const mean = m.reduce((s, x) => s + x, 0) / 6;
    close(v.sdAmount, Math.sqrt(m.reduce((s, x) => s + (x - mean) ** 2, 0) / 5), 1e-6);
    // Freerolls cannot be expressed in buy-ins and are left out.
    assert.strictEqual(A.computeAnalytics([{ ...FIX[0], buyin: 0 }]).variance.perEntry.n, 0);
  });

  await test('downswings: max peak-to-trough and the current one', () => {
    const v = A.computeAnalytics(FIX).variance;
    // peak 200 after #2, trough -1800 after #4
    assert.deepStrictEqual(
      { a: v.maxDrawdown.amount, f: v.maxDrawdown.from, t: v.maxDrawdown.to, e: v.maxDrawdown.events, r: v.maxDrawdown.recovered },
      { a: 2000, f: '2026-01-06', t: '2026-01-11', e: 2, r: true });
    close(v.maxDrawdown.inBuyins, 2000 / (3800 / 6));
    assert.strictEqual(v.currentDrawdown.amount, 0); // ended on a new high
    // Drop the final score: the current downswing is the max one, unrecovered.
    const w = A.computeAnalytics(FIX.slice(0, 4)).variance;
    assert.strictEqual(w.currentDrawdown.amount, 2000);
    assert.strictEqual(w.currentDrawdown.from, '2026-01-06');
    assert.strictEqual(w.currentDrawdown.events, 2);
    assert.strictEqual(w.maxDrawdown.recovered, false);
    // A losing start is a downswing from zero (from: null = the start).
    const x = A.computeAnalytics([FIX[0]]).variance.maxDrawdown;
    assert.strictEqual(x.amount, 100); assert.strictEqual(x.from, null); assert.strictEqual(x.events, 1);
  });

  await test('biggest score and finish percentile', () => {
    const v = A.computeAnalytics(FIX).variance;
    assert.strictEqual(v.biggestScore.amount, 6000);
    assert.strictEqual(v.biggestScore.multiple, 4);
    assert.strictEqual(v.biggestScore.place, 3);
    assert.strictEqual(v.biggestScore.eventName, 'NLH Championship');
    assert.strictEqual(v.finishPercentile.n, 1);
    close(v.finishPercentile.avgTop, 0.01);
    // A place larger than the field is bad data and skipped.
    assert.strictEqual(A.finishPercentile([{ place: 400, field: 300 }]).n, 0);
    assert.strictEqual(A.computeAnalytics([FIX[0]]).variance.biggestScore, null);
  });

  await test('bootstrap CI: deterministic, inside [-100%, ∞), degenerate cases exact', () => {
    const rows = FIX.map(r => A.normaliseRow(r, 'USD', null));
    const a = A.roiBootstrapCI(rows), b = A.roiBootstrapCI(rows);
    assert.deepStrictEqual(a, b);
    assert.ok(a.low >= -1 && a.low <= a.high, JSON.stringify(a));
    assert.strictEqual(a.resamples, 2000);
    // Every event loses exactly its buy-in: ROI is -100% on every resample.
    const lose = A.roiBootstrapCI([FIX[0], FIX[2], FIX[3]].map(r => A.normaliseRow(r, 'USD', null)));
    close(lose.low, -1); close(lose.high, -1);
    // Every event returns +50%: no spread at all.
    const flat = Array.from({ length: 10 }, (_, i) => A.normaliseRow({ id: i, buyin: 100, cashed: 1, cash_amount: 150 }, 'USD', null));
    const f = A.roiBootstrapCI(flat);
    close(f.low, 0.5); close(f.high, 0.5);
    assert.strictEqual(A.roiBootstrapCI(rows.slice(0, 1)), null);
  });

  await test('bootstrap CI covers a known ROI about 95% of the time', () => {
    // Break-even population: a 20% chance of a cash worth 2x-8x (mean 5x) → true ROI 0.
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let covered = 0;
    const trials = 120;
    for (let t = 0; t < trials; t++) {
      const rows = Array.from({ length: 150 }, (_, i) => {
        const cash = rnd() < 0.2 ? 100 * (2 + 6 * rnd()) : 0;
        return A.normaliseRow({ id: i, buyin: 100, cashed: cash > 0 ? 1 : 0, cash_amount: cash }, 'USD', null);
      });
      const ci = A.roiBootstrapCI(rows, { seed: t + 1 });
      if (ci.low <= 0 && ci.high >= 0) covered++;
    }
    const rate = covered / trials;
    assert.ok(rate >= 0.88 && rate <= 0.995, `coverage ${rate}`);
  });

  await test('edge: ranked by ROI, flagged only when the sample can say anything', () => {
    const mk = (n, buyin, cashOf, variant) => Array.from({ length: n }, (_, i) => ({
      id: `${variant}${buyin}-${i}`, buyin, num_entries: 1, cashed: cashOf(i) > 0 ? 1 : 0, cash_amount: cashOf(i),
      date: '2026-02-01', game_variant: variant, venue: 'X',
    }));
    const rows = [
      ...mk(40, 150, () => 225, 'NLH'),                       // $100-299: +50% every time → clear
      ...mk(40, 500, (i) => (i % 2 ? 1100 : 0), 'PLO'),        // $300-799: +10% overall, wide → unclear
      ...mk(10, 5000, (i) => (i === 0 ? 100000 : 0), 'Stud'),  // $5,000-9,999: 10 entries → too small
    ];
    const a = A.computeAnalytics(rows);
    const buy = a.edge.dimensions.find(d => d.key === 'buyin');
    assert.deepStrictEqual(buy.ranked.map(g => [g.label, g.status]), [['$100–299', 'clear'], ['$300–799', 'unclear']]);
    assert.deepStrictEqual(buy.tooSmall, [{ label: '$5,000–9,999', entries: 10 }]);
    assert.match(buy.sentence, /^\$100–299 has the highest ROI whose 95% interval is above break-even: \+50% over 40 entries/);
    const g = a.edge.dimensions.find(d => d.key === 'variant');
    assert.strictEqual(g.ranked[0].label, 'NLH');
    // Nothing clear → says so, with the interval.
    const onlyUnclear = A.computeAnalytics(rows.filter(r => r.game_variant === 'PLO'));
    assert.match(onlyUnclear.edge.dimensions[0].sentence, /includes break-even — the sample cannot tell it apart from zero\.$/);
    // Nothing big enough → says so.
    assert.strictEqual(A.computeAnalytics(FIX).edge.dimensions[0].sentence,
      'No buy-in group has 30 entries yet, so none has an ROI estimate.');
  });

  await test('currency: native → display through USD; bands always cut in USD', () => {
    const rates = { USD: 1, EUR: 0.5 };
    const row = { id: 1, buyin: 1000, num_entries: 1, cashed: 1, cash_amount: 3000, venue: 'WSOP Europe', date: '2026-03-01', game_variant: 'NLH' };
    const usd = A.computeAnalytics([row], { currency: 'USD', rates });
    close(usd.totals.cost, 2000); close(usd.totals.cash, 6000);
    assert.strictEqual(usd.breakdowns.buyin.rows[0].label, '$2,000–4,999');
    const eur = A.computeAnalytics([row], { currency: 'EUR', rates });
    close(eur.totals.cost, 1000); close(eur.totals.profit, 2000);
    assert.strictEqual(eur.breakdowns.buyin.rows[0].label, '$2,000–4,999');
    assert.strictEqual(eur.currency, 'EUR');
  });

  await test('bankroll option: no-op until rows carry bankroll_id, then filters', () => {
    const a = A.computeAnalytics(FIX, { bankroll: 7 });
    assert.deepStrictEqual(a.bankroll, { requested: '7', applied: false });
    assert.strictEqual(a.totals.events, 5);
    const withB = FIX.map((r, i) => ({ ...r, bankroll_id: i < 2 ? 7 : 8 }));
    const b = A.computeAnalytics(withB, { bankroll: '7' });
    assert.deepStrictEqual(b.bankroll, { requested: '7', applied: true });
    assert.strictEqual(b.totals.events, 2);
    assert.strictEqual(A.computeAnalytics(withB, { bankroll: 'all' }).totals.events, 5);
  });

  await test('empty history: no NaN anywhere, nulls where nothing can be said', () => {
    const a = A.computeAnalytics([]);
    assert.strictEqual(a.totals.roi, null);
    assert.strictEqual(a.variance.roiCI, null);
    assert.strictEqual(a.variance.biggestScore, null);
    assert.ok(!JSON.stringify(a).includes('NaN'));
  });

  await serverTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// ── GET /api/analytics, end to end ───────────────────────────────────────────
async function serverTests() {
  console.log('GET /api/analytics');
  const ROOT = path.join(__dirname, '..');
  const PORT = 48000 + Math.floor(Math.random() * 2000);
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
  const boot = (env) => {
    const child = spawn(process.execPath, ['-r', path.join(__dirname, 'stub-solver-preload.js'), 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
    return child;
  };
  const up = async (child) => {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      if (child.exitCode != null) throw new Error('server exited ' + child.exitCode);
      try { if ((await request('GET', '/health')).status === 200) return; } catch (_) {}
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('server did not come up');
  };
  const down = async (child) => {
    if (child.exitCode != null) return;
    await new Promise((r) => { child.once('exit', r); child.kill(); });
  };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-analytics-'));
  const dbPath = path.join(tmp, 'scratch.db');
  assert.notStrictEqual(path.basename(dbPath), 'poker-tournaments.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { DISABLE_FEED_INGEST: '1', JWT_SECRET: 'analytics-test-secret', PORT: String(PORT), DB_PATH: dbPath });

  const pw = 'analytics-test-password';
  let child = boot(env);
  try {
    await up(child);
    for (const [u, e] of [['adminx', 'adminx@x.test'], ['normal', 'normal@x.test']]) {
      const r = await request('POST', '/api/register', { body: { username: u, email: e, password: pw, realName: u } });
      assert.strictEqual(r.status, 201, `register ${u}: ${r.body}`);
    }
  } finally { await down(child); }

  // Promote adminx to 'ham' (sign-up reserves it) and seed the fixture as its results;
  // the normal user gets one result too, which must never appear in the admin's payload.
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
  const uid = (name) => db.exec('SELECT id FROM users WHERE username = ?', [name])[0].values[0][0];
  const adminId = uid('ham'), normalId = uid('normal');
  const addResult = (userId, f) => {
    db.run(`INSERT INTO tournaments (event_name, date, time, buyin, game_variant, venue, property, total_entries, is_online, site)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [f.event_name || 'Test Event', f.date, f.time, f.buyin, f.game_variant, f.venue, f.property || null, f.total_entries || null, f.is_online || 0, f.site || null]);
    const tid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    db.run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, finish_place, cash_amount) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, tid, f.num_entries, f.cashed, f.finish_place || null, f.cash_amount]);
  };
  for (const f of FIX) addResult(adminId, f);
  addResult(normalId, { ...FIX[4], cash_amount: 999999 });
  fs.writeFileSync(dbPath, Buffer.from(db.export()));

  child = boot(env);
  try {
    await up(child);
    const login = async (email) => JSON.parse((await request('POST', '/api/login', { body: { email, password: pw } })).body).token;
    const admin = { Authorization: 'Bearer ' + await login('adminx@x.test') };
    const normal = { Authorization: 'Bearer ' + await login('normal@x.test') };
    const guest = { Authorization: 'Bearer ' + JSON.parse((await request('POST', '/api/guest-login')).body).token };

    await test('no token 401; guest and normal user 403 (beta: app admins only)', async () => {
      assert.strictEqual((await request('GET', '/api/analytics')).status, 401);
      assert.strictEqual((await request('GET', '/api/analytics', { headers: guest })).status, 403);
      assert.strictEqual((await request('GET', '/api/analytics', { headers: normal })).status, 403);
    });
    await test('admin gets their own results analysed, and only theirs', async () => {
      const r = await request('GET', '/api/analytics', { headers: admin });
      assert.strictEqual(r.status, 200, r.body);
      const a = JSON.parse(r.body);
      assert.strictEqual(a.totals.events, 5);
      assert.strictEqual(a.totals.entries, 6);
      close(a.totals.profit, 2700);
      assert.strictEqual(a.variance.maxDrawdown.amount, 2000);
      assert.strictEqual(a.variance.biggestScore.amount, 6000);
      assert.deepStrictEqual(a.breakdowns.format.rows.map(x => x.label), ['Live', 'Online']);
      assert.strictEqual(a.currency, 'USD');
    });
    await test('unsupported currency falls back to USD; ?bankroll= filters (main = no bankroll set)', async () => {
      // Since the bankrolls merge, tracking_entries carries bankroll_id, so the filter applies.
      const a = JSON.parse((await request('GET', '/api/analytics?currency=XYZ&bankroll=3', { headers: admin })).body);
      assert.strictEqual(a.currency, 'USD');
      assert.deepStrictEqual(a.bankroll, { requested: '3', applied: true });
      const all = JSON.parse((await request('GET', '/api/analytics', { headers: admin })).body);
      const main = JSON.parse((await request('GET', '/api/analytics?bankroll=main', { headers: admin })).body);
      assert.deepStrictEqual(main.bankroll, { requested: 'main', applied: true });
      // Every seeded result is in Main (none was filed under a bankroll), so Main equals All.
      assert.ok(all.totals && all.totals.entries > 0, 'admin has results to compare');
      assert.strictEqual(JSON.stringify(main.totals), JSON.stringify(all.totals));
    });
    await test('normal users see no change: GET /api/tracking still serves them', async () => {
      const r = await request('GET', '/api/tracking', { headers: normal });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(JSON.parse(r.body).length, 1);
    });
  } finally {
    await down(child);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
