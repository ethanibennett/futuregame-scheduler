// The solver's words stay off Study screens (App improvements 301).
import test from 'node:test';
import assert from 'node:assert/strict';
import { plainStudy, hasSolverWords } from '../study-words.js';

test('the draw study notes and trainer texts come out in a player’s words', () => {
  const notes = [
    'blueprint, not equilibrium — right for grading play against this bot, wrong to quote as GTO (measured gap up to 18.9 chips)',
    'measured at 0.4 chips; the blueprint POLICY cannot see them',
    'MONTE-CARLO FORWARD — LEVEL is SEPARATION',
    'Certified against the exact post-last-draw oracle',
    'Trainer offline (blueprint too large for this instance)',
    'Graded by the blueprint bot. 400 CFR+ iters',
    'Solving the subgame… range-form CFR+ over the razz tree.',
    'A 6-seat MCCFR solve of the pre-draw betting game',
    'no villain hand is consistent with that history',
  ];
  for (const n of notes) assert.equal(hasSolverWords(plainStudy(n)), false, plainStudy(n));
  assert.equal(plainStudy('Trainer offline (blueprint too large for this instance)'), 'Trainer offline');
  assert.equal(plainStudy('A 6-seat MCCFR solve'), 'A 6-seat solve');
});
