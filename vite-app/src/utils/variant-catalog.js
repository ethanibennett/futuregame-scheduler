// ── The variant picker's data layer (owner, 2026-10-20: "implement the new variant picker") ─────
// The recommendation of the Variant Picker study (https://claude.ai/artifact/Jk96jEaP58rBAsf4eak9ka,
// "8 and 10 together"): one table where every game AND structure is its own row (LHE, O8 and PLO8
// apart), aliases for the search, the schedule's rotations (MULTI_GAME_MAP) resolved to rows, a
// matcher, and the best guess from what the player is playing. Pure: no React, no DOM, so it is
// Node-testable (src/utils/__tests__/variant-catalog.test.mjs).
//
// The picker still drives HandReplayerView's own state (selectedGame + bettingStructure -> the
// engine's gameType), so creating a hand is unchanged: a row is { game, structure } plus the
// gameType that pair maps to.
import { MULTI_GAME_MAP, describeGame, getVariantStrip, normaliseDate, parseTournamentTime } from './utils.js';

// ── The picker's maps (moved here from HandReplayerView; the component imports them) ───────────
export const STRUCTURE_GAME_MAP = {
  'No Limit':  { "Hold'em": 'NLH', 'Pineapple': 'NL Pineapple', 'Short Deck': 'Short Deck',
    'Omaha': 'NLO', 'Omaha 8/b': 'NLO8', 'Big O': 'NL Big O', 'PLO6 8/b': 'PLO6 8/b', 'PLO5': 'PLO5', 'PLO6': 'PLO6',
    'Double Board Bomb Pot': 'PLO', 'Courchevel': 'Courchevel',
    'Stud Hi': 'NL Stud Hi', 'Stud 8/b': 'NL Stud 8', 'Razz': 'NL Razz',
    'Stud Hi/Lo Regular': 'Stud Regular', '2-7 Razz': '2-7 Razz',
    'Razzdugi': 'Razzdugi', 'Razzdeucy': 'Razzdeucy',
    '2-7 Triple Draw': '2-7 TD', '2-7 Single Draw': 'NL 2-7 SD',
    'A-5 Triple Draw': 'A-5 TD', 'A-5 Single Draw': 'NL A-5 SD',
    'Badugi': 'Badugi', 'Badeucy': 'Badeucy', 'Badacey': 'Badacy',
    'Archie 66': 'Archie 66', 'Archie 99': 'Archie 99', 'Ari': 'Ari',
    '5-Card Draw': 'NL 5CD Hi', 'OFC': 'OFC',
    'Dramaha Hi': 'Dramaha Hi', 'Dramaha 2-7': 'Dramaha 2-7', 'Dramaha 49': 'Dramaha 49', 'Dramaha 0': 'Dramaha 0', 'Dramadugi': 'Dramadugi', 'Omajack': 'Omajack' },
  'Pot Limit': { "Hold'em": 'PLH', 'Pineapple': 'PL Pineapple', 'Short Deck': 'Short Deck',
    'Omaha': 'PLO', 'Omaha 8/b': 'PLO8', 'Big O': 'Big O', 'PLO6 8/b': 'PLO6 8/b', 'PLO5': 'PLO5', 'PLO6': 'PLO6',
    'Double Board Bomb Pot': 'PLO', 'Courchevel': 'Courchevel',
    'Stud Hi': 'PL Stud Hi', 'Stud 8/b': 'PL Stud 8', 'Razz': 'PL Razz',
    'Stud Hi/Lo Regular': 'Stud Regular', '2-7 Razz': '2-7 Razz',
    'Razzdugi': 'Razzdugi', 'Razzdeucy': 'Razzdeucy',
    '2-7 Triple Draw': 'PL 2-7 TD', '2-7 Single Draw': 'NL 2-7 SD',
    'A-5 Triple Draw': 'A-5 TD', 'A-5 Single Draw': 'NL A-5 SD',
    'Badugi': 'Badugi', 'Badeucy': 'Badeucy', 'Badacey': 'Badacy',
    'Archie 66': 'Archie 66', 'Archie 99': 'Archie 99', 'Ari': 'Ari',
    '5-Card Draw': 'PL 5CD Hi', 'OFC': 'OFC',
    'Dramaha Hi': 'Dramaha Hi', 'Dramaha 2-7': 'Dramaha 2-7', 'Dramaha 49': 'Dramaha 49', 'Dramaha 0': 'Dramaha 0', 'Dramadugi': 'Dramadugi', 'Omajack': 'Omajack' },
  'Limit':     { "Hold'em": 'LHE', 'Pineapple': 'L Pineapple', 'Short Deck': 'Short Deck',
    'Omaha': 'LO Hi', 'Omaha 8/b': 'O8', 'Big O': 'L Big O', 'PLO6 8/b': 'PLO6 8/b', 'PLO5': 'PLO5', 'PLO6': 'PLO6',
    'Double Board Bomb Pot': 'PLO', 'Courchevel': 'Courchevel',
    'Stud Hi': 'Stud Hi', 'Stud 8/b': 'Stud 8', 'Razz': 'Razz',
    'Stud Hi/Lo Regular': 'Stud Regular', '2-7 Razz': '2-7 Razz',
    'Razzdugi': 'Razzdugi', 'Razzdeucy': 'Razzdeucy',
    '2-7 Triple Draw': '2-7 TD', '2-7 Single Draw': 'NL 2-7 SD',
    'A-5 Triple Draw': 'A-5 TD', 'A-5 Single Draw': 'NL A-5 SD',
    'Badugi': 'Badugi', 'Badeucy': 'Badeucy', 'Badacey': 'Badacy',
    'Archie 66': 'Archie 66', 'Archie 99': 'Archie 99', 'Ari': 'Ari',
    '5-Card Draw': 'PL 5CD Hi', 'OFC': 'OFC',
    'Dramaha Hi': 'L Dramaha Hi', 'Dramaha 2-7': 'L Dramaha 2-7', 'Dramaha 49': 'L Dramaha 49', 'Dramaha 0': 'L Dramaha 0', 'Dramadugi': 'L Dramadugi', 'Omajack': 'Omajack' },
};
export const DEFAULT_STRUCTURE = {
  "Hold'em": 'No Limit', 'Pineapple': 'No Limit', 'Short Deck': 'No Limit',
  'Omaha': 'Pot Limit', 'Omaha 8/b': 'Pot Limit', 'Big O': 'Pot Limit', 'PLO6 8/b': 'Pot Limit',
  'PLO5': 'Pot Limit', 'PLO6': 'Pot Limit',
  'Double Board Bomb Pot': 'Pot Limit', 'Courchevel': 'Pot Limit',
  'Stud Hi': 'Limit', 'Stud 8/b': 'Limit', 'Razz': 'Limit',
  'Stud Hi/Lo Regular': 'Limit', '2-7 Razz': 'Limit',
  'Razzdugi': 'Limit', 'Razzdeucy': 'Limit',
  '2-7 Triple Draw': 'Limit', '2-7 Single Draw': 'No Limit',
  'A-5 Triple Draw': 'Limit', 'A-5 Single Draw': 'No Limit',
  'Badugi': 'Limit', 'Badeucy': 'Limit', 'Badacey': 'Limit',
  'Archie 66': 'Limit', 'Archie 99': 'Limit', 'Ari': 'Limit',
  '5-Card Draw': 'No Limit', 'OFC': 'No Limit',
  'Dramaha Hi': 'Pot Limit', 'Dramaha 2-7': 'Pot Limit', 'Dramaha 49': 'Pot Limit',
  'Dramaha 0': 'Pot Limit', 'Dramadugi': 'Pot Limit', 'Omajack': 'Pot Limit',
};
/* Games played one way only, known by their own name ("PLO6 8/b", not "Limit PLO6 8/b"). */
export const FIXED_STRUCTURE = { 'Short Deck': 'No Limit', 'PLO5': 'Pot Limit', 'PLO6': 'Pot Limit', 'PLO6 8/b': 'Pot Limit' };
export const RAZZ_VARIANTS = ['Razz', '2-7 Razz', 'Razzdugi', 'Razzdeucy'];
const LIMIT_NAMED = ['Stud Hi', 'Stud 8/b', 'Razz', 'Stud Hi/Lo Regular', '2-7 Razz', 'Razzdugi', 'Razzdeucy',
  '2-7 Triple Draw', 'A-5 Triple Draw', 'Badugi', 'Badeucy', 'Badacey', 'Archie 66', 'Archie 99', 'Ari'];
