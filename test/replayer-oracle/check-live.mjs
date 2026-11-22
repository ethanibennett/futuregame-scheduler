// The play-money dealer (vite-app/src/utils/poker-rules/live-hand.js) against PokerKit, in plain Node.
//
// Every corpus hand of the games the tables deal is dealt again by the live dealer from a deck built to give
// each seat the cards PokerKit dealt it (a card the corpus does not show, a folded hand or a mucked one, is
// any card nobody else holds). The corpus's moves are played through it: the bets as PokerKit made them, and in
// a draw game each draw (the hero's as recorded; an opponent's worked back from the hand they showed and how
// many they drew). The dealer must name the same player to act at every step, take every move, deal stud's
// cards and the draws where they belong, and leave every seat on PokerKit's final stack.
//
// Left out, and counted: hands where the TDA and PokerKit part on purpose (check-rules.mjs, the same list),
// where PokerKit reshuffled its discards (the deck cannot be laid out in advance), and hands with a straddle.
//
//   node test/replayer-oracle/check-live.mjs [--games "Stud Hi,2-7 TD"] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { model, GAMES } from './model.mjs';
import { startHand, act, toAct, currentState, canDeal, gameKind } from '../../vite-app/src/utils/poker-rules/live-hand.js';
import { gameConfig } from '../../vite-app/src/utils/quick-add/game.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : ''; };
const ONLY = (opt('--games') || '').split(',').map((s) => s.trim()).filter(Boolean);
const VERBOSE = args.includes('--verbose');
const FULL = [...'23456789TJQKA'].flatMap((r) => [...'hdcs'].map((s) => r + s));
const cardsOf = (s) => (String(s || '').match(/[2-9TJQKA][hdcs]/g) || []);

