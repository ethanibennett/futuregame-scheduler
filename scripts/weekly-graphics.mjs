// "This week near you": Instagram graphics for one week's tournaments in a region, built from the
// live schedule with the app's own venue names, strip colours, coordinates and fonts.
//
//   node scripts/weekly-graphics.mjs [--week 2026-10-12] [--regions northeast,lasvegas,...]
//                                    [--out weekly-graphics] [--base http://localhost:3001]
//
// Per region: a 5-slide carousel at 1080x1350 (cover, headliners, two day-by-day slides, CTA) and a
// 1080x1920 Story. --week is the Monday the week starts on (default: the coming Monday, or today
// when today is Monday). Regions are the app's own location presets (LOCATION_REGIONS in
// vite-app/src/utils/utils.js), so "Northeast US" here means what it means in the app's filter.
//
// What counts: live events only (no online), no satellites, no restart days (Day 2+, final tables),
// no $0 rows. A multi-flight event is ONE event (its flights are counted, its guarantee once).
// Headliners rank by guarantee, then buy-in. Reads the schedule over the API (a signed admin token
// for the local server, or CHECK_TOKEN), never the database file.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { webkit } = require(path.join(ROOT, 'vite-app/node_modules/playwright'));

// The app's utils touch localStorage/window at import; give them inert stand-ins.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = globalThis;
const U = await import(pathToFileURL(path.join(ROOT, 'vite-app/src/utils/utils.js')).href);

const args = process.argv.slice(2);
const opt = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--base', 'http://localhost:3001').replace(/\/$/, '');
const OUT = path.resolve(ROOT, opt('--out', 'weekly-graphics'));
const REGIONS = opt('--regions', Object.keys(U.LOCATION_REGIONS).join(',')).split(',').filter(Boolean);

function nextMonday(from = new Date()) {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  d.setUTCDate(d.getUTCDate() + (dow === 1 ? 0 : (8 - dow) % 7));
  return d.toISOString().slice(0, 10);
}
const WEEK = opt('--week', nextMonday());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const DAYS = Array.from({ length: 7 }, (_, i) => addDays(WEEK, i));

function token() {
  if (process.env.CHECK_TOKEN) return process.env.CHECK_TOKEN;
  const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'));
  const cfg = require(path.join(ROOT, 'ecosystem.config.cjs'));
  const app = (cfg.apps || cfg).find(a => a.name === 'futuregame-scheduler');
  return jwt.sign({ id: 9, username: 'ham5' }, app.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '10m' });
}

