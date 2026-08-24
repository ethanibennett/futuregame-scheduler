'use strict';

/**
 * TestFlight sleep-kill watchdog.
 *
 * The problem it exists for: the Mac build node is asleep most of the time. A
 * build queues correctly while it is away, but when the Mac surfaces in a "dark
 * wake" — briefly awake with throttled networking — the runner reconnects,
 * GitHub hands it the queued job within ~30 seconds, the Mac drops back to
 * sleep, and GitHub force-fails the job at exactly 600 seconds. GitHub has no
 * native job retry, so the build is simply lost: PR #91 sat unshipped for three
 * days that way. This re-dispatches when that happens.
 *
 * It dispatches rather than re-running, deliberately. `gh run rerun` replays the
 * run's ORIGINAL head SHA — attempt 3 of #90 ran 24.5 hours after attempt 1 on
 * the same commit — and since scripts/ios-testflight.sh reconciles the build
 * number against App Store Connect, a stale rerun uploads older code carrying a
 * higher build number, making stale code the newest TestFlight build.
 * `repository_dispatch` always builds master HEAD, which is what we actually want.
 *
 * It is a mitigation, not a cure. A healthy build takes 3:00–10:36 against a
 * 600-second kill window, so even a well-timed retry has thin margin. The cure
 * is on the Mac (stop it sleeping mid-build).
 *
 * Requires the ios-testflight.yml concurrency block to be `cancel-in-progress:
 * false` (PR #95). Under the old `true`, every dispatch risked cancelling either
 * the queued run it was trying to rescue or a build already live on the Mac —
 * both observed in this repo's history (runs 31774333122 and 31774443175).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = process.env.TESTFLIGHT_REPO || 'ethanibennett/futuregame-scheduler';
const WORKFLOW_FILE = 'ios-testflight.yml';
const DISPATCH_EVENT = 'ios-testflight';

// #90 needed three attempts to ship, so a cap below that would give up on a
// build that was still going to succeed. Keyed on the master SHA, so a
// repeatable fault stops looping but a new commit gets a fresh budget.
const MAX_ATTEMPTS_PER_SHA = 3;

// Cheap guard against dispatching twice in a row if a tick overlaps or a
// dispatch fails to produce a visible run. Below the 20-minute tick, so it
// never blocks a legitimate retry.
const MIN_GAP_BETWEEN_DISPATCHES_MS = 15 * 60 * 1000;

// The workflow sets timeout-minutes: 45 and no observed run has ever hit it. A
// job that ran longer than this is a genuine hang, not the 600-second kill.
const MAX_PLAUSIBLE_JOB_SECONDS = 44 * 60;

const STATE_PATH = process.env.TESTFLIGHT_WATCHDOG_STATE
  || path.join(__dirname, '..', '.testflight-watchdog.json');

// ─── gh plumbing ────────────────────────────────────────────────────────────
// Shelling out to gh rather than holding our own PAT: gh is already
// authenticated on this box and its token stays out of this repo's config.
// execFile with an argument array, never a shell string, so nothing here can be
// injected by a branch or commit message that finds its way into an argument.

function gh(args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.message = `gh ${args.slice(0, 3).join(' ')} failed: ${(stderr || err.message || '').trim().slice(0, 400)}`;
          return reject(err);
        }
        resolve(stdout);
      });
  });
}

async function ghJson(args) {
  const out = await gh(args);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`gh ${args.slice(0, 3).join(' ')} returned unparseable JSON`);
  }
}

// ─── the predicate ──────────────────────────────────────────────────────────

function durationSeconds(job) {
  if (!job || !job.started_at || !job.completed_at) return null;
  const started = Date.parse(job.started_at);
  const completed = Date.parse(job.completed_at);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
  return Math.round((completed - started) / 1000);
}

/**
 * Was this job killed because the Mac went back to sleep under it?
 *
 * Validated against all 10 job attempts in this repo's history (9 failures plus
 * one success): it returns true for exactly the two known sleep kills, jobs
 * 95508235868 (#78) and 96911117244 (#91), and false for everything else —
 * including the two jobs that carry the same lost-communication annotation but
 * were genuinely broken. See test/testflight-watchdog-predicate.js.
 *
 * Each clause earns its place, and neither of the obvious one-line versions
 * works:
 *
 *   - The annotation alone is wrong. Job 94312600996 lost communication because
 *     `fetch-depth: 0` was tearing mid-clone ("RPC failed... fatal: early EOF"),
 *     and job 96292873490 (#90 attempt 1) carries it too while having genuinely
 *     failed to sign.
 *   - The 600-second duration alone is wrong in both directions: 94312600996
 *     lost comms after 937s, and 96292873490 died at exactly 600s but was real.
 *
 * What actually separates a sleep kill is the SHAPE of the step list. GitHub
 * force-failed the job while steps were still mid-flight, so no step reports
 * failure and some never completed at all. A genuinely broken build always has
 * a step that says so.
 *
 * @param {object} job          a jobs API entry (needs conclusion, steps, timings)
 * @param {Array}  annotations  the check-run annotations for that job
 * @returns {{sleepKill: boolean, reason: string}}
 */
