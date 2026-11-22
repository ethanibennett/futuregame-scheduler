// The play-money dealer's hand (utils/poker-rules/live-hand.js): dealing, turns, refusals, the run-out,
// the showdown's auto-muck, and that no seat's view or saved hand ever holds a card that seat did not see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHand, act, viewFor, savedHandFor, timeoutMove, currentState, toAct, maxSeatsFor } from '../poker-rules/live-hand.js';
import { settleHand } from '../poker-rules/settle.js';

const RANKS = '23456789TJQKA', SUITS = 'hdcs';
const FULL = [...RANKS].flatMap((r) => [...SUITS].map((s) => r + s));
/* A deck whose first cards are `top`, the rest in order. */
const deckWith = (...top) => [...top, ...FULL.filter((c) => !top.includes(c))];

const HU = [{ id: 11, name: 'Ava', stack: 1000 }, { id: 22, name: 'Bo', stack: 1000 }];
const BL = { sb: 5, bb: 10, ante: 0 };

/* Every card in a view: from string values made only of cards (a back is 'Ax'), so a key such as "toAct" is not
   read as the ace of clubs. */
const cardsIn = (obj) => {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') { if (/^(?:[2-9TJQKA][hdcsx])+$/.test(v)) out.push(...(v.match(/[2-9TJQKA][hdcs]/g) || [])); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(obj);
  return out;
};

test('heads-up NLH to a showdown: turns, settlement, auto-muck', () => {
  // Ava (BTN/SB) AhAd, Bo (BB) KcKs; board 2c 7d 9h | 3s | 4d: aces hold.
  const s = startHand({ gameType: 'NLH', blinds: BL, seats: HU, deck: deckWith('Ah', 'Ad', 'Kc', 'Ks', '2c', '7d', '9h', '3s', '4d') });
  assert.equal(s.players[0].position, 'BTN/SB');
  assert.equal(currentState(s).actor, 0, 'the button acts first before the flop heads-up');
  assert.deepEqual(act(s, 1, { action: 'call' }).error, 'Not your turn');
  assert.ok(act(s, 0, { action: 'raise', to: 30 }).ok);
  assert.ok(act(s, 1, { action: 'call' }).ok);
  assert.equal(s.si, 1);
  assert.equal(currentState(s).actor, 1, 'the big blind acts first after the flop');
  act(s, 1, { action: 'check' }); act(s, 0, { action: 'check' });
  act(s, 1, { action: 'bet', to: 50 }); act(s, 0, { action: 'call' });
  act(s, 1, { action: 'check' });
  assert.ok(act(s, 0, { action: 'check' }).ok);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result.finals, [1080, 920]);
  assert.deepEqual(s.result.shown, [0], 'the winner shows, the loser mucks');
  // Bo's saved hand shows Ava's aces (shown); Ava's never shows Bo's kings (mucked).
  assert.equal(savedHandFor(s, 1).streets[0].cards.opponents[0], 'AhAd');
  assert.equal(savedHandFor(s, 0).streets[0].cards.opponents[0], 'MUCK', 'marked mucked, as the replayer marks one');
  assert.ok(!cardsIn(savedHandFor(s, 0)).includes('Kc'));
});

test('no view carries an unseen card at any step', () => {
  const s = startHand({ gameType: 'NLH', blinds: BL, seats: HU, deck: deckWith('Ah', 'Ad', 'Kc', 'Ks', '2c', '7d', '9h', '3s', '4d') });
  const check = () => {
    const v0 = cardsIn(viewFor(s, 0)), v1 = cardsIn(viewFor(s, 1));
    assert.ok(!v0.includes('Kc') && !v0.includes('Ks'), 'seat 0 never sees seat 1 before a show');
    if (s.phase !== 'over') assert.ok(!v1.includes('Ah') && !v1.includes('Ad'));
    const dealtBoard = s.board.slice(0, s.si + 1).flat();
    for (const c of s.board.flat()) if (!dealtBoard.includes(c)) assert.ok(!v0.includes(c) && !v1.includes(c), `undealt ${c} in a view`);
  };
  check();
  for (const [p, m] of [[0, { action: 'call' }], [1, { action: 'check' }], [1, { action: 'check' }], [0, { action: 'check' }], [1, { action: 'check' }], [0, { action: 'check' }], [1, { action: 'check' }], [0, { action: 'check' }]]) {
    assert.ok(act(s, p, m).ok, JSON.stringify([p, m]));
    check();
  }
  assert.equal(s.phase, 'over');
});

