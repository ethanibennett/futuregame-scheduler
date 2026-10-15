// futurega.me/live gets its own small entry (src/live-main.jsx) so an ad click does not download the
// whole app. Its HTML is index.html with only the entry script swapped and the manifest link dropped
// (a landing page is not the installable app), generated before every build so the two heads can
// never drift. vite.config.js calls writeLiveHtml() itself, so it runs however Vite is started; the
// prebuild script runs it too. Output: vite-app/live.html (gitignored), built to public-vite/live.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function writeLiveHtml() {
  const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  if (!src.includes('src="/src/main.jsx"')) throw new Error('index.html no longer loads /src/main.jsx; update scripts/make-live-html.mjs');
  const out = src
    .replace('src="/src/main.jsx"', 'src="/src/live-main.jsx"')
    .replace(/\s*<link rel="manifest"[^>]*>/, '');
  fs.writeFileSync(path.join(dir, 'live.html'), out);
  return out.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeLiveHtml();
  console.log('live.html written');
}
