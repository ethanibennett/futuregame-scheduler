// Pills and buttons (owner rule, 2026-10-10): the CONTAINER sits on the grid — whole g wide, whole
// r tall, left edge on a g line, top edge on an r line — and the LABEL inside is centred in it on
// both axes, disregarding the grid. Venue strips (owner, 2026-10-11): the coloured venue band on an
// event card — the Schedule row's vertical strip with its rotated name, the Up Next card's banner —
// has its text centred both ways too. This measures all of it, for every visible control and strip,
// in WebKit.
//
//   node scripts/check-control-centring.mjs [baseUrl] [--width 402] [--height 874]
//        [--json out.json] [--only "schedule,cash"] [--skip "replayer"] [--dump] [--list]
//        [--shots dir [--overlay]] [--verify-ink] [--quiet]
//   (--dump lists passing controls too; --list prints the views and exits; --shots saves a
//   screenshot of each view as scanned, --overlay with the grid overlay on; --verify-ink measures
//   every text label a second time from pixels and reports where the two disagree)
//   npm run check:controls          (both sizes; base URL from CHECK_BASE_URL, else :3001)
//
//   CHECK_BASE_URL  the server to check, when no baseUrl argument is given
//   CHECK_TOKEN     a JWT for an admin account on that server (default: one signed with the pm2
//                   app's JWT_SECRET from ecosystem.config.cjs, for http://localhost:3001)
//   CHECK_TOKEN_FILE  or a file holding one
//   CHECK_USERNAME  that account's username (default ham5)
//   CHECK_FRESH_USER / CHECK_FRESH_PASSWORD  optional: the EMAIL and password of an account with
//                   no real name, signed in through the login screen to reach the real-name prompt
//                   (it only shows after a password login) and the first-run wizard after it.
//                   Without them that view is reported as not reachable.
//
// VIEWS. Every view and state that has controls, phone and desktop, each from a fresh load (a menu
// left open by one cannot cover the next): the Schedule list, filter sheet, location dropdown, an
// open card (saved, conditional), Calendar and a day in it, My Schedule (an expanded card, the
// "if I bag / bust" panel, export, travel), the Dashboard (scrolled to its foot, on desktop both its
// panes; every Up Next card in the real carousel — the cash session, playing, bagged, finished, not
// started — paged to in turn with the track's fit to the card on show, a page turn to a taller card
// with the mouse left on the pager (dashboard-held), and the D toggle's demo cards; the playing
// card's Bust menu, its Update and Bag panels and its Scan sheet; the cash card's stack entry; the
// Log menu; a To log row's Undo state; its NUMBERS in trip mode, series mode and the edge state;
// the signal-or-noise line as progress and about cash; the empty-schedule prompt; the Edit home sheet as opened and after Reset, the home in a custom layout, and on desktop its empty NUMBERS pane), Social (search,
// a buddy, a group, a new group), Hands (each game family, hand entry step by step, PLO entry,
// Quick add, the Export for PokerTracker sheet, the replayer on a saved hand with its settings,
// table settings and share menu, the
// admin's Solver / Solver Trainer / Watch Solver / Trainer / 3-Way / Scanner tools), Cash (Live,
// Heatmaps, the location picker), Results (the log form, a row in edit, the tax report, the share
// menu and the series wrap-up, the analytics sheet and its tabs, the Delete results block at the
// foot, closed and open), the Backers block of the Notify tap under a result's edit form and on a
// cash session's page and edit screen (previewed, sent, the warning's confirm, none staked;
// notify-states.mjs stages all but the first and never lets a tap through), the
// floating + on the bankroll pages (the Results tab's and the dashboard sheet's, closed and with its
// menu open, with and without a running cash session), the
// bankroll sheet and dashboard (every tab — the strip scrolls sideways once the tabs outgrow it,
// with its page chevrons — report filters, Locations with a card open, its pager (Show 50 more /
// Show all, Show fewer) and a sort on, Backers (the list, every card open on its last ten shares,
// none yet, refused), the Sessions list filtered and a tournament's and a cash
// session's detail, CSV import), cash sessions, expenses and
// trips, Settings (without and with a share link, and its delete confirmation), the user menu,
// notifications, the live-update panel's tabs, Admin, New Events, Staking (no route in the UI:
// reached through a component's onNavigate prop) and its Summary / Backers / Series / settings and a
// series' Settlement, open and settled (series named "Guard Open" / "Guard Settled"), a
// buddy chip's swap sheet, the venue map a Schedule strip and an Up Next banner open, the public
// shared-schedule page (and a card open on it), the backer
// page (a full history, no sessions, one session; CHECK_BACKER_TOKENS), first-run setup
// stage by stage (step 1 refused, located and searching; step 2 with Yes; step 3; the places a
// region, Europe and Everywhere answer and the zero-count line: onboarding-places; a new account's
// own first run, which starts at "No, live only": real-name-prompt), Settings' "Edit name" dialog,
// the signed-out login / register / forgot / password-reset screens, and the
// real-name prompt. A view that does not open is listed as not reached, with why. A dialog's
// backdrop hides what is under it: a control 90% covered by something that paints is not measured.
//
// WHAT IS A CONTROL. Three ways in, then the exclusions and one de-duplication:
//   1. a selector in CONTROLS (buttons, roles, and the -pill/-chip/-badge/-btn class families);
//   2. an interactive element (INTERACTIVE: a[href], the button-like ARIA roles, summary,
//      [tabindex="0"], a <label> that wraps or names a hidden <select>/<input> and draws the face
//      for it, a visible <select>) that has a VISIBLE BOX — background, border, a box-shadow ring or
//      an outline. Without one there is no container to be centred in (an inline text link). A
//      boxless <label> over a hidden input whose one boxed descendant draws the face (a toggle
//      switch's track) has that descendant measured, as a switch inside a switch class;
//   3. any element whose own rule sets cursor:pointer (its parent's cursor is not pointer), that
//      holds a label (text or an icon) and has a visible box — a clickable <div>. Where the
//      pointer element draws no box but one descendant holding the whole label does, that
//      descendant is the face and is measured instead.
//   Then: an element holding two or more controls is a group, not a control; a control whose box
//   is one inner element's box is measured once, as the outer; a boxless control around a single
//   control is measured as that inner face, and a boxless one inside a boxed control (a filter
//   pill's clear "✕") is part of that face; a class-matched PART of a control (.buddy-chip-name)
//   is its label, not a second control; a TEXT LINK (no box, no icon, named a link or set inside
//   a run of text: "No account? Register") is text seated with its sentence. NOT_CONTROLS (rows,
//   cards and table cells that are clickable but seat their text), TILES, EXCLUDE and the venue
//   strips are taken out of the control set. A control with no visible box of its own or on a
//   face inside it is still measured (the rule holds its tap target to the grid) and is marked
//   "(boxless)" in the report.
//
// KINDS and what each is held to:
//   control  box on the grid (a), label centred both ways (b)
//   start    START_ALIGNED: box on the grid, label centred vertically only (a nav row)
//   field    a visible native <select>: box on the grid, value centred vertically only (it is a
//            form field — start-aligned beside its arrow)
//   switch   role=switch / a knob toggle: box on the grid, knob centred vertically
//   start    also, found from the layout: a ROW — a menu or pick-list item whose label is set at
//            the start by design (nothing from the label up to the control centres it, and the
//            gap after the label is over 1g wider than the gap before it), or a label and a
//            trailing item spread apart (space-between, an auto margin: over 2g of empty run
//            between the parts of the face)
//   tile     TILES: box on the grid only; also, found from the face: two text blocks stacked (a
//            title over a description) or a large figure stacked with text (an avatar over a
//            name, a theme preview over its name) — a small layout, not a label. A symbol set as
//            text over a label ("✕" over "FOLD") is an icon, not a block: that face is a label
//   strip    STRIPS (venue bands): text centred both ways, along and across the band; the band
//            is the card's edge, so its box is reported, not held to the grid. The band is the
//            colour the eye sees: where a neighbour paints on in the strip's colour (a saved
//            card's venue-colour inset ring on .cal-event-row-content), it is the strip plus that
//            run, found by walking outward across the strip with elementsFromPoint
//   layer    an opaque fixed sheet / panel / dropdown whose controls were measured on its own
//            lines (see (a)): its left edge on a g line and its width whole g, nothing else
//
// (a) the border box against the grid: width / g and height / r within 0.05 of a whole number,
//     left edge within 0.05 g of a g line (lines run from the .app-shell's left edge: x = 0 on a
//     phone, the shell's centred left on desktop; inside a LAYER — an opaque fixed sheet, panel,
//     dropdown or the replayer — from that layer's left, the layer itself held to the shell's
//     lines once; a layer at the window's left edge is the window's canvas) and top edge within
//     0.05 r of an r line counted from the .top-bar's top — the origin GridOverlay draws its
//     baseline ruler from. Scrolled content is measured as laid out: each scroller's offset is
//     added back (not across a stuck sticky or a fixed element).
// (b) the label's INK centre against the box centre, in CSS px, both axes; fails past 0.75px.
//     Ink is not the text box. Per line, the baseline sits the font's ascent (canvas
//     fontBoundingBoxAscent) in from the text box's OVER edge; the ink runs from the baseline out
//     by the string's measured ink ascent (cap height for an all-caps label) and stops AT the
//     baseline — descenders are left out, the usual optical centring. A label with no letter or
//     digit (×, +, ←, ›) is a symbol: its painted ink on both axes (canvas may draw it in another
//     fallback font than the page). An emoji is a picture, not a letter: a figure with its whole
//     glyph. Along the line the ink is the PAINTED ink (canvas side bearings miss tabular figures, a
//     fallback font's ▾, kerning); where pixels cannot see it (an occluded control), the text
//     start plus the string's side bearings as painted on a canvas (WebKit clamps measureText's
//     actualBoundingBoxLeft/Right to the advance) plus letter spacing.
//     WRITING MODE AND TRANSFORMS: the over edge and the line direction are taken through the
//     element's writing mode (vertical-rl / -lr turn Latin glyphs so their tops face the line's
//     right) and every ancestor's transform (a strip's rotate(180deg) turns them to face left), so
//     the rotated name on a Schedule strip gets cap height ACROSS the strip and its advance ALONG
//     it. Figures count by their box: icons (svg, img) and any smaller descendant with its own fill
//     (an avatar disc). The union is centred; where an icon sits BESIDE the text the text alone
//     must also be centred vertically (and sideways where the icon sits above it, as in a tab bar).
//     Absolutely positioned descendants (a notification dot) are decoration, not label.
//     Labels the DOM does not hold as text — a native <select>'s value, an <input type=button>'s,
//     a ::before/::after `content` — are measured from PIXELS: the control is captured, its text
//     colour made transparent (borders, rings and fills frozen first), captured again, and the
//     difference is the ink; descenders are dropped by the same convention (ink ascent from the
//     top of the ink). A field showing only a dash ("—", no value yet) is held like text: the
//     dash's own ascent finds the baseline and the capitals' box on it is centred, since a dash
//     sits on the math axis, below the middle of the capitals, by design.
//
// Each failure names the CSS rule that sizes and aligns the control — the most specific matching
// rule (the later on a tie) that sets its display / height / line-height / padding / alignment; the
// universal reset never counts — and the one that sets its label's, as file:line from
// vite-app/src. A control styled inline (a React style={{}}) has its inline style quoted and the
// JSX line that renders it (found by class, else by label text) named instead.
// Also reported: an overflow:hidden ancestor of the whole app found scrolled (a scrollIntoView
// lifting the top bar out of view) — it is put back before measuring and named as a note.
//
// Exits 1 when any control fails, 2 when nothing could be measured (a view that did not open is
// reported and skipped). WebKit, because the app ships in WKWebView.
import { stageHands, SHARED_HAND_CODE } from './hands-states.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { stageHome, routeHomeLayout } from './home-states.mjs';
import { stageNotify } from './notify-states.mjs';
const require = createRequire(import.meta.url);
const { webkit } = require('../vite-app/node_modules/playwright');
// Resolved up the tree, not by a fixed path: a git worktree inside the checkout has no
// node_modules of its own and finds the checkout's.
const jwt = require('jsonwebtoken');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const base = (args.find(a => /^https?:/.test(a)) || process.env.CHECK_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const opt = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : d; };
const W = Number(opt('--width', 402)), H = Number(opt('--height', 874));
const jsonOut = opt('--json', null);
const only = opt('--only', null);
const skipViews = opt('--skip', null);
const dump = args.includes('--dump');
const listOnly = args.includes('--list');
const quiet = args.includes('--quiet');
const verifyInk = args.includes('--verify-ink');
const shots = opt('--shots', null);          // a directory: a screenshot of each view as scanned
const overlay = args.includes('--overlay');  // with the grid overlay on (for --shots)
const USER = process.env.CHECK_USERNAME || 'ham5';
const DPR = 3;
// A 1x1 PNG: what the Dashboard's Scan step hands the table scanner's picker.
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function token() {
  if (process.env.CHECK_TOKEN) return process.env.CHECK_TOKEN;
  if (process.env.CHECK_TOKEN_FILE) return fs.readFileSync(process.env.CHECK_TOKEN_FILE, 'utf8').trim();
  const cfg = require('../ecosystem.config.cjs');
  const app = (cfg.apps || cfg).find(a => a.name === 'futuregame-scheduler');
  return jwt.sign({ id: 9, username: USER }, app.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

// What counts as a pill or a button by name. Leaves, mostly: the group filter drops anything that
// holds two or more of these.
const CONTROLS = [
  'button', '[role="button"]', '[role="tab"]', 'a.btn', 'input[type="button"]', 'input[type="submit"]',
  '.btn', '.chip', '.filter-chip', '.kind-toggle', '.dk-seg-btn', '.live-update-tab',
  '.badge', '[class*="badge"]', '[class*="-pill"]', '[class*="-chip"]', '.pill', '.tag',
  '.beta-tag', '[class*="beta"]',
  // Up Next's plan tags (step 5 of the home: 'If bust #12', 'On: busted #12'), content-sized pills.
  '.dash-event-tag.plan',
];
// Interactive elements that are controls when they draw a visible box (see the header).
const INTERACTIVE = [
  'a[href]', '[role="switch"]', '[role="checkbox"]', '[role="radio"]', '[role="menuitem"]',
  '[role="menuitemradio"]', '[role="menuitemcheckbox"]', '[role="option"]', 'summary',
  '[tabindex="0"]', 'label', 'select', 'input[type="reset"]',
];
// Areas left alone entirely: the grid overlay itself, the replayer's table (another change
// owns it — its dealer button, seats, chips), and the venue map's canvas, which a map library
// draws (tiles, its pin and label, the attribution; its own controls are switched off).
const EXCLUDE = ['.grid-dev-overlay', '.replayer-table-slot', '.vm-map-canvas'];
// Not pills or buttons, though a rule above catches them: event cards and list rows, which are
// clickable but keep their text seated on the baseline grid. Controls INSIDE them are checked.
const NOT_CONTROLS = [
  '.cal-event-row', '.cal-event-bar', '.cal-event-chevron', '.dash-event-card', '.settings-row-btn',
  '.bk-row', '.tx-row', '.tx-trip-row', '.cs-row', '.bs-row',
  // Pick-list rows that seat their label on an r line by design: the Hands game picker's radio
  // rows ("4r row, label baseline one r above the bottom") and New Group's buddy rows ("the
  // name on +3r").
  '.game-check-row', '.create-group-buddy-btn',
  // A label made a toggle, styled to read as the plain label it replaces and seated with the
  // line it sits in: an event card's game-mix label ("HORSE ▸").
  '.cal-game-mix',
  // Table cells and rows (a sortable header is clickable; it is still a cell of the table).
  'th', 'td', 'tr',
  // The home's cards that open something but seat their figures (home steps 3-6): the Last result
  // receipt (.hm-receipt, opens the entry), the bankroll line, period block and goals cards, Up
  // Next's empty-schedule prompt, and the signal-or-noise line (a sentence that opens Analytics,
  // its lines seated on 3r).
  '.hm-receipt', '.hm-bank-bar', '.hm-period-card', '.hm-goals', '.hm-next-empty', '.hm-noise',
  // The bankroll dashboard's Locations cards: a room's name, meta, total and stats seated on r
  // lines (bankroll-locations.css); the pager buttons in an open card are controls. The Backers
  // tab's cards are the same card (bankroll-backers.css): its Copy link and Open page are controls.
  '.bl-card',
];
// Tiles: a control whose face is a small layout of its own (a name over an amount, a font
// specimen over its name), start-aligned by design. Their box is held to the grid; their text is
// seated like any other block of text, so the centring test does not apply.
const TILES = ['.bk-cell', '.font-pick-tile'];
// Navigation and disclosure rows: icon or chevron beside a label, start-aligned like a list.
// Centred vertically only. (.ovt-head: the bankroll Overview's collapsible table sections.)
const START_ALIGNED = ['.dk-rail-item', '.cal-fp-head', '.ovt-head'];
// Toggles drawn as a track and a knob: the knob is at one end by design, so it is centred
// vertically only.
const SWITCHES = ['[role="switch"]', '.settings-toggle', '[class*="toggle-switch"]', '[class*="-switch"]'];
// Venue strips (owner, 2026-10-11): the band of venue colour on an event card. Text centred both
// ways — along the band and across it. .cal-venue-strip is the Schedule / My Schedule row's
// vertical strip (writing-mode vertical-rl, rotate(180deg)); .dash-venue-strip the Up Next card's
// banner. .replayer-hand-strip (a saved hand's game strip) and .gto-seat-strip (the hand-entry
// seat strip) are drawn "property for property" from the venue strip and held to it too, and
// .bp-strip is the backer page's session card banner (the Up Next banner's form).
const STRIPS = ['.cal-venue-strip', '.dash-venue-strip', '.replayer-hand-strip', '.gto-seat-strip', '.bp-strip'];
// Not a control even though the class matches: wrappers, rows, lists.
const GROUP_CLASS = /(^|[-_])(row|rows|list|group|wrap|wrapper|strip|bar|container|tabs|area|grid|stack|line|section|panel|menu|header|body|col|cell)$/;

// ── The CSS rule index: every style rule in the app's own stylesheets, with its file:line, so a
// failure can name the rule that sizes and aligns the control. Parsed from source (the built CSS
// is one minified file), matched in the page with el.matches() and the rule's @media chain.
const CSS_FILES = ['vite-app/src/styles.css', ...fs.readdirSync(path.join(ROOT, 'vite-app/src/components')).filter(f => f.endsWith('.css')).map(f => 'vite-app/src/components/' + f)];
const LAYOUT_PROPS = new Set(['display', 'height', 'min-height', 'max-height', 'width', 'min-width', 'line-height', 'padding',
  'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'padding-block', 'padding-inline', 'align-items', 'justify-content',
  'place-items', 'place-content', 'align-content', 'align-self', 'justify-self', 'text-align', 'vertical-align', 'flex-direction',
  'grid-template-rows', 'grid-template-columns', 'writing-mode', 'text-box', 'text-box-trim', 'text-box-edge', 'transform', 'inset',
  'top', 'bottom', 'position', 'margin', 'margin-top', 'margin-bottom', 'font-size', 'box-sizing', 'flex', 'aspect-ratio',
  'left', 'right', 'max-width', 'translate', 'margin-left', 'margin-right', 'margin-inline']);
const ALIGN_PROPS = ['display', 'height', 'min-height', 'line-height', 'padding', 'padding-top', 'padding-bottom', 'padding-block',
  'align-items', 'justify-content', 'place-items', 'place-content', 'align-content', 'text-align', 'text-box', 'text-box-trim', 'writing-mode'];
// What places a layer (a sheet, a panel): its width and where its left edge lands.
const LAYER_PROPS = ['position', 'width', 'min-width', 'max-width', 'left', 'right', 'inset', 'transform', 'translate', 'margin',
  'margin-left', 'margin-right', 'margin-inline'];
function parseCss(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const out = [];
  let i = 0;
  const n = text.length;
  const lineAt = (() => { const starts = [0]; for (let k = 0; k < n; k++) if (text[k] === '\n') starts.push(k + 1);
    return (pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; }; })();
  const skipWsComments = () => { for (;;) { while (i < n && /\s/.test(text[i])) i++; if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; } else return; } };
  // Read up to a top-level '{', ';' or '}' (strings, comments and parens skipped).
  const readPrelude = () => {
    let s = '', depth = 0;
    while (i < n) {
      const c = text[i];
      if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; s += ' '; continue; }
      if (c === '"' || c === "'") { const q = c; let j = i + 1; while (j < n && text[j] !== q) { if (text[j] === '\\') j++; j++; } s += text.slice(i, j + 1); i = j + 1; continue; }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth <= 0 && (c === '{' || c === ';' || c === '}')) return { s: s.trim(), end: c };
      s += c; i++;
    }
    return { s: s.trim(), end: '' };
  };
  const skipBlock = () => { // i at '{'
    let depth = 0;
    while (i < n) {
      const c = text[i];
      if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === '"' || c === "'") { const q = c; let j = i + 1; while (j < n && text[j] !== q) { if (text[j] === '\\') j++; j++; } i = j + 1; continue; }
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) { i++; return; } }
      i++;
    }
  };
  const splitTop = (s) => { const parts = []; let depth = 0, cur = ''; for (const c of s) { if (c === '(' || c === '[') depth++; if (c === ')' || c === ']') depth--; if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += c; } if (cur.trim()) parts.push(cur.trim()); return parts; };
  const block = (ctx) => {
    for (;;) {
      skipWsComments();
      if (i >= n) return;
      if (text[i] === '}') { i++; return; }
      const startPos = i;
      const { s, end } = readPrelude();
      if (end === ';') { i++; continue; }
      if (end === '}') { i++; return; }
      if (end !== '{') return;
      if (s.startsWith('@')) {
        const m = s.match(/^@([\w-]+)\s*(.*)$/s);
        const kw = m ? m[1].toLowerCase() : '';
        const cond = m ? m[2].trim() : '';
        i++; // past '{'
        if (kw === 'media') block([...ctx, { media: cond }]);
        else if (kw === 'supports') block([...ctx, { supports: cond }]);
        else if (kw === 'container' || kw === 'layer' || kw === 'scope') block(ctx);
        else { i--; skipBlock(); }
        continue;
      }
      // A style rule: its declarations (nested rules skipped).
      const line = lineAt(startPos);
      const bodyStart = i + 1;
      skipBlock();
      const body = text.slice(bodyStart, i - 1).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, '');
      const props = [];
      for (const d of body.split(';')) {
        const k = d.indexOf(':');
        if (k < 0) continue;
        const prop = d.slice(0, k).trim().toLowerCase();
        if (LAYOUT_PROPS.has(prop)) props.push(prop + ':' + d.slice(k + 1).trim().replace(/\s+/g, ' ').slice(0, 60));
      }
      if (!props.length) continue;
      // Selectors for the element itself (a part aimed at a pseudo-element styles that, not it).
      const sels = splitTop(s).filter(p => !/::?(before|after|placeholder|marker|selection|first-line|first-letter|backdrop|-webkit-[\w-]+)\b/i.test(p));
      if (!sels.length) continue;
      out.push({ f: rel, l: line, s: sels.join(', '), sel: sels, ctx, p: props });
    }
  };
  block([]);
  return out;
}
let RULES = [];
try { RULES = CSS_FILES.flatMap(parseCss); } catch (e) { console.log('  (CSS rule index unavailable: ' + e.message + ')'); }

