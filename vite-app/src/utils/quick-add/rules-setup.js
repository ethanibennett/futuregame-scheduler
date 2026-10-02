// ── Quick-add: rules for the table itself ─────────────────────────────────
// Game, blinds, players, hero, positions and stacks — everything that has to be
// right before a single action can be read.

import { gameConfig, streetDef, guessGameType, COMMON_GAMES, positionLabels } from './game.js';
import { canonicalPosition, seatHand, positionsCanonical, fittingTableSizes, positionMode, pendingTableSize } from './seats.js';
import { validStack } from './betting.js';
import { STAGE, makeGap, fmt, niceRound, playerName, listWords, num, dismissOption } from './common.js';
import { cardsOf } from './cards.js';

const isIdx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

export function gameRules(hand, out) {
  if (gameConfig(hand.gameType)) return;
  const raw = typeof hand.gameType === 'string' ? hand.gameType.trim() : '';
  const guess = guessGameType(raw);
  const games = (guess ? [guess] : []).concat(COMMON_GAMES.filter(g => g !== guess));
  out.push(makeGap({
    id: 'game', kind: raw ? 'ambiguous' : 'missing', field: 'gameType',
    question: raw ? 'Which game is "' + raw + '"?' : 'What game was it?',
    options: games.map(g => ({ label: g, value: { op: 'setGame', gameType: g } })),
    allowFree: true, blocking: true,
  }, [STAGE.game]));
}

export function structureRules(original, normalizedChanged, hand, out) {
  if (normalizedChanged) {
    out.push(makeGap({
      id: 'structure', kind: 'missing', field: 'streets',
      question: 'Some of the hand’s fields are empty (streets, card slots or names). Fill them in?',
      options: [{ label: 'Fill them in', value: { op: 'normalize' } }],
      blocking: true, auto: true,
    }, [STAGE.structure]));
  }
  const cfg = gameConfig(hand.gameType);
  if (!cfg) return;
  const def = streetDef(hand.gameType);
  const extra = hand.streets.slice(def.streets.length);
  if (extra.length) {
    const used = extra.some(st => (st.actions || []).length || (st.draws || []).length ||
      cardsOf(st.cards.hero).length || cardsOf(st.cards.board).length || (st.cards.opponents || []).some(o => cardsOf(o).length));
    out.push(makeGap({
      id: 'streets', kind: 'impossible', field: 'streets',
      question: hand.gameType + ' has ' + def.streets.length + ' betting rounds, but the hand has ' + hand.streets.length + '. Drop the extra ' + (extra.length > 1 ? 'ones' : 'one') + '?',
      options: [{ label: 'Drop ' + (extra.length > 1 ? 'them' : 'it'), value: { op: 'truncateStreets', count: def.streets.length } }],
      allowFree: used, blocking: used, auto: !used,
    }, [STAGE.structure, 1]));
  }
}

/* A preflop limp is a call of exactly the big blind: the first preflop call
   before anybody raised, from a seat that posted nothing. */
function limpAmount(hand) {
  const acts = (hand.streets[0] && hand.streets[0].actions) || [];
  for (const a of acts) {
    if (!a) continue;
    if (a.action === 'raise' || a.action === 'bet' || a.action === 'all-in') return null;
    if (a.action === 'call') {
      const pos = hand.players[a.player] && hand.players[a.player].position;
      if (pos === 'SB' || pos === 'BB' || pos === 'BTN/SB') continue;
      const A = num(a.amount);
      return A > 0 ? A : null;
    }
  }
  return null;
}

