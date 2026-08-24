'use strict';

/**
 * Re-validates the sleep-kill predicate against this repo's real build history.
 *
 * The predicate exists to separate two failures that look identical at a glance:
 * a build GitHub force-failed because the Mac went back to sleep under it (worth
 * retrying — the code is fine) and a build that genuinely broke (retrying just
 * burns Mac time). Both carry the same "self-hosted runner lost communication"
 * annotation, and both can die at exactly 600 seconds, so neither the annotation
 * nor the duration separates them on its own.
 *
 * These ten job attempts are every one in the repo's history at the time the
 * predicate was written. Two are the known sleep kills. The rest are the
 * counter-examples that make the naive versions wrong — most importantly
 * 94312600996 (lost comms after 937s, from `fetch-depth: 0` tearing mid-clone)
 * and 96292873490 (lost comms, died at exactly 600s, but genuinely failed to
 * sign and even finished uploading 19 minutes after GitHub declared it dead).
 *
 * Run: node test/testflight-watchdog-predicate.js
 * Needs an authenticated gh; it reads the jobs back from the API rather than
 * trusting a fixture, so a change in what GitHub reports shows up here.
 */

const { execFile } = require('child_process');
const { isSleepKill, durationSeconds } = require('../scripts/testflight-watchdog');

const REPO = process.env.TESTFLIGHT_REPO || 'ethanibennett/futuregame-scheduler';

const CASES = [
  { job: 95508235868, expect: true, what: '#78 — sleep kill' },
  { job: 96911117244, expect: true, what: '#91 — sleep kill' },
  { job: 94312600996, expect: false, what: 'lost comms after 937s (fetch-depth clone tearing)' },
  { job: 96292873490, expect: false, what: '#90 attempt 1 — lost comms at 600s but genuinely failed to sign' },
  { job: 96652853279, expect: false, what: '#90 attempt 2 — real failure, no lost-comms' },
  { job: 94324743557, expect: false, what: '13 Aug dispatch — real failure' },
  { job: 94324522977, expect: false, what: '13 Aug dispatch — real failure' },
  { job: 94324012084, expect: false, what: '13 Aug dispatch — real failure' },
  { job: 94323660357, expect: false, what: '13 Aug dispatch — real failure' },
];

function gh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: 30000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim().slice(0, 300))) : resolve(stdout)));
  });
}

const ghJson = async (args) => JSON.parse(await gh(args));

async function main() {
  let failures = 0;
  let skipped = 0;

  for (const c of CASES) {
    let job;
    try {
      job = await ghJson(['api', `repos/${REPO}/actions/jobs/${c.job}`]);
    } catch (err) {
      // Job logs and metadata age out. A vanished job is not a broken predicate,
      // so say so plainly rather than failing the run.
      console.log(`  SKIP  ${c.job}  ${c.what} — unreadable (${err.message.slice(0, 60)})`);
      skipped++;
      continue;
    }

    let annotations = [];
    try {
      annotations = await ghJson(['api', `repos/${REPO}/check-runs/${c.job}/annotations`]);
    } catch { /* absent annotations are a legitimate input — the predicate handles it */ }

    const { sleepKill, reason } = isSleepKill(job, annotations);
    const ok = sleepKill === c.expect;
    if (!ok) failures++;

    const secs = durationSeconds(job);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${c.job}  ${sleepKill ? 'SLEEP-KILL' : 'not-sleep '}  ${secs === null ? '   ?' : String(secs).padStart(4)}s  ${c.what}`);
    if (!ok) console.log(`        expected ${c.expect ? 'SLEEP-KILL' : 'not-sleep'} — predicate said: ${reason}`);
  }

  // Pure-function cases: the shapes that must never trigger a retry, checked
  // without the network so they hold even when the API history ages out.
  const synthetic = [
    ['a successful job', { conclusion: 'success', steps: [{ status: 'completed', conclusion: 'success' }] }, [], false],
    ['a cancelled job', { conclusion: 'cancelled', steps: [{ status: 'completed', conclusion: 'cancelled' }] }, [], false],
    ['unfinished steps but no lost-comms annotation',
      { conclusion: 'failure', steps: [{ status: 'completed', conclusion: 'success' }, { status: 'pending', conclusion: null }] }, [], false],
    ['the sleep-kill shape',
      { conclusion: 'failure', steps: [{ status: 'completed', conclusion: 'success' }, { status: 'pending', conclusion: null }] },
      [{ annotation_level: 'failure', message: 'The self-hosted runner lost communication with the server.' }], true],
    ['the sleep-kill shape but past the 45-minute timeout',
      {
        conclusion: 'failure',
        started_at: '2026-08-01T00:00:00Z',
        completed_at: '2026-08-01T00:45:00Z',
        steps: [{ status: 'completed', conclusion: 'success' }, { status: 'pending', conclusion: null }],
      },
      [{ annotation_level: 'failure', message: 'The self-hosted runner lost communication with the server.' }], false],
  ];

  for (const [what, job, annotations, expect] of synthetic) {
    const { sleepKill, reason } = isSleepKill(job, annotations);
    const ok = sleepKill === expect;
    if (!ok) failures++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  synthetic   ${sleepKill ? 'SLEEP-KILL' : 'not-sleep '}         ${what}`);
    if (!ok) console.log(`        expected ${expect ? 'SLEEP-KILL' : 'not-sleep'} — predicate said: ${reason}`);
  }

  console.log(`\n${failures ? `FAILED — ${failures} case(s) wrong` : 'passed'}${skipped ? ` (${skipped} skipped)` : ''}`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`test error: ${err.message}`);
  process.exit(1);
});
