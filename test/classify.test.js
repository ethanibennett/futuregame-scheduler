// lib/staking/classify.js — which game and channel a result was (docs/bankroll-merge.md §6.3).
//
//   node --test test/classify.test.js        (or: npm run test:standing)
//
// formatOf is an ORDERED table, so every row is tested by itself and the order is tested where it
// bites: Big O before PLO8 before PLO, the mixes before everything, 2-7 before NLH. Per the owner's
// answer of 2026-10-14 (Q8) every game is its own key: PLO5 is not PLO, PLO6 8/b is not PLO8.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const initSqlJs = require('sql.js');
const classify = require('../lib/staking/classify');
const moneyMerge = require('../lib/money-merge');

const { formatOf, GAMES, FORMATS, ONLINE_ROOM } = classify;

// [label, key]
const ROWS = {
  NLH: ['NLH', 'nlh', 'NLHE', 'NL', 'nl', "No-Limit Hold'em", 'No Limit Hold’em', 'no-limit holdem', 'Holdem', "Hold'em", 'NL Hold em', 'NL 2/5'],
  PLO: ['PLO', 'plo', 'PLO4', '4-card PLO', 'Pot-Limit Omaha', 'pot limit omaha', 'Omaha', 'PLO 5/10', 'PLO 8/16'],
  PLO5: ['PLO5', 'plo5', '5-card PLO', '5 card plo', '5-Card Pot-Limit Omaha'],
  PLO6: ['PLO6', 'plo6', '6-card PLO', '6 card plo'],
  PLO8: ['PLO8', 'plo 8', 'PLO4 8', 'O8', 'o8', 'PLO Hi-Lo', 'PLO hilo', 'PLO H/L', 'PLO 8/b', 'Omaha Hi-Lo', 'omaha 8', 'Omaha 8/b', 'PLO8 Hi-Lo', 'PLO 8 or better'],
  PLO6_8: ['PLO6 8/b', 'plo6 8', 'PLO6 Hi-Lo', 'plo6 h/l', '6-card PLO8', '6 card plo hi-lo'],
  BigO: ['Big O', 'big o', 'BigO', 'Big-O', '5-card PLO8', '5 card plo hi-lo', '5-card PLO 8/b', 'PLO5 8', 'plo5 hi-lo', '5 card omaha hi-lo'],
  stud8: ['Stud 8', 'stud8', 'Stud Hi-Lo', 'stud hi/lo', 'Seven Card Stud Hi-Lo', '7-card stud hi-lo', 'stud eight or better', 'Stud 8/b'],
  razz: ['Razz', 'RAZZ', '2-7 Razz'],
  '2-7': ['2-7', '2-7 Triple Draw', '2-7 TD', 'L 2-7 TD', 'PL 2-7 TD', 'Deuce', 'triple draw', 'Triple Draw'],
  '2-7sd': ['Single Draw', 'NL 2-7 Single Draw', '2-7 Single Draw', '2-7 SD', 'NL 2-7'],
  HORSE: ['HORSE', 'horse', 'H.O.R.S.E.', 'HORSE Championship'],
  '8-game': ['8-game', '8 game', '8-Game Mix', '8-Game Mix (Chainsaw)', '8 Games'],
  '9-game': ['9-game', '9-Game Mix', '9 game mixed'],
  '10-game': ['10-game', '10-Game Mix'],
  'dealers-choice': ["Dealer's Choice", 'dealers choice', "Big Bet Dealer's Choice", 'Dealer’s Choice'],
  'plo-nlh': ['PLO/NLH', 'plo/nlh', 'PLO/NLH Mix', 'NLH/PLO', 'nlh / plo', 'PLO & NLHE'],
  mixed: ['Mixed', 'mixed', 'Mix', 'mix', 'Rotation', 'Mixed PLO', 'Mixed Triple Draw', 'Mixed Big Bet', '7-Game Mix', 'Mixed Omaha'],
  other: ['', '   ', 'Other', 'other', 'Badugi', '7-Card Stud', 'Stud', "Limit Hold'em", 'Limit Holdem', "Pot-Limit Hold'em", 'LHE', 'TORSE', 'OE', 'Chinese Poker', 'Mixer', 'Sunday Mixer', 'Open Face', 'PLOT'],
};

