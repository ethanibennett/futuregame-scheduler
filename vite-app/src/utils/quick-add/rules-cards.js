// ── Quick-add: card rules ─────────────────────────────────────────────────
// Card counts for the game, card notation, and cards that appear twice. Which
// strings count is decided by what the replayer READS: a hold'em hand's hole
// cards on street 0 only, a stud hand's cards street by street, the board from
// every street (HandReplayerReplayView: heroCards / opponentCards / boardCards).

import { streetDef } from './game.js';
import { cardsOf, notationProblem, isMuck, backs, oppSlot, slotPlayer, knownKeys } from './cards.js';
import { STAGE, makeGap, playerName, streetName, listWords, dismissOption } from './common.js';

const BOARD_WORD = ['preflop board', 'flop', 'turn', 'river'];

function oppPath(si, slot) { return 'streets.' + si + '.cards.opponents.' + slot; }

/* Every card string in the hand, with where it is and whose it is. */
export function cardLocations(hand, env) {
  const locs = [];
  const heroIdx = hand.heroIdx;
  const n = hand.players.length;
  hand.streets.forEach((st, si) => {
    const sName = streetName(hand, si);
    const c = st.cards;
    locs.push({ path: 'streets.' + si + '.cards.hero', str: c.hero, kind: 'hero', player: heroIdx, si,
      label: env.isStud ? 'your ' + sName + ' card' + (si === 0 ? 's' : '') : 'your cards' });
    (c.opponents || []).forEach((o, slot) => {
      const pi = slotPlayer(slot, heroIdx);
      locs.push({ path: oppPath(si, slot), str: o, kind: 'opp', player: pi, si, slot,
        label: pi < n ? playerName(hand, pi) + (env.isStud ? '’s ' + sName + ' card' + (si === 0 ? 's' : '') : '’s cards') : 'an extra opponent slot' });
    });
    locs.push({ path: 'streets.' + si + '.cards.board', str: c.board, kind: 'board', si,
      label: env.category === 'community' ? 'the ' + (BOARD_WORD[si] || sName + ' board') : 'the ' + sName + ' board' });
    (st.draws || []).forEach((d, k) => {
      if (!d) return;
      const draw = 'the draw after the ' + sName;
      locs.push({ path: 'streets.' + si + '.draws.' + k + '.discardedCards', str: d.discardedCards, kind: 'discard', player: d.player, si, k,
        label: playerName(hand, d.player) + '’s discards on ' + draw });
      locs.push({ path: 'streets.' + si + '.draws.' + k + '.newCards', str: d.newCards, kind: 'new', player: d.player, si, k,
        label: playerName(hand, d.player) + '’s new cards on ' + draw });
    });
  });
  return locs;
}

/* How many cards a location should hold, where the game says (used to read
   unknown cards written as single x's or as xx pairs). */
function expectedCount(hand, env, loc) {
  if (loc.kind === 'board') return env.category === 'community' ? streetDef(hand.gameType).boardCards[loc.si] : undefined;
  if (loc.kind === 'hero') return env.isStud ? (loc.si === 0 ? 3 : 1) : (loc.si === 0 ? env.cfg.heroCards : undefined);
  if (loc.kind === 'opp') return env.isStud ? undefined : (loc.si === 0 ? env.cfg.heroCards : undefined);
  return undefined;
}

/* Is this location one the replayer reads as a dealt card? */
function isLiveLocation(loc, env) {
  if (loc.kind === 'hero' || loc.kind === 'opp') return env.isStud || loc.si === 0;
  if (loc.kind === 'board') return env.category === 'community';
  return false;
}