const NAME_OVERRIDES = {
  'Pot Limit|Omaha': 'Pot Limit Omaha', 'Pot Limit|Omaha 8/b': 'PLO8', 'Pot Limit|Big O': 'Big O',
  'No Limit|Omaha': 'No Limit Omaha', 'No Limit|Omaha 8/b': 'NLO8', 'No Limit|Big O': 'No Limit Big O',
  'Limit|Omaha': 'Limit Omaha Hi', 'Limit|Omaha 8/b': 'O8', 'Limit|Big O': 'Limit Big O',
  'Pot Limit|Double Board Bomb Pot': 'Bomb Pot',
  'Pot Limit|Courchevel': 'Courchevel',
};

/** The name a game and structure go by ("Limit Hold'em", "O8", "Razz", "PLO5"). */
export function variantName(game, structure) {
  if (game === 'OFC') return 'OFC';
  if (FIXED_STRUCTURE[game]) return game;
  const o = NAME_OVERRIDES[structure + '|' + game];
  if (o) return o;
  if (LIMIT_NAMED.includes(game) && structure === 'Limit') return game;
  return structure + ' ' + game;
}

/** The engine's game type for a game and structure (HAND_CONFIG key). */
export const gameTypeOf = (game, structure) => (STRUCTURE_GAME_MAP[structure] || {})[game] || null;

