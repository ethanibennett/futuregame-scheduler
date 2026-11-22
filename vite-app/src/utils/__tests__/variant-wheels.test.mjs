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
    ["Hold'em", 'Omaha', 'Stud', 'Razz', '2-7 Draw', 'A-5 Draw', 'Badugi', '5-Card Draw', 'Archie', 'Ari', 'Dramaha', 'Omajack', 'OFC', 'Custom']);
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
  assert.deepEqual(labels('27draw'), ['Triple Draw', 'Single Draw']);
  assert.deepEqual(labels('a5draw'), ['Triple Draw', 'Single Draw']);
  assert.deepEqual(labels('holdem'), ['Texas', 'Pineapple', 'Short Deck']);
  assert.deepEqual(labels('razz'), ['A-5', 'Razzdugi', 'Razzdeucy', '2-7']);
  assert.deepEqual(labels('custom'), CUSTOM, 'a custom game keeps its own name');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  for (const g of wheels.groups) {
    if (g.games.length < 2 || g.custom) continue;
    const ls = g.games.map((game) => W.variantLabel(g, game));
    assert.equal(new Set(ls).size, ls.length, `${g.label}: two rows read the same`);
    // The family's name ("2-7" of 2-7 Draw, "Stud"), as a word of its own: "Razzdugi" is one word, not "Razz" again,
    // and "Triple Draw" is the owner's own example under 2-7 Draw.
    const word = g.label.split(' ')[0];
    for (const l of ls) assert.ok(!new RegExp(`(^|\\s)${esc(word)}(\\s|$)`, 'i').test(l), `${g.label} wheel repeats "${word}" in "${l}"`);
  }
});

test('the line under the wheels', () => {
  const r = (k) => rows.find((x) => x.key === k);
  assert.deepEqual(W.wheelHint(wheels, r('Stud Hi|No Limit'), false), { warn: 'Unusual:', text: 'Stud Hi is usually limit.' });
  assert.equal(W.wheelHint(wheels, r("Hold'em|No Limit"), false).text, "Hold'em has 2 variants: tap › to choose one.");
  assert.equal(W.wheelHint(wheels, r("Hold'em|No Limit"), true).text, '');
  assert.equal(W.wheelHint(wheels, r('Short Deck|No Limit'), true).text, 'Short Deck is only played no limit.');
  assert.equal(W.wheelHint(wheels, r('OFC|No Limit'), false).text, '');
  assert.equal(W.wheelHint(wheels, r("Hold'em|Limit"), true).text, '', 'limit hold\'em is not unusual');
});

test('quick picks: recent rows, else NLH, PLO and 2-7 TD', () => {
  assert.deepEqual(W.quickPicks(rows, []).rows.map((r) => r.gameType), ['NLH', 'PLO', '2-7 TD']);
  assert.equal(W.quickPicks(rows, []).recent, false);
  const recent = C.recentRows(rows, [{ game: 'Razz', structure: 'Limit' }, { game: 'Omaha 8/b', structure: 'Limit' }]);
  const q = W.quickPicks(rows, recent);
  assert.deepEqual(q.rows.map((r) => r.gameType), ['Razz', 'O8']);
  assert.equal(q.recent, true);
});