test('all in before the flop: the board runs out and both hands are tabled', () => {
  const s = startHand({ gameType: 'NLH', blinds: BL, seats: HU, deck: deckWith('Ah', 'Ad', 'Kc', 'Ks', '2c', '7d', 'Kh', '3s', '4d') });
  act(s, 0, { action: 'raise', to: 1000 });
  act(s, 1, { action: 'call' });
  assert.equal(s.phase, 'over');
  assert.equal(s.runOut, true);
  assert.deepEqual(s.result.shown, [0, 1]);
  assert.deepEqual(s.result.finals, [0, 2000], 'the kings hit a set');
  assert.equal(savedHandFor(s, 0).streets[3].cards.board, '4d');
});

test('a fold: no showdown, nobody shown, the blinds go to the raiser', () => {
  const s = startHand({ gameType: 'NLH', blinds: BL, seats: HU, deck: deckWith('Ah', 'Ad', 'Kc', 'Ks') });
  act(s, 0, { action: 'raise', to: 30 });
  act(s, 1, { action: 'fold' });
  assert.deepEqual(s.result.finals, [1010, 990]);
  assert.deepEqual(s.result.shown, []);
  assert.ok(!cardsIn(savedHandFor(s, 1)).includes('Ah'));
});

test('refusals: out of range, stale seq, a check facing a bet', () => {
  const s = startHand({ gameType: 'NLH', blinds: BL, seats: HU, deck: FULL.slice() });
  const r = act(s, 0, { action: 'raise', to: 15 });
  assert.match(r.error, /From 20 to 1000/);
  assert.equal(act(s, 0, { action: 'check' }).error, 'There is a bet to call');
  assert.equal(act(s, 0, { action: 'call', seq: s.seq + 1 }).stale, true);
  assert.ok(act(s, 0, { action: 'call', seq: s.seq }).ok);
  assert.deepEqual(timeoutMove(s), { action: 'check' }, 'the big blind times out into a check');
});

test('three-handed: positions and the first to act', () => {
  const seats = [{ id: 1, name: 'A', stack: 500 }, { id: 2, name: 'B', stack: 500 }, { id: 3, name: 'C', stack: 500 }];
  const s = startHand({ gameType: 'NLH', blinds: BL, seats, deck: FULL.slice() });
  assert.deepEqual(s.players.map((p) => p.position), ['BTN', 'SB', 'BB']);
  assert.equal(currentState(s).actor, 0);
  act(s, 0, { action: 'fold' }); act(s, 1, { action: 'call' }); act(s, 2, { action: 'check' });
  assert.equal(currentState(s).actor, 1, 'the small blind acts first after the flop');
});

test('PLO deals four each and pot-limits the raise', () => {
  const s = startHand({ gameType: 'PLO', blinds: BL, seats: HU, deck: FULL.slice() });
  assert.equal(s.holes[0].length, 4);
  const L = currentState(s).legal;
  assert.equal(L.maxTo, 30, 'the button may raise to three big blinds heads-up');
});

// ── Stud and the draw games (decision 10: board, then stud, then draw) ──
const STUD_BL = { sb: 0, bb: 20, bigBet: 40, ante: 5, bringIn: 10 };
const LIMIT_BL = { sb: 10, bb: 20, bigBet: 40, ante: 0 };

