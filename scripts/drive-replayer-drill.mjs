// Plays whole hands in the replayer drill, in a real browser against a real solver, and checks what
// the table shows against what the server dealt. Boot the server yourself on a scratch DB (never
// poker-tournaments.db), then:
//   node scripts/drive-replayer-drill.mjs http://127.0.0.1:PORT <jwt-secret> <shots-dir> [game] [hands] [--desktop]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
const jwt = require('jsonwebtoken');

const [base, secret, shotsDir, gameLabel = '2-7 TD', handsArg = '1'] = process.argv.slice(2);
const desktop = process.argv.includes('--desktop');
const HANDS = Number(handsArg) || 1;
fs.mkdirSync(shotsDir, { recursive: true });

const name = 'drill' + randomBytes(3).toString('hex');
const reg = await fetch(base + '/api/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: name, email: `${name}@example.test`, password: randomBytes(16).toString('hex'), realName: 'Drill Check' }),
}).then((r) => r.json());
const { iat, exp, ...claims } = jwt.decode(reg.token);
const token = jwt.sign({ ...claims, username: 'claude' }, secret, { expiresIn: '1h' });

const browser = await webkit.launch();
const ctx = await browser.newContext(desktop
  ? { viewport: { width: 1440, height: 900 } }
  : { viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, hasTouch: true });
await ctx.addInitScript(({ t }) => {
  localStorage.setItem('token', t); localStorage.setItem('username', 'claude');
  localStorage.setItem('onboardComplete', '1'); localStorage.setItem('hasOnboarded', 'true');
  localStorage.setItem('onboarded', '1'); localStorage.setItem('gridReadout', 'off');
}, { t: token });
const p = await ctx.newPage();
const problems = [];
p.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)); });

