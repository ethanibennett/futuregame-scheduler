#!/usr/bin/env node
/* Quick-add hand histories: corpus evaluation.

   Runs every case in test/quick-add/corpus/*.json through a parser (the live
   /api/quick-add/parse endpoint, lib/quick-add.js directly, a saved report, or
   the corpus's own expectations as an "oracle" hand), then through findGaps from
   vite-app/src/utils/quick-add/gaps.js when that exists, and scores what came
   back against what the description actually says.

   No dependencies beyond Node 18+. The contract it scores against is
   docs/quick-add-contract.md; the corpus format and the meaning of every score
   are in test/quick-add/README.md.

     node test/quick-add/eval.js --dry-run                 validate the corpus, print coverage
     node test/quick-add/eval.js --oracle                  score the gaps engine on the corpus's own hands
     node test/quick-add/eval.js --url http://127.0.0.1:3199 --token <jwt>
     node test/quick-add/eval.js                           lib/quick-add.js directly (needs ANTHROPIC_API_KEY)
     node test/quick-add/eval.js --parses <report.json>    re-score parses saved by an earlier run
*/
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CORPUS = path.join(__dirname, 'corpus');
const DEFAULT_OUT = path.join(__dirname, 'reports');
const DEFAULT_MODULE = path.join(ROOT, 'lib', 'quick-add.js');
const DEFAULT_GAPS = path.join(ROOT, 'vite-app', 'src', 'utils', 'quick-add', 'gaps.js');
const UTILS = path.join(ROOT, 'vite-app', 'src', 'utils', 'utils.js');

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const HELP = `Usage: node test/quick-add/eval.js [options]

Modes (pick one; the first that applies wins):
  --dry-run              Validate the corpus (schema, card legality, duplicate cards,
                         betting legality, chip arithmetic), print coverage, and check
                         that the scorer gives every case 100% against its own oracle.
  --oracle               Use each case's expectations as the parsed hand. Scores the
                         GAPS ENGINE in isolation (the parse is perfect by construction).
  --parses <file.json>   Re-score the parsed hands saved in an earlier JSON report.
  --url <base> --token <jwt>
                         POST each case to <base>/api/quick-add/parse.
  (default)              Call lib/quick-add.js directly; needs ANTHROPIC_API_KEY.

Options:
  --corpus <dir|file>    Corpus location (default test/quick-add/corpus).
  --filter <text>        Only cases whose id, game or tags contain <text> (repeatable, OR).
  --source text|speech   Only cases from that source.
  --incomplete / --complete   Only cases with / without expectGaps.
  --limit <n>            Stop after n cases.
  --concurrency <n>      Parallel parses (default 1: the server rate-limits per user).
  --delay <ms>           Pause between requests per worker (default 0).
  --timeout <ms>         Per-parse timeout (default 120000).
  --hint-game            Send the expected gameType as hints.gameType.
  --module <path>        Parser module (default lib/quick-add.js).
  --export <name>        Function to call in the parser module (default: auto-detect).
  --gaps <path>          Gaps module (default vite-app/src/utils/quick-add/gaps.js).
  --no-gaps              Skip the gaps engine even if it exists.
  --out <dir>            Report directory (default test/quick-add/reports).
  --no-report            Do not write report files.
  --min-recall <0..1>    Exit 1 if aggregate fact recall is below this.
  --max-hallucinations <n>  Exit 1 if more hallucinated cards+stacks than this.
  --verbose              Print every case's result as it finishes.
  --help
`;

function parseArgs(argv) {
  const o = { filter: [], concurrency: 1, delay: 0, timeout: 120000, gaps: true, report: true };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) { console.error(`${flag} needs a value`); process.exit(2); }
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help': case '-h': o.help = true; break;
      case '--dry-run': o.dryRun = true; break;
      case '--oracle': o.oracle = true; break;
      case '--parses': o.parses = need(i, a); i++; break;
      case '--url': o.url = need(i, a).replace(/\/+$/, ''); i++; break;
      case '--token': o.token = need(i, a); i++; break;
      case '--corpus': o.corpus = need(i, a); i++; break;
      case '--filter': o.filter.push(need(i, a).toLowerCase()); i++; break;
      case '--source': o.source = need(i, a); i++; break;
      case '--incomplete': o.only = 'incomplete'; break;
      case '--complete': o.only = 'complete'; break;
      case '--limit': o.limit = Number(need(i, a)); i++; break;
      case '--concurrency': o.concurrency = Math.max(1, Number(need(i, a)) || 1); i++; break;
      case '--delay': o.delay = Math.max(0, Number(need(i, a)) || 0); i++; break;
      case '--timeout': o.timeout = Math.max(1000, Number(need(i, a)) || 120000); i++; break;
      case '--hint-game': o.hintGame = true; break;
      case '--module': o.module = need(i, a); i++; break;
      case '--export': o.exportName = need(i, a); i++; break;
      case '--gaps': o.gapsPath = need(i, a); i++; break;
      case '--no-gaps': o.gaps = false; break;
      case '--out': o.out = need(i, a); i++; break;
      case '--no-report': o.report = false; break;
      case '--min-recall': o.minRecall = Number(need(i, a)); i++; break;
      case '--max-hallucinations': o.maxHalluc = Number(need(i, a)); i++; break;
      case '--verbose': case '-v': o.verbose = true; break;
      default:
        console.error(`Unknown option ${a}\n`); console.error(HELP); process.exit(2);
    }
  }
  return o;
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser stubs + game config
// ─────────────────────────────────────────────────────────────────────────────

/* The replayer's utils (and anything the gaps engine imports from them) were
   written for the browser. Enough of a window for them to load under Node. */
function stubBrowserGlobals() {
  const store = () => {
    const m = new Map();
    return {
      getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: k => { m.delete(k); }, clear: () => m.clear(), key: i => [...m.keys()][i] ?? null,
      get length() { return m.size; },
    };
  };
  const g = globalThis;
  if (!g.localStorage) g.localStorage = store();
  if (!g.sessionStorage) g.sessionStorage = store();
  if (!g.addEventListener) g.addEventListener = () => {};
  if (!g.removeEventListener) g.removeEventListener = () => {};
  if (!g.matchMedia) g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  if (!g.document) {
    const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, contains: () => false } });
    g.document = {
      addEventListener() {}, removeEventListener() {}, createElement: el, querySelector: () => null,
      querySelectorAll: () => [], getElementById: () => null, documentElement: el(), body: el(),
    };
  }
  if (!g.window) g.window = g;
}

/* Used only if utils.js cannot be imported; mirrors HAND_CONFIG's betting facts. */
const FALLBACK_CONFIG = {
  'NLH': { heroCards: 2, hasBoard: true, betting: 'nl' },
  'LHE': { heroCards: 2, hasBoard: true, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4 },
  'PLO': { heroCards: 4, hasBoard: true, betting: 'pl' },
  'PLO8': { heroCards: 4, hasBoard: true, betting: 'pl' },
  'O8': { heroCards: 4, hasBoard: true, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4 },
  'Big O': { heroCards: 5, hasBoard: true, betting: 'pl' },
  'Razz': { heroCards: 7, hasBoard: false, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, isStud: true },
  'Stud Hi': { heroCards: 7, hasBoard: false, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, isStud: true },
  'Stud 8': { heroCards: 7, hasBoard: false, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, isStud: true },
  '2-7 TD': { heroCards: 5, hasBoard: false, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4 },
  'NL 2-7 SD': { heroCards: 5, hasBoard: false, betting: 'nl' },
  'Badugi': { heroCards: 4, hasBoard: false, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4 },
  'A-5 TD': { heroCards: 5, hasBoard: false, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4 },
  'PLH': { heroCards: 2, hasBoard: true, betting: 'pl' },
  'PL 2-7 TD': { heroCards: 5, hasBoard: false, betting: 'pl' },
};
let HAND_CONFIG = FALLBACK_CONFIG;
let configSource = 'fallback table in eval.js';

async function loadHandConfig() {
  stubBrowserGlobals();
  try {
    const m = await import(pathToFileURL(UTILS).href);
    if (m.HAND_CONFIG && m.HAND_CONFIG.NLH) { HAND_CONFIG = m.HAND_CONFIG; configSource = 'vite-app/src/utils/utils.js'; }
  } catch (e) {
    configSource = `fallback table in eval.js (utils.js failed to import: ${e.message})`;
  }
}

const TRIPLE_DRAW = ['2-7 TD', 'PL 2-7 TD', 'L 2-7 TD', 'A-5 TD', 'Badeucy', 'Badacy', 'Badugi'];
const SINGLE_DRAW = ['NL 2-7 SD', 'PL 5CD Hi'];

/* The replayer's getGameCategory, minus custom games. */
function categoryOf(gameType) {
  const cfg = HAND_CONFIG[gameType];
  if (!cfg) return null;
  if (cfg.isStud) return 'stud';
  if (cfg.hasBoard) return 'community';
  if (TRIPLE_DRAW.includes(gameType)) return 'draw_triple';
  if (SINGLE_DRAW.includes(gameType)) return 'draw_single';
  return 'community';
}

/* Street keys the corpus uses, by category, in the replayer's street order. A
   draw is recorded on the betting round BEFORE it, so draws.predraw is the first
   draw, draws.draw1 the second, and so on. */
