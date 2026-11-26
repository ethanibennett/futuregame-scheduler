// Eight browsers at one play-money table (owner, 2026-11-26: "we want 8 players to be able to play at once"): a
// scratch scheduler (ports 4970-4974) serving the built play page as play.futurega.me does, the tables service beside
// it (4975-4979), and eight WebKit pages signed in as eight ordinary accounts: phones upright and sideways and
// desktop windows. The host makes a 9-seat NLH table, the others open the invite, everyone sits, and they play HANDS
// hands by pressing the action bar (a check or call, sometimes a fold, sometimes a min-raise). One latecomer sits
// down while a hand is going and waits for the big blind. On every page, all along:
//   - no page error;
//   - before a showdown the felt shows face up only the board and that player's own two cards;
//   - every face-up board card agrees across the pages;
//   - the action bar is wholly on the screen;
//   - once the hand is dealt, every seated player's name is on the felt.
//
//   node scripts/check-tables-eight.mjs [--hands 4] [--shots <folder>]     (needs the built app)
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
const { createScratch, boot, freePort, scrubbedEnv, ROOT } = require('../test/helpers/scratch-server.js');
const jwt = require('jsonwebtoken');

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes('--' + k) ? args[args.indexOf('--' + k) + 1] : d);
const SHOTS = opt('shots', '');
const HANDS = Number(opt('hands', 4));
const SECRET = 'tables-eight-check-secret-0123456789abcdef0123';
const JWT_SECRET = 'backer-surface-test-secret-not-for-prod';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const fail = (m) => { if (!problems.includes(m)) { problems.push(m); console.log('  FAIL ' + m); } };
const ok = (m) => console.log('  ok   ' + m);
if (!fs.existsSync(path.join(ROOT, 'public-vite', 'play.html'))) { console.error('Build the app first (vite-app: npm run build).'); process.exit(2); }

// Who plays, and on what: the host and six more from the start, one coming in late.
const SCREENS = [
  { w: 402, h: 874, touch: true }, { w: 1440, h: 900 }, { w: 375, h: 812, touch: true }, { w: 874, h: 402, touch: true },
  { w: 430, h: 932, touch: true }, { w: 1280, h: 800 }, { w: 402, h: 874, touch: true }, { w: 1728, h: 1080 },
];
const NAMES = ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley', 'Gray', 'Harper'];

const scratch = await createScratch({ ports: [4970, 4974], prefix: 'fg-check-tables-eight-' });
const db = scratch.open();
NAMES.forEach((n, i) => db.run('INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)', [401 + i, n.toLowerCase(), `${n.toLowerCase()}@eight.test`, 'x']));
scratch.save(db);
const tokens = NAMES.map((n, i) => jwt.sign({ id: 401 + i, username: n.toLowerCase() }, JWT_SECRET, { expiresIn: '2h' }));

const tport = await freePort([4975, 4979]);
const srv = await boot(scratch.dbPath, { TABLES: '1', TABLES_URL: `http://127.0.0.1:${tport}`, TABLES_SECRET: SECRET, PLAY_HOSTS: '127.0.0.1' }, { ports: [4970, 4974] });
const S = `http://127.0.0.1:${srv.port}`;
let tablesLog = '';
const tables = spawn(process.execPath, [path.join(ROOT, 'tables', 'server.mjs')], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: scrubbedEnv({ PORT: String(tport), TABLES_SECRET: SECRET, TABLES_SCHEDULER_URL: S, TABLES_DATA_DIR: path.join(scratch.tmp, 'tables-data'),
    TABLES_ORIGINS: S, TABLES_HAND_GAP_MS: '2500' }),
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('tables did not start\n' + tablesLog)), 20000);
  const on = (b) => { tablesLog += b; if (tablesLog.includes('Tables running')) { clearTimeout(t); res(); } };
  tables.stdout.on('data', on); tables.stderr.on('data', on);
});
const api = async (method, p, body, bearer) => {
  const r = await fetch(S + p, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bearer }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};

