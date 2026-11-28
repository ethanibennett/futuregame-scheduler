// Nothing on the felt may run into anything it does not belong to (owner, 2026-11-15: "We really need to figure out
// how to prevent these collisions"). Hands PokerKit played (test/replayer-oracle/corpus.jsonl: twenty games, two to
// ten seats, cash and tournament) are saved through the API, opened from the Hands list in WebKit at each size, and
// walked step by step; at every step, once the motion has settled, every piece on the felt is measured and every
// pair that may not touch is held apart:
//   - a seat's plaque, cards, action label, wager, showdown readout, draw run and the dealer button, against every
//     piece of every OTHER seat;
//   - within a seat, the action label, the wager, the readout and the draw run against everything else of the seat
//     (the cards tuck under their own plaque, and the button sits on its corner, by design; the action label, and a
//     readout with no cloth, may sit on the cards' bodies, never on a face-up card's rank);
//   - the pot, its row of main and side pots, a split's shares, the board and the game pill against every seat's
//     pieces and against each other.
//   - the watermark's ink against the game pill and the pot's figure (the board and the wagers may pass over it).
//   - every piece against what can be seen (2026-11-17): the screen's sides and the slot's clipped foot over the street
//     track ("edge"). --insets and --admin lay the page out as the app on an iPhone with the admin row.
// Seats take long names (a plaque is as wide as its name), so the layout is tried at the width real tables have.
//
//   node scripts/check-replayer-collisions.mjs [--per-game 2] [--games "NLH,O8"] [--ids "NLH#3"]
//        [--sizes "375x667,402x874,430x932,1440x900,1728x1117"] [--jobs 3] [--shots dir] [--slack 0.5] [--build dir]
//        [--json file] [--insets "59,34"] [--admin]
//
// Boots its own scratch server (test/helpers/scratch-server.js, ports 4890-4899) and stops it at the end. Needs the
// built app (vite-app: npm run build). Exit 1 on any collision.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
const { createScratch, boot, scrubbedEnv } = require('../test/helpers/scratch-server.js');

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
// An iPhone in the app (2026-11-17, the owner's "Bottom part of hero is cut off"): its safe areas as --sa-t,--sa-b in px
// ("59,34"), and --admin for the admin row under the transport ("Study this draw" and its note), which together take
// the table's height. Neither is on by default: the default sizes are a browser's.
const INSETS = opt('--insets', '');
const ADMIN = args.includes('--admin');
// --flat: the cards lying flat (Replayer settings > Splay off), where a stud row is wider (owner, 2026-11-28).
const FLAT = args.includes('--flat');

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
      // The name's own ink (its text, not its box): an action pill may sink into the plaque's top edge, not onto this.
      const nameEl = seat.querySelector('.replayer-seat-name');
      if (nameEl && seen(nameEl)) {
        const rg = document.createRange(); rg.selectNodeContents(nameEl);
        const nb = rg.getBoundingClientRect();
        if (nb.width > 0) items.push({ owner: s, kind: 'name', label: text(nameEl), x: nb.x, y: nb.y, w: nb.width, h: nb.height });
      }
      seat.querySelectorAll('.replayer-seat-cards .card-row > *').forEach((c, i) => {
        add(s, 'card', c, 'card ' + (i + 1));
        // A face-up card's rank (kind 'index'): the top third of its left 30% (on the 180 x 252 face the rank ends at 50
        // across and about 80 down; the suit pip under it, to 120, repeats the card's colour). The action label may cover
        // a card's body and the pip, never the rank.
        // The index is in the card's own frame, and a fan tilts its cards: the region is rotated with the card (its
        // and its parents' rotations, up to the seat) about the card's centre, and its bounds taken.
        const b = seen(c);
        if (b && c.tagName === 'IMG') {
          const w = c.offsetWidth || b.w, h = c.offsetHeight || b.h;
          let deg = 0;
          for (let e = c; e && e !== seat; e = e.parentElement) {
            const cs = getComputedStyle(e);
            const m = /matrix\(([^,]+),\s*([^,]+)/.exec(cs.transform || '');
            if (m) deg += Math.atan2(parseFloat(m[2]), parseFloat(m[1])) * 180 / Math.PI;
            const rot = /(-?[\d.]+)deg/.exec(cs.rotate || '');
            if (rot) deg += parseFloat(rot[1]);
          }
          const t = deg * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          const pts = [[-w / 2, -h / 2], [-w / 2 + 0.3 * w, -h / 2], [-w / 2, -h / 2 + 0.32 * h], [-w / 2 + 0.3 * w, -h / 2 + 0.32 * h]]
            .map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
          const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
          const x0 = Math.min(...xs), y0 = Math.min(...ys);
          items.push({ owner: s, kind: 'index', label: (c.getAttribute('alt') || 'card ' + (i + 1)) + ' index', x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 });
        }
      });
      seat.querySelectorAll('.replayer-action-badge-outer').forEach((el) => add(s, 'action', el));
      seat.querySelectorAll('.replayer-seat-hand-name').forEach((el) => add(s, 'readout', el));
      seat.querySelectorAll('.replayer-seat-draw-badge').forEach((el) => add(s, 'draws', el));
      seat.querySelectorAll('.replayer-dealer-btn').forEach((el) => add(s, 'button', el, 'D'));
    });
    table.querySelectorAll('.replayer-bet-chip[data-seat]').forEach((el) => add(Number(el.dataset.seat), 'wager', el));
    table.querySelectorAll('.replayer-board-area:not(.replayer-dead-area) .card-row > *').forEach((c, i) => add('felt', 'board', c, 'board ' + (i + 1)));
    table.querySelectorAll('.replayer-pot-display').forEach((el) => add('felt', 'pot', el));
    table.querySelectorAll('.replayer-pot-above').forEach((el) => add('felt', 'pot', el, 'pot chips'));
    // The game pill (and the tournament line under it): each line's own box, not the 46% column that holds them.
    table.querySelectorAll('.replayer-table-info > *').forEach((el) => add('felt', 'game', el));
    // The watermark's ink (kind 'mark'): decoration under everything, so a wager or the board may pass over it, but
    // never the printed text it would garble, the game pill or the pot's figure (owner, 2026-11-16).
    table.querySelectorAll('.replayer-watermark').forEach((el) => {
      if (!seen(el)) return;
      const rg = document.createRange(); rg.selectNodeContents(el);
      const wb = rg.getBoundingClientRect();
      if (wb.width > 0) items.push({ owner: 'felt', kind: 'mark', label: 'watermark', x: wb.x, y: wb.y, w: wb.width, h: wb.height });
    });
    // A split's shares and the main and side pots' row under the board (measured from 2026-11-16), pill by pill: a row
    // wrapped to clear the side seats is as wide as the band, its short second line is not.
    table.querySelectorAll('.replayer-split-shares > *').forEach((el) => add('felt', 'split', el));
    table.querySelectorAll('.replayer-pot-layers.is-placed > *').forEach((el) => add('felt', 'pots', el));
    // The replay's own controls over the table: Note here, Tags and the table-settings button. A top seat's cards
    // reach up toward them.
    const replay = table.closest('.replayer-replay') || document;
    replay.querySelectorAll('.hx-chips > *, .replayer-quick-btn').forEach((el) => add('felt', 'control', el));
    const t = table.getBoundingClientRect();
    // What can be seen: the slot clips its foot (overflow hidden, just above the street track) and the screen its sides.
    const slot = table.closest('.replayer-table-slot');
    const S = slot ? slot.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const view = { left: Math.max(0, S.left), top: Math.max(0, S.top), right: Math.min(innerWidth, S.right), bottom: Math.min(innerHeight, S.bottom) };
    return { r, items, view, table: { w: t.width, h: t.height } };
  };
};

