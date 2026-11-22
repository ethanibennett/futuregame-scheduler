// Every motion on the felt, frame by frame (owner, 2026-11-21, of a shared hand: "Every single animation should be
// ultra smooth"). For each step of a hand, opened from a share link signed out: press Forward, hold every animation the
// press made, seek them all together through the moment at 60 fps, and read every piece's box and drawn opacity
// (its own times its ancestors') at each frame. Reported, per kind of piece:
//   appears / vanishes   a piece that comes or goes at more than 0.3 with nothing fading it (a piece replaced in the
//                        same frame by one just like it, at its place, size and strength, is a swap and not counted)
//   brightens / dims     an opacity change of more than 0.2 in one frame (a fade shorter than about 85ms)
//   jumps                a move of more than 24px in one frame
//   starts fast / stops dead   a move of more than 10px in a frame from rest, or to rest
//   resizes              a size change of more than 4px in a frame (7px for a card: a turn over narrows it)
// Left out as the audit's known misreadings: a fold's copies shrinking toward the muck, the turn ring's handover, a
// figure's width changing with its digits, and the frame after a moment ends (a motion built after the press, the ship
// or a board that waits for a chip, is not held: check those in real time).
//
//   node scripts/check-replayer-smooth.mjs [--ids "NLH#4,PLO#4"] [--shorthand "<hand link shorthand>"] [--build dir]
//        [--width 402 --height 874] [--json file] [--strict]
//
// Boots its own scratch server (ports 4920-4929). Needs the built app. Reports only; --strict exits 1 on any issue.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
const { createScratch, boot } = require('../test/helpers/scratch-server.js');

const ROOT = path.join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const BUILD = opt('--build', 'public-vite');
const W = Number(opt('--width', 402)), H = Number(opt('--height', 874));
const STRICT = args.includes('--strict');
const JSON_OUT = opt('--json', null);
const IDS = opt('--ids', 'NLH#4,PLO#4,Stud Hi#3,Razz#10,2-7 TD#3,Badugi#8').split(',').map((s) => s.trim()).filter(Boolean);

