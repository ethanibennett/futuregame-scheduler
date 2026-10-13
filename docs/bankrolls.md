# Bankrolls (beta)

Multiple bankrolls per player: "Main", "Staked", "Online"… each with a starting balance,
a ledger of deposits, withdrawals and transfers, and the results filed under it.

    balance = starting_balance + SUM(bankroll_adjustments.amount) + net results
    net result of an entry = cash_amount - buyin * num_entries

**Beta gate:** app admins only (`APP_ADMIN_USERNAMES`). Server: every `/api/bankrolls/*`
route is behind `authenticateToken` + `requireAppAdmin`, and a non-admin sending a numeric
`bankrollId` to `/api/tracking` gets 403. Client: `TrackingView` only mounts the switcher,
the manager and the form's Bankroll field when `isAdmin`. A normal user's results keep
`bankroll_id` NULL and the Results tab is byte-for-byte what it was.

Code: `lib/bankrolls.js` (schema, routes, the filter), `vite-app/src/utils/bankrolls.js`
(pure helpers), `vite-app/src/hooks/useBankrolls.js`, `vite-app/src/components/Bankrolls.jsx`.
Tests: `npm run test:bankrolls`.

## Schema (migration `bankrolls-beta-2026-10`)

| table | columns |
|---|---|
| `bankrolls` | id, user_id, name, starting_balance INTEGER, currency TEXT (default USD), archived, sort_order, created_at, updated_at |
| `bankroll_adjustments` | id, user_id, bankroll_id (NULL = Main), kind (`deposit` `withdrawal` `transfer_in` `transfer_out`), amount INTEGER **signed** (+ in, − out, in the bankroll's currency), transfer_id (pairs the two legs), occurred_on YYYY-MM-DD, note, created_at |
| `tracking_entries.bankroll_id` | nullable; NULL = Main |

- **Main is virtual** — no row. NULL means Main everywhere, which is why every existing
  result keeps working untouched. Main is USD with a starting balance of 0; record an opening
  balance for Main as a deposit.
- **Currency is per bankroll.** Results are already in each event's native currency (EUR at
  the Irish Poker Open, …) and `staking_series` already carries a currency, so an unlabelled
  "deposit 500" is ambiguous. Starting balance and ledger amounts are in the bankroll's
  currency; results are converted at display time with the same rates the Results tab uses.
  A bankroll's currency is frozen once it has ledger rows (409). A transfer between two
  currencies takes `toAmount` (what arrived).
- Amounts are whole currency units, like `cash_amount` and `buyin`.
- Only an empty bankroll can be deleted (409 otherwise — archive it). Deleting either leg of a
  transfer deletes both. Account deletion removes both tables.

## Routes (all scoped to `req.user.id`; another user's id is a 404, same as a missing one)

| method | path | body / query |
|---|---|---|
| GET | `/api/bankrolls` | → `{ bankrolls: [{ id: 'main' \| n, name, currency, starting_balance, archived, sort_order, is_main, adjustments_net, adjustment_count, entry_count }] }`, Main first |
| POST | `/api/bankrolls` | `{ name, startingBalance?, currency? }` → 201 |
| PUT | `/api/bankrolls/order` | `{ order: [id, …] }` |
| PUT | `/api/bankrolls/:id` | `{ name?, startingBalance?, currency?, archived? }` |
| DELETE | `/api/bankrolls/:id` | 409 unless empty |
| GET | `/api/bankrolls/adjustments` | `?bankroll=` (below) |
| POST | `/api/bankrolls/adjustments` | `{ bankroll: 'main' \| id, kind: 'deposit' \| 'withdrawal', amount > 0, date?, note? }` |
| POST | `/api/bankrolls/transfers` | `{ from, to, amount > 0, toAmount?, date?, note? }` |
| DELETE | `/api/bankrolls/adjustments/:id` | removes both legs of a transfer |
| POST/PUT | `/api/tracking[/:id]` | now also takes `bankrollId: 'main' \| id`; omitted = leave as is (new = Main). Must be the caller's, not archived (unless unchanged) |

## The shared filter: `?bankroll=<all|main|id>`

For the analytics and tax-report features (and anything else that reads results).

| value | meaning |
|---|---|
| absent, `all` | every entry — the pre-bankroll behaviour, so adopting the param changes nothing until a value is passed |
| `main` | `bankroll_id IS NULL` |
| `<id>` | `bankroll_id = id`, after checking the bankroll is the caller's (404 if not, 400 if malformed) |

Server — one call, append to your WHERE:

```js
const bk = bankrolls.filterFromQuery(db, req.user.id, req.query.bankroll, 'te.bankroll_id');
if (bk.error) return res.status(bk.status).json({ error: bk.error });
db.prepare(`... WHERE te.user_id = ?${bk.sql} ...`).bind([req.user.id, ...bk.params]);
```

