// The shared betting rules (vite-app/src/utils/poker-rules/betting.js) against PokerKit, in plain Node.
//
// Every corpus hand is replayed action by action. Before each action the module must name the same player
// to act as PokerKit did, the same price, allow a raise exactly where PokerKit does (save where the TDA and
// PokerKit part, below), offer the same smallest raise and, in pot limit, the same pot-sized one; and it
// must accept the action PokerKit played. After a street's last action nobody may be left to act.
//
// Where they part on purpose (the entry oracle's notes, docs/entry-audit/entry-vs-oracle.md):
//   - limit, an all-in of half a bet or more reopens the betting under TDA rule 47-B, not under PokerKit;
//   - stud's 4th street with an open pair: PokerKit bets the small bet only.
//
//   node test/replayer-oracle/check-rules.mjs [--games NLH,PLO] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { model, GAMES } from './model.mjs';
import { streetState, checkAction } from '../../vite-app/src/utils/poker-rules/betting.js';
import { settleHand } from '../../vite-app/src/utils/poker-rules/settle.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : ''; };
const ONLY = (opt('--games') || '').split(',').map((s) => s.trim()).filter(Boolean);
const VERBOSE = args.includes('--verbose');

const recs = fs.readFileSync(path.join(ROOT, 'test', 'replayer-oracle', 'corpus.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => GAMES[r.game] && (!ONLY.length || ONLY.includes(r.game)))
  // The model posts the two blinds only, as the entry oracle's does: hands with a straddle are left out there too.
  .filter((r) => !(r.hand.blinds && r.hand.blinds.straddle));

// The hand as it stood just before action `ai` of street `si`.
function handAt(h, si, ai) {
  return { ...h, streets: h.streets.map((s, k) => ({ ...s, actions: k < si ? (s.actions || []) : k === si ? (s.actions || []).slice(0, ai) : [] })) };
}

const fails = [];
const byGame = {};
let steps = 0, parted = 0;
for (const rec of recs) {
  /* PokerKit plays a bet and three raises a round, always; the entry oracle types Cap 4 and switches
     "Uncapped heads-up" off to match, and so does this (docs/entry-audit/entry-vs-oracle.md, "The cap"). */
  if (GAMES[rec.game][1] === 'fl') rec.hand = { ...rec.hand, blinds: { ...rec.hand.blinds, betCap: 4, uncapHeadsUp: false } };
  const m = model(rec);
  const U = m.U;
  const c = (v) => (v == null ? v : Math.round(v * U));
  const g = (byGame[rec.game] ||= { hands: 0, steps: 0, fails: 0 });
  g.hands++;
  const fail = (ev, what) => { g.fails++; fails.push(`${rec.id} s${ev.street}a${ev.index}: ${what}`); };
  for (const ev of m.events) {
    if (ev.type !== 'act') continue;
    steps++; g.steps++;
    const hand = handAt(rec.hand, ev.street, ev.index);
    const st = streetState(hand, ev.street);
    const L = st.legal;
    if (!L) { fail(ev, `nobody to act; PokerKit has seat ${ev.player}`); continue; }
    if (L.player !== ev.player) { fail(ev, `seat ${L.player} to act; PokerKit has seat ${ev.player}`); continue; }
    if (ev.kind === 'bringin') {
      if (c(L.bringIn) !== ev.amount) fail(ev, `bring-in ${c(L.bringIn)}, PokerKit ${ev.amount}`);
    } else {
      if (c(L.call) !== ev.owe) fail(ev, `price ${c(L.call)}, PokerKit ${ev.owe}`);
      /* Where the TDA and PokerKit part on purpose: limit's half-bet all-in (rule 47-B); stud's open pair on 4th;
         and a short all-in that is the round's only raise. PokerKit starts a round with no raise on record, so
         its first raise reopens the betting at any size; under the TDA (rule 43) an all-in short of a full raise
         over the blind does not reopen it to players who have acted (NLH#21: the big blind all in for 0.07 more). */
      const shortFirst = !L.canRaise && !ev.noRaise && ev.count > 0 && ev.cbra > 0 && ev.cbra < ev.streetMin;
      const tdaParts = (m.betting === 'fl' && ev.halfBet) || (m.openPair4 && ev.street === 1) || shortFirst;
      if (L.canRaise !== !ev.noRaise) {
        if (tdaParts) parted++;
        else fail(ev, `raise ${L.canRaise ? 'allowed' : 'refused'}; PokerKit ${ev.noRaise ? 'refuses (' + ev.noRaise + ')' : 'allows it'}`);
      } else if (L.canRaise && !tdaParts) {
        if (c(L.minTo) !== ev.minTo) fail(ev, `smallest raise to ${c(L.minTo)}, PokerKit ${ev.minTo}`);
        if (m.betting === 'pl' && c(L.maxTo) !== ev.potTo) fail(ev, `pot raise to ${c(L.maxTo)}, PokerKit ${ev.potTo}`);
        if (m.betting === 'nl' && c(L.maxTo) !== ev.allInTo) fail(ev, `largest raise to ${c(L.maxTo)}, PokerKit (all in) ${ev.allInTo}`);
      }
    }
    // The action PokerKit played must be accepted, and stored as the corpus stores it.
    const a = rec.hand.streets[ev.street].actions[ev.index];
    const move = /^(bet|raise)$/.test(ev.kind) || ev.kind === 'complete'
      ? { action: ev.kind === 'complete' ? 'complete' : a.action === 'raise' ? 'raise' : 'bet', to: (ev.contribBefore + ev.amount) / U }
      : { action: ev.kind === 'bringin' ? 'bring-in' : ev.kind };
    const r = checkAction(hand, ev.street, ev.player, move);
    if (r.error) { if (!((m.openPair4 && ev.street === 1) || ev.halfBet)) fail(ev, `${ev.kind} refused: ${r.error}`); }
    else if (c(r.action.amount) !== ev.amount) fail(ev, `${ev.kind} stored as ${c(r.action.amount)} added, the corpus ${ev.amount}`);
  }
  // The dealer's settlement (poker-rules/settle.js) leaves every seat on the oracle's stack.
  try {
    const { finals } = settleHand(rec.hand);
    const off = rec.hand.players.map((p, i) => [p.name, finals[i]]).filter(([name, have]) => Math.abs(have - rec.expected[name]) > 0.004);
    if (off.length) { g.fails++; fails.push(`${rec.id} settle: ${off.map(([nm, v]) => `${nm} ${v} (want ${rec.expected[nm]})`).join(', ')}`); }
  } catch (e) { g.fails++; fails.push(`${rec.id} settle refused: ${e.message.split('\n')[0]}`); }
  // Each street the corpus finished: nobody left to act.
  const h = rec.hand;
  for (let si = 0; si < h.streets.length; si++) {
    const acts = h.streets[si].actions || [];
    if (!acts.length) continue;
    const st = streetState(handAt(h, si, acts.length), si);
    if (st.legal && st.live.length > 1) { g.fails++; fails.push(`${rec.id} s${si} end: seat ${st.legal.player} still to act`); }
  }
}

for (const [game, g] of Object.entries(byGame)) console.log(`${game.padEnd(10)} ${String(g.hands).padStart(3)} hands ${String(g.steps).padStart(5)} actions  ${g.fails ? g.fails + ' FAIL' : 'ok'}`);
console.log(`${recs.length} hands, ${steps} actions, ${parted} where TDA and PokerKit part on purpose, ${fails.length} fails`);
if (fails.length) {
  for (const f of fails.slice(0, VERBOSE ? fails.length : 40)) console.log('  ' + f);
  process.exit(1);
}
