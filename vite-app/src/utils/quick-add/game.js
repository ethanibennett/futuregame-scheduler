// ── Quick-add: game configuration ─────────────────────────────────────────
// The game facts the gap rules need, in a module that runs under plain Node as
// well as Vite.
//
// HAND_CONFIG and HAND_CONFIG_DEFAULT are COPIED from vite-app/src/utils/utils.js
// (2026-10-01). utils.js reads localStorage at import time, so importing it would
// break every Node consumer of the gap rules (the tests, the corpus eval). The
// copy is held to the original by test/quick-add/gaps.test.mjs, which imports
// both and fails on any difference — change utils.js, then this, together.
//
// STREET_DEFS, gameCategory, positionLabels and studPositionLabels mirror the
// functions of the same purpose in vite-app/src/components/HandReplayerView.jsx
// (STREET_DEFS, getGameCategory, getPositionLabels, getStudPositionLabels).

export const HAND_CONFIG_DEFAULT = { heroCards: 2, hasBoard: true, boardMax: 5, betting: 'nl', heroPlaceholder: 'AKhd', boardPlaceholder: 'QJ6hch' };

export const HAND_CONFIG = {
  'NLH':      { heroCards: 2, hasBoard: true, boardMax: 5, betting: 'nl', heroPlaceholder: 'AKhd', boardPlaceholder: 'QJ6hch' },
  'LHE':      { heroCards: 2, hasBoard: true, boardMax: 5, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, heroPlaceholder: 'AKhd', boardPlaceholder: 'QJ6hch' },
  'PLO':      { heroCards: 4, hasBoard: true, boardMax: 5, betting: 'pl', heroPlaceholder: 'AKQ9hdcs', boardPlaceholder: 'J72hds' },
  'PLO8':     { heroCards: 4, hasBoard: true, boardMax: 5, betting: 'pl', heroPlaceholder: 'A2KQhdcs', boardPlaceholder: 'J72hds' },
  'O8':       { heroCards: 4, hasBoard: true, boardMax: 5, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, heroPlaceholder: 'A2KQhdcs', boardPlaceholder: 'J72hds' },
  'Big O':    { heroCards: 5, hasBoard: true, boardMax: 5, betting: 'pl', heroPlaceholder: 'AK2Q9hdcsd', boardPlaceholder: 'J72hds' },
  'Big Easy': { heroCards: 6, hasBoard: true, boardMax: 5, betting: 'pl', heroPlaceholder: 'AK2Q98hdcsdd', boardPlaceholder: 'J72hds' },
  'Razz':     { heroCards: 7, hasBoard: false, boardMax: 0, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, isStud: true, heroPlaceholder: 'A23x4567xhdscx' },
  'Stud Hi':  { heroCards: 7, hasBoard: false, boardMax: 0, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, isStud: true, heroPlaceholder: 'A9xxAKQJThdcsx' },
  'Stud 8':   { heroCards: 7, hasBoard: false, boardMax: 0, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, isStud: true, heroPlaceholder: 'A234567hdcshds' },
  '2-7 TD':   { heroCards: 5, hasBoard: false, boardMax: 0, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, heroPlaceholder: '23457hdcss' },
  'NL 2-7 SD':{ heroCards: 5, hasBoard: false, boardMax: 0, betting: 'nl', heroPlaceholder: '23457hdcss' },
  'Badugi':   { heroCards: 4, hasBoard: false, boardMax: 0, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, heroPlaceholder: 'A234hdcs' },
  'A-5 TD':   { heroCards: 5, hasBoard: false, boardMax: 0, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, heroPlaceholder: 'A2345hdcss' },
  'OFC Pineapple': { heroCards: 13, hasBoard: false, boardMax: 0, betting: 'nl', heroPlaceholder: 'AKQ...' },
  'OFC':          { heroCards: 13, hasBoard: false, boardMax: 0, isStud: false, category: 'ofc', heroPlaceholder: '' },
  'PLH':      { heroCards: 2, hasBoard: true, boardMax: 5, betting: 'pl', heroPlaceholder: 'AKhd', boardPlaceholder: 'QJ6hch' },
  'Stud Hi-Lo': { heroCards: 7, hasBoard: false, boardMax: 0, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, isStud: true, heroPlaceholder: 'A234567hdcshds' },
  'LO Hi':    { heroCards: 4, hasBoard: true, boardMax: 5, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, heroPlaceholder: 'AKQ9hdcs', boardPlaceholder: 'J72hds' },
  'PL 2-7 TD':{ heroCards: 5, hasBoard: false, boardMax: 0, betting: 'pl', heroPlaceholder: '23457hdcss' },
  'L 2-7 TD': { heroCards: 5, hasBoard: false, boardMax: 0, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, heroPlaceholder: '23457hdcss' },
  'Badeucy':  { heroCards: 5, hasBoard: false, boardMax: 0, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, heroPlaceholder: '23457hdcss' },
  'Badacy':   { heroCards: 5, hasBoard: false, boardMax: 0, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, heroPlaceholder: 'A2345hdcss' },
  'PL 5CD Hi':{ heroCards: 5, hasBoard: false, boardMax: 0, betting: 'pl', heroPlaceholder: 'AKQJT hdcss' },
  '2-7 Razz': { heroCards: 7, hasBoard: false, boardMax: 0, betting: 'fl', flSmallStreets: [0, 1], raiseCap: 4, isStud: true, heroPlaceholder: '23x45x7TKhdscx' },
  'NL Stud Hi':  { heroCards: 7, hasBoard: false, boardMax: 0, betting: 'nl', isStud: true, heroPlaceholder: 'A9xxAKQJThdcsx' },
  'NL Stud 8':   { heroCards: 7, hasBoard: false, boardMax: 0, betting: 'nl', isStud: true, heroPlaceholder: 'A234567hdcshds' },
  'NL Razz':     { heroCards: 7, hasBoard: false, boardMax: 0, betting: 'nl', isStud: true, heroPlaceholder: 'A23x4567xhdscx' },
  'PL Stud Hi':  { heroCards: 7, hasBoard: false, boardMax: 0, betting: 'pl', isStud: true, heroPlaceholder: 'A9xxAKQJThdcsx' },
  'PL Stud 8':   { heroCards: 7, hasBoard: false, boardMax: 0, betting: 'pl', isStud: true, heroPlaceholder: 'A234567hdcshds' },
  'PL Razz':     { heroCards: 7, hasBoard: false, boardMax: 0, betting: 'pl', isStud: true, heroPlaceholder: 'A23x4567xhdscx' },
};

