# Hand replayer: winner evaluation audit

2026-10-20. The owner asked for this: "run a 1000-hand sample in the replayer across all games to test the
winner evaluation ... against the mechanics of each game. Research any unknowns and create a report of
anything that needs clarification."

No app code was changed. The harness lives in the worktree's `tmp/replayer-audit/` and is not committed.

## How it was tested

- **The app side** is the replayer's own code path, called from Node:
  - `evaluateShowdown` (what "Continue to Result" stores, `HandReplayerView.jsx` 3723).
  - `evaluateHand` (the heads-up result text on the felt).
  - The pot split `potAwards` (`HandReplayerView.jsx` 6271). It is internal to the component, so the harness
    copies its `scoreHand`, `hiLoWinnersAmong`, `computePotAwards` and `seatOrderFromButton` steps line for line.
  - The stud acting-order helpers `findStudBringIn`, `scoreStudBoard` and `findStudBestBoard`. These are lifted
    verbatim out of `HandReplayerView.jsx` and run as they are.
- **The reference** is a separate evaluator written from the published rules (`tmp/replayer-audit/reference.mjs`).
  It shares no code with `poker-engine.js`: it uses different subset generation, lexicographic keys instead of
  base-15 scores, and its own pairing, qualifier and odd-chip logic.
- **The random sample**: 1,000 hands with a seeded RNG (mulberry32, seed 20261020), 2 to 6 players each, dealt from
  the right deck (36 cards for Short Deck). Every app `gameType` key gets at least 6 hands, and every rule family
  gets at least 40. Hi-lo and lowball games get 60 to 70 each. Each hand is checked three ways:
  - who wins each half;
  - the heads-up text, when there are 2 players;
  - the chip split of a random 1 to 999 chip pot with a random button.
- **Targeted cases**: 73, each with a hand-written expected answer. The reference had to agree with that answer too,
  which caught six wrong expectations of my own before they could count against the app.
- **The game list** comes from `GAME_EVAL` (`poker-engine.js` 292), `HAND_CONFIG` (`utils.js` 251) and the replayer's
  game picker, `structureGameMap` (`HandReplayerView.jsx` 4527), which decides the `gameType` each picker game is
  saved as.

## Games covered

