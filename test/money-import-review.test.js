// Phase 6 of the bankroll merge (docs/bankroll-merge.md §9.3): the import REVIEW, end to end, in
// WebKit, through the real server and the Phase 5 engine, against the Phase 5 stub dashboard.
//
//   node test/money-import-review.test.js          (npm run test:money-import-review)
//
// Needs the built app (cd vite-app && npm run build): server.js serves public-vite/.
//
// A STUB DASHBOARD (test/helpers/stub-dashboard.js, the made-up fixtures of
// test/helpers/money-import-fixtures.js) runs in this process on a scratch port; server.js boots on
// another (4620-4629 by default, never 3001) against a SCRATCH database (never poker-tournaments.db
// or a copy of it) with every production secret scrubbed (test/helpers/scratch-server.js) and
// LEDGER_TOKEN set ONLY here, to a value made up for this run, with DASHBOARD_BASE_URL at the stub.
//
// What it walks, as the owner, in the app's own screens (Bankroll › Dashboard › Import):
//   - the pull OFF (no LEDGER_TOKEN): the reason, a disabled Fetch; another admin sees no section;
//   - Fetch; the review's groups; Import refused while pairs are unanswered;
//   - "Fill the likely ones", the possible pairs answered by hand (one taking the dashboard's
//     figures), a backer matched, the opening deposit edited (Q3): every answer saved as it is given;
//   - a STALE plan: a deposit logged here between the read and the commit -> 409, the plan read
//     again, "The plan changed; review the highlighted items", and the same hash never sent again;
//   - the confirm step naming every table, the commit, the summary and its reconciliation (0
//     unexplained, both pockets);
//   - an EDITED ROW blocking the undo: the row listed with where it lives and an Open in Results
//     link, nothing undone; then the row deleted, the undo done, and every table byte for byte as it
//     was before the commit;
//   - a delta: the dashboard's later edits, Changed / Deleted in the dashboard answered, committed,
//     then both imports undone newest first.
//
// Options (environment), so the same walk runs on the Phase 6 scratch server's seed:
//   MIR_DB=<scratch.db>   copy this database instead of a fresh one (refuses poker-tournaments.db);
//                         the fixtures' rows "here" are added to MIR_OWNER's account once
//   MIR_OWNER=<user id>   the owner in that copy (CONSOLE_OWNER_USER_ID); its username must be an
//                         app admin's (ham / ham5 / claude)
//   MIR_SECRET=<secret>   JWT_SECRET for the server (default: a made-up one)
//   MIR_PORT=<port>       a fixed port for server.js (default: the first free in 4620-4629)
//   MIR_WIDTH / MIR_HEIGHT  the viewport (default 402 x 874; 1440 x 900 is the desktop layout)
//   MIR_SHOTS=<dir>       a screenshot of each state, grid overlay on, its readout off
//
// Every name, token, address and figure is invented.
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { createScratch, boot, sqlJs, freePort, one, runner, ROOT } = require('./helpers/scratch-server');
const { createStub } = require('./helpers/stub-dashboard');
const fx = require('./helpers/money-import-fixtures');
const { webkit } = require('../vite-app/node_modules/playwright');

const PORTS = [4620, 4629];
const LEDGER = crypto.randomBytes(32).toString('hex'); // made up, for this run only
const PW = 'money-import-review-pw-1';
const W = Number(process.env.MIR_WIDTH) || 402, H = Number(process.env.MIR_HEIGHT) || 874;
const SHOTS = process.env.MIR_SHOTS || null;
const SECRET = process.env.MIR_SECRET || 'money-import-review-secret-not-for-prod';
const BASE = '/api/bankrolls/import/dashboard';