// ── formatting ──
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const md = (iso) => { const [, m, d] = iso.split('-').map(Number); return { m: MONTHS[m - 1], d }; };
const weekLabel = () => {
  const a = md(DAYS[0]), b = md(DAYS[6]);
  return a.m === b.m ? `${a.m} ${a.d} – ${b.d}` : `${a.m} ${a.d} – ${b.m} ${b.d}`;
};
const weekday = (iso) => WEEKDAYS[new Date(iso + 'T12:00:00Z').getUTCDay()];
function money(n) {
  if (!n) return '';
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (n >= 1e4) return `$${Math.round(n / 1e3)}K`;
  return '$' + Math.round(n).toLocaleString('en-US');
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseName = (name) => String(name || '')
  .replace(/\s*[-–]\s*(Day\s*1[A-Z]*|Flight\s*[A-Z0-9]+)\b.*$/i, '')
  .replace(/\s+(Day\s*1[A-Z]*|Flight\s*[A-Z0-9]+)$/i, '')
  .trim();
const isRestart = (t) => t.is_restart || /\b(Day\s*[2-9]|Final\s+Table)\b/i.test(t.event_name || '');
const mins = (t) => { const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(t || ''); if (!m) return 24 * 60; let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12; return h * 60 + +m[2]; };
const guarantee = (t) => Number(t.prize_pool) || (() => { const m = /\$([\d,]+)\s*Guarantee/i.exec(t.notes || ''); return m ? Number(m[1].replace(/,/g, '')) : 0; })();

// ── data ──
const H = { Authorization: 'Bearer ' + token() };
const [vc, tr] = await Promise.all([
  fetch(BASE + '/api/venue-coords', { headers: H }).then(r => r.json()),
  fetch(BASE + '/api/tournaments', { headers: H }).then(r => r.json()),
]);
if (U.registerVenueCoords) U.registerVenueCoords(vc.venues || vc);
const all = (Array.isArray(tr) ? tr : tr.tournaments || []).map(t => ({ ...t, iso: U.normaliseDate(t.date) }));
// Rows carry their room's zone; without registering them the app's lookup falls back to Pacific.
if (U.registerRowTimezones) U.registerRowTimezones(all);
const MIN_EVENTS = Number(opt('--min', 5));
const inWeek = all.filter(t => t.iso && t.iso >= DAYS[0] && t.iso <= DAYS[6]
  && !t.is_online && !t.is_satellite && !isRestart(t) && Number(t.buyin) > 0 && t.venue !== 'Personal');

function regionRows(key) {
  const reg = U.LOCATION_REGIONS[key];
  return inWeek.filter(t => { const c = U.getVenueCoords(t.venue); return c && reg.test(c); });
}

function build(key) {
  const rows = regionRows(key);
  // One event per (venue, base name): flights folded, guarantee counted once. An event whose Day 1
  // flights run at several rooms (Lions of the East: Borgata and MGM National Harbor) shares a name
  // AND a guarantee across them, so a guaranteed event is keyed by name + guarantee instead.
  const events = new Map();
  for (const t of rows) {
    const g = guarantee(t);
    const k = g ? `${baseName(t.event_name)}|$${g}` : t.venue + '|' + baseName(t.event_name);
    const e = events.get(k) || { venue: t.venue, property: t.property, name: baseName(t.event_name), flights: [], buyin: 0, gtd: 0 };
    e.flights.push(t);
    e.buyin = Math.max(e.buyin, Number(t.buyin) || 0);
    e.gtd = Math.max(e.gtd, guarantee(t));
    events.set(k, e);
  }
  const list = [...events.values()].map(e => {
    e.flights.sort((a, b) => a.iso.localeCompare(b.iso) || mins(a.time) - mins(b.time));
    e.first = e.flights[0];
    // The room holding most of its flights is its strip; every room is named on the card.
    const byRoom = new Map();
    for (const f of e.flights) { const info = U.getVenueInfo(f.venue, f.property); const r = byRoom.get(info.abbr) || { info, n: 0 }; r.n++; byRoom.set(info.abbr, r); }
    const roomsRanked = [...byRoom.values()].sort((a, b) => b.n - a.n);
    e.info = roomsRanked[0].info;
    e.roomNames = roomsRanked.map(r => r.info.longName || r.info.abbr);
    return e;
  });
  const rooms = new Map();
  for (const t of rows) { const info = U.getVenueInfo(t.venue, t.property); rooms.set(info.abbr, info); }
  const headliners = [...list].sort((a, b) => b.gtd - a.gtd || b.buyin - a.buyin).slice(0, 6);
  const byDay = DAYS.map(iso => {
    const day = rows.filter(t => t.iso === iso);
    const seen = new Set(); const picks = [];
    for (const t of [...day].sort((a, b) => guarantee(b) - guarantee(a) || b.buyin - a.buyin)) {
      const k = t.venue + '|' + baseName(t.event_name);
      if (seen.has(k)) continue; seen.add(k); picks.push(t);
    }
    return { iso, top: picks.slice(0, 3).sort((a, b) => mins(a.time) - mins(b.time)), more: Math.max(0, picks.length - 3) };
  });
  return {
    key, label: U.LOCATION_REGIONS[key].label, events: list, rooms: [...rooms.values()], headliners, byDay,
    totalGtd: list.reduce((s, e) => s + e.gtd, 0),
  };
}

// ── rendering ──
const FONTS = pathToFileURL(path.join(ROOT, 'vite-app/public/fonts')).href;
const css = `
@font-face{font-family:'LB';src:url('${FONTS}/librebaskerville.woff2') format('woff2')}
@font-face{font-family:'LB';font-style:italic;src:url('${FONTS}/librebaskerville-italic.woff2') format('woff2')}
@font-face{font-family:'UC';font-weight:400;src:url('${FONTS}/univers-regular-condensed.woff2') format('woff2')}
@font-face{font-family:'UC';font-weight:700;src:url('${FONTS}/univers-bold-condensed.woff2') format('woff2')}
@font-face{font-family:'U';font-weight:400;src:url('${FONTS}/univers-regular.woff2') format('woff2')}
@font-face{font-family:'U';font-weight:700;src:url('${FONTS}/univers-bold.woff2') format('woff2')}
*{box-sizing:border-box}
html,body{margin:0;background:#111;color:#e8e8e8;font-family:'U',sans-serif}
.slide{position:relative;overflow:hidden;background:#111;display:flex;flex-direction:column}
.eyebrow{font-family:'UC';font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#3cc8e0}
.serif{font-family:'LB',Georgia,serif;font-weight:400}
.cond{font-family:'UC'}
.foot{display:flex;justify-content:space-between;align-items:center;font-family:'UC';color:#8a8a8a;letter-spacing:.06em}
.mark{font-family:'LB';color:#e8e8e8;letter-spacing:0}
.strip{display:flex;align-items:center;justify-content:center}
.strip span{writing-mode:vertical-rl;transform:rotate(180deg);font-family:'UC';font-weight:700;color:#fff;letter-spacing:.08em;white-space:nowrap}
.card{display:flex;border-radius:22px;overflow:hidden;background:#1a1a1a;box-shadow:inset 0 0 0 2px #2a2a2a}
.muted{color:#8a8a8a}
`;
function stripTextColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff';
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#111' : '#fff';
}
// The strip's label is the app's display abbreviation, sized so the whole word fits the strip's
// length (Univers Bold Condensed caps with .08em tracking run ~0.66em a character).
const stripLabel = (info) => (U.STRIP_ABBR && U.STRIP_ABBR[info.abbr]) || info.abbr;
const strip = (info, w, h, fs) => {
  const label = stripLabel(info);
  const fit = Math.min(fs, (h * 0.86) / Math.max(1, label.length * 0.66));
  return `<div class="strip" style="width:${w}px;height:${h}px;background:${esc(info.color)}"><span style="font-size:${fit.toFixed(1)}px;color:${stripTextColor(info.color)}">${esc(label)}</span></div>`;
};

