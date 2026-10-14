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
//
// `own: true` marks the games quick add knows by their own name although the replayer has no
// game config for them yet (owner decision E, 2026-10-14: PLO5, PLO6, PLO6 8/b, Short Deck and
// NLO8 are each their own game and are never collapsed into PLO or NLH in the parser output).
// `replayer` is the replayer's name for the same game where it has one, and REPLAYER_FALLBACK
// is what stands in for the rest until the replayer follow-up gives them configs.
// "PLO6 8/b" is what the replayer calls "Big Easy" (owner decision E2): the replayer keeps its
// name until that follow-up renames it.
const GAMES = {
  'NLH':         { cards: 2, category: 'community',   betting: 'nl' },
  'LHE':         { cards: 2, category: 'community',   betting: 'fl' },
  'PLH':         { cards: 2, category: 'community',   betting: 'pl' },
  'PLO':         { cards: 4, category: 'community',   betting: 'pl' },
  'PLO8':        { cards: 4, category: 'community',   betting: 'pl' },
  'O8':          { cards: 4, category: 'community',   betting: 'fl' },
  'LO Hi':       { cards: 4, category: 'community',   betting: 'fl' },
  'Big O':       { cards: 5, category: 'community',   betting: 'pl' },
  'PLO5':        { cards: 5, category: 'community',   betting: 'pl', own: true },
  'PLO6':        { cards: 6, category: 'community',   betting: 'pl', own: true },
  'PLO6 8/b':    { cards: 6, category: 'community',   betting: 'pl', replayer: 'Big Easy' },
  'NLO8':        { cards: 4, category: 'community',   betting: 'nl', own: true },
  'Short Deck':  { cards: 2, category: 'community',   betting: 'nl', own: true },
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

/* TODO(replayer follow-up, owner 2026-10-14): give PLO5, PLO6, PLO6 8/b (Big Easy), Short Deck
   and NLO8 their own HAND_CONFIG entries. Until then a hand is opened in the replayer as the
   nearest game it has, the way its own game picker stores them (structureGameMap). */
const REPLAYER_FALLBACK = { PLO5: 'PLO', PLO6: 'PLO', 'PLO6 8/b': 'Big Easy', 'Short Deck': 'NLH', NLO8: 'PLO8' };
/** The game the replayer can play for a quick-add game (the same name for the games it has). */
function replayerGame(name) { return REPLAYER_FALLBACK[name] || name; }

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
  bigo: 'Big O',
  // Owner decision E / E2 (2026-10-14): each is its own game; "Big Easy" is an input alias only.
  plo5: 'PLO5', '5cardplo': 'PLO5', fivecardplo: 'PLO5', potlimitomaha5: 'PLO5', plo5card: 'PLO5',
  plo6: 'PLO6', '6cardplo': 'PLO6', sixcardplo: 'PLO6', potlimitomaha6: 'PLO6', plo6card: 'PLO6', po6: 'PLO6',
  plo68b: 'PLO6 8/b', plo68: 'PLO6 8/b', plo6hilo: 'PLO6 8/b', plo6eightorbetter: 'PLO6 8/b', bigeasy: 'PLO6 8/b', '6cardplohilo': 'PLO6 8/b', sixcardplohilo: 'PLO6 8/b',
  nlo8: 'NLO8', nolimitomaha8: 'NLO8', nolimitomahahilo: 'NLO8', nlomaha8: 'NLO8', nlomahahilo: 'NLO8', nlo: 'NLO8',
  shortdeck: 'Short Deck', '6holdem': 'Short Deck', '6plus': 'Short Deck', '6plusholdem': 'Short Deck', sixplus: 'Short Deck', sixplusholdem: 'Short Deck',
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
  // "EP" names no single seat, but all a replay needs from it is "acts early", and asking
  // where exactly cost a question per hand (2026-10-02): it is seated as UTG, with a note.
  // "LP" stays open — CO and BTN act in opposite orders against the blinds.
  utg: 'UTG', underthegun: 'UTG', ep: 'UTG', earlyposition: 'UTG', early: 'UTG', lp: null, lateposition: null, late: null,
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
  /* Typed shorthand and recogniser spellings from the collected corpora (2026-10-14).
     "+1"/"+2" are written relative to UTG ("+2 opens"); STRD/Strdl are the straddler;
     "first to act" is UTG. "Hero"/"H" are not positions — the hero is isHero. */
  plus1: 'UTG+1', plusone: 'UTG+1', plus2: 'UTG+2', plustwo: 'UTG+2', plus3: 'UTG+3', plusthree: 'UTG+3',
  u1: 'UTG+1', uplus1: 'UTG+1', u2: 'UTG+2', uplus2: 'UTG+2', u3: 'UTG+3', uplus3: 'UTG+3',
  utgone: 'UTG+1', utgtwo: 'UTG+2', underthegunone: 'UTG+1', underthegun1: 'UTG+1', undertheguntwo: 'UTG+2', underthegun2: 'UTG+2',
  underthegone: 'UTG', undertheguns: 'UTG', underthegoneplusone: 'UTG+1', underthegoneplus1: 'UTG+1', onthegoneplusone: 'UTG+1',
  firsttoact: 'UTG', firstact: 'UTG', firstposition: 'UTG',
  // "first in" is the first player to ENTER the pot, from any seat: it names no seat.
  otb: 'BTN', onbutton: 'BTN', thebutton: 'BTN', btn1: 'BTN', buttonhero: 'BTN',
  strd: 'UTG', strdl: 'UTG', strddl: 'UTG', str: 'UTG', strad: 'UTG', straddled: 'UTG',
  hijacked: 'HJ', hjk: 'HJ', cutof: 'CO', cuttoff: 'CO', loojack: 'LJ',
  bigline: 'BB', bigblack: 'BB', bblind: 'BB', sblind: 'SB',
};
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function canonicalPosition(pos) {
  if (pos == null) return null;
  let s = String(pos).trim();
  if (!s) return null;
  // "Button (hero)", "the cutoff", "CO (V1)", "the hijack player", "under the gun spot".
  const inner = (s.match(/\(([^)]*)\)/) || [])[1];
  s = s.replace(/\([^)]*\)/g, ' ').replace(/^\s*(?:the|in the|on the|from the)\s+/i, '').trim();
  if (!s) return inner ? canonicalPosition(inner) : null;
  const seat = /^seat\s*#?\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)$/i.exec(s)
    || /^(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:-?\s*seat)$/i.exec(s);
  if (seat) {
    const k = /^\d+$/.test(seat[1]) ? Number(seat[1]) : NUM_WORDS[seat[1].toLowerCase()];
    if (k >= 1 && k <= 10) return 'Seat ' + k;
  }
  s = s.replace(/\s+(?:player|seat|spot|position|guy|villain|hero)\s*$/i, '').trim();
  if (!s) return null;
  const key = s.toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
  // "utg+1" → "utgplus1"; also accept the bare "utg1" spellings above.
  if (Object.prototype.hasOwnProperty.call(POSITION_ALIASES, key)) return POSITION_ALIASES[key];
  // "Hero (BB)", "H (HJ)", "V1 (CO)": the label names the player, the parentheses the seat.
  if (inner && /^(?:h|hero|v\d?|villain|villian|opp|opponent)$/i.test(s)) return canonicalPosition(inner);
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
  canonicalGameName, gameInfo, positionLabels, studLabels, REPLAYER_FALLBACK, replayerGame,
  canonicalPosition, roleIndex, roleRank, ROLE_ORDER,
};