const STREET_KEYS = {
  community: ['preflop', 'flop', 'turn', 'river'],
  draw_triple: ['predraw', 'draw1', 'draw2', 'draw3'],
  draw_single: ['predraw', 'draw'],
  stud: ['3rd', '4th', '5th', '6th', '7th'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cards
// ─────────────────────────────────────────────────────────────────────────────

const RANKS = '23456789TJQKA';

/* Strict: the corpus's own notation. Rank 2-9TJQKA, suit hdcs, or x for an
   unknown suit ("Kx"); a lone "x" is a wholly unknown card. Returns null when
   the string is not legal notation. */
function parseCardsStrict(str) {
  if (typeof str !== 'string') return null;
  const out = [];
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (RANKS.includes(ch) && i + 1 < str.length && 'hdcsx'.includes(str[i + 1])) {
      out.push({ r: ch, s: str[i + 1] }); i += 2;
    } else if (ch === 'x') {
      out.push({ r: '?', s: 'x' }); i += 1;
    } else return null;
  }
  return out;
}

/* Lenient: whatever a parser hands back. Case-insensitive, "10" for T,
   separators ignored, unparseable characters skipped. */
function parseCardsLoose(str) {
  if (str == null) return [];
  if (Array.isArray(str)) str = str.join('');
  str = String(str).replace(/10/g, 'T').replace(/[\s,;\-\[\]()|/]+/g, '');
  if (/^muck(ed)?$/i.test(str)) return [];
  const out = [];
  let i = 0;
  while (i < str.length) {
    const r = str[i].toUpperCase();
    const s = (str[i + 1] || '').toLowerCase();
    if (RANKS.includes(r) && 'hdcsx'.includes(s) && s) { out.push({ r, s }); i += 2; }
    else if (str[i] === 'x' || str[i] === 'X' || str[i] === '?') { out.push({ r: '?', s: 'x' }); i += 1; }
    else i += 1;
  }
  return out;
}

const cardKey = c => c.r + c.s;
const isConcrete = c => c.r !== '?' && c.s !== 'x';
const cardsToString = cs => cs.map(c => (c.r === '?' ? 'x' : c.r + c.s)).join('');

/* Is parsed card p an acceptable reading of expected card e? */
function cardCompatible(e, p) {
  if (e.r === '?') return true;
  if (e.s === 'x') return p.r === e.r;
  return p.r === e.r && p.s === e.s;
}

/* Multiset match, order-insensitive, same count. Most specific expectations
   are matched first so a rank-only "Kx" cannot steal the "Kh" another slot needs. */
function cardsMatch(expected, parsed) {
  if (expected.length !== parsed.length) return false;
  return cardsSubset(expected, parsed);
}
function cardsSubset(expected, parsed) {
  const pool = parsed.slice();
  const order = expected.slice().sort((a, b) => specificity(b) - specificity(a));
  for (const e of order) {
    const k = pool.findIndex(p => cardCompatible(e, p));
    if (k < 0) return false;
    pool.splice(k, 1);
  }
  return true;
}
const specificity = c => (c.r === '?' ? 0 : c.s === 'x' ? 1 : 2);

// ─────────────────────────────────────────────────────────────────────────────
// Positions
// ─────────────────────────────────────────────────────────────────────────────

/* The replayer's getPositionLabels: index 0 acts first preflop; the last three
   are BTN, SB, BB. Six-handed therefore has no "UTG" — seat 0 is LJ. */
function positionLabels(n) {
  if (n <= 2) return ['BTN/SB', 'BB'];
  if (n === 3) return ['BTN', 'SB', 'BB'];
  const middle = ['UTG', 'UTG+1', 'MP1', 'MP2', 'LJ', 'HJ', 'CO'];
  const need = n - 3;
  return middle.slice(Math.max(0, middle.length - need)).concat(['BTN', 'SB', 'BB']);
}

const POS_ALIAS = {
  'BU': 'BTN', 'BUTTON': 'BTN', 'D': 'BTN', 'DEALER': 'BTN', 'BTN': 'BTN',
  'SB/BTN': 'BTN/SB', 'BTN/SB': 'BTN/SB', 'BTNSB': 'BTN/SB', 'SBBTN': 'BTN/SB',
  'SMALLBLIND': 'SB', 'BIGBLIND': 'BB', 'CUTOFF': 'CO', 'HIJACK': 'HJ', 'LOJACK': 'LJ',
  'UTG1': 'UTG+1', 'UTG+1': 'UTG+1', 'UTG2': 'UTG+2', 'UTG+2': 'UTG+2', 'EP': 'UTG',
  'MP': 'MP', 'MP1': 'MP1', 'MP2': 'MP2', 'MP+1': 'MP2', 'STR': 'UTG', 'STRADDLE': 'UTG',
};
function normPos(s) {
  if (s == null) return '';
  const u = String(s).toUpperCase().replace(/[\s_]+/g, '');
  return POS_ALIAS[u] || u;
}

/* The seat index a position NAME means at an n-handed table, the way players
   use the names: UTG is always the first to act, UTG+1 the second, and CO, HJ, LJ
   count back from the button. This is deliberately not positionLabels(n).indexOf:
   the replayer's labels run out of names from the front (nine-handed starts at
   "UTG+1", six-handed at "LJ"), so its "UTG+1" at nine-handed is the seat a
   player calls UTG. Returns -1 for a name that does not exist at that size. */
function semanticIndex(ref, n) {
  const r = normPos(ref);
  if (!Number.isInteger(n) || n < 2) return -1;
  if (n === 2) return (r === 'BTN/SB' || r === 'BTN' || r === 'SB') ? 0 : r === 'BB' ? 1 : -1;
  const fromBack = { 'BB': 1, 'SB': 2, 'BTN': 3, 'CO': 4, 'HJ': 5, 'LJ': 6 };
  let i = -1;
  if (r in fromBack) i = n - fromBack[r];
  else if (r === 'UTG') i = 0;
  else if (r === 'UTG+1') i = 1;
  else if (r === 'UTG+2') i = 2;
  else if (r === 'MP1' || r === 'MP2') i = positionLabels(n).indexOf(r);
  else if (r === 'MP') { const L = positionLabels(n); i = L.indexOf('MP1') >= 0 ? L.indexOf('MP1') : L.indexOf('MP2') >= 0 ? L.indexOf('MP2') : n - 6; }
  else if (r === 'BTN/SB') i = -1;
  if (n === 3 && r === 'UTG') i = 0;
  return i >= 0 && i < n ? i : -1;
}

/* Preflop order without knowing the table size. */
const ORDER_RANK = {
  'UTG': 0, 'UTG+1': 1, 'UTG+2': 2, 'MP': 3, 'MP1': 3, 'MP2': 4, 'LJ': 5, 'HJ': 6, 'CO': 7,
  'BTN': 8, 'BTN/SB': 8, 'SB': 9, 'BB': 10,
};

// ─────────────────────────────────────────────────────────────────────────────
// Corpus loading + schema
// ─────────────────────────────────────────────────────────────────────────────

const EXPECT_KEYS = new Set([
  'gameType', 'gameMode', 'currency', 'blinds', 'players', 'heroPosition', 'heroCards',
  'heroStreetCards', 'stacks', 'stacksAll', 'effectiveStack', 'board', 'actions', 'draws',
  'studUp', 'showdown', 'winners',
]);
const CASE_KEYS = new Set(['id', 'source', 'game', 'text', 'expect', 'expectGaps', 'flaws', 'tags', 'notes', '_file', '_index']);
const BLIND_KEYS = new Set(['sb', 'bb', 'ante', 'bringIn', 'bigBet', 'straddle']);
const ACTIONS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all-in', 'bring-in']);
const GAP_KINDS = new Set(['missing', 'ambiguous', 'impossible']);

function loadCorpus(where) {
  const p = path.resolve(where || DEFAULT_CORPUS);
  const files = fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f))
    : [p];
  const cases = [];
  const loadErrors = [];
  for (const f of files) {
    let data;
    try { data = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { loadErrors.push(`${path.basename(f)}: not valid JSON (${e.message})`); continue; }
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.cases) ? data.cases : null);
    if (!list) { loadErrors.push(`${path.basename(f)}: expected an array of cases or { cases: [...] }`); continue; }
    list.forEach((c, i) => cases.push({ ...c, _file: path.basename(f), _index: i }));
  }
  return { cases, files, loadErrors };
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isIncomplete = c => Array.isArray(c.expectGaps) && c.expectGaps.length > 0;

function streetIndex(cat, key) { return (STREET_KEYS[cat] || []).indexOf(key); }

/* Every player reference an expectation uses. */
function collectRefs(ex) {
  const refs = new Set();
  for (const list of Object.values(ex.actions || {})) for (const a of list || []) refs.add(a[0]);
  for (const list of Object.values(ex.draws || {})) for (const d of list || []) refs.add(d[0]);
  for (const k of Object.keys(ex.showdown || {})) refs.add(k);
  for (const k of Object.keys(ex.stacks || {})) refs.add(k);
  for (const k of Object.keys(ex.studUp || {})) refs.add(k);
  for (const r of winnerRefs(ex.winners)) refs.add(r);
  return refs;
}
function winnerRefs(w) {
  if (!w) return [];
  if (Array.isArray(w)) return w;
  return w.refs || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation: schema, cards, betting legality, chip arithmetic
// ─────────────────────────────────────────────────────────────────────────────

function validateCase(c, seenIds) {
  const errors = [];
  const warnings = [];
  const E = m => errors.push(m);
  const W = m => warnings.push(m);

  if (typeof c.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) E('id must be lower-case kebab-case');
  else if (seenIds.has(c.id)) E(`duplicate id (also in ${seenIds.get(c.id)})`);
  else seenIds.set(c.id, c._file);
  if (c.source !== 'text' && c.source !== 'speech') E(`source must be 'text' or 'speech'`);
  if (typeof c.game !== 'string' || !HAND_CONFIG[c.game]) E(`game '${c.game}' is not a HAND_CONFIG game`);
  if (typeof c.text !== 'string' || c.text.trim().length < 15) E('text missing or too short');
  if (c.tags != null && (!Array.isArray(c.tags) || c.tags.some(t => typeof t !== 'string'))) E('tags must be an array of strings');
  for (const k of Object.keys(c)) if (!CASE_KEYS.has(k)) E(`unknown case key '${k}'`);
  const ex = c.expect;
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) { E('expect must be an object'); return { errors, warnings }; }
  for (const k of Object.keys(ex)) if (!EXPECT_KEYS.has(k)) E(`unknown expect key '${k}'`);
  if (Object.keys(ex).length === 0) E('expect is empty');
  if (ex.gameType != null && ex.gameType !== c.game) E(`expect.gameType '${ex.gameType}' differs from game '${c.game}'`);
  if (ex.gameMode != null && ex.gameMode !== 'cash' && ex.gameMode !== 'mtt') E(`gameMode must be cash|mtt`);
  if (ex.currency != null && ex.gameMode !== 'cash') E('currency given for a non-cash hand');
  if (ex.blinds) {
    for (const [k, v] of Object.entries(ex.blinds)) {
      if (!BLIND_KEYS.has(k)) E(`unknown blinds key '${k}'`);
      else if (k === 'straddle') {
        if (!Array.isArray(v) || v.some(t => !['utg', 'button', 'rock', 'mississippi'].includes(t))) E('blinds.straddle must list utg|button|rock|mississippi');
      } else if (!isNum(v) || v < 0) E(`blinds.${k} must be a non-negative number`);
    }
  }
  if (ex.players != null && (!Number.isInteger(ex.players) || ex.players < 2 || ex.players > 10)) E('players must be 2..10');
  if (c.expectGaps != null) {
    if (!Array.isArray(c.expectGaps)) E('expectGaps must be an array');
    else c.expectGaps.forEach((g, i) => {
      if (!g || typeof g !== 'object') { E(`expectGaps[${i}] must be an object`); return; }
      const kinds = g.kind == null ? [] : [].concat(g.kind);
      if (kinds.some(k => !GAP_KINDS.has(k))) E(`expectGaps[${i}].kind must be missing|ambiguous|impossible`);
      if (g.field == null && g.id == null) E(`expectGaps[${i}] needs a field or id pattern`);
      if (typeof g.about !== 'string' || !g.about) E(`expectGaps[${i}] needs an 'about' sentence`);
    });
  }
  if (c.source === 'speech' && /\b[2-9TJQKA][hdcs][2-9TJQKA][hdcs]\b/.test(c.text)) W('speech text contains typed card notation');

  if (errors.length) return { errors, warnings };
  const cat = categoryOf(c.game);
  const cfg = HAND_CONFIG[c.game];
  const keys = STREET_KEYS[cat];

  // Street keys.
  for (const k of Object.keys(ex.actions || {})) if (!keys.includes(k)) E(`actions.${k} is not a street of ${c.game} (${keys.join(', ')})`);
  for (const k of Object.keys(ex.draws || {})) if (!keys.includes(k)) E(`draws.${k} is not a street of ${c.game}`);
  if (ex.draws && cat !== 'draw_triple' && cat !== 'draw_single') E('draws given for a non-draw game');
  if (ex.board && cat !== 'community') E('board given for a game without one');
  if ((ex.studUp || ex.heroStreetCards) && cat !== 'stud') E('studUp/heroStreetCards given for a non-stud game');
  for (const [k, list] of Object.entries(ex.actions || {})) {
    if (!Array.isArray(list)) { E(`actions.${k} must be an array`); continue; }
    list.forEach((a, i) => {
      if (!Array.isArray(a) || a.length < 2 || a.length > 3) { E(`actions.${k}[${i}] must be [ref, action, amount?]`); return; }
      if (typeof a[0] !== 'string') E(`actions.${k}[${i}] ref must be a string`);
      if (!ACTIONS.has(a[1])) E(`actions.${k}[${i}] action '${a[1]}' unknown`);
      const needsAmt = ['call', 'bet', 'raise', 'all-in', 'bring-in'].includes(a[1]);
      if (needsAmt && a[2] === null) {
        if (!isIncomplete(c)) E(`actions.${k}[${i}] amount null (unknown) in a complete case`);
      } else if (needsAmt && !(isNum(a[2]) && a[2] > 0)) E(`actions.${k}[${i}] ${a[1]} needs a positive amount (chips ADDED), or null if the text leaves it unknown`);
      if (!needsAmt && a.length > 2) E(`actions.${k}[${i}] ${a[1]} takes no amount`);
    });
  }

  // References.
  const refs = collectRefs(ex);
  const heroRef = cat === 'stud' ? 'hero' : (ex.heroPosition || 'hero');
  if (cat === 'stud') {
    if (ex.heroPosition) E('stud hands identify players by door card: use refs "hero" and "@Kh", not heroPosition');
    for (const r of refs) if (r !== 'hero' && !/^@[2-9TJQKA][hdcsx]$/.test(r)) E(`stud ref '${r}' must be 'hero' or '@<door card>' ('@Kx' when the suit is unknown)`);
  } else {
    if (ex.heroPosition && refs.has('hero')) E(`ref 'hero' used although heroPosition '${ex.heroPosition}' is known — use the position`);
    const n = ex.players;
    const taken = new Map();
    for (const r of new Set([...refs, ...(ex.heroPosition ? [ex.heroPosition] : [])])) {
      if (r === 'hero') continue;
      if (normPos(r) !== r) E(`ref '${r}' should be written '${normPos(r)}'`);
      if (n) {
        const i = semanticIndex(r, n);
        if (i < 0) E(`ref '${r}' is not a seat at a ${n}-handed table`);
        else if (taken.has(i)) E(`refs '${taken.get(i)}' and '${r}' are the same seat at ${n}-handed`);
        else taken.set(i, r);
      } else if (!(r in ORDER_RANK)) E(`ref '${r}' is not a position label`);
    }
  }

  // Deliberate flaws: an incomplete case may break a rule on purpose (a card
  // dealt twice, a raise that is not a legal size) so the gaps engine has
  // something to catch. Declared flaws turn that class of error into a warning;
  // a declared flaw the validator cannot find is itself an error.
  const flaws = new Set(c.flaws || []);
  if (c.flaws != null) {
    if (!Array.isArray(c.flaws) || c.flaws.some(f => !FLAW_CLASSES.includes(f))) E(`flaws must list ${FLAW_CLASSES.join('|')}`);
    else if (!isIncomplete(c)) E('flaws on a case with no expectGaps');
  }
  const found = new Set();
  const route = (cls, m) => { if (flaws.has(cls)) { found.add(cls); W(`(deliberate ${cls}) ${m}`); } else E(m); };

  // Cards.
  for (const m of validateCards(c, ex, cat, cfg, heroRef)) route(cardErrorClass(m), m);

  // Betting simulation.
  let sim = null;
  if (!errors.length) {
    sim = simulate(c, ex, cat, cfg, heroRef);
    sim.problems.forEach(p => route('betting', `betting: ${p}`));
  }
  for (const f of flaws) if (!found.has(f) && !errors.length) E(`flaw '${f}' declared but the validator found no such problem`);
  return { errors, warnings, sim, cat, heroRef };
}

