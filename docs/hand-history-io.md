# Hand-history I/O — PokerStars-format export, and the import framework

Saved hands leave the app as **PokerStars-format hand-history text**, the format PokerTracker 4
(PT4), Hold'em Manager, Hand2Note, GTO Wizard and fpdb all import. The same format reads back in
through `lib/hh-import/`, a registry of site parsers that is the groundwork for importing the hands
the owner plays elsewhere — WSOP.com (PA) first, once a sample of its replay data exists (§9).

| Where | What |
|---|---|
| `vite-app/src/utils/hand-history/` | the writer: `index.js` (API), `prepare.js` (normalise, seat, replay the betting), `settle.js` (pots and shares), `describe.js` (hand descriptions), `fast-high.js` (the high-hand scorer), `pokerstars-writer.js` (lines), `ps-format.js` (tables shared with the parser), `canonical.js` (comparison form), `errors.js`, `save.js` (UI delivery only) |
| `lib/hh-import/` | `index.mjs` (registry), `pokerstars.mjs` (parser), `wsop-replay.mjs` (placeholder), `errors.mjs` |
| `test/hh-io.test.mjs`, `test/hh-io/` | `npm run test:hh-io`; fixtures (`make-fixtures.mjs` writes them), goldens, an independent line grammar |
| `scripts/hh-convert.mjs` | `write <hands.json>` / `parse <file.txt>` from the command line |
| UI | `HandReplayerView.jsx`: the replay's Share sheet tile, the Saved Hands heading's **Export for PokerTracker** and its sheet |

The code is plain ES modules inside `vite-app/src`, so Vite serves it and Node tests import it
directly; `lib/hh-import/*.mjs` imports it from there. (Widening Vite's `server.fs.allow` to the
repo root would expose `poker-tournaments.db`, which holds live backer tokens.)

## 1. What it does, and PT4's scope

- One hand from the replay's **Share** sheet: a `.txt` of that hand. Every hand from **Saved
  Hands → Export for PokerTracker**: "Hold'em and Omaha" (what PT4 analyses) or "Every game".
- Web: a download, always (even where Web Share exists — Windows Chrome's share dialog is not where
  a .txt for PT4 belongs). Native app (iOS, Android, Mac Catalyst): the OS share sheet. The native
  path cannot be exercised on the Windows box; only the `mode` branch in `save.js` differs.
- **PT4 analyses Hold'em and Omaha only** (PokerTracker, Wikipedia: "for both Texas Holdem and Omaha
  players"). Stud and draw are written correctly — Hold'em Manager 2 and fpdb read them — and the
  UI says PT4 skips them.
- **PT4 reads these as PokerStars hands.** PT4 has no "other site" for this format, so they land
  under PokerStars, with PokerStars' rake and stake assumptions. The sheet recommends importing them
  into a database of their own.
- The Hands tab is admin-only, so the export is too.

## 2. The writer's API

```js
writePokerStarsHand(hand, opts) -> { text, handId, warnings, lines }   // throws HandExportError
writePokerStarsFile(entries, opts) -> { text, written: [{ index, handId }], skipped: [{ index, code, message, short }], warnings }
//   entries: [{ hand, playedAt: Date }] — sorted by playedAt; UTF-8 BOM, CRLF, three blank lines after every hand
checkExportable(hand, opts?) -> { ok: true, pt4, gameName, warnings } | { ok: false, code, message, short }
prepareHand(hand, opts) -> { model, events, meta, settle, warnings }   // model = the hand the text encodes
handHistoryId(hand, opts?) -> '8' + 15 digits
canonicalHand(hand) -> comparison form (tests)
```

`opts`: `site` (default `'PokerStars'`; `/^[A-Za-z][A-Za-z0-9 .'-]{0,30}$/`; PT4 recognises only
PokerStars), `heroName` (the UI passes realName || username), `playedAt` (a Date; required for one
hand unless the hand was imported with one), `tableName`, `maxSeats`,
`tournament: { id, buyIn, fee, currency, level }`, `showFoldedCards` (default false), and for files
`eol` (default `\r\n`) and `bom` (default true). Pure: no `Date.now()`, no DOM, no React — the same
input gives the same bytes.

**Errors** (`HandExportError`: `code`, `message` for the sheet, `short` for a 17g tile):

