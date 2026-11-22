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
//   recolours            a visible piece's colour, ground or border moving more than 80 (of 441, RGB) in one frame,
//                        or a swap whose new piece is in another colour (the gold run-out name replaced by a red one)
// Then the hand again in real time, nothing held (owner, 2026-11-22, of the hero's plaque: "Hero's seat box is STILL
// flickering"; its figure showed the new stack for a frame, then the old, then counted): every press sampled on every
// frame the page paints, and reported:
//   flashes text         a visible piece's words that change and change back within 12 frames (a figure, a name)
//   flashes colour       a visible piece's colour, ground or border that changes and changes back within 12 frames
//   flickers             a visible piece whose drawn opacity drops by more than 0.3 and comes back within 12 frames
//                        with the same words (new words fading in over a copy of the old are a crossfade)
// The held walk cannot see these: a figure is counted by code on each frame, not by an animation it can hold.
// Left out as the audit's known misreadings: a fold's copies shrinking toward the muck, the turn ring's handover (and a
// plaque's colours under the ring's copy, which crosses them), a card's colours (its look is an image or a background),
// a figure's width changing with its digits, and the frame after a moment ends (a motion built after the press, the
// ship or a board that waits for a chip, is not held: the real-time pass sees those).
//
//   node scripts/check-replayer-smooth.mjs [--ids "NLH#4,PLO#4"] [--shorthand "<hand link shorthand>"] [--build dir]
//        [--width 402 --height 874] [--json file] [--strict] [--ports 4920-4929]
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
  ['flood', '.replayer-flood-suit'],
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
    const cs = getComputedStyle(el);
    out[tag.id] = { k: tag.kind, x: +(q.left + q.width / 2).toFixed(2), y: +(q.top + q.height / 2).toFixed(2), w: +q.width.toFixed(2), h: +q.height.toFixed(2), o: vis ? +eff(el).toFixed(3) : 0, t: (el.textContent || '').trim().slice(0, 18),
      c: cs.color, bg: cs.backgroundColor, bc: cs.borderTopColor };
  }
  return out;
};
// Colours as RGBA; the distance between two, with alpha weighted as a channel (a ground fading to transparent counts).
const rgba = (v) => { const m = String(v || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); if (p.length < 3 || p.some((n) => !Number.isFinite(n))) return null; return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
const colourGap = (u, v) => { const a = rgba(u), b = rgba(v); if (!a || !b) return 0; return Math.hypot(a[0] * a[3] - b[0] * b[3], a[1] * a[3] - b[1] * b[3], a[2] * a[3] - b[2] * b[3], 255 * (a[3] - b[3])); };
const COLOURS = ['c', 'bg', 'bc'];
/* The colours a piece shows: its text colour only when it has words. None for a card: its look is an image or a
   background (a turning card paints its back as one), which these colours do not read. */
const shownColours = (p) => (!p || p.k === 'card' || p.k === 'board' ? [] : p.t ? COLOURS : COLOURS.filter((c) => c !== 'c'));
/* A plaque under the turn ring's copy (drawn over its border box, fading out or in) crosses colours with it: the
   handover is the copy's fade, not the plaque's own change. */
const underRing = (F, p) => Object.values(F).some((v) => v.k === 'ring' && v.o > 0.3 && Math.abs(v.x - p.x) < 3 && Math.abs(v.y - p.y) < 3 && Math.abs(v.w - p.w) < 5 && Math.abs(v.h - p.h) < 5);
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
      const twinB = a && (!b || (a.o - b.o > 0.2 && b.o < 0.1)) && Object.entries(B).find(([j, v]) => j !== id && same(v, a));
      const twinA = b && (!a || (b.o - a.o > 0.2 && a.o < 0.1)) && Object.entries(A).find(([j, v]) => j !== id && same(v, b));
      if (twinB) swapped.add(id);
      if (twinA) swapped.add(id);
      // A swap in another colour is seen: the gold run-out name replaced by the loser's red one in a frame.
      if (twinB && a.o > 0.3) {
        const gaps = shownColours(a).map((c) => colourGap(a[c], twinB[1][c])); const gap = Math.max(...gaps); const ch = shownColours(a)[gaps.indexOf(gap)];
        if (gap > 80) issues.push({ f: i, k: a.k, what: 'recolours', name: a.k + (a.t ? ' "' + a.t + '"' : '') + ' (replaced)', by: ch + ' ' + a[ch] + ' > ' + twinB[1][ch] });
      }
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
      if (Math.min(a.o, b.o) > 0.3 && !(k === 'plaque' && (underRing(A, a) || underRing(B, b)))) {
        const cols = shownColours(b);
        const gaps = cols.map((c) => colourGap(a[c], b[c])); const gap = Math.max(...gaps); const ch = cols[gaps.indexOf(gap)];
        if (gap > 80) issues.push({ f: i, k, what: 'recolours', name, by: ch + ' ' + a[ch] + ' > ' + b[ch] });
      }
      if (i >= 2 && d > 10 && seen) {
        const p = F[i - 2][id], n = F[i + 1] && F[i + 1][id];
        if ((p ? Math.hypot(a.x - p.x, a.y - p.y) : 0) < 1) issues.push({ f: i, k, what: 'starts fast', name, by: +d.toFixed(1) });
        if (n && Math.hypot(n.x - b.x, n.y - b.y) < 1) issues.push({ f: i, k, what: 'stops dead', name, by: +d.toFixed(1) });
      }
    }
  }
  return issues.filter((x) => !BENIGN(x));
}

