// The replayer drill (owner, 2026-11-03: "play through a hand like in the drill trainer, just using
// the replayer platform"). The trainer's routes deal and step the hand; this turns what they return
// into a hand the replayer can play, growing as the hand does, and words the two graders' answers.
// Pure, so it tests in Node: npm run test:replayer-drill.

export const DRILL_GAMES = [
  { id: 'td27', label: '2-7 TD', gameType: '2-7 TD', draw: true },
  { id: 'badugi', label: 'Badugi', gameType: 'Badugi', draw: true },
  { id: 'a5td', label: 'A-5 TD', gameType: 'A-5 TD', draw: true },
  { id: 'razz', label: 'Razz', gameType: 'Razz', draw: false },
  { id: 'stud8', label: 'Stud 8', gameType: 'Stud 8', draw: false },
];

export function drillGame(id) {
  return DRILL_GAMES.find((g) => g.id === id) || null;
}

const DRAW_STREETS = ['Pre-Draw', 'First Draw', 'Second Draw', 'Third Draw'];
const STUD_STREETS = ['3rd Street', '4th Street', '5th Street', '6th Street', '7th Street'];
const STACK = 500; // the trainer plays without stacks; a figure the betting cannot reach

// The engine's integer for a card, (rank-2)*4 + suit, ace high and suit order c<d<h<s, identical to
// engine/cards.js, so an explicit discard round-trips through the server's parser ('9s' -> 31).
const SUIT_ORDER = { c: 0, d: 1, h: 2, s: 3 };
const RANK_VAL = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
function cardInt(str) {
  const c = String(str || '');
  if (c.length < 2) return 0;
  const r = RANK_VAL[c[0].toUpperCase()] || 2;
  const s = SUIT_ORDER[c[1].toLowerCase()];
  return ((r - 2) * 4) + (s == null ? 0 : s);
}

// The hero's draw as the trainer's step routes take it (the drill here, and the Study tools' Hand
// trainer): 'd:' + the thrown cards sorted by that integer.
// encodeDiscard(['Kc', '9s']) -> 'd:9sKc'; encodeDiscard([]) -> 'd:' (stand pat).
export function encodeDiscard(thrown) {
  return 'd:' + thrown.slice().sort((a, b) => cardInt(a) - cardInt(b)).join('');
}

function cardsOf(str) {
  return String(str || '').match(/.{2}/g) || [];
}

// The server words every action ("Raise to 4", "Call 2"), so the sizes stay the engine's own. A raise's
// figure is the street total the raiser gets to; `actionsOn` turns that into the chips it adds, which
// is what the replayer means by an amount. `id` is the fallback for a label with no figure.
export function parseDrillAction(label, id) {
  const text = String(label || '');
  const figure = () => {
    const m = text.match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 0;
  };
  if (/^fold/i.test(text) || id === 'f') return { action: 'fold', amount: 0 };
  if (/^check/i.test(text) || id === 'k') return { action: 'check', amount: 0 };
  if (/^call/i.test(text) || id === 'c') return { action: 'call', amount: figure() };
  if (/^bring/i.test(text) || id === 'br') return { action: 'bring-in', amount: figure() };
  if (/^(raise|complete)/i.test(text) || id === 'r' || id === 'co') return { action: 'raise', amount: figure() };
  return { action: 'bet', amount: figure() };
}

// One more answer from the step route, folded in. `chosen` is the action the hero just took (absent
// on the first answer). Only the hero's draws need remembering: the state says what they hold now,
// and the difference from what they held is what they were dealt.
export function drillStep(prev, data, chosen) {
  const next = {
    game: prev.game,
    seed: prev.seed,
    heroSeat: prev.heroSeat,
    start: prev.start,
    pot0: prev.pot0,
    heroActions: chosen == null ? prev.heroActions : [...prev.heroActions, chosen],
    heroDraws: prev.heroDraws,
    state: data.state,
    legalActions: data.legalActions || null,
    drawDecision: data.drawDecision || null,
    handOver: !!data.handOver,
    result: data.result || null,
    grades: data.grades || null,
    rev: prev.rev + 1,
  };
  if (next.start == null && data.state && data.state.heroCards) next.start = data.state.heroCards.slice();
  // What was in before anyone acted. The first answer's pot can already hold a bring-in, and its log
  // says what. Stud's ante is half of this; a draw game's blinds are fixed.
  if (next.pot0 == null && data.state) {
    const acted = actionsOn(data.state.log, 0).reduce((sum, a) => sum + a.amount, 0);
    next.pot0 = data.state.pot - acted;
  }
  if (chosen != null && String(chosen).startsWith('d:') && prev.state && prev.state.heroCards) {
    const held = prev.state.heroCards;
    const now = data.state.heroCards || [];
    const thrown = cardsOf(String(chosen).slice(2));
    next.heroDraws = {
      ...prev.heroDraws,
      [prev.state.street]: {
        discarded: thrown.length,
        discardedCards: thrown.join(''),
        newCards: now.filter((c) => !held.includes(c)).join(''),
      },
    };
  }
  return next;
}