// ── The families, in the order the palette lists them ─────────────────────────────────────────
// Each game's rows: its usual structure first, then the others people play; `rare` ones (NL Stud,
// PL Razz, NL Omaha hi) appear only in search results.
/* A named game with no rules of its own stays out of the picker until it is built (owner, 2026-11-05: every game on
   offer has to work): it would be dealt and scored as a plainer game, and announce the wrong winner. Every game the
   catalog names has its rules now (docs/replayer-hidden-games.md) but one: the Bomb Pot row dealt a double-board PLO
   hand with blinds and a preflop round, where a bomb pot is an ante from every player and no betting before the flop
   (entry audit 25). Double-board PLO itself is still offered, through the Double board switch. */
export const UNBUILT_GAMES = new Set(['Double Board Bomb Pot']);

export const FAMILIES = [
  { id: 'holdem', label: "Hold'em", games: ["Hold'em", 'Pineapple', 'Short Deck'] },
  { id: 'omaha', label: 'Omaha', games: ['Omaha', 'Omaha 8/b', 'Big O', 'PLO5', 'PLO6', 'PLO6 8/b', 'Courchevel', 'Double Board Bomb Pot'] },
  { id: 'stud', label: 'Stud', games: ['Stud Hi', 'Stud 8/b', 'Razz', 'Stud Hi/Lo Regular', '2-7 Razz', 'Razzdugi', 'Razzdeucy'] },
  { id: 'draw', label: 'Draw', games: ['2-7 Triple Draw', '2-7 Single Draw', 'A-5 Triple Draw', 'A-5 Single Draw', 'Badugi', 'Badeucy', 'Badacey', '5-Card Draw', 'Archie 66', 'Archie 99', 'Ari'] },
  { id: 'mixed', label: 'Mixed', games: [] },
  { id: 'other', label: 'Other', games: ['OFC', 'Dramaha Hi', 'Dramaha 2-7', 'Dramaha 49', 'Dramaha 0', 'Dramadugi', 'Omajack'] },
];
const ROWS_FOR = {
  "Hold'em": [['No Limit'], ['Limit'], ['Pot Limit']],
  'Pineapple': [['No Limit'], ['Pot Limit', 'rare'], ['Limit', 'rare']],
  'Omaha': [['Pot Limit'], ['Limit'], ['No Limit', 'rare']],
  'Omaha 8/b': [['Pot Limit'], ['Limit'], ['No Limit']],
  'Big O': [['Pot Limit'], ['Limit', 'rare'], ['No Limit', 'rare']],
  'Stud Hi': [['Limit'], ['No Limit', 'rare'], ['Pot Limit', 'rare']],
  'Stud 8/b': [['Limit'], ['No Limit', 'rare'], ['Pot Limit', 'rare']],
  'Razz': [['Limit'], ['No Limit', 'rare'], ['Pot Limit', 'rare']],
  '2-7 Triple Draw': [['Limit'], ['Pot Limit']],
  '5-Card Draw': [['No Limit'], ['Pot Limit']],
  'Dramaha Hi': [['Pot Limit'], ['Limit']],
  'Dramaha 2-7': [['Pot Limit'], ['Limit']],
  'Dramaha 49': [['Pot Limit'], ['Limit']],
  'Dramaha 0': [['Pot Limit'], ['Limit']],
  'Dramadugi': [['Pot Limit'], ['Limit']],
};
// Search words beyond the name: the abbreviations and slang a player types.
const ALIASES = {
  "Hold'em|No Limit": ['nlh', 'nlhe', 'holdem', 'hold em', 'no limit holdem', 'texas'],
  "Hold'em|Limit": ['lhe', 'limit holdem', 'fl holdem', 'fixed limit'],
  "Hold'em|Pot Limit": ['plh', 'pot limit holdem'],
  'Short Deck|No Limit': ['6+', 'six plus', 'shortdeck', 'sd'],
  'Pineapple|No Limit': ['crazy pineapple', 'pineapple holdem'],
  'Omaha|Pot Limit': ['plo', 'plo4', 'omaha', 'pot limit omaha'],
  'Omaha|Limit': ['lo', 'limit omaha', 'lo hi'],
  'Omaha|No Limit': ['nlo'],
  'Omaha 8/b|Pot Limit': ['plo8', 'plo hi lo', 'omaha hi lo', 'pl08'],
  'Omaha 8/b|Limit': ['o8', 'limit omaha 8', 'omaha eight', 'fl o8', 'lo8'],
  'Omaha 8/b|No Limit': ['nlo8'],
  'Big O|Pot Limit': ['bigo', 'big o', '5 card o8', 'plo5 8'],
  'PLO5|Pot Limit': ['plo5', '5 card omaha', '5co'],
  'PLO6|Pot Limit': ['plo6', '6 card omaha'],
  'PLO6 8/b|Pot Limit': ['plo6 8', 'big easy', '6 card o8'],
  'Double Board Bomb Pot|Pot Limit': ['bomb pot', 'double board'],
  'Stud Hi|Limit': ['stud', 'seven card stud', '7 stud', '7cs', '7 card stud', 'stud high'],
  'Stud 8/b|Limit': ['stud 8', 'stud hi lo', 'stud8', 'eight or better', 'stud 8 or better', 'stud eight or better', '7 card stud hi lo'],
  'Razz|Limit': ['razz', 'a5 stud'],
  '2-7 Razz|Limit': ['27 razz', 'deuce razz'],
  '2-7 Triple Draw|Limit': ['27td', '2-7 td', 'deuce', 'deuce to seven', 'triple draw', 'td', 'lowball', 'deuce to seven lowball'],
  '2-7 Triple Draw|Pot Limit': ['pl 27 td', 'pl deuce'],
  '2-7 Single Draw|No Limit': ['27sd', 'nl 27', 'single draw', 'kansas city', 'kansas city lowball', 'lowball'],
  'A-5 Triple Draw|Limit': ['a5td', 'a-5 td', 'ace to five', 'ace to five lowball', 'lowball'],
  'A-5 Single Draw|No Limit': ['a5sd', 'california lowball', 'california'],
  '5-Card Draw|No Limit': ['5cd', 'five card draw', 'draw hi'],
  'Badugi|Limit': ['badugi'],
  'Badeucy|Limit': ['badeucy'],
  'Badacey|Limit': ['badacy', 'badacey'],
  'OFC|No Limit': ['ofc', 'open face', 'chinese', 'pineapple ofc'],
  'Dramaha Hi|Pot Limit': ['drawmaha', 'dramaha high'],
  'Dramaha 2-7|Pot Limit': ['drawmaha 2-7', 'deuce dramaha'],
  'Dramaha 49|Pot Limit': ['drawmaha 49'],
  'Dramaha 0|Pot Limit': ['dramaha zero', 'drawmaha 0', 'drawmaha zero'],
  'Dramadugi|Pot Limit': ['drawmaha dugi', 'dramaha badugi'],
  'Dramaha Hi|Limit': ['drawmaha', 'dramaha high', 'limit dramaha'],
  'Dramaha 2-7|Limit': ['drawmaha 2-7', 'deuce dramaha', 'limit dramaha'],
  'Dramaha 49|Limit': ['drawmaha 49', 'limit dramaha'],
  'Dramaha 0|Limit': ['dramaha zero', 'drawmaha 0', 'drawmaha zero', 'limit dramaha'],
  'Dramadugi|Limit': ['drawmaha dugi', 'dramaha badugi', 'limit dramaha'],
  'Omajack|Pot Limit': ['omahajack', 'omaha blackjack'],
  'Stud Hi/Lo Regular|Limit': ['stud hi lo no qualifier', 'stud regular'],
  'Archie 99|Limit': ['archie'],
  'Archie 66|Limit': ['archie'],
};

