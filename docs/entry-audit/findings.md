# Replayer hand entry: audit from the user's side

Audited 2026-11-10 against the working tree at `f0d9cbf` plus the uncommitted changes, in a private
build served by a scratch server (port 4870, a fresh scratch database, one registered non-admin user).
Browser: Playwright WebKit. Phone = 402x874 at 2x with touch. Desktop = 1440x900.

Nothing in the repo was changed. This file and the screenshots beside it are the only writes.

## Summary

| Severity | Count | Meaning used here |
|---|---|---|
| **Broken** | 10 | The user loses work, cannot finish, or the app records something impossible or false without saying so |
| **Wrong** | 20 | Behaves incorrectly or misleads, but the user can recover |
| **Friction** | 11 | Works, but costs taps, time or thought |
| **Polish** | 6 | Cosmetic |
| **Total** | 47 | |

**Taps for the simple NLH hand** (6 players, hero raises, one call, continuation bet, fold), from the
Hands list to the replay, phone: **21 taps + 3 keystrokes**.

| Step | Taps |
|---|---|
| Open the game launcher, tap "No Limit Hold'em" | 2 |
| Next (setup left at its defaults) | 1 |
| Hero's two cards | 2 |
| Raise, type "500", Confirm | 2 + 3 keys |
| Five more preflop actions (4 folds, 1 call) | 5 |
| Three flop cards, Continue | 4 |
| Bet, half-pot pill, Confirm | 3 |
| Fold | 1 |
| Save & Replay | 1 |

22 counting the Hands tab itself; 22 taps and no keys when a preset pill is used for the raise; 19
without hero cards. That is a good number. Full hands to showdown for comparison (phone): NLH cash 29,
heads-up 28, 10-handed 35, PLO 34, LHE 8-handed 31, O8 9-handed 36, Stud Hi 46, Stud 8/b 6-handed
(inside HORSE) 42, Razz 46, 2-7 Triple Draw 39, Badugi 33, NL 2-7 Single Draw 24, Dramaha 37, Bomb Pot
39, Short Deck 33. Desktop: NLH cash 32, Stud Hi 47, 2-7 Triple Draw 39, O8 36.

**Games walked start to "Save & Replay" at phone size:** NLH cash (6), NLH tournament with a big-blind
ante (6, heads-up, 10), PLO (6), Limit Hold'em (8), Omaha 8/b (9), Stud Hi (8), Stud 8/b (6, picked
from inside HORSE), Razz (8), 2-7 Triple Draw (6), Badugi (6), NL 2-7 Single Draw (6), Dramaha (6),
Bomb Pot, double board (6), Short Deck (6), Pineapple (6, by probe). Desktop (setup and at least one
street, in fact whole hands): NLH cash, Stud Hi, 2-7 Triple Draw, Omaha 8/b.

**Reading the findings.** "Start (game)" means: Hands tab, tap the game launcher at the top of the
list, tap that game's row; Setup ("Players & Blinds") opens. Every finding was reproduced at least
twice in separate browser sessions unless it says **seen once**. Line numbers are
`vite-app/src/components/HandReplayerView.jsx` unless another file is named. Screenshot numbers match
finding numbers; there is no screenshot for 41.

---

## Broken

### 1. Every save ends with an error message, although the hand was saved

