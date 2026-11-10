// The felt against the oracle: hands PokerKit played (test/replayer-oracle/generate.py, settled to TDA rules)
// saved through the API, opened from the Hands list in WebKit, taken to the End, and every seat's stack read off
// the felt and held to the oracle's final stack, to the cent. Every --share-every'th hand is also shared, and its
// link opened signed out (the share link carries the hand in another encoding), and must end the same.
//
//   node scripts/check-replayer-oracle.mjs [--corpus test/replayer-oracle/corpus.jsonl] [--per-game 20]
//        [--games "NLH,Razz"] [--jobs 3] [--width 402] [--height 874] [--share-every 10] [--ids "NLH#3,Razz#9"]
//        [--build public-vite-check]
//
// Boots its own scratch server (test/helpers/scratch-server.js, ports 4840-4849) on a scratch database and
// stops it at the end. Needs the built app (vite-app: npm run build).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
const { createScratch, boot } = require('../test/helpers/scratch-server.js');

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const CORPUS = opt('--corpus', path.join(import.meta.dirname, '..', 'test', 'replayer-oracle', 'corpus.jsonl'));
const PER_GAME = Number(opt('--per-game', 1e9));
const GAMES = opt('--games', '') ? new Set(opt('--games', '').split(',').map((s) => s.trim())) : null;
const IDS = opt('--ids', '') ? new Set(opt('--ids', '').split(',').map((s) => s.trim())) : null;
const JOBS = Number(opt('--jobs', 3));
const W = Number(opt('--width', 402)), H = Number(opt('--height', 874));
const SHARE_EVERY = Number(opt('--share-every', 10));
const BUILD = opt('--build', '');
const BATCH = 20;

// ── The hands: per game, the most telling first (ties with odd chips, side pots, multiway showdowns) ──
const all = fs.readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const score = (r) => (r.tags.includes('stud-odd-chip-by-suit') ? 16 : 0) + (r.tags.includes('odd-chip') ? 8 : 0) + (r.tags.includes('tie') ? 4 : 0) + (r.tags.includes('side-pots') ? 4 : 0)
  + (r.tags.includes('straddle') ? 3 : 0) + (r.tags.includes('multiway') ? 2 : 0) + (r.tags.includes('showdown') ? 1 : 0);
const byGame = new Map();
for (const r of all) {
  if (GAMES && !GAMES.has(r.game)) continue;
  if (IDS && !IDS.has(r.id)) continue;
  if (!byGame.has(r.game)) byGame.set(r.game, []);
  byGame.get(r.game).push(r);
}
const hands = [];
for (const list of byGame.values()) {
  const sorted = list.map((r, i) => ({ r, k: score(r) * 1000 - i })).sort((a, b) => b.k - a.k).map((x) => x.r);
  // Half the most telling, half as they come (so ordinary hands are walked too).
  const take = Math.min(PER_GAME, list.length);
  const head = sorted.slice(0, Math.ceil(take / 2));
  const rest = list.filter((r) => !head.includes(r)).slice(0, take - head.length);
  hands.push(...head, ...rest);
}
console.log(`${hands.length} hands from ${CORPUS} (${[...byGame.keys()].length} games), ${JOBS} at a time at ${W}x${H}`);