function eventCard(e, scale = 1) {
  const t = e.first, d = md(t.iso);
  const tz = U.getVenueTzAbbr(t.venue, t.iso) || '';
  const flights = e.flights.length > 1 ? `${e.flights.length} flights · ` : '';
  return `<div class="card" style="height:${150 * scale}px">
    ${strip(e.info, 58 * scale, 150 * scale, 22 * scale)}
    <div style="flex:1;padding:${20 * scale}px ${26 * scale}px;display:flex;flex-direction:column;justify-content:space-between;min-width:0">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-family:'UC';font-size:${26 * scale}px" class="muted">
        <span>${esc(weekday(t.iso).slice(0, 3))} ${d.m} ${d.d} · ${esc(t.time || '')} ${esc(tz)}</span>
        <span class="serif" style="font-size:${30 * scale}px;color:#cfcfcf">${money(e.buyin)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:${16 * scale}px">
        <span class="serif" style="font-size:${34 * scale}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.name)}</span>
        <span class="cond" style="font-size:${24 * scale}px;color:#3cc8e0;white-space:nowrap">${e.gtd ? money(e.gtd) + ' GTD' : ''}</span>
      </div>
      <div class="cond muted" style="font-size:${22 * scale}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(flights)}${esc(e.roomNames.join(' + '))}</div>
    </div>
  </div>`;
}

const footer = (pad) => `<div class="foot" style="padding:0 ${pad}px ${pad - 8}px;font-size:26px"><span class="mark" style="font-size:34px">futurega.me</span><span>${esc(weekLabel())}</span></div>`;

