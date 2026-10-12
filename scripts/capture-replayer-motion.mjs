// Frame-accurate capture of the replayer's motion: the flop deal and spread, the turn and river
// landing (and the board shifting to make room), a wager going in, and the pot pushed to the
// winner. Built to compare today's curves against spring-driven ones by NUMBERS as well as by eye,
// so every clip writes a measurement file next to its video.
//
//   node scripts/capture-replayer-motion.mjs [baseUrl] [--seats 6,8,9] [--moments flop,turn,river,bet,push]
//        [--width 402] [--height 874] [--dpr 3] [--out dir] [--springs 0|1] [--format png|jpeg]
//        [--keep-frames] [--no-video] [--parallel 4] [--encode-only]
//   node scripts/capture-replayer-motion.mjs [baseUrl] --realtime [--engine msedge|webkit]
//        [--throttle 4] [--repeat 3] [--sample] [--seats ...] [--moments ...] [--out dir]
//
//   baseUrl   a SCRATCH server running this checkout (never the pm2 app on :3001 for an unmerged
//             build). Default http://127.0.0.1:3241. A guest session is used: POST /api/guest-login.
//   --springs sets localStorage.replayerSprings before the app boots, so a before/after pair comes
//             from the same build. Omitted, the key is left unset (the build's own default).
//
// How time is controlled (frame mode, the default). Nothing here records the screen in real time.
//   - Playwright's clock is installed, so the app's setTimeouts (the chip burst cleared at 700ms, the
//     pot landing at 300ms, the street-transition re-render) only fire when the harness advances
//     virtual time, 1000/60 ms per frame.
//   - The document timeline cannot be faked, so every animation (CSS animations, CSS transitions and
//     Web Animations alike) is found with document.getAnimations() after each step, PAUSED, and its
//     currentTime set to (frame time - the frame it was born on). An animation is born on the frame
//     it is first seen, the way a browser starts one on the next frame's timeline time.
//   - React renders through MessageChannel, which is not faked: after each clock advance the harness
//     waits out a few MessageChannel round trips, so the commit a timer causes lands in that frame.
//   - Card images for the whole hand are decoded before the moment, so no frame shows a card that is
//     still on the network.
//   Each clip is a lead-in of LEAD frames, the press of Forward, and every frame until nothing has
//   moved for 300ms (at least 900ms, at most 3s). Frames are screenshots of the table at --dpr,
//   assembled by ffmpeg into <moment>-<n>max-<w>x<h>.mp4 (60 fps) and a quarter-speed -slow4x.mp4.
//
// What is measured (the .json beside each video):
//   frames[]   per frame, time from the press (ms) and, relative to the table's top-left: every board
//              card (by data-slot), every wager in front of a seat, every flying chip and the pot —
//              centre x/y, box w/h, EFFECTIVE opacity (the product up the tree), and the transform's
//              translate/scale/rotation.
//   animations[] every animation alive during the clip: kind (CSSAnimation / CSSTransition / Web
//              Animation), name, target, duration, delay, easing, fill, the keyframes, the properties
//              it animates, the frame it was born and died on, and whether it FINISHED or was
//              CANCELLED before its end (a class dropped on a re-render).
//   summary    per element: when it started moving, when it settled, travel, overshoot past its rest
//              (px and % of travel), time to 95% of travel, peak speed; and every animated property
//              that is not transform or opacity (layout or paint work on every frame).
//
// Realtime mode (--realtime) does not pause anything: it presses Forward with a real (trusted) click
// and records every requestAnimationFrame for 1.8s, plus long-animation-frame / longtask entries
// where the engine has them. On msedge (Chromium) --throttle N applies a CDP CPU throttle, the usual
// stand-in for an old phone. --sample also reads the board cards on every frame (off by default: it
// costs frame time), which is how a CSS animation cancelled after a single painted frame shows up.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { webkit, chromium } = require('../vite-app/node_modules/playwright');

