// Every game the replayer offers, end to end, through the real screens: pick the row, enter a hand
// with real taps, take it to showdown, step the whole replay, check the winner and the chips, reopen
// the saved hand. The hand for each game is built to tell that game's rules apart from its
// neighbours', so a row scored by the wrong rules shows up as the wrong winner.
//
//   node scripts/check-replayer-games.mjs [baseUrl] [--only "Razz,PLO8"] [--width 402] [--height 874]
//                                         [--jobs 3] [--out dir]
//
// CHECK_BASE_URL / CHECK_TOKEN as the other guards. Scratch servers only: it saves hands.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {} };
globalThis.window = globalThis.window || globalThis;
const src = (f) => pathToFileURL(path.join(import.meta.dirname, '..', 'vite-app', 'src', 'utils', f)).href;
const { buildCatalog } = await import(src('variant-catalog.js'));
const { HAND_CONFIG } = await import(src('utils.js'));
const { goldenFinals } = await import(pathToFileURL(path.join(import.meta.dirname, '..', 'test', 'hh-io', 'golden-finals.mjs')).href);

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const base = (args.find((a) => /^https?:/.test(a)) || process.env.CHECK_BASE_URL || '').replace(/\/$/, '');
if (!base || /:3001\b/.test(base)) { console.error('Point this at a scratch server: it saves hands.'); process.exit(2); }
const W = Number(opt('--width', 402)), H = Number(opt('--height', 874)), JOBS = Number(opt('--jobs', 3)), SEATS = Number(opt('--seats', 8));
const only = opt('--only', null);
const OUT = opt('--out', null);
const token = process.env.CHECK_TOKEN;

const cards = (s) => (s.match(/[2-9TJQKA][hdcs]/g) || []);

// The hands. `expect` is who the game's own rules say wins. Names of hands are in the comments.
const COMMUNITY_HI = { hero: 'AhAd', opp: 'KhKd', boards: [['2c7d9s', 'Jc', '3h']], expect: 'hero' };
const OMAHA_HI = (n) => ({
  // Hero's nut flush uses exactly two; the opponent's set is second best.
  hero: 'AhKh2c3d4c6c'.slice(0, n * 2), opp: 'JsJdTc9c2s4s'.slice(0, n * 2),
  boards: [['Jc5h9h', '3h', '8d']], expect: 'hero',
});
const OMAHA_HILO = (n) => ({
  // The opponent's seven-high straight takes the high, hero's 7-6-5-2-A the low.
  hero: 'Ac2cKdKsJdTd'.slice(0, n * 2), opp: '3h4hQdQsKcJh'.slice(0, n * 2),
  boards: [['5s6d7c', 'Qc', '9h']], expect: 'split',
});
const STUD_HI = { hero: ['AhAd', 'As', '2c', '3d', '7h', '9s'], opp: ['KhKd', 'Ks', '4c', '5d', '8h', 'Js'], expect: 'hero' };
const STUD_8 = { hero: ['Ad2c', '3h', '4d', '6s', 'Kc', 'Qd'], opp: ['KhKd', 'Ks', '9c', '9d', 'Tc', 'Js'], expect: 'split' };
const RAZZ = { hero: ['Ah2h', '3d', '4c', '6s', 'Kc', 'Qd'], opp: ['2c3s', '4d', '5c', '7h', 'Jd', 'Qc'], expect: 'hero' };
// A wheel in Razz; in 2-7 the ace is high and 2-3-4-5-7 beats it.
const RAZZ_27 = { hero: ['Ah2h', '3d', '4c', '5s', '9d', 'Kc'], opp: ['2c3s', '4d', '5c', '7h', 'Jd', 'Qc'], expect: 'opp' };
const BOMB = { ...OMAHA_HI(4), boards: [['Jc5h9h', '3h', '8d'], ['QdQs7d', '6s', 'Ts']], expect: 'split' };
const DOUBLE_HE = { hero: 'AhAd', opp: 'KhKd', boards: [['2c7d9s', 'Jc', '3h'], ['Kc4d5s', '8c', 'Tc']], expect: 'split' };
const LOW_27 = (rounds) => ({ hero: '2c3d4h5s9c', opp: '2d3h4s5c8d', discard: '9c', draw: '7d', rounds, expect: 'hero' });
const LOW_A5 = (rounds) => ({ hero: 'Ac2d3h4s9c', opp: '2c3d4h5s7c', discard: '9c', draw: '5d', rounds, expect: 'hero' });
const BADUGI = { hero: 'Ah2c3d9s', opp: '2h3c4d5s', discard: '9s', draw: '4s', rounds: 3, expect: 'hero' };
const BADEUCY = { hero: '2c3d4h5s9c', opp: '2d3h4c8sKd', discard: '9c', draw: '7d', rounds: 3, expect: 'hero' };
const BADACY = { hero: 'Ac2d3h4s9c', opp: '2c3d4h8sKd', discard: '9c', draw: '5d', rounds: 3, expect: 'hero' };
const DRAW_HI = (rounds) => ({ hero: 'AhAdKcQs9c', opp: 'KhKd7c8d2s', discard: '9c', draw: 'Ac', rounds, expect: 'hero' });