function isSleepKill(job, annotations) {
  if (!job) return { sleepKill: false, reason: 'no job' };
  if (job.conclusion !== 'failure') {
    return { sleepKill: false, reason: `job conclusion is ${job.conclusion || 'null'}, not failure` };
  }

  const steps = Array.isArray(job.steps) ? job.steps : [];

  const failed = steps.filter((s) => s && s.conclusion === 'failure');
  if (failed.length) {
    const names = failed.map((s) => s.name).join(', ');
    return { sleepKill: false, reason: `a step failed for real: ${names}` };
  }

  const unfinished = steps.filter((s) => s && s.status !== 'completed');
  if (!unfinished.length) {
    return {
      sleepKill: false,
      reason: steps.length
        ? 'every step completed — the job ran to the end rather than being cut off'
        : 'job reports no steps at all',
    };
  }

  const lostComms = (annotations || []).some((a) => a
    && a.annotation_level === 'failure'
    && /self-hosted runner lost communication/i.test(a.message || ''));
  if (!lostComms) {
    return { sleepKill: false, reason: 'no lost-communication annotation' };
  }

  const seconds = durationSeconds(job);
  if (seconds !== null && seconds > MAX_PLAUSIBLE_JOB_SECONDS) {
    return {
      sleepKill: false,
      reason: `ran ${seconds}s, past the ${MAX_PLAUSIBLE_JOB_SECONDS}s guard — a genuine hang, not the 600s kill`,
    };
  }

  const when = seconds === null ? '' : `, died at ${seconds}s`;
  return {
    sleepKill: true,
    reason: `no step failed but ${unfinished.length} never completed, lost-communication annotation present${when}`,
  };
}

// ─── retry-budget state ─────────────────────────────────────────────────────

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return (parsed && typeof parsed === 'object' && parsed.shas) ? parsed : { shas: {} };
  } catch {
    return { shas: {} };
  }
}

function writeState(state) {
  // Keep the file from growing without bound: newest 20 SHAs is far more than
  // the budget logic ever looks back over.
  const entries = Object.entries(state.shas || {})
    .sort((a, b) => (b[1].lastDispatchAt || 0) - (a[1].lastDispatchAt || 0))
    .slice(0, 20);
  const trimmed = { shas: Object.fromEntries(entries) };
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(trimmed, null, 2));
  } catch (err) {
    // A watchdog that cannot persist its budget must not become one that
    // dispatches forever, so this is loud rather than swallowed.
    throw new Error(`could not write watchdog state to ${STATE_PATH}: ${err.message}`);
  }
}

// ─── giving up ──────────────────────────────────────────────────────────────

