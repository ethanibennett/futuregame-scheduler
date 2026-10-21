# How well quick add understands poker shorthand: a 1,000-hand evaluation

2026-10-20, against master `84df90d`. The corpus is `test/quick-add/shorthand-corpus.json`, with 1,000
cases and 20,688 scored facts. The owner asked: *"create 1000 hands in shorthand text like you've seen
online (including variations like b25 vs b 25k) and see how well the replayer understands them."*

## Summary

- **The model was not run.** No `ANTHROPIC_API_KEY` exists anywhere on this box: not in the
  environment, not in the pm2 apps, not in the sibling projects' `.env` files. The key is set on Render
  only. Shorthand text is read by the model, so **the headline figure the owner wants (model
  accuracy) is still unmeasured**. The corpus can be run against the model unchanged (see
  [How to rerun](#how-to-rerun)). **Cost so far: $0.**
- **Even on Render, the existing direct runner would not have worked.** `test/quick-add/eval.js`'s
  default mode calls `parseHand({ text, source })` without an Anthropic client. Every case fails in
  about 2 ms with "Could not reach the parser". That is the mode the Admin screen's "Hand parser, live
  eval" starts (`lib/admin-eval.js`), so **the Admin live eval cannot produce a score as wired**. I
  checked this with a dummy key on two cases.
- **The deterministic fast path reads almost none of it, by design.** 985 of the 1,000 texts are
  "not a hand history" and go to the model. Fifteen converter layouts were read in code. **Fast-path
  fact recall is 0.9% overall**, and 77% on the 9 cases it did read. It is **100% when amounts carry
  a `$`**. It is wrong when they carry a `k`: `650k` is read as 650 and `4.4k` as 4.4. It also misses
  tournament blinds, and it declines any layout headed `NLHE`.
- **The deterministic half after the model is sound.** I ran an idealised model: on 840 hold'em and
  Omaha cases, I built the draft a model would return if it followed `prompt.js` to the letter, and
  sent it through the real `normalizeDraft`. Results:

  | | Facts | Share |
  |---|---:|---:|
  | Right | 16,510 | **98.8%** |
  | Asked of the player, by design | 111 | 0.7% |
  | Wrong | 89 | 0.5% |
  | Missing | 5 | 0.03% |

  The only systematic loss is **`b25` / `b 25` written with a bare number after the flop**. The
  prompt calls that ambiguous (25% of the pot, or 25 chips, or 25k in a tournament), so the hand
  carries two readings and the player is asked. That covers 56 of 141 such actions, and the actions
  after them on the same and later streets wait on the answer.
- **The rest of the owner's examples work in this layer at 100%:** `b25k`, `b 25k`, `25k`, `bets
  25,000`, `2.5bb`, `25 bb`, `25 bigs`, `25 big blinds`, `2.5x`, `$25`, `half pot`, `75%`. All 37 ways
  of writing a position resolve to the right seat, and every hole-card and board form is read
  correctly except one lower-case board, `4tt`.

## What was measured

Typed text takes this path (`lib/quick-add.js`, `parseHand`):

1. `lib/quick-add/hh.js` `parseHandHistory` (the **fast path**) reads a pasted PokerStars, GG or Full
   Tilt history, or a converter's `Stacks: … / Preflop (…): …` layout, in code. Anything else returns
   `null`.
2. Otherwise **the model** (`claude-sonnet-5`, the `record_hand` tool, `lib/quick-add/prompt.js`)
   turns the text into a draft. Sizes are kept as said (`toAmount`, `toAmountBB`, `potFraction`, or
   `sizeChoices` for a two-way size), and positions and cards are written as named.
3. `lib/quick-add/normalize.js` `normalizeDraft` (**deterministic**) seats the players, derives the
   chips added, fills unstated suits, settles two-way sizes from stated pots, and builds the replayer
   hand.

Because step 2 could not run, I measured three things that need no model:

| Layer | Cases | What it shows |
|---|---:|---|
| A. Fast path, exactly as `parseHand` takes it | 1,000 | What is read with no model at all |
| B. The "literal reader": the draft a perfect, prompt-following model would return, through the real `normalizeDraft` | 840 | Whether the deterministic half turns each notation into the right hand. A failure here is a failure even with a perfect model |
| C. Token probe: the server's own readers (`parseCards`, `parseStakes`, `canonicalPosition`, `canonicalGameName`, `detectGame`) on each raw token | every token | Which spellings the code itself understands |

All three are scored by `eval.js`'s own `scoreCase`, field by field. A fact is one stake, one stack,
one board street, one action with its seat and verb and amount (chips **added**), one showdown or the
winner. A pending two-way size is counted as **asked**, not wrong.

## The corpus

`test/quick-add/shorthand-corpus.json` holds one case per line in `eval.js`'s corpus format. It
validates cleanly: `eval.js --dry-run --corpus test/quick-add/shorthand-corpus.json` reports 0
errors and 0 warnings, and the oracle self-check scores 1000/1000. The dry run replays every action
against the stakes: turn order, minimum raises, pot-limit maximums, limit bet sizes, stack sizes,
duplicate cards and the stud bring-in.

### How the cases were made

- **970 generated cases.** A seeded generator (seed 20261020) simulates a legal hand and then writes
  it the way players post. Each case gets one of five styles:
  - prose (319)
  - terse forum shorthand (287)
  - line-per-street `Pre: / Flop (pot):` posts (180)
  - lower-case tweet style (128)
  - text messages with typos (26)

  Two converter layouts are also generated: the compact `Stacks:` layout that `hh.js` reads (15) and
  the 2+2 / Holdem Manager layout (15).
- **30 hand-written cases** cover things the generator does not produce: `3! to 18`, `K-7-2 rainbow`
  with `x/r`, `AAK9ds` with pot-raises, `1.1M` stacks, `GII` three-way all-ins, `b50` meant as a
  percentage (solver style), `b8` meant as 8k, `2,5bb` decimal commas, BvB `completes`, a straddle with
  `+1` and `STR`, razz, badugi and 2-7 triple draw with draws, `clicks it back`, and a hand someone
  watched.
- **Showdowns are coherent.** Hand evaluators decide who wins: hold'em, Omaha (exactly 2 from the
  hand), hi-lo eight-or-better, short deck, stud, razz, 2-7 and badugi. Some cases stop mid-hand with
  a question (69); others show no opponent cards ("mucks", "shows a set") (71).
- **Every case's tags list the notation families it uses**, so a future model run can be broken down
  the same way.

### Cases per game

The mix is mostly NLH, then PLO, then everything else:

| Game | Cases | | Game | Cases |
|---|---:|---|---|---:|
| NLH (incl. 30 converter layouts) | 587 | | Short Deck | 13 |
| PLO | 172 | | PLO6 8/b | 13 |
| PLO5 | 31 | | O8 | 12 |
| Stud Hi | 23 | | NL 2-7 SD | 12 |
| 2-7 TD | 23 | | Stud 8 | 10 |
| PLO8 | 20 | | A-5 TD | 6 |
| LHE | 18 | | Razz | 15 |
| PLO6 | 15 | | Badugi | 15 |
| Big O | 15 | | | |

### Notation families covered

Counts are cases that use the family.

- **Sizes:**
  - `b25` / `b 25` / `bet 25` / `bets 25` / `25` with no verb
  - `b25k` / `b 25k` / `25K`: k 129, K 29, glued 197
  - bare numbers after `b`/`r`: 173
  - k left off in a tournament (`b 53.2` meaning 53.2k): 15
  - `2.5bb` 162, `2.5 bb` 18, `bigs` 9, `big blinds` 12, `2.5x` 43
  - `$25` 232, plain 236, `25,000` 18, chips 37
  - pot words 182: pot, half pot, 1/4 pot, 3/4 pot
  - percentages 19
  - calls written with the total (`calls 137`): 159
- **Verbs:**
  - `x`/`chk`/`ch`/`check`, `xx`/`x x`/`check check`/`checks through` (167)
  - `c`/`call`/`flat`/`peel`/`snap`/`calls off`, `f`/`fold`
  - `r`/`r to`/`raise`/`makes it`/`opens`/`iso`/`min-raises`/`rr`/`re-raises`
  - `3b`/`3B`/`3bet`/`3-bet`/`3!`, `4b`/`4bet`/`4!`/`4-bet`
  - `cb`/`cbet`/`c-bet`, `donk`/`lead`, `fires`, `stabs`
  - `jam`/`shove`/`AI`/`all in`/`ships it`/`rips it`, `r 45k AI`, `b 30k (AI)`
  - `x/c 6k` (implies the opponent's bet), `x/r`, `xr`, `check-raises`
  - `pots it`, `raises pot`, `3b pot`
- **Seats:**
  - UTG, utg, EP, under the gun
  - UTG+1, UTG1, +1, U+1, UTG+2, UTG2, +2
  - MP (only when the table size is stated), LJ, lojack, HJ, hijack, CO, cutoff
  - BTN, BU, BN, OTB, button, SB/BTN
  - SB, small blind, BB, big blind
  - straddle, STR, strad, the straddler, and "UTG" meaning the seat after the straddler
  - hero as I / we / Hero / H / hero
  - opponents named by position, or as V, V1/V2, villain, opp or he
  - comma lists with no names (186)
- **Cards:**
  - `AhKs`, `Ah Ks`, `A♥K♠`, `A♥️ K♠️`, `ahks`, `10h9h`, `[Ah Ks]`
  - `AKs`/`AKo`/`99`, "ace king suited", "pocket nines", aces/cowboys/big slick, "AK of spades"
  - Omaha `AAKKds` / `AJT9ss` / `AKQJ rainbow` / ranks only
  - boards `Ks7d2c`, `Ks 7d 2c`, `K♠7♦2♣`, `ks7d2c`, `K-7-2`, `K72`, `K72r`, `K72tt`, `K72 two-tone`,
    `K-7-2 rainbow`, a turn as just `4`
- **Stakes:**
  - `1/2`, `$1/$2`, `1-2`, `NL200` / `200NL`, `PLO200`
  - `1k/2k/2k`, `1000/2000/2000`, `1,000/2,000/2,000`, `1/2k bba`, `1k/2k w/ 2k bb ante`, `(2k BBA)`,
    `lvl 18 …`, `blinds 15k/30k, ante 30k`, `no ante`
  - `2/5/10` and "w/ $10 straddle"
  - limit stakes written as the bets
  - stud `10/20, $1 ante, $3 bring-in`
- **Stacks:**
  - each player's stack, in chips, k, bb, $ or with commas
  - `100bb eff` / `eff 40k` / `40k deep`
  - "BB covers"
  - "everyone 20k"
  - `1.1M` (hand-written)
- **Framing:** MTT / tourney / Main Event day 2 / PKO / turbo, versus live / online / home game / zoom
  / cash.

## Results

### A. Fast path (all 1,000 cases)

| Decision | Cases |
|---|---:|
| Not a hand history, sent to the model | 985 |
| Converter layout read in code | 9 |
| Converter layout with "no game named", sent to the model | 6 (all six headed `NLHE`) |

Fact recall is 0.9% (187 / 20,688), with 38 facts wrong. Every game other than NLH scores 0%: no
shorthand in them is read in code. The compact `Stacks:` layouts, split by how the amounts are
written:

| Amounts written as | Cases | Read in code | Facts right on the cases read |
|---|---:|---:|---:|
| `$` (cash) | 7 | 4 | **105 / 105 (100%)** |
| plain chips (tournament) | 3 | 2 | 50 / 62. Blinds and game mode missing, plus 5 action amounts as a result |
| `k` (tournament) | 4 | 3 | **32 / 76, with 33 wrong**: every stack and every `k` bet off by 1,000× |
| `bb` | 1 | 0 | header `NLHE`, so it went to the model |

Of the 15 layouts, 9 were read in code; the other 6 had `NLHE` headers and went to the model. None
of the 15 2+2 / HM converter layouts is read in code. They have no `Stacks:` line, so they go to the
model.

### B. The literal reader through `normalizeDraft` (840 hold'em and Omaha cases)

Overall: 16,715 facts, of which **16,510 are right (98.8%)**, 111 asked, 89 wrong and 5 missing.
**695 of 840 cases are perfect.** Leaving out the deliberate asks, accuracy is 99.4%.

How the literal draft was built:

- Sizes are passed in the form they were said: `toAmountBB` for any bb form, `potFraction` for pot
  words and percentages, `toAmount` for chips, `k` and `$`.
- For a post-flop `b`/`r`/`cb` followed by a bare number, the draft does exactly what the prompt
  says (prompt.js:321): both readings go in `sizeChoices` unless one is impossible.
- Positions, the stakes string and the cards are copied raw. Words like "ace king suited" are
  converted to `AKs`, as the prompt instructs.
- A pot written on a street header goes in `potBefore`.

By field:

| Field | Facts | Right | Asked | Wrong | Missing |
|---|---:|---:|---:|---:|---:|
| game, game mode, currency | 1,703 | 100% | 0 | 0 | 0 |
| stakes (sb, bb, ante, straddle, big bet) | 1,987 | 100% | 0 | 0 | 0 |
| table size | 695 | 100% | 0 | 0 | 0 |
| hero seat and cards | 1,680 | 100% | 0 | 0 | 0 |
| stacks | 1,193 | 92.6% | 0 | 88 | 0 |
| board | 1,858 | 99.9% | 0 | 1 | 0 |
| actions | 6,712 | 98.3% | 111 | 0 | 5 |
| showdown | 395 | 100% | 0 | 0 | 0 |
| winner | 492 | 100% | 0 | 0 | 0 |

By game:

| Game | Right | Asked | Wrong + missing |
|---|---:|---:|---:|
| NLH | 98.8% | 59 | 63 |
| PLO | 98.5% | 30 | 19 |
| PLO5 | 98.3% | 7 | 3 |
| PLO6 | 99.3% | 2 | 0 |
| PLO6 8/b | 99.6% | 0 | 1 |
| Big O | 96.8% | 7 | 3 |
| PLO8 | 98.6% | 4 | 2 |
| O8 | 100% | 0 | 0 |
| LHE | 100% | 0 | 0 |
| Short Deck | 97.9% | 2 | 3 |

Stud and draw cases are not in this layer: the literal draft is built for flop games only. In stud
and draw, as everywhere else, the fast path sends every case to the model.

**Sizes, the owner's `b25` versus `b 25k` question.** These are action amounts by how the size was
written (glued means `b25k`, spaced means `b 25k`):

| Written as | Actions | Right | Asked |
|---|---:|---:|---:|
| `k` / `K`, glued or spaced (`b25k`, `b 25k`, `bets 25k`, `25K`) | 365 | 100% | 0 |
| `bb`, `BB`, `2.5 bb`, `bigs`, `big blinds`, `2.5x` | 543 | 100% | 0 |
| `$25`, glued or spaced | 667 | 100% | 0 |
| a number after a verb word (`bets 25`, `opens 6`, `raises to 4400`), or with commas | 556 | 99.5% | 3 (after an earlier ask) |
| `b`/`r` + a bare number too big to be a percentage (`b4400`) | 33 | 100% | 0 |
| pot words, percentages | 254 | 99.2% | 2 (after an earlier ask) |
| **`b`/`r` + a bare number after the flop (`b25`, `b 25`)** | 141 | 60.3% | **56** |
| the same before the flop (`r 25`, `3b 45`) | 85 | 100% | 0 |
| a bare number with the k left off in a tournament (`b 53.2` = 53.2k) | 36 | 72.2% | 10 |

### C. The server's own token readers

| Reader | Result |
|---|---|
| `canonicalPosition` + `roleIndex` | **100%** on all 37 spellings seen: `OTB`, `BN`, `BU`, `U+1`, `+1`, `+2`, `UTG1`, `UTG2`, `EP`, `MP`, `lojack`, `straddle`, `STR` and the rest |
| `parseCards`, hole cards | 100% on every symbol, spaced, lower-case, `10`, bracketed, `AKs`/`AKo`/`99`, `AAKKds`/`ss`, or ranks-only form. Card words such as "queen jack suited" or "T6 of hearts" read as `null`, but converting those is the model's job by the prompt |
| `parseCards`, boards | 100% except lower-case `4tt`, which is read as a 4 plus a two-tone suffix |
| `parseStakes`: plain forms | 100%: `1/2`, `$1/$2`, `1-2`, `1k/2k/2k`, `1000/2000/2000`, `1,000/2,000/2,000`, `2/5/10` |
| `parseStakes`: stakes with words copied along | **`null` on all of them:** `NL200` (0/74), `1/2k bba` (0/15), `100/200 w/ 200 bb ante` (0/44), `(200 BBA)` (0/36), `lvl 18 400/800/800` (0/14), `blinds 15k/30k, ante 30k` (0/17), `1/2 w/ $4 straddle`, `1/3, straddle on` (0/12), `2k/4k no ante` (0/8). See pattern 5 |
| `canonicalGameName` | Matters only for `hints.gameType` and the fast path; the model picks from an enum. It returns `null` for "NL Hold'em", "PLO4", "4 card PLO", "6 card PLO8", "5 card PLO8", "6+", "7 stud", "7CS", "S8", "limit O8", "FLHE", "TD" and "2-7 NL". It maps "stud hi-lo" to `Stud Hi-Lo`, a separate game id from `Stud 8` |
| `detectGame` (names the game of a pasted layout) | Matters only for the fast path. "Big O" is never recognised (0/15). "Omaha … 6 handed" is read as **PLO6** (the regex `omaha ?6`), and the same goes for 5-handed and PLO5. `O8` is read as PLO8, "5-card plo" as PLO, "PLO6 H/L" as PLO6, and `NLHE`, `LHE` and `FLHE` give `null` |
| `parseAmountInfo` (stacks given as strings) | `25k`, `25K`, `2.5k`, `25,000`, `$25`, `€25`, `t2090`, `1.2M`, `1.2m` and `1.2 mil` are read correctly. `25bb`, `1,5bb` and `25 big blinds` give `null`, by design: those go in `startingStackBB` |

### D. The model path: not measured, but here is what the prompt covers

`prompt.js` explicitly covers almost every family in the corpus:

- `3!`/`4!`/`3b`/`3B`
- `x/r`, `kr`, `x/c`, `b/f`
- `AI`/`aipf`/`GII`/jam/shove/ship
- flat/peel/snap/"calls off"
- `OTB`/`BU`/`BN`/`+1`/`U+1`/`STR`/`EP`
- `eff`/"covers"/"deep"
- `BBA` and `1/2k`
- `1.2 mil`, `2.5x`, `big blinds`
- `AKs`/`AKo`, emoji suits, `K72r`/rainbow/two-tone
- decimal commas
- pot words
- the `b40` ambiguity

**Not mentioned anywhere in the prompt:** `chk`, `rr`, stakes written `NL200` / `200NL` / `PLO200`,
and a stack written with a capital `M` (`1.1M`). These are the first places to look when the model
run happens.

## Failure patterns, ranked by frequency

Layers A and B together; every non-right fact is in one of these.

1. **`b`/`r` + a bare number after the flop is asked, not recorded: 60 facts in 52 cases, by design.**
   - Examples: `sh-nlh-003` "b 55", `sh-nlh-050` "b28", `sh-nlh-038` "b 53.2" (meant 53.2k).
   - Source: `prompt.js:321` (both readings go in `sizeChoices` unless one is impossible) and
     `normalize.js` (`reconcilePots`, which settles a two-way size only from a pot stated on a later
     street).
   - It was asked on 56 of 141 such actions. The other 85 had one reading ruled out: the percentage
     reading came out under a big blind, or the number was over 200.
2. **Everything after an asked size waits for the answer: 51 facts in 35 cases.**
   - Examples: `sh-nlh-050` turn "flat" has no amount; `sh-plo-021` river "b quarter pot" can't be
     sized because the turn pot is unknown; `sh-plo8-019` a river `shove` with no amount.
   - This is a cascade of pattern 1, not a separate bug, but it doubles pattern 1's visible cost.
     Calls, pot fractions and all-ins without an amount all depend on knowing the pot.
3. **"Everyone 20k" reaches only the players the text names: 88 facts in 88 cases.**
   - Example: `sh-nlh-006` "everyone $320" gives stacks `,,320,,,320`. The four unnamed seats get
     no stack.
   - Source: the `record_hand` schema has no table-wide stack, and `startingStack` sits on listed
     players only.
   - Low impact, because the unnamed players folded before the flop. It does mean they show the
     replayer's default stack.
4. **Fast path, a `k` suffix is dropped in the converter layout: 26 facts in 3 cases.**
   - Examples: `sh-nlh-conv-004` stacks `650k` read as 650, `raises to 115k` read as 115;
     `sh-nlh-conv-007` `bets 2.25k` read as 2.
   - Source: `hh.js:35` `AMT` and `hh.js:31` `money()` capture the digits only. The stack regex
     (`hh.js:308`, `\(?\s*AMT[^)]*`) swallows the `k`. `2.2bb` would be read as 2.2 chips the same
     way.
   - This is the only pattern that **silently records a wrong hand with no question asked**.
5. **Fast path, tournament blinds go unread: 18 facts in 5 cases, plus 12 action amounts that follow
   from it.**
   - Example: `sh-nlh-conv-001` "MTT 2000/4000/4000 No Limit Hold'em" gives no blinds, no ante and
     no game mode. Then "BB raise 22400" becomes "raise 0", and a flop call comes out 4,000 off
     because the ante is unknown.
   - Source: `hh.js:358` `headerBlinds` requires a currency symbol.
   - Related, in the model path: `parseStakes` (`cards.js:166`) returns `null` when the copied
     stakes carry words (`1/2k bba`, `(2k BBA)`, `NL200`). `readStakesText` (`normalize.js:339`)
     then skips its cross-check. I confirmed it: a draft with `sb 1, bb 2` and stakes `"1/2k"` is
     corrected to 1000/2000, but with stakes `"1/2k bba"` it stays 1/2. The prompt tells the model
     "the server reads these digits too, so a 'k' after the last number is not lost"; that holds only
     for a clean stakes string.
6. **Fast path, a layout headed `NLHE` is declined: 6 of the 15 compact layouts.**
   - Source: `hh.js:45` `limitWord` tests `\bNL[A-Z]?\b`, which cannot match `NLHE`, so hold'em with
     no limit word gives `game: null`.
   - Safe, since the text goes to the model, but the free read is lost.
7. **A stated preflop fold is dropped when the table size is unknown: 5 facts in 5 cases.**
   - Example: `sh-nlh-036` "I open $50, BTN fold": the hand keeps the open and loses the fold.
   - Source: `normalize.js:1021` `stripImplicitFolds`.
   - Low impact, because the replayer folds unmentioned seats anyway.
8. **A lower-case board with tens reads as a texture suffix: 1 case.**
   - Example: `sh-nlh-274` flop `4tt` (4-T-T, typed in lower case) is read as the 4 plus "two-tone".
   - Source: `cards.js:12` `TEXTURE_SUFFIX` is applied before the card count is checked. A flop
     needs three cards, so the one-card reading could be rejected.
9. **`detectGame` misreads (fast path only; no layout in the corpus reached it with a wrong game):**
   "Omaha … 6 handed" as PLO6, `O8` as PLO8, "Big O" as nothing. Source: `hh.js:42-61`.

## Cost

- **Spent: $0.** No key, no model calls.
- **What one parse sends:** a system prompt of 27,767 characters plus the `record_hand` schema of
  12,960 characters, about 10,500 tokens, with one cache breakpoint. Then the text itself, 227
  characters on average and 811 at most. The tool output is a hand draft of about 600 to 1,500
  tokens. `max_tokens` is 8,192, and `tool_choice` forces `record_hand`.
- **Projected at `claude-sonnet-5` prices** ($2 input / $10 output per million tokens; cache reads
  about 0.1×, 5-minute cache writes about 1.25×):

  | Cache state | Per parse | 1,000 parses |
  |---|---:|---:|
  | Warm (cases run back to back) | $0.010–0.018 | **$10–18** |
  | Cold | about $0.03 | about $30 |

- **Under the $10 cap, about 550–900 cases fit with a warm cache.** Run 20 first and measure. The
  projection excludes thinking tokens: Sonnet 5 runs adaptive thinking when `thinking` is omitted,
  and `callTool` retries with thinking off only if the forced tool choice is rejected. The 20-case
  pilot settles that.
- **The `--url` route takes about 34 hours for the full corpus,** because the endpoint allows 30
  parses per hour per admin (`parsePerHour`).

## Needs the owner's clarification

1. **`b25` / `b 25` written as a bare number after the flop.** The readings:
   - (a) 25% of the pot, as solver and GTO Wizard size labels write it (B33, B75).
   - (b) a bet of 25 chips or dollars, the usual meaning in live-cash forum posts ("Flop ($60):
     x, b25, c").
   - (c) in a tournament written in k, a bet of 25,000 with the k left off.

   Today the app asks whenever (a) and (b or c) are both possible: 40% of these actions in this
   corpus, and everything later on the street waits.

   **Suggested preference:** read chips, with thousands where the stakes are written in k. Read a
   percentage only when the post says so (`%`, "pot", "sizes are % pot") or is framed as a solver
   spot ("GTO Wizard", "sim"). Ask only when the number is one of the solver sizes {25, 33, 50, 66,
   67, 75, 100, 125, 150} **and** the chips reading is implausible for the pot. `sh-hw-11` and
   `sh-hw-30` are percentage-meant cases to keep that honest.
2. **`MP` and the table size.**
   - The server (`games.js:199` `roleIndex`) puts MP at seat 1 at 6- and 7-handed, and at seat 2 at
     8- and 9-handed.
   - `eval.js:305` `semanticIndex`, the scorer, puts MP at seat 0 at 6-max and seat 1 at 9-handed.
     So a correct parse can be scored wrong, and the corpus ground truth uses the server's reading.
   - With no table size, "MP" names no seat.
   - Which convention is right? 6-max trackers (UTG, MP, CO, BTN, SB, BB) use the server's.
3. **"Everyone 20k" / "all 100bb deep".** Should that stack go on every dealt seat, which the
   schema cannot say today, or only on the named players, as now?
4. **Calls written with a number.**
   - Players write the call-to total: "raises to 18k, I call 18k".
   - 2+2 converters write the chips added: "calls $14".
   - The prompt says calls need no size, and the server derives them, which is correct either way.
     Confirm the server should keep ignoring the number. It disagrees only when the text is wrong.
5. **`NL200` / `200NL` / `PLO200`.** By the common online convention the number is 100 big blinds, so
   NL200 is $1/$2 ([PokerSkill 2NL](https://www.pokerskill.com/poker-glossary/2nl/),
   [5NL](https://www.pokerskill.com/poker-glossary/5nl/)). One article calls $1/$2 "100NL", which the
   glossary contradicts. The prompt does not mention the form, and `parseStakes` cannot read it.
   Suggested reading: big blind = N/100.
6. **`Stud Hi-Lo` versus `Stud 8`.** Both are game ids in `games.js`, and `canonicalGameName("stud
   hi-lo")` returns `Stud Hi-Lo`. Are they the same game?
7. **An effective stack in a big-blind-ante game.** Does "40bb eff" include the 1bb ante the big
   blind has already posted? The corpus assumes the stack before the ante.
8. **Lower-case `4tt`.** Suggested reading: a 4 and two tens, because the flop needs three cards. A
   one-card reading with a texture suffix is impossible.
9. **`3!` / `4!`.** These are already in the prompt as 3- and 4-bets, and the corpus uses them that
   way. I found no glossary that defines them; general shorthand guides list only `3bet`/`3b`
   ([PokerSkill abbreviations](https://www.pokerskill.com/blog/poker-abbreviations/),
   [PokerNews: three bet](https://www.pokernews.com/pokerterms/three-bet.htm)). The reading rests on
   the forum posts collected for the existing corpus. Fine as is, unless the owner knows of another
   meaning.

## Other findings

- **The Admin live eval cannot work as wired** (Summary, second point). In `eval.js` the default
  `module` mode (line 1559) calls `parseHand({ text, source, hints })` with no `client`. `parseHand`
  then hits `callTool(undefined, …)` (`lib/quick-add.js:222`), and `mapApiError` turns that into a 504
  "Could not reach the parser". The fix belongs in `eval.js`: build an Anthropic client from
  `ANTHROPIC_API_KEY` and pass it. I left it alone, because the brief said not to change code.
- **This box's C: drive is full** (0.00 GB free at 04:00). One old Claude session's temp folder
  (`%LOCALAPPDATA%\Temp\claude\D--projects-scheduler\8201d6d6-…`, from 2026-09-27) holds 8.7 GB. Tool
  output and pm2 logs live on C:, and one of my file writes was truncated to 0 bytes by it. I deleted
  nothing. The scratch work was moved to `D:\scratch\qa-shorthand`.

## How to rerun

Validate the corpus and print its coverage (**Mac or PC**, the same command):

```bash
node test/quick-add/eval.js --dry-run --corpus test/quick-add/shorthand-corpus.json
```

To score against the real model, the direct mode needs the client fix above first. Until then, use
the endpoint on a scratch server with an admin token. Thirty parses an hour per admin means about 34
hours for all 1,000; `--limit 20` is the pilot.

**Mac:**
```bash
node test/quick-add/eval.js --corpus test/quick-add/shorthand-corpus.json --url http://127.0.0.1:3199 --token "$ADMIN_JWT" --limit 20
```

**PC (PowerShell):**
```bash
node test/quick-add/eval.js --corpus test/quick-add/shorthand-corpus.json --url http://127.0.0.1:3199 --token $env:ADMIN_JWT --limit 20
```

To break a run down by notation family, use each case's tags: `--filter b-bare-number`, `--filter
size-k`, `--filter s:tweet` and so on. The generator, the fast-path module, the literal reader and
the analysis scripts are in `D:\scratch\qa-shorthand`, outside the repo.
