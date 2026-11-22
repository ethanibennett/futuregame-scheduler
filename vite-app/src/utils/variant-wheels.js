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
  { key: '27draw', label: '2-7 Draw', games: ['2-7 Triple Draw', '2-7 Single Draw'] },
  { key: 'a5draw', label: 'A-5 Draw', games: ['A-5 Triple Draw', 'A-5 Single Draw'] },
  { key: 'badugi', label: 'Badugi', games: ['Badugi', 'Badeucy', 'Badacey'] },
  { key: '5cd', label: '5-Card Draw', games: ['5-Card Draw'] },
  { key: 'archie', label: 'Archie', games: ['Archie 66', 'Archie 99'] },
  { key: 'ari', label: 'Ari', games: ['Ari'] },
  { key: 'dramaha', label: 'Dramaha', games: ['Dramaha Hi', 'Dramaha 2-7', 'Dramaha 49', 'Dramaha 0', 'Dramadugi'] },
  { key: 'omajack', label: 'Omajack', games: ['Omajack'] },
  { key: 'ofc', label: 'OFC', games: ['OFC'] },
];

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

/** The line under the wheels: a game played one way only, an unusual structure, or the variants to open. */
export function wheelHint(wheels, row, open) {
  if (!row) return { text: '' };
  const pos = positionOf(wheels, row);
  const grp = pos ? wheels.groups[pos.g] : null;
  const usual = usualRow(wheels, row.game);
  if (row.rare && usual) return { warn: 'Unusual:', text: `${row.game} is usually ${usual.structure.toLowerCase()}.` };
  if (grp && grp.games.length > 1 && !open) {
    const n = grp.games.length - 1;
    return { text: grp.custom ? `${n + 1} custom games: tap › to choose one.` : `${grp.label} has ${n} variant${n === 1 ? '' : 's'}: tap › to choose one.` };
  }
  if (!row.custom && row.game !== 'OFC' && structuresOf(wheels, row.game).size === 1) {
    return { text: `${row.game} is only played ${row.structure.toLowerCase()}.` };
  }
  return { text: '' };
}

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
