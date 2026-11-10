// Serve the app from another build folder: `node -r this server.js` with PUBLIC_VITE_DIR set makes every
// path.join(..., 'public-vite', ...) in server.js resolve into that folder instead (an absolute path, or a
// folder name at the repo root). For a check that needs a fresh build while other runs are still reading the
// one in public-vite (a vite build empties its folder first):
//
//   cd vite-app && npx vite build --outDir <folder> --emptyOutDir
//   node scripts/check-replayer-oracle.mjs --build <folder>
//
// Test servers only. Unset, it changes nothing.
const path = require('path');

const dir = process.env.PUBLIC_VITE_DIR;
if (dir) {
  const join = path.join;
  path.join = function (...parts) {
    const at = parts.indexOf('public-vite');
    if (at < 0) return join.apply(path, parts);
    if (path.isAbsolute(dir)) return join.apply(path, [dir, ...parts.slice(at + 1)]);
    return join.apply(path, [...parts.slice(0, at), dir, ...parts.slice(at + 1)]);
  };
}