test('every row of the table, label by label', () => {
  for (const [key, labels] of Object.entries(ROWS)) {
    for (const label of labels) assert.strictEqual(formatOf(label), key, `formatOf(${JSON.stringify(label)})`);
  }
});

test('every key in GAMES has a row in this test, and nothing else is returned', () => {
  assert.deepStrictEqual(Object.keys(ROWS).sort(), [...FORMATS].sort());
  assert.strictEqual(new Set(FORMATS).size, FORMATS.length, 'GAMES keys are unique');
  for (const g of GAMES) assert.ok(g.label, `${g.key} has a label`);
});

test('the dashboard\'s nine keys keep their meaning, and the app\'s variant labels (§5.2) map back to them', () => {
  const back = { PLO: 'PLO', PLO8: 'PLO8', NLH: 'NLH', Mixed: 'mixed', Other: 'other', 'Stud 8': 'stud8', Razz: 'razz', '2-7': '2-7', 'Big O': 'BigO' };
  for (const [label, key] of Object.entries(back)) assert.strictEqual(formatOf(label), key, label);
  for (const key of ['PLO', 'PLO8', 'NLH', 'mixed', 'stud8', 'razz', '2-7', 'BigO', 'other']) assert.ok(FORMATS.includes(key), key);
});

test('owner Q8: every game on its own — no family folds into another key', () => {
  assert.notStrictEqual(formatOf('PLO5'), 'PLO');
  assert.notStrictEqual(formatOf('PLO6'), 'PLO');
  assert.notStrictEqual(formatOf('5-card PLO'), 'PLO');
  assert.strictEqual(formatOf('PLO6 8/b'), 'PLO6_8');
  assert.notStrictEqual(formatOf('PLO6 8/b'), 'PLO8');
  assert.notStrictEqual(formatOf('HORSE'), 'mixed');
  assert.notStrictEqual(formatOf('8-Game Mix'), 'mixed');
  assert.notStrictEqual(formatOf("Dealer's Choice"), 'mixed');
  assert.notStrictEqual(formatOf('NL 2-7 Single Draw'), '2-7');
  // ...while two spellings of ONE game are one key
  assert.strictEqual(formatOf('Big O'), formatOf('5-card PLO8'));
  assert.strictEqual(formatOf('NL'), formatOf("No-Limit Hold'em"));
});

test('order: Big O before PLO8, PLO8 before PLO, sized PLO before PLO', () => {
  assert.strictEqual(formatOf('5-card PLO8'), 'BigO'); // contains PLO8 and PLO
  assert.strictEqual(formatOf('PLO8'), 'PLO8'); // contains PLO
  assert.strictEqual(formatOf('PLO Hi-Lo'), 'PLO8');
  assert.strictEqual(formatOf('PLO'), 'PLO');
  assert.strictEqual(formatOf('PLO5'), 'PLO5');
  // a stake size is not a hi-lo marker
  assert.strictEqual(formatOf('PLO 8/16'), 'PLO');
  assert.strictEqual(formatOf('PLO6 8/16'), 'PLO6');
});

test('order: the mixes lead, so a mix that names a game is still a mix', () => {
  assert.strictEqual(formatOf('PLO/NLH Mix'), 'plo-nlh'); // the spec table's own `plo/nlh` pattern
  assert.strictEqual(formatOf('Mixed PLO'), 'mixed');
  assert.strictEqual(formatOf('Mixed Triple Draw'), 'mixed');
  assert.strictEqual(formatOf('Mixed Omaha'), 'mixed');
});

test('order: 2-7 before NLH, so an NL draw game is not hold\'em', () => {
  assert.strictEqual(formatOf('NL 2-7 Single Draw'), '2-7sd');
  assert.strictEqual(formatOf('NL 2-7'), '2-7sd');
  assert.strictEqual(formatOf('NL'), 'NLH');
});

test('hold\'em variants that are not no-limit are other games', () => {
  for (const l of ["Limit Hold'em", 'Pot-Limit Hold’em', 'Fixed Limit Holdem', 'LHE']) assert.strictEqual(formatOf(l), 'other', l);
  assert.strictEqual(formatOf("No-Limit Hold'em"), 'NLH');
  assert.strictEqual(formatOf('Texas Hold’em'), 'NLH');
});