| Family | App `gameType` keys | Rules engine (`GAME_EVAL`) | Sample hands |
|---|---|---|---|
| Hold'em | NLH, LHE, PLH, Crazy Pineapple, Very Crazy Pineapple, Hideaway | high, best 5 of 7 | 40 |
| Short Deck (straight beats trips, the default) | Short Deck | high, 36 cards | 40 |
| Short Deck (trips beat straight) | Short Deck + `hand.tripsBeatStraight` | high, 36 cards | 40 |
| Omaha Hi, 4 cards | PLO, LO Hi | Omaha high | 40 |
| PLO5 | PLO5 | Omaha high | 40 |
| PLO6 | PLO6 | Omaha high | 40 |
| Omaha 8/b, 4 cards | PLO8, O8, NLO8 | Omaha hi-lo 8/b | 60 |
| Big O | Big O, Ultimate Big O | Omaha hi-lo 8/b, 5 cards | 60 |
| PLO6 8/b | PLO6 8/b | Omaha hi-lo 8/b, 6 cards | 60 |
| Stud Hi | Stud Hi, NL Stud Hi, PL Stud Hi | high, best 5 of 7 | 40 |
| Stud 8 | Stud 8, Stud Hi-Lo, NL Stud 8, PL Stud 8 | hi-lo 8/b | 60 |
| Razz | Razz, NL Razz, PL Razz | A-5 low | 70 |
| 2-7 Razz | 2-7 Razz | 2-7 low | 60 |
| 2-7 draw | 2-7 TD, PL 2-7 TD, L 2-7 TD, NL 2-7 SD | 2-7 low | 60 |
| A-5 draw | A-5 TD (the picker's A-5 Triple and Single Draw) | A-5 low | 70 |
| Badugi | Badugi | badugi | 60 |
| Badeucy | Badeucy | badugi + 2-7 | 60 |
| Badacey | Badacy (the app's spelling) | badugi + A-5 | 60 |
| 5-card draw | PL 5CD Hi | high | 40 |
| **Total** | | | **1,000** |

Games with no evaluator, either by design or by mistake, were covered by targeted cases and by reading the code:

- OFC and OFC Pineapple (`GAME_EVAL` null: OFC is scored in points).
- Super Stud and Super Razz, and Action Razz.
- The picker games that are saved as another game's `gameType` (see D5).

## Results

### Random sample (1,000 hands)

| Family | Hands | Winners right | Winners wrong | Pot split wrong |
|---|---|---|---|---|
| Hold'em (all six keys) | 40 | 40 | 0 | 0 |
| Short Deck, both settings | 80 | 80 | 0 | 0 |
| Omaha Hi 4/5/6 | 120 | 120 | 0 | 0 |
| Omaha 8/b, Big O, PLO6 8/b | 180 | 180 | 0 | 0 |
| Stud Hi | 40 | 40 | 0 | 0 |
| Stud 8 | 60 | 60 | 0 | 0 |
| Razz | 70 | 67 | **3** (heads-up text blank) | 0 |
| 2-7 Razz | 60 | 60 | 0 | 0 |
| 2-7 draw | 60 | 60 | 0 | 0 |
| A-5 draw | 70 | 61 | **9** | **9** |
| Badugi | 60 | 60 | 0 | 0 |
| Badeucy | 60 | 55 | **5** | **24** |
| Badacey | 60 | 54 | **6** | **26** |
| 5-card draw | 40 | 40 | 0 | 0 |
| **Total** | **1,000** | **977** | **23** | **59** |

The pot failures in Badeucy and Badacey come from two causes. Most (19 and 20) are the odd chip going to the
badugi half (Q4). The rest are the wrong winners from D2 and D3.

### Targeted cases (73)

| Group | Cases | Pass | Fail |
|---|---|---|---|
| Hold'em: wheel, steel wheel, Broadway, board plays, kickers that do not play, 3-way chop | 8 | 8 | 0 |
| Short Deck: flush over full house, A-6-7-8-9 both ways, trips/straight both settings, low straight flush | 6 | 6 | 0 |
| Omaha: exactly two hole cards, Big O, counterfeited low, quartering, no-low scoop, wheel scoop, PLO6 8/b, hi and lo from different pairs | 9 | 9 | 0 |
| Stud, Razz, 2-7 Razz showdowns | 8 | 7 | 1 (T6) |
| Draw: 2-7, A-5, Badugi, Badeucy, Badacey, 5-card draw | 16 | 11 | 5 (D4, D6, D7, D13, D15) |
| Picker-mapped games (what the picker actually saves) | 8 | 0 | 8 |
| Pot division and odd chips | 9 | 5 | 4 (P6 to P9) |
| Stud bring-in and first to act | 9 | 3 | 6 |

**What is solid.** The following all agree with the reference on every hand:

- every high-hand ranking;
- Omaha's exactly-two rule, across 4, 5 and 6 hole cards;
- 8-or-better qualification and counterfeiting;
- hi-lo halving and quartering;
- the flop-game odd chip (left of the button, and to the high half);
- both Short Deck settings;
- Badugi;
- 2-7 (except D4).

## Defects

Each defect gives the game, the hand, what the rule expects, what the app does, the rule and its source, and the
code involved. Seats are numbered from 0.

### D1. A-5 lowball: every paired hand ties every other paired hand (A-5 TD and A-5 Single Draw, Badacey's low half)

- **Hand (D6):** A-5 Triple Draw. Seat 0 `2c2d3h4s5c` (a pair of 2s), seat 1 `KcKd2h3s4c` (a pair of Ks).
- **Expected:** seat 0 wins. **Got:** a chop, and the felt text reads "Chop — null".
- **Also:** `2c2d3h3s5c` (two pair) against `KcKd2h3d4c` (one pair) is a chop too; the one pair should win (D7).
- **In the sample:** 9 of 70 A-5 hands. In Badacey, every player paired in the A-5 half shares that half (examples
  in the harness output: a 5-way "tie" of five different paired hands).
- **The pot:** `potAwards` treats these scores as readable, so it splits the pot from the cards. **Marking the
  real winner by hand does not change the split** (P8: 50/50 where 100/0 is right).
- **Rule:** in A-5 lowball, pairs count against you but still rank: one pair beats two pair, and a lower pair beats
  a higher pair. Straights and flushes do not count. Source: Robert's Rules of Poker, Lowball (Ace-to-Five)
  ("Straights and flushes do not count against your hand"), and the standard lowball hand ranking that every room uses.
- **Code:** `evalLowA5` (`poker-engine.js` 152) returns `score: Infinity` for any hand with a pair, so all paired
  hands score the same. `evaluateHand` builds its text from `name`, which is null for these hands.

### D2. Razz: a seven-card hand with no five different ranks cannot be ranked

- **Hand (T6):** Razz. Seat 0 `AhAc2d2h3c3sKd` (best: a pair of aces), seat 1 `KsKhQdQhJcJsTd` (best: a pair of tens).
- **Expected:** seat 0 wins. **Got:** no winner at all; the felt's heads-up text is blank.
- **In the sample:** 3 of 70 Razz hands lost their heads-up result. There, one player had a paired-only hand and
  the other did not; the winner list was still right, because the paired player is simply dropped. When every
  player is paired, the winner list is empty and the pot waits for a hand-marked winner.
- **Rule:** the same as D1: razz is A-5 lowball, so the lowest pair wins. Source: Robert's Rules §9, Razz.
- **Code:** `bestLowA5Hand` (`poker-engine.js` 268) keeps only lows with no pair and returns null if there are none.
  `evaluateHand` returns null when either side is null (591). `evaluateShowdown` filters the null hands out.

### D3. Badeucy: the badugi half plays the ace low; in Badeucy it is high

- **Hand (D13):** Seat 0 `Ac2d3h4s9c`, seat 1 `2c3d4h5sKc`.
- **Expected:** seat 1 scoops. Its badugi is 5-4-3-2, the nuts; seat 0's is A-4-3-2, ace-high. Seat 1 also has the
  better 2-7 hand (K-high against A-high). **Got:** seat 0 wins the badugi half and the pot is split.
- **In the sample:** 5 of 60 Badeucy hands had the wrong winner (for example `Td8h3cAs9c` given the badugi half
  over `6hJd4c5sKc`).
- **Rule:** "Aces are considered high cards for Badugi." The best Badeucy badugi is 5-4-3-2. Sources:
  [Asian Poker Tour, Badeucey](https://www.theasianpokertour.com/info/pokerhandbook/badeucey) and
  [PokerListings, Badeucy](https://www.pokerlistings.com/poker-rules/badeucy-poker).
- **Code:** `evaluateShowdown` and `evaluateHand` call `bestBadugiHand` for both split-badugi games, and
  `evalBadugi` (`poker-engine.js` 186) always counts the ace as 1. `GAME_EVAL['Badeucy']` (302) has no ace flag.

### D4. 2-7: A-2-3-4-5 of one suit is scored as a straight flush

- **Hand (D4):** 2-7 Triple Draw. Seat 0 `Ah2h3h4h5h`, seat 1 `2c2d2s3c3d` (a full house).
- **Expected:** seat 0 wins. In 2-7 the ace is only high, so seat 0 holds an ace-high flush, and a flush is a better
  low than a full house. **Got:** seat 1 wins, and seat 0's hand is named "Straight Flush, Five-high".
- **Rule:** "Aces are considered high only. The hand 5-4-3-2-A is not considered to be a straight, but an ace-5
  high." Source: Robert's Rules §11, Deuce-to-Seven Lowball.
- **Code:** `evalLow27` (`poker-engine.js` 167) correctly sees no straight. For a bad hand, though, it ranks it with
  `evalHigh5(cards)` (174), which treats A-2-3-4-5 as a wheel. It only matters when both hands are bad (a suited
  A-2-3-4-5 against a full house or quads), so it is rare.

### D5. Picker games saved as the wrong `gameType`, so evaluated by the wrong rules

The picker (`structureGameMap`, `HandReplayerView.jsx` 4527) saves these games as another game. Everything
downstream reads that `gameType`: the evaluator, the pot split and the export. Each line was confirmed by a
targeted case (M1 to M8) or by reading the code.

| Picker game | Saved as | What goes wrong | Case | Rule source |
|---|---|---|---|---|
| Limit + Omaha | `O8` (hi-lo) | A hi-only game splits the pot with a low: with `KsKdQsJd` against `Ac2c9h9d` on `3h5d8sKhTc`, the second hand takes half for an 8-low. The label even says "Limit Omaha Hi". `LO Hi` exists in `HAND_CONFIG` and `GAME_EVAL` but is never chosen, and the export writes the hand as "Omaha Hi/Lo Limit". | M1 | Omaha high has no low half |
| 2-7 Razz | `Razz` (A-5) | `Ac2d3h4s5c…` beats `7c5d4h3s2h…`, where in 2-7 Razz the A-5 is only ace-high and loses. `GAME_EVAL['2-7 Razz']` exists and is right; the picker just never uses it. | M2 | RRoP §11 (2-7 ranking) |
| Archie 66, Archie 99, Ari | `Badugi` | A five-card hi-lo draw game with qualifiers is judged as 4-card badugi. `AsAdKcKh2c` against `7c5d4h3s2h` should split (aces up take high, the 7-low takes low); the app gives the whole pot to the 7-5-3-2 badugi. | M3 | [APT, Archie](https://www.theasianpokertour.com/info/pokerhandbook/archie); [Card Player, Archie](https://www.cardplayer.com/poker-news/1106968-poker-strategy-with-mark-mazmanian-which-way-are-you-going-a-hand-of-archie) |
| Razzdugi | `Badugi` (a 4-card draw config) | A seven-card stud split game is created as a 4-card draw hand, and there is no razz half. | M8 | [APT, Razzdugi](https://www.theasianpokertour.com/info/pokerhandbook/razzdugi) |
| Razzdeucy | `Badeucy` (a 5-card draw config) | A seven-card stud game is created as a 5-card draw hand. The halves happen to be the right kinds, but D3 applies too. | code | [APT, Razzdugi (2-7)](https://www.theasianpokertour.com/info/pokerhandbook/razzdugi2to7) |
| Stud Hi/Lo Regular | `Stud 8` | "Regular" has no low qualifier. `Kd9h7s6c4d3hJc` should win low with 9-7-6-4-3; the app says "no qualifying low" and gives the high hand the whole pot. | M4 | [APT, 7-Card Stud Hi/lo (Regular)](https://www.theasianpokertour.com/info/pokerhandbook/sevencardstudhiloregular) |
| Dramaha Hi, 2-7, 49, 0, Dramadugi, Omajack | `PLO` (4 hole cards) | Dramaha deals 5 cards, with one draw, and splits Omaha-hand against draw-hand. Saved as PLO, the draw half never exists. | code | [Card Player, Dramaha](https://www.cardplayer.com/poker-news/29945-spice-up-your-poker-home-game-old-school-dramaha) |
| Courchevel | `PLO` (4 hole cards) | Courchevel is 5-card Omaha with the first flop card exposed preflop. Saved with 4 hole cards, it cannot hold the fifth. | code | [PokerListings, Courchevel](https://www.pokerlistings.com/poker-rules/courchevel-poker) |
| Double Board Bomb Pot | `PLO` | One board only; each board should win half. | code | Q7 |
| Pineapple | NLH / PLH / LHE | Fine once the discarded card is gone (2 cards at showdown). | — | — |

### D6. Super Stud, Super Razz and Action Razz: no automatic winner at all

- **Hand (M5 to M7):** the same hands that evaluate correctly as `Stud Hi` or `Razz` return no winners as
  `Super Stud Hi`, `Super Razz` or `Action Razz`.
- **Code:** the new-hand code adds the prefix to `hand.gameType` (`HandReplayerView.jsx` 4861 and 4862).
  `gameEvalFor` (`poker-engine.js` 70) looks up `GAME_EVAL[gameType]` without removing it, so the result is
  undefined and `evaluateShowdown` returns `[]`. `HAND_CONFIG` lookups strip `Super `, but nothing strips
  `Action `. So `getGameCategory('Action Razz')` (178) finds no config and also falls back to `'community'`; that
  last point is from reading the code, not from running it.
- **Rule:** Action Razz adds a qualifier: a hand must contain a jack, queen or king to win. If nobody at showdown
  has one, the plain lowest razz hand wins. Source:
  [Card Player, "Adding Some Action to Razz"](https://www.cardplayer.com/poker-news/26890-poker-games-adding-some-action-to-razz).
  Even with the prefix stripped, the app has no paint-card qualifier.

### D7. Stud acting order: the hand-showing score lets any unpaired board beat a pair

- **Hand (F4):** Stud Hi, 4th street. Seat 0 shows 2c 2h (a pair of 2s), seat 1 shows As Kd.
- **Expected:** seat 0 acts first. **Got:** seat 1.
- **Also:** on 6th street, J-T-7-3 (seat 3) is picked ahead of 8-8-K-7 and 8-8-K-5 (F2).
- **Code:** `scoreStudBoard` (`HandReplayerView.jsx` 417) gives a pair 3,000,000 plus a little, but gives an unpaired
  board 1,000,000 + rank × 100⁴, about 1.4 × 10⁹ for an ace. The category bases are smaller than the high-card part
  they are supposed to dominate. The same function, comparing two equal pairs, uses only the first kicker
  (`pairs[0]*100 + kickers[0]`), so 8-8-K-7 and 8-8-K-5 tie.
- **Rule:** from 4th street on, the highest hand showing acts first: a pair beats any no-pair board, and then the
  kickers count. Source: Robert's Rules §8 r2 ("the high hand on board initiates the action").
- **Scope:** this decides who is shown acting first, which steers the action order on the felt (`getActionOrder`).
  It does not change the showdown winner.

### D8. Razz acting order: the ace is scored high, and NL/PL Razz are treated as high games

- **Hand (F1b):** Razz, 4th street. Seat 0 shows As 2s; the others show K-Q, Q-J and 8-7. **Expected:** seat 0
  (the lowest board) acts first. **Got:** seat 3 (8-7), because `scoreStudBoard` values the ace at 14.
- **Hand (B3, B4):** NL Razz and PL Razz bring-in. With door cards K against 2-3-4, **expected:** the K brings it in.
  **Got:** the lowest card does, which is the high-game rule.
- **Code:** `isRazz = hand.gameType === 'Razz' || hand.gameType === '2-7 Razz'` (`HandReplayerView.jsx` 1122 and
  2677) misses `NL Razz`, `PL Razz` and the prefixed names. `scoreStudBoard` has no ace-low mode for razz. For
  2-7 Razz, the bring-in table plays the ace low, but in 2-7 the ace is the worst card and should bring in.
- **Rule:** in razz the highest card by suit brings in, and the low hand acts first on later streets. Source:
  Robert's Rules §9 r3. In Razzdeucy (2-7) "the A is the automatic bring-in card"
  ([APT, Razzdugi (2-7)](https://www.theasianpokertour.com/info/pokerhandbook/razzdugi2to7)).

### D9. Stud odd chip goes to the lowest seat, not to the high card by suit

- **Hand (P6):** Stud Hi. Seat 0 `KcKdQhJh9c3d2c` and seat 1 `KhKsQdJs9d3c2d` chop a 101-chip pot.
- **Expected:** seat 1 gets 51, because it holds the K♠, the high card by suit. **Got:** seat 0 gets 51.
- **Code:** stud seats are labelled "Seat 1..n" with no BTN, so `potAwards` passes `seatOrderFromButton(n, -1)`,
  which is ascending seat order (`HandReplayerView.jsx` 6341, `poker-engine.js` 444). The `computePotAwards`
  comment says so deliberately.
- **Rule:** TDA 2026 Rule 21-B, "Stud, razz, and if 2 or more high or low hands in stud/8: the odd chip goes to the
  high card by suit in the player's 5-card winning hand" ([Poker TDA rules](https://www.pokertda.com/view-poker-tda-rules/)).
  Only one chip, and only on a tie, so it matters little; it is listed because it is a rule mismatch.

## Smaller observations

- **Badeucy and Badacey odd chip.** The app gives the split's odd chip to the badugi half: the `hi` flag goes to the
  badugi winner and `computePotAwards` gives "hi" the odd chip. The APT gives it to the 2-7 (draw) winner (Q4).
  This is 39 of the 59 sample pot mismatches.
- **The export disagrees with the replayer on paired lows.** `hand-history/settle.js` `evaluate` drops a
  non-finite low and falls back to the stored winners, where the replayer splits from the cards (D1). A-5 draw is
  not exported, so today this only touches Razz, where both sides end up on the stored winners.
- **A sixth card never plays.** The kicker beyond five never plays in hold'em, and chops were all correct.

## Needs the owner's clarification

**Q1. Short Deck: trips against a straight.** The app asks per hand and stores `hand.tripsBeatStraight`; both
settings evaluate correctly. Rooms differ; the code's own note records the owner saying so, and both orders are in use. Options:
- (a) keep asking;
- (b) default to trips beat straight;
- (c) keep the current default (straight beats trips).

**Q2. Archie, Archie 66, Archie 99 and Ari.** What are these games exactly? Archie is a five-card triple draw,
hi-lo with qualifiers. The high qualifier varies: a pair of 9s in the original
([PokerNews on its creator](https://www.pokernews.com/news/2026/08/phil-hellmuth-remembers-big-al-emerson-52214.htm)),
a pair of 6s at APT. The low is 8-or-better A-5 using all five cards. APT also says that if nobody qualifies, the
pot is split among everyone who showed. I could not find "Ari" anywhere. Options:
- (a) Archie 99 = 9s / 8-low and Archie 66 = 6s / 8-low;
- (b) other definitions;
- (c) drop them from the picker until they have an evaluator.

**Q3. Badacey's ace.** Aces are low in both halves (A-2-3-4 badugi, wheel low). The app already does this, and the
sources agree, but APT's Badacey page does not say. Please confirm.

**Q4. Split-badugi odd chip.** APT gives the odd chip to the 2-7 (Badeucy) or A-5 (Badacey) winner. TDA 21-D says
"in non-standard non high-low games the odd chip goes to the worst position". The app gives it to the badugi
winner. Options:
- (a) the draw half (APT);
- (b) the badugi half (current);
- (c) the worst position (TDA).

**Q5. Odd chip in razz and stud.**
- TDA 21-B: the high card by suit in the five-card winning hand, for razz too.
- Robert's Rules: the lowest card by suit in low games, counting all seven cards.
- The app: lowest seat number.

Which rule should the replayer follow? See D9.

**Q6. Stud first to act on a tie.** Robert's Rules §8 r2 says a tied board "is broken by position, with the player
who received cards first acting first". The app picks the lowest seat index. Is seat 1 always the first seat left
of the dealer in the replayer's stud seating, or should the dealer's position be recorded?

**Q7. Double Board Bomb Pot.** The usual rule is half the pot per board, each board judged on its own; some rooms
play the boards as two separate pots. The app plays it as single-board PLO. Is it in scope, and which rule?

**Q8. Stud Hi/Lo Regular.** Should it be the no-qualifier game, as APT defines "Regular"? It is saved as `Stud 8`
today. `GAME_EVAL` also has a separate `Stud Hi-Lo` key with the 8 qualifier, so it is unclear which of the two
keys was meant to be "Regular".

**Q9. Ultimate Big O and Hideaway.** These are in `GAME_EVAL` (as Big O hi-lo and as hold'em-style high), but I
could not find published rules for either. Please confirm what they are, or retire the keys.

**Q10. Dramaha family and Omajack.** These need a second, draw-hand evaluation for half the pot: draw high, 2-7,
pips (49 = highest pip count, J/Q/K = 0, A = 1), badugi, and blackjack for Omajack. "Dramaha 0" and "Omajack"
have no published definition I could find. Should they get real evaluators, or a "mark the winner by hand" mode
that offers no auto-evaluation?

**Q11. Action Razz.** Should the app apply the paint-card qualifier (a J, Q or K anywhere in the seven cards)? And
should Super Razz and Super Stud evaluate as their base games once the prefix is stripped? Super Stud deals an
extra down card, which is discarded.

**Q12. Courchevel.** Hi only, or also Courchevel Hi-Lo (PokerStars and APT spread both)? Should it be saved with 5
hole cards, like PLO5?

## Sources

- Poker TDA, 2026 Rules v1.1, Rule 21 (Awarding Odd Chips): https://www.pokertda.com/view-poker-tda-rules/
- Robert's Rules of Poker (Ciaffone), v6 text: Stud §8, Razz §9, Stud High-Low §10, Lowball §11, Ties §3:
  https://homepokertourney.org/roberts-rules-of-poker-version-6.htm
- Asian Poker Tour handbook:
  - Badeucey: https://www.theasianpokertour.com/info/pokerhandbook/badeucey
  - Badacey: https://www.theasianpokertour.com/info/pokerhandbook/badacey
  - Archie: https://www.theasianpokertour.com/info/pokerhandbook/archie
  - Razzdugi: https://www.theasianpokertour.com/info/pokerhandbook/razzdugi
  - Razzdugi (2-7): https://www.theasianpokertour.com/info/pokerhandbook/razzdugi2to7
  - 7-Card Stud Hi/lo (Regular): https://www.theasianpokertour.com/info/pokerhandbook/sevencardstudhiloregular
- PokerListings:
  - Badeucy: https://www.pokerlistings.com/poker-rules/badeucy-poker
  - Courchevel: https://www.pokerlistings.com/poker-rules/courchevel-poker
- Card Player:
  - Action Razz: https://www.cardplayer.com/poker-news/26890-poker-games-adding-some-action-to-razz
  - Dramaha: https://www.cardplayer.com/poker-news/29945-spice-up-your-poker-home-game-old-school-dramaha
  - Archie: https://www.cardplayer.com/poker-news/1106968-poker-strategy-with-mark-mazmanian-which-way-are-you-going-a-hand-of-archie
- Big O (5-card Omaha hi-lo 8/b): https://www.pokernews.com/poker-rules/big-o.htm
