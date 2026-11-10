# Hand entry, held to PokerKit

The replay of a saved hand is proven against PokerKit (`test/replayer-oracle/`). This is the step before
it: can those same hands be put in through the entry screens, and do the screens agree with PokerKit, at
every decision, on whose turn it is, what may be done and what it costs?

The answer today: **whose turn it is, the street, the pot, the stacks, the price of a call, the limit bet
sizes, the bring-in and completion, when a round closes and the chips at the end are right; what the
screens OFFER is not, and three things save a wrong hand or stop a legal one.**

1. In pot-limit with a big-blind ante the screen leaves the ante out of the pot before the flop and cuts
   a legal raise down to its own ceiling without a word.
2. The Result scores a folded hero's cards and saves the hero as a winner.
3. "All-in", pressed for a player who cannot cover the call, is saved as a raise, and the round can then
   never close.

Besides those: raises are offered where PokerKit allows none, the smallest raise shown after a short
all-in is too small, and four things cannot be entered at all (a cash figure with cents typed key by key,
a 7th-street card nobody saw, a small bet on 4th street when a pair shows, a card that came back after a
reshuffle). Each is below with a hand that reproduces it.

Nothing in the app was changed. One script was added: `scripts/check-replayer-entry-oracle.mjs`.
The user-side audit of the same screens is `docs/entry-audit/findings.md`; where it met the same thing
its number is given (#7, #8, #18, #20, #23, #24, #26).

## What was run

- **The script** enters each corpus hand as a user would, in WebKit at 402x874: taps and typed numbers on
  the real screens, no state injected, no API call of its own to save. Before every action it reads the
  screen and checks the seat to act, the street, the pot and that seat's stack, that the corpus action is
  on offer at the corpus's price, and that nothing is on offer that PokerKit would refuse. It deals the
  boards, the stud streets and the draws, shows the hands, reads the Result screen, presses Save & Replay,
  takes the replay to its End, holds every seat to the corpus's stack to the cent, and fetches the saved
  hand back to compare it with the corpus hand.
- **The rules it holds the screens to are PokerKit's**, restated in the script's `model()` and checked
  against the corpus itself: `--model-only` walks all 20,000 hands, 313,421 actions, and prints
  **0 warnings** (the committed corpus the same: 1,139 hands without a straddle, 22,272 actions,
  0 warnings). An expectation the screen fails is therefore PokerKit's, not this script's opinion.
- **The corpus** for the numbers below is `c1000b.jsonl`: 20,000 hands, 1,000 of each of the twenty games,
  cash and tournament, no straddles. It and the private build are in the session's scratch folder on the
  PC (paths under "How to rerun"). **An id names a hand in ONE corpus:** `NLH#128` in `c1000b.jsonl` is
  not `NLH#128` in the committed `test/replayer-oracle/corpus.jsonl`. Ids from the committed corpus are
  given beside each finding so it can be reproduced with nothing but the repo.
- **The build** is the private one, `build-entry-oracle`, holding the replayer fixes that were uncommitted
  when the audit began. Scratch server on ports 4860-4869 only.

| Run | Corpus | Hands | What it was for | Result |
|---|---|---|---|---|
| The 25-per-game run | c1000b | 500 | every game, the mix below | 101 clean; 459 carried to the end, all 459 on PokerKit's chips; 41 stopped (below) |
| Pot-limit ante, predicted | c1000b | 28 | 21 hands the model said would be cut, 7 controls with an ante and no raise over the ceiling | 21 of 21 cut; 7 of 7 controls saved and replayed right; the Pot figure wrong on all 28 |
| Folded hero, predicted | c1000b | 40 | 2 per game where the hero folds and there is a showdown | 37 carried to the end, all on chips; 9 of the 37 saved the hero as a winner |
| Reshuffled cards | c1000b | 7 | hands with a card that comes back from the discards | all 7 refused a card; 2 still saved and replayed right |
| All-in button | c1000b | 4 | `--all-in-button` | 2 stop (the round never closes); 2 saved and replayed right |
| Figures as the app shows them | c1000b | 3 | `--as-shown` | 3 of 3 saved and replayed right |
| One hand again | c1000b | 1 | `PL 2-7 TD#11`, the one driver timeout of the big run | entered, saved, replayed right |
| Committed corpus, 3 per game | committed | 60 | the same check with nothing but the repo | 4 clean; 54 carried to the end, all 54 on chips |
| Committed corpus, by id | committed | 52 | a committed id for every cause | every cause reproduced; 38 carried to the end, all on chips |
| Committed corpus, All-in button | committed | 3 | `--all-in-button` | 1 stops (`NL 2-7 SD#3`); 2 saved and replayed right |

698 hands in all, plus 60 in the first passes that got the driver right (not counted anywhere).
The big run took 81 minutes at five hands at a time on a busy machine (about 10 s of clock per hand).

### Per game (the 25-per-game run)

| Game | Hands | Cash | Tournament | Clean | Clean but for cents | To the end | Chips right | Hands with a fail | Cannot enter (cents aside) | Hands with an offer |
|---|---|---|---|---|---|---|---|---|---|---|
| NLH | 25 | 12 | 13 | 2 | 6 | 25 | 25 | 1 | 0 | 18 |
| PLH | 25 | 12 | 13 | 3 | 10 | 25 | 25 | 0 | 0 | 15 |
| LHE | 25 | 13 | 12 | 8 | 19 | 25 | 25 | 2 | 0 | 4 |
| PLO | 25 | 12 | 13 | 4 | 11 | 24 | 24 | 1 | 0 | 13 |
| PLO5 | 25 | 12 | 13 | 5 | 12 | 21 | 21 | 5 | 0 | 8 |
| PLO6 | 25 | 12 | 13 | 2 | 8 | 23 | 23 | 3 | 0 | 14 |
| LO Hi | 25 | 13 | 12 | 7 | 19 | 25 | 25 | 2 | 0 | 4 |
| PLO8 | 25 | 12 | 13 | 2 | 8 | 21 | 21 | 6 | 0 | 11 |
| NLO8 | 25 | 12 | 13 | 3 | 8 | 25 | 25 | 0 | 0 | 17 |
| O8 | 25 | 13 | 12 | 7 | 18 | 25 | 25 | 2 | 0 | 5 |
| Big O | 25 | 12 | 13 | 3 | 9 | 20 | 20 | 6 | 0 | 10 |
| PLO6 8/b | 25 | 12 | 13 | 4 | 10 | 23 | 23 | 4 | 0 | 11 |
| Stud Hi | 25 | 13 | 12 | 7 | 18 | 22 | 22 | 0 | 4 | 3 |
| Stud 8 | 25 | 13 | 12 | 8 | 18 | 20 | 20 | 1 | 6 | 0 |
| Razz | 25 | 14 | 11 | 6 | 17 | 20 | 20 | 0 | 6 | 2 |
| 2-7 TD | 25 | 13 | 12 | 7 | 18 | 22 | 22 | 0 | 3 | 4 |
| PL 2-7 TD | 25 | 12 | 13 | 4 | 7 | 20 | 20 | 0 | 4 | 13 |
| Badugi | 25 | 13 | 12 | 7 | 18 | 23 | 23 | 0 | 3 | 4 |
| NL 2-7 SD | 25 | 12 | 13 | 2 | 7 | 25 | 25 | 0 | 0 | 18 |
| PL 5CD Hi | 25 | 12 | 13 | 10 | 17 | 25 | 25 | 0 | 0 | 8 |
| **All** | **500** | **249** | **251** | **101** | **258** | **459** | **459** | **33** | **26** | **182** |

- **Clean**: no finding of any kind. **Clean but for cents** counts a hand whose only finding is the one
  every cash hand with cents meets ("Cannot enter", 1); the clean hands are among them.
- **To the end**: the hand was carried through Save & Replay to the replay's End. **Chips right**: every
  seat then stood on PokerKit's stack, to the cent.

**Every hand that could be carried to the end replayed to PokerKit's chips: 459 of 459** (and 54 of 54,
38 of 38 on the committed corpus). The 41 that stopped: 18 at the pot-limit raise that was cut (cause 1),
13 at the 4th-street bet that cannot be entered ("Cannot enter", 3), 9 at a showdown card the screen
refuses ("Cannot enter", 4), 1 at a driver timeout (`PL 2-7 TD#11`, which passes when entered alone).