// The hands, as share-link shorthand (the encoder reads localStorage at load).
const mem = new Map();
globalThis.localStorage = globalThis.localStorage || { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = globalThis.window || globalThis;
const { encodeHand } = await import(new URL('../vite-app/src/utils/hand-shorthand.js', import.meta.url).href);
const corpus = fs.readFileSync(path.join(ROOT, 'test', 'replayer-oracle', 'corpus.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const hands = opt('--shorthand') ? [{ id: 'shorthand', sh: opt('--shorthand') }]
  : IDS.map((id) => { const r = corpus.find((x) => x.id === id); if (!r) throw new Error('no corpus hand ' + id); return { id, sh: encodeHand(r.hand) }; });

const PIECES = [
  ['card', '.replayer-seat-cards .card-row > *'],
  ['board', '.replayer-board-area .card-row > *'],
  ['plaque', '.replayer-seat-info'],
  ['stack', '.replayer-seat-stack, .replayer-stack-roll'],
  ['label', '.replayer-action-badge-outer'],
  ['labelcopy', '.replayer-label-copy'],
  ['readout', '.replayer-seat-hand-name'],
  ['wager', '.replayer-bet-chip'],
  ['pot', '.replayer-pot-display'],
  ['potrow', '.replayer-pot-layers > *, .replayer-split-shares > *'],
  ['button', '.replayer-dealer-btn'],
  ['ghost', '.replayer-ghost-row > *, .replayer-motion-layer > *:not(.replayer-ghost-row)'],
  ['pill', '.replayer-game-pill, .replayer-pot-above'],
  ['ring', '.replayer-turn-ring'],
];
// In the page: every piece's centre, size, drawn opacity and first words, by element (a clone is another piece).
const READ = (pieces) => {
  const table = document.querySelector('.replayer-table');
  window.__aid = window.__aid || 0;
  window.__ids = window.__ids || new WeakMap();
  const out = {};
  const eff = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) { o *= Number(getComputedStyle(n).opacity); if (o === 0) break; } return o; };
  for (const [kind, sel] of pieces) for (const el of table.querySelectorAll(sel)) {
    if (!window.__ids.has(el)) window.__ids.set(el, { id: String(++window.__aid), kind });
    const tag = window.__ids.get(el);
    const q = el.getBoundingClientRect();
    if (!(q.width > 0 && q.height > 0)) continue;
    const vis = getComputedStyle(el).visibility !== 'hidden';
    out[tag.id] = { k: tag.kind, x: +(q.left + q.width / 2).toFixed(2), y: +(q.top + q.height / 2).toFixed(2), w: +q.width.toFixed(2), h: +q.height.toFixed(2), o: vis ? +eff(el).toFixed(3) : 0, t: (el.textContent || '').trim().slice(0, 18) };
  }
  return out;
};
const BENIGN = (x) => (x.k === 'ghost' && x.what === 'resizes') || x.k === 'ring' || ((x.k === 'pill' || x.k === 'pot') && x.what === 'resizes');

function issuesOf(F) {
  const issues = [];
  for (let i = 1; i < F.length; i++) {
    const A = F[i - 1], B = F[i];
    const ids = new Set([...Object.keys(A), ...Object.keys(B)]);
    // Swaps nobody can see: what goes (or drops to nothing) has something just like it in the next frame; what comes
    // (or rises from nothing) had something just like it in the last.
    const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 3 && Math.abs(p.w - q.w) < 4 && Math.abs(p.h - q.h) < 4 && Math.abs(p.o - q.o) < 0.15;
    const swapped = new Set();
    for (const id of ids) {
      const a = A[id], b = B[id];
      if (a && (!b || (a.o - b.o > 0.2 && b.o < 0.1)) && Object.entries(B).some(([j, v]) => j !== id && same(v, a))) swapped.add(id);
      if (b && (!a || (b.o - a.o > 0.2 && a.o < 0.1)) && Object.entries(A).some(([j, v]) => j !== id && same(v, b))) swapped.add(id);
    }
    for (const id of ids) {
      if (swapped.has(id)) continue;
      const a = A[id], b = B[id];
      const k = (a || b).k;
      const name = k + ((a || b).t ? ' "' + (a || b).t + '"' : '');
      if (a && !b) { if (a.o > 0.3) issues.push({ f: i, k, what: 'vanishes', name, o: a.o }); continue; }
      if (!a && b) { if (b.o > 0.3) issues.push({ f: i, k, what: 'appears', name, o: b.o }); continue; }
      const dO = b.o - a.o;
      const seen = Math.max(a.o, b.o) > 0.05;
      if (Math.abs(dO) > 0.2 && seen) issues.push({ f: i, k, what: dO > 0 ? 'brightens' : 'dims', name, by: +dO.toFixed(2) });
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d > 24 && seen) issues.push({ f: i, k, what: 'jumps', name, by: +d.toFixed(1) });
      const dw = Math.max(Math.abs(b.w - a.w), Math.abs(b.h - a.h));
      if (dw > (k === 'card' || k === 'board' ? 7 : 4) && seen) issues.push({ f: i, k, what: 'resizes', name, by: +dw.toFixed(1) });
      if (i >= 2 && d > 10 && seen) {
        const p = F[i - 2][id], n = F[i + 1] && F[i + 1][id];
        if ((p ? Math.hypot(a.x - p.x, a.y - p.y) : 0) < 1) issues.push({ f: i, k, what: 'starts fast', name, by: +d.toFixed(1) });
        if (n && Math.hypot(n.x - b.x, n.y - b.y) < 1) issues.push({ f: i, k, what: 'stops dead', name, by: +d.toFixed(1) });
      }
    }
  }
  return issues.filter((x) => !BENIGN(x));
}