// Runs in the page.
function scan(cfg) {
  const { CONTROLS, INTERACTIVE, EXCLUDE, NOT_CONTROLS, TILES, START_ALIGNED, SWITCHES, STRIPS, GROUP_CLASS_SRC, ALIGN_PROPS, LAYER_PROPS, view } = cfg;
  const RULES = window.__guardRules || [];
  const GROUP_CLASS = new RegExp(GROUP_CLASS_SRC);
  const PLURAL = /(badges|chips|pills|tags|btns|buttons|toggles|segs)([-_]|$)/;
  const EMOJI = /\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic})*\uFE0F?/gu;
  const PART = /[-_](name|label|text|txt|icon|count|dot|value|title|abbr|caption|num|amount|avatar|img|glyph|arrow|caret|t)$/;
  const STATE = /^(open|active|selected|disabled|checked|current|muted|on|off|danger|is-[\w-]+|has-[\w-]+|snap-g[\w-]*)$/;
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
  // The side bearings come from canvas PIXELS, not measureText's actualBoundingBoxLeft/Right:
  // WebKit (these guards' engine, and Safari's) clamps both to the advance, so an ink that starts
  // inside its box reads as starting AT it and only overhangs come through. An occluded control
  // (no pixel pass) was held to its advance box: "14 Oct" read 1.6px wide on the left, the 1's
  // bearing, and failed dx -0.8 the moment its label was balanced on its ink (utils/ink-balance.js,
  // the same reading). The string is drawn once, at up to BIG px, and its painted columns found.
  const pv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const paintedSides = (font, size, text, width) => {
    const pad = Math.ceil(size * 0.5);
    const w = Math.ceil(width) + 2 * pad, h = Math.ceil(size * 1.6), base = Math.ceil(size * 1.1);
    if (pv.canvas.width < w) pv.canvas.width = w;
    if (pv.canvas.height < h) pv.canvas.height = h;
    pv.clearRect(0, 0, pv.canvas.width, pv.canvas.height);
    pv.font = font; pv.textAlign = 'left'; pv.textBaseline = 'alphabetic'; pv.fillStyle = '#000';
    pv.fillText(text, pad, base);
    const d = pv.getImageData(0, 0, w, h).data;
    const col = new Uint8Array(w);
    for (let y = 0; y < h; y++) { const row = y * w * 4; for (let x = 0; x < w; x++) { const a = d[row + x * 4 + 3]; if (a > col[x]) col[x] = a; } }
    let x0 = 0; while (x0 < w && col[x0] <= 8) x0++;
    let x1 = w - 1; while (x1 >= 0 && col[x1] <= 8) x1--;
    if (x0 > x1) return null;
    // In actualBoundingBox terms: left = how far the ink reaches LEFT of the origin, right = how
    // far it reaches right of it; each edge placed within its pixel by that column's coverage.
    return { left: pad - (x0 + 1 - col[x0] / 255), right: x1 + col[x1] / 255 - pad };
  };
  const metrics = (cs, text) => {
    const size = parseFloat(cs.fontSize);
    const k = fontFor(cs, size) + '|' + text;
    if (metricCache.has(k)) return metricCache.get(k);
    cv.font = fontFor(cs, size);
    const fontAsc = cv.measureText(text || 'H').fontBoundingBoxAscent;
    cv.font = fontFor(cs, BIG);
    const s = size / BIG;
    const m = cv.measureText(text), cap = cv.measureText('H').actualBoundingBoxAscent * s;
    let left = m.actualBoundingBoxLeft * s, right = m.actualBoundingBoxRight * s;
    if (text && text.trim() && m.width > 0) {
      const sz = Math.max(24, Math.min(BIG, BIG * 1500 / m.width));   // a long label drawn smaller
      const ps = paintedSides(fontFor(cs, sz), sz, text, m.width * sz / BIG);
      const wz = m.width * sz / BIG;
      // A reading no glyph gives (past half an em from either end) is the canvas not reading back
      // true; the metrics stand.
      if (ps && Math.abs(ps.left) < sz * 0.5 && Math.abs(ps.right - wz) < sz * 0.5) {
        left = ps.left * size / sz; right = ps.right * size / sz;
      }
    }
    const out = { fontAsc, cap, asc: m.actualBoundingBoxAscent * s, desc: m.actualBoundingBoxDescent * s, left, right };
    metricCache.set(k, out);
    return out;
  };
  const transform = (t, tt) => tt === 'uppercase' ? t.toUpperCase() : tt === 'lowercase' ? t.toLowerCase()
    : tt === 'capitalize' ? t.replace(/\b\p{L}/gu, c => c.toUpperCase()) : t;
  const alpha = (c) => {
    if (!c || c === 'transparent') return 0;
    const m = c.match(/\/\s*([\d.]+%?)\s*\)$/) || c.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
    if (!m) return 1;
    return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  };
  const hasBox = (cs) => alpha(cs.backgroundColor) > 0.02 || cs.backgroundImage !== 'none'
    || ['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && alpha(cs['border' + s + 'Color']) > 0.02)
    || (cs.boxShadow && cs.boxShadow !== 'none' && !/^(rgba\(0, 0, 0, 0\)|transparent)/.test(cs.boxShadow))
    || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && alpha(cs.outlineColor) > 0.02);
  const visible = (el) => {
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  // Hidden by an ancestor's clip (a collapsed panel at max-height 0, a scroller's off-screen
  // part). An absolutely positioned box escapes clips between it and its containing block.
  const clippedAway = (el, b) => {
    let needPositioned = getComputedStyle(el).position === 'absolute';
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      const positioned = s.position !== 'static' || s.transform !== 'none';
      const clips = s.overflowX !== 'visible' || s.overflowY !== 'visible' || /paint|strict|content/.test(s.contain || '');
      if (clips && (!needPositioned || positioned)) {
        const q = a.getBoundingClientRect();
        const ix = Math.min(b.right, q.right) - Math.max(b.left, q.left);
        const iy = Math.min(b.bottom, q.bottom) - Math.max(b.top, q.top);
        if (ix < 1 || iy < 1) return true;
      }
      if (s.position === 'fixed') break;
      if (positioned) needPositioned = s.position === 'absolute';
    }
    return false;
  };
  const clsList = (el) => typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : (el.className && el.className.baseVal ? el.className.baseVal.trim().split(/\s+/) : []);
  const desc = (el) => {
    const cls = clsList(el).slice(0, 3).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const matchesAny = (el, list) => { try { return list.length > 0 && el.matches(list.join(',')); } catch { return false; } };

  // Scrolled content is measured where it is LAID OUT, not where the scroll left it.
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

  const excl = EXCLUDE.join(',');
  const onScreen = (b) => !(b.bottom <= 0 || b.top >= innerHeight || b.right <= 0 || b.left >= innerWidth);
  // What covers a control: at a grid of points reaching close to its edges (a bar over the last
  // few px of a tall strip counts), everything stacked there, top down (elementsFromPoint — a
  // transparent click-catcher over the whole page hides nothing and must not hide what is under
  // it), until the control itself: anything above it that paints a box covers it (a transparent
  // <select> laid over a face does not).
  const FS = [0.04, 0.27, 0.5, 0.73, 0.96];
  const paints = (h) => {
    const s = getComputedStyle(h);
    if (Number(s.opacity) === 0 || s.visibility === 'hidden') return false;
    return hasBox(s) || /^(img|svg|canvas|video)$/i.test(h.tagName);
  };
  // The bankroll tab strip's edge fades (.bt-fade: 3g of the sheet's ground fading to clear, shown
  // only where more tabs lie beyond) paint over the pills under them, yet are pointer-events: none,
  // so elementsFromPoint never lists them. Their area covers like anything else that paints: the
  // pill that peeks out under one (a seventh tab, "Rules" at x32g) has its glyphs washed, and a
  // pixel read of its ink centre is off by the wash, not by the label.
  const fades = [...document.querySelectorAll('.bt-fade')].filter(visible).map((f) => f.getBoundingClientRect());
  const coverage = (el, b) => {
    let n = 0, covered = 0, out = 0;
    for (const fy of FS) for (const fx of FS) {
      n++;
      const x = b.left + b.width * fx, y = b.top + b.height * fy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) { out++; continue; }
      if (!el.closest('.bt-fade') && fades.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom)) { covered++; continue; }
      for (const h of document.elementsFromPoint(x, y)) {
        if (h === el || el.contains(h) || h.contains(el)) break;
        if (h.closest('svg') && h.tagName.toLowerCase() !== 'svg') continue;
        if (paints(h)) { covered++; break; }
      }
    }
    return { covered: covered / n, out: out / n };
  };
  // Pixels cannot see a control that anything covers, even a corner of it.
  const occluded = (el, b) => { const c = coverage(el, b); return c.covered > 0 || c.out > 0; };
  // 90% or more of what is on screen of it is covered.
  const hiddenUnder = (el, b) => { const c = coverage(el, b); return c.out < 1 && c.covered / (1 - c.out) >= 0.9; };

  const usable = (el) => {
    if (el.closest(excl) || matchesAny(el, NOT_CONTROLS) || matchesAny(el, STRIPS)) return false;
    // Nobody can reach a control in an inert subtree (the Up Next carousel's slides not on show).
    if (el.closest('[inert]')) return false;
    if (el.closest('select') && el.tagName !== 'SELECT') return false;
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1 || !onScreen(b)) return false;
    if (!visible(el) || clippedAway(el, b)) return false;
    // Hidden under something else (a list behind a full-screen replayer, a sheet's backdrop):
    // counted over the points that are on screen. A control running off the window's edge
    // under the replayer (the Hands tool row, scrolled sideways) is as hidden as one inside it,
    // and its off-screen points used to keep it under the 90% (Watch Solver, 4 views).
    if (hiddenUnder(el, b)) return false;
    return true;
  };
  const hasLabel = (el) => {
    if (el.querySelector('svg, img, canvas')) return true;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) if (t.textContent.trim() && !t.parentElement.closest('select, option, script, style')) return true;
    return false;
  };
  const pseudoText = (el) => {
    for (const ps of ['::before', '::after']) {
      const c = getComputedStyle(el, ps).content;
      if (c && c !== 'none' && c !== 'normal' && /^["'].*\S.*["']$/.test(c)) return c.slice(1, -1);
    }
    return '';
  };
  // A <label>/<select>/<input> face: the label is a control when it draws the face for a hidden
  // input or select (the currency picker's "$ USD ▾" over an invisible <select>).
  const hiddenInput = (inp) => {
    if (!inp) return false;
    const s = getComputedStyle(inp), q = inp.getBoundingClientRect();
    return Number(s.opacity) === 0 || s.visibility === 'hidden' || q.width <= 1 || q.height <= 1 || s.clipPath !== 'none' || s.clip !== 'auto' && s.clip !== '';
  };
  const labelControl = (el) => {
    const inp = el.querySelector('select, input:not([type="text"]):not([type="search"]):not([type="email"]):not([type="password"]):not([type="number"]):not([type="date"]):not([type="time"]):not([type="tel"]):not([type="url"])')
      || (el.htmlFor ? document.getElementById(el.htmlFor) : null);
    return inp && (inp.tagName === 'SELECT' || /checkbox|radio|file|color|button|submit/.test(inp.type || '')) && hiddenInput(inp);
  };

  // 1. by selector; 2. interactive with a box; 3. cursor:pointer with a box.
  const src = new Map();
  for (const el of document.querySelectorAll(CONTROLS.join(','))) if (!src.has(el)) src.set(el, 'selector');
  for (const el of document.querySelectorAll(INTERACTIVE.join(','))) {
    if (src.has(el)) continue;
    const cs = getComputedStyle(el);
    if (el.tagName === 'LABEL') {
      if (!labelControl(el)) continue;
      if (hasBox(cs)) { src.set(el, 'label'); continue; }
      // No box of its own: the one descendant that draws one is the face (a toggle switch's
      // track over its hidden checkbox).
      const faces = [...el.querySelectorAll('*')].filter(d => !d.closest('svg') && !/^(INPUT|SELECT|OPTION)$/.test(d.tagName) && hasBox(getComputedStyle(d)));
      const outer = faces.filter(d => !faces.some(o => o !== d && o.contains(d)));
      if (outer.length === 1 && !src.has(outer[0])) src.set(outer[0], 'label-face');
      continue;
    }
    if (el.tagName === 'SELECT') { if (!hiddenInput(el)) src.set(el, 'select'); continue; }
    if (hasBox(cs) && (hasLabel(el) || pseudoText(el) || el.matches('[role="switch"]'))) src.set(el, 'interactive');
  }
  for (const el of document.querySelectorAll('body *')) {
    if (src.has(el) || el.closest('svg')) continue;
    const cs = getComputedStyle(el);
    if (cs.cursor !== 'pointer') continue;
    const pc = el.parentElement ? getComputedStyle(el.parentElement).cursor : '';
    if (pc === 'pointer') continue;
    if (!(hasLabel(el) || pseudoText(el))) continue;
    if (hasBox(cs)) { src.set(el, 'pointer'); continue; }
    // No box of its own: the one descendant with a box that holds the whole label is the face.
    const b = el.getBoundingClientRect();
    const faces = [...el.querySelectorAll('*')].filter(d => !d.closest('svg') && hasBox(getComputedStyle(d)) && hasLabel(d));
    const outer = faces.filter(d => !faces.some(o => o !== d && o.contains(d)));
    if (outer.length === 1) {
      const d = outer[0], q = d.getBoundingClientRect();
      // the face must hold all of the label: no text outside it
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let outside = false;
      for (let t = w.nextNode(); t; t = w.nextNode()) if (t.textContent.trim() && !d.contains(t)) { outside = true; break; }
      if (!outside && q.width * q.height > 0.25 * b.width * b.height && !src.has(d)) src.set(d, 'pointer-face');
    }
  }
  // A text link: no box anywhere on it, no icon, and either named a link or set inside a run of
  // text ("No account? Register"). It is text, seated with its sentence — not a pill.
  const isTextLink = (el) => {
    if (hasBox(getComputedStyle(el)) || el.querySelector('svg, img, canvas')) return false;
    if ([...el.querySelectorAll('*')].some(d => hasBox(getComputedStyle(d)))) return false;
    if (el.tagName === 'A' || /(^|[-_ ])link([-_ ]|$)/.test(clsList(el).join(' '))) return true;
    const pa = el.parentElement;
    return !!pa && [...pa.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
  };
  let cands = [...src.keys()].filter(el => {
    if (!usable(el)) return false;
    if (isTextLink(el)) return false;
    const how = src.get(el);
    // Class-matched (not a <button>) wrappers named like rows and groups are not controls.
    const isNative = el.matches('button, [role="button"], [role="tab"], a.btn, input, select, label');
    if (how === 'selector' && !isNative) {
      const toks = clsList(el);
      const hit = toks.filter(t => /badge|pill|chip|tag|beta|btn|toggle|seg/.test(t));
      if (hit.length && hit.every(t => GROUP_CLASS.test(t) || PLURAL.test(t))) return false;
      // A PART of a control (.buddy-chip-name, .x-pill-label): the label, not a second control.
      if (hit.length && hit.every(t => GROUP_CLASS.test(t) || PLURAL.test(t) || PART.test(t))
        && el.parentElement && el.parentElement.closest(CONTROLS.join(','))) return false;
    }
    if ((how === 'pointer' || how === 'pointer-face' || how === 'interactive') && !el.matches('button, [role], a, label, summary')) {
      // State classes (.selected, .active, .is-on) say nothing about what the element is.
      const toks = clsList(el).filter(t => !STATE.test(t));
      if (toks.length && toks.every(t => GROUP_CLASS.test(t) || PLURAL.test(t))) return false;
    }
    return true;
  });
  const set = new Set(cands);
  // A group holds two or more controls.
  cands = cands.filter(el => {
    let n = 0;
    for (const o of set) if (o !== el && el.contains(o)) n++;
    return n < 2;
  });
  const same = (a, c) => { const p = a.getBoundingClientRect(), q = c.getBoundingClientRect();
    return Math.abs(p.left - q.left) < 0.5 && Math.abs(p.top - q.top) < 0.5 && Math.abs(p.width - q.width) < 0.5 && Math.abs(p.height - q.height) < 0.5; };
  // The face is measured once: an inner element with the outer's box is the outer; a boxless
  // outer (picked up only by its cursor or role) around one control is that control.
  cands = cands.filter(el => !cands.some(o => o !== el && o.contains(el) && same(o, el)));
  cands = cands.filter(el => {
    const how = src.get(el);
    if (how === 'selector' && el.matches('button, [role="button"], [role="tab"]')) return true;
    if (hasBox(getComputedStyle(el))) return true;
    const inner = cands.filter(o => o !== el && el.contains(o));
    return inner.length !== 1;
  });
  // A boxless tap target inside a control that draws a box is part of that face (a filter pill's
  // clear "✕", role=button, inside "NLH ✕"): the pill is measured with it, once.
  const boxedFace = (el) => hasBox(getComputedStyle(el)) || [...el.querySelectorAll('*')].some(d => !d.closest('svg') && hasBox(getComputedStyle(d)));
  cands = cands.filter(el => boxedFace(el) || !cands.some(o => o !== el && o.contains(el) && hasBox(getComputedStyle(o))));

  // ── Ink.
  const linearOf = (el) => {
    let m = new DOMMatrix();
    for (let a = el; a && a.nodeType === 1 && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      let t = new DOMMatrix();
      if (s.rotate && s.rotate !== 'none') {
        const mm = s.rotate.match(/(-?[\d.]+)(deg|rad|turn)\s*$/);
        if (mm && !/\b[xy]\b/.test(s.rotate)) { const v = parseFloat(mm[1]); t = t.rotate(mm[2] === 'rad' ? v * 180 / Math.PI : mm[2] === 'turn' ? v * 360 : v); }
      }
      if (s.scale && s.scale !== 'none') { const [sx, sy] = s.scale.split(/\s+/).map(parseFloat); t = t.scale(sx, Number.isFinite(sy) ? sy : sx); }
      if (s.transform && s.transform !== 'none') { try { t = t.multiply(new DOMMatrix(s.transform)); } catch {} }
      m = t.multiply(m);
    }
    return m;
  };
  const axisOf = (m, vx, vy) => { const x = m.a * vx + m.c * vy, y = m.b * vx + m.d * vy; return Math.abs(x) >= Math.abs(y) ? { ax: 'x', sg: Math.sign(x) || 1 } : { ax: 'y', sg: Math.sign(y) || 1 }; };
  const orient = (hs, host) => {
    const wm = (hs.writingMode || 'horizontal-tb').replace(/^lr(-tb)?$|^rl(-tb)?$|^tb$/, 'horizontal-tb').replace(/^tb-rl$/, 'vertical-rl').replace(/^tb-lr$/, 'vertical-lr');
    const rtl = hs.direction === 'rtl';
    let inl, over;
    if (/^horizontal/.test(wm)) { inl = [rtl ? -1 : 1, 0]; over = [0, -1]; }
    else if (wm === 'sideways-lr') { inl = [0, rtl ? 1 : -1]; over = [-1, 0]; }
    else { inl = [0, rtl ? -1 : 1]; over = [1, 0]; }
    const m = linearOf(host);
    return { wm, upright: !/^horizontal/.test(wm) && hs.textOrientation === 'upright', inl: axisOf(m, ...inl), over: axisOf(m, ...over) };
  };
  const decorativeIn = (el) => (n) => {
    for (let a = n.nodeType === 1 ? n : n.parentElement; a && a !== el; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.position === 'absolute' || s.position === 'fixed') return true;
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return true;
      if (a.tagName === 'SELECT' || a.tagName === 'OPTION') return true;
    }
    return false;
  };
  const union = (bs) => bs.reduce((u, q) => [Math.min(u[0], q[0]), Math.min(u[1], q[1]), Math.max(u[2], q[2]), Math.max(u[3], q[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  const measureInk = (el, b) => {
    const decorative = decorativeIn(el);
    const textBoxes = [], figBoxes = [], texts = [], hosts = new Set(), textHost = [];
    let allSym = true;
    // The block a text run belongs to: its nearest non-inline ancestor inside the control.
    const blockOf = (h) => { for (let a = h; a && a !== el; a = a.parentElement) if (!/^inline$|^contents$/.test(getComputedStyle(a).display)) return a; return el; };
    let inlineAxis = 'x';
    const area = b.width * b.height;
    const labelNodes = [];
    { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.trim() && !decorative(n)) labelNodes.push(n); }
    // A filled descendant is a FIGURE (an avatar disc, a swatch) when it is small beside the face,
    // or when label text sits outside it (a disc over a name). One that holds all the text and
    // most of the face is the face.
    const filled = [...el.querySelectorAll('*')].filter(d => {
      if (d.closest('svg') || decorative(d)) return false;
      const s = getComputedStyle(d);
      const fill = alpha(s.backgroundColor) > 0.02 || s.backgroundImage !== 'none';
      if (!fill) return false;
      const q = d.getBoundingClientRect();
      if (q.width < 1 || q.height < 1) return false;
      return q.width * q.height < area * 0.6 || (labelNodes.some(n => !d.contains(n)) && q.width * q.height < area * 0.95);
    });
    // Pictures (a filled disc, a swatch, a preview, an <img>) as against line icons (an <svg>).
    const pictures = [];
    for (const d of filled) { const q = d.getBoundingClientRect(); figBoxes.push([q.left, q.top, q.right, q.bottom]); pictures.push([q.left, q.top, q.right, q.bottom]); }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || decorative(n)) continue;
      if (filled.some(d => d.contains(n))) continue; // the disc is the figure, not its initial
      const host = n.parentElement;
      const hs = getComputedStyle(host);
      const raw = n.textContent;
      const o = orient(hs, host);
      // Emoji are pictures, not letters: each counts as a FIGURE with its whole glyph (it has no
      // cap height and sits through the baseline), and the letters around it are the text.
      const emo = [...raw.matchAll(EMOJI)];
      for (const e of emo) {
        const r0 = document.createRange();
        r0.setStart(n, e.index); r0.setEnd(n, e.index + e[0].length);
        const em = metrics(hs, e[0]);
        for (const q of [...r0.getClientRects()].filter(q => q.width > 0 && q.height > 0)) {
          if (o.upright) { figBoxes.push([q.left, q.top, q.right, q.bottom]); continue; }
          const A = o.over.ax, lo = { x: q.left, y: q.top }, hi = { x: q.right, y: q.bottom };
          const box = { x: [q.left, q.right], y: [q.top, q.bottom] };
          if (o.over.sg < 0) { const bl = lo[A] + em.fontAsc; box[A] = [bl - em.asc, bl + em.desc]; }
          else { const bl = hi[A] - em.fontAsc; box[A] = [bl - em.desc, bl + em.asc]; }
          figBoxes.push([box.x[0], box.y[0], box.x[1], box.y[1]]);
        }
      }
      let s0 = raw.search(/\S/), s1 = raw.length - (raw.match(/\s*$/)[0].length);
      if (emo.length) {
        // The letters: from the first non-space, non-emoji character to the last.
        const mask = [...raw].map(() => true);
        let k = 0; const units = [];
        for (const ch of raw) { units.push([k, k + ch.length]); k += ch.length; }
        for (const e of emo) units.forEach(([a, z], i) => { if (a >= e.index && z <= e.index + e[0].length) mask[i] = false; });
        const ok = units.map(([a, z], i) => mask[i] && /\S/.test(raw.slice(a, z)) && !/[\uFE0F\u200D]/.test(raw.slice(a, z)));
        const first = ok.indexOf(true), last = ok.lastIndexOf(true);
        if (first < 0) { hosts.add(host); texts.push(raw.trim()); continue; }
        s0 = units[first][0]; s1 = units[last][1];
      }
      const text = transform(raw.slice(s0, s1).replace(/\s+/g, ' ').trim(), hs.textTransform);
      const m = metrics(hs, text);
      const range = document.createRange();
      range.setStart(n, s0); range.setEnd(n, s1);
      const rects = [...range.getClientRects()].filter(q => q.width > 0 && q.height > 0);
      if (!rects.length) continue;
      texts.push(emo.length ? raw.trim() : text);
      hosts.add(host);
      inlineAxis = o.inl.ax;
      const symbol = !/[\p{L}\p{N}]/u.test(text);
      if (!symbol) allSym = false;
      const allCaps = !/\p{Ll}/u.test(text) && /\p{Lu}/u.test(text);
      const ls = parseFloat(hs.letterSpacing) || 0;
      const inkAsc = allCaps ? m.cap : m.asc;
      // Truncated text paints no further than what clips it: the control's own box, and any
      // element between the text and the control that clips sideways (a name span that ellipsizes
      // beside a count — its Range still spans the whole string, past the span's edge).
      let clipL = b.left, clipR = b.right;
      for (let a = host; a && a !== el; a = a.parentElement) {
        if (getComputedStyle(a).overflowX === 'visible') continue;
        const q = a.getBoundingClientRect();
        clipL = Math.max(clipL, q.left); clipR = Math.min(clipR, q.right);
      }
      for (const q of rects) {
        const lo = { x: q.left, y: q.top }, hi = { x: q.right, y: q.bottom };
        const box = { x: [q.left, q.right], y: [q.top, q.bottom] };
        if (!o.upright) {
          // Across the line: baseline the font ascent in from the over edge; ink out to the ink ascent.
          const A = o.over.ax;
          if (o.over.sg < 0) { const bl = lo[A] + m.fontAsc; box[A] = [bl - inkAsc, symbol ? bl + m.desc : bl]; }
          else { const bl = hi[A] - m.fontAsc; box[A] = [symbol ? bl - m.desc : bl, bl + inkAsc]; }
          // Along the line: side bearings and letter spacing (one line only).
          const L = o.inl.ax;
          if (rects.length === 1) {
            const extra = Math.max(0, [...text].length - 1) * ls;
            if (o.inl.sg > 0) { const st = lo[L]; box[L] = [st - m.left, st + m.right + extra]; }
            else { const st = hi[L]; box[L] = [st - m.right - extra, st + m.left]; }
          }
        }
        // Truncated text paints no further than what clips it (above).
        const bx = [Math.max(box.x[0], clipL), Math.min(box.x[1], clipR)];
        const by = [Math.max(box.y[0], b.top), Math.min(box.y[1], b.bottom)];
        textBoxes.push([bx[0], by[0], bx[1], by[1]]);
        textHost.push([[bx[0], by[0], bx[1], by[1]], host, symbol]);
      }
    }
    for (const ic of el.querySelectorAll('svg, img, canvas')) {
      if (decorative(ic) || (ic.parentElement && ic.parentElement.closest('svg'))) continue;
      if (filled.some(d => d.contains(ic))) continue;
      const q = ic.getBoundingClientRect();
      if (q.width < 1 || q.height < 1) continue;
      figBoxes.push([q.left, q.top, q.right, q.bottom]);
      if (ic.tagName !== 'svg' && ic.tagName !== 'SVG') pictures.push([q.left, q.top, q.right, q.bottom]);
    }
    // A face that is a small LAYOUT rather than a label (see TILES): two text blocks stacked (a
    // title over a description, a name over an amount), or a large figure stacked with text (an
    // avatar over a name, a theme preview over its name). A tab bar's line icon (an <svg>) over
    // its label is a label: the two are centred together — and so is a SYMBOL set as text over a
    // label (the hand-entry action buttons' "✕" over "FOLD"), which is an icon, not a second line.
    let layout = null;
    {
      const across = inlineAxis === 'y' ? [0, 2] : [1, 3];
      const blocks = textHost.map(([q, h, sym]) => ({ q, h: blockOf(h), sym }));
      for (let i = 0; i < blocks.length && !layout; i++) for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i], c = blocks[j];
        if (a.h === c.h || a.sym || c.sym) continue;
        if (a.q[across[1]] <= c.q[across[0]] + 0.5 || c.q[across[1]] <= a.q[across[0]] + 0.5) { layout = 'stacked text'; break; }
      }
      if (!layout && textBoxes.length && pictures.length) {
        const t = union(textBoxes);
        for (const f of pictures) {
          const stacked = t[1] >= f[3] - 0.5 || t[3] <= f[1] + 0.5;
          if (stacked && ((f[3] - f[1]) >= 0.4 * b.height || (f[2] - f[0]) * (f[3] - f[1]) >= 0.2 * area)) { layout = 'figure over text'; break; }
        }
      }
    }
    return { textU: textBoxes.length ? union(textBoxes) : null, figU: figBoxes.length ? union(figBoxes) : null,
      texts, hosts: [...hosts], inlineAxis, nText: textBoxes.length, nFig: figBoxes.length, layout,
      symbolOnly: textBoxes.length > 0 && allSym, parts: [...textBoxes, ...figBoxes] };
  };
  // Covered by something else (a fixed bar, a sheet): pixels cannot see it.
  // ── The CSS rules behind a failure.
  const mq = new Map();
  const ctxOk = (ctx) => ctx.every(c => {
    const k = JSON.stringify(c);
    if (!mq.has(k)) { let v = true; try { if (c.media) v = matchMedia(c.media).matches; else if (c.supports) v = CSS.supports(c.supports); } catch { v = true; } mq.set(k, v); }
    return mq.get(k);
  });
  // Specificity of one selector, as a sortable number (ids, classes/attributes/pseudo-classes,
  // types). :is/:where/:not/:has count roughly — this ranks rules, it does not cascade them.
  const specOf = (s) => {
    const t = s.replace(/:where\([^)]*\)/g, '').replace(/::?[\w-]+/g, (m) => /^::/.test(m) ? ' ' : ' .x ');
    const ids = (t.match(/#[\w-]+/g) || []).length;
    const cls = (t.match(/\.[\w-]+|\[[^\]]*\]/g) || []).length;
    const types = (t.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').match(/(^|[\s>+~(,])[a-zA-Z][\w-]*/g) || []).length;
    return ids * 1e4 + cls * 100 + types;
  };
  const rulesFor = (el, props) => {
    const out = [];
    for (const rr of RULES) {
      if (!rr.p.some(p => props.includes(p.split(':')[0]))) continue;
      let spec = -1;
      for (const s of rr.sel) { try { if (el.matches(s)) spec = Math.max(spec, specOf(s)); } catch {} }
      // The universal reset (`* { margin: 0; padding: 0 }`) matches everything and explains nothing.
      if (spec > 0 && ctxOk(rr.ctx)) out.push({ ...rr, spec });
    }
    // The rule that sizes and aligns it: the most specific, the later on a tie — last in the list.
    return out.sort((a, b) => a.spec - b.spec || (a.f === b.f ? a.l - b.l : 0));
  };
  const ruleRefs = (el) => {
    const rs = rulesFor(el, ALIGN_PROPS);
    return rs.map(rr => ({ at: `${rr.f}:${rr.l}`, spec: rr.spec, sel: rr.s.slice(0, 90), set: rr.p.filter(p => ALIGN_PROPS.includes(p.split(':')[0])).join('; ').slice(0, 160) }));
  };

  // The vertical lines' origin: the .app-shell's left, except inside a LAYER — an opaque fixed
  // element drawn over the app (the replayer, full-bleed or landscape; a sheet, a panel, a
  // dropdown) — which is a canvas of its own: its controls' lines run from its own left edge. A
  // layer anchored at the window's left edge (the replayer, a full-width sheet) is the window's
  // canvas, and on a phone that is the shell's too. Any other layer is itself held to the shell's
  // lines, once, as kind "layer" (left edge on a g line, width whole g): a sheet centred on a
  // desktop window at a fractional width is ONE failure, its own, rather than one per control
  // inside it. A translucent backdrop is not a layer: a modal centred on it is centred in the
  // shell, on the shell's lines.
  const layersUsed = new Set();
  const layerOf = (el) => {
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.position !== 'fixed') continue;
      if (shell && (a === shell || a.contains(shell))) return null;
      if (alpha(s.backgroundColor) >= 0.95 || s.backgroundImage !== 'none') return a;
    }
    return null;
  };
  const layerLeft = (el) => {
    const L = layerOf(el);
    if (!L) return ox;
    const left = L.getBoundingClientRect().left;
    if (Math.abs(left - ox) >= 0.5 && Math.abs(left) >= 0.5) layersUsed.add(L);
    return Math.abs(left - ox) < 0.5 ? ox : left;
  };
  const out = [];
  let gid = (window.__guardGid || 0);
  const record = (el, kind0, how0, band) => {
    let kind = kind0, how = how0;
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const wg = b.width / g, hr = b.height / r;
    const lo = layoutOffset(el);
    const tr = (cs.translate && cs.translate !== 'none') ? cs.translate.split(/\s+/).map(parseFloat) : [0, 0];
    const ox0 = layerLeft(el);
    const lx = (b.left + lo.dx - (tr[0] || 0) - ox0) / g, ty = (b.top + lo.dy - (tr[1] || 0) - oy) / r;
    const geo = { w: +wg.toFixed(2), h: +hr.toFixed(2), x: +lx.toFixed(2), y: +ty.toFixed(2) };
    const geoFail = [];
    if (kind !== 'strip') {
      if (Math.abs(frac(wg)) > 0.05) geoFail.push('w');
      if (Math.abs(frac(hr)) > 0.05) geoFail.push('h');
      if (Math.abs(frac(lx)) > 0.05) geoFail.push('x');
      if (Math.abs(frac(ty)) > 0.05) geoFail.push('y');
    }
    const ink = measureInk(el, b);
    // A small layout, not a label (two text blocks, a big figure over text): a tile.
    if ((kind === 'control' || kind === 'start') && ink.layout) { kind = 'tile'; how += ' / tile: ' + ink.layout; }
    // A ROW: a list or menu row (a dropdown's items, a pick list), its label set at the start by
    // design — nothing on the way from the label up to the control centres it, and the gap after
    // the label is over 1g wider than the gap before it — or a label and a trailing item spread
    // apart. Held like START_ALIGNED: box on the grid, label centred vertically.
    if (kind === 'control' && ink.nText && (ink.textU || ink.figU)) {
      const u = union([ink.textU, ink.figU].filter(Boolean));
      const startGap = u[0] - b.left, endGap = b.right - u[2];
      // Does anything between the label and the control centre it along the line? text-align
      // counts where the label is inline content of the box that sets it; a flex or grid box by
      // its justification (or the item's align-self / justify-self).
      let centred = false, spread = false;
      for (const h of ink.hosts) {
        let inlineRun = true, child = null;
        for (let a = h; a; child = a, a = a.parentElement) {
          const s = getComputedStyle(a);
          const flex = /flex/.test(s.display), grid = /grid/.test(s.display);
          if (flex) {
            const col = /column/.test(s.flexDirection);
            if (!col && /center|space-around|space-evenly/.test(s.justifyContent)) centred = true;
            if (col && /center/.test(s.alignItems)) centred = true;
            if (!col && /space-between/.test(s.justifyContent) && a.children.length > 1) spread = true;
            if (child && col && /center/.test(getComputedStyle(child).alignSelf)) centred = true;
          } else if (grid) {
            if (/center/.test(s.justifyItems) || /center/.test(s.justifyContent) || /center/.test(s.placeItems || '')) centred = true;
            if (child && /center/.test(getComputedStyle(child).justifySelf)) centred = true;
          } else if (inlineRun && /center/.test(s.textAlign)) centred = true;
          inlineRun = /^inline/.test(s.display);
          if (a === el) break;
        }
      }
      // Spread apart however it is done (space-between, an auto margin, a trailing control): an
      // empty run of over 2g between the parts of the face.
      if (!spread && ink.parts.length > 1) {
        const iv = ink.parts.map(q => ink.inlineAxis === 'y' ? [q[1], q[3]] : [q[0], q[2]]).sort((p, q) => p[0] - q[0]);
        let end = iv[0][1];
        for (const [a0, a1] of iv.slice(1)) { if (a0 - end > 2 * g) { spread = true; break; } end = Math.max(end, a1); }
      }
      // Set at the start by design: nothing centres it and the free space lies after it.
      if (spread || (!centred && endGap - startGap > g)) { kind = 'start'; how += spread ? ' / row: spread' : ' / row: start-aligned'; }
    }
    // Labels the DOM does not hold as text: measured from pixels by the caller.
    let needPx = null;
    if (el.tagName === 'SELECT') needPx = { text: (el.selectedOptions[0] || {}).text || '' };
    else if (el.tagName === 'INPUT' && /button|submit|reset/.test(el.type)) needPx = { text: el.value || '' };
    else if (!ink.nText && !ink.nFig) { const pt = pseudoText(el); if (pt) needPx = { text: pt }; }
    const id = ++gid;
    el.setAttribute('data-guard-id', String(id));
    const r2 = (u) => u ? u.map(v => +v.toFixed(4)) : null;
    const item = {
      view, kind, how, el: desc(el), cls: clsList(el), tag: el.tagName.toLowerCase(),
      text: ink.texts.join(' ').slice(0, 40) || (needPx ? needPx.text.slice(0, 40) : '') || (el.getAttribute('aria-label') || el.title || '').slice(0, 40),
      ...geo, geoFail,
      box: !band || band === b ? { left: +b.left.toFixed(4), top: +b.top.toFixed(4), width: +b.width.toFixed(4), height: +b.height.toFixed(4) }
        : { left: +band.left.toFixed(4), top: +band.top.toFixed(4), width: +band.width.toFixed(4), height: +band.height.toFixed(4) },
      ...(band && band !== b ? { elBox: { left: +b.left.toFixed(4), top: +b.top.toFixed(4), width: +b.width.toFixed(4), height: +b.height.toFixed(4) }, bandFrom: band.from } : {}),
      textU: r2(ink.textU), figU: r2(ink.figU), inlineAxis: ink.inlineAxis,
      ctx: (() => { const p = el.parentElement; return p ? desc(p) : ''; })(),
      anc: (() => { const out = []; for (let a = el.parentElement; a && out.length < 6 && a !== document.body; a = a.parentElement) { const c = clsList(a).filter(k => !/^(open|active|selected|is-\w+|tab-active|snap-g\S*)$/.test(k)); if (c.length) out.push(c[0]); } return out; })(),
      gid: id, needPx, nText: ink.nText, nFig: ink.nFig, symbolOnly: ink.symbolOnly, boxless: !hasBox(cs) && ![...el.querySelectorAll('*')].some(d => !d.closest('svg') && hasBox(getComputedStyle(d)) && hasLabel(d)),
      full: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
      occluded: occluded(el, b),
    };
    if (needPx || ink.nText) {
      item.font = { family: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle, size: cs.fontSize, tt: cs.textTransform };
    }
    item._el = el;
    item._hosts = ink.hosts;
    out.push(item);
  };
  for (const el of cands) {
    const inSwitch = src.get(el) === 'label-face' && !!el.parentElement && !!el.parentElement.closest(SWITCHES.join(','));
    const kind = matchesAny(el, TILES) ? 'tile' : matchesAny(el, START_ALIGNED) ? 'start' : (matchesAny(el, SWITCHES) || inSwitch) ? 'switch'
      : el.tagName === 'SELECT' ? 'field' : 'control';
    record(el, kind, src.get(el));
  }
  // A strip's BAND is the colour the eye sees, which can run past the element: a saved card's
  // content carries a venue-colour border against the strip (.cal-event-row-content), so the band
  // is the strip plus that border, and the strip's padding on that side is there to centre the
  // name in the whole band. Walk outward from each edge across the strip, at a quarter, half and
  // three quarters along it; while the first thing that paints at the point (a border on the side
  // facing the strip, else a background) is the strip's colour, the band goes on. The smallest
  // reach of the three is taken. The name is centred in the band; the element's box is reported.
  const clear = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  const paintAt = (x, y, self) => {
    for (const e of document.elementsFromPoint(x, y)) {
      if (e === self || e.closest(excl)) continue;
      const cs = getComputedStyle(e), r0 = e.getBoundingClientRect();
      for (const [side, inside] of [['Left', x - r0.left], ['Right', r0.right - x], ['Top', y - r0.top], ['Bottom', r0.bottom - y]]) {
        const bw = parseFloat(cs['border' + side + 'Width']) || 0;
        if (bw > 0 && cs['border' + side + 'Style'] !== 'none' && inside >= 0 && inside < bw && !clear(cs['border' + side + 'Color'])) return { color: cs['border' + side + 'Color'], by: desc(e) + ' border-' + side.toLowerCase() };
      }
      // An inset ring (box-shadow 0 0 0 N inset): a border that takes no room — the saved card's
      // venue-colour outline on .cal-event-row-content is one.
      const edge = Math.min(x - r0.left, r0.right - x, y - r0.top, r0.bottom - y);
      for (const sh of (cs.boxShadow || 'none').split(/,(?![^(]*\))/)) {
        if (!/inset/.test(sh)) continue;
        const col = (sh.match(/rgba?\([^)]*\)/) || [''])[0], n = sh.replace(col, '').match(/-?[\d.]+px/g) || [];
        const [ox, oy, blur, spread] = n.map(parseFloat);
        if (!ox && !oy && !blur && spread > 0 && edge >= 0 && edge < spread && !clear(col)) return { color: col, by: desc(e) + ' inset ring' };
      }
      if (!clear(cs.backgroundColor)) return { color: cs.backgroundColor, by: desc(e) + ' background' };
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { color: 'image', by: desc(e) };
    }
    return null;
  };
  const rgbKey = (c) => (String(c).match(/[\d.]+/g) || []).slice(0, 3).join(',');
  const paintedBand = (el, b) => {
    const bg = getComputedStyle(el).backgroundColor;
    if (clear(bg)) return b;
    const key = rgbKey(bg), vertical = b.height > b.width, step = 0.25, max = g;
    const reach = (dir) => {
      let best = Infinity, by = '';
      for (const f of [0.25, 0.5, 0.75]) {
        let d = 0;
        for (; d < max; d += step) {
          const pt = vertical ? [dir < 0 ? b.left - d - step / 2 : b.right + d + step / 2, b.top + b.height * f]
            : [b.left + b.width * f, dir < 0 ? b.top - d - step / 2 : b.bottom + d + step / 2];
          const hit = paintAt(pt[0], pt[1], el);
          if (!hit || rgbKey(hit.color) !== key) break;
          by = hit.by;
        }
        best = Math.min(best, d);
      }
      return { d: best >= step ? best : 0, by };
    };
    const lo = reach(-1), hi = reach(1);
    if (!lo.d && !hi.d) return b;
    const out = vertical ? { left: b.left - lo.d, top: b.top, width: b.width + lo.d + hi.d, height: b.height }
      : { left: b.left, top: b.top - lo.d, width: b.width, height: b.height + lo.d + hi.d };
    out.from = [lo.d ? `${lo.by} ${lo.d.toFixed(2)}px` : '', hi.d ? `${hi.by} ${hi.d.toFixed(2)}px` : ''].filter(Boolean).join('; ');
    return out;
  };
  for (const el of document.querySelectorAll(STRIPS.join(','))) {
    if (el.closest(excl) || el.closest('[inert]')) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1 || !onScreen(b) || !visible(el) || clippedAway(el, b)) continue;
    if (hiddenUnder(el, b)) continue;
    record(el, 'strip', 'strip', paintedBand(el, b));
  }
  // Each layer that measured controls on its own lines: its left edge and width on the shell's.
  for (const L of layersUsed) {
    const b = L.getBoundingClientRect();
    const wg = b.width / g, lx = (b.left - ox) / g;
    const geoFail = [];
    if (Math.abs(frac(wg)) > 0.05) geoFail.push('w');
    if (Math.abs(frac(lx)) > 0.05) geoFail.push('x');
    const id = ++gid;
    L.setAttribute('data-guard-id', String(id));
    out.push({ view, kind: 'layer', how: 'layer', el: desc(L), cls: clsList(L), tag: L.tagName.toLowerCase(), text: '',
      w: +wg.toFixed(2), h: +(b.height / r).toFixed(2), x: +lx.toFixed(2), y: +((b.top - oy) / r).toFixed(2), geoFail,
      box: { left: +b.left.toFixed(4), top: +b.top.toFixed(4), width: +b.width.toFixed(4), height: +b.height.toFixed(4) },
      textU: null, figU: null, inlineAxis: 'x', ctx: L.parentElement ? desc(L.parentElement) : '', anc: [],
      gid: id, needPx: null, nText: 0, nFig: 0, symbolOnly: false, boxless: false, full: false, occluded: true,
      _el: L, _hosts: [] });
  }
  window.__guardGid = gid;
  // The rules behind an item, asked for by the caller once it knows the item fails.
  const byGid = new Map(out.map(it => [it.gid, it]));
  window.__guardRuleRefs = (id) => {
    const it = byGid.get(id);
    if (!it) return null;
    const lh = it._hosts.filter(h => h !== it._el);
    // Styled inline (a React style={{}}): no stylesheet rule says it, so name that.
    const inline = (e) => { const s = e.getAttribute('style') || ''; return /(height|padding|line-height|align|justify|display|place-)/.test(s) ? s.replace(/\s+/g, ' ').slice(0, 160) : null; };
    if (it.kind === 'layer') {
      const rs = rulesFor(it._el, LAYER_PROPS).map(rr => ({ at: `${rr.f}:${rr.l}`, spec: rr.spec, sel: rr.s.slice(0, 90), set: rr.p.filter(p => LAYER_PROPS.includes(p.split(':')[0])).join('; ').slice(0, 160) }));
      return { rules: rs, labelRules: [], labelEl: null, inlineStyle: (it._el.getAttribute('style') || '').replace(/\s+/g, ' ').slice(0, 160) || null, labelInlineStyle: null };
    }
    return { rules: ruleRefs(it._el), labelRules: lh.length ? ruleRefs(lh[0]) : [], labelEl: lh.length ? desc(lh[0]) : null,
      inlineStyle: inline(it._el), labelInlineStyle: lh.length ? inline(lh[0]) : null };
  };
  const plain = out.map(it => { const { _el, _hosts, ...rest } = it; return rest; });
  return { g: +g.toFixed(3), r: +r.toFixed(3), ox: +ox.toFixed(2), oy: +oy.toFixed(2), controls: plain };
}