// A row's own name can say more than its engine type knows.
// Hands that tell the two-hand games from their neighbours: scored by a neighbour's rules, each pays someone else.
const DRAMAHA_BOARD = [['AhKc9d', 'Jh', '8c']];
const DRAMAHA = (opp) => ({ hero: 'AsAdQh6c2s', opp, discard: '2s', draw: '3s', rounds: 1, boards: DRAMAHA_BOARD, expect: 'split' });
const TRUTH = {
  '2-7 Razz': { plan: RAZZ_27, why: 'in 2-7 Razz the ace is high' },
  'Double Board Bomb Pot': { plan: BOMB },
  // The thrown ace is gone: kept, it would make hero's three aces; without it the kings win.
  'Pineapple': { plan: { hero: 'QhQdAh', opp: 'KhKd', discard: 'Ah', boards: [['AdAc2s', '5h', '9c']], expect: 'opp' } },
  // The first flop card goes out before the first bet.
  'Courchevel': { plan: { hero: 'AhKh2c3d4c', opp: 'JsJdTc9c2s', boards: [['Jc', '5h9h', '3h', '8d']], expect: 'hero' } },
  // A king-high low has no 8, and takes half here.
  'Stud Hi/Lo Regular': { plan: { hero: ['Kd9h', '7s', '6c', '4d', '3h', 'Jc'], opp: ['AhAd', 'As', 'Kh', 'Ks', 'Qd', 'Qc'], expect: 'split' } },
  // The wheel takes the razz half, the seven-card badugi the other.
  'Razzdugi': { plan: { hero: ['As2s', '3s', '4c', '5c', '9c', 'Ks'], opp: ['2h3d', '7s', '8c', 'Th', 'Jd', 'Qh'], expect: 'split' } },
  // In 2-7 the ace plays high, so the seven low takes that half from A-2-3-4-5.
  'Razzdeucy': { plan: { hero: ['2c3c', '4c', '5c', '7d', '9d', 'Jd'], opp: ['Ah2h', '3s', '4s', '5d', 'Kh', 'Qh'], expect: 'split' } },
  // The same two hands, one qualifier apart: sevens qualify for 66 and not for 99.
  'Archie 66': { plan: { hero: '7h7dKcQh9c', opp: '2d3h4s5c8d', discard: '9c', draw: '2s', rounds: 3, expect: 'split' } },
  'Archie 99': { plan: { hero: '7h7dKcQh9c', opp: '2d3h4s5c8d', discard: '9c', draw: '2s', rounds: 3, expect: 'opp' } },
  // The community nine makes hero's qualifying pair; without it the low would scoop.
  'Ari': { plan: { hero: '9hKdQc7s3c', opp: '2d3h4s5c8d', discard: '3c', draw: '4d', rounds: 3, boards: [['9d']], expect: 'split' } },
  // Hero's three aces take the Omaha half every time; the draw half is the game's own.
  'Dramaha Hi': { plan: DRAMAHA('KsKdKh5c6d') },
  'Dramaha 2-7': { plan: DRAMAHA('2d3h4s5c7h') },
  'Dramaha 49': { plan: DRAMAHA('TsTdTh9h9c') },
  'Dramaha 0': { plan: DRAMAHA('KsKdQsJs2h') },
  'Dramadugi': { plan: DRAMAHA('2d3h4s5c9h') },
  // Three aces leave K-T-5, a bust; the opponent's nines leave K-Q-A, 21.
  'Omajack': { plan: { hero: 'AsAdKhTc5c', opp: '9h9cKdQsAc', boards: [['Ah7d2c', '9s', '4c']], expect: 'split' } },
};
const BETTING = { 'No Limit': 'nl', 'Pot Limit': 'pl', 'Limit': 'fl' };

function planFor(row) {
  const t = row.gameType;
  const truth = TRUTH[row.game] || {};
  if (truth.plan) return truth.plan;
  const cfg = HAND_CONFIG[t] || {};
  if (t === 'OFC') return { ofc: true };
  if (['NLH', 'LHE', 'PLH'].includes(t)) return COMMUNITY_HI;
  if (t === 'Short Deck') return { hero: 'AhAd', opp: 'KhKd', boards: [['6c7d9s', 'Jc', '8h']], expect: 'hero' };
  if (['PLO', 'NLO', 'LO Hi', 'PLO5', 'PLO6'].includes(t)) return OMAHA_HI(cfg.heroCards);
  if (['PLO8', 'O8', 'NLO8', 'Big O', 'NL Big O', 'L Big O', 'PLO6 8/b'].includes(t)) return OMAHA_HILO(cfg.heroCards);
  if (/Stud Hi$/.test(t)) return STUD_HI;
  if (/Stud 8$/.test(t)) return STUD_8;
  if (/Razz$/.test(t)) return RAZZ;
  if (/2-7 TD$/.test(t)) return LOW_27(3);
  if (t === 'NL 2-7 SD') return LOW_27(1);
  if (t === 'A-5 TD') return LOW_A5(3);
  if (t === 'NL A-5 SD') return LOW_A5(1);
  if (t === 'Badugi') return BADUGI;
  if (t === 'Badeucy') return BADEUCY;
  if (t === 'Badacy') return BADACY;
  if (t === 'PL 5CD Hi' || t === 'NL 5CD Hi') return DRAW_HI(1);
  return null;
}

function allPlanCards(plan) {
  const out = [];
  for (const v of [plan.hero, plan.opp, plan.draw]) {
    if (Array.isArray(v)) v.forEach((s) => out.push(...cards(s)));
    else if (v) out.push(...cards(v));
  }
  (plan.boards || []).forEach((b) => b.forEach((s) => out.push(...cards(s))));
  return out;
}

const RANKS = 'AKQJT98765432'.split('');
function fillerPool(plan, shortDeck) {
  const used = new Set(allPlanCards(plan));
  const out = [];
  // Middling cards, so no filler decides anything or sets off a stud bring-in surprise.
  for (const r of RANKS) for (const s of 'hdcs') {
    if (shortDeck && '2345'.includes(r)) continue;
    if (!used.has(r + s)) out.push(r + s);
  }
  return out;
}

// Every hand name at the showdown has to be on the screen and whole: the sentence the replay builds to. A name wider
// than its plaque used to run off the left edge at a side seat, and the name cuts to an ellipsis at its cap.
async function handNameTrouble(p) {
  return p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll('.replayer-seat-hand-name')].flatMap((el) => {
      const r = el.getBoundingClientRect();
      const text = el.textContent.trim();
      const out = [];
      if (r.left < 0 || r.right > vw) out.push(`"${text}" runs off the screen (${r.left.toFixed(1)} to ${r.right.toFixed(1)} of ${vw})`);
      if (el.scrollWidth > el.clientWidth + 1) out.push(`"${text}" is cut short (${el.scrollWidth} wide in ${el.clientWidth})`);
      return out;
    });
  });
}