const recs = fs.readFileSync(path.join(ROOT, 'test', 'replayer-oracle', 'corpus.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => GAMES[r.game] && canDeal(r.game) && (!ONLY.length || ONLY.includes(r.game)))
  .filter((r) => !(r.hand.blinds && r.hand.blinds.straddle));

class Skip extends Error {}

/* The deck that deals this hand: each seat's cards in the order the live dealer deals them. */
function layDeck(h, kind) {
  const n = h.players.length;
  const hero = h.heroIdx != null ? h.heroIdx : 0;
  const slot = (p) => (p > hero ? p - 1 : p);
  const opp = (p, si) => (((h.streets[si] || {}).cards || {}).opponents || [])[slot(p)] || '';
  const mine = (si) => (((h.streets[si] || {}).cards || {}).hero) || '';
  const known = new Set();
  for (const st of h.streets) {
    const c = st.cards || {};
    for (const s of [c.hero, c.board, ...(c.opponents || [])]) for (const x of cardsOf(s)) known.add(x);
    for (const d of st.draws || []) for (const x of [...cardsOf(d.discardedCards), ...cardsOf(d.newCards)]) known.add(x);
  }
  const spare = FULL.filter((c) => !known.has(c));
  const filler = () => { if (!spare.length) throw new Skip('more cards than one deck (PokerKit reshuffled its discards)'); return spare.shift(); };
  const fill = (list, k) => { const out = list.slice(0, k); while (out.length < k) out.push(filler()); return out; };
  const cfg = gameConfig(h.gameType);
  const deck = [];
  const plan = { draws: [] };     // per street: [{ player, discard }]

  if (kind === 'board') {
    for (let p = 0; p < n; p++) deck.push(...fill(cardsOf(p === hero ? mine(0) : opp(p, 0)), cfg.heroCards));
    const per = [0, 3, 1, 1];
    for (let si = 1; si < 4; si++) deck.push(...fill(cardsOf(((h.streets[si] || {}).cards || {}).board), per[si]));
  } else if (kind === 'stud') {
    // Each seat's seven, in the dealt order h1 h2 door 4th 5th 6th 7th.
    const seven = [];
    for (let p = 0; p < n; p++) {
      if (p === hero) {
        const c = [...fill(cardsOf(mine(0)), 3)];
        for (let si = 1; si <= 4; si++) c.push(cardsOf(mine(si))[0] || null);
        seven[p] = c;
      } else {
        const s0 = cardsOf(opp(p, 0));
        const door = s0.length ? s0[s0.length - 1] : null;
        const hidden = s0.slice(0, -1).reverse();
        const c = [hidden[0] || null, hidden[1] || null, door];
        for (let si = 1; si <= 3; si++) c.push(cardsOf(opp(p, si))[0] || null);
        c.push(cardsOf(opp(p, 4))[0] || hidden[2] || null);
        seven[p] = c;
      }
    }
    const take = (p, i) => { if (!seven[p][i]) seven[p][i] = filler(); return seven[p][i]; };
    for (let p = 0; p < n; p++) deck.push(take(p, 0), take(p, 1), take(p, 2));
    const foldedBy = new Array(n).fill(99);
    h.streets.forEach((st, si) => (st.actions || []).forEach((a) => { if (a.action === 'fold') foldedBy[a.player] = Math.min(foldedBy[a.player], si); }));
    for (let si = 1; si < h.streets.length; si++) for (let p = 0; p < n; p++) if (foldedBy[p] >= si) deck.push(take(p, si + 2));
  } else {
    // Draw: the starting hands, then each draw's new cards in the order drawn. An opponent's hand is worked back
    // from the one they showed: each draw's new cards are taken from it, and what they threw is any spare card.
    const draws = h.streets.map((st) => (st.draws || []).map((d) => ({ ...d })));
    const start = [];
    for (let p = 0; p < n; p++) {
      if (p === hero) {
        let cur = cardsOf(mine(0));
        if (cur.length !== cfg.heroCards) throw new Skip('hero cards unknown');
        start[p] = cur.slice();
        for (const list of draws) for (const d of list) if (d.player === p) {
          let out = cardsOf(d.discardedCards), inn = cardsOf(d.newCards);
          if (out.length !== d.discarded || inn.length !== d.discarded) throw new Skip('hero draw unrecorded');
          d.out = out; d.in = inn;
          cur = cur.filter((c) => !out.includes(c)).concat(inn);
        }
      } else {
        let cur = fill(cardsOf(opp(p, 0)), cfg.heroCards);
        for (let si = draws.length - 1; si >= 0; si--) for (const d of draws[si]) if (d.player === p) {
          const inn = cur.slice(cur.length - d.discarded);
          const out = []; for (let k = 0; k < d.discarded; k++) out.push(filler());
          d.out = out; d.in = inn;
          cur = cur.slice(0, cur.length - d.discarded).concat(out);
        }
        start[p] = cur;
      }
    }
    for (let p = 0; p < n; p++) deck.push(...start[p]);
    for (const list of draws) { plan.draws.push(list); for (const d of list) deck.push(...d.in); }
  }
  if (new Set(deck).size !== deck.length) throw new Skip('a card dealt twice (PokerKit reshuffled)');
  while (deck.length < 52) deck.push(filler());
  return { deck, plan };
}

const fails = [];
const byGame = {};
let skipped = 0, parted = 0;
const why = {};
for (const rec of recs) {
  const kind = gameKind(rec.game);
  if (GAMES[rec.game][1] === 'fl') rec.hand = { ...rec.hand, blinds: { ...rec.hand.blinds, betCap: 4, uncapHeadsUp: false } };
  const h = rec.hand;
  const g = (byGame[rec.game] ||= { hands: 0, played: 0, fails: 0 });
  g.hands++;
  const fail = (what) => { g.fails++; fails.push(`${rec.id} ${what}`); };
  let laid;
  try { laid = layDeck(h, kind); } catch (e) { if (e instanceof Skip) { skipped++; (why[e.message] ||= []).push(rec.id); continue; } throw e; }
  const m = model(rec);
  if (m.events.some((ev) => ev.type === 'act' && (ev.halfBet || ev.shortFirst || (m.openPair4 && ev.street === 1)))) { parted++; continue; }
  const U = m.U;
  let state;
  try {
    state = startHand({
      gameType: h.gameType, gameMode: h.gameMode, currency: h.currency, blinds: h.blinds, deck: laid.deck,
      seats: h.players.map((p, i) => ({ id: i, name: p.name, stack: p.startingStack, position: p.position })),
    });
  } catch (e) { fail(`deal refused: ${e.message}`); continue; }
  const acts = m.events.filter((ev) => ev.type === 'act');
  let bad = null;
  for (let si = 0; si < h.streets.length && !bad; si++) {
    for (const ev of acts.filter((e) => e.street === si)) {
      const t = toAct(state);
      if (!t || t.kind !== 'bet' || t.player !== ev.player) { bad = `s${si}a${ev.index}: the dealer has ${t ? `seat ${t.player} to ${t.kind}` : 'nobody to act'}; PokerKit seat ${ev.player}`; break; }
      const a = h.streets[si].actions[ev.index];
      const move = /^(bet|raise)$/.test(ev.kind) || ev.kind === 'complete'
        ? { action: ev.kind === 'complete' ? 'complete' : a.action === 'raise' ? 'raise' : 'bet', to: (ev.contribBefore + ev.amount) / U }
        : { action: ev.kind === 'bringin' ? 'bring-in' : ev.kind };
      const r = act(state, ev.player, move);
      if (r.error) { bad = `s${si}a${ev.index}: ${ev.kind} refused: ${r.error}`; break; }
    }
    if (bad) break;
    for (const d of (kind === 'draw' ? laid.plan.draws[si] || [] : [])) {
      const t = toAct(state);
      if (!t || t.kind !== 'draw' || t.player !== d.player) { bad = `s${si} draw: the dealer has ${t ? `seat ${t.player} to ${t.kind}` : 'nobody to act'}; PokerKit seat ${d.player} draws`; break; }
      const r = act(state, d.player, { action: 'draw', discard: d.out });
      if (r.error) { bad = `s${si} draw: refused: ${r.error}`; break; }
    }
  }
  if (!bad && state.phase !== 'over') { const t = toAct(state); bad = `the corpus is done; the dealer still has seat ${t ? t.player : '?'} to ${t ? t.kind : 'act'} (street ${state.si}, ${currentState(state).live.length} live)`; }
  if (bad) { fail(bad); continue; }
  // Stud: every card the live dealer gave a seat is the one the deck was laid with, so nothing to check there
  // beyond the stacks; a misdeal would show as a wrong winner.
  const off = h.players.map((p, i) => [p.name, state.result.finals[i]]).filter(([name, have]) => Math.abs(have - rec.expected[name]) > 0.004);
  if (off.length) fail(`stacks: ${off.map(([nm, v]) => `${nm} ${v} (PokerKit ${rec.expected[nm]})`).join(', ')}`);
  g.played++;
}

for (const [game, g] of Object.entries(byGame)) console.log(`${game.padEnd(10)} ${String(g.hands).padStart(3)} hands ${String(g.played).padStart(3)} dealt and settled  ${g.fails ? g.fails + ' FAIL' : 'ok'}`);
for (const [w, ids] of Object.entries(why)) console.log(`  left out, ${w}: ${ids.length}${VERBOSE ? ' (' + ids.join(', ') + ')' : ''}`);
console.log(`check-live: ${recs.length} hands, ${recs.length - skipped - parted} played, ${parted} where TDA and PokerKit part, ${skipped} left out, ${fails.length} fail(s)`);
if (fails.length) {
  for (const f of fails.slice(0, VERBOSE ? fails.length : 40)) console.log('  ' + f);
  process.exit(1);
}
