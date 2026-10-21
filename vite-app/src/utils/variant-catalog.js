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
  'No Limit':  { "Hold'em": 'NLH', 'Pineapple': 'NLH', 'Short Deck': 'Short Deck',
    'Omaha': 'PLO', 'Omaha 8/b': 'NLO8', 'Big O': 'Big O', 'PLO6 8/b': 'PLO6 8/b', 'PLO5': 'PLO5', 'PLO6': 'PLO6',
    'Double Board Bomb Pot': 'PLO', 'Courchevel': 'PLO',
    'Stud Hi': 'NL Stud Hi', 'Stud 8/b': 'NL Stud 8', 'Razz': 'NL Razz',
    'Stud Hi/Lo Regular': 'Stud 8', '2-7 Razz': 'Razz',
    'Razzdugi': 'Badugi', 'Razzdeucy': 'Badeucy',
    '2-7 Triple Draw': '2-7 TD', '2-7 Single Draw': 'NL 2-7 SD',
    'A-5 Triple Draw': 'A-5 TD', 'A-5 Single Draw': 'A-5 TD',
    'Badugi': 'Badugi', 'Badeucy': 'Badeucy', 'Badacey': 'Badacy',
    'Archie 66': 'Badugi', 'Archie 99': 'Badugi', 'Ari': 'Badugi',
    '5-Card Draw': 'PL 5CD Hi', 'OFC': 'OFC',
    'Dramaha Hi': 'PLO', 'Dramaha 2-7': 'PLO', 'Dramaha 49': 'PLO', 'Dramaha 0': 'PLO', 'Dramadugi': 'PLO', 'Omajack': 'PLO' },
  'Pot Limit': { "Hold'em": 'PLH', 'Pineapple': 'PLH', 'Short Deck': 'Short Deck',
    'Omaha': 'PLO', 'Omaha 8/b': 'PLO8', 'Big O': 'Big O', 'PLO6 8/b': 'PLO6 8/b', 'PLO5': 'PLO5', 'PLO6': 'PLO6',
    'Double Board Bomb Pot': 'PLO', 'Courchevel': 'PLO',
    'Stud Hi': 'PL Stud Hi', 'Stud 8/b': 'PL Stud 8', 'Razz': 'PL Razz',
    'Stud Hi/Lo Regular': 'Stud 8', '2-7 Razz': 'Razz',
    'Razzdugi': 'Badugi', 'Razzdeucy': 'Badeucy',
    '2-7 Triple Draw': 'PL 2-7 TD', '2-7 Single Draw': 'NL 2-7 SD',
    'A-5 Triple Draw': 'A-5 TD', 'A-5 Single Draw': 'A-5 TD',
    'Badugi': 'Badugi', 'Badeucy': 'Badeucy', 'Badacey': 'Badacy',
    'Archie 66': 'Badugi', 'Archie 99': 'Badugi', 'Ari': 'Badugi',
    '5-Card Draw': 'PL 5CD Hi', 'OFC': 'OFC',
    'Dramaha Hi': 'PLO', 'Dramaha 2-7': 'PLO', 'Dramaha 49': 'PLO', 'Dramaha 0': 'PLO', 'Dramadugi': 'PLO', 'Omajack': 'PLO' },
  'Limit':     { "Hold'em": 'LHE', 'Pineapple': 'LHE', 'Short Deck': 'Short Deck',
    'Omaha': 'LO Hi', 'Omaha 8/b': 'O8', 'Big O': 'Big O', 'PLO6 8/b': 'PLO6 8/b', 'PLO5': 'PLO5', 'PLO6': 'PLO6',
    'Double Board Bomb Pot': 'PLO', 'Courchevel': 'PLO',
    'Stud Hi': 'Stud Hi', 'Stud 8/b': 'Stud 8', 'Razz': 'Razz',
    'Stud Hi/Lo Regular': 'Stud 8', '2-7 Razz': 'Razz',
    'Razzdugi': 'Badugi', 'Razzdeucy': 'Badeucy',
    '2-7 Triple Draw': '2-7 TD', '2-7 Single Draw': 'NL 2-7 SD',
    'A-5 Triple Draw': 'A-5 TD', 'A-5 Single Draw': 'A-5 TD',
    'Badugi': 'Badugi', 'Badeucy': 'Badeucy', 'Badacey': 'Badacy',
    'Archie 66': 'Badugi', 'Archie 99': 'Badugi', 'Ari': 'Badugi',
    '5-Card Draw': 'PL 5CD Hi', 'OFC': 'OFC',
    'Dramaha Hi': 'PLO', 'Dramaha 2-7': 'PLO', 'Dramaha 49': 'PLO', 'Dramaha 0': 'PLO', 'Dramadugi': 'PLO', 'Omajack': 'PLO' },
};
export const DEFAULT_STRUCTURE = {
  "Hold'em": 'No Limit', 'Pineapple': 'No Limit', 'Short Deck': 'No Limit',
  'Omaha': 'Pot Limit', 'Omaha 8/b': 'Pot Limit', 'Big O': 'Pot Limit', 'PLO6 8/b': 'Pot Limit',
  'PLO5': 'Pot Limit', 'PLO6': 'Pot Limit',
  'Double Board Bomb Pot': 'No Limit', 'Courchevel': 'Pot Limit',
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
  'No Limit|Double Board Bomb Pot': 'Bomb Pot',
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
};
// Search words beyond the name: the abbreviations and slang a player types.
const ALIASES = {
  "Hold'em|No Limit": ['nlh', 'nlhe', 'holdem', 'hold em', 'no limit holdem', 'texas'],
  "Hold'em|Limit": ['lhe', 'limit holdem', 'fl holdem', 'fixed limit'],
  "Hold'em|Pot Limit": ['plh', 'pot limit holdem'],
  'Short Deck|No Limit': ['6+', 'six plus', 'shortdeck', 'sd'],
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
  'Double Board Bomb Pot|No Limit': ['bomb pot', 'double board'],
  'Stud Hi|Limit': ['stud', 'seven card stud', '7 stud', '7cs'],
  'Stud 8/b|Limit': ['stud 8', 'stud hi lo', 'stud8', 'eight or better'],
  'Razz|Limit': ['razz', 'a5 stud'],
  '2-7 Razz|Limit': ['27 razz', 'deuce razz'],
  '2-7 Triple Draw|Limit': ['27td', '2-7 td', 'deuce', 'deuce to seven', 'triple draw', 'td'],
  '2-7 Triple Draw|Pot Limit': ['pl 27 td', 'pl deuce'],
  '2-7 Single Draw|No Limit': ['27sd', 'nl 27', 'single draw', 'kansas city'],
  'A-5 Triple Draw|Limit': ['a5td', 'a-5 td', 'ace to five'],
  'A-5 Single Draw|No Limit': ['a5sd'],
  '5-Card Draw|No Limit': ['5cd', 'five card draw', 'draw hi'],
  'Badugi|Limit': ['badugi'],
  'Badeucy|Limit': ['badeucy'],
  'Badacey|Limit': ['badacy', 'badacey'],
  'OFC|No Limit': ['ofc', 'open face', 'chinese', 'pineapple ofc'],
};

