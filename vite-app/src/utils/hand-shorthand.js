// ── Hand Shorthand Encoder/Decoder ─────────────────────────
// Compact URL-safe text format for sharing poker hands via URL
// Converted from public/js/hand-shorthand.js

import { HAND_CONFIG, HAND_CONFIG_DEFAULT } from './utils.js';

export const GAME_CODES = {
  'NLH':'N', 'LHE':'L', 'PLO':'P', 'PLO8':'P8', 'O8':'O8', 'Big O':'BO',
  'LO Hi':'LH', 'PLH':'PH', 'Razz':'R', 'Stud Hi':'SH', 'Stud 8':'S8',
  'Stud Hi-Lo':'SL', '2-7 Razz':'2R', '2-7 TD':'TD', 'NL 2-7 SD':'SD',
  'PL 2-7 TD':'PT', 'L 2-7 TD':'LT', 'A-5 TD':'A5', 'Badugi':'BG',
  'Badeucy':'BC', 'Badacy':'BA', 'PL 5CD Hi':'PD', 'OFC':'OF',
  'PLO5':'P5', 'PLO6':'P6', 'Big Easy':'BE', 'Ultimate Big O':'UB',
  'Crazy Pineapple':'CP', 'Very Crazy Pineapple':'VP', 'Hideaway':'HW',
  'NL Stud Hi':'NS', 'PL Stud Hi':'PS', 'NL Stud 8':'N8', 'PL Stud 8':'G8',
  'NL Razz':'NZ', 'PL Razz':'PZ'
};

export const GAME_CODES_REV = {};
Object.keys(GAME_CODES).forEach(function(k) { GAME_CODES_REV[GAME_CODES[k]] = k; });

const ACTION_CHARS = { 'fold':'f', 'check':'x', 'call':'c', 'bet':'b', 'raise':'r', 'all-in':'a', 'bring-in':'i' };
const ACTION_CHARS_REV = {};
Object.keys(ACTION_CHARS).forEach(function(k) { ACTION_CHARS_REV[ACTION_CHARS[k]] = k; });

const SHORTHAND_STREET_DEFS = {
  community: { streets: ['Preflop', 'Flop', 'Turn', 'River'], boardCards: [0, 3, 1, 1] },
  draw_triple: { streets: ['Pre-Draw', 'First Draw', 'Second Draw', 'Third Draw'], boardCards: [0, 0, 0, 0] },
  draw_single: { streets: ['Pre-Draw', 'Draw'], boardCards: [0, 0] },
  stud: { streets: ['3rd Street', '4th Street', '5th Street', '6th Street', '7th Street'], boardCards: [0, 0, 0, 0, 0] },
  ofc: { streets: ['Initial (5)', 'Card 6', 'Card 7', 'Card 8', 'Card 9', 'Card 10', 'Card 11', 'Card 12', 'Card 13'], boardCards: [0, 0, 0, 0, 0, 0, 0, 0, 0] }
};

function _shGetGameCategory(gameType) {
  var cfg = HAND_CONFIG[gameType] || HAND_CONFIG_DEFAULT;
  if (!cfg) return 'community';
  if (gameType === 'OFC') return 'ofc';
  if (cfg.isStud) return 'stud';
  if (cfg.hasBoard) return 'community';
  if (['2-7 TD', 'PL 2-7 TD', 'L 2-7 TD', 'A-5 TD', 'Badeucy', 'Badacy', 'Badugi'].indexOf(gameType) >= 0) return 'draw_triple';
  if (['NL 2-7 SD', 'PL 5CD Hi'].indexOf(gameType) >= 0) return 'draw_single';
  if (!cfg.hasBoard && !cfg.isStud) {
    return 'community';
  }
  return 'community';
}

function _shGetStreetDef(gameType) {
  return SHORTHAND_STREET_DEFS[_shGetGameCategory(gameType)] || SHORTHAND_STREET_DEFS.community;
}

