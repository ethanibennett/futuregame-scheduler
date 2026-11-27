// ── The variant wheels' data layer (owner, 2026-11-22: "Let's build the wheels picker") ─────────
// The New Hand picker as the owner revised direction 9 of the Variant Picker study (prototype
// docs/prototypes/variant-wheels.html, https://claude.ai/artifact/TKD2nCXC32Wz4SdZdBdKgh): a structure
// wheel (No Limit, Pot Limit, Limit), a game wheel of families named as a player says them (Hold'em,
// Omaha, Stud, Razz, 2-7 Draw...), and a game's variants on a third wheel that opens to the right.
//
// It is a second view of the same catalog (utils/variant-catalog.js buildCatalog): every position of
// the three wheels that is not struck through IS a catalog row, and every catalog row is one position,
// so a pick hands HandReplayerView the same row (and so the same gameType) the palette would. Pure:
// no React, no DOM (src/utils/__tests__/variant-wheels.test.mjs holds the mapping).
export const STRUCTURES = ['No Limit', 'Pot Limit', 'Limit'];
export const STRUCTURE_SHORT = { 'No Limit': 'NL', 'Pot Limit': 'PL', Limit: 'Limit' };

/* The game wheel, in the prototype's order. `games` is the variant wheel, the game itself first. A
   name the catalog has no row for is left out (Double Board Bomb Pot is UNBUILT_GAMES; the prototype's
   Action Razz has no rules of its own yet), so a game joins its wheel the day its row exists. */
export const WHEEL_GAMES = [
  { key: 'holdem', label: "Hold'em", games: ["Hold'em", 'Pineapple', 'Short Deck'] },
  { key: 'omaha', label: 'Omaha', games: ['Omaha', 'Omaha 8/b', 'Big O', 'PLO5', 'PLO6', 'PLO6 8/b', 'Courchevel', 'Double Board Bomb Pot'] },
  { key: 'stud', label: 'Stud', games: ['Stud Hi', 'Stud 8/b', 'Stud Hi/Lo Regular'] },
  { key: 'razz', label: 'Razz', games: ['Razz', 'Razzdugi', 'Razzdeucy', '2-7 Razz'] },
  /* The draw families are named by the hand they play (owner, 2026-11-27: "For the draw games let's just say A-5 and
     2-7, not A-5 draw etc, since the third wheel will say single draw/triple draw"); 5-Card the same way. */
  { key: '27draw', label: '2-7', games: ['2-7 Triple Draw', '2-7 Double Draw', '2-7 Single Draw'] },
  { key: 'a5draw', label: 'A-5', games: ['A-5 Triple Draw', 'A-5 Single Draw'] },
  { key: 'badugi', label: 'Badugi', games: ['Badugi', 'Badeucy', 'Badacey'] },
  { key: '5cd', label: '5-Card', games: ['5-Card Draw', 'Double Draw Hi'] },
  { key: 'archie', label: 'Archie', games: ['Archie 66', 'Archie 99'] },
  { key: 'ari', label: 'Ari', games: ['Ari'] },
  { key: 'dramaha', label: 'Dramaha', games: ['Dramaha Hi', 'Dramaha 2-7', 'Dramaha 49', 'Dramaha 0', 'Dramadugi'] },
  { key: 'omajack', label: 'Omajack', games: ['Omajack'] },
  { key: 'ofc', label: 'OFC', games: ['OFC'] },
];

/* The variant wheel never repeats what the game wheel says (owner, 2026-11-22: "Let's try not to repeat here. in
   stud the 3rd wheel can just say Hi, 8/b, hi/lo regular. 2-7 can just say triple draw, single draw"): each row is
   what tells it apart from its family. A name that is one word of its own (Razzdugi, Badeucy, Dramadugi) stays whole;
   a family's plain game is named by what it is beside the others (Texas Hold'em, Omaha Hi, A-5 Razz). The rows'
   games, and so their game types, are unchanged: this is the label only. */
export const VARIANT_LABEL = {
  "Hold'em": 'Texas', 'Pineapple': 'Pineapple', 'Short Deck': 'Short Deck',
  'Omaha': 'Hi', 'Omaha 8/b': '8/b', 'Big O': 'Big O', 'PLO5': '5-Card', 'PLO6': '6-Card', 'PLO6 8/b': '6-Card 8/b', 'Courchevel': 'Courchevel',
  'Stud Hi': 'Hi', 'Stud 8/b': '8/b', 'Stud Hi/Lo Regular': 'Hi/Lo Regular',
  'Razz': 'A-5', 'Razzdugi': 'Razzdugi', 'Razzdeucy': 'Razzdeucy', '2-7 Razz': '2-7',
  '2-7 Triple Draw': 'Triple Draw', '2-7 Double Draw': 'Double Draw', '2-7 Single Draw': 'Single Draw',
  'A-5 Triple Draw': 'Triple Draw', 'A-5 Single Draw': 'Single Draw',
  'Badugi': 'Standard', 'Badeucy': 'Badeucy', 'Badacey': 'Badacey',
  '5-Card Draw': 'Single Draw', 'Double Draw Hi': 'Double Draw',
  'Archie 66': '66', 'Archie 99': '99',
  'Dramaha Hi': 'Hi', 'Dramaha 2-7': '2-7', 'Dramaha 49': '49', 'Dramaha 0': '0', 'Dramadugi': 'Dramadugi',
};