const scratch = await createScratch({ ports: [4840, 4849], prefix: 'fg-oracle-' });
// --build: serve another build folder (a folder name at the repo root), leaving public-vite to whoever is using it.
const srv = await boot(scratch.dbPath, BUILD ? { PUBLIC_VITE_DIR: BUILD } : {}, {
  ports: [4840, 4849],
  preloads: BUILD ? [path.join(import.meta.dirname, '..', 'test', 'helpers', 'public-dir-preload.js')] : [],
});
const base = `http://127.0.0.1:${srv.port}`;
let serverDied = false;
srv.child.on('exit', () => { serverDied = true; });
const api = async (p, o = {}) => {
  const r = await fetch(base + p, {
    method: o.method || 'GET',
    headers: { 'content-type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const num = (t) => { const m = /(-?[\d,]*\.?\d+)\s*([kKmM]?)/.exec(t || ''); return m ? parseFloat(m[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1) : NaN; };
const readSeats = (page) => page.evaluate(() => [...document.querySelectorAll('.replayer-seat')].map((s) => {
  const c = s.querySelector('.replayer-seat-stack');
  return { seat: Number(s.getAttribute('data-seat')), name: s.querySelector('.replayer-seat-name')?.getAttribute('title') || '', text: (c?.textContent || '').trim() };
}).sort((a, b) => a.seat - b.seat));
// The felt prints whole chips and whole dollars, and compact numbers from 100,000 ("376K"): for this check any
// such format prints the exact amount, so every seat can be held to the cent.
const exactNumbers = () => {
  const NF = Intl.NumberFormat;
  const Exact = function (loc, o) {
    if (!o) return new NF(loc, o);
    const x = { ...o };
    if (x.notation === 'compact') { delete x.notation; delete x.compactDisplay; x.maximumFractionDigits = 2; }
    if (x.maximumFractionDigits === 0) x.maximumFractionDigits = 2;
    if (x.maximumSignificantDigits) delete x.maximumSignificantDigits;
    return new NF(loc, x);
  };
  Exact.prototype = NF.prototype; Exact.supportedLocalesOf = NF.supportedLocalesOf;
  Intl.NumberFormat = Exact;
};
// A shared link names the hero "Hero" and the others "Opp 1".. in seat order, skipping the hero.
const linkName = (rec, name) => {
  const a = rec.hand.players.findIndex((pl) => pl.name === name);
  const hero = rec.hand.heroIdx;
  return a === hero ? 'Hero' : 'Opp ' + ((a < hero ? a : a - 1) + 1);
};
const compare = (seats, rec, shared) => {
  const off = [];
  for (const [name, want] of Object.entries(rec.expected)) {
    const s = seats.find((x) => x.name === (shared ? linkName(rec, name) : name));
    if (!s) { off.push(`${name} is not on the felt (${seats.map((x) => x.name + '=' + x.text).join(' ')})`); continue; }
    const have = /all-?in/i.test(s.text) ? 0 : num(s.text);
    if (!(Math.abs(have - want) <= 0.005)) off.push(`${name} "${s.text}" (want ${want})`);
  }
  return off;
};

const browser = await webkit.launch();
const results = [];
let next = 0;
const t0 = Date.now();
async function worker(w) {
  const email = `oracle${w}@x.test`;
  await api('/api/register', { method: 'POST', body: { username: 'oracle' + w, email, password: 'oracle-password-1', realName: 'O R' } });
  const { body: { token } } = await api('/api/login', { method: 'POST', body: { email, password: 'oracle-password-1' } });
  if (!token) throw new Error('no token for worker ' + w);
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript((t) => { localStorage.setItem('token', t); localStorage.setItem('authToken', t); }, token);
  await ctx.addInitScript(exactNumbers);
  const anon = await browser.newContext({ viewport: { width: W, height: H } });
  await anon.addInitScript(exactNumbers);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => { if (!/access control/.test(e.message)) errs.push(e.message.split('\n')[0]); });
  const toHands = async () => {
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1800);
    await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 500 }).catch(() => {});
    await p.locator(W >= 1024 ? '.dk-rail-item:has-text("Hands")' : '.bottom-nav .nav-tab:has-text("Hands")').first().click();
    await p.waitForTimeout(1200);
  };
  while (next < hands.length && !serverDied) {
    const batch = [];
    while (batch.length < BATCH && next < hands.length) batch.push({ rec: hands[next], i: next++ });
    for (const b of batch) {
      b.title = '[' + b.rec.id + ']';   // bracketed: "Razz#1" must not also find "Razz#16"
      const r = await api('/api/replayer/hands', { method: 'POST', token, body: { title: b.title, handData: { ...b.rec.hand, title: b.title }, gameType: b.rec.hand.gameType } });
      b.saved = r.status === 201 ? (r.body.id ?? r.body.hand?.id) : null;
      b.saveStatus = r.status;
    }
    await toHands();
    for (const b of batch) {
      const res = { id: b.rec.id, game: b.rec.game, tags: b.rec.tags, problems: [] };
      const before = errs.length;
      try {
        if (b.saveStatus !== 201) throw new Error('not saved: ' + b.saveStatus);
        await p.locator('.replayer-hand-card.is-row').filter({ hasText: b.title }).first().click({ timeout: 8000 });
        await p.locator('button[title="End"]').first().waitFor({ timeout: 8000 });
        await p.waitForTimeout(200);
        await p.locator('button[title="End"]').first().click({ force: true });
        await p.waitForTimeout(700);
        const seats = await readSeats(p);
        res.problems.push(...compare(seats, b.rec));
        if (SHARE_EVERY > 0 && b.i % SHARE_EVERY === 0) {
          await p.locator('button:has-text("Share")').first().click({ force: true });
          await p.waitForTimeout(300);
          const [linkRes] = await Promise.all([
            p.waitForResponse((r) => /\/api\/hand-links$/.test(r.url()) && r.request().method() === 'POST', { timeout: 6000 }),
            p.locator('.share-menu-item:has-text("Copy link")').first().click({ force: true }),
          ]);
          const link = await linkRes.json().catch(() => null);
          await p.keyboard.press('Escape').catch(() => {});
          if (!link?.id) res.problems.push('share: no link');
          else {
            const q = await anon.newPage();
            await q.goto(base + '/h/' + link.id, { waitUntil: 'domcontentloaded' });
            await q.locator('button[title="End"]').first().waitFor({ timeout: 12000 });
            // A link opens on its deal, and a press made during it is lost: press End until the hand is over.
            for (let t = 0; t < 6; t++) {
              await q.waitForTimeout(t ? 800 : 500);
              await q.locator('button[title="End"]').first().click({ force: true });
              await q.waitForTimeout(700);
              if (await q.locator('button[title="Forward"]').first().isDisabled().catch(() => false)) break;
            }
            await q.waitForTimeout(1500);
            const shared = await readSeats(q);
            if (process.env.ORACLE_SHOTS) await q.screenshot({ path: path.join(process.env.ORACLE_SHOTS, b.rec.id.replace(/[^\w]+/g, '_') + '-shared.png') });
            for (const x of compare(shared, b.rec, true)) res.problems.push('shared link: ' + x);
            await q.close();
          }
        }
        await p.locator('button:has-text("Back")').first().click({ force: true });
        await p.waitForTimeout(400);
      } catch (e) {
        res.problems.push('STOPPED: ' + e.message.split('\n')[0]);
        await toHands().catch(() => {});
      }
      if (errs.length > before) res.problems.push('page errors: ' + [...new Set(errs.slice(before))].join(' | '));
      results.push(res);
      const done = results.length;
      if (res.problems.length) console.log(`FAIL ${res.id} [${res.tags.join(',')}]\n       - ${res.problems.join('\n       - ')}`);
      if (done % 50 === 0) console.log(`  … ${done}/${hands.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
    }
    for (const b of batch) if (b.saved) await api('/api/replayer/hands/' + b.saved, { method: 'DELETE', token });
  }
  await ctx.close();
  await anon.close();
}
try {
  await Promise.all(Array.from({ length: JOBS }, (_, w) => worker(w)));
} finally {
  await browser.close();
  await srv.stop();
  scratch.cleanup();
}
const per = new Map();
for (const r of results) { const g = per.get(r.game) || [0, 0]; g[0]++; if (r.problems.length) g[1]++; per.set(r.game, g); }
for (const [g, [n, bad]] of per) console.log(`${bad ? 'FAIL' : ' ok '} ${g.padEnd(10)} ${n - bad}/${n}`);
const bad = results.filter((r) => r.problems.length).length;
if (serverDied) console.log('the scratch server died during the run');
console.log(`\n${results.length - bad} of ${results.length} hands: every seat on the felt as the oracle says${serverDied ? ' (INCOMPLETE)' : ''}`);
process.exit(bad || serverDied || results.length < hands.length ? 1 : 0);
