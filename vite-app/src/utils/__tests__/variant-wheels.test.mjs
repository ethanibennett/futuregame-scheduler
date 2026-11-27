// node --test src/utils/__tests__/variant-wheels.test.mjs   (from vite-app/)
// The variant wheels (utils/variant-wheels.js) are a second view of the catalog the palette lists
// (utils/variant-catalog.js): every catalog row is one position of the three wheels, every position
// that is not struck through is a catalog row, and a pick is the row itself, so the game type the
// entry gets is the one the old picker set (STRUCTURE_GAME_MAP[structure][game]).
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis.window || globalThis;
const C = await import('../variant-catalog.js');
const W = await import('../variant-wheels.js');
const U = await import('../utils.js');

const CUSTOM = ['Kansas Badugi', 'Irish'];
const rows = C.buildCatalog(CUSTOM);
const wheels = W.buildWheels(rows);

test('every catalog row is reachable, and lands back on itself', () => {
  for (const r of rows) {
    const pos = W.positionOf(wheels, r);
    assert.ok(pos, `no position for ${r.key}`);
    assert.ok(pos.s >= 0, `${r.key}: structure ${r.structure} is not on the wheel`);
    assert.equal(W.rowOfPosition(wheels, pos), r, `${r.key} at ${JSON.stringify(pos)}`);
  }
});

test('no position makes a row the catalog does not have (none extra, none missing)', () => {
  const seen = new Set();
  wheels.groups.forEach((grp, g) => grp.games.forEach((game, v) => W.STRUCTURES.forEach((s, si) => {
    const r = W.rowOfPosition(wheels, { g, v, s: si });
    if (!r) return;
    assert.ok(rows.includes(r), `${game} ${s} is not a catalog row`);
    assert.equal(r.game, game);
    assert.equal(r.structure, s);
    assert.ok(!seen.has(r.key), `${r.key} reached twice`);
    seen.add(r.key);
  })));
  assert.deepEqual([...seen].sort(), rows.map((r) => r.key).sort());
});

test('a pick sets the game type the old picker set', () => {
  for (const r of rows) {
    const want = r.custom ? r.game : C.STRUCTURE_GAME_MAP[r.structure][r.game];
    assert.equal(r.gameType, want, r.key);
    assert.equal(C.gameTypeOf(r.game, r.structure) || r.game, want, r.key);
  }
});

test('the game wheel: the prototype families, each game in one place, nothing left over', () => {
  assert.deepEqual(wheels.groups.map((g) => g.label),
    ["Hold'em", 'Omaha', 'Stud', 'Razz', '2-7', 'A-5', 'Badugi', '5-Card', 'Archie', 'Ari', 'Dramaha', 'Omajack', 'OFC', 'Custom']);
  assert.ok(!wheels.groups.some((g) => g.unplaced), 'every built game is named by a family');
  const all = wheels.groups.flatMap((g) => g.games);
  assert.equal(new Set(all).size, all.length, 'no game in two places');
  assert.deepEqual(wheels.groups.find((g) => g.key === 'holdem').games, ["Hold'em", 'Pineapple', 'Short Deck']);
  assert.deepEqual(wheels.groups.find((g) => g.key === 'razz').games, ['Razz', 'Razzdugi', 'Razzdeucy', '2-7 Razz']);
  assert.deepEqual(wheels.groups.find((g) => g.key === 'custom').games, CUSTOM);
  // Unbuilt games stay off the wheels, as they stay out of the palette.
  for (const g of C.UNBUILT_GAMES) assert.ok(!all.includes(g), g);
  // No custom games, no Custom row.
  assert.ok(!W.buildWheels(C.buildCatalog()).groups.some((g) => g.custom));
});

test('a game or variant turned lands on its usual structure; a structure turned keeps the game', () => {
  const omaha = wheels.groups.findIndex((g) => g.key === 'omaha');
  assert.equal(W.turnGame(wheels, omaha).key, 'Omaha|Pot Limit');
  const v8 = wheels.groups[omaha].games.indexOf('Omaha 8/b');
  assert.equal(W.turnVariant(wheels, omaha, v8).key, 'Omaha 8/b|Pot Limit');
  const o8 = W.turnStructure(wheels, W.turnVariant(wheels, omaha, v8), W.STRUCTURES.indexOf('Limit'));
  assert.equal(o8.gameType, 'O8');
  const stud = wheels.groups.findIndex((g) => g.key === 'stud');
  assert.equal(W.turnGame(wheels, stud).key, 'Stud Hi|Limit');
  // NL Stud is search-only in the palette (rare) and a turn of the structure wheel here.
  assert.ok(W.turnStructure(wheels, W.turnGame(wheels, stud), 0).rare);
  // Played one way only: the other structures spring back.
  const sd = C.buildCatalog().find((r) => r.game === 'Short Deck');
  assert.equal(W.turnStructure(wheels, sd, W.STRUCTURES.indexOf('Limit')), null);
  assert.equal(W.turnStructure(wheels, rows.find((r) => r.game === 'Badugi'), 0), null);
  // Every usual row is the game's default and not rare.
  for (const grp of wheels.groups) for (const game of grp.games) {
    const u = W.usualRow(wheels, game);
    assert.ok(u && !u.rare, game);
    if (!u.custom) assert.equal(u.structure, C.FIXED_STRUCTURE[game] || C.DEFAULT_STRUCTURE[game] || 'No Limit', game);
  }
});

