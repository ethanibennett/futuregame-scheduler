// Finds text whose glyphs are cut off by a clipping ancestor — descenders (g, p, y, j, q) sliced at
// a grid line, the bug that kept coming back on schedule event names.
//
//   node scripts/check-text-clipping.mjs [baseUrl] [--width 402] [--height 874] [--only "bankroll,home"]
//   (--only runs the passes whose name starts with one of those words: schedule, home, venue-map,
//   hands, bankroll-dashboard, bankroll-locations, bankroll-backers, bankroll-import-dashboard, cash, bankroll-fab,
//   expenses, results-notify, cash-notify, results-reset, staking-settlement, staking-standing, backer-page; --verbose names the views a run scanned. A pass that skips itself
//   says so, and the "scanned N views" line before the verdict counts the ones that ran.)
//   (CHECK_BASE_URL / CHECK_TOKEN / CHECK_TOKEN_FILE / CHECK_USERNAME / CHECK_THEME as check-control-centring.mjs)
//
// Signs in as the local admin test user, opens the Schedule list, an expanded card and My
// Schedule, the home (Dashboard) paged to its foot (plain, then its NUMBERS in trip mode, series
// mode and the edge state, the empty-schedule prompt, and the signal-or-noise line as progress and
// about cash), its Scan sheet, every Up Next card (and a page turn to a taller one with the mouse
// left on the pager), the cash card's stack entry, its Log menu and a To log row's Undo state, and Hands'
// Scanner, its Export for PokerTracker sheet (over a staged list with a hand of every kind it sorts) and a
// replay's Share sheet (and one on a hand that came by a share link), the venue map opened from a
// Schedule strip and from an Up Next banner, first-run setup's three steps, a staking series'
// Settlement (open and settled, with series named "Guard Open" / "Guard Settled"), the backer page
// (/b/<token>, with CHECK_BACKER_TOKENS: full history paged through, no sessions, one session) (and, for an
// admin, each tab of the bankroll dashboard — the Overview with every table
// section open, then closed; Sessions paged to the list's end, filtered to Cash, a cash session's and
// a tournament's detail, and the rows Show more adds; every Reports table and the
// Reports filter sheet, a Locations card open a page past its first ten and the Locations sorted by
// name with every card open, the Backers tab (the list, every card open on its last ten shares, and
// its empty and refused states), then Results > Cash: the running session and its panels, the session
// list, Stats, a session, the add form, the live bar), the floating + on the bankroll pages and its
// menu (with and without a running session, and in the dashboard sheet), and for every text node inside those
// views measures its glyph
// box (a Range over the text, which spans ascent to descent) against every ancestor that clips
// (overflow other than visible, or overflow-y clip). A glyph box that ends more than 0.5 CSS px
// below a clipping
// ancestor's bottom (or starts above its top) is reported. Exits 1 when anything is clipped, so it
// can gate a deploy. WebKit, because the app ships in WKWebView.
import { stageHands, SHARED_HAND_CODE } from './hands-states.mjs';
import { createRequire } from 'node:module';
import { stageHome, routeHomeLayout } from './home-states.mjs';
import { stageNotify } from './notify-states.mjs';

// The Bankroll sections are grouped (owner, 2026-10-20; CashLive.jsx ResultsKindTabs): a section is a
// chip, or the shown label of its group's split chip, or an item in that group's caret menu.
async function openSection(p, name) {
  const chip = p.locator(`.results-kind-tabs .kind-toggle:has-text("${name}")`).first();
  if (await chip.count() && await chip.isVisible().catch(() => false)) { await chip.click({ timeout: 4000 }); return; }
  await p.locator(`.results-kind-tabs .kind-toggle-caret[aria-label*="${name}"]`).first().click({ timeout: 4000 });
  await p.locator(`.rk-menu .rk-menu-item:has-text("${name}")`).first().click({ timeout: 4000 });
}
const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
// Resolved up the tree, not by a fixed path: a git worktree inside the checkout has no
// node_modules of its own and finds the checkout's.
const jwt = require('jsonwebtoken');