export function blindRules(hand, env, out) {
  const cfg = env.cfg;
  if (!cfg || env.category === 'ofc') return;
  const b = hand.blinds || {};
  const bb = num(b.bb);
  const sb = num(b.sb);
  const key = (k) => [STAGE.blinds, k];
  if (!(bb > 0)) {
    const guesses = [];
    if (sb > 0) guesses.push(sb * 2);
    const limp = limpAmount(hand);
    if (limp) guesses.push(limp);
    const sbMissing = !env.isStud && !(sb > 0);
    const options = [...new Set(guesses)].map(v => {
      if (sbMissing) {
        const s = v / 2;
        return { label: fmt(s) + '/' + fmt(v), value: { op: 'setMany', sets: [{ path: 'blinds.sb', value: s }, { path: 'blinds.bb', value: v }] } };
      }
      return { label: env.isStud ? fmt(v) + '/' + fmt(v * 2) : fmt(sb) + '/' + fmt(v), value: { op: 'set', path: 'blinds.bb', value: v } };
    });
    out.push(makeGap({
      id: 'blinds.bb', kind: 'missing', field: 'blinds.bb',
      question: env.isStud
        ? 'What were the limits (the small bet)?'
        : (cfg.betting === 'fl' ? 'What were the blinds (the big blind is the small bet)?' : 'What were the blinds?'),
      options, allowFree: true, blocking: true,
    }, key(0)));
    return;
  }
  if (!env.isStud) {
    if (b.sb == null || !(sb >= 0) || typeof b.sb !== 'number') {
      const half = bb / 2;
      const opts = [];
      if (Number.isInteger(half)) opts.push(half);
      else { opts.push(Math.floor(half)); opts.push(half); }
      out.push(makeGap({
        id: 'blinds.sb', kind: 'missing', field: 'blinds.sb',
        question: 'What was the small blind? (The big blind was ' + fmt(bb) + '.)',
        options: opts.map(v => ({ label: fmt(v) + '/' + fmt(bb), value: { op: 'set', path: 'blinds.sb', value: v } })),
        allowFree: true, blocking: true,
      }, key(1)));
    } else if (sb > bb) {
      out.push(makeGap({
        id: 'blinds.sb', kind: 'impossible', field: 'blinds.sb',
        question: 'The small blind (' + fmt(sb) + ') is bigger than the big blind (' + fmt(bb) + '). Swap them?',
        options: [{ label: fmt(bb) + '/' + fmt(sb), value: { op: 'setMany', sets: [{ path: 'blinds.sb', value: bb }, { path: 'blinds.bb', value: sb }] } }],
        allowFree: true, blocking: true,
      }, key(1)));
    }
  }
  // An ante bigger than the big blind (in stud, the small bet) is a typo or a
  // misheard number, not a structure anybody plays.
  const anteNow = num(b.ante);
  if (anteNow > 0 && (env.isStud ? anteNow >= bb : anteNow > bb)) {
    const guess = env.isStud ? niceRound(bb / 8) : bb;
    out.push(makeGap({
      id: 'blinds.ante', kind: 'impossible', field: 'blinds.ante',
      question: 'An ante of ' + fmt(anteNow) + ' is bigger than the ' + (env.isStud ? 'small bet' : 'big blind') + ' (' + fmt(bb) + '). What was the ante?',
      options: [
        { label: env.isStud ? fmt(guess) + ' each' : 'A big blind ante of ' + fmt(guess), value: { op: 'set', path: 'blinds.ante', value: guess } },
        { label: 'No ante', value: { op: 'set', path: 'blinds.ante', value: 0 } },
      ],
      allowFree: true, blocking: true,
    }, key(2)));
  }
  const qa = hand.quickAdd || {};
  const potPending =hand.streets.some(st => (st.actions || []).some(a => a && a.amount == null && a.potFraction != null));
  if (b.ante == null && !(qa.antePerPlayer != null && !env.isStud)) {
    // A size said as a fraction of the pot cannot be worked out without the ante.
    if (env.isStud) {
      const guess = niceRound(bb / 8);
      out.push(makeGap({
        id: 'blinds.ante', kind: 'missing', field: 'blinds.ante',
        question: 'What was the ante?',
        options: [
          { label: fmt(guess) + ' each', value: { op: 'set', path: 'blinds.ante', value: guess } },
          { label: 'No ante', value: { op: 'set', path: 'blinds.ante', value: 0 } },
        ],
        allowFree: true, blocking: potPending,
      }, key(2)));
    } else if (hand.gameMode === 'mtt' || potPending) {
      const yes = { label: 'Yes, ' + fmt(bb), value: { op: 'set', path: 'blinds.ante', value: bb } };
      const no = { label: 'No ante', value: { op: 'set', path: 'blinds.ante', value: 0 } };
      out.push(makeGap({
        id: 'blinds.ante', kind: 'missing', field: 'blinds.ante',
        question: 'Was there a big blind ante?',
        options: hand.gameMode === 'mtt' ? [yes, no] : [no, yes],
        allowFree: true, blocking: potPending,
      }, key(2)));
    }
  }
  if (!env.isStud && b.straddle) {
    const n = hand.players.length;
    const types = ['utg', 'button', 'rock', 'mississippi'].filter(t => b['straddle_' + t]);
    if (n < 4) {
      out.push(makeGap({
        id: 'straddle', kind: 'impossible', field: 'blinds.straddle',
        question: 'Nobody can straddle ' + n + '-handed. Drop the straddle?',
        options: [{ label: 'Drop it', value: { op: 'set', path: 'blinds.straddle', value: false } }],
        blocking: false, auto: true,
      }, key(3)));
    } else if (!types.length) {
      out.push(makeGap({
        id: 'straddle', kind: 'missing', field: 'blinds.straddle',
        question: 'Who straddled?',
        options: [
          { label: 'UTG straddle', value: { op: 'set', path: 'blinds.straddle_utg', value: true } },
          { label: 'Button straddle', value: { op: 'set', path: 'blinds.straddle_button', value: true } },
          { label: 'No straddle', value: { op: 'set', path: 'blinds.straddle', value: false } },
        ],
        allowFree: true, blocking: false,
      }, key(3)));
    }
  }
}

