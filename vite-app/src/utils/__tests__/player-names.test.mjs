import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, isDefaultName, nameBook, nameSuggestions, predictSeat, restOfTable, proIndex } from '../player-names.js';

const seat = (name) => ({ name, position: '', startingStack: 1000 });
const table = (...names) => names.map(seat);
// Saved hands, newest first, as /api/replayer/hands sends them.
const hands = [
  { players: table('Matt Vengrin', 'Chino Rheem', 'Dylan Linde', 'Brian Breck', 'A. Livingston') },
  { players: table('Chino Rheem', 'Dylan Linde', 'Opp 2', 'A. Livingston', 'Hero', 'Erik Seidel') },
  { players: table('Phil Ivey', 'Erik Seidel', 'Hero') },
  { players: table('José Ñúñez', 'Phil Ivey', 'Hero') },
];
const book = nameBook(hands);

test('default names are not names', () => {
  for (const n of ['', ' ', 'Hero', 'hero', 'You', 'Opp 1', 'Opp12', 'Opponent 3', 'Seat 4', 'Player 2', 'BTN', 'UTG+1', 'CO']) {
    assert.equal(isDefaultName(n), true, n);
  }
  for (const n of ['Chino Rheem', 'Opp', 'Bob', 'E. Bennett']) assert.equal(isDefaultName(n), n === 'Opp', n);
});

test('the book counts each name once a hand, keeps its newest spelling and when it was last seen', () => {
  assert.equal(book.names.get('chino rheem').count, 2);
  assert.equal(book.names.get('chino rheem').last, 0);
  assert.equal(book.names.get('phil ivey').count, 2);
  assert.equal(book.names.get('phil ivey').last, 2);
  assert.equal(book.names.has('hero'), false);
  assert.equal(book.names.has('opp 2'), false);
  assert.equal(nameKey('  José   Ñúñez '), 'jose nunez');
});

test("nothing typed: the newest hand's players in their seat order, then older ones; nobody already seated", () => {
  assert.deepEqual(nameSuggestions(book, { players: table('Opp 1', 'Opp 2', 'Opp 3'), seat: 0, limit: 7 }),
    ['Matt Vengrin', 'Chino Rheem', 'Dylan Linde', 'Brian Breck', 'A. Livingston', 'Erik Seidel', 'Phil Ivey']);
  assert.deepEqual(nameSuggestions(book, { players: table('Opp 1', 'Chino Rheem', 'Opp 3', 'Opp 4', 'Opp 5', 'Opp 6', 'Opp 7'), seat: 4, limit: 3 }),
    ['A. Livingston', 'Matt Vengrin', 'Dylan Linde']); // three seats after Chino Rheem leads
});

test('typed letters narrow by the whole name, a word, the initials, then anywhere; accents ignored', () => {
  const players = table('Opp 1', 'Opp 2', 'Opp 3');
  assert.deepEqual(nameSuggestions(book, { players, seat: 0, query: 'chi' }), ['Chino Rheem']);
  assert.deepEqual(nameSuggestions(book, { players, seat: 0, query: 'rhe' }), ['Chino Rheem']);
  assert.deepEqual(nameSuggestions(book, { players, seat: 0, query: 'pi' }), ['Phil Ivey']);
  assert.deepEqual(nameSuggestions(book, { players, seat: 0, query: 'nun' }), ['José Ñúñez']);
  assert.deepEqual(nameSuggestions(book, { players, seat: 0, query: 'eng' }), ['Matt Vengrin']);
  // The whole name ahead of a word of it.
  const b2 = nameBook([{ players: table('Ivan Lee', 'Lee Markholt') }]);
  assert.equal(nameSuggestions(book, { players: table('Opp 1'), seat: 0 }).length, 4); // four at most by default
  assert.deepEqual(nameSuggestions(b2, { players: table('Opp 1'), seat: 0, query: 'lee' }), ['Lee Markholt', 'Ivan Lee']);
});

test('a field that holds a name exactly offers nothing more for it; a default name counts as nothing typed', () => {
  const players = table('Chino Rheem', 'Opp 1');
  assert.deepEqual(nameSuggestions(book, { players, seat: 0, query: 'Chino Rheem' }), []);
  assert.ok(nameSuggestions(book, { players, seat: 1, query: 'Opp 1' }).length > 0);
});

test('the table order: the seat after a named one leads with who sat after them last time', () => {
  // Chino Rheem's newest hand (5 seats, the size now): Matt Vengrin, Chino Rheem, Dylan Linde, ...
  const players = table('Opp 1', 'Chino Rheem', 'Opp 2', 'Opp 3', 'Opp 4');
  assert.equal(predictSeat(book, players, 2), 'Dylan Linde');
  assert.equal(predictSeat(book, players, 3), 'Brian Breck');
  // Round the table: four seats after Chino Rheem is the one before him.
  assert.equal(predictSeat(book, players, 0), 'Matt Vengrin');
  // With nothing named before it, from the named seat after it.
  assert.equal(predictSeat(book, table('Opp 1', 'Dylan Linde', 'Opp 2'), 0), 'Chino Rheem');
  assert.equal(nameSuggestions(book, { players, seat: 2 })[0], 'Dylan Linde');
  // Typing overrides the prediction's lead.
  assert.equal(nameSuggestions(book, { players, seat: 2, query: 'b' })[0], 'Brian Breck');
});