/** Every row the picker offers: { key, game, structure, gameType, name, family, rare, aliases }.
 *  customNames: the account's custom games (GET /api/replayer/games), appended to Other. */
export function buildCatalog(customNames = []) {
  const rows = [];
  for (const fam of FAMILIES) {
    for (const game of fam.games) {
      if (UNBUILT_GAMES.has(game)) continue;
      const specs = FIXED_STRUCTURE[game] ? [[FIXED_STRUCTURE[game]]] : (ROWS_FOR[game] || [[DEFAULT_STRUCTURE[game] || 'No Limit']]);
      for (const [structure, flag] of specs) {
        const key = game + '|' + structure;
        rows.push({
          key, game, structure, gameType: gameTypeOf(game, structure), name: variantName(game, structure),
          family: fam.id, rare: flag === 'rare', aliases: ALIASES[key] || [],
        });
      }
    }
  }
  for (const n of customNames || []) {
    if (!n) continue;
    rows.push({ key: 'custom|' + n, game: n, structure: 'No Limit', gameType: n, name: n, family: 'other', rare: false, aliases: [], custom: true });
  }
  return rows;
}

// Engine game types the schedule's mixes name that are spelled differently in the table.
const TYPE_ALIASES = { 'Stud Hi-Lo': 'Stud 8', 'L 2-7 TD': '2-7 TD', 'NL 5CD': 'NL 5CD Hi' };

