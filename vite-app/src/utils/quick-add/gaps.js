// STUB for part C development — replaced by part A's real engine at merge.
//
// Implements the two exports of docs/quick-add-contract.md with just enough
// rules (game, hero cards, stacks, plus one non-blocking question) for the
// Quick Add screen to be built and tested against. It is not the validator.

const GAME_OPTIONS = ['NLH', 'PLO', 'LHE', 'Stud Hi', '2-7 TD'];

function setPath(obj, path, value) {
  const keys = path.split('.');
  const root = Array.isArray(obj) ? [...obj] : { ...(obj || {}) };
  let node = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const nextIsIndex = /^\d+$/.test(keys[i + 1]);
    const child = node[k];
    node[k] = Array.isArray(child) ? [...child] : (child && typeof child === 'object') ? { ...child } : (nextIsIndex ? [] : {});
    node = node[k];
  }
  node[keys[keys.length - 1]] = value;
  return root;
}

export function findGaps(hand) {
  const gaps = [];
  if (!hand) return gaps;
  if (!hand.gameType) {
    gaps.push({
      id: 'game', kind: 'missing', field: 'gameType',
      question: 'What game was it?',
      options: GAME_OPTIONS.map(g => ({ label: g, value: g })),
      allowFree: true, blocking: true,
    });
  }
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  const hero = hand.streets?.[0]?.cards?.hero;
  if (!hero) {
    gaps.push({
      id: 'hero-cards', kind: 'missing', field: 'streets.0.cards.hero',
      question: 'What were your cards?',
      allowFree: true, blocking: true,
    });
  }
  const bb = Number(hand.blinds?.bb) || 0;
  (hand.players || []).forEach((p, i) => {
    if (p && Number(p.startingStack) > 0) return;
    const who = i === heroIdx ? 'you' : (p?.name || 'Seat ' + (i + 1));
    gaps.push({
      id: 'stack:' + i, kind: 'missing', field: 'players.' + i + '.startingStack',
      question: i === heroIdx ? 'How deep were you?' : 'How deep was ' + who + '?',
      options: bb ? [100, 50, 25].map(n => ({ label: n + ' BB', value: n * bb })) : undefined,
      allowFree: true, blocking: true,
    });
  });
  if (!hand.gameMode) {
    gaps.push({
      id: 'mode', kind: 'missing', field: 'gameMode',
      question: 'Tournament or cash game?',
      options: [{ label: 'Tournament', value: 'mtt' }, { label: 'Cash', value: 'cash' }],
      allowFree: false, blocking: false,
    });
  }
  return gaps;
}

export function applyAnswer(hand, gap, value) {
  if (!gap || !gap.field) return hand;
  return setPath(hand, gap.field, value);
}