`GET /api/tracking` already honours it. The column argument is a constant you choose, never
input. The param is accepted for every signed-in user (it is read-only and user-scoped); a
non-admin simply has nothing but Main.

Client — `vite-app/src/utils/bankrolls.js`, dependency-free:

- `filterByBankroll(entries, key)` — the same semantics on already-fetched rows
- `bankrollQuery(key, '?' | '&')` — `''` for All, else `?bankroll=…`
- `balancesFromSummary(summary)` — the switcher's balances, from the SERVER ledger
  (`GET /api/bankrolls/summary`, below). This is what the Results tab shows since the combined
  ledger landed.
- `computeBalances(bankrolls, entries, { nativeCurrency, convert })` — superseded for display (it
  only sees tournaments + adjustments); kept as the reference arithmetic. Per-bankroll
  `{ start, adjustments, results, balance, entries, currency }`, plus an `'all'` row in USD
- `useBankrolls({ enabled: isAdmin, token })` — the list and the Results tab's selected key
  (localStorage `resultsBankroll`). Read `bk.selected` to follow the Results tab's choice.

A tax report probably wants the ledger too (deposits/withdrawals are not income):
`GET /api/bankrolls/adjustments?bankroll=…`.

## The combined ledger (`lib/bankroll-ledger.js`)

Every module in **`lib/ledger-sources/*.js`** is a ledger source, loaded at boot in filename
order (`BANKROLL_LEDGER_SOURCES_DIR` points the loader elsewhere — the tests use a temp dir). Adding
money to the ledger is one new file there; nothing else changes.

```js
module.exports = {
  name: 'cash-sessions',                      // unique; tags every entry
  entries(db, userId, { bankroll, from, to }) // bankroll: 'all' | 'main' | id (already the caller's)
    // → [{ date: 'YYYY-MM-DD', ts: ISO | null, amount: signed, currency: 'USD',
    //      bankroll_id: number | null, kind, label, ref: { table, id } }]
};
```

**Units.** Every source returns `amount` in MAJOR units of its `currency` (dollars, not cents).
Tournaments, adjustments and cash sessions store whole units (INTEGER); expenses and income store
REAL to the cent. A source that stores cents must divide before returning.

- `amount` is signed (+ in, − out) in `currency`; `bankroll_id` null is Main. Extra fields pass
  through. Filter on `bankroll` in SQL (the loader filters again). The loader asks with
  `from = null` because a running balance needs everything before the window.
- A malformed entry is dropped and counted (`invalid`); a source that throws is reported
  (`ok: false` in `sources`) and the rest of the ledger still loads.
- Kinds `deposit`, `withdrawal`, `transfer_in`, `transfer_out` are **money moved**; every other kind
  is a **result** (won/lost). Summaries, goals and the dashboard split on that.
- Built-in: `tournaments.js` (net = (cashed ? cash : 0) − buy-in × max(1, entries), in the venue's
  currency — exactly the Results tab and `lib/analytics.js`; extra fields `units`, `cost`, `cash`,
  `buyin_per_entry`) and `adjustments.js` (the ledger above). `cash-sessions.js` (extra fields
  `started_at`, `hours` = ended − started to the hundredth, null without both ends, and the money
  behind the net in the session's currency: `buy_in` (rebuys included), `rebuys` (a count),
  `cash_out`, `tips`, `expenses` — `amount = cash_out − buy_in − tips − expenses`) and
  `transactions.js` belong to the cash-session and expense features.

Balance of a bankroll = starting balance + Σ its entries, in ITS currency (entries in another
currency converted through USD at the current rates — what the Results tab has always done). Order:
date, then entries without a ts first, then source, then ref id.