test('the variant wheel never repeats the game wheel (owner, 2026-11-22: "Let\'s try not to repeat here")', () => {
  const labels = (key) => { const g = wheels.groups.find((x) => x.key === key); return g.games.map((game) => W.variantLabel(g, game)); };
  assert.deepEqual(labels('stud'), ['Hi', '8/b', 'Hi/Lo Regular']);
  assert.deepEqual(labels('27draw'), ['Triple Draw', 'Double Draw', 'Single Draw']);
  assert.deepEqual(labels('a5draw'), ['Triple Draw', 'Single Draw']);
  assert.deepEqual(labels('5cd'), ['Single Draw', 'Double Draw']);
  assert.deepEqual(labels('holdem'), ['Texas', 'Pineapple', 'Short Deck']);
  assert.deepEqual(labels('razz'), ['A-5', 'Razzdugi', 'Razzdeucy', '2-7']);
  assert.deepEqual(labels('custom'), CUSTOM, 'a custom game keeps its own name');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  for (const g of wheels.groups) {
    if (g.games.length < 2 || g.custom) continue;
    const ls = g.games.map((game) => W.variantLabel(g, game));
    assert.equal(new Set(ls).size, ls.length, `${g.label}: two rows read the same`);
    // The family's name ("2-7", "Stud"), as a word of its own: "Razzdugi" is one word, not "Razz" again,
    // and "Triple Draw" is the owner's own example under 2-7.
    const word = g.label.split(' ')[0];
    for (const l of ls) assert.ok(!new RegExp(`(^|\\s)${esc(word)}(\\s|$)`, 'i').test(l), `${g.label} wheel repeats "${word}" in "${l}"`);
  }
});

/* Every structure the wheels let a player turn to is dealt with that structure's betting (owner, 2026-11-22: "Default
   to the standard limit for each game but allow users to change it (NL A-5 Single Draw is a classic game)"). A pair
   whose game type would bet otherwise (No Limit Badugi -> 'Badugi', a limit game) stays struck through: it needs a
   game type of its own, never another game's. OFC has no betting structure (it is scored in points). */
