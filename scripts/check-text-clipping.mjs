// Finds text whose glyphs are cut off by a clipping ancestor — descenders (g, p, y, j, q) sliced at
// a grid line, the bug that kept coming back on schedule event names.
//
//   node scripts/check-text-clipping.mjs [baseUrl] [--width 402] [--height 874]
//   (CHECK_BASE_URL / CHECK_TOKEN / CHECK_TOKEN_FILE / CHECK_USERNAME as check-control-centring.mjs)
//
// Signs in as the local admin test user, opens the Schedule list, an expanded card and My
// Schedule (and, for an admin, each tab of the bankroll dashboard — the Overview with every table
// section open, then closed — every Reports table and the
// Reports filter sheet, then Results > Cash: the running session and its panels, the session
// list, Stats, a session, the add form, the live bar), and for every text node inside those
// views measures its glyph
// box (a Range over the text, which spans ascent to descent) against every ancestor that clips
// (overflow other than visible, or overflow-y clip). A glyph box that ends more than 0.5 CSS px
// below a clipping
// ancestor's bottom (or starts above its top) is reported. Exits 1 when anything is clipped, so it
// can gate a deploy. WebKit, because the app ships in WKWebView.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
const jwt = require('../node_modules/jsonwebtoken');

const args = process.argv.slice(2);
const base = (args.find(a => /^https?:/.test(a)) || process.env.CHECK_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const num = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : d; };
const W = num('--width', 402), H = num('--height', 874);

function token() {
  if (process.env.CHECK_TOKEN) return process.env.CHECK_TOKEN;
  if (process.env.CHECK_TOKEN_FILE) return require('node:fs').readFileSync(process.env.CHECK_TOKEN_FILE, 'utf8').trim();
  const cfg = require('../ecosystem.config.cjs');
  const app = (cfg.apps || cfg).find(a => a.name === 'futuregame-scheduler');
  return jwt.sign({ id: 9, username: 'ham5' }, app.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

// Runs in the page: every clipped text node under `rootSel`.
function scan(rootSel) {
  const out = [];
  const roots = [...document.querySelectorAll(rootSel)];
  const clips = (el) => {
    const cs = getComputedStyle(el);
    return cs.overflowY !== 'visible' || cs.overflow === 'hidden' || cs.overflow === 'clip' || /^inset\(/.test(cs.clipPath);
  };
  // The clipping rectangle: the box, or for clip-path: inset(t r b l) the box moved by those insets
  // (negative insets reach outside it).
  const clipRect = (el) => {
    const r = el.getBoundingClientRect();
    const m = /^inset\(([^)]*)\)/.exec(getComputedStyle(el).clipPath || '');
    if (!m) return { top: r.top, bottom: r.bottom };
    const v = m[1].split(/\s+/).map(parseFloat);
    const [t, , b = t] = v.length === 1 ? [v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0]] : v;
    return { top: r.top + t, bottom: r.bottom - b };
  };
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const host = n.parentElement;
      if (!host || host.closest('[aria-hidden="true"], .grid-overlay')) continue;
      const hs = getComputedStyle(host);
      if (hs.visibility === 'hidden' || hs.display === 'none' || Number(hs.opacity) === 0) continue;
      // Vertical text (the venue strips) reports range geometry WebKit does not keep consistent with
      // its box mid-scroll — measured fully inside its strip while reported 47px out. Those labels
      // are short capitals with no descenders; horizontal text is what this guards.
      if (!/^horizontal/.test(hs.writingMode)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      const top = Math.min(...rects.map(r => r.top)), bottom = Math.max(...rects.map(r => r.bottom));
      // Only text on screen: off-screen rows may skip rendering (content-visibility), and their
      // geometry then means nothing.
      const hr = host.getBoundingClientRect();
      if (hr.bottom <= 0 || hr.top >= innerHeight || hr.right <= 0 || hr.left >= innerWidth) continue;
      for (let a = host; a && a !== document.body; a = a.parentElement) {
        if (!clips(a)) continue;
        const box = a.getBoundingClientRect();
        if (box.height === 0) break;
        const ar = clipRect(a);
        // Something scrolled out of a scroller is not "clipped text", it is just off screen.
        const scroller = a.scrollHeight > a.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(a).overflowY);
        if (scroller) break;
        const below = bottom - ar.bottom, above = ar.top - top;
        if (below > 0.5 || above > 0.5) {
          out.push({
            text: n.textContent.trim().slice(0, 50),
            host: host.className || host.tagName,
            clipper: (a.className && String(a.className).slice(0, 60)) || a.tagName,
            cutPx: +Math.max(below, above).toFixed(2),
            edge: below > above ? 'bottom' : 'top',
          });
          break;
        }
      }
    }
  }
  return out;
}