// Which pairs may touch. Everything not listed here must stay apart.
// Keys are the two kinds sorted, joined by |. The action label sits over its own cards' lower bodies (owner,
// 2026-11-15), so it may cover a card, but not a card's index (kind 'index', held only against the action label).
// A small hand's pill may also sink into its plaque's top edge, held off the name's ink (kind 'name') instead.
// A showdown readout with no cloth sits on its own cards as the action label does (2026-11-16): on their bodies, held
// against their ranks.
const SELF_OK = new Set(['card|plaque', 'card|card', 'button|plaque', 'action|card', 'action|plaque', 'card|readout']);
// The pot's figure and its chips; the board's own cards; the replay's controls side by side.
const FELT_OK = new Set(['pot|pot', 'board|board', 'game|pot', 'control|control']);
// What the watermark is held against; anything else may pass over it.
const MARK_VS = new Set(['game', 'pot']);
function collisions(m, slack) {
  const out = [];
  const it = m.items;
  // A seat's cards tuck under its plaque, which paints over them: an overlap wholly inside that plaque is unseen.
  const plaques = new Map(it.filter((x) => x.kind === 'plaque').map((x) => [x.owner, x]));
  const hidden = (card, ix, iy, iw, ih) => {
    const p = plaques.get(card.owner);
    return p && ix >= p.x - slack && iy >= p.y - slack && ix + iw <= p.x + p.w + slack && iy + ih <= p.y + p.h + slack;
  };
  for (let i = 0; i < it.length; i++) {
    for (let j = i + 1; j < it.length; j++) {
      const a = it[i], b = it[j];
      const ix = Math.max(a.x, b.x), iy = Math.max(a.y, b.y);
      const ox = Math.min(a.x + a.w, b.x + b.w) - ix;
      const oy = Math.min(a.y + a.h, b.y + b.h) - iy;
      if (ox <= slack || oy <= slack) continue;
      // An index is a part of its card, and a name's ink a part of its plaque: each is held only against an action
      // label, and an index against its own seat's readout too (the card or the plaque stands for it otherwise).
      const partOnly = (x, y) => (x.kind === 'index' && y.kind !== 'action' && !(y.kind === 'readout' && y.owner === x.owner))
        || (x.kind === 'name' && y.kind !== 'action');
      if (partOnly(a, b) || partOnly(b, a)) continue;
      if ((a.kind === 'mark' && !MARK_VS.has(b.kind)) || (b.kind === 'mark' && !MARK_VS.has(a.kind))) continue;
      const pair = [a.kind, b.kind].sort().join('|');
      if (a.owner === b.owner) {
        if (a.owner === 'felt' ? FELT_OK.has(pair) : SELF_OK.has(pair)) continue;
      }
      if ((a.kind === 'card' && hidden(a, ix, iy, ox, oy)) || (b.kind === 'card' && hidden(b, ix, iy, ox, oy))) continue;
      out.push({ a, b, ox, oy });
    }
  }
  // Cut off: a piece any part of which is past what can be seen (the screen's sides, the slot's clipped foot).
  // A name's ink and a card's rank stand with their plaque and card.
  if (m.view) for (const a of it) {
    if (a.kind === 'name' || a.kind === 'index' || a.kind === 'mark' || a.kind === 'control') continue;
    const past = { left: m.view.left - a.x, right: a.x + a.w - m.view.right, bottom: a.y + a.h - m.view.bottom, top: m.view.top - a.y };
    const [side, by] = Object.entries(past).sort((p, q) => q[1] - p[1])[0];
    if (by > slack) out.push({ a, b: { owner: 'felt', kind: 'edge', label: side === 'bottom' ? 'the clip over the street track' : "the screen's " + side + ' edge' },
      ox: side === 'left' || side === 'right' ? by : a.w, oy: side === 'top' || side === 'bottom' ? by : a.h });
  }
  return out;
}