/* Real time: per piece, a value that leaves and comes back within 12 frames while the piece shows (above 0.3). */
function flashesOf(F) {
  const issues = [];
  const ids = new Set(F.flatMap((f) => Object.keys(f)));
  for (const id of ids) {
    const seq = F.map((f, i) => (f[id] ? { i, ...f[id] } : null)).filter(Boolean);
    const k = seq[0].k;
    const name = k + (seq.find((x) => x.t) ? ' "' + seq.find((x) => x.t).t + '"' : '');
    const probe = (what, val, differs) => {
      for (let j = 1; j < seq.length; j++) {
        const a = seq[j - 1], b = seq[j];
        if (b.i !== a.i + 1 || !differs(val(a), val(b)) || Math.min(a.o, b.o) <= 0.3) continue;
        for (let m = j + 1; m < seq.length && seq[m].i - b.i <= 12; m++) {
          if (seq[m].o <= 0.3) break;
          if (!differs(val(seq[m]), val(a))) { issues.push({ f: b.i, k, what, name, by: String(val(a)).slice(0, 24) + ' > ' + String(val(b)).slice(0, 24) + ' > back' }); j = m; break; }
        }
      }
    };
    probe('flashes text', (x) => x.t, (u, v) => u !== v);
    for (const c of shownColours(seq.find((x) => x.t) || seq[0])) probe('flashes colour', (x) => x[c], (u, v) => colourGap(u, v) > 40);
    for (let j = 1; j < seq.length; j++) {
      const a = seq[j - 1];
      if (a.o <= 0.3) continue;
      const low = seq.slice(j, j + 12).findIndex((x) => a.o - x.o > 0.3);
      if (low < 0) continue;
      // The same words back: new words fading in over a copy of the old are a crossfade, not a flicker.
      const back = seq.slice(j + low, j + 13).findIndex((x) => a.o - x.o < 0.1 && x.t === a.t);
      if (back >= 0) { issues.push({ f: seq[j + low].i, k, what: 'flickers', name, by: a.o + ' > ' + seq[j + low].o + ' > back' }); j += low + back; }
    }
  }
  return issues.filter((x) => x.k !== 'ring');
}

const PORTS = (opt('--ports') || '4920-4929').split('-').map(Number);
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
    // The same hand again in real time.
    const ctx2 = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    const page2 = await ctx2.newPage();
    page2.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 200)));
    await page2.goto(base + '/h/' + link.body.id, { waitUntil: 'domcontentloaded' });
    const fwd2 = page2.locator('button[title^="Forward"]').first();
    await fwd2.waitFor({ timeout: 15000 });
    await page2.waitForTimeout(2500);
    for (let s = 1; s <= steps.length; s++) {
      if (await fwd2.isDisabled().catch(() => true)) break;
      const frames = await page2.evaluate(async ({ pieces, readSrc }) => {
        const read = new Function('return (' + readSrc + ')')();
        const out = [read(pieces)];
        const t0 = performance.now();
        document.querySelector('button[title^="Forward"]').click();
        out.push(read(pieces));
        // Until nothing has moved for 20 frames (the counts and the ship included), from 700ms on; 3.5s at most.
        await new Promise((done) => {
          let still = 0, last = '';
          const tick = () => {
            const f = read(pieces);
            out.push(f);
            const sig = JSON.stringify(f);
            still = sig === last ? still + 1 : 0;
            last = sig;
            const t = performance.now() - t0;
            if (t > 3500 || (t > 700 && still >= 20)) done(); else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        return out;
      }, { pieces: PIECES, readSrc: READ.toString() });
      steps[s - 1].issues.push(...flashesOf(frames));
      await page2.waitForTimeout(300);
    }
    await ctx2.close();
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