| code | short | message |
|---|---|---|
| unsupported-game | No PokerStars format for this game | PokerStars format has no {game} |
| unsupported-currency | Its currency has no PokerStars form | PokerStars format has no {CODE} cash games |
| seating | The seats can't be placed | The players' positions don't fit a {n}-handed table |
| stack-missing | A stack is missing | {Name}'s stack isn't recorded |
| blinds-missing | The stakes aren't recorded | The blinds aren't recorded |
| hero-cards-unknown | Your cards aren't recorded | Your hole cards aren't recorded |
| cards-missing | A card is missing | {Name}'s {street} card isn't recorded |
| duplicate-cards | A card appears twice | {card} appears twice in the hand |
| board-missing | A board card is missing | The {flop/turn/river} isn't recorded |
| out-of-turn | The betting doesn't add up | {Name} acts out of turn on the {street} |
| bad-action / bad-amount | The betting doesn't add up | {Name}'s {action} on the {street} doesn't add up |
| unfinished | The hand isn't finished | The hand stops on the {street} before it's decided |
| no-winner | The winner isn't recorded | Who won at showdown isn't recorded |
| draw-cards-unknown | Your drawn cards aren't recorded | The cards you drew aren't recorded |

`blinds-missing` and `duplicate-cards` are additions to the spec's list (a hand with no big blind,
and a card twice among the cards the text shows). **Warnings** never block: `folded-cards-dropped`,
`winners-from-cards`, `names-changed`, `description-unverified`, `opponent-cards-unknown`.

## 3. Games

| gameType | Header | PT4 |
|---|---|---|
| NLH / PLH / LHE | Hold'em No Limit / Pot Limit / Limit | yes |
| PLO; PLO5; PLO6 | Omaha Pot Limit; 5 Card Omaha Pot Limit; 6 Card Omaha Pot Limit | yes |
| PLO8 / O8 | Omaha Hi/Lo Pot Limit / Omaha Hi/Lo Limit | yes |
| Big O / Big Easy | 5 Card Omaha Hi/Lo Pot Limit / 6 Card Omaha Hi/Lo Pot Limit | yes |
| LO Hi | Omaha Limit | yes |
| Stud Hi | 7 Card Stud Limit | no |
| Stud 8, Stud Hi-Lo | 7 Card Stud Hi/Lo Limit | no |
| Razz | Razz Limit | no |
| 2-7 TD, L 2-7 TD | Triple Draw 2-7 Lowball Limit | no |
| PL 2-7 TD | Triple Draw 2-7 Lowball Pot Limit **(unverified)** | no |
| NL 2-7 SD | Single Draw 2-7 Lowball No Limit | no |
| PL 5CD Hi | 5 Card Draw Pot Limit | no |
| Badugi | Badugi Limit | no |

Anything else is `unsupported-game` (A-5 TD, Badeucy, Badacy, 2-7 Razz, NL/PL stud, OFC, custom
games, `Super `/`Action ` games). A `PLO` hand dealt five or six hole cards is written as 5 or 6 Card
Omaha. **PLO5 and PLO6** are now in `HAND_CONFIG` (and its copies in `quick-add/game.js` and the
server's `lib/quick-add/games.js`, which `test/quick-add/server.test.js` holds equal); the game
picker still maps PLO5/PLO6 to PLO (an owner decision). The share-link codec already had `P5`/`P6`.

## 4. The line grammar, and where each construct was seen

Sources: genuine PokerStars hands in fpdb's regression samples
(`github.com/ChazDazzle/fpdb-chaz/tree/chazdazzle/pyfpdb/regression-test-files`, `cash/Stars` and
`tour/Stars`, 2005–2024) and fpdb's parser `PokerStarsToFpdb.py` (GPL; read as a reference, nothing
copied). `test/hh-io/ps-grammar.mjs` holds one regex per construct with the sample it came from.

- **Cash header**, two spaces after the colon:
  `PokerStars Hand #211860382557:  6 Card Omaha Pot Limit ($0.25/$0.50 USD) - 2020/04/12 13:14:23 ET`.
  Stakes are `sb/bb`; limit games and stud `bb/bigBet` (`7 Card Stud Limit ($0.04/$0.08 USD)`,
  `Hold'em Limit ($0.05/$0.10 USD)` with `posts big blind $0.05`).