test('stud: two down and one up, the low door brings it in, 7th street dealt down and never shown to the others', () => {
  // Seat order Ava, Bo, Cy: Ava's door Kd, Bo's 2c (brings in), Cy's 9h.
  const deck = deckWith('Ah', 'As', 'Kd', '3h', '3d', '2c', '8h', '8d', '9h');
  const s = startHand({ gameType: 'Stud Hi', blinds: STUD_BL, seats: [{ id: 1, name: 'Ava', stack: 1000 }, { id: 2, name: 'Bo', stack: 1000 }, { id: 3, name: 'Cy', stack: 1000 }], deck });
  assert.deepEqual(s.players.map((p) => p.position), ['Seat 1', 'Seat 2', 'Seat 3']);
  const t = toAct(s);
  assert.equal(t.player, 1, 'the lowest door card brings it in');
  assert.equal(t.legal.bringIn, 10);
  // Bo sees his own three, and only the others' doors.
  assert.equal(viewFor(s, 1).hand.streets[0].cards.hero, '3h3d2c');
  assert.deepEqual(cardsIn(viewFor(s, 1)).sort(), ['3h', '3d', '2c', 'Kd', '9h'].sort());
  // Everyone calls along to 7th street: each has seven cards; nobody sees another's 7th.
  for (let k = 0; k < 40 && s.phase !== 'over'; k++) {
    const a = toAct(s);
    const L = a.legal;
    assert.ok(act(s, a.player, L.bringIn ? { action: 'bring-in' } : L.canCheck ? { action: 'check' } : { action: 'call' }).ok);
    if (s.si === 4 && s.phase !== 'over') {
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) if (p !== q) assert.ok(!cardsIn(viewFor(s, p)).includes(s.holes[q][6]), `seat ${p} sees seat ${q}'s 7th`);
    }
  }
  assert.equal(s.phase, 'over');
  assert.ok(s.holes.every((h) => h.length === 7));
  assert.equal(s.result.finals.reduce((a, b) => a + b, 0), 3000);
});

test('triple draw: each draws in turn after the betting, the hero sees his own new cards and only counts of the others', () => {
  const s = startHand({ gameType: '2-7 TD', blinds: LIMIT_BL, seats: HU, deck: FULL.slice() });
  act(s, 0, { action: 'call' });
  act(s, 1, { action: 'check' });
  assert.equal(s.phase, 'drawing');
  assert.deepEqual(toAct(s), { player: 1, kind: 'draw', max: 5 }, 'the big blind draws first heads-up');
  assert.deepEqual(timeoutMove(s), { action: 'draw', discard: [] }, 'a draw timed out stands pat');
  assert.equal(act(s, 0, { action: 'draw', discard: [] }).error, 'It is not your draw');
  assert.equal(act(s, 1, { action: 'check' }).error, 'Draw or stand pat');
  assert.equal(act(s, 1, { action: 'draw', discard: ['Ah'] }).error, 'Throw cards from your hand');
  const thrown = s.holes[1].slice(0, 2);
  assert.ok(act(s, 1, { action: 'draw', discard: thrown }).ok);
  const got = s.holes[1].slice(-2);
  assert.ok(act(s, 0, { action: 'draw', discard: [] }).ok);
  assert.equal(s.phase, 'betting');
  assert.equal(s.si, 1);
  const mine = viewFor(s, 1).hand.streets[0].draws.find((d) => d.player === 1);
  assert.equal(mine.newCards, got.join(''));
  const theirs = viewFor(s, 0).hand.streets[0].draws.find((d) => d.player === 1);
  assert.deepEqual(theirs, { player: 1, discarded: 2, discardedCards: '', newCards: '' });
  for (const c of [...thrown, ...got]) assert.ok(!cardsIn(viewFor(s, 0)).includes(c));
});

test('a draw game reshuffles the discards when the stub runs out, never the drawer\'s own discards of that draw', () => {
  const seats = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: 'P' + id, stack: 10000 }));
  const s = startHand({ gameType: '2-7 TD', blinds: LIMIT_BL, seats, deck: FULL.slice() });
  let reshuffled = 0;
  const reshuffle = (cards) => { reshuffled++; return cards.slice().reverse(); };
  for (let k = 0; k < 200 && s.phase !== 'over'; k++) {
    const t = toAct(s);
    if (t.kind === 'draw') {
      const thrown = s.holes[t.player].slice();
      assert.ok(act(s, t.player, { action: 'draw', discard: thrown }, { reshuffle }).ok);
      assert.ok(s.holes[t.player].every((c) => !thrown.includes(c)), 'a drawer is never dealt back what they just threw');
    } else assert.ok(act(s, t.player, t.legal.canCheck ? { action: 'check' } : { action: 'call' }).ok);
    // No card is in two hands, or in a hand and the stub.
    const held = s.holes.flat().concat(s.stub);
    assert.equal(new Set(held).size, held.length);
  }
  assert.equal(s.phase, 'over');
  assert.ok(reshuffled >= 1 && s.reshuffles >= 1, 'six players drawing five three times run the stub out');
  assert.equal(s.result.finals.reduce((a, b) => a + b, 0), 60000);
});