export function heroCardRules(hand, env, out) {
  if (env.category === 'ofc') return;
  const s = hand.streets[0].cards.hero;
  const field = 'streets.0.cards.hero';
  const expect = env.isStud ? 3 : env.cfg.heroCards;
  const key = [STAGE.heroCards, 0];
  const bad = notationProblem(s, expect);
  // Face-down cards stand for cards not known, so the suit question that would
  // follow them is answered in the same breath.
  const unknownAnswer = (value) => ({ op: 'batch', ops: [{ op: 'set', path: field, value }, { op: 'dismiss', id: 'cards:hero-suits' }] });
  if (bad && bad.unknown) {
    const have = bad.known.length;
    const filled = bad.known.join('') + backs(Math.max(0, expect - have));
    out.push(makeGap({
      id: 'cards:hero', kind: 'missing', field,
      question: have
        ? 'Only ' + have + ' of your ' + expect + ' cards ' + (have === 1 ? 'is' : 'are') + ' known (' + bad.known.join(' ') + '). What were the others?'
        : 'What were your cards?',
      options: [{ label: 'The rest are unknown', fallback: true, value: unknownAnswer(filled) }],
      allowFree: true, blocking: true,
    }, key));
    return;
  }
  if (bad) {
    out.push(makeGap({
      id: 'cards:hero', kind: 'impossible', field,
      question: 'Your cards "' + s + '" aren’t readable (' + bad.reason + '). What were they?',
      options: bad.guess ? [{ label: bad.guess, value: { op: 'set', path: field, value: bad.guess } }] : [],
      allowFree: true, blocking: true,
    }, key));
    return;
  }
  const k = cardsOf(s).length;
  if (k === expect) {
    // Ranks without suits ("aces", "AKo") replay, but as suitless cards.
    const suitless = cardsOf(s).filter(c => c.suit === 'x');
    if (suitless.length && !env.dismissed.has('cards:hero-suits')) {
      out.push(makeGap({
        id: 'cards:hero-suits', kind: 'missing', field,
        question: 'What suits were your cards? (' + cardsOf(s).map(c => c.rank + (c.suit === 'x' ? '?' : c.suit)).join(' ') + ')',
        options: [dismissOption('Suits don’t matter')], allowFree: true, blocking: false,
      }, [STAGE.heroCards, 1]));
    }
    return;
  }
  if (k === 0) {
    out.push(makeGap({
      id: 'cards:hero', kind: 'missing', field,
      question: env.isStud ? 'What were your 3rd street cards (two down, then the door card)?' : 'What were your cards?',
      options: [{ label: 'I don’t remember', fallback: true, value: unknownAnswer(backs(expect)) }],
      allowFree: true, blocking: true,
    }, key));
  } else if (k < expect) {
    out.push(makeGap({
      id: 'cards:hero', kind: 'missing', field,
      question: 'Only ' + k + ' of your ' + expect + (env.isStud ? ' 3rd street' : '') + ' cards ' + (k === 1 ? 'is' : 'are') + ' recorded. What were the others?',
      options: [{ label: 'The rest are unknown', fallback: true, value: unknownAnswer(cardsOf(s).map(c => c.rank + c.suit).join('') + backs(expect - k)) }],
      allowFree: true, blocking: true,
    }, key));
  } else {
    out.push(makeGap({
      id: 'cards:hero', kind: 'impossible', field,
      question: env.isStud
        ? 'You have ' + k + ' cards on 3rd street; stud deals 3 (two down, one up). Which were they?'
        : hand.gameType + ' deals ' + expect + ' cards, but ' + k + ' are recorded for you. Which were they?',
      allowFree: true, blocking: true,
    }, key));
  }
}

/* Notation everywhere else, cards in slots the replayer ignores, and cards
   that appear twice. */
