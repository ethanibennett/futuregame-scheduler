// Two browsers at one play-money table (docs/play-money-platform.md §9; the brief's "done"): a scratch scheduler
// (ports 4950-4954) serving the built play page as play.futurega.me does (PLAY_HOSTS: the scratch host), the tables
// service beside it (4955-4959), and two WebKit pages signed in as two accounts. Ava makes a table in the lobby; Bo
// opens her /join/ link; both sit; they play a full
// NLH hand from a fixed deck by pressing the action bar on the replayer's felt. After every step each page's felt
// is read: neither may ever show a card its player has not seen. At the end the winner's cards are shown to the
// loser, the loser's never to the winner, the stacks are the settlement's, and each keeps the hand in Hands.
//
//   npm run check:tables            (needs the built app: vite-app, npm run build)
//   node scripts/check-tables.mjs --shots <folder>   saves each page at the end
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
const { createScratch, boot, freePort, scrubbedEnv, ROOT } = require('../test/helpers/scratch-server.js');
const jwt = require('jsonwebtoken');

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : '';
const SECRET = 'tables-check-secret-0123456789abcdef0123456789';
const JWT_SECRET = 'backer-surface-test-secret-not-for-prod';
const FULL = [...'23456789TJQKA'].flatMap((r) => [...'hdcs'].map((s) => r + s));
// Seat 0 (the first to sit: Bo, the button) AhAd; seat 1 (Ava) KcKs; board 2c 7d 9h | 3s | 4d.
const TOP = ['Ah', 'Ad', 'Kc', 'Ks', '2c', '7d', '9h', '3s', '4d'];
const DECK = [...TOP, ...FULL.filter((c) => !TOP.includes(c))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const fail = (m) => { problems.push(m); console.log('  FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);

if (!fs.existsSync(path.join(ROOT, 'public-vite', 'play.html'))) { console.error('Build the app first (vite-app: npm run build).'); process.exit(2); }

const scratch = await createScratch({ ports: [4950, 4954], prefix: 'fg-check-tables-' });
const db = scratch.open();
db.run("INSERT INTO users (id, username, email, password) VALUES (101, 'ham', 'a@x.test', 'x'), (102, 'ham5', 'b@x.test', 'x')");
scratch.save(db);
const tok = (id, username) => jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '1h' });
const AVA = tok(101, 'ham'), BO = tok(102, 'ham5');

const tport = await freePort([4955, 4959]);
// The scratch host is the play host: every page is play.html, and an invite is <host>/join/<token>.
const srv = await boot(scratch.dbPath, { TABLES: '1', TABLES_URL: `http://127.0.0.1:${tport}`, TABLES_SECRET: SECRET, PLAY_HOSTS: '127.0.0.1' }, { ports: [4950, 4954] });
const S = `http://127.0.0.1:${srv.port}`;
const tables = spawn(process.execPath, [path.join(ROOT, 'tables', 'server.mjs')], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: scrubbedEnv({ PORT: String(tport), TABLES_SECRET: SECRET, TABLES_SCHEDULER_URL: S, TABLES_DATA_DIR: path.join(scratch.tmp, 'tables-data'),
    TABLES_ORIGINS: S, TABLES_HAND_GAP_MS: '600000', TABLES_TEST_DECK: DECK.join(',') }),
});
await new Promise((res, rej) => {
  let log = '';
  const t = setTimeout(() => rej(new Error('tables did not start\n' + log)), 20000);
  const on = (b) => { log += b; if (log.includes('Tables running')) { clearTimeout(t); res(); } };
  tables.stdout.on('data', on); tables.stderr.on('data', on);
});