test('whole tokens only: a letter or digit glued to a pattern is not a match', () => {
  assert.strictEqual(formatOf('Mixer'), 'other'); // not "mix"
  assert.strictEqual(formatOf('Planets'), 'other'); // not "nl"? contains no `nl` token
  assert.strictEqual(formatOf('Online'), 'other'); // contains "nl" but not as a token
  assert.strictEqual(formatOf('Brazzers'), 'other'); // not "razz" as a token
  assert.strictEqual(formatOf('studio8'), 'other');
  assert.strictEqual(formatOf('PLO57'), 'other');
});

test('never throws, whatever it is given', () => {
  for (const v of [null, undefined, 0, 12, {}, [], NaN, true, '\u0000', 'x'.repeat(10000)]) assert.doesNotThrow(() => formatOf(v));
  assert.strictEqual(formatOf(null), 'other');
});

// ── channel ──
test('ONLINE_ROOM: the old rooms, the three new ones, and live rooms that must not match', () => {
  for (const r of ['ACR', 'Americas Cardroom', 'WinningPoker', 'GGPoker', 'GG Poker', 'Natural8', 'PokerStars', 'WSOP.com', 'WSOP Online',
    'ClubWPT', 'PartyPoker', 'Bovada', 'Ignition', 'BetOnline', '888poker', 'CoinPoker', 'Global Poker', 'Some Online Room',
    'BetRivers', 'Bet Rivers', 'Borgata Online', 'Phenom', 'phenom poker']) assert.ok(ONLINE_ROOM.test(r), r);
  for (const r of ['', 'Parx', 'Borgata', 'Bellagio', 'Aria', 'Hard Rock Tampa', 'Rivers Casino Pittsburgh', 'Wynn', 'Home game']) assert.ok(!ONLINE_ROOM.test(r), r);
  assert.strictEqual(require('../lib/bankroll-reports').ONLINE_ROOM, ONLINE_ROOM, 'the reports re-export the same regex');
});

// ── classification ──
test('a tournament: channel from is_online, game from game_variant', () => {
  assert.deepStrictEqual(classify.classifyTournament({ game_variant: 'PLO', is_online: 1 }, null),
    { format: 'PLO', channel: 'online', formatSource: 'derived', channelSource: 'derived' });
  assert.deepStrictEqual(classify.classifyTournament({ game_variant: "No-Limit Hold'em", is_online: 0 }, null),
    { format: 'NLH', channel: 'live', formatSource: 'derived', channelSource: 'derived' });
  assert.strictEqual(classify.classifyTournament({ game_variant: null, is_online: null }, null).format, 'other');
  assert.strictEqual(classify.classifyTournament(null, null).channel, 'live');
});

test('a cash session: channel from the room, game from the game', () => {
  assert.deepStrictEqual(classify.classifyCash({ game: 'PLO', room: 'ACR' }, null),
    { format: 'PLO', channel: 'online', formatSource: 'derived', channelSource: 'derived' });
  assert.deepStrictEqual(classify.classifyCash({ game: 'NLH', room: 'Parx' }, null),
    { format: 'NLH', channel: 'live', formatSource: 'derived', channelSource: 'derived' });
  assert.strictEqual(classify.classifyCash({ game: 'PLO8', room: null }, null).channel, 'live');
});

test('session_extras wins over derivation, field by field; an invalid value is ignored', () => {
  const t = { game_variant: 'PLO', is_online: 0 };
  assert.deepStrictEqual(classify.classifyTournament(t, { format: 'NLH', channel: 'online' }),
    { format: 'NLH', channel: 'online', formatSource: 'extras', channelSource: 'extras' });
  assert.deepStrictEqual(classify.classifyTournament(t, { format: 'NLH', channel: null }),
    { format: 'NLH', channel: 'live', formatSource: 'extras', channelSource: 'derived' });
  assert.deepStrictEqual(classify.classifyTournament(t, { format: 'Pot Limit Omaha', channel: 'both' }),
    { format: 'PLO', channel: 'live', formatSource: 'derived', channelSource: 'derived' });
  assert.deepStrictEqual(classify.classifyCash({ game: 'PLO', room: 'Parx' }, { format: 'PLO5', channel: 'online' }),
    { format: 'PLO5', channel: 'online', formatSource: 'extras', channelSource: 'extras' });
});

