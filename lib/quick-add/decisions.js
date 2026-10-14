// Quick-add: the owner's decisions on the parser (DECISION A to I of the 2026-10-14 corpus
// analysis), each as a named value so a change of mind is a one-line change in this file.
//
// The owner answered all of them on 2026-10-14; this file holds the answers. Where a value is
// not the final word (D is deferred) the entry says so. Each entry says what the choices are
// and where it takes effect:
//
//   A  UTG_WITH_STRADDLE   prompt.js (PARSE_SYSTEM, "Positions"); normalize.js (straddleSeats)
//   B  HEDGED_VALUES       normalize.js (hedge: stacks and sizes said as "about")
//   C  OBSERVER_HANDS      normalize.js (draftToInternal) → hand.heroless; rules-setup.js
//   D  UNSUPPORTED_FORMATS normalize.js (readFormat)   *** DEFERRED BY THE OWNER ***
//   E  OWN_GAMES, VARIANT_GAMES   games.js (GAMES), prompt.js, normalize.js, client game.js
//   F  SEVERAL_HANDS       prompt.js ("Which hand"); normalize.js (quickAdd.otherHandsBlocking)
//   G  PER_POT_WINNERS     prompt.js (result.pots); normalize.js (readResult)
//   H  HAND_HISTORY_FAST_PATH   lib/quick-add/hh.js; lib/quick-add.js (the /parse route)
//   I  NUMBER_WORDS        prompt.js (buildParseRequest); lib/quick-add.js logs the conversions
//
// test/quick-add/normalisers.test.js ("the owner's decisions") checks each value and each
// switch that exists.
'use strict';

const DECISIONS = {
  /* A. "UTG" while a UTG straddle is on. OWNER: the opener is the seat AFTER the straddler.
       'next-seat'  the straddler is UTG; a player called "UTG"/"under the gun" who opens,
                    limps or calls is UTG+1 (the owner's answer)
       'both-act'   the analysis' first proposal: the opener is the next seat only when the
                    story has the straddler act too
       'ask'        never decide: write UTG for the one named UTG and add a note */
  UTG_WITH_STRADDLE: 'next-seat',

  /* B. Hedged values ("about 150", "like 7500", "-ish"). OWNER: record the value with a note.
       A value given two ways ("a six or a seven", "35 give or take 33") is ALWAYS a question
       (choices), whatever this says.
       'note'  record the number, flag it approx, say so in a note (the owner's answer)
       'ask'   also raise a non-blocking question for each estimate */
  HEDGED_VALUES: 'note',

  /* C. Observer hands (a hand watched, commentated or told about). OWNER: store them as a
       HERO-LESS hand.
       'heroless'  hand.heroless = true, heroIdx null, no hero question; every known card is
                   kept with its player (the replayer follow-up shows them all face up)
       'refuse'    not recordable (gap "scope")
     TODO(replayer follow-up, owner 2026-10-14): the replayer reads heroIdx ?? 0 everywhere.
     To replay a hero-less hand it needs: (1) hand.heroless honoured — no hero highlight, no
     hero-relative copy ("you"), no hero stack banner; (2) cards.hero read as SEAT 0's cards
     when heroless, and every seat's known cards drawn face up from the start; (3) hand-shorthand
     encode/decode and the saved-hand schema carrying the flag; (4) the hands list and stats
     skipping a hero-less hand. Until then QuickAddView.toReplayable opens it with heroIdx 0. */
  OBSERVER_HANDS: 'heroless',

  /* D. Bomb pots, double boards, run it twice, button blinds, rock straddles.
     TODO(deferred by the owner on 2026-10-14: "mark this as something to come back to"): the
     CURRENT behaviour stays until the owner decides —
       'approximate'  record the nearest hand and tell the player what was dropped
                      (gap "unsupported")
       'refuse'       not recordable (gap "scope")
     The ideas on the table, not built: a bomb pot as a per-player ante with no preflop
     betting; a double board as board 1 only (kept); run it twice as the first runout (kept). */
  UNSUPPORTED_FORMATS: 'approximate',

  /* E. PLO5, PLO6, PLO6 8/b, Short Deck and NLO8. OWNER: each is its OWN game — quick add
     recognises and outputs each under its own name, never collapsed into PLO or NLH. The
     games.js GAMES table holds them; this list is for the tests and the docs.
       "PLO6 8/b" was the replayer's "Big Easy" (decision E2); the replayer follow-up (2026-10-14)
       renamed it, so the name is the same on both sides and "Big Easy" is accepted only as an
       INPUT alias (an old saved hand or link that says it opens as PLO6 8/b).
     DONE (replayer follow-up): each has its own HAND_CONFIG entry, evaluator and picker row in the
     replayer, so a hand opens in the replayer natively; REPLAYER_FALLBACK is gone. */
  OWN_GAMES: ['PLO5', 'PLO6', 'PLO6 8/b', 'Short Deck', 'NLO8'],
  /* Variants quick add still has no game for, and the nearest game each is recorded as (with
     a note). An empty object leaves the game open (the player is asked). */
  VARIANT_GAMES: { Pineapple: 'NLH', Courchevel: 'PLO' },

  /* F. A post that tells several hands. OWNER: ALWAYS ASK which one.
       'ask'            record the one told in most detail (or the one asked about) and raise a
                        BLOCKING gap, "which hand?" (the owner's answer)
       'most-detailed'  the same hand, but the gap is a non-blocking note
       'last-asked'     record the last hand asked about; non-blocking */
  SEVERAL_HANDS: 'ask',

  /* G. Side pots and run-it-twice: OWNER: record a winner PER POT.
       true   result.pots = [{ name, winners: [{ playerIdx, split }] }] beside result.winners
              (the main pot's winners)
       false  result.winners only
     TODO(replayer follow-up): show and edit per-pot winners; the replayer reads result.winners. */
  PER_POT_WINNERS: true,

  /* H. Pasted PokerStars / GG / Full Tilt / converter hand histories. OWNER: YES, read them in
     code first (lib/quick-add/hh.js) and fall back to the model line by line, with screen names
     replaced before anything reaches the API.
       true   the fast path runs
       false  every pasted history goes through the model as text — with the names replaced
              all the same: a screen name never reaches the API, whichever way this is set */
  HAND_HISTORY_FAST_PATH: true,

  /* I. Number words in a speech transcript. OWNER: YES, a logged pre-pass that never touches
     rank words.
       'rewrite'  the transcript is sent with the certain number words as digits, the
                  conversions are listed beside it and logged (the owner's answer)
       'aid'      the transcript is sent as said, the conversions listed beside it */
  NUMBER_WORDS: 'rewrite',
};

module.exports = DECISIONS;
