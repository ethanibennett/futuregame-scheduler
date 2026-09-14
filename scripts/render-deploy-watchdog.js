'use strict';

/**
 * Render deploy-failure watchdog.
 *
 * The problem it exists for: on 2026-09-14 every deploy of futurega.me failed for
 * roughly sixteen hours — twelve consecutive builds, 01:19 through 17:13 — and
 * nothing said so. `SOLVER_REPO_TOKEN` had expired, so `build.js` could no longer
 * clone the solver and died. Render keeps serving the last good deploy when a build
 * fails, so the site stayed up and healthy the whole time; commits kept landing on
 * master; and none of them reached production. It surfaced only because someone
 * happened to be watching a deploy for an unrelated reason.
 *
 * That is the same failure shape as the ntfy incident this suite already hit: a
 * broken system and a working one look identical from where you are standing. The
 * fix in both cases is the same — make the silence say something.
 *
 * Runs on the BOX, not on Render, and deliberately. A watchdog shipped inside the
 * deploy it is meant to report on cannot report on its own failure to deploy: the
 * new code never runs. The box's pm2 checkout is unaffected by a failed Render
 * build, so it is the only place this observation is worth anything. Opt in with
 * RENDER_DEPLOY_WATCHDOG=1 in the gitignored ecosystem.config.cjs, exactly like
 * TESTFLIGHT_WATCHDOG.
 *
 * Alerts go through the dashboard's APNs seam rather than a new transport, for the
 * reason recorded in cash-game-watcher's notify.ts: the seam answers with the count
 * of devices APNs actually accepted the push for, so "delivered to nobody" is
 * visible instead of looking like success.
 */

const fs = require('fs');
const path = require('path');

const RENDER_API = 'https://api.render.com/v1';

// Which services to watch. Defaults to this repo's own Render service; the suite's
// other services can be added without a code change:
//   RENDER_WATCH_SERVICES="srv-xxxx=futurega.me,srv-yyyy=cashwatcher"
const DEFAULT_SERVICES = [{ id: 'srv-d6b8ujfgi27c73d5v3p0', label: 'futurega.me' }];

// Render marks older queued deploys `canceled` whenever a newer push supersedes
// them — routine, and alerting on it would make every rapid double-push a false
// alarm. `deactivated` is likewise not an outcome anyone needs woken for. So the
// watchdog looks past both for the newest deploy that actually resolved.
const MEANINGFUL = new Set(['live', 'build_failed', 'update_failed', 'pre_deploy_failed']);
const FAILED = new Set(['build_failed', 'update_failed', 'pre_deploy_failed']);

const STATE_PATH = process.env.RENDER_WATCHDOG_STATE
  || path.join(__dirname, '..', '.render-deploy-watchdog.json');

function parseServices() {
  const raw = process.env.RENDER_WATCH_SERVICES;
  if (!raw) return DEFAULT_SERVICES;
  return raw.split(',').map((pair) => {
    const [id, label] = pair.split('=');
    return { id: (id || '').trim(), label: (label || id || '').trim() };
  }).filter((s) => s.id.startsWith('srv-'));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {}; // absent or corrupt -> start clean; worst case is one duplicate alert
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));
  } catch (err) {
    console.error('[render] could not persist watchdog state:', err && err.message);
  }
}

async function renderJson(pathname, key) {
  const res = await fetch(`${RENDER_API}${pathname}`, {
    headers: { Authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`render ${pathname} -> ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

/**
 * Push via the dashboard's APNs seam. Throws on anything short of a real delivery,
 * INCLUDING a 200 that reached zero devices — the caller relies on that to avoid
 * recording the alert as sent.
 */
async function notify(title, body) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) throw new Error('DASHBOARD_TOKEN unset — cannot reach the APNs seam');
  const base = (process.env.DASHBOARD_URL || 'https://dashboard.futurega.me').replace(/\/$/, '');
  const res = await fetch(`${base}/api/notify/new-series`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dashboard-token': token },
    body: JSON.stringify({ title: title.slice(0, 200), body: body.slice(0, 1500), tag: 'deploy' }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`apns -> ${res.status} ${text.slice(0, 200)}`);
  try {
    const out = JSON.parse(text);
    if (out && out.delivered === 0) {
      throw new Error(`apns accepted but delivered to 0 of ${out.deviceTokens ?? 0} device(s)`);
    }
  } catch (err) {
    if (err && String(err.message).startsWith('apns accepted')) throw err;
    // Unparseable 2xx body: let it pass rather than lose a real alert.
  }
}

const firstLine = (s) => String(s || '').split('\n')[0].slice(0, 90);

async function runWatchdog() {
  const key = process.env.RENDER_API_KEY;
  if (!key) {
    console.error('[render] watchdog: RENDER_API_KEY unset — nothing to poll');
    return;
  }
  const state = loadState();

  for (const svc of parseServices()) {
    let deploys;
    try {
      deploys = await renderJson(`/services/${svc.id}/deploys?limit=8`, key);
    } catch (err) {
      console.error(`[render] ${svc.label}: ${err.message}`);
      continue; // a polling blip must not look like a deploy outcome
    }

    const latest = (deploys || [])
      .map((d) => d.deploy)
      .filter((d) => d && MEANINGFUL.has(d.status))[0];
    if (!latest) continue;

    const prev = state[svc.id] || {};
    if (prev.deployId === latest.id) continue; // already reported this outcome

    const failed = FAILED.has(latest.status);
    // Only report a recovery if we actually told them about the breakage — a first
    // run against a healthy service should be silent, not congratulatory.
    if (!failed && !prev.failed) {
      state[svc.id] = { deployId: latest.id, failed: false };
      saveState(state);
      continue;
    }

    const commit = firstLine(latest.commit && latest.commit.message);
    const when = String(latest.finishedAt || latest.createdAt || '').slice(0, 16).replace('T', ' ');
    const title = failed ? `Deploy FAILED: ${svc.label}` : `Deploy recovered: ${svc.label}`;
    const body = [
      `${latest.status} at ${when} UTC`,
      commit ? `commit: ${commit}` : null,
      failed ? 'The previous deploy is still serving — the site is up, but nothing new has shipped.' : 'Back to shipping.',
      `https://dashboard.render.com/web/${svc.id}`,
    ].filter(Boolean).join('\n');

    try {
      await notify(title, body);
      console.log(`[render] ${svc.label}: alerted (${latest.status})`);
    } catch (err) {
      // Do NOT record it: an undelivered alert must be retried on the next tick,
      // not silently marked as handled. This is the ntfy lesson, applied here.
      console.error(`[render] ${svc.label}: alert FAILED, will retry — ${err.message}`);
      continue;
    }
    state[svc.id] = { deployId: latest.id, failed };
    saveState(state);
  }
}

module.exports = { runWatchdog, parseServices, MEANINGFUL, FAILED };

// Manual run: node scripts/render-deploy-watchdog.js
if (require.main === module) {
  runWatchdog().catch((err) => {
    console.error('[render] watchdog error:', err && err.message);
    process.exit(1);
  });
}