/**
 * Hand the problem to the Mac. The cure for a dark wake lives on that machine
 * (power settings, caffeinate, keeping the runner's host awake), and this repo
 * has no way to reach it other than the handoff channel.
 */
async function openHandoff(sha, attempts, log, api) {
  const title = `TestFlight builds keep dying to a sleeping Mac (${sha.slice(0, 7)})`;
  const body = [
    `The watchdog on the Windows box re-dispatched \`${DISPATCH_EVENT}\` ${attempts} times for master \`${sha.slice(0, 7)}\` and every run was force-failed at the runner-communication timeout.`,
    '',
    'That is the dark-wake signature: the Mac surfaces briefly with throttled networking, the runner takes the queued job within ~30 seconds, the Mac sleeps again, and GitHub kills the job at exactly 600 seconds. No step reports failure; some never complete.',
    '',
    'Retrying cannot fix this from the Windows side — a healthy build needs 3–10 minutes against a 600-second window, so every retry is a coin flip. The cure is on the Mac: keep it awake (and its network up) while a build is in flight.',
    '',
    'The watchdog has stopped retrying this commit. A new commit to master gets a fresh budget.',
  ].join('\n');

  // Prefer the real handoff channel so the message lands in `handoff.sh inbox`
  // with the same shape as every other cross-machine item.
  try {
    await new Promise((resolve, reject) => {
      execFile('bash', [path.join(__dirname, 'handoff.sh'), 'send', 'mac', title, '-b', body],
        { timeout: 60000, windowsHide: true, cwd: path.join(__dirname, '..') },
        (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)));
    });
    log('[testflight] opened a handoff issue for the Mac');
    return true;
  } catch (err) {
    log(`[testflight] handoff.sh unavailable (${err.message.slice(0, 120)}), falling back to gh issue create`);
  }

  try {
    await api.gh(['issue', 'create', '--repo', REPO, '--title', title, '--body', body, '--label', 'handoff:mac'],
      { timeoutMs: 60000 });
    log('[testflight] opened a handoff issue for the Mac (direct)');
    return true;
  } catch (err) {
    log(`[testflight] could not open a handoff issue: ${err.message.slice(0, 200)}`);
    return false;
  }
}

// ─── the watchdog ───────────────────────────────────────────────────────────

/**
 * One tick. Safe to call on a timer; every exit path is a no-op unless the
 * newest run is a sleep kill and master HEAD is still unbuilt.
 *
 * `api` and `now` exist so the decision tree can be driven against synthetic
 * GitHub responses in a test. Dispatching for real means a build on the one Mac,
 * which is exactly the thing this code is trying not to waste — so the branch
 * that fires the dispatch is verified with stubs rather than by firing it.
 *
 * @param {{dryRun?: boolean, log?: Function, api?: object, now?: Function}} opts
 * @returns {Promise<{action: string, reason: string, [k: string]: any}>}
 */
