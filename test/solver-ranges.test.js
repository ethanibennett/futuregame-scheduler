'use strict';
/*
 * GET /api/solver/ranges/:gameId — the pre-draw range lookup behind Study >
 * Pre-draw ranges, which serves two JSON files out of the solver clone.
 *
 * WHY THIS TEST EXISTS, and what it is NOT. It would be easy to write a test
 * here that cannot fail: assert the response is 200 and has a `rows` array.
 * Both are structurally guaranteed the moment the files are on disk, and this
 * project keeps a written catalogue of exactly that shape — a gate whose every
 * assertion is about whether the input is well-formed rather than whether the
 * claim holds. So the load-bearing arm below is the IDENTITY one: every figure
 * the route serves must equal the figure in the file, after JSON round-trip. A
 * route that silently rounded, re-ordered or dropped a column would sail through
 * a shape check and fail this.
 *
 * ⚠ ITS OWN FIRST VERSION PERTURBED THE SHIPPED DATA FILE to fire the refusal
 * branches, and that is how the file got corrupted: the run was piped through
 * `head`, the closed pipe killed node on EPIPE before the `finally` that
 * restores, and the perturbed file stayed on disk — reading as a gate failure
 * for the next reader. A test that can leave the data it tests in a wrong state
 * is worse than no test, however carefully it restores. The refusal arms now
 * build a FIXTURE DIRECTORY and point the route at it with RANGES_DIR, and arm 6
 * asserts the shipped files were not written at all.
 *
 * It boots its own server on a scratch DB with its own JWT secret (the
 * scratch-server helper), so it touches neither the live database nor the
 * running pm2 app, and it reads no credential.
 *
 * usage: node test/solver-ranges.test.js
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const { createScratch, boot, one, ROOT } = require('./helpers/scratch-server');

const PORTS = [4680, 4689];
const PW = 'solver-ranges-pw-1';
const SECRET = process.env.RANGES_SECRET || 'solver-ranges-secret-not-for-prod';
// THE WHOLE /api/solver AREA IS APP-ADMIN ONLY — `app.use('/api/solver',
// authenticateToken, requireAppAdmin)`, an explicit owner decision from
// 2026-10-08 because a guest token could otherwise drive the solver. So the
// fixture needs a real account with an admin username, and a guest token is not
// a shortcut: it is its own ARM below, asserting the new route inherited that
// gate rather than sitting outside it.
const GUEST = jwt.sign({ id: 0, username: 'Guest', isGuest: true }, SECRET, { expiresIn: '10m' });

const DIR = path.join(ROOT, 'solver', 'draw-trainer', 'ranges');
const NODES_F = 'td27-predraw-nodes.json';
const HANDS_F = 'td27-predraw-hands.json';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function get(srv, p, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`http://127.0.0.1:${srv.port}${p}`, { headers });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}

(async () => {
  // The files live in the solver clone, which a worktree or a CI checkout may not
  // have. REFUSE rather than skip: a skipped arm that prints nothing is read as a
  // pass, and this project has paid for that more than once.
  for (const f of [NODES_F, HANDS_F]) {
    if (!fs.existsSync(path.join(DIR, f))) {
      console.error('REFUSING: ' + path.join(DIR, f) + ' is not in this checkout\'s solver clone.');
      console.error('  This test asserts what the route serves AGAINST those files, so');
      console.error('  without them there is nothing to compare and no verdict to give.');
      process.exit(3);
    }
  }

  const onDisk = {
    nodes: JSON.parse(fs.readFileSync(path.join(DIR, NODES_F), 'utf8')),
    hands: JSON.parse(fs.readFileSync(path.join(DIR, HANDS_F), 'utf8')),
  };
  const sha0 = { nodes: sha(path.join(DIR, NODES_F)), hands: sha(path.join(DIR, HANDS_F)) };

  const scratch = await createScratch({ ports: PORTS, prefix: 'fg-ranges-', env: { JWT_SECRET: SECRET } });
  // Register through the real route, then take an admin name in the scratch copy
  // — the same fixture shape the money-import test uses, and it is done this way
  // because password hashing and the users schema belong to the server.
  {
    const srv0 = await boot(scratch.dbPath, { JWT_SECRET: SECRET }, { ports: PORTS });
    try {
      const r = await fetch(`http://127.0.0.1:${srv0.port}/api/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'adminx', email: 'adminx@x.test', password: PW, realName: 'adminx' }),
      });
      assert.strictEqual(r.status, 201, 'register adminx');
    } finally { await srv0.stop(); }
  }
  const db = scratch.open();
  db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
  const adminId = one(db, "SELECT id FROM users WHERE username = 'ham'");
  scratch.save(db);
  db.close();
  assert.ok(adminId, 'no admin row seeded');
  const TOKEN = jwt.sign({ id: adminId, username: 'ham' }, SECRET, { expiresIn: '10m' });

  const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-ranges-fx-'));
  let fails = 0;
  const check = (name, fn) => {
    try { fn(); console.log('  ok   ' + name); } catch (e) {
      fails++; console.log('  FAIL ' + name + ' — ' + e.message);
    }
  };
  /** A fixture dir holding both files, with `mutate` applied to the nodes object. */
  function fixture(sub, mutate) {
    const d = path.join(fixtures, sub);
    fs.mkdirSync(d, { recursive: true });
    const n = JSON.parse(JSON.stringify(onDisk.nodes));
    mutate(n);
    fs.writeFileSync(path.join(d, NODES_F), JSON.stringify(n));
    fs.writeFileSync(path.join(d, HANDS_F), JSON.stringify(onDisk.hands));
    return d;
  }

  try {
    const srv = await boot(scratch.dbPath, { JWT_SECRET: SECRET }, { ports: PORTS });
    try {
      console.log('--- 1. the route exists and inherits the /api/solver gate ---');
      const anon = await get(srv, '/api/solver/ranges/td27', null);
      check('no token -> 401', () => assert.strictEqual(anon.status, 401));
      // THE ARM THAT MATTERS HERE: a valid token with no admin rights. A new
      // route under /api/solver gets requireAppAdmin from the app.use above, and
      // "it is mounted under the right prefix" is a claim worth firing once
      // rather than trusting — the same decision that put that middleware there.
      const guest = await get(srv, '/api/solver/ranges/td27', GUEST);
      check('valid non-admin token -> 403', () => assert.strictEqual(guest.status, 403));

      console.log('--- 2. a game with no range file is a 404, not an empty 200 ---');
      // An empty 200 would render as a page with no rows, which reads as "the
      // solver plays nothing here" — a wrong answer wearing a reading's clothes.
      const no = await get(srv, '/api/solver/ranges/razz', TOKEN);
      check('razz -> 404', () => assert.strictEqual(no.status, 404));
      check('404 names the supported game', () => assert.ok(/td27/.test(no.body.error || '')));

      console.log('--- 3. IDENTITY: every figure served equals the figure on disk ---');
      const got = await get(srv, '/api/solver/ranges/td27', TOKEN);
      check('td27 -> 200', () => assert.strictEqual(got.status, 200));
      check('nodes payload is identical to the file', () =>
        assert.deepStrictEqual(got.body.nodes, onDisk.nodes));
      check('hands payload is identical to the file', () =>
        assert.deepStrictEqual(got.body.hands, onDisk.hands));
      // Spot-assert the quantities the VIEW actually reads, so a future change to
      // the emit schema breaks here rather than silently rendering a blank table.
      check('nodes carry a passing gate verdict', () => {
        const v = got.body.nodes.verified;
        assert.ok(v && v.claims > 0, 'no verified.claims');
        assert.strictEqual(v.drifted, 0);
        assert.strictEqual(v.unresolved, 0);
      });
      check('the positional ladder has all five seats', () => {
        const seats = got.body.nodes.rows.filter((r) => r.kind === 'ladder').map((r) => r.label);
        assert.deepStrictEqual(seats.slice().sort(), ['BTN', 'CO', 'HJ', 'LJ', 'SB']);
      });
      check('all four betting nodes carry hand rows', () => {
        const lines = got.body.hands.lines.map((l) => l.line).sort();
        assert.deepStrictEqual(lines, ['', 'c', 'r', 'rr']);
        for (const l of got.body.hands.lines) assert.ok(l.rows.length > 0, l.line + ' has no rows');
      });
      check('every row carries the fields the view renders', () => {
        for (const l of got.body.hands.lines) {
          for (const r of l.rows) {
            for (const k of ['cls', 'hold', 'what', 'holds', 'play', 'playSD', 'raise']) {
              assert.ok(k in r, l.line + '/' + r.cls + ' is missing ' + k);
            }
          }
        }
      });
    } finally { await srv.stop(); }

    console.log('--- 4. REFUSAL, demonstrated: a drifted nodes file must 503 ---');
    // The ladder file can only be WRITTEN by a passing gate, so a file reporting
    // drift means it was hand-edited after the fact. The route is the last place
    // that can catch it, and a branch nobody has fired is not a branch.
    const driftDir = fixture('drift', (n) => { n.verified.drifted = 1; });
    {
      const srv2 = await boot(scratch.dbPath, { JWT_SECRET: SECRET, RANGES_DIR: driftDir }, { ports: PORTS });
      try {
        const d = await get(srv2, '/api/solver/ranges/td27', TOKEN);
        check('drifted -> 503', () => assert.strictEqual(d.status, 503));
        check('503 says it did not pass its gate', () =>
          assert.ok(/gate/i.test(d.body.error || ''), 'error was: ' + (d.body && d.body.error)));
      } finally { await srv2.stop(); }
    }

    console.log('--- 5. REFUSAL, demonstrated: an empty rows array must 503 ---');
    const emptyDir = fixture('empty', (n) => { n.rows = []; });
    {
      const srv3 = await boot(scratch.dbPath, { JWT_SECRET: SECRET, RANGES_DIR: emptyDir }, { ports: PORTS });
      try {
        const e = await get(srv3, '/api/solver/ranges/td27', TOKEN);
        check('empty rows -> 503', () => assert.strictEqual(e.status, 503));
      } finally { await srv3.stop(); }
    }

    console.log('--- 6. CAN IT PASS? the same fixture mechanism, unperturbed ---');
    // Without this, arms 4 and 5 would be satisfied by a RANGES_DIR that simply
    // does not work — every fixture would 503 and both refusals would "fire" for
    // the wrong reason. This is the arm that makes them mean something.
    const goodDir = fixture('good', () => {});
    {
      const srv4 = await boot(scratch.dbPath, { JWT_SECRET: SECRET, RANGES_DIR: goodDir }, { ports: PORTS });
      try {
        const g = await get(srv4, '/api/solver/ranges/td27', TOKEN);
        check('unperturbed fixture -> 200', () => assert.strictEqual(g.status, 200));
        check('and serves the same figures', () =>
          assert.deepStrictEqual(g.body.nodes.rows, onDisk.nodes.rows));
      } finally { await srv4.stop(); }
    }

    console.log('--- 7. the shipped data files were never written ---');
    check('nodes file unchanged', () => assert.strictEqual(sha(path.join(DIR, NODES_F)), sha0.nodes));
    check('hands file unchanged', () => assert.strictEqual(sha(path.join(DIR, HANDS_F)), sha0.hands));
  } finally {
    scratch.cleanup();
    try { fs.rmSync(fixtures, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }

  console.log('');
  if (fails) {
    console.error(fails + ' assertion(s) FAILED');
    process.exit(1);
  }
  console.log('solver-ranges: all arms passed — two refusals shown to fire, and shown');
  console.log('  to pass on an unperturbed fixture, with the shipped files untouched.');
})().catch((e) => { console.error(e); process.exit(1); });
