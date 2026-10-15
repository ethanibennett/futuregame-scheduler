#!/usr/bin/env node
'use strict';
/*
 * A staged dashboard import of MADE-UP money in a SCRATCH database, so the import review
 * (Bankroll › Import › From the dashboard app, docs/bankroll-merge.md §9.3) can be looked at and
 * the guards can walk it (check-control-centring.mjs bankroll-import-dashboard*, the
 * check-text-clipping.mjs pass of the same name).
 *
 *   JWT_SECRET=<the scratch server's> node scripts/seed-money-import-demo.js <scratch.db> [--owner <userId>] [--delta]
 *
 * The database must already exist with every migration run (boot server.js on it once), and the
 * server must be STOPPED while this runs: server.js holds the database in memory and would write
 * its own copy over this one. Boot it again afterwards with CONSOLE_OWNER_USER_ID set to the owner.
 *
 * What it writes, through the Phase 5 engine itself (lib/money-import), never by hand:
 *   - the owner's rows "here" (test/helpers/money-import-fixtures.js seedHere: cash nights that pair
 *     with the dashboard's, a schedule-feed result, deposits, an expense, a staking backer and the
 *     dashboard-era backer surface), once: a second run finds them and leaves them;
 *   - a STAGED run built from the fixtures' dashboard (seedDashboard), as POST /fetch would stage it:
 *     every card kind the review shows (pairs with equal and unequal nets, likely and possible, the
 *     three backer sources, slate deals linked and not, balances, divergences, flags and errors);
 *   - with --delta: that first import COMMITTED (the likely pairs the same night, the rest
 *     different), then the dashboard's later edits (seedDelta) staged as a delta, so the review shows
 *     Changed and Deleted in the dashboard.
 *
 * JWT_SECRET must be the scratch server's: a link-only backer's fingerprint is keyed by it (plan.js
 * tokenFp), and a run seeded under another secret would not match what that server computes.
 *
 * NEVER point this at poker-tournaments.db or a copy of it: it refuses that file by name.
 * Every name, token, address and figure is invented (the Phase 5 test's fixtures).
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const engine = require('../lib/money-import');
const pull = require('../lib/money-import/pull');
const ledger = require('../lib/bankroll-ledger');
const { createStub } = require('../test/helpers/stub-dashboard');
const fx = require('../test/helpers/money-import-fixtures');

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const opt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const delta = args.includes('--delta');

function die(msg) { console.error(`seed-money-import-demo: ${msg}`); process.exit(1); }

if (!dbPath) die('usage: JWT_SECRET=<secret> node scripts/seed-money-import-demo.js <scratch.db> [--owner <userId>] [--delta]');
if (/poker-tournaments/i.test(path.basename(dbPath))) die('refusing the live database (poker-tournaments.db). Use a scratch copy.');
if (!fs.existsSync(dbPath)) die(`${dbPath} does not exist. Boot server.js on it once so its tables are made.`);
if (!process.env.JWT_SECRET) die('set JWT_SECRET to the scratch server\'s secret (a link-only backer\'s fingerprint is keyed by it).');

const rowsOf = (db, sql, p = []) => {
  const r = db.exec(sql, p);
  return r.length ? r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]]))) : [];
};
const one = (db, sql, p = []) => { const r = rowsOf(db, sql, p); return r.length ? r[0] : null; };

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const cols = rowsOf(db, 'PRAGMA table_info(money_import_runs)').map((c) => c.name);
  if (!cols.includes('source_hash')) die('this database has not had the money-import-2026-10 migration: boot server.js on it once first.');

  let uid = opt('--owner') != null ? Number(opt('--owner')) : null;
  if (uid == null) {
    const u = one(db, "SELECT id FROM users WHERE username IN ('ham', 'ham5') ORDER BY username = 'ham' DESC LIMIT 1") || one(db, 'SELECT id FROM users ORDER BY id LIMIT 1');
    if (!u) die('no users in this database: register one first.');
    uid = u.id;
  }
  const user = one(db, 'SELECT id, username FROM users WHERE id = ?', [uid]);
  if (!user) die(`no user with id ${uid}`);

  // The owner's rows here, once (the fixtures' schedule-feed tournament marks them).
  if (!one(db, "SELECT id FROM tournaments WHERE stable_id = 'TEST-BORGATA-0402'")) {
    fx.seedHere(db, uid);
    console.log(`seeded the owner's rows here (user ${uid}, ${user.username})`);
  } else console.log('the owner\'s rows here are already seeded; left as they are');

  const sources = ledger.loadSources();
  const stub = createStub({ token: 'seed-only' });
  fx.seedDashboard(stub);
  const stageFrom = (body, wanted) => {
    const ok = pull.verifyExport(body, { since: body.since });
    if (!ok.ok) die(`the made-up export failed its own checks: ${ok.problems.join('; ')}`);
    const m = engine.pullMode(db, uid, wanted);
    const { runId, discarded } = engine.stage(db, uid, body, { mode: m.mode, since: m.since, baseCursor: m.baseCursor });
    const built = engine.refreshPlan(db, uid, engine.getRun(db, uid, runId), { rates: null, sources });
    if (built.error) die(`the plan did not build: ${built.error}`);
    if (discarded.length) console.log(`discarded the staged run${discarded.length === 1 ? '' : 's'} #${discarded.join(', #')}`);
    return { runId, plan: built.plan, mode: m.mode };
  };

  let staged;
  if (!delta) {
    staged = stageFrom(stub.build(null), 'full');
  } else {
    const first = engine.lastCommitted(db, uid) ? null : stageFrom(stub.build(null), 'full');
    if (first) {
      const decisions = { pairs: Object.fromEntries(first.plan.pairs.map((p) => [p.id, p.class === 'likely' ? 'same-keep' : 'different'])) };
      db.run('UPDATE money_import_runs SET decisions = ? WHERE id = ?', [JSON.stringify(decisions), first.runId]);
      const run = engine.getRun(db, uid, first.runId);
      const re = engine.refreshPlan(db, uid, run, { rates: null, sources });
      const c = engine.commit(db, uid, engine.getRun(db, uid, first.runId), { planHash: re.plan.planHash, rates: null, sources });
      if (c.status !== 200) die(`the first import did not commit: ${c.body.error}`);
      console.log(`committed run #${first.runId}: ${c.body.summary.undoCount} rows`);
    }
    fx.seedDelta(stub);
    const last = engine.lastCommitted(db, uid);
    staged = stageFrom(stub.build(pull.deltaSince(last.cursor)), 'delta');
  }
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  const p = staged.plan;
  console.log(`staged run #${staged.runId} (${staged.mode}): ${p.pairs.length} pairs (${p.undecided} to answer), ${p.backers.length} backers, ` +
    `${p.slate.deals.length} slate deals, ${p.changes.length} changed, ${p.deletions.length} deleted, ${p.errors.length} errors; ` +
    `unexplained roll ${p.reconciliation.unexplained.roll}, fund ${p.reconciliation.unexplained.fund}`);
  console.log(`boot the server with CONSOLE_OWNER_USER_ID=${uid} and the same JWT_SECRET, then open Bankroll › Dashboard › Import.`);
})().catch((e) => { console.error(e); process.exit(2); });
