// Does Study > Pre-draw ranges actually RENDER its data?
//
//   node vite-app/scripts/check-ranges-render.mjs [--shot <file>] [--width 402] [--height 874]
//
// WHY A SEPARATE CHECK. `npm run test:solver-ranges` proves the route serves the
// right figures and asserts that every field the view reads is present on every
// row. Neither of those runs the view. A vite build catches a bad import and
// nothing else, so the branch that renders 250 rows — the only branch a user ever
// sees — had never executed. This project's standing lesson is that a thing you
// have not run is a thing you do not know, and the sibling harnesses
// (check-text-clipping.mjs, check-control-centring.mjs) exist for the same reason.
//
// WHAT IT DOES NOT NEED. No server, no sign-in, no credential: it bundles the
// component with esbuild, stubs `window.fetch` with the REAL JSON from the solver
// clone, and mounts it in WebKit (the engine the app ships in, via WKWebView).
// `utils/api.js` is the real module — only the network is stubbed — so API_URL and
// the Authorization header path are exercised as written.
//
// ASSERTIONS, each about a quantity that could come out wrong rather than about
// the page being well-formed:
//   1. the five positional seats render, in ladder order
//   2. the opening node renders exactly as many rows as the data has
//   3. every threshold the data crosses is drawn, and no others
//   4. switching node changes the row count to that node's own count
//   5. the search box filters to the rows that match, and says so when none do
//   6. no console error, and no React crash (an empty mount is a FAILURE here,
//      not a pass — an empty page satisfies every "does it contain" check)
// Exits 0 when all pass, 1 on a failure, 3 when it cannot run (no data, no
// playwright) — because a check that cannot run must not report a pass.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const ROOT = path.resolve(APP, '..');
const RANGES = path.join(ROOT, 'solver', 'draw-trainer', 'ranges');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const W = Number(flag('--width', 402)), H = Number(flag('--height', 874));
const SHOT = flag('--shot', null);

function refuse(msg, extra) {
  console.error('REFUSING: ' + msg);
  if (extra) console.error('  ' + extra);
  process.exit(3);
}

for (const f of ['td27-predraw-nodes.json', 'td27-predraw-hands.json']) {
  if (!fs.existsSync(path.join(RANGES, f))) {
    refuse(path.join(RANGES, f) + ' is missing',
      'This check renders the REAL payload; with no payload there is nothing to render.');
  }
}
const payload = {
  game: 'td27',
  nodes: JSON.parse(fs.readFileSync(path.join(RANGES, 'td27-predraw-nodes.json'), 'utf8')),
  hands: JSON.parse(fs.readFileSync(path.join(RANGES, 'td27-predraw-hands.json'), 'utf8')),
};

let esbuild, webkit;
try { esbuild = require(path.join(APP, 'node_modules', 'esbuild')); }
catch (e) { refuse('esbuild is not installed in vite-app/node_modules', e.message); }
try { ({ webkit } = require(path.join(APP, 'node_modules', 'playwright'))); }
catch (e) { refuse('playwright is not installed in vite-app/node_modules', e.message); }

// --- what the data says the page should show -------------------------------
// Computed from the payload, never hardcoded: a hardcoded 63 would pass forever
// after the corpus moved, and the point is to compare the render to the data.
const SEATS = ['LJ', 'HJ', 'CO', 'BTN', 'SB'];
const ladderSeats = payload.nodes.rows.filter((r) => r.kind === 'ladder').map((r) => r.label);
const byLine = {};
for (const l of payload.hands.lines) byLine[l.line] = l;
const expectedCuts = (rows) => {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    for (const c of [90, 50, 10]) if (rows[i - 1].play >= c && rows[i].play < c) out.push(c);
  }
  return out;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-ranges-render-'));
let fails = 0;
// ASYNC-AWARE ON PURPOSE. A synchronous wrapper around an async assertion swallows
// the rejection and prints `ok` — a green arm that tested nothing, which is the
// one failure mode this whole check exists to avoid.
const check = async (name, fn) => {
  try { await fn(); console.log('  ok   ' + name); } catch (e) {
    fails++; console.log('  FAIL ' + name + ' — ' + e.message);
  }
};
const eq = (got, want, what) => {
  if (got !== want) throw new Error(`${what}: got ${got}, want ${want}`);
};

