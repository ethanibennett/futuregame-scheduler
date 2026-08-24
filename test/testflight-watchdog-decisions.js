'use strict';

/**
 * Drives the watchdog's decision tree against synthetic GitHub responses.
 *
 * The predicate has its own test against real history; this covers what happens
 * AROUND it — the guards that decide whether to dispatch at all. Those matter as
 * much as the detection: a watchdog that retries when it shouldn't wastes builds
 * on the one Mac, and a watchdog that retries forever is worse than none.
 *
 * The dispatch branch is verified here rather than by firing a real
 * repository_dispatch, which would queue an actual TestFlight build.
 *
 * Run: node test/testflight-watchdog-decisions.js   (no network, no gh)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-watchdog-')), 'state.json');
process.env.TESTFLIGHT_WATCHDOG_STATE = STATE_FILE;

// Must come after the env var above — the module reads it at load time.
const { runWatchdog, MAX_ATTEMPTS_PER_SHA } = require('../scripts/testflight-watchdog');

const MASTER = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const LOST_COMMS = [{ annotation_level: 'failure', message: 'The self-hosted runner lost communication with the server.' }];

const sleepKilledJob = {
  id: 999,
  conclusion: 'failure',
  started_at: '2026-08-21T22:17:09Z',
  completed_at: '2026-08-21T22:27:09Z',
  steps: [
    { name: 'Checkout', status: 'completed', conclusion: 'success' },
    { name: 'Build and upload to TestFlight', status: 'pending', conclusion: null },
    { name: 'Restore keychain search list', status: 'pending', conclusion: null },
  ],
};

const genuinelyBrokenJob = {
  id: 998,
  conclusion: 'failure',
  started_at: '2026-08-21T22:17:09Z',
  completed_at: '2026-08-21T22:20:09Z',
  steps: [
    { name: 'Checkout', status: 'completed', conclusion: 'success' },
    { name: 'Build and upload to TestFlight', status: 'completed', conclusion: 'failure' },
  ],
};

/**
 * A fake GitHub. Records every call so a test can assert what was sent, which is
 * the only way to check the dispatch is well-formed without actually sending it.
 */
function fakeApi({ runs, job, annotations = LOST_COMMS, master = MASTER }) {
  const calls = [];
  return {
    calls,
    gh: async (args) => { calls.push(args); return ''; },
    ghJson: async (args) => {
      calls.push(args);
      const url = args[1] || '';
      if (url.includes('/actions/workflows/')) return { workflow_runs: runs };
      if (url.includes('/commits/master')) return { sha: master };
      if (url.includes('/jobs')) return { jobs: job ? [job] : [] };
      if (url.includes('/annotations')) return annotations;
      throw new Error(`unexpected call: ${url}`);
    },
  };
}

const run = (r) => ({ id: 1, status: 'completed', conclusion: 'failure', head_sha: MASTER, ...r });

let failures = 0;
const quiet = () => {};

async function check(what, opts, expect) {
  try { fs.unlinkSync(STATE_FILE); } catch { /* fresh budget per case */ }
  if (opts.seedState) fs.writeFileSync(STATE_FILE, JSON.stringify(opts.seedState));

  const api = fakeApi(opts);
  const result = await runWatchdog({ api, log: quiet, now: opts.now || Date.now, dryRun: opts.dryRun });

  const ok = result.action === expect.action
    && (!expect.dispatched === !api.calls.some((c) => c[1] && c[1].endsWith('/dispatches')));
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  console.log(`        → ${result.action}: ${result.reason}`);
  if (!ok) console.log(`        expected action=${expect.action} dispatched=${!!expect.dispatched}`);
  return { api, result };
}

async function main() {
  console.log('\nguards — must NOT dispatch:\n');

  await check('a run still in flight is left alone',
    { runs: [run({ status: 'in_progress', conclusion: null })] },
    { action: 'idle' });

  await check('master HEAD already shipped',
    { runs: [run({ conclusion: 'success' })] },
    { action: 'idle' });

  await check('newest run succeeded, older failures ignored',
    { runs: [run({ id: 2, conclusion: 'success', head_sha: OLDER }), run({ id: 1 })], master: OLDER },
    { action: 'idle' });

  await check('newest run was cancelled, not failed',
    { runs: [run({ conclusion: 'cancelled' })] },
    { action: 'idle' });

  await check('failure with a genuinely failed step',
    { runs: [run({})], job: genuinelyBrokenJob },
    { action: 'idle' });

  await check('sleep-kill shape but no lost-comms annotation',
    { runs: [run({})], job: sleepKilledJob, annotations: [] },
    { action: 'idle' });

  await check('within the cooldown after a recent dispatch',
    {
      runs: [run({})],
      job: sleepKilledJob,
      seedState: { shas: { [MASTER]: { attempts: 1, lastDispatchAt: Date.now() - 60_000 } } },
    },
    { action: 'idle' });

  await check('dry run stops short of dispatching',
    { runs: [run({})], job: sleepKilledJob, dryRun: true },
    { action: 'would-dispatch' });

  console.log('\nthe retry budget:\n');

  await check(`gives up after ${MAX_ATTEMPTS_PER_SHA} attempts on the same SHA`,
    {
      runs: [run({})],
      job: sleepKilledJob,
      seedState: { shas: { [MASTER]: { attempts: MAX_ATTEMPTS_PER_SHA, lastDispatchAt: 0, handoffOpened: true } } },
    },
    { action: 'gave-up' });

  await check('a new commit gets a fresh budget',
    {
      runs: [run({ head_sha: OLDER })],
      job: sleepKilledJob,
      seedState: { shas: { [OLDER]: { attempts: MAX_ATTEMPTS_PER_SHA, lastDispatchAt: 0, handoffOpened: true } } },
    },
    { action: 'dispatched', dispatched: true });

  console.log('\nthe dispatch itself:\n');

  const { api, result } = await check('a sleep kill dispatches a rebuild of master HEAD',
    { runs: [run({})], job: sleepKilledJob },
    { action: 'dispatched', dispatched: true });

  // The exact wire format matters: the workflow only listens for
  // `repository_dispatch: types: [ios-testflight]`, so a malformed event type
  // would no-op silently at GitHub's end and look like the watchdog never ran.
  const dispatch = api.calls.find((c) => c[1] && c[1].endsWith('/dispatches'));
  const shaped = dispatch
    && dispatch[0] === 'api'
    && dispatch[1] === 'repos/ethanibennett/futuregame-scheduler/dispatches'
    && dispatch[2] === '-f'
    && dispatch[3] === 'event_type=ios-testflight';
  if (!shaped) failures++;
  console.log(`  ${shaped ? 'ok  ' : 'FAIL'}  the dispatch matches what the workflow listens for`);
  console.log(`        → gh ${(dispatch || []).join(' ')}`);

  // Budget must actually persist, or the cap never bites across ticks.
  const persisted = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const recorded = persisted.shas[MASTER] && persisted.shas[MASTER].attempts === 1;
  if (!recorded) failures++;
  console.log(`  ${recorded ? 'ok  ' : 'FAIL'}  the attempt was written to the budget file`);
  console.log(`        → ${JSON.stringify(persisted.shas[MASTER] || null)}`);

  if (result.sha !== MASTER) {
    failures++;
    console.log('  FAIL  dispatch was keyed on the wrong SHA');
  }

  console.log(`\n${failures ? `FAILED — ${failures} case(s) wrong` : 'passed'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`test error: ${err.stack}`);
  process.exit(1);
});
