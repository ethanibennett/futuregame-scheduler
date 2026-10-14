#!/usr/bin/env node
// Hand-history conversion from the command line (docs/hand-history-io.md).
//
//   node scripts/hh-convert.mjs write <hands.json> [--site PokerStars] [--hero "Name"] > out.txt
//       hands.json: one saved hand, an array of them, or the /api/replayer/hands list (rows
//       carry created_at, which dates each hand; a bare hand is dated now). Writes a
//       PokerStars-format file (UTF-8 BOM, CRLF) to stdout; what it skips goes to stderr.
//   node scripts/hh-convert.mjs parse <file.txt> [--site pokerstars]
//       Prints { site, hands, errors } as JSON.
//
// For the owner's PokerTracker 4 check: write the goldens' hands, import out.txt into an
// empty PT4 database, compare (section 10 of the doc).

import fs from 'node:fs';
import { writePokerStarsFile } from '../vite-app/src/utils/hand-history/index.js';
import { parseHandHistory } from '../lib/hh-import/index.mjs';

const [cmd, file, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const die = (msg) => { process.stderr.write(msg + '\n'); process.exit(2); };
if (!cmd || !file) die('usage: hh-convert.mjs write <hands.json> | parse <file.txt>');

if (cmd === 'write') {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(data) ? data : [data];
  const entries = list.map((row) => {
    const hand = row && row.hand && row.hand.streets ? row.hand : row;
    const at = row && row.created_at ? new Date(String(row.created_at).replace(' ', 'T') + 'Z')
      : row && row.opts && row.opts.playedAt ? new Date(row.opts.playedAt) : new Date();
    return { hand, playedAt: at };
  });
  const r = writePokerStarsFile(entries, { site: flag('--site'), heroName: flag('--hero') });
  process.stdout.write(r.text);
  for (const s of r.skipped) process.stderr.write(`skipped #${s.index}: ${s.code} — ${s.message}\n`);
  process.stderr.write(`${r.written.length} written, ${r.skipped.length} skipped\n`);
} else if (cmd === 'parse') {
  const r = parseHandHistory(fs.readFileSync(file, 'utf8'), { site: flag('--site') });
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
} else die('unknown command ' + cmd);
