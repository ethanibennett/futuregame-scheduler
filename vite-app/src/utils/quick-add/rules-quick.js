// ── Quick-add: what only the parse knew ───────────────────────────────────
// The server's normaliser (lib/quick-add/normalize.js) reads things off the
// description that no rule over the hand can see: that it was not a hand at
// all, that the post told other hands too, that it used a format the replayer
// cannot store, and readings the text gave two ways. It leaves them in
// hand.quickAdd (2026-10-14):
//   notRecordable  true | "why"      — not one recordable hand
//   otherHands     ["summary", …]    — hands the post also told, not recorded
//   unsupported    ["what", …]       — bomb pot, double board, PLO5 …
//   questions      [gap-like, …]     — ready-made questions: a card or size said
//                                      two ways, a four-card flop in a transcript,
//                                      a stated pot the actions miss, a suit
//                                      texture the cards break, seats a group
//                                      action was given to
// A question with `unless` (a field path) is dropped once that field is filled
// some other way. Its options carry { op: 'answerQuestion', id, sets } or
// { op: 'dismiss' }.

import { STAGE, makeGap } from './common.js';
import { getPath } from './edit.js';

const isFilled = (v) => !(v == null || v === '' || (Array.isArray(v) && !v.length));

function stageFor(field) {
  const m = /^streets\.(\d+)\.(cards\.board|cards\.hero|cards\.opponents\.\d+|actions)/.exec(field || '');
  if (!m) return [STAGE.cards, 0];
  const si = Number(m[1]);
  if (m[2] === 'cards.board') return [STAGE.board, si, -1];
  if (m[2] === 'cards.hero') return [STAGE.heroCards, si];
  if (m[2] === 'actions') return [STAGE.actions, si, 999];
  return [STAGE.cards, si];
}

export function quickRules(hand, out, dismissed) {
  const qa = hand && hand.quickAdd && typeof hand.quickAdd === 'object' ? hand.quickAdd : null;
  if (!qa) return;
  if (qa.notRecordable) {
    const why = typeof qa.notRecordable === 'string' ? qa.notRecordable : '';
    out.push(makeGap({
      id: 'scope', kind: 'impossible', field: 'quickAdd.notRecordable',
      question: 'This doesn’t read as one hand that can be recorded' + (why ? ' (' + why.replace(/[.\s]+$/, '') + ')' : '') + '. Record what is there anyway?',
      options: [{ label: 'Record it anyway', value: { op: 'set', path: 'quickAdd.notRecordable', value: null } }],
      allowFree: true, blocking: true,
    }, [STAGE.game, -1]));
  }
  if (Array.isArray(qa.otherHands) && qa.otherHands.length && !dismissed.has('hand-choice')) {
    const n = qa.otherHands.length + 1;
    out.push(makeGap({
      id: 'hand-choice', kind: 'ambiguous', field: 'quickAdd.otherHands',
      question: 'This tells ' + n + ' hands; the one in most detail is recorded. The others: ' + qa.otherHands.join('; ') + '.',
      options: [{ label: 'Record this one', value: { op: 'dismiss' } }],
      allowFree: true, blocking: false,
    }, [STAGE.structure, 5]));
  }
  if (Array.isArray(qa.unsupported) && qa.unsupported.length && !dismissed.has('unsupported')) {
    out.push(makeGap({
      id: 'unsupported', kind: 'impossible', field: 'quickAdd.unsupported',
      question: 'The replayer can’t store ' + qa.unsupported.join('; ') + '. The rest of the hand is recorded as told.',
      options: [{ label: 'OK', value: { op: 'dismiss' } }],
      allowFree: false, blocking: false,
    }, [STAGE.structure, 6]));
  }
  for (const q of Array.isArray(qa.questions) ? qa.questions : []) {
    if (!q || typeof q.id !== 'string' || typeof q.question !== 'string') continue;
    if (q.unless && isFilled(getPath(hand, q.unless))) continue;
    if (!q.blocking && dismissed.has(q.id)) continue;
    out.push(makeGap({
      id: q.id, kind: ['missing', 'ambiguous', 'impossible'].includes(q.kind) ? q.kind : 'ambiguous',
      field: typeof q.field === 'string' ? q.field : 'quickAdd.questions',
      question: q.question,
      options: Array.isArray(q.options) ? q.options.filter(o => o && typeof o.label === 'string' && o.value && typeof o.value.op === 'string') : [],
      allowFree: q.allowFree !== false, blocking: !!q.blocking,
    }, stageFor(q.field)));
  }
}
