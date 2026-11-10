// Root build script — now drives the Vite-based frontend in vite-app/.
// On Render this runs as part of `npm run build`; locally it's invoked as
// `node build.js`.
//
// It installs vite-app dependencies if missing, runs `npm run build` inside
// vite-app/ to emit ../public-vite/, and puts the solver in place.

const { spawnSync } = require('child_process');

// npm is a .cmd shim on Windows: a bare spawnSync('npm', ...) fails ENOENT there,
// and spawning 'npm.cmd' directly fails EINVAL on current Node (which refuses to
// exec .cmd without a shell). `shell: true` is what actually works on both
// platforms. Every guard below must treat a null status as a FAILURE —
// `(status ?? 0) !== 0` reads null as success, which silently skipped the entire
// vite build on Windows while the command still exited 0.
function runOrDie(args, cwd, what) {
  const r = spawnSync('npm', args, { cwd, stdio: 'inherit', shell: true });
  if (r.error) {
    console.error(`[build] ${what} could not be started: ${r.error.code || r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`[build] ${what} FAILED (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}
const path = require('path');
const fs = require('fs');

const viteAppDir = path.join(__dirname, 'vite-app');

// 1. Ensure vite-app deps are present and current (no-op locally, matters on Render).
// Render keeps vite-app/node_modules in its build cache, so "install only when missing" never
// installed a NEW dependency: leaflet (the venue map, 2026-10-13) failed the build with "Rollup
// failed to resolve import". On Render the lockfile's hash is stamped into node_modules after an
// install, and a different lockfile reinstalls. Locally node_modules is shared with every worktree
// through junctions, so it is never reinstalled behind anyone's back.
const nodeModules = path.join(viteAppDir, 'node_modules');
const lockPath = path.join(viteAppDir, 'package-lock.json');
const stampPath = path.join(nodeModules, '.install-lock-hash');
const lockHash = fs.existsSync(lockPath)
  ? require('crypto').createHash('sha1').update(fs.readFileSync(lockPath)).digest('hex')
  : null;
const stampStale = !!process.env.RENDER && !!lockHash
  && (!fs.existsSync(stampPath) || fs.readFileSync(stampPath, 'utf8').trim() !== lockHash);
if (!fs.existsSync(nodeModules) || stampStale) {
  console.log(`[build] Installing vite-app dependencies${stampStale ? ' (the lockfile changed)' : ''}...`);
  // Prefer `npm ci` when a lockfile is present for reproducibility; otherwise fall back to `npm install`.
  const installCmd = lockHash ? 'ci' : 'install';
  runOrDie([installCmd], viteAppDir, `vite-app npm ${installCmd}`);
  if (process.env.RENDER && lockHash) fs.writeFileSync(stampPath, lockHash);
}

// 2. Run vite build.
console.log('[build] Running vite build...');
runOrDie(['run', 'build'], viteAppDir, 'vite build');

// 3. Solver — now lives in its OWN repo (github.com/ethanibennett/
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

// The WSOP Console/dashboard is not built here: it is a standalone full-stack
// service in the wsop-console repo, live at dashboard.futurega.me (cutover
// 2026-08-09). This build produces only the scheduler.
process.exit(0);
