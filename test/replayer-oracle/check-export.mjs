// Every hand of an oracle corpus through the app's own hand-history writer: each seat's final stack in the
// written PokerStars text must be what PokerKit's play, settled to TDA rules, says (generate.py).
//
//   node test/replayer-oracle/check-export.mjs [corpus.jsonl ...] [--show 5]
//
// With no file it reads the committed corpus (corpus.jsonl here). The felt is held to the same corpus by
// scripts/check-replayer-games.mjs --corpus.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.join(import.meta.dirname, '..', '..');
const { writePokerStarsHand } = await import(pathToFileURL(path.join(root, 'vite-app', 'src', 'utils', 'hand-history', 'index.js')).href);
const { goldenFinals } = await import(pathToFileURL(path.join(root, 'test', 'hh-io', 'golden-finals.mjs')).href);

const args = process.argv.slice(2);
const showAt = args.indexOf('--show');
const SHOW = showAt >= 0 ? Number(args[showAt + 1]) : 3;
const files = args.filter((a, i) => !a.startsWith('--') && (showAt < 0 || i !== showAt + 1));
if (!files.length) files.push(path.join(import.meta.dirname, 'corpus.jsonl'));

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
    let problem = null;
    try {
      const { text } = writePokerStarsHand(rec.hand, { playedAt: new Date('2026-11-01T17:00:00Z') });
      const { finals } = goldenFinals(text);
      const off = [];
      for (const [name, want] of Object.entries(rec.expected)) {
        const have = finals.get(name);
        if (have === undefined || Math.abs(have - want) > 0.004) off.push(`${name} ${have} (want ${want})`);
      }
      if (off.length) problem = 'stacks: ' + off.join(', ');
    } catch (e) {
      problem = 'refused: ' + (e.code ? e.code + ' ' : '') + e.message.split('\n')[0];
    }
    if (problem) { g.bad++; fails.push({ rec, problem }); }
  }
}
for (const [game, g] of byGame) console.log(`${g.bad ? 'FAIL' : ' ok '} ${game.padEnd(10)} ${g.n - g.bad}/${g.n}`);
const kinds = new Map();
for (const x of fails) {
  const k = x.rec.game + ' | ' + x.problem.replace(/[\d.]+/g, '#').slice(0, 70);
  if (!kinds.has(k)) kinds.set(k, []);
  kinds.get(k).push(x);
}
for (const [k, list] of kinds) {
  console.log(`\n${list.length} × ${k}`);
  for (const x of list.slice(0, SHOW)) console.log(`   ${x.rec.id} [${x.rec.tags.join(',')}] ${x.problem}`);
}
console.log(`\n${total - fails.length} of ${total} hands: every seat as the oracle says`);
process.exit(fails.length ? 1 : 0);
