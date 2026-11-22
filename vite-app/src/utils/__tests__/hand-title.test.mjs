// utils/hand-title.js (UX pick 69): a blank title is built from the hand, as
// [game] | [pot type] | [MTT or Cash] | [stakes] (owner, 2026-11-22), with no cards or suits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoTitle, displayTitle, isBuiltTitle, potType } from '../hand-title.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test/hh-io/fixtures');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith(name))), 'utf8')).hand;
const stakes = (h) => (h.blinds && h.blinds.bb ? `${h.blinds.sb}/${h.blinds.bb}` : '');

test('a 3-bet hold’em hand: the game, 3BP, the format and the stakes, no cards', () => {
  const h = fx('01-');
  const t = autoTitle(h, { stakes });
  assert.equal(t, ['NLH', '3BP', h.gameMode === 'cash' ? 'Cash' : 'MTT', stakes(h)].filter(Boolean).join(' | '));
  assert.doesNotMatch(t, /[♠♥♦♣]/);
});

test('a walk says so', () => {
  assert.equal(potType(fx('02-')), 'Walk');
});

const hand = (gameType, actions, extra = {}) => ({
  gameType, gameMode: 'cash', blinds: { sb: 1, bb: 2 },
  players: [{ position: 'BTN' }, { position: 'SB' }, { position: 'BB' }],
  streets: [{ name: 'Preflop', actions }], ...extra,
});

test('the pot type counts raises, and an all-in only where it raises', () => {
  assert.equal(potType(hand('NLH', [{ player: 0, action: 'call', amount: 2 }, { player: 1, action: 'call', amount: 1 }, { player: 2, action: 'check' }])), 'Limped pot');
  assert.equal(potType(hand('NLH', [{ player: 0, action: 'raise', amount: 6 }, { player: 1, action: 'fold' }, { player: 2, action: 'call', amount: 4 }])), 'SRP');
  assert.equal(potType(hand('NLH', [{ player: 0, action: 'raise', amount: 6 }, { player: 1, action: 'raise', amount: 19 }, { player: 2, action: 'fold' }, { player: 0, action: 'call', amount: 14 }])), '3BP');
  assert.equal(potType(hand('NLH', [{ player: 0, action: 'raise', amount: 6 }, { player: 1, action: 'raise', amount: 19 }, { player: 2, action: 'fold' }, { player: 0, action: 'raise', amount: 44 }, { player: 1, action: 'call', amount: 30 }])), '4BP');
  // An all-in for less than the bet it faces is a call: still a single-raised pot.
  assert.equal(potType(hand('NLH', [{ player: 0, action: 'raise', amount: 10 }, { player: 1, action: 'all-in', amount: 4 }, { player: 2, action: 'fold' }])), 'SRP');
  // An all-in over the bet is a raise.
  assert.equal(potType(hand('NLH', [{ player: 0, action: 'raise', amount: 10 }, { player: 1, action: 'all-in', amount: 40 }, { player: 2, action: 'fold' }, { player: 0, action: 'call', amount: 31 }])), '3BP');
});

test('stud: the completion is the raise, the bring-in is not', () => {
  const s = (actions) => ({ gameType: 'Stud Hi', gameMode: 'mtt', blinds: { bb: 4 }, players: [{}, {}, {}], streets: [{ name: '3rd Street', actions }] });
  assert.equal(potType(s([{ player: 0, action: 'bring-in', amount: 1 }, { player: 1, action: 'call', amount: 1 }, { player: 2, action: 'fold' }])), 'Limped pot');
  assert.equal(potType(s([{ player: 0, action: 'bring-in', amount: 1 }, { player: 1, action: 'raise', amount: 4 }, { player: 2, action: 'fold' }, { player: 0, action: 'call', amount: 3 }])), 'SRP');
});

test('a draw game: the pre-draw street decides, MTT when the hand is not cash', () => {
  const t = autoTitle({ ...hand('2-7 TD', [{ player: 0, action: 'bet', amount: 4 }, { player: 1, action: 'fold' }, { player: 2, action: 'call', amount: 2 }]), gameMode: 'mtt' }, { stakes: () => '3,000/6,000' });
  assert.equal(t, '2-7 TD | SRP | MTT | 3,000/6,000');
});

test('every fixture gets a title or nothing, never a crash, and never a suit', () => {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const h = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).hand;
    const t = autoTitle(h, { stakes });
    assert.equal(typeof t, 'string', f);
    assert.doesNotMatch(t, /[♠♥♦♣]/, f);
    if (t) assert.ok(isBuiltTitle(t), `${f}: ${t}`);
  }
  assert.equal(autoTitle(null), '');
  assert.equal(autoTitle({ streets: [] }), '');
});

test('the list keeps a typed title and rebuilds the old defaults and every built title', () => {
  const h = fx('01-');
  const built = autoTitle(h, { stakes });
  assert.equal(displayTitle({ ...h, title: 'Big pot' }, { stakes }), 'Big pot');
  assert.equal(displayTitle({ ...h, title: 'PLO $2/2/5 - QQJ4ss vs AA' }, { stakes }), 'PLO $2/2/5 - QQJ4ss vs AA');
  assert.equal(displayTitle({ ...h, title: 'NLH Hand' }, { stakes }), built);
  assert.equal(displayTitle({ ...h, title: '' }, { stakes }), built);
  // The title saved before 2026-11-22, cards and suits, is the app's: rebuilt.
  assert.equal(displayTitle({ ...h, title: 'A♠K♦ · v Q♥Q♣ · 3-bet pot · K♠7♦2♣' }, { stakes }), built);
  assert.equal(displayTitle({ ...h, title: '6♦5♣4♠2♠6♣ · v 8♥7♦4♣3♠2♥' }, { stakes }), built);
  // A built title saved before an edit is rebuilt from the hand as it is now.
  assert.equal(displayTitle({ ...h, title: 'NLH | SRP | Cash | 1/2' }, { stakes }), built);
  assert.equal(displayTitle({ gameType: 'NLH', title: '', streets: [] }), 'Untitled');
});

test('isBuiltTitle tells the app’s titles from typed ones', () => {
  for (const t of ['2-7 TD | SRP | Cash | $40/$80', 'Badugi | Limped pot | MTT | 3,000/6,000', 'NLH | MTT', 'A♠K♦ · Raised pot', '6♥5♦3♣2♠ · v 6♠4♣3♦2♥']) assert.ok(isBuiltTitle(t), t);
  for (const t of ['', 'Big pot', 'AA vs KK', 'PLO $2/2/5 - QQJ4ss vs AA', 'A♠K♦ in the big blind', 'Me | you']) assert.ok(!isBuiltTitle(t), t);
});
