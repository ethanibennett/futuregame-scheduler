// Pills and buttons (owner rule, 2026-10-10): the CONTAINER sits on the grid — whole g wide, whole
// r tall, left edge on a g line, top edge on an r line — and the LABEL inside is centred in it on
// both axes, disregarding the grid. This measures both, for every visible control, in WebKit.
//
// Views: Schedule (list, filters, an open card), My Schedule, Dashboard, Social, Results,
// Settings, Cash (Live, Heatmaps), Hands (the list, not the table), Calendar (and its filters),
// the bankroll sheet, the bankroll dashboard and its CSV import step.
//
//   node scripts/check-control-centring.mjs [baseUrl] [--width 402] [--height 874]
//        [--json out.json] [--only "schedule,cash"] [--dump] [--shots dir [--overlay]]
//   (--dump lists passing controls too; --shots saves a screenshot of each view as scanned,
//   --overlay with the grid overlay on)
//   npm run check:controls          (both sizes; base URL from CHECK_BASE_URL, else :3001)
//
//   CHECK_BASE_URL  the server to check, when no baseUrl argument is given
//   CHECK_TOKEN     a JWT for an admin account on that server (default: one signed with the pm2
//                   app's JWT_SECRET from ecosystem.config.cjs, for http://localhost:3001)
//   CHECK_TOKEN_FILE  or a file holding one
//   CHECK_USERNAME  that account's username (default ham5)
//
// For each control (selector list CONTROLS below; an element holding two or more other controls is
// a group, not a control):
//   (a) the border box against the grid: width / g and height / r within 0.05 of a whole number,
//       left edge within 0.05 g of a g line (lines run from the .app-shell's left edge: x = 0 on a
//       phone, the shell's centred left on desktop, where every rail and pane is a whole g from it)
//       and top edge within 0.05 r of an r line counted from the .top-bar's top — the origin
//       GridOverlay draws its baseline ruler from. Scrolled content is measured as laid out: each
//       scroller's offset is added back (not across a stuck sticky or a fixed element).
//   (b) the label's INK centre against the box centre, in CSS px, both axes; fails past 0.75px.
//       Ink is not the text box. Per line, the baseline is the Range rect's top plus the font's
//       ascent (canvas fontBoundingBoxAscent — WebKit lays the text box out on exactly that); the
//       ink runs from the baseline up by the string's measured ink ascent (cap height for an
//       all-caps label) and stops AT the baseline — descenders are left out, the usual optical
//       centring, so "Live" and "Heatmaps" in one strip share a baseline. A label with no letter
//       or digit (×, +, −, ›) is a symbol, and uses its real ink on both sides. Sideways, the ink
//       is the text start plus canvas actualBoundingBoxLeft/Right (side bearings), plus letter
//       spacing. Figures count by their box: icons (svg, img) and any smaller descendant with its
//       own fill (an avatar disc — its initial is not the label). The union of all of it is
//       centred; and where an icon sits BESIDE the text, the text alone must also be centred
//       vertically (and sideways where the icon sits above it, as in a tab bar). Absolutely
//       positioned descendants (a notification dot) are decoration, not label, and are measured on
//       their own if they match.
//
// Exits 1 when any control fails, 2 when nothing could be measured (a view that did not open is
// reported and skipped). WebKit, because the app ships in WKWebView.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
const jwt = require('../node_modules/jsonwebtoken');

const args = process.argv.slice(2);
const base = (args.find(a => /^https?:/.test(a)) || process.env.CHECK_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const opt = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : d; };
const W = Number(opt('--width', 402)), H = Number(opt('--height', 874));
const jsonOut = opt('--json', null);
const only = opt('--only', null);
const dump = args.includes('--dump');
const shots = opt('--shots', null);          // a directory: a screenshot of each view as scanned
const overlay = args.includes('--overlay');  // with the grid overlay on (for --shots)
const USER = process.env.CHECK_USERNAME || 'ham5';

