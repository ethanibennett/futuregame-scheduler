// The parse log's export (lib/quick-add/learn.js caseFromLog): a saved hand → a draft corpus case.
// Run: node test/quick-add/learn.test.js   (no API key, no server)
//
// The check is a round trip through the corpus itself: every complete case's oracle hand (eval.js
// buildOracleHand, the hand a perfect parse would give) is exported as a case, and that case must pass
// eval.js's own validator and score the hand it came from at 100%. That holds the seat names, the street
// keys, the amounts, stud's door-card refs and the draws to the format the eval reads.
'use strict';
const assert = require('assert');
const path = require('path');
const E = require('./eval');
const learn = require('../../lib/quick-add/learn');

(async () => {
  await E.loadHandConfig();
  // Seat names are eval.js semanticIndex's inverse at every table size.
  for (let n = 2; n <= 10; n++) {
    for (let i = 0; i < n; i++) {
      const name = learn.seatName(i, n);
      assert.ok(name, `seat ${i} of ${n} has a name`);
      assert.strictEqual(E.semanticIndex(name, n), i, `${name} at ${n}-handed is seat ${i}`);
    }
  }

  const { cases } = E.loadCorpus(path.join(__dirname, 'corpus'));
  const seen = new Map();
  let tried = 0, perfect = 0;
  const bad = [];
  for (const c of cases) {
    const v = E.validateCase(c, seen);
    if (v.errors.length || !c.expect.actions) continue;
    const ex = c.expect;
    // A table the text never sized is laid out with only the named seats: no seat names to give back.
    if (v.cat !== 'stud' && !ex.players) continue;
    // What only the parse can tell, not the saved hand; and a saved hand always has its game.
    if (ex.recordable === false || ex.anteUnclear || ex.unsupported || ex.otherHands || !ex.gameType) continue;
    tried++;
    const hand = E.buildOracleHand(c, v);
    const { case: out, problems } = learn.caseFromLog({ id: 7, text: c.text, source: c.source, finalHand: hand, diff: [] });
    if (!out) { bad.push(`${c.id}: not exported: ${problems.join('; ')}`); continue; }
    // An incomplete case's hand has its unknowns (null amounts, deliberate flaws): its gaps and flaws go with it.
    if (c.expectGaps) out.expectGaps = c.expectGaps;
    if (c.flaws) out.flaws = c.flaws;
    const v2 = E.validateCase({ ...out, id: 'rt-' + c.id }, new Map());
    if (v2.errors.length) { bad.push(`${c.id}: invalid: ${v2.errors.slice(0, 3).join('; ')}`); continue; }
    const s = E.scoreCase(out, v2, hand);
    const h = s.hallucinations;
    if (s.ok === s.expected && !s.wrong && !s.extraActions && !h.cards.length && !h.stacks.length && !h.actions) perfect++;
    else bad.push(`${c.id}: ${s.facts.filter((f) => f.status !== 'ok').map((f) => `${f.key} exp ${JSON.stringify(f.expected)} got ${JSON.stringify(f.got)}`).slice(0, 4).join('; ')}`);
  }
  if (bad.length) console.log(bad.slice(0, 30).join('\n'));
  assert.ok(tried > 100, `round-tripped ${tried} cases`);
  assert.strictEqual(perfect, tried, `${tried - perfect} of ${tried} exported cases did not round-trip`);
  console.log(`learn.test.js - passed (${tried} corpus hands exported as cases and scored 100% against themselves)`);
})().catch((e) => { console.error(e); process.exit(1); });
