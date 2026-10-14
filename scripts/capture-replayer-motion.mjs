// Frame-accurate capture of the replayer's motion: the flop deal and spread, the turn and river
// landing (and the board shifting to make room), a wager going in (the hero's bet from the bottom
// seat, and the first answer from another seat), and the pot pushed to the winner. The street's
// wagers being swept into the pot happens on the flop, turn and river presses. Built to compare
// today's curves against spring-driven ones by NUMBERS as well as by eye, so every clip writes a
// measurement file next to its video.
//
//   node scripts/capture-replayer-motion.mjs [baseUrl] [--seats 6,8,9] [--moments flop,turn,river,bet,call,push]
//        [--width 402] [--height 874] [--dpr 3] [--out dir] [--springs 0|1|2] [--format png|jpeg]
//        [--keep-frames] [--no-video] [--parallel 4] [--encode-only]
//   node scripts/capture-replayer-motion.mjs [baseUrl] --realtime [--engine msedge|webkit]
//        [--throttle 4] [--repeat 3] [--sample] [--seats ...] [--moments ...] [--out dir]
//   node scripts/capture-replayer-motion.mjs [baseUrl] --export-probe [--seats ...] [--moments ...]
//   node scripts/capture-replayer-motion.mjs --resummarise [--width 402] [--height 874] [--out dir]
//   node scripts/capture-replayer-motion.mjs --report [--out dir] [--against baselineDir]
//
//   baseUrl   a SCRATCH server running this checkout (never the pm2 app on :3001 for an unmerged
//             build). Default http://127.0.0.1:3241. A guest session is used: POST /api/guest-login.
//   --springs sets localStorage.replayerSprings ('0' today's paths, '1' Set A, '2' Set B) before the
//             app boots, so a before/after pair comes from the same build. Omitted, the key is left
//             unset (the build's own default).
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
//              (px and % of travel), time to 95% of travel, peak speed, and its curves (progress along
//              the travel, opacity, scale, per frame); and every animated property that is not
//              transform or opacity (layout or paint work on every frame). summary-<w>x<h>.json indexes
//              every clip at that viewport (without the curves); --resummarise recomputes the numbers
//              from the frames already measured.
//
// Realtime mode (--realtime) does not pause anything: it presses Forward with a real (trusted) click
// and records every requestAnimationFrame for 1.8s, plus long-animation-frame / longtask entries
// where the engine has them. On msedge (Chromium) --throttle N applies a CDP CPU throttle, the usual
// stand-in for an old phone. --sample also reads the board cards on every frame (off by default: it
// costs frame time), which is how a CSS animation cancelled after a single painted frame shows up.
//
// Export probe (--export-probe): what the GIF and video exporters put in their ONE still per step —
// the table marked [data-capturing] as beginCapture() marks it, Forward pressed, the step committed
// and 120ms of (virtual) timers run, then the computed state (which is what modern-screenshot
// serialises) and a screenshot of the table alone. Writes export-probe-<w>x<h>.json and the stills.
//
// Report (--report): prints the numbers of every clip in --out and every realtime run there; with
// --against <dir>, each number is followed by the same clip's number from that directory in
// brackets, so a spring capture reads straight against the baseline.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
const FFPROBE = /[\\/]/.test(FFMPEG) ? path.join(path.dirname(FFMPEG), path.basename(FFMPEG).replace(/ffmpeg/, 'ffprobe')) : 'ffprobe';
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
  if (moment === 'call') {  // the first flop wager from ANOTHER seat (the bet is the hero's, at the bottom)
    const k = acts[1].findIndex(a => /^\d+[br]\d/.test(a));
    const who = parseInt(acts[1][k], 10);
    const k2 = acts[1].findIndex((a, i) => i > k && /^\d+[brc]\d/.test(a) && parseInt(a, 10) !== who);
    return toStreet(1) + k2;
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
    // getKeyframes() names properties in camelCase; a transition's own name is the CSS one.
    const tp = a.transitionProperty && a.transitionProperty.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    if (kind === 'CSSTransition' && tp && !props.includes(tp)) props.push(tp);
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
    // The spring path's chips leave one by one, so they carry their own index (data-fly);
    // today's leave all at once and are named by position.
    table.querySelectorAll('.replayer-flying-chip').forEach((el, i) => {
      els['fly' + (el.dataset.fly != null ? el.dataset.fly : i) + (el.classList.contains('to-winner') ? '-winner' : '')] = box(el);
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
    // The first-run "Where do you play?" wizard (App.jsx, hasOnboarded() in location-prefs.js)
    // opens over the replay on a fresh profile; at 1440 wide it arrived after the Skip below.
    localStorage.setItem('onboarded', '1');
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
  // Nothing may sit over the felt: a clip of a dialog is worse than no clip.
  const cover = await page.evaluate(() => {
    const t = document.querySelector('.replayer-table');
    const r = t.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && !t.contains(hit) ? (hit.tagName.toLowerCase() + '.' + [...hit.classList].join('.')) : null;
  });
  if (cover) throw new Error(`something covers the table at ${W}x${H}: ${cover}`);
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
  /* ...but the document timeline is the page's rendering clock, not the wall clock: a 1440-wide
     page at 3x beside a few other WebKits can still be mid-flop after 1.5s, and the clip then shows
     the last step's tail as if the moment had made it. Wait until nothing finite is still running. */
  for (let i = 0; i < 60; i++) {
    const busy = await page.evaluate(() => document.getAnimations().some(a => {
      if (a.playState !== 'running') return false;
      try { return Number.isFinite(a.effect.getComputedTiming().endTime); } catch (e) { return false; }
    }));
    if (!busy) return;
    await sleep(250);
  }
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
      /* Time is virtual, so a slow screenshot changes nothing in the clip — only Playwright's 30s
         default can kill it: a 1440-wide frame at 3x took over 30s on a box running nine WebKits. */
      const buf = await page.screenshot({ clip, type: FORMAT, timeout: 180000, ...(FORMAT === 'jpeg' ? { quality: 95 } : {}) });
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
  /* Checked, not trusted: two clips captured while the box was short of memory came out of ffmpeg
     with exit 0 and a third of their frames missing (45 of 67, 41 of 67). Every video must hold
     exactly one frame per captured frame (four for the quarter-speed one), or the frames are kept
     and the clip is reported as failed. */
  const want = fs.readdirSync(frameDir).filter(n => /^f\d{4}\.(png|jpg)$/.test(n)).length;
  const count = (file) => Number(String(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file])).trim().replace(/,$/, ''));
  try {
    for (let attempt = 1; ; attempt++) {
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', input, '-vf', scale, ...common, path.join(OUT, name + '.mp4')]);
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS / 4), '-i', input, '-vf', scale + ',fps=' + FPS, ...common, path.join(OUT, name + '-slow4x.mp4')]);
      const got = [count(path.join(OUT, name + '.mp4')), count(path.join(OUT, name + '-slow4x.mp4'))];
      if (got[0] === want && got[1] === want * 4) return true;
      if (attempt >= 2) throw new Error(`videos hold ${got.join(' and ')} frames, not ${want} and ${want * 4}`);
    }
  } catch (e) {
    console.log(`  encode failed for ${name} (frames kept in ${frameDir}): ${String(e.stderr || e.message || e).trim().split(/\r?\n/)[0]}`);
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
    let overshoot = 0, t95 = null, peak = 0, curve = null;
    if (travel > 0.5) {
      const ux = dx / travel, uy = dy / travel;
      curve = [];
      for (const x of series) {
        const along = (x.e.cx - from.cx) * ux + (x.e.cy - from.cy) * uy;
        overshoot = Math.max(overshoot, along - travel);
        if (t95 == null && along >= travel * 0.95) t95 = x.t;
        curve.push([x.t, +(along / travel).toFixed(4)]);
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
      /* The curves, trimmed to the frames where something happens, for laying a spring over the
         baseline: progress along the travel (0 = where it was, 1 = where it rests; above 1 is
         overshoot), effective opacity, and the transform's scale. */
      ...(curve && start != null ? { progressCurve: trimCurve(curve, start, settle) } : {}),
      ...(new Set(series.map(x => x.e.op)).size > 1 ? { opacityCurve: trimCurve(series.map(x => [x.t, x.e.op]), start, settle) } : {}),
      ...(new Set(series.map(x => x.e.s == null ? 1 : x.e.s)).size > 1 ? { scaleCurve: trimCurve(series.map(x => [x.t, x.e.s == null ? 1 : x.e.s]), start, settle) } : {}),
    };
  }
  const anims = inventory.filter(a => !a.predates);
  const camel = (p) => p.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
  const nonCompositor = [...new Set(anims.flatMap(a => [...new Set(a.props.map(camel))].filter(p => !COMPOSITOR.has(p)).map(p => p + ' (' + (a.name || a.kind) + ')')))];
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
// [t, value] pairs from one frame before the motion starts to one frame after it settles.
const trimCurve = (c, start, settle) => (start == null ? c : c.filter(([t]) => t >= start - 17 && t <= (settle == null ? Infinity : settle + 17)));

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
    // How busy the whole machine was while measuring: frame times on a box whose CPUs are taken by
    // something else (a solver grind, other browsers) are that box's numbers, not the app's.
    const cpuTimes = () => os.cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { busy: 0, all: 0 });
    const c0 = cpuTimes();
    await sleep(600);
    await page.click('button[title="Forward"]', { noWaitAfter: true });
    await sleep(2300);
    const c1 = cpuTimes();
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
      machineCpuBusyPct: +((c1.busy - c0.busy) / Math.max(1, c1.all - c0.all) * 100).toFixed(1),
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

