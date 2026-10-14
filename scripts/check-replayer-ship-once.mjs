// One result press, one ship. The pot is shipped to the winner two frames after the result press
// (where it lands, then the chips), and Back then Forward inside that wait came back to the same step
// with the same step key: the first press's ship was built as well as the second's, ten chips on the
// felt at once (round 3's review, 2026-10-13). The deferred work now belongs to its moment's
// generation (MotionRegistry.defer); this guards it.
//
//   node scripts/check-replayer-ship-once.mjs [baseUrl] [--engine msedge|webkit] [--throttle 4]
//        [--springs 0|1|2] [--trials 12]
//
// The 8-max hand, 402x874. Each trial: End, Back (the river's last action), then the result pressed,
// Back after g1 ms, Forward after g2 more (g1 0-240, g2 0-200, every pairing), every shipped chip and
// ship clip counted every 3ms. Passes when no trial ever has more than one ship's chips on the table
// (the pile's own chips: five at most) and no more than one ship is launched after the Back; the
// winner's stack must end at its award. msedge takes a CDP CPU throttle (default 4x, the stand-in for
// an old phone); WebKit runs unthrottled. baseUrl is a SCRATCH server running this checkout (never
// the pm2 app on :3001 for an unmerged build). Exits non-zero on a failure.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { webkit, chromium } = require('../vite-app/node_modules/playwright');

const args = process.argv.slice(2);
const opt = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : d; };
const BASE = (args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:3241').replace(/\/$/, '');
const ENGINE = opt('--engine', 'msedge');
const THROTTLE = Number(opt('--throttle', ENGINE === 'msedge' ? 4 : 1));
const SPRINGS = opt('--springs', null);
const TRIALS = Number(opt('--trials', 12));
const H8 = 'N85.1000-2000~120000,95000,150000,80000,70000,210000,64000,110000.AsKc,-,-,QhQd,-,-,-,-/bKh7d2c/b9s/bAh.'
  + '0f,1f,2r5000,3f,4f,5r15000,6f,7f,2c15000/2x,5b12000,2c12000/2x,5b30000,2c30000/2b40000,5c40000.w5';
const G1 = [0, 40, 120, 240], G2 = [0, 60, 200];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const guest = await (await fetch(BASE + '/api/guest-login', { method: 'POST' })).json();
if (!guest.token) throw new Error('guest login failed at ' + BASE);
const browser = ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });
await ctx.addInitScript(({ tok, springs }) => {
  localStorage.setItem('token', tok);
  localStorage.setItem('onboardComplete', '1');
  localStorage.setItem('hasOnboarded', 'true');
  localStorage.setItem('onboarded', '1');
  if (springs != null) localStorage.setItem('replayerSprings', springs); else localStorage.removeItem('replayerSprings');
}, { tok: guest.token, springs: SPRINGS });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
await page.goto(BASE + '/#h/' + encodeURIComponent(H8), { waitUntil: 'domcontentloaded' });
await page.waitForSelector('button[title="Forward"]', { timeout: 40000 });
await sleep(3000);
await page.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 800 }).catch(() => {});
if (ENGINE !== 'webkit' && THROTTLE > 1) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
}
// Every ship launched: the registry records its last result's landings (motion.lastResult).
await page.evaluate(() => {
  const m = document.querySelector('.replayer-table').__replayerMotion;
  let v = null; window.__launches = [];
  Object.defineProperty(m, 'lastResult', { get() { return v; }, set(x) { v = x; if (x) window.__launches.push(performance.now()); }, configurable: true });
});
const idle = async () => {
  for (let i = 0; i < 80; i++) {
    const n = await page.evaluate(() => document.getAnimations().filter(a => { try { return a.playState === 'running' && Number.isFinite(a.effect.getComputedTiming().endTime); } catch (e) { return false; } }).length);
    if (!n) return;
    await sleep(100);
  }
};
const fails = [];
let most = 0, mostLaunched = 0;
for (let i = 0; i < TRIALS; i++) {
  const g1 = G1[i % G1.length], g2 = G2[Math.floor(i / G1.length) % G2.length];
  await page.evaluate(() => document.querySelector('button[title="End"]').click());
  await sleep(1000);
  await page.evaluate(() => document.querySelector('button[title="Back"]').click());
  await sleep(500); await idle(); await sleep(200);
  const r = await page.evaluate(async ([g1, g2]) => {
    window.__launches = [];
    const t = document.querySelector('.replayer-table');
    let chips = 0, clips = 0;
    const iv = setInterval(() => {
      chips = Math.max(chips, t.querySelectorAll('.replayer-flying-chip.to-winner').length);
      clips = Math.max(clips, t.querySelectorAll('.replayer-ship-clip').length);
    }, 3);
    const t0 = performance.now();
    document.querySelector('button[title="Forward"]').click();
    await new Promise(r => setTimeout(r, g1));
    const back = performance.now() - t0;
    document.querySelector('button[title="Back"]').click();
    await new Promise(r => setTimeout(r, g2));
    document.querySelector('button[title="Forward"]').click();
    await new Promise(r => setTimeout(r, 2500));
    clearInterval(iv);
    const winner = t.querySelector('.replayer-seat.winner .replayer-seat-stack');
    return { back: Math.round(back), launches: window.__launches.map(x => Math.round(x - t0)), chips, clips, stack: winner && winner.textContent };
  }, [g1, g2]);
  const after = r.launches.filter(x => x > r.back).length;
  most = Math.max(most, r.chips); mostLaunched = Math.max(mostLaunched, after);
  const bad = r.chips > 5 || r.clips > 1 || after > 1 || r.stack !== '310K';
  if (bad) fails.push({ g1, g2, ...r });
  console.log(`g1 ${g1} g2 ${g2}: Back at ${r.back}ms, ships launched at ${r.launches.join(', ') || 'none'}ms, most chips at once ${r.chips}, clips ${r.clips}, the winner's stack ${r.stack}${bad ? '  FAIL' : ''}`);
}
await browser.close();
console.log(`${ENGINE}${ENGINE !== 'webkit' ? ' at ' + THROTTLE + 'x' : ''}: ${TRIALS} trials, most shipped chips at once ${most}, most ships after the Back ${mostLaunched}, page errors ${errors.length}`);
if (fails.length || errors.length) { console.log('FAIL', JSON.stringify(fails).slice(0, 600), errors.slice(0, 3)); process.exitCode = 1; }
else console.log('PASS: one ship per result press');