// What sits on the felt at the end: the pot and its split shares clear of the board, and the game-and-stakes pill whole
// (it used to cut the stakes on a long line, and a split's second row ran into the top of the cards).
async function feltTrouble(p) {
  return p.evaluate(() => {
    const out = [];
    const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const rows = [...document.querySelectorAll('.replayer-board-area')].map((el) => el.getBoundingClientRect());
    const plaques = [...document.querySelectorAll('.replayer-seat-info')].map((el) => el.getBoundingClientRect());
    for (const el of document.querySelectorAll('.replayer-pot-display')) {
      const r = el.getBoundingClientRect();
      const what = `the pot${el.querySelector('.replayer-split-shares') ? ' and its split' : ''}`;
      const row = rows.find((b) => hit(r, b));
      if (row) out.push(`${what} runs into the cards (to ${r.bottom.toFixed(1)}, cards from ${row.top.toFixed(1)})`);
      const plaque = plaques.find((b) => hit(r, b));
      if (plaque) out.push(`${what} runs into a seat (from ${r.top.toFixed(1)}, seat to ${plaque.bottom.toFixed(1)})`);
    }
    for (const el of document.querySelectorAll('.replayer-level-blinds')) {
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) out.push(`"${text}" is cut short (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`);
      const r = el.getBoundingClientRect();
      if (rows.some((b) => hit(r, b))) out.push(`"${text}" runs into the cards`);
    }
    return out;
  });
}