function _shGetPositionLabels(numPlayers) {
  if (numPlayers <= 2) return ['BTN/SB', 'BB'];
  if (numPlayers === 3) return ['BTN', 'SB', 'BB'];
  var middle = ['UTG', 'UTG+1', 'MP1', 'MP2', 'LJ', 'HJ', 'CO'];
  var need = numPlayers - 3;
  var picked = middle.slice(Math.max(0, middle.length - need));
  return picked.concat(['BTN', 'SB', 'BB']);
}

// ── Encode ──────────────────────────────────────────────────

export function encodeHand(hand) {
  if (!hand || !hand.gameType) return '';
  var parts = [];

  var gameCode = GAME_CODES[hand.gameType] || hand.gameType;
  var n = hand.players.length;
  var numChar = n === 10 ? 'T' : String(n);
  var heroChar = hand.heroIdx != null ? hand.heroIdx.toString(16).toUpperCase() : '0';
  parts.push(gameCode + numChar + heroChar);

  var blinds = hand.blinds || { sb: 0, bb: 0, ante: 0 };
  var blindStr = blinds.sb + '-' + blinds.bb;
  if (blinds.ante) blindStr += '-' + blinds.ante;
  var stacks = hand.players.map(function(p) { return p.startingStack || 50000; });
  var allSame = stacks.every(function(s) { return s === stacks[0]; });
  if (allSame && stacks[0] !== 50000) {
    blindStr += '~' + stacks[0];
  } else if (!allSame) {
    blindStr += '~' + stacks.join(',');
  }
  parts.push(blindStr);

  var streets = hand.streets || [];
  var cardParts = [];
  for (var si = 0; si < streets.length; si++) {
    var st = streets[si];
    var cards = st.cards || {};
    var streetCards = [];
    if (si === 0 || _shGetGameCategory(hand.gameType) === 'stud') {
      streetCards.push(cards.hero || '-');
    }
    var opps = cards.opponents || [];
    if (si === 0 || _shGetGameCategory(hand.gameType) === 'stud') {
      for (var oi = 0; oi < opps.length; oi++) {
        streetCards.push(opps[oi] || '-');
      }
    }
    if (cards.board) {
      streetCards.push('b' + cards.board);
    }
    cardParts.push(streetCards.join(','));
  }
  parts.push(cardParts.join('/'));

  var actionParts = [];
  var hasDraws = false;
  for (var ai = 0; ai < streets.length; ai++) {
    var acts = streets[ai].actions || [];
    var streetActions = [];
    for (var aj = 0; aj < acts.length; aj++) {
      var act = acts[aj];
      var actionChar = ACTION_CHARS[act.action] || act.action;
      var actionStr = act.player + actionChar;
      if (act.action !== 'fold' && act.action !== 'check' && act.amount) {
        actionStr += act.amount;
      }
      streetActions.push(actionStr);
    }
    actionParts.push(streetActions.join(','));
    if (streets[ai].draws && streets[ai].draws.length > 0) hasDraws = true;
  }
  var actionSection = actionParts.join('/');

  if (hasDraws) {
    var drawParts = [];
    for (var di = 0; di < streets.length; di++) {
      var draws = streets[di].draws || [];
      if (draws.length > 0) {
        var drawEntries = draws.map(function(d) {
          return d.player + ':' + (d.discarded || 0);
        });
        drawParts.push('d' + drawEntries.join(','));
      }
    }
    if (drawParts.length > 0) {
      actionSection += '/' + drawParts.join('/');
    }
  }
  parts.push(actionSection);

  var result = hand.result;
  var resultStr = '';
  if (result && result.winners && result.winners.length > 0) {
    var isSplit = result.winners.some(function(w) { return w.split; });
    if (isSplit) {
      resultStr = 'w' + result.winners.map(function(w) { return w.playerIdx; }).join(',') + 's';
    } else {
      resultStr = 'w' + result.winners[0].playerIdx;
    }
  }
  parts.push(resultStr);

  return parts.join('.');
}

// ── Decode ──────────────────────────────────────────────────

