'use strict';

/**
 * Drives the nightly TestFlight dispatcher against synthetic GitHub responses: when it ships
 * master HEAD, when it waits, when it skips the night. No network, no gh, no real build.
 *
 * Run: node test/testflight-nightly.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-nightly-'));
process.env.TESTFLIGHT_NIGHTLY_STATE = path.join(dir, 'state.json');
process.env.TESTFLIGHT_HOLD = path.join(dir, 'hold');
delete process.env.RENDER_API_KEY;

const { runNightly, localClock } = require('../scripts/testflight-nightly');

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
// 2026-10-13 is EDT (UTC-4): 08:00Z = 04:00 Eastern.
const at = (hhmm) => Date.parse(`2026-10-13T${hhmm}:00Z`);
const quiet = () => {};

function api(runs) {
  const calls = [];
  return {
    calls,
    async ghJson(args) {
      if (args[1].endsWith('/commits/master')) return { sha: HEAD };
      return { workflow_runs: runs };
    },
    async gh(args) { calls.push(args); return ''; },
  };
}
const reset = () => { for (const f of [process.env.TESTFLIGHT_NIGHTLY_STATE, process.env.TESTFLIGHT_HOLD]) try { fs.unlinkSync(f); } catch { /* absent */ } };
const run = (a, t, extra = {}) => runNightly({ api: a, now: () => t, log: quiet, ...extra });

(async () => {
  let n = 0;
  const test = async (name, fn) => { reset(); await fn(); n++; console.log('ok', name); };

  await test('clock: 08:00Z is 04:00 Eastern on the 13th', () => {
    assert.deepStrictEqual(localClock(at('08:00')), { date: '2026-10-13', hour: 4 });
  });

  await test('outside the window it does nothing', async () => {
    const a = api([{ id: 1, head_sha: OLD, status: 'completed', conclusion: 'success' }]);
    assert.strictEqual((await run(a, at('07:30'))).action, 'outside-window'); // 03:30
    assert.strictEqual((await run(a, at('14:00'))).action, 'outside-window'); // 10:00
    assert.strictEqual(a.calls.length, 0);
  });

  await test('new commit, nothing live: dispatches once, then done for the night', async () => {
    const a = api([{ id: 1, head_sha: OLD, status: 'completed', conclusion: 'success' }]);
    assert.strictEqual((await run(a, at('08:00'))).action, 'dispatched');
    assert.deepStrictEqual(a.calls[0], ['api', 'repos/ethanibennett/futuregame-scheduler/dispatches', '-f', 'event_type=ios-testflight']);
    assert.strictEqual((await run(a, at('08:30'))).action, 'done-tonight');
    assert.strictEqual(a.calls.length, 1);
  });

  await test('HEAD already built: no build tonight', async () => {
    const a = api([{ id: 2, head_sha: HEAD, status: 'completed', conclusion: 'success' }]);
    assert.strictEqual((await run(a, at('08:00'))).action, 'nothing-new');
    assert.strictEqual((await run(a, at('08:30'))).action, 'done-tonight');
    assert.strictEqual(a.calls.length, 0);
  });

  await test('HEAD already queued or building: leaves it to that run', async () => {
    const a = api([{ id: 3, head_sha: HEAD, status: 'queued', conclusion: null }]);
    assert.strictEqual((await run(a, at('08:00'))).action, 'nothing-new');
    assert.strictEqual(a.calls.length, 0);
  });

  await test('another run live: waits, then ships once it has finished', async () => {
    const runs = [{ id: 4, head_sha: OLD, status: 'in_progress', conclusion: null }];
    const a = api(runs);
    assert.strictEqual((await run(a, at('08:00'))).action, 'wait');
    runs[0].status = 'completed'; runs[0].conclusion = 'success';
    assert.strictEqual((await run(a, at('08:30'))).action, 'dispatched');
    assert.strictEqual(a.calls.length, 1);
  });

  await test('a fresh hold waits; a stale hold is ignored', async () => {
    const a = api([{ id: 5, head_sha: OLD, status: 'completed', conclusion: 'success' }]);
    const hold = process.env.TESTFLIGHT_HOLD;
    fs.writeFileSync(hold, 'merging home + tables');
    const oneHourAgo = new Date(at('08:00') - 3600000);
    fs.utimesSync(hold, oneHourAgo, oneHourAgo);
    const r = await run(a, at('08:00'));
    assert.strictEqual(r.action, 'wait');
    assert.match(r.reason, /held: merging home \+ tables/);
    const sevenHoursAgo = new Date(at('08:00') - 7 * 3600000);
    fs.utimesSync(hold, sevenHoursAgo, sevenHoursAgo);
    assert.strictEqual((await run(a, at('08:30'))).action, 'dispatched');
  });

  await test('blocked until the last tick: skips the night and says why', async () => {
    const a = api([{ id: 6, head_sha: OLD, status: 'queued', conclusion: null }]);
    assert.strictEqual((await run(a, at('13:00'))).action, 'wait');            // 09:00
    const r = await run(a, at('13:30'));                                         // 09:30, the last tick
    assert.strictEqual(r.action, 'skipped-tonight');
    assert.match(JSON.parse(fs.readFileSync(process.env.TESTFLIGHT_NIGHTLY_STATE, 'utf8')).outcome, /^skipped: run 6/);
    assert.strictEqual(a.calls.length, 0);
  });

  await test('production not serving HEAD yet (with a Render key): waits', async () => {
    process.env.RENDER_API_KEY = 'test';
    const fetchImpl = async () => ({ ok: true, json: async () => [{ deploy: { commit: { id: HEAD }, status: 'build_in_progress' } }] });
    const a = api([{ id: 7, head_sha: OLD, status: 'completed', conclusion: 'success' }]);
    assert.strictEqual((await run(a, at('08:00'), { fetchImpl })).action, 'wait');
    const live = async () => ({ ok: true, json: async () => [{ deploy: { commit: { id: HEAD }, status: 'live' } }] });
    assert.strictEqual((await run(a, at('08:30'), { fetchImpl: live })).action, 'dispatched');
    delete process.env.RENDER_API_KEY;
  });

  await test('dry run never dispatches or records the night', async () => {
    const a = api([{ id: 8, head_sha: OLD, status: 'completed', conclusion: 'success' }]);
    assert.strictEqual((await run(a, at('08:00'), { dryRun: true })).action, 'would-dispatch');
    assert.strictEqual(a.calls.length, 0);
    assert.ok(!fs.existsSync(process.env.TESTFLIGHT_NIGHTLY_STATE));
  });

  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
