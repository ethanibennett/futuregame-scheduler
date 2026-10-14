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
| DELETE | `/api/tracking` | bulk delete, always scoped: `?bankroll=main\|id` (that bankroll's results; another user's is a 404) or `?all=true` (every bankroll); neither, or `?bankroll=all` alone, is a 400. `?expect=n`: the count the typed confirmation showed — a different count is a 409 and nothing is deleted. → `{ count, scope }`. For everyone, not just the beta (a non-admin's results are all in Main). Results > Delete results (`ResetResults.jsx`, `utils/reset-results.js`) is the only caller; it left the home on 2026-10-11 |

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
- `useBankrolls({ enabled: isAdmin, token, version })` — the list, the summary and the Results tab's
  selected key (localStorage `resultsBankroll`). Read `bk.selected` to follow the Results tab's
  choice. Since 2026-10-12 App creates it once (`version` = the tracking entries, so the summary is
  refetched after a result changes) and hands the same `bk` to the home (its bankroll line, period
  block and goals) and to the Results tab: one summary, never two that disagree.

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

The home opens it too, on All bankrolls: its bankroll line on **Rules**, its goals on **Goals** and its
period block on the **Overview** (`initialTab` / `initialKey`, through `BankrollDashboardSheet`), as
does its signal-or-noise line when the sentence is about cash (home step 6; a tournament sentence
opens the Analytics sheet). For cash that line reads the whole ledger once (no `from`), reduced on the
client to a per-hour spread (`utils/home-noise.js` `cashSpread`: sum of profit over sum of hours, and
an SD per hour with each session's variance growing with its hours).

A 37g sheet (phone and desktop alike). Under the bankroll chips, one tab strip:
**Overview / Sessions / Locations / Reports / Rules / Goals / Import** (seven, so the strip scrolls). A new tab is one entry in `TABS` plus one
render line (`{tab === 'key' && …}`, marked in the JSX); the guards walk every tab in the strip on
their own. The strip (`BankrollTabStrip.jsx`, arithmetic in `utils/tab-strip.js`) handles any count:

- **Divided** while every label fits: a single 35g `.bd-seg` whose segments split the width in whole g,
  the first (35 mod N) one g wider (4 tabs 9+9+9+8g, 5 tabs 5 × 7g, 6 tabs 5 × 6g + 5g, 7 tabs 7 × 5g).
  "Fits" is measured: a hidden copy of the labels in the tabs' type, in g, each label plus 1g of room
  within its own segment (`fitsDivided`), re-measured on resize and when the webfonts load.
- **Scrolling** otherwise (seven tabs at 5g: "Locations" is wider): one 35g × 5r row of pills, each
  content-sized (label + 1g a side) and rounded up to whole g by `snap-g`, 1g apart. The selected pill
  is scrolled into view when the strip opens, whenever the tab changes and after the viewport's width
  changes (a rotation, a window resize: g is a new number of px, so the old offset is re-snapped to
  whole g first, then the pill revealed from there — on the window's resize after the strip
  re-decides, and from its ResizeObserver when the strip's or its pills' width moves), to a whole-g
  offset with 3g clear for the fade (`revealScroll`), so the pills come to rest on g lines. WebKit
  keeps `scrollLeft` in whole CSS px and drops a fraction, so the offset asked for is rounded to the
  nearest px (≤ 0.5px from its g line; floored it was up to 1px short). Its scroll range is whole px
  too: at the strip's very end the last pill can sit up to 1px under the edge (0.69px at 430 wide,
  measured with a simulated seventh tab), whatever the reveal asks. A 3g fade marks an edge
  with more beyond it; no scrollbar. Over the fade's outer 2g, a chevron is a real button (2g × 5r,
  "Earlier tabs" / "More tabs", `tabindex -1`, outside the radio group, gone while its edge has
  nothing beyond) that pages the strip by the view less both fades, to a whole-g offset
  (`pageScroll`). Touch and trackpads scroll it natively; a plain mouse wheel turned over it scrolls
  it sideways while it can still move that way, then the sheet scrolls on (`wheelToStrip`); ←/→
  (and ↑/↓), Home and End move the selection (a radio group with one tab stop). Roving focus always
  lands on the selected pill, so its focus ring is its own: inside the selection's brand ring, a
  0.25r gap of ground, then a 0.25r ring (`--n-8` in high contrast).

