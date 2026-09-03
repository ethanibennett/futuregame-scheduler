import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { API_URL } from '../utils/api.js';
import { HAND_CONFIG, HAND_CONFIG_DEFAULT, getGamePills, haptic } from '../utils/utils.js';
import { parseCardNotation, dualPlaceholder, evaluateHand, evaluateShowdown, assignNeutralSuits, GAME_EVAL,
         bestHighHand, bestOmahaHigh, bestOmahaLow, bestLowA5Hand, bestLow27Hand, bestBadugiHand,
         computePotAwards, hiLoWinnersAmong, potLayerWinners, reconcileLayersToPot,
         seatOrderFromButton } from '../utils/poker-engine.js';
import { encodeHand, decodeHand, GAME_CODES } from '../utils/hand-shorthand.js';
import { loadCardImages, ensureExportFonts } from '../utils/export.js';
import { playTableSound } from '../utils/replay-sound.js';
import { exportReplayVideo } from '../utils/replay-video-export.js';
import { exportReplayGif } from '../utils/replay-gif-export.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { parseHandText } from '../utils/hand-text-parser.js';

// ── Street definitions ──────────────────────────────────────
const STREET_DEFS = {
  community: { streets: ['Preflop', 'Flop', 'Turn', 'River'], boardCards: [0, 3, 1, 1] },
  draw_triple: { streets: ['Pre-Draw', 'First Draw', 'Second Draw', 'Third Draw'], boardCards: [0, 0, 0, 0] },
  draw_single: { streets: ['Pre-Draw', 'Draw'], boardCards: [0, 0] },
  stud: { streets: ['3rd Street', '4th Street', '5th Street', '6th Street', '7th Street'], boardCards: [0, 0, 0, 0, 0] },
  ofc: { streets: ['Initial (5)', 'Card 6', 'Card 7', 'Card 8', 'Card 9', 'Card 10', 'Card 11', 'Card 12', 'Card 13'], boardCards: [0,0,0,0,0,0,0,0,0] },
};

// ── Draw hand computation ──
function computeDrawHand(originalCards, draws, upToStreetIdx) {
  if (!originalCards) return '';
  let current = originalCards;
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
      const parsed = parseCardNotation(current);
      const keep = Math.max(0, parsed.length - draw.discarded);
      current = parsed.slice(0, keep).map(c => c.rank + c.suit).join('');
    }
    if (draw.newCards) current += draw.newCards;
  }
  return current;
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
function getGameCategory(gameType) {
  // Strip "Super " prefix for engine lookups — Super variants share base game config
  const baseType = gameType.replace(/^Super /, '');
  const cfg = HAND_CONFIG[gameType] || HAND_CONFIG[baseType];
  if (!cfg) return 'community';
  if (gameType === 'OFC') return 'ofc';
  if (cfg.isStud) return 'stud';
  if (cfg.hasBoard) return 'community';
  if (['2-7 TD', 'PL 2-7 TD', 'L 2-7 TD', 'A-5 TD', 'Badeucy', 'Badacy'].includes(gameType)) return 'draw_triple';
  if (['NL 2-7 SD', 'PL 5CD Hi'].includes(gameType)) return 'draw_single';
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
  return STREET_DEFS[getGameCategory(gameType)] || STREET_DEFS.community;
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

// ── Action order ──
function getActionOrder(players, isPreflop, studInfo) {
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
    for (let i = 0; i < n; i++) indices.push(i);
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
    ? { 'A':0,'2':1,'3':2,'4':3,'5':4,'6':5,'7':6,'8':7,'9':8,'T':9,'J':10,'Q':11,'K':12 }
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

function scoreStudBoard(cards) {
  const rankValues = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };
  if (!cards.length) return 0;
  const counts = {};
  cards.forEach(c => { const r = rankValues[c.rank] || 0; counts[r] = (counts[r] || 0) + 1; });
  const pairs = [], trips = [], quads = [], kickers = [];
  Object.keys(counts).forEach(r => {
    const rv = parseInt(r);
    if (counts[r] === 4) quads.push(rv);
    else if (counts[r] === 3) trips.push(rv);
    else if (counts[r] === 2) pairs.push(rv);
    else kickers.push(rv);
  });
  pairs.sort((a,b) => b-a); trips.sort((a,b) => b-a); kickers.sort((a,b) => b-a);
  if (quads.length) return 7000000 + quads[0]*100;
  if (trips.length && pairs.length) return 6000000 + trips[0]*100 + pairs[0];
  if (trips.length) return 5000000 + trips[0]*100;
  if (pairs.length >= 2) return 4000000 + pairs[0]*100 + pairs[1];
  if (pairs.length === 1) return 3000000 + pairs[0]*100 + (kickers[0]||0);
  const allRanks = Object.keys(counts).map(Number).sort((a,b)=>b-a);
  let score = 1000000;
  for (let i = 0; i < allRanks.length; i++) score += allRanks[i] * Math.pow(100, 4-i);
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
    const score = scoreStudBoard(visible);
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
// gameType → solver engine id. The live Solver supports only the
// fixed-limit stud games it has trees for: Stud 8 and Razz. Hold'em /
// Omaha / draw games (and the NL/PL stud variants, Stud Hi, 2-7 Razz)
// are NOT supported and disable the button.
const SOLVER_GAME_MAP = { 'Stud 8': 'stud8', 'Razz': 'razz' };
function solverGameFor(gameType) { return SOLVER_GAME_MAP[gameType] || null; }

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

/* 73: parseCardNotation silently DROPS any character it does not recognise
   and pairs whatever ranks and suits survive, so "Ahh" parses as one card,
   "AhAh" as two identical ones, and a bare "A" as an unknown-suit card - all
   of which render as a shorter card row than the player typed, with nothing
   anywhere saying why. This reports what the parser threw away. */
function checkCardText(text) {
  if (!text) return null;
  const stripped = String(text).replace(/\s/g, '');
  if (!stripped) return null;
  const bad = [...new Set(stripped.split('').filter(ch =>
    !'AKQJT98765432'.includes(ch.toUpperCase()) && !'hdcsx'.includes(ch.toLowerCase())))];
  if (bad.length) return 'Not card notation: ' + bad.join(' ');
  const cards = parseCardNotation(stripped);
  const seen = new Set();
  for (const c of cards) {
    if (c.suit === 'x') continue;
    const key = c.rank + c.suit;
    if (seen.has(key)) return 'Duplicate card: ' + key;
    seen.add(key);
  }
  return null;
}

/* 59: /api/replayer/hands spreads the entire hand_data into each list row, so
   the hero's cards and who won are already here — the list simply never looked
   at them and rendered a title, a game chip and a Delete button instead. */
function heroCardsOf(h) {
  return (h.streets && h.streets[0] && h.streets[0].cards && h.streets[0].cards.hero) || '';
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
function feltStops(hex) {
  const m = String(hex || '').match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return null;
  let r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
  if (lum > 0.004) {
    const k = Math.min(0.62, Math.max(0.16, lum)) / lum;
    r *= k; g *= k; b *= k;
  } else {
    r = g = b = 42;
  }
  const mix = (c, t, w) => Math.round(Math.min(255, Math.max(0, c * (1 - w) + t * w)));
  return {
    lit: `rgb(${mix(r * 1.18, 255, 0.10)},${mix(g * 1.13, 246, 0.10)},${mix(b * 1.04, 214, 0.10)})`,
    shade: `rgb(${mix(r * 0.52, 12, 0.18)},${mix(g * 0.52, 16, 0.18)},${mix(b * 0.58, 52, 0.18)})`,
  };
}

/* 66 + 67: the pot swapped three digits in a single frame and a player's
   stack dropped the instant they bet — while their chips were still animating
   toward a pot that had already been paid. The money left the stack before it
   arrived, and neither event was connected to the other. Conservation is the
   whole point of animating chips: watching the same quantity leave one place
   and arrive at another.

   This tweens a displayed value toward its target over the flight's duration.
   A counting number is one of the few places where motion carries information
   rather than decoration — it shows the SIZE of the change, not just the
   result. Scrubbing (a jump of more than one step, or backwards) snaps. */
function useCountUp(target, enabled) {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const from = fromRef.current;
    if (!enabled || from === target) { fromRef.current = target; setShown(target); return; }
    const t0 = performance.now();
    const DUR = 420;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / DUR);
      // ease-out: the count decelerates into its landing, like the chips do.
      const e = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + (target - from) * e));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, enabled]);
  return shown;
}

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
function pipShift(seed, index) {
  const h = Math.abs(Math.imul(seed | 0, 2654435761) + index * 40503) % 100;
  return (h / 300).toFixed(4);
}