// ── Export probe ────────────────────────────────────────────────────────────────────────────────
// What the GIF/video exporters put in their one still per step. Both call beginCapture() (padding,
// [data-capturing], which pauses every CSS animation at its start and kills transitions), press
// Forward, wait 120ms of real time and serialise the table with modern-screenshot — which inlines
// each element's COMPUTED style. So the computed state 120ms after the press is the exported frame.
// The table is marked before the press, as it is for the whole of a real export, because the flop
// deal and the board FLIP check [data-capturing] when they start. Writes the still and the numbers.
async function exportProbe(browser, seats, moment) {
  const name = clipName(moment, seats);
  const { ctx, page } = await openHand(browser, seats, { clock: true });
  try {
    await stepTo(page, pressesBefore(HANDS[seats], moment));
    /* The exporters' 120ms is wall-clock, so on a loaded machine (or a slow phone) React may not
       have committed the step by then — measured here: a push still with no chips one run and five
       the next. The probe takes the INTENDED case: the clock stops, the step commits in full (its
       render, effects and the renders they cause), then 120ms of timers run. */
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 50);
    await page.evaluate(() => window.__hops());
    await page.evaluate(() => {
      const t = document.querySelector('.replayer-table');
      t.style.paddingTop = '50px'; t.style.marginTop = '0px';     // beginCapture()
      t.setAttribute('data-capturing', '1');
      // beginCapture() also puts the spring registry (when the build has one) into capture mode:
      // springs are created paused and their arrivals wait.
      if (t.__replayerMotion) t.__replayerMotion.setCapture(true, { rate: 1 });
    });
    await page.clock.runFor(60);
    await page.evaluate(() => window.__hops());
    const before = await page.evaluate(() => window.__measure());
    await page.evaluate(() => document.querySelector('button[title="Forward"]').click());
    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__hops()); await page.clock.runFor(20); }
    await page.evaluate(() => window.__hops());
    // The settled still captureStepFrames() takes: every spring finished, ghosts gone, ticks landed.
    await page.evaluate(() => { const m = document.querySelector('.replayer-table').__replayerMotion; if (m) m.finishAll(); });
    await page.evaluate(() => window.__hops());
    const at = await page.evaluate(() => ({
      ...window.__measure(),
      anims: document.getAnimations().map(a => ({
        name: a.animationName || a.transitionProperty || 'WebAnimation',
        target: a.effect && a.effect.target ? a.effect.target.className.toString().slice(0, 60) : null,
        playState: a.playState, currentTime: a.currentTime == null ? null : Math.round(a.currentTime),
      })),
    }));
    const T = at.table;
    // The exporters draw the table element alone (domToCanvas(tableEl)): hide the page around it.
    await page.evaluate(() => {
      const t = document.querySelector('.replayer-table');
      for (const el of document.body.querySelectorAll('*')) if (!el.contains(t) && !t.contains(el)) el.style.visibility = 'hidden';
    });
    await page.screenshot({ path: path.join(OUT, `export-${name}.png`), clip: { x: Math.max(0, T[0]), y: Math.max(0, T[1]), width: Math.min(W, T[2]), height: Math.min(H - Math.max(0, T[1]), T[3]) } });
    return { clip: name, before: before.els, at120ms: at.els, anims: at.anims };
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
// Every clip's own .json at this viewport. The index (summary-<w>x<h>.json) is rebuilt from them,
// so runs of single clips, or several runs at once, always leave a complete one; the curves stay in
// the clip files.
const clipFiles = () => {
  const re = new RegExp('^(flop|turn|river|bet|call|push)-[0-9]+max-' + W + 'x' + H + '[.]json$');
  return fs.readdirSync(OUT).filter(n => re.test(n)).sort().map(n => path.join(OUT, n));
};
function writeIndex() {
  const strip = ({ progressCurve, opacityCurve, scaleCurve, ...rest }) => rest;
  const index = clipFiles().map(file => {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const elements = Object.fromEntries(Object.entries(j.summary.elements).map(([k, v]) => [k, strip(v)]));
    return { clip: j.clip, springs: j.springs, capturedFrames: j.capturedFrames, summary: { ...j.summary, elements } };
  });
  fs.writeFileSync(path.join(OUT, `summary-${W}x${H}.json`), JSON.stringify(index, null, 1));
  console.log('wrote', path.join(OUT, `summary-${W}x${H}.json`), '(' + index.length + ' clips)');
}
if (args.includes('--resummarise')) {
  // Recompute every clip's numbers from the frames it already measured (after a change to summarise).
  for (const file of clipFiles()) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    j.summary = summarise(j.frames, j.animations);
    const { frames, ...head } = j;
    fs.writeFileSync(file, JSON.stringify({ ...head, frames }, null, 1));
    console.log('resummarised', j.clip);
  }
  writeIndex();
  process.exit(0);
}
if (args.includes('--report')) {
  /* The numbers of every clip in --out, one line per moving element, and with --against <dir> the
     same clip's numbers from that directory in brackets — the before/after table for a spring. */
  const AGAINST = opt('--against', null);
  const load = (dir) => {
    const m = new Map();
    if (!dir || !fs.existsSync(dir)) return m;
    for (const n of fs.readdirSync(dir).filter(n => /^(flop|turn|river|bet|call|push)-\d+max-\d+x\d+\.json$/.test(n)).sort()) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      m.set(j.clip, j);
    }
    return m;
  };
  const cur = load(OUT), base = load(AGAINST && path.resolve(AGAINST));
  const metrics = (e) => (!e || e.gone ? null : {
    appears: e.appeared ? e.firstVisibleMs : null, travel: e.travelPx > 0.5 ? e.travelPx : null,
    t95: e.t95Ms, rest: e.restMs, lastMove: e.settledMs, overshoot: e.overshootPct || null,
    peak: e.peakSpeedPxPerS || null,
    op: e.opacityRange && e.opacityRange[0] !== e.opacityRange[1] ? e.opacityRange.map(v => +v.toFixed(2)).join('..') : null,
    w: e.widthRange && e.widthRange[0] !== e.widthRange[1] ? e.widthRange.join('..') : null,
    text: e.textChangedMs != null ? `'${e.textAfter}'@${e.textChangedMs}` : null,
  });
  const UNIT = { appears: 'ms', travel: 'px', t95: 'ms', rest: 'ms', lastMove: 'ms', overshoot: '%', peak: 'px/s' };
  for (const [clip, j] of cur) {
    const b = base.get(clip);
    const s = j.summary, bs = b && b.summary;
    const vs = (x, y) => (b ? `${x} [${y}]` : `${x}`);
    console.log(`\n${clip}${j.springs != null ? ' springs=' + j.springs : ''}: last motion ${vs(s.visualSettleMs, bs && bs.visualSettleMs)}ms, at rest ${vs(s.visualRestMs, bs && bs.visualRestMs)}ms`
      + (s.nonCompositorProps.length ? ` | non-compositor: ${s.nonCompositorProps.join(', ')}` : ''));
    for (const [id, e] of Object.entries(s.elements)) {
      const m = metrics(e), bm = bs ? metrics(bs.elements[id]) : null;
      if (!m) { console.log(`  ${id}: removed at the press`); continue; }
      if (m.lastMove == null && m.appears == null && m.text == null) continue;
      const bits = Object.entries(m).filter(([k, v]) => v != null || (bm && bm[k] != null))
        .map(([k, v]) => `${k} ${v == null ? '-' : v}${UNIT[k] && v != null ? UNIT[k] : ''}${bm ? ` [${bm[k] == null ? '-' : bm[k]}]` : ''}`);
      console.log(`  ${id}: ${bits.join(', ')}`);
    }
  }
  // Realtime runs in the same directory: per clip, every rep.
  for (const f of fs.readdirSync(OUT).filter(f => /^realtime-.*\.json$/.test(f)).sort()) {
    const rows = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
    console.log(`\n${f}: per clip, one value per rep`);
    const by = {};
    for (const r of rows) (by[r.clip] = by[r.clip] || []).push(r);
    for (const [clip, rs] of Object.entries(by)) {
      const col = (fn) => rs.map(fn).join('/');
      console.log(`  ${clip}: dropped ${col(r => r.after1500.dropped)} | max frame ${col(r => r.after1500.maxMs)}ms | >25ms ${col(r => r.after1500.over25)}`
        + ` | input->frame ${col(r => r.inputToNextFrameMs)}ms | LoAF ${rs.map(r => r.loaf.map(e => `${e.dur}@${e.at}(script ${e.scriptMs}, style+layout ${e.styleLayoutMs})`).join(' + ') || '-').join(' / ')}`
        + ` | machine CPU ${col(r => r.machineCpuBusyPct)}%`);
    }
  }
  process.exit(0);
}
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
const EXPORT = args.includes('--export-probe');
const tasks = SEATS.flatMap(seats => MOMENTS.flatMap(moment =>
  Array.from({ length: REALTIME ? REPEAT : 1 }, (_, rep) => ({ seats, moment, rep }))));