async function dumpFile(file) {
  const S2 = await sqlJs();
  const db = new S2.Database(fs.readFileSync(file));
  const out = {};
  const t = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('sqlite_sequence', 'money_import_runs') ORDER BY name");
  for (const [name] of t[0].values) {
    const r = db.exec(`SELECT * FROM ${name} ORDER BY rowid`);
    out[name] = JSON.stringify(r.length ? r[0].values : []);
  }
  db.close();
  return out;
}
const diffTables = (a, b) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]).sort();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { test, done } = runner('money-import-review.test.js');
  const servers = [];
  const cleanups = [];
  let stub = null, browser = null;
  try {
    if (!fs.existsSync(path.join(ROOT, 'public-vite', 'index.html'))) throw new Error('build the app first: cd vite-app && npm run build');

    // ── the world: a scratch database with the owner's rows here ──
    let dbPath, ownerId, ownerName, scratchTmp, otherId, otherName;
    const portRange = process.env.MIR_PORT ? [Number(process.env.MIR_PORT), Number(process.env.MIR_PORT)] : PORTS;
    if (process.env.MIR_DB) {
      if (/poker-tournaments/i.test(path.basename(process.env.MIR_DB))) throw new Error('refusing the live database');
      scratchTmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fg-mir-'));
      cleanups.push(() => fs.rmSync(scratchTmp, { recursive: true, force: true }));
      dbPath = path.join(scratchTmp, 'review.db');
      fs.copyFileSync(process.env.MIR_DB, dbPath);
      const first = await boot(dbPath, { JWT_SECRET: SECRET }, { ports: portRange }); // every migration run on the copy
      await first.stop();
      const S = await sqlJs();
      const db = new S.Database(fs.readFileSync(dbPath));
      ownerId = Number(process.env.MIR_OWNER || 1);
      ownerName = one(db, 'SELECT username FROM users WHERE id = ?', [ownerId]);
      if (!['ham', 'ham5', 'claude'].includes(ownerName)) throw new Error(`MIR_OWNER ${ownerId} (${ownerName}) is not an app admin`);
      if (!one(db, "SELECT id FROM tournaments WHERE stable_id = 'TEST-BORGATA-0402'")) fx.seedHere(db, ownerId);
      // Another app admin, for the 403: in this COPY, the first other account takes a free admin name.
      otherName = ['claude', 'ham', 'ham5'].find((u) => u !== ownerName && !one(db, 'SELECT id FROM users WHERE lower(username) = ?', [u]))
        || ['claude', 'ham', 'ham5'].find((u) => u !== ownerName);
      otherId = one(db, 'SELECT id FROM users WHERE lower(username) = ?', [otherName]) || one(db, 'SELECT id FROM users WHERE id <> ? ORDER BY id LIMIT 1', [ownerId]);
      db.run('UPDATE users SET username = ? WHERE id = ?', [otherName, otherId]);
      fs.writeFileSync(dbPath, Buffer.from(db.export()));
      db.close();
    } else {
      const scratch = await createScratch({ ports: portRange, prefix: 'fg-mir-', env: { JWT_SECRET: SECRET } });
      cleanups.push(() => scratch.cleanup());
      scratchTmp = scratch.tmp;
      dbPath = scratch.dbPath;
      const srv0 = await boot(dbPath, { JWT_SECRET: SECRET }, { ports: portRange });
      try {
        for (const [u, e] of [['adminx', 'adminx@x.test'], ['otheradmin', 'otheradmin@x.test']]) {
          const r = await fetch(`http://127.0.0.1:${srv0.port}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, email: e, password: PW, realName: u }) });
          assert.strictEqual(r.status, 201, 'register ' + u);
        }
      } finally { await srv0.stop(); }
      const db = scratch.open();
      db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
      db.run("UPDATE users SET username = 'ham5' WHERE username = 'otheradmin'");
      ownerId = one(db, "SELECT id FROM users WHERE username = 'ham'");
      ownerName = 'ham';
      otherId = one(db, "SELECT id FROM users WHERE username = 'ham5'");
      otherName = 'ham5';
      fx.seedHere(db, ownerId);
      scratch.save(db);
      db.close();
    }
    const tokenFor = (id, username) => jwt.sign({ id, username }, SECRET, { expiresIn: '2h' });
    const ownerToken = tokenFor(ownerId, ownerName);
    // Another app admin: the routes answer 403, and the section is not shown.
    const otherToken = tokenFor(otherId, otherName);

    let srv = null;
    const api = (method, p, body, token = ownerToken) => fetch(`http://127.0.0.1:${srv.port}${p}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* */ } return { status: r.status, json, text }; });
    const bootWith = async (extra) => {
      const s = await boot(dbPath, { JWT_SECRET: SECRET, CONSOLE_OWNER_USER_ID: String(ownerId), ...extra }, { ports: portRange });
      servers.push(s);
      return s;
    };

    // ── the browser ──
    browser = await webkit.launch();
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    let as = { t: ownerToken, u: ownerName };
    await ctx.exposeBinding('__mirToken', () => as);
    await ctx.addInitScript(() => {
      localStorage.setItem('gridReadout', 'off');
      localStorage.setItem('onboardComplete', '1'); localStorage.setItem('hasOnboarded', 'true'); localStorage.setItem('onboarded', '1');
    });
    const p = await ctx.newPage();
    const pageErrors = [];
    p.on('pageerror', (e) => pageErrors.push(e.message));
    const commitPosts = [];
    p.on('request', (r) => { if (r.method() === 'POST' && /\/import\/dashboard\/\d+\/commit$/.test(r.url())) commitPosts.push(r.postData()); });
    let shotN = 0;
    const shot = async (name) => {
      if (!SHOTS) return;
      fs.mkdirSync(SHOTS, { recursive: true });
      const file = path.join(SHOTS, `${W}x${H}-${String(++shotN).padStart(2, '0')}-${name}.png`);
      await p.screenshot({ path: file });
    };
    // Every page of the sheet from the top of `sel` (the sheet scrolls; a screenshot is one screen).
    const shotsFrom = async (name, sel, pages = 3) => {
      if (!SHOTS) return;
      await p.evaluate((s) => {
        const body = document.querySelector('.an-sheet .an-body');
        const el = s && document.querySelector(s);
        if (body) body.scrollTop = el ? el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8 : 0;
      }, sel);
      await sleep(250);
      for (let i = 0; i < pages; i++) {
        await shot(`${name}${pages > 1 ? `-${i + 1}` : ''}`);
        const moved = await p.evaluate((h) => { const s = document.querySelector('.an-sheet .an-body'); const b = s.scrollTop; s.scrollTop += Math.round(h * 0.8); return s.scrollTop !== b; }, H);
        if (!moved) break;
        await sleep(200);
      }
    };
    const openImport = async (token = ownerToken, username = ownerName) => {
      as = { t: token, u: username };
      await p.goto(`http://127.0.0.1:${srv.port}/${SHOTS ? '?gridOverlay=1' : ''}`, { waitUntil: 'domcontentloaded' });
      await p.evaluate(async () => { const a = await window.__mirToken(); localStorage.setItem('token', a.t); localStorage.setItem('username', a.u); });
      await p.reload({ waitUntil: 'domcontentloaded' });
      await sleep(3000);
      await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 800 }).catch(() => {});
      const desktop = await p.evaluate(() => !!document.querySelector('.app-shell.is-desktop'));
      await p.locator(desktop ? '.dk-rail-item:has-text("Bankroll")' : '.bottom-nav .nav-tab:has-text("Bankroll")').first().click({ timeout: 8000, force: true });
      await sleep(1200);
      await p.locator('.bk-head-btn:has-text("Dashboard")').first().click({ timeout: 8000, force: true });
      await p.locator('.an-sheet .bd-tabs').waitFor({ timeout: 8000 });
      await p.locator('.an-sheet .bd-tabs [role="radio"]:has-text("Import")').first().click({ timeout: 8000, force: true });
      await p.locator('.an-sheet section[aria-labelledby="bd-data"]').waitFor({ timeout: 8000 });
      await sleep(900);
    };
    const sec = () => p.locator('.an-sheet .bid');
    // Headings render in capitals (an-sec's text-transform), and innerText reads them so: the match
    // ignores case.
    const waitText = async (loc, re0, ms = 10000) => {
      const re = re0.flags.includes('i') ? re0 : new RegExp(re0.source, re0.flags + 'i');
      const end = Date.now() + ms;
      let last = '';
      while (Date.now() < end) {
        last = (await loc.count()) ? await loc.first().innerText().catch(() => '') : '';
        if (re.test(last)) return last;
        await sleep(150);
      }
      throw new Error(`never matched ${re}; last: ${last.slice(0, 400)}`);
    };
    const saved = async (group) => waitText(p.locator(`#bid-g-${group}`).locator('xpath=..').locator('.bid-state'), /^Saved$/, 60000);
    const stagedRun = async () => (await api('GET', BASE)).json.runs.find((r) => r.status === 'staged') || null;

    // ══ 1. the pull is off ═══════════════════════════════════════════════════════════════════
    console.log(`the pull is off (${W}x${H})`);
    srv = await bootWith({});
    await test('without LEDGER_TOKEN: the section says the pull is off and why, and Fetch is disabled', async () => {
      await openImport();
      await waitText(sec(), /The pull is off on this server:\s*LEDGER_TOKEN is not set/);
      assert.strictEqual(await sec().locator('button:has-text("Fetch from the dashboard")').isDisabled(), true);
      await shot('pull-off');
    });
    await test('another app admin: the routes answer 403 and the section is not shown at all', async () => {
      assert.strictEqual((await api('GET', BASE, undefined, otherToken)).status, 403);
      await openImport(otherToken, otherName);
      assert.strictEqual(await p.locator('.an-sheet .bid').count(), 0);
      assert.ok(await p.locator('.an-sheet section[aria-labelledby="bd-data"]').count(), 'the CSV import is still there');
    });
    await srv.stop();

    // ══ 2. the pull is on: fetch, review, answer ════════════════════════════════════════════
    stub = createStub({ token: LEDGER });
    fx.seedDashboard(stub);
    await stub.listen(await freePort([4630, 4639]));
    srv = await bootWith({ LEDGER_TOKEN: LEDGER, DASHBOARD_BASE_URL: `http://127.0.0.1:${stub.port}` });
    console.log('fetch and the review');
    let runId = null;
    await test('Fetch from the dashboard stages a run and shows its review; nothing is written but the run', async () => {
      const before = await dumpFile(dbPath);
      await openImport();
      await waitText(sec(), /The pull is on\./);
      await shot('idle');
      await sec().locator('button:has-text("Fetch from the dashboard")').click();
      await waitText(sec(), /Review: fetch #\d+/, 90000);
      const run = await stagedRun();
      assert.ok(run, 'a staged run');
      runId = run.id;
      assert.deepStrictEqual(diffTables(before, await dumpFile(dbPath)), [], 'a fetch writes nothing outside money_import_runs');
      for (const want of [/Likely duplicates \(5\)/, /Backers \(5\)/, /Staking slate \(4\)/, /Where the money is \(2\)/, /The opening deposit/, /The reconciliation/, /Not imported \(2\)/, /For your information/]) {
        await waitText(sec(), want);
      }
      assert.ok(!stub.requests.some((r) => r.url.includes(LEDGER)), 'the ledger token never travels in a URL');
      await shotsFrom('review', '#bid-rev', 2);
    });
    await test('Import is refused while pairs are unanswered, and says how many are left', async () => {
      const btn = sec().locator('.bid-commit button:has-text("Import")').first();
      assert.strictEqual(await btn.getAttribute('aria-disabled'), 'true');
      await waitText(sec().locator('.bid-commit'), /5 pairs still to answer\./);
      await btn.click({ force: true }); // aria-disabled: still focusable and pressable, and it does nothing
      assert.strictEqual(await sec().locator('.bid-confirm').count(), 0, 'no confirm step while blocked');
    });
    await test('"Fill the likely ones" answers the three Likely pairs Same, keep; saved as given', async () => {
      await sec().locator('button:has-text("Fill the likely ones (3)")').click();
      await saved('pairs');
      const r = await api('GET', `${BASE}/${runId}`);
      const pairs = r.json.decisions.pairs;
      const likely = r.json.plan.pairs.filter((x) => x.class === 'likely').map((x) => x.id);
      assert.strictEqual(likely.length, 3);
      for (const id of likely) assert.strictEqual(pairs[id], 'same-keep', id);
      assert.strictEqual(r.json.plan.undecided, 2);
      await waitText(sec().locator('.bid-commit'), /2 pairs still to answer\./);
      await shotsFrom('pairs', '#bid-g-pairs', 4);
    });
    await test('the two Possible pairs answered by hand: the cash night takes the dashboard\'s figures, the deposit is another one', async () => {
      const card = (date) => sec().locator('.bid-pair', { hasText: date });
      await card('Mar 13, 2026').locator('[role="radio"]:has-text("take the dashboard")').click();
      await card('May 3, 2026').locator('[role="radio"]:has-text("Different")').click();
      await saved('pairs');
      const r = await api('GET', `${BASE}/${runId}`);
      assert.strictEqual(r.json.decisions.pairs['pair:dash:sessions:s-cash-2'], 'same-take');
      assert.strictEqual(r.json.decisions.pairs['pair:dash:adjustments:a-dep-1'], 'different');
      assert.strictEqual(r.json.plan.undecided, 0);
      assert.ok(!(await waitText(sec().locator('.bid-commit'), /Import \d+ records/)).includes('still to answer'));
    });
    await test('a backer matched to the staking backer of the same name', async () => {
      const lee = sec().locator('.bid-backer', { hasText: 'Lee Park' });
      await lee.locator('select').selectOption({ label: 'Same as Lee Park' });
      await saved('backers');
      const r = await api('GET', `${BASE}/${runId}`);
      const leeFp = 'dash:backers:b-lee';
      assert.strictEqual(r.json.decisions.backers[leeFp], r.json.plan.backers.find((b) => b.fp === leeFp).matches[0].backerId);
      await shotsFrom('backers', '#bid-g-backers', 3);
    });
    let openingAmount = null;
    await test('the opening deposit edited (Q3): the amount and the date are saved, and the plan follows', async () => {
      const r0 = await api('GET', `${BASE}/${runId}`);
      const computed = r0.json.plan.opening.computed;
      openingAmount = Math.round(computed.amount) + 100;
      const grp = sec().locator('#bid-g-open').locator('xpath=../..');
      await grp.locator('input[type="number"]').fill(String(openingAmount));
      await saved('open');
      const r = await api('GET', `${BASE}/${runId}`);
      assert.deepStrictEqual(r.json.decisions.opening, { amount: openingAmount, date: computed.date });
      assert.strictEqual(r.json.plan.opening.amount, openingAmount);
      assert.strictEqual(r.json.plan.opening.override, true);
      await waitText(grp, /\(your figure\)/);
      await waitText(grp, /Use the computed figure/);
      assert.strictEqual(r.json.plan.reconciliation.unexplained.roll, 0, 'a typed opening still reconciles');
      await shotsFrom('opening', '#bid-g-open', 1);
      await shotsFrom('reconciliation', '#bid-g-rec', 2);
    });

    // ══ 3. a stale plan ════════════════════════════════════════════════════════════════════
    console.log('a stale plan');
    await test('a deposit logged here after the plan was read: the commit is 409 stale, the plan is read again and the change highlighted, nothing written', async () => {
      const add = await api('POST', '/api/bankrolls/adjustments', { kind: 'deposit', bankroll: 'main', amount: 125, date: '2026-09-02', note: 'logged during the review' });
      assert.strictEqual(add.status, 201, add.text);
      const before = await dumpFile(dbPath);
      await sec().locator('.bid-commit button:has-text("Import")').first().click();
      await sec().locator('.bid-confirm').waitFor({ timeout: 4000 });
      await sec().locator('.bid-confirm button:has-text("Import")').click();
      await waitText(sec().locator('.bid-commit'), /The plan changed; review the highlighted items\./, 90000);
      assert.strictEqual(commitPosts.length, 1, 'one commit was sent');
      assert.strictEqual((await stagedRun()).id, runId, 'still staged');
      assert.deepStrictEqual(diffTables(before, await dumpFile(dbPath)), [], 'nothing written');
      await waitText(p.locator('#bid-g-rec').locator('xpath=..').locator('.bid-state'), /^Changed$/);
      await sleep(1500);
      assert.strictEqual(commitPosts.length, 1, 'and it is never retried by itself');
      await shotsFrom('stale', '.bid-commit', 1);
    });

    // ══ 4. commit ══════════════════════════════════════════════════════════════════════════
    console.log('commit');
    let preCommit = null, summary = null;
    await test('the confirm step names every table it writes, with the count Undo will ask for', async () => {
      const plan = (await api('GET', `${BASE}/${runId}`)).json.plan;
      await sec().locator('.bid-commit button:has-text("Import")').first().click();
      const conf = sec().locator('.bid-confirm');
      await conf.waitFor({ timeout: 4000 });
      const text = await conf.innerText();
      assert.match(text, new RegExp(`creates ${plan.writes.rows.toLocaleString('en-US')} rows`));
      for (const [table, n] of Object.entries(plan.writes.tables.insert)) {
        assert.ok(n > 0, table);
      }
      for (const label of ['Cash session', 'Personal tournament', 'Tournament result', 'Adjustment', 'Expense', 'Staking backer', 'Import key']) assert.match(text, new RegExp(label), label);
      assert.match(text, new RegExp(`Import ${plan.writes.rows.toLocaleString('en-US')} records`));
      await shotsFrom('confirm', '.bid-confirm', 2);
    });
    await test('Import writes it: the summary, and its reconciliation with $0 unexplained on the roll and the fund', async () => {
      preCommit = await dumpFile(dbPath);
      await sec().locator('.bid-confirm button:has-text("Import")').click();
      await waitText(sec(), /Imported: #\d+/, 90000);
      const run = (await api('GET', BASE)).json.runs.find((r) => r.id === runId);
      assert.strictEqual(run.status, 'committed');
      assert.strictEqual(commitPosts.length, 2);
      const g = await api('GET', `${BASE}/${runId}`);
      summary = g.json.summary;
      assert.deepStrictEqual(summary.reconciliation.unexplained, { roll: 0, fund: 0 });
      assert.strictEqual(summary.reconciliation.fundWithinRemainder, true);
      assert.deepStrictEqual(summary.opening, { amount: openingAmount, date: g.json.plan.opening.date });
      assert.strictEqual(summary.taken.length, 1, 'one pair took the dashboard\'s figures');
      const text = await sec().locator('.bid-summary').innerText();
      assert.match(text, new RegExp(`${summary.undoCount.toLocaleString('en-US')} rows in all`));
      assert.match(text, /Unexplained \(must be \$0\)\s*\$0\s*\$0/);
      assert.match(text, /Undo this import/);
      await shotsFrom('summary', '.bid-summary', 3);
    });

    // ══ 5. undo, blocked by an edited row, then done ═══════════════════════════════════════
    console.log('undo');
    const DB2 = async () => { const S = await sqlJs(); return new S.Database(fs.readFileSync(dbPath)); };
    let editedId = null;
    await test('a row edited since the import stops the undo: it is listed with where it lives and a link, and nothing is undone', async () => {
      const d = await DB2();
      const k = d.exec("SELECT ref_id FROM bankroll_import_keys WHERE user_id = ? AND fingerprint = 'dash:sessions:s-wynn'", [ownerId]);
      d.close();
      editedId = k[0].values[0][0];
      const e = await api('PUT', `/api/cash-sessions/${editedId}`, { notes: 'edited after the import' });
      assert.strictEqual(e.status, 200, e.text);
      await openImport();
      await waitText(sec(), /Imported: #\d+/);
      await sec().locator('button:has-text("Undo this import")').click();
      const form = sec().locator('form.bid-confirm');
      await form.waitFor({ timeout: 4000 });
      const go = form.locator('button[type="submit"]');
      assert.strictEqual(await go.isDisabled(), true, 'the typed count is required');
      await form.locator('input').fill(String(summary.undoCount - 1));
      assert.strictEqual(await go.isDisabled(), true, 'a wrong count does not confirm');
      await form.locator('input').fill(String(summary.undoCount));
      await shotsFrom('undo-confirm', 'form.bid-confirm', 2);
      await go.click();
      await waitText(sec().locator('.bid-undo-err'), /been changed since the import/, 60000);
      const rows = await sec().locator('.bid-undo-err .bid-row-edit').allInnerTexts();
      assert.ok(rows.some((t) => t.includes(`Cash session #${editedId}`) && /Results › Cash/.test(t) && /edited since the import/.test(t)), rows.join(' | '));
      assert.ok(await sec().locator('.bid-undo-err button:has-text("Open in Results")').count(), 'a link to the row');
      assert.strictEqual((await api('GET', BASE)).json.runs.find((r) => r.id === runId).status, 'committed', 'nothing undone');
      await shotsFrom('undo-refused', '.bid-undo-err', 2);
    });
    await test('Open in Results closes the dashboard and opens that cash session', async () => {
      await sec().locator('.bid-undo-err button:has-text("Open in Results")').first().click();
      await p.locator('.an-sheet').waitFor({ state: 'detached', timeout: 5000 });
      await sleep(1200);
      await shot('open-in-results');
    });
    await test('with that row deleted, the undo goes through and every table is as it was before the commit', async () => {
      assert.strictEqual((await api('DELETE', `/api/cash-sessions/${editedId}`)).status, 200);
      await openImport();
      await waitText(sec(), /Imported: #\d+/);
      await sec().locator('button:has-text("Undo this import")').click();
      const form = sec().locator('form.bid-confirm');
      await form.locator('input').fill(String(summary.undoCount));
      await form.locator('button[type="submit"]').click();
      await waitText(sec(), new RegExp(`Import #${runId} undone\\.`), 15000);
      await waitText(sec(), /1 row you had deleted since was already gone/);
      assert.deepStrictEqual(diffTables(preCommit, await dumpFile(dbPath)), [], 'byte for byte');
      assert.strictEqual((await api('GET', BASE)).json.runs.find((r) => r.id === runId).status, 'undone');
      await shotsFrom('undone', '#bid-title', 1);
    });

    // ══ 6. a delta: changed and deleted in the dashboard ═══════════════════════════════════
    console.log('a delta');
    let first = null, delta = null, preFirst = null, preDelta = null;
    await test('a full import again (the likely pairs filled, the rest different), committed through the screen', async () => {
      preFirst = await dumpFile(dbPath);
      await sec().locator('button:has-text("Fetch from the dashboard")').click();
      await waitText(sec(), /Review: fetch #\d+/, 90000);
      first = (await stagedRun()).id;
      await sec().locator('button:has-text("Fill the likely ones")').click();
      for (const date of ['Mar 13, 2026', 'May 3, 2026']) await sec().locator('.bid-pair', { hasText: date }).locator('[role="radio"]:has-text("Different")').click();
      await saved('pairs');
      await sec().locator('.bid-commit button:has-text("Import")').first().click();
      await sec().locator('.bid-confirm button:has-text("Import")').click();
      await waitText(sec(), /Imported: #\d+/, 90000);
      assert.strictEqual((await api('GET', BASE)).json.runs.find((r) => r.id === first).status, 'committed');
    });
    await test('the dashboard\'s later edits come in as a delta: Changed and Deleted in the dashboard, with their options', async () => {
      fx.seedDelta(stub);
      preDelta = await dumpFile(dbPath);
      await sec().locator('button:has-text("Fetch from the dashboard")').click();
      await waitText(sec(), /Review: fetch #\d+/, 90000);
      delta = (await stagedRun()).id;
      assert.strictEqual((await api('GET', BASE)).json.runs.find((r) => r.id === delta).mode, 'delta');
      await waitText(sec(), /Changed in the dashboard \(3\)/);
      await waitText(sec(), /Deleted in the dashboard \(1\)/);
      const wynn = sec().locator('.bid-item', { hasText: 'Wynn' });
      await wynn.locator('[role="radio"]:has-text("Keep mine")').click();
      await saved('changes');
      const r = await api('GET', `${BASE}/${delta}`);
      assert.strictEqual(r.json.decisions.changes['dash:sessions:s-wynn'], 'keep');
      await shotsFrom('delta', '#bid-g-changes', 3);
      await sec().locator('.bid-commit button:has-text("Import")').first().click();
      await sec().locator('.bid-confirm button:has-text("Import")').click();
      await waitText(sec(), /Imported: #\d+/, 90000);
      assert.strictEqual((await api('GET', BASE)).json.runs.find((r) => r.id === delta).status, 'committed');
    });
    await test('both undone, newest first: the tables are back to before each', async () => {
      const undoNow = async (id, want) => {
        const n = (await api('GET', `${BASE}/${id}`)).json.summary.undoCount;
        await sec().locator('button:has-text("Undo this import")').click();
        const form = sec().locator('form.bid-confirm');
        await form.locator('input').fill(String(n));
        await form.locator('button[type="submit"]').click();
        await waitText(sec(), new RegExp(`Import #${id} undone\\.`), 15000);
        assert.deepStrictEqual(diffTables(want, await dumpFile(dbPath)), [], `undo #${id}`);
      };
      await undoNow(delta, preDelta);
      await waitText(sec(), new RegExp(`Imported: #${first}`));
      await undoNow(first, preFirst);
    });
    await test('no script error on the page', () => { assert.deepStrictEqual(pageErrors, []); });
  } catch (e) {
    console.log('  FAIL (setup)', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n       ') : e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const s of servers) await s.stop().catch(() => {});
    if (stub) await stub.close().catch(() => {});
    for (const c of cleanups) { try { c(); } catch (_) { /* */ } }
  }
  if (process.exitCode) { process.stdout.write('\nmoney-import-review.test.js - setup failed\n', () => process.exit(1)); return; }
  done();
})();
