// Quick-add: the replayer's games, streets and seat labels, server-side.
//
// The replayer's own tables live in the vite-app as ES modules that touch
// localStorage on import, so the server cannot require them. These are copies of
// exactly the parts the parser needs, and test/quick-add/server.test.js imports the
// real ones and fails if the two ever disagree:
//   HAND_CONFIG            vite-app/src/utils/utils.js
//   getGameCategory /
//   STREET_DEFS            vite-app/src/components/HandReplayerView.jsx
//   getPositionLabels      (same file; also _shGetPositionLabels in hand-shorthand.js)
'use strict';

// cards: hole cards per player (stud: all seven), betting: nl | pl | fl.
// OFC is deliberately absent: it has no betting and a different hand shape.
const GAMES = {
  'NLH':         { cards: 2, category: 'community',   betting: 'nl' },
  'LHE':         { cards: 2, category: 'community',   betting: 'fl' },
  'PLH':         { cards: 2, category: 'community',   betting: 'pl' },
  'PLO':         { cards: 4, category: 'community',   betting: 'pl' },
  'PLO8':        { cards: 4, category: 'community',   betting: 'pl' },
  'O8':          { cards: 4, category: 'community',   betting: 'fl' },
  'LO Hi':       { cards: 4, category: 'community',   betting: 'fl' },
  'Big O':       { cards: 5, category: 'community',   betting: 'pl' },
  'Big Easy':    { cards: 6, category: 'community',   betting: 'pl' },
  'Stud Hi':     { cards: 7, category: 'stud',        betting: 'fl' },
  'Stud 8':      { cards: 7, category: 'stud',        betting: 'fl' },
  'Stud Hi-Lo':  { cards: 7, category: 'stud',        betting: 'fl' },
  'Razz':        { cards: 7, category: 'stud',        betting: 'fl' },
  '2-7 Razz':    { cards: 7, category: 'stud',        betting: 'fl' },
  'NL Stud Hi':  { cards: 7, category: 'stud',        betting: 'nl' },
  'NL Stud 8':   { cards: 7, category: 'stud',        betting: 'nl' },
  'NL Razz':     { cards: 7, category: 'stud',        betting: 'nl' },
  'PL Stud Hi':  { cards: 7, category: 'stud',        betting: 'pl' },
  'PL Stud 8':   { cards: 7, category: 'stud',        betting: 'pl' },
  'PL Razz':     { cards: 7, category: 'stud',        betting: 'pl' },
  '2-7 TD':      { cards: 5, category: 'draw_triple', betting: 'fl' },
  'L 2-7 TD':    { cards: 5, category: 'draw_triple', betting: 'fl' },
  'PL 2-7 TD':   { cards: 5, category: 'draw_triple', betting: 'pl' },
  'A-5 TD':      { cards: 5, category: 'draw_triple', betting: 'fl' },
  'Badugi':      { cards: 4, category: 'draw_triple', betting: 'fl' },
  'Badeucy':     { cards: 5, category: 'draw_triple', betting: 'fl' },
  'Badacy':      { cards: 5, category: 'draw_triple', betting: 'fl' },
  'NL 2-7 SD':   { cards: 5, category: 'draw_single', betting: 'nl' },
  'PL 5CD Hi':   { cards: 5, category: 'draw_single', betting: 'pl' },
};
const GAME_NAMES = Object.keys(GAMES);

const STREETS = {
  community:   ['Preflop', 'Flop', 'Turn', 'River'],
  draw_triple: ['Pre-Draw', 'First Draw', 'Second Draw', 'Third Draw'],
  draw_single: ['Pre-Draw', 'Draw'],
  stud:        ['3rd Street', '4th Street', '5th Street', '6th Street', '7th Street'],
};
// Cards that come on the board on each community street.
const BOARD_COUNTS = [0, 3, 1, 1];
// Fixed-limit games bet the small bet on the first two betting rounds (flSmallStreets).
const SMALL_BET_STREETS = new Set([0, 1]);

/* Loose names a model or a person might use, mapped to the replayer's name. Only
   names that mean one game; "Omaha" alone means PLO in every room that spreads it,
   "stud" alone means seven-card stud high. Keys are compared with punctuation,
   spaces and case removed. */
