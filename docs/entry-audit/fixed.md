# Hand entry: what was fixed

The audit (`findings.md`, 47 findings) and the check against PokerKit (`entry-vs-oracle.md`, seven
causes and four things that could not be entered), and what became of each. Code is
`vite-app/src/components/HandReplayerView.jsx` unless named; each fix carries a comment naming its
finding.

## Against PokerKit

| | What it was | Now |
|---|---|---|
| 1 | Pot-limit before the flop left a big-blind ante out of the pot, and a legal raise above that ceiling was saved as the ceiling without a word | The ante is in the pot, as in PokerKit and the text quick add. A typed amount out of range is refused with the range |
| 2 | A folded hero's cards were scored at the showdown, so the hero could be saved as a winner | A folded hero is not in the showdown, and a winner who has since folded is dropped on save |
| 3 | "All-in" for a stack that could not cover the call was saved as a raise, and the round never closed | Raise and All-in are offered only when the stack covers more than the call; Call puts the short stack in |
| 4 | Raises offered where none is allowed: nobody left who could call one, a stack short of the call, a short all-in that did not reopen the betting | A raise needs an opponent who could put in more than the bet faced, a stack above the call, and the betting reopened (a full raise, or shorts adding up to one, TDA rule 43; half a bet in limit; a player who only checked faced no bet) |
| 5 | The smallest raise after a short all-in raise was too low | The smallest raise is the last FULL raise; a straddle is the new big blind |
| 6 | The amount box opened on float noise ("299.41999999999996") | Every figure the buttons test or show is rounded first |
| 7 | The Pot label at a short big blind's option showed stack plus blind | With nothing to call, the label is what goes in |

| Could not enter | Now |
|---|---|
| A figure with cents typed key by key ("0.5" read 5) | Every amount field keeps what is typed until it is left (`parseAmount`, `AmountField`) |
| A face-down 7th-street card nobody saw | Only the hero's 7th-street card is needed |
| Stud, an open pair on 4th street: only the big bet | Stud high offers both; hi-lo and the low games keep the small bet |
| A card back from a reshuffle of the discards (draw games) | **Not changed: the owner's call.** The entry keeps a thrown card out of the deck on purpose |

**Where it stands** (2026-11-10, `npm run check:replayer-entry-oracle -- --per-game 5`): 97 of 100
corpus hands entered clean and 98 saved and replayed to PokerKit's stacks; the three others are draw
hands with a card back from a reshuffle (above). `npm run check:replayer-games`: every picker row
clean. A limit all-in of half a bet or more reopens the betting here, as the TDA says; PokerKit does
not, and the check notes it rather than failing it.

## The audit's findings

| # | Finding | Now |
|---|---|---|
| 1 | Save error toast | Fixed |
| 2 | Delete without a question | Asks, and says if it failed |
| 3 | A hand in progress lost | Kept as a draft; Cancel with anything entered asks; the list offers it back as "Unfinished hand" |
| 4 | A mis-tapped hero card could not be fixed | The hero's cards on the seat reopen the picker at any point; Done closes it |
| 5 | The typed board took cards already out | Refused, naming the card |
| 6 | A used card reachable by keyboard | Disabled in every picker; every board counts |
| 7 | A hand saved with no winner | Save asks for one |
| 8 | Stud 7th street needed every card | The hero's only |
| 9 | Stud 3rd street typed field took anything | Three different cards or none, said under the field |
| 10 | Seats, blinds and stacks changed under recorded betting | Fixed while there is betting, with one "Clear the action" button |
| 11 | A blank opponent made the hero win | No winner is worked out while a live hand is unknown |
| 12 | The result picker cycled none / win / split | A tap marks the winner, a second player makes it a split; Back returns to the showdown; Cancel added |
| 13 | Edit skipped the betting | Edit opens a finished hand on its result |
| 14 | A tap on a seat rewound silently | More than one step back asks |
| 15 | Stud seats renamed LJ, HJ… | Numbered seats |
| 16 | Stud door cards could not be aimed; Start Action with none | Tap the opponent, then the card; every door card is needed |
| 17 | Razz note said the low card brings it in | The high card |
| 18 | Open pair on 4th | As above |
| 19 | No "UTG" at seven to nine handed | **Not changed: the owner's call.** The labels are stored in every saved hand and read back by the export and the quick add in five copies of the list; changing them needs both sets read, or a migration |
| 20 | Amount fields kept digits only | Fixed (cents in cash, whole chips in a tournament, "1,500", "25k"; anything else is refused aloud) |
| 21 | The buy-in cap took letters; Reset stacks with no cap | A number only; Reset stacks says why it did nothing |
| 22 | Next went on with impossible setups | Names the first problem (blinds, no chips, no name, a name twice) and stays |
| 23 | The raise box | Refused out of range with the range shown; Enter confirms, Escape closes; labelled |
| 24 | Short stacks offered a raise; run-it-twice in a tournament | Fixed; running it more than once is offered in cash only |
| 25 | Bomb Pot played blinds and a preflop round | **Out of the picker** (`UNBUILT_GAMES`) until built; double-board PLO stays |
| 26 | Draw card details | Title names the draw; thrown cards must be held, new cards unseen, counts must match; the hero's cards are buttons |
| 27 | Back on the draw round removed a bet | One Undo |
| 28 | Short Deck's question returned to the list | The answer starts the hand |
| 29 | Typed cards misread | "10" is a ten; extra cards and non-cards are said |
| 30 | A cash hand started from tournament numbers | Cash defaults |
| 31 | No game name on the entry screens | The game's name heads every screen |
| 32 | Sticky header controls | On Setup only |
| 33 | The hero was chosen by an unexplained tap | A line says so, and the badge is a real button |
| 34 | Game search | One typing slip forgiven; lowball, California lowball, crazy pineapple, 7 card stud, stud 8 or better known; mixes folded under the game; a Close button on the phone; a focus ring |
| 35 | Two Create buttons; double board in two places | One of each |
| 36 | The result showed no cards, hands or pot | The pot, each live player's cards and made hand, and the high and low halves |
| 37 | The stud deal target carried over | Each street starts on the first seat without a card |
| 38 | Pineapple asked for a throw with no cards | Skipped |
| 39 | Keyboard | Each screen takes the focus; f, c, k, r act; Enter and Escape in the raise box |
| 40 | Targets under 44pt | The straddle rows are 5r, the entry's control height. **Left:** the app's controls are 5r (about 39pt) by design; raising them is an app-wide decision |
| 41 | Controls with no name or state | Named, with pressed and expanded states |
| 42 | "Continue to Result" clipped | "Continue" |
| 43 | The hero's cards on the stack figure | Dropped 1r |
| 44 | "$ USD" cut off | An inset edge in place of the border |
| 45 | The discard label overlapped | The cards start 1r under the label (and under each name on the Result) |
| 46 | Desktop: a narrow phone column | **Not changed:** a layout job of its own |
| 47 | Wording | One word for each thing; Undo off with nothing to undo |