try {
  // --- bundle ---------------------------------------------------------------
  const entry = path.join(tmp, 'entry.jsx');
  fs.writeFileSync(entry, [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    `import RangesView from ${JSON.stringify(path.join(APP, 'src', 'components', 'RangesView.jsx'))};`,
    "createRoot(document.getElementById('root')).render(React.createElement(RangesView, { onBack: () => {} }));",
  ].join('\n'));
  const bundle = path.join(tmp, 'bundle.js');
  await esbuild.build({
    entryPoints: [entry], bundle: true, outfile: bundle, format: 'iife',
    jsx: 'automatic', loader: { '.js': 'jsx' }, absWorkingDir: APP,
    // The entry lives in a temp dir, so node's own resolution cannot see
    // vite-app/node_modules from there. nodePaths points at it explicitly rather
    // than writing a scratch file into the repo to borrow its resolution.
    nodePaths: [path.join(APP, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'error',
  });

  // The app's own stylesheets, so the baseline grid, the hs- utilities and the
  // theme tokens are the real ones. A render judged against default browser CSS
  // would be a render of a different page.
  const cssLinks = (fs.readFileSync(path.join(ROOT, 'public-vite', 'index.html'), 'utf8')
    .match(/assets\/[^"]+\.css/g) || [])
    .map((h) => path.join(ROOT, 'public-vite', h));
  if (!cssLinks.length) refuse('no built stylesheet found in public-vite/index.html',
    'Run `npm run build` in vite-app first — this check renders against the real CSS.');
  const css = cssLinks.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  const html = path.join(tmp, 'page.html');
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body><div id="root"></div>
<script>window.__PAYLOAD__ = ${JSON.stringify(payload)};
window.__ERRORS__ = [];
window.addEventListener('error', (e) => window.__ERRORS__.push(String(e.message)));
window.fetch = function (url) {
  // The real fetchApi builds API_URL + path and sets Authorization; only the
  // network is stubbed, so a wrong path here fails loudly instead of silently.
  if (!String(url).endsWith('/api/solver/ranges/td27')) {
    window.__ERRORS__.push('unexpected fetch: ' + url);
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'stub: wrong path' }) });
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(window.__PAYLOAD__) });
};
</script>
<script src="bundle.js"></script></body></html>`);

  // --- render ---------------------------------------------------------------
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
  await page.goto(pathToFileURL(html).href);
  await page.waitForFunction(() => {
    const r = document.getElementById('root');
    return r && /How wide, by seat/.test(r.textContent || '');
  }, { timeout: 15000 }).catch(() => {});

  // COUNTING THIS WRONG IS THE EASY MISTAKE, and the first version made it.
  // Each hand row is TWO .hs-meter rows -- the holding, then its description --
  // and the description row's right-hand cell is the out count, "12/47", which
  // has the SAME SHAPE as the play/raise cell "100/84". Matching on shape alone
  // counted 81 where the data has 63. The discriminator is the BAR: only the
  // holding row has a .hs-meter-track, because the description row renders an
  // empty middle cell.
  const rowCount = () => page.$$eval('.hs-meter', (els) => els.filter((e) =>
    e.querySelector('.hs-meter-track')
    && /^\d+\/\d+$/.test((e.lastElementChild?.textContent || '').trim())).length);

  console.log('--- render ---');
  const text = await page.$eval('#root', (e) => e.textContent || '');
  await check('the view mounted and is not empty', () => {
    if (text.trim().length < 200) throw new Error('root text is ' + text.trim().length + ' chars');
  });
  await check('no page or console error', async () => {
    const inPage = await page.evaluate(() => window.__ERRORS__ || []);
    // A file:// page cannot load the app's absolute /fonts/*.woff2, so WebKit
    // logs one refusal per face. That is this harness's origin, not the view's
    // behaviour, and it is filtered by its exact message rather than by dropping
    // the whole arm -- a console check that ignores everything is not a check.
    const errs = consoleErrors.concat(inPage)
      .filter((t) => !/Not allowed to load local resource/.test(t));
    if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  });
  await check('the five positional seats render in ladder order', async () => {
    // From the ELEMENTS, not from textContent: concatenated text reads
    // "...LJ32.1% +/-0.55HJ33.4%...", so a word boundary matches only the first
    // seat and a text scan silently reports one seat where five rendered.
    const got = await page.$$eval('.hs-meter > .hs-t:first-child',
      (els) => els.map((e) => (e.textContent || '').trim())
        .filter((t) => ['LJ', 'HJ', 'CO', 'BTN', 'SB'].includes(t)));
    eq(got.join(','), SEATS.filter((x) => ladderSeats.includes(x)).join(','), 'seats');
  });

  console.log('--- the opening node ---');
  let n = await rowCount();
  await check('row count matches the data', () => eq(n, byLine[''].rows.length, 'rows at the opening node'));
  await check('the thresholds the data crosses are drawn, and no others', async () => {
    const drawn = await page.$$eval('.hs-rule', (els) =>
      els.map((e) => (e.textContent || '').match(/below (\d+)%/)?.[1]).filter(Boolean).map(Number));
    eq(drawn.join(','), expectedCuts(byLine[''].rows).join(','), 'threshold dividers');
  });
  await check('the gated opening figure is on the page', () => {
    const want = byLine[''].playPct.toFixed(1) + '%';
    if (!text.includes(want)) throw new Error('no "' + want + '" in the page');
  });

  console.log('--- switching node ---');
  await page.click('button[aria-pressed="false"] >> text=Facing a 3-bet');
  await page.waitForTimeout(150);
  n = await rowCount();
  await check('row count follows the selected node', () => eq(n, byLine.rr.rows.length, 'rows at the 4-bet node'));

  console.log('--- the search box ---');
  await page.click('button >> text=Opening');
  await page.waitForTimeout(150);
  await page.fill('input[type="search"]', 'pat');
  await page.waitForTimeout(150);
  n = await rowCount();
  const wantPat = byLine[''].rows.filter((r) =>
    (r.hold + ' ' + r.what + ' ' + r.holds.join(' ')).toLowerCase().includes('pat')).length;
  await check('filtering to "pat" shows the rows that match', () => eq(n, wantPat, 'filtered rows'));
  await check('a filter that matches nothing says so', async () => {
    await page.fill('input[type="search"]', 'zzzzz');
    await page.waitForTimeout(150);
    const t = await page.$eval('#root', (e) => e.textContent || '');
    if (!/No row matches that/.test(t)) throw new Error('no empty-state message');
    eq(await rowCount(), 0, 'rows after a non-matching filter');
  });

  if (SHOT) {
    await page.fill('input[type="search"]', '');
    await page.waitForTimeout(150);
    await page.screenshot({ path: SHOT, fullPage: true });
    console.log('wrote ' + SHOT);
  }
  await browser.close();
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}


console.log('');
if (fails) {
  console.error(fails + ' assertion(s) FAILED');
  process.exit(1);
}
console.log('ranges render: all arms passed — the data branch renders, its row counts');
console.log('  match the payload, and the thresholds drawn are the ones the data crosses.');
