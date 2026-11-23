#!/usr/bin/env node
/* The pro list behind the hand entry's name suggestions (owner, 2026-11-23: "Can we pull from a database of poker
 * player names?" → "Pro list only"). Names are read from Wikipedia's tournament results pages: every WSOP year
 * (winners and runners-up) and its results page (every final table), WSOP Europe and Asia Pacific, each World
 * Poker Tour and European Poker Tour season's results, the Main Event champions, the Hall of Fame, the WPT
 * Champions Club, the Super High Roller Bowl, Triton, the Poker Players Championship and the Aussie Millions.
 * Only the columns that name players are read (Winner, Runner-up, Name, Player, Champion, Inductee).
 *
 * A name is ranked by how many results it appears in (a win counts 3), most first. A name longer than the entry's
 * 20-character field is shortened as the app shortens names, "Alexandre Vuilleumier" → "A. Vuilleumier".
 *
 * Writes vite-app/src/data/pro-names.json, which the entry loads on its own the first time a name field is
 * focused. Re-run to refresh (about a dozen requests, a second apart):
 *   node scripts/build-pro-names.mjs [--dry] [--cache <dir>]
 * --dry prints each page's count and writes nothing; --cache keeps each page's wikitext in <dir> and reads it from
 * there next time (a missing page is kept as missing), so the extraction can be tuned without fetching again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'vite-app/src/data/pro-names.json');
const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'name-list-builder/1.0 (one-off script)';
const MAX = 20; // the entry's name field

const YEAR = new Date().getFullYear();
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const TITLES = [
  ...range(1970, YEAR).flatMap((y) => [`${y} World Series of Poker`, `${y} World Series of Poker results`]),
  ...range(2007, YEAR).map((y) => `${y} World Series of Poker Europe`),
  ...range(2013, YEAR).map((y) => `${y} World Series of Poker Asia Pacific`),
  ...range(1, 30).map((n) => `World Poker Tour season ${n} results`),
  ...range(1, 30).map((n) => `European Poker Tour season ${n} results`),
  'List of World Series of Poker Main Event champions', 'Poker Hall of Fame', 'World Poker Tour Champions Club',
  'Super High Roller Bowl', 'Triton Poker Series', 'The Poker Players Championship', 'Crown Australian Poker Championship',
];

const PLAYER_COL = /^(winner|winners|runner[- ]?up|runners[- ]?up|name|player|players|champion|champions|inductee|inductees|second|2nd|1st|first)\b/i;
const WIN_COL = /^(winner|champion|1st|first)/i;
// Words no person's name holds: what a stray venue, event or note cell would.
const STOP = /\b(casino|resort|hotel|club|poker|tour|event|events|series|championship|results|total|prize|vegas|city|monte|carlo|unknown|various|tbd|n\/a|none|vacant|cancelled|canceled|online|main|final|table|season|world|europe|asia|pacific|day|flight|bounty|high|roller|hold'?em|omaha|stud|razz|limit|horse|mixed)\b/i;

const argv = process.argv.slice(2);
const CACHE = argv.includes('--cache') ? argv[argv.indexOf('--cache') + 1] : null;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* Every page's wikitext, 20 pages a request (Wikipedia's API limits anonymous clients; one page a request was
   refused after a few dozen): Map(title asked -> text, or null for no such page). A 429 waits as long as the
   server's Retry-After says. */