/** A game's row on its family's variant wheel: VARIANT_LABEL, else the name less the family's ("Foo Hi" -> "Hi"),
 *  else the name (a custom game). */
export function variantLabel(group, game) {
  if (VARIANT_LABEL[game]) return VARIANT_LABEL[game];
  const fam = group && !group.custom ? group.label : '';
  if (fam && game.toLowerCase().startsWith(fam.toLowerCase() + ' ')) return game.slice(fam.length + 1);
  return game;
}

/** The wheels for a catalog (buildCatalog's rows, custom games included):
 *  { groups: [{ key, label, family, games }], byGame: Map(game -> its rows, the usual first) }.
 *  A catalog game no group names gets a group of its own at the end, so nothing is ever unreachable
 *  (the test holds that no built game needs it); the account's custom games are one "Custom" group. */
export function buildWheels(rows) {
  const byGame = new Map();
  for (const r of rows || []) {
    if (!byGame.has(r.game)) byGame.set(r.game, []);
    byGame.get(r.game).push(r);
  }
  const famOf = (game) => (byGame.get(game) || [])[0]?.family || 'other';
  const named = new Set();
  const groups = [];
  for (const w of WHEEL_GAMES) {
    const games = w.games.filter((g) => byGame.has(g) && !byGame.get(g)[0].custom);
    games.forEach((g) => named.add(g));
    if (games.length) groups.push({ key: w.key, label: w.label, family: famOf(games[0]), games });
  }
  const custom = [];
  for (const [game, rs] of byGame) {
    if (named.has(game)) continue;
    if (rs[0].custom) custom.push(game);
    else groups.push({ key: 'game:' + game, label: game, family: famOf(game), games: [game], unplaced: true });
  }
  if (custom.length) groups.push({ key: 'custom', label: 'Custom', family: 'other', games: custom, custom: true });
  return { groups, byGame };
}

/** The structures a game is played at in the catalog (its rows' structures). */
export const structuresOf = (wheels, game) => new Set((wheels.byGame.get(game) || []).map((r) => r.structure));

/** The catalog row for a game at a structure, or null (that structure is struck through). */
export const rowAt = (wheels, game, structure) => (wheels.byGame.get(game) || []).find((r) => r.structure === structure) || null;

/** A game's usual row: the catalog lists it first (ROWS_FOR, DEFAULT_STRUCTURE or FIXED_STRUCTURE). */
export const usualRow = (wheels, game) => (wheels.byGame.get(game) || [])[0] || null;

/** Where a row sits: { g, v, s } (game wheel, variant wheel, structure wheel), or null. */
export function positionOf(wheels, row) {
  if (!row) return null;
  for (let g = 0; g < wheels.groups.length; g += 1) {
    const v = wheels.groups[g].games.indexOf(row.game);
    if (v >= 0) return { g, v, s: STRUCTURES.indexOf(row.structure) };
  }
  return null;
}

/** The row a position names, or null where the structure is struck through. */
export function rowOfPosition(wheels, { g, v, s }) {
  const grp = wheels.groups[g];
  const game = grp && grp.games[v];
  return game ? rowAt(wheels, game, STRUCTURES[s]) : null;
}

// ── The three moves. Each returns the row to pick, or null to spring back. ──
/** The game wheel turned: the family's first game at its usual structure (the structure follows). */
export const turnGame = (wheels, g) => { const grp = wheels.groups[g]; return grp ? usualRow(wheels, grp.games[0]) : null; };
/** The variant wheel turned: that game at its usual structure. */
export const turnVariant = (wheels, g, v) => { const grp = wheels.groups[g]; return grp && grp.games[v] ? usualRow(wheels, grp.games[v]) : null; };
/** The structure wheel turned: this game at that structure, or null where it is not played so. */
export const turnStructure = (wheels, row, s) => (row ? rowAt(wheels, row.game, STRUCTURES[s]) : null);

/** The quick picks over the wheels: the player's recent rows (recentRows' output) or, with none,
 *  the three games most hands are written in. */
export function quickPicks(rows, recent, n = 3) {
  const out = [];
  for (const x of recent || []) {
    const r = x.row || x;
    if (r && !out.some((o) => o.key === r.key)) out.push(r);
    if (out.length >= n) return { rows: out, recent: true };
  }
  if (out.length) return { rows: out, recent: true };
  const pick = (game, structure) => (rows || []).find((r) => r.game === game && r.structure === structure);
  return { rows: [pick("Hold'em", 'No Limit'), pick('Omaha', 'Pot Limit'), pick('2-7 Triple Draw', 'Limit')].filter(Boolean).slice(0, n), recent: false };
}
