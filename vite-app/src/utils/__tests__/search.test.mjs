// The Schedule's forgiving search (utils/search.js; Laws of UX pick 16).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseText, searchTokens, matchesSearch } from '../search.js';

const venueInfo = (venue, property) => ({
  'Borgata Fall Poker Open': { abbr: 'BORG', longName: 'Borgata' },
  'Rock ‘n’ Roll Poker Open': { abbr: 'RNR', longName: 'Seminole Hard Rock' },
  'DTD Festival': { abbr: 'DTD', longName: 'Dusk Till Dawn' },
}[venue] || { abbr: '', longName: property || venue });

const ev = (o) => ({ event_name: '', event_number: '', game_variant: 'NLH', venue: '', property: null, buyin: 0, ...o });
const rows = [
  ev({ event_name: 'NLH Fall Half-A-Milly Almighty - Flight C', event_number: '7', venue: 'Borgata Fall Poker Open', buyin: 600 }),
  ev({ event_name: 'PLO 6-Max', event_number: '12', game_variant: 'PLO', venue: 'Rock ‘n’ Roll Poker Open', buyin: 1100 }),
  ev({ event_name: 'Omaha Hi-Lo 8 or Better', event_number: '600', game_variant: 'O8', venue: 'DTD Festival', buyin: 250 }),
  ev({ event_name: 'NLH Deepstack', event_number: '3', venue: 'Some Series', property: 'Café Casino', buyin: 1500 }),
];
const find = (q) => rows.filter((t) => matchesSearch(t, searchTokens(q), venueInfo)).map((t) => t.event_number);

test('normalised: case, accents, curly quotes, hyphens and spaces', () => {
  assert.equal(normaliseText('  Rock ‘n’ Roll  '), 'rock n roll');
  assert.equal(normaliseText('Half-A-Milly'), 'half a milly');
  assert.equal(normaliseText('Café'), 'cafe');
});

test('the room, the series and the strip are searched', () => {
  assert.deepEqual(find('borgata'), ['7']);
  assert.deepEqual(find('dusk till dawn'), ['600']);
  assert.deepEqual(find('cafe casino'), ['3']);
});

test('punctuation never decides: half a milly, rock n roll, spaces around', () => {
  assert.deepEqual(find('half a milly'), ['7']);
  assert.deepEqual(find("Rock 'n' Roll"), ['12']);
  assert.deepEqual(find('rock n roll'), ['12']);
  assert.deepEqual(find('  PLO '), ['12']);
});

test('every word must be found somewhere', () => {
  assert.deepEqual(find('nlh borgata'), ['7']);
  assert.deepEqual(find('plo borgata'), []);
});

test('shorthands: 6max, omaha, dtd', () => {
  assert.deepEqual(find('plo 6max'), ['12']);
  assert.deepEqual(find('omaha'), ['12', '600']);
  assert.deepEqual(find('dtd'), ['600']);
});

test('figures: $600 is a buy-in; a bare 600 is a buy-in or an event number; 1.5k', () => {
  assert.deepEqual(find('$600'), ['7']);
  assert.deepEqual(find('600'), ['7', '600']);
  assert.deepEqual(find('1.5k'), ['3']);
  assert.deepEqual(find('$1500'), ['3']);
});

test('an empty query matches everything', () => {
  assert.equal(find('').length, rows.length);
  assert.equal(find('   ').length, rows.length);
});