const GAME_ALIASES = {
  nlh: 'NLH', nlhe: 'NLH', holdem: 'NLH', texasholdem: 'NLH', nolimitholdem: 'NLH', nl: 'NLH',
  lhe: 'LHE', lh: 'LHE', limitholdem: 'LHE', flholdem: 'LHE', fixedlimitholdem: 'LHE',
  plh: 'PLH', potlimitholdem: 'PLH',
  plo: 'PLO', omaha: 'PLO', potlimitomaha: 'PLO', plohi: 'PLO', omahahigh: 'PLO',
  plo8: 'PLO8', plohilo: 'PLO8', plo8b: 'PLO8', potlimitomahahilo: 'PLO8', potlimitomaha8: 'PLO8', plohl: 'PLO8',
  o8: 'O8', omaha8: 'O8', omahahilo: 'O8', limitomahahilo: 'O8', limitomaha8: 'O8', omaha8orbetter: 'O8', lo8: 'O8',
  lohi: 'LO Hi', limitomahahigh: 'LO Hi', limitomaha: 'LO Hi',
  bigo: 'Big O', bigeasy: 'Big Easy',
  stud: 'Stud Hi', studhi: 'Stud Hi', sevencardstud: 'Stud Hi', '7cardstud': 'Stud Hi', studhigh: 'Stud Hi',
  stud8: 'Stud 8', studhilo: 'Stud 8', stud8orbetter: 'Stud 8', studeight: 'Stud 8', sevencardstud8: 'Stud 8', sevencardstudhilo: 'Stud 8',
  razz: 'Razz', '27razz': '2-7 Razz', deucetosevenrazz: '2-7 Razz',
  nlstudhi: 'NL Stud Hi', nlstud8: 'NL Stud 8', nlrazz: 'NL Razz',
  plstudhi: 'PL Stud Hi', plstud8: 'PL Stud 8', plrazz: 'PL Razz',
  '27td': '2-7 TD', '27tripledraw': '2-7 TD', tripledraw: '2-7 TD', deucetoseventripledraw: '2-7 TD', '27triple': '2-7 TD',
  l27td: 'L 2-7 TD', limit27tripledraw: 'L 2-7 TD',
  pl27td: 'PL 2-7 TD', pl27tripledraw: 'PL 2-7 TD', potlimit27tripledraw: 'PL 2-7 TD',
  a5td: 'A-5 TD', a5tripledraw: 'A-5 TD', acetofivetripledraw: 'A-5 TD',
  badugi: 'Badugi', badeucy: 'Badeucy', badacy: 'Badacy',
  nl27sd: 'NL 2-7 SD', nl27singledraw: 'NL 2-7 SD', '27singledraw': 'NL 2-7 SD', singledraw: 'NL 2-7 SD', nl27: 'NL 2-7 SD', '27sd': 'NL 2-7 SD',
  pl5cdhi: 'PL 5CD Hi', pl5carddraw: 'PL 5CD Hi', '5carddraw': 'PL 5CD Hi', fivecarddraw: 'PL 5CD Hi',
};
const aliasKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** The replayer's name for a game, or null when it is not one the replayer plays. */
function canonicalGameName(name) {
  if (name == null) return null;
  const s = String(name).trim();
  if (!s) return null;
  if (GAMES[s]) return s;
  const key = aliasKey(s);
  for (const g of GAME_NAMES) if (aliasKey(g) === key) return g;
  return GAME_ALIASES[key] || null;
}

function gameInfo(name) {
  const g = GAMES[name];
  if (!g) return null;
  return { name, ...g, streets: STREETS[g.category] };
}

/* The replayer's seat labels, index 0 first to act preflop and the last three BTN,
   SB, BB. NB the app's early labels shift with table size: nine-handed, seat 0 is
   labelled 'UTG+1' and six-handed it is 'LJ'. They are display labels for a seat
   INDEX, not the vernacular a player uses — see roleIndex. */
function positionLabels(n) {
  if (n <= 2) return ['BTN/SB', 'BB'];
  if (n === 3) return ['BTN', 'SB', 'BB'];
  const middle = ['UTG', 'UTG+1', 'MP1', 'MP2', 'LJ', 'HJ', 'CO'];
  const need = n - 3;
  return middle.slice(Math.max(0, middle.length - need)).concat(['BTN', 'SB', 'BB']);
}
function studLabels(n) {
  return Array.from({ length: n }, (_, i) => 'Seat ' + (i + 1));
}