/** The usual row for an engine game type (a mix's "O8", a guess's "LHE"), or null. */
export function rowForGameType(rows, gameType) {
  const t = TYPE_ALIASES[gameType] || gameType;
  const hits = rows.filter((r) => r.gameType === t);
  return hits.find((r) => r.structure === DEFAULT_STRUCTURE[r.game] && !r.rare) || hits.find((r) => !r.rare) || hits[0] || null;
}

/** The saved hands' games as pick history (UX pick 63): most played first, then the most recent, so
 *  a new device, or a player who adds hands by typing them, still gets a Recent. */
export function historyFromHands(rows, hands, n = 5) {
  const counts = new Map(), first = new Map();
  (hands || []).forEach((h, i) => {
    const t = h && (h.gameType || (h.handData || {}).gameType);
    const r = t ? rowForGameType(rows, t) : null;
    if (!r) return;
    counts.set(r.key, (counts.get(r.key) || 0) + 1);
    if (!first.has(r.key)) first.set(r.key, { i, r });
  });
  return [...first.values()]
    .sort((a, b) => (counts.get(b.r.key) - counts.get(a.r.key)) || a.i - b.i)
    .slice(0, n).map(({ r }) => ({ game: r.game, structure: r.structure, mix: null }));
}

/** How often each row has been played: this device's picks and the saved hands together, by row key. */
export function playCounts(rows, history, hands) {
  const counts = new Map();
  const add = (r) => { if (r) counts.set(r.key, (counts.get(r.key) || 0) + 1); };
  for (const h of history || []) add(rows.find((x) => x.game === h.game && x.structure === h.structure));
  for (const h of hands || []) { const t = h && (h.gameType || (h.handData || {}).gameType); if (t) add(rowForGameType(rows, t)); }
  return counts;
}