const SIZE_LABEL = (k) => (k === 2 ? 'Heads-up' : k === 6 ? '6-max' : k === 9 ? '9-handed' : k + '-handed');

function tableSizeGap(id, question, sizes, kind) {
  return makeGap({
    id, kind: kind || 'missing', field: 'tableSize',
    question,
    options: sizes.map(k => ({ label: SIZE_LABEL(k), value: { op: 'setTableSize', n: k } })),
    allowFree: true, blocking: true,
  }, [STAGE.players]);
}

export function playerRules(hand, env, out) {
  const n = hand.players.length;
  if (n > 10) {
    out.push(makeGap({
      id: 'players', kind: 'impossible', field: 'players',
      question: 'The hand has ' + n + ' players; the replayer seats at most 10. Who was at the table?',
      allowFree: true, blocking: true,
    }, [STAGE.players]));
    return false;
  }
  if (n < 2) {
    const sizes = fittingTableSizes(hand, 2, 'narrator');
    out.push(tableSizeGap('players', 'How many players were dealt in?', sizes.length ? sizes : [6, 9, 2, 8, 7, 10, 5, 4, 3]));
    return false;
  }
  return true;
}

export function heroRules(hand, out) {
  const n = hand.players.length;
  if (isIdx(hand.heroIdx, n)) return true;
  const named = hand.players.findIndex(p => p && typeof p.name === 'string' && /^(hero|me|i|myself|you)$/i.test(p.name.trim()));
  const orderIdx = [];
  if (named >= 0) orderIdx.push(named);
  for (let i = 0; i < n; i++) if (i !== named) orderIdx.push(i);
  out.push(makeGap({
    id: 'hero', kind: 'missing', field: 'heroIdx',
    question: 'Which player were you?',
    options: orderIdx.map(i => ({
      label: playerName(hand, i) + (hand.players[i] && hand.players[i].position && hand.players[i].position !== playerName(hand, i) ? ' (' + hand.players[i].position + ')' : ''),
      value: { op: 'setHero', heroIdx: i },
    })),
    allowFree: true, blocking: true,
  }, [STAGE.hero]));
  return false;
}

/* Who probably had the button, if the players are listed clockwise: the first
   preflop actor is the seat after the big blind. */
function buttonGuess(hand) {
  const n = hand.players.length;
  const first = ((hand.streets[0] && hand.streets[0].actions) || []).find(a => a && isIdx(a.player, n));
  if (!first) return -1;
  if (n <= 3) return first.player;
  return (first.player + n - 3) % n;
}