- **Where:** Result, "Save & Replay". Every game, phone and desktop, first save and re-save after Edit.
- **Steps:** Start (No Limit Hold'em), Next, tap two hero cards, Raise, Confirm, Fold x5, Save & Replay.
- **Happens:** the replay opens with a toast: `Couldn't save the hand: m is not a function. (In
  'm("Hand saved")', 'm' is an instance of Object)`. The hand is in fact saved (the POST returned 200
  and it is in the list).
- **Should:** "Hand saved". As it stands, the last thing the user is told after entering a hand is that
  it was lost, in developer language.
- **Screenshot:** `01-save-shows-error.png`
- **Source:** 4684 `const toast = useToast();` returns an object `{ success, error, info }`
  (`ToastContext.jsx`). 5006 `toast('Hand saved')` calls it as a function, inside the `try`, so the
  catch at 5007-5010 reports a failed save. Use `toast.success('Hand saved')`. A real failure is shown
  with `toast.info` (the blue "i"), which should be `toast.error`.

### 2. Delete removes a saved hand at once: no question, no undo, no message

- **Where:** Hands list, each saved hand's "Delete" button. Phone and desktop.
- **Steps:** save any hand, Back to the list, tap "Delete" on its row.
- **Happens:** the hand is gone immediately. No confirmation, no undo, and no "Hand deleted" either.
  The button is 65x31 px on the phone, directly beside the row's tap area that opens the hand.
- **Should:** ask first, or delete with an Undo toast; say what happened.
- **Screenshot:** `02-delete-no-confirm.png`
- **Source:** 5502 (the button, no `aria-label` naming the hand), 5014-5021 `deleteHand`: no
  confirmation; 5019 `toast('Hand deleted')` throws for the reason in finding 1 and the catch only
  logs. The `fetch` result is not checked either, so a failed delete is silent too.

### 3. A hand in progress is lost by one tap, a reload, or the browser's Back

- **Where:** every entry screen. Phone and desktop.
- **Steps (a):** Start (any game), Next, enter cards and several actions, tap "Cancel Hand" in the
  footer (98x39 px, directly beside "Back to Setup"). Or tap "Cancel" on Setup.
- **Steps (b):** the same, then reload the page.
- **Steps (c):** the same, then press the browser's Back button.
- **Happens:** (a) straight back to the list, the hand gone, nothing asked. (b) the app opens on the
  Dashboard and the draft is gone. (c) leaves the app.
- **Should:** a hand with anything entered asks before it is thrown away, and a draft survives a
  reload (the phone's browser reloads a background tab whenever it likes). Switching tabs inside the
  app and coming back does keep the entry, which is right.
- **Screenshot:** `03-cancel-hand-draft-gone.png`
- **Source:** 4642 `onClick={onCancel}`, 3401-3411 (Setup's Cancel), 5222-5229
  `onCancel={() => setMode('list')}`. The draft lives only in `GTOEntryView`'s state; nothing writes it
  anywhere and nothing is pushed to history.

### 4. A mis-tapped hero card cannot be corrected (flop and draw games)

- **Where:** first action screen, the hero's card picker. Every non-stud game. Phone and desktop.
- **Steps:** Start (No Limit Hold'em), Next, tap As then (by mistake) Kd.
- **Happens:** the picker closes the moment the last card is tapped. The hero's cards in the seat are
  plain 22x31 images, not tappable. There is no "Edit Cards". Undo is enabled but does nothing (no
  action is recorded yet). "Back to Setup" then "Next" comes back with the cards still set and the
  picker still closed. The only way out is Cancel Hand and start again.
- **Should:** tapping the hero's cards reopens the picker, at any point in the hand.
- **Screenshot:** `04-hero-card-cannot-be-fixed.png`
- **Source:** 4491-4536: `pickerOpen = showHeroCardPicker || !heroHasCards`. 2718 declares
  `showHeroCardPicker` but its setter is never called, so the "Edit Cards" branch at 4519 is dead
  code. 4426-4432 renders the seat's cards with no handler.

### 5. The typed board field accepts cards already in play, and the same card twice

- **Where:** "Deal the Flop / Turn / River", the text field above the picker. Flop games, phone and
  desktop.
- **Steps:** Start (No Limit Hold'em), Next, hero As Ks, Raise, Confirm, Call, Fold x4. On "Deal the
  Flop" type `AsQh7d` and press Continue. Also: type `QhQh7d`. Also: deal Qh 7d 2c, bet and call, then
  type `Qh` for the turn.
- **Happens:** all three are accepted. The hand goes on with the hero's As on the board, with two
  Qh on the flop, with Qh on the flop and the turn. The replay shows them.
- **Should:** a card already dealt is refused, with a word saying which one.
- **Screenshots:** `05-typed-flop-uses-hero-card.png`, `05-typed-turn-duplicate.png`
- **Source:** 3698, the text input's `onChange` writes the parsed cards straight to the street with no
  check against used cards or against themselves. The picker (3707) applies the check only by styling.

### 6. With a keyboard, an opponent can be dealt a card that is on the board

- **Where:** Showdown card picker (and the board picker). Desktop with a real keyboard; also reachable
  on the phone by any assistive tap that does not go through a pointer.
- **Steps:** desktop, Start (No Limit Hold'em), Next, hero As Ks, play to the river with Qh on the
  board. At Showdown press Tab until Qh has the focus ring (4 Tabs from the picker's first card),
  press Enter, then pick Ah.
- **Happens:** the opponent holds "Qh Ah" with Qh on the board. It saves, and the replay names the
  hand "Pair of Qs". On the phone the same was done with focus then click and gave "Kd Ah" with Kd
  already out.
- **Should:** a used card cannot be chosen by any input.
- **Screenshots:** `06-keyboard-deals-board-card.png`, `06-showdown-duplicate-phone.png`
- **Source:** used cards get class `used`, and `styles.css:4819` gives it `pointer-events: none`.
  That stops a mouse and nothing else. The showdown picker (3871) and the board picker (3707) do not
  set `disabled`; `toggleSdCard` (3814-3846) does not check. The stud deal (4367), door (4070) and
  hero (4527) pickers do set `disabled` and are safe: copy that.

### 7. A hand can be saved with no winner, and the pot is never paid

- **Where:** Result. Every game. Phone and desktop.
- **Steps:** play any hand to Showdown, leave every hand blank, Continue to Result. Tap each marked
  winner until no row says Win or Split (or arrive with none). Tap "Save & Replay".
- **Happens:** it saves. In the replay the last frame leaves the pot in the middle and every stack
  short; nobody wins.
- **Should:** "Save & Replay" needs at least one winner, and says so.
- **Screenshots:** `07-result-no-winner.png`, `07-replay-pot-unpaid.png`
- **Source:** 4008-4013: the handler saves whatever `hand.result` holds; the button has no `disabled`
  and no check.

### 8. Stud: 7th street cannot go on until every opponent has a card, which is dealt face down

- **Where:** "Deal 7th Street". Stud Hi, Stud 8/b, Razz. Phone and desktop.
- **Steps:** Start (Stud Hi), play to 7th street with two opponents still in. Give the hero a card
  and nobody else.
- **Happens:** "Continue" stays disabled until Opp 1 and Opp 3 each have a card. The user has to
  invent the opponents' river cards, which nobody saw, and the replay then shows them. The same on
  4th to 6th when a card was not seen: there is no "unknown".
- **Should:** 7th street asks only for the hero's card (opponents optional, face down by default); an
  earlier street lets a card be left unknown.
- **Screenshot:** `08-stud-7th-needs-every-card.png`
- **Source:** 4385 `disabled={enteredCount < sdActivePlayers.length}` on every stud street.

### 9. Stud 3rd street takes anything: nothing, two cards, the same card three times

- **Where:** "3rd Street" (the hero's three cards), the text field. Stud games, phone.
- **Steps:** Start (Stud Hi), Next. Press "Enter Door Cards" with nothing entered. Or type `AhKh`
  (two cards), `AhAhAh`, `Ah7d2c9s` (four), `zz`.
- **Happens:** every one goes on to the door cards. `AhAhAh` gives the hero three aces of hearts;
  two cards leaves the hero without a door card (see 16).
- **Should:** three different cards, or none at all for a hand entered without the hero's cards, and
  a word when what was typed cannot be used.
- **Screenshot:** `09-stud-3rd-same-card-three-times.png`
- **Source:** 3582-3584 (free text straight into the street), 3605 (the button has no count or
  duplicate check). The field has no `inputmode`, `autocapitalize` or `aria-label`.

### 10. Changing the number of players after actions are entered keeps the actions, by row

- **Where:** Setup reached by "Back to Setup". Phone. Reproduced twice.
- **Steps:** Start (No Limit Hold'em, 6 players), Next, hero As Kd, Raise, Confirm (hero raises to
  400), Fold, Call. Tap "Back to Setup". Change Players from 6 to 4. Tap Next.
- **Happens:** no warning. The action screen shows CO Hero "RAISE 400", BTN "FOLD", SB "CALL 400" with
  49,500 behind, and the BB to act facing "Call 300" in a pot of 1,300. The three actions were made
  by the LJ, the HJ and the CO of a six-handed table; they now belong to whoever sits in rows 1 to 3
  of a four-handed one. Saved, this is a hand that never happened.
- **Should:** changing the player count (or the hero's seat, or the blinds) with actions recorded
  either asks and clears the actions, or is not offered.
- **Screenshot:** `10-fewer-players-after-actions.png`
- **Source:** 3000-3011 `setNumPlayers` rebuilds `players` and the opponents' card slots and leaves
  `streets[].actions` (indexed by player) untouched.

---

## Wrong

### 11. An opponent whose cards are left blank at showdown loses, and the app says it worked it out

- **Where:** Showdown then Result. Seen in NLH, Stud Hi, Stud 8/b, Razz, Badugi, Dramaha, Bomb Pot.
- **Steps:** play any hand to Showdown with the hero's cards known. Enter no cards for the opponent.
  Continue to Result.
- **Happens:** "Hero (Win)" is marked, under "Auto-evaluated." Nothing was evaluated: the hero is the
  only hand the app knows. An opponent who called the river and won with cards the user did not see
  is recorded as the loser unless the user notices and re-marks it.
- **Should:** with a hand unknown, mark nobody and ask who won; never call it evaluated.
- **Screenshot:** `11-blank-opponent-hero-wins.png`
- **Source:** 3915-3916: one known hand wins outright. The "Auto-evaluated." text is 3999, shown
  whenever any winner is set.

### 12. Result: winners are marked by cycling, impossible marks are accepted, and Undo jumps to the river

- **Where:** Result. Every game. Phone and desktop.
- **Steps:** reach Result with two players. Tap each name once.
- **Happens:** a tap cycles none, Win, Split, none; the only help is "Tap to cycle: none → win →
  split → none". Two players marked "Win" saves and pays as a split (50,250 each). One "Split" alone
  is accepted. The buttons carry no `aria-pressed`. "Undo" on this screen removes the last betting
  action and lands on the river action screen, skipping the showdown; there is no Cancel here at all.
- **Should:** tap = this player won (tap a second player = they split it); Back returns to Showdown.
- **Screenshots:** `12-result-two-wins.png`, `12-result-undo-goes-to-river.png`
- **Source:** 3978-3995 (winner buttons), 3999 and 2698 (the hint), 2981-2994 `undoLastAction` is
  wired to the Result footer.

### 13. Editing a saved hand skips its betting and drops a result set by hand

- **Where:** Replay, "Edit". Every game. Phone.
- **Steps:** save an NLH hand in which the winner was marked by hand. Open it, tap Edit, tap Next.
- **Happens:** Edit opens Setup; Next lands on "Deal the Flop". The preflop betting is never shown
  and can only be reached by pressing Undo, which removes it. Going forward, the result is worked out
  again and the hand-marked winner is lost. Saving does update the same hand (no duplicate), which is
  right, and the cards already used are dimmed in the pickers, which is right.
- **Should:** Edit opens the hand where a change can be made (its last screen, or a list of streets),
  and keeps the result unless the user changes what decides it.
- **Screenshot:** `13-edit-skips-betting.png`
- **Source:** 5122 `onEdit={() => setMode('entry')}`; `GTOEntryView` starts every hand at `setup` and
  resumes at the end of the recorded streets.

### 14. Tapping a seat that has acted silently undoes everything back to that action

- **Where:** any action screen, the seats strip. Phone and desktop.
- **Steps:** Start (No Limit Hold'em), Next, hero cards, Raise, Confirm, Fold, Call, Fold. Tap the
  first seat (the raiser), for instance to look at it or while scrolling.
- **Happens:** the raise and the three actions after it are gone. No question, no redo. Nothing on
  the seat says it is a button; only a `cursor: pointer` that a phone never shows.
- **Should:** a rewind of more than one step asks, or the seats are not a rewind control.
- **Screenshot:** `14-seat-tap-undoes.png`
- **Source:** 4418 `onClick={act && !isActive ? () => undoToPlayer(i) : undefined}`; 2956-2979.

### 15. Stud: changing the player count renames the seats "LJ, HJ, CO, BTN, SB, BB"

- **Where:** Setup, then every later screen. Stud Hi, Razz, Stud 8/b inside HORSE. Phone.
- **Steps:** Start (Stud Hi). The rows read "Seat 1 … Seat 8". Change Players to 6.
- **Happens:** the rows read LJ, HJ, CO, BTN, SB, BB (2 players: "BTN/SB, BB"; back to 8: "MP1, MP2,
  LJ …"). The labels follow the hand through the door cards and every action screen. Stud has no
  button and no blinds.
- **Should:** "Seat 1 … Seat N" at every count.
- **Screenshots:** `15-stud-seats-renamed.png`, `15-stud-action-lj-labels.png`
- **Source:** 3003 `const positions = getPositionLabels(n);` is unconditional. A new stud hand uses
  `getStudPositionLabels` (288-290); `setNumPlayers` should too.

### 16. Stud door cards cannot be given to a chosen opponent, and "Start Action" needs none

- **Where:** "Door Cards". Stud games. Phone.
- **Steps (a):** Start (Stud Hi), Next, hero As Ad Kh, Enter Door Cards. Tap the third opponent's
  row, then tap 9c.
- **Happens (a):** 9c goes to the first empty row, not the one tapped. Cards can only be filled top
  to bottom; to fix the second row the user clears from there down. (The 4th-street deal screen does
  let a row be chosen.)
- **Steps (b):** the same, but tap "Start Action" with no door cards entered.
- **Happens (b):** it starts. The hero, whose Kh is the only up card known, is made the bring-in with
  no word about why. With only two hero cards typed (finding 9) and no doors there was no bring-in at
  all: the first screen offered "Check / Bet 200" (**seen once**).
- **Should:** tap a row, then a card; "Start Action" explains or refuses when it cannot tell who
  brings it in.
- **Screenshots:** `16-stud-door-cannot-aim.png`, `16-stud-no-doors-hero-brings-in.png`
- **Source:** 4055 and 4072 (next empty slot only; rows have no handler), 4021-4091; the bring-in is
  chosen at 4540-4548 from whatever up cards exist.

### 17. Razz setup says "the low door card brings it in"

- **Where:** Setup, the note under the bring-in fields. Razz. Phone and desktop.
- **Steps:** Start (Razz), read the note.
- **Happens:** "the low door card brings it in". In Razz the high card brings it in (the entry itself
  gets this right on the action screen).
- **Should:** "the high door card brings it in" for Razz.
- **Screenshot:** `17-razz-low-card-note.png`
- **Source:** 3355, one string for every stud game.

### 18. Stud Hi with an open pair on 4th street offers only the big bet (for the legality check)

- **Where:** 4th street action. Stud Hi phone and desktop; Stud 8/b once.
- **Steps:** Start (Stud Hi, 100 ante, 200/400), play 3rd street, deal Opp 1 a second queen on 4th
  (Qc beside a Qh door).
- **Happens:** the pair acts first with "Check / Bet 400". The rule gives a choice of 200 or 400 on
  4th street with an open pair; here the small bet cannot be entered. In Stud 8/b the same screen
  offered "Bet 400" (**seen once**), and hi-lo has no double bet on 4th at all. Razz offered "Bet 200",
  which is right.
- **Should:** Stud Hi: both sizes. Stud 8/b: the small bet only.
- **Screenshot:** `18-stud-open-pair-bet-400.png`
- **Source:** 4556-4557 (limit sizing); passed on to the agent checking legality, noted here because
  it was on screen.

### 19. A nine-handed table has "UTG+1" and no "UTG"

- **Where:** Setup and every seat label. Flop and draw games. Phone and desktop.
- **Steps:** Start (Omaha 8/b), set Players to 9, then 8, then 7.
- **Happens:** 9: "UTG+1, MP1, MP2, LJ, HJ, CO, BTN, SB, BB". 8: starts at "MP1". 7: starts at "MP2".
  The first player to act is under the gun at any table size. (Six-handed starting at LJ is left
  alone: it reads as deliberate.)
- **Should:** the first seat after the blinds is UTG whenever there are seven or more.
- **Screenshot:** `19-nine-handed-no-utg.png`
- **Source:** 279-286: `middle.slice(Math.max(0, middle.length - need))` takes names from the end of
  the list. The same list is copied in `utils/hand-shorthand.js:69` and `utils/quick-add/game.js:103`;
  change all three together or shared links and quick add will disagree with the entry.

### 20. Blind and stack fields silently change what was typed; a $0.50/$1 game cannot be entered

- **Where:** Setup: SB, BB, ante, straddle, every stack. Every game. Phone and desktop.
- **Steps:** Start (No Limit Hold'em), tap Cash. In SB type `0.5`; in BB type `1`. In a stack type
  `1,500`.
- **Happens:** SB shows 5. The stack shows 500. Measured, typed → kept. Blinds: "2.5" → 25, "0.5" →
  5, "100.999" → 100999, "1,000" → blank, "1k" → blank, "1e3" → 3, "-100" → 100. Stacks: "2.5" → 25,
  "1,500" → 500, "25k" → 0, "100.50" → 10050, "-40" → 40, "1e6" → 6; twenty digits are accepted.
  Nothing is said in any case. The fields are `inputMode="decimal"`, so the phone's keypad offers the
  point and then the field throws it away. Cash pots are settled to the cent since 2026-11-10, but a
  game with a half-dollar blind cannot be set up.
- **Should:** cash accepts cents; a comma is ignored, not treated as the end of the number; "25k"
  either works or is refused aloud.
- **Screenshot:** `20-cash-blinds-half-dollar.png`
- **Source:** 3252-3257 (blind inputs: `type="text" inputMode="decimal"`, `Number(...) || 0` after a
  digits-only strip), 2996-2998 `updatePlayerField` (`Number(value) || 0`).

### 21. The buy-in cap takes letters, and "Reset stacks" then empties every stack

- **Where:** Setup, the cap row under the players. Phone.
- **Steps:** Start (No Limit Hold'em). In the buy-in cap field type `abc` (or `25k`). Tap "Reset
  stacks". Tap Next.
- **Happens:** the field shows "abc". Reset stacks sets all six stacks to 0, without a word. Next
  then skips the whole hand to "Deal the Flop" with "Run it once / Twice / Three times" on offer,
  because everybody counts as all-in.
- **Should:** the cap takes a number only; Reset stacks with no usable cap does nothing and says why.
- **Screenshots:** `21-cap-letters-zero-stacks.png`, `21-zero-stacks-straight-to-flop.png`
- **Source:** 3393 (the input, no filter), 2732-2736 `resetStacks` uses `Number(buyinCap) || 0`,
  3397 (the button).

### 22. Setup checks nothing before "Next"

- **Where:** Setup. Every game. Phone and desktop.
- **Steps:** Start (No Limit Hold'em). Set SB 500, BB 200. Or set the hero's stack to 0. Or clear a
  name; give two players the same name; type a 60-character name. Tap Next.
- **Happens:** all accepted. With SB above BB the hand plays with those blinds. A hero with 0 is
  skipped in the betting without explanation. A long name pushes the seat strip wide.
- **Should:** Next names the first thing that cannot be right (small blind above the big blind, a
  seated player with no chips, an empty name) and stays on Setup.
- **Screenshot:** `22-sb-bigger-than-bb.png`
- **Source:** 3401-3411: Next calls straight through, no validation.

### 23. The raise amount: bad input is ignored without a word, and the amount recorded is not always the amount typed

- **Where:** action screens, the Raise / Bet panel. NL and PL games. Phone and desktop.
- **Steps (NL):** Start (No Limit Hold'em), Next, hero cards, Raise. Type each of: `abc`, `-500`,
  `1,000`, `1k`, `0`, then Confirm.
- **Happens (NL):** Confirm does nothing and says nothing; the panel just stays. `100` and `399`
  (the minimum raise is to 400) are accepted and recorded. `2.5` is accepted. `999999` is recorded as
  an all-in with no notice.
- **Steps (PL):** Start (Pot Limit Omaha), Next, hero cards, Raise, type `5000`, Confirm. Next
  player: Raise, type `100`, Confirm.
- **Happens (PL):** the field still shows 5000; the action is recorded as RAISE 700 (the pot). Twice.
  The next player's 100, facing 700, is accepted (Opp 1 shows 49,900 behind).
- **Should:** a raise below the minimum or above the limit is refused with the legal range shown; a
  number the field cannot read says so; an amount is never changed after Confirm without telling.
- **Also:** the size pills are 54-65x39 px; the slider and the input have no label a screen reader
  can read.
- **Screenshots:** `23-raise-field.png`, `23-plo-over-pot-cut.png`
- **Source:** 4600-4620 (NL input and Confirm), 4567-4568 and 4586 (PL clamp applied on confirm, not
  to the field).

### 24. Short stacks: a player who cannot cover the call is offered a raise; run-it-twice in a tournament (for the legality check)

- **Where:** action screens and "Deal the Flop". NLH. Phone.
- **Steps:** Start (No Limit Hold'em, MTT), give Opp 1 a stack of 300, Next, hero raises to 1,000,
  action reaches Opp 1.
- **Happens:** Opp 1 is offered "Raise" and "All-in"; going all-in for 300 is recorded as "RAISE 300".
  Once everyone left is all-in, "Deal the Flop" offers "Run it once / Twice / Three times" although
  the hand is a tournament hand.
- **Should:** a call for less is a call; running it more than once is a cash-game option.
- **Screenshots:** `24-short-stack-offered-raise.png`, `24-run-it-twice-in-mtt.png`
- **Source:** 3626 `runItOffered` does not look at the hand's cash/MTT mode; 3678 the labels.

### 25. "Bomb Pot" plays blinds and a preflop betting round

- **Where:** the "Bomb Pot" row (double board PLO). Phone. Reproduced twice.
- **Steps:** Start (Bomb Pot), Next.
- **Happens:** Setup asks for SB, BB and a BB ante; the first screen is a preflop round: "Fold / Call
  200 / Raise / Pot 700". A bomb pot is an ante from every player and a flop with no preflop betting.
  The two boards and their split are right in the replay.
- **Should:** Setup asks for the bomb ante; entry starts at the flop.
- **Screenshot:** `25-bomb-pot-preflop-round.png`
- **Source:** 4850 (the row only turns on `doubleBoard`), 5075.

### 26. Draw "Card Details": the title names the wrong round and the fields take nonsense

- **Where:** the optional card details after a draw. 2-7 Triple Draw, Badugi, NL 2-7 Single Draw,
  Dramaha, Pineapple. Phone and desktop.
- **Steps:** Start (2-7 Triple Draw), Next, hero cards, play the first betting round, declare draws,
  open the card details. In "Discarded" for an opponent type `zz`; then a card the player cannot
  hold; in "New Cards" type a card already used; mark five discards and enter two new cards.
- **Happens:** the title reads "Card Details — Pre-Draw" for the first draw, "— First Draw" for the
  second (it names the betting round before, not the draw); in Dramaha "— Flop"; in Pineapple "—
  Preflop". "Discarded" accepts `zz` and cards not held. "New Cards" silently drops a used card with
  no message. Five out and two in is accepted. New cards with no discard replace the first card. The
  note ends "Skip to continue." and there is no Skip button (the button is "Continue"). The hero's
  discards are 22x31 images with an `onClick`: no role, not focusable.
- **Should:** the title names the draw ("First Draw"); cards are checked like everywhere else; the
  counts must match; the hero's cards are buttons.
- **Screenshot:** `26-card-details-nonsense.png`
- **Source:** 4132 (title built from the street name), 4133 (the note), 4174-4176 (`<img
  className="card-img draw-selectable" onClick>`), 4186 ("Discarded" input), 4190-4192
  (`DrawNewCardsInput`). Both fields are `type="text"` with no `inputmode` or `aria-label`.

### 27. Draw round: "Back" with nothing declared removes the last bet

- **Where:** the draw declaration screen ("Stand Pat / Draw 1 …"). Draw games. Phone.
- **Steps:** Start (2-7 Triple Draw), Next, hero cards, complete the first betting round so the draw
  screen opens. Tap "Back" before declaring anything.
- **Happens:** the last betting action (the closing call) is deleted and the betting screen returns.
  After one declaration the footer shows both "Undo" and "Back", which now do different things.
- **Should:** Back only goes back; removing an action is Undo's job, and one of the two is enough.
- **Screenshot:** `27-draw-round-back.png`
- **Source:** 4259-4277.

### 28. Short Deck: after answering the rules question the user is back at the list

- **Where:** Hands list, the Short Deck row. Phone.
- **Steps:** tap the launcher, tap "Short Deck". The dialog asks which rule the room uses (does a
  straight beat trips). Answer it.
- **Happens:** the dialog closes and the list is showing; the hand has not started. The user has to
  find and press "Create Short Deck Hand". Pressing Escape on the dialog and then "Create Short Deck
  Hand" starts a hand recorded as "a straight beats trips" without the question ever being answered.
- **Should:** the answer starts the hand; dismissing the dialog starts nothing.
- **Screenshots:** `28-short-deck-dialog.png`, `28-short-deck-back-at-list.png`
- **Source:** 4821-4823, 4866-4878 (4876-4877 the default applied when the dialog was dismissed),
  5070, 5399; `components/ShortDeckRuleDialog.jsx`. End to end the game itself works (36-card
  picker, right ranking in the replay).

### 29. Typed cards are misread without a word

- **Where:** the text field on "Deal the Flop" (and the turn and river). Phone and desktop.
- **Steps:** on "Deal the Flop" type `10h 7d 2c`. Then `Qh7d2c9s`. Then `zz`.
- **Happens:** "10h 7d 2c" is read as 7h 2d (the ten is lost and the suits shift). "Qh7d2c9s" shows
  three cards in the row but four are highlighted in the picker. "zz" disables Continue and says
  nothing. The field has no `inputmode`, no `autocapitalize="off"` (iOS capitalises the first
  letter, which happens to be harmless here) and no `aria-label`.
- **Should:** "10" is a ten; extra cards are refused; what cannot be read is said.
- **Screenshot:** `29-typed-flop.png`
- **Source:** 3698.

### 30. A cash hand starts from tournament numbers

- **Where:** Setup after tapping Cash; also Limit Hold'em and Omaha 8/b in either mode. Phone and
  desktop.
- **Steps:** Start (No Limit Hold'em), tap "Cash".
- **Happens:** SB 100, BB 200, BB ANTE 200, every stack $50000. Left alone, the replay's header reads
  "NLH · 100/200/(200)": a cash game with a big-blind ante. Limit Hold'em and Omaha 8/b also start
  with a 200 big-blind ante.
- **Should:** Cash starts with no ante and blinds and stacks a cash game has (for example 1/2 or 2/5
  with 100 big blinds); limit games start with no ante.
- **Screenshot:** `30-cash-tournament-defaults.png`
- **Source:** 1029 `createEmptyHand`; the Cash tab (5154-5163) changes the mode and nothing else.

---

## Friction

### 31. No entry screen says which game is being entered

- **Where:** every entry screen. Phone and desktop.
- **Steps:** Start (Razz). Look for the word "Razz".
- **Happens:** it is nowhere. The header's label "GAME" sits over the MTT / Cash switch, which is not
  the game. Inside a mix (HORSE, then Stud 8/b) there is nothing to say which of the five it is.
- **Should:** the game's name at the top of every entry screen, and "Format" over MTT / Cash.
- **Screenshot:** `31-no-game-name.png`
- **Source:** 5154-5163.

### 32. The header stays pinned through every screen and takes over a quarter of the phone

- **Where:** every entry screen. Phone (y 46 to 293 of 874, about 28%); desktop 639 px wide and
  215 to 264 px tall.
- **Steps:** Start (Omaha 8/b), 9 players, Next.
- **Happens:** MTT / Cash, the currency, Title and "Share publicly" stay fixed above the cards and
  the action buttons for the whole hand. Nine-handed, the seat strip and the picker share what is
  left with the footer.
- **Should:** those four belong to Setup (and perhaps Result); the action screens get the room.
- **Screenshot:** `32-sticky-header-nine-handed.png`
- **Source:** 5136-5240 (the wrapper renders it for every phase); `styles.css:3793`, `4246`
  `.gto-sticky-header`.

### 33. Choosing the hero's seat is hidden

- **Where:** Setup, the players list. Phone and desktop.
- **Steps:** Start (No Limit Hold'em). Try to make the BTN the hero.
- **Happens:** it works by tapping the position pill, and the opponents renumber correctly. But the
  pill is a 43x23 `<span>` with no role and no focus, the instruction ("Tap to make hero, drag to
  reorder") exists only as a `title` tooltip that a phone never shows, and the "HERO" heading sits
  over the pill column, reading as a column title rather than an instruction.
- **Should:** a visible "Tap a seat to make it the hero", and a real button.
- **Screenshot:** `33-hero-pill.png`
- **Source:** 3358 (the heading), 3368-3375 (the span), 3015-3027 `setHeroSeat`.

### 34. Finding a game: one wrong letter finds nothing, and some everyday names are missing

- **Where:** the game launcher's search. Phone and desktop.
- **Steps:** open the launcher and type each query.
- **Happens:**
  - No typo tolerance: "razzz", "tripple draw", "baduci", "badugie", "hodlem" → "No game matches".
  - Names not known: "lowball", "california lowball", "crazy pineapple", "7 card stud", "stud 8 or
    better".
  - Wrong first hits: "omhaa" → Pot Limit Omajack; "cash" → the Poker Players Championship mix;
    "nlh" also lists No Limit Omaha and No Limit Stud Hi; "a-5" lists Razz second.
  - A one-game query lists ten or more mixes below the game, so the right row is one of many.
  - Rows mix spelled-out and short names. On the phone the sheet has no close button, rows are 31 px
    tall and the jump chips 54x23.
  - Good: "villain" finds nothing; "big easy" finds "PLO6 8/b".
- **Should:** one edit of tolerance; the missing names as aliases; the exact game first with mixes
  folded under "Mixes containing it".
- **Screenshots:** `34-search-miss.png`, `47-palette.png`
- **Source:** `utils/variant-catalog.js` 128-172 (`ALIASES`), substring and alias match only;
  `components/VariantPicker.jsx`.

### 35. The empty list shows the same "Create" button twice, and "double board" is in two places

- **Where:** Hands list with no saved hands. Phone.
- **Steps:** open Hands as a new user. Then search the launcher for "double board".
- **Happens:** two identical "Create No Limit Hold'em Hand" buttons, one under the launcher and one
  in the empty state. Searching "double board" finds only "Bomb Pot", while a "DOUBLE BOARD"
  checkbox sits under the launcher for any flop game: two routes to the same thing with different
  names, and the checkbox is not found by the search.
- **Should:** one Create button; one way to ask for a double board.
- **Screenshot:** `35-two-create-buttons.png`
- **Source:** 5385 and 5424 (the two buttons), 5347-5355 (the checkbox),
  `utils/variant-catalog.js:143`.

### 36. Showdown and Result show no cards, no hand names and no pot

- **Where:** Result. Every game; worst in split games. Phone and desktop.
- **Steps:** play an Omaha 8/b hand to Result with both hands entered.
- **Happens:** the screen reads "Hero (Split) / Opp 1 (Split)" and nothing else. Not the pot, not
  who won the high and who the low, not the hands. The user confirms a result they cannot see; the
  replay afterwards has it right (HI 850 / LO 850).
- **Should:** each player's cards and made hand, the pot, and for split games who takes which half.
- **Screenshot:** `36-result-bare.png`
- **Source:** 3957-4018.

### 37. Stud deal: the row selected to receive a card changes from street to street

- **Where:** "Deal 4th … 7th Street". Stud games. Phone and desktop.
- **Steps:** Start (Stud Hi), play on with the hero and two opponents. Watch which row is
  highlighted when each deal screen opens.
- **Happens:** Opp 3 on 5th, Opp 1 on 6th, Opp 3 on 7th: wherever the last street's tapping stopped.
  A user dealing in table order gives the first card to the wrong player. "Back" on the 7th-street
  deal stayed on "Deal 7th Street" (**seen once**).
- **Should:** every street opens on the first player without a card, in table order.
- **Screenshot:** `37-stud-deal-target.png`
- **Source:** 2719 `studDealTarget` is not reset between streets; set at 4351 and 4371-4372.

### 38. Pineapple without hero cards: a discard screen with nothing to discard

- **Where:** the discard step. Pineapple. Phone.
- **Steps:** Start (Pineapple), Next, close the hero's cards unset (go on without them), play
  preflop.
- **Happens:** "Everyone throws one card before the flop. Tap the one you threw." over an empty row;
  Continue is enabled. With cards, the step works well.
- **Should:** skip the step when the hero's cards are unknown.
- **Screenshot:** `38-pineapple-nothing-to-discard.png`
- **Source:** 4093-4288 (4133 the note).

### 39. Entering a hand with the keyboard alone is possible but very long

- **Where:** every entry screen. Desktop.
- **Steps:** press "/" (the launcher opens), type "nlh", Enter; then use only Tab, Enter and Space.
- **Happens:**
  - Focus falls to the page body after every step, so each screen starts again from the top bar:
    about 46 Tabs to reach "Next" on Setup (through two unnamed top-bar buttons, the theme button,
    the user chip and six rail items), 26 Tabs to reach As in the hero's picker, 54 Tabs to reach
    "Continue" after typing a flop.
  - Enter in the raise field does not confirm; Escape does not close the raise panel; Enter after
    typing a flop does nothing.
  - No shortcut for Fold, Check, Call or Raise.
  - The launcher's search field shows no focus ring.
  - Position pills cannot be reached at all.
  - Good: the raise field takes the focus when Raise is pressed, each action is one or two Tabs once
    there, and every control shows a clear 2 px focus ring.
- **Should:** focus moves to the new screen's first control; Enter confirms the field it is in;
  Escape closes the panel; f / c / k / r for the four actions.
- **Screenshot:** `39-keyboard-flop.png`
- **Source:** `GTOEntryView` has no `onKeyDown` anywhere; 4891 (the launcher shortcut).

### 40. Touch targets below 44 pt (phone)

- **Where:** throughout. Phone, measured boxes in px.
- **Happens:** MTT / Cash tabs 23 tall; Share and the other toggles 43x23; position pills 43x23;
  straddle type checkboxes 36-66x16; card picker cards 22x39; the hero's discard cards 22x31; Undo
  43x39; Back to Setup and Cancel Hand 98x39 side by side; draw buttons 43-76x39; raise pills
  54-65x39; winner buttons 163x39; Muck 65x39; the list's Delete 65x31 and "Export for PokerTracker"
  152x31; cap-row controls 87x39; launcher rows 31 tall.
- **Should:** 44 in the short direction for anything tapped during a hand. The picker has unused
  width at 402 px (finding 46), so its cards can grow. The two worst are the straddle checkboxes
  (16 px tall) and Cancel Hand beside Back to Setup (finding 3).
- **Screenshot:** `40-straddle-small-targets.png`
- **Source:** `styles.css` 7133-7155 (`.replayer-straddle-check`), 4426-4431 (footer `.btn-sm`,
  `.gto-undo-btn`), 4410-4420 (`.gto-cap-row`), 4819 area (`.card-picker-btn`); 3318-3323.

### 41. Controls with no accessible name or state

- **Where:** throughout. Read from the accessibility tree, phone and desktop. No screenshot.
- **Happens:**
  - Setup's inputs: the visible labels are not tied to their fields (`for`/`id`) and there is no
    `aria-label`, so a screen reader announces "edit text" for SB, BB, ante, each name and each stack.
  - No name: the currency select, the buy-in cap, the raise input and its slider, the typed board
    field, the draw "Discarded" and "New Cards" fields.
  - No state: MTT / Cash (no `aria-pressed` or tab role), the winner buttons, the selected deal row.
  - Not controls at all: position pills (`span`), the hero's discard cards (`img`).
  - Two top-bar buttons have no name (`button.notif-btn` and a `btn-ghost`).
- **Source:** 3252-3257, 5164-5172, 3393, 4600-4620, 3698, 4186, 5154-5163, 3978-3995, 3368-3375,
  4174.

---

## Polish

### 42. "Continue to Result" is cut off at both ends

- **Where:** Showdown footer. Phone (button 87x39) and desktop (93x41).
- **Happens:** the button reads "ontinue to Resul".
- **Should:** the whole label; "Result" alone would fit, or give the primary button the row's spare
  width.
- **Screenshot:** `42-continue-to-result-clipped.png` (also visible in `06-keyboard-deals-board-card.png`)
- **Source:** 3950 (`btn btn-primary btn-sm` in the showdown footer); `styles.css` 4426-4431 and
  4647-4651 fix the footer buttons' width.

### 43. The hero's cards sit on top of the stack figure in the active seat

- **Where:** the seat strip on every action screen. Phone and desktop.
- **Happens:** the two card images overlap the stack number under the hero's name.
- **Screenshot:** `43-hero-cards-over-stack.png` (also `44-desktop-raise-panel.png`)
- **Source:** `styles.css` 3938 and 4473 (`.gto-seat-stack`), 4496
  (`.replayer-entry-view .gto-seat-cards`).

### 44. "$ USD" is cut off at the bottom of the currency select

- **Where:** the header in Cash mode. Phone and desktop.
- **Happens:** the select is 87x23 with a scroll height of 22 in a client height of 20; the
  descender-less "$ USD" still loses its lower edge.
- **Screenshot:** `44-desktop-raise-panel.png` (also `20-cash-blinds-half-dollar.png`)
- **Source:** 5164-5172.

### 45. "TAP TO SELECT DISCARDS" is overlapped by the cards under it

- **Where:** the hero's row on the draw screens. Phone and desktop.
- **Happens:** the top of the card images covers the lower half of the label.
- **Screenshot:** `45-discard-label-overlapped.png`
- **Source:** 4169; `styles.css` 4855-4856 (`.card-img.draw-selectable`).

### 46. Desktop: the entry is a narrow phone column, off-centre, with its footer out of line

- **Where:** every entry screen at 1440x900.
- **Happens:**
  - The entry is 616 px wide (x 191 to 807) inside a 755 px pane, leaving 128 px blank on its right;
    the second pane is 0x0 and the rest of the window is empty.
  - The sticky footer (168,784, 744x75) is about 11 px out of line with the column above it.
  - In MTT mode the two format tabs are 198 px and 418 px wide.
  - The seat rows show through beneath the footer while scrolling.
  - The picker's cards are 35x41 in a 569 px grid, with room for larger ones (on the phone, 22 px
    cards with unused width).
  - The wording is the phone's: "Tap a player, then tap a card.", "Tap to select discards", "Tap to
    cycle".
- **Screenshots:** `46-desktop-setup.png`, `46-desktop-card-details.png`, `46-desktop-stud-deal.png`
- **Source:** `styles.css` 17465-17471 (`.app-shell.is-desktop .gto-sticky-footer > * { max-width:
  calc(var(--gu) * 53); margin: 0; }`), 3808 and 4642 (`.gto-sticky-footer`), 3825-3830; 5154-5163;
  4345, 4169, 3999.

### 47. Wording that disagrees with itself

- **Where:** throughout.
- **Happens:**
  - "All-in" on the button, "All-In" in the seat.
  - One draw is written six ways: "Discard", "Stand Pat", "DREW 5", "Discards 5", "D5", "Pat".
  - "Skip to continue." where the button says "Continue" (4133).
  - The section is titled "Players & Blinds" for stud games, which have no blinds (3230).
  - With a straddle on, the hint reads "Preflop action starts on HJ and LJ closes." while the LJ's
    row is labelled "STR" (3343-3348 against 3365).
  - Fixed-limit headers read "200/400" while Setup's fields say SB 100 / BB 200: the header shows
    the bets, the fields the blinds, and nothing says so.
  - Undo is enabled when there is nothing to undo.
- **Screenshot:** `40-straddle-small-targets.png` shows the straddle hint; the rest are visible in
  the screenshots of findings 26, 27 and 31.

---

## What works well

- **Speed of the common case.** 21 taps and three keys for a raise, a call, a continuation bet and a
  fold. One tap per action, the next player selected automatically, the pot and each stack kept
  current.
- **Undo.** One step, many steps, and back across a street all restore the exact state, cards
  included.
- **Leaving and coming back inside the app.** Switching to another tab and back keeps the entry
  where it was.
- **Heads-up.** The button posts the small blind and acts first before the flop, last after; the
  starting pot is right.
- **Stud order.** The bring-in goes to the right door card (low in Stud Hi and Stud 8/b, high in
  Razz) with "Bring In 50 / Complete 200"; later streets open on the best board showing.
- **Stud deal screens.** Folded players are left out, a dealt card is disabled with "Already
  dealt", tapping a filled row and another card replaces it, and the door picker disables the hero's
  cards.
- **Limit sizing.** Small and big bets on the right streets in Hold'em, Omaha 8/b and the draw
  games; the cap is applied.
- **Pot limit.** The "Pot 700" pill is right and the pot figures match the replay.
- **Draws.** Declared draws show as "D1 / PAT" in the replay; the hero's discard-and-replace round
  trips correctly.
- **Split games.** Omaha 8/b, Dramaha and the double board pay the right halves in the replay,
  including a hand that scoops.
- **Short Deck.** The rules question is asked once, in plain words; the picker has 36 cards; the
  ranking follows the answer.
- **Pineapple.** The discard step, with cards, is one tap.
- **Editing a saved hand** updates it in place (no duplicate) and dims its cards in the pickers.
- **Hero seat.** Tapping a seat's pill moves the hero and renumbers the opponents; "Reset names"
  restores them.
- **Focus.** Every control shows a 2 px focus ring; "/" opens the launcher; the raise field takes
  the focus when Raise is pressed.
- **Names.** "villain" appears nowhere; "big easy" finds "PLO6 8/b"; game names follow the WSOP
  style.
- **Numeric fields** clear on focus and restore on blur, which reads as deliberate and works.

## Could not test

- **The grid overlay.** It is for app admins only (`server.js:449`, `APP_ADMIN_USERNAMES`), and the
  scratch user is not one, so every screenshot is without it. Layout findings are from measured
  boxes, not from the grid.
- **Another browser engine.** Only WebKit is installed on this box.
- **A real phone.** The on-screen keyboard covering a field, the safe areas, real thumb reach and
  iOS's autocapitalise and autocorrect on the typed-card fields were not seen. The Setup inputs sit
  in the upper half of the screen and the raise field is above the footer, so the keyboard is
  probably the main risk for the raise panel.
- **Arrow keys in the launcher's list.** My selector matched the wrong row; whether Up and Down move
  the highlight is unverified.
- **Whether opening a saved Short Deck hand from the list reopens the rules dialog** (4881-4885).
- **`GET /api/live-updates/active` answered 500 on every page load** on the scratch server. It is
  probably the scratch setup (an empty database, a stubbed solver), not the entry, and it did not
  affect any screen; worth one look on a real server.
- **The owner-only and admin-only paths** (Study, the Scanner, typing or saying a hand, "Study this
  draw") are outside hand entry and were not opened.
- **Short Deck and Pineapple** were covered by targeted probes, not by the full walking script; both
  were still entered start to save.