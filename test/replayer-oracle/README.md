# The replayer against an outside engine

The replayer has three readers of a saved hand, each with its own arithmetic: the felt
(`HandReplayerView.jsx`), the hand-history export (`utils/hand-history/`) and the share link
(`utils/hand-shorthand.js`). A test that compares them with each other only proves they agree.
This folder holds them to an engine nobody here wrote.

**PokerKit** (University of Toronto, MIT licence, peer-reviewed) plays random hands: it decides
whose turn it is, what is legal, the stud bring-in and who opens each street, the draw order, and
it ranks every hand. `generate.py` then settles each pot to the TDA rules the app follows and
writes the hand as the app saves it, with every seat's final stack beside it. PokerKit's own
payout is checked against that settlement on every hand; the few places it settles differently are
each tagged with the reason, and any other difference stops the run.

## What is checked

| Check | Reader | Run |
|---|---|---|
| `check-export.mjs` | the export's settlement (`prepareHand`) | every hand, pure Node, seconds |
| `check-shorthand.mjs` | a share link, encoded and decoded | every hand, pure Node, seconds |
| `scripts/check-replayer-oracle.mjs` | the felt, in WebKit, to the End; every Nth hand also by its share link, signed out | a few seconds a hand |

All three need every seat to finish on the oracle's stack, to the cent.

`corpus.jsonl` is 60 hands of each of 20 games: half the most telling of a thousand (odd chips,
ties, side pots, straddles, every hand PokerKit settles differently), half ordinary. Games: NLH, PLH,
LHE, PLO, PLO5, PLO6, LO Hi, PLO8, NLO8, O8, Big O, PLO6 8/b, Stud Hi, Stud 8, Razz, 2-7 TD,
PL 2-7 TD, Badugi, NL 2-7 SD, PL 5CD Hi. Tables from heads-up to ten-handed, cash (dollars and
cents) and tournament (some with a big-blind ante), short and deep stacks.

**Mac or PC** (identical):

```bash
npm run test:replayer-oracle
```

```bash
npm run check:replayer-oracle -- --per-game 20
```

The second needs the built app (`vite-app`: `npm run build`) and boots its own scratch server on
ports 4840-4849. `--build <folder>` serves another build folder, for a check while something else
is reading `public-vite`.

## The rules the settlement follows

- Side pots in layers; a player's chips count in every layer they reached, folded or not.
- A big-blind ante is dead money in the main pot, and a short big blind posts the blind before the
  ante (TDA).
- A hi-lo pot's odd chip goes to the high half. Among tied players, one chip each from the first
  seat left of the button.
- In stud, razz and each half of stud hi-lo, a tie's odd chip goes to the high card by suit in the
  best five (spades, hearts, diamonds, clubs; the ace is low in a low hand and in a wheel). TDA 2015
  v1.0, "Odd Chips".
- A hi-lo pot, main or side, with no qualifying low among its own players goes to its high hand.
- Cash amounts are exact cents; the felt shows whole dollars.

Where PokerKit differs, and the tag a hand carries: it gives a tie's whole remainder to one player
(`pk-remainder-to-one`), layers a big-blind ante as a live bet (`pk-bb-ante-live`), splits the low
half of a side pot among all its players when only an outside player has a low
(`pk-low-half-unclaimed`), layers pots after killing the beaten hands (`pk-layers-after-killing`),
and hands a stud tie's odd chip out by seat (`pk-odd-chip-by-seat`).

## Making more hands

PokerKit is not a dependency of the app. It goes in a throwaway virtual environment, Python 3.11
or later.

**Mac:**

```bash
python3 -m venv ~/pkenv && ~/pkenv/bin/pip install pokerkit==0.7.7
```

```bash
~/pkenv/bin/python test/replayer-oracle/generate.py --per-game 1000 --seed 7 --out /tmp/hands.jsonl
```

```bash
node test/replayer-oracle/check-export.mjs /tmp/hands.jsonl && node test/replayer-oracle/check-shorthand.mjs /tmp/hands.jsonl
```

**PC (PowerShell):**

```bash
python -m venv $env:TEMP\pkenv; & $env:TEMP\pkenv\Scripts\pip.exe install pokerkit==0.7.7
```

```bash
& $env:TEMP\pkenv\Scripts\python.exe test\replayer-oracle\generate.py --per-game 1000 --seed 7 --out $env:TEMP\hands.jsonl
```

```bash
node test\replayer-oracle\check-export.mjs $env:TEMP\hands.jsonl; node test\replayer-oracle\check-shorthand.mjs $env:TEMP\hands.jsonl
```

`--games "NLH,Razz"` limits the games; `--pick 60` writes only 60 of each (how `corpus.jsonl` was
made, from `--per-game 1000 --seed 1`). A failing hand prints its id; `--show "<id>"` on either
check prints that hand, what the reader made of it and what the oracle expects.

## Not covered

The generator plays the twenty games above. The other games in the picker (the Dramahas, Archie,
Razzdugi and the rest, double boards, bomb pots, run-it-twice) have no outside engine to hold them
to; `npm run check:replayer-games` and the unit tests cover those. These checks start from a saved
hand: typing one in through the entry screens is `npm run check:replayer-games`' ground.