function cover(R, W, H) {
  const strips = R.rooms.slice(0, 12);
  return `<div class="slide" style="width:${W}px;height:${H}px">
    <div style="padding:96px 84px 0;display:flex;flex-direction:column;gap:22px">
      <div class="eyebrow" style="font-size:34px">This week near you</div>
      <div class="serif" style="font-size:${R.label.length > 10 ? 118 : 140}px;line-height:1.02">${esc(R.label)}</div>
      <div class="cond" style="font-size:52px;color:#cfcfcf">${esc(weekLabel())}</div>
    </div>
    <div style="display:flex;gap:56px;padding:64px 84px 0">
      <div><div class="serif" style="font-size:96px;line-height:1">${R.rooms.length}</div><div class="cond muted" style="font-size:28px;letter-spacing:.08em;margin-top:10px">${R.rooms.length === 1 ? 'ROOM' : 'ROOMS'}</div></div>
      <div><div class="serif" style="font-size:96px;line-height:1">${R.events.length}</div><div class="cond muted" style="font-size:28px;letter-spacing:.08em;margin-top:10px">${R.events.length === 1 ? 'TOURNAMENT' : 'TOURNAMENTS'}</div></div>
      ${R.totalGtd ? `<div><div class="serif" style="font-size:96px;line-height:1;color:#3cc8e0">${money(R.totalGtd)}</div><div class="cond muted" style="font-size:28px;letter-spacing:.08em;margin-top:10px">GUARANTEED</div></div>` : ''}
    </div>
    <div style="flex:1;display:flex;align-items:flex-end;gap:14px;padding:0 84px 56px;overflow:hidden">
      ${strips.map((info, i) => strip(info, 62, 240 + (i % 3) * 60, 24)).join('')}
    </div>
    ${footer(84)}
  </div>`;
}

function headliners(R, W, H, n = 6, title = 'Headliners') {
  return `<div class="slide" style="width:${W}px;height:${H}px">
    <div style="padding:84px 72px 36px;display:flex;justify-content:space-between;align-items:baseline">
      <div class="serif" style="font-size:72px">${esc(title)}</div>
      <div class="eyebrow" style="font-size:28px">${esc(R.label)}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:20px;padding:0 72px">
      ${R.headliners.slice(0, n).map(e => eventCard(e)).join('')}
    </div>
    <div style="flex:1"></div>
    ${footer(72)}
  </div>`;
}

function days(R, W, H, from, to) {
  const block = (d) => {
    const { m, d: dd } = md(d.iso);
    const rows = d.top.length ? d.top.map(t => {
      const info = U.getVenueInfo(t.venue, t.property);
      return `<div style="display:flex;align-items:center;gap:18px;height:58px">
        <span class="cond muted" style="width:150px;font-size:28px">${esc(t.time || '')}</span>
        <span class="cond" style="flex:0 0 auto;height:40px;border-radius:20px;padding:0 16px;display:flex;align-items:center;background:${esc(info.color)};color:${stripTextColor(info.color)};font-weight:700;font-size:22px;letter-spacing:.06em">${esc(info.abbr)}</span>
        <span class="serif" style="flex:1;min-width:0;font-size:30px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(baseName(t.event_name))}</span>
        <span class="serif" style="font-size:28px;color:#cfcfcf">${money(t.buyin)}</span>
      </div>`;
    }).join('') : `<div class="cond muted" style="height:58px;display:flex;align-items:center;font-size:28px">Nothing scheduled</div>`;
    return `<div style="display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #2a2a2a;padding-bottom:10px;margin-bottom:6px">
        <span class="serif" style="font-size:44px">${esc(weekday(d.iso))} <span class="muted" style="font-size:34px">${m} ${dd}</span></span>
        ${d.more ? `<span class="cond" style="font-size:24px;color:#3cc8e0">+${d.more} more in the app</span>` : ''}
      </div>
      ${rows}
    </div>`;
  };
  return `<div class="slide" style="width:${W}px;height:${H}px">
    <div style="padding:84px 72px 30px;display:flex;justify-content:space-between;align-items:baseline">
      <div class="serif" style="font-size:64px">Day by day</div>
      <div class="eyebrow" style="font-size:28px">${esc(R.label)}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:30px;padding:0 72px">${R.byDay.slice(from, to).map(block).join('')}</div>
    <div style="flex:1"></div>
    ${footer(72)}
  </div>`;
}

