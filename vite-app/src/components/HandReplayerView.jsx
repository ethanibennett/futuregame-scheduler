import { cardFaceSrc, rankOnlyFaceSrc, unknownCardFaceSrc } from '../utils/card-faces.js';
import { boardSuitFills, readingAcross, undecidedLine } from '../utils/board-suit-fills.js';
import { availableCardBacks, CARD_BACK_KEY, normalizeCardBack, applyCardBack } from '../utils/card-back.js';
import { nameBook, nameSuggestions, restOfTable, isDefaultName, proIndex } from '../utils/player-names.js';
// The pro list for the entry's name suggestions (scripts/build-pro-names.mjs): its own chunk, loaded once, the first
// time a name field is focused.
let proNamesLoad = null;
function loadProNames() {
  if (!proNamesLoad) {
    proNamesLoad = import('../data/pro-names.json')
      .then((m) => proIndex((m.default || m).names))
      .catch(() => { proNamesLoad = null; return null; });
  }
  return proNamesLoad;
}
import { unitR } from '../utils/grid-snap.js';
import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import useBackToClose from '../hooks/useBackToClose.js';
import { useSolverAvailability, offered as offeredGame } from './StudyHead.jsx';
import { createPortal, flushSync } from 'react-dom';
import ShortDeckRuleDialog from './ShortDeckRuleDialog.jsx';
import Icon from './Icon.jsx';
import { API_URL, SITE_URL } from '../utils/api.js';
import { HAND_CONFIG, HAND_CONFIG_DEFAULT, haptic, getVariantStrip, canonicalGameType, canonicalHand, getToday } from '../utils/utils.js';
import { STRUCTURE_GAME_MAP, DEFAULT_STRUCTURE, variantName, buildCatalog, buildMixes, bestGuess } from '../utils/variant-catalog.js';
import { Palette, GuessCard } from './VariantPicker.jsx';
import { VariantWheels } from './VariantWheels.jsx';
import { buildDrawStudySpot } from '../utils/draw-study-spot';
import { SUPER_DOWN, SUPER_THROWN_IDX, SUPER_DOWN_IDX, superDealText, splitSuperDeal, superDowns, applySuperThrow, superThrowAsked, superThirdOnFelt, superName } from '../utils/super-stud.js';
import { parseCardNotation, evaluateHand, evaluateShowdown, assignNeutralSuits, GAME_EVAL, gameEvalFor,
         bestHighFor, bestLow8For, bestLowA5Hand, bestLow27Hand, bestLowFor, bestBadugiHand, scoreHalves, halvesWinnersAmong, halvesHandName, oddChipToLo,
         computePotAwards, hiLoWinnersAmong, potLayerWinners, reconcileLayersToPot, studOddChipKey, studOddChipOrder,
         boardKey, handBoards, boardCount, runRows, multiBoardWinners, multiBoardEvals, multiBoardShaped, combinesHiLo,
         seatOrderFromButton } from '../utils/poker-engine.js';
import { encodeHand, VISUAL_SWITCHES } from '../utils/hand-shorthand.js';
import { ODDS_GAMES } from '../utils/odds.js';
import { MomentBubble, NoteTrack, NoteSheet, DetailsSheet, SendHandSheet, QuestionCard, ImportHandsSheet, SentToYou, FromYourWatch, noteAt, heroDecisionNext, questionHand } from './HandExtras.jsx';
import { keepListCopy, listCopy, outbox as readOutbox, addToOutbox, flushOutbox } from '../utils/hand-outbox.js';
import { loadCardImages, ensureExportFonts } from '../utils/export.js';
import {
  MotionRegistry, SPRINGS_FLAG_KEY, readSpringsFlag, springSetFor, rateFor,
  prefersReducedMotion as springsReducedMotion,
  dealBoard, yieldBoard, pushOut, emergeTimes, planSweep, sweepWagers, shipPot, shipFirstArrival, shipStartAfterSweep,
  settlePile, fadePileOut, emptyPile, seatLanding, clearPush, rayToRect, centreOf, unionRect,
  collectAtResult, potShown,
} from '../utils/replayer-motion.js';
import { SPRING_SETS, spring, timeTo, tierSpring, keyframes as transportKeyframes, REPLAYER_PACE } from '../utils/spring.js';
import { bestFive, halvesOf, counterfeitedNow, leaderOf, lowDecider, indexOfLowRank, streetChange } from '../utils/replayer-reading.js';
import { turnOver, dealIn, liftOnce, poseTo, rap, ghostsAway, labelsAway, cardsAway, foldAway, studFlipUnder, foldStyleOf, FOLD_STYLES, normalizeFoldStyle, angleOf, cardTimes, slideRow, runOutBoard, runOutTimes, poseSequence, drawIn, ghostsTo, appearAt, makeRoom } from '../utils/replayer-card-moments.js';
import { showdownSpecial } from '../utils/showdown-specials.js';
import { playSuitFlood, warmSuitFlood } from '../utils/showdown-moments.js';
import { exportReplayVideo } from '../utils/replay-video-export.js';
import { exportReplayGif } from '../utils/replay-gif-export.js';
import { useToast } from '../contexts/ToastContext.jsx';
import QuickAddView from './QuickAddView.jsx';
import { checkExportable } from '../utils/hand-history/index.js';
import { heroNet } from '../utils/hand-net.js';
import { autoTitle as autoTitleOf, displayTitle as displayTitleOf, isBuiltTitle, compactChips } from '../utils/hand-title.js';
import { SAMPLE_HAND } from '../utils/sample-hand.js';
import { exportHandHistory, playedAtOf, handOfRow, handsFileName } from '../utils/hand-history/save.js';
import { chipInsertVars, applyChipInserts, WHITE_CHIP } from '../utils/chip-inserts.js';
const ReplayerDrill = lazy(() => import('./ReplayerDrill.jsx'));

/* The ranks a game deals, high to low, for its card pickers. Short Deck plays a 36-card deck, the
   twos to fives taken out, so its pickers have nine ranks to a suit and say so in a class that
   narrows the grid to match (the grid is 13 columns wide for everything else). */
const ALL_RANKS = 'AKQJT98765432'.split('');
const SHORT_DECK_RANKS = 'AKQJT9876'.split('');
function ranksFor(gameType) {
  const cfg = HAND_CONFIG[gameType] || HAND_CONFIG[String(gameType || '').replace(/^Super /, '')];
  return cfg && cfg.shortDeck ? SHORT_DECK_RANKS : ALL_RANKS;
}
const pickerGridClass = (ranks) => 'card-picker-grid' + (ranks.length < ALL_RANKS.length ? ' is-short-deck' : '');

// ── Street definitions ──────────────────────────────────────
const STREET_DEFS = {
  community: { streets: ['Preflop', 'Flop', 'Turn', 'River'], boardCards: [0, 3, 1, 1] },
  draw_triple: { streets: ['Pre-Draw', 'First Draw', 'Second Draw', 'Third Draw'], boardCards: [0, 0, 0, 0] },
  draw_single: { streets: ['Pre-Draw', 'Draw'], boardCards: [0, 0] },
  draw_double: { streets: ['Pre-Draw', 'First Draw', 'Second Draw'], boardCards: [0, 0, 0] },
  stud: { streets: ['3rd Street', '4th Street', '5th Street', '6th Street', '7th Street'], boardCards: [0, 0, 0, 0, 0] },
  ofc: { streets: ['Initial (5)', 'Card 6', 'Card 7', 'Card 8', 'Card 9', 'Card 10', 'Card 11', 'Card 12', 'Card 13'], boardCards: [0,0,0,0,0,0,0,0,0] },
};

// ── Draw hand computation ──
/* A draw hand is always shown in rank order — before the first draw and after
   every draw, not in the order cards were entered or arrived — so "7 6 5 3 2"
   reads as a hand instead of "7 6 3 2 5". See sortDrawHand. */
function computeDrawHand(originalCards, draws, upToStreetIdx, gameType = '') {
  if (!originalCards) return '';
  let current = sortDrawHand(originalCards, gameType);
  for (let si = 0; si <= upToStreetIdx; si++) {
    if (!draws || !draws[si]) continue;
    const draw = draws[si];
    if (!draw || draw.discarded === 0) continue;
    if (draw.discardedCards) {
      const discarded = parseCardNotation(draw.discardedCards);
      const currentParsed = parseCardNotation(current);
      const remaining = [];
      const discardSet = {};
      discarded.forEach(c => { discardSet[c.rank + c.suit] = (discardSet[c.rank + c.suit] || 0) + 1; });
      currentParsed.forEach(c => {
        const key = c.rank + c.suit;
        if (discardSet[key] && discardSet[key] > 0) { discardSet[key]--; }
        else { remaining.push(c); }
      });
      current = remaining.map(c => c.rank + c.suit).join('');
    } else {
      // No specific cards recorded: throw the cards a player of this game would
      // throw — the HIGHEST in lowball, the lowest in high draw. `current` is in
      // rank order, so that is one end of it (drawThrowsFromTop).
      const parsed = parseCardNotation(current);
      const n = Math.min(parsed.length, draw.discarded);
      const kept = drawThrowsFromTop(gameType) ? parsed.slice(n) : parsed.slice(0, parsed.length - n);
      current = kept.map(c => c.rank + c.suit).join('');
    }
    if (draw.newCards) current = sortDrawHand(current + draw.newCards, gameType);
    /* Cards drawn but not recorded (entry makes them optional, and links made before
       2026-10-01 never carried them) are still cards in the hand: they show face down rather
       than vanishing, so a player who drew one three times still holds five. A back is 'Ax' —
       the parser pairs a rank with a suit, so a rankless 'xx' would be dropped — and
       sortDrawHand ranks suit 'x' lowest, so it sorts to the end and is never thrown first. */
    else if (!(HAND_CONFIG[drawBase(gameType)] || {}).discardOnly) current = current + 'Ax'.repeat(draw.discarded);
  }
  return current;
}

/* Cards that cannot be dealt to `playerIdx` on the draw recorded at `streetIdx`, each with
   the reason, for the New Cards fields (Ethan, 2026-10-01: dead cards must not be
   selectable as cards dealt on a draw). Dead: every card discarded so far in the hand (this
   draw's discards included), every card in any player's hand going into this draw, and any
   card already dealt to someone else on this same draw. Face-down 'x' cards are unknown and
   never dead. */
function drawDeadCards(hand, streetIdx, playerIdx) {
  const dead = new Map();
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  const nameOf = (pi) => (hand.players[pi] && hand.players[pi].name) || 'another player';
  const add = (str, why) => {
    for (const c of parseCardNotation(str || '')) {
      if (c.suit === 'x') continue;
      const k = c.rank + c.suit;
      if (!dead.has(k)) dead.set(k, why);
    }
  };
  for (let si = 0; si <= streetIdx && si < hand.streets.length; si++) {
    for (const d of (hand.streets[si].draws || [])) add(d.discardedCards, 'already discarded');
    add(hand.streets[si].cards && hand.streets[si].cards.board, 'on the board');
  }
  const s0 = (hand.streets[0] && hand.streets[0].cards) || {};
  hand.players.forEach((_, pi) => {
    const oppSlot = pi > heroIdx ? pi - 1 : pi;
    const base = pi === heroIdx ? (s0.hero || '') : ((s0.opponents || [])[oppSlot] || '');
    // An opponent's stored cards are their showdown hand (entered at showdown), not a
    // starting hand to replay draws over: every known one is held, as stored.
    const held = pi === heroIdx ? computeDrawHand(base, getPlayerDrawsByStreet(hand, pi), streetIdx - 1, hand.gameType) : base;
    add(held, pi === playerIdx ? 'already in this hand' : 'in ' + nameOf(pi) + "'s hand");
  });
  // Cards dealt on earlier draws are in their drawer's hand even when that player's starting
  // cards are unknown (computeDrawHand returns nothing without them). Any later thrown away are
  // already in the map as discarded.
  for (let si = 0; si < streetIdx && si < hand.streets.length; si++) {
    for (const d of (hand.streets[si].draws || [])) {
      add(d.newCards, d.player === playerIdx ? 'already in this hand' : 'in ' + nameOf(d.player) + "'s hand");
    }
  }
  const cur = hand.streets[streetIdx];
  for (const d of ((cur && cur.draws) || [])) {
    if (d.player !== playerIdx) add(d.newCards, 'already dealt to ' + nameOf(d.player));
  }
  return dead;
}

/* The New Cards field for a draw: a dead card typed into it does not take. Each complete
   two-character card is checked as it is typed; a dead one (or a repeat) is dropped and the
   reason shows under the field until the next edit. A half-typed card passes through. */
function DrawNewCardsInput({ value, onChange, dead, placeholder, ariaLabel = 'New cards' }) {
  const [msg, setMsg] = useState('');
  const handle = (raw) => {
    const chars = String(raw || '').replace(/10/g, 'T').replace(/\s+/g, '');
    const kept = []; const seen = new Set(); let note = '';
    let i = 0;
    for (; i + 1 < chars.length; i += 2) {
      const tok = chars[i].toUpperCase() + chars[i + 1].toLowerCase();
      const why = dead && dead.get(tok);
      if (why) { note = tok + ' is ' + why; continue; }
      if (seen.has(tok)) { note = tok + ' is already entered'; continue; }
      seen.add(tok); kept.push(chars[i] + chars[i + 1]);
    }
    const tail = i < chars.length ? chars[i] : '';
    setMsg(note);
    onChange(kept.join('') + tail);
  };
  return (
    <>
      <input type="text" placeholder={placeholder} value={value || ''} aria-label={ariaLabel}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={e => handle(e.target.value)} />
      {msg && <div className="replayer-field-error" role="alert">{msg}</div>}
    </>
  );
}

function getPlayerDrawsByStreet(hand, playerIdx) {
  const result = {};
  hand.streets.forEach((s, si) => {
    if (!s.draws) return;
    const d = s.draws.find(d => d.player === playerIdx);
    if (d) result[si] = d;
  });
  return result;
}

// ── Game category / street helpers ──
/* The double draws (owner, 2026-11-27): two draws, a round of betting after each. */
const DOUBLE_DRAW = ['PL 2-7 DD', 'PL DD Hi'];
const isDrawCategory = (c) => c === 'draw_triple' || c === 'draw_double' || c === 'draw_single';
function getGameCategory(gameType) {
  // Strip "Super " prefix for engine lookups — Super variants share base game config
  const baseType = gameType.replace(/^Super /, '');
  const cfg = HAND_CONFIG[gameType] || HAND_CONFIG[baseType];
  if (!cfg) return 'community';
  if (gameType === 'OFC') return 'ofc';
  if (cfg.isStud) return 'stud';
  if (cfg.hasBoard) return 'community';
  if (['2-7 TD', 'PL 2-7 TD', 'L 2-7 TD', 'A-5 TD', 'Badeucy', 'Badacy', 'Archie 99', 'Archie 66', 'Ari'].includes(gameType)) return 'draw_triple';
  if (['NL 2-7 SD', 'PL 5CD Hi', 'NL 5CD Hi', 'NL A-5 SD'].includes(gameType)) return 'draw_single';
  // Limit 5-Card Draw and Pot Limit Badugi (owner, 2026-11-27: "add Limit 5-Card Draw and Pot Limit Badugi too").
  if (gameType === 'L 5CD Hi') return 'draw_single';
  if (gameType === 'PL Badugi') return 'draw_triple';
  if (DOUBLE_DRAW.includes(gameType)) return 'draw_double';
  if (gameType === 'Badugi') return 'draw_triple';
  if (!cfg.hasBoard && !cfg.isStud) {
    const customDef = STREET_DEFS['custom_' + gameType];
    if (customDef && customDef.streets.length > 3) return 'draw_triple';
    if (customDef && customDef.streets.length <= 3) return 'draw_single';
  }
  return 'community';
}

function getStreetDef(gameType) {
  const customDef = STREET_DEFS['custom_' + gameType];
  if (customDef) return customDef;
  const base = STREET_DEFS[getGameCategory(gameType)] || STREET_DEFS.community;
  // Community cards before the first bet come out of the street that would have dealt them.
  const door = (HAND_CONFIG[gameType] || {}).doorBoard;
  return door ? { ...base, boardCards: base.boardCards.map((n, i) => (i === 0 ? door : i === 1 && n ? n - door : n)) } : base;
}
/* A draw in a game with a board too (Dramaha, Pineapple) plays by the draw games' rules for the hand. */
const hasDraws = (category, cfg) => isDrawCategory(category) || (cfg && cfg.drawAfter != null);
/* The razz family: the highest door brings it in and the lowest board acts first. In the 2-7 games the ace is the worst card. */
const LOW_STUD = /(^|\s)(2-7 )?Razz$|^Razzdugi$|^Razzdeucy$/;
const ACE_HIGH_LOW_STUD = /2-7 Razz$|^Razzdeucy$/;

// Sort a hand's cards for the replay display: rank high→low, then suit (spades
// high), the way a stud hand already reads. Face-down backs sort equal, so an
// all-hidden hand is unchanged; used only for community games, where a hand is
// all-up or all-down (never mixed), so a real card never sorts among backs.
const RANK_SORT = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };
const SUIT_SORT = { s:4, h:3, d:2, c:1, x:0 };
function sortHandByRank(cardStr) {
  const cards = parseCardNotation(cardStr || '');
  if (cards.length < 2) return cardStr || '';
  return cards.slice().sort((a, b) =>
    (RANK_SORT[b.rank] || 0) - (RANK_SORT[a.rank] || 0) ||
    (SUIT_SORT[b.suit] || 0) - (SUIT_SORT[a.suit] || 0)
  ).map(c => c.rank + c.suit).join('');
}

/* Draw games sort high→low too, but the ace plays LOW in the A-5 family, so a
   wheel reads "5 4 3 2 A" there and "A K Q J T" in 2-7 or high draw. Face-down
   backs rank 0 and sit at the end, after every known card. */
const ACE_LOW_DRAW = new Set(['A-5 TD', 'NL A-5 SD', 'Badugi', 'PL Badugi', 'Badacy']);
const HIGH_DRAW = new Set(['PL 5CD Hi', 'NL 5CD Hi', 'L 5CD Hi', 'PL DD Hi', 'NL Pineapple', 'PL Pineapple', 'L Pineapple', 'Dramaha Hi', 'Dramaha 49', 'L Dramaha Hi', 'L Dramaha 49', 'Archie 99', 'Archie 66', 'Ari']);
const drawBase = (gameType) => String(gameType || '').replace(/^Super /, '');
function sortDrawHand(cardStr, gameType) {
  const cards = parseCardNotation(cardStr || '');
  if (cards.length < 2) return cardStr || '';
  const aceLow = ACE_LOW_DRAW.has(drawBase(gameType));
  const rank = (r) => (r === 'A' && aceLow) ? 1 : (RANK_SORT[r] || 0);
  // A face-down card (suit 'x') ranks below everything, whatever its placeholder rank.
  const rk = (c) => c.suit === 'x' ? 0 : rank(c.rank);
  return cards.slice().sort((a, b) =>
    rk(b) - rk(a) || (SUIT_SORT[b.suit] || 0) - (SUIT_SORT[a.suit] || 0)
  ).map(c => c.rank + c.suit).join('');
}
// In lowball the cards thrown are the high ones — the FRONT of a rank-ordered hand.
function drawThrowsFromTop(gameType) { return !HIGH_DRAW.has(drawBase(gameType)); }

/* The dead-card list: rank first, then suit (spades high). High games run
   high→low; lowball runs low→high, so the cards that matter most to a low hand
   lead — every draw game but 5-card high, and the razz family. The ace is low
   in the A-5 games (A-5 TD, Badugi, Badacy, Razz, Razzdugi) and high in 2-7.
   Stud 8 is a split game and keeps the high order. */
const LOWBALL_STUD = new Set(['Razz', 'Action Razz', '2-7 Razz', 'Razzdugi', 'Razzdeucy']);
const ACE_LOW_STUD = new Set(['Razz', 'Action Razz', 'Razzdugi']);
function sortDeadCards(keys, gameType, category) {
  const base = drawBase(gameType);
  const isDraw = isDrawCategory(category);
  const lowball = isDraw ? !HIGH_DRAW.has(base) : LOWBALL_STUD.has(base);
  const aceLow = isDraw ? ACE_LOW_DRAW.has(base) : ACE_LOW_STUD.has(base);
  const rank = (r) => (r === 'A' && aceLow) ? 1 : (RANK_SORT[r] || 0);
  const dir = lowball ? 1 : -1;
  return keys.slice().sort((a, b) =>
    dir * (rank(a[0]) - rank(b[0])) || (SUIT_SORT[b[1]] || 0) - (SUIT_SORT[a[1]] || 0));
}

/* A folded seat's plaque shrinks AWAY from the table's centre: its scale origin
   is the point on its own box that faces out, i.e. the unit direction from the
   table centre (50%, 50%) to the seat, mapped onto the box (0..100%). A side
   seat shrinks toward the rail beside it, the top seat upward, the hero down. */
function foldOrigin(pos) {
  const dx = (pos[0] || 50) - 50, dy = (pos[1] || 50) - 50;
  const len = Math.hypot(dx, dy) || 1;
  return { '--fold-ox': (50 + (dx / len) * 50).toFixed(1) + '%', '--fold-oy': (50 + (dy / len) * 50).toFixed(1) + '%' };
}

// ── Position labels ──
function getPositionLabels(numPlayers) {
  if (numPlayers <= 2) return ['BTN/SB', 'BB'];
  if (numPlayers === 3) return ['BTN', 'SB', 'BB'];
  const middle = ['UTG', 'UTG+1', 'MP1', 'MP2', 'LJ', 'HJ', 'CO'];
  const need = numPlayers - 3;
  const picked = middle.slice(Math.max(0, middle.length - need));
  return picked.concat(['BTN', 'SB', 'BB']);
}

function getStudPositionLabels(numPlayers) {
  return Array.from({ length: numPlayers }, (_, i) => 'Seat ' + (i + 1));
}

/* ── Straddles ────────────────────────────────────────────────────────────
   A straddle is a blind raise posted before the deal, from a seat that is not
   already posting a blind. Two things follow, and the second is the one that
   gets forgotten: the money is in the pot before anyone acts, AND the last
   straddler has the option — so preflop action begins to their LEFT rather
   than at UTG, and they close the betting.

   Seats here are laid out so index 0 is UTG and the last three are BTN, SB,
   BB (see getPositionLabels), which makes posting order simply ascending
   index: UTG straddles first, the button last. Each straddle doubles the one
   before it starting at twice the big blind, which is how every room that
   spreads them prices it.

   UTG and BUTTON name their own seat, so those are derived and cannot go
   stale when the table size changes. ROCK and MISSISSIPPI cannot be derived —
   the rock is a token that travels to whoever won the last pot, and a
   Mississippi straddle may come from anywhere — so those carry a seat, and it
   is clamped to a seat that is actually able to straddle.

   Under four players there is no such seat: BTN, SB and BB account for
   everyone, and a blind cannot straddle itself. */
const STRADDLE_TYPES = ['utg', 'button', 'rock', 'mississippi'];
const STRADDLE_LABELS = { utg: 'UTG', button: 'Button', rock: 'Rock', mississippi: 'Mississippi' };
/* These name ROLES, not position labels. getPositionLabels hands out a
   different set at every table size — six-handed starts at LJ, not UTG — so a
   note that said "action starts at UTG+1" would be describing a seat that does
   not exist most of the time. The hint under the list names the real seats,
   because it can read them. */
const STRADDLE_NOTES = {
  utg: 'The first seat to act posts it blind, and then closes the round.',
  button: 'The button posts it. Action starts at the small blind.',
  rock: 'Whoever holds the rock must post. It travels, so name the seat.',
  mississippi: 'A straddle from any seat. Action starts to its left.',
};

/* The seats that can straddle: everyone in front of the blinds. */
function straddleEligibleSeats(n) {
  return n < 4 ? [] : Array.from({ length: n - 2 }, (_, i) => i);
}

function straddleSeatFor(type, n, stored) {
  if (n < 4) return -1;
  if (type === 'utg') return 0;
  if (type === 'button') return n - 3;
  const s = Number(stored);
  return Number.isInteger(s) && s >= 0 && s <= n - 3 ? s : 0;
}

/* Ordered by posting, with the amount each one is. */
function getStraddles(players, blinds) {
  const b = blinds || {};
  const n = (players || []).length;
  const bb = b.bb || 0;
  if (!b.straddle || !bb || n < 4) return [];
  const seats = b.straddleSeats || {};
  const taken = new Set();
  const picked = [];
  STRADDLE_TYPES.forEach(type => {
    if (!b['straddle_' + type]) return;
    const seat = straddleSeatFor(type, n, seats[type]);
    /* Two types can land on one seat — a rock held by the button, say. It is
       one straddle, and it is posted once. */
    if (seat < 0 || taken.has(seat)) return;
    taken.add(seat);
    picked.push({ type, seat });
  });
  picked.sort((a, c) => a.seat - c.seat);
  /* The first straddle is blinds.straddleAmount when the game says one ("2/2/5": $2/$2 with a $5 straddle, owner
     2026-11-19), else twice the big blind; each after it doubles the one before. */
  const sa = Number(b.straddleAmount);
  const first = sa > bb ? sa : bb * 2;
  return picked.map((st, i) => ({ ...st, amount: first * Math.pow(2, i) }));
}

/* The seat that closes the preflop betting, or -1 for none. */
function lastStraddleSeat(list) {
  return list.length ? list[list.length - 1].seat : -1;
}

// ── Action order ──
function getActionOrder(players, isPreflop, studInfo, straddleSeat) {
  const n = players.length;
  if (n <= 0) return [];
  const indices = [];
  if (studInfo && studInfo.isStud) {
    const startIdx = studInfo.is3rdStreet ? studInfo.bringInIdx : studInfo.bestBoardIdx;
    if (startIdx >= 0) {
      for (let i = 0; i < n; i++) indices.push((startIdx + i) % n);
      return indices;
    }
    for (let i = 0; i < n; i++) indices.push(i);
    return indices;
  }
  const btnIdx = n <= 3 ? 0 : n - 3;
  const sbIdx = n <= 3 ? (n <= 2 ? 0 : 1) : n - 2;
  const bbIdx = n <= 2 ? 1 : n - 1;
  if (n === 2) {
    return isPreflop ? [0, 1] : [1, 0];
  } else if (isPreflop) {
    /* Normally 0..n-1, which is UTG first and the big blind closing. A
       straddle moves the close: the last straddler has the option, so the
       round starts at the seat on their left and wraps round to them. With no
       straddle, start is 0 and this is the loop it always was. */
    const start = (straddleSeat >= 0 && straddleSeat < n) ? (straddleSeat + 1) % n : 0;
    for (let i = 0; i < n; i++) indices.push((start + i) % n);
  } else {
    indices.push(sbIdx);
    indices.push(bbIdx);
    for (let i = 0; i < btnIdx; i++) indices.push(i);
    indices.push(btnIdx);
  }
  return indices.filter(i => i < n);
}

// ── Stud helpers ──
function findStudBringIn(hand, isRazz) {
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  const oppCards = (hand.streets[0] && hand.streets[0].cards.opponents) || [];
  const heroCards = parseCardNotation((hand.streets[0] && hand.streets[0].cards.hero) || '');
  const rankBadness = isRazz
    ? (ACE_HIGH_LOW_STUD.test(hand.gameType || '')
      ? { '2':0,'3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'T':8,'J':9,'Q':10,'K':11,'A':12 }
      : { 'A':0,'2':1,'3':2,'4':3,'5':4,'6':5,'7':6,'8':7,'9':8,'T':9,'J':10,'Q':11,'K':12 })
    : { 'A':0,'K':1,'Q':2,'J':3,'T':4,'9':5,'8':6,'7':7,'6':8,'5':9,'4':10,'3':11,'2':12 };
  const suitBadness = isRazz ? { 'c':0,'d':1,'h':2,'s':3 } : { 's':0,'h':1,'d':2,'c':3 };
  let worstIdx = -1, worstRank = -1, worstSuit = -1;
  for (let pi = 0; pi < hand.players.length; pi++) {
    let doorCard;
    if (pi === heroIdx) {
      doorCard = heroCards.length >= 3 ? heroCards[2] : null;
    } else {
      const oppSlot = pi < heroIdx ? pi : pi - 1;
      const oCards = parseCardNotation(oppCards[oppSlot] || '');
      doorCard = oCards.length ? oCards[0] : null;
    }
    if (!doorCard || doorCard.suit === 'x') continue;
    const rv = rankBadness[doorCard.rank] || 0;
    const sv = suitBadness[doorCard.suit] || 0;
    if (worstIdx === -1 || rv > worstRank || (rv === worstRank && sv > worstSuit)) {
      worstIdx = pi; worstRank = rv; worstSuit = sv;
    }
  }
  return worstIdx;
}

/* A visible stud board's score: the category first (no pair < pair < two pair < trips < full house
   < quads), then every rank, grouped ranks before kickers, highest first. Each category sits above
   anything the ranks can add, so an unpaired A-K no longer outscores 9-9, and every kicker counts
   (entry audit D2 / evaluation audit D7, 2026-10-20). aceLow: the ace is a one (Razz); a low game
   takes the lowest score. */
function scoreStudBoard(cards, aceLow = false) {
  const rankValues = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':aceLow ? 1 : 14 };
  if (!cards.length) return 0;
  const counts = {};
  cards.forEach(c => { const r = rankValues[c.rank] || 0; counts[r] = (counts[r] || 0) + 1; });
  const groups = Object.keys(counts).map(Number).map(r => [r, counts[r]]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(g => g[1]);
  const cat = shape[0] === 4 ? 6 : shape[0] === 3 ? (shape[1] === 2 ? 5 : 4) : shape[0] === 2 ? (shape[1] === 2 ? 3 : 2) : 1;
  const P = 15;
  let score = cat * Math.pow(P, 5);
  groups.forEach((g, i) => { score += g[0] * Math.pow(P, 4 - i); });
  return score;
}

function findStudBestBoard(hand, streetIdx, foldedSet, isLowGame) {
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  const maxVisibleStreet = Math.min(streetIdx, 3);
  let bestIdx = -1, bestScore = isLowGame ? Infinity : -Infinity;
  for (let pi = 0; pi < hand.players.length; pi++) {
    if (foldedSet.has(pi)) continue;
    const visible = [];
    for (let si = 0; si <= maxVisibleStreet; si++) {
      if (pi === heroIdx) {
        const hCards = parseCardNotation((hand.streets[si] && hand.streets[si].cards.hero) || '');
        if (si === 0 && hCards.length >= 3) visible.push(hCards[2]);
        if (si > 0) hCards.forEach(c => { if (c.suit !== 'x') visible.push(c); });
      } else {
        const oppSlot = pi < heroIdx ? pi : pi - 1;
        const oCards = parseCardNotation(((hand.streets[si] && hand.streets[si].cards.opponents) || [])[oppSlot] || '');
        oCards.forEach(c => { if (c.suit !== 'x') visible.push(c); });
      }
    }
    const score = scoreStudBoard(visible, isLowGame && !ACE_HIGH_LOW_STUD.test(hand.gameType || ''));
    if (isLowGame ? score < bestScore : score > bestScore) { bestIdx = pi; bestScore = score; }
  }
  return bestIdx;
}

function studHasOpenPairOn4th(hand) {
  if (!hand.streets || !hand.streets[0] || !hand.streets[1]) return false;
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  for (let pi = 0; pi < hand.players.length; pi++) {
    let doorCard = null, fourthCard = null;
    if (pi === heroIdx) {
      const s0Cards = parseCardNotation((hand.streets[0] && hand.streets[0].cards.hero) || '');
      const s1Cards = parseCardNotation((hand.streets[1] && hand.streets[1].cards.hero) || '');
      doorCard = s0Cards.length >= 3 ? s0Cards[2] : null;
      fourthCard = s1Cards.length >= 1 ? s1Cards[0] : null;
    } else {
      const oppSlot = pi < heroIdx ? pi : pi - 1;
      const s0Opp = parseCardNotation(((hand.streets[0] && hand.streets[0].cards.opponents) || [])[oppSlot] || '');
      const s1Opp = parseCardNotation(((hand.streets[1] && hand.streets[1].cards.opponents) || [])[oppSlot] || '');
      doorCard = s0Opp.length >= 1 ? s0Opp[0] : null;
      fourthCard = s1Opp.length >= 1 ? s1Opp[0] : null;
    }
    if (doorCard && fourthCard && doorCard.suit !== 'x' && fourthCard.suit !== 'x' && doorCard.rank === fourthCard.rank) return true;
  }
  return false;
}

// ── "Solve this spot" → Solver handoff ──────────────────────
// Off for now (owner, 2026-11-28: "Hide all solve references for now"), with Study's Solve a spot (StudyHub HIDDEN_TOOLS).
const SOLVE_SPOT_HIDDEN = true;
// gameType → solver engine id. The live Solver supports only the
// fixed-limit stud games it has trees for: Stud 8 and Razz. Hold'em /
// Omaha / draw games (and the NL/PL stud variants, Stud Hi, 2-7 Razz)
// are NOT supported and disable the button.
const SOLVER_GAME_MAP = { 'Stud 8': 'stud8', 'Razz': 'razz' };
function solverGameFor(gameType) { return SOLVER_GAME_MAP[gameType] || null; }

// ── DRAW STUDY handoff ──────────────────────────────────────────────────────
// The draw study tool prices EVERY betting and drawing option at one decision,
// including the ones the blueprint cannot offer (it offers at most 2 of 6 draw
// counts with one card-set each, so 2 of the 32 legal discard subsets in 2-7).
// Reading that as a table is the hard part, so the replayer hands it a spot the
// way it already hands one to the stud solver.
//
// 🛑 FIXED-LIMIT ONLY, AND THAT IS NOT A DETAIL. The solver's draw games are
// fixed-limit with a 4-bet cap (SMALL_BET 2, BIG_BET 4). A pot-limit or no-limit
// hand has a different betting tree, so 'PL 2-7 TD' and 'NL 2-7 SD' are
// deliberately absent -- handing one over would produce a confident number for a
// game that was not played. Badeucy/Badacy are split games with no single solver
// game, and are absent for the same reason.
const DRAW_STUDY_GAME_MAP = {
  '2-7 TD': 'td27',
  'L 2-7 TD': 'td27',
  'A-5 TD': 'a5td',
  'Badugi': 'badugi',
};
function drawStudyGameFor(gameType) { return DRAW_STUDY_GAME_MAP[gameType] || null; }

// Stud card-string layout (cards accumulated across streets, in deal
// order). For the HERO the full 7-card string is: index 0,1 = the two
// DOWN hole cards (3rd street), index 2 = the door card (first UP card,
// 3rd), indices 3,4,5 = UP cards (4th, 5th, 6th), index 6 = the final
// DOWN card (7th). For an OPPONENT the replay only ever records the
// VISIBLE up cards (door + 4th/5th/6th) — their hole cards and 7th-
// street down card are face-down and never entered — so every card in
// an opponent string is an up card. Pass isHero=false for opponents so
// their door/4th cards (string indices 0,1) aren't mistaken for hole
// cards and dropped. Returns { up, down } as concatenated two-char
// tokens, dropping unknown ('x') cards.
const STUD_DOWN_IDX = new Set([0, 1, 6]);
function splitStudUpDown(cardStr, isHero = true) {
  const cards = parseCardNotation(cardStr || '');
  let up = '', down = '';
  cards.forEach((c, i) => {
    if (c.suit === 'x') return; // unknown card — can't place it in the solver
    const tok = c.rank + c.suit;
    if (isHero && STUD_DOWN_IDX.has(i)) down += tok; else up += tok;
  });
  return { up, down };
}

// Build the Solver pre-fill object from the current frozen replay spot.
// hero/opponentCards are the accumulated-per-street strings the replay
// view already computes; opponentCards is seat-indexed (null at hero).
// Best-effort: pick the most relevant single opponent for up1 (a live,
// non-folded seat with the most visible up cards), default their range
// to 'all', and surface any down/up ambiguity in `notes`.
function buildSolverSpot({ hand, game, streetIdx, heroCards, opponentCards, replayHeroIdx, folded, pot }) {
  const hero = splitStudUpDown(heroCards);
  const notes = [];

  // Choose the opponent seat for up1: prefer live (not folded) seats,
  // then the one showing the most up cards (most informative board).
  let bestOpp = null, bestScore = -1;
  (opponentCards || []).forEach((cards, pi) => {
    if (pi === replayHeroIdx || !cards) return;
    const isFolded = folded && folded.has && folded.has(pi);
    const split = splitStudUpDown(cards, false); // opponent string is all up cards
    const upCount = (split.up.match(/.{2}/g) || []).length;
    // Live seats outrank folded; within that, more up cards wins.
    const score = (isFolded ? 0 : 1000) + upCount;
    if (score > bestScore && (split.up || split.down)) { bestScore = score; bestOpp = { pi, split, isFolded }; }
  });

  const oppUp = bestOpp ? bestOpp.split.up : '';
  const liveOpps = (opponentCards || []).filter((c, pi) => pi !== replayHeroIdx && c && !(folded && folded.has && folded.has(pi))).length;
  if (liveOpps > 1) notes.push(`Spot is ${liveOpps + 1}-way; the solver is heads-up. Pre-filled opp upcards from one live seat — adjust as needed.`);
  if (bestOpp && bestOpp.isFolded && liveOpps === 0) notes.push('All opponents have folded in this spot; pre-filled upcards from a folded seat.');
  if (!hero.down) notes.push("Hero's down cards are unknown in this hand — fill them in before solving node-locked.");
  notes.push('Opponent is modeled as a full range by default — narrow the range (node-locked) or switch to range-vs-range as needed.');

  // Street: replay street 0 = 3rd street, so solver street = idx + 3.
  const street = Math.min(7, Math.max(3, streetIdx + 3));

  return {
    game,
    street,
    up0: hero.up,        // hero up cards
    up1: oppUp,          // opponent up cards (best-effort, one seat)
    me: hero.down,       // hero down (hole) cards
    pot: String(Math.round(pot || 0)),
    oppRange: 'all',     // default opponent to a full range
    notes,
    source: `${hand.gameType} hand, ${STREET_DEFS.stud.streets[streetIdx] || (street + 'th street')}`,
  };
}

/* 59: /api/replayer/hands spreads the entire hand_data into each list row, so
   the hero's cards and who won are already here — the list simply never looked
   at them and rendered a title, a game chip and a Delete button instead. */
function heroCardsOf(h) {
  return (h.streets && h.streets[0] && h.streets[0].cards && h.streets[0].cards.hero) || '';
}
/* A saved row that slides left to show Delete (UX pick 55, the iOS Mail pattern). The Delete button
   sat on every row, 6g beside the open-the-hand target, the most eye-catching thing in each row and
   the action wanted least. A horizontal drag past half the button's width leaves it open; a tap on
   the row then closes it rather than opening the hand. A vertical move is a scroll and is left alone
   (touch-action: pan-y). The Delete key on a focused row does the same as the button. */
function SwipeDeleteRow({ className, onOpen, onDelete, label, children, rowId = null, selected = false }) {
  const [shift, setShift] = useState(0);      // in g, 0 to -6
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const moved = useRef(false);
  const btnRef = useRef(null);
  const gPx = () => (btnRef.current ? btnRef.current.offsetWidth / 6 : 0) || 1;
  const open = shift <= -3;
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, from: shift, live: false, id: e.pointerId };
    moved.current = false;
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.live) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > gPx() * 0.5) { drag.current = null; return; }
      if (Math.abs(dx) < gPx()) return;
      d.live = true; moved.current = true; setDragging(true);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
    }
    setShift(Math.max(-6, Math.min(0, d.from + dx / gPx())));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && d.live) setShift(s => (s <= -3 ? -6 : 0));
  };
  return (
    <div className={className + ' is-swipe' + (open ? ' is-swiped' : '') + (dragging ? ' is-dragging' : '') + (selected ? ' is-selected' : '')}
      tabIndex={0} aria-keyshortcuts="Delete" data-hand-id={rowId == null ? undefined : rowId} aria-current={selected ? 'true' : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onClick={(e) => {
        if (moved.current) { moved.current = false; return; }
        if (open) { setShift(0); return; }
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') onOpen();
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDelete(); }
        else if (e.key === 'Escape' && open) setShift(0);
      }}>
      <button ref={btnRef} type="button" className="replayer-swipe-delete" tabIndex={open ? 0 : -1} aria-hidden={open ? undefined : true}
        aria-label={'Delete ' + label}
        onClick={(e) => { e.stopPropagation(); setShift(0); onDelete(); }}><span>Delete</span></button>
      <div className="replayer-swipe-slide" style={shift ? { transform: 'translateX(calc(var(--gu) * ' + shift.toFixed(3) + '))' } : undefined}>
        {children}
      </div>
    </div>
  );
}

function outcomeOf(h) {
  const winners = (h.result && h.result.winners) || [];
  if (!winners.length) return null;
  const heroIdx = h.heroIdx != null ? h.heroIdx : 0;
  const mine = winners.find(w => w.playerIdx === heroIdx);
  return mine ? (mine.split ? 'split' : 'win') : 'loss';
}

/* The felt's two stops.

   7: these used to be the same hue at two lightnesses — the lit centre and the
   shaded edge were literally the same colour, which no lit surface ever is.
   Every real material shifts hue between its highlight and its shade, and that
   shift is most of what separates a render from a fill. The highlight warms
   toward the lamp; the shadow cools toward the room.

   11: and the derivation could destroy the lighting model outright. It was
   `light = c*0.9 + white*0.1` and `dark = c*0.6`, so picking near-black gave
   two stops that were both nearly black and the radial gradient vanished, and
   picking white gave a blown-out table with no card contrast — one tap from a
   colour input that is always on screen. The chosen colour is pulled into a
   band that always leaves room for a highlight above it and a shade below. */
/* Two bands, and the band IS the table's brightness.
   Every picked colour is normalised into one of them, so the felt's darkness
   stops depending on which colour was chosen and becomes a property of the
   MODE — which is what lets one picker serve a dark table and a bright one.
   DARK is Casino Royale's, measured off that theme's own cloth.
   BRIGHT is where this table sat before it was darkened: a lit cloth in the
   user's own hue, which is what most rooms actually look like. */
const FELT_BANDS = {
  dark:   { lo: 0.036, hi: 0.10, litMix: 0.04, shadeMix: 0.10, lit: [1.09, 1.04, 0.96], shade: [0.745, 0.745, 0.832], black: 9 },
  bright: { lo: 0.170, hi: 0.52, litMix: 0.09, shadeMix: 0.16, lit: [1.18, 1.13, 1.04], shade: [0.560, 0.560, 0.620], black: 43 },
};

function feltStops(hex, bright) {
  const m = String(hex || '').match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return null;
  let r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
  /* [0.036, 0.10], down from [0.16, 0.62]. Every picked colour is normalised
     into this band, so the band IS the table's darkness — and it is now set
     to Casino Royale's, which is the whole point: measured across the waist,
     that felt runs a centre of 69.8 against 46.3 a twentieth in and 18.7 at
     the rim, while the default ran 131.8 / 84.1 / 60.6. Its lighting was
     already copied; the light was landing on cloth nearly twice as bright,
     which is why it did not read the same. */
  const B = FELT_BANDS[bright ? 'bright' : 'dark'];
  if (lum > 0.004) {
    const k = Math.min(B.hi, Math.max(B.lo, lum)) / lum;
    r *= k; g *= k; b *= k;
  } else {
    /* 9, which is 0.036 x 255 — the same relationship the old 42 had to the
       old floor of 0.16. A pick this dark has no hue left to carry, so it
       lands on the band's own floor rather than on a number of its own. */
    r = g = b = B.black;
  }
  const mix = (c, t, w) => Math.round(Math.min(255, Math.max(0, c * (1 - w) + t * w)));
  return {
    /* The mixes toward warm white and toward dark blue drop from 0.10 and
       0.18 to 0.04 and 0.10. They exist to keep an extreme pick sane, and at
       the old weights they were a tenth of a BRIGHT colour; against a band
       this dark they were most of it, and every felt came out the same muddy
       near-grey. Measured at the new band, purple, green, red and teal keep
       saturations of 0.18 to 0.59 — the hue is what the picker is for, and it
       is the one thing darkening must not take. */
    /* The multipliers close the last of the gap, measured rather than guessed.
       At the band alone the felt came out centre 75.6 / rim 15.5 against
       Casino Royale's 69.8 / 18.7 — the right shape, but reaching further at
       both ends, a 4.88x dish where the target is 3.73x. The lit stop comes
       down 8% and the shade stop goes up 21%, which is exactly those two
       deltas. */
    lit: `rgb(${mix(r * B.lit[0], 255, B.litMix)},${mix(g * B.lit[1], 246, B.litMix)},${mix(b * B.lit[2], 214, B.litMix)})`,
    /* The shade stop owns the whole off-centre field, and it took two passes
       to find that out. The vignette looked like the lever for the felt's
       edges and is not: it is an `ellipse 100% 100%` centred at 50% 40% with a
       transparent core out to 48%, and the table's WAIST sits at a normalised
       distance of about 0.45 — inside that core. It shapes the top and bottom
       of the cloth, not the sides, and changing its depth from 0.42 to 0.38 to
       0.36 moved the waist profile by nothing at any sample.
       So the sides are this stop, and after the gradient was reshaped they sat
       a uniform 6% under Casino Royale's. 0.745 and 0.832 are that 6%. */
    shade: `rgb(${mix(r * B.shade[0], 12, B.shadeMix)},${mix(g * B.shade[1], 16, B.shadeMix)},${mix(b * B.shade[2], 52, B.shadeMix)})`,
  };
}

/* Pot and stack figures show their value directly. They used to count toward
   it over 420ms (useCountUp); removed 2026-09-30 at the user's request. */

// ── Formatting helpers ──
/* 44: this was a hand-rolled divide-and-suffix with a hardcoded '.' decimal
   point and a mixed-case suffix — '1.5k' but '1.5M' — and there was no Intl
   anywhere in the file, so a French or German reader got the wrong separator
   on every number on the felt. Intl compact notation is locale-correct, has
   one suffix case, and drops the trailing .0 by itself. */
const CHIP_COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const CHIP_PLAIN = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
function formatChipAmount(val, bigBlind) {
  if (!val && val !== 0) return '';
  const n = Number(val);
  /* 44: 'stacks in BB' is how tournament players actually talk about depth —
     'he had 14 big blinds' carries information '112,000' does not unless you
     also remember the level. */
  if (bigBlind > 0) {
    const bb = n / bigBlind;
    return (bb >= 100 ? Math.round(bb) : Math.round(bb * 10) / 10) + ' BB';
  }
  /* 42: everything at or above 1,000 went through compact notation, so a
     2,400 pot rendered as '2.4K'. At live-tournament stakes almost every
     number on this table is in that band, which made the felt mostly
     one-decimal approximations of numbers the player knows exactly — and
     '2,400' is both more precise and more recognisable than '2.4K' to the
     person whose hand it is. Compact starts where a tournament clock's own
     shorthand starts. */
  if (n >= 100000) return CHIP_COMPACT.format(n);
  return CHIP_PLAIN.format(n);
}

/* A hand is a tournament (chips) or a cash game (money). Cash amounts carry a
   currency symbol; tournament chips carry none — the same number means a stack
   of chips in one game and a pile of dollars in the other, and the symbol is
   the whole of that difference on the felt. USD is the default because it is
   the one most of these hands are played in. */
const CURRENCIES = [
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'CAD', symbol: 'C$' },
  { code: 'AUD', symbol: 'A$' },
  { code: 'MXN', symbol: 'MX$' },
  { code: 'CNY', symbol: '¥' },
];
/** A hand's saved notes: a "Notes" chip at the felt's top left (8g x 5r), its sheet holding the text (152). */
function NotesChip({ notes }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    if (panelRef.current) panelRef.current.focus({ preventScroll: true });
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return (
    <>
      <button type="button" className="replayer-notes-chip ctl" onClick={() => setOpen(true)} aria-haspopup="dialog"><span>Notes</span></button>
      {open && createPortal(
        <>
          <div className="share-menu-backdrop replayer-notes-backdrop" onClick={() => setOpen(false)} />
          <div className="share-menu-panel grid-sheet replayer-notes-sheet" role="dialog" aria-modal="true" aria-label="Notes" tabIndex={-1} ref={panelRef}>
            <h3>Notes</h3>
            <p className="replayer-notes-text">{notes}</p>
            <div className="share-menu-actions"><button type="button" className="btn btn-ghost ctl replayer-notes-close" onClick={() => setOpen(false)}><span>Close</span></button></div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

function currencySymbol(hand) {
  if (!hand || hand.gameMode !== 'cash') return '';
  const c = CURRENCIES.find(x => x.code === (hand.currency || 'USD'));
  return c ? c.symbol : '$';
}

/* A hand's stakes (App improvements 151): a cash hand's are money, with the currency symbol and cents
   whenever a blind or ante has them ("$0.25/$0.50", "$0.50/$1", "$1/$2"); a tournament's whole chips.
   The felt's stakes pill and the saved-hands row both use it. Through formatChipAmount, whose plain format
   keeps no fraction, $0.25/$0.50 read "0/1" and $0.12/$0.25 "0/0". A fixed-limit game is quoted in its two
   bet sizes; a straddle and the ante follow, as before. */
/* A shared link's preview title (the text a message app shows for futurega.me/h/...): the game and its stakes as the
   felt's pill writes them (owner, 2026-11-22, a Stud 8 link that read "Stud 8 100/200000/50000": "instead of stud 8
   200k/400k"). It was the raw small blind, big blind and ante, so a stud hand showed the small blind it carries for
   nothing and every figure unabbreviated. The straddle is part of the stakes: a link that read "10/10" for a "10/10/20"
   game named a different game. */
function linkTitle(hand) {
  if (!hand) return '';
  const b = hand.blinds || {};
  // A limit game is its small and big bet alone, no ante (owner, 2026-11-22: "In limit games this should just be small
  // bet/big bet without the ante"): "Stud 8 200K/400K". The felt's pill keeps its ante.
  const limit = (HAND_CONFIG[hand.gameType] || HAND_CONFIG_DEFAULT).betting === 'fl';
  const straddle = limit ? 0 : getStraddles(hand.players || [], b).reduce((m, st) => Math.max(m, st.amount || 0), 0);
  const stakes = formatStakes(limit ? { ...hand, blinds: { ...b, ante: 0 } } : hand, { straddle });
  return (hand.gameType ? superName(hand, hand.gameType) : 'Poker hand') + (stakes ? ' ' + stakes : '');
}

function formatStakes(hand, { straddle = 0 } = {}) {
  const b = (hand && hand.blinds) || {};
  if (!b.bb) return '';
  const cfg = HAND_CONFIG[hand.gameType] || HAND_CONFIG_DEFAULT;
  const limit = cfg.betting === 'fl';
  const cash = hand.gameMode === 'cash';
  const sym = currencySymbol(hand);
  const cents = cash && [b.sb, b.bb, b.ante, b.bigBet, straddle].some((v) => v && Math.round(Number(v) * 100) % 100 !== 0);
  /* One style for every part (owner, 2026-11-22, of "200K/400K/(50,000)": "Let's be consistent with our numbers, this
     should be 200K/400k/(50k)"): formatChipAmount compacts from 100,000, so once any part reaches that, every part is
     written in K and M (compactChips, as the hand's title is); below it, all stay whole ("1,000/2,000/(2,000)"). */
  const compact = !cash && [b.sb, b.bb, b.ante, b.bigBet, straddle].some((v) => Number(v) >= 100000);
  const f = (v) => {
    if (!cash) return compact ? compactChips(v) : formatChipAmount(v);
    const n = Number(v) || 0;
    return sym + (cents && Math.round(n * 100) % 100 !== 0 ? n.toFixed(2) : n.toLocaleString('en-US', { maximumFractionDigits: 0 }));
  };
  const parts = limit ? [f(b.bb), f(b.bigBet || b.bb * 2)] : [f(b.sb), f(b.bb), ...(straddle ? [f(straddle)] : [])];
  return parts.join('/') + (b.ante ? '/(' + f(b.ante) + ')' : '');
}

/* A hand's title when none was typed: [game] | [pot type] | [MTT or Cash] | [blinds] (owner, 2026-11-22), the blinds as
   the felt and the row write them (a limit game's two bet sizes), without the ante: the format names the blinds, and a
   stud hand's "/($0.37)" ran the title off the row. utils/hand-title.js builds it; these give it the blinds. */
const TITLE_OPTS = {
  stakes: (h) => {
    const b = (h && h.blinds) || {};
    const cfg = (h && HAND_CONFIG[h.gameType]) || HAND_CONFIG_DEFAULT;
    /* Stud: ante / bring-in / small bet / big bet (owner, 2026-11-22: "in stud games the 'blind' structure should be
       [ante]/[bring in]/[small bet]/[big bet]"); a tournament's short, a cash game's in its money. */
    if (cfg.isStud && b.bb) {
      const vals = [b.ante || 0, b.bringIn || 0, b.bb, b.bigBet || b.bb * 2];
      if (h.gameMode !== 'cash') return vals.map(compactChips).join('/');
      const sym = currencySymbol(h);
      const cents = vals.some((v) => Math.round(Number(v) * 100) % 100 !== 0);
      return vals.map((v) => { const n = Number(v) || 0; return sym + (cents && Math.round(n * 100) % 100 !== 0 ? n.toFixed(2) : n.toLocaleString('en-US', { maximumFractionDigits: 0 })); }).join('/');
    }
    if (h && h.gameMode === 'cash') return formatStakes({ ...h, blinds: { ...b, ante: 0 } });
    // A tournament's written short, 1K/2K (owner, 2026-11-22), so the title fits the row.
    if (!b.bb) return '';
    const limit = (HAND_CONFIG[h.gameType] || HAND_CONFIG_DEFAULT).betting === 'fl';
    return (limit ? [b.bb, b.bigBet || b.bb * 2] : [b.sb, b.bb]).map(compactChips).join('/');
  },
};
const autoTitle = (hand) => autoTitleOf(hand, TITLE_OPTS);
const displayTitle = (row) => displayTitleOf(row, TITLE_OPTS);
/** True where the list shows the built title, which carries the stakes, so the row's meta line need not. */
const showsBuiltTitle = (row) => {
  const t = (row && row.title) || '';
  return !t || t === ((row && row.gameType) || '') + ' Hand' || isBuiltTitle(t);
};

/* Names a split share as the fraction of the pot it is. Deciding the share is
   the evaluator's job — this only rationalises the number it is handed, which
   is why it will print a percentage rather than guess when the share is not a
   fraction anyone says out loud. Denominators stop at 9 because that is the
   most seats there are, and "1/9" is already past the point where a fraction
   reads faster than a percentage. ASCII rather than the vulgar-fraction
   glyphs: 1/2 and 1/4 are in every font, 1/3 and 1/6 are not, and a split pot
   is the wrong place to discover a tofu box. */
function formatShareFraction(share) {
  if (!(share > 0) || share >= 0.999) return '';
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  for (let d = 2; d <= 9; d++) {
    const n = Math.round(share * d);
    if (n < 1 || n >= d) continue;
    if (Math.abs(share - n / d) > 0.004) continue;
    const k = gcd(n, d);
    return (n / k) + '/' + (d / k);
  }
  return Math.round(share * 100) + '%';
}

/* How far round its own axis a chip in a stack has been turned. Derived from
   the amount and the chip's place in the pile rather than drawn at random, so
   a 24,000 wager looks the same every time it is on screen and scrubbing back
   and forth through a hand does not reshuffle the chips in front of a player. */
/* A fraction of the disc's width, not a percentage of it.
   `background-position: 40% 0` on a gradient shifts by
   (positioning area - image size) * 40%, and a gradient's image is exactly
   the positioning area, so that is 40% of zero. Every chip has been drawn at
   phase 0 for as long as the edge spots have existed. The CSS multiplies this
   by --disc-w to get a length, which shifts the tiling origin and wraps. */
/* Each chip's turn looks random but is the same on every render (an export seeks frames, and a re-render must not
   spin the chips). The old hash moved neighbouring chips in a stack by 1% of a turn (index * 40503 % 100 = 3), so a
   stack's chips all sat at one angle; this mixes seed and index fully (owner, 2026-11-13: "randomize the rotation"). */
function pipShift(seed, index) {
  let h = (Math.imul(seed | 0, 2654435761) ^ Math.imul((index | 0) + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return ((h % 1000) / 3000).toFixed(4);
}

/* A chip that comes out from under its seat (emergeTimes in utils/replayer-motion.js; owner, 2026-11-22: "When the chips
   come out for antes or bets, let's have them originate from behind the cards and seat box"): what of the seat covers
   it, the plaque and each card, and what it must also have left before it goes over the felt's pieces again, the
   action label, the button and a readout, which may be fading in and so hide nothing. */
function seatCoverOf(seatEl) {
  const rects = (sel) => (seatEl ? [...seatEl.querySelectorAll(sel)] : [])
    .map(o => o.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
  return {
    cover: rects('.replayer-seat-info, .replayer-seat-cards .card-row > *'),
    also: rects('.replayer-action-badge-outer, .replayer-dealer-btn, .replayer-seat-hand-name:not([data-ghost])'),
  };
}

// ── Chip visuals ──
/* 1 and 5 (owner, 2026-11-16: "Pot still not showing the right amount of chips"): the smallest chip was 25, so a $71
   pot at $1/$1 could only be drawn as two 25s. 100,000 to 1,000,000 for the tournament pots past what five 25,000s
   reach. */
const CHIP_DENOMS = [
  { value: 1000000, color: '#9f1239' },
  { value: 500000, color: '#0ea5e9' },
  { value: 100000, color: '#ec4899' },
  { value: 25000, color: '#14b8a6' },
  { value: 5000,  color: '#f97316' },
  { value: 1000,  color: '#eab308' },
  { value: 500,   color: '#7c3aed' },
  { value: 100,   color: '#39406b' },
  { value: 25,    color: '#22c55e' },
  { value: 5,     color: '#dc2626' },
  { value: 1,     color: WHITE_CHIP },
];
function getChipBreakdown(amount) {
  const chips = [];
  let remaining = Math.abs(Number(amount) || 0);
  for (let i = 0; i < CHIP_DENOMS.length && chips.length < 5; i++) {
    const d = CHIP_DENOMS[i];
    while (remaining >= d.value && chips.length < 5) { chips.push(d.color); remaining -= d.value; }
  }
  if (chips.length === 0) chips.push(WHITE_CHIP);
  return chips;
}

function ChipStack({ amount }) {
  const chips = getChipBreakdown(amount); // [biggest, ..., smallest]
  return (
    // Normal column flow (not column-reverse) puts chips[0]=biggest at the
    // top of the pile. Negative margin-top on each subsequent chip slides it
    // up beneath the bigger one; higher z-index on the bigger chip keeps it
    // drawn on top, so the biggest-denom chip is the visible face.
    //
    // Polish 17/18 broke this into one column per denomination with 17x7 rim
    // discs advancing 5px apiece. On the felt that read as coins with daylight
    // between them rather than as a stack, so both are reverted: one column,
    // 18x6, overlapped to a 2px advance.
    <div className="chip-stack-visual" style={{ display:'inline-flex', flexDirection:'column', alignItems:'center', marginRight:'calc(var(--subrow) * 0.375)', verticalAlign:'middle' }}>
      {chips.map((color, i) => (
        /* Size, radius and overlap all live in .chip-disc now, shared with
           the pot's chips — these were two drawings of one object. Only the
           colour, the phase and the stacking order are per-disc. */
        <div key={i} className="chip-disc" style={{
          '--chip': color,
          ...chipInsertVars(pipShift(amount, i), color),
          zIndex: chips.length - i,
        }} />
      ))}
    </div>
  );
}

/* 45: the plaque truncates at 88px with an ellipsis, which in a condensed
   face at 10px is about fifteen characters — and the cut fell mid-word with
   nothing carrying the rest, so the one string on the plaque the reader
   supplied was the one that could be silently lost. A name shortens the way
   people shorten names. */
/* Stud stacks are quoted in big bets, not in chips, and 30 is the depth a
   hand is normally discussed at. One number, used by the new-hand defaults and
   by the setup form when the big bet changes. */
const STUD_STACK_BB = 30;

function shortenName(name, budget = 15) {
  const t = String(name || '').trim();
  if (t.length <= budget) return t;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    const first = parts[0], last = parts[parts.length - 1];
    /* First initial, last name — "E. Bennett" — is the house form, always the
       first thing tried. It was second before, behind "Kevin D.", which put
       the initial on the half of the name that identifies someone.

       Below it the last name survives alone rather than the first, for the
       same reason, and only a last name with no room left is cut. */
    const forms = [first[0].toUpperCase() + '. ' + last, last];
    for (const f of forms) if (f.length <= budget) return f;
    return cut(last, budget);
  }
  /* One word has no boundary to shorten on, so it can only be cut — and a cut
     with nothing marking it reads as a shorter name rather than a truncated
     one ("Bartholomew" -> "Bartholom"). The full name is on the title. */
  return cut(t, budget);
}

/* The plaques have always abbreviated, because they are the thing with no
   room; the showdown banner did not, so the same person was "J. Blodgett" on
   the table and "John Blodgett" underneath it. This is the house form with no
   budget attached — first initial, last name — for the places that want it for
   consistency rather than because they are out of space. */
function houseName(name) {
  const t = String(name || '').trim();
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return t;
  /* Only a name shaped like a person's gets the treatment. A shared #h/ link
     carries no real names, so its opponents arrive as "Opp 1" — and the house
     form turned that into "O. 1", which identifies nobody. A last part that is
     not a word is a placeholder's number, and the label keeps it whole. */
  const last = parts[parts.length - 1];
  if (!/^[A-Za-z][A-Za-z'’-]*$/.test(last)) return t;
  return parts[0][0].toUpperCase() + '. ' + last;
}

function cut(t, budget) {
  const n = Math.max(3, budget);
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

/* How many characters actually fit on a plaque, from the table's measured
   width — the name is capped at 21cqw and the condensed face at this size
   runs about 5.9px a character. Everything else on this table scales with
   cqw; text cannot, because the shortening has to happen in the markup. */
function nameBudgetFor(tableW, tableH, landscape) {
  if (!tableW) return 15;
  /* Three things have to match .replayer-seat-name, and each was got wrong in
     turn:

       the AXIS — the CSS sizes in cqmin, the shorter of the table's two. In
         portrait that is the width, which is why deriving from tableW worked
         until landscape inverted it and the budget started describing a box
         that no longer existed;
       the FONT SIZE — 5.9px per character is this condensed face at 10px, and
         it is 30px on a desktop table, so a fixed ratio hands out five times
         too many characters at one end;
       the BOX — landscape gives the name more room and slightly smaller type,
         so a full name fits rather than being cut.

     Get any one of them wrong and the ellipsis finishes names mid-word, which
     is the failure shortenName exists to prevent. */
  const cq = Math.min(tableW, tableH || tableW);
  /* 0.034 / 0.032. This factor is the CSS's cqmin coefficient over 100 and
     has to move with it every time the size does — the plaque went to 3.4 /
     3.0cqmin when it took the oblique condensed cut, so a stale 0.030 here
     would estimate a name 13% narrower than the one being drawn. */
  const px = Math.min(landscape ? 34 : 13, Math.max(8, cq * (landscape ? 0.030 : 0.034)));
  const box = Math.min(landscape ? 420 : 300, cq * (landscape ? 0.32 : 0.21875));
  /* 0.52, measured. The box half of this formula was already right — it
     predicts the plaque's max-width to a tenth of a pixel at both ends — but
     the per-character cost was a guess of 0.59 that nothing ever checked.

     Measured on the real face (Univers Condensed) with a Range over the text
     node, which is the only way to get a natural width: a capital M costs
     0.84 of the font size and an 'n' costs 0.51, while actual names land
     between 0.40 and 0.50 ("K. McCormack" 78px across 12 characters at
     12.99px type = 0.50). 0.59 therefore charged for type nobody sets, and
     the budget refused forms that fit — "K. McCormack" is 78px in an 83.6px
     box and was being rejected for being 12 characters against a budget of
     11, which cost the initial the house form is built on. */
  /* 0.569, re-measured after the plaque moved to Baskerville. The 0.52 above
     is Univers Condensed and no longer describes this face: measured the same
     way, with a Range over a probe carrying the plaque's own resolved type,
     ten real names run 0.522 to 0.647 with a mean of 0.569 — about 9% more per
     character than the condensed face charged.
     The cost is real and worth naming: at 8-max on a phone the box is 81.1px,
     and "K. McCormack" is 100.8px in Baskerville against 78px in Univers, so
     the longest names now fall through the house form to the last name alone,
     which fits at 75.6px. Under-charging instead would not have kept the
     initial, it would have clipped it. */
  /* 0.52 again. The plaque went to Libre Baskerville and back, and the
     constant was re-measured on each face the same way — a Range over a
     probe carrying the plaque's own resolved type. Univers ROMAN, which it
     uses now, runs 0.465 to 0.575 across ten real names for a mean of 0.515:
     inside the noise of the 0.52 that was already here, so the number stays
     and only the evidence for it changed. Baskerville measured 0.569 and cost
     the initial on the longest names at 8-max, which is why it is not here. */
  /* 0.647 — Baskerville's WIDEST character, not its average. The plaque has
     now worn four cuts and each was measured the same way, with a Range over a
     probe carrying its resolved type: condensed 0.52, roman 0.515, extended
     0.635, Libre Baskerville 0.569 on average but 0.647 at its widest.
     Charging the average is what admits a name that does not fit — the ten
     real names happened to clear an 83.6px box by half a pixel, which is luck
     rather than a rule. At the widest cost the budget is a guarantee, and the
     size came down to 3.0cqmin so that guarantee still leaves eleven
     characters, which is where the house form lives. */
  /* 0.501 — the fifth cut, Univers Condensed OBLIQUE, measured the same way:
     ten real names run 0.396 to 0.501 with a mean of 0.442, the narrowest of
     the five. It is charged at its widest for the same reason Baskerville
     was, but here the guarantee is cheap: every house form clears the box by
     a wide margin, which is what paid for the size going back up to 3.4. */
  /* 0.445 — the sixth cut, Univers Condensed LIGHT, and the narrowest yet:
     ten real names run 0.359 to 0.445 against the oblique 400's 0.501. The
     hero wears the oblique of the same weight, and it was measured separately
     in case the slant cost width; it does not. Every string came back
     identical to the tenth of a pixel, because Univers' obliques are drawn on
     the roman's advance widths — so one constant covers both seats rather
     than the felt needing a budget per seat.
     Leaving 0.501 would have been safe but not free: it charges 13% more per
     character than the face costs, so a name would shorten to its house form
     while the full form still fit. */
  return Math.max(6, Math.min(30, Math.round(box / (px * 0.445))));
}


// ── Player name helpers ──
function getTableScanNames() {
  try {
    const raw = localStorage.getItem('tableScanPlayers');
    if (!raw) return null;
    const players = JSON.parse(raw);
    if (!Array.isArray(players) || players.length === 0) return null;
    return players;
  } catch { return null; }
}

function getSeatName(idx, heroIdx, heroName) {
  const scan = getTableScanNames();
  if (scan && scan.length > 0) {
    let heroScanIdx = scan.findIndex(p => p.isHero);
    if (heroScanIdx < 0) heroScanIdx = 0;
    const offset = (idx - heroIdx + scan.length) % scan.length;
    const scanIdx = (heroScanIdx + offset) % scan.length;
    if (scan[scanIdx] && scan[scanIdx].name) {
      if (idx === heroIdx) return heroName || scan[scanIdx].name;
      return scan[scanIdx].name;
    }
  }
  if (idx === 0) return heroName || 'Hero';
  return 'Opp ' + idx;
}

// ── Create empty hand ──
/* The hero's seat while a hand is entered. The hand's own heroIdx is the truth: matching the seat
   by the account's hero name lost the hero the moment that seat was renamed, fell back to seat 0,
   and moved them to whatever position seat 0 holds (MP1 at eight-handed). The name is only the
   fallback, for a hand saved before heroIdx existed. */
function entryHeroIdx(hand, heroName) {
  const n = hand.players.length;
  if (Number.isInteger(hand.heroIdx) && hand.heroIdx >= 0 && hand.heroIdx < n) return hand.heroIdx;
  const byName = hand.players.findIndex(p => p.name === (heroName || 'Hero'));
  return byName < 0 ? 0 : byName;
}

/* The blinds and the stack a new hand starts with, by game and by format.
   Tournament: 100/200, 50,000 behind, and a big-blind ante in the big-bet board games only (a limit
   game has none; a tournament's limit levels play without one). Stud is a small-bet / big-bet / ante
   game and says so: 200/400 with a 25 ante and a 50 bring-in, stacks at 30 big bets. The ante was 0
   once, which is not a stud game at all.
   Cash: 1/2 with 100 big blinds and no ante; stud is 20/40 with a 3 ante and a 5 bring-in.
   A limit street runs a bet and four raises (betCap 5). gameCfg.raiseCap said four, which is the
   other common house rule; hands saved without a cap keep it. */
function entryDefaults(gameType, gameMode) {
  const gameCfg = HAND_CONFIG[gameType] || HAND_CONFIG[String(gameType || '').replace(/^Super /, '')] || HAND_CONFIG_DEFAULT;
  const cash = gameMode === 'cash';
  if (gameCfg.isStud) {
    const blinds = cash
      ? { sb: 10, bb: 20, ante: 3, bigBet: 40, bringIn: 5, betCap: 5, uncapHeadsUp: true }
      : { sb: 100, bb: 200, ante: 25, bigBet: 400, bringIn: 50, betCap: 5, uncapHeadsUp: true };
    return { blinds, stack: blinds.bigBet * STUD_STACK_BB };
  }
  const isLimit = gameCfg.betting === 'fl';
  const blinds = cash
    ? { sb: 1, bb: 2, ante: 0 }
    : { sb: 100, bb: 200, ante: (gameCfg.hasBoard && !isLimit) ? 200 : 0 };
  if (isLimit) { blinds.betCap = 5; blinds.uncapHeadsUp = true; }
  return { blinds, stack: cash ? 200 : 50000 };
}

/* MTT or Cash. Blinds and stacks still on the other format's defaults follow the switch; anything
   the player typed stays, and so does a hand that already has betting in it. */
function withGameMode(h, gameMode) {
  if ((h.gameMode || 'mtt') === gameMode) return h;
  const next = { ...h, gameMode };
  if (h.gameType === 'OFC' || h.customConfig || (h.streets || []).some(s => (s.actions || []).length)) return next;
  const was = entryDefaults(h.gameType, h.gameMode || 'mtt');
  const now = entryDefaults(h.gameType, gameMode);
  const b = h.blinds || {};
  if (Object.keys(was.blinds).every(k => b[k] === was.blinds[k])) next.blinds = { ...b, ...now.blinds };
  if ((h.players || []).every(p => Number(p.startingStack) === was.stack)) {
    next.players = h.players.map(p => ({ ...p, startingStack: now.stack }));
  }
  return next;
}

function createEmptyHand(gameType, heroName) {
  const streetDef = getStreetDef(gameType);
  const gameCfg = HAND_CONFIG[gameType] || HAND_CONFIG[gameType.replace(/^Super /, '')] || HAND_CONFIG_DEFAULT;
  const scan = getTableScanNames();
  if (gameType === 'OFC') {
    const numPlayers = 2;
    return {
      gameType,
      players: Array.from({ length: numPlayers }, (_, i) => ({
        name: getSeatName(i, 0, heroName), position: i === 0 ? 'BTN' : 'BB', startingStack: 0
      })),
      blinds: { sb: 0, bb: 0, ante: 0 },
      streets: streetDef.streets.map(name => ({
        name, cards: { hero: '', opponents: [''], board: '' }, actions: [], draws: [],
      })),
      ofcRows: { 0: { top: '', middle: '', bottom: '' }, 1: { top: '', middle: '', bottom: '' } },
      gameMode: 'mtt', currency: 'USD',
      heroIdx: 0, result: null,
    };
  }
  const defaultNum = gameCfg.isStud ? 8 : 6;
  const numPlayers = scan ? Math.max(2, Math.min(10, scan.length)) : defaultNum;
  const positions = gameCfg.isStud ? getStudPositionLabels(numPlayers) : getPositionLabels(numPlayers);
  const start = entryDefaults(gameType, 'mtt');
  return {
    gameType,
    players: Array.from({ length: numPlayers }, (_, i) => ({
      name: getSeatName(i, 0, heroName), position: positions[i] || '', startingStack: start.stack
    })),
    blinds: start.blinds,
    streets: streetDef.streets.map(name => ({
      name, cards: { hero: '', opponents: Array.from({ length: numPlayers - 1 }, () => ''), board: '' }, actions: [], draws: [],
    })),
    gameMode: 'mtt', currency: 'USD',
    heroIdx: 0, result: null,
  };
}

// ── Pot and stack calculation ──
/* What a forced bet really takes: never more than the stack it comes from. A big blind with 800 was charged a
   1,000 blind and a 1,000 ante, the stack read -1,200, and the pot paid the winner 1,200 chips that never existed.
   A stack left blank (0, or a hand saved without one) is not a limit. Same order as the PokerTracker export
   (hand-history/prepare.js): the blind first, and the ante takes what is left. */
const capPost = (amount, stack) => {
  const a = amount || 0;
  return Number(stack) > 0 ? Math.min(a, Math.max(0, Number(stack))) : a;
};
/* The blind a seat really posted. */
function blindPosted(hand, playerIdx) {
  const p = hand.players[playerIdx];
  const b = hand.blinds || {};
  if (!p) return 0;
  if (p.position === 'SB' || p.position === 'BTN/SB') return capPost(b.sb, p.startingStack);
  if (p.position === 'BB') return capPost(b.bb, p.startingStack);
  return 0;
}
/* A post to come in at once (players[i].post: a seat taken at a play-money table that did not wait for the big
   blind), a live big blind from its own seat, capped at the stack. A hand with none (every hand but a table's) is
   as it was. */
function postIn(hand, playerIdx) {
  const p = hand.players[playerIdx];
  if (!p || !(Number(p.post) > 0) || getGameCategory(hand.gameType) === 'stud') return 0;
  return capPost(Number(p.post), p.startingStack);
}
/* Antes in the pot that are in no seat's street contribution: stud's from every seat, a big blind's once. */
function antesPosted(hand) {
  const ante = (hand.blinds && hand.blinds.ante) || 0;
  if (!ante) return 0;
  if (getGameCategory(hand.gameType) === 'stud') return hand.players.reduce((n, p) => n + capPost(ante, p.startingStack), 0);
  const bb = hand.players.find(p => p.position === 'BB');
  if (!bb) return ante;
  const stack = Number(bb.startingStack);
  return stack > 0 ? Math.min(ante, Math.max(0, stack - capPost(hand.blinds.bb, stack))) : ante;
}
/* Running chip totals, rounded to a millionth. A cash hand's amounts are dollars and cents, and binary
   floating point leaves residue when they are summed: $5.36 less $1.97 less $3.39 is 1.8e-15, not 0. A
   stack left at 1.8e-15 read as chips behind, so a player all in on a call was not all in, the side pots
   were cut at the wrong places and paid the wrong seats (2026-11-10: 41 of 100 cash hands with side pots,
   found by scripts/check-replayer-oracle.mjs). A millionth is far below a cent and far above the residue. */
const chipRound = (v) => Math.round(v * 1e6) / 1e6;
/* Cards that slide at the showdown to say which ones play (Replayer animations 16, 17, 20-23: the playing cards up, a hi-lo
   pot's halves, the winning five, a tabled all-in's leader raised through the run-out, the hero's made hand lifting as a
   run-out card lands, stud's five that play rising and the rest dropping to the down cards' place). Off (owner, 2026-11-15:
   "we can get rid of card sliding motions at showdown for now"; 2026-11-20: "stop sliding any cards at showdown to
   indicate which ones play"): every card stays where it was dealt. Dimming is not a slide and stays (a counterfeit, a
   stud card that does not play). */
const SHOWDOWN_SLIDES = false;
/* No card moves up or down on its own, at any step (owner, 2026-11-21: "cards in the replayer are STILL sliding up and
   down. STOP IT"). Off, every lift SHOWDOWN_SLIDES did not cover stays still: the hero's made hand lifting as a street
   lands (17), the stud door card at the bring-in (4), the half-r rise of a card turning face up (19/15, seventh street's
   too), a pat hand's rap toward the middle (11), a draw game's thrown cards rising before the draw (and a card marked
   on the felt in the drill), and the board row sliding up as a hand run twice parts into its runs (13). Cards still
   travel in from the dealer spot, turn over, dim, and go to the muck. */
const CARD_LIFTS = false;
/* An all-in's ring does not close onto its plaque from 1.35 times its size (Replayer animations 57): on the arm spring,
   damped short of critical, it shrank past the plaque and back while the turn's own ring was still fading on it, the
   "jittering" the owner saw round the hero's plaque (2026-11-21: "the highlight around hero's seat box is jittering
   and not smooth"). The plaque takes its purple border and glow in place, on its own transition. */
const RING_CLOSES = false;
/* Nothing on the felt goes or comes in a frame (owner, 2026-11-21: "Every single animation should be ultra smooth"):
   what may leave with no moment of its own fades out as a copy put back where it stood (a readout or the stud note,
   the main and side pots' row, a split's shares, the pile), and a pot pill new to the row fades in. A copy carries
   data-ghost, which every placement pass leaves out. */
const LEAVERS = '[data-name-seat], .replayer-pot-layers.is-placed:not([data-ghost]), .replayer-split-shares.is-placed:not([data-ghost]), .replayer-pot-above:not([data-ghost])';
const POT_PILLS = '.replayer-pot-layers.is-placed:not([data-ghost]) > *, .replayer-split-shares.is-placed:not([data-ghost]) > *';
/* The pot's pile draws the whole pot, as its figure does (owner, 2026-11-15: "This stack of chips should change to reflect the
   number in the pot"): wagers in front of the seats included, so a sweep moves chips into it without changing it. */
const PILE_IS_WHOLE_POT = true;
function calcPotsAndStacks(hand, upToStreet, upToAction) {
  const blinds = hand.blinds || { sb: 0, bb: 0, ante: 0 };
  const stacks = hand.players.map(p => p.startingStack);
  const category = getGameCategory(hand.gameType);
  const isBBante = category !== 'stud' && (blinds.ante || 0) > 0;
  let pot = 0;
  const post = (i, amount) => { const paid = capPost(amount, stacks[i]); stacks[i] = chipRound(stacks[i] - paid); pot = chipRound(pot + paid); };
  if (!isBBante) stacks.forEach((_, i) => post(i, blinds.ante));
  if (hand.streets.length > 0 && hand.streets[0].actions) {
    if (category !== 'stud') {
      const sbIdx = hand.players.findIndex(p => p.position === 'SB' || p.position === 'BTN/SB');
      const bbIdx = hand.players.findIndex(p => p.position === 'BB');
      if (sbIdx >= 0) post(sbIdx, blinds.sb);
      if (bbIdx >= 0) {
        const hadChips = Number(stacks[bbIdx]) > 0;
        post(bbIdx, blinds.bb);
        // A big blind all in on the blind has no ante to give (0 only means "no limit" before it posts).
        if (isBBante && !(hadChips && stacks[bbIdx] <= 0)) post(bbIdx, blinds.ante);
      }
      /* Straddles post with the blinds, before a card is dealt. */
      getStraddles(hand.players, blinds).forEach(st => post(st.seat, st.amount));
      hand.players.forEach((_, i) => { const x = postIn(hand, i); if (x > 0) post(i, x); });
    }
  }
  const folded = new Set();
  for (let si = 0; si <= upToStreet && si < hand.streets.length; si++) {
    const street = hand.streets[si];
    const maxAction = si === upToStreet ? upToAction : (street.actions ? street.actions.length - 1 : -1);
    for (let ai = 0; ai <= maxAction && street.actions && ai < street.actions.length; ai++) {
      const act = street.actions[ai];
      if (act.action === 'fold') { folded.add(act.player); continue; }
      if (act.amount && act.amount > 0) { stacks[act.player] = chipRound(stacks[act.player] - act.amount); pot = chipRound(pot + act.amount); }
    }
  }
  return { stacks, pot, folded };
}

/* Actions nobody could answer (owner, 2026-10-21): once every player still in but one is all in at
   the end of a street, the later streets are dealt out with no betting. A hand entered before the
   entry stopped asking can carry a bet there from the covering player; the replay drops it, as
   the entry now never records one. */
function dropDeadActions(hand) {
  if (!hand || !Array.isArray(hand.streets)) return hand;
  for (let si = 1; si < hand.streets.length; si++) {
    const prev = hand.streets[si - 1];
    const { stacks, folded } = calcPotsAndStacks(hand, si - 1, (prev.actions || []).length - 1);
    const inHand = hand.players.map((_, i) => i).filter(i => !folded.has(i));
    const withChips = inHand.filter(i => stacks[i] > 0);
    if (inHand.length > 1 && withChips.length <= 1) {
      if (!hand.streets.slice(si).some(s => (s.actions || []).length)) return hand;
      return { ...hand, streets: hand.streets.map((s, i) => i < si ? s : { ...s, actions: [] }) };
    }
  }
  return hand;
}

// ── Player street contribution ──
function computePlayerContrib(hand, streetIdx, actions, upToIdx, playerIdx) {
  let total = 0;
  const category = getGameCategory(hand.gameType);
  if (streetIdx === 0 && category !== 'stud') {
    total = blindPosted(hand, playerIdx);
    /* A straddler is already in for their straddle before acting, which is
       what stops the app charging them the full amount again to call. No seat
       can be both, so this never doubles a blind. */
    const st = getStraddles(hand.players, hand.blinds).find(x => x.seat === playerIdx);
    if (st) total = capPost(st.amount, hand.players[playerIdx].startingStack);
    const posted = postIn(hand, playerIdx);
    if (posted > 0) total = posted;
  }
  for (let i = 0; i <= upToIdx && i < actions.length; i++) {
    if (actions[i].player === playerIdx) {
      if (actions[i].action === 'bring-in') total = actions[i].amount || 0;
      else if (actions[i].action !== 'fold') total = chipRound(total + (actions[i].amount || 0));
    }
  }
  return total;
}

// ── Additional analysis helpers ──
/* Stack-to-pot at the current step — the hero's stack over the pot as it
   stands after the action on screen, so it moves with every bet and call
   (it was frozen at the street's opening pot). Postflop only. */
function calcSPR(hand, streetIdx, actionIdx = -1) {
  if (streetIdx <= 0) return null;
  // Not in a limit game: with the bet fixed, the stack-to-pot ratio decides nothing.
  const gt = String(hand.gameType || '');
  const cfg = HAND_CONFIG[gt] || HAND_CONFIG[gt.replace(/^Super /, '')];
  if (cfg && cfg.betting === 'fl') return null;
  const result = calcPotsAndStacks(hand, streetIdx, actionIdx);
  if (!(result.pot > 0)) return null;
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  const heroStack = result.stacks[heroIdx];
  // A hand saved without a starting stack yields NaN here, which toFixed turns
  // into the string "NaN" and which printed as "SPR NaN". No stack, no SPR.
  if (!Number.isFinite(heroStack) || heroStack <= 0) return null;
  return (heroStack / result.pot).toFixed(1);
}

function getBetSizingLabel(betAmount, potBeforeBet) {
  if (!betAmount || betAmount <= 0 || potBeforeBet <= 0) return null;
  const ratio = betAmount / potBeforeBet;
  if (ratio <= 0.28) return 'min';
  if (ratio <= 0.38) return '1/3 pot';
  if (ratio <= 0.55) return '1/2 pot';
  if (ratio <= 0.7) return '2/3 pot';
  if (ratio <= 0.85) return '3/4 pot';
  if (ratio <= 1.15) return 'pot';
  if (ratio <= 1.6) return '1.5x pot';
  if (ratio <= 2.2) return '2x pot';
  if (ratio <= 3.2) return '3x pot';
  return 'overbet';
}

function estimateRange(hand, playerIdx, upToStreet, upToAction) {
  let dominated = false, hasRaise = false, has3bet = false, hasCall = false, hasLimp = false, raiseCount = 0;
  for (let si = 0; si <= upToStreet && si < hand.streets.length; si++) {
    const maxAi = si === upToStreet ? upToAction : ((hand.streets[si].actions || []).length - 1);
    let streetRaiseCount = 0;
    for (let ai = 0; ai <= maxAi && ai < (hand.streets[si].actions || []).length; ai++) {
      const act = hand.streets[si].actions[ai];
      if (act.player !== playerIdx) { if (act.action === 'raise' || act.action === 'bet') streetRaiseCount++; continue; }
      if (act.action === 'raise' || act.action === 'all-in') { hasRaise = true; raiseCount++; if (streetRaiseCount >= 1) has3bet = true; }
      if (act.action === 'call') { hasCall = true; if (si === 0 && streetRaiseCount === 0) hasLimp = true; }
      if (act.action === 'fold') dominated = true;
    }
  }
  if (dominated) return null;
  if (has3bet || raiseCount >= 2) return { label: 'Strong', cls: 'replayer-range-strong' };
  if (hasRaise) return { label: 'Medium+', cls: 'replayer-range-medium' };
  if (hasLimp) return { label: 'Speculative', cls: 'replayer-range-speculative' };
  if (hasCall) return { label: 'Medium', cls: 'replayer-range-passive' };
  return null;
}

/* The odds tool's name for a replayer game (utils/odds.js ODDS_GAMES), for Showdown Equity, or null where it cannot
   play it (draw games, and anything it has no rules for). Limit and pot-limit forms play as their no-limit game. */
function oddsGameFor(gameType) {
  const g = String(gameType || '');
  if (ODDS_GAMES.some(x => x[0] === g)) return g;
  const map = { LHE: 'NLH', PLH: 'NLH', 'Limit Hold\'em': 'NLH', 'LO Hi': 'PLO', 'PLO Hi': 'PLO', O8: 'PLO8', NLO8: 'PLO8', 'Big O': 'NL Big O', 'PL Big O': 'NL Big O', 'Stud 8/b': 'Stud 8' };
  return map[g] || null;
}

function calcPotBeforeAction(hand, streetIdx, actionIdx) {
  if (actionIdx < 0) return calcPotsAndStacks(hand, streetIdx, -1).pot;
  return calcPotsAndStacks(hand, streetIdx, actionIdx - 1).pot;
}

// ── Player stats (placeholder) ──
const PLAYER_STATS_DATA = {};
function getPlayerStats(name) {
  if (PLAYER_STATS_DATA[name]) return PLAYER_STATS_DATA[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  hash = Math.abs(hash);
  const vpip = 15 + (hash % 35);
  const pfr = Math.max(5, vpip - 5 - (hash % 15));
  const ag = 1 + ((hash % 30) / 10);
  PLAYER_STATS_DATA[name] = { vpip, pfr, ag: ag.toFixed(1) };
  return PLAYER_STATS_DATA[name];
}

// ── Pot chip visual ──
function PotChipVisual({ amount }) {
  const stacks = potStacksFor(amount);
  return (
    <div className="replayer-pot-chips">
      {stacks.slice(0, 5).map((stack, i) => (
        <div key={i} className="replayer-pot-chip-stack">
          {Array.from({ length: Math.min(stack.count, 6) }, (_, j) => (
            /* The TOP chip paints last, over the ones beneath it — a stack
               hides all but an edge of each chip below. The bet chips already
               carried this; the pot's did not, and with flat ellipses it did
               not show. With a cylinder it does. */
            <div key={j} className="replayer-pot-chip-disc"
              style={{ '--chip': stack.color, ...chipInsertVars(pipShift(amount + i * 977, j), stack.color),
                zIndex: Math.min(stack.count, 6) - j }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* The pot's stacks for an amount: one stack per colour, largest denomination first (left to right),
   as PotChipVisual draws them. The spring sweep lands each ghost on its own colour's stack from this,
   without measuring the row it has not drawn yet. The chips add up to the pot (owner, 2026-11-16: "Pot still
   not showing the right amount of chips"): every denomination as many times as it goes, where it was five chips in
   all, so 71 was two 25s. Five stacks at most (the smallest go first, past that); no denomination but the
   largest comes more than four times, under the six a stack draws. */
function potStacksFor(amount) {
  let remaining = Math.floor(Math.abs(Number(amount) || 0));
  const stacks = [];
  for (const d of CHIP_DENOMS) {
    const n = Math.floor(remaining / d.value);
    if (n > 0) { stacks.push({ color: d.color, count: n }); remaining -= n * d.value; }
  }
  if (!stacks.length && Number(amount) > 0) stacks.push({ color: CHIP_DENOMS[CHIP_DENOMS.length - 1].color, count: 1 });
  return stacks.slice(0, 5);
}

/* The pile on the spring path. A sweep goes straight to the pile as it will be once every swept
   wager is in, never through the compositions of the amounts in between: a pot of 38,000 is three
   stacks, 50,000 one and 62,000 three again, and following the running total made stacks vanish while
   chips were being added to them. It does it in two beats (motion.setPile). As the chips leave the
   seats, the ROW becomes the final row (`layout`), each stack at the height it has now: a stack that
   stays makes room for the ones coming, on the critically damped yield spring (when the row's
   centring would shove it sideways in a frame); a stack new to the pile holds its place unseen
   (`hidden`); a stack leaving it is faded out where it was by the sweep (fadePileOut). At the first
   landing the HEIGHTS change, once, and each new stack fades in, in two frames, under the ghost that
   lands on it (settlePile). Only this small component re-renders. Stacks are keyed by colour, so a
   stack that is still there is the same element. A live value holds only until the parent next
   renders (motion.renderSeq), whose own figure is then the truth.

   At the result the pot leaves the pile for the winner: from the moment the shipped chips leave
   (motion.setPile(value, { shipped: true }), at their departure) the pile is drawn shipped, its
   stacks transparent, and each stack goes as its chip comes out from under it (emptyPile). The
   parent draws it shipped at any result it did not just press into (a jump, a step back to it), so
   the money is never on the felt twice. */
function PotChipLive({ amount, motion, set, shipped = false }) {
  const [live, setLive] = useState(null);
  const seq = motion.renderSeq;
  const isLive = !!live && live.seq === seq;
  const shown = isLive ? live.value : amount;
  const isShipped = isLive ? !!live.shipped : shipped;
  const hidden = isLive && live.hidden && live.hidden.length ? live.hidden : null;
  const layout = isLive && live.layout && live.layout.length ? live.layout : null;
  const now = potStacksFor(shown);
  // The final row at today's heights (a stack new to the pile is unseen, its height moot).
  const stacks = layout ? layout.map(c => now.find(x => x.color === c) || { color: c, count: 1 }) : now;
  const rowRef = useRef(null);
  const prevRef = useRef(null);
  useLayoutEffect(() => {
    motion.setPile = (value, opts) => {
      const update = () => setLive({
        seq: motion.renderSeq, value, shipped: !!(opts && opts.shipped), hidden: (opts && opts.hidden) || null,
        layout: (opts && opts.layout) || null, delay: (opts && opts.delay) || 0, fade: (opts && opts.fade) || 0,
      });
      // Same frame as the digits: synchronously, except inside a commit (React flushes it there).
      if (motion.inCommit) update(); else { try { flushSync(update); } catch (e) { update(); } }
    };
    return () => { motion.setPile = null; };
  }, [motion]);
  const hiddenKey = hidden ? hidden.join(',') : '';
  const layoutKey = layout ? layout.join(',') : '';
  useLayoutEffect(() => {
    const colors = stacks.map(s => s.color);
    const counts = stacks.map(s => Math.min(s.count, 6));
    const prev = prevRef.current;
    prevRef.current = { colors, counts, shipped: isShipped, hidden: hidden || [] };
    const row = rowRef.current;
    if (!isLive || !row || row.children.length !== colors.length || colors.length < 1) return;
    const kids = [...row.children];
    /* The row's pitch and a stack's size, as the moment measured them at the press: read here, after
       the digits were written, they forced a layout of the table at every landing (7ms of a 17ms
       task at a 4x CPU throttle). Measured only when no moment has. */
    const g = motion.pileGeom;
    let size, pitch;
    if (g && g.pitch > 0) { size = g.size; pitch = g.pitch; }
    else {
      const r0 = kids[0].getBoundingClientRect();
      size = { w: r0.width, h: r0.height };
      pitch = kids.length > 1 ? kids[1].getBoundingClientRect().left - r0.left
        : r0.width + (parseFloat(getComputedStyle(row).columnGap) || 0);
    }
    if (isShipped && !(prev && prev.shipped)) {
      emptyPile(motion, { set, rate: motion.rate || 1, stacks: kids.map(el => ({ el, size })) });
      return;
    }
    if (!prev || isShipped) return;
    const slot = (i, n) => i - (n - 1) / 2;
    const moves = [], reveals = [];
    colors.forEach((c, i) => {
      if (hidden && hidden.includes(c)) return;
      const j = prev.colors.indexOf(c);
      // New to the pile, or drawn unseen until now: a ghost has just landed on it.
      if (j < 0 || prev.hidden.includes(c)) reveals.push({ el: kids[i], size });
      if (j >= 0) moves.push({ el: kids[i], dx: (slot(j, prev.colors.length) - slot(i, colors.length)) * pitch, size });
    });
    if (moves.length || reveals.length) settlePile(motion, { set, rate: motion.rate || 1, moves, reveals, delay: (isLive && live.delay) || 0, fade: (isLive && live.fade) || 0 });
    /* A stack that stays and grows, where no chip lands on it (the opening's blinds): its new chips fade in rather
       than appear (owner, 2026-11-22). */
    if (isLive && live.fade > 0 && prev.counts) colors.forEach((c, i) => {
      const j = prev.colors.indexOf(c);
      if (j < 0 || !(counts[i] > prev.counts[j])) return;
      [...kids[i].children].slice(prev.counts[j]).forEach(d => motion.run(d, { key: { el: d, kind: 'disc-in' }, property: 'individual', size: { w: d.offsetWidth || 1, h: d.offsetHeight || 1 }, channels: [
        { prop: 'opacity', ramp: { from: 0, to: 1, delay: 0, duration: live.fade / (motion.rate || 1), ease: (q) => q * q * (3 - 2 * q) } },
      ] }));
    });
  }, [shown, isShipped, hiddenKey, layoutKey]);
  return (
    <div className={'replayer-pot-chips' + (isShipped ? ' is-shipped' : '')} ref={rowRef}>
      {stacks.map((stack, i) => (
        <div key={stack.color} data-color={stack.color}
          className={'replayer-pot-chip-stack' + (hidden && hidden.includes(stack.color) ? ' is-pending' : '')}>
          {Array.from({ length: Math.min(stack.count, 6) }, (_, j) => (
            <div key={j} className="replayer-pot-chip-disc"
              style={{ '--chip': stack.color, ...chipInsertVars(pipShift(amount + i * 977, j), stack.color),
                zIndex: Math.min(stack.count, 6) - j }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Card Row component ──
// Trig-based card splay: shared pivot point for natural fan.
// reverseZ flips the z-index ordering so the LEFTMOST card sits on top,
// which is how a player holds cards facing away from the viewer.
//
// That rationale only holds for face-DOWN backs. At showdown the revealed fan
// stacked leftmost-on-top, and the card faces carry their rank index ONLY at
// top-left — there is no bottom-right mirror — so every buried card showed
// nothing but a blank right edge and the opponent's hand was unreadable.
// Face-up cards therefore always fan rightmost-on-top, decided once for the
// whole row rather than card by card.
/* 35: the pivot was at 50% 120% — a point directly below the CENTRE of the
   hand, so the fan opened around a hinge under the middle of it and came out
   perfectly symmetrical. A hand pivots around the bottom corner nearest the
   thumb, which is why every real fan is lopsided. Symmetry is the tell.
   (2026-10: the lopsidedness is now SIDEWAYS only. The 18% pivot also tipped
   the right of every fan down and, with the growth, lifted single cards like
   stud up-cards — see getSplayStyle, where the pivot is now 50% 118% plus
   the sideways travel the 18% pivot gave.)

   34: and the fan was a pure 2D rotation, which is cards printed on a page.
   A real fan also lifts each successive card slightly out of the plane, so it
   grows a little and throws a longer shadow toward the top of the arc. */
/* The stud lift, as a share of the card's HEIGHT rather than a count of
   pixels. It was 5px, and 5px is a different lift on every table: measured,
   the card is 43.9px tall on a phone and 83.8px on a desktop, so the same
   constant was an 11.4% lift in one place and a 6.0% lift in the other —
   the up-card band all but closed on the size with the most room for it.
   0.114 is that phone lift, where it was tuned, expressed so it holds. */
const STUD_LIFT = 0.114;
const STUD_LIFT_UP = 'calc(var(--card-h) * -' + STUD_LIFT + ')';
const STUD_LIFT_DOWN = 'calc(var(--card-h) * ' + STUD_LIFT + ')';

/* The flat row, for when the splay is switched off. It was getting nothing at
   all — no z-order and no lift — and leaned entirely on a CSS ladder that
   stopped at the fifth card. */
function getFlatStyle(index, total, yOffset, reverseZ) {
  const style = { zIndex: reverseZ ? (total - index) : (index + 1) };
  if (yOffset) style.transform = 'translateY(' + yOffset + ')';
  return style;
}

/* The largest hand the replayer deals: two down, four up, one down. */
const FAN_SLOTS = 7;

function getSplayStyle(index, total, angle, yOffset, reverseZ, fanTotal, spanScale = 1) {
  if (total <= 1) return {};
  /* The step is per CARD and fixed by the size of the FINISHED hand, not by
     how many cards have arrived. Dividing the whole arc among the cards on the
     table meant three cards fanned as wide as seven would, and every card
     dealt afterwards shuffled all of them inward — a hand that rearranged
     itself on every street instead of growing.
     Fixing the step and centring on (total-1)/2 puts any n cards exactly where
     the middle n will sit when the hand is finished: 3rd street holds the
     middle three of the seven, and 4th street adds one to each side without
     moving them. */
  /* ONE reservation for every game, not each game's own finished size.
     The step was derived from how many cards the GAME ends with, so the same
     number of cards on the table produced a different fan depending on which
     game dealt them. Measured at five cards: 2-7 triple draw stepped 10.37
     degrees against stud's 5.49 on fifth street — 1.9x — and its five-card fan
     spanned 4.13 card widths against 3.66 for a COMPLETE seven-card stud hand.
     A draw hand was wider than a finished stud hand.
     Seven is the largest hand the replayer deals, so reserving it everywhere
     means the spacing is identical at every count in every game, and no fan
     ever has to re-tighten as cards arrive — which is the property the stud
     layout was built around, now generalised rather than special-cased. */
  const slots = FAN_SLOTS;
  /* Both the arc's radius and the step are sized on the FINISHED hand, so the
     fan does not change curve or spacing as cards arrive. Measured: a side
     seat sits 15.6% in from the table's edge, which caps a fan at about 2.4
     card widths across — 1.2 out from centre. The hero sits at the bottom with
     no neighbour and the whole width to itself. */
  /* One radius for both seats. `wide` used to change the arc's curve as well
     as its span, which made the hero's hand a different SHAPE from everyone
     else's rather than the same shape opened further. It now changes the span
     only. */
  const radiusCards = slots <= 5 ? 2.4 : 3.0;
  /* The step is the FOUR-card step, the spacing a PLO hand has always had, so
     a stud hand on 4th street is the same shape as one rather than a tighter
     version of itself. It narrows only when the finished hand would hang off
     the cloth; where the cap does not bind nothing changes, and a four-card
     hand at a side seat reaches 0.58 of the 1.2 it is allowed. */
  /* The cap is on the outermost card's CENTRE, but what has to stay on the
     cloth is its EDGE — so the footprint is 2*half + one card width, which is
     what 1.2 forgot. Measured at 6-max portrait: a side seat sits 15.7% in
     from the table's edge, 60px of a 382px table, against a 43px card; half a
     card is 21.5px, leaving 38.5px = 0.9 card widths for the half-span. At 1.2
     the fan ran from -5.3% to 36.7% and hung 21px off the table.
     0.78 leaves margin (0.85 hung 3px over, 0.8 by 1px) and still opens wider than the
     0.726 the fan had before it was given a constant step. */
  /* 0.85 is the cap for a SIDE seat and it is at its limit: measured at 6-max
     portrait with a seven-card stud hand, those fans clear the table's edge by
     1.7px. So the cap cannot rise for everyone.
     The hero is not that seat. It sits at the bottom with no neighbour and
     133px of clearance to the same edge, which is what the `wide` flag was
     added for and then never switched on. 1.05 opens its footprint from 2.7
     card widths to 3.1 — a sixth wider, and still 120px short of anything.
     Not the 1.8 that was sitting here unused: that is more than double the
     side seats' fan and would have made the hero's hand a different object,
     rather than the same one with room to breathe. */
  /* ONE span for every seat, so every hand on the table covers itself by the
     same fraction of a card. Measured on seven-card hands, the hero was
     showing 0.642 of each card covered against an opponent's 0.700 — the
     hero's fan was the loose one and every other hand read as a tighter
     object.
     It matches DOWNWARD, and that direction is forced. Opening the opponents
     to the hero's 1.05 was built and measured: with every seat carrying seven
     cards, all six portrait side seats hang 6.7 to 7.6px off the table, and
     landscape is worse — the extreme side seats, which gained a cell outward,
     overflow by 14.5 to 15.1px at 8-max and 5.9px at 10-max. The largest
     uniform span that fits is about 0.89, which is inside the noise of the
     0.85 the side seats already ran at, so 0.85 is the value and the hero
     gives up the cell of spread it had alone. */
  const maxHalfSpan = 0.85;
  const halfSlots = (slots - 1) / 2;
  const baseStep = (2 * angle) / 3;
  const cappedStep = halfSlots > 0
    ? Math.asin(Math.min(1, maxHalfSpan / radiusCards)) * (180 / Math.PI) / halfSlots
    : baseStep;
  /* spanScale is the viewer's Splay slider, 0..1 of the fan the table can hold.
     It scales the settled step so the fan tightens uniformly at every card
     count — the cap already fixed the wide end, this opens the narrow one. */
  const step = Math.min(baseStep, cappedStep) * spanScale;
  const rot = (index - (total - 1) / 2) * step;
  const extraY = yOffset || '';
  const z = reverseZ ? (total - 1 - index) : index;
  // The lift runs along the arc, not with the z-order, so a reversed fan still
  // lifts in the direction the hand is held.
  const lift = index / Math.max(1, total - 1);
  const scale = 1 + lift * 0.05;
  const shadow = 'drop-shadow(' + (-1 - lift * 2).toFixed(1) + 'px '
    + (1 + lift * 2).toFixed(1) + 'px ' + (2 + lift * 3).toFixed(1) + 'px rgba(0,0,0,0.5))';
  /* Hold'em and Omaha hands were drawn with a stud lift they never asked for.
     Nothing stud-specific leaked in — the lift came from the fan itself, in two
     parts, both of them the transform ORIGIN, which sat at 18% 118%: below the
     card and left of its centre.
     1. The growth. scale() grows a card about the origin, and an origin 118%
        down the card turns a 5% growth into a 0.05 x 1.18 = 5.9%-of-height
        LIFT of the top edge — half the 11.4% stud lift, on the last card and
        proportionally on every card before it.
     2. The rotation. Turning a card about a point left of its centre moves the
        centre DOWN by 0.32 x width x sin(angle) on the right of the fan and UP
        by the same on the left — an antisymmetric tilt that has nothing to do
        with the arc, and which the growth had been partly cancelling.
     The bottom of a held hand is behind the plaque, so the top edge is all of
     a card anyone sees move. Measured on a hold'em hero at 402x874 the K index
     sat 4.25px (0.072 of the card) above the A beside it: a door card beside a
     hole card. A four-card Omaha hand stepped 5.7px up from A to J.
     So both are anchored on the card's own centre line. The rotation turns
     about 50% 118%, directly under the centre, and `swing` puts back the
     -0.32 x width x (1 - cos) of sideways travel the old origin gave, so the
     fan opens exactly as wide as it did; only the antisymmetric drop is gone.
     The growth is anchored on the card's TOP edge, at the 18% the old origin
     stood on (a translate of (s-1) x (32%, 118%) before the scale), so the
     card still grows toward the viewer and sideways exactly as it did, but
     down behind the plaque, without its top edge moving. What remains vertically is
     the arc, which is symmetric about the middle card, and the stud lift — the
     only thing that lifts a card again. */
  const rad = rot * Math.PI / 180;
  const swing = (-32 * (1 - Math.cos(rad))).toFixed(3) + '%';
  const grow = scale === 1 ? '' : ' translate(' + ((scale - 1) * 32).toFixed(3) + '%, '
    + ((scale - 1) * 118).toFixed(3) + '%) scale(' + scale.toFixed(3) + ')';
  if (total <= 2) {
    return {
      transform: 'translateX(' + swing + ') rotate(' + rot + 'deg)' + grow,
      transformOrigin: '50% 118%',
      marginLeft: index === 0 ? 0 : 'calc(var(--card-w) * -0.65)',
      marginTop: extraY || undefined,
      filter: 'brightness(1) ' + shadow,   // brightness first, as when dimmed, so the two blend
      zIndex: z,
    };
  }
  // 3+ cards: arc from a true shared pivot point using trig.
  /* In CARD WIDTHS, not pixels. A fixed 66px arc holds its shape only at the
     size the cards happened to be when it was chosen: at a phone's 34px card
     it advances each card about 0.55 of a width, which reads as a hand, and at
     a desktop's 82px card the same 66px advances 0.08 of a width, which reads
     as a stack with the corners poking out. Same fault as the px floors on
     --card-h, the plaque's min-width and the chip disc — an absolute length on
     an object the table scales.

     2.2 rather than the 1.94 that 66px worked out to on a phone: it was a
     little tight there as well. */
  /* Measured: a side seat sits 15.6% in from the table's edge, so half a fan
     cannot exceed that without hanging off the cloth — which caps the arc at
     about 2.4 card widths, an advance of 0.40 per card. The HERO has no
     neighbour to crowd; it sits at the bottom centre with the whole width to
     itself, so its hand opens properly. */
  /* The step is the FOUR-card step — the spacing a PLO hand has always had —
     so a stud hand on 4th street is the same shape as one rather than a
     tighter version of itself.
     It narrows only when the finished hand would hang off the cloth. The
     existing measurement is that a side seat sits 15.6% in from the table's
     edge, which caps a fan at about 2.4 card widths across, so 1.2 out from
     centre; the hero sits at the bottom with no neighbour and the whole width
     to itself. Where the cap does not bind nothing changes at all: a four-card
     hand at a side seat reaches 0.58, less than half of it. */
  /* The -9 here shifted every fan nine pixels left of the seat it belongs
     to. The comment above explains the PIVOT being left of centre, which is
     about which way the arc opens and needs no translation at all: the arc is
     symmetric about rot=0, so the only thing the constant did was take the
     hand off its plaque. Measured: card ink sat 8px left of the plaque's
     centre on every seat at every size. */
  const x = Math.sin(rad) * radiusCards;
  const y = (1 - Math.cos(rad)) * radiusCards;
  return {
    position: 'absolute',
    left: '50%',
    bottom: 0,
    transform: 'translate(calc(-50% + ' + swing + ' + ' + x.toFixed(3) + ' * var(--card-w)), calc('
      + y.toFixed(3) + ' * var(--card-w)' + (extraY ? ' + ' + extraY : '') + ')) rotate('
      + rot + 'deg)' + grow,
    transformOrigin: '50% 118%',
    filter: 'brightness(1) ' + shadow,   // brightness first, as when dimmed, so the two blend
    zIndex: z,
  };
}

/* How long a displaced card takes to travel round the fan after a draw, and
   how many points of the arc it is sampled at. The sample count only has to
   make the path read as a curve at card scale; 16 chords of a <=30deg arc
   deviate from it by well under a pixel. */

/* The D1/PAT run under a draw-game plaque, the same distance below it at every seat (styles.css). */
function DrawBadge({ history }) {
  return (
    <div className="replayer-seat-draw-badge"
      title={history.map(h => h === 'PAT' ? 'stood pat' : 'drew ' + h.slice(1)).join(', then ')}>
      {history.join('/')}
    </div>
  );
}

// The entry's notes box, hidden for now (2026-10-01). Flip back to true to restore it.
const SHOW_ENTRY_NOTES = false;

/* The D on the dealer button, centred on its INK - as an outline, not as text.
   It was a <span> flex-centred in the disc, which centres the TEXT BOX, and a
   capital's box is not its ink: the em box runs from ascender to descender, so
   a D (baseline to cap height, nothing below) sits high in it, by an amount
   that depends on WHICH ascent and descent the engine reads. Univers Bold
   carries hhea 724/-276 and win 938/250 with USE_TYPO_METRICS off, so Apple's
   WebKit and Windows' engines put the same glyph at different heights in the
   same box. CSS text-box trimming centred it live, but the exporters' DOM clone
   (modern-screenshot) drops text-box, and the exported D sat 4-7% of the disc
   low; an SVG <text> placed by its baseline then came out up to 6% of the disc
   off in the export, where the clone's text snaps on its own grid.
   So the D is Univers Bold's own outline (univers-bold.woff2, glyph "D", bbox
   65,0..676,721 in a 1000-unit em), scaled to 62 units of a 100-unit box -
   0.62 of the disc, a cap height of 45% of its diameter, the 47% it had on a
   phone - and translated so its ink box is centred on (50, 50) BY
   CONSTRUCTION: x 31.06..68.94, y 27.65..72.35. No font loads, no metric and
   no renderer can move it off the disc's centre. fill is currentColor, so the
   themes' button colours still apply. The two offset copies are the engraving
   the span's text-shadow drew (a light edge below, a dark one above). */
const DEALER_D_PATH = 'M31.06 72.35V27.65L45.88 27.71Q55.86 27.71 61.31 31.74Q65.28 34.66 67.11 39.37Q68.94 44.08 68.94 49.35Q68.94 59.08 64.45 64.85Q59.95 70.61 53.07 71.86Q50.4 72.35 45.01 72.35ZM40.79 34.9V64.97Q42.9 65.1 44.58 65.1Q48.23 65.1 50.65 64.51Q53.07 63.92 54.99 62Q59.02 57.97 59.02 49.35Q59.02 44.2 57.04 40.45Q55.05 36.7 50.84 35.52Q47.55 34.59 40.79 34.9Z';
const DEALER_D_ENGRAVE = 3.5;
function DealerGlyph() {
  return (
    <svg className="replayer-dealer-glyph" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d={DEALER_D_PATH} transform={'translate(0 ' + DEALER_D_ENGRAVE + ')'} className="dg-light" />
      <path d={DEALER_D_PATH} transform={'translate(0 ' + -DEALER_D_ENGRAVE + ')'} className="dg-dark" />
      <path d={DEALER_D_PATH} className="dg-face" />
    </svg>
  );
}

const FAN_SLIDE_MS = 460;
const FAN_SLIDE_SAMPLES = 16;
const FAN_SLIDE_EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
/* Plays the animations in `held` (paused by the caller, now or later in the same task) once frames are flowing again
   (owner, 2026-11-22: "Opp 2's cards are jumping around as the hand gets wider"): a stud street's commit runs about
   190ms before its first frame, and the frames after it are themselves the moments' own work (300 to 600ms measured in
   WebKit), so a slide started in the commit had covered 85% of its way by the first frame anyone saw. Started on two
   frames in a row under 50ms apart, 250ms at most (a machine whose frames never come that close: headless WebKit).
   Only what is still paused: a card the moments effect deals in cancels its own (a cancelled one would play again). */
function playWhenFramesFlow(held) {
  const go = () => held.forEach(a => { try { if (a.playState === 'paused') a.play(); } catch (e) { /* gone */ } });
  let lastT = 0, firstT = 0;
  const tick = (t) => {
    if (!firstT) firstT = t;
    if ((lastT && t - lastT < 50) || t - firstT > 250) go(); else { lastT = t; requestAnimationFrame(tick); }
  };
  requestAnimationFrame(tick);
}
/* `measure()` with every finite animation on `els` jumped to just before its end, each put back after it in the same
   task, so nothing is painted in between: the pieces as they will rest. A finished one is already there, and is left
   alone so it does not finish twice. */
function atRest(els, measure) {
  const saved = [];
  els.forEach(el => el.getAnimations().forEach(a => {
    const end = a.effect ? a.effect.getComputedTiming().endTime : NaN;
    const t = a.currentTime;
    if (!Number.isFinite(end) || t == null || a.playState === 'finished' || t >= end - 0.01) return;
    try { a.currentTime = Math.max(0, end - 0.01); saved.push([a, t]); } catch (e) { /* measured as drawn */ }
  }));
  try { return measure(); } finally { saved.forEach(([a, t]) => { try { a.currentTime = t; } catch (e) { /* gone */ } }); }
}
/* A seat's card row moved by (dx, dy) on the screen's edge or off the replay's buttons glides there over the fan's own
   slide, started on the same frame, so the hand never steps. A glide still running is taken over from where it is. */
function glideRow(el, dx, dy) {
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
  if (typeof el.animate !== 'function') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let fx = -dx, fy = -dy;
  const old = el.getAnimations().filter(a => a.id === 'row-edge');
  if (old.length) {
    const t = (getComputedStyle(el).translate || '').split(' ');
    fx += parseFloat(t[0]) || 0;
    fy += parseFloat(t[1]) || 0;
    old.forEach(a => a.cancel());
  }
  const a = el.animate([{ translate: `${fx.toFixed(2)}px ${fy.toFixed(2)}px` }, { translate: '0px 0px' }],
    { duration: FAN_SLIDE_MS, easing: FAN_SLIDE_EASE, fill: 'backwards' });
  a.id = 'row-edge';
  a.pause();
  playWhenFramesFlow([a]);
}

/* A stud player's cards on the entry screens, streets 3rd to `uptoStreet`, in the order dealt, each marked down or
   up (owner, 2026-11-22: "there is no indication of hero's upcards"; "show the hands up to this point" on the deal
   screen). The hero's 3rd street is two down and the door, 4th to 6th up, 7th down. An opponent's hidden cards are
   backs (the entry has not been told them yet), the door and the up cards as entered, a missing one a back. */
function studRunFor(hand, pi, heroIdx, uptoStreet) {
  const run = [];
  const isHero = pi === heroIdx;
  const oppSlot = pi < heroIdx ? pi : pi - 1;
  for (let si = 0; si <= uptoStreet && si < (hand.streets || []).length; si++) {
    const cs = (hand.streets[si] && hand.streets[si].cards) || {};
    const raw = isHero ? (cs.hero || '') : ((cs.opponents || [])[oppSlot] || '');
    const cards = raw === 'MUCK' ? [] : parseCardNotation(raw).filter(c => c.suit !== 'x').map(c => c.rank + c.suit);
    if (si === 0) {
      // Super (utils/super-stud.js): four down and the door until the throw after 3rd street's betting.
      const extra = hand.superStud && uptoStreet === 0 ? SUPER_DOWN - 2 : 0;
      if (isHero) {
        const thrown = extra ? parseCardNotation(cs.heroThrown || '').filter(c => c.suit !== 'x').map(c => c.rank + c.suit) : [];
        cards.slice(0, 2).forEach(c => run.push({ card: c, down: true }));
        for (let k = 0; k < extra; k++) run.push({ card: thrown[k] || null, down: true });
        cards.slice(2, 3).forEach(c => run.push({ card: c, down: false }));
      } else {
        for (let k = 0; k < 2 + extra; k++) run.push({ card: null, down: true });
        run.push({ card: cards.length ? cards[cards.length - 1] : null, down: false });
      }
    } else {
      const seventh = si === 4;
      run.push({ card: isHero || !seventh ? (cards[0] || null) : null, down: seventh });
    }
  }
  return run;
}
function StudRun({ run }) {
  return (
    <div className="card-row gto-card-run">
      {run.map((c, k) => c.card
        ? <img key={k} className={'card-img' + (c.down ? ' is-down' : '')} src={cardFaceSrc(c.card)} alt={c.card + (c.down ? ', down' : ', up')} loading="eager" />
        : <div key={k} className={'card-unknown' + (c.down ? ' is-down' : '')} />)}
    </div>
  );
}

/* A saved hand's title, renamed in place (owner, 2026-11-22: "we should be able to edit the hand titles if we want
   to"): a tap turns it into a field holding the typed title (empty where the app built it, the built one shown as the
   placeholder); Enter or leaving the field saves, Escape keeps it. An emptied field goes back to the built title. */
function TitleEditor({ shown, typed, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const ref = useRef(null);
  const cancelled = useRef(false);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);
  if (!canEdit) return <>{shown}</>;
  if (!editing) {
    return (
      <button type="button" className="replayer-title-btn" title="Rename" aria-label={'Rename: ' + shown}
        onClick={() => { cancelled.current = false; setVal(typed || ''); setEditing(true); }}>{shown}</button>
    );
  }
  const done = (save) => {
    if (cancelled.current) return;
    cancelled.current = true;
    setEditing(false);
    const t = val.trim();
    if (save && t !== (typed || '')) onSave(t);
  };
  return (
    <input ref={ref} className="replayer-title-input" value={val} placeholder={shown} maxLength={120} aria-label="Hand title"
      onChange={e => setVal(e.target.value)} onBlur={() => done(true)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } }} />
  );
}

function CardRow({ text, stud, studDown, max, placeholderCount, splay, splayScale = 1, reverseZ, discardIdx, onCardTap, poseOf, playIds, holdSort = 0 }) {
  /* Draw-game re-sort. A card keeps its DOM element for as long as it stays in
     the hand (keyed by identity, below), so when a draw puts a new card among
     them this can see where each surviving card was and where it is now, and
     move it there ROUND THE FAN. A CSS transition between the two transforms
     would cut across the chord; the fan is a rotation about one pivot and the
     angle is linear in the card's index, so a fractional index is a point on
     the arc - sampled into keyframes, the whole path stays on it. The drawn
     cards fade in behind the slide rather than appearing under a card that is
     still passing through their slot. */
  const rowRef = useRef(null);
  const prevFan = useRef(null);
  const fanNow = useRef(null);
  useLayoutEffect(() => {
    const now = fanNow.current;
    const prev = prevFan.current;
    prevFan.current = now;
    const row = rowRef.current;
    if (!now || !prev || !row) return;
    if (prev.max !== now.max || prev.splay !== now.splay || prev.splayScale !== now.splayScale) return;
    // Two-card splayed hands use the overlap layout, not the arc.
    if (now.splay && (prev.total <= 2 || now.total <= 2)) return;
    if (typeof row.animate !== 'function') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const moves = [];
    const arrivals = [];
    for (const el of row.children) {
      const k = el.dataset && el.dataset.ck;
      if (!k || !now.byKey.has(k)) continue;
      const to = now.byKey.get(k).i;
      if (!prev.byKey.has(k)) { arrivals.push(el); continue; }
      // The old slot, re-expressed in the new hand's frame: the arc is centred
      // on the middle card, so a hand that changed length re-centres.
      const from = prev.byKey.get(k).i - (prev.total - 1) / 2 + (now.total - 1) / 2;
      if (Math.abs(from - to) > 1e-6) moves.push({ el, from, to, y: now.byKey.get(k).y });
    }
    if (!moves.length) return;
    // Every slide is held at its first keyframe until frames flow (playWhenFramesFlow).
    const held = [];
    const hold = (a) => { try { a.pause(); held.push(a); } catch (e) { /* plays as it was */ } return a; };
    playWhenFramesFlow(held);
    if (!now.splay) {
      /* Flat row: slots are a straight line one STEP apart (a card's width less
         the Overlap setting), centred like the arc, so the same re-expressed
         slot difference times the step is how far each card has to travel.
         The step is a card's width plus the (negative) left margin that sets the
         overlap, both fractional px; offsetLeft rounds to whole px and started
         each slide up to a pixel off its old slot. The card's own vertical
         lift (a stud up-card, a discard) rides along untouched. */
      const kids = [...row.children];
      const k1 = kids[1] || kids[0];
      const step = k1 ? k1.getBoundingClientRect().width + (kids[1] ? parseFloat(getComputedStyle(kids[1]).marginLeft) || 0 : 0) : 0;
      if (!step) return;
      for (const m of moves) {
        const base = m.el.style.transform || '';
        hold(m.el.animate([
          { transform: ('translateX(' + ((m.from - m.to) * step).toFixed(2) + 'px) ' + base).trim() },
          { transform: base || 'none' },
        ], { duration: FAN_SLIDE_MS, easing: FAN_SLIDE_EASE, delay: holdSort, fill: 'backwards' }));
      }
      // Held (Replayer animations 10): the new cards are dealt into the gaps by the moments effect.
      if (!holdSort) for (const el of arrivals) {
        hold(el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }],
          { duration: FAN_SLIDE_MS, easing: 'ease-out', fill: 'backwards' }));
      }
      return;
    }
    for (const m of moves) {
      const frames = [];
      for (let s = 0; s <= FAN_SLIDE_SAMPLES; s++) {
        const f = m.from + (m.to - m.from) * (s / FAN_SLIDE_SAMPLES);
        frames.push({ transform: getSplayStyle(f, now.total, now.splay, m.y, now.reverseZ, now.max, now.splayScale).transform });
      }
      hold(m.el.animate(frames, { duration: FAN_SLIDE_MS, easing: FAN_SLIDE_EASE, delay: holdSort, fill: 'backwards' }));
    }
    if (!holdSort) for (const el of arrivals) {
      hold(el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }],
        { duration: FAN_SLIDE_MS, easing: 'ease-out', fill: 'backwards' }));
    }
  });
  let cards = parseCardNotation(text);
  if (!cards.length && placeholderCount > 0) {
    return (
      <div className={"card-row" + (splay ? " card-row-splay" : "")}>
        {Array.from({ length: placeholderCount }, (_, i) => {
          const style = { '--ci': i, ...(splay ? getSplayStyle(i, placeholderCount, splay, 0, reverseZ, placeholderCount, splayScale) : null) };
          return <div key={'ph' + i} className="card-placeholder" style={style} />;
        })}
      </div>
    );
  }
  if (!cards.length) return null;
  if (max && cards.length > max) cards = cards.slice(0, max);
  // studDown: a Super 3rd street's four down cards before the door (utils/super-stud.js); else the 2nd, 3rd and 7th.
  const downIdx = stud ? new Set(studDown || [0, 1, 6]) : null;
  /* One z-order for the whole row. reverseZ exists for a hand that is face
     DOWN, where putting the leftmost card on top buries no rank because there
     are none. Deciding it per CARD mixed the two orders inside one hand: a
     stud hand's two down cards took the reversed order and sat on top of the
     up cards beside them, burying exactly the ranks the fan exists to show.
     So it reverses only when nothing in the row is face up. */
  const rowReverseZ = reverseZ && !cards.some((c, i) => c.suit !== 'x' && !(downIdx && downIdx.has(i)));
  // Identity keys (the card, plus which copy of it for repeated backs), so a
  // card that changes SLOT keeps its element - see the re-sort effect above.
  const seenKey = {};
  const cardKeys = cards.map(c => { const id = c.rank + c.suit; seenKey[id] = (seenKey[id] || 0) + 1; return id + '#' + seenKey[id]; });
  const fanByKey = new Map();
  fanNow.current = { byKey: fanByKey, total: cards.length, splay, max, splayScale, reverseZ: rowReverseZ };
  return (
    <div ref={rowRef} className={"card-row" + (splay ? " card-row-splay" : "")}>
      {cards.map((c, i) => {
        const k = cardKeys[i];
        const isDown = downIdx && downIdx.has(i);
        const isStudUp = stud && !isDown && i >= 2 && i <= 5;
        // A discarded card (draw games) lifts UP exactly the way a stud up-card
        // does, and dims — see the seat render, which flags the thrown cards the
        // moment the d1/d2/pat badge appears.
        const isDiscard = discardIdx && discardIdx.has(i);
        // Stud at showdown: the cards that do not play dim where they were dealt (with SHOWDOWN_SLIDES on, the five that
        // play would also rise as up cards and the rest drop to the down cards' place).
        const plays = playIds && c.suit !== 'x' ? playIds.has(c.rank + c.suit) : null;
        // A thrown card only dims while CARD_LIFTS is off (owner, 2026-11-21): it no longer rises.
        const studYOffset = plays != null && SHOWDOWN_SLIDES ? (plays ? STUD_LIFT_UP : STUD_LIFT_DOWN)
          : isStudUp ? STUD_LIFT_UP : isDown ? STUD_LIFT_DOWN : (isDiscard && CARD_LIFTS ? STUD_LIFT_UP : '');
        // A revealed face never reverses: the rank index lives at top-left only,
        // so leftmost-on-top buries every rank but the first.
        // 63: --ci is the card's place in the hand. The per-card deal
        // stagger multiplies it by one round of the table, so a hand is dealt
        // one card at a time round the seats rather than arriving as a block.
        /* Both paths get the lift and the z-order now. Switching the splay off
           used to drop both: measured on a seven-card stud row, the tops had a
           0.0px spread and the sixth and seventh cards came out `z-index:auto`,
           which paints them UNDER the ladder above — so the last card's ink
           began where the fifth card's ended and the row read as though it had
           a full card's gap in it. */
        fanByKey.set(k, { i, y: studYOffset });
        const splayStyle = { '--ci': i, ...(splay
          ? getSplayStyle(i, cards.length, splay, studYOffset, rowReverseZ, max, splayScale)
          : getFlatStyle(i, cards.length, studYOffset, rowReverseZ)),
          ...(isDiscard ? { opacity: 0.4 } : null),
          // A card marked on the felt eases back when it is unmarked, as well as out.
          ...(isDiscard || onCardTap ? { transition: CARD_LIFTS ? 'transform 260ms var(--ease-out), opacity 260ms var(--ease-out)' : 'opacity 260ms var(--ease-out)' } : null) };
        /* The drill's draw: the card itself is the control (owner, 2026-11-04). Fanned cards overlap, and
           each takes the taps on the part of it that shows. */
        const id = c.rank + c.suit;
        const tap = onCardTap ? {
          role: 'button', tabIndex: 0, draggable: false, 'aria-pressed': !!isDiscard,
          'aria-label': (isDiscard ? 'Throwing ' : 'Keeping ') + id,
          onClick: (e) => { e.stopPropagation(); onCardTap(id); },
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onCardTap(id); } },
        } : null;
        const tapClass = tap ? ' card-tap' : '';
        if (c.suit === 'x' || (isDown && c.suit === 'x')) {
          return <div key={k} data-ck={k} className="card-unknown" style={splayStyle} />;
        }
        // A standing pose (Replayer animations 16-18, 20-23): raised, sunk or dead, on the translate property.
        /* Under playIds the lift above already says which cards play, so a raising or sinking pose would move them
           a second time. Every card that does not play dims ('dead'), in every shown hand (owner, 2026-11-14: "Also
           dim the cards that don't play"), not only the winner's. */
        const pose0 = poseOf ? poseOf.get(id) : undefined;
        const pose = plays != null ? (plays ? undefined : 'dead') : pose0;
        return <img key={k} data-ck={k} className={'card-img' + tapClass}
          src={cardFaceSrc(c.rank + c.suit)}
          alt={c.rank+c.suit} loading="eager" data-pose={pose || undefined}
          /* A fanned card carries its shadow as an inline filter, which the stylesheet's darkening cannot reach. */
          style={pose === 'dead' && splayStyle.filter ? { ...splayStyle, filter: String(splayStyle.filter).replace(/^brightness\(1\) /, 'brightness(0.42) ') } : splayStyle} {...tap} />;
      })}
    </div>
  );
}

// ── Replayer settings ──
/* 69: `swatch` is that theme's felt, lifted from the gradient the theme rule
   already paints, so the pill shows what it does instead of only naming it. */
/* `lit` and `shade` are the theme's own two felt stops, so the panel's
   thumbnail is the felt rather than a colour that stands for it. */
const REPLAYER_THEMES = [
  { id: 'default', label: 'Default', lit: null, shade: '#2c2e50' },
  { id: 'casino-royale', label: 'Casino Royale', lit: '#2a5c8f', shade: '#0b1a2e' },
  { id: 'high-stakes', label: 'High Stakes', lit: '#3a3a3a', shade: '#101010' },
];
/* Neon Vegas, Vintage and Minimalist were retired (2026-09-30). A viewer who had
   one saved — or a shared hand seeded with one — falls back to Default rather
   than rendering a theme the picker can no longer select. */
const REPLAYER_THEME_IDS = new Set(REPLAYER_THEMES.map(t => t.id));

function useReplayerSetting(key, defaultVal, seed) {
  const fullKey = 'replayer' + key;
  const [val, setVal] = useState(() => {
    // A seed (from a shared hand) wins over the viewer's stored value on mount,
    // without being written back — so a link's felt shows without clobbering
    // the viewer's own setting.
    if (seed !== undefined && seed !== null) return seed;
    const stored = localStorage.getItem(fullKey);
    if (stored === null) return defaultVal;
    if (defaultVal === true || defaultVal === false) return stored === 'true';
    return stored;
  });
  const update = useCallback(v => { setVal(v); localStorage.setItem(fullKey, String(v)); }, [fullKey]);
  return [val, update];
}

// A live thumbnail of the hole-card fan at the current Splay Amount, drawn with
// the same getSplayStyle the table uses so the slider previews the real thing.
function SplayPreview({ scale }) {
  const n = 4;
  return (
    /* Grid: a 6g x 5r cell (62x40px before, measured 65.2x38.6 at 402), and a
       1.2g x 2.5r card (13x19px before: 13.04x19.29). */
    <div style={{ position: 'relative', width: 'calc(var(--gu) * 6)', height: 'calc(var(--subrow) * 5)', flex: '0 0 auto', '--card-w': 'calc(var(--gu) * 1.2)', alignSelf: 'center' }}>
      {Array.from({ length: n }, (_, i) => {
        const st = getSplayStyle(i, n, 15, 0, false, n, scale);
        return (
          <div key={i} style={{
            width: 'calc(var(--gu) * 1.2)', height: 'calc(var(--subrow) * 2.5)', borderRadius: 'calc(var(--subrow) * 0.25)',
            background: 'linear-gradient(155deg, #f6f3ec, #d9d3c5)',
            boxShadow: 'inset 0 0 0 calc(var(--subrow) * 0.0625) rgba(0,0,0,0.28)',
            ...st,
          }} />
        );
      })}
    </div>
  );
}

/* The felt-and-splay controls, shared by the full settings panel and the
   table-settings dropdown on the replay screen, so the two can never drift.
   Text sits in .rs-cell > .rs-t: a whole-r cell, bottom-aligned, with the
   trimmed line inside it, so every baseline lands on an r-line. */
const FELT_SWATCHES = [
  { name:'Lavender', color:'#6b5b8a' }, { name:'Classic Green', color:'#2d5a27' },
  { name:'Blue', color:'#1a3a5c' }, { name:'Red', color:'#5a1a1a' },
  { name:'Purple', color:'#3d1a5a' }, { name:'Black', color:'#1a1a1a' },
];
function FeltSwatchRow({ value, onChange, disabled }) {
  return (
    <div className={'replayer-settings-swatches' + (disabled ? ' is-disabled' : '')}>
      {FELT_SWATCHES.map(fc => (
        <span key={fc.color} className="rs-swatch-cell">
          <button className={'felt-color-swatch' + (value === fc.color ? ' active' : '')}
            style={{ '--swatch': fc.color }} title={fc.name} aria-label={fc.name}
            aria-pressed={value === fc.color} disabled={disabled}
            onClick={() => onChange(fc.color)} />
        </span>
      ))}
      {/* 68: this was a 24px rectangle sitting in a row of circles. */}
      <span className="rs-swatch-cell">
        <span className="felt-color-custom" title="Custom color">
          <input type="color" value={value} aria-label="Custom felt color" disabled={disabled}
            onChange={e => onChange(e.target.value)} />
        </span>
      </span>
    </div>
  );
}
function SettingToggleRow({ label, sub, on, onToggle, ariaLabel }) {
  return (
    <div className={'replayer-settings-row' + (sub ? ' has-sub' : '')}>
      <div className="rs-text">
        <div className="replayer-settings-label rs-cell"><span className="rs-t">{label}</span></div>
        {sub && <div className="replayer-settings-sublabel rs-cell"><span className="rs-t">{sub}</span></div>}
      </div>
      <button className={'replayer-settings-toggle' + (on ? ' on' : '')}
        aria-pressed={!!on} aria-label={ariaLabel || label}
        onClick={() => onToggle(!on)} />
    </div>
  );
}
/* onChange fires on every input event, not on release, so the table re-fans
   while the thumb is still moving. */
function SplayAmountSlider({ value, onChange, preview }) {
  const v = Number(value) || 0;
  return (
    <div className={'rs-splay' + (preview ? ' has-preview' : '')}>
      {preview && <SplayPreview scale={v / 100} />}
      <input type="range" className="gto-raise-slider rs-splay-slider" min={0} max={175} step={5}
        value={v} aria-label="Splay amount"
        onInput={e => onChange(Number(e.target.value))}
        onChange={e => onChange(Number(e.target.value))} />
      <span className="rs-splay-pct rs-cell"><span className="rs-t">{v}%</span></span>
      {preview && <button className="btn btn-ghost btn-sm rs-splay-reset" onClick={() => onChange(100)} title="Reset splay to default"><span className="rs-t">Reset</span></button>}
    </div>
  );
}

/* Flat-row overlap, 0% (cards side by side) to 90% (nearly stacked). Shown
   instead of the splay amount while splay is off; applies on every input event
   so the row re-lays while the thumb moves. */
function CardOverlapSlider({ value, onChange }) {
  const v = Number(value ?? 52) || 0;
  return (
    <div className="rs-splay">
      <input type="range" className="gto-raise-slider rs-splay-slider" min={0} max={90} step={2}
        value={v} aria-label="Card overlap"
        onInput={e => onChange(Number(e.target.value))}
        onChange={e => onChange(Number(e.target.value))} />
      <span className="rs-splay-pct rs-cell"><span className="rs-t">{v}%</span></span>
    </div>
  );
}

/* The table-settings dropdown: the five controls that change how the table
   LOOKS, on the replay screen itself, so a change — the splay above all — is
   judged against the real table while it happens. Anchored under its button,
   right edges flush, snapped to whole g / whole r. Kept narrow and to the
   right so the hero's fan and the table centre stay in view. */
function TableQuickSettings({ anchorRef, onClose, settings, onUpdate, onAll = null }) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current; if (!a) return;
      const g = Math.min(window.innerWidth, 430) / 37, r = g * 0.71;
      const rc = a.getBoundingClientRect();
      // Right edge on the button's right edge; top one r under its bottom.
      // The dropdown is a layer, so its left edge goes on a g line of the SHELL (a desktop
      // window centres the shell, so those lines are not the window's): the nearest one to 17g
      // left of the button's right edge. 0 offset on a phone.
      const shell = document.querySelector('.app-shell');
      const ox = shell ? shell.getBoundingClientRect().left : 0;
      setPos({ right: Math.round((rc.right - ox) / g), top: Math.round(rc.bottom / r) + 1, ox });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchorRef]);
  useEffect(() => {
    const onDown = e => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      onClose();
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [anchorRef, onClose]);
  const feltLocked = settings.theme !== 'default';
  return createPortal(
    <div ref={panelRef} className="replayer-quick-settings" role="dialog" aria-label="Table settings"
      /* Keys inside the panel (arrows on the slider) must not step the replay. */
      onKeyDown={e => e.stopPropagation()}
      style={pos ? { top: 'calc(var(--subrow) * ' + pos.top + ')', left: 'calc(' + (pos.ox || 0) + 'px + var(--gu) * ' + (pos.right - 17) + ')' } : { visibility: 'hidden' }}>
      <div className="replayer-settings-label rs-cell rs-head"><span className="rs-t">Felt colour</span></div>
      <FeltSwatchRow value={settings.feltColor} disabled={feltLocked} onChange={v => onUpdate('feltColor', v)} />
      {feltLocked && <div className="replayer-settings-sublabel rs-cell rs-note"><span className="rs-t">Felt colour applies to the Default theme</span></div>}
      <SettingToggleRow label="Bright felt" on={settings.feltBright} onToggle={v => onUpdate('feltBright', v)} />
      <SettingToggleRow label="Rail light strip" on={settings.lightStrip} onToggle={v => onUpdate('lightStrip', v)} />
      <SettingToggleRow label="Stacks in BB" on={settings.stacksInBB} onToggle={v => onUpdate('stacksInBB', v)} />
      <SettingToggleRow label="Splay" ariaLabel="Splay hole cards" on={settings.cardSplay} onToggle={v => onUpdate('cardSplay', v)} />
      {settings.cardSplay
        ? <SplayAmountSlider value={settings.splayAmount} onChange={v => onUpdate('splayAmount', v)} />
        : (<>
            <div className="replayer-settings-label rs-cell rs-head"><span className="rs-t">Overlap</span></div>
            <CardOverlapSlider value={settings.cardOverlap} onChange={v => onUpdate('cardOverlap', v)} />
          </>)}
      {/* The one way to every setting (UX pick 65): the sheet was a second entry, a gear, with a
          different icon and four of the same switches. */}
      {onAll && (
        <button type="button" className="rs-all" onClick={() => { onClose(); onAll(); }}>
          <span className="rs-all-label">All settings</span><span className="rs-all-chev" aria-hidden="true">{'\u203A'}</span>
        </button>
      )}
    </div>,
    document.body
  );
}

// ── Settings Panel ──
function ReplayerSettingsPanel({ onClose, settings, onUpdate }) {
  /* Every row is the shared SettingToggleRow: label and gloss each in whole-r
     cells with the trimmed line seated on the cell's bottom r-line. The
     per-group arrays were five copies of the same eight lines. */
  const rows = (list) => list.map(opt => (
    <SettingToggleRow key={opt.key} label={opt.label} sub={opt.sub}
      on={settings[opt.key]} onToggle={v => onUpdate(opt.key, v)} />
  ));
  const groupTitle = (text) => <div className="replayer-settings-group-title rs-cell"><span className="rs-t">{text}</span></div>;
  /* The sheet is a whole number of g (53 at most) centred on the window, but
     the window's centre is on one of the shell's g lines only when the shell
     and the sheet are both an odd or both an even number of g — a desktop
     shell can be either, and a classic scrollbar adds a fraction. So measure,
     and shift the sheet by the remainder: its left edge on the nearest shell
     line, its controls on that line's grid. 0 on a phone. */
  const panelRef = useRef(null);
  const [shiftG, setShiftG] = useState(0);
  useLayoutEffect(() => {
    const place = () => {
      const el = panelRef.current, shell = document.querySelector('.app-shell');
      if (!el || !shell) return;
      const g = Math.min(window.innerWidth, 430) / 37;
      const centred = (document.documentElement.clientWidth - el.offsetWidth) / 2;
      const shellLeft = shell.getBoundingClientRect().left;
      const k = Math.round((centred - shellLeft) / g);
      const s = (shellLeft + k * g - centred) / g;
      setShiftG(Math.abs(s) < 0.005 ? 0 : Math.round(s * 1e4) / 1e4);
    };
    place();
    window.addEventListener('resize', place);
    // The desktop shell re-sizes itself a render after the window does.
    const shell = document.querySelector('.app-shell');
    const ro = shell && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (ro) ro.observe(shell);
    return () => { window.removeEventListener('resize', place); if (ro) ro.disconnect(); };
  }, []);
  return createPortal(
    <>
      <div className="replayer-settings-backdrop" onClick={onClose} />
      <div ref={panelRef} className="replayer-settings-panel"
        style={shiftG ? { marginLeft: 'calc(var(--gu) * ' + shiftG + ')' } : undefined}>
        <div className="replayer-settings-header">
          <span className="rs-cell"><span className="rs-t">Replayer Settings</span></span>
          <button className="replayer-settings-close" onClick={onClose} aria-label="Close settings"><Icon.x /></button>
        </div>
        <div className="replayer-settings-group">
          {groupTitle('Table')}
          <div className="replayer-settings-row is-stacked">
            <div className="replayer-settings-label rs-cell"><span className="rs-t">Theme</span></div>
            <div className="replayer-settings-pills">
              {REPLAYER_THEMES.map(t => (
                /* 79: five of the six choices in this group are purely
                   visual and four of them were text pills — Casino Royale and
                   Vintage differed only in the words. Choosing how something
                   LOOKS from a list of words is the clearest place in the
                   feature where it is described rather than shown. The
                   gradients already existed; the thumbnail is the felt with
                   its rail and two cards on it. */
                <button key={t.id} className={'replayer-settings-thumb' + (settings.theme === t.id ? ' active' : '')}
                  aria-pressed={settings.theme === t.id}
                  onClick={() => onUpdate('theme', t.id)}>
                  <span className="thumb-felt" aria-hidden="true"
                    style={{ '--thumb-lit': t.lit || settings.feltColor, '--thumb-shade': t.shade || '#2c2e50' }}>
                    <i /><i />
                  </span>
                  <span className="thumb-label rs-cell"><span className="rs-t">{t.label}</span></span>
                </button>
              ))}
            </div>
          </div>
          {settings.theme === 'default' && (
            <div className="replayer-settings-row is-stacked">
              <div className="replayer-settings-label rs-cell"><span className="rs-t">Felt Color</span></div>
              <FeltSwatchRow value={settings.feltColor} onChange={v => onUpdate('feltColor', v)} />
            </div>
          )}
          {/* The two felt-lighting switches sit with the colour they light —
              directly under the swatches. Kept OUTSIDE the default-theme gate
              above, unlike the swatches themselves: the rail strip is themed on
              every table (each theme sets its own strip colour, styles.css:6048+),
              so gating it to default would hide a working control on five themes.
              Bright Felt is grouped here with it rather than off among the card
              switches. */}
          {rows([
            { key:'feltBright', label:'Bright Felt', sub:'A lit cloth instead of the dark one — the same felt colour, lit brighter.' },
            { key:'lightStrip', label:'Rail Light Strip' },
          ])}
        </div>
        <div className="replayer-settings-group">
          {groupTitle('Cards')}
          {/* 70: only the high-contrast toggle three rows up had aria-pressed
              and a label. Every other switch in this panel — Splay, Rail
              Light, seven Display rows and five Animation rows — was a bare
              <button> with no text inside, which is an unnamed, stateless
              control to a screen reader: thirteen buttons all announcing
              "button". The pattern was already written; it just stopped. */}
          {rows([
            { key:'highContrastDeck', label:'High-Contrast Deck', sub:'Lifts the suits off the felt' },
          ])}
          {/* The back every face-down card wears (utils/card-back.js), shown as two of it on the felt. Only the designs
              this account has: with just the standard one there is nothing to choose, so the row is left out. */}
          {availableCardBacks().length > 1 && (
          <div className="replayer-settings-row is-stacked">
            <div className="replayer-settings-label rs-cell"><span className="rs-t">Card Back</span></div>
            <div className="replayer-settings-pills">
              {availableCardBacks().map(b => (
                <button key={b.id} className={'replayer-settings-thumb' + (settings.cardBack === b.id ? ' active' : '')}
                  aria-pressed={settings.cardBack === b.id} aria-label={'Card back: ' + b.label}
                  onClick={() => onUpdate('cardBack', b.id)}>
                  <span className="thumb-felt is-backs" aria-hidden="true"
                    style={{ '--thumb-lit': settings.theme === 'default' ? settings.feltColor : (REPLAYER_THEMES.find(t => t.id === settings.theme) || {}).lit || settings.feltColor, '--thumb-shade': '#2c2e50' }}>
                    <i data-back={b.id} /><i data-back={b.id} />
                  </span>
                  <span className="thumb-label rs-cell"><span className="rs-t">{b.label}</span></span>
                </button>
              ))}
            </div>
          </div>
          )}
          <SettingToggleRow label="Splay Hole Cards" on={settings.cardSplay} onToggle={v => onUpdate('cardSplay', v)} />
          {settings.cardSplay && (
            <div className="replayer-settings-row is-stacked">
              <div className="rs-text">
                <div className="replayer-settings-label rs-cell"><span className="rs-t">Splay Amount</span></div>
                <div className="replayer-settings-sublabel rs-cell"><span className="rs-t">How wide the hole-card fan opens</span></div>
              </div>
              <SplayAmountSlider preview value={settings.splayAmount} onChange={v => onUpdate('splayAmount', v)} />
            </div>
          )}
          {!settings.cardSplay && (
            <div className="replayer-settings-row is-stacked">
              <div className="rs-text">
                <div className="replayer-settings-label rs-cell"><span className="rs-t">Overlap</span></div>
                <div className="replayer-settings-sublabel rs-cell"><span className="rs-t">How much each flat card covers the one before it</span></div>
              </div>
              <CardOverlapSlider value={settings.cardOverlap} onChange={v => onUpdate('cardOverlap', v)} />
            </div>
          )}
        </div>
        <div className="replayer-settings-group">
          {groupTitle('Display')}
          {/* 80: twelve switches in one undifferentiated column is a
              preferences pane. Two groups is a set of decisions — what is on
              the felt, and what is analysis laid over it. */}
          {rows([
            { key:'showChipStacks', label:'Pot Chip Stacks', sub:'Chips in the pot, by denomination' },
            { key:'showPlayerStats', label:'Player Stats', sub:'A stats chip on each seat' },
            { key:'hideOppNames', label:'Hide Opponent Names', sub:'Show opponents as Opponent 1, 2, … — your name stays' },
            { key:'stacksInBB', label:'Stacks in Big Blinds', sub:'Every stack and the pot counted in big blinds' },
            { key:'showResults', label:'Show Results', sub:'Your net under a finished replay and on each saved hand' },
          ])}
        </div>
        {/* 80: the analysis overlays are a different kind of decision from
            "what is on the felt", and there are seven of them. Closed by
            default, because a first-time reader is not looking for SPR. */}
        <details className="replayer-settings-group replayer-settings-fold">
          <summary className="replayer-settings-group-title"><span className="rs-cell"><span className="rs-t">Analysis overlays</span></span></summary>
          {rows([
            { key:'showPotOdds', label:'Pot Odds', sub:'The price you are being laid, when facing a bet' },
            { key:'showNutsHighlight', label:'Highlight the Nuts', sub:'A glow when you hold the best hand' },
            { key:'showSPR', label:'Stack-to-Pot Ratio', sub:'SPR under the pot, from the flop on' },
            { key:'showBetSizing', label:'Bet Sizing', sub:'A pot-relative label on each wager' },
            { key:'showRanges', label:'Range Read', sub:'An estimated strength tier per opponent' },
            { key:'showEquity', label:'Showdown Equity', sub:'Each all-in hand’s chance while cards are to come' },
          ])}
        </details>
        <div className="replayer-settings-group">
          {groupTitle('Animation')}
          {rows([
            /* 57: the panel promised Winner Effects and animateWinner was
               never read anywhere — the glow applied unconditionally — while
               animateDeal, whose sub-line said "cards slide in when dealt",
               was actually gating the FOLD animation, the showdown reveal and
               draw discards, and the deal animation did not exist. Each switch
               now controls the thing it names. */
            { key:'animateFold', label:'Fold & Muck', sub:'Folded cards slide away to the muck' },
            { key:'animateChips', label:'Chip Animation', sub:'The pot ships to the winner' },
            { key:'animateBoard', label:'Board Flip', sub:'Board cards flip face-up' },
          ])}
          {/* How a folded hand leaves (owner, 2026-11-27: "Let's make a few more folding motions"; FOLD_STYLES in
              utils/replayer-card-moments.js). Random, the default, gives each fold one of them (Stud flip under in stud);
              Off is Behind the seat for everyone (owner, 2026-11-28). */}
          {settings.animateFold && (
            <div className="replayer-settings-row is-stacked">
              <div className="rs-text">
                <div className="replayer-settings-label rs-cell"><span className="rs-t">Fold Motion</span></div>
                <div className="replayer-settings-sublabel rs-cell"><span className="rs-t">How a folded hand leaves the table</span></div>
              </div>
              <div className="replayer-settings-pills is-text" role="radiogroup" aria-label="Fold motion">
                {FOLD_STYLES.map(f => (
                  <button key={f.id} type="button" role="radio" aria-checked={settings.foldStyle === f.id}
                    className={'replayer-settings-choice ctl' + (settings.foldStyle === f.id ? ' active' : '')}
                    onClick={() => onUpdate('foldStyle', f.id)}>{f.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

/* A figure typed into the entry: "2.5", "1,500", "$200", "25k", "1.5m". Spaces and currency signs
   are ignored, a comma only where it groups thousands, and k and m are thousands and millions. A
   cash hand keeps cents; a tournament's chips are whole. Anything else is refused with a reason
   rather than half read: the fields used to keep the digits of whatever was typed, so "2.5" became
   25, "1,500" became 500 and "-40" became 40 (entry audit 20). Empty is 0. */
function parseAmount(text, { cents = false } = {}) {
  let s = String(text == null ? '' : text).trim().toLowerCase().replace(/[\s\p{Sc}]/gu, '');
  if (s === '') return { value: 0 };
  if (s.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?[km]?$/.test(s)) return { error: 'Not a number' };
    s = s.replace(/,/g, '');
  }
  const m = s.match(/^(\d+(?:\.\d*)?|\.\d+)([km])?$/);
  if (!m) return { error: 'Not a number' };
  const raw = parseFloat(m[1]);
  const v = m[2] === 'k' ? raw * 1e3 : m[2] === 'm' ? raw * 1e6 : raw;
  if (!Number.isFinite(v) || v > 1e12) return { error: 'Too large' };
  const r2 = Math.round(v * 100) / 100;
  if (!cents && Math.abs(v - Math.round(v)) > 1e-9) return { error: 'Whole chips only' };
  if (cents && Math.abs(v - r2) > 1e-9) return { error: 'Cents at most' };
  return { value: cents ? r2 : Math.round(v) };
}

/* An amount input. While it has the focus it shows what was typed, so "2." stays "2." until the 5
   arrives; every keystroke that reads as a number goes to the hand at once. Text that does not read
   is marked and said under the field, and leaving the field puts the last good figure back and says
   so. The field's clear-on-focus is utils/numeric-focus-clear.js: nothing here pushes '' on focus. */
function AmountField({ value, onCommit, cents = false, blankZero = false, disabled = false, placeholder, ariaLabel, style, prefix = null, wrap = false }) {
  const [text, setText] = useState(null);
  const [note, setNote] = useState(null);
  const errId = useRef('amt-' + Math.random().toString(36).slice(2, 9)).current;
  const shown = text != null ? text : (value === '' || value == null || (blankZero && !Number(value)) ? '' : String(value));
  const parsed = text != null ? parseAmount(text, { cents }) : null;
  const error = parsed && parsed.error ? parsed.error : note;
  const input = (
      <input type="text" inputMode="decimal" value={shown} disabled={disabled}
        className={parsed && parsed.error ? 'is-invalid' : undefined}
        aria-invalid={parsed && parsed.error ? true : undefined}
        aria-label={ariaLabel} aria-describedby={error ? errId : undefined}
        placeholder={placeholder} style={style}
        onChange={e => {
          const t = e.target.value;
          setText(t); setNote(null);
          const r = parseAmount(t, { cents });
          if (r.error == null && Number(r.value) !== Number(value)) onCommit(r.value);
        }}
        onBlur={() => {
          if (text == null) return;
          const r = parseAmount(text, { cents });
          setText(null);
          setNote(r.error ? r.error + ': kept ' + (blankZero && !Number(value) ? 'blank' : String(value === '' || value == null ? 0 : value)) : null);
        }} />
  );
  return (
    <>
      {prefix || wrap ? <div className="gto-stack-wrap">{prefix}{input}</div> : input}
      {error && <div className="replayer-field-error" id={errId} role="alert">{error}</div>}
    </>
  );
}

/* Cards typed into a field: "Ah 7d 2c", "ah7d2c", "10h" (read as T). Returns the cards, whether the
   last one is still being typed, and, when the text cannot be right, why: something that is not a
   card, a card twice, a card already dealt, or more cards than the place holds. "10h 7d 2c" was read
   as a different hand and "zz" was taken without a word (entry audit 9, 29). */
function readTypedCards(text, { max = 99, used = null, ranks = '23456789TJQKA' } = {}) {
  const s = String(text || '').replace(/10/g, 'T')
    .replace(/[\u2665\u2661]/g, 'h').replace(/[\u2666\u2662]/g, 'd').replace(/[\u2663\u2667]/g, 'c').replace(/[\u2660\u2664]/g, 's')
    .replace(/[\s,\-\u2013\u2014/|.]+/g, '').replace(/\uFE0F/g, '');
  const cards = [];
  for (let i = 0; i < s.length; i += 2) {
    const r = s[i].toUpperCase();
    const su = (s[i + 1] || '').toLowerCase();
    if (!su && ranks.includes(r)) return { cards, pending: true, error: null };
    if (!ranks.includes(r) || !'hdcs'.includes(su)) return { cards, pending: false, error: '"' + s.slice(i, i + 2) + '" is not a card' };
    cards.push(r + su);
  }
  const seen = new Set();
  for (const c of cards) {
    if (seen.has(c)) return { cards, pending: false, error: c + ' is in twice' };
    seen.add(c);
    if (used && used.has(c)) return { cards, pending: false, error: c + ' is already dealt' };
  }
  if (cards.length > max) return { cards, pending: false, error: 'At most ' + max + ' cards here' };
  return { cards, pending: false, error: null };
}

// ══════════════════════════════════════════════════════════
// ── GTOEntryView (GTO-style phased hand entry) ──────────
// ══════════════════════════════════════════════════════════
function GTOEntryView({ hand, setHand, onDone, onCancel, heroName, resume = null, onProgress = null, jump = null, names = null }) {
  /* One fixed bar on every step (UX pick 58): the action steps had a fixed footer, while Next sat at
     the foot of setup, Continue mid-screen on board steps and Save & Replay 383 pt down the result;
     on card steps the Hands tool row stood where the bar should be, one tap from leaving the hand.
     Each step's buttons are portalled into the same footer, Undo or Back at its left, the primary at
     its right edge (styles.css .gto-foot-row.is-step). */
  const footBar = (children) => createPortal(
    <div className="gto-sticky-footer">
      <div className="gto-street-card">
        <div className="gto-btn-row gto-foot-row is-step">{children}</div>
      </div>
    </div>,
    document.querySelector('.app-shell.is-desktop') || document.body
  );
  /* Every screen here is drawn from the hand plus (phase, street), so an unfinished hand reopens
     where it was left and Edit opens a finished one on its result: `resume` is that place, read
     once, and `onProgress` reports each move so the draft can remember it. */
  const [phase, setPhase] = useState(() => entryPlace(resume, hand).phase);
  // Which seat is under the finger, so the row it belongs to can show it.
  const [dragSeat, setDragSeat] = useState(null);
  const [currentStreetIdx, setCurrentStreetIdx] = useState(() => entryPlace(resume, hand).streetIdx);
  // The hero's discards tapped on the Draw Round before the count is declared (UX pick 60).
  const [drawMarks, setDrawMarks] = useState([]);
  useEffect(() => { setDrawMarks([]); }, [currentStreetIdx, phase]);
  useEffect(() => { if (onProgress) onProgress({ phase, streetIdx: currentStreetIdx }); }, [phase, currentStreetIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  // The header's Edit (UX pick 57): back to setup, the hand kept.
  // Only a press made while this entry is open: the one held from an earlier entry is not obeyed.
  const jumpSeen = useRef(jump);
  // A jump may name a street too (the step strip's buttons, owner 2026-11-22: "buttons that took the user directly to
  // that street to edit").
  useEffect(() => {
    if (jump && jump !== jumpSeen.current && jump.phase) {
      jumpSeen.current = jump;
      if (Number.isInteger(jump.streetIdx) && jump.streetIdx >= 0 && jump.streetIdx < (hand.streets || []).length) setCurrentStreetIdx(jump.streetIdx);
      setPhase(jump.phase);
    }
  }, [jump]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showRaiseInput, setShowRaiseInput] = useState(false);
  const [betAmount, setBetAmount] = useState('');
  // Why Confirm refused the typed bet or raise; typing again clears it.
  const [betError, setBetError] = useState(null);
  useEffect(() => { setBetError(null); }, [betAmount, showRaiseInput]);
  const [showHeroCardPicker, setShowHeroCardPicker] = useState(false);
  const [studDealTarget, setStudDealTarget] = useState(0);
  // Super's throw screen: the cards picked so far (null: the throw recorded, else the deal's last two down cards).
  const [superPick, setSuperPick] = useState(null);
  // The OFC entry phase's card picker. Declared with the other hooks: inside the phase's branch it
  // changed the hook count when Next opened it, and React threw "Rendered more hooks" (entry audit D5).
  const [ofcPickerState, setOfcPickerState] = useState(null);
  // Which board the board step is dealing to: double board's 2nd, or a run's (utils/poker-engine.js).
  const [boardSlot, setBoardSlot] = useState(0);
  const activeSeatRef = useRef(null);
  // The effective stack (owner, 2026-11-26: renamed from "Buy-in cap"; the state and its storage key
  // keep the old name): remembered across hands, and a one-tap way to put every seat back on it (a
  // fresh full-stack table).
  const [buyinCap, setBuyinCap] = useState(() => {
    try { const s = localStorage.getItem('replayerBuyinCap'); if (s) return s; } catch { /* ignore */ }
    return String((hand.players && hand.players[0] && hand.players[0].startingStack) ?? '');
  });
  const toast = useToast();
  // Why Setup's Next or the Result's Save stayed put, named over the buttons; any edit clears it.
  const [phaseError, setPhaseError] = useState(null);
  useEffect(() => { setPhaseError(null); }, [hand, phase]);
  /* Names you have entered before (owner, 2026-11-23: "an autopopulate function for the name fields"): the focused
     name field offers the players of your saved hands under it, the one the table's order puts in that seat first
     (utils/player-names.js). A pick fills the seat and moves on to the next seat nobody has named. */
  const [nameSeat, setNameSeat] = useState(null);  // the name field that has focus
  const [nameHi, setNameHi] = useState(-1);        // the offer the arrow keys are on
  const nameInputs = useRef([]);
  const nameBlur = useRef(null);
  const nameFocused = useRef(false);
  useEffect(() => () => clearTimeout(nameBlur.current), []);
  const [proNames, setProNames] = useState(null);
  useEffect(() => {
    if (nameSeat == null || proNames) return undefined;
    let on = true;
    loadProNames().then((list) => { if (on && list) setProNames(list); });
    return () => { on = false; };
  }, [nameSeat, proNames]);
  /* The offer sits under its field, so on a phone it can open under the keyboard or the step's footer: the list
     scrolls it into what is left of the screen, 1r clear (again as the keyboard comes up). */
  const nameTyped = nameSeat != null && hand.players && hand.players[nameSeat] ? String(hand.players[nameSeat].name || '') : null;
  useEffect(() => {
    if (nameSeat == null) return undefined;
    const reveal = () => {
      const strip = document.getElementById('gto-names-' + nameSeat);
      if (!strip) return;
      const vv = window.visualViewport;
      let limit = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const foot = document.querySelector('.gto-sticky-footer');
      if (foot) { const top = foot.getBoundingClientRect().top; if (top > 0) limit = Math.min(limit, top); }
      const over = strip.getBoundingClientRect().bottom + unitR() - limit;
      const scroller = strip.closest('.content-area');
      if (over > 0 && scroller) scroller.scrollBy({ top: over });
    };
    const t = setTimeout(reveal, 0);
    const vv = window.visualViewport;
    if (vv) vv.addEventListener('resize', reveal);
    return () => { clearTimeout(t); if (vv) vv.removeEventListener('resize', reveal); };
  }, [nameSeat, nameTyped]);
  const resetStacks = () => {
    const cap = Number(buyinCap) || 0;
    if (!(cap > 0)) { toast.error('Type an effective stack first: Reset stacks puts every seat on it.'); return; }
    try { localStorage.setItem('replayerBuyinCap', String(cap)); } catch { /* ignore */ }
    setHand(prev => ({ ...prev, players: prev.players.map(p => ({ ...p, startingStack: cap })) }));
  };
  // Reset names to generic placeholders — the hero keeps your name, everyone else
  // becomes Opp 1, Opp 2, … (numbered over the non-hero seats).
  const resetNames = () => {
    setHand(prev => {
      const hIdx = prev.heroIdx != null ? prev.heroIdx : 0;
      return { ...prev, players: prev.players.map((p, i) => ({
        ...p, name: i === hIdx ? (heroName || 'Hero') : ('Opp ' + (i < hIdx ? i + 1 : i)),
      })) };
    });
  };

  const gameCfg = HAND_CONFIG[hand.gameType] || HAND_CONFIG_DEFAULT;
  const streetDef = getStreetDef(hand.gameType);
  const category = getGameCategory(hand.gameType);
  const currentStreet = hand.streets[currentStreetIdx];
  const isPreflop = currentStreetIdx === 0;

  const potAndStacks = calcPotsAndStacks(hand, currentStreetIdx, (currentStreet.actions || []).length - 1);
  const currentPot = potAndStacks.pot;
  const currentStacks = potAndStacks.stacks;

  const foldedSet = useMemo(() => {
    const f = new Set();
    for (let si = 0; si <= currentStreetIdx; si++) {
      for (let ai = 0; ai < (hand.streets[si].actions || []).length; ai++) {
        if (hand.streets[si].actions[ai].action === 'fold') f.add(hand.streets[si].actions[ai].player);
      }
    }
    return f;
  }, [hand.streets, currentStreetIdx]);

  const allInSet = useMemo(() => {
    const a = new Set();
    currentStacks.forEach((s, i) => { if (s <= 0 && !foldedSet.has(i)) a.add(i); });
    return a;
  }, [currentStacks, foldedSet]);

  // NL and PL Razz are Razz too: they took the high game's bring-in and first actor (entry audit D3).
  const isRazz = LOW_STUD.test(hand.gameType || '');
  const isStudLow = isRazz;

  const priorStreetFoldedSet = useMemo(() => {
    const f = new Set();
    for (let si = 0; si < currentStreetIdx; si++) {
      for (let ai = 0; ai < (hand.streets[si].actions || []).length; ai++) {
        if (hand.streets[si].actions[ai].action === 'fold') f.add(hand.streets[si].actions[ai].player);
      }
    }
    return f;
  }, [hand.streets, currentStreetIdx]);

  const studInfo = useMemo(() => {
    if (!gameCfg.isStud) return null;
    const is3rdStreet = currentStreetIdx === 0;
    const bringInIdx = is3rdStreet ? findStudBringIn(hand, isStudLow) : -1;
    const bestBoardIdx = !is3rdStreet ? findStudBestBoard(hand, currentStreetIdx, priorStreetFoldedSet, isStudLow) : -1;
    return { isStud: true, is3rdStreet, bringInIdx, bestBoardIdx };
  }, [gameCfg.isStud, currentStreetIdx, hand, isStudLow, priorStreetFoldedSet]);

  const preflopStraddleSeat = useMemo(
    () => (isPreflop ? lastStraddleSeat(getStraddles(hand.players, hand.blinds)) : -1),
    [isPreflop, hand.players, hand.blinds]);
  const seatOrder = useMemo(
    () => getActionOrder(hand.players, isPreflop, studInfo, preflopStraddleSeat),
    [hand.players, isPreflop, studInfo, preflopStraddleSeat]);
  const actionOrder = useMemo(() => seatOrder.filter(i => !foldedSet.has(i) && !allInSet.has(i)), [seatOrder, foldedSet, allInSet]);

  const bringInAmount = gameCfg.isStud
    ? ((hand.blinds || {}).bringIn || Math.floor(((hand.blinds || {}).bb || 200) / 4))
    : 0;

  const streetBets = useMemo(() => {
    const contrib = new Array(hand.players.length).fill(0);
    let maxBet = 0;
    if (isPreflop && category !== 'stud') {
      const sbIdx = hand.players.findIndex(p => p.position === 'SB' || p.position === 'BTN/SB');
      const bbIdx = hand.players.findIndex(p => p.position === 'BB');
      if (sbIdx >= 0) contrib[sbIdx] = (hand.blinds || {}).sb || 0;
      if (bbIdx >= 0) contrib[bbIdx] = (hand.blinds || {}).bb || 0;
      maxBet = (hand.blinds || {}).bb || 0;
      /* Straddles post before the deal and set the preflop price: the largest
         straddle IS the current bet, and each straddler is already in for
         theirs. Without this, maxBet stayed at the BB — so calls, and every
         pot-sized bet computed off it, came out short (POT 40 not 80 behind a
         20 straddle). The pot total already counted the straddle; the betting
         state did not. */
      getStraddles(hand.players, hand.blinds).forEach(st => {
        contrib[st.seat] = st.amount;
        if (st.amount > maxBet) maxBet = st.amount;
      });
    }
    (currentStreet.actions || []).forEach(act => {
      if (act.action === 'fold') return;
      if (act.action === 'bring-in') { contrib[act.player] = act.amount || bringInAmount; if (contrib[act.player] > maxBet) maxBet = contrib[act.player]; return; }
      if (act.amount > 0) { contrib[act.player] = chipRound(contrib[act.player] + act.amount); if (contrib[act.player] > maxBet) maxBet = contrib[act.player]; }
    });
    return { contrib, maxBet };
  }, [currentStreet.actions, isPreflop, hand.players, hand.blinds, category, bringInAmount]);

  const currentActor = useMemo(() => {
    const actions = currentStreet.actions || [];
    if (actionOrder.length === 0) return -1;
    /* Everyone else still in is all in: the one player with chips left acts only if a bet is still
       theirs to call. Once they have matched it (or nobody bet), there is nobody left to bet into,
       so the street needs no action from them (owner, 2026-10-21: the entry made the covering
       player bet into an opponent with nothing left to call). */
    if (actionOrder.length === 1 && streetBets.contrib[actionOrder[0]] >= streetBets.maxBet) return -1;
    let lastRaiserPlayer = -1, lastRaiseIdx = -1;
    /* The last aggression: a bet or raise, or an all-in that put in more than the price before it
       (an all-in that only calls reopens nothing). */
    const before = new Array(hand.players.length).fill(0);
    let priceBefore = 0;
    if (isPreflop && category !== 'stud') {
      const blinds = hand.blinds || {};
      const sbIdx = hand.players.findIndex(p => p.position === 'SB' || p.position === 'BTN/SB');
      const bbIdx = hand.players.findIndex(p => p.position === 'BB');
      if (sbIdx >= 0) before[sbIdx] = blinds.sb || 0;
      if (bbIdx >= 0) before[bbIdx] = blinds.bb || 0;
      priceBefore = blinds.bb || 0;
      getStraddles(hand.players, hand.blinds).forEach(st => { before[st.seat] = st.amount; if (st.amount > priceBefore) priceBefore = st.amount; });
    }
    actions.forEach((a, i) => {
      if (a.action === 'fold') return;
      if (a.action === 'bring-in') { before[a.player] = a.amount || bringInAmount; priceBefore = Math.max(priceBefore, before[a.player]); return; }
      const after = before[a.player] + (a.amount > 0 ? a.amount : 0);
      if (a.action === 'raise' || a.action === 'bet' || (a.action === 'all-in' && after > priceBefore)) { lastRaiseIdx = i; lastRaiserPlayer = a.player; }
      before[a.player] = after;
      if (after > priceBefore) priceBefore = after;
    });
    /* Walk the FULL seat order from the seat after the raiser, skipping folded and all-in seats.
       Searching the raiser in actionOrder failed whenever the raiser was all-in (they are not in it),
       so the turn went back to the first seat: SB checks, BB shoves, and the SB was asked again
       instead of the button (entry audit D1, 2026-10-20). */
    let startOi = 0;
    if (lastRaiserPlayer >= 0) { const raiserPos = seatOrder.indexOf(lastRaiserPlayer); if (raiserPos >= 0) startOi = raiserPos + 1; }
    for (let count = 0; count < seatOrder.length; count++) {
      const pidx = seatOrder[(startOi + count) % seatOrder.length];
      if (foldedSet.has(pidx) || allInSet.has(pidx)) continue;
      let lastActIdx = -1;
      for (let j = actions.length - 1; j >= 0; j--) { if (actions[j].player === pidx) { lastActIdx = j; break; } }
      if (lastActIdx < lastRaiseIdx) return pidx;
      if (lastActIdx === -1) return pidx;
    }
    return -1;
  }, [actionOrder, seatOrder, foldedSet, allInSet, currentStreet.actions, isPreflop, category, hand.players, hand.blinds, bringInAmount, streetBets]);

  const isBettingComplete = currentActor === -1;
  const activePlayers = hand.players.filter((_, i) => !foldedSet.has(i));
  const handOver = activePlayers.length <= 1;

  /* A jump to a street from the step strip holds there, though its betting is complete (owner, 2026-11-22: "buttons that
     took the user directly to that street to edit"): it moved straight on to the next street's deal. Any change to the
     street (an action, Undo, a tap on a seat) or Continue lets it go on as before. */
  const [advanceHeld, setAdvanceHeld] = useState(false);
  const heldActions = useRef(null);
  useEffect(() => {
    if (jump && jump.phase === 'action') { setAdvanceHeld(true); heldActions.current = null; }
  }, [jump]);
  useEffect(() => {
    if (!advanceHeld) return;
    const acts = (hand.streets[currentStreetIdx] || {}).actions || [];
    if (heldActions.current == null) { heldActions.current = acts; return; }
    if (acts !== heldActions.current || phase !== 'action') setAdvanceHeld(false);
  }, [hand, currentStreetIdx, phase, advanceHeld]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== 'action') return;
    if (handOver) { setPhase('result'); return; }
    if (!isBettingComplete) return;
    if (advanceHeld) return;
    const nextStreet = currentStreetIdx + 1;
    if (nextStreet >= hand.streets.length) { setPhase('showdown'); return; }
    if (gameCfg.drawAfter === currentStreetIdx) setPhase('draw_discard');
    else if (category === 'community') setPhase('board_entry');
    else if (category === 'stud') setPhase(currentStreetIdx === 0 && superThrowAsked(hand, foldedSet.has(entryHeroIdx(hand, heroName))) ? 'super_throw' : 'stud_deal');
    else if (isDrawCategory(category)) setPhase('draw_discard');
    else setCurrentStreetIdx(nextStreet);
  }, [isBettingComplete, phase, handOver, advanceHeld]);

  /* Pineapple: everyone still in throws one, so there is nothing to declare; only which card the hero threw is asked. */
  useEffect(() => {
    if (phase !== 'draw_discard' || !gameCfg.discardOnly) return;
    setHand(prev => ({ ...prev, streets: prev.streets.map((s, si) => si !== currentStreetIdx ? s : {
      ...s,
      draws: hand.players.map((_, pi) => pi).filter(pi => !foldedSet.has(pi)).map(pi =>
        (s.draws || []).find(d => d.player === pi) || { player: pi, discarded: 1, discardedCards: '', newCards: '' }),
    }) }));
    /* The only thing asked is which card the hero threw: with the hero's cards unknown, or the hero
       out of the hand, there is nothing to ask, so on to the flop (entry audit 38). */
    const hiP = entryHeroIdx(hand, heroName);
    if (!(hand.streets[0] && hand.streets[0].cards.hero) || foldedSet.has(hiP)) {
      if (category === 'community') setPhase('board_entry');
      else { setCurrentStreetIdx(currentStreetIdx + 1); setPhase('action'); }
      return;
    }
    setPhase('draw_cards_entry');
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The keyboard (entry audit 39). Each screen, and each new player to act, takes the focus when the
     last one dropped it to the page, so Tab starts on the screen and not at the top bar 46 stops away;
     on the action screen f, c, k and r fold, call, check and bet or raise. */
  useEffect(() => {
    const ae = document.activeElement;
    if (ae && ae !== document.body && document.contains(ae)) return;
    const el = document.querySelector('.gto-seat.active .gto-action-btn, .gto-seat.active .gto-draw-btn, .gto-entry .replayer-section-title, .gto-entry .gto-street-label');
    if (!el) return;
    if (!el.matches('button')) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
  }, [phase, currentStreetIdx, currentActor]);
  useEffect(() => {
    if (phase !== 'action') return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const want = { f: /^Fold$/, c: /^Call\b/, k: /^Check$/, r: /^(Raise|Bet)\b/ }[String(e.key || '').toLowerCase()];
      if (!want) return;
      const btn = [...document.querySelectorAll('.gto-seat.active .gto-action-btn')].find(b => want.test(((b.querySelector('.gto-action-label') || b).textContent || '').trim()));
      if (btn) { e.preventDefault(); btn.click(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase]);

  /* Each stud deal, and the door cards, start on the first seat still without a card (the hero first
     on face-down 7th): the target stayed wherever the last street left it (entry audit 37). */
  useEffect(() => {
    if (phase !== 'stud_deal' && phase !== 'door_cards') return;
    const hi = entryHeroIdx(hand, heroName);
    const si = phase === 'door_cards' ? 0 : currentStreetIdx + 1;
    const st = hand.streets[si];
    if (!st) return;
    const has = (pi) => (pi === hi ? !!(st.cards || {}).hero : !!((st.cards || {}).opponents || [])[pi < hi ? pi : pi - 1]);
    const live = hand.players.map((_, pi) => pi).filter(pi => !foldedSet.has(pi) && !(phase === 'door_cards' && pi === hi));
    const faceDown = phase === 'stud_deal' && si === hand.streets.length - 1;
    const first = (faceDown && live.includes(hi) && !has(hi)) ? hi : live.find(pi => !has(pi));
    setStudDealTarget(first !== undefined ? first : (live[0] ?? -1));
  }, [phase, currentStreetIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Every screen but the betting starts at its top (the betting scrolls to the seat to act, below). The hero's cards,
     the door cards, Setup and OFC were left out, so an edited hand's screen opened where the last one had scrolled to,
     past its own content (owner, 2026-11-22: "When editing hands this screen bizarrely scrolls here").
     At once, before the new screen paints (owner, 2026-11-22: "some of the entry screens are not properly scrolled to
     the top still"): a smooth scroll started after the paint was dropped by WebKit, which re-anchors the scroll when
     one screen's content is swapped for another's (Setup at 344px down: the hero's cards opened at 190px, the 3rd Street
     title off the top, and the smooth scroll never moved). A new screen has nothing on it to slide from. */
  useLayoutEffect(() => {
    if (phase === 'action') return;
    const container = document.querySelector('.content-area');
    if (container) container.scrollTo({ top: 0 });
  }, [phase]);

  /* Scroll to the seat to act: its top 1r under the header's STUCK bottom (its height plus its negative sticky top,
     both whole r), so it rests on an r-line whether or not the header had stuck when this measured.
     The stop is rounded UP to a whole pixel (owner, 2026-11-24: "occasionally there's an incomplete scroll like
     this", the bottom edge of the seat above showing as a line under the header): WebKit keeps a scroll position
     in whole pixels and drops the fraction, so a stop of 331.9 left the content at 331, the seat 0.9px low and the
     seat above it 0.9px into view (three device pixels on an iPhone), on every seat whose stop came out near a
     whole pixel's top. Rounded up, the seat rests under 1px high instead, and the one above stays under the
     header. It was also only scrolled when 2px or more off, so up to 2px of the seat above could stay.
     Once the smooth scroll has come to rest the stop is measured again, and a scroll that stopped short (WebKit
     drops a smooth scroll when a screen's content changes under it) glides the rest of the way. Anything the user
     does meanwhile (a touch, a wheel, a key) is theirs: the landing is dropped. */
  const scrollGenRef = useRef(0);
  useEffect(() => {
    if (phase !== 'action' || currentActor < 0) return;
    const gen = ++scrollGenRef.current;
    let raf = 0, unlisten = null;
    const tid = setTimeout(() => {
      if (gen !== scrollGenRef.current) return;
      const el = activeSeatRef.current;
      if (!el) return;
      const container = el.closest('.content-area');
      if (!container) return;
      // r as laid out (rounded to 1/64px in the CSS), from a probe.
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
      container.appendChild(probe);
      const r = probe.getBoundingClientRect().height / 100 || Math.min(window.innerWidth, 430) / 37 * 0.71;
      probe.remove();
      const stopFor = () => {
        const seat = activeSeatRef.current;
        if (!seat || !seat.isConnected) return null;
        const sticky = container.querySelector('.gto-sticky-header');
        const stuckBottom = sticky ? sticky.getBoundingClientRect().height + (parseFloat(getComputedStyle(sticky).top) || 0) : 0;
        const elAbsTop = seat.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        const most = container.scrollHeight - container.clientHeight;
        return Math.max(0, Math.min(most, Math.ceil(elAbsTop - stuckBottom - r - 0.01)));
      };
      const first = stopFor();
      if (first == null) return;
      if (Math.abs(container.scrollTop - first) > 0.5) container.scrollTo({ top: first, behavior: 'smooth' });
      const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
      let dropped = false;
      const drop = () => { dropped = true; };
      inputs.forEach(ev => container.addEventListener(ev, drop, { passive: true }));
      unlisten = () => { inputs.forEach(ev => container.removeEventListener(ev, drop)); unlisten = null; };
      const live = () => !dropped && gen === scrollGenRef.current;
      // At rest: three frames without movement once it has moved (a dozen if it never needed to); three seconds at most.
      let last = container.scrollTop, still = 0, moved = false, frames = 0;
      const settle = () => {
        if (!live()) { if (unlisten) unlisten(); return; }
        const now = container.scrollTop;
        if (now !== last) { moved = true; still = 0; } else still++;
        last = now; frames++;
        if (frames < 180 && (still < 3 || (!moved && frames < 12))) { raf = requestAnimationFrame(settle); return; }
        const stop = stopFor();
        if (stop == null || Math.abs(container.scrollTop - stop) <= 0.5) { if (unlisten) unlisten(); return; }
        // The rest of the way, eased out over 160ms (at once under Reduce Motion).
        const from = container.scrollTop, t0 = performance.now();
        const ms = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
        const glide = (t) => {
          if (!live()) { if (unlisten) unlisten(); return; }
          const k = ms ? Math.min(1, (t - t0) / ms) : 1;
          const to = stopFor();
          if (to == null) { if (unlisten) unlisten(); return; }
          container.scrollTop = k >= 1 ? to : from + (to - from) * (1 - Math.pow(1 - k, 3));
          if (k < 1) raf = requestAnimationFrame(glide); else if (unlisten) unlisten();
        };
        raf = requestAnimationFrame(glide);
      };
      raf = requestAnimationFrame(settle);
    }, 180);
    return () => { clearTimeout(tid); cancelAnimationFrame(raf); if (unlisten) unlisten(); };
  }, [currentActor, phase, currentStreetIdx]);

  const addAction = (action, amount) => {
    if (currentActor < 0) return;
    const playerIdx = currentActor;
    setHand(prev => ({
      ...prev,
      streets: prev.streets.map((s, si) => si !== currentStreetIdx ? s : { ...s, actions: [...(s.actions || []), { player: playerIdx, action, amount: amount || 0 }] })
    }));
    setShowRaiseInput(false);
    setBetAmount('');
  };

  /* A tap on a seat that has acted goes back to that player's turn. More than one step back asks
     first: a tap made to look at a seat, or while scrolling, threw a run of actions away (entry audit 14). */
  const rewindToPlayer = (playerIdx) => {
    for (let si = currentStreetIdx; si >= 0; si--) {
      const acts = (hand.streets[si] || {}).actions || [];
      const at = acts.findIndex(a => a.player === playerIdx);
      if (at < 0) continue;
      let lose = acts.length - at;
      for (let sj = si + 1; sj < hand.streets.length; sj++) lose += ((hand.streets[sj] || {}).actions || []).length;
      if (lose > 1 && !window.confirm('Go back to ' + (hand.players[playerIdx].name || 'that player') + "'s turn? The last " + lose + ' actions come off.')) return;
      undoToPlayer(playerIdx);
      return;
    }
  };
  const undoToPlayer = (playerIdx) => {
    setHand(prev => {
      for (let si = currentStreetIdx; si >= 0; si--) {
        const acts = prev.streets[si].actions || [];
        let targetIdx = -1;
        for (let ai = 0; ai < acts.length; ai++) {
          if (acts[ai].player === playerIdx) { targetIdx = ai; break; }
        }
        if (targetIdx >= 0) {
          const streets = prev.streets.map((s, i) => {
            if (i < si) return s;
            if (i === si) return { ...s, actions: acts.slice(0, targetIdx) };
            return { ...s, actions: [] };
          });
          if (si < currentStreetIdx) setCurrentStreetIdx(si);
          if (['result','showdown','board_entry','draw_discard','draw_cards_entry'].includes(phase)) setPhase('action');
          return { ...prev, streets };
        }
      }
      return prev;
    });
    setShowRaiseInput(false);
    setBetAmount('');
  };

  const undoLastAction = () => {
    setHand(prev => {
      for (let si = currentStreetIdx; si >= 0; si--) {
        const acts = prev.streets[si].actions || [];
        if (acts.length > 0) {
          const streets = prev.streets.map((s, i) => i !== si ? s : { ...s, actions: acts.slice(0, -1) });
          if (si < currentStreetIdx) setCurrentStreetIdx(si);
          if (['result','showdown','board_entry','draw_discard','draw_cards_entry'].includes(phase)) setPhase('action');
          return { ...prev, streets };
        }
      }
      return prev;
    });
  };

  // A stack arrives already read by AmountField; a name is kept as typed.
  const updatePlayerField = (idx, field, value) => {
    setHand(prev => ({ ...prev, players: prev.players.map((p, i) => i !== idx ? p : { ...p, [field]: value }) }));
  };

  const setNumPlayers = (n) => {
    setHand(prev => {
      const heroI = entryHeroIdx(prev, heroName);
      // Stud seats are numbered, not named for blinds it does not have (entry audit 15).
      const positions = gameCfg.isStud ? getStudPositionLabels(n) : getPositionLabels(n);
      const players = Array.from({ length: n }, (_, i) => {
        if (prev.players[i]) return { ...prev.players[i], position: positions[i] || '' };
        return { name: getSeatName(i, heroI, heroName), position: positions[i] || '', startingStack: prev.players[0] ? prev.players[0].startingStack : 50000 };
      });
      const streets = prev.streets.map(s => ({ ...s, cards: { ...s.cards, opponents: Array.from({ length: n - 1 }, (_, j) => (s.cards.opponents && s.cards.opponents[j]) || '') } }));
      return { ...prev, players, streets };
    });
  };

  const heroIdx = entryHeroIdx(hand, heroName);

  /* The table turns so the hero sits at newIdx: every player moves by the same number of seats and
     the seat labels stay put. The opponents' cards are stored relative to the hero, so they are
     carried across by absolute seat, or a turn handed one player's cards to the next. Read from
     `prev`, not the render's heroIdx, so two calls in one event cannot turn the table twice. */
  const setHeroSeat = (newIdx) => {
    setHand(prev => {
      const n = prev.players.length;
      const oldHero = entryHeroIdx(prev, heroName);
      if (newIdx === oldHero || newIdx < 0 || newIdx >= n) return prev;
      const shift = newIdx - oldHero;
      const from = (i) => ((i - shift) % n + n) % n;
      const players = prev.players.map((p, i) => ({ ...prev.players[from(i)], position: p.position }));
      const streets = (prev.streets || []).map(st => {
        const cards = st.cards || {};
        if (!Array.isArray(cards.opponents)) return st;
        const byPlayer = {};
        cards.opponents.forEach((c, slot) => { byPlayer[slot < oldHero ? slot : slot + 1] = c; });
        const opponents = [];
        for (let i = 0; i < n; i++) if (i !== newIdx) opponents.push(byPlayer[from(i)] || '');
        return { ...st, cards: { ...cards, opponents } };
      });
      return { ...prev, players, streets, heroIdx: newIdx };
    });
  };

  /* Dragging a seat moves the PERSON, not the seat.
     The labels are positional — Seat 1 stays Seat 1 — which is the same rule
     setHeroSeat already follows. Everything else in a hand refers to a player
     BY INDEX, so all of it has to travel with them or the hand quietly becomes
     somebody else's: the hero, every action, the draws, the saved result, and
     the opponent card slots, which are stored relative to the hero and so go
     through absolute indices on the way across. */
  const reorderSeats = (from, to) => {
    setHand(prev => {
      const n = prev.players.length;
      if (from === to || from < 0 || to < 0 || from >= n || to >= n) return prev;
      const order = prev.players.map((_, i) => i);
      order.splice(to, 0, order.splice(from, 1)[0]);
      const oldToNew = {};
      order.forEach((oldIdx, newIdx) => { oldToNew[oldIdx] = newIdx; });

      const posLabels = gameCfg.isStud ? getStudPositionLabels(n) : getPositionLabels(n);
      const players = order.map((oldIdx, newIdx) => ({
        ...prev.players[oldIdx],
        position: posLabels[newIdx] || prev.players[oldIdx].position,
      }));
      const oldHero = prev.heroIdx != null ? prev.heroIdx : 0;
      const heroIdx = oldToNew[oldHero];

      const streets = (prev.streets || []).map(st => {
        const cards = st.cards || {};
        const byPlayer = {};
        (cards.opponents || []).forEach((c, slot) => {
          byPlayer[slot < oldHero ? slot : slot + 1] = c;
        });
        const opponents = [];
        for (let newIdx = 0; newIdx < n; newIdx++) {
          if (newIdx === heroIdx) continue;
          opponents.push(byPlayer[order[newIdx]] || '');
        }
        return {
          ...st,
          cards: { ...cards, opponents },
          actions: (st.actions || []).map(a => (a && a.player != null ? { ...a, player: oldToNew[a.player] } : a)),
          draws: (st.draws || []).map(d => (d && d.player != null ? { ...d, player: oldToNew[d.player] } : d)),
        };
      });
      const result = (prev.result && prev.result.winners)
        ? { ...prev.result, winners: prev.result.winners.map(w => ({ ...w, playerIdx: oldToNew[w.playerIdx] })) }
        : prev.result;
      return { ...prev, players, heroIdx, streets, result };
    });
  };

  /* The seat label is both the hero button and the drag handle, because the
     row is otherwise all text inputs and has nowhere to put a grip. A press
     that never travels 6px is still a tap, so selecting the hero is unchanged;
     past that it becomes a drag and the tap is not fired. */
  const seatDrag = useRef(null);
  const beginSeatDrag = (e, idx) => {
    seatDrag.current = { idx, startY: e.clientY, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* no capture, still draggable */ }
  };
  const moveSeatDrag = (e) => {
    const d = seatDrag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.startY) < 6) return;
    if (!d.moved) { d.moved = true; setDragSeat(d.idx); }
    const list = e.currentTarget.closest('.replayer-player-row');
    const rows = list && list.parentElement
      ? Array.from(list.parentElement.querySelectorAll('.replayer-player-row')) : [];
    const target = rows.findIndex(r => {
      const b = r.getBoundingClientRect();
      return e.clientY >= b.top && e.clientY <= b.bottom;
    });
    if (target < 0 || target === d.idx) return;
    reorderSeats(d.idx, target);
    d.idx = target;
    setDragSeat(target);
  };
  const endSeatDrag = () => {
    const d = seatDrag.current;
    seatDrag.current = null;
    setDragSeat(null);
    if (d && !d.moved) setHeroSeat(d.idx);
  };

  /* Sums of cents carry float tails (2.69 owed against 2.6900000000000004 behind compared as more, and
     the raise box opened on 299.41999999999996), so every figure the buttons test or show is rounded
     to the cent first (entry vs oracle, 4b and 6). */
  const playerContrib = currentActor >= 0 ? chipRound(streetBets.contrib[currentActor] || 0) : 0;
  const playerStack = currentActor >= 0 ? chipRound(currentStacks[currentActor] || 0) : 0;
  const callAmount = currentActor >= 0 ? chipRound(Math.max(0, Math.min(streetBets.maxBet - playerContrib, playerStack))) : 0;
  const canCheck = callAmount <= 0;
  const amt$ = (v) => currencySymbol(hand) + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  // Undo is off with nothing to undo; it was always on (entry audit 47).
  const canUndo = (hand.streets || []).some(s => (s.actions || []).length > 0);

  const bettingType = gameCfg.betting || 'nl';
  const isLimitGame = bettingType === 'fl';
  const isPotLimit = bettingType === 'pl';
  const flSmallStreets = gameCfg.flSmallStreets || [0, 1];
  const flRaiseCap = (hand.blinds || {}).betCap || gameCfg.raiseCap || 4;
  let streetBetRaiseCount = 0;
  (currentStreet.actions || []).forEach(a => { if (a.action === 'raise' || a.action === 'bet') streetBetRaiseCount++; });
  const activePlayerCount = hand.players.filter((_, i) => !foldedSet.has(i) && !allInSet.has(i)).length;
  const isHeadsUp = activePlayerCount <= 2;
  const flIsSmall = flSmallStreets.includes(currentStreetIdx);
  /* An open pair on 4th street: in stud high the first bet may be the small bet or the big one, and
     the street goes on at the size it opened with. Hi-lo and the low games keep the small bet; this
     made the big bet a must in every stud game (entry audit 18; entry vs oracle, cannot enter 3). */
  const stud4thOpenPair = gameCfg.isStud && currentStreetIdx === 1
    && (GAME_EVAL[hand.gameType] || {}).type === 'high' && studHasOpenPairOn4th(hand);
  const flSmallBet = (hand.blinds || {}).bb || 100;
  const flBigBet = (hand.blinds || {}).bigBet || flSmallBet * 2;
  const flOpeningBet = (currentStreet.actions || []).find(a => a.action === 'bet');
  const flBetSize = stud4thOpenPair
    ? (flOpeningBet && chipRound(flOpeningBet.amount) >= flBigBet ? flBigBet : flSmallBet)
    : (flIsSmall ? flSmallBet : flBigBet);
  const flOpenPairChoice = stud4thOpenPair && !flOpeningBet;
  const flRaiseToTotal = chipRound(streetBets.maxBet + flBetSize);
  const flRaiseIncrement = chipRound(flRaiseToTotal - playerContrib);
  /* Heads-up used to lift the cap on every street, which is one house rule but
     not the one being asked for: uncapped heads up on the LAST street only,
     and only when the hand says so. Off, the cap holds everywhere. */
  const isLastStreet = currentStreetIdx === hand.streets.length - 1;
  const uncapHeadsUp = (hand.blinds || {}).uncapHeadsUp !== false;
  const flCanRaise = (uncapHeadsUp && isHeadsUp && isLastStreet) || streetBetRaiseCount < flRaiseCap;

  /* Pot-limit: the pot is everything in the middle, a big-blind ante included. Before the flop the
     ante was left out, so a legal pot raise was cut down to a smaller one without a word (entry vs
     oracle, 1). PokerKit counts it, and so does the text quick add (utils/quick-add/betting.js). */
  const blinds = hand.blinds || { sb: 0, bb: 0, ante: 0 };
  const plEffectivePot = chipRound(currentPot);
  const plPotAfterCall = chipRound(plEffectivePot + callAmount);
  const plRaiseToTotal = chipRound(streetBets.maxBet + plPotAfterCall);
  const plMaxRaiseIncrement = chipRound(plRaiseToTotal - playerContrib);
  const plMaxBet = plEffectivePot;

  /* One walk over the street (entry vs oracle, 4c and 5): the price; the size of the last FULL raise,
     which is the smallest raise allowed (a short all-in raises the price, not that size); and whether
     the betting is open again to the player to act. A player who has acted may raise again only after
     a full raise, or short ones adding up to one (TDA 2019 rule 43; in limit, half a bet). A straddle
     is the new big blind: the smallest raise is its size. */
  const _bbAmt = blinds.bb || 0;
  let _prevMax = 0, _lastRaiseSize = _bbAmt;
  const _runContrib = new Array(hand.players.length).fill(0);
  if (isPreflop && category !== 'stud') {
    const _sbIdx = hand.players.findIndex(p => p.position === 'SB' || p.position === 'BTN/SB');
    const _bbIdx = hand.players.findIndex(p => p.position === 'BB');
    if (_sbIdx >= 0) _runContrib[_sbIdx] = blinds.sb || 0;
    if (_bbIdx >= 0) _runContrib[_bbIdx] = _bbAmt;
    _prevMax = _bbAmt;
    getStraddles(hand.players, hand.blinds).forEach(st => {
      _runContrib[st.seat] = st.amount;
      _prevMax = Math.max(_prevMax, st.amount);
      _lastRaiseSize = Math.max(_lastRaiseSize, st.amount);
    });
  }
  let _myLastIdx = -1, _priceAtMine = 0, _fullSinceMine = false;
  (currentStreet.actions || []).forEach((a, i) => {
    if (a.action === 'fold') return;
    if (a.action === 'bring-in') {
      _runContrib[a.player] = a.amount || bringInAmount;
      _prevMax = Math.max(_prevMax, _runContrib[a.player]);
    } else {
      if (a.amount > 0) _runContrib[a.player] = chipRound(_runContrib[a.player] + a.amount);
      const to = _runContrib[a.player];
      if (to > _prevMax) {
        const size = chipRound(to - _prevMax);
        const full = isLimitGame ? size * 2 >= flBetSize : size >= _lastRaiseSize;
        if (full && !isLimitGame) _lastRaiseSize = Math.max(size, _bbAmt);
        if (full) _fullSinceMine = true;
        _prevMax = to;
      }
    }
    if (a.player === currentActor) { _myLastIdx = i; _priceAtMine = _prevMax; _fullSinceMine = false; }
  });
  const minRaiseToTotal = chipRound(streetBets.maxBet + _lastRaiseSize);
  const minRaiseIncrement = chipRound(minRaiseToTotal - playerContrib);
  // A player who only checked faced no bet, so any bet opens it to them, short or not.
  const reopened = _myLastIdx < 0 || _priceAtMine <= 0 || _fullSinceMine
    || chipRound(_prevMax - _priceAtMine) >= (isLimitGame ? flBetSize / 2 : _lastRaiseSize);
  /* A raise needs someone left who could call it, a stack that covers more than the call, and the
     betting open to this player (entry vs oracle, 4a-c). A stack that covers no more than the call
     has Call, which puts it all in; "All-in" saved that as a raise, and the round never closed (3). */
  // Someone who could put in more than the bet now faced: a stack short of it can only call, all in.
  const othersWithChips = hand.players.some((_, i) => i !== currentActor && !foldedSet.has(i) && !allInSet.has(i)
    && chipRound((currentStacks[i] || 0) + (streetBets.contrib[i] || 0)) > chipRound(streetBets.maxBet));
  const canRaiseHere = currentActor >= 0 && othersWithChips && reopened && chipRound(playerStack - callAmount) > 0;
  // The legal range for the Bet / Raise box, as amounts put in.
  const betMin = canCheck ? Math.min(_bbAmt || flSmallBet, playerStack) : Math.min(minRaiseIncrement, playerStack);
  const betMax = isPotLimit ? (canCheck ? Math.min(plMaxBet, playerStack) : Math.min(plMaxRaiseIncrement, playerStack)) : playerStack;
  const cashHand = hand.gameMode === 'cash';
  const roundAmt = (v) => (cashHand ? Math.round(v * 100) / 100 : Math.round(v));
  /* Confirm: a figure the field cannot read, one under the smallest raise or over the limit is
     refused with the range, and an amount is never changed after Confirm (entry audit 23; entry vs
     oracle, 1: "Pot 4500" typed was saved as 3,500 without a word). */
  /* The box takes the TOTAL the seat is in for on this street once it has bet or raised: "raise to",
     as every poker client and hand history says it (UX pick 52). Typing 1800 meaning "to 1,800" was
     saved as 1,800 more, a raise to 2,000. The hand still stores what was added. "3bb" is three big
     blinds and "2.5x" two and a half times the bet faced (UX pick 59). */
  const totalOf = (added) => chipRound(added + playerContrib);
  const minTo = totalOf(betMin), maxTo = totalOf(betMax);
  const betWord = canCheck && playerContrib === 0 ? 'Bet' : 'Raise to';
  const readBet = (text) => {
    const t = String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, '');
    const mult = t.match(/^(\d+(?:\.\d+)?|\.\d+)(bb|x)$/);
    if (mult) {
      const n = parseFloat(mult[1]);
      if (mult[2] === 'bb') return _bbAmt > 0 ? { value: roundAmt(n * _bbAmt), read: true } : { error: 'No big blind set' };
      return streetBets.maxBet > 0 ? { value: roundAmt(n * streetBets.maxBet), read: true } : { error: 'No bet to multiply yet' };
    }
    const r = parseAmount(text, { cents: cashHand });
    return r.error ? r : { value: r.value, read: !/^\d+(\.\d+)?$/.test(t) };
  };
  const betRead = readBet(betAmount);
  const confirmBet = () => {
    const r = readBet(betAmount);
    if (r.error) { setBetError(r.error + '.'); return; }
    const to = r.value;
    if (!(to > 0)) { setBetError('Type an amount.'); return; }
    if (to > maxTo) { setBetError(betMax < playerStack ? 'The pot limit is ' + betWord.toLowerCase() + ' ' + amt$(maxTo) + ' at most.' : 'Only ' + amt$(playerStack) + ' behind: all in is ' + amt$(maxTo) + '.'); return; }
    if (to < minTo) { setBetError('The smallest ' + (canCheck && playerContrib === 0 ? 'bet is ' : 'raise is to ') + amt$(minTo) + '.'); return; }
    addAction(canCheck ? 'bet' : 'raise', chipRound(to - playerContrib));
  };
  const raiseBox = (
    <>
      <div className="gto-raise-slider-row">
        <input type="range" className="gto-raise-slider" aria-label={betWord}
          min={minTo} max={maxTo} step={cashHand ? 0.01 : 1}
          value={Number(betAmount) || 0} onChange={e => setBetAmount(String(roundAmt(Number(e.target.value))))} />
      </div>
      <div className="gto-raise-input-row">
        <input type="text" inputMode="decimal" aria-label={betWord + ' (total)'} value={betAmount}
          className={betError ? 'is-invalid' : undefined} aria-invalid={betError ? true : undefined}
          onChange={e => setBetAmount(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); confirmBet(); }
            else if (e.key === 'Escape') { e.preventDefault(); setShowRaiseInput(false); }
          }} autoFocus />
        <button className="btn btn-primary btn-sm" onClick={confirmBet}>Confirm</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowRaiseInput(false)}>Cancel</button>
      </div>
      {betError
        ? <div className="replayer-field-error" role="alert">{betError}</div>
        : betRead && !betRead.error && betRead.value >= minTo && betRead.value <= maxTo
          /* The readback (UX picks 52, 59): what was read, and what it adds to what is already in. */
          ? <div className="replayer-field-hint is-read">
              {'\u2713 ' + betWord + ' ' + amt$(betRead.value)}
              {playerContrib > 0 ? ': adds ' + amt$(chipRound(betRead.value - playerContrib)) + ' to the ' + amt$(playerContrib) + ' in' : ''}
              {betRead.read ? ' (read from \u201c' + String(betAmount).trim() + '\u201d)' : ''}
            </div>
          : <div className="replayer-field-hint">
              {betWord} {amt$(minTo)}{maxTo > minTo ? ' to ' + amt$(maxTo) : ''}
              {playerContrib > 0 ? ' (' + amt$(playerContrib) + ' in already)' : ''}
            </div>}
    </>
  );

  const cumulativeBoard = useMemo(() => {
    let b = '';
    for (let si = 0; si <= currentStreetIdx; si++) b += (hand.streets[si].cards.board || '');
    return b;
  }, [hand.streets, currentStreetIdx]);

  const playerActions = useMemo(() => {
    const map = {};
    (currentStreet.actions || []).forEach(act => { map[act.player] = act; });
    return map;
  }, [currentStreet.actions]);

  // ── SETUP PHASE ──
  if (phase === 'setup') {
    const isOfc = category === 'ofc';
    /* Stud is priced in three numbers, so it takes three fields. The big bet
       was derived as twice the small one, which is the usual structure but not
       the only one, and it is now stored rather than assumed. */
    const studBigBet = (hand.blinds || {}).bigBet || ((hand.blinds || {}).bb || 0) * 2;
    const studBringIn = (hand.blinds || {}).bringIn || Math.floor(((hand.blinds || {}).bb || 0) / 4);
    /* The cap belongs to every fixed-limit game, not just stud — a limit hold'em
       street is capped the same way — so it shows wherever the betting is fl. */
    const isLimitGame = gameCfg.betting === 'fl';
    const betCap = (hand.blinds || {}).betCap || gameCfg.raiseCap || 4;
    const uncapHU = (hand.blinds || {}).uncapHeadsUp !== false;
    const setBlind = (field, value) => setHand(prev => ({ ...prev, blinds: { ...(prev.blinds || {}), [field]: value } }));
    const setStudSized = (field, value) => {
      setHand(prev => {
        const b = prev.blinds || {};
        const prevBig = b.bigBet || (b.bb || 0) * 2;
        const next = { ...b, [field]: value };
        /* The big bet keeps following the small one for as long as it is still
           twice it. Typing a big bet by hand ends that, so an unusual
           structure is not quietly corrected back on the next keystroke. */
        if (field === 'bb' && (b.bigBet == null || b.bigBet === (b.bb || 0) * 2)) next.bigBet = value * 2;
        if (field === 'bb' && (b.bringIn == null || b.bringIn === Math.floor((b.bb || 0) / 4))) next.bringIn = Math.floor(value / 4);
        const nextBig = next.bigBet || (next.bb || 0) * 2;
        /* Stacks follow the big bet only while every one of them is still the
           default depth — the moment somebody types a stack, the sizes stop
           overwriting it. */
        const stacksUntouched = prevBig > 0 && prev.players.every(p => Number(p.startingStack) === prevBig * STUD_STACK_BB);
        const players = (stacksUntouched && nextBig > 0)
          ? prev.players.map(p => ({ ...p, startingStack: nextBig * STUD_STACK_BB }))
          : prev.players;
        return { ...prev, blinds: next, players };
      });
    };
    const setNumPlayersOfc = (n) => {
      setHand(prev => {
        const players = [];
        const newOfcRows = { ...(prev.ofcRows || {}) };
        for (let i = 0; i < n; i++) {
          if (prev.players[i]) players.push(prev.players[i]);
          else players.push({ name: getSeatName(i, 0, heroName), position: '', startingStack: 0 });
          if (!newOfcRows[i]) newOfcRows[i] = { top: '', middle: '', bottom: '' };
        }
        return { ...prev, players, ofcRows: newOfcRows };
      });
    };
    const cents = hand.gameMode === 'cash';
    const money = (v) => currencySymbol(hand) + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
    /* With betting recorded, the seats and the money are fixed. Actions are stored as amounts by
       seat, so a new blind, stack, player count or seat order quietly changed what every one of
       them meant (entry audit 10). Names stay editable; one button clears the action. */
    const locked = (hand.streets || []).some(s => (s.actions || []).length || (s.draws || []).length);
    const clearAction = () => {
      if (!window.confirm('Clear every bet, draw and the result in this hand? The cards dealt stay; cards drawn go with their draws.')) return;
      setHand(prev => ({ ...prev, result: null, streets: prev.streets.map(s => ({ ...s, actions: [], draws: [] })) }));
    };
    /* A straddler's badge reads STR (the button keeps BTN), and the hint under the straddles names
       seats by the same badges: it said "LJ closes" beside a row labelled STR (entry audit 47). */
    const straddlers = (isOfc || gameCfg.isStud) ? [] : getStraddles(hand.players, hand.blinds);
    const seatBadge = (i) => (straddlers.some(s => s.seat === i) && i !== hand.players.length - 3)
      ? 'STR' : ((hand.players[i] || {}).position || 'Seat ' + (i + 1));
    /* Next names the first thing that cannot be right and stays here (entry audit 22): it went on
       with a small blind above the big blind, a seat with no chips, or no name at all. */
    const setupProblem = () => {
      const b = hand.blinds || {};
      if (!isOfc && category === 'stud') {
        const small = Number(b.bb) || 0;
        if (!(small > 0)) return 'The small bet is 0.';
        if (studBigBet < small) return 'The big bet is smaller than the small bet.';
        if (studBringIn > small) return 'The bring-in is more than the small bet.';
      } else if (!isOfc) {
        const bb = Number(b.bb) || 0;
        if (!(bb > 0)) return 'The big blind is 0.';
        if ((Number(b.sb) || 0) > bb) return 'The small blind is bigger than the big blind.';
      }
      const seen = new Set();
      for (let i = 0; i < hand.players.length; i++) {
        const p = hand.players[i];
        const name = String(p.name || '').trim();
        const who = isOfc ? 'Seat ' + (i + 1) : seatBadge(i);
        if (!name) return who + ' has no name.';
        if (!isOfc && !(Number(p.startingStack) > 0)) return name + ' (' + who + ') has no chips.';
        if (seen.has(name.toLowerCase())) return 'Two players are named ' + name + '.';
        seen.add(name.toLowerCase());
      }
      return null;
    };
    const goNext = () => {
      const why = setupProblem();
      if (why) { setPhaseError(why); return; }
      setPhase(category === 'ofc' ? 'ofc_entry' : gameCfg.isStud ? 'hero_cards' : gameCfg.doorBoard ? 'board_door' : 'action');
    };
    const capNum = Number(buyinCap);
    // The names offered under the focused name field, and the rest of the table its order would fill.
    const nameOffer = (i) => {
      const p = hand.players[i];
      if (!names || nameSeat !== i || !p) return { list: [], rest: [] };
      const list = nameSuggestions(names, { players: hand.players, seat: i, query: p.name || '', pros: proNames });
      const rest = isDefaultName(p.name) ? restOfTable(names, hand.players, i, { hero: heroIdx }) : [];
      return { list, rest };
    };
    // The next seat nobody has named, round the table; never the hero's.
    const nextUnnamed = (i, players) => {
      for (let k = 1; k < players.length; k++) {
        const at = (i + k) % players.length;
        if (at !== heroIdx && isDefaultName(players[at].name)) return at;
      }
      return -1;
    };
    const closeNames = () => {
      clearTimeout(nameBlur.current);
      setNameSeat(null); setNameHi(-1);
      const el = document.activeElement;
      if (el && nameInputs.current.includes(el)) el.blur();
    };
    const pickName = (i, name) => {
      clearTimeout(nameBlur.current);
      const players = hand.players.map((p, k) => (k === i ? { ...p, name } : p));
      updatePlayerField(i, 'name', name);
      setNameHi(-1);
      const next = nextUnnamed(i, players);
      if (next >= 0 && nameInputs.current[next]) nameInputs.current[next].focus();
      else closeNames();
    };
    const fillRest = (fills) => {
      setHand(prev => ({ ...prev, players: prev.players.map((p, k) => {
        const f = fills.find(x => x.seat === k);
        return f && isDefaultName(p.name) ? { ...p, name: f.name } : p;
      }) }));
      closeNames();
    };
    return (
      <div className="gto-entry">
        <div className="gto-phase-card"><div className="replayer-section">
          <div className="replayer-section-title">{isOfc ? 'Players' : category === 'stud' ? 'Players & Stakes' : 'Players & Blinds'}</div>
          {locked && (
            <div className="gto-lock-row">
              <div className="replayer-field-hint">This hand has betting in it, so the seats, stakes and stacks are fixed. Names can still change.</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearAction}>Clear the action</button>
            </div>
          )}
          <div className="replayer-row gto-blinds-grid">
            <div className="replayer-field" style={{flex:'0 0 calc(var(--subrow) * 8.75)'}}>
              <label>Players</label>
              {isOfc ? (
                <select value={hand.players.length} onChange={e => setNumPlayersOfc(Number(e.target.value))}>
                  {[2,3].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              ) : (
                <select value={hand.players.length} disabled={locked} onChange={e => setNumPlayers(Number(e.target.value))}>
                  {[2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>
            {/* Stud has no blinds. It has an ante from every player and a
                bring-in, and the engine already knows that — calcPotsAndStacks
                posts a small and big blind only when the category is not stud,
                and antes everyone when it is. Only this form still asked for
                them. What it calls BB is, in a fixed-limit game, the SMALL BET
                (flSmallStreets take bb, later streets take bb*2), so for stud
                that is the field's real name; SB does nothing there but set the
                bring-in at half itself, which is the default anyway. */}
            {!isOfc && category !== 'stud' && <div className="replayer-field"><label>SB</label><AmountField value={(hand.blinds||{}).sb} blankZero cents={cents} disabled={locked} ariaLabel="Small blind" onCommit={v => setBlind('sb', v)} /></div>}
            {!isOfc && <div className="replayer-field"><label>{category === 'stud' ? 'Small Bet' : 'BB'}</label><AmountField value={(hand.blinds||{}).bb} blankZero cents={cents} disabled={locked} ariaLabel={category === 'stud' ? 'Small bet' : 'Big blind'} onCommit={v => (category === 'stud' ? setStudSized('bb', v) : setBlind('bb', v))} /></div>}
            {!isOfc && category === 'stud' && <div className="replayer-field"><label>Big Bet</label><AmountField value={studBigBet} blankZero cents={cents} disabled={locked} ariaLabel="Big bet" onCommit={v => setStudSized('bigBet', v)} /></div>}
            {!isOfc && category === 'stud' && <div className="replayer-field"><label>Bring-in</label><AmountField value={studBringIn} blankZero cents={cents} disabled={locked} ariaLabel="Bring-in" onCommit={v => setStudSized('bringIn', v)} /></div>}
            {!isOfc && <div className="replayer-field"><label>{category === 'stud' ? 'Ante (each)' : 'BB Ante'}</label><AmountField value={(hand.blinds||{}).ante} blankZero cents={cents} disabled={locked} ariaLabel={category === 'stud' ? 'Ante, each player' : 'Big blind ante'} onCommit={v => setBlind('ante', v)} /></div>}
            {!isOfc && isLimitGame && <div className="replayer-field"><label>Cap</label><AmountField value={betCap} blankZero disabled={locked} ariaLabel="Bets allowed on a street" onCommit={v => setBlind('betCap', v)} /></div>}
          </div>
          {/* A limit game is named by its bets, not its blinds: the headers say 200/400 where these
              fields say 100 and 200 (entry audit 47). */}
          {!isOfc && isLimitGame && category !== 'stud' && (
            <div className="replayer-field-hint">
              Limit stakes are written small bet / big bet: this hand plays {money((hand.blinds||{}).bb)}/{money((hand.blinds||{}).bigBet || ((hand.blinds||{}).bb || 0) * 2)}.
            </div>
          )}
          {!isOfc && isLimitGame && (
            <div className="replayer-settings-row">
              <div>
                <div className="replayer-settings-label">Uncapped heads-up{category === 'stud' ? ' on 7th' : ' on the river'}</div>
                <div className="replayer-settings-sublabel">Two players left on the last street keep raising past the cap</div>
              </div>
              <button type="button" className={'replayer-settings-toggle' + (uncapHU ? ' on' : '')}
                aria-pressed={uncapHU} aria-label="Uncapped heads-up on the last street" disabled={locked}
                onClick={() => setBlind('uncapHeadsUp', !uncapHU)} />
            </div>
          )}
          {/* Super (owner, 2026-11-28: "discard is after 3rd street betting, before 4th is dealt, applies to any stud game";
              utils/super-stud.js): set with the hand it describes, like Double board. */}
          {!isOfc && category === 'stud' && (
            <div className="replayer-settings-row">
              <div>
                <div className="replayer-settings-label">Super</div>
                <div className="replayer-settings-sublabel">Four down and one up on 3rd street; after its betting, each player throws two down cards.</div>
              </div>
              <button type="button" className={'replayer-settings-toggle' + (hand.superStud ? ' on' : '')}
                aria-pressed={!!hand.superStud} aria-label="Super" disabled={locked}
                onClick={() => setHand(prev => {
                  const next = { ...prev };
                  if (prev.superStud) {
                    delete next.superStud;
                    next.streets = prev.streets.map((s, i) => {
                      if (i !== 0) return s;
                      const cards = { ...s.cards };
                      delete cards.heroThrown; delete cards.heroSuper;
                      return { ...s, cards };
                    });
                  } else next.superStud = true;
                  return next;
                })} />
            </div>
          )}
          {/* Double board (UX pick 62): set with the hand it describes. Flop games, as the list offered it. */}
          {!isOfc && category === 'community' && !gameCfg.doorBoard && (
            <div className="replayer-settings-row">
              <div>
                <div className="replayer-settings-label">Double board</div>
                <div className="replayer-settings-sublabel">Two boards dealt; each pays half the pot.</div>
              </div>
              <button type="button" className={'replayer-settings-toggle' + (hand.doubleBoard ? ' on' : '')}
                aria-pressed={!!hand.doubleBoard} aria-label="Double board" disabled={locked}
                onClick={() => setHand(prev => {
                  const next = { ...prev };
                  if (prev.doubleBoard) delete next.doubleBoard; else next.doubleBoard = true;
                  return next;
                })} />
            </div>
          )}
          {/* Straddles. Offered wherever blinds are posted — stud has none to
              raise, and OFC has no betting round at all. */}
          {!isOfc && category !== 'stud' && (() => {
            const b = hand.blinds || {};
            const on = !!b.straddle;
            const nSeats = hand.players.length;
            const eligible = straddleEligibleSeats(nSeats);
            const live = getStraddles(hand.players, b);
            const closer = lastStraddleSeat(live);
            const setSeat = (type, seat) => setHand(prev => ({ ...prev, blinds: {
              ...(prev.blinds || {}),
              straddleSeats: { ...((prev.blinds || {}).straddleSeats || {}), [type]: seat },
            }}));
            return (
              <>
                <div className="replayer-settings-row">
                  <div>
                    <div className="replayer-settings-label">Straddle</div>
                    <div className="replayer-settings-sublabel">
                      A blind raise posted before the deal. The last straddler has the option, so preflop action starts on their left.
                    </div>
                  </div>
                  <button type="button" className={'replayer-settings-toggle' + (on ? ' on' : '')}
                    aria-pressed={on} aria-label="Straddle" disabled={locked}
                    onClick={() => {
                      const next = !on;
                      setBlind('straddle', next);
                      /* A straddle is a cash-game wager. Turning it on says this
                         is a cash hand, so flip the mode with it — the money
                         symbol follows, and so do blinds and stacks still on the
                         tournament's defaults (a cash game has no big-blind ante).
                         Turning it off leaves the mode alone; someone may have set
                         Cash deliberately. */
                      if (next) setHand(prev => withGameMode(prev, 'cash'));
                    }} />
                </div>
                {on && nSeats < 4 && (
                  <div className="replayer-field-hint" style={{marginBottom:'var(--space-sm)'}}>
                    Nobody can straddle {nSeats}-handed &mdash; the button, small blind and big blind account for every seat, and a blind cannot straddle itself.
                  </div>
                )}
                {on && nSeats >= 4 && (
                  <div className="replayer-straddle-types">
                    {STRADDLE_TYPES.map(type => {
                      const checked = !!b['straddle_' + type];
                      const needsSeat = type === 'rock' || type === 'mississippi';
                      const seat = straddleSeatFor(type, nSeats, (b.straddleSeats || {})[type]);
                      const posted = live.find(x => x.type === type);
                      return (
                        <div key={type} className={'replayer-straddle-row' + (checked ? ' is-on' : '')}>
                          <button type="button" role="checkbox" aria-checked={checked} disabled={locked}
                            className={'replayer-straddle-check' + (checked ? ' is-checked' : '')}
                            onClick={() => setBlind('straddle_' + type, !checked)}>
                            <span className="replayer-straddle-box" aria-hidden="true" />
                            <span className="replayer-straddle-name">{STRADDLE_LABELS[type]}</span>
                          </button>
                          {checked && needsSeat && (
                            <select className="replayer-straddle-seat" value={seat} disabled={locked}
                              aria-label={STRADDLE_LABELS[type] + ' seat'}
                              onChange={e => setSeat(type, Number(e.target.value))}>
                              {eligible.map(i => (
                                <option key={i} value={i}>{hand.players[i]?.position || 'Seat ' + (i + 1)}</option>
                              ))}
                            </select>
                          )}
                          {/* The first straddle's size is set here (owner, 2026-11-20: "It should default to twice the BB
                              but be flexible. Especially when fewer chips make the straddle simpler": a $5 straddle at
                              $2/$2). Left blank it is twice the big blind; each straddle after it doubles the one before. */}
                          {posted && live[0] && posted.type === live[0].type ? (
                            <div className="replayer-field replayer-straddle-size">
                              <AmountField value={Number(b.straddleAmount) > (Number(b.bb) || 0) ? b.straddleAmount : ''} blankZero cents={cents}
                                disabled={locked} ariaLabel={STRADDLE_LABELS[type] + ' size'} placeholder={formatChipAmount((Number(b.bb) || 0) * 2)}
                                onCommit={v => setBlind('straddleAmount', Number(v) > (Number(b.bb) || 0) && Number(v) !== (Number(b.bb) || 0) * 2 ? v : undefined)} />
                            </div>
                          ) : (
                            <span className="replayer-straddle-amt">
                              {checked
                                ? (posted ? formatChipAmount(posted.amount) : 'covered')
                                : STRADDLE_NOTES[type]}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {on && live.length > 0 && (
                  <div className="replayer-field-hint" style={{marginBottom:'var(--space-sm)'}}>
                    {live.length > 1 ? 'Each straddle doubles the one before it. ' : ''}
                    {Number(b.straddleAmount) > (Number(b.bb) || 0) ? '' : 'Twice the big blind unless you set its size. '}
                    Preflop action starts on {seatBadge((closer + 1) % nSeats)} and {seatBadge(closer)} closes.
                  </div>
                )}
              </>
            );
          })()}
          {category === 'stud' && (
            <div className="gto-entry-note">
              Every player antes, the {LOW_STUD.test(hand.gameType) ? 'high' : 'low'} door card brings it in, and the big bet is bet from 5th street on. Stacks default to {STUD_STACK_BB} big bets; a street allows {betCap} bets.
            </div>
          )}
          {/* The hero was chosen by tapping a seat badge, and nothing said so but a column head
              reading "Hero" (entry audit 33). The badge is a real button now, so a keyboard
              reaches it, and it says it is pressed for the hero. */}
          {!isOfc && !locked && <div className="replayer-field-hint">Tap a seat to make it the hero; drag it to move that player.</div>}
          {hand.players.map((p, i) => {
            const isHero = i === heroIdx;
            const badge = seatBadge(i);
            const offer = nameOffer(i);
            const offerCount = offer.list.length + (offer.rest.length ? 1 : 0);
            return (
              <div key={i} className={'replayer-player-row' + (dragSeat === i ? ' is-dragging' : '')}>
                {!isOfc && <button type="button"
                  className={'replayer-player-pos' + (isHero ? ' hero' : '') + (dragSeat === i ? ' is-grabbed' : '')}
                  aria-pressed={isHero} aria-label={(String(p.name || '').trim() || badge) + ' is the hero'}
                  title={locked ? 'Seats are fixed while the hand has betting in it' : 'Tap to make hero, drag to reorder'}
                  disabled={locked}
                  onPointerDown={locked ? undefined : e => beginSeatDrag(e, i)}
                  onPointerMove={locked ? undefined : moveSeatDrag}
                  onPointerUp={locked ? undefined : endSeatDrag}
                  onPointerCancel={locked ? undefined : endSeatDrag}
                  /* A pointer's tap is handled on pointerup; this is Enter or Space (detail 0). */
                  onClick={e => { if (!locked && e.detail === 0) setHeroSeat(i); }}
                >{badge}</button>}
                <div className="replayer-field" style={{flex:'1 1 calc(var(--subrow) * 10)'}}>
                  <input type="text" style={{textAlign:'left'}} value={p.name} maxLength={20} aria-label={badge + ' name'} placeholder="Name"
                    ref={el => { nameInputs.current[i] = el; }}
                    autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false}
                    role="combobox" aria-autocomplete="list" aria-expanded={offerCount > 0} aria-controls={'gto-names-' + i}
                    onChange={e => { updatePlayerField(i, 'name', e.target.value); setNameSeat(i); setNameHi(-1); }}
                    /* A seat's made-up name (Opp 2) is selected as the field takes focus, so typing replaces it. The
                       mouseup that follows a click would put the caret back: the first one is held. */
                    onFocus={e => {
                      clearTimeout(nameBlur.current);
                      setNameSeat(i); setNameHi(-1);
                      if (isDefaultName(e.target.value)) {
                        const el = e.target;
                        nameFocused.current = true;
                        setTimeout(() => { try { if (document.activeElement === el) el.setSelectionRange(0, el.value.length); } catch { /* ignore */ } }, 0);
                      }
                    }}
                    onMouseUp={e => { if (nameFocused.current) { nameFocused.current = false; e.preventDefault(); } }}
                    onBlur={() => {
                      nameFocused.current = false;
                      clearTimeout(nameBlur.current);
                      nameBlur.current = setTimeout(() => { setNameSeat(s => (s === i ? null : s)); setNameHi(-1); }, 150);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Escape' && offerCount) { e.preventDefault(); setNameSeat(null); return; }
                      if (!offerCount) return;
                      if (e.key === 'ArrowDown') { e.preventDefault(); setNameHi(h => (h + 1) % offerCount); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setNameHi(h => (h <= 0 ? offerCount - 1 : h - 1)); }
                      else if (e.key === 'Enter' && nameHi >= 0 && nameHi < offerCount) {
                        e.preventDefault();
                        if (nameHi < offer.list.length) pickName(i, offer.list[nameHi]); else fillRest(offer.rest);
                      }
                    }} />
                </div>
                {!isOfc && <div className="replayer-field" style={{flex:'0 0 calc(var(--subrow) * 11)'}}>
                  <AmountField value={p.startingStack} cents={cents} disabled={locked} placeholder="Stack"
                    ariaLabel={(String(p.name || '').trim() || badge) + ' stack'}
                    prefix={cents ? <span className="gto-stack-sym">{currencySymbol(hand)}</span> : null} wrap
                    style={{textAlign:'right', flex:'1 1 auto', minWidth:0}}
                    onCommit={v => updatePlayerField(i, 'startingStack', v)} />
                </div>}
                {/* A chip takes no focus from the field (its pointerdown is held), so the keyboard stays up. */}
                {offerCount > 0 && (
                  <div className="gto-name-offer" role="listbox" id={'gto-names-' + i} aria-label="Names from your saved hands">
                    {offer.list.map((nm, k) => (
                      <button key={nm} type="button" role="option" aria-selected={nameHi === k}
                        className={'gto-name-chip ctl snap-g' + (nameHi === k ? ' is-hi' : '')}
                        onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()}
                        onClick={() => pickName(i, nm)}><span>{nm}</span></button>
                    ))}
                    {offer.rest.length > 0 && (
                      <button type="button" role="option" aria-selected={nameHi === offer.list.length}
                        className={'gto-name-chip is-fill ctl snap-g' + (nameHi === offer.list.length ? ' is-hi' : '')}
                        aria-label={'Fill the rest: ' + offer.rest.map(f => f.name).join(', ')}
                        title={offer.rest.map(f => seatBadge(f.seat) + ' ' + f.name).join(', ')}
                        onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()}
                        onClick={() => fillRest(offer.rest)}><span>Fill the rest</span></button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div></div>
        {!isOfc && (
          <div className="gto-cap-row">
            <span className="gto-cap-label">Effective stack</span>
            <div className="replayer-field">
              <AmountField value={buyinCap !== '' && Number.isFinite(capNum) ? capNum : ''} blankZero cents={cents}
                placeholder="Stack" ariaLabel="Effective stack" style={{textAlign:'right'}}
                onCommit={v => { setBuyinCap(String(v)); try { localStorage.setItem('replayerBuyinCap', String(v)); } catch { /* ignore */ } }} />
            </div>
            <button className="btn btn-ghost btn-sm" onClick={resetStacks} disabled={locked} title="Set every seat's stack to the effective stack">Reset stacks</button>
            <button className="btn btn-ghost btn-sm" onClick={resetNames} title="Hero keeps your name; everyone else becomes Opp 1, 2, …">Reset names</button>
          </div>
        )}
        {phaseError && <div className="replayer-field-error gto-setup-error" role="alert">{phaseError}</div>}
        {footBar(<>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          {/* Stud went straight to the door cards from here, which meant
              nothing ever asked hero for 3rd street: the door-card phase
              skips hero by design, the in-action picker is turned off for
              stud, and setPhase('hero_cards') was called from nowhere at all
              — the phase existed and was unreachable. Its own Next button
              already reads "Enter Door Cards" for stud, so this is the order
              it was built for. */}
          <button className="btn btn-primary btn-sm" onClick={goNext}>Next</button>
        </>)}
      </div>
    );
  }

  // ── OFC ENTRY PHASE ──
  if (phase === 'ofc_entry') {
    const ofcRows = hand.ofcRows || {};
    const updateOfcRow = (playerIdx, row, value) => {
      setHand(prev => {
        const newRows = { ...(prev.ofcRows || {}) };
        newRows[playerIdx] = { ...(newRows[playerIdx] || { top: '', middle: '', bottom: '' }) };
        newRows[playerIdx][row] = value;
        return { ...prev, ofcRows: newRows };
      });
    };
    const ofcRowLabels = [
      { key: 'top', label: 'Top (3 cards)', max: 3 },
      { key: 'middle', label: 'Middle (5 cards)', max: 5 },
      { key: 'bottom', label: 'Bottom (5 cards)', max: 5 },
    ];
    const allUsedOfc = new Set();
    hand.players.forEach((_, pi) => {
      const pr = ofcRows[pi] || {};
      ['top', 'middle', 'bottom'].forEach(r => {
        if (pr[r]) parseCardNotation(pr[r]).forEach(c => { if (c.suit !== 'x') allUsedOfc.add(c.rank + c.suit); });
      });
    });
    const ofcAllRanks = 'AKQJT98765432'.split('');
    const ofcAllSuits = ['h', 'd', 'c', 's'];
    const ofcToggleCard = (rank, suit) => {
      if (!ofcPickerState) return;
      const card = rank + suit;
      const pi = ofcPickerState.playerIdx;
      const row = ofcPickerState.row;
      const rowDef = ofcRowLabels.find(r => r.key === row);
      const maxCards = rowDef ? rowDef.max : 5;
      const current = (ofcRows[pi] || {})[row] || '';
      const parsed = parseCardNotation(current).filter(c => c.suit !== 'x');
      const existing = parsed.map(c => c.rank + c.suit);
      const idx = existing.indexOf(card);
      if (idx >= 0) existing.splice(idx, 1);
      else if (existing.length < maxCards) existing.push(card);
      updateOfcRow(pi, row, existing.join(''));
    };
    const ofcPickerSelectedSet = new Set();
    if (ofcPickerState) {
      const _cr = (ofcRows[ofcPickerState.playerIdx] || {})[ofcPickerState.row] || '';
      parseCardNotation(_cr).forEach(c => { if (c.suit !== 'x') ofcPickerSelectedSet.add(c.rank + c.suit); });
    }
    let ofcValid = true;
    let ofcValidMsg = '';
    hand.players.forEach((p, pi) => {
      const pr = ofcRows[pi] || {};
      const topCount = parseCardNotation(pr.top || '').filter(c => c.suit !== 'x').length;
      const midCount = parseCardNotation(pr.middle || '').filter(c => c.suit !== 'x').length;
      const botCount = parseCardNotation(pr.bottom || '').filter(c => c.suit !== 'x').length;
      const total = topCount + midCount + botCount;
      if (total > 0 && total < 13) { ofcValid = false; ofcValidMsg = p.name + ' needs 13 cards total (' + total + ' placed)'; }
      if (topCount > 0 && topCount !== 3) { ofcValid = false; ofcValidMsg = p.name + ' top row needs exactly 3 cards'; }
      if (midCount > 0 && midCount !== 5) { ofcValid = false; ofcValidMsg = p.name + ' middle row needs exactly 5 cards'; }
      if (botCount > 0 && botCount !== 5) { ofcValid = false; ofcValidMsg = p.name + ' bottom row needs exactly 5 cards'; }
    });
    const heroRows = ofcRows[0] || {};
    const heroTotal = parseCardNotation(heroRows.top || '').filter(c => c.suit !== 'x').length +
      parseCardNotation(heroRows.middle || '').filter(c => c.suit !== 'x').length +
      parseCardNotation(heroRows.bottom || '').filter(c => c.suit !== 'x').length;
    if (heroTotal === 0) { ofcValid = false; ofcValidMsg = 'Place cards for at least Hero'; }
    const suitSymbols = { h: '\u2665', d: '\u2666', c: '\u2663', s: '\u2660' };
    const suitColors = { h: '#ef4444', d: '#3b82f6', c: '#22c55e', s: '#a78bfa' };
    return (
      <div className="gto-entry">
        <div className="gto-phase-card"><div className="replayer-section">
          <div className="replayer-section-title">OFC Card Placement</div>
          <div style={{fontSize:'calc(var(--gu) * 0.957)',color:'var(--text-muted)',marginBottom:'var(--space-ml)'}}>
            Place 13 cards per player into 3 rows: Top (3), Middle (5), Bottom (5). Tap a row to open the card picker.
          </div>
          {hand.players.map((p, pi) => {
            const pr = ofcRows[pi] || { top: '', middle: '', bottom: '' };
            return (
              <div key={pi} className="ofc-player-section">
                <div className="ofc-player-name">{p.name}</div>
                <div className="ofc-rows">
                  {ofcRowLabels.map(rowDef => {
                    const isActive = ofcPickerState && ofcPickerState.playerIdx === pi && ofcPickerState.row === rowDef.key;
                    return (
                      <div key={rowDef.key} className={'ofc-row' + (isActive ? ' ofc-row-active' : '')}
                        onClick={() => setOfcPickerState(isActive ? null : { playerIdx: pi, row: rowDef.key })}>
                        <div className="ofc-row-label">{rowDef.label}</div>
                        <div className="ofc-row-cards">
                          <CardRow text={pr[rowDef.key] || ''} max={rowDef.max} placeholderCount={rowDef.max} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {ofcPickerState && ofcPickerState.playerIdx === pi && (
                  <div className="ofc-card-picker">
                    {ofcAllRanks.map(rank => (
                      <div key={rank} className="ofc-picker-rank-row">
                        {ofcAllSuits.map(suit => {
                          const card = rank + suit;
                          const isUsed = allUsedOfc.has(card) && !ofcPickerSelectedSet.has(card);
                          const isSelected = ofcPickerSelectedSet.has(card);
                          return (
                            <button key={card}
                              className={'ofc-picker-card' + (isSelected ? ' selected' : '') + (isUsed ? ' used' : '')}
                              disabled={isUsed}
                              onClick={e => { e.stopPropagation(); ofcToggleCard(rank, suit); }}
                              style={{color: isUsed ? 'var(--text-muted)' : suitColors[suit]}}>
                              {rank}{suitSymbols[suit]}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div></div>
        {ofcValidMsg && <div style={{fontSize:'calc(var(--gu) * 0.957)',color:'#ef4444',padding:'var(--space-xs) 0'}}>{ofcValidMsg}</div>}
        {footBar(<>
          <button className="btn btn-ghost btn-sm" onClick={() => setPhase('setup')}>Back</button>
          <button className="btn btn-primary btn-sm" disabled={!ofcValid} onClick={() => onDone(hand)}>Done</button>
        </>)}
      </div>
    );
  }

  // ── HERO CARDS PHASE ──
  if (phase === 'hero_cards') {
    /* Super (utils/super-stud.js): the five dealt, typed as dealt (the down cards, then the door), in their own field
       (cards.heroSuper) until Enter Door Cards splits them into 3rd street's own and the throw. */
    const superDeal = !!(gameCfg.isStud && hand.superStud);
    const heroField = superDeal ? 'heroSuper' : 'hero';
    const heroCardsVal = superDeal ? superDealText(hand.streets[0] && hand.streets[0].cards) : ((hand.streets[0] && hand.streets[0].cards.hero) || '');
    /* A stud hand is not dealt at once: three cards on 3rd street and one on
       each street after, stored that way too — getStudHeroAllCards accumulates
       cards.hero ACROSS streets. This phase writes streets[0], so it is asking
       for 3rd street alone. gameCfg.heroCards is 7 for stud, the size of the
       finished hand, and would invite all of it into the first street. */
    const heroMaxCards = gameCfg.isStud ? (superDeal ? SUPER_DOWN + 1 : 3) : (gameCfg.heroCards || 2);
    const heroCardsLabel = gameCfg.isStud ? '3rd Street' : 'Hero Cards';
    const heroCurrentCards = parseCardNotation(heroCardsVal).filter(c => c.suit !== 'x').map(c => c.rank + c.suit);
    const heroCurrentSet = new Set(heroCurrentCards);
    const heroAllRanks = ranksFor(hand.gameType);
    const heroAllSuits = [{key:'h',color:'#ef4444'},{key:'d',color:'#3b82f6'},{key:'c',color:'#22c55e'},{key:'s',color:'var(--text)'}];
    /* Read the hand from `prev`, not from the closure. Both branches used
       heroCurrentCards and heroCardsVal, which are this render's values, so
       three taps landing before a re-render all built their answer from the
       same empty string and the last one won — one card out of three. The
       phase was unreachable when it was written, so nothing ever tapped it;
       the other card picker in this file already does it this way. */
    const toggleHeroCard = (card) => {
      setHand(prev => {
        const base = superDeal ? superDealText(prev.streets[0] && prev.streets[0].cards) : ((prev.streets[0] && prev.streets[0].cards.hero) || '');
        const cur = parseCardNotation(base).filter(c => c.suit !== 'x').map(c => c.rank + c.suit);
        let next;
        if (cur.includes(card)) next = cur.filter(c => c !== card).join('');
        else {
          if (cur.length >= heroMaxCards) return prev;
          next = cur.concat(card).join('');
        }
        return { ...prev, streets: prev.streets.map((s, i) => i === 0 ? { ...s, cards: { ...s.cards, [heroField]: next } } : s) };
      });
    };
    // Three different cards, or none (the hand can be entered without them); anything else is said.
    const heroTyped = readTypedCards(heroCardsVal, { max: heroMaxCards, ranks: heroAllRanks.join('') });
    const heroCount = heroTyped.cards.length;
    const heroProblem = heroTyped.error
      || (heroTyped.pending ? 'Finish the last card' : null)
      || (heroCount > 0 && heroCount < heroMaxCards ? heroMaxCards + ' cards, or none' : null);
    return (
      <div className="gto-entry">
        <div className="gto-phase-card">
          <div className="replayer-section">
            <div className="replayer-section-title">{heroCardsLabel}</div>
            <div className="replayer-field">
              <label htmlFor="gto-hero-cards-typed">{gameCfg.isStud ? (superDeal ? 'Four down, one up' : 'Two down, one up') : 'Your Cards'}</label>
              <input id="gto-hero-cards-typed" type="text" placeholder={gameCfg.isStud ? (superDeal ? 'Ah7d9sKc2c' : 'Ah7d2c') : (gameCfg.heroPlaceholder || 'AhKd')}
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                className={heroTyped.error ? 'is-invalid' : undefined} aria-invalid={heroTyped.error ? true : undefined}
                aria-describedby={heroProblem ? 'gto-hero-cards-why' : undefined}
                value={heroCardsVal}
                onChange={e => { const v = e.target.value.replace(/10/g, 'T'); setHand(prev => ({ ...prev, streets: prev.streets.map((s, i) => i === 0 ? { ...s, cards: { ...s.cards, [heroField]: v } } : s) })); }} />
              {/* Stud: the two down cards 1r lower than the door card, as on the seats and the deal screen (owner,
                  2026-11-22: "Show the 3 as an upcard (shifted) in the initial hand entry screen"). */}
              {gameCfg.isStud
                ? <span className="gto-hero-studrun"><StudRun run={heroTyped.cards.slice(0, heroMaxCards).map((c, k) => ({ card: c, down: k < heroMaxCards - 1 }))} /></span>
                : <CardRow text={heroTyped.cards.join('')} stud={gameCfg.isStud} max={heroMaxCards} />}
              {heroProblem && <div className="replayer-field-error" id="gto-hero-cards-why">{heroProblem}</div>}
            </div>
            <div className={pickerGridClass(heroAllRanks)}>
              {heroAllSuits.map(suit => (
                <React.Fragment key={suit.key}>
                  {heroAllRanks.map(rank => {
                    const card = rank + suit.key;
                    const isSelected = heroCurrentSet.has(card);
                    return <button key={card} className={'card-picker-btn' + (isSelected ? ' selected' : '')} onClick={() => toggleHeroCard(card)}>
                      <img src={cardFaceSrc(rank + suit.key)} alt={card} loading="eager" />
                    </button>;
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        <div className="gto-street-card">
          {footBar(<>
            <button className="btn btn-ghost btn-sm" onClick={() => setPhase('setup')}>Back</button>
            <button className="btn btn-primary btn-sm" disabled={!!heroProblem} onClick={() => {
              // What goes on as the hand is the cards read, not the text: "10h" is stored as Th.
              if (superDeal) {
                // The five as 3rd street's own (two down and the door) and the two thrown, until the throw says which.
                setHand(prev => ({ ...prev, streets: prev.streets.map((s, i) => i !== 0 ? s : {
                  ...s, cards: { ...s.cards, heroSuper: heroTyped.cards.join(''), ...splitSuperDeal(heroTyped.cards, s.cards) } }) }));
              } else if (heroTyped.cards.join('') !== heroCardsVal) setHand(prev => ({ ...prev, streets: prev.streets.map((s, i) => i === 0 ? { ...s, cards: { ...s.cards, hero: heroTyped.cards.join('') } } : s) }));
              setPhase(gameCfg.isStud ? 'door_cards' : 'action');
            }}>
              {gameCfg.isStud ? 'Enter Door Cards' : 'Start Action'}
            </button>
          </>)}
        </div>
      </div>
    );
  }

  // ── BOARD ENTRY PHASE ──
  if (phase === 'board_entry' || phase === 'board_door') {
    const isDoor = phase === 'board_door';
    const nextStreet = isDoor ? 0 : currentStreetIdx + 1;
    const streetName = isDoor ? (category === 'community' ? 'First Flop Card' : 'Community Card') : ((hand.streets[nextStreet] && hand.streets[nextStreet].name) || 'Next Street');
    const maxCards = streetDef.boardCards ? streetDef.boardCards[nextStreet] : 1;
    /* Several boards (owner, 2026-10-20): double board deals two on every street; running it twice or
       three times deals the remaining streets once per run, from the street after the all-in. Betting
       is over when someone is all in and at most one player still has chips. */
    const nonFolded = hand.players.map((_, i) => i).filter(i => !foldedSet.has(i));
    // Not with a card before the first bet, or two kinds of hand: a second run has no rules there.
    const twoHands = (gameEvalFor(hand.gameType, hand) || {}).type === 'halves';
    // A cash game's deal: a tournament hand is run once (entry audit 24).
    const runItOffered = hand.gameMode === 'cash' && !isDoor && !gameCfg.doorBoard && !twoHands && !hand.doubleBoard && allInSet.size >= 1 && nonFolded.filter(i => !allInSet.has(i)).length <= 1;
    const runsFrom = hand.runs > 1 ? (hand.runsFrom ?? nextStreet) : null;
    const slots = hand.doubleBoard ? 2 : (hand.runs > 1 && nextStreet >= runsFrom ? hand.runs : 1);
    const slot = Math.min(boardSlot, slots - 1);
    const key = boardKey(slot);
    const boardVal = (hand.streets[nextStreet] && hand.streets[nextStreet].cards[key]) || '';
    const usedCards = new Set();
    hand.streets.forEach(s => {
      parseCardNotation((s.cards.hero || '') + (s.cards.heroThrown || '')).forEach(c => { if (c.suit !== 'x') usedCards.add(c.rank + c.suit); });
      ['board', 'board2', 'board3'].forEach(k => parseCardNotation(s.cards[k] || '').forEach(c => { if (c.suit !== 'x') usedCards.add(c.rank + c.suit); }));
      (s.cards.opponents || []).forEach(opp => { parseCardNotation(opp || '').forEach(c => { if (c.suit !== 'x') usedCards.add(c.rank + c.suit); }); });
      (s.draws || []).forEach(d => { parseCardNotation((d.discardedCards || '') + (d.newCards || '')).forEach(c => { if (c.suit !== 'x') usedCards.add(c.rank + c.suit); }); });
    });
    const currentBoardCards = parseCardNotation(boardVal).filter(c => c.suit !== 'x').map(c => c.rank + c.suit);
    const currentBoardSet = new Set(currentBoardCards);
    currentBoardCards.forEach(c => usedCards.delete(c));
    const allRanks = ranksFor(hand.gameType);
    const allSuits = [{key:'h',color:'#ef4444'},{key:'d',color:'#3b82f6'},{key:'c',color:'#22c55e'},{key:'s',color:'var(--text)'}];
    const setBoard = (val) => setHand(prev => ({ ...prev, streets: prev.streets.map((s, i) => i === nextStreet ? { ...s, cards: { ...s.cards, [key]: val } } : s) }));
    const toggleCard = (card) => {
      if (currentBoardSet.has(card)) setBoard(currentBoardCards.filter(c => c !== card).join(''));
      else if (currentBoardCards.length < maxCards) setBoard(boardVal + card);
    };
    // Running it N times: chosen on the first street dealt after the all-in; Once clears the extra runs.
    const chooseRuns = (n) => {
      setBoardSlot(0);
      setHand(prev => {
        const next = { ...prev };
        if (n > 1) { next.runs = n; next.runsFrom = nextStreet; }
        else { delete next.runs; delete next.runsFrom; }
        next.streets = prev.streets.map(s => {
          const cards = { ...s.cards };
          if (n < 3) delete cards.board3;
          if (n < 2) delete cards.board2;
          return { ...s, cards };
        });
        return next;
      });
    };
    const shownBoards = handBoards(hand, currentStreetIdx);
    const shownSoFar = isDoor ? '' : (shownBoards[Math.min(slot, shownBoards.length - 1)] || '');
    const slotLabel = (k) => (hand.doubleBoard ? 'Board ' : 'Run ') + (k + 1);
    const slotFull = (k) => parseCardNotation((hand.streets[nextStreet] && hand.streets[nextStreet].cards[boardKey(k)]) || '').filter(c => c.suit !== 'x').length >= maxCards;
    /* The typed field is held to the same deck as the picker: a card already out, the same card twice
       or something that is not a card is named and stops Continue. They went straight onto the board
       (entry audit 5). */
    const boardTyped = readTypedCards(boardVal, { max: maxCards, used: usedCards, ranks: allRanks.join('') });
    const boardProblem = boardTyped.error || (boardTyped.pending ? 'Finish the last card' : null);
    const allDealt = !boardProblem && Array.from({ length: slots }, (_, k) => slotFull(k)).every(Boolean);

    return (
      <div className="gto-entry">
        <div className="gto-phase-card">
          <div className="replayer-section" style={{textAlign:'center'}}>
            <div className="gto-street-label">Deal the {streetName}{slots > 1 ? ' · ' + slotLabel(slot) : ''}</div>
            {runItOffered && (runsFrom == null || runsFrom === nextStreet) && (
              <div className="gto-runs" role="radiogroup" aria-label="Run it">
                {[[1, 'Run it once'], [2, 'Twice'], [3, 'Three times']].map(([n, label]) => (
                  <button key={n} type="button" role="radio" aria-checked={(hand.runs || 1) === n}
                    className={'gto-runs-btn' + ((hand.runs || 1) === n ? ' is-on' : '')} onClick={() => chooseRuns(n)}><span>{label}</span></button>
                ))}
              </div>
            )}
            {slots > 1 && (
              <div className="gto-runs gto-board-slots" role="tablist" aria-label="Board">
                {Array.from({ length: slots }, (_, k) => (
                  <button key={k} type="button" role="tab" aria-selected={k === slot}
                    className={'gto-runs-btn' + (k === slot ? ' is-on' : '')} onClick={() => setBoardSlot(k)}><span>{slotLabel(k)}</span></button>
                ))}
              </div>
            )}
            <div className="gto-board-deal">
              {shownSoFar && <CardRow text={shownSoFar} max={5} />}
              {boardVal && <CardRow text={boardVal} max={maxCards} />}
            </div>
            <div className="replayer-field">
              <label htmlFor="gto-board-typed">{streetName} Cards{slots > 1 ? ' · ' + slotLabel(slot) : ''}</label>
              <input id="gto-board-typed" type="text" placeholder={nextStreet === 1 ? 'Qh7d2c' : 'Ts'} value={boardVal}
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                className={boardTyped.error ? 'is-invalid' : undefined} aria-invalid={boardTyped.error ? true : undefined}
                aria-describedby={boardProblem ? 'gto-board-typed-why' : undefined}
                onChange={e => setBoard(e.target.value.replace(/10/g, 'T'))} />
              {boardProblem && <div className="replayer-field-error" id="gto-board-typed-why">{boardProblem}</div>}
            </div>
            <div className={pickerGridClass(allRanks)}>
              {allSuits.map(suit => (
                <React.Fragment key={suit.key}>
                  {allRanks.map(rank => {
                    const card = rank + suit.key;
                    const isUsed = usedCards.has(card);
                    const isSelected = currentBoardSet.has(card);
                    // Disabled, not only greyed: a keyboard or an assistive tap reached a used card (entry audit 6).
                    return <button key={card} className={'card-picker-btn' + (isSelected ? ' selected' : '') + (isUsed ? ' used' : '')} disabled={isUsed && !isSelected} onClick={() => toggleCard(card)}>
                      <img src={cardFaceSrc(rank + suit.key)} alt={card} loading="eager" />
                    </button>;
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        {footBar(<>
          {isDoor ? <button className="btn btn-ghost btn-sm" onClick={() => setPhase('setup')}>Back</button> : <button className="gto-undo-btn" disabled={!canUndo} onClick={undoLastAction}>Undo</button>}
          {slots > 1 && slot < slots - 1 && slotFull(slot) ? (
            <button className="btn btn-primary btn-sm" onClick={() => setBoardSlot(slot + 1)}>Next: {slotLabel(slot + 1)}</button>
          ) : (
            <button className="btn btn-primary btn-sm" disabled={!allDealt} onClick={() => { setBoardSlot(0); setCurrentStreetIdx(nextStreet); setPhase('action'); }}>{isDoor ? 'Start Action' : 'Continue'}</button>
          )}
        </>)}
      </div>
    );
  }

  // ── SHOWDOWN PHASE ──
  if (phase === 'showdown') {
    const isStudShowdown = category === 'stud';
    const isDrawShowdown = hasDraws(category, gameCfg);
    // Collect used cards
    const sdUsedCards = new Set();
    hand.streets.forEach(s => {
      parseCardNotation((s.cards.hero || '') + (s.cards.heroThrown || '')).forEach(c => { if (c.suit !== 'x') sdUsedCards.add(c.rank + c.suit); });
      // Every board: a double board's second and a run's were left out, so their cards could be shown in a hand.
      ['board', 'board2', 'board3'].forEach(k => parseCardNotation(s.cards[k] || '').forEach(c => { if (c.suit !== 'x') sdUsedCards.add(c.rank + c.suit); }));
      (s.cards.opponents || []).forEach(opp => { parseCardNotation(opp || '').forEach(c => { if (c.suit !== 'x') sdUsedCards.add(c.rank + c.suit); }); });
      (s.draws || []).forEach(d => { parseCardNotation((d.discardedCards || '') + (d.newCards || '')).forEach(c => { if (c.suit !== 'x') sdUsedCards.add(c.rank + c.suit); }); });
    });
    const showdownPlayers = hand.players.map((p, i) => ({ player: p, idx: i })).filter(o => o.idx !== heroIdx && !foldedSet.has(o.idx));
    const sdMaxCards = gameCfg.showCards || gameCfg.heroCards || 2;
    const sdAllRanks = ranksFor(hand.gameType);
    const sdAllSuits = [{key:'h'},{key:'d'},{key:'c'},{key:'s'}];

    // For stud: accumulate cards from all streets for each player
    const getStudAllCards = (oppSlot) => {
      let accumulated = '';
      hand.streets.forEach(s => { const oppC = (s.cards.opponents || [])[oppSlot] || ''; if (oppC && oppC !== 'MUCK') accumulated += oppC; });
      return accumulated;
    };
    const getStudHeroAllCards = () => {
      let accumulated = '';
      hand.streets.forEach(s => { if (s.cards.hero) accumulated += s.cards.hero; });
      return accumulated;
    };
    const getOppCardStr = (oppSlot) => {
      if (isStudShowdown) return getStudAllCards(oppSlot);
      return (hand.streets[0].cards.opponents && hand.streets[0].cards.opponents[oppSlot]) || '';
    };

    return (
      <div className="gto-entry">
        <div className="gto-phase-card">
          <div className="replayer-section" style={{textAlign:'center'}}>
            <div className="gto-street-label">Showdown</div>
            {cumulativeBoard && <div className="gto-board-deal"><CardRow text={cumulativeBoard} max={5} /></div>}
          </div>
        </div>
        {showdownPlayers.map((o, si) => {
          const oppSlot = o.idx > heroIdx ? o.idx - 1 : o.idx;
          const oppCardStr = getOppCardStr(oppSlot);
          const isMucked = oppCardStr === 'MUCK' || (hand.streets[0].cards.opponents && hand.streets[0].cards.opponents[oppSlot]) === 'MUCK';
          const oppParsed = isMucked ? [] : parseCardNotation(oppCardStr).filter(c => c.suit !== 'x');
          const oppCardSet = new Set(oppParsed.map(c => c.rank + c.suit));
          const isComplete = isMucked || oppParsed.length >= sdMaxCards;

          // Stud: count known vs unknown cards
          let studKnownCount = 0;
          if (isStudShowdown && !isMucked) {
            for (let _si = 0; _si < hand.streets.length; _si++) {
              const _sc = (hand.streets[_si].cards.opponents || [])[oppSlot] || '';
              parseCardNotation(_sc).filter(c => c.suit !== 'x').forEach(() => studKnownCount++);
            }
          }
          const studMissingCount = isStudShowdown ? Math.max(0, sdMaxCards - oppParsed.length) : 0;

          // Build used set excluding this opponent's own cards
          const thisUsed = new Set(sdUsedCards);
          showdownPlayers.forEach(other => {
            if (other.idx === o.idx) return;
            const otherSlot = other.idx > heroIdx ? other.idx - 1 : other.idx;
            const otherStr = getOppCardStr(otherSlot);
            if (otherStr !== 'MUCK') parseCardNotation(otherStr).forEach(c => { if (c.suit !== 'x') thisUsed.add(c.rank + c.suit); });
          });
          oppParsed.forEach(c => thisUsed.delete(c.rank + c.suit));

          const setMuck = () => setHand(prev => {
            const opps = [...(prev.streets[0].cards.opponents || [])]; opps[oppSlot] = 'MUCK';
            return { ...prev, streets: prev.streets.map((s, i) => i === 0 ? { ...s, cards: { ...s.cards, opponents: opps } } : s) };
          });
          const clearOppCards = () => {
            if (isStudShowdown) {
              setHand(prev => ({ ...prev, streets: prev.streets.map(s => {
                const opps = [...(s.cards.opponents || [])]; opps[oppSlot] = '';
                return { ...s, cards: { ...s.cards, opponents: opps } };
              }) }));
            } else {
              setHand(prev => {
                const opps = [...(prev.streets[0].cards.opponents || [])]; opps[oppSlot] = '';
                return { ...prev, streets: prev.streets.map((s, i) => i === 0 ? { ...s, cards: { ...s.cards, opponents: opps } } : s) };
              });
            }
          };
          const toggleSdCard = (card) => {
            if (oppCardSet.has(card)) {
              if (isStudShowdown) {
                // Remove from whichever street has it
                setHand(prev => ({ ...prev, streets: prev.streets.map(s => {
                  const opps = [...(s.cards.opponents || [])];
                  const curr = opps[oppSlot] || '';
                  if (curr.indexOf(card) >= 0) { opps[oppSlot] = curr.replace(card, ''); return { ...s, cards: { ...s.cards, opponents: opps } }; }
                  return s;
                }) }));
              } else {
                const remaining = oppParsed.map(c => c.rank + c.suit).filter(c => c !== card);
                setHand(prev => {
                  const opps = [...(prev.streets[0].cards.opponents || [])]; opps[oppSlot] = remaining.join('');
                  return { ...prev, streets: prev.streets.map((s, i) => i === 0 ? { ...s, cards: { ...s.cards, opponents: opps } } : s) };
                });
              }
            } else {
              if (oppParsed.length >= sdMaxCards || thisUsed.has(card)) return;
              if (isStudShowdown) {
                // Prepend hidden cards to street 0
                setHand(prev => {
                  const opps = [...(prev.streets[0].cards.opponents || [])]; opps[oppSlot] = card + (opps[oppSlot] || '');
                  return { ...prev, streets: prev.streets.map((s, i) => i === 0 ? { ...s, cards: { ...s.cards, opponents: opps } } : s) };
                });
              } else {
                setHand(prev => {
                  const opps = [...(prev.streets[0].cards.opponents || [])]; opps[oppSlot] = oppCardStr + card;
                  return { ...prev, streets: prev.streets.map((s, i) => i === 0 ? { ...s, cards: { ...s.cards, opponents: opps } } : s) };
                });
              }
            }
          };

          return (
            <div key={o.idx} className="gto-phase-card" style={{opacity: isComplete ? 0.6 : 1}}>
              <div className="replayer-section">
                <div className="gto-sd-head">
                  <div className="gto-sd-who"><span className="replayer-player-pos">{o.player.position}</span><span className="gto-sd-name">{o.player.name}</span></div>
                  {isMucked ? <button className="gto-undo-btn" onClick={clearOppCards}>Undo Muck</button> : isComplete ? <button className="gto-undo-btn" onClick={clearOppCards}>Clear</button> : <button className="gto-undo-btn" onClick={setMuck}>Muck</button>}
                </div>
                {isMucked ? <div className="gto-sd-mucked">Mucked</div> : (
                  <>
                    {oppParsed.length > 0 && <div className="gto-sd-cards">
                      <CardRow text={oppCardStr} stud={isStudShowdown} max={sdMaxCards} />
                      {isStudShowdown && studMissingCount > 0 && <div className="gto-entry-note">
                        {studKnownCount} known card{studKnownCount !== 1 ? 's' : ''}, {studMissingCount} hidden card{studMissingCount !== 1 ? 's' : ''} remaining
                      </div>}
                    </div>}
                    {!isComplete && (
                      <div className={pickerGridClass(sdAllRanks)}>
                        {sdAllSuits.map(suit => (
                          <React.Fragment key={suit.key}>
                            {sdAllRanks.map(rank => {
                              const card = rank + suit.key;
                              const isUsedByOther = thisUsed.has(card);
                              const isSelected = oppCardSet.has(card);
                              return <button key={card} className={'card-picker-btn' + (isSelected ? ' selected' : '') + (isUsedByOther ? ' used' : '')} disabled={isUsedByOther && !isSelected} onClick={() => toggleSdCard(card)}>
                                <img src={cardFaceSrc(rank + suit.key)} alt={card} loading="eager" />
                              </button>;
                            })}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        {footBar(<>
          <button className="gto-undo-btn" disabled={!canUndo} onClick={undoLastAction}>Undo</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            // Auto-evaluate showdown winners
            const playerHands = [];
            let heroCardStr;
            if (isStudShowdown) heroCardStr = getStudHeroAllCards();
            else if (isDrawShowdown) { const heroBase = hand.streets[0].cards.hero || ''; heroCardStr = computeDrawHand(heroBase, getPlayerDrawsByStreet(hand, heroIdx), hand.streets.length - 1, hand.gameType); }
            else heroCardStr = hand.streets[0].cards.hero || '';
            const heroParsed = parseCardNotation(heroCardStr).filter(c => c.suit !== 'x');
            /* A folded hero is not in the showdown: their cards were scored, and the hero saved as a
               winner, or a sole winner shown as a split (entry vs oracle, 2). */
            const heroLive = !foldedSet.has(heroIdx);
            if (heroLive && heroParsed.length > 0) playerHands.push({ idx: heroIdx, cards: heroParsed });
            // A live hand nobody entered: the winner cannot be worked out, so it is asked for (entry audit 11).
            let unknownHands = heroLive && heroParsed.length === 0 ? 1 : 0;
            showdownPlayers.forEach(o => {
              const oppSlot = o.idx > heroIdx ? o.idx - 1 : o.idx;
              const oppStr = getOppCardStr(oppSlot);
              if (oppStr === 'MUCK') return;
              const oppParsed = parseCardNotation(oppStr || '').filter(c => c.suit !== 'x');
              if (oppParsed.length > 0) playerHands.push({ idx: o.idx, cards: oppParsed });
              else unknownHands++;
            });
            if (unknownHands > 0) {
              setHand(prev => ({ ...prev, result: { ...prev.result, winners: ((prev.result || {}).winners || []).filter(w => !foldedSet.has(w.playerIdx)) } }));
              setPhase('result');
              return;
            }
            let fullBoardStr = '';
            hand.streets.forEach(s => { if (s.cards.board) fullBoardStr += s.cards.board; });
            const boardParsed = parseCardNotation(fullBoardStr).filter(c => c.suit !== 'x');
            // Several boards (double board, run it twice or three times): every board judged, the
            // winners named per board or run (utils/poker-engine.js multiBoardWinners).
            if (boardCount(hand) > 1 && playerHands.length > 1) {
              const boards = handBoards(hand).map(b => parseCardNotation(b).filter(c => c.suit !== 'x'));
              const winners = multiBoardWinners(hand.gameType, playerHands, boards, hand, (i) => houseName(hand.players[i].name));
              if (winners.length > 0) setHand(prev => ({ ...prev, result: { ...prev.result, winners } }));
              setPhase('result');
              return;
            }
            if (playerHands.length === 1) {
              setHand(prev => ({ ...prev, result: { ...prev.result, winners: [{ playerIdx: playerHands[0].idx, split: false }] } }));
            } else if (playerHands.length > 1) {
              let winners = evaluateShowdown(hand.gameType, playerHands, boardParsed, hand);
              // Add hi/lo split labels for hilo games
              const _ec = gameEvalFor(hand.gameType, hand);
              if (_ec && _ec.type === 'hilo' && winners.some(w => w.split)) {
                const _hs = {}; const _ls = {};
                playerHands.forEach(ph => {
                  _hs[ph.idx] = bestHighFor(_ec, ph.cards, boardParsed);
                  const lo = bestLow8For(_ec, ph.cards, boardParsed);
                  _ls[ph.idx] = lo && lo.qualified ? lo : null;
                });
                let _bh = -1, _bl = Infinity;
                Object.keys(_hs).forEach(k => { if (_hs[k] && _hs[k].score > _bh) _bh = _hs[k].score; });
                Object.keys(_ls).forEach(k => { if (_ls[k] && _ls[k].score < _bl) _bl = _ls[k].score; });
                winners = winners.map(w => {
                  const lb = [];
                  if (_hs[w.playerIdx] && _hs[w.playerIdx].score === _bh) lb.push('Hi: ' + (_hs[w.playerIdx].shortName || _hs[w.playerIdx].name));
                  if (_ls[w.playerIdx] && _ls[w.playerIdx].score === _bl) lb.push('Lo: ' + _ls[w.playerIdx].name);
                  if (lb.length) return { ...w, label: houseName(hand.players[w.playerIdx].name) + ' wins ' + lb.join(', ') };
                  return w;
                });
              }
              if (_ec && _ec.type === 'halves') {
                winners = winners.map(w => {
                  const ph = playerHands.find(x => x.idx === w.playerIdx);
                  const name = ph ? halvesHandName(_ec, scoreHalves(_ec, ph.cards, boardParsed), w.hi, w.lo, true) : null;
                  return name && (w.hi || w.lo) ? { ...w, label: houseName(hand.players[w.playerIdx].name) + ' wins ' + name.replace(/\n/g, ', ') } : w;
                });
              }
              if (winners.length > 0) setHand(prev => ({ ...prev, result: { ...prev.result, winners } }));
            }
            setPhase('result');
          }}>Continue</button>
        </>)}
      </div>
    );
  }

  // ── RESULT PHASE ──
  if (phase === 'result') {
    const autoWinner = handOver && activePlayers.length === 1 ? hand.players.indexOf(activePlayers[0]) : -1;
    /* What the result is confirmed from (entry audit 36): the pot, each live player's cards and made
       hand, and in a split game which half each takes. It read "Hero (Split) / Opp 1 (Split)" alone. */
    const rhi = heroIdx;
    const rCfg = gameEvalFor(hand.gameType, hand);
    let rBoard = '';
    hand.streets.forEach(s => { if (s.cards && s.cards.board) rBoard += s.cards.board; });
    const rBoardCards = parseCardNotation(rBoard).filter(c => c.suit !== 'x');
    const rCardsOf = (pi) => {
      const slot = pi < rhi ? pi : pi - 1;
      if (category === 'stud') {
        let acc = '';
        hand.streets.forEach(s => { const c = pi === rhi ? s.cards.hero : (s.cards.opponents || [])[slot]; if (c && c !== 'MUCK') acc += c; });
        return acc;
      }
      const base = pi === rhi ? (hand.streets[0].cards.hero || '') : ((hand.streets[0].cards.opponents || [])[slot] || '');
      if (base === 'MUCK') return '';
      return (pi === rhi && hasDraws(category, gameCfg))
        ? computeDrawHand(base, getPlayerDrawsByStreet(hand, pi), hand.streets.length - 1, hand.gameType) : base;
    };
    const rDescribe = (cardsStr) => {
      const cs = parseCardNotation(cardsStr).filter(c => c.suit !== 'x');
      if (!rCfg || !cs.length || (rCfg.type !== 'high' && rCfg.type !== 'hilo')) return '';
      try {
        const hi = bestHighFor(rCfg, cs, rBoardCards);
        const hiName = hi ? (hi.shortName || hi.name || '') : '';
        if (rCfg.type !== 'hilo') return hiName;
        const lo = bestLow8For(rCfg, cs, rBoardCards);
        return hiName + (lo && lo.qualified ? ' · low ' + lo.name : ' · no low');
      } catch { return ''; }
    };
    const rLive = hand.players.map((_, i) => i).filter(i => !foldedSet.has(i));
    const rLabels = ((hand.result || {}).winners || []).map(w => w.label).filter(Boolean);
    return (
      <div className="gto-entry">
        <div className="gto-phase-card">
          <div className="replayer-section">
            <div className="replayer-section-title">Result</div>
            <div className="gto-entry-note">Pot {amt$(currentPot)}</div>
            {autoWinner >= 0 ? (
              <div className="gto-result-auto">
                <div className="gto-result-win">{hand.players[autoWinner].name} wins</div>
                <div className="gto-result-sub">All opponents folded</div>
              </div>
            ) : (
              <>
                <div className="gto-winner-grid">
                  {hand.players.filter((_, i) => !foldedSet.has(i)).map(p => {
                    const pi = hand.players.indexOf(p);
                    const winners = (hand.result && hand.result.winners) || [];
                    const isWinner = winners.some(w => w.playerIdx === pi && !w.split);
                    const isSplit = winners.some(w => w.playerIdx === pi && w.split);
                    /* A tap marks this player the winner; a second player marked makes it a split; a tap on
                       a marked player takes them off. Cycling none, win, split let two "Win"s or one lone
                       "Split" be saved (entry audit 12). */
                    return (
                      <button key={pi} type="button" className="gto-winner-btn" aria-pressed={isWinner || isSplit} style={{
                        background: isWinner ? 'rgba(74,222,128,0.15)' : isSplit ? 'rgba(250,204,21,0.15)' : 'transparent',
                        borderColor: isWinner ? '#4ade80' : isSplit ? '#facc15' : 'var(--border)',
                        color: isWinner ? '#4ade80' : isSplit ? '#facc15' : 'var(--text-muted)',
                      }} onClick={() => {
                        setHand(prev => {
                          const prevWinners = ((prev.result && prev.result.winners) || []).filter(w => !foldedSet.has(w.playerIdx));
                          const marked = prevWinners.some(w => w.playerIdx === pi);
                          let next = marked ? prevWinners.filter(w => w.playerIdx !== pi) : [...prevWinners, { playerIdx: pi, split: false, label: '' }];
                          const split = next.length > 1;
                          next = next.map(w => ({ ...w, split }));
                          return { ...prev, result: { ...prev.result, winners: next } };
                        });
                      }}>
                        {p.name} {isWinner ? '(Win)' : isSplit ? '(Split)' : ''}
                      </button>
                    );
                  })}
                </div>
                <div className="gto-entry-note">
                  {(hand.result?.winners?.length) ? 'Worked out from the cards; change it if it is wrong. '
                    : rLive.some(pi => !rCardsOf(pi)) ? 'Not every hand still in was entered, so the winner is yours to mark (or go Back and mark a hand mucked). ' : ''}
                  Tap the winner. Tap a second player if they split the pot.
                </div>
                {rLabels.map((l, k) => <div key={k} className="gto-entry-note">{l}</div>)}
                {autoWinner < 0 && rLive.map(pi => {
                  const cs = rCardsOf(pi);
                  const desc = cs ? rDescribe(cs) : '';
                  return (
                    <div key={pi} className="gto-result-hand">
                      <div className="gto-deal-row">
                        <span className="gto-deal-name">{hand.players[pi].name}</span>
                        <span className={'gto-deal-meta' + (cs ? '' : ' is-unknown')}>{cs ? desc : 'not shown'}</span>
                      </div>
                      {cs && <CardRow text={cs} stud={category === 'stud'} max={parseCardNotation(cs).length} />}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
        {phaseError && <div className="replayer-field-error gto-setup-error" role="alert">{phaseError}</div>}
        <div className="gto-street-card">
          {footBar(<>
            {/* After a showdown, Back returns to it; Undo took off the river's last bet and skipped the
                showdown (entry audit 12). A hand won by folds has no showdown: Undo takes the last fold back. */}
            {autoWinner >= 0
              ? <button className="gto-undo-btn" disabled={!canUndo} onClick={undoLastAction}>Undo</button>
              : <button className="btn btn-ghost btn-sm" onClick={() => setPhase('showdown')}>Back</button>}
            <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={() => {
              // A winner who has since folded (the action was changed after the result) is dropped.
              const kept = ((hand.result || {}).winners || []).filter(w => !foldedSet.has(w.playerIdx));
              const savedHand = { ...hand, heroIdx, result: { ...(hand.result || {}), winners: kept } };
              if (autoWinner >= 0 && !kept.length) {
                onDone({ ...savedHand, result: { winners: [{ playerIdx: autoWinner, split: false, label: '' }] } });
              } else if (!kept.length) {
                // A hand saved with no winner replayed with the pot going nowhere (entry audit 7).
                setPhaseError('Tap the player who won, then save.');
              } else onDone(savedHand);
            }}>Save & Replay</button>
          </>)}
        </div>
      </div>
    );
  }

  // ── DOOR CARDS PHASE (Stud) ──
  if (phase === 'door_cards') {
    const heroIdxDC = hand.heroIdx != null ? hand.heroIdx : 0;
    const oppCards0 = (hand.streets[0] && hand.streets[0].cards.opponents) || [];
    const numOpps = hand.players.length - 1;
    const usedCardsDC = new Set();
    parseCardNotation(((hand.streets[0]?.cards.hero) || '') + ((hand.streets[0]?.cards.heroThrown) || '')).forEach(c => { if (c.suit !== 'x') usedCardsDC.add(c.rank + c.suit); });
    oppCards0.forEach(opp => { parseCardNotation(opp || '').forEach(c => { if (c.suit !== 'x') usedCardsDC.add(c.rank + c.suit); }); });
    const dcRanks = 'AKQJT98765432'.split('');
    const dcSuits = [{key:'h',color:'#ef4444'},{key:'d',color:'#3b82f6'},{key:'c',color:'#22c55e'},{key:'s',color:'var(--text)'}];

    const setOppDoorCard = (oppIdx, card) => {
      setHand(prev => {
        const streets = prev.streets.map((s, si) => {
          if (si !== 0) return s;
          const opponents = [...(s.cards.opponents || [])];
          opponents[oppIdx] = opponents[oppIdx] === card ? '' : card;
          return { ...s, cards: { ...s.cards, opponents } };
        });
        return { ...prev, streets };
      });
    };

    /* The door cards decide who brings it in, so every one is needed before the action; and a card
       goes to the row tapped, as on the later streets. It went to the first empty row only, and Start
       Action went ahead with none (entry audit 16). */
    const dcSlotOf = (pi) => (pi < heroIdxDC ? pi : pi - 1);
    const dcTargetSlot = studDealTarget !== heroIdxDC && studDealTarget >= 0 && studDealTarget < hand.players.length ? dcSlotOf(studDealTarget) : -1;
    const dcMissing = hand.players.map((_, pi) => pi).filter(pi => pi !== heroIdxDC && !oppCards0[dcSlotOf(pi)]);
    return (
      <div className="gto-entry">
        <div className="gto-phase-card"><div className="replayer-section">
          <div className="replayer-section-title">Opponent Door Cards</div>
          <p className="gto-entry-note">Tap an opponent, then their face-up 3rd street card.{dcMissing.length ? ' Every one is needed: the door cards decide who brings it in.' : ''}</p>
          {hand.players.map((p, pi) => {
            if (pi === heroIdxDC) return null;
            const oppSlot = dcSlotOf(pi);
            const currentCard = oppCards0[oppSlot] || '';
            const parsedCurrent = parseCardNotation(currentCard).filter(c => c.suit !== 'x');
            const selectedCard = parsedCurrent.length ? parsedCurrent[0].rank + parsedCurrent[0].suit : '';
            const isTarget = studDealTarget === pi;
            return (
              <button type="button" key={pi} className={'gto-deal-row is-pickable' + (isTarget ? ' is-target' : '')}
                aria-pressed={isTarget} onClick={() => setStudDealTarget(pi)}>
                <span className="gto-deal-name">{p.name}</span>
                <span className="gto-deal-meta">{p.position}</span>
                {selectedCard ? <CardRow text={selectedCard} max={1} /> : <span className="gto-deal-meta is-unknown">? unknown</span>}
              </button>
            );
          })}
          <div className="card-picker-grid">
            {dcSuits.map(suit => (
              <React.Fragment key={suit.key}>
                {dcRanks.map(rank => {
                  const card = rank + suit.key;
                  const isUsed = usedCardsDC.has(card);
                  let selectedForOpp = -1;
                  oppCards0.forEach((opp, oi) => { if (opp === card) selectedForOpp = oi; });
                  return <button key={card} className={'card-picker-btn' + (selectedForOpp >= 0 ? ' selected' : '') + (isUsed && selectedForOpp < 0 ? ' used' : '')} disabled={isUsed && selectedForOpp < 0} onClick={() => {
                    if (selectedForOpp >= 0) { setOppDoorCard(selectedForOpp, ''); return; }
                    const slot = dcTargetSlot >= 0 ? dcTargetSlot : (dcMissing.length ? dcSlotOf(dcMissing[0]) : -1);
                    if (slot < 0 || slot >= numOpps) return;
                    setOppDoorCard(slot, card);
                    // On to the next opponent still without a card, after this one.
                    const at = slot >= heroIdxDC ? slot + 1 : slot;
                    const next = dcMissing.find(pi => pi !== at && pi > at) ?? dcMissing.find(pi => pi !== at);
                    if (next !== undefined) setStudDealTarget(next);
                  }}>
                    <img src={cardFaceSrc(rank + suit.key)} alt={card} loading="eager" />
                  </button>;
                })}
              </React.Fragment>
            ))}
          </div>
        </div></div>
        <div className="gto-street-card">
          {footBar(<>
            {/* Back goes to the step before this one, which is now hero's own
                3rd street. Only stud reaches the door cards at all. */}
            <button className="btn btn-ghost btn-sm" onClick={() => setPhase('hero_cards')}>Back</button>
            <button className="btn btn-primary btn-sm" disabled={dcMissing.length > 0}
              title={dcMissing.length ? 'Every door card decides who brings it in' : undefined}
              onClick={() => setPhase('action')}>Start Action</button>
          </>)}
        </div>
      </div>
    );
  }

  // ── DRAW DISCARD PHASE ──
  if (phase === 'draw_discard' || phase === 'draw_cards_entry') {
    const nextDrawStreet = currentStreetIdx + 1;
    const drawActivePlayers = seatOrder.filter(i => !foldedSet.has(i));
    // On to the next street's betting, or, with a board too, to dealing it first.
    const afterDraw = () => { if (category === 'community') setPhase('board_entry'); else { setCurrentStreetIdx(nextDrawStreet); setPhase('action'); } };
    const heroThrow = (currentStreet.draws || []).find(d => d.player === (hand.heroIdx != null ? hand.heroIdx : 0));
    const throwMissing = !!gameCfg.discardOnly && !!heroThrow && !!(hand.streets[0]?.cards.hero) && !parseCardNotation(heroThrow.discardedCards || '').length;

    const addDraw = (playerIdx, discardCount, discardedCards = '') => {
      setHand(prev => ({ ...prev, streets: prev.streets.map((s, si) => si !== currentStreetIdx ? s : { ...s, draws: [...(s.draws || []), { player: playerIdx, discarded: discardCount, discardedCards, newCards: '' }] }) }));
    };
    const undoLastDraw = () => {
      setHand(prev => ({ ...prev, streets: prev.streets.map((s, si) => si !== currentStreetIdx ? s : { ...s, draws: (s.draws || []).slice(0, -1) }) }));
    };
    const updateDrawCardsFn = (playerIdx, field, val) => {
      setHand(prev => ({
        ...prev,
        streets: prev.streets.map((s, si) => si !== currentStreetIdx ? s : {
          ...s, draws: (s.draws || []).map(d => d.player !== playerIdx ? d : { ...d, [field]: val })
        })
      }));
    };
    const getDrawPlayerHand = (pi) => {
      const dhi = hand.heroIdx != null ? hand.heroIdx : 0;
      const oppSlot = pi > dhi ? pi - 1 : pi;
      const base = pi === dhi ? (hand.streets[0]?.cards.hero || '') : (hand.streets[0]?.cards.opponents?.[oppSlot] || '');
      return computeDrawHand(base, getPlayerDrawsByStreet(hand, pi), currentStreetIdx - 1, hand.gameType);
    };
    const drawPlayerQueue = drawActivePlayers.filter(pi => !(currentStreet.draws || []).find(d => d.player === pi));
    const currentDrawPlayer = drawPlayerQueue.length > 0 ? drawPlayerQueue[0] : -1;
    const allDrawsDeclared = drawPlayerQueue.length === 0;
    const isBadugi = ['Badugi','PL Badugi','Badeucy','Badacy'].includes(hand.gameType);
    const maxDiscard = isBadugi ? 4 : 5;

    if (phase === 'draw_cards_entry') {
      /* The title names the draw, not the betting round before it ("Pre-Draw" for the first draw), and
         the hero's cards are held to the hand: the discards must be cards held, the new ones cards not
         yet seen, each as many as the draw, and new cards need their discards named, or they replaced
         the first cards of the hand (entry audit 26). */
      const drawTitle = gameCfg.discardOnly ? 'the throw'
        : isDrawCategory(category) ? ((hand.streets[nextDrawStreet] || {}).name || 'the draw') : 'the draw';
      const hiDC = hand.heroIdx != null ? hand.heroIdx : 0;
      const heroDE = (currentStreet.draws || []).find(d => d.player === hiDC);
      let drawProblem = null;
      if (heroDE && heroDE.discarded > 0 && !gameCfg.discardOnly) {
        const held = new Set(parseCardNotation(getDrawPlayerHand(hiDC) || '').filter(c => c.suit !== 'x').map(c => c.rank + c.suit));
        const out = readTypedCards(heroDE.discardedCards || '', { max: heroDE.discarded, ranks: ranksFor(hand.gameType).join('') });
        const inn = readTypedCards(heroDE.newCards || '', { max: heroDE.discarded, ranks: ranksFor(hand.gameType).join('') });
        const notHeld = out.cards.find(c => held.size && !held.has(c));
        drawProblem = out.error ? 'Discarded: ' + out.error
          : notHeld ? 'Discarded: ' + notHeld + ' is not in your hand'
          : inn.error ? 'New cards: ' + inn.error
          : (out.pending || inn.pending) ? 'Finish the last card'
          : (out.cards.length && out.cards.length !== heroDE.discarded) ? 'Name all ' + heroDE.discarded + ' discarded, or none'
          : (inn.cards.length && inn.cards.length !== heroDE.discarded) ? 'Name all ' + heroDE.discarded + ' new cards, or none'
          : (inn.cards.length && !out.cards.length) ? 'Name the discards first: the new cards take their places'
          : null;
      }
      return (
        <div className="gto-entry">
          <div className="gto-phase-card"><div className="replayer-section">
            <div className="replayer-section-title">{'Card details: ' + drawTitle}</div>
            <p className="gto-entry-note">{gameCfg.discardOnly ? 'Everyone throws one card before the flop. Tap the one you threw.' : 'Name the cards thrown and drawn if you know them, or press Continue.'}</p>
            {drawActivePlayers.map(pi => {
              const p = hand.players[pi];
              const de = (currentStreet.draws || []).find(d => d.player === pi);
              if (!de) return null;
              const isPat = de.discarded === 0;
              const isHeroDraw = pi === (hand.heroIdx != null ? hand.heroIdx : 0);
              const curHand = isHeroDraw ? getDrawPlayerHand(pi) : null;
              return (
                <div key={pi} className="gto-dce-box">
                  <div className="gto-deal-row gto-dce-head">
                    <span className="gto-deal-name">{p.name}</span>
                    <span className="gto-deal-meta">{p.position}</span>
                    {isPat && <span className="replayer-draw-pat-badge">Stand Pat</span>}
                    {!isPat && <span className="replayer-draw-count-badge">Draws {de.discarded}</span>}
                  </div>
                  {isHeroDraw && curHand && (() => {
                    const handCards = parseCardNotation(curHand);
                    const discardedSet = new Set(parseCardNotation(de.discardedCards || '').map(c => c.rank + c.suit));
                    const toggleDiscard = (card) => {
                      if (isPat) return;
                      const cardKey = card.rank + card.suit;
                      const currentDiscarded = parseCardNotation(de.discardedCards || '');
                      const currentSet = new Set(currentDiscarded.map(c => c.rank + c.suit));
                      let newDiscarded;
                      if (currentSet.has(cardKey)) {
                        newDiscarded = currentDiscarded.filter(c => (c.rank + c.suit) !== cardKey).map(c => c.rank + c.suit).join('');
                      } else {
                        if (currentDiscarded.length >= de.discarded) return;
                        newDiscarded = (de.discardedCards || '') + cardKey;
                      }
                      updateDrawCardsFn(pi, 'discardedCards', newDiscarded);
                    };
                    return (
                      <div className="gto-dce-hand">
                        <span className="gto-picker-label">
                          {isPat ? 'Current Hand' : 'Tap to select discards'}
                        </span>
                        <div className="card-row gto-card-run">
                          {handCards.map((c, ci) => {
                            const isDiscarded = discardedSet.has(c.rank + c.suit);
                            const img = <img className={'card-img draw-selectable' + (isDiscarded ? ' draw-discarded' : '')}
                              src={cardFaceSrc(c.rank + c.suit)} alt={c.rank + c.suit} loading="eager" />;
                            // A button, so a keyboard and a screen reader reach it; a pat hand is only shown.
                            return isPat ? <React.Fragment key={ci}>{img}</React.Fragment> : (
                              <button key={ci} type="button" className="gto-discard-card" aria-pressed={isDiscarded}
                                aria-label={(isDiscarded ? 'Keep ' : 'Throw ') + c.rank + c.suit} onClick={() => toggleDiscard(c)}>{img}</button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  {isHeroDraw && !isPat && !gameCfg.discardOnly && (
                    <div className="gto-dce-fields">
                      <div className="replayer-field">
                        <label htmlFor={'gto-thrown-' + pi}>Discarded</label>
                        <input id={'gto-thrown-' + pi} type="text" placeholder="e.g. 7h3c" value={de.discardedCards || ''}
                          autoCapitalize="none" autoCorrect="off" spellCheck={false}
                          onChange={e => updateDrawCardsFn(pi, 'discardedCards', e.target.value.replace(/10/g, 'T'))} />
                      </div>
                      <div className="replayer-field">
                        <label>New Cards</label>
                        <DrawNewCardsInput placeholder="e.g. Ah5s" value={de.newCards || ''}
                          dead={drawDeadCards(hand, currentStreetIdx, pi)}
                          onChange={v => updateDrawCardsFn(pi, 'newCards', v)} />
                        {de.newCards && <CardRow text={de.newCards} max={de.discarded} />}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div></div>
          {drawProblem && <div className="replayer-field-error gto-setup-error" role="alert">{drawProblem}</div>}
          <div className="gto-street-card">
            {footBar(<>
              <button className="btn btn-ghost btn-sm" onClick={() => (gameCfg.discardOnly ? undoLastAction() : setPhase('draw_discard'))}>Back</button>
              <button className="btn btn-primary btn-sm" disabled={throwMissing || !!drawProblem} onClick={afterDraw}>Continue</button>
            </>)}
          </div>
        </div>
      );
    }

    return (
      <div className="gto-entry">
        <div className="gto-phase-card"><div className="replayer-section">
          <div className="replayer-section-title">Draw Round</div>
          <p className="gto-entry-note">Each player declares how many cards to discard.</p>
          {drawActivePlayers.map(pi => {
            const p = hand.players[pi];
            const existingDraw = (currentStreet.draws || []).find(d => d.player === pi);
            const isDeclared = !!existingDraw;
            const isCurrentTarget = pi === currentDrawPlayer;
            const curHand = getDrawPlayerHand(pi);
            // Build draw history across prior streets
            const drawHistory = [];
            for (let si = 0; si < currentStreetIdx; si++) {
              const pastStreet = hand.streets[si];
              if (!pastStreet || !pastStreet.draws || !pastStreet.draws.length) continue;
              const pastDraw = pastStreet.draws.find(d => d.player === pi);
              if (pastDraw) drawHistory.push(pastDraw.discarded === 0 ? 'Pat' : 'D' + pastDraw.discarded);
            }
            return (
              <div key={pi} className={'gto-seat' + (isCurrentTarget ? ' active' : '') + (isDeclared ? ' gto-draw-declared' : '')}>
                <div className="gto-seat-strip">{p.position}</div>
                <div className="gto-seat-content">
                  <div className="gto-seat-bar">
                    <div className="gto-seat-row1"><span className="gto-seat-pos">{p.position}</span><span className="gto-seat-stack">{formatChipAmount(currentStacks[pi])}</span></div>
                    <div className="gto-seat-row2">
                      <span className="gto-seat-name">{p.name}</span>
                      {isDeclared && <span className="gto-seat-result-badge check" style={{marginLeft:'auto'}}>{existingDraw.discarded === 0 ? 'Stand Pat' : 'Draws ' + existingDraw.discarded}</span>}
                    </div>
                    {drawHistory.length > 0 && <div className="gto-seat-draw-history">{drawHistory.join(' / ')}</div>}
                  </div>
                  {(() => {
                    /* The hero's draw in one pass (UX pick 60): before the count, the cards tapped are the
                       throw and the count follows; after a count, they name which. Once named, the new
                       cards come from the picker under the hand, every card already out of play left out. */
                    const heroRowDR = pi === (hand.heroIdx != null ? hand.heroIdx : 0) && !gameCfg.discardOnly;
                    const named = isDeclared ? parseCardNotation(existingDraw.discardedCards || '').map(c => c.rank + c.suit) : drawMarks;
                    const limit = isDeclared ? existingDraw.discarded : maxDiscard;
                    const marking = heroRowDR && curHand && ((isCurrentTarget && !isDeclared) || (isDeclared && existingDraw.discarded > 0 && named.length < existingDraw.discarded));
                    if (!marking) return curHand ? <div className="gto-seat-cards"><CardRow text={curHand} max={gameCfg.heroCards || 5} /></div> : null;
                    const toggle = (k) => {
                      const on = named.includes(k);
                      const next = on ? named.filter(x => x !== k) : (named.length < limit ? [...named, k] : named);
                      if (isDeclared) updateDrawCardsFn(pi, 'discardedCards', next.join(''));
                      else setDrawMarks(next);
                    };
                    return (
                      <div className="gto-seat-cards gto-draw-marks">
                        <span className="gto-picker-label">{isDeclared ? 'Tap the ' + existingDraw.discarded + ' you threw' : 'Tap the cards you throw'}</span>
                        <div className="card-row gto-card-run">
                          {parseCardNotation(curHand).filter(c => c.suit !== 'x').map(c => {
                            const k = c.rank + c.suit;
                            const on = named.includes(k);
                            return (
                              <button key={k} type="button" className="gto-discard-card" aria-pressed={on}
                                aria-label={(on ? 'Keep ' : 'Throw ') + k} onClick={() => toggle(k)}>
                                <img className={'card-img draw-selectable' + (on ? ' draw-discarded' : '')} src={cardFaceSrc(k)} alt={k} loading="eager" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  {isCurrentTarget && !isDeclared && (
                    <div className="gto-draw-buttons">
                      {pi === (hand.heroIdx != null ? hand.heroIdx : 0) && drawMarks.length > 0 ? (
                        <>
                          <button className="gto-draw-btn is-marked" onClick={() => { addDraw(pi, drawMarks.length, drawMarks.join('')); setDrawMarks([]); }}>{'Draw ' + drawMarks.length}</button>
                          <button className="gto-draw-btn pat" onClick={() => setDrawMarks([])}>Clear</button>
                        </>
                      ) : (
                        <>
                          <button className="gto-draw-btn pat" onClick={() => addDraw(pi, 0)}>Stand Pat</button>
                          {Array.from({length: maxDiscard}, (_, n) => n + 1).map(count => (
                            <button key={count} className="gto-draw-btn" onClick={() => addDraw(pi, count)}>{count}</button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                  {pi === (hand.heroIdx != null ? hand.heroIdx : 0) && !gameCfg.discardOnly && isDeclared && existingDraw.discarded > 0
                    && parseCardNotation(existingDraw.discardedCards || '').length === existingDraw.discarded && (() => {
                    const n = existingDraw.discarded;
                    const fresh = parseCardNotation(existingDraw.newCards || '').map(c => c.rank + c.suit);
                    const dead = drawDeadCards(hand, currentStreetIdx, pi);
                    const ranks = ranksFor(hand.gameType);
                    const toggleNew = (k) => {
                      const on = fresh.includes(k);
                      const next = on ? fresh.filter(x => x !== k) : (fresh.length < n ? [...fresh, k] : fresh);
                      updateDrawCardsFn(pi, 'newCards', next.join(''));
                    };
                    return (
                      <div className="gto-draw-new">
                        <span className="gto-picker-label">{'New cards: ' + fresh.length + ' of ' + n + (fresh.length ? '' : ' (or leave them unknown)')}</span>
                        <div className={pickerGridClass(ranks)}>
                          {['h', 'd', 'c', 's'].map(su => (
                            <React.Fragment key={su}>
                              {ranks.map(r => {
                                const k = r + su;
                                const on = fresh.includes(k);
                                const out = !on && dead.has(k);
                                return <button key={k} type="button" className={'card-picker-btn' + (on ? ' selected' : '') + (out ? ' used' : '')} disabled={out} onClick={() => toggleNew(k)}>
                                  <img src={cardFaceSrc(k)} alt={k} loading="eager" />
                                </button>;
                              })}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div></div>
        <div className="gto-street-card">
          {footBar(<>
            {/* One Undo: it takes back the last declaration, and with none, the bet that closed the
                round. "Back" did the second while looking like the first (entry audit 27). */}
            <button className="gto-undo-btn" onClick={() => {
              if ((currentStreet.draws || []).length > 0) { undoLastDraw(); return; }
              // Clear draws on this street and undo the last betting action to return to action phase
              setHand(prev => {
                for (let si = currentStreetIdx; si >= 0; si--) {
                  const acts = prev.streets[si].actions || [];
                  if (acts.length > 0) {
                    const streets = prev.streets.map((s, i) => {
                      if (i < si) return s;
                      if (i === si) { const updated = { ...s, actions: acts.slice(0, -1) }; if (i === currentStreetIdx) updated.draws = []; return updated; }
                      return { ...s, actions: [], draws: [] };
                    });
                    if (si < currentStreetIdx) setCurrentStreetIdx(si);
                    return { ...prev, streets };
                  }
                }
                return prev;
              });
              setPhase('action');
            }}>Undo</button>
            {(() => {
              const hi = hand.heroIdx != null ? hand.heroIdx : 0;
              const hd = (currentStreet.draws || []).find(d => d.player === hi);
              const drew = hd && hd.discarded > 0;
              // Named here (UX pick 60): the throw in full, the new cards in full or not at all.
              const out = drew ? parseCardNotation(hd.discardedCards || '').length : 0;
              const inn = drew ? parseCardNotation(hd.newCards || '').length : 0;
              const namedHere = drew && !gameCfg.discardOnly && out === hd.discarded;
              const ready = namedHere && (inn === 0 || inn === hd.discarded);
              return (
                <>
                  {drew && !gameCfg.discardOnly && allDrawsDeclared && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhase('draw_cards_entry')}>Type instead</button>
                  )}
                  <button className="btn btn-primary btn-sm" disabled={!allDrawsDeclared || (namedHere && !ready)} onClick={() => {
                    if (!drew || ready) afterDraw();
                    else setPhase('draw_cards_entry');
                  }}>{!drew || namedHere ? 'Continue' : 'Enter Cards'}</button>
                </>
              );
            })()}
          </>)}
        </div>
      </div>
    );
  }

  // ── STUD DEAL PHASE ──
  // ── SUPER: THE THROW (owner, 2026-11-28: "discard is after 3rd street betting, before 4th is dealt") ──
  if (phase === 'super_throw') {
    const c0 = (hand.streets[0] && hand.streets[0].cards) || {};
    const downs = superDowns(c0);
    const was = parseCardNotation(c0.heroThrown || '').filter(c => c.suit !== 'x').map(c => c.rank + c.suit);
    const pick = superPick || was;
    const throwN = SUPER_THROWN_IDX.length;
    const tapThrow = (card) => setSuperPick(p => {
      const cur = p || was;
      if (cur.includes(card)) return cur.filter(c => c !== card);
      return cur.length >= throwN ? cur : [...cur, card];
    });
    return (
      <div className="gto-entry">
        <div className="gto-phase-card">
          <div className="replayer-section">
            <div className="replayer-section-title">Super: the throw</div>
            <div className="gto-entry-note">Everyone still in throws two down cards before 4th street.</div>
            <div className="gto-dce-hand">
              <span className="gto-picker-label">Tap the two you threw</span>
              <div className="card-row gto-card-run">
                {downs.map(card => {
                  const on = pick.includes(card);
                  return (
                    <button key={card} type="button" className="gto-discard-card" aria-pressed={on}
                      aria-label={(on ? 'Keep ' : 'Throw ') + card} onClick={() => tapThrow(card)}>
                      <img className={'card-img draw-selectable' + (on ? ' draw-discarded' : '')} src={cardFaceSrc(card)} alt={card} loading="eager" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="gto-street-card">
          {footBar(<>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSuperPick(null); setPhase('action'); }}>Back</button>
            <button className="btn btn-primary btn-sm" disabled={pick.length !== throwN} onClick={() => {
              setHand(prev => ({ ...prev, streets: prev.streets.map((s, i) => i !== 0 ? s : { ...s, cards: { ...s.cards, ...applySuperThrow(s.cards, pick) } }) }));
              setSuperPick(null);
              setPhase('stud_deal');
            }}>Continue</button>
          </>)}
        </div>
      </div>
    );
  }

  if (phase === 'stud_deal') {
    const nextStudStreet = currentStreetIdx + 1;
    const studStreetName = (hand.streets[nextStudStreet]?.name) || 'Next Street';
    const heroIdxSD = hand.heroIdx != null ? hand.heroIdx : 0;
    const sdActivePlayers = hand.players.map((_, pi) => pi).filter(pi => !foldedSet.has(pi));

    const setStudCard = (playerIdx, card) => {
      setHand(prev => {
        const streets = prev.streets.map((s, si) => {
          if (si !== nextStudStreet) return s;
          const newCards = { ...s.cards };
          if (playerIdx === heroIdxSD) { newCards.hero = newCards.hero === card ? '' : card; }
          else {
            const oppSlot = playerIdx < heroIdxSD ? playerIdx : playerIdx - 1;
            const opponents = [...(newCards.opponents || [])];
            opponents[oppSlot] = opponents[oppSlot] === card ? '' : card;
            newCards.opponents = opponents;
          }
          return { ...s, cards: newCards };
        });
        return { ...prev, streets };
      });
    };

    const getStudCardForPlayer = (pi) => {
      const nextStreetData = hand.streets[nextStudStreet] || { cards: { hero: '', opponents: [] } };
      if (pi === heroIdxSD) return nextStreetData.cards.hero || '';
      const oppSlot = pi < heroIdxSD ? pi : pi - 1;
      return (nextStreetData.cards.opponents || [])[oppSlot] || '';
    };

    /* Every card already dealt anywhere else in this hand. The picker only ever
       consulted the street it was dealing, so a card that came down on 3rd
       street was still live on 5th and could be dealt to somebody a second
       time. This street's own cards stay out of the set — they are already
       handled as selections, and tapping one takes it back. */
    const sdDead = new Set();
    hand.streets.forEach((st, si) => {
      if (si === nextStudStreet) return;
      const cs = st.cards || {};
      const eat = (str) => parseCardNotation(str || '').forEach(c => { if (c.suit !== 'x') sdDead.add(c.rank + c.suit); });
      eat(cs.hero);
      eat(cs.heroThrown);
      eat(cs.board);
      (cs.opponents || []).forEach(eat);
    });

    /* 7th street is dealt face down: an opponent's card is entered only if it was shown, so only the
       hero's is needed. Continue stayed off until every live seat had one, and a card nobody saw had
       to be made up (entry audit 8; entry vs oracle, cannot enter 2). */
    const sdFaceDown = nextStudStreet === hand.streets.length - 1;
    /* On 7th the opponents' cards are backs, not rows to deal to (owner, 2026-11-23: "On 7th in stud just show
       opponents' card face down without the words face down and without the option to edit it"): only the hero's card
       is dealt here, and a shown one is entered with the rest of the hand at the showdown. */
    const sdHeroIn = sdActivePlayers.includes(heroIdxSD);
    const sdDealt = sdFaceDown ? sdActivePlayers.filter(pi => pi === heroIdxSD) : sdActivePlayers;
    const sdTarget = sdFaceDown ? (sdHeroIn ? heroIdxSD : -1) : studDealTarget;
    if (sdFaceDown) sdActivePlayers.forEach(pi => { if (pi !== heroIdxSD) parseCardNotation(getStudCardForPlayer(pi)).forEach(c => { if (c.suit !== 'x') sdDead.add(c.rank + c.suit); }); });
    const sdNeeded = sdDealt;
    const sdReady = sdNeeded.every(pi => getStudCardForPlayer(pi));
    const sdRanks = 'AKQJT98765432'.split('');
    const sdSuits = [{key:'h'},{key:'d'},{key:'c'},{key:'s'}];

    return (
      <div className="gto-entry">
        <div className="gto-phase-card"><div className="replayer-section">
          <div className="replayer-section-title">Deal {studStreetName}</div>
          <p className="gto-entry-note">{!sdFaceDown ? 'Tap a player, then tap a card.' : sdHeroIn ? 'Tap your card. Your opponents’ are dealt face down.' : 'Every card on this street is dealt face down.'}</p>
          {sdActivePlayers.map(pi => {
            const p = hand.players[pi];
            const cardStr = getStudCardForPlayer(pi);
            const isTarget = sdTarget === pi;
            /* A player with no name entered also shows their seat (owner, 2026-11-22, of a deal listing Opp 3, the hero,
               Opp 2: "If no names are entered, yes, that will just minimize confusion"): the rows go round from Seat 1,
               the dealer's left, and choosing the hero's seat turns every player round the table, so a default
               "Opp N" need not sit in seat N. */
            const unnamed = /^(Opp \d+|Hero)$/.test(String(p.name || '').trim());
            const who = (
              <span className="gto-deal-who">
                <span className="gto-deal-name">{p.name}</span>
                {unnamed && <span className="gto-deal-seat">{p.position || 'Seat ' + (pi + 1)}</span>}
              </span>
            );
            /* The hand so far (owner, 2026-11-22: "show the hands up to this point here"), down cards 1r lower, then
               the card this street deals. */
            const run = <span className="gto-deal-run"><StudRun run={studRunFor(hand, pi, heroIdxSD, currentStreetIdx)} /></span>;
            // An opponent's 7th street card: a back, 1r lower as a down card is, and nothing to tap.
            if (sdFaceDown && pi !== heroIdxSD) return (
              <div key={pi} className="gto-deal-row is-pickable is-fixed has-run">
                {who}{run}
                <span className="gto-deal-new is-down"><div className="card-row"><div className="card-unknown" aria-label="Face down" /></div></span>
              </div>
            );
            return (
              <button type="button" key={pi} className={'gto-deal-row is-pickable has-run' + (isTarget ? ' is-target' : '')}
                aria-pressed={isTarget} onClick={() => { if (!sdFaceDown) setStudDealTarget(pi); }}>
                {who}{run}
                {cardStr ? <span className={'gto-deal-new' + (sdFaceDown ? ' is-down' : '')}><CardRow text={cardStr} max={1} /></span>
                  : <span className="gto-deal-meta is-unknown">--</span>}
              </button>
            );
          })}
          {sdDealt.length > 0 && <div className="card-picker-grid">
            {sdSuits.map(suit => (
              <React.Fragment key={suit.key}>
                {sdRanks.map(rank => {
                  const card = rank + suit.key;
                  let selectedFor = -1;
                  sdDealt.forEach(pi => { if (getStudCardForPlayer(pi) === card) selectedFor = pi; });
                  const isDead = selectedFor < 0 && sdDead.has(card);
                  return <button key={card} title={isDead ? 'Already dealt' : undefined}
                    className={'card-picker-btn' + (selectedFor >= 0 ? ' selected' : '') + (isDead ? ' used' : '')}
                    disabled={isDead} onClick={() => {
                    if (selectedFor >= 0) setStudCard(selectedFor, '');
                    else if (sdTarget >= 0) {
                      // On 7th the hero's card is the only one: a new pick replaces it.
                      setStudCard(sdTarget, card);
                      const nextTarget = sdDealt.find(pi => pi !== sdTarget && !getStudCardForPlayer(pi));
                      if (nextTarget !== undefined) setStudDealTarget(nextTarget);
                    }
                  }}>
                    <img src={cardFaceSrc(rank + suit.key)} alt={card} loading="eager" />
                  </button>;
                })}
              </React.Fragment>
            ))}
          </div>}
        </div></div>
        <div className="gto-street-card">
          {footBar(<>
            <button className="btn btn-ghost btn-sm" onClick={() => setPhase('action')}>Back</button>
            <button className="btn btn-primary btn-sm" disabled={!sdReady} onClick={() => { setCurrentStreetIdx(nextStudStreet); setPhase('action'); }}>Continue</button>
          </>)}
        </div>
      </div>
    );
  }

  // ── ACTION PHASE ──
  const stickySlot = document.getElementById('gto-sticky-slot');
  const streetCardEl = (
    <div className="gto-street-card gto-street-sticky">
      <div className="gto-street-bar">
        <span className="gto-street-name">{currentStreet.name}</span>
        {(category === 'community' || gameCfg.doorBoard) && cumulativeBoard && <span className="gto-board-inline"><CardRow text={cumulativeBoard} max={5} /></span>}
        <span className="gto-pot-label">{formatChipAmount(currentPot)}</span>
      </div>
    </div>
  );

  return (
    <div className="gto-entry is-action">
      {stickySlot && createPortal(streetCardEl, stickySlot)}
      {seatOrder.map(i => {
        const p = hand.players[i];
        const isActive = i === currentActor;
        const act = playerActions[i];
        const isFolded = foldedSet.has(i);
        const foldedOnPriorStreet = isFolded && !(currentStreet.actions || []).some(a => a.player === i && a.action === 'fold');
        if (foldedOnPriorStreet && !isPreflop && category !== 'stud') return null;
        const seatClass = 'gto-seat' + (gameCfg.isStud ? ' is-stud' : '') + (isActive ? ' active' : '') + (isFolded ? ' folded' : (act && !isActive) ? ' acted-' + act.action : '');
        const seatTotal = chipRound(streetBets.contrib[i] || 0);
        const actionLabel = !act ? ''
          : (act.action === 'raise' || (act.action === 'bet' && seatTotal > act.amount)) && act.amount > 0 ? 'Raise to ' + formatChipAmount(seatTotal)
          : act.action === 'all-in' && act.amount > 0 ? 'All-in ' + formatChipAmount(seatTotal)
          : act.action.charAt(0).toUpperCase() + act.action.slice(1) + (act.amount > 0 ? ' ' + formatChipAmount(act.amount) : '');
        /* The hero's cards. A mis-tapped card could not be put right: the picker closed on the last
           card and its "Edit Cards" branch was never reached (entry audit 4). Tapping the cards on the
           seat reopens it, at any point in the hand, and Done closes it. Every card already out is off
           the picker: the board so far and the opponents' shown cards. */
        const heroPicker = () => {
          const hcBase = (hand.streets[0] && hand.streets[0].cards.hero) || '';
          const isDrawGameLocal = hasDraws(category, gameCfg);
          const hcDisplay = isDrawGameLocal ? computeDrawHand(hcBase, getPlayerDrawsByStreet(hand, i), currentStreetIdx - 1, hand.gameType) : hcBase;
          const hcParsed = parseCardNotation(hcDisplay);
          const hcSet = new Set(hcParsed.map(c => c.rank + c.suit));
          const hcDoor = new Set();
          hand.streets.forEach((s, si) => {
            if (si > currentStreetIdx && !s.cards?.board) return;
            parseCardNotation(s.cards?.board || '').forEach(c => { if (c.suit !== 'x') hcDoor.add(c.rank + c.suit); });
            (s.cards?.opponents || []).forEach(o => { if (o && o !== 'MUCK') parseCardNotation(o).forEach(c => { if (c.suit !== 'x') hcDoor.add(c.rank + c.suit); }); });
          });
          const hcMaxCards = gameCfg.heroCards || 2;
          // The cards dealt, not those held: Pineapple's hero holds one fewer after the flop's throw.
          const heroHasCards = parseCardNotation(hcBase).length >= hcMaxCards;
          const pickerOpen = showHeroCardPicker || !heroHasCards;
          if (!pickerOpen) return null;
          const hcRanks = ranksFor(hand.gameType);
          const hcSuits = [{key:'h',color:'#ef4444'},{key:'d',color:'#3b82f6'},{key:'c',color:'#22c55e'},{key:'s',color:'var(--text)'}];
          const toggleHCard = (card) => {
            setHand(prev => {
              const base = (prev.streets[0] && prev.streets[0].cards.hero) || '';
              const curParsed = parseCardNotation(base);
              const curSet = new Set(curParsed.map(c => c.rank + c.suit));
              let newCards;
              if (curSet.has(card)) newCards = curParsed.filter(c => (c.rank + c.suit) !== card).map(c => c.rank + c.suit).join('');
              else { if (curParsed.length >= hcMaxCards) return prev; newCards = base + card; }
              return { ...prev, streets: prev.streets.map((s, si) => si === 0 ? { ...s, cards: { ...s.cards, hero: newCards } } : s) };
            });
          };
          return (
            <div className={'gto-hero-picker' + (heroHasCards ? ' has-cards' : '')}>
              <div className="gto-picker-label">
                {heroHasCards ? 'Change your cards: tap one to take it back' : 'Select Your Cards'}
              </div>
              <div className={pickerGridClass(hcRanks)}>
                {hcSuits.map(suit => (
                  <React.Fragment key={suit.key}>
                    {hcRanks.map(rank => {
                      const card = rank + suit.key;
                      const isSelected = hcSet.has(card);
                      const out = !isSelected && hcDoor.has(card);
                      return <button key={card} className={'card-picker-btn' + (isSelected ? ' selected' : '') + (out ? ' used' : '')} disabled={out} onClick={() => toggleHCard(card)}>
                        <img src={cardFaceSrc(rank + suit.key)} alt={card} loading="eager" />
                      </button>;
                    })}
                  </React.Fragment>
                ))}
              </div>
              {showHeroCardPicker && (
                <div className="gto-btn-row">
                  <button type="button" className="btn btn-primary btn-sm" disabled={!heroHasCards} onClick={() => setShowHeroCardPicker(false)}>Done</button>
                </div>
              )}
            </div>
          );
        };
        return (
          <div key={i} ref={isActive ? activeSeatRef : null} className={seatClass}
            onClick={act && !isActive ? () => rewindToPlayer(i) : undefined}
            style={act && !isActive ? {cursor:'pointer'} : undefined}>
            <div className="gto-seat-strip">{p.position}</div>
            <div className="gto-seat-content">
              <div className="gto-seat-bar">
                <div className="gto-seat-row1"><span className="gto-seat-pos">{p.position}</span><span className="gto-seat-stack">{formatChipAmount(currentStacks[i])}</span></div>
                <div className="gto-seat-row2 is-act">
                  {/* Between the name and the cards (owner, 2026-11-22: "Keep the cards in the same location on the card
                      always, put the betting action between the name and the cards"): after the cards, a seat's action
                      pushed its cards left the moment it acted. The cards end on the row's right edge whatever is here.
                      The action spans the grid's third major column (owner, 2026-11-22), so the name and a draw game's
                      history share what is left of it (.gto-seat-who). */}
                  <span className="gto-seat-who">
                  <span className="gto-seat-name">{p.name}</span>
                  {hasDraws(category, gameCfg) && !gameCfg.discardOnly && (() => {
                    const dh = [];
                    for (let si = 0; si < currentStreetIdx; si++) {
                      const ps = hand.streets[si];
                      if (!ps || !ps.draws || !ps.draws.length) continue;
                      const pd = ps.draws.find(d => d.player === i);
                      if (pd) dh.push(pd.discarded === 0 ? 'Pat' : 'D' + pd.discarded);
                    }
                    if (dh.length === 0) return null;
                    return <span className="gto-seat-draw-history">{dh.join(' / ')}</span>;
                  })()}
                  </span>
                  {act && !isActive && <span className={'gto-seat-result-badge ' + act.action}><span className="gto-seat-badge-label snap-g">{actionLabel}</span></span>}
                  {i === heroIdx && !gameCfg.isStud && (() => {
                    const baseCards = hand.streets[0]?.cards.hero || '';
                    if (!baseCards) return null;
                    const isDrawGameLocal = hasDraws(category, gameCfg);
                    const displayCards = isDrawGameLocal ? computeDrawHand(baseCards, getPlayerDrawsByStreet(hand, i), currentStreetIdx - 1, hand.gameType) : baseCards;
                    return (
                      <button type="button" className="gto-seat-hero-cards gto-hero-cards-btn" aria-label="Change your cards"
                        aria-expanded={showHeroCardPicker}
                        onClick={e => { e.stopPropagation(); setShowHeroCardPicker(v => !v); }}>
                        <CardRow text={displayCards} max={gameCfg.heroCards || 2} />
                      </button>
                    );
                  })()}
                  {gameCfg.isStud && (() => {
                    /* The player's cards so far, the down ones 1r lower than the up ones, the hero's included (owner,
                       2026-11-22: "there is no indication of hero's upcards"); studRunFor. A folded opponent keeps
                       only the up cards everyone saw, dimmed; a folded hero, all of them, dimmed. */
                    const run = studRunFor(hand, i, heroIdx, currentStreetIdx);
                    const shown = isFolded && i !== heroIdx ? run.filter(c => c.card && !c.down) : run;
                    if (!shown.some(c => c.card) && (isFolded || !shown.length)) return null;
                    return (
                      <span className={'gto-seat-hero-cards is-stud' + (isFolded ? ' is-folded' : '')}>
                        <StudRun run={shown} />
                      </span>
                    );
                  })()}
                </div>
              </div>
              {!isActive && i === heroIdx && !gameCfg.isStud && showHeroCardPicker && (
                <div className="gto-seat-detail-wrap" onClick={e => e.stopPropagation()}><div className="gto-seat-detail-inner"><div className="gto-seat-detail">
                  {heroPicker()}
                </div></div></div>
              )}
              {isActive && (
                <div className="gto-seat-detail-wrap"><div className="gto-seat-detail-inner"><div className="gto-seat-detail">
                  {/* Hero card picker: open while the hero's cards are incomplete, or reopened from the seat */}
                  {i === heroIdx && !gameCfg.isStud && heroPicker()}
                  {/* Stud bring-in: first action on 3rd street */}
                  {gameCfg.isStud && currentStreetIdx === 0 && studInfo && studInfo.bringInIdx === currentActor && !(currentStreet.actions || []).length ? (
                    <div className="gto-action-row">
                      <button className="gto-action-btn" onClick={() => addAction('bring-in', bringInAmount)}><span className="gto-action-icon call">&#x2B24;</span><span className="gto-action-label">Bring In {formatChipAmount(bringInAmount)}</span></button>
                      <button className="gto-action-btn" onClick={() => addAction('bet', Math.min(flBetSize, playerStack))}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">Complete {formatChipAmount(Math.min(flBetSize, playerStack))}</span></button>
                    </div>
                  ) : gameCfg.isStud && currentStreetIdx === 0 && (currentStreet.actions || []).length > 0 && streetBets.maxBet <= bringInAmount && streetBetRaiseCount === 0 ? (
                    <div className="gto-action-row">
                      <button className="gto-action-btn" onClick={() => addAction('fold')}><span className="gto-action-icon fold">&#x2715;</span><span className="gto-action-label">Fold</span></button>
                      <button className="gto-action-btn" onClick={() => addAction('call', Math.min(callAmount, playerStack))}><span className="gto-action-icon call">&#x2B24;</span><span className="gto-action-label">Call {formatChipAmount(Math.min(callAmount, playerStack))}</span></button>
                      <button className="gto-action-btn" onClick={() => { const completeAmt = Math.min(flBetSize - playerContrib, playerStack); addAction('bet', completeAmt); }}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">Complete {formatChipAmount(Math.min(flBetSize, playerStack + playerContrib))}</span></button>
                      {!isLimitGame && playerStack > (flBetSize - playerContrib) && <button className="gto-action-btn" onClick={() => { setShowRaiseInput(true); setBetAmount(String(Math.min(flBetSize, chipRound(playerStack + playerContrib)))); }}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">Raise</span></button>}
                    </div>
                  ) : isLimitGame ? (
                    <div className="gto-action-row">
                      {!canCheck && <button className="gto-action-btn" onClick={() => addAction('fold')}><span className="gto-action-icon fold">&#x2715;</span><span className="gto-action-label">Fold</span></button>}
                      {canCheck ? <button className="gto-action-btn" onClick={() => addAction('check')}><span className="gto-action-icon check">&#x2713;</span><span className="gto-action-label">Check</span></button>
                        : <button className="gto-action-btn" onClick={() => addAction('call', Math.min(callAmount, playerStack))}><span className="gto-action-icon call">&#x2B24;</span><span className="gto-action-label">Call {formatChipAmount(Math.min(callAmount, playerStack))}</span></button>}
                      {flCanRaise && canRaiseHere && (canCheck
                        ? <button className="gto-action-btn" onClick={() => addAction('bet', Math.min(flBetSize, playerStack))}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">Bet {formatChipAmount(Math.min(flBetSize, playerStack))}</span></button>
                        : <button className="gto-action-btn" onClick={() => addAction('raise', Math.min(flRaiseIncrement, playerStack))}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">Raise to {formatChipAmount(Math.min(flRaiseToTotal, playerStack + playerContrib))}</span></button>
                      )}
                      {flCanRaise && canRaiseHere && canCheck && flOpenPairChoice && flBigBet > flBetSize && (
                        <button className="gto-action-btn" onClick={() => addAction('bet', Math.min(flBigBet, playerStack))}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">Bet {formatChipAmount(Math.min(flBigBet, playerStack))}</span></button>
                      )}
                    </div>
                  ) : isPotLimit ? (
                    <>
                      {!showRaiseInput && (
                        <div className="gto-action-row">
                          {!canCheck && <button className="gto-action-btn" onClick={() => addAction('fold')}><span className="gto-action-icon fold">&#x2715;</span><span className="gto-action-label">Fold</span></button>}
                          {canCheck ? <button className="gto-action-btn" onClick={() => addAction('check')}><span className="gto-action-icon check">&#x2713;</span><span className="gto-action-label">Check</span></button>
                            : <button className="gto-action-btn" onClick={() => addAction('call', Math.min(callAmount, playerStack))}><span className="gto-action-icon call">&#x2B24;</span><span className="gto-action-label">Call {formatChipAmount(Math.min(callAmount, playerStack))}</span></button>}
                          {canRaiseHere && <button className="gto-action-btn" onClick={() => { setShowRaiseInput(true); setBetAmount(String(totalOf(betMin))); }}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">{canCheck ? 'Bet' : 'Raise'}</span></button>}
                          {/* With nothing to call, the figure is what goes in, so it is capped at the stack;
                              facing a bet it is the total raised to (entry vs oracle, 7). */}
                          {canRaiseHere && <button className="gto-action-btn" onClick={() => addAction(canCheck ? 'bet' : 'raise', betMax)}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">Pot {formatChipAmount(canCheck ? betMax : Math.min(plRaiseToTotal, playerStack + playerContrib))}</span></button>}
                        </div>
                      )}
                      {showRaiseInput && (
                        <>
                          <div className="gto-sizing-row">
                            {[{label:'Min',mult:0},{label:'1/3',mult:1/3},{label:'1/2',mult:1/2},{label:'2/3',mult:2/3},{label:'Pot',mult:1}].map(s => {
                              let pillAmt;
                              if (canCheck) pillAmt = s.mult === 0 ? betMin : Math.min(roundAmt(plMaxBet * s.mult), playerStack);
                              else { if (s.mult === 0) pillAmt = betMin; else { const raiseSize = roundAmt(plPotAfterCall * s.mult); pillAmt = Math.max(Math.min(chipRound(callAmount + raiseSize), betMax), betMin); } }
                              return <button key={s.label} className="gto-sizing-pill" onClick={() => setBetAmount(String(totalOf(pillAmt)))}><span className="gto-sz-frac">{s.label}</span><span className="gto-sz-to">{formatChipAmount(totalOf(pillAmt))}</span></button>;
                            })}
                          </div>
                          {raiseBox}
                        </>
                      )}
                    </>
                  ) : (
                    /* No Limit */
                    <>
                      {!showRaiseInput && (
                        <div className="gto-action-row">
                          {!canCheck && <button className="gto-action-btn" onClick={() => addAction('fold')}><span className="gto-action-icon fold">&#x2715;</span><span className="gto-action-label">Fold</span></button>}
                          {canCheck ? <button className="gto-action-btn" onClick={() => addAction('check')}><span className="gto-action-icon check">&#x2713;</span><span className="gto-action-label">Check</span></button>
                            : <button className="gto-action-btn" onClick={() => addAction('call', Math.min(callAmount, playerStack))}><span className="gto-action-icon call">&#x2B24;</span><span className="gto-action-label">Call {formatChipAmount(Math.min(callAmount, playerStack))}</span></button>}
                          {canRaiseHere && <button className="gto-action-btn" onClick={() => { setShowRaiseInput(true); setBetAmount(String(totalOf(betMin))); }}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">{canCheck ? 'Bet' : 'Raise'}</span></button>}
                          {canRaiseHere && <button className="gto-action-btn" onClick={() => addAction(canCheck ? 'bet' : 'raise', playerStack)}><span className="gto-action-icon allin">&#x2605;</span><span className="gto-action-label">All-in</span></button>}
                        </div>
                      )}
                      {showRaiseInput && (
                        <>
                          <div className="gto-sizing-row">
                            {[{label:'Min',mult:0},{label:'1/3',mult:1/3},{label:'1/2',mult:1/2},{label:'2/3',mult:2/3},{label:'Pot',mult:1}].map(s => {
                              let pillAmt;
                              if (canCheck) pillAmt = s.mult === 0 ? betMin : Math.min(roundAmt(currentPot * s.mult), playerStack);
                              else { if (s.mult === 0) pillAmt = betMin; else { const potAfterCall = chipRound(currentPot + callAmount); pillAmt = Math.max(Math.min(chipRound(callAmount + roundAmt(potAfterCall * s.mult)), playerStack), betMin); } }
                              return <button key={s.label} className="gto-sizing-pill" onClick={() => setBetAmount(String(totalOf(pillAmt)))}><span className="gto-sz-frac">{s.label}</span><span className="gto-sz-to">{formatChipAmount(totalOf(pillAmt))}</span></button>;
                            })}
                            <button className="gto-sizing-pill" onClick={() => setBetAmount(String(totalOf(playerStack)))}><span className="gto-sz-frac">All-in</span><span className="gto-sz-to">{formatChipAmount(totalOf(playerStack))}</span></button>
                          </div>
                          {raiseBox}
                        </>
                      )}
                    </>
                  )}
                </div></div></div>
              )}
            </div>
          </div>
        );
      })}
      {createPortal(
        <div className="gto-sticky-footer">
          <div className="gto-street-card">
            <div className="gto-btn-row gto-foot-row">
              <button className="gto-undo-btn" disabled={!canUndo} onClick={undoLastAction}>Undo</button>
              {/* Back to the seat setup to fix names / stacks / positions without
                  losing the hand — everything entered so far is kept in state. */}
              <button className="btn btn-ghost btn-sm" onClick={() => setPhase('setup')}>Back to Setup</button>
              <div style={{flex:1}} />
              {/* Held on a finished street by the step strip: on to the next as its betting would have gone. */}
              {advanceHeld && isBettingComplete
                ? <button className="btn btn-primary btn-sm" onClick={() => setAdvanceHeld(false)}>Continue</button>
                : <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel Hand</button>}
            </div>
          </div>
        </div>,
        // Desktop: into the shell (still position:fixed — the shell has no transform), so the
        // footer reads the shell's --dk-* counts and spans the main pane on its g lines
        // (styles.css, .app-shell.is-desktop .gto-sticky-footer). Phone: <body>, as before.
        document.querySelector('.app-shell.is-desktop') || document.body
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ── Replay Error Boundary ────────────────────────────────
// ══════════════════════════════════════════════════════════
class ReplayErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(err) { return { error: err }; }
  componentDidCatch(err, info) { console.error('[ReplayErrorBoundary]', err, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:'var(--space-3xl)',color:'var(--text-muted)',textAlign:'center'}}>
          <div style={{fontSize:'calc(var(--gu) * 1.252)',marginBottom:'var(--space-md)',color:'var(--danger,#f87171)'}}>Error loading replay</div>
          <div style={{fontSize:'calc(var(--gu) * 1.031)',fontFamily:'monospace',wordBreak:'break-all',maxWidth:'calc(var(--subrow) * 50)',margin:'0 auto var(--space-lg)',opacity:0.7}}>
            {this.state.error.message}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { this.setState({ error: null }); this.props.onBack(); }}>
            ← Back to list
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── An unfinished hand, kept on the device ───────────────
// Everything typed into the entry screens lives in React state, so Cancel, a reload or the
// browser's Back used to throw the hand away. One draft is kept in localStorage while a hand is
// being entered, and the list offers it back as "Unfinished hand".
const DRAFT_KEY = 'replayerDraft';
const ENTRY_PHASES = ['setup', 'ofc_entry', 'hero_cards', 'door_cards', 'action', 'board_door', 'board_entry', 'super_throw', 'stud_deal', 'draw_discard', 'draw_cards_entry', 'showdown', 'result'];
function readEntryDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return d && d.hand && Array.isArray(d.hand.players) && Array.isArray(d.hand.streets) ? d : null;
  } catch { return null; }
}
// Whether a hand holds anything that took effort to enter: a card, an action, a draw, a result.
function handHasEntries(h) {
  if (!h) return false;
  const filled = (v) => Array.isArray(v) ? v.some(filled) : (v && typeof v === 'object') ? Object.values(v).some(filled) : !!v;
  return (h.streets || []).some(s => (s.actions || []).length > 0 || (s.draws || []).length > 0 || filled(s.cards))
    || filled(h.ofcRows) || !!(h.result && (h.result.winners || []).length);
}
// Where the entry screens open: a phase the entry knows and a street the hand has.
function entryPlace(at, hand) {
  const phase = at && ENTRY_PHASES.includes(at.phase) ? at.phase : 'setup';
  const n = ((hand && hand.streets) || []).length;
  const streetIdx = at && Number.isInteger(at.streetIdx) && at.streetIdx >= 0 && at.streetIdx < n ? at.streetIdx : 0;
  return { phase, streetIdx };
}
// Edit opens a finished hand on its last screen, the result, with every street one Back away;
// it used to open Setup, whose Next skipped the first betting round.
function editPlace(hand) {
  if (!hand || !(hand.result && (hand.result.winners || []).length)) return null;
  if (hand.gameType === 'OFC') return null;
  const streets = hand.streets || [];
  let last = 0;
  streets.forEach((s, i) => { if ((s.actions || []).length || (s.draws || []).length) last = i; });
  return { phase: 'result', streetIdx: last };
}
// A custom game's rules travel with its hand (customConfig). A hand opened in a session that never
// made that game registers them before anything reads HAND_CONFIG.
function registerCustomGame(handData) {
  if (!handData || !handData.gameType || HAND_CONFIG[handData.gameType]) return;
  const streets = handData.streets || [];
  const cc = handData.customConfig;
  const hasBoard = cc ? !!cc.hasBoard : streets.some(s => s.cards?.board);
  const names = (cc && cc.streetNames) || streets.map(s => s.name);
  HAND_CONFIG[handData.gameType] = { heroCards: (cc && cc.heroCards) || 2, hasBoard, boardMax: hasBoard ? 5 : 0, isStud: !!(cc && cc.isStud), heroPlaceholder: '' };
  STREET_DEFS['custom_' + handData.gameType] = {
    streets: names,
    boardCards: names.map((_, i) => !hasBoard ? 0 : i === 0 ? 0 : i === 1 ? 3 : 1),
  };
}
function agoLabel(ms) {
  const mins = Math.max(0, Math.round((Date.now() - (Number(ms) || 0)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
  const days = Math.round(hrs / 24);
  return days + (days === 1 ? ' day ago' : ' days ago');
}

// ══════════════════════════════════════════════════════════
// ── Main Hand Replayer View ──────────────────────────────
// ══════════════════════════════════════════════════════════
/* sidePane (desktop, UX pick 68): the element of the shell's second pane. Given one, the list stays in
   the main pane and the replay of the chosen hand opens beside it (portalled there), with a prompt in
   its place while none is open; onSplitChange says whether the split is showing (entry, quick add and
   the drill still take the main pane alone). */
export default function HandReplayerView({ token, heroName, cardSplay, initialHand, onClearInitialHand, onSolveSpot, onStudyDraw, linkedReplay, quickAdd, drillEnabled, drillAsk, onDrillAsked = false, newHandAsk = 0, onNewHandAsked = null, schedule = null, updates = null, sidePane = null, onSplitChange = null, onDrillBack = null, active = true,
  sharedQuestion = null, onSharedQuestionAnswered = null }) {
  const toast = useToast();
  const [mode, setMode] = useState(initialHand ? 'replay' : 'list');
  // Back from a hand puts the list where it was and marks the hand for a moment (App improvements 166).
  const listPlace = useRef(null);
  useLayoutEffect(() => {
    if (mode !== 'list' || !listPlace.current) return;
    const { sc, top, id } = listPlace.current;
    listPlace.current = null;
    if (sc && sc.isConnected) sc.scrollTop = top;
    const row = document.querySelector('[data-hand-id="' + id + '"]');
    if (row) { row.classList.add('is-returned'); setTimeout(() => row.classList.remove('is-returned'), 1200); }
  }, [mode]);
  // Hands > Study > Play a hand.
  useEffect(() => { if (drillAsk) { setMode('drill'); if (onDrillAsked) onDrillAsked(); } }, [drillAsk, onDrillAsked]);
  /* The +'s New hand (owner, 2026-11-27, the + on every tab): back to the saved list, its New Hand picker in view at
     the top. A hand being entered stays as the draft the list offers to resume. */
  useEffect(() => {
    if (!newHandAsk) return;
    setMode('list');
    if (onNewHandAsked) onNewHandAsked();
    // The list's own scroller back to its top, where the picker is (scrollIntoView scrolled the app shell itself,
    // taking the top bar off the screen).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      let el = document.querySelector('.tab-panel[data-tab="hands"] .replayer-list-new');
      for (el = el && el.parentElement; el && el !== document.body; el = el.parentElement) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) { el.scrollTop = 0; break; }
      }
    }));
  }, [newHandAsk, onNewHandAsked]);
  const [quickVoice, setQuickVoice] = useState(false);   // quick add opened by Say (listening at once)
  const [quickSeed, setQuickSeed] = useState(null);      // a hand said on the Watch, finished in quick add
  const [hands, setHands] = useState([]);
  // Every name in the saved hands, for the entry's name fields (utils/player-names.js).
  const savedNames = useMemo(() => nameBook(hands), [hands]);
  const [games, setGames] = useState([]);
  const [currentHand, setCurrentHand] = useState(initialHand ? canonicalHand(initialHand) : null);
  const [currentHandId, setCurrentHandId] = useState(null);
  // A hand that arrived by a shared link (initialHand) is someone else's: the hand-history export
  // is for hands the user saved or entered, since it writes the hero as the user and files it
  // under the user's name. Cleared wherever the hand becomes the user's own.
  const [handIsShared, setHandIsShared] = useState(!!initialHand);
  const [showHhExport, setShowHhExport] = useState(false);
  const [selectedGameType, setSelectedGameType] = useState('NLH');
  // Short Deck's disputed rule (owner, 2026-10-15): asked when the game is chosen, kept per device
  // as the next default, and stored on each new hand (hand.tripsBeatStraight).
  const [sdTrips, setSdTrips] = useState(() => { try { const v = localStorage.getItem('shortDeckTripsBeatStraight'); return v === '1' ? true : v === '0' ? false : null; } catch { return null; } });
  const [sdAsk, setSdAsk] = useState(false);
  // The question is asked as a Short Deck hand is made, and its answer makes the hand: it used to
  // open when the game was picked and drop the user back at the list, where dismissing it and
  // pressing Create recorded "a straight beats trips" unasked.
  const sdAnswered = useRef(false);
  const chooseSdRule = (v) => {
    setSdTrips(v);
    try { localStorage.setItem('shortDeckTripsBeatStraight', v ? '1' : '0'); } catch { /* private mode */ }
    setSdAsk(false);
    sdAnswered.current = true;
    setPendingCreate(true);
  };
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(true);
  // The unfinished hand (DRAFT_KEY above). `entryAt` is where the entry screens are, as they
  // report it; `entryResume` is where they open; `entryStart` is the hand object they opened
  // with, so a saved hand opened by Edit and left alone is not a draft (null: it already is one).
  const [draft, setDraft] = useState(readEntryDraft);
  const [entryAt, setEntryAt] = useState(null);
  const [entryResume, setEntryResume] = useState(null);
  const [entryJump, setEntryJump] = useState(null);     // { phase, n }: the header's Edit (UX pick 57)
  const entryStart = useRef(null);
  const draftHand = useRef(null);     // the hand object last written as the draft
  const clearDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
    draftHand.current = null;
    setDraft(null);
  };
  const writeDraft = (hand, at) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ hand, handId: currentHandId, title, notes, isPublic, at, savedAt: Date.now() }));
      draftHand.current = hand;
    } catch { /* private mode, or the store is full: the hand is still on screen */ }
  };
  const openEntry = (hand, at = null, { fromDraft = false } = {}) => {
    entryStart.current = fromDraft ? null : hand;
    setCurrentHand(hand);
    setEntryResume(at);
    setEntryAt(at);
    setMode('entry');
  };
  // One draft is kept, so starting another entry over it asks first.
  const draftInTheWay = () => {
    if (!readEntryDraft()) return false;
    if (window.confirm('You have an unfinished hand. Starting another one discards it.')) { clearDraft(); return false; }
    return true;
  };
  useEffect(() => {
    if (mode !== 'entry' || !currentHand) return;
    const dirty = currentHand !== entryStart.current || (!currentHandId && handHasEntries(currentHand));
    if (dirty) writeDraft(currentHand, entryAt);
  }, [mode, currentHand, currentHandId, title, notes, isPublic, entryAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === 'list') setDraft(readEntryDraft()); }, [mode]);
  // Cancel, from Setup or mid-hand: ask before anything entered is thrown away.
  const cancelEntry = () => {
    const lose = currentHandId ? currentHand !== entryStart.current : handHasEntries(currentHand);
    if (lose && !window.confirm(currentHandId ? 'Discard your changes to this hand?' : 'Discard this hand? Everything entered so far will be lost.')) return;
    clearDraft();
    setMode('list');
  };
  const [bettingStructure, setBettingStructure] = useState('No Limit');
  const [selectedGame, setSelectedGame] = useState("Hold'em");
  const [selectedCategory, setSelectedCategory] = useState("Hold'em");
  const [gameHistory, setGameHistory] = useState(() => {
    /* A favourite chosen before the rename says "Big Easy"; the picker's row is now PLO6 8/b. */
    try {
      const s = localStorage.getItem('replayer_game_history');
      return s ? JSON.parse(s).map(f => (f && typeof f.game === 'string' ? { ...f, game: canonicalGameType(f.game) } : f)) : [];
    }
    catch { return []; }
  });

  // Game selection config: the shared maps (utils/variant-catalog.js), so the picker's rows and
  // the entry's game types are one table.
  const structureGameMap = STRUCTURE_GAME_MAP;
  const defaultStructure = DEFAULT_STRUCTURE;

  /* The game's name on the Create button: the catalog's own (variantName: "O8", "Razz", "PLO6 8/b"). Super is the
     hand's own switch, in its setup, like Double board. */
  const variantDisplayName = variantName(selectedGame, bettingStructure);

  const recordGameUse = (game, structure, mix = null) => {
    setGameHistory(prev => {
      const next = [{ game, structure, ...(mix ? { mix } : {}) }, ...prev].slice(0, 20);
      try { localStorage.setItem('replayer_game_history', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const handleGameSelect = (game) => {
    setSelectedGame(game);
    if (defaultStructure[game]) setBettingStructure(defaultStructure[game]);
    const map = structureGameMap[defaultStructure[game] || 'No Limit'];
    if (map && map[game]) setSelectedGameType(map[game]);
    // Sync category tab
    const cat =
      ["Hold'em", 'Pineapple', 'Short Deck'].includes(game) ? "Hold'em" :
      ['Omaha', 'Omaha 8/b', 'Big O', 'PLO6 8/b', 'PLO5', 'PLO6', 'Double Board Bomb Pot', 'Courchevel'].includes(game) ? 'Omaha' :
      ['Stud Hi', 'Stud 8/b', 'Razz', 'Action Razz', 'Stud Hi/Lo Regular', '2-7 Razz', 'Razzdugi', 'Razzdeucy'].includes(game) ? 'Stud' :
      ['2-7 Triple Draw', '2-7 Single Draw', 'A-5 Triple Draw', 'A-5 Single Draw',
       'Badugi', 'Badeucy', 'Badacey', 'Archie 66', 'Archie 99', 'Ari', '5-Card Draw'].includes(game) ? 'Draw' :
      'Other';
    setSelectedCategory(cat);
  };

  // ── The variant picker (VariantPicker.jsx, utils/variant-catalog.js) ──
  // The mix a hand was dealt in (HORSE, 8-Game...), saved with it as hand.mix; null for a single game.
  const [selectedMix, setSelectedMix] = useState(null);
  // Double board (owner, 2026-10-20): a flop game dealt two boards. The Bomb Pot row turns it on;
  // any hold'em or Omaha game can have it from the toggle under the launcher.
  const [doubleBoard, setDoubleBoard] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useBackToClose(paletteOpen, () => setPaletteOpen(false));   // App improvements 454
  const [pendingCreate, setPendingCreate] = useState(false);
  const catalog = useMemo(() => buildCatalog(games.map(g => g.name || g.game_name).filter(Boolean)), [games]);
  const mixes = useMemo(() => buildMixes(catalog), [catalog]);
  const guess = useMemo(() => bestGuess({ rows: catalog, schedule: schedule || [], updates: updates || [], today: getToday() }),
    [catalog, schedule, updates]);
  const currentRow = useMemo(() => {
    const r = catalog.find(x => x.game === selectedGame && x.structure === bettingStructure)
      || catalog.find(x => x.game === selectedGame);
    return r ? { ...r, mix: selectedMix } : null;
  }, [catalog, selectedGame, bettingStructure, selectedMix]);
  // A row from the palette or the guess: the game, its structure (its own row's), and the mix. From
  // the palette it also makes the hand, once the state above has caught up (pendingCreate).
  const pickVariant = (row, { mix = null, create = false } = {}) => {
    handleGameSelect(row.game);
    if (!row.custom && STRUCTURE_GAME_MAP[row.structure]?.[row.game]) {
      setBettingStructure(row.structure);
      setSelectedGameType(STRUCTURE_GAME_MAP[row.structure][row.game]);
    }
    setSelectedMix(mix);
    if (row.game === 'Double Board Bomb Pot') setDoubleBoard(true);
    else if (!['holdem', 'omaha'].includes(row.family)) setDoubleBoard(false);
    setPaletteOpen(false);
    // Short Deck asks its rule first (startNewHand opens ShortDeckRuleDialog); the answer makes it.
    if (create) setPendingCreate(true);
  };
  // The guess is the starting pick, once per visit to the list (never over a choice made since).
  const guessApplied = useRef(false);
  useEffect(() => {
    if (guessApplied.current || !guess || mode !== 'list') return;
    guessApplied.current = true;
    pickVariant(guess.row, { mix: guess.mix });
  }, [guess, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // ⌘K / Ctrl+K or "/" opens the palette on the list (desktop keyboards).
  useEffect(() => {
    // Only while Hands is the tab on show (App improvements 455: the panel stays mounted, so "/" and ⌘K opened
    // the Hands game picker over the Schedule and started a hand on the hidden tab).
    if (mode !== 'list' || !active) return undefined;
    const onKey = (e) => {
      const typing = e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (!typing && e.key === '/')) { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, active]);

  // Fetch saved hands
  // A failed list read is told from an empty list (App improvements 157): "No saved hands yet" to an account
  // with 36 hands was the most alarming wrong answer the screen could give.
  const [handsLoadError, setHandsLoadError] = useState(false);
  const fetchHands = useCallback(async () => {
    if (!token) return;
    try {
      const [handsRes, gamesRes] = await Promise.all([
        fetch(`${API_URL}/replayer/hands`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/replayer/games`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      // Hands saved before 2026-10-14 call six-card PLO hi-lo "Big Easy"; the list says PLO6 8/b.
      if (handsRes.ok) { const rows = await handsRes.json(); setHands(Array.isArray(rows) ? rows.map(canonicalHand) : rows); setHandsLoadError(false); setOfflineCopy(false); keepListCopy(rows); }
      else setHandsLoadError(true);
      if (gamesRes.ok) setGames(await gamesRes.json());
    } catch (e) {
      // No signal (Features 46): the copy kept on this device, under a banner saying so.
      const copy = listCopy();
      if (copy && Array.isArray(copy.rows) && copy.rows.length) { setHands(copy.rows.map(canonicalHand)); setOfflineCopy(true); setHandsLoadError(false); }
      else { console.error('Replayer fetch error:', e); setHandsLoadError(true); }
    }
    finally { setLoading(false); }
  }, [token]);
  const [offlineCopy, setOfflineCopy] = useState(false);
  const [waiting, setWaiting] = useState(() => readOutbox());
  // The outbox uploads by itself when requests succeed again: at load, when the device says it is online,
  // and every minute while anything waits.
  useEffect(() => {
    if (!token) return undefined;
    let on = true;
    const flush = async () => {
      if (!readOutbox().length) return;
      const r = await flushOutbox(API_URL, token);
      if (!on) return;
      setWaiting(readOutbox());
      if (r.sent) { toast.success(`${r.sent} hand${r.sent === 1 ? '' : 's'} uploaded`); fetchHands(); }
    };
    flush();
    window.addEventListener('online', flush);
    const id = setInterval(flush, 60000);
    return () => { on = false; window.removeEventListener('online', flush); clearInterval(id); };
  }, [token, fetchHands]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tags (Features 31): every tag the saved hands carry, and the one the list is filtered by.
  const allHandTags = useMemo(() => [...new Set((hands || []).flatMap((h) => (Array.isArray(h.tags) ? h.tags : [])))].sort(), [hands]);
  const [tagFilter, setTagFilter] = useState(null);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => { if (token) fetchHands(); }, [token, fetchHands]);

  // Handle initialHand prop changes
  useEffect(() => {
    if (initialHand) {
      setCurrentHand(canonicalHand(initialHand));
      /* Not the hand that was open: a link opened over one of the account's own hands kept that hand's id, so
         the replay (keyed by the id) stayed mounted with its Share sheet still open over the new hand, the list
         kept the old row selected, and an Edit then Save would have PUT the shared hand over the saved one. */
      setCurrentHandId(null);
      setIsPublic(false);
      setMode('replay');
      setHandIsShared(true);
      // A link carries the sharer's title (the shorthand's 't' part, 2026-11-22).
      setTitle(initialHand.title || '');
      setNotes('');
      if (onClearInitialHand) onClearInitialHand();
    }
  }, [initialHand]);

  const loadHand = async (handId) => {
    try {
      const res = await fetch(`${API_URL}/replayer/hands/${handId}`, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!res.ok) {
        console.error('Failed to load hand:', res.status, res.statusText);
        toast.error(res.status === 404 ? "That hand is no longer saved." : "Couldn't open this hand.",
          res.status === 404 ? undefined : { action: { label: 'Try again', onClick: () => loadHand(handId) } });
        if (res.status === 404) fetchHands();
        return;
      }
      {
        const data = await res.json();
        let handData = typeof data.hand_data === 'string' ? JSON.parse(data.hand_data) : data.hand_data;
        // Backwards-compat: old saves wrapped the entire POST body as hand_data,
        // so the actual hand object lives under handData.handData
        if (handData && handData.handData && !handData.streets) handData = handData.handData;
        // A hand saved as "Big Easy" opens as PLO6 8/b (the same game, renamed 2026-10-14).
        handData = canonicalHand(handData);
        // Normalize missing fields so the replay view never crashes on old/incomplete records
        if (!handData.streets) handData.streets = [];
        if (!handData.players) handData.players = [];
        registerCustomGame(handData);
        setCurrentHand(handData);
        setCurrentHandId(data.id);
        setHandIsShared(false);
        setTitle(isBuiltTitle(data.title) ? '' : (data.title || ''));
        setNotes(data.notes || '');
        setIsPublic(!!data.is_public);
        setMode('replay');
      }
    } catch (e) {
      console.error('Failed to load hand:', e);
      toast.error("Couldn't open this hand.", { action: { label: 'Try again', onClick: () => loadHand(handId) } });
    }
  };

  // `over` lets a caller that has just set title/notes/id pass them directly — state set in the
  // same tick is not visible to this closure yet (quick add saves straight after setNotes).
  const saveHand = async (hand, over = {}) => {
    if (!token) return;
    const handId = 'id' in over ? over.id : currentHandId;
    const saveNotes = 'notes' in over ? over.notes : notes;
    // A rename from the replay's title (owner, 2026-11-22: "we should be able to edit the hand titles") saves it at once.
    const saveTitle = 'title' in over ? over.title : title;
    setLoading(true);
    try {
      const payload = { handData: hand, gameType: hand.gameType, title: saveTitle || autoTitle(hand) || (hand.gameType + ' Hand'), notes: saveNotes, isPublic };
      let res;
      if (handId) {
        res = await fetch(`${API_URL}/replayer/hands/${handId}`, {
          method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`${API_URL}/replayer/hands`, {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) { const data = await res.json(); setCurrentHandId(data.id); }
      }
      // A guest can build and replay a hand, but only an account keeps one (requireRegistered).
      // A hand from the entry screens stays on the device as the unfinished hand (over.draft).
      if (res.status === 403) {
        toast.info(over.draft ? 'Register to keep your hands. Until then this one is kept on this device only.'
          : 'Register to keep your hands. This one replays until you leave.');
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      fetchHands();
      if (over.draft) clearDraft();
      toast.success('Hand saved');
    } catch (e) {
      if (e instanceof TypeError || !navigator.onLine) {
        // No signal: kept on this device, uploaded when requests succeed again (Features 46).
        const payload = { handData: hand, gameType: hand.gameType, title: saveTitle || autoTitle(hand) || (hand.gameType + ' Hand'), notes: saveNotes, isPublic };
        addToOutbox(payload, handId || null);
        setWaiting(readOutbox());
        if (over.draft) clearDraft();
        toast.info('No signal. The hand is kept on this phone and uploads when the signal is back.');
      } else {
        console.error('Failed to save hand:', e);
        toast.error("Couldn't save the hand: " + (e.message || 'network error') + '.'
          + (over.draft ? ' It is kept on this device: Hands, Unfinished hand.' : ''));
      }
    }
    setLoading(false);
  };

  // Delete asks first, naming the hand, and says what happened: it used to delete on one tap,
  // unchecked and in silence.
  /* Delete with Undo (UX pick 55): no question first; the row leaves at once and the toast's Undo
     brings it back. The DELETE goes when the Undo has had its 5 s, or at once if the screen goes. */
  const [goneIds, setGoneIds] = useState(() => new Set());
  const pendingDeletes = useRef(new Map());
  const unhide = (id) => setGoneIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  const sendDelete = async (h) => {
    pendingDeletes.current.delete(h.id);
    try {
      const res = await fetch(`${API_URL}/replayer/hands/${h.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
      const d = readEntryDraft();
      if (d && d.handId === h.id) clearDraft();     // unsaved changes to a hand that is gone
      fetchHands();
    } catch (e) {
      console.error('Failed to delete hand:', e);
      unhide(h.id);
      toast.error("Couldn't delete the hand: " + (e.message || 'network error'));
    }
  };
  const deleteHand = (h) => {
    if (!token || pendingDeletes.current.has(h.id)) return;
    setGoneIds(prev => new Set(prev).add(h.id));
    const timer = setTimeout(() => sendDelete(h), 5000);
    pendingDeletes.current.set(h.id, { timer, h });
    toast.success('Deleted \u201c' + displayTitle(h) + '\u201d', { duration: 5000, action: { label: 'Undo', onClick: () => {
      const p = pendingDeletes.current.get(h.id);
      if (p) { clearTimeout(p.timer); pendingDeletes.current.delete(h.id); }
      unhide(h.id);
    } } });
  };
  useEffect(() => () => {
    pendingDeletes.current.forEach(p => { clearTimeout(p.timer); sendDelete(p.h); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* The hero's net per row (UX pick 55), worked out once per saved version of the hand. Off with
     the replayer's Show Results setting. */
  const netCache = useRef(new Map());
  const netOf = (h) => {
    const k = h.id + ':' + (h.created_at || '') + ':' + (h.updated_at || '');
    if (!netCache.current.has(k)) netCache.current.set(k, heroNet(h));
    return netCache.current.get(k);
  };
  const showListResults = (() => { try { return localStorage.getItem('replayerShowResults') !== 'false'; } catch (_) { return true; } })();
  /* A tap on a row (UX pick 61): the pressed state paints first, then the replay mounts from the row
     itself, which carries the whole hand; the GET refreshes the share flag behind it. */
  const [openingId, setOpeningId] = useState(null);
  /* The sample (UX pick 70): a bundled 6-max hand, opened as a shared hand is (nothing to export as
     yours), with the viewer in the hero's seat. */
  const openSample = () => {
    const hd = canonicalHand(JSON.parse(JSON.stringify(SAMPLE_HAND)));
    const hi = hd.heroIdx != null ? hd.heroIdx : 0;
    if (hd.players[hi]) hd.players[hi] = { ...hd.players[hi], name: heroName || 'You' };
    setCurrentHand(hd);
    setCurrentHandId(null);
    setHandIsShared(true);
    setTitle('Sample hand');
    setNotes('');
    setIsPublic(false);
    setMode('replay');
  };
  const openRow = (h) => {
    if (openingId != null) return;
    // Where the list was, to come back to it (App improvements 166: Back went to the top of a 243-hand list).
    const row = document.querySelector('[data-hand-id="' + h.id + '"]');
    const sc = row && row.closest('.content-area, .dk-scroll');
    listPlace.current = sc ? { sc, top: sc.scrollTop, id: h.id } : null;
    setOpeningId(h.id);
    const go = () => {
      let hd = h.handData && !h.streets ? h.handData : h;
      if (!hd || !Array.isArray(hd.streets) || !Array.isArray(hd.players)) { setOpeningId(null); loadHand(h.id); return; }
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = hd;
      const handData = canonicalHand(rest);
      registerCustomGame(handData);
      setCurrentHand(handData);
      setCurrentHandId(h.id);
      setHandIsShared(false);
      setTitle(isBuiltTitle(h.title) ? '' : (h.title || ''));
      setNotes(h.notes || '');
      setIsPublic(false);
      setOpeningId(null);
      setMode('replay');
      fetch(`${API_URL}/replayer/hands/${h.id}`, { headers: { Authorization: 'Bearer ' + token } })
        .then(r => (r.ok ? r.json() : null)).then(d => { if (d) setIsPublic(!!d.is_public); }).catch(() => {});
    };
    requestAnimationFrame(() => setTimeout(go, 0));
  };

  const handleEntryDone = (hand) => {
    setCurrentHand(hand);
    setHandIsShared(false);
    writeDraft(hand, entryAt);          // on the device until the save has landed
    saveHand(hand, { draft: true });
    setMode('replay');
  };

  // Edit: a finished hand opens on its result. A hand whose save failed is itself the draft.
  const editCurrentHand = () => {
    if (!currentHand) return;
    if (currentHand === draftHand.current) { openEntry(currentHand, editPlace(currentHand), { fromDraft: true }); return; }
    if (draftInTheWay()) return;
    openEntry(currentHand, editPlace(currentHand));
  };
  const resumeDraft = () => {
    const d = readEntryDraft();
    if (!d) { setDraft(null); return; }
    const hand = canonicalHand(d.hand);
    registerCustomGame(hand);
    setCurrentHandId(d.handId || null);
    setHandIsShared(false);
    setTitle(d.title || ''); setNotes(d.notes || ''); setIsPublic(!!d.isPublic);
    openEntry(hand, d.at || null, { fromDraft: true });
  };
  const discardDraft = () => {
    if (window.confirm('Discard the unfinished hand? This cannot be undone.')) clearDraft();
  };

  const startNewHand = () => {
    // Short Deck asks which rule the game plays before the hand exists; its answer comes back here.
    if (selectedGame === 'Short Deck' && !sdAnswered.current) { setSdAsk(true); return; }
    sdAnswered.current = false;
    if (draftInTheWay()) return;
    const hand = createEmptyHand(selectedGameType, heroName);
    if (hand.gameType === 'Short Deck') hand.tripsBeatStraight = sdTrips === true;
    if (selectedMix) hand.mix = selectedMix;
    // Double board: a second board on every street (utils/poker-engine.js handBoards).
    if (doubleBoard && currentRow && ['holdem', 'omaha'].includes(currentRow.family) && !(HAND_CONFIG[selectedGameType] || {}).doorBoard) {
      hand.doubleBoard = true;
      hand.streets = hand.streets.map(s => ({ ...s, cards: { ...s.cards, board2: '' } }));
    }
    recordGameUse(selectedGame, bettingStructure, selectedMix);
    setCurrentHandId(null);
    setHandIsShared(false);
    setTitle('');
    setNotes('');
    setIsPublic(false);
    openEntry(hand);
  };
  // A palette pick makes the hand once its game, structure and mix are in state (pickVariant).
  useEffect(() => {
    if (!pendingCreate) return;
    setPendingCreate(false);
    startNewHand();
  }, [pendingCreate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The desktop split (UX pick 68) ──
  const split = !!sidePane && (mode === 'list' || (mode === 'replay' && !!currentHand));
  useEffect(() => { if (onSplitChange) onSplitChange(split); }, [split, onSplitChange]);
  /* ↑ and ↓ open the hand above or below the one on show (← and → stay with the transport). Only while
     the Hands tab is the one on screen: its pane host is hidden on every other tab. */
  useEffect(() => {
    if (!split) return undefined;
    const onKey = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (!sidePane.isConnected || sidePane.offsetParent === null) return;
      if (document.querySelector('.share-menu-panel, .vp-scrim, .replayer-settings-panel')) return;
      const rows = hands.filter(h => !goneIds.has(h.id));
      if (!rows.length) return;
      const at = mode === 'replay' ? rows.findIndex(h => h.id === currentHandId) : -1;
      const next = e.key === 'ArrowDown' ? (at < 0 ? 0 : at + 1) : (at < 0 ? rows.length - 1 : at - 1);
      if (next < 0 || next >= rows.length) return;
      e.preventDefault();
      openRow(rows[next]);
      requestAnimationFrame(() => {
        const el = document.querySelector('[data-hand-id="' + rows[next].id + '"]');
        if (el) el.scrollIntoView({ block: 'nearest' });
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [split, sidePane, hands, goneIds, mode, currentHandId, openingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Replay mode ──
  const replayEl = mode === 'replay' && currentHand ? (
      <div className={'replayer-view is-replay' + (sidePane ? ' is-in-pane' : '')}>
        <div className="replayer-header">
          <h2><TitleEditor shown={title || autoTitle(currentHand) || currentHand.gameType + ' Hand'} typed={title}
            canEdit={!!(token && currentHandId && !handIsShared && !linkedReplay)}
            onSave={(t) => { setTitle(t); saveHand(currentHand, { title: t }); }} /></h2>
          <span className="replayer-hand-card-game">{superName(currentHand, currentHand.gameType) + (currentHand.blinds && currentHand.blinds.bb ? ' ' + formatStakes(currentHand) : '')}</span>
        </div>
        {/* 76: .replayer-notes-area — label, textarea, focus ring, all
            tokenised — had zero JSX consumers, so notes were write-only from
            the API's point of view and read back through an inline 0.7rem
            div. The isPublic flag was in the save payload with no control
            anywhere that could set it. */}
        {/* Saved notes open from a chip on the felt (App improvements 152): in the page flow they sat behind
            the fixed replay layer and could never be read. Only a hand with notes shows it. */}

        <ReplayErrorBoundary onBack={() => { setMode('list'); fetchHands(); }}>
          {/* One replay per saved hand (owner, 2026-11-22: "sometimes when changing from one saved hand to another there
              is an animation of a bunch of cards going to the center of the felt as the button moves and the blinds come
              out"): the desktop pane kept the replay mounted across hands, so the next hand opened on the step the last
              was on and its moments played the change from one hand to the other. Keyed by the hand, it opens fresh, at
              its start, as a hand opened from the list does; a save of notes or tags keeps the id and the place. */}
          <HandReplayerReplayView
            key={currentHandId != null ? 'h' + currentHandId : 'unsaved'}
            hand={currentHand}
            handTitle={title || autoTitle(currentHand) || ''}
            notes={notes}
            token={token}
            heroName={heroName}
            playedAt={(() => { const row = currentHandId != null && hands.find(h => h.id === currentHandId); return row ? playedAtOf(row) : null; })()}
            onEdit={editCurrentHand}
            onBack={() => { setMode('list'); fetchHands(); }}
            cardSplay={cardSplay}
            onSolveSpot={onSolveSpot}
            onStudyDraw={onStudyDraw}
            linkedReplay={linkedReplay}
            sharedHand={handIsShared}
            inPane={!!sidePane}
            onSaveExtras={currentHandId && !handIsShared ? (patch) => { const merged = { ...currentHand, ...patch }; setCurrentHand(merged); saveHand(merged); } : null}
            allTags={allHandTags}
            question={handIsShared ? sharedQuestion : null}
            onQuestionAnswered={onSharedQuestionAnswered}
          />
        </ReplayErrorBoundary>
      </div>
  ) : null;
  if (replayEl && !sidePane) return replayEl;

  // ── Entry mode ──
  if (mode === 'entry' && currentHand) {
    /* What the header carries depends on the screen: the game's name on every one (a hand could be
       typed in start to finish without the screen saying what game it was), Format on Setup alone,
       and Title and Share on Setup and on Result, where a hand gets named. On the screens between,
       those three rows held more than a quarter of a phone. */
    const entryPhase = (entryAt && entryAt.phase) || 'setup';
    const onSetup = entryPhase === 'setup';
    const onEnds = onSetup || entryPhase === 'result';
    const gameLine = [superName(currentHand, currentHand.gameType), currentHand.doubleBoard ? 'Double board' : '', currentHand.mix || '']
      .filter(Boolean).join(' · ');
    const isCash = (currentHand.gameMode || 'mtt') === 'cash';
    /* The step track (UX pick 57, Goal-Gradient): Setup, each street, Result; done cells quiet, the
       current one filled. Up to 30 screens, and nothing said how far through the hand you were. */
    const shortStreet = (nm) => String(nm || '').replace(/^Preflop$/, 'Pre').replace(/^Pre-Draw$/, 'Pre').replace(/ Street$/, '')
      .replace(/^First Draw$/, 'D1').replace(/^Second Draw$/, 'D2').replace(/^Third Draw$/, 'D3').replace(/^Draw$/, 'Draw');
    const steps = ['Setup', ...(currentHand.streets || []).map(st => shortStreet(st.name)), 'Result'];
    const stepNow = entryPhase === 'setup' ? 0 : entryPhase === 'result' ? steps.length - 1
      : Math.min(steps.length - 2, ((entryAt && entryAt.streetIdx) || 0) + 1);
    const blinds = currentHand.blinds || {};
    // One style for every part, as the felt's pill (formatStakes): K and M for all once one reaches 100,000.
    const fmtS = [blinds.sb, blinds.bb, blinds.bigBet, blinds.ante].some((v) => Number(v) >= 100000) ? compactChips : formatChipAmount;
    const stakes = blinds.bb ? (HAND_CONFIG[currentHand.gameType]?.betting === 'fl'
      ? fmtS(blinds.bb) + '/' + fmtS(blinds.bigBet || blinds.bb * 2)
      : fmtS(blinds.sb) + '/' + fmtS(blinds.bb)) + (blinds.ante ? ' (' + fmtS(blinds.ante) + ')' : '') : '';
    const summary = [gameLine, (currentHand.players || []).length + ' players', stakes, isCash ? 'Cash' : 'MTT'].filter(Boolean).join(' \u00b7 ');
    return (
      <div className="replayer-view replayer-entry-view">
        <div className="gto-sticky-header">
          {/* Off setup, the setup fields are one line (UX pick 57): game, players, stakes and format,
              so they stay in view without being remembered, with Edit back to them. */}
          {onSetup
            ? <div className="entry-game-name">{gameLine}</div>
            : <div className="entry-summary">
                <span className="entry-summary-text">{summary}</span>
                <button type="button" className="btn btn-ghost btn-sm ctl entry-summary-edit"
                  onClick={() => setEntryJump({ phase: 'setup', n: Date.now() })}>Edit</button>
              </div>}
          {/* Each step the hand has reached is a button to it (owner, 2026-11-22: "Would be nice if these were buttons
              that took the user directly to that street to edit"): Setup, a street's betting (one with an action or a
              card entered, or the first), and Result once the hand has one. Not the step on screen. */}
          <ol className="entry-steps" aria-label="Steps" style={{ '--steps': steps.length }}>
            {steps.map((st, i) => {
              const streets = currentHand.streets || [];
              const si = i - 1;
              const filled = (s) => !!s && ((s.actions || []).length > 0 || !!(s.cards && (s.cards.hero || s.cards.board || (s.cards.opponents || []).some(Boolean))));
              const reached = i === 0 ? true
                : i === steps.length - 1 ? !!(currentHand.result && (currentHand.result.winners || []).length)
                : si === 0 || filled(streets[si]);
              const go = i === 0 ? { phase: 'setup' } : i === steps.length - 1 ? { phase: 'result', streetIdx: Math.max(0, streets.length - 1) } : { phase: 'action', streetIdx: si };
              const cls = 'entry-step' + (i < stepNow ? ' is-done' : i === stepNow ? ' is-now' : '');
              return (
                <li key={i} className={cls} aria-current={i === stepNow ? 'step' : undefined}>
                  {reached && i !== stepNow
                    ? <button type="button" className="entry-step-btn ctl" onClick={() => setEntryJump({ ...go, n: Date.now() })}
                        aria-label={(i === 0 ? 'Setup' : i === steps.length - 1 ? 'Result' : st + ' street') + ': edit'}><span>{st}</span></button>
                    : <span>{st}</span>}
                </li>
              );
            })}
          </ol>
          {/* Tournament or cash. A cash game is money, so its stacks and pots
              carry a currency symbol; a straddle is a cash-game wager, so
              switching it on down in the blinds flips this to Cash for you. */}
          {onSetup && <div className="replayer-row entry-game-row" style={{marginBottom:'var(--space-md)', alignItems:'flex-end'}}>
            <div className="replayer-field" style={{flex:'1 1 auto'}}>
              {/* "Format", not "Game": the two buttons are tournament or cash, and the game is the line above. */}
              <label id="entry-format-label">Format</label>
              <div className="live-update-tabs" style={{margin:0}} role="group" aria-labelledby="entry-format-label">
                <button type="button" className={isCash ? '' : 'active'} aria-pressed={!isCash}
                  onClick={() => setCurrentHand(h => withGameMode(h, 'mtt'))}>MTT</button>
                <button type="button" className={isCash ? 'active' : ''} aria-pressed={isCash}
                  onClick={() => setCurrentHand(h => withGameMode(h, 'cash'))}>Cash</button>
              </div>
            </div>
            {isCash && (
              <div className="replayer-field" style={{flex:'0 0 calc(var(--subrow) * 12)'}}>
                <label htmlFor="entry-currency">Currency</label>
                <select id="entry-currency" value={currentHand.currency || 'USD'}
                  onChange={e => setCurrentHand(h => ({ ...h, currency: e.target.value }))}>
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                </select>
              </div>
            )}
          </div>}
          {onEnds && <div className="replayer-row" style={{marginBottom:'var(--space-md)'}}>
            <div className="replayer-field">
              <label htmlFor="entry-title">Title</label>
              {/* The placeholder is the title a blank field will get (UX pick 69), so leaving it is plainly fine. */}
              <input id="entry-title" type="text" placeholder={autoTitle(currentHand) || 'e.g. Huge pot with AA'} value={title} onChange={e => setTitle(e.target.value)} />
            </div>
          </div>}
          {/* 76: .replayer-notes-area was fully styled — label, textarea,
              focus ring, all tokenised — with no JSX consumer anywhere, and
              isPublic went into the save payload with no control that could
              ever set it. Both were saved and neither was editable. */}
          {onEnds && <div className="replayer-notes-area">
            {/* The notes box is hidden for now (2026-10-01); saved notes still show in replay. */}
            {SHOW_ENTRY_NOTES && <>
              <label htmlFor="replayer-notes">Notes</label>
              <textarea id="replayer-notes" value={notes} placeholder="What were you thinking here?"
                onChange={e => setNotes(e.target.value)} />
            </>}
            <div className="replayer-settings-row" style={{marginBottom:0}}>
              <div className="replayer-settings-label">Share publicly</div>
              <button className={'replayer-settings-toggle' + (isPublic ? ' on' : '')}
                aria-pressed={isPublic} aria-label="Share this hand publicly"
                onClick={() => setIsPublic(v => !v)} />
            </div>
          </div>}
          <div id="gto-sticky-slot"></div>
        </div>
        <GTOEntryView
          hand={currentHand}
          setHand={setCurrentHand}
          onDone={handleEntryDone}
          onCancel={cancelEntry}
          heroName={heroName}
          resume={entryResume}
          jump={entryJump}
          onProgress={setEntryAt}
          names={savedNames}
        />
      </div>
    );
  }

  // ── Quick add (admins): describe a hand, answer its gaps, then replay or review it ──
  if (mode === 'quick' && quickAdd) {
    return <QuickAddView key={quickSeed ? 'watch-' + quickSeed.id : 'quick'} token={token} heroName={heroName} voice={quickVoice} seed={quickSeed}
      onBack={() => { setQuickSeed(null); setMode('list'); }}
      onOpen={(hand, target, description) => {
        // The description the hand was read from is kept as its notes, so the original words
        // travel with the saved hand. "Open in replayer" saves at once — before this nothing
        // quick add produced was ever stored; "Review & save" saves when the form is done.
        const desc = String(description || '').trim();
        if (target === 'entry' && draftInTheWay()) return;
        setQuickSeed(null);
        setCurrentHand(hand); setCurrentHandId(null); setHandIsShared(false);
        setTitle(''); setNotes(desc); setIsPublic(false);
        // A hand read from a description is whole: it opens on its result, as Edit does.
        if (target === 'entry') { openEntry(hand, editPlace(hand)); return; }
        setMode('replay');
        saveHand(hand, { id: null, notes: desc });
      }} />;
  }

  /* 100: the loading branch was one line of text with no shape, so the picker
     rendered a sentence and then snapped the whole screen in when the fetch
     landed — while this app ships a full skeleton kit that the schedule,
     dashboard and admin screens all use. The placeholder is the shape of what
     is coming: the new-hand panel, then rows with a card slot at the left. */
  if (loading) {
    return (
      <div className="replayer-view is-list">
        {/* Title dropped — the top-bar subtitle reads "hands archive" on this tab. */}
        {/* Grid: the same wrappers the loaded screen uses, so every placeholder
            lands on the block it stands in for. Text bars are 1r tall, sitting
            on their cell's baseline (the cells bottom-align); widths whole g. */}
        <div className="replayer-list-new">
          <div className="replayer-list-head">
            <div className="skeleton replayer-list-skel" style={{width: 'calc(var(--gu) * 8)'}} />
          </div>
          <div className="game-subheading"><div className="skeleton replayer-list-skel" style={{width: 'calc(var(--gu) * 6)'}} /></div>
          <div className="game-faves-row">
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{borderRadius: 0}} />)}
          </div>
          <div className="game-subheading"><div className="skeleton replayer-list-skel" style={{width: 'calc(var(--gu) * 4)'}} /></div>
          <div className="skeleton" style={{height: 'calc(var(--subrow) * 30)', marginBottom: 'var(--subrow)', borderRadius: 'calc(var(--subrow) * 0.75)'}} />
          <div className="replayer-list-create"><div className="skeleton" style={{height: '100%'}} /></div>
          {quickAdd && <div className="qa-entry"><div className="skeleton" /><div className="skeleton" /></div>}
        </div>
        <div className="replayer-list-heading"><div className="skeleton replayer-list-skel" style={{width: 'calc(var(--gu) * 8)'}} /></div>
        <div className="replayer-hand-list">
          {[0, 1, 2].map(i => (
            <div key={i} className="replayer-hand-card is-row">
              <div className="replayer-hand-strip skeleton" style={{borderRadius: 0}} />
              <div className="replayer-hand-card-content">
                <div className="replayer-hand-card-cards">
                  <div className="skeleton" style={{width: 'calc(var(--gu) * 4)', height: 'calc(var(--subrow) * 4)', borderRadius: 'var(--radius-xs)'}} />
                </div>
                <div className="replayer-hand-card-body">
                  <div className="skeleton replayer-list-skel" style={{width: i === 1 ? 'calc(var(--gu) * 13)' : 'calc(var(--gu) * 10)'}} />
                  <div className="skeleton replayer-list-skel" style={{width: 'calc(var(--gu) * 7)'}} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── The drill: a hand played against the solver, on this table ──
  if (mode === 'drill') {
    return (
      <ReplayErrorBoundary onBack={() => { setMode('list'); fetchHands(); }}>
        <Suspense fallback={null}>
          <ReplayerDrill Replay={HandReplayerReplayView} token={token} heroName={heroName} cardSplay={cardSplay}
            onBack={() => { setMode('list'); fetchHands(); if (onDrillBack) onDrillBack(); }} />
        </Suspense>
      </ReplayErrorBoundary>
    );
  }

  // ── List mode ──
  /* The unfinished hand, first in the list, drawn as a saved row is. The row opens it where it
     stopped (rows open on a press); its one button throws it away, after a question. */
  const rowKey = (open) => (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); };
  const draftRow = draft && (() => {
    const dh = draft.hand;
    const v = getVariantStrip(dh.gameType);
    const cfg = HAND_CONFIG[dh.gameType] || HAND_CONFIG_DEFAULT;
    return (
      <div className="replayer-hand-card is-row is-draft" tabIndex={0} onClick={resumeDraft} onKeyDown={rowKey(resumeDraft)}>
        <div className={'replayer-hand-strip fam-' + v.family} style={{ background: v.color }} title={dh.gameType}>
          <span className="replayer-hand-strip-abbr">{v.abbr}</span>
        </div>
        <div className="replayer-hand-card-content">
          <div className="replayer-hand-card-cards" aria-hidden="true">
            <CardRow text={heroCardsOf(dh)} stud={cfg.isStud} max={cfg.isStud ? 3 : (cfg.heroCards || 2)} splay={0} />
          </div>
          <div className="replayer-hand-card-body">
            <span className="replayer-hand-card-title">Unfinished hand</span>
            <span className="replayer-hand-card-meta">{'Continue · ' + agoLabel(draft.savedAt)}</span>
          </div>
          <div className="replayer-hand-card-actions" onClick={e => e.stopPropagation()}>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="Discard the unfinished hand" onClick={discardDraft}><span>Discard</span></button>
          </div>
        </div>
      </div>
    );
  })();
  const toggleDoubleBoard = () => setDoubleBoard(d => !d);
  /* The second pane with no hand open: what goes there, and how to get one there. */
  const paneEmpty = (
    <div className="dk-hands-empty">
      <p className="dk-hands-empty-title">{hands.length ? 'No hand open' : 'Your replays open here'}</p>
      <p className="dk-hands-empty-meta">{hands.length
        ? 'Choose a saved hand on the left to replay it here. ↑ and ↓ step through the list.'
        : 'Create a hand on the left, or watch the sample hand.'}</p>
    </div>
  );
  return (
    <>
    {sidePane && createPortal(replayEl || paneEmpty, sidePane)}
    <div className="replayer-view is-list">
      {/* Title dropped — the top-bar subtitle reads "hands archive" on this tab. */}


      {/* New hand creation. Grid: no longer a bordered panel. Inside a 1..36g
          panel the content has to inset a whole subcolumn (3..34g) to land on
          valid x lines, and four favourites or five tabs cannot divide 31g on
          those lines; flat, they sit on the primary columns the way the
          Schedule tab's toggles do, and the heading matches "Saved Hands". */}
      <div className="replayer-list-new">
        <div className="replayer-list-head">
          <div className="replayer-list-title"><span>New Hand</span></div>
        </div>
        {/* The variant picker: the best guess from My Schedule (owner, 2026-10-20; VariantPicker.jsx), then the
            variant wheels (owner, 2026-11-22: "Let's build the wheels picker"; VariantWheels.jsx,
            utils/variant-wheels.js), whose Search opens the palette (search, mixes, a game's rules). */}
        <GuessCard guess={guess} current={currentRow} onPick={pickVariant} />
        <VariantWheels rows={catalog} current={currentRow} onPick={pickVariant} history={gameHistory} hands={hands}
          onSearch={() => setPaletteOpen(true)} name={variantDisplayName + (selectedMix ? ' · ' + selectedMix : '')} />
        {/* Double board moved to the hand's setup, beside Straddle (UX pick 62): it describes the hand. */}
        {false && currentRow && ['holdem', 'omaha'].includes(currentRow.family) && (
          <div className="game-picker vp-stud">
            <div className="game-check-group">
              <div className={`game-check-row has-check${doubleBoard ? ' selected' : ''}`}
                role="checkbox" aria-checked={doubleBoard} tabIndex={0} onClick={toggleDoubleBoard}
                onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleDoubleBoard(); } }}>
                <div className={`game-check-box${doubleBoard ? ' checked' : ''}`} aria-hidden="true">
                  {doubleBoard && <span style={{color:'#fff',fontSize:'calc(var(--subrow) * 1.125)',lineHeight:1,fontWeight:700}}>✓</span>}
                </div>
                <span className={`game-check-row-label is-caps${doubleBoard ? ' selected' : ''}`}>Double board</span>
              </div>
            </div>
          </div>
        )}
        {paletteOpen && (
          <Palette rows={catalog} mixes={mixes} history={gameHistory} current={currentRow} hands={hands}
            onPick={pickVariant} onClose={() => setPaletteOpen(false)} />
        )}
        <div className="replayer-list-create">
          <button className="btn btn-primary btn-sm" onClick={startNewHand}><span>Create {variantDisplayName} Hand</span></button>
        </div>
        {/* Type a hand and Say a hand, the two other ways to the same goal, directly under Create
            (UX pick 62, owner 2026-10-16 for the pair). Play a hand is Study's (Practice). */}
        {quickAdd && (
          <div className="qa-entry">
            <button type="button" className="qa-chip" onClick={() => { setQuickVoice(false); setMode('quick'); }}><span>Type a hand</span></button>
            <button type="button" className="qa-chip" onClick={() => { setQuickVoice(true); setMode('quick'); }}>
              <svg className="qa-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="17" x2="12" y2="22"/></svg>
              <span>Say a hand</span>
            </button>
          </div>
        )}
      </div>

      {/* Saved hands list. The heading carries the hand-history export (all hands,
          as PokerStars-format text for PokerTracker 4) at its right. */}
      {quickAdd && (
        <FromYourWatch token={token} onOpen={(h) => { setQuickSeed(h); setQuickVoice(false); setMode('quick'); }} />
      )}
      <SentToYou token={token} />
      {offlineCopy && (
        <div className="hx-offline" role="status">{`No signal. Showing the copy on this phone${waiting.length ? ` · ${waiting.length} waiting to upload` : ''}`}</div>
      )}
      <div className="replayer-list-heading">
        <span>Saved Hands</span>
        <span className="hx-head-btns">
          {token && (
            <button type="button" className="btn btn-ghost btn-sm ctl snap-g replayer-hh-export-btn" onClick={() => setShowImport(true)}>
              <span>Import</span>
            </button>
          )}
          {hands.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm ctl snap-g replayer-hh-export-btn" onClick={() => setShowHhExport(true)}>
              <span>Export for PokerTracker</span>
            </button>
          )}
        </span>
      </div>
      {showImport && <ImportHandsSheet token={token} onClose={() => setShowImport(false)}
        onDone={(d) => { toast.success(`${d.saved} hand${d.saved === 1 ? '' : 's'} imported${d.duplicates ? `, ${d.duplicates} already saved` : ''}`); setTagFilter(d.tag); fetchHands(); }} />}
      {allHandTags.length > 0 && (
        <div className="hx-tagrow" role="radiogroup" aria-label="Filter by tag">
          <button type="button" role="radio" aria-checked={!tagFilter} className={'hx-tag' + (!tagFilter ? ' is-on' : '')} onClick={() => setTagFilter(null)}><span>All</span></button>
          {allHandTags.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={tagFilter === t} className={'hx-tag' + (tagFilter === t ? ' is-on' : '')} onClick={() => setTagFilter(tagFilter === t ? null : t)}>
              <span>{`${t} ${hands.filter((h) => Array.isArray(h.tags) && h.tags.includes(t)).length}`}</span>
            </button>
          ))}
        </div>
      )}
      {waiting.length > 0 && (
        <div className="replayer-hand-list hx-waiting">
          {waiting.map((w) => (
            <div key={w.clientId} className="replayer-hand-card is-row is-empty">
              <div className="replayer-hand-card-content">
                <div className="replayer-hand-card-body">
                  <span className="replayer-hand-card-title">{(w.payload && w.payload.title) || 'A hand'}</span>
                  <span className="replayer-hand-card-meta"><span className="hx-wait-chip">Waiting to upload</span></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {sdAsk && <ShortDeckRuleDialog value={sdTrips} onChoose={chooseSdRule} onClose={() => setSdAsk(false)} />}
      {showHhExport && createPortal(
        <HandHistoryExportSheet rows={hands} heroName={heroName} toast={toast} onClose={() => setShowHhExport(false)} />,
        document.body
      )}
      {/* 78: a single grey sentence — "Create one above" — pointing at a picker
          the user may well have scrolled past, on the screen whose entire job
          is to get a first hand recorded. */}
      {/* 81: the skeleton drew a new-hand panel plus three list rows and
           the empty state drew two card backs, a line and a button — so
           whichever one resolved, the layout moved. Same outer structure, so
          the change between them is a cross-fade rather than a reflow. */}
      {/* One Create button, the one under the launcher: the empty state used to repeat it. */}
      {hands.length === 0 && handsLoadError ? (
        <div className="replayer-hand-list">
          {draftRow}
          <div className="replayer-hand-card is-row is-empty" role="alert">
            <div className="replayer-hand-card-content">
              <div className="replayer-hand-card-body">
                <span className="replayer-hand-card-title">Couldn&rsquo;t load your hands</span>
                <span className="replayer-hand-card-meta">They are safe. Check the connection.</span>
              </div>
            </div>
          </div>
          <div className="replayer-sample-row">
            <button type="button" className="btn btn-primary btn-sm ctl replayer-sample-btn" onClick={() => { setLoading(true); fetchHands(); }}>
              <span>Try again</span>
            </button>
          </div>
        </div>
      ) : hands.length === 0 ? (
        <div className="replayer-hand-list">
          {draftRow}
          <div className="replayer-hand-card is-row is-empty">
            {/* Centred across the card, saying what the list is for (UX pick 10). */}
            <div className="replayer-hand-card-content">
              <div className="replayer-hand-card-body">
                <span className="replayer-hand-card-title">No saved hands yet</span>
                <span className="replayer-hand-card-meta">Step through a real 6-max hand, then make your own.</span>
              </div>
            </div>
          </div>
          {/* People learn by using the thing (UX pick 70): one ghost button to a sample replay. */}
          <div className="replayer-sample-row">
            <button type="button" className="btn btn-ghost btn-sm ctl replayer-sample-btn" onClick={openSample}>
              <span>{'▶ Watch a sample hand'}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="replayer-hand-list">
          {draftRow}
          {hands.filter(h => !goneIds.has(h.id) && (!tagFilter || (Array.isArray(h.tags) && h.tags.includes(tagFilter)))).map(h => (
            /* 59: a title, a game chip and a Delete button — no cards, no
               result, no date — in an app about cards, while the stylesheet
               shipped -meta and -actions classes this list never used. Nobody
               looks for "Hand 14"; they look for that AA hand they lost. */
            <SwipeDeleteRow key={h.id} label={displayTitle(h)} rowId={h.id}
              selected={split && mode === 'replay' && currentHandId === h.id}
              className={'replayer-hand-card is-row' + (outcomeOf(h) ? ' outcome-' + outcomeOf(h) : '') + (openingId === h.id ? ' is-opening' : '')}
              onOpen={() => openRow(h)} onDelete={() => deleteHand(h)}
            >
              {/* The strip the schedule uses for venues, carrying the variant
                  instead — a saved hand has no venue, and the game is the thing
                  you scan this list for. Coloured by FAMILY so the colour says
                  something: flop games blue, stud amber, draw green, mixed
                  purple, with shades separating variants inside a family. */}
              {(() => {
                /* gameType, not game_type: the list endpoint spreads hand_data,
                   which is camelCase. The meta line below asked for game_type
                   and had been rendering nothing at all. */
                const v = getVariantStrip(h.gameType);
                return <div className={'replayer-hand-strip fam-' + v.family}
                  style={{ background: v.color }} title={h.gameType}>
                  <span className="replayer-hand-strip-abbr">{v.abbr}</span>
                </div>;
              })()}
                {/* The content, bordered and rounded on its own — which is how
                    .cal-event-row does it. The border belongs HERE and not on
                    the row, because the row has to stay borderless for the
                    strip to form its left edge; putting it on the row is what
                    made this card an outlined box with a tab floating in it. */}
                <div className="replayer-hand-card-content">
              <div className="replayer-hand-card-cards" aria-hidden="true">
                {/* max came from the GAME, not from a 2 typed here. Every row
                    in this list showed two cards whatever the hero actually
                    held — a stud hand holds three on 3rd street, PLO and
                    badugi four, 2-7 triple draw five — so the preview was
                    wrong for every game the app supports except hold'em, and
                    silently: it truncated rather than failing.
                    The splay widens with the count on the same steps the felt
                    uses, because a five-card fan at a two-card angle is a
                    stack with corners showing. */}
                {(() => {
                  const cfg = HAND_CONFIG[h.gameType] || HAND_CONFIG_DEFAULT;
                  const n = cfg.isStud ? 3 : (cfg.heroCards || 2);
                  /* splay={0} — the FLAT row, not a fan. getSplayStyle scales
                     each card by 1 + index*0.05 and rotates it, and at a 30px
                     preview that made the cards in one row differ in height by
                     4 to 7px, measured. It is the same fault as "the cards are
                     smaller on 6th and 7th" on the felt, at a size where the
                     arc buys nothing: five cards across 84px read as a hand
                     either way, and flat they are all exactly 30px. */
                  return <CardRow text={heroCardsOf(h)} stud={cfg.isStud} max={n} splay={0} />;
                })()}
              </div>
              <div className="replayer-hand-card-body">
                <span className="replayer-hand-card-title">{displayTitle(h)}</span>
                {/* 82: two hands with the same cards are told apart by their
                    STAKES, and hand.blinds is already in this payload — the
                    list endpoint spreads the whole hand blob into every row. */}
                <span className="replayer-hand-card-meta">
                  {/* The strip carries the game now, so this carries the money.
                      A fixed-limit hand is quoted in its two BET sizes, the way
                      the felt states it — a stud row read "100/40", a small
                      blind stud does not have over a small bet. */}
                  {/* A built title already ends in the stakes (owner, 2026-11-22), so the line under it starts at
                      the date; a typed title keeps them here. */}
                  {[
                    showsBuiltTitle(h) ? '' : formatStakes(h),
                    h.created_at ? new Date(h.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, {month:'short', day:'numeric'}) : '',
                    h.event && h.event.title ? h.event.title : '',
                  ].filter(Boolean).join(' \u00b7 ')}
                  {Array.isArray(h.tags) && h.tags.length > 0 && <span className="hx-row-tag">{h.tags[0]}</span>}
                </span>
                {openingId === h.id && <span className="replayer-hand-card-meta is-opening-line">Opening…</span>}
              </div>
              {/* The hero's net where Delete was (UX pick 55): the figure on the title's line, the word
                  on the meta's, both right-aligned in the row's 7g column. */}
              {showListResults && (() => {
                const net = netOf(h);
                const oc = outcomeOf(h);
                if (net == null && !oc) return <div className="replayer-hand-card-net" />;
                const word = oc === 'split' ? 'split' : net == null ? (oc === 'win' ? 'won' : 'lost') : net > 0 ? 'won' : net < 0 ? 'lost' : 'even';
                const cash = h.gameMode === 'cash';
                const abs = net == null ? null : Math.abs(net);
                const fig = abs == null ? '' : (net > 0 ? '+' : net < 0 ? '\u2212' : '')
                  + (cash ? currencySymbol(h) + abs.toLocaleString(undefined, { maximumFractionDigits: 2 }) : formatChipAmount(abs));
                return (
                  <div className={'replayer-hand-card-net is-' + word}>
                    <span className="rhc-net-fig">{fig}</span>
                    <span className="rhc-net-word">{word}</span>
                  </div>
                );
              })()}
            </div>
                </SwipeDeleteRow>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

// ── Export for PokerTracker: every saved hand as PokerStars-format text ──
/* Two choices — the Hold'em and (four-card) Omaha hands PokerTracker 4 analyses, or every
   game the format carries — and the hands it cannot write, with why. The counts
   come from checkExportable over the list already in memory (the list endpoint
   spreads each hand into its row), worked out once when the sheet opens. */
function HandHistoryExportSheet({ rows, heroName, toast, onClose }) {
  const sorted = useMemo(() => {
    const pt4 = [], all = [], bad = [];
    const skips = new Set();   // why PokerTracker 4 skips what only "Every game" holds
    for (const row of rows || []) {
      const hand = handOfRow(row);
      const c = checkExportable(hand, { heroName });
      const entry = { hand, playedAt: playedAtOf(row) || new Date(0), row };
      if (c.ok) { all.push(entry); if (c.pt4) pt4.push(entry); else if (c.pt4Why) skips.add(c.pt4Why); }
      else bad.push({ row, message: c.message });
    }
    return { pt4, all, bad, skips };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A dialog: focus lands in it (not on the page behind the backdrop), Escape closes it, and focus
  // goes back to what opened it.
  const panelRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    if (panelRef.current) panelRef.current.focus({ preventScroll: true });
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      try { if (opener && opener.focus) opener.focus({ preventScroll: true }); } catch (_) { /* gone */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hands = (k) => k + (k === 1 ? ' hand' : ' hands');
  const run = (entries, suffix) => {
    try {
      exportHandHistory(entries.map(e => ({ hand: e.hand, playedAt: e.playedAt })), { heroName, filename: handsFileName(new Date(), suffix) })
        .then(r => {
          if (r.result === 'downloaded') toast.success('Saved ' + r.filename + ' · ' + hands(r.written.length));
          else if (r.result === 'empty' && toast?.info) toast.info("Couldn't export the hands");
        })
        .catch((e) => { console.error('hand-history export:', e); if (toast?.info) toast.info("Couldn't export the hands"); });
    } catch (e) { console.error('hand-history export:', e); if (toast?.info) toast.info("Couldn't export the hands"); }
    onClose();
  };
  const { pt4, all, bad, skips } = sorted;
  // What PokerTracker 4 leaves out of the every-game file, in a line.
  const skipWords = skips.has('stud-draw') && skips.has('big-omaha') ? 'stud, draw and 5/6-card Omaha'
    : skips.has('big-omaha') ? '5/6-card Omaha' : 'stud and draw';
  return (
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet hh-export-sheet" role="dialog" aria-modal="true" aria-label="Export for PokerTracker" tabIndex={-1} ref={panelRef}>
        <h3>Export for PokerTracker</h3>
        <p className="hh-export-body">PokerStars-format text that PokerTracker 4 and Hold'em Manager import. They read these as PokerStars hands, so import them into a database of their own.</p>
        <div className="export-options">
          <button type="button" className="export-option-btn hh-export-option" disabled={!pt4.length} onClick={() => run(pt4, '')}>
            <span className="hh-export-option-text">
              <span className="export-option-label">Hold'em and Omaha</span>
              <span className="export-option-desc">{hands(pt4.length)} {'·'} for PokerTracker 4</span>
            </span>
          </button>
          {all.length > pt4.length && (
            <button type="button" className="export-option-btn hh-export-option" onClick={() => run(all, 'all')}>
              <span className="hh-export-option-text">
                <span className="export-option-label">Every game</span>
                <span className="export-option-desc">{hands(all.length)} {'·'} PokerTracker 4 skips {skipWords}</span>
              </span>
            </button>
          )}
        </div>
        {bad.length > 0 && (
          <div className="hh-export-skipped">
            <div className="hh-export-skipped-label">Not exported {'·'} {bad.length}</div>
            {bad.slice(0, 5).map(b => (
              <div key={b.row.id} className="hh-export-skipped-row">
                <span className="hh-export-skipped-title">{b.row.title || ((b.row.gameType || 'Untitled') + ' hand')}</span>
                <span className="hh-export-skipped-why">{b.message}</span>
              </div>
            ))}
            {bad.length > 5 && <div className="hh-export-skipped-more">And {bad.length - 5} more</div>}
          </div>
        )}
        <div className="hh-export-cancel">
          <button type="button" className="btn btn-ghost btn-sm ctl snap-g snap-g-centred" onClick={onClose}><span>Cancel</span></button>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════
// ── Replay View Sub-component ────────────────────────────
// ══════════════════════════════════════════════════════════
function HandReplayerReplayView({ hand: enteredHand, token, onEdit, onBack, cardSplay, onSolveSpot, onStudyDraw, linkedReplay, heroName, playedAt, sharedHand, drill = null, inPane = false, notes = null,
  onSaveExtras = null, allTags = [], question = null, onQuestionAnswered = null, handTitle = '' }) {
  /* The GIF export's completion toasts referenced `toast` from inside this
     component, where it was never declared - the outer HandReplayerView owns
     the one call to useToast(). Optional chaining does not save an UNDECLARED
     identifier, so every successful GIF export ended in a ReferenceError
     inside onDone, which is why it never announced where the file went. */
  const toast = useToast();
  const hand = useMemo(() => dropDeadActions(enteredHand), [enteredHand]);
  const [streetIdx, setStreetIdx] = useState(0);
  const [actionIdx, setActionIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  /* The drill plays the opponent's actions at twice the pace: it is a hand being played, not watched. */
  const [speed, setSpeed] = useState(drill ? 500 : 1000);
  const [showResult, setShowResult] = useState(false);
  const [hiloAnimate, setHiloAnimate] = useState(false);
  /* A landscape screen gets a landscape table, on a phone held sideways and on
     a desktop alike — the shape of the screen is the whole question. What the
     mode must not do is come out bigger than the space it has, which is
     handled where the table is sized rather than by refusing to enter here. */
  const LANDSCAPE_Q = '(orientation: landscape)';
  /* In the desktop Hands pane (UX pick 68) the table is always the landscape one: the pane is a
     desktop pane, and the portrait mode is a phone's full screen (fixed, its paddings from the window). */
  const [windowLandscape, setIsLandscape] = useState(() => window.matchMedia(LANDSCAPE_Q).matches);
  const isLandscape = inPane || windowLandscape;
  useEffect(() => {
    const mql = window.matchMedia(LANDSCAPE_Q);
    const handler = (e) => { setIsLandscape(e.matches); };
    mql.addEventListener('change', handler);
    return () => { mql.removeEventListener('change', handler); };
  }, []);
  const [showSettings, setShowSettings] = useState(false);
  // The table-settings dropdown (felt, lighting, splay) and its anchor button.
  const [showQuick, setShowQuick] = useState(false);
  const quickBtnRef = useRef(null);
  const closeQuick = useCallback(() => setShowQuick(false), []);
  // A shared hand carries the sharer's felt (decoded onto the hand); use it so
  // the recipient sees the same table. The viewer's own saved hands carry no
  // felt, so they fall back to the viewer's stored preference. Not persisted —
  // viewing someone's link must not overwrite your own felt.
  const [feltColor, setFeltColor] = useState(() => (hand && hand.feltColor) || localStorage.getItem('replayerFeltColor') || '#6b5b8a');
  const prevStreetRef = useRef(0);
  const tableRef = useRef(null);
  /* The one thing on the table that cannot be sized in cqw is the text, so
     the component has to know how wide the table came out. Measured, not
     derived from the viewport — that guess is what this whole pass was
     unpicking. */
  const [tableW, setTableW] = useState(0);
  const [tableH, setTableH] = useState(0);
  /* The strip overlay is positioned --transport-h up from the bottom, and that
     was a hard-coded 104px — the height of the bar WITHOUT the admin row. With
     "Solve this spot" and its note the real bar is about 150px, so the strips
     were sitting behind it and getting clipped. Measured instead: whatever the
     bar ends up containing, the strips clear it. */
  const barRef = useRef(null);
  useEffect(() => {
    const el = tableRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      const h = Math.round(entries[0].contentRect.height);
      /* A 4px deadband: the table's size is a min() of two container queries
         and settles a fraction of a pixel differently between layouts, and a
         name budget that flickers would retype every plaque. */
      setTableW(prev => (Math.abs(prev - w) >= 4 ? w : prev));
      setTableH(prev => (Math.abs(prev - h) >= 4 ? h : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const nameBudget = nameBudgetFor(tableW, tableH, isLandscape);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    /* In r, and from the bar's TOP to the container's bottom edge rather
       than the bar's own height: the strip overlay is positioned against the
       container's padding box, which also holds the safe-area inset and the
       sub-r remainder under the bar. A rounded px height put the overlay up
       to half a pixel — and the whole bottom inset — off the bar's top. */
    const apply = () => {
      const root = el.closest('.replayer-replay');
      if (!root) return;
      const h = root.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
      const r = Math.min(window.innerWidth, 430) / 37 * 0.71;
      if (h > 0) root.style.setProperty('--bar-h', 'calc(var(--subrow) * ' + (h / r).toFixed(4) + ')');
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    const root = el.closest('.replayer-replay');
    if (root) ro.observe(root);
    return () => ro.disconnect();
  }, []);
  const prevActionIdxRef = useRef(-1);
  const prevShowResultRef = useRef(false);

  // Video export state
  const [videoExporting, setVideoExporting] = useState(false);
  // Which video the progress overlay is recording, so its copy is accurate:
  // 'transparent' | 'greenscreen' | 'story' | 'igstory'.
  const [videoKind, setVideoKind] = useState('transparent');
  // Instagram Story adjustment: the picked photo and a still of the replay,
  // held open while the poster sizes the overlay and picks a speed before the
  // clip is rendered. null when the adjust sheet is closed.
  const [igDraft, setIgDraft] = useState(null); // { photoUrl, photoImg, stillUrl }
  const [igScale, setIgScale] = useState(0.92); // replay width as a fraction of the 9:16 frame
  const [igSpeed, setIgSpeed] = useState(1000); // ms per step, mirrors the transport's SPEEDS
  const [igPos, setIgPos] = useState({ x: 0.5, y: 0.5 }); // replay CENTRE as a fraction of the frame
  const igPosRef = useRef(igPos); igPosRef.current = igPos; // fresh value for the gesture closure
  const igScaleRef = useRef(igScale); igScaleRef.current = igScale;
  const igBoxRef = useRef(null);
  const igGestureRef = useRef({ pointers: new Map() }); // live pointers + gesture baseline
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoStep, setVideoStep] = useState(0);
  const [videoTotal, setVideoTotal] = useState(0);
  // GIF export state
  const [gifExporting, setGifExporting] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const [gifStep, setGifStep] = useState(0);
  const [gifTotal, setGifTotal] = useState(0);
  // Refs that stay live with current values so the async export loop always calls latest functions
  const canGoForwardRef = useRef(true);
  const stepForwardRef = useRef(null);

  // Animation states
  const [animFolded, setAnimFolded] = useState(new Set());
  const [animStreetTransition, setAnimStreetTransition] = useState(false);
  const [animStreetLabel, setAnimStreetLabel] = useState(false);
  const [animShowdown, setAnimShowdown] = useState(false);
  /* 11: @keyframes cinematicDeal is complete — cards fly in from a
     dealer-relative offset with a per-seat delay — and nothing ever added
     .animate-deal or set --deal-dx/--deal-dy/--deal-seat-delay, so hands
     simply opened with the cards already present. The animateDeal setting was
     meanwhile gating folds, discards and the showdown, none of which is a
     deal. This runs it on mount and on any return to the start of the hand. */
  const [animDealing, setAnimDealing] = useState(false);
  const [flyingChips, setFlyingChips] = useState([]);
  const [animPotCollect, setAnimPotCollect] = useState(false);
  const [drawDiscardAnims, setDrawDiscardAnims] = useState([]);

  // Settings
  /* A shared link carries the sharer's table look (hand.visuals, from the link's 'v'
     part). Each value seeds its setting for this view without being written back,
     exactly as the felt colour already did, so the link shows the sharer's table and
     the viewer's own preferences are untouched. A hand without it seeds nothing. */
  const _vis = (hand && hand.visuals) || null;
  const vs = k => (_vis && _vis[k] !== undefined ? _vis[k] : undefined);
  const _theme = useReplayerSetting('Theme', 'default', vs('theme'));
  /* 99: the control reads "High-Contrast Deck" and applies .hc-deck, while
     the state key, the persisted preference and every update call still said
     fourColorDeck — a leftover from repurposing the dead four-colour toggle.
     Anyone reading the state, or a stored preference, was told this app has a
     four-colour deck setting that it does not have. Renamed, with a one-time
     read of the old value so nobody's stored choice is lost. */
  const _hcDeck = useReplayerSetting('HighContrastDeck', (() => {
    const legacy = localStorage.getItem('replayerFourColorDeck');
    return legacy === null ? false : legacy === 'true';
  })(), vs('highContrastDeck'));
  /* Defaulted off, which meant PotChipVisual, getChipBreakdown, the
     denomination ladder and the edge pips had all been built and never seen.
     A pot with no chips in it is a number floating on cloth. */
  const _showChipStacks = useReplayerSetting('ShowChipStacks', true, vs('showChipStacks'));
  const _showHandStrength = useReplayerSetting('ShowHandStrength', false);
  const _showPotOdds = useReplayerSetting('ShowPotOdds', false, vs('showPotOdds'));
  const _showPlayerStats = useReplayerSetting('ShowPlayerStats', false, vs('showPlayerStats'));
  const _showNuts = useReplayerSetting('ShowNutsHighlight', false, vs('showNutsHighlight'));
  const _showSPR = useReplayerSetting('ShowSPR', false, vs('showSPR'));
  const _showBetSizing = useReplayerSetting('ShowBetSizing', false, vs('showBetSizing'));
  const _showRanges = useReplayerSetting('ShowRanges', false, vs('showRanges'));
  const _showChipDelta = useReplayerSetting('ShowChipDelta', false, vs('showChipDelta'));
  const _showEquity = useReplayerSetting('ShowEquity', false, vs('showEquity'));
  const _stacksInBB = useReplayerSetting('StacksInBB', false, vs('stacksInBB'));
  /* The result line under a finished replay and the net on each saved row (UX picks 54, 55). On by
     default; off for anyone who would rather not judge a hand by how it came out. */
  const _showResults = useReplayerSetting('ShowResults', true);
  // Anonymise every non-hero seat as "Opponent 1", "Opponent 2", … — the hero
  // (the logged-in user) keeps their name. For clean, private sharing.
  const _hideOppNames = useReplayerSetting('HideOppNames', false, vs('hideOppNames'));
  const _cardSplay = useReplayerSetting('CardSplay', true, vs('cardSplay'));
  /* How wide the hole-card fan opens, as a percent of what the table can hold.
     100 is the default fan; the slider tightens it toward a squared stack. */
  const _splayAmount = useReplayerSetting('SplayAmount', 100, vs('splayAmount'));
  /* With splay off the hole cards lie flat in an overlapped row; this is how
     much each card covers the one before it, as a percentage of a card's width.
     52 is the overlap the row has always had. */
  const _cardOverlap = useReplayerSetting('CardOverlap', 52, vs('cardOverlap'));
  /* Off by default: the dark cloth is what the table looks like today, and a
     setting that changes the first thing you see should be opt-in. */
  const _feltBright = useReplayerSetting('FeltBright', false, hand && hand.feltColor ? !!hand.feltBright : undefined);
  const _lightStrip = useReplayerSetting('LightStrip', false, vs('lightStrip'));
  const _animDeal = useReplayerSetting('AnimateDeal', true, vs('animateDeal'));
  const _animChips = useReplayerSetting('AnimateChips', true, vs('animateChips'));
  const _animBoard = useReplayerSetting('AnimateBoard', true, vs('animateBoard'));
  const _animWinner = useReplayerSetting('AnimateWinner', true);
  const _animFold = useReplayerSetting('AnimateFold', true, vs('animateFold'));
  /* How a folded hand leaves (FOLD_STYLES): a viewer preference, like the card back. */
  const _foldStyle = useReplayerSetting('FoldStyle', 'random');
  /* The card back (utils/card-back.js): a viewer preference, not part of a shared link's look. */
  const _cardBack = useReplayerSetting(CARD_BACK_KEY.replace(/^replayer/, ''), 'standard');
  useEffect(() => { applyCardBack(_cardBack[0]); }, [_cardBack[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  const rSettings = {
    theme: REPLAYER_THEME_IDS.has(_theme[0]) ? _theme[0] : 'default', feltColor,
    /* Pinned off, so a value saved before they left the UI cannot keep a hidden
       feature running: hand strength, and winner effects (removed 2026-09-30 with
       commentator mode, sounds, card-back designs and the classic card style,
       which have since been deleted). */
    highContrastDeck: _hcDeck[0], showChipStacks: _showChipStacks[0], showHandStrength: false,
    showPotOdds: _showPotOdds[0],
    showPlayerStats: _showPlayerStats[0], showNutsHighlight: _showNuts[0],
    showSPR: _showSPR[0], showBetSizing: _showBetSizing[0],
    showRanges: _showRanges[0], showChipDelta: _showChipDelta[0],
    showEquity: _showEquity[0], stacksInBB: _stacksInBB[0], hideOppNames: _hideOppNames[0], showResults: _showResults[0],
    animateDeal: _animDeal[0], animateChips: _animChips[0], animateBoard: _animBoard[0], animateWinner: false,
    animateFold: _animFold[0], foldStyle: normalizeFoldStyle(_foldStyle[0]),
    cardSplay: _cardSplay[0], splayAmount: _splayAmount[0], cardOverlap: _cardOverlap[0], lightStrip: _lightStrip[0], feltBright: _feltBright[0],
    cardBack: normalizeCardBack(_cardBack[0]),
  };
  const rSetters = {
    theme: _theme[1], feltColor: v => { setFeltColor(v); localStorage.setItem('replayerFeltColor', v); },
    highContrastDeck: _hcDeck[1],
    showChipStacks: _showChipStacks[1], showHandStrength: _showHandStrength[1], showPotOdds: _showPotOdds[1],
    showPlayerStats: _showPlayerStats[1],
    showNutsHighlight: _showNuts[1],
    showSPR: _showSPR[1], showBetSizing: _showBetSizing[1],
    showRanges: _showRanges[1], showChipDelta: _showChipDelta[1],
    showEquity: _showEquity[1], stacksInBB: _stacksInBB[1], hideOppNames: _hideOppNames[1], showResults: _showResults[1],
    animateDeal: _animDeal[1], animateChips: _animChips[1], animateBoard: _animBoard[1], animateWinner: _animWinner[1],
    animateFold: _animFold[1], foldStyle: v => _foldStyle[1](normalizeFoldStyle(v)),
    cardSplay: _cardSplay[1], splayAmount: _splayAmount[1], cardOverlap: _cardOverlap[1], lightStrip: _lightStrip[1], feltBright: _feltBright[1],
    cardBack: v => _cardBack[1](normalizeCardBack(v)),
  };
  const handleSettingsUpdate = (key, val) => { if (rSetters[key]) rSetters[key](val); };

  /* Spring moments (utils/replayer-motion.js, utils/spring.js): the flop deal and spread, the
     turn and river landing, wagers pushed out and swept in, the pot shipped to the winner — one
     house spring family, computed once per moment and played by the compositor as Web Animations.
     localStorage.replayerSprings: unset, Set B "snappy", the default (owner, 2026-10-13); '1' Set A
     "house", for an A/B; '2' or 'snappy' Set B; '0' today's code paths unchanged, so a
     before/after comes from one build. Read at mount and on the
     storage event. One registry owns every spring on the table, so a motion interrupted by the
     next step continues from where it is, and a step back, a jump or an export still finishes it. */
  const [springsFlag, setSpringsFlag] = useState(() => readSpringsFlag());
  useEffect(() => {
    const onStorage = (e) => { if (!e || e.key == null || e.key === SPRINGS_FLAG_KEY) setSpringsFlag(readSpringsFlag()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const springSet = springSetFor(springsFlag);
  // Reduced motion: none of the spring moments run; the replayer keeps its 140ms rmFade.
  const springOn = !!springSet && !springsReducedMotion();
  const motionRef = useRef(null);
  if (!motionRef.current) motionRef.current = new MotionRegistry();
  const motion = motionRef.current;
  const [, setMotionRender] = useState(0);
  const committedStepRef = useRef(null);   // the step the last commit showed
  const revealRef = useRef(false);          // the spring path's showdown reveal is on (see springReveal)
  const prevWagersRef = useRef(new Map());  // seat -> that commit's wager: { el, geo, topColor }
  // Where placeWagers last put each wager, as a share of its container (so a resize moves nothing): a wager it moves
  // again glides there instead of jumping.
  const wagerSpotsRef = useRef(new WeakMap());
  const boardDeltaRef = useRef(null);       // this commit's board FLIP measurement, for the springs
  const potTotalRef = useRef(null);
  const sweepLayerRef = useRef(null);
  // The folded cards' flights: under every seat, so a hand gathers and goes behind its plaque (.replayer-fold-layer).
  const foldLayerRef = useRef(null);
  useEffect(() => () => motion.dispose(), [motion]);
  // Which parent render the pot's pile last saw: a live arrival on the pile holds only until the next.
  motion.renderSeq = (motion.renderSeq || 0) + 1;

  /* 44: the display surfaces where depth is the point — stacks, pot, wagers —
     go through this; commentary and exports keep chip counts, because prose
     that says 'he shoved 14 BB' reads oddly next to a hand history. */
  /* The unit is not always the big blind. In a fixed-limit game blinds.bb
     holds the SMALL BET and blinds.bigBet the big one — the same distinction
     the level line already makes when it prints a stud game as 40/80 rather
     than as a small blind stud does not post. Dividing a stud stack by the
     small bet would have doubled every depth on the felt. The printed unit
     stays "BB" for both, because that is what it means in each game the label
     appears in: big blinds where blinds are posted, big bets in a limit game,
     which is how limit players say it ("thirty big bets deep"). */
  const _limitGame = (HAND_CONFIG[hand.gameType] || HAND_CONFIG_DEFAULT).betting === 'fl';
  const _bb = _limitGame
    ? ((hand.blinds || {}).bigBet || ((hand.blinds || {}).bb || 0) * 2)
    : ((hand.blinds || {}).bb || 0);
  /* Cash stacks and pots wear the currency symbol; tournament chips do not.
     Never in BB mode — "$14 BB" is two units at once — so the symbol rides
     only the chip figure. */
  const _curSym = currencySymbol(hand);
  const fmtChips = (v) => {
    const s = formatChipAmount(v, rSettings.stacksInBB ? _bb : 0);
    return (_curSym && s && !rSettings.stacksInBB) ? _curSym + s : s;
  };
  /* Tapping any stack flips the whole table, not just the one touched: depth
     is only readable by comparison, so a felt showing one seat in BB and the
     rest in chips would be worse than either mode. It writes the same setting
     the panel does, so the two stay one state rather than two.
     Guarded on a unit existing — with no blinds recorded, formatChipAmount
     falls back to chips and the tap would be a control that does nothing. */
  const stackUnitAvailable = _bb > 0;
  const toggleStackUnit = (e) => {
    if (!stackUnitAvailable) return;
    e.stopPropagation();
    // 59: the figures roll to the other unit outward from the seat tapped.
    try {
      const seatEl = e.currentTarget && e.currentTarget.closest('.replayer-seat');
      const t = tableRef.current;
      if (seatEl && t) {
        const texts = new Map();
        t.querySelectorAll('.replayer-seat[data-seat] .replayer-seat-stack').forEach(el => texts.set(Number(el.closest('.replayer-seat').dataset.seat), el.textContent));
        motionRef.current.unitRoll = { seat: Number(seatEl.dataset.seat), texts };
      }
    } catch (err) { /* never break the tap */ }
    rSetters.stacksInBB(!rSettings.stacksInBB);
  };

  // Guard against old/incomplete hand records with no streets
  if (!hand.streets || hand.streets.length === 0) {
    return (
      <div style={{padding:'var(--space-4xl)',textAlign:'center',color:'var(--text-muted)'}}>
        <div style={{marginBottom:'var(--space-lg)',fontSize:'calc(var(--gu) * 1.252)'}}>This hand has no recorded streets.</div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back to list</button>
      </div>
    );
  }

  const gameCfg = HAND_CONFIG[hand.gameType] || HAND_CONFIG_DEFAULT;
  const category = getGameCategory(hand.gameType);
  const streetDef = getStreetDef(hand.gameType);
  const gameEval = gameEvalFor(hand.gameType, hand);
  const isHiLo = gameEval && (gameEval.type === 'hilo' || gameEval.type === 'split-badugi' || gameEval.type === 'halves');
  const finalCards = gameCfg.showCards || gameCfg.heroCards || 2;
  const feltBoard = category === 'community' || !!gameCfg.doorBoard;
  const totalStreets = hand.streets.length;
  const currentStreet = hand.streets[streetIdx];
  const currentActions = currentStreet?.actions || [];
  const isDrawGame = hasDraws(category, gameCfg);
  const replayHeroIdx = hand.heroIdx != null ? hand.heroIdx : 0;

  // Street change animation
  /* Nothing reads animStreetTransition or animStreetLabel. Their only effect was three
     re-renders of this component (+0, +450, +500ms) in the middle of every flop, turn and river —
     and the first of them dropped the turn card's animation class one frame after it was born.
     The spring path does without them; flag '0' keeps today's behaviour exactly. */
  useEffect(() => {
    if (springOn) return;
    if (prevStreetRef.current !== streetIdx && streetIdx > 0) {
      setAnimStreetTransition(true);
      setAnimStreetLabel(true);
      const t1 = setTimeout(() => setAnimStreetTransition(false), 500);
      const t2 = setTimeout(() => setAnimStreetLabel(false), 450);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [streetIdx]);
  useEffect(() => { prevStreetRef.current = streetIdx; }, [streetIdx]);

  // Fold animation
  useEffect(() => {
    if (actionIdx < 0) { prevActionIdxRef.current = actionIdx; return; }
    // Direction guard. prevActionIdxRef was already being tracked and never
    // compared, so stepping BACK onto a fold — or landing on one via a street
    // rewind — re-threw the muck on cards the .folded class had already hidden,
    // making ghost cards flash and re-muck. Rewinding reconstructs state; only
    // forward motion performs it.
    const movedForward = actionIdx > prevActionIdxRef.current;
    if (movedForward && actionIdx >= 0 && actionIdx < currentActions.length) {
      const act = currentActions[actionIdx];
      // Under springs the fold is the moments effect's (25, foldToStack); this CSS one is the springs-off table's.
      if (act && act.action === 'fold' && rSettings.animateFold && !springOn) {
        setAnimFolded(prev => { const n = new Set(prev); n.add(act.player); return n; });
        setTimeout(() => { setAnimFolded(prev => { const n = new Set(prev); n.delete(act.player); return n; }); }, 450);
      }
    }
    prevActionIdxRef.current = actionIdx;
  }, [actionIdx, currentActions, rSettings.animateFold, springOn]);
  /* On the spring path an empty set stays the same set: a new one re-rendered the whole replayer
     right after every street press, in the middle of the flop's spread and the turn's landing. */
  useEffect(() => { setAnimFolded(prev => (springOn && !prev.size ? prev : new Set())); }, [streetIdx]);

  // Showdown animation (flag '0'; the spring path decides it in render: springReveal)
  useEffect(() => {
    if (!springOn && showResult && !prevShowResultRef.current && rSettings.animateDeal) {
      setAnimShowdown(true);
      setTimeout(() => setAnimShowdown(false), 600);
    }
    prevShowResultRef.current = showResult;
  }, [showResult, rSettings.animateDeal]);

  useEffect(() => {
    if (!rSettings.animateDeal) { setAnimDealing(false); return; }
    /* This used to return without clearing the flag — and because the previous
       run's cleanup had already cancelled the timer that clears it, stepping
       forward while the deal was still running left .animate-deal on the seat
       for the rest of the hand. */
    if (streetIdx !== 0 || actionIdx >= 0 || showResult) { setAnimDealing(false); return; }
    setAnimDealing(true);
    // 400ms animation + the longest per-seat delay.
    const t = setTimeout(() => setAnimDealing(false), 400 + hand.players.length * 80);
    return () => clearTimeout(t);
    // Deliberately keyed on the hand and the return-to-start, not on every render.
  }, [hand, streetIdx, actionIdx, showResult, rSettings.animateDeal]);

  /* Deal order is a poker fact, not a render order: the first card goes to the
     seat left of the button and it proceeds clockwise. Falling back to seat
     order when there is no button keeps the stagger from collapsing to zero. */
  const dealOrder = useMemo(() => {
    const n = hand.players.length;
    let btn = hand.players.findIndex(p => p.position === 'BTN' || p.position === 'D');
    if (btn < 0) btn = n - 1;
    return Array.from({ length: n }, (_, k) => (btn + 1 + k) % n);
  }, [hand]);

  // Flying chip helper
  const spawnFlyingChips = useCallback((fromPct, toPct, count, toWinner, amount) => {
    if (!tableRef.current) return;
    const rect = tableRef.current.getBoundingClientRect();
    // Colour-coding is the entire reason casinos denominate chips, and both the
    // palette and the breakdown already exist - the flying chip just never
    // asked. The to-winner chip stays gold: that one IS the pot, not a
    // denomination.
    const denom = amount ? getChipBreakdown(amount)[0] : null;
    const chips = [];
    for (let i = 0; i < Math.min(count, 5); i++) {
      chips.push({
        id: Date.now() + '-' + i,
        color: denom,
        x0: (fromPct[0] / 100) * rect.width,
        y0: (fromPct[1] / 100) * rect.height,
        x1: (toPct[0] / 100) * rect.width,
        y1: (toPct[1] / 100) * rect.height,
        delay: i * 60,
        toWinner: !!toWinner,
      });
    }
    setFlyingChips(prev => prev.concat(chips));
    setTimeout(() => { setFlyingChips([]); }, 700);
  }, []);


  // Determine board animation class based on which street just appeared
  const getBoardAnimClass = () => {
    // >= not !==: the deal animation means "a new card arrives", so playing it
    // for a card already on the felt breaks the metaphor. Backing turn -> flop
    // used to replay the full three-card stagger.
    // The spring path lands board cards from the layout effect, never from a class a re-render drops.
    if (springOn) return '';
    if (!rSettings.animateBoard || prevStreetRef.current >= streetIdx) return '';
    let boardLen = 0;
    for (let si = 0; si <= streetIdx && si < hand.streets.length; si++) {
      if (hand.streets[si].cards.board) boardLen += parseCardNotation(hand.streets[si].cards.board).length;
    }
    if (boardLen <= 3 && streetIdx > 0) return ' animate-board-flop';
    if (boardLen === 4) return ' animate-board-turn';
    if (boardLen === 5) return ' animate-board-river';
    return '';
  };

  // Board cards
  const boardCards = useMemo(() => {
    if (!feltBoard) return '';
    let board = '';
    for (let si = 0; si <= streetIdx && si < hand.streets.length; si++) {
      if (hand.streets[si].cards.board) board += hand.streets[si].cards.board;
    }
    return board;
  }, [hand, streetIdx, feltBoard]);

  /* Super (utils/super-stud.js): 3rd street holds four down cards and the door until the throw after its betting; the
     two thrown dim as that betting closes (superThrowNow) and go as 4th street is dealt (the moments effect). */
  const superThird = !!hand.superStud && category === 'stud' && streetIdx === 0;
  const superGoesOn = !!hand.superStud && !!hand.streets[1] && !!((hand.streets[1].cards || {}).hero || ((hand.streets[1].cards || {}).opponents || []).some(Boolean));
  const superThrowNow = superThird && superGoesOn && actionIdx >= ((hand.streets[0] || {}).actions || []).length - 1;

  // Hero cards
  const heroCards = useMemo(() => {
    if (category === 'stud') {
      let cards = '';
      for (let si = 0; si <= streetIdx; si++) { if (hand.streets[si]?.cards.hero) cards += hand.streets[si].cards.hero; }
      if (hand.superStud && streetIdx === 0) cards = superThirdOnFelt(cards, hand.streets[0]?.cards.heroThrown);
      return cards;
    }
    if (isDrawGame) {
      const base = hand.streets[0]?.cards.hero || '';
      const heroDraws = getPlayerDrawsByStreet(hand, replayHeroIdx);
      return computeDrawHand(base, heroDraws, streetIdx - 1, hand.gameType);
    }
    return hand.streets[0]?.cards.hero || '';
  }, [hand, streetIdx, category, isDrawGame, replayHeroIdx]);

  // Opponent cards
  const opponentCards = useMemo(() => {
    return hand.players.map((_, pi) => {
      if (pi === replayHeroIdx) return null;
      const oppSlot = pi > replayHeroIdx ? pi - 1 : pi;
      if (category === 'stud') {
        let cards = '';
        for (let si = 0; si <= streetIdx; si++) { if (hand.streets[si]?.cards.opponents?.[oppSlot]) cards += hand.streets[si].cards.opponents[oppSlot]; }
        return cards;
      }
      return hand.streets[0]?.cards.opponents?.[oppSlot] || '';
    });
  }, [hand, streetIdx, category, replayHeroIdx]);

  /* 71: the animation guards correctly suppress the deal, the muck and the
     board slide when stepping BACK — which left going backwards a series of
     instant state swaps while going forwards was choreographed, so the two
     directions felt like different applications. Scrubbing is how people
     actually study a hand; it was the least finished way to move through one.
     A short cross-fade on the whole table says "rewinding" without replaying
     a single piece of forward choreography. */
  const [rewinding, setRewinding] = useState(false);
  const rewindTimer = useRef(0);
  const markRewind = useCallback(() => {
    setRewinding(true);
    clearTimeout(rewindTimer.current);
    rewindTimer.current = setTimeout(() => setRewinding(false), 260);
  }, []);
  useEffect(() => () => clearTimeout(rewindTimer.current), []);

  // Pot and stacks
  const { stacks, pot, folded } = useMemo(() => calcPotsAndStacks(hand, streetIdx, actionIdx), [hand, streetIdx, actionIdx]);
  /* Mid-street the pot shown deliberately EXCLUDES this street's betting,
     because those chips are still sitting in front of the players who bet
     them — counting both would show the same money twice.

     At showdown there is no "in front" any more: the bets are collected and
     the pot is paid out. Reported on a hi/lo hand where the pot read 104 BB
     while the two awards under it read 233 BB and 77.6 BB. The awards were
     right — they divide `pot`, the real total, and 233 + 77.6 = 310.6 BB is
     what the stacks say (two players in for 30,800 each at bb=200 is 308 BB
     before blinds and antes). It was the TOTAL that was short, by exactly the
     river it had not counted yet, which is why it looked like the awards had
     been multiplied.

     The last action is read from the street rather than taken from actionIdx,
     so this is the finished pot whatever step the replay is parked on. */
  /* Effective (called) contributions. You cannot wager more than the largest
     stack still behind you, so a bet no opponent can match is UNCALLED and
     returned to the seat that made it — there is no such thing as a side pot
     only one player is eligible for. At the showdown, cap every seat at the
     SECOND-highest commitment: the single top over-shove's excess never enters
     the pot, it goes back. Settled only at the result — mid-hand the bet is
     still live and stands in the pot.
     Mirrored, with allPotLayers and potAwards below, by the hand-history
     export's utils/hand-history/settle.js: change one, change the other. */
  const settled = useMemo(() => {
    const raw = hand.players.map((_, pi) => {
      let total = 0;
      const last = showResult ? hand.streets.length - 1 : streetIdx;
      for (let si = 0; si <= last && si < hand.streets.length; si++) {
        const acts = hand.streets[si].actions || [];
        const upTo = (!showResult && si === streetIdx) ? actionIdx : acts.length - 1;
        total = chipRound(total + computePlayerContrib(hand, si, acts, upTo, pi));
      }
      return total;
    });
    if (!showResult) return { contrib: raw, uncalled: raw.map(() => 0), contested: raw.reduce((a, b) => a + b, 0) };
    const sorted = [...raw].sort((a, b) => b - a);
    const cap = sorted.length > 1 ? sorted[1] : 0;
    const contrib = raw.map(c => Math.min(c, cap));
    const uncalled = raw.map((c, i) => c - contrib[i]);
    /* Antes are in the pot and in no seat's street contribution, so the total has to add them: they
       ride in the main pot (reconcileLayersToPot below). Without them the winner was paid short and
       the chips left the table, on every hand with antes. Stud antes per seat, a big-blind ante once,
       as calcPotsAndStacks takes them. */
    return { contrib, uncalled, contested: chipRound(contrib.reduce((a, b) => a + b, 0) + antesPosted(hand)) };
  }, [hand, streetIdx, actionIdx, showResult]);

  const displayPot = useMemo(() => {
    if (!showResult) return calcPotsAndStacks(hand, streetIdx, -1).pot;
    // The contested total — the uncalled portion of an over-shove is not in it.
    return settled.contested;
  }, [hand, streetIdx, showResult, settled]);

  /* 91: a player who moved all-in got an ALL-IN badge for exactly one step and
     then reverted to an ordinary seat with a zero stack. All-in is the state
     that changes what every SUBSEQUENT action means — it is the reason the
     rest of the hand plays out the way it does — and it lasted one frame.
     Committed once, committed for the hand. */
  const allIn = useMemo(() => {
    const out = new Set();
    for (let si = 0; si <= streetIdx && si < hand.streets.length; si++) {
      const acts = hand.streets[si].actions || [];
      const upTo = si === streetIdx ? actionIdx : acts.length - 1;
      for (let ai = 0; ai <= upTo && ai < acts.length; ai++) {
        if (acts[ai].action === 'all-in') out.add(acts[ai].player);
      }
    }
    // A stack that has reached zero without folding is all-in whether or not
    // the action was recorded with that word.
    hand.players.forEach((_, pi) => {
      if (!folded.has(pi) && stacks[pi] <= 0) out.add(pi);
    });
    return out;
  }, [hand, streetIdx, actionIdx, folded, stacks]);
  /* Whose turn it is (catalogue three, ideas 29 and 33; 2026-10-15): the player of the next action on
     this street, until the showdown. The ring's styles (.replayer-seat.active-turn) were written in
     August but nothing ever set the class, so a replay never said who acts next. -1 between streets
     and at the result. */
  const turnIdx = (() => {
    if (showResult) return -1;
    const next = currentActions[actionIdx + 1];
    return next && !folded.has(next.player) ? next.player : -1;
  })();

  /* Tournament rule: once a player is all-in and no betting is left, every
     live hand is tabled before the runout. So in a tournament hand (not cash),
     from the step where two or more players remain, at least one is all-in, at
     most one still has chips, and the hand records no further action, every
     live hand shows face up. Board and stud games only: in a draw game the
     all-in players still draw, so a hand tabled now is not the hand shown down. */
  const exposeAllIn = useMemo(() => {
    if (hand.gameMode === 'cash') return false;
    if (category !== 'community' && category !== 'stud') return false;
    const live = hand.players.map((_, i) => i).filter(i => !folded.has(i));
    if (live.length < 2 || !live.some(i => allIn.has(i))) return false;
    if (live.filter(i => !allIn.has(i)).length > 1) return false;
    for (let si = streetIdx; si < hand.streets.length; si++) {
      const acts = hand.streets[si].actions || [];
      if (acts.length > (si === streetIdx ? actionIdx + 1 : 0)) return false;
    }
    return true;
  }, [hand, category, folded, allIn, streetIdx, actionIdx]);

  /* 92: one pot number. In any multi-way all-in there is a main pot and one
     or more side pots with different eligible players, and the split display
     only appeared at the RESULT — so the hands people actually save and share
     were the ones this table could not describe. Built from each player's
     total contribution: everyone matches the shortest stack into the main
     pot, the rest match the next, and so on. */
  /* Every layer, including the single-layer case — the award maths needs the
     pot broken up whether or not the display has anything extra to show, and
     it needs WHICH seats are eligible for each, not just how many, because a
     layer is settled among its own contestants. */
  const allPotLayers = useMemo(() => {
    // Built from the EFFECTIVE (called) contributions — the same number the pot
    // total and the bet chips use (computePlayerContrib: blinds and the straddle
    // seed the preflop street, action amounts are increments that ADD), with the
    // uncalled top over-shove already removed. So the caps are right and no layer
    // is contributed to by a single seat that no one could match.
    const contrib = settled.contrib;
    const live = hand.players.map((_, pi) => pi).filter(pi => contrib[pi] > 0);
    if (!live.length) return [];
    const caps = [...new Set(live.filter(pi => allIn.has(pi)).map(pi => contrib[pi]))].sort((a, b) => a - b);
    const layers = [];
    let floor = 0;
    [...caps, Infinity].forEach(cap => {
      const eligible = live.filter(pi => contrib[pi] > floor && !folded.has(pi));
      const amount = chipRound(live.reduce((sum, pi) => sum + Math.max(0, Math.min(contrib[pi], cap) - floor), 0));
      if (amount > 0 && eligible.length) layers.push({ amount, eligible: eligible.length, players: eligible });
      if (cap === Infinity) return;
      floor = cap;
    });
    return layers;
  }, [settled, hand, allIn, folded]);
  // The pot row only has something to say when the pot actually split. Reconcile
  // to the shown total so the MAIN/SIDE pills always sum to it — any dead money
  // (antes, a folded blind the wager layers miss) rides in the main pot, exactly
  // where the award logic puts it.
  const potLayers = useMemo(() => {
    if (allPotLayers.length <= 1) return [];
    const contesting = hand.players.map((_, pi) => pi).filter(pi => !folded.has(pi));
    const reconciled = reconcileLayersToPot(allPotLayers, displayPot, contesting);
    return reconciled.length > 1 ? reconciled : [];
  }, [allPotLayers, displayPot, folded, hand]);
  /* 66: the pot counts toward its new value over the chips' flight. It snaps
     while scrubbing, because a rewind is not a payment. */

  // "Solve this spot" → Solver handoff. Enabled only when the hand's
  // game maps to a solver-supported stud game (Stud 8 / Razz).
  const solverGame = solverGameFor(hand.gameType);
  const canSolveSpot = !SOLVE_SPOT_HIDDEN && !!onSolveSpot && !!solverGame;
  const handleSolveSpot = useCallback(() => {
    if (!canSolveSpot) return;
    haptic();
    onSolveSpot(buildSolverSpot({
      hand, game: solverGame, streetIdx, heroCards, opponentCards, replayHeroIdx, folded, pot,
    }));
  }, [canSolveSpot, onSolveSpot, hand, solverGame, streetIdx, heroCards, opponentCards, replayHeroIdx, folded, pot]);

  // "Study this draw" -> Draw Study handoff, for the fixed-limit draw games the
  // solver has trees for: the hero's draw at the end of the street on screen. The
  // spot says why when it cannot be priced (utils/draw-study-spot.js).
  const drawStudyGame = drawStudyGameFor(hand.gameType);
  // A game this server cannot price says so on the button, never a deployment memo after the tap (App
  // improvements 302).
  const solverAvail = useSolverAvailability();
  const drawGameOffered = !drawStudyGame || offeredGame(solverAvail, drawStudyGame);
  const drawStudySpot = useMemo(() => (onStudyDraw && drawStudyGame
    ? (drawGameOffered ? buildDrawStudySpot({ hand, game: drawStudyGame, streetIdx, heroIdx: replayHeroIdx })
      : { refused: `${hand.gameType} cannot be priced on this server yet.` })
    : null), [onStudyDraw, drawStudyGame, drawGameOffered, hand, streetIdx, replayHeroIdx]);
  const canStudyDraw = !!drawStudySpot && !drawStudySpot.refused;
  const handleStudyDraw = useCallback(() => {
    if (!canStudyDraw) return;
    haptic();
    onStudyDraw(drawStudySpot);
  }, [canStudyDraw, onStudyDraw, drawStudySpot]);

  // Player last action
  const playerLastAction = useMemo(() => {
    const result = {};
    for (let ai = 0; ai <= actionIdx && ai < currentActions.length; ai++) {
      /* 42: the sizing classifier needs the pot BEFORE this action, which
         means it needs the action's index, which this map threw away. */
      result[currentActions[ai].player] = { ...currentActions[ai], _ai: ai };
    }
    return result;
  }, [currentActions, actionIdx]);

  /* A board card with a rank and no suit (utils/board-suit-fills.js): the boards it could be, so the readings and
     the winner come from what holds on every one of them. One board only (a double board's cards are read as they
     were); null when every board card has its suit. */
  const boardFills = useMemo(() => {
    if (!showResult || !feltBoard || boardCount(hand) > 1) return null;
    const known = [heroCards, ...opponentCards].flatMap((t) => (t && t !== 'MUCK' ? parseCardNotation(t) : []));
    return boardSuitFills(parseCardNotation(boardCards), known);
  }, [showResult, feltBoard, hand, heroCards, opponentCards, boardCards]);

  // Eval result -- full evaluation from original
  /* With no winner stored and a suitless board card, the evaluation runs on each board the card allows: one outcome
     on all of them is the result; outcomes that differ leave the showdown undecided (showdownUndecided): no seat
     is marked a winner or a loser, and the result line says which card's suit decides it. */
  const showdown = useMemo(() => {
    const stored = showResult && hand.result && hand.result.winners;
    if (stored && (stored.length || !boardFills)) {
      return { undecided: false, results: hand.result.winners.map(w => {
        const pName = w.playerIdx === replayHeroIdx ? 'Hero' : houseName(hand.players[w.playerIdx]?.name || 'Player');
        let winHandName = '';
        const pCards = w.playerIdx === replayHeroIdx ? heroCards : (opponentCards[w.playerIdx] || '');
        if (pCards && pCards !== 'MUCK') {
          const cfg = gameEvalFor(hand.gameType, hand);
          if (cfg) {
            const parsed = parseCardNotation(pCards).filter(c => c.suit !== 'x');
            const board = feltBoard ? parseCardNotation(boardCards).filter(c => c.suit !== 'x') : [];
            let ev = null;
            if (cfg.type === 'halves') { const s = scoreHalves(cfg, parsed, board); ev = s.hiEv || s.loEv; }
            if (cfg.type === 'high' || cfg.type === 'hilo') ev = bestHighFor(cfg, parsed, board);
            else if (cfg.type === 'low') ev = bestLowFor(cfg, parsed.concat(board));
            else if (cfg.type === 'badugi') ev = bestBadugiHand(parsed);
            if (ev) winHandName = ev.name;
          }
        }
        const label = w.label || (pName + ' wins' + (winHandName ? ', ' + winHandName : ''));
        return {
          index: w.playerIdx,
          result: {
            outcome: w.playerIdx === replayHeroIdx ? 'hero' : (w.split ? 'split' : 'opponent'),
            text: label,
            color: w.split ? 'yellow' : (w.playerIdx === replayHeroIdx ? 'green' : 'red'),
          },
        };
      }) };
    }
    if (!showResult || !gameEval) return { undecided: false, results: null };
    // Full auto-evaluation
    const autoEval = (bCards) => {
      const hCards = parseCardNotation(heroCards);
      if (gameCfg.hasBoard && bCards.length < 3) return null;
      if (hCards.length < (gameCfg.isStud ? 5 : finalCards)) return null;
      const boardSuits = new Set(bCards.map(c => c.suit));
      const usedKeys = bCards.map(c => c.rank + c.suit);
      let hEval = gameCfg.isStud ? hCards.filter(c => c.suit !== 'x') : assignNeutralSuits(hCards, usedKeys, boardSuits);
      hEval.forEach(c => { if (c.suit !== 'x') usedKeys.push(c.rank + c.suit); });
      const results = [];
      for (let pi = 0; pi < opponentCards.length; pi++) {
        if (pi === replayHeroIdx) continue;
        if (folded.has(pi)) continue;
        if (!opponentCards[pi]) continue;
        const oRaw = parseCardNotation(opponentCards[pi]);
        if (oRaw.length < (gameCfg.isStud ? 5 : finalCards)) continue;
        const oEval = gameCfg.isStud ? oRaw.filter(c => c.suit !== 'x') : assignNeutralSuits(oRaw, usedKeys, boardSuits);
        const ev = evaluateHand(hand.gameType, hEval, oEval, bCards, hand);
        if (ev && ev.result) results.push({ index: pi, ...ev });
        oEval.forEach(c => { if (c.suit !== 'x') usedKeys.push(c.rank + c.suit); });
      }
      return results.length ? results : null;
    };
    if (!boardFills) return { undecided: false, results: autoEval(feltBoard ? parseCardNotation(boardCards) : []) };
    const all = boardFills.map(autoEval);
    const outcome = (r) => (r || []).map(x => x.index + ':' + x.result.outcome).join(',');
    if (all.every(r => outcome(r) === outcome(all[0]))) return { undecided: false, results: all[0] };
    return { undecided: all.some(r => r), results: null };
  }, [showResult, hand, heroCards, opponentCards, boardCards, gameCfg, gameEval, folded, replayHeroIdx, category, boardFills]);
  const evalResult = showdown.results;
  const showdownUndecided = showdown.undecided;

  /* 26: calcShowdownEquity and a finished bar-plus-percentage style were
     both dead code, so at an all-in showdown the felt said nothing about who
     was ahead — the single question a viewer has at that moment. */
  /* 90: the bar rendered when showResult was true, which is after the hand
     has been decided — a scoreboard shown after the whistle. The moment a
     viewer wants a percentage is when the money goes IN, and then again as
     each card lands. It runs from the point the last live player is committed. */
  /* All in and called, the board to come: two or more live, one at least all in, at most one with chips behind, and no
     action left in the hand from here (exposeAllIn's test, in cash too). It had counted only a table where EVERY live
     seat was all in, so a caller with chips behind (most all-ins) never showed a figure until the result. */
  const runout = useMemo(() => {
    const live = hand.players.map((_, i) => i).filter(i => !folded.has(i));
    if (live.length < 2 || !live.some(i => allIn.has(i)) || live.filter(i => !allIn.has(i)).length > 1) return false;
    for (let si = streetIdx; si < hand.streets.length; si++) {
      const acts = hand.streets[si].actions || [];
      if (acts.length > (si === streetIdx ? actionIdx + 1 : 0)) return false;
    }
    return true;
  }, [hand, folded, allIn, streetIdx, actionIdx]);
  /* The figure is each hand's real chance of the pot (owner, 2026-11-21: "This is a mess"): computeOdds (utils/odds.js, the
     Study odds tool's), every run-out from the flop on and a sample before it, on its worker so a step never waits for it.
     It was each hand's evaluator score over the sum of them, so a wheel that had lost to a flush read 39%. Only while
     cards are to come in an all-in with every hand known, on one board, in a game the odds tool plays (not draw games). */
  const equityAsk = useMemo(() => {
    if (!rSettings.showEquity || showResult || !runout || boardCount(hand) > 1) return null;
    const game = oddsGameFor(hand.gameType);
    // Board games only: a stud seat's cards here are not yet every card it holds, which the odds tool needs.
    if (!game || (ODDS_GAMES.find(x => x[0] === game) || [])[3] !== 'board') return null;
    const seats = hand.players.map((_, pi) => pi).filter(pi => !folded.has(pi));
    if (seats.length < 2) return null;
    const hands = seats.map(pi => (pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '')));
    if (hands.some(h => !h || h === 'MUCK' || parseCardNotation(h).some(c => c.suit === 'x'))) return null;
    if (parseCardNotation(boardCards).filter(c => c.suit !== 'x').length >= 5) return null;
    return { game, seats, hands, board: boardCards, key: [game, hands.join(','), boardCards].join('|') };
  }, [rSettings.showEquity, showResult, runout, hand, folded, replayHeroIdx, heroCards, opponentCards, boardCards]);
  const [equityRes, setEquityRes] = useState(null);
  const equityKey = equityAsk ? equityAsk.key : '';
  useEffect(() => {
    if (!equityAsk) return undefined;
    let worker = null, gone = false;
    try { worker = new Worker(new URL('../utils/odds-worker.js', import.meta.url), { type: 'module' }); } catch { return undefined; }
    worker.onmessage = (e) => {
      const r = e.data && e.data.result;
      if (!gone && r && Array.isArray(r.players)) setEquityRes({ key: equityAsk.key, seats: equityAsk.seats, pct: r.players.map(p => Math.round(p.equity * 100)) });
      worker.terminate();
    };
    worker.postMessage({ id: 1, game: equityAsk.game, hands: equityAsk.hands, board: equityAsk.board });
    return () => { gone = true; worker.terminate(); };
  }, [equityKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const showdownEquity = equityAsk && equityRes && equityRes.key === equityAsk.key
    ? Object.fromEntries(equityRes.seats.map((s, i) => [s, equityRes.pct[i]])) : null;
  /* A seat's equity as a figure in its readout, so the readout's placement keeps it off the plaque and everything else
     (it was a bar and a percentage pinned half an r above the seat's foot, across a bottom seat's plaque). */
  const seatEquity = (pi) => (showdownEquity && !showResult && showdownEquity[pi] != null && !folded.has(pi) ? showdownEquity[pi] : null);

  /* Which half (or halves) each stored winner took. Hands saved before the
     evaluator recorded hi/lo flags only carry it in the label text, which is
     where the split display and the hi-lo animation were already reading it
     from — so the flags win where they exist and the label still answers for
     everything already in the database. */
  const flaggedWinners = useMemo(() => (hand.result?.winners || []).map(w => {
    if (typeof w.hi === 'boolean' || typeof w.lo === 'boolean') return { ...w, hi: !!w.hi, lo: !!w.lo };
    const label = w.label || '';
    if (/Hi:/.test(label) || /Lo:/.test(label)) return { ...w, hi: /Hi:/.test(label), lo: /Lo:/.test(label) };
    return { ...w, hi: false, lo: false };
  }), [hand]);

  /* Which halves each seat actually WON.
     The plaque put "Hi:" in front of every shown player's best high hand, so a
     wheel that lost to a 6-high straight was captioned exactly like the hand
     that beat it — two winning highs on one table, when the 6-high straight is
     the only winning high there is. The awards were right all along; it was the
     caption claiming something the awards never said.
     Read from the cards where they are all known, the same authority potAwards
     prefers, and fall back to the stored Hi/Lo flags when somebody mucked. */
  const hiLoHalves = useMemo(() => {
    const cfg = gameEvalFor(hand.gameType, hand);
    if (!showResult || !cfg || (cfg.type !== 'hilo' && cfg.type !== 'halves')) return null;
    const contesting = hand.players.map((_, pi) => pi).filter(pi => !folded.has(pi));
    const board = feltBoard ? parseCardNotation(boardCards).filter(c => c.suit !== 'x') : [];
    const map = {};
    let readable = true;
    contesting.forEach(pi => {
      const raw = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
      const parsed = raw && raw !== 'MUCK' ? parseCardNotation(raw).filter(c => c.suit !== 'x') : [];
      if (parsed.length < (gameCfg.isStud ? 5 : finalCards)) { readable = false; return; }
      if (cfg.type === 'halves') { map[pi] = scoreHalves(cfg, parsed, board); return; }
      const hi = bestHighFor(cfg, parsed, board);
      const lo = bestLow8For(cfg, parsed, board);
      map[pi] = { hi: hi ? hi.score : null, lo: lo && lo.qualified ? lo.score : null };
    });
    if (readable && Object.keys(map).length) {
      const w = hiLoWinnersAmong(map, contesting);
      return { hi: new Set(w.hiWinners), lo: new Set(w.loWinners) };
    }
    const hiSet = new Set(), loSet = new Set();
    flaggedWinners.forEach(w => { if (w.hi) hiSet.add(w.playerIdx); if (w.lo) loSet.add(w.playerIdx); });
    return { hi: hiSet, lo: loSet };
  }, [showResult, hand, folded, boardCards, heroCards, opponentCards, replayHeroIdx, category, gameCfg, flaggedWinners]);

  /* A share link says who won, never which half (hand-shorthand's "w1,0s"), so a hi-lo pot opened from
     one read "Split pot, 2x 1/2" and its winners rose together. The cards still say: every link already
     sent is put right here, and no link changes for an app build that reads them. */
  const halvedWinners = useMemo(() => flaggedWinners.map(w => (
    (w.hi || w.lo || !hiLoHalves) ? w : { ...w, hi: hiLoHalves.hi.has(w.playerIdx), lo: hiLoHalves.lo.has(w.playerIdx) }
  )), [flaggedWinners, hiLoHalves]);

  /* What each winner is actually PAID.

     94: the split display divided the pot by the NUMBER of split winners. A
     hi-lo pot does not divide by winners, it divides into halves and each half
     divides among the players tied for it — so one high winner and two tied
     lows showed three equal thirds where the table pays a half and two
     quarters. Getting quartered is the hi-lo event people save a hand to show,
     and it was the one the replayer could not draw.

     Each pot layer is settled on its own, because a side pot's high can belong
     to a player the main pot's winner is not even up against. The cards decide
     it where they are known and agree with the stored result; a hand-marked
     winner, or a mucked one, falls back to the stored entries' Hi/Lo flags.
     utils/hand-history/settle.js mirrors this for the hand-history export. */
  const potAwards = useMemo(() => {
    if (!showResult) return null;
    const winners = flaggedWinners;
    if (!winners.length) return null;
    const contesting = hand.players.map((_, pi) => pi).filter(pi => !folded.has(pi));
    const layers = reconcileLayersToPot(allPotLayers, settled.contested, contesting);
    const cfg = gameEvalFor(hand.gameType, hand);

    /* Each pot layer is decided among ITS OWN eligible players, from the cards.
       A side pot is won by the best hand of the seats in for it — which is not
       always the seat that won the whole hand — and a side pot only one seat is
       eligible for is that seat's regardless of what it holds. Filtering the
       overall winners into layers got both wrong: a top side pot whose only
       contestant did not have the best hand was awarded to NOBODY (the chips
       left the game), and once the layers over-counted the pot and collapsed, it
       was swept whole to the overall winner. Scores map seat -> { hi, lo } in
       the form hiLoWinnersAmong reads (best-high wins hi, best-low wins lo). */
    const board = feltBoard ? parseCardNotation(boardCards).filter(c => c.suit !== 'x') : [];
    const scoreHand = (parsed) => {
      if (!cfg) return null;
      if (cfg.type === 'halves') return scoreHalves(cfg, parsed, board);
      const all = parsed.concat(board);
      if (cfg.type === 'high') {
        const hi = bestHighFor(cfg, parsed, board);
        return { hi: hi ? hi.score : null, lo: null };
      }
      if (cfg.type === 'hilo') {
        const hi = bestHighFor(cfg, parsed, board);
        const lo = bestLow8For(cfg, parsed, board);
        return { hi: hi ? hi.score : null, lo: lo && lo.qualified ? lo.score : null };
      }
      if (cfg.type === 'low') {
        const lo = bestLowFor(cfg, all);
        return { hi: null, lo: lo ? lo.score : null };
      }
      if (cfg.type === 'badugi') {
        const bad = bestBadugiHand(parsed);
        return { hi: null, lo: bad ? bad.score : null };
      }
      return null; // split-badugi / unmapped — fall back to the stored winners
    };

    const scores = {};
    const parsedBy = {};
    /* A play-money table's hand (hand.table): one mucked at the showdown gives up its claim (TDA), as the export settles
       it (hand-history/prepare.js), and the pot goes by the cards among the rest. 'MUCK' in any of the seat's slots (stud
       keeps the door and marks 7th). Only the tables' hands, until the app moves onto the shared rules after launch. */
    const muckedSeats = hand.table ? new Set(contesting.filter(pi => pi !== replayHeroIdx && hand.streets.some(s =>
      ((s.cards && s.cards.opponents) || [])[pi > replayHeroIdx ? pi - 1 : pi] === 'MUCK'))) : new Set();
    const contenders = muckedSeats.size && muckedSeats.size < contesting.length ? contesting.filter(pi => !muckedSeats.has(pi)) : contesting;
    let readable = !!cfg && cfg.type !== 'split-badugi';
    if (readable) {
      contenders.forEach(pi => {
        if (!readable) return;
        const raw = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
        const parsed = raw && raw !== 'MUCK' ? parseCardNotation(raw).filter(c => c.suit !== 'x') : [];
        if (parsed.length < (gameCfg.isStud ? 5 : finalCards)) { readable = false; return; }
        const s = scoreHand(parsed);
        // A hand of two halves can qualify for neither (Archie) and still be read.
        if (!s || (s.hi == null && s.lo == null && cfg.type !== 'halves')) { readable = false; return; }
        scores[pi] = s;
        parsedBy[pi] = parsed;
      });
    }

    let shaped;
    // Several boards (double board; run it twice or three times): each pot layer settled over every
    // board by utils/poker-engine.js (a share per board or run; a hi-lo double board's one ultimate
    // high and low), from the cards when everyone still in shows.
    if (category === 'community' && boardCount(hand) > 1 && cfg && cfg.type !== 'split-badugi') {
      const bySeat = {};
      let ok = true;
      contesting.forEach(pi => {
        const raw = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
        const parsed = raw && raw !== 'MUCK' ? parseCardNotation(raw).filter(c => c.suit !== 'x') : [];
        if (parsed.length < finalCards) ok = false; else bySeat[pi] = parsed;
      });
      if (ok) {
        const boards = handBoards(hand, streetIdx).map(b => parseCardNotation(b).filter(c => c.suit !== 'x'));
        shaped = multiBoardShaped(cfg, layers, multiBoardEvals(cfg, bySeat, boards), contesting, combinesHiLo(hand));
      }
    }
    if (shaped) {
      // settled above
    } else if (readable && Object.keys(scores).length === contenders.length) {
      // Cards shown for everyone still in: they are the authority, per layer.
      shaped = layers.map(l => ({ amount: l.amount, ...(cfg.type === 'halves' ? halvesWinnersAmong(cfg, scores, l.players || contesting) : hiLoWinnersAmong(scores, l.players || contesting)) }));
    } else {
      // Mucked or unscorable: settle from the stored winners, but hand a layer
      // no stored winner is eligible for back to its own eligible seats rather
      // than letting those chips vanish.
      shaped = potLayerWinners(layers, winners).map((s, i) => (
        (!s.hiWinners.length && !s.loWinners.length)
          ? { ...s, hiWinners: (layers[i].players || contesting) }
          : s
      ));
    }

    const btnIdx = hand.players.findIndex(p => p.position === 'BTN' || p.position === 'BTN/SB');
    let oddChipped = shaped.map(s => ({ ...s, oddToLo: oddChipToLo(cfg, scores, s.hiWinners || [], s.loWinners || []) }));
    /* Stud has no button: a tie's odd chip goes to the high card by suit in the best five-card hand for
       that half (TDA; studOddChipKey), from the cards when everyone still in shows them. */
    const studKinds = gameCfg.isStud && cfg && readable && Object.keys(parsedBy).length === contenders.length
      ? (cfg.type === 'high' ? ['high', null] : cfg.type === 'hilo' ? ['high', cfg.anyLow ? 'a5' : 'a5-8']
        : cfg.type === 'low' ? [null, cfg.lowType === '27' ? '27' : 'a5'] : null)
      : null;
    if (studKinds) {
      const keys = studKinds.map(kind => (kind ? Object.fromEntries(contenders.map(pi => [pi, studOddChipKey(parsedBy[pi], kind)])) : null));
      oddChipped = oddChipped.map(s => ({
        ...s,
        ...(keys[0] ? { hiOrder: studOddChipOrder(s.hiWinners || [], keys[0]) } : {}),
        ...(keys[1] ? { loOrder: studOddChipOrder(s.loWinners || [], keys[1]) } : {}),
      }));
    }
    /* computePotAwards splits whole units, and a cash pot of $128.50 went in as dollars: it was rounded to
       $129, and the winner was paid 50 cents nobody put in (2026-11-09). Settle in hundredths, as the export
       does (hand-history/prepare.js unitCents): a cash pot splits to the cent, as a PokerStars history does,
       and tournament chips stay whole whenever every layer is whole. */
    const inCents = oddChipped.map(s => ({ ...s, amount: Math.round((s.amount || 0) * 100) }));
    const chipUnit = hand.gameMode !== 'cash' && inCents.every(s => s.amount % 100 === 0) ? 100 : 1;
    const { awards: units } = computePotAwards(inCents.map(s => ({ ...s, amount: s.amount / chipUnit })),
      { order: seatOrderFromButton(hand.players.length, btnIdx) });
    const awards = {};
    Object.keys(units).forEach(k => { awards[k] = units[k] * chipUnit / 100; });
    /* What each pot and each half pays each seat, for the ship (Replayer animations 40-45): one part per pot
       layer, per half, per seat, with the share every winner of that half gets (`base`) so the odd chips can go
       last. Non-enumerable: every reader of the awards sees the same seat -> amount object as before. */
    const parts = [];
    const order0 = seatOrderFromButton(hand.players.length, btnIdx);
    inCents.forEach((sh, li) => {
      const amount = Math.max(0, Math.round((sh.amount || 0) / chipUnit));
      const hi = sh.hiWinners || [], lo = sh.loWinners || [];
      if (!amount || (!hi.length && !lo.length)) return;
      const halves = !lo.length ? [['all', amount, hi, sh.hiOrder]] : !hi.length ? [['all', amount, lo, sh.loOrder]]
        : (() => { const hiHalf = sh.oddToLo ? Math.floor(amount / 2) : amount - Math.floor(amount / 2); return [['hi', hiHalf, hi, sh.hiOrder], ['lo', amount - hiHalf, lo, sh.loOrder]]; })();
      halves.forEach(([half, amt, ws, ord]) => {
        const { awards: u } = computePotAwards([{ amount: amt, hiWinners: ws, ...(ord ? { hiOrder: ord } : {}) }], { order: order0 });
        const base = Math.floor(amt / ws.length);
        Object.keys(u).forEach(seat => parts.push({ layer: li, half, seat: Number(seat), amount: u[seat] * chipUnit / 100, base: base * chipUnit / 100, n: ws.length }));
      });
    });
    Object.defineProperty(awards, 'parts', { value: parts, enumerable: false });
    return awards;
  }, [showResult, flaggedWinners, hand, allPotLayers, settled, folded, category, boardCards,
      heroCards, opponentCards, replayHeroIdx, gameCfg, streetIdx]);
  /* Which half each seat was PAID, read from what every pot paid it (owner, 2026-11-14: "this evaluation of the
     winning hands is very weird"). hiLoHalves reads the whole field as one pot, so with an all-in the side pot's
     winners went unnamed: a flush taking the side pot's high read "Flush, 10-high" with no "Hi:", beside "Hi: Ks
     full of Js" for the all-in player who took the main pot's. `side` is a seat paid only from side pots. */
  const wonHalves = useMemo(() => {
    const parts = potAwards && potAwards.parts;
    if (!parts || !parts.length) return hiLoHalves;
    const hi = new Set(), lo = new Set(), mainOf = new Set(), paid = new Set();
    parts.forEach(p => {
      if (!(p.amount > 0)) return;
      (p.half === 'lo' ? lo : hi).add(p.seat);
      paid.add(p.seat);
      if (p.layer === 0) mainOf.add(p.seat);
    });
    const layers = new Set(parts.map(p => p.layer));
    const side = new Set(layers.size > 1 ? [...paid].filter(s => !mainOf.has(s)) : []);
    return { hi, lo, side };
  }, [potAwards, hiLoHalves]);
  /* A special showdown the hero won (utils/showdown-specials.js; owner, 2026-11-22: "only when hero wins"): a flush
     floods the cloth with its suit, played by the result moment (playSuitFlood). */
  const showdownSpecialNow = useMemo(() => (springOn && showResult && potAwards ? showdownSpecial({
    cfg: gameEvalFor(hand.gameType, hand), hero: parseCardNotation(heroCards),
    others: hand.players.map((_, pi) => pi).filter(pi => pi !== replayHeroIdx && !folded.has(pi))
      .map(pi => parseCardNotation(opponentCards[pi] === 'MUCK' ? '' : (opponentCards[pi] || ''))),
    board: feltBoard ? parseCardNotation(boardCards) : [], heroPaid: (potAwards[replayHeroIdx] || 0) > 0,
  }) : null), [springOn, showResult, potAwards, hand, heroCards, opponentCards, folded, feltBoard, boardCards, replayHeroIdx]);
  useEffect(() => { if (springOn) warmSuitFlood(); }, [springOn]);

  /* The plaque shows what a player HAS, and calcPotsAndStacks only ever
     subtracts: it takes every wager out and never puts a pot back, so at
     showdown the winner's plaque read the stack they were left with after
     paying IN — the one moment in the hand when that is the wrong number.
     The chips in front of them said 48,540 and the plaque above said what
     they had before winning it.
     Display only. `stacks` stays the betting truth that potAwards, the
     commentary and the export are all computed from; this is the same array
     with the award added, and it is what the seat renders. An all-in player
     who wins is no longer marked ALL-IN either, because they are not: the
     mark reads this array too. The seat shows the new total directly (the
     count-up animation was removed 2026-09-30). */
  const shownStacks = useMemo(() => (
    (showResult && potAwards) ? stacks.map((v, i) => v + (potAwards[i] || 0) + (settled.uncalled[i] || 0)) : stacks
  ), [showResult, potAwards, stacks, settled]);

  /* ── The cards' standing poses (Replayer animations, 2026-11-11) ──
     Which cards play, shown in the cards: a tabled run-out's leader sits raised (16); the hero's counterfeited
     hole cards sink and dim (18); at the result the winner's five lift and its other cards sink and dim (20), a
     hi-lo pot's cards move to the half they play for (21), a badugi's dead card sinks (22), and the card two lows
     part on lifts in both hands (23). A pose is a state: the card's own style (data-pose, the translate property),
     so it holds at rest, in an export and under reduced motion; the moments effect springs a card into it on a
     step forward. Springs only (flag '0' keeps today's table), one board only. */
  const cardPoses = useMemo(() => {
    if (!springSet) return null;
    const cfg = gameEvalFor(hand.gameType, hand);
    if (!cfg || boardCount(hand) > 1) return null;
    const board = feltBoard ? parseCardNotation(boardCards).filter(c => c.suit !== 'x') : [];
    const cardsOf = (pi) => {
      const raw = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
      if (!raw || raw === 'MUCK') return [];
      return parseCardNotation(raw).filter(c => c.suit !== 'x');
    };
    const seatsP = new Map(), boardP = new Map();
    const put = (pi, c, pose) => { let m = seatsP.get(pi); if (!m) seatsP.set(pi, m = new Map()); m.set(c.rank + c.suit, pose); };
    const live = hand.players.map((_, pi) => pi).filter(pi => !folded.has(pi));
    const halves = halvesOf(cfg);
    // 18: the hero's hole cards counterfeited on this board (hold'em-style high games), until the hero wins.
    const heroWon = showResult && potAwards && (potAwards[replayHeroIdx] || 0) > 0;
    if (category === 'community' && board.length >= 4 && !folded.has(replayHeroIdx) && !heroWon) {
      const hole = cardsOf(replayHeroIdx);
      counterfeitedNow(cfg, hole, board, board.length).forEach(i => put(replayHeroIdx, hole[i], 'dead'));
    }
    if (!showResult) {
      // 16: the tabled hand in front sits raised.
      if (SHOWDOWN_SLIDES && exposeAllIn && cfg.type === 'high') {
        const hands = live.map(pi => ({ seat: pi, cards: cardsOf(pi) })).filter(h => h.cards.length >= 2);
        if (hands.length === live.length) {
          const lead = leaderOf(cfg, hands, board);
          if (lead >= 0) hands.find(h => h.seat === lead).cards.forEach(c => put(lead, c, 'up'));
        }
      }
      return seatsP.size || boardP.size ? { seats: seatsP, board: boardP } : null;
    }
    // No cards slide at the showdown for now (owner, 2026-11-15: "we can get rid of card sliding motions at showdown for
    // now"): the result's poses below (the playing cards up, a hi-lo's halves, the winning five) wait behind this switch.
    if (!SHOWDOWN_SLIDES) return seatsP.size ? { seats: seatsP, board: boardP } : null;
    if (!potAwards) return seatsP.size ? { seats: seatsP, board: boardP } : null;
    const winners = live.filter(pi => (potAwards[pi] || 0) > 0 && cardsOf(pi).length >= 2);
    if (cfg.type === 'hilo' && wonHalves) {
      /* 21: every card that plays slides up (owner, 2026-11-13: "the relevant cards in a player's hand should always slide up,
         high or low" and "both parts of the board sliding up"): the high's first ('up'), then the low's own ('up-lo', which
         rests where 'up' does but moves in the second beat). A card in both hands goes up with the high. */
      const hiB = new Set(), loB = new Set();
      winners.forEach(pi => {
        const hole = cardsOf(pi);
        const hi = wonHalves.hi.has(pi) ? bestFive(cfg, hole, board, 'high') : null;
        const lo = wonHalves.lo.has(pi) ? bestFive(cfg, hole, board, halves[1]) : null;
        const hiH = new Set(hi ? hi.hole : []), loH = new Set(lo ? lo.hole : []);
        hole.forEach((c, i) => {
          if (hiH.has(i)) put(pi, c, 'up');
          else if (loH.has(i)) put(pi, c, 'up-lo');
        });
        (hi ? hi.board : []).forEach(i => hiB.add(i));
        (lo ? lo.board : []).forEach(i => loB.add(i));
      });
      board.forEach((c, i) => {
        if (hiB.has(i)) boardP.set(c.rank + c.suit, 'up');
        else if (loB.has(i)) boardP.set(c.rank + c.suit, 'up-lo');
      });
    } else if (cfg.type === 'badugi') {
      // 22: every shown hand's card that cannot count.
      live.forEach(pi => {
        const hole = cardsOf(pi);
        if (hole.length < 2) return;
        const r = bestFive(cfg, hole, [], 'badugi');
        if (!r || r.hole.length >= hole.length) return;
        const keep = new Set(r.hole);
        hole.forEach((c, i) => { if (!keep.has(i)) put(pi, c, 'dead'); });
      });
    } else if (cfg.type === 'high' || cfg.type === 'low') {
      const kind = halves[0];
      const reads = new Map();
      live.forEach(pi => { const hole = cardsOf(pi); if (hole.length >= 2) reads.set(pi, { hole, r: bestFive(cfg, hole, board, kind) }); });
      const more = (pi) => cardsOf(pi).length + board.length > 5;
      // 20: the winner's five lift, its other cards sink and dim (more than five cards between hand and board).
      winners.forEach(pi => {
        const rd = reads.get(pi);
        if (!rd || !rd.r || !more(pi)) return;
        const play = new Set(rd.r.hole);
        rd.hole.forEach((c, i) => put(pi, c, play.has(i) ? 'up' : 'dead'));
        rd.r.board.forEach(i => boardP.set(board[i].rank + board[i].suit, 'up'));
      });
      // 23: two lows of five: the rank they part on lifts in both hands.
      if (cfg.type === 'low' && winners.length === 1 && !more(winners[0])) {
        const w = winners[0];
        const others = [...reads.entries()].filter(([pi, x]) => pi !== w && x.r)
          .sort((a, b) => (kind === 'low27' ? a[1].r.ev.score - b[1].r.ev.score : a[1].r.ev.score - b[1].r.ev.score));
        const W = reads.get(w);
        if (W && W.r && others.length) {
          const [lp, L] = others[0];
          const five = (x) => x.r.hole.map(i => x.hole[i]);
          const d = lowDecider(kind, { ev: W.r.ev, cards: five(W) }, { ev: L.r.ev, cards: five(L) });
          if (d) {
            const wi = indexOfLowRank(kind, W.hole, W.r.hole, d.a), li = indexOfLowRank(kind, L.hole, L.r.hole, d.b);
            if (wi >= 0) put(w, W.hole[wi], 'up');
            if (li >= 0) put(lp, L.hole[li], 'up');
          }
        }
      }
    }
    return seatsP.size || boardP.size ? { seats: seatsP, board: boardP } : null;
  }, [springSet, hand, feltBoard, boardCards, replayHeroIdx, heroCards, opponentCards, folded, showResult, potAwards, wonHalves, exposeAllIn, category]);
  /* Stud at showdown (owner, 2026-11-14: "ignore which were the up and down cards and just push up the five cards
     that play. The rest should be in normal downcard position"): per shown hand, the cards of its best five (in hi-lo,
     its high five, plus its low five where it takes the low), by card. CardRow lifts those as up cards and sits every
     other card where a down card sits. */
  const studPlay = useMemo(() => {
    if (!gameCfg.isStud || !showResult) return null;
    const cfg = gameEvalFor(hand.gameType, hand);
    if (!cfg) return null;
    const halves = halvesOf(cfg);
    const out = new Map();
    hand.players.forEach((_, pi) => {
      if (folded.has(pi)) return;
      const raw = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
      if (!raw || raw === 'MUCK') return;
      const hole = parseCardNotation(raw).filter(c => c.suit !== 'x');
      if (hole.length <= 5) return;
      const ids = new Set();
      const add = (r) => { if (r) r.hole.forEach(i => ids.add(hole[i].rank + hole[i].suit)); };
      if (cfg.type === 'hilo') {
        // The half the seat took: the low alone for a low-only winner, both for a scoop, else the high.
        const lo = !!(wonHalves && wonHalves.lo && wonHalves.lo.has(pi));
        const hi = !!(wonHalves && wonHalves.hi && wonHalves.hi.has(pi));
        if (hi || !lo) add(bestFive(cfg, hole, [], 'high'));
        if (lo) add(bestFive(cfg, hole, [], halves[1]));
      } else if (halves[0]) add(bestFive(cfg, hole, [], halves[0]));
      if (ids.size) out.set(pi, ids);
    });
    return out.size ? out : null;
  }, [gameCfg, showResult, hand, folded, replayHeroIdx, heroCards, opponentCards, wonHalves]);

  /* ── Spring moments: what this render is ──
     A moment plays only on a single step FORWARD from the step the last commit showed (Forward,
     autoplay, an export's step); a jump, a step back or a hand change finishes whatever is running
     and shows the end state. Computed in render so the press frame itself is right: the pot shows
     its total BEFORE the swept wagers land (the model's pot minus every wager still in flight), and
     a winner's stack shows what it had before the pot arrives. Each arrival then writes the digits
     straight into the DOM (no re-render mid-moment), and one render after the last puts React's
     value back in step. */
  /* 14: all in with nothing left to decide. Every live player but at most one is all in and no later street
     records an action, so one press runs the board out to the river (Back still steps a street at a time). One
     board, springs on, the board's animation on. */
  const laterEmpty = (s) => { for (let si = s + 1; si < totalStreets; si++) if ((hand.streets[si]?.actions || []).length) return false; return true; };
  const liveSeats = hand.players.map((_, i) => i).filter(i => !folded.has(i));
  const decidedNow = liveSeats.length >= 2 && liveSeats.some(i => allIn.has(i)) && liveSeats.filter(i => !allIn.has(i)).length <= 1;
  const runOutTo = (p) => ((springOn && rSettings.animateBoard && feltBoard && boardCount(hand) <= 1 && decidedNow && p && !p.r
    && p.a === (hand.streets[p.s]?.actions || []).length - 1 && p.s < totalStreets - 2 && laterEmpty(p.s)) ? totalStreets - 1 : -1);

  const stepNow = { s: streetIdx, a: actionIdx, r: showResult };
  const stepPrev = committedStepRef.current;
  const stepChanged = !stepPrev || stepPrev.s !== stepNow.s || stepPrev.a !== stepNow.a || stepPrev.r !== stepNow.r;
  const stepAfter = (p) => {
    if (!p || p.r) return null;
    const ro = runOutTo(p);
    if (ro >= 0) return { s: ro, a: -1, r: false };
    const n = (hand.streets[p.s]?.actions || []).length;
    if (p.a < n - 1) return { s: p.s, a: p.a + 1, r: false };
    if (p.s < totalStreets - 1) return { s: p.s + 1, a: -1, r: false };
    return { s: p.s, a: p.a, r: true };
  };
  const stepNext = stepChanged ? stepAfter(stepPrev) : null;
  const motionKind = (springOn && stepNext && stepNext.s === stepNow.s && stepNext.a === stepNow.a && stepNext.r === stepNow.r)
    ? (stepNow.r ? 'result' : stepNow.a < 0 ? 'street' : 'action') : null;
  const motionJumped = stepChanged && !motionKind;
  /* 10: the step that deals the hero's draw: the new cards land in the gaps the thrown cards left and sit there two
     beats before the hand sorts, so the row's own re-sort waits that long. */
  const heroDrawHold = (() => {
    if (motionKind !== 'street' || !isDrawGame || !rSettings.animateDeal || streetIdx < 1) return 0;
    const d = (hand.streets[streetIdx - 1]?.draws || []).find(x => x.player === replayHeroIdx);
    if (!d || !(d.discarded > 0)) return 0;
    const r = motion.capture ? motion.captureRate : (playing ? rateFor(speed) : 1) * REPLAYER_PACE;
    return Math.round((cardTimes(springSet).handArrive + 2 * SPRING_SETS[springSet].stage.beat) / r);
  })();
  /* The showdown's reveal of the other hands, on the spring path: decided by the render that steps
     forward into the result and kept while the result stays (revealRef, from the commit). Set from
     an effect, as flag '0' does, it was a second render of the whole replayer inside the result's
     press task, and the press frame drew the cards bare before their reveal took them away again.
     A jump to the result shows them, as every jump shows the end state. Not under an export: the
     capture pauses CSS animations, which would hold the reveal at its first, transparent frame. */
  const springReveal = springOn && showResult && rSettings.animateDeal && !motion.capture
    && (motionKind === 'result' || (!stepChanged && revealRef.current));
  const showdownOn = springOn ? springReveal : animShowdown;
  /* The wagers that were on the felt at the step before a street press — the same rule the bet
     chips render by (a seat whose latest action carried an amount shows its street total) — in the
     order the dealer collects them, the street's action order. Only those whose element the last
     commit actually drew. */
  /* The result press collects first: the river's wagers go into the pot as a street press's do,
     and the pot leaves for the winner once they have landed. */
  const sweepPlan = ((motionKind === 'street' || motionKind === 'result') && rSettings.animateChips) ? (() => {
    const acts = hand.streets[stepPrev.s]?.actions || [];
    const out = [];
    hand.players.forEach((_, pi) => {
      let last = null, first = -1;
      for (let ai = 0; ai <= stepPrev.a && ai < acts.length; ai++) {
        if (acts[ai].player === pi) { last = acts[ai]; if (first < 0) first = ai; }
      }
      /* A posted blind stands on the felt as a wager (Replayer animations 26), so a big blind that checked still
         has its blind out: under springs a wager is whatever the seat has in on the street, as drawn. */
      const amt = computePlayerContrib(hand, stepPrev.s, acts, stepPrev.a, pi);
      if (springSet && stepPrev.s === 0) { if (!(amt > 0) || !prevWagersRef.current.has(pi)) return; }
      else if (!last || !last.amount || !prevWagersRef.current.has(pi)) return;
      out.push({ seat: pi, order: first, amount: amt });
    });
    /* At the result an over-call's uncalled excess goes back to its seat, not into the pot: each
       ghost carries its wager less what the showdown hands that seat back (the model's own figure,
       over the whole hand). Capped at the street's second-largest wager instead, the 8-max hand's
       5,000 from preflop stayed in a ghost and the pot read 122K, 117K, 157K, 197K. */
    const swept = motionKind === 'result' ? collectAtResult(out, settled.uncalled) : out;
    return swept.sort((a, b) => a.order - b.order);
  })() : null;
  /* The pot shipped to each seat it pays, at the result: what that seat's stack gains (the model's
     final figure less what it showed before the press, which never reads below 0 — a shorthand can
     commit more than a stack holds, and the plaque read -7,000 at the climax). */
  /* 35: a bet nobody called goes back to its bettor before the pot ships, from where it stood: it is not part of
     what the pot pays that seat, and the stack takes it as it lands. */
  const uncalledBack = (motionKind === 'result' && rSettings.animateChips)
    ? hand.players.map((_, pi) => ((settled.uncalled[pi] || 0) > 0 && prevWagersRef.current.has(pi) ? settled.uncalled[pi] : 0)) : null;
  const uncalledDelay = uncalledBack && uncalledBack.some(v => v > 0)
    ? (timeTo(tierSpring(springSet, 'hand'), 0.98) + SPRING_SETS[springSet].stage.beat) / (motion.capture ? motion.captureRate : (playing ? rateFor(speed) : 1) * REPLAYER_PACE) : 0;
  const shipPlan = (motionKind === 'result' && rSettings.animateChips && potAwards)
    ? hand.players.map((_, pi) => ({ seat: pi, award: (potAwards[pi] || 0) > 0 ? shownStacks[pi] - Math.max(0, stacks[pi]) - (uncalledBack ? uncalledBack[pi] : 0) : 0 }))
      .filter(d => d.award > 0)
    : null;
  const shipRate = motion.capture ? motion.captureRate : (playing ? rateFor(speed) : 1) * REPLAYER_PACE;
  // When the pot leaves the pile at this result press (after the river's wagers have landed).
  if (shipPlan && shipPlan.length) motion.shipStartNow = shipStartAfterSweep(springSet, shipRate, sweepPlan ? sweepPlan.length : 0) + uncalledDelay;
  /* The plaque takes its gold as the first shipped chip lands (after the river's wagers have been
     collected, when this press collects any). Decided once, in the render that shows the result, and
     held for as long as it shows: it was a custom property on the table root, recomputed every
     render, and the render that follows a result press (the showdown's own state) changed it, so
     every element of the table had its style recomputed in the middle of the sweep — an 80ms frame
     at a 4x CPU throttle, and a quarter of the press frame's style work. It lives on the winning
     seats only now. */
  if (springOn && showResult) {
    if (stepChanged || motion.shipArriveMs == null) {
      motion.shipArriveMs = Math.round((shipPlan && shipPlan.length ? motion.shipStartNow || 0 : 0) + shipFirstArrival(springSet, shipRate));
      // Whether this result ships the pot (a jump to it does not: its plaques take their gold at
      // once, with no glow for a hit that never came).
      motion.shipHit = !!(shipPlan && shipPlan.length);
    }
  } else {
    motion.shipArriveMs = null;
    motion.shipHit = false;
  }
  /* What the pot's figure counts (Replayer animations 26, 30): under springs the posted blinds stand on the felt
     as wagers until the first sweep, and a folded seat's wager goes into the pot as it folds. The model's pot
     (displayPot) is unchanged: everything that reads the pot for betting (pot odds, a pot-sized bet) keeps it. */
  const streetActs = hand.streets[streetIdx]?.actions || [];
  const foldedOn = (pi) => { for (let ai = 0; ai <= actionIdx && ai < streetActs.length; ai++) if (streetActs[ai].player === pi && streetActs[ai].action === 'fold') return true; return false; };
  const foldedSum = (springSet && !showResult)
    ? hand.players.reduce((n, _, pi) => n + (foldedOn(pi) ? computePlayerContrib(hand, streetIdx, streetActs, actionIdx, pi) : 0), 0) : 0;
  const postedBlinds = (springSet && !showResult && streetIdx === 0)
    ? hand.players.reduce((n, _, pi) => n + Math.max(0, computePlayerContrib(hand, 0, streetActs, -1, pi) || 0), 0) : 0;
  const potBase = Math.max(0, displayPot - postedBlinds + foldedSum);
  // 30: the fold that sweeps its seat's wager into the pot.
  const foldAct = motionKind === 'action' && rSettings.animateChips ? currentActions[actionIdx] : null;
  const foldSweep = foldAct && foldAct.action === 'fold' && prevWagersRef.current.has(foldAct.player)
    ? { seat: foldAct.player, order: 0, amount: computePlayerContrib(hand, streetIdx, streetActs, actionIdx, foldAct.player) } : null;
  const pendingPotNow = !springOn ? 0
    : (motionJumped ? 0 : motion.pendingPot) + (sweepPlan ? sweepPlan.reduce((n, w) => n + w.amount, 0) : 0) + (foldSweep && foldSweep.amount > 0 ? foldSweep.amount : 0);
  /* Never below what the table showed before the press (motion.potShown: the last figure drawn or
     written), while this step's chips are in flight: what the ghosts carry is the model's pot less
     the pot before the press whenever the model can say so (collectAtResult), and where it cannot
     (an excess handed back that is more than that seat's wager on the street) the figure holds
     rather than dips. */
  const potFloorNow = !springOn || motionJumped ? 0
    : motionKind ? (motion.potShown || 0)
    : (motion.pendingPot > 0 ? (motion.potFloor || 0) : 0);
  const shownPot = potShown(springOn ? potBase : displayPot, pendingPotNow, potFloorNow);
  /* The pot's FIGURE counts every chip put in so far, the wagers still in front of the seats included (owner,
     2026-11-15: "the pot should not be zero at this point"): a raise to 80,000 over 20,000/40,000 blinds reads
     140,000, where it read 0 until the first sweep (Replayer animations 26). The pile above it still draws what is
     in the middle (shownPot), so a wager is never drawn twice, and a sweep moves chips without changing the figure.
     At a result it is the contested pot (an uncalled excess has gone back), counting down as the pot ships. */
  const potCommitted = useMemo(
    () => (showResult ? displayPot : calcPotsAndStacks(hand, streetIdx, actionIdx).pot),
    [hand, streetIdx, actionIdx, showResult, displayPot]);
  /* What each stack still has in flight, AS THIS RENDER SAW IT. A snapshot, not a live read: the
     figures this render draws are put back into the DOM after the moment's writes (resyncDigits),
     and read live there they counted the award twice — the registry's, which the writes had just
     added, and this render's shipPlan — so a winner's plaque read 0 for half a second when the
     result was pressed while the river's chips were still landing. */
  const pendingStacksSeen = (springOn && !motionJumped) ? new Map(motion.pendingStacks) : null;
  const pendingStackNow = (pi) => (!springOn ? 0
    : ((pendingStacksSeen && pendingStacksSeen.get(pi)) || 0) + ((shipPlan && shipPlan.find(d => d.seat === pi)?.award) || 0) + (uncalledBack ? uncalledBack[pi] : 0));
  /* The least a stack can read while the pot lands on it: what it showed before the press (never
     below 0: a shorthand can commit more than a stack holds). A stack only ever counts UP to the
     award. */
  const stackFloor = (pi) => (showResult ? Math.max(0, stacks[pi]) : 0);
  /* The pile at a result: shipped (empty) unless this press is about to ship it, or the shipped
     chips have not left it yet. */
  const pileShipped = springOn && showResult && rSettings.animateChips && !!potAwards
    && !(shipPlan && shipPlan.length) && !(motion.pileHeld && !motionJumped);
  // What an arrival writes: always the latest render's numbers, less whatever is still in flight.
  const potTextNode = () => { const el = potTotalRef.current; const tn = el && el.lastChild; return tn && tn.nodeType === 3 ? tn : null; };
  const stackTextNode = (pi) => {
    const el = tableRef.current && tableRef.current.querySelector('.replayer-seat[data-seat="' + pi + '"] .replayer-seat-stack');
    const tn = el && el.firstChild;
    return tn && tn.nodeType === 3 ? tn : null;
  };
  /* An arrival: the pot's digits take what has landed. `pile` (a sweep's landing): the pile is
     redrawn as it will be once that sweep is in (`ahead`: what of it is still in flight), with the
     new stacks no ghost has landed on yet unseen (`hidden`). */
  motion.writePot = (pile) => {
    const v = potShown(springOn && !showResult ? potBase : displayPot, motion.pendingPot, motion.pendingPot > 0 ? motion.potFloor : 0);
    const tn = potTextNode();
    // The digits are the whole pot (potCommitted), constant through a sweep; the floors track the middle. The pile is
    // the whole pot too (owner, 2026-11-15: "This stack of chips should change to reflect the number in the pot"), so a
    // landing redraws nothing.
    if (tn) { tn.data = fmtChips(potCommitted); motion.wroteDigits = true; motion.potShown = v; }
    void pile;
  };
  // A winner's stack as the pot lands on it: never below what it showed before the press.
  const stackFigure = (pi) => (springOn ? Math.max(stackFloor(pi), shownStacks[pi] - pendingStackNow(pi)) : shownStacks[pi] - pendingStackNow(pi));
  motion.writeStack = (pi) => {
    const tn = stackTextNode(pi);
    if (tn) { tn.data = fmtChips(Math.max(stackFloor(pi), shownStacks[pi] - (motion.pendingStacks.get(pi) || 0))); motion.wroteDigits = true; }
  };
  /* Direct writes and React can disagree: React skips a text node whose value it thinks has not
     changed, so after a step back (the flush lands the pot at the old step's total) the DOM kept
     the flushed figure while React's own value was already right. Every commit after a direct
     write puts the rendered figures back first. */
  const rendered = { pot: fmtChips(potCommitted), stack: (pi) => fmtChips(stackFigure(pi)) };
  const resyncDigits = () => {
    if (!motion.wroteDigits) return;
    motion.wroteDigits = false;
    const tn = potTextNode();
    // Not while the opening builds the pot (motion.potBuilding): a commit with no moment put the whole pot back.
    if (tn && !motion.potBuilding && tn.data !== rendered.pot) tn.data = rendered.pot;
    hand.players.forEach((_, pi) => {
      if (motion.countingStacks.has(pi)) return;
      const sn = stackTextNode(pi);
      if (sn && sn.data !== rendered.stack(pi)) sn.data = rendered.stack(pi);
    });
  };
  motion.onSettled = () => setMotionRender(n => n + 1);

  /* 38: at a hi-lo showdown every unfolded seat took .replayer-hilo-high and
     nudged 8px up together, which communicates nothing — and the down-shifting
     .replayer-hilo-low existed in the stylesheet with no code path that could
     ever apply it, so the animation built to dramatise the split never split.
     The Hi:/Lo: label matching was already written for the split circles. */
  const hiloSide = useMemo(() => {
    const out = {};
    if (!isHiLo || !showResult) return out;
    halvedWinners.forEach(w => {
      // A scoop wins both halves, so it rises with the highs.
      out[w.playerIdx] = (w.hi || !w.lo) ? 'high' : 'low';
    });
    return out;
  }, [isHiLo, showResult, halvedWinners]);

  // Navigation
  /* In a drill the hand ends where it has got to, until it is over: the next action is the player's. */
  const atDrillEdge = !!drill && !drill.over;
  const canGoForward = streetIdx < totalStreets - 1 || actionIdx < currentActions.length - 1 || (!showResult && !atDrillEdge);
  const canGoBack = streetIdx > 0 || actionIdx >= 0 || showResult;

  // Update refs inline during render — guaranteed current before any async code runs.
  // useEffect is too late (fires after paint); inline assignment happens during commit.
  canGoForwardRef.current = canGoForward;

  const stepForward = useCallback(() => {
    const to = runOutTo({ s: streetIdx, a: actionIdx, r: showResult });
    if (to >= 0) { setStreetIdx(to); setActionIdx(-1); return; }
    if (actionIdx < currentActions.length - 1) setActionIdx(a => a + 1);
    else if (streetIdx < totalStreets - 1) { setStreetIdx(s => s + 1); setActionIdx(-1); }
    else if (atDrillEdge) setPlaying(false);
    else if (!showResult) { setShowResult(true); if (isHiLo) setTimeout(() => setHiloAnimate(true), 100); }
    else setPlaying(false);
  }, [actionIdx, currentActions.length, streetIdx, totalStreets, showResult, isHiLo, atDrillEdge, decidedNow, springOn, rSettings.animateBoard]); // eslint-disable-line react-hooks/exhaustive-deps
  // Update inline so the export loop always gets the latest closure
  stepForwardRef.current = stepForward;


  /* Rewinding reconstructs state; only forward motion performs it. Every running spring finishes
     before the new state commits — ghosts and shipped chips leave, the pot and stacks land — and
     nothing ever plays backwards. */
  /* A jump (Back, a street's label, Start, End) crossfades the whole table (owner, 2026-11-22, of a screen recording
     stepping back from the hero's bet: "Jittery. Terrible."): the pill, the wager, the stack, the turn ring all cut to
     the step before in one frame, while the old rewind dimmed everything on the felt to 0.45 and back. A still copy of
     the table as it stood (after finishAll, so at rest) is laid over it and fades out as the new step is drawn under
     it: what changed crosses over, what did not stays still. Animations and transitions are off in the copy (its CSS
     ones would start again from their first frame). A newer jump's copy covers an older one, which goes. */
  const jumpVeilRef = useRef(null);
  const crossfadeJump = useCallback(() => {
    const t = tableRef.current;
    if (!t || !springOn || motion.capture) return;
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) { /* no matchMedia */ }
    const host = t.parentElement;
    if (!host) return;
    const tr = t.getBoundingClientRect(), hr = host.getBoundingClientRect();
    if (!(tr.width > 0 && tr.height > 0)) return;
    const veil = t.cloneNode(true);
    veil.classList.add('replayer-jump-veil');
    veil.setAttribute('aria-hidden', 'true');
    veil.removeAttribute('id');
    veil.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    /* No transform of its own: the desktop table is lifted by one (translateY, its ink centred in the slot), the copy
       carries the same class, and placed at the lifted box it was lifted again, 16.8px over the table in the Hands
       pane at 1440x900, so every Back drew the table a step up and faded it down (owner, 2026-11-22: "the back arrow
       in the desktop replayer causes the table to jump"). */
    Object.assign(veil.style, {
      position: 'absolute', margin: '0', pointerEvents: 'none', transform: 'none', translate: 'none',
      left: (tr.left - hr.left - host.clientLeft + host.scrollLeft) + 'px', top: (tr.top - hr.top - host.clientTop + host.scrollTop) + 'px',
      width: tr.width + 'px', height: tr.height + 'px',
    });
    /* Over the table's own pieces and under what lies over the table: the table is no stacking context of its own, so
       its seats (4) to its dealer button (9) drew over a copy on z auto and the copy never showed; at 11 it covered the
       settings button and the scrim at the table's foot (.replayer-quick-btn, .replayer-under, both 10). At the dealer
       button's level, after the table: over everything on it at rest (the flight layer, 10, is empty after finishAll). */
    const z = getComputedStyle(t).zIndex;
    veil.style.zIndex = z !== 'auto' ? String(Number(z) + 1) : 'var(--z-dealer)';
    /* On the ground the table stands on, so it is opaque and the very screen it copied: over the live table, every
       see-through pixel (the rail's shade, a plaque's 0.93) drew twice and the first frame was darker. The first
       ground behind the table, when it is one flat colour (a gradient there, and it keeps none). */
    for (let e = host; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') break;
      if (cs.backgroundColor && !/rgba\([^)]*,\s*0\)|transparent/.test(cs.backgroundColor)) { veil.style.backgroundColor = cs.backgroundColor; break; }
    }
    t.after(veil);
    if (jumpVeilRef.current) jumpVeilRef.current.remove();
    jumpVeilRef.current = veil;
    // It holds until the new step is drawn under it (the next commit, below), then fades: started at the press, most of
    // the fade ran over the old step while the table re-rendered (200ms in headless WebKit), and the new one cut in.
    veil.dataset.pending = '1';
    veil.dataset.dur = String((1.4 * SPRING_SETS[springSet].stage.beat) / REPLAYER_PACE);
    veil._fallback = setTimeout(() => fadeJumpVeil(veil), 800);
  }, [springOn, springSet, motion]);
  const fadeJumpVeil = (veil) => {
    if (!veil || !veil.isConnected || !veil.dataset.pending) return;
    delete veil.dataset.pending;
    clearTimeout(veil._fallback);
    try {
      const a = veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: Number(veil.dataset.dur) || 300, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' });
      a.onfinish = () => { veil.remove(); if (jumpVeilRef.current === veil) jumpVeilRef.current = null; };
    } catch (e) { veil.remove(); }
  };
  /* On the first frame after the commit: started in the commit, the fade ran on through the rest of its work (the
     placement passes, 200ms in headless WebKit), and the first frame painted already showed it a fifth of the way in. */
  useLayoutEffect(() => {
    const v = jumpVeilRef.current;
    if (!v || !v.dataset.pending || v.dataset.queued) return;
    v.dataset.queued = '1';
    requestAnimationFrame(() => fadeJumpVeil(v));
  });
  useEffect(() => () => { if (jumpVeilRef.current) { clearTimeout(jumpVeilRef.current._fallback); jumpVeilRef.current.remove(); } }, []);

  const stepBack = useCallback(() => {
    motion.finishAll();
    crossfadeJump();
    markRewind();
    if (showResult) { setShowResult(false); setHiloAnimate(false); }
    else if (actionIdx >= 0) setActionIdx(a => a - 1);
    else if (streetIdx > 0) { const prevStreet = hand.streets[streetIdx - 1]; setStreetIdx(s => s - 1); setActionIdx((prevStreet?.actions?.length || 0) - 1); }
  }, [actionIdx, streetIdx, showResult, hand, markRewind, motion, crossfadeJump]);

  // 79: a held Back runs through this (the hold's interval outlives the render that started it).
  const stepBackRef = useRef(null);
  stepBackRef.current = stepBack;

  const goToStart = () => { motion.finishAll(); crossfadeJump(); setStreetIdx(0); setActionIdx(-1); setShowResult(false); setHiloAnimate(false); };
  // The street track's labels (UX pick 67): the start of that street.
  const goToStreet = (si) => { motion.finishAll(); crossfadeJump(); setStreetIdx(si); setActionIdx(-1); setShowResult(false); setHiloAnimate(false); };
  /* 51: this set the last street and the last action and stopped one step
     short of the showdown, so "End" landed on the river's final bet with the
     opponents' cards still face down. stepForward's final branch is what
     actually ends a hand; End does the same thing now. */
  const goToEnd = () => {
    motion.finishAll();
    crossfadeJump();
    const lastStreet = hand.streets.length - 1;
    setStreetIdx(lastStreet);
    setActionIdx((hand.streets[lastStreet]?.actions?.length || 0) - 1);
    setShowResult(true);
    if (isHiLo) setTimeout(() => setHiloAnimate(true), 100);
  };

  /* A question link (Features 27) opens at the decision it asks about: the bet faced, the hero to act. It opened on the
     first step, under a card that covers the transport, so whoever was asked could not see the spot; after the answer
     the whole hand arrives and stays on that decision, and the tally's See the rest plays on from it (2026-11-25). */
  const questionStop = useRef(null);
  useEffect(() => {
    if (!question) return;
    if (!question.answered) {
      // The stop is the last street the question's hand reaches: a decoded hand carries every street, those past the
      // stop empty (no action, no card dealt).
      const reached = (st) => !!(st && ((st.actions && st.actions.length) || (st.cards && (st.cards.board || st.cards.hero))));
      let si = hand.streets.length - 1;
      while (si > 0 && !reached(hand.streets[si])) si -= 1;
      const ai = (hand.streets[si]?.actions?.length || 0) - 1;
      questionStop.current = { si, ai };
      setStreetIdx(si); setActionIdx(ai); setShowResult(false);
    } else if (questionStop.current) {
      setStreetIdx(questionStop.current.si); setActionIdx(questionStop.current.ai); setShowResult(false);
    }
  }, [question && question.linkId, question && question.answered, hand.streets.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tallyOpen, setTallyOpen] = useState(true);

  /* ?at=flop|turn|river|end on a replay link opens the hand there (that street after its action, or
     the showdown): one address per moment, which is how the Mac's simulator check
     (.github/workflows/mac-sim-check.yml) photographs a replay it cannot tap through. */
  useEffect(() => {
    let at = null;
    try { at = new URLSearchParams(window.location.search).get('at'); } catch { /* no window */ }
    if (!at) return;
    if (at === 'end') { goToEnd(); return; }
    const si = { preflop: 0, flop: 1, turn: 2, river: 3 }[at];
    if (si == null || si >= hand.streets.length) return;
    setStreetIdx(si);
    setActionIdx((hand.streets[si]?.actions?.length || 0) - 1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* 50: at the result an effect forces playing false and stepForward's last
     branch pauses, so pressing play set playing true, ticked once, and paused
     again — a flicker and a no-op, under a glyph still showing a play
     triangle. From the end, play means replay. */
  /* 1: a hand started under Play is dealt: from its first step, or replayed from the end. Opening, stepping and
     the scrubber keep the table already dealt (the owner removed the deal from every opening). */
  const pendingDealRef = useRef(false);
  // 26-28: the opening's forced bets, when the hand opens on its first step and when Play starts it.
  const pendingOpenRef = useRef(false);
  const handlePlayPause = () => {
    if (!playing && !canGoForward) { pendingDealRef.current = true; pendingOpenRef.current = true; goToStart(); setPlaying(true); return; }
    if (!playing && streetIdx === 0 && actionIdx < 0 && !showResult) { pendingDealRef.current = true; pendingOpenRef.current = true; setMotionRender(n => n + 1); }
    setPlaying(p => !p);
  };

  /* 60: the interval ran regardless of document visibility, so backgrounding
     the app played the hand out unseen and handed you back the result — and a
     throttled background timer gets the pacing wrong anyway. */
  /* 65: the flying chips landed at 50%/42% and disappeared while the pot's
     number swapped on the same render — so they arrived at a coordinate
     rather than at the pot. The pot now takes the impact. */
  const [potLanding, setPotLanding] = useState(false);
  const potLandTimer = useRef(0);
  const markPotLanding = useCallback(() => {
    clearTimeout(potLandTimer.current);
    potLandTimer.current = setTimeout(() => {
      setPotLanding(true);
      setTimeout(() => setPotLanding(false), 320);
    }, 300);
  }, []);
  useEffect(() => () => clearTimeout(potLandTimer.current), []);

  /* 85: the overlay was a 75%-black scrim with an uppercase title, a 220px
     bar and a step counter, all inline literals — and it completely hid the
     table it was capturing. Both exporters already produce a canvas per step;
     showing them is better feedback AND a far better advertisement for the
     feature than a bar. */
  const [exportPreview, setExportPreview] = useState(null);
  const [inspecting, setInspecting] = useState(null);
  /* 62: a seat's history unrolls from its plaque on tap: the panel drops 0.75r, its rows fade in top to bottom. */
  useLayoutEffect(() => {
    if (inspecting == null || !springOn) return;
    const t = tableRef.current;
    const panel = t && t.querySelector('.replayer-seat[data-seat="' + inspecting + '"] .replayer-seat-line');
    if (!panel) return;
    const m = motionRef.current;
    const ySp = tierSpring(springSet, 'yield');
    const S0 = SPRING_SETS[springSet].stage;
    const pr = document.createElement('div');
    pr.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
    t.appendChild(pr);
    const r = pr.getBoundingClientRect().height / 100 || 8;
    t.removeChild(pr);
    m.run(panel, { key: { el: panel, kind: 'panel' }, property: 'individual', size: { w: panel.offsetWidth, h: panel.offsetHeight }, channels: [
      { prop: 'y', spring: ySp, from: -0.75 * r, to: 0 },
      { prop: 'opacity', ramp: { from: 0, to: 1, delay: 0, duration: S0.arrivalFade } },
    ] });
    [...panel.querySelectorAll('.replayer-seat-line-row')].forEach((row, k) => m.run(row, { key: { el: row, kind: 'row' }, property: 'individual', size: { w: row.offsetWidth, h: row.offsetHeight }, channels: [
      { prop: 'opacity', ramp: { from: 0, to: 1, delay: 40 + k * 25, duration: 60 } },
    ] }));
  }, [inspecting]); // eslint-disable-line react-hooks/exhaustive-deps

  const [showExportMenu, setShowExportMenu] = useState(false);
  // Features 26, 27, 29, 31 (2026-11-11).
  const [noteEditing, setNoteEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  // Esc closes the share sheet, a dialog on the desktop (UX pick 71).
  useEffect(() => {
    if (!showExportMenu) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setShowExportMenu(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showExportMenu]);
  // Hand-history export: can this hand be written, and does PokerTracker 4 take it. A hand that came
  // by a shared link is refused here and again in the writer (opts.shared): it is not the viewer's.
  const hhCheck = useMemo(() => checkExportable(hand, { heroName, shared: !!sharedHand }), [hand, heroName, sharedHand]);
  // Written inside the tap, nothing awaited first: iOS keeps the tap as the
  // activation navigator.share needs. A saved hand is dated by its save time.
  const exportThisHand = () => {
    try {
      exportHandHistory([{ hand, playedAt: playedAt || new Date() }], { heroName, shared: !!sharedHand })
        .then(r => {
          if (r.result === 'downloaded') toast.success('Saved ' + r.filename);
          else if (r.result === 'empty' && toast?.info) toast.info("Couldn't export the hand");
        })
        .catch((e) => { console.error('hand-history export:', e); if (toast?.info) toast.info("Couldn't export the hand"); });
    } catch (e) { console.error('hand-history export:', e); if (toast?.info) toast.info("Couldn't export the hand"); }
  };
  /* 94: the overlays described one outcome and the code produced another. Ask
     the platform once, and say what will happen. */
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';
  const [canInstagram, setCanInstagram] = useState(false);
  useEffect(() => {
    let live = true;
    import('../utils/instagram-stories.js')
      .then(m => { if (live) setCanInstagram(!!m.canShareToInstagram?.()); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const [tabHidden, setTabHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /* 49: one fixed interval with a single flat animation allowance gave a
     check, a flop whose stagger runs 640ms, and the showdown the identical
     delay — so at 4x the next action fired while the flop was still sliding,
     and at 1x a street opening got no more room than a check. A hand does not
     have a constant tempo; street boundaries and the showdown are the beats.

     Self-scheduling rather than an interval: each step changes the indices,
     which re-runs this effect, which picks the NEXT delay from where the
     replay now stands. The allowances scale with the speed setting so 4x
     stays 4x rather than becoming 4x-with-long-pauses. */
  useEffect(() => {
    if (!playing || tabHidden) return;
    const scale = speed / 1000;
    const atLastAction = actionIdx >= currentActions.length - 1;
    const streetBreak = atLastAction && streetIdx < totalStreets - 1;
    const resultBreak = atLastAction && streetIdx >= totalStreets - 1 && !showResult;
    /* 98: the pacing already varied by street boundary and by the result,
       which is the right shape — but a fold and a three-bet still got the
       same beat and an all-in got no more room than a check. The pacing IS
       the edit; weighting it by significance is what turns a sequence of
       steps into a story. */
    const next = currentActions[actionIdx + 1];
    const weight = { fold: -0.35, check: -0.3, call: 0, bet: 0.35, raise: 0.5, 'all-in': 1 };
    const actBeat = next ? (weight[next.action] ?? 0) * speed : 0;
    /* Catalogue three, idea 26 (2026-10-15): the river's last action stepped straight into the reveal,
       so the strongest moment of a replay had no pause. One held beat before the showdown (--dur-beat,
       1200ms at 1x, scaled by speed like the rest), whether or not the deal animates. Exports step the
       replay themselves (stepForward below), so this never lengthens a video. */
    const HELD_BEAT_MS = 1200;
    const allowance = (rSettings.animateDeal && streetBreak ? 650 : 0) + (resultBreak ? HELD_BEAT_MS : 0);
    // The deal and the opening's forced bets (Replayer animations 1, 26-28) finish before the first action.
    const openHold = springOn && streetIdx === 0 && actionIdx < 0 ? motion.extentMs() + 150 : 0;
    // The tempo slows with the motions (REPLAYER_PACE), so a slower moment is not overlapped by the next step.
    const delayMs = Math.max(120, (speed + actBeat + allowance * scale) / REPLAYER_PACE, openHold);
    const t = setTimeout(() => stepForwardRef.current?.(), delayMs);
    return () => clearTimeout(t);
  }, [playing, tabHidden, speed, streetIdx, actionIdx, showResult, currentActions.length, totalStreets, rSettings.animateDeal]);

  useEffect(() => { if (showResult && playing) setPlaying(false); }, [showResult, playing]);
  /* A note stops the replay where it was written (owner, 2026-11-28: "when a note shows up, the hand should pause, and
     the note should have a continue symbol for the user to tap"): the bubble's play button carries on. The moment play
     starts from (Play, or Continue on the bubble) does not stop it again; a drill and an export are not stopped. */
  const notePlayRef = useRef({ was: false, from: null });
  useEffect(() => {
    const s = notePlayRef.current, here = streetIdx + ':' + actionIdx + ':' + (showResult ? 1 : 0);
    if (playing && !s.was) s.from = here;
    s.was = playing;
    if (!playing || drill || here === s.from) return;
    if (noteAt(hand, streetIdx, actionIdx)) setPlaying(false);
  }, [playing, streetIdx, actionIdx, showResult, hand, drill]);

  /* ── The transport (Replayer animations 76-80) ── */
  const glyphRef = useRef(null);
  const glyphWas = useRef({ kind: null, html: '' });
  const speedLabelRef = useRef(null);
  const speedWas = useRef(null);
  const springKf = (channels, opts = {}) => { try { return transportKeyframes(channels, opts); } catch (e) { return null; } };
  const playKind = playing ? 'pause' : (canGoForward ? 'play' : 'replay');
  // 76 / 80: Play and Pause trade places by a quarter turn; at the end the Replay arrow winds in as the triangle goes.
  useLayoutEffect(() => {
    const el = glyphRef.current;
    const was = glyphWas.current;
    glyphWas.current = { kind: playKind, html: el ? el.innerHTML : '' };
    if (!el || !was.kind || was.kind === playKind || !springSet) return;
    const flick = tierSpring(springSet, 'flick'), arm = tierSpring(springSet, 'arm');
    const toReplay = playKind === 'replay';
    const host = el.parentElement;
    if (host && was.html) {
      const ghost = document.createElement('span');
      ghost.className = 'rpb-glyph is-ghost';
      ghost.innerHTML = was.html;
      host.appendChild(ghost);
      const out = springKf([
        { prop: 'rotate', spring: flick, from: 0, to: toReplay ? 0 : 90 },
        { prop: 'scale', spring: flick, from: 1, to: 0.4 },
        { prop: 'opacity', ramp: { from: 1, to: 0, delay: 0, duration: 120 } },
      ], { prefix: 'translate(-50%, -50%)' });
      if (out) { const a = ghost.animate(out.keyframes, { duration: out.duration, easing: 'linear', fill: 'forwards' }); a.onfinish = () => ghost.remove(); }
      else ghost.remove();
    }
    const sp = toReplay ? arm : flick;
    const inn = springKf([
      { prop: 'rotate', spring: sp, from: toReplay ? -300 : -90, to: 0 },
      { prop: 'scale', spring: sp, from: 0.4, to: 1 },
      { prop: 'opacity', ramp: { from: 0, to: 1, delay: 0, duration: 120 } },
    ]);
    if (inn) el.animate(inn.keyframes, { duration: inn.duration, easing: 'linear' });
  }, [playKind]); // eslint-disable-line react-hooks/exhaustive-deps
  // 77 (the ring counting down round Play) was removed 2026-11-13, owner: "very weird and unpleasant".
  // 78: the speed label rolls the way the speed went (up when faster, down at the wrap to 0.5x).
  useLayoutEffect(() => {
    const el = speedLabelRef.current;
    const was = speedWas.current;
    speedWas.current = { speed, text: el ? el.textContent : '' };
    if (!el || !was || was.speed === speed || !springSet) return;
    const slide = tierSpring(springSet, 'slide');
    const up = speed < was.speed;
    const h = el.offsetHeight || 10;
    const host = el.parentElement;
    if (host) {
      const ghost = el.cloneNode(true);
      ghost.classList.add('is-ghost');
      ghost.textContent = was.text;
      host.appendChild(ghost);
      const out = springKf([{ prop: 'y', spring: slide, from: 0, to: up ? -h : h }, { prop: 'opacity', ramp: { from: 1, to: 0, delay: 0, duration: 120 } }], { prefix: 'translate(-50%, -50%)' });
      if (out) { const a = ghost.animate(out.keyframes, { duration: out.duration, easing: 'linear', fill: 'forwards' }); a.onfinish = () => ghost.remove(); } else ghost.remove();
    }
    const inn = springKf([{ prop: 'y', spring: slide, from: up ? h : -h, to: 0 }, { prop: 'opacity', ramp: { from: 0, to: 1, delay: 0, duration: 120 } }]);
    if (inn) el.animate(inn.keyframes, { duration: inn.duration, easing: 'linear' });
  }, [speed]); // eslint-disable-line react-hooks/exhaustive-deps
  // 79: Forward or Back held 350ms runs the hand at the 4x interval until released.
  const [holding, setHolding] = useState(null);
  const holdRef = useRef({ timer: 0, iv: 0, ran: false });
  const endHold = useCallback(() => {
    const h = holdRef.current;
    clearTimeout(h.timer); clearInterval(h.iv);
    h.timer = 0; h.iv = 0;
    setHolding(null);
  }, []);
  const startHold = (dir) => (e) => {
    if (e.button != null && e.button !== 0) return;
    const h = holdRef.current;
    h.ran = false;
    clearTimeout(h.timer); clearInterval(h.iv);
    h.timer = setTimeout(() => {
      h.ran = true;
      setHolding(dir);
      setPlaying(false);
      const step = () => { if (dir === 'fwd') { if (canGoForwardRef.current) stepForwardRef.current?.(); else endHold(); } else stepBackRef.current?.(); };
      step();
      h.iv = setInterval(step, 250);
    }, 350);
  };
  useEffect(() => () => { clearTimeout(holdRef.current.timer); clearInterval(holdRef.current.iv); }, []);
  const holdClick = (fn) => () => { if (holdRef.current.ran) { holdRef.current.ran = false; return; } fn(); };

  /* The drill: every answer from the server plays forward to the new edge of the hand, and the
     player's buttons wait until it has got there. Back from the grades, the table is at the result. */
  const drillRev = drill ? drill.rev : null;
  const drillBackAtEnd = !!(drill && drill.startAtEnd);
  useLayoutEffect(() => { // before paint, so the buttons never flash live ahead of the table
    if (drillRev == null) return;
    if (drillBackAtEnd) { goToEnd(); return; }
    setPlaying(true);
  }, [drillRev]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (atDrillEdge && playing && !canGoForward) setPlaying(false); }, [atDrillEdge, playing, canGoForward]);

  // Trigger draw discard animation when entering a draw street
  useEffect(() => {
    if (!isDrawGame || !rSettings.animateFold) return;
    const st = hand.streets[streetIdx];
    if (!st || !st.draws || st.draws.length === 0) return;
    if (actionIdx !== -1) return;
    const anims = st.draws.map((d, i) => ({
      id: streetIdx + '-' + d.player + '-' + i, playerIdx: d.player, count: d.discarded, phase: 'fly'
    })).filter(a => a.count > 0);
    if (anims.length === 0) return;
    setDrawDiscardAnims(anims);
    const t1 = setTimeout(() => {
      setDrawDiscardAnims(prev => prev.map(a => ({ ...a, phase: 'fade' })));
    }, 600);
    const t2 = setTimeout(() => { setDrawDiscardAnims([]); }, 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); setDrawDiscardAnims([]); };
  }, [streetIdx, actionIdx, isDrawGame, hand, rSettings.animateFold]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      // Space and Enter press a focused button, switch or link as everywhere else; nothing here inside an open
      // sheet or with a modifier held (App improvements 156: Space played the hand behind the sheet).
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      const t = e.target;
      if (t && t.closest && t.closest('[role="dialog"], .share-menu-panel, .replayer-settings-panel')) return;
      if ((e.key === ' ' || e.key === 'Enter') && t && t.closest && t.closest('button, a[href], [role="button"], [role="switch"], [role="checkbox"], [role="link"]')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); stepForward(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepBack(); }
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
      else if (e.key === 'Home') { e.preventDefault(); goToStart(); }
      else if (e.key === 'End') { e.preventDefault(); goToEnd(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stepForward, stepBack]);

  // Share link
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  /* The hand's short link, minted without copying it (Features 26, 27): the plain one for Send in the app, or a
     question that stops at the hero's next decision. Resolves to the link's id, or null. */
  const mintHandLink = useCallback(async (asQuestion) => {
    if (!token) return null;
    /* The sharer's table rides along as it does on Copy link: the felt, lit or not, and the visual switches. Without
       it a hand sent in the app or asked as a question opened on the dark felt whatever the sharer's was (2026-11-25). */
    const look = {
      feltColor, feltBright: rSettings.feltBright,
      visuals: {
        theme: rSettings.theme, splayAmount: Number(rSettings.splayAmount) || 0, cardOverlap: Number(rSettings.cardOverlap ?? 52) || 0,
        ...Object.fromEntries(VISUAL_SWITCHES.map(k => [k, !!rSettings[k]])),
      },
    };
    const full = encodeHand({ ...hand, title: handTitle || hand.title || '', ...look });
    if (!full) return null;
    const body = { shorthand: full, title: linkTitle(hand) };
    if (asQuestion) {
      const qs = encodeHand({ ...questionHand(hand, streetIdx, actionIdx), ...look });
      if (!qs) return null;
      body.question = { shorthand: qs, street: streetIdx, action: actionIdx };
    }
    try {
      const res = await fetch(`${API_URL}/hand-links`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      if (!res.ok) return null;
      const d = await res.json();
      return d && d.id ? d.id : null;
    } catch { return null; }
  }, [token, hand, handTitle, feltColor, rSettings, streetIdx, actionIdx]);
  const askQuestion = useCallback(async () => {
    const id = await mintHandLink(true);
    if (!id) { toast.error('The question link was not made; check the connection'); return; }
    const url = SITE_URL + '/h/' + id;
    try { await navigator.clipboard.writeText(url); toast.success('Question link copied: it stops at your decision'); }
    catch { if (navigator.share) navigator.share({ url }).catch(() => {}); else toast.info(url); }
  }, [mintHandLink, toast]);

  const copyShareLink = useCallback(async () => {
    try {
      // Carry the felt the sharer is looking at, so the link reproduces their
      // table rather than the recipient's default felt.
      const visuals = {
        theme: rSettings.theme, splayAmount: Number(rSettings.splayAmount) || 0, cardOverlap: Number(rSettings.cardOverlap ?? 52) || 0,
        ...Object.fromEntries(VISUAL_SWITCHES.map(k => [k, !!rSettings[k]])),
      };
      const shorthand = encodeHand({ ...hand, title: handTitle || hand.title || '', feltColor, feltBright: rSettings.feltBright, visuals });
      if (!shorthand) return;
      const title = linkTitle(hand);
      // Fallback: the self-contained fragment link. SITE_URL (not
      // window.location.origin, which is capacitor://localhost in the app), and
      // NOT url-encoded — the format's commas/slashes are fragment-safe, so this
      // is shorter and the decoder handles encoded or raw. Used if the mint fails
      // (offline / not signed in).
      const fallbackUrl = SITE_URL + '/#h/' + shorthand;
      const urlPromise = (async () => {
        try {
          const res = await fetch(`${API_URL}/hand-links`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ shorthand, title }),
          });
          if (res.ok) { const d = await res.json(); if (d && d.id) return SITE_URL + '/h/' + d.id; }
        } catch (e) { /* keep the fragment fallback */ }
        return fallbackUrl;
      })();
      /* Safari and the iOS app only let a page write the clipboard inside the tap that asked
         for it, and the short link comes back from the server after that tap is over — so
         writeText(url) after the fetch was refused, silently, and nothing was copied. The
         clipboard is claimed NOW, synchronously, with a ClipboardItem whose text is a promise
         the server's answer fills in (Safari's sanctioned pattern). Fallbacks, in order:
         writeText once the URL is known (fine where there is no gesture rule), a hidden
         textarea + execCommand('copy'), and the share sheet. */
      let copied = false;
      if (typeof window.ClipboardItem === 'function' && navigator.clipboard && navigator.clipboard.write) {
        try {
          const item = new window.ClipboardItem({ 'text/plain': urlPromise.then(u => new Blob([u], { type: 'text/plain' })) });
          await navigator.clipboard.write([item]);
          copied = true;
        } catch (e) { /* fall through */ }
      }
      const url = await urlPromise;
      if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(url); copied = true; } catch (e) { /* fall through */ }
      }
      if (!copied) {
        try {
          const ta = document.createElement('textarea');
          ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, url.length);
          copied = document.execCommand('copy');
          ta.remove();
        } catch (e) { /* fall through */ }
      }
      if (!copied && navigator.share) {
        try { await navigator.share({ url }); copied = true; } catch (e) { /* dismissed */ }
      }
      if (copied) { setShareLinkCopied(true); setTimeout(() => setShareLinkCopied(false), 2000); }
      else console.error('Share link: no clipboard path worked for', url);
    } catch (e) { console.error('Share link error:', e); }
    // The live look, not the one at mount: these deps were [hand, token], so a felt
    // or splay changed after opening the hand never reached the link.
  }, [hand, token, feltColor, rSettings]);

  // Seat class
  const getPlayerSeatClass = (playerIdx) => {
    if (folded.has(playerIdx)) return 'folded';
    if (!showResult) return '';
    if (showdownUndecided) return 'undecided';
    let cls = '';
    const manualWinners = hand.result?.winners;
    if (manualWinners && manualWinners.length > 0) {
      const entry = manualWinners.find(w => w.playerIdx === playerIdx);
      cls = entry ? (entry.split ? 'split' : 'winner') : 'loser';
    } else if (evalResult) {
      if (playerIdx === replayHeroIdx) {
        const heroWins = evalResult.some(r => r.result.outcome === 'hero');
        const heroLoses = evalResult.some(r => r.result.outcome === 'opponent');
        const heroSplits = evalResult.some(r => r.result.outcome === 'split');
        if (heroWins && !heroLoses) cls = 'winner';
        else if (heroLoses && !heroWins) cls = 'loser';
        else if (heroSplits) cls = 'split';
      } else {
        const oppResult = evalResult.find(r => r.index === playerIdx);
        if (oppResult) {
          if (oppResult.result.outcome === 'opponent') cls = 'winner';
          else if (oppResult.result.outcome === 'hero') cls = 'loser';
          else if (oppResult.result.outcome === 'split') cls = 'split';
        }
      }
    }
    /* potAwards is the authority on who was actually paid, side pots included:
       a seat handed a pot the overall winner could not win (a side pot only it
       was in for) is a winner even though the stored winner list — which names
       the whole-hand winner — does not mention it. */
    if (potAwards && (potAwards[playerIdx] || 0) > 0 && cls !== 'split') cls = 'winner';
    return cls;
  };

  // Hand name at showdown
  /* Who took each board or run (owner, 2026-10-21), as a tag beside each row at the showdown: the
     player's name, "Split" for a tie, "Hi … · Lo …" for a hi-lo run. Settled as the pot is, board by
     board among everyone still in; none for a hi-lo double board, whose one ultimate high and low span
     both boards, or while anyone's cards are unknown. */
  const boardWinnerTags = () => {
    if (!showResult || category !== 'community' || boardCount(hand) < 2) return null;
    const cfg = gameEvalFor(hand.gameType, hand);
    if (!cfg || cfg.type === 'split-badugi' || (cfg.type === 'hilo' && combinesHiLo(hand))) return null;
    const live = hand.players.map((_, i) => i).filter(i => !folded.has(i));
    if (live.length < 2) return null;
    const bySeat = {};
    for (const pi of live) {
      const raw = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
      const parsed = raw && raw !== 'MUCK' ? parseCardNotation(raw).filter(c => c.suit !== 'x') : [];
      if (parsed.length < finalCards) return null;
      bySeat[pi] = parsed;
    }
    const boards = handBoards(hand, streetIdx).map(b => parseCardNotation(b).filter(c => c.suit !== 'x'));
    const ev = multiBoardEvals(cfg, bySeat, boards);
    const nameOf = (i) => (i === replayHeroIdx ? 'Hero' : houseName(hand.players[i]?.name || 'Player'));
    const who = (ws) => (ws.length > 1 ? 'Split' : ws.length ? nameOf(ws[0]) : null);
    return ev.per.map(per => {
      const { hiWinners, loWinners } = hiLoWinnersAmong(per, live);
      if (cfg.type === 'hilo') {
        const h = who(hiWinners), l = who(loWinners);
        return l ? 'Hi ' + h + ' · Lo ' + l : h;
      }
      return who(hiWinners);
    });
  };

  /* A suitless board card is read on each suit it could have (boardFills): "Three of a Kind" where every suit gives
     it, "Pair of Ks or Flush, A-high" where they differ; a two-line (hi-lo) reading that differs is read without
     the card, as before. */
  const getPlayerHandName = (playerIdx, useShort) => {
    if (!boardFills) return handNameOn(playerIdx, useShort, null);
    const read = readingAcross(boardFills.map(b => handNameOn(playerIdx, useShort, b)));
    return read != null ? read : handNameOn(playerIdx, useShort, null);
  };
  const handNameOn = (playerIdx, useShort, boardIn) => {
    if (!showResult || folded.has(playerIdx)) return null;
    const pCards = playerIdx === replayHeroIdx ? heroCards : (opponentCards[playerIdx] || '');
    if (!pCards) return null;
    const cfg = gameEvalFor(hand.gameType, hand);
    if (!cfg) return null;
    const parsed = parseCardNotation(pCards).filter(c => c.suit !== 'x');
    if (parsed.length < finalCards) return null;
    const board = boardIn || (feltBoard ? parseCardNotation(boardCards).filter(c => c.suit !== 'x') : []);
    if (cfg.type === 'halves') {
      return halvesHandName(cfg, scoreHalves(cfg, parsed, board), !wonHalves || wonHalves.hi.has(playerIdx), !wonHalves || wonHalves.lo.has(playerIdx), useShort);
    }
    /* Several boards (double board; run it twice or three times): the hand on each board, one line
       each ("B1: Trip 9s" / "B2: Two Pair"; R1, R2 for runs). Board 1 alone named a hand that lost
       there and won the other. */
    if (category === 'community' && boardCount(hand) > 1) {
      // Named by where the board sits on the felt (owner, 2026-10-21: "top and bottom instead of b1/b2").
      const all = handBoards(hand, streetIdx);
      const where = all.length === 3 ? ['Top', 'Middle', 'Bottom'] : ['Top', 'Bottom'];
      const lines = all.map((b, i) => {
        const bd = parseCardNotation(b).filter(c => c.suit !== 'x');
        // Two lines share the plaque's width: two pair loses its "Two Pair, " ("Ks & Qs" says it).
        const nm = (e) => (e ? String(useShort ? (e.shortName || e.name) : e.name).replace(/^Two Pair, /, '') : null);
        let name = null;
        if (cfg.type === 'hilo') {
          const hiN = nm(bestHighFor(cfg, parsed, bd));
          const lo = bestLow8For(cfg, parsed, bd);
          name = [hiN, lo && lo.qualified !== false && lo.name ? lo.name : null].filter(Boolean).join(' / ');
        } else if (cfg.type === 'high') name = nm(bestHighFor(cfg, parsed, bd));
        else if (cfg.type === 'low') name = nm(bestLowFor(cfg, parsed.concat(bd)));
        return name ? where[i] + ': ' + name : null;
      }).filter(Boolean);
      return lines.length ? lines.join('\n') : null;
    }
    if (cfg.type === 'hilo') {
      const hiEv = bestHighFor(cfg, parsed, board);
      const loEv = bestLow8For(cfg, parsed, board);
      /* Only a half this player won gets its label: "Hi:" is a claim, and it
         belongs to whoever won the high. */
      const wonHi = !wonHalves || wonHalves.hi.has(playerIdx);
      const wonLo = !wonHalves || wonHalves.lo.has(playerIdx);
      const parts = [];
      // Paid only from a side pot: "Side hi:", so it does not read as beating the main pot's "Hi:".
      const sideOnly = !!(wonHalves && wonHalves.side && wonHalves.side.has(playerIdx));
      if (hiEv && wonHi) parts.push((sideOnly ? 'Side hi: ' : 'Hi: ') + (useShort ? (hiEv.shortName || hiEv.name) : hiEv.name));
      if (loEv && loEv.qualified !== false && loEv.name && wonLo) parts.push((sideOnly ? 'Side lo: ' : 'Lo: ') + loEv.name);
      if (parts.length) return parts.join('\n');
      /* Won neither half. The hand is still worth showing at a showdown —
         it just gets named, not captioned as a winning half. */
      if (hiEv) return useShort ? (hiEv.shortName || hiEv.name) : hiEv.name;
      return null;
    }
    let ev = null;
    if (cfg.type === 'high') ev = bestHighFor(cfg, parsed, board);
    else if (cfg.type === 'low') ev = bestLowFor(cfg, parsed.concat(board));
    else if (cfg.type === 'badugi') ev = bestBadugiHand(parsed);
    if (!ev) return null;
    return useShort ? (ev.shortName || ev.name) : ev.name;
  };

  const themeClass = rSettings.theme !== 'default' ? ' theme-' + rSettings.theme : '';
  // Table shape was retired (2026-09-30): every table is the oval.
  const shapeClass = '';
  // Was ' four-color-deck', a class with zero rules in the stylesheet - a dead
  // switch. The deck is already four-colour; what it needs is value separation.
  const hcDeckClass = rSettings.highContrastDeck ? ' hc-deck' : '';
  const boardAnimClass = getBoardAnimClass();

  /* The flop is dealt the way a dealer spreads it: the three cards land as one
     stack in the first card's slot with the WINDOW card (the one that ends up
     rightmost) on top and showing, hold a beat, then spread into place. The
     window card travels furthest, uncovering the middle card, which uncovers the
     first. DOM order already paints slot 2 over slot 1 over slot 0. Measured
     offsets, so it follows the table's size; not cancelled when the class drops
     on the next render — only replaced by the next flop. */
  const boardRowRef = useRef(null);
  const flopAnimsRef = useRef([]);
  const flopAnimKey = boardAnimClass.includes('animate-board-flop') ? streetIdx : null;
  useLayoutEffect(() => {
    if (flopAnimKey == null) return;
    const row = boardRowRef.current;
    if (!row) return;
    const cards = [0, 1, 2].map(i => row.querySelector('[data-slot="' + i + '"]'));
    if (cards.some(c => !c) || typeof cards[0].animate !== 'function') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    /* Not during an export. The [data-capturing] freeze pauses CSS animations
       only; this is a Web Animation, so it ran on, and the exporters' one still
       per step (~120ms after the step) caught the flop as a half-transparent
       stack in the first slot — measured: all three cards at the same centre,
       opacity 0.52, scale 0.95. */
    if (row.closest('[data-capturing]')) return;
    flopAnimsRef.current.forEach(a => a.cancel());
    const x0 = cards[0].getBoundingClientRect().left;
    flopAnimsRef.current = cards.map(el => {
      const dx = x0 - el.getBoundingClientRect().left;
      const at = 'translateX(' + dx + 'px)';
      return el.animate([
        { transform: at + ' scale(0.9)', opacity: 0, offset: 0 },
        { transform: at + ' scale(1)', opacity: 1, offset: 0.3 },
        { transform: at, opacity: 1, offset: 0.5, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
        { transform: 'translateX(0)', opacity: 1, offset: 1 },
      ], { duration: 820, fill: 'backwards' });
    });
  }, [flopAnimKey]);

  /* The board is a centred row, so a turn or river card re-centres everything
     already on it: the flop moved half a card left in one frame while the new
     card slid in, and stepping back moved it right the same way. FLIP instead:
     each card's layout centre (relative to the table, so the board area's own
     centring cancels out) is remembered after every commit; when the set of
     cards changes, a card that stayed is put back where it was SEEN and glides
     to its new slot on the motion tokens. "Where it was seen" is the remembered
     layout plus any translate still on it, so a slide that is interrupted (fast
     playback, or a step back mid-glide) continues from where the card is rather
     than snapping. Centres, because every transform on a board card (the deal's
     scale, the flop spread's translate) is about the card's centre, so the
     centre minus the matrix's translate is the layout position exactly.
     Off for reduced motion, with the board animation switched off, and during
     an export: beginCapture() marks the table [data-capturing] and captures one
     still per step ~120ms after it, so a slide there would freeze the flop
     mid-way across the felt. */
  const boardLayoutRef = useRef(null);
  const boardSlidesRef = useRef(new Map());
  useLayoutEffect(() => {
    /* A press that comes before the last moment has finished building (its board, its pile or its
       ship wait for the frame after their press) builds it first, so this one takes it over from
       where it is: measured here, before anything is read for the new moment. */
    if (springOn && motionKind && motion.deferred.size) motion.flushDeferred();
    const row = boardRowRef.current;
    const prev = boardLayoutRef.current;
    boardDeltaRef.current = null;
    if (!row) { boardLayoutRef.current = null; return; }
    const table = row.closest('.replayer-table') || row.parentElement;
    const originX = table.getBoundingClientRect().left;
    const cards = [...row.children].filter(el => el.dataset && el.dataset.ck);
    const shiftOf = (el) => {
      const t = getComputedStyle(el).transform;
      return t && t !== 'none' ? new DOMMatrixReadOnly(t).m41 : 0;
    };
    const now = new Map();
    const shift = new Map();
    const rects = new Map();
    for (const el of cards) {
      const r = el.getBoundingClientRect();
      const s = shiftOf(el);
      shift.set(el, s);
      rects.set(el, r);
      now.set(el.dataset.ck, (r.left + r.right) / 2 - s - originX);
    }
    boardLayoutRef.current = now;
    /* The spring path takes the same measurement — where each card was seen, where it now lies —
       and lands the turn and river from the moments effect below, on a forward step only. */
    if (springOn) { boardDeltaRef.current = { prev, now, shift, cards, rects }; return; }
    if (!prev) return;
    const changed = now.size !== prev.size || [...now.keys()].some(k => !prev.has(k));
    if (!changed) return;
    if (!rSettings.animateBoard || typeof row.animate !== 'function') return;
    if (row.closest('[data-capturing]')) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cs = getComputedStyle(row);
    // WebKit hands a time token back as "0.32s", Blink as "320ms".
    const durTok = cs.getPropertyValue('--dur-base').trim();
    const duration = (parseFloat(durTok) || 0) * (/[^m]s$/.test(durTok) ? 1000 : 1);
    const easing = cs.getPropertyValue('--ease-out').trim() || 'ease-out';
    if (!duration) return;
    for (const el of cards) {
      const k = el.dataset.ck;
      if (!prev.has(k)) continue;
      const dx = prev.get(k) + shift.get(el) - now.get(k);
      const running = boardSlidesRef.current.get(el);
      if (running) { running.cancel(); boardSlidesRef.current.delete(el); }
      if (Math.abs(dx) < 0.5) continue;
      const anim = el.animate([
        { transform: 'translateX(' + dx.toFixed(2) + 'px)' },
        { transform: 'translateX(0)' },
      ], { duration, easing });
      boardSlidesRef.current.set(el, anim);
      anim.onfinish = anim.oncancel = () => {
        if (boardSlidesRef.current.get(el) === anim) boardSlidesRef.current.delete(el);
      };
    }
  });

  // Share as image
  const shareReplayImage = async () => {
    const allCardNotations = [heroCards, boardCards, ...opponentCards].filter(Boolean);
    const allCards = allCardNotations.flatMap(n => parseCardNotation(n));
    try {
      /* 92: ensureExportFonts exists precisely because a canvas does not
         trigger webfont loading, and the share menu and the wrap-up viewer
         both await it — this path drew its titles, pot and hand names
         straight onto the canvas with no call, so the one export that is a
         still image was also the one that could silently come out in the
         fallback face. */
      await ensureExportFonts();
      const images = await loadCardImages(allCards);
      const outW = 1080, outH = 1080;
      const canvas = document.createElement('canvas');
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext('2d');

      // Felt background from the felt-colour picker, so the shared image matches
      // the table the user set (was a hardcoded navy gradient + green texture that
      // ignored the picker entirely).
      const _fst = feltStops(feltColor, rSettings.feltBright) || { lit: feltColor, shade: feltColor };
      const grad = ctx.createLinearGradient(0, 0, 0, outH);
      grad.addColorStop(0, _fst.lit);
      grad.addColorStop(1, _fst.shade);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, outW, outH);

      // Felt texture — faint neutral tint so it reads on any felt colour.
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      for (let y = 0; y < outH; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(outW, y); ctx.stroke();
      }

      // Title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px Univers Condensed, Univers, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(hand.gameType + ' Hand', outW / 2, 60);

      // Blinds
      ctx.font = '22px Univers Condensed, Univers, sans-serif';
      ctx.fillStyle = '#888888';
      const _bl = hand.blinds || {};
      ctx.fillText('Blinds ' + formatChipAmount(_bl.sb || 0) + '/' + formatChipAmount(_bl.bb || 0) + (_bl.ante ? ' (' + formatChipAmount(_bl.ante) + ')' : ''), outW / 2, 95);

      // Board cards (community games)
      let yPos = 140;
      if (category === 'community' && boardCards) {
        const bCards = parseCardNotation(boardCards);
        const cw = 70, ch = 98, gap = 8;
        const totalW = bCards.length * cw + (bCards.length - 1) * gap;
        let cx = (outW - totalW) / 2;
        ctx.font = '16px Univers Condensed, Univers, sans-serif';
        ctx.fillStyle = '#666666';
        ctx.fillText('BOARD', outW / 2, yPos);
        yPos += 14;
        for (const c of bCards) {
          const key = c.rank + c.suit;
          const img = images.get(key) || (c.suit === 'x' ? images.get('rank-only:' + c.rank) : null);
          if (img) { ctx.drawImage(img, cx, yPos, cw, ch); }
          else { ctx.fillStyle = '#333'; ctx.fillRect(cx, yPos, cw, ch); ctx.fillStyle = '#666'; ctx.font = '24px Univers Condensed'; ctx.textAlign = 'center'; ctx.fillText('?', cx + cw/2, yPos + ch/2 + 8); }
          cx += cw + gap;
        }
        yPos += ch + 20;
      }

      // Pot
      ctx.textAlign = 'center';
      ctx.font = 'bold 28px Univers Condensed, Univers, sans-serif';
      ctx.fillStyle = '#facc15';
      ctx.fillText('POT: ' + formatChipAmount(pot), outW / 2, yPos + 10);
      yPos += 50;

      // Players
      const cw = 50, ch = 70;
      hand.players.forEach((p, pi) => {
        const cards = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
        const parsed = parseCardNotation(cards);
        const isFolded = folded.has(pi);
        const seatClass = getPlayerSeatClass(pi);
        const handName = getPlayerHandName(pi);

        ctx.globalAlpha = isFolded ? 0.3 : 1;

        // Player name + stack
        ctx.font = 'bold 20px Univers Condensed, Univers, sans-serif';
        ctx.fillStyle = seatClass === 'winner' ? '#4ade80' : seatClass === 'loser' ? '#f87171' : '#ffffff';
        ctx.textAlign = 'left';
        const px = 80;
        ctx.fillText(p.name + ' (' + p.position + ')', px, yPos);
        ctx.font = '16px Univers Condensed, Univers, sans-serif';
        ctx.fillStyle = '#888888';
        ctx.fillText(formatChipAmount(stacks[pi]), px + 300, yPos);

        // Cards
        let cardX = px;
        yPos += 8;
        for (const c of parsed) {
          const key = c.rank + c.suit;
          const img = images.get(key);
          if (c.suit === 'x') {
            ctx.fillStyle = '#444';
            ctx.fillRect(cardX, yPos, cw, ch);
            ctx.fillStyle = '#888';
            ctx.font = '20px Univers Condensed';
            ctx.textAlign = 'center';
            ctx.fillText('?', cardX + cw/2, yPos + ch/2 + 6);
            ctx.textAlign = 'left';
          } else if (img) {
            ctx.drawImage(img, cardX, yPos, cw, ch);
          }
          cardX += cw + 4;
        }

        // Hand name
        if (handName) {
          ctx.font = '16px Univers Condensed, Univers, sans-serif';
          ctx.fillStyle = seatClass === 'winner' ? '#4ade80' : '#f87171';
          ctx.textAlign = 'left';
          ctx.fillText(handName, cardX + 12, yPos + ch / 2 + 4);
        }

        yPos += ch + 16;
        ctx.globalAlpha = 1;
      });

      // Result
      if (showResult && evalResult) {
        ctx.font = 'bold 24px Univers Condensed, Univers, sans-serif';
        ctx.textAlign = 'center';
        const rText = evalResult.map(r => r.result.text).join(' | ');
        const rColor = evalResult[0]?.result.color === 'green' ? '#4ade80' : evalResult[0]?.result.color === 'red' ? '#f87171' : '#facc15';
        ctx.fillStyle = rColor;
        ctx.fillText(rText, outW / 2, Math.min(yPos + 20, outH - 60));
      }

      // Watermark
      ctx.font = '14px Univers Condensed, Univers, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.textAlign = 'right';
      ctx.fillText('futurega.me', outW - 20, outH - 20);

      const dataUrl = canvas.toDataURL('image/png');
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'hand-replay.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const a = document.createElement('a');
        a.href = dataUrl; a.download = 'hand-replay.png'; a.click();
      }
    } catch (e) { console.error('Share replay error:', e); }
  };

  // ── Video export ──
  /* 81: the exporter has supported a greenscreen mode with its own chroma
     fill and an MP4 codec ladder for CapCut since it was written, and the only
     caller hardcoded 'transparent' behind a single button with no choice — a
     whole pipeline no user could reach. 98 adds the vertical framing the GIF
     had and the video did not. */
  const handleExportVideo = useCallback(async (mode = 'transparent') => {
    if (videoExporting) return;
    if (!tableRef.current) return;
    // A video needs MediaRecorder; without it say so before anything moves (App improvements 190).
    if (typeof window !== 'undefined' && typeof window.MediaRecorder === 'undefined') {
      toast?.error?.("Couldn't make the video here: this browser can't record one. Try Image or GIF, or the app.");
      return;
    }
    // Where the replay was, to put it back if the export fails.
    const was = { street: streetIdx, action: actionIdx, result: showResult };

    // Reset replay to start before recording
    setStreetIdx(0);
    setActionIdx(-1);
    setShowResult(false);
    setHiloAnimate(false);
    setPlaying(false);

    // Wait a tick for React to commit the reset
    await new Promise(r => setTimeout(r, 120));

    setVideoExporting(true);
    setVideoKind(mode);
    setVideoProgress(0);
    setVideoStep(0);

    const totalSteps = hand.streets.reduce((sum, s) => sum + 1 + (s.actions?.length || 0), 0) + 1;
    setVideoTotal(totalSteps);

    await exportReplayVideo({
      hand,
      tableEl: tableRef.current,
      stepForward: () => stepForwardRef.current?.(),
      canGoForwardRef,
      mode,
      speed,
      feltColor,
      onFrame: setExportPreview,
      onProgress: (pct, step, total) => {
        setVideoProgress(pct);
        setVideoStep(step);
        setVideoTotal(total);
      },
      /* 94: the video flow finished with no confirmation at all, unlike the
         GIF's three — so a successful export and a silently failed one looked
         identical from the outside. */
      onDone: (info) => {
        setVideoExporting(false);
        setVideoProgress(0);
        setExportPreview(null);
        if (info?.shareMethod === 'share-sheet') toast?.success?.('Share sheet opened');
        else toast?.success?.('Video saved');
      },
      onError: (err) => {
        console.error('Video export error:', err);
        setVideoExporting(false);
        setVideoProgress(0);
        setExportPreview(null);
        // It says so, with the reason one tap away, and the replay goes back to its step (190).
        setStreetIdx(was.street); setActionIdx(was.action); setShowResult(was.result);
        const why = (err && (err.message || String(err))) || 'unknown';
        toast?.error?.("Couldn't make the video here. Try Image or GIF, or the app.", { duration: 8000, action: { label: 'Details', onClick: () => toast?.info?.(why) } });
      },
    });
  }, [videoExporting, hand, speed, feltColor, toast, streetIdx, actionIdx, showResult]);

  const handleExportGif = useCallback(async () => {
    if (gifExporting || videoExporting) return;
    if (!tableRef.current) return;
    setStreetIdx(0); setActionIdx(-1); setShowResult(false);
    setHiloAnimate(false); setPlaying(false);
    await new Promise(r => setTimeout(r, 120));
    setGifExporting(true); setGifProgress(0); setGifStep(0);
    const totalSteps = hand.streets.reduce((sum, s) => sum + 1 + (s.actions?.length || 0), 0) + 1;
    setGifTotal(totalSteps);
    await exportReplayGif({
      hand,
      tableEl: tableRef.current,
      stepForward: () => stepForwardRef.current?.(),
      canGoForwardRef,
      speed,
      feltColor,
      onFrame: setExportPreview,
      onProgress: (pct, step, total) => { setGifProgress(pct); setGifStep(step); setGifTotal(total); },
      onDone: (info) => {
        setGifExporting(false); setGifProgress(0); setExportPreview(null);
        // Surface which path the share took so the user knows where the GIF went.
        if (info?.shareMethod === 'instagram') toast?.success?.('Opened Instagram with your replay');
        else if (info?.shareMethod === 'share-sheet') toast?.success?.('Share sheet opened');
        else if (info?.shareMethod === 'download') {
          // Diagnostic: when we fall through to a plain download, say WHY Instagram
          // was skipped so we can tell registration vs scheme vs open-call.
          const why = info?.igAttempted ? (info?.igError?.message || 'unknown error') : 'not native/iOS';
          toast?.error?.('GIF saved — Instagram: ' + why);
        }
      },
      onError: (err) => {
        console.error('GIF export error:', err);
        setGifExporting(false); setGifProgress(0); setExportPreview(null);
        toast?.error?.('GIF export failed: ' + (err?.message || 'unknown'));
      },
    });
  }, [gifExporting, videoExporting, hand]);

  /* Instagram Story (native iOS): Instagram has no transparent-overlay slot, so
     an ANIMATED replay must go into its full-frame backgroundVideo. We bake the
     poster's own photo behind the replay first — a plain file input makes iOS
     offer "Take Photo / Choose from Library", so both live in one gesture — then
     export a 1080x1920 clip and hand it to Instagram, which opens its editor on
     top for text and stickers. The picker MUST open synchronously inside the
     click (iOS blocks a file input opened after an await), so the export runs
     from the input's change handler. */
  const handleExportInstagramStory = useCallback(() => {
    if (videoExporting || gifExporting) return;
    if (!tableRef.current) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    const cleanup = () => { try { document.body.removeChild(input); } catch { /* already gone */ } };

    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) { cleanup(); return; }
      cleanup();

      // Keep the object URL alive — the adjust sheet uses it as the preview
      // background; it is revoked when the sheet closes.
      const photoUrl = URL.createObjectURL(f);
      let photoImg;
      try {
        photoImg = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = photoUrl;
        });
      } catch {
        URL.revokeObjectURL(photoUrl);
        toast?.error?.('Could not read that photo');
        return;
      }

      // A transparent still of the replay AS IT SITS NOW, so the sizing box is
      // WYSIWYG. Best-effort — the export captures its own frames from street 0,
      // so if this fails the sheet just shows the photo with no overlay preview.
      let stillUrl = null;
      try {
        const [{ domToCanvas }, cap] = await Promise.all([
          import('modern-screenshot'),
          import('../utils/replay-capture.js'),
        ]);
        const restore = cap.beginCapture(tableRef.current);
        await new Promise(r => setTimeout(r, 60));
        const elW = tableRef.current.offsetWidth, elH = tableRef.current.offsetHeight;
        const canvas = await domToCanvas(tableRef.current, {
          backgroundColor: null, width: elW, height: elH, scale: cap.exportScale(tableRef.current),
        });
        restore();
        stillUrl = canvas.toDataURL('image/png');
      } catch { /* preview still is optional */ }

      setIgScale(0.92);
      setIgSpeed(speed);
      setIgPos({ x: 0.5, y: 0.5 });
      setIgDraft({ photoUrl, photoImg, stillUrl });
    };

    input.click();
  }, [videoExporting, gifExporting, speed, toast]);

  // Render the story clip with the size + speed the poster chose in the sheet,
  // then hand it to Instagram (via exportReplayVideo's igShare path).
  const handleCreateInstagramStory = useCallback(async () => {
    if (!igDraft || videoExporting || gifExporting) return;
    const { photoImg, photoUrl } = igDraft;
    const chosenScale = igScale;
    const chosenSpeed = igSpeed;
    const chosenCenter = igPos;
    setIgDraft(null);
    URL.revokeObjectURL(photoUrl);

    setStreetIdx(0); setActionIdx(-1); setShowResult(false);
    setHiloAnimate(false); setPlaying(false);
    await new Promise(r => setTimeout(r, 120));

    setVideoExporting(true); setVideoKind('igstory'); setVideoProgress(0); setVideoStep(0);
    const totalSteps = hand.streets.reduce((sum, s) => sum + 1 + (s.actions?.length || 0), 0) + 1;
    setVideoTotal(totalSteps);

    await exportReplayVideo({
      hand,
      tableEl: tableRef.current,
      stepForward: () => stepForwardRef.current?.(),
      canGoForwardRef,
      mode: 'story',
      speed: chosenSpeed,
      feltColor,
      backgroundImage: photoImg,
      igShare: true,
      tableScale: chosenScale,
      tableCenter: chosenCenter,
      onFrame: setExportPreview,
      onProgress: (pct, step, total) => { setVideoProgress(pct); setVideoStep(step); setVideoTotal(total); },
      onDone: (info) => {
        setVideoExporting(false); setVideoProgress(0); setExportPreview(null);
        if (info?.shareMethod === 'instagram') toast?.success?.('Opened Instagram with your replay');
        else if (info?.shareMethod === 'share-sheet') toast?.success?.('Share sheet opened');
        else toast?.success?.('Story video saved');
      },
      onError: (err) => {
        console.error('Instagram story export error:', err);
        setVideoExporting(false); setVideoProgress(0); setExportPreview(null);
        toast?.error?.('Story export failed: ' + (err?.message || 'unknown'));
      },
    });
  }, [igDraft, igScale, igSpeed, igPos, videoExporting, gifExporting, hand, feltColor, toast]);

  const closeIgDraft = useCallback(() => {
    setIgDraft(prev => { if (prev?.photoUrl) URL.revokeObjectURL(prev.photoUrl); return null; });
  }, []);

  // Position + size the replay in the 9:16 preview by touch: one finger pans,
  // two fingers pinch to scale (and pan by the pinch midpoint). Position is the
  // replay's CENTRE and scale its width, both as fractions of the frame, handed
  // to the export as tableCenter / tableScale. Every finger down or up
  // re-baselines from the current pos/scale so 1↔2-finger transitions never
  // jump. Pointer capture keeps a finger's events on the box if it strays out.
  const IG_MIN = 0.3, IG_MAX = 1.0;
  const igRebase = useCallback(() => {
    const g = igGestureRef.current;
    g.rect = igBoxRef.current?.getBoundingClientRect() || null;
    g.startScale = igScaleRef.current;
    g.startPos = { ...igPosRef.current };
    const pts = [...g.pointers.values()];
    if (pts.length === 1) {
      g.startX = pts[0].x; g.startY = pts[0].y;
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      g.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      g.startMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }, []);
  const igPointerDown = useCallback((e) => {
    if (!igBoxRef.current) return;
    e.preventDefault();
    igBoxRef.current.setPointerCapture?.(e.pointerId);
    igGestureRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    igRebase();
  }, [igRebase]);
  const igPointerMove = useCallback((e) => {
    const g = igGestureRef.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = g.rect;
    if (!rect) return;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const pts = [...g.pointers.values()];
    if (pts.length === 1) {
      setIgPos({
        x: clamp01(g.startPos.x + (pts[0].x - g.startX) / rect.width),
        y: clamp01(g.startPos.y + (pts[0].y - g.startY) / rect.height),
      });
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setIgScale(Math.min(IG_MAX, Math.max(IG_MIN, g.startScale * (dist / g.startDist))));
      setIgPos({
        x: clamp01(g.startPos.x + (mid.x - g.startMid.x) / rect.width),
        y: clamp01(g.startPos.y + (mid.y - g.startMid.y) / rect.height),
      });
    }
  }, []);
  const igPointerUp = useCallback((e) => {
    const g = igGestureRef.current;
    if (!g.pointers.delete(e.pointerId)) return;
    igBoxRef.current?.releasePointerCapture?.(e.pointerId);
    if (g.pointers.size > 0) igRebase(); // keep the remaining finger(s) smooth
  }, [igRebase]);

  // ── OFC Replay View ──
  if (hand.gameType === 'OFC') {
    const ofcRows = hand.ofcRows || {};
    const ofcStreetNames = getStreetDef('OFC').streets;
    // Determine how many cards to show per row based on current street
    const ofcCardsShownPerPlayer = (pi) => {
      const pr = ofcRows[pi] || { top: '', middle: '', bottom: '' };
      const topCards = parseCardNotation(pr.top || '').filter(c => c.suit !== 'x');
      const midCards = parseCardNotation(pr.middle || '').filter(c => c.suit !== 'x');
      const botCards = parseCardNotation(pr.bottom || '').filter(c => c.suit !== 'x');
      const totalCards = topCards.length + midCards.length + botCards.length;
      const cardsToShow = streetIdx === 0 ? Math.min(5, totalCards) : Math.min(5 + streetIdx, totalCards);
      const shown = { top: '', middle: '', bottom: '' };
      let remaining = cardsToShow;
      // Show bottom first, then middle, then top (fill from bottom up)
      const botShow = Math.min(botCards.length, remaining);
      shown.bottom = botCards.slice(0, botShow).map(c => c.rank + c.suit).join('');
      remaining -= botShow;
      const midShow = Math.min(midCards.length, remaining);
      shown.middle = midCards.slice(0, midShow).map(c => c.rank + c.suit).join('');
      remaining -= midShow;
      const topShow = Math.min(topCards.length, remaining);
      shown.top = topCards.slice(0, topShow).map(c => c.rank + c.suit).join('');
      return shown;
    };
    const ofcTotalStreets = ofcStreetNames.length;
    return (
      <div className="replayer-replay ofc-replay">
        {showSettings && <ReplayerSettingsPanel onClose={() => setShowSettings(false)} settings={rSettings} onUpdate={handleSettingsUpdate} />}
        <div className="ofc-replay-board">
          {hand.players.map((p, pi) => {
            const shownCards = ofcCardsShownPerPlayer(pi);
            const pr = ofcRows[pi] || { top: '', middle: '', bottom: '' };
            const isHero = pi === (hand.heroIdx || 0);
            return (
              <div key={pi} className={'ofc-replay-player' + (isHero ? ' ofc-hero' : '')}>
                <div className="ofc-replay-player-name">{p.name}</div>
                <div className="ofc-replay-rows">
                  <div className="ofc-replay-row ofc-replay-row-top"><div className="ofc-replay-row-label">Top</div><CardRow text={showResult ? pr.top : shownCards.top} max={3} placeholderCount={3} /></div>
                  <div className="ofc-replay-row ofc-replay-row-middle"><div className="ofc-replay-row-label">Middle</div><CardRow text={showResult ? pr.middle : shownCards.middle} max={5} placeholderCount={5} /></div>
                  <div className="ofc-replay-row ofc-replay-row-bottom"><div className="ofc-replay-row-label">Bottom</div><CardRow text={showResult ? pr.bottom : shownCards.bottom} max={5} placeholderCount={5} /></div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="ofc-street-indicator">
          <span className="ofc-street-name">{ofcStreetNames[streetIdx] || 'Final'}</span>
          <span className="ofc-street-count">{streetIdx + 1} / {ofcTotalStreets}</span>
        </div>
        <div className="replayer-controls" style={{marginTop:'var(--space-md)'}}>
          <button className="btn btn-ghost btn-sm" disabled={streetIdx === 0 && !showResult} onClick={() => { if (showResult) setShowResult(false); else if (streetIdx > 0) setStreetIdx(streetIdx - 1); }}>Prev</button>
          <button className="btn btn-ghost btn-sm" disabled={showResult} onClick={() => { if (streetIdx < ofcTotalStreets - 1) setStreetIdx(streetIdx + 1); else setShowResult(true); }}>Next</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowResult(!showResult)}>{showResult ? 'Hide All' : 'Show All'}</button>
        </div>
        <div style={{display:'flex',gap:'var(--space-sm)',justifyContent:'space-between',marginTop:'var(--space-lg)'}}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>Back to List</button>
          <div style={{display:'flex',gap:'var(--space-sm)'}}>
            <button className="btn btn-ghost btn-sm" onClick={copyShareLink}>{shareLinkCopied ? 'Copied!' : 'Share Link'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(!showSettings)}>Settings</button>
            <button className="btn btn-primary btn-sm" onClick={onEdit}>Edit</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Table layout ──
     These were ten hand-written coordinate tables holding two numbers each —
     x in [18,82] and y in [16,84] — which are exactly the felt's old inset,
     copied by hand. They are derived from it now, so changing the table's
     shape moves the seats with it instead of leaving them floating over the
     new felt. The felt is currently inset 24% vertically and 10%
     horizontally, which makes the playing surface wide and shallow (see the
     --felt-y / --felt-x block in styles.css) and hands the recovered height
     to the top and bottom seats, whose cards extend a card's height above
     the marker and used to sit close to the export's clipping edge. */
  /* The felt was inset 16% top and bottom, which put a fifth of the table's
     height below the bottom seat row doing nothing — the seats need room for a
     plaque and the fan standing above it, not for a fifth of the table. 11%
     spreads the seat ring over more of the box and grows the cloth with it. */
  /* ── The grid ────────────────────────────────────────────────────────
     16 columns by 32 rows. On a table that is about one-to-two those cells
     are square — measured 23.3 x 23.2px at 393x852 — and a square cell is the
     whole point: a step means the same thing on both axes, so placing things
     evenly round the ring stops being trigonometry and becomes counting.

     The 8-max spacing is the proof. Solved by hand it was
        corner^2 = 17.6^2 + (35-d)^2 = d^2  ->  d = 21.9% of the height
     and on the grid it is: the corner step goes 5.5 columns across and 4 rows
     down, the middle step is e rows, so 5.5^2 + (11-e)^2 = e^2 and e = 6.875.
     Seven cells. Three seats down a side, seven cells apart. */
  const GX = 16, GY = 32;
  const gx = (col) => +(col * 100 / GX).toFixed(3);   // column -> % of width
  const gy = (row) => +(row * 100 / GY).toFixed(3);   // row    -> % of height

  /* The felt is a grid rectangle: in to column 2 and row 3 (--felt-x / --felt-y
     in styles.css). */
  /* The seat ring runs half a cell inside the felt's edge at the top, row 5.
     The bottom row is 28 rather than 27, so the ring is NOT symmetric about
     row 16 any more — deliberately, because the seat on it is not a seat like
     the others. RB appears exactly once in every layout below and the rotation
     always lands the hero on it, so this row is the hero's alone, and the
     hero is the only seat carrying a hand-name label under its plaque.
     Measured at showdown before the move: that label's underside sat 0.13 of
     a cell above the felt's edge and 3.13 above the table's — out of cloth,
     but with three cells of cushion still under it. Two of them are now
     spent — 27 to 28, then 28 to 29 — leaving 1.13 cells of cushion under the
     label.

     The TOP row moves the other way, 5 to 4, for the reason landscape already
     lifts its own top run: those seats have the whole cushion above them and
     no neighbour behind. Measured before the move, every seat on this row had
     its highest ink 2.11 cells from the table's top edge and 0.89 ABOVE the
     felt's — already on the rail, with two cells spare. One is spent; 1.11
     remain. Unlike RB this row is shared — one seat at 4, 6 and 8-max, two at
     3, 5, 7 and 9, three at 10 — and they all lift together, which is what it
     means for a run to be a run. */
  const CL = 2.5, CC = 8, CR = 13.5;      // seat columns
  const RT = 4, RB = 29;                  // seat rows, top run and hero
  const seat = (col, row) => [gx(col), gy(row)];

  /* Steps of seven cells down each side for three-a-side, and of nine for
     two-a-side (3f^2 + 22f - 151.25 = 0 -> f = 4.4, so 16 +/- 4.5). A pair of
     seats along the top starts its corner step three columns out rather than
     5.5, which is why 7 and 9-max sit a little wider than 6 and 8. */
  const layouts = {
    2:  [seat(CC,RT), seat(CC,RB)],
    /* Three-handed: the two opponents take the TOP seat of each side (left and right
       columns, row 10 — where 9-max's upper side seats sit), not the top run; the hero
       keeps the bottom. Ring order is unchanged: left, hero, right. */
    3:  [seat(CL,10), seat(CC,RB), seat(CR,10)],
    4:  [seat(CC,RT), seat(CR,16), seat(CC,RB), seat(CL,16)],
    /* Odd counts (5/7/9) have TWO top seats. A layout is a ring — consecutive
       players must be ADJACENT seats — but these listed top-left first and
       top-right last, so index 0→1 and (n-2)→(n-1) each jumped clean across the
       top (the same fault the 10-max note fixed). Putting top-RIGHT first and
       top-LEFT last makes the ring continuous (down the right, across the
       bottom, up the left, and the two top seats meet at the wrap). Bottom
       stays at index ⌊n/2⌋ so the hero-to-bottom rotation is unchanged. */
    5:  [seat(10.5,RT), seat(CR,16), seat(CC,RB), seat(CL,16), seat(5.5,RT)],
    6:  [seat(CC,RT), seat(CR,11.5), seat(CR,20.5), seat(CC,RB), seat(CL,20.5), seat(CL,11.5)],
    7:  [seat(10.5,RT), seat(CR,12), seat(CR,20), seat(CC,RB), seat(CL,20), seat(CL,12), seat(5.5,RT)],
    8:  [seat(CC,RT), seat(CR,9), seat(CR,16), seat(CR,23), seat(CC,RB), seat(CL,23), seat(CL,16), seat(CL,9)],
    9:  [seat(10.5,RT), seat(CR,10), seat(CR,16), seat(CR,22), seat(CC,RB), seat(CL,22), seat(CL,16), seat(CL,10), seat(5.5,RT)],
    /* FOUR a side, not three across the top. Every other even count already
       runs one seat on the top row, one on the bottom and the rest split
       evenly down the two sides — 8-max is 1/3/1/3, 6-max is 1/2/1/2, 4-max
       is 1/1/1/1 — and 10-max was the only one that broke it with a row of
       three. A portrait table is 16 x 32: the long sides are where seats go.

       It also fixes an ORDERING fault that the three-seat top row carried.
       A layout is a ring — consecutive players must be adjacent seats — and
       measured round the old one, Opp 3 to Opp 4 was a jump of 10 cells and
       Opp 4 to Opp 5 a jump of 8, because the three top seats sat at indices
       0, 1 and 9 in the order left, centre, right. One seat on that row cannot
       be out of sequence with itself.

       The rows come from the derivation the three-a-side row already uses:
       the corner step goes 5.5 columns across and (12 - 1.5e) rows down, the
       middle step is e rows, so 5.5^2 + (12 - 1.5e)^2 = e^2 and e = 6.156.
       Rounded to 6 it lands on whole rows 7, 13, 19 and 25, symmetric about
       16, with the corner step at 6.27 against the middle's 6.00 — a 4%
       difference, against rows that would otherwise read 6.77 and 25.23. */
    10: [seat(CC,RT), seat(CR,7), seat(CR,13), seat(CR,19), seat(CR,25), seat(CC,RB), seat(CL,25), seat(CL,19), seat(CL,13), seat(CL,7)],
  };

  /* ── The landscape ring ──────────────────────────────────────────────
     32 columns by 16 rows — the transpose, so the cells are square again on a
     2:1 table. Landscape had been using the PORTRAIT ring, seats running down
     long edges that a wide table does not have, which is why it read as the
     portrait table stretched sideways.

     The ring is a stadium: straight runs along the top and bottom, semicircular
     ends. Even spacing on a stadium is closed-form —

         per = 2 * straight + 2 * pi * r

     — so the seats sit `per / n` apart along it for ANY n, with none of the
     per-seat-count algebra the portrait ring needed. The path starts at the
     top-centre and runs clockwise, which puts index n/2 at the bottom-centre,
     where the rotation seats the hero. */
  /* 24 x 16 is 3:2 — still square cells, but a narrower table for the same
     height than the 2:1 that filled the window. At a 900px slot that is 1350
     wide rather than 1600, which is the margin the reference table has. */
  const LGX = 28, LGY = 16;                 // 1.75, the reference's measured 1.745
  /* Derived, not chosen. Measured the slack between the outermost furniture
     and the table's edge at each side and moved the ring by exactly that:
     left was -31px and right -33px (overflowing, so in by 0.63 of a column),
     top had 64px spare (out by 1.25 rows), bottom had none (stays put).
     Re-measured after, which is the only way to know it landed. */
  /* Converted across the grid change (22x16 -> 24x15), which is arithmetic,
     not a re-judgement: 2.27/22*24, 19.73/22*24, 3.33/16*15, 15.1/16*15. */
  /* Converted across the grid change (24x15 -> 28x16), arithmetic rather
     than a re-judgement: 2.48/24*28, 21.52/24*28, 3.12/15*16, 14.16/15*16. */
  const RING = { l: 2.89, r: 25.11, t: 3.33, b: 15.1 };
  const landscapeSeats = (count) => {
    const rad = (RING.b - RING.t) / 2;        // 5.5 — a true stadium end
    const cy = (RING.t + RING.b) / 2;         // 8
    const xL = RING.l + rad, xR = RING.r - rad;
    const straight = xR - xL;
    const arc = Math.PI * rad;
    const per = 2 * straight + 2 * arc;
    const at = (d) => {
      let k = ((d % per) + per) % per;
      if (k < straight / 2) return [xL + straight / 2 + k, RING.t, 'top'];   // top, centre -> right
      k -= straight / 2;
      if (k < arc) { const a = -Math.PI / 2 + k / rad; return [xR + rad * Math.cos(a), cy + rad * Math.sin(a), 'arc']; }
      k -= arc;
      if (k < straight) return [xR - k, RING.b, 'bottom'];                   // bottom, right -> left
      k -= straight;
      if (k < arc) { const a = Math.PI / 2 + k / rad; return [xL + rad * Math.cos(a), cy + rad * Math.sin(a), 'arc']; }
      k -= arc;
      return [xL + k, RING.t, 'top'];                                        // top, left -> centre
    };
    /* The top run sits one cell above the ring's own top edge. Those seats
       have the whole cushion above them and no neighbour behind, so the lift
       costs nothing and puts their cards over the rail the way the reference's
       top player's are. Applied to the seats ON the top run — for 8-max that
       is the centre one at RING.t and the two just onto the arc at RING.t+0.34
       — and to nothing else, so the side and bottom seats do not move. */
    const TOP_LIFT = 1;
    /* The four corner seats sit one cell further from the centre line and one
       cell nearer it vertically — the upper pair down, the lower pair up.
       Corners are the seats on the ARCS, which is where the ring turns, and
       that is why at() reports its segment: no row threshold separates them,
       since the two upper corners fall within half a cell of the top straight
       and are lifted with it.

       A seat within half a cell of the ring's left or right extreme takes the
       outward cell but NOT the vertical one. It was taking neither, on the
       grounds that it is already as far out as the cloth goes — which is true
       of the cloth and not of the table. Measured at 8-max landscape, those
       two seats' outermost ink sits 0.29 of a cell PAST the felt's edge and a
       full cell short of the table's, while the four corner seats have 2.7 to
       4 cells of room. One cell was sitting there unused on the only two seats
       that looked crowded.
       The vertical half is withheld because it has no meaning here: a seat at
       the horizontal extreme sits ON the centre line, so `r < cy` is false and
       the seat would be lifted a cell toward a centre it is already level
       with. At 9 and 10-max there is one such seat on each side. */
    const CORNER_OUT = 1, CORNER_IN = 1;
    const cxRing = (RING.l + RING.r) / 2;
    return Array.from({ length: count }, (_, i) => {
      const [c, r, seg] = at(per * i / count);
      let x = c;
      let y = r <= RING.t + 0.5 ? r - TOP_LIFT : r;
      const atExtreme = Math.abs(c - RING.l) < 0.5 || Math.abs(c - RING.r) < 0.5;
      if (seg === 'arc') {
        x = c + (c < cxRing ? -CORNER_OUT : CORNER_OUT);
        /* Not at 10-max: there both of a side's seats are on its arc, and the cell each took toward the centre line
           took two from between them, so the upper one's action label sat on the lower one's cards (owner,
           2026-11-15: collisions; check:replayer-collisions at 1440 and 1728). */
        if (!atExtreme && count < 10) y = y + (r < cy ? CORNER_IN : -CORNER_IN);
      }
      return [+(x * 100 / LGX).toFixed(3), +(y * 100 / LGY).toFixed(3)];
    });
  };

  /* 6-max landscape is taken straight off the reference rather than from the
     even-perimeter walk, because the reference is NOT evenly spaced: measured
     round its ring the steps are 575, 497, 540, 538, 492, 575 — the vertical
     ones deliberately short, so the side seats sit at the very ends of the
     cloth (2.7% and 97.4% of the felt's width). An even walk lands them at
     about 90%, which is what read as huddling round the middle.

     Its six plaque centres, in felt percentages, converted through this
     table's felt inset (4.6% x, 5.8% y) to grid columns and rows. Clockwise
     from the top so index 3 is the bottom centre, where the hero sits. */
  /* 6-max takes the same two adjustments the walk does, so the two layouts
     agree: the top-run seat is lifted one cell, and the four corner seats move
     one cell nearer the horizontal centre line vertically. The bottom-centre
     seat is on the bottom straight and does not move, which is the walk's rule
     too.

     Horizontally these four are the table's LEFT and RIGHT players, and they
     come in. The walk's one-cell push outward put them at 3.48% and 96.57%,
     overhanging the rail — three cells back in from there is two cells inside
     the reference figure, which is the -2 below. The walk itself is not
     changed: its left and right players are the middle side seats at 10.3% and
     89.7%, and three cells in would land them at 21.0% and 79.0%, the same
     column as its corners at 21.4% and 78.6%, stacking three seats in a
     line.

     The reference figures stay written out beside each seat. They are what the
     positions were measured from, and the adjustment is deliberate movement
     away from them rather than a correction to them — worth being able to see
     at a glance which is which. */
  const CELL_X = 100 / LGX, CELL_Y = 100 / LGY;
  /* The four side seats share two vertical axes, one a side. They had four
     different columns — 14.19 and 16.44 on the left, 85.86 and 84.26 on the
     right — because each came from its own measured reference point, and four
     columns for four seats that read as two pairs is just wobble.

     The axis is the mean of their four distances from the nearer edge: 14.19,
     16.44, 14.14 and 15.74 average to 15.13% of the width, which is 4.24 cells
     and snaps to 4. Symmetric by construction, since the right axis is the
     left one subtracted from the table. */
  /* 3 cells, 10.7% (owner, 2026-11-22: "These seats seem too far in from the edge of the table"): at 4 the side
     plaques sat wholly on the cloth, a cell inside its edge, while the top and bottom seats sit on the rail. */
  const SIDE_X = 3 * CELL_X;            // 10.714%
  const LANDSCAPE_6 = [
    [50.0,          20.8 - CELL_Y],   // top centre        ref 50, 17
    [100 - SIDE_X,  35.0 + CELL_Y],   // upper right       ref 97.4, 33
    [100 - SIDE_X,  87.1 - CELL_Y],   // lower right       ref 95, 92
    [50.0,          97.7],            // bottom centre     ref 50, 104
    [SIDE_X,        87.1 - CELL_Y],   // lower left        ref 5.2, 92
    [SIDE_X,        35.0 + CELL_Y],   // upper left        ref 2.7, 33
  ];

  /* Snap to the grid. A seat is CENTRED on its point rather than aligned to a
     cell edge, so the unit is the half cell — 100/28/2 across and 100/16/2
     down — which is what the overlay measures against. Landscape only: the
     portrait ring already lands on it exactly (worst offset 0px), while the
     landscape seats came from reference percentages and a perimeter walk that
     never had the cell edges in view, and measured 9-11px off.

     Applied last, after the walk and after the top-run lift, so it is the one
     thing that decides the final position and nothing downstream reintroduces
     a fraction of a cell. */
  const halfX = 100 / LGX / 2, halfY = 100 / LGY / 2;
  const snapSeat = ([x, y]) => [
    +(Math.round(x / halfX) * halfX).toFixed(3),
    +(Math.round(y / halfY) * halfY).toFixed(3),
  ];

  const n = hand.players.length;
  /* Fewer than six players (a final table, a short-handed game) sit in the 6-max table's seats with the rest
     left empty (owner, 2026-11-13: "still put the players in positions that exist for a 6-max table, just
     leave empty seats blank"). The players keep their order clockwise from the hero at the bottom, and the
     gaps fall unevenly, the way a real short table looks (owner: "better if it's not symmetrical when
     possible"). SIX_MAX_OF[n][k] is player k's seat, counted clockwise from the hero's: 0 bottom, 1 lower
     left, 2 upper left, 3 top, 4 upper right, 5 lower right. */
  const SIX_MAX_OF = { 2: [0, 2], 3: [0, 1, 3], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 5] };
  let seats;
  if (n >= 2 && n < 6) {
    const six = isLandscape ? LANDSCAPE_6.map(snapSeat) : layouts[6];
    seats = hand.players.map((_, i) => six[(3 + SIX_MAX_OF[n][(i - replayHeroIdx + n) % n]) % 6]);
  } else {
    const rawSeats = isLandscape
      ? (n === 6 ? LANDSCAPE_6 : landscapeSeats(Math.min(Math.max(n, 2), 10))).map(snapSeat)
      : (layouts[Math.min(Math.max(n, 2), 10)] || layouts[6]);
    const bottomIdx = Math.floor(n / 2);
    const rotation = (bottomIdx - replayHeroIdx + n) % n;
    seats = rawSeats.map((_, i) => rawSeats[(i + rotation) % n]);
  }

  /* The dealer stands just outside the button's seat, and the muck sits beside
     the deck. Both are pulled toward the table centre so they land on cloth
     rather than on the rail. */
  const btnIdx = hand.players.findIndex(p => p.position === 'BTN' || p.position === 'D');
  const btnSeat = seats[btnIdx] || seats[0] || [50, 50];
  /* The corner of the name box the button sits on, in the stated order:
     closest to the table's centre first, furthest clockwise to break the tie.

     Facing the centre answers it for every seat except those on a centre line,
     where two corners are equidistant — and that is precisely where the
     clockwise rule decides. The clockwise tangent at a point is (-dy, dx) on a
     y-down screen, so its sign settles whichever axis came out level. */
  const btnCorner = (() => {
    const [bx, by] = btnSeat;
    const dx = bx - 50, dy = by - 50;
    const EPS = 3;                                   // "on the centre line"
    const sx = Math.abs(dx) > EPS ? (dx < 0 ? 1 : -1) : (-dy < 0 ? -1 : 1);
    // A lower corner, the side facing the centre (owner, 2026-11-15: back on the corner): the cards and the action pill
    // are on the plaque's top edge (styles.css .replayer-dealer-btn.corner-bl/-br).
    return 'b' + (sx > 0 ? 'r' : 'l');
  })();
  /* Rendered: a 15% step round the rail from the button's seat put the deck
     squarely on the NEXT player's fan. There is no gap at the rail on a full
     table, so the deck comes IN off the rail rather than along it — a third
     of the way to the middle, with only a small step to the side. */
  const dealerSpot = (() => {
    const vx = 50 - btnSeat[0], vy = 54 - btnSeat[1];
    const len = Math.hypot(vx, vy) || 1;
    const ux = vx / len, uy = vy / len;      // toward the middle of the felt
    const px = -uy, py = ux;                 // and a small step to one side
    return [
      Math.round(btnSeat[0] + (50 - btnSeat[0]) * 0.34 + px * 7),
      Math.round(btnSeat[1] + (54 - btnSeat[1]) * 0.34 + py * 5),
    ];
  })();
  const muckTarget = [
    Math.round(dealerSpot[0] + (50 - dealerSpot[0]) * 0.26),
    Math.round(dealerSpot[1] + (54 - dealerSpot[1]) * 0.26),
  ];

  /* This effect has to live BELOW seats, folded and markPotLanding: a
     dependency array is evaluated on every render, not when the effect
     runs, so naming a const that is declared further down the component
     puts the render itself in that const’s temporal dead zone. */
  /* 70: nothing moved at a street boundary — animStreetTransition drove the
     board's own classes and the rest of the table was static, so the wagers
     standing in front of the players simply vanished as the next street
     began. Collecting the bets is the physical event that SEPARATES two
     streets; without it the streets run together. The chip-flight system was
     right there.

     47: spawnFlyingChips computes the denomination colour, staggers up to
     five chips and has a live render block and a denominated variant — and
     nothing in the file ever called it, so flyingChips was permanently empty
     and the whole system was decoration on an unreachable code path. The step
     effect is where a wager actually happens, so that is where it belongs. */
  const prevChipStepRef = useRef('');
  useEffect(() => {
    if (!rSettings.animateChips) return;
    const key = streetIdx + ':' + actionIdx + ':' + (showResult ? 'r' : '');
    const prev = prevChipStepRef.current;
    prevChipStepRef.current = key;
    if (!prev || prev === key) return;
    // Scrubbing backwards should not re-throw chips that are already in the pot.
    const [pS, pA] = prev.split(':').map(Number);
    if (streetIdx < pS || (streetIdx === pS && actionIdx < pA)) return;

    /* The spring path moves the chips itself (the moments layout effect below): the push-out, the
       sweep and the ship. It drops markPotLanding, whose two re-renders served a rule that is
       animation: none. */
    if (springOn) return;

    if (showResult) {
      /* 48: the pot travelling to the winner is the payoff shot of a poker
         broadcast, and animPotCollect was declared, never set and never read
         while potCollect sat unused — so at showdown the pot pill simply sat
         there. One burst per winner, from the pot toward the seat. */
      const winners = hand.result?.winners || [];
      winners.forEach(w => {
        const seat = seats[w.playerIdx];
        // The denominations should be the ones this seat is actually paid —
        // a quartered player is not shipped the whole pot.
        const amt = (potAwards && potAwards[w.playerIdx]) || pot;
        if (seat) spawnFlyingChips([50, 37], seat, 5, true, amt);
      });
      if (winners.length) {
        setAnimPotCollect(true);
        setTimeout(() => setAnimPotCollect(false), 700);
      }
      return;
    }
    // 70: a new street means the previous street's bets are swept in.
    if (streetIdx > pS && actionIdx < 0) {
      const sweeping = hand.streets[pS]?.actions || [];
      const seen = new Set();
      sweeping.forEach(a => {
        if (!a.amount || seen.has(a.player) || folded.has(a.player)) return;
        seen.add(a.player);
      });
      /* No chips fly in. What a player has bet is already sitting in front of
         them, and the pot still reacts when it takes them. */
      if (seen.size) markPotLanding();
      return;
    }

    const act = currentActions[actionIdx];
    if (!act || !act.amount) return;
    if (act.action !== 'bet' && act.action !== 'raise' && act.action !== 'call' && act.action !== 'all-in') return;
    if (seats[act.player]) markPotLanding();
  }, [streetIdx, actionIdx, showResult, rSettings.animateChips, currentActions, seats, hand, pot, potAwards, spawnFlyingChips, folded, markPotLanding, springOn]);

  /* ── The spring moments ──
     After every commit, before the browser paints it: a moment starts in the very commit that
     changes the table, so its first frame is the press frame and nothing shows the new state
     un-animated for a frame. Only a single step forward performs anything (motionKind); a jump
     finishes what is running. Under an export ([data-capturing]) the springs are created paused
     and the exporter seeks them frame by frame (replay-capture.js). See utils/replayer-motion.js.

     READ, then WRITE. The press is the frame an old phone can least afford, so every rect this
     moment needs is read in one pass first, while the layout React just committed is still clean
     (the board effect above has already laid it out), and only then are ghosts and chips created
     and springs started. Nothing in the write half reads the DOM back. */
  /* Wagers clear of their own seat (owner, 2026-11-15: "We really need to figure out how to prevent these collisions";
     npm run check:replayer-collisions). chipStyle puts a wager a share of the way to the pot, and a share cannot know
     how tall the seat's plaque, action label, draw run and readout are at this size, or where its button sits: on a
     short or crowded table the chips landed on them. Here, after layout and before the moment below reads the wagers'
     places, each wager starts at that spot (data-base-left/top) and, coming within 1r of any of its seat's pieces,
     moves on toward the pot until 1r of cloth shows (a side seat's straight in, level with it). It is written back
     as left/top percentages, the form the push-out and the sweep's ghosts read. */
  /* r and g in px as the felt has them: a child of the table, where they are the table's (its shorter side over 35),
     not the screen's. A custom property reads back as its unresolved text, so it is measured; never
     parseFloat(getPropertyValue('--gu')), which is NaN, and whose fallback (the pane's width over 37) put every margin
     written in var(--gu) at 57% of what was measured on a desktop pane (2026-11-16). */
  const subrowPxRef = useRef({ w: '', px: 8 });
  const subrowPx = (table) => {
    const key = window.innerWidth + ':' + table.clientWidth + 'x' + table.clientHeight;
    if (subrowPxRef.current.w !== key) {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
      table.appendChild(probe);
      subrowPxRef.current = { w: key, px: probe.getBoundingClientRect().height / 100 || 8 };
      probe.remove();
    }
    return subrowPxRef.current.px;
  };
  const guPx = (table) => subrowPx(table) / 0.71;
  /* keepCardRowsOn (owner, 2026-11-13): a seat's row of cards wider than its plaque (seven stud cards) under a
     side seat ran off the screen (Opp 7's last card and backs were cut). The row, measured by its layout box (its
     cards' own transforms, a deal in flight, do not count), is moved in until it is 0.5g clear of the edge, by
     `left`, since the cards' moments own their transforms.
     And off the replay's own buttons above the felt (2026-11-16): a top seat's cards that play rise a whole r at a
     result, and at seven seats on a phone the raised row met Note and Tags. Each card is taken where its pose leaves
     it (its drawn box, less the lift it is part way through, plus its pose's), and the row moves down by the shortfall,
     by `top`. */
  /* The table's foot (owner, 2026-11-17: "Bottom part of hero is cut off"). On a phone the table is the slot's height
     less 4r, and the slot clips at its foot, just above the street track. 4r is what a hand name under the bottom
     seat's plaque needs; a draw game hangs its D1/D1/PAT run there as well, with the name under it, and on an iPhone
     with the admin row the pair ran past the clip. So the stack the bottom seat will hold at its fullest is measured
     (the run and the name, one line or a hi-lo's two, as invisible stand-ins where the step has none yet: the same
     answer at every step, so the table never changes size mid-hand) and the table gives up just what it needs to
     end 0.5r above the clip. Not on the desktop pane, whose table has room under it. */
  const placeTableFoot = (table) => {
    const slot = table.parentElement;
    if (!slot || !slot.classList.contains('replayer-table-slot') || !table.closest('.replayer-fullbleed')) return;
    table.style.height = '';
    if (!table.clientHeight || !slot.clientHeight) return;
    let low = null, lowB = -Infinity;
    table.querySelectorAll('.replayer-seat[data-seat]').forEach(st => {
      const pl = st.querySelector('.replayer-seat-info');
      const b = pl ? pl.getBoundingClientRect().bottom : -Infinity;
      if (b > lowB) { lowB = b; low = st; }
    });
    if (!low) return;
    const plaque = low.querySelector('.replayer-seat-info');
    const stand = [];
    const standIn = (parent, cls, text) => {
      const e = document.createElement('div');
      e.className = cls; e.textContent = text;
      e.style.visibility = 'hidden'; e.style.animation = 'none';
      parent.appendChild(e); stand.push(e);
    };
    if (isDrawGame && !gameCfg.discardOnly && !plaque.querySelector('.replayer-seat-draw-badge')) standIn(plaque, 'replayer-seat-draw-badge', 'D3/D3/PAT');
    const names = [...low.querySelectorAll('.replayer-seat-hand-name:not([data-ghost])')];
    names.forEach(e => { e.style.marginLeft = ''; e.style.marginTop = ''; delete e.dataset.spot; });
    if (!names.length) standIn(low, 'replayer-seat-hand-name', isHiLo ? 'Hi: Two Pair' + String.fromCharCode(10) + 'Lo: 8 6 4 3 2 low' : 'Two Pair, Ks & 9s');
    // Where each piece rests: its laid-out box under its positioned parent (a reveal's or a pop's transform aside).
    const restBottom = (e) => {
      const op = e.offsetParent;
      if (!op) return e.getBoundingClientRect().bottom;
      return op.getBoundingClientRect().top + op.clientTop + e.offsetTop + e.offsetHeight;
    };
    const stackBottom = () => Math.max(plaque.getBoundingClientRect().bottom,
      ...[...low.querySelectorAll('.replayer-seat-draw-badge, .replayer-seat-hand-name:not([data-ghost])')].map(restBottom));
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
    slot.appendChild(probe);
    const rs = probe.getBoundingClientRect().height / 100 || 8;   // the screen's r: the table's own height is in it
    probe.remove();
    const S = slot.getBoundingClientRect();
    const clip = S.bottom - parseFloat(getComputedStyle(slot).paddingBottom || 0) - guPx(table) * 0.71 / 2;
    const room = S.height - (parseFloat(getComputedStyle(slot).paddingTop) || 0) - (parseFloat(getComputedStyle(slot).paddingBottom) || 0);
    let foot = 4;
    for (let pass = 0; pass < 3; pass++) {
      const over = stackBottom() - clip;
      if (over <= 0.5) break;
      foot = (room - (table.getBoundingClientRect().height - over)) / rs;
      table.style.height = `calc(100cqh - var(--subrow) * ${foot.toFixed(3)})`;
    }
    stand.forEach(e => e.remove());
  };
  useLayoutEffect(() => { if (tableRef.current) placeTableFoot(tableRef.current); });
  /* The moment's note, a quote bubble over the hero's hand (owner, 2026-11-28: "This note is hidden. Let's put it in a
     quote bubble above hero's hand"; MomentBubble in HandExtras.jsx): its tail's tip r/2 over the top of the hero's
     cards (the plaque's, with no cards), at their middle; the bubble centred on that and kept 1g inside the table.
     Placed after each commit, again once the cards have come to rest, and when the table changes size. */
  const [tableEl, setTableEl] = useState(null);
  useLayoutEffect(() => { if (tableRef.current !== tableEl) setTableEl(tableRef.current); });
  const noteBubbleRef = useRef(null);
  const placeNoteBubble = () => {
    const b = noteBubbleRef.current, table = tableRef.current;
    // The game's label fades while the bubble lies over it (the landscape table has little room between the board and
    // the hero's hand); its own data-away is its placement pass's, so this is an attribute of its own.
    const info = table && table.querySelector('.replayer-table-info');
    if (info && (!b || !b.isConnected)) delete info.dataset.underNote;
    if (!b || !table) return;
    const T = table.getBoundingClientRect();
    if (!T.width || !T.height) { b.style.visibility = 'hidden'; return; }
    const cards = [...table.querySelectorAll('[data-seat-cards="' + replayHeroIdx + '"] .card-row > *')];
    const plaque = table.querySelector('.replayer-seat[data-seat="' + replayHeroIdx + '"] .replayer-seat-info');
    const rs = (cards.length ? cards : plaque ? [plaque] : []).map((el) => el.getBoundingClientRect()).filter((q) => q.width);
    if (!rs.length) { b.style.visibility = 'hidden'; return; }
    const r = subrowPx(table), g = guPx(table);
    const top = Math.min(...rs.map((q) => q.top)) - T.top;
    const cx = (Math.min(...rs.map((q) => q.left)) + Math.max(...rs.map((q) => q.right))) / 2 - T.left;
    /* Where it covers least (owner, 2026-11-28: "Move this bubble to minimize collision with other elements"): every
       width up to 24g, 21g, 18g or 15g (a short note keeps its own), and every place along the row (g/2 apart) that keeps the tail 1.5g in from either end
       and the bubble 1g inside the table, scored by the area it would cover of the felt's pieces (the collision guard's:
       plaques, cards, action labels, readouts, wagers, the button, the board, the pot); the game's label counts a tenth,
       since it fades under the bubble. Least wins; then the widest, then the nearest to centred. Centred at 24g it lay
       over a side seat's plaque. */
    const P = (q) => ({ l: q.left - T.left, t: q.top - T.top, r: q.right - T.left, b: q.bottom - T.top });
    const pieces = [];
    const add = (sel, wt) => table.querySelectorAll(sel).forEach((el) => {
      if (b.contains(el) || el.closest('[data-ghost]')) return;
      const q = el.getBoundingClientRect();
      if (q.width && q.height) pieces.push({ ...P(q), wt });
    });
    add('.replayer-seat-info, .replayer-seat-cards .card-row > *, .replayer-action-badge-outer, .replayer-seat-hand-name, .replayer-seat-draw-badge, .replayer-dealer-btn, .replayer-bet-chip[data-seat], .replayer-board-area:not(.replayer-dead-area) .card-row > *, .replayer-pot-display, .replayer-pot-above, .replayer-pot-layers.is-placed > *', 1);
    add('.replayer-table-info > *', 0.1);
    const cover = (L, Y, w, h) => pieces.reduce((sum, q) => {
      const ix = Math.min(L + w, q.r) - Math.max(L, q.l), iy = Math.min(Y + h, q.b) - Math.max(Y, q.t);
      return ix > 0 && iy > 0 ? sum + ix * iy * q.wt : sum;
    }, 0);
    let best = null;
    for (const n of [24, 21, 18, 15]) {
      if (n * g > T.width - 2 * g) continue;
      b.style.maxWidth = 'calc(var(--gu) * ' + n + ')';
      const w = b.offsetWidth, h = b.offsetHeight;
      // The tail is 1r tall under the bubble's body; its tip r/2 over the cards.
      const Y = Math.max(g, top - r * 0.5 - r - h);
      const lo = Math.max(g, cx - w + 1.5 * g), hi = Math.min(T.width - g - w, cx - 1.5 * g);
      for (let L = lo; L <= hi + 0.01; L += g / 2) {
        const score = cover(L, Y, w, h) + Math.abs(L + w / 2 - cx) * 0.01 + (24 - n) * 0.02;
        if (!best || score < best.score) best = { score, n, L, Y, w };
      }
    }
    if (!best) {
      b.style.maxWidth = '';
      const w = b.offsetWidth, h = b.offsetHeight;
      best = { n: null, L: Math.max(g, Math.min(T.width - g - w, cx - w / 2)), Y: Math.max(g, top - r * 0.5 - r - h), w };
    }
    b.style.maxWidth = best.n ? 'calc(var(--gu) * ' + best.n + ')' : '';
    const { L, Y, w } = best;
    b.style.left = (L / T.width * 100) + '%';
    b.style.top = (Y / T.height * 100) + '%';
    b.style.setProperty('--mn-tail-x', ((cx - L) / w * 100) + '%');
    b.style.visibility = 'visible';
    if (info) {
      const I = info.getBoundingClientRect(), B = b.getBoundingClientRect();
      const over = I.width && B.left < I.right && B.right > I.left && B.top < I.bottom && B.bottom > I.top;
      if (over) info.dataset.underNote = '1'; else delete info.dataset.underNote;
    }
  };
  useLayoutEffect(() => {
    placeNoteBubble();
    const t = setTimeout(placeNoteBubble, 700);
    return () => clearTimeout(t);
  });
  /* The note answers its action (owner, 2026-11-28: "Pause briefly between the last action before a note and the display
     of the note, so that it looks like a response"): at a step with a note the bubble waits until that step's motion is
     over (the registry's extent, read the frame after the commit, once the moment's springs exist), then four beats more
     (560ms), and comes in from its tail (data-shown; an attribute, since React writes the class). */
  const NOTE_PAUSE_MS = 560;
  const noteShowRef = useRef({ key: null, timer: 0, raf: 0 });
  const shownNote = noteAt(hand, streetIdx, actionIdx);
  const noteShowKey = shownNote ? streetIdx + ':' + actionIdx + ':' + shownNote.text : null;
  useLayoutEffect(() => {
    const s = noteShowRef.current;
    if (s.key === noteShowKey) return;
    s.key = noteShowKey;
    clearTimeout(s.timer); cancelAnimationFrame(s.raf);
    const b = noteBubbleRef.current;
    if (b) delete b.dataset.shown;
    if (!noteShowKey) return;
    s.raf = requestAnimationFrame(() => {
      const wait = Math.max(0, motion && motion.extentMs ? motion.extentMs() : 0) + NOTE_PAUSE_MS;
      s.timer = setTimeout(() => { const el = noteBubbleRef.current; if (el) el.dataset.shown = '1'; }, wait);
    });
  }, [noteShowKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { clearTimeout(noteShowRef.current.timer); cancelAnimationFrame(noteShowRef.current.raf); }, []);
  useEffect(() => {
    const table = tableRef.current;
    if (!table || typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(() => placeNoteBubble());
    ro.observe(table);
    return () => ro.disconnect();
  }, [tableEl]);
  const placeCardRows = (table) => {
    if (!table.clientWidth || !table.clientHeight) return;
    const rows = table.querySelectorAll('.replayer-seat-cards > .card-row');
    if (!rows.length) return;
    const host = table.closest('.replayer-replay') || document.documentElement;
    const box = host.getBoundingClientRect();
    const gu = guPx(table), r1 = gu * 0.71;
    const controls = [...host.querySelectorAll('.hx-chips > *, .replayer-quick-btn')].map(e => e.getBoundingClientRect()).filter(b => b.width > 0 && b.height > 0);
    const LIFT = { up: -1, 'up-lo': -1, 'up-half': -1, down: 1, 'down-half': 1 };
    rows.forEach(el => { el.style.left = ''; el.style.top = ''; });
    const width = Math.round(box.width);
    rows.forEach(el => {
      const lo = box.left + gu / 2, hi = box.right - gu / 2;
      const kids = [...el.children];
      /* By the cards as the fan draws them, not the row's box (2026-11-17: a side seat's five fanned draw cards ran
         off the screen's edge while the row's own box was inside it), and where they come to REST (owner, 2026-11-23:
         "Chino's whole hand jumps sideways when he gets his 7th street card"): in the commit a new card's neighbours are
         still drawn at their old slots (CardRow's slide, held at its first frame), and the shift worked out for that
         hand was put right by the settle pass a second later, the whole hand stepping 3px in one frame. */
      const placed = atRest([el, ...kids], () => {
        const r = el.getBoundingClientRect();
        if (!r.width) return null;
        const qs = kids.map(c => c.getBoundingClientRect());
        const L = Math.min(r.left, ...qs.map(q => q.left));
        const R = Math.max(r.right, ...qs.map(q => q.right));
        const shift = L < lo ? lo - L : R > hi ? hi - R : 0;
        let drop = 0;
        kids.forEach((c, i) => {
          const q = qs[i];
          if (!q.width) return;
          const now = parseFloat((getComputedStyle(c).translate || '').split(' ')[1]) || 0;
          const top = q.top - now + (LIFT[c.dataset.pose] || 0) * r1;
          controls.forEach(b => {
            if (q.left + shift < b.right && q.right + shift > b.left && top < b.bottom + r1 / 4 && top + q.height > b.top) drop = Math.max(drop, b.bottom + r1 / 4 - top);
          });
        });
        return { shift, drop };
      });
      if (!placed) return;
      const { shift, drop } = placed;
      if (shift) { el.style.position = 'relative'; el.style.left = `calc(var(--gu) * ${(shift / gu).toFixed(3)})`; }
      if (drop > 0) { el.style.position = 'relative'; el.style.top = `calc(var(--gu) * ${(drop / gu).toFixed(3)})`; }
      // A change of place at the same size of table glides with the cards' slide; a new layout is placed at once.
      const was = el.dataset.edgeW ? { x: Number(el.dataset.edgeShift) || 0, y: Number(el.dataset.edgeDrop) || 0, w: Number(el.dataset.edgeW) } : null;
      el.dataset.edgeShift = String(shift);
      el.dataset.edgeDrop = String(drop);
      el.dataset.edgeW = String(width);
      if (was && was.w === width) glideRow(el, shift - was.x, drop - was.y);
    });
  };
  useLayoutEffect(() => { if (tableRef.current) placeCardRows(tableRef.current); });
  /* The dealer button on the plaque's other lower corner when the one facing the middle touches anything that is not
     its seat's (2026-11-16: at 430 wide a side seat's button sat on the board's first card), if that one is clear. */
  const placeButton = (table) => {
    if (!table.clientWidth || !table.clientHeight) return;   // the desktop pane's first commits draw it at 0 x 0
    const btn = table.querySelector('.replayer-dealer-btn');
    if (!btn) return;
    delete btn.dataset.flip;
    const seat = btn.closest('.replayer-seat');
    const host = table.closest('.replayer-replay') || document.documentElement;
    const edge = host.getBoundingClientRect();
    const others = [...table.querySelectorAll('.replayer-seat[data-seat]')].filter(x => x !== seat)
      .flatMap(x => [...x.querySelectorAll('.replayer-seat-info, .replayer-seat-cards .card-row > *, .replayer-action-badge-outer, .replayer-seat-draw-badge')])
      .concat([...table.querySelectorAll('.replayer-board-area:not(.replayer-dead-area) .card-row > *, .replayer-pot-display, .replayer-pot-above:not([data-ghost])')])
      .map(e => e.getBoundingClientRect()).filter(b => b.width > 0 && b.height > 0);
    const touches = () => {
      const b = btn.getBoundingClientRect();
      return b.left < edge.left || b.right > edge.right || others.some(o => Math.min(b.right, o.right) - Math.max(b.left, o.left) > 0 && Math.min(b.bottom, o.bottom) - Math.max(b.top, o.top) > 0);
    };
    if (!touches()) return;
    btn.dataset.flip = '1';
    if (touches()) delete btn.dataset.flip;
  };
  useLayoutEffect(() => { if (tableRef.current) placeButton(tableRef.current); });
  /* The middle of the felt first, then what belongs to a seat, then the pill (2026-11-16):
       0. each seat's cards on the screen (keepCardRowsOn, above), and the dealer button off what is not its seat's;
       1. the pot clear of the board, and the rows under the board (main and side pots, a split's shares);
       2. each seat's action label off its cards' ranks, then its showdown readout off everything (the rows included);
       3. the wagers, off their seat and everything placed so far;
       4. the game pill, off all of it, wagers included.
     Placed the other way, a readout moved beside its plaque into the rows' band, the rows wrapped round it, and a wager
     could find no cloth because the pill had taken it.
     The rows: 0.75r under the board's cards and 0.5r apart (under the pot where no board is dealt; owner, 2026-11-15:
     "still colliding"; see .replayer-split-pot, .replayer-pot-layers). */
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const rows = [...table.querySelectorAll('.replayer-pot-layers.is-placed:not([data-ghost]), .replayer-split-shares.is-placed:not([data-ghost])')];
    const r = subrowPx(table);
    const board = table.querySelector('.replayer-board-area:not(.replayer-dead-area)');
    /* The pot 0.5r clear above the board's cards: both sit at a share of the table's height (40.6% and 47%), and on
       a short table the figure's foot met the cards. Lifted by the shortfall; a split's total hangs above the board
       on its own rule (.replayer-split-pot). */
    const potEl = table.querySelector('.replayer-pot-display:not(.replayer-split-pot)');
    if (potEl) potEl.style.marginTop = '';
    const boardCard = board && board.querySelector('.card-row > *');
    if (potEl && boardCard) {
      const short = potEl.getBoundingClientRect().bottom - (board.getBoundingClientRect().top - r / 2);
      if (short > 0) potEl.style.marginTop = (-Math.ceil(short)) + 'px';
    }
    /* Stud has no board: the pot above the watermark, the game pill under it, and the rows (a split's shares, the side
       pots) under the pill (owner, 2026-11-22: "in stud, since there's no board, let's put the game/limits under the
       watermark, pot above the watermark, and the result pills under the game/limits"). They hung under the pot, on
       the watermark. */
    const studPill = gameCfg.isStud && !(board && board.querySelector('.card-row > *')) ? table.querySelector('.replayer-table-info') : null;
    const anchor = board && board.querySelector('.card-row > *') ? board : (studPill || table.querySelector('.replayer-pot-display'));
    if (rows.length && anchor && rows[0].offsetParent) {
      const cb = rows[0].offsetParent;
      const oy = cb.getBoundingClientRect().top + cb.clientTop;
      const gu = guPx(table);
      /* A row stays one row while it clears the side seats; one that would reach a seat's plaque, cards or labels at
         its height (five shares at a ten-seat phone table ran over both side seats' cards) wraps, centred, to the
         band between them, 0.5r clear of each. Measured again once wrapped, since a taller row meets more of them.
         Not the readouts: they are placed after, round the rows. */
      const seatBoxes = [...table.querySelectorAll('.replayer-seat-info, .replayer-action-badge-outer, .replayer-seat-draw-badge, .replayer-dealer-btn, .replayer-seat-cards .card-row > *')]
        .map(e => e.getBoundingClientRect()).filter(b => b.width > 0 && b.height > 0);
      let y = anchor.getBoundingClientRect().bottom + r * 0.75;
      if (anchor === studPill) {
        // The pill's own foot (not its 46% column), where it rests: placePill, after this, may move it for the step.
        const kids = [...studPill.children].map(e => e.getBoundingClientRect()).filter(b => b.width > 0 && b.height > 0);
        const foot = kids.length ? Math.max(...kids.map(b => b.bottom)) : studPill.getBoundingClientRect().bottom;
        y = foot - (parseFloat(studPill.style.marginTop) || 0) + r * 0.75;
      }
      rows.forEach(el => {
        el.style.maxWidth = ''; el.style.flexWrap = '';
        el.style.top = (y - oy) + 'px';
        for (let pass = 0; pass < 3; pass++) {
          const b = el.getBoundingClientRect();
          const cx = b.left + b.width / 2;
          let lo = -Infinity, hi = Infinity;
          seatBoxes.forEach(s => {
            if (s.bottom <= b.top || s.top >= b.bottom) return;
            if (s.right < cx) lo = Math.max(lo, s.right);
            else if (s.left > cx) hi = Math.min(hi, s.left);
          });
          const half = Math.min(cx - lo, hi - cx) - r / 2;
          if (!(half < b.width / 2) || half <= 0) break;
          el.style.flexWrap = 'wrap';
          el.style.maxWidth = `calc(var(--gu) * ${(2 * half / gu).toFixed(3)})`;
        }
        y = el.getBoundingClientRect().bottom + r * 0.5;
      });
    }
  });
  /* keepHandNamesOn (owner, 2026-11-13): every showdown readout is centred under its seat; one that would
     run off the screen (a long "Hi: Straight, 7-high" under a side seat) is moved in until it is 0.5g clear
     of the edge, by margin, since the reveal animation owns its transform. Measured after each render. */
  /* Where each readout was moved this step (seat -> its offset from rest, in g), kept until the step changes: the
     cards and plaques animate at a showdown, so one render found the spot under a plaque clear and the next did not,
     and the name jumped between the two (2026-11-16). Moving is decided again each render; going back is not. */
  const nameSpotRef = useRef({ step: '', spots: new Map() });
  /* Each face-up card's rank and suit at its corner, the part nothing may cover: the top third of its left 30%, turned
     with the card (its and its parents' rotations, up to the seat) about the card's centre, as
     check:replayer-collisions measures it. */
  const rankBoxesOf = (seat) => [...seat.querySelectorAll('.replayer-seat-cards .card-row > img')].map(e => {
    const q = e.getBoundingClientRect();
    const w = e.offsetWidth || q.width, h = e.offsetHeight || q.height;
    let deg = 0;
    for (let x = e; x && x !== seat; x = x.parentElement) {
      const st = getComputedStyle(x);
      const m = /matrix\(([^,]+),\s*([^,]+)/.exec(st.transform || '');
      if (m) deg += Math.atan2(parseFloat(m[2]), parseFloat(m[1])) * 180 / Math.PI;
      const rot = /(-?[\d.]+)deg/.exec(st.rotate || '');
      if (rot) deg += parseFloat(rot[1]);
    }
    const t = deg * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
    const mx = q.left + q.width / 2, my = q.top + q.height / 2;
    const pts = [[-w / 2, -h / 2], [-w / 2 + 0.3 * w, -h / 2], [-w / 2, -h / 2 + 0.32 * h], [-w / 2 + 0.3 * w, -h / 2 + 0.32 * h]]
      .map(([x, y]) => [mx + x * cos - y * sin, my + x * sin + y * cos]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  });
  /* An action label on one of its own cards' ranks sinks just far enough to clear them, if that keeps it off the
     player's name (2026-11-16): the CSS seats it by a share of the card's height, and at the ends of a seven-card stud
     fan, whose tilted outer cards and lower hole cards carry their ranks lower, "ALL-IN 380" still met two. With no
     room above the name it goes beside the plaque, level with its top edge, on whichever side is clear of everything
     (the dealer button sits on one of them). Measured at its laid-out size around its drawn centre: it pops in from a
     smaller scale. */
  const placeLabels = (table) => {
    if (!table.clientWidth || !table.clientHeight) return;   // the desktop pane's first commits draw it at 0 x 0
    const labels = table.querySelectorAll('.replayer-action-badge-outer');
    if (!labels.length) return;
    const host = table.closest('.replayer-replay') || document.documentElement;
    const gu = guPx(table);
    labels.forEach(el => { el.style.marginBottom = ''; el.style.marginLeft = ''; delete el.dataset.spot; });
    const box = (e) => {
      const q = e.getBoundingClientRect();
      const w = Math.max(q.width, e.offsetWidth || 0), h = Math.max(q.height, e.offsetHeight || 0);
      return { left: q.left + q.width / 2 - w / 2, right: q.left + q.width / 2 + w / 2, top: q.top + q.height / 2 - h / 2, bottom: q.top + q.height / 2 + h / 2, width: w, height: h };
    };
    const edge = host.getBoundingClientRect();
    labels.forEach(el => {
      const seat = el.closest('.replayer-seat');
      if (!seat) return;
      const q = el.getBoundingClientRect();
      const w = Math.max(q.width, el.offsetWidth), h = Math.max(q.height, el.offsetHeight);
      const L = { left: q.left + q.width / 2 - w / 2, right: q.left + q.width / 2 + w / 2, top: q.top + q.height / 2 - h / 2, bottom: q.top + q.height / 2 + h / 2 };
      const ranksAll = rankBoxesOf(seat);
      const under = ranksAll.filter(b => L.left < b.right && L.right > b.left && L.top < b.bottom && L.bottom > b.top);
      /* The label is the plaque's child, and a folded plaque is drawn at 0.88: a margin is in the plaque's own units. */
      const plaqueEl = seat.querySelector('.replayer-seat-info');
      const P = plaqueEl.getBoundingClientRect();
      const sx = (plaqueEl.offsetWidth && P.width / plaqueEl.offsetWidth) || 1, sy = (plaqueEl.offsetHeight && P.height / plaqueEl.offsetHeight) || 1;
      const nameEl = seat.querySelector('.replayer-seat-name');
      let ink = null;
      if (nameEl) {
        const rg = document.createRange();
        rg.selectNodeContents(nameEl);
        const q2 = rg.getBoundingClientRect();
        if (q2.height) ink = q2;
      }
      if (!under.length) {
        /* Off the player's name (2026-11-17): at 440 wide, past the 430 where the screen's g stops growing while the
           table's does not, the label's foot reached 1px onto the name's ink. Lifted by that if the lift covers no
           rank; where it would (six fanned cards), beside the plaque like a label that cannot sink. */
        const over = ink ? L.bottom - (ink.top - 1) : 0;
        if (over <= 0 || L.left >= ink.right || L.right <= ink.left) return;
        const up = { left: L.left, right: L.right, top: L.top - over, bottom: L.bottom - over };
        if (!ranksAll.some(b => up.left < b.right && up.right > b.left && up.top < b.bottom && up.bottom > b.top)) {
          el.style.marginBottom = `calc(var(--gu) * ${(over / sy / gu).toFixed(3)})`;
          return;
        }
      } else {
        const need = Math.max(...under.map(b => b.bottom - L.top)) + 1;
        const room = ink ? ink.top - 1 - L.bottom : Infinity;
        if (need <= room) { el.style.marginBottom = `calc(var(--gu) * ${(-need / sy / gu).toFixed(3)})`; return; }
      }
      const pad = gu / 4;
      const others = [...table.querySelectorAll('.replayer-seat[data-seat]')].filter(x => x !== seat)
        .flatMap(x => [...x.querySelectorAll('.replayer-seat-info, .replayer-seat-cards .card-row > *, .replayer-action-badge-outer, .replayer-seat-draw-badge, .replayer-seat-hand-name:not([data-ghost]), .replayer-dealer-btn')])
        .concat([...seat.querySelectorAll('.replayer-seat-draw-badge, .replayer-seat-hand-name:not([data-ghost]), .replayer-dealer-btn')])
        .concat([...table.querySelectorAll('.replayer-board-area:not(.replayer-dead-area) .card-row > *, .replayer-pot-display, .replayer-pot-above:not([data-ghost]), .replayer-pot-layers.is-placed:not([data-ghost]) > *, .replayer-split-shares.is-placed:not([data-ghost]) > *')])
        .map(box).filter(b => b.width > 0 && b.height > 0);
      const ranks = rankBoxesOf(seat);
      /* Above its own cards, where it stands across, before anything beside the plaque (owner, 2026-11-27, of a stud
         hero's BRING-IN beside the plaque at 3rd street: "Why is bring in off to the side, I thought we went over this
         like a thousand fucking times"): its foot r/4 over the fan's top, raised by g/2 steps past anything in the way,
         never off the table. Beside the plaque is left for a seat with no felt above its cards (the top of the table). */
      const ownCards = [...seat.querySelectorAll('.replayer-seat-cards .card-row > *')].map(box).filter(b => b.width > 0 && b.height > 0);
      if (ownCards.length) {
        const T = table.getBoundingClientRect();
        const fanTop = Math.min(...ownCards.map(b => b.top), ...ranks.map(b => b.top));
        for (let j = 0; j <= 4; j++) {
          const top = fanTop - pad - h - j * gu / 2;
          const b = { left: L.left, right: L.right, top, bottom: top + h };
          if (b.top < T.top + pad || b.left < edge.left + gu / 2 || b.right > edge.right - gu / 2) break;
          if (others.some(o => b.left < o.right + pad && b.right > o.left - pad && b.top < o.bottom + pad && b.bottom > o.top - pad)) continue;
          el.style.marginBottom = `calc(var(--gu) * ${(-(b.top - L.top) / sy / gu).toFixed(3)})`;
          el.dataset.spot = 'above';
          return;
        }
      }
      const inward = (P.left + P.width / 2) < (edge.left + edge.width / 2) ? 1 : -1;
      const spot = [inward, -inward].map(side => {
        const left = side > 0 ? P.right + gu / 2 : P.left - gu / 2 - w;
        return { left, right: left + w, top: P.top, bottom: P.top + h };
      }).find(b => b.left >= edge.left + gu / 2 && b.right <= edge.right - gu / 2
        && !others.some(o => b.left < o.right + pad && b.right > o.left - pad && b.top < o.bottom + pad && b.bottom > o.top - pad)
        && !ranks.some(o => b.left < o.right && b.right > o.left && b.top < o.bottom && b.bottom > o.top));
      if (!spot) return;
      el.style.marginLeft = `calc(var(--gu) * ${((spot.left - L.left) / sx / gu).toFixed(3)})`;
      el.style.marginBottom = `calc(var(--gu) * ${(-(spot.top - L.top) / sy / gu).toFixed(3)})`;
    });
  };
  useLayoutEffect(() => { if (tableRef.current) placeLabels(tableRef.current); });
  const placeNames = (table, settle) => {
    const names = table.querySelectorAll('.replayer-seat-hand-name:not([data-ghost])');
    /* Kept for the step at this size of table: the desktop pane draws the table at 0 x 0 for its first commits, and a
       spot found against nothing was kept once the table had its size (2026-11-16). */
    if (!table.clientWidth || !table.clientHeight) return;
    const stepKey = streetIdx + ':' + actionIdx + ':' + table.clientWidth + 'x' + table.clientHeight;
    if (nameSpotRef.current.step !== stepKey) nameSpotRef.current = { step: stepKey, spots: new Map() };
    const spots = nameSpotRef.current.spots;
    if (!names.length) return;
    const host = table.closest('.replayer-replay') || document.documentElement;
    const box = host.getBoundingClientRect();
    const gu = guPx(table);
    /* After the motion (the settle pass below): a readout whose kept spot touches something now that everything is
       where it rests is placed again; the others stay where they are. */
    if (settle) {
      const live = (e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 ? q : null; };
      const felt = [...table.querySelectorAll('.replayer-board-area:not(.replayer-dead-area) .card-row > *, .replayer-pot-display, .replayer-pot-above:not([data-ghost]), .replayer-pot-layers.is-placed:not([data-ghost]) > *, .replayer-split-shares.is-placed:not([data-ghost]) > *')].map(live).filter(Boolean);
      names.forEach(el => {
        const seat = el.closest('.replayer-seat');
        if (!seat) return;
        const key = (seat.dataset.seat || '') + '|' + (el.dataset.nameSeat || '') + '|' + el.className;
        if (!spots.has(key)) return;
        const b = live(el);
        if (!b) return;
        const own = [...seat.querySelectorAll('.replayer-seat-info, .replayer-action-badge-outer, .replayer-seat-draw-badge, .replayer-dealer-btn' + (el.dataset.spot === 'cards' ? '' : ', .replayer-seat-cards .card-row > *'))];
        const rest = [...table.querySelectorAll('.replayer-seat[data-seat]')].filter(x => x !== seat)
          .flatMap(x => [...x.querySelectorAll('.replayer-seat-info, .replayer-seat-cards .card-row > *, .replayer-action-badge-outer, .replayer-seat-draw-badge, .replayer-seat-hand-name:not([data-ghost]), .replayer-dealer-btn')]);
        const list = own.concat(rest).map(live).filter(Boolean).concat(felt).concat(el.dataset.spot === 'cards' ? rankBoxesOf(seat) : []);
        if (list.some(o => Math.min(b.right, o.right) - Math.max(b.left, o.left) > 0.5 && Math.min(b.bottom, o.bottom) - Math.max(b.top, o.top) > 0.5)) spots.delete(key);
      });
    }
    names.forEach(el => { el.style.marginLeft = ''; el.style.marginTop = ''; delete el.dataset.spot; });
    /* Where a readout rests, from its layout box and its centring (--hn-x), not its drawn box: the reveal and the
       moments animate it, and a box measured mid-flight put the margins off by the flight (2026-11-16). */
    const restOf = (el) => {
      const op = el.offsetParent;
      if (!op || !el.offsetWidth) return null;
      const o = op.getBoundingClientRect();
      // Its size to the fraction of a pixel (offsetWidth/Height are whole), at least its laid-out size if it is scaled.
      const q = el.getBoundingClientRect();
      const w = Math.max(el.offsetWidth, q.width), h = Math.max(el.offsetHeight, q.height);
      const hx = getComputedStyle(el).getPropertyValue('--hn-x').trim();
      const tx = !hx ? -w / 2 : hx.endsWith('%') ? parseFloat(hx) / 100 * w : (parseFloat(hx) || 0);
      const left = o.left + op.clientLeft + el.offsetLeft + tx, top = o.top + op.clientTop + el.offsetTop;
      return { left, right: left + w, top, bottom: top + h, width: w, height: h };
    };
    const lo = box.left + gu / 2, hi = box.right - gu / 2;
    names.forEach(el => {
      const r = restOf(el);
      if (!r) return;
      const shift = r.left < lo ? lo - r.left : r.right > hi ? hi - r.right : 0;
      if (shift) el.style.marginLeft = `calc(var(--gu) * ${(shift / gu).toFixed(3)})`;
    });
    /* A readout under its plaque that lands on anything else (owner, 2026-11-16: why are there collisions left; at
       ten seats on a phone every side seat's "Pair of 7s" hung on the cards of the seat below) moves: beside its
       plaque on the side facing the middle, level with it, then up to its height higher or lower; then under it,
       toward the middle by up to a plaque's width. The first spot that is clear and on the screen; else it stays. */
    const T = table.getBoundingClientRect();
    const pad = gu / 4;
    const hits = (b, list) => list.some(o => b.left < o.right + pad && b.right > o.left - pad && b.top < o.bottom + pad && b.bottom > o.top - pad);
    /* Each piece at its laid-out size around its drawn centre (as the wagers' placement measures): a card turning over
       or a label popping in is drawn narrower than it will be, and the spot under a plaque looked clear for a frame. */
    const rectOf = (e) => {
      const q = e.getBoundingClientRect();
      const w = Math.max(q.width, e.offsetWidth || 0), h = Math.max(q.height, e.offsetHeight || 0);
      const mx = q.left + q.width / 2, my = q.top + q.height / 2;
      return { left: mx - w / 2, right: mx + w / 2, top: my - h / 2, bottom: my + h / 2, width: w, height: h };
    };
    const SEAT_PIECES = '.replayer-seat-cards .card-row > *, .replayer-action-badge-outer, .replayer-seat-draw-badge, .replayer-dealer-btn';
    const placed = [];
    /* Where each readout not placed yet stands (its kept spot, else its own place), so none is moved onto another's:
       one moved earlier took the spot under a later one's plaque, and the later one then had nowhere (2026-11-16). */
    const pending = new Map();
    names.forEach(el => {
      const seat = el.closest('.replayer-seat');
      const k = spots.get((seat && seat.dataset.seat || '') + '|' + (el.dataset.nameSeat || '') + '|' + el.className);
      const q = restOf(el);
      if (q) pending.set(el, k ? { left: q.left + k.dx * gu, right: q.right + k.dx * gu, top: q.top + k.dy * gu, bottom: q.bottom + k.dy * gu } : q);
    });
    names.forEach(el => {
      pending.delete(el);
      const seat = el.closest('.replayer-seat');
      const plaque = seat && seat.querySelector('.replayer-seat-info');
      const seatKey = (seat && seat.dataset.seat || '') + '|' + (el.dataset.nameSeat || '') + '|' + el.className;
      const kept = spots.get(seatKey);
      if (kept && kept.spot) el.dataset.spot = kept.spot;
      const r = restOf(el);
      if (!plaque || !r) return;
      const cs = getComputedStyle(el);
      const ml = parseFloat(cs.marginLeft) || 0, mt = parseFloat(cs.marginTop) || 0;
      if (kept) {
        el.style.marginLeft = `calc(var(--gu) * ${(ml / gu + kept.dx).toFixed(3)})`;
        el.style.marginTop = `calc(var(--gu) * ${(mt / gu + kept.dy).toFixed(3)})`;
        placed.push({ left: r.left + kept.dx * gu, right: r.right + kept.dx * gu, top: r.top + kept.dy * gu, bottom: r.bottom + kept.dy * gu });
        return;
      }
      const ownCards = [...seat.querySelectorAll('.replayer-seat-cards .card-row > *')];
      const besides = [...table.querySelectorAll('.replayer-seat[data-seat]')].filter(s => s !== seat)
        .flatMap(s => [...s.querySelectorAll('.replayer-seat-info, ' + SEAT_PIECES)])
        .concat([...seat.querySelectorAll(SEAT_PIECES)].filter(e => !ownCards.includes(e)))
        .concat([...table.querySelectorAll('.replayer-board-area:not(.replayer-dead-area) .card-row > *, .replayer-pot-display, .replayer-pot-above:not([data-ghost]), .replayer-pot-layers.is-placed:not([data-ghost]) > *, .replayer-split-shares.is-placed:not([data-ghost]) > *')])
        .map(rectOf).filter(b => b.width > 0 && b.height > 0).concat(placed, [...pending.values()]);
      const others = besides.concat(ownCards.map(rectOf).filter(b => b.width > 0 && b.height > 0));
      if (!hits(r, others)) { placed.push(r); return; }
      const P = plaque.getBoundingClientRect();
      const inward = (P.left + P.width / 2) < (T.left + T.width / 2) ? 1 : -1;
      /* Beside the plaque on the side facing the middle, level with it, then up to its height higher or lower; the
         same on the outer side; then under it, shifted and lowered (the dealer button sits on the plaque's lower corner
         facing the table, its lower half on the name under it). The first spot on the screen and clear of
         everything, the plaque included. */
      const spotFor = (q, from) => {
        const cands = from ? [{ left: q.left, top: q.top }] : [];
        const mid = P.top + (P.height - q.height) / 2;
        /* Above its own cards, centred on the plaque, before anything beside it (owner, 2026-11-27, of "Pair of 3s acts
           first" beside the hero's plaque at 7th street: "And here too"): under the bottom seat's plaque is the slot's
           clipped foot, and what belongs to a seat stays over it, not off to its side. Its foot r/4 over the fan's top,
           then g/2 higher at a time; never above the table. */
        const fan = ownCards.map(rectOf).filter(b => b.width > 0 && b.height > 0);
        if (fan.length) {
          const fanTop = Math.min(...fan.map(b => b.top));
          for (let j = 0; j <= 4; j++) cands.push({ left: P.left + (P.width - q.width) / 2, top: fanTop - pad - q.height - j * gu / 2, above: true });
        }
        for (const side of [inward, -inward]) {
          const left = side > 0 ? P.right + gu / 2 : P.left - gu / 2 - q.width;
          for (let k = 0; k <= 8; k++) for (const s of k ? [-1, 1] : [1]) cands.push({ left, top: mid + s * k * P.height / 8 });
        }
        /* Under it, shifted either way by up to a plaque's width and down by up to 2g, the nearest first (a two-line
           side-pot name under a top seat cleared the button beside its plaque only half a card in and 1g down). */
        const under = [];
        for (let k = -16; k <= 16; k++) for (let j = 0; j <= 4; j++) {
          if (!k && !j) continue;
          under.push({ left: q.left + inward * k * P.width / 16, top: q.top + j * gu / 2, cost: Math.abs(k) * P.width / 16 + 2 * j * gu / 2 + (k < 0 ? 0.5 : 0) });
        }
        under.sort((a, b) => a.cost - b.cost).forEach(c => cands.push(c));
        return cands.map(c => ({ left: c.left, right: c.left + q.width, top: c.top, bottom: c.top + q.height, above: !!c.above }))
          .find(o => o.left >= lo && o.right <= hi && (!o.above || o.top >= T.top + pad) && !hits(o, others) && !hits(o, [P]));
      };
      let ok = spotFor(r, false);
      let rest = r, spot = '';
      /* No spot at its size (a ten-seat phone table at a showdown): the same search at the action label's size, where
         it starts from its own place; and last, a single line on its own cards, where the action label sits: over the
         cards' lower bodies, its foot on the plaque's top edge, never on a face-up card's rank (the top third of its
         left 30%, turned with the card). It reads as the label of those cards. */
      if (!ok) {
        el.dataset.spot = 'small';
        const c = restOf(el);
        ok = c && spotFor(c, true);
        if (ok) { rest = c; spot = 'small'; }
      }
      if (!ok && !el.querySelector('.hn-line + .hn-line')) {
        el.dataset.spot = 'cards';
        const c = restOf(el);
        const ranks = rankBoxesOf(seat);
        /* Its foot 1px over the plaque's top edge: the laid-out edge or the drawn one, whichever is higher (a plaque
           measured mid-animation, or scaled, is drawn off its place). */
        const pop = plaque.offsetParent, po = pop && pop.getBoundingClientRect();
        const foot = Math.min(P.top, po ? po.top + pop.clientTop + plaque.offsetTop : P.top) - 1;
        const o = c && { left: P.left + (P.width - c.width) / 2, top: foot - c.height };
        if (o) { o.right = o.left + c.width; o.bottom = foot; }
        const touches = (q, list) => list.some(x => q.left < x.right && q.right > x.left && q.top < x.bottom && q.bottom > x.top);
        if (o && o.left >= lo && o.right <= hi && !hits(o, besides) && !touches(o, ranks)) { ok = o; rest = c; spot = 'cards'; }
      }
      if (!ok) { delete el.dataset.spot; placed.push(r); return; }
      const cm = spot ? getComputedStyle(el) : null;
      const ml2 = spot ? (parseFloat(cm.marginLeft) || 0) : ml, mt2 = spot ? (parseFloat(cm.marginTop) || 0) : mt;
      const dx = (ok.left - rest.left) / gu, dy = (ok.top - rest.top) / gu;
      spots.set(seatKey, { dx, dy, spot });
      el.style.marginLeft = `calc(var(--gu) * ${(ml2 / gu + dx).toFixed(3)})`;
      el.style.marginTop = `calc(var(--gu) * ${(mt2 / gu + dy).toFixed(3)})`;
      placed.push(ok);
    });
  };
  useLayoutEffect(() => { if (tableRef.current) placeNames(tableRef.current, false); });
  const placeWagers = (table) => {
    if (!table.clientWidth || !table.clientHeight) return;   // the desktop pane's first commits draw it at 0 x 0
    const pills = table.querySelectorAll('.replayer-bet-chip[data-seat][data-base-left]');
    if (!pills.length) return;
    const r = subrowPx(table);
    /* Each piece at its laid-out size around its drawn centre: an action label pops in from a smaller scale, and
       measured mid-pop it left room that was not there once it had grown. */
    const boxOf = (e) => {
      const b = e.getBoundingClientRect();
      const bw = Math.max(b.width, e.offsetWidth || 0), bh = Math.max(b.height, e.offsetHeight || 0);
      const mx = b.left + b.width / 2, my = b.top + b.height / 2;
      return { left: mx - bw / 2, right: mx + bw / 2, top: my - bh / 2, bottom: my + bh / 2, width: bw, height: bh };
    };
    const PIECES = '.replayer-seat-info, .replayer-action-badge-outer, .replayer-seat-draw-badge, .replayer-seat-hand-name:not([data-ghost]), .replayer-dealer-btn, .replayer-seat-cards .card-row > *';
    const piecesOf = (seatEl) => (seatEl ? [...seatEl.querySelectorAll(PIECES)].map(boxOf).filter(b => b.width > 0 && b.height > 0) : []);
    // The middle of the felt: the pot (its figure and its chips), the board, the rows under the board. Not the game
    // pill: it is placed after the wagers, round them.
    /* In stud the game pill has its own place, under the watermark with the rows under it (2026-11-22): a wager keeps
       off it too. Left to placePill, the pill moved up off a wager that had landed between it and the rows, onto the
       watermark (check:replayer-collisions, Stud Hi 5 seats at 1440). */
    const felt = [...table.querySelectorAll('.replayer-pot-display, .replayer-pot-above:not([data-ghost]), .replayer-board-area:not(.replayer-dead-area) .card-row > *, .replayer-pot-layers.is-placed:not([data-ghost]) > *, .replayer-split-shares.is-placed:not([data-ghost]) > *'
      + (gameCfg.isStud ? ', .replayer-table-info > *' : ''))]
      .map(boxOf).filter(b => b.width > 0 && b.height > 0);
    pills.forEach(el => {
      el.style.left = el.dataset.baseLeft;
      el.style.top = el.dataset.baseTop;
    });
    const placed = [];
    pills.forEach(el => {
      const seatEl = table.querySelector('.replayer-seat[data-seat="' + el.dataset.seat + '"]');
      const plaqueEl = seatEl && seatEl.querySelector('.replayer-seat-info');
      const cb = el.offsetParent;
      if (!plaqueEl || !cb) return;
      /* Its own seat's dealer button is kept a quarter r off, not a whole r: on a side seat the button hangs off the
         plaque's inner corner, and at a whole r it pushed that seat's wager back toward the pot, so the dealer's pill
         alone missed the 1g move out every other side seat took (owner, 2026-11-22: "move opp 1's bet pill 1g left";
         Opp 1 had the button). The plaque and the cards keep their r. */
      const ownAll = piecesOf(seatEl);
      const btnEl = seatEl && seatEl.querySelector('.replayer-dealer-btn');
      const btnBox = btnEl ? boxOf(btnEl) : null;
      const own = btnBox ? ownAll.filter(b => !(b.left === btnBox.left && b.top === btnBox.top && b.width === btnBox.width)) : ownAll;
      const others = [...table.querySelectorAll('.replayer-seat[data-seat]')].filter(s => s !== seatEl).flatMap(piecesOf);
      const C = cb.getBoundingClientRect();
      const ox = C.left + cb.clientLeft, oy = C.top + cb.clientTop, W = cb.clientWidth, H = cb.clientHeight;
      const w = el.offsetWidth, h = el.offsetHeight;
      let cx = ox + el.offsetLeft, cy = oy + el.offsetTop;           // the point the pill is centred on
      const hit = (list, x, y, g) => list.some(b => x - w / 2 < b.right + g && x + w / 2 > b.left - g && y - h / 2 < b.bottom + g && y + h / 2 > b.top - g);
      const box = (x, y) => ({ left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 });
      const clearElsewhere = (x, y) => !hit(felt, x, y, r / 4) && !hit(others, x, y, r / 4) && !hit(placed, x, y, r / 4);
      const hitOwn = (x, y, g) => hit(own, x, y, g) || (btnBox ? hit([btnBox], x, y, Math.min(g, r / 4)) : false);
      if (hitOwn(cx, cy, r) || !clearElsewhere(cx, cy)) {
        const P = plaqueEl.getBoundingClientRect();
        const tx = ox + W * 0.5, ty = oy + H * 0.4;                   // POT_AT
        let ux, uy;
        if (el.dataset.side === '1') { ux = Math.sign(tx - (P.left + P.width / 2)) || 1; uy = 0; }
        else { const dx = tx - cx, dy = ty - cy, len = Math.hypot(dx, dy) || 1; ux = dx / len; uy = dy / len; }
        // Along the line to the pot (back toward the seat too) as far as the pot's centre, and up to 12r to either side
        // of it, nearest first, the line before the side; 1r of cloth from its own seat if the table has it, else less.
        // (2r to a side left a nine-seat phone table's wager on the turn card, with cloth 3.5r off its line; 4r left a
        // side seat's winnings on the board's end card, with cloth above the board 6r up; 8r left a top seat's wager on
        // the pot's figure at 1440, its readout on the line and the cloth 10r over: 2026-11-16.)
        const reach = el.dataset.side === '1' ? Math.abs(tx - cx) : Math.hypot(tx - cx, ty - cy);
        const S2 = r / 2;
        const cands = [];
        for (let d = -reach / 2; d <= reach; d += S2) for (let p = -12 * r; p <= 12 * r + 1e-6; p += S2) cands.push({ d, p, cost: Math.abs(d) + 1.5 * Math.abs(p) });
        cands.sort((a, b) => a.cost - b.cost);
        const at = (c) => ({ x: cx + ux * c.d - uy * c.p, y: cy + uy * c.d + ux * c.p });
        let chosen = null;
        for (const g of [r, r / 2, r / 4]) {
          for (const c of cands) {
            const q = at(c);
            if (hitOwn(q.x, q.y, g)) continue;
            if (clearElsewhere(q.x, q.y)) { chosen = q; break; }
          }
          if (chosen) break;
        }
        // Then round its spot in every direction, every 15 degrees and out to 16r, nearest first: at a result a seat
        // low on the left had its line to the pot taken by its own readout above and the next seat's cards beside, and
        // cloth under its plaque (2026-11-16).
        if (!chosen) {
          outer: for (const g of [r, r / 2, r / 4]) {
            for (let rad = S2; rad <= 16 * r; rad += S2) {
              for (let a = 0; a < 24; a++) {
                const t = a * Math.PI / 12;
                const q = { x: cx + rad * Math.cos(t), y: cy + rad * Math.sin(t) };
                if (q.x - w / 2 < ox || q.x + w / 2 > ox + W || q.y - h / 2 < oy || q.y + h / 2 > oy + H) continue;
                if (hitOwn(q.x, q.y, g)) continue;
                if (clearElsewhere(q.x, q.y)) { chosen = q; break outer; }
              }
            }
          }
        }
        // No cloth anywhere in reach: off its own seat, the spot that covers least of everything else (it was the
        // first spot off its seat, wherever that landed: on the board, more often than not).
        let fallback = null;
        if (!chosen) {
          const over = (x, y) => [felt, others, placed].reduce((sum, list) => sum + list.reduce((t, b) =>
            t + Math.max(0, Math.min(x + w / 2, b.right) - Math.max(x - w / 2, b.left)) * Math.max(0, Math.min(y + h / 2, b.bottom) - Math.max(y - h / 2, b.top)), 0), 0);
          let best = Infinity;
          for (const c of cands) {
            const q = at(c);
            if (hitOwn(q.x, q.y, r / 4)) continue;
            const o = over(q.x, q.y);
            if (o < best - 0.5) { best = o; fallback = q; }
          }
        }
        const q = chosen || fallback;
        if (q) { cx = q.x; cy = q.y; }
      }
      placed.push(box(cx, cy));
      el.style.left = ((cx - ox) / W * 100).toFixed(3) + '%';
      el.style.top = ((cy - oy) / H * 100).toFixed(3) + '%';
      /* A wager already on the felt that this pass moves (something new took its cloth) glides to its new spot on the
         slide spring: it jumped there in a frame, 31px in a PLO hand (owner, 2026-11-21: "Every single animation should
         be ultra smooth"). Not while a motion of its own carries it (the push-out, a squash). */
      const now = { x: (cx - ox) / W, y: (cy - oy) / H };
      const was = wagerSpotsRef.current.get(el);
      wagerSpotsRef.current.set(el, now);
      if (springOn && springSet && was) {
        const dx = (was.x - now.x) * W, dy = (was.y - now.y) * H;
        if (Math.hypot(dx, dy) > 1.5 && !el.getAnimations().some(a => a.playState === 'running')) {
          const sl = tierSpring(springSet, 'slide');
          const rate0 = motion.capture ? motion.captureRate : (playing ? rateFor(speed) : 1) * REPLAYER_PACE;
          motion.run(el, { key: { el, kind: 'glide' }, prefix: 'translate(-50%, -50%)', size: { w, h }, channels: [
            { prop: 'x', spring: sl, from: dx, to: 0, timeScale: rate0 },
            { prop: 'y', spring: sl, from: dy, to: 0, timeScale: rate0 },
          ] });
        }
      }
    });
  };
  useLayoutEffect(() => { if (tableRef.current) placeWagers(tableRef.current); });
  /* Who took each run or board (boardWinnerTags), beside its cards: on the right, else on the left (a later run's row,
     under the shared cards' empty places), else the side that touches least; never on a card (owner, 2026-11-19/20: at
     402, eight-handed, the second row's tag lay on the side seat's plaque, then on the river). Before the pill, which
     keeps off them. */
  const placeRunTags = (table) => {
    const tags = [...table.querySelectorAll('.replayer-board-winner')];
    if (!tags.length || !table.clientWidth) return;
    tags.forEach(t => { delete t.dataset.side; });
    const r = subrowPx(table), g = r / 4;
    const T = table.getBoundingClientRect();
    const others = [...table.querySelectorAll('.replayer-seat-info, .replayer-seat-cards .card-row > *, .replayer-seat-hand-name:not([data-ghost]), .replayer-action-badge-outer, .replayer-dealer-btn, .replayer-bet-chip')]
      .map(e => e.getBoundingClientRect()).filter(b => b.width > 0 && b.height > 0);
    const clear = (b) => b.left >= T.left && b.right <= T.right
      && !others.some(o => b.left < o.right + g && b.right > o.left - g && b.top < o.bottom + g && b.bottom > o.top - g);
    const touch = (b) => others.reduce((sum, o) => sum + Math.max(0, Math.min(b.right, o.right + g) - Math.max(b.left, o.left - g))
      * Math.max(0, Math.min(b.bottom, o.bottom + g) - Math.max(b.top, o.top - g)), 0)
      + Math.max(0, T.left - b.left) * b.height + Math.max(0, b.right - T.right) * b.height;
    tags.forEach(t => {
      const right = t.getBoundingClientRect();
      if (clear(right)) return;
      t.dataset.side = 'left';
      const left = t.getBoundingClientRect();
      if (clear(left)) return;
      if (touch(right) <= touch(left)) delete t.dataset.side;
    });
  };
  useLayoutEffect(() => { if (tableRef.current) placeRunTags(tableRef.current); });
  /* The game pill, last: moved to the nearest spot up or down where no seat's piece, the board, the pot or its rows,
     the watermark or a wager touches it (owner, 2026-11-16: "Watermark/variant collision": moved up to clear a wager,
     it landed on the wordmark's lower half). With no such spot (a ten-seat phone table at a split showdown), it fades
     out for the step rather than lie on something: the game and stakes are the one thing on the felt nobody is
     waiting to read there. */
  const placePill = (table) => {
    if (!table.clientWidth || !table.clientHeight) return;   // the desktop pane's first commits draw it at 0 x 0
    const info = table.querySelector('.replayer-table-info');
    if (info) { info.style.marginTop = ''; delete info.dataset.away; }
    const r = subrowPx(table);
    if (!info || !info.getBoundingClientRect().width) return;
    const boxes = [...table.querySelectorAll('.replayer-seat-info, .replayer-action-badge-outer, .replayer-seat-draw-badge, .replayer-seat-hand-name:not([data-ghost]), .replayer-dealer-btn, .replayer-seat-cards .card-row > *, .replayer-board-area:not(.replayer-dead-area) .card-row > *, .replayer-pot-display, .replayer-pot-layers.is-placed:not([data-ghost]) > *, .replayer-split-shares.is-placed:not([data-ghost]) > *, .replayer-watermark, .replayer-bet-chip')]
      .map(e => e.getBoundingClientRect()).filter(b => b.width > 0 && b.height > 0);
    /* The pill itself (and the tournament line under it), not the 46% column that centres them: that column reached
       a side seat's cards on a small table, and the pill moved off cards it was nowhere near, onto the watermark. */
    const kids = [...info.children].map(e => e.getBoundingClientRect()).filter(b => b.width > 0 && b.height > 0);
    const I = kids.length
      ? { left: Math.min(...kids.map(b => b.left)), right: Math.max(...kids.map(b => b.right)), top: Math.min(...kids.map(b => b.top)), bottom: Math.max(...kids.map(b => b.bottom)) }
      : info.getBoundingClientRect();
    const g = r / 4;
    const clear = (dy) => !boxes.some(b => I.left < b.right + g && I.right > b.left - g && I.top + dy < b.bottom + g && I.bottom + dy > b.top - g);
    if (clear(0)) return;
    const T = table.getBoundingClientRect();
    for (let k = 1; k <= 32; k++) {                 // 0.5r steps, down first (the cloth under the board is the free one)
      for (const dy of [k * r / 2, -k * r / 2]) {
        if (I.top + dy < T.top || I.bottom + dy > T.bottom) continue;
        if (clear(dy)) { info.style.marginTop = dy + 'px'; return; }
      }
    }
    info.dataset.away = '1';
  };
  useLayoutEffect(() => { if (tableRef.current) placePill(tableRef.current); });
  /* The settle pass (2026-11-16): each of those is decided in the commit, while the cards deal, flip and tuck, a folded
     plaque eases to its scale and the desktop pane's seats find their places, so a label could be moved for cards
     that were not where they came to rest, and stay moved (on the player's name, at 1440 and 1728). When the motion on
     the table has finished, the card rows, the button, the labels, the wagers and the pill are placed again, and any
     readout that now touches something. */
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return undefined;
    /* Looked for two frames on: the moments effect, after this one, starts this commit's motion, and a moment can build
       its work the frame after its press. It waits until the table is quiet (a result's moments run in a chain), then
       runs once. A wager it moves is moved in the record the next sweep starts from as well. */
    let live = true;
    const settle = () => {
      if (!live || tableRef.current !== table) return;
      placeTableFoot(table);
      placeCardRows(table);
      placeButton(table);
      placeLabels(table);
      placeNames(table, true);
      /* Where each wager rests (its laid-out place, not its drawn one: a wager this pass moves glides there, and drawn
         it is still where it was). */
      const restAt = (el) => ({ x: el.offsetLeft, y: el.offsetTop });
      const before = new Map([...table.querySelectorAll('.replayer-bet-chip[data-seat]')].map(el => [el, restAt(el)]));
      placeWagers(table);
      before.forEach((b, el) => {
        const a = restAt(el);
        const dx = a.x - b.x, dy = a.y - b.y;
        const rec = prevWagersRef.current.get(Number(el.dataset.seat));
        if ((dx || dy) && rec && rec.el === el && rec.geo) { rec.geo.cx += dx; rec.geo.cy += dy; }
      });
      placeRunTags(table);
      placePill(table);
    };
    /* Each frame until nothing finite that moves anything is running on the page (the desktop pane round the table
       moves it too), then once; never waiting on a motion's `finished`, which a paused one never resolves. Six seconds
       at most. A fade or a change of colour moves nothing, and a readout's own reveal is measured round (restOf), so
       neither is waited for: the readout then takes its place before it shows, not after. */
    let frame = 0;
    const t0 = performance.now();
    const PAINT = /^(opacity|color|background-?color|border-?(top|right|bottom|left)-?color|box-?shadow|outline-?color|fill|stroke)$/i;
    const SKIP = new Set(['offset', 'easing', 'composite', 'computedOffset']);
    const moves = (a) => {
      if (a.playState !== 'running') return false;
      const fx = a.effect;
      const end = fx && fx.getComputedTiming ? fx.getComputedTiming().endTime : Infinity;
      if (!Number.isFinite(end)) return false;
      const t = fx && fx.target;
      if (t && t.closest && t.closest('.replayer-seat-hand-name')) return false;
      let props = a.transitionProperty ? [a.transitionProperty] : null;
      if (!props) { try { props = [...new Set(fx.getKeyframes().flatMap(k => Object.keys(k)).filter(k => !SKIP.has(k)))]; } catch (e) { props = ['?']; } }
      return props.some(p => !PAINT.test(p));
    };
    const wait = () => {
      if (!live) return;
      const running = document.getAnimations().some(moves);
      if (running && performance.now() - t0 < 6000) { frame = requestAnimationFrame(wait); return; }
      settle();
    };
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(wait); });
    /* And when the table changes size without motion (the desktop pane lays it out after its first commits). */
    let size = table.clientWidth + 'x' + table.clientHeight;
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const now = table.clientWidth + 'x' + table.clientHeight;
      if (now === size) return;
      size = now;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(wait);
    }) : null;
    if (ro) ro.observe(table);
    return () => { live = false; cancelAnimationFrame(frame); if (ro) ro.disconnect(); };
  });

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (table && table.__replayerMotion !== motion) table.__replayerMotion = motion;
    motion.inCommit = true;
    try {
      const prevWagers = prevWagersRef.current;
      /* Every wager on the felt this commit, at rest: where the next street press finds them when
         it sweeps them in (by then they are unmounted, so they are measured now). Rects include a
         push-out still running, so its presented offset is taken back off. */
      const nowWagers = new Map();
      if (table && springOn) {
        table.querySelectorAll('.replayer-bet-chip[data-seat]').forEach(el => {
          const r = el.getBoundingClientRect();
          const ch = el.querySelector('.chip-stack-visual');
          const cr = ch ? ch.getBoundingClientRect() : r;
          const s = motion.state(el);
          const ox = s ? s.val.x : 0, oy = s ? s.val.y : 0;
          const disc = ch && ch.firstElementChild;
          nowWagers.set(Number(el.dataset.seat), {
            el,
            topColor: disc ? disc.style.getPropertyValue('--chip').trim() : '',
            geo: {
              cx: r.left + r.width / 2 - ox, cy: r.top + r.height / 2 - oy, w: r.width, h: r.height,
              chip: { dx: (cr.left + cr.width / 2) - (r.left + r.width / 2), dy: (cr.top + cr.height / 2) - (r.top + r.height / 2), w: cr.width, h: cr.height },
            },
          });
        });
      }
      /* Every seat's cards as this commit draws them (the next press may fold them away, turn them over or deal
         beside them: by then they are gone or changed), and every card standing in a pose. */
      const seatCardsNow = new Map();
      const cardElsNow = new Set();
      const posedNow = [];
      const boardNow = { rowY: null, extraRows: 0, mainLen: 0, xk: new Map() };
      const seatsNow = { turn: null, labels: [], runNames: new Map() };
      const deadNow = new Map();
      if (table && springOn) {
        table.querySelectorAll('[data-seat-cards] > .card-row > *').forEach(el => {
          const seat = Number(el.parentElement.parentElement.dataset.seatCards);
          const r = el.getBoundingClientRect();
          if (!(r.width > 0)) return;
          const m = /rotate\(([-\d.]+)deg\)/.exec(el.style.transform || '');
          let list = seatCardsNow.get(seat);
          if (!list) seatCardsNow.set(seat, list = []);
          list.push({ node: el, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: el.offsetWidth || r.width, h: el.offsetHeight || r.height, angle: m ? Number(m[1]) : 0, back: el.tagName !== 'IMG',
            // How strongly it is drawn (a draw game's thrown card dims to 0.4 before it goes): what a copy fades from. Its
            // own style first: the computed value is still easing there in the commit that dims it.
            o: el.style.opacity !== '' ? Number(el.style.opacity) : Number(getComputedStyle(el).opacity) });
          cardElsNow.add(el);
        });
        table.querySelectorAll('.card-row > [data-pose]').forEach(el => posedNow.push(el));
        // The seats (51-71): the plaque with the turn, every action label, every name under a plaque.
        const turnInfo = turnIdx != null && turnIdx >= 0 ? table.querySelector('.replayer-seat[data-seat="' + turnIdx + '"] .replayer-seat-info') : null;
        seatsNow.turn = turnInfo ? { seat: turnIdx, rect: turnInfo.getBoundingClientRect() } : null;
        /* Each label's place is kept against its plaque, in the plaque's own units (dx, dy), so a copy fading where
           the label stood is placed by the plaque as it is THEN: a seat folded on the street's last action shrinks to
           0.88 after this commit, and the label with it. */
        table.querySelectorAll('.replayer-action-badge-outer[data-act-seat]').forEach(el => {
          const r = el.getBoundingClientRect();
          if (!(r.width > 0)) return;
          const plaque = el.closest('.replayer-seat-info');
          const pr = plaque ? plaque.getBoundingClientRect() : null;
          const ps = pr && plaque.offsetWidth ? pr.width / plaque.offsetWidth : 1;
          seatsNow.labels.push({ node: el, seat: Number(el.dataset.actSeat), cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: el.offsetWidth || r.width, h: el.offsetHeight || r.height, angle: 0,
            dx: pr ? (r.left + r.width / 2 - (pr.left + pr.width / 2)) / (ps || 1) : null, dy: pr ? (r.top + r.height / 2 - (pr.top + pr.height / 2)) / (ps || 1) : null });
        });
        table.querySelectorAll('[data-run-name]').forEach(el => {
          const cs = getComputedStyle(el);
          seatsNow.runNames.set(Number(el.dataset.nameSeat), { text: el.dataset.runName, lead: !el.classList.contains('is-trailing'), color: cs.color, border: cs.borderColor });
        });
        /* What may leave without a moment of its own (a readout or the stud note, the main and side pots' row, a split's
           shares, the pile), with where it hangs: the next press fades a copy of whatever went out where it stood. */
        seatsNow.leavers = [...table.querySelectorAll(LEAVERS)].map(el => ({
          node: el, parent: el.parentElement,
          cls: el.matches('[data-name-seat]') ? null : ['.replayer-pot-layers', '.replayer-split-shares', '.replayer-pot-above'].find(c => el.matches(c)),
        }));
        // The Dead cards strip (7), under the table in portrait, in the board's slot in landscape.
        const deadRoot = table.closest('.replayer-replay') || table.parentElement;
        if (deadRoot) deadRoot.querySelectorAll('.replayer-dead-strip-cards > img, .replayer-dead-row > img').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width > 0) deadNow.set(el.getAttribute('alt'), r.left + r.width / 2);
        });
        // The board's rows (12, 13): where the first row sits, how many rows follow it, where their cards are.
        const area = table.querySelector('.replayer-board-area:not(.replayer-dead-area)');
        const main = area && area.querySelector(':scope > .card-row:not(.replayer-board-extra)');
        if (main) {
          const mr = main.getBoundingClientRect();
          boardNow.rowY = mr.top + mr.height / 2;
          boardNow.mainLen = main.querySelectorAll(':scope > [data-slot]').length;
          const extras = [...area.querySelectorAll(':scope > .replayer-board-extra')];
          boardNow.extraRows = extras.length;
          extras.forEach(row => row.querySelectorAll(':scope > [data-xk]').forEach(el => {
            const r = el.getBoundingClientRect();
            boardNow.xk.set(el.dataset.xk, r.left + r.width / 2);
          }));
        }
        // A card's back, as this theme paints it: a card turned over is drawn as one until its half turn.
        const themeKey = table.className + '|' + (document.documentElement.dataset.cardBack || '');
        if (!motion.backPaint || motion.backTheme !== themeKey) {
          const b = table.querySelector('.replayer-seat-cards .card-unknown, .replayer-seat-cards .card-placeholder');
          if (b) {
            const cs = getComputedStyle(b);
            motion.backPaint = { image: cs.backgroundImage, color: cs.backgroundColor, ring: cs.borderTopColor,
              size: cs.backgroundSize, position: cs.backgroundPosition, repeat: cs.backgroundRepeat, radius: cs.borderRadius };
            motion.backTheme = themeKey;
          }
        }
      }
      const record = () => {
        if (springOn) {
          motion.prevSeatCards = seatCardsNow;
          motion.prevCardEls = cardElsNow;
          motion.prevBoard = boardNow;
          motion.prevSeats = seatsNow;
          motion.prevAtRisk = new Set(atRiskSeats);
          motion.prevStaleEls = new Set(table ? table.querySelectorAll('.replayer-action-badge-outer.is-stale') : []);
          motion.prevNameEls = new Set(table ? table.querySelectorAll('[data-name-seat]') : []);
          motion.prevPotPills = new Set(table ? table.querySelectorAll(POT_PILLS) : []);
          motion.prevBadges = new Set(table ? table.querySelectorAll('.replayer-seat-draw-badge') : []);
          motion.prevDead = deadNow;
          // Each stack's figure as drawn (31, 33): what a countdown starts from.
          motion.prevStackVals = new Map(hand.players.map((_, pi) => [pi, stackFigure(pi)]));
          // What pose each card was last drawn in (a card that lost its pose: none).
          if (!motion.lastPose) motion.lastPose = new WeakMap();
          (motion.prevPosed || []).forEach(el => motion.lastPose.set(el, ''));
          posedNow.forEach(el => motion.lastPose.set(el, el.dataset.pose || ''));
          motion.prevPosed = posedNow;
        }
        revealRef.current = springReveal;
        prevWagersRef.current = nowWagers;
        committedStepRef.current = { s: streetIdx, a: actionIdx, r: showResult };
        // The figure this commit draws (an arrival's write moves it on): the next press's floor.
        motion.potShown = shownPot;
      };
      if (!springOn) { motion.finishAll(); resyncDigits(); record(); return; }
      if (motionJumped) motion.finishAll();
      /* 1: the deal, under Play from the hand's first step: each card from the middle of the table to its seat on the hand
         spring, a seat after another from the button's left, round by round (stud: two down, then the door). */
      if (motion.openFor !== hand) { motion.openFor = hand; pendingOpenRef.current = true; }
      /* What of each seat covers a chip coming out from under it (seatCoverOf), measured before the deal below sends
         this commit's cards to the middle of the table to deal them in. A wager whose push is over, or was cut short,
         goes back over the felt's pieces (a push's own tick does it when it is clear of its seat). */
      const coverAtRest = new Map();
      const coverOf = (pi) => {
        if (!coverAtRest.has(pi)) coverAtRest.set(pi, seatCoverOf(table && table.querySelector('.replayer-seat[data-seat="' + pi + '"]')));
        return coverAtRest.get(pi);
      };
      if (table && pendingOpenRef.current && pendingDealRef.current) hand.players.forEach((_, pi) => coverOf(pi));
      if (table) table.querySelectorAll('.replayer-bet-chip[data-under]').forEach(el => {
        const e = motion.entries.get(el);
        if (!e || e.done) delete el.dataset.under;
      });
      const underSeat = (el, entry) => {
        if (!entry || !entry.emerge) return;
        el.dataset.under = '';
        motion.tick(entry.emerge.clear != null ? entry.emerge.clear : entry.end, () => { delete el.dataset.under; }, entry);
      };
      let dealEnds = -1;
      if (pendingDealRef.current && table && streetIdx === 0 && actionIdx < 0 && !showResult) {
        pendingDealRef.current = false;
        if (rSettings.animateDeal) {
          const T = table.getBoundingClientRect();
          // From the middle of the table (owner, 2026-11-14), not the dealer spot by the button.
          const spot = { x: T.left + T.width / 2, y: T.top + T.height / 2 };
          const st0 = SPRING_SETS[springSet].stage;
          const rate0 = (playing ? rateFor(speed) : 1) * REPLAYER_PACE;
          const per = dealOrder.map(pi => [...table.querySelectorAll('[data-seat-cards="' + pi + '"] > .card-row > *')]).filter(a => a.length);
          const rounds = Math.max(0, ...per.map(a => a.length));
          const total = per.reduce((n, a) => n + a.length, 0);
          const stagger = total > 1 ? Math.min(st0.sweepStagger, 420 / (total - 1)) : 0;
          const jobs = [];
          let k = 0;
          for (let r = 0; r < rounds; r++) per.forEach(arr => {
            const el = arr[r];
            if (!el) return;
            const rr = el.getBoundingClientRect();
            jobs.push({ el, dx: spot.x - (rr.left + rr.width / 2), dy: spot.y - (rr.top + rr.height / 2), delay: (k++ * stagger) / rate0, size: { w: el.offsetWidth || rr.width, h: el.offsetHeight || rr.height } });
          });
          if (jobs.length) {
            motion.finishAll();
            motion.beginMoment('deal');
            motion.momentKey = 'deal';
            jobs.forEach(j => { j.el.getAnimations().forEach(a => a.cancel()); dealIn(motion, { set: springSet, rate: rate0, el: j.el, dx: j.dx, dy: j.dy, delay: j.delay, size: j.size }); });
            dealEnds = jobs[jobs.length - 1].delay + cardTimes(springSet).armArrive / rate0;   // dealIn's spring
          }
        }
      }
      /* 26-28: the opening. The antes travel into the pot (a big blind ante from the big blind, a stud ante from
         every seat, sweepStagger apart from the dealer's left; the pot's figure ticks as each lands), then the
         blinds and a straddle are posted from their seats a beat apart, pushed out as a bet is, each stack
         counting down as its chips leave. After the deal when Play deals the hand. */
      if (pendingOpenRef.current && table && streetIdx === 0 && actionIdx < 0 && !showResult && !motion.capture) {
        pendingOpenRef.current = false;
        if (rSettings.animateChips) {
          const st0 = SPRING_SETS[springSet].stage;
          const rate0 = (playing ? rateFor(speed) : 1) * REPLAYER_PACE;
          const flick0 = tierSpring(springSet, 'flick'), hand0 = tierSpring(springSet, 'hand');
          const T = table.getBoundingClientRect();
          const t0 = Math.max(0, dealEnds);
          const pills = [...table.querySelectorAll('.replayer-bet-chip[data-seat]')].map(el => ({ el, seat: Number(el.dataset.seat) }));
          const posOf = (pi) => (hand.players[pi]?.position || '');
          const rank = (pi) => (/SB/.test(posOf(pi)) ? 0 : posOf(pi) === 'BB' ? 1 : 2);
          pills.sort((a, b) => rank(a.seat) - rank(b.seat) || dealOrder.indexOf(a.seat) - dealOrder.indexOf(b.seat));
          const ante = Number((hand.blinds || {}).ante) || 0;
          const payers = ante > 0 ? (category === 'stud' ? dealOrder.filter(pi => !folded.has(pi)) : [hand.players.findIndex(p => p.position === 'BB')].filter(i => i >= 0)) : [];
          const pileEl0 = table.querySelector('.replayer-pot-main .replayer-pot-chips') || potTotalRef.current;
          const pileR = pileEl0 ? pileEl0.getBoundingClientRect() : null;
          const potTn = potTextNode();
          const probe = table.querySelector('.replayer-chip-probe.is-disc');
          const chipD = probe ? probe.getBoundingClientRect().width || 12 : 12;
          const layer0 = sweepLayerRef.current;
          const L0 = layer0 ? layer0.getBoundingClientRect() : null;
          const anteJobs = (pileR && L0 && layer0) ? payers.map((pi, k) => {
            const info = table.querySelector('.replayer-seat[data-seat="' + pi + '"] .replayer-seat-info');
            if (!info) return null;
            const r = info.getBoundingClientRect();
            const px = pileR.left + pileR.width / 2, py = pileR.top + pileR.height / 2;
            // From under the plaque's middle, out from behind the seat (seatCoverOf); it left from the plaque's edge.
            const fx = r.left + r.width / 2, fy = r.top + r.height / 2;
            coverOf(pi);   // measured now, before the button below starts its move
            return { pi, fx, fy, px, py, delay: t0 + (k * st0.sweepStagger) / rate0 };
          }).filter(Boolean) : [];
          const anteEnd = anteJobs.length ? anteJobs[anteJobs.length - 1].delay + timeTo(hand0, 0.98) / rate0 : t0;
          const pillJobs = pills.map((p, k) => {
            const pos = seats[p.seat] || [50, 50];
            const dx = (pos[0] - parseFloat(p.el.style.left)) / 100 * T.width, dy = (pos[1] - parseFloat(p.el.style.top)) / 100 * T.height;
            const len = Math.hypot(dx, dy) || 1;
            const push = st0.push * (motion.boardCardW || 30);
            const tn = stackTextNode(p.seat);
            const posted = computePlayerContrib(hand, 0, currentActions, -1, p.seat);
            const r = p.el.getBoundingClientRect();
            // A blind comes out from under its seat as a bet does: from the plaque's middle (seatCoverOf).
            const info = table.querySelector('.replayer-seat[data-seat="' + p.seat + '"] .replayer-seat-info');
            const ir = info ? info.getBoundingClientRect() : null;
            const fromPlaque = ir ? { x: ir.left + ir.width / 2 - (r.left + r.width / 2), y: ir.top + ir.height / 2 - (r.top + r.height / 2) } : null;
            return { ...p, ox: fromPlaque ? fromPlaque.x : dx / len * push, oy: fromPlaque ? fromPlaque.y : dy / len * push, under: !!fromPlaque, cover: coverOf(p.seat), delay: (anteJobs.length ? anteEnd + st0.beat / rate0 : t0) + (k * st0.beat) / rate0, tn, from: stackFigure(p.seat) + posted, to: stackFigure(p.seat), r };
          });
          const btnEl = table.querySelector('.replayer-dealer-btn');
          const btnSeatIdx = btnEl ? Number(btnEl.closest('.replayer-seat').dataset.seat) : -1;
          const btnJob = (() => {
            if (!btnEl || btnSeatIdx < 0 || hand.players.length < 3) return null;
            const prev = (btnSeatIdx - 1 + hand.players.length) % hand.players.length;
            const a = table.querySelector('.replayer-seat[data-seat="' + btnSeatIdx + '"] .replayer-seat-info');
            const b = table.querySelector('.replayer-seat[data-seat="' + prev + '"] .replayer-seat-info');
            if (!a || !b) return null;
            const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
            return { dx: (br.left + br.width / 2) - (ar.left + ar.width / 2), dy: (br.top + br.height / 2) - (ar.top + ar.height / 2), size: { w: btnEl.offsetWidth, h: btnEl.offsetHeight } };
          })();
          if (anteJobs.length || pillJobs.length || btnJob) {
            if (dealEnds < 0) { motion.finishAll(); motion.beginMoment('open'); }
            if (btnJob) {
              const armB = tierSpring(springSet, 'arm');
              motion.run(btnEl, { key: { el: btnEl, kind: 'arrive' }, property: 'individual', size: btnJob.size, channels: [
                { prop: 'x', spring: armB, from: btnJob.dx, to: 0, delay: 60 / rate0, timeScale: rate0 },
                { prop: 'y', spring: armB, from: btnJob.dy, to: 0, delay: 60 / rate0, timeScale: rate0 },
                { prop: 'rotate', spring: armB, from: -120, to: 0, delay: 60 / rate0, timeScale: rate0 },
              ] });
            }
            motion.momentKey = 'open';
            const full = shownPot;
            // The figure counts the antes up as they land, to the whole pot (potCommitted: the blinds already in it).
            /* The pot builds as the hand opens (owner, 2026-11-22: "Build the pot starting with the ante and then the small
               and big blinds"): empty at the start, each ante as it lands, then each blind as its chips go out, the figure
               and the pile together (the pile is the whole pot, PILE_IS_WHOLE_POT). It began at the blinds' total, and the
               pile at the whole pot. A stack the pile no longer has fades out as a copy (fadePileOut); a blind's new stack
               fades in over two beats, since no chip lands on it to cover a quick one. The last step is the pot itself. */
            let landed = 0;
            const beat2 = 2 * st0.beat;
            const potTo = (value, slow) => {
              landed = Math.min(potCommitted, value);
              motion.potBuilding = landed < potCommitted;
              if (potTn) { potTn.data = landed > 0 ? fmtChips(landed) : ''; motion.wroteDigits = true; }
              if (!motion.setPile) return;
              const row = table.querySelector('.replayer-pot-main .replayer-pot-chips');
              const keep = potStacksFor(landed).map(st => st.color);
              const going = slow && row && layer0 ? [...row.children].filter(el => el.dataset.color && !keep.includes(el.dataset.color)) : [];
              if (going.length) fadePileOut(motion, { set: springSet, rate: rate0, layer: layer0, layerRect: layer0.getBoundingClientRect(), duration: beat2, stacks: going.map(el => ({ el, rect: el.getBoundingClientRect() })) });
              motion.setPile(landed, slow ? { fade: beat2 } : undefined);
            };
            if (anteJobs.length || pillJobs.length) potTo(0);
            anteJobs.forEach((j, ji) => {
              const chip = document.createElement('div');
              chip.className = 'replayer-flying-chip is-spring is-disc';
              chip.setAttribute('aria-hidden', 'true');
              const face = document.createElement('div');
              face.className = 'replayer-pot-chip-disc';
              /* In its denomination's colour, the ante's largest chip, as a wager's flight is. With none it took the
                 table's text colour (--chip: currentColor): a plain off-white disc, its white inserts lost on it, flying
                 from the big blind at the start of every hand with an ante (owner, 2026-11-22: "Something weird flying
                 from the BB seat at the start of the hand"). */
              const anteColor = getChipBreakdown(ante)[0];
              face.style.setProperty('--chip', anteColor);
              applyChipInserts(face, pipShift(full + 31, ji), anteColor);
              chip.appendChild(face);
              /* Unseen in its own right until it flies (owner, 2026-11-22: "Chip appears in front of BB as cards are dealt,
                 then disappears before moving into the pot"): it waited out the deal at full in its own style, the
                 animation's backwards fill not holding it at its first frame on the phone, then went to that first frame
                 (0) as the flight began and faded in on the way. One opacity curve: in over appear as it leaves, out over
                 arrivalFade as it lands. */
              Object.assign(chip.style, { left: (j.fx - L0.left) + 'px', top: (j.fy - L0.top) + 'px', transform: 'translate(-50%, -50%)', opacity: '0' });
              layer0.appendChild(chip);
              const arrive = j.delay + timeTo(hand0, 0.98) / rate0;
              const lift = st0.crossLift || 0.12;
              const inMs = st0.appear / rate0, outMs = st0.arrivalFade / rate0;
              const path = [
                { prop: 'x', spring: hand0, from: 0, to: j.px - j.fx, delay: j.delay, timeScale: rate0 },
                { prop: 'y', spring: hand0, from: 0, to: j.py - j.fy, delay: j.delay, timeScale: rate0 },
                { prop: 'scale', fn: (t) => { const q = t <= j.delay ? 0 : hand0.at((t - j.delay) * rate0); return 1 + lift * 4 * q * (1 - q); }, start: j.delay, end: arrive },
              ];
              /* It comes out from under the seat: a copy on the level under the seats (the fold layer) flies until the
                 chip is clear of the plaque and the cards, and this one, on the sweep's level, takes over there, two
                 frames before the copy goes, so the chip is never drawn less than whole. It fades in over `appear`, as a
                 new wager does (longer if it stays under the plaque longer: to `peek`, when it first shows). */
              const cv = coverOf(j.pi);
              const em = foldLayerRef.current
                ? emergeTimes(path, { left: j.fx - chipD / 2, right: j.fx + chipD / 2, top: j.fy - chipD / 2, bottom: j.fy + chipD / 2 }, cv.cover, { also: cv.also, end: arrive })
                : null;
              const clear = em && em.clear != null && em.clear > j.delay ? em.clear : null;
              const inEnd = Math.max(j.delay + inMs, clear != null && em.peek > j.delay ? em.peek : 0);   // over `appear` at least, as a wager
              const shown = (t) => (t <= j.delay ? 0 : t < inEnd ? (t - j.delay) / (inEnd - j.delay) : t <= arrive ? 1 : Math.max(0, 1 - (t - arrive) / outMs));
              const handBack = 2 * 1000 / 60;
              const entry = motion.run(chip, { transient: true, prefix: 'translate(-50%, -50%)', size: { w: chipD, h: chipD }, end: arrive + outMs, channels: [
                { prop: 'opacity', fn: clear != null ? (t) => (t < clear ? 0 : shown(t)) : shown, start: j.delay, end: arrive + outMs },
                ...path,
              ] });
              if (clear != null) {
                const fl = foldLayerRef.current, FL = fl.getBoundingClientRect();
                const under = chip.cloneNode(true);
                Object.assign(under.style, { left: (j.fx - FL.left) + 'px', top: (j.fy - FL.top) + 'px', opacity: '0' });
                fl.appendChild(under);
                motion.run(under, { transient: true, prefix: 'translate(-50%, -50%)', size: { w: chipD, h: chipD }, end: clear + handBack, channels: [
                  { prop: 'opacity', fn: (t) => (t < clear + handBack ? shown(t) : 0), start: j.delay, end: clear + handBack },
                  ...path,
                ] });
              }
              const last = ji === anteJobs.length - 1 && !pillJobs.length;
              const tick = () => potTo(last ? potCommitted : landed + ante);
              if (entry) motion.tick(arrive, tick, entry); else tick();
            });
            const postAt = timeTo(flick0, 0.98) / rate0;
            pillJobs.forEach((j, k) => {
              const xy = [
                { prop: 'x', spring: flick0, from: j.ox, to: 0, delay: j.delay, timeScale: rate0 },
                { prop: 'y', spring: flick0, from: j.oy, to: 0, delay: j.delay, timeScale: rate0 },
              ];
              // From under its seat: unseen until it shows past the plaque or a card, so its fade in ends there.
              const em = j.under ? emergeTimes(xy, { left: j.r.left, right: j.r.right, top: j.r.top, bottom: j.r.bottom }, j.cover.cover, { also: j.cover.also, end: j.delay + postAt }) : null;
              const fadeEnd = Math.max(j.delay + st0.appear / rate0, em && em.peek != null && em.peek > j.delay ? em.peek : 0);
              const entry = motion.run(j.el, { prefix: 'translate(-50%, -50%)', size: { w: j.r.width, h: j.r.height }, channels: [
                { prop: 'opacity', ramp: { from: 0, to: 1, delay: j.delay, duration: fadeEnd - j.delay } },
                ...xy,
              ] });
              if (entry && em) { entry.emerge = em; underSeat(j.el, entry); }
              // Its chips counted into the pot as they come to rest in front of the seat.
              const posted = Math.max(0, j.from - j.to);
              const tick = () => potTo(k === pillJobs.length - 1 ? potCommitted : landed + posted, true);
              if (entry) motion.tick(j.delay + postAt, tick, entry); else tick();
              // No stack count-down as the blinds go in (owner, 2026-11-13: "remove the stack number animation at
              // the start"): the plaque shows the stack after its blind from the first frame.
            });
          }
        }
      }
      if (motion.unitRoll && table && springOn) {
        const roll = motion.unitRoll;
        motion.unitRoll = null;
        const n = hand.players.length;
        const S0 = SPRING_SETS[springSet].stage;
        const ySp = tierSpring(springSet, 'yield');
        const jobs = [];
        table.querySelectorAll('.replayer-seat[data-seat] .replayer-seat-stack').forEach(el => {
          const pi = Number(el.closest('.replayer-seat').dataset.seat);
          const was = roll.texts.get(pi);
          if (was == null || was === el.textContent) return;
          const ring = Math.min((pi - roll.seat + n) % n, (roll.seat - pi + n) % n);
          jobs.push({ el, pi, was, delay: ring * S0.sweepStagger, w: el.offsetWidth, h: el.offsetHeight });
        });
        if (jobs.length) {
          const r = (() => { const pr = document.createElement('div'); pr.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)'; table.appendChild(pr); const v = pr.getBoundingClientRect().height / 100 || 8; table.removeChild(pr); return v; })();
          motion.finishAll();
          motion.beginMoment('unit');
          jobs.forEach(j => {
            const plaque = j.el.parentElement;
            if (!plaque) return;
            if (getComputedStyle(plaque).position === 'static') plaque.style.position = 'relative';
            const ghost = document.createElement('span');
            ghost.className = 'replayer-stack-roll';
            ghost.textContent = j.was;
            Object.assign(ghost.style, { left: j.el.offsetLeft + 'px', top: j.el.offsetTop + 'px', width: j.w + 'px', height: j.h + 'px', right: 'auto', bottom: 'auto' });
            plaque.appendChild(ghost);
            motion.run(ghost, { transient: true, property: 'individual', size: { w: j.w, h: j.h }, channels: [
              { prop: 'y', spring: ySp, from: 0, to: -0.75 * r, delay: j.delay, timeScale: 1 },
              { prop: 'opacity', ramp: { from: 1, to: 0, delay: j.delay, duration: 60 } },
            ] });
            motion.run(j.el, { key: { el: j.el, kind: 'roll' }, property: 'individual', size: { w: j.w, h: j.h }, channels: [
              { prop: 'y', spring: ySp, from: 0.75 * r, to: 0, delay: j.delay, timeScale: 1 },
              { prop: 'opacity', ramp: { from: 0, to: 1, delay: j.delay, duration: 60 } },
            ] });
          });
        }
      }
      if (!motionKind || !table) { resyncDigits(); record(); return; }

      const set = springSet;
      const S = SPRING_SETS[set].stage;
      const rate = motion.capture ? motion.captureRate : (playing ? rateFor(speed) : 1) * REPLAYER_PACE;
      motion.rate = rate;
      /* The one flight layer: the sweep's ghosts and the shipped chips fly in it (over the board,
         under the pot's figure, the wagers and the button). There used to be a second, empty one
         over everything at --z-flight: a table-sized element above every moving one. */
      const layer = sweepLayerRef.current;
      const L = layer ? layer.getBoundingClientRect() : null;
      const foldLayer = foldLayerRef.current;
      const FL = foldLayer ? foldLayer.getBoundingClientRect() : null;
      const potFigure = potTotalRef.current;
      const pileEl = table.querySelector('.replayer-pot-main .replayer-pot-chips');
      const pileRect = pileEl ? pileEl.getBoundingClientRect() : null;
      const pileKids = pileEl ? [...pileEl.children] : [];
      const pileStacks = pileKids.map(c => c.getBoundingClientRect());
      // The colours the pile shows now (a stack drawn unseen, waiting for its ghost, is not one).
      const pileColors = pileKids.filter(c => !c.classList.contains('is-pending')).map(c => c.dataset.color).filter(Boolean);
      const pileCentre = pileRect && pileRect.width > 0 ? centreOf(pileRect)
        : potFigure ? centreOf(potFigure.getBoundingClientRect()) : centreOf(table.getBoundingClientRect());
      const boardCard = table.querySelector('.replayer-board-area:not(.replayer-dead-area) .card-row > [data-slot]');
      const cq = Math.min(table.clientWidth, table.clientHeight) / 100;
      if (boardCard && boardCard.offsetWidth) motion.boardCardW = boardCard.offsetWidth;
      // A board card's width (its layout box, not a scaled frame of it); before the flop, the
      // board's own --card-h rule on this table's size, at the deck's aspect.
      const cardW = motion.boardCardW || Math.min(140, Math.max(18, 10.9375 * cq)) * 0.8366;
      const writes = [];
      /* A copy of a stack's words hangs on the plaque, so it is drawn in the stack's own type, not the plaque's (owner,
         2026-11-22: "the AT RISK text inexplicably jumps to another weight": the bust's AT RISK held in the plaque's face
         and size until the pot landed, as did the ALL-IN crossing to AT RISK). */
      const stackType = (st) => {
        const cs = getComputedStyle(st);
        return { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, fontStretch: cs.fontStretch,
          letterSpacing: cs.letterSpacing, lineHeight: cs.lineHeight, color: cs.color, textTransform: cs.textTransform,
          fontVariantNumeric: cs.fontVariantNumeric, fontFeatureSettings: cs.fontFeatureSettings, textAlign: cs.textAlign };
      };

      /* (3b) The sweep: the wagers that were on the felt go into the pot, the chips first. Shared by a
         street press and the result press (the river's wagers are collected before the pot is
         shipped). `board`: the rect a crossing chip must clear before the board moves. */
      const sweepLayer = layer;
      const pitchOf = () => (pileStacks.length > 1 ? pileStacks[1].left - pileStacks[0].left
        : pileStacks.length ? pileStacks[0].width + (parseFloat(getComputedStyle(pileEl).columnGap) || 0) : 0);
      const tracksPile = !!(pileRect && !potLayers.length && pileStacks.length);
      // For the pile's own landings (PotChipLive), so they never measure after a write.
      motion.pileGeom = tracksPile ? { pitch: pitchOf(), size: { w: pileStacks[0].width, h: pileStacks[0].height } } : null;
      const planWagers = (board, list = sweepPlan) => {
        if (!list || !list.length || !sweepLayer) return null;
        const wagers = list.map(w => {
          const g = prevWagers.get(w.seat);
          return g ? { ...w, el: g.el, geo: g.geo, topColor: g.topColor } : null;
        }).filter(Boolean);
        if (!wagers.length) return null;
        return planSweep(motion, {
          set, rate, wagers, board,
          pile: tracksPile
            ? { cx: pileCentre.x, cy: pileCentre.y, bottom: pileRect.bottom, pitch: pitchOf(), base: shownPot, stacksFor: potStacksFor, colors: pileColors }
            : { cx: pileCentre.x, cy: pileCentre.y },
        });
      };
      /* The sweep, written. As the chips leave the seats the pile's row becomes the row it will be
         once they are in (planSweep aimed every ghost at it): the stacks that stay make room, the
         new ones hold their places unseen, the ones leaving fade out where they are. The pot's
         digits tick at every landing; the stacks' heights change once, at the first; a new stack
         fades in under the ghost that lands on it.
         The ghosts are made in the press (the wagers they copy are gone from this commit); the
         pile's new row, which starts making room yieldAfterSweep later, is built in the frame after
         it (motion.defer), so the press frame carries only what its own frame shows. It keeps its
         place on the moment's clock: its delay is shortened by how late it is built (`late`). */
      const sweep = (plan) => {
        if (!plan) return;
        let ahead = plan.reduce((n, p) => n + p.w.amount, 0);
        motion.pendingPot += ahead;
        const final = plan.final || { colors: [], fresh: [], unclaimed: [] };
        const unseen = new Set(final.fresh.filter(c => !final.unclaimed.includes(c)));
        let landed = false;
        sweepWagers(motion, {
          set, rate, layer: sweepLayer, plan,
          onArrive: (amount, last, p) => {
            landed = true;
            motion.pendingPot = Math.max(0, motion.pendingPot - amount);
            ahead = Math.max(0, ahead - amount);
            if (p && p.color) unseen.delete(p.color);
            if (motion.writePot) motion.writePot(tracksPile ? { ahead, hidden: [...unseen] } : null);
          },
        });
        // (The pile is the whole pot, wagers included, since 2026-11-15: a sweep moves chips into it without changing it.)
        if (!PILE_IS_WHOLE_POT && tracksPile && final.colors.length && motion.setPile && final.colors.join() !== pileColors.join()) {
          // Measured at the press, in the read pass: nothing here forces a layout.
          const going = pileKids.filter(el => el.dataset.color && !final.colors.includes(el.dataset.color) && !el.classList.contains('is-pending'));
          const base = shownPot;
          motion.defer((late) => {
            // A landing before this ran has drawn the pile itself (a long press frame).
            if (landed || !motion.setPile) return;
            const delay = Math.max(0, S.yieldAfterSweep - late * rate);
            if (going.length) {
              fadePileOut(motion, {
                set, rate, layer: sweepLayer, layerRect: L, delay,
                stacks: going.map(el => ({ el, rect: pileStacks[pileKids.indexOf(el)] })),
              });
            }
            motion.setPile(base, { layout: final.colors, hidden: final.fresh, delay });
          });
        }
      };

      if (motionKind === 'street') {
        const delta = boardDeltaRef.current;
        const boardOn = rSettings.animateBoard && delta && delta.cards.length;
        const stayed = boardOn && delta.prev ? delta.cards.filter(el => delta.prev.has(el.dataset.ck)) : [];
        const added = boardOn ? delta.cards.filter(el => !delta.prev || !delta.prev.has(el.dataset.ck)) : [];
        const fromOf = (el) => delta.prev.get(el.dataset.ck) + delta.shift.get(el) - delta.now.get(el.dataset.ck);
        /* Where a crossing chip must be clear of before the board moves: the flop's stack in slot 0
           (scaled up 8% as it is placed), or the whole row with the room it makes. */
        let boardRect = null;
        if (boardOn && added.length) {
          if (!stayed.length) {
            const r0 = delta.rects.get(added[0]);
            boardRect = r0 ? { left: r0.left - r0.width * 0.1, right: r0.right + r0.width * 0.1, top: r0.top - r0.height * 0.2, bottom: r0.bottom + r0.height * 0.1 } : null;
          } else {
            const u = unionRect(delta.cards.map(el => delta.rects.get(el)));
            const room = Math.max(0, ...stayed.map(el => Math.abs(fromOf(el))));
            boardRect = u ? { left: u.left - room, right: u.right + room, top: u.top - (u.bottom - u.top) * 0.2, bottom: u.bottom } : null;
          }
        }
        const plan = planWagers(boardRect);
        /* ...then the board makes room (or the flop is placed), then the new card lands. A chip
           whose straight path crosses the board is let through first (planSweep sends those first),
           as a dealer collects before he deals: the board waits until it has cleared the board's
           far edge, but never more than boardWaitMax; past that the chip flies over it, lifted. */
        const cleared = plan ? Math.max(0, ...plan.filter(p => p.crosses).map(p => p.clear)) : 0;
        const tBoard = (base) => (plan ? Math.min(Math.max(base, cleared), Math.max(base, S.boardWaitMax / rate)) : 0);
        // What the last street press decided, for a measuring harness.
        motion.lastStreet = { board: boardRect, cleared, crossing: plan ? plan.filter(p => p.crosses).length : 0, ghosts: plan ? plan.length : 0 };
        writes.push(() => {
          sweep(plan);
          if (!boardOn || !added.length) return;
          const rectOf = (el) => delta.rects.get(el);
          // late: how far the moment's clock has run when the board's springs are made.
          const startBoard = (late) => {
            /* 14: one press ran the board out: each street placed in turn, the row making room as it goes. */
            const jump = stepPrev ? streetIdx - stepPrev.s : 1;
            if (jump > 1) {
              const sizes = [];
              for (let si = stepPrev.s + 1; si <= streetIdx; si++) sizes.push(parseCardNotation(hand.streets[si]?.cards.board || '').length);
              const times = runOutTimes(set, sizes);
              const groups = [];
              let k = 0;
              sizes.forEach((n, gi) => { groups.push({ cards: added.slice(k, k + n).map(el => ({ el, rect: rectOf(el) })), t: Math.max(0, times[gi] - late * rate) }); k += n; });
              const r0 = rectOf(delta.cards[0]), r1 = delta.cards[1] ? rectOf(delta.cards[1]) : null;
              runOutBoard(motion, {
                set, rate, pitch: r1 ? r1.left - r0.left : r0.width,
                stayed: stayed.map(el => ({ el, rect: rectOf(el), from: fromOf(el) })),
                groups: groups.filter(g => g.cards.length),
              });
              motion.lastStreet.runOut = times;
              return;
            }
            if (!stayed.length) {
              dealBoard(motion, { set, rate, cards: added.map(el => ({ el, rect: rectOf(el) })), tPlace: Math.max(0, tBoard(S.place / rate) - late) });
            } else {
              const t0 = yieldBoard(motion, {
                set, rate, street: delta.cards.length >= 5 ? 'river' : 'turn',
                tYield: Math.max(0, tBoard(S.yieldAfterSweep / rate) - late),
                added: added.map(el => ({ el, rect: rectOf(el) })),
                stayed: stayed.map(el => ({ el, rect: rectOf(el), from: fromOf(el) })),
              });
              motion.lastStreet.yieldAt = t0 + late;
            }
          };
          /* The board starts moving 25-90ms after the press (after the sweep's crossing chips), so its
             springs are made in the frame after the press, not in it. Until then the board is held as
             it was seen, in two writes to its own style: a new card unseen, a card that stayed where
             it was (its slot's shift back). Not when a card is still moving (a fast tap over a running
             spread): that takes it over from where it is, with its velocity, in the press. */
          const moving = delta.cards.some(el => motion.state(el));
          if (moving || motion.capture) { startBoard(0); return; }
          const held = [];
          const hold = (el, prop, v) => { held.push([el, prop, el.style[prop]]); el.style[prop] = v; };
          added.forEach(el => hold(el, 'opacity', '0'));
          stayed.forEach(el => { const f = fromOf(el); if (Math.abs(f) >= 0.5) hold(el, 'transform', 'translate(' + f.toFixed(2) + 'px, 0px)'); });
          motion.defer(startBoard, { release: () => held.forEach(([el, prop, v]) => { el.style[prop] = v; }) });
        });
      }

      // 30: a fold sends its seat's wager into the pot at once, as the street's sweep would.
      if (motionKind === 'action' && foldSweep && foldSweep.amount > 0) {
        const plan = planWagers(null, [foldSweep]);
        if (plan) writes.push(() => sweep(plan));
      }

      if (motionKind === 'action' && rSettings.animateChips) {
        // (3a) The push-out: where the chips came from.
        const act = currentActions[actionIdx];
        // 29: the bring-in (and a completion, a posted blind or straddle recorded as an action) pushes out too.
        const w = act && act.amount && ['bet', 'raise', 'call', 'all-in', 'bring-in', 'complete', 'post', 'straddle'].includes(act.action)
          ? nowWagers.get(act.player) : null;
        if (w) {
          const el = w.el;
          const addOn = !!prevWagers.get(act.player) && prevWagers.get(act.player).el === el;
          const pos = seats[act.player] || [50, 50];
          const T = table.getBoundingClientRect();
          const dx = (pos[0] - parseFloat(el.style.left)) / 100 * T.width;
          const dy = (pos[1] - parseFloat(el.style.top)) / 100 * T.height;
          const len = Math.hypot(dx, dy);
          if (len > 0.5) {
            const dir = { x: dx / len, y: dy / len };
            const want = (addOn ? S.addOn : S.push) * cardW;
            // That seat's own cards (each card, not the row's box, which runs past the fan) and its
            // action badge: the push's start must clear them.
            const seatEl = table.querySelector('.replayer-seat[data-seat="' + act.player + '"]');
            const obstacles = seatEl
              ? [...seatEl.querySelectorAll('.replayer-seat-cards .card-row > *, .replayer-action-badge-outer')]
                .map(o => o.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0)
              : [];
            const g = w.geo;
            const box = { left: g.cx - g.w / 2, right: g.cx + g.w / 2, top: g.cy - g.h / 2, bottom: g.cy + g.h / 2 };
            /* Every bet comes from its player (owner, 2026-11-21: "After the flop, bets are originating from the center
               of the table instead of the seat box … They should always come from the player"): the push starts where
               the line from the wager to its seat meets the seat's plaque. It was a fixed 0.4-0.55 of a card's width,
               about 10px, so a new wager appeared beside where it rests; only a call's added chips came from the plaque. */
            const plaqueRect = seatEl && seatEl.querySelector('.replayer-seat-info') ? seatEl.querySelector('.replayer-seat-info').getBoundingClientRect() : null;
            const toPlaque = plaqueRect ? rayToRect(g.cx, g.cy, dir, plaqueRect) : null;
            const pushPx = toPlaque != null && toPlaque > 0 ? toPlaque : clearPush(box, dir, want, obstacles);
            const S3 = SPRING_SETS[set].stage;
            const tn = [...el.childNodes].find(n => n.nodeType === 3);
            const before = computePlayerContrib(hand, streetIdx, currentActions, actionIdx - 1, act.player);
            if (addOn && tn && layer && L) {
              /* 32: the wager stays where it is and only the added chips come: a chip from the plaque's edge lands
                 on top of its stack, and the figure takes the new amount as it lands. */
              const info = seatEl && seatEl.querySelector('.replayer-seat-info');
              const pr = info ? info.getBoundingClientRect() : null;
              const tx = g.cx + g.chip.dx, ty = g.cy + g.chip.dy - g.chip.h / 2;
              // From under the plaque's middle, out from behind the seat (seatCoverOf); it left from the plaque's edge.
              const fx = pr ? pr.left + pr.width / 2 : g.cx + dir.x * pushPx, fy = pr ? pr.top + pr.height / 2 : g.cy + dir.y * pushPx;
              const probe = table.querySelector('.replayer-chip-probe.is-disc');
              const chipD = probe ? probe.getBoundingClientRect().width || 12 : 12;
              const flickSp3 = tierSpring(set, 'flick');
              const land = timeTo(flickSp3, 0.98) / rate;
              const newText = tn.data;
              const path = [
                { prop: 'x', spring: flickSp3, from: 0, to: tx - fx, timeScale: rate },
                { prop: 'y', spring: flickSp3, from: 0, to: ty - fy, timeScale: rate },
              ];
              // As an ante's chip (the opening): a copy under the seats until it is clear of the plaque and the cards.
              const cv = coverOf(act.player);
              const em = pr && foldLayerRef.current
                ? emergeTimes(path, { left: fx - chipD / 2, right: fx + chipD / 2, top: fy - chipD / 2, bottom: fy + chipD / 2 }, cv.cover, { also: cv.also, end: land })
                : null;
              const clear = em && em.clear != null && em.clear > 0 ? em.clear : null;
              const inEnd = Math.max(S3.appear / rate, clear != null && em.peek > 0 ? em.peek : 0);   // over `appear` at least
              const handBack = 2 * 1000 / 60;
              const outMs = S3.arrivalFade / rate;
              const shown = (t) => (t < inEnd ? t / inEnd : t <= land ? 1 : Math.max(0, 1 - (t - land) / outMs));
              writes.push(() => {
                tn.data = fmtChips(before);
                const chip = document.createElement('div');
                chip.className = 'replayer-flying-chip is-spring is-disc';
                chip.setAttribute('aria-hidden', 'true');
                const face = document.createElement('div');
                face.className = 'replayer-pot-chip-disc';
                if (w.topColor) face.style.setProperty('--chip', w.topColor);
                applyChipInserts(face, pipShift(before + act.player * 977, actionIdx), w.topColor);
                chip.appendChild(face);
                Object.assign(chip.style, { left: (fx - L.left) + 'px', top: (fy - L.top) + 'px', transform: 'translate(-50%, -50%)', opacity: clear != null ? '0' : '' });
                layer.appendChild(chip);
                const entry = motion.run(chip, { transient: true, prefix: 'translate(-50%, -50%)', size: { w: chipD, h: chipD }, end: land + outMs, channels: [
                  ...path,
                  clear != null
                    ? { prop: 'opacity', fn: (t) => (t < clear ? 0 : shown(t)), start: 0, end: land + outMs }
                    : { prop: 'opacity', ramp: { from: 1, to: 0, delay: land, duration: outMs } },
                ] });
                if (clear != null) {
                  const fl = foldLayerRef.current, FL = fl.getBoundingClientRect();
                  const under = chip.cloneNode(true);
                  Object.assign(under.style, { left: (fx - FL.left) + 'px', top: (fy - FL.top) + 'px', opacity: '0' });
                  fl.appendChild(under);
                  motion.run(under, { transient: true, prefix: 'translate(-50%, -50%)', size: { w: chipD, h: chipD }, end: clear + handBack, channels: [
                    ...path,
                    { prop: 'opacity', fn: (t) => (t < clear + handBack ? shown(t) : 0), start: 0, end: clear + handBack },
                  ] });
                }
                const onLand = () => {
                  tn.data = newText;
                  motion.wroteDigits = true;
                  motion.run(el, { key: { el, kind: 'squash' }, property: 'individual', size: { w: g.w, h: g.h }, channels: [
                    { prop: 'scaleX', spring: flickSp3, from: S3.squash[0], to: 1, timeScale: rate },
                    { prop: 'scaleY', spring: flickSp3, from: S3.squash[1], to: 1, timeScale: rate },
                  ] });
                };
                if (entry) motion.tick(land, onLand, entry); else onLand();
              });
            } else {
              /* A new wager comes out from under its seat: it starts on the plaque's middle under the seat's level
                 (data-under) and is put back over the felt's pieces once it is clear of the plaque and the cards. */
              const cv = coverOf(act.player);
              const under = !addOn && plaqueRect
                ? { from: { x: plaqueRect.left + plaqueRect.width / 2 - g.cx, y: plaqueRect.top + plaqueRect.height / 2 - g.cy }, box, cover: cv.cover, also: cv.also }
                : {};
              writes.push(() => underSeat(el, pushOut(motion, { set, rate, el, dir, pushPx, addOn, size: { w: g.w, h: g.h }, ...under })));
            }
            /* 36: a pot-limit bet or raise of the most the pot allows takes its figure from the pot: a copy of the
               pot's figure travels to the wager, which shows its own figure as the copy lands. */
            const potEl = potTotalRef.current;
            if (gameCfg.betting === 'pl' && (act.action === 'bet' || act.action === 'raise') && potEl && tn && layer && L) {
              const potBefore = calcPotBeforeAction(hand, streetIdx, actionIdx);
              const most = hand.players.reduce((m, _, q) => Math.max(m, computePlayerContrib(hand, streetIdx, currentActions, actionIdx - 1, q)), 0);
              const call = Math.max(0, most - before);
              const maxInc = potBefore + 2 * call;
              if (Math.abs((act.amount || 0) - maxInc) <= Math.max(0.5, maxInc * 0.002)) {
                const pr = potEl.getBoundingClientRect();
                const cs = getComputedStyle(potEl);
                const handSp3 = tierSpring(set, 'hand');
                const land = timeTo(handSp3, 0.98) / rate;
                const pillScale = (parseFloat(getComputedStyle(el).fontSize) || 10) / (parseFloat(cs.fontSize) || 10);
                writes.push(() => {
                  const copy = document.createElement('span');
                  copy.className = 'replayer-pot-copy';
                  copy.textContent = fmtChips(act.amount);
                  Object.assign(copy.style, { left: (pr.left + pr.width / 2 - L.left) + 'px', top: (pr.top + pr.height / 2 - L.top) + 'px', font: cs.font, color: cs.color });
                  layer.appendChild(copy);
                  el.style.color = 'transparent';
                  const entry = motion.run(copy, { transient: true, prefix: 'translate(-50%, -50%)', size: { w: pr.width, h: pr.height }, end: land + S3.arrivalFade / rate, channels: [
                    { prop: 'x', spring: handSp3, from: 0, to: g.cx - (pr.left + pr.width / 2), timeScale: rate },
                    { prop: 'y', spring: handSp3, from: 0, to: g.cy - (pr.top + pr.height / 2), timeScale: rate },
                    { prop: 'scale', spring: handSp3, from: 1, to: pillScale, timeScale: rate },
                    { prop: 'opacity', ramp: { from: 1, to: 0, delay: land, duration: S3.arrivalFade / rate } },
                  ] });
                  const show = () => { el.style.color = ''; };
                  if (entry) motion.tick(land, show, entry); else show();
                });
              }
            }
          }
        }
      }

      if (motionKind === 'result') {
        /* (4) Collect, then push. The river's wagers go into the pot first (the sweep, as on a street
           press); once they have landed, the pot leaves the pile for each winner and lands on the
           edge of the winner's plaque nearest it (seatLanding), never across the name, never on the
           button; the pile empties as it goes, and the winner's stack counts it up as it lands
           (no won pill is pushed in front of the seat as well: see the bet chips' render). */
        const plan = planWagers(null);
        const ship = shipPlan && shipPlan.length && sweepLayer ? (() => {
          /* Two unseen probes: the pile's chip (what flies) and the coin the pot used to ship as. On a
             big table the pile's chip is the larger (24px at 1440, 14 the coin), and a landing chosen
             for it found no room between the hero's button and cards, or took the far end of the
             plaque with the chips passing under the cards: it lands at the coin's size or its own,
             whichever is smaller, set down on the way (shipPot's landD). */
          const probe = table.querySelector('.replayer-chip-probe.is-disc');
          const coin = table.querySelector('.replayer-chip-probe:not(.is-disc)');
          const chipD = probe ? probe.getBoundingClientRect().width || 12 : 12;
          const coinD = coin ? coin.getBoundingClientRect().width || chipD : chipD;
          const landD = Math.min(chipD, coinD);
          const button = table.querySelector('.replayer-dealer-btn');
          const buttonRect = button ? button.getBoundingClientRect() : null;
          const btn = buttonRect && buttonRect.width ? buttonRect : null;
          const plaques = [], cardBoxes = [];
          const seatsRead = shipPlan.map(d => {
            const seatEl = table.querySelector('.replayer-seat[data-seat="' + d.seat + '"]');
            const info = seatEl && seatEl.querySelector('.replayer-seat-info');
            if (!info) return null;
            const plaque = info.getBoundingClientRect();
            const cards = [...seatEl.querySelectorAll('.replayer-seat-cards .card-row > *')].map(c => c.getBoundingClientRect()).filter(r => r.width > 0);
            const handNameEl = seatEl.querySelector('.replayer-seat-hand-name:not([data-ghost])');
            const handName = handNameEl ? handNameEl.getBoundingClientRect() : null;
            const nameEl = seatEl.querySelector('.replayer-seat-name');
            let name = null;
            if (nameEl) { const rg = document.createRange(); rg.selectNodeContents(nameEl); name = rg.getBoundingClientRect(); }
            plaques.push(plaque);
            if (handName && handName.width) plaques.push(handName);
            const cardsBox = unionRect(cards);
            if (cardsBox) cardBoxes.push(cardsBox);
            return { d, plaque, cards, cardsBox, handName: handName && handName.width ? handName : null, name: name && name.width ? name : null };
          }).filter(Boolean);
          if (!seatsRead.length) return null;
          /* Where the chips leave from: the pile's own chips as the pile will be once the river has
             landed, each where it sits in its stack (the row is bottom-aligned; a chip above another
             shows one edge's depth of it), with its colour and edge pattern, so the pot leaves as
             itself. Measured off a chip the pile draws now; with no pile, the pot's chips from its
             figure. */
          const finalStacks = potStacksFor(displayPot);
          const pitch = tracksPile ? pitchOf() : 0;
          const discEls = tracksPile ? pileKids.map(k => [...k.children]).filter(c => c.length) : [];
          const d0 = discEls.length ? discEls[0][0].getBoundingClientRect() : null;
          const two = discEls.find(c => c.length > 1);
          const edge = two ? two[1].getBoundingClientRect().top - two[0].getBoundingClientRect().top : d0 ? d0.height * (0.236 / 0.96) : 0;
          const discs = [];
          finalStacks.forEach((stk, j) => {
            const c = Math.min(stk.count, 6);
            for (let q = 0; q < c; q++) {
              discs.push({
                x: pitch > 0 ? (j - (finalStacks.length - 1) / 2) * pitch : 0,
                y: d0 ? (pileRect.bottom - d0.height / 2 - (c - 1 - q) * edge) - pileCentre.y : 0,
                color: stk.color, pip: pipShift(shownPot + j * 977, q), z: c - q,
              });
            }
          });
          // Where each winner's pot lands: pure arithmetic on what was just read, so it can wait.
          const landings = () => seatsRead.map(s => ({
            seat: s.d.seat, award: s.d.award,
            ...seatLanding(pileCentre, s.plaque, {
              cards: s.cards, button: btn, name: s.name, chipD: landD,
              covers: [s.cardsBox, btn, s.handName].filter(Boolean),
            }),
          }));
          return { seatsRead, landings, discs, chipD, landD, holes: [plaques, cardBoxes, btn ? [btn] : []], layerRect: L };
        })() : null;
        const tShip = ship ? shipStartAfterSweep(set, rate, plan ? plan.length : 0) + uncalledDelay : 0;
        motion.lastResult = null;
        /* The ship in waves (Replayer animations 40-45): pot by pot, the last formed first; in a pot of two
           halves the high, then the low (a scoop's two halves a beat apart, to the one seat); the odd chips of a
           split last, one at a time. Two beats between waves. One wave, as before, when there is one pot, one
           half and nothing odd. */
        const armArrive = timeTo(tierSpring(set, 'arm'), 0.98);
        const waves = (() => {
          const parts = (potAwards && potAwards.parts) || [];
          if (!ship || !parts.length) return null;
          const layers = [...new Set(parts.map(p => p.layer))].sort((a, b) => a - b);
          const out = [];
          parts.forEach(p => {
            const rank = layers.length - 1 - layers.indexOf(p.layer);
            const scoop = p.half === 'lo' && parts.some(q => q.layer === p.layer && q.half === 'hi' && q.seat === p.seat);
            const slot = p.half === 'lo' ? (scoop ? 0.5 : 1) : 0;
            const delay = (rank * 2 + slot) * 2 * S.beat / rate;
            const odd = p.n >= 2 ? Math.max(0, p.amount - p.base) : 0;
            if (p.amount - odd > 0) out.push({ seat: p.seat, award: p.amount - odd, delay });
            if (odd > 0) out.push({ seat: p.seat, award: odd, delay, odd: true });
          });
          const shares = out.filter(d => !d.odd);
          const last = shares.length ? Math.max(...shares.map(d => d.delay)) : 0;
          const order0 = dealOrder;
          out.filter(d => d.odd).sort((a, b) => order0.indexOf(a.seat) - order0.indexOf(b.seat)).forEach((d, i) => {
            d.delay = last + (armArrive + (i + 1) * S.beat) / rate;
            d.per = 1;
          });
          return out.length > 1 || (out[0] && out[0].delay) ? out : null;
        })();
        motion.shipWaveEnd = waves ? Math.max(...waves.map(w => w.delay)) : 0;
        writes.push(() => {
          sweep(plan);
          if (!ship) return;
          ship.seatsRead.forEach(s => motion.pendingStacks.set(s.d.seat, (motion.pendingStacks.get(s.d.seat) || 0) + s.d.award));
          motion.pileHeld = true;
          /* The pot's figure and its pile are hidden by .is-emptied from this commit, and the ship that counts the figure
             down and fades it is built a frame or two later: in between the pot was gone, then back at full, then faded,
             about 300ms of blink at every result (owner, 2026-11-21: "Every single animation should be ultra smooth").
             It is held at full from the press; the ship's own fade takes over under the same key. Should the ship never
             be built (a step taken first), the hold still ends in a fade. */
          {
            const tn0 = !potLayers.length ? potTextNode() : null;
            const box0 = tn0 && tn0.parentElement && tn0.parentElement.closest('.replayer-pot-display.is-emptied');
            // Its own key, kept: the registry knows a motion by the key object itself, so the ship stops this one by it.
            const holdKey = { el: box0, kind: 'empty' };
            motion.potHoldKey = box0 ? holdKey : null;
            if (box0) motion.run(box0, { key: holdKey, property: 'individual', size: { w: box0.offsetWidth, h: box0.offsetHeight }, channels: [
              { prop: 'opacity', ramp: { from: 1, to: 0, delay: tShip + 4000 / rate, duration: 2 * S.beat / rate } },
            ] });
          }
          /* The ship itself is built after the press when it leaves later than that (after the
             river's wagers have landed), in two frames: where it lands, then the chips. The press
             frame is the one an old phone can least afford, and it carries the sweep already; built
             in one task after it, the ship was a 40-50ms frame at a 4x CPU throttle. Its clock is
             kept: it leaves tShip after the press whenever it is built. Under an export it is built at
             once (the export seeks from the press). A step taken before it is built finishes the
             moment (a jump, a step back) and the ship is never built: the work is the moment's
             generation's (motion.defer), so Back then Forward inside the wait, which comes back to
             the same step with the same step key, cannot build it twice (it shipped ten chips). */
          if (motion.capture || tShip < 50) { launch(tShip, ship.landings()); return; }
          motion.defer(() => {
            const dests = ship.landings();
            // The frame after (frames: 0, asked from inside a frame), on the sweep's clock: its
            // ghosts started with the press frame.
            motion.defer((late) => launch(Math.max(0, tShip - late), dests), { frames: 0 });
          });
        });
        const launch = (tStart, landed0) => {
          const dests = waves ? waves.map(w => ({ ...(landed0.find(d => d.seat === w.seat) || landed0[0]), seat: w.seat, award: w.award, delay: w.delay, per: w.per })) : landed0;
          const totalOf = new Map();
          landed0.forEach(d => totalOf.set(d.seat, d.award));
          const landedBy = new Map();
          motion.lastResult = { tShip: tStart, dests: dests.map(d => ({ seat: d.seat, x: d.x, y: d.y, edge: d.edge, contact: d.contact })) };
          /* 48: the pot's figure counts down to nothing as the pot travels (each wave on its own arm), then goes. */
          const potTn = !potLayers.length ? potTextNode() : null;
          const potBox = potTn && potTn.parentElement && potTn.parentElement.closest('.replayer-pot-display');
          if (potTn && potBox && potBox.classList.contains('is-emptied')) {
            const armSp = tierSpring(set, 'arm');
            const total = dests.reduce((n, d) => n + d.award, 0);
            const endAt = Math.max(...dests.map(d => (d.delay || 0))) + armArrive / rate;
            const b0 = hand.blinds || {};
            const unit0 = hand.gameMode === 'cash' ? 0.01 : Math.max(1, Math.min(...[b0.sb, b0.ante, b0.bringIn, b0.bb].map(Number).filter(v => v > 0).concat([1e9])));
            motion.sample((t) => {
              const into = t - tStart;
              let left = total;
              dests.forEach(d => { const u = into - (d.delay || 0); if (u > 0) left -= d.award * Math.min(1, armSp.at(u * rate)); });
              potTn.data = fmtChips(into >= endAt ? 0 : Math.max(0, Math.round(left / unit0) * unit0));
              motion.wroteDigits = true;
            }, { end: tStart + endAt });
            if (motion.potHoldKey) { motion.stop(motion.potHoldKey); motion.potHoldKey = null; }
            motion.run(potBox, { key: { el: potBox, kind: 'empty' }, property: 'individual', size: { w: potBox.offsetWidth, h: potBox.offsetHeight }, channels: [
              { prop: 'opacity', ramp: { from: 1, to: 0, delay: tStart + endAt, duration: 2 * S.beat / rate, ease: (p) => p * p * (3 - 2 * p) } },
            ] });
          }
          shipPot(motion, {
            set, rate, layer: sweepLayer, layerRect: ship.layerRect, origin: pileCentre,
            discs: ship.discs, dests, holes: ship.holes, chipD: ship.chipD, landD: ship.landD, cardW, tStart,
            onDepart: () => {
              motion.pileHeld = false;
              if (motion.setPile && !potLayers.length) motion.setPile(potShown(displayPot, motion.pendingPot, motion.pendingPot > 0 ? motion.potFloor : 0), { shipped: true });
            },
            onArrive: (seat, k, n, di) => {
              /* The chips land within about 30ms of each other, a handful: the stack counts what has
                 landed at the first, the third and the last landing (each landing would be five
                 changes of digits in two frames), and the last lands the exact figure. A seat paid
                 in several waves counts each wave's share as it lands. */
              const d = dests[di != null ? di : dests.findIndex(x => x.seat === seat)];
              if (!d) return;
              landedBy.set(di, k === n - 1 ? d.award : d.award * (k + 1) / n);
              if (k !== n - 1 && k % 2) return;
              let got = 0;
              dests.forEach((x, j) => { if (x.seat === seat) got += landedBy.get(j) || 0; });
              const total = totalOf.get(seat) || d.award;
              motion.pendingStacks.set(seat, Math.max(0, total - Math.round(got * 100) / 100));
              if (motion.writeStack) motion.writeStack(seat);
            },
          });
        };
      }

      /* (5) The cards (Replayer animations, 2026-11-11). Read here, written with the rest. */
      {
        const T = table.getBoundingClientRect();
        const ptOf = (pct) => ({ x: T.left + pct[0] / 100 * T.width, y: T.top + pct[1] / 100 * T.height });
        const CT = cardTimes(set);
        let rPxV = 0;
        const rPx = () => {
          if (rPxV) return rPxV;
          if (motion.rPx && motion.rPxFor === table.clientWidth) return (rPxV = motion.rPx);
          const pr = document.createElement('div');
          pr.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
          table.appendChild(pr);
          rPxV = pr.getBoundingClientRect().height / 100 || 8;
          table.removeChild(pr);
          motion.rPx = rPxV; motion.rPxFor = table.clientWidth;
          return rPxV;
        };
        const rowEls = (pi) => [...table.querySelectorAll('[data-seat-cards="' + pi + '"] > .card-row > *')];
        const sizeOf = (el) => ({ w: el.offsetWidth || 30, h: el.offsetHeight || 42 });
        const act = motionKind === 'action' ? currentActions[actionIdx] : null;
        const prevCards = motion.prevSeatCards || new Map();
        const prevEls = motion.prevCardEls || new Set();
        const backPaint = motion.backPaint || null;
        /* Where a folded hand can go (foldAway, utils/replayer-card-moments.js), in the fold layer's px: the felt's middle
           (Spin in), the dealer's muck beside the deck, just past the seat's betting line (the wager's spot, as the bets'
           own placement works it out, and a fifth of the way on toward the pot), the seat's plaque, and the pot's graphic
           (its chips and figure, which a flicked hand slides under). */
        const foldPoints = (pi, R0) => {
          const at = (pct) => { const p = ptOf(pct); return { x: p.x - R0.left, y: p.y - R0.top }; };
          const sp = seats[pi] || [50, 50];
          const side = Math.abs(sp[0] - 50) > 25 && Math.abs(sp[1] - 50) <= (isLandscape ? 12.5 : 25);
          const wx = sp[0] + (50 - sp[0]) * (side && !isLandscape ? 0.6 : 0.42);
          const wy = side ? sp[1] : sp[1] + (40 - sp[1]) * (isLandscape ? 0.42 : sp[1] > 40 ? 0.26 : 0.3);
          const plaque = table.querySelector('.replayer-seat[data-seat="' + pi + '"] .replayer-seat-info');
          const PQ = plaque ? plaque.getBoundingClientRect() : null;
          const potEl = table.querySelector('.replayer-pot-display') || table.querySelector('.replayer-pot-chips');
          const PT = potEl ? potEl.getBoundingClientRect() : null;
          return {
            middle: at([50, 54]), muck: at(muckTarget),
            pot: PT && PT.width ? { x: PT.left + PT.width / 2 - R0.left, y: PT.top + PT.height / 2 - R0.top } : at([50, 40]),
            line: at([wx + (50 - wx) * 0.2, side ? wy : wy + (40 - wy) * 0.2]),
            seat: PQ ? { x: PQ.left + PQ.width / 2 - R0.left, y: PQ.top + PQ.height / 2 - R0.top } : null,
          };
        };
        const foldSeed = (pi) => (hand.id || '') + ':' + streetIdx + ':' + actionIdx + ':' + pi;

        /* 25: a folded hand gathers and goes (owner, 2026-11-21: "When splayed, they should just slide together around the
           arc into a single stack, then that whole stack should spin into the middle. Same with non-splayed, but they
           should just slide laterally"): foldToStack in utils/replayer-card-moments.js. */
        // The seat's own cards stay in the page, hidden at once by .fold-sprung; the ghosts are the motion.
        if (act && act.action === 'fold' && L && rSettings.animateFold && !gameCfg.isStud) {
          const was = (prevCards.get(act.player) || []).filter(c => c.node);
          if (was.length) {
            // At 3/4 of the replay's pace (owner, 2026-11-21: "Let's go 3/4 speed").
            /* Under the seats (owner, 2026-11-22: "When the cards slide together before mucking that should happen behind
               the seat box and they should always be below it in the z dimension"): in the flight layer they gathered
               over the plaque. The motion is the Fold Motion setting's (owner, 2026-11-27; Spin in, the default, is 25). */
            const fl = foldLayer && FL ? foldLayer : layer, FLr = foldLayer && FL ? FL : L;
            const pts = foldPoints(act.player, FLr);
            // Under Random, one of the six for this fold, fixed by it (so Back and an export play it the same).
            const style = foldStyleOf(rSettings.foldStyle, foldSeed(act.player));
            writes.push(() => foldAway(motion, { style, set, rate: rate * 0.75, layer: fl, layerRect: FLr, cards: was, back: backPaint, ...pts, seed: foldSeed(act.player) }));
          }
        }

        /* 7: a stud fold: the up cards travel to their places in the Dead cards strip (whose cards make room), the
           down cards leave toward the muck. The hero's too: its cards stay in the page, hidden at once by .fold-sprung,
           and with neither moment taking them they vanished in a frame, seven cards at razz (owner, 2026-11-21: "Every
           single animation should be ultra smooth"). */
        if (act && act.action === 'fold' && gameCfg.isStud && rSettings.animateDeal && (!rowEls(act.player).length || act.player === replayHeroIdx)) {
          const was = (prevCards.get(act.player) || []).filter(c => c.node);
          const root = table.closest('.replayer-replay') || table.parentElement;
          const strip = root && root.querySelector('.replayer-dead-strip-cards, .replayer-dead-row');
          if (was.length) {
            const prevDead = motion.prevDead || new Map();
            const stripEls = strip ? [...strip.children].filter(el => el.tagName === 'IMG') : [];
            const byAlt = new Map(stripEls.map(el => [el.getAttribute('alt'), el]));
            const altOf = (c) => (c.node.getAttribute && c.node.getAttribute('alt')) || '';
            const up = was.filter(c => !c.back && byAlt.has(altOf(c)) && !prevDead.has(altOf(c)));
            const down = was.filter(c => !up.includes(c));
            const flights = up.map(c => {
              const t = byAlt.get(altOf(c));
              const r = t.getBoundingClientRect();
              // The strip's own opacity: the ghost dims to it on the way and hands over in one frame (no flicker).
              const op = parseFloat(getComputedStyle(t).opacity);
              return { ...c, target: t, size: { w: r.width, h: r.height }, to: { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, opacity: op >= 0 ? op : 1 } };
            });
            const moves = stripEls.filter(el => prevDead.has(el.getAttribute('alt'))).map(el => {
              const r = el.getBoundingClientRect();
              return { el, dx: prevDead.get(el.getAttribute('alt')) - (r.left + r.width / 2), size: { w: r.width, h: r.height } };
            });
            /* The cards left (the down ones) gather into one stack and shrink to nothing behind the seat's plaque (owner,
               2026-11-22: "in stud hands folded hands should become a single stack and just shrink to nothing behind
               the seat box. dead card should still smoothly move to the corner"): foldToStack's gather, then the stack
               goes to the plaque's centre, under it in the fold layer, shrinking and fading, without turning. They
               drifted toward the muck and faded before. */
            const plaque = table.querySelector('.replayer-seat[data-seat="' + act.player + '"] .replayer-seat-info');
            const PQ = plaque ? plaque.getBoundingClientRect() : null;
            const fl = foldLayer && FL ? foldLayer : layer, FLr = foldLayer && FL ? FL : L;
            /* Stud flip under is stud's default (owner, 2026-11-28: "Make Stud flip under the default for stud"): Random,
               the setting's default, plays it here. The 2026-11-22 stud fold above (the down cards behind the seat, the up
               cards to the strip) is Behind the seat, and Off; any other Fold Motion as chosen, on the down cards. */
            const downStyle = foldStyleOf(rSettings.foldStyle, foldSeed(act.player), { stud: true });
            const downPts = FLr ? foldPoints(act.player, FLr) : null;
            /* Stud flip under (owner, 2026-11-27): the up cards turn face down and go under the down ones, behind the seat,
               instead of flying to the strip. The strip's copies turn face UP on the same turn, at the same moment (owner,
               2026-11-28: "they should flip open in the dead card section at the same time they flip down in the hand"):
               shown as backs, faded in over the two beats before it, then turned over with the hand's own rate. */
            const flipUnder = downStyle === 'flipunder' && up.length && down.length && fl && FLr && downPts && downPts.seat;
            writes.push(() => {
              if (flipUnder) {
                const { flipAt } = studFlipUnder(motion, { set, rate: rate * 0.75, layer: fl, layerRect: FLr, up, down, seat: downPts.seat, back: backPaint });
                const fadeMs = 2 * cardTimes(set).beat / rate;
                flights.forEach(f => {
                  appearAt(motion, { set, rate, el: f.target, at: Math.max(0, flipAt - fadeMs), size: f.size, duration: fadeMs });
                  turnOver(motion, { set, rate: rate * 0.75, el: f.target, delay: flipAt, size: f.size, back: backPaint });
                });
                moves.forEach(mv => makeRoom(motion, { set, rate, el: mv.el, dx: mv.dx, size: mv.size }));
                return;
              }
              const lands = ghostsTo(motion, { set, rate, cards: flights });
              flights.forEach((f, i) => appearAt(motion, { set, rate, el: f.target, at: lands[i] || 0, size: f.size }));
              moves.forEach(mv => makeRoom(motion, { set, rate, el: mv.el, dx: mv.dx, size: mv.size }));
              if (down.length && fl && FLr && PQ) {
                foldAway(motion, { style: downStyle, set, rate: rate * 0.75, layer: fl, layerRect: FLr, cards: down,
                  back: backPaint, ...downPts, seed: foldSeed(act.player) });
              }
            });
          }
        }

        // 4: the door card that forced the bring-in lifts once.
        if (CARD_LIFTS && act && act.action === 'bring-in' && gameCfg.isStud) {
          const door = rowEls(act.player)[2];
          if (door) {
            const size = sizeOf(door), dy = -rPx();
            writes.push(() => liftOnce(motion, { set, rate, el: door, dy, size }));
          }
        }

        // 19 / 15: hands turned face up, card by card, a seat at a time: at the showdown in the order the hands
        // are shown (the last bettor first, else the first to act), when all in and called in deal order.
        let turnEnd = 0;
        {
          const acts = (hand.streets[streetIdx] && hand.streets[streetIdx].actions) || [];
          const seq = [];
          acts.forEach(a => { if (!seq.includes(a.player)) seq.push(a.player); });
          dealOrder.forEach(p => { if (!seq.includes(p)) seq.push(p); });
          let lead = -1;
          for (let i = acts.length - 1; i >= 0; i--) if (['bet', 'raise', 'all-in'].includes(acts[i].action)) { lead = acts[i].player; break; }
          const k0 = lead >= 0 && seq.indexOf(lead) >= 0 ? seq.indexOf(lead) : 0;
          const order = motionKind === 'result' ? seq.slice(k0).concat(seq.slice(0, k0)) : dealOrder;
          const turning = [];
          order.forEach(pi => {
            if (pi === replayHeroIdx) return;
            const before = prevCards.get(pi) || [];
            const backsBefore = before.filter(c => c.back).length;
            const els = rowEls(pi);
            const backsNow = els.filter(el => el.tagName !== 'IMG').length;
            if (!backsBefore || backsNow >= backsBefore) return;
            const faces = els.filter(el => el.tagName === 'IMG' && !prevEls.has(el));
            if (faces.length) turning.push(faces);
          });
          if (turning.length && rSettings.animateDeal) {
            const seatStep = turning.length > 1 ? Math.min(S.beat, 560 / (turning.length - 1)) : 0;
            const lift = CARD_LIFTS ? 0.5 * rPx() : 0;
            const jobs = [];
            turning.forEach((faces, k) => faces.forEach((el, j) => {
              const delay = (k * seatStep + j * S.cardLag) / rate;
              jobs.push({ el, delay, prefix: getComputedStyle(el).transform, size: sizeOf(el) });
              turnEnd = Math.max(turnEnd, delay + CT.turn / rate);
            }));
            writes.push(() => jobs.forEach(j => {
              j.el.getAnimations().forEach(a => a.cancel());
              turnOver(motion, { set, rate, el: j.el, prefix: j.prefix === 'none' ? '' : j.prefix, delay: j.delay, lift, size: j.size, back: backPaint });
            }));
          }
        }

        // 5 / 6: a stud street's new cards travel from the dealer spot, seat by seat in deal order; on seventh
        // street they come as backs and the hero's own turns over a beat after it lands.
        if (motionKind === 'street' && gameCfg.isStud && streetIdx >= 1 && rSettings.animateDeal) {
          const spot = ptOf(dealerSpot);
          const seventh = streetIdx >= 4;
          const jobs = [];
          let k = 0;
          dealOrder.forEach(pi => {
            if (folded.has(pi)) return;
            const fresh = rowEls(pi).filter(el => !prevEls.has(el));
            if (!fresh.length) return;
            const el = fresh[fresh.length - 1];
            const r = el.getBoundingClientRect();
            const delay = (k++ * S.place) / rate;
            jobs.push({
              el, delay, dx: spot.x - (r.left + r.width / 2), dy: spot.y - (r.top + r.height / 2), size: sizeOf(el),
              turn: seventh && pi === replayHeroIdx && el.tagName === 'IMG' ? { prefix: getComputedStyle(el).transform } : null,
            });
          });
          if (jobs.length) {
            const lift = CARD_LIFTS ? 0.5 * rPx() : 0;
            writes.push(() => jobs.forEach(j => {
              j.el.getAnimations().forEach(a => a.cancel());
              dealIn(motion, { set, rate, el: j.el, dx: j.dx, dy: j.dy, delay: j.delay, size: j.size });
              if (j.turn) turnOver(motion, { set, rate, el: j.el, prefix: j.turn.prefix === 'none' ? '' : j.turn.prefix, delay: j.delay + (CT.armArrive + S.beat) / rate, lift, size: j.size, back: backPaint });
            }));
          }
        }

        /* 12 / 13: the boards under the first. A double board's second is dealt as the first is, a beat later; a
           hand run twice parts into its runs at the first run-out card, each run's own card landing a beat later. */
        if (motionKind === 'street' && rSettings.animateBoard) {
          const area = table.querySelector('.replayer-board-area:not(.replayer-dead-area)');
          const before = motion.prevBoard || { extraRows: 0, xk: new Map(), mainLen: 0, rowY: null };
          const extras = area ? [...area.querySelectorAll(':scope > .replayer-board-extra')] : [];
          if (extras.length) {
            const parting = !hand.doubleBoard && !before.extraRows && before.rowY != null;
            const jobs = [];
            if (parting && CARD_LIFTS) {
              const rows = [area.querySelector(':scope > .card-row:not(.replayer-board-extra)'), ...extras].filter(Boolean);
              rows.forEach(row => {
                const r = row.getBoundingClientRect();
                jobs.push({ kind: 'row', el: row, dy: before.rowY - (r.top + r.height / 2), size: { w: r.width, h: r.height } });
              });
            }
            extras.forEach((row, b) => {
              const cards = [...row.querySelectorAll(':scope > [data-xk]')];
              const rect = (el) => el.getBoundingClientRect();
              // A run's shared cards part with their row; only its own cards are dealt.
              const own = parting ? cards.slice(before.mainLen) : cards;
              const added = own.filter(el => !before.xk.has(el.dataset.xk)).map(el => ({ el, rect: rect(el) }));
              const stayed = parting ? [] : own.filter(el => before.xk.has(el.dataset.xk)).map(el => {
                const r = rect(el);
                return { el, rect: r, from: before.xk.get(el.dataset.xk) - (r.left + r.width / 2) };
              });
              if (!added.length) return;
              const lag = ((b + 1) * S.beat) / rate;
              jobs.push({ kind: (stayed.length || parting) ? 'yield' : 'deal', added, stayed, lag, street: cards.length >= 5 ? 'river' : 'turn' });
            });
            if (jobs.length) {
              writes.push(() => jobs.forEach(j => {
                if (j.kind === 'row') { slideRow(motion, { set, rate, el: j.el, dy: j.dy, size: j.size }); return; }
                if (j.kind === 'deal') { dealBoard(motion, { set, rate, cards: j.added, tPlace: S.place / rate + j.lag }); return; }
                yieldBoard(motion, { set, rate, street: j.street, tYield: S.yieldAfterSweep / rate + j.lag, added: j.added, stayed: j.stayed });
              }));
            }
          }
        }

        /* Super (utils/super-stud.js): the two down cards each player threw (dimmed as 3rd street's betting closed) go as
           4th street is dealt, copies fading where they lay, as a draw's thrown cards do. */
        if (hand.superStud && category === 'stud' && streetIdx === 1 && motionKind === 'street' && rSettings.animateDeal && layer && L) {
          const gone = [];
          prevCards.forEach(list => list.forEach(c => { if (c.node && !c.node.isConnected && c.o < 0.6) gone.push(c); }));
          if (gone.length) writes.push(() => cardsAway(motion, { rate, layer, layerRect: L, cards: gone, duration: 2 * S.beat }));
        }
        if (isDrawGame && rSettings.animateDeal) {
          // 11: a hand that stands pat is rapped once, toward the middle of the table, as its PAT is declared.
          const nActs = (hand.streets[streetIdx]?.actions || []).length;
          const declared = (motionKind === 'action' && actionIdx === nActs - 1) || (motionKind === 'street' && nActs === 0);
          if (declared && CARD_LIFTS) {
            const r = rPx();
            const jobs = [];
            (hand.streets[streetIdx]?.draws || []).filter(d => d && d.discarded === 0 && !folded.has(d.player)).forEach(d => {
              const row = table.querySelector('[data-seat-cards="' + d.player + '"] > .card-row');
              if (!row) return;
              const rr = row.getBoundingClientRect();
              const c = ptOf([50, 50]);
              const vx = c.x - (rr.left + rr.width / 2), vy = c.y - (rr.top + rr.height / 2);
              const len = Math.hypot(vx, vy) || 1;
              jobs.push({ el: row, dx: vx / len * r, dy: vy / len * r, size: { w: rr.width, h: rr.height } });
            });
            if (jobs.length) writes.push(() => jobs.forEach(j => rap(motion, { set, rate, el: j.el, dx: j.dx, dy: j.dy, size: j.size })));
          }
          /* The cards thrown at the draw (dimmed to 0.4 as the street's betting closed) go as the new ones come: copies
             fade out where they lay, from their dim. They went in a frame (owner, 2026-11-21: "Every single animation
             should be ultra smooth"). Only dimmed ones: a kept card the row re-made is still on the table. */
          if (motionKind === 'street' && layer && L) {
            const gone = [];
            prevCards.forEach(list => list.forEach(c => { if (c.node && !c.node.isConnected && c.o < 0.6) gone.push(c); }));
            if (gone.length) writes.push(() => cardsAway(motion, { rate, layer, layerRect: L, cards: gone, duration: 2 * S.beat }));
          }
          // 10: the hero's draw: the new cards come from the dealer spot into the raised gaps, then the hand sorts.
          if (heroDrawHold) {
            const before = prevCards.get(replayHeroIdx) || [];
            const nowEls = rowEls(replayHeroIdx);
            const thrown = before.filter(c => !nowEls.includes(c.node)).sort((a, b) => a.cx - b.cx);
            const spot = ptOf(dealerSpot);
            const fresh = nowEls.filter(el => !prevEls.has(el)).map(el => ({ el, r: el.getBoundingClientRect() })).sort((a, b) => a.r.left - b.r.left);
            const sortAt = heroDrawHold;
            const jobs = fresh.map(({ el, r }, i) => {
              const fx = r.left + r.width / 2, fy = r.top + r.height / 2;
              const g = thrown[i];
              return { el, size: sizeOf(el), delay: (i * S.place) / rate, from: { x: spot.x - fx, y: spot.y - fy }, gap: g ? { x: g.cx - fx, y: g.cy - fy } : { x: 0, y: 0 } };
            });
            if (jobs.length) writes.push(() => jobs.forEach(j => {
              j.el.getAnimations().forEach(a => a.cancel());
              drawIn(motion, { set, rate, el: j.el, from: j.from, gap: j.gap, delay: j.delay, sortAt, size: j.size });
            }));
          }
        }

        // 17: the card that lifts the hero's hand into a new category: the five that now play lift together, once.
        const landed = 320 / rate;
        if (CARD_LIFTS && motionKind === 'street' && category === 'community' && !folded.has(replayHeroIdx) && boardCount(hand) <= 1
          && (SHOWDOWN_SLIDES || !decidedNow)) {
          const cfg = gameEvalFor(hand.gameType, hand);
          const board = parseCardNotation(boardCards).filter(c => c.suit !== 'x');
          let prevBoardStr = '';
          for (let si = 0; si < streetIdx && si < hand.streets.length; si++) prevBoardStr += hand.streets[si].cards.board || '';
          const prevBoard = parseCardNotation(prevBoardStr).filter(c => c.suit !== 'x');
          const hole = parseCardNotation(heroCards).filter(c => c.suit !== 'x');
          if (cfg && board.length === prevBoard.length + 1 && hole.length) {
            const ch = streetChange(cfg, hole, prevBoard, board);
            if (ch.made) {
              const heroRow = rowEls(replayHeroIdx);
              const els = [];
              ch.made.hole.forEach(i => { const id = hole[i].rank + hole[i].suit; const el = heroRow.find(e => (e.dataset.ck || '').startsWith(id + '#')); if (el) els.push(el); });
              ch.made.board.forEach(i => { const el = table.querySelector('.replayer-board-area:not(.replayer-dead-area) .card-row > [data-slot="' + i + '"]'); if (el) els.push(el); });
              const jobs = els.filter(el => !el.dataset.pose).map((el, j) => ({ el, size: sizeOf(el), delay: landed + (j * S.cardLag) / rate }));
              const dy = -rPx();
              if (jobs.length) writes.push(() => jobs.forEach(j => liftOnce(motion, { set, rate, el: j.el, dy, delay: j.delay, size: j.size })));
            }
          }
        }

        /* 16, 18, 20-23: every card whose pose changed springs into it. At the result one beat after the hands
           have turned (the low half a beat after the high); on a street once the card has landed, the old leader
           settling first and the new one rising a beat later. */
        {
          const lastPose = motion.lastPose || new WeakMap();
          const changes = [];
          /* 16 in a run-out of several streets (14): the raise follows each street's cards as they land, not the
             press, so a lead that changes on the turn and back on the river is seen to. */
          const sequenced = new Set();
          const jumpN = motionKind === 'street' && stepPrev ? streetIdx - stepPrev.s : 1;
          if (SHOWDOWN_SLIDES && jumpN > 1 && exposeAllIn) {
            const cfg = gameEvalFor(hand.gameType, hand);
            const board = parseCardNotation(boardCards).filter(c => c.suit !== 'x');
            const sizes = [];
            for (let si = stepPrev.s + 1; si <= streetIdx; si++) sizes.push(parseCardNotation(hand.streets[si]?.cards.board || '').length);
            const times = runOutTimes(set, sizes);
            const hands = hand.players.map((_, pi) => pi).filter(pi => !folded.has(pi)).map(pi => {
              const raw = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
              return { seat: pi, cards: raw && raw !== 'MUCK' ? parseCardNotation(raw).filter(c => c.suit !== 'x') : [] };
            });
            if (cfg && cfg.type === 'high' && hands.every(h => h.cards.length >= 2)) {
              const r = rPx();
              let len = board.length - sizes.reduce((a, b) => a + b, 0);
              let cur = leaderOf(cfg, hands, board.slice(0, len));
              const steps = new Map();
              const push = (seat, st) => { if (!steps.has(seat)) steps.set(seat, []); steps.get(seat).push(st); };
              sizes.forEach((n, k) => {
                len += n;
                const next = leaderOf(cfg, hands, board.slice(0, len));
                if (next === cur) return;
                const t = (times[k] + CT.handArrive) / rate;
                if (cur >= 0) push(cur, { t, toY: 0 });
                if (next >= 0) push(next, { t: t + (cur >= 0 ? S.beat / rate : 0), toY: -r });
                cur = next;
              });
              const jobs = [];
              steps.forEach((list, seat) => rowEls(seat).forEach((el, j) => {
                if (el.tagName !== 'IMG') return;
                const was = lastPose.get(el) || '';
                jobs.push({ el, size: sizeOf(el), fromY: was === 'up' || was === 'up-lo' ? -r : 0, steps: list.map(x => ({ t: x.t + (j * S.cardLag) / rate, toY: x.toY })) });
                sequenced.add(el);
              }));
              if (jobs.length) writes.push(() => jobs.forEach(j => poseSequence(motion, { set, rate, el: j.el, fromY: j.fromY, steps: j.steps, size: j.size })));
              // Seats whose lead did not change in the run-out keep what they have: nothing to spring.
              hands.forEach(h => { if (!steps.has(h.seat)) rowEls(h.seat).forEach(el => sequenced.add(el)); });
            }
          }
          const consider = (el) => {
            if (!el.isConnected || sequenced.has(el)) return;
            const was = lastPose.has(el) ? lastPose.get(el) : '';
            const now = el.dataset.pose || '';
            if (was !== now) changes.push({ el, was, now });
          };
          posedNow.forEach(consider);
          (motion.prevPosed || []).forEach(el => { if (!posedNow.includes(el)) consider(el); });
          if (changes.length) {
            const r = rPx();
            /* A card moves a whole r or not at all (owner, 2026-11-13: "not in between"): up for a high, down for a low,
               a dead card only dims. */
            const off = { '': 0, up: -r, 'up-lo': -r, 'up-half': -r, down: r, 'down-half': r, dead: 0 };
            // A dead card darkens by its own CSS (filter, transitioned) and stays solid, so nothing under it shows through.
            const op = () => 1;
            const base = motionKind === 'result' ? Math.max(turnEnd, 0) + S.beat / rate : landed;
            const falls = changes.some(c => off[c.now] > off[c.was]);
            /* A hi-lo pot reads in two beats (owner, 2026-11-13): the high's cards rise with its "Hi:" readout lit,
               and once they have landed the low's sink with its "Lo:" readout lit. */
            const lowAfter = (timeTo(tierSpring(set, 'flick'), 0.98) + S.beat) / rate;
            const perRow = new Map();
            const jobs = changes.map(c => {
              const row = c.el.parentElement;
              const j = perRow.get(row) || 0;
              perRow.set(row, j + 1);
              const rising = off[c.now] < off[c.was];
              const lowHalf = motionKind === 'result' && (c.now === 'up-lo' || c.now === 'down' || c.now === 'down-half');
              const extra = lowHalf ? lowAfter : (motionKind !== 'result' && rising && falls) ? S.beat / rate : 0;
              return { ...c, size: sizeOf(c.el), delay: base + extra + (j * S.cardLag) / rate };
            });
            writes.push(() => jobs.forEach(j => poseTo(motion, {
              set, rate, el: j.el, fromY: off[j.was] || 0, toY: off[j.now] || 0, fromO: op(j.was), toO: op(j.now), delay: j.delay, size: j.size,
            })));
            if (motionKind === 'result') {
              // Each half's readout lights in its beat, even when all of the low's cards already went up with the high.
              const hiGo = changes.some(c => c.now === 'up'), loGo = hiGo || changes.some(c => c.now === 'up-lo');
              const lit = (half, at) => table.querySelectorAll('.replayer-seat-hand-name [data-half="' + half + '"]').forEach(sp => writes.push(() => {
                const hold = 700 / rate;
                // A swell and back while it is lit: 1 -> 1.12 -> 1 over the first half, still for the rest.
                const swell = hold / 2;
                motion.run(sp, { key: { el: sp, kind: 'lit' }, property: 'individual', size: { w: sp.offsetWidth, h: sp.offsetHeight }, end: at + hold, channels: [
                  { prop: 'scale', fn: (t) => (t <= at || t >= at + swell ? 1 : 1 + 0.12 * Math.sin(Math.PI * (t - at) / swell)), start: at, end: at + swell },
                ] });
                motion.tick(at, () => sp.classList.add('is-lit'));
                motion.tick(at + hold, () => sp.classList.remove('is-lit'));
              }));
              if (hiGo) lit('hi', base);
              if (loGo) lit('lo', base + lowAfter);
            }
          }
        }
      }

      /* (6) The figures (Replayer animations 31, 33, 46, 47): a stack counts down as its chips leave and an
         all-in empties before it reads All-in; at the result each winner's gain rises beside its plaque as the pot
         lands, and a busted all-in rolls from All-in to 0. */
      if (rSettings.animateChips) {
        const b = hand.blinds || {};
        const unit = hand.gameMode === 'cash' ? 0.01 : Math.max(1, Math.min(...[b.sb, b.ante, b.bringIn, b.bb].map(Number).filter(v => v > 0).concat([1e9])));
        const roundU = (v) => Math.round(v / unit) * unit;
        const stackEl = (pi) => table.querySelector('.replayer-seat[data-seat="' + pi + '"] .replayer-seat-stack');
        const flick = SPRING_SETS[set].tiers.flick;
        const flickSp = spring({ ...flick });
        const flickEnd = flickSp.settleMs(1e-3) / rate;
        const flickArrive = timeTo(flickSp, 0.98) / rate;
        const prevVals = motion.prevStackVals || new Map();
        const act = motionKind === 'action' ? currentActions[actionIdx] : null;
        if (act && act.amount && prevVals.has(act.player)) {
          const pi = act.player;
          const from = prevVals.get(pi), to = stackFigure(pi);
          const el = stackEl(pi);
          const mark = el && el.querySelector('.replayer-allin-mark');
          if (el && from > to) {
            if (!mark) {
              // 31: the figure rides the wager's flick spring down to what is left.
              const tn = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : null;
              /* It starts on the figure that was showing and ends on the new one: what it takes off is rounded to the
                 table's smallest chip, never the figure itself (58,100 read 58,000 as the count began and 58,100 again
                 as it ended). While it counts, a later commit of the same step leaves it alone (resyncDigits). */
              if (tn) writes.push(() => {
                motion.countingStacks.add(pi);
                motion.sample((t) => {
                  const done = t >= flickEnd;
                  tn.data = fmtChips(done ? to : Math.max(to, from - roundU((from - to) * flickSp.at(t * rate))));
                  if (done) motion.countingStacks.delete(pi);
                  motion.wroteDigits = true;
                }, { end: flickEnd });
              });
            } else {
              /* 33: down to 0 first, then the 0 crossfades to All-in where it stands. It rolled, both 1r up in 90ms, in
                 the plaque (owner, 2026-11-21: "Still some jittery shit on hero's seat box"). */
              writes.push(() => {
                if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
                const ghost = document.createElement('span');
                ghost.className = 'replayer-stack-roll';
                el.appendChild(ghost);
                motion.sample((t) => { ghost.textContent = fmtChips(t >= flickArrive ? 0 : Math.max(0, from - roundU(from * flickSp.at(t * rate)))); }, { end: flickArrive });
                const S2 = SPRING_SETS[set].stage;
                const ease2 = (p) => p * p * (3 - 2 * p);
                motion.run(ghost, { transient: true, property: 'individual', size: { w: el.offsetWidth, h: el.offsetHeight }, channels: [
                  { prop: 'opacity', ramp: { from: 1, to: 0, delay: flickArrive, duration: S2.beat / rate, ease: ease2 } },
                ] });
                motion.run(mark, { key: { el: mark, kind: 'roll' }, property: 'individual', size: { w: mark.offsetWidth, h: mark.offsetHeight }, channels: [
                  { prop: 'opacity', ramp: { from: 0, to: 1, delay: flickArrive, duration: S2.beat / rate, ease: ease2 } },
                ] });
              });
            }
          }
        }
        if (motionKind === 'result' && potAwards && shipPlan && shipPlan.length) {
          const S2 = SPRING_SETS[set].stage;
          const tLand = shipStartAfterSweep(set, rate, sweepPlan ? sweepPlan.length : 0) + uncalledDelay + shipFirstArrival(set, rate) + (motion.shipWaveEnd || 0);
          const g1 = (() => { const p = document.createElement('div'); p.style.cssText = 'position:absolute;visibility:hidden;height:0;width:calc(var(--gu) * 100)'; table.appendChild(p); const v = p.getBoundingClientRect().width / 100 || 10; table.removeChild(p); return v; })();
          const T = table.getBoundingClientRect();
          const hand_ = tierSpring(set, 'hand');
          // 46: "+106,000" rises 2r beside each winner's plaque, holds, fades. Always BESIDE it, level with the
          // stack (owner, 2026-11-15: "should be to the side of the seat box, not on top of other information"): a
          // top-rail seat's sat under its plaque, on the showdown readout. The side facing the middle (right for a
          // centred seat), or the other where that side would land on another seat's plaque or cards.
          const others = [...table.querySelectorAll('.replayer-seat[data-seat]')].map(s => ({
            seat: Number(s.dataset.seat),
            boxes: [...s.querySelectorAll('.replayer-seat-info, .replayer-seat-cards .card-row > *')].map(e => e.getBoundingClientRect()).filter(b => b.width > 0),
          }));
          const measure = document.createElement('canvas').getContext('2d');
          const gains = shipPlan.map(d => {
            const seatEl = table.querySelector('.replayer-seat[data-seat="' + d.seat + '"]');
            const info = seatEl && seatEl.querySelector('.replayer-seat-info');
            const st = stackEl(d.seat);
            if (!info || !st || !L) return null;
            const pr = info.getBoundingClientRect(), sr = st.getBoundingClientRect();
            const cs = getComputedStyle(st);
            const text = '+' + fmtChips(d.award);
            let w = 0;
            try { measure.font = cs.font; w = measure.measureText(text).width; } catch { w = text.length * sr.height * 0.55; }
            const y = sr.top + sr.height / 2;
            const clearAt = (left) => !others.some(o => o.seat !== d.seat && o.boxes.some(b => left < b.right && left + w > b.left && y - sr.height / 2 < b.bottom && y + sr.height / 2 > b.top));
            const facing = (pr.left + pr.width / 2) <= (T.left + T.width / 2);
            const rightLeft = pr.right + g1, leftLeft = pr.left - g1 - w;
            const toRight = facing ? (clearAt(rightLeft) || !clearAt(leftLeft)) : !(clearAt(leftLeft) || !clearAt(rightLeft));
            return { award: d.award, text, y: y - L.top, x: toRight ? pr.right + g1 - L.left : pr.left - g1 - L.left, toRight, font: cs.font, color: cs.color, h: sr.height };
          }).filter(Boolean);
          // 47: a busted all-in rolls from All-in to 0 as the pot lands elsewhere.
          const busts = hand.players.map((_, pi) => pi).filter(pi => allIn.has(pi) && shownStacks[pi] <= 0 && !(potAwards[pi] > 0))
            .map(pi => ({ pi, el: stackEl(pi) })).filter(x => x.el);
          writes.push(() => {
            gains.forEach(gn => {
              const span = document.createElement('span');
              span.className = 'replayer-gain' + (gn.toRight ? '' : ' is-left');
              span.textContent = gn.text;
              Object.assign(span.style, { left: gn.x + 'px', top: (gn.y - gn.h / 2) + 'px', font: gn.font, color: gn.color, height: gn.h + 'px', lineHeight: gn.h + 'px' });
              layer.appendChild(span);
              // It fades in where it stands and out again; it rose 2r on the hand spring (owner, 2026-11-21: "Every
              // single animation should be ultra smooth"; the words on a seat fade, never slide).
              const hold = tLand + timeTo(hand_, 0.98) / rate + 800 / rate;
              const ease2 = (p) => p * p * (3 - 2 * p);
              motion.run(span, { transient: true, property: 'individual', size: { w: 40, h: gn.h }, channels: [
                { prop: 'opacity', ramp: { from: 0, to: 1, delay: tLand, duration: 2 * S2.beat / rate, ease: ease2 } },
                { prop: 'opacity', ramp: { from: 1, to: 0, delay: hold, duration: 2 * S2.beat / rate, ease: ease2 } },
              ], end: hold + 2 * S2.beat / rate });
            });
            busts.forEach(({ el, pi }) => {
              /* The mark that leaves is drawn over the stack line in the plaque: the line itself waits unseen. It is the
                 mark the seat showed (AT RISK where it was covered; it read ALL-IN, a change of word at the press), and the
                 two crossfade where they stand: they rolled, both 1r up in 90ms (owner, 2026-11-21: "Still some jittery
                 shit on hero's seat box"). */
              const plaque = el.parentElement;
              if (!plaque) return;
              if (getComputedStyle(plaque).position === 'static') plaque.style.position = 'relative';
              const ghost = document.createElement('span');
              ghost.className = 'replayer-stack-roll';
              Object.assign(ghost.style, { left: el.offsetLeft + 'px', top: el.offsetTop + 'px', width: el.offsetWidth + 'px', height: el.offsetHeight + 'px', right: 'auto', bottom: 'auto' }, stackType(el));
              const mk = document.createElement('span');
              mk.className = 'replayer-allin-mark';
              mk.textContent = (motion.prevAtRisk || new Set()).has(pi) ? 'AT RISK' : 'ALL-IN';
              ghost.appendChild(mk);
              plaque.appendChild(ghost);
              const tn = (el.firstChild && el.firstChild.nodeType === 3) || el.querySelector('.replayer-out-mark') ? el.firstChild : null;
              const ease2 = (p) => p * p * (3 - 2 * p);
              motion.run(ghost, { transient: true, property: 'individual', size: { w: el.offsetWidth, h: el.offsetHeight }, channels: [
                { prop: 'opacity', ramp: { from: 1, to: 0, delay: tLand, duration: S2.beat / rate, ease: ease2 } },
              ] });
              if (tn) {
                // The figure itself waits under the mark: a span would change React's text node, so its colour fades in.
                motion.run(el, { key: { el, kind: 'roll' }, property: 'individual', size: { w: el.offsetWidth, h: el.offsetHeight }, channels: [
                  { prop: 'opacity', ramp: { from: 0, to: 1, delay: tLand, duration: S2.beat / rate, ease: ease2 } },
                ] });
              }
            });
          });
        }
      }

      /* (8) The seats (Replayer animations 51, 53-55, 57, 58, 60, 61, 63, 66, 67, 71). */
      {
        const S4 = SPRING_SETS[set].stage;
        const armSp = tierSpring(set, 'arm'), inertiaSp = tierSpring(set, 'inertia');
        const prevS = motion.prevSeats || { turn: null, labels: [], runNames: new Map() };
        const seatOf = (pi) => table.querySelector('.replayer-seat[data-seat="' + pi + '"]');
        const act4 = motionKind === 'action' ? currentActions[actionIdx] : null;
        /* A seat's words (a readout at the showdown, a draw's badge, the stud note) fade in where they stand. They dropped
           0.75r from above in 70ms (owner, 2026-11-21: "Still some jittery shit on hero's seat box"; the words on a seat
           now come and go by fading, never by sliding). */
        const easeIO = (p) => p * p * (3 - 2 * p);
        // Readouts a moment below has taken in hand, so the last pass (any new readout fades in) leaves them alone.
        const namesHandled = new Set();
        const drop = (el, delay, to) => {
          el.getAnimations().forEach(a => { if (a instanceof CSSAnimation) a.cancel(); });
          // To the element's own opacity (a trailing name rests at 0.55): ramped to 1, it would dim a notch as it ended.
          if (to == null) { const own = Number(getComputedStyle(el).opacity); to = Number.isFinite(own) ? own : 1; }
          return motion.run(el, { key: { el, kind: 'drop' }, property: 'individual', size: { w: el.offsetWidth, h: el.offsetHeight }, channels: [
            { prop: 'opacity', ramp: { from: 0, to, delay, duration: S4.beat / rate, ease: easeIO } },
          ] });
        };
        /* 51: the turn passes by a crossfade (owner, 2026-11-13: "it shouldn't jump from seat to seat, it should fade
           out and fade in"): the ring fades out on the plaque that acted as it fades in on the next one to act. */
        const toSeat = turnIdx != null && turnIdx >= 0 ? seatOf(turnIdx) : null;
        /* One path for every change of turn on a step forward (owner, 2026-11-22, of the hero's seat: "THE PROBLEM IS THE
           BLUE GLOW", "The crossfade to hero's seat abruptly pauses, dims, then pulses when the betting action
           happens"): the glow leaves the seat that had it from the strength it shows NOW (a ring still arriving when
           its seat acted started its leave at full: 0.53 to 1, a pulse), and arrives on the next seat by a drawn ring
           too when no seat had it before (a street's first to act took it by a CSS transition, its strength unknown to
           the next step). A newer change of turn retires an older hand-over (it fired mid-way through the next fade),
           and the seat-level classes of an older one are cleared. */
        const fromTurn = prevS.turn && prevS.turn.seat !== turnIdx ? prevS.turn.seat : null;
        const turnMoves = (motionKind === 'action' || motionKind === 'street' || motionKind === 'result')
          && (fromTurn != null || (toSeat && !(prevS.turn && prevS.turn.seat === turnIdx)));
        if (turnMoves) {
          const fade = (3 * S4.beat) / rate;
          const fromSeat = fromTurn != null ? seatOf(fromTurn) : null;
          const fromInfo = fromSeat && fromSeat.querySelector('.replayer-seat-info');
          const info = toSeat && toSeat.querySelector('.replayer-seat-info');
          writes.push(() => {
            const gen = (motion.turnGen = (motion.turnGen || 0) + 1);
            const ease = (q) => q * q * (3 - 2 * q);
            const ringIn = (plaque) => {
              const ring = document.createElement('div');
              ring.className = 'replayer-turn-ring is-in-plaque';
              ring.style.borderRadius = getComputedStyle(plaque).borderRadius;
              plaque.appendChild(ring);
              return ring;
            };
            // Every drawn ring on the table and the strength it shows now; each is replaced by one going on from there.
            const rings = [...table.querySelectorAll('.replayer-turn-ring.is-in-plaque')].map(r => ({ r, plaque: r.parentElement, op: Math.max(0, Math.min(1, Number(getComputedStyle(r).opacity) || 0)) }));
            rings.forEach(x => x.r.remove());
            const opOn = (plaque) => { const x = rings.find(y => y.plaque === plaque); return x ? x.op : null; };
            table.querySelectorAll('.replayer-seat.ring-leave, .replayer-seat.ring-hand, .replayer-seat.ring-wait').forEach(s2 => s2.classList.remove('ring-leave', 'ring-hand', 'ring-wait'));
            // A drawn ring fading out from `op`, at the full fade's pace (a ring half in goes in half the time).
            const leave = (plaque, op) => motion.run(ringIn(plaque), { transient: true, size: { w: plaque.offsetWidth, h: plaque.offsetHeight }, end: fade * op, channels: [
              { prop: 'opacity', ramp: { from: op, to: 0, delay: 0, duration: fade * op, ease } },
            ] });
            // The seat that had the turn: what it shows now (its drawn ring while one is still arriving, else its own,
            // whole). It drops its own ring at once, under the drawn one (see .ring-leave).
            const fromOp = fromInfo ? (opOn(fromInfo) ?? 1) : 0;
            if (fromSeat && fromInfo && fromOp > 0.01) {
              fromSeat.classList.add('ring-leave');
              const out = leave(fromInfo, fromOp);
              const left = () => { if (motion.turnGen === gen) fromSeat.classList.remove('ring-leave'); };
              if (out) motion.tick(fade * fromOp, left, out); else left();
            }
            // Any other seat whose ring is still going (an earlier leave, cut short by this press) goes on going.
            rings.filter(x => x.plaque !== fromInfo && x.plaque !== info && x.op > 0.01 && x.plaque.isConnected).forEach(x => leave(x.plaque, x.op));
            if (!toSeat || !info) return;
            // The seat to act: from what it shows (a ring of its own still leaving, when the turn comes straight back).
            const toOp = opOn(info) ?? 0;
            toSeat.classList.add('ring-wait');
            /* Not transient: the registry took a transient away when its animation finished, and the hand-over ran on its
               own timer, so for a frame or more there was no ring at all, or the drawn one and the plaque's own both. It
               rests at full when its fade ends (its own opacity is 1) and the hand-over removes it in the same task as the
               plaque takes its ring. */
            const ringNew = ringIn(info);
            const inMs = Math.max(1, fade * (1 - toOp));
            const entry = motion.run(ringNew, { size: { w: info.offsetWidth, h: info.offsetHeight }, end: inMs, channels: [
              { prop: 'opacity', ramp: { from: toOp, to: 1, delay: 0, duration: inMs, ease } },
            ] });
            // The seat to act takes its ring at once, as the drawn one goes: no transition, no arrival pulse.
            const take = () => {
              if (motion.turnGen !== gen) return;
              toSeat.classList.add('ring-hand');
              toSeat.classList.remove('ring-wait');
              ringNew.remove();
              requestAnimationFrame(() => toSeat.classList.remove('ring-hand'));
            };
            if (entry) motion.tick(inMs, take, entry); else take();
          });
        }
        /* 53: the action label fades in on its plaque. It rose 1r out of the plaque on the yield spring, visible within
           90ms (owner, 2026-11-21: "Still some jittery shit on hero's seat box": the words on a seat fade, never slide). */
        if (act4) {
          const lab = table.querySelector('.replayer-action-badge-outer[data-act-seat="' + act4.player + '"]');
          if (lab) writes.push(() => {
            lab.getAnimations().forEach(a => { if (a instanceof CSSAnimation) a.cancel(); });
            // To the label's own opacity (a check or fold rests at 0.85): ramped to 1, it dimmed a notch the frame the
            // fade ended (owner, 2026-11-21: "make all of this kind of jittery stuff go away").
            const own = Number(getComputedStyle(lab).opacity);
            motion.run(lab, { key: { el: lab, kind: 'rise' }, property: 'individual', size: { w: lab.offsetWidth, h: lab.offsetHeight }, channels: [
              { prop: 'opacity', ramp: { from: 0, to: Number.isFinite(own) ? own : 1, delay: 0, duration: S4.beat / rate, ease: easeIO } },
            ] });
          });
        }
        /* 54: labels the commit no longer draws fade out where they stood: the last street's at a new street, round the
           table from the small blind, and a seat's at the result or when its run-out name takes its place. Nothing
           moves (owner, 2026-11-21: "the fold action buttons should fade away, not violently disappear"; they sank by
           their height and were gone in about 100ms), and each copy is drawn as the label was, its plaque's scale,
           grey and dimming included (labelsAway). A seat that acted again is skipped: its new label takes the place. */
        if (motionKind && prevS.labels.length && layer && L) {
          const order = (pi) => dealOrder.indexOf(pi);
          // A seat that acted again crossfades: its old label goes over the beat its new one fades in over (it went in a
          // frame, a dimmed answer at 0.4 or a bet at full).
          const shown = new Set([...table.querySelectorAll('.replayer-action-badge-outer[data-act-seat]')].map(el => Number(el.dataset.actSeat)));
          const gone = prevS.labels.filter(l => !l.node.isConnected).map(l => (shown.has(l.seat) ? { ...l, duration: S4.beat } : l))
            .sort((a, b) => order(a.seat) - order(b.seat));
          if (gone.length) {
            const stagger = motionKind === 'street' && gone.length > 1 ? Math.min(S4.sweepStagger, S4.sweepCap / (gone.length - 1)) : 0;
            writes.push(() => labelsAway(motion, { rate, layer, layerRect: L, duration: 2 * S4.beat, stagger, labels: gone.map(l => {
              const plaque = seatOf(l.seat) && seatOf(l.seat).querySelector('.replayer-seat-info');
              if (!plaque || l.dx == null) return l;
              const pr = plaque.getBoundingClientRect();
              const scale = (plaque.offsetWidth ? pr.width / plaque.offsetWidth : 1) || 1;
              let opacity = 1;
              for (let n = plaque; n && n !== table; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity) || 0;
              return { ...l, plaque, cx: pr.left + pr.width / 2 + l.dx * scale, cy: pr.top + pr.height / 2 + l.dy * scale, scale, filter: getComputedStyle(plaque).filter, opacity };
            }) }));
          }
        }
        /* 55: a bet makes the earlier answers stale: they dim in acting order, from where they rest (a check or a fold
           at 0.85). The ramp started at 1, so every earlier answer flashed up to full before it dimmed; and since every
           label was re-made at every step, the ones already stale did it again at every bet after (owner, 2026-11-21:
           "Still some jittery shit on hero's seat box": the hero's check, on its plaque, at each raise). */
        const staleNew = [...table.querySelectorAll('.replayer-action-badge-outer.is-stale')].filter(el => !(motion.prevStaleEls || new Set()).has(el));
        if (staleNew.length && act4 && ['bet', 'raise', 'all-in'].includes(act4.action)) {
          const ordered = staleNew.sort((a, b) => ((Number(a.dataset.actSeat) - act4.player + 99) % hand.players.length) - ((Number(b.dataset.actSeat) - act4.player + 99) % hand.players.length));
          // Read from a hidden copy without the class: toggling the label's own class would start its 1ms transition
          // under Reduce Motion and read back 0.4.
          const restOf = (el) => {
            const c = el.cloneNode(false);
            c.classList.remove('is-stale');
            c.style.visibility = 'hidden';
            el.parentElement.appendChild(c);
            const v = Number(getComputedStyle(c).opacity);
            c.remove();
            return Number.isFinite(v) && v > 0 ? v : 1;
          };
          writes.push(() => ordered.forEach((el, k) => {
            const rest = restOf(el);
            motion.run(el, { key: { el, kind: 'stale' }, property: 'individual', size: { w: el.offsetWidth, h: el.offsetHeight }, channels: [
              { prop: 'opacity', ramp: { from: rest, to: 0.4, delay: (60 + k * 25) / rate, duration: S4.beat / rate } },
            ] });
          }));
        }
        // 57: an all-in's ring closes onto its plaque from 1.35 times its size. Off (RING_CLOSES).
        if (RING_CLOSES && act4 && act4.action === 'all-in' && layer && L) {
          const seat = seatOf(act4.player);
          const info = seat && seat.querySelector('.replayer-seat-info');
          if (info) {
            const ir = info.getBoundingClientRect();
            const radius = getComputedStyle(info).borderRadius;
            writes.push(() => {
              const ring = document.createElement('div');
              ring.className = 'replayer-turn-ring is-allin';
              Object.assign(ring.style, { left: (ir.left - L.left) + 'px', top: (ir.top - L.top) + 'px', width: ir.width + 'px', height: ir.height + 'px', borderRadius: radius, transformOrigin: '50% 50%' });
              layer.appendChild(ring);
              seat.classList.add('ring-wait');
              const land = timeTo(armSp, 0.98) / rate;
              const entry = motion.run(ring, { transient: true, size: { w: ir.width, h: ir.height }, end: land + S4.arrivalFade / rate, channels: [
                { prop: 'scale', spring: armSp, from: 1.35, to: 1, timeScale: rate },
                { prop: 'opacity', ramp: { from: 0, to: 1, delay: 0, duration: S4.arrivalFade / rate } },
                { prop: 'opacity', ramp: { from: 1, to: 0, delay: land, duration: S4.arrivalFade / rate } },
              ] });
              const take = () => seat.classList.remove('ring-wait');
              if (entry) motion.tick(land, take, entry); else take();
            });
          }
        }
        /* 58: ALL-IN crossfades to AT RISK at each covered seat, a beat apart in seat order. It rolled, both words 0.75r
           up in 90ms, in the plaque itself (owner, 2026-11-21: "Still some jittery shit on hero's seat box"). */
        const riskNew = [...atRiskSeats].filter(pi => !(motion.prevAtRisk || new Set()).has(pi)).sort((a, b) => a - b);
        if (riskNew.length) writes.push(() => riskNew.forEach((pi, k) => {
          const st = seatOf(pi) && seatOf(pi).querySelector('.replayer-seat-stack');
          const mark = st && st.querySelector('.replayer-allin-mark');
          const plaque = st && st.parentElement;
          if (!mark || !plaque) return;
          const d = (k * S4.beat) / rate;
          if (getComputedStyle(plaque).position === 'static') plaque.style.position = 'relative';
          const ghost = document.createElement('span');
          ghost.className = 'replayer-stack-roll';
          ghost.textContent = 'ALL-IN';
          Object.assign(ghost.style, { left: st.offsetLeft + 'px', top: st.offsetTop + 'px', width: st.offsetWidth + 'px', height: st.offsetHeight + 'px', right: 'auto', bottom: 'auto' }, stackType(st));
          plaque.appendChild(ghost);
          motion.run(ghost, { transient: true, property: 'individual', size: { w: st.offsetWidth, h: st.offsetHeight }, channels: [
            { prop: 'opacity', ramp: { from: 1, to: 0, delay: d, duration: S4.beat / rate, ease: easeIO } },
          ] });
          motion.run(mark, { key: { el: mark, kind: 'roll' }, property: 'individual', size: { w: mark.offsetWidth, h: mark.offsetHeight }, channels: [
            { prop: 'opacity', ramp: { from: 0, to: 1, delay: d, duration: S4.beat / rate, ease: easeIO } },
          ] });
        }));
        // 60 / 61: at the showdown the names arrive weakest first and the winner's last; a split's low half 420ms
        // after its high.
        if (motionKind === 'result') {
          const names = [...table.querySelectorAll('[data-name-seat]')].filter(el => !(motion.prevNameEls || new Set()).has(el));
          if (names.length) {
            const cfg = gameEvalFor(hand.gameType, hand);
            const board = feltBoard ? parseCardNotation(boardCards).filter(c => c.suit !== 'x') : [];
            const kind = halvesOf(cfg)[0] || 'high';
            const strength = (pi) => {
              const raw = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
              const r = cfg && raw && raw !== 'MUCK' ? bestFive(cfg, parseCardNotation(raw).filter(c => c.suit !== 'x'), board, kind) : null;
              if (!r) return 0;
              return kind === 'high' ? r.ev.score : -r.ev.score;
            };
            const won = (pi) => (potAwards && potAwards[pi] > 0 ? 1 : 0);
            const loHalf = (pi) => !!(wonHalves && wonHalves.lo.has(pi) && !wonHalves.hi.has(pi));
            const list = names.map(el => ({ el, pi: Number(el.dataset.nameSeat) }))
              .sort((a, b) => won(a.pi) - won(b.pi) || loHalf(a.pi) - loHalf(b.pi) || strength(a.pi) - strength(b.pi));
            const step = list.length > 1 ? 800 / (list.length - 1) : 0;
            const base = Math.max(0, (motion.shipArriveMs || 0) - 800);
            /* A name a run-out already showed (the same words) stays: it went out at the result and came back in the
               same place, a blink on the seat. It only takes its new strength, from the run-out's (0.55 trailing). */
            const prevRN = prevS.runNames || new Map();
            const wordsOf = (el) => [...el.childNodes].filter(n => !(n.classList && n.classList.contains('hn-eq'))).map(n => n.textContent).join('').trim();
            writes.push(() => list.forEach((x, k) => {
              const was = prevRN.get(x.pi);
              namesHandled.add(x.el);
              if (was && was.text === wordsOf(x.el)) {
                // Not the winner's CSS reveal either (showdownRevealCentred): it holds the name at 0 for 0.8s.
                x.el.getAnimations().forEach(a => { if (a instanceof CSSAnimation) a.cancel(); });
                const own = Number(getComputedStyle(x.el).opacity);
                const from = was.lead ? 1 : 0.55, to = Number.isFinite(own) ? own : 1;
                /* The same words in another colour (the run-out's gold "Wheel" taking the loser's red): the old copy
                   fades out where it stood as the new one fades in. Kept, the colour changed in one frame (owner,
                   2026-11-22: "Hero's seat box is STILL flickering"). */
                /* The colour is the one it was shown in (recorded with the run's names): the seat's result class (a
                   loser's red) reaches a copy too. */
                const old = (prevS.leavers || []).find(l => !l.cls && !l.node.isConnected && l.parent && l.parent.isConnected
                  && l.node.dataset.nameSeat === String(x.pi));
                if (old && was.color && was.color !== getComputedStyle(x.el).color) {
                  const g = old.node.cloneNode(true);
                  g.dataset.ghost = '1';
                  g.removeAttribute('data-name-seat');
                  g.removeAttribute('data-run-name');
                  g.setAttribute('aria-hidden', 'true');
                  Object.assign(g.style, { pointerEvents: 'none', color: was.color, borderColor: was.border || '' });
                  old.parent.appendChild(g);
                  g.getAnimations({ subtree: true }).forEach(a => a.cancel());
                  motion.run(g, { transient: true, property: 'individual', size: { w: g.offsetWidth || 1, h: g.offsetHeight || 1 }, channels: [
                    { prop: 'opacity', ramp: { from, to: 0, delay: 0, duration: 2 * S4.beat / rate, ease: easeIO } },
                  ] });
                  motion.run(x.el, { key: { el: x.el, kind: 'drop' }, property: 'individual', size: { w: x.el.offsetWidth, h: x.el.offsetHeight }, channels: [
                    { prop: 'opacity', ramp: { from: 0, to, delay: 0, duration: 2 * S4.beat / rate, ease: easeIO } },
                  ] });
                  return;
                }
                if (Math.abs(from - to) > 0.01) motion.run(x.el, { key: { el: x.el, kind: 'drop' }, property: 'individual', size: { w: x.el.offsetWidth, h: x.el.offsetHeight }, channels: [
                  { prop: 'opacity', ramp: { from, to, delay: 0, duration: S4.beat / rate, ease: easeIO } },
                ] });
                return;
              }
              drop(x.el, (base + k * step) / rate + (loHalf(x.pi) && won(x.pi) ? 3 * S4.beat / rate : 0));
            }));
          }
        }
        // 63: a tournament seat that lost everything reads OUT; a beat later its plaque dims. It no longer shrinks (owner,
        // 2026-11-21: "the highlight around hero's seat box is jittering"): the scale re-drew its ring at every size.
        if (motionKind === 'result' && hand.gameMode !== 'cash' && potAwards && shipPlan && shipPlan.length) {
          const tLand0 = shipStartAfterSweep(set, rate, sweepPlan ? sweepPlan.length : 0) + uncalledDelay + shipFirstArrival(set, rate) + (motion.shipWaveEnd || 0);
          const outs = hand.players.map((_, pi) => pi).filter(pi => bustedAtResult(pi));
          if (outs.length) writes.push(() => outs.forEach(pi => {
            const info = seatOf(pi) && seatOf(pi).querySelector('.replayer-seat-info');
            if (!info) return;
            motion.run(info, { key: { el: info, kind: 'out' }, property: 'individual', size: { w: info.offsetWidth, h: info.offsetHeight }, channels: [
              { prop: 'opacity', spring: inertiaSp, from: 1, to: 0.5, delay: tLand0 + S4.beat / rate, timeScale: rate },
            ] });
          }));
        }
        // 66: the stud note drops in under the first seat to act, after its cards.
        const note = table.querySelector('.replayer-seat-hand-name.is-note');
        if (note && motionKind === 'street' && !(motion.prevNameEls || new Set()).has(note)) writes.push(() => drop(note, (200 + S4.place * hand.players.length) / rate));
        // 67: the draw declarations land in drawing order, a beat apart (all begun inside 420ms).
        const badgesNew = [...table.querySelectorAll('.replayer-seat-draw-badge')].filter(el => !(motion.prevBadges || new Set()).has(el));
        if (badgesNew.length) {
          const draws = hand.streets[streetIdx]?.draws || [];
          const pos = (el) => { const pi = Number(el.closest('.replayer-seat').dataset.seat); const k = draws.findIndex(d => d.player === pi); return k < 0 ? 99 : k; };
          const ordered = badgesNew.sort((a, b) => pos(a) - pos(b));
          const step = ordered.length > 1 ? Math.min(S4.beat, 420 / (ordered.length - 1)) : 0;
          writes.push(() => ordered.forEach((el, k) => drop(el, (k * step) / rate)));
        }
        // 71: a tabled run-out's names roll when a card changes them; a change of lead crosses their strengths.
        if (motionKind === 'street') {
          const prevRN = prevS.runNames || new Map();
          const jobs = [];
          table.querySelectorAll('[data-run-name]').forEach(el => {
            const pi = Number(el.dataset.nameSeat);
            const was = prevRN.get(pi);
            if (!was) return;
            jobs.push({ el, was, now: { text: el.dataset.runName, lead: !el.classList.contains('is-trailing') } });
          });
          if (jobs.length) writes.push(() => jobs.forEach(j => {
            const d = 300 / rate;
            if (j.was.text !== j.now.text) {
              const host = j.el.parentElement;
              if (host) {
                const ghost = j.el.cloneNode(true);
                ghost.removeAttribute('data-name-seat');
                ghost.removeAttribute('data-run-name');
                /* Out of every placement pass (`:not([data-ghost])`): it keeps the readout's class to keep its look, and
                   placeNames took it for a readout standing under the plaque, so the new name rolling in beside it was
                   "on" it and jumped beside the plaque a moment after it showed (owner, 2026-11-21: "Still some jittery
                   shit on hero's seat box"). */
                ghost.dataset.ghost = '1';
                ghost.textContent = j.was.text;
                ghost.classList.toggle('is-trailing', !j.was.lead);
                host.appendChild(ghost);
                // The old words fade out where they stood as the new ones fade in: a crossfade, no roll (it moved both
                // 0.75r up in 90ms; owner, 2026-11-21: the words on a seat fade, never slide).
                motion.run(ghost, { transient: true, property: 'individual', size: { w: j.el.offsetWidth, h: j.el.offsetHeight }, channels: [
                  { prop: 'opacity', ramp: { from: j.was.lead ? 1 : 0.55, to: 0, delay: d, duration: S4.beat / rate, ease: easeIO } },
                ] });
              }
              motion.run(j.el, { key: { el: j.el, kind: 'roll' }, property: 'individual', size: { w: j.el.offsetWidth, h: j.el.offsetHeight }, channels: [
                { prop: 'opacity', ramp: { from: 0, to: j.now.lead ? 1 : 0.55, delay: d, duration: S4.beat / rate, ease: easeIO } },
              ] });
            } else if (j.was.lead !== j.now.lead) {
              motion.run(j.el, { key: { el: j.el, kind: 'lead' }, property: 'individual', size: { w: j.el.offsetWidth, h: j.el.offsetHeight }, channels: [
                { prop: 'opacity', ramp: { from: j.was.lead ? 1 : 0.55, to: j.now.lead ? 1 : 0.55, delay: d, duration: S4.beat / rate } },
              ] });
            }
          }));
        }
        /* Last: a seat's words new this commit that no moment above brings in (a run-out's names as the hands are
           tabled, an equity figure, a readout a step brings) fade in where they stand. They appeared at full in a frame
           ("Wheel" at the river call; owner, 2026-11-21: "Every single animation should be ultra smooth"). */
        writes.push(() => table.querySelectorAll('[data-name-seat]').forEach(el => {
          if ((motion.prevNameEls || new Set()).has(el) || namesHandled.has(el)) return;
          if (el.getAnimations().some(a => !(a instanceof CSSAnimation))) return;
          drop(el, 0);
        }));
        // A pot pill new to the main and side pots' row (or a split's shares) fades in where it stands.
        writes.push(() => table.querySelectorAll(POT_PILLS).forEach(el => {
          if ((motion.prevPotPills || new Set()).has(el)) return;
          if (el.getAnimations().some(a => !(a instanceof CSSAnimation))) return;
          drop(el, 0);
        }));
        /* And what went with no moment of its own (LEAVERS) fades out where it stood: a copy of it, put back in the place
           it hung from with its own placement, held out of every placement pass. A seat whose readout is replaced keeps
           the new one (a moment above takes the change); a row with a successor is replaced, not left. */
        if (prevS.leavers && prevS.leavers.length) {
          const named = new Set([...table.querySelectorAll('[data-name-seat]')].map(el => el.dataset.nameSeat));
          const gone = prevS.leavers.filter(l => !l.node.isConnected && l.parent && l.parent.isConnected
            && (l.cls ? !table.querySelector(l.cls + ':not([data-ghost])') : !named.has(l.node.dataset.nameSeat)));
          if (gone.length) writes.push(() => gone.forEach(l => {
            const g = l.node.cloneNode(true);
            g.dataset.ghost = '1';
            g.removeAttribute('data-name-seat');
            g.removeAttribute('data-run-name');
            g.setAttribute('aria-hidden', 'true');
            g.style.pointerEvents = 'none';
            l.parent.appendChild(g);
            g.getAnimations({ subtree: true }).forEach(a => a.cancel());
            const own = Number(getComputedStyle(g).opacity);
            motion.run(g, { transient: true, property: 'individual', size: { w: g.offsetWidth || 1, h: g.offsetHeight || 1 }, channels: [
              { prop: 'opacity', ramp: { from: Number.isFinite(own) ? own : 1, to: 0, delay: 0, duration: 2 * S4.beat / rate, ease: easeIO } },
            ] });
          }));
        }
      }

      /* 35: a bet nobody called slides from where it stood back to its bettor's plaque, and the stack takes it as it
         lands; the pot ships a beat later (tShip waits for it). */
      if (motionKind === 'result' && uncalledBack && layer && L) {
        const S3 = SPRING_SETS[set].stage;
        const handSp3 = tierSpring(set, 'hand');
        const land = timeTo(handSp3, 0.98) / rate;
        uncalledBack.forEach((amt, pi) => {
          if (!(amt > 0)) return;
          const g = prevWagers.get(pi);
          const info = table.querySelector('.replayer-seat[data-seat="' + pi + '"] .replayer-seat-info');
          if (!g || !info) return;
          const pr = info.getBoundingClientRect();
          const from = { x: g.geo.cx, y: g.geo.cy };
          const to = { x: Math.max(pr.left, Math.min(pr.right, from.x)), y: Math.max(pr.top, Math.min(pr.bottom, from.y)) };
          writes.push(() => {
            motion.pendingStacks.set(pi, (motion.pendingStacks.get(pi) || 0) + amt);
            const ghost = g.el.cloneNode(true);
            ghost.classList.remove('animate-chips');
            [...ghost.childNodes].forEach(n => { if (n.nodeType === 3) n.data = fmtChips(amt); });
            ghost.querySelectorAll('.replayer-bet-sizing').forEach(x => x.remove());
            ghost.removeAttribute('data-seat');
            Object.assign(ghost.style, { position: 'absolute', left: (from.x - L.left) + 'px', top: (from.y - L.top) + 'px', transform: 'translate(-50%, -50%)', margin: '0' });
            layer.appendChild(ghost);
            const entry = motion.run(ghost, { transient: true, prefix: 'translate(-50%, -50%)', size: { w: g.geo.w, h: g.geo.h }, end: land + S3.arrivalFade / rate, channels: [
              { prop: 'x', spring: handSp3, from: 0, to: to.x - from.x, timeScale: rate },
              { prop: 'y', spring: handSp3, from: 0, to: to.y - from.y, timeScale: rate },
              { prop: 'opacity', ramp: { from: 1, to: 0, delay: land, duration: S3.arrivalFade / rate } },
            ] });
            const home = () => { motion.pendingStacks.set(pi, Math.max(0, (motion.pendingStacks.get(pi) || 0) - amt)); if (motion.writeStack) motion.writeStack(pi); };
            if (entry) motion.tick(land, home, entry); else home();
          });
        });
      }

      if (motionKind === 'result' && showdownSpecialNow && showdownSpecialNow.kind === 'flush') {
        writes.push(() => playSuitFlood(motion, { table, suit: showdownSpecialNow.suit, seed: (hand.id || '') + heroCards + boardCards,
          delay: S.beat / rate, timeScale: rate / REPLAYER_PACE }));
      }
      // WRITE, once per step: however many layout passes this commit gets, a moment never runs
      // twice (an award counted into a stack twice read 0 on the plaque).
      const momentKey = motionKind + ':' + streetIdx + ':' + actionIdx + ':' + (showResult ? 1 : 0);
      if (motion.momentKey === momentKey) { resyncDigits(); record(); return; }
      motion.beginMoment(motionKind);
      motion.momentKey = momentKey;
      motion.potFloor = potFloorNow;
      /* The rendered figures go back BEFORE this moment's writes: after them, they put the new stack over the count
         that had just written the old one, so a bettor's plaque showed what was left for a frame, then what it had,
         then counted down (owner, 2026-11-22: "Hero's seat box is STILL flickering"). */
      resyncDigits();
      for (const w of writes) w();
      /* Render subtracted what it expected to fly; if nothing could (no layer, no element to copy),
         one render puts the full figures back. */
      const planned = motion.pendingPot > 0 || motion.pendingStacks.size > 0;
      if (((sweepPlan && sweepPlan.length) || (shipPlan && shipPlan.length) || foldSweep || (uncalledBack && uncalledBack.some(v => v > 0))) && !planned) setMotionRender(n => n + 1);
      record();
    } finally {
      motion.inCommit = false;
    }
  });


  /* The light sits at the felt's specular pool. A shadow points away from it,
     and grows with the distance — the aspect correction is the same one the
     bet chips use, because a percentage of height is not a percentage of
     width on a 3:4.5 box. */
  const castStyle = (pos) => {
    const AR = 4.5 / 3;
    const dx = pos[0] - 50, dy = (pos[1] - 44) * AR;
    const len = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, len / 46);
    return {
      '--cast-x': (dx / len * reach * 3.2).toFixed(1) + 'px',
      '--cast-y': (1.2 + Math.max(-0.4, dy / len) * reach * 3.4).toFixed(1) + 'px',
      '--cast-blur': (3 + reach * 4).toFixed(1) + 'px',
    };
  };

  // Pot shows as text on the felt now (no plaque), so it needs a colour that
  // reads on the cloth. Only the default theme uses the felt picker; the named
  // themes carry their own pot colour in CSS, so leave those alone. Contrast is
  // measured against the felt's LIT stop — the centre of the cloth, under the
  // pot — because a bright felt can run light enough (band tops out near 0.52)
  // to need black text.
  const potContrast = (() => {
    if (rSettings.theme !== 'default') return null;
    // Always white, with a dark drop shadow — legible on any felt colour the
    // picker lands on, light or dark, rather than flipping to black on a pale
    // felt (Ethan). The shadow is what carries the contrast on a light cloth.
    return { '--pot-text': '#ffffff', '--pot-shadow': '0 calc(var(--subrow) * 0.125) calc(var(--subrow) * 0.25) rgba(0,0,0,0.9), 0 0 calc(var(--subrow) * 0.625) rgba(0,0,0,0.55)' };
  })();

  /* ── The seats' words (Replayer animations 55, 58, 63, 66, 71) ── */
  // 58: an all-in that another live player covers reads AT RISK once the call has closed the action (tournaments).
  const atRiskSeats = (() => {
    const out = new Set();
    if (!springSet || hand.gameMode === 'cash' || showResult || !decidedNow || actionIdx < currentActions.length - 1 || !laterEmpty(streetIdx)) return out;
    const live = hand.players.map((_, i) => i).filter(i => !folded.has(i));
    const start = (i) => Number(hand.players[i]?.startingStack) || 0;
    live.forEach(i => { if (allIn.has(i) && stacks[i] <= 0 && live.some(j => j !== i && start(j) >= start(i))) out.add(i); });
    return out;
  })();
  // 63: a tournament seat that lost everything reads OUT once the pot has gone (cash: 0).
  const bustedAtResult = (pi) => springSet && showResult && potAwards && allIn.has(pi) && shownStacks[pi] <= 0 && !(potAwards[pi] > 0);
  // 55: a Check (or any answer) made before the street's latest bet or raise is stale until the seat acts again.
  const lastAggIdx = (() => { let k = -1; for (let ai = 0; ai <= actionIdx && ai < currentActions.length; ai++) if (['bet', 'raise', 'all-in'].includes(currentActions[ai].action)) k = ai; return k; })();
  // 66: in stud the seat that acts first on a street says why, until it acts.
  const studFirstNote = (() => {
    if (!springSet || !gameCfg.isStud || showResult || actionIdx >= 0) return null;
    const first = currentActions[0];
    if (!first) return null;
    const pi = first.player;
    const ups = (() => {
      if (pi === replayHeroIdx) return parseCardNotation(heroCards).slice(2, 6).filter(c => c.suit !== 'x');
      const oppSlot = pi > replayHeroIdx ? pi - 1 : pi;
      const out = [];
      for (let si = 0; si <= Math.min(streetIdx, 3); si++) {
        const cs = parseCardNotation((hand.streets[si]?.cards.opponents || [])[oppSlot] || '').filter(c => c.suit !== 'x');
        if (cs.length) out.push(si === 0 ? cs[cs.length - 1] : cs[0]);
      }
      return out;
    })();
    if (!ups.length) return null;
    /* Not "brings in": the low card may bring it in or complete (owner, 2026-11-22: "since the low card has the option to
       complete let's say action starts on the 3c instead of 3c brings in"). */
    if (streetIdx === 0 || first.action === 'bring-in') return { seat: pi, text: 'Action starts on the ' + ups[0].rank + ups[0].suit };
    const counts = {};
    ups.forEach(c => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
    const RW = { A: 'Aces', K: 'Kings', Q: 'Queens', J: 'Jacks', T: 'Tens', 9: '9s', 8: '8s', 7: '7s', 6: '6s', 5: '5s', 4: '4s', 3: '3s', 2: '2s' };
    const HW = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: 'Ten' };
    const order = 'AKQJT98765432';
    const groups = Object.entries(counts).sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
    let what;
    if (groups[0][1] >= 3) what = 'Three ' + RW[groups[0][0]];
    else if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) what = 'Two Pair';
    else if (groups[0][1] === 2) what = 'Pair of ' + RW[groups[0][0]];
    else { const hi = ups.map(c => c.rank).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]; what = (HW[hi] || hi) + '-high'; }
    return { seat: pi, text: what + ' acts first' };
  })();
  // 71: a tabled run-out names every live hand as it stands; the hand in front at full strength, the rest quieter.
  const runoutNames = (() => {
    if (!springSet || !exposeAllIn || showResult || category !== 'community' || boardCount(hand) > 1) return null;
    const cfg = gameEvalFor(hand.gameType, hand);
    if (!cfg || cfg.type !== 'high') return null;
    const board = parseCardNotation(boardCards).filter(c => c.suit !== 'x');
    const live = hand.players.map((_, i) => i).filter(i => !folded.has(i));
    const hands = live.map(pi => ({ seat: pi, cards: parseCardNotation(pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '')).filter(c => c.suit !== 'x') }));
    if (hands.some(h => h.cards.length < 2)) return null;
    const lead = leaderOf(cfg, hands, board);
    const RW = { A: 'Aces', K: 'Kings', Q: 'Queens', J: 'Jacks', T: 'Tens', 9: '9s', 8: '8s', 7: '7s', 6: '6s', 5: '5s', 4: '4s', 3: '3s', 2: '2s' };
    const out = new Map();
    hands.forEach(h => {
      let text;
      const r = bestFive(cfg, h.cards, board, 'high');
      if (r) text = r.ev.shortName || r.ev.name;
      else if (h.cards.length >= 2 && h.cards[0].rank === h.cards[1].rank) text = 'Pair of ' + RW[h.cards[0].rank];
      else { const order = 'AKQJT98765432'; const hi = h.cards.map(c => c.rank).sort((a, b) => order.indexOf(a) - order.indexOf(b)); text = hi[0] + '-' + hi[1] + ' high'; }
      out.set(h.seat, { text, lead: h.seat === lead });
    });
    return out;
  })();

  // A street's draw lands AFTER its betting — the same instant the d1/d2/pat
  // badge appears — so the discard lift is gated on the identical condition the
  // badge uses, and the two move together.
  const drawStreetActionCount = (hand.streets[streetIdx]?.actions || []).length;
  const drawDoneThisStreet = isDrawGame && actionIdx >= drawStreetActionCount - 1;

  /* Known dead cards, for games with no board: what the hero can SEE is out of
     play. Stud - a folded player's up cards (the opponent strings ARE their up
     cards, accumulated by street) and every card of the hero's own if the hero
     folded. Draw - each recorded discard, from the moment its draw is announced
     (the end of the street it is recorded on), and the hero's hand if the hero
     folded; an opponent's discards count only where the hand records them.
     Face-down cards ('x') are never dead-known. De-duplicated, then sorted by
     rank and suit (sortDeadCards: low to high in lowball). */
  const deadCards = (() => {
    if (category !== 'stud' && (!isDrawGame || category === 'community')) return [];
    const out = []; const seen = new Set();
    const add = (str) => { for (const c of parseCardNotation(str || '')) { const k = c.rank + c.suit; if (c.suit !== 'x' && !seen.has(k)) { seen.add(k); out.push(k); } } };
    if (isDrawGame) {
      for (let si = 0; si <= streetIdx && si < hand.streets.length; si++) {
        if (si === streetIdx && !drawDoneThisStreet) break;
        for (const d of (hand.streets[si].draws || [])) if (d && d.discarded > 0 && d.discardedCards) add(d.discardedCards);
      }
      if (folded.has(replayHeroIdx)) add(heroCards);
    } else {
      hand.players.forEach((_, pi) => {
        if (!folded.has(pi)) return;
        add(pi === replayHeroIdx ? heroCards : opponentCards[pi]);
      });
      // Super: the hero's two thrown cards are out of play from 4th street on.
      if (hand.superStud && streetIdx >= 1) add(hand.streets[0]?.cards.heroThrown);
    }
    return sortDeadCards(out, hand.gameType, category);
  })();

  return (
    /* 77: isLandscape was computed at mount and kept current by a live
       matchMedia listener, and then referenced nowhere — so forty lines of
       fullscreen CSS (fixed inset, modal layer, app chrome hidden through a
       :has() rule) could never fire, and turning the phone sideways just
       letterboxed the table. */
    <div className={'replayer-replay' + hcDeckClass
      + (isLandscape ? ' replayer-landscape' : ' replayer-fullbleed')
      + (inPane ? ' replayer-in-pane' : '')
      + (rewinding ? ' is-rewinding' : '')}>
      {showSettings && <ReplayerSettingsPanel onClose={() => setShowSettings(false)} settings={rSettings} onUpdate={handleSettingsUpdate} />}

      {/* Table settings: the felt and splay controls on the replay screen
          itself, so a change is judged against the live table. Top-right,
          over the stadium's empty corner; the gear keeps the full panel. */}
      {(notes || (!drill && onSaveExtras)) && (
        <span className="hx-chips">
          {notes && <NotesChip notes={notes} />}
          {!drill && onSaveExtras && <>
          <button type="button" className="replayer-notes-chip ctl hx-chip" onClick={() => setNoteEditing(true)}><span>{noteAt(hand, streetIdx, actionIdx) ? 'Edit note' : 'Note here'}</span></button>
          <button type="button" className="replayer-notes-chip ctl hx-chip" onClick={() => setDetailsOpen(true)}><span>{(hand.tags && hand.tags.length) ? `Tags · ${hand.tags.length}` : 'Tags'}</span></button>
          </>}
        </span>
      )}
      {!drill && tableEl && createPortal(
        <MomentBubble ref={noteBubbleRef} note={noteAt(hand, streetIdx, actionIdx)} onOpen={onSaveExtras ? () => setNoteEditing(true) : null}
          onContinue={canGoForward ? () => setPlaying(true) : null} />,
        tableEl)}
      {!drill && <NoteTrack hand={hand} streetIdx={streetIdx} onJump={(si, ai) => { setPlaying(false); setStreetIdx(si); setActionIdx(ai); }} />}
      {noteEditing && onSaveExtras && (
        <NoteSheet initial={(noteAt(hand, streetIdx, actionIdx) || {}).text || ''}
          where={`${((hand.streets || [])[streetIdx] || {}).name || 'This street'}, after action ${actionIdx + 1}`}
          onClose={() => setNoteEditing(false)}
          onSave={(text) => {
            const rest = (hand.annotations || []).filter((n) => !(n.street === streetIdx && n.action === actionIdx));
            onSaveExtras({ annotations: text ? [...rest, { street: streetIdx, action: actionIdx, text }] : rest });
          }} />
      )}
      {detailsOpen && onSaveExtras && (
        <DetailsSheet hand={hand} token={token} allTags={allTags} onClose={() => setDetailsOpen(false)} onSave={(patch) => onSaveExtras(patch)} />
      )}
      {sendOpen && token && (
        <SendHandSheet token={token} toast={toast} title={hand.title || null} step={streetIdx} onClose={() => setSendOpen(false)} mintLink={() => mintHandLink(false)} />
      )}
      {question && !question.answered && (
        <QuestionCard linkId={question.linkId} token={token} answered={false}
          onAnswered={(choice, tally) => { if (onQuestionAnswered) onQuestionAnswered(choice, tally); }} />
      )}
      {question && question.answered && question.tally && tallyOpen && (
        <QuestionCard linkId={question.linkId} answered tally={question.tally} onContinue={() => { setTallyOpen(false); setPlaying(true); }} />
      )}
      <button ref={quickBtnRef} className={'replayer-quick-btn' + (showQuick ? ' is-open' : '')}
        aria-label="Table settings" aria-expanded={showQuick} aria-haspopup="dialog"
        onClick={() => setShowQuick(v => !v)}>
        <Icon.sliders />
      </button>
      {showQuick && <TableQuickSettings anchorRef={quickBtnRef} onClose={closeQuick} settings={rSettings} onUpdate={handleSettingsUpdate} onAll={() => setShowSettings(true)} />}

      {/* Table */}
      {/* Polish 97 pushed the table toward the acting seat on every step. In a
          still frame that reads as a camera move; in use it is the table
          sliding under you while you are trying to read it, and a transformed
          box no longer matches its own layout, so the page gained and lost
          scroll as the hand played. Reverted — a replay is something you
          study, and it holds still. */}
      <div className="replayer-table-slot">
      <div ref={tableRef} className={'replayer-table' + themeClass}
        /* How many cards a hand ENDS with, so the card size is a property of
           the game rather than of how far the deal has got. Sizing off the
           cards currently on the table shrank them when the 6th arrived, so a
           stud hand changed size halfway through. */
        data-hand-cards={gameCfg.heroCards || 2}
        /* Community games have the central board that sits over the wordmark;
           the export moves the wordmark clear of it only when this is set. */
        data-community={gameCfg.hasBoard && !gameCfg.isStud ? '1' : '0'}
        /* How many seats: a full table on a short phone sizes every seat's cards down together (styles.css). */
        data-seats={hand.players.length}
        /* Cards lying flat (Card splay off): a stud row lays its face-down cards tucked (styles.css). */
        data-flat={rSettings.cardSplay ? undefined : '1'}
      data-anim-winner={rSettings.animateWinner ? '1' : '0'}
      data-felt={rSettings.feltBright ? 'bright' : 'dark'}
      data-springs={springOn ? springSet : undefined}
        style={(() => {
          const s = { ...(potContrast || {}) };
          s['--card-overlap'] = String((Number(rSettings.cardOverlap ?? 52) || 0) / 100);
          /* Catalogue three, idea 15 (2026-10-15): on coloured cloth a shadow takes the cloth's colour.
             The felt's shade stop, darkened, as an r,g,b triple the cast shadows use in rgba() (no
             color-mix: the video exporter cannot parse it). Named themes keep black (no triple). */
          if (rSettings.theme === 'default') {
            const st = feltStops(feltColor, rSettings.feltBright);
            const m = st && /rgb\((\d+),(\d+),(\d+)\)/.exec(st.shade);
            if (m) s['--shadow-rgb'] = [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * 0.45)).join(', ');
          }
          return Object.keys(s).length ? s : undefined;
        })()}>
        {/* Only the default theme takes its rail from the felt picker; the
            themes now bring their own, so handing feltColor in would override
            them with whatever colour happened to be stored. */}
        <div className="replayer-table-rail"
          /* The rail takes the felt's SHADE stop, not the raw picked colour.
             It used to take the colour at full value, which was fine while the
             cloth was bright — but against a dark felt that is a lit ring
             around a dark table, the reverse of what it should be. Casino
             Royale's rail measures 20.5 against its felt's rim of 18.7: the
             frame is the cloth's own darkest tone, and the only thing making
             it read as padding is the lighting already on it. Still derived
             from the felt, so the picker still moves both. */
          style={rSettings.theme === 'default'
            ? {'--rail-color': (feltStops(feltColor, rSettings.feltBright) || {}).shade || feltColor}
            : undefined} />
        {/* --strip-color was handed in and the rule never read it - a dead
            property alongside the dead four-color-deck class. The strip now
            takes its tint from the felt, which is what the prop intended. */}
        {rSettings.lightStrip && (
          <div className="replayer-light-strip"
            style={rSettings.theme === 'default' ? {'--strip-color': feltColor} : undefined} />
        )}
        {/* Felt — wrap in a <label> so a tap on the felt opens the native
            color picker directly (mirrors TableScanner). The hidden color
            input lives inside the label and receives the native picker
            event; no popup, no extra UI. */}
        {/* The stops go through custom properties rather than a composed
            background string, so the felt rule keeps its own gradient geometry
            and the picker only supplies the two colours. */}
        <label className={'replayer-table-felt' + shapeClass} style={rSettings.theme === 'default' ? (() => {
          const st = feltStops(feltColor, rSettings.feltBright);
          if (!st) return { borderColor: feltColor + 'cc' };
          return { '--felt-lit': st.lit, '--felt-shade': st.shade, borderColor: feltColor + 'cc' };
        })() : {}}
          title={rSettings.theme === 'default' ? 'Tap to change felt color' : undefined}>
          {/* The themed backgrounds carry !important, so on any non-default
              theme picking a colour updated state and changed nothing — while
              the felt kept its pointer cursor, its tooltip and its native
              colour picker. An affordance that silently no-ops teaches people
              the table is broken. */}
          {rSettings.theme === 'default' && <input type="color" value={feltColor}
            onChange={e => rSetters.feltColor(e.target.value)}
            style={{position:'absolute', inset:0, opacity:0, cursor:'pointer', border:'none', padding:0, background:'transparent', width:'100%', height:'100%'}} />}
        </label>

        {/* Pot */}
        {(() => {
          const splitters = showResult ? halvedWinners.filter(w => w.split) : [];
          const isSplitResult = splitters.length >= 2;
          const halfLabels = (gameEval && gameEval.labels) || ['Hi', 'Lo'];
          // More than one pot paid out (an all-in): its pills name the pot, not a share of the whole.
          const sidePots = !!(potAwards && potAwards.parts && new Set(potAwards.parts.map(p => p.layer)).size > 1);
          /* The split display used to REPLACE the pot with a different object:
             its own dark lozenge carrying gold discs, no total, no side pots,
             a shape that appears nowhere else on the table — and it did that
             at the one step where the pot is the whole point. The pot row is
             the pot row at every step now; a split only relabels the total
             cell and hangs the shares under it. */
          /* Main and side pots: their own row, placed under the board by the layout effect beside the wagers', not a
             second row in the pot's box (owner, 2026-11-15: collisions). Two rows had no room between a top seat and
             the board: the box ran into the board's cards and into the seats beside it. The total stays the pot. */
          const layersRow = potLayers.length > 1 ? (
            <div className="replayer-pot-layers is-placed">
              <div className="replayer-pot-pill">
                <span className="replayer-pot-cell-label">Main</span>
                {fmtChips(potLayers[0].amount)}
              </div>
              {/* Never a layer dropped (App improvements 153): with five or more pots the fourth pill
                  carries Side 3 and every pot after it, "+ More", so the pills add up to the total. */}
              {(potLayers.length <= 4 ? potLayers.slice(1) : potLayers.slice(1, 3)).map((layer, i) => (
                <div key={i} className="replayer-pot-pill" title={layer.eligible + '-way'}>
                  <span className="replayer-pot-cell-label">
                    {potLayers.length > 2 ? 'Side ' + (i + 1) : 'Side'}
                  </span>
                  {fmtChips(layer.amount)}
                </div>
              ))}
              {potLayers.length > 4 && (
                <div className="replayer-pot-pill" title={potLayers.slice(3).map((l, k) => `Side ${k + 3}: ${l.amount} (${l.eligible}-way)`).join(', ')}>
                  <span className="replayer-pot-cell-label">+ More</span>
                  {fmtChips(potLayers.slice(3).reduce((a, l) => a + (Number(l.amount) || 0), 0))}
                </div>
              )}
            </div>
          ) : null;
          const potRow = (
            <div className="replayer-pot-row">
              {/* Chips lead the row rather than sitting above it. Above, they
                  were the only part of the pot with a vertical footprint, and
                  once the row moved to the reference's height they were what
                  reached the top seat's plaque — 121x12px of it at 6-max. The
                  reference has no chips by the pot at all; in the row they
                  cost no height, because the total cell is taller than they
                  are. Left to right it still reads as the physical thing,
                  then what it is called, then what it counts to. */}
              {/* Not at a split. The shares row costs 41px of height at
                  1600x1000 and the pot with its stacks already sits 24px off
                  the board there — with both, the gap measured 4px. The chip
                  cell is the half of the pot that is a picture of what the
                  number already says, and this is the one step where the
                  number has a second line to carry. */}
              {/* (Main and side pots: layersRow, under the board.) */}
              <div className="replayer-pot-main">
                {/* Above the pot figure: the SPR as plain text, then the chip stack. One
                    positioned column (in portrait) so the SPR rides on top of however tall
                    the stacks are, and sits just over the figure when there are none. */}
                {(() => {
                  const spr = rSettings.showSPR ? calcSPR(hand, streetIdx, actionIdx) : null;
                  const chips = rSettings.showChipStacks && displayPot > 0 && !isSplitResult;
                  if (!spr && !chips) return null;
                  return (
                    <div className="replayer-pot-above">
                      {spr && <div className="replayer-spr">SPR {spr}</div>}
                      {/* shownPot: the model's pot less the swept wagers still in flight (the
                          spring path); displayPot itself everywhere else. */}
                      {chips && (springOn && !potLayers.length
                        ? <PotChipLive amount={PILE_IS_WHOLE_POT ? potCommitted : shownPot} motion={motion} set={springSet} shipped={pileShipped} />
                        : <PotChipVisual amount={potLayers.length ? potLayers[0].amount : (PILE_IS_WHOLE_POT ? potCommitted : (shownPot || displayPot))} />)}
                    </div>
                  );
                })()}
                {/* The figure is the last child, a bare text node: each wager's arrival writes
                    its digits there directly (motion.writePot) rather than re-rendering. */}
                <div className="replayer-pot-total" ref={potTotalRef}>
                  <span className="replayer-pot-cell-label">
                    {isSplitResult ? 'Split' : (potLayers.length > 1 ? 'Total' : 'Pot')}
                  </span>
                  {fmtChips(potCommitted)}
                </div>
              </div>
            </div>
          );
          if (isSplitResult) {
            /* One cell per distinct SHARE, not one per winner. The old row was
               one disc per winner capped at .slice(0, 3), so a four-way split
               drew three discs and a nine-way split drew three — the graphic
               stated the wrong number of winners. It could not simply draw all
               of them either: measured at 6-max portrait (393x852, table
               373x742) the clear band between the innermost side furniture
               across the pot's own row is 162px and three discs already
               measured 165, 2px INTO the seat on each side. Grouping is what
               makes the row bounded: an even split is one cell however many
               players are in it, and a hi/lo is two.

               "Distinct" means a distinct AWARD, which is why quartering has
               to reach this row rather than be flattened by it: 3/4 and 1/4
               are two different amounts and so they are two different cells.
               Grouping on the winner COUNT — the thing #94 removed from the
               amount — would have drawn a quartered pot as one "2x 1/2". */
            const evenAmt = Math.floor(pot / splitters.length);
            /* The fraction is of what was AWARDED (2026-10-15). \`pot\` counts every chip committed,
               an uncalled bet included, which goes back to its owner rather than into anyone's share:
               a 2,000 pot split three ways with 1,000 returned read "2/9" on each 667 (667 / 3,000). */
            const awardedTotal = potAwards ? Object.values(potAwards).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
            const shareBase = awardedTotal > 0 ? awardedTotal : pot;
            const groups = [];
            splitters.forEach(w => {
              /* #94 recorded which half each winner took as flags, so the
                 tag is read rather than parsed back out of the label text. */
              let tag = '';
              /* The halves this seat was PAID across every pot (wonHalves), not the main pot's reading: an all-in's
                 side pot went to a seat flagged with no half, and its pill read "9%" (owner, 2026-11-14). */
              const hiW = wonHalves && wonHalves.hi ? wonHalves.hi.has(w.playerIdx) : w.hi;
              const loW = wonHalves && wonHalves.lo ? wonHalves.lo.has(w.playerIdx) : w.lo;
              const halved = halfLabels.length > 1 && (gameEval && (gameEval.type === 'hilo' || gameEval.type === 'halves'));
              if (halved && hiW) tag = halfLabels[0];
              if (halved && loW) tag = tag ? halfLabels.join('+') : halfLabels[1];
              if (wonHalves && wonHalves.side && wonHalves.side.has(w.playerIdx)) tag = ('Side ' + tag).trim();
              /* potAwards is the authority on what anyone is paid: it settles
                 each pot layer among its own eligible seats, halves a hi-lo
                 layer before dividing either half, and places the odd chips.
                 The graphic only NAMES that number and the fraction of the pot
                 it is.

                 It can be absent for a seat. `awards` is keyed only by seats
                 that actually won a half of some layer, so a winner marked by
                 hand who is eligible for no layer has no entry — and the memo
                 itself returns null before the result is shown or with no
                 winners recorded, neither of which can be true here. The
                 fallback is the equal split the display assumed before #94,
                 kept as Math.floor(pot / n) and never pot * (1 / n), which is
                 a chip light wherever 1/n has no exact binary form. */
              const amt = potAwards && potAwards[w.playerIdx] != null ? potAwards[w.playerIdx] : evenAmt;
              const share = shareBase > 0 ? amt / shareBase : 1 / splitters.length;
              const name = w.playerIdx === replayHeroIdx ? 'Hero' : (hand.players[w.playerIdx]?.name || 'Player');
              const key = tag + '|' + amt;
              const found = groups.find(g => g.key === key);
              if (found) { found.n += 1; found.names.push(name); }
              else groups.push({ key, tag, amt, share, n: 1, names: [name] });
            });
            /* The figure stays where the pot always is; the shares are their own row under the board (placed by
               the layout effect beside the wagers'). Hung in the pot's box they made it two rows tall, and there is
               room for one between a top seat and the board: centred they ran into the board's cards, hung above
               the board into the top seat's readout (owner, 2026-11-15: "still colliding"). */
            return (
              <>
              <div className="replayer-pot-display replayer-split-pot">
                {potRow}
              </div>
                {layersRow}
                <div className="replayer-split-shares is-placed">
                  {groups.map((g, i) => {
                    /* "2x HI 1/4" — how many players, which half of a hi/lo,
                       and what fraction of the pot each one took. A quarter
                       and a three-quarter award look nothing alike here,
                       where four discs reading the same number looked
                       identical whatever anyone was actually paid. */
                    /* With side pots a share of the whole is no fraction anyone says ("41%", "9%"): the half and the
                       pot name it instead. */
                    const cap = [g.n > 1 ? g.n + '×' : '', g.tag, sidePots ? '' : formatShareFraction(g.share)]
                      .filter(Boolean).join(' ');
                    return (
                      <div key={i} className="replayer-split-share" title={g.names.join(', ')}>
                        {cap && <span className="replayer-split-share-frac">{cap}</span>}
                        {fmtChips(g.amt)}
                      </div>
                    );
                  })}
                </div>
              </>
            );
          }
          return (
            <>
            <div className={'replayer-pot-display' + (animPotCollect ? ' anim-collect' : '')
              + (potLanding ? ' is-landing' : '') + (potLayers.length ? ' has-sides' : '')
              /* 48: at the result the pot has gone to its winners: its figure counted down and went. */
              + (springSet && showResult && potAwards && rSettings.animateChips && !potLayers.length ? ' is-emptied' : '')}>
              {potRow}
            </div>
            {layersRow}
            </>
          );
        })()}

        {/* Board */}
        {feltBoard && (() => {
          const parsed = parseCardNotation(boardCards);
          if (parsed.length === 0) return null;
          /* Several boards (owner, 2026-10-20): double board, or a hand run twice or three times. The
             first board is the row the deal animations play on; the others stack under it, cards a
             size smaller so the stack still clears the seats. A run repeats the shared streets. */
          /* A hand run twice is ONE board until the runs begin (Replayer animations 13): a second row that
             repeats the first is not drawn while the board is still being dealt, and parts from it at the first
             run-out card. A double board is two boards from the flop. */
          /* Once a hand's runs have begun, each run is its own row, and a card a run was dealt that the hand does not
             say ("run it twice, brick brick") lies face down in its place, so every run shows its river (owner,
             2026-11-19: "we don't see two rivers"; a second row that read the same as the first was never drawn). */
          /* A later run's row holds only that run's cards, under run 1's, never the shared streets again (owner,
             2026-11-20: "we don't need two rows of the cards before running it twice"); before the runs begin there
             is one row. A double board is two boards from the flop. */
          const runs = runRows(hand, streetIdx);
          const unknownOwn = runs ? runs[0].filter(c => c == null).length : 0;
          const skip = runs ? runs.shared : 0;
          const extra = runs ? runs.slice(1).map(r => r.slice(skip))
            : hand.doubleBoard ? handBoards(hand, streetIdx).slice(1).map(b => parseCardNotation(b)).filter(b => b.length) : [];
          const renderCard = (c, i, key, withSlot) => {
            if (c == null) return <img key={key} data-xk={key} className="card-img is-run-unknown" src={unknownCardFaceSrc()} alt="A card the hand does not record" loading="eager" />;
            const slot = withSlot ? { 'data-slot': i, 'data-ck': key } : { 'data-xk': key };
            const pose = withSlot && cardPoses ? cardPoses.board.get(c.rank + c.suit) : undefined;
            /* A board card with its rank and no suit ("Kx") shows its rank (utils/card-faces.js rankOnlyFaceSrc): it was
               drawn face down, and a river the hand records read as one never dealt (owner, 2026-11-16). */
            if (c.suit === 'x') return <img key={key} {...slot} data-pose={pose || undefined} className="card-img is-rank-only" src={rankOnlyFaceSrc(c.rank)} alt={c.rank + ', suit not recorded'} loading="eager" />;
            return <img key={key} {...slot} data-pose={pose || undefined} className="card-img" src={cardFaceSrc(c.rank + c.suit)} alt={c.rank + c.suit} loading="eager" />;
          };
          const unit = hand.doubleBoard ? 'Board' : 'Run';
          const tags = extra.length ? boardWinnerTags() : null;
          const tag = (i) => (tags && tags[i] ? <span className="replayer-board-winner">{tags[i]}</span> : null);
          return (
            <div className={'replayer-board-area' + boardAnimClass + (springOn ? ' is-sprung' : '') + (extra.length ? ' is-multi' + (extra.length > 1 ? ' is-multi-3' : '') : '')}>
              {/* 24: .replayer-street-label, its pop keyframe and three theme
                  overrides all existed, an effect set and cleared animStreetLabel
                  on a 450ms timer — and no JSX ever emitted the element, so the
                  animation ran against a DOM node that was never there and the
                  only street context during replay was the prose below the
                  table. It renders under the board rather than at the CSS's
                  top:28%, where it would have sat on the pot eyebrow. */}
              <div className="card-row replayer-board-spaced" ref={boardRowRef} aria-label={extra.length ? unit + ' 1' : undefined}>
                {parsed.map((c, i) => renderCard(c, i, c.rank + c.suit + '_' + i, true))}
                {Array.from({ length: unknownOwn }, (_, i) => renderCard(null, parsed.length + i, 'unknown_' + i, false))}
                {tag(0)}
              </div>
              {extra.map((b, bi) => {
                const own = b.map((c, i) => renderCard(c, i, 'b' + (bi + 2) + '_' + (c ? c.rank + c.suit : 'unknown') + '_' + i, false));
                return (
                  <div key={'board-' + (bi + 2)} className="card-row replayer-board-spaced replayer-board-extra" aria-label={unit + ' ' + (bi + 2)}>
                    {skip > 0 ? (
                      /* Under run 1's own cards: the row keeps the board's width, the shared cards' places left empty, and
                         the tag sits beside these cards, not beside the empty places. */
                      <span className="replayer-run-cards" style={{ marginLeft: `calc((var(--card-w) + var(--board-gap, var(--space-2xs))) * ${skip})` }}>
                        {own}{tag(bi + 1)}
                      </span>
                    ) : <>{own}{tag(bi + 1)}</>}
                  </div>
                );
              })}
            </div>
          );
        })()}


        {/* (Known dead cards sat here, in the board's slot on the landscape felt, until 2026-11-22: owner, "dead cards on
            desktop should not be on the felt". Every layout shows them in the strip under the table, below.) */}

        {/* Polish 38 drew a deck and a muck pile on the felt, so the deal
            and the muck had somewhere to come from and go to. At the table
            sizes this app actually records there is no room for them: a full
            ring has no gap at the rail, so wherever they went they landed on
            a neighbour's fan. Removed after seeing it. dealerSpot survives as
            the point the deal animation flies FROM, which was the useful
            half of the idea. */}

        {/* 87: the hand's title and its stakes lived in .replayer-header,
            ABOVE the table and outside the captured element — so every export,
            every screenshot and every share was a table with no context at all
            beyond a 10%-opacity wordmark. The exports are the version of this
            most people will ever see. */}


        {/* 94: hand.blinds carries sb, bb and ante and none of them appeared
            anywhere on the felt — so a stack of 24,000 had no meaning without
            opening the hand's title, which makes every stack number on the
            table meaningless. It is one line of data that already exists.

            95: and a saved hand from a tournament has a place IN one. The
            difference between "a big pot" and "a big pot on the money bubble"
            is the whole reason a hand is worth revisiting. */}
        {/* 87 + 94 + 95, together and in one place. These were a plate in the
            top-left corner and a plate in the bottom-right, which is where a
            broadcast puts a bug — not where a poker client puts the state of
            the tournament. One quiet block on the cloth under the board, no
            plate behind it, so it reads as part of the table. It is still
            inside the captured element, which is the whole reason 87 put the
            title on the felt in the first place. */}
        {(() => {
          const b = hand.blinds || {};
          /* The game, named the way the room names it, in front of the sizes
             that were already here. A fixed-limit game is called by its two BET
             sizes — a 200/400 stud game — not by a small blind, which stud does
             not even have: this line used to read "100 / 200" on a stud hand,
             where 100 was an sb nothing posts. */
          const limitGame = gameCfg.betting === 'fl';
          const bigB = b.bigBet || (b.bb || 0) * 2;
          // A straddle is a live blind and belongs in the stakes line: 10/10/20.
          const straddleAmt = getStraddles(hand.players, b).reduce((m, s) => Math.max(m, s.amount || 0), 0);
          const sizes = b.bb ? formatStakes(hand, { straddle: limitGame ? 0 : straddleAmt }) : null;
          void bigB;
          // SPR moved to plain text above the pot's chip stack (2026-09-30).
          /* No street here (owner, 2026-10-15): the board itself says which street it is. */
          // A hand with several boards says so on the felt (owner, 2026-10-21).
          // Running it twice is not the game (owner, 2026-11-20): the rows say it; a double board is.
          const boardsTag = hand.doubleBoard ? 'Double board' : null;
          const named = [superName(hand, hand.gameType), boardsTag].filter(Boolean).join('  ·  ');
          const level = [named, sizes].filter(Boolean).join('  ·  ');
          /* A long line takes two on a portrait table, game over stakes, with no dot left hanging: at
             one line the pill's width cut the stakes to "100/20...". */
          const levelLong = !!(named && sizes) && level.replace(/\s+/g, ' ').length > 26;
          const meta = [
            hand.playersLeft ? hand.playersLeft + ' left' : null,
            hand.payoutNote || null,
          ].filter(Boolean).join(' \u00b7 ');
          /* No hand title here (owner, 2026-11-13: "We also do not need the hands in the middle of the felt"): the
             title is the saved row's and the share sheet's, not the table's. */
          if (!level && !meta) return null;
          return (
            <div className="replayer-table-info">
              {level && (levelLong
                ? <span className="replayer-level-blinds is-long">{named}<span className="replayer-level-sep">{'  ·  '}</span>{sizes}</span>
                : <span className="replayer-level-blinds">{level}</span>)}
              {meta && <span className="replayer-level-meta">{meta}</span>}
            </div>
          );
        })()}

        {/* 96: the replay opened on the first street already dealt and ended
            on the showdown frame, so an exported clip started mid-scene and
            stopped dead. Every clip that gets shared needs a first frame that
            explains itself and a last frame that resolves. These are gated on
            [data-capturing] in CSS — on screen they would be in the way, and
            in an export they land in exactly the first and last frames,
            because that is where the exporter starts and stops. */}
        <div className={'replayer-bookend is-open' + (streetIdx === 0 && actionIdx < 0 && !showResult ? ' is-live' : '')}>
          <span className="replayer-bookend-eyebrow">{superName(hand, hand.gameType)}{(hand.blinds || {}).bb ? ' \u00b7 ' + formatChipAmount(hand.blinds.sb) + '/' + formatChipAmount(hand.blinds.bb) : ''}</span>
          <span className="replayer-bookend-title">{hand.title || 'Hand replay'}</span>
          {heroCards && <span className="replayer-bookend-cards"><CardRow text={heroCards} max={gameCfg.heroCards} /></span>}
          <span className="replayer-bookend-sub">{hand.players.length}-handed</span>
        </div>
        <div className={'replayer-bookend is-close' + (showResult ? ' is-live' : '')}>
          <span className="replayer-bookend-eyebrow">Result</span>
          <span className="replayer-bookend-title">
            {(evalResult && evalResult[0]?.result?.text) || 'Hand complete'}
          </span>
          <span className="replayer-bookend-sub">{fmtChips(displayPot)} pot</span>
        </div>

        {/* Watermark */}
        {/* Moved off 66%: the tournament block is printed on the cloth there
            now, and that is content where this is decoration. Under the pot,
            where being partly behind the board is what a watermark is for. */}
        <div className="replayer-watermark">futurega.me</div>

        {/* Player seats */}
        {hand.players.map((p, pi) => {
          const pos = seats[pi] || [50, 50];
          const rawCards = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
          let cards = (pi === replayHeroIdx || showResult || exposeAllIn) ? (rawCards === 'MUCK' ? '' : rawCards) : '';
          // Draw hands in rank order, BEFORE discardIdx below indexes into them.
          if (isDrawGame && cards) cards = sortDrawHand(cards, hand.gameType);
          /* Draw discards: the moment this street's draw is announced (the same
             instant the d1/d2/pat badge appears), flag the cards being thrown so
             CardRow lifts them like a stud up-card and dims them. `cards` is the
             pre-draw hand entering the street, so the discards are still in it to
             mark; opponents show backs, so this only ever lands on a face-up
             hand — the hero, or a shown hand at showdown. */
          let discardIdx = null;
          if (drawDoneThisStreet && cards) {
            const sd = (hand.streets[streetIdx]?.draws || []).find(d => d.player === pi && d.discarded > 0);
            if (sd) {
              const shown = parseCardNotation(cards);
              const set = new Set();
              if (sd.discardedCards) {
                const need = {};
                parseCardNotation(sd.discardedCards).forEach(c => { const key = c.rank + c.suit; need[key] = (need[key] || 0) + 1; });
                shown.forEach((c, i) => { const key = c.rank + c.suit; if (need[key] > 0) { need[key]--; set.add(i); } });
              } else {
                // No specific cards recorded — lift the same cards computeDrawHand
                // throws: the top N of the rank-ordered hand in lowball, the bottom N
                // in high draw.
                const n = Math.min(shown.length, sd.discarded);
                if (drawThrowsFromTop(hand.gameType)) { for (let i = 0; i < n; i++) set.add(i); }
                else { for (let i = shown.length - n; i < shown.length; i++) set.add(i); }
              }
              if (set.size) discardIdx = set;
            }
          }
          /* The drill's open draw: the cards marked so far lift and dim exactly as a real throw does, once the
             hand has played to its edge. */
          const drillThrow = pi === replayHeroIdx && drill && drill.discard && !playing && !canGoForward ? drill.discard : null;
          if (drillThrow && cards) {
            const set = new Set();
            parseCardNotation(cards).forEach((c, i) => { if (drillThrow.thrown.has(c.rank + c.suit)) set.add(i); });
            discardIdx = set.size ? set : null;
          }
          /* An opponent's up cards are public in stud — the door card and 4th
             through 6th sit face up on the table — and the string entered for
             an opponent IS those up cards, accumulated street by street. Only
             the two hole cards and the river are down, so 'x' fills slots 0, 1
             and 6 and the up cards take the middle, which is exactly where
             CardRow's stud layout looks for them (STUD_DOWN_IDX is {0,1,6}).
             Before this a stud opponent was a row of backs all the way to
             showdown, with public information on the table and not on screen. */
          if (gameCfg.isStud && pi !== replayHeroIdx && !folded.has(pi)) {
            /* An opponent's up cards are public: the door card and 4th through
               6th sit face up, only the two hole cards and the river are down.

               Read per STREET rather than from the accumulated string. The
               showdown step PREPENDS an opponent's hidden cards to street 0, so
               once it has been used that string is [hidden...][door] and its
               first card is not the door at all — and counting it against the
               hero's card total made the whole branch bail, which put seven
               backs in front of a seat whose up cards were all recorded. */
            const oppSlot = pi > replayHeroIdx ? pi - 1 : pi;
            const upCards = [];
            for (let si = 0; si <= Math.min(streetIdx, 3); si++) {
              const raw = (hand.streets[si]?.cards.opponents || [])[oppSlot] || '';
              if (raw === 'MUCK') break;
              const cs = parseCardNotation(raw).filter(c => c.suit !== 'x');
              if (!cs.length) continue;
              // 3rd street's LAST card is the door; anything before it was added
              // at showdown. Every later street contributes its one up card.
              upCards.push(si === 0 ? cs[cs.length - 1] : cs[0]);
            }
            const dealt = showResult
              ? (gameCfg.heroCards || 7)
              : parseCardNotation(heroCards || '').length;
            const knownAll = parseCardNotation(rawCards || '').filter(c => c.suit !== 'x').length;
            // A finished showdown with every card recorded is left alone, and so
            // is an all-in hand tabled early once every card dealt so far is known.
            const complete = showResult
              ? knownAll >= (gameCfg.heroCards || 7)
              : exposeAllIn && knownAll >= dealt;
            if (upCards.length && !complete) {
              /* A face-down card here is a RANK carrying the suit 'x':
                 parseCardNotation pairs ranks and suits by position, so a bare
                 'xx' is one card rather than two. The rank is never drawn and
                 never counted. */
              const back = 'Ax';
              cards = back.repeat(superThird ? SUPER_DOWN : 2) + upCards.map(c => c.rank + c.suit).join('')
                + (dealt >= 7 ? back : '');
            } else if (upCards.length) {
              /* A shown hand keeps every card in the slot it was dealt to (owner, 2026-11-20: no card slides at the
                 showdown). 3rd street holds the hidden cards in front of the door, newest pick first, and a save with no
                 7th-street card keeps the 7th among them, first: `h7 h2 h1 door` (docs/hand-history-io.md, the stud
                 layout). Read in that order, the 7th took the door's slot and every up card moved one slot on as the
                 hand was shown, the last into the river's down slot; and a hand tabled all in before 7th street
                 showed its 7th card early. */
              const known = (si) => parseCardNotation((hand.streets[si]?.cards.opponents || [])[oppSlot] || '').filter(c => c.suit !== 'x');
              const hidden = known(0).slice(0, -1);
              const sev = known(4)[0];
              const hole = !sev && hidden.length > 2 ? hidden.slice(1, 3) : hidden.slice(0, 2);
              const seventh = sev || (hidden.length > 2 ? hidden[0] : null);
              if (hole.length === 2) cards = [...hole, ...upCards, ...(dealt >= 7 && seventh ? [seventh] : [])].map(c => c.rank + c.suit).join('');
            }
          }
          // Super: the two down cards each player throws, dimmed from the close of 3rd street's betting, as a draw's are.
          if (superThrowNow && cards && !folded.has(pi)) discardIdx = new Set(SUPER_THROWN_IDX);
          const seatClass = getPlayerSeatClass(pi);
          const isMucked = showResult && rawCards === 'MUCK';
          const lastAct = playerLastAction[pi];
          const handName = getPlayerHandName(pi, true);
          const foldAnimClass = animFolded.has(pi) ? ' anim-fold' : '';

          const muckStyle = {};
          if (foldAnimClass) {
            /* 37: this aimed at 50%/50% — the middle of the felt, which is
               where the BOARD is, so every folded hand flew into the community
               cards. That is the one place on a poker table cards never go.
               They go to the dealer, whose position is derivable from the
               button and already known. */
            const mdx = (muckTarget[0] - pos[0]) * 1.4;
            const mdy = (muckTarget[1] - pos[1]) * 1.1;
            muckStyle['--muck-dx'] = mdx.toFixed(1) + 'px';
            muckStyle['--muck-dy'] = mdy.toFixed(1) + 'px';
            muckStyle['--muck-rot'] = (mdx > 0 ? -12 : 12) + 'deg';
          }

          return (
            /* 21: cards, plaques and the dealer button all carried the same
               generic downward blur regardless of where they sat, so an object
               at the top of the table and one at the bottom cast identically —
               which is what makes a composite read as layers rather than as a
               scene. The light is above and in front (the felt's specular pool
               is at 50% 44%); every seat now knows which way its own shadow
               falls and how long it is. */
            /* 88: the hero got the bottom seat and face-up cards, and was
               otherwise identical to the eight opponents — same plaque, same
               type, same card size. Every poker broadcast makes the featured
               player unmistakable, and it is the seat the eye returns to
               after every single action. */
            /* Side seats (the CL / CR columns) in portrait are anchored by their OUTER edge
               on the table box's edge, 1g from the screen, rather than centred on their
               column: a plaque is 8g and grows with a long name, so centring put the left
               run at 2.16..2.46g and let a long name push off the right. Anchored, a longer
               name grows inward. pos still drives the shadow and the fold origin. */
            <div key={pi} data-seat={pi} className={`replayer-seat ${seatClass}${isMucked ? ' mucked' : ''}${foldAnimClass}`
              + (pi === replayHeroIdx ? ' is-hero' : '') + (allIn.has(pi) ? ' is-allin' : '')
              + (springOn && folded.has(pi) ? ' fold-sprung' : '')
              + (pi === turnIdx ? ' active-turn' : '')
              + (bustedAtResult(pi) && hand.gameMode !== 'cash' ? ' is-out' : '')
              + (!isLandscape && pos[0] === gx(CL) ? ' seat-edge-left' : '')
              + (!isLandscape && pos[0] === gx(CR) ? ' seat-edge-right' : '')
              + (springOn && motion.shipHit && (seatClass === 'winner' || seatClass === 'split') ? ' ship-hit' : '')}
              style={{left: (!isLandscape && pos[0] === gx(CL) ? 0 : !isLandscape && pos[0] === gx(CR) ? 100 : pos[0]) + '%', top: pos[1] + '%', ...muckStyle, ...castStyle(pos), ...foldOrigin(pos),
                /* When this winner's plaque takes its gold: the first shipped chip's landing (the
                   glow), and a frame before it (the plaque's own border and rings, which then reach
                   most of their gold within two frames). */
                ...(springOn && motion.shipHit && motion.shipArriveMs != null && (seatClass === 'winner' || seatClass === 'split')
                  ? { '--spring-ship-arrive': motion.shipArriveMs + 'ms', '--spring-gold-at': Math.max(0, motion.shipArriveMs - 16) + 'ms' } : null)}}>
              {/* 12: opponent cards were hidden until showResult and then
                  appeared in a single frame — the only card event in the
                  replayer with no motion, at the moment the whole replay has
                  been building toward. The stylesheet's own comment says the
                  flip was disabled because it fought the splay transforms, and
                  the 600ms animShowdown effect kept ticking for an animation
                  nothing read. The ROW wrapper carries no splay transform, so
                  fading and lifting it costs the fan nothing. */}
              {/* Under springs the cards turn over one at a time (19) and move to the half they play for one by
                  one (21), so the row's own fade and shift are the flag-'0' path only. */}
              <div data-seat-cards={pi} className={`replayer-seat-cards ${isHiLo && showResult && !folded.has(pi) && !springSet ? ('replayer-hilo-' + (hiloSide[pi] || 'high')) + (hiloAnimate ? ' animate' : '') : ''}${animDealing ? ' animate-deal' : ''}${showdownOn && !springOn && pi !== replayHeroIdx && !folded.has(pi) ? ' animate-showdown' : ''}`}
                style={(() => {
                  const st = {};
                  if (animDealing) {
                    /* 64: the offset was computed from the table CENTRE with a
                       flat -40px, so cards arrived from a point above the
                       middle of the felt. They come from the deck, which is
                       now an object on the table with a known position. */
                    st['--deal-dx'] = ((dealerSpot[0] - pos[0]) * 1.9).toFixed(1) + 'px';
                    st['--deal-dy'] = ((dealerSpot[1] - pos[1]) * 1.3).toFixed(1) + 'px';
                    /* 63: the stagger was per SEAT, so each player's whole hand
                       flew in as one block — the one thing a dealer never
                       does. Per card as well as per seat, so the deal goes
                       round the table once for each card. */
                    st['--deal-seat-delay'] = (dealOrder.indexOf(pi) * 70) + 'ms';
                    st['--deal-round'] = String(hand.players.length * 70);
                  }
                  // 12: opponents reveal clockwise from the hero, not all at once.
                  if (showdownOn) st['--showdown-delay'] = (dealOrder.indexOf(pi) * 70) + 'ms';
                  return st;
                })()}>
                <CardRow text={getGameCategory(hand.gameType) === 'community' && !isDrawGame ? sortHandByRank(cards) : cards} stud={gameCfg.isStud} max={gameCfg.heroCards}
                  studDown={superThird ? SUPER_DOWN_IDX : undefined}
                  /* Everyone is dealt the same cards at the same time, so a
                     face-down seat holds exactly what the hero holds right now.
                     This was gameCfg.heroCards — the size of a FINISHED hand —
                     which is right for a game dealt at once and wrong for stud,
                     where it put seven backs in front of every opponent from
                     3rd street while the hero had three. */
                  placeholderCount={!cards && !folded.has(pi)
                    ? (parseCardNotation(heroCards || '').length || gameCfg.heroCards)
                    : 0}
                  splay={rSettings.cardSplay ? (gameCfg.heroCards <= 2 ? 12.5 : gameCfg.heroCards <= 4 ? 15 : gameCfg.heroCards <= 5 ? 18 : 22) : 0}
                  splayScale={(Number(rSettings.splayAmount) || 0) / 100}
                  reverseZ={pi !== replayHeroIdx}
                  discardIdx={discardIdx}
                  poseOf={cardPoses ? cardPoses.seats.get(pi) : undefined}
                  playIds={studPlay ? studPlay.get(pi) : undefined}
                  holdSort={pi === replayHeroIdx ? heroDrawHold : 0}
                  onCardTap={drillThrow && !drillThrow.disabled ? (id) => { haptic(); drillThrow.toggle(id); } : undefined}
                  /* The hero used to fan wider than everybody else — a bigger
                     arc and a wider allowance, on the grounds that the bottom
                     seat has no neighbour to crowd. It just made one hand at
                     the table a different shape. */
                  />
              </div>
              {/* 100: between steps the table was completely inert — no way to
                  inspect a player, no response to anything but the transport,
                  in a feature whose whole purpose is STUDYING hands. The only
                  thing you could do to a hand was watch it go past. The
                  action history is already indexed by player. */}
              <div className="replayer-seat-info" role="button" tabIndex={0}
                aria-expanded={inspecting === pi}
                onClick={(e) => { e.stopPropagation(); setInspecting(inspecting === pi ? null : pi); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setInspecting(inspecting === pi ? null : pi); } }}>
                {rSettings.showPlayerStats && (
                  /* 41: this rendered "23/15/2.1" — three fabricated numbers
                     (a hash of the name) with no key to what they are. An
                     unlabelled triplet styled as an engraving reads as
                     authoritative, which is the worst combination. Prefixed
                     until real stats exist. */
                  <div className="replayer-player-stats">{(() => { const st = getPlayerStats(p.name); return 'V' + st.vpip + ' P' + st.pfr + ' A' + st.ag; })()}</div>
                )}
                {/* 20: every player carries p.position and .replayer-seat-pos
                    was defined and never used, so blinds and everyone but the
                    button were anonymous — and position is the single most
                    important context for judging any action in a replay. */}
                {/* No position marker: the dealer button is on the table and
                    every other position follows from it, so the badge was
                    repeating the button in the tightest space on the felt. */}
                {(() => {
                  // "Hide Opponent Names": every non-hero seat reads Opponent N
                  // (numbered by seat order, hero excluded); the hero keeps their
                  // own name. title matches so the tooltip doesn't leak it either.
                  const _heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
                  const oppName = (rSettings.hideOppNames && pi !== _heroIdx)
                    ? 'Opponent ' + (pi < _heroIdx ? pi + 1 : pi)
                    : null;
                  return (
                    <div className="replayer-seat-name" title={oppName || p.name}>
                      {oppName || shortenName(p.name, nameBudget)}
                    </div>
                  );
                })()}
                {/* 67: the stack dropped the instant the bet was recorded,
                    while the chips were still in flight toward a pot that had
                    already been paid. It counts down over the same duration
                    the pot counts up. */}
                <div className="replayer-seat-stack"
                  {...(stackUnitAvailable ? {
                    role: 'button', tabIndex: 0,
                    'data-tappable': '1',
                    title: rSettings.stacksInBB
                      ? 'Show stacks in chips'
                      : (_limitGame ? 'Show stacks in big bets' : 'Show stacks in big blinds'),
                    onClick: toggleStackUnit,
                    /* The plaque around this is itself a role="button" that opens
                       the inspector, so both handlers stop propagation — a tap on
                       the number must not also open a panel over the table. */
                    onKeyDown: (e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      toggleStackUnit(e);
                    },
                  } : {})}>
                  {allIn.has(pi) && shownStacks[pi] <= 0 && !(springSet && showResult && potAwards)
                    ? <span className="replayer-allin-mark">{atRiskSeats.has(pi) ? 'AT RISK' : 'ALL-IN'}</span>
                    : bustedAtResult(pi) && hand.gameMode !== 'cash'
                      ? <span className="replayer-out-mark">OUT</span>
                      : fmtChips(stackFigure(pi))}
                </div>
                {/* 43: estimateRange returns a label AND a CSS class per
                    opponent, four styled tiers exist and the setting was
                    merged into the settings object — and no seat ever wore
                    one. Hero is excluded: you can see your own cards. */}
                {rSettings.showRanges && pi !== replayHeroIdx && !folded.has(pi) && !showResult && (() => {
                  const r = estimateRange(hand, pi, streetIdx, actionIdx);
                  return r ? <div className={'replayer-range-label ' + r.cls}>{r.label}</div> : null;
                })()}
                {/* The running total above already says what a hand cost a
                    seat. A red number under every loser repeated it and buried
                    the one figure worth seeing, which is what the winners are
                    PAID — that now sits in front of them instead. */}
                {/* Inside the plaque, not beside it. As a sibling its
                    `left: 50%` resolved against .replayer-seat — the seat's
                    whole footprint, cards and all — so the badge sat 28px
                    right of the name it belongs to. The plaque is already
                    position:relative, so in here 50% is the middle of the
                    name and `bottom: 100%` is the fan above it. */}
                {lastAct && !handName && !(runoutNames && runoutNames.has(pi)) && (() => {
                  const actText = lastAct.action;
                  if (!actText) return null;
                  const stale = springSet && !folded.has(pi) && !allIn.has(pi) && lastAct._ai != null && lastAggIdx > lastAct._ai
                    && currentActions[lastAggIdx] && currentActions[lastAggIdx].player !== pi;
                  let label = actText;
                  if (lastAct.amount) {
                    /* Names the seat's TOTAL wager for the street, the same
                       figure as the chips on the felt in front of it — a call
                       of a 440 bet reads "call 440" beside 440 in chips, not
                       "call 320" for the chips that one action happened to
                       move. Blinds and straddles are already in that total. */
                    label += ' ' + formatChipAmount(computePlayerContrib(hand, streetIdx, currentActions, lastAct._ai, pi));
                  }
                  // 58: re-keying is what makes the entrance replay when the
                  // same player acts twice in one street. By the action's own index, not the replay's step: keyed by
                  // the step, every label at the table was re-made at every press, so a label's motions (its dimming
                  // when a bet made it stale) found a new element each time and started again.
                  return <div key={streetIdx + '-' + lastAct._ai} data-act-seat={pi} className={'replayer-action-badge-outer action-' + actText + (stale ? ' is-stale' : '')}>{label}</div>;
                })()}
                {/* On a corner of the name box rather than at a percentage
                    offset from the seat point — the plaque is sized by its
                    text, so nothing outside it can know where its corner is.
                    Three earlier attempts all landed on somebody's name. */}
                {pi === btnIdx && (
                  <div className={'replayer-dealer-btn corner-' + btnCorner} role="img" aria-label="Dealer button">
                    <DealerGlyph />
                  </div>
                )}
                {/* On the plaque's top-right corner, straddling it, which is
                    where the reference puts the draw count. It was a pill
                    centred below the plaque, and hanging off the bottom edge
                    on its own it read as a stray tab rather than as part of
                    the seat — which is exactly how it got reported.

                    The count alone at that size: "Drew 2" does not fit a
                    corner, and among seats showing 1, 2 and P the digit is
                    unambiguous. The full wording stays on the title. */}
                {isDrawGame && !gameCfg.discardOnly && (() => {
                  /* Every draw so far, not just this street's: D2, then D2/D1,
                     then D2/D1/PAT. A draw game is a sequence of decisions and
                     only the sequence is readable — "D1" alone cannot tell you
                     whether someone has been drawing one all the way down or
                     has just broken a pat hand. getPlayerDrawsByStreet is keyed
                     by street index, so the slice up to the current street is
                     the history at this point in the replay. */
                  const byStreet = getPlayerDrawsByStreet(hand, pi);
                  /* A street's draw happens AFTER its betting, so si <= streetIdx
                     announced it the moment the replay entered the street —
                     everyone's discards were on the felt before anyone had
                     acted. A street counts as drawn once its betting is done,
                     which is also the moment the replay would show the new
                     cards. */
                  const streetActions = (hand.streets[streetIdx]?.actions || []).length;
                  const thisStreetDrawn = actionIdx >= streetActions - 1;
                  const history = Object.keys(byStreet)
                    .map(Number)
                    .filter(si => si < streetIdx || (si === streetIdx && thisStreetDrawn))
                    .sort((a, b) => a - b)
                    .map(si => byStreet[si].discarded === 0 ? 'PAT' : 'D' + byStreet[si].discarded);
                  if (!history.length) return null;
                  return <DrawBadge history={history} />;
                })()}
              </div>
              {inspecting === pi && (
                <div className="replayer-seat-line">
                  {(() => {
                    const line = [];
                    hand.streets.forEach((st, si) => {
                      const acts = (st.actions || []).filter(a => a.player === pi);
                      if (!acts.length) return;
                      line.push(
                        <div key={si} className="replayer-seat-line-row">
                          <span className="replayer-seat-line-street">{st.name || ('St' + si)}</span>
                          <span>{acts.map(a => a.action + (a.amount ? ' ' + fmtChips(a.amount) : '')).join(' \u00b7 ')}</span>
                        </div>
                      );
                    });
                    return line.length ? line : <div className="replayer-seat-line-row">No action yet</div>;
                  })()}
                </div>
              )}
              {/* The showdown equity is a figure in the seat's readout, not a piece of its own (owner, 2026-11-21: "This is
                  a mess"): the bar and its percentage were pinned half an r above the seat's foot, outside the placement,
                  so on the bottom seat they lay across the plaque's stack line ("OUT" under a bar and "39%"). See the
                  readouts below and seatEquity. */}
              {/* 29: both of these are absolutely positioned directly under the
                  plaque — the badge at calc(100% + 2px), the name at 100% plus
                  a margin — and at showdown BOTH render, because lastAct
                  persists from the river while handName arrives with the
                  result. So "CALL 12k" landed on top of "Two Pair, A & K".
                  The name is the newer and more important fact; the badge
                  stands down for it. */}
              {handName && <div data-name-seat={pi} className={'replayer-seat-hand-name' + (boardCount(hand) > 1 && category === 'community' ? ' is-boards' : '')}>
                {/* One span per line, so a hi-lo readout's "Hi:" and "Lo:" can each light as its half lands. */}
                {String(handName).split('\n').map((ln, k) => (
                  <React.Fragment key={k}>{k ? '\n' : ''}<span className="hn-line" data-half={/^(Side )?[Hh]i:/.test(ln) ? 'hi' : /^(Side )?[Ll]o:/.test(ln) ? 'lo' : undefined}>{ln}</span></React.Fragment>
                ))}
                {seatEquity(pi) != null && <span className="hn-eq">{' \u00b7 ' + seatEquity(pi) + '%'}</span>}
              </div>}
              {!handName && runoutNames && runoutNames.has(pi) && (
                <div data-name-seat={pi} data-run-name={runoutNames.get(pi).text} className={'replayer-seat-hand-name is-run' + (runoutNames.get(pi).lead ? '' : ' is-trailing')}>
                  {runoutNames.get(pi).text}
                  {seatEquity(pi) != null && <span className="hn-eq">{' \u00b7 ' + seatEquity(pi) + '%'}</span>}
                </div>
              )}
              {!handName && studFirstNote && studFirstNote.seat === pi && (
                <div data-name-seat={pi} className="replayer-seat-hand-name is-note">{studFirstNote.text}</div>
              )}
              {/* Equity with no readout yet (an all-in before the flop): the figure alone, placed as a readout is. */}
              {!handName && !(runoutNames && runoutNames.has(pi)) && !(studFirstNote && studFirstNote.seat === pi) && seatEquity(pi) != null && (
                <div data-name-seat={pi} className="replayer-seat-hand-name is-run is-eq">{seatEquity(pi) + '%'}</div>
              )}
            </div>
          );
        })}

        {/* Bet chips */}
        {hand.players.map((p, pi) => {
          const lastAct = playerLastAction[pi];
          /* At showdown this slot stops showing what a seat BET and starts
             showing what it is PAID — in front of the player, where a dealer
             pushes it. A seat that won nothing shows nothing: its chips are in
             the pot, and the stack above already counts them. */
          const wonHere = (showResult && potAwards) ? (potAwards[pi] || 0) : 0;
          /* 26: under springs a posted blind or straddle is a wager on the felt from the hand's first step until
             the flop's sweep carries it in; a seat that folds sends its wager in as it folds (30). */
          const blindOut = !showResult && springSet && streetIdx === 0 && !folded.has(pi)
            && computePlayerContrib(hand, 0, currentActions, actionIdx, pi) > 0;
          if (showResult ? !wonHere : (!blindOut && (!lastAct || !lastAct.amount))) return null;
          if (!showResult && springSet && lastAct && lastAct.action === 'fold') return null;
          /* On the spring path the pot is shipped INTO the winner's plaque (its stack counts it up
             and the plaque takes its gold), so nothing is also pushed in front of the seat: a pill
             there was the pot on the felt a second time, appearing from nowhere 130px from where it
             landed, or, sent out of the plaque, the pot leaving the winner. */
          if (showResult && springOn && rSettings.animateChips) return null;
          /* The chips in front of a seat are its TOTAL wager for the street, not
             the chips its last action moved: three players who all match a 440
             bet each have 440 in front of them, even though two of them only
             added 420 and 320 to get there. The stored amount is the increment,
             so sum the street (blinds and straddles included) to the bet on the
             felt. */
          const chipAmount = showResult ? wonHere : computePlayerContrib(hand, streetIdx, currentActions, actionIdx, pi);
          const pos = seats[pi] || [50, 50];
          /* 23: these were five branches of raw percentage constants along
             different axes of a 3:4.5 table — a top seat's chip sat 10% of
             HEIGHT from its plaque, a side seat's 25% of WIDTH, and the sides
             also drifted up 7% for no stated reason. In pixels that is roughly
             15, 26 and 45, so the wagers formed a lumpy, non-concentric ring
             around a pot they are all supposedly travelling to.

             Walking a fixed distance toward the middle fixed the ring and
             created two new collisions instead: from a bottom seat that walk
             lands on the player's own cards, and from a top seat it lands on
             their own action badge, because both hang on the same side of the
             plaque as the pot.

             A wager is not a fixed distance from its owner — it is a fixed
             fraction of the way to the POT, which is how it looks at a table
             and which clears whatever that seat has hanging toward the middle,
             because the badge and the cards are much nearer the plaque than
             the pot is. */
          const POT_AT = [50, 40];
          const t = 0.42;
          /* A side seat's wager goes straight in, level with its seat (owner, 2026-11-13: "move more directly
             horizontal"): toward the pot, a lower side seat's chips rose into the game and stakes pill under the
             board. Top and bottom seats keep the walk toward the pot. */
          /* A side seat is one level with the middle of the table, where the cloth beside it runs in toward the pot: the
             portrait table's long straight sides (within a quarter of the table's height of its middle), a landscape
             table's round ends at their middle (within an eighth). Where the rail turns, top or bottom, the seat's wager
             walks toward the pot like a top or bottom seat's: level with its plaque it sat beside the plaque by the rail
             (owner, 2026-11-22, the 8-max desktop table's bottom corners: "On desktop the location of Opp 1's bet here
             is wrong"; 2026-11-26, the 9-max desktop table's lower corner: "We also talked about the placement of these
             bets being off, and you said you'd fixed that too"). The 22 Nov rule (the way to the pot 1.25 times more
             across than up) moved only the 8-max corners: the 9-max lower corners, the 6-max lower side seats, the 10-max
             lower side seats and the 8 and 9-max upper corners on desktop, and the 10-max corners on a phone, all stayed
             beside their plaques. Seats sit on fixed rows, so every one is at least 3% of the table's height from either
             line: portrait 0 to 21.9 in, 28.1 out; landscape 3.1 to 9.4 in, 18.7 out. */
          const sideSeat = Math.abs(pos[0] - 50) > 25 && Math.abs(pos[1] - 50) <= (isLandscape ? 12.5 : 25);
          // Level with the plaque it clears that plaque only from further in: 0.6 of the way (a 6-max side plaque is
          // anchored on the table's edge and reaches ~24% in; at 0.42 the chips sat on its inner end).
          // (Portrait only: a landscape table is wide enough that 0.42 clears its plaques, and 0.6 reached the board.)
          /* A side seat's wager sits 1g further out, toward its own seat: left on the left, right on the right (owner,
             2026-11-22: "move opp 1's bet pill 1g left and do the same for the other side seats"). Portrait only, as the
             0.6 is. 1g is the table's (100cqmin / 35), here as a share of its width: left stays a percentage, the form
             the placement passes and the push-out read. */
          const gPct = (Math.min(tableW || 0, tableH || tableW || 0) / 35) / (tableW || 1) * 100 || 100 / 35;
          const sideNudge = sideSeat && !isLandscape ? (pos[0] < 50 ? -gPct : gPct) : 0;
          const chipX = pos[0] + (POT_AT[0] - pos[0]) * (sideSeat && !isLandscape ? 0.6 : t) + sideNudge;
          /* Top and bottom seats nearer their plaque (owner, 2026-11-14: "a bit closer to the seat"): 0.42 left ~10r between a
             bottom seat's cards and its chips and ~5r under a top seat's action pill; these leave ~2.3r and 2r (402 wide,
             6 and 9-max). Portrait only. */
          const tY = isLandscape ? t : pos[1] > POT_AT[1] ? 0.26 : 0.3;
          const chipY = sideSeat ? pos[1] : pos[1] + (POT_AT[1] - pos[1]) * tY;
          /* (A draw game's top seat put its chips a fixed 9.85r under its anchor while its action pill hung under the
             draw run, 2026-11-14. The pill sits over the cards again, and the placement effect keeps every wager 1r
             clear of its seat's draw run, so the draw seats take the same spot as everyone else.)
             --chip-start-dx/dy used to be written here (a percentage times 3, as 'px') for a
             keyframe that is animation: none; nothing read them. The spring push-out measures
             the seat direction itself. */
          const chipStyle = {left: chipX + '%', top: chipY + '%'};
          return (
            /* On the spring path the won pill is its own element: the river wager it replaces leaves
               the felt as itself (its ghost is a copy of it) rather than turning into the award. */
            <div key={(showResult && springOn ? 'won-' : 'bet-') + pi} data-seat={pi} className={'replayer-bet-chip' + (rSettings.animateChips ? ' animate-chips' : '')} style={chipStyle}
              data-base-left={chipStyle.left} data-base-top={chipStyle.top} data-side={sideSeat ? '1' : '0'}>
              <ChipStack amount={chipAmount} />
              {fmtChips(chipAmount)}
              {/* 42: a ten-step classifier from min through overbet was written
                  and never called, so '13k' arrived with no pot-relative
                  context — and pot-relative size is what makes a bet readable
                  as a bluff or a value bet at a glance. */}
              {!showResult && rSettings.showBetSizing && lastAct && (lastAct.action === 'bet' || lastAct.action === 'raise') && (() => {
                const before = calcPotBeforeAction(hand, streetIdx, lastAct._ai ?? actionIdx);
                const sizing = getBetSizingLabel(lastAct.amount, before);
                return sizing ? <div className="replayer-bet-sizing">{sizing}</div> : null;
              })()}
            </div>
          );
        }).filter(Boolean)}

        {/* Flying chip animations */}
        {flyingChips.map(fc => (
          <div key={fc.id} className={'replayer-flying-chip' + (fc.toWinner ? ' to-winner' : '') + (fc.color && !fc.toWinner ? ' denom' : '')}
            style={{
              // 56: the origin is set once; the animation only translates.
              '--fly-x0': fc.x0 + 'px', '--fly-y0': fc.y0 + 'px',
              '--fly-dx': (fc.x1 - fc.x0) + 'px', '--fly-dy': (fc.y1 - fc.y0) + 'px',
              '--fly-duration': '0.4s',
              ...(fc.color ? { '--fly-color': fc.color } : null),
              animationDelay: fc.delay + 'ms',
            }} />
        ))}

        {/* The spring path's flights: swept wagers' ghosts (their own layer, under the pot) and
            the chips shipped to a winner (over everything but the winner's seat). React renders
            the layers and never their children — they are created in the moment's commit and
            remove themselves when they land (utils/replayer-motion.js). Both span the table's
            padding box, so a ghost keeps its wager's own left/top percentages. The probes are an
            unseen pile chip and an unseen coin, which the ship sizes its chips and their landing by. */}
        {springOn && <div className="replayer-flying-chip replayer-chip-probe is-disc" aria-hidden="true"><div className="replayer-pot-chip-disc" /></div>}
        {springOn && <div className="replayer-flying-chip replayer-chip-probe" aria-hidden="true" />}
        {springOn && <div className="replayer-motion-layer replayer-sweep-layer" ref={sweepLayerRef} aria-hidden="true" />}
        {springOn && <div className="replayer-fold-layer" ref={foldLayerRef} aria-hidden="true" />}

        {/* Draw discard animations */}
        {drawDiscardAnims.length > 0 && drawDiscardAnims.map(anim => {
          const seatPos = seats[anim.playerIdx] || [50, 50];
          return Array.from({ length: Math.min(anim.count, 5) }, (_, ci) => {
            const spread = (ci - (anim.count - 1) / 2) * 8;
            return (
              <div key={'dd-' + anim.id + '-' + ci}
                className={'replayer-draw-discard-card' + (anim.phase === 'fade' ? ' fade-out' : '')}
                style={{
                  '--dd-x0': seatPos[0] + '%',
                  '--dd-y0': seatPos[1] + '%',
                  '--dd-spread': spread + 'px',
                  animationDelay: (ci * 60) + 'ms',
                }} />
            );
          });
        })}
      </div>
      {/* Dead cards under the table (every layout; landscape since 2026-11-22, off the felt): the label on its own 2r
          line, the 4r cards directly beneath it from the same left edge, on a 2.25g pitch that tightens when the list
          would pass the full 2g..35g (33g). */}
      {/* Not while the result line shows: both sit in the free band at the table's foot, and at the end of a stud
          hand the dead cards were drawn over "E. Bennett wins the 8,800 pot" (owner, 2026-11-13). */}
      {deadCards.length > 0
        && !(showResult && potAwards && rSettings.showResults && !linkedReplay && hand.players.some((_, i) => (potAwards[i] || 0) > 0))
        && (() => {
        const CARD_G = 2.0286;   // 4r at the artwork's 0.7143 ratio, in g
        const n = deadCards.length;
        const pitch = n > 1 ? Math.min(2.25, (33 - CARD_G) / (n - 1)) : 0;
        return (
          <div className="replayer-dead-strip" aria-label={'Dead cards: ' + deadCards.join(' ')}>
            <span className="replayer-dead-strip-label"><span>Dead cards</span></span>
            <div className="replayer-dead-strip-cards" style={{ '--dead-ml': (pitch - CARD_G).toFixed(4) }}>
              {deadCards.map(k => (
                <img key={k} src={cardFaceSrc(k)} alt={k} loading="eager" />
              ))}
            </div>
          </div>
        );
      })()}
      </div>

      {/* Everything below the table shares one region of fixed height and
          scrolls inside it, so no strip can take height from the table. */}
      <div className="replayer-under">

      {/* The green result banner is gone. It said "Hero wins, Straight Flush,
          Nine-high" directly under a seat whose own label already read
          "Hi: Straight Flush, 9-high", beside a plaque already bordered gold,
          starred, and holding the chips it had just been awarded - four
          statements of one fact. The label under the seat is the one that
          names WHOSE hand it is by where it sits, so it is the one that stays,
          and it is why the abbreviation came out of the hand names: that label
          is now the only place a result is written.
          Its reserved twin goes with it. That existed so the table would not
          resize when the banner appeared at showdown; with nothing to reserve,
          the height it was holding goes back to the table. evalResult itself
          stays - the bookend, the export image and the seat labels read it. */}

      {/* The result line (UX pick 54, Peak-End): at the end of the replay, who won the pot with what,
          and what the hand did for the hero. The table already says it in four places, none of them
          the figure; this is the one sentence that states the outcome. Not under an export, which
          has its own close bookend. */}
      {showResult && showdownUndecided && rSettings.showResults && !linkedReplay && (
        <div className="replayer-result-strip is-undecided" role="status">
          <span className="rrs-line">{undecidedLine(parseCardNotation(boardCards))}</span>
        </div>
      )}
      {/* (The hero's net at the result, the display-face figure at the table's foot, went too: owner, 2026-11-22, "Get
          rid of the Baskerville net gain/loss in the bottom right". The plaque's stack and the seats' readouts say it.) */}

      {/* Pot odds */}
      {rSettings.showPotOdds && (() => {
        /* This one toggled on nearly every action — there are no pot odds to
           quote against a check or a fold — so of all the strips it is the one
           that would have made the table twitch continuously. */
        const reserved = (
          <div className="replayer-pot-odds is-reserved" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="12"/></svg>
            <span className="rs-t">Pot Odds</span>
          </div>
        );
        if (actionIdx < 0) return reserved;
        const curAct = currentActions[actionIdx];
        if (!curAct || !curAct.amount || curAct.action === 'fold') return reserved;
        const callAmt = curAct.amount;
        const potBefore = pot - callAmt;
        if (potBefore <= 0) return reserved;
        const odds = (callAmt / (potBefore + callAmt) * 100).toFixed(1);
        const ratio = (potBefore / callAmt).toFixed(1);
        return (
          <div className="replayer-pot-odds">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="12"/></svg>
            <span className="rs-t">Pot Odds: {ratio}:1 ({odds}% equity needed)</span>
          </div>
        );
      })()}

      </div>

      {/* Controls — portaled into #above-nav-slot in App so the bar is
          a real sibling of <BottomNav> in the app-shell flex column. The
          bar's bottom edge meets the nav's top edge by layout, not by
          env() / fixed-position math. */}
      {(() => {
        const slot = typeof document !== 'undefined' && document.getElementById('above-nav-slot');
        const controls = (
      <div className="replayer-bottom-fixed" ref={barRef}>
        {/* snap-place: centred, the capsule lands wherever the window's width puts it; this sets
            it on the g and r lines so its whole-g, whole-r buttons are on them (a no-op on a phone,
            where the 27g capsule is already 5g in). */}
        {atDrillEdge && (playing ? React.cloneElement(drill.bar, { busy: true }) : drill.bar)}
        {/* The street track (UX pick 67): where the hand is and how much is left, as a video scrubber
            and the PokerTracker replayer's street buttons do. One cell per street and one for the
            end, each a 1r bar filled by the share of its actions played over a 3r label that jumps
            to the start of that street. Cells of whole g, the track the transport's 29g (or as near
            as the count allows), centred. */}
        {!atDrillEdge && !drill && (() => {
          const short = (nm) => String(nm || '').replace(/^Preflop$/, 'Pre').replace(/^Pre-Draw$/, 'Pre').replace(/ Street$/, '')
            .replace(/^First Draw$/, 'D1').replace(/^Second Draw$/, 'D2').replace(/^Third Draw$/, 'D3');
          const cells = hand.streets.map((st, si) => {
            const n = (st.actions || []).length;
            const fill = showResult || si < streetIdx ? 1 : si > streetIdx ? 0 : n ? Math.max(0, actionIdx + 1) / n : 1;
            return { key: si, label: short(st.name), fill, now: !showResult && si === streetIdx, go: () => goToStreet(si) };
          });
          cells.push({ key: 'end', label: 'Showdown', fill: showResult ? 1 : 0, now: showResult, go: goToEnd });
          const n = cells.length;
          const cw = Math.max(2, Math.floor(30 / n) - 1);
          return (
            <div className="replayer-street-track snap-place" role="group" aria-label="Streets"
              style={{ '--track-n': n, '--track-n1': n - 1, '--track-cw': cw, '--track-lw': Math.max(cw, 5) }}>
              {cells.map(c => (
                <div key={c.key} className={'rst-cell' + (c.now ? ' is-now' : '')}>
                  <span className="rst-bar" aria-hidden="true"><span className="rst-fill" style={{ transform: 'scaleX(' + c.fill + ')' }} /></span>
                  <button type="button" className="rst-label" aria-current={c.now ? 'step' : undefined} onClick={c.go}>{c.label}</button>
                </div>
              ))}
            </div>
          );
        })()}
        {!atDrillEdge && <div className="replayer-controls snap-place">
          <button onClick={goToStart} disabled={!canGoBack} title="Start">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="19 20 9 12 19 4"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
          </button>
          <button onClick={holdClick(stepBack)} disabled={!canGoBack} title="Back (hold to run back)" className={holding === 'back' ? 'is-holding' : undefined}
            onPointerDown={startHold('back')} onPointerUp={endHold} onPointerLeave={endHold} onPointerCancel={endHold}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/><polyline className="chev-2" points="15 18 9 12 15 6"/></svg>
          </button>
          {/* 53: the play triangle was STROKED, while every media player on
              the platform draws a solid one — and during playback the only
              change was the icon swap, so a running replayer and a paused one
              wore identical transparent buttons. */}
          <button className={'replayer-play-btn' + (playing ? ' is-playing' : '')}
            onClick={handlePlayPause}
            title={playing ? 'Pause' : (canGoForward ? 'Play' : 'Replay')}
            aria-label={playing ? 'Pause' : (canGoForward ? 'Play' : 'Replay')}>
            <span className="rpb-glyph" ref={glyphRef}>
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            ) : canGoForward ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg>
            ) : (
              /* 50: at the result the button restarts, so it says restart. */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            )}
            </span>
          </button>
          <button onClick={holdClick(stepForward)} disabled={!canGoForward} title="Forward (hold to run)" className={holding === 'fwd' ? 'is-holding' : undefined}
            onPointerDown={startHold('fwd')} onPointerUp={endHold} onPointerLeave={endHold} onPointerCancel={endHold}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/><polyline className="chev-2" points="9 18 15 12 9 6"/></svg>
          </button>
          <button onClick={goToEnd} disabled={!canGoForward} title="End">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
          </button>
          {/* 54: a raw <select> with five inline literals — the only rectangle
              in a row of circles, and on iOS it opened the OS picker wheel for
              a four-value choice. A four-value choice is a tap-to-cycle. The
              orphaned .replayer-speed-label finally has something to label. */}
          {(() => {
            const SPEEDS = [2000, 1000, 500, 250];
            const idx = Math.max(0, SPEEDS.indexOf(speed));
            const label = ['0.5x', '1x', '2x', '4x'][idx];
            return (
              <button className="replayer-speed-btn"
                onClick={() => setSpeed(SPEEDS[(idx + 1) % SPEEDS.length])}
                title={'Playback speed: ' + label + ' (tap to change)'}
                aria-label={'Playback speed ' + label}>
                <span className="rsb-clip"><span className="replayer-speed-label" ref={speedLabelRef}>{label}</span></span>
              </button>
            );
          })()}
        </div>}
        {drill && drill.over && drill.overBar}
        {/* 79: Back, Edit, Solve, Link, image share, WebM, GIF and the gear
            sat in ONE inline flex row with no wrap plan, so at 320px eight
            controls either overflowed or crushed each other — and four of the
            eight were exports, which is a task, not a navigation control. The
            row is navigation now; the exports live behind one Share button in
            the sheet the app already ships for exactly this. */}
        {!drill && (!linkedReplay || (onStudyDraw && drawStudyGame) || canSolveSpot) && <div className={'replayer-actions-bar snap-place' + (((onStudyDraw && drawStudyGame) || canSolveSpot) ? ' has-solve' : '') + (linkedReplay ? ' is-linked' : '')}>
          {/* A shared link is a clean view of one hand — no navigating back to a
              list that is not there, no editing someone else's hand, no
              re-sharing chrome. Ethan: drop Back/Edit/Share on a linked replay. */}
          {!linkedReplay && <button className="btn btn-ghost btn-sm rab-back" onClick={onBack}><span className="rs-t">{inPane ? 'Close' : 'Back'}</span></button>}
          {!linkedReplay && <button className="btn btn-ghost btn-sm rab-edit" onClick={onEdit}><span className="rs-t">Edit</span></button>}
          {onStudyDraw && drawStudyGame && (
            <button className={'btn btn-sm rab-solve ' + (canStudyDraw ? 'btn-primary' : 'btn-ghost')}
              onClick={handleStudyDraw} disabled={!canStudyDraw}
              title={canStudyDraw ? 'Price every discard at your draw on this street'
                : (drawStudySpot && drawStudySpot.refused) || undefined}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="12" height="16" rx="2"/><path d="M15 8h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4"/></svg>
              <span className="rs-t">Study this draw</span>
            </button>
          )}
          {/* One button in this cell: both are .rab-solve, and in a draw game Solve (stud only) was
              always dead and sat on top of Study, which nobody could therefore press. */}
          {/* Only where the game is one the solver covers (UX pick 65): the disabled ghost on every
              hold'em hand looked like the live Back and Edit beside it. */}
          {canSolveSpot && !(onStudyDraw && drawStudyGame) && (
            <button className="btn btn-sm rab-solve btn-primary" onClick={handleSolveSpot}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span className="rs-t">Solve this spot</span>
            </button>
          )}
          {!linkedReplay && <button className="btn btn-ghost btn-sm rab-share" onClick={() => setShowExportMenu(true)}
            disabled={videoExporting || gifExporting}>
            <span className="rs-t">Share</span>
          </button>}
          {false && <button className="replayer-gear-btn rab-gear" onClick={() => setShowSettings(true)} title="Replayer Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>}
        </div>}
        {/* 80: the ONLY explanation of why Solve is dead was a title
            attribute — invisible to every touch user, which is most of them
            on this app. */}
        {onStudyDraw && drawStudyGame && !canStudyDraw && <div className="replayer-bar-notes snap-place">
        {/* The same courtesy the Solve note gets: a disabled button with no
            reason is invisible on touch, where most of this app is used. The two
            reasons are different and the message says which. */}
        {onStudyDraw && drawStudyGame && !canStudyDraw && (
          <div className="replayer-bar-note"><span className="rs-t">{drawStudySpot && drawStudySpot.refused}</span></div>
        )}
        </div>}
        {/* 79: the exports, in the sheet grammar the app already uses. */}
        {showExportMenu && createPortal(
          <>
            <div className="share-menu-backdrop" onClick={() => setShowExportMenu(false)} />
            <div className="share-menu-panel replayer-share-sheet">
              <h3>Share this hand</h3>
              {/* UX pick 66: the two everyday outputs first, bordered in the brand line; the streamer tools
                  in a Video group of compact tiles (their notes in the title); the hand history last,
                  one row that says what PokerTracker does with it. */}
              <div className="share-menu-grid is-main">
                {/* 84: every one of these four options is a PICTURE, and they
                    were described with emoji — the same problem the theme
                    pills had. The preview is the shape of what comes out. */}
                <div className="share-menu-item" onClick={() => { copyShareLink(); setShowExportMenu(false); }}>
                  <span className="export-preview is-link" aria-hidden="true" />
                  <span className="share-label">{shareLinkCopied ? 'Copied' : 'Copy link'}</span>
                  <span className="share-desc">A public link to this replay</span>
                </div>
                <div className="share-menu-item" onClick={() => { shareReplayImage(); setShowExportMenu(false); }}>
                  <span className="export-preview is-image" aria-hidden="true" />
                  <span className="share-label">Image</span>
                  <span className="share-desc">A still of the hand at this point</span>
                </div>
              </div>
              {token && !sharedHand && (
                <div className="share-menu-grid is-main hx-share-row">
                  <div className="share-menu-item" onClick={() => { setShowExportMenu(false); setSendOpen(true); }}>
                    <span className="share-label">Send in the app</span>
                    <span className="share-desc">To friends or a group, to talk it over on the hand</span>
                  </div>
                  <div className={'share-menu-item' + (heroDecisionNext(hand, streetIdx, actionIdx) ? '' : ' is-disabled')}
                    aria-disabled={!heroDecisionNext(hand, streetIdx, actionIdx)}
                    onClick={() => { if (!heroDecisionNext(hand, streetIdx, actionIdx)) { toast.info('Step to just before your decision, then ask'); return; } setShowExportMenu(false); askQuestion(); }}>
                    <span className="share-label">Ask what they would do</span>
                    <span className="share-desc">It stops at your decision; they answer before they see the rest</span>
                  </div>
                </div>
              )}
              <div className="rss-sec"><span>Video</span></div>
              <div className="share-menu-grid rss-video">
                <div className={'share-menu-item' + (videoExporting || gifExporting ? ' disabled' : '')} title="9:16 video, ready to post"
                  onClick={() => { if (!videoExporting && !gifExporting) { handleExportVideo('story'); setShowExportMenu(false); } }}>
                  <span className="export-preview is-story" aria-hidden="true" />
                  <span className="share-label">Story</span>
                  <span className="share-desc">9:16 video, ready to post</span>
                </div>
                <div className={'share-menu-item' + (videoExporting || gifExporting ? ' disabled' : '')} title="Instagram sticker"
                  onClick={() => { if (!videoExporting && !gifExporting) { handleExportGif(); setShowExportMenu(false); } }}>
                  <span className="export-preview is-gif" aria-hidden="true" />
                  <span className="share-label">GIF</span>
                  <span className="share-desc">Instagram sticker</span>
                </div>
                <div className={'share-menu-item' + (videoExporting || gifExporting ? ' disabled' : '')} title="Transparent WebM for streaming"
                  onClick={() => { if (!videoExporting && !gifExporting) { handleExportVideo('transparent'); setShowExportMenu(false); } }}>
                  <span className="export-preview is-overlay" aria-hidden="true" />
                  <span className="share-label">Overlay</span>
                  <span className="share-desc">Transparent WebM for streaming</span>
                </div>
                {/* 81: the greenscreen branch and its MP4 codec ladder were
                    written for CapCut and had no way in. */}
                <div className={'share-menu-item' + (videoExporting || gifExporting ? ' disabled' : '')} title="MP4 to key out in an editor"
                  onClick={() => { if (!videoExporting && !gifExporting) { handleExportVideo('greenscreen'); setShowExportMenu(false); } }}>
                  <span className="export-preview is-green" aria-hidden="true" />
                  <span className="share-label">Greenscreen</span>
                  <span className="share-desc">MP4 to key out in an editor</span>
                </div>
                {/* The animated Instagram path: Instagram has no transparent-overlay
                    slot, so the replay goes in as a full-frame backgroundVideo,
                    composited over a photo the poster picks or shoots in-app.
                    Native iOS only — canInstagram gates it. */}
                {canInstagram && (
                  <div className={'share-menu-item' + (videoExporting || gifExporting ? ' disabled' : '')} title="Instagram Story: animated, over a photo you pick or shoot"
                    onClick={() => { if (!videoExporting && !gifExporting) { handleExportInstagramStory(); setShowExportMenu(false); } }}>
                    <span className="export-preview is-story" aria-hidden="true" />
                    <span className="share-label">Instagram</span>
                    <span className="share-desc">Animated, over a photo you pick or shoot</span>
                  </div>
                )}
              </div>
              <div className="rss-sec"><span>Hand history</span></div>
              <div className="share-menu-grid rss-hh">
                {/* The hand as PokerStars-format hand-history text, which PokerTracker 4
                    and Hold'em Manager import (utils/hand-history/, docs/hand-history-io.md).
                    PT4 analyses four-card Omaha and Hold'em only, so a stud, draw or 5/6-card
                    Omaha hand is offered as plain hand-history text; a hand the format cannot
                    carry, or one shared with the viewer, says why. */}
                <div className={'share-menu-item' + (hhCheck.ok ? '' : ' disabled')}
                  role="button" tabIndex={hhCheck.ok ? 0 : -1}
                  aria-disabled={hhCheck.ok ? undefined : 'true'}
                  onClick={() => { if (hhCheck.ok) { exportThisHand(); setShowExportMenu(false); } }}
                  onKeyDown={(e) => { if (hhCheck.ok && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); exportThisHand(); setShowExportMenu(false); } }}>
                  <span className="export-preview is-text" aria-hidden="true" />
                  <span className="share-label">{hhCheck.ok && hhCheck.pt4 ? 'PokerTracker' : 'Hand history'}</span>
                  <span className="share-desc">{!hhCheck.ok ? hhCheck.short : hhCheck.pt4 ? 'Hand history text file' : 'PokerTracker 4 skips ' + (hhCheck.pt4Why === 'big-omaha' ? '5/6-card Omaha' : 'stud and draw')}</span>
                </div>
              </div>
            </div>
          </>,
          document.body
        )}
      </div>
        );
        /* In fullscreen landscape the table is position:fixed at --z-modal
           (500), and the bar portals out to #above-nav-slot where it sits at
           400 — so the transport was rendered, visible and reported at the
           right coordinates, and drawn behind an opaque felt. There was no way
           to advance a hand in landscape at all.

           .replayer-landscape .replayer-bottom-fixed already restyles the bar
           as `position: relative` for exactly this case; it just never got the
           chance, because the bar was never inside the landscape container.
           In landscape it stays in flow, which is also what makes the slot
           above it leave room. */
        /* Both orientations are full screen now, so the bar is a real flex
           item at the bottom of the replay view in both. It used to portal to
           #above-nav-slot so it could sit above the tab bar — there is no tab
           bar over a replay any more. `slot` is left resolved above because
           the OFC replay still uses it. */
        return controls;
      })()}

      {/* Instagram Story adjust sheet: size the replay over the chosen photo
          and set the playback speed before rendering. Inline-styled so it needs
          no stylesheet changes; the 9:16 box is WYSIWYG with the export. */}
      {igDraft && !videoExporting && createPortal(
        <div className="share-menu-backdrop"
          style={{display:'flex',alignItems:'center',justifyContent:'center'}}
          onClick={closeIgDraft}>
          <div onClick={e => e.stopPropagation()}
            style={{background:'#14141c',borderRadius:'calc(var(--subrow) * 1.75)',padding:'var(--space-xl)',width:'min(92vw, calc(var(--subrow) * 40))',boxShadow:'0 calc(var(--subrow) * 2.5) calc(var(--subrow) * 7.5) rgba(0,0,0,0.55)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
            <div style={{color:'#fff',fontSize:'calc(var(--gu) * 1.472)',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:'var(--space-ml)',textAlign:'center'}}>Instagram Story</div>
            <div ref={igBoxRef}
              onPointerDown={igPointerDown} onPointerMove={igPointerMove}
              onPointerUp={igPointerUp} onPointerCancel={igPointerUp}
              style={{position:'relative',width:'100%',aspectRatio:'9 / 16',borderRadius:'calc(var(--subrow) * 1.25)',overflow:'hidden',background:'#000',margin:'0 auto',touchAction:'none',cursor:'grab'}}>
              <img src={igDraft.photoUrl} alt="" draggable={false} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',pointerEvents:'none'}} />
              {igDraft.stillUrl && (
                <img src={igDraft.stillUrl} alt="" draggable={false}
                  style={{position:'absolute',left:(igPos.x*100)+'%',top:(igPos.y*100)+'%',transform:'translate(-50%,-50%)',width:(igScale*100)+'%',height:'auto',pointerEvents:'none'}} />
              )}
            </div>
            <div style={{color:'rgba(255,255,255,0.4)',fontSize:'calc(var(--gu) * 0.913)',letterSpacing:'0.04em',textAlign:'center',marginTop:'var(--space-sm)'}}>Drag to move · pinch to resize</div>
            <div style={{marginTop:'calc(var(--subrow) * 1.75)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{color:'rgba(255,255,255,0.6)',fontSize:'calc(var(--gu) * 1.031)',letterSpacing:'0.05em',textTransform:'uppercase'}}>Speed</span>
              <div style={{display:'flex',gap:'var(--space-sm)'}}>
                {[1000,500,250,125,60].map((ms, i) => (
                  <button key={ms} onClick={() => setIgSpeed(ms)}
                    style={{padding:'calc(var(--subrow) * 0.625) var(--space-md)',borderRadius:'calc(var(--subrow) * 0.875)',border:'var(--bw-hair) solid '+(igSpeed===ms?'#fff':'rgba(255,255,255,0.25)'),background:igSpeed===ms?'rgba(255,255,255,0.15)':'transparent',color:'#fff',fontSize:'calc(var(--gu) * 1.060)',cursor:'pointer'}}>
                    {['1x','2x','4x','8x','16x'][i]}
                  </button>
                ))}
              </div>
            </div>
            <div style={{marginTop:'var(--space-xl)',display:'flex',gap:'var(--space-ml)'}}>
              <button onClick={closeIgDraft}
                style={{flex:1,padding:'var(--space-ml)',borderRadius:'calc(var(--subrow) * 1.125)',border:'var(--bw-hair) solid rgba(255,255,255,0.25)',background:'transparent',color:'#fff',fontSize:'calc(var(--gu) * 1.252)',cursor:'pointer'}}>Cancel</button>
              <button onClick={handleCreateInstagramStory}
                style={{flex:2,padding:'var(--space-ml)',borderRadius:'calc(var(--subrow) * 1.125)',border:'none',background:'#fff',color:'#14141c',fontSize:'calc(var(--gu) * 1.252)',fontWeight:600,cursor:'pointer'}}>Create Story</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Video export progress overlay */}
      {videoExporting && createPortal(
        <div className="replayer-export-overlay">
          <div style={{color:'#fff',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'calc(var(--gu) * 1.620)',marginBottom:'var(--space-xs)',letterSpacing:'0.08em',textTransform:'uppercase'}}>
            {videoKind === 'igstory' ? 'Building Instagram Story…'
              : videoKind === 'story' ? 'Building Story…'
              : videoKind === 'greenscreen' ? 'Recording Greenscreen…'
              : 'Recording Overlay…'}
          </div>
          <div style={{color:'rgba(255,255,255,0.45)',fontSize:'calc(var(--gu) * 0.957)',fontFamily:"'Univers Condensed','Univers',sans-serif",marginBottom:'calc(var(--subrow) * 1.75)',letterSpacing:'0.05em'}}>
            {videoKind === 'igstory' ? '9:16 MP4 · over your photo'
              : videoKind === 'story' ? '9:16 MP4 · ready to post'
              : videoKind === 'greenscreen' ? 'MP4 · chroma key for editing'
              : 'WebM VP9 · transparent background'}
          </div>
          {/* 85: the frames, as they are captured. */}
          <div className="replayer-export-frame">
            {exportPreview && <img src={exportPreview} alt="" />}
          </div>
          <div className="replayer-export-bar">
            <div style={{width:videoProgress+'%'}} />
          </div>
          <div style={{color:'rgba(255,255,255,0.5)',fontSize:'calc(var(--gu) * 1.060)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
            Step {videoStep} of {videoTotal}
          </div>
          {/* 94: this said "will download automatically" on a platform where
              the outcome is usually a share sheet. */}
          <div style={{color:'rgba(255,255,255,0.3)',fontSize:'calc(var(--gu) * 0.957)',fontFamily:"'Univers Condensed','Univers',sans-serif",marginTop:'var(--space-sm)',maxWidth:'calc(var(--subrow) * 25)',textAlign:'center'}}>
            {videoKind === 'igstory' ? 'Instagram will open when it is ready'
              : canNativeShare ? 'The share sheet will open when it is ready'
              : 'It will download when complete'}
          </div>
        </div>,
        document.body
      )}

      {/* GIF export progress overlay */}
      {gifExporting && createPortal(
        <div className="replayer-export-overlay">
          <div style={{color:'#fff',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'calc(var(--gu) * 1.620)',marginBottom:'var(--space-xs)',letterSpacing:'0.08em',textTransform:'uppercase'}}>
            Building GIF…
          </div>
          <div style={{color:'rgba(255,255,255,0.45)',fontSize:'calc(var(--gu) * 0.957)',fontFamily:"'Univers Condensed','Univers',sans-serif",marginBottom:'calc(var(--subrow) * 1.75)',letterSpacing:'0.05em'}}>
            {/* 94: this said "upload to GIPHY" while the code auto-opens
                Instagram wherever it can. */}
            {canInstagram ? 'Transparent \u00b7 opens in Instagram Stories' : 'Transparent \u00b7 upload to GIPHY for an Instagram sticker'}
          </div>
          <div className="replayer-export-frame">
            {exportPreview && <img src={exportPreview} alt="" />}
          </div>
          <div className="replayer-export-bar">
            <div style={{width:gifProgress+'%'}} />
          </div>
          <div style={{color:'rgba(255,255,255,0.5)',fontSize:'calc(var(--gu) * 1.060)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
            Step {gifStep} of {gifTotal}
          </div>
          <div style={{color:'rgba(255,255,255,0.3)',fontSize:'calc(var(--gu) * 0.957)',fontFamily:"'Univers Condensed','Univers',sans-serif",marginTop:'var(--space-sm)',maxWidth:'calc(var(--subrow) * 25)',textAlign:'center'}}>
            {canInstagram ? 'Instagram will open when it is ready'
              : canNativeShare ? 'The share sheet will open when it is ready'
              : 'It will download when complete'}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// The replay, for the play-money tables (TablesView.jsx), which play a live hand on it as the drill does.
export { HandReplayerReplayView };
