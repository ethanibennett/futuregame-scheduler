// Nothing on the felt may run into anything it does not belong to (owner, 2026-11-15: "We really need to figure out
// how to prevent these collisions"). Hands PokerKit played (test/replayer-oracle/corpus.jsonl: twenty games, two to
// ten seats, cash and tournament) are saved through the API, opened from the Hands list in WebKit at each size, and
// walked step by step; at every step, once the motion has settled, every piece on the felt is measured and every
// pair that may not touch is held apart:
//   - a seat's plaque, cards, action label, wager, showdown readout, draw run and the dealer button, against every
//     piece of every OTHER seat;
//   - within a seat, the action label, the wager, the readout and the draw run against everything else of the seat
//     (the cards tuck under their own plaque, and the button sits on its corner, by design);
//   - the pot, the board and the game pill against every seat's pieces and against each other.
// Seats take long names (a plaque is as wide as its name), so the layout is tried at the width real tables have.
//
//   node scripts/check-replayer-collisions.mjs [--per-game 2] [--games "NLH,O8"] [--ids "NLH#3"]
//        [--sizes "375x667,402x874,430x932,1440x900,1728x1117"] [--jobs 3] [--shots dir] [--slack 0.5]
//
// Boots its own scratch server (test/helpers/scratch-server.js, ports 4890-4899) and stops it at the end. Needs the
// built app (vite-app: npm run build). Exit 1 on any collision.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
const { createScratch, boot } = require('../test/helpers/scratch-server.js');

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const CORPUS = opt('--corpus', path.join(import.meta.dirname, '..', 'test', 'replayer-oracle', 'corpus.jsonl'));
const PER_GAME = Number(opt('--per-game', 2));
const GAMES = opt('--games', '') ? new Set(opt('--games', '').split(',').map((s) => s.trim())) : null;
const IDS = opt('--ids', '') ? new Set(opt('--ids', '').split(',').map((s) => s.trim())) : null;
const SIZES = opt('--sizes', '375x667,402x874,430x932,1440x900,1728x1117').split(',').map((s) => s.trim().split('x').map(Number));
const JOBS = Number(opt('--jobs', 3));
const SHOTS = opt('--shots', '');
const SLACK = Number(opt('--slack', 0.5));   // px of overlap forgiven (anti-aliasing, a hairline border)
const MAX_STEPS = 80;

// Long names, as real tables have them: the plaque is sized by its name.
const NAMES = ['Vincent Basilicata', 'Joshua Rhodes', 'Rob Klein', 'Maria Konstantinidis', 'Alexander Petrov',
  'Christopher Hall', 'Samantha Delacroix', 'Benjamin Okafor', 'Ethan Bennett', 'Isabella Fontaine'];

const all = fs.readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byGame = new Map();
for (const r of all) {
  if (GAMES && !GAMES.has(r.game)) continue;
  if (IDS && !IDS.has(r.id)) continue;
  if (!byGame.has(r.game)) byGame.set(r.game, []);
  byGame.get(r.game).push(r);
}
// Per game: the busiest tables first (most seats, then multiway and all-in hands), so each game is tried full.
const hands = [];
for (const list of byGame.values()) {
  const k = (r) => r.n * 10 + (r.tags.includes('multiway') ? 3 : 0) + (r.tags.includes('all-in') ? 2 : 0) + (r.tags.includes('showdown') ? 1 : 0);
  const sorted = [...list].sort((a, b) => k(b) - k(a));
  // The fullest table, then the rest spread over the seat counts.
  const take = [];
  const seen = new Set();
  for (const r of sorted) { if (take.length >= PER_GAME) break; if (!seen.has(r.n)) { take.push(r); seen.add(r.n); } }
  for (const r of sorted) { if (take.length >= PER_GAME) break; if (!take.includes(r)) take.push(r); }
  hands.push(...take);
}
const named = (rec) => {
  const h = JSON.parse(JSON.stringify(rec.hand));
  h.players.forEach((p, i) => { p.name = NAMES[i % NAMES.length]; });
  return h;
};
console.log(`${hands.length} hands (${byGame.size} games) x ${SIZES.length} sizes, ${JOBS} at a time`);