In all 500 hands, up to the point each one stopped, there was **no** finding about the seat to act, the
street, the pot, a stack, the price of a call, a limit bet or raise size (but for the open pair), the
bring-in or completion, the order of the draws' seats, or a round closing early or late.

What the 500 hands cover (the script takes the most telling first, then spreads over the kinds):

| Kind | Hands |
|---|---|
| Cash / tournament | 249 / 251 |
| Heads-up | 107 |
| Ended by a fold / went to a showdown | 52 / 448 |
| An all-in for less than the call | 300 |
| An all-in raise for less than a full raise | 155 |
| A player facing a short all-in that did not reopen the betting | 84 |
| A player facing a bet with nobody left who could call a raise | 84 |
| Pot-limit hands with a pot-sized bet or raise | 172 |
| Limit hands with a capped round | 105 |
| Stud hands with an open pair and a bet on 4th street | 13 |

## Disagreements, by root cause

**fail** = the hand could not be entered as played, or was saved wrong. **offer** = the screen offered
something PokerKit refuses, or showed a wrong figure; the corpus action could still be entered, and an
illegal hand could be too. "Seen on screen" = the screenshot of that decision was opened and read; the
files are listed at the foot.

The commands are one line each; `$SP` is set once under "How to rerun". A line without `--corpus` reads
the committed corpus. `--trace` prints every step.

Line numbers are `vite-app/src/components/HandReplayerView.jsx` as it stood when this was written. The
file was being edited while the audit ran (the numbers moved twice in an hour), so each is given with the
fragment to search for.