function cta(R, W, H) {
  return `<div class="slide" style="width:${W}px;height:${H}px;align-items:center;justify-content:center;text-align:center;gap:40px;padding:0 90px">
    <div class="serif" style="font-size:110px">futurega.me</div>
    <div style="width:110px;height:5px;background:#3cc8e0"></div>
    <div class="cond" style="font-weight:700;font-size:64px;line-height:1.05;text-transform:uppercase">Every event this week.<br><span style="color:#3cc8e0">Live clocks. Late reg. Your schedule.</span></div>
    <div class="cond muted" style="font-size:34px">Link in bio · [APP STORE LINK]</div>
  </div>`;
}

function story(R, W, H) {
  return `<div class="slide" style="width:${W}px;height:${H}px">
    <div style="padding:150px 80px 0;display:flex;flex-direction:column;gap:18px">
      <div class="eyebrow" style="font-size:34px">This week near you</div>
      <div class="serif" style="font-size:${R.label.length > 10 ? 104 : 124}px;line-height:1.02">${esc(R.label)}</div>
      <div class="cond" style="font-size:48px;color:#cfcfcf">${esc(weekLabel())} · ${R.events.length} tournaments${R.totalGtd ? ' · ' + money(R.totalGtd) + ' GTD' : ''}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:22px;padding:70px 64px 0">${R.headliners.slice(0, 5).map(e => eventCard(e)).join('')}</div>
    <div style="flex:1"></div>
    <div style="padding:0 80px 210px;display:flex;justify-content:space-between;align-items:center">
      <span class="mark" style="font-size:44px">futurega.me</span>
      <span class="cond" style="font-size:32px;color:#3cc8e0">Full schedule in the app</span>
    </div>
  </div>`;
}

// ── run ──
const browser = await webkit.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const tmpHtml = path.join(OUT, '.render.html');
fs.mkdirSync(OUT, { recursive: true });
async function shoot(html, W, H, file) {
  await page.setViewportSize({ width: W, height: H });
  fs.writeFileSync(tmpHtml, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`);
  await page.goto(pathToFileURL(tmpHtml).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
}
const made = [];
for (const key of REGIONS) {
  if (!U.LOCATION_REGIONS[key]) { console.log(`unknown region ${key}; known: ${Object.keys(U.LOCATION_REGIONS).join(', ')}`); continue; }
  const R = build(key);
  if (R.events.length < MIN_EVENTS) { console.log(`${R.label} ${weekLabel()}: ${R.events.length} tournament(s), under --min ${MIN_EVENTS}, skipped`); continue; }
  const dir = path.join(OUT, WEEK, key);
  fs.mkdirSync(dir, { recursive: true });
  const slides = [
    ['1-cover', cover(R, 1080, 1350)],
    ['2-headliners', headliners(R, 1080, 1350)],
    ['3-mon-thu', days(R, 1080, 1350, 0, 4)],
    ['4-fri-sun', days(R, 1080, 1350, 4, 7)],
    ['5-cta', cta(R, 1080, 1350)],
  ];
  for (const [name, html] of slides) { const f = path.join(dir, `${name}.png`); await shoot(html, 1080, 1350, f); made.push(f); }
  const sf = path.join(dir, 'story.png'); await shoot(story(R, 1080, 1920), 1080, 1920, sf); made.push(sf);
  console.log(`${R.label} ${weekLabel()}: ${R.events.length} tournaments, ${R.rooms.length} rooms, ${money(R.totalGtd) || 'no'} GTD -> ${path.relative(ROOT, dir)}`);
}
fs.rmSync(tmpHtml, { force: true });
await browser.close();
if (!made.length) process.exit(1);