// ── What is measured, in the page ──
const MEASURE = () => {
  window.__felt = () => {
    const table = document.querySelector('.replayer-table');
    if (!table) return null;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:calc(var(--subrow) * 100);width:0';
    document.body.appendChild(probe);
    const r = probe.getBoundingClientRect().height / 100 || 8;
    probe.remove();
    const seen = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return null;
      for (let e = el; e && e !== table; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
      }
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    };
    const text = (el) => (el ? (el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30) : '');
    const items = [];
    const add = (owner, kind, el, label) => { const b = seen(el); if (b) items.push({ owner, kind, label: label ?? text(el), ...b }); };
    table.querySelectorAll('.replayer-seat[data-seat]').forEach((seat) => {
      const s = Number(seat.dataset.seat);
      add(s, 'plaque', seat.querySelector('.replayer-seat-info'), text(seat.querySelector('.replayer-seat-name')));
      seat.querySelectorAll('.replayer-seat-cards .card-row > *').forEach((c, i) => add(s, 'card', c, 'card ' + (i + 1)));
      seat.querySelectorAll('.replayer-action-badge-outer').forEach((el) => add(s, 'action', el));
      seat.querySelectorAll('.replayer-seat-hand-name').forEach((el) => add(s, 'readout', el));
      seat.querySelectorAll('.replayer-seat-draw-badge').forEach((el) => add(s, 'draws', el));
      seat.querySelectorAll('.replayer-dealer-btn').forEach((el) => add(s, 'button', el, 'D'));
    });
    table.querySelectorAll('.replayer-bet-chip[data-seat]').forEach((el) => add(Number(el.dataset.seat), 'wager', el));
    table.querySelectorAll('.replayer-board-area:not(.replayer-dead-area) .card-row > *').forEach((c, i) => add('felt', 'board', c, 'board ' + (i + 1)));
    table.querySelectorAll('.replayer-pot-display').forEach((el) => add('felt', 'pot', el));
    table.querySelectorAll('.replayer-pot-above').forEach((el) => add('felt', 'pot', el, 'pot chips'));
    table.querySelectorAll('.replayer-table-info').forEach((el) => add('felt', 'game', el));
    table.querySelectorAll('.replayer-split-shares').forEach((el) => add('felt', 'split', el));
    const t = table.getBoundingClientRect();
    return { r, items, table: { w: t.width, h: t.height } };
  };
};

// Which pairs may touch. Everything not listed here must stay apart.
// Keys are the two kinds sorted, joined by |.
const SELF_OK = new Set(['card|plaque', 'card|card', 'button|plaque']);
const FELT_OK = new Set(['pot|pot', 'board|board', 'game|pot']);   // the pot's figure and its chips; the board's own cards
function collisions(m, slack) {
  const out = [];
  const it = m.items;
  for (let i = 0; i < it.length; i++) {
    for (let j = i + 1; j < it.length; j++) {
      const a = it[i], b = it[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox <= slack || oy <= slack) continue;
      const pair = [a.kind, b.kind].sort().join('|');
      if (a.owner === b.owner) {
        if (a.owner === 'felt' ? FELT_OK.has(pair) : SELF_OK.has(pair)) continue;
      }
      out.push({ a, b, ox, oy });
    }
  }
  return out;
}

