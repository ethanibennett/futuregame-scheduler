// The Admin screen's parser eval runner (lib/admin-eval.js): one run at a time, the report kept, no key
// = refused. Runs the eval in --oracle mode, which scores the gaps engine and calls no model.
// Since 2026-11-21: a run's options (model, effort, corpus, sample) are checked, and a finished run's
// figures are kept in quick_add_eval_runs for the side-by-side table.
'use strict';
const assert = require('assert');
const runner = require('../lib/admin-eval');

(async () => {
  assert.strictEqual(runner.start({ env: {} }).status, 503, 'live without a key is refused');
  // Options: what reaches eval.js, and what is refused before anything runs.
  const ok = runner.readOptions({ model: 'claude-opus-5-5', effort: 'High', corpus: 'shorthand', sample: 40 });
  assert.deepStrictEqual(ok.options, { model: 'claude-opus-5-5', effort: 'high', corpus: 'shorthand', sample: 40 });
  assert.deepStrictEqual(ok.args.slice(0, 4), ['--model', 'claude-opus-5-5', '--effort', 'high']);
  assert.ok(ok.args.includes('--corpus') && ok.args.includes('--sample'));
  const plain = runner.readOptions({ model: 'claude-sonnet-5', effort: '' });
  assert.deepStrictEqual(plain.options, { model: 'claude-sonnet-5', effort: null, corpus: 'main', sample: null });
  assert.ok(plain.args.includes('off') && !plain.args.includes('--corpus'), 'no effort = the model\'s own request, on the main corpus');
  for (const bad of [{ model: 'gpt-5' }, { model: 'claude-opus-5-5; rm -rf /' }, { effort: 'extreme' }, { corpus: 'mine' }, { sample: 0 }, { sample: 2.5 }]) {
    assert.ok(runner.readOptions(bad).error, JSON.stringify(bad));
  }
  assert.strictEqual(runner.start({ env: { ANTHROPIC_API_KEY: 'k' }, options: { effort: 'extreme' } }).status, 400);

  // A run is kept from its start (a live run always; this oracle run because the test asks), each parse as it
  // finishes, and listed.
  const SQL = await require('sql.js')();
  const db = new SQL.Database();
  runner.migrate(db);
  runner.migrate(db); // twice, as every boot does: the added columns are not added again
  let saved = 0, keptParses = 0;
  const realRun = db.run.bind(db);
  db.run = (sql, params) => { if (/INSERT OR REPLACE INTO quick_add_eval_cases/.test(sql)) keptParses++; return realRun(sql, params); };
  runner.init({ getDb: () => db, saveDatabase: async () => { saved++; } });
  const done = new Promise((resolve) => {
    const r = runner.start({ args: ['--oracle'], onDone: resolve, keepRun: true });
    assert.strictEqual(r.started, true);
    assert.ok(Number.isInteger(r.runId), 'kept from its start');
  });
  assert.strictEqual(runner.start({ args: ['--oracle'] }).status, 409, 'one at a time');
  assert.strictEqual(runner.status().running, true);
  assert.strictEqual(runner.runs()[0].status, 'running');
  const s = await done;
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.exitCode, 0, s.log.slice(-800));
  assert.ok(s.report && /recall/i.test(s.report), 'the Markdown report is kept');
  assert.ok(!/@@case/.test(s.log), 'the kept parses stay out of the log');
  assert.ok(s.progress && s.progress.done === s.progress.total && s.progress.total > 50, JSON.stringify(s.progress));
  assert.ok(s.summary && s.summary.cases === s.progress.total && s.summary.recall === 1, JSON.stringify(s.summary));
  assert.strictEqual(keptParses, s.summary.cases, 'every parse was kept as it finished');
  const list = runner.runs();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].status, 'done');
  assert.strictEqual(list[0].cases, s.summary.cases);
  assert.ok(!('report' in list[0]), 'the list leaves the reports out');
  assert.ok(/recall/i.test(runner.run(list[0].id).report));
  assert.strictEqual(db.exec('SELECT COUNT(*) FROM quick_add_eval_cases')[0].values[0][0], 0, 'a done run drops its kept parses');
  assert.strictEqual(runner.run(999), null);
  assert.ok(saved >= 1, 'the database is saved');

  // A run a restart cut off: its row still says running, its first 50 parses are kept. It reads
  // interrupted, and resuming parses only the rest.
  const E = require('./quick-add/eval');
  const path = require('path');
  await E.loadHandConfig();
  const { cases } = E.loadCorpus(path.join(__dirname, 'quick-add', 'corpus'));
  const seen = new Map();
  realRun("INSERT INTO quick_add_eval_runs (started_at, options, status, done_cases, total_cases) VALUES ('2026-11-21T20:00:00Z', '{}', 'running', 50, ?)", [cases.length]);
  const cut = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  for (const c of cases.slice(0, 50)) {
    const v = E.validateCase(c, seen);
    realRun('INSERT INTO quick_add_eval_cases (run_id, case_id, result) VALUES (?, ?, ?)', [cut, c.id, JSON.stringify({ id: c.id, hand: E.buildOracleHand(c, v), notes: [], latencyMs: 1234, usage: null, meta: null, error: null })]);
  }
  const before = runner.runs().find((r) => r.id === cut);
  assert.deepStrictEqual([before.status, before.doneCases, before.totalCases], ['interrupted', 50, cases.length]);
  assert.strictEqual(runner.start({ resume: 999, args: ['--oracle'] }).status, 404);
  assert.strictEqual(runner.start({ resume: list[0].id, args: ['--oracle'] }).status, 409, 'a done run is not resumed');
  keptParses = 0;
  const resumedDone = new Promise((resolve) => {
    const r = runner.start({ resume: cut, args: ['--oracle'], onDone: resolve, keepRun: true });
    assert.deepStrictEqual([r.started, r.runId, r.resumed], [true, cut, 50]);
  });
  assert.strictEqual(runner.runs().find((r) => r.id === cut).status, 'running');
  const s2 = await resumedDone;
  assert.strictEqual(s2.exitCode, 0, s2.log.slice(-800));
  assert.strictEqual(keptParses, cases.length - 50, 'only the missing hands were parsed');
  const after = runner.run(cut);
  assert.deepStrictEqual([after.status, after.cases, after.recall, after.resumed], ['done', cases.length, 1, 50]);
  assert.match(after.report, /Resumed: 50 case\(s\)/);
  assert.strictEqual(runner.runs().length, 2);
  console.log(`admin-eval.test.js - passed (${s.progress.total} cases, run ${list[0].id} kept as it went; run ${cut} resumed with 50 kept)`);
})().catch((e) => { console.error(e); process.exit(1); });
