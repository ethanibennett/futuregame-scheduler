# Play-money tables

Live tables where real people play free chips against each other, on the replayer's table, in the
web app and the iOS app. Branch `play-money`. **Not for master before the 5 January 2027 launch,
and never without the owner's yes**: a push to master deploys futurega.me.

This document is read against the code as it stood on 2026-11-22 (master `4de9d50`). The owner's
open decisions are at the end, each with a recommendation.

## 0. What exists and what does not

| Piece | Exists | Where |
|---|---|---|
| The rules of every game the replayer offers: hand values, hi-lo halves, odd chips, side pots | yes | `vite-app/src/utils/poker-engine.js`, `utils/hand-history/settle.js` |
| Settlement held to an outside engine | yes | `test/replayer-oracle/` (PokerKit, 1,200 hands, 20 games) |
| Betting legality (whose turn, min and max raise, reopening, pot limit, limit caps, stud bring-in) | yes, but inside a React component | `HandReplayerView.jsx` ~2620-2700 (turn), ~3020-3130 (sizes); a hand copy in `utils/quick-add/betting.js` |
| The table, its springs, a hand that grows as it is played | yes | `HandReplayerReplayView`'s `drill` prop, `ReplayerDrill.jsx`, `utils/replayer-drill.js` |
| Friends, blocks, reports, pushes per kind, invite tokens | yes | `lib/safety.js`, `lib/player-push.js`, `/i/<token>` |
| A dealer that keeps cards secret | **no** | the trainer's routes send the seed to the browser |
| Tables, seats, a clock, sitting out, reconnecting | **no** | |

About half. What is missing is the server: the dealer and the table runtime.

## 1. The dealer

The trainer cannot be copied. `POST /api/solver/trainer/:game/deal` (`server.js:9764`, the shared
handler at ~9430) returns `{ seed, heroSeat, state }`, and every `/step` replays the hand from that
seed. It is stateless by design, and harmless with one player and a bot: the seed is the whole deck.
At a shared table anyone holding the seed has every card. So the dealer is new code with three rules:

