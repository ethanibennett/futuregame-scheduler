// play.futurega.me, the play-money tables' own site (owner, 2026-11-22: "deploy to play.futurega.me, no effect on
// the mobile app"), gets its own entry (src/play-main.jsx): the sign-in and the tables, without the app around them.
// Its HTML is index.html with the entry script swapped, the title its own and the manifest link dropped (it is not
// the installable app), generated whenever Vite starts so the heads can never drift. vite.config.js calls
// writePlayHtml() itself; the prebuild script runs it too. Output: vite-app/play.html (gitignored), built to
// public-vite/play.html, which the server sends for play.futurega.me's pages (server.js servePlay).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function writePlayHtml() {
  const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  if (!src.includes('src="/src/main.jsx"')) throw new Error('index.html no longer loads /src/main.jsx; update scripts/make-play-html.mjs');
  const out = src
    .replace('src="/src/main.jsx"', 'src="/src/play-main.jsx"')
    .replace(/<title>[^<]*<\/title>/, '<title>futurega.me | play</title>')
    .replace(/\s*<link rel="manifest"[^>]*>/, '');
  fs.writeFileSync(path.join(dir, 'play.html'), out);
  return out.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writePlayHtml();
  console.log('play.html written');
}