const FLAW_CLASSES = ['duplicate-card', 'card-count', 'draw', 'betting'];
function cardErrorClass(m) {
  if (/appears for both|repeats|twice|appears \d+ times/.test(m)) return 'duplicate-card';
  if (/not in hand|no draw follows/.test(m)) return 'draw';
  if (/cards?;|has \d+ cards|needs \d+ card|must be one card|discards \d+ cards|draws \d+ new|has \d+ up cards/.test(m)) return 'card-count';
  return 'notation';
}

function validateCards(c, ex, cat, cfg, heroRef) {
  const errs = [];
  const parse = (label, str) => {
    const cs = parseCardsStrict(str);
    if (!cs) errs.push(`${label} '${str}' is not legal card notation (AhKs, Kx, x)`);
    return cs || [];
  };
  const owners = new Map(); // owner -> list of cards (dupes inside an owner allowed only where noted)
  const add = (owner, cs) => { if (!owners.has(owner)) owners.set(owner, []); owners.get(owner).push(...cs); };

  // Hero.
  let hero = [];
  if (ex.heroCards != null) {
    hero = parse('heroCards', ex.heroCards);
    const want = cat === 'stud' ? 3 : cfg.heroCards;
    if (hero.length && hero.length !== want) errs.push(`heroCards has ${hero.length} cards; ${c.game} deals ${want}${cat === 'stud' ? ' on 3rd street (two down, then the door)' : ''} — pad unknowns with x`);
  }
  const heroList = hero.slice();
  if (ex.heroStreetCards) {
    for (const [k, v] of Object.entries(ex.heroStreetCards)) {
      if (!['4th', '5th', '6th', '7th'].includes(k)) errs.push(`heroStreetCards.${k} is not 4th..7th`);
      const cs = parse(`heroStreetCards.${k}`, v);
      if (cs.length !== 1) errs.push(`heroStreetCards.${k} must be one card`);
      heroList.push(...cs);
    }
  }

  // Draws: hero's hand evolves; discards must come from it.
  if (ex.draws) {
    let handNow = hero.slice();
    const keys = STREET_KEYS[cat];
    const max = cfg.heroCards;
    keys.forEach((k, si) => {
      const list = ex.draws[k];
      if (!list) return;
      if (si === keys.length - 1) errs.push(`draws.${k}: no draw follows the last betting round`);
      list.forEach((d, i) => {
        if (!Array.isArray(d) || d.length < 2 || d.length > 4) { errs.push(`draws.${k}[${i}] must be [ref, count, discarded?, new?]`); return; }
        const [ref, n, disc, neu] = d;
        if (!Number.isInteger(n) || n < 0 || n > max) errs.push(`draws.${k}[${i}] count ${n} out of range 0..${max}`);
        const dc = disc ? parse(`draws.${k}[${i}].discarded`, disc) : [];
        const nc = neu ? parse(`draws.${k}[${i}].new`, neu) : [];
        if (disc && dc.length !== n) errs.push(`draws.${k}[${i}] discards ${dc.length} cards but count is ${n}`);
        if (nc.length > n) errs.push(`draws.${k}[${i}] draws ${nc.length} new cards but count is ${n}`);
        if (ref === heroRef) {
          for (const x of dc.filter(isConcrete)) {
            const at = handNow.findIndex(h => isConcrete(h) && cardKey(h) === cardKey(x));
            if (at < 0 && handNow.length && handNow.every(isConcrete)) errs.push(`draws.${k}[${i}] hero discards ${cardKey(x)} which is not in hand ${cardsToString(handNow)}`);
            else if (at >= 0) handNow.splice(at, 1);
            else if (handNow.some(h => !isConcrete(h))) handNow.splice(handNow.findIndex(h => !isConcrete(h)), 1);
          }
          if (!disc) handNow.splice(0, Math.min(n, handNow.length));
          handNow.push(...nc, ...Array(Math.max(0, n - nc.length)).fill({ r: '?', s: 'x' }));
          heroList.push(...nc);
        } else {
          add('opp:' + ref, dc); add('opp:' + ref, nc);
        }
      });
    });
  }
  if (heroList.length) {
    const seen = new Set();
    for (const x of heroList.filter(isConcrete)) {
      if (seen.has(cardKey(x))) errs.push(`hero holds ${cardKey(x)} twice`);
      seen.add(cardKey(x));
    }
    add('hero', [...new Map(heroList.filter(isConcrete).map(x => [cardKey(x), x])).values()]);
    add('hero-ranks', heroList.filter(x => !isConcrete(x) && x.r !== '?'));
  }

  // Board.
  if (ex.board) {
    const sizes = { flop: 3, turn: 1, river: 1 };
    const b = [];
    for (const [k, v] of Object.entries(ex.board)) {
      if (!(k in sizes)) { errs.push(`board.${k} is not flop|turn|river`); continue; }
      const cs = parse(`board.${k}`, v);
      if (cs.length !== sizes[k]) errs.push(`board.${k} needs ${sizes[k]} card(s), has ${cs.length}`);
      b.push(...cs);
    }
    if (ex.board.river && !ex.board.turn) errs.push('board has a river but no turn');
    if (ex.board.turn && !ex.board.flop) errs.push('board has a turn but no flop');
    const seen = new Set();
    for (const x of b.filter(isConcrete)) { if (seen.has(cardKey(x))) errs.push(`board repeats ${cardKey(x)}`); seen.add(cardKey(x)); }
    add('board', b);
  }

  // Opponents.
  const studUp = ex.studUp || {};
  for (const [ref, v] of Object.entries(studUp)) {
    const cs = parse(`studUp.${ref}`, v);
    if (cs.length > 4) errs.push(`studUp.${ref} has ${cs.length} up cards; stud shows at most 4 (3rd..6th)`);
    if (cs.length && ref !== 'hero' && cardKey(cs[0]) !== ref.slice(1)) errs.push(`studUp.${ref} must start with the door card ${ref.slice(1)}`);
    if (ref === 'hero') errs.push('hero\'s up cards belong in heroCards/heroStreetCards, not studUp');
    add('opp:' + ref, cs);
  }
  if (cat === 'stud') {
    // Door cards named in refs are cards too.
    const refs = collectRefs(ex);
    for (const r of refs) if (r.startsWith('@')) add('opp:' + r, parseCardsStrict(r.slice(1)) || []);
  }
  for (const [ref, v] of Object.entries(ex.showdown || {})) {
    if (ref === heroRef || ref === 'hero') { errs.push('showdown is for opponents; hero\'s cards are heroCards (+ draws)'); continue; }
    const cs = parse(`showdown.${ref}`, v);
    const want = cat === 'stud' ? 7 : cfg.heroCards;
    if (cat === 'stud' ? cs.length > want : cs.length !== want) errs.push(`showdown.${ref} has ${cs.length} cards; ${c.game} wants ${want}`);
    add('opp:' + ref, cs);
  }

  // Cross-owner duplicates (dedupe within an owner: a stud up card also listed in a showdown is one card).
  const where = new Map();
  for (const [owner, cs] of owners) {
    if (owner === 'hero-ranks') continue;
    const mine = new Set(cs.filter(isConcrete).map(cardKey));
    for (const k of mine) {
      if (where.has(k)) errs.push(`card ${k} appears for both ${where.get(k)} and ${owner}`);
      else where.set(k, owner);
    }
  }
  // No rank can appear more than four times.
  const rankCount = {};
  for (const [owner, cs] of owners) {
    const uniq = owner === 'hero-ranks' ? cs : [...new Map(cs.map((x, i) => [isConcrete(x) ? cardKey(x) : 'u' + i, x])).values()];
    for (const x of uniq) if (x.r !== '?') rankCount[x.r] = (rankCount[x.r] || 0) + 1;
  }
  for (const [r, n] of Object.entries(rankCount)) if (n > 4) errs.push(`rank ${r} appears ${n} times`);
  return errs;
}

/* Replays the expected action against the stakes and returns legality problems,
   the action list with implicit preflop folds made explicit (for the oracle
   hand), and each action's raise-to total (for the "raise-to vs added" diagnostic). */
/* Rewrites every player reference to the replayer's own label for that seat
   (when the table size is known), so the simulation and the oracle hand speak
   the replayer's language while the corpus can say "UTG" at nine-handed. */
function canonicalizeRefs(ex, n) {
  const L = positionLabels(n);
  const m = r => (r === 'hero' ? 'hero' : L[semanticIndex(r, n)] || r);
  const mapKeys = o => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [m(k), v])) : o);
  const mapLists = o => (o ? Object.fromEntries(Object.entries(o).map(([k, list]) => [k, list.map(a => [m(a[0]), ...a.slice(1)])])) : o);
  const w = ex.winners;
  return {
    map: m,
    ex: {
      ...ex,
      heroPosition: ex.heroPosition ? m(ex.heroPosition) : ex.heroPosition,
      actions: mapLists(ex.actions),
      draws: mapLists(ex.draws),
      showdown: mapKeys(ex.showdown),
      stacks: mapKeys(ex.stacks),
      winners: !w ? w : Array.isArray(w) ? w.map(m) : { ...w, refs: (w.refs || []).map(m) },
    },
  };
}

