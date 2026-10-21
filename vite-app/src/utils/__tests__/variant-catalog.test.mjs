// node --test src/utils/__tests__/variant-catalog.test.mjs   (from vite-app/)
// The variant picker's data layer (utils/variant-catalog.js): every game and structure its own row,
// the schedule's rotations resolved to rows, the matcher, Recent and the best guess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis.window || globalThis;
const V = await import('../variant-catalog.js');
const U = await import('../utils.js');

const rows = V.buildCatalog(['Kansas Badugi']);
const mixes = V.buildMixes(rows);
const byKey = (k) => rows.find((r) => r.key === k);

test('rows: each game and structure apart, with the engine type and the name a player uses', () => {
  assert.equal(byKey("Hold'em|Limit").gameType, 'LHE');
  assert.equal(byKey("Hold'em|Limit").name, "Limit Hold'em");
  assert.equal(byKey('Omaha 8/b|Limit').gameType, 'O8');
  assert.equal(byKey('Omaha 8/b|Limit').name, 'O8');
  assert.equal(byKey('Omaha 8/b|Pot Limit').name, 'PLO8');
  assert.equal(byKey('Omaha|Limit').gameType, 'LO Hi', 'limit Omaha is hi-only');
  assert.equal(byKey('PLO5|Pot Limit').name, 'PLO5');
  assert.equal(byKey('Razz|Limit').name, 'Razz');
  assert.ok(byKey('Stud Hi|No Limit').rare, 'NL Stud is search-only');
  assert.ok(!byKey('Omaha 8/b|No Limit').rare);
  assert.equal(byKey('custom|Kansas Badugi').family, 'other');
  // Every row maps to an engine type.
  for (const r of rows) assert.ok(r.gameType, r.key);
});

test('mixes: the schedule\'s rotations, each game resolved to its usual row', () => {
  const horse = mixes.find((m) => m.mix === 'HORSE');
  assert.deepEqual(horse.games.map((g) => g.gameType), ['LHE', 'O8', 'Razz', 'Stud Hi', 'Stud 8']);
  const dc = mixes.find((m) => m.mix === "Dealer's Choice");
  assert.ok(dc.games.some((g) => g.gameType === 'Stud 8'), 'Stud Hi-Lo resolves to Stud 8');
  assert.ok(mixes.every((m) => m.games.length > 1));
});

test('search: the study\'s examples', () => {
  const o8 = V.search(rows, mixes, 'o8');
  assert.equal(o8.rows[0].gameType, 'O8');
  assert.ok(o8.rows.slice(0, 5).some((r) => r.gameType === 'PLO8'));
  assert.ok(o8.mixes.some((m) => m.mix === 'HORSE'), 'mixes that deal O8');
  assert.equal(V.search(rows, mixes, 'O/8').rows[0].gameType, 'O8', 'punctuation folds');
  const deuce = V.search(rows, mixes, 'deuce').rows.map((r) => r.gameType);
  assert.equal(deuce[0], '2-7 TD');
  assert.equal(V.search(rows, mixes, 'bad').rows[0].game, 'Badugi');
  assert.equal(V.search(rows, mixes, 'lhe').rows[0].gameType, 'LHE');
  assert.equal(V.search(rows, mixes, 'horse').mixes[0].mix, 'HORSE');
  assert.ok(V.search(rows, mixes, 'nl stud').rows.some((r) => r.key === 'Stud Hi|No Limit'), 'rare rows are found');
  assert.deepEqual(V.search(rows, mixes, '').rows, []);
});

test('recent: the last distinct picks, with the mix they were dealt in', () => {
  const hist = [
    { game: 'Razz', structure: 'Limit', mix: 'HORSE' }, { game: "Hold'em", structure: 'No Limit' },
    { game: 'Razz', structure: 'Limit', mix: 'HORSE' }, { game: 'Razz', structure: 'Limit' }, { game: 'Gone', structure: 'Limit' },
  ];
  const r = V.recentRows(rows, hist);
  assert.deepEqual(r.map((x) => [x.row.gameType, x.mix]), [['Razz', 'HORSE'], ['NLH', null], ['Razz', null]]);
});

test('best guess: live first, then soon, then earlier today; a mix carries its rotation', () => {
  const ev = (id, time, variant, name) => ({ id, date: 'October 20, 2026', time, venue: 'Borgata Fall Poker Open', game_variant: variant, event_name: name });
  const schedule = [ev(1, '12:00 PM', 'NLH', 'NLH Deepstack'), ev(2, '5:00 PM', 'Mixed', 'HORSE'), ev(3, '11:00 AM', 'PLO', 'PLO')];
  // Three hours after the noon start, in the venue's own zone (parseTournamentTime's).
  const now = U.parseTournamentTime(schedule[0]) + 3 * 3600e3;
  const g1 = V.bestGuess({ rows, schedule, updates: [{ tournament_id: 3 }], now, today: '2026-10-20' });
  assert.equal(g1.reason, 'Playing now');
  assert.equal(g1.row.gameType, 'PLO');
  const g2 = V.bestGuess({ rows, schedule, updates: [], now, today: '2026-10-20' });
  assert.equal(g2.reason, 'Starting soon');
  assert.equal(g2.mix, 'HORSE');
  assert.deepEqual(g2.games.map((g) => g.gameType), ['LHE', 'O8', 'Razz', 'Stud Hi', 'Stud 8']);
  // A bust is not "playing now".
  const g3 = V.bestGuess({ rows, schedule: [schedule[2]], updates: [{ tournament_id: 3, is_busted: 1 }], now, today: '2026-10-20' });
  assert.equal(g3.reason, 'Today');
  assert.equal(V.bestGuess({ rows, schedule: [], now, today: '2026-10-20' }), null);
});