const scratch = await createScratch({ ports: [4890, 4899], prefix: 'fg-collide-' });
const srv = await boot(scratch.dbPath, {}, { ports: [4890, 4899] });
const base = `http://127.0.0.1:${srv.port}`;
const api = async (p, o = {}) => {
  const res = await fetch(base + p, {
    method: o.method || 'GET',
    headers: { 'content-type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const browser = await webkit.launch();
const found = [];          // every collision
const signatures = new Map();
let stepsMeasured = 0, stopped = 0;
const jobs = [];
for (const [w, h] of SIZES) for (const rec of hands) jobs.push({ w, h, rec });
let next = 0;
const t0 = Date.now();

async function worker(wi) {
  const email = `collide${wi}@x.test`;
  await api('/api/register', { method: 'POST', body: { username: 'collide' + wi, email, password: 'collide-password-1', realName: 'C W' } });
  const { body: { token } } = await api('/api/login', { method: 'POST', body: { email, password: 'collide-password-1' } });
  if (!token) throw new Error('no token for worker ' + wi);
  let ctx = null, page = null, size = '';
  while (next < jobs.length) {
    const job = jobs[next++];
    const key = job.w + 'x' + job.h;
    if (key !== size) {
      if (ctx) await ctx.close();
      ctx = await browser.newContext({ viewport: { width: job.w, height: job.h }, reducedMotion: 'reduce' });
      await ctx.addInitScript((tk) => { localStorage.setItem('token', tk); localStorage.setItem('onboarded', '1'); localStorage.setItem('hasOnboarded', 'true'); }, token);
      await ctx.addInitScript(MEASURE);
      page = await ctx.newPage();
      size = key;
    }
    const title = '[' + job.rec.id + ' ' + key + ']';
    const hand = named(job.rec);
    const saved = await api('/api/replayer/hands', { method: 'POST', token, body: { title, handData: { ...hand, title }, gameType: hand.gameType } });
    const id = saved.status === 201 ? (saved.body.id ?? saved.body.hand?.id) : null;
    try {
      if (!id) throw new Error('not saved: ' + saved.status);
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 300 }).catch(() => {});
      await page.locator(job.w >= 1024 ? '.dk-rail-item:has-text("Hands")' : '.bottom-nav .nav-tab:has-text("Hands")').first().click();
      await page.waitForTimeout(900);
      await page.locator('.replayer-hand-card.is-row').filter({ hasText: title }).first().click({ timeout: 8000 });
      const fwd = page.locator('button[title^="Forward"]').first();
      await fwd.waitFor({ timeout: 8000 });
      for (let step = 0; step < MAX_STEPS; step++) {
        // At rest: every finite animation on the page finished (an endless one, a glow, is not waited for).
        await page.waitForFunction(() => document.getAnimations().every((a) => {
          const end = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().endTime : 0;
          return a.playState !== 'running' || !Number.isFinite(end);
        }), null, { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(80);
        const m = await page.evaluate(() => window.__felt && window.__felt());
        stepsMeasured++;
        if (m) {
          const hits = collisions(m, SLACK);
          for (const c of hits) {
            const sig = `${[c.a.kind, c.b.kind].sort().join(' x ')}${c.a.owner === c.b.owner && c.a.owner !== 'felt' ? ' (same seat)' : ''} @ ${key}`;
            const rec = { id: job.rec.id, game: job.rec.game, n: job.rec.n, size: key, step,
              what: `${c.a.owner === 'felt' ? '' : 'seat ' + c.a.owner + ' '}${c.a.kind} "${c.a.label}" x ${c.b.owner === 'felt' ? '' : 'seat ' + c.b.owner + ' '}${c.b.kind} "${c.b.label}"`,
              overlap: `${(c.ox / m.r).toFixed(2)}r x ${(c.oy / m.r).toFixed(2)}r` };
            found.push(rec);
            if (!signatures.has(sig)) {
              signatures.set(sig, { count: 0, first: rec });
              if (SHOTS) {
                fs.mkdirSync(SHOTS, { recursive: true });
                await page.screenshot({ path: path.join(SHOTS, (signatures.size + '-' + sig).replace(/[^\w.-]+/g, '_') + '.png') }).catch(() => {});
              }
            }
            signatures.get(sig).count++;
          }
        }
        if (await fwd.isDisabled().catch(() => true)) break;
        await fwd.click({ force: true });
      }
    } catch (e) {
      stopped++;
      console.log(`STOPPED ${job.rec.id} @ ${key}: ${e.message.split('\n')[0]}`);
    }
    if (id) await api('/api/replayer/hands/' + id, { method: 'DELETE', token });
  }
  if (ctx) await ctx.close();
}

try {
  await Promise.all(Array.from({ length: JOBS }, (_, w) => worker(w)));
} finally {
  await browser.close();
  await srv.stop();
  scratch.cleanup?.();
}

const secs = Math.round((Date.now() - t0) / 1000);
console.log(`\n${stepsMeasured} steps measured in ${secs}s; ${found.length} collisions, ${signatures.size} kinds${stopped ? `; ${stopped} hands stopped` : ''}`);
for (const [sig, { count, first }] of [...signatures].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(count).padStart(5)}  ${sig}\n         e.g. ${first.id} (${first.n} seats) step ${first.step}: ${first.what}, ${first.overlap}`);
}
process.exit(found.length || stopped ? 1 : 0);