export function decodeHand(str) {
  if (!str) return null;
  var parts = str.split('.');
  if (parts.length < 5) return null;

  var headerStr = parts[0];
  var blindsStr = parts[1];
  var cardsStr = parts[2];
  var actionsStr = parts[3];
  var resultStr = parts[4] || '';

  /* The header is written as gameCode + numPlayers + heroIdx with no
     separator, and several game codes are another code plus a digit — P8 is
     PLO8, P5 is PLO5, P6 is PLO6, N8 is NL Stud 8, PT is PL 2-7 TD, LT is
     L 2-7 TD. Taking the longest matching code therefore ate the PLAYER COUNT
     of the shorter game: 8-handed PLO ("P84") decoded as PLO8 with 4 players
     and hero 0, and so did 8-handed hold'em ("N84") as NL Stud 8. Six
     game/size combinations were wrong, two of them the most common games
     there are, on the one path by which anybody who is not an admin ever
     sees a hand.

     The header's LENGTH settles it: whatever the code, exactly two
     characters follow it. A real PLO8 hand with four players is "P840". */
  var gameType = null;
  var codeLen = 0;
  var sortedCodes = Object.keys(GAME_CODES_REV).sort(function(a, b) { return b.length - a.length; });
  var candidates = [];
  for (var ci = 0; ci < sortedCodes.length; ci++) {
    if (headerStr.indexOf(sortedCodes[ci]) === 0) candidates.push(sortedCodes[ci]);
  }
  var chosen = null;
  for (var cj = 0; cj < candidates.length; cj++) {
    if (headerStr.length === candidates[cj].length + 2) { chosen = candidates[cj]; break; }
  }
  /* No candidate leaves exactly two characters — a malformed or future header.
     Fall back to the longest match, which is what this always did. */
  if (!chosen && candidates.length) chosen = candidates[0];
  if (chosen) {
    gameType = GAME_CODES_REV[chosen];
    codeLen = chosen.length;
  }
  if (!gameType) return null;

  var numPlayersChar = headerStr.charAt(codeLen);
  var numPlayers = numPlayersChar === 'T' ? 10 : parseInt(numPlayersChar, 10);
  if (isNaN(numPlayers) || numPlayers < 2) return null;

  var heroIdx = parseInt(headerStr.charAt(codeLen + 1), 16);
  if (isNaN(heroIdx)) heroIdx = 0;

  var blindsParts = blindsStr.split('~');
  var blindNums = blindsParts[0].split('-').map(Number);
  var sb = blindNums[0] || 0;
  var bb = blindNums[1] || 0;
  var ante = blindNums[2] || 0;

  var playerStacks = [];
  if (blindsParts.length > 1) {
    var stackStr = blindsParts[1];
    if (stackStr.indexOf(',') >= 0) {
      playerStacks = stackStr.split(',').map(Number);
    } else {
      var uniformStack = Number(stackStr);
      for (var si = 0; si < numPlayers; si++) playerStacks.push(uniformStack);
    }
  }
  if (playerStacks.length === 0) {
    for (var si2 = 0; si2 < numPlayers; si2++) playerStacks.push(50000);
  }

  var gameCfg = HAND_CONFIG[gameType] || HAND_CONFIG_DEFAULT;
  var positions = gameCfg.isStud
    ? Array.from({ length: numPlayers }, function(_, i) { return 'Seat ' + (i + 1); })
    : _shGetPositionLabels(numPlayers);

  var players = [];
  for (var pi = 0; pi < numPlayers; pi++) {
    var name;
    if (pi === heroIdx) {
      name = 'Hero';
    } else {
      var oppNum = pi < heroIdx ? pi : pi - 1;
      name = 'Opp ' + (oppNum + 1);
    }
    players.push({
      name: name,
      position: positions[pi] || '',
      startingStack: playerStacks[pi] || 50000
    });
  }

  var streetDef = _shGetStreetDef(gameType);
  var cardStreets = cardsStr ? cardsStr.split('/') : [];
  var category = _shGetGameCategory(gameType);

  var streets = streetDef.streets.map(function(streetName, idx) {
    var hero = '';
    var opponents = Array.from({ length: numPlayers - 1 }, function() { return ''; });
    var board = '';
    var rawCards = cardStreets[idx] ? cardStreets[idx].split(',') : [];

    if (idx === 0 || category === 'stud') {
      var cardIdx = 0;
      if (rawCards[cardIdx] && rawCards[cardIdx] !== '-') {
        hero = rawCards[cardIdx];
      }
      cardIdx++;
      for (var oi = 0; oi < numPlayers - 1; oi++) {
        if (rawCards[cardIdx] && rawCards[cardIdx] !== '-' && rawCards[cardIdx].charAt(0) !== 'b') {
          opponents[oi] = rawCards[cardIdx];
        }
        cardIdx++;
      }
      for (var bi = cardIdx; bi < rawCards.length; bi++) {
        if (rawCards[bi] && rawCards[bi].charAt(0) === 'b') {
          board = rawCards[bi].substring(1);
        }
      }
    } else {
      for (var bi2 = 0; bi2 < rawCards.length; bi2++) {
        if (rawCards[bi2] && rawCards[bi2].charAt(0) === 'b') {
          board = rawCards[bi2].substring(1);
        }
      }
    }

    return {
      name: streetName,
      cards: { hero: hero, opponents: opponents, board: board },
      actions: [],
      draws: []
    };
  });

  var actionStreets = actionsStr ? actionsStr.split('/') : [];
  var pureActionStreets = [];
  var drawSections = [];
  for (var as = 0; as < actionStreets.length; as++) {
    if (actionStreets[as].charAt(0) === 'd') {
      drawSections.push(actionStreets[as]);
    } else {
      pureActionStreets.push(actionStreets[as]);
    }
  }

  for (var sti = 0; sti < pureActionStreets.length && sti < streets.length; sti++) {
    var streetActStr = pureActionStreets[sti];
    if (!streetActStr) continue;
    var actionTokens = streetActStr.split(',');
    for (var ti = 0; ti < actionTokens.length; ti++) {
      var tok = actionTokens[ti].trim();
      if (!tok) continue;
      var playerIdx2 = parseInt(tok.charAt(0), 10);
      var actionChar = tok.charAt(1);
      var amount = tok.length > 2 ? parseInt(tok.substring(2), 10) : 0;
      var actionName = ACTION_CHARS_REV[actionChar] || actionChar;
      streets[sti].actions.push({
        player: playerIdx2,
        action: actionName,
        amount: amount
      });
    }
  }

  for (var dsi = 0; dsi < drawSections.length; dsi++) {
    var drawStr = drawSections[dsi].substring(1);
    var drawEntries = drawStr.split(',');
    var drawStreetIdx = dsi + 1;
    if (drawStreetIdx < streets.length) {
      for (var dei = 0; dei < drawEntries.length; dei++) {
        var drawParts2 = drawEntries[dei].split(':');
        if (drawParts2.length === 2) {
          streets[drawStreetIdx].draws.push({
            player: parseInt(drawParts2[0], 10),
            discarded: parseInt(drawParts2[1], 10)
          });
        }
      }
    }
  }

  var result = null;
  if (resultStr && resultStr.charAt(0) === 'w') {
    var rBody = resultStr.substring(1);
    if (rBody.charAt(rBody.length - 1) === 's') {
      var splitIdxs = rBody.substring(0, rBody.length - 1).split(',').map(Number);
      result = {
        winners: splitIdxs.map(function(idx) { return { playerIdx: idx, split: true }; })
      };
    } else {
      result = {
        winners: [{ playerIdx: parseInt(rBody, 10), split: false }]
      };
    }
  }

  return {
    gameType: gameType,
    players: players,
    blinds: { sb: sb, bb: bb, ante: ante },
    streets: streets,
    heroIdx: heroIdx,
    result: result
  };
}