// ── Chip visuals ──
const CHIP_DENOMS = [
  { value: 25000, color: '#14b8a6' },
  { value: 5000,  color: '#f97316' },
  { value: 1000,  color: '#eab308' },
  { value: 500,   color: '#7c3aed' },
  { value: 100,   color: '#39406b' },
  { value: 25,    color: '#22c55e' },
];
function getChipBreakdown(amount) {
  const chips = [];
  let remaining = Math.abs(Number(amount) || 0);
  for (let i = 0; i < CHIP_DENOMS.length && chips.length < 5; i++) {
    const d = CHIP_DENOMS[i];
    while (remaining >= d.value && chips.length < 5) { chips.push(d.color); remaining -= d.value; }
  }
  if (chips.length === 0) chips.push('#22c55e');
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
    <div className="chip-stack-visual" style={{ display:'inline-flex', flexDirection:'column', alignItems:'center', marginRight:'3px', verticalAlign:'middle' }}>
      {chips.map((color, i) => (
        /* Size, radius and overlap all live in .chip-disc now, shared with
           the pot's chips — these were two drawings of one object. Only the
           colour, the phase and the stacking order are per-disc. */
        <div key={i} className="chip-disc" style={{
          '--chip': color,
          '--pip-shift': pipShift(amount, i),
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
  const px = Math.min(landscape ? 34 : 13, Math.max(8, cq * (landscape ? 0.028 : 0.031)));
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
  /* 0.545, and a mean would have been the wrong statistic. The plaque went to
     Libre Baskerville and back to Univers, and the constant was re-measured on
     each face the same way — a Range over a probe carrying the plaque's own
     resolved type. The ROMAN cut it uses now runs 0.465 to 0.575 across ten
     real names for a mean of 0.515, but charging the mean admits a name that
     does not fit: at 0.52 the budget came out at 14 and let in "Jason
     Blodgett" at 85.3px against an 83.6px box. 0.545 puts the budget at 13,
     the longest form that actually fits — measured, every real name and house
     form then lands between 66.9px and 81.7px in that box. */
  return Math.max(6, Math.min(30, Math.round(box / (px * 0.545))));
}

/* One counter per seat: a hook cannot be called inside the seat map, so the
   count lives in a leaf component that gets remounted with the seat. */
function CountedChips({ value, fmt, live }) {
  return fmt(useCountUp(value, live));
}

// ── Player name helpers ──
const DEFAULT_OPP_NAMES = ['Jason Blodgett', 'Keith McCormack', 'Alex Charron', 'Kevin DiPasquale', 'Cristian Gutierrez', 'Derek Nold', 'Anthony Hall', 'Aidan Long'];

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
  return DEFAULT_OPP_NAMES[idx - 1] || 'Opp ' + idx;
}

// ── Create empty hand ──
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
      heroIdx: 0, result: null,
    };
  }
  const defaultNum = gameCfg.isStud ? 8 : 6;
  const numPlayers = scan ? Math.max(2, Math.min(10, scan.length)) : defaultNum;
  const positions = gameCfg.isStud ? getStudPositionLabels(numPlayers) : getPositionLabels(numPlayers);
  /* Stud is a small-bet / big-bet / ante game and now says so: a 200/400
     structure with a 25 ante, and stacks at 30 big bets. The ante was 0, which
     is not a stud game at all — every player antes, and the pot maths already
     counted an ante from everyone the moment there was one to count. */
  const defaultAnte = gameCfg.isStud ? 25 : ((gameCfg.hasBoard && !gameCfg.isStud) ? 200 : 0);
  const defaultBigBet = gameCfg.isStud ? 400 : 0;
  const defaultBringIn = gameCfg.isStud ? 50 : 0;
  /* A limit street runs a bet and four raises. gameCfg.raiseCap said four,
     which is the other common house rule; hands saved without a cap keep it. */
  const isLimit = gameCfg.betting === 'fl';
  const defaultStack = gameCfg.isStud ? defaultBigBet * STUD_STACK_BB : 50000;
  return {
    gameType,
    players: Array.from({ length: numPlayers }, (_, i) => ({
      name: getSeatName(i, 0, heroName), position: positions[i] || '', startingStack: defaultStack
    })),
    blinds: gameCfg.isStud
      ? { sb: 100, bb: 200, ante: defaultAnte, bigBet: defaultBigBet, bringIn: defaultBringIn, betCap: 5, uncapHeadsUp: true }
      : (isLimit
        ? { sb: 100, bb: 200, ante: defaultAnte, betCap: 5, uncapHeadsUp: true }
        : { sb: 100, bb: 200, ante: defaultAnte }),
    streets: streetDef.streets.map(name => ({
      name, cards: { hero: '', opponents: Array.from({ length: numPlayers - 1 }, () => ''), board: '' }, actions: [], draws: [],
    })),
    heroIdx: 0, result: null,
  };
}

// ── Pot and stack calculation ──
function calcPotsAndStacks(hand, upToStreet, upToAction) {
  const blinds = hand.blinds || { sb: 0, bb: 0, ante: 0 };
  const stacks = hand.players.map(p => p.startingStack);
  const category = getGameCategory(hand.gameType);
  const isBBante = category !== 'stud' && (blinds.ante || 0) > 0;
  if (!isBBante) stacks.forEach((_, i) => { stacks[i] -= (blinds.ante || 0); });
  let pot = isBBante ? 0 : hand.players.length * (blinds.ante || 0);
  if (hand.streets.length > 0 && hand.streets[0].actions) {
    if (category !== 'stud') {
      const sbIdx = hand.players.findIndex(p => p.position === 'SB' || p.position === 'BTN/SB');
      const bbIdx = hand.players.findIndex(p => p.position === 'BB');
      if (sbIdx >= 0) { stacks[sbIdx] -= (blinds.sb || 0); pot += (blinds.sb || 0); }
      if (bbIdx >= 0) {
        stacks[bbIdx] -= (blinds.bb || 0); pot += (blinds.bb || 0);
        if (isBBante) { stacks[bbIdx] -= (blinds.ante || 0); pot += (blinds.ante || 0); }
      }
    }
  }
  const folded = new Set();
  for (let si = 0; si <= upToStreet && si < hand.streets.length; si++) {
    const street = hand.streets[si];
    const maxAction = si === upToStreet ? upToAction : (street.actions ? street.actions.length - 1 : -1);
    for (let ai = 0; ai <= maxAction && street.actions && ai < street.actions.length; ai++) {
      const act = street.actions[ai];
      if (act.action === 'fold') { folded.add(act.player); continue; }
      if (act.amount && act.amount > 0) { stacks[act.player] -= act.amount; pot += act.amount; }
    }
  }
  return { stacks, pot, folded };
}

// ── Player street contribution ──
function computePlayerContrib(hand, streetIdx, actions, upToIdx, playerIdx) {
  let total = 0;
  const category = getGameCategory(hand.gameType);
  if (streetIdx === 0 && category !== 'stud') {
    const pos = hand.players[playerIdx] && hand.players[playerIdx].position;
    if (pos === 'SB' || pos === 'BTN/SB') total = (hand.blinds || {}).sb || 0;
    else if (pos === 'BB') total = (hand.blinds || {}).bb || 0;
  }
  for (let i = 0; i <= upToIdx && i < actions.length; i++) {
    if (actions[i].player === playerIdx) {
      if (actions[i].action === 'bring-in') total = actions[i].amount || 0;
      else if (actions[i].action !== 'fold') total += actions[i].amount || 0;
    }
  }
  return total;
}

// ── Commentary generation ──
function generateCommentary(hand, streetIdx, actionIdx, pot, stacks) {
  const street = hand.streets[streetIdx];
  if (!street) return 'The hand begins...';
  const streetName = street.name || 'Preflop';
  const category = getGameCategory(hand.gameType);
  const isDrawStreet = (category === 'draw_triple' || category === 'draw_single') && streetIdx > 0;
  if (actionIdx < 0) {
    if (category === 'stud') {
      const _ante = (hand.blinds || {}).ante || 0;
      if (streetIdx === 0) {
        const _isRazz = hand.gameType === 'Razz' || hand.gameType === '2-7 Razz';
        const _biIdx = findStudBringIn(hand, _isRazz);
        let doorInfo = '';
        if (_biIdx >= 0 && hand.players[_biIdx]) {
          const biPlayer = hand.players[_biIdx];
          const _hi = hand.heroIdx != null ? hand.heroIdx : 0;
          let _dc = '';
          if (_biIdx === _hi) {
            const _hc = parseCardNotation((hand.streets[0] && hand.streets[0].cards.hero) || '');
            if (_hc.length >= 3) _dc = _hc[2].rank + _hc[2].suit;
          } else {
            const _os = _biIdx < _hi ? _biIdx : _biIdx - 1;
            const _oc = parseCardNotation(((hand.streets[0] && hand.streets[0].cards.opponents) || [])[_os] || '');
            if (_oc.length >= 1) _dc = _oc[0].rank + _oc[0].suit;
          }
          const _SW = {h:'hearts',d:'diamonds',c:'clubs',s:'spades'};
          const _RW = {'A':'Ace','K':'King','Q':'Queen','J':'Jack','T':'Ten','9':'Nine','8':'Eight','7':'Seven','6':'Six','5':'Five','4':'Four','3':'Three','2':'Two'};
          if (_dc && _dc.length >= 2) doorInfo = ' ' + biPlayer.name + ' shows the ' + (_RW[_dc[0]]||_dc[0]) + ' of ' + (_SW[_dc[1]]||_dc[1]) + ' as the door card and has the bring-in.';
          else doorInfo = ' ' + biPlayer.name + ' has the bring-in.';
        }
        return hand.players.length + ' players ante ' + formatChipAmount(_ante) + '. Cards are dealt \u2014 two down, one up.' + doorInfo;
      }
      if (streetIdx === 4) return '7th Street: a final card is dealt face down to each remaining player. The pot stands at ' + formatChipAmount(pot) + '.';
      return streetName + ': a card is dealt face up to each remaining player. The pot stands at ' + formatChipAmount(pot) + '.';
    }
    if (streetIdx === 0) return 'Cards are dealt. ' + hand.players.length + ' players at the table. Blinds are ' + formatChipAmount((hand.blinds||{}).sb||0) + '/' + formatChipAmount((hand.blinds||{}).bb||0) + '.';
    if (isDrawStreet && street.draws && street.draws.length > 0) {
      const drawParts = street.draws.map(d => {
        const pName = hand.players[d.player] ? hand.players[d.player].name : '?';
        return d.discarded === 0 ? pName + ' stands pat' : pName + ' discards ' + d.discarded;
      });
      return streetName + '. ' + drawParts.join('. ') + '. The pot is ' + formatChipAmount(pot) + '.';
    }
    return streetName + ' is dealt. The pot stands at ' + formatChipAmount(pot) + '.';
  }
  const actions = street.actions || [];
  if (actionIdx >= actions.length) return '';
  const act = actions[actionIdx];
  const player = hand.players[act.player];
  const name = player ? player.name : 'Unknown';
  const pos = player ? player.position : '';
  const posStr = pos ? ' from the ' + pos : '';
  switch (act.action) {
    case 'fold': return name + posStr + ' releases their hand into the muck.';
    case 'check': return name + posStr + ' taps the table. Check.';
    case 'call': return name + posStr + ' makes the call for ' + formatChipAmount(act.amount) + '.';
    case 'bet': {
      if (category === 'stud' && streetIdx === 0) {
        const _hasBringIn = actions.slice(0, actionIdx).some(a => a.action === 'bring-in');
        const _priorBets = actions.slice(0, actionIdx).filter(a => a.action === 'bet' || a.action === 'raise').length;
        if (_hasBringIn && _priorBets === 0) return name + posStr + ' completes to ' + formatChipAmount(act.amount) + '.';
      }
      return name + posStr + ' leads out with a bet of ' + formatChipAmount(act.amount) + ' into a ' + formatChipAmount(pot - act.amount) + ' pot.';
    }
    case 'raise': return name + posStr + ' fires a raise to ' + formatChipAmount(computePlayerContrib(hand, streetIdx, actions, actionIdx, act.player)) + '! The pot swells to ' + formatChipAmount(pot) + '.';
    case 'all-in': return name + posStr + ' moves ALL IN for ' + formatChipAmount(act.amount) + '! A pivotal moment at the table.';
    case 'bring-in': return name + posStr + ' posts the bring-in of ' + formatChipAmount(act.amount) + '.';
    default: return name + ' acts (' + act.action + ').';
  }
}

// ── Hand strength helpers ──
function calcHandStrength(heroCardsStr, boardCardsStr, gameType) {
  if (!heroCardsStr) return null;
  const gameEval = GAME_EVAL[gameType];
  if (!gameEval) return null;
  const hCards = parseCardNotation(heroCardsStr).filter(c => c.suit !== 'x');
  const bCards = boardCardsStr ? parseCardNotation(boardCardsStr).filter(c => c.suit !== 'x') : [];
  if (hCards.length < 2) return null;
  if (bCards.length === 0) {
    const r1 = '23456789TJQKA'.indexOf(hCards[0].rank);
    const r2 = hCards.length > 1 ? '23456789TJQKA'.indexOf(hCards[1].rank) : 0;
    const suited = hCards.length > 1 && hCards[0].suit === hCards[1].suit;
    const paired = hCards.length > 1 && hCards[0].rank === hCards[1].rank;
    let base = (r1 + r2) / 24 * 60;
    if (paired) base = 50 + (r1 / 12) * 50;
    if (suited) base += 8;
    if (Math.abs(r1 - r2) <= 2 && !paired) base += 5;
    return Math.min(100, Math.max(5, Math.round(base)));
  }
  try {
    const allCards = hCards.concat(bCards);
    let ev;
    if (gameEval.method === 'omaha') ev = bestOmahaHigh(hCards, bCards);
    else ev = bestHighHand(allCards);
    if (!ev) return 30;
    const rankMap = { 'High Card':15, 'Pair':30, 'Two Pair':45, 'Three of a Kind':55, 'Straight':65, 'Flush':75, 'Full House':82, 'Four of a Kind':92, 'Straight Flush':97, 'Royal Flush':100 };
    let baseStr = 30;
    for (const k in rankMap) { if (ev.name && ev.name.indexOf(k) >= 0) { baseStr = rankMap[k]; break; } }
    return Math.min(100, Math.max(5, Math.round(baseStr)));
  } catch { return 30; }
}

function getStrengthColor(pct) {
  if (pct >= 75) return '#4ade80';
  if (pct >= 50) return '#facc15';
  if (pct >= 25) return '#f59e0b';
  return '#ef4444';
}

function getStreetColorClass(streetName) {
  if (!streetName) return 'street-preflop';
  const lower = streetName.toLowerCase();
  if (lower === 'flop' || lower === '3rd street') return 'street-flop';
  if (lower === 'turn' || lower === '4th street') return 'street-turn';
  if (lower === 'river' || lower.includes('5th') || lower.includes('6th') || lower.includes('7th')) return 'street-river';
  return 'street-preflop';
}

// ── Additional analysis helpers ──
function calcSPR(hand, streetIdx) {
  if (streetIdx <= 0) return null;
  const prevStreet = hand.streets[streetIdx - 1];
  const prevActionCount = prevStreet && prevStreet.actions ? prevStreet.actions.length - 1 : -1;
  const result = calcPotsAndStacks(hand, streetIdx - 1, prevActionCount);
  if (result.pot <= 0) return null;
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  const heroStack = result.stacks[heroIdx];
  if (heroStack <= 0) return null;
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

function calcShowdownEquity(hand, heroCardsStr, opponentCardsArr, boardCardsStr, gameCfg, gameEval, folded, replayHeroIdx) {
  if (!gameEval) return null;
  const bCards = boardCardsStr ? parseCardNotation(boardCardsStr).filter(c => c.suit !== 'x') : [];
  const getScore = (holeStr) => {
    try {
      const hole = parseCardNotation(holeStr).filter(c => c.suit !== 'x');
      if (hole.length < 2) return 0;
      const all = hole.concat(bCards);
      let ev;
      if (gameEval.type === 'low') {
        ev = gameEval.lowType === 'a5' ? bestLowA5Hand(all, false) : bestLow27Hand(all);
        return ev && ev.score < Infinity ? (1e9 - ev.score) : 0;
      }
      if (gameEval.type === 'hilo') {
        const hiEv = gameEval.method === 'omaha' ? bestOmahaHigh(hole, bCards) : bestHighHand(all);
        const loEv = gameEval.method === 'omaha' ? bestOmahaLow(hole, bCards) : bestLowA5Hand(all, true);
        const hiScore = hiEv && hiEv.score ? hiEv.score : 0;
        const loScore = loEv && loEv.qualified ? (1e9 - loEv.score) : 0;
        return hiScore + loScore;
      }
      if (gameEval.method === 'omaha') ev = bestOmahaHigh(hole, bCards);
      else ev = bestHighHand(all);
      return ev && ev.score ? ev.score : 0;
    } catch { return 0; }
  };
  const activePlayers = [];
  hand.players.forEach((p, pi) => { if (!folded.has(pi)) activePlayers.push(pi); });
  if (activePlayers.length < 2) return null;
  const scores = {};
  activePlayers.forEach(pi => {
    const cards = pi === replayHeroIdx ? heroCardsStr : (opponentCardsArr[pi] || '');
    if (!cards || cards === 'MUCK') { scores[pi] = 0; return; }
    scores[pi] = getScore(cards);
  });
  let totalScore = 0;
  activePlayers.forEach(pi => { totalScore += Math.max(scores[pi] || 0, 1); });
  const equities = {};
  activePlayers.forEach(pi => { equities[pi] = Math.round((Math.max(scores[pi] || 0, 1) / totalScore) * 100); });
  return equities;
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
  const chips = getChipBreakdown(amount);
  const stacks = [];
  let current = null;
  chips.forEach(color => {
    if (current && current.color === color) current.count++;
    else { current = { color, count: 1 }; stacks.push(current); }
  });
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
              style={{ '--chip': stack.color, '--pip-shift': pipShift(amount + i * 977, j),
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

   34: and the fan was a pure 2D rotation, which is cards printed on a page.
   A real fan also lifts each successive card slightly out of the plane, so it
   grows a little and throws a longer shadow toward the top of the arc. */
function getSplayStyle(index, total, angle, yOffset, reverseZ, wide, fanTotal) {
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
  const slots = Math.max(total, fanTotal || total);
  /* Both the arc's radius and the step are sized on the FINISHED hand, so the
     fan does not change curve or spacing as cards arrive. Measured: a side
     seat sits 15.6% in from the table's edge, which caps a fan at about 2.4
     card widths across — 1.2 out from centre. The hero sits at the bottom with
     no neighbour and the whole width to itself. */
  const radiusCards = wide ? (slots <= 5 ? 2.9 : 3.7) : (slots <= 5 ? 2.4 : 3.0);
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
  const maxHalfSpan = wide ? 1.8 : 1.05;
  const halfSlots = (slots - 1) / 2;
  const baseStep = (2 * angle) / 3;
  const cappedStep = halfSlots > 0
    ? Math.asin(Math.min(1, maxHalfSpan / radiusCards)) * (180 / Math.PI) / halfSlots
    : baseStep;
  const step = Math.min(baseStep, cappedStep);
  const rot = (index - (total - 1) / 2) * step;
  const extraY = yOffset || 0;
  const z = reverseZ ? (total - 1 - index) : index;
  // The lift runs along the arc, not with the z-order, so a reversed fan still
  // lifts in the direction the hand is held.
  const lift = index / Math.max(1, total - 1);
  const scale = 1 + lift * 0.05;
  const shadow = 'drop-shadow(' + (-1 - lift * 2).toFixed(1) + 'px '
    + (1 + lift * 2).toFixed(1) + 'px ' + (2 + lift * 3).toFixed(1) + 'px rgba(0,0,0,0.5))';
  if (total <= 2) {
    return {
      transform: 'rotate(' + rot + 'deg) scale(' + scale.toFixed(3) + ')',
      transformOrigin: '18% 118%',
      marginLeft: index === 0 ? 0 : 'calc(var(--card-w) * -0.65)',
      marginTop: extraY || undefined,
      filter: shadow,
      zIndex: z,
    };
  }
  // 3+ cards: arc from a true shared pivot point using trig. The pivot sits
  // left of centre, so the arc opens the way a thumb opens it.
  const rad = rot * Math.PI / 180;
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
    transform: 'translate(calc(-50% + ' + x.toFixed(3) + ' * var(--card-w)), calc('
      + y.toFixed(3) + ' * var(--card-w) + ' + extraY + 'px)) rotate('
      + rot + 'deg) scale(' + scale.toFixed(3) + ')',
    transformOrigin: '18% 118%',
    filter: shadow,
    zIndex: z,
  };
}

function CardRow({ text, stud, max, placeholderCount, splay, cardTheme, reverseZ, wideFan }) {
  const SUIT_SYMBOLS = {h:'\u2665',d:'\u2666',c:'\u2663',s:'\u2660'};
  let cards = parseCardNotation(text);
  if (!cards.length && placeholderCount > 0) {
    return (
      <div className={"card-row" + (splay ? " card-row-splay" : "")}>
        {Array.from({ length: placeholderCount }, (_, i) => {
          const style = { '--ci': i, ...(splay ? getSplayStyle(i, placeholderCount, splay, 0, reverseZ) : null) };
          return <div key={'ph' + i} className="card-placeholder" style={style} />;
        })}
      </div>
    );
  }
  if (!cards.length) return null;
  if (max && cards.length > max) cards = cards.slice(0, max);
  const downIdx = stud ? new Set([0, 1, 6]) : null;
  /* One z-order for the whole row. reverseZ exists for a hand that is face
     DOWN, where putting the leftmost card on top buries no rank because there
     are none. Deciding it per CARD mixed the two orders inside one hand: a
     stud hand's two down cards took the reversed order and sat on top of the
     up cards beside them, burying exactly the ranks the fan exists to show.
     So it reverses only when nothing in the row is face up. */
  const rowReverseZ = reverseZ && !cards.some((c, i) => c.suit !== 'x' && !(downIdx && downIdx.has(i)));
  return (
    <div className={"card-row" + (splay ? " card-row-splay" : "")}>
      {cards.map((c, i) => {
        const k = c.rank + c.suit + '_' + i;
        const isDown = downIdx && downIdx.has(i);
        const isStudUp = stud && !isDown && i >= 2 && i <= 5;
        const studYOffset = isStudUp ? -5 : isDown ? 5 : 0;
        // A revealed face never reverses: the rank index lives at top-left only,
        // so leftmost-on-top buries every rank but the first.
        // 63: --ci is the card's place in the hand. The per-card deal
        // stagger multiplies it by one round of the table, so a hand is dealt
        // one card at a time round the seats rather than arriving as a block.
        const splayStyle = { '--ci': i, ...(splay
          ? getSplayStyle(i, cards.length, splay, studYOffset, rowReverseZ, wideFan, max)
          : null) };
        if (c.suit === 'x' || (isDown && c.suit === 'x')) {
          return <div key={k} className="card-unknown" style={splayStyle} />;
        }
        if (cardTheme === 'classic') {
          // One class per suit. The old red/dark binary made Ah and Ad — and
          // As and Ac — pixel-identical apart from a ~9px glyph, which is not
          // a suit signal at the speed a replay runs.
          return (
            <div key={k} className={'card-classic card-classic-' + c.suit}
              style={splayStyle}>
              <span className="card-classic-rank">{c.rank.toUpperCase()}</span>
              <span className="card-classic-suit">{SUIT_SYMBOLS[c.suit] || ''}</span>
            </div>
          );
        }
        return <img key={k} className="card-img"
          src={'/cards/cards_gui_' + c.rank + c.suit + '.svg'}
          alt={c.rank+c.suit} loading="eager"
          style={splayStyle} />;
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
  { id: 'neon-vegas', label: 'Neon Vegas', lit: '#5b1a7a', shade: '#0b0416' },
  { id: 'vintage', label: 'Vintage', lit: '#9a7c4a', shade: '#2c2113' },
  { id: 'minimalist', label: 'Minimalist', lit: '#f4f4f6', shade: '#d8d8de' },
  { id: 'high-stakes', label: 'High Stakes', lit: '#3a3a3a', shade: '#101010' },
];
const REPLAYER_CARD_BACKS = [
  { id: 'default', label: 'Default' }, { id: 'classic', label: 'Classic Blue' },
  { id: 'casino-red', label: 'Casino Red' }, { id: 'black-diamond', label: 'Black Diamond' },
  { id: 'bicycle', label: 'Bicycle' }, { id: 'custom', label: 'Custom Color' },
];
const REPLAYER_TABLE_SHAPES = [
  { id: 'oval', label: 'Oval' }, { id: 'round', label: 'Round' }, { id: 'octagon', label: 'Octagon' },
];

function useReplayerSetting(key, defaultVal) {
  const fullKey = 'replayer' + key;
  const [val, setVal] = useState(() => {
    const stored = localStorage.getItem(fullKey);
    if (stored === null) return defaultVal;
    if (defaultVal === true || defaultVal === false) return stored === 'true';
    return stored;
  });
  const update = useCallback(v => { setVal(v); localStorage.setItem(fullKey, String(v)); }, [fullKey]);
  return [val, update];
}

// ── Settings Panel ──
function ReplayerSettingsPanel({ onClose, settings, onUpdate }) {
  return createPortal(
    <>
      <div className="replayer-settings-backdrop" onClick={onClose} />
      <div className="replayer-settings-panel">
        <div className="replayer-settings-header">
          <span>Replayer Settings</span>
          <button className="replayer-settings-close" onClick={onClose}>&times;</button>
        </div>
        <div className="replayer-settings-group">
          <div className="replayer-settings-group-title">Table</div>
          <div className="replayer-settings-row is-stacked">
            <div className="replayer-settings-label">Theme</div>
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
                  <span className="thumb-label">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="replayer-settings-row is-stacked">
            <div className="replayer-settings-label">Table Shape</div>
            <div className="replayer-settings-pills">
              {REPLAYER_TABLE_SHAPES.map(s => (
                <button key={s.id} className={'replayer-settings-pill' + (settings.tableShape === s.id ? ' active' : '')}
                  onClick={() => onUpdate('tableShape', s.id)}>{s.label}</button>
              ))}
            </div>
          </div>
          {settings.theme === 'default' && (
            <div className="replayer-settings-row is-stacked">
              <div className="replayer-settings-label">Felt Color</div>
              <div className="replayer-settings-swatches">
                {[
                  { name:'Lavender', color:'#6b5b8a' }, { name:'Classic Green', color:'#2d5a27' },
                  { name:'Blue', color:'#1a3a5c' }, { name:'Red', color:'#5a1a1a' },
                  { name:'Purple', color:'#3d1a5a' }, { name:'Black', color:'#1a1a1a' },
                ].map(fc => (
                  <button key={fc.color} className={'felt-color-swatch' + (settings.feltColor === fc.color ? ' active' : '')}
                    style={{ background: fc.color }} title={fc.name}
                    onClick={() => onUpdate('feltColor', fc.color)} />
                ))}
                {/* 68: this was a 24px rectangle sitting in a row of circles. */}
                <span className="felt-color-custom" title="Custom color">
                  <input type="color" value={settings.feltColor} aria-label="Custom felt color"
                    onChange={e => onUpdate('feltColor', e.target.value)} />
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="replayer-settings-group">
          <div className="replayer-settings-group-title">Cards</div>
          <div className="replayer-settings-row is-stacked">
            <div className="replayer-settings-label">Card Back Design</div>
            <div className="replayer-settings-pills">
              {/* 79: same argument. A card back is a picture. */}
              {REPLAYER_CARD_BACKS.map(cb => (
                <button key={cb.id} className={'replayer-settings-thumb' + (settings.cardBack === cb.id ? ' active' : '')}
                  aria-pressed={settings.cardBack === cb.id}
                  onClick={() => onUpdate('cardBack', cb.id)}>
                  <span className="thumb-back" aria-hidden="true">
                    <span className={'replayer-table'} data-cardback={cb.id}>
                      <span className="card-row"><span className="card-unknown" /></span>
                    </span>
                  </span>
                  <span className="thumb-label">{cb.label}</span>
                </button>
              ))}
            </div>
          </div>
          {settings.cardBack === 'custom' && (
            <div className="replayer-settings-row">
              <div className="replayer-settings-label">Custom Card Back Color</div>
              <span className="felt-color-custom" title="Custom card back color">
                <input type="color" value={settings.cardBackColor} aria-label="Custom card back color"
                  onChange={e => onUpdate('cardBackColor', e.target.value)} />
              </span>
            </div>
          )}
          <div className="replayer-settings-row is-stacked">
            <div className="replayer-settings-label">Card Front Style</div>
            <div className="replayer-settings-pills">
              {[{ id: 'default', label: 'Standard' }, { id: 'classic', label: 'Classic' }].map(ct => (
                <button key={ct.id} className={'replayer-settings-pill' + (settings.cardTheme === ct.id ? ' active' : '')}
                  onClick={() => onUpdate('cardTheme', ct.id)}>{ct.label}</button>
              ))}
            </div>
          </div>
          <div className="replayer-settings-row">
            <div>
              <div className="replayer-settings-label">High-Contrast Deck</div>
              <div className="replayer-settings-sublabel">Lifts the suits off the felt</div>
            </div>
            <button
              className={'replayer-settings-toggle' + (settings.highContrastDeck ? ' on' : '')}
              aria-pressed={!!settings.highContrastDeck}
              aria-label="High-contrast deck"
              onClick={() => onUpdate('highContrastDeck', !settings.highContrastDeck)} />
          </div>
          {/* 70: only the high-contrast toggle three rows up had aria-pressed
              and a label. Every other switch in this panel — Splay, Rail
              Light, seven Display rows and five Animation rows — was a bare
              <button> with no text inside, which is an unnamed, stateless
              control to a screen reader: thirteen buttons all announcing
              "button". The pattern was already written; it just stopped. */}
          <div className="replayer-settings-row">
            <div className="replayer-settings-label">Splay Hole Cards</div>
            <button className={'replayer-settings-toggle' + (settings.cardSplay ? ' on' : '')}
              aria-pressed={!!settings.cardSplay} aria-label="Splay hole cards"
              onClick={() => onUpdate('cardSplay', !settings.cardSplay)} />
          </div>
          <div className="replayer-settings-row">
            <div className="replayer-settings-label">Rail Light Strip</div>
            <button className={'replayer-settings-toggle' + (settings.lightStrip ? ' on' : '')}
              aria-pressed={!!settings.lightStrip} aria-label="Rail light strip"
              onClick={() => onUpdate('lightStrip', !settings.lightStrip)} />
          </div>
        </div>
        <div className="replayer-settings-group">
          <div className="replayer-settings-group-title">Display</div>
          {/* 80: twelve switches in one undifferentiated column is a
              preferences pane. Two groups is a set of decisions — what is on
              the felt, and what is analysis laid over it. */}
          {[
            { key:'showChipStacks', label:'Pot Chip Stacks', sub:'Chips in the pot, by denomination' },
            { key:'showCommentary', label:'Commentator Mode', sub:'A play-by-play line under the table' },
            { key:'showTimeline', label:'Action Timeline', sub:'A scrubbable dot per action' },
            { key:'showPlayerStats', label:'Player Stats', sub:'A stats chip on each seat' },
            { key:'stacksInBB', label:'Stacks in Big Blinds', sub:'Read the table in BB instead of chips' },
          ].map(opt => (
            <div key={opt.key} className="replayer-settings-row">
              <div>
                <div className="replayer-settings-label">{opt.label}</div>
                <div className="replayer-settings-sublabel">{opt.sub}</div>
              </div>
              <button className={'replayer-settings-toggle' + (settings[opt.key] ? ' on' : '')}
                aria-pressed={!!settings[opt.key]} aria-label={opt.label}
                onClick={() => onUpdate(opt.key, !settings[opt.key])} />
            </div>
          ))}
        </div>
        {/* 80: the analysis overlays are a different kind of decision from
            "what is on the felt", and there are seven of them. Closed by
            default, because a first-time reader is not looking for SPR. */}
        <details className="replayer-settings-group replayer-settings-fold">
          <summary className="replayer-settings-group-title">Analysis overlays</summary>
          {[
            { key:'showHandStrength', label:'Hand Strength Meter', sub:'A gauge of relative hand strength' },
            { key:'showPotOdds', label:'Pot Odds', sub:'The price you are being laid, when facing a bet' },
            { key:'showNutsHighlight', label:'Highlight the Nuts', sub:'A glow when you hold the best hand' },
            { key:'showSPR', label:'Stack-to-Pot Ratio', sub:'SPR under the pot, from the flop on' },
            { key:'showBetSizing', label:'Bet Sizing', sub:'A pot-relative label on each wager' },
            { key:'showRanges', label:'Range Read', sub:'An estimated strength tier per opponent' },
            { key:'showEquity', label:'Showdown Equity', sub:'Who is ahead once the cards are up' },
          ].map(opt => (
            <div key={opt.key} className="replayer-settings-row">
              <div>
                <div className="replayer-settings-label">{opt.label}</div>
                <div className="replayer-settings-sublabel">{opt.sub}</div>
              </div>
              <button className={'replayer-settings-toggle' + (settings[opt.key] ? ' on' : '')}
                aria-pressed={!!settings[opt.key]} aria-label={opt.label}
                onClick={() => onUpdate(opt.key, !settings[opt.key])} />
            </div>
          ))}
        </details>
        <div className="replayer-settings-group">
          <div className="replayer-settings-group-title">Animation</div>
          {[
            /* 57: the panel promised Winner Effects and animateWinner was
               never read anywhere — the glow applied unconditionally — while
               animateDeal, whose sub-line said "cards slide in when dealt",
               was actually gating the FOLD animation, the showdown reveal and
               draw discards, and the deal animation did not exist. Each switch
               now controls the thing it names. */
            { key:'animateDeal', label:'Deal Animation', sub:'Cards fly in at the top of a hand' },
            { key:'animateFold', label:'Fold & Muck', sub:'Folded cards slide away to the muck' },
            { key:'animateChips', label:'Chip Animation', sub:'The pot ships to the winner' },
            { key:'animateBoard', label:'Board Flip', sub:'Board cards flip face-up' },
            { key:'animateWinner', label:'Winner Effects', sub:'Bounce and glow on winning hand' },
          ].map(opt => (
            <div key={opt.key} className="replayer-settings-row">
              <div>
                <div className="replayer-settings-label">{opt.label}</div>
                <div className="replayer-settings-sublabel">{opt.sub}</div>
              </div>
              <button className={'replayer-settings-toggle' + (settings[opt.key] ? ' on' : '')}
                aria-pressed={!!settings[opt.key]} aria-label={opt.label}
                onClick={() => onUpdate(opt.key, !settings[opt.key])} />
            </div>
          ))}
        </div>
        {/* 99: four disabled rows labelled "Coming Soon", on screen long
            enough to have accumulated their own accessibility treatment — a
            promise the interface kept making and never kept. The four are
            synthesised rather than sampled: no asset, no licence, nothing
            added to the bundle, and no cold start on the first card. */}
        <div className="replayer-settings-group">
          <div className="replayer-settings-group-title">Sound</div>
          {[
            { key:'soundDeal', label:'Card Deal', sub:'A short hiss as each card lands' },
            { key:'soundChips', label:'Chips', sub:'Clay on clay, when a wager moves' },
            { key:'soundFold', label:'Fold', sub:'Cards pushed away' },
            { key:'soundAllIn', label:'All-In', sub:'The one moment that earns a pitch' },
          ].map(opt => (
            <div key={opt.key} className="replayer-settings-row">
              <div>
                <div className="replayer-settings-label">{opt.label}</div>
                <div className="replayer-settings-sublabel">{opt.sub}</div>
              </div>
              <button className={'replayer-settings-toggle' + (settings[opt.key] ? ' on' : '')}
                aria-pressed={!!settings[opt.key]} aria-label={opt.label}
                onClick={() => onUpdate(opt.key, !settings[opt.key])} />
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}

// ── Hand Replayer Entry (Classic mode) ──
function HandReplayerEntry({ hand, setHand, onDone, onCancel }) {
  const [currentStreetIdx, setCurrentStreetIdx] = useState(0);
  const [actionAmount, setActionAmount] = useState('');
  const gameCfg = HAND_CONFIG[hand.gameType] || HAND_CONFIG_DEFAULT;
  const streetDef = getStreetDef(hand.gameType);
  const category = getGameCategory(hand.gameType);
  const currentStreet = hand.streets[currentStreetIdx] || hand.streets[0];

  const updateStreet = (streetIdx, updater) => {
    setHand(prev => ({
      ...prev,
      streets: prev.streets.map((s, i) => i === streetIdx ? updater({ ...s }) : s)
    }));
  };

  const bettingContext = useMemo(() => {
    const street = hand.streets[currentStreetIdx];
    const actions = street ? (street.actions || []) : [];
    const betting = gameCfg.betting || 'nl';
    const blinds = hand.blinds || {};
    const sb = blinds.sb || 0;
    const bb = blinds.bb || 0;
    const ante = blinds.ante || 0;
    const isSmallBetStreet = (gameCfg.flSmallStreets || []).includes(currentStreetIdx);
    const stud4thOpenPair = gameCfg.isStud && currentStreetIdx === 1 && studHasOpenPairOn4th(hand);
    const bigBet = (hand.blinds || {}).bigBet || (bb || 100) * 2;
    const fixedBet = betting === 'fl' ? ((isSmallBetStreet && !stud4thOpenPair) ? (bb || 100) : bigBet) : 0;
    const raiseCap = (hand.blinds || {}).betCap || gameCfg.raiseCap || 4;
    let maxBet = 0, raiseCount = 0;
    const isBBanteCtx = category !== 'stud' && ante > 0;
    let totalPot = isBBanteCtx ? 0 : ante * hand.players.length;
    const playerContrib = {};
    if (currentStreetIdx === 0 && (gameCfg.hasBoard || !gameCfg.isStud)) {
      const sbIdx = hand.players.findIndex(p => p.position === 'SB' || p.position === 'BTN/SB');
      const bbIdx = hand.players.findIndex(p => p.position === 'BB');
      if (sbIdx >= 0) playerContrib[sbIdx] = sb;
      if (bbIdx >= 0) playerContrib[bbIdx] = bb;
      maxBet = bb;
      totalPot += sb + bb;
      if (isBBanteCtx) totalPot += ante;
    }
    for (let i = 0; i < actions.length; i++) {
      const act = actions[i];
      const prevContrib = playerContrib[act.player] || 0;
      if (act.action === 'fold') continue;
      if (['bet','raise','call','all-in'].includes(act.action)) {
        playerContrib[act.player] = prevContrib + (act.amount || 0);
        totalPot += (act.amount || 0);
        if (playerContrib[act.player] > maxBet) maxBet = playerContrib[act.player];
        if (act.action === 'bet') raiseCount = 1;
        else if (act.action === 'raise') raiseCount++;
      } else if (act.action === 'bring-in') {
        playerContrib[act.player] = act.amount || 0;
        totalPot += (act.amount || 0);
        if (playerContrib[act.player] > maxBet) maxBet = playerContrib[act.player];
      }
    }
    const foldedPlayers = new Set(actions.filter(a => a.action === 'fold').map(a => a.player));
    const activePlayers = hand.players.map((_, i) => i).filter(i => !foldedPlayers.has(i));
    const nextPlayer = activePlayers[actions.length % activePlayers.length] || 0;
    const nextPlayerInvested = playerContrib[nextPlayer] || 0;
    const facingBet = maxBet > nextPlayerInvested;
    const callAmount = Math.max(maxBet - nextPlayerInvested, 0);
    let raiseToAmount = 0, betAmount = 0, potRaiseAmount = 0, potRaiseIncrement = 0, canRaise = true;
    if (betting === 'fl') {
      betAmount = fixedBet; raiseToAmount = maxBet + fixedBet; canRaise = raiseCount < raiseCap;
    } else if (betting === 'pl') {
      const potAfterCall = totalPot + callAmount;
      potRaiseAmount = maxBet + potAfterCall;
      potRaiseIncrement = potRaiseAmount - nextPlayerInvested;
      betAmount = totalPot; raiseToAmount = potRaiseAmount;
    }
    return { betting, facingBet, currentBet:maxBet, callAmount, raiseCount, raiseCap, fixedBet, betAmount, raiseToAmount, potRaiseAmount, potRaiseIncrement, canRaise, nextPlayer, totalPot, nextPlayerInvested };
  }, [hand, currentStreetIdx, gameCfg]);

  const addAction = (action) => {
    const ctx = bettingContext;
    let amount = 0;
    if (action === 'bet') {
      let rawBet = ctx.betting === 'fl' ? ctx.fixedBet : (Number(actionAmount) || 0);
      if (ctx.betting === 'pl') rawBet = Math.min(rawBet, ctx.betAmount);
      amount = rawBet;
    } else if (action === 'raise') {
      if (ctx.betting === 'fl') { amount = ctx.raiseToAmount - ctx.nextPlayerInvested; }
      else { let typedTotal = Number(actionAmount) || 0; if (ctx.betting === 'pl') typedTotal = Math.min(typedTotal, ctx.potRaiseAmount); amount = typedTotal - ctx.nextPlayerInvested; }
    } else if (action === 'call') { amount = ctx.callAmount; }
    if (amount < 0) amount = 0;
    updateStreet(currentStreetIdx, s => ({ ...s, actions: [...(s.actions || []), { player: ctx.nextPlayer, action, amount }] }));
    setActionAmount('');
  };

  const removeLastAction = () => { updateStreet(currentStreetIdx, s => ({ ...s, actions: (s.actions || []).slice(0, -1) })); };

  const updatePlayerField = (idx, field, value) => {
    setHand(prev => ({ ...prev, players: prev.players.map((p, i) => i === idx ? { ...p, [field]: field === 'startingStack' ? (Number(value) || 0) : value } : p) }));
  };

  const setNumPlayers = (n) => {
    setHand(prev => {
      const positions = getPositionLabels(n);
      const players = Array.from({ length: n }, (_, i) => {
        if (prev.players[i]) return { ...prev.players[i], position: positions[i] || '' };
        return { name: i === 0 ? 'Hero' : 'Opp ' + i, position: positions[i] || '', startingStack: prev.players[0]?.startingStack || 50000 };
      });
      const streets = prev.streets.map(s => ({ ...s, cards: { ...s.cards, opponents: Array.from({ length: n - 1 }, (_, j) => s.cards.opponents[j] || '') } }));
      return { ...prev, players, streets };
    });
  };

  const updateHeroCards = (si, val) => updateStreet(si, s => ({ ...s, cards: { ...s.cards, hero: val } }));
  const updateBoardCards = (si, val) => updateStreet(si, s => ({ ...s, cards: { ...s.cards, board: val } }));
  const updateOpponentCards = (si, oi, val) => updateStreet(si, s => {
    const opponents = [...s.cards.opponents]; opponents[oi] = val;
    return { ...s, cards: { ...s.cards, opponents } };
  });
  const updateDrawDiscard = (si, pi, val) => updateStreet(si, s => {
    const draws = [...(s.draws || [])];
    const existing = draws.findIndex(d => d.player === pi);
    if (existing >= 0) draws[existing] = { ...draws[existing], discarded: Number(val) || 0 };
    else draws.push({ player: pi, discarded: Number(val) || 0, discardedCards: '', newCards: '' });
    return { ...s, draws };
  });
  const updateDrawField = (si, pi, field, val) => updateStreet(si, s => {
    const draws = [...(s.draws || [])];
    const existing = draws.findIndex(d => d.player === pi);
    if (existing >= 0) draws[existing] = { ...draws[existing], [field]: val };
    else { const entry = { player: pi, discarded: 0, discardedCards: '', newCards: '' }; entry[field] = val; draws.push(entry); }
    return { ...s, draws };
  });

  const { pot: currentPot } = calcPotsAndStacks(hand, currentStreetIdx, (currentStreet.actions || []).length - 1);

  return (
    <div className="replayer-entry">
      <div className="replayer-section">
        <div className="replayer-section-title">Players & Blinds</div>
        <div className="replayer-row" style={{marginBottom:'8px'}}>
          <div className="replayer-field" style={{flex:'0 0 70px'}}>
            <label>Players</label>
            <select value={hand.players.length} onChange={e => setNumPlayers(Number(e.target.value))}>
              {[2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="replayer-field"><label>SB</label><input type="text" inputMode="decimal" value={(hand.blinds||{}).sb || ''} onChange={e => setHand(prev => ({ ...prev, blinds: { ...(prev.blinds||{}), sb: Number(e.target.value)||0 } }))} /></div>
          <div className="replayer-field"><label>BB</label><input type="text" inputMode="decimal" value={(hand.blinds||{}).bb || ''} onChange={e => setHand(prev => ({ ...prev, blinds: { ...(prev.blinds||{}), bb: Number(e.target.value)||0 } }))} /></div>
          <div className="replayer-field"><label>{category === 'stud' ? 'Ante' : 'BB Ante'}</label><input type="text" inputMode="decimal" value={(hand.blinds||{}).ante || ''} onChange={e => setHand(prev => ({ ...prev, blinds: { ...(prev.blinds||{}), ante: Number(e.target.value)||0 } }))} /></div>
        </div>
        {hand.players.map((p, i) => (
          <div key={i} className="replayer-player-row">
            <span className="replayer-player-pos">{p.position}</span>
            <div className="replayer-field" style={{flex:'0 0 80px'}}><input type="text" value={p.name} onChange={e => updatePlayerField(i, 'name', e.target.value)} placeholder="Name" /></div>
            <div className="replayer-field" style={{flex:'0 0 80px'}}><input type="text" inputMode="decimal" value={p.startingStack} onChange={e => updatePlayerField(i, 'startingStack', e.target.value)} placeholder="Stack" /></div>
          </div>
        ))}
      </div>
      <div className="live-update-tabs">
        {hand.streets.map((s, i) => (<button key={i} className={currentStreetIdx === i ? 'active' : ''} onClick={() => setCurrentStreetIdx(i)}>{s.name}</button>))}
      </div>
      <div className="replayer-street">
        <div className="replayer-street-header">
          <span className="replayer-street-name">{currentStreet.name}</span>
          <span className="replayer-street-pot">Pot: {formatChipAmount(currentPot)}</span>
        </div>
        {/* 73: a focused border was the ONLY state these fields had, so
            "Ahh", a repeated card or a bare "A" simply produced no card row
            and no message — the input looked accepted and the saved hand was
            quietly wrong. checkCardText reports what the parser could not
            use, which is information the parser already has. */}
        <div className="replayer-field" style={{marginBottom:'6px'}}>
          <label>Hero Cards</label>
          <input type="text" className={checkCardText(currentStreet.cards.hero) ? 'is-invalid' : undefined}
            placeholder={gameCfg.heroPlaceholder ? dualPlaceholder(gameCfg.heroPlaceholder) : 'AhKd'} value={currentStreet.cards.hero} onChange={e => updateHeroCards(currentStreetIdx, e.target.value)} />
          {checkCardText(currentStreet.cards.hero) && <div className="replayer-field-error">{checkCardText(currentStreet.cards.hero)}</div>}
          <CardRow text={currentStreet.cards.hero} stud={gameCfg.isStud} max={gameCfg.heroCards} />
        </div>
        {category === 'community' && currentStreetIdx > 0 && (
          <div className="replayer-field" style={{marginBottom:'6px'}}>
            <label>Board ({currentStreet.name})</label>
            <input type="text" className={checkCardText(currentStreet.cards.board) ? 'is-invalid' : undefined}
              placeholder={gameCfg.boardPlaceholder || 'Qh7d2c'} value={currentStreet.cards.board} onChange={e => updateBoardCards(currentStreetIdx, e.target.value)} />
            {checkCardText(currentStreet.cards.board) && <div className="replayer-field-error">{checkCardText(currentStreet.cards.board)}</div>}
            <CardRow text={currentStreet.cards.board} max={streetDef.boardCards[currentStreetIdx]} />
          </div>
        )}
        {hand.players.slice(1).map((p, oi) => (
          <div key={oi} className="replayer-field" style={{marginBottom:'4px'}}>
            <label>{p.name} Cards</label>
            <input type="text" className={checkCardText((currentStreet.cards.opponents || [])[oi] || '') ? 'is-invalid' : undefined}
              placeholder={gameCfg.heroPlaceholder ? dualPlaceholder(gameCfg.heroPlaceholder) : 'XxXx'} value={(currentStreet.cards.opponents || [])[oi] || ''} onChange={e => updateOpponentCards(currentStreetIdx, oi, e.target.value)} />
            {checkCardText((currentStreet.cards.opponents || [])[oi] || '') && <div className="replayer-field-error">{checkCardText((currentStreet.cards.opponents || [])[oi] || '')}</div>}
            <CardRow text={(currentStreet.cards.opponents || [])[oi] || ''} stud={gameCfg.isStud} max={gameCfg.heroCards} placeholderCount={!(currentStreet.cards.opponents || [])[oi] ? gameCfg.heroCards : 0} />
          </div>
        ))}
        {(category === 'draw_triple' || category === 'draw_single') && currentStreetIdx > 0 && (
          <div className="replayer-draw-section">
            <div className="replayer-draw-label">{currentStreet.name || 'Draw'} -- Discards & Draws</div>
            {hand.players.map((p, pi) => {
              const draw = (currentStreet.draws || []).find(d => d.player === pi);
              const discardCount = draw ? draw.discarded : 0;
              const isPatText = discardCount === 0 && draw ? ' (Stand Pat)' : '';
              return (
                <div key={pi} className="replayer-draw-player-block" style={{marginBottom:'6px',padding:'4px 0',borderBottom:'1px solid var(--border)'}}>
                  <div className="replayer-row" style={{marginBottom:'2px',alignItems:'center'}}>
                    <span style={{fontSize:'0.65rem',color:'var(--text-muted)',minWidth:'55px',fontWeight: 'var(--fw-bold)'}}>{p.name}{isPatText}</span>
                    <div className="replayer-field" style={{flex:'0 0 45px'}}>
                      <label style={{fontSize:'0.55rem'}}>Discard</label>
                      <input type="number" min="0" max={gameCfg.heroCards || 5} value={draw ? draw.discarded : ''} onChange={e => updateDrawDiscard(currentStreetIdx, pi, e.target.value)} placeholder="0" />
                    </div>
                  </div>
                  {discardCount > 0 && (
                    <div className="replayer-row" style={{marginTop:'2px',gap:'4px'}}>
                      <div className="replayer-field" style={{flex:1}}>
                        {/* 74: an 8.8px label overriding a field-label rule that
                            is already tokenised at a readable size. */}
                        <label>Discarded Cards</label>
                        <input type="text" placeholder={'e.g. 7h3c'} value={(draw && draw.discardedCards) || ''} onChange={e => updateDrawField(currentStreetIdx, pi, 'discardedCards', e.target.value)} />
                        {draw?.discardedCards && <CardRow text={draw.discardedCards} max={discardCount} />}
                      </div>
                      <div className="replayer-field" style={{flex:1}}>
                        <label>New Cards</label>
                        <input type="text" placeholder={'e.g. Ah5s'} value={(draw && draw.newCards) || ''} onChange={e => updateDrawField(currentStreetIdx, pi, 'newCards', e.target.value)} />
                        {draw?.newCards && <CardRow text={draw.newCards} max={discardCount} />}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="replayer-action-list">
          {(currentStreet.actions || []).map((act, ai) => (
            <div key={ai} className="replayer-action-item">
              <span className="replayer-action-player">{hand.players[act.player]?.name || '?'}</span>
              <span className={`replayer-action-type ${act.action}`}>{act.action}</span>
              {act.amount > 0 && <span className="replayer-action-amount">{formatChipAmount(act.amount)}</span>}
              <span className="replayer-action-remove" onClick={() => { if (ai === (currentStreet.actions || []).length - 1) removeLastAction(); }}>&times;</span>
            </div>
          ))}
        </div>
        {bettingContext.betting !== 'fl' && (
          <div className="replayer-row" style={{marginTop:'6px',gap:'4px'}}>
            <div className="replayer-field" style={{flex:'0 0 80px'}}>
              <input type="text" inputMode="decimal" placeholder={bettingContext.betting === 'pl' ? (bettingContext.facingBet ? 'Raise to (max ' + formatChipAmount(bettingContext.potRaiseAmount) + ')' : 'Bet (max ' + formatChipAmount(bettingContext.betAmount) + ')') : 'Amount'} value={actionAmount} onChange={e => setActionAmount(e.target.value)} />
            </div>
            {bettingContext.betting === 'pl' && (
              /* 74: a 0.6rem button with five inline literals sitting beside
                 the amount field. It is an action helper; it looks like one. */
              <button className="replayer-pot-helper"
                onClick={() => setActionAmount(String(bettingContext.facingBet ? bettingContext.potRaiseAmount : bettingContext.betAmount))}>
                {bettingContext.facingBet ? 'Pot Raise' : 'Pot Bet'}
              </button>
            )}
          </div>
        )}
        <div className="replayer-action-btns">
          {bettingContext.facingBet ? (
            <>
              <button className="action-fold" onClick={() => addAction('fold')}>Fold</button>
              <button className="action-call" onClick={() => addAction('call')}>Call {formatChipAmount(bettingContext.callAmount)}</button>
              {bettingContext.canRaise && (<button className="action-raise" onClick={() => addAction('raise')}>{bettingContext.betting === 'fl' ? 'Raise to ' + formatChipAmount(bettingContext.raiseToAmount) : 'Raise'}</button>)}
            </>
          ) : (
            <>
              <button onClick={() => addAction('check')}>Check</button>
              <button className="action-bet" onClick={() => addAction('bet')}>{bettingContext.betting === 'fl' ? 'Bet ' + formatChipAmount(bettingContext.fixedBet) : 'Bet'}</button>
            </>
          )}
        </div>
      </div>
      <div className="replayer-section">
        <div className="replayer-section-title">Result (optional)</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:'4px'}}>
          {hand.players.map((p, pi) => {
            const winners = hand.result?.winners || [];
            const isWinner = winners.some(w => w.playerIdx === pi && !w.split);
            const isSplit = winners.some(w => w.playerIdx === pi && w.split);
            return (
              /* 72: this was padding, a font-family STRING, a size, a
                 transition:all and a hardcoded green/amber pair inline —
                 exactly the literals the status ramps were declared to
                 retire — and transition:all meant hovering also animated
                 border-radius, for free, forever. */
              <button key={pi}
                className={'replayer-winner-btn' + (isWinner ? ' is-win' : isSplit ? ' is-split' : '')}
                aria-pressed={isWinner || isSplit}
                onClick={() => {
                setHand(prev => {
                  const prevWinners = prev.result?.winners || [];
                  const existing = prevWinners.find(w => w.playerIdx === pi);
                  let newWinners;
                  if (!existing) newWinners = [...prevWinners, { playerIdx: pi, split: false, label: '' }];
                  else if (!existing.split) newWinners = prevWinners.map(w => w.playerIdx === pi ? { ...w, split: true } : w);
                  else newWinners = prevWinners.filter(w => w.playerIdx !== pi);
                  return { ...prev, result: { ...prev.result, winners: newWinners } };
                });
              }}>
                {p.name} {isWinner ? '(Win)' : isSplit ? '(Split)' : ''}
              </button>
            );
          })}
        </div>
        <div className="replayer-field-hint">{'Tap to cycle: none \u2192 win \u2192 split \u2192 none'}</div>
      </div>
      <div style={{display:'flex',gap:'6px',justifyContent:'flex-end'}}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={() => onDone(hand)}>Save & Replay</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ── GTOEntryView (GTO-style phased hand entry) ──────────
// ══════════════════════════════════════════════════════════
function GTOEntryView({ hand, setHand, onDone, onCancel, heroName }) {
  const [phase, setPhase] = useState('setup');
  // Which seat is under the finger, so the row it belongs to can show it.
  const [dragSeat, setDragSeat] = useState(null);
  const [currentStreetIdx, setCurrentStreetIdx] = useState(0);
  const [showRaiseInput, setShowRaiseInput] = useState(false);
  const [betAmount, setBetAmount] = useState('');
  const [showHeroCardPicker, setShowHeroCardPicker] = useState(false);
  const [studDealTarget, setStudDealTarget] = useState(0);
  const activeSeatRef = useRef(null);

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

  const isRazz = hand.gameType === 'Razz' || hand.gameType === '2-7 Razz';
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

  const seatOrder = useMemo(() => getActionOrder(hand.players, isPreflop, studInfo), [hand.players, isPreflop, studInfo]);
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
    }
    (currentStreet.actions || []).forEach(act => {
      if (act.action === 'fold') return;
      if (act.action === 'bring-in') { contrib[act.player] = act.amount || bringInAmount; if (contrib[act.player] > maxBet) maxBet = contrib[act.player]; return; }
      if (act.amount > 0) { contrib[act.player] += act.amount; if (contrib[act.player] > maxBet) maxBet = contrib[act.player]; }
    });
    return { contrib, maxBet };
  }, [currentStreet.actions, isPreflop, hand.players, hand.blinds, category, bringInAmount]);

  const currentActor = useMemo(() => {
    const actions = currentStreet.actions || [];
    if (actionOrder.length === 0) return -1;
    let lastRaiserPlayer = -1, lastRaiseIdx = -1;
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i].action === 'raise' || actions[i].action === 'bet') { lastRaiseIdx = i; lastRaiserPlayer = actions[i].player; break; }
    }
    let startOi = 0;
    if (lastRaiserPlayer >= 0) { const raiserPos = actionOrder.indexOf(lastRaiserPlayer); if (raiserPos >= 0) startOi = raiserPos + 1; }
    for (let count = 0; count < actionOrder.length; count++) {
      const oi = (startOi + count) % actionOrder.length;
      const pidx = actionOrder[oi];
      let lastActIdx = -1;
      for (let j = actions.length - 1; j >= 0; j--) { if (actions[j].player === pidx) { lastActIdx = j; break; } }
      if (lastActIdx < lastRaiseIdx) return pidx;
      if (lastActIdx === -1) return pidx;
    }
    return -1;
  }, [actionOrder, currentStreet.actions]);

  const isBettingComplete = currentActor === -1;
  const activePlayers = hand.players.filter((_, i) => !foldedSet.has(i));
  const handOver = activePlayers.length <= 1;

  useEffect(() => {
    if (phase !== 'action') return;
    if (handOver) { setPhase('result'); return; }
    if (!isBettingComplete) return;
    const nextStreet = currentStreetIdx + 1;
    if (nextStreet >= hand.streets.length) { setPhase('showdown'); return; }
    if (category === 'community') setPhase('board_entry');
    else if (category === 'stud') setPhase('stud_deal');
    else if (category === 'draw_triple' || category === 'draw_single') setPhase('draw_discard');
    else setCurrentStreetIdx(nextStreet);
  }, [isBettingComplete, phase, handOver]);

  useEffect(() => {
    if (['board_entry','stud_deal','draw_discard','draw_cards_entry','showdown','result'].includes(phase)) {
      const container = document.querySelector('.content-area');
      if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [phase]);

  // Scroll to active seat
  const scrollGenRef = useRef(0);
  useEffect(() => {
    if (phase !== 'action' || currentActor < 0) return;
    const gen = ++scrollGenRef.current;
    const tid = setTimeout(() => {
      if (gen !== scrollGenRef.current) return;
      const el = activeSeatRef.current;
      if (!el) return;
      const container = el.closest('.content-area');
      if (!container) return;
      const caTop = container.getBoundingClientRect().top;
      const sticky = container.querySelector('.gto-sticky-header');
      const stickyH = sticky ? sticky.getBoundingClientRect().bottom - caTop : 0;
      const elAbsTop = el.getBoundingClientRect().top - caTop + container.scrollTop;
      const target = elAbsTop - stickyH - 8;
      if (Math.abs(container.scrollTop - target) > 2) {
        container.scrollTo({ top: target, behavior: 'smooth' });
      }
    }, 180);
    return () => clearTimeout(tid);
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

  const updatePlayerField = (idx, field, value) => {
    setHand(prev => ({ ...prev, players: prev.players.map((p, i) => i !== idx ? p : { ...p, [field]: field === 'startingStack' ? (Number(value) || 0) : value }) }));
  };

  const setNumPlayers = (n) => {
    setHand(prev => {
      let heroI = prev.players.findIndex(p => p.name === (heroName || 'Hero'));
      if (heroI < 0) heroI = 0;
      const positions = getPositionLabels(n);
      const players = Array.from({ length: n }, (_, i) => {
        if (prev.players[i]) return { ...prev.players[i], position: positions[i] || '' };
        return { name: getSeatName(i, heroI, heroName), position: positions[i] || '', startingStack: prev.players[0] ? prev.players[0].startingStack : 50000 };
      });
      const streets = prev.streets.map(s => ({ ...s, cards: { ...s.cards, opponents: Array.from({ length: n - 1 }, (_, j) => (s.cards.opponents && s.cards.opponents[j]) || '') } }));
      return { ...prev, players, streets };
    });
  };

  let heroIdx = hand.players.findIndex(p => p.name === (heroName || 'Hero'));
  if (heroIdx < 0) heroIdx = 0;

  const setHeroSeat = (newIdx) => {
    if (newIdx === heroIdx) return;
    setHand(prev => {
      const n = prev.players.length;
      const shift = newIdx - heroIdx;
      const players = prev.players.map((p, i) => {
        const srcIdx = ((i - shift) % n + n) % n;
        const src = prev.players[srcIdx];
        return { ...p, name: src.name, startingStack: src.startingStack };
      });
      return { ...prev, players, heroIdx: newIdx };
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

  const playerContrib = currentActor >= 0 ? streetBets.contrib[currentActor] : 0;
  const callAmount = currentActor >= 0 ? Math.min(streetBets.maxBet - playerContrib, currentStacks[currentActor]) : 0;
  const canCheck = callAmount === 0;
  const playerStack = currentActor >= 0 ? currentStacks[currentActor] : 0;

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
  const stud4thOpenPair = gameCfg.isStud && currentStreetIdx === 1 && studHasOpenPairOn4th(hand);
  const flBetSize = (flIsSmall && !stud4thOpenPair)
    ? ((hand.blinds || {}).bb || 100)
    : ((hand.blinds || {}).bigBet || ((hand.blinds || {}).bb || 100) * 2);
  const flRaiseToTotal = streetBets.maxBet + flBetSize;
  const flRaiseIncrement = flRaiseToTotal - playerContrib;
  /* Heads-up used to lift the cap on every street, which is one house rule but
     not the one being asked for: uncapped heads up on the LAST street only,
     and only when the hand says so. Off, the cap holds everywhere. */
  const isLastStreet = currentStreetIdx === hand.streets.length - 1;
  const uncapHeadsUp = (hand.blinds || {}).uncapHeadsUp !== false;
  const flCanRaise = (uncapHeadsUp && isHeadsUp && isLastStreet) || streetBetRaiseCount < flRaiseCap;

  // Pot-limit: ante does NOT count as part of the pot preflop, but DOES postflop
  const blinds = hand.blinds || { sb: 0, bb: 0, ante: 0 };
  const isBBante = getGameCategory(hand.gameType) !== 'stud' && (blinds.ante || 0) > 0;
  const plAnteAdjust = (isPotLimit && isPreflop && isBBante) ? (blinds.ante || 0) : 0;
  const plEffectivePot = currentPot - plAnteAdjust;
  const plPotAfterCall = plEffectivePot + callAmount;
  const plRaiseToTotal = streetBets.maxBet + plPotAfterCall;
  const plMaxRaiseIncrement = plRaiseToTotal - playerContrib;
  const plMaxBet = plEffectivePot;

  // Min raise tracking
  let _prevMax = 0, _lastRaiseSize = (hand.blinds || {}).bb || 0;
  const _runContrib = new Array(hand.players.length).fill(0);
  if (isPreflop && category !== 'stud') {
    const _sbIdx = hand.players.findIndex(p => p.position === 'SB' || p.position === 'BTN/SB');
    const _bbIdx = hand.players.findIndex(p => p.position === 'BB');
    if (_sbIdx >= 0) _runContrib[_sbIdx] = (hand.blinds || {}).sb || 0;
    if (_bbIdx >= 0) _runContrib[_bbIdx] = (hand.blinds || {}).bb || 0;
    _prevMax = (hand.blinds || {}).bb || 0;
  }
  (currentStreet.actions || []).forEach(a => {
    if (a.action === 'fold') return;
    if (a.action === 'bring-in') { _runContrib[a.player] = a.amount || bringInAmount; _prevMax = Math.max(_prevMax, _runContrib[a.player]); return; }
    if (a.amount > 0) _runContrib[a.player] += a.amount;
    if (a.action === 'raise' || a.action === 'bet') { const newMax = _runContrib[a.player]; _lastRaiseSize = Math.max(newMax - _prevMax, (hand.blinds || {}).bb || 0); _prevMax = newMax; }
  });
  const minRaiseToTotal = streetBets.maxBet + _lastRaiseSize;
  const minRaiseIncrement = minRaiseToTotal - playerContrib;

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
    return (
      <div className="gto-entry">
        <div className="gto-phase-card"><div className="replayer-section">
          <div className="replayer-section-title">{isOfc ? 'Players' : 'Players & Blinds'}</div>
          <div className="replayer-row" style={{marginBottom:'8px'}}>
            <div className="replayer-field" style={{flex:'0 0 70px'}}>
              <label>Players</label>
              {isOfc ? (
                <select value={hand.players.length} onChange={e => setNumPlayersOfc(Number(e.target.value))}>
                  {[2,3].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              ) : (
                <select value={hand.players.length} onChange={e => setNumPlayers(Number(e.target.value))}>
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
            {!isOfc && category !== 'stud' && <div className="replayer-field"><label>SB</label><input type="text" inputMode="decimal" value={(hand.blinds||{}).sb||''} onChange={e => setHand(prev => ({...prev, blinds:{...(prev.blinds||{}), sb:Number(e.target.value)||0}}))} /></div>}
            {!isOfc && <div className="replayer-field"><label>{category === 'stud' ? 'Small Bet' : 'BB'}</label><input type="text" inputMode="decimal" value={(hand.blinds||{}).bb||''} onChange={e => (category === 'stud' ? setStudSized('bb', Number(e.target.value)||0) : setHand(prev => ({...prev, blinds:{...(prev.blinds||{}), bb:Number(e.target.value)||0}})))} /></div>}
            {!isOfc && category === 'stud' && <div className="replayer-field"><label>Big Bet</label><input type="text" inputMode="decimal" value={studBigBet||''} onChange={e => setStudSized('bigBet', Number(e.target.value)||0)} /></div>}
            {!isOfc && category === 'stud' && <div className="replayer-field"><label>Bring-in</label><input type="text" inputMode="decimal" value={studBringIn||''} onChange={e => setStudSized('bringIn', Number(e.target.value)||0)} /></div>}
            {!isOfc && <div className="replayer-field"><label>{category === 'stud' ? 'Ante (each)' : 'BB Ante'}</label><input type="text" inputMode="decimal" value={(hand.blinds||{}).ante||''} onChange={e => setHand(prev => ({...prev, blinds:{...(prev.blinds||{}), ante:Number(e.target.value)||0}}))} /></div>}
            {!isOfc && isLimitGame && <div className="replayer-field"><label>Cap</label><input type="text" inputMode="decimal" value={betCap||''} onChange={e => setBlind('betCap', Number(e.target.value)||0)} /></div>}
          </div>
          {!isOfc && isLimitGame && (
            <div className="replayer-settings-row" style={{padding:'6px 0'}}>
              <div>
                <div className="replayer-settings-label">Uncapped heads-up{category === 'stud' ? ' on 7th' : ' on the river'}</div>
                <div className="replayer-settings-sublabel">Two players left on the last street keep raising past the cap</div>
              </div>
              <button type="button" className={'replayer-settings-toggle' + (uncapHU ? ' on' : '')}
                aria-pressed={uncapHU} aria-label="Uncapped heads-up on the last street"
                onClick={() => setBlind('uncapHeadsUp', !uncapHU)} />
            </div>
          )}
          {category === 'stud' && (
            <div style={{fontSize:'0.68rem',color:'var(--text-muted)',marginBottom:'6px'}}>
              Every player antes, the low door card brings it in, and the big bet is bet from 5th street on. Stacks default to {STUD_STACK_BB} big bets; a street allows {betCap} bets.
            </div>
          )}
          {!isOfc && <div style={{marginBottom:'4px',display:'flex'}}><span style={{fontSize:'0.65rem',fontWeight: 'var(--fw-bold)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',width:'32px',textAlign:'center'}}>Hero</span></div>}
          {hand.players.map((p, i) => {
            const isHero = i === heroIdx;
            return (
              <div key={i} className={'replayer-player-row' + (dragSeat === i ? ' is-dragging' : '')}>
                {!isOfc && <span
                  className={'replayer-player-pos' + (isHero ? ' hero' : '') + (dragSeat === i ? ' is-grabbed' : '')}
                  title="Tap to make hero, drag to reorder"
                  onPointerDown={e => beginSeatDrag(e, i)}
                  onPointerMove={moveSeatDrag}
                  onPointerUp={endSeatDrag}
                  onPointerCancel={endSeatDrag}
                >{p.position}</span>}
                <div className="replayer-field" style={{flex:'1 1 80px'}}><input type="text" style={{textAlign:'left'}} value={p.name} onChange={e => updatePlayerField(i, 'name', e.target.value)} placeholder="Name" /></div>
                {!isOfc && <div className="replayer-field" style={{flex:'0 0 80px'}}><input type="text" inputMode="decimal" style={{textAlign:'right'}} value={p.startingStack} onChange={e => updatePlayerField(i, 'startingStack', e.target.value)} placeholder="Stack" /></div>}
              </div>
            );
          })}
        </div></div>
        <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',padding:'10px 0'}}>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          {/* Stud went straight to the door cards from here, which meant
              nothing ever asked hero for 3rd street: the door-card phase
              skips hero by design, the in-action picker is turned off for
              stud, and setPhase('hero_cards') was called from nowhere at all
              — the phase existed and was unreachable. Its own Next button
              already reads "Enter Door Cards" for stud, so this is the order
              it was built for. */}
          <button className="btn btn-primary btn-sm" onClick={() => setPhase(category === 'ofc' ? 'ofc_entry' : gameCfg.isStud ? 'hero_cards' : 'action')}>Next</button>
        </div>
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
    const [ofcPickerState, setOfcPickerState] = useState(null);
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
          <div style={{fontSize:'0.65rem',color:'var(--text-muted)',marginBottom:'10px'}}>
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
        {ofcValidMsg && <div style={{fontSize:'0.65rem',color:'#ef4444',padding:'4px 0'}}>{ofcValidMsg}</div>}
        <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',padding:'10px 0'}}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPhase('setup')}>Back</button>
          <button className="btn btn-primary btn-sm" disabled={!ofcValid} onClick={() => onDone(hand)}>Done</button>
        </div>
      </div>
    );
  }

  // ── HERO CARDS PHASE ──
  if (phase === 'hero_cards') {
    const heroCardsVal = (hand.streets[0] && hand.streets[0].cards.hero) || '';
    /* A stud hand is not dealt at once: three cards on 3rd street and one on
       each street after, stored that way too — getStudHeroAllCards accumulates
       cards.hero ACROSS streets. This phase writes streets[0], so it is asking
       for 3rd street alone. gameCfg.heroCards is 7 for stud, the size of the
       finished hand, and would invite all of it into the first street. */
    const heroMaxCards = gameCfg.isStud ? 3 : (gameCfg.heroCards || 2);
    const heroCardsLabel = gameCfg.isStud ? '3rd Street' : 'Hero Cards';
    const heroCurrentCards = parseCardNotation(heroCardsVal).filter(c => c.suit !== 'x').map(c => c.rank + c.suit);
    const heroCurrentSet = new Set(heroCurrentCards);
    const heroAllRanks = 'AKQJT98765432'.split('');
    const heroAllSuits = [{key:'h',color:'#ef4444'},{key:'d',color:'#3b82f6'},{key:'c',color:'#22c55e'},{key:'s',color:'var(--text)'}];
    /* Read the hand from `prev`, not from the closure. Both branches used
       heroCurrentCards and heroCardsVal, which are this render's values, so
       three taps landing before a re-render all built their answer from the
       same empty string and the last one won — one card out of three. The
       phase was unreachable when it was written, so nothing ever tapped it;
       the other card picker in this file already does it this way. */
    const toggleHeroCard = (card) => {
      setHand(prev => {
        const base = (prev.streets[0] && prev.streets[0].cards.hero) || '';
        const cur = parseCardNotation(base).filter(c => c.suit !== 'x').map(c => c.rank + c.suit);
        let next;
        if (cur.includes(card)) next = cur.filter(c => c !== card).join('');
        else {
          if (cur.length >= heroMaxCards) return prev;
          next = cur.concat(card).join('');
        }
        return { ...prev, streets: prev.streets.map((s, i) => i === 0 ? { ...s, cards: { ...s.cards, hero: next } } : s) };
      });
    };
    return (
      <div className="gto-entry">
        <div className="gto-phase-card">
          <div className="replayer-section">
            <div className="replayer-section-title">{heroCardsLabel}</div>
            <div className="replayer-field">
              <label>{gameCfg.isStud ? 'Two down, one up' : 'Your Cards'}</label>
              <input type="text" placeholder={gameCfg.isStud ? 'Ah7d2c' : (gameCfg.heroPlaceholder || 'AhKd')}
                value={heroCardsVal}
                onChange={e => setHand(prev => ({ ...prev, streets: prev.streets.map((s, i) => i === 0 ? { ...s, cards: { ...s.cards, hero: e.target.value } } : s) }))} />
              <CardRow text={heroCardsVal} stud={gameCfg.isStud} max={heroMaxCards} />
            </div>
            <div className="card-picker-grid">
              {heroAllSuits.map(suit => (
                <React.Fragment key={suit.key}>
                  {heroAllRanks.map(rank => {
                    const card = rank + suit.key;
                    const isSelected = heroCurrentSet.has(card);
                    return <button key={card} className={'card-picker-btn' + (isSelected ? ' selected' : '')} onClick={() => toggleHeroCard(card)}>
                      <img src={'/cards/cards_gui_' + rank + suit.key + '.svg'} alt={card} loading="eager" />
                    </button>;
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        <div className="gto-street-card">
          <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',padding:'10px 12px'}}>
            <button className="btn btn-ghost btn-sm" onClick={() => setPhase('setup')}>Back</button>
            <button className="btn btn-primary btn-sm" onClick={() => setPhase(gameCfg.isStud ? 'door_cards' : 'action')}>
              {gameCfg.isStud ? 'Enter Door Cards' : 'Start Action'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── BOARD ENTRY PHASE ──
  if (phase === 'board_entry') {
    const nextStreet = currentStreetIdx + 1;
    const streetName = (hand.streets[nextStreet] && hand.streets[nextStreet].name) || 'Next Street';
    const boardVal = (hand.streets[nextStreet] && hand.streets[nextStreet].cards.board) || '';
    const maxCards = streetDef.boardCards ? streetDef.boardCards[nextStreet] : 1;
    const usedCards = new Set();
    hand.streets.forEach(s => {
      parseCardNotation(s.cards.hero || '').forEach(c => { if (c.suit !== 'x') usedCards.add(c.rank + c.suit); });
      parseCardNotation(s.cards.board || '').forEach(c => { if (c.suit !== 'x') usedCards.add(c.rank + c.suit); });
      (s.cards.opponents || []).forEach(opp => { parseCardNotation(opp || '').forEach(c => { if (c.suit !== 'x') usedCards.add(c.rank + c.suit); }); });
    });
    const currentBoardCards = parseCardNotation(boardVal).filter(c => c.suit !== 'x').map(c => c.rank + c.suit);
    const currentBoardSet = new Set(currentBoardCards);
    currentBoardCards.forEach(c => usedCards.delete(c));
    const allRanks = 'AKQJT98765432'.split('');
    const allSuits = [{key:'h',color:'#ef4444'},{key:'d',color:'#3b82f6'},{key:'c',color:'#22c55e'},{key:'s',color:'var(--text)'}];

    const toggleCard = (card) => {
      if (currentBoardSet.has(card)) {
        const remaining = currentBoardCards.filter(c => c !== card);
        setHand(prev => ({ ...prev, streets: prev.streets.map((s, i) => i === nextStreet ? { ...s, cards: { ...s.cards, board: remaining.join('') } } : s) }));
      } else {
        if (currentBoardCards.length >= maxCards) return;
        setHand(prev => ({ ...prev, streets: prev.streets.map((s, i) => i === nextStreet ? { ...s, cards: { ...s.cards, board: boardVal + card } } : s) }));
      }
    };

    return (
      <div className="gto-entry">
        <div className="gto-phase-card">
          <div className="replayer-section" style={{textAlign:'center'}}>
            <div className="gto-street-label">Deal the {streetName}</div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'12px',margin:'8px 0'}}>
              {cumulativeBoard && <CardRow text={cumulativeBoard} max={5} />}
              {boardVal && <CardRow text={boardVal} max={maxCards} />}
            </div>
            <div className="replayer-field" style={{marginTop:'8px'}}>
              <label>{streetName} Cards</label>
              <input type="text" placeholder={nextStreet === 1 ? 'Qh7d2c' : 'Ts'} value={boardVal} onChange={e => setHand(prev => ({ ...prev, streets: prev.streets.map((s, i) => i === nextStreet ? { ...s, cards: { ...s.cards, board: e.target.value } } : s) }))} />
            </div>
            <div className="card-picker-grid">
              {allSuits.map(suit => (
                <React.Fragment key={suit.key}>
                  {allRanks.map(rank => {
                    const card = rank + suit.key;
                    const isUsed = usedCards.has(card);
                    const isSelected = currentBoardSet.has(card);
                    return <button key={card} className={'card-picker-btn' + (isSelected ? ' selected' : '') + (isUsed ? ' used' : '')} onClick={() => toggleCard(card)}>
                      <img src={'/cards/cards_gui_' + rank + suit.key + '.svg'} alt={card} loading="eager" />
                    </button>;
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',padding:'10px 0'}}>
          <button className="gto-undo-btn" onClick={undoLastAction}>Undo</button>
          <button className="btn btn-primary btn-sm" disabled={parseCardNotation(boardVal).filter(c => c.suit !== 'x').length < maxCards} onClick={() => { setCurrentStreetIdx(nextStreet); setPhase('action'); }}>Continue</button>
        </div>
      </div>
    );
  }

  // ── SHOWDOWN PHASE ──
  if (phase === 'showdown') {
    const isStudShowdown = category === 'stud';
    const isDrawShowdown = category === 'draw_triple' || category === 'draw_single';
    // Collect used cards
    const sdUsedCards = new Set();
    hand.streets.forEach(s => {
      parseCardNotation(s.cards.hero || '').forEach(c => { if (c.suit !== 'x') sdUsedCards.add(c.rank + c.suit); });
      parseCardNotation(s.cards.board || '').forEach(c => { if (c.suit !== 'x') sdUsedCards.add(c.rank + c.suit); });
      (s.cards.opponents || []).forEach(opp => { parseCardNotation(opp || '').forEach(c => { if (c.suit !== 'x') sdUsedCards.add(c.rank + c.suit); }); });
    });
    const showdownPlayers = hand.players.map((p, i) => ({ player: p, idx: i })).filter(o => o.idx !== heroIdx && !foldedSet.has(o.idx));
    const sdMaxCards = gameCfg.heroCards || 2;
    const sdAllRanks = 'AKQJT98765432'.split('');
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
            {cumulativeBoard && <div style={{margin:'8px 0'}}><CardRow text={cumulativeBoard} max={5} /></div>}
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
              if (oppParsed.length >= sdMaxCards) return;
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
            <div key={o.idx} className="gto-phase-card" style={{marginTop:'6px', opacity: isComplete ? 0.6 : 1}}>
              <div className="replayer-section">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
                  <div><span className="replayer-player-pos" style={{marginRight:'6px'}}>{o.player.position}</span><span style={{fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'0.8rem',fontWeight: 'var(--fw-bold)',color:'var(--text)'}}>{o.player.name}</span></div>
                  {isMucked ? <button className="gto-undo-btn" onClick={clearOppCards} style={{fontSize:'0.6rem'}}>Undo Muck</button> : isComplete ? <button className="gto-undo-btn" onClick={clearOppCards} style={{fontSize:'0.6rem'}}>Clear</button> : <button className="gto-undo-btn" onClick={setMuck} style={{fontSize:'0.6rem'}}>Muck</button>}
                </div>
                {isMucked ? <div style={{textAlign:'center',padding:'8px 0',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'0.75rem',color:'var(--text-muted)',fontStyle:'italic'}}>Mucked</div> : (
                  <>
                    {oppParsed.length > 0 && <div style={{margin:'4px 0'}}>
                      <CardRow text={oppCardStr} stud={isStudShowdown} max={sdMaxCards} />
                      {isStudShowdown && studMissingCount > 0 && <div style={{fontSize:'0.6rem',color:'var(--text-muted)',marginTop:'2px'}}>
                        {studKnownCount} known card{studKnownCount !== 1 ? 's' : ''}, {studMissingCount} hidden card{studMissingCount !== 1 ? 's' : ''} remaining
                      </div>}
                    </div>}
                    {!isComplete && (
                      <div className="card-picker-grid">
                        {sdAllSuits.map(suit => (
                          <React.Fragment key={suit.key}>
                            {sdAllRanks.map(rank => {
                              const card = rank + suit.key;
                              const isUsedByOther = thisUsed.has(card);
                              const isSelected = oppCardSet.has(card);
                              return <button key={card} className={'card-picker-btn' + (isSelected ? ' selected' : '') + (isUsedByOther ? ' used' : '')} onClick={() => toggleSdCard(card)}>
                                <img src={'/cards/cards_gui_' + rank + suit.key + '.svg'} alt={card} loading="eager" />
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
        <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',padding:'10px 0'}}>
          <button className="gto-undo-btn" onClick={undoLastAction}>Undo</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            // Auto-evaluate showdown winners
            const playerHands = [];
            let heroCardStr;
            if (isStudShowdown) heroCardStr = getStudHeroAllCards();
            else if (isDrawShowdown) { const heroBase = hand.streets[0].cards.hero || ''; heroCardStr = computeDrawHand(heroBase, getPlayerDrawsByStreet(hand, heroIdx), hand.streets.length - 1); }
            else heroCardStr = hand.streets[0].cards.hero || '';
            const heroParsed = parseCardNotation(heroCardStr).filter(c => c.suit !== 'x');
            if (heroParsed.length > 0) playerHands.push({ idx: heroIdx, cards: heroParsed });
            showdownPlayers.forEach(o => {
              const oppSlot = o.idx > heroIdx ? o.idx - 1 : o.idx;
              const oppStr = getOppCardStr(oppSlot);
              if (oppStr === 'MUCK' || !oppStr) return;
              const oppParsed = parseCardNotation(oppStr).filter(c => c.suit !== 'x');
              if (oppParsed.length > 0) playerHands.push({ idx: o.idx, cards: oppParsed });
            });
            let fullBoardStr = '';
            hand.streets.forEach(s => { if (s.cards.board) fullBoardStr += s.cards.board; });
            const boardParsed = parseCardNotation(fullBoardStr).filter(c => c.suit !== 'x');
            if (playerHands.length === 1) {
              setHand(prev => ({ ...prev, result: { ...prev.result, winners: [{ playerIdx: playerHands[0].idx, split: false }] } }));
            } else if (playerHands.length > 1) {
              let winners = evaluateShowdown(hand.gameType, playerHands, boardParsed);
              // Add hi/lo split labels for hilo games
              const _ec = GAME_EVAL[hand.gameType];
              if (_ec && _ec.type === 'hilo' && winners.some(w => w.split)) {
                const _hs = {}; const _ls = {};
                playerHands.forEach(ph => {
                  const al = boardParsed.length ? ph.cards.concat(boardParsed) : ph.cards;
                  _hs[ph.idx] = _ec.method === 'omaha' ? bestOmahaHigh(ph.cards, boardParsed) : bestHighHand(al);
                  const lo = _ec.method === 'omaha' ? bestOmahaLow(ph.cards, boardParsed) : bestLowA5Hand(al, true);
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
              if (winners.length > 0) setHand(prev => ({ ...prev, result: { ...prev.result, winners } }));
            }
            setPhase('result');
          }}>Continue to Result</button>
        </div>
      </div>
    );
  }

  // ── RESULT PHASE ──
  if (phase === 'result') {
    const autoWinner = handOver && activePlayers.length === 1 ? hand.players.indexOf(activePlayers[0]) : -1;
    return (
      <div className="gto-entry">
        <div className="gto-phase-card">
          <div className="replayer-section">
            <div className="replayer-section-title">Result</div>
            {autoWinner >= 0 ? (
              <div style={{textAlign:'center',padding:'12px',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
                <div style={{fontSize:'0.9rem',color:'#4ade80',fontWeight:700}}>{hand.players[autoWinner].name} wins</div>
                <div style={{fontSize:'0.7rem',color:'var(--text-muted)',marginTop:'4px'}}>All opponents folded</div>
              </div>
            ) : (
              <>
                <div style={{display:'flex',flexWrap:'wrap',gap:'4px'}}>
                  {hand.players.filter((_, i) => !foldedSet.has(i)).map(p => {
                    const pi = hand.players.indexOf(p);
                    const winners = (hand.result && hand.result.winners) || [];
                    const isWinner = winners.some(w => w.playerIdx === pi && !w.split);
                    const isSplit = winners.some(w => w.playerIdx === pi && w.split);
                    return (
                      <button key={pi} style={{
                        flex:'1 1 0',padding:'8px 14px',borderRadius:'6px',border:'1.5px solid',cursor:'pointer',
                        fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'0.75rem',fontWeight: 'var(--fw-bold)',transition:'all 0.15s',
                        background: isWinner ? 'rgba(74,222,128,0.15)' : isSplit ? 'rgba(250,204,21,0.15)' : 'transparent',
                        borderColor: isWinner ? '#4ade80' : isSplit ? '#facc15' : 'var(--border)',
                        color: isWinner ? '#4ade80' : isSplit ? '#facc15' : 'var(--text-muted)',
                      }} onClick={() => {
                        setHand(prev => {
                          const prevWinners = (prev.result && prev.result.winners) || [];
                          const existing = prevWinners.find(w => w.playerIdx === pi);
                          let newWinners;
                          if (!existing) newWinners = [...prevWinners, { playerIdx: pi, split: false, label: '' }];
                          else if (!existing.split) newWinners = prevWinners.map(w => w.playerIdx === pi ? { ...w, split: true } : w);
                          else newWinners = prevWinners.filter(w => w.playerIdx !== pi);
                          return { ...prev, result: { ...prev.result, winners: newWinners } };
                        });
                      }}>
                        {p.name} {isWinner ? '(Win)' : isSplit ? '(Split)' : ''}
                      </button>
                    );
                  })}
                </div>
                <div style={{fontSize:'0.55rem',color:'var(--text-muted)',marginTop:'4px',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
                  {(hand.result?.winners?.length) ? 'Auto-evaluated. ' : ''}{'Tap to cycle: none \u2192 win \u2192 split \u2192 none'}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="gto-street-card">
          <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',padding:'10px 12px'}}>
            <button className="gto-undo-btn" onClick={undoLastAction}>Undo</button>
            <button className="btn btn-primary btn-sm" onClick={() => {
              const savedHand = { ...hand, heroIdx };
              if (autoWinner >= 0 && !(hand.result?.winners?.length)) {
                onDone({ ...savedHand, result: { winners: [{ playerIdx: autoWinner, split: false, label: '' }] } });
              } else onDone(savedHand);
            }}>Save & Replay</button>
          </div>
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
    parseCardNotation((hand.streets[0]?.cards.hero) || '').forEach(c => { if (c.suit !== 'x') usedCardsDC.add(c.rank + c.suit); });
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

    return (
      <div className="gto-entry">
        <div className="gto-phase-card"><div className="replayer-section">
          <div className="replayer-section-title">Opponent Door Cards</div>
          <p style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'8px'}}>Enter each opponent's face-up 3rd street card.</p>
          {hand.players.map((p, pi) => {
            if (pi === heroIdxDC) return null;
            const oppSlot = pi < heroIdxDC ? pi : pi - 1;
            const currentCard = oppCards0[oppSlot] || '';
            const parsedCurrent = parseCardNotation(currentCard).filter(c => c.suit !== 'x');
            const selectedCard = parsedCurrent.length ? parsedCurrent[0].rank + parsedCurrent[0].suit : '';
            return (
              <div key={pi} style={{marginBottom:'12px'}}>
                <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px'}}>
                  <span style={{fontWeight:700,fontSize:'0.8rem'}}>{p.name}</span>
                  <span style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>{p.position}</span>
                  {selectedCard ? <CardRow text={selectedCard} max={1} /> : <span style={{fontSize:'0.7rem',color:'var(--text-muted)',fontStyle:'italic'}}>? unknown</span>}
                </div>
              </div>
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
                    if (selectedForOpp >= 0) setOppDoorCard(selectedForOpp, '');
                    else { for (let oi = 0; oi < numOpps; oi++) { if (!oppCards0[oi]) { setOppDoorCard(oi, card); return; } } }
                  }}>
                    <img src={'/cards/cards_gui_' + rank + suit.key + '.svg'} alt={card} loading="eager" />
                  </button>;
                })}
              </React.Fragment>
            ))}
          </div>
        </div></div>
        <div className="gto-street-card">
          <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',padding:'10px 12px'}}>
            {/* Back goes to the step before this one, which is now hero's own
                3rd street. Only stud reaches the door cards at all. */}
            <button className="btn btn-ghost btn-sm" onClick={() => setPhase('hero_cards')}>Back</button>
            <button className="btn btn-primary btn-sm" onClick={() => setPhase('action')}>Start Action</button>
          </div>
        </div>
      </div>
    );
  }

  // ── DRAW DISCARD PHASE ──
  if (phase === 'draw_discard' || phase === 'draw_cards_entry') {
    const nextDrawStreet = currentStreetIdx + 1;
    const drawActivePlayers = seatOrder.filter(i => !foldedSet.has(i));

    const addDraw = (playerIdx, discardCount) => {
      setHand(prev => ({ ...prev, streets: prev.streets.map((s, si) => si !== currentStreetIdx ? s : { ...s, draws: [...(s.draws || []), { player: playerIdx, discarded: discardCount, discardedCards: '', newCards: '' }] }) }));
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
      return computeDrawHand(base, getPlayerDrawsByStreet(hand, pi), currentStreetIdx - 1);
    };
    const drawPlayerQueue = drawActivePlayers.filter(pi => !(currentStreet.draws || []).find(d => d.player === pi));
    const currentDrawPlayer = drawPlayerQueue.length > 0 ? drawPlayerQueue[0] : -1;
    const allDrawsDeclared = drawPlayerQueue.length === 0;
    const isBadugi = ['Badugi','Badeucy','Badacy'].includes(hand.gameType);
    const maxDiscard = isBadugi ? 4 : 5;

    if (phase === 'draw_cards_entry') {
      return (
        <div className="gto-entry">
          <div className="gto-phase-card"><div className="replayer-section">
            <div className="replayer-section-title">{'Card Details \u2014 ' + (currentStreet.name || 'Draw')}</div>
            <p style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'10px'}}>Optionally specify which cards were discarded and drawn. Skip to continue.</p>
            {drawActivePlayers.map(pi => {
              const p = hand.players[pi];
              const de = (currentStreet.draws || []).find(d => d.player === pi);
              if (!de) return null;
              const isPat = de.discarded === 0;
              const isHeroDraw = pi === (hand.heroIdx != null ? hand.heroIdx : 0);
              const curHand = isHeroDraw ? getDrawPlayerHand(pi) : null;
              return (
                <div key={pi} style={{marginBottom:'10px',padding:'8px 10px',background:'var(--surface2)',borderRadius:'6px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom: isHeroDraw ? '6px' : '0'}}>
                    <span style={{fontWeight:700,fontSize:'0.78rem'}}>{p.name}</span>
                    <span style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>{p.position}</span>
                    {isPat && <span className="replayer-draw-pat-badge">Stand Pat</span>}
                    {!isPat && <span className="replayer-draw-count-badge">Discards {de.discarded}</span>}
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
                      <div style={{marginBottom:'4px'}}>
                        <span style={{fontSize:'0.6rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.03em'}}>
                          {isPat ? 'Current Hand' : 'Tap to select discards'}
                        </span>
                        <div className="card-row" style={{gap:'2px',flexWrap:'nowrap'}}>
                          {handCards.map((c, ci) => {
                            const isDiscarded = discardedSet.has(c.rank + c.suit);
                            return <img key={ci} className={'card-img draw-selectable' + (isDiscarded ? ' draw-discarded' : '')}
                              src={'/cards/cards_gui_' + c.rank + c.suit + '.svg'} alt={c.rank + c.suit} loading="eager"
                              onClick={() => toggleDiscard(c)} style={{ cursor: isPat ? 'default' : 'pointer' }} />;
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  {isHeroDraw && !isPat && (
                    <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginTop:'4px'}}>
                      <div className="replayer-field" style={{flex:1,minWidth:'80px'}}>
                        <label style={{fontSize:'0.55rem'}}>Discarded</label>
                        <input type="text" placeholder="e.g. 7h3c" value={de.discardedCards || ''} onChange={e => updateDrawCardsFn(pi, 'discardedCards', e.target.value)} />
                      </div>
                      <div className="replayer-field" style={{flex:1,minWidth:'80px'}}>
                        <label>New Cards</label>
                        <input type="text" placeholder="e.g. Ah5s" value={de.newCards || ''} onChange={e => updateDrawCardsFn(pi, 'newCards', e.target.value)} />
                        {de.newCards && <CardRow text={de.newCards} max={de.discarded} />}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div></div>
          <div className="gto-street-card">
            <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',padding:'10px 12px'}}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPhase('draw_discard')}>Back</button>
              <button className="btn btn-primary btn-sm" onClick={() => { setCurrentStreetIdx(nextDrawStreet); setPhase('action'); }}>Continue</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="gto-entry">
        <div className="gto-phase-card"><div className="replayer-section">
          <div className="replayer-section-title">Draw Round</div>
          <p style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'10px'}}>Each player declares how many cards to discard.</p>
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
              <div key={pi} className={'gto-seat' + (isCurrentTarget ? ' active' : '') + (isDeclared ? ' gto-draw-declared' : '')} style={{marginBottom:'6px'}}>
                <div className="gto-seat-strip">{p.position}</div>
                <div className="gto-seat-content">
                  <div className="gto-seat-bar">
                    <div className="gto-seat-row1"><span className="gto-seat-pos">{p.position}</span><span className="gto-seat-stack">{formatChipAmount(currentStacks[pi])}</span></div>
                    <div className="gto-seat-row2">
                      <span className="gto-seat-name">{p.name}</span>
                      {isDeclared && <span className="gto-seat-result-badge check" style={{marginLeft:'auto'}}>{existingDraw.discarded === 0 ? 'Stand Pat' : 'Drew ' + existingDraw.discarded}</span>}
                    </div>
                    {drawHistory.length > 0 && <div className="gto-seat-draw-history">{drawHistory.join(' / ')}</div>}
                  </div>
                  {curHand && <div style={{padding:'4px 10px'}}><CardRow text={curHand} max={gameCfg.heroCards || 5} /></div>}
                  {isCurrentTarget && !isDeclared && (
                    <div className="gto-draw-buttons">
                      <button className="gto-draw-btn pat" onClick={() => addDraw(pi, 0)}>Stand Pat</button>
                      {Array.from({length: maxDiscard}, (_, n) => n + 1).map(count => (
                        <button key={count} className="gto-draw-btn" onClick={() => addDraw(pi, count)}>{count}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div></div>
        <div className="gto-street-card">
          <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',padding:'10px 12px'}}>
            {(currentStreet.draws || []).length > 0 && <button className="gto-undo-btn" onClick={undoLastDraw}>Undo</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => {
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
            }}>Back</button>
            <button className="btn btn-primary btn-sm" disabled={!allDrawsDeclared} onClick={() => {
              const hi = hand.heroIdx != null ? hand.heroIdx : 0;
              const heroDraw = (currentStreet.draws || []).find(d => d.player === hi);
              if (heroDraw && heroDraw.discarded === 0) { setCurrentStreetIdx(nextDrawStreet); setPhase('action'); }
              else setPhase('draw_cards_entry');
            }}>{(() => { const hi = hand.heroIdx != null ? hand.heroIdx : 0; const hd = (currentStreet.draws||[]).find(d=>d.player===hi); return hd && hd.discarded === 0 ? 'Continue' : 'Enter Cards'; })()}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── STUD DEAL PHASE ──
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
      eat(cs.board);
      (cs.opponents || []).forEach(eat);
    });

    const enteredCount = sdActivePlayers.filter(pi => getStudCardForPlayer(pi)).length;
    const sdRanks = 'AKQJT98765432'.split('');
    const sdSuits = [{key:'h'},{key:'d'},{key:'c'},{key:'s'}];

    return (
      <div className="gto-entry">
        <div className="gto-phase-card"><div className="replayer-section">
          <div className="replayer-section-title">Deal {studStreetName}</div>
          <p style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'8px'}}>Tap a player, then tap a card.</p>
          {sdActivePlayers.map(pi => {
            const p = hand.players[pi];
            const cardStr = getStudCardForPlayer(pi);
            const isTarget = studDealTarget === pi;
            return (
              <div key={pi} style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px',padding:'6px 8px',borderRadius:'6px',cursor:'pointer',background:isTarget?'var(--accent-bg, rgba(34,197,94,0.1))':'transparent',border:isTarget?'1.5px solid var(--accent)':'1.5px solid transparent'}} onClick={() => setStudDealTarget(pi)}>
                <span style={{fontWeight:700,fontSize:'0.8rem',minWidth:'100px'}}>{p.name}</span>
                {cardStr ? <CardRow text={cardStr} max={1} /> : <span style={{fontSize:'0.7rem',color:'var(--text-muted)',fontStyle:'italic'}}>--</span>}
              </div>
            );
          })}
          <div className="card-picker-grid">
            {sdSuits.map(suit => (
              <React.Fragment key={suit.key}>
                {sdRanks.map(rank => {
                  const card = rank + suit.key;
                  let selectedFor = -1;
                  sdActivePlayers.forEach(pi => { if (getStudCardForPlayer(pi) === card) selectedFor = pi; });
                  const isDead = selectedFor < 0 && sdDead.has(card);
                  return <button key={card} title={isDead ? 'Already dealt' : undefined}
                    className={'card-picker-btn' + (selectedFor >= 0 ? ' selected' : '') + (isDead ? ' used' : '')}
                    disabled={isDead} onClick={() => {
                    if (selectedFor >= 0) setStudCard(selectedFor, '');
                    else if (studDealTarget >= 0) {
                      setStudCard(studDealTarget, card);
                      const nextTarget = sdActivePlayers.find(pi => pi !== studDealTarget && !getStudCardForPlayer(pi));
                      if (nextTarget !== undefined) setStudDealTarget(nextTarget);
                    }
                  }}>
                    <img src={'/cards/cards_gui_' + rank + suit.key + '.svg'} alt={card} loading="eager" />
                  </button>;
                })}
              </React.Fragment>
            ))}
          </div>
        </div></div>
        <div className="gto-street-card">
          <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',padding:'10px 12px'}}>
            <button className="btn btn-ghost btn-sm" onClick={() => setPhase('action')}>Back</button>
            <button className="btn btn-primary btn-sm" disabled={enteredCount < sdActivePlayers.length} onClick={() => { setCurrentStreetIdx(nextStudStreet); setPhase('action'); }}>Continue</button>
          </div>
        </div>
      </div>
    );
  }

  // ── ACTION PHASE ──
  const stickySlot = document.getElementById('gto-sticky-slot');
  const streetCardEl = (
    <div className="gto-street-card" style={{marginTop:'6px'}}>
      <div className="gto-street-bar">
        <span className="gto-street-name">{currentStreet.name}</span>
        {category === 'community' && cumulativeBoard && <span className="gto-board-inline"><CardRow text={cumulativeBoard} max={5} /></span>}
        <span className="gto-pot-label">{formatChipAmount(currentPot)}</span>
      </div>
    </div>
  );

  return (
    <div className="gto-entry">
      {stickySlot && createPortal(streetCardEl, stickySlot)}
      {seatOrder.map(i => {
        const p = hand.players[i];
        const isActive = i === currentActor;
        const act = playerActions[i];
        const isFolded = foldedSet.has(i);
        const foldedOnPriorStreet = isFolded && !(currentStreet.actions || []).some(a => a.player === i && a.action === 'fold');
        if (foldedOnPriorStreet && !isPreflop && category !== 'stud') return null;
        const seatClass = 'gto-seat' + (isActive ? ' active' : '') + (isFolded ? ' folded' : (act && !isActive) ? ' acted-' + act.action : '');
        const actionLabel = act ? (act.action.charAt(0).toUpperCase() + act.action.slice(1) + (act.amount > 0 ? ' ' + formatChipAmount(act.amount) : '')) : '';
        return (
          <div key={i} ref={isActive ? activeSeatRef : null} className={seatClass}
            onClick={act && !isActive ? () => undoToPlayer(i) : undefined}
            style={act && !isActive ? {cursor:'pointer'} : undefined}>
            <div className="gto-seat-strip">{p.position}</div>
            <div className="gto-seat-content">
              <div className="gto-seat-bar">
                <div className="gto-seat-row1"><span className="gto-seat-pos">{p.position}</span><span className="gto-seat-stack">{formatChipAmount(currentStacks[i])}</span></div>
                <div className="gto-seat-row2">
                  <span className="gto-seat-name">{p.name}</span>
                  {i === heroIdx && !gameCfg.isStud && (() => {
                    const baseCards = hand.streets[0]?.cards.hero || '';
                    if (!baseCards) return null;
                    const isDrawGameLocal = category === 'draw_triple' || category === 'draw_single';
                    const displayCards = isDrawGameLocal ? computeDrawHand(baseCards, getPlayerDrawsByStreet(hand, i), currentStreetIdx - 1) : baseCards;
                    return <span className="gto-seat-hero-cards"><CardRow text={displayCards} max={gameCfg.heroCards || 2} /></span>;
                  })()}
                  {gameCfg.isStud && (() => {
                    // Show accumulated board cards for stud players
                    const isHero = i === heroIdx;
                    const oppSlot = i < heroIdx ? i : i - 1;
                    let accumulated = '';
                    for (let si = 0; si <= currentStreetIdx; si++) {
                      const st = hand.streets[si];
                      if (!st) break;
                      if (isHero) { accumulated += (st.cards.hero || ''); }
                      else { accumulated += ((st.cards.opponents || [])[oppSlot] || ''); }
                    }
                    const dimStyle = isFolded ? {opacity: 0.4, filter: 'grayscale(60%)'} : {};
                    // For opponents: show 2 face-down hole cards + visible upcards + 7th street face-down
                    if (!isHero) {
                      const oppVisible = parseCardNotation(accumulated).filter(c => c.suit !== 'x');
                      if (isFolded) {
                        if (oppVisible.length === 0) return null;
                        return (
                          <span className="gto-seat-hero-cards" style={dimStyle}>
                            <div className="card-row" style={{gap:'2px',flexWrap:'nowrap'}}>
                              {oppVisible.map((c, ci) => <img key={ci} className="card-img" src={'/cards/cards_gui_' + c.rank + c.suit + '.svg'} alt={c.rank+c.suit} loading="eager" />)}
                            </div>
                          </span>
                        );
                      }
                      const downAfter = currentStreetIdx >= 4 ? 1 : 0;
                      return (
                        <span className="gto-seat-hero-cards">
                          <div className="card-row" style={{gap:'2px',flexWrap:'nowrap'}}>
                            <div className="card-unknown" style={{marginTop:8}} />
                            <div className="card-unknown" style={{marginTop:8}} />
                            {oppVisible.map((c, ci) => <img key={ci} className="card-img" src={'/cards/cards_gui_' + c.rank + c.suit + '.svg'} alt={c.rank+c.suit} loading="eager" />)}
                            {downAfter > 0 && <div className="card-unknown" style={{marginTop:8}} />}
                          </div>
                        </span>
                      );
                    }
                    // Hero folded: show cards dimmed
                    if (!accumulated) return null;
                    return <span className="gto-seat-hero-cards" style={dimStyle}><CardRow text={accumulated} stud={true} max={7} /></span>;
                  })()}
                  {(category === 'draw_triple' || category === 'draw_single') && (() => {
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
                  {act && !isActive && <span className={'gto-seat-result-badge ' + act.action}>{actionLabel}</span>}
                </div>
              </div>
              {isActive && (
                <div className="gto-seat-detail-wrap"><div className="gto-seat-detail-inner"><div className="gto-seat-detail">
                  {/* Hero card picker — shows when hero is active */}
                  {i === heroIdx && isActive && !gameCfg.isStud && (() => {
                    const hcBase = (hand.streets[0] && hand.streets[0].cards.hero) || '';
                    const isDrawGameLocal = category === 'draw_triple' || category === 'draw_single';
                    const hcDisplay = isDrawGameLocal ? computeDrawHand(hcBase, getPlayerDrawsByStreet(hand, i), currentStreetIdx - 1) : hcBase;
                    const hcParsed = parseCardNotation(hcDisplay);
                    const hcSet = new Set(hcParsed.map(c => c.rank + c.suit));
                    const hcMaxCards = gameCfg.heroCards || 2;
                    const heroHasCards = hcParsed.length >= hcMaxCards;
                    const pickerOpen = showHeroCardPicker || !heroHasCards;
                    if (!pickerOpen) return null;
                    const hcRanks = 'AKQJT98765432'.split('');
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
                      <div style={{padding:'6px 8px',borderBottom: heroHasCards ? '1px solid var(--border)' : 'none'}}>
                        <div style={{fontSize:'0.65rem',fontWeight:700,color:'var(--text-muted)',marginBottom:'4px',fontFamily:"'Univers Condensed','Univers',sans-serif",textTransform:'uppercase',letterSpacing:'0.04em'}}>
                          {heroHasCards ? 'Edit Cards' : 'Select Your Cards'}
                        </div>
                        <div className="card-picker-grid" style={{gap:'3px'}}>
                          {hcSuits.map(suit => (
                            <React.Fragment key={suit.key}>
                              {hcRanks.map(rank => {
                                const card = rank + suit.key;
                                const isSelected = hcSet.has(card);
                                return <button key={card} className={'card-picker-btn' + (isSelected ? ' selected' : '')} onClick={() => toggleHCard(card)}>
                                  <img src={'/cards/cards_gui_' + rank + suit.key + '.svg'} alt={card} loading="eager" />
                                </button>;
                              })}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
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
                      {!isLimitGame && playerStack > (flBetSize - playerContrib) && <button className="gto-action-btn" onClick={() => { setShowRaiseInput(true); setBetAmount(String(Math.min(flBetSize - playerContrib, playerStack))); }}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">Raise</span></button>}
                    </div>
                  ) : isLimitGame ? (
                    <div className="gto-action-row">
                      {!canCheck && <button className="gto-action-btn" onClick={() => addAction('fold')}><span className="gto-action-icon fold">&#x2715;</span><span className="gto-action-label">Fold</span></button>}
                      {canCheck ? <button className="gto-action-btn" onClick={() => addAction('check')}><span className="gto-action-icon check">&#x2713;</span><span className="gto-action-label">Check</span></button>
                        : <button className="gto-action-btn" onClick={() => addAction('call', Math.min(callAmount, playerStack))}><span className="gto-action-icon call">&#x2B24;</span><span className="gto-action-label">Call {formatChipAmount(Math.min(callAmount, playerStack))}</span></button>}
                      {flCanRaise && playerStack > callAmount && (canCheck
                        ? <button className="gto-action-btn" onClick={() => addAction('bet', Math.min(flBetSize, playerStack))}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">Bet {formatChipAmount(Math.min(flBetSize, playerStack))}</span></button>
                        : <button className="gto-action-btn" onClick={() => addAction('raise', Math.min(flRaiseIncrement, playerStack))}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">Raise to {formatChipAmount(Math.min(flRaiseToTotal, playerStack + playerContrib))}</span></button>
                      )}
                    </div>
                  ) : isPotLimit ? (
                    <>
                      {!showRaiseInput && (
                        <div className="gto-action-row">
                          {!canCheck && <button className="gto-action-btn" onClick={() => addAction('fold')}><span className="gto-action-icon fold">&#x2715;</span><span className="gto-action-label">Fold</span></button>}
                          {canCheck ? <button className="gto-action-btn" onClick={() => addAction('check')}><span className="gto-action-icon check">&#x2713;</span><span className="gto-action-label">Check</span></button>
                            : <button className="gto-action-btn" onClick={() => addAction('call', Math.min(callAmount, playerStack))}><span className="gto-action-icon call">&#x2B24;</span><span className="gto-action-label">Call {formatChipAmount(Math.min(callAmount, playerStack))}</span></button>}
                          {playerStack > callAmount && <button className="gto-action-btn" onClick={() => { setShowRaiseInput(true); setBetAmount(String(canCheck ? Math.min((hand.blinds||{}).bb||0, playerStack) : Math.min(minRaiseIncrement, playerStack))); }}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">{canCheck ? 'Bet' : 'Raise'}</span></button>}
                          {playerStack > callAmount && <button className="gto-action-btn" onClick={() => { const potIncrement = canCheck ? Math.min(plMaxBet, playerStack) : Math.min(plMaxRaiseIncrement, playerStack); addAction(canCheck ? 'bet' : 'raise', potIncrement); }}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">Pot {formatChipAmount(Math.min(canCheck ? plMaxBet : plRaiseToTotal, playerStack + playerContrib))}</span></button>}
                        </div>
                      )}
                      {showRaiseInput && (
                        <>
                          <div className="gto-sizing-row">
                            {[{label:'Min',mult:0},{label:'1/3',mult:1/3},{label:'1/2',mult:1/2},{label:'2/3',mult:2/3},{label:'Pot',mult:1}].map(s => {
                              let pillAmt;
                              if (canCheck) pillAmt = s.mult === 0 ? Math.min((hand.blinds||{}).bb||0, playerStack) : Math.min(Math.round(plMaxBet * s.mult), playerStack);
                              else { if (s.mult === 0) pillAmt = Math.min(minRaiseIncrement, playerStack); else { const raiseSize = Math.round(plPotAfterCall * s.mult); pillAmt = Math.max(Math.min(callAmount + raiseSize, plMaxRaiseIncrement, playerStack), Math.min(minRaiseIncrement, playerStack)); } }
                              return <button key={s.label} className="gto-sizing-pill" onClick={() => setBetAmount(String(pillAmt))}>{s.label}</button>;
                            })}
                          </div>
                          <div className="gto-raise-slider-row">
                            <input type="range" className="gto-raise-slider" min={canCheck ? Math.min((hand.blinds||{}).bb||0, playerStack) : Math.min(minRaiseIncrement, playerStack)} max={canCheck ? Math.min(plMaxBet, playerStack) : Math.min(plMaxRaiseIncrement, playerStack)} step={1} value={Number(betAmount)||0} onChange={e => setBetAmount(e.target.value)} />
                          </div>
                          <div className="gto-raise-input-row">
                            <input type="text" inputMode="decimal" value={betAmount} onChange={e => setBetAmount(e.target.value)} autoFocus />
                            <button className="btn btn-primary btn-sm" onClick={() => { const amt = Math.min(Number(betAmount)||0, canCheck ? Math.min(plMaxBet, playerStack) : Math.min(plMaxRaiseIncrement, playerStack)); if (amt > 0) addAction(canCheck ? 'bet' : 'raise', amt); }}>Confirm</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowRaiseInput(false)}>Cancel</button>
                          </div>
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
                          <button className="gto-action-btn" onClick={() => { setShowRaiseInput(true); setBetAmount(String(canCheck ? ((hand.blinds||{}).bb||0) : Math.min(minRaiseIncrement, playerStack))); }}><span className="gto-action-icon raise">&#x25B2;</span><span className="gto-action-label">{canCheck ? 'Bet' : 'Raise'}</span></button>
                          <button className="gto-action-btn" onClick={() => addAction(canCheck ? 'bet' : 'raise', playerStack)}><span className="gto-action-icon allin">&#x2605;</span><span className="gto-action-label">All-in</span></button>
                        </div>
                      )}
                      {showRaiseInput && (
                        <>
                          <div className="gto-sizing-row">
                            {[{label:'Min',mult:0},{label:'1/3',mult:1/3},{label:'1/2',mult:1/2},{label:'2/3',mult:2/3},{label:'Pot',mult:1}].map(s => {
                              let pillAmt;
                              if (canCheck) pillAmt = s.mult === 0 ? Math.min((hand.blinds||{}).bb||0, playerStack) : Math.min(Math.round(currentPot * s.mult), playerStack);
                              else { if (s.mult === 0) pillAmt = Math.min(minRaiseIncrement, playerStack); else { const potAfterCall = currentPot + callAmount; pillAmt = Math.min(callAmount + Math.round(potAfterCall * s.mult), playerStack); } }
                              return <button key={s.label} className="gto-sizing-pill" onClick={() => setBetAmount(String(pillAmt))}>{s.label}</button>;
                            })}
                            <button className="gto-sizing-pill" onClick={() => setBetAmount(String(playerStack))}>All-In</button>
                          </div>
                          <div className="gto-raise-slider-row">
                            <input type="range" className="gto-raise-slider" min={canCheck ? Math.min((hand.blinds||{}).bb||0, playerStack) : Math.min(minRaiseIncrement, playerStack)} max={playerStack} step={1} value={Number(betAmount)||0} onChange={e => setBetAmount(e.target.value)} />
                          </div>
                          <div className="gto-raise-input-row">
                            <input type="text" inputMode="decimal" value={betAmount} onChange={e => setBetAmount(e.target.value)} autoFocus />
                            <button className="btn btn-primary btn-sm" onClick={() => { const amt = Math.min(Number(betAmount)||0, playerStack); if (amt > 0) addAction(canCheck ? 'bet' : 'raise', amt); }}>Confirm</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowRaiseInput(false)}>Cancel</button>
                          </div>
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
            <div style={{display:'flex',gap:'6px',justifyContent:'space-between',alignItems:'center',padding:'10px 12px'}}>
              <button className="gto-undo-btn" onClick={undoLastAction}>Undo</button>
              <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel Hand</button>
            </div>
          </div>
        </div>,
        document.body
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
        <div style={{padding:'24px',color:'var(--text-muted)',textAlign:'center'}}>
          <div style={{fontSize:'0.85rem',marginBottom:'8px',color:'var(--danger,#f87171)'}}>Error loading replay</div>
          <div style={{fontSize:'0.7rem',fontFamily:'monospace',wordBreak:'break-all',maxWidth:'400px',margin:'0 auto 12px',opacity:0.7}}>
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

// ══════════════════════════════════════════════════════════
// ── Main Hand Replayer View ──────────────────────────────
// ══════════════════════════════════════════════════════════
export default function HandReplayerView({ token, heroName, cardSplay, initialHand, onClearInitialHand, onSolveSpot }) {
  const toast = useToast();
  const [mode, setMode] = useState(initialHand ? 'replay' : 'list');
  const [entryMode, setEntryMode] = useState('gto');
  const [entryTab, setEntryTab] = useState('form');
  const [shorthandText, setShorthandText] = useState('');
  const [shorthandErrors, setShorthandErrors] = useState([]);
  const [hands, setHands] = useState([]);
  const [games, setGames] = useState([]);
  const [currentHand, setCurrentHand] = useState(initialHand || null);
  const [currentHandId, setCurrentHandId] = useState(null);
  const [selectedGameType, setSelectedGameType] = useState('NLH');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bettingStructure, setBettingStructure] = useState('No Limit');
  const [selectedGame, setSelectedGame] = useState("Hold'em");
  const [selectedCategory, setSelectedCategory] = useState("Hold'em");
  const [studSuper, setStudSuper] = useState(false);
  const [studAction, setStudAction] = useState(false);
  const [showMoreFor, setShowMoreFor] = useState(null); // 'Omaha' | 'Draw' | null
  const [gameHistory, setGameHistory] = useState(() => {
    try { const s = localStorage.getItem('replayer_game_history'); return s ? JSON.parse(s) : []; }
    catch { return []; }
  });
  // Custom game config
  const [customGameName, setCustomGameName] = useState('');
  const [customHeroCards, setCustomHeroCards] = useState(2);
  const [customCategory, setCustomCategory] = useState('community');
  const [customStreetNames, setCustomStreetNames] = useState('');

  // Game selection config
  const structureGameMap = {
    'No Limit':  { "Hold'em": 'NLH', 'Pineapple': 'NLH', 'Short Deck': 'NLH',
      'Omaha': 'PLO', 'Omaha 8/b': 'PLO8', 'Big O': 'Big O', 'Big Easy': 'Big Easy', 'PLO5': 'PLO', 'PLO6': 'PLO',
      'Double Board Bomb Pot': 'PLO', 'Courchevel': 'PLO',
      'Stud Hi': 'NL Stud Hi', 'Stud 8/b': 'NL Stud 8', 'Razz': 'NL Razz',
      'Stud Hi/Lo Regular': 'Stud 8', '2-7 Razz': 'Razz',
      'Razzdugi': 'Badugi', 'Razzdeucy': 'Badeucy',
      '2-7 Triple Draw': '2-7 TD', '2-7 Single Draw': 'NL 2-7 SD',
      'A-5 Triple Draw': 'A-5 TD', 'A-5 Single Draw': 'A-5 TD',
      'Badugi': 'Badugi', 'Badeucy': 'Badeucy', 'Badacey': 'Badacy',
      'Archie 66': 'Badugi', 'Archie 99': 'Badugi', 'Ari': 'Badugi',
      '5-Card Draw': 'PL 5CD Hi', 'OFC': 'OFC',
      'Dramaha Hi': 'PLO', 'Dramaha 2-7': 'PLO', 'Dramaha 49': 'PLO', 'Dramaha 0': 'PLO', 'Dramadugi': 'PLO', 'Omajack': 'PLO' },
    'Pot Limit': { "Hold'em": 'PLH', 'Pineapple': 'PLH', 'Short Deck': 'PLH',
      'Omaha': 'PLO', 'Omaha 8/b': 'PLO8', 'Big O': 'Big O', 'Big Easy': 'Big Easy', 'PLO5': 'PLO', 'PLO6': 'PLO',
      'Double Board Bomb Pot': 'PLO', 'Courchevel': 'PLO',
      'Stud Hi': 'PL Stud Hi', 'Stud 8/b': 'PL Stud 8', 'Razz': 'PL Razz',
      'Stud Hi/Lo Regular': 'Stud 8', '2-7 Razz': 'Razz',
      'Razzdugi': 'Badugi', 'Razzdeucy': 'Badeucy',
      '2-7 Triple Draw': 'PL 2-7 TD', '2-7 Single Draw': 'NL 2-7 SD',
      'A-5 Triple Draw': 'A-5 TD', 'A-5 Single Draw': 'A-5 TD',
      'Badugi': 'Badugi', 'Badeucy': 'Badeucy', 'Badacey': 'Badacy',
      'Archie 66': 'Badugi', 'Archie 99': 'Badugi', 'Ari': 'Badugi',
      '5-Card Draw': 'PL 5CD Hi', 'OFC': 'OFC',
      'Dramaha Hi': 'PLO', 'Dramaha 2-7': 'PLO', 'Dramaha 49': 'PLO', 'Dramaha 0': 'PLO', 'Dramadugi': 'PLO', 'Omajack': 'PLO' },
    'Limit':     { "Hold'em": 'LHE', 'Pineapple': 'LHE', 'Short Deck': 'LHE',
      'Omaha': 'O8', 'Omaha 8/b': 'O8', 'Big O': 'Big O', 'Big Easy': 'Big Easy', 'PLO5': 'PLO', 'PLO6': 'PLO',
      'Double Board Bomb Pot': 'PLO', 'Courchevel': 'PLO',
      'Stud Hi': 'Stud Hi', 'Stud 8/b': 'Stud 8', 'Razz': 'Razz',
      'Stud Hi/Lo Regular': 'Stud 8', '2-7 Razz': 'Razz',
      'Razzdugi': 'Badugi', 'Razzdeucy': 'Badeucy',
      '2-7 Triple Draw': '2-7 TD', '2-7 Single Draw': 'NL 2-7 SD',
      'A-5 Triple Draw': 'A-5 TD', 'A-5 Single Draw': 'A-5 TD',
      'Badugi': 'Badugi', 'Badeucy': 'Badeucy', 'Badacey': 'Badacy',
      'Archie 66': 'Badugi', 'Archie 99': 'Badugi', 'Ari': 'Badugi',
      '5-Card Draw': 'PL 5CD Hi', 'OFC': 'OFC',
      'Dramaha Hi': 'PLO', 'Dramaha 2-7': 'PLO', 'Dramaha 49': 'PLO', 'Dramaha 0': 'PLO', 'Dramadugi': 'PLO', 'Omajack': 'PLO' },
  };
  const defaultStructure = {
    "Hold'em": 'No Limit', 'Pineapple': 'No Limit', 'Short Deck': 'No Limit',
    'Omaha': 'Pot Limit', 'Omaha 8/b': 'Pot Limit', 'Big O': 'Pot Limit', 'Big Easy': 'Pot Limit',
    'PLO5': 'Pot Limit', 'PLO6': 'Pot Limit',
    'Double Board Bomb Pot': 'No Limit', 'Courchevel': 'Pot Limit',
    'Stud Hi': 'Limit', 'Stud 8/b': 'Limit', 'Razz': 'Limit',
    'Stud Hi/Lo Regular': 'Limit', '2-7 Razz': 'Limit',
    'Razzdugi': 'Limit', 'Razzdeucy': 'Limit',
    '2-7 Triple Draw': 'Limit', '2-7 Single Draw': 'No Limit',
    'A-5 Triple Draw': 'Limit', 'A-5 Single Draw': 'No Limit',
    'Badugi': 'Limit', 'Badeucy': 'Limit', 'Badacey': 'Limit',
    'Archie 66': 'Limit', 'Archie 99': 'Limit', 'Ari': 'Limit',
    '5-Card Draw': 'No Limit', 'OFC': 'No Limit',
    'Dramaha Hi': 'Pot Limit', 'Dramaha 2-7': 'Pot Limit', 'Dramaha 49': 'Pot Limit',
    'Dramaha 0': 'Pot Limit', 'Dramadugi': 'Pot Limit', 'Omajack': 'Pot Limit',
  };

  const RAZZ_VARIANTS = ['Razz', '2-7 Razz', 'Razzdugi', 'Razzdeucy'];

  const variantDisplayName = useMemo(() => {
    const isRazz = RAZZ_VARIANTS.includes(selectedGame);
    const superPrefix = studSuper && selectedCategory === 'Stud' ? 'Super ' : '';
    const actionPrefix = studAction && isRazz ? 'Action ' : '';
    const overrides = {
      "Pot Limit|Omaha": 'Pot Limit Omaha', "Pot Limit|Omaha 8/b": 'PLO8', "Pot Limit|Big O": 'Big O', "Pot Limit|Big Easy": 'Big Easy',
      "No Limit|Omaha": 'No Limit Omaha', "No Limit|Omaha 8/b": 'NLO8', "No Limit|Big O": 'No Limit Big O', "No Limit|Big Easy": 'Big Easy',
      "Limit|Omaha": 'Limit Omaha Hi', "Limit|Omaha 8/b": 'O8', "Limit|Big O": 'Limit Big O', "Limit|Big Easy": 'Big Easy',
      "Pot Limit|PLO5": 'PLO5', "Pot Limit|PLO6": 'PLO6',
      "No Limit|Double Board Bomb Pot": 'Bomb Pot',
      "Pot Limit|Courchevel": 'Courchevel',
    };
    // Points-based games — no structure prefix
    if (selectedGame === 'OFC') return 'OFC';
    const key = bettingStructure + '|' + selectedGame;
    const base = overrides[key] || (
      ['Stud Hi','Stud 8/b','Razz','Stud Hi/Lo Regular','2-7 Razz','Razzdugi','Razzdeucy',
       '2-7 Triple Draw','A-5 Triple Draw','Badugi','Badeucy','Badacey','Archie 66','Archie 99','Ari'].includes(selectedGame) && bettingStructure === 'Limit'
        ? selectedGame
        : bettingStructure + ' ' + selectedGame
    );
    return superPrefix + actionPrefix + base;
  }, [bettingStructure, selectedGame, studSuper, studAction, selectedCategory]);

  const categoryGroups = useMemo(() => [
    { label: "Hold'em", games: ["Hold'em", 'Pineapple', 'Short Deck'] },
    { label: 'Omaha',   games: ['Omaha', 'Omaha 8/b', 'Big O', 'Big Easy', 'PLO5', 'PLO6'],
                        more:  ['Double Board Bomb Pot', 'Courchevel'] },
    { label: 'Stud',    games: ['Stud Hi', 'Stud 8/b', 'Razz'],
                        more:  ['Stud Hi/Lo Regular', '2-7 Razz', 'Razzdugi', 'Razzdeucy'] },
    { label: 'Draw',    games: ['2-7 Triple Draw', '2-7 Single Draw', 'A-5 Triple Draw', 'Badugi', '5-Card Draw'],
                        more:  ['A-5 Single Draw', 'Badeucy', 'Badacey', 'Archie 66', 'Archie 99', 'Ari'] },
    { label: 'Other',   games: ['OFC', 'Dramaha Hi', 'Dramaha 2-7', 'Dramaha 49', 'Dramaha 0', 'Dramadugi', 'Omajack', ...games.map(g => g.name || g.game_name).filter(Boolean)] },
  ], [games]);

  const FAVE_DEFAULTS = useMemo(() => [
    { game: "Hold'em", structure: 'No Limit' },
    { game: 'Omaha',   structure: 'Pot Limit' },
    { game: 'Stud Hi', structure: 'Limit' },
    { game: '2-7 Triple Draw', structure: 'Limit' },
  ], []);

  const favorites = useMemo(() => {
    if (!gameHistory.length) return FAVE_DEFAULTS;
    const counts = {}, lastSeen = {};
    gameHistory.forEach(({ game, structure }, i) => {
      const k = game + '|' + structure;
      counts[k] = (counts[k] || 0) + 1;
      lastSeen[k] = i;
    });
    const sorted = Object.keys(counts).sort((a, b) =>
      counts[b] !== counts[a] ? counts[b] - counts[a] : lastSeen[b] - lastSeen[a]
    );
    const result = sorted.slice(0, 4).map(k => {
      const idx = k.lastIndexOf('|');
      return { game: k.slice(0, idx), structure: k.slice(idx + 1) };
    });
    for (const def of FAVE_DEFAULTS) {
      if (result.length >= 4) break;
      if (!result.some(f => f.game === def.game && f.structure === def.structure)) result.push(def);
    }
    return result;
  }, [gameHistory, FAVE_DEFAULTS]);

  const recordGameUse = (game, structure) => {
    setGameHistory(prev => {
      const next = [{ game, structure }, ...prev].slice(0, 20);
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
      ['Omaha', 'Omaha 8/b', 'Big O', 'Big Easy', 'PLO5', 'PLO6', 'Double Board Bomb Pot', 'Courchevel'].includes(game) ? 'Omaha' :
      ['Stud Hi', 'Stud 8/b', 'Razz', 'Stud Hi/Lo Regular', '2-7 Razz', 'Razzdugi', 'Razzdeucy'].includes(game) ? 'Stud' :
      ['2-7 Triple Draw', '2-7 Single Draw', 'A-5 Triple Draw', 'A-5 Single Draw',
       'Badugi', 'Badeucy', 'Badacey', 'Archie 66', 'Archie 99', 'Ari', '5-Card Draw'].includes(game) ? 'Draw' :
      'Other';
    setSelectedCategory(cat);
    if (cat !== 'Stud') { setStudSuper(false); setStudAction(false); }
    else if (!RAZZ_VARIANTS.includes(game)) setStudAction(false);
  };

  const handleStructureChange = (s) => {
    setBettingStructure(s);
    const map = structureGameMap[s];
    if (map && map[selectedGame]) setSelectedGameType(map[selectedGame]);
  };

  // Fetch saved hands
  const fetchHands = useCallback(async () => {
    if (!token) return;
    try {
      const [handsRes, gamesRes] = await Promise.all([
        fetch(`${API_URL}/replayer/hands`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/replayer/games`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (handsRes.ok) setHands(await handsRes.json());
      if (gamesRes.ok) setGames(await gamesRes.json());
    } catch (e) { console.error('Replayer fetch error:', e); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (token) fetchHands(); }, [token, fetchHands]);

  // Handle initialHand prop changes
  useEffect(() => {
    if (initialHand) {
      setCurrentHand(initialHand);
      setMode('replay');
      setTitle('');
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
        if (toast?.info) toast.info(`Failed to load hand (${res.status})`);
        return;
      }
      {
        const data = await res.json();
        let handData = typeof data.hand_data === 'string' ? JSON.parse(data.hand_data) : data.hand_data;
        // Backwards-compat: old saves wrapped the entire POST body as hand_data,
        // so the actual hand object lives under handData.handData
        if (handData && handData.handData && !handData.streets) handData = handData.handData;
        // Normalize missing fields so the replay view never crashes on old/incomplete records
        if (!handData.streets) handData.streets = [];
        if (!handData.players) handData.players = [];
        if (handData.gameType && !HAND_CONFIG[handData.gameType]) {
          const cc = handData.customConfig;
          if (cc) {
            HAND_CONFIG[handData.gameType] = { heroCards: cc.heroCards || 2, hasBoard: !!cc.hasBoard, boardMax: cc.hasBoard ? 5 : 0, isStud: !!cc.isStud, heroPlaceholder: '' };
            STREET_DEFS['custom_' + handData.gameType] = {
              streets: cc.streetNames || handData.streets.map(s => s.name),
              boardCards: (cc.streetNames || handData.streets.map(s => s.name)).map((_, i) => !cc.hasBoard ? 0 : i === 0 ? 0 : i === 1 ? 3 : 1),
            };
          } else {
            // Fallback: infer from hand data
            const streets = handData.streets || [];
            const hasBoard = streets.some(s => s.cards?.board);
            HAND_CONFIG[handData.gameType] = { heroCards: 2, hasBoard, boardMax: hasBoard ? 5 : 0, isStud: false, heroPlaceholder: '' };
            STREET_DEFS['custom_' + handData.gameType] = {
              streets: streets.map(s => s.name),
              boardCards: streets.map((_, i) => !hasBoard ? 0 : i === 0 ? 0 : i === 1 ? 3 : 1),
            };
          }
        }
        setCurrentHand(handData);
        setCurrentHandId(data.id);
        setTitle(data.title || '');
        setNotes(data.notes || '');
        setIsPublic(!!data.is_public);
        setMode('replay');
      }
    } catch (e) {
      console.error('Failed to load hand:', e);
      if (toast?.info) toast.info('Failed to load hand: ' + (e.message || 'network error'));
    }
  };

  const saveHand = async (hand) => {
    if (!token) return;
    setLoading(true);
    try {
      const payload = { handData: hand, gameType: hand.gameType, title: title || (hand.gameType + ' Hand'), notes, isPublic };
      let res;
      if (currentHandId) {
        res = await fetch(`${API_URL}/replayer/hands/${currentHandId}`, {
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
      fetchHands();
      toast('Hand saved');
    } catch (e) { console.error('Failed to save hand:', e); }
    setLoading(false);
  };

  const deleteHand = async (handId) => {
    if (!token) return;
    try {
      await fetch(`${API_URL}/replayer/hands/${handId}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      fetchHands();
      toast('Hand deleted');
    } catch (e) { console.error('Failed to delete hand:', e); }
  };

  const handleEntryDone = (hand) => {
    setCurrentHand(hand);
    saveHand(hand);
    setMode('replay');
  };

  const handleParseShorthand = () => {
    const { hand, errors } = parseHandText(shorthandText, selectedGame || 'NLH');
    setShorthandErrors(errors || []);
    if (hand) {
      setCurrentHand(hand);
      setEntryTab('form'); // switch back to form view to review/edit
    }
  };

  const startNewHand = () => {
    if (selectedGameType === 'Custom') {
      const gameName = customGameName.trim() || 'Custom';
      const heroCards = Math.max(1, Math.min(13, customHeroCards));
      const cat = customCategory;
      const hasBoard = cat === 'community';
      const isStud = cat === 'stud';
      HAND_CONFIG[gameName] = { heroCards, hasBoard, boardMax: hasBoard ? 5 : 0, isStud, heroPlaceholder: '' };
      let streetNames;
      if (customStreetNames.trim()) streetNames = customStreetNames.split(',').map(s => s.trim()).filter(Boolean);
      else streetNames = (STREET_DEFS[cat] || STREET_DEFS.community).streets;
      if (!STREET_DEFS['custom_' + gameName]) {
        const boardCards = streetNames.map((_, i) => { if (!hasBoard) return 0; if (i === 0) return 0; if (i === 1) return 3; return 1; });
        STREET_DEFS['custom_' + gameName] = { streets: streetNames, boardCards };
      }
      const customDef = STREET_DEFS['custom_' + gameName];
      const hand = {
        gameType: gameName,
        customConfig: { heroCards, category: cat, streetNames: customDef.streets, hasBoard, isStud },
        players: [
          { name: heroName || 'Hero', position: 'BTN', startingStack: 50000 },
          { name: 'Opp 1', position: 'BB', startingStack: 50000 },
        ],
        blinds: { sb: 100, bb: 200, ante: (hasBoard && !isStud) ? 200 : 0 },
        streets: customDef.streets.map(name => ({ name, cards: { hero: '', opponents: [''], board: '' }, actions: [], draws: [] })),
        result: null,
      };
      setCurrentHand(hand);
    } else {
      const hand = createEmptyHand(selectedGameType, heroName);
      const isRazzGame = RAZZ_VARIANTS.includes(selectedGame);
      if (studAction && isRazzGame) hand.gameType = 'Action ' + hand.gameType;
      if (studSuper && selectedCategory === 'Stud') hand.gameType = 'Super ' + hand.gameType;
      setCurrentHand(hand);
      recordGameUse(selectedGame, bettingStructure);
    }
    setCurrentHandId(null);
    setTitle('');
    setNotes('');
    setIsPublic(false);
    setMode('entry');
  };

  // ── Replay mode ──
  if (mode === 'replay' && currentHand) {
    return (
      <div className="replayer-view is-replay">
        <div className="replayer-header">
          <h2>{title || currentHand.gameType + ' Hand'}</h2>
          <span className="replayer-hand-card-game">{currentHand.gameType + (currentHand.blinds ? ' ' + formatChipAmount(currentHand.blinds.sb) + '/' + formatChipAmount(currentHand.blinds.bb) + (currentHand.blinds.ante ? '/' + formatChipAmount(currentHand.blinds.ante) : '') : '')}</span>
        </div>
        {/* 76: .replayer-notes-area — label, textarea, focus ring, all
            tokenised — had zero JSX consumers, so notes were write-only from
            the API's point of view and read back through an inline 0.7rem
            div. The isPublic flag was in the save payload with no control
            anywhere that could set it. */}
        {notes && (
          <div className="replayer-notes-area">
            <label>Notes</label>
            <div className="replayer-notes-read">{notes}</div>
          </div>
        )}
        <ReplayErrorBoundary onBack={() => { setMode('list'); fetchHands(); }}>
          <HandReplayerReplayView
            hand={currentHand}
            onEdit={() => setMode('entry')}
            onBack={() => { setMode('list'); fetchHands(); }}
            cardSplay={cardSplay}
            onSolveSpot={onSolveSpot}
          />
        </ReplayErrorBoundary>
      </div>
    );
  }

  // ── Entry mode ──
  if (mode === 'entry' && currentHand) {
    return (
      <div className="replayer-view">
        <div className="gto-sticky-header">
          <div className="replayer-header"><h2>New Hand</h2></div>
          {/* Form / Text toggle */}
          <div className="live-update-tabs" style={{marginBottom:'8px'}}>
            <button className={entryTab === 'form' ? 'active' : ''} onClick={() => setEntryTab('form')}>Form</button>
            <button className={entryTab === 'text' ? 'active' : ''} onClick={() => setEntryTab('text')}>Text</button>
          </div>
          {entryTab === 'form' && currentHand.gameType !== 'OFC' && <div className="live-update-tabs" style={{marginBottom:'8px'}}>
            <button className={entryMode === 'gto' ? 'active' : ''} onClick={() => setEntryMode('gto')}>GTO Style</button>
            <button className={entryMode === 'classic' ? 'active' : ''} onClick={() => setEntryMode('classic')}>Classic</button>
          </div>}
          {entryTab === 'form' && <>
            <div className="replayer-row" style={{marginBottom:'8px'}}>
              <div className="replayer-field">
                <label>Title</label>
                <input type="text" placeholder="e.g. Huge pot with AA" value={title} onChange={e => setTitle(e.target.value)} />
              </div>
            </div>
            {/* 76: .replayer-notes-area was fully styled — label, textarea,
                focus ring, all tokenised — with no JSX consumer anywhere, and
                isPublic went into the save payload with no control that could
                ever set it. Both were saved and neither was editable. */}
            <div className="replayer-notes-area">
              <label htmlFor="replayer-notes">Notes</label>
              <textarea id="replayer-notes" value={notes} placeholder="What were you thinking here?"
                onChange={e => setNotes(e.target.value)} />
              <div className="replayer-settings-row" style={{marginBottom:0}}>
                <div className="replayer-settings-label">Share publicly</div>
                <button className={'replayer-settings-toggle' + (isPublic ? ' on' : '')}
                  aria-pressed={isPublic} aria-label="Share this hand publicly"
                  onClick={() => setIsPublic(v => !v)} />
              </div>
            </div>
          </>}
          <div id="gto-sticky-slot"></div>
        </div>
        {entryTab === 'text' ? (
          <div style={{padding:'12px'}}>
            <textarea
              placeholder={'25/50\nUTG: AhKd  HJ: 9c8c  BTN: raise 3x  SB: fold  BB: call\n/ Qh Jc 2d  check  bet 50  fold\n/ 7s  bet 200  fold'}
              style={{width:'100%', minHeight:140, fontFamily:'monospace', fontSize:'0.8rem',
                      background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)',
                      borderRadius:6, padding:8, resize:'vertical', boxSizing:'border-box'}}
              value={shorthandText}
              onChange={e => setShorthandText(e.target.value)}
            />
            {/* 73: --text-warning is defined nowhere in the stylesheet, so this
                always fell through to the literal after the comma — a
                token-shaped string that was never a token. --warn is the one
                the ramp actually declares. */}
            {shorthandErrors.length > 0 && (
              <div className="replayer-field-error" style={{color:'var(--warn)'}}>
                {shorthandErrors.map((e,i) => <div key={i}>&#9888; {e}</div>)}
              </div>
            )}
            <button className="create-group-submit" style={{marginTop:8, width:'100%'}}
              onClick={handleParseShorthand}>
              Parse Hand
            </button>
          </div>
        ) : (entryMode === 'gto' || currentHand.gameType === 'OFC') ? (
          <GTOEntryView
            hand={currentHand}
            setHand={setCurrentHand}
            onDone={handleEntryDone}
            onCancel={() => setMode('list')}
            heroName={heroName}
          />
        ) : (
          <HandReplayerEntry
            hand={currentHand}
            setHand={setCurrentHand}
            onDone={handleEntryDone}
            onCancel={() => setMode('list')}
          />
        )}
      </div>
    );
  }

  /* 100: the loading branch was one line of text with no shape, so the picker
     rendered a sentence and then snapped the whole screen in when the fetch
     landed — while this app ships a full skeleton kit that the schedule,
     dashboard and admin screens all use. The placeholder is the shape of what
     is coming: the new-hand panel, then rows with a card slot at the left. */
  if (loading) {
    return (
      <div className="replayer-view">
        <div className="replayer-header"><h2>Hand Replayer</h2></div>
        <div className="replayer-section" style={{marginBottom:'12px'}}>
          <div className="skeleton skeleton-text" style={{width: 96, height: 13, marginBottom: 12}} />
          <div style={{display:'flex', gap: 6, flexWrap:'wrap'}}>
            {[64, 78, 58, 70].map((w, i) => (
              <div key={i} className="skeleton" style={{width: w, height: 28, borderRadius: 'var(--radius-sm)'}} />
            ))}
          </div>
        </div>
        <div className="skeleton skeleton-text" style={{width: 86, height: 13, marginBottom: 10}} />
        <div className="replayer-hand-list">
          {[0, 1, 2].map(i => (
            <div key={i} className="replayer-hand-card is-row">
              <div className="replayer-hand-card-cards">
                <div className="skeleton" style={{width: 30, height: 30, borderRadius: 'var(--radius-xs)'}} />
              </div>
              <div className="replayer-hand-card-body">
                <div className="skeleton skeleton-text" style={{width: i === 1 ? 150 : 116, height: 12}} />
                <div className="skeleton skeleton-text" style={{width: 74, height: 10}} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── List mode ──
  return (
    <div className="replayer-view">
      <div className="replayer-header">
        {/* 75: replay mode used the stylesheet's heading, list mode
            inline-overrode the SAME element to a smaller muted size with a
            literal tracking and a font-family string, and entry mode rendered
            it unstyled — so the page title shrank and greyed as you navigated
            between three screens of one feature. */}
        <h2>Hand Replayer</h2>
      </div>

      {/* New hand creation */}
      <div className="replayer-section" style={{marginBottom:'12px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
          <div className="replayer-section-title">New Hand</div>
          <span style={{fontSize:'0.7rem',color:'var(--accent2)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontWeight: 'var(--fw-bold)'}}>{variantDisplayName}</span>
        </div>
        {/* Favorites row — above the full picker */}
        <div className="game-subheading">Favorites</div>
        <div className="game-faves-row">
          {favorites.map(fav => {
            const label = structureGameMap[fav.structure]?.[fav.game] || fav.game;
            const isActive = selectedGame === fav.game && bettingStructure === fav.structure;
            return (
              <button key={fav.game + '|' + fav.structure}
                className={`game-fave-btn${isActive ? ' active' : ''}`}
                onClick={() => {
                  handleGameSelect(fav.game);
                  setBettingStructure(fav.structure);
                  const map = structureGameMap[fav.structure];
                  if (map?.[fav.game]) setSelectedGameType(map[fav.game]);
                }}
              >{label}</button>
            );
          })}
        </div>
        {/* Game picker: tab bar + checklist */}
        <div className="game-subheading">Games</div>
        <div className="game-picker">
          {/* Category tabs */}
          <div className="game-tab-bar">
            {categoryGroups.map(cat => (
              <button key={cat.label}
                className={`game-tab-btn${selectedCategory === cat.label ? ' active' : ''}`}
                onClick={() => {
                  const allGames = [...cat.games, ...(cat.more || []), ...(cat.hidden || [])];
                  if (!allGames.includes(selectedGame)) handleGameSelect(cat.games[0]);
                  setSelectedCategory(cat.label);
                  setStudSuper(false);
                  if (showMoreFor !== cat.label) setShowMoreFor(null);
                }}
              >{cat.label}</button>
            ))}
          </div>
          {/* Games in selected category — radio checklist */}
          {(() => {
            const cat = categoryGroups.find(c => c.label === selectedCategory);
            if (!cat) return null;
            const moreGames = cat.more || [];
            const moreSelected = moreGames.includes(selectedGame);
            const studModifiers = selectedCategory === 'Stud' && (studSuper || studAction);
            const moreOpen = showMoreFor === selectedCategory || moreSelected || studModifiers;
            const checkboxRow = (label, checked, onToggle, disabled) => (
              <div key={label} className={`game-check-row${checked ? ' selected' : ''}`}
                style={{opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : 'pointer'}}
                onClick={disabled ? undefined : onToggle}
              >
                <div style={{
                  width:'13px', height:'13px', borderRadius:'3px', flexShrink:0,
                  border:`1.5px solid ${checked ? 'var(--accent2)' : 'var(--border)'}`,
                  background: checked ? 'var(--accent2)' : 'transparent',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  transition:'background 0.15s,border-color 0.15s',
                }}>
                  {checked && <span style={{color:'#fff',fontSize:'9px',lineHeight:1,fontWeight:700}}>✓</span>}
                </div>
                <span className={`game-check-row-label${checked ? ' selected' : ''}`}
                  style={{fontFamily:"'Univers Condensed','Univers',sans-serif",textTransform:'uppercase',fontSize:'0.68rem',letterSpacing:'0.5px'}}
                >{label}</span>
              </div>
            );
            return (<>
              {cat.games.map(game => {
                const isSelected = selectedGame === game;
                return (
                  <div key={game}
                    className={`game-check-row${isSelected ? ' selected' : ''}`}
                    onClick={() => handleGameSelect(game)}
                  >
                    <div className={`game-check-radio${isSelected ? ' selected' : ''}`}>
                      {isSelected && <div className="game-check-radio-dot"/>}
                    </div>
                    <span className={`game-check-row-label${isSelected ? ' selected' : ''}`}>{game}</span>
                  </div>
                );
              })}
              {/* More dropdown — includes variant games + Stud modifiers */}
              {moreGames.length > 0 && (<>
                {moreOpen && (<>
                  {moreGames.map(game => (
                    <div key={game}
                      className={`game-check-row${selectedGame === game ? ' selected' : ''}`}
                      onClick={() => handleGameSelect(game)}
                    >
                      <div className={`game-check-radio${selectedGame === game ? ' selected' : ''}`}>
                        {selectedGame === game && <div className="game-check-radio-dot"/>}
                      </div>
                      <span className={`game-check-row-label${selectedGame === game ? ' selected' : ''}`}>{game}</span>
                    </div>
                  ))}
                  {selectedCategory === 'Stud' && (
                    <div style={{borderTop:'1px solid var(--border)'}}>
                      {checkboxRow('Super', studSuper, () => setStudSuper(p => !p), false)}
                      {checkboxRow('Action', studAction, () => setStudAction(p => !p), !RAZZ_VARIANTS.includes(selectedGame))}
                    </div>
                  )}
                </>)}
                <div className="game-check-more-row"
                  onClick={() => {
                    if (moreOpen && !moreSelected && !studModifiers) setShowMoreFor(null);
                    else if (!moreOpen) setShowMoreFor(selectedCategory);
                  }}
                >
                  <span className="game-check-more-btn">
                    {moreOpen && !moreSelected && !studModifiers ? '▲ Less' : '▼ More'}
                  </span>
                </div>
              </>)}
            </>);
          })()}
          {/* Betting structure — hidden for OFC */}
          {selectedGame !== 'OFC' && (()=> {
            const dimmed = new Set(
              selectedCategory === 'Stud'     ? ['No Limit', 'Pot Limit'] :
              selectedCategory === "Hold'em"  ? ['Pot Limit'] :
              selectedCategory === 'Omaha'    ? ['No Limit'] : []
            );
            return (
              <>
                <div className="game-check-section-label" style={{borderTop:'1px solid var(--border)'}}>Structure</div>
                {['No Limit', 'Pot Limit', 'Limit'].map(s => (
                  <div key={s}
                    className={`game-check-row${bettingStructure === s ? ' selected' : ''}`}
                    style={{opacity: dimmed.has(s) ? 0.35 : 1}}
                    onClick={() => handleStructureChange(s)}
                  >
                    <div className={`game-check-radio${bettingStructure === s ? ' selected' : ''}`}>
                      {bettingStructure === s && <div className="game-check-radio-dot"/>}
                    </div>
                    <span className={`game-check-row-label${bettingStructure === s ? ' selected' : ''}`}
                      style={{fontFamily:"'Univers Condensed','Univers',sans-serif",textTransform:'uppercase',fontSize:'0.7rem',letterSpacing:'0.4px'}}
                    >{s}</span>
                  </div>
                ))}
              </>
            );
          })()}
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:'10px'}}>
          <button className="btn btn-primary btn-sm" onClick={startNewHand}>Create {variantDisplayName} Hand</button>
        </div>
      </div>

      {/* Saved hands list */}
      <div className="replayer-section-title" style={{marginBottom:'6px'}}>Saved Hands</div>
      {/* 78: a single grey sentence — "Create one above" — pointing at a picker
          the user may well have scrolled past, on the screen whose entire job
          is to get a first hand recorded. */}
      {/* 81: the skeleton drew a new-hand panel plus three list rows and
           the empty state drew two card backs, a line and a button — so
           whichever one resolved, the layout moved. Same outer structure, so
          the change between them is a cross-fade rather than a reflow. */}
      {hands.length === 0 ? (
        <div className="replayer-hand-list">
          <div className="replayer-hand-card is-row is-empty">
            <div className="replayer-hand-card-cards" aria-hidden="true">
              <span className="card-unknown" /><span className="card-unknown" />
            </div>
            <div className="replayer-hand-card-body">
              <span className="replayer-hand-card-title">No saved hands yet</span>
              <span className="replayer-hand-card-meta">Record one and it will replay here</span>
            </div>
            <div className="replayer-hand-card-actions">
              <button className="btn btn-primary btn-sm" onClick={startNewHand}>
                Create {variantDisplayName} Hand
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="replayer-hand-list">
          {hands.map(h => (
            /* 59: a title, a game chip and a Delete button — no cards, no
               result, no date — in an app about cards, while the stylesheet
               shipped -meta and -actions classes this list never used. Nobody
               looks for "Hand 14"; they look for that AA hand they lost. */
            <div key={h.id} className={'replayer-hand-card is-row' + (outcomeOf(h) ? ' outcome-' + outcomeOf(h) : '')}
              onClick={() => loadHand(h.id)}
            >
              <div className="replayer-hand-card-cards" aria-hidden="true">
                <CardRow text={heroCardsOf(h)} max={2} splay={12} />
              </div>
              <div className="replayer-hand-card-body">
                <span className="replayer-hand-card-title">{h.title || 'Untitled'}</span>
                {/* 82: two hands with the same cards are told apart by their
                    STAKES, and hand.blinds is already in this payload — the
                    list endpoint spreads the whole hand blob into every row. */}
                <span className="replayer-hand-card-meta">
                  {h.game_type}
                  {h.blinds?.bb ? ' ' + formatChipAmount(h.blinds.sb) + '/' + formatChipAmount(h.blinds.bb) : ''}
                  {h.created_at ? ' \u00b7 ' + new Date(h.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, {month:'short', day:'numeric'}) : ''}
                </span>
              </div>
              <div className="replayer-hand-card-actions" onClick={e => e.stopPropagation()}>
                <button className="btn btn-ghost btn-sm" onClick={() => deleteHand(h.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ── Replay View Sub-component ────────────────────────────
// ══════════════════════════════════════════════════════════
function HandReplayerReplayView({ hand, onEdit, onBack, cardSplay, onSolveSpot }) {
  /* The GIF export's completion toasts referenced `toast` from inside this
     component, where it was never declared - the outer HandReplayerView owns
     the one call to useToast(). Optional chaining does not save an UNDECLARED
     identifier, so every successful GIF export ended in a ReferenceError
     inside onDone, which is why it never announced where the file went. */
  const toast = useToast();
  const [streetIdx, setStreetIdx] = useState(0);
  const [actionIdx, setActionIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000);
  const [showResult, setShowResult] = useState(false);
  const [hiloAnimate, setHiloAnimate] = useState(false);
  /* A landscape screen gets a landscape table, on a phone held sideways and on
     a desktop alike — the shape of the screen is the whole question. What the
     mode must not do is come out bigger than the space it has, which is
     handled where the table is sized rather than by refusing to enter here. */
  const LANDSCAPE_Q = '(orientation: landscape)';
  const [isLandscape, setIsLandscape] = useState(() => window.matchMedia(LANDSCAPE_Q).matches);
  useEffect(() => {
    const mql = window.matchMedia(LANDSCAPE_Q);
    const handler = (e) => { setIsLandscape(e.matches); };
    mql.addEventListener('change', handler);
    return () => { mql.removeEventListener('change', handler); };
  }, []);
  const [showSettings, setShowSettings] = useState(false);
  const [feltColor, setFeltColor] = useState(() => localStorage.getItem('replayerFeltColor') || '#6b5b8a');
  const [cardTheme, setCardTheme] = useState(() => localStorage.getItem('replayerCardTheme') || 'default');
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
    const apply = (h) => {
      const root = el.closest('.replayer-replay');
      if (root && h > 0) root.style.setProperty('--bar-h', Math.round(h) + 'px');
    };
    apply(el.getBoundingClientRect().height);
    const ro = new ResizeObserver(() => apply(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const prevActionIdxRef = useRef(-1);
  const prevShowResultRef = useRef(false);

  // Video export state
  const [videoExporting, setVideoExporting] = useState(false);
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
  const _theme = useReplayerSetting('Theme', 'default');
  const _tableShape = useReplayerSetting('TableShape', 'oval');
  const _cardBack = useReplayerSetting('CardBack', 'default');
  const _cardBackColor = useReplayerSetting('CardBackColor', '#1a3a6e');
  /* 99: the control reads "High-Contrast Deck" and applies .hc-deck, while
     the state key, the persisted preference and every update call still said
     fourColorDeck — a leftover from repurposing the dead four-colour toggle.
     Anyone reading the state, or a stored preference, was told this app has a
     four-colour deck setting that it does not have. Renamed, with a one-time
     read of the old value so nobody's stored choice is lost. */
  const _hcDeck = useReplayerSetting('HighContrastDeck', (() => {
    const legacy = localStorage.getItem('replayerFourColorDeck');
    return legacy === null ? false : legacy === 'true';
  })());
  /* Defaulted off, which meant PotChipVisual, getChipBreakdown, the
     denomination ladder and the edge pips had all been built and never seen.
     A pot with no chips in it is a number floating on cloth. */
  const _showChipStacks = useReplayerSetting('ShowChipStacks', true);
  const _showHandStrength = useReplayerSetting('ShowHandStrength', false);
  const _showPotOdds = useReplayerSetting('ShowPotOdds', false);
  const _showCommentary = useReplayerSetting('ShowCommentary', false);
  const _showTimeline = useReplayerSetting('ShowTimeline', true);
  const _showPlayerStats = useReplayerSetting('ShowPlayerStats', false);
  const _showNuts = useReplayerSetting('ShowNutsHighlight', false);
  const _showSPR = useReplayerSetting('ShowSPR', false);
  const _showBetSizing = useReplayerSetting('ShowBetSizing', false);
  const _showRanges = useReplayerSetting('ShowRanges', false);
  const _showChipDelta = useReplayerSetting('ShowChipDelta', false);
  const _showEquity = useReplayerSetting('ShowEquity', false);
  const _stacksInBB = useReplayerSetting('StacksInBB', false);
  // 99: off by default. Sound that starts without being asked for is worse
  // than no sound, and this is a screen people open in card rooms.
  const _soundDeal = useReplayerSetting('SoundDeal', false);
  const _soundChips = useReplayerSetting('SoundChips', false);
  const _soundFold = useReplayerSetting('SoundFold', false);
  const _soundAllIn = useReplayerSetting('SoundAllIn', false);
  const _cardSplay = useReplayerSetting('CardSplay', true);
  const _lightStrip = useReplayerSetting('LightStrip', false);
  const _animDeal = useReplayerSetting('AnimateDeal', true);
  const _animChips = useReplayerSetting('AnimateChips', true);
  const _animBoard = useReplayerSetting('AnimateBoard', true);
  const _animWinner = useReplayerSetting('AnimateWinner', true);
  const _animFold = useReplayerSetting('AnimateFold', true);

  const rSettings = {
    theme: _theme[0], tableShape: _tableShape[0], feltColor, cardBack: _cardBack[0], cardBackColor: _cardBackColor[0],
    highContrastDeck: _hcDeck[0], showChipStacks: _showChipStacks[0], showHandStrength: _showHandStrength[0],
    showPotOdds: _showPotOdds[0], showCommentary: _showCommentary[0], showTimeline: _showTimeline[0],
    showPlayerStats: _showPlayerStats[0], showNutsHighlight: _showNuts[0],
    showSPR: _showSPR[0], showBetSizing: _showBetSizing[0],
    showRanges: _showRanges[0], showChipDelta: _showChipDelta[0],
    showEquity: _showEquity[0], stacksInBB: _stacksInBB[0],
    soundDeal: _soundDeal[0], soundChips: _soundChips[0],
    soundFold: _soundFold[0], soundAllIn: _soundAllIn[0],
    animateDeal: _animDeal[0], animateChips: _animChips[0], animateBoard: _animBoard[0], animateWinner: _animWinner[0],
    animateFold: _animFold[0],
    cardTheme, cardSplay: _cardSplay[0], lightStrip: _lightStrip[0],
  };
  const rSetters = {
    theme: _theme[1], tableShape: _tableShape[1], feltColor: v => { setFeltColor(v); localStorage.setItem('replayerFeltColor', v); },
    cardBack: _cardBack[1], cardBackColor: _cardBackColor[1], highContrastDeck: _hcDeck[1],
    showChipStacks: _showChipStacks[1], showHandStrength: _showHandStrength[1], showPotOdds: _showPotOdds[1],
    showCommentary: _showCommentary[1], showTimeline: _showTimeline[1], showPlayerStats: _showPlayerStats[1],
    showNutsHighlight: _showNuts[1],
    showSPR: _showSPR[1], showBetSizing: _showBetSizing[1],
    showRanges: _showRanges[1], showChipDelta: _showChipDelta[1],
    showEquity: _showEquity[1], stacksInBB: _stacksInBB[1],
    soundDeal: _soundDeal[1], soundChips: _soundChips[1],
    soundFold: _soundFold[1], soundAllIn: _soundAllIn[1],
    animateDeal: _animDeal[1], animateChips: _animChips[1], animateBoard: _animBoard[1], animateWinner: _animWinner[1],
    animateFold: _animFold[1],
    cardTheme: v => { setCardTheme(v); localStorage.setItem('replayerCardTheme', v); },
    cardSplay: _cardSplay[1], lightStrip: _lightStrip[1],
  };
  const handleSettingsUpdate = (key, val) => { if (rSetters[key]) rSetters[key](val); };
  /* The sound calls live inside effects whose dependency arrays deliberately
     do not name the settings object — re-running a deal because a toggle moved
     would re-deal the hand. A ref keeps them reading the current settings. */
  const rSettingsRef = useRef(rSettings);
  rSettingsRef.current = rSettings;

  /* 44: the display surfaces where depth is the point — stacks, pot, wagers —
     go through this; commentary and exports keep chip counts, because prose
     that says 'he shoved 14 BB' reads oddly next to a hand history. */
  const _bb = (hand.blinds || {}).bb || 0;
  const fmtChips = (v) => formatChipAmount(v, rSettings.stacksInBB ? _bb : 0);

  // Guard against old/incomplete hand records with no streets
  if (!hand.streets || hand.streets.length === 0) {
    return (
      <div style={{padding:'32px',textAlign:'center',color:'var(--text-muted)'}}>
        <div style={{marginBottom:'12px',fontSize:'0.85rem'}}>This hand has no recorded streets.</div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back to list</button>
      </div>
    );
  }

  const gameCfg = HAND_CONFIG[hand.gameType] || HAND_CONFIG_DEFAULT;
  const category = getGameCategory(hand.gameType);
  const streetDef = getStreetDef(hand.gameType);
  const gameEval = GAME_EVAL[hand.gameType];
  const isHiLo = gameEval && (gameEval.type === 'hilo' || gameEval.type === 'split-badugi');
  const totalStreets = hand.streets.length;
  const currentStreet = hand.streets[streetIdx];
  const currentActions = currentStreet?.actions || [];
  const isDrawGame = category === 'draw_triple' || category === 'draw_single';
  const replayHeroIdx = hand.heroIdx != null ? hand.heroIdx : 0;

  // Street change animation
  useEffect(() => {
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
      if (act && act.action === 'fold') playTableSound('fold', rSettingsRef.current);
      if (act && act.action === 'all-in') playTableSound('allIn', rSettingsRef.current);
      if (act && act.action === 'fold' && rSettings.animateFold) {
        setAnimFolded(prev => { const n = new Set(prev); n.add(act.player); return n; });
        setTimeout(() => { setAnimFolded(prev => { const n = new Set(prev); n.delete(act.player); return n; }); }, 450);
      }
    }
    prevActionIdxRef.current = actionIdx;
  }, [actionIdx, currentActions, rSettings.animateFold]);
  useEffect(() => { setAnimFolded(new Set()); }, [streetIdx]);

  // Showdown animation
  useEffect(() => {
    if (showResult && !prevShowResultRef.current && rSettings.animateDeal) {
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
    // 99: one hiss per card, on the same stagger the animation uses.
    const cards = gameCfg.heroCards || 2;
    const shots = [];
    for (let c = 0; c < cards; c++) {
      for (let i = 0; i < hand.players.length; i++) {
        shots.push(setTimeout(() => playTableSound('deal', rSettingsRef.current),
          c * hand.players.length * 70 + i * 70));
      }
    }
    // 400ms animation + the longest per-seat delay.
    const t = setTimeout(() => setAnimDealing(false), 400 + hand.players.length * 80);
    return () => { clearTimeout(t); shots.forEach(clearTimeout); };
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
    if (category !== 'community') return '';
    let board = '';
    for (let si = 0; si <= streetIdx && si < hand.streets.length; si++) {
      if (hand.streets[si].cards.board) board += hand.streets[si].cards.board;
    }
    return board;
  }, [hand, streetIdx, category]);

  // Hero cards
  const heroCards = useMemo(() => {
    if (category === 'stud') {
      let cards = '';
      for (let si = 0; si <= streetIdx; si++) { if (hand.streets[si]?.cards.hero) cards += hand.streets[si].cards.hero; }
      return cards;
    }
    if (isDrawGame) {
      const base = hand.streets[0]?.cards.hero || '';
      const heroDraws = getPlayerDrawsByStreet(hand, replayHeroIdx);
      return computeDrawHand(base, heroDraws, streetIdx - 1);
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
  const displayPot = useMemo(() => {
    if (!showResult) return calcPotsAndStacks(hand, streetIdx, -1).pot;
    const st = hand.streets[streetIdx];
    const lastAct = st && st.actions ? st.actions.length - 1 : -1;
    return calcPotsAndStacks(hand, streetIdx, lastAct).pot;
  }, [hand, streetIdx, showResult]);

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
    const contrib = hand.players.map((_, pi) => {
      let total = 0;
      for (let si = 0; si <= streetIdx && si < hand.streets.length; si++) {
        const acts = hand.streets[si].actions || [];
        const upTo = si === streetIdx ? actionIdx : acts.length - 1;
        let street = 0;
        for (let ai = 0; ai <= upTo && ai < acts.length; ai++) {
          const a = acts[ai];
          if (a.player !== pi || !a.amount) continue;
          street = a.action === 'raise' || a.action === 'all-in' ? Math.max(street, a.amount) : street + a.amount;
        }
        total += street;
      }
      return total;
    });
    const live = hand.players.map((_, pi) => pi).filter(pi => contrib[pi] > 0);
    if (!live.length) return [];
    const caps = [...new Set(live.filter(pi => allIn.has(pi)).map(pi => contrib[pi]))].sort((a, b) => a - b);
    const layers = [];
    let floor = 0;
    [...caps, Infinity].forEach(cap => {
      const eligible = live.filter(pi => contrib[pi] > floor && !folded.has(pi));
      const amount = live.reduce((sum, pi) => sum + Math.max(0, Math.min(contrib[pi], cap) - floor), 0);
      if (amount > 0 && eligible.length) layers.push({ amount, eligible: eligible.length, players: eligible });
      if (cap === Infinity) return;
      floor = cap;
    });
    return layers;
  }, [hand, streetIdx, actionIdx, allIn, folded]);
  // The pot row only has something to say when the pot actually split.
  const potLayers = useMemo(() => (allPotLayers.length > 1 ? allPotLayers : []), [allPotLayers]);
  /* 66: the pot counts toward its new value over the chips' flight. It snaps
     while scrubbing, because a rewind is not a payment. */
  const countedPot = useCountUp(displayPot, rSettings.animateChips && !rewinding);

  // "Solve this spot" → Solver handoff. Enabled only when the hand's
  // game maps to a solver-supported stud game (Stud 8 / Razz).
  const solverGame = solverGameFor(hand.gameType);
  const canSolveSpot = !!onSolveSpot && !!solverGame;
  const handleSolveSpot = useCallback(() => {
    if (!canSolveSpot) return;
    haptic();
    onSolveSpot(buildSolverSpot({
      hand, game: solverGame, streetIdx, heroCards, opponentCards, replayHeroIdx, folded, pot,
    }));
  }, [canSolveSpot, onSolveSpot, hand, solverGame, streetIdx, heroCards, opponentCards, replayHeroIdx, folded, pot]);

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

  // Eval result -- full evaluation from original
  const evalResult = useMemo(() => {
    if (showResult && hand.result && hand.result.winners) {
      return hand.result.winners.map(w => {
        const pName = w.playerIdx === replayHeroIdx ? 'Hero' : houseName(hand.players[w.playerIdx]?.name || 'Player');
        let winHandName = '';
        const pCards = w.playerIdx === replayHeroIdx ? heroCards : (opponentCards[w.playerIdx] || '');
        if (pCards && pCards !== 'MUCK') {
          const cfg = GAME_EVAL[hand.gameType];
          if (cfg) {
            const parsed = parseCardNotation(pCards).filter(c => c.suit !== 'x');
            const board = category === 'community' ? parseCardNotation(boardCards).filter(c => c.suit !== 'x') : [];
            let ev = null;
            if (cfg.type === 'high' || cfg.type === 'hilo') ev = cfg.method === 'omaha' ? bestOmahaHigh(parsed, board) : bestHighHand(parsed.concat(board));
            else if (cfg.type === 'low') ev = cfg.lowType === 'a5' ? bestLowA5Hand(parsed.concat(board), false) : bestLow27Hand(parsed.concat(board));
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
      });
    }
    if (!showResult || !gameEval) return null;
    // Full auto-evaluation
    const hCards = parseCardNotation(heroCards);
    const bCards = gameCfg.hasBoard ? parseCardNotation(boardCards) : [];
    if (gameCfg.hasBoard && bCards.length < 3) return null;
    if (hCards.length < (gameCfg.isStud ? 5 : gameCfg.heroCards)) return null;
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
      if (oRaw.length < (gameCfg.isStud ? 5 : gameCfg.heroCards)) continue;
      const oEval = gameCfg.isStud ? oRaw.filter(c => c.suit !== 'x') : assignNeutralSuits(oRaw, usedKeys, boardSuits);
      const ev = evaluateHand(hand.gameType, hEval, oEval, bCards);
      if (ev && ev.result) results.push({ index: pi, ...ev });
      oEval.forEach(c => { if (c.suit !== 'x') usedKeys.push(c.rank + c.suit); });
    }
    return results.length ? results : null;
  }, [showResult, hand, heroCards, opponentCards, boardCards, gameCfg, gameEval, folded, replayHeroIdx, category]);

  /* 26: calcShowdownEquity and a finished bar-plus-percentage style were
     both dead code, so at an all-in showdown the felt said nothing about who
     was ahead — the single question a viewer has at that moment. */
  /* 90: the bar rendered when showResult was true, which is after the hand
     has been decided — a scoreboard shown after the whistle. The moment a
     viewer wants a percentage is when the money goes IN, and then again as
     each card lands. It runs from the point the last live player is committed. */
  const runout = allIn.size > 0 && (hand.players.length - folded.size - allIn.size) <= 0;
  const showdownEquity = useMemo(() => {
    if (!rSettings.showEquity || !gameEval) return null;
    if (!showResult && !runout) return null;
    try {
      return calcShowdownEquity(hand, heroCards, opponentCards, boardCards, gameCfg, gameEval, folded, replayHeroIdx);
    } catch { return null; }
  }, [rSettings.showEquity, showResult, runout, hand, heroCards, opponentCards, boardCards, gameCfg, gameEval, folded, replayHeroIdx]);

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
    const cfg = GAME_EVAL[hand.gameType];
    if (!showResult || !cfg || cfg.type !== 'hilo') return null;
    const contesting = hand.players.map((_, pi) => pi).filter(pi => !folded.has(pi));
    const board = category === 'community' ? parseCardNotation(boardCards).filter(c => c.suit !== 'x') : [];
    const map = {};
    let readable = true;
    contesting.forEach(pi => {
      const raw = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
      const parsed = raw && raw !== 'MUCK' ? parseCardNotation(raw).filter(c => c.suit !== 'x') : [];
      if (parsed.length < (gameCfg.isStud ? 5 : (gameCfg.heroCards || 2))) { readable = false; return; }
      const hi = cfg.method === 'omaha' ? bestOmahaHigh(parsed, board) : bestHighHand(parsed.concat(board));
      const lo = cfg.method === 'omaha' ? bestOmahaLow(parsed, board) : bestLowA5Hand(parsed.concat(board), true);
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
     winner, or a mucked one, falls back to the stored entries' Hi/Lo flags. */
  const potAwards = useMemo(() => {
    if (!showResult) return null;
    const winners = flaggedWinners;
    if (!winners.length) return null;
    const contesting = hand.players.map((_, pi) => pi).filter(pi => !folded.has(pi));
    const layers = reconcileLayersToPot(allPotLayers, pot, contesting);
    const cfg = GAME_EVAL[hand.gameType];

    // Score every shown hand, so each layer can be re-decided among its own players.
    let evals = null;
    if (cfg && cfg.type === 'hilo') {
      const board = category === 'community' ? parseCardNotation(boardCards).filter(c => c.suit !== 'x') : [];
      const map = {};
      let readable = true;
      contesting.forEach(pi => {
        const raw = pi === replayHeroIdx ? heroCards : (opponentCards[pi] || '');
        const parsed = raw && raw !== 'MUCK' ? parseCardNotation(raw).filter(c => c.suit !== 'x') : [];
        if (parsed.length < (gameCfg.isStud ? 5 : (gameCfg.heroCards || 2))) { readable = false; return; }
        const hi = cfg.method === 'omaha' ? bestOmahaHigh(parsed, board) : bestHighHand(parsed.concat(board));
        const lo = cfg.method === 'omaha' ? bestOmahaLow(parsed, board) : bestLowA5Hand(parsed.concat(board), true);
        map[pi] = { hi: hi ? hi.score : null, lo: lo && lo.qualified ? lo.score : null };
      });
      if (readable && Object.keys(map).length) {
        // Only trust the cards if they say what the saved result says; a
        // hand-marked winner must stay the winner.
        const full = hiLoWinnersAmong(map, contesting);
        const fromCards = {};
        full.hiWinners.forEach(pi => { fromCards[pi] = { hi: true, lo: false }; });
        full.loWinners.forEach(pi => { fromCards[pi] = { hi: !!fromCards[pi]?.hi, lo: true }; });
        const agrees = winners.length === Object.keys(fromCards).length
          && winners.every(w => fromCards[w.playerIdx]
            && fromCards[w.playerIdx].hi === w.hi && fromCards[w.playerIdx].lo === w.lo);
        if (agrees) evals = map;
      }
    }

    const shaped = evals
      ? layers.map(l => ({ amount: l.amount, ...hiLoWinnersAmong(evals, l.players || contesting) }))
      : potLayerWinners(layers, winners);
    const btnIdx = hand.players.findIndex(p => p.position === 'BTN' || p.position === 'BTN/SB');
    const { awards } = computePotAwards(shaped, { order: seatOrderFromButton(hand.players.length, btnIdx) });
    return awards;
  }, [showResult, flaggedWinners, hand, allPotLayers, pot, folded, category, boardCards,
      heroCards, opponentCards, replayHeroIdx, gameCfg]);

  /* 38: at a hi-lo showdown every unfolded seat took .replayer-hilo-high and
     nudged 8px up together, which communicates nothing — and the down-shifting
     .replayer-hilo-low existed in the stylesheet with no code path that could
     ever apply it, so the animation built to dramatise the split never split.
     The Hi:/Lo: label matching was already written for the split circles. */
  const hiloSide = useMemo(() => {
    const out = {};
    if (!isHiLo || !showResult) return out;
    flaggedWinners.forEach(w => {
      // A scoop wins both halves, so it rises with the highs.
      out[w.playerIdx] = (w.hi || !w.lo) ? 'high' : 'low';
    });
    return out;
  }, [isHiLo, showResult, flaggedWinners]);

  // Navigation
  const canGoForward = streetIdx < totalStreets - 1 || actionIdx < currentActions.length - 1 || !showResult;
  const canGoBack = streetIdx > 0 || actionIdx >= 0 || showResult;

  // Update refs inline during render — guaranteed current before any async code runs.
  // useEffect is too late (fires after paint); inline assignment happens during commit.
  canGoForwardRef.current = canGoForward;

  const stepForward = useCallback(() => {
    if (actionIdx < currentActions.length - 1) setActionIdx(a => a + 1);
    else if (streetIdx < totalStreets - 1) { setStreetIdx(s => s + 1); setActionIdx(-1); }
    else if (!showResult) { setShowResult(true); if (isHiLo) setTimeout(() => setHiloAnimate(true), 100); }
    else setPlaying(false);
  }, [actionIdx, currentActions.length, streetIdx, totalStreets, showResult, isHiLo]);
  // Update inline so the export loop always gets the latest closure
  stepForwardRef.current = stepForward;


  const stepBack = useCallback(() => {
    markRewind();
    if (showResult) { setShowResult(false); setHiloAnimate(false); }
    else if (actionIdx >= 0) setActionIdx(a => a - 1);
    else if (streetIdx > 0) { const prevStreet = hand.streets[streetIdx - 1]; setStreetIdx(s => s - 1); setActionIdx((prevStreet?.actions?.length || 0) - 1); }
  }, [actionIdx, streetIdx, showResult, hand, markRewind]);

  const goToStart = () => { setStreetIdx(0); setActionIdx(-1); setShowResult(false); setHiloAnimate(false); };
  /* 51: this set the last street and the last action and stopped one step
     short of the showdown, so "End" landed on the river's final bet with the
     opponents' cards still face down. stepForward's final branch is what
     actually ends a hand; End does the same thing now. */
  const goToEnd = () => {
    const lastStreet = hand.streets.length - 1;
    setStreetIdx(lastStreet);
    setActionIdx((hand.streets[lastStreet]?.actions?.length || 0) - 1);
    setShowResult(true);
    if (isHiLo) setTimeout(() => setHiloAnimate(true), 100);
  };

  /* 50: at the result an effect forces playing false and stepForward's last
     branch pauses, so pressing play set playing true, ticked once, and paused
     again — a flicker and a no-op, under a glyph still showing a play
     triangle. From the end, play means replay. */
  const handlePlayPause = () => {
    if (!playing && !canGoForward) { goToStart(); setPlaying(true); return; }
    setPlaying(p => !p);
  };

  /* 60: the interval ran regardless of document visibility, so backgrounding
     the app played the hand out unseen and handed you back the result — and a
     throttled background timer gets the pacing wrong anyway. */
  /* 46: at 4x on a 30-action hand the strip scrolls past the viewport, so the
     one dot that matters has to be pulled back into it. */
  const timelineRef = useRef(null);
  // 78: past about twenty actions the strip scrolls further than it reads.
  const totalActionCount = hand.streets.reduce((n, st) => n + (st.actions?.length || 0), 0);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const dot = el.querySelector('.replayer-timeline-dot.current');
    if (!dot) return;
    /* This was dot.scrollIntoView({ block: 'nearest', inline: 'center' }),
       which scrolls EVERY scrollable ancestor, not just the strip — including
       .replayer-replay, whose overflow:hidden does not stop it being scrolled
       programmatically. Measured: the moment a draw street inserted its info
       bar below the table, the timeline dropped out of view, this fired, and
       the whole column scrolled 52px — which is the table moving under you
       mid-hand. The strip scrolls itself, horizontally, and nothing else
       moves. */
    const target = dot.offsetLeft - el.clientWidth / 2 + dot.offsetWidth / 2;
    const max = el.scrollWidth - el.clientWidth;
    el.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: 'smooth' });
  }, [streetIdx, actionIdx]);

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
  const [showExportMenu, setShowExportMenu] = useState(false);
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
    const allowance = rSettings.animateDeal
      ? (resultBreak ? 700 : streetBreak ? 650 : 0)
      : 0;
    const t = setTimeout(() => stepForwardRef.current?.(),
      Math.max(120, speed + actBeat + allowance * scale));
    return () => clearTimeout(t);
  }, [playing, tabHidden, speed, streetIdx, actionIdx, showResult, currentActions.length, totalStreets, rSettings.animateDeal]);

  useEffect(() => { if (showResult && playing) setPlaying(false); }, [showResult, playing]);

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
  const copyShareLink = useCallback(() => {
    try {
      const shorthand = encodeHand(hand);
      if (!shorthand) return;
      const url = window.location.origin + '/#h/' + encodeURIComponent(shorthand);
      navigator.clipboard.writeText(url).then(() => { setShareLinkCopied(true); setTimeout(() => setShareLinkCopied(false), 2000); });
    } catch (e) { console.error('Share link error:', e); }
  }, [hand]);

  // Seat class
  const getPlayerSeatClass = (playerIdx) => {
    if (folded.has(playerIdx)) return 'folded';
    if (showResult) {
      const manualWinners = hand.result?.winners;
      if (manualWinners && manualWinners.length > 0) {
        const entry = manualWinners.find(w => w.playerIdx === playerIdx);
        if (entry) return entry.split ? 'split' : 'winner';
        return manualWinners.length > 0 ? 'loser' : '';
      }
      if (evalResult) {
        if (playerIdx === replayHeroIdx) {
          const heroWins = evalResult.some(r => r.result.outcome === 'hero');
          const heroLoses = evalResult.some(r => r.result.outcome === 'opponent');
          const heroSplits = evalResult.some(r => r.result.outcome === 'split');
          if (heroWins && !heroLoses) return 'winner';
          if (heroLoses && !heroWins) return 'loser';
          if (heroSplits) return 'split';
        } else {
          const oppResult = evalResult.find(r => r.index === playerIdx);
          if (oppResult) {
            if (oppResult.result.outcome === 'opponent') return 'winner';
            if (oppResult.result.outcome === 'hero') return 'loser';
            if (oppResult.result.outcome === 'split') return 'split';
          }
        }
      }
    }
    return '';
  };

  // Hand name at showdown
  const getPlayerHandName = (playerIdx, useShort) => {
    if (!showResult || folded.has(playerIdx)) return null;
    const pCards = playerIdx === replayHeroIdx ? heroCards : (opponentCards[playerIdx] || '');
    if (!pCards) return null;
    const cfg = GAME_EVAL[hand.gameType];
    if (!cfg) return null;
    const parsed = parseCardNotation(pCards).filter(c => c.suit !== 'x');
    if (parsed.length < (gameCfg.heroCards || 2)) return null;
    const board = category === 'community' ? parseCardNotation(boardCards).filter(c => c.suit !== 'x') : [];
    if (cfg.type === 'hilo') {
      const hiEv = cfg.method === 'omaha' ? bestOmahaHigh(parsed, board) : bestHighHand(parsed.concat(board));
      const loEv = cfg.method === 'omaha' ? bestOmahaLow(parsed, board) : bestLowA5Hand(parsed.concat(board), true);
      /* Only a half this player won gets its label: "Hi:" is a claim, and it
         belongs to whoever won the high. */
      const wonHi = !hiLoHalves || hiLoHalves.hi.has(playerIdx);
      const wonLo = !hiLoHalves || hiLoHalves.lo.has(playerIdx);
      const parts = [];
      if (hiEv && wonHi) parts.push('Hi: ' + (useShort ? (hiEv.shortName || hiEv.name) : hiEv.name));
      if (loEv && loEv.qualified !== false && loEv.name && wonLo) parts.push('Lo: ' + loEv.name);
      if (parts.length) return parts.join('\n');
      /* Won neither half. The hand is still worth showing at a showdown —
         it just gets named, not captioned as a winning half. */
      if (hiEv) return useShort ? (hiEv.shortName || hiEv.name) : hiEv.name;
      return null;
    }
    let ev = null;
    if (cfg.type === 'high') ev = cfg.method === 'omaha' ? bestOmahaHigh(parsed, board) : bestHighHand(parsed.concat(board));
    else if (cfg.type === 'low') ev = cfg.lowType === 'a5' ? bestLowA5Hand(parsed.concat(board), false) : bestLow27Hand(parsed.concat(board));
    else if (cfg.type === 'badugi') ev = bestBadugiHand(parsed);
    if (!ev) return null;
    return useShort ? (ev.shortName || ev.name) : ev.name;
  };

  const themeClass = rSettings.theme !== 'default' ? ' theme-' + rSettings.theme : '';
  const shapeClass = rSettings.tableShape !== 'oval' ? ' shape-' + rSettings.tableShape : '';
  // Was ' four-color-deck', a class with zero rules in the stylesheet - a dead
  // switch. The deck is already four-colour; what it needs is value separation.
  const hcDeckClass = rSettings.highContrastDeck ? ' hc-deck' : '';
  const boardAnimClass = getBoardAnimClass();

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

      // Dark gradient background
      const grad = ctx.createLinearGradient(0, 0, 0, outH);
      grad.addColorStop(0, '#1a1a2e');
      grad.addColorStop(1, '#0f0f1a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, outW, outH);

      // Felt texture
      ctx.strokeStyle = 'rgba(34,197,94,0.08)';
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
          const img = images.get(key);
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

    // Reset replay to start before recording
    setStreetIdx(0);
    setActionIdx(-1);
    setShowResult(false);
    setHiloAnimate(false);
    setPlaying(false);

    // Wait a tick for React to commit the reset
    await new Promise(r => setTimeout(r, 120));

    setVideoExporting(true);
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
      },
    });
  }, [videoExporting, hand, speed, feltColor, toast]);

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
        else if (info?.shareMethod === 'download') toast?.success?.('GIF saved');
      },
      onError: (err) => {
        console.error('GIF export error:', err);
        setGifExporting(false); setGifProgress(0); setExportPreview(null);
        toast?.error?.('GIF export failed: ' + (err?.message || 'unknown'));
      },
    });
  }, [gifExporting, videoExporting, hand]);

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
                  <div className="ofc-replay-row ofc-replay-row-top"><div className="ofc-replay-row-label">Top</div><CardRow text={showResult ? pr.top : shownCards.top} max={3} placeholderCount={3} cardTheme={rSettings.cardTheme} /></div>
                  <div className="ofc-replay-row ofc-replay-row-middle"><div className="ofc-replay-row-label">Middle</div><CardRow text={showResult ? pr.middle : shownCards.middle} max={5} placeholderCount={5} cardTheme={rSettings.cardTheme} /></div>
                  <div className="ofc-replay-row ofc-replay-row-bottom"><div className="ofc-replay-row-label">Bottom</div><CardRow text={showResult ? pr.bottom : shownCards.bottom} max={5} placeholderCount={5} cardTheme={rSettings.cardTheme} /></div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="ofc-street-indicator">
          <span className="ofc-street-name">{ofcStreetNames[streetIdx] || 'Final'}</span>
          <span className="ofc-street-count">{streetIdx + 1} / {ofcTotalStreets}</span>
        </div>
        <div className="replayer-controls" style={{marginTop:'8px'}}>
          <button className="btn btn-ghost btn-sm" disabled={streetIdx === 0 && !showResult} onClick={() => { if (showResult) setShowResult(false); else if (streetIdx > 0) setStreetIdx(streetIdx - 1); }}>Prev</button>
          <button className="btn btn-ghost btn-sm" disabled={showResult} onClick={() => { if (streetIdx < ofcTotalStreets - 1) setStreetIdx(streetIdx + 1); else setShowResult(true); }}>Next</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowResult(!showResult)}>{showResult ? 'Hide All' : 'Show All'}</button>
        </div>
        <div style={{display:'flex',gap:'6px',justifyContent:'space-between',marginTop:'12px'}}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>Back to List</button>
          <div style={{display:'flex',gap:'6px'}}>
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

  /* The felt is a grid rectangle: in to column 2 and row 3. FY/FX still have
     to match --felt-y / --felt-x in styles.css. */
  const FX = gx(2), FY = gy(3);
  /* The seat ring runs half a cell inside the felt's edge, top row 5 and
     bottom row 27 — which puts its midpoint on row 16, the table's middle. */
  const CL = 2.5, CC = 8, CR = 13.5;      // seat columns
  const RT = 5, RB = 27;                  // seat rows, top and bottom
  const seat = (col, row) => [gx(col), gy(row)];

  /* Steps of seven cells down each side for three-a-side, and of nine for
     two-a-side (3f^2 + 22f - 151.25 = 0 -> f = 4.4, so 16 +/- 4.5). A pair of
     seats along the top starts its corner step three columns out rather than
     5.5, which is why 7 and 9-max sit a little wider than 6 and 8. */
  const layouts = {
    2:  [seat(CC,RT), seat(CC,RB)],
    3:  [seat(5.5,RT), seat(CC,RB), seat(10.5,RT)],
    4:  [seat(CC,RT), seat(CR,16), seat(CC,RB), seat(CL,16)],
    5:  [seat(5.5,RT), seat(CR,16), seat(CC,RB), seat(CL,16), seat(10.5,RT)],
    6:  [seat(CC,RT), seat(CR,11.5), seat(CR,20.5), seat(CC,RB), seat(CL,20.5), seat(CL,11.5)],
    7:  [seat(5.5,RT), seat(CR,12), seat(CR,20), seat(CC,RB), seat(CL,20), seat(CL,12), seat(10.5,RT)],
    8:  [seat(CC,RT), seat(CR,9), seat(CR,16), seat(CR,23), seat(CC,RB), seat(CL,23), seat(CL,16), seat(CL,9)],
    9:  [seat(5.5,RT), seat(CR,10), seat(CR,16), seat(CR,22), seat(CC,RB), seat(CL,22), seat(CL,16), seat(CL,10), seat(10.5,RT)],
    10: [seat(4,RT), seat(CC,RT), seat(CR,10), seat(CR,16), seat(CR,22), seat(CC,RB), seat(CL,22), seat(CL,16), seat(CL,10), seat(12,RT)],
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

       A seat within half a cell of the ring's left or right extreme is left
       alone. It is already as far out as the cloth goes, and at 9 and 10-max
       there is one on each side. */
    const CORNER_OUT = 1, CORNER_IN = 1;
    const cxRing = (RING.l + RING.r) / 2;
    return Array.from({ length: count }, (_, i) => {
      const [c, r, seg] = at(per * i / count);
      let x = c;
      let y = r <= RING.t + 0.5 ? r - TOP_LIFT : r;
      const atExtreme = Math.abs(c - RING.l) < 0.5 || Math.abs(c - RING.r) < 0.5;
      if (seg === 'arc' && !atExtreme) {
        x = c + (c < cxRing ? -CORNER_OUT : CORNER_OUT);
        y = y + (r < cy ? CORNER_IN : -CORNER_IN);
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
  const SIDE_X = 4 * CELL_X;            // 14.286%
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
  const rawSeats = isLandscape
    ? (n === 6 ? LANDSCAPE_6 : landscapeSeats(Math.min(Math.max(n, 2), 10))).map(snapSeat)
    : (layouts[Math.min(Math.max(n, 2), 10)] || layouts[6]);
  const bottomIdx = Math.floor(n / 2);
  const rotation = (bottomIdx - replayHeroIdx + n) % n;
  const seats = rawSeats.map((_, i) => rawSeats[(i + rotation) % n]);

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
    const sy = Math.abs(dy) > EPS ? (dy < 0 ? 1 : -1) : (dx < 0 ? -1 : 1);
    return (sy > 0 ? 'b' : 't') + (sx > 0 ? 'r' : 'l');
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
  const muckCount = folded.size;


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
    if (seats[act.player]) {
      markPotLanding();
      playTableSound('chips', rSettingsRef.current);
    }
  }, [streetIdx, actionIdx, showResult, rSettings.animateChips, currentActions, seats, hand, pot, potAwards, spawnFlyingChips, folded, markPotLanding]);


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

  return (
    /* 77: isLandscape was computed at mount and kept current by a live
       matchMedia listener, and then referenced nowhere — so forty lines of
       fullscreen CSS (fixed inset, modal layer, app chrome hidden through a
       :has() rule) could never fire, and turning the phone sideways just
       letterboxed the table. */
    <div className={'replayer-replay' + hcDeckClass
      + (isLandscape ? ' replayer-landscape' : ' replayer-fullbleed')
      + (rewinding ? ' is-rewinding' : '')}>
      {showSettings && <ReplayerSettingsPanel onClose={() => setShowSettings(false)} settings={rSettings} onUpdate={handleSettingsUpdate} />}

      {/* Table */}
      {/* data-cardback is what makes the six-option Card Back setting real;
          --back-custom feeds the custom colour through to the gradient stops. */}
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
        data-cardback={rSettings.cardBack || 'default'}
      data-anim-winner={rSettings.animateWinner ? '1' : '0'}
        style={rSettings.cardBack === 'custom' ? (() => {
          // Same derivation as the felt below, and for the same reason.
          const m = String(rSettings.cardBackColor || '').match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
          if (!m) return undefined;
          const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
          const mix = (f, w) => `rgb(${Math.round(r * f + 255 * w)},${Math.round(g * f + 255 * w)},${Math.round(b * f + 255 * w)})`;
          return {
            '--back-custom-1': mix(1, 0),
            '--back-custom-2': mix(0.8, 0),
            '--back-custom-3': mix(0.6, 0),
            '--back-custom-border': mix(0.7, 0.3),
          };
        })() : undefined}>
        {/* Only the default theme takes its rail from the felt picker; the
            themes now bring their own, so handing feltColor in would override
            them with whatever colour happened to be stored. */}
        <div className="replayer-table-rail"
          style={rSettings.theme === 'default' ? {'--rail-color': feltColor} : undefined} />
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
          const st = feltStops(feltColor);
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
          const splitters = showResult ? flaggedWinners.filter(w => w.split) : [];
          const isSplitResult = splitters.length >= 2;
          const _isHiLo = isSplitResult && isHiLo && splitters.some(w => w.hi || w.lo);
          /* The split display used to REPLACE the pot with a different object:
             its own dark lozenge carrying gold discs, no total, no side pots,
             a shape that appears nowhere else on the table — and it did that
             at the one step where the pot is the whole point. The pot row is
             the pot row at every step now; a split only relabels the total
             cell and hangs the shares under it. */
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
              {rSettings.showChipStacks && displayPot > 0 && !isSplitResult && <PotChipVisual amount={potLayers.length ? potLayers[0].amount : displayPot} />}
              {potLayers.length > 1 && (
                <div className="replayer-pot-pill">
                  <span className="replayer-pot-cell-label">Main</span>
                  {fmtChips(potLayers[0].amount)}
                </div>
              )}
              <div className="replayer-pot-total">
                <span className="replayer-pot-cell-label">
                  {isSplitResult ? (_isHiLo ? 'Hi/Lo Split' : 'Split Pot') : (potLayers.length > 1 ? 'Total' : 'Pot')}
                </span>
                {fmtChips(countedPot)}
              </div>
              {potLayers.slice(1, 4).map((layer, i) => (
                <div key={i} className="replayer-pot-pill" title={layer.eligible + '-way'}>
                  <span className="replayer-pot-cell-label">
                    {potLayers.length > 2 ? 'Side ' + (i + 1) : 'Side'}
                  </span>
                  {fmtChips(layer.amount)}
                </div>
              ))}
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
            const groups = [];
            splitters.forEach(w => {
              /* #94 recorded which half each winner took as flags, so the
                 tag is read rather than parsed back out of the label text. */
              let tag = '';
              if (w.hi) tag = 'Hi';
              if (w.lo) tag = tag ? 'Hi+Lo' : 'Lo';
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
              const share = pot > 0 ? amt / pot : 1 / splitters.length;
              const name = w.playerIdx === replayHeroIdx ? 'Hero' : (hand.players[w.playerIdx]?.name || 'Player');
              const key = tag + '|' + amt;
              const found = groups.find(g => g.key === key);
              if (found) { found.n += 1; found.names.push(name); }
              else groups.push({ key, tag, amt, share, n: 1, names: [name] });
            });
            return (
              <div className="replayer-pot-display replayer-split-pot">
                {potRow}
                <div className="replayer-split-shares">
                  {groups.map((g, i) => {
                    /* "2x HI 1/4" — how many players, which half of a hi/lo,
                       and what fraction of the pot each one took. A quarter
                       and a three-quarter award look nothing alike here,
                       where four discs reading the same number looked
                       identical whatever anyone was actually paid. */
                    const cap = [g.n > 1 ? g.n + '×' : '', g.tag, formatShareFraction(g.share)]
                      .filter(Boolean).join(' ');
                    return (
                      <div key={i} className="replayer-split-share" title={g.names.join(', ')}>
                        {cap && <span className="replayer-split-share-frac">{cap}</span>}
                        {fmtChips(g.amt)}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }
          return (
            <div className={'replayer-pot-display' + (animPotCollect ? ' anim-collect' : '')
              + (potLanding ? ' is-landing' : '') + (potLayers.length ? ' has-sides' : '')}>
              {potRow}
            </div>
          );
        })()}

        {/* Board */}
        {category === 'community' && (() => {
          const parsed = parseCardNotation(boardCards);
          if (parsed.length === 0) return null;
          return (
            <div className={'replayer-board-area' + boardAnimClass}>
              {/* 24: .replayer-street-label, its pop keyframe and three theme
                  overrides all existed, an effect set and cleared animStreetLabel
                  on a 450ms timer — and no JSX ever emitted the element, so the
                  animation ran against a DOM node that was never there and the
                  only street context during replay was the prose below the
                  table. It renders under the board rather than at the CSS's
                  top:28%, where it would have sat on the pot eyebrow. */}
              <div className="card-row replayer-board-spaced">
                {parsed.map((c, i) => {
                  const key = c.rank + c.suit + '_' + i;
                  // Flop | turn | river. Grouping is how every broadcast graphic
                  // and every real table shows which street the hand is on; the
                  // gap class existed for it and had never been rendered.
                  let card;
                  if (c.suit === 'x') {
                    card = <div key={key} data-slot={i} className="card-unknown" />;
                  } else if (cardTheme === 'classic') {
                    card = (
                      <div key={key} data-slot={i} className={'card-classic card-classic-' + c.suit}>
                        <span className="card-classic-rank">{c.rank.toUpperCase()}</span>
                        <span className="card-classic-suit">{{h:'\u2665',d:'\u2666',c:'\u2663',s:'\u2660'}[c.suit] || ''}</span>
                      </div>
                    );
                  } else {
                    card = <img key={key} data-slot={i} className="card-img" src={'/cards/cards_gui_' + c.rank + c.suit + '.svg'} alt={c.rank+c.suit} loading="eager" />;
                  }
                  return card;
                })}
              </div>
            </div>
          );
        })()}

        {/* 25: calcSPR, a persisted ShowSPR setting and a positioned badge
            style were all written; nothing rendered the badge and the panel
            never offered the toggle, so the one number that says whether a
            pot is commit-or-fold was computed and discarded. The CSS put it
            at top:29%, on the pot eyebrow — it sits under the plaque now. */}
        {rSettings.showSPR && (() => {
          const spr = calcSPR(hand, streetIdx);
          return spr ? <div className="replayer-spr-badge">SPR {spr}</div> : null;
        })()}

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
          const sizes = b.bb
            ? (limitGame ? formatChipAmount(b.bb) + '/' + formatChipAmount(bigB)
                         : formatChipAmount(b.sb) + '/' + formatChipAmount(b.bb))
              + (b.ante ? '/(' + formatChipAmount(b.ante) + ')' : '')
            : null;
          const level = [hand.gameType, sizes].filter(Boolean).join('  ·  ');
          const meta = [
            hand.playersLeft ? hand.playersLeft + ' left' : null,
            hand.payoutNote || null,
          ].filter(Boolean).join(' \u00b7 ');
          if (!hand.title && !level && !meta) return null;
          return (
            <div className="replayer-table-info">
              {hand.title && <span className="replayer-table-title-name">{hand.title}</span>}
              {level && <span className="replayer-level-blinds">{level}</span>}
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
          <span className="replayer-bookend-eyebrow">{hand.gameType}{(hand.blinds || {}).bb ? ' \u00b7 ' + formatChipAmount(hand.blinds.sb) + '/' + formatChipAmount(hand.blinds.bb) : ''}</span>
          <span className="replayer-bookend-title">{hand.title || 'Hand replay'}</span>
          {heroCards && <span className="replayer-bookend-cards"><CardRow text={heroCards} max={gameCfg.heroCards} cardTheme={cardTheme} /></span>}
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
          const cards = (pi === replayHeroIdx || showResult) ? (rawCards === 'MUCK' ? '' : rawCards) : '';
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
            <div key={pi} className={`replayer-seat ${seatClass}${isMucked ? ' mucked' : ''}${foldAnimClass}`
              + (pi === replayHeroIdx ? ' is-hero' : '') + (allIn.has(pi) ? ' is-allin' : '')}
              style={{left: pos[0] + '%', top: pos[1] + '%', ...muckStyle, ...castStyle(pos)}}>
              {/* 12: opponent cards were hidden until showResult and then
                  appeared in a single frame — the only card event in the
                  replayer with no motion, at the moment the whole replay has
                  been building toward. The stylesheet's own comment says the
                  flip was disabled because it fought the splay transforms, and
                  the 600ms animShowdown effect kept ticking for an animation
                  nothing read. The ROW wrapper carries no splay transform, so
                  fading and lifting it costs the fan nothing. */}
              <div className={`replayer-seat-cards ${isHiLo && showResult && !folded.has(pi) ? ('replayer-hilo-' + (hiloSide[pi] || 'high')) + (hiloAnimate ? ' animate' : '') : ''}${animDealing ? ' animate-deal' : ''}${animShowdown && pi !== replayHeroIdx && !folded.has(pi) ? ' animate-showdown' : ''}`}
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
                  if (animShowdown) st['--showdown-delay'] = (dealOrder.indexOf(pi) * 70) + 'ms';
                  return st;
                })()}>
                <CardRow text={cards} stud={gameCfg.isStud} max={gameCfg.heroCards}
                  placeholderCount={!cards && !folded.has(pi) ? gameCfg.heroCards : 0}
                  splay={rSettings.cardSplay ? (gameCfg.heroCards <= 2 ? 12.5 : gameCfg.heroCards <= 4 ? 15 : gameCfg.heroCards <= 5 ? 18 : 22) : 0}
                  cardTheme={cardTheme}
                  reverseZ={pi !== replayHeroIdx}
                  /* The hero used to fan wider than everybody else — a bigger
                     arc and a wider allowance, on the grounds that the bottom
                     seat has no neighbour to crowd. It just made one hand at
                     the table a different shape. */
                  wideFan={false} />
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
                <div className="replayer-seat-name" title={p.name}>{shortenName(p.name, nameBudget)}</div>
                {/* 67: the stack dropped the instant the bet was recorded,
                    while the chips were still in flight toward a pot that had
                    already been paid. It counts down over the same duration
                    the pot counts up. */}
                <div className="replayer-seat-stack">
                  {allIn.has(pi) && stacks[pi] <= 0
                    ? <span className="replayer-allin-mark">ALL-IN</span>
                    : <CountedChips value={stacks[pi]} fmt={fmtChips} live={rSettings.animateChips && !rewinding} />}
                </div>
                {/* 43: estimateRange returns a label AND a CSS class per
                    opponent, four styled tiers exist and the setting was
                    merged into the settings object — and no seat ever wore
                    one. Hero is excluded: you can see your own cards. */}
                {rSettings.showRanges && pi !== replayHeroIdx && !folded.has(pi) && !showResult && (() => {
                  const r = estimateRange(hand, pi, streetIdx, actionIdx);
                  return r ? <div className={'replayer-range-label ' + r.cls}>{r.label}</div> : null;
                })()}
                {/* 39: the delta styles were written, colour-coded and even
                    added to the tabular-figures group, and nothing ever drew
                    them — so "who finished up" could only be answered by
                    remembering the starting stack. */}
                {showResult && (() => {
                  const start = p.startingStack ?? p.stack ?? null;
                  if (start == null) return null;
                  const d = stacks[pi] - start;
                  if (!d) return null;
                  const cls = d > 0 ? 'positive' : 'negative';
                  return (
                    <div className={'replayer-chip-delta ' + cls}>
                      {d > 0 ? '+' : '\u2212'}{formatChipAmount(Math.abs(d))}
                    </div>
                  );
                })()}
                {/* Inside the plaque, not beside it. As a sibling its
                    `left: 50%` resolved against .replayer-seat — the seat's
                    whole footprint, cards and all — so the badge sat 28px
                    right of the name it belongs to. The plaque is already
                    position:relative, so in here 50% is the middle of the
                    name and `bottom: 100%` is the fan above it. */}
                {lastAct && !handName && (() => {
                  const actText = lastAct.action;
                  if (!actText) return null;
                  let label = actText;
                  if (lastAct.amount) {
                    /* Was the player's street TOTAL for a raise and the amount
                       for everything else, so a raise to 400 that put 160 more
                       in read "raise 400" beside 160 in chips. Every action now
                       names the chips that action moves. */
                    label += ' ' + formatChipAmount(lastAct.amount);
                  }
                  // 58: re-keying is what makes the entrance replay when the
                  // same player acts twice in one street.
                  return <div key={streetIdx + '-' + actionIdx} className={'replayer-action-badge-outer action-' + actText}>{label}</div>;
                })()}
                {/* On a corner of the name box rather than at a percentage
                    offset from the seat point — the plaque is sized by its
                    text, so nothing outside it can know where its corner is.
                    Three earlier attempts all landed on somebody's name. */}
                {pi === btnIdx && (
                  <div className={'replayer-dealer-btn corner-' + btnCorner}><span>D</span></div>
                )}
                {/* On the plaque's top-right corner, straddling it, which is
                    where the reference puts the draw count. It was a pill
                    centred below the plaque, and hanging off the bottom edge
                    on its own it read as a stray tab rather than as part of
                    the seat — which is exactly how it got reported.

                    The count alone at that size: "Drew 2" does not fit a
                    corner, and among seats showing 1, 2 and P the digit is
                    unambiguous. The full wording stays on the title. */}
                {isDrawGame && (() => {
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
                  return <div className="replayer-seat-draw-badge"
                    title={history.map(h => h === 'PAT' ? 'stood pat' : 'drew ' + h.slice(1)).join(', then ')}>
                    {history.join('/')}</div>;
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
              {/* 26: filled by leader, below the plaque so it does not fight
                  the hand name. */}
              {showdownEquity && showdownEquity[pi] != null && !folded.has(pi) && (() => {
                const pct = showdownEquity[pi];
                const best = Math.max(...Object.values(showdownEquity));
                const col = pct >= best ? 'var(--ok)' : 'rgba(255,255,255,0.45)';
                return (
                  <div className="replayer-equity-bar-wrap">
                    <div className="replayer-equity-bar"><div className="replayer-equity-fill" style={{width: pct + '%', background: col}} /></div>
                    <div className="replayer-equity-pct" style={{color: col}}>{pct}%</div>
                  </div>
                );
              })()}
              {/* 29: both of these are absolutely positioned directly under the
                  plaque — the badge at calc(100% + 2px), the name at 100% plus
                  a margin — and at showdown BOTH render, because lastAct
                  persists from the river while handName arrives with the
                  result. So "CALL 12k" landed on top of "Two Pair, A & K".
                  The name is the newer and more important fact; the badge
                  stands down for it. */}
              {handName && <div className="replayer-seat-hand-name">{handName}</div>}
            </div>
          );
        })}

        {/* Bet chips */}
        {hand.players.map((p, pi) => {
          const lastAct = playerLastAction[pi];
          if (!lastAct || !lastAct.amount) return null;
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
          const chipX = pos[0] + (POT_AT[0] - pos[0]) * t;
          const chipY = pos[1] + (POT_AT[1] - pos[1]) * t;
          const chipStyle = {left: chipX + '%', top: chipY + '%'};
          if (rSettings.animateChips) {
            chipStyle['--chip-start-dx'] = ((pos[0] - chipX) * 3) + 'px';
            chipStyle['--chip-start-dy'] = ((pos[1] - chipY) * 3) + 'px';
          }
          return (
            <div key={'bet-' + pi} className={'replayer-bet-chip' + (rSettings.animateChips ? ' animate-chips' : '')} style={chipStyle}>
              <ChipStack amount={lastAct.amount} />
              {fmtChips(lastAct.amount)}
              {/* 42: a ten-step classifier from min through overbet was written
                  and never called, so '13k' arrived with no pot-relative
                  context — and pot-relative size is what makes a bet readable
                  as a bluff or a value bet at a glance. */}
              {rSettings.showBetSizing && (lastAct.action === 'bet' || lastAct.action === 'raise') && (() => {
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
      </div>

      {/* Everything below the table shares one region of fixed height and
          scrolls inside it, so no strip can take height from the table. */}
      <div className="replayer-under">

      {/* 40: on screen a solo winner got a gold border and a shimmer, and
          nothing anywhere said "Hero wins 24.5k, Two Pair". The string was
          composed — and painted only into the share image, so the export knew
          the result and the app did not. Three .replayer-result classes and a
          winner-star keyframe were sitting unused for exactly this. */}
      {(showResult && evalResult && evalResult.length > 0) ? (
        <div className="replayer-result-banner">
          {evalResult.map((r, i) => (
            <div key={i} className={'replayer-result replayer-result-' + (r.result?.outcome === 'hero' ? 'hero' : r.result?.outcome === 'split' ? 'split' : 'opponent')}>
              <span className="replayer-winner-star" aria-hidden="true">{'\u2605'}</span>
              {r.result?.text || ''}
            </div>
          ))}
        </div>
      ) : (
        /* The same banner, hidden. The table above is sized from what the
           column has left, so a strip that appears at showdown would resize it
           at showdown — it keeps its box for the whole hand instead. Reserved
           with the real markup rather than a pixel constant, so the space and
           the thing it is holding cannot drift apart. */
        <div className="replayer-result-banner is-reserved" aria-hidden="true">
          <div className="replayer-result replayer-result-hero">
            <span className="replayer-winner-star">{'\u2605'}</span>{'\u00a0'}
          </div>
        </div>
      )}

      {/* Draw info bar — rendered for every step of a draw game, empty on the
          steps with no draws to report, so it does not resize the table when a
          draw round starts. Fixed height (see styles.css) because its items
          grow when they carry the discarded and the new cards. */}
      {(category === 'draw_triple' || category === 'draw_single') && (
        <div className={'replayer-draw-info-bar' + (currentStreet.draws?.length > 0 ? '' : ' is-reserved')}
             aria-hidden={currentStreet.draws?.length > 0 ? undefined : true}>
          <div className="replayer-draw-info-label">{currentStreet.name || 'Draw'}</div>
          <div className="replayer-draw-info-players">
            {(currentStreet.draws || []).map(d => {
              const pName = hand.players[d.player]?.name || '?';
              const isPat = d.discarded === 0;
              return (
                <div key={d.player} className={'replayer-draw-info-item' + (isPat ? ' pat' : '')}>
                  <span className="replayer-draw-info-name">{pName}</span>
                  {isPat ? <span className="replayer-draw-pat-badge">Stand Pat</span> : <span className="replayer-draw-count-badge">{d.discarded === 1 ? 'draws 1' : 'draws ' + d.discarded}</span>}
                  {d.discardedCards && !isPat && <span className="replayer-draw-discarded-cards"><CardRow text={d.discardedCards} max={d.discarded} /></span>}
                  {d.newCards && !isPat && <span className="replayer-draw-new-cards"><CardRow text={d.newCards} max={d.discarded} /></span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 46: the dot strip, its hover and current states, six action classes,
          the street markers and the street label are all finished CSS, the
          setting DEFAULTS TO TRUE, and the settings panel advertises
          "clickable dots showing all actions" — for markup no component ever
          emitted. The toggle toggled nothing. */}
      {/* 78: the dots were floating on the page with a grey bar between
          streets. Each street is a shaded span on a recessed track now, so the
          groups read as groups and there is something to scrub along. A hand of
          more than about twenty actions collapses to a denser strip rather than
          scrolling further and further. */}
      {rSettings.showTimeline && (
        <div className={'replayer-timeline' + (totalActionCount > 20 ? ' is-dense' : '')} ref={timelineRef}>
          {hand.streets.map((st, si) => (
            <div className="replayer-timeline-street" key={'tl-' + si}>
              <div className="replayer-timeline-street-label">{st.name || ('St' + si)}</div>
              {(st.actions || []).map((act, ai) => {
                const isCurrent = si === streetIdx && ai === actionIdx;
                const who = hand.players[act.player]?.name || 'Player';
                const amt = act.amount ? ' ' + fmtChips(act.amount) : '';
                return (
                  <button key={'tl-' + si + '-' + ai}
                    className={'replayer-timeline-dot action-' + (act.action === 'all-in' ? 'allin' : act.action) + (isCurrent ? ' current' : '')}
                    onClick={() => { setPlaying(false); setShowResult(false); setStreetIdx(si); setActionIdx(ai); }}
                    title={who + ' ' + act.action + amt}
                    aria-label={who + ' ' + act.action + amt}
                    aria-current={isCurrent ? 'step' : undefined} />
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Commentary */}
      {rSettings.showCommentary && (
        <div className="replayer-commentary">
          <div className="replayer-commentary-body">
            <span className="replayer-commentary-street">{currentStreet.name || 'Preflop'}</span>
            {/* One line, ellipsised. A lower third on a broadcast is one line;
                a wrapping one would also change the table's size whenever a
                call ran long. */}
            <span className="replayer-commentary-line">
              {generateCommentary(hand, streetIdx, actionIdx, pot, stacks)}
            </span>
          </div>
        </div>
      )}

      {/* Hand strength */}
      {rSettings.showHandStrength && category === 'community' && (() => {
        const strength = calcHandStrength(heroCards, boardCards, hand.gameType);
        /* Preflop there is nothing to measure, but the strip still holds its
           place — otherwise the table shrinks the moment the flop lands. */
        if (strength === null) return (
          <div className="replayer-hand-strength is-reserved" aria-hidden="true">
            <div className="replayer-hand-strength-label">Strength</div>
            <div className="replayer-hand-strength-bar"><div className="replayer-hand-strength-fill" style={{width: 0}} /></div>
            <div className="replayer-hand-strength-pct">0%</div>
          </div>
        );
        const col = getStrengthColor(strength);
        return (
          <div className="replayer-hand-strength">
            <div className="replayer-hand-strength-label">Strength</div>
            <div className="replayer-hand-strength-bar"><div className="replayer-hand-strength-fill" style={{width: strength + '%', background: col}} /></div>
            <div className="replayer-hand-strength-pct" style={{color: col}}>{strength}%</div>
          </div>
        );
      })()}

      {/* Pot odds */}
      {rSettings.showPotOdds && (() => {
        /* This one toggled on nearly every action — there are no pot odds to
           quote against a check or a fold — so of all the strips it is the one
           that would have made the table twitch continuously. */
        const reserved = (
          <div className="replayer-pot-odds is-reserved" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="12"/></svg>
            Pot Odds
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
            Pot Odds: {ratio}:1 ({odds}% equity needed)
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
        <div className="replayer-controls">
          <button onClick={goToStart} disabled={!canGoBack} title="Start">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="19 20 9 12 19 4"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
          </button>
          <button onClick={stepBack} disabled={!canGoBack} title="Back">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          {/* 53: the play triangle was STROKED, while every media player on
              the platform draws a solid one — and during playback the only
              change was the icon swap, so a running replayer and a paused one
              wore identical transparent buttons. */}
          <button className={'replayer-play-btn' + (playing ? ' is-playing' : '')}
            onClick={handlePlayPause}
            title={playing ? 'Pause' : (canGoForward ? 'Play' : 'Replay')}>
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            ) : canGoForward ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg>
            ) : (
              /* 50: at the result the button restarts, so it says restart. */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            )}
          </button>
          <button onClick={stepForward} disabled={!canGoForward} title="Forward">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
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
                <span className="replayer-speed-label">{label}</span>
              </button>
            );
          })()}
        </div>
        {/* 79: Back, Edit, Solve, Link, image share, WebM, GIF and the gear
            sat in ONE inline flex row with no wrap plan, so at 320px eight
            controls either overflowed or crushed each other — and four of the
            eight were exports, which is a task, not a navigation control. The
            row is navigation now; the exports live behind one Share button in
            the sheet the app already ships for exactly this. */}
        <div className="replayer-actions-bar">
          <button className="btn btn-ghost btn-sm" onClick={onBack}>Back</button>
          <button className="btn btn-ghost btn-sm" onClick={onEdit}>Edit</button>
          {onSolveSpot && (
            <button className={'btn btn-sm ' + (canSolveSpot ? 'btn-primary' : 'btn-ghost')}
              onClick={handleSolveSpot} disabled={!canSolveSpot}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Solve this spot
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowExportMenu(true)}
            disabled={videoExporting || gifExporting}>
            Share
          </button>
          <button className="replayer-gear-btn" onClick={() => setShowSettings(true)} title="Replayer Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
        {/* 80: the ONLY explanation of why Solve is dead was a title
            attribute — invisible to every touch user, which is most of them
            on this app. */}
        {onSolveSpot && !canSolveSpot && (
          <div className="replayer-bar-note">Solving is available for stud8 and razz spots.</div>
        )}
        {/* 79: the exports, in the sheet grammar the app already uses. */}
        {showExportMenu && createPortal(
          <>
            <div className="share-menu-backdrop" onClick={() => setShowExportMenu(false)} />
            <div className="share-menu-panel">
              <h3>Share this hand</h3>
              <div className="share-menu-grid">
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
                <div className={'share-menu-item' + (videoExporting || gifExporting ? ' disabled' : '')}
                  onClick={() => { if (!videoExporting && !gifExporting) { handleExportVideo('transparent'); setShowExportMenu(false); } }}>
                  <span className="export-preview is-overlay" aria-hidden="true" />
                  <span className="share-label">Overlay</span>
                  <span className="share-desc">Transparent WebM for streaming</span>
                </div>
                {/* 81: the greenscreen branch and its MP4 codec ladder were
                    written for CapCut and had no way in. */}
                <div className={'share-menu-item' + (videoExporting || gifExporting ? ' disabled' : '')}
                  onClick={() => { if (!videoExporting && !gifExporting) { handleExportVideo('greenscreen'); setShowExportMenu(false); } }}>
                  <span className="export-preview is-green" aria-hidden="true" />
                  <span className="share-label">Greenscreen</span>
                  <span className="share-desc">MP4 to key out in an editor</span>
                </div>
                {/* 98 */}
                <div className={'share-menu-item' + (videoExporting || gifExporting ? ' disabled' : '')}
                  onClick={() => { if (!videoExporting && !gifExporting) { handleExportVideo('story'); setShowExportMenu(false); } }}>
                  <span className="export-preview is-story" aria-hidden="true" />
                  <span className="share-label">Story</span>
                  <span className="share-desc">9:16 video, ready to post</span>
                </div>
                <div className={'share-menu-item' + (videoExporting || gifExporting ? ' disabled' : '')}
                  onClick={() => { if (!videoExporting && !gifExporting) { handleExportGif(); setShowExportMenu(false); } }}>
                  <span className="export-preview is-gif" aria-hidden="true" />
                  <span className="share-label">GIF</span>
                  <span className="share-desc">Instagram sticker</span>
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

      {/* Video export progress overlay */}
      {videoExporting && createPortal(
        <div className="replayer-export-overlay">
          <div style={{color:'#fff',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'1.1rem',marginBottom:'4px',letterSpacing:'0.08em',textTransform:'uppercase'}}>
            Recording Overlay…
          </div>
          <div style={{color:'rgba(255,255,255,0.45)',fontSize:'0.65rem',fontFamily:"'Univers Condensed','Univers',sans-serif",marginBottom:'14px',letterSpacing:'0.05em'}}>
            WebM VP9 · transparent background
          </div>
          {/* 85: the frames, as they are captured. */}
          <div className="replayer-export-frame">
            {exportPreview && <img src={exportPreview} alt="" />}
          </div>
          <div className="replayer-export-bar">
            <div style={{width:videoProgress+'%'}} />
          </div>
          <div style={{color:'rgba(255,255,255,0.5)',fontSize:'0.72rem',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
            Step {videoStep} of {videoTotal}
          </div>
          {/* 94: this said "will download automatically" on a platform where
              the outcome is usually a share sheet. */}
          <div style={{color:'rgba(255,255,255,0.3)',fontSize:'0.65rem',fontFamily:"'Univers Condensed','Univers',sans-serif",marginTop:'6px',maxWidth:'200px',textAlign:'center'}}>
            {canNativeShare ? 'The share sheet will open when it is ready' : 'It will download when complete'}
          </div>
        </div>,
        document.body
      )}

      {/* GIF export progress overlay */}
      {gifExporting && createPortal(
        <div className="replayer-export-overlay">
          <div style={{color:'#fff',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'1.1rem',marginBottom:'4px',letterSpacing:'0.08em',textTransform:'uppercase'}}>
            Building GIF…
          </div>
          <div style={{color:'rgba(255,255,255,0.45)',fontSize:'0.65rem',fontFamily:"'Univers Condensed','Univers',sans-serif",marginBottom:'14px',letterSpacing:'0.05em'}}>
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
          <div style={{color:'rgba(255,255,255,0.5)',fontSize:'0.72rem',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
            Step {gifStep} of {gifTotal}
          </div>
          <div style={{color:'rgba(255,255,255,0.3)',fontSize:'0.65rem',fontFamily:"'Univers Condensed','Univers',sans-serif",marginTop:'6px',maxWidth:'200px',textAlign:'center'}}>
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
