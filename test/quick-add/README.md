# Quick-add hand histories: corpus and evaluation

Part D of quick-add (design: `docs/quick-add-hands.md`; contract: `docs/quick-add-contract.md`).
A corpus of hand descriptions written the way players type and dictate them, and a script
that runs them through the parser and the gaps engine and scores what comes back.

```
test/quick-add/
  corpus/*.json   88 cases: nlh-cash, nlh-mtt, omaha, limit-flop, stud, draw, mixed
  eval.js         validator + runner + scorer (Node 18+, no dependencies)
  reports/        timestamped .md + .json reports (local output; do not commit)
```

## Running it

Every mode prints a summary. Every mode except `--dry-run` writes
`reports/<timestamp>-<mode>.md` and `.json`.

**Validate the corpus and print coverage.** This needs nothing else, so run it after editing a case:

**Mac or PC:**
```bash
node test/quick-add/eval.js --dry-run
```

It checks the schema, card notation, duplicate cards, card counts per game, draws, and
replays every action against the stakes: turn order, call amounts, minimum raises,
pot-limit maximums, limit bet sizes and the bet cap, stack sizes, and the stud bring-in.
It also confirms that each case's own "oracle" hand scores 100%, which tests the scorer.
It exits 1 on any error.

**Score the gaps engine on its own** (once `vite-app/src/utils/quick-add/gaps.js` exists).
This feeds `findGaps` a perfect parse built from each case's expectations. Parse scores are
100% by construction, so the gap numbers measure part A alone:

**Mac or PC:**
```bash
node test/quick-add/eval.js --oracle
```

**Against a running server.** Use a scratch port with a copy of the DB, never the pm2 app
on 3001, and an admin user's JWT. Every case is one paid model call, so 88 cases cost 88 calls:

**Mac or PC:**
```bash
node test/quick-add/eval.js --url http://127.0.0.1:3199 --token <admin-jwt>
```

**Directly through `lib/quick-add.js`.** This needs a real `ANTHROPIC_API_KEY`, which is set on
Render, not locally:

**Mac:**
```bash
ANTHROPIC_API_KEY=sk-ant-... node test/quick-add/eval.js
```

**PC (PowerShell):**
```bash
$env:ANTHROPIC_API_KEY = 'sk-ant-...'; node test/quick-add/eval.js
```

The module's parse function is found automatically (`parseQuickAdd`, `quickAddParse`,
`parseHandDescription`, `parseDescription`, `parseHand`, `parse`, or the default export) and is
called as `fn({ text, source, hints })`. Use `--export <name>` to pick one. With no parser
available, the script says why and falls back to `--dry-run`.

**Re-score saved parses** after changing the corpus, the scorer or the gaps engine, with no
new API calls:

**Mac or PC:**
```bash
node test/quick-add/eval.js --parses test/quick-add/reports/<stamp>-endpoint.json
```

Useful options: `--filter <text>` (matches id, game or tag; repeatable), `--source speech`,
`--incomplete` / `--complete`, `--limit n`, `--concurrency n` (default 1, because the server
rate-limits per user), `--delay ms`, `--hint-game` (send the expected game as
`hints.gameType`), `--verbose`, `--no-gaps`, `--no-report`, and `--min-recall 0.9` /
`--max-hallucinations 0` to exit 1 below a bar. `--help` lists them all.

## What the scores mean

Facts come only from `expect`. A case lists only what its text states, so a perfect score
means "recovered everything the player said", not "reconstructed the whole hand".

