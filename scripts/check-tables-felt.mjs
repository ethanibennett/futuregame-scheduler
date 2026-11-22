// The felt on the play-money tables' own hands: posts to come in at once and hands mucked at a showdown, which no
// PokerKit corpus hand has. Deals random hands through the tables' dealer (utils/poker-rules/live-hand.js: NLH,
// PLO and Limit Hold'em, most with a seat posting, stacks short enough for side pots), keeps each as one random
// player kept it in Hands, and hands them to the felt oracle (scripts/check-replayer-oracle.mjs): each is saved,
// opened from Hands, taken to the End, and every seat's stack held to what the table paid; each is also shared and
// its link opened signed out (the post and the table mark ride in the link).
//
//   npm run check:tables-felt [-- --hands 60] [-- --width 1440 --height 900]   (needs the built app)
//
// The table's own pay-outs are the export's arithmetic (held to PokerKit for every hand without a post by
// check-export.mjs, and for posts by live-hand.test.mjs's same-hands-without-the-post check).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startHand, act, toAct, savedHandFor } from '../vite-app/src/utils/poker-rules/live-hand.js';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('--hands', 60));
const pass = args.filter((a, i) => a !== '--hands' && args[i - 1] !== '--hands');

const FULL = [...'23456789TJQKA'].flatMap((r) => [...'hdcs'].map((s) => r + s));
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const GAMES = [['NLH', { sb: 50, bb: 100, ante: 0 }], ['PLO', { sb: 50, bb: 100, ante: 0 }], ['LHE', { sb: 50, bb: 100, ante: 0, bigBet: 200 }]];

const out = [];
for (let k = 0; out.length < N && k < N * 20; k++) {
  const [game, blinds] = GAMES[k % GAMES.length];
  const r = rng(k * 7907 + 13);
  const n = 4 + Math.floor(r() * 6);
  const posters = new Set(Array.from({ length: n - 3 }, (_, i) => i).filter(() => r() < 0.35));
  const seats = Array.from({ length: n }, (_, i) => ({
    id: i + 1, name: 'P' + (i + 1), stack: 100 * (3 + Math.floor(r() * 40)), ...(posters.has(i) ? { post: blinds.bb } : {}),
  }));
  const deck = FULL.slice();
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const s = startHand({ gameType: game, blinds, seats, deck });
  for (let step = 0; step < 300 && s.phase !== 'over'; step++) {
    const t = toAct(s);
    const L = t.legal, x = r();
    let move;
    if (L.canRaise && x < 0.3) move = { action: L.raiseWord === 'Bet' ? 'bet' : 'raise', to: L.fixedTo != null ? L.fixedTo : (r() < 0.3 ? L.maxTo : L.minTo) };
    else if (L.canFold && x > 0.85) move = { action: 'fold' };
    else move = { action: L.canCheck ? 'check' : 'call' };
    const res = act(s, t.player, move);
    if (!res.ok) throw new Error(`${game} #${k}: ${JSON.stringify(move)} refused: ${res.error}`);
  }
  const mucked = s.result.showdown && s.result.live.some((p) => !s.result.shown.includes(p));
  if (!posters.size && !mucked) continue;  // only what the corpus lacks
  const hero = Math.floor(r() * n);
  const tags = [...(posters.size ? ['post'] : []), ...(mucked ? ['mucked'] : []), ...(s.result.showdown ? ['showdown'] : [])];
  out.push({
    id: `${game}#t${k}`, game, tags,
    hand: savedHandFor(s, hero),
    expected: Object.fromEntries(s.players.map((p, i) => [p.name, s.result.finals[i]])),
  });
}
const file = path.join(os.tmpdir(), `fg-tables-felt-${process.pid}.jsonl`);
fs.writeFileSync(file, out.map((x) => JSON.stringify(x)).join('\n') + '\n');
const posts = out.filter((x) => x.tags.includes('post')).length, mucks = out.filter((x) => x.tags.includes('mucked')).length;
console.log(`${out.length} table hands (${posts} with a post, ${mucks} with a hand mucked at the showdown) -> the felt`);
const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'check-replayer-oracle.mjs'), '--corpus', file, '--share-every', '1', ...pass], { stdio: 'inherit' });
fs.rmSync(file, { force: true });
process.exit(r.status == null ? 1 : r.status);
