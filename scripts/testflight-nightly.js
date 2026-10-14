'use strict';

/**
 * Nightly TestFlight build (owner, 2026-10-13): "a daily scheduled push to TestFlight at 4am (or
 * whenever it makes sense if processes are still running then)".
 *
 * Commits to master carry [skip ci], so pushes no longer build the app; this ships master HEAD once
 * a night instead. It ticks from 04:00 to 09:30 Eastern (server.js) and dispatches on the first tick
 * where a build makes sense:
 *
 *   - master HEAD has not already built successfully, and no run for it is queued or building
 *     (nothing new means no build that night);
 *   - no other TestFlight run is live (the Mac is busy, or asleep with a job queued);
 *   - no session has put a HOLD on (.testflight-hold at the repo root, e.g. while a merge of
 *     several branches is half done); a hold older than HOLD_STALE_HOURS is ignored, logged;
 *   - when RENDER_API_KEY is set, futurega.me is already serving master HEAD (an app built from
 *     HEAD talks to production's API, so it should not ship ahead of the server it needs).
 *
 * Anything that blocks just waits for the next tick; if the morning runs out, the night is skipped
 * and the log says why. One dispatch per night at most, remembered in .testflight-nightly.json so
 * the 05:00 pm2 restart cannot cause a second. A dispatch builds master HEAD (repository_dispatch,
 * never `gh run rerun` — see testflight-watchdog.js), and the sleep-kill watchdog then retries it
 * if the Mac drops the job.
 */

const fs = require('fs');
const path = require('path');
const { gh, ghJson } = require('./testflight-watchdog');

const REPO = process.env.TESTFLIGHT_REPO || 'ethanibennett/futuregame-scheduler';
const WORKFLOW_FILE = 'ios-testflight.yml';
const DISPATCH_EVENT = 'ios-testflight';
const TZ = 'America/New_York';
const WINDOW_START_HOUR = 4;   // first tick 04:00
const WINDOW_END_HOUR = 10;    // last tick before 10:00
const HOLD_STALE_HOURS = 6;
const RENDER_SERVICE = 'srv-d6b8ujfgi27c73d5v3p0';

const ROOT = path.join(__dirname, '..');
const STATE_PATH = process.env.TESTFLIGHT_NIGHTLY_STATE || path.join(ROOT, '.testflight-nightly.json');
const HOLD_PATH = process.env.TESTFLIGHT_HOLD || path.join(ROOT, '.testflight-hold');

/** The local date and hour in the console's timezone. */
function localClock(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) || {}; } catch { return {}; }
}
function writeState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

/** A hold a session put on, or null. Stale holds are reported but do not block. */
function readHold(nowMs) {
  let st;
  try { st = fs.statSync(HOLD_PATH); } catch { return null; }
  let why = '';
  try { why = fs.readFileSync(HOLD_PATH, 'utf8').trim().slice(0, 200); } catch { /* empty is fine */ }
  const ageH = (nowMs - st.mtimeMs) / 3600000;
  return { why: why || 'no reason given', ageH, stale: ageH > HOLD_STALE_HOURS };
}

/** Is futurega.me serving this commit? null when it cannot tell (no key, API down). */
async function renderServes(sha, fetchImpl = globalThis.fetch) {
  const key = process.env.RENDER_API_KEY;
  if (!key || !fetchImpl) return null;
  try {
    const res = await fetchImpl(`https://api.render.com/v1/services/${RENDER_SERVICE}/deploys?limit=5`,
      { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (!res.ok) return null;
    const deploys = (await res.json()).map((x) => x.deploy).filter(Boolean);
    const mine = deploys.find((d) => d.commit && d.commit.id === sha);
    if (!mine) return false;
    return mine.status === 'live';
  } catch { return null; }
}

/**
 * One tick. Returns { action, reason }; action is 'dispatched', 'would-dispatch', 'wait',
 * 'nothing-new', 'done-tonight', 'outside-window' or 'skipped-tonight'.
 * `api`, `now`, `fetchImpl` are injectable so the decisions can be tested without a build.
 */
async function runNightly({ dryRun = false, log = console.log, api = { gh, ghJson }, now = Date.now, fetchImpl } = {}) {
  const t = now();
  const { date, hour } = localClock(t);
  const done = (action, reason, extra = {}) => { log(`[testflight-nightly] ${action}: ${reason}`); return { action, reason, ...extra }; };

  if (hour < WINDOW_START_HOUR || hour >= WINDOW_END_HOUR) return done('outside-window', `${hour}:00 Eastern is outside ${WINDOW_START_HOUR}:00–${WINDOW_END_HOUR}:00`);
  const state = readState();
  if (state.date === date) return done('done-tonight', `already handled ${date}: ${state.outcome}`);
  const lastTick = hour === WINDOW_END_HOUR - 1 && new Date(t).getMinutes() >= 30;
  const settle = (outcome, extra = {}) => { if (!dryRun) writeState({ date, outcome, at: new Date(t).toISOString(), ...extra }); };
  const wait = (reason) => {
    if (lastTick) { settle(`skipped: ${reason}`); return done('skipped-tonight', `${reason} — out of morning, no build tonight`); }
    return done('wait', reason);
  };

  const masterSha = (await api.ghJson(['api', `repos/${REPO}/commits/master`])).sha;
  const { workflow_runs: runs = [] } = await api.ghJson(['api', `repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=20`]);

  const builtHead = runs.find((r) => r.head_sha === masterSha && r.conclusion === 'success');
  if (builtHead) { settle(`nothing new (${masterSha.slice(0, 7)} built in run ${builtHead.id})`); return done('nothing-new', `master ${masterSha.slice(0, 7)} already on TestFlight (run ${builtHead.id})`); }
  const headLive = runs.find((r) => r.head_sha === masterSha && r.status !== 'completed');
  if (headLive) { settle(`already building ${masterSha.slice(0, 7)} (run ${headLive.id})`); return done('nothing-new', `master ${masterSha.slice(0, 7)} is already ${headLive.status} in run ${headLive.id}`); }

  const live = runs.find((r) => r.status && r.status !== 'completed');
  if (live) return wait(`run ${live.id} (${live.head_sha.slice(0, 7)}) is ${live.status}`);

  const hold = readHold(t);
  if (hold && !hold.stale) return wait(`held: ${hold.why} (${hold.ageH.toFixed(1)} h old)`);
  if (hold && hold.stale) log(`[testflight-nightly] ignoring a stale hold (${hold.ageH.toFixed(1)} h old): ${hold.why}`);

  const serving = await renderServes(masterSha, fetchImpl);
  if (serving === false) return wait(`futurega.me is not serving ${masterSha.slice(0, 7)} yet`);

  if (dryRun) return done('would-dispatch', `would build master ${masterSha.slice(0, 7)}`, { sha: masterSha });
  await api.gh(['api', `repos/${REPO}/dispatches`, '-f', `event_type=${DISPATCH_EVENT}`]);
  settle(`dispatched ${masterSha.slice(0, 7)}`, { sha: masterSha });
  return done('dispatched', `building master ${masterSha.slice(0, 7)}`, { sha: masterSha });
}

module.exports = { runNightly, localClock, STATE_PATH, HOLD_PATH };

if (require.main === module) {
  runNightly({ dryRun: process.argv.includes('--dry-run') })
    .then(() => process.exit(0))
    .catch((err) => { console.error(`[testflight-nightly] error: ${err.message}`); process.exit(1); });
}
