// Quick add's reader (utils/quick-add/gaps.js and its Table) against PokerKit, in plain Node.
//
// Quick add questions a described hand where its betting cannot be right. Every corpus hand is legal, played by
// PokerKit, so none may raise a question about its actions. Before this check, 56 of the 1,200 did ("raised to
// 82.55, but the minimum raise was to 82.55": the sums were compared before their float tails were cleaned).
//
// The control: in no-limit and pot-limit, each hand's first raise that is not all in is cut to just under the
// module's smallest raise (utils/poker-rules/betting.js, held to PokerKit by check-rules), and that hand MUST be
// questioned, so a reader that asks nothing cannot pass.
//
//   node test/replayer-oracle/check-quick-add.mjs [--games NLH,PLO] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { GAMES } from './model.mjs';
import { findGaps } from '../../vite-app/src/utils/quick-add/gaps.js';
import { streetState } from '../../vite-app/src/utils/poker-rules/betting.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : ''; };
const ONLY = (opt('--games') || '').split(',').map((s) => s.trim()).filter(Boolean);
const VERBOSE = args.includes('--verbose');

const recs = fs.readFileSync(path.join(ROOT, 'test', 'replayer-oracle', 'corpus.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => GAMES[r.game] && (!ONLY.length || ONLY.includes(r.game)));

const actionQuestions = (hand) => findGaps(hand).filter((g) => /^streets\.\d+\.actions/.test(g.field || '') || /^action/.test(g.id));
const handAt = (h, si, ai) => ({ ...h, streets: h.streets.map((s, k) => ({ ...s, actions: k < si ? (s.actions || []) : k === si ? (s.actions || []).slice(0, ai) : [] })) });

const fails = [];
let hands = 0, controls = 0;
for (const rec of recs) {
  // PokerKit caps a limit round at a bet and three raises, every street (check-rules does the same).
  const hand = GAMES[rec.game][1] === 'fl' ? { ...rec.hand, blinds: { ...rec.hand.blinds, betCap: 4, uncapHeadsUp: false } } : rec.hand;
  hands++;
  const qs = actionQuestions(hand);
  if (qs.length) fails.push(`${rec.id}: a legal hand questioned: ${qs.map((g) => g.question).join(' | ')}`);

  if (GAMES[rec.game][1] === 'fl') continue;
  // The control: the first raise or bet above the smallest, cut to one unit under it.
  const unit = hand.gameMode === 'cash' ? 0.01 : 1;
  let cut = null;
  hand.streets.some((s, si) => (s.actions || []).some((a, ai) => {
    if (a.action !== 'raise' && a.action !== 'bet') return false;
    const L = streetState(handAt(hand, si, ai), si).legal;
    if (!L || !L.canRaise || L.minTo - L.contrib - unit <= 0 || a.amount >= L.stack) return false;
    cut = { si, ai, amount: Math.round((L.minTo - L.contrib - unit) / unit) * unit };
    return true;
  }));
  if (!cut) continue;
  controls++;
  const broken = JSON.parse(JSON.stringify(hand));
  broken.streets[cut.si].actions[cut.ai].amount = cut.amount;
  if (!actionQuestions(broken).length) fails.push(`${rec.id}: a raise cut to ${cut.amount} added (under the smallest) went unquestioned`);
}

if (VERBOSE || fails.length) for (const f of fails.slice(0, 40)) console.log('  FAIL ' + f);
console.log(`check-quick-add: ${hands} legal hands, ${controls} cut raises, ${fails.length} fail(s)`);
process.exit(fails.length ? 1 : 0);