const answers = [];
p.on('response', async (res) => {
  const u = res.url();
  if (!/\/solver\/trainer\//.test(u)) return;
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  answers.push({ url: u.replace(base, ''), status: res.status(), body });
});

let shot = 0;
const snap = async (label) => { await p.screenshot({ path: path.join(shotsDir, `${String(++shot).padStart(2, '0')}-${label}.png`) }); };
const lastStep = () => [...answers].reverse().find((a) => /\/step$/.test(a.url))?.body;
const hero = () => [...answers].reverse().find((a) => /\/deal$/.test(a.url))?.body?.heroSeat ?? 0;

await p.goto(base + '/?gridOverlay=1');
await p.waitForTimeout(1500);
for (const s of ['Skip', 'Close']) await p.getByRole('button', { name: s, exact: true }).first().click({ timeout: 500 }).catch(() => {});
await p.locator(desktop ? '.dk-rail-item:has-text("Hands")' : '.bottom-nav .nav-tab:has-text("Hands")').first().click({ timeout: 8000, force: true });
await p.waitForTimeout(1200);
await p.getByRole('button', { name: 'Play a hand', exact: true }).click({ timeout: 8000 });
await p.waitForTimeout(600);
await snap('setup');

const grades = { hands: 0, decisions: 0, draws: 0 };
const check = (cond, msg) => { if (!cond) problems.push(msg); };

await p.locator('.rd-setup').getByRole('button', { name: gameLabel, exact: true }).click();

for (let h = 0; h < HANDS; h++) {
  let guard = 0;
  let shotDraw = false, shotBet = false;
  for (;;) {
    if (++guard > 60) { problems.push('hand did not finish in 60 moves'); break; }
    // Wait for the table to catch up: the bar's buttons, enabled, or the end of the hand.
    await p.waitForFunction(() => {
      const over = [...document.querySelectorAll('.rd-bar button')].some((b) => /Grades/.test(b.textContent));
      const live = [...document.querySelectorAll('.rd-bar button.rd-act, .rd-bar button.rd-primary')].some((b) => !b.disabled);
      return over || live;
    }, null, { timeout: 40000 });
    if (await p.getByRole('button', { name: 'Grades', exact: true }).count()) break;
    const step = lastStep();

    // The table's cards, at the end of what has played, against what the server says the hero holds.
    const cards = await p.locator('.rd-cards .rd-card').count();
    if (cards) {
      check(cards === (step.drawDecision.heroCards || []).length, `draw offered ${cards} cards, server says ${step.drawDecision.heroCards.length}`);
      if (!shotDraw) { await p.waitForTimeout(400); await snap(`hand${h + 1}-draw`); shotDraw = true; }
      // Throw the last card or two on some draws, and stand pat on others.
      const n = guard % 3;
      for (let i = 0; i < n; i++) await p.locator('.rd-cards .rd-card').nth(cards - 1 - i).click();
      if (n && !shotDraw) await snap(`hand${h + 1}-thrown`);
      await p.locator('.rd-bar button.rd-primary').click();
      await p.waitForTimeout(150);
      continue;
    }
    if (!shotBet) { await p.waitForTimeout(300); await snap(`hand${h + 1}-bet`); shotBet = true; }
    const labels = await p.locator('.rd-bar button.rd-act').allTextContents();
    // Never fold, so hands reach the draws; call or check if it can.
    const pickIdx = labels.findIndex((l) => /^(Call|Check)/.test(l));
    await p.locator('.rd-bar button.rd-act').nth(pickIdx >= 0 ? pickIdx : labels.length - 1).click();
    await p.waitForTimeout(150);
  }
  const end = lastStep();
  check(end && end.handOver, 'the last answer was not the end of the hand');
  // The table has to agree with the server when the hand has played out: the transport's replay icon
  // appears at the result. The seats hold the only chips there are, and the hero's are the server's.
  await p.locator('button.replayer-play-btn:not(.is-playing)').waitFor({ timeout: 60000 });
  await p.waitForTimeout(1500);
  await snap(`hand${h + 1}-result`);
  const chips = await p.evaluate(() => [0, 1].map((pi) => {
    const el = document.querySelector(`.replayer-seat[data-seat="${pi}"] .replayer-seat-stack`);
    return el ? Number(el.textContent.replace(/[^0-9.]/g, '')) : NaN;
  }));
  const heroIdx = end.state.log ? hero(end) : 0;
  console.log(`  hand ${h + 1}: seats ${chips.join(' + ')}, server pot ${end.state.pot}, hero delta ${end.result.heroDelta}, hero seat ${heroIdx}; ${end.result.endType}; ${(end.state.log || []).map((l) => (l.seat === heroIdx ? 'H:' : 'S:') + l.label).join(', ')}`);
  if (chips.length === 2) {
    check(chips[0] + chips[1] === 1000, `the seats hold ${chips[0] + chips[1]}, not 1000`);
    const heroChips = chips[heroIdx];
    check(heroChips === 500 + end.result.heroDelta, `the hero's seat reads ${heroChips}, the server says ${500 + end.result.heroDelta}`);
  } else problems.push('found ' + chips.length + ' stack figures on the table');

  await p.getByRole('button', { name: 'Grades', exact: true }).click();
  await p.waitForTimeout(400);
  const draws = (end.grades || []).filter((g) => g.kind === 'draw');
  grades.hands++; grades.decisions += (end.grades || []).length; grades.draws += draws.length;
  check(await p.locator('.rd-decision').count() === (end.grades || []).length, 'a decision is missing from the review');
  const drillLabels = await p.locator('.rd-decision > .hs-cap').allTextContents();
  check(drillLabels.every((l) => /^Drill grader · /.test(l)), 'a grade is not labelled as the drill grader: ' + drillLabels.join('|'));
  check(await p.locator('.rd-study').count() === draws.length, `${draws.length} draws, ${await p.locator('.rd-study').count()} study blocks`);
  await snap(`hand${h + 1}-review-pricing`);
  // Each study answer takes seconds.
  await p.waitForFunction(() => ![...document.querySelectorAll('.rd-study')].some((e) => /Pricing/.test(e.textContent)), null, { timeout: 120000 });
  await p.waitForTimeout(300);
  const verdicts = await p.locator('.rd-study').evaluateAll((els) => els.map((e) => e.textContent));
  verdicts.forEach((v, i) => {
    check(/Study tool/.test(v), 'a study block is unlabelled');
    console.log(`  draw ${i + 1}: ${v.replace(/Levels are uncertified.*/, '').slice(0, 170)}`);
  });
  const studies = answers.filter((a) => /study-draw$/.test(a.url)).slice(-draws.length);
  studies.forEach((a) => { if (a.status !== 200) problems.push(`study-draw ${a.status}: ${JSON.stringify(a.body).slice(0, 180)}`); });
  await snap(`hand${h + 1}-review`);
  await p.evaluate(() => { const r = document.querySelector('.rd-review'); if (r) r.scrollIntoView({ block: 'end' }); });
  await p.waitForTimeout(200);
  await snap(`hand${h + 1}-review-end`);

  if (h === 0) {
    await p.getByRole('button', { name: 'Table', exact: true }).click();
    await p.waitForTimeout(900);
    check(await p.getByRole('button', { name: 'Grades', exact: true }).count() === 1, 'back from the grades, the table has no Grades button');
    await snap(`hand${h + 1}-back-at-table`);
    await p.getByRole('button', { name: 'Grades', exact: true }).click();
    await p.waitForTimeout(300);
  }
  if (h < HANDS - 1) {
    await p.locator('.rd-review-nav').getByRole('button', { name: 'Deal', exact: true }).click();
    await p.waitForTimeout(600);
  }
}

console.log(JSON.stringify(grades));
const saved = answers.filter((a) => /save-hand$/.test(a.url));
console.log('saved', saved.length, 'status', saved.map((a) => a.status).join(','));
console.log(problems.length ? 'PROBLEMS\n' + [...new Set(problems)].join('\n') : 'no problems');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