async function fetchAll(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const q = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
      titles: batch.join('|'), redirects: '1', format: 'json', formatversion: '2' });
    let d = null;
    for (let attempt = 0; attempt < 5 && !d; attempt++) {
      const r = await fetch(`${API}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) }).catch(() => null);
      if (r && r.ok) { d = await r.json(); break; }
      const wait = r && Number(r.headers.get('retry-after')) > 0 ? Number(r.headers.get('retry-after')) * 1000 : 30000 * (attempt + 1);
      process.stderr.write(`HTTP ${r ? r.status : 'error'}; waiting ${Math.round(wait / 1000)} s
`);
      await sleep(wait);
    }
    if (!d) throw new Error('Wikipedia refused the request five times; try again later');
    // Asked title -> the page's title, through normalisation and redirects.
    const to = new Map(batch.map((t) => [t, t]));
    for (const n of d.query.normalized || []) for (const [k, v] of to) if (v === n.from) to.set(k, n.to);
    for (const n of d.query.redirects || []) for (const [k, v] of to) if (v === n.from) to.set(k, n.to);
    const byTitle = new Map((d.query.pages || []).map((pg) => [pg.title,
      pg.missing || !pg.revisions ? null : pg.revisions[0].slots.main.content]));
    for (const t of batch) out.set(t, byTitle.has(to.get(t)) ? byTitle.get(to.get(t)) : null);
    process.stderr.write(`${Math.min(i + 20, titles.length)}/${titles.length} titles
`);
    await sleep(1000);
  }
  return out;
}

async function allPages(titles) {
  const file = CACHE && path.join(CACHE, 'pages.json');
  if (file && fs.existsSync(file)) return new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
  const got = await fetchAll(titles);
  if (file) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file, JSON.stringify(Object.fromEntries(got))); }
  return got;
}

// Split on `sep` at the top level only (outside [[ ]] and {{ }}).
function splitTop(s, sep) {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; cur += two; i++; continue; }
    if ((two === ']]' || two === '}}') && depth > 0) { depth--; cur += two; i++; continue; }
    if (depth === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

// A cell's content without its attributes (`style="…" | content`).
function cellContent(c) {
  const parts = splitTop(c, '|');
  return parts.length > 1 && /=/.test(parts[0]) && !/\[\[|\{\{/.test(parts[0]) ? parts.slice(1).join('|') : c;
}

// Every wikitable as { headers: [...], rows: [[cell, ...], ...] }.
function tables(text) {
  const out = [];
  const re = /\{\|([\s\S]*?)\n\|\}/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1];
    let headers = [];
    const rows = [];
    for (const chunk of body.split(/\n\|-[^\n]*/)) {
      const lines = chunk.split('\n').filter((l) => /^[!|]/.test(l) && !/^\|\+/.test(l));
      const heads = [], cells = [];
      for (const line of lines) {
        if (line.startsWith('!')) heads.push(...splitTop(line.slice(1), '!!').map(cellContent));
        else cells.push(...splitTop(line.slice(1), '||').map(cellContent));
      }
      if (heads.length && !cells.length) { headers = heads.map((h) => clean(h)); continue; }
      if (cells.length) rows.push(cells);
    }
    out.push({ headers, rows });
  }
  return out;
}

function clean(s) {
  return String(s || '')
    .replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '')
    .replace(/<small>[\s\S]*?<\/small>/g, '')
    .replace(/\{\{\s*(sortname)\s*\|([^|}]*)\|([^|}]*)[^}]*\}\}/gi, '$2 $3')
    .replace(/\{\{\s*(nowrap|nobr)\s*\|([^}]*)\}\}/gi, '$2')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<br\s*\/?>[\s\S]*$/i, '')
    .replace(/<[^>]+>/g, '')
    .replace(/'''?/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[*†‡#^]+/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const WORD = /^[\p{L}][\p{L}.'’-]*$/u;
function personName(cell) {
  const name = clean(cell);
  const words = name.split(' ');
  if (words.length < 2 || words.length > 5) return null;
  if (!words.every((w) => WORD.test(w))) return null;
  if (STOP.test(name)) return null;
  if (name.length > MAX) {
    const short = `${words[0][0]}. ${words.slice(1).join(' ')}`;
    return short.length <= MAX ? short : null;
  }
  return name;
}

const scores = new Map(); // key -> { score, spellings: Map(name -> times seen) }
const pages = { read: 0, missing: 0 };
const dry = process.argv.includes('--dry');
const texts = await allPages(TITLES);
for (const title of TITLES) {
  const text = texts.get(title);
  if (text == null) { pages.missing++; continue; }
  pages.read++;
  let found = 0;
  for (const t of tables(text)) {
    const cols = t.headers.map((h, i) => (PLAYER_COL.test(h) ? i : -1)).filter((i) => i >= 0);
    if (!cols.length) continue;
    for (const row of t.rows) {
      // A row whose first cell is a header cell (rowspan years) shifts nothing here: cells are read by header index.
      for (const i of cols) {
        const name = personName(row[i]);
        if (!name) continue;
        // One player however a page capitalised or accented them: "J. van den Bijgaart" = "J. Van Den Bijgaart".
        const key = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const had = scores.get(key) || { score: 0, spellings: new Map() };
        had.score += WIN_COL.test(t.headers[i]) ? 3 : 1;
        had.spellings.set(name, (had.spellings.get(name) || 0) + 1);
        scores.set(key, had);
        found++;
      }
    }
  }
  if (dry) console.log(`${found.toString().padStart(5)}  ${title}`);
}

// "Phil Hellmuth Jr." is Phil Hellmuth wherever the plain name is listed too: one player, the plain spelling.
for (const [key, v] of [...scores]) {
  const base = key.replace(/,?\s+(jr|sr)\.?$/, '');
  if (base === key || !scores.has(base)) continue;
  const into = scores.get(base);
  into.score += v.score;
  scores.delete(key);
}
// Each player under the spelling seen most (the accented one on a tie), most results first.
const spelled = (sp) => [...sp.entries()].sort((a, b) => b[1] - a[1] || b[0].normalize('NFD').length - a[0].normalize('NFD').length)[0][0];
const names = [...scores.values()].map((v) => [spelled(v.spellings), v.score])
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
console.log(`${pages.read} pages read, ${pages.missing} missing; ${names.length} names`);
if (!dry) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const doc = { source: 'Wikipedia tournament results pages (scripts/build-pro-names.mjs)', built: new Date().toISOString().slice(0, 10), names };
  fs.writeFileSync(OUT, JSON.stringify(doc) + '\n');
  console.log(`wrote ${path.relative(ROOT, OUT)} (${fs.statSync(OUT).size} bytes)`);
}