const args = process.argv.slice(2);
const base = (args.find(a => /^https?:/.test(a)) || process.env.CHECK_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const num = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : d; };
const W = num('--width', 402), H = num('--height', 874);
// --only "bankroll,home" runs just the passes whose name starts with one of those words (the
// names are the on('...') guards below); without it every pass runs. Each guarded pass signs in and
// opens its own view from a fresh load, so a subset behaves as it does in the full run.
const onlyArg = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1] : null; })();
const on = (name) => !onlyArg || onlyArg.split(',').some(o => name.startsWith(o.trim()));

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
    const cs = getComputedStyle(el);
    const m = /^inset\(([^)]*)\)/.exec(cs.clipPath || '');
    // Sideways only when it clips sideways (overflow-x, or a clip-path).
    const xClips = cs.overflowX !== 'visible' || !!m;
    if (!m) return { top: r.top, bottom: r.bottom, left: xClips ? r.left : -Infinity, right: xClips ? r.right : Infinity };
    const v = m[1].split(/\s+/).map(parseFloat);
    const [t, rr, b = t, l = rr] = v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : v;
    return { top: r.top + t, bottom: r.bottom - b, left: r.left + l, right: r.right - rr };
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
      const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right));
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
        // Text this ancestor hides SIDEWAYS in full is not cut, it is not shown at all: the Up Next
        // carousel's neighbour slides, a card to each side of the one shown inside its overflow
        // box (on desktop they reach on screen, over the rail). Their height is not the track's
        // (the track fits the card on show), so measured top to bottom they read as cut.
        if (right <= ar.left + 0.5 || left >= ar.right - 0.5) break;
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
  await ctx.addInitScript(({ t, theme }) => {
    if (theme) localStorage.setItem('theme', theme);   // CHECK_THEME, as check-control-centring.mjs
    localStorage.setItem('token', t); localStorage.setItem('username', 'ham5');
    localStorage.setItem('onboardComplete', '1'); localStorage.setItem('hasOnboarded', 'true');
    // Past the first-run wizard (utils/location-prefs.js hasOnboarded reads 'onboarded'): on a
    // busy box its Skip click outran the 1 s wait at 1440 and its entrance animation can outlast
    // it on a slow desktop render; the wizard's backdrop then swallowed the Results click, skipping
    // 10 sections while still printing a passing line.
    localStorage.setItem('onboarded', '1');
  }, { t, theme: process.env.CHECK_THEME || '' });
  // Edit home: every view sees the default home whatever the account saved, and the sheet's
  // changes are answered here and never written (scripts/home-states.mjs).
  await routeHomeLayout(ctx);
  const p = await ctx.newPage();
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 2000 }).catch(() => {});
  const found = [];
  const scanned = new Set();   // the views a scan ran on (a pass that skipped itself adds none)
  const run = async (label, sel) => {
    scanned.add(label.split(' (')[0]);
    const r = await p.evaluate(scan, sel);
    r.forEach(x => found.push({ view: label, ...x }));
  };
  if (on('schedule')) {
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
  }
  // The home (Dashboard), which scrolls since 2026-10-12: from a fresh load, paged to its foot (on
  // desktop both of its panes, the main one and .dk-home-right), then the Playing card's Scan sheet
  // (a screenshot handed to the card's hidden picker, as its Scan button does; a scratch server
  // has no scan key, so it lands on the scanner's idle state and its error line), then Hands'
  // Scanner tool.
  const isDesktop = () => p.evaluate(() => !!document.querySelector('.app-shell.is-desktop'));
  const openTab = async (name) => {
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 1000 }).catch(() => {});
    const sel = (await isDesktop()) ? `.dk-rail-item:has-text("${name}")` : `.bottom-nav .nav-tab:has-text("${name}")`;
    await p.locator(sel).first().click({ timeout: 4000 });
    await p.waitForTimeout(1800);
  };
  const HOME = '.dashboard-view.home';
  const pageHome = async (label) => {
    await run(label, HOME);
    for (let i = 1; i < 8; i++) {
      const moved = await p.evaluate((h) => {
        let any = false;
        for (const v of document.querySelectorAll('.tab-panel.tab-active .dashboard-view.home, .dk-home-right .dashboard-view.home')) {
          const sc = v.closest('.content-area, .dk-scroll');
          if (!sc) continue;
          const before = sc.scrollTop; sc.scrollTop += Math.round(h * 0.7);
          if (sc.scrollTop !== before) any = true;
        }
        return any;
      }, H);
      if (!moved) break;
      await p.waitForTimeout(300);
      await run(`${label} (scrolled ${i})`, HOME);
    }
  };
  if (on('home')) try {
    await openTab('Dashboard');
    await pageHome('home');
  } catch (e) { console.log(`  (home skipped: ${e.message.split('\n')[0]})`); }
  // Its NUMBERS in the states the account does not show by itself (scripts/home-states.mjs): trip
  // mode, series mode (long titles that truncate), and the edge state (the longest signal pill, an
  // empty month, an empty Last result), each staged in the page, nothing written.
  // The signal-or-noise line (step 6; admins) loads after the first paint: its states wait for it.
  const READY = { 'noise-progress': '.hm-noise[data-kind="progress"]', 'noise-cash': '.hm-noise[data-kind="window"]' };
  for (const kind of on('home') ? ['trip', 'series', 'edge', 'empty', 'noise-progress', 'noise-cash'] : []) {
    try {
      const undo = await stageHome(p, kind);
      try {
        await openTab('Dashboard');
        if (READY[kind]) await p.locator(READY[kind]).first().waitFor({ state: 'attached', timeout: 6000 }).catch(() => { throw new Error("no noise line (it is an admin's)"); });
        await pageHome(`home ${kind}`);
      } finally { await undo(); }
    } catch (e) { console.log(`  (home ${kind} skipped: ${e.message.split('\n')[0]})`); }
  }
  if (on('home-scan')) try {
    await openTab('Dashboard');
    await p.locator('.dash-scan-input').setInputFiles({
      name: 'table.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
    });
    await p.locator('.scan-sheet').waitFor({ timeout: 4000 });
    await p.waitForTimeout(2500);
    await run('scan sheet', '.scan-sheet');
  } catch (e) { console.log(`  (scan sheet skipped: ${e.message.split('\n')[0]})`); }
  // Up Next, card by card (home step 5, every card since 2026-10-13): the carousel paged to each one
  // in turn (the plans' tags name their parent; the Playing card has its Scan / Update / Bag / Bust
  // row, the Bagged card its badge), each measured at rest. Until then only the cards with a plan
  // were, so an admin's Playing and Bagged cards (behind the cash card) never were.
  // Then one page turn to a TALLER card with the mouse left on the pager, the way a desktop user
  // clicks through: the track grows to it (it holds still only against a shorter card), so no line
  // of it may be cut. The track used to hold its height outright, slicing the Playing card's stats.
  const atCard = () => p.evaluate(() => Number(document.querySelector('.dash-carousel-track')?.dataset.idx || 0));
  const goCard = async (i) => {
    const dots = p.locator('.dash-upnext-dot');
    if (await dots.count()) await dots.nth(i).click({ timeout: 4000 });
    else {
      // Step until the track says it is there (a click can land mid-render and be lost).
      for (let n = 0; n < 80 && (await atCard()) < i; n++) {
        await p.locator('.dash-upnext-step[aria-label="Next event"]').first().click({ timeout: 4000 });
        await p.waitForTimeout(80);
      }
    }
  };
  const settle = async () => {
    await p.waitForFunction(() => {
      const t = document.querySelector('.dashboard-view.home .dash-carousel-track');
      if (!t) return true;
      if (t.getAnimations().some((a) => a.playState === 'running')) { window.__fitH = null; return false; }
      const h = t.getBoundingClientRect().height, same = window.__fitH === h;
      window.__fitH = h;
      return same;
    }, null, { timeout: 4000, polling: 100 }).catch(() => {});
    // And at its end, not a frame of its ease (a loaded renderer can still be a few px short).
    await p.evaluate(() => {
      const t = document.querySelector('.dashboard-view.home .dash-carousel-track');
      if (t) for (const a of t.getAnimations()) a.finish();
    });
  };
  if (on('home-cards')) try {
    await openTab('Dashboard');
    const n = await p.evaluate(() => document.querySelectorAll('.dashboard-view.home .dash-carousel-slide').length);
    if (n < 2) throw new Error('fewer than two cards');
    for (let i = 0; i < n; i++) {
      if (i) await goCard(i);
      // The pointer off the pager: its hover is a state of its own (the held turn below).
      await p.mouse.move(0, 0);
      await p.waitForTimeout(700);
      await settle();
      await run(`home cards (card ${i + 1} of ${n})`, HOME);
    }
  } catch (e) { console.log(`  (home cards skipped: ${e.message.split('\n')[0]})`); }
  if (on('home-cards-held')) try {
    await openTab('Dashboard');
    const hs = await p.evaluate(() => [...document.querySelectorAll('.dashboard-view.home .dash-carousel-slide')].map((s) => s.getBoundingClientRect().height));
    const i = hs.findIndex((h, k) => k + 1 < hs.length && hs[k + 1] > h + 4);
    if (i < 0) throw new Error('no card taller than the one before it');
    if (i) { await goCard(i); await p.mouse.move(0, 0); await p.waitForTimeout(700); await settle(); }
    const dots = p.locator('.dash-upnext-dot');
    if (await dots.count()) await dots.nth(i + 1).click({ timeout: 4000 });
    else await p.locator('.dash-upnext-step[aria-label="Next event"]').first().click({ timeout: 4000 });
    // The mouse stays where it clicked.
    await p.waitForTimeout(700);
    await settle();
    await run(`home cards (pager held, card ${i + 2})`, HOME);
  } catch (e) { console.log(`  (home cards, pager held, skipped: ${e.message.split('\n')[0]})`); }
  if (on('home-cash-entry')) try {
    await openTab('Dashboard');
    if (!(await p.locator('.hm-cash-card').count())) throw new Error('no cash session running (the first Up Next card of an admin)');
    await p.locator('.hm-cash-card .hm-cash-btn').first().click({ timeout: 4000 });
    await p.locator('.hm-cash-entry').waitFor({ timeout: 3000 });
    await run('home cash entry', HOME);
  } catch (e) { console.log(`  (home cash entry skipped: ${e.message.split('\n')[0]})`); }
  // The home's Log menu (admins), and a To log row turned into its Undo row by Didn't play — that
  // write answered here and never sent, so the guard changes nothing on the server it checks.
  if (on('home-log-menu')) try {
    await openTab('Dashboard');
    if (!(await p.locator('.hm-head-pill--log[aria-haspopup]').count())) throw new Error('no Log menu (not an admin: the pill opens the form)');
    await p.locator('.hm-head-pill--log').first().click({ timeout: 4000 });
    await p.locator('.hm-logmenu').waitFor({ timeout: 3000 });
    await run('home log menu', '.hm-logmenu');
  } catch (e) { console.log(`  (home log menu skipped: ${e.message.split('\n')[0]})`); }
  if (on('home-to-log-undo')) try {
    await openTab('Dashboard');
    await p.route('**/api/schedule/*/played', (r) => r.fulfill({ json: { notPlayed: true } }));
    try {
      await p.locator('.hm-tolog-seg--quiet').first().click({ timeout: 4000 });
      await p.locator('.hm-tolog-row.is-held').waitFor({ timeout: 3000 });
    } finally { await p.unroute('**/api/schedule/*/played'); }
    await run('home to-log undo row', HOME);
  } catch (e) { console.log(`  (home to-log undo skipped: ${e.message.split('\n')[0]})`); }
  // To log's "+N more" opened: every event waiting for a result, in place (the whole home is
  // measured, scrolled or not).
  if (on('home-to-log-more')) try {
    await openTab('Dashboard');
    const more = p.locator('.hm-tolog .hm-head-pill');
    if (!(await more.count())) throw new Error('two or fewer events to log (no +N more)');
    await more.first().click({ timeout: 4000 });
    await p.locator('.hm-tolog-list > li:nth-child(3)').waitFor({ timeout: 3000 });
    await run('home to-log, every row', HOME);
  } catch (e) { console.log(`  (home to-log more skipped: ${e.message.split('\n')[0]})`); }
  // Edit home (HomeEditSheet.jsx): the sheet as the home's control opens it, then with its first
  // row's name made deliberately long (it must truncate in its cell, cutting no glyph), then Reset
  // pressed on a custom layout (Undo reset); the home in that custom layout paged to its foot and,
  // on desktop, with every NUMBERS section hidden (the pane's EDIT prompt); and Settings' Home row.
  const openEdit = async () => {
    await p.locator('.hm-edit').filter({ visible: true }).first().click({ timeout: 8000 });
    await p.locator('.he-sheet .he-card').first().waitFor({ timeout: 8000 });
    await p.waitForTimeout(700);
  };
  if (on('home-edit')) try {
    await openTab('Dashboard');
    await openEdit();
    await run('edit home sheet', '.he-sheet');
    await p.evaluate(() => {
      for (const c of document.querySelectorAll('.he-sheet .he-name .hm-clip')) {
        if (c.firstChild && c.firstChild.nodeType === 3) { c.firstChild.textContent = 'A deliberately long section name, gjpqy, that cannot fit'; break; }
      }
    });
    await run('edit home sheet (a long name, truncated)', '.he-sheet');
  } catch (e) { console.log(`  (edit home sheet skipped: ${e.message.split('\n')[0]})`); }
  for (const kind of on('home-edit') ? ['layout-custom', ...((await isDesktop()) ? ['layout-numbers-empty'] : [])] : []) {
    try {
      const undo = await stageHome(p, kind);
      try {
        await openTab('Dashboard');
        await pageHome(`home ${kind}`);
        if (kind === 'layout-custom') {
          await openEdit();
          await p.locator('.he-reset').click({ timeout: 4000 });
          await p.locator('.he-reset:has-text("Undo reset")').waitFor({ timeout: 3000 });
          await run('edit home sheet (after Reset)', '.he-sheet');
        }
      } finally { await undo(); }
    } catch (e) { console.log(`  (home ${kind} skipped: ${e.message.split('\n')[0]})`); }
  }
  if (on('home-settings')) try {
    await openTab('Settings').catch(async () => {
      await p.locator('.username-chip').first().click({ timeout: 4000 });
      await p.getByRole('button', { name: 'Settings', exact: true }).first().click({ timeout: 4000 });
      await p.waitForTimeout(1500);
    });
    await p.locator('.settings-home').first().scrollIntoViewIfNeeded({ timeout: 4000 });
    await p.waitForTimeout(300);
    await run('settings home row', '.settings-home');
  } catch (e) { console.log(`  (settings home row skipped: ${e.message.split('\n')[0]})`); }
  // The venue map (VenueMapSheet.jsx): opened from a Schedule card's strip, then from an Up Next
  // card's banner (the first card that has one), each measured once its map has drawn.
  const venueMap = async (label) => {
    await p.locator('.vm-sheet').waitFor({ timeout: 8000 });
    await p.waitForFunction(() => {
      const c = document.querySelector('.vm-map-canvas'), n = document.querySelector('.vm-map-note');
      return (c && c.dataset.provider) || (n && !/Finding|Loading/.test(n.textContent));
    }, null, { timeout: 20000, polling: 200 }).catch(() => {});
    await p.waitForTimeout(500);
    await run(label, '.vm-sheet');
  };
  if (on('venue-map-strip')) try {
    await openTab('Schedule');
    await p.locator('.cal-event-row:not(.past) .cal-venue-strip[aria-haspopup="dialog"]').filter({ visible: true }).first().click({ timeout: 4000 });
    await venueMap('venue map (schedule strip)');
  } catch (e) { console.log(`  (venue map from a Schedule strip skipped: ${e.message.split('\n')[0]})`); }
  if (on('venue-map-upnext')) try {
    await openTab('Dashboard');
    const i = await p.evaluate(() => [...document.querySelectorAll('.dashboard-view.home .dash-carousel-slide')]
      .findIndex((sl) => sl.querySelector('.dash-venue-strip.has-map')));
    if (i < 0) throw new Error('no Up Next card with a venue map');
    if (i > 0) { await goCard(i); await p.waitForTimeout(700); }
    await p.locator('.dashboard-view.home .dash-venue-strip.has-map').filter({ visible: true }).first().click({ timeout: 4000 });
    await venueMap('venue map (up next)');
  } catch (e) { console.log(`  (venue map from Up Next skipped: ${e.message.split('\n')[0]})`); }
  if (on('hands-scanner')) try {
    await openTab('Hands');
    await p.locator('.hands-tool-row button:has-text("Scanner")').first().click({ timeout: 4000 });
    await p.waitForTimeout(800);
    await run('hands scanner', '.hands-scan');
  } catch (e) { console.log(`  (hands scanner skipped: ${e.message.split('\n')[0]})`); }
  // Hands: the Export for PokerTracker sheet (its body copy and the not-exported list wrap),
  // and a replay's Share sheet (the hand-history tile's description is a reason when it is off).
  // (staged: the account's hands plus one of every kind the sheet sorts, scripts/hands-states.mjs)
  if (on('hands-export')) try {
    const undoHands = await stageHands(p);
    try {
      await openTab('Hands');
      await p.locator('button:has-text("Export for PokerTracker")').first().click({ timeout: 4000 });
      await p.locator('.hh-export-sheet').waitFor({ timeout: 3000 });
      await p.waitForTimeout(500);
      await run('hands export sheet', '.hh-export-sheet');
    } finally { await undoHands(); }
  } catch (e) { console.log(`  (hands export sheet skipped: ${e.message.split('\n')[0]})`); }
  if (on('hands-replayer-share')) try {
    await openTab('Hands');
    await p.locator('.replayer-hand-card.is-row').first().click({ timeout: 4000 });
    await p.waitForTimeout(2500);
    await p.locator('.rab-share').first().click({ timeout: 4000, force: true });
    await p.locator('.replayer-share-sheet').waitFor({ timeout: 3000 });
    await p.waitForTimeout(500);
    await run('replayer share sheet', '.replayer-share-sheet');
  } catch (e) { console.log(`  (replayer share sheet skipped: ${e.message.split('\n')[0]})`); }
  // The same sheet on a hand that came by a share link: its hand-history tile is off, with its reason.
  if (on('hands-replayer-share-shared')) try {
    await p.goto(base + '/#h/' + encodeURIComponent(SHARED_HAND_CODE), { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4500);
    await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 1000 }).catch(() => {});
    await p.locator('.rab-share').first().click({ timeout: 4000, force: true });
    await p.locator('.replayer-share-sheet').waitFor({ timeout: 3000 });
    await p.waitForTimeout(500);
    await run('replayer share sheet (shared hand)', '.replayer-share-sheet');
  } catch (e) { console.log(`  (replayer share sheet on a shared hand skipped: ${e.message.split('\n')[0]})`); }

  // Results & Tracking (the Bankroll tab), from a fresh load (a sheet left open by the step before can't block it).
  const openResults = async () => {
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 1000 }).catch(() => {});
    // Results is the Bankroll tab on both layouts since 2026-10-14 (it took Social's slot).
    const sel = (await p.evaluate(() => !!document.querySelector('.app-shell.is-desktop')))
      ? '.dk-rail-item:has-text("Bankroll")' : '.bottom-nav .nav-tab:has-text("Bankroll")';
    await p.locator(sel).first().click({ timeout: 4000 });
    await p.waitForTimeout(1800);
  };
  // The bankroll dashboard (app-admin beta), every tab: its tables and stats truncate long text.
  // Skipped quietly when the account has no bankroll strip (not an admin).
  if (on('bankroll-dashboard')) try {
    await openResults();
    await openSection(p, "Overview");
    await p.waitForTimeout(1800);
    // The sheet scrolls, and only text on screen is measured: run at the top, then page down
    // through the sheet's body, 11 pages at most. { toEnd } pages on until the body stops moving
    // (the Sessions list: 150 rows, ~10,000 px, then Show more); { from: 'here' } starts where the
    // body already is (the rows Show more just added) instead of at the top.
    const runSheet = async (label, { toEnd = false, from = 0 } = {}) => {
      if (from !== 'here') await p.evaluate(() => { const s = document.scrollingElement; if (s) s.scrollTop = 0; });
      await run(label, '.bd-inline');
      for (let i = 1; i < (toEnd ? 80 : 12); i++) {
        const moved = await p.evaluate((h) => {
          const s = document.scrollingElement;
          if (!s) return false;
          const before = s.scrollTop; s.scrollTop += Math.round(h * 0.7); return s.scrollTop !== before;
        }, H);
        if (!moved) break;
        await p.waitForTimeout(300);
        await run(`${label} (scrolled ${i})`, '.bd-inline');
      }
    };
    // The Overview's collapsible table sections: every one opened by its header (the state is
    // remembered per device, so they stay open for the passes below), and closed again at the end.
    const sections = async (expanded) => {
      const want = expanded ? 'false' : 'true';
      for (let i = 0; i < 12; i++) {
        const head = p.locator(`.bd-inline .ovt-head[aria-expanded="${want}"]`).first();
        if (!(await head.count())) break;
        await head.click({ timeout: 4000 });
        await p.waitForTimeout(450);
      }
      if (await p.locator(`.bd-inline .ovt-head[aria-expanded="${want}"]`).count()) throw new Error('an Overview section did not toggle');
      // Then until every collapse has finished: a body still mid-transition clips its own rows (by
      // design), and on a slow frame the last one can outlast the fixed wait above.
      await p.waitForFunction(() => {
        const o = document.querySelector('.bd-inline .ovt');
        return !o || !o.getAnimations || o.getAnimations({ subtree: true }).length === 0;
      }, null, { timeout: 5000 });
    };
    await sections(true);
    // Every section of the old dashboard, now on the page (owner, 2026-10-16), by its chip.
    const chip = (name) => ({ click: () => openSection(p, name) });
    for (const tab of ['Overview', 'Locations', 'Reports', 'Backers', 'Rules', 'Goals', 'Import']) {
      await chip(tab).click({ timeout: 4000 });
      await p.waitForTimeout(800);
      await runSheet(`bankroll ${tab}`);
    }
    await chip('Overview').click({ timeout: 4000 });
    await p.locator('.bd-inline .bd-mode button:has-text("Balance")').click({ timeout: 4000 });
    await p.locator('.bd-inline .bd-range button:has-text("All")').click({ timeout: 4000 });
    await p.waitForTimeout(800);
    await runSheet('bankroll dashboard overview (balance, all time)');
    // Every section closed: the headers carry their headline figures.
    await sections(false);
    await runSheet('bankroll dashboard overview (sections closed)');
    await p.locator('.bd-inline .bd-mode button:has-text("Profit")').click({ timeout: 4000 });
    await p.locator('.bd-inline .bd-range button:has-text("YTD")').click({ timeout: 4000 });
    // Reports: every report's table, scrolled through the sheet; then the filter sheet with a
    // filter on (its chips truncate long room names), scrolled through.
    const scrollRun = async (label, scroller, root) => {
      for (let i = 0; i < 4; i++) {
        await run(label, root);
        await p.evaluate(({ sel, dy }) => { const s = document.querySelector(sel); if (s) s.scrollTop += dy; }, { sel: scroller, dy: H * 0.7 });
        await p.waitForTimeout(300);
      }
    };
    await openSection(p, "Reports");
    await p.waitForTimeout(1200);
    const reportNames = await p.locator('.br-picker .br-chip:not([disabled])').allInnerTexts();
    for (const name of reportNames) {
      await p.evaluate(() => { const s = document.scrollingElement; if (s) s.scrollTop = 0; });
      await p.locator(`.br-picker .br-chip:has-text("${name.trim()}")`).first().click({ timeout: 4000 });
      await p.waitForTimeout(400);
      await scrollRun(`bankroll reports ${name.trim()}`, 'html', '.br-reports');
    }
    await p.evaluate(() => { const s = document.scrollingElement; if (s) s.scrollTop = 0; });
    await p.locator('.br-bar .bk-btn').first().click({ timeout: 4000 });
    await p.waitForTimeout(800);
    await p.locator('.br-fsheet .br-chip:has-text("Cash")').first().click({ timeout: 4000 });
    await p.waitForTimeout(400);
    await scrollRun('bankroll report filters', '.br-fsheet .an-body', '.br-fsheet');
  } catch (e) { console.log(`  (bankroll dashboard skipped: ${e.message.split('\n')[0]})`); }
  // Locations (the bankroll dashboard): a card open on its results (the first room with more than
  // ten, a page shown past them), then the cards sorted by name with every one open — an open card's
  // name wraps, so a long one is checked whole. Long event names truncate.
  if (on('bankroll-locations')) try {
    await openResults();
    await openSection(p, "Overview");
    await p.waitForTimeout(1500);
    await openSection(p, "Locations");
    await p.waitForTimeout(1200);
    const pageThrough = async (label) => {
      await p.evaluate(() => { const s = document.scrollingElement; if (s) s.scrollTop = 0; });
      await run(label, '.bd-inline');
      for (let i = 1; i < 30; i++) {
        const moved = await p.evaluate((h) => {
          const s = document.scrollingElement;
          const before = s.scrollTop; s.scrollTop += Math.round(h * 0.7); return s.scrollTop !== before;
        }, H);
        if (!moved) break;
        await p.waitForTimeout(250);
        await run(`${label} (scrolled ${i})`, '.bd-inline');
      }
    };
    const cards = p.locator('.bl-card');
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      await cards.nth(i).click({ timeout: 4000 });
      await p.waitForTimeout(300);
      if (await p.locator('.bl-pager').count()) break;
      await cards.nth(i).click({ timeout: 4000 });
    }
    await p.locator('.bl-pager .bl-more').first().click({ timeout: 4000 }).catch(() => {});
    await p.waitForTimeout(400);
    await pageThrough('bankroll locations, a card open');
    // Show fewer: back to ten, and every card closed again for the next pass.
    await p.locator('.bl-pager .bl-fewer').first().click({ timeout: 4000 }).catch(() => {});
    await p.evaluate(() => { const s = document.scrollingElement; if (s) s.scrollTop = 0; });
    await p.locator('.bl-sort button:has-text("Name")').first().click({ timeout: 4000 });
    await p.waitForTimeout(600);
    const shut = p.locator('.bl-card[aria-expanded="false"]');
    for (let k = await shut.count(); k > 0; k--) {
      await shut.first().click({ timeout: 4000 });
      await p.waitForTimeout(150);
    }
    await p.waitForTimeout(400);
    await pageThrough('bankroll locations by name, every card open');
  } catch (e) { console.log(`  (bankroll locations skipped: ${e.message.split('\n')[0]})`); }
  // Backers (the bankroll dashboard, read-only): the list, then every card open on its last ten shares
  // (a long name, stakes line, game or venue truncates; the "Last 10 of N sessions" line), then the
  // empty state and the state an account that is not the owner gets, each staged by answering the
  // route here and never sending it.
  if (on('bankroll-backers')) {
    const backersView = async (label, { status = 200, body = null, openAll = false } = {}) => {
      try {
        if (body) await p.route('**/api/staking/standing/backers', (r) => r.fulfill({ status, json: body }));
        try {
          await openResults();
          await openSection(p, "Overview");
          await p.waitForTimeout(1500);
          await openSection(p, "Backers");
          await p.locator('.bb-backers .bl-item, .bb-backers .an-p.bl-gap').first().waitFor({ timeout: 8000 });
          await p.waitForTimeout(600);
        } finally { if (body) await p.unroute('**/api/staking/standing/backers'); }
        if (openAll) {
          const shut = p.locator('.bb-item .bl-card[aria-expanded="false"]');
          for (let k = await shut.count(); k > 0; k--) {
            await shut.first().click({ timeout: 4000 });
            await p.waitForTimeout(150);
          }
          await p.waitForTimeout(400);
        }
        await p.evaluate(() => { const s = document.scrollingElement; if (s) s.scrollTop = 0; });
        await run(label, '.bd-inline');
        for (let i = 1; i < 30; i++) {
          const moved = await p.evaluate((h) => {
            const s = document.scrollingElement;
            const before = s.scrollTop; s.scrollTop += Math.round(h * 0.7); return s.scrollTop !== before;
          }, H);
          if (!moved) break;
          await p.waitForTimeout(250);
          await run(`${label} (scrolled ${i})`, '.bd-inline');
        }
      } catch (e) { console.log(`  (${label} skipped: ${e.message.split('\n')[0]})`); }
    };
    await backersView('bankroll backers');
    await backersView('bankroll backers, every card open', { openAll: true });
    await backersView('bankroll backers, none yet', { body: { backers: [] } });
    await backersView('bankroll backers, refused', { status: 403, body: { error: 'Forbidden' } });
  }
  // The dashboard import's review (Bankroll › Dashboard › Import › From the dashboard app;
  // docs/bankroll-merge.md §9.3), the controls guard's walk of the same name: the review paged
  // through with a pair card open (a 16g value, a backer's name and a row's label truncate), the
  // confirm step, the import done and its summary paged, the undo form, the undo refused by a row
  // edited since, the undo through, and a fetch so the run is back. The same world: the owner's
  // account on a scratch server with a staged run (scripts/seed-money-import-demo.js, the pull at
  // scripts/money-import-stub-dashboard.js); skipped and said otherwise.
  if (on('bankroll-import-dashboard')) try {
    const label = 'bankroll import';
    const sheet = '.bd-inline';
    const pageSheet = async (name) => {
      await p.evaluate(() => { const s = document.scrollingElement; if (s) s.scrollTop = 0; });
      await p.waitForTimeout(250);
      await run(name, sheet);
      for (let i = 1; i < 30; i++) {
        const moved = await p.evaluate((h) => {
          const s = document.scrollingElement;
          const before = s.scrollTop; s.scrollTop += Math.round(h * 0.7); return s.scrollTop !== before;
        }, H);
        if (!moved) break;
        await p.waitForTimeout(250);
        await run(`${name} (scrolled ${i})`, sheet);
      }
    };
    const at = async (sel) => { await p.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollIntoView({ block: 'center' }); }, sel); await p.waitForTimeout(400); };
    const saved = async () => {
      await p.waitForFunction(() => ![...document.querySelectorAll('.bd-inline .bid-state')].some((s) => /Saving/.test(s.textContent)), null, { timeout: 60000 });
      await p.waitForTimeout(500);
    };
    await openResults();
    await openSection(p, "Overview");
    await p.waitForTimeout(1500);
    await openSection(p, "Import");
    await p.locator('.bd-inline .bid').first().waitFor({ timeout: 8000 });
    await p.waitForTimeout(800);
    if (!(await p.locator('.bd-inline .bid-review').count())) throw new Error('no staged run (scripts/seed-money-import-demo.js)');
    // Every pair answered, so Import opens; the first pair card open on its whole values.
    const fill = p.locator('.bd-inline button:has-text("Fill the likely ones")');
    if (await fill.count() && await fill.first().isEnabled()) { await fill.first().click(); await p.waitForTimeout(300); }
    for (const seg of await p.locator('.bd-inline .bid-pair-seg').all()) {
      if (await seg.locator('[aria-checked="true"]').count()) continue;
      await seg.locator('[role="radio"]').first().click();
      await p.waitForTimeout(150);
    }
    await saved();
    await p.locator('.bd-inline .bid-pair .bid-pair-fields').first().click();
    await p.waitForTimeout(400);
    await pageSheet(`${label} review`);
    await p.locator('.bd-inline .bid-commit .bk-btn--brand').first().click({ timeout: 4000 });
    await p.locator('.bd-inline .bid-confirm').first().waitFor({ timeout: 4000 });
    await at('.bd-inline .bid-confirm');
    await run(`${label} confirm`, sheet);
    await p.locator('.bd-inline .bid-confirm .bk-btn--brand').first().click({ timeout: 4000 });
    await p.locator('.bd-inline .bid-summary').first().waitFor({ timeout: 90000 });
    await p.waitForTimeout(600);
    await pageSheet(`${label} summary`);
    const edited = await p.evaluate(async () => {
      const h = { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' };
      const list = await fetch('/api/cash-sessions', { headers: h }).then((r) => r.json()).catch(() => null);
      const rows = list && Array.isArray(list.sessions) ? list.sessions : [];
      const row = rows.find((s) => Object.values(s).some((v) => typeof v === 'string' && /wynn/i.test(v)));
      if (!row) return null;
      const r = await fetch(`/api/cash-sessions/${row.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ notes: 'guard: edited after the import' }) });
      return r.ok ? row.id : null;
    });
    await p.locator('.bd-inline button:has-text("Undo this import")').first().click({ timeout: 4000 });
    const form = p.locator('.bd-inline form.bid-confirm');
    const count = await form.locator('.bk-field-label').first().innerText();
    await form.locator('input').fill((count.match(/\d[\d,]*/) || [''])[0].replace(/,/g, ''));
    await at('.bd-inline form.bid-confirm');
    await run(`${label} undo form`, sheet);
    await form.locator('button[type="submit"]').click({ timeout: 4000 });
    if (edited != null) {
      await p.locator('.bd-inline .bid-undo-err').first().waitFor({ timeout: 60000 });
      await at('.bd-inline .bid-undo-err');
      await run(`${label} undo refused`, sheet);
      await p.evaluate((id) => fetch(`/api/cash-sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }), edited);
      await form.locator('button[type="submit"]').click({ timeout: 4000 });
    } else console.log(`  (${label}: no imported Wynn cash session to edit, so the refused undo was not scanned)`);
    await p.locator('.bd-inline .bid-summary').waitFor({ state: 'detached', timeout: 60000 });
    await p.waitForTimeout(500);
    await run(`${label} undone`, sheet);
    const again = p.locator('.bd-inline .bid button:has-text("Fetch from the dashboard")').first();
    if (await again.isEnabled()) {
      await again.click();
      await p.locator('.bd-inline .bid-review').first().waitFor({ timeout: 90000 }).catch(() => {});
    } else console.log(`  (${label}: the pull is off, so the run was not fetched again; seed before the next size)`);
  } catch (e) { console.log(`  (bankroll import skipped: ${e.message.split('\n')[0]})`); }
  // Results > Cash (cash sessions beta), each screen: the running session (it opens by itself while
  // one runs) and its rebuy and cash-out panels; the list (chip graph, month headers, rows with
  // notes); Stats; a session's page; the add form with More open; and the live-session bar over the
  // nav on another tab. Each screen scrolled through, since rows and fields truncate.
  const CASH = '.results-kind-tabs, .cs-view, .cs-bar';
  const cashScreen = async (label, steps) => {
    try {
      await openResults();
      await openSection(p, 'Cash');
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
  if (on('cash')) await cashScreen('cash live', []);
  if (on('cash')) await cashScreen('cash live rebuy', ['.cs-livescreen button:has-text("Rebuy")']);
  if (on('cash')) await cashScreen('cash live cash-out', ['.cs-livescreen button:has-text("Cash out")']);
  if (on('cash')) await cashScreen('cash list', [back]);
  if (on('cash')) await cashScreen('cash stats', [back, '.cs-stats-launch']);
  if (on('cash')) await cashScreen('cash session', [back, '[data-cash-row]']);
  if (on('cash')) await cashScreen('cash add', [back, '.cs-head button[title="Add a past session"]', '.cs-form-foot button']);
  if (on('cash-bar')) try {
    await openResults();
    await openSection(p, 'Cash');
    await p.waitForTimeout(1200);
    await openSection(p, 'MTT');
    await p.waitForTimeout(800);
    await run('cash bar', CASH);
  } catch (e) {
    console.log(`  (cash bar skipped: ${e.message.split('\n')[0]})`);
  }

  // The floating + on the bankroll pages (components/BankrollFab.jsx) and its menu: the Results tab's
  // with a session running (the seed's: the + is raised over the cash bar), with none (the live fetch
  // answered here and never sent: the menu then has Start live session as a fourth row), and the
  // dashboard sheet's. The + holds an icon only; the menu's rows are text under overflow: hidden.
  const fabView = async (label, { idle = false, sheet = false } = {}) => {
    try {
      if (idle) await p.route('**/api/cash-sessions/live', (r) => r.fulfill({ json: { session: null, stacks: [], now: new Date().toISOString() } }));
      try {
        await openResults();
        if (sheet) {
          await p.locator('.bk-bar .bk-act:has-text("Dashboard")').first().click({ timeout: 4000 });
          await p.waitForTimeout(1800);
        }
        const fab = p.locator(sheet ? '.bk-fab--sheet' : '.bk-fab--page');
        await fab.first().waitFor({ timeout: 4000 });
        await run(`${label} (closed)`, sheet ? '.an-sheet' : '.bk-fab');
        await fab.first().click({ timeout: 4000 });
        await p.locator('.bk-fab-menu').waitFor({ timeout: 3000 });
        const rows = await p.locator('.bk-fab-menu [role="menuitem"]').count();
        if (rows !== (idle ? 4 : 3)) throw new Error(`the menu has ${rows} rows, expected ${idle ? 4 : 3}`);
        await run(label, '.bk-fab-menu');
      } finally { if (idle) await p.unroute('**/api/cash-sessions/live'); }
    } catch (e) { console.log(`  (${label} skipped: ${e.message.split('\n')[0]})`); }
  };
  if (on('bankroll-fab')) await fabView('bankroll + menu');
  if (on('bankroll-fab')) await fabView('bankroll + menu, no session running', { idle: true });

  // Results → Expenses & income (admin beta) and its sheets: rows, cells and trip lines truncate
  // with an ellipsis. Skipped quietly where the section is absent (a non-admin token).
  if (on('expenses')) try {
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

  // The Backers block of the Notify tap (components/BackerNotify.jsx; the owner's, so the token must be
  // the owner's) under a tournament result's edit form and on a cash session's page: previewed (the
  // server's answer), sent, the warning's confirm open, none staked, and long names, figures and
  // series titles so every truncating line truncates. All but the first are staged by
  // notify-states.mjs, which answers the block's request in the page and never lets a tap through.
  for (const [where, prefix] of [['results', 'results-notify'], ['cash', 'cash-notify']]) {
    if (!on(prefix)) continue;
    for (const kind of [null, 'sent', 'warning', 'none', 'long']) {
      const label = `${prefix}${kind ? ', ' + kind : ''}`;
      try {
        const unstage = kind ? await stageNotify(p, kind) : null;
        try {
          await openResults();
          if (where === 'results') {
            if (!(await p.locator('.results-kind-tabs .kind-toggle.active:has-text("MTT")').count())) { await openSection(p, 'MTT'); await p.waitForTimeout(900); }
            const edit = p.locator('.tracking-actions button:has-text("Edit")').filter({ visible: true }).first();
            await edit.scrollIntoViewIfNeeded({ timeout: 4000 });
            await edit.click({ timeout: 4000 });
          } else {
            await openSection(p, 'Cash');
            await p.waitForTimeout(1500);
            await p.locator('.cs-head button:has-text("Sessions")').first().click({ timeout: 4000 });
            await p.waitForTimeout(700);
            await p.locator('[data-cash-row]').first().click({ timeout: 4000 });
          }
          await p.locator('.bn').filter({ visible: true }).first().waitFor({ timeout: 8000 });
          if (kind === 'warning' || kind === 'long') {
            await p.locator('.bn-row.has-warn .bn-btn--brand').filter({ visible: true }).first().click({ timeout: 4000 });
            await p.locator('.bn-row-act[role="group"]').first().waitFor({ timeout: 3000 });
          }
        } finally { if (unstage) await unstage(); }
        await p.locator('.bn').filter({ visible: true }).first().scrollIntoViewIfNeeded({ timeout: 4000 });
        await p.waitForTimeout(400);
        await run(label, '.bn');
      } catch (e) { console.log(`  (${label} skipped: ${e.message.split('\n')[0]})`); }
      // The Results tab remembers its half per device: back to Tournaments, which the passes after need.
      if (where === 'cash') await openSection(p, 'MTT').catch(() => {});
    }
  }

  // Results > Delete results (components/ResetResults.jsx) at the foot of the list: its sentence
  // wraps over 2r lines; closed, then open with the phrase typed.
  if (on('results-reset')) try {
    await openResults();
    await p.locator('.rr').first().waitFor({ timeout: 4000 });
    await p.evaluate(() => document.querySelector('.rr').scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(500);
    await run('results reset', '.rr');
    await p.locator('.rr .bk-btn--danger').first().click({ timeout: 4000 });
    await p.waitForTimeout(300);
    await p.locator('.rr-input').fill(await p.locator('.rr-label b').innerText());
    await p.waitForTimeout(300);
    await run('results reset (open)', '.rr');
  } catch (e) { console.log(`  (results reset skipped: ${e.message.split('\n')[0]})`); }

  // First-run setup (components/OnboardingWizard.jsx), re-opened as the location menu's "Run setup
  // again" does: step 1 (and with city results, where the scratch server reaches Nominatim), step
  // 2 with Yes, step 3; then step 2 again where it changes what it asks (Europe's one line, the
  // longest state name in the sites checkbox), the zero-count line, and Settings' "Edit name"
  // dialog. Its tiles truncate their two lines with an ellipsis. Nothing is finished. Generous
  // waits: a busy box draws a 1440 x 3 WebKit page at 2-3 frames a second, and a click waits for
  // the button to be stable across frames. The count of views measured is printed, so a section
  // that quietly measured nothing cannot read as a pass.
  let setupViews = 0;
  const setupRun = async (label, sel) => { await run(label, sel); setupViews++; };
  try {
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await p.evaluate(() => window.dispatchEvent(new Event('reopen-onboarding')));
    await p.locator('.modal-content.ob').waitFor({ timeout: 15000 });
    await p.waitForTimeout(600);
    const SETUP = '.modal-content.ob';
    const tap = async (sel, wait = 500) => { await p.locator(sel).filter({ visible: true }).first().click({ timeout: 15000 }); await p.waitForTimeout(wait); };
    await setupRun('first-run setup step 1', SETUP);
    await p.locator('.ob-search').fill('Austin');
    await p.waitForTimeout(1500);
    for (let i = 0; i < 10 && !(await p.locator('.ob-results .ob-row').count()); i++) await p.waitForTimeout(300);
    if (await p.locator('.ob-results .ob-row').count()) await setupRun('first-run setup step 1 (search)', SETUP);
    else console.log('  (first-run setup search results skipped: no results from the geocoder)');
    await tap('.ob-foot button:has-text("Next")', 600);
    await tap('.ob-tile:has-text("Yes")', 400);
    await setupRun('first-run setup step 2', SETUP);
    await tap('.ob-foot button:has-text("Next")', 600);
    await setupRun('first-run setup step 3', SETUP);
    // Step 2 for Europe, then for Nevada with the longest state name ticked.
    await tap('.ob-foot button:has-text("Back")', 400);
    await tap('.ob-foot button:has-text("Back")', 400);
    await tap('.ob-cell:has-text("Europe")', 400);
    await tap('.ob-foot button:has-text("Next")', 600);
    await setupRun('first-run setup step 2 (Europe)', SETUP);
    await tap('.ob-foot button:has-text("Back")', 400);
    await tap('.ob-cell:has-text("Las Vegas")', 400);
    await tap('.ob-foot button:has-text("Next")', 600);
    await p.locator('#ob-state').selectOption('DC');
    await p.waitForTimeout(300);
    if ((await p.locator('.ob-check').getAttribute('aria-checked')) !== 'true') await tap('.ob-check', 300);
    await setupRun('first-run setup step 2 (District of Columbia)', SETUP);
    // The zero-count line: chips on Texas that match nothing in the data, where there are some.
    await tap('.ob-foot button:has-text("Back")', 400);
    await tap('.ob-cell:has-text("Texas")', 400);
    await tap('.ob-foot button:has-text("Next")', 500);
    await tap('.ob-foot button:has-text("Next")', 600);
    for (const chip of ['$5K+', 'Mixed', 'PLO']) {
      if ((await p.locator('.ob-status').innerText()).startsWith('Nothing upcoming')) break;
      await tap('.ob-chip:has-text("' + chip + '")', 500);
    }
    if ((await p.locator('.ob-status').innerText()).startsWith('Nothing upcoming')) await setupRun('first-run setup step 3 (nothing matches)', SETUP);
    else console.log('  (first-run setup zero-count line skipped: nothing in this data matched no chip combination)');
    // Settings' Edit name: the name dialog on the current name. Setup is left open and the page
    // reloaded by openTab, never closed with Esc or Skip: those SAVE the steps already confirmed,
    // and a guard run must not write a location to the account it signs in as.
    await openTab('Settings').catch(async () => {
      await p.locator('.username-chip').first().click({ timeout: 4000 });
      await p.waitForTimeout(400);
      await p.getByRole('button', { name: 'Settings', exact: true }).first().click({ timeout: 4000 });
      await p.waitForTimeout(1800);
    });
    await tap('button:has-text("Edit name")', 900);
    await setupRun('first-run setup name dialog', '.modal-content.ob');
    console.log(`  first-run setup: ${setupViews} views measured`);
  } catch (e) { console.log(`  (first-run setup skipped after ${setupViews} views: ${e.message.split('\n')[0]})`); }

  // Staking > a series > Settlement (docs/bankroll-merge.md §10): an open sheet (its figures, its
  // inputs, the who-pays line) and a settled one (Paid toggles, the ledger line), paged through.
  // Nothing in the UI navigates to Staking, so through a component's onNavigate, as the control
  // guard does. Needs series named "Guard Open" and "Guard Settled" (a scratch seed); skipped and
  // said otherwise.
  for (const title of on('staking-settlement') ? ['Guard Open', 'Guard Settled'] : []) {
    const label = `staking settlement, ${title.toLowerCase()}`;
    try {
      await openTab('Dashboard');
      const reached = await p.evaluate(() => {
        for (const el of document.querySelectorAll('.tab-panel *, .dk-rail *')) {
          const k = Object.keys(el).find(k => k.startsWith('__reactFiber'));
          if (!k) continue;
          for (let f = el[k]; f; f = f.return) if (f.memoizedProps && typeof f.memoizedProps.onNavigate === 'function') { f.memoizedProps.onNavigate('staking'); return true; }
        }
        return false;
      });
      if (!reached) throw new Error('no onNavigate to reach staking');
      await p.waitForTimeout(1800);
      await p.locator(`.staking-series-card:has-text("${title}")`).first().click({ timeout: 4000 });
      await p.waitForTimeout(1200);
      await p.locator('.group-segment-btn:has-text("Settlement")').first().click({ timeout: 4000 });
      await p.locator('.staking-settlement-card').first().waitFor({ timeout: 6000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 12; i++) {
        await run(`${label}${i ? ` (scrolled ${i})` : ''}`, '.group-detail-view');
        const moved = await p.evaluate((h) => {
          let sc = document.querySelector('.group-detail-view');
          while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
          if (!sc) return false;
          const before = sc.scrollTop; sc.scrollTop += Math.round(h * 0.7); return sc.scrollTop !== before;
        }, H);
        if (!moved) break;
        await p.waitForTimeout(300);
      }
    } catch (e) { console.log(`  (${label} skipped: ${e.message.split('\n')[0]})`); }
  }

  // The Staking tab's Standing view (Phase 8), the controls guard's walk: the list, the add form
  // with a new backer, a card's stakes editor with its correction preview, a card's shares, the New
  // link and Delivery confirms. Long names, stakes lines and share details truncate. Needs
  // scripts/seed-standing-demo.js on the scratch database; skipped and said otherwise.
  if (on('staking-standing')) try {
    const label = 'staking standing';
    const reachStaking = async () => {
      await openTab('Dashboard');
      const reached = await p.evaluate(() => {
        for (const el of document.querySelectorAll('.tab-panel *, .dk-rail *')) {
          const k = Object.keys(el).find(k => k.startsWith('__reactFiber'));
          if (!k) continue;
          for (let f = el[k]; f; f = f.return) if (f.memoizedProps && typeof f.memoizedProps.onNavigate === 'function') { f.memoizedProps.onNavigate('staking'); return true; }
        }
        return false;
      });
      if (!reached) throw new Error('no onNavigate to reach staking');
      await p.waitForTimeout(1800);
      await p.locator('.tab-panel[data-tab="staking"] button:has-text("Standing")').first().click({ timeout: 4000 });
      await p.locator('.sd').first().waitFor({ timeout: 8000 });
      await p.waitForTimeout(800);
    };
    const scan = async (name) => {
      await run(name, '.sd');
      for (let i = 1; i < 12; i++) {
        const moved = await p.evaluate((h) => {
          let sc = document.querySelector('.sd');
          while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
          if (!sc) return false;
          const before = sc.scrollTop; sc.scrollTop += Math.round(h * 0.7); return sc.scrollTop !== before;
        }, H);
        if (!moved) break;
        await p.waitForTimeout(300);
        await run(`${name} (scrolled ${i})`, '.sd');
      }
    };
    const card = '.sd-card:has-text("Demo Standing Sam")';
    await reachStaking();
    if (!(await p.locator(card).count())) throw new Error('no seeded card (scripts/seed-standing-demo.js)');
    await scan(label);
    await p.locator('.sd .create-group-submit:has-text("+ Add")').first().click({ timeout: 4000 });
    await p.locator('.sd-form select').first().selectOption('new');
    await p.waitForTimeout(500);
    await scan(`${label}, add form`);
    await reachStaking();
    await p.locator(`${card} button:has-text("Stakes")`).first().click({ timeout: 4000 });
    await p.locator('.sd-editor [role="radio"]:has-text("Correct")').first().click({ timeout: 4000 });
    await p.locator('.sd-editor button:has-text("Preview")').first().click({ timeout: 4000 });
    await p.locator('.sd-editor button:has-text("Confirm")').first().waitFor({ timeout: 6000 });
    await p.waitForTimeout(400);
    await scan(`${label}, stakes editor`);
    await reachStaking();
    await p.locator(`${card} button:has-text("Shares")`).first().click({ timeout: 4000 });
    await p.locator('.sd-event').first().waitFor({ timeout: 8000 });
    await p.locator(`${card} button:has-text("New link")`).first().click({ timeout: 4000 });
    await p.waitForTimeout(500);
    await scan(`${label}, shares and link`);
  } catch (e) { console.log(`  (staking standing skipped: ${e.message.split('\n')[0]})`); }
  // The backer page (/b/<token>, no login: components/BackerPage.jsx), paged through: a full
  // history (then its graph on 1M), a backer with no sessions yet, one session. CHECK_BACKER_TOKENS
  // (full,empty,one) names made-up backers on a scratch server (scripts/seed-backer-demo.js prints
  // the line); without it these are skipped and say so.
  if (on('backer-page')) {
    const toks = (process.env.CHECK_BACKER_TOKENS || '').split(',').map(s => s.trim());
    const names = ['full history', 'no sessions', 'one session'];
    if (!toks[0]) console.log('  (backer page skipped: needs CHECK_BACKER_TOKENS, from scripts/seed-backer-demo.js)');
    for (let i = 0; i < 3 && toks[i]; i++) {
      try {
        await p.goto(base + '/b/' + toks[i], { waitUntil: 'domcontentloaded' });
        await p.locator('.bp-name, .bp-message').first().waitFor({ timeout: 8000 });
        await p.waitForTimeout(800);
        for (let k = 0; k < 12; k++) {
          await run(`backer page, ${names[i]}${k ? ` (scrolled ${k})` : ''}`, '.bp-shell');
          const moved = await p.evaluate((h) => {
            const sc = document.querySelector('.bp-content');
            const before = sc.scrollTop; sc.scrollTop += Math.round(h * 0.7); return sc.scrollTop !== before;
          }, H);
          if (!moved) break;
          await p.waitForTimeout(300);
        }
        const r1 = p.locator('.bp-seg button:has-text("1M")');
        if (i === 0 && await r1.count()) {
          await p.evaluate(() => { document.querySelector('.bp-content').scrollTop = 0; });
          await r1.first().click({ timeout: 4000 });
          await p.waitForTimeout(400);
          await run('backer page, full history (1M)', '.bp-shell');
        }
        if (i === 0) {
          // The first six session cards open, notes and all (owner, 2026-10-15), from the top.
          if (await r1.count()) await p.locator('.bp-seg button:has-text("All")').first().click({ timeout: 4000 }).catch(() => {});
          await p.evaluate(() => { document.querySelector('.bp-content').scrollTop = 0; for (const c of [...document.querySelectorAll('.bp-session .cal-event-bar')].slice(0, 6)) c.click(); });
          await p.waitForTimeout(400);
          for (let k = 0; k < 4; k++) {
            await run(`backer page, notes open${k ? ` (scrolled ${k})` : ''}`, '.bp-shell');
            const moved = await p.evaluate((h) => { const sc = document.querySelector('.bp-content'); const b = sc.scrollTop; sc.scrollTop += Math.round(h * 0.7); return sc.scrollTop !== b; }, H);
            if (!moved) break;
            await p.waitForTimeout(300);
          }
        }
      } catch (e) { console.log(`  (backer page, ${names[i]} skipped: ${e.message.split('\n')[0]})`); }
    }
  }

  // futurega.me/live, the ads' landing page (2026-10-15), from the top to its foot.
  if (on('live-page')) {
    try {
      await p.goto(base + '/live', { waitUntil: 'domcontentloaded' });
      await p.locator('.lp-figure').first().waitFor({ timeout: 8000 });
      await p.waitForTimeout(1200);
      for (let k = 0; k < 4; k++) {
        await run(`live page${k ? ` (scrolled ${k})` : ''}`, '.bp-shell');
        const moved = await p.evaluate((h) => { const sc = document.querySelector('.lp-content'); const b = sc.scrollTop; sc.scrollTop += Math.round(h * 0.7); return sc.scrollTop !== b; }, H);
        if (!moved) break;
        await p.waitForTimeout(300);
      }
    } catch (e) { console.log(`  (live page skipped: ${e.message.split('\n')[0]})`); }
  }

  const uniq = [...new Map(found.map(f => [f.view.split(' (')[0] + f.text + f.host, f])).values()];
  console.log(`scanned ${scanned.size} views${args.includes('--verbose') ? ': ' + [...scanned].join(', ') : ''}`);
  if (uniq.length) {
    console.log(`CLIPPED TEXT at ${W}x${H}: ${uniq.length}`);
    for (const f of uniq) console.log(`  [${f.view}] "${f.text}" (${f.host}) cut ${f.cutPx}px at the ${f.edge} by ${f.clipper}`);
  } else {
    console.log(`no clipped text at ${W}x${H}`);
  }
  await b.close();
  process.exit(uniq.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