test('the order prefers a hand with as many players as the table has now', () => {
  // Chino Rheem is in a 5-seat and a 6-seat hand; at six seats the 6-seat one decides.
  const players = table('Chino Rheem', 'Opp 1', 'Opp 2', 'Opp 3', 'Opp 4', 'Opp 5');
  assert.equal(predictSeat(book, players, 1), 'Dylan Linde');
  assert.equal(predictSeat(book, players, 2), null); // an unnamed seat in that hand says nothing
  assert.equal(predictSeat(book, players, 5), 'Erik Seidel');
});

test("restOfTable fills every unnamed seat in the named player's newest order", () => {
  const players = table('Matt Vengrin', 'Opp 1', 'Opp 2', 'Opp 3', 'A. Livingston');
  assert.deepEqual(restOfTable(book, players, 1), [
    { seat: 1, name: 'Chino Rheem' }, { seat: 2, name: 'Dylan Linde' }, { seat: 3, name: 'Brian Breck' },
  ]);
  // Nothing named before the seat, or a name with no hands: nothing to fill.
  assert.deepEqual(restOfTable(book, table('Opp 1', 'Opp 2', 'Opp 3'), 1), []);
  assert.deepEqual(restOfTable(book, table('Nobody Known', 'Opp 2', 'Opp 3'), 1), []);
});

test("restOfTable fills nothing where the table as entered is not that hand's, and never the hero's seat", () => {
  // Matt Vengrin after Chino Rheem: in their newest hand he sat before him.
  assert.deepEqual(restOfTable(book, table('Hero', 'Chino Rheem', 'Matt Vengrin', 'Opp 3', 'Opp 4'), 3, { hero: 0 }), []);
  // A named seat holding someone else.
  assert.deepEqual(restOfTable(book, table('Matt Vengrin', 'Opp 1', 'Opp 2', 'Opp 3', 'Bob'), 1), []);
  // The hero, still called Hero, keeps the seat; the rest fill round it.
  assert.deepEqual(restOfTable(book, table('Matt Vengrin', 'Opp 1', 'Hero', 'Opp 3', 'Opp 4'), 1, { hero: 2 }), [
    { seat: 1, name: 'Chino Rheem' }, { seat: 3, name: 'Brian Breck' }, { seat: 4, name: 'A. Livingston' },
  ]);
});

test('the pro list: searched from two letters, after your own names, by the whole name then a word, in its rank order', () => {
  const pros = proIndex(['Phil Hellmuth', 'Phil Ivey', 'Daniel Negreanu', 'Chino Rheem', 'Erik Seidel', 'Philippe Ktorza', 'Adam Philips']);
  const players = table('Opp 1', 'Opp 2');
  // Nothing typed, or one letter: your own names only.
  assert.deepEqual(nameSuggestions(book, { players, seat: 0, pros }), nameSuggestions(book, { players, seat: 0 }));
  assert.ok(!nameSuggestions(book, { players, seat: 0, query: 'd', pros }).includes('Daniel Negreanu'));
  // Your Phil Ivey first, then the pros' whole-name matches by rank, then a word of one.
  assert.deepEqual(nameSuggestions(book, { players, seat: 0, query: 'phil', pros }), ['Phil Ivey', 'Phil Hellmuth', 'Philippe Ktorza', 'Adam Philips']);
  // A pro you have played already comes once, as yours.
  assert.deepEqual(nameSuggestions(book, { players, seat: 0, query: 'chino', pros }), ['Chino Rheem']);
  // Nobody seated, and not the name the field holds.
  assert.deepEqual(nameSuggestions(book, { players: table('Daniel Negreanu', 'Opp 2'), seat: 1, query: 'neg', pros }), []);
  assert.deepEqual(nameSuggestions(book, { players, seat: 0, query: 'Erik Seidel', pros }), []);
  // Your names that match only by initials come after the pros.
  const b = nameBook([{ players: table('Paul Ingram') }]);
  assert.deepEqual(nameSuggestions(b, { players, seat: 0, query: 'pi', pros: proIndex(['Pia Jones', 'Phil Ivey']) }), ['Pia Jones', 'Paul Ingram']);
});

test('an empty or odd list makes an empty book', () => {
  for (const h of [null, undefined, [], [{}], [{ players: null }]]) {
    const b = nameBook(h);
    assert.deepEqual(nameSuggestions(b, { players: table('Opp 1'), seat: 0 }), []);
  }
});