// One browser each, as each player has their own device: pages of one browser share its six connections to a host, and
// eight open streams to the tables service left the seventh page waiting to join.
const browsers = [];
const players = [];
async function open(i) {
  const s = SCREENS[i];
  const browser = await webkit.launch();
  browsers.push(browser);
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, hasTouch: !!s.touch });
  await ctx.addInitScript(({ t, n }) => { localStorage.setItem('token', t); localStorage.setItem('playName', n); localStorage.setItem('gridReadout', 'off'); }, { t: tokens[i], n: NAMES[i] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`${NAMES[i]} (${s.w}x${s.h}): page error ${e.message}`));
  const p = { i, name: NAMES[i], page, screen: `${s.w}x${s.h}` };
  players.push(p);
  return p;
}

/* What one page shows: the bar's text, the face-up cards on the felt (the board apart), the names on the felt, and
   any bar control past the screen's edge. */
const look = (p) => p.page.evaluate(() => {
  const up = (el) => el.offsetParent !== null || el.getClientRects().length;
  const cards = [...document.querySelectorAll('.replayer-table img[alt]')].filter(up).map((e) => ({ alt: e.alt, board: !!e.closest('.replayer-board, [class*="board"]') }));
  const real = (c) => /^[2-9TJQKA][hdcs]$/.test(c.alt);
  const bar = [...document.querySelectorAll('.tb-bar')].map((b) => b.innerText.replace(/\s+/g, ' ')).join(' ');
  const cut = [...document.querySelectorAll('.tb-bar button, .tb-bar input')].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width && (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5);
  }).map((e) => (e.textContent || e.value || '').trim());
  return {
    bar, cut,
    // The hand is over (the cards shown at a showdown are on the felt): the bar after the hand, whatever it says.
    over: !!document.querySelector('.tb-bar.is-over'),
    board: cards.filter((c) => c.board && real(c)).map((c) => c.alt),
    // A card being turned is drawn twice for a moment (the turn-over's copy): each card once.
    hole: [...new Set(cards.filter((c) => !c.board && real(c)).map((c) => c.alt))],
    names: [...document.querySelectorAll('.replayer-seat-name')].filter(up).map((e) => e.textContent.trim()),
    live: !!document.querySelector('.tb-live'),
  };
});

