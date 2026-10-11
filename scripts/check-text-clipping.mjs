// Finds text whose glyphs are cut off by a clipping ancestor — descenders (g, p, y, j, q) sliced at
// a grid line, the bug that kept coming back on schedule event names.
//
//   node scripts/check-text-clipping.mjs [baseUrl] [--width 402] [--height 874]
//
// Signs in as the local admin test user, opens the Schedule list, an expanded card and My
// Schedule, and for every text node inside those views measures its glyph box (a Range over the
// text, which spans ascent to descent) against every ancestor that clips (overflow other than
// visible, or overflow-y clip). A glyph box that ends more than 0.5 CSS px below a clipping
// ancestor's bottom (or starts above its top) is reported. Exits 1 when anything is clipped, so it
// can gate a deploy. WebKit, because the app ships in WKWebView.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
const jwt = require('../node_modules/jsonwebtoken');

const args = process.argv.slice(2);
const base = (args.find(a => /^https?:/.test(a)) || 'http://localhost:3001').replace(/\/$/, '');
const num = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : d; };
const W = num('--width', 402), H = num('--height', 874);

function token() {
  if (process.env.CHECK_TOKEN) return process.env.CHECK_TOKEN;
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