const PARALLEL = REALTIME ? 1 : Math.max(1, Number(opt('--parallel', 1)));
const results = [];
const failed = [];
const launch = () => (ENGINE === 'webkit' ? webkit.launch() : chromium.launch({ channel: ENGINE }));
await Promise.all(Array.from({ length: Math.min(PARALLEL, tasks.length) }, async () => {
  const browser = await launch();
  try {
    for (let task; (task = tasks.shift());) {
      const { seats, moment, rep } = task;
      // One clip failing (a dialog over the felt, an encode out of memory) costs that clip only.
      try {
        if (REALTIME) {
          const r = await realtimeMoment(browser, seats, moment, rep);
          results.push(r);
          const a = r.after1500, i = r.idle500;
          console.log(`${r.clip} [${ENGINE} x${THROTTLE}] after press: ${a.frames} frames, median ${a.medianMs}ms, p95 ${a.p95Ms}ms, max ${a.maxMs}ms, >25ms ${a.over25}, dropped ${a.dropped}; idle: max ${i.maxMs}ms, dropped ${i.dropped}; input->frame ${r.inputToNextFrameMs}ms; LoAF ${r.loaf.map(e => e.dur).join('/') || '-'}; machine CPU ${r.machineCpuBusyPct}%`);
        } else if (EXPORT) {
          const r = await exportProbe(browser, seats, moment);
          results.push(r);
          console.log(`${r.clip} [export still at +120ms]: ${r.anims.length} animations, ${Object.keys(r.at120ms).length} measured elements`);
        } else {
          const r = await captureMoment(browser, seats, moment);
          console.log(`${r.clip}: ${r.capturedFrames} frames, settles ${r.summary.visualSettleMs}ms, rests ${r.summary.visualRestMs}ms, ${r.animations.length} animations (${r.wallSeconds}s)`);
        }
      } catch (e) {
        failed.push(clipName(moment, seats) + (REALTIME ? '#' + rep : ''));
        console.log(`FAILED ${clipName(moment, seats)}: ${String((e && e.message) || e).split(/\r?\n/)[0]}`);
      }
    }
  } finally {
    await browser.close();
  }
}));
if (REALTIME || EXPORT) {
  // Merged into what earlier runs into the same directory wrote, so a re-run of one clip keeps the rest.
  const tag = REALTIME ? `realtime-${ENGINE}-x${THROTTLE}-${W}x${H}` : `export-probe-${W}x${H}`;
  const key = (r) => r.clip + '#' + (r.rep || 0);
  let merged = [];
  try { merged = JSON.parse(fs.readFileSync(path.join(OUT, tag + '.json'), 'utf8')); } catch (e) { /* first run */ }
  const fresh = new Set(results.map(key));
  merged = merged.filter(r => !fresh.has(key(r))).concat(results);
  merged.sort((a, b) => (a.clip < b.clip ? -1 : a.clip > b.clip ? 1 : (a.rep || 0) - (b.rep || 0)));
  fs.writeFileSync(path.join(OUT, tag + '.json'), JSON.stringify(merged, null, 1));
  console.log('wrote', path.join(OUT, tag + '.json'));
} else {
  writeIndex();
}
if (failed.length) { console.log('failed:', failed.join(', ')); process.exitCode = 1; }
