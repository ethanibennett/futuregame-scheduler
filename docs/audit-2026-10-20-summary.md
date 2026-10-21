# Replayer and quick add audits, 20 October 2026: the summary

Three audits ran overnight. Their full reports, with every repro and source:

- `docs/replayer-audit-evaluation.md`: who wins. 1,000 random hands across 19 rule families plus 73
  targeted cases, checked against an evaluator written from the published rules.
- `docs/replayer-audit-entry.md`: entering hands. 1,056 synthetic hands (32 for each of 33 betting games)
  driven through the real entry form in WebKit, plus export/import, share links and quick add's rules.
- `docs/quick-add-shorthand-eval.md`: shorthand text. A 1,000-hand corpus (`test/quick-add/shorthand-corpus.json`)
  and the code-only half of quick add. **The model half was not measured: there is no `ANTHROPIC_API_KEY`
  on this box.**

This page ranks what they found, says what branch `replayer-audit-fixes` already fixes, and gathers every
question for the owner in one list. Nothing here is merged.

## Fixed on `replayer-audit-fixes` (for review)

| # | Defect | Where | Checked by |
|---|---|---|---|
| 1 | After an all-in the entry form asked the wrong player (92 hands, 27 games) | `HandReplayerView.jsx` currentActor | The audit's harness: wrong-player prompts 30 → 13 on 160 hands, the rest all stud (#2) |
| 2 | Stud boards: any unpaired board outranked a pair; kickers after the first ignored | `scoreStudBoard` | The audit's harness, 32 hands each of Stud Hi, Stud 8, Razz, NL Razz, PL Razz: wrong-player prompts 115 → 0, hands reaching Save 44 → 133 of 160 |
| 3 | NL and PL Razz used the high game's bring-in and first actor; Razz scored the ace high on later streets | `isRazz`, `scoreStudBoard` | As #2 (NL Razz 0 → 26 hands saved, PL Razz 0 → 23) |
| 4 | A-5 lowball and Razz: every paired hand tied every other ("Chop — null") | `poker-engine.js` evalLowA5 | Hand-picked cases; the client tests |
| 5 | 2-7: a suited A-2-3-4-5 ranked as a straight flush (it is an ace-high flush) | `evalLow27` | Hand-picked cases |
| 6 | Limit Omaha saved as O8, so a hi-only game split pots with a low | the game picker | — |
| 7 | OFC entry crashed on Next ("Rendered more hooks") | `GTOEntryView` | — |
| 8 | Pasted converter text read "650k" as 650 and "18.08k" as 18.08: a wrong hand, no question asked | `lib/quick-add/hh.js` | The corpus's four such hands |
| 9 | A header of "NLHE" was not read as no-limit hold'em | `hh.js` detectGame | The corpus |
| 10 | The Admin screen's live parser eval failed every case in 2 ms (no Anthropic client) | `test/quick-add/eval.js` | `--dry-run`; the model itself not called |

## Still open, most serious first

1. **Clash detection only flags events that START at the same moment** (`utils.js` detectConflicts). A noon
   event and a 1:15 event are never flagged, though both run for hours. The launch plan leads every ad with
   the clash check. Found while building Ad 9. **Owner question A.**
2. **The game picker saves the wrong game for 17 rows** (both audits): 2-7 Razz as Razz, Razzdugi as a Badugi
   draw hand, Archie/Ari as Badugi, Stud Hi/Lo Regular as Stud 8, Dramaha, Omajack, Courchevel and Bomb Pot as
   4-card PLO, the PL and Limit single-draw rows as NL 2-7 SD. Super/Action modifiers fall back to no-limit
   hold'em. Most need a rules answer first (questions 7–12 below).
3. **Draw games draw in preflop order**: UTG draws first instead of the small blind; heads-up the button draws
   first. Every draw game.
4. **Share links with a straddle reset every stack to 50,000** (62 of 62 hands), and links drop the big bet,
   bring-in, cap and heads-up setting.
5. **Badeucy's badugi half plays the ace low**; APT plays it high (5 of 60 sample hands had the wrong winner).
6. **Blinds, antes and straddles bigger than a stack are not capped**: the pot is overstated and stacks go
   negative. Uncalled bets are never returned in the form's pot.
