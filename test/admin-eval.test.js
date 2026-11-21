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

  // A finished run is kept (a live run always; this oracle run because the test asks) and listed.
  const SQL = await require('sql.js')();
  const db = new SQL.Database();
  runner.migrate(db);
  let saved = 0;
  runner.init({ getDb: () => db, saveDatabase: async () => { saved++; } });
  const done = new Promise((resolve) => {
    const r = runner.start({ args: ['--oracle'], onDone: resolve, keepRun: true });
    assert.deepStrictEqual(r, { started: true });
  });
  assert.strictEqual(runner.start({ args: ['--oracle'] }).status, 409, 'one at a time');
  assert.strictEqual(runner.status().running, true);
  const s = await done;
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.exitCode, 0, s.log.slice(-800));
  assert.ok(s.report && /recall/i.test(s.report), 'the Markdown report is kept');
  assert.ok(s.progress && s.progress.done === s.progress.total && s.progress.total > 50, JSON.stringify(s.progress));
  assert.ok(s.summary && s.summary.cases === s.progress.total && s.summary.recall === 1, JSON.stringify(s.summary));
  const list = runner.runs();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].cases, s.summary.cases);
  assert.ok(!('report' in list[0]), 'the list leaves the reports out');
  assert.ok(/recall/i.test(runner.run(list[0].id).report));
  assert.strictEqual(runner.run(999), null);
  assert.ok(saved >= 1, 'the database is saved');
  console.log(`admin-eval.test.js - passed (${s.progress.total} cases, report ${s.reportName}, run ${list[0].id} kept)`);
})().catch((e) => { console.error(e); process.exit(1); });