/** A family's rows as the palette first shows them (UX pick 63): the 3 most played (in catalog order;
 *  the first 3 when nothing has been played), plus the current pick wherever it is; all of them when
 *  the family has 4 or fewer. Returns { shown, hidden } (hidden: how many are folded away). */
export function familyRows(all, counts, current = null, top = 3) {
  if (all.length <= top + 1) return { shown: all, hidden: 0 };
  const played = all.filter((r) => (counts.get(r.key) || 0) > 0)
    .sort((a, b) => counts.get(b.key) - counts.get(a.key) || all.indexOf(a) - all.indexOf(b));
  const pick = new Set((played.length ? played : all).slice(0, top).map((r) => r.key));
  if (played.length && played.length < top) all.forEach((r) => { if (pick.size < top) pick.add(r.key); });
  if (current && all.some((r) => r.key === current.key)) pick.add(current.key);
  const shown = all.filter((r) => pick.has(r.key));
  return { shown, hidden: all.length - shown.length };
}

/** The rotations, from the schedule's MULTI_GAME_MAP: { key, mix, games: rows } (unknown types left out). */
export function buildMixes(rows) {
  return Object.entries(MULTI_GAME_MAP).map(([mix, types]) => ({
    key: 'mix|' + mix, mix, family: 'mixed',
    games: types.map((t) => rowForGameType(rows, t)).filter(Boolean)
      .filter((r, i, a) => a.findIndex((x) => x.key === r.key) === i),
  })).filter((m) => m.games.length > 1);
}

// ── The matcher (the study's direction 3): letters and digits only, so "O/8", "o 8" and "o8" meet ─
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+]/g, '');
/* Whether a and b are one typing slip apart: a letter added, dropped, changed, or two swapped. */
function oneSlip(a, b) {
  if (a === b) return false;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i += 1;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;                                   // changed
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);    // swapped
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);           // added / dropped
}
function score(q, text) {
  const t = norm(text);
  if (!t || !q) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 88;
  if (t.includes(q)) return 72;
  /* One slip from a name, a word of it, or its start (entry audit 34: "razzz", "baduci", "hodlem" and
     "tripple draw" found nothing). Four letters at least: a slip in three is another word. */
  if (q.length >= 4) {
    const words = String(text || '').toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);
    if (oneSlip(q, t) || words.some((w) => w.length >= 4 && oneSlip(q, w)) || oneSlip(q, t.slice(0, q.length)) || oneSlip(q, t.slice(0, q.length + 1))) return 50;
  }
  /* The letters in order, close together: "o8" style shorthand. Letters spread across a long name
     were noise ("cash" found a championship mix, "nlh" found No Limit Omaha). */
  if (q.length >= 3) {
    let i = 0, first = -1, last = -1;
    for (let k = 0; k < t.length && i < q.length; k += 1) if (t[k] === q[i]) { if (first < 0) first = k; last = k; i += 1; }
    if (i === q.length && last - first < q.length * 2) return 40;
  }
  return 0;
}