test('seat limits: stud seven, the draw games six', () => {
  assert.equal(maxSeatsFor('Razz'), 7);
  assert.equal(maxSeatsFor('Badugi'), 6);
  assert.equal(maxSeatsFor('NLH'), 10);
  const eight = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, name: 'P' + id, stack: 100 }));
  assert.throws(() => startHand({ gameType: 'Stud Hi', blinds: STUD_BL, seats: eight, deck: FULL.slice() }), /2 to 7/);
});

/* A small seeded PRNG, so a failure names its seed. */
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function shuffled(r) { const d = FULL.slice(); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; }

/* What seat p may know at this moment: every card it was ever dealt, every up card and board card dealt, and at
   the end the cards of the hands shown. */
function allowed(s, p) {
  const ok = new Set([...s.start[p], ...s.holes[p]]);
  for (const st of s.streets) for (const d of st.draws) if (d.player === p) for (const c of (d.newCards.match(/../g) || [])) ok.add(c);
  if (s.kind === 'stud') for (const h of s.holes) for (const c of h.slice(2, 6)) ok.add(c);
  if (s.kind === 'board') for (const c of s.board.slice(0, s.si + 1).flat()) ok.add(c);
  if (s.result) for (const q of s.result.shown) for (const c of s.holes[q]) ok.add(c);
  return ok;
}

test('random hands of every stud and draw game: no view ever holds an unseen card, every hand ends, chips are kept', () => {
  const games = { 'Stud Hi': STUD_BL, 'Stud 8': STUD_BL, Razz: STUD_BL, '2-7 TD': LIMIT_BL, 'PL 2-7 TD': BL, Badugi: LIMIT_BL, 'NL 2-7 SD': BL, 'PL 5CD Hi': BL };
  for (const [game, blinds] of Object.entries(games)) {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed * 7919 + game.length);
      const n = 2 + Math.floor(r() * (maxSeatsFor(game) - 1));
      const seats = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'P' + i, stack: 50 + Math.floor(r() * 400) }));
      const s = startHand({ gameType: game, blinds, seats, deck: shuffled(r) });
      const total = seats.reduce((a, x) => a + x.stack, 0);
      for (let k = 0; k < 400 && s.phase !== 'over'; k++) {
        const t = toAct(s);
        assert.ok(t, `${game} seed ${seed}: stuck with nobody to act`);
        let move;
        if (t.kind === 'draw') move = { action: 'draw', discard: s.holes[t.player].filter(() => r() < 0.4) };
        else {
          const L = t.legal, x = r();
          if (L.bringIn) move = x < 0.6 || !L.canRaise ? { action: 'bring-in' } : { action: 'complete', to: L.minTo };
          else if (L.canRaise && x < 0.25) move = { action: L.raiseWord === 'Bet' ? 'bet' : L.raiseWord === 'Complete' ? 'complete' : 'raise', to: L.fixedTo != null ? L.fixedTo : L.minTo + Math.floor(r() * (L.maxTo - L.minTo + 1)) };
          else if (L.canFold && x > 0.85) move = { action: 'fold' };
          else move = { action: L.canCheck ? 'check' : 'call' };
        }
        const res = act(s, t.player, move, { reshuffle: (c) => c.slice().sort(() => r() - 0.5) });
        assert.ok(res.ok, `${game} seed ${seed}: ${JSON.stringify(move)} refused: ${res.error}; offered ${JSON.stringify(t.legal)}; street ${s.si}, ${JSON.stringify(s.streets[s.si].actions)}`);
        for (let p = 0; p < n; p++) {
          const ok = allowed(s, p);
          for (const c of cardsIn(viewFor(s, p))) assert.ok(ok.has(c), `${game} seed ${seed}: seat ${p} sees ${c}`);
        }
      }
      assert.equal(s.phase, 'over', `${game} seed ${seed}: did not end`);
      assert.ok(Math.abs(s.result.finals.reduce((a, b) => a + b, 0) - total) < 1e-6, `${game} seed ${seed}: chips`);
      for (let p = 0; p < n; p++) {
        const ok = allowed(s, p);
        const saved = savedHandFor(s, p);
        for (const c of cardsIn(saved)) assert.ok(ok.has(c), `${game} seed ${seed}: seat ${p} keeps ${c}`);
        // What Hands keeps settles, through the export's arithmetic, to what the table paid.
        let finals;
        try { finals = settleHand(saved).finals; } catch (e) { assert.fail(`${game} seed ${seed}: seat ${p}'s saved hand does not settle: ${e.message}`); }
        finals.forEach((f, q) => assert.ok(Math.abs(f - s.result.finals[q]) < 1e-6, `${game} seed ${seed}: seat ${p}'s saved hand pays seat ${q} ${f}, the table ${s.result.finals[q]}`));
      }
    }
  }
});