export function drillStart(game, deal) {
  return {
    game, seed: deal.seed, heroSeat: deal.heroSeat, start: null, pot0: null,
    heroActions: [], heroDraws: {}, state: null, legalActions: null, drawDecision: null,
    handOver: false, result: null, grades: null, rev: 0,
  };
}

function winnersOf(result, heroSeat) {
  if (!result) return null;
  const opp = 1 - heroSeat;
  if (result.winner === 'hero') return { winners: [{ playerIdx: heroSeat, split: false }] };
  if (result.winner === 'opp') return { winners: [{ playerIdx: opp, split: false }] };
  return { winners: [{ playerIdx: 0, split: true }, { playerIdx: 1, split: true }] };
}

// A street's actions in the replayer's terms: every amount is the chips that action adds, so a raise
// to 4 from a seat with 2 in is 2. `posted` is what each seat already has in (the blinds, preflop).
function actionsOn(log, street, posted = [0, 0]) {
  const inFront = posted.slice();
  return (log || [])
    .filter((l) => l.street === street && l.phase !== 'draw')
    .map((l) => {
      const a = parseDrillAction(l.label, l.actionId);
      const amount = a.action === 'raise' ? Math.max(0, a.amount - inFront[l.seat]) : a.amount;
      inFront[l.seat] += amount;
      return { player: l.seat, action: a.action, amount };
    });
}

function drawHand(d, heroName) {
  const { state, heroSeat } = d;
  const opp = 1 - heroSeat;
  const log = state.log || [];
  const shown = d.result && d.result.showdown && d.result.showdown.oppCards;
  const streets = [];
  for (let s = 0; s <= state.street; s++) {
    const draws = log
      .filter((l) => l.street === s && l.phase === 'draw')
      .map((l) => {
        if (l.seat === heroSeat) {
          const mine = d.heroDraws[s];
          return { player: heroSeat, discarded: mine ? mine.discarded : 0, discardedCards: mine ? mine.discardedCards : '', newCards: mine ? mine.newCards : '' };
        }
        // The opponent's draw is a count: their cards stay theirs until a showdown.
        const n = parseInt(String(l.actionId).slice(1), 10);
        return { player: opp, discarded: Number.isFinite(n) ? n : 0, discardedCards: '', newCards: '' };
      });
    streets.push({
      name: DRAW_STREETS[s] || ('Street ' + (s + 1)),
      cards: {
        hero: s === 0 ? (d.start || []).join('') : '',
        // An opponent's stored cards are their showdown hand, as the replayer reads them.
        opponents: [s === 0 && shown ? shown.join('') : ''],
        board: '',
      },
      actions: actionsOn(log, s, s === 0 ? [1, 2] : [0, 0]), // seat 0 posts the small blind
      draws,
    });
  }
  const players = [
    { name: heroSeat === 0 ? heroName : 'Solver', position: 'SB', startingStack: STACK },
    { name: heroSeat === 1 ? heroName : 'Solver', position: 'BB', startingStack: STACK },
  ];
  return {
    blinds: { sb: 1, bb: 2, bigBet: 4 },
    players, streets,
  };
}

function studHand(d, heroName) {
  const { state, heroSeat } = d;
  const log = state.log || [];
  const down = state.heroDown || [];
  const up = state.heroUp || [];
  const oppUp = state.oppUp || [];
  const shown = d.result && d.result.showdown && d.result.showdown.oppDown;
  const streets = [];
  for (let s = 0; s <= state.street; s++) {
    let hero;
    let oppCards;
    if (s === 0) {
      hero = (down[0] || '') + (down[1] || '') + (up[0] || '');
      oppCards = shown ? (shown[0] || '') + (shown[1] || '') + (oppUp[0] || '') : (oppUp[0] || '');
    } else if (s === 4) {
      hero = down[2] || '';
      oppCards = shown ? (shown[2] || '') : '';
    } else {
      hero = up[s] || '';
      oppCards = oppUp[s] || '';
    }
    streets.push({
      name: STUD_STREETS[s] || ('Street ' + (s + 1)),
      cards: { hero, opponents: [oppCards], board: '' },
      actions: actionsOn(log, s),
      draws: [],
    });
  }
  const players = [
    { name: heroSeat === 0 ? heroName : 'Solver', position: 'Seat 1', startingStack: STACK },
    { name: heroSeat === 1 ? heroName : 'Solver', position: 'Seat 2', startingStack: STACK },
  ];
  // The bring-in and the small bet read off the engine's own labels where they have appeared; the
  // ante is half the pot as dealt.
  const ante = (d.pot0 || 0) / 2;
  const seen = log.find((l) => l.actionId === 'br');
  const bringIn = seen ? parseDrillAction(seen.label, 'br').amount : ante * 2;
  return {
    blinds: { sb: 0, bb: bringIn * 2, bigBet: bringIn * 4, ante, bringIn },
    players, streets,
  };
}