/** Rows and mixes matching `query`, best first. A mix scores 0.6 of its best game's match, or its
 *  own name's. Rare rows only appear here. */
export function search(rows, mixes, query) {
  const q = norm(query);
  if (!q) return { rows: [], mixes: [] };
  const scored = rows.map((r) => {
    const s = Math.max(score(q, r.name), score(q, r.game) * 0.9, ...r.aliases.map((a) => score(q, a) * 0.95));
    return { r, s: s - (r.rare ? 5 : 0) };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const best = new Map(scored.map((x) => [x.r.key, x.s]));
  const ms = mixes.map((m) => { const own = score(q, m.mix); return { m, own, s: Math.max(own, 0.6 * Math.max(0, ...m.games.map((g) => best.get(g.key) || 0))) }; })
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  // `byGame`: the mixes found only because they deal a game found; the palette folds them under the game.
  return { rows: scored.map((x) => x.r), mixes: ms.map((x) => x.m), byGame: new Set(ms.filter((x) => x.own < 72).map((x) => x.m.key)) };
}

// ── Recent: the last distinct picks (replayer_game_history, newest first) ─────────────────────
export function recentRows(rows, history, n = 5) {
  const out = [];
  for (const h of history || []) {
    const r = rows.find((x) => x.game === h.game && x.structure === h.structure);
    if (!r) continue;
    const key = r.key + '|' + (h.mix || '');
    if (out.some((x) => x.k === key)) continue;
    out.push({ k: key, row: r, mix: h.mix || null });
    if (out.length >= n) break;
  }
  return out;
}

// ── The best guess (the study's direction 10) ──────────────────────────────────────────────────
// What the player is most likely writing up, from the first of: an event on My Schedule they are in
// now (a live update that is not a bust or a bag, today); one starting within 3 h; one that started
// within the last 8 h (writing a hand up after); else nothing (the launcher shows the last game).
// For a mix the guess carries the rotation, so its games are one tap each.
const H = 3600e3;
export function bestGuess({ rows, schedule = [], updates = [], now = Date.now(), today = null } = {}) {
  const live = new Set((updates || []).filter((u) => !u.is_busted && !u.isBusted && !u.is_bagged && !u.isBagged)
    .map((u) => Number(u.tournament_id ?? u.tournamentId)));
  const cands = [];
  for (const t of schedule || []) {
    if (today && normaliseDate(t.date) !== today) continue;
    const ts = parseTournamentTime(t);
    if (!Number.isFinite(ts)) continue;
    let rank = null, why = null;
    if (live.has(Number(t.id))) { rank = 0; why = 'Playing now'; }
    else if (ts > now && ts - now <= 3 * H) { rank = 1; why = 'Starting soon'; }
    else if (ts <= now && now - ts <= 8 * H) { rank = 2; why = 'Today'; }
    if (rank == null) continue;
    cands.push({ t, ts, rank, why });
  }
  cands.sort((a, b) => a.rank - b.rank || Math.abs(a.ts - now) - Math.abs(b.ts - now));
  for (const c of cands) {
    const d = describeGame(c.t.game_variant, c.t.event_name);
    if (!d) continue;
    const types = d.games.length ? d.games : [d.label];
    const games = types.map((x) => rowForGameType(rows, x)).filter(Boolean)
      .filter((r, i, a) => a.findIndex((y) => y.key === r.key) === i);
    if (!games.length) continue;
    return {
      reason: c.why, event: c.t, venue: c.t.venue, property: c.t.property || null,
      mix: d.games.length ? d.label : null, games, row: games[0],
    };
  }
  return null;
}

/** The family tag a row wears: the saved-hand strip's abbreviation and colour. */
export const rowStrip = (row) => getVariantStrip(row.gameType || row.game);