### 1. Pot-limit, before the flop, with a big-blind ante: the pot leaves the ante out, and a legal raise is cut down without a word (fail)

- **What the screen does.** The "Pot" button and the ceiling for a typed raise are worked out on a pot
  without the ante. A typed raise above that ceiling is recorded as the ceiling: the corpus raises to
  4,500, the script types it and presses Confirm, and the seat shows "RAISE 3,500". No message, no
  refusal. From there the stacks are wrong and the hand cannot be finished as played.
- **What PokerKit says.** The ante is in the pot. `PLO6 8/b#459`: small blind 500, big blind 1,000, ante
  1,000, so the pot is 2,500, 1,000 to call, and a pot-sized raise is to 4,500. The screen says
  "Pot 3500". Seen on screen, twice (c1000b `PLO6 8/b#459`; committed `PLO#0`: "RAISE 7,000" for the
  corpus's 9,000).
- **Smallest case.** The first action of the hand in both.

  **Mac or PC:**
  ```bash
  node scripts/check-replayer-entry-oracle.mjs --corpus "$SP/c1000b.jsonl" --build "$SP/build-entry-oracle" --ids "PLO6 8/b#459" --jobs 1 --trace
  node scripts/check-replayer-entry-oracle.mjs --build "$SP/build-entry-oracle" --ids "PLO#0" --jobs 1 --trace
  ```
- **How many.** 18 of the 175 pot-limit flop-game hands in the big run stopped here (PLO 1, PLO5 4,
  PLO6 2, PLO8 4, Big O 5, PLO6 8/b 2), and the Pot figure was wrong for this reason in 42 hands. In the
  corpus, 735 of the 1,924 pot-limit flop-game hands with a big-blind ante hold a preflop raise above the
  screen's ceiling (PLH 113, PLO 115, PLO5 115, PLO6 89, PLO8 113, Big O 93, PLO6 8/b 97); 588 of them
  are raises of exactly the pot. The prediction run: 21 of 21 such hands were cut, and 7 of 7 hands with
  an ante but no raise over the ceiling went through. On the committed corpus: `PLO#0`, `PLH#735`,
  `PLO#797`, `PLO5#73`, `PLO6#642`, `PLO8#899`, `Big O#52`, `PLO6 8/b#570`, `PLO6 8/b#251`.
- **Code.** 3170-3178: `// Pot-limit: ante does NOT count as part of the pot preflop, but DOES postflop`,
  then `plAnteAdjust`, `plEffectivePot = currentPot - plAnteAdjust`, `plRaiseToTotal`,
  `plMaxRaiseIncrement`, `plMaxBet`. The Pot button is 4601 (`Pot {formatChipAmount(`). The cut is the
  Confirm at 4619: `const amt = Math.min(Number(betAmount)||0, canCheck ? Math.min(plMaxBet, playerStack)
  : Math.min(plMaxRaiseIncrement, playerStack)); if (amt > 0) addAction(…)`.
- **My reading.** The rule is written down as a choice, but it is on its own: PokerKit counts the ante,
  and so does the app's own text quick add, whose comment says so in terms
  (`vite-app/src/utils/quick-add/betting.js:351-354`: "The replayer's entry form leaves a big-blind ante
  out of the pot-limit pot preflop … Rooms count it"). Two fixes, either of which ends the failure: count
  the ante in `plEffectivePot`; and never change a typed amount in silence (accept it, or refuse it and
  say what the most is). The second matters whichever rule the owner keeps. `findings.md` #23 is the same
  cut seen from the user's side.
- **Not tested.** The pot-limit draw games carry no ante in the corpus, so the same code was not
  exercised there; it is the same branch (`isBBante` is true for every game but stud).

### 2. The Result scores the hero's cards after the hero has folded, and the hero is saved as a winner (fail)

- **What the screen does.** "Continue to Result" works out the winners from the cards, and includes the
  hero's hand whether or not the hero folded. The Result grid lists only the players still in. Three
  shapes, all seen on screen:
  - the folded hero's hand is the best: the grid says "Auto-evaluated." and marks **nobody**
    (c1000b `NLH#128`). When the real winners are then tapped, the hero stays in the saved list: saved
    `[1, 3s, 4s]`, the corpus `[3s, 4s]` (the hero is seat 1). Saved without tapping, the hero is the only
    winner;
  - the folded hero ties the winner or holds the best of one half: a player who won outright is shown as
    "(Split)" (c1000b `PLH#998`: saved `[2s, 3s]`, the corpus `[3]`);
  - the board plays and everyone splits: the grid looks right, six opponents "(Split)", and the saved
    list has a seventh, the folded hero (committed `PLH#186`).
- **What PokerKit says.** A folded hand wins nothing and is not shown.
- **Smallest case.**

  **Mac or PC:**
  ```bash
  node scripts/check-replayer-entry-oracle.mjs --corpus "$SP/c1000b.jsonl" --build "$SP/build-entry-oracle" --ids "NLH#128" --jobs 1 --trace
  node scripts/check-replayer-entry-oracle.mjs --build "$SP/build-entry-oracle" --ids "NL 2-7 SD#65,PL 2-7 TD#77,PLH#186" --jobs 1 --trace
  ```
  (`NL 2-7 SD#65` and `PL 2-7 TD#77` are four-handed and mark nobody; `PLH#186` is the hidden seventh.)
- **How many.** In the big run 57 hands had the hero fold before a showdown; 52 were carried to the end
  and **15 of the 52 saved the hero as a winner** (8 of them with nobody marked): NLH 1, LHE 2, PLO5 1,
  PLO6 1, LO Hi 2, PLO8 2, O8 2, Big O 1, PLO6 8/b 2, Stud 8 1. The prediction run: 9 of 37. The
  committed corpus: 12 of 33 by id, 2 of 12 in the 3-per-game run (`NLH#526`, `NLH#675`, `PLH#899`,
  `LHE#856`, `LHE#183`, `PLO8#24`, `PLO8#26`, `LO Hi#908`, `O8#835`, `PLO6 8/b#318`, `2-7 TD#112`,
  `PL 2-7 TD#77`, `NL 2-7 SD#65`, `PLH#186`). So between a quarter and a third of such hands; the corpus
  has 2,427 of them in 20,000.
- **What it costs.** No chip: the replay settles from the cards, and all 15 replayed to PokerKit's
  stacks. What is wrong is the saved `result.winners`, which the share string writes out
  (`vite-app/src/utils/hand-shorthand.js:208-213`) and the export compares with its own settlement
  (`vite-app/src/utils/hand-history/prepare.js:557-559`, the `winners-from-cards` warning), and a Result
  screen that tells the user nobody won.
- **Code.** 3927: `const heroParsed = parseCardNotation(heroCardStr).filter(c => c.suit !== 'x');`, pushed
  into the hands to score with no test of whether the hero folded. The list of players shown,
  `showdownPlayers` at 3773, already leaves folded players out (`!foldedSet.has(o.idx)`), which is why
  the grid and the saved list disagree. The line "Auto-evaluated. " is 4032.
- **My reading.** One missing test: leave the hero's hand out of the evaluation when the hero is in
  `foldedSet`. `findings.md` #7 (a hand saved with no winner) and #11 are neighbours of this.

### 3. "All-in", pressed for a player who cannot cover the call, is saved as a raise; the round can then never close (fail, on that button only)

- **What the screen does.** In no-limit the All-in button records `raise <stack>` whenever there is a bet
  to call, also when the stack is no more than the call. The seat shows "RAISE 350" with 0 behind. Every
  player who had already acted is then asked to act again, and when the last of them has called, the
  screen asks for more action where the corpus deals the next cards: c1000b `NLH#44`, "the corpus: the
  Flop is dealt (9s9h9d); the screen: Opp 1 to act on Preflop [Check, Bet, All-in]"; committed
  `NL 2-7 SD#3`, the same before the draw. Both seen on screen.
- **Not every time.** Where a real raise follows, or everyone else is all in, the hand goes on and
  replays to the right chips, with a call saved as a raise (c1000b `NLH#0`: "RAISE 100.18" for a call of
  100.18; committed `NLH#2`, `NLO8#0`).
- **What PokerKit says.** Putting in a stack that does not exceed the bet faced is a call.
- **Smallest case.** The default run presses "Call X" for such a call and does not meet this;
  `--all-in-button` presses All-in.

  **Mac or PC:**
  ```bash
  node scripts/check-replayer-entry-oracle.mjs --corpus "$SP/c1000b.jsonl" --build "$SP/build-entry-oracle" --ids "NLH#44" --jobs 1 --all-in-button --trace
  node scripts/check-replayer-entry-oracle.mjs --build "$SP/build-entry-oracle" --ids "NL 2-7 SD#3" --jobs 1 --all-in-button --trace
  ```
- **How many.** 7 hands were run this way: 3 stopped, 4 were saved with a call as a raise. Every
  no-limit hand with an all-in for less than the call is exposed if the user reaches for All-in: 1,785 in
  the corpus (NLH 659, NLO8 656, NL 2-7 SD 470). In the big run all 47 such hands had the button on
  offer to that player (cause 4b).
- **Code.** 4634: `onClick={() => addAction(canCheck ? 'bet' : 'raise', playerStack)}`. 2893:
  `if (a.action === 'raise' || a.action === 'bet' || (a.action === 'all-in' && after > priceBefore))
  { lastRaiseIdx = i; lastRaiserPlayer = a.player; }`: a `raise` reopens the round whatever its size,
  while the `all-in` verb is tested against the price. 3194 does the same for the minimum raise.
- **My reading.** The button should record a call when `playerStack <= callAmount` (or record `all-in`,
  the one verb 2893 already tests). `findings.md` #24.

### 4. A raise is offered where PokerKit allows none (offer)

Nothing here stops a corpus hand. Each lets a hand be entered that no table would allow, and (b) is the
door into cause 3.

**a. Nobody is left who could call it.** A player faces a bet, everyone else still in is all in, and the
screen offers "Raise". 78 hands in the big run, in every family (limit too: c1000b `LO Hi#242` @s2a4,
"owes 0.53 with 64.22 behind … the screen offers [Fold, Call 0.53, Raise to 2.53]"; committed `NLH#12`
@s1a5, `NLH#281` @s0a17, `PLH#318` @s1a5). 2,459 hands in the corpus. Seen on screen. Code: none of the
three action bars (limit 4588, pot-limit 4600-4601, no-limit 4633-4634) asks whether an opponent has
chips.

**b. The player cannot cover the call.** 51 hands in the big run.
- No-limit: every one of the 47 hands with an all-in for less than the call. "Raise" and "All-in" are
  always shown: 4633-4634 carry no test of the stack (c1000b `NLH#0` @s0a1; committed `NLH#2` @s0a3,
  `NLH#32` @s0a3: "owes 3.45 with 3.45 behind … [Fold, Call 3.45, Raise, All-in]"). Seen on screen.
- Limit and pot-limit, with cents: the test is there (`playerStack > callAmount`, 4588 and 4600-4601) and
  is beaten by a float: the stack and the amount owed are sums of unrounded cents (3142-3145:
  `playerContrib`, `callAmount`, `playerStack`), so a stack equal to the call compares as a hair more.
  c1000b `O8#326` @s2a9 ("owes 2.69 with 2.69 behind … [Fold, Call 2.69, Raise to 14.69]") and
  `PLO#195` @s0a16 ("owes 47.7 with 47.7 behind … [Fold, Call 47.7, Raise, Pot 56.3]"). Both seen on
  screen.

**c. Over a short all-in that did not reopen the betting.** A player has acted, an all-in then raises
for less than a full raise, and when the action comes back the screen offers that player a raise. 59
hands in the big run (c1000b `NLH#916` @s0a10 and @s0a11, `LHE#42` @s1a7; committed `PLH#186`
@s0a10-13, `NLH#12` @s0a11, `PLO6#14` @s0a12, `NLO8#6` @s0a14). 710 hands in the corpus. Seen on screen.
Code: 2893 again, and no action bar has a "not reopened" state. In a limit game an all-in of half a bet
or more is left out of this count: the TDA reopens the betting there and PokerKit does not (see "Rule
choices").

**Mac or PC:**
```bash
node scripts/check-replayer-entry-oracle.mjs --corpus "$SP/c1000b.jsonl" --build "$SP/build-entry-oracle" --ids "LO Hi#242,NLH#0,O8#326,PLO#195,NLH#916" --jobs 1
node scripts/check-replayer-entry-oracle.mjs --build "$SP/build-entry-oracle" --ids "NLH#12,NLH#32,PLH#186" --jobs 1
```

### 5. After a short all-in, the smallest raise shown is too small (offer)

- **What the screen does.** The amount box opens on the smallest raise the screen knows. After an all-in
  that raised for less than a full raise it opens too low: c1000b `NLH#916` @s0a8, "the smallest raise
  puts in 55858 (to 56858); the amount box opens on 30642"; `Big O#85` @s2a4, 368.07 against 299.42;
  committed `NLH#2` @s0a8, 3,300 (to 5,150) against 2,700; `PLH#186` @s0a9, 2,250 (to 2,450) against
  1,800. Seen on screen.
- **What PokerKit says.** A short all-in does not change the size of the raise that must be made: the
  minimum stays the last full raise, on top of the new price.
- **How many.** 40 hands in the big run. All 40 hold an all-in raise for less than a full raise (155
  hands in the run do; the check fires only where a raise follows one). 2,368 hands in the corpus hold
  one.
- **Code.** 3194: `if (a.action === 'raise' || a.action === 'bet') { const newMax = _runContrib[a.player];
  _lastRaiseSize = Math.max(newMax - _prevMax, (hand.blinds || {}).bb || 0); _prevMax = newMax; }`: every
  raise, a short one too, becomes the size of the next. 3196-3197: `minRaiseToTotal`, `minRaiseIncrement`.
- **From the code only.** The no-limit Confirm takes any amount above zero up to the stack (4653:
  `const amt = Math.min(Number(betAmount)||0, playerStack); if (amt > 0)`), so a raise under the minimum
  can be entered. The script enters only legal corpus actions and did not try one. `findings.md` #23.

**Mac or PC:**
```bash
node scripts/check-replayer-entry-oracle.mjs --corpus "$SP/c1000b.jsonl" --build "$SP/build-entry-oracle" --ids "NLH#916" --jobs 1
node scripts/check-replayer-entry-oracle.mjs --build "$SP/build-entry-oracle" --ids "NLH#2" --jobs 1
```

### 6. The amount box opens on a figure with a tail of decimals (offer)

c1000b `Big O#85` @s2a4: the box opens on "299.41999999999996"; committed `NLO8#6` @s0a7:
"145.91000000000003". 27 hands in the big run, all cash. Seen on screen. Code: 3197,
`minRaiseIncrement = minRaiseToTotal - playerContrib`, unrounded, where the line above it (3193) already
uses `chipRound`. The same unrounded sums are behind 4b.

### 7. Pot-limit, the big blind's option with a short stack: the Pot label is not what the button puts in (offer)

Committed `PLO#48` @s0a6: the big blind has 7.18 behind and the button reads "POT 9.18"; pressed, it puts
in 7.18. c1000b `PLO#244` @s0a8: 1 behind, "Pot 601". Seen on screen. 9 hands in the big run. Code: 4601,
the label is `Math.min(canCheck ? plMaxBet : plRaiseToTotal, playerStack + playerContrib)`: with nothing
to call the figure is an amount to put in, so the cap should be `playerStack`, not the stack plus the
blind already posted. The amount recorded is right; only the label is off.

## Cannot enter

**1. A figure with cents, typed key by key.** Every cash hand in the big run (249 of 249); 9,003 hands in
the corpus. The blinds, the bets, the bring-in, the ante and every stack are stored as numbers on each
keystroke, so "0.5" reads "5" and "21.44" reads "2144" (`0.` is the number 0, which the field shows as
empty). A paste of the whole figure is taken, and that is what the script then does to go on; a thumb
cannot. The bet and raise amount box does take decimals. Code: 3028 (`[field]: field === 'startingStack'
? (Number(value) || 0) : value`), the setup fields at 3283-3288 (`Number(e.target.value)||0`), the stack
field at 3415. `findings.md` #20. Smallest case: committed `NLH#32` (three-handed, cash).

**2. Stud: a 7th-street card nobody saw.** A player dealt 7th street who folds there, or who mucks at the
end, never shows that card; the deal screen's Continue stays off until every player still in has one.
The script gives a spare card and goes on (the hand then replays right, and is saved with an invented
card). 3 hands in the big run (c1000b `Razz#907`, `Stud Hi#772`, `Stud 8#184`); committed `Stud 8#7`,
`Razz#12`, `Stud Hi#40`. In the corpus 183 of the 2,580 hands dealt 7th street (Stud Hi 58, Stud 8 61,
Razz 64). Seen on screen. Code: 4418, `disabled={enteredCount < sdActivePlayers.length}`.
`findings.md` #8.

**3. Stud, a pair showing on 4th street: only the big bet can be entered.** The corpus bets the small bet;
the screen offers "Bet" at the big bet alone, so the hand stops (c1000b `Stud 8#214` @s1a2: "bet 600; the
screen says "Bet 1200" [Check, Bet 1,200]"; committed `Stud Hi#6`, `Stud 8#16`, `Razz#28`, `Stud Hi#744`,
`Stud 8#477`). All 13 such hands in the big run stopped; 321 in the corpus (Stud Hi 87, Stud 8 118,
Razz 116). Seen on screen. Code: 476 `studHasOpenPairOn4th`, 3157-3160 (`stud4thOpenPair`, `flBetSize`),
applied to every stud game (`gameCfg.isStud`). The rule this follows is an OPTION, and in stud high only:
with an open pair on 4th street any player may bet either size. Razz and Stud 8 have no such rule. So
Stud Hi should offer both sizes, and the other two the small bet alone. PokerKit has no open-pair rule
at all. `findings.md` #18.

**4. A draw game: a card that came back after a reshuffle of the discards.** The screens treat every
discard as gone for the rest of the hand: the hero's new-cards field drops a card thrown away earlier
("4d is already discarded"), and at the showdown such a card is greyed out in the picker, with no way
round, so the hand stops. 10 hands in the big run (9 stopped at the showdown; c1000b `Badugi#18`,
`2-7 TD#64`, `PL 2-7 TD#20`); committed `2-7 TD#19`, `2-7 TD#23`, `2-7 TD#116`, `PL 2-7 TD#27`,
`PL 2-7 TD#62`, `Badugi#73`, `2-7 TD#5`. Seen on screen. In the corpus's 4,641 draw hands: 177 where an
opponent shows a card the hero threw away, 41 where the hero is dealt a card thrown away on an earlier
draw, 24 where the hero is dealt back a card thrown away in the SAME draw. That last one is how PokerKit
deals when the deck runs out, not something a room does (the round's own discards stay out of a
reshuffle); the other two happen at a full table. Code: `drawDeadCards` at 104 (116: `'already
discarded'`) and `sdUsedCards` at 3766. It is written as a guard against a mistyped card, and is right
until the deck runs out; the owner's call is whether a reshuffle is worth a way round it.

## Rule choices (settings and house rules, not bugs)

- **The pot-limit pot and the ante** (cause 1) is written in the code as a rule. PokerKit and the app's
  quick add count the ante. Listed as a failure because a legal hand cannot be entered and the amount is
  changed in silence.
- **Limit, an all-in of half a bet or more.** The TDA reopens the betting for players who have acted
  (Rule 47 in the 2019 numbering); PokerKit does not. The screen offers the raise. 18 notes in the big
  run, counted nowhere.
- **The cap.** The app's default is Cap 5, and "Uncapped heads-up" on, which the code applies on the last
  street only (3163-3168, a comment says this is deliberate). PokerKit plays a bet and three raises,
  always. The script types Cap 4 and switches the option off, so the cap was checked at PokerKit's
  number and held in every limit hand. With the app's defaults, the 2,566 corpus hands where the fourth
  bet is in and someone still acts would be offered one more raise.
- **The open pair on 4th street** ("Cannot enter", 3) is a real rule applied too widely and as a must.
- **A big-blind ante is dead money in the main pot, and a short big blind posts the blind before the
  ante.** The corpus and the app agree; nothing was found.

## Differences of representation (notes; none moves a chip)

Counts are hands in the big run.

- 203: the saved action carries another verb than the corpus's for the same chips.
- 115: the draw is declared seat by seat in another order than the corpus lists it.
- 102: the Result marks fewer winners than are paid (a side pot, or half a pot); 98: the saved winners
  list differs from the corpus's for that reason. The chips are right.
- 97: an opponent's discards and new cards have no place on the entry screens; 88: they are not in the
  saved hand; 61: a folded opponent's cards are not saved either.
- 75: stud seats carry hold'em position names; 62: a stud hand is saved with a small blind.
- 17: the saved cards differ (the invented 7th-street card; a draw card the screen refused).
- 8: the Result named no winner, and the corpus winners were tapped (all 8 are cause 2).
- 2: a tap had to be forced after 2.5 s (a busy machine). 1: the saved draws differ.
- Seen in passing: the draw's "Card Details" title names the round before (`findings.md` #26).

## What the driver does not prove

- **It enters only what the corpus did.** Every action is legal, so the screens' handling of an illegal
  typed amount was not probed, beyond reading what was on offer. The no-limit Confirm taking a raise
  under the minimum (cause 5) is from the code.
- **Two settings are changed** in a limit game: Cap is typed as 4 and "Uncapped heads-up" is switched
  off. The app's own defaults were not run.
- **Decimals are pasted.** After recording that a figure with cents cannot be typed, the script puts the
  figure in whole and goes on. Every cash hand's later checks rest on that.
- **Labels are made exact.** The app shows whole dollars and "2.4K"; the script overrides the formatter
  so cents can be compared. `--as-shown` leaves it alone and compares after rounding (3 hands, all right).
- **A hand stops at the first action whose chips differ**, so a second problem behind a first is not
  seen in that hand. The 41 stopped hands were not checked past that point.
- **Straddles are left out** (61 hands of the committed corpus; c1000b has none). The straddle setup was
  not driven.
- **Not entered:** opponents' discards and replacement cards, and the hole cards of a player who folded
  (the screens have no place for them). A 7th-street card nobody saw is invented. Where the Result marks
  nobody, the corpus winners are tapped.
- **An all-in call is entered with "Call X"** by default; `--all-in-button` takes the other path (7
  hands).
- **One driver timeout in 500 hands** (`PL 2-7 TD#11`, a click on the amount box that did not land in six
  seconds with five workers and other suites running). Entered alone it passes; the click now falls
  back to focusing the box.
- **Ids are per corpus.** The numbers in this report come from c1000b, which is in a scratch folder; the
  committed ids reproduce every cause but give other counts.
- **WebKit on Windows only.** Not run in the iOS Simulator or on the Mac.
- **The All-in run of four hands shared the big run's server** (see the aside). It changed nothing in
  either: each hand has its own user.

## An aside: two scratch suites at once can share one server

`test/helpers/scratch-server.js` looks for a free port by binding `127.0.0.1` (`freePort`, lines 26-36:
`s.listen(p, '127.0.0.1', …)`). `server.js:15425` listens on `0.0.0.0`. Windows lets the probe bind
`127.0.0.1:4860` while another server holds `0.0.0.0:4860`, so the helper calls the port free; the second
server then fails to listen, and since Express 5 calls the `listen` callback on an error as well, `boot`
resolves and the second run talks to the first run's server and database. It happened once here. The new
script probes `0.0.0.0` itself (`exclusive: true`) and hands the helper a one-port range. Any two suites
given the same range can meet this; a probe on `0.0.0.0` in the helper would end it.

## How to rerun

The script boots its own scratch server on 4860-4869, prints its pid first, and stops it when it ends, a
crash included. If the script itself is killed, stop that one process by its pid.

The corpus and the build were in a working folder on the PC (`<scratch>` below), not in the repo; the
corpus can be made again with `test/replayer-oracle/generate.py` (its README):

- `<scratch>\c1000b.jsonl`
- `<scratch>\build-entry-oracle`

Everything, as it was run (81 minutes):

**PC (PowerShell):**
```bash
cd D:\projects\scheduler
$SP = "<scratch>"
node scripts/check-replayer-entry-oracle.mjs --corpus "$SP/c1000b.jsonl" --per-game 25 --jobs 5 --build "$SP/build-entry-oracle"
```

**Mac:** (the scratch folder is on the PC: copy `c1000b.jsonl` and `build-entry-oracle` over first, and
run from the repo's root)
```bash
SP=/path/to/the/copied/folder
node scripts/check-replayer-entry-oracle.mjs --corpus "$SP/c1000b.jsonl" --per-game 25 --jobs 5 --build "$SP/build-entry-oracle"
```

With nothing but the repo: the committed corpus and the repo's own `public-vite` (no `--corpus`, no
`--build`).

**Mac or PC:**
```bash
node scripts/check-replayer-entry-oracle.mjs --per-game 25 --jobs 5
```

One hand, every step printed; the model alone (no browser, no server; it must print 0 warnings).

**Mac or PC:**
```bash
node scripts/check-replayer-entry-oracle.mjs --ids "PLO#0" --jobs 1 --trace
node scripts/check-replayer-entry-oracle.mjs --model-only
```

Every cause on the committed corpus, in one line.

**Mac or PC:**
```bash
node scripts/check-replayer-entry-oracle.mjs --ids "PLO#0,PLH#186,NL 2-7 SD#65,NLH#2,NLH#12,NLH#32,NLO8#6,PLO#48,Stud Hi#6,Razz#28,Stud 8#7,2-7 TD#19,2-7 TD#116" --jobs 2
node scripts/check-replayer-entry-oracle.mjs --ids "NL 2-7 SD#3" --jobs 1 --all-in-button
```

Other options: `--games "NLH,Razz"`, `--shots <folder>` (a screenshot at every finding and at the Result
and the replay's End), `--json <file>` (every finding, for a tally), `--as-shown`.

### The screenshots that were read

All under the session's scratch folder on the PC.

1. Cause 1: `<scratch>\entry-oracle\shots\PLO6_8_b_459-s0a0-the_amount_entered_was_changed.png`
2. Cause 1, committed: `<scratch>\entry-oracle\shots-k\PLO_0-s0a0-the_amount_entered_was_changed.png`
3. Cause 2, nobody marked: `<scratch>\entry-oracle\shots\NLH_128-result-the_Result_screen_marks_no_winner_the_hand_it_scored_best_is_a_folded_player_s.png`
4. Cause 2, a false split: `<scratch>\entry-oracle\shots-i\PLH_998-result.png`
5. Cause 2, committed: `<scratch>\entry-oracle\shots-k\PLH_186-result.png`
6. Cause 3: `<scratch>\entry-oracle\shots-f\NLH_44-stopped-s1_board.png`
7. Cause 3, committed: `<scratch>\entry-oracle\shots-n\NL_2-7_SD_3-stopped-s0_draw.png`
8. Cause 4a: `<scratch>\entry-oracle\shots\LO_Hi_242-s2a4-a_raise_is_offered_with_nobody_left_to_call_it.png`
9. Cause 4b, no-limit: `<scratch>\entry-oracle\shots\NLH_0-s0a1-a_raise_is_offered_to_a_player_who_cannot_cover_the_call.png`
10. Cause 4b, limit: `<scratch>\entry-oracle\shots\O8_326-s2a9-a_raise_is_offered_to_a_player_who_cannot_cover_the_call.png`
11. Cause 4b, pot-limit: `<scratch>\entry-oracle\shots\PLO_195-s0a16-a_raise_is_offered_to_a_player_who_cannot_cover_the_call.png`
12. Cause 4c: `<scratch>\entry-oracle\shots\LHE_42-s1a7-a_raise_is_offered_over_a_short_all-in_that_did_not_reopen_the_betting.png`
13. Cause 5: `<scratch>\entry-oracle\shots\NLH_916-s0a8-the_smallest_raise_shown_is_not_the_minimum.png`
14. Cause 6: `<scratch>\entry-oracle\shots\Big_O_85-s2a4-the_amount_box_shows_a_figure_with_a_long_tail_of_decimals.png`
15. Cause 7: `<scratch>\entry-oracle\shots-k\PLO_48-s0a6-the_pot-limit_figure_is_not_the_pot.png`
16. Cannot enter 2: `<scratch>\entry-oracle\shots\Razz_907-s4_deal-a_face-down_7th-street_card_nobody_saw_has_to_be_given.png`
17. Cannot enter 3: `<scratch>\entry-oracle\shots\Stud_8_214-s1a2-stud_an_open_pair_on_4th_street_only_the_big_bet_can_be_entered.png`
18. Cannot enter 4, the hero's draw: `<scratch>\entry-oracle\shots\Badugi_18-s2_draw-a_card_the_screen_will_not_take.png`
19. Cannot enter 4, the showdown: `<scratch>\entry-oracle\shots\2-7_TD_64-stopped-showdown.png`

The runs' own output (every finding of every hand) is beside them: `run-all.json` and `run-all.log` for
the big run, in
`<scratch>\entry-oracle\`.
