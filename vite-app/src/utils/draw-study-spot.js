// A saved draw hand -> the spot the Draw Study page prices: the replayer's "Study this draw". Pure.
//
// The spot is the hero's draw at the END of `streetIdx` (a street is its betting, then its draws), so
// the history runs through that street's betting, and through the opponent's draw when they drew first.
// What goes over:
//   hero   the STARTING hand: the tool replays the hand from the deal
//   hist   both seats in engine order, each token with its seat ("1:k 0:b 1:c 1:d2 0:d:KsQs")
//   drawn  the hero's real replacements in the order they came, which the server places in its deck, so
//          the priced hand is the one in the replay and not one the tool dealt itself
//
// The opponent goes over as COUNTS, even when their cards are known from a showdown. The hero did not
// know them when deciding, and a price that read them would be hindsight.
//
// `refused` says why a spot cannot be priced. A table for cards the hero did not hold would be a
// confident wrong answer, so anything unrecorded refuses rather than being guessed.

const ORDINAL = ['First', 'Second', 'Third'];
const BET_TOKEN = { fold: 'f', check: 'k', call: 'c' };

// 'KsQs' -> ['Ks', 'Qs'], or null if any card has no rank and suit.
function cardsOf(str) {
  const flat = String(str || '').replace(/\s+/g, '');
  if (!flat) return [];
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    const c = flat.slice(i, i + 2);
    if (!/^[2-9TJQKA][cdhs]$/i.test(c)) return null;
    out.push(c[0].toUpperCase() + c[1].toLowerCase());
  }
  return out;
}

const refuse = (refused) => ({ refused });

export function buildDrawStudySpot({ hand, game, streetIdx, heroIdx }) {
  const streets = hand.streets || [];
  if (streetIdx >= 3 || !streets[streetIdx]) {
    return refuse('No draw is left to price at the final betting round.');
  }
  const start = cardsOf(streets[0] && streets[0].cards && streets[0].cards.hero);
  const handSize = game === 'badugi' ? 4 : 5;
  if (!start || start.length !== handSize) {
    return refuse(`Your ${handSize} starting cards need ranks and suits before this draw can be priced.`);
  }

  // Who is in: a player who only folded, with no chips put in by choice, is dropped. Anyone else makes
  // the hand multiway, and the solver is heads-up: their chips and draws have no place in its history.
  const inHand = new Set();
  const folded = new Set();
  for (let si = 0; si <= streetIdx; si++) {
    for (const a of (streets[si] && streets[si].actions) || []) {
      if (a.action === 'fold') folded.add(a.player);
      else inHand.add(a.player);
    }
  }
  if (folded.has(heroIdx)) return refuse('You folded before this draw.');
  const others = [...inHand].filter((p) => p !== heroIdx);
  if (others.length > 1) {
    return refuse(`Draw study is heads-up, and ${others.length + 1} players had chips in by this draw.`);
  }
  const oppIdx = others[0];
  if (oppIdx === undefined || !inHand.has(heroIdx) || folded.has(oppIdx)) {
    return refuse('The hand ended before this draw.');
  }

  const pair = (a) => a.player === heroIdx || a.player === oppIdx;
  const first = ((streets[0] && streets[0].actions) || []).find(pair);
  // Seat 0 acts first before the draw; seat 1 is the big blind, who draws first.
  const heroSeat = first.player === heroIdx ? 0 : 1;
  const seatOf = (p) => (p === heroIdx ? heroSeat : 1 - heroSeat);
  const playerAt = (seat) => (seat === heroSeat ? heroIdx : oppIdx);

  const notes = [];
  const hist = [];
  const drawn = [];
  let now = start.slice();

  const blinds = hand.blinds || {};
  const postedBy = (p) => {
    const pos = hand.players && hand.players[p] && hand.players[p].position;
    if (pos === 'SB') return Number(blinds.sb) || 0;
    if (pos === 'BB') return Number(blinds.bb) || 0;
    return 0;
  };

  for (let si = 0; si <= streetIdx; si++) {
    const street = streets[si] || {};
    const actions = (street.actions || []).filter(pair);
    if (!actions.length) {
      if (si === 0) return refuse('No pre-draw betting is recorded.');
      hist.push('1:k', '0:k');
      notes.push(`No betting is recorded on the ${street.name || 'street ' + si}, so it was read as two checks.`);
    }

    // Pre-draw the big blind is already the first bet, so the first raise there is an 'r'.
    let facing = si === 0;
    const put = { [heroIdx]: si === 0 ? postedBy(heroIdx) : 0, [oppIdx]: si === 0 ? postedBy(oppIdx) : 0 };
    for (const a of actions) {
      const amount = Number(a.amount) || 0;
      let token = BET_TOKEN[a.action];
      if (a.action === 'bet' || a.action === 'raise') {
        token = facing ? 'r' : 'b';
        facing = true;
      } else if (a.action === 'all-in') {
        const toCall = Math.max(put[heroIdx], put[oppIdx]) - put[a.player];
        if (facing && amount <= toCall) token = 'c';
        else { token = facing ? 'r' : 'b'; facing = true; }
        notes.push('An all-in was read as a ' + (token === 'c' ? 'call' : 'raise') + ': the solver plays fixed limit, with no stacks.');
      }
      if (!token) return refuse(`This hand has a "${a.action}", which the solver's betting has no word for.`);
      put[a.player] += amount;
      hist.push(seatOf(a.player) + ':' + token);
    }

    // Seat 1 draws first. The hero's draw on this street is the open decision: nothing goes after it.
    const label = ORDINAL[si].toLowerCase() + ' draw';
    for (const seat of [1, 0]) {
      const p = playerAt(seat);
      if (si === streetIdx && p === heroIdx) break;
      const d = (street.draws || []).find((x) => x && x.player === p);
      if (!d) return refuse(`${p === heroIdx ? 'Your' : "The opponent's"} ${label} is not recorded.`);
      const n = Number(d.discarded) || 0;
      if (p !== heroIdx) { hist.push(seat + ':d' + n); continue; }
      if (!n) { hist.push(seat + ':d0'); continue; }
      const thrown = cardsOf(d.discardedCards);
      const fresh = cardsOf(d.newCards);
      if (!thrown || thrown.length !== n) return refuse(`The cards you threw on the ${label} are not recorded.`);
      if (!fresh || fresh.length !== n) return refuse(`The cards you drew on the ${label} are not recorded.`);
      if (thrown.some((c) => !now.includes(c))) return refuse(`The cards you threw on the ${label} are not in your hand.`);
      hist.push(seat + ':d:' + thrown.join(''));
      now = now.filter((c) => !thrown.includes(c)).concat(fresh);
      drawn.push(...fresh);
    }
  }

  const dropped = (hand.players || []).length - 2;
  if (dropped > 0) {
    notes.push(`${dropped === 1 ? '1 player' : dropped + ' players'} folded without putting chips in; any blind posted is not in the solver's pot.`);
  }

  return {
    game,
    hero: start.join(' '),
    seat: heroSeat,
    hist: hist.join(' '),
    drawn: drawn.join(' '),
    now: now.join(' '),
    street: streetIdx,
    notes,
    source: `${hand.gameType} hand, ${ORDINAL[streetIdx].toLowerCase()} draw`,
  };
}