export function cardRules(hand, env, out) {
  const locs = cardLocations(hand, env);
  const badPaths = new Set();
  locs.forEach((loc, li) => {
    if (loc.path === 'streets.0.cards.hero') return; // heroCardRules
    const bad = notationProblem(loc.str, expectedCount(hand, env, loc));
    if (!bad) return;
    badPaths.add(loc.path);
    if (bad.unknown) {
      out.push(makeGap({
        id: 'notation:' + loc.path, kind: 'missing', field: loc.path,
        question: bad.unknown + ' card' + (bad.unknown > 1 ? 's' : '') + ' in ' + loc.label + (bad.unknown > 1 ? ' are' : ' is') + ' not named' + (bad.known.length ? ' (known: ' + bad.known.join(' ') + ')' : '') + '. What ' + (bad.unknown > 1 ? 'were they' : 'was it') + '?',
        options: [{ label: 'Unknown (face down)', value: { op: 'set', path: loc.path, value: bad.guess } }],
        allowFree: true, blocking: true,
      }, [loc.kind === 'board' ? STAGE.board : STAGE.cards, loc.kind === 'board' ? loc.si : 0, li]));
      return;
    }
    out.push(makeGap({
      id: 'notation:' + loc.path, kind: 'impossible', field: loc.path,
      question: 'The cards "' + loc.str + '" for ' + loc.label + ' aren’t readable (' + bad.reason + '). What were they?',
      options: bad.guess ? [{ label: bad.guess, value: { op: 'set', path: loc.path, value: bad.guess } }] : [],
      allowFree: true, blocking: true,
    }, [STAGE.cards, 0, li]));
  });

  // Hole cards stored on a later street of a flop or draw game are never read.
  if (!env.isStud && env.category !== 'ofc') {
    locs.forEach((loc, li) => {
      if ((loc.kind !== 'hero' && loc.kind !== 'opp') || loc.si === 0 || !cardsOf(loc.str).length || badPaths.has(loc.path)) return;
      if (loc.kind === 'opp' && isMuck(loc.str)) return;
      const to = loc.kind === 'hero' ? 'streets.0.cards.hero' : oppPath(0, loc.slot);
      const there = hand.streets[0].cards[loc.kind === 'hero' ? 'hero' : 'opponents'];
      const target = loc.kind === 'hero' ? there : (there || [])[loc.slot];
      const empty = !cardsOf(target).length;
      out.push(makeGap({
        id: 'misplaced:' + loc.path, kind: 'impossible', field: loc.path,
        question: 'Hole cards for ' + (loc.kind === 'hero' ? 'you' : playerName(hand, loc.player)) + ' are stored on the ' + streetName(hand, loc.si) + ', where the replayer never shows them. ' + (empty ? 'Move them to the start of the hand?' : 'Drop the copy?'),
        options: [empty
          ? { label: 'Move them', value: { op: 'moveCards', from: loc.path, to } }
          : { label: 'Drop them', value: { op: 'set', path: loc.path, value: '' } }],
        blocking: false, auto: true,
      }, [STAGE.cards, 1, li]));
    });
  }

  // A surplus opponent slot (more slots than opponents) holding cards.
  const n = hand.players.length;
  locs.forEach((loc, li) => {
    if (loc.kind !== 'opp' || loc.player < n || !cardsOf(loc.str).length) return;
    out.push(makeGap({
      id: 'extra-slot:' + loc.path, kind: 'impossible', field: loc.path,
      question: 'Cards "' + loc.str + '" are stored for an opponent who isn’t at the table. Who held them?',
      options: [{ label: 'Nobody — drop them', value: { op: 'set', path: loc.path, value: '' } }],
      allowFree: true, blocking: true,
    }, [STAGE.cards, 2, li]));
  });

  // Duplicates among the dealt cards the replayer reads.
  const where = new Map();
  locs.forEach(loc => {
    if (!isLiveLocation(loc, env) || badPaths.has(loc.path)) return;
    if (loc.kind === 'opp' && loc.player >= n) return;
    for (const k of knownKeys(loc.str)) {
      if (!where.has(k)) where.set(k, []);
      const list = where.get(k);
      list.push(loc);
    }
  });
  let di = 0;
  for (const [card, list] of where) {
    if (list.length < 2) continue;
    // Same string twice ("AhAh") or across strings: one problem per card.
    const uniq = [];
    list.forEach(l => { if (!uniq.includes(l)) uniq.push(l); });
    const options = uniq.map(keep => ({
      label: uniq.length === 1 ? 'Keep one ' + card : 'It’s ' + keep.label,
      value: { op: 'batch', ops: list.filter(l => l !== keep).map(l => ({ op: 'removeCard', path: l.path, card })).concat(
        // the same string holding the card twice keeps one copy
        list.filter(l => l === keep).slice(1).map(l => ({ op: 'removeCard', path: l.path, card }))) },
    }));
    out.push(makeGap({
      id: 'dup:' + card, kind: 'impossible', field: uniq[0].path,
      question: card + ' appears ' + (uniq.length > 1 ? 'in ' + listWords(uniq.map(l => l.label)) : 'twice in ' + uniq[0].label) + '. Where was it really?',
      options, allowFree: true, blocking: true,
    }, [STAGE.cards, 3, di++]));
  }
}