test('classifyResult reads the row and its session_extras, only for the owner', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE tournaments (id INTEGER PRIMARY KEY, game_variant TEXT, is_online INTEGER, venue TEXT, property TEXT, site TEXT)`);
  db.run(`CREATE TABLE tracking_entries (id INTEGER PRIMARY KEY, user_id INTEGER, tournament_id INTEGER)`);
  db.run(`CREATE TABLE cash_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, game TEXT, room TEXT, ended_at TEXT)`);
  // no session_extras yet: derivation only
  db.run(`INSERT INTO tournaments VALUES (1, 'PLO8', 0, 'Series A', 'Parx', NULL), (2, 'NLH', 1, 'Online Series', NULL, 'GGPoker')`);
  db.run(`INSERT INTO tracking_entries VALUES (10, 7, 1), (11, 7, 2), (12, 8, 1)`);
  db.run(`INSERT INTO cash_sessions VALUES (20, 7, 'PLO', 'Borgata Online', '2026-10-01T22:00:00Z'), (21, 7, 'NLH', 'Parx', NULL)`);
  const r10 = classify.classifyResult(db, 7, { table: 'tracking_entries', id: 10 });
  assert.deepStrictEqual([r10.kind, r10.format, r10.channel, r10.game, r10.room, r10.ended], ['tournament', 'PLO8', 'live', 'PLO8', 'Parx', true]);
  assert.deepStrictEqual([classify.classifyResult(db, 7, { table: 'tracking_entries', id: 11 }).channel, classify.classifyResult(db, 7, { table: 'tracking_entries', id: 11 }).room], ['online', 'GGPoker']);
  assert.strictEqual(classify.classifyResult(db, 7, { table: 'tracking_entries', id: 12 }), null, 'someone else\'s result');
  assert.strictEqual(classify.classifyResult(db, 7, { table: 'tracking_entries', id: 999 }), null);
  assert.strictEqual(classify.classifyResult(db, 7, { table: 'bankrolls', id: 1 }), null, 'only the two result tables');
  assert.strictEqual(classify.classifyResult(db, 7, { table: 'cash_sessions', id: 20 }).channel, 'online');
  assert.strictEqual(classify.classifyResult(db, 7, { table: 'cash_sessions', id: 21 }).ended, false, 'a live cash session says so');
  assert.strictEqual(classify.classifyResult(db, 8, { table: 'cash_sessions', id: 20 }), null);

  // with the real session_extras table
  for (const stmt of moneyMerge.TABLES.find((t) => t.name === 'session_extras').ddl) db.run(stmt);
  db.run(`INSERT INTO session_extras (user_id, ref_table, ref_id, format, channel, updated_at) VALUES (7, 'tracking_entries', 10, 'PLO6_8', 'online', 'x')`);
  db.run(`INSERT INTO session_extras (user_id, ref_table, ref_id, format, channel, updated_at) VALUES (8, 'cash_sessions', 20, 'razz', 'live', 'x')`); // another user's row for the same id
  const x = classify.classifyResult(db, 7, { table: 'tracking_entries', id: 10 });
  assert.deepStrictEqual([x.format, x.channel, x.formatSource, x.channelSource], ['PLO6_8', 'online', 'extras', 'extras']);
  assert.strictEqual(classify.classifyResult(db, 7, { table: 'cash_sessions', id: 20 }).format, 'PLO', 'another user\'s extras are never read');
  db.close();
});

test('stake formats and channels the editor may offer', () => {
  assert.deepStrictEqual(classify.STAKE_CHANNELS, ['any', 'live', 'online']);
  assert.strictEqual(classify.STAKE_FORMATS[0], 'all');
  assert.ok(classify.isFormat('PLO5') && !classify.isFormat('all') && !classify.isFormat('plo5'));
  assert.ok(classify.isChannel('live') && !classify.isChannel('any'));
  void path;
});
