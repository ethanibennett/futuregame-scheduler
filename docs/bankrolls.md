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
