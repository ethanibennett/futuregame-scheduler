// ── Hand Text Parser ────────────────────────────────────────
// Converts natural shorthand notation into a hand object.
// Distinct from hand-shorthand.js (URL encode/decode).
//
// Supported format (community card games):
//   25/50
//   UTG: AhKd  HJ: 9c8c  BTN: 7h7c  SB: fold  BB: call  UTG: raise 150
//   / Qh Jc 2d  UTG: check  HJ: bet 50  UTG: raise 200  HJ: call
//   / 7s  UTG: bet 400  HJ: fold

import { parseCardNotation } from './poker-engine.js';
import { HAND_CONFIG, HAND_CONFIG_DEFAULT } from './utils.js';

// ── Position normalisation ───────────────────────────────────
const POS_NORM = {
  'utg': 'UTG', 'utg1': 'UTG+1', 'utg+1': 'UTG+1',
  'mp': 'MP', 'mp1': 'MP1', 'mp2': 'MP2',
  'lj': 'LJ', 'hj': 'HJ', 'co': 'CO',
  'btn': 'BTN', 'bu': 'BTN', 'button': 'BTN',
  'sb': 'SB', 'bb': 'BB',
  'hero': 'Hero', 'villain': 'Villain', 'v': 'Villain',
};

function normPos(p) {
  const l = p.toLowerCase();
  if (POS_NORM[l]) return POS_NORM[l];
  // seat1..seat9, p1..p9
  const sm = l.match(/^(?:seat|p)(\d)$/);
  if (sm) return 'Seat ' + sm[1];
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

// ── Action normalisation ─────────────────────────────────────
const ACT_NORM = {
  'f': 'fold', 'fold': 'fold', 'folds': 'fold',
  'x': 'check', 'check': 'check', 'checks': 'check',
  'c': 'call', 'call': 'call', 'calls': 'call',
  'b': 'bet', 'bet': 'bet', 'bets': 'bet',
  'r': 'raise', 'raise': 'raise', 'raises': 'raise', '3bet': 'raise', '4bet': 'raise',
  'a': 'all-in', 'allin': 'all-in', 'all-in': 'all-in',
  'shove': 'all-in', 'shoves': 'all-in', 'jams': 'all-in', 'jam': 'all-in',
  'bi': 'bring-in', 'bring-in': 'bring-in', 'bringin': 'bring-in',
};

// ── Helpers ──────────────────────────────────────────────────

// Detect a card string: one or more rank+suit pairs, e.g. AhKd or Ah Kd
// Returns true if the token looks like cards (rank char immediately followed by suit char)
function looksLikeCards(tok) {
  // At least one rank+suit pair
  return /^[AaKkQqJjTt2-9][hHdDcCsS]/.test(tok);
}

// Try to parse card string into shorthand notation like "AhKd"
function parseCards(tok) {
  const cards = parseCardNotation(tok);
  if (!cards.length) return null;
  return cards.map(c => c.rank + c.suit).join('');
}

// Check if token matches N/N or N/N/N (blinds line)
function parseBlindsLine(line) {
  const m = line.trim().match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)(\/(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  return {
    sb: parseFloat(m[1]),
    bb: parseFloat(m[2]),
    ante: m[4] ? parseFloat(m[4]) : 0,
  };
}

// Token-level parser for a preflop or postflop street segment.
// Returns { playerTokens: [{pos, cards, action, amount}], boardCards: string }
//
// A "segment" is a series of space-separated tokens after the street separator.
// The grammar is looser: we scan for "POSITION:" anchors and fill in between.
function parseStreetSegment(segment, isPreflop) {
  const errors = [];

  // Split on whitespace, keeping colon attached to position
  const rawTokens = segment.trim().split(/\s+/).filter(Boolean);

  // Collect board cards (first non-POSITION tokens on non-preflop streets)
  let boardCards = '';
  let boardDone = !isPreflop; // preflop has no board cards

  // Build a flat list of [{type:'pos'|'cards'|'action'|'amount', value}]
  const classified = [];
  let i = 0;
  while (i < rawTokens.length) {
    const tok = rawTokens[i];

    // "POSITION:" or "POSITION(stack):" pattern
    const posMatch = tok.match(/^([A-Za-z][A-Za-z0-9+]*(?:\+\d)?)(?:\(\d+\))?:$/);
    if (posMatch) {
      classified.push({ type: 'pos', value: normPos(posMatch[1]) });
      i++;
      continue;
    }

    // Numeric amount (standalone)
    if (/^\d+(?:\.\d+)?$/.test(tok)) {
      classified.push({ type: 'amount', value: parseFloat(tok) });
      i++;
      continue;
    }

    // Action keyword
    const actKey = tok.toLowerCase().replace(/[^a-z0-9\-]/g, '');
    if (ACT_NORM[actKey]) {
      classified.push({ type: 'action', value: ACT_NORM[actKey] });
      i++;
      continue;
    }

    // Cards (rank+suit pairs)
    if (looksLikeCards(tok)) {
      const c = parseCards(tok);
      if (c) {
        classified.push({ type: 'cards', value: c });
        i++;
        continue;
      }
    }

    // Unknown — skip with error
    errors.push(`Unrecognised token "${tok}"`);
    i++;
  }

  // Now walk classified tokens and assign to players
  // State machine: after a 'pos' token, subsequent cards/actions belong to that player
  // until the next 'pos' token.
  const playerTokens = []; // [{pos, cards, action, amount}]
  let currentPos = null;

  // On non-preflop streets, leading card tokens (before first 'pos') are board cards
  let leadingCardsDone = isPreflop;
  const boardCardTokens = [];

  for (let ci = 0; ci < classified.length; ci++) {
    const item = classified[ci];

    if (!leadingCardsDone && item.type !== 'pos') {
      if (item.type === 'cards') {
        boardCardTokens.push(item.value);
      }
      // Skip non-card, non-pos tokens before first position (amounts, stray actions)
      continue;
    }

    if (item.type === 'pos') {
      leadingCardsDone = true;
      // Flush any accumulated data for current position
      if (currentPos !== null) {
        // Already pushed when we saw action — nothing to do
      }
      currentPos = item.value;
      playerTokens.push({ pos: currentPos, cards: '', action: '', amount: 0 });
      continue;
    }

    if (currentPos === null) continue; // No position context yet

    const entry = playerTokens[playerTokens.length - 1];

    if (item.type === 'cards') {
      entry.cards = item.value;
    } else if (item.type === 'action') {
      entry.action = item.value;
    } else if (item.type === 'amount') {
      entry.amount = item.value;
    }
  }

  boardCards = boardCardTokens.join('');

  return { playerTokens, boardCards, errors };
}

// ── Street definitions (mirrors hand-shorthand.js logic) ────
function getStreetNames(gameType) {
  const cfg = HAND_CONFIG[gameType] || HAND_CONFIG_DEFAULT;
  if (!cfg) return ['Preflop', 'Flop', 'Turn', 'River'];
  if (gameType === 'OFC') return ['Initial (5)', 'Card 6', 'Card 7', 'Card 8', 'Card 9', 'Card 10', 'Card 11', 'Card 12', 'Card 13'];
  if (cfg.isStud) return ['3rd Street', '4th Street', '5th Street', '6th Street', '7th Street'];
  if (cfg.hasBoard) return ['Preflop', 'Flop', 'Turn', 'River'];
  // Draw games
  const drawTriple = ['2-7 TD', 'PL 2-7 TD', 'L 2-7 TD', 'A-5 TD', 'Badeucy', 'Badacy', 'Badugi'];
  const drawSingle = ['NL 2-7 SD', 'PL 5CD Hi', 'NL 5CD Hi', 'NL A-5 SD'];
  if (drawTriple.includes(gameType)) return ['Pre-Draw', 'First Draw', 'Second Draw', 'Third Draw'];
  if (drawSingle.includes(gameType)) return ['Pre-Draw', 'Draw'];
  return ['Preflop', 'Flop', 'Turn', 'River'];
}

// ── Main export ──────────────────────────────────────────────

/**
 * parseHandText(text, gameType)
 * Returns { hand, errors }
 * hand may be partial if parsing is incomplete.
 */
export function parseHandText(text, gameType = 'NLH') {
  if (!text || !text.trim()) return { hand: null, errors: ['Empty input'] };

  const errors = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ── Step 1: Split text into street segments ──────────────
  // Streets are delimited by lines starting with "/" or " / " inline.
  // We join all lines first, then split.
  const joined = lines.join('\n');

  // Split on "/" at start of a line OR " / " anywhere
  // We'll use a two-pass approach:
  // 1. Replace line-starting "/" with a special delimiter
  // 2. Then split on " / " inline

  // Normalise: replace line-leading "/" with our sentinel
  const STREET_SEP = ' STREET ';
  const normalised = joined
    .replace(/^\/\s*/gm, STREET_SEP) // "/" at line start
    .replace(/\s+\/\s+/g, ' ' + STREET_SEP); // " / " inline

  const rawSegments = normalised.split(STREET_SEP).filter(s => s.trim());

  if (!rawSegments.length) return { hand: null, errors: ['Could not parse any streets'] };

  // ── Step 2: Parse blinds from first segment's first token ──
  let blinds = { sb: 0, bb: 0, ante: 0 };
  let firstSegment = rawSegments[0].trim();

  // Check if first line is a blinds line (before any positions)
  const firstLine = lines[0];
  const blindsParsed = parseBlindsLine(firstLine);
  if (blindsParsed) {
    blinds = blindsParsed;
    // Remove the blinds line from the first segment
    firstSegment = firstSegment.replace(firstLine, '').trim();
    if (!firstSegment && rawSegments.length > 1) {
      // Blinds were on their own line; segment[0] is now empty, shift
      rawSegments.shift();
      firstSegment = rawSegments[0] ? rawSegments[0].trim() : '';
    } else {
      rawSegments[0] = firstSegment;
    }
  }

  // ── Step 3: Parse each street ────────────────────────────
  const streetNames = getStreetNames(gameType);
  const parsedStreets = [];

  for (let si = 0; si < rawSegments.length; si++) {
    const seg = rawSegments[si].trim();
    if (!seg) continue;
    const isPreflop = si === 0 && !blindsParsed
      ? true
      : si === 0 || (blindsParsed && si === 0);

    // The first segment is always preflop (or pre-draw/3rd street)
    const { playerTokens, boardCards, errors: segErrors } = parseStreetSegment(seg, si === 0);
    errors.push(...segErrors.map(e => `Street ${si + 1}: ${e}`));
    parsedStreets.push({ playerTokens, boardCards });
  }

  if (!parsedStreets.length) return { hand: null, errors: [...errors, 'No streets parsed'] };

  // ── Step 4: Build players array ──────────────────────────
  // Collect all positions in order of first appearance (preflop first, then later streets)
  const positionOrder = [];
  const seenPos = new Set();

  for (const st of parsedStreets) {
    for (const pt of st.playerTokens) {
      if (!seenPos.has(pt.pos)) {
        seenPos.add(pt.pos);
        positionOrder.push(pt.pos);
      }
    }
  }

  if (!positionOrder.length) {
    errors.push('No players found');
    return { hand: null, errors };
  }

  // Build player objects
  const players = positionOrder.map(pos => ({
    name: pos,
    position: pos,
    startingStack: 50000,
    cards: '',
  }));

  // heroIdx: player named 'Hero', else 0
  const heroIdx = players.findIndex(p => p.name === 'Hero');
  const resolvedHeroIdx = heroIdx >= 0 ? heroIdx : 0;

  // ── Step 5: Build streets array ─────────────────────────
  const gameCfg = HAND_CONFIG[gameType] || HAND_CONFIG_DEFAULT;
  const numOpponents = players.length - 1;

  const streets = streetNames.map((streetName, si) => ({
    name: streetName,
    cards: {
      hero: '',
      opponents: Array.from({ length: numOpponents }, () => ''),
      board: '',
    },
    actions: [],
    draws: [],
  }));

  // Fill in parsed data
  for (let si = 0; si < parsedStreets.length && si < streets.length; si++) {
    const { playerTokens, boardCards } = parsedStreets[si];
    const street = streets[si];

    // Board cards
    if (boardCards) {
      street.cards.board = boardCards;
    }

    // Player actions and cards
    for (const pt of playerTokens) {
      const playerIdx = positionOrder.indexOf(pt.pos);
      if (playerIdx < 0) continue;

      // Assign hole cards to hero/opponents
      if (pt.cards) {
        if (playerIdx === resolvedHeroIdx) {
          // Assign to hero in street 0 (or wherever cards appear)
          if (si === 0) {
            street.cards.hero = pt.cards;
            players[playerIdx].cards = pt.cards;
          }
        } else {
          // Assign to opponent slot
          const oppIdx = playerIdx < resolvedHeroIdx ? playerIdx : playerIdx - 1;
          if (oppIdx >= 0 && oppIdx < street.cards.opponents.length) {
            street.cards.opponents[oppIdx] = pt.cards;
            if (si === 0) {
              players[playerIdx].cards = pt.cards;
            }
          }
        }
      }

      // Assign actions (skip if no action, e.g. just card entry)
      if (pt.action) {
        street.actions.push({
          player: playerIdx,
          action: pt.action,
          amount: pt.amount || 0,
        });
      }
    }
  }

  // ── Step 6: Build final hand object ─────────────────────
  const hand = {
    gameType,
    players: players.map(p => ({
      name: p.name,
      position: p.position,
      startingStack: p.startingStack,
    })),
    blinds,
    streets,
    heroIdx: resolvedHeroIdx,
    result: null,
  };

  return { hand, errors };
}
