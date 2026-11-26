// Stages the play-money Tables screens for the guards (check:controls, check:clipping), as drill-states.mjs
// stages the drill: the scheduler's /api/tables routes and the tables service are answered in the page from a real
// runtime Table (lib/tables/runtime.mjs) built here with a fixed deck, so each view is the service's own view, the
// same every run, and needs no tables service. The real thing is covered by npm run test:tables and check:tables.
//
//   await stageTables(p, 'lobby' | 'new' | 'seats' | 'turn' | 'waiting' | 'post' | 'chat' | 'over' | 'stud' | 'draw'
//                       | 'start' | 'new-sng' | 'sng-enter' | 'sng-play' | 'sng-out' | 'sng-done')
// start: a table waiting for its host to start it; the sng- stages a sit and go (owner, 2026-11-26): open for entries,
// under way (the level line on the bar), seen by a player knocked out (the places so far), and won.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Table } from '../lib/tables/runtime.mjs';
import { currentState, toAct as handToAct } from '../vite-app/src/utils/poker-rules/live-hand.js';

const FULL = [...'23456789TJQKA'].flatMap((r) => [...'hdcs'].map((s) => r + s));
const TOP = ['Ah', 'Kd', 'Qs', 'Jc', '2c', '7d', '9h', '3s', '4d'];
const DECK = [...TOP, ...FULL.filter((c) => !TOP.includes(c))];
const HOST = 1, OTHER = 2;
const CFG = {
  id: 'guard1', name: 'Thursday game', hostId: HOST, gameType: 'NLH', blinds: { sb: 50, bb: 100, ante: 0 }, maxSeats: 6,
  buyIn: { min: 2000, max: 10000 }, clock: { decision: 30, bank: 60 },
};

// Stud and a draw game (decision 10): the bring-in's bar, and the draw's (tap the cards on the felt, then Draw or Stand pat).
const GAME_CFG = {
  stud: { ...CFG, gameType: 'Stud Hi', blinds: { sb: 0, bb: 100, ante: 10, bringIn: 50, bigBet: 200 } },
  draw: { ...CFG, gameType: '2-7 TD', blinds: { sb: 50, bb: 100, ante: 0, bigBet: 200 } },
};

const SNG_CFG = { ...CFG, id: 'guard-sng', name: 'Sunday sit and go', maxSeats: 8, blinds: { sb: 10, bb: 20, ante: 0 }, buyIn: { min: 3000, max: 3000 },
  startGate: true, format: 'sng', sng: { buyIn: 1000, stack: 3000, levelMins: 6 } };
const cfgFor = (stage) => (stage.startsWith('sng') ? SNG_CFG : stage === 'start' ? { ...CFG, startGate: true } : GAME_CFG[stage] || CFG);

