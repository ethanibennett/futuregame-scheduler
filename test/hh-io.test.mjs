/**
 * Hand-history I/O: the PokerStars-format writer (vite-app/src/utils/hand-history/)
 * and the importer framework (lib/hh-import/). docs/hand-history-io.md section 10.
 *
 *   A golden      write(fixture) is golden/<case>.txt byte for byte (UPDATE_GOLDEN=1 rewrites)
 *   B grammar     every golden line matches a rule of test/hh-io/ps-grammar.mjs
 *   C accounting  chips conserved, pots sum, stacks never negative, "and is all-in" and
 *                 "(didn't bet)" exactly when they should be — read from the TEXT
 *   D round trip  canonical(parse(write(h))) = canonical(prepare(h).model); write(parse(t)) = t
 *   E determinism same bytes; hand id stable, content-only, 8 + 15 digits; tournament ids
 *   F errors      each error fixture's code; a file skips and lists them
 *   G file format BOM, CRLF, three blank lines after each hand, chronological
 *   H registry    detection, wsop-replay needs a sample, unknown text, one bad hand
 *   I genuine     the parser on hand-written snippets of observed PokerStars constructs
 *   J gaps        every parsed hand replays in the app: no blocking quick-add gap
 *
 * Run: npm run test:hh-io   (node --test test/hh-io.test.mjs)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writePokerStarsHand, writePokerStarsFile, checkExportable, prepareHand, handHistoryId, canonicalHand,
  tournamentIdFor, HandExportError,
} from '../vite-app/src/utils/hand-history/index.js';
import { parseHandHistory, detectSite, PARSERS, getParser, HandHistoryError } from '../lib/hh-import/index.mjs';
import { findGaps } from '../vite-app/src/utils/quick-add/gaps.js';
import { HAND_CONFIG as QA_HAND_CONFIG } from '../vite-app/src/utils/quick-add/game.js';
import { ruleFor } from './hh-io/ps-grammar.mjs';
import { fastBestHigh, fastBestOmahaHigh } from '../vite-app/src/utils/hand-history/fast-high.js';
import { bestHighHand, bestOmahaHigh } from '../vite-app/src/utils/poker-engine.js';
import { fnv1a64, fnv1a64Reference } from '../vite-app/src/utils/hand-history/ps-format.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'hh-io', 'fixtures');
const GOLD = path.join(here, 'hh-io', 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

const load = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const optsOf = (fx) => { const o = { ...fx.opts }; if (o.playedAt) o.playedAt = new Date(o.playedAt); return o; };
const ALL = fs.readdirSync(FIX).filter(f => f.endsWith('.json')).sort();
const OK = ALL.filter(f => !load(f).expectCode);
const ERR = ALL.filter(f => load(f).expectCode);
const base = (f) => f.replace(/\.json$/, '');
const written = new Map();
const write = (f) => {
  if (!written.has(f)) { const fx = load(f); written.set(f, writePokerStarsHand(fx.hand, optsOf(fx))); }
  return written.get(f);
};

// ── A. Golden ───────────────────────────────────────────────────────────────
test('A. every fixture writes its golden file byte for byte', () => {
  if (UPDATE) fs.mkdirSync(GOLD, { recursive: true });
  assert.ok(OK.length >= 36, 'fixtures for every case: ' + OK.length);
  for (const f of OK) {
    const text = write(f).text + '\n';
    const gp = path.join(GOLD, base(f) + '.txt');
    if (UPDATE) fs.writeFileSync(gp, text);
    assert.ok(fs.existsSync(gp), 'golden exists for ' + f + ' (UPDATE_GOLDEN=1 to write it)');
    assert.equal(text, fs.readFileSync(gp, 'utf8'), f);
  }
});

// ── B. Grammar ──────────────────────────────────────────────────────────────
test('B. every golden line matches one rule of the independent grammar', () => {
  for (const f of fs.readdirSync(GOLD).filter(x => x.endsWith('.txt'))) {
    const lines = fs.readFileSync(path.join(GOLD, f), 'utf8').replace(/\n$/, '').split('\n');
    lines.forEach((l, i) => assert.ok(ruleFor(l), `${f}:${i + 1} matches no rule: ${JSON.stringify(l)}`));
    assert.ok(!lines.some(l => /\s$/.test(l)), f + ' has no trailing spaces');
  }
});

// ── C. Accounting, read from the text alone ─────────────────────────────────
const cents = (s) => Math.round(Number(String(s).replace(/[^\d.]/g, '')) * 100);
function account(text) {
  const lines = text.split('\n');
  const stack = new Map(), beyond = new Map(), names = [];
  let street = new Map(), inPot = 0, collected = 0, summary = false, total = null, potParts = [];
  const errs = [];
  const nameOf = (l) => names.filter(n => l.startsWith(n + ':') || l.startsWith(n + ' ')).sort((a, b) => b.length - a.length)[0];
  const put = (n, c, allIn, l, ante) => {
    stack.set(n, stack.get(n) - c);
    inPot += c;
    if (!ante) { street.set(n, (street.get(n) || 0) + c); beyond.set(n, (beyond.get(n) || 0) + c); }
    if (stack.get(n) < 0) errs.push('negative stack: ' + l);
    if (allIn !== (stack.get(n) === 0)) errs.push('all-in flag wrong: ' + l);
  };
  let firstStreet = true, lastWasDraw = false;
  for (const l of lines) {
    let m;
    if (!summary && (m = /^Seat \d+: (.+) \((\D?[\d.]+) in chips\)$/.exec(l))) { names.push(m[1]); stack.set(m[1], cents(m[2])); beyond.set(m[1], 0); continue; }
    if (/^\*\*\* SUMMARY \*\*\*$/.test(l)) { summary = true; continue; }
    if (/^\*\*\* /.test(l)) { if (!/HOLE CARDS|DEALING HANDS|3rd STREET|SHOW DOWN/.test(l) || !firstStreet) street = new Map(); firstStreet = false; continue; }
    if (summary) {
      if ((m = /^Total pot (\D?[\d.]+)(.*) \| Rake/.exec(l))) { total = cents(m[1]); potParts = [...m[2].matchAll(/pot(?:-\d)? (\D?[\d.]+)\./g)].map(x => cents(x[1])); }
      if ((m = /^Seat \d+: (.+?)(?: \((?:button|small blind|big blind)\))* folded (.*)$/.exec(l))) {
        const didnt = /\(didn't bet\)/.test(m[2]);
        if (didnt !== (beyond.get(m[1]) === 0)) errs.push("didn't-bet wrong: " + l);
      }
      continue;
    }
    if ((m = /^Uncalled bet \((\D?[\d.]+)\) returned to (.+)$/.exec(l))) { const c = cents(m[1]); stack.set(m[2], stack.get(m[2]) + c); beyond.set(m[2], beyond.get(m[2]) - c); street.set(m[2], street.get(m[2]) - c); inPot -= c; continue; }
    // A headerless single draw: its first discard line opens the next betting round.
    const isDraw = /^[^:]+: (?:discards|stands pat)/.test(l) && !!nameOf(l);
    if (isDraw && !lastWasDraw) street = new Map();
    lastWasDraw = isDraw || (lastWasDraw && /^Dealt to /.test(l));
    const n = nameOf(l);
    if (!n) continue;
    const rest = l.slice(n.length);
    const allIn = / and is all-in$/.test(rest);
    const r = rest.replace(/ and is all-in$/, '');
    if ((m = /^: posts the ante (\D?[\d.]+)$/.exec(r))) put(n, cents(m[1]), allIn, l, true);
    else if ((m = /^: posts (?:small blind|big blind|straddle) (\D?[\d.]+)$/.exec(r))) put(n, cents(m[1]), allIn, l, false);
    else if ((m = /^: (?:calls|bets|brings in for) (\D?[\d.]+)$/.exec(r))) put(n, cents(m[1]), allIn, l, false);
    else if ((m = /^: raises \D?[\d.]+ to (\D?[\d.]+)$/.exec(r))) put(n, cents(m[1]) - (street.get(n) || 0), allIn, l, false);
    else if ((m = /^ collected (\D?[\d.]+) from/.exec(r))) collected += cents(m[1]);
  }
  if (total !== inPot) errs.push(`total pot ${total} but ${inPot} went in`);
  if (collected !== total) errs.push(`collected ${collected} of a ${total} pot`);
  if (potParts.length && potParts.reduce((a, b) => a + b, 0) !== total) errs.push('main + side pots do not sum to the total');
  return errs;
}
test('C. chips are conserved and every flag is right, read from the text', () => {
  for (const f of OK) assert.deepEqual(account(write(f).text), [], f);
  // And the settlement's own sums.
  for (const f of OK) {
    const fx = load(f);
    const p = prepareHand(fx.hand, optsOf(fx));
    assert.equal(p.settle.lines.reduce((s, l) => s + l.amount, 0), p.settle.total, f + ' paid = pot');
    assert.equal(p.settle.pots.reduce((s, x) => s + x.amount, 0), p.settle.total, f + ' layers = pot');
  }
});

// ── D. Round trip ───────────────────────────────────────────────────────────
test('D. parse(write(h)) is the same hand, and write(parse(text)) the same text', () => {
  for (const f of OK) {
    const fx = load(f);
    const { text } = write(f);
    const r = parseHandHistory(text);
    assert.deepEqual(r.errors, [], f + ' parses cleanly');
    assert.equal(r.hands.length, 1);
    assert.deepEqual(canonicalHand(r.hands[0]), canonicalHand(prepareHand(fx.hand, optsOf(fx)).model), f + ' canonical');
    assert.equal(writePokerStarsHand(r.hands[0], {}).text, text, f + ' idempotent');
  }
  // Every golden, idempotent through the parser.
  for (const g of fs.readdirSync(GOLD).filter(x => x.endsWith('.txt'))) {
    const text = fs.readFileSync(path.join(GOLD, g), 'utf8').replace(/\n$/, '');
    const r = parseHandHistory(text);
    assert.equal(writePokerStarsHand(r.hands[0], {}).text, text, g);
  }
});
test('D. canonicalHand reads the verb from the chips and drops what the text cannot carry', () => {
  const fx = load('01-nlh-cash-3bet.json');
  const h = JSON.parse(JSON.stringify(fx.hand));
  h.title = 'A title'; h.notes = 'notes'; h.visuals = { felt: 'green' }; h.quickAdd = { positions: 'app' };
  h.streets[1].actions[1].action = 'raise';   // a bet into an unopened pot, recorded as a raise
  const c = canonicalHand(h);
  assert.equal(c.streets[1].actions[1].verb, 'bet');
  assert.deepEqual(canonicalHand(h), canonicalHand(fx.hand));
  const ai = canonicalHand(load('06-tourney-bb-ante-allin.json').hand).streets[0].actions.find(a => a.player === 3);
  assert.deepEqual([ai.verb, ai.allIn], ['raise', true], "'all-in' becomes its verb plus allIn");
  assert.ok(c.awards.every(a => Number.isInteger(a.playerIdx) && a.amount > 0));
});

// ── E. Determinism ──────────────────────────────────────────────────────────
test('E. the same input gives the same bytes; the hand id is content-only', () => {
  const fx = load('07-side-pots.json');
  const a = writePokerStarsHand(fx.hand, optsOf(fx)).text, b = writePokerStarsHand(JSON.parse(JSON.stringify(fx.hand)), optsOf(fx)).text;
  assert.equal(a, b);
  const id = handHistoryId(fx.hand);
  assert.match(id, /^8\d{15}$/);
  const dressed = JSON.parse(JSON.stringify(fx.hand));
  dressed.title = 'Three all-in'; dressed.notes = 'x'; dressed.visuals = { felt: 'red' };
  dressed.players.forEach((p, i) => { p.name = 'Renamed ' + i; });
  assert.equal(handHistoryId(dressed), id, 'title, notes, felt and names do not move it');
  const changed = JSON.parse(JSON.stringify(fx.hand));
  changed.streets[0].actions[3].amount = 5800;
  assert.notEqual(handHistoryId(changed), id, 'an action does');
  for (const f of OK) {
    if (!load(f).hand.import) assert.match(handHistoryId(load(f).hand), /^8\d{15}$/, f);
    assert.equal(write(f).handId, handHistoryId(load(f).hand), f + ': the writer stamps handHistoryId');
  }
  assert.equal(handHistoryId(load('35-imported-reuse.json').hand), '245893457123', 'an imported hand keeps its own');
  // The limb arithmetic is FNV-1a 64 itself (published vectors: "a", "foobar").
  assert.equal(fnv1a64('a').toString(16), 'af63dc4c8601ec8c');
  assert.equal(fnv1a64('foobar').toString(16), '85944171f73967e8');
  for (const s of ['', 'é€😀', JSON.stringify(load('07-side-pots.json'))]) assert.equal(fnv1a64(s), fnv1a64Reference(s));
  assert.match(handHistoryId(load('35-imported-reuse.json').hand, { site: 'Other Site' }), /^8\d{15}$/, 'unless written under another site name');
});
test('E. tournament ids: one per game per ET day', () => {
  const t = (iso, g) => tournamentIdFor(new Date(iso), g);
  assert.match(t('2026-10-13T12:00:00Z', 'NLH'), /^7\d{9}$/);
  assert.equal(t('2026-10-13T12:00:00Z', 'NLH'), t('2026-10-14T03:59:00Z', 'NLH'), 'same ET day (23:59 EDT)');
  assert.notEqual(t('2026-10-13T12:00:00Z', 'NLH'), t('2026-10-14T04:01:00Z', 'NLH'), 'the next ET day');
  assert.notEqual(t('2026-10-13T12:00:00Z', 'NLH'), t('2026-10-13T12:00:00Z', 'PLO'), 'another game');
  // A DST change: the ET wall clock on each side.
  const fx = load('02-walk.json');
  const at = (iso) => writePokerStarsHand(fx.hand, { playedAt: new Date(iso) }).lines[0].replace(/^.* - /, '');
  assert.equal(at('2026-03-08T06:59:59Z'), '2026/03/08 1:59:59 ET', 'EST before spring-forward');
  assert.equal(at('2026-03-08T07:00:00Z'), '2026/03/08 3:00:00 ET', 'EDT after');
  assert.equal(at('2026-11-01T06:30:00Z'), '2026/11/01 1:30:00 ET', 'EST after fall-back');
  assert.equal(at('2026-07-04T03:05:09Z'), '2026/07/03 23:05:09 ET', 'EDT; the day before in ET');
  assert.equal(at('2026-07-04T13:05:09Z'), '2026/07/04 9:05:09 ET', 'the hour unpadded');
});

// ── F. Errors ───────────────────────────────────────────────────────────────
test('F. every error fixture throws its code, with copy for the sheet and the tile', () => {
  assert.ok(ERR.length >= 15);
  for (const f of ERR) {
    const fx = load(f);
    assert.throws(() => writePokerStarsHand(fx.hand, optsOf(fx)), (e) => e instanceof HandExportError && e.code === fx.expectCode && !!e.message && !!e.short, f);
    const c = checkExportable(fx.hand);
    assert.equal(c.ok, false, f);
    assert.equal(c.code, fx.expectCode, f);
    assert.ok(c.short.length <= 40, f + ' short copy fits a tile: ' + c.short);
  }
});
test('F. a file skips what it cannot write, lists it, and writes the rest', () => {
  const entries = [...OK.slice(0, 3), ...ERR.slice(0, 2)].map(f => ({ hand: load(f).hand, playedAt: new Date('2026-10-13T10:00:00Z') }));
  const r = writePokerStarsFile(entries);
  assert.equal(r.written.length, 3);
  assert.deepEqual(r.skipped.map(s => s.index), [3, 4]);
  assert.ok(r.skipped.every(s => s.code && s.message && s.short));
  assert.equal(parseHandHistory(r.text).hands.length, 3);
});
test('F. checkExportable says whether PokerTracker 4 takes the game', () => {
  assert.deepEqual(checkExportable(load('14-plo.json').hand), { ok: true, pt4: true, gameName: 'Omaha Pot Limit', warnings: ['folded-cards-dropped'] });
  assert.equal(checkExportable(load('24-stud-hi.json').hand).pt4, false);
  assert.equal(checkExportable(load('28-27td.json').hand).pt4, false);
});

// ── G. File format ──────────────────────────────────────────────────────────
test('G. a file: BOM, CRLF, three blank lines after each hand, in time order', () => {
  const at = (h) => new Date(Date.UTC(2026, 9, 13, h));
  const entries = [
    { hand: load('03-heads-up.json').hand, playedAt: at(15) },
    { hand: load('01-nlh-cash-3bet.json').hand, playedAt: at(9) },
    { hand: load('24-stud-hi.json').hand, playedAt: at(12) },
  ];
  const { text, written } = writePokerStarsFile(entries);
  assert.ok(text.startsWith('﻿PokerStars Hand #'));
  assert.ok(!/[^\r]\n/.test(text), 'every line ends CRLF');
  assert.deepEqual(written.map(w => w.index), [1, 2, 0], 'sorted by playedAt');
  const hands = text.slice(1).split('\r\n\r\n\r\n\r\n');
  assert.equal(hands.length, 4);
  assert.equal(hands[3], '', 'the last hand is followed by three blank lines too');
  assert.ok(text.endsWith('\r\n\r\n\r\n\r\n') && !text.endsWith('\r\n\r\n\r\n\r\n\r\n'));
  const noBom = writePokerStarsFile(entries, { bom: false, eol: '\n' }).text;
  assert.ok(noBom.startsWith('PokerStars') && !noBom.includes('\r'));
  // A thousand hands, synchronously, in well under a second.
  const many = Array.from({ length: 1000 }, (_, i) => ({ hand: load(OK[i % 30]).hand, playedAt: at(i % 24) }));
  // The fastest of three runs, timed on this thread's CPU clock where Node has one: the box these
  // run on is often busy with other work, which stretches the wall clock but not the work.
  const clock = typeof process.threadCpuUsage === 'function'
    ? () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; }
    : () => performance.now();
  let ms = Infinity, wall = Infinity, r;
  for (let k = 0; k < 3; k++) {
    const c0 = clock(), t0 = performance.now();
    r = writePokerStarsFile(many);
    ms = Math.min(ms, clock() - c0); wall = Math.min(wall, performance.now() - t0);
  }
  assert.equal(r.written.length, 1000);
  assert.ok(ms < 1000, `1000 hands in ${Math.round(ms)} ms of CPU (${Math.round(wall)} ms wall)`);
});

// ── H. Registry ─────────────────────────────────────────────────────────────
const SNIP = {
  gameHeader: `PokerStars Game #27853262761:  Hold'em No Limit ($0.05/$0.10 USD) - 2009/05/08 19:36:12 ET
Table 'Kapteyn II' 6-max Seat #2 is the button
Seat 1: alpha ($10 in chips)
Seat 2: bravo ($4.65 in chips)
Seat 3: charlie ($10.20 in chips)
charlie: posts small blind $0.05
alpha: posts big blind $0.10
*** HOLE CARDS ***
Dealt to bravo [Ks Jd]
bravo: raises $0.20 to $0.30
charlie: folds
alpha: folds
Uncalled bet ($0.20) returned to bravo
bravo collected $0.25 from pot
bravo: doesn't show hand
*** SUMMARY ***
Total pot $0.25 | Rake $0
Seat 1: alpha (big blind) folded before Flop
Seat 2: bravo (button) collected ($0.25)
Seat 3: charlie (small blind) folded before Flop`,
  zoom: `PokerStars Zoom Hand #125693524031:  Hold'em No Limit ($0.02/$0.05) - 2014/11/02 9:14:31 ET
Table 'Halley' 6-max Seat #2 is the button
Seat 1: delta ($5 in chips)
Seat 2: echo ($5.12 in chips)
echo: posts small blind $0.02
delta: posts big blind $0.05
*** HOLE CARDS ***
Dealt to delta [9c 9d]
echo: folds
Uncalled bet ($0.03) returned to delta
delta collected $0.04 from pot
delta: doesn't show hand
*** SUMMARY ***
Total pot $0.04 | Rake $0
Seat 1: delta (big blind) collected ($0.04)
Seat 2: echo (button) (small blind) folded before Flop`,
  horse: `PokerStars Hand #91827364552: Tournament #612345678, $5+$0.50 USD HORSE (Razz Limit) - Level III (30/60) - 2013/01/20 21:02:11 ET
Table '612345678 4' 8-max
Seat 2: foxtrot (1480 in chips)
Seat 5: golf (1500 in chips)
foxtrot: posts the ante 5
golf: posts the ante 5
*** 3rd STREET ***
Dealt to foxtrot [3c 5d 7h]
Dealt to golf [Kd]
golf: brings in for 10
foxtrot: raises 20 to 30
golf: folds
Uncalled bet (20) returned to foxtrot
foxtrot collected 30 from pot
foxtrot: doesn't show hand
*** SUMMARY ***
Total pot 30 | Rake 0
Seat 2: foxtrot collected (30)
Seat 5: golf folded on the 3rd Street`,
};
test('H. detection: writer output and genuine headers; wsop-replay needs a sample; unknown text', () => {
  assert.equal(detectSite(write(OK[0]).text), 'pokerstars');
  assert.equal(detectSite('﻿\r\n' + write(OK[0]).text), 'pokerstars');
  for (const k of Object.keys(SNIP)) assert.equal(detectSite(SNIP[k]), 'pokerstars', k);
  assert.equal(detectSite(write('02-walk.json').text.replace('Tournament', 'Tournament')), 'pokerstars', 'freeroll');
  assert.equal(detectSite('Hello there'), null);
  assert.deepEqual(PARSERS.map(p => p.id), ['pokerstars', 'wsop-replay']);
  assert.equal(getParser('wsop-replay').detect(write(OK[0]).text), false, 'nothing routes to the placeholder');
  assert.throws(() => parseHandHistory(write(OK[0]).text, { site: 'wsop-replay' }), (e) => e instanceof HandHistoryError && e.code === 'needs-sample' && /needs a sample/.test(e.message));
  assert.throws(() => parseHandHistory('not a hand history'), (e) => e instanceof HandHistoryError && e.code === 'unknown-format');
});
test('H. one bad hand in a file does not stop the others', () => {
  const good = write(OK[0]).text, good2 = write(OK[1]).text;
  const bad = good2.replace(/: folds/, ': juggles');
  const r = parseHandHistory([good, bad, good].join('\n\n\n'));
  assert.equal(r.hands.length, 2);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].index, 1);
  assert.equal(r.errors[0].code, 'malformed');
  assert.match(r.errors[0].excerpt, /juggles/);
  assert.match(r.errors[0].handId, /^\d+$/);
});

// ── I. The parser on genuine constructs (hand-written snippets) ───────────────
const parseOne = (t) => { const r = parseHandHistory(t); assert.deepEqual(r.errors, []); return r.hands[0]; };
test('I. the two-space cash header, an old "Game #", Zoom, chat and table chatter', () => {
  const h = parseOne(SNIP.gameHeader.replace('bravo: raises', 'charlie said, "nh"\nbravo: raises').replace('*** SUMMARY', 'alpha leaves the table\n*** SUMMARY'));
  assert.equal(h.gameMode, 'cash'); assert.equal(h.currency, 'USD');
  assert.deepEqual(h.players.map(p => [p.name, p.position, p.startingStack]), [['bravo', 'BTN', 4.65], ['charlie', 'SB', 10.2], ['alpha', 'BB', 10]]);
  assert.deepEqual(h.import.seatNumbers, [2, 3, 1]);
  assert.equal(h.import.handId, '27853262761');
  assert.equal(h.import.playedAt, '2009-05-08T23:36:12.000Z');
  const z = parseOne(SNIP.zoom);
  assert.deepEqual(z.players.map(p => p.position), ['BTN/SB', 'BB']);
  assert.equal(z.players[0].name, 'echo');
});
test('I. per-player antes (pre-2018 tournaments) become one big-blind ante, stacks exact', () => {
  const t = `PokerStars Hand #70011122233: Tournament #40012345, $3+$0.30 USD Hold'em No Limit - Level V (50/100) - 2011/12/01 20:10:00 ET
Table '40012345 2' 9-max Seat #1 is the button
Seat 1: hotel (2000 in chips)
Seat 2: india (1500 in chips)
Seat 3: juliet (3000 in chips)
Seat 4: kilo (800 in chips)
hotel: posts the ante 10
india: posts the ante 10
juliet: posts the ante 10
kilo: posts the ante 10
india: posts small blind 50
juliet: posts big blind 100
*** HOLE CARDS ***
Dealt to kilo [Ah Qh]
kilo: raises 690 to 790 and is all-in
hotel: folds
india: folds
juliet: calls 690
*** FLOP *** [Qc 7d 2s]
*** TURN *** [Qc 7d 2s] [9h]
*** RIVER *** [Qc 7d 2s 9h] [4c]
*** SHOW DOWN ***
juliet: shows [Js Jc] (a pair of Jacks)
kilo: shows [Ah Qh] (a pair of Queens)
kilo collected 1670 from pot
*** SUMMARY ***
Total pot 1670 | Rake 0
Board [Qc 7d 2s 9h 4c]
Seat 1: hotel (button) folded before Flop (didn't bet)
Seat 2: india (small blind) folded before Flop
Seat 3: juliet (big blind) showed [Js Jc] and lost with a pair of Jacks
Seat 4: kilo showed [Ah Qh] and won (1670) with a pair of Queens`;
  const h = parseOne(t);
  assert.equal(h.blinds.ante, 40);
  // Order: kilo (UTG, seat 4), hotel (BTN), india (SB), juliet (BB, posts the 40).
  assert.deepEqual(h.players.map(p => [p.name, p.startingStack]), [['kilo', 790], ['hotel', 1990], ['india', 1490], ['juliet', 3030]]);
  assert.match(h.import.notes.join(' '), /big-blind ante of 40/);
  assert.deepEqual(h.result.winners.map(w => w.playerIdx), [0]);
});
test('I. a sitting-out player with no summary line is not dealt in', () => {
  const t = SNIP.gameHeader.replace('Seat 3: charlie ($10.20 in chips)', 'Seat 3: charlie ($10.20 in chips)\nSeat 4: lima ($3 in chips) is sitting out').replace('*** HOLE CARDS ***', 'lima: is sitting out\n*** HOLE CARDS ***');
  const h = parseOne(t);
  assert.equal(h.players.length, 3);
  assert.ok(!h.players.some(p => p.name === 'lima'));
});
test('I. side pots and the hi/lo double collect (one line per half)', () => {
  const h = parseOne(write('07-side-pots.json').text);
  assert.deepEqual(h.result.winners.map(w => w.playerIdx), [0, 1, 3]);
  const q = parseOne(`PokerStars Hand #81234567890:  Omaha Hi/Lo Pot Limit ($1/$2 USD) - 2012/03/04 22:00:00 ET
Table 'Ross IV' 6-max Seat #1 is the button
Seat 1: mike ($200 in chips)
Seat 2: nova ($200 in chips)
Seat 3: oscar ($200 in chips)
nova: posts small blind $1
oscar: posts big blind $2
*** HOLE CARDS ***
Dealt to mike [As 2s Kd Kc]
mike: raises $4 to $6
nova: folds
oscar: calls $4
*** FLOP *** [3s 4s 8h]
oscar: checks
mike: bets $13
oscar: calls $13
*** TURN *** [3s 4s 8h] [Ks]
oscar: checks
mike: checks
*** RIVER *** [3s 4s 8h Ks] [Qd]
oscar: checks
mike: checks
*** SHOW DOWN ***
oscar: shows [Ad 2h 9c 9d] (HI: a pair of Nines; LO: 8,4,3,2,A)
mike: shows [As 2s Kd Kc] (HI: a flush, Ace high; LO: 8,4,3,2,A)
mike collected $19.50 from pot
oscar collected $9.75 from pot
mike collected $9.75 from pot
*** SUMMARY ***
Total pot $39 | Rake $0
Board [3s 4s 8h Ks Qd]
Seat 1: mike (button) showed [As 2s Kd Kc] and won ($29.25) with HI: a flush, Ace high; LO: 8,4,3,2,A
Seat 2: nova (small blind) folded before Flop
Seat 3: oscar (big blind) showed [Ad 2h 9c 9d] and won ($9.75) with HI: a pair of Nines; LO: 8,4,3,2,A`);
  assert.deepEqual(q.result.winners.map(w => [w.playerIdx, w.hi, w.lo]), [[0, true, true], [2, false, true]]);
});
test('I. stud: dealt cards by street, the shown hand back into the replayer layout', () => {
  const h = parseOne(write('24-stud-hi.json').text);
  assert.equal(h.streets[0].cards.opponents[0], 'ThTc4c3d', 'h7 h2 h1 door on 3rd street');
  assert.deepEqual(h.streets.slice(1, 4).map(s => s.cards.opponents[0]), ['5h', '6s', 'Jc']);
  assert.equal(h.streets[4].cards.hero, '9s');
  assert.equal(h.blinds.bringIn, 0.25);
});
test('I. triple draw, and single draw whose discards have no header', () => {
  const td = parseOne(write('28-27td.json').text);
  assert.deepEqual(td.streets[0].draws, [{ player: 2, discarded: 2 }, { player: 0, discarded: 2, discardedCards: 'KsQs', newCards: '8d3c' }]);
  const sd = parseOne(write('30-nl27sd.json').text);
  assert.equal(sd.streets[0].draws.length, 2, 'the discards belong to the round before them');
  assert.deepEqual(sd.streets[1].actions.map(a => a.action), ['check', 'bet', 'call']);
});
test('I. each unsupported construct skips its hand with its code', () => {
  const base = SNIP.gameHeader;
  const cases = [
    ['run it twice', base.replace('*** SUMMARY ***', '*** FIRST FLOP *** [2c 3c 4c]\n*** SUMMARY ***'), 'unsupported-feature'],
    ['small & big blinds', base.replace('*** HOLE CARDS ***', 'bravo: posts small & big blinds $0.15\n*** HOLE CARDS ***'), 'unsupported-feature'],
    ['button blind', base.replace('*** HOLE CARDS ***', 'bravo: posts button blind $0.10\n*** HOLE CARDS ***'), 'unsupported-feature'],
    ['cash out', base.replace('bravo collected $0.25 from pot', 'bravo cashed out the hand for $0.25'), 'unsupported-feature'],
    ['cancelled', base + '\nHand cancelled', 'unsupported-feature'],
    ['Courchevel', base.replace("Hold'em No Limit", 'Courchevel Pot Limit'), 'unsupported-feature'],
    ['6+ Hold\'em', base.replace("Hold'em No Limit", "6+ Hold'em No Limit"), 'unsupported-feature'],
    ['NL Omaha', base.replace("Hold'em No Limit", 'Omaha No Limit'), 'unsupported-feature'],
    ['5 card draw NL', base.replace("Hold'em No Limit", '5 Card Draw No Limit'), 'unsupported-feature'],
    ['5 card draw limit', base.replace("Hold'em No Limit", '5 Card Draw Limit'), 'unsupported-feature'],
    ['play money', base.replace('($0.05/$0.10 USD)', '(5/10)'), 'unsupported-currency'],
    ['unknown verb', base.replace('charlie: folds', 'charlie: juggles'), 'malformed'],
    ['inconsistent pot', base.replace('Total pot $0.25', 'Total pot $0.35'), 'inconsistent'],
  ];
  for (const [what, text, code] of cases) {
    const r = parseHandHistory(text);
    assert.equal(r.hands.length, 0, what);
    assert.equal(r.errors[0] && r.errors[0].code, code, what + ': ' + JSON.stringify(r.errors[0]));
  }
});

// ── J. The gaps engine ──────────────────────────────────────────────────────
test('J. every parsed hand replays in the app: no blocking gap', () => {
  for (const f of OK) {
    const h = parseHandHistory(write(f).text).hands[0];
    const blocking = findGaps(h).filter(g => g.blocking);
    assert.deepEqual(blocking.map(g => g.id + ': ' + g.question), [], f);
  }
});

// ── fast-high.js: the same scores as poker-engine.js ────────────────────────
test('fast-high gives poker-engine\'s exact scores (20,000 random high and Omaha hands)', () => {
  const deck = []; for (const r of '23456789TJQKA') for (const s of 'hdcs') deck.push({ rank: r, suit: s });
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const draw = (k) => { const d = deck.slice(), out = []; for (let i = 0; i < k; i++) out.push(d.splice(Math.floor(rnd() * d.length), 1)[0]); return out; };
  let bad = 0;
  for (let t = 0; t < 10000; t++) { const c = draw(5 + (t % 3)); if (fastBestHigh(c).score !== bestHighHand(c).score) bad++; }
  for (let t = 0; t < 10000; t++) { const k = 4 + (t % 3), c = draw(k + 5); if (fastBestOmahaHigh(c.slice(0, k), c.slice(k)).score !== bestOmahaHigh(c.slice(0, k), c.slice(k)).score) bad++; }
  // Every category, by construction: a royal, a wheel straight flush, quads, a boat, a flush, a wheel.
  const H = (s) => s.match(/../g).map(x => ({ rank: x[0], suit: x[1] }));
  for (const s of ['AsKsQsJsTs', '5h4h3h2hAh', '9c9d9h9s2c', 'KcKdKh2s2c', 'Ad9d7d4d2d', 'As2d3h4c5s', 'QsQdJh4c4s', '7s7d9hKcAs', 'Ks9d7h4c2s']) {
    if (fastBestHigh(H(s)).score !== bestHighHand(H(s)).score) bad++;
  }
  assert.equal(bad, 0);
});

// ── PLO5 / PLO6 config ──────────────────────────────────────────────────────
test('PLO5 and PLO6 are replayer games (HAND_CONFIG) of five and six cards', () => {
  assert.equal(QA_HAND_CONFIG.PLO5.heroCards, 5);
  assert.equal(QA_HAND_CONFIG.PLO6.heroCards, 6);
  assert.equal(QA_HAND_CONFIG.PLO5.betting, 'pl');
  assert.equal(writePokerStarsHand(load('15b-plo-five-cards.json').hand, optsOf(load('15b-plo-five-cards.json'))).lines[0].includes('5 Card Omaha Pot Limit'), true);
  const r = parseHandHistory(write('16-plo6.json').text);
  assert.equal(r.hands[0].gameType, 'PLO6');
});