1. **The deck never leaves the server.** Each hand shuffles a fresh deck with Fisher-Yates over
   `crypto.randomInt` (the OS's CSPRNG). No seed, no `Math.random`, nothing derived from the clock.
   The deck is stored with the hand (§3, the journal) and nowhere else.
2. **Every viewer gets their own projection.** The server holds one full state; `viewFor(state, seat)`
   builds what one seat may see: their own hole cards, every up card (stud doors and streets), the
   board, and an opponent's down cards only once they are tabled at a showdown. A draw game sends a
   player their own replacements and everyone else the COUNT drawn. A spectator (later) gets seat
   `-1`: no hole cards at all. Nothing is ever filtered in the browser; the hidden cards are simply
   never serialised into that seat's stream.
3. **Nothing logs a card.** No hole card in a log line, an error message or an SSE comment. A test
   reads each player's raw SSE bytes and fails if any other seat's unshown card appears (§9).

Optional, cheap, not v1 UI: hash the shuffled deck with a per-hand salt at the deal and keep the
hash with the hand, so a hand can later be shown to have been dealt before it was played (decision 9).

## 2. One rules module, shared

Today the legality the server must enforce lives in `GTOEntryView` inside `HandReplayerView.jsx`:

- whose turn it is (`currentActor`, ~2640): the last aggression, an all-in that only calls
  reopening nothing, the walk round the full seat order skipping folded and all-in seats;
- the sizes (~3060-3110): the price, the last FULL raise as the smallest raise (a short all-in raises
  the price, not that size), whether the betting is reopened to a player who has acted (TDA rule 43;
  half a bet in limit), a raise only when someone could call it and the stack covers more than the
  call, pot limit counting a big-blind ante, limit's small and big bets, the cap and
  `uncapHeadsUp`, stud's open pair on 4th street;
- the forced bets (`capPost`, `blindPosted`, `antesPosted`, `getStraddles`, ~1228-1290): blind
  before ante, every post capped at the stack;
- `dropDeadActions`: no betting once all but one player still in is all in.

`utils/quick-add/betting.js` is a second, hand-kept copy (its header lists what it mirrors, and one
deliberate difference in `currentActor`). A third copy on the server is how the stud8 sidecar
drifted; there must be one.

**The move.** A new plain ESM folder, `vite-app/src/utils/poker-rules/`, no React, no DOM:

| File | Holds |
|---|---|
| `forced.js` | `capPost`, `blindPosted`, `antesPosted`, straddles, the stud bring-in |
| `betting.js` | one street's walk: price, last full raise, reopened, `legalActions(state, seat)` returning `{ fold, check, call, bet/raise: { minTo, maxTo } , complete }` in "raise to" totals |
| `order.js` | seat order per street and game family (blinds, stud's best board, draw order), next to act, street over, hand over |
| `hand-state.js` | `apply(state, action)` → new state or a refusal with the legal range; draws; the run-out when no betting is left |
| `settle.js` | a thin door to `hand-history/settle.js` and `prepareHand`, so the dealer settles exactly as the export does |

Then, one reader at a time, each behind the oracle:

1. Build the module from `GTOEntryView`'s code, not from quick add's copy (the entry screen is the
   one `check:replayer-entry-oracle` holds to PokerKit).
2. **A new pure-Node check**, `test/replayer-oracle/check-rules.mjs` in `npm run test:replayer-oracle`:
   every corpus hand replayed through `hand-state.js` action by action; at each step the module's
   actor, price and offer must match what PokerKit allowed (the same `owe` / `minTo` / `noRaise`
   expectations the entry oracle derives), and the hand's end must leave every seat on the oracle's
   stack. Seconds, not minutes, and it runs in `npm test`'s neighbourhood rather than in WebKit.
3. `GTOEntryView` reads the module (its `useMemo`s become calls). `check:replayer-entry-oracle` must
   stay at zero fails.
4. Quick add's `Table` reads it; `test:quick-add` and `gaps.test.mjs` must stay green. The
   `currentActor` difference its header describes is settled in the module, once, by PokerKit.

The server loads the module the way `lib/watch.js:94` loads quick add's `gaps.js`: a dynamic
`import(pathToFileURL(...))` of the client's source. No build step, one file.

Steps 3 and 4 touch the replayer and quick add, which launch on 5 January. They are worth doing on
this branch, but they ship only with the rest of it.

## 3. The table runtime

One `Table` object per table, in memory, journalled.

**A table** has a host, a game (any row of the replayer's picker that the rules module plays, §8),
stakes (blinds and an optional big-blind ante, or limit's small and big bets, or stud's ante and
bring-in), 2 to 9 seats, a starting stack, a clock, and an invite token.

**Seats.** `{ userId, name, stack, state: 'playing' | 'sitting-out' | 'waiting', timeBank,
missedTimeouts }`. A player sits with the starting stack. A seat that joins mid-orbit is `waiting`
until the big blind reaches it (or it chooses to post one to come in now): no dead-button
bookkeeping, and nobody can dodge the blinds by moving.

**The button** moves one occupied, dealt-in seat each hand. Heads-up the button posts the small blind
and acts first before the flop; going from three players to two moves the button so nobody posts the
big blind twice running. Stud has no button: the bring-in and the best board decide (rules module).

**A hand** starts when two or more seats are `playing` and the last hand has finished showing. The
journal row is written first: the deck, the seats, the stacks, the button. Every accepted action
is appended. A restart reloads the journal and the table is where it was (the clock restarts at
full for the player to act).

**The clock.** Each decision has a timer on the server (decision 7: 30 s plus a 60 s bank). At zero
the server checks if a check is free, else folds, and counts a timeout; two in a row sit the player
out. A draw that times out stands pat. The client draws the clock from the server's deadline, so a
slow phone never shows more time than it has.

**Sitting out.** A player can sit out between hands (or at once, folding when their turn comes). A
sitting-out seat is skipped by the deal and keeps its chips; after a set time (host's choice, default
10 minutes) it is stood up.

**Reconnecting.** Leaving the page, losing signal, or the iPhone suspending the web view all look
the same: the stream drops. The seat stays and the clock runs. On reconnect the client fetches its
projection of the whole table (`GET .../state`) and then follows the stream; every event carries a
sequence number, and a gap makes the client fetch the state again.

**Topping up.** Between hands only, up to the starting stack. A busted player is offered a rebuy at
the starting stack at once. Chips are free and belong to the table (decision 2), so a top-up is a
button, not a purchase, and nothing carries off the table.

**Ending.** The host can close the table; it closes after the last hand in progress. An empty table
closes after 30 minutes.

## 4. Transport

No new technology. The app already streams per user over SSE (`GET /api/events`, `sseClients` at
`server.js:4126`), and the compression filter (`server.js:~131`) already leaves `text/event-stream`
alone.

- `GET /api/tables/:id/events`: one SSE stream per viewer per table. Each event is serialised for that
  viewer (§1): `hand-start`, `action`, `street`, `draw`, `showdown`, `result`, `seat`, `clock`,
  `chat-reaction` (later). A heartbeat comment every 15 s keeps proxies and the iOS web view open.
- `POST /api/tables/:id/act { handId, seq, action, to }`: one request per action. `seq` is the action
  index the player saw; a stale one is a 409 with the current state, so a double tap or a retry after
  a dropped reply never acts twice. The server answers with the refusal's legal range when an amount
  is out of it (the entry's rule: refused with the range, never cut).
- `GET /api/tables/:id/state`: the viewer's projection, for joining and reconnecting.
- Host routes: create, settings, close, kick; player routes: sit, sit out, top up, leave.

One round trip per action is tens of milliseconds; the animation that follows takes longer.

## 5. Where tables live

A push to master restarts futurega.me, and the owner pushes to master many times a day. A restart
would end every hand in progress, as it ends a quick-add eval run.

Two answers, and the journal (§3) is needed under either of them:

**A. In the scheduler's process, journalled.** Hands survive a deploy: the new process reloads them.
But every deploy is a pause of the Render restart (the service has a disk, so no overlap): each
push freezes every table for about a minute, a dozen times a day. Simple, and it shares the
scheduler's auth, social tables and `saved_hands` directly.

**B. Its own service (recommended).** The same repository, a new entry point `tables/server.js` running
`lib/tables/`, deployed as:

- a Render web service **futuregame-tables** at `tables.futurega.me`, with a **build filter** on
  `tables/**`, `lib/tables/**` and `vite-app/src/utils/poker-rules/**` (plus the engine and settle
  files it imports), so a scheduler push does not restart it; its own small disk and SQLite for the
  journal;
- on this box, a pm2 app **futuregame-tables** on its own port (never 3001), started with the rest
  at logon by `futuregame-pm2-resurrect`.

Its own deploys are rare, and on SIGTERM it stops dealing, lets hands in progress finish within
Render's shutdown delay (set to the maximum, 300 s), and journals the rest, which resume after the
restart.

The boundary with the scheduler is narrow, and the scheduler stays the owner of people:

| Direction | What | How |
|---|---|---|
| scheduler → tables | who you are | the client asks the scheduler for a **seat ticket** (`POST /api/tables/ticket`), a 2-minute JWT signed with a shared `TABLES_SECRET`, naming the user, display name and the table; the scheduler checks the session (token version, revoked sessions) and blocks before signing. The tables service never sees the account JWT or the user table |
| scheduler → tables | create a table, its invite | the scheduler creates the table row and the invite token (it owns the invite page and the blocks check) and tells the service |
| tables → scheduler | a finished hand | `POST /api/tables/internal/hand` with `TABLES_TOKEN` (constant time, `lib/shared-token.js`), one call per hand, carrying each player's own copy (§6); queued in the service and retried if the scheduler is mid-deploy |

So a scheduler deploy never pauses a table: the stream and the actions go to the tables service, and
a finished hand waits in its outbox for a minute. Under A everything is simpler, but every push is
felt at the table.

`lib/tables/` is written against that boundary (an adapter for auth, social checks and saving a
hand), so for tests and the first slice it can also be mounted inside a scratch scheduler, and
decision 1 changes the deploy, not the code.

## 6. The client

**Where.** A Tables row in Hands, beside Replayer, Study and Scanner (Hands is every account's).
Its list: your open tables, Create a table, tables you were invited to.

**The table** is `HandReplayerReplayView`, in the mode the drill already uses: a hand that grows as
it is played. The drill's contract (`utils/replayer-drill.js` `drillStart`/`drillStep`,
`ReplayerDrill.jsx`) is the starting point:

- the drill keeps the hand at its edge (`atDrillEdge`), plays each server answer forward on the
  springs, and swaps the transport for an action bar (`drill.bar`); a live table does the same with
  every event from the stream, its own and everyone else's;
- the bar is new: Fold, Check/Call, Bet/Raise with the entry's "raise to" box (`AmountField`,
  `parseAmount`, "3bb", "2.5x") and the min/max from the projection's `legal`; a draw game marks
  discards on the felt as the drill does (`drill.discard`);
- an opponent's cards are face down (`xx`) until tabled; the clock is a ring on the acting plaque,
  on the same springs;
- the replayer was built to show a FINISHED hand; the parts that assume one (the result step, the
  street track, notes) are left out while the hand is live, as they are in the drill.

**Every hand saves to Hands.** At the end of each hand the server writes one `saved_hands` row per
player who was dealt in, in the format the replayer already reads, with THAT player as hero:
their own cards, the board, every action, and an opponent's cards only if they were shown. Nobody's
saved copy can hold a card they did not see. The row is tagged with the table (`hand.table`, in the
hand JSON, no schema change) so Hands can filter it, and the replay, the share link and the
PokerStars export work on it as on any other hand.

## 7. The social layer that exists

- **Who can sit.** An invite link joins the table. A new path, `/play/<token>` (`/t/` is the tax
  preparer's and `/p/` a package's): its own revocable token table, noindex, no-store, never the
  share token or a JWT, like every other link (features catalogue, "Links"). The host can also
  invite friends from Connections; a push goes to them.
- **Blocks apply both ways** (`lib/safety.js` `isBlocked`): two people who have blocked each other
  in either direction never share a table. The one joining is told the table is full, as a blocked
  request answers as sent. A block made at the table stands the blocker up after the hand.
- **Reports.** Report a player from their plaque: `reports` kind `'user'`, to Admin's inbox.
- **Pushes.** A new kind `tables` in `lib/player-push.js` (Settings › Notifications): an invite to a
  table, and later "your turn" while the app is in the background. Gated as every player push is
  (`PLAYER_DELIVERY`), so a scratch server never pushes.
- **Chat** is not in v1 (decision 6). A chat is what guideline 1.2 asks moderation of; the reports
  and blocks above already meet it for players, and a few fixed reactions can come later.

## 8. What v1 is

**Private tables.** A host picks the game from the replayer's games, the stakes, seats and stack, and
sends an invite link. Play money only. No public lobby, no bots, no tournaments.

**The games.** Every game the rules module plays, in three waves, each held by the oracle before it
opens:

1. The board games: NLH, PLH, LHE, the Omahas (PLO, PLO5, PLO6, the hi-los, Big O), short deck.
2. Stud, Stud 8, Razz and their variants (up cards in the projection, the bring-in, the best board).
3. The draw games: 2-7 Triple Draw, Badugi, single draw, the Dramahas, Archie and the rest the
   replayer built on 2026-11-05. Their discards are the projection's hardest part. **These are the
   edge**: almost no play-money site deals them.

**Later.** A public lobby, bots (the solver plays only a few games, mostly heads-up: td27, razz,
stud8), sit-and-gos, spectators, leaderboards.

**The first slice** (done = the brief's): two browsers at one private table playing a full NLH hand,
each seeing only their own cards, settled the way the oracle settles it, the hand saved to both
players' Hands. Built on: the rules module (NLH first, the oracle check over the NLH hands), the
dealer, the runtime with the clock and reconnect, the SSE and act routes, the ticket, the invite
link, the bar on the replayer's table.

## 9. Tests, in the repo's style

- `npm test`: the rules module against hand-made spots; the dealer's projection (a seat's view never
  holds another seat's unshown card, a draw sends counts); the runtime with a fake clock (timeouts,
  sitting out, the button going three-handed to heads-up, a waiting seat coming in on the big blind).
- `npm run test:replayer-oracle`: `check-rules.mjs` (§2) beside the export and share-link checks.
- `npm run test:tables`: a scratch server (`test/helpers/scratch-server.js`, its own port range,
  4940-4949) and, under decision 1B, the tables service beside it; two accounts; create, invite, join
  by the link; a full NLH hand over the real routes and streams; each stream's raw bytes searched for
  the other's hole cards; the chips at the end equal to `prepareHand`'s settlement of the full hand;
  a `saved_hands` row for each player, holding only what they saw. A deck can be fixed for a test
  only through a test hook that refuses to load where `RENDER` is set.
- Later: two WebKit contexts at one table (`scripts/check-tables.mjs`), and `check:replayer-collisions`
  and `check:replayer-smooth` on a live hand.

After every run, the scratch servers are killed (CLAUDE.md, Hazards).

## 10. The App Store

The listing says the app "takes no bets and offers no real-money play", and the review notes that
it "offers no real-money gaming, wagering, prizes or in-app currency" (`docs/app-store-listing.md`).
Free chips that live and die at one table keep every word of that true: they are not a currency, they
cannot be bought, won or carried away. A balance kept on the account would start to look like an
in-app currency (decision 2).

What does change: the age rating's **simulated gambling** answer (the app is 18+ already), and the
review notes, which will need a paragraph on the tables. Guideline 5.3 means a slower review. So the
tables ship in a build after launch, never in the 11 December submission, and the app shows them only
when the server says so (`GET /api/tables/availability`, off unless `TABLES=1`), so an older build or
a reviewer of an unrelated update never meets a half-built feature.

## 11. The owner's answers (2026-11-22)

These override the sections above where they differ.

| # | Decision | Answer |
|---|---|---|
| 1 | Where tables live | **Their own service** (§5 B): `tables/server.js`, Render `futuregame-tables` with a build filter, a pm2 app here; seat tickets from the scheduler, finished hands archived there |
| 2 | The chips | **An account balance**, not per-table stacks, with three guardrails: **no transfers** (chips move between accounts only across a table), **a daily top-up floor** (once a day a balance under the floor is raised to it), **no leaderboard of balances** (a balance is private to its owner). Never bought, never cashed out, never a prize |
| 3 | Who can play | Registered accounts; **app admins only** until the owner opens it, behind `TABLES=1` |
| 4 | Saving hands | **Every hand**, to every player dealt in, as hero, holding only what they saw, tagged with the table |
| 5 | The showdown | **TDA, auto-muck** (as recommended) |
| 6 | Chat | **Free-text chat** at the table |
| 7 | The clock | **The host sets both** the time per decision and the time bank |
| 8 | Where Tables sits | **Its own tab** (bottom nav and desktop rail) |
| 9 | A provable deal | **Keep a hash of each deck, not shown** |
| 10 | Game order | **Board games, stud, draw**; the first slice NLH alone |
| 11 | The rules move | **On this branch**: the entry and quick add move onto `poker-rules/` here |

What the answers change:

- **The balance (2)** lives in the scheduler, which owns people: a `play_chips` table (user, balance,
  last top-up) and a journal of every change (`play_chip_moves`: sit, leave, top-up floor, with the
  table and hand). Sitting down takes a buy-in from the balance, named in the seat ticket; leaving,
  or the table closing, returns the stack. The tables service reports each seat's stack at the end of
  every hand with the finished hand, so a crash of either side loses at most the hand in progress,
  which the journal replays. A rebuy at the table is a new buy-in from the balance; a balance under
  the buy-in waits for the next day's floor. The App Store notes must say the chips cannot be
  bought, sold, transferred, won as a prize or exchanged for anything, and §10's "not a currency" now
  rests on those guardrails rather than on the chips dying with the table. The floor and the starting
  balance are settings to fix before the first slice (proposed: 20,000 starting, floor 5,000).
- **Chat (6)** is free text, so it carries the moderation guideline 1.2 asks for: each message can be
  reported (`reports` kind `'table-message'`, its text copied into `snapshot` as group messages are),
  a block hides the two people's messages from each other as in groups, the host can mute a seat,
  and Admin's inbox can remove a message. Chat lives in the tables service's stream; a report goes to
  the scheduler through the boundary.
- **The clock (7)**: the host picks the time per decision (10 to 120 s) and the bank (0 to 300 s);
  two timeouts running still sit a player out.
- **The tab (8)**: a Tables tab in `BottomNav` and `DesktopRail`, shown only when the server says
  tables are on for that account; on the desktop the table is the main pane and the chat and the
  table's hands the side pane (`.dk-pane-side`).

## 12. As built: the first slice (2026-11-22)

Two browsers at one private table play a full NLH hand, each seeing only their own cards, settled the way the
oracle settles it, and the hand is saved to both players' Hands. Board games only (§8 wave 1); stud and draw next.

| Piece | Where | Held by |
|---|---|---|
| The betting rules, one copy | `vite-app/src/utils/poker-rules/betting.js` | `test/replayer-oracle/check-rules.mjs`: 1,139 corpus hands, 22,272 actions, 0 fails (21 TDA/PokerKit differences named) |
| Settlement | `poker-rules/settle.js` (the export's `prepareHand`) | the same check: every seat on the oracle's stack |
| The live hand | `poker-rules/live-hand.js` | `live-hand.test.mjs` in `npm test` |
| Dealer, runtime, service | `lib/tables/*.mjs`, `tables/server.mjs` | `npm run test:tables` (12 checks over the real routes and streams) |
| The scheduler's half | `lib/play-tables.js` | the same |
| The Tables tab | `components/TablesView.jsx`, `utils/play-tables.js` | `npm run check:tables` (two WebKit pages through one hand) |

Not yet: §2 steps 3 and 4 (the entry and quick add reading the module, decision 11), the waiting-for-the-big-blind
rule (a new seat is dealt in at once), chat (decision 6), the `tables` push kind, stud and the draw games, a
Render service and a pm2 app for the tables service, and a guard pass (`check:controls`, `check:clipping`) on the
Tables screens.

## 13. Open decisions (as asked)

1. **Where tables live.** Recommend **B**: their own service in this repo (`tables/server.js`, Render
   `futuregame-tables` with a build filter, a pm2 app here), with the scheduler issuing seat tickets
   and archiving hands. A, in the scheduler's process, is simpler but pauses every table at every push.
2. **The chips.** Recommend **stacks that belong to the table**: everyone sits with the host's starting
   stack, rebuys are free and instant, nothing is kept on the account. A play-money balance with a
   daily top-up is what social casinos do, and it is the part of them the law looks at.
3. **Who can play.** Recommend **registered accounts only** (a guest has no blocks, reports or Hands),
   and **app admins only** until the owner opens it, behind `TABLES=1` on the server.
4. **Saving hands.** Recommend **every hand to every player's Hands, automatically**, tagged with the
   table so Hands can filter it (the brief's "every hand played saves"). The alternative is saving only
   the hands a player stars, which keeps Hands shorter after a long session.
5. **The showdown.** Recommend: when everyone still in is all in, every hand is tabled before the
   run-out (TDA); otherwise the last aggressor shows first, a winning hand is shown, and a losing one
   is mucked unless its player taps Show. Mucked cards are never sent to anyone, nor saved.
6. **Table chat.** Recommend **none in v1**; a few fixed reactions later. Free text brings moderation
   duties the reports inbox is not staffed for.
7. **The clock.** Recommend **30 s a decision plus a 60 s time bank** per player, the host choosing
   15, 30 or 60 s; two timeouts running sit a player out.
8. **Where Tables sits in the app.** Recommend a **Tables row in Hands** (beside Replayer, Study,
   Scanner). The alternative is Social, beside Connections and Groups.
9. **A provable deal.** Recommend **keeping a hash of each deck from v1** (free, server side) and
   **not showing it** until someone asks; fair-deal proofs matter for money, less for friends.
10. **The order of the games.** Recommend the three waves in §8 (board games, stud, draw), each held
    by the oracle before it opens, and the first slice on NLH alone.
11. **The shared rules move.** Recommend **moving the replayer's entry and quick add onto the module on
    this branch** (§2, steps 3 and 4), shipping with the tables after launch, rather than leaving the
    server a third copy until then.