/* A table in the state a stage needs, and whose view the page is shown. */
function tableFor(stage) {
  let now = 1_700_000_000_000;
  const timers = [];
  const env = {
    now: () => now, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    shuffle: () => DECK.slice(), commit: () => ({ salt: 's', hash: 'h' }),
    onChange: () => {}, onHandDone: () => {}, onCashOut: () => {}, handGapMs: 1000,
  };
  const t = new Table(cfgFor(stage), env);
  if (stage === 'start') { t.sit(HOST, 'Ava', 10000, 0); t.sit(OTHER, 'Bo', 10000, 1); t.sit(3, 'Cy', 10000, 2); return { t, viewer: HOST }; }
  if (stage.startsWith('sng')) {
    const names = ['Ava', 'Bo', 'Cy', 'Dee', 'Eli'];
    if (stage === 'sng-enter') { for (let i = 1; i < 4; i++) t.sit(i + 1, names[i], 3000, i); return { t, viewer: HOST }; }
    names.forEach((n, i) => t.sit(i + 1, n, 3000, i));
    t.startGame(HOST);
    now += 130000;                                    // two minutes in: level 1, four minutes to level 2
    timers.shift().fn();                              // deal
    const who = () => t.seats[t.handSeats[handToAct(t.hand).player]].userId;
    if (stage === 'sng-play') { if (who() === HOST) t.act(HOST, { action: 'call' }); return { t, viewer: HOST }; }
    // The hand folds round to the big blind; then the places as the stage needs them.
    while (t.hand) t.act(who(), { action: 'fold' });
    if (stage === 'sng-out') {
      // Eli and Dee are out (5th, 4th) and their seats cleared; Dee looks on.
      for (const [i, place] of [[4, 5], [3, 4]]) { t.sng.places.push({ userId: i + 1, name: names[i], place, prize: 0 }); t.seats[i] = null; }
      return { t, viewer: 4 };
    }
    // sng-done: Ava has won it.
    const total = t.seats.reduce((a, x) => a + (x ? x.stack : 0), 0);
    t.seats.forEach((x, i) => { if (x) { x.stack = i === 0 ? total : 0; if (i) x.status = 'out'; } });
    t.sng.places = [{ userId: 1, name: 'Ava', place: 1, prize: 3250 }, { userId: 2, name: 'Bo', place: 2, prize: 1750 },
      { userId: 3, name: 'Cy', place: 3, prize: 0 }, { userId: 4, name: 'Dee', place: 4, prize: 0 }, { userId: 5, name: 'Eli', place: 5, prize: 0 }];
    t.sng.finished = true;
    return { t, viewer: HOST };
  }
  if (GAME_CFG[stage]) {
    t.sit(HOST, 'Ava', 10000, 0);
    t.sit(OTHER, 'Bo', 10000, 1);
    timers.shift().fn();   // deal
    const who = () => t.seats[t.handSeats[handToAct(t.hand).player]].userId;
    if (stage === 'draw') {
      // Before the draw: a call and a check, then the viewer is the one to draw.
      for (const move of [{ action: 'call' }, { action: 'check' }]) t.act(who(), move);
    }
    return { t, viewer: who() };
  }
  if (stage === 'seats') { t.sit(OTHER, 'Bo', 10000, 2); return { t, viewer: HOST }; }
  t.sit(HOST, 'Ava', 10000, 0);
  t.sit(OTHER, 'Bo', 10000, 1);
  const start = timers.shift(); start.fn();   // deal
  for (const [who, text] of [[OTHER, 'gl all'], [HOST, 'thanks, you too'], [OTHER, 'that river though']]) { now += 20000; t.say(who, who === HOST ? 'Ava' : 'Bo', text); }
  const toAct = () => t.seats[t.handSeats[currentState(t.hand).legal.player]].userId;
  if (stage === 'turn') return { t, viewer: toAct() };
  // A seat taken mid-hand, waiting for the big blind: its bar offers Post now.
  if (stage === 'post') { t.sit(3, 'Cy', 10000, 2); return { t, viewer: 3 }; }
  if (stage === 'over') { t.act(toAct(), { action: 'fold' }); return { t, viewer: HOST }; }
  // waiting, chat: the host, whose turn it is not.
  if (toAct() === HOST) t.act(HOST, { action: 'call' });
  return { t, viewer: HOST };
}

async function routeTables(p, stage) {
  const origin = new URL(p.url()).origin;
  const svc = `${origin}/__tables`;
  const { t, viewer } = stage === 'lobby' || stage === 'new' || stage === 'new-sng' ? { t: null, viewer: HOST } : tableFor(stage);
  const view = () => t.viewFor(viewer);
  const c = cfgFor(stage);
  const summary = { id: c.id, name: c.name, gameType: c.gameType, blinds: c.blinds, maxSeats: c.maxSeats, buyIn: c.buyIn, clock: c.clock, status: 'open', hostId: HOST,
    format: c.format || 'cash', ...(c.sng ? { sng: c.sng } : {}) };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await p.route((url) => /\/api\/(tables|blocks)(\/|$)|\/__tables\//.test(url.pathname), async (route) => {
    const u = new URL(route.request().url());
    const path = u.pathname;
    if (path.endsWith('/api/tables/availability')) return json(route, { on: true, url: svc });
    if (path.endsWith('/api/tables/chips')) return json(route, { balance: 20000, floor: 5000, start: 20000 });
    if (path.endsWith('/api/tables')) return json(route, { tables: [{ ...summary, invite: 'https://play.futurega.me/join/guardinvitetoken0001' }] });
    if (/\/api\/tables\/[^/]+\/ticket$/.test(path)) return json(route, { ticket: 'guard', url: svc, table: summary });
    if (path.endsWith('/api/blocks')) return json(route, { blocked: [], hidden: [] });
    if (path.endsWith('/join')) return json(route, { token: 'guard', view: view() });
    if (path.endsWith('/events')) {
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }, body: `event: view\ndata: ${JSON.stringify(view())}\n\n` });
    }
    if (path.endsWith('/state')) return json(route, view());
    return json(route, { ok: true });
  });
}

