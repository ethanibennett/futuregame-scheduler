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
- `computeBalances(bankrolls, entries, { nativeCurrency, convert })` — per-bankroll
  `{ start, adjustments, results, balance, entries, currency }`, plus an `'all'` row in USD
- `useBankrolls({ enabled: isAdmin, token })` — the list and the Results tab's selected key
  (localStorage `resultsBankroll`). Read `bk.selected` to follow the Results tab's choice.

A tax report probably wants the ledger too (deposits/withdrawals are not income):
`GET /api/bankrolls/adjustments?bankroll=…`.

## Staking, and how they could connect

Bankrolls do not touch staking, and in this beta a "Staked" bankroll shows the **gross**
result of the events filed under it — what `tracking_entries` stores — not the player's share.
Staking keeps its own per-agreement numbers (`backer_event_status` buy-ins/cashes,
`backer_settlements`) and is the authority on who owns what. The two do not contradict
because they answer different questions: staking = what I owe backers; bankroll = where the
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
- Not wired into `computeBalances()` (the switcher's balances) — that is the ledger's job
  (`lib/bankroll-ledger.js`, which loads the source below).
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