| method | path | |
|---|---|---|
| GET | `/api/bankrolls/ledger?bankroll=&from=&to=&currency=` | `{ entries: [...each + bankroll, amount_bankroll, amount_display, fx_display, balance, balance_display, total_display], opening, closing, sources, dropped }` — `opening` is the balance carried into `from`; `fx_display` = display units per 1 of the entry's own currency, to put a source's extra money fields (a tournament's `cost` / `cash`) on the display scale |
| GET | `/api/bankrolls/summary?currency=` | `{ bankrolls: [{ id, start, moved, results, balance, by_source, by_kind, count, currency }], all, rates, guide, sources }` |
| GET / PUT | `/api/bankrolls/prefs` / `/api/bankrolls/prefs/:key` | rules + goals per key (`all`, `main`, id); `{ rules: { mtt: { buyins }, cash: { buyins } }, goals: [...], reset: ['mtt'] }` |
| GET | `/api/bankrolls/risk?bankroll=&currency=` | risk of ruin, tournaments (`lib/bankroll-management.js` riskOfRuin) |
| POST | `/api/bankrolls/import` | `{ bankroll, commit, rows }` — preview (commit false) or write; dedupe by fingerprint |

### The dashboard (`BankrollDashboard.jsx`, behind the bankroll strip's Dashboard button)

A 37g sheet (phone and desktop alike). Under the bankroll chips, one segmented tab strip:
**Overview / Rules / Goals / Import**. The strip is a single 35g `.bd-seg` whose segments split the
width in whole g by `data-n` (4 tabs 9+9+9+8g, 5 tabs 5 × 7g, 6 tabs 5 × 6g + 5g), so a new tab is one
entry in `TABS` plus one render line (`{tab === 'key' && …}`, marked in the JSX); the guards walk
every tab in the strip on their own.

**Overview** (`BankrollOverview.jsx`), laid out the way a dedicated poker tracker lays out its home
screen, in this app's own type, tokens and grid:

| block | what | the tracker pattern it borrows |
|---|---|---|
| Hero (2 × 17g, 9r) | balance now · profit over the range, coloured by sign, with the event / session count | the headline profit over the graph |
| Graph (4r head, 35g × 24r plot, 2r foot) | **Profit** (cumulative results from 0, a hairline at 0, line green / red by where it ends) or **Balance** (deposits included); drawdown from the peak shaded in both | the cumulative "chip graph" |
| Range (35g × 4r, 5 × 7g) | 1M · 3M · YTD · 1Y · All, trailing windows ending today (`rangeWindow`); remembered per device (`bankrollRange`, `bankrollChart` in localStorage) | the time filter on the graph |
| Tables (`BankrollOverviewTables.jsx`, `bankroll-overview-tables.css`) | six collapsible sections, each headed by a 35g × 5r disclosure row: the name, the range and bankroll it covers, a chevron, and while closed its headline figure on the right. **Summary** (Cash \| Tournaments \| Total): buy-ins (cash: buy-in incl. rebuys; tournaments: buy-in × bullets), cash-outs, tips & costs (cash, when any), net profit, expenses & income (Total), **total result** (= the hero's profit), deposits & withdrawals (Total), balance change (Total: result + money moved). **Sessions**: sessions / events, bullets, hours and $/h (cash), ROI (tournaments), won % / ITM, average buy-in, profit and rebuys / re-entries, biggest win and loss. **Games** and **Rooms** (from the report facts): one row per game / room, cash and tournaments in separate blocks (count, hours, $/h or ROI, total, best first). **Bankroll**: balance, all-time peak, below it, deepest drawdown in the range, money moved, risk of ruin. **By month** (By year for All): results, moved, net. Summary and Sessions start open; open / closed is per device (`bankrollOverviewOpen` in localStorage) | Poker Bankroll Tracker's Bankroll › Overview: tables with a column per game type and a total, zebra rows, right-aligned tabular figures, compact money ($403.2k from $10k) |
| Latest sessions (6r rows, 14g \| 21g) | the six newest tournament / cash results in the range, each led by its signed profit in the display face, with date, event or game, and hours / bullets; buttons to Results' Tournaments and Cash halves (they also select the dashboard's bankroll on the Results tab) | the session list led by a big green / red profit |

Table layout: a 3r head (labels on line 2; Cash, Tournaments and Total carry a key bar in
`--series-cash` / `--series-tourn` / `--series-total`, the graph's line colours), 4r rows with the
text on line 3, zebra by background (full bleed, the text on the 35g column), no rules between rows.
The stripe is `--ovt-zebra`: `--surface` in the standard themes, the theme's `--hover-overlay` under
high contrast, where `--surface` sits on or next to `--bg` (light-high #fff on #fff) and the stripe
vanished. Cloudy-high keeps `--surface`: it already stands off, and the darker tint would cost its
green figures. The stripe against the sheet, measured in WebKit (contrast ratio):

| theme | normal | high contrast |
|---|---|---|
| dark | 1.085 (`--surface`) | 1.121 (`--hover-overlay`; was 1.061) |
| light | 1.090 (`--surface`) | 1.192 (`--hover-overlay`; was 1.000) |
| dusk | 1.097 (`--surface`) | 1.126 (`--hover-overlay`; was 1.074) |
| cloudy | 1.116 (`--surface`) | 1.082 (`--surface`; the tint would be 1.25 and take `--pos` on a stripe from 3.5 to 3.1:1) |

Columns: label 11g + 3 × 8g (Summary, Sessions, By month); label 11g + 5g + 4g + 7g + 8g (Games,
Rooms: the rate column ends on the Tournaments edge, the total is 8g under Total); label 11g + note
16g + value 8g (Bankroll). The label column is `minmax(11g, 1fr)`, so a wider
sheet widens it and the figure columns stay whole g. A cell with nothing under it is a dash, never
$0. Money is compact from 10k in the display currency (its own symbol and side, `CURRENCY_CONFIG`),
and the hourly rate is labelled in it too ($/h, €/h, kr/h). The bankroll sheet is 37g wide at every
width, so on desktop the tables keep the phone's 35g column. Green / red only for signed money (not
ROI, risk of ruin or other percentages). The disclosure rows are controls
(`.ovt-head` is START_ALIGNED in `check-control-centring.mjs`); the guards open every section by
its header, scroll through, then close them all. Collapse animates the body's grid row 0fr ↔ 1fr
(no measured heights), off under prefers-reduced-motion.

Not shown, on purpose: **shares sold** — not for want of data: staking keeps per-event numbers
(`backer_event_status`, one row per agreement × tournament with its own bullets, buy-in, cash, tip
and rate; `backer_event_overrides` with a per-event % or opt-out; the settlement route works out an
effective % per event, joinable to a result through `tournament_id` and `staking_series.user_id`).
It is left out because those numbers are filed by staking series, not by bankroll or ledger row,
they are a second copy of the buy-ins and cashes that can disagree with the result, and swaps,
crossbooks, markup, makeup and budget caps make a backer's cut something other than a plain share of
a result (the settlement code itself marks several of those rules as guesses). So the results here
are gross ("Staking, and how they could connect" below). **Owner decision:** add a Shares sold row
(Tournaments and Total) from the settlement's per-event %, or wait for the seams below. **Hands and $/100**
(no hands are recorded), **tournament hours** (a result carries no playing time; the cell is a
dash, never a guess), and **cash ROI** (a cash buy-in is not a cost). A Total cell is a dash where
the two columns mean different things (hours, $/h, ROI, won % / ITM when both kinds are in the range).

The tables' arithmetic is `utils/bankroll-overview.js` (`summaryTable`, `sessionsTable`,
`groupTable`, `bankrollFigures`, `overviewTables`, the compact formatters and `moneySign`), tested
in `utils/__tests__/bankroll-overview.test.mjs` (run by `npm run test:bankroll-ledger` and
`npm run test:bankrolls`) — among them that the Summary's Total is Cash + Tournaments (+ expenses,
+ money moved for the balance change) and its total result is `overviewStats(...).results`, the
hero's profit, for every range. Compact money rounds once, from the unrounded value (13,349.63 is
$13.3k, not $13.4k), and a figure is green / red by `moneySign`, the sign of the whole units it
draws, so −0.38 is a plain "$0", never a red one.