/* Opponent card counts (stage: showdown). */
export function opponentCardRules(hand, env, out, ctx) {
  if (env.category === 'ofc') return;
  const n = hand.players.length;
  const heroIdx = hand.heroIdx;
  for (let pi = 0; pi < n; pi++) {
    if (pi === heroIdx) continue;
    const slot = oppSlot(pi, heroIdx);
    const name = playerName(hand, pi);
    if (env.isStud) {
      let total = 0;
      for (let si = 0; si < hand.streets.length; si++) {
        const s = (hand.streets[si].cards.opponents || [])[slot];
        if (notationProblem(s)) continue;
        const k = cardsOf(s).length;
        total += k;
        // 3rd street holds the door card, and 3rd or 7th street the three
        // hidden cards once they are shown (the replayer's showdown prepends
        // them to 3rd; a parsed hand may put them on 7th).
        const max = si === 0 ? 4 : si === 4 ? 3 : 1;
        if (k > max) {
          out.push(makeGap({
            id: 'oppcards:' + pi + ':' + si, kind: 'impossible', field: oppPath(si, slot),
            question: name + ' has ' + k + ' cards on ' + streetName(hand, si) + '; ' + (si === 0 || si === 4 ? 'that is more than the door card and the hidden cards' : 'one card is dealt per street') + '. Which were they?',
            allowFree: true, blocking: true,
          }, [STAGE.showdown, pi, si]));
        }
      }
      if (total > 7) {
        out.push(makeGap({
          id: 'oppcards:' + pi, kind: 'impossible', field: oppPath(0, slot),
          question: name + ' has ' + total + ' cards recorded; stud deals 7. Which were they?',
          allowFree: true, blocking: true,
        }, [STAGE.showdown, pi, 9]));
      }
      continue;
    }
    const s = (hand.streets[0].cards.opponents || [])[slot];
    if (!s || isMuck(s) || notationProblem(s)) continue;
    const k = cardsOf(s).length;
    const expect = env.cfg.heroCards;
    if (k === expect) continue;
    const field = oppPath(0, slot);
    if (k > expect) {
      out.push(makeGap({
        id: 'oppcards:' + pi, kind: 'impossible', field,
        question: hand.gameType + ' deals ' + expect + ' cards, but ' + k + ' are recorded for ' + name + '. Which were they?',
        allowFree: true, blocking: true,
      }, [STAGE.showdown, pi]));
    } else {
      const live = ctx.showdown && ctx.live.includes(pi);
      out.push(makeGap({
        id: 'oppcards:' + pi, kind: 'missing', field,
        question: 'Only ' + k + ' of ' + name + '’s ' + expect + ' cards ' + (k === 1 ? 'is' : 'are') + ' recorded. What were the others?',
        options: [{ label: 'The rest are unknown', fallback: true, value: { op: 'set', path: field, value: cardsOf(s).map(c => c.rank + c.suit).join('') + backs(expect - k) } }],
        allowFree: true, blocking: live,
      }, [STAGE.showdown, pi]));
    }
  }
}

/* Board counts per street (community) and stray boards (everything else). */
export function boardRules(hand, env, out, ctx) {
  const streets = hand.streets;
  if (env.category !== 'community') {
    const has = streets.some(st => cardsOf(st.cards.board).length);
    if (has) {
      out.push(makeGap({
        id: 'board', kind: 'impossible', field: 'streets',
        question: hand.gameType + ' has no board, but board cards are recorded. Drop them?',
        options: [{ label: 'Drop them', value: { op: 'clearBoards' } }],
        allowFree: true, blocking: true,
      }, [STAGE.board, -1]));
    }
    return;
  }
  const def = streetDef(hand.gameType);
  // A board written with "xx" for unnamed cards still has its count.
  const counts = streets.map((st, si) => { const bad = notationProblem(st.cards.board, def.boardCards[si]); if (!bad) return cardsOf(st.cards.board).length; return bad.unknown ? bad.known.length + bad.unknown : null; });
  if (counts.some(c => c == null)) return; // notation first
  const total = counts.reduce((a, b) => a + b, 0);
  if (total > 5) {
    out.push(makeGap({
      id: 'board', kind: 'impossible', field: 'streets',
      question: total + ' board cards are recorded; the board has 5. Which were they?',
      allowFree: true, blocking: true,
    }, [STAGE.board, -1]));
    return;
  }
  /* Re-dealing the cards in order is the fix when a street holds MORE than it
     should and nothing after it holds any: "board AhKd2c7s9h" stored on the
     flop. When a street holds fewer, a card is missing, and re-dealing would
     slide a turn card into the flop — so it is not offered then. */
  const want = (si) => (si < def.boardCards.length ? def.boardCards[si] : 0);
  const overflowAt = counts.findIndex((c, si) => c > want(si));
  const redistributable = overflowAt >= 0 && counts.slice(overflowAt + 1).every(c => c === 0);
  const redist = { label: 'Deal them in order: flop, turn, river', value: { op: 'redistributeBoard' } };
  if (counts[0] > 0) {
    out.push(makeGap({
      id: 'board:0', kind: 'impossible', field: 'streets.0.cards.board',
      question: 'Board cards are recorded before the flop. ' + (redistributable ? 'Deal them as the flop, turn and river in order?' : 'Where do they belong?'),
      options: redistributable ? [redist] : [{ label: 'Drop them', value: { op: 'set', path: 'streets.0.cards.board', value: '' } }],
      allowFree: true, blocking: true, auto: redistributable,
    }, [STAGE.board, 0]));
    return;
  }
  for (let si = 1; si < streets.length && si < def.boardCards.length; si++) {
    const want = def.boardCards[si];
    const k = counts[si];
    if (k === want) continue;
    if (redistributable && si > overflowAt) continue; // the re-deal answers it
    const reached = ctx.reached(si);
    if (!reached && k === 0) continue;
    const field = 'streets.' + si + '.cards.board';
    const word = BOARD_WORD[si] || streetName(hand, si);
    const actionsFromHere = streets.slice(si).some(st => (st.actions || []).length);
    if (k === 0) {
      const early = redistributable && si < overflowAt;
      const opts = early ? [redist] : [];
      opts.push({ label: 'I don’t remember', fallback: true, value: { op: 'set', path: field, value: backs(want) } });
      out.push(makeGap({
        id: 'board:' + si, kind: 'missing', field,
        question: early ? 'The ' + word + ' is empty but a later street holds ' + counts[overflowAt] + ' board cards. Deal them in order?' : 'What was the ' + word + '?',
        options: opts, allowFree: true, blocking: actionsFromHere || (ctx.showdown && !ctx.hasResult) || early, auto: early,
      }, [STAGE.board, si]));
      if (early) return;
      continue;
    }
    const opts = [];
    if (redistributable) opts.push(redist);
    if (k < want) opts.push({ label: 'The rest are unknown', fallback: true, value: { op: 'set', path: field, value: cardsOf(streets[si].cards.board).map(c => c.rank + c.suit).join('') + backs(want - k) } });
    out.push(makeGap({
      id: 'board:' + si, kind: 'impossible', field,
      question: 'The ' + word + ' has ' + want + ' card' + (want > 1 ? 's' : '') + ', but ' + k + ' ' + (k === 1 ? 'is' : 'are') + ' recorded. What was it?',
      options: opts, allowFree: true, blocking: true, auto: redistributable,
    }, [STAGE.board, si]));
    if (redistributable) return; // one answer fixes the rest
  }
}