const args = process.argv.slice(2);
const opt = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : d; };
const BASE = (args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:3241').replace(/\/$/, '');
const W = Number(opt('--width', 402)), H = Number(opt('--height', 874));
const DPR = Number(opt('--dpr', 3));
const SEATS = String(opt('--seats', '6,8,9')).split(',').map(Number);
const MOMENTS = String(opt('--moments', 'flop,turn,river,bet,push')).split(',');
const OUT = path.resolve(opt('--out', 'replayer-motion'));
const SPRINGS = opt('--springs', null);
const FORMAT = opt('--format', 'png');
const KEEP = args.includes('--keep-frames');
const NO_VIDEO = args.includes('--no-video');
const REALTIME = args.includes('--realtime');
const ENGINE = opt('--engine', 'webkit');
const THROTTLE = Number(opt('--throttle', 1));
const REPEAT = Number(opt('--repeat', 1));
const SAMPLE = args.includes('--sample');
// FFMPEG may name the binary or (as on the Windows box) the directory holding it.
const FFMPEG = (() => {
  const e = process.env.FFMPEG;
  if (e && fs.existsSync(e) && fs.statSync(e).isDirectory()) return path.join(e, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (e) return e;
  return fs.existsSync('C:/ffmpeg/bin/ffmpeg.exe') ? 'C:/ffmpeg/bin/ffmpeg.exe' : 'ffmpeg';
})();
const FPS = 60, LEAD = 12, MIN_AFTER = 900, MAX_AFTER = 3000, STILL_MS = 300;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Test tables are 6-, 8- or 9-max, never 5 (owner's rule). One hand per size, each with a flop, a
// turn, a river, several wagers and a winner shown down against a known hand, so every moment
// exists at every size. The 6-max hand is the ad hand with its river called and a result added.
const HANDS = {
  6: 'N63.1000-2000~93000,60000,72000,185000,50000,110000.AsKc,QhQd,-,-,-,-/bKh7d2c/b9s/bAh.'
    + '0r5000,1f,2f,3r15000,4f,5f,0c15000/0x,3b12000,0c12000/0x,3x/0b40000,3c40000.w3',
  8: 'N85.1000-2000~120000,95000,150000,80000,70000,210000,64000,110000.AsKc,-,-,QhQd,-,-,-,-/bKh7d2c/b9s/bAh.'
    + '0f,1f,2r5000,3f,4f,5r15000,6f,7f,2c15000/2x,5b12000,2c12000/2x,5b30000,2c30000/2b40000,5c40000.w5',
  9: 'N96.1000-2000~120000,95000,88000,200000,70000,105000,250000,64000,110000.AsKc,-,-,-,QhQd,-,-,-,-/bKh7d2c/b9s/bAh.'
    + '0f,1f,2f,3r5000,4f,5f,6r15000,7f,8f,3c15000/3x,6b12000,3r36000,6c36000/3b40000,6c40000/3x,6b60000,3c60000.w6',
};

/* How many presses of Forward reach the step BEFORE a moment. The replay starts at (street 0,
   action -1); each press takes the next action, then the next street (action -1), and after the
   river's last action, the result. */
function pressesBefore(hand, moment) {
  const acts = hand.split('.')[3].split('/').map(s => (s ? s.split(',') : []));
  const c = acts.map(a => a.length);
  const toStreet = (s) => { let n = 0; for (let i = 0; i < s; i++) n += c[i] + 1; return n; };
  if (moment === 'flop') return toStreet(1) - 1;
  if (moment === 'turn') return toStreet(2) - 1;
  if (moment === 'river') return toStreet(3) - 1;
  if (moment === 'push') return toStreet(3) + c[3];
  if (moment === 'bet') {   // the first bet or raise on the flop
    const k = acts[1].findIndex(a => /^\d+[br]\d/.test(a));
    return toStreet(1) + k;
  }
  throw new Error('unknown moment ' + moment);
}
const boardCardsOf = (hand) => (hand.split('.')[2].match(/b([2-9TJQKA][hdcs])+/g) || [])
  .flatMap(b => b.slice(1).match(/../g));

// ── In-page instrumentation ─────────────────────────────────────────────────────────────────────
// Runs in the page. __mc owns the animations (frame mode); __measure reads the moving elements.
function pageInstrument() {
  const describeEl = (el) => {
    if (!el || !el.tagName) return null;
    const cls = [...el.classList].slice(0, 4).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (el.dataset && el.dataset.slot != null ? '[slot=' + el.dataset.slot + ']' : '');
  };
  const NON_PROPS = new Set(['offset', 'computedOffset', 'easing', 'composite']);
  const describe = (a) => {
    const eff = a.effect;
    const timing = eff ? eff.getTiming() : {};
    const ct = eff ? eff.getComputedTiming() : {};
    let keyframes = [], props = [];
    try {
      keyframes = eff.getKeyframes().map(k => { const o = {}; for (const p in k) if (k[p] != null && p !== 'composite') o[p] = k[p]; return o; });
      props = [...new Set(keyframes.flatMap(k => Object.keys(k).filter(p => !NON_PROPS.has(p))))];
    } catch (e) { /* no keyframes */ }
    const kind = (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) ? 'CSSAnimation'
      : (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) ? 'CSSTransition' : 'WebAnimation';
    if (kind === 'CSSTransition' && a.transitionProperty && !props.includes(a.transitionProperty)) props.push(a.transitionProperty);
    return {
      kind, name: a.animationName || a.transitionProperty || a.id || '',
      target: describeEl(eff && eff.target), duration: timing.duration, delay: timing.delay,
      easing: timing.easing, fill: timing.fill, iterations: timing.iterations, endTime: ct.endTime,
      props, keyframes,
    };
  };
  const recs = new Map();
  const inventory = [];
  let pressAt = null, now = 0;
  window.__mc = {
    /* Adopt what is running, then catch every new animation the instant it exists. A CSS
       animation or transition is created at the style recalc after the DOM changes, and React
       commits through MessageChannel tasks that WebKit runs tens of ms apart in real time — long
       enough for an unwatched animation to get well under way. A MutationObserver callback is a
       microtask after the commit (after its layout effects, so Web Animations started there too),
       before any frame can render; getAnimations() there forces the recalc and everything new is
       paused at its first frame. */
    arm(t) {
      now = t; this.sync(t);
      new MutationObserver(() => this.sync(now)).observe(document.documentElement,
        { subtree: true, childList: true, attributes: true, characterData: true });
    },
    setNow(t) { now = t; },
    press(t) { pressAt = t; now = t; },
    sync(t) {
      if (t != null) now = t;
      t = now;
      const live = document.getAnimations();
      const liveSet = new Set(live);
      for (const a of live) {
        let rec = recs.get(a);
        if (!rec) {
          const ct = a.currentTime == null ? 0 : a.currentTime;
          // Born now unless it was already well under way when first seen (it predates the clip).
          const birth = (pressAt != null && ct < 50) ? t : t - ct;
          rec = { ...describe(a), born: birth, died: null, ended: null, predates: pressAt == null || ct >= 50 };
          recs.set(a, rec); inventory.push(rec);
        }
        try { a.pause(); a.currentTime = Math.max(0, t - rec.born); } catch (e) { rec.error = String(e); }
      }
      for (const [a, rec] of recs) {
        if (rec.died == null && !liveSet.has(a)) {
          rec.died = t;
          const end = rec.endTime;
          rec.ended = (Number.isFinite(end) && t - rec.born >= end - 1) ? 'finished' : 'cancelled';
          recs.delete(a);
        }
      }
      return live.length;
    },
    inventory() { return inventory; },
  };
  window.__measure = () => {
    const table = document.querySelector('.replayer-table');
    const T = table.getBoundingClientRect();
    const effOp = (el) => { let o = 1; for (let n = el; n && n !== table.parentElement; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
    const box = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const o = {
        cx: +(r.left + r.width / 2 - T.left).toFixed(2), cy: +(r.top + r.height / 2 - T.top).toFixed(2),
        w: +r.width.toFixed(2), h: +r.height.toFixed(2), op: +effOp(el).toFixed(4),
      };
      if (cs.transform && cs.transform !== 'none') {
        const m = new DOMMatrixReadOnly(cs.transform);
        o.tx = +m.m41.toFixed(2); o.ty = +m.m42.toFixed(2);
        o.s = +Math.hypot(m.a, m.b).toFixed(4); o.rot = +(Math.atan2(m.b, m.a) * 180 / Math.PI).toFixed(2);
      }
      if (cs.filter && cs.filter !== 'none') o.filter = cs.filter;
      return o;
    };
    const els = {};
    table.querySelectorAll('.replayer-board-area:not(.replayer-dead-area) .card-row > [data-slot]')
      .forEach(el => { els['board' + el.dataset.slot] = box(el); });
    table.querySelectorAll('.replayer-bet-chip').forEach(el => {
      els['bet@' + el.style.left + ',' + el.style.top] = { ...box(el), text: el.textContent.trim() };
    });
    table.querySelectorAll('.replayer-flying-chip').forEach((el, i) => {
      els['fly' + i + (el.classList.contains('to-winner') ? '-winner' : '')] = box(el);
    });
    const pot = table.querySelector('.replayer-pot-display');
    if (pot) els.pot = { ...box(pot), text: pot.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) };
    return { table: [T.left, T.top, T.width, T.height], els };
  };
  // A few MessageChannel round trips: React's scheduler posts its work there, and a timer's state
  // change takes a render, a passive-effect flush and the render THAT schedules.
  const post = window.__mcPost || MessagePort.prototype.postMessage;
  window.__hops = (n = 6) => new Promise(r => {
    let k = 0; const ch = new MessageChannel();
    ch.port1.onmessage = () => { if (++k < n) post.call(ch.port2, 0); else r(); };
    post.call(ch.port2, 0);
  });
}

async function openHand(browser, seats, { clock }) {
  const guest = await (await fetch(BASE + '/api/guest-login', { method: 'POST' })).json();
  if (!guest.token) throw new Error('guest login failed on ' + BASE);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, reducedMotion: 'no-preference' });
  await ctx.addInitScript(({ tok, springs }) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('onboardComplete', '1');
    localStorage.setItem('hasOnboarded', 'true');
    if (springs != null) localStorage.setItem('replayerSprings', springs);
  }, { tok: guest.token, springs: SPRINGS });
  if (clock) {
    /* React does the work a commit's effects schedule (the chip burst, the re-render that drops the
       board's animation class) in a MessageChannel task, which a browser runs after it has painted
       the frame the click produced — measured in Chromium: the turn card's 0% keyframe is on screen
       for exactly one frame before that re-render removes it. Holding React's posts across the
       press frame's screenshot reproduces that order deterministically; they are released at the
       start of the next frame. */
    await ctx.addInitScript(() => {
      const orig = MessagePort.prototype.postMessage;
      window.__mcPost = orig;
      let held = null;
      MessagePort.prototype.postMessage = function (...a) { if (held) { held.push([this, a]); return; } return orig.apply(this, a); };
      window.__mcHold = () => { held = held || []; };
      window.__mcRelease = () => { const q = held || []; held = null; q.forEach(([p, a]) => orig.apply(p, a)); return q.length; };
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  pageerror:', String(e).slice(0, 200)));
  if (clock) await page.clock.install();
  await page.goto(BASE + '/#h/' + encodeURIComponent(HANDS[seats]), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[title="Forward"]', { timeout: 30000 });
  await sleep(3000);
  await page.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 1000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  // Decode every card face in the hand now, so the moment never waits on the network.
  await page.evaluate(async (cards) => {
    await Promise.all(cards.map(c => new Promise(r => { const i = new Image(); i.onload = i.onerror = () => (i.decode ? i.decode().catch(() => {}) : null, r()); i.src = '/cards/cards_gui_' + c + '.svg'; })));
  }, boardCardsOf(HANDS[seats]));
  await page.evaluate(pageInstrument);
  return { ctx, page };
}

async function stepTo(page, n) {
  for (let i = 0; i < n; i++) {
    const ok = await page.evaluate(() => { const b = document.querySelector('button[title="Forward"]'); if (!b || b.disabled) return false; b.click(); return true; });
    if (!ok) throw new Error('Forward unavailable at press ' + i);
    await sleep(260);
  }
  await sleep(1500);   // every step's choreography and timers run out in real time
}

const clipName = (moment, seats) => `${moment}-${seats}max-${W}x${H}`;

// ── Frame mode ──────────────────────────────────────────────────────────────────────────────────
async function captureMoment(browser, seats, moment) {
  const name = clipName(moment, seats);
  const frameDir = path.join(OUT, 'frames', name);
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });
  const { ctx, page } = await openHand(browser, seats, { clock: true });
  try {
    await stepTo(page, pressesBefore(HANDS[seats], moment));
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 50);
    await page.evaluate(() => window.__hops());
    await page.evaluate(() => window.__mc.arm(0));   // adopt what is already running, then watch

    const t0 = await page.evaluate(() => window.__measure().table);
    const clip = {
      x: 0, y: Math.max(0, Math.floor(t0[1]) - 6), width: W,
      height: Math.min(H, Math.ceil(t0[1] + t0[3]) + 6) - Math.max(0, Math.floor(t0[1]) - 6),
    };
    const frames = [];
    let prevMs = 0, lastChange = 0, f = 0;
    const sig = (m) => JSON.stringify(m.els);
    let prevSig = null;
    const t1 = Date.now();
    const cost = { clock: 0, page: 0, shot: 0 };
    const lap = (k, t) => { const n = Date.now(); cost[k] += n - t; return n; };
    for (;; f++) {
      let tl = Date.now();
      const vt = f * 1000 / FPS;                       // virtual ms since the lead-in began
      const ms = Math.round(vt);
      if (f > 0) {
        // What a timer (or the press's held follow-up work) starts is born on this frame.
        await page.evaluate((t) => { window.__mc.setNow(t); window.__mcRelease(); }, vt);
        await page.clock.runFor(ms - prevMs);
      }
      prevMs = ms;
      tl = lap('clock', tl);
      if (f === LEAD) {
        // The press frame shows the click's own commit (React flushes a click's update in a
        // microtask, with its layout and passive effects) and nothing its effects scheduled.
        await page.evaluate(async (t) => {
          window.__mc.press(t);
          window.__mcHold();
          document.querySelector('button[title="Forward"]').click();
          for (let i = 0; i < 6; i++) await Promise.resolve();
          window.__mc.sync(t);
        }, vt);
      } else {
        await page.evaluate(() => window.__hops());
        await page.evaluate((t) => window.__mc.sync(t), vt);
      }
      const m = await page.evaluate(() => window.__measure());
      const tRel = +(vt - LEAD * 1000 / FPS).toFixed(2);
      frames.push({ f, t: tRel, els: m.els });
      const s = sig(m);
      if (prevSig !== null && s !== prevSig && f > LEAD) lastChange = tRel;
      prevSig = s;
      tl = lap('page', tl);
      const buf = await page.screenshot({ clip, type: FORMAT, ...(FORMAT === 'jpeg' ? { quality: 95 } : {}) });
      fs.writeFileSync(path.join(frameDir, `f${String(f).padStart(4, '0')}.${FORMAT === 'jpeg' ? 'jpg' : 'png'}`), buf);
      tl = lap('shot', tl);
      if (f > LEAD && ((tRel >= MIN_AFTER && tRel - lastChange >= STILL_MS) || tRel >= MAX_AFTER)) break;
    }
    const inventory = await page.evaluate(() => window.__mc.inventory());
    const out = { clip: name, seats, moment, viewport: [W, H], dpr: DPR, fps: FPS, springs: SPRINGS, hand: HANDS[seats],
      leadFrames: LEAD, capturedFrames: frames.length, wallSeconds: +((Date.now() - t1) / 1000).toFixed(1), wallCostMs: cost,
      summary: summarise(frames, inventory),
      animations: inventory.filter(a => !a.predates).map(a => ({ ...a, bornMs: +(a.born - LEAD * 1000 / FPS).toFixed(2), diedMs: a.died == null ? null : +(a.died - LEAD * 1000 / FPS).toFixed(2) })),
      frames };
    fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(out, null, 1));
    const encoded = NO_VIDEO ? false : encode(frameDir, name);
    if (encoded && !KEEP) fs.rmSync(frameDir, { recursive: true, force: true });
    return out;
  } finally {
    await ctx.close();
  }
}