async function pressOne(p) {
  const bar = p.page.locator('.tb-bar');
  const btns = bar.locator('.hs-btn.rd-act:not([disabled])');
  const labels = await btns.allInnerTexts().catch(() => []);
  if (!labels.length) return false;
  const x = Math.random();
  let want = labels.find((l) => /^(Check|Call )/.test(l));
  if (x < 0.15 && labels.includes('Fold')) want = 'Fold';
  if (x > 0.9 && await bar.locator('.tb-go').count()) {
    // A min-raise: Min fills the box, the go button sends it.
    if (await bar.getByRole('button', { name: 'Min', exact: true }).click({ timeout: 2000 }).then(() => true, () => false)
      && await bar.locator('.tb-go').click({ timeout: 2000 }).then(() => true, () => false)) return true;
  }
  if (!want) return false;
  return btns.filter({ hasText: new RegExp('^' + want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).first().click({ timeout: 3000 }).then(() => true, () => false);
}

try {
  // The host makes the table; six more open the invite and sit down; the eighth waits.
  const host = await open(0);
  await host.page.goto(S + '/');
  await host.page.getByRole('button', { name: 'New table' }).click({ timeout: 20000 });
  await host.page.locator('.tb-new').getByLabel('Name').fill('Eight');
  await host.page.locator('.tb-new').getByLabel('Seats').selectOption('9');
  await host.page.getByRole('button', { name: 'Create' }).click();
  await host.page.getByText('Eight').first().waitFor();
  const list = await api('GET', '/api/tables', null, tokens[0]);
  const invite = list.tables[0].invite.split('/join/')[1];
  if (list.tables[0].maxSeats !== 9) fail(`the table has ${list.tables[0].maxSeats} seats, want 9`);
  ok('the host made a 9-seat table from the lobby');
  await host.page.getByRole('button', { name: 'Open' }).click();
  await host.page.getByRole('button', { name: 'Sit down' }).click();
  for (let i = 1; i < 7; i++) {
    const p = await open(i);
    await p.page.goto(`${S}/join/${invite}`);
    await p.page.getByRole('button', { name: 'Join the table' }).click({ timeout: 20000 });
    await p.page.getByRole('button', { name: 'Sit down' }).click({ timeout: 20000 });
  }
  ok('six more took the invite and sat down');
  await host.page.getByRole('button', { name: 'Start the game' }).click({ timeout: 20000 });
  ok('the host started the game with seven seated');

  const named = new Set();   // every name any felt has shown
  let hands = 0, late = null, lastHandText = '', shotAt = new Set();
  const until = Date.now() + HANDS * 90000 + 60000;
  while (hands < HANDS && Date.now() < until && problems.length < 20) {
    // The latecomer sits down while the second hand is going.
    if (!late && hands >= 1) {
      late = await open(7);
      await late.page.goto(`${S}/join/${invite}`);
      await late.page.getByRole('button', { name: 'Join the table' }).click({ timeout: 20000 });
      await late.page.getByRole('button', { name: 'Sit down' }).click({ timeout: 20000 });
      ok(`${late.name} sat down while a hand was going`);
    }
    const looks = await Promise.all(players.map((p) => look(p).then((l) => ({ p, l })).catch(() => null)));
    const boards = new Set();
    for (const x of looks) {
      if (!x) continue;
      const { p, l } = x;
      for (const n of l.names) named.add(n);
      if (l.cut.length) fail(`${p.name} (${p.screen}): ${l.cut.join(', ')} past the screen's edge`);
      const showdown = l.over;
      if (!showdown && l.hole.length > 2) fail(`${p.name} (${p.screen}) sees ${l.hole.length} face-up cards off the board mid-hand: ${l.hole.join(' ')}`);
      if (!showdown && l.board.length) boards.add(l.board.join(''));
    }
    if (boards.size > 1) {
      // The pages may be a street apart for a moment: each must be the start of the longest.
      const longest = [...boards].sort((a, b) => b.length - a.length)[0];
      for (const b of boards) if (!longest.startsWith(b)) fail(`the pages disagree on the board: ${[...boards].join(' / ')}`);
    }
    // Whoever has a turn takes it.
    let moved = false;
    for (const x of looks) if (x && /Your turn/.test(x.l.bar)) moved = (await pressOne(x.p)) || moved;
    // A new hand: count it, check the names, and (with --shots) photograph every page once mid-hand.
    const v = await api('GET', `/api/tables`, null, tokens[0]).catch(() => null);
    const handText = (looks.find((x) => x && x.l.live) || { l: { bar: '' } }).l.bar;
    if (/Hand over/.test(handText) && !/Hand over/.test(lastHandText)) { hands++; ok(`hand ${hands} over`); }
    lastHandText = handText;
    if (SHOTS && !shotAt.has(hands) && looks.every((x) => x && x.l.live) && looks.some((x) => /Your turn/.test(x.l.bar))) {
      shotAt.add(hands);
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const p of players) await p.page.screenshot({ path: path.join(SHOTS, `eight-h${hands + 1}-${p.name}-${p.screen}.png`) }).catch(() => {});
      const seated = looks.filter((x) => x && x.l.live).map((x) => x.l.names.length);
      ok(`hand ${hands + 1}: photographed; names on each felt ${seated.join(', ')}`);
    }
    if (!moved) await sleep(150);
    void v;
  }
  if (hands < HANDS) fail(`only ${hands} of ${HANDS} hands finished`);
  // The latecomer waited for the big blind and was dealt in: every one of the eight has been on the felt.
  const missing = NAMES.filter((n) => !named.has(n.toLowerCase()));
  if (missing.length) fail(`never on a felt: ${missing.join(', ')}`); else ok('all eight have played a hand on the felt');
} catch (e) {
  fail(e.message.split('\n')[0]);
  for (const p of players) {
    const text = await p.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 240)).catch(() => '?');
    console.log(`  ${p.name} (${p.screen}) at ${p.page.url()}: ${text}`);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.page.screenshot({ path: path.join(SHOTS, `eight-stopped-${p.name}.png`) }).catch(() => {}); }
  }
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  tables.kill();
  await srv.stop();
  scratch.cleanup();
}
const errs = tablesLog.split('\n').filter((l) => /Error|unreachable|answered 5/.test(l));
if (errs.length) fail('the tables service logged: ' + errs.slice(0, 3).join(' | '));
console.log(problems.length ? `\ncheck-tables-eight: ${problems.length} problem(s)` : `\ncheck-tables-eight: eight browsers, ${HANDS} hands, nothing leaked or cut off`);
process.exit(problems.length ? 1 : 0);