function simulate(c, ex0, cat, cfg, heroRef0) {
  const problems = [];
  const P = m => problems.push(m);
  const keys = STREET_KEYS[cat];
  const isStud = cat === 'stud';
  const canon = !isStud && ex0.players ? canonicalizeRefs(ex0, ex0.players) : { map: r => r, ex: ex0 };
  const ex = canon.ex;
  const heroRef = canon.map(heroRef0);
  const b = ex.blinds || {};
  const betting = cfg.betting || 'nl';
  const stakesKnown = isNum(b.bb);
  const refs = collectRefs(ex);
  if (heroRef !== 'hero' || refs.has('hero')) refs.add(heroRef);
  const hu = ex.players === 2;

  // Seats in preflop order.
  let seats;
  let orderKnown = !isStud;
  if (isStud) {
    seats = [...refs];
    if (!seats.includes('hero')) seats.unshift('hero');
  } else if (ex.players) {
    seats = positionLabels(ex.players);
    if (refs.has('hero')) { seats = seats.slice(); orderKnown = false; seats.push('hero'); }
  } else {
    const s = new Set([...refs].filter(r => r !== 'hero'));
    s.add('SB'); s.add('BB');
    seats = [...s].sort((x, y) => ORDER_RANK[x] - ORDER_RANK[y]);
    if (refs.has('hero')) { orderKnown = false; seats.push('hero'); }
  }
  const nSeats = isStud ? (ex.players || seats.length) : seats.length;

  const stackOf = ref => {
    const st = ex.stacks || {};
    if (isNum(st[ref])) return st[ref];
    if (ref === heroRef && isNum(st.hero)) return st.hero;
    if (isNum(ex.stacksAll)) return ex.stacksAll;
    return Infinity;
  };
  const S = {};
  for (const s of seats) S[s] = { stack: stackOf(s), total: 0, folded: false, allIn: false };
  let pot = 0;
  let fuzzy = false; // set once an amount is unknown: chip arithmetic stops being checkable
  const put = (s, amt) => { S[s].total += amt; pot += amt; };

  const sbSeat = hu ? 'BTN/SB' : 'SB';
  const posts = {};
  const straddles = [];
  if (!isStud && !isNum(b.bb)) {
    // Stakes unknown: the blinds were still posted. Nominal amounts keep the
    // betting-order bookkeeping right; the arithmetic is not checkable.
    fuzzy = true;
    if (S[sbSeat]) { put(sbSeat, 0.5); posts[sbSeat] = 0.5; }
    if (S.BB) { put('BB', 1); posts.BB = 1; }
  } else if (!isStud) {
    if (isNum(b.sb) && S[sbSeat]) { put(sbSeat, b.sb); posts[sbSeat] = b.sb; }
    if (isNum(b.bb) && S.BB) { put('BB', b.bb); posts.BB = b.bb; }
    if (isNum(b.ante) && b.ante > 0 && S.BB) { S.BB.total += b.ante; pot += b.ante; } // BB ante: dead, not a bet
    if (b.straddle && b.straddle.length && isNum(b.bb)) {
      const seatFor = t => (t === 'utg' ? seats[0] : t === 'button' ? 'BTN' : null);
      const list = b.straddle.map(seatFor).filter(Boolean)
        .sort((x, y) => seats.indexOf(x) - seats.indexOf(y));
      list.forEach((s, i) => { const amt = b.bb * Math.pow(2, i + 1); put(s, amt); posts[s] = amt; straddles.push(s); });
      if (list.length < b.straddle.length) P('rock/mississippi straddles need a seat the validator cannot infer');
    }
  } else if (isNum(b.ante) && b.ante > 0) {
    for (const s of seats) S[s].total += b.ante;
    pot += b.ante * nSeats;
  }
  for (const s of seats) if (S[s].total > S[s].stack) P(`${s} cannot cover the blinds/ante`);

  const completed = {};
  const annotated = {};
  const hasLater = si => keys.slice(si + 1).some(k => (ex.actions && (ex.actions[k] || []).length)
    || (ex.board && ((k === 'flop' && ex.board.flop) || (k === 'turn' && ex.board.turn) || (k === 'river' && ex.board.river))))
    || winnerRefs(ex.winners).length > 0 || Object.keys(ex.showdown || {}).length > 0
    || keys.slice(si).some(k => (ex.draws && ex.draws[k] || []).length);
  const live = () => seats.filter(s => !S[s].folded);
  const canAct = () => seats.filter(s => !S[s].folded && !S[s].allIn);

  keys.forEach((key, si) => {
    const acts = (ex.actions && ex.actions[key]) || [];
    const out = [];
    const ann = [];
    completed[key] = out; annotated[key] = ann;
    const preflop = si === 0;
    const contrib = {};
    for (const s of seats) contrib[s] = preflop && !isStud ? (posts[s] || 0) : 0;
    let maxBet = preflop && !isStud ? Math.max(0, ...Object.values(posts)) : 0;
    let lastInc = preflop && !isStud ? maxBet : (isNum(b.bb) ? b.bb : 0);
    let raises = 0;
    const acted = new Set();
    const small = (cfg.flSmallStreets || [0, 1]).includes(si);
    const fixed = betting === 'fl' ? (small ? b.bb : (isNum(b.bigBet) ? b.bigBet : b.bb * 2)) : 0;
    const cap = cfg.raiseCap ? Math.max(cfg.raiseCap, 5) : 5;

    // Action order for this street.
    let order;
    if (isStud || !orderKnown) order = seats.slice();
    else if (hu) order = preflop ? ['BTN/SB', 'BB'] : ['BB', 'BTN/SB'];
    else if (preflop) {
      const start = straddles.length ? seats.indexOf(straddles[straddles.length - 1]) + 1 : 0;
      order = seats.map((_, i) => seats[(start + i) % seats.length]);
    } else {
      const rest = seats.filter(s => s !== 'SB' && s !== 'BB');
      order = ['SB', 'BB', ...rest].filter(s => S[s]);
    }
    let ptr = 0;
    const owes = s => !S[s].folded && !S[s].allIn && (!acted.has(s) || contrib[s] < maxBet);

    if (acts.length && live().length < 2) P(`${key}: action after the hand was already over`);
    if (acts.length && si > 0 && canAct().length < 2 && !acts.every(a => a[1] === 'fold')) {
      // Everyone (but at most one) is all-in: no more betting is possible.
      P(`${key}: betting after all but one player is all-in`);
    }

    acts.forEach((a, ai) => {
      const [ref, act, amt0] = a;
      const amt = amt0 || 0;
      const seat = ref === 'hero' ? 'hero' : ref;
      if (!S[seat]) { P(`${key}[${ai}]: unknown seat ${ref}`); return; }
      // Order.
      if (!isStud && orderKnown && seat !== 'hero') {
        let guard = 0;
        while (order[ptr % order.length] !== seat && guard++ < order.length * 3) {
          const s = order[ptr % order.length];
          if (owes(s)) {
            if (preflop) { S[s].folded = true; out.push([s, 'fold']); }
            else P(`${key}[${ai}]: ${s} was skipped (state their check/fold)`);
          }
          ptr++;
        }
        ptr++;
        if (!owes(seat) && act !== 'fold') P(`${key}[${ai}]: ${seat} acts but the action was not on them`);
      }
      if (S[seat].folded) P(`${key}[${ai}]: ${seat} acts after folding`);
      if (S[seat].allIn) P(`${key}[${ai}]: ${seat} acts after being all-in`);
      const before = contrib[seat];
      const toCall = maxBet - before;
      const remaining = S[seat].stack - S[seat].total;
      const potBefore = pot;
      acted.add(seat);
      // An amount the text leaves unknown: keep the order bookkeeping going with a
      // stand-in size, and stop checking chip arithmetic for the rest of the hand.
      if (amt0 === null && act !== 'fold' && act !== 'check') {
        fuzzy = true;
        let newTotal;
        if (act === 'call') newTotal = Math.max(before, maxBet);
        else if (act === 'bring-in') newTotal = isNum(b.bringIn) ? b.bringIn : 1;
        else newTotal = maxBet + Math.max(lastInc, fixed || 0, 1);
        if (act === 'all-in') S[seat].allIn = true;
        if (newTotal > maxBet && act !== 'bring-in') { lastInc = Math.max(newTotal - maxBet, lastInc); raises++; }
        if (act === 'call' && toCall <= 0) P(`${key}[${ai}]: ${seat} calls with nothing to call`);
        if ((act === 'bet') && maxBet > 0 && !(isStud && si === 0 && raises <= 1)) P(`${key}[${ai}]: 'bet' facing a bet — that is a raise`);
        const add = newTotal - before;
        contrib[seat] = newTotal; S[seat].total += add; pot += add; maxBet = Math.max(maxBet, newTotal);
        out.push([seat, act, null]);
        ann.push({ ref, act, amt: null, to: null, before });
        return;
      }
      const A = m => { if (!fuzzy) P(m); };
      const aggressive = (newTotal, isAllIn) => {
        if (stakesKnown) {
          if (betting === 'nl') {
            if (maxBet === 0 && isNum(b.bb) && newTotal < b.bb && !isAllIn) A(`${key}[${ai}]: bet ${newTotal} is below the big blind`);
            if (maxBet > 0 && newTotal - maxBet < lastInc && !isAllIn) A(`${key}[${ai}]: raise to ${newTotal} is below the minimum (${maxBet + lastInc})`);
          } else if (betting === 'pl') {
            const maxTo = maxBet + potBefore + toCall;
            if (newTotal > maxTo + 1e-9) A(`${key}[${ai}]: pot-limit raise to ${newTotal} exceeds the pot (max ${maxTo})`);
            if (maxBet > 0 && newTotal - maxBet < lastInc && !isAllIn) A(`${key}[${ai}]: raise to ${newTotal} is below the minimum (${maxBet + lastInc})`);
          } else if (betting === 'fl') {
            const studComplete = isStud && si === 0 && raises === 0 && isNum(b.bringIn) && maxBet <= b.bringIn;
            const want = studComplete ? fixed : maxBet + fixed;
            const bigOk = isStud && si === 1 && isNum(b.bigBet) && newTotal === (raises === 0 ? b.bigBet : maxBet + b.bigBet);
            if (newTotal !== want && !bigOk && !isAllIn) A(`${key}[${ai}]: limit ${act} makes it ${newTotal}; the fixed size makes it ${want}`);
            if (raises >= cap && canAct().length > 2) A(`${key}[${ai}]: raise beyond the ${cap}-bet cap`);
          }
        }
        // An all-in short of a full raise does not change the minimum raise.
        const inc = newTotal - maxBet;
        if (maxBet === 0) lastInc = newTotal;
        else if (inc >= lastInc) lastInc = inc;
        maxBet = newTotal;
        raises++;
      };
      switch (act) {
        case 'fold':
          S[seat].folded = true; break;
        case 'check':
          if (toCall > 0) P(`${key}[${ai}]: ${seat} checks facing ${toCall}`);
          break;
        case 'call': {
          if (toCall <= 0) { P(`${key}[${ai}]: ${seat} calls with nothing to call`); break; }
          if (amt > remaining + 1e-9) A(`${key}[${ai}]: ${seat} calls ${amt} with only ${remaining} behind`);
          if (Math.abs(amt - toCall) > 1e-9) {
            if (amt < toCall && Math.abs(amt - remaining) < 1e-9) S[seat].allIn = true;
            else A(`${key}[${ai}]: ${seat} calls ${amt}; the call is ${toCall} (amounts are chips ADDED)`);
          } else if (Math.abs(amt - remaining) < 1e-9) S[seat].allIn = true;
          const add = fuzzy ? toCall : amt; // after an unknown amount, a call simply matches
          contrib[seat] += add; put(seat, add); break;
        }
        case 'bet':
        case 'raise': {
          const studComplete = isStud && si === 0 && isNum(b.bringIn) && maxBet > 0 && maxBet <= b.bringIn && raises === 0;
          if (act === 'bet' && maxBet > 0 && !studComplete) P(`${key}[${ai}]: 'bet' facing a bet of ${maxBet} — that is a raise`);
          if (act === 'raise' && (maxBet === 0 || studComplete)) P(`${key}[${ai}]: 'raise' with no bet to raise${studComplete ? ' (a stud completion is a bet)' : ''}`);
          if (amt > remaining + 1e-9) A(`${key}[${ai}]: ${seat} puts in ${amt} with only ${remaining} behind`);
          let newTotal = before + amt;
          if (fuzzy && newTotal <= maxBet) newTotal = maxBet + Math.max(lastInc, 1);
          const isAllIn = Math.abs(amt - remaining) < 1e-9;
          if (isAllIn) S[seat].allIn = true;
          if (newTotal <= maxBet) A(`${key}[${ai}]: ${act} to ${newTotal} does not exceed the current bet ${maxBet} (amounts are chips ADDED)`);
          else aggressive(newTotal, isAllIn);
          contrib[seat] = newTotal; put(seat, newTotal - before); break;
        }
        case 'all-in': {
          if (remaining === Infinity) { S[seat].stack = S[seat].total + amt; }
          else if (Math.abs(amt - remaining) > 1e-9) A(`${key}[${ai}]: ${seat} all-in for ${amt} but has ${remaining} behind`);
          const newTotal = before + amt;
          if (newTotal > maxBet) aggressive(newTotal, true);
          S[seat].allIn = true;
          contrib[seat] = newTotal; put(seat, amt); break;
        }
        case 'bring-in': {
          if (!isStud || si !== 0) P(`${key}[${ai}]: bring-in outside stud 3rd street`);
          if (ai !== 0) P(`${key}[${ai}]: the bring-in is the first action`);
          if (isNum(b.bringIn) && amt !== b.bringIn) A(`${key}[${ai}]: bring-in ${amt} but blinds.bringIn is ${b.bringIn}`);
          contrib[seat] = amt; put(seat, amt); maxBet = Math.max(maxBet, amt); break;
        }
      }
      out.push(a.length > 2 ? [seat, act, amt0] : [seat, act]);
      ann.push({ ref, act, amt, to: contrib[seat], before });
    });

    // Close the round.
    if (hasLater(si) && live().length > 1) {
      for (const s of order) {
        if (S[s].folded || S[s].allIn) continue;
        if (contrib[s] < maxBet) {
          if (preflop && !isStud) { S[s].folded = true; out.push([s, 'fold']); }
          else if (orderKnown || isStud) P(`${key}: ${s} never matched the bet of ${maxBet}`);
        } else if (!acted.has(s) && canAct().length > 1 && orderKnown && !isStud) {
          P(`${key}: ${s} never acted (state the check)`);
        }
      }
    }
    // Stud bring-in seat check, when every door card is known.
    if (isStud && si === 0 && acts.length && acts[0][1] === 'bring-in') {
      const doors = [];
      const hc = parseCardsStrict(ex.heroCards || '') || [];
      if (hc[2] && isConcrete(hc[2])) doors.push(['hero', hc[2]]);
      for (const s of seats) if (s.startsWith('@')) doors.push([s, parseCardsStrict(s.slice(1))[0]]);
      if (doors.length === nSeats) {
        const isRazz = c.game === 'Razz';
        // The replayer's findStudBringIn. Higher = worse door. Stud: the low card brings
        // it in (deuce worst, clubs worst); razz: the high card (king worst, spades worst).
        const rankBad = r => (isRazz ? 'A23456789TJQK'.indexOf(r) : 'AKQJT98765432'.indexOf(r));
        const suitBad = s => (isRazz ? 'cdhs' : 'shdc').indexOf(s);
        let worst = null;
        for (const [s, d] of doors) {
          if (!worst || rankBad(d.r) > rankBad(worst[1].r) || (rankBad(d.r) === rankBad(worst[1].r) && suitBad(d.s) > suitBad(worst[1].s))) worst = [s, d];
        }
        if (worst[0] !== acts[0][0]) P(`3rd: ${acts[0][0]} brings in, but ${worst[0]} has the ${isRazz ? 'highest' : 'lowest'} door card`);
      }
    }
    // A draw recorded on this street happens after its betting: only live players draw.
    for (const d of (ex.draws && ex.draws[key]) || []) {
      if (S[d[0]] && S[d[0]].folded) P(`draws.${key}: ${d[0]} draws after folding`);
      else if (!S[d[0]]) P(`draws.${key}: unknown seat ${d[0]}`);
    }
  });

  const remainingLive = live();
  for (const r of winnerRefs(ex.winners)) if (S[r] && S[r].folded) P(`winner ${r} folded`);
  if (remainingLive.length === 1 && winnerRefs(ex.winners).length && winnerRefs(ex.winners)[0] !== remainingLive[0] && !isIncomplete(c)) {
    P(`only ${remainingLive[0]} is left, but the winner is ${winnerRefs(ex.winners).join(',')}`);
  }
  for (const r of Object.keys(ex.showdown || {})) if (S[r] && S[r].folded) P(`showdown: ${r} folded`);
  return { problems, completed, annotated, seats, orderKnown, pot, stacks: S, seatOf: canon.map, heroSeat: heroRef, cex: ex };
}

