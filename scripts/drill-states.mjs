// Stages the replayer drill for the guards, with canned answers from the trainer routes, so the views
// are the same every run and need no solver (the guards' servers stub it). The real thing is covered
// by test/replayer-drill.test.js and scripts/drive-replayer-drill.mjs.
//   await stageDrill(p, 'setup' | 'bet' | 'draw' | 'over' | 'review')
const bet = (seat, street, actionId, label) => ({ seat, street, phase: 'bet', actionId, label });
const draw = (seat, street, actionId, label) => ({ seat, street, phase: 'draw', actionId, label });

const HAND = ['Kh', 'Ts', '9d', '4c', '2h'];
const LOG_BET = [bet(0, 0, 'c', 'Call 1'), bet(1, 0, 'b', 'Raise to 4'), bet(0, 0, 'c', 'Call 2'), draw(1, 0, 'd2', 'Draw 2')];
const LOG_AFTER = [...LOG_BET, draw(0, 0, 'd:Kh', 'Draw 1'), bet(1, 1, 'k', 'Check')];
const LOG_END = [...LOG_AFTER, bet(0, 1, 'f', 'Fold')];

const grade = (over) => ({
  street: 0, phase: 'bet', kind: 'bet', heroActionId: 'c', heroActionLabel: 'Call 2', explicitDiscard: false,
  gtoMix: { actions: ['f', 'c', 'r'], labels: ['Fold', 'Call 2', 'Raise to 6'], probs: [0.05, 0.6, 0.35] },
  perActionEV: { f: -2, c: 1.4, r: 1.1 }, bestActionId: 'c', bestActionLabel: 'Call 2',
  evLoss: 0, evLossSE: 0.3, rangeDegraded: false, confidence: 'high', forwardMode: 'mc-forward', ...over,
});
const GRADES = [
  grade({ heroActionId: 'c', heroActionLabel: 'Call 1' }),
  grade({}),
  // A discard that beat everything the drill prices: "optimal", with the caveat under it.
  grade({
    phase: 'draw', kind: 'draw', heroActionId: 'd:Kh', heroActionLabel: 'Draw 1 (discard Kh)', explicitDiscard: true, heroDrawCount: 1,
    offBookCount: true, discardNote: 'non-standard keep / off-book count, EV is an estimate',
    gtoMix: { actions: ['d0', 'd2'], labels: ['Stand Pat', 'Draw 2'], probs: [0.1, 0.9] },
    perActionEV: { d0: -3, d2: 1, 'd:Kh': 2.5 }, bestActionId: 'd2', bestActionLabel: 'Draw 2', evLoss: 0, confidence: 'low', rangeDegraded: true,
  }),
  grade({ street: 1, heroActionId: 'f', heroActionLabel: 'Fold', evLoss: 3.4, perActionEV: { f: -6, c: -2.6 }, bestActionId: 'c', bestActionLabel: 'Call 2' }),
];

const row = (action, tied, diff) => ({ action, ev: 1 + diff, evBB: (1 + diff) / 4, sd: 2, se: 0.7, seIsLowerBound: true, diff, tied, offered: false });
const STUDY = {
  ok: true, game: 'td27', street: 0, phase: 'draw', heroAction: 'd:Kh', warnings: [],
  table: {
    street: 0, phase: 'draw', nRows: 32, bandWidth: 5, wide: true, offeredActions: ['d:', 'd:9dKhTs'],
    rows: [row('d:Kh', true, 0), row('d:KhTs', true, -0.2), row('d:9dKhTs', true, -0.4), row('d:4cKh', true, -0.5), row('d:2hKh', true, -0.6), row('d:', false, -4.5)],
  },
  trust: { level: 'monte-carlo-uncertified' },
};

function answer(actions) {
  const base = { game: 'td27', pot: 3, heroCards: HAND, myLastDiscards: [], oppDrawCounts: [], toAct: 0 };
  if (actions.length === 0) {
    return { state: { ...base, street: 0, phase: 'bet', log: [] }, legalActions: [{ id: 'f', label: 'Fold' }, { id: 'c', label: 'Call 1' }, { id: 'r', label: 'Raise to 4' }], drawDecision: null, handOver: false };
  }
  if (actions.length === 1) {
    return { state: { ...base, street: 0, phase: 'draw', pot: 8, oppDrawCounts: [2], log: LOG_BET }, legalActions: [{ id: 'd0', label: 'Stand Pat' }, { id: 'd2', label: 'Draw 2' }], drawDecision: { isDraw: true, heroCards: HAND, handSize: 5 }, handOver: false };
  }
  const drawn = ['Ts', '9d', '4c', '2h', '7s'];
  if (actions.length === 2) {
    return { state: { ...base, street: 1, phase: 'bet', pot: 8, heroCards: drawn, oppDrawCounts: [2], log: LOG_AFTER }, legalActions: [{ id: 'f', label: 'Fold' }, { id: 'k', label: 'Check' }, { id: 'b', label: 'Bet 2' }], drawDecision: null, handOver: false };
  }
  return {
    state: { ...base, street: 1, phase: 'bet', pot: 8, heroCards: drawn, oppDrawCounts: [2], log: LOG_END },
    legalActions: null, handOver: true,
    result: { heroDelta: -4, winner: 'opp', endType: 'fold', showdown: null },
    grades: GRADES,
  };
}

async function routeDrill(p) {
  await p.route('**/api/solver/trainer/td27/**', async (route) => {
    const url = route.request().url();
    let body = {};
    try { body = route.request().postDataJSON() || {}; } catch { /* no body */ }
    let json = { ok: true };
    if (/\/deal$/.test(url)) json = { seed: 8, heroSeat: 0, game: 'td27', state: answer([]).state };
    else if (/\/step$/.test(url)) json = answer(body.heroActions || []);
    else if (/\/study-draw$/.test(url)) json = STUDY;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  });
}

// From the Hands tab's list, with `force` for the guards' overlay runs.
export async function stageDrill(p, stage, { force = false } = {}) {
  await routeDrill(p);
  const click = (loc) => loc.first().click({ timeout: 8000, force });
  const live = () => p.waitForFunction(() => [...document.querySelectorAll('.rd-bar button')].some((b) => !b.disabled), null, { timeout: 15000 });
  await click(p.getByRole('button', { name: 'Play a hand', exact: true }));
  await p.waitForTimeout(600);
  if (stage === 'setup') return;
  await click(p.locator('.rd-setup').getByRole('button', { name: '2-7 TD', exact: true }));
  await live();
  await p.waitForTimeout(500);
  if (stage === 'bet') return;
  await click(p.locator('.rd-bar button.rd-act').nth(1));
  await p.waitForTimeout(300);
  await live();
  await p.waitForTimeout(800);
  if (stage === 'draw') {
    await click(p.locator('.replayer-seat.is-hero .card-tap').last());
    await p.waitForTimeout(300);
    return;
  }
  await click(p.locator('.replayer-seat.is-hero .card-tap').last());
  await click(p.locator('.rd-bar button.rd-primary'));
  await p.waitForTimeout(300);
  await live();
  await p.waitForTimeout(800);
  await click(p.locator('.rd-bar button.rd-act').first()); // fold: the hand ends
  await p.getByRole('button', { name: 'Grades', exact: true }).waitFor({ timeout: 15000 });
  await p.locator('button.replayer-play-btn:not(.is-playing)').waitFor({ timeout: 30000 });
  await p.waitForTimeout(900);
  if (stage === 'over') return;
  await click(p.getByRole('button', { name: 'Grades', exact: true }));
  await p.waitForTimeout(800);
}
