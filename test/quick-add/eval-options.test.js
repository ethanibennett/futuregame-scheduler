// eval.js's per-run options (2026-11-21): --model, --effort and --sample reach the parser, and the report
// carries what the run cost. Run: node test/quick-add/eval-options.test.js
// No API key is used: the parser is a stub module (--module) that answers with canned usage; the key the
// default mode insists on is a dummy, and no request leaves the process.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-eval-opts-'));
const seen = path.join(dir, 'seen.jsonl');
const stub = path.join(dir, 'stub-parser.js');
fs.writeFileSync(stub, `
const fs = require('fs');
const { costUsd } = require(${JSON.stringify(path.join(__dirname, '..', '..', 'lib', 'quick-add', 'pricing.js'))});
exports.DEFAULTS = { parseModel: 'claude-sonnet-5' };
exports.parseHand = async ({ client, text, source, model, effort }) => {
  fs.appendFileSync(${JSON.stringify(seen)}, JSON.stringify({ client: !!client, model, effort, source }) + '\\n');
  const usage = { input_tokens: 500, output_tokens: 3000, cache_read_input_tokens: 11000, cache_creation_input_tokens: 0 };
  return { hand: null, notes: [], usage, meta: { model, servedBy: model, mode: 'thinking', effort, calls: 1, fallback: false, costUsd: costUsd(usage, model) } };
};
`);
try {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'eval.js'), '--module', stub, '--model', 'claude-opus-5-5', '--effort', 'low', '--sample', '12', '--no-gaps', '--out', dir],
    { env: { ...process.env, ANTHROPIC_API_KEY: 'sk-test-dummy' }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const calls = fs.readFileSync(seen, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(calls.length, 12, 'a sample of 12');
  assert.ok(calls.every((c) => c.client && c.model === 'claude-opus-5-5' && c.effort === 'low'), JSON.stringify(calls[0]));
  assert.ok(new Set(calls.map((c) => c.source)).size === 2, 'the sample spans typed and spoken cases');
  const json = fs.readdirSync(dir).find((f) => f.endsWith('-module.json'));
  const report = JSON.parse(fs.readFileSync(path.join(dir, json), 'utf8'));
  assert.deepStrictEqual([report.meta.options.model, report.meta.options.effort, report.meta.options.sample], ['claude-opus-5-5', 'low', 12]);
  assert.strictEqual(report.meta.options.shape, 'claude-opus-5-5, thinking at effort low');
  const c = report.aggregate.cost;
  // 500 in at $4, 3,000 out at $20, 11,000 cache reads at $0.20 per million: $0.0642 a parse.
  assert.strictEqual(c.perCaseUsd, 0.0642);
  assert.strictEqual(c.totalUsd, Math.round(0.0642 * 12 * 10000) / 10000);
  assert.strictEqual(c.outputTokensPerCase, 3000);
  assert.match(r.stdout, /Cost {12}\$0\.77 total, \$0\.0642 per case at list price \(3000 output tokens a parse/);
  // admin-eval keeps these figures for the side-by-side table.
  const s = require('../../lib/admin-eval').summarize(report, { model: 'claude-opus-5-5', effort: 'low', corpus: 'main', sample: 12 });
  assert.deepStrictEqual([s.model, s.effort, s.cases, s.costPerCase, s.outputTokensPerCase], ['claude-opus-5-5', 'low', 12, 0.0642, 3000]);
  // A run with no effort reaches eval.js as --effort off: kept as null ("no thinking"), not 'off'.
  const { summarize } = require('../../lib/admin-eval');
  const offReport = { ...report, meta: { ...report.meta, options: { ...report.meta.options, effort: 'off' } } };
  assert.strictEqual(summarize(offReport, { model: 'claude-sonnet-5', effort: null, corpus: 'main', sample: null }).effort, null);
  assert.strictEqual(summarize(offReport, null).effort, null);
  console.log('eval-options.test.js - passed (model, effort and sample reach the parser; the report carries the cost)');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
