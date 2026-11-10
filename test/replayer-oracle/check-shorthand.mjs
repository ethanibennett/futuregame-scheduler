// Every hand of an oracle corpus through a share link's encoding and back (hand-shorthand.js encodeHand ->
// decodeHand): what the link carries must be the hand that was shared. Names are not carried (a link reads
// "Hero" and "Opp 1"..) and neither are the felt and the notes; everything that decides the chips is.
//
//   node test/replayer-oracle/check-shorthand.mjs [corpus.jsonl ...] [--show 3]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.window = globalThis.window || globalThis;
const root = path.join(import.meta.dirname, '..', '..');
const { encodeHand, decodeHand } = await import(pathToFileURL(path.join(root, 'vite-app', 'src', 'utils', 'hand-shorthand.js')).href);

const args = process.argv.slice(2);
const showAt = args.indexOf('--show');
const SHOW = showAt >= 0 ? Number(args[showAt + 1]) : 3;
const files = args.filter((a, i) => !a.startsWith('--') && (showAt < 0 || i !== showAt + 1));
if (!files.length) files.push(path.join(import.meta.dirname, 'corpus.jsonl'));

const num = (v) => Number(v) || 0;
function differences(a, b) {
  const out = [];
  const eq = (what, x, y) => { if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${what}: ${JSON.stringify(x)} -> ${JSON.stringify(y)}`); };
  if (!b) return ['did not decode'];
  eq('gameType', a.gameType, b.gameType);
  eq('gameMode', a.gameMode === 'cash' ? 'cash' : 'mtt', b.gameMode === 'cash' ? 'cash' : 'mtt');
  eq('heroIdx', a.heroIdx, b.heroIdx);
  eq('stacks', a.players.map((p) => num(p.startingStack)), b.players.map((p) => num(p.startingStack)));
  eq('positions', a.players.map((p) => p.position), b.players.map((p) => p.position));
  for (const k of ['sb', 'bb', 'ante', 'bigBet', 'bringIn']) if (num(a.blinds[k]) !== num(b.blinds[k])) out.push(`blinds.${k}: ${a.blinds[k]} -> ${b.blinds[k]}`);
  a.streets.forEach((s, si) => {
    const t = b.streets[si] || { cards: {}, actions: [], draws: [] };
    eq(`street ${si} hero`, s.cards.hero || '', t.cards.hero || '');
    eq(`street ${si} board`, s.cards.board || '', t.cards.board || '');
    eq(`street ${si} opponents`, (s.cards.opponents || []).map((x) => x || ''), (t.cards.opponents || []).map((x) => x || ''));
    eq(`street ${si} actions`, s.actions.map((x) => [x.player, x.action, num(x.amount)]), t.actions.map((x) => [x.player, x.action, num(x.amount)]));
    eq(`street ${si} draws`, s.draws.map((d) => [d.player, d.discarded, d.discardedCards || '', d.newCards || '']),
      (t.draws || []).map((d) => [d.player, d.discarded, d.discardedCards || '', d.newCards || '']));
  });
  return out;
}

const byGame = new Map();
const fails = [];
let total = 0;
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    total++;
    const g = byGame.get(rec.game) || { n: 0, bad: 0 };
    byGame.set(rec.game, g);
    g.n++;
    let diff;
    try { diff = differences(rec.hand, decodeHand(encodeHand(rec.hand))); } catch (e) { diff = ['threw: ' + e.message]; }
    if (diff.length) { g.bad++; fails.push({ rec, diff }); }
  }
}
for (const [game, g] of byGame) console.log(`${g.bad ? 'FAIL' : ' ok '} ${game.padEnd(10)} ${g.n - g.bad}/${g.n}`);
const kinds = new Map();
for (const x of fails) {
  const k = x.diff.map((d) => d.split(':')[0].replace(/\d+/g, '#')).filter((v, i, a) => a.indexOf(v) === i).join(' + ');
  if (!kinds.has(k)) kinds.set(k, []);
  kinds.get(k).push(x);
}
for (const [k, list] of [...kinds].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${list.length} × ${k}`);
  for (const x of list.slice(0, SHOW)) console.log(`   ${x.rec.id} (${x.rec.mode}) ${x.diff.slice(0, 3).join(' | ').slice(0, 300)}`);
}
console.log(`\n${total - fails.length} of ${total} hands come back from a share link as they went`);
process.exit(fails.length ? 1 : 0);
