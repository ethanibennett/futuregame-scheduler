# Hand replayer audit: hand entry (2026-10-20)

The owner asked for "a 1000-hand sample in the replayer across all games to test the winner
evaluation and hand entry process against the mechanics of each game", with research on anything
unknown and a list of what needs clarification. This report covers **entry**; winner evaluation
is a separate report. Nothing in the app was changed: the harness lives outside the repo (see
"How this was run").

**In one paragraph.** 1,056 synthetic hands (32 for each of the 33 betting games) were played
through the real GTO entry form, the hand-history writer and parser, share links and quick add's
gap rules. Most findings come from about a dozen root causes. The writer and the importer are
sound: every exportable hand round-tripped. The entry form is not. Its worst defects:

- After an all-in bet or raise it asks the wrong player to act.
- It ranks stud boards wrongly. Any unpaired board outranks a pair, and razz counts the ace high.
- NL and PL razz use high-game bring-in rules.
- It runs the first draw in preflop order.
- OFC entry crashes.
- The game picker creates the wrong game for 17 of its rows.

## 1. How a hand gets in

| Path | Code | Status | What was tested |
|---|---|---|---|
| **GTO entry form** (setup → hero cards / door cards → action → board, stud deal or draw → showdown → result) | `vite-app/src/components/HandReplayerView.jsx` `GTOEntryView` (2619-4472) with the module helpers `getActionOrder`, `calcPotsAndStacks`, `findStudBringIn`, `findStudBestBoard`, `scoreStudBoard`, `studHasOpenPairOn4th`, `getStraddles`, `createEmptyHand`, `computeDrawHand`, `drawDeadCards` | **The live path**: the Form/Text and GTO/Classic toggles are hidden (`SHOW_ENTRY_MODE_TOGGLES = false`, line 1734) | All 1,056 hands, driven through its own buttons in WebKit |
| Game picker (New Hand) | same file, `structureGameMap` / `handleGameSelect` / `startNewHand` (4527-4612, 4659-4685, 4828-4871) | live | Every non-standard row, in the real app on a scratch server |
| Classic form | `HandReplayerEntry` (2286-2615) | hidden | Code read only |
| Text tab (shorthand parser) | `vite-app/src/utils/hand-text-parser.js` | hidden | Not tested |
| Quick add (admins): describe the hand → server parse (LLM, `lib/quick-add/normalize.js`) → gap questions → form | `QuickAddView.jsx`, `vite-app/src/utils/quick-add/*` (`gaps.js`, `actions.js`, `betting.js` = a port of the replayer's betting) | live | The deterministic half: `findGaps` on every hand; the fast path `lib/quick-add/hh.js` on the writer's text. The LLM parse was not called. |
| Hand-history export / import (PokerStars format) | `vite-app/src/utils/hand-history/` (writer, uses `quick-add/betting.js` `Table`), `lib/hh-import/pokerstars.mjs` | live | Every hand: `checkExportable` → `writePokerStarsHand` → `parseHandHistory` → `canonicalHand` compared with the writer's own model |
| Share link `#h/…` | `vite-app/src/utils/hand-shorthand.js` `encodeHand` / `decodeHand` | live | Every hand: encode → decode → compare |

**Games** (`HAND_CONFIG`, `vite-app/src/utils/utils.js` 251-290; copied in `quick-add/game.js`): NLH,
LHE, PLH, PLO, PLO8, O8, LO Hi, Big O, PLO5, PLO6, PLO6 8/b, NLO8, Short Deck; Stud Hi, Stud 8,
Stud Hi-Lo, Razz, 2-7 Razz, NL Stud Hi, NL Stud 8, NL Razz, PL Stud Hi, PL Stud 8, PL Razz; 2-7 TD,
L 2-7 TD, PL 2-7 TD, A-5 TD, Badugi, Badeucy, Badacy, NL 2-7 SD, PL 5CD Hi; and OFC and
OFC Pineapple, which have no betting. Those two were checked separately (D5, D24).

## 2. Sample

- **1,056 hands.** That is 32 per betting game × 33 games, from a seeded generator (mulberry32, seed
  `(gameIndex+1)*10007 + i*7919`).
- **Rule engine.** Every hand is legal under a reference rule engine written for this audit, following the
  rules cited in §5. Where a house rule is open, the engine follows the app's stated intent so that it
  is not counted as a defect; those cases are in §5 instead.
- **Table sizes.** Heads-up through 10-handed. Big-bet Omaha is capped by the deck (PLO6 at 7-handed),
  stud at 7, triple draw at 6.

| Mechanic | Hands | Mechanic | Hands |
|---|---|---|---|
| heads-up | 196 | all-in (any) | 516 |
| 3-5 handed | 342 | all-in raise / bet | 275 |
| 6-max | 175 | call for less (all-in) | 379 |
| 7-8 handed | 265 | incomplete all-in raise | 100 |
| 9-max / 10-handed | 46 / 32 | side pots | 343 |
| big-blind ante | 303 | uncalled bet returned | 257 |
| straddle (UTG, button, Mississippi, UTG+button) | 62 | blind posted all-in | 29 |
| stud ante + bring-in | 352 | 4th-street open pair | 63 |
| draw rounds | 227 | drawing every card | 50 |
| no-limit / pot-limit / limit | 224 / 384 / 448 | showdown | 772 |

**Two passes per hand.**
1. **The real entry form, in Playwright WebKit.** `GTOEntryView` was bundled from this worktree and
   mounted with the hand's cards pre-filled. A driver then plays the reference action script through
   the form's own buttons. At every decision it checks:
   - which seat the form marks active;
   - the Call amount;
   - whether Bet/Raise is offered;
   - the fixed-limit sizes;
   - the NL/PL slider minimum and maximum;
   - the pot shown;
   - what was recorded;
   - draw order and draw counts;
   - every phase change.

   **A hand stops at its first divergence that changes the action** ("fatal"). So a column further
   right can read "pass" because the hands never got that far. The stud rows are the clearest case.
2. **Node.** The hand, in exactly the shape the form saves it, goes through:
   - the writer, the parser and `canonicalHand`;
   - the share-link encoder and decoder;
   - quick add's `findGaps`;
   - quick add's fast path `lib/quick-add/hh.js` (flop games).

There are also targeted checks:
- in the bundled form: OFC, OFC Pineapple, the Super/Action modifiers, the 7th-street deal, the open
  pair, under-call raises, raising a bring-in;
- in the real app on a scratch server (port 4860, a copy of `scratch2.db`, user 1): the game picker.

## 3. Results by game and mechanic

**Columns.**
- **UI hands**: the 32 hands driven through the real form.
- **completed**: hands that reached "Save & Replay".
- **clean**: hands with no finding at all.
- **The FAIL columns** count hands with at least one finding in that mechanic.

| Game | UI hands | completed | clean | Forced bets & pot | Who acts next | Bet sizes, caps, options | Draws | HH export round trip | Share link | Quick add gaps |
|---|---|---|---|---|---|---|---|---|---|---|
| NLH | 32 | 21 | 5 | **FAIL 2/32** | **FAIL 18/32** | **FAIL 6/32** | n/a | same 32 | **FAIL 9/32** | pass |
| LHE | 32 | 29 | 25 | pass | **FAIL 4/32** | **FAIL 3/32** | n/a | same 32 | **FAIL 32/32** | pass |
| PLO | 32 | 27 | 19 | **FAIL 1/32** | **FAIL 4/32** | **FAIL 12/32** | n/a | same 32 | **FAIL 6/32** | pass |
| PLO8 | 32 | 23 | 10 | **FAIL 3/32** | **FAIL 10/32** | **FAIL 16/32** | n/a | same 32 | **FAIL 2/32** | pass |
| O8 | 32 | 29 | 21 | **FAIL 1/32** | **FAIL 6/32** | **FAIL 6/32** | n/a | same 32 | **FAIL 32/32** | pass |
| Big O | 32 | 19 | 12 | pass | **FAIL 13/32** | **FAIL 12/32** | n/a | same 32 | **FAIL 6/32** | pass |
| PLO5 | 32 | 22 | 11 | **FAIL 1/32** | **FAIL 14/32** | **FAIL 11/32** | n/a | same 32 | **FAIL 4/32** | pass |
| PLO6 | 32 | 25 | 15 | **FAIL 2/32** | **FAIL 9/32** | **FAIL 12/32** | n/a | same 32 | **FAIL 8/32** | pass |
| PLO6 8/b | 32 | 25 | 15 | **FAIL 2/32** | **FAIL 9/32** | **FAIL 9/32** | n/a | same 32 | **FAIL 6/32** | pass |
| NLO8 | 32 | 26 | 7 | **FAIL 1/32** | **FAIL 16/32** | **FAIL 3/32** | n/a | same 32 | **FAIL 4/32** | pass |
| Short Deck | 32 | 22 | 10 | pass | **FAIL 14/32** | **FAIL 2/32** | n/a | not exported (by design) | **FAIL 3/32** | pass |
| Razz | 32 | 8 | 7 | pass | **FAIL 25/32** | **FAIL 1/32** | n/a | same 30, **no-winner 2** | **FAIL 32/32** | pass |
| Stud Hi | 32 | 18 | 15 | pass | **FAIL 17/32** | pass¹ | n/a | same 32 | **FAIL 32/32** | pass |
| Stud 8 | 32 | 18 | 17 | pass | **FAIL 15/32** | pass¹ | n/a | same 32 | **FAIL 32/32** | pass |
| 2-7 TD | 32 | 30 | 12 | **FAIL 2/32** | **FAIL 8/32** | **FAIL 1/32** | **FAIL 17/32** | same 32 | **FAIL 32/32** | pass |
| NL 2-7 SD | 32 | 28 | 9 | **FAIL 1/32** | **FAIL 9/32** | **FAIL 3/32** | **FAIL 14/32** | same 32 | **FAIL 4/32** | pass |
| Badugi | 32 | 31 | 9 | pass | **FAIL 3/32** | **FAIL 2/32** | **FAIL 23/32** | same 32 | **FAIL 32/32** | pass |
| A-5 TD | 32 | 32 | 9 | pass | **FAIL 2/32** | **FAIL 3/32** | **FAIL 22/32** | not exported (by design) | **FAIL 32/32** | pass |
| PLH | 32 | 23 | 10 | **FAIL 2/32** | **FAIL 10/32** | **FAIL 15/32** | n/a | same 32 | **FAIL 3/32** | pass |
| Stud Hi-Lo | 32 | 15 | 14 | pass | **FAIL 18/32** | pass¹ | n/a | **renamed 32** (game) | **FAIL 32/32** | pass |
| LO Hi | 32 | 29 | 21 | pass | **FAIL 5/32** | **FAIL 7/32** | n/a | same 32 | **FAIL 32/32** | pass |
| PL 2-7 TD | 32 | 28 | 4 | pass | **FAIL 10/32** | **FAIL 6/32** | **FAIL 22/32** | same 32 | **FAIL 2/32** | pass |
| L 2-7 TD | 32 | 31 | 9 | pass | **FAIL 6/32** | **FAIL 4/32** | **FAIL 20/32** | **renamed 32** (game) | **FAIL 32/32** | pass |
| Badeucy | 32 | 31 | 6 | pass | **FAIL 3/32** | **FAIL 3/32** | **FAIL 24/32** | not exported (by design) | **FAIL 32/32** | pass |
| Badacy | 32 | 31 | 9 | pass | **FAIL 2/32** | **FAIL 4/32** | **FAIL 20/32** | not exported (by design) | **FAIL 32/32** | pass |
| PL 5CD Hi | 32 | 28 | 9 | **FAIL 1/32** | **FAIL 4/32** | **FAIL 6/32** | **FAIL 18/32** | same 32 | **FAIL 5/32** | pass |
| 2-7 Razz | 32 | 10 | 9 | pass | **FAIL 23/32** | pass¹ | n/a | not exported (by design) | **FAIL 32/32** | pass |
| NL Stud Hi | 32 | 13 | 4 | pass | **FAIL 17/32** | **FAIL 9/32** | n/a | not exported (by design) | **FAIL 32/32** | pass |
| NL Stud 8 | 32 | 14 | 5 | pass | **FAIL 15/32** | **FAIL 10/32** | n/a | not exported (by design) | **FAIL 32/32** | pass |
| NL Razz | 32 | 0 | 0 | pass | **FAIL 32/32** | pass¹ | n/a | not exported (by design) | **FAIL 32/32** | pass |
| PL Stud Hi | 32 | 11 | 10 | pass | **FAIL 13/32** | **FAIL 10/32** | n/a | not exported (by design) | **FAIL 32/32** | **FAIL 11/32** |
| PL Stud 8 | 32 | 7 | 2 | pass | **FAIL 20/32** | **FAIL 13/32** | n/a | not exported (by design) | **FAIL 32/32** | **FAIL 9/32** |
| PL Razz | 32 | 0 | 0 | pass | **FAIL 31/32** | **FAIL 1/32** | n/a | not exported (by design) | **FAIL 32/32** | **FAIL 6/32** |
| OFC | (targeted) | crash | | | | | | not exported | | |
| OFC Pineapple | (targeted) | runs as NL hold'em | | | | | | not exported | | |

¹ Stud hands mostly stopped on 4th street at the wrong first actor (D2), before any 4th-street sizing could be checked. The targeted open-pair check fails all three games it was run on (D9).

**Totals.**
- **Entry form:** 704 of 1,056 hands completed end to end; 340 had no finding at all.
- **Writer and parser:**
  - 702 hands exported, and all of them parsed back identical to the writer's own model.
  - 638 kept their game name.
  - 64 came back under a sister game name (D20).
  - 2 Razz hands could not be exported: their showdown hand has a pair, which the low evaluator
    leaves unscored. That is cross-referred to the winner-evaluation report (D23).
  - The writer replays each hand's betting on quick add's `Table` and refuses any turn or amount that
    does not add up. It accepted every hand, so its turn logic agrees with the rules in all 702.
- **Quick add:** `findGaps` raised no false gap on any valid hand except the pot-limit stud minimum
  bets (Q11).
- **Quick add's fast path** agreed with the importer on game and actors in all 384 flop-game hands
  it reads.

### By mechanic

| Mechanic | Verdict | Defects |
|---|---|---|
| Blinds, BB ante, stud ante | FAIL (pot) when a forced bet exceeds the stack; otherwise pass | D16 |
| Straddles (UTG, button, Mississippi, two at once) | order **pass**; min-raise FAIL; share link FAIL | D11, D19 |
| Bring-in and completing | pass for limit Stud Hi/8; FAIL for NL/PL razz, 2-7 razz; NL/PL raise of the bring-in impossible | D3, D13 |
| Stud first to act, 4th-7th street | **FAIL** (any unpaired board outranks a pair; razz counts the ace high) | D2 |
| Stud 4th-street open pair | **FAIL** (big bet forced; no small-bet option; applied to Stud 8 and Razz too) | D9 |
| Stud 7th street (down card) | **FAIL**: the form will not continue without every Opponent's face-down card | D14 |
| Preflop and postflop order, heads-up, 3-handed, full ring | pass, **except after an all-in bet or raise** | D1, D15 |
| NL minimum raise | FAIL after straddles; under-call "raises" accepted | D11, D12 |
| PL maximum | FAIL preflop with a BB ante (the ante is left out); postflop pass | Q1 |
| Fixed-limit sizes | pass; **cap FAIL preflop and pre-draw** (one raise too many) | D8 |
| Incomplete all-in raise | FAIL: re-opens raising for players who already acted | D10 |
| Side pots and uncalled bets | writer pass (settles layers, returns uncalled bets); the entry form's pot never returns an uncalled bet | D16 |
| Street transitions (flop/turn/river, stud deal, draw → bet) | pass in all games except OFC (crash) and the 7th-street deal | D5, D14 |
| Draw order | **FAIL** on the first draw (preflop order used) | D4 |
| Cards drawn | FAIL: Badeucy and Badacy cannot draw five | D17 |
| Hole-card counts (2/4/5/6, stud 3+1+1+1+1, draw 4/5) | pass (the pickers stop at the game's count) | — |
| Short deck (36-card picker, no 2-5) | pass | — |
| Game choice in the picker | **FAIL** for 17 rows (PLO, PL and limit variants, 2-7 Razz, single draws, etc.) and the Super/Action modifiers | D6, D7 |

## 4. Defects

Severity: **High** means a hand is entered wrong or cannot be entered. **Medium** means the form
allows or offers something illegal, or gets a number wrong. **Low** is cosmetic or an edge case.
Line numbers are for this branch (`84df90d`).

### D1 (High): after an all-in bet or raise, the form asks the wrong player to act (every game)
- **Hand.** NLH, 3-handed, 100/200, all 10,000 except the BB on 2,000. Preflop: BTN calls, SB calls,
  BB checks. Flop: SB checks, BB bets all-in 1,800.
  - **Expected:** BTN acts next (the action moves clockwise from the bettor).
  - **Got:** the form asks the SB again, who has already checked. The BTN is asked last.
- **In the sample.** 92 of the 1,056 hands, in 27 games, stopped here. The nearest-sample cases are
  `NLH 65440` (turn: UTG+1 shoves; the form asks the BB before MP2 and LJ) and `Big O 60042`.
- **Rule.** Action moves clockwise from the last player to act. TDA Rule 49-A and 50 assume it, and
  so does every published game rule.
- **Code.** `currentActor`, HandReplayerView.jsx 2738-2756:
  - It starts the search at the seat after the last raiser in `actionOrder`.
  - `actionOrder` drops all-in seats (2711).
  - So once the raiser is all-in, `indexOf` returns -1 and the search starts at `actionOrder[0]`.
  - Quick add's port records this as "one deliberate difference" (`quick-add/betting.js` lines 14-18)
    and does it correctly (`Table.nextToAct`). The form was never fixed.

### D2 (High): stud boards are ranked wrongly, so the wrong player opens 4th to 7th street
- **Hands.**
  - **Stud Hi, 4th street.** P0 shows As Kd; P1 shows 9c 9d. Expected: P1 (the pair). Got: P0.
  - **Razz, 4th street.** P0 shows As 2d; P1 shows Kc Qd. Expected: P0 (A-2 is the best low).
    Got: P1.
  - **Razz.** A paired board (4-4) is chosen to open over 8-7. A pair is the worst razz board.
- **In the sample.** Stud Hi 13, Stud 8 13, Stud Hi-Lo 16, Razz 21 and 2-7 Razz 22 hands; NL/PL stud
  likewise. 2-7 Razz also has a bring-in problem (D3).
- **Rule.** In stud the highest hand showing opens from 4th street; in razz the lowest, with aces low
  and pairs bad. Sources: the Park West Casino rules filed with the California Attorney General
  ("If the High (Low in Razz) hand on board…", Seventh Street Action, rule 1); PokerNews Razz rules.
- **Code.** `scoreStudBoard` (417-440) gives a high-card board
  `1,000,000 + rank × 100^(4-i)`. For an ace that is 1.4 billion, which is above every pair (3
  million), trips (5 million) and quads (7 million). So in a high game any unpaired board outranks a
  pair, and in a low game any pair "beats" an unpaired board.
- **Code, razz.** `findStudBestBoard` (442-464) scores razz boards with the ace as 14.
- **Code, ties.** A pair is compared on only one kicker (`kickers[0]`).
- **Also affected.** The same functions are copied into `quick-add/betting.js`
  (`scoreStudBoard`, `findStudBestBoard`). There they only matter when a description omits the first
  actor.

### D3 (High): NL Razz and PL Razz use high-game bring-in and order; 2-7 Razz counts the ace low
- **Hands.**
  - **NL Razz, 3rd street.** Doors 2s and Kc. Expected: the Kc brings it in. Got: the 2s.
    32 of 32 NL Razz hands and 31 of 32 PL Razz hands failed on 3rd street.
  - **2-7 Razz.** Doors As and Kc. Expected: the As brings it in (aces are high in deuce-to-seven).
    Got: the Kc.
- **Rule.** In razz the highest door card brings it in and the lowest board opens later streets
  (PokerNews Razz rules; Park West). In 2-7 lowball the ace is a high card.
- **Code.** `isRazz` (line 2677) is `Razz || 2-7 Razz`. The NL/PL razz names are missing; quick add's
  `isLowStud` (`quick-add/game.js`) already has them. `findStudBringIn` (389-415) and the board
  ranking (D2) treat every low stud game as ace-low. The commentary uses its own copy of the test
  (line 1122).

### D4 (High): the first draw is taken in preflop order
- **Hands.**
  - **2-7 TD, 6-handed, everyone in after the first betting round.** Expected draw order: SB, BB,
    UTG, … BTN. Got: UTG first, then round to the BB.
  - **Heads-up.** Expected: the BB draws first. Got: the button.
- **In the sample.** It shows in every draw game: 14 to 24 of 32 hands in each.
- **Rule.** Drawing starts with the first active player to the left of the button and ends on the
  button (pokerology, 2-7 triple draw; the writer itself writes draws in that order,
  `prepare.js` `drawsFor`, "postflop order").
- **Code.** Draw phase, line 3894: `drawActivePlayers = seatOrder.filter(…)`. `seatOrder` is
  `getActionOrder(…, isPreflop)`, and `isPreflop` is true while `currentStreetIdx` is 0, which is
  when the first draw is declared.

### D5 (High): OFC entry crashes
- **Hand.** New hand → OFC → Next.
  - **Expected:** the card placement screen.
  - **Got:** "Rendered more hooks than during the previous render", and the entry form unmounts.
- **Code.** `const [ofcPickerState, setOfcPickerState] = useState(null)` inside
  `if (phase === 'ofc_entry')` (line 3304). That is a hook called conditionally, which breaks the
  Rules of Hooks.

### D6 (High): the game picker creates a different game from the one its label names
Confirmed in the real app (scratch server, Hands → New Hand). Each row below is what "Create …
Hand" produced:

| Picker row / structure | Label | Game created | What is wrong |
|---|---|---|---|
| Omaha / No Limit | No Limit Omaha | `PLO` | pot-limit betting |
| Omaha / Limit | Limit Omaha Hi | `O8` | a **hi-lo** game. `LO Hi` exists but is never chosen |
| Big O / No Limit, Big O / Limit | No Limit / Limit Big O | `Big O` | pot-limit betting |
| 2-7 Razz | 2-7 Razz | `Razz` | ace-to-five razz. `2-7 Razz` exists |
| Razzdugi, Razzdeucy (Stud tab) | Razzdugi / Razzdeucy | `Badugi` / `Badeucy` | draw games with draw streets, not stud |
| 2-7 Single Draw / Pot Limit, / Limit | Pot Limit / Limit 2-7 Single Draw | `NL 2-7 SD` | no-limit betting |
| A-5 Single Draw | No Limit A-5 Single Draw | `A-5 TD` | three draws, fixed limit |
| 5-Card Draw / No Limit, / Limit | No Limit / Limit 5-Card Draw | `PL 5CD Hi` | pot-limit betting |
| Badugi / No Limit (and Pot Limit) | No Limit Badugi | `Badugi` | fixed limit |
| Archie 66, Archie 99, Ari | Archie 66 … | `Badugi` | four cards, badugi ranking |
| Pineapple | No Limit Pineapple | `NLH` | two hole cards; the discard is not modelled |
| Courchevel | Courchevel | `PLO` | four cards, no early flop card |
| Double Board Bomb Pot | Bomb Pot | `PLO` | one board, normal blinds |
| Dramaha Hi / 2-7 / 49 / 0, Dramadugi, Omajack | Pot Limit Dramaha Hi … | `PLO` | four cards, no draw, no split |
| Stud Hi/Lo Regular | Stud Hi/Lo Regular | `Stud 8` | probably intended (Q6) |

Code: `structureGameMap` (4527-4559). The "dimmed" structures in the picker still create a hand
(`handleStructureChange` only refuses the games in `FIXED_STRUCTURE`).

### D7 (High): the Super and Action stud modifiers create games the entry form does not know
- **Hands.**
  - **Action Razz** (Razz with the Action box ticked). The setup asks SB, BB and BB ante. 3rd street
    offers "Fold / Call 200 / Raise / All-in", which is no-limit hold'em.
  - **Super Stud Hi / Super Razz.** The setup shows stud fields, but Next skips hero cards and door
    cards and offers "Check / Bet / All-in" on 3rd street: no bring-in, no-limit.
- **Code.**
  - `startNewHand` prefixes `Action ` and `Super ` (4861-4862).
  - `GTOEntryView` looks up `HAND_CONFIG[hand.gameType]` and falls back to `HAND_CONFIG_DEFAULT`
    (NL hold'em) at line 2651. It never strips the prefix.
  - `getGameCategory` strips `Super ` but not `Action `, so Action Razz is "community".

### D8 (Medium): the limit cap allows one raise too many preflop and pre-draw
- **Hand.** LHE 100/200, cap 4 (the app's "a street allows 4 bets").
  - The table shows UTG raise to 400, MP 3-bet to 600, CO 4-bet to 800. That is four bets with the
    blind.
  - **Expected:** the BTN can only fold or call.
  - **Got:** "Raise to 1,000" is offered.
- **In the sample.** Together with D10, a raise was offered where the rules allow none in 1 to 7
  hands per limit game (`LHE 154637` and `LHE 241746` are cap cases).
- **Rule.** TDA Rule 50: there is a cap on raises in limit. The big blind is the opening bet of the
  first round. The stud note on the form itself says "a street allows {betCap} bets".
- **Code.** `streetBetRaiseCount` counts only `bet` and `raise` actions (line 2985), and
  `flCanRaise = … || streetBetRaiseCount < flRaiseCap` (3000). The big blind is never counted.
  (On 3rd street in stud the completion is a `bet`, so stud is right.)

### D9 (Medium): the 4th-street open pair forces the big bet, and applies in every stud game
- **Hand.** Stud Hi, then Stud 8, then Razz, all 200/400. On 4th the players show 9c 9d and 5c 5d.
  - **Got, in all three:** "Check / Bet 400".
  - **Expected, Stud Hi:** the opener may bet 200 or 400.
  - **Expected, Stud 8 and Razz:** 200 only.
- **Rule.** Park West, Third-Sixth Street Action rule 8: "the player initiating a bet has the option of
  betting the lower or upper limit … This rule applies in High only."
- **Code.**
  - `flBetSize` (2990-2992) uses the big bet whenever `studHasOpenPairOn4th` (466).
  - There is no game test, and no small-bet alternative. Quick add's `Table` models the option
    (`fixedAlt`, betting.js 296-299).

### D10 (Medium): an all-in for less than a full raise re-opens the raising
- **Hand.** NLH 100/200.
  - **Action:** CO raises to 600. BTN calls. SB folds. BB moves all-in for 700 (100 more: not a full
    raise). Back to the CO.
  - **Expected:** the CO and the BTN may only call 100 or fold.
  - **Got:** "Raise" and "All-in" are offered.
- **Limit too.** An all-in for under half a bet re-opens there as well.
- **In the sample.** 1 to 7 hands per game (`NLH 168387`; `LO Hi`, `O8` and the triple draws).
- **Rule.** TDA Rule 49-A: an all-in wager totalling less than a full bet or raise does not re-open
  the betting to a player who has already acted. TDA 49-B: in limit, at least 50% of a full bet is
  needed.
- **Code.** Any `raise` resets `currentActor`'s round (2741-2745), and the raise buttons do not look at
  re-opening. `Table.apply` in quick add tracks it (but see D22).

### D11 (Medium): the minimum raise ignores straddles
- **Hand.** NLH 100/200 with a UTG straddle of 400. UTG+1 raises to 600 (a raise of 200 over the
  straddle).
  - **Expected minimum re-raise:** to 800 under the "raise the last increment" rule the app otherwise
    uses. Under the "twice the straddle" convention it would be 800 too, and 600 would not have been a
    legal raise (Q2).
  - **Got:** the slider's minimum is 1,000.
- **More cases.** `NLH 10007`: 2,500 for 2,300, then 5,490 for 5,890 after a Mississippi straddle.
- **Code.** The min-raise tracker seeds `_prevMax` with the big blind and leaves straddles out of
  `_runContrib` (3013-3024). It also ignores `all-in`. Quick add's `Table.startStreet` handles
  straddles (`lastRaise = max(bb, maxBet - prevLevel)`), so the two disagree.

### D12 (Medium): no-limit and pot-limit amounts are not validated
- **Hand.** NLH 3-handed 100/200. The BTN taps Raise, types 50 and confirms.
  - **Got:** a "raise" of 50, less than the 200 call, is recorded. The SB is then asked to call 100.
  - **Also accepted:** a bet below the big blind, and a raise below the minimum (when not all-in).
- **Rule.** TDA Rules 42-43 (minimum bet and raise). A raise must at least match the call.
- **Code.** Confirm checks only `amt > 0` (4378 PL, 4412 NL). The slider has a minimum, but the
  typed field does not.

### D13 (Medium): NL and PL stud cannot raise the bring-in beyond a completion
- **Hand.** NL Stud Hi. The 2c brings it in for 50; the next player taps "Raise".
  - **Got:** nothing happens. No amount field is shown, so only Call or Complete 200 can be entered.
  - **In the sample:** 6 to 9 hands per NL/PL stud game.
- **Code.** The bring-in branch (4335-4342) sets `showRaiseInput`. The amount field only renders in
  the PL/NL branches, which this branch replaces.

### D14 (Medium): 7th street demands every Opponent's face-down card
- **Hand.** Stud Hi, three players to 7th. Only the hero's own 7th card is known.
  - **Expected:** continue; the Opponents' cards are face down.
  - **Got:** "Continue" stays disabled until a card is picked for every Opponent.
- **Code.** The stud deal phase: `disabled={enteredCount < sdActivePlayers.length}` (4179). The same
  rule is used for 4th to 6th street, where the cards are face up, so it is right there.

### D15 (Low-Medium): a lone player with chips is asked to act on later streets
- **Hand.** NLH. Two players all-in preflop, called by a bigger stack.
  - **Expected:** no more betting; deal the board out.
  - **Got:** on the flop, turn and river the caller is asked "Check / Bet / All-in".
- **In the sample.** It shows in 1 to 10 hands per game. In the bulk run the driver pressed Check
  to carry on, so the saved hand gains meaningless checks.
- **Code.** `currentActor` has no "everyone else is all-in" test. Quick add's
  `Table.needsToAct` has one (`canAct().length <= 1`).

### D16 (Medium): the entry form's pot and stacks do not cap forced bets at the stack, and never return an uncalled bet
- **Hand.** NLH 100/200 with BB ante 200. The BB's stack is 250. Preflop, before any action:
  - **Expected:** the BB posts 200, then the ante takes the last 50. The pot is 350 (the writer's
    order: blind first, then the ante from what is left).
  - **Got:** the pot reads 500 and the BB's stack reads -150.
- **The same with straddles.** A Mississippi straddle of 800 from a 300 stack adds 800 to the pot
  (`PLO 125049`, `PLO6 8/b 216767`).
- **In the sample.** 19 hands, all on the first street.
- **Code.**
  - `calcPotsAndStacks` (1053-1087) and `streetBets` (2712-2737) subtract each blind, ante and
    straddle in full.
  - `getStraddles` (327-346) prices straddles with no stack check.
  - There is no uncalled-bet return, so a bet nobody called stays in the pot shown on later streets.
  - The writer gets all of this right (`ExportTable`, uncalled returns), so the export and the
    entry form show different pots.

### D17 (Low): Badeucy and Badacy cannot draw five
- **Hand.** Badeucy. A player throws all five cards.
  - **Expected:** a "5" button.
  - **Got:** buttons 1 to 4 only.
- **In the sample.** 8 and 3 hands.
- **Code.** Line 3919: `isBadugi = ['Badugi','Badeucy','Badacy'].includes(…)` → `maxDiscard = 4`.
  Badeucy and Badacy are five-card games (`heroCards: 5`).

### D18 (Low): "Raise" and "All-in" are offered to a player who cannot cover the call
- In no-limit the "All-in" button records a `raise` of the whole stack even when it is less than the
  call. That then sets off D1 and D10. It appeared in 10 to 20 hands per NL game.
- **Code.** Line 4393. Use `call` when `playerStack <= callAmount`.

### D19 (Medium): share links lose stacks after a straddle, and drop the limit and stud structure
- **Hand.** NLH 7-handed, 100/200/200 BB ante, a Mississippi straddle, stacks 12,000 / 4,200 / ….
  - **The link reads:** `N73.100-200-200!m1~12000,4200,…`.
  - **It decodes with:** every stack at 50,000.
  - **Every straddle hand in the sample** (62 of 62) did this.
- **Why.** The encoder writes the straddle code before `~stacks`. The decoder cuts everything after
  `!` off as the straddle code (`hand-shorthand.js` 104-115 vs 293-296), so the stacks are lost.
- **Structure fields.** `bigBet`, `bringIn`, `betCap` and `uncapHeadsUp` are never written. A shared
  stud hand with a 1/3 bring-in or a non-double big bet, or a limit hand with cap 4 or an uncapped
  heads-up, reopens with the defaults (bring-in bb/4, big bet 2×, cap 5, uncapped on).

### D20 (Low): two games change name through PokerStars text
- `Stud Hi-Lo` is written as "7 Card Stud Hi/Lo" and read back as `Stud 8`.
- `L 2-7 TD` is written as "Triple Draw 2-7 Lowball Limit" and read back as `2-7 TD`.
- In both pairs the betting and the evaluation are identical, so only the name changes. Code:
  `ps-format.js` `GAME_TABLE` / `HEADER_TO_GAME`.

### D21 (Low): quick add flags a legal pot-limit stud minimum bet
- **Hand.** PL Stud 8, 5th street, pot 70, small bet 100. A player bets 100.
  - **Got:** "the pot-limit maximum was 70. What was the size?"
  - **In the sample:** 26 of 96 PL stud hands.
- **The entry form agrees.** It caps the bet at the pot, so its slider runs from 100 down to 70. See
  Q11 for the rule.

### D22 (Low, latent): `Table.apply` overwrites its own limit and completion test
- In `quick-add/betting.js`, the `if … else if … else if (fl)` chain that sets `full` is followed by
  an unrelated `if (fixedAlt…) … else full = inc >= this.lastRaise;`. That overwrites `full` for
  every action.
- **Today it is harmless.** Every player below the bet must act anyway.
- **It will matter** if `full` is ever used to decide who may re-raise, for example to fix D10.

### D23 (cross-reference, winner evaluation): a paired razz or A-5 hand cannot be scored
- `evalLowA5` gives up on any five cards with a pair, so a razz showdown where a player must play a
  pair (T-6-K-T-K-4-6 in `Razz 191355`) has no score. The export then refuses the hand with
  "no-winner".
- The winner-evaluation report covers this.

### D24 (Low): OFC Pineapple is configured as a hold'em game
- `HAND_CONFIG['OFC Pineapple']` has `betting: 'nl'` and 13 hero cards, and no category.
- `getGameCategory` therefore returns "community": blinds, Preflop to River, six seats.
- It is not in the picker, but quick add's alias table maps "pineapple OFC" to it.

### D25 (Low, hidden UI): the classic form records draws a street later, and has no real turn logic
- `HandReplayerEntry` (hidden) shows draws on the street named after the draw (index 1 and up). The
  GTO form, the replay and the writer all record a draw on the betting round before it.
- Its next player is `actions.length % activePlayers.length`, which is wrong as soon as anyone raises.
- Harmless while `SHOW_ENTRY_MODE_TOGGLES` is false. It should not be switched back on as it is.

## 5. Needs the owner's clarification

**Q1. Pot-limit with a big-blind ante: is the ante in the pot preflop?**
- **Now:** the entry form leaves it out (`plAnteAdjust`, line 3005). The writer and quick add count
  it. So the three disagree; in the sample, 70 pot-limit hands had a preflop maximum off by exactly
  the ante.
- **The rule:** TDA Rule 59 defines the pot as all prior bets, and Rule 56-B prices preflop pot bets
  on full blinds. Neither excludes the ante.
- **Options.** (a) Count it everywhere (the writer's rule). (b) Exclude it everywhere and make that a
  setting.

**Q2. Minimum raise over a straddle.**
- **Room practice varies.** Some rooms raise by the increment (a 400 straddle over 200 → minimum
  re-raise to 600). Others treat it as a third blind (minimum to 800, "twice the straddle"). A summary
  of the 2023 WSOP Live Action Rules says a minimum of three big blinds after a straddle; that text
  was not checked directly.
- **Now:** the form computes neither (D11). The app also prices every extra straddle at double the
  previous one.
- **Options.** Pick one rule, or make it a setting next to the straddle switch.

**Q3. A big blind too short for blind and ante: which is posted first?**
- **Now:** the form, the writer and quick add post the blind first.
- **The rule:** reports of the 2019 TDA summit say the TDA chose ante first (PokerNews). A later
  rulebook text could not be confirmed. The writer's comment calls blind-first "the TDA rule".
- **Options.** Blind first, ante first, or a setting.

**Q4. Limit cap and heads-up.**
- **Now:** the default is 5 bets, and the cap is lifted only on the last street when two players
  remain.
- **The rule:** TDA Rule 50 keeps the cap heads-up in tournaments until two players are left in the
  event. Many cash rooms lift it whenever two players are left.
- **Options.**
  - Default cap: 4 bets (a bet and three raises) or 5.
  - When it lifts: never in MTT hands, on any street when heads-up, or last street only (now).

**Q5. Open pair on 4th.** Confirm Stud Hi only, with the small or big bet the opener's choice (Park
West rule 8). Stud 8, Stud Hi-Lo and the razz games would have no open-pair rule.

**Q6. "Stud Hi/Lo Regular" and `Stud Hi-Lo`.**
- **Now:** both play as Stud 8: an 8-or-better low, with the same evaluator.
- **The question:** if "Regular" means no low qualifier, it needs its own evaluator. If not, the row
  and the duplicate game can go.

**Q7. Picker rows the app does not play (D6).** Pineapple, Courchevel, Double Board Bomb Pot, the
Dramahas, Dramadugi, Omajack, Archie 66/99, Ari, Razzdugi, Razzdeucy, A-5 Single Draw, and the
NL/limit five-card draw and badugi structures.
- **Options.** For each: hide the row; build the game; or keep the nearest game with a visible
  "entered as PLO" notice.

**Q8. What are the "Super" and "Action" stud modifiers meant to change** (cards dealt, ante, bring-in)?
Until that is defined they should not create a hand (D7).

**Q9. Draw games when the deck runs out.** Rooms reshuffle the discards and deal from them, so a
discarded card can come back in triple draw. The form's dead-card rule (`drawDeadCards`) refuses
every card discarded so far.
- **Options.** Allow discards once the stub is exhausted; allow them always, with a warning; or keep
  the rule.

**Q10. Eight-handed stud without enough cards for 7th street.**
- **The rule:** rooms deal one face-up community card that everyone shares (Park West, Seventh Street
  rules 3-4).
- **Now:** the app has no way to enter it.
- **The question:** support it, or limit stud hands to seven players?

**Q11. Pot-limit stud: the minimum bet against a small pot, and the size of a completion.** In the
sample, pots of 60-120 (antes plus a bring-in) sat under a 100-200 small bet.
- **Options.**
  - The small bet is always allowed even above the pot. Most pot-limit rules treat the minimum bet
    as always legal; this was not confirmed for stud.
  - Or the pot caps everything.
- **And NL/PL stud completion:** should completing still be to the small bet, as the form assumes?

**Q12. What the no-limit and pot-limit amount field means.** The field, the pills and the action
badges use chips added. The "Pot" button shows the total raised to.
- **The risk:** a player who types "raise to 1,200" records 1,200 more.
- **Options.** Make the field "raise to"; or label it "adds".

**Q13. Ties between stud boards.** The form breaks a tie toward Seat 1, so it assumes Seat 1 sits
at the dealer's left. The app records no dealer seat for stud. Is "Seat 1 = dealer's left" the
intended convention?

**Q14. How strict should entry be?** It is a record of a hand that happened. The options:
- **(a) Enforce the rules:** block an under-minimum raise, a re-raise after an incomplete all-in,
  and a raise past the cap.
- **(b) Allow anything** and show a warning ("raises are not re-opened by a 100 all-in").
- **(c) Block only what cannot add up** (a "raise" smaller than the call).

The fixes for D8, D10 and D12 depend on this answer.

## 6. Sources

- Poker TDA Rules (Rules 49-A/B incomplete all-ins, 50 raise caps, 56 pot-limit, 59 pot definition): https://www.pokertda.com/view-poker-tda-rules/
- TDA 2019 summit, big-blind ante decided ante-first (PokerNews): https://www.pokernews.com/news/2019/06/tda-summit-day-2-34676.htm
- Park West Casino (Manteca) house rules, filed with the California Attorney General: stud open pair (Third-Sixth Street Action rule 8: "applies in High only"), the 7th-street community card (Seventh Street Action rules 3-4), the high or low board acting first: https://oag.ca.gov/system/files/media/parkwestcasino-manteca.pdf
- Razz rules (highest door brings it in, lowest board acts first, aces low): https://www.pokernews.com/poker-rules/razz.htm
- 2-7 triple draw (draw order from the left of the button; blinds act last only in the first round): https://www.pokerology.com/lessons/2-to-7-triple-draw
- Straddle minimum-raise conventions: TDA forum, "Straddle Questions", https://www.pokertda.com/forum/index.php?msg=805; 2023 WSOP Live Action Rules, https://phh.readthedocs.io/en/latest/_static/2023-WSOP-Live-Action-Rules.pdf

## 7. How this was run (not committed)

The harness is in the session scratch folder, `…/scratchpad/entry-audit/`. Its files:

| File | What it does |
|---|---|
| `ref.mjs` | The reference engine and hand generator |
| `build.mjs` | Bundles `HandReplayerView.jsx` from the worktree, read-only, with the internal helpers exported; esbuild through a virtual module |
| `driver.js` | The in-page driver |
| `run-ui.mjs` | WebKit runs, about 4 minutes per game |
| `run-node.mjs` | Writer, parser, share link and gaps |
| `targeted*.mjs` | OFC, the modifiers, 7th street, under-call raises, the bring-in raise, the open pair |
| `real-app.mjs` | The game picker on the scratch server |
| `analyse.mjs`, `gen-table.mjs` | The tables in §3 |

**Setup.**
- `npm install` in the worktree's `vite-app`, plus `playwright@1.63.0 --no-save`, the version that
  matches the installed `webkit-2359`. The main checkout's `vite-app/node_modules` had been emptied
  during the run by another process.
- The scratch server was killed afterwards.
