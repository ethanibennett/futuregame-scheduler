// utils/study-tags.js (UX pick 72): each Study row's games, less what the server cannot offer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const { studyTags } = await import('../study-tags.js');

test('each tool names its own games', () => {
  assert.deepEqual(studyTags('solve', null).map((t) => t.label), ['Razz', 'Stud 8']);
  assert.deepEqual(studyTags('draw', null).map((t) => t.label), ['2-7 TD', 'A-5 TD', 'Badugi']);
  assert.deepEqual(studyTags('ranges', {}).map((t) => t.label), ['2-7 TD']);
  assert.deepEqual(studyTags('spots', null), [], 'trained games are listed by the tool itself');
});

test('a game whose blueprint is not on this server is left off', () => {
  const avail = { a5td: false, stud8: false, razz3: false };
  assert.deepEqual(studyTags('draw', avail).map((t) => t.id), ['td27', 'badugi']);
  assert.deepEqual(studyTags('solve', avail).map((t) => t.id), ['razz']);
  assert.deepEqual(studyTags('three-way', avail), []);
  assert.ok(!studyTags('play', avail).some((t) => t.id === 'a5td' || t.id === 'stud8'));
});