/* Stud: one card per player per street after 3rd. */
export function studCardRules(hand, env, out, ctx) {
  if (!env.isStud) return;
  const heroIdx = hand.heroIdx;
  const n = hand.players.length;
  for (let si = 1; si < hand.streets.length; si++) {
    if (!ctx.reached(si) || ctx.foldedBefore(si).has(heroIdx)) continue;
    const s = hand.streets[si].cards.hero;
    if (notationProblem(s)) continue;
    const k = cardsOf(s).length;
    const field = 'streets.' + si + '.cards.hero';
    if (k === 0) {
      out.push(makeGap({
        id: 'cards:hero:' + si, kind: 'missing', field,
        question: 'What was your ' + streetName(hand, si) + ' card?',
        options: [{ label: 'I don’t remember', fallback: true, value: { op: 'set', path: field, value: backs(1) } }],
        allowFree: true, blocking: false,
      }, [STAGE.board, si, 0]));
    } else if (k > 1) {
      out.push(makeGap({
        id: 'cards:hero:' + si, kind: 'impossible', field,
        question: 'You have ' + k + ' cards on ' + streetName(hand, si) + '; one card is dealt per street. Which was it?',
        allowFree: true, blocking: true,
      }, [STAGE.board, si, 0]));
    }
  }
  // Up cards for opponents still in: one question per opponent.
  for (let pi = 0; pi < n; pi++) {
    if (pi === heroIdx) continue;
    const id = 'upcards:' + pi;
    if (ctx.dismissed.has(id)) continue;
    const slot = oppSlot(pi, heroIdx);
    const missing = [];
    // Only for a player who got past 3rd street: a door card of a seat that
    // folded at once decides nothing the replay shows.
    if (ctx.foldedAfter(0).has(pi)) continue;
    for (let si = 0; si <= 3 && si < hand.streets.length; si++) {
      if (!ctx.reached(si) || ctx.foldedBefore(si).has(pi)) continue;
      const s = (hand.streets[si].cards.opponents || [])[slot];
      if (notationProblem(s)) continue;
      if (!cardsOf(s).length) missing.push(si);
    }
    if (!missing.length) continue;
    out.push(makeGap({
      id, kind: 'missing', field: oppPath(missing[0], slot),
      question: 'What were ' + playerName(hand, pi) + '’s up cards? (Missing: ' + listWords(missing.map(si => si === 0 ? 'the door card' : streetName(hand, si))) + ')',
      options: [dismissOption('I don’t know')], allowFree: true, blocking: false,
    }, [STAGE.board, 9, pi]));
  }
}
