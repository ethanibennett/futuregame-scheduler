# The games with rules of their own (2026-11-05)

Fourteen named games sat out of the replayer's picker (`UNBUILT_GAMES`) because they had no rules and used to be
scored as a plainer game. The owner asked for them to be built from the published rules, filling gaps by asking. This
is what each one does and where the rule came from. Where sources disagree, the choice is marked as a **default**:
those are the owner's to overrule.

Engine: `utils/poker-engine.js` (`scoreHalves`, `GAME_EVAL`). Shape: `HAND_CONFIG` in `utils/utils.js`. Tests:
`utils/__tests__/hidden-games.test.mjs`; `npm run check:replayer-games` plays each through the real screens, on hands
that a neighbouring game's rules would pay differently.

| Game | Game type | How it plays | Pot |
|---|---|---|---|
| Pineapple (NL, PL, Limit) | `NL/PL/L Pineapple` | Three hole cards; everyone throws one after the preflop betting, before the flop. Then hold'em. | High |
| Courchevel | `Courchevel` | Five hole cards, Omaha's two and three. The first flop card is dealt before the first bet, the other two on the flop. Pot limit. | High |
| Stud Hi/Lo Regular | `Stud Regular` | Seven-card stud. | High and an A-5 low with **no** qualifier |
| Razzdugi | `Razzdugi` | Dealt as razz. | Best A-5 five and best badugi |
| Razzdeucy | `Razzdeucy` | As Razzdugi; the ace is high and brings it in. | Best 2-7 five and best badugi |
| Archie 99 | `Archie 99` | Five cards, three draws, limit. | High needs a pair of 9s, low is 8-or-better A-5. One side qualifying scoops |
| Archie 66 | `Archie 66` | The same with a pair of 6s. | |
| Ari | `Ari` | Archie with one community card dealt before the first bet, usable only for the high. | As Archie 99 |
| Dramaha Hi | `Dramaha Hi` | Five cards; bet; flop; bet; one draw; turn; bet; river; bet. | Omaha high from the hand after the draw, and the best five-card high from the hole cards |
| Dramaha 2-7 | `Dramaha 2-7` | The same. | Omaha high and the best 2-7 |
| Dramaha 49 | `Dramaha 49` | The same. | Omaha high and the most points |
| Dramaha 0 | `Dramaha 0` | The same. | Omaha high and the fewest points |
| Dramadugi | `Dramadugi` | The same. | Omaha high and the best badugi from the hole cards |
| Omajack | `Omajack` | Five-card PLO, no draw. | Omaha high, and the best blackjack from the three hole cards the best Omaha hand leaves |

Points (Dramaha 49 and 0): J, Q, K are 0, an ace 1, 2 to 9 their face, a ten 10. Blackjack: an ace 1 or 11, tens and faces
10, over 21 cannot win the half; everyone bust, Omaha scoops. A player cannot play a weaker Omaha hand for a better total,
only choose between pairs that make the same one.

## Defaults, for the owner

- **Archie and Ari, nobody qualifies:** the pot is split among those who showed (APT). Card Player says chopped or to the
  best high; Poker Game Database says the best high takes it. One switch: `neither` in `GAME_EVAL`.
- **Ari's qualifiers:** a pair of 9s and 8-or-better, from Cardplayer Lifestyle's "the same" as its Archie, which is 9s.
- **"Dramaha 0" is Dramaha Zero,** fewest points. The name is the picker's; the rule is Card Player's.
- **Odd chip:** to the first half listed (Omaha, razz, 2-7, high). APT says so for Razzdugi and Razzdeucy, and for Archie
  gives it to the high; the Dramaha and Omajack sources do not say.
- **Courchevel is high only and five hole cards.** PokerListings' page says four once, under a heading saying five; the
  others say five. A hi-lo Courchevel exists and is not offered.
- **Dramaha has one row, pot limit.** Card Player also writes up limit Dramaha.
- **No limit on cards drawn in Dramaha 49.** "Draw2maha 49" caps it at two; the replayer records what was thrown and does
  not enforce a cap.

## How they fit the replayer

- **Two hands in one pot** (`type: 'halves'`): half A in the pot's "hi" slot, half B in its "lo", so the awards, side pots
  and labels are the hi-lo ones, in the game's own words ("Omaha/Blackjack Split", "Blackjack: 21").
- **A draw in a board game** (`drawAfter`): the draw round runs after that street's betting, then the board is dealt.
  Stored as any draw is, on that street. `discardOnly` (Pineapple) brings nothing back; the hero says which card went.
- **A card before the first bet** (`doorBoard`): its own entry screen, stored as street 0's board.
- No run-it-twice in those games; no double board with a card before the first bet.
- Not exported to PokerTracker: PT4 does not analyse them, and the export refuses them plainly. Quick add still records
  them as the nearest game plus a `variant`.

## Sources

- Razzdugi, Razzdeucy, Archie, Stud Hi/Lo Regular: Asian Poker Tour handbook, theasianpokertour.com/info/pokerhandbook
- Archie and its qualifier: Card Player, "Spice Up Your Home Game: Archie And Its Variants"; pokergamedatabase.com/games/archie.html
- Ari, Pineapple, Drawmaha family: Cardplayer Lifestyle, "Mixed Game Poker Rules"
- Dramaha: Card Player, "Old School Dramaha", "Limit Dramaha: An Introduction", "Point Based Dramaha Variants"
- Omajack: The Festival, "The Festival Series Explains: Omahajack"
- Courchevel: PokerListings; Martin Smith, "How to Play Courchevel"