const browser = await webkit.launch();
async function page(token, username) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, hasTouch: true });
  await ctx.addInitScript(({ t, u }) => {
    localStorage.setItem('token', t); localStorage.setItem('username', u);
    localStorage.setItem('onboardComplete', '1'); localStorage.setItem('hasOnboarded', 'true');
    localStorage.setItem('onboarded', '1'); localStorage.setItem('gridReadout', 'off');
  }, { t: token, u: username });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => fail(`${username}: page error ${e.message}`));
  return p;
}
const api = async (method, p, body, bearer) => {
  const r = await fetch(S + p, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bearer }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const faces = (p) => p.$$eval('img[alt]', (els) => els.filter((e) => e.offsetParent !== null || e.getClientRects().length).map((e) => e.alt));
/* Each page's felt at this moment: no card its player has not seen. */
async function noLeaks(ava, bo, at, { over = false } = {}) {
  const a = await faces(ava), b = await faces(bo);
  if (a.some((c) => c === 'Ah' || c === 'Ad') && !over) fail(`${at}: Ava's felt shows Bo's aces before the showdown`);
  if (a.some((c) => c === 'Kc' || c === 'Ks') === false && at === 'dealt') fail(`${at}: Ava cannot see her own kings`);
  if (b.some((c) => c === 'Kc' || c === 'Ks')) fail(`${at}: Bo's felt shows Ava's kings`);
  const undealt = DECK.slice(TOP.length);
  for (const c of [...a, ...b]) if (undealt.includes(c)) fail(`${at}: an undealt ${c} on a felt`);
}
async function press(p, name, who) {
  const b = p.getByRole('button', { name, exact: true }).last();
  await b.waitFor({ state: 'visible', timeout: 15000 });
  for (let i = 0; i < 100 && await b.isDisabled(); i++) await sleep(100);
  await b.click();
  ok(`${who} presses ${name}`);
}
const yourTurn = (p) => p.getByText(/^Your turn/).first().waitFor({ state: 'visible', timeout: 15000 });

let pages = [];
try {
  const ava = await page(AVA, 'ham');
  const bo = await page(BO, 'ham5');
  pages = [['ava', ava], ['bo', bo]];

  // Ava makes the table in the lobby: play.futurega.me opens on it.
  await ava.goto(S + '/');
  await ava.getByText(/20,000 chips/).waitFor({ timeout: 15000 });
  ok('Ava sees 20,000 chips');
  await ava.getByRole('button', { name: 'New table' }).click();
  await ava.locator('.tb-new').getByLabel('Name').fill('Check table');
  await ava.getByRole('button', { name: 'Create' }).click();
  await ava.getByText('Check table').waitFor();
  ok('Ava made a table');
  const list = await api('GET', '/api/tables', null, AVA);
  const invite = list.tables[0].invite.split('/join/')[1];

  // Bo opens the invite link, joins and sits first (seat 0: the button, the aces).
  await bo.goto(`${S}/join/${invite}`);
  await bo.getByRole('button', { name: 'Join the table' }).click();
  await bo.getByRole('button', { name: 'Sit down' }).click();
  ok('Bo took the invite and sat down');
  await ava.getByRole('button', { name: 'Open' }).click();
  await ava.getByRole('button', { name: 'Sit down' }).click();
  ok('Ava sat down');

  // The hand: Bo limps, Ava checks; check it down.
  await yourTurn(bo);
  await noLeaks(ava, bo, 'dealt');
  await press(bo, 'Call 50', 'Bo');
  await yourTurn(ava);
  await noLeaks(ava, bo, 'preflop');
  await press(ava, 'Check', 'Ava');
  for (const street of ['flop', 'turn', 'river']) {
    await yourTurn(ava); await noLeaks(ava, bo, street);
    await press(ava, 'Check', 'Ava');
    await yourTurn(bo);
    await press(bo, 'Check', 'Bo');
  }
  await bo.getByText(/^Hand over/).first().waitFor({ timeout: 15000 });
  await ava.getByText(/^Hand over/).first().waitFor({ timeout: 15000 });
  ok('both bars: Hand over');
  // The felt plays on to the result: the winner's aces turn up on Ava's felt, Ava's kings never on Bo's.
  let shown = false;
  for (let i = 0; i < 60 && !shown; i++) {
    await noLeaks(ava, bo, 'the run to the result', { over: true });
    const a = await faces(ava);
    shown = a.includes('Ah') && a.includes('Ad');
    if (!shown) await sleep(250);
  }
  if (!shown) fail("the end: the winner's aces are never shown to Ava"); else ok("Bo's aces are shown to Ava; Ava's kings never to Bo");
  // The pot ships after the cards turn: the stacks are read until the felt settles on them.
  let stacks = [];
  for (let i = 0; i < 60; i++) {
    stacks = await bo.locator('.replayer-seat-stack, [class*="seat-stack"]').allInnerTexts().catch(() => []);
    if (stacks.some((s) => /10,100/.test(s)) && stacks.some((s) => /9,900/.test(s))) break;
    await sleep(250);
  }
  if (!(stacks.some((s) => /10,100/.test(s)) && stacks.some((s) => /9,900/.test(s)))) fail(`the felt's stacks at the end: ${stacks.join(' | ')}`); else ok("the felt ends on 10,100 and 9,900");

  const avaHands = await api('GET', '/api/hands', null, AVA);
  const boHands = await api('GET', '/api/hands', null, BO);
  if (avaHands.length !== 1 || boHands.length !== 1) fail(`saved hands: Ava ${avaHands.length}, Bo ${boHands.length}`); else ok('each keeps the hand in Hands');
  const state = await api('GET', '/api/tables/chips', null, BO);
  if (state.balance !== 10000) fail(`Bo's balance ${state.balance}, want 10,000 (20,000 less a 10,000 buy-in)`); else ok("Bo's balance is 10,000 while seated");

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await ava.screenshot({ path: path.join(SHOTS, 'tables-ava.png') });
    await bo.screenshot({ path: path.join(SHOTS, 'tables-bo.png') });
  }

  // Stud and a draw game (decision 10): both leave, Ava makes the next table, and they play one hand through.
  await press(bo, 'Leave', 'Bo');
  await press(ava, 'Leave', 'Ava');
  for (const [game, label] of [['Stud Hi', 'Seven Card Stud'], ['2-7 TD', '2-7 Triple Draw']]) await otherGame(ava, bo, game, label);
} catch (e) {
  fail(e.message.split('\n')[0]);
  // Where each page stood when it stopped.
  for (const [who, p] of pages) {
    const text = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300)).catch(() => '?');
    console.log(`  ${who} at ${p.url()}: ${text}`);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `tables-stopped-${who}.png`) }).catch(() => {}); }
  }
} finally {
  await browser.close();
  tables.kill();
  await srv.stop();
  scratch.cleanup();
}
console.log(problems.length ? `\ncheck-tables: ${problems.length} problem(s)` : '\ncheck-tables: two browsers, NLH, stud and triple draw, nothing leaked');
process.exit(problems.length ? 1 : 0);