function token() {
  if (process.env.CHECK_TOKEN) return process.env.CHECK_TOKEN;
  if (process.env.CHECK_TOKEN_FILE) return fs.readFileSync(process.env.CHECK_TOKEN_FILE, 'utf8').trim();
  const cfg = require('../ecosystem.config.cjs');
  const app = (cfg.apps || cfg).find(a => a.name === 'futuregame-scheduler');
  return jwt.sign({ id: 9, username: USER }, app.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

// What counts as a pill or a button. Leaves, mostly: the group filter below drops anything that
// holds two or more of these.
const CONTROLS = [
  'button', '[role="button"]', '[role="tab"]', 'a.btn', 'input[type="button"]', 'input[type="submit"]',
  '.btn', '.chip', '.filter-chip', '.kind-toggle', '.dk-seg-btn', '.live-update-tab',
  '.badge', '[class*="badge"]', '[class*="-pill"]', '[class*="-chip"]', '.pill', '.tag',
  '.beta-tag', '[class*="beta"]',
];
// Areas left alone entirely: the grid overlay itself, and the replayer's table (another change
// owns it — its dealer button, seats, chips).
const EXCLUDE = ['.grid-dev-overlay', '.replayer-table-slot'];
// Not pills or buttons, though a selector above catches them: event cards and list rows, which
// are clickable but keep their text seated on the baseline grid. Controls INSIDE them are checked.
const NOT_CONTROLS = ['.cal-event-row', '.cal-event-bar', '.cal-event-chevron', '.cal-venue-strip', '.dash-event-card', '.settings-row-btn', '.bk-row'];
// Tiles: a control whose face is a small layout of its own (a name over an amount, a font
// specimen over its name), start-aligned by design. Their box is held to the grid; their text is
// seated like any other block of text, so the centring test does not apply.
const TILES = ['.bk-cell', '.font-pick-tile'];
// Navigation and disclosure rows: icon or chevron beside a label, start-aligned like a list.
// Centred vertically only.
const START_ALIGNED = ['.dk-rail-item', '.cal-fp-head'];
// Not a control even though the class matches: wrappers, rows, lists.
const GROUP_CLASS = /(^|[-_])(row|rows|list|group|wrap|wrapper|strip|bar|container|tabs|area|grid|stack|line|section|panel|menu|header|body|col|cell)$/;

// Runs in the page.
function scan({ CONTROLS, EXCLUDE, NOT_CONTROLS, TILES, START_ALIGNED, GROUP_CLASS_SRC, view }) {
  const GROUP_CLASS = new RegExp(GROUP_CLASS_SRC);
  const PLURAL = /(badges|chips|pills|tags|btns|buttons|toggles|segs)([-_]|$)/;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;width:calc(var(--gu) * 100);height:calc(var(--subrow) * 100)';
  document.body.appendChild(probe);
  const pr = probe.getBoundingClientRect();
  const g = pr.width / 100, r = pr.height / 100;
  probe.remove();
  const bar = document.querySelector('.top-bar');
  const oy = bar ? bar.getBoundingClientRect().top : 0;
  const shell = document.querySelector('.app-shell');
  const ox = shell ? shell.getBoundingClientRect().left : 0;
  const frac = (v) => v - Math.round(v);
  const cv = document.createElement('canvas').getContext('2d');
  const BIG = 200;
  const metricCache = new Map();
  const fontFor = (cs, size) => `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
  const metrics = (cs, text) => {
    const size = parseFloat(cs.fontSize);
    const k = fontFor(cs, size) + '|' + text;
    if (metricCache.has(k)) return metricCache.get(k);
    cv.font = fontFor(cs, size);
    const fontAsc = cv.measureText(text || 'H').fontBoundingBoxAscent;
    cv.font = fontFor(cs, BIG);
    const s = size / BIG;
    const m = cv.measureText(text), cap = cv.measureText('H').actualBoundingBoxAscent * s;
    const out = { fontAsc, cap, asc: m.actualBoundingBoxAscent * s, desc: m.actualBoundingBoxDescent * s,
      left: m.actualBoundingBoxLeft * s, right: m.actualBoundingBoxRight * s };
    metricCache.set(k, out);
    return out;
  };
  const transform = (t, tt) => tt === 'uppercase' ? t.toUpperCase() : tt === 'lowercase' ? t.toLowerCase()
    : tt === 'capitalize' ? t.replace(/\b\p{L}/gu, c => c.toUpperCase()) : t;
  const visible = (el) => {
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const desc = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };

  // Scrolled content is measured where it is LAID OUT, not where the scroll left it: every
  // scroller between a control and the page adds back its scroll offset. Offsets are first set
  // to whole px, so the value read back is the one painted. A stuck sticky element sits at its
  // sticky offset whatever the scroll, so its own scroller is not added back for it; a fixed
  // element ignores every scroller.
  const scrollers = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const sy = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    const sx = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
    if (!sy && !sx) continue;
    if (sy && el.scrollTop % 1) el.scrollTop = Math.round(el.scrollTop);
    if (sx && el.scrollLeft % 1) el.scrollLeft = Math.round(el.scrollLeft);
    scrollers.push(el);
  }
  const isScroller = new Set(scrollers);
  const stuck = (a) => {
    const s = getComputedStyle(a);
    if (s.position !== 'sticky' || s.top === 'auto') return false;
    let sc = a.parentElement;
    while (sc && !isScroller.has(sc)) sc = sc.parentElement;
    if (!sc) return false;
    const want = sc.getBoundingClientRect().top + sc.clientTop + parseFloat(s.top);
    return Math.abs(a.getBoundingClientRect().top - want) < 0.5;
  };
  const layoutOffset = (el) => {
    let dy = 0, dx = 0, skip = false;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      if (a !== el && isScroller.has(a)) {
        if (!skip) { dy += a.scrollTop; dx += a.scrollLeft; }
        skip = false;
      }
      if (getComputedStyle(a).position === 'fixed') break;
      if (stuck(a)) skip = true;
    }
    return { dx, dy };
  };

  const sel = CONTROLS.join(',');
  const excl = EXCLUDE.join(',');
  let cands = [...document.querySelectorAll(sel)].filter(el => {
    if (el.closest(excl) || el.matches(NOT_CONTROLS.join(','))) return false;
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return false;
    if (b.bottom <= 0 || b.top >= innerHeight || b.right <= 0 || b.left >= innerWidth) return false;
    if (!visible(el)) return false;
    // Class-matched (not a <button>) wrappers named like rows and groups are not controls.
    const isNative = el.matches('button, [role="button"], [role="tab"], a.btn, input');
    if (!isNative && typeof el.className === 'string') {
      const toks = el.className.split(/\s+/).filter(Boolean);
      const hit = toks.filter(t => /badge|pill|chip|tag|beta|btn|toggle|seg/.test(t));
      if (hit.length && hit.every(t => GROUP_CLASS.test(t) || PLURAL.test(t))) return false;
    }
    return true;
  });
  const set = new Set(cands);
  // A group holds two or more controls; a control nested in a control of the same kind
  // (a chip's own inner span sharing a class prefix) is measured as the outer one.
  cands = cands.filter(el => {
    let n = 0;
    for (const o of set) if (o !== el && el.contains(o)) n++;
    return n < 2;
  });
  // A control whose face is one inner pill of the same box (a button wrapping its span) is
  // measured once, as the outer element.
  const same = (a, c) => { const p = a.getBoundingClientRect(), q = c.getBoundingClientRect();
    return Math.abs(p.left - q.left) < 0.5 && Math.abs(p.top - q.top) < 0.5 && Math.abs(p.width - q.width) < 0.5 && Math.abs(p.height - q.height) < 0.5; };
  cands = cands.filter(el => !cands.some(o => o !== el && o.contains(el) && same(o, el)));
  const out = [];
  for (const el of cands) {
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const wg = b.width / g, hr = b.height / r;
    const lo = layoutOffset(el);
    // The `translate` property is a paint-time correction some scrollers apply to their items
    // (the Calendar date strip shifts each button by its scroll's whole-px remainder); the layout
    // position is the box without it.
    const tr = (cs.translate && cs.translate !== 'none') ? cs.translate.split(/\s+/).map(parseFloat) : [0, 0];
    const lx = (b.left + lo.dx - (tr[0] || 0) - ox) / g, ty = (b.top + lo.dy - (tr[1] || 0) - oy) / r;
    const geo = {
      w: +wg.toFixed(2), h: +hr.toFixed(2), x: +lx.toFixed(2), y: +ty.toFixed(2),
    };
    const geoFail = [];
    if (Math.abs(frac(wg)) > 0.05) geoFail.push('w');
    if (Math.abs(frac(hr)) > 0.05) geoFail.push('h');
    if (Math.abs(frac(lx)) > 0.05) geoFail.push('x');
    if (Math.abs(frac(ty)) > 0.05) geoFail.push('y');
    // Label ink: text boxes (per line, cap/ascender to baseline) and figures (icons, and any
    // smaller descendant with its own fill — an avatar disc, a colour dot — by its box).
    const textBoxes = [], figBoxes = [];
    const decorative = (n) => {
      for (let a = n.nodeType === 1 ? n : n.parentElement; a && a !== el; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.position === 'absolute' || s.position === 'fixed') return true;
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return true;
      }
      return false;
    };
    const area = b.width * b.height;
    const filled = [...el.querySelectorAll('*')].filter(d => {
      if (d.closest('svg') || decorative(d)) return false;
      const s = getComputedStyle(d);
      const fill = (s.backgroundColor && !/rgba\(.*,\s*0\)$|transparent/.test(s.backgroundColor)) || s.backgroundImage !== 'none';
      if (!fill) return false;
      const q = d.getBoundingClientRect();
      return q.width >= 1 && q.height >= 1 && q.width * q.height < area * 0.6;
    });
    for (const d of filled) { const q = d.getBoundingClientRect(); figBoxes.push([q.left, q.top, q.right, q.bottom]); }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || decorative(n)) continue;
      if (filled.some(d => d.contains(n))) continue; // the disc is the figure, not its initial
      const host = n.parentElement;
      const hs = getComputedStyle(host);
      if (!/^horizontal/.test(hs.writingMode)) continue;
      const text = transform(n.textContent.replace(/\s+/g, ' ').trim(), hs.textTransform);
      texts.push(text);
      const m = metrics(hs, text);
      // The Range spans the text without its leading and trailing white space (a label split
      // into "Create ", a name and " Hand" would otherwise start a space early).
      const raw = n.textContent, s0 = raw.search(/\S/), s1 = raw.length - (raw.match(/\s*$/)[0].length);
      const range = document.createRange();
      range.setStart(n, s0); range.setEnd(n, s1);
      const rects = [...range.getClientRects()].filter(q => q.width > 0 && q.height > 0);
      if (!rects.length) continue;
      const symbol = !/[\p{L}\p{N}]/u.test(text);
      const allCaps = !/\p{Ll}/u.test(text) && /\p{Lu}/u.test(text);
      const ls = parseFloat(hs.letterSpacing) || 0;
      for (const q of rects) {
        const baseline = q.top + m.fontAsc;
        const top = baseline - (allCaps ? m.cap : m.asc);
        const bot = symbol ? baseline + m.desc : baseline;
        let left = q.left, right = q.right;
        if (rects.length === 1) {
          left = q.left - m.left;
          right = q.left + m.right + Math.max(0, [...text].length - 1) * ls;
        }
        // Truncated text paints no further than the control's own box.
        left = Math.max(left, b.left); right = Math.min(right, b.right);
        textBoxes.push([left, top, right, bot]);
      }
    }
    for (const ic of el.querySelectorAll('svg, img, canvas')) {
      if (decorative(ic) || (ic.parentElement && ic.parentElement.closest('svg'))) continue; // nested svg
      if (filled.some(d => d.contains(ic))) continue;
      const q = ic.getBoundingClientRect();
      if (q.width < 1 || q.height < 1) continue;
      figBoxes.push([q.left, q.top, q.right, q.bottom]);
    }
    const union = (bs) => bs.reduce((u, q) => [Math.min(u[0], q[0]), Math.min(u[1], q[1]), Math.max(u[2], q[2]), Math.max(u[3], q[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const cx = (u) => +(((u[0] + u[2]) / 2) - (b.left + b.right) / 2).toFixed(2);
    const cy = (u) => +(((u[1] + u[3]) / 2) - (b.top + b.bottom) / 2).toFixed(2);
    let dx = null, dy = null;
    const all = [...textBoxes, ...figBoxes];
    if (all.length) {
      const u = union(all);
      dx = cx(u); dy = cy(u);
      // Icon BESIDE a label: the label is centred on its own axis too (an icon is not a licence to
      // seat the label low). Icon ABOVE a label (a tab bar): likewise sideways.
      if (textBoxes.length && figBoxes.length) {
        const t = union(textBoxes), f = union(figBoxes);
        const sideBySide = t[0] >= f[2] - 0.5 || t[2] <= f[0] + 0.5;
        const stacked = t[1] >= f[3] - 0.5 || t[3] <= f[1] + 0.5;
        if (sideBySide) { const d = cy(t); if (Math.abs(d) > Math.abs(dy)) dy = d; }
        if (stacked) { const d = cx(t); if (Math.abs(d) > Math.abs(dx)) dx = d; }
      }
    }
    const inkFail = [];
    const tile = el.matches(TILES.join(',')), start = el.matches(START_ALIGNED.join(','));
    if (!tile && !start && dx != null && Math.abs(dx) > 0.75) inkFail.push('dx');
    if (!tile && dy != null && Math.abs(dy) > 0.75) inkFail.push('dy');
    out.push({
      view, el: desc(el), text: texts.join(' ').slice(0, 40), ...geo, dx, dy,
      fail: [...geoFail, ...inkFail],
      ctx: (() => { const p = el.parentElement; return p ? desc(p) : ''; })(),
    });
  }
  return { g: +g.toFixed(3), r: +r.toFixed(3), ox: +ox.toFixed(2), oy: +oy.toFixed(2), controls: out };
}


(async () => {
  const b = await webkit.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3 });
  const t = token();
  await ctx.addInitScript(({ t, u }) => {
    localStorage.setItem('token', t); localStorage.setItem('username', u);
    localStorage.setItem('onboardComplete', '1'); localStorage.setItem('hasOnboarded', 'true');
  }, { t, u: USER });
  const p = await ctx.newPage();
  await p.goto(base + '/' + (overlay ? '?gridOverlay=1' : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  const desktop = await p.evaluate(() => !!document.querySelector('.app-shell.is-desktop'));
  const all = [];
  let grid = null;
  const run = async (view) => {
    await p.waitForTimeout(300);
    const res = await p.evaluate(scan, { CONTROLS, EXCLUDE, NOT_CONTROLS, TILES, START_ALIGNED, GROUP_CLASS_SRC: GROUP_CLASS.source, view });
    grid = grid || res;
    all.push(...res.controls);
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await p.screenshot({ path: `${shots}/${W}x${H}-${view.replace(/[^\w-]+/g, '_')}.png` });
    }
  };
  const scrollMain = async (n) => {
    for (let i = 0; i < n; i++) {
      await p.mouse.move(W / 2, H / 2);
      await p.mouse.wheel(0, H * 0.7);
      await p.waitForTimeout(500);
      await run(lastView + ' (scrolled)');
    }
  };
  let lastView = '';
  const want = (v) => !only || only.split(',').some(o => v.startsWith(o.trim()));
  const nav = async (name) => {
    // Phone: the bottom nav. Desktop: the rail.
    const sel = desktop ? `.dk-rail-item:has-text("${name}")` : `.bottom-nav .nav-tab:has-text("${name}")`;
    // force with the overlay on: its admin readout panel sits over the rail's foot.
    await p.locator(sel).first().click({ timeout: 4000, force: overlay });
    await p.waitForTimeout(1800);
  };
  const menu = async (name, railName) => {
    if (desktop) return nav(railName);
    await p.locator('.username-chip').first().click({ timeout: 4000 });
    await p.waitForTimeout(400);
    await p.getByRole('button', { name, exact: true }).first().click({ timeout: 4000 });
    await p.waitForTimeout(1800);
  };
  // Every view starts from a fresh load, so a panel or menu left open by the last one cannot
  // cover this one.
  const fresh = async () => {
    await p.goto(base + '/' + (overlay ? '?gridOverlay=1' : ''), { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 1000, force: overlay }).catch(() => {});
  };
  const step = async (view, fn, scrolls = 0) => {
    if (!want(view)) return;
    lastView = view;
    try { await fresh(); await fn(); await run(view); await scrollMain(scrolls); }
    catch (e) { console.log(`  (view ${view} skipped: ${e.message.split('\n')[0]})`); }
  };

  await step('schedule', () => nav('Schedule'), 2);
  await step('filters', async () => {
    await nav('Schedule');
    await p.locator('.filter-chip-square').first().click({ timeout: 4000 });
    await p.waitForTimeout(800);
  }, 0);
  await step('card', async () => {
    await nav('Schedule');
    await p.locator('.cal-event-row:not(.open) .cal-event-bar').first().click({ timeout: 4000 });
    await p.waitForTimeout(900);
  }, 1);
  await step('myschedule', () => desktop ? nav('Schedule') : menu('My Schedule', 'Schedule'), 1);
  await step('dashboard', () => nav('Dashboard'), 1);
  await step('social', () => nav('Social'), 1);
  await step('results', () => menu('Results & Tracking', 'Results'), 1);
  await step('settings', () => menu('Settings', 'Settings'), 2);
  await step('cash-live', () => nav('Cash'), 1);
  await step('cash-heatmaps', async () => {
    await nav('Cash');
    await p.locator('.cash-mode-tabs button:has-text("Heatmaps")').first().click({ timeout: 4000 });
    await p.waitForTimeout(1500);
  }, 1);
  await step('hands', () => nav('Hands'), 1);
  // Beyond the core list: the Calendar view (month and date buttons) with its filter sheet, and
  // the bankroll sheet behind Results' Manage.
  await step('calendar', async () => {
    await nav('Schedule');
    await p.locator('.filter-chip-square[title="Calendar view"]').first().click({ timeout: 4000 });
    await p.waitForTimeout(1500);
  }, 1);
  await step('calendar-filters', async () => {
    await nav('Schedule');
    await p.locator('.filter-chip-square[title="Calendar view"]').first().click({ timeout: 4000 });
    await p.waitForTimeout(1500);
    await p.locator('.filter-chip-square:not([title])').last().click({ timeout: 4000 });
    await p.waitForTimeout(800);
  }, 0);
  await step('bankrolls', async () => {
    await menu('Results & Tracking', 'Results');
    await p.locator('.bk-head-btn').first().click({ timeout: 4000 });
    await p.waitForTimeout(800);
  }, 0);
  // The bankroll dashboard (the bankroll strip's Dashboard button): each of its four tabs, and
  // the CSV import step with a file mapped.
  const dash = async (tab) => {
    await menu('Results & Tracking', 'Results');
    await p.locator('.bk-head-btn:has-text("Dashboard")').first().click({ timeout: 4000 });
    await p.waitForTimeout(1500);
    if (tab) await p.locator(`.an-sheet .bk-seg-btn:has-text("${tab}")`).first().click({ timeout: 4000 });
    await p.waitForTimeout(600);
  };
  await step('bankroll-dashboard', () => dash(null), 2);
  await step('bankroll-rules', () => dash('Rules'), 2);
  await step('bankroll-goals', () => dash('Goals'), 1);
  await step('bankroll-import', async () => {
    await dash('Import');
    await p.locator('.an-sheet button:has-text("Import CSV")').click({ timeout: 4000 });
    await p.locator('.an-sheet input[type=file]').setInputFiles({
      name: 'check.csv', mimeType: 'text/csv',
      buffer: Buffer.from(['Date,Event,Buy-in,Winnings', '2024-03-02,Check Event,215,0', '2024-03-09,Check Event,215,900', ''].join('\n')),
    });
    await p.waitForTimeout(500);
  }, 2);

  // One row per distinct control (same element description + label), worst case kept.
  const key = (c) => c.view.split(' (')[0] + '|' + c.el + '|' + c.text;
  const byKey = new Map();
  for (const c of all) {
    const k = key(c);
    const prev = byKey.get(k);
    if (!prev || c.fail.length > prev.fail.length) byKey.set(k, c);
  }
  const rows = [...byKey.values()];
  const failing = rows.filter(c => c.fail.length);
  const views = [...new Set(rows.map(c => c.view.split(' (')[0]))];
  console.log(`controls at ${W}x${H}${desktop ? ' (desktop)' : ''}: g=${grid && grid.g}px r=${grid && grid.r}px origin x=${grid && grid.ox} y=${grid && grid.oy}`);
  for (const v of views) {
    const vr = rows.filter(c => c.view.split(' (')[0] === v), vf = vr.filter(c => c.fail.length);
    console.log(`  ${v}: ${vr.length} controls, ${vf.length} failing`);
  }
  const show = dump ? rows : failing;
  for (const c of show) {
    console.log(`  [${c.view.split(' (')[0]}] ${c.fail.length ? 'FAIL ' + c.fail.join(',') : 'ok'}  ${c.el} "${c.text}"  ${c.w}g x ${c.h}r @ x${c.x}g y${c.y}r  ink dx ${c.dx} dy ${c.dy}  in ${c.ctx}`);
  }
  const distinct = new Set(failing.map(c => c.el + '|' + c.text)).size;
  if (!rows.length) {
    console.log(`NO CONTROLS MEASURED at ${W}x${H} — the views did not open (is the server up, the token an admin's?)`);
    await b.close();
    process.exit(2);
  }
  console.log(failing.length ? `CONTROLS OFF GRID OR OFF CENTRE at ${W}x${H}: ${failing.length} of ${rows.length} (by view; ${distinct} distinct)` : `all ${rows.length} controls on the grid and centred at ${W}x${H}`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ width: W, height: H, desktop, grid, rows }, null, 1));
  await b.close();
  process.exit(failing.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