// ── Posting to come in at once (owner, 2026-11-22: "Build the post to come in now too") ──
// A seat that did not wait for the big blind posts one from where it sits: a live blind, its bet on the first street.
// It acts in its own turn, and with no raise it has the option. Nobody's order changes.
const SIX = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({ id: i + 1, name, stack: 1000 }));

test('a post: the poster acts in turn, checks its option when nobody raised, and the pot counts the post', () => {
  // Six-handed [UTG, MP, CO, BTN, SB, BB]; MP (seat 1) posts 10.
  const seats = SIX.map((x, i) => (i === 1 ? { ...x, post: 10 } : x));
  const s = startHand({ gameType: 'NLH', blinds: BL, seats, deck: FULL.slice() });
  assert.equal(s.players[1].post, 10);
  assert.equal(currentState(s).pot, 25, 'the blinds and the post');
  assert.equal(currentState(s).actor, 0, 'UTG still acts first');
  act(s, 0, { action: 'call' });
  const t = toAct(s);
  assert.equal(t.player, 1);
  assert.equal(t.legal.canCheck, true, 'in for the big blind already: the option');
  assert.equal(t.legal.canFold, false);
  assert.equal(t.legal.minTo, 20, 'a raise is to the same sizes as anyone');
  act(s, 1, { action: 'check' });
  for (const p of [2, 3]) act(s, p, { action: 'fold' });
  act(s, 4, { action: 'call' });
  act(s, 5, { action: 'check' });
  assert.equal(s.si, 1, 'the flop: everyone in for 10');
  assert.equal(currentState(s).pot, 40);
});

test('a post facing a raise: the call is the raise less the post; folded, the post stays in the pot', () => {
  const seats = SIX.map((x, i) => (i === 2 ? { ...x, post: 10 } : x));
  const s = startHand({ gameType: 'NLH', blinds: BL, seats, deck: FULL.slice() });
  act(s, 0, { action: 'raise', to: 40 });
  act(s, 1, { action: 'fold' });
  assert.equal(toAct(s).legal.call, 30, 'CO, in for 10, calls 30 more');
  act(s, 2, { action: 'fold' });
  for (const p of [3, 4, 5]) act(s, p, { action: 'fold' });
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result.finals, [1000 + 5 + 10 + 10, 1000, 990, 1000, 995, 990], 'UTG wins the blinds and the post');
});

test('a post is written as PokerStars writes a new player\'s, and the saved hand settles through the export', async () => {
  const { writePokerStarsHand } = await import('../hand-history/index.js');
  const seats = SIX.map((x, i) => (i === 0 ? { ...x, post: 10 } : x));
  const s = startHand({ gameType: 'NLH', blinds: BL, seats, deck: FULL.slice() });
  act(s, 0, { action: 'raise', to: 30 });
  for (const p of [1, 2, 3, 4]) act(s, p, { action: 'fold' });
  act(s, 5, { action: 'call' });
  while (s.phase !== 'over') { const t = toAct(s); act(s, t.player, { action: t.legal.canCheck ? 'check' : 'call' }); }
  const saved = savedHandFor(s, 0);
  const { text } = writePokerStarsHand(saved, { heroName: 'A', playedAt: new Date('2026-11-22T20:00:00Z') });
  const posts = text.split('\n').filter((l) => /posts (small|big) blind/.test(l));
  assert.deepEqual(posts.map((l) => l.replace(/\r$/, '')), ['E: posts small blind 5', 'F: posts big blind 10', 'A: posts big blind 10']);
  settleHand(saved).finals.forEach((f, q) => assert.equal(f, s.result.finals[q]));
});

