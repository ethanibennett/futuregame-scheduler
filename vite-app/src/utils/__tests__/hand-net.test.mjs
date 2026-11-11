// utils/hand-net.js (UX pick 55): the saved list's net per hand, from the export's own settlement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seatNets, heroNet } from '../hand-net.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test/hh-io/fixtures');
const fixtures = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]);

test('every fixture that settles conserves chips: the nets add up to nothing', () => {
  let settled = 0;
  for (const [name, fx] of fixtures) {
    const nets = seatNets(fx.hand);
    if (!nets) continue;
    settled++;
    const sum = nets.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum) < 1e-9, `${name}: the nets add up to ${sum}`);
  }
  assert.ok(settled >= 8, `only ${settled} fixtures settled`);
});

test('the 3-bet cash hand: Ethan, on $250, ends on $350 (+$100)', () => {
  const fx = fixtures.find(([n]) => n.startsWith('01-'))[1];
  assert.equal(heroNet(fx.hand), 100);
});

test('a row from the list (hand_data spread) reads as the hand does', () => {
  const fx = fixtures.find(([n]) => n.startsWith('01-'))[1];
  assert.equal(heroNet({ id: 7, title: 'x', ...fx.hand }), 100);
});

test('a hand that cannot be settled has no figure', () => {
  assert.equal(heroNet({ gameType: 'NLH', players: [], streets: [] }), null);
  assert.equal(heroNet(null), null);
});
