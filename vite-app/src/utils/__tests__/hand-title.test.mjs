// utils/hand-title.js (UX pick 69): a blank title is built from the hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoTitle, displayTitle } from '../hand-title.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test/hh-io/fixtures');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith(name))), 'utf8')).hand;

test('a 3-bet hold’em hand: cards, the shown hand, the pot type and the flop', () => {
  const t = autoTitle(fx('01-'));
  assert.match(t, /^A♠K♦ · v Q♥Q♣ · 3-bet pot( · .+)?$/, t);
});

test('a walk says so', () => {
  assert.match(autoTitle(fx('02-')), /Walk/);
});

test('stud names the 3rd-street cards and no pot type or flop', () => {
  const t = autoTitle(fx('24-'));
  assert.ok(t.length > 0);
  assert.doesNotMatch(t, /pot|Walk/);
});

test('every fixture gets a title or nothing, never a crash', () => {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const h = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).hand;
    assert.equal(typeof autoTitle(h), 'string', f);
  }
  assert.equal(autoTitle(null), '');
  assert.equal(autoTitle({ streets: [] }), '');
});

test('the list keeps a typed title and replaces the old "<game> Hand" default', () => {
  const h = fx('01-');
  assert.equal(displayTitle({ ...h, title: 'Big pot' }), 'Big pot');
  assert.equal(displayTitle({ ...h, title: 'NLH Hand' }), autoTitle(h));
  assert.equal(displayTitle({ ...h, title: '' }), autoTitle(h));
  assert.equal(displayTitle({ gameType: 'NLH', title: '', streets: [] }), 'Untitled');
});
