// Quick-add: the owner's open decisions, and the default each one takes meanwhile.
//
// The 2026-10-14 corpus analysis (236 collected hands) ended with nine questions that are the
// owner's to answer (DECISION A to I). Until they are answered the code takes the analysis'
// proposed default, and every default is a value here, so an answer is a one-line change in
// this file. Each entry says what the choices are and where it takes effect.
//
//   A  UTG_WITH_STRADDLE   prompt.js (PARSE_SYSTEM, "Positions")
//   B  HEDGED_VALUES       normalize.js (hedge: stacks and sizes said as "about")
//   C  OBSERVER_HANDS      normalize.js (draftToInternal); the hero gap (rules-setup.js) offers
//                          "I wasn't in this hand" and then "whose seat should the replay follow?"
//   D  UNSUPPORTED_FORMATS normalize.js (readFormat)
//   E  VARIANT_GAMES       prompt.js (HAND_TOOL.variant) and normalize.js (draftToInternal)
//   F  SEVERAL_HANDS       prompt.js ("Which hand") and normalize.js (quickAdd.otherHandsBlocking)
//   G  PER_POT_WINNERS     no switch: result.winners is one list with a split flag
//   H  HAND_HISTORY_FAST_PATH  no switch: no parser for pasted histories exists yet
//   I  NUMBER_WORDS        prompt.js (buildParseRequest)
//
// test/quick-add/normalisers.test.js ("the owner's decisions") checks each default and each
// switch that exists.
'use strict';

const DECISIONS = {
  /* A. "UTG" while a UTG straddle is on: does it name the straddler or the next seat?
       'both-act'  the opener is the next seat (UTG+1) only when the story has the straddler
                   act too; otherwise the named UTG stays UTG and a note says so (default)
       'ask'       never decide: write UTG for the one named UTG and add a note, always */
  UTG_WITH_STRADDLE: 'both-act',

  /* B. Hedged values ("about 150", "like 7500", "-ish"). A value given two ways ("a six or a
       seven", "35 give or take 33") is ALWAYS a question (choices), whatever this says.
       'note'      record the number, flag it approx, say so in a note (default)
       'ask'       also raise a non-blocking question for each estimate */
  HEDGED_VALUES: 'note',

  /* C. Observer hands (a hand watched, commentated or told about).
       'follow-seat'  record it; the player picks whose seat the replay follows, who becomes
                      the hero (default)
       'refuse'       not recordable (gap "scope") */
  OBSERVER_HANDS: 'follow-seat',

  /* D. Bomb pots, double boards, run it twice, button blinds.
       'approximate'  record the nearest hand and tell the player what was dropped
                      (gap "unsupported") (default)
       'refuse'       not recordable (gap "scope") */
  UNSUPPORTED_FORMATS: 'approximate',

  /* E. Variants the replayer has no game for: the nearest game each is recorded as. An
       empty object leaves the game open (the player is asked). The replayer's own game
       picker (HandReplayerView.jsx structureGameMap) does the same for PLO5/PLO6/short deck. */
  VARIANT_GAMES: { PLO5: 'PLO', PLO6: 'PLO', 'short deck': 'NLH', NLO8: 'PLO8' },

  /* F. A post that tells several hands.
       'most-detailed'  record the one told in most detail (or the one asked about), list the
                        rest in a non-blocking gap (default)
       'last-asked'     record the last hand asked about
       'ask'            as 'most-detailed', but the gap is blocking: the player must say which */
  SEVERAL_HANDS: 'most-detailed',

  /* G. Side pots won by different players, run-it-twice results with different winners:
       false  not stored; result.winners stays one list (default). No switch yet. */
  PER_POT_WINNERS: false,

  /* H. Parsing pasted PokerStars / GG / FT hand histories on the server without the model:
       false  every history goes through the model; only the seat arithmetic (seatNumber and
              buttonSeat) is done in code (default). No switch yet. */
  HAND_HISTORY_FAST_PATH: false,

  /* I. Number words in a speech transcript.
       'aid'      the transcript is sent as said, with the certain conversions listed beside it
                  as a reading aid (default)
       'rewrite'  the transcript is sent with those conversions applied */
  NUMBER_WORDS: 'aid',
};

module.exports = DECISIONS;