/* The same hand without the post, the poster putting the chips in with its first action instead: a check on its
   option is a call of the big blind, a call or a raise is to the same total. Every chip is the same at the end, and
   that hand settles by the export PokerKit holds (check-export.mjs); every other seat is offered the same. */
test('random hands with posts settle as the same hands without them, the posts paid as calls', () => {
  const games = { NLH: BL, PLO: BL, LHE: LIMIT_BL };
  let played = 0;
  for (const [game, blinds] of Object.entries(games)) {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed * 104729 + game.length);
      const n = 4 + Math.floor(r() * 6);  // 4 to 9: a post is never from the blinds' or the button's seat
      const posters = new Set(Array.from({ length: n - 3 }, (_, i) => i).filter(() => r() < 0.4));
      if (!posters.size) posters.add(Math.floor(r() * (n - 3)));
      const base = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'P' + i, stack: 60 + Math.floor(r() * 400) }));
      const deck = shuffled(r);
      const s = startHand({ gameType: game, blinds, seats: base.map((x, i) => (posters.has(i) ? { ...x, post: blinds.bb } : x)), deck: deck.slice() });
      const plain = startHand({ gameType: game, blinds, seats: base, deck: deck.slice() });
      const total = base.reduce((a, x) => a + x.stack, 0);
      const firstDone = new Set();
      let skip = false;
      for (let k = 0; k < 400 && s.phase !== 'over' && !skip; k++) {
        const t = toAct(s), u = toAct(plain);
        assert.ok(t && u && t.player === u.player, `${game} seed ${seed}: the turn differs (${t && t.player} / ${u && u.player})`);
        const L = t.legal, x = r();
        const poster = posters.has(t.player) && s.si === 0 && !firstDone.has(t.player);
        if (!poster && game !== 'PLO') {
          for (const key of ['canFold', 'canCheck', 'call', 'canRaise', 'minTo', 'maxTo', 'fixedTo']) assert.equal(L[key], u.legal[key], `${game} seed ${seed}: ${key} for seat ${t.player}`);
        }
        let move;
        if (L.canRaise && x < 0.3) move = { action: L.raiseWord === 'Bet' ? 'bet' : 'raise', to: L.fixedTo != null ? L.fixedTo : L.minTo + Math.floor(r() * (L.maxTo - L.minTo + 1)) };
        else if (L.canFold && x > 0.8) move = { action: 'fold' };
        else move = { action: L.canCheck ? 'check' : 'call' };
        if (poster && move.action === 'fold') { skip = true; break; }  // a post folded is dead money: no hand without it
        // The hand without the post: the poster's check on its option is a call of the big blind.
        const mirror = poster && move.action === 'check' ? { action: 'call' } : move;
        if (poster) firstDone.add(t.player);
        const a = act(s, t.player, move), b = act(plain, u.player, mirror);
        assert.ok(a.ok, `${game} seed ${seed}: ${JSON.stringify(move)} refused: ${a.error}`);
        if (!b.ok) { skip = true; break; }  // pot limit before the poster acts: the post is in the pot, so a bigger raise
      }
      if (skip) continue;
      played++;
      assert.equal(s.phase, 'over', `${game} seed ${seed}: did not end`);
      assert.equal(plain.phase, 'over');
      assert.ok(Math.abs(s.result.finals.reduce((a, b) => a + b, 0) - total) < 1e-6, `${game} seed ${seed}: chips`);
      s.result.finals.forEach((f, q) => assert.ok(Math.abs(f - plain.result.finals[q]) < 1e-6, `${game} seed ${seed}: seat ${q} ends on ${f}, without the post ${plain.result.finals[q]}`));
      for (let p = 0; p < n; p++) settleHand(savedHandFor(s, p)).finals.forEach((f, q) => assert.ok(Math.abs(f - s.result.finals[q]) < 1e-6, `${game} seed ${seed}: seat ${p}'s saved hand`));
    }
  }
  assert.ok(played >= 120, `only ${played} hands played through`);
});