test('every structure the wheels offer plays with that betting', async () => {
  const BET = { 'No Limit': 'nl', 'Pot Limit': 'pl', Limit: 'fl' };
  let open = 0, struck = 0;
  wheels.groups.forEach((grp, g) => grp.games.forEach((game, v) => W.STRUCTURES.forEach((s, si) => {
    const r = W.rowOfPosition(wheels, { g, v, s: si });
    const t = C.gameTypeOf(game, s);
    const cfg = t && U.HAND_CONFIG[t];
    if (r) {
      open += 1;
      if (r.custom || game === 'OFC') return;
      assert.ok(cfg, `${s} ${game}: ${t} has no rules`);
      assert.equal(cfg.betting, BET[s], `${s} ${game} plays as ${t} (${cfg.betting})`);
    } else {
      if (grp.custom) return;   // a custom game is played as it was set up: its one row
      struck += 1;
      if (game !== 'OFC') assert.ok(!cfg || cfg.betting !== BET[s], `${s} ${game} has a ${BET[s]} game type (${t}) but is struck through`);
    }
  })));
  // The owner's example, and the default.
  const a5sd = rows.find((r) => r.game === 'A-5 Single Draw' && r.structure === 'No Limit');
  assert.equal(a5sd.gameType, 'NL A-5 SD');
  assert.equal(U.HAND_CONFIG['NL A-5 SD'].betting, 'nl');
  assert.equal(W.usualRow(wheels, 'A-5 Single Draw'), a5sd);
  // 64 positions pick a row (the catalog's 62, NL Razz, OFC, the two double draws, Limit 5-Card Draw and Pot Limit
  // Badugi among them, and the 2 custom games); 49 do not: 47 wait for a game type of their own, and OFC's Pot Limit
  // and Limit, where no structure applies.
  assert.equal(open, 64);
  assert.equal(struck, 49);
  // Limit 5-Card Draw and Pot Limit Badugi (owner, 2026-11-27: "add Limit 5-Card Draw and Pot Limit Badugi too"): game
  // types of their own, never the pot-limit draw's or the limit badugi's; the usual structures are unchanged.
  const l5 = W.rowAt(wheels, '5-Card Draw', 'Limit');
  assert.equal(l5.gameType, 'L 5CD Hi');
  assert.equal(l5.name, 'Limit 5-Card Draw');
  assert.deepEqual(U.HAND_CONFIG['L 5CD Hi'].flSmallStreets, [0], 'a small bet before the draw, a big bet after');
  const plb = W.rowAt(wheels, 'Badugi', 'Pot Limit');
  assert.equal(plb.gameType, 'PL Badugi');
  assert.equal(plb.name, 'Pot Limit Badugi');
  assert.equal(U.HAND_CONFIG['PL Badugi'].heroCards, 4);
  assert.equal(W.usualRow(wheels, 'Badugi').structure, 'Limit');
  assert.equal(W.usualRow(wheels, '5-Card Draw').structure, 'No Limit');
  const QG = await import('../quick-add/game.js');
  const E = await import('../poker-engine.js');
  const S = await import('../hand-shorthand.js');
  assert.equal(QG.gameCategory('L 5CD Hi'), 'draw_single');
  assert.equal(QG.gameCategory('PL Badugi'), 'draw_triple');
  assert.equal(E.GAME_EVAL['PL Badugi'].type, 'badugi');
  assert.equal(E.GAME_EVAL['L 5CD Hi'].type, 'high');
  for (const t of ['L 5CD Hi', 'PL Badugi']) assert.equal(S.GAME_CODES_REV[S.GAME_CODES[t]], t, t + ' has a share-link code of its own');
});

/* The double draws (owner, 2026-11-27: "add Pot Limit 2-7 Double Draw and Pot Limit Double Draw Hi"): rows of their own,
   pot limit by default, dealt with two draws, a 2-7 low and a high hand. */
test('Pot Limit 2-7 Double Draw and Pot Limit Double Draw Hi', async () => {
  const QG = await import('../quick-add/game.js');
  const E = await import('../poker-engine.js');
  const S = await import('../hand-shorthand.js');
  for (const [game, type, name, low] of [['2-7 Double Draw', 'PL 2-7 DD', 'Pot Limit 2-7 Double Draw', '27'], ['Double Draw Hi', 'PL DD Hi', 'Pot Limit Double Draw Hi', null]]) {
    const r = W.usualRow(wheels, game);
    assert.equal(r.structure, 'Pot Limit', game);
    assert.equal(r.gameType, type);
    assert.equal(r.name, name);
    assert.equal(U.HAND_CONFIG[type].betting, 'pl');
    assert.equal(QG.gameCategory(type), 'draw_double');
    assert.deepEqual(QG.streetDef(type).streets, ['Pre-Draw', 'First Draw', 'Second Draw']);
    assert.equal(E.GAME_EVAL[type].type, low ? 'low' : 'high');
    if (low) assert.equal(E.GAME_EVAL[type].lowType, low);
    assert.ok(S.GAME_CODES[type] && S.GAME_CODES_REV[S.GAME_CODES[type]] === type, type + ' has a share-link code of its own');
    for (const s of ['No Limit', 'Limit']) assert.equal(W.rowAt(wheels, game, s), null, `${s} ${game} is struck through`);
  }
  // Under 2-7 and 5-Card on the game wheel.
  const pos = W.positionOf(wheels, W.usualRow(wheels, 'Double Draw Hi'));
  assert.equal(wheels.groups[pos.g].label, '5-Card');
  assert.equal(W.variantLabel(wheels.groups[pos.g], 'Double Draw Hi'), 'Double Draw');
});

test('quick picks: recent rows, else NLH, PLO and 2-7 TD', () => {
  assert.deepEqual(W.quickPicks(rows, []).rows.map((r) => r.gameType), ['NLH', 'PLO', '2-7 TD']);
  assert.equal(W.quickPicks(rows, []).recent, false);
  const recent = C.recentRows(rows, [{ game: 'Razz', structure: 'Limit' }, { game: 'Omaha 8/b', structure: 'Limit' }]);
  const q = W.quickPicks(rows, recent);
  assert.deepEqual(q.rows.map((r) => r.gameType), ['Razz', 'O8']);
  assert.equal(q.recent, true);
});
