// The Admin screen's parser eval runner (lib/admin-eval.js): one run at a time, the report kept, no key
// = refused. Runs the eval in --oracle mode, which scores the gaps engine and calls no model.
'use strict';
const assert = require('assert');
const runner = require('../lib/admin-eval');

(async () => {
  assert.strictEqual(runner.start({ env: {} }).status, 503, 'live without a key is refused');
  const done = new Promise((resolve) => {
    const r = runner.start({ args: ['--oracle'], onDone: resolve });
    assert.deepStrictEqual(r, { started: true });
  });
  assert.strictEqual(runner.start({ args: ['--oracle'] }).status, 409, 'one at a time');
  assert.strictEqual(runner.status().running, true);
  const s = await done;
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.exitCode, 0, s.log.slice(-800));
  assert.ok(s.report && /recall/i.test(s.report), 'the Markdown report is kept');
  assert.ok(s.progress && s.progress.done === s.progress.total && s.progress.total > 50, JSON.stringify(s.progress));
  console.log(`admin-eval.test.js - passed (${s.progress.total} cases, report ${s.reportName})`);
})().catch((e) => { console.error(e); process.exit(1); });