/* A position as a player says it, reduced to one token: UTG, UTG+1, UTG+2, UTG+3,
   MP, MP2, LJ, HJ, CO, BTN, SB, BB, BTN/SB, or 'Seat N'. null when it is not a
   position (or not one that names a single seat, like "early position"). */
const POSITION_ALIASES = {
  utg: 'UTG', underthegun: 'UTG', ep: null, earlyposition: null, lp: null, lateposition: null,
  utg1: 'UTG+1', utgplus1: 'UTG+1', underthegunplus1: 'UTG+1', underthegunplusone: 'UTG+1', utgplusone: 'UTG+1',
  utg2: 'UTG+2', utgplus2: 'UTG+2', utgplustwo: 'UTG+2', underthegunplustwo: 'UTG+2',
  utg3: 'UTG+3', utgplus3: 'UTG+3', utgplusthree: 'UTG+3',
  mp: 'MP', mp1: 'MP', middle: 'MP', middleposition: 'MP', mid: 'MP',
  mp2: 'MP2', mp3: 'MP2',
  lj: 'LJ', lojack: 'LJ', lowjack: 'LJ',
  hj: 'HJ', hijack: 'HJ', highjack: 'HJ', hijak: 'HJ',
  co: 'CO', cutoff: 'CO', cut: 'CO',
  btn: 'BTN', bu: 'BTN', bn: 'BTN', button: 'BTN', dealer: 'BTN', d: 'BTN', onthebutton: 'BTN',
  sb: 'SB', smallblind: 'SB', small: 'SB',
  bb: 'BB', bigblind: 'BB', big: 'BB',
  btnsb: 'BTN/SB', sbbtn: 'BTN/SB', buttonsmallblind: 'BTN/SB',
  straddle: 'UTG', straddler: 'UTG',
};
function canonicalPosition(pos) {
  if (pos == null) return null;
  const s = String(pos).trim();
  if (!s) return null;
  const seat = /^seat\s*#?\s*(\d{1,2})$/i.exec(s);
  if (seat) return 'Seat ' + Number(seat[1]);
  const key = s.toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
  // "utg+1" → "utgplus1"; also accept the bare "utg1" spellings above.
  if (Object.prototype.hasOwnProperty.call(POSITION_ALIASES, key)) return POSITION_ALIASES[key];
  return null;
}

/* The seat index a vernacular position names at an n-handed table, or null if that
   position does not exist there. Late positions count back from the button, early
   ones forward from the first seat to act, which is how players use them: six-max
   "UTG" is the first seat (the app labels it LJ) and "MP" the second (HJ). */
function roleIndex(token, n) {
  if (!token || !(n >= 2)) return null;
  if (n === 2) return (token === 'BTN' || token === 'SB' || token === 'BTN/SB') ? 0 : token === 'BB' ? 1 : null;
  if (n === 3) return ({ BTN: 0, 'BTN/SB': null, UTG: 0, SB: 1, BB: 2 })[token] ?? null;
  const late = { BB: n - 1, SB: n - 2, BTN: n - 3, CO: n - 4, HJ: n - 5, LJ: n - 6 };
  if (token in late) return late[token] >= 0 ? late[token] : null;
  const early = { UTG: 0, 'UTG+1': 1, 'UTG+2': 2, 'UTG+3': 3 };
  let idx = null;
  if (token in early) idx = early[token];
  else if (token === 'MP') idx = n >= 8 ? 2 : n >= 6 ? 1 : null;
  else if (token === 'MP2') idx = n >= 9 ? 3 : n >= 7 ? 2 : null;
  if (idx == null || idx > n - 4) return null; // must sit in front of the button
  return idx;
}

/* Preflop order of the vernacular tokens, for laying out players when the table
   size is unknown: earliest first, the big blind last. */
const ROLE_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'MP', 'MP2', 'LJ', 'HJ', 'CO', 'BTN', 'BTN/SB', 'SB', 'BB'];
function roleRank(token) {
  const i = ROLE_ORDER.indexOf(token);
  return i < 0 ? ROLE_ORDER.length : i;
}

module.exports = {
  GAMES, GAME_NAMES, STREETS, BOARD_COUNTS, SMALL_BET_STREETS,
  canonicalGameName, gameInfo, positionLabels, studLabels,
  canonicalPosition, roleIndex, roleRank, ROLE_ORDER,
};
