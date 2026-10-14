// Finds text whose glyphs are cut off by a clipping ancestor — descenders (g, p, y, j, q) sliced at
// a grid line, the bug that kept coming back on schedule event names.
//
//   node scripts/check-text-clipping.mjs [baseUrl] [--width 402] [--height 874]
//   (CHECK_BASE_URL / CHECK_TOKEN / CHECK_TOKEN_FILE / CHECK_USERNAME as check-control-centring.mjs)
//
// Signs in as the local admin test user, opens the Schedule list, an expanded card and My
// Schedule, the home (Dashboard) paged to its foot (plain, then its NUMBERS in trip mode, series
// mode and the edge state, the empty-schedule prompt, and the signal-or-noise line as progress and
// about cash), its Scan sheet, every Up Next card (and a page turn to a taller one with the mouse
// left on the pager), the cash card's stack entry, its Log menu and a To log row's Undo state, and Hands'
// Scanner, the venue map opened from a Schedule strip and from an Up Next banner, the backer page
// (/b/<token>, with CHECK_BACKER_TOKENS: full history paged through, no sessions, one session) (and, for an
// admin, each tab of the bankroll dashboard — the Overview with every table
// section open, then closed — every Reports table and the
// Reports filter sheet, a Locations card open a page past its first ten and the Locations sorted by
// name with every card open, then Results > Cash: the running session and its panels, the session
// list, Stats, a session, the add form, the live bar), and for every text node inside those
// views measures its glyph
// box (a Range over the text, which spans ascent to descent) against every ancestor that clips
// (overflow other than visible, or overflow-y clip). A glyph box that ends more than 0.5 CSS px
// below a clipping
// ancestor's bottom (or starts above its top) is reported. Exits 1 when anything is clipped, so it
// can gate a deploy. WebKit, because the app ships in WKWebView.
import { createRequire } from 'node:module';
import { stageHome, routeHomeLayout } from './home-states.mjs';
const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
// Resolved up the tree, not by a fixed path: a git worktree inside the checkout has no
// node_modules of its own and finds the checkout's.
const jwt = require('jsonwebtoken');

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
  await ctx.addInitScript(({ t }) => {
    localStorage.setItem('token', t); localStorage.setItem('username', 'ham5');
    localStorage.setItem('onboardComplete', '1'); localStorage.setItem('hasOnboarded', 'true');
    // Past the first-run wizard (utils/location-prefs.js hasOnboarded reads 'onboarded'): on a
    // busy box its Skip click outran the 1 s wait at 1440 and its entrance animation can outlast
    // it on a slow desktop render; the wizard's backdrop then swallowed the Results click, skipping
    // 10 sections while still printing a passing line.
    localStorage.setItem('onboarded', '1');
  }, { t });
  // Edit home: every view sees the default home whatever the account saved, and the sheet's
  // changes are answered here and never written (scripts/home-states.mjs).
  await routeHomeLayout(ctx);
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
  try {
    await openTab('Dashboard');
    await pageHome('home');
  } catch (e) { console.log(`  (home skipped: ${e.message.split('\n')[0]})`); }
  // Its NUMBERS in the states the account does not show by itself (scripts/home-states.mjs): trip
  // mode, series mode (long titles that truncate), and the edge state (the longest signal pill, an
  // empty month, an empty Last result), each staged in the page, nothing written.
  // The signal-or-noise line (step 6; admins) loads after the first paint: its states wait for it.
  const READY = { 'noise-progress': '.hm-noise[data-kind="progress"]', 'noise-cash': '.hm-noise[data-kind="window"]' };
  for (const kind of ['trip', 'series', 'edge', 'empty', 'noise-progress', 'noise-cash']) {
    try {
      const undo = await stageHome(p, kind);
      try {
        await openTab('Dashboard');
        if (READY[kind]) await p.locator(READY[kind]).first().waitFor({ state: 'attached', timeout: 6000 }).catch(() => { throw new Error("no noise line (it is an admin's)"); });
        await pageHome(`home ${kind}`);
      } finally { await undo(); }
    } catch (e) { console.log(`  (home ${kind} skipped: ${e.message.split('\n')[0]})`); }
  }
  try {
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
  try {
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
  try {
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
  try {
    await openTab('Dashboard');
    if (!(await p.locator('.hm-cash-card').count())) throw new Error('no cash session running (the first Up Next card of an admin)');
    await p.locator('.hm-cash-card .hm-cash-btn').first().click({ timeout: 4000 });
    await p.locator('.hm-cash-entry').waitFor({ timeout: 3000 });
    await run('home cash entry', HOME);
  } catch (e) { console.log(`  (home cash entry skipped: ${e.message.split('\n')[0]})`); }
  // The home's Log menu (admins), and a To log row turned into its Undo row by Didn't play — that
  // write answered here and never sent, so the guard changes nothing on the server it checks.
  try {
    await openTab('Dashboard');
    if (!(await p.locator('.hm-head-pill--log[aria-haspopup]').count())) throw new Error('no Log menu (not an admin: the pill opens the form)');
    await p.locator('.hm-head-pill--log').first().click({ timeout: 4000 });
    await p.locator('.hm-logmenu').waitFor({ timeout: 3000 });
    await run('home log menu', '.hm-logmenu');
  } catch (e) { console.log(`  (home log menu skipped: ${e.message.split('\n')[0]})`); }
  try {
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
  try {
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
  try {
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
  for (const kind of ['layout-custom', ...((await isDesktop()) ? ['layout-numbers-empty'] : [])]) {
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
  try {
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
  try {
    await openTab('Schedule');
    await p.locator('.cal-event-row:not(.past) .cal-venue-strip[aria-haspopup="dialog"]').filter({ visible: true }).first().click({ timeout: 4000 });
    await venueMap('venue map (schedule strip)');
  } catch (e) { console.log(`  (venue map from a Schedule strip skipped: ${e.message.split('\n')[0]})`); }
  try {
    await openTab('Dashboard');
    const i = await p.evaluate(() => [...document.querySelectorAll('.dashboard-view.home .dash-carousel-slide')]
      .findIndex((sl) => sl.querySelector('.dash-venue-strip.has-map')));
    if (i < 0) throw new Error('no Up Next card with a venue map');
    if (i > 0) { await goCard(i); await p.waitForTimeout(700); }
    await p.locator('.dashboard-view.home .dash-venue-strip.has-map').filter({ visible: true }).first().click({ timeout: 4000 });
    await venueMap('venue map (up next)');
  } catch (e) { console.log(`  (venue map from Up Next skipped: ${e.message.split('\n')[0]})`); }
  try {
    await openTab('Hands');
    await p.locator('.hands-tool-row button:has-text("Scanner")').first().click({ timeout: 4000 });
    await p.waitForTimeout(800);
    await run('hands scanner', '.hands-scan');
  } catch (e) { console.log(`  (hands scanner skipped: ${e.message.split('\n')[0]})`); }

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
      // Then until every collapse has finished: a body still mid-transition clips its own rows (by
      // design), and on a slow frame the last one can outlast the fixed wait above.
      await p.waitForFunction(() => {
        const o = document.querySelector('.an-sheet .ovt');
        return !o || !o.getAnimations || o.getAnimations({ subtree: true }).length === 0;
      }, null, { timeout: 5000 });
    };
    await sections(true);
    // Every tab in the strip, whatever it holds (Overview, Rules, Goals, Import, and any added
    // later; once the tabs outgrow 35g the strip scrolls sideways, and each click scrolls it to its
    // tab), then the Overview again with its graph switched to Balance and the range to All.
    const tabs = p.locator('.an-sheet .bd-tabs [role="radio"]');   // the tabs, not the page chevrons
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
  // Locations (the bankroll dashboard): a card open on its results (the first room with more than
  // ten, a page shown past them), then the cards sorted by name with every one open — an open card's
  // name wraps, so a long one is checked whole. Long event names truncate.
  try {
    await openResults();
    await p.locator('.bk-head-btn:has-text("Dashboard")').first().click({ timeout: 4000 });
    await p.waitForTimeout(1500);
    await p.locator('.an-sheet .bd-tabs [role="radio"]:has-text("Locations")').first().click({ timeout: 4000 });
    await p.waitForTimeout(1200);
    const pageThrough = async (label) => {
      await p.evaluate(() => { const s = document.querySelector('.an-sheet .an-body'); if (s) s.scrollTop = 0; });
      await run(label, '.an-sheet');
      for (let i = 1; i < 30; i++) {
        const moved = await p.evaluate((h) => {
          const s = document.querySelector('.an-sheet .an-body');
          const before = s.scrollTop; s.scrollTop += Math.round(h * 0.7); return s.scrollTop !== before;
        }, H);
        if (!moved) break;
        await p.waitForTimeout(250);
        await run(`${label} (scrolled ${i})`, '.an-sheet');
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
    await p.evaluate(() => { const s = document.querySelector('.an-sheet .an-body'); if (s) s.scrollTop = 0; });
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

  // Results > Delete results (components/ResetResults.jsx) at the foot of the list: its sentence
  // wraps over 2r lines; closed, then open with the phrase typed.
  try {
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

  // The backer page (/b/<token>, no login: components/BackerPage.jsx), paged through: a full
  // history (then its graph on 1M), a backer with no sessions yet, one session. CHECK_BACKER_TOKENS
  // (full,empty,one) names made-up backers on a scratch server (scripts/seed-backer-demo.js prints
  // the line); without it these are skipped and say so.
  {
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
      } catch (e) { console.log(`  (backer page, ${names[i]} skipped: ${e.message.split('\n')[0]})`); }
    }
  }

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