| Score | Meaning |
|---|---|
| **Fact recall** | Expected facts the parse got right. Each blind, each stack, each board street, each action, each draw, each showdown and the winner is one fact. A fact the parse left empty is *missing*; a fact it filled in differently is *wrong*. |
| **Fact precision** | Right ÷ (right + wrong + parsed actions that match nothing expected). Missing facts do not count against precision. |
| **Perfect parses** | Cases with every fact right and no extra actions. |
| **Hallucinated cards** | Concrete cards in the parse that the text never names anywhere. This is the worst failure: the contract says never invent cards. |
| **Invented suits** | The text gave a rank only ("AK", "K72 rainbow", "pocket nines") and the parse filled in a suit. These are reported separately from hallucinated cards. |
| **Hallucinated stacks** | Players given a starting stack the text never stated (for example the replayer's 50,000 default). A stated `effectiveStack` covers everyone who acted. |
| **Invented actions** | Non-fold actions on a street the text never describes. |
| **Gap recall** | Of the gaps an incomplete case should raise (`expectGaps`), how many `findGaps` raised. A gap matches on kind (when given) and on a field or id pattern. |
| **False alarms** | Complete cases on which `findGaps` raised a blocking gap. Look at these, but do not treat every one as a bug: the "complete" cases state the stacks of everyone who played, not always of players who folded before acting, and the engine may reasonably ask about those. The report lists each one. |
| **Latency** | p50 / p90 / max of the parse call, in milliseconds. |
| **Diagnostics** | `raise-to-not-added`: a raise was stored as the raise-to total instead of the chips added (the most likely systematic error). `call-total-not-added` is the same mistake on a call. |

How actions are matched: each street's expected actions are aligned with the parsed ones in
order (longest common subsequence). Seat, verb and amount must all agree. Parsed folds are
ignored unless the case lists that seat folding, because texts rarely mention every fold.
`bet` and `raise` count as one verb, since a stud completion may be stored as either. An
`all-in` matches a bet, raise or call of the same chips. An action whose amount is `null` in
the case (the text gives no amount) matches on seat and verb only.

How seats are matched: a parse that uses the replayer's own labels
(`positionLabels(n)` in `HandReplayerView.jsx`) is read by seat index, so "UTG" finds seat 0
even at nine-handed, where the replayer labels seat 0 "UTG+1". A parse that labels seats its
own way is read by its labels. Stud players are found by their door card.

The report lists the 25 weakest cases. For each one it shows the text, the wrong and missing
facts, the hallucinations, the gaps not raised, the first question the engine would ask, and
the parser's notes. The JSON report holds every parsed hand and gap list, so you can re-score
it with `--parses`.

## The corpus format

Each file is an array of cases:

```json
{
  "id": "nlh-cash-3bet-pot-river-lead",
  "source": "text",
  "game": "NLH",
  "tags": ["cash", "3bet"],
  "text": "$1/$2 live, 9 handed, … UTG opens to 10, folds to me in the CO with AhQh, I 3b to 30 …",
  "expect": { … },
  "expectGaps": [ … ],
  "flaws": [ … ],
  "notes": "optional, for humans"
}
```

- `source`: `text` (typed or pasted) or `speech` (a transcript as the phone's recognizer produces
  it: numbers spelled out, "three bet", "pocket nines", homophones such as "for" for "four", "for
  tea" for "forty", "two ten" for "to ten", and little or no punctuation).
- `game`: the `HAND_CONFIG` game the hand really is, used for coverage. It is set even when the
  text never says which game; in that case `expect.gameType` is left out.
- `expect` keys (all optional; list only what the text states):

| Key | Example | Notes |
|---|---|---|
| `gameType`, `gameMode`, `currency` | `"NLH"`, `"cash"`, `"USD"` | `gameMode` only when the text says cash or tournament |
| `blinds` | `{ "sb": 1, "bb": 2, "ante": 0, "straddle": ["utg"] }` | stud and limit: `bb` is the **small bet**, `bigBet` the big one, plus `bringIn` |
| `players`, `heroPosition` | `9`, `"CO"` | positions are real-world names: UTG, UTG+1, LJ, HJ, CO, BTN, SB, BB; `BTN/SB` heads-up |
| `heroCards` | `"AhQh"`, `"AxKx"`, `"AxAxxx"` | `Kx` = rank known, suit not; `x` = unknown card; stud = two down then the door |
| `heroStreetCards` | `{ "4th": "Kd" }` | stud only |
| `stacks`, `stacksAll`, `effectiveStack` | `{ "CO": 2400 }`, `400`, `2500000` | chips; a ref of `hero` works when the hero's seat is unknown |
| `board` | `{ "flop": "Qs8d3c", "turn": "2h", "river": "Kd" }` | per street; order within the flop does not matter |
| `actions` | `{ "preflop": [["UTG","raise",10], ["CO","raise",30], ["UTG","call",20]] }` | **amount = chips ADDED by that action**, never the raise-to total; `null` = not stated |
| `draws` | `{ "predraw": [["BTN", 1, "Kd", "5c"], ["CO", 2]] }` | `[seat, count, discarded?, new?]`, recorded on the betting round **before** the draw |
| `studUp` | `{ "@Qh": "Qh7c7sJd" }` | an opponent's up cards from 3rd to 6th street |
| `showdown` | `{ "UTG": "KcJc" }` | opponents only; stud lists every card shown |
| `winners` | `["UTG"]` or `{ "refs": ["BTN","BB"], "split": true }` | left out where side pots go to different players |

Street keys: `preflop flop turn river`; `predraw draw1 draw2 draw3` (triple draw);
`predraw draw` (single draw); `3rd 4th 5th 6th 7th` (stud). Stud players are `hero` or
`@<door card>` (`@Kx` when the suit is unknown).

- `expectGaps`: what a correct gaps engine must raise. Each entry is
  `{ kind?, field?, id?, about }`. `kind` is one or more of `missing | ambiguous | impossible`
  (leave it out to accept any). `field` is one or more dotted-path patterns: `*` matches one
  segment, `**` matches the rest, and a pattern also matches anything below it, so
  `streets.0.actions` matches `streets.0.actions.3`. `id` is one or more prefixes of the gap
  id (`stack` matches `stack:2`). A case with `expectGaps` counts as incomplete.
- `flaws`: for incomplete cases that break a rule on purpose (`duplicate-card`, `card-count`,
  `draw`, `betting`). The validator then reports that class of problem as a warning instead of
  an error, and fails if the declared flaw is not actually there.

### Adding a case

1. Write the text the way a player would, not the way the format wants it.
2. Fill in `expect` with what the text states, and nothing it doesn't. Unknown amounts are
   `null`, unknown suits are `x`. For a check or fold the text implies (for example "he bets
   into me" means hero checked first), list it: the validator needs every seat that owes action
   on a street after the flop.
3. Work out every amount as chips added: in "raises to 600, BB 3-bets to 1800, I call", the
   call is 1,200.
4. For an incomplete case, add `expectGaps` for each thing the engine should ask about.
5. Run `--dry-run` until it reports 0 errors.

## Hand-format facts that catch people out

All of these come from `HandReplayerView.jsx`, `hand-shorthand.js` and `utils.js`:

- **Seat labels run out from the front.** `positionLabels(n)` always ends `… CO BTN SB BB`, so
  nine-handed starts at `UTG+1` (there is no `UTG` label), eight-handed at `MP1`, and
  six-handed at `LJ`. The seat index is what matters: index 0 always acts first preflop. The
  corpus writes real-world names; the scorer converts them.
- **`blinds.ante` in a flop or draw game is a big-blind ante**, posted once by the BB and
  counted as dead money (`calcPotsAndStacks`: `isBBante`). The format cannot represent an
  old-style ante from every player outside stud. In stud, every player antes.
- **In stud and limit games `blinds.bb` is the small bet.** `bigBet` defaults to `bb × 2`. A
  stud completion is stored as a `bet`, and the bring-in sets that player's street total
  rather than adding to it.
- **Amounts are chips added.** A blind's post is already counted, so the SB calling a 600 open
  at 100/200 adds 500, and the BB adds 400.
- **Draws are recorded on the betting round before them.** The first draw lives on street 0.
  A pat hand is a draw of 0.
- **An opponent's cards are stored on street 0 for flop and draw games** (their final hand).
  Stud stores them street by street, door card first.
- **Straddles are flags** (`straddle_utg`, `straddle_button`, …) priced `bb × 2, × 4, …` in
  seat order. With a straddle, preflop action starts left of the last straddler, so with a
  button straddle the SB acts first.