- **Tournament header**: `…: Tournament #288463329, $10+$1 USD Hold'em No Limit - Level IV (50/100) - … ET`;
  a freeroll is `Freeroll  Hold'em` (two spaces). Level in roman numerals.
- **Date**: America/New_York wall clock labelled `ET` all year; the hour unpadded (`2013/03/29 3:47:12 ET`).
- **Table**: `Table 'Armida III' 6-max Seat #4 is the button`; stud `Table 'Atalante II' 8-max`.
- **Seats**: `Seat 4: Player0 ($2037.50 in chips)`, ascending seat number. Modern Stars writes no
  trailing spaces (2023–24 samples); the parser accepts the older trailing spaces.
- **Forced bets**, antes first: `posts the ante 120`, `posts small blind $3`, `posts big blind 360 and is all-in`.
  A big-blind ante is one ante line by the big blind **(unverified at Stars: every Stars sample has
  per-player antes)**. Straddles: `posts straddle $4` **(unverified in PT4; fpdb's re_PostStraddle)**.
- **Streets**: `*** HOLE CARDS ***`, `*** FLOP *** [Tc 7s 8h]`, `*** TURN *** [Tc 7s 8h] [6d]`,
  `*** RIVER *** [Tc 7s 8h 6d] [9h]`; stud `*** 3rd STREET ***` … `*** 6th STREET ***`, `*** RIVER ***`;
  draw `*** DEALING HANDS ***`, `*** FIRST DRAW ***` … `*** THIRD DRAW ***`. Single draw and 5 Card
  Draw have no draw header: the discards follow the pre-draw betting (`2-7 Single Draw-NL-USD-…allin`,
  `5-Carddraw-PL-USD-0.50-1.00`).
- **Dealing**: `Dealt to Hero [Qs Jd]`; stud `Dealt to Nikolay Zem [7d Td] [3d]` (live players, seat
  order; the 7th card the hero's only); draw `Dealt to Hero [5c 7s 2h] [8s]`, kept cards in held order.
- **Actions**, verbs from the chips: `folds`, `checks`, `calls $14`, `bets $22`, `raises $4 to $6`,
  `brings in for $0.02`; a stud complete is `raises $0.02 to $0.04`, the bring-in seat completing
  directly `bets $0.04`; ` and is all-in` exactly when the stack reaches 0.
- **Draws**: `discards 1 card [Jh]` (cards for the hero, or anyone whose discards are known),
  `discards 2 cards`, `stands pat`, `stands pat on [2s 7d 4d 6d 8s]`.
- **Uncalled bets**: `Uncalled bet ($0.95) returned to Hero` after the street's last action — the walk
  included (`Uncalled bet ($0.03) returned to bigsergv`).
- **Showdown** (`*** SHOW DOWN ***`): **pot by pot, the highest side pot first** — the players in for
  that pot who have not shown yet show, then that pot's collects — as Stars writes it
  (`PLO-FR-USD-0.01-0.02-201006.sidepots`: shows, `collected $0.29 from side pot-2`, a show,
  `collected $0.88 from side pot-1`, a show, `collected $2.35 from main pot`). The spec said "all
  shows, then collects"; the genuine order was taken. A hi/lo half is its own line, the high half
  first, each share in seat order from the button (`PLO8-9max-USD-STT-5.00-200505.hero.quartered`:
  `Hero collected 43`, `Player5 collected 22`, `Hero collected 21` from one side pot); a player who
  scoops both halves gets two lines. `mucks hand` for a loser without cards; a winner with unknown
  cards gets no line. The order of showing: the last bettor or raiser on the final betting street,
  else the first player in that street's order, then clockwise.
- **No showdown**: `Fin collected 200 from pot` then `Fin: doesn't show hand`.
- **Summary**: `Total pot $1 | Rake $0.05`; `Total pot 1920 Main pot 1680. Side pot 240. | Rake 0`;
  `… Main pot $2.35. Side pot-1 $0.88. Side pot-2 $0.29. | Rake $0.18`. `Board [Tc 7s 8h 6d 9h]`.
  Seats: `(button)`, `(small blind)`, `(big blind)`, heads-up `(button) (small blind)`; `folded before
  Flop (didn't bet)`, `folded on the Turn`; stud `folded on the 3rd Street (didn't bet)`, `on the 5th
  Street`; triple draw `folded before the Draw (didn't bet)`, `folded after the 1st Draw`; Single Draw
  2-7 pre-draw `folded before Flop` (observed quirk); 5 Card Draw `folded before the Draw`, `folded
  after the Draw`; Single Draw after the draw `folded after the Draw` **(unverified)**; `showed [..]
  and won ($1916.50) with …`, `showed [..] and lost with …`, `collected ($0.95)`, `mucked`.
- **Descriptions**: `high card Ace`, `a pair of Aces`, `two pair, Kings and Deuces`, `three of a kind,
  Deuces`, `a straight, Six to Ten`, `a straight, Ace to Five`, `a straight, Deuce to Six`, `a flush,
  Queen high`, `a full house, Kings full of Deuces`, `four of a kind, Aces`, `a straight flush, Five
  to Nine`, `a Royal Flush`; lowball `Lo: 9,8,7,6,3`, `Lo: a pair of Fives`; razz `Lo: T,5,3,2,A`;
  hi/lo `HI: a straight, Ace to Five; LO: 5,4,3,2,A`, `HI: …` alone with no low; badugi
  `Badugi: 8,4,3,A` / summary `a Badugi: 8,4,3,A`, three cards `3-card: T,7,2` / `a 3-card: T,7,2`
  (observed, `LBad-USD-MTT8-201011`). Kicker suffixes (`- Ace kicker`), which Stars adds only to break
  a tie, are not written. A razz hand with no five unpaired cards is described by its high hand
  **(unverified)**.

**Validation against genuine Stars.** Of the 1,657 hands in the 157 Stars-format sample files,
the parser reads 1,453; every one replays through the writer's own code to Stars' total pot, and on
rake-free hands to every player's collects. The other 204: 162 `unsupported-feature` (74 NL Omaha
Hi/Lo, 35 limit 5 Card Draw, 28 an extra big blind posted by a new player, button-blind 6+ Hold'em,
cash-outs, cancelled hands, run it twice, Courchevel), 13 `unsupported-currency` (play money, INR,
converted files with no currency), 19 `malformed` (truncated or concatenated files, an empty turn
card, a five-card flop, other sites' converters), 6 `inconsistent` (Hold'em Manager and converter
exports whose pots do not add up), 2 `unsupported-game`, 1 `seating` (a 2005 hand with the big blind
on the button), 1 with no hole cards for the hero. Re-written by the writer, the
741 rake-free ones match the originals on 98.2% of lines. The differences: cards Stars revealed
only in the summary (`mucked [..]`) are written as shows; pre-2010 Stars wrote no `doesn't show
hand` and pre-2006 no `N-max`; bounty seat suffixes are not carried; names lose brackets; a
heads-up home-game stud hand posts its antes from another seat.

## 5. Seats, ids, timestamps, names

- **Seats**: the model's index order is clockwise (index 0 first to act preflop; BTN, SB, BB last),
  numbered 1..n unless the hand was imported (`import.seatNumbers`), so with n ≥ 4 the button is seat
  n−2. Max seats: `opts.maxSeats`, else the import's, else 2/6/9/10 by player count (stud 8).
- **Hand id**: an imported Stars hand keeps its number (when written under the same site name);
  otherwise `'8' + (FNV-1a 64 of the poker content mod 10^15)` — 16 digits, above PokerStars' 12,
  within a signed 64-bit integer. The content is gameType, mode, currency, blinds, positions and
  stacks, hero, streets (cards, actions, draws), result — never names, title, notes, felt, visuals or
  quick-add state. So renaming keeps the id; **an edited hand is a new hand in PT4** (owner decision).
- **Tournament id**: `opts.tournament.id`, else the import's, else `'7'` + 9 digits from the ET day
  and the game — a day's hands of one game group as one tournament in PT4. Level 1, freeroll unless given.
- **Time**: the saved row's `created_at` (UTC from SQLite) — the save time, not the play time
  (owner decision). ET is computed with `Intl` (America/New_York), so DST is right on both sides.
- **Names**: control characters, `:`, `(`, `)`, `[`, `]` become spaces, whitespace collapses, 30
  characters; empty → `Player{seat}`; duplicates (case-insensitive) get ` 2`, ` 3`; the hero first,
  renamed to `heroName`. The table: `futuregame` (cash) or `{tid} 1`.

## 6. Settlement

Mirrors the replayer's `settled` / `allPotLayers` / `potAwards` (HandReplayerView.jsx) and uses the
engine's `hiLoWinnersAmong`, `potLayerWinners`, `computePotAwards`. Integer hundredths throughout.
- Each street's uncalled excess (top contribution over the second, folded players included) goes back.
- Layers from the distinct totals of live all-in players; folded players' chips count in the layers
  they reached. A big-blind ante is dead money in the main pot (as the replayer). **Stud antes are
  layered** — a player all-in on the ante plays for a pot of antes (Stars' "Main pot 320. Side pot
  300."); the replayer treats every ante as dead money.
- A layer is won by the cards when every live hand is known and scorable, else by the stored
  winners (a layer no stored winner reached goes to its own players). Cards beat a disagreeing stored
  result (`winners-from-cards`). No winner → `no-winner`.
- Split per layer and per half: the odd chip to the high half, then one at a time from the first seat
  left of the button. Whole tournament chips when every pot is whole; cents otherwise.
- When everyone else still in is all-in, a call is capped at the most any of them has in — Stars'
  `calls 180` to a 480 all-in over a short 360 big blind. The replayer's own full call (300) is
  accepted too; its excess comes back uncalled.
- Invariants, asserted: chips in = collects + uncalled; total pot = Σ collects = Σ pots.

High hands are scored by `fast-high.js`, poker-engine's exact score without its per-combination
allocations (a 20,000-hand property test holds them equal); 1,000 hands write in ~0.4 s of CPU.

## 7. What does not survive the trip

Title, notes, felt and visuals; quick-add state; a straddle's *type* (it comes back seat-derived:
utg, button or Mississippi/rock); folded players' cards (dropped unless `showFoldedCards`); rake
(always written as 0, an import keeps Stars' in `import.rake`); per-player antes on import (become a
big-blind ante, §8); opponents' draw cards that cannot be traced back from their shown hand; a stud
opponent who mucked at showdown loses his door card in the replayer's own storage (`MUCK` replaces
3rd street), so such a hand is `cards-missing`.