const PORTS = (opt('--ports') || '4890-4899').split('-').map(Number);
const scratch = await createScratch({ ports: PORTS, prefix: 'fg-collide-' });
// --build: serve another build folder (a folder at the repo root, or an absolute path), leaving public-vite to others.
const BUILD = opt('--build', '');
const srv = await boot(scratch.dbPath, BUILD ? { PUBLIC_VITE_DIR: BUILD } : {}, {
  ports: PORTS,
  preloads: BUILD ? [path.join(import.meta.dirname, '..', 'test', 'helpers', 'public-dir-preload.js')] : [],
});
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
  let { body: { token } } = await api('/api/login', { method: 'POST', body: { email, password: 'collide-password-1' } });
  if (!token) throw new Error('no token for worker ' + wi);
  // --admin: the same account under an app admin's name, signed with the scratch server's own secret.
  if (ADMIN) {
    const jwt = require('jsonwebtoken');
    const me = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    token = jwt.sign({ ...me, username: 'ham5' }, scrubbedEnv().JWT_SECRET, { algorithm: 'HS256' });
  }
  let ctx = null, page = null, size = '';
  while (next < jobs.length) {
    const job = jobs[next++];
    const key = job.w + 'x' + job.h;
    if (key !== size) {
      if (ctx) await ctx.close();
      ctx = await browser.newContext({ viewport: { width: job.w, height: job.h }, reducedMotion: 'reduce' });
      await ctx.addInitScript((tk) => { localStorage.setItem('token', tk); localStorage.setItem('onboarded', '1'); localStorage.setItem('hasOnboarded', 'true'); }, token);
      await ctx.addInitScript(MEASURE);
      if (FLAT) await ctx.addInitScript(() => { localStorage.setItem('replayerCardSplay', 'false'); });
      if (INSETS) await ctx.addInitScript(([t, b]) => {
        const set = () => { document.documentElement.style.setProperty('--sa-t', t + 'px'); document.documentElement.style.setProperty('--sa-b', b + 'px'); };
        if (document.documentElement) set();
        document.addEventListener('DOMContentLoaded', set);
      }, INSETS.split(',').map(Number));
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
            found.push({ ...rec, sig });
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
// --json <file>: every collision found, one per line (kind, hand, size, step, the two pieces, the overlap), to see
// which games and seats a kind comes from.
const JSON_OUT = opt('--json', '');
if (JSON_OUT) fs.writeFileSync(JSON_OUT, found.map((f) => JSON.stringify(f)).join('\n') + '\n');
process.exit(found.length || stopped ? 1 : 0);