**Overview** (`BankrollOverview.jsx`), laid out the way a dedicated poker tracker lays out its home
screen, in this app's own type, tokens and grid:

| block | what | the tracker pattern it borrows |
|---|---|---|
| Hero (2 × 17g, 9r) | balance now · profit over the range, coloured by sign, with the event / session count | the headline profit over the graph |
| Graph (`BankrollChart.jsx`: 4r head, 5r pills, 2r label room over the 35g × 24r plot, 2r foot) | **Profit**: up to three cumulative lines from 0 at the range start — **Total** (every result, the hero's profit), **Tournaments**, **Cash** — toggled by pills that are also the legend (colour swatch, end value), with a **Fill** pill shading each line down to 0; or **Balance** (one line, deposits included). Nice gridlines labelled at the left; drawdown from the peak shaded when one line is drawn | Poker Bankroll Tracker's Trend chart (Cash / Tourney / Total overlays, area fills) and the cumulative "chip graph" |
| Range (35g × 4r, 5 × 7g) | 1M · 3M · YTD · 1Y · All, trailing windows ending today (`rangeWindow`); remembered per device (`bankrollRange`, `bankrollChart` in localStorage, with the graph's `bankrollSeries` and `bankrollFill`) | the time filter on the graph |
| Tables (`BankrollOverviewTables.jsx`, `bankroll-overview-tables.css`) | six collapsible sections, each headed by a 35g × 5r disclosure row: the name, the range and bankroll it covers, a chevron, and while closed its headline figure on the right. **Summary** (Cash \| Tournaments \| Total): buy-ins (cash: buy-in incl. rebuys; tournaments: buy-in × bullets), cash-outs, tips & costs (cash, when any), net profit, expenses & income (Total), **total result** (= the hero's profit), deposits & withdrawals (Total), balance change (Total: result + money moved). **Sessions**: sessions / events, bullets, hours and $/h (cash), ROI (tournaments), won % / ITM (tournaments: cashes per entry, the Analytics rule), average buy-in, profit and rebuys / re-entries, biggest win and loss. **Games** and **Rooms** (from the report facts): one row per game / room, cash and tournaments in separate blocks (count, hours, $/h or ROI, total, best first). **Bankroll**: balance, all-time peak, below it, deepest drawdown in the range, money moved, risk of ruin. **By month** (By year for All): results, moved, net. Summary and Sessions start open; open / closed is per device (`bankrollOverviewOpen` in localStorage). The scope line, the currency and the reports query come from the ledger in hand (`d.bankroll`, `d.currency`), not the bankroll chip, which runs one round trip ahead of it; until the ledger (for Games and Rooms, also the report facts) is the one asked for, a section keeps its figures on screen, dimmed, with `aria-busy` | Poker Bankroll Tracker's Bankroll › Overview: tables with a column per game type and a total, zebra rows, right-aligned tabular figures, compact money ($403.2k from $10k) |
| Latest sessions (6r rows, 14g \| 21g) | the six newest tournament / cash results in the range, each led by its signed profit in the display face, with date, event or game, and hours / bullets; buttons to Results' Tournaments and Cash halves (they also select the dashboard's bankroll on the Results tab) | the session list led by a big green / red profit |

The graph (`BankrollChart.jsx`, fed by `BankrollOverview.jsx`):

- **Lines.** Profit mode draws any mix of three cumulative series over one date axis, each from 0 on
  the range's first day: **Total** = every result (tournaments + cash sessions + expenses & income;
  ends at the hero's profit and the Summary's Total result), **Tournaments** = the `tournaments`
  source, **Cash** = `cash-sessions`. Expenses & income have no line of their own; while Total is on
  and they moved it, the head note says so ("Total includes expenses & income −$1,630"). Lines are
  steps (a total holds until money moves), all at `--bw-2`. Total is drawn first, under the others,
  and while others are on it runs a hairline wider (`--bw-2` + `--bw-hair`, class `bd-under`): where
  it coincides with Tournaments or Cash (only one of them moves on a given day) half a hairline of
  it shows either side, a hint rather than a casing; alone it is drawn at the others' weight. (It
  was 1.75 × `--bw-2`, which outlined the Tournaments line in white in dark and in black in the
  light themes for most of a tournament-heavy range.)