/* One hand of `game` at a new table: each player answers what their bar offers (a check, a call, the bring-in;
   at a draw, one card tapped on the felt and thrown), the felt ends on the stacks the export's settlement of the
   hand each keeps says, and the hand is kept with the throw in it. */
async function otherGame(ava, bo, game, label) {
  const name = `${game} table`;
  await ava.getByRole('button', { name: 'New table' }).waitFor({ timeout: 15000 });
  await ava.getByRole('button', { name: 'New table' }).click();
  await ava.locator('.tb-new').getByLabel('Name').fill(name);
  await ava.locator('.tb-new').getByLabel('Game').selectOption(game);
  await ava.getByRole('button', { name: 'Create' }).click();
  await ava.getByText(name).first().waitFor();
  ok(`Ava made a ${label} table`);
  const list = await api('GET', '/api/tables', null, AVA);
  const t = list.tables.find((x) => x.name === name);
  if (!t) { fail(`${game}: the table is not in Ava's list`); return; }
  const before = { ava: (await api('GET', '/api/hands', null, AVA)).length, bo: (await api('GET', '/api/hands', null, BO)).length };
  await bo.goto(`${S}/join/${t.invite.split('/join/')[1]}`);
  await bo.getByRole('button', { name: 'Join the table' }).click();
  await bo.getByRole('button', { name: 'Sit down' }).click();
  await ava.locator('.tb-item', { hasText: name }).getByRole('button', { name: 'Open' }).click();
  await ava.getByRole('button', { name: 'Sit down' }).click();
  ok(`${game}: both sat down`);

  const threw = { ava: false, bo: false };
  const bar = async (p) => (await p.locator('.tb-bar').allInnerTexts().catch(() => [])).join(' ');
  let over = false;
  for (let k = 0; k < 400 && !over; k++) {
    let moved = false;
    for (const [who, p] of [['Bo', bo], ['Ava', ava]]) {
      const text = await bar(p);
      if (/Tap your cards to throw/.test(text)) {
        const key = who === 'Bo' ? 'bo' : 'ava';
        if (!threw[key]) {
          const card = p.locator('.card-tap').first();
          await card.waitFor({ state: 'visible', timeout: 10000 });
          // The hero's cards are fanned and tilted: the next one covers this one's middle, and the corners of its
          // box are off the card. Tap where its rank shows, as a player does.
          const box = await card.boundingBox();
          try { await card.click({ timeout: 8000, position: { x: box ? box.width * 0.3 : 10, y: box ? box.height * 0.3 : 10 } }); } catch (e) {
            const top = await card.evaluate((el) => {
              const r = el.getBoundingClientRect();
              const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return `card ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}; on top: ${at ? at.tagName.toLowerCase() + '.' + [...at.classList].join('.') : 'nothing'}`;
            });
            if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `tables-draw-tap-${who}.png`) });
            const why = (e.message.match(/- .*(intercepts|not stable|not visible|outside|detached|waiting for).*/g) || []).slice(-3).join(' / ');
            throw new Error(`${who} cannot tap a card to throw: ${top}; ${why}`);
          }
          await p.getByRole('button', { name: 'Draw 1', exact: true }).waitFor({ timeout: 5000 });
          await press(p, 'Draw 1', who);
          threw[key] = true;
          moved = true;
        } else {
          // The bar may have moved on since it was read: press Stand pat if it is still there.
          const b = p.locator('.tb-bar .hs-btn:not([disabled])').filter({ hasText: /^Stand pat$/ }).first();
          if (await b.click({ timeout: 3000 }).then(() => true, () => false)) { ok(`${who} presses Stand pat`); moved = true; }
        }
      } else if (/Your turn/.test(text)) {
        // The bar may move on between a look and a press: click what is there now, or look again.
        const btn = p.locator('.tb-bar .hs-btn:not([disabled])').filter({ hasText: /^(Check|Call .*|Bring in .*)$/ }).first();
        const label = await btn.innerText({ timeout: 2000 }).catch(() => '');
        if (label && await btn.click({ timeout: 3000 }).then(() => true, () => false)) { ok(`${who} presses ${label}`); moved = true; }
      }
    }
    over = /Hand over/.test(await bar(ava)) && /Hand over/.test(await bar(bo));
    if (!moved && !over) await sleep(200);
  }
  if (!over) { fail(`${game}: the hand did not finish`); return; }
  ok(`${game}: both bars say Hand over`);

  const avaHands = await api('GET', '/api/hands', null, AVA);
  const boHands = await api('GET', '/api/hands', null, BO);
  if (avaHands.length !== before.ava + 1 || boHands.length !== before.bo + 1) { fail(`${game}: saved hands ${avaHands.length - before.ava}, ${boHands.length - before.bo}`); return; }
  ok(`${game}: each keeps the hand in Hands`);
  // The newest of Ava's kept hands (the list carries no cards; the hand's own route does).
  const newest = avaHands.slice().sort((a, b) => b.id - a.id)[0];
  const avaHand = JSON.parse((await api('GET', `/api/hands/${newest.id}`, null, AVA)).hand_data);
  if (avaHand.gameType !== game) { fail(`${game}: Ava's newest kept hand is ${avaHand.gameType}`); return; }
  const { settleHand } = await import('../vite-app/src/utils/poker-rules/settle.js');
  const finals = settleHand(avaHand).finals.map((v) => Number(v).toLocaleString('en-US'));
  if (game === '2-7 TD') {
    const mine = avaHand.streets.flatMap((s) => s.draws || []).find((d) => d.player === avaHand.heroIdx && d.discarded === 1);
    if (!mine || mine.newCards.length !== 2 || mine.discardedCards.length !== 2) fail(`${game}: Ava's kept hand does not hold her one-card draw (hero ${avaHand.heroIdx}; draws ${JSON.stringify(avaHand.streets.map((s) => s.draws))})`); else ok(`${game}: Ava's kept hand holds her draw (${mine.discardedCards} for ${mine.newCards})`);
  }
  let stacks = [];
  for (let i = 0; i < 80; i++) {
    stacks = await bo.locator('.replayer-seat-stack, [class*="seat-stack"]').allInnerTexts().catch(() => []);
    if (finals.every((f) => stacks.some((s) => s.includes(f)))) break;
    await sleep(250);
  }
  if (!finals.every((f) => stacks.some((s) => s.includes(f)))) fail(`${game}: the felt's stacks ${stacks.join(' | ')}, the settlement ${finals.join(', ')}`);
  else ok(`${game}: the felt ends on the settlement (${finals.join(', ')})`);
  if (SHOTS) {
    await ava.screenshot({ path: path.join(SHOTS, `tables-${game.replace(/\W+/g, '')}-ava.png`) });
    await bo.screenshot({ path: path.join(SHOTS, `tables-${game.replace(/\W+/g, '')}-bo.png`) });
  }
  await press(bo, 'Leave', 'Bo');
  await press(ava, 'Leave', 'Ava');
}