The arithmetic is pure and tested in `utils/bankroll-ledger.js`: `overviewStats(entries)` (ROI =
profit / cost with each tournament's cost × `fx_display`, so mixed currencies add up; ITM = rows that
cashed / rows; hourly = the profit of sessions with both ends / their hours; every ratio null, not 0,
when it has nothing under it), `profitSeries`, `peakOf`, `rangeWindow`, `recentResults`.

Baselines: hero figures are the display face at `--fs-2xl` (c measured 1.0983r at 402 wide, 1.1238r at
1440 — the face's ascent rounds to whole px, so `p` splits the difference, ≤ 0.03r off); the latest
sessions' profits the display face at `--fs-xl`, likewise. Every other cell uses analytics.css's roles.

### Rules, goals, risk (`lib/bankroll-management.js`, table `bankroll_prefs`)

- **Rules**: per bankroll (and All), MTT and cash, each "N buy-ins in the roll". Defaults 100 / 30,
  shown as defaults, not advice. The guide (in `summary.guide.byKey[key]`): `mtt.cap` = roll / N;
  `signal` `down` when the last 20 tournament entries average above the cap (or the roll is ≤ 0),
  `up` when the cap reaches the next `BUYIN_BANDS` tier, `hold` otherwise, null under 5 entries.
- (Event cards showed an "Of your roll" line until 2026-10-11; the owner removed it. The rules
  still drive the Rules tab and its move-up / move-down signal.)
- **Goals**: monthly / yearly, profit (every result, not money moved) or volume (tournament
  bullets + cash sessions), progress computed client-side from the ledger.
- **Risk of ruin**: diffusion approximation exp(−2μB/σ²) on per-entry returns in buy-ins (the
  analytics sample), plus the same at the ROI interval's low end; nothing under 100 entries. The
  assumptions are in the code comment and the dashboard footnote.

### Import / export (`lib/bankroll-import.js`, `utils/bankroll-csv.js`, table `bankroll_import_keys`)

- Export: the dashboard's Import tab writes the selected bankroll's (or every) ledger as CSV with
  running balances (`ledgerToCsv`).
- Import presets, only where the maker publishes the columns: **Poker Bankroll Tracker**
  (pokerbankrolltracker.net/faq + the vendor's sample file; the sample is the test fixture) and
  **Pokerbase's Custom Sheet** template. Poker Income / Poker Analytics publish no column list →
  generic column mapping. Cash-game rows are skipped (cash sessions are their own source).
- Imported tournament results become private `Personal` tournaments (stable_id
  `PERSONAL-<uid>-imp-…`, swept by account deletion) + tracking entries, so they count everywhere;
  non-USD results are converted to USD at today's rate with the originals in the notes.
- Dedupe: sha1 of the normalised row + its occurrence number in the file; a key whose row was
  deleted is stale and the row imports again.

Tests: `npm run test:bankroll-ledger` (loader with a fake source in a temp dir, both built-in
sources against scratch sql.js, running balances, guide, risk, import, routes incl. isolation) —
also part of `npm run test:bankrolls`.

## Staking, and how they could connect

Bankrolls do not touch staking, and in this beta a "Staked" bankroll shows the **gross**
result of the events filed under it — what `tracking_entries` stores — not the player's share.
Staking keeps its own numbers per agreement and event (`backer_event_status` buy-ins/cashes,
`backer_event_overrides`, `backer_settlements`) and is the authority on who owns what. The two do
not contradict because they answer different questions: staking = what I owe backers; bankroll = where the
money physically sits.

Later, the clean seams are:

1. `staking_series.bankroll_id` — a series is played out of one bankroll; its events default
   their results there.
2. Settlements post to the ledger: paying a settlement (`PUT /api/staking/settlements/:id/paid`)
   writes a `bankroll_adjustments` row (new kind `settlement`, with `settlement_id`), so the
   balance drops by what was actually paid out, and receiving a backer's investment writes a
   `deposit`. Gross results − settlements = the player's net, without re-deriving shares.
3. Optionally a "my share" view: per entry, results × (1 − sold %) from the agreement, for a
   bankroll that wants net-of-action figures before settlement.

## Cash game sessions (beta, admins)

`lib/cash-sessions.js` (migration `cash-sessions-2026-10`), UI `vite-app/src/components/CashSessions.jsx`
(the Cash half of the Results tab, behind its Tournaments | Cash strip) and `CashLive.jsx` (the strip,
and the live bar). Tests: `npm run test:cash-sessions`.

| `cash_sessions` | id, user_id, bankroll_id (NULL = Main), started_at / ended_at (ISO; ended_at NULL = **live**), session_date (the player's LOCAL day it started — tax years), room, venue_slug (the cash watcher's, when picked from its rooms), game, stakes (normalised: `$2/$5`, `2-5` → `2/5`), buy_in (TOTAL, rebuys included), rebuys (count), cash_out, tips, expenses, currency (defaults to the bankroll's), notes, tags (JSON array) |
|---|---|

| `cash_session_stacks` (migration `cash-session-stacks-2026-10`) | id, session_id, user_id, at (ISO), amount (the chips in front of the player, whole units), invested (the session's buy_in when it was recorded), created_at |
|---|---|

`net = cash_out - buy_in - tips - expenses`. A live session counts nowhere (stats, ledger) until it is
ended. At most one live session per user (409).

**Stack updates** are a record of how a session went, not money: nothing in stats or the ledger reads
them. Each row keeps `invested` so `amount - invested` is where the session stood at that moment, and a
later rebuy does not rewrite earlier points. The swing graph (`swingSeries()` in
`vite-app/src/utils/cash-sessions.js`) runs 0 at the start → each update → `cash_out - buy_in` at the
end. Updates can only be added while the session is live (409 after), and are removed one at a time or
with their session; account deletion covers the table. At most 500 per session.

Routes, `/api/cash-sessions` (not `/api/cash/…`, which is the cash-watcher proxy), admin-only, every
query scoped to `req.user.id` (another user's id is a 404):

| method | path | |
|---|---|---|
| GET | `/api/cash-sessions` | `?bankroll=&from=&to=` → `{ sessions, games }`, newest first |
| GET | `/api/cash-sessions/live` | `{ session \| null, stacks, now }` |
| GET | `/api/cash-sessions/stats` | `?bankroll=&from=&to=&currency=` → net, hours, hourly, wins/losses, biggest win/loss, average length, `byStakes` / `byGame` / `byRoom`, `byMonth` (per `YYYY-MM`, newest first: the list's month headers) and `series` (`[{ id, date, net, cum }]`, oldest first: the cumulative graph); mixed currencies converted at the server's cached rates |
| GET | `/api/cash-sessions/:id` | `{ session, stacks }` (stack updates oldest first) |
| POST | `/api/cash-sessions/:id/stack` | `{ amount ≥ 0, at? }` (default now, not before the start), live only → 201 `{ session, stacks }` |
| DELETE | `/api/cash-sessions/:id/stacks/:stackId` | → `{ session, stacks }` |
| GET | `/api/cash-sessions/export.csv` | `?bankroll=&from=&to=` |
| POST | `/api/cash-sessions` | log a finished session `{ startedAt, endedAt, date?, buyIn, rebuys?, cashOut, tips?, expenses?, room?, venueSlug?, game?, stakes?, bankroll?, currency?, notes?, tags? }` |
| POST | `/api/cash-sessions/start` | `{ buyIn, room?, venueSlug?, game?, stakes?, bankroll?, date?, … }` → live |
| POST | `/api/cash-sessions/:id/rebuy` | `{ amount }`, live only → `{ session, stacks }` |
| POST | `/api/cash-sessions/:id/end` | `{ cashOut, tips?, expenses?, endedAt?, notes? }`, live only |
| PUT / DELETE | `/api/cash-sessions/:id` | edit (a live session keeps its end and cash-out for `/end`) / delete (its stack updates with it) |

The bankroll ledger reads ended sessions through `lib/ledger-sources/cash-sessions.js`. A bankroll
with cash sessions cannot be deleted (409, `cash_sessions` count in the body). The switcher's balances (the server ledger's `/summary`)
include ended sessions; a live one counts nowhere until it ends.

**The Cash view** (2026-10-11, modelled on how Poker Bankroll Tracker structures a tracker — its
structure and density, in this app's own type, colours and grid). One screen at a time, all in
`CashSessions.jsx`:

| screen | what it is | the pattern it borrows |
|---|---|---|
| list › Sessions | net and per hour over a cumulative graph (x = session, from `stats.series`); then every session grouped by month, the header carrying the month's net, hours and count (`stats.byMonth`, already converted to one currency); each 9r row LEADS with the big signed, coloured result, then game · room, date · start · length, per hour, and a line of the notes (12r) | the chip graph front and centre; a session list scanned by its profit |
| list › Stats | label-left / value-right rows in two 17g columns (net, per hour, hours, sessions, won-lost with %, average length, per session, best, worst, bought in, cashed out, tips and costs), then the stakes / game / room table | stats as plain rows |
| a session | result and per hour, what and when, the in-session stack graph (when it had updates), every field as a row, the notes in full; Edit and Delete in the head | session notes, the detail behind a row |
| add / edit | buy-in and cash-out as big 6r inputs; date, start, and the length by end time OR hours (typing either fills the other); room; game and stakes; notes. The LAST session's room, game, stakes, start/end and buy-in are filled in. Rebuys, bankroll, tips, expenses, currency and tags sit behind one button (open by default when editing a session that uses them). A running net and length under the fields | "no unnecessary fields" |
| start | buy-in and stakes big, room, game, bankroll, the last session's values filled in | |
| live | opens by itself while a session runs (the list's live row and the bar's Open go there; "‹ Sessions" leaves it): a large clock, In play / Stack / Up-down tiles, the swing graph, a big "Stack now" input with Update, Rebuy, Cash out (cash-out, tips, expenses, notes; ending lands on that session's page), and the list of updates with a remove button each | live tracking with in-session stack updates |

Tournament results are deliberately NOT rows in this list: they are the Results tab's Tournaments half,
and every total, month header and stat here is cash-only — mixing in tournaments would change what each
number means. The focused screens (live, a session, the forms) keep a 35g column on a desktop pane; the
list and Stats use the whole pane. Filters beyond the Results tab's bankroll are the reports work's.

Layout notes: every box is whole g × whole r and every baseline is on an r line (the CSS header of
`CashSessions.css` lists each screen's rows). Graphs are an SVG stretched over a whole-r box, strokes
non-scaling; above zero is drawn in the win colour and below it in the loss colour (each side clipped).
The view ends in a nav-height spacer because App.jsx's tab panels are `height: 100%`: a view taller
than the content area overflows the panel, and `.content-area`'s padding-bottom then lands after the
panel, leaving the last rows scrollable only to behind the nav (every tab has this; measured 15px of
scroll for 10r of overflow).

**The live bar.** While a session runs, `LiveCashBar` (App.jsx, a 5r bar directly above the bottom nav)
shows its clock and what is in play on every tab, and Open goes to Results › Cash. It hides on that
view (which shows the full live card) and on Hands. The session is server-side, so the clock survives
reloads and other devices; `hooks/useLiveCashSession.js` mirrors it (on mount, on return to the
foreground, every 5 min) and corrects for clock skew with the server's `now`.

## Expenses, non-game income and trips (beta)

What a player spends and earns outside a tournament result: flights, rooms, food, tips, coaching,
software; rakeback, promotions, staking settlements, sponsorship, coaching fees. Plus **trips**, so a
trip's whole P&L reads at once. Same gate as everything above (app admins, the `/api/bankrolls`
gate), same Main convention (`bankroll_id` NULL).

Code: `lib/bankroll-transactions.js` (schema, routes), `lib/ledger-sources/transactions.js` (the
ledger source), `vite-app/src/utils/transactions.js` (totals, trip P&L, CSV, quick-add parsing),
`vite-app/src/components/Expenses.jsx` (Results → "Expenses & Income", lazy, admins only).
Tests: `npm run test:transactions` (ledger source against a scratch sql.js DB, the routes on a
scratch port with cross-user isolation, the client helpers).

### Schema (migration `bankroll-transactions-2026-10`)

| table | columns |
|---|---|
| `bankroll_transactions` | id, user_id, bankroll_id (NULL = Main), occurred_on YYYY-MM-DD, kind (`expense` \| `income`), category, amount REAL **positive** (to the cent; the sign is the kind), currency, note, tournament_id (no FK), series (free text, ≤ 80), trip_id, created_at, updated_at |
| `bankroll_trips` | id, user_id, name, start_date, end_date (inclusive, ≤ 366 days), bankroll_all (1 = results from every bankroll), bankroll_id (when not all; NULL = Main), note, created_at, updated_at |

Categories — expense: `travel lodging food entry_fees coaching software tips other`;
income: `rakeback bonus staking sponsorship coaching other`. The client list must match
(`transactions.test.mjs` checks).

- **Currency is per row**, defaulting to the bankroll's. A dinner in Dublin is EUR even in a USD
  bankroll; totals are never summed across currencies server-side.
- `tournament_id` carries no FOREIGN KEY: it is in `FEED_REF_TABLES` instead, so a tagged feed event
  is never pruned and follows a re-key, and a Personal event's account deletion clears it.
- A bankroll with transactions or trips cannot be deleted (409, counts in the body);
  `GET /api/bankrolls` lists `transaction_count`. Account deletion removes both tables.
- Deleting a trip **untags** its rows; it does not delete them.
- Balances: the switcher reads the server ledger (`lib/bankroll-ledger.js` loads the source below),
  so expenses and income move every balance, per bankroll and in All.
- No receipts. Uploads in this app are stored as base64 in the DB (avatars, staking proofs), which
  is wrong for receipts, and Render's disk is not persistent; photo receipts need object storage first.

### Routes (all scoped to `req.user.id`; another user's id is a 404)

| method | path | body / query |
|---|---|---|
| GET | `/api/bankrolls/transactions` | `?bankroll= &from= &to= &kind= &category=a,b &trip=<id>\|none &limit=` (500 default, 5000 max) → `{ transactions, total, truncated }`, newest first. Rows carry `signed_amount`, `tournament_name`, `trip_name` |
| GET | `/api/bankrolls/transactions/totals` | same filters → `{ totals: [{ kind, category, currency, amount, count }] }` |
| POST | `/api/bankrolls/transactions` | `{ kind, category, amount > 0, currency?, date?, bankroll?: 'main'\|id, tripId?, tournamentId?, series?, note? }` → 201. A new row on a single-bankroll trip defaults to that bankroll |
| PUT | `/api/bankrolls/transactions/:id` | any subset of the above; `null` clears a tag |
| DELETE | `/api/bankrolls/transactions/:id` | |
| GET | `/api/bankrolls/trips` | → `{ trips: [{ id, name, start_date, end_date, bankroll: 'all'\|'main'\|id, note, transaction_count }] }` |
| POST/PUT | `/api/bankrolls/trips[/:id]` | `{ name, startDate, endDate, bankroll?: 'all'\|'main'\|id, note? }` |
| GET | `/api/bankrolls/trips/:id` | → `{ trip, transactions, results }` — results are the tracking rows whose event date (ISO or "Month D, YYYY", read at noon) is inside the trip, in its bankroll scope. Totals are the client's (`tripPnl()`), because results are in each venue's currency |
| DELETE | `/api/bankrolls/trips/:id` | → `{ deleted, untagged }` |

### Ledger source

`lib/ledger-sources/transactions.js` → `{ name: 'transactions', entries(db, userId, { bankroll, from, to }) }`
returning `[{ date, ts: null, amount (expense negative), currency, bankroll_id, kind, category, label, ref: { table: 'bankroll_transactions', id } }]`,
ordered by date then id. A bankroll that is not the user's throws (`err.status` 404/400).

## Reports and filters (beta, app admins)

The dashboard's **Reports** tab: one filter model over everything played and spent, and breakdowns
that show where the money is won and lost. The structure follows the serious bankroll trackers
(Poker Bankroll Tracker's App Store page lists filters by game type, limit, buy-in, blinds,
location, day of week, year and the part of the day a session starts, and a chart of profit by
session length); the look is this app's own (tokens, grid, faces).

Code: `lib/bankroll-reports.js` (the route), `vite-app/src/utils/bankroll-filters.js` (the filter
model), `vite-app/src/utils/bankroll-reports.js` (the breakdowns), `components/BankrollReports.jsx`
(the tab), `components/BankrollFilters.jsx` (the filter sheet), `components/bankroll-reports.css`.
Tests: `npm run test:bankroll-reports` (collectFacts against scratch sql.js; the route on a scratch
port: gate, isolation, validation; the client model and reports under `node --test`).

### The route

| method | path | |
|---|---|---|
| GET | `/api/bankrolls/reports?bankroll=&from=&to=&currency=` | `{ currency, bankroll, from, to, rates_stale, facts }` |

One **fact** per tournament result, ENDED cash session and expense / income row, with the
dimensions the ledger does not carry (a tournament's room, game and online flag live on
`tournaments`; a cash session's start and length on `cash_sessions`), money already in `currency`:

`{ id ('t12' | 'c3' | 'x5'), type ('tournament' | 'cash' | 'expense' | 'income'), bankroll ('main' | id), date,
label, profit, room, game, online, hour (tournament start, 0-23 or null), started_at + hours (cash),
stakes (cash), buyin + buyin_usd + bullets + cost + cash (tournament), category (expense / income) }`

- Money is the ledger's: tournament net = (cashed ? cash : 0) − buy-in × max(1, entries) in the
  venue's currency (`analytics.normaliseRow`), cash = cash_out − buy_in − tips − expenses, an expense
  negative. Converted through USD at the current rates. A live session is not a fact.
- Room: `property`, the site for an online event, else the venue (as `/api/analytics`). Cash sessions
  have no online flag: a session is online when its room names a known online site
  (`ONLINE_ROOM` in the module), else live.
- The route filters only by bankroll and date (both optional); every other filter is client-side,
  because a chip's count needs the unfiltered set anyway. The Reports tab asks for everything, once
  per currency.

### The filter model (`utils/bankroll-filters.js`)

`prepareFacts` derives weekday (from the date, UTC), start hour (a cash session's LOCAL hour of
`started_at`, in the viewer's zone; a tournament's own start), daypart, month, year, room / game keys
(case-folded), live / online, and one stakes key (`cs:2/5` cash stakes, `bi:b2` a tournament buy-in
band, the bands of `lib/analytics.js`).

Filters: `{ range, types, bankrolls, games, stakes, rooms, formats, weekdays, dayparts }`, each a
multi-select of keys: **OR within a dimension, AND across**; empty = no filter. `range` is `all`,
`30d`, `90d`, `12m` (ending today) or `yYYYY`. A fact with no value for a dimension (an expense has
no room) never matches an active filter on it. Dayparts: morning 6–12, afternoon 12–17, evening
17–22, late night 22–6. Chip counts are **faceted** (`facetCounts`): the facts passing every OTHER
filter, so a count is what tapping the chip would leave. A chip at 0 is disabled unless it is on.
The filters and the chosen report are remembered per viewer (localStorage `bankrollReports`); the
dashboard's bankroll selector sets the Bankroll filter when it changes.

### The reports (`utils/bankroll-reports.js`)

Room, game, cash stakes, buy-in, day of week, start time (by hour, read from 6 AM), **session
length** (cash: under 2 h … 10 h+), month (newest first) and expense category. Each row: count,
profit, and one rate for the whole table — per hour when every row is cash, ROI when every row is a
tournament, average per event / session when they mix, share for categories. Expenses and income
enter only Month (its Net; the rate is the games alone) and the category table. Best and worst rows
by profit are tinted and named in the line above the table. Bars are whole g across 35g from a zero
line (`barLayout`), every non-zero row at least 1g.

### Layout

Dashboard content is 35g. Bar 5r: Filters 8g | summary 17g (seated, truncating) | Clear 8g. Report
picker 3 × 11g chips, 4r. Figures: the dashboard's 2 × 17g stats. Table: 13g | 4g | 9g | 9g, head 3r,
rows 5r (a 4r text line, baseline on its line 3, over a 1r bar), total 4r. The filter sheet sits over
the dashboard (z above the modal layer), head as the dashboard's (Clear all 8g on 19g, Done 8g on
28g), sections 2r apart, chips 4r in 4 × 8g, 3 × 11g or 2 × 17g. Both are walked by
`check:controls` and `check:clipping`.