async function runWatchdog({ dryRun = false, log = console.log, api = { gh, ghJson }, now = Date.now } = {}) {
  const done = (action, reason, extra = {}) => {
    log(`[testflight] ${action}: ${reason}`);
    return { action, reason, ...extra };
  };

  // Newest first. 10 is plenty: we only care about the newest run plus whether
  // master HEAD already has a success.
  const runsUrl = `repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=10`;
  const { workflow_runs: runs = [] } = await api.ghJson(['api', runsUrl]);
  if (!runs.length) return done('idle', 'no runs found for the workflow');

  // Anything still moving means the situation is already resolving. Dispatching
  // now would only add a second build for the same commit.
  const live = runs.find((r) => r.status && r.status !== 'completed');
  if (live) {
    return done('idle', `run ${live.id} is ${live.status} — leaving it alone`, { runId: live.id });
  }

  const masterSha = (await api.ghJson(['api', `repos/${REPO}/commits/master`])).sha;

  // If master HEAD already built successfully there is nothing to rescue, even
  // if older runs failed.
  const shipped = runs.find((r) => r.head_sha === masterSha && r.conclusion === 'success');
  if (shipped) {
    return done('idle', `master ${masterSha.slice(0, 7)} already shipped in run ${shipped.id}`, { runId: shipped.id });
  }

  const newest = runs[0];
  if (newest.conclusion !== 'failure') {
    return done('idle', `newest run ${newest.id} concluded ${newest.conclusion} — nothing to retry`, { runId: newest.id });
  }

  const { jobs = [] } = await api.ghJson(['api', `repos/${REPO}/actions/runs/${newest.id}/jobs`]);
  const job = jobs[0];
  if (!job) return done('idle', `run ${newest.id} reports no jobs`, { runId: newest.id });

  let annotations = [];
  try {
    annotations = await api.ghJson(['api', `repos/${REPO}/check-runs/${job.id}/annotations`]);
  } catch (err) {
    // Treat a missing annotation list as "cannot confirm", which fails closed:
    // the predicate needs the annotation, so this ends as a no-op.
    log(`[testflight] could not read annotations for job ${job.id}: ${err.message.slice(0, 160)}`);
  }

  const verdict = isSleepKill(job, annotations);
  if (!verdict.sleepKill) {
    return done('idle', `run ${newest.id} failed but is not a sleep kill — ${verdict.reason}`, { runId: newest.id });
  }

  // Budget is keyed on what we are about to build (master HEAD), not on what
  // the failed run built, because a dispatch always builds master HEAD.
  const state = readState();
  const entry = state.shas[masterSha] || { attempts: 0, lastDispatchAt: 0, handoffOpened: false };

  if (entry.attempts >= MAX_ATTEMPTS_PER_SHA) {
    if (!entry.handoffOpened && !dryRun) {
      const opened = await openHandoff(masterSha, entry.attempts, log, api);
      if (opened) {
        entry.handoffOpened = true;
        state.shas[masterSha] = entry;
        writeState(state);
      }
    }
    return done('gave-up',
      `${entry.attempts} dispatches for master ${masterSha.slice(0, 7)} all died the same way — the fix is on the Mac`,
      { sha: masterSha, attempts: entry.attempts });
  }

  const since = now() - (entry.lastDispatchAt || 0);
  if (entry.lastDispatchAt && since < MIN_GAP_BETWEEN_DISPATCHES_MS) {
    return done('idle', `dispatched ${Math.round(since / 60000)} min ago — waiting out the cooldown`, { sha: masterSha });
  }

  if (dryRun) {
    return done('would-dispatch',
      `run ${newest.id} was a sleep kill (${verdict.reason}); would build master ${masterSha.slice(0, 7)}, attempt ${entry.attempts + 1}/${MAX_ATTEMPTS_PER_SHA}`,
      { runId: newest.id, sha: masterSha });
  }

  await api.gh(['api', `repos/${REPO}/dispatches`, '-f', `event_type=${DISPATCH_EVENT}`]);

  entry.attempts += 1;
  entry.lastDispatchAt = now();
  state.shas[masterSha] = entry;
  writeState(state);

  return done('dispatched',
    `run ${newest.id} was a sleep kill (${verdict.reason}); rebuilding master ${masterSha.slice(0, 7)}, attempt ${entry.attempts}/${MAX_ATTEMPTS_PER_SHA}`,
    { runId: newest.id, sha: masterSha, attempts: entry.attempts });
}

module.exports = { runWatchdog, isSleepKill, durationSeconds, STATE_PATH, MAX_ATTEMPTS_PER_SHA };

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  runWatchdog({ dryRun })
    .then((r) => process.exit(r.action === 'gave-up' ? 2 : 0))
    .catch((err) => {
      console.error(`[testflight] watchdog error: ${err.message}`);
      process.exit(1);
    });
}