7. **Entry rules**: the limit cap allows one extra raise; an all-in for less than a full raise reopens the
   betting; the minimum raise ignores straddles; a "raise" smaller than the call is accepted; "All-in" for less
   than the call is recorded as a raise; NL/PL stud cannot raise the bring-in beyond completing; 7th street
   waits for every opponent's down card; the one player with chips is asked to act on every later street;
   Badeucy and Badacy cannot draw five.
8. **Stud odd chip** goes to the lowest seat, not by suit (TDA 2026 Rule 21-B).
9. **Quick add, smaller**: tournament blinds in a converter header are never read (the pattern needs a
   currency symbol); stakes copied with trailing words ("1/2k bba") skip the server's k-carry check; the
   scorer and the server disagree on which seat is MP.
10. **Exports rename** Stud Hi-Lo to Stud 8 and L 2-7 TD to 2-7 TD on the way back in.

## Questions for the owner

**The app**

- **A. What is a clash?** Same start only (today), or overlapping play, e.g. one event's start inside another's
  late-registration window?
- **B. Venue lines show the series title** ("2026-27 WSOPC Upstate NY-Fall") on the event card and the friend
  card. Should they show the room?

**Rules the replayer has to pick**

1. Short Deck: do trips beat a straight by default (the app asks per hand today)?
2. Pot-limit with a big-blind ante: is the ante in the pot preflop? The form says no; the writer and quick add say yes.
3. The minimum raise over a straddle.
4. A big blind too short for blind and ante: which is posted first?
5. The limit cap: 4 or 5 bets, and does heads-up lift it?
6. The open pair on 4th street: Stud Hi only, with the small or big bet the opener's choice?
7. "Stud Hi/Lo Regular" and "Stud Hi-Lo": the no-qualifier game (as APT defines Regular), or Stud 8?
8. Archie, Archie 66, Archie 99, Ari, Ultimate Big O and Hideaway: what are they? No published rules found for Ari, Ultimate Big O or Hideaway.
9. Dramaha, Dramadugi and Omajack: build real evaluators, or let the player mark the winner?
10. Courchevel: hi only or also hi-lo, saved with 5 hole cards?
11. Double Board Bomb Pot: in scope, and half the pot per board?
12. "Super" and "Action" stud: what do they change? Should Action Razz need a face card?
13. Odd chips: razz and stud (TDA and Robert's Rules disagree); Badeucy and Badacey (APT gives it to the draw half, TDA to the worst position, the app to the badugi half).
14. Badacey's ace: low in both halves (as the app does)?
15. Stud ties: who acts first on equal boards? The form assumes Seat 1 sits on the dealer's left.
16. Draw games when the deck runs out: reshuffle the discards?
17. Eight-handed stud without enough cards for 7th: a community card?
18. Pot-limit stud: the minimum bet into a small pot, and how big a completion is.
19. The no-limit and pot-limit amount field: chips added, or "raise to"?
20. How strict should entry be: refuse illegal actions, warn, or record whatever happened?

**Shorthand quick add**

21. "b25" after the flop: chips (thousands when the stakes are in k) or percent of pot? Suggested: chips, unless the post says "%" or is a solver spot.
22. Which seat is "MP" at 6-, 8- and 9-handed, and with no table size?
23. "Everyone 20k": every seat at the table, or only the players named?
24. "calls 18k": the total, or the chips added?
25. "NL200": a big blind of 2 (N/100)?
26. "Stud Hi-Lo" and "Stud 8": one game or two (they are two ids today)?
27. An effective stack in a big-blind-ante game: before or after the posted ante?
28. Lower-case "4tt": a 4 and two tens, or a 4 with a two-tone suffix?
29. "3!": a 3-bet (as the prompt assumes)?

**To finish the shorthand measurement:** about $10–30 for 1,000 parses at Sonnet 5 prices. It needs either
`ANTHROPIC_API_KEY` on this box or a run on Render. With the eval fix above, the Admin screen's "Hand parser,
live eval" can run it there.