- **Date axis.** x is calendar time from the range's first day to its last (`chartSpan`): today for
  1M / 3M / YTD / 1Y, whose windows leave later entries out. All has no last day and keeps every
  entry (as the hero and the tables do), so when the ledger holds one dated after today (a prepaid
  hotel, a result logged ahead of the event) All runs to that entry's date and its step lands on its
  own day instead of piling up at today's edge; the end date under the plot says so.
- **Pills** (5r; Total 8g, Tournaments 10g, Cash 8g, Fill 6g, 1g apart): each is the line's legend
  (a swatch in its colour, its end value for the range, "None" when the range has no such entries)
  and its switch (`aria-pressed`). Any mix can be on; the last one on cannot be turned off
  (`aria-disabled`, "One line always stays on"). Default: all three on. **Fill** (On / Off, default
  On) shades each drawn line down to the zero line in a low alpha of its colour, one alpha per line
  (`--series-fill-total` / `--series-fill-tourn` / `--series-fill-cash`) so that each fill stands
  about 1.2:1 off the sheet; the fills overlap translucently. Both are remembered per device:
  `bankrollSeries` (`'total,tourn,cash'`, known keys only, never empty: `parseSeriesPref`) and
  `bankrollFill` (`'1'` / `'0'`), read and written in try/catch like the range and mode.
- **Balance mode** stays one line (deposits do not split by game type): the series pills give way to
  a single, fixed Balance pill; Fill still works on it (down to the bottom gridline when the scale
  does not reach 0).
- **Drawdown** (the band between the running peak, dashed, and the line, in `--neg-quiet`) only when
  one line is drawn — one series in Profit, or Balance; with several it is clutter. The band is
  always its full depth, peak to line, so the red is the drawdown, Fill on or off. With Fill on the
  line's fill gives way under it instead (`drawdownBand`'s `edge`: the fill runs from the floor up
  to the line where the line is at or above the floor, else only to the nearer of the peak and the
  floor), so the two translucent layers never stack: stacked, the aqua or violet fill and the red
  mixed to a flat neutral grey and both colours were lost. A profit line is in drawdown wherever it
  is below 0 (its first point, 0, is a peak), so there it is red from the peak down to the line and
  has no fill; above 0 it keeps its fill under the line and the red above it. (The band once
  stopped at the fill's edge instead, which cut a losing range's drawdown short — a YTD Cash line
  down $3,146.83 from its peak showed $2,574 of red — or hid it: a line that never rose above its
  start showed none.) The foot says "Red: drawdown" when it shows. A band under a quarter r deep
  at its deepest is not drawn or named, and the line keeps its plain fill: a scale coarsened for its
  labels (below) can leave a real drawdown thinner than a pixel — MX$15 on a MX$950k–1.05M scale —
  and the foot would have named red that nobody could see.