// Mirrors STREET_DEFS in HandReplayerView.jsx.
export const STREET_DEFS = {
  community: { streets: ['Preflop', 'Flop', 'Turn', 'River'], boardCards: [0, 3, 1, 1] },
  draw_triple: { streets: ['Pre-Draw', 'First Draw', 'Second Draw', 'Third Draw'], boardCards: [0, 0, 0, 0] },
  draw_single: { streets: ['Pre-Draw', 'Draw'], boardCards: [0, 0] },
  stud: { streets: ['3rd Street', '4th Street', '5th Street', '6th Street', '7th Street'], boardCards: [0, 0, 0, 0, 0] },
  ofc: { streets: ['Initial (5)', 'Card 6', 'Card 7', 'Card 8', 'Card 9', 'Card 10', 'Card 11', 'Card 12', 'Card 13'], boardCards: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
};

/* The config for a game the replayer knows, or null. Unlike the replayer, an
   unknown name is NOT quietly treated as hold'em: an unknown game is a gap. */
export function gameConfig(gameType) {
  if (typeof gameType !== 'string' || !gameType) return null;
  return HAND_CONFIG[gameType] || HAND_CONFIG[gameType.replace(/^Super /, '')] || null;
}

// Mirrors getGameCategory in HandReplayerView.jsx (null for an unknown game).
export function gameCategory(gameType) {
  const cfg = gameConfig(gameType);
  if (!cfg) return null;
  if (gameType === 'OFC') return 'ofc';
  if (cfg.isStud) return 'stud';
  if (cfg.hasBoard) return 'community';
  if (['2-7 TD', 'PL 2-7 TD', 'L 2-7 TD', 'A-5 TD', 'Badeucy', 'Badacy'].includes(gameType)) return 'draw_triple';
  if (['NL 2-7 SD', 'PL 5CD Hi'].includes(gameType)) return 'draw_single';
  if (gameType === 'Badugi') return 'draw_triple';
  return 'community';
}

export function isDrawCategory(category) {
  return category === 'draw_triple' || category === 'draw_single';
}

// Mirrors getStreetDef in HandReplayerView.jsx.
export function streetDef(gameType) {
  return STREET_DEFS[gameCategory(gameType)] || STREET_DEFS.community;
}

// Mirrors getPositionLabels in HandReplayerView.jsx: index 0 is the first seat
// to act preflop and the last three are BTN, SB, BB.
export function positionLabels(numPlayers) {
  if (numPlayers <= 2) return ['BTN/SB', 'BB'];
  if (numPlayers === 3) return ['BTN', 'SB', 'BB'];
  const middle = ['UTG', 'UTG+1', 'MP1', 'MP2', 'LJ', 'HJ', 'CO'];
  const need = numPlayers - 3;
  const picked = middle.slice(Math.max(0, middle.length - need));
  return picked.concat(['BTN', 'SB', 'BB']);
}

// Mirrors getStudPositionLabels in HandReplayerView.jsx.
export function studPositionLabels(numPlayers) {
  return Array.from({ length: numPlayers }, (_, i) => 'Seat ' + (i + 1));
}

/* Razz-family stud games play for low, which flips who brings it in and who
   opens later streets. The replayer tests only 'Razz' and '2-7 Razz' (see
   isRazz in GTOEntryView); the NL/PL razz variants are low games too. */
export function isLowStud(gameType) {
  return ['Razz', '2-7 Razz', 'NL Razz', 'PL Razz'].includes(gameType);
}

/* The games offered when the game is missing, most common first. */
export const COMMON_GAMES = ['NLH', 'PLO', 'LHE', 'PLO8', 'O8', 'Stud Hi', 'Stud 8', 'Razz', '2-7 TD', 'NL 2-7 SD', 'Badugi', 'A-5 TD', 'Big O', 'PLH'];

/* What players call these games, folded to lower case with spaces, quotes,
   dashes and slashes removed. Used only to put a best guess first. */
const GAME_ALIASES = {
  nlh: 'NLH', nlhe: 'NLH', nl: 'NLH', holdem: 'NLH', texasholdem: 'NLH', nolimitholdem: 'NLH', nolimit: 'NLH', nolimithe: 'NLH',
  plo: 'PLO', omaha: 'PLO', potlimitomaha: 'PLO', plohi: 'PLO', omahahi: 'PLO', plo4: 'PLO',
  plo8: 'PLO8', plohilo: 'PLO8', potlimitomahahilo: 'PLO8', plo8orbetter: 'PLO8',
  o8: 'O8', omaha8: 'O8', omahahilo: 'O8', limitomahahilo: 'O8', omaha8orbetter: 'O8', lo8: 'O8',
  lhe: 'LHE', lh: 'LHE', limitholdem: 'LHE', fixedlimitholdem: 'LHE', flhe: 'LHE', limit: 'LHE',
  plh: 'PLH', potlimitholdem: 'PLH',
  bigo: 'Big O', bigeasy: 'Big Easy',
  stud: 'Stud Hi', studhi: 'Stud Hi', sevencardstud: 'Stud Hi', '7cardstud': 'Stud Hi', '7stud': 'Stud Hi', studhigh: 'Stud Hi',
  stud8: 'Stud 8', studhilo: 'Stud 8', stud8orbetter: 'Stud 8', sevencardstudhilo: 'Stud 8', '7cardstudhilo': 'Stud 8', studeight: 'Stud 8',
  razz: 'Razz', '27razz': '2-7 Razz', deucetosevenrazz: '2-7 Razz',
  '27td': '2-7 TD', '27tripledraw': '2-7 TD', deucetoseventripledraw: '2-7 TD', tripledraw: '2-7 TD', '27triple': '2-7 TD', td: '2-7 TD', l27td: 'L 2-7 TD',
  pl27td: 'PL 2-7 TD', potlimit27tripledraw: 'PL 2-7 TD',
  nl27sd: 'NL 2-7 SD', '27sd': 'NL 2-7 SD', '27singledraw': 'NL 2-7 SD', singledraw: 'NL 2-7 SD', nl27: 'NL 2-7 SD', deucetosevensingledraw: 'NL 2-7 SD', kansascity: 'NL 2-7 SD', nl27singledraw: 'NL 2-7 SD',
  a5td: 'A-5 TD', a5tripledraw: 'A-5 TD', acetofivetripledraw: 'A-5 TD',
  badugi: 'Badugi', badeucy: 'Badeucy', badacy: 'Badacy',
  pl5cd: 'PL 5CD Hi', '5carddraw': 'PL 5CD Hi', fivecarddraw: 'PL 5CD Hi', pl5cdhi: 'PL 5CD Hi',
  ofc: 'OFC', openfacechinese: 'OFC', ofcpineapple: 'OFC Pineapple', pineappleofc: 'OFC Pineapple',
};

function foldGameName(s) {
  return String(s || '').toLowerCase().replace(/[\s'’"\-\/_.]/g, '');
}

/* A replayer game name for whatever the hand called its game, or null. An
   exact replayer name (any case) wins; then the alias table. */
export function guessGameType(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const exact = Object.keys(HAND_CONFIG).find(k => k.toLowerCase() === text.trim().toLowerCase());
  if (exact) return exact;
  const folded = foldGameName(text);
  if (GAME_ALIASES[folded]) return GAME_ALIASES[folded];
  const keyFolded = Object.keys(HAND_CONFIG).find(k => foldGameName(k) === folded);
  return keyFolded || null;
}
