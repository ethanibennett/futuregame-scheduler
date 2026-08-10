// Root build script — now drives the Vite-based frontend in vite-app/.
// On Render this runs as part of `npm run build`; locally it's invoked by
// `node build.js` (directly or through deploy.sh).
//
// It installs vite-app dependencies if missing, writes a fresh version.txt
// into vite-app/public/ (copied verbatim into the build output by Vite), and
// then runs `npm run build` inside vite-app/ to emit ../public-vite/.

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const viteAppDir = path.join(__dirname, 'vite-app');

// 1. Ensure vite-app deps are present (no-op locally, matters on Render).
if (!fs.existsSync(path.join(viteAppDir, 'node_modules'))) {
  console.log('[build] Installing vite-app dependencies...');
  // Prefer `npm ci` when a lockfile is present for reproducibility; otherwise fall back to `npm install`.
  const hasLock = fs.existsSync(path.join(viteAppDir, 'package-lock.json'));
  const installCmd = hasLock ? 'ci' : 'install';
  const install = spawnSync('npm', [installCmd], { cwd: viteAppDir, stdio: 'inherit' });
  if (install.status !== 0) process.exit(install.status);
}

// 2. Stamp a version.txt so the legacy auto-reload shim (if any lingers) keeps working.
const buildVersion = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const vitePublicDir = path.join(viteAppDir, 'public');
if (!fs.existsSync(vitePublicDir)) fs.mkdirSync(vitePublicDir, { recursive: true });
fs.writeFileSync(path.join(vitePublicDir, 'version.txt'), buildVersion);
console.log(`[build] Wrote version.txt = ${buildVersion}`);

// 3. Run vite build.
console.log('[build] Running vite build...');
const build = spawnSync('npm', ['run', 'build'], { cwd: viteAppDir, stdio: 'inherit' });
if ((build.status ?? 0) !== 0) process.exit(build.status);

// 3b. Solver — now lives in its OWN repo (github.com/ethanibennett/
// futuregame-solver, private; carved out 2026-08-09 with history). server.js
// hard-requires ./solver/* at boot (trainer features), so a deploy without it
// crashes. Fetch order:
//   - SOLVER_REPO_TOKEN set (Render): fresh shallow clone, move its solver/
//     into place. Fail-loud so Render keeps the last-good deploy.
//   - No token but ./solver exists (in-tree vendored copy, or a local clone):
//     use it as-is.
//   - Neither (e.g. Mac iOS builds that never boot server.js): warn and skip.
const solverDir = path.join(__dirname, 'solver');
const SOLVER_TOKEN = process.env.SOLVER_REPO_TOKEN;
const SOLVER_BRANCH = process.env.SOLVER_REPO_BRANCH || 'master';

function dieSolver(msg, code) {
  console.error(`[build] ${msg}`);
  process.exit(code || 1);
}

if (SOLVER_TOKEN) {
  console.log('[build] Fetching solver from its repo...');
  const solverCloneDir = path.join(__dirname, 'futuregame-solver-tmp');
  fs.rmSync(solverCloneDir, { recursive: true, force: true });
  fs.rmSync(solverDir, { recursive: true, force: true });
  const sUrl = `https://x-access-token:${SOLVER_TOKEN}@github.com/ethanibennett/futuregame-solver.git`;
  const sClone = spawnSync('git', ['clone', '--depth', '1', '--branch', SOLVER_BRANCH, sUrl, solverCloneDir], { stdio: 'inherit' });
  if (sClone.status !== 0) dieSolver('Solver clone FAILED — check SOLVER_REPO_TOKEN.', sClone.status);
  // The solver repo keeps its content under a solver/ prefix — move that dir into place.
  fs.renameSync(path.join(solverCloneDir, 'solver'), solverDir);
  fs.rmSync(solverCloneDir, { recursive: true, force: true });
  if (!fs.existsSync(path.join(solverDir, 'games', 'index.js'))) {
    dieSolver('solver/games/index.js missing after fetch — refusing to ship a deploy that crashes at boot.');
  }
  console.log('[build] Solver fetched ✓');
} else if (fs.existsSync(path.join(solverDir, 'games', 'index.js'))) {
  console.log('[build] SOLVER_REPO_TOKEN unset — using existing ./solver.');
} else if (process.env.RENDER) {
  dieSolver('No SOLVER_REPO_TOKEN and no ./solver on Render — server.js would crash at boot. Set the token in the service env.');
} else {
  console.warn('[build] No solver token and no ./solver — skipping (fine for frontend-only builds; server.js will not boot).');
}

// 4. WSOP 2027 Console — now lives in its OWN repo (github.com/ethanibennett/
// wsop-console). Clone it fresh each build into ./wsop-console (where server.js
// still expects app/dist and push-service/schedule.js), then build the PWA.
// Fail-loud: any failure exits non-zero so Render marks the deploy failed and
// keeps the last-good deploy live — never a silent console-less deploy.
const consoleDir = path.join(__dirname, 'wsop-console');
const CONSOLE_TOKEN = process.env.CONSOLE_REPO_TOKEN;
const CONSOLE_BRANCH = process.env.CONSOLE_REPO_BRANCH || 'main';

function die(msg, code) {
  console.error(`[build] ${msg}`);
  process.exit(code || 1);
}

if (CONSOLE_TOKEN) {
  console.log('[build] Fetching WSOP Console from its repo...');
  // Fresh clone (clear any cached copy so we never build stale console code).
  fs.rmSync(consoleDir, { recursive: true, force: true });
  const url = `https://x-access-token:${CONSOLE_TOKEN}@github.com/ethanibennett/wsop-console.git`;
  const clone = spawnSync('git', ['clone', '--depth', '1', '--branch', CONSOLE_BRANCH, url, consoleDir], { stdio: 'inherit' });
  if (clone.status !== 0) die('Console clone FAILED — check CONSOLE_REPO_TOKEN.', clone.status);

  const consoleAppDir = path.join(consoleDir, 'app');
  // `npm install` (NOT `npm ci`): dual-esbuild tree (vite 5→0.21, vitest 4→0.27/0.28)
  // that strict ci rejects on Render even when the lockfile validates locally.
  const cInstall = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: consoleAppDir, stdio: 'inherit' });
  if (cInstall.status !== 0) die('Console npm install failed.', cInstall.status);
  const cBuild = spawnSync('npm', ['run', 'build'], { cwd: consoleAppDir, stdio: 'inherit' });
  if (cBuild.status !== 0) die('Console build failed.', cBuild.status);
  if (!fs.existsSync(path.join(consoleAppDir, 'dist', 'index.html'))) {
    die('Console dist/index.html missing after build — refusing to ship a console-less deploy.');
  }
  console.log('[build] Console built ✓');
} else if (process.env.RENDER) {
  // On Render the token MUST be set — fail rather than deploy without the console.
  die('CONSOLE_REPO_TOKEN not set on Render — cannot fetch the console. Set it in the service env.');
} else if (fs.existsSync(path.join(consoleDir, 'app'))) {
  // Local dev fallback: if an in-tree copy still exists, build it (no token needed).
  console.log('[build] CONSOLE_REPO_TOKEN unset — building in-tree wsop-console/app (local).');
  const consoleAppDir = path.join(consoleDir, 'app');
  spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: consoleAppDir, stdio: 'inherit' });
  const cBuild = spawnSync('npm', ['run', 'build'], { cwd: consoleAppDir, stdio: 'inherit' });
  if (cBuild.status !== 0) process.exit(cBuild.status);
} else {
  console.warn('[build] No console token and no in-tree console — skipping console build.');
}
process.exit(0);