// ── Pixel ink. Labels are captured with their text painted, then with it transparent; the
// difference is the label's painted ink. Batched per scan: one baseline capture of the viewport,
// then one capture per PASS — a set of controls whose boxes do not overlap, all turned
// transparent at once (a control and a badge inside it go in different passes).
let PNG = null;
try { PNG = require('../vite-app/node_modules/playwright-core/lib/utilsBundle.js').PNG; } catch {}
const decode = (buf) => PNG.sync.read(buf);
// In the page: freeze what follows currentColor (borders, rings, outlines, fills) so only the label
// changes, and keep the colour of what is not the label — icons (svg), decoration (an absolutely
// positioned badge), a filled figure (an avatar disc's initial); then turn the rest transparent.
function pxApply(ids) {
  if (!document.getElementById('guard-px-style')) {
    const st = document.createElement('style');
    st.id = 'guard-px-style';
    st.textContent = '[data-guard-px], [data-guard-px] *, [data-guard-px]::before, [data-guard-px]::after, [data-guard-px] *::before, [data-guard-px] *::after { transition: none !important; caret-color: transparent !important; }'
      + '[data-guard-px].guard-px-on, [data-guard-px].guard-px-on *, [data-guard-px].guard-px-on::before, [data-guard-px].guard-px-on::after, [data-guard-px].guard-px-on *::before, [data-guard-px].guard-px-on *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }';
    document.head.appendChild(st);
  }
  for (const id of ids) {
    const el = document.querySelector(`[data-guard-id="${id}"]`);
    if (!el) continue;
    const bb = el.getBoundingClientRect();
    const area = bb.width * bb.height;
    const notLabel = (n) => {
      if (n.closest('svg')) return true;
      for (let a = n; a && a !== el; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.position === 'absolute' || s.position === 'fixed') return true;
        const fill = (s.backgroundColor && !/rgba\(.*,\s*0\)$|transparent/.test(s.backgroundColor)) || s.backgroundImage !== 'none';
        if (fill) { const q = a.getBoundingClientRect(); if (q.width * q.height < area * 0.6) return true; }
      }
      return false;
    };
    for (const n of [el, ...el.querySelectorAll('*')]) {
      if ('__guardKeep' in n) continue;
      const cs = getComputedStyle(n);
      const keep = {};
      for (const k of ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'box-shadow', 'background-color', 'column-rule-color']) keep[k] = cs.getPropertyValue(k);
      if (notLabel(n)) { keep.color = cs.color; keep['-webkit-text-fill-color'] = cs.webkitTextFillColor || cs.color; keep.fill = cs.fill; keep.stroke = cs.stroke; }
      n.__guardKeep = n.getAttribute('style');
      for (const [k, v] of Object.entries(keep)) if (v) n.style.setProperty(k, v, 'important');
    }
    el.setAttribute('data-guard-px', '');
    el.classList.add('guard-px-on');
  }
}
function pxRestore(ids) {
  for (const id of ids) {
    const el = document.querySelector(`[data-guard-id="${id}"]`);
    if (!el) continue;
    // The colour comes back while [data-guard-px] still holds transitions off — removed together,
    // a `transition: color` on the control animates the label back from transparent, and WebKit
    // leaves it there once a screenshot's animations:'disabled' cancels the transition. The
    // attribute goes at the end of the pass (pxCleanup), after a style flush.
    el.classList.remove('guard-px-on');
    for (const n of [el, ...el.querySelectorAll('*')]) {
      if (!('__guardKeep' in n)) continue;
      if (n.__guardKeep == null) n.removeAttribute('style'); else n.setAttribute('style', n.__guardKeep);
      delete n.__guardKeep;
    }
    for (const n of [el, ...el.querySelectorAll('*')]) void getComputedStyle(n).color;
  }
}
const overlaps = (a, b) => a.left < b.left + b.width + 1 && b.left < a.left + a.width + 1 && a.top < b.top + b.height + 1 && b.top < a.top + a.height + 1;
async function pixelPass(p, items) {
  const out = new Map();
  if (!items.length || !PNG) return out;
  const passes = [];
  for (const it of items) {
    const ps = passes.find(ps => !ps.some(o => overlaps(o.box, it.box)));
    if (ps) ps.push(it); else passes.push([it]);
  }
  // Each capture is clipped to the boxes it is for (whole CSS px, so device pixels line up with
  // the baseline's): a 3x desktop viewport decodes to ~47MB, and a full capture per pass ran a
  // long desktop run out of memory ("Array buffer allocation failed").
  const clipOf = (its) => {
    const x0 = Math.max(0, Math.floor(Math.min(...its.map(i => i.box.left))) - 1);
    const y0 = Math.max(0, Math.floor(Math.min(...its.map(i => i.box.top))) - 1);
    const x1 = Math.min(W, Math.ceil(Math.max(...its.map(i => i.box.left + i.box.width))) + 1);
    const y1 = Math.min(H, Math.ceil(Math.max(...its.map(i => i.box.top + i.box.height))) + 1);
    return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
  };
  const shot = async (clip) => decode(await p.screenshot({ animations: 'disabled', caret: 'hide', clip }));
  await p.evaluate(pxApply, []); // the style sheet, before the baseline (it turns transitions off)
  await p.waitForTimeout(50);
  const baseClip = clipOf(items);
  let base = await shot(baseClip);
  const s = base.width / baseClip.width; // device px per CSS px
  for (const ps of passes) {
    const ids = ps.map(i => i.gid);
    const clip = clipOf(ps);
    await p.evaluate(pxApply, ids);
    await p.waitForTimeout(30);
    let img = await shot(clip);
    await p.evaluate(pxRestore, ids);
    // Device px of this capture's origin within the baseline's.
    const ox = Math.round((clip.x - baseClip.x) * s), oy = Math.round((clip.y - baseClip.y) * s);
    for (const it of ps) {
      const b = it.box;
      const X0 = Math.max(0, Math.floor((b.left - clip.x) * s)), Y0 = Math.max(0, Math.floor((b.top - clip.y) * s));
      const X1 = Math.min(img.width, Math.ceil((b.left + b.width - clip.x) * s)), Y1 = Math.min(img.height, Math.ceil((b.top + b.height - clip.y) * s));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let j = Y0; j < Y1; j++) for (let i = X0; i < X1; i++) {
        const k = (j * img.width + i) * 4, kb = ((j + oy) * base.width + i + ox) * 4;
        const d = Math.abs(base.data[kb] - img.data[k]) + Math.abs(base.data[kb + 1] - img.data[k + 1]) + Math.abs(base.data[kb + 2] - img.data[k + 2]);
        if (d > 60) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
      }
      if (Number.isFinite(x0)) out.set(it.gid, [clip.x + x0 / s, clip.y + y0 / s, clip.x + (x1 + 1) / s, clip.y + (y1 + 1) / s]);
    }
    img = null;
  }
  base = null;
  // Nothing may stay transparent: a re-render between apply and restore can strand a marker.
  const left = await p.evaluate(pxCleanup);
  if (left) pxLeftovers.push(left);
  return out;
}
const pxLeftovers = [];
function pxCleanup() {
  let n = 0;
  for (const el of document.querySelectorAll('.guard-px-on')) { el.classList.remove('guard-px-on'); n++; }
  for (const el of document.querySelectorAll('*')) {
    if (!('__guardKeep' in el)) continue;
    if (el.__guardKeep == null) el.removeAttribute('style'); else el.setAttribute('style', el.__guardKeep);
    delete el.__guardKeep; n++;
  }
  // Every label is back at its colour with transitions still off; now let them on again.
  for (const el of document.querySelectorAll('[data-guard-px]')) { for (const d of [el, ...el.querySelectorAll('*')]) void getComputedStyle(d).color; }
  for (const el of document.querySelectorAll('[data-guard-px]')) el.removeAttribute('data-guard-px');
  return n;
}
// The ink ascent of a string in a font (cap height for all caps), from canvas in the page.
async function inkAscent(p, font, text) {
  return p.evaluate(({ font, text }) => {
    const t = font.tt === 'uppercase' ? text.toUpperCase() : font.tt === 'lowercase' ? text.toLowerCase() : text;
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${font.style} ${font.weight} 200px ${font.family}`;
    const k = parseFloat(font.size) / 200;
    const allCaps = !/\p{Ll}/u.test(t) && /\p{Lu}/u.test(t);
    const symbol = !/[\p{L}\p{N}]/u.test(t);
    // A dash standing in for a value ("—" in an empty field) sits on the font's math axis, below
    // the middle of the capitals by design: its own ascent above the baseline locates the line.
    const DASHES = '-' + String.fromCharCode(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212);
    const dash = /\S/.test(t) && [...t].every(ch => /\s/.test(ch) || DASHES.includes(ch));
    return { asc: (allCaps ? c.measureText('H').actualBoundingBoxAscent : c.measureText(t).actualBoundingBoxAscent) * k, symbol,
      dash, dashAsc: c.measureText(t.trim()).actualBoundingBoxAscent * k, cap: c.measureText('H').actualBoundingBoxAscent * k };
  }, { font, text });
}

// At rest in LAYOUT, which no animation reports: a list that mounts its rows in batches, one per
// frame, and scrolls itself once they are all in. The desktop My Schedule pane does that
// (ScheduleView: 10 rows a frame, then a jump to today), landing 3-6 s after the Schedule opens
// under load: after the scan had read its date pills' boxes and while the pixel pass was capturing,
// so a pill's "ink" was the pane scrolling past it ("10 Oct" dx -1.56, on many runs), and a tap on
// one of its rows could time out on a row that would not hold still (the myschedule-* views not
// reached). Waits, at most 8 s, until the element count and every scroll offset hold still over
// three samples, each at least a frame and 200 ms apart.
async function settleLayout(p) {
  await p.evaluate(async () => {
    const t0 = performance.now();
    const sig = () => {
      const all = document.getElementsByTagName('*');
      let s = String(all.length);
      for (const el of all) if (el.scrollTop || el.scrollLeft) s += `|${el.scrollTop},${el.scrollLeft}`;
      return s + '|' + (document.scrollingElement ? document.scrollingElement.scrollTop : 0);
    };
    const frame = () => new Promise(r => requestAnimationFrame(r));
    let last = sig(), still = 0;
    while (still < 3 && performance.now() - t0 < 8000) {
      await Promise.all([frame(), new Promise(r => setTimeout(r, 200))]);
      const now = sig();
      still = now === last ? still + 1 : 0;
      last = now;
    }
  }).catch(() => {});
}

// The centring verdict from the label's ink (text union + figure union) against the box.
const unionOf = (bs) => bs.reduce((u, q) => [Math.min(u[0], q[0]), Math.min(u[1], q[1]), Math.max(u[2], q[2]), Math.max(u[3], q[3])], [Infinity, Infinity, -Infinity, -Infinity]);
function finalize(c) {
  const b = c.box, bx = b.left + b.width / 2, by = b.top + b.height / 2;
  const cx = (u) => +(((u[0] + u[2]) / 2) - bx).toFixed(2), cy = (u) => +(((u[1] + u[3]) / 2) - by).toFixed(2);
  const parts = [c.textU, c.figU].filter(Boolean);
  let dx = null, dy = null;
  if (parts.length) {
    const u = unionOf(parts);
    c.ink = u.map(v => +v.toFixed(2));
    dx = cx(u); dy = cy(u);
    // Icon BESIDE a label: the label is centred on its own axis too (an icon is not a licence to
    // seat the label low). Icon ABOVE a label (a tab bar): likewise sideways.
    if (c.textU && c.figU) {
      const t = c.textU, f = c.figU;
      const sideBySide = t[0] >= f[2] - 0.5 || t[2] <= f[0] + 0.5;
      const stacked = t[1] >= f[3] - 0.5 || t[3] <= f[1] + 0.5;
      if (sideBySide) { const d = cy(t); if (Math.abs(d) > Math.abs(dy)) dy = d; }
      if (stacked) { const d = cx(t); if (Math.abs(d) > Math.abs(dx)) dx = d; }
    }
  } else c.ink = null;
  c.dx = dx; c.dy = dy;
  const inkFail = [];
  const testX = c.kind === 'control' || c.kind === 'strip';
  const testY = c.kind !== 'tile';
  if (testX && dx != null && Math.abs(dx) > 0.75) inkFail.push('dx');
  if (testY && dy != null && Math.abs(dy) > 0.75) inkFail.push('dy');
  c.fail = [...c.geoFail, ...inkFail];
  if (c.kind === 'strip') {
    c.vertical = c.inlineAxis === 'y';
    c.along = c.vertical ? dy : dx;
    c.across = c.vertical ? dx : dy;
  }
}

(async () => {
  const b = await webkit.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const t = listOnly ? '' : token();
  // Signed in as the admin, past the first-run wizard (the onboarding view clears the flag).
  await ctx.addInitScript(({ t, u, overlay }) => {
    // --overlay screenshots show the grid lines without the cyan numeric readout over them.
    if (overlay) localStorage.setItem('gridReadout', 'off');
    if (sessionStorage.getItem('guard-signed-out')) return;
    localStorage.setItem('token', t); localStorage.setItem('username', u);
    localStorage.setItem('onboardComplete', '1'); localStorage.setItem('hasOnboarded', 'true');
    if (!sessionStorage.getItem('guard-onboarding')) localStorage.setItem('onboarded', '1');
  }, { t, u: USER, overlay });
  // Edit home: every view sees the default home whatever the account saved, and the sheet's
  // changes (and Reset) are answered here and never written, so the guard leaves the account's
  // home layout as it found it (scripts/home-states.mjs).
  if (!listOnly) await routeHomeLayout(ctx);
  // A WebKit page can crash under a long run (a 3x capture of a desktop viewport, view after view);
  // the view loop opens a new one and tries that view again.
  let p = await ctx.newPage();
  let crashed = false;
  p.on('crash', () => { crashed = true; });
  const reopen = async () => { await p.close().catch(() => {}); p = await ctx.newPage(); crashed = false; p.on('crash', () => { crashed = true; }); };
  const home = base + '/' + (overlay ? '?gridOverlay=1' : '');
  if (!listOnly) { await p.goto(home, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4000); }
  const desktop = !listOnly && await p.evaluate(() => !!document.querySelector('.app-shell.is-desktop'));
  const all = [];
  const visited = [], unreachable = [];
  let grid = null;
  const pxVerify = [];
  const notes = [];
  const run = async (view) => {
    await p.waitForTimeout(300);
    // Measure the view at rest. The scan reads boxes, then the pixel pass paints and reads ink: a
    // move still running between the two (the desktop event block's 320 ms open, pushing My
    // Schedule down 53r) pairs a box with another element's ink, a label "off centre" by tens of
    // px. Under load (WebKit at 3x, a frame every ~700 ms) the waits above can end with that open
    // not yet started (pending at t=0, 3 of 5 tries), so every finite animation and transition
    // still running is waited out, at most 3 s. Not one on an element with nothing inside it (a
    // late-reg fill's 1 s width tick restarts every second and holds no label), nor an infinite one.
    await p.evaluate(async () => {
      const t0 = performance.now();
      const moving = () => document.getAnimations().filter((a) => {
        const el = a.effect && a.effect.target;
        if (a.playState !== 'running' || !el || !Number.isFinite(a.effect.getComputedTiming().endTime)) return false;
        return el.childElementCount > 0 || !!(el.textContent || '').trim();
      });
      let waited = false;
      for (let m = moving(); m.length && performance.now() - t0 < 3000; m = moving()) {
        waited = true;
        await Promise.race([
          Promise.all(m.map(a => a.finished.catch(() => {}))),
          new Promise(r => setTimeout(r, Math.max(0, 3000 - (performance.now() - t0)))),
        ]);
      }
      if (waited) await new Promise(r => requestAnimationFrame(r));
    }).catch(() => {});
    await settleLayout(p);
    // A scrollIntoView can scroll an overflow:hidden ancestor of the whole app (the .app-shell),
    // lifting the top bar out of the viewport. Put it back, and say so: it is a bug of its own.
    const lifted = await p.evaluate(() => {
      const out = [];
      const bar = document.querySelector('.top-bar');
      for (let a = bar && bar.parentElement; a; a = a.parentElement) {
        if ((a.scrollTop || a.scrollLeft) && !/(auto|scroll)/.test(getComputedStyle(a).overflowY)) {
          out.push(`${a.tagName.toLowerCase()}.${String(a.className).trim().split(/\s+/).join('.')} scrolled ${a.scrollTop}px (overflow ${getComputedStyle(a).overflowY})`);
          a.scrollTop = 0; a.scrollLeft = 0;
        }
      }
      return out;
    });
    for (const l of lifted) notes.push({ view, note: l });
    if (await p.evaluate(() => !window.__guardRules)) await p.evaluate((rules) => { window.__guardRules = rules; }, RULES.map(r => ({ f: r.f, l: r.l, s: r.s, sel: r.sel, ctx: r.ctx, p: r.p })));
    const res = await p.evaluate(scan, { CONTROLS, INTERACTIVE, EXCLUDE, NOT_CONTROLS, TILES, START_ALIGNED, SWITCHES, STRIPS, ALIGN_PROPS, LAYER_PROPS, GROUP_CLASS_SRC: GROUP_CLASS.source, view });
    grid = grid || res;
    const pxItems = res.controls.filter(c => c.full && !c.occluded && (c.needPx || c.nText));
    const pxInk = await pixelPass(p, pxItems);
    for (const c of res.controls) {
      const canPx = c.full && !c.occluded;
      if (c.needPx && canPx) {
        // The whole label from pixels; across the line, ink ascent down from the ink's top edge.
        const ink = pxInk.get(c.gid);
        if (ink) {
          const m = c.needPx.text ? await inkAscent(p, c.font, c.needPx.text) : { asc: 0, symbol: true };
          if (c.kind === 'field' && m.dash) {
            // A form field's placeholder dash is text, held to the text convention: the capitals'
            // box on the baseline the dash's own ascent finds (its ink alone sits below centre).
            const bl = ink[1] + m.dashAsc;
            c.textU = [ink[0], bl - m.cap, ink[2], bl].map(v => +v.toFixed(4));
            c.inkFrom = 'pixels (dash as text)';
          } else {
            const bot = m.symbol || !m.asc ? ink[3] : Math.min(ink[3], ink[1] + m.asc);
            c.textU = [ink[0], ink[1], ink[2], bot].map(v => +v.toFixed(4));
            c.inkFrom = 'pixels';
          }
        } else c.inkFrom = 'none';
      } else if (c.nText && canPx) {
        // Along the line, the painted ink (canvas side bearings miss tabular figures, a fallback
        // font's ▾, kerning); across it, the cap-to-baseline convention from the font metrics.
        const ink = pxInk.get(c.gid);
        if (ink && c.textU && c.symbolOnly) {
          // A symbol (×, ←, ›, +) has no cap height or baseline to go by, and canvas may draw it in
          // another fallback font than the page: its painted ink, both axes.
          c.textU = ink.map(v => +v.toFixed(4));
          c.inkFrom = 'pixels (symbol)';
        } else if (ink && c.textU) {
          const m = c.textU.slice();
          if (c.inlineAxis === 'y') { c.textU[1] = +ink[1].toFixed(4); c.textU[3] = +ink[3].toFixed(4); }
          else { c.textU[0] = +ink[0].toFixed(4); c.textU[2] = +ink[2].toFixed(4); }
          c.inkFrom = 'metrics+pixels';
          if (verifyInk) {
            const A = c.inlineAxis === 'y' ? [1, 3] : [0, 2], B = c.inlineAxis === 'y' ? [0, 2] : [1, 3];
            // Across the line: pixels include descenders, so compare the edge away from them.
            const over = c.inlineAxis === 'y' ? Math.abs(ink[0] - m[0]) : Math.abs(ink[1] - m[1]);
            const along = Math.max(Math.abs(ink[A[0]] - m[A[0]]), Math.abs(ink[A[1]] - m[A[1]]));
            pxVerify.push({ view, el: c.el, text: c.text, kind: c.kind, metric: m, pixels: ink.map(x => +x.toFixed(2)), over: +over.toFixed(2), along: +along.toFixed(2) });
            void B;
          }
        } else c.inkFrom = 'metrics';
      } else c.inkFrom = c.needPx ? 'none (covered)' : 'metrics';
      finalize(c);
      if (c.fail.length) {
        const refs = await p.evaluate((id) => window.__guardRuleRefs && window.__guardRuleRefs(id), c.gid);
        if (refs) Object.assign(c, refs);
      }
      delete c.font;
    }
    all.push(...res.controls);
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await p.screenshot({ path: `${shots}/${W}x${H}-${view.replace(/[^\w-]+/g, '_')}.png` });
    }
  };
  let lastView = '';
  const scrollMain = async (n) => {
    for (let i = 0; i < n; i++) {
      await p.mouse.move(W / 2, H / 2);
      await p.mouse.wheel(0, H * 0.7);
      await p.waitForTimeout(500);
      await run(lastView + ' (scrolled)');
    }
  };
  const want = (v) => (!only || only.split(',').some(o => v.startsWith(o.trim()))) && !(skipViews && skipViews.split(',').some(o => v.startsWith(o.trim())));
  const nav = async (name) => {
    // Phone: the bottom nav. Desktop: the rail.
    const sel = desktop ? `.dk-rail-item:has-text("${name}")` : `.bottom-nav .nav-tab:has-text("${name}")`;
    await p.locator(sel).first().click({ timeout: 8000, force: overlay });
    await p.waitForTimeout(1800);
    await settleLayout(p);
  };
  const menu = async (name, railName) => {
    if (desktop) return nav(railName);
    await p.locator('.username-chip').first().click({ timeout: 8000 });
    await p.waitForTimeout(400);
    await p.getByRole('button', { name, exact: true }).first().click({ timeout: 8000 });
    await p.waitForTimeout(1800);
  };
  // The first VISIBLE match: the desktop keeps the phone's panels mounted and hidden.
  const click = async (sel, wait = 700, opts = {}) => {
    await p.locator(sel).filter({ visible: true }).first().click({ timeout: 8000, force: overlay || opts.force });
    await p.waitForTimeout(wait);
  };
  // Every view starts from a fresh load, so a panel or menu left open by the last one cannot
  // cover this one.
  const fresh = async () => {
    await p.goto(home, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 1000, force: overlay }).catch(() => {});
  };
  const views = [];
  const step = (view, fn, scrolls = 0, opts = {}) => views.push({ view, fn, scrolls, opts });

  // ── Views. Each opens from a fresh load; one that does not open is reported, not fatal.
  step('schedule', () => nav('Schedule'), 2);
  step('filters', async () => { await nav('Schedule'); await click('.filter-chip-square', 800); });
  step('card', async () => { await nav('Schedule'); await click('.cal-event-row:not(.open):not(.past) .cal-event-bar', 900); }, 1);
  step('myschedule', () => desktop ? nav('Schedule') : menu('My Schedule', 'Schedule'), 1);
  // The home scrolls (2026-10-12): its main column, and on desktop its second pane (the NUMBERS,
  // .dk-home-right), each paged to its foot. Then the Playing card's Scan sheet, opened as the
  // card's Scan button does it — a screenshot handed to the hidden picker — so the sheet's head and
  // the scanner's own button are measured (a scratch server has no scan key: it lands on the
  // scanner's idle state with its error line).
  const pageHome = async (n) => {
    for (let i = 1; i <= n; i++) {
      const moved = await p.evaluate((h) => {
        let any = false;
        for (const v of document.querySelectorAll('.tab-panel.tab-active .dashboard-view.home, .dk-home-right .dashboard-view.home')) {
          const sc = v.closest('.content-area, .dk-scroll');
          if (!sc) continue;
          const before = sc.scrollTop; sc.scrollTop = Math.min(sc.scrollHeight, sc.scrollTop + Math.round(h * 0.7));
          if (sc.scrollTop !== before) any = true;
        }
        window.scrollTo(0, 0);
        return any;
      }, H);
      if (!moved) break;
      await run(`${lastView} (home scrolled ${i})`);
    }
  };
  // Up Next's track is as tall as the card ON SHOW (home.css "HEIGHT"), so its dots or counter sit
  // right under it. A track taller than its card (the old tallest-of-all-slides rule left a hole of
  // up to 16r under a short card) is reported as a row of its own, failing 'fit' past 1px; dx is
  // the track's height less the card's, in px.
  const fitCheck = async (view) => {
    // The pointer off the counter first: a mouse over it holds the height still (fit.frozen).
    await p.mouse.move(0, 0);
    // The height's own transition (320ms), to its end: a busy renderer runs it late. Settled is no
    // transition running AND the same height on two polls 100ms apart (a lone 'nothing running'
    // read once measured a track still growing: 15.76r under a 16r card).
    await p.waitForTimeout(100);
    await p.waitForFunction(() => {
      const t = document.querySelector('.dashboard-view.home .dash-carousel-track');
      if (!t) return true;
      if (t.getAnimations().some((a) => a.playState === 'running')) { window.__fitH = null; return false; }
      const h = t.getBoundingClientRect().height, same = window.__fitH === h;
      window.__fitH = h;
      return same;
    }, null, { timeout: 4000, polling: 100 }).catch(() => {});
    const f = await p.evaluate(() => {
      const t = document.querySelector('.dashboard-view.home .dash-carousel-track');
      if (!t) return null;
      const i = Number(t.dataset.idx || 0), sl = t.children[i];
      if (!sl) return null;
      // The height the track settles at, not a frame of its ease there: a loaded renderer still
      // showed the last few px of the move after the wait above (17.14r over a 16r card).
      for (const a of t.getAnimations()) a.finish();
      // r off a 100r probe: the first step runs before any scan has measured the grid.
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
      document.body.appendChild(probe);
      const r = probe.getBoundingClientRect().height / 100;
      probe.remove();
      return { i, n: t.children.length, track: t.getBoundingClientRect().height, slide: sl.getBoundingClientRect().height, r };
    });
    if (!f) return;
    const r = (grid && grid.r) || f.r || 1;
    const off = +(f.track - f.slide).toFixed(2);
    all.push({ view, el: '.dash-carousel-track (height)', text: `card ${f.i + 1} of ${f.n}`, w: '-', h: +(f.track / r).toFixed(2), x: '-', y: '-',
      dx: off, dy: null, fail: Math.abs(off) > 1 ? ['fit'] : [], ctx: `the card on show, ${+(f.slide / r).toFixed(2)}r` });
  };
  // Scanned at the top, then paged to the foot (pageHome scans each page).
  step('dashboard', async () => { await nav('Dashboard'); await fitCheck('dashboard'); }, 0, {
    after: async () => { try { await pageHome(4); } catch (e) { console.log(`  (dashboard scroll skipped: ${e.message.split('\n')[0]})`); } },
  });
  step('dashboard-scan', async () => {
    await nav('Dashboard');
    await p.locator('.dash-scan-input').setInputFiles({ name: 'table.png', mimeType: 'image/png', buffer: TINY_PNG });
    await p.locator('.scan-sheet').waitFor({ timeout: 4000 });
    await p.waitForTimeout(2500); // the scan's request answers (503 without a key) and the idle state returns
  }, 0);
  // The home's Log menu (an admin's Log pill opens it; anyone else's opens the form in Results),
  // and a To log row turned into its Undo row by Didn't play. That write is answered here and
  // never sent: a guard must not change the account it signs in as (on :3001, the local DB).
  step('dashboard-logmenu', async () => {
    await nav('Dashboard');
    if (!(await p.locator('.hm-head-pill--log[aria-haspopup]').count())) throw new Error('no Log menu (not an admin: the pill opens the form)');
    await p.locator('.hm-head-pill--log').first().click({ timeout: 4000, force: overlay });
    await p.locator('.hm-logmenu').waitFor({ timeout: 3000 });
  }, 0);
  step('dashboard-tolog-undo', async () => {
    await nav('Dashboard');
    await p.route('**/api/schedule/*/played', (r) => r.fulfill({ json: { notPlayed: true } }));
    try {
      await p.locator('.hm-tolog-seg--quiet').first().click({ timeout: 4000, force: overlay });
      await p.locator('.hm-tolog-row.is-held').waitFor({ timeout: 3000 });
    } finally { await p.unroute('**/api/schedule/*/played'); }
  }, 0);
  // To log's "+N more" opened: every event waiting for a result, in place, and the pill turned
  // Fewer; scanned at the top, then paged to the foot.
  step('dashboard-tolog-more', async () => {
    await nav('Dashboard');
    const more = p.locator('.hm-tolog .hm-head-pill');
    if (!(await more.count())) throw new Error('two or fewer events to log (no +N more)');
    await more.first().click({ timeout: 4000, force: overlay });
    await p.locator('.hm-tolog-list > li:nth-child(3)').waitFor({ timeout: 3000 });
  }, 0, { after: () => pageHome(4) });
  // Up Next's plans, resolved (home step 5): the carousel paged to each card that carries a plan's
  // tag ('If bust #12', 'On: busted #12', 'Off: busted #12', 'If up $5,000'), each measured. Then
  // the running cash session's card (admins; the first card) turned into its stack entry by Update
  // stack — nothing is sent.
  const pageCarousel = async (i) => {
    const dots = p.locator('.dash-upnext-dot');
    if (await dots.count()) { await dots.nth(i).click({ timeout: 4000, force: overlay }); }
    else {
      // Step until the track says it is there (a click can land mid-render and be lost).
      const at = () => p.evaluate(() => Number(document.querySelector('.dash-carousel-track')?.dataset.idx || 0));
      for (let n = 0; n < 80 && (await at()) < i; n++) {
        await p.locator('.dash-upnext-step[aria-label="Next event"]').first().click({ timeout: 4000, force: overlay });
        await p.waitForTimeout(80);
      }
    }
    await p.waitForTimeout(700); // the slide's transition
  };
  // Every card of the carousel, paged to in turn, each one scanned in full (its badges, its plan
  // tags, the Playing card's Scan / Update / Bag / Bust, the Bagged card's badge and undo key) and
  // its fit measured. Only the card on show is measured: the others are inert and hidden at rest.
  // (Until 2026-10-13 only the first card and the cards with a plan were scanned, so for an admin,
  // whose first card is the cash session, the Playing and Bagged cards never were.)
  step('dashboard-carousel', async () => {
    await nav('Dashboard');
    const n = await p.evaluate(() => document.querySelectorAll('.dashboard-view.home .dash-carousel-slide').length);
    if (n < 2) throw new Error('fewer than two cards');
    for (let i = 0; i < n; i++) {
      if (i) await pageCarousel(i);
      await fitCheck('dashboard-carousel');
      const kind = await p.evaluate((k) => {
        const c = document.querySelectorAll('.dashboard-view.home .dash-carousel-slide')[k];
        const card = c && c.firstElementChild;
        if (!card) return '';
        if (card.classList.contains('hm-cash-card')) return 'cash';
        return [...card.classList].filter((x) => x !== 'dash-event-card').join('.') || 'plain';
      }, i);
      await run(`dashboard-carousel (card ${i + 1}: ${kind})`);
    }
  }, 0, { selfRun: true });
  // A page turn to a TALLER card with the mouse still on the pager (the dots, or the counter's ›):
  // the track grows to it (it holds still only against a shorter one), so nothing on the card is cut
  // or covered by the pager. Reported as one row per turn: dx is the track's height less the card's
  // (px; below −1 fails 'held'), and each control on the card must be the element under its own
  // centre (fails 'covered' otherwise: the pager's ‹ used to sit over a hidden Update).
  step('dashboard-held', async () => {
    await nav('Dashboard');
    const hs = await p.evaluate(() => [...document.querySelectorAll('.dashboard-view.home .dash-carousel-slide')].map((s) => s.getBoundingClientRect().height));
    // r off a 100r probe (this view can run alone, before any scan has measured the grid).
    const rr = (grid && grid.r) || await p.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
      document.body.appendChild(probe);
      const r = probe.getBoundingClientRect().height / 100;
      probe.remove();
      return r;
    }) || 1;
    const i = hs.findIndex((h, k) => k + 1 < hs.length && hs[k + 1] > h + rr / 2);
    if (i < 0) throw new Error('no card taller than the one before it');
    if (i) await pageCarousel(i);
    await p.mouse.move(0, 0);
    await p.waitForTimeout(700);
    const dots = p.locator('.dash-upnext-dot');
    if (await dots.count()) await dots.nth(i + 1).click({ timeout: 4000, force: overlay });
    else await p.locator('.dash-upnext-step[aria-label="Next event"]').first().click({ timeout: 4000, force: overlay });
    // The pointer stays on the pager: the transitions run out with it held.
    await p.waitForTimeout(900);
    const f = await p.evaluate(() => {
      const t = document.querySelector('.dashboard-view.home .dash-carousel-track');
      for (const a of t.getAnimations()) a.finish();
      const k = Number(t.dataset.idx || 0), sl = t.children[k];
      const card = sl.getBoundingClientRect();
      const covered = [];
      for (const b of sl.querySelectorAll('button')) {
        const q = b.getBoundingClientRect();
        if (q.width < 1 || q.height < 1 || q.bottom <= 0 || q.top >= innerHeight) continue;
        const at = document.elementFromPoint((q.left + q.right) / 2, (q.top + q.bottom) / 2);
        if (!at || !(b === at || b.contains(at))) covered.push((b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 24) + ' under ' + (at ? at.className || at.tagName : 'nothing'));
      }
      return { k, n: t.children.length, track: t.getBoundingClientRect().height, slide: card.height, covered };
    });
    const off = +(f.track - f.slide).toFixed(2);
    const fail = [...(off < -1 ? ['held'] : []), ...(f.covered.length ? ['covered'] : [])];
    all.push({ view: 'dashboard-held', el: '.dash-carousel-track (pager held)', text: `card ${f.k + 1} of ${f.n}`, w: '-', h: +(f.track / rr).toFixed(2), x: '-', y: '-',
      dx: off, dy: null, fail, ctx: f.covered.length ? f.covered.join('; ') : `the card on show, ${+(f.slide / rr).toFixed(2)}r` });
    await run('dashboard-held');
  }, 0, { selfRun: true });
  step('dashboard-cash-entry', async () => {
    await nav('Dashboard');
    if (!(await p.locator('.hm-cash-card').count())) throw new Error('no cash session running (the first Up Next card of an admin)');
    await fitCheck('dashboard-cash-entry');
    await p.locator('.hm-cash-card .hm-cash-btn').first().click({ timeout: 4000, force: overlay });
    await p.locator('.hm-cash-entry').waitFor({ timeout: 3000 });
    await fitCheck('dashboard-cash-entry');
  }, 0);
  // The home's NUMBERS in the states the account does not show by itself (scripts/home-states.mjs):
  // trip mode, series mode, and the edge state (the longest signal pill over an empty month and an
  // empty Last result), each staged by answering the home's requests in the page, then paged to the
  // foot like the plain home.
  // ready: a selector the state must show before it is measured (the noise line loads after the
  // first paint; an account without it, not an admin, skips the state).
  // (selfRun: the state is scanned while staged; the routes come off before the next view.)
  const homeState = (view, kind, ready = null) => step(view, async () => {
    const undo = await stageHome(p, kind);
    try {
      await fresh(); await nav('Dashboard');
      if (ready) await p.locator(ready).first().waitFor({ state: 'attached', timeout: 6000 }).catch(() => { throw new Error(`no ${ready} (the noise line is an admin's)`); });
      await run(view); await pageHome(4);
    } finally { await undo(); }
  }, 0, { selfRun: true });
  homeState('dashboard-trip', 'trip');
  homeState('dashboard-series', 'series');
  homeState('dashboard-edge', 'edge');
  // Nothing scheduled, nothing in play, no cash session: Up Next's one 5r prompt.
  homeState('dashboard-empty', 'empty');
  // The signal-or-noise line (home step 6; admins) in the states the account does not show by
  // itself: progress under 30 entries, and a sentence about cash. (Its tournament sentence is on the
  // plain home, its long-run one in the edge state.) The Analytics sheet the line opens is not
  // walked here: its Done label is seated on +3r of its 4r box, not centred (AnalyticsView predates
  // the rule), which is the control sweep's to fix; check-text-clipping walks the sheet.
  homeState('dashboard-noise-progress', 'noise-progress', '.hm-noise[data-kind="progress"]');
  homeState('dashboard-noise-cash', 'noise-cash', '.hm-noise[data-kind="window"]');
  // Edit home (HomeEditSheet.jsx; utils/home-layout.js). The sheet as the home's own control opens
  // it: every row (handle, name, the Move up / Move down pair, the switch), This month's parts,
  // Done and Reset to default (disabled on the default home). On desktop it is grouped NOW | NUMBERS
  // and docked to the shell's right edge. Then Reset pressed on a custom layout (its Undo reset
  // label), the home in that custom layout paged to its foot, and (desktop) every NUMBERS section
  // hidden: the pane's EDIT prompt. Layouts are staged by answering GET /api/user/home-layout; the
  // sheet's PUTs are answered by the context route above.
  const openEdit = async () => {
    await p.locator('.hm-edit').filter({ visible: true }).first().click({ timeout: 8000, force: overlay });
    await p.locator('.he-sheet .he-card').first().waitFor({ timeout: 8000 });
    await p.waitForTimeout(700);
  };
  step('dashboard-edit', async () => { await nav('Dashboard'); await openEdit(); }, 0);
  step('dashboard-edit-reset', async () => {
    const undo = await stageHome(p, 'layout-custom');
    try {
      await fresh(); await nav('Dashboard'); await openEdit();
      await p.locator('.he-reset').click({ timeout: 4000, force: overlay });
      await p.locator('.he-reset:has-text("Undo reset")').waitFor({ timeout: 3000 });
      await run('dashboard-edit-reset');
    } finally { await undo(); }
  }, 0, { selfRun: true });
  homeState('dashboard-custom', 'layout-custom');
  if (desktop) homeState('dashboard-numbers-empty', 'layout-numbers-empty', '.hm-numbers-empty');
  step('hands-scanner', async () => {
    await nav('Hands');
    await p.locator('.hands-tool-row button:has-text("Scanner")').first().click({ timeout: 4000, force: overlay });
    await p.waitForTimeout(800);
  }, 0);
  step('social', () => menu('Social', 'Social'), 1);
  step('results', () => nav('Bankroll'), 1);
  // Results > Delete results (components/ResetResults.jsx), at the foot of the results list:
  // closed, then open with the phrase typed so its Delete button is enabled. The content area is
  // scrolled, not the window (see toExpenses below).
  const toReset = async () => {
    await nav('Bankroll');
    await p.locator('.rr').first().waitFor({ timeout: 4000 });
    await p.evaluate(() => {
      const ca = document.querySelector('.content-area') || document.scrollingElement;
      const s = document.querySelector('.rr');
      ca.scrollTop += s.getBoundingClientRect().top - ca.getBoundingClientRect().top - 40;
      window.scrollTo(0, 0);
    });
    await p.waitForTimeout(500);
  };
  step('results-reset', toReset, 0);
  step('results-reset-open', async () => {
    await toReset();
    await p.locator('.rr .bk-btn--danger').first().click({ timeout: 4000, force: overlay });
    await p.waitForTimeout(300);
    await p.locator('.rr-input').fill(await p.locator('.rr-label b').innerText());
    await p.waitForTimeout(300);
  }, 0);
  step('settings', async () => {
    await menu('Settings', 'Settings');
    // Without a share link (settings-share has one): its Generate button.
    const revoke = p.locator('.settings-inline-row button:has-text("Revoke")').filter({ visible: true });
    if (await revoke.count()) { await revoke.first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(800); }
  }, 2);
  step('cash-live', () => nav('Cash'), 1);
  step('cash-heatmaps', async () => { await nav('Cash'); await click('.cash-mode-tabs button:has-text("Heatmaps")', 1500); }, 1);
  step('hands', () => nav('Hands'), 1);
  step('calendar', async () => { await nav('Schedule'); await click('.filter-chip-square[title="Calendar view"]', 1500); }, 1);
  step('calendar-filters', async () => {
    await nav('Schedule');
    await click('.filter-chip-square[title="Calendar view"]', 1500);
    await click('.filter-chip-square:not([title]):visible', 800);
  });
  step('bankrolls', async () => { await nav('Bankroll'); await click('.bk-head-btn', 800); });
  // The bankroll dashboard (the bankroll strip's Dashboard button). A tab is found by its label
  // among the strip's radios (.bd-tabs: the strip's page chevrons are buttons too); when the tabs
  // outgrow 35g the strip is a row that scrolls sideways, and the click scrolls it there.
  const dash = async (tab) => {
    await nav('Bankroll');
    await click('.bk-head-btn:has-text("Dashboard")', 1500);
    if (tab) await click(`.an-sheet .bd-tabs [role="radio"]:has-text("${tab}")`, 600);
  };
  // The Overview: hero, graph, the collapsible table sections (Summary, Sessions, Games, Rooms,
  // Bankroll, By month) and the latest sessions. First with every section opened by its header
  // (every table measured, scrolled to the end), then every section closed (each header then
  // carries its headline figure). The open state is remembered per device, so it is set by clicks.
  const sections = async (expanded) => {
    const want = expanded ? 'false' : 'true';
    for (let i = 0; i < 12; i++) {
      const head = p.locator(`.an-sheet .ovt-head[aria-expanded="${want}"]`).first();
      if (!(await head.count())) break;
      await head.click({ timeout: 4000, force: overlay });
      await p.waitForTimeout(450);   // the body's 0fr <-> 1fr transition (--dur-base)
    }
    if (await p.locator(`.an-sheet .ovt-head[aria-expanded="${want}"]`).count()) throw new Error('a section did not toggle');
    // Then until every collapse has finished (on a slow frame the last can outlast the wait above).
    await p.waitForFunction(() => {
      const o = document.querySelector('.an-sheet .ovt');
      return !o || !o.getAnimations || o.getAnimations({ subtree: true }).length === 0;
    }, null, { timeout: 5000 });
    await p.evaluate(() => { const s = document.querySelector('.an-sheet .an-body'); if (s) s.scrollTop = 0; });
  };
  step('bankroll-dashboard', async () => { await dash(null); await sections(true); }, 12);
  step('bankroll-dashboard-closed', async () => { await dash(null); await sections(false); }, 3);
  step('bankroll-rules', () => dash('Rules'), 2);
  step('bankroll-goals', () => dash('Goals'), 1);
  // Sessions: the list (chips, year pills, rows; scrolled past the next year), a filter on (Cash),
  // and the read-only detail of a tournament and of a cash session (its stack graph), scrolled
  // through. The type filter is remembered per device, so each view sets it by clicking.
  const sessionsTab = async (...steps) => {
    await dash('Sessions');
    await p.locator('.an-sheet .bs-row').first().waitFor({ timeout: 8000 });
    for (const sel of steps) await click(sel, 700);
  };
  step('bankroll-sessions', () => sessionsTab('.an-sheet .bs-chip:has-text("All")'), 10);
  // The list's foot: its last year pill and the Show more button (past the first 150 rows).
  step('bankroll-sessions-foot', async () => {
    await sessionsTab('.an-sheet .bs-chip:has-text("All")');
    await p.evaluate(() => { const s = document.querySelector('.an-sheet .an-body'); if (s) s.scrollTop = s.scrollHeight; });
    await p.waitForTimeout(400);
  });
  step('bankroll-sessions-cash', () => sessionsTab('.an-sheet .bs-chip:has-text("Cash")'), 2);
  step('bankroll-sessions-tournament', () => sessionsTab('.an-sheet .bs-chip:has-text("Tournaments")', '.an-sheet .bs-row'), 3);
  step('bankroll-sessions-cash-detail', () => sessionsTab('.an-sheet .bs-chip:has-text("Cash")', '.an-sheet .bs-row'), 3);
  // The tab strip with its last tab selected: scrolled to its end when it scrolls, so the start's
  // page chevron is up (the Overview's step has the end's).
  step('bankroll-tabs-end', async () => {
    await dash(null);
    await click('.an-sheet .bd-tabs button[role="radio"]:last-of-type', 900);
  }, 0);
  // Locations: the range and sort strips and the cards; a card open on its results (the first room
  // with a pager: more than ten results, the biggest first by default sort), its pager scrolled into
  // view before and after a page (Show 50 more or Show all, then Show fewer beside it), then the
  // cards sorted by name.
  step('bankroll-locations', () => dash('Locations'), 3);
  const openPaged = async () => {
    await dash('Locations');
    const cards = p.locator('.an-sheet .bl-card');
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      await cards.nth(i).click({ timeout: 4000, force: overlay });
      await p.waitForTimeout(300);
      if (await p.locator('.bl-pager').count()) return;
      await cards.nth(i).click({ timeout: 4000, force: overlay });
    }
    throw new Error('no room with more than ten results');
  };
  const pagerInView = async () => {
    await p.evaluate(() => document.querySelector('.bl-pager').scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(400);
  };
  step('bankroll-location-open', openPaged, 2);
  step('bankroll-location-pager', async () => { await openPaged(); await pagerInView(); }, 0);
  step('bankroll-location-paged', async () => {
    await openPaged();
    await pagerInView();
    await click('.bl-pager .bl-more', 500);
    await pagerInView();
  }, 0);
  step('bankroll-location-sort', async () => {
    await dash('Locations');
    await click('.bl-sort [role="radio"]:has-text("Name")', 400);
  }, 2);
  // Backers (read-only, the owner's backers as their pages show them): the list (a card is the
  // Locations card with an actions row, Copy link and Open page, under it), every card open on its
  // last ten shares (a history of none, one, two and more than ten, with its count line), and the
  // empty and refused states. The last two are staged: the route is answered here and never sent.
  // A card is a list row, so its text is seated (NOT_CONTROLS lists .bl-card); the two buttons in
  // each card are controls.
  const backersTab = async (answer) => {
    if (answer) await p.route('**/api/staking/standing/backers', (r) => r.fulfill(answer));
    try {
      await dash('Backers');
      await p.locator('.an-sheet .bb-backers .bl-item, .an-sheet .bb-backers .an-p.bl-gap').first().waitFor({ timeout: 8000 });
    } finally { if (answer) await p.unroute('**/api/staking/standing/backers'); }
  };
  step('bankroll-backers', () => backersTab(), 2);
  step('bankroll-backers-open', async () => {
    await backersTab();
    const shut = p.locator('.an-sheet .bb-item .bl-card[aria-expanded="false"]');
    for (let k = await shut.count(); k > 0; k--) {
      await shut.first().click({ timeout: 4000, force: overlay });
      await p.waitForTimeout(250);
    }
    if (await p.locator('.an-sheet .bb-item .bl-card[aria-expanded="false"]').count()) throw new Error('a card did not open');
  }, 4);
  step('bankroll-backers-empty', () => backersTab({ status: 200, json: { backers: [] } }), 0);
  step('bankroll-backers-refused', () => backersTab({ status: 403, json: { error: 'Forbidden' } }), 0);
  // The dashboard import's review (Bankroll › Dashboard › Import › From the dashboard app;
  // docs/bankroll-merge.md §9.3). Owner only, so the server's CONSOLE_OWNER_USER_ID must be the
  // guard's account, with a STAGED run on it: scripts/seed-money-import-demo.js on the scratch
  // database (the owner's rows here, so there are pairs, and a staged run), then the server booted
  // with LEDGER_TOKEN and DASHBOARD_BASE_URL at scripts/money-import-stub-dashboard.js so a fetch
  // works. The walk ANSWERS every pair, opens the confirm steps, IMPORTS, UNDOES (refused once by a
  // row edited through the app's own route, then through) and fetches again, so the same run is
  // back for the next size; with the pull off the later views are reported as not reached at the
  // second size. Never against :3001.
  const importOpen = async () => {
    await dash('Import');
    await p.locator('.an-sheet .bid').first().waitFor({ timeout: 8000 });
    await p.waitForTimeout(600);
  };
  const importReview = async () => {
    await importOpen();
    await p.locator('.an-sheet .bid-review').first().waitFor({ timeout: 8000 });
  };
  const importSaved = async () => {
    await p.waitForFunction(() => ![...document.querySelectorAll('.an-sheet .bid-state')].some((s) => /Saving/.test(s.textContent)), null, { timeout: 60000 });
    await p.waitForTimeout(500);
  };
  // Every pair answered (the Likely ones filled, each Possible one's first answer), so Import opens.
  const importAnswered = async () => {
    await importReview();
    const fill = p.locator('.an-sheet .bid-group button:has-text("Fill the likely ones")');
    if (await fill.count() && await fill.first().isEnabled()) { await fill.first().click({ force: overlay }); await p.waitForTimeout(300); }
    for (const seg of await p.locator('.an-sheet .bid-pair-seg').all()) {
      if (await seg.locator('[aria-checked="true"]').count()) continue;
      await seg.locator('[role="radio"]').first().click({ force: overlay });
      await p.waitForTimeout(150);
    }
    await importSaved();
  };
  const sheetTo = async (sel) => {
    await p.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollIntoView({ block: 'center' }); }, sel);
    await p.waitForTimeout(400);
  };
  const sheetTop = async () => { await p.evaluate(() => { const s = document.querySelector('.an-sheet .an-body'); if (s) s.scrollTop = 0; }); await p.waitForTimeout(300); };
  step('bankroll-import-dashboard', importOpen, 1);
  step('bankroll-import-dashboard-review', importReview, 14);
  // A pair card tapped open (its long values whole), then Import's confirm step and Discard's.
  step('bankroll-import-dashboard-confirm', async () => {
    await importAnswered();
    await p.locator('.an-sheet .bid-pair .bid-pair-fields').first().click({ force: overlay });
    await p.waitForTimeout(400);
    await sheetTo('.an-sheet .bid-pair');
    await run('bankroll-import-dashboard-confirm (a pair open)');
    await click('.an-sheet .bid-commit .bk-btn--brand', 600);
    await sheetTo('.an-sheet .bid-confirm');
    await run('bankroll-import-dashboard-confirm (import)');
    await scrollMain(2);
    await click('.an-sheet .bid-confirm button:has-text("Cancel")', 400);
    await click('.an-sheet .bid-commit button:has-text("Discard")', 600);
    await sheetTo('.an-sheet .bid-confirm');
    await run('bankroll-import-dashboard-confirm (discard)');
    await click('.an-sheet .bid-confirm button:has-text("Keep")', 400);
  }, 0, { selfRun: true });
  // The import done: its summary paged; Undo's typed-count form; the undo refused by a row edited
  // since (each row with where it lives and Open in Results); that row deleted and the undo
  // through; then a fetch, so the run is back.
  step('bankroll-import-dashboard-imported', async () => {
    await importAnswered();
    await click('.an-sheet .bid-commit .bk-btn--brand', 600);
    await click('.an-sheet .bid-confirm .bk-btn--brand', 1500);
    await p.locator('.an-sheet .bid-summary').first().waitFor({ timeout: 90000 });
    await p.waitForTimeout(600);
    await sheetTop();
    await run('bankroll-import-dashboard-imported');
    await scrollMain(6);
    // A cash session the import wrote (the fixtures' Wynn night), edited through the app's own
    // route: what blocks the undo.
    const edited = await p.evaluate(async () => {
      const h = { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' };
      const list = await fetch('/api/cash-sessions', { headers: h }).then((r) => r.json()).catch(() => null);
      const rows = list && Array.isArray(list.sessions) ? list.sessions : [];
      const row = rows.find((s) => Object.values(s).some((v) => typeof v === 'string' && /wynn/i.test(v)));
      if (!row) return null;
      const r = await fetch(`/api/cash-sessions/${row.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ notes: 'guard: edited after the import' }) });
      return r.ok ? row.id : null;
    });
    await click('.an-sheet button:has-text("Undo this import")', 600);
    const label = await p.locator('.an-sheet form.bid-confirm .bk-field-label').first().innerText();
    await p.locator('.an-sheet form.bid-confirm input').fill((label.match(/\d[\d,]*/) || [''])[0].replace(/,/g, ''));
    await sheetTo('.an-sheet form.bid-confirm');
    await run('bankroll-import-dashboard-imported (undo form)');
    await scrollMain(1);
    await click('.an-sheet form.bid-confirm button[type="submit"]', 1500);
    if (edited != null) {
      await p.locator('.an-sheet .bid-undo-err').first().waitFor({ timeout: 60000 });
      await sheetTo('.an-sheet .bid-undo-err');
      await run('bankroll-import-dashboard-imported (undo refused)');
      await scrollMain(1);
      await p.evaluate((id) => fetch(`/api/cash-sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }), edited);
      await click('.an-sheet form.bid-confirm button[type="submit"]', 1500);
    } else notes.push({ view: 'bankroll-import-dashboard-imported', note: 'no imported Wynn cash session to edit, so the refused undo was not measured' });
    await p.locator('.an-sheet .bid-summary').waitFor({ state: 'detached', timeout: 60000 });
    await sheetTop();
    await run('bankroll-import-dashboard-imported (undone)');
    const again = p.locator('.an-sheet .bid button:has-text("Fetch from the dashboard")').first();
    if (await again.isEnabled()) {
      await again.click({ force: overlay });
      await p.locator('.an-sheet .bid-review').first().waitFor({ timeout: 90000 }).catch(() => {});
    } else notes.push({ view: 'bankroll-import-dashboard-imported', note: 'the pull is off, so the run was not fetched again: the review views need a fresh seed before the next size' });
  }, 0, { selfRun: true });
  // Reports: the filter bar, the report picker and a table; then its filter sheet (over the
  // dashboard) with a filter on, so selected and disabled chips are both measured.
  step('bankroll-reports', () => dash('Reports'), 3);
  step('bankroll-report-filters', async () => {
    await dash('Reports');
    await click('.br-bar .bk-btn', 800);
    await click('.br-fsheet .br-chip:has-text("Cash")', 400);
  }, 3);
  step('bankroll-import', async () => {
    await dash('Import');
    await click('.an-sheet button:has-text("Import CSV")', 300);
    await p.locator('.an-sheet input[type=file]').setInputFiles({
      name: 'check.csv', mimeType: 'text/csv',
      buffer: Buffer.from(['Date,Event,Buy-in,Winnings', '2024-03-02,Check Event,215,0', '2024-03-09,Check Event,215,900', ''].join('\n')),
    });
    await p.waitForTimeout(500);
  }, 2);
  // The floating + on the bankroll pages (components/BankrollFab.jsx): on the Results tab (the page's,
  // in the main pane on desktop; 2r over the live cash bar while the seed's session runs, 2r over the
  // nav without one) and inside the dashboard sheet, each closed and with its menu open. The menu is
  // a portalled panel of 5r rows (a layer), its right edge on the +. Opened by the + itself, so the
  // click also proves it is a real button that takes a tap.
  const openFab = async (sel) => {
    await click(sel, 500);
    await p.locator('.bk-fab-menu').waitFor({ timeout: 3000 });
  };
  step('bankroll-fab', () => nav('Bankroll'), 2);
  step('bankroll-fab-menu', async () => { await nav('Bankroll'); await openFab('.bk-fab--page'); }, 0);
  // No session running: the live fetch is answered here and never sent (a guard must not change the
  // account it signs in as), the + sits 2r over the nav, and the menu has its fourth row, Start live
  // session. The store keeps the answer once the route is gone.
  const idleFab = async (open) => {
    await p.route('**/api/cash-sessions/live', (r) => r.fulfill({ json: { session: null, stacks: [], now: new Date().toISOString() } }));
    try {
      await fresh();
      await nav('Bankroll');
      await p.locator('.bk-fab--page').waitFor({ timeout: 4000 });
      if (await p.locator('.cs-bar').count()) throw new Error('the cash bar is still up (the stub did not take)');
      if (open) await openFab('.bk-fab--page');
    } finally { await p.unroute('**/api/cash-sessions/live'); }
  };
  step('bankroll-fab-idle', () => idleFab(false), 0);
  step('bankroll-fab-idle-menu', () => idleFab(true), 0);
  step('bankroll-fab-sheet', () => dash(null), 2);
  step('bankroll-fab-sheet-menu', async () => { await dash(null); await openFab('.bk-fab--sheet'); }, 0);
  const cashHalf = async (...steps) => {
    await nav('Bankroll');
    await click('.results-kind-tabs button:has-text("Cash")', 1500);
    for (const sel of steps) await click(sel, 700);
  };
  const csBack = '.cs-head button:has-text("Sessions")';
  step('cash-sessions-live', () => cashHalf(), 2);
  step('cash-sessions-live-rebuy', () => cashHalf('.cs-livescreen button:has-text("Rebuy")'), 1);
  step('cash-sessions-live-end', () => cashHalf('.cs-livescreen button:has-text("Cash out")'), 2);
  step('cash-sessions', () => cashHalf(csBack), 2);
  step('cash-sessions-stats', () => cashHalf(csBack, '.cs-tabs button:has-text("Stats")'), 1);
  step('cash-sessions-detail', () => cashHalf(csBack, '.cs-row'), 2);
  step('cash-sessions-forms', () => cashHalf(csBack, '.cs-head button:has-text("Add")', '.cs-form-foot button'), 3);
  // The Backers block (components/BackerNotify.jsx, the Notify tap; the owner's, so CHECK_TOKEN must
  // be the owner's: CONSOLE_OWNER_USER_ID on a scratch server) under a tournament result's edit
  // form, on a cash session's page and on its edit screen: previewed (the server's own answer for
  // the seed's backers), sent, and with the warning's confirm open (Notify tapped). Sent and warning
  // are staged by notify-states.mjs, which answers the block's request in the page and never lets a
  // commit through, so no guard notifies anyone. The block is scrolled to the top of its scroller.
  // Registered before cash-bar, which puts the Results tab back on its Tournaments half (the half is
  // remembered per device, and the Results views after it need Tournaments). vis, tap, exists and
  // reveal are defined further down; the steps only run once everything is.
  const notifyOpen = async (where, kind) => {
    const unstage = kind ? await stageNotify(p, kind) : null;
    try {
      if (where === 'results') {
        await nav('Bankroll');
        if (await exists('.results-kind-tabs button:has-text("Tournaments"):not(.active)')) await tap('.results-kind-tabs button:has-text("Tournaments")', 900);
        const sel = '.tab-panel[data-tab="tracking"] .tracking-actions button:has-text("Edit"), .tracking-actions button:has-text("Edit")';
        await reveal(sel, 200);
        await tap(sel, 900);
      } else if (where === 'cash') {
        await cashHalf(csBack, '.cs-row');
      } else {
        await cashHalf(csBack, '.cs-row', '.cs-head button:has-text("Edit")');
      }
      await vis('.bn').first().waitFor({ timeout: 8000 });
      if (kind === 'warning') { await tap('.bn-row.has-warn .bn-btn--brand', 500); await vis('.bn-row-act[role="group"]').first().waitFor({ timeout: 3000 }); }
    } finally { if (unstage) await unstage(); }
    await reveal('.bn', 40);
  };
  step('results-notify', () => notifyOpen('results', null), 1);
  step('results-notify-sent', () => notifyOpen('results', 'sent'), 0);
  step('results-notify-warning', () => notifyOpen('results', 'warning'), 0);
  step('results-notify-none', () => notifyOpen('results', 'none'), 0);
  step('cash-notify', () => notifyOpen('cash', null), 1);
  step('cash-notify-sent', () => notifyOpen('cash', 'sent'), 0);
  step('cash-notify-warning', () => notifyOpen('cash', 'warning'), 0);
  step('cash-notify-edit', () => notifyOpen('cash-edit', null), 1);
  step('cash-bar', async () => { await cashHalf(); await click('.results-kind-tabs button:has-text("Tournaments")', 600); });
  const toExpenses = async () => {
    await nav('Bankroll');
    await p.locator('.tx-sec').first().waitFor({ timeout: 8000 });
    // Scroll the content area only (scrollIntoView would nudge the window off the .top-bar origin).
    await p.evaluate(() => {
      const ca = document.querySelector('.content-area') || document.scrollingElement;
      const s = document.querySelector('.tx-sec');
      ca.scrollTop += s.getBoundingClientRect().top - ca.getBoundingClientRect().top - 40;
      window.scrollTo(0, 0);
    });
    await p.waitForTimeout(500);
  };
  step('expenses', toExpenses);
  step('expense-add', async () => { await toExpenses(); await click('.tx-sec .bk-head-btn', 800); });
  step('expenses-all', async () => { await toExpenses(); await p.locator('.tx-sec .bk-actions .bk-btn').nth(1).click({ timeout: 8000 }); await p.waitForTimeout(800); });
  step('trip', async () => {
    await toExpenses();
    await p.locator('.tx-sec .bk-actions .bk-btn').nth(0).click({ timeout: 8000 });
    await p.waitForTimeout(600);
    await click('.tx-trip-row', 1000);
  });

  // ── 2026-10-11: every other view and state that has controls.
  // A second scan inside one view, under the same name (merged in the report).
  const also = (label) => run(`${lastView} (${label})`);
  const vis = (sel) => p.locator(sel).filter({ visible: true });
  const exists = async (sel) => (await vis(sel).count()) > 0;
  // force: a click without waiting for the element to hold still — the desktop replayer at 3x
  // paints so slowly that WebKit's frames never confirm a button stable within the timeout.
  const tap = async (sel, wait = 700, force = false) => { await vis(sel).first().click({ timeout: 8000, force: overlay || force }); await p.waitForTimeout(wait); };
  // Scroll the main content (not the window) so `sel` sits near the top of the viewport.
  const reveal = async (sel, margin = 60) => {
    const loc = vis(sel).first();
    await loc.waitFor({ timeout: 8000 });
    await loc.evaluate((el, margin) => {
      let sc = el.parentElement;
      while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
      sc = sc || document.scrollingElement;
      const top = sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top;
      sc.scrollTop += Math.round(el.getBoundingClientRect().top - top - margin);
      window.scrollTo(0, 0);
    }, margin);
    await p.waitForTimeout(500);
  };
  // A view the UI has no way into (Staking): set it the way the app's own components do, through
  // the onNavigate prop React hands them.
  const goView = async (v) => {
    const ok = await p.evaluate((v) => {
      for (const el of document.querySelectorAll('.tab-panel *, .dk-rail *')) {
        const k = Object.keys(el).find(k => k.startsWith('__reactFiber'));
        if (!k) continue;
        for (let f = el[k]; f; f = f.return) if (f.memoizedProps && typeof f.memoizedProps.onNavigate === 'function') { f.memoizedProps.onNavigate(v); return true; }
      }
      return false;
    }, v);
    if (!ok) throw new Error('no onNavigate to reach ' + v);
    await p.waitForTimeout(1800);
  };
  // Top bar: the user menu, notifications, the live-update panel and its tabs.
  step('user-menu', () => click('.username-chip', 600));
  step('notifications', () => click('.notif-btn', 900), 1);
  step('live-update', async () => {
    await click('.live-update-btn', 900);
    const tabs = await p.locator('.live-update-tab').count();
    for (let i = 1; i < tabs; i++) {
      await p.locator('.live-update-tab').nth(i).click({ timeout: 3000 }).catch(() => {});
      await p.waitForTimeout(500);
      await also('tab ' + (i + 1));
    }
  }, 1);
  // Schedule: the location dropdown, the filter sheet scrolled, an open card's conditional UI.
  step('location-dropdown', async () => { await nav('Schedule'); await tap('.filter-chip:not(.filter-chip-square)', 900); }, 1);
  step('filters-scrolled', async () => { await nav('Schedule'); await tap('.filter-chip-square', 800); }, 2);
  step('card-saved', async () => {
    await nav('Schedule');
    await tap('.cal-event-row.saved:not(.open):not(.past) .cal-event-bar', 900);
  }, 1);
  // My Schedule: an expanded card, its "if I bag / bust" panel, export, travel.
  const mySched = async () => {
    if (desktop) { await nav('Schedule'); return '.dk-pane:not(.dk-pane-list) '; }
    await menu('My Schedule', 'Schedule');
    return '.tab-panel[data-tab="schedule"] ';
  };
  step('myschedule-card', async () => { const s = await mySched(); await tap(s + '.cal-event-row:not(.open):not(.past) .cal-event-bar', 900); }, 1);
  step('myschedule-conditional', async () => {
    const s = await mySched();
    await tap(s + '.cal-event-row:not(.open):not(.past) .cal-event-bar', 900);
    await tap(s + '.cal-event-row.open .condition-btn', 900);
  }, 1);
  step('myschedule-conditional-set', async () => {
    const s = await mySched();
    // Not a past one: once the pane has landed on today (see settleLayout), the first conditional
    // row in the DOM is days above it, and Playwright's scroll into view leaves it "outside of the
    // viewport" until the 8 s timeout. Today's and later rows are where the list rests.
    await tap(s + '.cal-event-row.conditional:not(.open):not(.past) .cal-event-bar', 900);
  }, 1);
  step('myschedule-export', async () => { await mySched(); await tap('button[title="Export schedule"]', 900); }, 1);
  step('myschedule-travel', async () => { await mySched(); await tap('button:has-text("Travel")', 900); });
  // Calendar with a filter set: its pill (and clear ✕) in the bar, panel open and closed.
  step('calendar-filter-pill', async () => {
    await nav('Schedule');
    await tap('.filter-chip-square[title="Calendar view"]', 1500);
    await tap('.filter-chip-square:not([title])', 800);
    await tap('.cal-fp-chips button', 900);
    await also('panel');
    await tap('.cal-fp-save', 800);
    if (!(await exists('.cal-fp-pill'))) throw new Error('no filter pill');
  });
  // An open card in the admin's edit mode (overrides, strip colour, revert).
  step('card-admin-edit', async () => {
    await nav('Schedule');
    await tap('.cal-event-row:not(.open):not(.past) .cal-event-bar', 900);
    await tap('.cal-event-row.open .cal-action-btn:has-text("Edit")', 900);
  }, 2);
  // Calendar: another day, and a card open in it.
  step('calendar-day', async () => {
    await nav('Schedule');
    await tap('.filter-chip-square[title="Calendar view"]', 1500);
    await vis('.cal-date-btn').nth(3).click({ timeout: 8000 });
    await p.waitForTimeout(900);
    await also('day');
    await tap('.cal-event-row:not(.open) .cal-event-bar', 900);
  }, 1);
  // Dashboard: every Up Next card (the real carousel — the cash session, playing, bagged,
  // finished, not started — then the D toggle's demo cards), and the playing card's Bust menu and
  // its Update / Bag panels. (The results header's Reset and P&L dropdowns left the home with the
  // Results bar, home step 4; Delete results is walked in Results, results-reset.)
  // Counted by slide: the running cash session's card (an admin's first) is a slide, not an
  // event card.
  const upNextAll = async (tag) => {
    const n = Math.min(12, await p.locator('.dashboard-view.home .dash-carousel-slide').count() || await p.locator('.dash-event-card').count());
    for (let i = 1; i < n; i++) {
      const next = vis('.dash-upnext-step[aria-label="Next event"]').first();
      const dot = vis('.dash-upnext-dot').nth(i);
      if (await next.count() && !(await next.isDisabled().catch(() => true))) await next.click({ timeout: 3000 }).catch(() => {});
      else if (await dot.count()) await dot.click({ timeout: 3000, force: true }).catch(() => {});
      else break;
      await p.waitForTimeout(700);
      await also(`${tag} card ${i + 1}`);
    }
  };
  step('dashboard-upnext', async () => { await nav('Dashboard'); await also('card 1'); await upNextAll('real'); });
  step('dashboard-demo', async () => {
    await nav('Dashboard');
    await tap('.grid-dev-toggle:has-text("D")', 1200);
    await also('demo card 1');
    await upNextAll('demo');
  });
  // The Playing card, paged to first: the slides not on show are inert and hidden at rest, and an
  // admin's first card is the running cash session.
  const toPlaying = async () => {
    await nav('Dashboard');
    const i = await p.evaluate(() => [...document.querySelectorAll('.dashboard-view.home .dash-carousel-slide')]
      .findIndex((sl) => sl.querySelector('.dash-event-card.playing .dash-bust-btn')));   // not the cash card (.playing too)
    if (i > 0) await pageCarousel(i);
  };
  step('dashboard-bust-menu', async () => { await toPlaying(); await tap('.dash-event-card.playing .dash-bust-btn', 700); });
  step('dashboard-update', async () => { await toPlaying(); await tap('.dash-event-card.playing .dash-update-btn', 1000); }, 1);
  step('dashboard-bag', async () => { await toPlaying(); await tap('.dash-event-card.playing .dash-bag-btn', 1000); }, 1);
  // The venue map (VenueMapSheet.jsx, docs/venue-map.md): what a venue strip opens — a Schedule
  // card's strip, and an Up Next card's banner (the first card that has one, paged to). Measured
  // once its map has drawn, or the popup has said why not.
  const venueMapOpen = async () => {
    await p.locator('.vm-sheet').waitFor({ timeout: 8000 });
    await p.waitForFunction(() => {
      const c = document.querySelector('.vm-map-canvas'), n = document.querySelector('.vm-map-note');
      return (c && c.dataset.provider) || (n && !/Finding|Loading/.test(n.textContent));
    }, null, { timeout: 20000, polling: 200 }).catch(() => {});
    await p.waitForTimeout(500);
  };
  step('venue-map', async () => {
    await nav('Schedule');
    await tap('.cal-event-row:not(.past) .cal-venue-strip[aria-haspopup="dialog"]', 300);
    await venueMapOpen();
  });
  step('venue-map-upnext', async () => {
    await nav('Dashboard');
    const i = await p.evaluate(() => [...document.querySelectorAll('.dashboard-view.home .dash-carousel-slide')]
      .findIndex((sl) => sl.querySelector('.dash-venue-strip.has-map')));
    if (i < 0) throw new Error('no Up Next card with a venue map');
    if (i > 0) await pageCarousel(i);
    await tap('.dashboard-view.home .dash-venue-strip.has-map', 300);
    await venueMapOpen();
  });
  // Social: search, a buddy, a group (its chat), creating one.
  step('social-search', async () => { await menu('Social', 'Social'); await vis('.social-search-input').first().fill('j'); await p.waitForTimeout(1200); }, 1);
  step('social-buddy', async () => { await menu('Social', 'Social'); await tap('.social-buddy-card', 1200); }, 1);
  step('social-group', async () => { await menu('Social', 'Social'); await tap('.social-group-card', 1500); }, 1);
  step('social-create-group', async () => { await menu('Social', 'Social'); await tap('.social-new-btn', 900); });
  // A group's Members tab (invite, remove, the owner's leaderboard switch, delete); a buddy's
  // Add to Group and Remove Connection confirmations; a search that finds someone to connect to.
  step('social-group-members', async () => {
    await menu('Social', 'Social');
    await tap('.social-group-card', 1500);
    await tap('.group-segment-btn:has-text("Members")', 1000);
  }, 2);
  step('social-group-tabs', async () => {
    await menu('Social', 'Social');
    await tap('.social-group-card', 1500);
    for (const s of ['Schedule', 'Leaderboard']) {
      if (!(await exists(`.group-segment-btn:has-text("${s}")`))) continue;
      await tap(`.group-segment-btn:has-text("${s}")`, 1000);
      await also(s.toLowerCase());
    }
  }, 1);
  step('social-buddy-add', async () => {
    await menu('Social', 'Social');
    await tap('.social-buddy-card', 1200);
    await tap('.social-action-btn:has-text("Add to Group")', 800);
  }, 1);
  step('social-buddy-remove', async () => {
    await menu('Social', 'Social');
    await tap('.social-buddy-card', 1200);
    await tap('.social-action-btn:has-text("Remove Connection")', 800);
  }, 1);
  step('social-search-connect', async () => { await menu('Social', 'Social'); await vis('.social-search-input').first().fill('fresh'); await p.waitForTimeout(1500); }, 1);
  // Hands: every game family's picker, hand entry step by step, the replayer on a saved hand
  // (transport, settings, share).
  step('hands-games', async () => {
    await nav('Hands');
    const tabs = vis('.game-tab-btn');
    const n = await tabs.count();
    for (let i = 1; i < n; i++) { await tabs.nth(i).click({ timeout: 3000 }); await p.waitForTimeout(600); await also('family ' + (i + 1)); }
  });
  step('hands-entry', async () => {
    await nav('Hands');
    await tap('button:has-text("Create No Limit")', 1500);
    await also('step 1');
    for (let i = 2; i <= 6; i++) {
      const next = vis('.replayer-entry-view button:has-text("Next"), .replayer-entry-view button:has-text("Continue")').first();
      if (!(await next.count())) break;
      await next.click({ timeout: 3000 }).catch(() => {});
      await p.waitForTimeout(900);
      await also('step ' + i);
    }
  }, 1);
  // A bet being sized: Raise opens the sizing pills and the amount field.
  step('hands-entry-sizing', async () => {
    await nav('Hands');
    await tap('button:has-text("Create No Limit")', 1500);
    for (let i = 0; i < 4 && !(await exists('.gto-action-btn')); i++) {
      const next = vis('.replayer-entry-view button:has-text("Next"), .replayer-entry-view button:has-text("Continue")').first();
      if (!(await next.count())) break;
      await next.click({ timeout: 3000 }).catch(() => {});
      await p.waitForTimeout(900);
    }
    await tap('.gto-action-btn:has-text("Raise")', 900);
    if (!(await exists('.gto-sizing-pill'))) throw new Error('no sizing pills after Raise');
  }, 1);
  step('hands-entry-plo', async () => {
    await nav('Hands');
    await tap('.game-fave-btn:has-text("PLO")', 600);
    await tap('button:has-text("Create ")', 1500);
  }, 1);
  // The admin's Hands tools (the second footer row): each view as it renders against this server
  // (without a solver, its error and empty states).
  for (const [id, label] of [['solver', 'Solver'], ['solver-trainer', 'Solver Trainer'], ['watch-solver', 'Watch Solver'], ['trainer', 'Trainer'], ['3-way', '3-Way']]) {
    step('hands-tool-' + id, async () => { await nav('Hands'); await tap(`.hands-tool-row button:text-is("${label}")`, 2000); }, 1);
  }
  const openHand = async () => { await nav('Hands'); await tap('.replayer-hand-card.is-row', 2000); };
  step('replayer', async () => {
    await openHand();
    for (const t of ['Forward', 'Forward', 'End']) { if (await exists(`button[title="${t}"]`)) await tap(`button[title="${t}"]`, 500, true); }
    await also('advanced');
  }, 1);
  step('replayer-settings', async () => { await openHand(); await tap('button[title="Replayer Settings"]', 900, true); }, 2);
  step('replayer-table-settings', async () => { await openHand(); await tap('[aria-label="Table settings"]', 900, true); }, 1);
  step('replayer-share', async () => {
    await openHand();
    for (const s of ['button[title*="Share"]', 'button[aria-label*="Share"]', 'button:has-text("Share")']) if (await exists(s)) { await tap(s, 900, true); return; }
    throw new Error('no share button on the replayer');
  }, 1);
  // Hands: the Saved Hands heading's Export for PokerTracker sheet (HandHistoryExportSheet), over the
  // account's own hands plus one of every kind it sorts (scripts/hands-states.mjs: both options and
  // the Not exported list), staged by answering the list's request; and a replay's Share sheet on a
  // hand that came by a share link, whose hand-history tile is off with its reason.
  step('hands-export', async () => {
    const undo = await stageHands(p);
    try {
      await fresh(); await nav('Hands');
      const sel = 'button:has-text("Export for PokerTracker")';
      await reveal(sel, 200);
      await tap(sel, 900);
      await vis('.hh-export-sheet').first().waitFor({ timeout: 4000 });
      await run('hands-export');
    } finally { await undo(); }
  }, 0, { selfRun: true });
  step('replayer-share-shared', async () => {
    await p.goto(base + '/#h/' + encodeURIComponent(SHARED_HAND_CODE), { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4500);
    await p.getByRole('button', { name: 'Skip', exact: true }).first().click({ timeout: 1000 }).catch(() => {});
    await tap('.rab-share', 900, true);
    await vis('.replayer-share-sheet').first().waitFor({ timeout: 4000 });
  }, 1);
  // Cash: the location picker.
  step('cash-location', async () => { await nav('Cash'); await tap('.filter-chip', 900); }, 1);
  // Results: the log form, a row in edit, the tax report, the share menu, the analytics sheet.
  step('results-log', async () => { await nav('Bankroll'); await tap('button:has-text("+ Log Result")', 900); }, 2);
  step('results-edit', async () => {
    await nav('Bankroll');
    const sel = '.tab-panel[data-tab="tracking"] .tracking-actions button:has-text("Edit"), .tracking-actions button:has-text("Edit")';
    await reveal(sel, 200);
    await tap(sel, 900);
  }, 1);
  step('results-tax', async () => { await nav('Bankroll'); await tap('button[title="Tax report (beta)"]', 2000); }, 3);
  step('results-share', async () => { await nav('Bankroll'); await tap('button[title="Share & Social"]', 900); }, 1);
  step('results-analytics', async () => {
    await nav('Bankroll');
    await reveal('.an-launch', 200);
    await tap('.an-launch', 1500);
    await also('open');
    const tabs = vis('.an-sheet [role="tab"], .an-sheet .bk-seg-btn, .an-sheet .an-tab');
    const n = await tabs.count();
    for (let i = 1; i < Math.min(n, 8); i++) { await tabs.nth(i).click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(700); await also('tab ' + (i + 1)); }
  }, 2);
  // Settings: scrolled to the foot, and the delete-account confirmation open.
  step('settings-delete', async () => {
    await menu('Settings', 'Settings');
    const sel = '.settings-row-btn:has-text("Delete account")';
    await reveal(sel, 300);
    await tap(sel, 700);
  }, 1);
  // Settings with a share link made: its field, Copy and Revoke in place of the Generate button.
  step('settings-share', async () => {
    await menu('Settings', 'Settings');
    if (await exists('.settings-share-input')) return;
    await tap('button:has-text("Generate Share Link")', 1200);
    if (!(await exists('.settings-share-input'))) throw new Error('no share link was made');
  }, 1);
  // The public page a share link opens (/shared/<token>): its own top bar, date breaks and cards.
  step('shared-schedule', async () => {
    const tk = await p.evaluate(async () => {
      const r = await fetch('/api/share-token', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
      return r.ok ? (await r.json()).token : null;
    });
    if (!tk) throw new Error('no share token');
    await p.goto(base + '/shared/' + tk, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);
    await vis('.cal-event-row').first().waitFor({ timeout: 8000 });
  }, 2, { noSkip: true });
  step('shared-schedule-card', async () => {
    const tk = await p.evaluate(async () => {
      const r = await fetch('/api/share-token', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
      return r.ok ? (await r.json()).token : null;
    });
    if (!tk) throw new Error('no share token');
    await p.goto(base + '/shared/' + tk, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);
    await tap('.cal-event-row:not(.open):not(.past) .cal-event-bar', 900);
  }, 1, { noSkip: true });
  // The backer page (/b/<token>, no login: components/BackerPage.jsx): a full history (its range
  // strip on All, then on 1M, then paged to its foot through the sticky month breaks and cards), a backer
  // with no sessions yet, one session. CHECK_BACKER_TOKENS (full,empty,one) names made-up backers
  // on a scratch server (scripts/seed-backer-demo.js prints the line); without it, not reached.
  const BACKER_TOKENS = (process.env.CHECK_BACKER_TOKENS || '').split(',').map(s => s.trim());
  const backer = async (i) => {
    if (!BACKER_TOKENS[i]) throw new Error('needs CHECK_BACKER_TOKENS (full,empty,one: scripts/seed-backer-demo.js)');
    await p.goto(base + '/b/' + BACKER_TOKENS[i] + (overlay ? '?gridOverlay=1' : ''), { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    await vis('.bp-name, .bp-message').first().waitFor({ timeout: 8000 });
  };
  step('backer-page', async () => {
    await backer(0);
    await vis('.bp-card').first().waitFor({ timeout: 8000 });
    await also('all');
    await click('.bp-seg button:has-text("1M")', 700);
  }, 7, { noSkip: true });
  step('backer-page-empty', () => backer(1), 0, { noSkip: true });
  step('backer-page-one', () => backer(2), 0, { noSkip: true });
  // A saved card's buddy chip opens the swap sheet; Results' share menu opens the series wrap-up.
  step('swap-modal', async () => {
    await nav('Schedule');
    await tap('.cal-event-row.saved:not(.open):not(.past) .cal-event-bar', 900);
    await tap('.cal-event-row.open .buddy-chip', 1200);
  }, 1);
  step('wrap-up', async () => {
    await nav('Bankroll');
    await tap('button[title="Share & Social"]', 900);
    await tap('.share-menu-item:has-text("Series Wrap")', 1500);
  }, 1);
  // The admin's Quick add (Hands): describe a hand.
  step('hands-quick-add', async () => { await nav('Hands'); await tap('.qa-chip:has-text("Quick add")', 1200); }, 1);
  // Admin.
  step('admin', () => menu('Admin', 'Admin'), 3);
  step('batches', () => menu('New Events', 'New Events'), 2);
  // Staking: no way in from the UI (nothing in it navigates to 'staking'), so through onNavigate.
  step('staking', () => goView('staking'), 1);
  for (const [name, sel] of [['summary', 'button:has-text("Summary")'], ['backers', 'button:has-text("Backers")'], ['series', 'button:has-text("+ Series")'], ['settings', 'button:has-text("⚙")']]) {
    step('staking-' + name, async () => { await goView('staking'); await tap('.tab-panel[data-tab="staking"] ' + sel, 1200); }, 1);
  }
  // A series' Settlement (docs/bankroll-merge.md §10): an open sheet with its inputs (prepaid,
  // adjustment, the other player's result) and Finalize, and a settled one with its Paid toggles.
  // Found by name, so the server needs series called "Guard Open" and "Guard Settled" (a scratch
  // seed); without them each is reported as not reached.
  for (const [name, title] of [['settlement-open', 'Guard Open'], ['settlement-settled', 'Guard Settled']]) {
    step('staking-' + name, async () => {
      await goView('staking');
      await tap(`.tab-panel[data-tab="staking"] .staking-series-card:has-text("${title}")`, 1200);
      await tap('.tab-panel[data-tab="staking"] .group-segment-btn:has-text("Settlement")', 1800);
    }, 3);
  }
  // First-run setup, stage by stage (re-opened the way the location menu's "Run setup again"
  // does; docs/onboarding.md): step 1 as it opens, with "Use my location" refused (no permission:
  // the error line), located (permission granted at a fixed point: the place named, the distance
  // chips), and with city results (Nominatim, so only where the scratch server reaches the
  // internet); step 2, then with Yes (the state select and, once a state is known, the sites
  // checkbox); step 3 with a game and a buy-in chip on. Nothing is finished or skipped, so nothing
  // is written. Every option carries .onboarding-option.
  step('onboarding', async () => {
    const open = async () => {
      await p.evaluate(() => window.dispatchEvent(new Event('reopen-onboarding')));
      await p.waitForTimeout(1000);
      if (!(await exists('.ob-progress'))) throw new Error('setup did not open');
    };
    try {
      await open();
      await also('step 1');
      await tap('.ob-tile', 1500);
      if (!(await exists('.ob-error'))) throw new Error('no error line after a refused "Use my location"');
      await also('step 1 denied');
      // WebKit keeps a page's refusal for the life of the page: grant, then a fresh page.
      await ctx.grantPermissions(['geolocation'], { origin: base });
      await ctx.setGeolocation({ latitude: 39.9526, longitude: -75.1652 });
      await p.goto(home, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(3500);
      await open();
      // Already allowed: setup locates by itself; tap only if it has not.
      for (let i = 0; i < 10 && !(await exists('.ob-chip')); i++) await p.waitForTimeout(300);
      if (!(await exists('.ob-chip'))) await tap('.ob-tile', 3500);
      if (!(await exists('.ob-chip'))) throw new Error('no distance chips once located');
      await also('step 1 located');
      await vis('.ob-search').first().fill('Austin');
      await p.waitForTimeout(1500);
      for (let i = 0; i < 10 && !(await exists('.ob-results .ob-row')); i++) await p.waitForTimeout(300);
      if (await exists('.ob-results .ob-row')) await also('step 1 search');
      else notes.push({ view: 'onboarding', note: 'no city results (the scratch server could not reach Nominatim): step 1 search not measured' });
      await tap('.ob-foot button:has-text("Next")', 800);
      await also('step 2');
      await tap('.ob-tile:has-text("Yes")', 600);
      await also('step 2 online');
      await tap('.ob-foot button:has-text("Next")', 800);
      await tap('.ob-chip:has-text("NLH")', 300);
      await tap('.ob-chip:has-text("$500–1.5K")', 600);
      await also('step 3');
    } finally { await ctx.clearPermissions(); }
  }, 0, { noSkip: true });
  // First-run setup's other answers (re-opened, nothing finished): a region that implies a state
  // (Las Vegas -> Nevada, with the sites checkbox, ticked), Europe (no state, the non-US line),
  // Everywhere (the state select at "Not set"), and the zero-count line, where a combination of
  // chips on Texas matches nothing in the scratch data. docs/onboarding.md.
  step('onboarding-places', async () => {
    await p.evaluate(() => window.dispatchEvent(new Event('reopen-onboarding')));
    await p.waitForTimeout(1000);
    if (!(await exists('.ob-progress'))) throw new Error('setup did not open');
    const next = () => tap('.ob-foot button:has-text("Next")', 800);
    const back = () => tap('.ob-foot button:has-text("Back")', 600);
    await tap('.ob-cell:has-text("Las Vegas")', 500);
    await also('region picked');
    await next();
    if (!(await exists('.ob-tile[aria-checked="true"]:has-text("Yes")'))) await tap('.ob-tile:has-text("Yes")', 500);
    if ((await vis('#ob-state').first().inputValue()) !== 'NV') throw new Error('Las Vegas did not answer the state (Nevada); savedLocation is ' + await p.evaluate(() => localStorage.getItem('savedLocation')));
    await tap('.ob-check', 400);
    await also('state from the region');
    await back();
    await tap('.ob-cell:has-text("Europe")', 500);
    await next();
    if (!(await exists('.ob-help:has-text("US states only")'))) throw new Error('no non-US line for Europe');
    await also('Europe');
    await back();
    await tap('.ob-cell:has-text("Everywhere")', 500);
    await next();
    if ((await vis('#ob-state').first().inputValue()) !== '') throw new Error('Everywhere left a state set');
    await also('no state');
    // The longest state name in the checkbox (a label that must not clip).
    await vis('#ob-state').first().selectOption('DC');
    await p.waitForTimeout(400);
    await also('longest state name');
    await back();
    await tap('.ob-cell:has-text("Texas")', 500);
    await next(); await next();
    const zero = async () => (await vis('.ob-status').first().innerText()).startsWith('Nothing upcoming');
    for (const chip of ['$5K+', 'Mixed', 'PLO']) {
      if (await zero()) break;
      await tap('.ob-chip:has-text("' + chip + '")', 500);
    }
    if (await zero()) await also('zero count');
    else notes.push({ view: 'onboarding-places', note: 'no chip combination on Texas matched nothing in this data: the zero-count line was not measured' });
  }, 0, { noSkip: true });
  // Settings' "Edit name": the name dialog opened on the current name, titled "Your name".
  step('settings-edit-name', async () => {
    await menu('Settings', 'Settings');
    await tap('button:has-text("Edit name")', 900);
    if (!(await exists('.ob-name'))) throw new Error('the name dialog did not open');
    if (!(await exists('.ob-name .ob-title:has-text("Your name")'))) throw new Error('the dialog is not titled "Your name"');
  }, 0);
  // Signed out: the login, register and forgot-password screens; with CHECK_FRESH_USER, a
  // password login to an account with no real name (the real-name prompt), then its wizard.
  const signedOut = async () => {
    await p.evaluate(() => { sessionStorage.setItem('guard-signed-out', '1'); localStorage.removeItem('token'); localStorage.removeItem('username'); sessionStorage.removeItem('token'); });
    await p.goto(home, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
  };
  step('auth-login', signedOut, 0, { signedOut: true });
  step('auth-register', async () => {
    await signedOut();
    await tap('button:has-text("Create account"), button:has-text("Sign up"), button:has-text("Register"), a:has-text("Sign up")', 900);
  }, 1, { signedOut: true });
  step('auth-forgot', async () => {
    await signedOut();
    await tap('button:has-text("Forgot"), a:has-text("Forgot")', 900);
  }, 0, { signedOut: true });
  // The password-reset page a reset email links to (/#reset?token=<64 hex>; a query string makes
  // it a new document, which is when the app reads the hash).
  step('auth-reset', async () => {
    await signedOut();
    await p.goto(base + '/?reset=1#reset?token=' + 'ab'.repeat(32), { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    if (!(await exists('input[type="password"]'))) throw new Error('the reset form did not show');
  }, 0, { signedOut: true, noSkip: true });
  step('real-name-prompt', async () => {
    const u = process.env.CHECK_FRESH_USER, pw = process.env.CHECK_FRESH_PASSWORD;
    if (!u || !pw) throw new Error('needs CHECK_FRESH_USER / CHECK_FRESH_PASSWORD (an account with no real name)');
    await signedOut();
    await p.evaluate(() => { localStorage.removeItem('onboarded'); localStorage.removeItem('onboardComplete'); localStorage.removeItem('hasOnboarded'); sessionStorage.setItem('guard-onboarding', '1'); });
    await vis('input[name="email"], input[type="email"], input[name="username"]').first().fill(u);
    await vis('input[type="password"]').first().fill(pw);
    await vis('button[type="submit"]').first().click({ timeout: 8000 });
    await p.waitForTimeout(2500);
    if (!(await p.getByText(/what's your name|your real name/i).filter({ visible: true }).count())
      && !(await p.locator('input[placeholder="Your real name"]').filter({ visible: true }).count())) throw new Error('the real-name prompt did not show');
    await also('prompt');
    // First-run setup follows it for a new account (users.onboarding is NULL): it must open.
    await p.getByRole('button', { name: /later|skip|not now/i }).first().click({ timeout: 2000 }).catch(() => {});
    await p.waitForTimeout(1500);
    // Unless the account has a setup record (an account older than users.onboarding is backfilled
    // legacy and is never asked): then setup is not expected, and that is noted.
    const rec = await p.evaluate(async () => {
      try {
        const t = localStorage.getItem('token') || sessionStorage.getItem('token');
        const r = await fetch('/api/user/onboarding', { headers: { Authorization: 'Bearer ' + t } });
        return r.ok ? (await r.json()).onboarding : undefined;
      } catch { return undefined; }
    });
    if (!(await exists('.ob-progress'))) {
      if (rec === null) throw new Error('a new account did not reach first-run setup after "Later"');
      notes.push({ view: 'real-name-prompt', note: `CHECK_FRESH_USER has a setup record (${JSON.stringify(rec)}): setup not expected after "Later"` });
    }
    await also('after');
    // The first run's own defaults (nothing is finished): step 2 starts at "No, live only" (online
    // events are off until the player says yes), then Yes brings the state question.
    if (await exists('.ob-progress')) {
      await tap('.ob-foot button:has-text("Next")', 800);
      const on = await p.evaluate(() => [...document.querySelectorAll('.ob-tile[aria-checked="true"] .ob-tile-title')].map(e => e.textContent).join('|'));
      if (on !== 'No, live only') throw new Error("a first run's step 2 should start at 'No, live only'; it has: " + (on || 'nothing selected'));
      await also('first run step 2');
      await tap('.ob-tile:has-text("Yes")', 600);
      await also('first run step 2 online');
      await tap('.ob-foot button:has-text("Next")', 800);
      await also('first run step 3');
    }
  }, 0, { signedOut: true, noSkip: true });

  if (listOnly) { console.log(views.map(v => v.view).join('\n')); await b.close(); return; }
  for (const v of views) {
    if (!want(v.view)) continue;
    lastView = v.view;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await p.evaluate(() => sessionStorage.removeItem('guard-signed-out')).catch(() => {});
        if (v.opts.noSkip) { await p.goto(home, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500); }
        else await fresh();
        await v.fn();
        // selfRun: the view scanned its own states (a staged home whose routes are off by now).
        if (!v.opts.selfRun) {
          await run(v.view);
          await scrollMain(v.scrolls);
        }
        if (v.opts.after) await v.opts.after();
        visited.push(v.view);
        break;
      } catch (e) {
        if (crashed || p.isClosed() || /crash|closed/i.test(e.message)) {
          notes.push({ view: v.view, note: 'the page crashed (' + e.message.split('\n')[0].slice(0, 80) + '); reopened' + (attempt ? '' : ' and retried') });
          await reopen();
          if (attempt === 0) continue;
        } else if (attempt === 0 && /stream|PNG|Protocol error|Target|allocation/i.test(e.message)) {
          // A capture that came back cut short (the PNG decoder's "read requests waiting on
          // finished stream") or could not be decoded for memory: transient, so the view is taken
          // again.
          notes.push({ view: v.view, note: 'a capture failed (' + e.message.split('\n')[0].slice(0, 80) + '); retried' });
          continue;
        }
        unreachable.push({ view: v.view, why: e.message.split('\n')[0].slice(0, 160) });
        if (process.env.CHECK_DEBUG) console.log(e.stack || e.message);
        if (!quiet) console.log(`  (view ${v.view} skipped: ${e.message.split('\n')[0]})`);
        break;
      }
    }
  }

  // One row per distinct control (same element description + label), worst case kept.
  const key = (c) => c.view.split(' (')[0] + '|' + c.el + '|' + c.text + '|' + c.kind;
  const byKey = new Map();
  const score = (c) => c.fail.length * 1000 + Math.max(Math.abs(c.dx || 0), Math.abs(c.dy || 0));
  for (const c of all) {
    const k = key(c);
    const prev = byKey.get(k);
    if (!prev || score(c) > score(prev)) byKey.set(k, c);
  }
  const rows = [...byKey.values()];
  const failing = rows.filter(c => c.fail.length);
  const viewsSeen = [...new Set(rows.map(c => c.view.split(' (')[0]))];
  console.log(`controls at ${W}x${H}${desktop ? ' (desktop)' : ''}: g=${grid && grid.g}px r=${grid && grid.r}px origin x=${grid && grid.ox} y=${grid && grid.oy}`);
  for (const v of viewsSeen) {
    const vr = rows.filter(c => c.view.split(' (')[0] === v), vf = vr.filter(c => c.fail.length);
    const ns = vr.filter(c => c.kind === 'strip').length, nl = vr.filter(c => c.kind === 'layer').length;
    console.log(`  ${v}: ${vr.length - ns - nl} controls${ns ? ` + ${ns} strips` : ''}${nl ? ` + ${nl} layers` : ''}, ${vf.length} failing`);
  }
  // Where a failure's styling lives when no stylesheet rule names it (a React style={{}}): the
  // JSX line that renders it, found by its class or, failing that, its label text.
  const JSX = (() => {
    const out = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, f.name);
        if (f.isDirectory()) walk(q);
        else if (/\.jsx$/.test(f.name)) out.push([path.relative(ROOT, q).split(path.sep).join('/'), fs.readFileSync(q, 'utf8').split(/\r?\n/)]);
      }
    };
    try { walk(path.join(ROOT, 'vite-app/src')); } catch {}
    return out;
  })();
  const jsxRef = (c) => {
    const findAll = (re) => { const out = []; for (const [f, lines] of JSX) for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) out.push([f, i + 1]); return out; };
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Several hits: the file named like the view ("staking" -> StakingView.jsx), else ambiguous.
    const pick = (hits) => {
      if (!hits.length) return null;
      if (hits.length === 1) return `${hits[0][0]}:${hits[0][1]}`;
      const v = c.view.split(/[\s(-]/)[0].toLowerCase();
      const own = hits.filter(([f]) => path.basename(f).toLowerCase().includes(v));
      if (own.length >= 1 && own.length <= 2) return own.map(([f, l]) => `${f}:${l}`).join(' | ');
      if (hits.length <= 3) return hits.map(([f, l]) => `${f}:${l}`).join(' | ');
      // One block of one file (a menu's items written alike): its line range.
      const ls = hits.map(([, l]) => l);
      if (hits.every(([f]) => f === hits[0][0]) && Math.max(...ls) - Math.min(...ls) <= 60) return `${hits[0][0]}:${Math.min(...ls)}-${Math.max(...ls)}`;
      return null;
    };
    for (const k of (c.cls || []).filter(k => !/^(btn|ctl|active|open|selected|disabled|snap-g|snap-g-centred|is-\w+|btn-\w+)$/.test(k))) {
      const r = pick(findAll(new RegExp('className=[^>]*[\'"` ]' + esc(k) + '[\'"` ]')));
      if (r) return r;
    }
    // Styled inline: the JSX line that writes the most of the style's values (a style object is
    // usually one line), if few lines tie for it; else the line that writes its label.
    if (c.inlineStyle) {
      const vals = [...new Set(c.inlineStyle.split(';').map(d => d.slice(d.indexOf(':') + 1).trim())
        .filter(v => v.length >= 6 && /calc|var\(/.test(v)))];
      let best = 0, hits = [];
      for (const [f, lines] of JSX) for (let i = 0; i < lines.length; i++) {
        let n = 0;
        for (const v of vals) if (lines[i].includes("'" + v + "'") || lines[i].includes('"' + v + '"') || lines[i].includes('`' + v + '`')) n++;
        if (!n || n < best) continue;
        if (n > best) { best = n; hits = []; }
        hits.push([f, i + 1]);
      }
      const r = pick(hits);
      if (r) return r;
    }
    const t = (c.text || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (t.length >= 3 && /\p{L}/u.test(t)) { const r = pick(findAll(new RegExp('(>|^)\\s*' + esc(t) + '\\s*(<|$)|[\'"`]' + esc(t) + '[\'"`]'))); if (r) return r; }
    // Inside a component whose root class names it (.location-dropdown -> LocationDropdown.jsx);
    // not the app's own layout boxes, which name no component.
    const GENERIC = /^(content-area|tab-panel|app-shell|app|main|dk-pane|dk-pane-[\w-]+|dk-shell|page|screen|view|layout|container|wrapper|root|overlay|backdrop|modal-overlay|modal-backdrop)$/;
    for (const k of (c.anc || []).filter(k => !GENERIC.test(k))) {
      const r = pick(findAll(new RegExp('className=[^>]*[\'"` ]' + esc(k) + '[\'"` ]')));
      if (r) return `${r} (in .${k})`;
    }
    return null;
  };
  for (const c of failing) {
    const own = (c.rules || []).length ? c.rules[c.rules.length - 1] : null;
    if (!own || c.inlineStyle || own.spec < 100) c.jsx = jsxRef(c);
  }
  const show = dump ? rows : failing;
  const fmt = (c) => {
    const src = c.inkFrom && c.inkFrom !== 'metrics' && c.inkFrom !== 'metrics+pixels' ? ` (${c.inkFrom})` : '';
    const rule = c.rules && c.rules.length ? c.rules[c.rules.length - 1].at : '';
    const extra = c.kind === 'strip' ? ` along ${c.along} across ${c.across}${c.bandFrom ? ` (band runs on into ${c.bandFrom})` : ''}` : '';
    return `  [${c.view.split(' (')[0]}] ${c.fail.length ? 'FAIL ' + c.fail.join(',') : 'ok'}  ${c.kind !== 'control' ? c.kind + ' ' : ''}${c.boxless ? '(boxless) ' : ''}${c.el} "${c.text}"  ${c.w}g x ${c.h}r @ x${c.x}g y${c.y}r  ink dx ${c.dx} dy ${c.dy}${extra}${src}  in ${c.ctx}${rule ? '  rule ' + rule : ''}${c.jsx ? '  jsx ' + c.jsx : ''}`;
  };
  if (!quiet || dump) for (const c of show) console.log(fmt(c));
  if (verifyInk) {
    // The over edge (cap top) from metrics against the painted top; the line's ends from canvas
    // side bearings against the painted ends (the run uses the painted ends).
    const badOver = pxVerify.filter(v => v.over > 0.75), badAlong = pxVerify.filter(v => v.along > 0.75);
    console.log(`ink verify: ${pxVerify.length} labels; over edge off by >0.75px on ${badOver.length}, line ends (canvas vs painted) on ${badAlong.length}`);
    for (const v of badOver.slice(0, 30)) console.log(`  over  [${v.view}] ${v.kind} ${v.el} "${v.text}" metric ${v.metric.join(',')} pixels ${v.pixels.join(',')} (${v.over})`);
    for (const v of badAlong.slice(0, 30)) console.log(`  along [${v.view}] ${v.kind} ${v.el} "${v.text}" metric ${v.metric.join(',')} pixels ${v.pixels.join(',')} (${v.along})`);
  }
  if (pxLeftovers.length) console.log(`  (pixel pass: ${pxLeftovers.reduce((a, b) => a + b, 0)} label markers outlived their pass and were cleared)`);
  for (const n of notes) console.log(`  note [${n.view}] ${n.note}`);
  if (unreachable.length) console.log(`views not reached: ${unreachable.map(u => u.view).join(', ')}`);
  const distinct = new Set(failing.map(c => c.el + '|' + c.text)).size;
  if (!rows.length) {
    console.log(`NO CONTROLS MEASURED at ${W}x${H} — the views did not open (is the server up, the token an admin's?)`);
    await b.close();
    process.exit(2);
  }
  console.log(failing.length ? `CONTROLS OFF GRID OR OFF CENTRE at ${W}x${H}: ${failing.length} of ${rows.length} (by view; ${distinct} distinct)` : `all ${rows.length} controls on the grid and centred at ${W}x${H}`);
  if (jsonOut) {
    const failures = failing.map(c => ({
      view: c.view.split(' (')[0], kind: c.kind, desc: c.el, text: c.text, classes: c.cls, fail: c.fail,
      rule: c.rules && c.rules.length ? c.rules[c.rules.length - 1].at : null,
      rules: (c.rules || []).slice(-4), labelEl: c.labelEl || null, labelRule: c.labelRules && c.labelRules.length ? c.labelRules[c.labelRules.length - 1].at : null,
      inlineStyle: c.inlineStyle || null, labelInlineStyle: c.labelInlineStyle || null, jsx: c.jsx || null, how: c.how, boxless: !!c.boxless,
      dx: c.dx, dy: c.dy, along: c.along, across: c.across, inkFrom: c.inkFrom || 'metrics',
      geometry: { wG: c.w, hR: c.h, xG: c.x, yR: c.y, box: c.box, ink: c.ink, ...(c.elBox ? { elementBox: c.elBox, bandFrom: c.bandFrom } : {}) }, ctx: c.ctx,
    }));
    fs.writeFileSync(jsonOut, JSON.stringify({ width: W, height: H, desktop, grid: grid && { g: grid.g, r: grid.r, ox: grid.ox, oy: grid.oy }, visited, unreachable, notes, failures, rows, inkVerify: verifyInk ? pxVerify : undefined }, null, 1));
  }
  await b.close();
  process.exit(failing.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