function buttonGap(hand, id, kind, question) {
  const n = hand.players.length;
  const guess = buttonGuess(hand);
  const idxs = [];
  if (guess >= 0) idxs.push(guess);
  for (let i = 0; i < n; i++) if (i !== guess) idxs.push(i);
  return makeGap({
    id, kind, field: 'players',
    question,
    options: idxs.map(i => ({ label: playerName(hand, i), value: { op: 'seatByButton', button: i } })),
    allowFree: true, blocking: true,
  }, [STAGE.positions]);
}

/* Seats. The replayer reads position from the seat INDEX, so a hand whose
   players are not in seat order — or not all at the table yet — cannot be bet
   through. Seating follows the server (seats.js is its port). */
export function positionRules(hand, env, out) {
  if (env.category === 'ofc') return true;
  const players = hand.players;
  const n = players.length;
  const mode = positionMode(hand);
  const pendingN = pendingTableSize(hand);
  const named = players.map(p => (p && p.position) || '').filter(Boolean);

  // Quick add listed only the players mentioned: how big was the table?
  if (mode === 'narrator' && pendingN == null) {
    const sizes = fittingTableSizes(hand, n, 'narrator');
    out.push(tableSizeGap('table-size',
      'How many players were dealt in?' + (named.length ? ' (' + named.join(', ') + ' are mentioned.)' : ''),
      sizes.length ? sizes : [6, 9, 2, 8, 7, 10, 5, 4, 3].filter(k => k >= n)));
    return false;
  }
  if (env.isStud) return true; // stud seats are numbers, nothing to place
  if (positionsCanonical(players)) return true;

  if (players.every(p => !canonicalPosition(p && p.position) && !positionLabels(n).includes(p && p.position))) {
    out.push(buttonGap(hand, 'button', 'missing',
      n === 2 ? 'Who had the button (the small blind)? The players are taken to be listed in seat order.'
        : 'Who had the button? The players are taken to be listed clockwise.'));
    return false;
  }
  const seated = seatHand(hand, n, mode);
  const labels = positionLabels(n);
  // The positions do not all fit this table, or fit only by filling the last
  // seat with the last player: is there a bigger table where everybody fits?
  const bigger = pendingN == null && (!seated || !seated.complete || seated.deduced)
    ? fittingTableSizes(hand, n + 1, mode) : [];
  if (bigger.length) {
    out.push(tableSizeGap('table-size',
      'The positions (' + named.join(', ') + ') don\u2019t fit a ' + n + '-handed table. How many players were dealt in?',
      bigger, 'ambiguous'));
    return false;
  }
  const seatGap = (i, seats, kind) => {
    const pos = players[i] && players[i].position;
    return makeGap({
      id: 'seat:' + i, kind, field: 'players.' + i + '.position',
      question: pos
        ? playerName(hand, i) + ' is listed as ' + pos + ', which ' + (kind === 'impossible' ? 'someone else holds' : 'does not exist ' + n + '-handed') + '. Where did ' + playerName(hand, i) + ' sit?'
        : 'Where did ' + playerName(hand, i) + ' sit?',
      options: seats.map(k => ({ label: labels[k], value: { op: 'swapSeats', a: i, b: k } })),
      allowFree: true, blocking: true,
    }, [STAGE.positions, i]);
  };
  // Two players claim one seat: which one is wrong is not ours to pick.
  if (seated && seated.conflicts.length) {
    out.push(seatGap(seated.conflicts[0], seated.openSeats, 'impossible'));
    return false;
  }
  /* The last seat went to the last player, who named no position at all: a
     guess about the hero's (or anyone's) seat is still a guess, so ask. */
  if (seated && seated.complete && seated.deduced && pendingN == null) {
    const d = seated.deducedPlayer;
    const pos = players[d] && players[d].position;
    if (!canonicalPosition(pos) && !labels.includes(pos)) {
      out.push(seatGap(d, seated.openSeats, 'missing'));
      return false;
    }
  }
  if (seated && seated.complete) {
    const identity = seated.order.every((o, i) => o === i);
    const renamed = players.map((p, i) => ((p.position || '?') !== labels[i] ? (p.position || '?') + ' \u2192 ' + labels[i] : null)).filter(Boolean);
    out.push(makeGap({
      id: 'positions', kind: 'ambiguous', field: 'players',
      question: identity
        ? 'Use the replayer\u2019s names for the seats (' + renamed.join(', ') + ')?'
        : 'Put the players in seat order by their positions?',
      options: [{ label: 'Yes', value: { op: 'seatByPosition' } }],
      blocking: !identity, auto: true,
    }, [STAGE.positions]));
    return identity; // labels only: the betting still reads correctly
  }
  if (seated && seated.unplaced.length) {
    const free = seated.positions.map((pos, k) => (pos == null ? k : -1)).filter(k => k >= 0);
    out.push(seatGap(seated.unplaced[0], free, players[seated.unplaced[0]].position ? 'impossible' : 'missing'));
    return false;
  }
  out.push(buttonGap(hand, 'positions', 'impossible',
    'The positions don\u2019t fit together. Who had the button? (The players are taken to be listed clockwise.)'));
  return false;
}

