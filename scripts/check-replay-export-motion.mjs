// Do the replay exports carry the spring moments exactly as the live replayer plays them?
// Playwright WebKit, the 8-max hand at 402x874 (dpr 2), localStorage.replayerSprings = '1':
//   1. The real GIF export and the real video export (Greenscreen). WebKit on Windows has no
//      MediaRecorder, so a stand-in recorder keeps every frame the exporter paints and how long it is
//      held. During each export, every motion.seek() the exporter makes (captureStepFrames in
//      utils/replay-capture.js) is hooked to record the board cards, the swept wagers' ghosts, the
//      shipped chips and the pot figure at that instant.
//   2. The LIVE replayer, independently: Playwright's clock installed and paused, the turn pressed,
//      every animation on the page paused at t through document.getAnimations() (not the registry),
//      the clock run to t so the arrival timers fire; then the same measurement and a screenshot.
// Every seeked instant of the turn is compared by number (px against the board area, opacity x100)
// and side by side as images (turn-gif-vs-live.png, turn-video-vs-live.png in the out dir).
//
//   node scripts/check-replay-export-motion.mjs [baseUrl] [--out dir] [--only gif,video|none]
//
// baseUrl is a SCRATCH server running this checkout (never the pm2 app on :3001 for an unmerged
// build). --only none reuses the exports cached in --out and redoes the live side only.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
const args = process.argv.slice(2);
const opt = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : d; };
const BASE = (args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:3241').replace(/\/$/, '');
const OUT = path.resolve(opt('--out', 'replay-export-check'));
const FF = fs.existsSync('C:/ffmpeg/bin/ffmpeg.exe') ? 'C:/ffmpeg/bin/ffmpeg.exe' : 'ffmpeg';
const FP = FF.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const SANS = ['C:/Windows/Fonts/arial.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf'].find(f => fs.existsSync(f)) || '';
fs.mkdirSync(OUT, { recursive: true });
const H8 = 'N85.1000-2000~120000,95000,150000,80000,70000,210000,64000,110000.AsKc,-,-,QhQd,-,-,-,-/bKh7d2c/b9s/bAh.'
  + '0f,1f,2r5000,3f,4f,5r15000,6f,7f,2c15000/2x,5b12000,2c12000/2x,5b30000,2c30000/2b40000,5c40000.w5';
const PRESSES_BEFORE_TURN = 13;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const guest = await (await fetch(BASE + '/api/guest-login', { method: 'POST' })).json();
const browser = await webkit.launch();
const errors = [];

const MEASURE = () => {
  window.__meas = () => {
    const t = document.querySelector('.replayer-table');
    // Before the flop there is no board: measure from the pot then (neither moves).
    const area = t.querySelector('.replayer-board-area:not(.replayer-dead-area)');
    const A = (area || t.querySelector('.replayer-pot-display') || t).getBoundingClientRect();
    const rel = (el) => {
      const r = el.getBoundingClientRect();
      return { x: +(r.left + r.width / 2 - A.left).toFixed(2), y: +(r.top + r.height / 2 - A.top).toFixed(2), w: +r.width.toFixed(2), op: +(+getComputedStyle(el).opacity).toFixed(3) };
    };
    const pot = t.querySelector('.replayer-pot-total');
    return {
      cards: area ? [...area.querySelectorAll('.card-row > [data-slot]')].map(rel) : [],
      ghosts: [...t.querySelectorAll('.replayer-chip-ghost')].map(rel),
      ship: [...t.querySelectorAll('.replayer-flying-chip')].map(rel),
      pot: pot ? pot.lastChild.textContent : null,
    };
  };
};

async function open({ clock = false, recorder = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, acceptDownloads: true });
  await ctx.addInitScript(({ tok, recorder }) => {
    localStorage.setItem('token', tok); localStorage.setItem('onboardComplete', '1');
    localStorage.setItem('hasOnboarded', 'true'); localStorage.setItem('onboarded', '1');
    localStorage.setItem('replayerSprings', '1');
    try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch (e) {}
    if (!recorder) return;
    window.__vf = { frames: [], dirty: false };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...a) { if (this.canvas.__rec) window.__vf.dirty = true; return draw.apply(this, a); };
    HTMLCanvasElement.prototype.captureStream = function () {
      const canvas = this; canvas.__rec = true;
      const track = {
        requestFrame() {
          const f = window.__vf;
          if (f.dirty || !f.frames.length) { f.frames.push({ url: canvas.toDataURL('image/png'), n: 0 }); f.dirty = false; }
          f.frames[f.frames.length - 1].n++;
        },
        stop() {},
      };
      return { getVideoTracks: () => [track], getTracks: () => [track] };
    };
    window.MediaRecorder = class {
      static isTypeSupported(t) { return /mp4/.test(t); }
      constructor() { this.state = 'inactive'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable && this.ondataavailable({ data: new Blob(['stand-in'], { type: 'video/mp4' }) }); this.onstop && this.onstop(); }, 0); }
    };
  }, { tok: guest.token, recorder });
  const page = await ctx.newPage();
  if (clock) await page.clock.install();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('  console', m.type(), m.text().slice(0, 240)); });
  await page.goto(BASE + '/#h/' + encodeURIComponent(H8));
  if (clock) { for (let i = 0; i < 60; i++) { await page.clock.runFor(100); if (await page.$('button[title="Forward"]')) break; await sleep(100); } }
  await page.waitForSelector('button[title="Forward"]', { timeout: 30000 });
  if (clock) await page.clock.runFor(2500); else await sleep(2500);
  await page.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 800 }).catch(() => {});
  await page.evaluate(MEASURE);
  return { ctx, page };
}