/* Two MP4s per clip: real time at 60 fps, and quarter speed (each frame held four times) for
   reading a curve by eye. Returns false, keeping the frames for --encode-only, if ffmpeg fails —
   x264 at preset slow ran out of memory beside a dozen browsers, so the settings are modest. */
function encode(frameDir, name) {
  const ext = fs.existsSync(path.join(frameDir, 'f0000.jpg')) ? 'jpg' : 'png';
  const input = path.join(frameDir, 'f%04d.' + ext);
  // H.264 tops out around 4096 wide on most decoders; a 1440-wide view at 3x is 4320.
  const scale = "scale='min(3840,trunc(iw/2)*2)':-2:flags=lanczos,format=yuv420p";
  const common = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-threads', '4', '-rc-lookahead', '10', '-movflags', '+faststart', '-an'];
  try {
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', input, '-vf', scale, ...common, path.join(OUT, name + '.mp4')]);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS / 4), '-i', input, '-vf', scale + ',fps=' + FPS, ...common, path.join(OUT, name + '-slow4x.mp4')]);
    return true;
  } catch (e) {
    console.log(`  encode failed for ${name} (frames kept in ${frameDir}): ${String(e.stderr || e).trim().split(/\r?\n/)[0]}`);
    return false;
  }
}

// ── Numbers ─────────────────────────────────────────────────────────────────────────────────────
const COMPOSITOR = new Set(['transform', 'opacity', 'translate', 'scale', 'rotate']);
function summarise(frames, inventory) {
  const ids = [...new Set(frames.flatMap(fr => Object.keys(fr.els)))];
  const pre = frames.filter(fr => fr.t < 0).pop();
  const after = frames.filter(fr => fr.t >= 0);
  const final = frames[frames.length - 1];
  const elements = {};
  for (const id of ids) {
    const series = after.map(fr => ({ t: fr.t, e: fr.els[id] })).filter(x => x.e);
    if (!series.length) { elements[id] = { gone: true, before: pre && pre.els[id] ? pick(pre.els[id]) : null }; continue; }
    const before = pre && pre.els[id];
    const end = final.els[id] || series[series.length - 1].e;
    const firstVisible = series.find(x => x.e.op > 0.01);
    const differs = (a, b) => !a || !b || Math.abs(a.cx - b.cx) > 0.1 || Math.abs(a.cy - b.cy) > 0.1 || Math.abs(a.w - b.w) > 0.1 || Math.abs(a.op - b.op) > 0.002;
    let start = null, settle = null;
    for (let i = 0; i < series.length; i++) {
      const prev = i ? series[i - 1].e : before;
      if (differs(series[i].e, prev)) { if (start == null) start = series[i].t; settle = series[i].t; }
    }
    // Travel from where it was first SEEN (or where it was before the press) to where it rests.
    const from = before || (firstVisible ? firstVisible.e : series[0].e);
    const dx = end.cx - from.cx, dy = end.cy - from.cy, travel = Math.hypot(dx, dy);
    let overshoot = 0, t95 = null, peak = 0;
    if (travel > 0.5) {
      const ux = dx / travel, uy = dy / travel;
      for (const x of series) {
        const along = (x.e.cx - from.cx) * ux + (x.e.cy - from.cy) * uy;
        overshoot = Math.max(overshoot, along - travel);
        if (t95 == null && along >= travel * 0.95) t95 = x.t;
      }
      for (let i = 1; i < series.length; i++) {
        const v = Math.hypot(series[i].e.cx - series[i - 1].e.cx, series[i].e.cy - series[i - 1].e.cy) / ((series[i].t - series[i - 1].t) / 1000);
        peak = Math.max(peak, v);
      }
    }
    const scaleSeries = series.map(x => x.e.w);
    // At rest: from here on within half a pixel and 1% opacity of where it ends.
    const near = (e) => Math.abs(e.cx - end.cx) <= 0.5 && Math.abs(e.cy - end.cy) <= 0.5 && Math.abs(e.w - end.w) <= 0.5 && Math.abs(e.op - end.op) <= 0.01;
    let rest = null;
    for (let i = series.length - 1; i >= 0 && near(series[i].e); i--) rest = series[i].t;
    let textAt = null;
    if (end.text != null) {
      const t0 = before ? before.text : null;
      const hit = series.find(x => x.e.text !== t0);
      textAt = hit ? hit.t : null;
    }
    elements[id] = {
      appeared: !before, firstVisibleMs: firstVisible ? firstVisible.t : null,
      motionStartMs: start, settledMs: settle, restMs: rest,
      ...(end.text != null ? { textBefore: before ? before.text : null, textAfter: end.text, textChangedMs: textAt } : {}),
      from: pick(from), to: pick(end), travelPx: +travel.toFixed(2),
      overshootPx: +overshoot.toFixed(2), overshootPct: travel > 0.5 ? +(overshoot / travel * 100).toFixed(1) : 0,
      t95Ms: t95, peakSpeedPxPerS: Math.round(peak),
      widthRange: [Math.min(...scaleSeries), Math.max(...scaleSeries)].map(v => +v.toFixed(2)),
      opacityRange: [Math.min(...series.map(x => x.e.op)), Math.max(...series.map(x => x.e.op))],
      goneBeforeEnd: !final.els[id],
    };
  }
  const anims = inventory.filter(a => !a.predates);
  const nonCompositor = [...new Set(anims.flatMap(a => a.props.filter(p => !COMPOSITOR.has(p)).map(p => p + ' (' + (a.name || a.kind) + ')')))];
  const moving = Object.values(elements).filter(e => e.settledMs != null);
  const lead = LEAD * 1000 / FPS;
  return {
    // The last frame on which anything moved by more than 0.1px (or 0.2% opacity) frame-to-frame,
    // and the moment everything is within 0.5px / 1% of where it ends. Both from the press.
    visualSettleMs: moving.length ? Math.max(...moving.map(e => e.settledMs)) : 0,
    visualRestMs: Math.max(0, ...Object.values(elements).map(e => e.restMs || 0)),
    animationsStarted: anims.map(a => `${a.kind} ${a.name || '(unnamed)'} on ${a.target}: ${a.duration}ms + ${a.delay}ms delay, born ${+(a.born - lead).toFixed(1)}ms, ${a.ended || 'still running'}${a.died != null ? ' ' + +(a.died - a.born).toFixed(1) + 'ms later' : ''}`),
    nonCompositorProps: nonCompositor,
    elements,
  };
}
const pick = (e) => e && ({ cx: e.cx, cy: e.cy, w: e.w, op: e.op, ...(e.s != null ? { s: e.s, rot: e.rot } : {}) });