async function runRow(browser, row) {
  const res = { row: row.label || row.name, game: row.game, gameType: row.gameType, rare: !!row.rare, steps: 0, problems: [], notes: [] };
  const problem = (m) => res.problems.push(m);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: W < 600 ? 2 : 1, hasTouch: W < 600 });
  await ctx.addInitScript((t) => { localStorage.setItem('token', t); localStorage.setItem('authToken', t); localStorage.setItem('tutorialDone', '1'); }, token);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/access control/.test(e.message)) errors.push(e.message.split('\n')[0]); });
  p.setDefaultTimeout(6000);
  const plan = row.plan || planFor(row);
  if (!plan) { problem('no test hand for game type ' + row.gameType); await ctx.close(); return res; }
  res.expect = plan.expect;

  const tap = async (loc, label) => {
    try { await loc.click({ timeout: 2500 }); }
    catch (e) {
      if (!(await loc.count())) throw new Error('nothing to tap: ' + label);
      res.notes.push('needed a forced tap: ' + label);
      await loc.evaluate((el) => el.click());
    }
    await p.waitForTimeout(60);
  };
  const pick = async (card, scope = '') => {
    const b = p.locator(`${scope} .card-picker-btn:has(img[alt="${card}"])`).first();
    if (!(await b.count())) throw new Error('no picker card ' + card);
    if (await b.isDisabled()) throw new Error('card already used: ' + card);
    await tap(b, 'card ' + card);
  };
  const primary = (text) => p.locator('.gto-entry button.btn-primary, .replayer-entry-view button.btn-primary').filter({ hasText: text }).first();

  try {
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2600);
    await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 700 }).catch(() => {});
    await p.addStyleTag({ content: '.grid-dev-toggle{display:none!important}' }).catch(() => {});
    await p.locator(W >= 1024 ? '.dk-rail-item:has-text("Hands")' : '.bottom-nav .nav-tab:has-text("Hands")').first().click();
    await p.waitForTimeout(900);

    // ── The picker ──
    await p.locator('.vp-launcher').first().click();
    await p.locator('input[aria-label="Search games"]').fill(row.mix || row.name);
    await p.waitForTimeout(150);
    const target = row.mix
      ? p.locator('.vp-mixblock').filter({ hasText: row.mix }).first().locator('button').filter({ hasText: row.name }).first()
      : p.locator('.vp-list button').filter({ has: p.locator(`.vp-row-name:text-is("${row.name}")`) }).first();
    if (!(await target.count())) throw new Error('the picker does not find it by its own name');
    await target.click();
    await p.waitForTimeout(500);
    if (row.game === 'Short Deck') {
      const q = p.locator('[role="dialog"] button').first();
      if (await q.count()) { await q.click(); await p.waitForTimeout(300); }
    }
    if (row.toggle) {
      // A toggle sits under the launcher: back out of the entry the pick opened, set it, create again.
      if (await p.locator('.gto-entry').count()) {
        await p.locator('.gto-entry button:has-text("Cancel")').first().click();
        await p.waitForTimeout(500);
      }
      await p.locator('.game-check-row').filter({ hasText: new RegExp('^\\s*' + row.toggle, 'i') }).first().click();
      await p.waitForTimeout(150);
    }
    if (!(await p.locator('.gto-entry').count())) {
      const create = p.locator('.replayer-list-create button').first();
      await create.click();
      await p.waitForTimeout(500);
    }
    if (!(await p.locator('.gto-entry').count())) throw new Error('the entry screen did not open');

    // ── Entry, one screen at a time ──
    const cfg = HAND_CONFIG[row.gameType] || {};
    const shortDeck = !!cfg.shortDeck;
    const fillers = fillerPool(plan, shortDeck);
    const handSize = plan.hero && !Array.isArray(plan.hero) ? cards(plan.hero).length : 0;
    let heroBet = false, oppDealt = 0, heroName = null, street = 0, seatsSet = false, doorDone = false, drew = 0;
    let studHeroAt = 2, studOppAt = 2, boardsAt = 0;
    const title = `${row.label || row.name} ${SEATS}h ${Date.now() % 100000}`;

    for (let guard = 0; guard < 400; guard++) {
      if (await p.locator('button[title="End"]').count()) break;
      if (await p.locator('.replayer-error, [data-replay-error]').count()) throw new Error('the error screen showed');
      const screen = await p.evaluate(() => {
        const vis = (sel) => [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().height > 0);
        return { section: vis('.replayer-section-title')?.textContent.trim() || '', label: vis('.gto-street-label')?.textContent.trim() || '',
          active: !!vis('.gto-seat.active'), activeName: vis('.gto-seat.active .gto-seat-name')?.textContent.trim() || '',
          next: !!vis('button.btn-primary') && [...document.querySelectorAll('button.btn-primary')].some((b) => b.textContent.trim() === 'Next' && b.getBoundingClientRect().height > 0) };
      });

      if (screen.section === 'OFC Card Placement') throw new Error('OFC: see the OFC pass');
      if (screen.next) {
        if (!seatsSet) {
          seatsSet = true;
          const sel = p.locator('.gto-entry select').first();
          if (await sel.count()) { await sel.selectOption(String(SEATS)).catch(() => {}); await p.waitForTimeout(150); }
          // The title finds this hand in the saved list.
          const titleBox = p.locator('input[placeholder*="Huge pot"]').first();
          if (await titleBox.count()) { await titleBox.fill(title); await p.waitForTimeout(80); }
        }
        await tap(primary('Next'), 'Next');
        continue;
      }
      if (screen.section === '3rd Street') {
        for (const c of cards(plan.hero[0] + plan.hero[1])) await pick(c);
        await tap(primary('Enter Door Cards'), 'Enter Door Cards');
        continue;
      }
      if (screen.section === 'Opponent Door Cards') {
        // Slot order is seat order: Opp 1 is first, and it is the one that stays in.
        await pick(cards(plan.opp[1])[0]);
        const rows = await p.locator('.gto-deal-row').count();
        for (let i = 1; i < rows; i++) await pick(fillers.pop());
        await tap(primary('Start Action'), 'Start Action');
        doorDone = true;
        continue;
      }
      if (screen.section.startsWith('Deal ')) {
        const heroC = plan.hero[studHeroAt++]; const oppC = plan.opp[studOppAt++];
        const rows = p.locator('.gto-deal-row');
        const n = await rows.count();
        for (let i = 0; i < n; i++) {
          const name = (await rows.nth(i).locator('.gto-deal-name').textContent()).trim();
          await tap(rows.nth(i), 'deal row');
          await pick(name === 'Opp 1' ? oppC : /^Opp /.test(name) ? fillers.pop() : heroC);
        }
        await tap(primary('Continue'), 'stud Continue');
        continue;
      }
      if (screen.label.startsWith('Deal the')) {
        const b = plan.boards[0][boardsAt];
        for (const c of cards(b)) await pick(c);
        if (plan.boards[1]) {
          await tap(p.locator('button:has-text("Next: Board 2")').first(), 'Next board');
          for (const c of cards(plan.boards[1][boardsAt])) await pick(c);
        }
        boardsAt++;
        await tap(p.locator('.gto-btn-row button.btn-primary').filter({ hasText: /Continue|Start Action/ }).first(), 'board Continue');
        continue;
      }
      if (screen.section === 'Draw Round') {
        const declare = p.locator('.gto-draw-buttons');
        if (await declare.count()) {
          const seat = p.locator('.gto-seat.active').first();
          const name = (await seat.locator('.gto-seat-name').textContent()).trim();
          const isOpp = /^Opp /.test(name);
          if (!isOpp && drew === 0) await tap(seat.locator('.gto-draw-btn', { hasText: /^1$/ }), 'draw 1');
          else await tap(seat.locator('.gto-draw-btn.pat'), 'stand pat');
          if (!isOpp) drew++;
          continue;
        }
        await tap(p.locator('.gto-btn-row button.btn-primary').first(), 'draw round done');
        continue;
      }
      if (/^Card [Dd]etails/.test(screen.section)) {
        const discardCard = cards(plan.discard)[0];
        const img = p.locator(`.gto-dce-hand img[alt="${discardCard}"]`).first();
        if (await img.count()) await tap(img, 'discard ' + discardCard);
        const nw = p.locator('.gto-dce-fields .replayer-field').nth(1).locator('input');
        if (await nw.count()) await nw.fill(plan.draw);
        await tap(p.locator('.gto-btn-row button.btn-primary').filter({ hasText: 'Continue' }).first(), 'draw details Continue');
        continue;
      }
      if (screen.label === 'Showdown') {
        const needed = cards(Array.isArray(plan.opp) ? plan.opp.join('') : plan.opp);
        // A stud opponent's up cards are in already; only the hidden ones are asked for.
        for (const c of (Array.isArray(plan.opp) ? cards(plan.opp[0]).concat(cards(plan.opp[6] || '')) : needed)) {
          const b = p.locator(`.gto-phase-card .card-picker-btn:has(img[alt="${c}"])`).first();
          if (await b.count() && !(await b.evaluate((el) => el.classList.contains('selected')))) await tap(b, 'showdown ' + c);
        }
        // Any other opponent still in shows nothing: they muck, as a player would mark them. A hand left
        // blank is not judged (entry audit 11), so the winner would be left for the user to mark.
        for (const head of await p.locator('.gto-sd-head').all()) {
          const nm = ((await head.locator('.gto-sd-name').innerText().catch(() => '')) || '').trim();
          if (!nm || nm === 'Opp 1') continue;
          const m = head.locator('button:has-text("Muck")').first();
          if (await m.count()) await tap(m, 'muck ' + nm);
        }
        await tap(p.locator('.gto-btn-row button.btn-primary:has-text("Continue")').first(), 'Continue to the result');
        continue;
      }
      if (screen.section === 'Result') {
        res.resultScreen = await p.locator('.gto-winner-btn').allInnerTexts();
        await tap(p.locator('button.btn-primary:has-text("Save & Replay")').first(), 'Save & Replay');
        await p.waitForTimeout(1200);
        continue;
      }
      if (screen.active) {
        const name = screen.activeName;
        const isOpp = name === 'Opp 1';
        const isHero = !/^Opp /.test(name);
        if (isHero) {
          heroName = name;
          if (await p.locator('.gto-hero-picker:not(.has-cards)').count()) {
            const want = cards(plan.hero);
            for (const c of want) {
              const b = p.locator(`.gto-hero-picker .card-picker-btn:has(img[alt="${c}"])`).first();
              if (!(await b.evaluate((el) => el.classList.contains('selected')))) await tap(b, 'hero ' + c);
            }
          }
        }
        const labels = await p.locator('.gto-seat.active .gto-action-btn .gto-action-label').allTextContents();
        const btn = (re) => p.locator('.gto-seat.active .gto-action-btn').filter({ has: p.locator('.gto-action-label', { hasText: re }) }).first();
        const has = (re) => labels.some((l) => re.test(l));
        if (!labels.length) throw new Error('no action buttons for ' + name);
        if (!isHero && !isOpp) {
          if (has(/^Bring In/)) await tap(btn(/^Bring In/), 'bring in');
          else if (has(/^Fold/)) await tap(btn(/^Fold/), 'fold');
          else await tap(btn(/^Check/), 'check');
        } else if (isHero && has(/^Complete/)) {
          // Hero completes, so whoever brought in has to fold or call rather than check along.
          await tap(btn(/^Complete/), 'complete');
        } else if (isHero && has(/^Check/) && !heroBet && (street++ > 0 || !has(/^Bet|^Pot/))) {
          // One real bet in the hand, on the first street hero can open.
          if (has(/^Bet /)) await tap(btn(/^Bet /), 'bet');
          else if (has(/^Pot/)) await tap(btn(/^Pot/), 'pot');
          else if (has(/^Bet$/)) {
            await tap(btn(/^Bet$/), 'bet');
            await tap(p.locator('.gto-raise-input-row button.btn-primary:has-text("Confirm")').first(), 'confirm bet');
          } else await tap(btn(/^Check/), 'check');
          heroBet = true;
        } else if (has(/^Check/)) await tap(btn(/^Check/), 'check');
        else if (has(/^Bring In/)) await tap(btn(/^Bring In/), 'bring in');
        else if (has(/^Call/)) await tap(btn(/^Call/), 'call');
        else throw new Error('no way to continue from: ' + labels.join(', '));
        continue;
      }
      await p.waitForTimeout(250);
      if (guard > 395) throw new Error('entry stuck: ' + JSON.stringify(screen));
    }
    if (!(await p.locator('button[title="End"]').count())) throw new Error('never reached the replay');

    // ── The replay, step by step ──
    // What is on the felt before the first bet: a door card already out, Pineapple's three cards still held.
    const feltNow = () => p.evaluate(() => ({
      board: document.querySelectorAll('.replayer-board-area:not(.replayer-dead-area) .card-row > [data-slot]').length,
      hero: document.querySelector('.replayer-seat.is-hero .card-row')?.querySelectorAll('.card-img, .card-classic').length ?? null,
    }));
    await p.locator('button[title="Start"], button[title="Restart"], button[title="Beginning"]').first().click({ force: true, timeout: 800 }).catch(() => {});
    await p.waitForTimeout(250);
    const atStart = await feltNow();
    if (atStart.board !== (cfg.doorBoard || 0)) problem(`${atStart.board} board cards before the first bet, the game deals ${cfg.doorBoard || 0}`);
    if (cfg.showCards && atStart.hero != null && atStart.hero !== cfg.heroCards) problem(`hero holds ${atStart.hero} cards before the throw, not ${cfg.heroCards}`);
    const forward = p.locator('button[title="Forward"]').first();
    for (let i = 0; i < 200; i++) {
      if (await forward.isDisabled()) break;
      await forward.click({ force: true });
      res.steps++;
      await p.waitForTimeout(70);
      if (await p.locator('text=/Something went wrong|could not be shown/i').count()) throw new Error('the replay crashed at step ' + i);
    }
    if (cfg.showCards) {
      const atEnd = await feltNow();
      if (atEnd.hero != null && atEnd.hero !== cfg.showCards) problem(`hero ends on ${atEnd.hero} cards, not ${cfg.showCards}`);
    }
    const seats = () => p.evaluate(() => [...document.querySelectorAll('.replayer-seat')].map((s) => ({
      name: s.querySelector('.replayer-seat-name')?.textContent.trim(),
      stack: s.querySelector('.replayer-seat-stack')?.textContent.trim(),
      cards: s.querySelectorAll('.card-row .card-img, .card-row .card-classic').length,
      out: (() => { const r = s.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1; })(),
    })));
    const parse = (t) => { const m = /([\d,.]+)\s*([kKmM]?)/.exec(t || ''); if (!m) return null; const n = parseFloat(m[1].replace(/,/g, '')); return n * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1); };
    // The last press ships the pot on a spring: read the chips once they have landed.
    const expectTotal = (cfg.isStud ? 400 * 30 : 50000) * SEATS;
    let end = await seats();
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(150);
      end = await seats();
      if (Math.abs(end.reduce((a, s) => a + (parse(s.stack) || 0), 0) - expectTotal) < 1) break;
    }
    res.seats = end.length;
    res.end = end.map((s) => `${s.name}: ${s.stack}`);
    if (end.some((s) => s.out)) problem('a seat runs off the screen: ' + end.filter((s) => s.out).map((s) => s.name).join(', '));
    const hero = end.find((s) => !/^Opp /.test(s.name || ''));
    const opp = end.find((s) => /^Opp 1$/.test(s.name || '') || /^O\. ?1|Opp 1/.test(s.name || ''));
    if (!hero || !opp) problem('could not read the seats: ' + JSON.stringify(res.end));
    else {
      const h = parse(hero.stack), o = parse(opp.stack);
      res.heroEnd = h; res.oppEnd = o;
      // Heads up the hero is the small blind and the opponent the big blind, who alone paid the ante on a flop
      // game: a fair split still leaves them that ante's half either side of even.
      const skew = SEATS === 2 && cfg.hasBoard ? 200 : 0;
      const winner = Math.abs(h - o - skew) <= Math.max(h, o) * 0.002 ? 'split' : h > o ? 'hero' : 'opp';
      res.winner = winner;
      if (winner !== plan.expect) problem(`wrong winner: the ${TRUTH[row.game]?.plan ? 'rules of ' + row.game : 'hand'} says ${plan.expect}, the replay paid ${winner} (${hero.stack} / ${opp.stack})`);
      const total = end.reduce((a, s) => a + (parse(s.stack) || 0), 0);
      res.total = total;
      if (end.length === SEATS && Math.abs(total - expectTotal) >= 1) problem(`chips do not balance: ${total} on the table, ${expectTotal} at the start`);
    }
    if (end.length !== SEATS) problem(`${end.length} seats at a ${SEATS}-handed table`);
    for (const t of await handNameTrouble(p)) problem('hand name ' + t);
    for (const t of await feltTrouble(p)) problem('felt: ' + t);
    if (cfg.betting && BETTING[row.structure] && BETTING[row.structure] !== cfg.betting) problem(`wrong betting: the row says ${row.structure}, it plays ${cfg.betting}`);
    if (OUT) await p.screenshot({ path: path.join(OUT, (row.label || row.name).replace(/[^\w]+/g, '-') + '.png') });

    // ── Back to the list, and open what was saved ──
    const firstEnd = end.map((s) => s.stack).join('|');
    await p.locator('button:has-text("Back")').first().click({ force: true });
    await p.waitForTimeout(1400);
    const savedCard = p.locator('.replayer-hand-card.is-row').filter({ hasText: title }).first();
    if (!(await savedCard.count())) problem('its title is not in the saved list: ' + title);
    else {
      await savedCard.click();
      await p.locator('button[title="End"]').first().waitFor({ timeout: 6000 });
      await p.waitForTimeout(500);
      await p.locator('button[title="End"]').first().click({ force: true });
      await p.waitForTimeout(2600);
      const again = (await seats()).map((s) => s.stack).join('|');
      if (again !== firstEnd) problem(`reopened, the chips differ: ${firstEnd} then ${again}`);
      // What the ending SAYS, as well as what it pays: a share link once lost "Hi/Lo split" with the chips still right.
      const ending = () => [...document.querySelectorAll('.replayer-pot-display, .replayer-seat-hand-name')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
      const sayingSaved = await p.evaluate(ending);

      // ── Share: the link opens for someone with no account, and shows the same ending ──
      await p.locator('button:has-text("Share")').first().click({ force: true });
      await p.waitForTimeout(350);
      const [linkRes] = await Promise.all([
        p.waitForResponse((r) => /\/api\/hand-links$/.test(r.url()) && r.request().method() === 'POST', { timeout: 6000 }),
        p.locator('.share-menu-item:has-text("Copy link")').first().click({ force: true }),
      ]);
      const link = await linkRes.json().catch(() => null);
      if (!linkRes.ok() || !link?.id) problem('Copy link did not make a link: ' + linkRes.status());
      else {
        res.link = link.id;
        const anon = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
        const q = await anon.newPage();
        const anonErrors = [];
        q.on('pageerror', (e) => { if (!/access control/.test(e.message)) anonErrors.push(e.message.split('\n')[0]); });
        await q.goto(base + '/h/' + link.id, { waitUntil: 'domcontentloaded' });
        await q.locator('button[title="End"]').first().waitFor({ timeout: 12000 }).catch(() => {});
        if (!(await q.locator('button[title="End"]').count())) problem('the shared link did not open a replay for someone signed out');
        else {
          await q.waitForTimeout(500);
          await q.locator('button[title="End"]').first().click({ force: true });
          await q.waitForTimeout(2600);
          const shared = await q.evaluate(() => [...document.querySelectorAll('.replayer-seat')].map((s) => s.querySelector('.replayer-seat-stack')?.textContent.trim()));
          if (shared.join('|') !== firstEnd) problem(`the shared link ends differently: ${firstEnd} then ${shared.join('|')}`);
          const sayingShared = await q.evaluate(ending);
          if (sayingShared !== sayingSaved) problem(`the shared link reads differently: ${sayingSaved} then ${sayingShared}`);
        }
        if (anonErrors.length) problem('page errors on the shared link: ' + [...new Set(anonErrors)].join(' | '));
        await anon.close();
      }
      await p.waitForTimeout(300);

      // ── Image: a still of the hand ──
      await p.locator('button:has-text("Share")').first().click({ force: true });
      await p.waitForTimeout(300);
      const before = errors.length;
      const dl = p.waitForEvent('download', { timeout: 7000 }).catch(() => null);
      await p.locator('.share-menu-item:has-text("Image")').first().click({ force: true });
      const file = await dl;
      res.image = file ? await file.suggestedFilename() : null;
      if (errors.length > before) problem('the image share threw: ' + errors.slice(before).join(' | '));
      await p.waitForTimeout(200);
      await p.locator('button:has-text("Back")').first().click({ force: true });
      await p.waitForTimeout(500);
    }
    const saved = await p.evaluate(async (t) => {
      const r = await fetch('/api/replayer/hands', { headers: { Authorization: 'Bearer ' + t } });
      const rows = await r.json();
      return rows.map((h) => ({ id: h.id, gameType: h.game_type || h.gameType }));
    }, token);
    const mine = saved.filter((h) => h.gameType === row.gameType);
    if (!mine.length) problem('not in the saved hands after Back');
    else {
      const cardsOnList = p.locator('.replayer-hand-card.is-row');
      if (!(await cardsOnList.count())) problem('the saved list shows nothing');
      else {
        const id = Math.max(...mine.map((h) => h.id));
        await p.evaluate(async ({ id, t }) => { window.__h = await (await fetch('/api/replayer/hands/' + id, { headers: { Authorization: 'Bearer ' + t } })).json(); }, { id, t: token });
        res.savedId = id;
      }
    }
  } catch (e) {
    problem('STOPPED: ' + e.message.split('\n')[0]);
    if (OUT) await p.screenshot({ path: path.join(OUT, 'FAIL-' + (row.label || row.name).replace(/[^\w]+/g, '-') + '.png') }).catch(() => {});
  }
  if (errors.length) problem('page errors: ' + [...new Set(errors)].join(' | '));
  await ctx.close();
  return res;
}