const PORTS = [4920, 4929];
const scratch = await createScratch({ ports: PORTS, prefix: 'fg-smooth-' });
const srv = await boot(scratch.dbPath, { PUBLIC_VITE_DIR: BUILD }, { ports: PORTS, preloads: [path.join(ROOT, 'test', 'helpers', 'public-dir-preload.js')] });
const base = `http://127.0.0.1:${srv.port}`;
const api = async (p, o = {}) => { const r = await fetch(base + p, { method: o.method || 'GET', headers: { 'content-type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const browser = await webkit.launch();
const all = {};
let total = 0;
try {
  await api('/api/register', { method: 'POST', body: { username: 'smoothcheck', email: 'smooth@x.test', password: 'smooth-check-password-1', realName: 'S C' } });
  const { body: { token } } = await api('/api/login', { method: 'POST', body: { email: 'smooth@x.test', password: 'smooth-check-password-1' } });
  for (const h of hands) {
    const link = await api('/api/hand-links', { method: 'POST', token, body: { shorthand: h.sh } });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 200)));
    await page.goto(base + '/h/' + link.body.id, { waitUntil: 'domcontentloaded' });
    const fwd = page.locator('button[title^="Forward"]').first();
    await fwd.waitFor({ timeout: 15000 });
    await page.waitForTimeout(2500);
    const steps = [];
    for (let s = 1; s <= 80; s++) {
      if (await fwd.isDisabled().catch(() => true)) break;
      const before = await page.evaluate(READ, PIECES);
      const walk = await page.evaluate(async ({ pieces, readSrc }) => {
        const read = new Function('return (' + readSrc + ')')();
        const tClick = performance.now();
        document.querySelector('button[title^="Forward"]').click();
        // Two frames for the moment to build its work, then hold everything and walk it.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const since = performance.now() - tClick;
        const anims = document.getAnimations().filter((a) => a.effect && Number.isFinite(a.effect.getComputedTiming().endTime));
        anims.forEach((a) => a.pause());
        // One clock from the press: each animation's own time is the clock less how much after the press it began.
        const lag = anims.map((a) => since - (Number(a.currentTime) || 0));
        const T = Math.max(0, ...anims.map((a, i) => a.effect.getComputedTiming().endTime + lag[i]));
        // From the moment the press's own animations exist (the newest of them was made a few ms after it).
        const s0 = Math.max(0, ...lag.filter((l) => l >= 0 && l < since));
        const frames = [];
        for (let t = s0; t <= T + 1; t += 1000 / 60) {
          anims.forEach((a, i) => { a.currentTime = Math.min(a.effect.getComputedTiming().endTime, t - lag[i]); });
          frames.push(read(pieces));
        }
        anims.forEach((a) => { try { a.finish(); } catch (_) { /* gone */ } });
        return { frames };
      }, { pieces: PIECES, readSrc: READ.toString() });
      steps.push({ step: s, issues: issuesOf([before, ...walk.frames]) });
      await page.waitForTimeout(300);
    }
    await ctx.close();
    const kinds = new Map();
    for (const st of steps) for (const x of st.issues) {
      const key = x.what + ' ' + x.k;
      if (!kinds.has(key)) kinds.set(key, { n: 0, ex: { step: st.step, ...x } });
      kinds.get(key).n++;
      total++;
    }
    console.log(`${h.id}: ${steps.length} steps, ${[...kinds.values()].reduce((n, v) => n + v.n, 0)} issues`);
    for (const [key, v] of [...kinds.entries()].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`   ${v.n}x ${key}   e.g. step ${v.ex.step} frame ${v.ex.f} ${v.ex.name}${v.ex.by != null ? ' ' + JSON.stringify(v.ex.by) : ''}${v.ex.o != null ? ' at ' + v.ex.o : ''}`);
    }
    all[h.id] = steps;
  }
} finally {
  await browser.close();
  await srv.stop();
  scratch.cleanup && scratch.cleanup();
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(all, null, 1));
console.log(total ? `\n${total} issues` : '\nEvery motion smooth.');
process.exit(STRICT && total ? 1 : 0);