/* The tables are play.futurega.me's, not the app's (owner, 2026-11-22): the page is play.html, the built play page,
   given to the browser at <origin>/__play from this tree's build (public-vite/play.html), so the guards need no play
   host. Its scripts and styles are the server's own: run the guards against a server of this build. */
const PLAY_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public-vite', 'play.html');

// From a fresh load: the play page, under the routes. `force` for the guards' overlay runs.
export async function stageTables(p, stage, { force = false } = {}) {
  const origin = new URL(p.url()).origin;
  await p.route(`${origin}/__play`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(PLAY_HTML, 'utf8') }));
  await routeTables(p, stage);
  await p.goto(`${origin}/__play`, { waitUntil: 'domcontentloaded' });
  const click = (loc) => loc.filter({ visible: true }).first().click({ timeout: 10000, force });
  await p.getByText(/20,000 chips/).first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(400);
  if (stage === 'lobby') return;
  if (stage === 'new' || stage === 'new-sng') {
    // A forced click (the overlay runs) can land while the lobby is still settling: click again until the form is open.
    for (let k = 0; k < 3 && !(await p.locator('.tb-new').isVisible().catch(() => false)); k++) {
      await click(p.getByRole('button', { name: 'New table' })).catch(() => {});
      await p.locator('.tb-new').waitFor({ timeout: 5000 }).catch(() => {});
    }
    await p.locator('.tb-new').waitFor({ timeout: 5000 });
    if (stage === 'new-sng') await p.locator('.tb-new select').first().selectOption('sng', { timeout: 10000 });
    await p.waitForTimeout(400);
    return;
  }
  /* Open with an ordinary click, looked for again if the table did not open: a forced click (the guards' overlay runs
     force theirs) could land while the lobby's list was still settling and be lost (the clipping guard's over, stud and
     draw stayed in the lobby, 2026-11-22). */
  const LOOK = { seats: () => p.getByRole('button', { name: 'Sit down' }), start: () => p.getByRole('button', { name: 'Start the game' }),
    'sng-enter': () => p.getByRole('button', { name: /^Enter for/ }), 'sng-out': () => p.locator('.tb-places') };
  const opened = LOOK[stage] ? LOOK[stage]() : p.locator('.tb-bar');
  for (let k = 0; ; k++) {
    if (await opened.first().isVisible().catch(() => false)) break;
    await p.getByRole('button', { name: 'Open' }).filter({ visible: true }).first().click({ timeout: 10000 }).catch(() => {});
    try { await opened.first().waitFor({ timeout: 6000 }); break; } catch (e) { if (k >= 2) throw e; }
  }
  if (LOOK[stage]) { await p.waitForTimeout(400); return; }
  // The felt plays the hand to where it stands; let it settle before measuring.
  await p.waitForTimeout(stage === 'over' || stage === 'sng-done' ? 4000 : 2500);
  // Everything the bar offers is on the screen: in landscape the raise row wrapped past its foot (2026-11-24).
  const cut = await p.evaluate(() => [...document.querySelectorAll('.tb-bar button, .tb-bar input')].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width && (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5);
  }).map((e) => (e.textContent || e.value || '').trim()));
  if (cut.length) throw new Error(`tables-${stage}: past the edge of the screen: ${cut.join(', ')}`);
  if (stage === 'chat') { await click(p.locator('.tb-chat-btn')); await p.locator('.tb-chat').waitFor({ timeout: 5000 }); await p.waitForTimeout(400); }
}

export const TABLE_STAGES = ['lobby', 'new', 'seats', 'turn', 'waiting', 'post', 'chat', 'over', 'stud', 'draw', 'start', 'new-sng', 'sng-enter', 'sng-play', 'sng-out', 'sng-done'];
