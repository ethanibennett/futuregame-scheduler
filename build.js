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

// 4. WSOP Console/dashboard: no longer built here. The dashboard is a standalone
// full-stack service in the wsop-console repo (deployed separately; see its
// render.yaml). This build produces only the scheduler. Console routes in
// server.js degrade gracefully when ./wsop-console is absent ("/console will
// 404 until built") until they're removed in the follow-up cleanup.
process.exit(0);