**The stud layout** (from HandReplayerView.jsx's stud showdown form, `toggleSdCard`, which prepends):
an opponent's 3rd street holds their hidden cards in front of the door, newest pick first — `h7 h2
h1 door`; 4th–6th hold one up card each; a card in their 7th-street slot is the 7th down card.
Stars writes `[h1 h2 door 4th 5th 6th h7]`. The hero's 3rd street is `down down door`. This was
read from the entry form's code (`opps[oppSlot] = card + (opps[oppSlot] || '')` on 3rd street for
each showdown pick) and from `quick-add/betting.js` `doorCard` (the door is the LAST card there);
it was not re-checked by saving a stud showdown through the entry form. Which hidden card is the
7th is not recorded by that form at all: the writer takes the last one picked.

## 8. The importer framework

```js
// a site parser
{ id, label, detect(text) -> boolean, parse(text, { onError }) -> Hand[] }
// lib/hh-import/index.mjs
PARSERS = [pokerstars, wsopReplay]; getParser(id); detectSite(text) -> id | null
parseHandHistory(text, { site }) -> { site, hands, errors: [{ index, handId, code, message, excerpt }] }
//   throws HandHistoryError 'unknown-format' when nothing detects; a parser's 'needs-sample' propagates
```

Nothing mounts it yet; `server.js` (CommonJS) can `await import('./lib/hh-import/index.mjs')`.

**The PokerStars parser** detects a first line like `PokerStars [Zoom|Rush|Home Game] Hand|Game #N:`
plus a `*** SUMMARY ***`; reads cash and tournament headers, `Game #` (old) and `Hand #`, a mix form
(`HORSE (Razz Limit)`, `8-Game (7 Card Stud Hi/Lo Limit, $400/$800 USD)`) into `import.mix`, the ET
time (also the 2007 `- 05:34:03 (ET)`). Players dealt in are those with a summary seat line. Seats
rotate so index 0 is the seat after the big blind (stud: ascending); the button is the stated one,
or the seat before the small blind. Amounts become chips added. Opponents' cards come from shows and
summary `showed/mucked [..]`. Per-player antes in flop games become a big-blind ante of the same
total, each stack moved so the chips behind are exact (noted in `import.notes`). A fold by a player
already all-in (Stars writes one for a sitting-out player put all-in by a blind) is kept. Chat,
joins, timeouts, "deck is reshuffled", "Pair on board" and tournament results are ignored. Then the
hand is replayed the writer's way: the total pot must come out as stated, else `inconsistent`.

Skipped with `unsupported-feature`: run it twice, `posts small & big blinds`, a second big or small
blind, `posts button blind`, cash out, `Hand cancelled`, Courchevel, 6+ Hold'em, Split Hold'em, NL
Omaha, 5 Card Draw NL/limit, capped cash games. `unsupported-game`: games outside §3.
`unsupported-currency`: play money and INR. `malformed`: an unknown `Name: verb` line (excerpt kept).

Output: the replayer model plus `import: { site:'pokerstars', siteName, handId, tableName, maxSeats,
seatNumbers, playedAt (ISO UTC), tournamentId?, buyIn?, level?, mix?, rake?, notes }`. The writer
reuses every one of them, so `write(parse(text)) === text` for its own output.

**To add a site**: a module exporting `{ id, label, detect, parse }` (parse returns hands in the
model above, ideally consistency-checked through `prepareHand`), listed in `PARSERS`; tests beside
`test/hh-io.test.mjs` section H.

## 9. What the WSOP.com sample must contain

The WSOP.com client keeps hands on WSOP's servers and shows them in a replay viewer; it writes no
hand-history files. `wsop-replay` refuses with "needs a sample" until the format is known. Needed:
- a **HAR** of the replay viewer loading **3 hands**: one to showdown, one won without one, one
  multi-way all-in (side pots);
- **cookies and auth headers stripped** (Authorization, Cookie, Set-Cookie, any token query
  parameter);
- the **hand ids as the client shows them**, to match requests to hands.

## 10. The owner's PokerTracker 4 check

1. `node scripts/hh-convert.mjs write test/hh-io/fixtures/01-nlh-cash-3bet.json > one.txt` (or export
   from the app: Hands → Export for PokerTracker → Hold'em and Omaha).
2. In PT4, create a new, empty database; Get Hands from Disk → the .txt.
3. Check: the hands import with no errors; Hero is the hero; positions, stacks, blinds, antes and
   straddles; every action and amount; uncalled bets; side pots and hi/lo splits (Omaha Hi/Lo,
   the quartered fixture 18); won/lost amounts match the replayer; the dates read in ET.
4. Import the same file again: PT4 should report duplicates (dedupe by site + hand number is
   forum-sourced; **to be confirmed by this import**).
5. Report anything PT4 rejects or misreads, with the hand number.

## 11. Owner decisions (defaults built; each a single switch)

1. Played time: the save time. 2. Tournament header: freeroll, one id per game per ET day. 3. Hero
name: realName || username. 4. Opponent names: as stored. 5. Folded opponents' cards: dropped.
6. Edited hands: a content-hash id, so a new hand in PT4. 7. PLO5/PLO6: config added, picker
unchanged. 8. Per-player antes on import: a big-blind ante. 9. Straddles: `posts straddle`.
10. Export scope: Hold'em and Omaha, or Every game. 11. The PT4 import of the golden file (§10).
12. Open Hand History: not now — but note PT4 4.17.13 (2024-01-21) added generic OHH import, "imported
as the generic OHH site", which would avoid hands landing under PokerStars.

## 12. Sources

- fpdb PokerStars parser (game and limit names, verbs, collect / uncalled / rake lines; GPL, reference
  only): https://github.com/ChazDazzle/fpdb-chaz/blob/master/pyfpdb/PokerStarsToFpdb.py
- Genuine PokerStars samples per game: https://github.com/ChazDazzle/fpdb-chaz/tree/chazdazzle/pyfpdb/regression-test-files (`cash/Stars`, `tour/Stars`)
- PT4 analyses Hold'em and Omaha: https://en.wikipedia.org/wiki/PokerTracker
- Open Hand History: https://hh-specs.handhistory.org/
- PT4 4.17.13 adds generic OHH import: https://mac.softpedia.com/progChangelog/PokerTracker-Changelog-136110.html (via search; the page returns 403 to fetches)
- PT4 duplicate detection by hand number: forum-sourced, unverified (§10 step 4).