(async () => {
  const b = await webkit.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3 });
  const t = token();
  await ctx.addInitScript(({ t }) => {
    localStorage.setItem('token', t); localStorage.setItem('username', 'ham5');
    localStorage.setItem('onboardComplete', '1'); localStorage.setItem('hasOnboarded', 'true');
  }, { t });
  const p = await ctx.newPage();
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 2000 }).catch(() => {});
  const found = [];
  const run = async (label, sel) => {
    const r = await p.evaluate(scan, sel);
    r.forEach(x => found.push({ view: label, ...x }));
  };
  await p.getByRole('button', { name: 'Schedule', exact: true }).first().click().catch(() => {});
  await p.waitForTimeout(2500);
  await run('schedule list', '.cal-event-row');
  // Open the first few cards (the expanded layout has its own lines).
  for (let i = 0; i < 3; i++) {
    await p.locator('.cal-event-row:not(.open) .cal-event-bar').first().click().catch(() => {});
    await p.waitForTimeout(600);
  }
  await run('expanded card', '.cal-event-row.open');
  // Scroll through the list so names further down are checked too.
  for (let i = 0; i < 6; i++) {
    await p.mouse.wheel(0, H * 0.8);
    await p.waitForTimeout(500);
    await run('schedule list (scrolled)', '.cal-event-row');
  }
  // Results & Tracking, from a fresh load (a sheet left open by the step before can't block it).
  const openResults = async () => {
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 1000 }).catch(() => {});
    if (await p.evaluate(() => !!document.querySelector('.app-shell.is-desktop'))) {
      await p.locator('.dk-rail-item:has-text("Results")').first().click({ timeout: 4000 });
    } else {
      await p.locator('.username-chip').first().click({ timeout: 4000 });
      await p.waitForTimeout(400);
      await p.getByRole('button', { name: 'Results & Tracking', exact: true }).first().click({ timeout: 4000 });
    }
    await p.waitForTimeout(1800);
  };
  // The bankroll dashboard (app-admin beta), every tab: its tables and stats truncate long text.
  // Skipped quietly when the account has no bankroll strip (not an admin).
  try {
    await openResults();
    await p.locator('.bk-head-btn:has-text("Dashboard")').first().click({ timeout: 4000 });
    await p.waitForTimeout(1800);
    // The sheet scrolls, and only text on screen is measured: run at the top, then page down
    // through the sheet's body to its end.
    const runSheet = async (label) => {
      await p.evaluate(() => { const s = document.querySelector('.an-sheet .an-body'); if (s) s.scrollTop = 0; });
      await run(label, '.an-sheet');
      for (let i = 1; i < 12; i++) {
        const moved = await p.evaluate((h) => {
          const s = document.querySelector('.an-sheet .an-body');
          if (!s) return false;
          const before = s.scrollTop; s.scrollTop += Math.round(h * 0.7); return s.scrollTop !== before;
        }, H);
        if (!moved) break;
        await p.waitForTimeout(300);
        await run(`${label} (scrolled ${i})`, '.an-sheet');
      }
    };
    // The Overview's collapsible table sections: every one opened by its header (the state is
    // remembered per device, so they stay open for the passes below), and closed again at the end.
    const sections = async (expanded) => {
      const want = expanded ? 'false' : 'true';
      for (let i = 0; i < 12; i++) {
        const head = p.locator(`.an-sheet .ovt-head[aria-expanded="${want}"]`).first();
        if (!(await head.count())) break;
        await head.click({ timeout: 4000 });
        await p.waitForTimeout(450);
      }
      if (await p.locator(`.an-sheet .ovt-head[aria-expanded="${want}"]`).count()) throw new Error('an Overview section did not toggle');
    };
    await sections(true);
    // Every tab in the strip, whatever it holds (Overview, Rules, Goals, Import, and any added
    // later), then the Overview again with its graph switched to Balance and the range to All.
    const tabs = p.locator('.an-sheet .bd-tabs button');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      const tab = (await tabs.nth(i).innerText()).trim();
      await tabs.nth(i).click({ timeout: 4000 });
      await p.waitForTimeout(800);
      await runSheet(`bankroll dashboard ${tab}`);
    }
    await tabs.first().click({ timeout: 4000 });
    await p.locator('.an-sheet .bd-mode button:has-text("Balance")').click({ timeout: 4000 });
    await p.locator('.an-sheet .bd-range button:has-text("All")').click({ timeout: 4000 });
    await p.waitForTimeout(800);
    await runSheet('bankroll dashboard overview (balance, all time)');
    // Every section closed: the headers carry their headline figures.
    await sections(false);
    await runSheet('bankroll dashboard overview (sections closed)');
    await p.locator('.an-sheet .bd-mode button:has-text("Profit")').click({ timeout: 4000 });
    await p.locator('.an-sheet .bd-range button:has-text("YTD")').click({ timeout: 4000 });
    // Reports: every report's table, scrolled through the sheet; then the filter sheet with a
    // filter on (its chips truncate long room names), scrolled through.
    const scrollRun = async (label, scroller, root) => {
      for (let i = 0; i < 4; i++) {
        await run(label, root);
        await p.evaluate(({ sel, dy }) => { const s = document.querySelector(sel); if (s) s.scrollTop += dy; }, { sel: scroller, dy: H * 0.7 });
        await p.waitForTimeout(300);
      }
    };
    await p.locator('.an-sheet .bk-seg-btn:has-text("Reports")').first().click({ timeout: 4000 });
    await p.waitForTimeout(1200);
    const reportNames = await p.locator('.br-picker .br-chip:not([disabled])').allInnerTexts();
    for (const name of reportNames) {
      await p.evaluate(() => { const s = document.querySelector('.bd-sheet .an-body'); if (s) s.scrollTop = 0; });
      await p.locator(`.br-picker .br-chip:has-text("${name.trim()}")`).first().click({ timeout: 4000 });
      await p.waitForTimeout(400);
      await scrollRun(`bankroll reports ${name.trim()}`, '.bd-sheet .an-body', '.br-reports');
    }
    await p.evaluate(() => { const s = document.querySelector('.bd-sheet .an-body'); if (s) s.scrollTop = 0; });
    await p.locator('.br-bar .bk-btn').first().click({ timeout: 4000 });
    await p.waitForTimeout(800);
    await p.locator('.br-fsheet .br-chip:has-text("Cash")').first().click({ timeout: 4000 });
    await p.waitForTimeout(400);
    await scrollRun('bankroll report filters', '.br-fsheet .an-body', '.br-fsheet');
  } catch (e) { console.log(`  (bankroll dashboard skipped: ${e.message.split('\n')[0]})`); }
  // Results > Cash (cash sessions beta), each screen: the running session (it opens by itself while
  // one runs) and its rebuy and cash-out panels; the list (chip graph, month headers, rows with
  // notes); Stats; a session's page; the add form with More open; and the live-session bar over the
  // nav on another tab. Each screen scrolled through, since rows and fields truncate.
  const CASH = '.results-kind-tabs, .cs-view, .cs-bar';
  const cashScreen = async (label, steps) => {
    try {
      await openResults();
      await p.locator('.results-kind-tabs button:has-text("Cash")').first().click({ timeout: 4000 });
      await p.waitForTimeout(1500);
      for (const sel of steps) {
        await p.locator(sel).first().click({ timeout: 4000 });
        await p.waitForTimeout(700);
      }
      for (let i = 0; i < 4; i++) {
        await run(i ? `${label} (scrolled)` : label, CASH);
        await p.mouse.wheel(0, H * 0.7);
        await p.waitForTimeout(500);
      }
    } catch (e) {
      console.log(`  (${label} skipped: ${e.message.split('\n')[0]})`);
    }
  };
  const back = '.cs-head button:has-text("Sessions")';
  await cashScreen('cash live', []);
  await cashScreen('cash live rebuy', ['.cs-livescreen button:has-text("Rebuy")']);
  await cashScreen('cash live cash-out', ['.cs-livescreen button:has-text("Cash out")']);
  await cashScreen('cash list', [back]);
  await cashScreen('cash stats', [back, '.cs-tabs button:has-text("Stats")']);
  await cashScreen('cash session', [back, '.cs-row']);
  await cashScreen('cash add', [back, '.cs-head button:has-text("Add")', '.cs-form-foot button']);
  try {
    await openResults();
    await p.locator('.results-kind-tabs button:has-text("Cash")').first().click({ timeout: 4000 });
    await p.waitForTimeout(1200);
    await p.locator('.results-kind-tabs button:has-text("Tournaments")').first().click({ timeout: 4000 });
    await p.waitForTimeout(800);
    await run('cash bar', CASH);
  } catch (e) {
    console.log(`  (cash bar skipped: ${e.message.split('\n')[0]})`);
  }

  // Results → Expenses & income (admin beta) and its sheets: rows, cells and trip lines truncate
  // with an ellipsis. Skipped quietly where the section is absent (a non-admin token).
  try {
    await openResults();
    await p.locator('.tx-sec').first().waitFor({ timeout: 4000 });
    await p.evaluate(() => document.querySelector('.tx-sec').scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(500);
    await run('expenses', '.tx-sec');
    const sheet = async (label, open) => {
      await open();
      await p.waitForTimeout(900);
      await run(label, '.tx-sheet');
      await p.locator('.tx-sheet .bk-sheet-head .bk-btn').first().click({ timeout: 2000 }).catch(() => {});
      await p.waitForTimeout(400);
    };
    await sheet('expense add', () => p.locator('.tx-sec .bk-head-btn').first().click({ timeout: 4000 }));
    await sheet('expenses all', () => p.locator('.tx-sec .bk-actions .bk-btn').nth(1).click({ timeout: 4000 }));
    await sheet('trips', () => p.locator('.tx-sec .bk-actions .bk-btn').nth(0).click({ timeout: 4000 }));
    await sheet('trip', async () => {
      await p.locator('.tx-sec .bk-actions .bk-btn').nth(0).click({ timeout: 4000 });
      await p.waitForTimeout(600);
      await p.locator('.tx-trip-row').first().click({ timeout: 4000 });
    });
  } catch (e) { console.log(`  (expenses views skipped: ${e.message.split('\n')[0]})`); }

  const uniq = [...new Map(found.map(f => [f.view.split(' (')[0] + f.text + f.host, f])).values()];
  if (uniq.length) {
    console.log(`CLIPPED TEXT at ${W}x${H}: ${uniq.length}`);
    for (const f of uniq) console.log(`  [${f.view}] "${f.text}" (${f.host}) cut ${f.cutPx}px at the ${f.edge} by ${f.clipper}`);
  } else {
    console.log(`no clipped text at ${W}x${H}`);
  }
  await b.close();
  process.exit(uniq.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
