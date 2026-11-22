// Stages the play-money Tables screens for the guards (check:controls, check:clipping), as drill-states.mjs
// stages the drill: the scheduler's /api/tables routes and the tables service are answered in the page from a real
// runtime Table (lib/tables/runtime.mjs) built here with a fixed deck, so each view is the service's own view, the
// same every run, and needs no tables service. The real thing is covered by npm run test:tables and check:tables.
//
//   await stageTables(p, 'lobby' | 'new' | 'seats' | 'turn' | 'waiting' | 'chat' | 'over')
import { Table } from '../lib/tables/runtime.mjs';
import { currentState } from '../vite-app/src/utils/poker-rules/live-hand.js';

const FULL = [...'23456789TJQKA'].flatMap((r) => [...'hdcs'].map((s) => r + s));
const TOP = ['Ah', 'Kd', 'Qs', 'Jc', '2c', '7d', '9h', '3s', '4d'];
const DECK = [...TOP, ...FULL.filter((c) => !TOP.includes(c))];
const HOST = 1, OTHER = 2;
const CFG = {
  id: 'guard1', name: 'Thursday game', hostId: HOST, gameType: 'NLH', blinds: { sb: 50, bb: 100, ante: 0 }, maxSeats: 6,
  buyIn: { min: 2000, max: 10000 }, clock: { decision: 30, bank: 60 },
};

/* A table in the state a stage needs, and whose view the page is shown. */
function tableFor(stage) {
  let now = 1_700_000_000_000;
  const timers = [];
  const env = {
    now: () => now, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    shuffle: () => DECK.slice(), commit: () => ({ salt: 's', hash: 'h' }),
    onChange: () => {}, onHandDone: () => {}, onCashOut: () => {}, handGapMs: 1000,
  };
  const t = new Table(CFG, env);
  if (stage === 'seats') { t.sit(OTHER, 'Bo', 10000, 2); return { t, viewer: HOST }; }
  t.sit(HOST, 'Ava', 10000, 0);
  t.sit(OTHER, 'Bo', 10000, 1);
  const start = timers.shift(); start.fn();   // deal
  for (const [who, text] of [[OTHER, 'gl all'], [HOST, 'thanks, you too'], [OTHER, 'that river though']]) { now += 20000; t.say(who, who === HOST ? 'Ava' : 'Bo', text); }
  const toAct = () => t.seats[t.handSeats[currentState(t.hand).legal.player]].userId;
  if (stage === 'turn') return { t, viewer: toAct() };
  if (stage === 'over') { t.act(toAct(), { action: 'fold' }); return { t, viewer: HOST }; }
  // waiting, chat: the host, whose turn it is not.
  if (toAct() === HOST) t.act(HOST, { action: 'call' });
  return { t, viewer: HOST };
}

async function routeTables(p, stage) {
  const origin = new URL(p.url()).origin;
  const svc = `${origin}/__tables`;
  const { t, viewer } = stage === 'lobby' || stage === 'new' ? { t: null, viewer: HOST } : tableFor(stage);
  const view = () => t.viewFor(viewer);
  const summary = { id: CFG.id, name: CFG.name, gameType: CFG.gameType, blinds: CFG.blinds, maxSeats: CFG.maxSeats, buyIn: CFG.buyIn, clock: CFG.clock, status: 'open', hostId: HOST };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await p.route((url) => /\/api\/(tables|blocks)(\/|$)|\/__tables\//.test(url.pathname), async (route) => {
    const u = new URL(route.request().url());
    const path = u.pathname;
    if (path.endsWith('/api/tables/availability')) return json(route, { on: true, url: svc });
    if (path.endsWith('/api/tables/chips')) return json(route, { balance: 20000, floor: 5000, start: 20000 });
    if (path.endsWith('/api/tables')) return json(route, { tables: [{ ...summary, invite: `${origin}/play/guardinvitetoken0001` }] });
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

// From a fresh load: the Tables tab shows once the scheduler says tables are on, so the page is loaded again
// under the routes. `force` for the guards' overlay runs.
export async function stageTables(p, stage, { force = false } = {}) {
  await routeTables(p, stage);
  await p.reload({ waitUntil: 'domcontentloaded' });
  // Visible ones only: a forced click on .first() takes the hidden twin (the rail's Tables on a phone, the bottom
  // nav's on the desktop).
  const click = (loc) => loc.filter({ visible: true }).first().click({ timeout: 10000, force });
  // The tab with an ordinary click, retried: a forced one fired while the app was still settling after the reload
  // and was lost (the guards' overlay runs force every click).
  const balance = p.getByText(/20,000 chips/).first();
  for (let k = 0; ; k++) {
    await p.getByRole('button', { name: 'Tables', exact: true }).filter({ visible: true }).first().click({ timeout: 10000 });
    try { await balance.waitFor({ timeout: 5000 }); break; } catch (e) { if (k >= 2) throw e; }
  }
  await p.waitForTimeout(400);
  if (stage === 'lobby') return;
  if (stage === 'new') { await click(p.getByRole('button', { name: 'New table' })); await p.waitForTimeout(400); return; }
  await click(p.getByRole('button', { name: 'Open' }));
  if (stage === 'seats') { await p.getByRole('button', { name: 'Sit down' }).waitFor({ timeout: 15000 }); await p.waitForTimeout(400); return; }
  await p.locator('.tb-bar').first().waitFor({ timeout: 15000 });
  // The felt plays the hand to where it stands; let it settle before measuring.
  await p.waitForTimeout(stage === 'over' ? 4000 : 2500);
  if (stage === 'chat') { await click(p.locator('.tb-chat-btn')); await p.locator('.tb-chat').waitFor({ timeout: 5000 }); await p.waitForTimeout(400); }
}

export const TABLE_STAGES = ['lobby', 'new', 'seats', 'turn', 'waiting', 'chat', 'over'];