// ── Realtime mode ───────────────────────────────────────────────────────────────────────────────
// Headless WebKit on Windows is not a timing reference: after a step it stops servicing
// requestAnimationFrame for most of a second while timers keep running (measured: one frame at
// +8ms, the next at +784ms), so jank numbers come from Chromium (--engine msedge), throttled.
async function realtimeMoment(browser, seats, moment, rep) {
  const { ctx, page } = await openHand(browser, seats, { clock: false });
  try {
    await stepTo(page, pressesBefore(HANDS[seats], moment));
    let cdp = null;
    if (ENGINE !== 'webkit' && THROTTLE > 1) {
      cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      await sleep(300);
    }
    await page.evaluate((sample) => {
      const rt = window.__rt = { frames: [], loaf: [], longtask: [], click: null };
      const ob = (type) => {
        try {
          new PerformanceObserver(l => l.getEntries().forEach(e => {
            const end = e.startTime + e.duration;
            rt[type === 'long-animation-frame' ? 'loaf' : 'longtask'].push({
              start: e.startTime, dur: e.duration, block: e.blockingDuration,
              renderMs: e.renderStart ? end - e.renderStart : undefined,
              styleLayoutMs: e.styleAndLayoutStart ? end - e.styleAndLayoutStart : undefined,
              scriptMs: e.scripts ? e.scripts.reduce((n, x) => n + x.duration, 0) : undefined,
            });
          })).observe({ type, buffered: false });
        } catch (e) { rt[type + 'Unsupported'] = true; }
      };
      ob('long-animation-frame'); ob('longtask');
      document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button[title="Forward"]')) rt.click = performance.now(); }, true);
      const table = document.querySelector('.replayer-table');
      const t0 = performance.now();
      const loop = (ts) => {
        const rec = { ts };
        if (sample) {
          // What is on screen this frame: the board cards, the flying chips and what is animating.
          rec.board = [...table.querySelectorAll('.replayer-board-area:not(.replayer-dead-area) .card-row > [data-slot]')].map(el => {
            const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
            return [el.dataset.slot, +cs.opacity, cs.transform === 'none' ? null : cs.transform.slice(0, 60), +(r.left + r.width / 2).toFixed(1)];
          });
          rec.fly = table.querySelectorAll('.replayer-flying-chip').length;
          rec.anims = document.getAnimations().filter(a => a.playState === 'running').map(a => a.animationName || a.transitionProperty || 'waapi');
        }
        rt.frames.push(rec);
        if (ts - t0 < 2600) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }, SAMPLE);
    await sleep(600);
    await page.click('button[title="Forward"]', { noWaitAfter: true });
    await sleep(2300);
    const rt = await page.evaluate(() => window.__rt);
    if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const stats = (frames) => {
      const iv = frames.slice(1).map((fr, i) => fr.ts - frames[i].ts);
      const sorted = [...iv].sort((x, y) => x - y);
      const q = (p) => (sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1) : null);
      return {
        frames: frames.length, medianMs: q(0.5), p95Ms: q(0.95), maxMs: q(1),
        over25: iv.filter(x => x > 25).length, over50: iv.filter(x => x > 50).length,
        dropped: iv.reduce((n, x) => n + Math.max(0, Math.round(x / (1000 / 60)) - 1), 0),
      };
    };
    const idle = rt.frames.filter(fr => fr.ts < rt.click - 1 && fr.ts >= rt.click - 500);
    const after = rt.frames.filter(fr => fr.ts >= rt.click - 1);
    const win = after.filter(fr => fr.ts - rt.click <= 1500);
    const r1 = (x) => (x == null ? undefined : +x.toFixed(1));
    return {
      clip: clipName(moment, seats), engine: ENGINE, throttle: THROTTLE, rep,
      inputToNextFrameMs: after.length ? +(after[0].ts - rt.click).toFixed(1) : null,
      idle500: stats(idle), after1500: stats(win),
      loafSupported: !rt['long-animation-frameUnsupported'],
      loaf: rt.loaf.filter(e => e.start + e.dur >= rt.click - 5 && e.start <= rt.click + 1500)
        .map(e => ({ at: r1(e.start - rt.click), dur: r1(e.dur), block: r1(e.block), scriptMs: r1(e.scriptMs), styleLayoutMs: r1(e.styleLayoutMs), renderMs: r1(e.renderMs) })),
      longtask: rt.longtask.filter(e => e.start >= rt.click - 5 && e.start <= rt.click + 1500).map(e => ({ at: r1(e.start - rt.click), dur: r1(e.dur) })),
      ...(SAMPLE ? {
        // The first frames after the press as painted: [slot, opacity, transform, centre x].
        firstFrames: after.slice(0, 6).map(fr => ({ t: +(fr.ts - rt.click).toFixed(1), board: fr.board, fly: fr.fly, anims: fr.anims })),
        animsSeen: [...new Set(win.flatMap(fr => fr.anims))],
      } : {}),
    };
  } finally {
    await ctx.close();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────────────────────────
// Frame mode is bound by WebKit's screenshot (about 1.5s a frame at 3x on the Windows box, whatever
// the format), so clips run in parallel, one browser per worker; the result does not depend on it,
// because time is virtual. Realtime mode always runs one at a time — its numbers ARE the timing.
fs.mkdirSync(OUT, { recursive: true });
for (const seats of SEATS) if (!HANDS[seats]) throw new Error('no hand for ' + seats + '-max (6, 8 or 9)');
if (args.includes('--encode-only')) {
  // Re-encode clips whose frames were kept (--keep-frames, or a failed encode).
  for (const seats of SEATS) for (const moment of MOMENTS) {
    const name = clipName(moment, seats), dir = path.join(OUT, 'frames', name);
    if (!fs.existsSync(dir)) continue;
    if (encode(dir, name) && !KEEP) fs.rmSync(dir, { recursive: true, force: true });
    console.log('encoded', name);
  }
  process.exit(0);
}
const tasks = SEATS.flatMap(seats => MOMENTS.flatMap(moment =>
  Array.from({ length: REALTIME ? REPEAT : 1 }, (_, rep) => ({ seats, moment, rep }))));
const PARALLEL = REALTIME ? 1 : Math.max(1, Number(opt('--parallel', 1)));
const results = [];
const launch = () => (ENGINE === 'webkit' ? webkit.launch() : chromium.launch({ channel: ENGINE }));
await Promise.all(Array.from({ length: Math.min(PARALLEL, tasks.length) }, async () => {
  const browser = await launch();
  try {
    for (let task; (task = tasks.shift());) {
      const { seats, moment, rep } = task;
      if (REALTIME) {
        const r = await realtimeMoment(browser, seats, moment, rep);
        results.push(r);
        const a = r.after1500, i = r.idle500;
        console.log(`${r.clip} [${ENGINE} x${THROTTLE}] after press: ${a.frames} frames, median ${a.medianMs}ms, p95 ${a.p95Ms}ms, max ${a.maxMs}ms, >25ms ${a.over25}, dropped ${a.dropped}; idle: max ${i.maxMs}ms, dropped ${i.dropped}; input->frame ${r.inputToNextFrameMs}ms; LoAF ${r.loaf.map(e => e.dur).join('/') || '-'}`);
      } else {
        const r = await captureMoment(browser, seats, moment);
        console.log(`${r.clip}: ${r.capturedFrames} frames, settles ${r.summary.visualSettleMs}ms, rests ${r.summary.visualRestMs}ms, ${r.animations.length} animations (${r.wallSeconds}s)`);
        results.push({ clip: r.clip, summary: r.summary });
      }
    }
  } finally {
    await browser.close();
  }
}));
results.sort((a, b) => (a.clip < b.clip ? -1 : a.clip > b.clip ? 1 : (a.rep || 0) - (b.rep || 0)));
const tag = REALTIME ? `realtime-${ENGINE}-x${THROTTLE}-${W}x${H}` : `summary-${W}x${H}`;
fs.writeFileSync(path.join(OUT, tag + '.json'), JSON.stringify(results, null, 1));
console.log('wrote', path.join(OUT, tag + '.json'));