// The hand so far, in the replayer's shape, or null before the first answer.
export function buildDrillHand(d, heroName = 'Hero') {
  if (!d || !d.state) return null;
  const game = drillGame(d.game);
  const body = game && game.draw ? drawHand(d, heroName) : studHand(d, heroName);
  const hand = {
    gameType: game ? game.gameType : d.game,
    gameMode: 'tournament', // the trainer plays for chips, so no currency on the table
    heroIdx: d.heroSeat,
    ...body,
  };
  const result = d.handOver ? winnersOf(d.result, d.heroSeat) : null;
  if (result) hand.result = result;
  return hand;
}

// What the opponent did at this draw, which the table only shows once the street changes.
export function opponentDrawNote(state) {
  const counts = (state && state.oppDrawCounts) || [];
  if (!state || state.phase !== 'draw' || counts.length <= state.street) return null;
  const n = counts[state.street];
  return n === 0 ? 'Solver stood pat' : `Solver drew ${n}`;
}

// The hero's draw inside `heroActions` for a grade at that street: the n-th of their log entries.
export function heroActionIndexForStreet(state, heroSeat, street) {
  const mine = ((state && state.log) || []).filter((l) => l.seat === heroSeat);
  return mine.findIndex((l) => l.phase === 'draw' && l.street === street);
}

export function discardWords(action) {
  const a = String(action || '');
  if (a === 'd:' || a === 'd0') return 'Stand pat';
  if (a.startsWith('d:')) return 'Throw ' + cardsOf(a.slice(2)).join(' ');
  return a;
}

// The study tool's answer for the hero's discard, in words. The band is the set the tool cannot
// separate at this much evidence; inside it there is no ranking to report, so it says so and shows
// no figure. `rows` carry `diff` against the band's reference.
export function studyVerdict(table, heroAction) {
  if (!table || !Array.isArray(table.rows)) return { kind: 'unpriced', headline: 'Not priced', detail: '' };
  const n = table.nRows || table.rows.length;
  const band = table.rows.filter((r) => r.tied);
  const width = table.bandWidth || band.length;
  const row = table.rows.find((r) => r.action === heroAction);
  const others = band.filter((r) => r.action !== heroAction).slice(0, 4).map((r) => discardWords(r.action));
  if (!row) {
    return { kind: 'unpriced', headline: 'Your discard was not priced', detail: `${n} options priced.`, band: others };
  }
  if (row.tied && width > 1) {
    return {
      kind: 'not-rankable',
      headline: 'Not rankable',
      detail: `Yours is one of ${width} of ${n} options the tool cannot separate at this much evidence, so their order is noise.`,
      band: others,
    };
  }
  if (row.tied) {
    return { kind: 'best', headline: 'Best of the priced options', detail: `Separated from the other ${n - 1}.`, band: [] };
  }
  const loss = Math.abs(row.diff || 0);
  return {
    kind: 'below',
    headline: `−${loss.toFixed(2)} chips`,
    detail: `Outside the ${width === 1 ? 'best option' : `${width} options it cannot separate`}, of ${n} priced. ±${(row.se || 0).toFixed(2)}${row.seIsLowerBound ? ' at least' : ''}.`,
    band: others,
  };
}

// The drill's loss floors at 0 and ranges over its own options only, so a discard that outscores all
// of them reads "optimal". True of what it priced, and not the claim the word makes on its own.
export function drillOptimalCaveat(grade) {
  if (!grade || grade.kind !== 'draw' || !grade.explicitDiscard) return null;
  if (!((+grade.evLoss || 0) <= 0.01)) return null;
  const ev = grade.perActionEV || {};
  const options = (grade.gtoMix && grade.gtoMix.actions) || [];
  const mine = ev[grade.heroActionId];
  const best = ev[grade.bestActionId];
  if (mine == null || best == null) return null;
  if (mine <= best + 0.01) return null;
  return `Your discard outscored all ${options.length} options the drill prices, and its loss cannot go below 0: "optimal" here means no worse than those, not best overall.`;
}

// Which tool answered a drill grade: the Pro-mode oracle's tag, else the blueprint.
export function drillGradeSource(grade) {
  const src = grade && grade.gradeSource;
  if (src === 'oracle') return 'exact re-solve';
  if (src === 'certified-net') return 'certified net';
  if (src === 'oracle-6th' || src === 'oracle-5th') return 'approximate re-solve';
  return 'blueprint';
}