- **Axis.** One y scale over the lines that are on (a hidden line does not stretch it), rounded out
  by `niceTicks` to 2, 3 or 4 steps of 1 / 2 / 2.5 / 5 × 10ⁿ — 3 to 5 gridlines; Profit always takes
  in 0 as a gridline, drawn a touch stronger (`--text-muted`, `--bw-1`; the others `--border`,
  hairline). Each count divides the 24r plot, so every gridline is on an r line. The labels are HTML
  (the SVG stretches), `compactMoney` in the display currency's own form ($5k, −$2.5k, 5k kr,
  ¥1.2M), each in a 5g gutter at the left with its baseline level with its gridline. Each label is
  its gridline's exact value: the step sets the precision (`compactMoney(v, { step })`: the largest
  unit, k or M, no larger than the value, in which the step needs at most two decimals, written with
  as many as it needs; else whole units, grouped as the locale groups). So a balance from 9,985 to
  10,000 in steps of 5 reads $9,985 … $10,000 — a fixed two decimals of k once read $9.98k, $9.99k,
  $9.99k, $10k (a repeat, and the bottom gridline named after a value 5 away) — and ¥1,234,000 to
  ¥1,236,000 in steps of 500 reads ¥1,234k, ¥1,234.5k … ¥1,236k. Profit is unchanged by this: 0 is
  a gridline, so the step is at least a quarter of every label. Nothing is drawn in the gutter: the
  gridlines, the zero line and the data lines all start at 5g, so a label never meets a line (a
  gridline from x = 0 once ran under its label and through the $'s descender), and gridlines are
  at least 6r apart, so labels never meet each other. An exact label can be long (a MX$1,000,000
  balance down MX$15 would want MX$999,985 … MX$1,000,000, about 5.5g): the chart measures the
  labels after layout and, while any one's ink comes within 0.5g of the lines, coarsens the scale a
  power of ten at a time (`niceTicks`' `minStep`), before paint. The widest labels the seeded
  bankrolls draw measure 4.2g ($1,000,000). Under the plot: the range's start date at 5g (where the
  lines start) and its end date at the right.
- **Whose figures.** The bankroll chip, and so its currency, changes a round trip before the ledger
  does, and the previous ledger stays on screen meanwhile. So the whole Overview (hero, pills,
  gridline labels, head note, latest sessions) formats its money in the currency of the ledger in
  hand and names its scope from it (`ledgerScope`, as the tables do), and the hero, the graph's
  figures and the latest sessions dim with `aria-busy` until it is the ledger asked for; the pills
  and switches keep full strength. Never the old figures in the new currency.
- **Colours** (`styles.css`, "Chart series"): `--series-total` (the text colour), `--series-tourn`
  (the brand aqua), `--series-cash` (a violet), defined for the dark default and overridden for
  light, cloudy and each high-contrast theme. The same tokens key the tables' column heads, as
  text, so Cash clears 4.5:1 on the sheet (and so 3:1 non-text on the sheet and on the pills) in
  every theme; it sits lighter or deeper than the aqua everywhere, so the lines differ in lightness
  as well as hue (on light, `#4c1d95`, midway between Total and the aqua: OKLab L .38 against .22
  and .52; `#5b21b6` had sat .09 from the aqua, and under protan and deutan simulation the pair
  drew closer still). The fill alphas come in two sets, the dark grounds (0.09 / 0.11 / 0.155) and the
  light ones (0.09 / 0.125 / 0.11): one shared 0.12 left Cash's fill at 1.14:1 on the dark sheet
  against Total's 1.33, nearly invisible; now every fill is 1.17–1.24:1 and every line clears 3:1
  over the other two fills (lowest: Cash on cloudy, 3.27). Measured values are in the comment above
  the tokens. No orange.

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
when it has nothing under it), `profitSeries`, `peakOf`, `rangeWindow`, `recentResults`, and the
graph's: `gameSeries` (Total / Tournaments / Cash / other on one date axis, summed in integer cents so
tourn + cash + other == total exactly on every row), `seriesLine`, `parseSeriesPref`, `niceTicks`,
`compactMoney`, `chartSpan` (the date axis) and `drawdownBand` (the band at full depth, and the
edge the fill keeps under it) — tested in `utils/__tests__/bankroll-ledger.test.mjs` (the series
identity, 1M / YTD windows restarting at 0, empty, single-entry and negative-only series, flat and
junk extents, a 2,000 extent sweep for the tightest nice step, `minStep`, a future-dated entry in
All and in the trailing ranges, a clock behind the ledger, the band's depth equal to the drawdown
and never sharing more than one value with the fill over 300 random walks, and a 3,000-scale sweep
from cents to hundreds of millions in which every gridline label is unique and reads back as its
gridline's value).

Baselines: hero figures are the display face at `--fs-2xl` (c measured 1.0983r at 402 wide, 1.1238r at
1440 — the face's ascent rounds to whole px, so `p` splits the difference, ≤ 0.03r off); the latest
sessions' profits the display face at `--fs-xl`, likewise. Every other cell uses analytics.css's roles.

### Sessions (`BankrollSessions.jsx`, `bankroll-sessions.css`, `utils/bankroll-sessions.js`)

Every tournament result and every finished cash session of the selected bankroll in one list,
newest first, under a centred year pill: Poker Bankroll Tracker's Bankroll › Session tab, in this
app's type and grid. No route of its own; three existing reads, joined on the client
(`buildSessions`):

- `GET /api/bankrolls/reports?bankroll=&currency=` — one fact per result: the date (already
  YYYY-MM-DD, a tournament stored as "May 28, 2026" too), the room (property / online site /
  venue, never the series title) and the result in the dashboard's currency, the ledger's own
  arithmetic. Expenses and income are facts too, and are dropped; deposits are not facts. A live
  cash session is not a fact, so it never appears.
- `GET /api/tracking?bankroll=` (joined on `t<id>`) — finish place, field size, notes, the event's
  own buy-in and venue (its native currency), start time, event number.
- `GET /api/cash-sessions?bankroll=` (joined on `c<id>`) — start / end, rebuys, cash-out, tips,
  expenses, currency, notes, tags; a session's stack updates (`GET /api/cash-sessions/:id`) when its
  detail opens. Without the two joins every row still shows, with a line saying details are missing.

| part | what |
|---|---|
| Bar (4r) | All · Tournaments · Cash, one-select chips (6g, 9g, 6g), remembered per device (`bankrollSessionsType` in localStorage), and the count (11g, seated). A one-line note under it: expenses, income and deposits are not sessions. |
| Year pill | 7g × 3r on 14g, label centred, `--surface2` with the rows' hairline edge (the fill alone is 1.03:1 on the sheet in cloudy); a new pill wherever the year changes. |
| Row (7r card, 1r apart) | a type icon (3r: a $ coin in `--series-cash`, a stopwatch in `--series-tourn`), the title (cash: stakes + game, "$2/5 NLH"; tournament: compact buy-in + event name, "$1.5k Limit Badugi") over the room (a cashed tournament's finish first, "12th / 845 ·"; "Room not recorded" when there is neither), and the result (display face, green / red, `+` before a win, compact from 10k: "$2,410", "+$12.3k") over the date ("Sat, May 30, 2026", from the date's own parts, no time zone). Title, room and date truncate with their descenders' room. |
| Show more | past 150 rows (`CHUNK`), 150 at a time; rows are memoised. |
| Detail (tap a row, in the sheet, read-only) | ‹ Sessions and Edit in Results; the title (wrapping, 4r lines), what and where; the dashboard's hero (result / net in the dashboard's currency, and ROI or per hour); then every field held. Tournament: date, start, series (when the venue is not the room), event #, game, buy-in, bullets, cost, cashed, finish / field, profit, ROI, the figure in the dashboard's currency when the event was in another, bankroll, notes. Cash: date, played (start – end), length, game, stakes, buy-in (with rebuys), cash-out, tips, expenses, net, per hour, high / low and the stack graph when it has stack updates (the Cash view's swing graph from `utils/cash-sessions.js`), tags, bankroll, notes. ROI is not coloured (a percentage, not money). |

**Focus and Escape.** A row opened from the keyboard (Enter / Space) puts the focus on ‹ Sessions,
so the next Tab reaches Edit in Results; a tapped row puts it on the detail itself (tabindex -1, no
ring), so it never falls to the body and out of the dialog. Escape in the detail goes back to the
list and stops there (the dashboard's window listener would otherwise close the whole sheet); Back
or Escape from the keyboard returns the focus to the row that was opened, after the list's scroll
is restored, a tapped Back to the list itself. A keyboard Show more that adds the last rows moves
the focus to the first of them. A bankroll switch clears the list to Loading… until the new
bankroll's rows arrive: the rows are kept with the bankroll and currency they were built for and
never shown under another (they were, for the length of the read, in the new currency's symbol).

**Titles and rooms.** An amount the event name leads with is dropped from the title only when it IS
the entry's buy-in, to the title's own rounding ("$1,500 Mystery Bounty" at 1500 reads "$1.5k
Mystery Bounty"; a k / M suffix counts only straight after the digits, so the M of Mystery and the
K of Knockout stay), and never when a guarantee follows ("$20,000 GTD" on a $215 event reads
"$215 $20,000 GTD"). Any other amount is part of the name: a EUR result imported from a tracker
file, its buy-in converted to USD on the way in, reads "$1.2k €1,100 Monster Stack". A tournament
whose venue is `Personal` (the app's private events, and every result `POST /api/bankrolls/import`
writes) has no room and no series: the facts' room falls back to the venue, and "Personal" is a
label, not a room; nor is it a game. A cash session's room is free text and kept as typed.

Ordering: date, then start time (a tournament's scheduled start, a cash session's local start),
then id, newest first. A cash session's day is its `session_date`, the player's local day it
started, so a session begun at 23:30 on Dec 31 is in that year.

**Edit in Results** closes the sheet and opens that entry's edit form on the Results tab:
`hooks/useResultsFocus.js` carries the entry across the close and switches Results to the right
half (`setResultsKind`, as the Overview's latest-sessions buttons); TrackingView opens the result's
edit form and brings it to the top of the tab's scroller, CashSessionsView opens the session's edit
screen. It is offered only when the sheet is over the Results tab: the home opens this sheet too
(HomeNumbers), and from there closing it would leave the player on the home, so the detail says
where to edit instead.

Tests: `vite-app/src/utils/__tests__/bankroll-sessions.test.mjs` (run by `npm run test:bankrolls`):
dates and labels, compact money and buy-ins, titles (a leading buy-in, a guarantee, a word that
starts with K or M), Personal rooms, finish, ordering across a year boundary and a
past-midnight cash session, the type filter, year groups, the figures of both details, and rows
built without the joins. The guards walk the tab: `check:controls` views `bankroll-sessions*` (the
list scrolled past a year, its foot with Show more, the Cash filter, a tournament's and a cash
session's detail; `.bs-row` is in NOT_CONTROLS), `check:clipping` the list paged to its end (the
first 150 rows and Show more; the sheet pass stops at 11 pages, the Sessions passes do not), the
Cash filter and both details scrolled through, and the rows Show more adds.

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
view (which shows the full live card), on Hands, and on the Dashboard, where the session is the first
Up Next card instead (`HomeCashCard.jsx`, home step 5: the clock, what is in play and the last stack
against what was in; Update stack posts a stack update in place, Cash out opens the live screen with
its cash-out panel open, intent `cash-end`; a tap elsewhere opens the live screen). The session is server-side, so the clock survives
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
| GET | `/api/bankrolls/trips/:id` | → `{ trip, transactions, results, cash_sessions }` — results are the tracking rows whose event date (ISO or "Month D, YYYY", read at noon) is inside the trip, in its bankroll scope; cash_sessions the ENDED sessions whose day is inside it, in its scope, read through the ledger's own cash source (`{ id, date, amount, currency, hours, label, bankroll_id }`, amount = cash_out − buy_in − tips − expenses). Totals are the client's (`tripPnl()`), because results are in each venue's currency |
| DELETE | `/api/bankrolls/trips/:id` | → `{ deleted, untagged }` |

**One trip net.** `tripPnl()` (`utils/transactions.js`) is the only definition of a trip's P&L:
tournaments (cashes − buy-ins) + cash sessions + income − expenses. The trip page (Results >
Expenses > Trips) and the home's period block in trip mode both run it on the same `/trips/:id`
payload with the same exchange rates, so the home's "Net after expenses" is the "Trip net" its tap
opens (2026-10-12; the home used to add the trip's cash sessions and the page did not, and a trip with
two sessions read +$3,014 on the home and +$3,567 on the page). It reports `unconverted`, so the
home shows a dash and "Waiting for exchange rates" rather than a part-total.

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
stakes (cash), buyin + buyin_usd + bullets + cost + cash (tournament), category (expense / income),
native_currency (what it was played or spent in, before conversion: a tournament's venue currency, a
session's or a row's own) }`

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

## Locations (beta, app admins)

The dashboard's **Locations** tab: one card per room, the way Poker Bankroll Tracker lists its
locations (its Bankroll › Locations screen), in this app's type, tokens and grid. Code:
`components/BankrollLocations.jsx`, `components/bankroll-locations.css`, the arithmetic in
`utils/bankroll-locations.js`. Tests: `src/utils/__tests__/bankroll-locations.test.mjs`, part of
`npm run test:bankroll-reports`.

- **Data**: `GET /api/bankrolls/reports?bankroll=<the dashboard's>&currency=<its display currency>`
  — the Reports facts, prepared by `prepareFacts`, so a room is exactly a row of the Room report
  (`roomKey`: trimmed, case-folded; the label is the first spelling seen). No new route; the facts
  gained `native_currency` for the card's currency. Tournament results and ENDED cash sessions only:
  expenses and income are not sessions and have no room. Facts naming no room collect in one
  "Room not recorded" card, always last and not counted as a room.
- **A card**: the room's name; "Live • USD" (live, online, or "Live and online", and the room's own
  currency or currencies, most used first); the total result at the right, signed and green / red,
  whole below 100,000 ($15,590) and compact from there ($294.5k, $1.2M — the owner's two examples
  from PBT; "compact ≥ $10k" in the brief contradicts its own $15,590); a hairline; then the stats
  line, items joined by " • ":
  - **entries** — cash sessions + tournament bullets (a re-entry is an entry, as PBT counts);
  - **hours** with a clock — cash hours only; omitted, not "0", for a tournament-only room;
  - **per hour** — cash profit / cash hours, when there are hours;
  - **ROI** — tournament profit / buy-ins, when the room has tournaments;
  - **won % / ITM** — per ENTRY, over the same entries the card counts (owner, 2026-10-13: the app
    has one ITM, cashes per entry, as `lib/analytics.js`, the Analytics tab and the Overview's
    Sessions table count it). A cash room: winning sessions / sessions ("60% won"); a tournament
    room: cashes / bullets ("9% ITM" — a re-entered event that cashed once is one cash in its
    bullets, so the card and the Sessions table read the same); a mixed room: (winning sessions +
    cashes) / entries ("38% won/ITM" — the share of its entries that came back with money, a cash
    session up or a tournament entry paid; each side's own rate weighted by its entries, so it
    reduces to the won % or the ITM when the room has one kind only. The Overview leaves its Total
    column blank there instead, since it has both columns beside it; a card has one line). The
    word carries the tone, the same rule on every card: **won** is green at 50% and over, red
    under (more winning sessions than losing ones); **ITM** and **won/ITM** have no break-even
    line at 50% — cashes are in them — and are never coloured.
  A type mark (dots in `--series-tourn` aqua and `--series-cash` violet) after "Live • USD" says
  which kinds the room has (after, so that line starts on the name's g line on every card); the
  footnote is its legend, and says expenses aren't included.
- **Open a card** (tap; `aria-expanded`): the room's name wraps whole (3r a line — a long name is
  otherwise only in a `title`, which a touch screen never shows), then its results newest first —
  date | tournament (× bullets) or game, stakes and length | result — ten, then a page at a time
  (`rowsPage`): "Show 50 more" while more than fifty are left, "Show all N" for the last page, and
  "Show fewer" once past ten, which puts the card back in view (`scrollIntoView` nearest, 1r scroll
  margin) and keeps keyboard focus on a pager button. A room with more than sixty results also says
  "60 of 1,030" at the pager's right. Closing a card starts it over at ten.
- **Range** (1M · 3M · YTD · 1Y · All, the Overview's windows, default All) and **sort** (Result,
  Entries, Hours, Name; the room-less card stays last) are remembered per device (localStorage
  `bankrollLocations`). Empty state when nothing in the range.
- **Layout** (35g; the CSS header lists every row): range 35g × 4r; the summary (rooms · entries ·
  total · range); a 3r "Sort by" label and the 35g × 4r sort; cards 35g × 11r, 1r apart — the name
  (Univers Condensed md, measured p 1.565) on line 3, "Live • USD" on line 5, the total (display face
  xl) level with it, a hairline at line 6, the stats on line 9, 1r below: the name's caps start 1.57r
  down; the stats are Univers Condensed sm, the tables' size (`--fs-sm`, p 0.6978 as `an-td`:
  measured −0.008r at 402 wide, +0.011r at 1440), and the longest plausible line ("1,234 entries •
  1,234 h • −$1,234/h • ROI −100% • 100% won/ITM") is 30.6g of its 33g.
  Columns inside 1g a side: the name takes what the total leaves (`minmax(0, 1fr)`); the total is
  its own width rounded up to whole g (`snap-g`), so "+$150" leaves the name 26g and "−CHF12,345"
  takes 12g instead of spilling into the padding. Open rows 4r, 7g | 17g | 9g, baselines on line 3;
  pager buttons 11g × 4r, 1g apart. Baselines measured in WebKit at 402 and 1440 (2026-10-13, a card
  open): every line within 0.036r of its r line (the bold result cells take the Overview tables'
  bold correction, p 0.7586: −0.049r at 1440 before, +0.022r / −0.019r now). The cards are list rows (`.bl-card` in the controls guard's NOT_CONTROLS); the
  pager buttons are controls, measured in the guard's `bankroll-location-pager` / `-paged` steps
  with the pager scrolled into view. The dashboard sheet is 37g on a desktop too, so the cards stay
  one column there.
- **Known limit — one room, several names.** Rooms group exactly as the Reports "Room" breakdown
  does (property, else site, else the venue string, trimmed and case-folded). A result with no
  `property` (manual entries, feed rows from before 2026-08-31) groups by its venue string, which
  can be an alias or a series title, so one physical room can show as two cards ("Wynn" and "Wynn
  Las Vegas"). The fix belongs in one canonical room-alias step shared by Reports and Locations
  (e.g. folding `VENUE_MAP` aliases that share a strip, or the venue directory), not here alone.