const hookSeeks = (page) => page.evaluate(() => {
  window.__seeks = [];
  const m = document.querySelector('.replayer-table').__replayerMotion;
  const orig = m.seek.bind(m);
  m.seek = (ms) => { orig(ms); window.__seeks.push({ ms: +ms.toFixed(2), rate: m.captureRate, ...window.__meas() }); };
});
// Seeks come in runs, one per moment (each starts at 0).
const runsOf = (seeks) => { const runs = []; for (const s of seeks) { if (s.ms === 0 || !runs.length) runs.push([]); runs[runs.length - 1].push(s); } return runs; };
const isTurn = (run) => run[0].cards.length === 4;

async function exportVia(label, menuText, recorder) {
  const { ctx, page } = await open({ recorder });
  await hookSeeks(page);
  const t0 = Date.now();
  await page.click('button.rab-share');
  await page.waitForSelector('.replayer-share-sheet');
  const dl = page.waitForEvent('download', { timeout: 2400000 });
  await page.click(`.replayer-share-sheet .share-menu-item:has(.share-label:text-is("${menuText}"))`);
  const tick = setInterval(async () => {
    try {
      const st = await page.evaluate(() => ({ seeks: (window.__seeks || []).length, vf: window.__vf ? window.__vf.frames.length : null,
        overlay: (document.querySelector('[class*="export-progress"], [class*="exporting"], .replayer-export-overlay') || {}).textContent?.slice(0, 80) }));
      console.log(`  ${label} +${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(st));
    } catch (e) { /* busy */ }
  }, 60000);
  const d = await dl.finally(() => clearInterval(tick));
  const file = path.join(OUT, label + path.extname(d.suggestedFilename()));
  await d.saveAs(file);
  const seeks = await page.evaluate(() => window.__seeks);
  const vf = recorder ? await page.evaluate(() => window.__vf.frames) : null;
  console.log(`${label}: ${fs.statSync(file).size} bytes in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${seeks.length} seeked frames in ${runsOf(seeks).length} moments`);
  await ctx.close();
  return { file, seeks, vf };
}

// ── 1. The exports ──
const ONLY = String(opt('--only', 'gif,video')).split(',');
const cached = (label, menu, rec) => {
  const f = path.join(OUT, label + '.cache.json');
  if (!ONLY.includes(label.replace('export-', '').replace('greenscreen', 'video')) && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  return exportVia(label, menu, rec).then(r => { fs.writeFileSync(f, JSON.stringify(r)); return r; });
};
const vid = await cached('export-greenscreen', 'Greenscreen', true);
const gif = await cached('export-gif', 'GIF', false);

// GIF frames and their delays; motion frames are the 80ms ones, in runs, one run per moment.
const gdir = path.join(OUT, 'gif-frames'); fs.rmSync(gdir, { recursive: true, force: true }); fs.mkdirSync(gdir);
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', gif.file, '-vsync', '0', path.join(gdir, 'g%03d.png')]);
const gdur = String(execFileSync(FP, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=duration_time', '-of', 'csv=p=0', gif.file]))
  .trim().split(/\r?\n/).map(s => Math.round(parseFloat(s) * 1000));
const gifRuns = []; gdur.forEach((d, i) => { if (d === 80) { if (!gifRuns.length || gifRuns[gifRuns.length - 1].end !== i - 1) gifRuns.push({ start: i, end: i }); else gifRuns[gifRuns.length - 1].end = i; } });
const gSeekRuns = runsOf(gif.seeks);
console.log('GIF:', gdur.length, 'frames; motion runs', gifRuns.map(r => `${r.start}-${r.end}`).join(' '), '| seek runs', gSeekRuns.map(r => r.length + (isTurn(r) ? '(turn)' : '')).join(' '));

// Video frames (the stand-in kept each painted canvas once, with its hold); motion frames hold 1.
const vdir = path.join(OUT, 'video-frames'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir);
vid.vf.forEach((f, i) => fs.writeFileSync(path.join(vdir, `v${String(i).padStart(3, '0')}.png`), Buffer.from(f.url.split(',')[1], 'base64')));
const vRuns = []; vid.vf.forEach((f, i) => { if (f.n === 1) { if (!vRuns.length || vRuns[vRuns.length - 1].end !== i - 1) vRuns.push({ start: i, end: i }); else vRuns[vRuns.length - 1].end = i; } });
const vSeekRuns = runsOf(vid.seeks);
console.log('Video:', vid.vf.length, 'painted frames, holds', JSON.stringify(vid.vf.map(f => f.n)));
console.log('       motion runs', vRuns.map(r => `${r.start}-${r.end}`).join(' '), '| seek runs', vSeekRuns.map(r => r.length + (isTurn(r) ? '(turn)' : '')).join(' '));
// A video motion run can end with frames that equal the settled still (a hold of 1 that merges);
// match runs by length where they agree.

// ── 2. The live replayer at the same instants ──
const { ctx: lctx, page } = await open({ clock: true });
const hops = () => page.evaluate(() => new Promise(r => { let n = 0; const ch = new MessageChannel(); ch.port1.onmessage = () => (++n < 6 ? ch.port2.postMessage(0) : r()); ch.port2.postMessage(0); }));
for (let i = 0; i < PRESSES_BEFORE_TURN; i++) { await page.click('button[title="Forward"]'); await hops(); await page.clock.runFor(1500); await hops(); }
// Time stops here: from now on timers fire only when the clock is run (as the motion harness does).
await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 50);
await hops();
async function liveAt(t, shot) {
  // Press and pin in one task, as the motion harness does: the document timeline is not Playwright's
  // clock, so any real time between the commit and the pin would run the springs (a 90ms label
  // fade can be over before a second round trip lands).
  await page.evaluate(async (t) => {
    document.querySelector('button[title="Forward"]').click();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = t; } catch (e) {} }
  }, t);
  await page.clock.runFor(t); await hops();
  // the clock run can start nothing new, but re-pin in case a commit made one
  await page.evaluate((t) => { for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = t; } catch (e) {} } }, t);
  const m = await page.evaluate(() => window.__meas());
  if (shot) await page.locator('.replayer-table').screenshot({ path: shot });
  // back to the step before the turn: Back finishes everything
  await page.evaluate(() => document.querySelector('button[title="Back"]').click());
  await hops(); await page.clock.runFor(600); await hops();
  return m;
}

const gTurn = gSeekRuns.findIndex(isTurn), vTurn = vSeekRuns.findIndex(isTurn);
const report = { gif: [], video: [] };
const cmp = (a, b) => {
  let d = 0;
  for (const k of ['cards', 'ghosts', 'ship']) {
    if (a[k].length !== b[k].length) return { maxPx: Infinity, note: `${k}: ${a[k].length} vs ${b[k].length}` };
    a[k].forEach((e, i) => { d = Math.max(d, Math.abs(e.x - b[k][i].x), Math.abs(e.y - b[k][i].y), Math.abs(e.w - b[k][i].w), Math.abs(e.op - b[k][i].op) * 100); });
  }
  return { maxPx: +d.toFixed(2), pot: a.pot + ' / ' + b.pot };
};
for (const [kind, seekRuns, ti, frameFile] of [
  ['gif', gSeekRuns, gTurn, (k) => path.join(gdir, `g${String(gifRuns[gTurn].start + k + 1).padStart(3, '0')}.png`)],
  ['video', vSeekRuns, vTurn, (k) => path.join(vdir, `v${String(vRuns[vTurn].start + k).padStart(3, '0')}.png`)],
]) {
  if (ti < 0) { console.log(kind, ': no turn moment was seeked'); continue; }
  for (let k = 0; k < seekRuns[ti].length; k++) {
    const ex = seekRuns[ti][k];
    const shot = path.join(OUT, `live-${kind}-t${Math.round(ex.ms)}.png`);
    const live = await liveAt(ex.ms, shot);
    const c = cmp(ex, live);
    report[kind].push({ t: ex.ms, ...c, export: ex, live, exportFrame: frameFile(k), liveShot: shot });
    console.log(`${kind} turn t=${ex.ms}ms: max diff ${c.maxPx}px (opacity x100) | pot ${c.pot}${c.note ? ' | ' + c.note : ''}`);
  }
}
await lctx.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));

// ── 3. Side by side: export frames on top, the live replayer at the same instants below ──
const fontArg = SANS ? `fontfile='${SANS.replace(/^([A-Za-z]):/, '$1\\:')}':` : '';
for (const kind of ['gif', 'video']) {
  const rows = report[kind].filter(r => fs.existsSync(r.exportFrame) && fs.existsSync(r.liveShot));
  if (!rows.length) continue;
  const TW = 360;   // one tile's width; the export frame carries the capture padding, the live shot not
  const label = (t) => `drawtext=${fontArg}text='${t}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.65`;
  const inputs = rows.flatMap(r => ['-i', r.exportFrame, '-i', r.liveShot]);
  const tiles = rows.map((r, i) => `[${2 * i}:v]scale=${TW}:-2,${label(`${kind} export ${Math.round(r.t)}ms`)}[e${i}];`
    + `[${2 * i + 1}:v]scale=${TW}:-2,${label(`live ${Math.round(r.t)}ms`)}[l${i}]`).join(';');
  const n = rows.length;
  const graph = tiles + ';' + rows.map((_, i) => `[e${i}]`).join('') + (n > 1 ? `hstack=inputs=${n}` : 'null') + '[top];'
    + rows.map((_, i) => `[l${i}]`).join('') + (n > 1 ? `hstack=inputs=${n}` : 'null') + '[bot];'
    + '[top][bot]vstack=inputs=2:shortest=0[v]';
  const out = path.join(OUT, `turn-${kind}-vs-live.png`);
  try {
    execFileSync(FF, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[v]', '-frames:v', '1', out]);
    console.log('wrote', out);
  } catch (e) { console.log('side-by-side failed:', String(e.stderr || e.message).trim().split(/\r?\n/)[0]); }
}
console.log('errors:', errors.length ? errors : 'none');
// Pass: every seeked instant within half a pixel (and 0.005 of opacity) of the live replayer, the
// same pot figure, and no page error.
const bad = ['gif', 'video'].flatMap(k => report[k].filter(r => !(r.maxPx <= 0.5) || r.export.pot !== r.live.pot).map(r => `${k}@${r.t}`));
const none = ['gif', 'video'].filter(k => !report[k].length);
if (bad.length || none.length || errors.length) {
  console.log('FAIL', bad.join(' '), none.length ? 'no turn seeked in ' + none.join(', ') : '');
  process.exitCode = 1;
} else console.log('PASS: the exports match the live replayer at every seeked instant of the turn');
await browser.close();