/** Every row the picker offers: { key, game, structure, gameType, name, family, rare, aliases }.
 *  customNames: the account's custom games (GET /api/replayer/games), appended to Other. */
export function buildCatalog(customNames = []) {
  const rows = [];
  for (const fam of FAMILIES) {
    for (const game of fam.games) {
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
const TYPE_ALIASES = { 'Stud Hi-Lo': 'Stud 8', 'L 2-7 TD': '2-7 TD', 'NL 5CD': 'PL 5CD Hi' };

/** The usual row for an engine game type (a mix's "O8", a guess's "LHE"), or null. */
export function rowForGameType(rows, gameType) {
  const t = TYPE_ALIASES[gameType] || gameType;
  const hits = rows.filter((r) => r.gameType === t);
  return hits.find((r) => r.structure === DEFAULT_STRUCTURE[r.game] && !r.rare) || hits.find((r) => !r.rare) || hits[0] || null;
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
function score(q, text) {
  const t = norm(text);
  if (!t || !q) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 88;
  if (t.includes(q)) return 72;
  if (q.length >= 3) {          // in-order letters, 3+ typed only (fewer is noise)
    let i = 0;
    for (const ch of t) if (ch === q[i]) i += 1;
    if (i === q.length) return 40;
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
  const ms = mixes.map((m) => ({ m, s: Math.max(score(q, m.mix), 0.6 * Math.max(0, ...m.games.map((g) => best.get(g.key) || 0))) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return { rows: scored.map((x) => x.r), mixes: ms.map((x) => x.m) };
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