// ─────────────────────────────────────────────────────────────────────────────
// Oracle hand: the expectations rendered in the replayer's hand format
// ─────────────────────────────────────────────────────────────────────────────

function streetNames(cat) {
  return {
    community: ['Preflop', 'Flop', 'Turn', 'River'],
    draw_triple: ['Pre-Draw', 'First Draw', 'Second Draw', 'Third Draw'],
    draw_single: ['Pre-Draw', 'Draw'],
    stud: ['3rd Street', '4th Street', '5th Street', '6th Street', '7th Street'],
  }[cat];
}

function buildOracleHand(c, v) {
  const { cat, sim } = v;
  const ex = sim.cex;            // refs already rewritten to the replayer's seat labels
  const heroRef = sim.heroSeat;
  const isStud = cat === 'stud';
  let seats = sim.seats.slice();
  if (isStud && ex.players && ex.players > seats.length) {
    for (let i = seats.length; i < ex.players; i++) seats.push('?seat' + i);
  }
  const n = seats.length;
  const heroIdx = seats.indexOf(heroRef) >= 0 ? seats.indexOf(heroRef) : (seats.indexOf('hero') >= 0 ? seats.indexOf('hero') : null);
  const involved = new Set([heroRef]);
  for (const list of Object.values(ex.actions || {})) for (const a of list) if (a[1] !== 'fold') involved.add(a[0]);
  const stackFor = s => {
    if (ex.stacks && isNum(ex.stacks[s])) return ex.stacks[s];
    if (s === heroRef && ex.stacks && isNum(ex.stacks.hero)) return ex.stacks.hero;
    if (isNum(ex.stacksAll)) return ex.stacksAll;
    if (isNum(ex.effectiveStack) && involved.has(s)) return ex.effectiveStack;
    return null;
  };
  const players = seats.map((s, i) => ({
    name: i === heroIdx ? 'Hero' : (s.startsWith('@') ? 'Door ' + s.slice(1) : s),
    position: isStud ? 'Seat ' + (i + 1) : (s === 'hero' ? '' : s),
    startingStack: stackFor(s),
  }));
  const slotOf = i => (heroIdx == null ? i : i < heroIdx ? i : i - 1);
  const names = streetNames(cat);
  const keys = STREET_KEYS[cat];
  const streets = names.map((name, si) => ({
    name,
    cards: { hero: '', opponents: Array.from({ length: Math.max(0, n - (heroIdx == null ? 0 : 1)) }, () => ''), board: '' },
    actions: [],
    draws: [],
  }));
  if (ex.heroCards) streets[0].cards.hero = ex.heroCards;
  if (isStud && ex.heroStreetCards) for (const [k, v2] of Object.entries(ex.heroStreetCards)) streets[keys.indexOf(k)].cards.hero = v2;
  if (ex.board) {
    if (ex.board.flop) streets[1].cards.board = ex.board.flop;
    if (ex.board.turn) streets[2].cards.board = ex.board.turn;
    if (ex.board.river) streets[3].cards.board = ex.board.river;
  }
  const idxOf = ref => seats.indexOf(ref === 'hero' && heroRef !== 'hero' ? heroRef : ref);
  if (isStud) {
    seats.forEach((s, i) => {
      if (!s.startsWith('@')) return;
      const ups = parseCardsStrict((ex.studUp || {})[s] || s.slice(1)) || [];
      ups.forEach((card, k) => { streets[k].cards.opponents[slotOf(i)] = cardKey(card); });
      const sd = (ex.showdown || {})[s];
      if (sd) {
        const upKeys = new Set(ups.map(cardKey));
        const rest = parseCardsStrict(sd).filter(x => !upKeys.has(cardKey(x)));
        streets[4].cards.opponents[slotOf(i)] += cardsToString(rest);
      }
    });
  } else {
    for (const [ref, v2] of Object.entries(ex.showdown || {})) {
      const i = idxOf(ref);
      if (i >= 0 && i !== heroIdx) streets[0].cards.opponents[slotOf(i)] = v2;
    }
  }
  keys.forEach((k, si) => {
    for (const a of sim.completed[k] || []) {
      const i = idxOf(a[0]);
      // An amount the text never gave stays null in the partial hand, never guessed.
      streets[si].actions.push({ player: i, action: a[1], amount: a[2] === null ? null : (a[2] || 0) });
    }
    for (const d of (ex.draws || {})[k] || []) {
      streets[si].draws.push({ player: idxOf(d[0]), discarded: d[1], discardedCards: d[2] || '', newCards: d[3] || '' });
    }
  });
  const b = ex.blinds ? { ...ex.blinds } : null;
  if (b && b.straddle) {
    const types = b.straddle; delete b.straddle;
    b.straddle = types.length > 0;
    for (const t of types) b['straddle_' + t] = true;
  }
  const w = ex.winners;
  const result = w ? { winners: winnerRefs(w).map(r => ({ playerIdx: idxOf(r), split: !Array.isArray(w) && !!w.split })) } : null;
  return {
    gameType: ex.gameType || null,
    gameMode: ex.gameMode || null,
    ...(ex.currency ? { currency: ex.currency } : {}),
    blinds: b,
    players,
    heroIdx,
    streets,
    result,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring a parsed hand against the expectations
// ─────────────────────────────────────────────────────────────────────────────

const FACT_CATEGORIES = ['game', 'stakes', 'table', 'hero', 'board', 'stacks', 'actions', 'draws', 'showdown', 'result'];

function handContext(hand, cat) {
  const ok = hand && typeof hand === 'object';
  const players = ok && Array.isArray(hand.players) ? hand.players : [];
  const n = players.length;
  const heroIdx = ok && Number.isInteger(hand.heroIdx) ? hand.heroIdx : -1;
  const labels = n ? positionLabels(n) : [];
  const canonical = n > 0 && players.every((p, i) => p && normPos(p.position) === labels[i]);
  const streets = ok && Array.isArray(hand.streets) ? hand.streets : [];
  const slotOf = i => (heroIdx < 0 ? i : i < heroIdx ? i : i - 1);
  const oppCards = (si, i) => {
    const st = streets[si];
    const opps = st && st.cards && Array.isArray(st.cards.opponents) ? st.cards.opponents : [];
    return opps[slotOf(i)] || '';
  };
  const doorOf = i => {
    if (i === heroIdx) {
      const h = parseCardsLoose(streets[0] && streets[0].cards && streets[0].cards.hero);
      return h[2] && h[2].r !== '?' ? h[2] : null;
    }
    const cs = parseCardsLoose(oppCards(0, i)).filter(x => x.r !== '?');
    return cs[0] || null;
  };
  const resolve = ref => {
    if (!n) return -1;
    if (ref === 'hero') return heroIdx;
    if (cat === 'stud') {
      // '@Kh' is whoever shows the Kh as a door card; '@Kx' whoever shows a king.
      const d = ref.startsWith('@') ? (parseCardsStrict(ref.slice(1)) || [])[0] : null;
      if (!d) return -1;
      for (let i = 0; i < n; i++) if (i !== heroIdx && doorOf(i) && cardCompatible(d, doorOf(i))) return i;
      return -1;
    }
    const r = normPos(ref);
    // A parse that uses the replayer's own labels is read by seat index (so "UTG"
    // at nine-handed finds the seat labelled UTG+1); one that labels seats its own
    // way is read by its labels.
    if (canonical) return semanticIndex(r, n);
    for (let i = 0; i < n; i++) if (normPos(players[i] && players[i].position) === r) return i;
    return semanticIndex(r, n);
  };
  return { ok, hand, players, n, heroIdx, labels, streets, slotOf, oppCards, resolve, cat };
}

const numEq = (a, b) => isNum(a) && isNum(b) && Math.abs(a - b) < 1e-6;
const present = v => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);

const ACT_SYNONYM = { allin: 'all-in', 'all in': 'all-in', jam: 'all-in', shove: 'all-in', bringin: 'bring-in', 'bring in': 'bring-in', complete: 'bet', checks: 'check', calls: 'call', bets: 'bet', raises: 'raise', folds: 'fold' };
const normAct = a => { const s = String(a || '').toLowerCase().trim(); return ACT_SYNONYM[s] || s; };
/* bet and raise are one class (a stud completion is stored as either); an
   all-in matches a bet, raise or call of the same chips. */
function actCompatible(e, p) {
  if (e === p) return true;
  const agg = x => x === 'bet' || x === 'raise';
  if (agg(e) && agg(p)) return true;
  if (e === 'all-in' && (agg(p) || p === 'call')) return true;
  if (p === 'all-in' && (agg(e) || e === 'call')) return true;
  return false;
}

function lcsAlign(E, Pp, eq) {
  const m = E.length, k = Pp.length;
  const T = Array.from({ length: m + 1 }, () => new Array(k + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = k - 1; j >= 0; j--) {
    T[i][j] = eq(E[i], Pp[j]) ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < m && j < k) {
    if (eq(E[i], Pp[j])) { pairs.push([i, j]); i++; j++; }
    else if (T[i + 1][j] >= T[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

function scoreCase(c, v, hand) {
  const ex = c.expect;
  const cat = v.cat;
  const keys = STREET_KEYS[cat];
  const ctx = handContext(hand, cat);
  const facts = [];
  const F = (key, category, expected, got, ok) => {
    facts.push({ key, category, expected, got: got === undefined ? null : got, status: ok ? 'ok' : (present(got) ? 'wrong' : 'missing') });
  };
  const H = ctx.ok ? hand : {};
  const hb = H.blinds || {};

  if (ex.gameType != null) F('gameType', 'game', ex.gameType, H.gameType, H.gameType === ex.gameType);
  if (ex.gameMode != null) F('gameMode', 'game', ex.gameMode, H.gameMode, H.gameMode === ex.gameMode);
  if (ex.currency != null) F('currency', 'game', ex.currency, H.currency, String(H.currency || '').toUpperCase() === ex.currency);
  if (ex.blinds) {
    for (const [k, val] of Object.entries(ex.blinds)) {
      if (k === 'straddle') {
        const got = ['utg', 'button', 'rock', 'mississippi'].filter(t => hb['straddle_' + t]);
        const ok = !!hb.straddle && got.length === val.length && val.every(t => got.includes(t));
        F('blinds.straddle', 'stakes', val.join(','), got.length ? got.join(',') : (hb.straddle ? 'yes' : null), ok);
      } else if (k === 'bigBet') {
        const got = isNum(hb.bigBet) ? hb.bigBet : (isNum(hb.bb) ? hb.bb * 2 : null);
        F('blinds.bigBet', 'stakes', val, got, numEq(got, val));
      } else F('blinds.' + k, 'stakes', val, hb[k], numEq(hb[k], val));
    }
  }
  if (ex.players != null) F('players', 'table', ex.players, ctx.n || null, ctx.n === ex.players);
  if (ex.heroPosition != null) {
    const got = ctx.heroIdx >= 0 ? (ctx.players[ctx.heroIdx] || {}).position || ctx.labels[ctx.heroIdx] : null;
    F('heroPosition', 'hero', ex.heroPosition, got, ctx.heroIdx >= 0 && ctx.resolve(ex.heroPosition) === ctx.heroIdx);
  }
  const heroStr = si => (ctx.streets[si] && ctx.streets[si].cards && ctx.streets[si].cards.hero) || '';
  if (ex.heroCards != null) {
    const e = parseCardsStrict(ex.heroCards), p = parseCardsLoose(heroStr(0));
    let ok;
    // Stud 3rd street is two down then the door: the door's slot matters.
    if (cat === 'stud' && e.length === 3) ok = p.length === 3 && cardCompatible(e[2], p[2]) && cardsMatch(e.slice(0, 2), p.slice(0, 2));
    else ok = cardsMatch(e, p);
    F('heroCards', 'hero', ex.heroCards, heroStr(0) || null, ok);
  }
  for (const [k, val] of Object.entries(ex.heroStreetCards || {})) {
    const si = keys.indexOf(k);
    F('heroStreetCards.' + k, 'hero', val, heroStr(si) || null, cardsMatch(parseCardsStrict(val), parseCardsLoose(heroStr(si))));
  }
  const stackOfIdx = i => (i >= 0 && ctx.players[i] ? ctx.players[i].startingStack : null);
  for (const [ref, val] of Object.entries(ex.stacks || {})) {
    const i = ctx.resolve(ref);
    F('stacks.' + ref, 'stacks', val, stackOfIdx(i), numEq(stackOfIdx(i), val));
  }
  if (ex.stacksAll != null) {
    const got = ctx.players.map(p => p.startingStack);
    F('stacksAll', 'stacks', ex.stacksAll, got.length ? got.join(',') : null, got.length > 0 && got.every(s => numEq(s, ex.stacksAll)));
  }
  // Involved players in the parse: hero plus anyone with a non-fold action.
  const involved = new Set(ctx.heroIdx >= 0 ? [ctx.heroIdx] : []);
  ctx.streets.forEach(st => (st.actions || []).forEach(a => { if (normAct(a.action) !== 'fold' && Number.isInteger(a.player)) involved.add(a.player); }));
  if (ex.effectiveStack != null) {
    const hs = stackOfIdx(ctx.heroIdx);
    const others = [...involved].filter(i => i !== ctx.heroIdx).map(stackOfIdx).filter(isNum);
    const eff = isNum(hs) && others.length ? Math.min(hs, Math.max(...others)) : null;
    F('effectiveStack', 'stacks', ex.effectiveStack, eff, numEq(eff, ex.effectiveStack));
  }
  if (ex.board) {
    const at = { flop: 1, turn: 2, river: 3 };
    for (const [k, val] of Object.entries(ex.board)) {
      const st = ctx.streets[at[k]];
      const got = (st && st.cards && st.cards.board) || '';
      F('board.' + k, 'board', val, got || null, cardsMatch(parseCardsStrict(val), parseCardsLoose(got)));
    }
  }

  // Actions: align each street's expected sequence with the parsed one.
  const actionDiag = [];
  let extraActions = 0;
  let inventedActions = 0;
  keys.forEach((k, si) => {
    const E = (ex.actions && ex.actions[k]) || [];
    const st = ctx.streets[si];
    const parsedAll = (st && Array.isArray(st.actions) ? st.actions : []).map(a => ({ player: a.player, act: normAct(a.action), amt: Number(a.amount) || 0 }));
    const expFoldSeats = new Set(E.filter(a => a[1] === 'fold').map(a => ctx.resolve(a[0])));
    const Pp = parsedAll.filter(a => a.act !== 'fold' || expFoldSeats.has(a.player));
    const eq = (e, p) => ctx.resolve(e[0]) === p.player && p.player >= 0 && actCompatible(e[1], p.act)
      && (e[1] === 'fold' || e[1] === 'check' || e[2] == null || numEq(e[2], p.amt));
    const pairs = E.length && Pp.length ? lcsAlign(E, Pp, eq) : [];
    const matchedE = new Set(pairs.map(x => x[0]));
    const matchedP = new Set(pairs.map(x => x[1]));
    E.forEach((e, i) => {
      // For a miss, report the parsed action by the same seat with a compatible verb, if
      // any. It is then a WRONG value, so it is not also counted as an extra action.
      let got = null;
      if (!matchedE.has(i)) {
        const seat = ctx.resolve(e[0]);
        const j = Pp.findIndex((p, jj) => !matchedP.has(jj) && p.player === seat && actCompatible(e[1], p.act));
        const cand = j >= 0 ? Pp[j] : null;
        if (cand) {
          matchedP.add(j);
          got = `${cand.act} ${cand.amt}`;
          const ann = (v.sim.annotated[k] || [])[i];
          if (ann && ['bet', 'raise', 'all-in'].includes(e[1]) && ann.before > 0 && numEq(cand.amt, ann.to)) actionDiag.push({ kind: 'raise-to-not-added', key: `actions.${k}.${i}`, expected: e[2], got: cand.amt });
          else if (ann && e[1] === 'call' && numEq(cand.amt, ann.to)) actionDiag.push({ kind: 'call-total-not-added', key: `actions.${k}.${i}`, expected: e[2], got: cand.amt });
        }
      }
      F(`actions.${k}.${i}`, 'actions', e.slice(0, 3).join(' '), matchedE.has(i) ? e.slice(0, 3).join(' ') : got, matchedE.has(i));
    });
    const extra = Pp.filter((_, j) => !matchedP.has(j));
    if (E.length) extraActions += extra.length;
    else inventedActions += extra.filter(a => a.act !== 'fold').length;
  });

  // Draws.
  for (const [k, list] of Object.entries(ex.draws || {})) {
    const si = keys.indexOf(k);
    const st = ctx.streets[si];
    const pd = st && Array.isArray(st.draws) ? st.draws : [];
    list.forEach(d => {
      const i = ctx.resolve(d[0]);
      const got = pd.find(x => x.player === i && i >= 0);
      let ok = !!got && Number(got.discarded) === d[1];
      if (ok && d[2]) ok = cardsMatch(parseCardsStrict(d[2]), parseCardsLoose(got.discardedCards));
      if (ok && d[3]) ok = cardsSubset(parseCardsStrict(d[3]), parseCardsLoose(got.newCards));
      F(`draws.${k}.${d[0]}`, 'draws', d.slice(1).filter(x => x !== undefined && x !== '').join(' '), got ? [got.discarded, got.discardedCards, got.newCards].filter(x => x !== '' && x != null).join(' ') : null, ok);
    });
  }
  // Stud up cards and showdowns.
  for (const [ref, val] of Object.entries(ex.studUp || {})) {
    const i = ctx.resolve(ref);
    (parseCardsStrict(val) || []).forEach((card, kIdx) => {
      if (kIdx === 0) return; // the door is how the ref resolved at all
      const got = i >= 0 ? parseCardsLoose(ctx.oppCards(kIdx, i)).filter(x => x.r !== '?')[0] : null;
      F(`studUp.${ref}.${keys[kIdx]}`, 'showdown', cardKey(card), got ? cardKey(got) : null, !!got && cardCompatible(card, got));
    });
  }
  for (const [ref, val] of Object.entries(ex.showdown || {})) {
    const i = ctx.resolve(ref);
    let got = '';
    if (i >= 0 && i !== ctx.heroIdx) {
      got = cat === 'stud' ? keys.map((_, si) => ctx.oppCards(si, i)).join('') : ctx.oppCards(0, i);
    }
    const e = parseCardsStrict(val), p = parseCardsLoose(got).filter(x => x.r !== '?' || cat !== 'stud');
    F('showdown.' + ref, 'showdown', val, got || null, cat === 'stud' ? cardsSubset(e.filter(x => x.r !== '?'), p) : cardsMatch(e, p));
  }
  if (ex.winners) {
    const want = winnerRefs(ex.winners).map(r => ctx.resolve(r));
    const gotW = (H.result && Array.isArray(H.result.winners) ? H.result.winners : []).map(w => w.playerIdx);
    let ok = want.length === gotW.length && want.every(i => i >= 0 && gotW.includes(i));
    if (ok && !Array.isArray(ex.winners) && ex.winners.split) ok = H.result.winners.every(w => w.split);
    F('winners', 'result', winnerRefs(ex.winners).join(','), gotW.length ? gotW.map(i => (ctx.players[i] || {}).position || i).join(',') : null, ok);
  }

  // Hallucinations: cards and stacks the text never stated.
  const statedConcrete = new Set();
  const statedRanks = {};
  const noteCards = str => (parseCardsStrict(str) || []).forEach(x => {
    if (isConcrete(x)) statedConcrete.add(cardKey(x));
    else if (x.r !== '?') statedRanks[x.r] = (statedRanks[x.r] || 0) + 1;
  });
  if (ex.heroCards) noteCards(ex.heroCards);
  Object.values(ex.heroStreetCards || {}).forEach(noteCards);
  Object.values(ex.board || {}).forEach(noteCards);
  Object.values(ex.showdown || {}).forEach(noteCards);
  Object.values(ex.studUp || {}).forEach(noteCards);
  Object.keys(ex.studUp || {}).concat([...collectRefs(ex)]).filter(r => r.startsWith('@')).forEach(r => noteCards(r.slice(1)));
  Object.values(ex.draws || {}).forEach(list => list.forEach(d => { if (d[2]) noteCards(d[2]); if (d[3]) noteCards(d[3]); }));
  const parsedCards = [];
  ctx.streets.forEach(st => {
    const cs = st.cards || {};
    parsedCards.push(...parseCardsLoose(cs.hero), ...parseCardsLoose(cs.board));
    (Array.isArray(cs.opponents) ? cs.opponents : []).forEach(o => parsedCards.push(...parseCardsLoose(o)));
    (Array.isArray(st.draws) ? st.draws : []).forEach(d => parsedCards.push(...parseCardsLoose(d.discardedCards), ...parseCardsLoose(d.newCards)));
  });
  const seenParsed = new Set();
  const inventedCards = [];
  const inventedSuits = [];
  const rankPool = { ...statedRanks };
  for (const x of parsedCards.filter(isConcrete)) {
    const k = cardKey(x);
    if (seenParsed.has(k)) continue; // one physical card may legitimately appear on two streets (stud showdowns)
    seenParsed.add(k);
    if (statedConcrete.has(k)) continue;
    if (rankPool[x.r] > 0) { rankPool[x.r]--; inventedSuits.push(k); continue; }
    inventedCards.push(k);
  }
  const inventedStacks = [];
  ctx.players.forEach((p, i) => {
    if (!(isNum(p.startingStack) && p.startingStack > 0)) return;
    if (ex.stacksAll != null) return;
    const stated = Object.keys(ex.stacks || {}).some(r => ctx.resolve(r) === i);
    if (stated) return;
    if (ex.effectiveStack != null && involved.has(i)) return;
    inventedStacks.push(`${p.position || i}=${p.startingStack}`);
  });

  const expected = facts.length;
  const ok = facts.filter(f => f.status === 'ok').length;
  const wrong = facts.filter(f => f.status === 'wrong').length;
  const asserted = ok + wrong + extraActions + inventedActions;
  return {
    facts,
    expected,
    ok,
    wrong,
    missing: expected - ok - wrong,
    extraActions,
    inventedActions,
    recall: expected ? ok / expected : 1,
    precision: asserted ? ok / asserted : (expected ? 0 : 1),
    hallucinations: { cards: inventedCards, suits: inventedSuits, stacks: inventedStacks, actions: inventedActions },
    diagnostics: actionDiag,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gaps
// ─────────────────────────────────────────────────────────────────────────────

/* A field pattern is a dotted path; '*' matches one segment, '**' any tail, and
   a pattern matches any field it is a prefix of ('streets.0.actions' matches
   'streets.0.actions.3'). An id pattern matches a gap id it is a prefix of. */
function fieldMatches(pattern, field) {
  if (typeof field !== 'string') return false;
  const p = pattern.split('.');
  const f = field.split('.');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '**') return true;
    if (i >= f.length) return false;
    if (p[i] !== '*' && p[i] !== f[i]) return false;
  }
  return true;
}
function gapMatches(eg, g) {
  if (!g || typeof g !== 'object') return false;
  const kinds = eg.kind == null ? null : [].concat(eg.kind);
  if (kinds && !kinds.includes(g.kind)) return false;
  const fields = eg.field == null ? [] : [].concat(eg.field);
  const ids = eg.id == null ? [] : [].concat(eg.id);
  return fields.some(p => fieldMatches(p, g.field)) || ids.some(p => typeof g.id === 'string' && g.id.startsWith(p));
}
function scoreGaps(c, gaps) {
  if (!Array.isArray(gaps)) return null;
  const exp = c.expectGaps || [];
  const matched = exp.map(eg => gaps.some(g => gapMatches(eg, g)));
  const blocking = gaps.filter(g => g && g.blocking);
  const unexpectedBlocking = blocking.filter(g => !exp.some(eg => gapMatches(eg, g)));
  return {
    expected: exp.length,
    matched: matched.filter(Boolean).length,
    recall: exp.length ? matched.filter(Boolean).length / exp.length : null,
    missed: exp.filter((_, i) => !matched[i]).map(eg => eg.about),
    raised: gaps.length,
    blocking: blocking.length,
    unexpectedBlocking: unexpectedBlocking.map(g => `${g.kind}:${g.field || g.id}`),
    firstQuestion: gaps[0] ? gaps[0].question || null : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsers
// ─────────────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function unwrapParse(res) {
  if (!res || typeof res !== 'object') return { hand: null, notes: [] };
  if (res.hand !== undefined) return { hand: res.hand, notes: Array.isArray(res.notes) ? res.notes : [] };
  if (res.players || res.streets || res.gameType) return { hand: res, notes: [] };
  return { hand: null, notes: [] };
}

async function makeParser(o, validated) {
  if (o.oracle) {
    return {
      name: 'oracle (the corpus expectations as a hand)',
      mode: 'oracle',
      parse: async c => ({ hand: buildOracleHand(c, validated.get(c.id)), notes: [] }),
    };
  }
  if (o.parses) {
    const saved = JSON.parse(fs.readFileSync(path.resolve(o.parses), 'utf8'));
    const byId = new Map((saved.cases || []).map(r => [r.id, r]));
    return {
      name: `saved parses from ${path.basename(o.parses)}`,
      mode: 'saved',
      parse: async c => {
        const r = byId.get(c.id);
        if (!r) throw new Error('no saved parse for this case');
        if (r.error) throw new Error('saved run errored: ' + r.error);
        return { hand: r.hand, notes: r.notes || [], latencyMs: r.latencyMs };
      },
    };
  }
  if (o.url) {
    if (!o.token) { console.error('--url needs --token <jwt> (an admin user\'s token)'); process.exit(2); }
    const endpoint = o.url + '/api/quick-add/parse';
    return {
      name: `POST ${endpoint}`,
      mode: 'endpoint',
      parse: async c => {
        const body = { text: c.text, source: c.source };
        if (o.hintGame && c.expect.gameType) body.hints = { gameType: c.expect.gameType };
        for (let attempt = 0; ; attempt++) {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), o.timeout);
          let res;
          try {
            res = await fetch(endpoint, {
              method: 'POST', signal: ctl.signal,
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + o.token },
              body: JSON.stringify(body),
            });
          } catch (e) {
            clearTimeout(t);
            throw new Error(e.name === 'AbortError' ? `timed out after ${o.timeout} ms` : e.message);
          }
          clearTimeout(t);
          if ((res.status === 429 || res.status === 503) && attempt < 3) {
            const ra = Number(res.headers.get('retry-after'));
            await sleep(isNum(ra) && ra > 0 ? ra * 1000 : 5000 * (attempt + 1));
            continue;
          }
          const txt = await res.text();
          let json = null;
          try { json = JSON.parse(txt); } catch { /* not JSON */ }
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${(json && json.error) || txt.slice(0, 200)}`);
          return unwrapParse(json);
        }
      },
    };
  }
  const modPath = path.resolve(o.module || DEFAULT_MODULE);
  if (!fs.existsSync(modPath)) return { unavailable: `${path.relative(ROOT, modPath)} does not exist yet` };
  if (!process.env.ANTHROPIC_API_KEY) return { unavailable: `${path.relative(ROOT, modPath)} exists but ANTHROPIC_API_KEY is not set` };
  let mod;
  try { mod = require(modPath); }
  catch (e) {
    try { mod = await import(pathToFileURL(modPath).href); }
    catch (e2) { return { unavailable: `could not load ${modPath}: ${e.message}` }; }
  }
  const pick = o.exportName ? [o.exportName]
    : ['parseQuickAdd', 'quickAddParse', 'parseHandDescription', 'parseDescription', 'parseHand', 'parse', 'default'];
  let fn = null, fnName = null;
  for (const k of pick) {
    const cand = k === 'default' ? (typeof mod === 'function' ? mod : mod && mod.default) : mod && mod[k];
    if (typeof cand === 'function') { fn = cand; fnName = k; break; }
  }
  if (!fn) return { unavailable: `${path.relative(ROOT, modPath)} exports none of ${pick.join(', ')} (use --export <name>)` };
  return {
    name: `${path.relative(ROOT, modPath)} ${fnName}()`,
    mode: 'module',
    parse: async c => {
      const input = { text: c.text, source: c.source };
      if (o.hintGame && c.expect.gameType) input.hints = { gameType: c.expect.gameType };
      // A timer that is cleared once the parse settles, so it cannot hold the process open.
      const run = p => new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timed out after ${o.timeout} ms`)), o.timeout);
        p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
      });
      let res;
      try { res = await run(Promise.resolve(fn(input))); }
      catch (e) {
        // Positional signature fallback: fn(text, source, hints).
        if (e instanceof TypeError) res = await run(Promise.resolve(fn(c.text, c.source, input.hints)));
        else throw e;
      }
      return unwrapParse(res);
    },
  };
}

async function loadGaps(o) {
  if (!o.gaps) return { unavailable: 'disabled (--no-gaps)' };
  const p = path.resolve(o.gapsPath || DEFAULT_GAPS);
  if (!fs.existsSync(p)) return { unavailable: `${path.relative(ROOT, p)} does not exist yet` };
  stubBrowserGlobals();
  try {
    const m = await import(pathToFileURL(p).href);
    const fn = m.findGaps || (m.default && m.default.findGaps);
    if (typeof fn !== 'function') return { unavailable: `${path.relative(ROOT, p)} has no findGaps export` };
    return { findGaps: fn, name: path.relative(ROOT, p) };
  } catch (e) {
    return { unavailable: `could not import ${path.relative(ROOT, p)}: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage + dry run
// ─────────────────────────────────────────────────────────────────────────────

function coverageTable(cases) {
  const games = [...new Set(cases.map(c => c.game))].sort((a, b) => gameOrder(a) - gameOrder(b) || a.localeCompare(b));
  const cols = [['text', false], ['text', true], ['speech', false], ['speech', true]];
  const rows = games.map(g => {
    const mine = cases.filter(c => c.game === g);
    const cells = cols.map(([src, inc]) => mine.filter(c => c.source === src && isIncomplete(c) === inc).length);
    return [g, ...cells, mine.length];
  });
  const tot = ['TOTAL', ...cols.map(([src, inc]) => cases.filter(c => c.source === src && isIncomplete(c) === inc).length), cases.length];
  return { header: ['game', 'text/complete', 'text/incomplete', 'speech/complete', 'speech/incomplete', 'total'], rows: [...rows, tot] };
}
function gameOrder(g) {
  const order = ['NLH', 'PLO', 'PLO8', 'Big O', 'LHE', 'O8', 'Stud Hi', 'Stud 8', 'Razz', '2-7 TD', 'A-5 TD', 'Badugi', 'NL 2-7 SD'];
  const i = order.indexOf(g);
  return i < 0 ? 99 : i;
}
function textTable(t) {
  const w = t.header.map((h, i) => Math.max(String(h).length, ...t.rows.map(r => String(r[i]).length)));
  const line = r => r.map((x, i) => (i === 0 ? String(x).padEnd(w[i]) : String(x).padStart(w[i]))).join('  ');
  return [line(t.header), w.map(n => '-'.repeat(n)).join('  '), ...t.rows.map(line)].join('\n');
}
function mdTable(header, rows) {
  return [`| ${header.join(' | ')} |`, `| ${header.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
}

function tagCoverage(cases) {
  const m = {};
  for (const c of cases) for (const t of c.tags || []) m[t] = (m[t] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const pct = x => (x == null || Number.isNaN(x) ? '—' : (100 * x).toFixed(1) + '%');
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
};

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return 0; }
  await loadHandConfig();

  const { cases: all, files, loadErrors } = loadCorpus(o.corpus);
  if (loadErrors.length) { loadErrors.forEach(e => console.error('corpus: ' + e)); return 1; }

  // Validate everything (even filtered-out cases: ids must be unique corpus-wide).
  const seen = new Map();
  const validated = new Map();
  let nErr = 0, nWarn = 0;
  const problems = [];
  for (const c of all) {
    const v = validateCase(c, seen);
    validated.set(c.id, v);
    if (v.errors.length || v.warnings.length) problems.push({ c, v });
    nErr += v.errors.length; nWarn += v.warnings.length;
  }

  let cases = all.filter(c => {
    if (o.source && c.source !== o.source) return false;
    if (o.only === 'incomplete' && !isIncomplete(c)) return false;
    if (o.only === 'complete' && isIncomplete(c)) return false;
    if (o.filter.length) {
      const hay = [c.id, c.game, ...(c.tags || [])].join(' ').toLowerCase();
      if (!o.filter.some(f => hay.includes(f))) return false;
    }
    return true;
  });
  if (o.limit) cases = cases.slice(0, o.limit);

  const printProblems = () => {
    for (const { c, v } of problems) {
      for (const e of v.errors) console.log(`  ERROR ${c._file} ${c.id}: ${e}`);
      for (const w of v.warnings) console.log(`  warn  ${c._file} ${c.id}: ${w}`);
    }
  };

  // ── Dry run ──
  let parser = null;
  if (!o.dryRun) {
    parser = await makeParser(o, validated);
    if (parser.unavailable) {
      console.log(`No parser available: ${parser.unavailable}.`);
      console.log('Falling back to --dry-run. Use --url/--token for a running server, --oracle to score the gaps engine alone, or --parses <report.json>.\n');
      parser = null;
    }
  }
  if (!parser) {
    console.log(`Quick-add corpus: ${all.length} cases in ${files.length} files (game config: ${configSource})\n`);
    console.log(textTable(coverageTable(all)));
    const tags = tagCoverage(all);
    if (tags.length) console.log('\nTags: ' + tags.map(([t, n]) => `${t} ${n}`).join(', '));
    const inc = all.filter(isIncomplete);
    const kinds = {};
    inc.forEach(c => c.expectGaps.forEach(g => [].concat(g.kind || 'any').forEach(k => { kinds[k] = (kinds[k] || 0) + 1; })));
    console.log(`\nIncomplete: ${inc.length}/${all.length} (${pct(inc.length / Math.max(1, all.length))}); expected gaps by kind: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    const factCount = all.reduce((s, c) => {
      const v = validated.get(c.id);
      if (v.errors.length) return s;
      return s + scoreCase(c, v, null).expected;
    }, 0);
    console.log(`Facts to recover: ${factCount}`);

    // Scorer self-check: each case's oracle hand must score perfectly against itself.
    let selfOk = 0, selfBad = [];
    for (const c of all) {
      const v = validated.get(c.id);
      if (v.errors.length) continue;
      const s = scoreCase(c, v, buildOracleHand(c, v));
      const h = s.hallucinations;
      if (s.ok === s.expected && s.wrong === 0 && s.extraActions === 0 && !h.cards.length && !h.suits.length && !h.stacks.length && !h.actions) selfOk++;
      else selfBad.push({ c, s });
    }
    console.log(`Scorer self-check (oracle hand vs its own expectations): ${selfOk}/${all.length - [...validated.values()].filter(v => v.errors.length).length} perfect`);
    for (const { c, s } of selfBad.slice(0, 20)) {
      const bad = s.facts.filter(f => f.status !== 'ok').map(f => `${f.key} exp ${f.expected} got ${f.got}`);
      console.log(`  self-check ${c.id}: ${bad.join('; ')} ${JSON.stringify(s.hallucinations)} extra=${s.extraActions}`);
    }
    console.log(`\nValidation: ${nErr} error(s), ${nWarn} warning(s)${nWarn ? ' (warnings on incomplete cases are usually the deliberate flaw)' : ''}`);
    printProblems();
    return nErr || selfBad.length ? 1 : 0;
  }

  if (nErr) {
    console.log(`Corpus has ${nErr} validation error(s); fix them first (run --dry-run for details).`);
    printProblems();
    return 1;
  }

  // ── Evaluation ──
  const gapsMod = await loadGaps(o);
  console.log(`Parser: ${parser.name}`);
  console.log(`Gaps engine: ${gapsMod.findGaps ? gapsMod.name : 'n/a — ' + gapsMod.unavailable}`);
  console.log(`Cases: ${cases.length}\n`);

  const results = new Array(cases.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      const c = cases[i];
      const v = validated.get(c.id);
      const r = { id: c.id, game: c.game, source: c.source, incomplete: isIncomplete(c), file: c._file, tags: c.tags || [] };
      const t0 = Date.now();
      try {
        const out = await parser.parse(c);
        r.latencyMs = out.latencyMs != null ? out.latencyMs : Date.now() - t0;
        r.hand = out.hand;
        r.notes = out.notes;
      } catch (e) {
        r.latencyMs = Date.now() - t0;
        r.error = e.message || String(e);
        r.hand = null;
      }
      r.score = scoreCase(c, v, r.hand);
      if (gapsMod.findGaps && r.hand) {
        try {
          const g = gapsMod.findGaps(JSON.parse(JSON.stringify(r.hand)));
          r.gaps = Array.isArray(g) ? g : [];
          r.gapScore = scoreGaps(c, r.gaps);
        } catch (e) {
          r.gapsError = e.message || String(e);
        }
      }
      results[i] = r;
      done++;
      if (o.verbose) {
        const h = r.score.hallucinations;
        console.log(`${String(done).padStart(3)}/${cases.length} ${c.id.padEnd(34)} recall ${pct(r.score.recall).padStart(6)} prec ${pct(r.score.precision).padStart(6)}`
          + ` halluc ${h.cards.length + h.stacks.length}${r.gapScore ? ` gaps ${r.gapScore.matched}/${r.gapScore.expected}` : ''}${r.error ? ' ERROR ' + r.error : ''} ${r.latencyMs}ms`);
      } else if (process.stdout.isTTY) process.stdout.write(`\r${done}/${cases.length}`);
      if (o.delay) await sleep(o.delay);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, cases.length) }, worker));
  if (process.stdout.isTTY && !o.verbose) process.stdout.write('\r');

  const agg = aggregate(results);
  const meta = {
    date: new Date().toISOString(),
    mode: parser.mode,
    parser: parser.name,
    gaps: gapsMod.findGaps ? gapsMod.name : null,
    gapsUnavailable: gapsMod.findGaps ? null : gapsMod.unavailable,
    corpus: path.relative(ROOT, path.resolve(o.corpus || DEFAULT_CORPUS)),
    cases: results.length,
    git: gitSha(),
    options: { hintGame: !!o.hintGame, filter: o.filter, source: o.source || null, only: o.only || null },
  };
  const md = markdownReport(meta, agg, results, cases);
  console.log(summaryText(agg));
  if (o.report) {
    const outDir = path.resolve(o.out || DEFAULT_OUT);
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = meta.date.replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
    const base = path.join(outDir, `${stamp}-${parser.mode}`);
    fs.writeFileSync(base + '.json', JSON.stringify({ meta, aggregate: agg, cases: results }, null, 2));
    fs.writeFileSync(base + '.md', md);
    console.log(`\nReport: ${path.relative(ROOT, base)}.md (+ .json)`);
  }
  let code = 0;
  if (o.minRecall != null && agg.overall.recall < o.minRecall) { console.log(`FAIL: recall ${pct(agg.overall.recall)} < ${pct(o.minRecall)}`); code = 1; }
  const hall = agg.halluc.cards + agg.halluc.stacks;
  if (o.maxHalluc != null && hall > o.maxHalluc) { console.log(`FAIL: ${hall} hallucinated cards+stacks > ${o.maxHalluc}`); code = 1; }
  return code;
}

function gitSha() {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return null; }
}

function aggregate(results) {
  const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
  const group = (key) => {
    const m = new Map();
    for (const r of results) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return [...m.entries()].map(([k, rs]) => [k, summarize(rs)]);
  };
  const summarize = rs => {
    const expected = sum(rs, r => r.score.expected);
    const ok = sum(rs, r => r.score.ok);
    const wrong = sum(rs, r => r.score.wrong);
    const asserted = ok + wrong + sum(rs, r => r.score.extraActions + r.score.inventedActions);
    const g = rs.filter(r => r.gapScore && r.gapScore.expected);
    const gExp = sum(g, r => r.gapScore.expected), gOk = sum(g, r => r.gapScore.matched);
    return {
      cases: rs.length,
      expected, ok, wrong,
      recall: expected ? ok / expected : null,
      precision: asserted ? ok / asserted : null,
      perfect: rs.filter(r => r.score.ok === r.score.expected && r.score.wrong === 0 && r.score.extraActions === 0).length,
      hallucinatedCards: sum(rs, r => r.score.hallucinations.cards.length),
      hallucinatedStacks: sum(rs, r => r.score.hallucinations.stacks.length),
      gapRecall: gExp ? gOk / gExp : null,
      errors: rs.filter(r => r.error).length,
    };
  };
  const byCategory = FACT_CATEGORIES.map(cat => {
    const fs2 = results.flatMap(r => r.score.facts.filter(f => f.category === cat));
    const ok = fs2.filter(f => f.status === 'ok').length, wrong = fs2.filter(f => f.status === 'wrong').length;
    return { category: cat, expected: fs2.length, ok, wrong, missing: fs2.length - ok - wrong, recall: fs2.length ? ok / fs2.length : null, precision: ok + wrong ? ok / (ok + wrong) : null };
  }).filter(x => x.expected);
  const lat = results.filter(r => !r.error && isNum(r.latencyMs)).map(r => r.latencyMs);
  const gapped = results.filter(r => r.gapScore);
  const complete = gapped.filter(r => !r.incomplete);
  const incomplete = gapped.filter(r => r.incomplete);
  const diag = {};
  results.forEach(r => r.score.diagnostics.forEach(d => { diag[d.kind] = (diag[d.kind] || 0) + 1; }));
  return {
    overall: summarize(results),
    byCategory,
    byGame: group(r => r.game),
    bySource: group(r => r.source),
    byCompleteness: group(r => (r.incomplete ? 'incomplete' : 'complete')),
    halluc: {
      cards: sum(results, r => r.score.hallucinations.cards.length),
      suits: sum(results, r => r.score.hallucinations.suits.length),
      stacks: sum(results, r => r.score.hallucinations.stacks.length),
      actions: sum(results, r => r.score.hallucinations.actions),
      casesWithCards: results.filter(r => r.score.hallucinations.cards.length).length,
      casesWithStacks: results.filter(r => r.score.hallucinations.stacks.length).length,
    },
    gaps: gapped.length ? {
      cases: gapped.length,
      expected: sum(incomplete, r => r.gapScore.expected),
      matched: sum(incomplete, r => r.gapScore.matched),
      recall: sum(incomplete, r => r.gapScore.expected) ? sum(incomplete, r => r.gapScore.matched) / sum(incomplete, r => r.gapScore.expected) : null,
      incompleteFullyCaught: incomplete.filter(r => r.gapScore.matched === r.gapScore.expected).length,
      incompleteCases: incomplete.length,
      completeCases: complete.length,
      completeWithBlocking: complete.filter(r => r.gapScore.blocking > 0).length,
      unexpectedBlocking: sum(gapped, r => r.gapScore.unexpectedBlocking.length),
      errors: results.filter(r => r.gapsError).length,
    } : null,
    latency: { p50: quantile(lat, 0.5), p90: quantile(lat, 0.9), max: lat.length ? Math.max(...lat) : null, mean: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null },
    diagnostics: diag,
  };
}

function summaryText(agg) {
  const o = agg.overall;
  const lines = [
    `Fact recall     ${pct(o.recall)}  (${o.ok}/${o.expected}; ${o.wrong} wrong)`,
    `Fact precision  ${pct(o.precision)}`,
    `Perfect parses  ${o.perfect}/${o.cases}`,
    `Hallucinated    ${agg.halluc.cards} card(s) in ${agg.halluc.casesWithCards} case(s), ${agg.halluc.suits} invented suit(s), ${agg.halluc.stacks} stack(s) in ${agg.halluc.casesWithStacks} case(s), ${agg.halluc.actions} action(s)`,
  ];
  if (agg.gaps) {
    const g = agg.gaps;
    lines.push(`Gap recall      ${pct(g.recall)}  (${g.matched}/${g.expected}; ${g.incompleteFullyCaught}/${g.incompleteCases} incomplete cases fully caught)`);
    lines.push(`False alarms    ${g.completeWithBlocking}/${g.completeCases} complete cases raised a blocking gap`);
  } else lines.push('Gap recall      n/a (no gaps engine)');
  lines.push(`Latency         p50 ${agg.latency.p50 ?? '—'} ms, p90 ${agg.latency.p90 ?? '—'} ms, max ${agg.latency.max ?? '—'} ms`);
  if (o.errors) lines.push(`Errors          ${o.errors} case(s) failed to parse`);
  if (Object.keys(agg.diagnostics).length) lines.push(`Diagnostics     ${Object.entries(agg.diagnostics).map(([k, n]) => `${k} ×${n}`).join(', ')}`);
  return lines.join('\n');
}

function markdownReport(meta, agg, results, cases) {
  const byId = new Map(cases.map(c => [c.id, c]));
  const o = agg.overall;
  const out = [];
  out.push(`# Quick-add eval — ${meta.date.slice(0, 16).replace('T', ' ')} UTC (${meta.mode})`);
  out.push('');
  out.push(`- Parser: ${meta.parser}`);
  out.push(`- Gaps engine: ${meta.gaps || 'n/a — ' + meta.gapsUnavailable}`);
  out.push(`- Corpus: \`${meta.corpus}\`, ${meta.cases} cases${meta.git ? `, commit ${meta.git}` : ''}${meta.options.hintGame ? ', game hint ON' : ''}`);
  out.push('');
  out.push('## Headline');
  out.push('');
  out.push('```');
  out.push(summaryText(agg));
  out.push('```');
  out.push('');
  out.push('## By fact category');
  out.push('');
  out.push(mdTable(['category', 'expected', 'recalled', 'wrong', 'missing', 'recall', 'precision'],
    agg.byCategory.map(x => [x.category, x.expected, x.ok, x.wrong, x.missing, pct(x.recall), pct(x.precision)])));
  out.push('');
  const groupTable = (title, rows) => {
    out.push(`## ${title}`);
    out.push('');
    out.push(mdTable(['', 'cases', 'recall', 'precision', 'perfect', 'halluc. cards', 'halluc. stacks', 'gap recall', 'errors'],
      rows.map(([k, s]) => [k, s.cases, pct(s.recall), pct(s.precision), s.perfect, s.hallucinatedCards, s.hallucinatedStacks, pct(s.gapRecall), s.errors])));
    out.push('');
  };
  groupTable('By game', agg.byGame.sort((a, b) => gameOrder(a[0]) - gameOrder(b[0])));
  groupTable('By source', agg.bySource);
  groupTable('By completeness', agg.byCompleteness);
  if (Object.keys(agg.diagnostics).length) {
    out.push('## Diagnostics');
    out.push('');
    out.push('- `raise-to-not-added`: a raise recorded as the raise-to TOTAL instead of the chips added (the hand format stores chips added).');
    out.push('- `call-total-not-added`: a call recorded as the street total instead of the chips added.');
    out.push('');
    for (const [k, n] of Object.entries(agg.diagnostics)) out.push(`- ${k}: ${n}`);
    out.push('');
  }
  const errs = results.filter(r => r.error || r.gapsError);
  if (errs.length) {
    out.push('## Errors');
    out.push('');
    for (const r of errs) out.push(`- \`${r.id}\`: ${r.error || 'findGaps threw: ' + r.gapsError}`);
    out.push('');
  }
  const badness = r => (1 - r.score.recall) * 10 + (1 - r.score.precision) * 5 + r.score.hallucinations.cards.length * 2
    + r.score.hallucinations.stacks.length + (r.gapScore && r.gapScore.recall != null ? (1 - r.gapScore.recall) * 5 : 0) + (r.error ? 20 : 0);
  const worst = results.filter(r => badness(r) > 0).sort((a, b) => badness(b) - badness(a)).slice(0, 25);
  out.push(`## Cases needing attention (${worst.length} of ${results.length} shown, worst first)`);
  out.push('');
  if (!worst.length) out.push('None: every case is perfect.');
  for (const r of worst) {
    const c = byId.get(r.id);
    const s = r.score;
    out.push(`### \`${r.id}\` — ${r.game}, ${r.source}${r.incomplete ? ', incomplete' : ''}: recall ${pct(s.recall)}, precision ${pct(s.precision)}`);
    out.push('');
    out.push('> ' + c.text.replace(/\s+/g, ' ').slice(0, 400) + (c.text.length > 400 ? '…' : ''));
    out.push('');
    if (r.error) out.push(`- **error**: ${r.error}`);
    const miss = s.facts.filter(f => f.status === 'missing');
    const wrong = s.facts.filter(f => f.status === 'wrong');
    if (wrong.length) out.push(`- wrong: ${wrong.map(f => `\`${f.key}\` expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.got)}`).join('; ')}`);
    if (miss.length) out.push(`- missing: ${miss.map(f => `\`${f.key}\` (${JSON.stringify(f.expected)})`).join(', ')}`);
    if (s.extraActions) out.push(`- ${s.extraActions} parsed action(s) that match nothing expected`);
    const h = s.hallucinations;
    if (h.cards.length) out.push(`- **hallucinated cards**: ${h.cards.join(' ')}`);
    if (h.suits.length) out.push(`- invented suits: ${h.suits.join(' ')}`);
    if (h.stacks.length) out.push(`- hallucinated stacks: ${h.stacks.join(', ')}`);
    if (h.actions) out.push(`- ${h.actions} action(s) on streets the text never described`);
    for (const d of s.diagnostics) out.push(`- ${d.kind} at \`${d.key}\`: expected ${d.expected}, got ${d.got}`);
    if (r.gapScore) {
      if (r.gapScore.missed.length) out.push(`- gaps not raised: ${r.gapScore.missed.join('; ')}`);
      if (r.gapScore.unexpectedBlocking.length) out.push(`- other blocking gaps: ${r.gapScore.unexpectedBlocking.join(', ')}`);
      if (r.gapScore.firstQuestion) out.push(`- first question asked: "${r.gapScore.firstQuestion}"`);
    }
    if (r.notes && r.notes.length) out.push(`- parser notes: ${r.notes.join(' | ')}`);
    out.push('');
  }
  return out.join('\n');
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }, e => { console.error(e); process.exitCode = 1; });
}

module.exports = {
  parseCardsStrict, parseCardsLoose, cardsMatch, positionLabels, validateCase, simulate,
  buildOracleHand, scoreCase, scoreGaps, fieldMatches, gapMatches, loadCorpus, categoryOf,
};