const catalog = buildCatalog([]);
const rowNamed = (n) => catalog.find((r) => r.name === n);
const EXTRAS = [
  { ...rowNamed("No Limit Hold'em"), label: 'Double board Hold\'em', toggle: 'Double board', plan: DOUBLE_HE },
  { ...rowNamed('Pot Limit Omaha'), label: 'Double board PLO', toggle: 'Double board', plan: BOMB },
  { ...rowNamed('Razz'), label: 'Razz in HORSE', mix: 'HORSE' },
  { ...rowNamed('O8'), label: 'O8 in the 8-Game', mix: '8-Game Mix' },
];
const rows = catalog.filter((r) => r.gameType !== 'OFC').concat(EXTRAS)
  .filter((r) => !only || only.split(',').some((o) => (r.label || r.name).toLowerCase().includes(o.trim().toLowerCase())));
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const browser = await webkit.launch();
const results = [];

// OFC has no betting and no winner to work out: thirteen cards each, placed row by row, and a replay of the board.
async function runOfc() {
  const res = { row: 'OFC', gameType: 'OFC', steps: 0, problems: [], notes: [] };
  const problem = (m) => res.problems.push(m);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: W < 600 ? 2 : 1, hasTouch: W < 600 });
  await ctx.addInitScript((t) => { localStorage.setItem('token', t); localStorage.setItem('authToken', t); }, token);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/access control/.test(e.message)) errors.push(e.message.split('\n')[0]); });
  const SYM = { h: '\u2665', d: '\u2666', c: '\u2663', s: '\u2660' };
  const LAYOUT = [
    { top: ['Qh', 'Qd', '2c'], middle: ['Kc', 'Kd', '5h', '6s', '9c'], bottom: ['Ah', 'Ad', 'As', '7h', '8d'] },
    { top: ['3h', '4d', '6c'], middle: ['Jc', 'Jd', '5d', '6d', '9d'], bottom: ['Th', 'Td', 'Ts', '7c', '8c'] },
  ];
  try {
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2600);
    await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 700 }).catch(() => {});
    await p.locator(W >= 1024 ? '.dk-rail-item:has-text("Hands")' : '.bottom-nav .nav-tab:has-text("Hands")').first().click();
    await p.waitForTimeout(900);
    await p.locator('.vp-launcher').first().click();
    await p.locator('input[aria-label="Search games"]').fill('OFC');
    await p.waitForTimeout(150);
    await p.locator('.vp-list button').filter({ has: p.locator('.vp-row-name:text-is("OFC")') }).first().click();
    await p.waitForTimeout(500);
    if (!(await p.locator('.gto-entry').count())) { await p.locator('.replayer-list-create button').first().click(); await p.waitForTimeout(500); }
    await p.locator('button.btn-primary:has-text("Next")').first().click();
    await p.waitForTimeout(300);
    for (let pi = 0; pi < 2; pi++) {
      const section = p.locator('.ofc-player-section').nth(pi);
      for (const [i, key] of ['top', 'middle', 'bottom'].entries()) {
        await section.locator('.ofc-row').nth(i).click();
        await p.waitForTimeout(80);
        for (const c of LAYOUT[pi][key]) {
          await section.locator('.ofc-picker-card', { hasText: c[0] + SYM[c[1]] }).first().click();
          await p.waitForTimeout(30);
        }
      }
    }
    await p.locator('.gto-btn-row button.btn-primary:has-text("Done")').first().click();
    await p.waitForTimeout(1500);
    const next = p.locator('button:has-text("Next")').first();
    if (!(await next.count())) throw new Error('no OFC replay');
    for (let i = 0; i < 20 && !(await next.isDisabled()); i++) { await next.click({ force: true }); res.steps++; await p.waitForTimeout(100); }
    const shown = await p.locator('.ofc-replay-row .card-row img, .ofc-replay-row .card-row .card-classic').count();
    res.seats = 2; res.winner = 'n/a'; res.expect = 'n/a';
    if (shown < 26) problem(`the finished board shows ${shown} of 26 cards`);
    if (OUT) await p.screenshot({ path: path.join(OUT, 'OFC.png') });
  } catch (e) {
    problem('STOPPED: ' + e.message.split('\n')[0]);
    if (OUT) await p.screenshot({ path: path.join(OUT, 'FAIL-OFC.png') }).catch(() => {});
  }
  if (errors.length) problem('page errors: ' + [...new Set(errors)].join(' | '));
  await ctx.close();
  return res;
}
if (!only || /ofc/i.test(only)) {
  const r = await runOfc();
  results.push(r);
  console.log(`${r.problems.length ? 'FAIL' : ' ok '} OFC                            ${r.steps} steps`);
  r.problems.forEach((m) => console.log('       - ' + m));
}
let next = 0;
await Promise.all(Array.from({ length: JOBS }, async () => {
  while (next < rows.length) {
    const row = rows[next++];
    const r = await runRow(browser, row);
    results.push(r);
    console.log(`${r.problems.length ? 'FAIL' : ' ok '} ${r.row.padEnd(30)} ${String(r.gameType).padEnd(11)} ${r.steps} steps, ${r.seats ?? '?'} seats, expect ${r.expect}, paid ${r.winner ?? '?'}${r.notes.length ? ' [' + [...new Set(r.notes)].length + ' forced]' : ''}`);
    r.problems.forEach((m) => console.log('       - ' + m));
  }
}));
if (OUT) fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
// ── The awkward spots: the hand-history fixtures through the replay (side pots, walks, straddles, odd chips, a big
// blind who cannot cover the blind and the ante). Every chip has to be on the table at the end.
if (!only || /fixtures/i.test(only)) {
  const dir = path.join(import.meta.dirname, '..', 'test', 'hh-io', 'fixtures');
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript((t) => { localStorage.setItem('token', t); localStorage.setItem('authToken', t); }, token);
  // The felt prints whole chips and whole dollars, so a cash stack of $84.25 reads $84. For this pass only, any
  // whole-number format shows two decimals, so each seat can be held to the cent.
  await ctx.addInitScript(() => {
    const NF = Intl.NumberFormat;
    const Exact = function (loc, o) { return new NF(loc, o && o.maximumFractionDigits === 0 ? { ...o, maximumFractionDigits: 2 } : o); };
    Exact.prototype = NF.prototype; Exact.supportedLocalesOf = NF.supportedLocalesOf;
    Intl.NumberFormat = Exact;
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => { if (!/access control/.test(e.message)) errs.push(e.message.split('\n')[0]); });
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 700 }).catch(() => {});
  const made = [];
  const stamp = Date.now() % 100000;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('error-'))) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const hand = { ...(raw.hand || raw), title: `FIX ${stamp} ${f}` };
    const r = await fetch(base + '/api/replayer/hands', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: hand.title, handData: hand, gameType: hand.gameType }) });
    if (r.status !== 201) { console.log(`FAIL fixture ${f}: not saved (${r.status})`); continue; }
    made.push({ f, hand });
  }
  await p.locator(W >= 1024 ? '.dk-rail-item:has-text("Hands")' : '.bottom-nav .nav-tab:has-text("Hands")').first().click();
  await p.waitForTimeout(1500);
  const num = (t) => { const m = /(-?[\d,.]+)\s*([kKmM]?)/.exec(t || ''); return m ? parseFloat(m[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1) : 0; };
  let fine = 0;
  for (const m of made) {
    const res = { row: 'fixture ' + m.f, gameType: m.hand.gameType, problems: [], notes: [], steps: 0 };
    const before = errs.length;
    try {
      await p.locator('.replayer-hand-card.is-row').filter({ hasText: m.hand.title }).first().click({ timeout: 6000 });
      await p.locator('button[title="End"]').first().waitFor({ timeout: 8000 });
      await p.waitForTimeout(250);
      await p.locator('button[title="End"]').first().click({ force: true });
      await p.waitForTimeout(600);
      const stacks = await p.evaluate(() => [...document.querySelectorAll('.replayer-seat')].map((s) => {
        const c = s.querySelector('.replayer-seat-stack');
        return { seat: Number(s.getAttribute('data-seat')), name: s.querySelector('.replayer-seat-name')?.getAttribute('title') || '', text: c?.textContent.trim(), allIn: /all-?in/i.test(c?.textContent || '') };
      })).then((a) => a.sort((x, y) => x.seat - y.seat));
      const start = (m.hand.players || []).reduce((a, x) => a + (Number(x.startingStack) || 0), 0);
      const total = stacks.reduce((a, s) => a + (s.allIn ? 0 : num(s.text)), 0);
      // Stacks read to the cent on a cash table, and whole on the rest.
      if (start && Math.abs(total - start) > Math.max(2, start * 0.0005)) res.problems.push(`chips do not balance: ${start} at the start, ${total} at the end (${stacks.map((s) => s.text).join(' ')})`);
      // Balancing is not enough: a side pot paid to the wrong seat still balances. Every seat's stack has to be
      // what the hand history says it ends with (the writer's golden file, which PT4 has read).
      const golden = path.join(dir, '..', 'golden', m.f.replace(/\.json$/, '.txt'));
      if (fs.existsSync(golden)) {
        const { finals } = goldenFinals(fs.readFileSync(golden, 'utf8'));
        // The export cleans names for PokerStars ("Bob: The (Great)" -> "Bob The Great", a blank -> "Player3",
        // duplicates numbered) and keeps the players' order, so where a name is not on the felt, go by seat order.
        const byName = [...finals.keys()].every((n) => stacks.some((s) => s.name === n));
        if (!byName && stacks.length !== finals.size) res.problems.push(`${stacks.length} seats on the felt, ${finals.size} in the hand history`);
        const inOrder = [...finals];
        stacks.forEach((s, i) => {
          const [name, want] = byName ? [s.name, finals.get(s.name)] : (inOrder[i] || ['?', NaN]);
          if (want === undefined) return; // a seat the hand history never dealt in
          const have = s.allIn ? 0 : num(s.text);
          if (!(Math.abs(have - want) <= 0.005)) res.problems.push(`${name}${byName ? '' : ` (seat ${i + 1}, "${s.name}")`} ends with ${s.text}, the hand history says ${want}`);
        });
      } else res.problems.push('no golden hand history to check the seats against');
      for (const t of await handNameTrouble(p)) res.problems.push('hand name ' + t);
      for (const t of await feltTrouble(p)) res.problems.push('felt: ' + t);
      await p.locator('button:has-text("Back")').first().click({ force: true });
      await p.waitForTimeout(450);
    } catch (e) {
      res.problems.push('STOPPED: ' + e.message.split('\n')[0]);
      await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(2200);
      await p.locator(W >= 1024 ? '.dk-rail-item:has-text("Hands")' : '.bottom-nav .nav-tab:has-text("Hands")').first().click();
      await p.waitForTimeout(1200);
    }
    if (errs.length > before) res.problems.push('page errors: ' + errs.slice(before).join(' | '));
    results.push(res);
    if (res.problems.length) { console.log('FAIL ' + res.row); res.problems.forEach((x) => console.log('       - ' + x)); } else fine++;
  }
  console.log(`fixtures through the replay: ${fine} of ${made.length} clean`);
  await ctx.close();
}
const bad = results.filter((r) => r.problems.length);
await browser.close();
console.log(`\n${results.length - bad.length} of ${results.length} rows clean at ${W}x${H}`);
process.exit(bad.length ? 1 : 0);