/* Everything a player put in over the hand, from the recorded actions and the
   forced bets. */
function committed(hand, env, pi) {
  let total = 0;
  const p = hand.players[pi];
  const ante = env.ante || 0;
  if (env.isStud) total += ante;
  else if (p && p.position === 'BB') total += (env.bb || 0) + ante;
  else if (p && (p.position === 'SB' || p.position === 'BTN/SB')) total += env.sb || 0;
  for (const st of hand.streets) {
    for (const a of (st.actions || [])) {
      if (a && a.player === pi && a.action !== 'fold') total += num(a.amount) || 0;
    }
  }
  return total;
}

export function stackRules(hand, env, out) {
  const n = hand.players.length;
  const missing = [];
  const bbKnown = env.bb > 0;
  for (let i = 0; i < n; i++) {
    const p = hand.players[i];
    if (validStack(p.startingStack)) continue;
    // "40 BB deep" waits for the big blind, which is asked first.
    if (p.startingStack == null && num(p.startingStackBB) > 0 && !bbKnown) continue;
    missing.push(i);
  }
  const bb = env.bb || 0;
  const unit = env.isStud ? ((env.bigBet || bb * 2)) : bb;
  const deep = (k) => (env.isStud ? unit * k * 3 / 10 : unit * k); // stud stacks in big bets: 30, 15, 60
  const unitWord = env.isStud ? 'big bets' : 'BB';
  const depthLabel = (k) => (env.isStud ? (k * 3 / 10) + ' ' + unitWord : k + ' ' + unitWord);
  const acts = (i) => hand.streets.some(st => (st.actions || []).some(a => a && a.player === i && a.action !== 'fold'));
  const hero = hand.heroIdx;

  // A stack the forced bets use up cannot then bet, call or bring it in.
  for (let i = 0; i < n; i++) {
    const p = hand.players[i];
    if (!validStack(p.startingStack) || missing.includes(i)) continue;
    const ante = env.ante || 0;
    const forced = env.isStud ? ante
      : (p.position === 'BB' ? (env.bb || 0) + ante : (p.position === 'SB' || p.position === 'BTN/SB') ? (env.sb || 0) : 0);
    const later = hand.streets.some(st => (st.actions || []).some(a => a && a.player === i && a.action !== 'fold' && a.action !== 'check'));
    if (forced > 0 && p.startingStack <= forced && later) {
      const name = playerName(hand, i);
      const opts = [];
      const heroStack = isIdx(hero, n) && validStack(hand.players[hero].startingStack) ? hand.players[hero].startingStack : null;
      if (heroStack != null && i !== hero && heroStack > forced) opts.push({ label: 'Same as ' + playerName(hand, hero) + ' (' + fmt(heroStack) + ')', value: { op: 'set', path: 'players.' + i + '.startingStack', value: heroStack } });
      if (bbKnown && deep(100) > forced) opts.push({ label: depthLabel(100) + ' (' + fmt(deep(100)) + ')', value: { op: 'set', path: 'players.' + i + '.startingStack', value: deep(100) } });
      out.push(makeGap({
        id: 'stack:' + i, kind: 'impossible', field: 'players.' + i + '.startingStack',
        question: (i === hero ? 'Your' : name + '’s') + ' stack of ' + fmt(p.startingStack) + ' is used up by the ' + (env.isStud ? 'ante' : 'blind') + ' (' + fmt(forced) + '), but ' + (i === hero ? 'you' : name) + ' bet later. How deep ' + (i === hero ? 'were you' : 'was ' + name) + '?',
        options: opts, allowFree: true, blocking: true,
      }, [STAGE.stacks, i]));
    }
  }
  if (!missing.length) return;

  if (missing.length === n && n > 1 && !hand.players.some(p => num(p.startingStackBB) > 0)) {
    const opts = [];
    const setAll = v => ({ op: 'setMany', sets: hand.players.map((_, i) => ({ path: 'players.' + i + '.startingStack', value: v })) });
    /* The best guess must be deep enough for the hand's own action: a fixed "100 BB" first
       made a hand with bigger bets impossible, and accepting it set off a run of all-in
       questions (measured on a PLO corpus hand: three follow-ups). The most anyone put in
       across the streets (amounts are chips ADDED), plus a big blind for the blinds/ante, is
       the floor; of the usual depths only those at or above it are offered — 100 first when
       it fits (the common case is unchanged), else the shallowest that does. */
    // Forced bets first (blinds/ante are posted, not recorded as actions) — same rule as the
    // "stack used up by the blind" check above.
    const put = hand.players.map(p => env.isStud ? (env.ante || 0)
      : (p.position === 'BB' ? (env.bb || 0) + (env.ante || 0) : (p.position === 'SB' || p.position === 'BTN/SB') ? (env.sb || 0) : 0));
    for (const st of (hand.streets || [])) {
      for (const a of ((st && st.actions) || [])) {
        if (a && Number.isInteger(a.player) && a.player >= 0 && a.player < n && num(a.amount) > 0) put[a.player] += num(a.amount);
      }
    }
    const floor = Math.max(0, ...put) + (unit > 0 ? unit : 0);
    /* A hand with an all-in says how deep the all-in player was: everything they put in. That
       is the likeliest effective stack, so it leads; any deeper depth would contradict the
       all-in and only trade one question for another. */
    const allInPut = Math.max(0, ...hand.players.map((_, i) => (hand.streets || []).some(st => ((st && st.actions) || []).some(a => a && a.player === i && a.action === 'all-in')) ? put[i] : 0));
    /* Asked as the EFFECTIVE stack — what a player knows and what the hand turns on — not
       "everyone's" (user, 2026-10-02). The answer still fills every seat: the players in the
       pot get exactly it, and the ones who only folded need some stack to be drawn with,
       which changes nothing in the replay. */
    const inPot = hand.players.map((_, i) => i).filter(i => i === hero || acts(i));
    if (allInPut > 0) opts.push({ label: fmt(allInPut) + ' (the all-in)', value: setAll(allInPut) });
    if (unit > 0) {
      const ks = [100, 50, 200, 300, 500, 1000].filter(k => deep(k) >= floor).slice(0, allInPut > 0 ? 2 : 3);
      for (const k of ks) opts.push({ label: depthLabel(k) + ' (' + fmt(deep(k)) + ')', value: setAll(deep(k)) });
      if (!ks.length) {
        const v = Math.ceil(floor / unit) * unit;
        opts.push({ label: 'Enough to cover the action (' + fmt(v) + ')', value: setAll(v) });
      }
    }
    out.push(makeGap({
      id: 'stacks', kind: 'missing', field: 'players.*.startingStack',
      question: inPot.length > 2
        ? 'What were the effective stacks? One number if they were about the same.'
        : 'What was the effective stack?',
      options: opts, allowFree: true, blocking: true,
    }, [STAGE.stacks, -1]));
    return;
  }
  const known = hand.players.map((p, i) => (validStack(p.startingStack) ? p.startingStack : null));
  const heroStack = isIdx(hero, n) ? known[hero] : null;
  const biggest = Math.max(...known.filter(v => v != null));
  /* Players who never put a chip in by choice (they only folded) usually have
     no stated stack, and the replay does not need one. They get one
     skippable question between them, not one each. */
  const quiet = missing.filter(i => i !== hero && !acts(i) && hand.players[i].startingStack == null && !(num(hand.players[i].startingStackBB) > 0));
  if (quiet.length && !env.dismissed.has('stacks:others')) {
    const setAll = (v) => ({ op: 'setMany', sets: quiet.map(i => ({ path: 'players.' + i + '.startingStack', value: v })) });
    const opts = [];
    if (heroStack != null) opts.push({ label: 'Same as ' + playerName(hand, hero) + ' (' + fmt(heroStack) + ')', value: setAll(heroStack) });
    if (unit > 0) opts.push({ label: depthLabel(100) + ' (' + fmt(deep(100)) + ')', value: setAll(deep(100)) });
    opts.push(dismissOption('Leave them blank'));
    out.push(makeGap({
      id: 'stacks:others', kind: 'missing', field: 'players.*.startingStack',
      question: quiet.length === 1
        ? 'How deep was ' + playerName(hand, quiet[0]) + '? (Only folded, so it is optional.)'
        : 'No stacks for ' + listWords(quiet.map(i => playerName(hand, i))) + ', who only folded. Give them all the same?',
      options: opts, allowFree: quiet.length === 1, blocking: false,
    }, [STAGE.stacks, 50]));
  }
  for (const i of missing) {
    if (quiet.includes(i)) continue;
    const raw = hand.players[i].startingStack;
    const isHero = i === hero;
    const name = playerName(hand, i);
    const opts = [];
    const inBB = num(hand.players[i].startingStackBB);
    let fromBB = false;
    if (inBB > 0 && bbKnown) {
      fromBB = true;
      opts.push({ label: inBB + ' BB (' + fmt(Math.round(inBB * env.bb)) + ')', value: { op: 'set', path: 'players.' + i + '.startingStack', value: Math.round(inBB * env.bb) } });
    }
    const allInAct = hand.streets.some(st => (st.actions || []).some(a => a && a.player === i && a.action === 'all-in' && num(a.amount) > 0));
    if (allInAct) {
      const c = committed(hand, env, i);
      opts.push({ label: fmt(c) + ' (all of it went in)', value: { op: 'set', path: 'players.' + i + '.startingStack', value: c } });
    }
    if (heroStack != null && !isHero) opts.push({ label: 'Same as ' + playerName(hand, hero) + ' (' + fmt(heroStack) + ')', value: { op: 'set', path: 'players.' + i + '.startingStack', value: heroStack } });
    if (Number.isFinite(biggest) && biggest !== heroStack) opts.push({ label: 'Same as the biggest stack (' + fmt(biggest) + ')', value: { op: 'set', path: 'players.' + i + '.startingStack', value: biggest } });
    if (unit > 0) for (const k of [100, 50]) opts.push({ label: depthLabel(k) + ' (' + fmt(deep(k)) + ')', value: { op: 'set', path: 'players.' + i + '.startingStack', value: deep(k) } });
    const zero = raw != null && raw !== '' && Number.isFinite(num(raw)) && num(raw) <= 0;
    out.push(makeGap({
      id: 'stack:' + i, kind: zero ? 'impossible' : 'missing', field: 'players.' + i + '.startingStack',
      question: zero
        ? (isHero ? 'Your stack is recorded as ' + fmt(num(raw)) + '. How deep were you?' : name + '’s stack is recorded as ' + fmt(num(raw)) + '. How deep was ' + name + '?')
        // With your stack known, an opponent's is asked as the effective stack between you.
        : (isHero ? 'How deep were you?' : heroStack != null ? 'What was the effective stack with ' + name + '?' : 'How deep was ' + name + '?'),
      options: opts, allowFree: true, blocking: acts(i) || isHero, auto: fromBB,
    }, [STAGE.stacks, i]));
  }
}
