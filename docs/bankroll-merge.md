# Bankroll merge: futurega.me becomes the one money store

Status: **design** (2026-10-14); **Phase 1 built** on `feat/money-merge` (merged), **Phase 2 built**
on `feat/money-merge-2` (merged), **Phase 3 built** on `feat/money-merge-3`, not yet merged, **Phase 4
built** in the dashboard repo on `feat/money-export`, not yet merged (see "Phase 1: as built" to
"Phase 4: as built" after the §15 table).
A buildable spec for moving the dashboard's money
(dashboard.futurega.me, repo `wsop-console`) into this app (futurega.me, repo
`futuregame-scheduler`), cut into phases small enough for one builder each.

**The owner answered the open questions on 2026-10-14 (§1.1). Five answers differ from the
defaults this document was written to, and they override any older sentence below.** Passages they
change carry a "Superseded by §1.1" note.

Path shorthand: bare paths are this repo at `origin/master` `2ad9c91`. **WC:** is
`D:\projects\wsop-console` at `0968eb9`. Every `file:line` below was read for this spec. The two
read-only maps made the same morning were the starting point; where this spec disagrees with them,
the code won and §2.2 says so.

This repo is public. Nothing here names a backer, quotes a token or uses a real amount. Examples
are made up.

---

## 0. The plan in fifteen lines

1. futurega.me owns every dollar: results, deposits, transfers, expenses, staking and backer pages.
2. The dashboard's data comes in once through a token-gated **server-to-server pull** into a
   staging area. It is pulled again at cutover to pick up the last nights.
3. Nothing is written until the owner has answered a **review list** in Bankroll › Import. The list
   holds the likely duplicate pairs, the backer matches and the reconciliation.
4. Cash nights become `cash_sessions`. Tournament nights become Personal tournaments plus
   `tracking_entries`, as the CSV importer does. Fund nights land in a new **WSOP fund** bankroll.
5. Fund transfers become paired transfer legs. Corrections and backer settlements become two new
   adjustment kinds that count as money moved.
6. Each dashboard id becomes a fingerprint in `bankroll_import_keys`. A `chat-<sha1>` id keeps its
   exact text, so a night told to Claude before and after the move is still one row.
7. A new **standing agreement** (one per backer, not per series) holds dated stakes by format and
   channel plus a signed opening balance. The dashboard's `matchPct` math is ported with its tests.
8. A share is computed from a result, and posted when the owner taps Notify for it (**§1.1 Q1:
   not on save**). Its percentage is the stake in force on the result's date. Editing a posted
   result re-derives its share and the backer's page just updates (**§1.1 Q2: no push, no SMS**).
9. History from the dashboard (`backer_events`) is kept byte for byte. Every token moves verbatim
   onto `backers.public_token`, so every `/b/` link keeps working.
10. The staking settlement sheet is fixed: it returns its ids and paid flags and recomputes figures
    on the server. Makeup is stored as opening and closing balances, and the markup sign is
    corrected.
11. A new owner API (`/api/owner/money`, `/api/owner/sessions/log`) is gated by a new
    `LEDGER_TOKEN`. It feeds the dashboard's roll card, widget, watch, Cockpit and both MCP tools.
12. The dashboard server becomes an adapter. The native apps keep calling the same summary URL, so
    no app build is needed.
13. The dashboard's Sessions, Bankroll and Admin tabs retire and are replaced by links into
    futurega.me.
14. The fund target lives in one place, the fund bankroll. The 65k versus 50k drift goes away.
15. Cutover order: freeze dashboard writes, pull the delta, turn posting on, switch the dashboard's
    reads. Each step has a rollback. Seams 1 (notify) and 3 (roster) retire only after a soak.

---

## 1. Owner decisions (2026-10-14, final) and what this spec adds

| # | Decision | Where it is built |
|---|---|---|
| 1 | futurega.me is the one source of truth for bankroll and staking money. The dashboard's `sessions`, `adjustments`, `expenses`, `backers` and the synced blobs `wsop-staking`, `wsop-balances` and `wsop-notified-sessions` are imported for the owner's user. | §4, §5, §8 |
| 2 | Keep the scheduler's staking model and add the dashboard's standing % as a new agreement type. `/b/` pages, push, SMS and the digest are computed here from this app's results. Every token and link keeps working, with `backer_events` intact. | §6, §7 |
| 3 | The dashboard's money screens retire and become links. Today, Health, Train and Plan stay. The roll card, iOS widget, watch, screensaver Cockpit and MCP `log_session`/`get_bankroll` read from and log to futurega.me. | §11, §12 |
| 4 | Nights logged in both apps go to the owner as a review list to confirm or reject before anything is written. | §9 |

This spec decided four things the decisions left open. Each is in §17 with its default.
- **Posting:** a share is posted on save, not on a tap. *(Superseded by §1.1 Q1: a manual Notify tap.)*
- **Edits:** a share follows its result. *(Stands. §1.1 Q2: and nobody is told.)*
- **The roll:** the roll is every bankroll except the fund. *(Stands, Q4.)*
- **Imported expenses:** they do not move the roll, as in the dashboard. *(Stands, Q6.)*

### 1.1 Owner answers to the open questions (2026-10-14, final)

The owner answered every question in §17. Nine match the default the spec was built on. **Five
differ, and these override any other sentence in this document.** A later phase builds to this
table, not to the older text. Phase 1 (the schema, `lib/staking/classify.js`,
`lib/staking/standing.js`) is already built to it.

| Q | Spec default | Owner's answer | What it changes |
|---|---|---|---|
| **Q1** Posting shares | Post when a result is saved | **Keep a manual Notify tap.** Shares do not post on save. A share posts only when the owner taps Notify for a result. | The engines stay pure, and the posting trigger is a later phase. `syncSharesFor` (§6.5) no longer **creates** events from every write path. It is split in two. *Create:* only the Notify action, for one result, after the owner has seen the cut. *Follow:* every write path to a result that already has a posted event re-derives or voids that event (Q2). The "Posts to backers" line on the form (§6.5 Preview) stays as the preview in front of the tap. A night nobody taps stays unposted, which is how the dashboard behaves today (§2.2 point 2); the owner has chosen that. `money_settings.posting` and the cutover state (§11.4, §13 step 6) still gate the Notify action. Phases 7 and 8 and the §16 row for Phase 7 read "post on save" as "post on Notify". |
| **Q2** Correcting a past result | Push "Corrected: …", mark it on the page and the digest | **Nothing.** | When a past result is edited, a posted share follows it (§6.6) and **the backer's page just updates**. No push, no SMS, no "corrected" mark on the page or in the digest. The delivery sweep (§6.7) has no correction branch and the `correctionsPush` setting goes. `backer_event_revisions` rows are still written, for the owner's own audit. The `backer_events.revised_at` and `notified_*` columns stay in the schema because they are additive; a phase may use them or leave them. |
| **Q7** A standing stake and a series agreement on the same tournament | The series agreement wins; no standing share | **Ask the owner each time.** | `resultCuts` (`lib/staking/standing.js`) returns **both** matches, with `ask: true` on the standing cut, and does not choose the series agreement. The Notify sheet shows both and the owner picks series, standing or both. Where that answer is stored is left to Phase 7 (the schema has `standing_exclusions` for "series wins" and nothing for "standing wins" or "both", so the owner would be asked again). §6.2's overlap rule and §6.9 read this way. |
| **Q8** Which games count as a backer's "PLO", "PLO8", "Mixed" | The §6.3 families (5- and 6-card PLO as PLO, PLO hi-lo of any size as PLO8, HORSE and the N-game mixes as Mixed) | **Every game on its own.** The family table is dropped. | A stake's format matches **only that exact game, or `all`**. PLO5 is not PLO, and PLO6 8/b is not PLO8. `formatOf` returns one key per game (§6.3, rewritten). `standing_stakes.format` holds any key in `classify.js` `GAMES`, so the editor lists those. A game the table does not name is `other`. |
| **Q11** When a backer pays for their piece of a series | At settlement, netted, with an optional "prepaid" figure | **Up front, before the event.** | Changes settlement, which is Phase 3 (§10). See "Q11 in §10" there. In short: `prepaid` stops being an optional credit and becomes the normal case. |

The nine answers that match the spec's defaults: **Q3** a computed opening deposit, editable in the
review. **Q4** the roll is every bankroll except the WSOP fund. **Q5** a fund target of $65,000 by
2027-05-03. **Q6** imported expenses do not lower the roll but count for tax. **Q9** keep a deleted
backer's page and end the agreement. **Q10** record standing payouts (Phase 14). **Q12** the cash
share is the net after tips and session expenses. **Q13** Trends, Review and Settings stay on the
dashboard. **Q14** keep legacy `backer_tokens` read-only and stop minting.

The owner also chose to close the roster leak (§2.2 point 10) now instead of at retirement. That is
handled outside this build and is not part of any phase here.

---

## 2. What is there today (verified)

### 2.1 The two systems in one table

| | Dashboard (WC) | futurega.me (this repo) |
|---|---|---|
| Store | `console_records(store,id,data,updated_at,deleted)` JSON blobs, last-write-wins sync from each device's IndexedDB (WC:`server/server.js:535`) | relational, per user, sql.js |
| Money | floats in dollars, no user, no currency | whole units (INTEGER) for results, adjustments and cash sessions; REAL to the cent for expenses and income; currency per bankroll |
| Roll | derived: `startingRoll + non-fund results + adjustments (not transfers, not settlements) − transfers` (WC:`app/src/engine/bankroll.ts:221-259`; server copy WC:`server/lib/dashboard.js:142-157`) | ledger: `starting_balance + Σ entries` per bankroll (`lib/bankroll-ledger.js`) |
| Fund | `transfers + fund results + backer settlements`, target **65,000** in the PWA (WC:`bankroll.ts:205`) and **50,000** on the server (WC:`dashboard.js:275`) | none |
| Backers | `{id, token, name, stakes[{format,channel,pct}], delivery{sms,email}, opening}` (WC:`app/src/db/backers.ts:13-35`); share math client-only (`:96-132`) | staking tree: `staking_series`, `backers` (int ids), `backer_agreements` (per series; `series_id NOT NULL`, `server.js:2041`), overrides, event status, settlements, `backer_tokens` |
| `/b/` pages | none; the definitions are pushed through seams 1 and 3 | page, feed, push, SMS, digest (`server.js:553-702`, `:11650-11782`), keyed by the dashboard's tokens |

### 2.2 Facts this spec relies on, including where the maps were incomplete

1. **The Settings JSON backup leaves out the synced blobs.** `exportAll` (WC:`app/src/db/idb.ts:252`)
   walks only the IndexedDB object stores. `wsop-staking`, `wsop-balances` and `wsop-notified-sessions`
   live in localStorage and sync as the `local` pseudo-store (WC:`app/src/db/syncLocal.ts:17-29`).
   A backup file would therefore miss three of the inputs decision 1 names. This decides §8.
2. **Notify is a tap, not automatic.** `BackerNotify` (WC:`app/src/screens/BackersUI.tsx:404-436`)
   shows the cuts and sends them only when the owner presses the button. It records the session id
   in `wsop-notified-sessions`. MCP-logged sessions are never notified (WC:`server/server.js:345-349`).
   So `backer_events` holds exactly the nights the owner chose to send. It is not every matching
   night.
3. **An adjustment's sign is whatever was typed.** The form saves `amount: n` as entered
   (WC:`app/src/screens/BankrollScreen.tsx:383`). The roll adds it regardless of type. The form's
   hint for a withdrawal is "Use a negative amount". A positive "withdrawal" therefore *added* to the
   dashboard's roll. The import follows the sign, not the label (§5.3).
4. **Settled slate deals already moved money.** "Settle" writes one `backer-settlement` adjustment of
   `−round(prize × pctSold)` into the fund. Its note is `"<event>: backers' <pct>% of <prize> → <backer>"`
   (WC:`app/src/screens/AdminView.tsx:251-264`). A deal's `settled` flag carries no money of its own.
5. **`other` expenses are not deducted by this app's tax report.** `PRO_EXPENSE_RULES.other` has
   rate 0 (`vite-app/src/utils/tax-report.js:112-121`). Mapping the dashboard's `equipment` and
   `fees` to `other` would silently drop them from the deduction. §5.4 adds two categories instead.
6. **Dashboard expenses never touched the roll.** `computeBankroll` reads sessions and adjustments
   only. Here, every `bankroll_transactions` row moves its bankroll's balance
   (`lib/ledger-sources/transactions.js`). §5.4 handles the difference.
7. **The settlement sheet has two more defects than the map listed.**
   - `amountOwed = grossReturn − grossInvestment + markupAmount` (`server.js:7548`) hands the markup
     back to the backer. Take 10% of a $1,000 event at 1.2 markup with no cash: the backer should owe
     $120, but the sheet says $100.
   - Settle upserts by `(series_id, backer_id)` (`server.js:7629`). A backer with two agreements in
     one series gets one row, and the last write wins.
8. **A standing agreement cannot live in `backer_agreements`.** Its `series_id` is `NOT NULL`
   (`server.js:2041`), and SQLite cannot drop that constraint without rebuilding the table.
9. **The local pm2 instance runs the backer crons too.** It runs the digest cron
   (`server.js:14042`) and ran the roster pull (`:14049`) on this box. It held a `DASHBOARD_TOKEN`
   (CLAUDE.md, dashboard seams). It is quiet today only because notify writes to prod's
   `backer_events`, so its own copy never gains a new row for the digest to send. Once shares are
   posted wherever a result is saved, deliveries must be gated to prod (§6.7). Since 2026-10-14
   (point 10) the box has no `ROSTER_TOKEN`, so its roster pull is off; the copy it already holds is
   still production-sensitive.
10. **The roster seam WAS a live credential leak path, and is closed ahead of this merge
    (2026-10-14, branch `fix/roster-token` in both repos).** `GET /api/roster/:token` returned every
    backer's token, phone and email under `DASHBOARD_TOKEN`, a secret compiled into the iOS builds
    (`DashboardSecret.swift`, per WC:`lib/dashboard-token.js`) and read by the widget, the screensaver
    and other seams. Anyone who extracted it from an app could pull every backer's credentials.
    - **The fix.** A separate, server-only `ROSTER_TOKEN`, sent as `Authorization: Bearer <token>`
      (never in the URL), compared in constant time, with `ROSTER_TOKEN_PREVIOUS` accepted inbound for
      rotation (WC:`server/lib/roster-token.js`). The route is now `GET /api/roster` (WC:`server/server.js:217-262`).
    - **Closed by default.** `ROSTER_TOKEN` unset, or under 32 characters, answers 404 for everyone.
      `DASHBOARD_TOKEN` no longer unlocks the roster, and the old `/api/roster/:token` route answers 404
      for every token.
    - **Who holds it.** Only the two Render services (the dashboard's and this app's). It is never put
      in an app, the local pm2 `ecosystem.config.cjs`, a repo or a chat. Without it,
      `syncBackerRoster` logs once that it is off and sends nothing, so the Windows box stops mirroring
      backer credentials.
    - **Rollout order.** (1) Generate the secret (the command is in §11.1; it is identical on Mac and
      PC). (2) Set `ROSTER_TOKEN` on both Render services; it does nothing on the old code. (3) Deploy
      the dashboard. The leak closes the moment it is live, and the old scheduler's pull logs
      `HTTP 404` until step 4 while backer pages keep the roster they last synced. (4) Deploy this app;
      its boot pull sends the header, and the log shows `[roster] pull from the dashboard ok`. (5) On the
      Windows box, update the checkout and restart its pm2 app (CLAUDE.md, seam #3, has the
      commands). No `ROSTER_TOKEN` is added to `ecosystem.config.cjs`, so the box logs
      `ROSTER_TOKEN is not set` once and stops.
    - **What remains.** The local DB holds the backer tokens mirrored before the fix. Retiring seam 3
      (Phase 13) removes the route and `syncBackerRoster` altogether: at that point also unset
      `ROSTER_TOKEN` on both Render services. The new `LEDGER_TOKEN` follows the same rule: never in an app.
11. **No prod DB backup exists in this repo's code.** The dashboard's device copies were an informal
    backup. Once futurega.me is the only copy, the owner confirms the Render disk snapshots
    (Phase 0).
12. **Both cookies are host-only.** The scheduler's (`server.js:260-268`, no `domain`) and the dashboard's
    (WC:`server/lib/auth.js:41-45`) do not cross hosts. The dashboard's browser code cannot call
    futurega.me as the owner, so all dashboard-to-futurega.me traffic goes server to server (§11).

---

## 3. Target architecture

```
                         futurega.me (Render)                                dashboard.futurega.me (Render)
  ┌───────────────────────────────────────────────────────┐        ┌──────────────────────────────────────────┐
  │ results: tracking_entries + Personal tournaments,     │        │ Today · Health · Train · Plan            │
  │          cash_sessions, session_extras                │        │ (+ Trends, Review, Settings)             │
  │ bankrolls: Main (virtual), WSOP fund, others          │        │                                          │
  │ ledger: adjustments (+correction, +settlement),       │  GET   │ lib/money-source.js  ── cache 60 s,      │
  │         transactions, transfers                       │◄───────│   last-good persisted in console_flags   │
  │ staking: series tree (fixed) + standing agreements    │ /api/  │ computeDashboardSummary ← money feed     │
  │ backer surface: backers.public_token, backer_events,  │ owner/ │ /api/dashboard/:token/summary (unchanged │
  │   push subs, revisions, delivery sweep (prod only)    │ money  │   contract) → widget, watch, Cockpit     │
  │ owner API: /api/owner/money, /api/owner/sessions/log  │◄───────│ MCP log_session/get_bankroll → forward   │
  │   (Bearer LEDGER_TOKEN, acts as HAM_OWNER_ID)         │  POST  │ Today live-session end → forward         │
  │ seam #2 departures (unchanged)                        │───────►│ departures board                         │
  └───────────────────────────────────────────────────────┘        └──────────────────────────────────────────┘
        ▲ one-time + delta pull (Phase 5, removed in Phase 13): GET WC /api/money-export (Bearer LEDGER_TOKEN)
```

Retired after the soak: seam #1 (notify relay and the `/console/api/backers/*` routes), seam #3
(roster endpoint and `syncBackerRoster`), the dashboard's money stores and screens, and this app's
`console_records` table.

---

## 4. Schema (one migration, `money-merge-2026-10`, in `dataMigrations` after `bankroll-transactions-2026-10`)

Everything is additive. No existing column changes meaning except as §10 says for settlements.

### 4.1 New tables

```sql
-- Standing % agreements (the dashboard's model). One ACTIVE per (player, backer).
CREATE TABLE standing_agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,              -- the player
  backer_id INTEGER NOT NULL,            -- backers.id
  effective_from TEXT NOT NULL,          -- YYYY-MM-DD: results dated before never derive
  effective_to TEXT,                     -- inclusive last day; NULL = open
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'ended'
  opening_cents INTEGER NOT NULL DEFAULT 0, -- signed, + = player owes backer (dashboard `opening`)
  opening_note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (backer_id) REFERENCES backers(id));
CREATE UNIQUE INDEX idx_standing_active ON standing_agreements(user_id, backer_id) WHERE status = 'active';

-- Dated stakes. An edit "from today" closes a row and opens a new one; a "correction" edits in place.
CREATE TABLE standing_stakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agreement_id INTEGER NOT NULL,
  format TEXT NOT NULL,                  -- 'all' | an exact game key from lib/staking/classify.js GAMES (§6.3, Q8: one key per game)
  channel TEXT NOT NULL,                 -- 'any' | 'live' | 'online'
  pct REAL NOT NULL,                     -- 0 < pct <= 100
  valid_from TEXT NOT NULL, valid_to TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agreement_id) REFERENCES standing_agreements(id));

-- Per (backer agreement, result) opt-out: "not staked" / "exclude from backers".
CREATE TABLE standing_exclusions (
  agreement_id INTEGER NOT NULL, ref_table TEXT NOT NULL, ref_id INTEGER NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (agreement_id, ref_table, ref_id));

-- What a result knows beyond money: the dashboard's session fields that have no column here.
CREATE TABLE session_extras (
  user_id INTEGER NOT NULL,
  ref_table TEXT NOT NULL,               -- 'tracking_entries' | 'cash_sessions'
  ref_id INTEGER NOT NULL,
  format TEXT, channel TEXT,             -- explicit classification; NULL = derive (§6.3)
  hours REAL,                            -- tournaments only (cash hours come from started/ended)
  hands INTEGER, mood_rating INTEGER, tilt_note TEXT, journal TEXT,
  tags TEXT,                             -- JSON, tournaments only (cash_sessions has its own)
  origin TEXT, origin_id TEXT,           -- 'dashboard' | 'chat' | 'app', and the source id
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ref_table, ref_id));
CREATE INDEX idx_session_extras_user ON session_extras(user_id);

-- Audit trail for every change to a posted share.
CREATE TABLE backer_event_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL, token TEXT NOT NULL, at INTEGER NOT NULL,
  action TEXT NOT NULL,                  -- 'post' | 'revise' | 'void' | 'recalc' | 'link'
  share_before INTEGER, share_after INTEGER,
  result_before INTEGER, result_after INTEGER,
  pct_before REAL, pct_after REAL,
  cause TEXT,                            -- 'owner-edit' | 'import' | 'recalc' | 'drift' | 'exclude' | 'stake-correction'
  note TEXT);
CREATE INDEX idx_ber_token ON backer_event_revisions(token, at);

-- "Where's the money" (the dashboard's wsop-balances).
CREATE TABLE money_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  name TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
  sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);

-- Owner-level money settings (JSON): { posting: 'off'|'on', cutover: 'none'|'imported'|'live',
--   postingSince, defaultBankroll: 'main'|id, taxSetAsidePct }   (correctionsPush dropped, §1.1 Q2)
CREATE TABLE money_settings (user_id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);

-- Staged pulls. payload holds PII (tokens, phones, emails): cleared 7 days after commit or on discard.
CREATE TABLE money_import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  source TEXT NOT NULL,                  -- 'dashboard'
  fetched_at TEXT NOT NULL, payload TEXT, plan TEXT, decisions TEXT,
  status TEXT NOT NULL,                  -- 'staged' | 'committed' | 'discarded' | 'undone'
  committed_at TEXT, summary TEXT);
```

### 4.2 New columns

| Table | Column | Why |
|---|---|---|
| `backers` | `public_token TEXT` + `CREATE UNIQUE INDEX … WHERE public_token IS NOT NULL` | the `/b/` token, verbatim (§7) |
| `backers` | `notify_sms INTEGER NOT NULL DEFAULT 0`, `notify_email INTEGER NOT NULL DEFAULT 0` | delivery is opt-in; a staking backer whose email is on file is not emailed |
| `backer_events` | `agreement_id INTEGER`, `stake_id INTEGER`, `ref_table TEXT`, `ref_id INTEGER`, `source TEXT NOT NULL DEFAULT 'dashboard'`, `revised_at INTEGER`, `notified_share_cents INTEGER`, `notified_at INTEGER` + index `(ref_table, ref_id)` | link a share to its result; delivery sweep. Existing rows become `source='dashboard'`, and their `notified_*` columns are set to their own share (already delivered) |
| `bankroll_import_keys` | `run_id INTEGER`, `decision TEXT` (`imported` \| `same` \| `skipped`), `source_updated_at INTEGER`, `source_hash TEXT` | delta pulls and undo |
| `bankrolls` | `role TEXT` (`'fund'` or NULL), `in_roll INTEGER NOT NULL DEFAULT 1`, `target_amount INTEGER`, `target_date TEXT` | the fund, and what "the roll" sums |
| `bankroll_adjustments` | `settlement_ref TEXT` (`'bs:<id>'` \| `'sp:<id>'`) | a payout linked to its settlement |
| `bankroll_transactions` | `affects_balance INTEGER NOT NULL DEFAULT 1` | expenses paid from outside the roll (§5.4) |
| `cash_sessions` | `time_known INTEGER NOT NULL DEFAULT 1` | imported and chat-logged sessions have a day and hours but no start time |
| `staking_series` | `bankroll_id INTEGER` (NULL = Main) | where a paid settlement posts (bankrolls.md seam 1) |
| `backer_settlements` | `agreement_id INTEGER`, `computed_owed REAL`, `adjustment REAL NOT NULL DEFAULT 0`, `adjustment_note TEXT`, `prepaid REAL NOT NULL DEFAULT 0`, `makeup_opening REAL`, `makeup_closing REAL`, `settled_at TEXT` | §10 |
| `backer_agreements` | `makeup_opening REAL` | §10 (replaces reading `makeup_balance`) |

### 4.3 Constants that change

- **Ledger money-moved kinds.** `lib/bankroll-ledger.js:53` `MOVE_KINDS` gains `correction` and
  `settlement`. `lib/ledger-sources/adjustments.js` `KIND_LABEL` gains `Correction` and
  `Paid to backers`. Both kinds move balances and never count as profit, which matches the
  dashboard: there, corrections and settlements were never session P&L.
- **Expense categories.** They gain `equipment` and `fees` in three places:
  - the server list, `lib/bankroll-transactions.js:31-34`;
  - the client list, `vite-app/src/utils/transactions.js` (the test checks the two match);
  - the tax rules, `tax-report.js` `PRO_EXPENSE_RULES`, at `rate: 1, line: 'Sch. C'`, plus their
    labels.
- **Rows the ledger and reports skip.**
  - `lib/ledger-sources/transactions.js` skips `affects_balance = 0` rows. The Expenses list and the
    tax report still read them, and the list marks them "Paid outside the roll".
  - `lib/bankroll-reports.js` sets a cash fact's `hour` to null when `time_known = 0`, so the start
    time and daypart reports never see a made-up noon.
- **Account deletion.** `server.js:4054-4059` adds `standing_exclusions` (through the agreements),
  `standing_stakes`, `standing_agreements`, `session_extras`, `money_locations`, `money_settings`
  and `money_import_runs`. `backer_event_revisions` stays with `backer_events`, which are left alone
  on purpose (`server.js:3972-3974`).

---

## 5. Data mapping

### 5.1 Ids, fingerprints and idempotency

Every imported row writes one `bankroll_import_keys` row, `(user_id, fingerprint, ref_table, ref_id,
run_id, decision, source_updated_at, source_hash)`.
`refExists` (`lib/bankroll-import.js:117`) learns `cash_sessions`, `bankroll_transactions`,
`backers`, `standing_agreements`, `backer_agreements` and `money_locations`.

| Source | Fingerprint | ref_table |
|---|---|---|
| a session whose id starts `chat-` | the id **verbatim** (`chat-` + 12 hex, WC:`server/lib/session-log.js:56-59`) | `tracking_entries` \| `cash_sessions` |
| any other session | `dash:sessions:<id>` | same |
| adjustment | `dash:adjustments:<id>` (a transfer points at its `transfer_out` leg; deleting either leg deletes both, `lib/bankrolls.js`) | `bankroll_adjustments` |
| expense | `dash:expenses:<id>` | `bankroll_transactions` |
| backer | `dash:backers:<id>` | `backers` (its agreement via `dash:standing:<id>`) |
| slate deal | `dash:wsop-staking:<id>` | `backer_agreements` |
| balance entry | `dash:wsop-balances:<id>` | `money_locations` |
| opening deposit | `dash:opening` | `bankroll_adjustments` |
| rounding correction | `dash:rounding:<main\|fund>` | `bankroll_adjustments` |
| confirmed duplicate | the source's fingerprint, pointing at the **existing** row, `decision='same'` | the existing row's table |

A second pull finds every fingerprint and imports nothing new. A key whose row was deleted is stale
and imports again, which is the CSV importer's rule.

Because a chat id is kept verbatim, the owner API's `log_session` (§11.3) derives the same
`chat-<sha1>` from the same facts and lands on the same row. A night told to Claude before the
move and told again after it stays one night.

Ids exposed to the dashboard are strings, `te:<id>` and `cs:<id>`, so its `Session.id: string`
type holds.

### 5.2 Sessions

**Cash** (`isMTT` false) → `cash_sessions`, plus `session_extras`.

| Dashboard field | futurega.me | Conversion / rule |
|---|---|---|
| `date` (YYYY-MM-DD) | `session_date`; `started_at` = 12:00 America/New_York that day, as a UTC ISO instant; `time_known = 0` | the day is exact; the time is a placeholder the reports ignore |
| `hours` | `ended_at = started_at + hours` (to the minute) | the ledger's `hours` reads it back to the hundredth |
| `venue` | `room` | trimmed to the column's cap |
| `format` | `game` = the variant label (table below); `session_extras.format` = the dashboard key | exact, never re-guessed |
| `channel` | `session_extras.channel` | exact |
| `stakeLevel`, `gameLabel` | `stakes` = `stakeLevel`, else the stakes token of `gameLabel` through `cleanStakes` (`lib/cash-sessions.js:162`); when `gameLabel` says more than stakes plus format ("40/80 mix"), it goes into `notes` | |
| `buyInTotal` | `buy_in` | rounded to whole dollars; residue to §5.7 |
| `cashOut` | `cash_out` | same |
| `result` | not stored (net = `cash_out − buy_in − tips − expenses`) | checked: if \|`result − (cashOut − buyInTotal)`\| > 0.01, the row goes to the review as an error |
| `isWsopFund` | `bankroll_id` = the fund bankroll, else the import target (Main by default) | |
| `hands`, `moodRating`, `tiltNote`, `journal` | `session_extras` | |
| `tags` | `tags` (JSON, ≤ 10) | |
| `entries`, `place`, `fieldSize` | ignored on a cash row | listed in the review if present |
| — | `rebuys 0, tips 0, expenses 0, currency 'USD', venue_slug NULL` | |

**Tournament** (`isMTT` true) → a Personal `tournaments` row, a `tracking_entries` row and
`session_extras`, following `lib/bankroll-import.js:186-196`.

| Dashboard field | futurega.me | Conversion / rule |
|---|---|---|
| — | `tournaments`: `venue 'Personal'`, `stable_id PERSONAL-<uid>-dash-<first 12 hex of sha1(session id)>`, `source_pdf 'dashboard-import'`, `uploaded_by uid`, `time ''`, `event_number ''` | deterministic, so undo and re-import are exact; not added to `user_schedules` (as the CSV importer does) |
| `date` | `tournaments.date` (YYYY-MM-DD) | |
| `gameLabel` | `event_name` (≤ 120; empty becomes "`<variant>` tournament") | |
| `format` | `game_variant` = variant label; `session_extras.format` | |
| `channel` | `is_online` (online = 1); `session_extras.channel` | |
| `venue` | `property` (and `site` too when online) | so Reports and Locations group by the real room, never "Personal" |
| `buyInTotal`, `entries` | `tournaments.buyin` = `buyInTotal / entries` when that is whole dollars, else rounded with the residue to §5.7; `num_entries` = `entries` (default 1) | net = cash − buyin × entries, the ledger's formula |
| `cashOut` | `cash_amount = round(cashOut)`, `cashed = cashOut > 0` | |
| `place` / `fieldSize` | `finish_place` / `tournaments.total_entries` | |
| `hours`, `hands`, `moodRating`, `tiltNote`, `journal`, `tags` | `session_extras` | `tracking_entries` has no hours column, and the backer feed reads hours from here |
| `isWsopFund` | `tracking_entries.bankroll_id` | |
| — | `tracking_entries.notes = 'Imported from the dashboard'` | |

Variant labels (this app's naming, CLAUDE.md conventions):

| Dashboard key | Label | Dashboard key | Label |
|---|---|---|---|
| `PLO` | `PLO` | `stud8` | `Stud 8` |
| `PLO8` | `PLO8` | `razz` | `Razz` |
| `NLH` | `NLH` | `2-7` | `2-7` |
| `mixed` | `Mixed` | `BigO` | `Big O` |
| `other` | `Other` | | |

**Why fund sessions are results filed in the fund and not transfers.** In the dashboard a fund
night's result goes straight into the fund (WC:`bankroll.ts:248`). Filing the result under the fund
bankroll reproduces that balance exactly and keeps it a result. Modelling it as a transfer would give
the same balances but take the night out of profit, ROI, the Reports and the tax report, and a
fund night is still a night played.

### 5.3 Adjustments → `bankroll_adjustments`

| Dashboard row | Lands as | Bankroll |
|---|---|---|
| any type except the three below, `amount > 0` | `deposit`, `+round(amount)` | Main |
| any type except the three below, `amount < 0` | `withdrawal`, `−round(\|amount\|)` | Main |
| `correction` | `correction`, signed (new kind, money moved) | Main |
| `wsop-fund-transfer`, `amount > 0` | `transfer_out −a` in Main + `transfer_in +a` in the fund, `transfer_id 'dash:<id>'` | both |
| `wsop-fund-transfer`, `amount < 0` | `transfer_out −\|a\|` in the fund + `transfer_in +\|a\|` in Main | both |
| `backer-settlement` | `settlement`, signed (new kind, money moved), `settlement_ref` set when §5.6 links it to a slate deal | fund |
| `amount == 0` | skipped, listed | — |

- `date` becomes `occurred_on`.
- The note becomes `"<dashboard type> · <note>"`, so the original label survives.
- A row whose sign disagrees with its label (§2.2 point 3) imports as it **counted**. It is flagged
  in the review: "A withdrawal of +$500 — the dashboard added this to the roll."

### 5.4 Expenses → `bankroll_transactions`

The import writes `kind 'expense'`, `amount` REAL rounded to the cent, `currency 'USD'`,
`occurred_on = date`, `note`, `bankroll_id` Main and `affects_balance = 0` (§17 Q6).

| Dashboard category | Category here | Tax treatment here |
|---|---|---|
| `travel` | `travel` | 100% |
| `lodging` | `lodging` | 100% |
| `meals` | `food` | 50% (`tax-report.js:115`) |
| `coaching` | `coaching` | 100% |
| `equipment` | `equipment` (new) | 100% |
| `fees` | `fees` (new) | 100% |
| `other` | `other` | **not deducted** (rate 0); the review lists these with their total so the owner can recategorise |

### 5.5 Settings

- **`startingRoll`** becomes the computed opening deposit (§5.8). It is not stored as a starting
  balance, because Main is virtual and has none (`docs/bankrolls.md:27-29`).
- **The other `Settings` fields** (wake time, cut-offs, phase override, and so on) are not money.
  They stay on the dashboard.

### 5.6 The synced blobs

| Key | Shape | Lands as |
|---|---|---|
| `wsop-balances` | `{ entries: [{id,name,amount}], updatedAt }` (WC:`BankrollScreen.tsx:438-447`) | `money_locations` rows; the "Where's the money" block (Phase 10) |
| `wsop-staking` | `StakeDeal[] {id,event,buyIn,pctSold,markup,backer?,settled?}` (WC:`AdminView.tsx:33-41`) | one `staking_series` per distinct event (named after it, USD, status `settled` when all its deals are), one `backers` row per distinct backer name (matched to the roster backers by name in the review, else staking-only with no token), one `backer_agreements` row `pay_per_play`, `percentage = pctSold`, `markup`, notes `"Slate buy-in $X (imported)"`. A **settled** deal also gets a `backer_settlements` row (`is_paid 1`) linked to the imported `settlement` adjustment whose note starts `"<event>:"`. Unmatched ones stay unlinked and are listed. Linking a deal to a real tournament is left to the owner in the Staking tab |
| `wsop-notified-sessions` | `string[]` of session ids | **not stored.** Cross-checked against `backer_events` (§9.2); the events are the record |
| `wsop-admin-taxrate` | number (default 30) | `money_settings.taxSetAsidePct` |
| `wsop-session-presets`, `wsop-admin-checklist`, the home lists, `wsop-intention`, `wsop-nut-shop` | | not money; not imported |

### 5.7 Units and rounding

- The dashboard is USD floats. Results, adjustments and cash sessions here are whole dollars.
- **Per row:** each money field is rounded to whole dollars.
- **Per bankroll:** the import sums `Σ (dashboard effect − rounded effect)` over the results,
  adjustments and transfer legs it imports. A residue of $0.50 or more becomes one
  `correction` of `round(residue)`, fingerprint `dash:rounding:<main|fund>`. Its note gives the
  count and exact total.
- **What is left:** under $0.50 per bankroll, shown in the review.
- **Expenses** keep their cents (REAL).
- **Backer amounts** are already integer cents in `backer_events`. `opening` becomes
  `Math.round(opening × 100)`, as the feed does today (`server.js:590`).

### 5.8 Which bankroll, the fund and the opening balance

- **The fund.** The import creates a **WSOP fund** bankroll: USD, `starting_balance 0`,
  `role 'fund'`, `in_roll 0`, `target_amount` = §17 Q5 (default 65,000), `target_date '2027-05-03'`
  (WC:`dashboard.js:31`). There is one per user (`role 'fund'`, enforced in code). The owner can
  rename it.
- **The import target.** Playing-roll rows land in Main unless the review picks another bankroll.
- **The roll** is the sum of every non-archived bankroll with `in_roll = 1`, converted to USD
  (§17 Q4). Main is always in. This is the dashboard's meaning, "all money not in the fund".
- **The opening deposit** is one computed `deposit` (or `withdrawal`) in Main, dated on the
  earliest dashboard session or adjustment:
  `opening = startingRoll − Σ over roll bankrolls of their balance strictly before that date`.
  That balance counts their starting balances, earlier deposits and earlier results.
  - The effect is that the roll at the start of the dashboard's first day equals its starting roll exactly.
  - Any opening the owner had already recorded here is absorbed, not doubled.
  - Results logged here before that day are not counted twice, because the starting roll already
    included them.
  - The review shows the figure and its parts, and the owner can override amount and date.
- **The reconciliation** is shown before commit and checked after it.
  - It shows the dashboard roll (a port of `computeBankroll` run on the payload), this app's roll
    before the import and its roll after.
  - The difference after is explained line by line: the results logged only here after the opening
    date (listed), plus the rounding remainder.
  - The fund must match to within its rounding remainder (under $0.50).

---

## 6. Standing-% agreements

### 6.1 Model

- **Ownership.** A standing agreement belongs to the player (`user_id`) and one backer (`backers.id`).
- **Scope.** It is not tied to a staking series, so a share applies to every result of that player
  dated in `[effective_from, effective_to]` that matches a stake.
- **Stakes** are `(format | 'all', channel | 'any', pct)` rows with validity dates.
- **Running total.** `opening_cents` seeds the backer's running total exactly as `opening` did.
- **One active agreement per backer.** Ending one and starting another carries the running total
  through the token. The page sums every share for the token plus every agreement's opening, and a
  new agreement starts at opening 0 unless the owner says otherwise.

### 6.2 How it attaches to the backer and series model

- **Backer.** It hangs off `backers` (the same rows the series agreements use). A person can hold
  series agreements and a standing agreement at once.
- **Token.** The `/b/` page is per backer, keyed by `backers.public_token`, and shows standing
  shares only (§17 Q7 covers the overlap). Series agreements keep their settlement sheet.
- **Overlap rule (owner Q7, §1.1: ask each time).** When the same backer has a standing stake that
  matches a tournament result **and** a `backer_event_status` row for that tournament under an
  active agreement of any series, the engine returns **both** and flags the standing cut `ask`. It
  does not choose. The owner decides on the Notify sheet. *(Superseded: the original default
  excluded the standing share and let the series agreement win.)* Cash sessions are never in a
  series, so they never ask.
- **Routes.** All live under the existing `/api/staking` admin gate (`server.js:479`):
  `/api/staking/standing/*` (§6.10).

### 6.3 Classifying a result: `lib/staking/classify.js`

- **One key per game (owner Q8, §1.1).** A stake names a game and a channel, and a result's `format`
  is the exact game. A stake matches **only that game, or `all`**. The families the first draft of
  this section built (5- and 6-card PLO as PLO, PLO hi-lo of any size as PLO8, HORSE and the
  N-game mixes as Mixed) are gone. Different spellings of the **same** game still share a key
  ("NL" and "No-Limit Hold'em"; "Big O" and "5-card PLO8"). A result's `format` and `channel` come
  from, in order:
  1. `session_extras.format` / `.channel` (imported, chat-logged, or set by the owner). Only a valid
     key counts; anything else is ignored;
  2. derivation.
- **Deriving a tournament.**
  - channel = `tournaments.is_online`;
  - format = `formatOf(game_variant)`.
- **Deriving a cash session.**
  - channel = `ONLINE_ROOM.test(room)`. `ONLINE_ROOM` moved from `lib/bankroll-reports.js` into
    this module (the reports re-export it) and gained `bet ?rivers`, `borgata online` and
    `phenom`. "The online venues the import finds" join it when the import is built (Phase 5);
  - format = `formatOf(game)`.
- **`formatOf`.** A pure, **ordered** table: the first row that hits wins. Patterns are
  case-insensitive whole tokens (a letter or digit glued to a pattern is not a hit), after
  straightening quotes and dashes and closing up `H.O.R.S.E.`. The order matters and is tested row
  by row. The rows below are in evaluation order. The dashboard's nine keys are `PLO`, `PLO8`,
  `NLH`, `mixed`, `stud8`, `razz`, `2-7`, `BigO` and `other`; they keep their meaning for imported
  stakes. The other keys are games the dashboard folded into those.

| Key | Game | Patterns (any one) |
|---|---|---|
| `plo-nlh` | PLO/NLH mix | `plo/nlh`, `nlh/plo` (also `&`, `+`) |
| `HORSE` | HORSE | `horse` |
| `8-game` · `9-game` · `10-game` | N-game mixes | `8-game` (also `8 game`, `8 games`) and likewise 9 and 10 |
| `dealers-choice` | Dealer's choice | `dealer's choice`, `dealers choice` |
| `mixed` | a mix this table does not name | `mix`, `mixed`, `rotation`, any other `N-game` |
| `BigO` | Big O | `big o`, `5-card plo8`, `5 card plo hi-lo`, `plo5 8`, `plo5 hi-lo` |
| `PLO6_8` | 6-card PLO hi-lo | `plo6 8/b`, `plo6 hi-lo`, `6-card plo8`, `6 card plo hi-lo` |
| `PLO8` | 4-card PLO hi-lo | `plo8`, `plo 8`, `o8`, `plo hi-lo`, `plo 8/b`, `plo h/l`, `omaha hi-lo`, `omaha 8` |
| `PLO5` | 5-card PLO | `plo5`, `5-card plo`, `5-card pot-limit omaha` |
| `PLO6` | 6-card PLO | `plo6`, `6-card plo` |
| `PLO` | 4-card PLO | `plo`, `plo4`, `4-card plo`, `pot-limit omaha`, `omaha` |
| `stud8` | Stud hi-lo | `stud 8`, `stud8`, `stud hi-lo`, `seven card stud hi-lo` |
| `razz` | Razz | `razz` (also `2-7 razz`) |
| `2-7sd` | 2-7 single draw | `single draw`, `2-7 single draw`, `2-7 sd`, `nl 2-7` |
| `2-7` | 2-7 triple draw | `2-7`, `2-7 td`, `deuce`, `triple draw` |
| `NLH` | No-limit hold'em | `nlh`, `nlhe`, `nl`, `no-limit hold'em`, `holdem` (not limit or pot-limit hold'em) |
| `other` | anything else, or empty | |

  Why the order is what it is:
  - **The mixes lead.** "PLO/NLH Mix", "Mixed PLO" and "Mixed Triple Draw" are mixes, not PLO, NLH
    or 2-7. (The first draft listed Mixed last, which made its own `plo/nlh` pattern unreachable:
    `plo` always hit first.)
  - **Big O, then the 6-card hi-lo game, then PLO8, then the sized PLO games, then PLO.** "PLO8"
    contains "PLO", and `5-card plo8` contains both.
  - **A bare `8` is the hi-lo marker only when it is not the front of a stake.** "PLO 8/16" and
    "PLO6 8/16" are PLO and PLO6.
  - **The 2-7 games come before NLH.** "NL 2-7 Single Draw" carries the token `nl`.
  - **Limit and pot-limit hold'em, LHE, Badugi, 7-card stud and TORSE are `other`.** They are not
    in the table. A backer with an `all` stake is still staked in them.
  - `o8` is `PLO8`, as in the first draft, although Omaha 8 is a limit game.

- **Override.** A result sheet shows the classification and lets the owner override it, which
  writes `session_extras`.

### 6.4 Share math: `lib/staking/standing.js`

This is a port of WC:`app/src/db/backers.ts:96-132` with the same behaviour.
- **`matchPct(stakes, {date, format, channel})`.** It considers the stakes in force on the result's
  date. A stake's `valid_from` and `valid_to` are **both inclusive**, like
  `standing_agreements.effective_to`, so an edit "from today" closes the old row the day before. A
  stake with a window needs a dated result; an undated result cannot be placed on the calendar, so
  a windowed stake is not in force for it. Exact format scores 2 and exact channel scores 1
  (`all` and `any` score 0). The highest score wins. A tie goes to the larger pct. No match
  returns null. A stake matches only its exact game (§1.1 Q8). `matchStake` returns the winning
  stake itself, whose id a posted share records.
- **`backerShare`** and **`cutsForSession`** port the dashboard's functions, sorted by |share|
  descending.
- **Money in integer cents.** `result_cents` is the result's net in USD cents. For a tournament the
  net is `cash − buyin × max(1, entries)`, the ledger's formula. For a cash session it is
  `cash_out − buy_in − tips − expenses` (§17 Q12). A non-USD result is converted at the ledger's
  rates when posted.
- **Rounding.** `share_cents = sign(r) × round_half_up(|r| × pct / 100)`, so a loss rounds to the
  same magnitude as the equal win. The dashboard's float `Math.round(result × pct / 100 × 100)`
  rounds −0.5 toward zero instead. The port documents the difference, and a parity test shows it
  never moves more than one cent.
- **What else the 14 cases need.** Six of the 14 cases test `matchPct`, three `backerShare`, one
  `cutsForSession`; the other four test `sessionGameLabel`, `deliveryChannels` and `newToken`. So
  those three are ported too (`deliveryChannels` reads this app's `notify_sms`/`notify_email` flags
  and needs the address as well; `newToken` draws by rejection sampling so no character is
  likelier than another).
- **`resultCuts({agreements, result, exclusions, seriesBackerIds})`** is the decision list of §6.5
  as a pure function: it skips an ended agreement, a result outside the window, a live cash
  session, an excluded pair and a game the backer is not staked in, and returns the rest as cuts,
  with `ask: true` on a standing cut whose backer also holds a series agreement on that tournament
  (§1.1 Q7). It posts nothing. Three SELECT-only readers feed it: `loadAgreements`,
  `loadExclusions` and `seriesBackerIds`.
- **Tests.** Every case of WC:`app/src/db/backers.test.ts` (14) is ported to
  `test/standing.test.js` and run under `node --test`. To those go:
  - stake validity windows;
  - the overlap rule (Q7: both returned, flagged);
  - exclusions;
  - classification (`test/classify.test.js`, every row of the §6.3 table);
  - the rounding parity sweep: 10,000 random result × pct pairs against the dashboard formula,
    \|Δ\| ≤ 1 cent.

### 6.5 When a share is posted

> **Superseded by §1.1 Q1.** Shares are **not** posted on save. The owner taps Notify for a result
> and the engine below runs for that one result. Read "every write to an owner result runs
> `syncSharesFor`" as: every write to a result that **already has** a posted event re-derives or
> voids that event; nothing creates one except the Notify action. The decision list, the "what never
> posts" rules and the preview are unchanged. Per Q7 the overlap rule below is "ask", not "exclude".

- **When posting is on** (`money_settings.posting = 'on'`), every write to an owner result runs
  `syncSharesFor(db, userId, {table, id})` after its commit. "Owner result" means a
  `tracking_entries` or ended `cash_sessions` row, or a Personal tournament under them. For each
  active standing agreement of that player:
  - If the result's date is in the agreement window, the result is not excluded, the owner has not
    chosen "series wins" on an overlap (Q7) and `matchPct` returns a pct, it ensures a
    `backer_events` row:
    - `id = '<token>:<te|cs>:<id>'`, `session_id = 'te:<id>' | 'cs:<id>'`;
    - `source = 'ledger'`, plus the agreement id, the stake id and the ref;
    - date, game label, room, hours, `session_result_cents`, `pct`, `share_cents`;
    - `ts = now` on first post.
  - Otherwise it ensures no ledger event exists for that pair, and voids one if there is.
- **What never posts.**
  - A live cash session never posts.
  - The import's commit never calls `syncSharesFor`, and imported rows are dated before
    `effective_from`, so a later edit of one does not post either.
  - A result that already carries a `source='dashboard'` event for a backer is skipped for that
    backer. The dashboard's event is the record until the owner presses **Recalculate** (§6.6). This
    covers a night played on the cutover day itself, notified from the dashboard before the freeze
    and imported in the delta.
- **Write paths** that call it, verified:
  - `server.js` `POST /api/tracking` (`:6066`), `PUT` (`:6115`), `DELETE` one (`:6140`) and the bulk
    `DELETE` (`:6164`);
  - the Personal-event edit and delete (`:4660-4705`, a buy-in change moves the net);
  - `lib/cash-sessions.js` log (`:440`), end (`:547`), edit (`:610`) and delete (`:653-665`);
  - the CSV import commit (`lib/bankroll-import.js:190`);
  - the owner API (§11.3);
  - the money import's undo.
  - Account deletion does not call it, because the backer tables are left alone on purpose.
- **Preview.** Before save, the result form for admins shows a line "Posts to backers: +$248 (20%),
  +$124 (10%)" from `GET /api/staking/standing/preview` with the unsaved values. The owner sees the
  cut before it goes out, which is what the dashboard's tap gave him.
- **Feed edits are not owner writes.** A feed re-ingest that changes a feed tournament's buy-in does
  not re-derive. The drift report (§6.6) lists the difference.

### 6.6 Editing a past result (the decision)

**The share follows the result. The pct in force on the result's date is used.**

> **Superseded in one respect by §1.1 Q2: the backer is told nothing.** Wherever this section says
> "push", read "nothing": no push, no SMS, no "corrected" mark. The page shows the new figure. The
> revision row is still written.

| Case | What happens |
|---|---|
| amounts, date, room or bankroll edited | re-derived: new `session_result_cents` and `share_cents`; `revised_at`; a `revise` revision row with before and after; push "Corrected" (§6.7) |
| format or channel corrected | re-matched against the stakes in force on the date, so the pct can change; revision as above |
| result deleted | event deleted (`void` revision kept); push "Removed" |
| result excluded for a backer | event deleted (`void`, cause `exclude`) |
| a stake changed "from today" | old row closed, new row opened; no past share changes |
| a stake **corrected** (typo) | edited in place. The UI first lists every share it changes ("12 results, −$40 in total for this backer") and needs a confirm; then all are re-derived (cause `stake-correction`) |
| an imported `source='dashboard'` event | **never re-derived automatically.** The result sheet says "Posted before the merge: +$248, not recalculated", with a **Recalculate** action that turns it into a ledger event at its own recorded pct (cause `recalc`). The owner can also **Remove** it |

**Why not freeze the share, as the dashboard did.**
- *The dashboard's freeze was not a policy. It was the absence of one.* The only correction path
  was un-notify, and that UI has been dead since the cutover: `fetchBackerEvents` hits a route the
  dashboard never proxied, gets the SPA's HTML and shows "No shares recorded" (dashboard map, §8a).
  Re-sending after an edit is `INSERT OR IGNORE` (`server.js:754`), so a corrected night kept its
  wrong share.
- *A backer's running total is money owed.* A typo in a result should not become a permanent debt
  error. A share that follows the result keeps the page equal to "pct × what actually happened".
- *Agreement changes still never rewrite history.* The stakes are dated, so the pct for a night is
  the one in force on that night. That is what the freeze protected, and dated stakes keep it.
- *Every change is visible and recorded.* There is a revision row, a push, and a "corrected" mark
  on the page. That is the trust the freeze was standing in for.
- *History posted by the dashboard stays exactly as the backer saw it,* unless the owner acts on it.

**Drift report.** `GET /api/staking/standing/drift` lists ledger events whose stored share differs
from a fresh derivation. A feed buy-in change is the usual cause. Each line has an "Apply" action
(cause `drift`). Nothing is applied automatically.

### 6.7 Delivery (push, SMS, digest)

> **Superseded by §1.1 Q1 and Q2.** A share is created by the owner's Notify tap, so the "first
> post" delivery happens when that tap creates the event (the sweep, or the tap itself, may send
> it). **A correction sends nothing**: drop the "Correction" bullet, the "corrected" mark in the
> digest and the page, and `revised: true` in the feed. A void ("Removed") is also silent: the
> event simply leaves the page. Everything else here (prod only, SMS opt-in, digest recipients,
> name precedence) stands.

- **Prod only.** Delivery runs only where `BACKER_DELIVERY` is on: the default is on when `RENDER`
  is set, and an explicit `BACKER_DELIVERY=0|1` overrides it. This keeps the local pm2 instance
  silent (§2.2 point 9).
- **A sweep, not inline.** Every minute, the sweep delivers each event where
  `notified_share_cents IS NOT share_cents` and the last change is at least 2 minutes old. The delay
  coalesces an edit storm into one push, and the sweep survives restarts. It then sets
  `notified_share_cents` and `notified_at`. **Trap for Phase 2:** the live notify relay
  (`server.js:754`) inserts `backer_events` rows without `notified_*`. They take `source='dashboard'`
  from the column default, so a sweep that tests only `notified_share_cents IS NOT share_cents`
  would deliver every relayed share a second time. The sweep must skip `source='dashboard'`, or the
  relay must set `notified_*` when it inserts. (The migration marks the rows that exist today; it
  cannot mark rows inserted after it.) *Built both ways in Phase 2, and the sweep's own test is
  `notified_at IS NULL`, not the `notified_share_cents` comparison, because that one would re-deliver
  every correction (§1.1 Q2). See "Phase 2: as built", difference 2.*
- **First post:** the existing title and body (`server.js:774-777`), plus SMS when
  `backers.notify_sms` (`sendBackerSms`, `:11708`).
- ~~**Correction:** title "Corrected: `<game>` `<date>`" and body "Your 20% is now +$X (was +$Y).
  Running: +$Z." Push only, no SMS (§17 Q2). A void sends "Removed: …".~~ *(Dropped, §1.1 Q2.)*
- **Weekly digest** (`sendBackerWeeklyDigests`, `:11738`):
  - recipients come from `backers.notify_email` and `public_token`;
  - the running total is `Σ share_cents + Σ opening_cents`;
  - ~~rows with `revised_at` in the week are marked "corrected".~~ *(Dropped, §1.1 Q2.)*
- **Feed** (`/api/backer/:token/feed`, `:575`):
  - the shape is unchanged;
  - `name` comes from `backers.name` first and `backer_public` second, which fixes the rename that
    the last notify could shadow (`:580-588`);
  - `stakes` is the summary of the stakes in force today;
  - `openingCents` is `Σ opening_cents`;
  - ~~each event gains an optional `revised: true`.~~ *(Dropped, §1.1 Q2.)*

### 6.8 Existing `backer_events`

- **Kept untouched.** Every row keeps its id, token, session id, figures and `ts`.
- **What the import adds** (all additive):
  - `source='dashboard'`;
  - `notified_share_cents = share_cents`;
  - when its `session_id` is an imported dashboard session, `ref_table`/`ref_id` pointing at the
    imported result (a `link` revision row).
- **The page** reads the same table, so before and after are byte-identical. The parity route
  (§7.6) proves it per token before the switch.

### 6.9 Overlap and double-posting safeguards

- **Duplicate events.** `UNIQUE(token, session_id)` holds. Ledger events use `te:`/`cs:` ids and
  dashboard events use dashboard ids, so the two cannot collide, and they cannot both exist for one
  night unless both apps post it. The cutover (§13) makes sure only one app posts at a time.
- **One active agreement per backer:** a partial unique index.
- **`syncSharesFor`** is idempotent: the same result in, the same event out.

### 6.10 Routes (`/api/staking/standing`, admin gate, scoped to `req.user.id`)

| Method | Path | Body / result |
|---|---|---|
| GET | `/` | the player's standing agreements with backer, stakes in force, opening, running total, delivery flags, masked token |
| GET | `/backers` | **built ahead of Phase 8, read-only**: the owner's roster as each backer's page shows it (see "Backers view" below) |
| POST | `/` | `{ backerId \| newBacker{name,email,phone}, effectiveFrom, openingCents, stakes:[{format,channel,pct}] }` (a new link is minted with the dashboard's `newToken` shape: 8 base62, crypto random) |
| PUT | `/:id` | `{ effectiveTo?, status?, openingCents?, openingNote? }` |
| POST | `/:id/stakes` | `{ stakes:[…], mode:'from-today' \| 'correct', confirm? }`: `correct` without `confirm` returns the affected-share preview |
| PUT | `/backers/:backerId/delivery` | `{ sms?: phone\|null, email?: address\|null }` sets `notify_*` |
| POST | `/backers/:backerId/rotate-link` | §7.5 |
| GET | `/:id/events` | the recorded shares with ref, source and revisions; `?source=` (`dashboard` or `ledger`) and `?since=YYYY-MM-DD` filters (replaces the dead dashboard list) |
| POST | `/exclusions` | `{ agreementId \| 'all', ref: 'te:12' }`; DELETE to undo |
| POST | `/events/:eventId/recalc` · DELETE `/events/:eventId` | §6.6 |
| GET | `/preview?…` | cuts for an unsaved result |
| GET | `/drift` · POST `/drift/:eventId/apply` | §6.6 |

---

## 7. Roster, tokens and the two `backers`

### 7.1 Which backers are imported (the union)

1. **The dashboard's live roster:** `store='backers'`, `deleted=0` in the pull.
2. **This app's own `console_records` `store='backers'`.** It can hold backers deleted in the
   dashboard, because roster deletes never propagate (scheduler map, §7 item 1). Their pages work today.
3. **Tokens that have `backer_events` or `backer_public` rows but no record anywhere.** These get a
   `backers` row (name from `backer_public`) with an **ended** agreement and opening 0. Opening 0 is
   what their page shows today.

Sources 2 and 3 import as **ended** agreements by default (§17 Q9). The page keeps its history and
gets nothing new.

### 7.2 Tokens move verbatim

- **Verbatim.** `backers.public_token` = the dashboard token, character for character. That covers
  the 8-char base62 tokens and the legacy 32-hex ones. `BACKER_TOKEN_RE` (`server.js:553`) already
  accepts both.
- **Untouched tables.** `backer_public`, `backer_events` and `backer_push_subs` are not re-keyed.
  Push subscriptions keep working with no action from any backer.
- **Never rotated during the merge.** One exposed token is deliberately not rotated (owner,
  2026-09-14, `docs/session-handoff.md`); a rotation needs the owner again.

### 7.3 The two token systems

- **`backers.public_token` is the one token**, the `/b/` link.
- **The legacy per-agreement 32-hex `backer_tokens`** (`server.js:2114`) has no client caller.
  `StakingView.jsx` and `App.jsx` only use `/b/`. Phase 2 makes the migration log
  `SELECT COUNT(*) FROM backer_tokens` (a count, never the rows).
  - **Zero (expected):** Phase 13 removes `POST /api/staking/agreements/:id/token` (`:7707`),
    `GET /api/backer/:token` (`:7745`, which also returns proof images) and `/backer/:token`
    (`:8321`). The empty table is left in place.
  - **Not zero:** minting returns 410, the read route stays, and the owner is asked (§17 Q14).

### 7.4 The `backers` name collision

- **The two meanings.** "backers" is both the SQL staking table and the `console_records` JSON
  store `store='backers'`.
- **After the import, the SQL table is the only roster.** The JSON store is read only as a fallback
  for tokens with no `public_token` match, from Phase 2 until Phase 13.
- **Retirement.** `syncBackerRoster` stops writing the store at cutover. Phase 13 deletes the
  fallback code and drops this app's `console_records` table after logging its row counts by store.
  The pre-cutover `sessions`/`adjustments` rows the map suspected are in there are **never
  imported**, because they are stale copies. Money comes only from the pull.

### 7.5 Rotation ("New link") moves here

- **The route.** `POST /api/staking/standing/backers/:id/rotate-link` mints a new token and calls
  `rotateBackerToken(old, new)` (`server.js:11441`).
- **What the rotation re-keys, in one transaction:**
  - `backers.public_token`;
  - `backer_event_revisions.token`;
  - the three tables it already re-keys.
- **The in-use check.** `inUse` also checks `backers.public_token`.
- **Effect.** The old link stops at once, which fixes the hour-long gap the dashboard's "New link"
  had (scheduler map, §7 item 3).
- **Tests.** `scripts/test-backer-rotation.mjs` becomes `test/backer-rotation.test.js` and imports
  the real function. Its header admits it currently mirrors the SQL.

### 7.6 Parity route (Phase 2), used before every switch

`GET /api/staking/standing/parity` (owner only; **built in Phase 2**, with more in the answer than
this lists, see "Phase 2: as built" difference 7):
- For every token, it computes the feed both ways: the current `console_records` path and the SQL
  path.
- It returns `{ tokens: n, identical: n, differ: [{ backerId, fields: ['openingCents', …] }] }`.
- No token ever leaves the server.

### 7.7 Ending and deleting

- **End** sets `effective_to` and `status 'ended'`. The page stays with its history, and no new
  shares or digests go out.
- **Revoke link** rotates to a token nobody is given.
- **Hard delete** of a backer with events is refused (409).

---

## 8. Import source: a server-to-server pull (chosen)

**The choice.** The scheduler pulls once, and again at cutover, from a token-gated endpoint on the
dashboard. The owner does not export a file.

**Why.**
1. **Complete.** The server's `console_records` holds every store, the `local` blobs and the
   tombstones. The Settings backup leaves out three of the decision's inputs (§2.2 point 1) and
   would need a new exporter anyway.
2. **Current.** It is the merged state of every device. A file is one device's IndexedDB, which can
   be behind its own last sync.
3. **Repeatable.** The cutover needs a **delta** pull at freeze time (§13). That is one tap, rather
   than an export, a download and an upload on a phone.
4. **Private.** Backer tokens, phones and emails never land in a Downloads folder, iCloud or a chat
   attachment.

**The cost.** One small read-only endpoint on the dashboard (removed in Phase 13), and one new
secret set on both Render services.

### 8.1 Dashboard endpoint (Phase 4, WC)

> **Built.** The exact request and response, and the five places the build differs from the text
> below (the extra fields, `settings` cut to `startingRoll`, absent blobs omitted, the closed
> conditions, the delta's margin), are in "Phase 4: as built". Where the two disagree, that section wins.

`GET /api/money-export`, with `Authorization: Bearer <LEDGER_TOKEN>`. The token goes in a header and
never in the path, so it is not written to access logs.
- **Auth.** Constant-time check through a generalised `checkSharedToken(token, 'LEDGER_TOKEN')`
  (WC:`lib/dashboard-token.js`'s logic, with `_PREVIOUS` accepted). 404 on mismatch or when unset.
- **Before the ham gate.** It is mounted before the `/console` ham gate, like the other seams.
- **Response** (`Cache-Control: no-store`):

```json
{ "app": "wsop-console", "version": 1, "exportedAt": "2026-10-20T15:00:00.000Z",
  "records": [ { "store": "sessions", "id": "…", "data": "{…}", "updatedAt": 1760000000000, "deleted": false } ],
  "local":   { "wsop-staking": { "value": [], "updatedAt": 0 }, "wsop-balances": { "value": {}, "updatedAt": 0 },
               "wsop-notified-sessions": { "value": [], "updatedAt": 0 }, "wsop-admin-taxrate": { "value": 30, "updatedAt": 0 } },
  "counts": { "sessions": 0, "adjustments": 0, "expenses": 0, "backers": 0, "settings": 1 } }
```

- **Which records.** `records` covers stores `sessions`, `adjustments`, `expenses`, `backers` and
  `settings` with **deleted rows included**, so a delta can see a deletion.
- **The blobs.** `local` is read from `store='local'` (the shape `SYNCED_LOCAL_KEYS` writes).
- **Logging.** Every call logs `[money-export] served N records` with counts, never contents.

### 8.2 Scheduler routes (Phase 5)

All live under `/api/bankrolls/import/dashboard`. The admin gate applies, and `req.user.id` must
equal `HAM_OWNER_ID`, so no other admin can pull the owner's data into their account.

| Method | Path | |
|---|---|---|
| POST | `/fetch` | pulls into a new `money_import_runs` row (`staged`) and returns `{ runId }` + the plan |
| GET | `/:runId` | the plan: mapped rows, pairs, backers, divergences, reconciliation, errors |
| PUT | `/:runId/decisions` | `{ pairs: {pairId: 'same-keep'\|'same-take'\|'different'}, backers: {dashId: 'new'\|<backerId>}, slate: {...}, opening: {amount, date}, target: 'main'\|id }` |
| POST | `/:runId/commit` | 409 while any pair is unanswered; one transaction; returns the summary and the post-commit reconciliation |
| POST | `/:runId/undo` | `{ expect: n }` (the count the typed confirmation showed; 409 on mismatch); deletes every row this run created (fingerprints with this `run_id` and `decision='imported'`: both transfer legs, the Personal tournaments, extras, agreements, stakes, backers it created, locations), clears the `ref_*` it set on `backer_events`, and leaves `decision='same'` targets alone |
| DELETE | `/:runId` | discard a staged run |

The fetch uses `DASHBOARD_BASE_URL` (default `https://dashboard.futurega.me`, `server.js:11422`), a
15 s timeout and the outbound current `LEDGER_TOKEN`. A non-JSON answer is an error, never an empty
success (the 2026-09-11 lesson).

---

## 9. The duplicate review

### 9.1 Finding candidates

**Scope.** Each dashboard row is compared with **every** owner row here, in any bankroll, that is
not already linked by a fingerprint. Each row ends in at most one pair: the best candidates are
taken first, one to one.

**Room match.** `roomKey(s)`:
1. Lowercase the name and strip punctuation and the words `casino`, `poker room`, `resort`,
   `hotel`, `& spa` and `the`.
2. Fold aliases taken from `VENUE_MAP` and the property names (`vite-app/src/utils/utils.js`), with
   a server copy of the alias list. "parx" equals "parx casino".
3. Score 3 for an exact key, 2 when one key contains the other or the token Jaccard is at least
   0.5, 0 when either side is unknown, and −3 for a mismatch.

| Pair kind | Date | Room | Amounts | Other |
|---|---|---|---|---|
| dashboard cash ↔ `cash_sessions` (ended) | same day 3, ±1 day 2 (late nights cross midnight) | as above | net within $1 → 3; buy-in and cash-out both within $1 → +1; net off by more than $1 → −2 | hours within 0.5 → +1 |
| dashboard MTT ↔ `tracking_entries` | tournament date (normalised, `lib/analytics.js` `normaliseDate`) same day 3, ±1 day 2 | room vs `property`/`site`/`venue` | net within $1 → 3; same buy-in per entry → +1 | event-name token overlap ≥ 0.5 → +1 |
| deposit/withdrawal ↔ `bankroll_adjustments` same kind | ±3 days 2 | — | amount equal → 4 | |
| expense ↔ `bankroll_transactions` expense | same day 3 | — | equal to the cent → 4 | compatible category → +1 |

- **Classes.** A pair is shown when its score is ≥ 5 and its dates are within the window. It is
  **Likely** at ≥ 7 and **Possible** at 5-6.
- **A cash row never pairs with a tournament row.** A dashboard "MTT" logged here as cash, or the
  other way round, shows up as two rows in the reconciliation's "results only here" list. That list
  is where the owner catches it.
- **Inside the dashboard.** Pairs of dashboard rows that look like the same night are listed for
  information. The default imports both, because the dashboard's roll counted both.

### 9.2 Other review items

- **Backers.**
  - One card per §7.1 backer: name, masked token (first 2 characters and `••••••`), stakes summary,
    opening, delivery, source (live roster, deleted in the dashboard, or history only).
  - The choice is **New backer** or **Same as `<existing staking backer>`**, offered when the names
    match case-insensitively. Default New.
  - Two dashboard backers with the same token are impossible (the store is keyed by token in
    practice). If it happens, the run refuses to commit.
- **Slate deals.** One row per deal, with the series or backer match and the settlement link it
  found or didn't.
- **Recorded shares that disagree.** These are `backer_events` whose share is not pct × the
  session's *current* result, because the session was edited after notify. This is information.
  The default keeps what the backer was told. Each line offers "Recalculate after import".
- **Notify consistency.** A session in `wsop-notified-sessions` with no event, or an event whose
  session is not in the list. Information only.
- **Errors.** Rows that fail validation (§5.2 result mismatch, a bad date, a negative amount where
  none is allowed). They are skipped, and listed.
- **Sign flags** (§5.3), **`other` expenses** (§5.4), **rounding** (§5.7).
- **Reconciliation** (§5.8), with the opening deposit editable.

### 9.3 UI: Bankroll › Import, a new section above "Import CSV"

**Placement and rules.**
- The section is `BankrollImportDashboard.jsx` with its own `bankroll-import-dashboard.css`. The
  CSS header lists every row, as the other bankroll CSS files do.
- It shows only when `req.user.id === HAM_OWNER_ID`. The server says so in `GET /api/bankrolls`
  (`can_import_dashboard`).
- Content is the sheet's 35g column. Every box is whole g × whole r. Every baseline sits on an r line.
- Pills and buttons follow the owner's rule: the container sits on the grid and the label is centred
  (`.ctl`, `.ctl-cap` for the display face, `snap-g` for content-sized tags).
- Tokens only. No px (memory "Never px"). No orange.

| State | Rows |
|---|---|
| idle | `h3.an-sec` "From the dashboard" · `an-p` "Brings in the dashboard's sessions, adjustments, expenses, backers and slate. Nothing is written until you have reviewed it." · brand pill **Fetch** 8g × 5r (`bk-btn bk-btn--brand bk-w8`) |
| staged · totals | the dashboard's 2 × 17g figure cells: **Dashboard roll** / **Roll after import**, **Dashboard fund** / **Fund after import**; one `an-p` naming the difference ("+$1,350: 3 results only here, listed below; $0.38 rounding") |
| staged · counts | rows 4r (text on line 3): label 21g · New 7g · To review 7g, for sessions, tournaments, adjustments, expenses, backers, slate deals, balances |
| staged · opening | 35g × 4r rows: date and amount (editable fields as the CSV importer's `bk-field`), the formula as a footnote |
| staged · pairs | a **Pair card**, below; then a 17g × 5r pill **"Same night" for all N likely pairs** (it only fills unanswered Likely pairs; Possible ones always need their own answer) |
| staged · backers, slate, divergences, consistency, errors | cards and 4r rows in the same type |
| staged · commit | "N pairs still to answer" (seated on an r line; gone at 0) · brand pill **Import** 17g × 5r (disabled while N > 0, `aria-disabled` with that sentence as its description) · **Discard** 8g × 5r |
| committed | the summary rows, the after-import reconciliation, and **Undo this import** 11g × 5r (danger) behind a typed-count confirmation (the `ResetResults.jsx` pattern) |

**Pair card** (35g; 1g inside each side):

| Row | Height | Content |
|---|---|---|
| head | 4r | the date on line 3 at 1g (Univers Condensed md); at the right a `snap-g` 3r tag **Likely** / **Possible** |
| column heads | 3r | 16g "Dashboard" · 1g · 16g "futurega.me" (`an-th`) |
| fields | 5 × 3r | Room, Game, In → out, Result (display face; coloured by `moneySign`; a word as well as a colour), Hours. A field equal on both sides carries a "same" mark after the value (text, not colour alone) |
| decision | 5r | `bd-seg2` radio group 33g: **Same night** · **Different nights** |
| figures | 5r, only when the nets differ | `bd-seg2`: **Keep futurega.me's** · **Use the dashboard's** (shown after "Same night") |

Cards sit 1r apart. Text in a 16g cell truncates by the clipping rule: padding cancelled by an equal
negative margin, never `overflow-y: visible` (CLAUDE.md). The full value goes in a `title` and an
expanded state on tap.

**Guards.** `scripts/seed-money-import-demo.js` writes a staged run of made-up data into a SCRATCH
DB. It covers every card kind: pairs with equal and unequal nets, three backer sources, a slate
deal, divergences and errors.
- `check:controls` (`scripts/check-control-centring.mjs`) gains a step `bankroll-import-dashboard`
  that opens Bankroll › Import and walks every pill, segment and tag at 402 and 1440.
- `check:clipping` gains the same walk.
- Both are run before deploy. Check the skipped count and the seed token's `exp` (handoff trap,
  2026-10-14).

### 9.4 The write after confirmation (commit)

The commit is one `BEGIN … COMMIT` in this order:
1. Create the fund bankroll if it is missing.
2. Write the backers and their standing agreements and stakes. `effective_from` is the import day
   for now. The cutover call (§11.4, §13 step 6) moves it to `postingSince` on every agreement an
   import created, and posting is off until then, so nothing posts in between.
3. Write the results (tournaments, entries, cash sessions, extras) for the `new` and `different`
   rows.
4. For `same-keep` pairs: write a `decision='same'` key pointing at the existing row, fill
   `session_extras` from the dashboard row where the existing row has none, and write no money.
5. For `same-take` pairs: the same as `same-keep`, plus an update of the existing row's money to the
   dashboard's figures, recorded in the summary.
6. Write the adjustments, transfers, settlements, opening and rounding.
7. Write the expenses.
8. Write the slate series, agreements and settlements.
9. Write the money locations and settings.
10. Link `backer_events` to imported or `same` results.
11. Write the keys.

After it, `saveDatabase()` runs once, the run is set to `committed` and the summary is stored.
`money_settings.cutover` becomes `imported`. Posting stays off.

### 9.5 Delta pulls

A second **Fetch** builds a plan against the keys.
- **New rows** go through §9.1 as before.
- **Rows whose source `updatedAt` moved** are listed as **Changed in the dashboard**. The default is
  to apply the change. If the row here was also edited after the import, the item is a conflict, and
  the default keeps futurega.me's.
- **Rows now deleted in the dashboard** are listed as **Deleted in the dashboard**. The default is to
  remove them here.
- **Backers** are compared the same way.

---

## 10. Staking settlement fixes (this model is being adopted, so they are part of it)

**Built in Phase 3** (see "Phase 3: as built" after the §15 table). This section is the arithmetic as
built, under the owner's Q11 (the backer pays up front). The code: `lib/staking/settlement.js` (the
calculator, settle, paid, the migration), `lib/staking/settlement-routes.js` (HTTP),
`vite-app/src/utils/staking-settlement.js` and `StakingView.jsx` (the panel). The old handlers at
`server.js:7394-7700` are gone.

**The sign, said once.** Every figure is in the series' currency and from the **player's** side.
`amountOwed > 0` means **the player pays the backer** (`direction: 'to_backer'`). `amountOwed < 0`
means **the backer pays the player** (`direction: 'to_player'`). The ledger row is the mirror image:
paying a backer takes money out of the bankroll (−), being paid by one puts it in (+).

1. **A pure calculator.** `computeEntry(agreement, events, overrides, input, rules)` works out one
   agreement; `computeSheet(db, seriesId, userId, { inputs, rules })` loads a series and returns one
   entry per **agreement**: `{ agreementId, backerId, …figures, events }`. GET, the new preview and
   settle all call it. The unused `calcRes` is gone. An agreement is on the sheet when it is active,
   or inactive with events logged.
2. **The sheet carries ids and paid flags.**
   - For a **settled** series, GET returns the **stored** rows from `backer_settlements`, one per
     `agreement_id`: `id`, `isPaid`, `paidAt`, `settledAt`, the stored figures, `makeupOpening`,
     `makeupClosing`, `adjustment`, `prepaid`, and `ledger` (the paid row, if any). The breakdown
     (lines, events, the rules used) is the row's `snapshot`, written at settle. It never
     recomputes. Recomputing settled series was the root of the double count, and an edit to an event
     after settlement must not move money that has been paid.
   - For an **unsettled** series, GET returns the computed entries with `id: null`.
   - The Paid toggle renders when `id` is set (`utils/staking-settlement.js` `canMarkPaid`).
3. **`isSettled` versus `status`.** GET returns `isSettled: status === 'settled'` beside `status`;
   Finalize shows only when `isSettled` is false (`showFinalize`).
4. **Settle never trusts client figures.**
   - The body is `{ prepaid?: [{ agreementId, amount }], adjustments?: [{ agreementId, amount, note }],
     partner?: [{ agreementId, amount }] }`: what a backer actually prepaid, a negotiated adjustment,
     and the other player's result on a swap or crossbook. Anything else (the old client's
     `settlements` array of figures) is ignored.
   - The server recomputes and stores `computed_owed`, `adjustment`, `prepaid`, and
     `amount_owed = computed_owed + adjustment`.
   - It writes **one row per agreement** (`agreement_id`, unique), replacing the `(series_id,
     backer_id)` upsert. Two agreements for one backer are two rows.
   - Re-settling a settled series is a 409. A swap or crossbook without the other player's result is
     a 400 that names them; a `prepaid` on one is a 400.
   - `POST /settlement/preview` takes the same body and returns the sheet without writing, so the
     panel never does arithmetic.
5. **The figures** (owner Q11: the backer pays for the piece up front, before the event).

   Per event e of an agreement, in the series' currency: `buyin_e = per-bullet buy-in × bullets ×
   currency_rate`, `cash_e = cash × rate`, `tip_e = tip × rate`; `p` = the agreement's percentage
   (an event override wins) ÷ 100; `m` = the markup (an event override wins, then a tier, then the
   agreement). An event marked `cancelled` was **not played**; an opted-out event is not in the deal
   at all. Pending, bought-in and playing events count as played and are flagged.

   **The action types** (pay_per_play, open_commitment, budget_capped, flat_package, makeup,
   tiered_markup):

   ```
   price_e      = buyin_e × p × m                      the backer's piece of event e, markup included
   investment   = Σ price_e            over the events PLAYED          (gross_investment)
   markupAmount = Σ buyin_e × p × (m − 1)  over the events played      (inside investment; the player keeps it)
   grossReturn  = Σ (cash_e − tip_e) × p  over the events played
   unplayed     = Σ price_e            over the events NOT played
   prepaid      = what the backer paid up front; default (rule prepaid.<type>):
                    'price' = investment + unplayed   (every piece sold, played or not: the normal case)
                    'cap'   = the budget cap          (budget_capped)
   owed         = grossReturn − (investment − prepaid)
   ```

   So a fully prepaid backer is owed exactly their share of the cashes, an event that was not played
   comes back as a refund (`refund = prepaid − investment` when positive), and a backer who has not
   paid has the unpaid price netted off (`unpaid = investment − prepaid`). Lowering `prepaid` on the
   sheet is how the owner says a backer has not paid. **The markup is the backer's cost and is never
   handed back:** the old `+ markupAmount` is gone.

   | Type | What the backer pays, and what they get back | Formula (on top of the above) |
   |---|---|---|
   | `pay_per_play` | Pays `p × m` of every buy-in (every bullet) up front; gets `p` of every cash after tips, and the price of any event not played back. | as above |
   | `open_commitment` | The same, over whatever the player enters; the backer is assumed to have paid for every bullet (lower `prepaid` if they paid a deposit). | as above |
   | `tiered_markup` | As pay-per-play, at the markup of the buy-in's tier (`minBuyin ≤ buy-in ≤ maxBuyin`, per bullet, in the event's currency). | `m` = tier markup; an event-level markup override beats the tier |
   | `flat_package` | Pays `p × m` of the package's buy-ins up front; gets `p` of the package's cashes, and the price of a package event not played back. | as above; rule `flatPackageUnplayed: 'keep'` charges an unplayed event (no refund) |
   | `budget_capped` | Pays the budget (the cap) up front; gets `p` of the cashes of the events the budget covered, plus whatever of the budget was not used. | events in date and start-time order; each takes `price_e` from what is left; the event that crosses the cap is shared pro rata (`f = left ÷ price_e`, so its price, markup and return are × f); later events are not backed. `prepaid` defaults to the cap, so `owed = grossReturn + (cap − investment)`. Rule `budgetCrossing: 'exclude'` backs only an event that fits whole |
   | `makeup` | Pays the piece up front like pay-per-play; gets `p` of the cashes, less any loss carried in from earlier series first. A loss not prepaid carries forward instead of being paid. | item 6 |
   | `profit_share_only` | Pays nothing; gets `p` of the series' net profit, and is never asked to cover a loss. | `investment = 0`, `prepaid` default 0, `grossReturn = max(0, Σ (cash_e − tip_e − buyin_e) × p)`; rule `profitShareBasis: 'event'` = `Σ max(0, …)` per event (the old code) |
   | `swap` | Pays nothing up front. Each player pays the other their percentage of their own cashes (after tips); the difference changes hands. | `owed = myPct × myResult − theirPct × theirResult`, a result = Σ (cash − tip) (rule `swapBasis: 'net'`: cash − tip − buy-in). `theirResult` is typed at settlement |
   | `crossbook` | Pays nothing up front. A bet on who does better: the player with the worse net result pays their percentage of the difference to the other. | `D = myResult − theirResult` (net results; rule `crossbookBasis: 'cash'`); `D < 0`: `owed = myPct × (−D)`; else `owed = −theirPct × D`. Rule `crossbookMode: 'swap'` treats it as a swap (the old reading; it reverses who pays) |

   Then, for every type: `amountOwed = computedOwed + adjustment`, where `computedOwed` is `owed`
   (or item 6's figure for makeup). `netPnl`, the backer's result on the series before makeup and
   adjustment, is `grossReturn − investment` for the action types and profit share, and `owed` for a
   swap or crossbook. Figures are rounded to the cent (half away from zero) per agreement, and `owed`
   is worked from the rounded parts, so the lines on the sheet add up exactly.

   **Worked examples** (each is a case in `test/staking-settlement.test.js`, worked by hand):

   | Case | Working | Result |
   |---|---|---|
   | **The headline.** pay_per_play 10% of a $1,000 event at 1.2, one bullet, no cash | price = 1000 × 0.10 × 1.2 = 120 (markup 20); prepaid 120; owed = 0 − (120 − 120) | **0**: the backer's $120 loss was settled up front |
   | The same, netted (the owner sets prepaid 0) | owed = 0 − (120 − 0) | **−120**: the backer pays the player **$120** (the old code said $100) |
   | Markup with cash: as above, cash $5,000, tip $100 | return = (5000 − 100) × 0.10 = 490; owed = 490 − (120 − 120) | **+490** to the backer (netted: +370; the old code: +390) |
   | An unplayed event: 10% at 1.1, $1,500 played no cash, $2,500 not played | price 165 and 275; prepaid 440; owed = 0 − (165 − 440) | **+275**, the refund |
   | currency_rate: 25% at 1.0 of a €1,100 event fired twice at 1.08, cash €4,000 | buy-in 1100 × 2 × 1.08 = 2,376 → price 594; cash 4,320 → return 1,080 | **+1,080** |
   | open_commitment 15%, $500 × 2 bullets, cash $2,000 | price 150, return 300 | **+300** |
   | tiered_markup 10%, 1.1 to $1,500 and 1.25 above: $1,000 bust, $10,000 cash $30,000 | price 110 + 1,250 = 1,360 (markup 260); return 3,000 | **+3,000** |
   | flat_package 20% at 1.15, $1,500 played no cash, $1,500 not played | price 345 each; prepaid 690; owed = 0 − (345 − 690) | **+345** refund (rule `keep`: 0) |
   | budget_capped 10% at 1.0, cap $1,000: in date order $5,000 bust, $3,000 cash $9,000, $5,000 cash $20,000, $2,000 cash $6,000 | prices 500, 300, then 200 of 500 (f = 0.4: return 20000 × 0.10 × 0.4 = 800), then nothing; investment 1,000; return 900 + 800; prepaid = cap | **+1,700** |
   | The same cap, only the first two events | investment 800, return 900, prepaid 1,000; owed = 900 − (800 − 1000) | **+1,100** (900 + the unused 200) |
   | profit_share 10%: $1,000 bust, $1,000 cash $2,500 tip $100 | nets −1,000 and +1,400; series net 400 × 0.10 | **+40** (per event: 140; a losing series: 0) |
   | makeup 20%, series 1: opening 0, $5,000 bust, netted (prepaid 0) | owed = −1,000; total = −1,000 + 0 | pays **0**, carries **−1,000** |
   | makeup, series 2: opening −1,000, $5,000 cash $12,000, prepaid 1,000 | owed = 2,400; total = 2,400 − 1,000 | **+1,400**, closing 0 |
   | swap 5% / 5%: mine $1,500 cash $10,000 tip $200 and a $3,000 bust; theirs $4,000 | 0.05 × 9,800 − 0.05 × 4,000 = 490 − 200 | **+290** to the other player |
   | crossbook 10% / 10%: mine $1,000 cash $6,000 and a $1,000 bust (net 4,000); theirs −500 | D = 4,000 − (−500) = 4,500 > 0: they pay 0.10 × 4,500 | **−450**: they pay the player $450 |
   | The same crossbook, theirs +6,000 | D = −2,000: the player pays 0.10 × 2,000 | **+200** |

   **The rules that are a choice** (the defaults are the standard staking-market meanings; each is an
   open question for the owner, §17 Q15 to Q21): `STAKING_SETTLEMENT_RULES` on the server, JSON, sets
   any of them, e.g. `{"crossbookMode":"swap","prepaid":{"makeup":"none"}}`, and every boot logs
   `[staking] settlement rules: the defaults` or the custom set. A settled series keeps the rules it
   was settled under in each row's snapshot, so a change never moves settled money.

   | Rule | Default | Other values |
   |---|---|---|
   | `prepaid.<type>` | `price` for every action type, `cap` for budget_capped, `none` for profit share (swap and crossbook have no prepayment) | `price`, `used` (only the events played: no refunds), `cap`, `none` (a netted deal) |
   | `flatPackageUnplayed` | `refund` | `keep` |
   | `budgetCrossing` | `prorate` | `exclude` |
   | `profitShareBasis` | `series` | `event` |
   | `swapBasis` | `cash` | `net` |
   | `crossbookMode` | `bet` | `swap` |
   | `crossbookBasis` | `net` | `cash` |

   **Open from §10 before Phase 3, still open:** whether the up-front receipt itself posts to the
   ledger. Nothing books it; item 7 books only the final payment (§17 Q22).
6. **Makeup without the double count.**
   - **Migration** (`staking-settlement-2026-10`). For an agreement in an unsettled series,
     `makeup_opening = makeup_balance`. For one in a settled series, `makeup_closing = makeup_balance`
     goes onto its settlement row, and `makeup_opening = makeup_balance − raw` (onto the row and the
     agreement), where raw is that series' recomputed result without makeup (`grossReturn −
     investment`, the old GET's `netPnl`). The boot log gives the counts; prod may have none.
   - **The sheet** reads `makeup_opening` and never `makeup_balance`:
     `total = owed + makeupOpening`, `computedOwed = max(0, total)`, `makeupClosing = min(0, total)`.
     A loss carries forward instead of being settled. A later profit first repays it, and only the
     excess is paid.
   - **Settle** stores opening and closing on the settlement row and **does not write the
     agreement**. A new makeup agreement opens with the backer's most recent settled closing unless
     `makeupOpening` (or the older `makeupBalance`) is given; the create answer says which.
   - **Sign.** Negative means the backer's loss, carried, not paid. That is the dashboard's meaning of
     makeup ("opening: negative if they're in makeup", WC:`BackersUI.tsx`). `makeup_balance` is still
     written on create, and never read.
   - **Prepaid.** A fully prepaid losing series has `owed = 0`, so nothing carries: a makeup
     agreement that is prepaid settles like pay-per-play. Makeup only arises on netted deals (rule
     `prepaid.makeup: 'none'` makes that the default, §17 Q20).
7. **Paid posts to the ledger** (bankrolls.md seam 2).
   - `PUT /settlements/:id/paid {isPaid:true}` writes one `settlement` adjustment of
     `−round(amountOwed)` (whole units; the note keeps the exact figure when it is not whole) into
     `staking_series.bankroll_id` (NULL = Main), with `settlement_ref 'bs:<id>'` (unique per user).
     A negative `amountOwed` (the backer pays the player) writes `+|amount|`. The note reads
     `<series>: paid to <backer>` or `received from <backer>`. `date` (YYYY-MM-DD) is optional.
   - Marking it unpaid deletes that adjustment. A request that does not change the state writes
     nothing, so a double tap cannot book twice.
   - When the bankroll's currency is not the series', the request must carry `amount`, what moved in
     the bankroll's currency (409 `needsAmount` without it); the note keeps the series' figure.
   - `bankrollId` (`'main'`, null or one of the owner's bankrolls) is accepted on `POST` and `PUT
     /api/staking/series`.
8. **Tests.** `npm run test:staking-settlement` (39 server cases, then 11 `node --test` cases on the
   panel's helpers):
   - each backer type's figures against hand-computed examples (the table above), every rule switch,
     rounding, opt-outs, overrides and in-progress events;
   - the makeup carry across two series, with settle then GET returning the same figures (no
     double count);
   - one row per agreement, two for a backer with two agreements;
   - the paid toggle writing exactly one ledger row, idempotent, appearing and disappearing, into the
     series' bankroll, and the cross-currency 409;
   - settle ignoring client figures; the 409 on a re-settle; preview writing nothing;
   - an unplayed event's refund, currency_rate, a budget cap, swap and crossbook through the server;
   - the migration on rows the old code wrote;
   - the client rendering `id` and `isSettled` (`vite-app/src/utils/__tests__/staking-settlement.test.mjs`).

---

## 11. The owner API (futurega.me)

### 11.1 Auth

- **Header token.** Every `/api/owner/*` route takes `Authorization: Bearer <LEDGER_TOKEN>`, with
  `LEDGER_TOKEN_PREVIOUS` accepted inbound. It uses the same constant-time `checkSharedToken`, now
  in `lib/shared-token.js` (`lib/dashboard-token.js` becomes a thin wrapper).
  - 404 on mismatch or when unset.
  - 503 when `HAM_OWNER_ID` is unresolved.
  - Limited to 60 requests a minute per IP.
  - `Cache-Control: no-store`.
- **Who it acts as.** It acts as `HAM_OWNER_ID` (`server.js:286-311`).
- **Why not `DASHBOARD_TOKEN`.** That token is in the iOS binaries (§2.2 point 10) and only ever
  reads and buzzes. This API writes money and must be revocable on its own. It is the same
  reasoning as the dashboard's `SESSION_LOG_TOKEN` (WC:`server/server.js:244-260`) and as the
  separate `ROSTER_TOKEN` that closed the roster leak (§2.2 point 10).
- **Who holds it.** Only the two Render services hold `LEDGER_TOKEN`. It is never put in an app,
  the local pm2 config, a repo or a chat.
- **Why not cookies.** Both are host-only (§2.2 point 12), so a browser on dashboard.futurega.me
  cannot act as the owner here. Everything goes server to server.

Generate the token once (**Mac or PC**, the command is identical; it prints nothing else):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The 64 hex characters match `TOKEN_SHAPE` (`lib/dashboard-token.js`, `[A-Za-z0-9]{6,64}`). Paste the
value into both Render services' environment and nowhere else.

### 11.2 `GET /api/owner/money`

This is everything the dashboard's summary, series, verdict, insight, Today, Review, Cockpit,
widget, watch and `get_bankroll` read today, in their own shapes.

```json
{
  "generatedAt": "2026-10-20T15:00:00.000Z",
  "lastChangeAt": "2026-10-20T03:12:44.000Z",
  "currency": "USD",
  "roll": 61234.5,
  "wsopFund": 18000,
  "rollPeak": 64010,
  "fund": { "bankrollId": 7, "saved": 18000, "target": 65000, "targetDate": "2027-05-03", "firstActivityDate": "2026-05-01" },
  "bankrolls": [ { "id": "main", "name": "Main", "balance": 59000.5, "inRoll": true, "isFund": false } ],
  "sessions": [
    { "id": "cs:41", "date": "2026-10-19", "channel": "live", "isMTT": false, "format": "PLO",
      "gameLabel": "5/5/10 PLO", "venue": "Parx", "stakeLevel": "5/5/10",
      "buyInTotal": 1000, "cashOut": 2240, "hours": 5.2, "result": 1240, "isWsopFund": false,
      "hands": null, "entries": null, "place": null, "fieldSize": null,
      "moodRating": 4, "tiltNote": null, "journal": null, "tags": [] }
  ]
}
```

- **`roll`** is the sum of `in_roll` bankroll balances in USD (§5.8). **`wsopFund`** is the fund
  bankroll's balance. Both come from `bankrollLedger` (`lib/bankroll-ledger.js`), never re-summed.
- **`rollPeak`** is the highest running total of the roll bankrolls over the whole ledger. It
  replaces WC:`dashboard.js:261-271`.
- **`fund.firstActivityDate`** is the earliest fund ledger entry, which drives WC's pace math
  (`dashboard.js:276-290`).
- **`sessions`** holds every ended cash session and every tournament result of the owner, newest
  first.
  - A tournament's `buyInTotal` is buyin × entries and its `cashOut` is the cash if cashed.
  - `format` and `channel` come from §6.3.
  - `isWsopFund` is true when the row is in the fund bankroll.
  - The `session_extras` fields are included.
  - Non-USD rows are converted at the ledger's rates.
- **Not included.** Live cash sessions are left out, as WC's own data never had them.
- **`?since=YYYY-MM-DD`** limits `sessions` to rows dated or created on or after that day (§13
  step 7's rollback list). The totals are always whole-ledger.

### 11.3 `POST /api/owner/sessions/log`

The body is `{ session: {…log_session fields…}, commit: false|true }`, or the flat form, as
WC:`server/server.js:312-319` accepts.
- **Validation.** It ports `normalizeSession` (WC:`server/lib/session-log.js:63-170`) verbatim:
  - the format keys, `MAX_MONEY`, `MAX_HOURS` and the ET-day default;
  - the refusal of a `result` that disagrees with `cashOut − buyInTotal`;
  - the derived `chat-<sha1>` id.
  The ported tests are WC's `session-log.test.js` (46) and the HTTP half of
  `session-log-http.test.js` (31).
- **Idempotency.** The fingerprint is the id (`chat-…` or a caller-supplied id) in
  `bankroll_import_keys`. When it exists and its row is alive, the call **updates that row**
  (`replacesExisting: true`). A changed kind (cash ↔ MTT) is a 409: "delete it in the app first".
- **Where it writes.** An MTT goes to a Personal tournament + entry + extras, as §5.2. A cash
  session goes to an ended cash session with `time_known 0`, started at 12:00 ET on its day, plus
  extras. `isWsopFund` goes to the fund, else `money_settings.defaultBankroll`. `origin` is `'chat'`.
- **The preview** (`commit:false`, the default) writes nothing. It returns:
  - `{ ok, dryRun: true, session, summary, notes, replacesExisting, rollBefore, rollAfter }`;
  - `ref` when it would update an existing row;
  - `backerCuts: [{ name, pct, shareCents }]` from the standing engine.
- **The commit** writes, runs `syncSharesFor` (when posting is on), saves, and returns the same
  fields plus `committed: true`, `ref` and the ledger's real `rollAfter`.
- **Backers.** The MCP path finally reaches them. That fixes "Backers are NOT notified by this
  path" (WC:`server/server.js:345-349`).

### 11.4 `PUT /api/bankrolls/money/cutover` (the owner's admin JWT, not the ledger token; `req.user.id` must be `HAM_OWNER_ID`)

The body is `{ posting: 'on'|'off', postingSince?: 'YYYY-MM-DD', cutover: 'imported'|'live' }`. It
is the one switch §13's steps flip, so a rollback is one call and needs no deploy.
- **Turning posting on.** It moves `effective_from` to `postingSince` on every standing agreement an
  import created. Agreements the owner made by hand keep their own date.
- **`cutover: 'live'`.** `syncBackerRoster` returns at once with one log line, and the feed stops
  falling back to `console_records`.
- **Turning posting off** posts nothing further. Events already posted stay; they are true.

### 11.5 Deep links into the app (Phase 9)

`App.jsx` gains hash routes, beside the existing `#h/` handling (`App.jsx:79`, `:523`).

| Link | Opens |
|---|---|
| `#bankroll/overview` (and the other tabs) | the bankroll dashboard on that tab |
| `#results/tournaments` · `#results/cash` | the Results tab halves |
| `#staking` · `#staking/standing` | the Staking tab, the Standing section |
| `#expenses` | Results › Expenses & Income |
| `#tax` | the tax report |

- **Admins only.** For an admin the route opens after login if needed. Anyone else lands on the
  home.
- **Cleared once used.** `replaceState` clears the hash after use.

---

## 12. wsop-console (dashboard) changes

### 12.1 Changes (Phase 11)

- **`server/lib/money-source.js` (new).**
  - It fetches `SCHEDULER_BASE_URL/api/owner/money` with the current `LEDGER_TOKEN`, a 5 s timeout
    and a 60 s cache (stale-while-revalidate, plus a 5-minute cron).
  - It persists the last good payload in `console_flags` (`money-cache`), so a cold boot has
    numbers.
  - A non-JSON or non-2xx answer keeps the last good copy and records the error. It is never a
    success.
- **Two env flags.** `MONEY_SOURCE=dashboard|scheduler` (default `dashboard`) and
  `MONEY_WRITES=open|frozen` (default `open`). They are what §13 flips.
- **`computeDashboardSummary` and `buildDashboardSeries`**
  (WC:`server/lib/dashboard.js:121-352`) take their money from `money-source` when
  `MONEY_SOURCE=scheduler`. The changes are:
  - `S` becomes `feed.sessions`, and `roll`, `wsopFund`, `rollStats.peak`, `fund.target`, the fund's
    first date and `updatedAt` come from the feed;
  - `startingRoll` is no longer read;
  - `stale` becomes "no money data has ever been fetched";
  - a new **additive** `freshness.money: { fetchedAt, ageMinutes, ok }` is added. Swift's decoder
    ignores unknown keys, and every `CONTRACT` path (WC:`server/test/native-contract.test.js:37-82`)
    keeps its type;
  - `computeInsight`, `dashVerdict`, `downswingState` and `rateConfidence` are unchanged: they get
    the same `Session` shape.
- **MCP and `/api/sessions/log`.** `get_bankroll` reads the money source after a forced refresh.
  `log_session` and `/api/sessions/log` forward to `/api/owner/sessions/log` with the same preview
  and commit semantics.
  - The tool text gains the backer cuts.
  - The line "Backers are NOT notified by this path" goes.
  - `MONEY_WRITES=frozen` turns a commit into the refusal "Logging is paused for the move to
    futurega.me — try again in a few minutes".
  - The OAuth pairing stays where it is, so the Claude app needs no re-pairing.
- **New PWA routes (ham-gated, relative).** `GET /console/api/money` (the cached feed plus its
  freshness) and `POST /console/api/money/sessions/log` (forward). They get tests in the style of
  WC:`server/test/backer-proxy.test.js`, including a non-JSON upstream becoming a 502.
- **The PWA store** (WC:`app/src/store.tsx:79-91`) loads `sessions` read-only from
  `/console/api/money` when the server says `MONEY_SOURCE=scheduler`. The last copy is cached in
  localStorage for offline.
  - Today's roll (WC:`TodayScreen.tsx:65`) shows `feed.roll`/`feed.wsopFund` and never recomputes
    them.
  - Review, Health's downswing card and Trends read the same `sessions`.
  - `computeBankroll` is no longer called anywhere.
- **Ending a live session.** The Today screen's live-session end (WC:`TodayScreen.tsx:451`,
  `SessionForm`) becomes a **Log to futurega.me** sheet. It previews through the proxy, shows the
  summary, roll delta and backer cuts, and commits on confirm. The live clock, stop-loss and
  circuit breaker are unchanged.
- **Sync when frozen.** With `MONEY_WRITES=frozen`, `POST /console/api/sync` (WC:`server.js:535`)
  stores nothing for stores `sessions`, `adjustments`, `expenses` and `backers`, or for the local
  keys `wsop-staking`, `wsop-balances`, `wsop-notified-sessions` and `wsop-admin-taxrate`.
  - It answers 200 with `rejected: [{store, id, reason: 'moved'}]`, so an old cached bundle cannot
    loop.
  - The new client shows a one-line banner when anything was rejected.
- **The relay when frozen.** `POST /console/api/backers/notify` and `/unnotify` return JSON 410
  `{ error: 'moved to futurega.me' }`.

### 12.2 Retires (Phase 13, after the soak)

| Retires | Where |
|---|---|
| Sessions, Bankroll (Roll / Admin / Risk), Admin (staking calculator, backers manager, expenses, tax read, setup checklist) screens | WC:`app/src/screens/SessionsScreen.tsx`, `BankrollScreen.tsx`, `RiskView.tsx`, `AdminView.tsx`, `BackersUI.tsx`, `components/SessionForm.tsx` (except what the Today log sheet reuses) |
| Client money model and math | WC:`app/src/db/backers.ts`, `backerClient.ts`, `engine/bankroll.ts` (the stake ladder `recommendStake` and floors STAY: Today's stake call uses them), the money parts of `engine/analytics.ts` and `engine/csv.ts` |
| Synced money blobs | the money keys leave `SYNCED_LOCAL_KEYS` (WC:`syncLocal.ts:17-29`); the IndexedDB money stores stop syncing (`idb.ts:160-164`) and are dropped in a later `DB_VERSION` |
| Notify relay | WC:`server/server.js:478-521` and `test/backer-proxy.test.js` |
| Roster seam | WC:`server/server.js:217-262` and `server/lib/roster-token.js` (after the `ROSTER_TOKEN` fix; it was `:220-237`, which also moved the WC `server.js` lines cited after it by about +25) |
| Money export | the Phase 4 endpoint |
| Server money math | WC:`dashboard.js` roll / fund / peak code, the `wsopFundTarget` default (`:275`) |
| `console_records` money rows | **kept** read-only as an archive; no code reads them (§17 has no question here: deleting money history gains nothing) |

### 12.3 Links into futurega.me

- **The tab bar.** It becomes Today, Trends, Train, Health, Plan, Review, Settings and **Money ↗**
  (WC:`app/src/components/BottomNav.tsx:12-22`). Trends, Review and Settings are not money screens
  and stay (§17 Q13).
- **The Money tab** opens a small link sheet. It does not embed futurega.me.

| Link | Target |
|---|---|
| Bankroll | `https://futurega.me/#bankroll/overview` |
| Sessions | `https://futurega.me/#results/cash` and `#results/tournaments` |
| Backers & staking | `https://futurega.me/#staking/standing` |
| Expenses | `https://futurega.me/#expenses` |
| Tax | `https://futurega.me/#tax` |

- **On the iPhone** they open in the browser. If the futurega.me app later registers universal
  links, they open there instead.
- **Elsewhere.** The roll card on Today links to the Overview. The fund card links to the fund
  bankroll's Overview.

### 12.4 Fund-target drift

The target lives in `bankrolls.target_amount` on the fund bankroll. The PWA constant
`WSOP_FUND_TARGET` (WC:`bankroll.ts:205`) and the server's `|| 50000` (WC:`dashboard.js:275`) are
deleted. Both read `feed.fund.target`. One number, set in one place, editable in the bankroll manager.

### 12.5 Native apps and screensaver

No code change and no TestFlight build. The widget, watch and Cockpit keep calling
`/api/dashboard/:token/summary` and `/d/:token` on the dashboard, whose contract is unchanged.

---

## 13. Cutover order, with a rollback at each step

The owner picks an evening with no session in progress. Posting stays off until step 6, so no
backer is told anything twice.

| # | Step | Verify | Rollback |
|---|---|---|---|
| 0 | **Prep.** The owner confirms Render disk snapshots for the futurega.me service; generates `LEDGER_TOKEN` (§11.1) and sets it on both Render services. No app build is involved, so no `.testflight-hold` is needed. | both services healthy | unset the token (every new route 404s) |
| 1 | **Ship dormant code** (Phases 1-3 and 5-10 on futurega.me; Phases 4 and 11 on the dashboard, its flags at their defaults). New tables are empty; the feed reads SQL then `console_records`, so it is unchanged; posting is off; `MONEY_SOURCE=dashboard`. | `test:*` suites; parity route `differ: []`; the backer page guard | revert the deploys (the new tables are inert) |
| 2 | **Rehearsal import.** Fetch → review → commit. The dashboard still owns money and notify. | the reconciliation: fund within its rounding remainder, roll explained to the line; parity route still `differ: []` (pages now read SQL); 3 backer pages opened by hand | **Undo this import** (§8.2): every created row goes, links clear, pages fall back to `console_records` |
| 3 | **Soak the copy** (a few days, the owner keeps using the dashboard). Nights logged here as well are what the delta's review catches. | nothing to do | as step 2 |
| 4 | **Freeze dashboard money writes:** `MONEY_WRITES=frozen` on the dashboard (restart, about 1 minute). | a PWA save shows the banner; MCP commit refuses; notify returns 410 | `MONEY_WRITES=open` |
| 5 | **Delta pull** on futurega.me: fetch (with the 14-day margin of "Phase 4: as built", trap 1) → review the new nights, changes and deletions → commit. | the reconciliation against the frozen dashboard: fund within its rounding remainder, roll explained | Undo the delta run (only its rows); then step 4's rollback |
| 6 | **Posting on:** `PUT /api/bankrolls/money/cutover { posting:'on', postingSince: today, cutover:'live' }`. Roster sync stands down (`cutover = live`). Standing agreements' `effective_from` = today. *(§1.1 Q1: this enables the Notify action; it does not post on save.)* | log a test result in the app, see the cut preview, save (**nothing posts**), tap Notify, see the event on a backer page, then edit the result and see the page update with no push, then delete it and see it leave the page (check the log, not a backer's phone: use a demo backer created for the test and ended after) | `{ posting:'off', cutover:'imported' }`; every event posted since is listed by `GET /api/staking/standing/:id/events?source=ledger&since=<date>` (per agreement) for review |
| 7 | **Switch the dashboard's reads:** `MONEY_SOURCE=scheduler` (restart). | `/api/dashboard/:token/summary` roll and fund equal `/api/owner/money`; widget and Cockpit show them; MCP `get_bankroll` matches; MCP `log_session` preview (no commit) shows the cut | `MONEY_SOURCE=dashboard` and `MONEY_WRITES=open`; nights logged on futurega.me since step 6 are listed by `/api/owner/money` (`since`) for re-entry in the dashboard, and their shares stay posted (they are true); do not re-notify those nights from the dashboard |
| 8 | **Soak** (two weeks). Seams 1 and 3 exist but are idle: notify returns 410, roster sync no-ops. | weekly digest goes out from SQL; no `[roster]` writes in the logs; `freshness.money.ok` stays true | as step 7 |
| 9 | **Retire** (Phase 13): seams 1 and 3 (and `ROSTER_TOKEN` on both Render services), the export endpoint, the dashboard's money code, this app's `console_records`, the legacy backer-token routes. | both test suites; the native contract test; a backer page from each source of §7.1 | redeploy the tagged pre-retire commits of both repos (tag them `pre-money-retire` before merging Phase 13) |

Nothing is double-counted at any step:
- **Money.** Every dashboard row is written once, through a fingerprint, or skipped as a confirmed
  duplicate.
- **Backer events.**
  - Before step 6 only the dashboard notifies, and only imported history exists here.
  - From step 4 the dashboard cannot notify.
  - From step 6 only futurega.me posts, and only for results dated from step 6 on.
- **Backer pages** are computed here from step 2. They read the same `backer_events` throughout, and
  the parity route checks the openings and stakes.

---

## 14. What the CLAUDE.md files must say afterwards (Phase 13 writes these)

### 14.1 This repo

- **Architecture.**
  - Add a bullet: "**Money of record**: futurega.me is the only bankroll and staking store (owner,
    2026-10-14). Results, ledger, staking (series + standing agreements) and the backer surface all
    live here; the dashboard reads and logs through `/api/owner/*` (`LEDGER_TOKEN`, server to
    server). Spec: `docs/bankroll-merge.md`."
  - In the Backend bullet, add `LEDGER_TOKEN` (+ `_PREVIOUS`) and `BACKER_DELIVERY` to the env notes.
- **Dashboard seams.** Replace the list with:
  - **#1 notify: retired** `<date>`. Shares are posted here from results (`lib/staking/standing.js`).
  - **#2 departures:** unchanged.
  - **#3 roster: retired** `<date>`. The roster is the `backers` table, and tokens are
    `backers.public_token`.
  - **#4 money (out):** `GET /api/owner/money` and `POST /api/owner/sessions/log`. The dashboard's
    roll card, widget, watch, Cockpit and MCP depend on it, so a breaking change here needs the
    native contract test on the WC side run against it.
  - The paragraph "⚠ The local pm2 instance DOES have a token and DOES sync" becomes: the local DB
    *holds* whatever backer tokens it synced before `<date>` and must still be treated as
    production-sensitive. Nothing refreshes them now.
- **Backer surface.** The `/b/:token` page's data now comes from standing agreements and results
  here. "New link" is `POST /api/staking/standing/backers/:id/rotate-link`. Deliveries run only where
  `BACKER_DELIVERY` is on (Render).
- **Hazards.** Replace "Console/dashboard code was stripped (PR #44) — don't re-add console routes
  here; that's the wsop-console repo's job." with:
  > "Money lives here; the dashboard's health, training and plan features do not. Owner money
  > routes are `/api/owner/*` (ledger token) and the bankroll/staking trees (admin JWT). Do not
  > re-add `/console/*` routes, the dashboard's sync protocol or a second copy of the share math."
  > Add: "A standing share is created only by the owner's Notify tap (owner, 2026-10-14). Every
  > result write path must follow a posted share (`syncSharesFor`); one that skips it leaves a
  > backer's page wrong."

### 14.2 wsop-console

- **Architecture.** Add: "**No money here** (since `<date>`). futurega.me owns sessions, the roll,
  the WSOP fund, expenses, staking and backers. This server is an adapter: `lib/money-source.js`
  pulls `/api/owner/money` (`LEDGER_TOKEN`), the summary/series/verdict read it, and MCP
  `log_session` plus the Today log sheet forward to `/api/owner/sessions/log`. The native apps and
  the Cockpit are unchanged because the summary contract is."
- **Seams.** Remove 1 (notify) and 3 (roster). Add "money (in) from futurega.me". The new-series
  alert, geofences, MCP and OAuth stay.
- **Env.** Add `LEDGER_TOKEN`. Note that `HAM_PASS` no longer has to equal the scheduler owner's
  password, because the relay that needed it is gone. Drop `SESSION_LOG_TOKEN` if it was never set,
  or keep it for scripts; it forwards now.
- **Rules.** "Never re-add money stores or money math. `console_records` rows in stores `sessions`,
  `adjustments`, `expenses`, `backers` and `local` money keys are a frozen archive."
- **Tests.** Update the counts.

### 14.3 Docs

- **`docs/bankrolls.md`.** "Staking, and how they could connect" becomes "how they connect". Seam 2
  is built: paid settlements post to the ledger. The Shares sold row stays an owner question.
- **`docs/session-handoff.md`.** Add a dated section.
- **Wherever money is mentioned.** Add a one-line pointer to this spec.

---

## 15. Phases

Each phase is one builder, one branch and one PR. "Sonnet" is routine and spec-complete. "Opus" needs
judgment about money, posting or layout. The model policy (handoff, 2026-10-14) applies: set
`model` on every agent, and run one check per build.

| Phase | Repo | Scope | Depends | Tier |
|---|---|---|---|---|
| **0** | — | Owner: Render snapshots, `LEDGER_TOKEN` on both services, answers to §17 (defaults otherwise) | — | owner |
| **1** | sched | **Built** (see "Phase 1: as built" below). Migration `money-merge-2026-10` (§4); `lib/staking/standing.js` + `lib/staking/classify.js` with ported tests; `MOVE_KINDS` and labels; `equipment`/`fees` categories (server, client, tax rules); `affects_balance` in the transactions source and Expenses list; `time_known` in reports; account deletion | — | Sonnet |
| **2** | sched | **Built** (see "Phase 2: as built" below), behind a switch that ships off (`BACKER_PAGE_SOURCE`). Backer surface on SQL with `console_records` fallback (feed, digest, recipients); name precedence; rotation covers `public_token` + revisions, real-function test; `BACKER_DELIVERY` gate; delivery sweep (dormant: posting off); `backer_tokens` count log; parity route | 1 | Sonnet |
| **3** | sched | **Built** (see "Phase 3: as built" below). Settlement fixes (§10) + StakingView fields. Owner Q11: the backer pays up front, so `prepaid` is the normal case; the formulas for all nine types, swap and crossbook included, in §10 item 5; the open choices are switches (§17.1) | 1 | **Opus** |
| **4** | WC | **Built** (see "Phase 4: as built" below; dashboard branch `feat/money-export`, not merged). `GET /api/money-export` + `lib/shared-token.js` (`checkSharedToken`, the roster's check generalised) + tests; `LEDGER_TOKEN` declared in `render.yaml`, set by the owner | — | Sonnet |
| **5** | sched | Import engine: fetch, stage, plan (§5 mapping, §9.1 scoring, §7.1 union, §5.8 opening and reconciliation with a `computeBankroll` port), decisions, commit, undo, delta; owner-only routes | 1, 2 | **Opus** |
| **6** | sched | Import review UI (§9.3) + seed script + guard steps | 5 | **Opus** (grid seating and guard work has needed judgment on every bankroll tab) |
| **7** | sched | Standing shares live, to §1.1: the **Notify action** creates a share (Q1: not on save); `syncSharesFor` in every write path only **follows or voids** a posted share (§6.5), silently (Q2); the overlap `ask` (Q7) and where its answer is stored; exclusions, revisions, recalc, drift, preview, cutover state and `PUT /api/bankrolls/money/cutover`, roster sync standing down | 1, 2 | **Opus** |
| **8** | sched | Standing UI in the Staking tab: backers with stakes editor (from today / correct with preview; the game list is `classify.js` `GAMES`, Q8), opening, delivery, copy and rotate link, recorded shares with exclude / recalc / remove; the "Posts to backers" preview line on the result and cash forms and the Notify sheet (with the Q7 ask); guard steps | 7 | Sonnet |
| **9** | sched | Owner API (§11.2-11.3, ported `normalizeSession` + tests) and deep links (§11.5) | 1, 7 | Sonnet |
| **10** | sched | Money homes: fund bankroll target and progress (bankroll manager field + an Overview line), "Where's the money" (a seventh Overview section: locations, total, drift against the roll), tax set-aside line in the tax report | 1 | Sonnet |
| **11** | WC | Dashboard adapter (§12.1): `money-source`, flags, summary/series/MCP/PWA store, Today log sheet, frozen sync and relay, Money tab links, fund target from the feed; contract and adapter tests | 9, 4 | Sonnet build, **Opus** review of the summary adapter |
| **12** | both | Cutover (§13 steps 2-8), run by the lead with the owner | 1-11 | **Opus** + owner |
| **13** | both | Retire (§12.2, §7.3, §7.4) and CLAUDE.md / docs (§14), after a two-week soak; tag `pre-money-retire` first | 12 | Sonnet |
| **14** | sched | *(optional, §17 Q10)* Standing payouts: `standing_payments` (id, agreement_id, amount_cents signed, paid_on, note), each writing a `settlement` adjustment (`settlement_ref 'sp:<id>'`); feed `paidCents`, running total = shares + opening − payouts | 7, 8 | Sonnet |

### Phase 1: as built (2026-10-14, branch `feat/money-merge`)

Built to the spec and to the owner's answers in §1.1. No route, no UI beyond two text changes, no
import, nothing posted to a backer page.

**What exists**
- **The migration.** `lib/money-merge.js` (`TABLES`, `COLUMNS`, `INDEXES`, `migrate`), registered in
  `server.js` `dataMigrations` as `money-merge-2026-10` after `bankroll-transactions-2026-10`.
  - Eight tables and 32 columns, as §4.1 and §4.2 draw them.
  - Additive and idempotent: `CREATE … IF NOT EXISTS`, and a column is added only when
    `PRAGMA table_info` does not list it.
  - **All or nothing**: one `SAVEPOINT`. The `dataMigrations` runner swallows a throw and retries at
    the next boot, and the next migration's `saveDatabase()` would otherwise save a half-applied
    schema.
  - The one existing-row write is the one §4.2 names: `backer_events` rows that exist when the
    columns arrive get `notified_share_cents = share_cents` and `notified_at = ts`. That runs only
    in the run that adds the columns.
- **Classify.** `lib/staking/classify.js`: `formatOf`, `GAMES` (§6.3, rewritten for Q8),
  `ONLINE_ROOM`, `classifyTournament`, `classifyCash`, and `classifyResult(db, userId, ref)`, which
  reads the row and its `session_extras`.
- **Standing share math.** `lib/staking/standing.js`: `matchPct`, `matchStake`, `backerShare`,
  `cutsForSession`, `shareCents` (exact), the two net formulas, `usdCents`, `resultCuts` (windows,
  exclusions, the Q7 `ask`), the readers `loadAgreements`, `loadExclusions`, `seriesBackerIds`, and
  the ported helpers `sessionGameLabel`, `deliveryChannels`, `newToken`.
- **The constants of §4.3.**
  - `MOVE_KINDS` and the adjustment labels gain `correction` and `settlement`, on the server and in
    the client mirror (`vite-app/src/utils/bankroll-ledger.js`, `Bankrolls.jsx`).
  - `equipment` and `fees`: the server list, the client list, the tax rules (100%, `Sch. C`) and the
    labels in the ledger source, the reports and the tax report.
  - `lib/ledger-sources/transactions.js` skips `affects_balance = 0`. `GET /api/bankrolls/transactions`
    returns `affects_balance`, and the Expenses list prefixes such a row "Paid outside the roll".
    The tax report reads that list, so it still counts the row.
  - `lib/bankroll-reports.js` leaves `started_at` out of a cash fact when `time_known = 0`.
  - Account deletion removes the standing tree (exclusions, stakes, agreements) before the
    backers, and `session_extras`, `money_locations`, `money_settings`, `money_import_runs`. It
    leaves `backer_events` and `backer_event_revisions` alone.
- **Tests.** `npm run test:standing` (58 cases: the 14 ported ones, windows, the overlap ask,
  exclusions, rounding, the 10,000-pair sweep, `formatOf` row by row) and `npm run test:money-merge`
  (the migration against the real server on a live-like database, then `test:standing`). The
  existing suites gained cases in `test/account-delete.test.js`, `test/bankroll-ledger.test.js`,
  `test/bankroll-reports.test.js`, `test/ledger-source-transactions.test.js` and three
  `vite-app` test files.
- **Checked against a real older database.** Besides the live-like database `test:money-merge`
  builds, the migration was run by hand on a file written by `origin/master`'s own server (not
  committed). Booting master's code and booting the new code on copies of that one file left 39
  of 40 tables identical in every pre-existing column. The 40th, `_applied_migrations`, gained one
  row, `money-merge-2026-10`. A second boot applied nothing.

**Where it differs from the spec, and why**
1. **`formatOf`.** Rewritten for Q8 (one key per game). Also: the mixes are evaluated first,
   because the spec's `plo/nlh` pattern could not be reached with Mixed last; the 2-7 games come
   before NLH, because "NL 2-7 Single Draw" carries `nl`; the hi-lo marker `8` does not match the
   front of a stake ("PLO 8/16"); limit hold'em is `other`.
2. **`time_known` in reports.** The spec says the fact's `hour` is set to null. For a cash fact
   `hour` is already always null: the client derives the hour from `started_at`
   (`bankroll-filters.js` `prepareFacts`). So the fact's `started_at` is what is nulled. `hours`
   (the length) is unchanged.
3. **More of `backers.ts` ported than §6.4 names.** The 14 cases include four for
   `sessionGameLabel`, `deliveryChannels` and `newToken`, so those are ported. `deliveryChannels`
   follows §4.2 (an opt-in flag and an address). `newToken` draws without modulo bias.
4. **Readers and `resultCuts`.** §6.4's test list names "the overlap rule" and "exclusions", which
   need something to test, so the decision list of §6.5 exists as a pure function with three
   SELECT-only readers. They post nothing and have no caller yet.
5. **`valid_to` is inclusive**, like `effective_to` (§4.1 left it unsaid). A windowed stake needs a
   dated result.
6. **`betrivers`** is `bet ?rivers`, so "BetRivers" and "Bet Rivers" both match.
7. **Missing columns are tolerated** in the ledger source, the transactions list and the reports
   (`PRAGMA table_info`), so a database that has not run the migration still works. A failed
   migration does not take the Expenses list down.
8. **`notified_at`** is backfilled with the event's own `ts`; the spec says only "set".

**Not built, on purpose**
- A "Paid outside the roll" switch on `POST`/`PUT /api/bankrolls/transactions` (§17 Q6). Phase 5
  writes the flag directly; the switch for new expenses is a later phase. An edit keeps the flag.
- `bankroll-import.js` `refExists` learning the new tables (Phase 5), and any write to
  `session_extras`, `standing_*` or `backer_event_revisions`.
- A unique index for one fund per user (§5.8 says "enforced in code").

**Traps for later phases**
- **The sweep and the relay (Phase 2).** `server.js:754` inserts relayed events without
  `notified_*`; they default to `source='dashboard'`. See the trap in §6.7. *Handled in Phase 2: the
  relay sets both, and the sweep takes only `source = 'ledger'`.*
- **Where the Q7 answer lives (Phase 7).** `standing_exclusions` can record "series wins". Nothing
  records "standing wins" or "both", so the owner would be asked again.
- **Overlapping stake windows.** `matchStake` breaks a tie by larger pct, so two stakes for the same
  game and channel that are both in force on one day give the larger. Phase 7's "from today" edit
  must close the old stake the day before.

### Phase 2: as built (2026-10-14, branch `feat/money-merge-2`)

Built to the spec and to §1.1. **Nothing a live backer sees changes until a switch is turned on,**
and the switch ships off. Even on, no page changes until a `backers` row owns its token (Phase 5
gives them one), and the parity route lists the pages that would.

**The switch, and how to turn it on**
- **`BACKER_PAGE_SOURCE`**, unset by default (= `console`, the dashboard-era path).
  - `sql` makes `/api/backer/:token/feed` and the weekly digest read the `backers` table and the
    standing agreements first, with `console_records` as the fallback for a token no
    `backers.public_token` owns. `console` (or unset) is today's behaviour.
  - To turn it on: run `GET /api/staking/standing/parity` as the owner; if `differ` is empty or the
    owner accepts what it lists, set `BACKER_PAGE_SOURCE=sql` on the Render service and restart it
    (about a minute). To turn it off, unset it or set it to `console` and restart. The boot log says
    which is live: `[backers] page source: sql|console`.
- **`BACKER_DELIVERY`**, a gate and not a switch for the page. Push, SMS and the Sunday email go out
  only where it is on. Unset, it follows `RENDER` (on in production, off on this box); `1` or `0`
  overrides; an unrecognised value is off. The boot log says `[backers] delivery is ON|OFF (why)`.
  This **does** change one live behaviour on purpose: the local pm2 instance, which ran the digest
  cron, now sends nothing.

**What exists**
- **`lib/backer-surface.js`** (new): the backer surface, out of `server.js` so it is tested against a
  real database.
  - `buildFeed(db, token, {source})`: the feed. `console` is the old route's code, moved.
  - `parity(db)`: the feed and the weekly email's recipient computed both ways for every token.
  - `weeklyDigests`, `digestRecipients`, `sendWeeklyDigests`: the Sunday email, by either source.
  - `deliveryDecision`/`deliveryOn`, `pageSource`: the two settings above.
  - `rotateBackerToken(db, old, new)`: the real function (it used to live in `server.js` and be
    mirrored in a script). `rotateBackerLink(db, {userId, backerId})`: "New link".
  - `sweep(db, {...})` and `shareMessages`: the delivery sweep (dormant).
- **`lib/staking/standing-routes.js`** (new): `GET /api/staking/standing/parity` (owner only) and
  `POST /api/staking/standing/backers/:backerId/rotate-link`, mounted in `server.js` under the
  `/api/staking` admin gate.
- **`server.js`**: the feed route calls `buildFeed`; `sendBackerPush` and `sendBackerSms` check the
  gate (so no caller can skip it); the notify relay records the delivery columns; `rotateBackerToken`
  is a one-line call into the library (the roster sync still uses it); a one-minute cron runs the
  sweep, scheduled only where delivery is on; the digest goes through `sendWeeklyDigests`; a new
  migration, `backer-tokens-audit-2026-10`, logs the legacy link count.
- **Tests** (`npm run test:backers` runs all three, booting on ports 4540-4549):
  - `test/backer-surface.test.js`: the feed against the **oracle** (`test/helpers/legacy-backer-surface.js`,
    the route and the digest exactly as `origin/master` 4a19a4b had them), byte for byte on a
    dashboard-era database with the awkward cases; the SQL path for the three kinds of §7.1; name
    precedence; stake windows; the parity engine; the digest; the gate; the sweep.
  - `test/backer-rotation.test.js` (replaces `scripts/test-backer-rotation.mjs`): the real function
    against the real schema.
  - `test/backer-parity.test.js`: the real server over HTTP, switch off and on, the parity route, the
    relay, "New link", the boot log.
  - Also checked by hand, not committed: `origin/master`'s own `server.js` and this branch's booted on
    two copies of one seeded database returned byte-identical feeds for every token.

**Where it differs from the spec, and why**
1. **The switch.** The spec has no named switch (§13 step 1: "the feed reads SQL then
   `console_records`, so it is unchanged"). Shipping that literally would run new code on the live
   page the day it deploys. `BACKER_PAGE_SOURCE` keeps the old code path the default, so the dormant
   ship is the old behaviour by construction, and the flip is a deliberate act after parity.
2. **The sweep's test is `notified_at IS NULL`, not `notified_share_cents IS NOT share_cents`, and
   it takes only `source = 'ledger'`.** §6.7's test would re-deliver every correction, which §1.1 Q2
   forbids. A whitelist ('ledger') rather than "not 'dashboard'" so a source added later is not
   delivered by default. It also requires `money_settings.posting = 'on'`, so it is idle until
   Phase 7 turns posting on. Corrections after delivery change `share_cents` and nothing else.
3. **The relay trap is closed twice.** The relay now inserts `source = 'dashboard'` and
   `notified_share_cents`/`notified_at` = its own share and time (it delivers inline), and the sweep
   never takes a non-'ledger' row. Without the columns (a database whose migration failed) the relay
   uses its old insert. A rollback to the old code leaves rows with `notified_*` NULL; the sweep still
   skips them.
4. **The `backer_tokens` count is a separate migration** (`backer-tokens-audit-2026-10`), not a line
   in `money-merge-2026-10`, because that migration has already run on production. The parity route
   reports the same count as `legacyBackerTokens`.
5. **"New link" also moves the roster record in `console_records`.** §7.5 lists the tables but the
   roster record is the fallback the page reads for any token no `backers` row owns; left on the old
   token it would keep the old link serving a name, stakes and opening after the owner killed it. Its
   `updated_at` moves forward so the roster seam's last-write-wins guard does not rotate the link back.
   See the first trap below.
6. **Rotation uses a savepoint, not `BEGIN`/`COMMIT`**, so it nests inside a caller's transaction
   and a failure rolls back only itself. `tokenInUse` checks all five tables.
7. **The parity answer has more than the spec's shape.** `{tokens, identical, differ}` plus
   `source`, `sqlBacked`, `fallback`, `legacyBackerTokens`, and each `differ` entry carries `name`,
   `fields` (the feed's fields, and `digest` when the weekly email would go somewhere different) and
   `detail` (both sides of every scalar). The owner needs to see which side is right. It still holds
   no token and no address (`sends to a different address` is a phrase, not an address). A throwing
   feed is a `differ` entry with `fields: ['error']`.
8. **An ended agreement shows no stakes line** (the literal "stakes in force today"). A §7.1
   kind-2 backer (deleted in the dashboard, still live on this app's roster) imported as `ended`
   would lose the stakes line the page shows today. The parity route lists exactly these, so Phase 5
   can decide whether its default should change. Its opening still counts.
9. **The weekly email, by source.** `sql` takes a `backers` row only with `notify_email`, an address
   and an **active** standing agreement (§7.7: an ended agreement sends no digest), and a `backers`
   row decides for its own token; the rest come from the roster. It sends once per token (the old
   code emailed twice if two roster records shared a token).
10. **`sendBackerSms` answers `'off'` and a relayed result carries `delivery: 'off'`** when the gate
    is closed, so the dashboard's relay client is told rather than shown `unconfigured`.

**Not built, on purpose**
- Revoke link (§7.7), the standing agreements' own routes, and any write to `standing_*`: Phases 7-8.
- Anything that **creates** a `source = 'ledger'` event: that is the Notify action (Phase 7). The sweep
  has no input until then.
- A UI. Nothing in `vite-app` changed.

**Traps for later phases**
- **The roster seam can rotate a link back.** Until seam 3 retires, the dashboard owns the roster. If
  the owner replaces a link with "New link" here, the next time that backer is edited in the dashboard
  its record arrives with the old token and `syncBackerRoster` rotates the history back to it.
  Until Phase 7 stands the roster sync down, replace a leaked link in the dashboard; this app follows.
- **Event ids embed the token** (`<token>:<session>`, `<token>:te:<id>`). A rotation re-keys `token`
  columns and leaves `backer_events.id` and `backer_event_revisions.event_id` alone, so a retired
  token stays inside them. Harmless while ids are not shown to anyone (the public feed omits them),
  but Phase 7's `GET /:id/events` and the owner API must not return `id`.
- **Flipping to `sql` changes what the weekly email does** for any backer the parity route lists with
  `digest`, as well as the page. Read `differ` for both.

### Phase 3: as built (2026-10-14, branch `feat/money-merge-3`)

Built to §10 (rewritten as built), the owner's Q11 and the lead's brief, which added `swap` and
`crossbook` (§10 had left them out of scope). Not merged, not deployed.

**What exists**
- **`lib/staking/settlement.js`** (new): `computeEntry` (one agreement, pure), `computeSheet` (a
  series: stored rows once settled, computed otherwise), `parseInputs` and `entriesMeta` (the settle
  body), `settleSeries`, `reopenSeries`, `lastMakeupClosing`, `setPaid` (paid → the ledger),
  `resolveRules` and `DEFAULT_RULES` (§10's rule table), and `migrate`.
- **`lib/staking/settlement-routes.js`** (new): `GET /settlement`, `POST /settlement/preview` (new),
  `POST /settle`, `PUT /settlements/:id/paid`, mounted from `server.js` where the old handlers were,
  under the `/api/staking` admin gate.
- **Migration `staking-settlement-2026-10`** (in `lib/staking/settlement.js`, registered after
  `backer-tokens-audit-2026-10`): `backer_settlements.snapshot`; `agreement_id` on rows the old code
  wrote, where that backer has exactly one agreement in the series; makeup moved to
  opening/closing (§10 item 6); a unique index on `backer_settlements(agreement_id)` and on
  `bankroll_adjustments(user_id, settlement_ref)`. One savepoint, idempotent, logs counts only:
  `Staking settlement: N settlement row(s) from before (L linked to their agreement, U left
  unlinked …); makeup agreements moved to opening/closing: a unsettled, b settled`.
- **`server.js`**: the rules read once at boot from `STAKING_SETTLEMENT_RULES` and logged
  (`[staking] settlement rules: …`); `bankrollId` on series create and update; a series cannot be
  marked settled by a status flip (400: Finalize does it), a settled series keeps its currency (409),
  and reopening one is refused while a payment is marked and otherwise drops its stored rows; a new
  makeup agreement writes `makeup_opening` (given, or the backer's last settled closing) and the
  update route takes `makeupOpening`; the legacy `/api/backer/:token` reads its own agreement's
  settlement row.
- **The panel** (`StakingView.jsx` `StakingSettlementView`, view logic in
  `vite-app/src/utils/staking-settlement.js`): per agreement the type line, the figures (piece,
  markup in it, prepaid, share of cashes, refund or unpaid piece, budget left, makeup in and out,
  mine/theirs for a swap or crossbook, the adjustment and its note), and the headline "You pay Sam
  $490" / "Sam pays you $120" / "Nothing to pay". While open: inputs for Prepaid (placeholder: the
  default), Adjustment and Why, or the other player's result on a swap or crossbook, previewed by
  the server as they are typed; Finalize, off until every swap and crossbook has its figure. Once
  settled: the Paid toggle, the ledger line ("Paid · 2026-07-02 · Main −$300"), and an amount field
  when the bankroll's currency differs. A totals line; Finalize sits above the 1099 summary.
- **Tests**: `npm run test:staking-settlement` (`test/staking-settlement.test.js`, 39 cases, 17 pure
  and 22 through the real server on ports 4570-4579; then
  `vite-app/src/utils/__tests__/staking-settlement.test.mjs`, 11). `test/helpers/scratch-server.js`
  takes a port range (`{ ports }`), default unchanged.
- **Guards**: `check-control-centring.mjs` views `staking-settlement-open` and
  `staking-settlement-settled`, and a staking settlement pass in `check-text-clipping.mjs`, both
  finding series named "Guard Open" / "Guard Settled". `scripts/seed-staking-demo.js <scratch.db>`
  seeds them (every type, a refund, an in-progress event, a settled series with one payment booked);
  it refuses `poker-tournaments.db`.

**Where it differs from the spec, and why**
1. **Names and shape.** `computeSheet`/`computeEntry`, not `computeSettlementSheet`. Entries are
   camelCase (`id`, `isPaid`, `paidAt`, `settledAt`, `ledger`), which the panel reads; the spec said
   `is_paid`. The raw row is still what the legacy `/api/backer/:token` returns.
2. **Prepaid's default includes the events not played.** The spec said "default `prepaid` to the
   computed `investment`". `investment` counts only events played, so that default could never
   refund an unplayed event, which the spec's own Q11 bullet requires. Built: the price of every
   piece sold (`investment + unplayed`), and the owner lowers it for a backer who did not pay.
3. **Budget cap.** The spec clamped the investment and kept the same formula. That would leave the
   backer the return of events their budget never paid for. Built: the backer's share stops when the
   cap is spent (events in date and start-time order, the crossing event pro rata), and prepaid
   defaults to the cap, so the unused budget comes back through the formula.
4. **Profit share is the series' net**, not "positive nets only, as now" (per event), which pays a
   profit share on a series that made no profit. The old way is rule `profitShareBasis: 'event'`.
5. **Swap and crossbook are built** (the brief), with the other player's result typed at
   settlement and kept in the snapshot. Crossbook is built as a bet (the worse result pays), which is
   the **opposite direction** to the old code's reading; rule `crossbookMode: 'swap'` restores it.
6. **The rules are switchable** (`STAKING_SETTLEMENT_RULES`), the brief's "keep it switchable".
7. **A preview route** (`POST /settlement/preview`), so the panel shows the server's figures for the
   typed inputs and never computes money itself.
8. **A second migration and a snapshot column.** `money-merge-2026-10` has already run on production,
   so Phase 3's backfill is its own migration. The snapshot is what lets a settled sheet be shown
   exactly as settled (events, lines, rules) without recomputing.
9. **Paid is idempotent and unique.** A request that does not change the state writes nothing, and the
   unique index on `(user_id, settlement_ref)` makes a second row impossible. The ledger is whole
   units: `round(amountOwed)`, the exact figure in the note.
10. **Another currency needs the amount that moved** (409 `needsAmount`), not a conversion at today's
    rate: a payment is a fact, not an estimate.
11. **A new makeup agreement opens with the last closing by default** (the spec: "suggests"). No
    screen creates a makeup agreement yet (the form offers three types), so a suggestion would never
    be seen; the create answer returns the figure, and `makeupOpening: 0` overrides it.
12. **An event-level markup override beats a tier** (the old code ignored it for `tiered_markup`).
13. **An inactive agreement with no events is left off the sheet**, so a budget backer whose deal was
    switched off is not refunded a budget they may never have sent.
14. **Reopening and status.** The spec says nothing about `PUT /series` with a status: a bare flip to
    `settled` would show an empty settled sheet, and reopening must not orphan a booked payment.

**Not built, on purpose**
- A bankroll picker on the series form (the API takes `bankrollId`; until then every series posts to
  Main), and makeup / budget / swap / crossbook in the Add Agreement form (it offers pay-per-play,
  flat package and profit share, as before).
- `GET /api/staking/backers/summary` still adds up unsettled series with the old per-event arithmetic
  for its totals; its settled totals read the new rows.
- Booking the up-front receipt (§17 Q22).
- Rewriting rows settled before Phase 3: they keep their stored figures, flagged `legacy` on the
  sheet (§17 Q23).

**Traps for later phases**
- **Legacy rows.** A row the old code settled has the old markup sign in `amount_owed`, and a backer
  with two agreements in one series has one row with `agreement_id` NULL (the migration counts them).
  It is shown, and paid, as stored.
- **Changing a rule changes every open sheet**, never a settled one. Say so to the owner before
  setting `STAKING_SETTLEMENT_RULES`.
- **Deleting a series** removes its settlement rows and leaves their ledger rows (money that moved).
- **The Phase 1 label.** The `settlement` kind is labelled "Paid to backers" (`lib/ledger-sources/adjustments.js`,
  `Bankrolls.jsx`), which reads wrongly on money received from a backer; the note says "received
  from" (§17 Q24).
- **Guard failures in the staking views that were there before** (seen now because the seed gives
  those views data). `check-control-centring.mjs --only staking` on this branch: 15 of 142 at
  402x874 and 16 of 176 at 1440x900; on `eb51435`'s code with the same seed: 16 and 17, the one
  more being Finalize. What remains: the ACTIVE/SETTLED badge
  and the ✎ button in the series header and the list (whole-g width), the backer summary cards (not
  whole r), Edit/✕ on a backer row, and on desktop the AGREEMENTS segment's label (dx). Phase 3 fixed
  the one in its own panel (Finalize, off by 0.24r under the 1099 summary's border).
- **Both this branch and `feat/backers-view` edit** `package.json`, both guard scripts and this spec.

### Phase 4: as built (2026-10-14, dashboard repo `wsop-console`, branch `feat/money-export`)

Built to §8.1 and the lead's brief. **Dashboard code only; nothing in this repo changed and nothing
here calls it yet** (Phase 5 does). The route is closed until the owner sets `LEDGER_TOKEN`. Not
pushed, not deployed, no Render env set by the build.

**What exists** (WC, all under `server/`)
- **`lib/shared-token.js`** (new): the roster's check, generalised. `checkSharedToken(authorization,
  name, env)` returns `{ok, via: 'current'|'previous'|null}`; `sharedTokenStatus(name, env)` says
  whether the door can open and why not; plus `sharedTokenValues`, `bearerToken` and
  `makeRateLimitedLog`. `lib/roster-token.js` is now a thin wrapper over it with the same exports, so
  the roster's own 175 assertions pass unchanged. `lib/dashboard-token.js` is untouched.
- **`lib/money-export.js`** (new): `mount(app, {getDb})` registers the route; `buildExport(db,
  {since, now})` is the pure reader; `payloadHash`, `parseSince`, `ledgerTokenStatus`,
  `checkLedgerToken`, `secretInUrl`.
- **`server.js`**: one `moneyExport.mount(app, { getDb })` after the roster routes, before the
  `/console` ham gate, and the boot log lines. **`render.yaml`** declares `LEDGER_TOKEN`
  (`sync: false`). **`CLAUDE.md`** gains seam 4 and the env entry.
- **Tests**: `money-export.test.js` (129) and `money-export-http.test.js` (267), in the `npm test`
  chain, which is now 1057 assertions (it was 661). The HTTP suite boots the real server eight times:
  configured with a rotation in progress; `LEDGER_TOKEN` unset; too short; 31 characters; 32 characters;
  equal to `DASHBOARD_TOKEN`; equal to `ROSTER_TOKEN`; and a configured one over a 20,000-record
  database (about 9 MB). Three deliberate breakages (the URL guard off, the header logged, the delta
  `>=`) each failed the suite.

**The request**

```
GET https://dashboard.futurega.me/api/money-export
GET https://dashboard.futurega.me/api/money-export?since=<updated_at in ms>
Authorization: Bearer <LEDGER_TOKEN>
```

The token is only ever in the header. `since` is whole milliseconds, up to 15 digits. A trailing slash
is the same route.

**The response**, `200`, `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`, no
`ETag`, a `Content-Length`. Made-up values:

```json
{
  "app": "wsop-console",
  "version": 1,
  "exportedAt": "2026-10-20T15:00:00.000Z",
  "mode": "full",
  "since": null,
  "cursor": 1760000123456,
  "count": 3,
  "deleted": 1,
  "counts": { "sessions": 2, "adjustments": 0, "expenses": 0, "backers": 0, "settings": 1 },
  "localCount": 2,
  "hash": "<64 hex characters>",
  "records": [
    { "store": "sessions", "id": "s1", "data": "{\"id\":\"s1\",\"date\":\"2026-10-01\",\"result\":-100}", "updatedAt": 1760000000000, "deleted": false },
    { "store": "sessions", "id": "s2", "data": null, "updatedAt": 1760000100000, "deleted": true },
    { "store": "settings", "id": "app", "data": "{\"id\":\"app\",\"startingRoll\":40000,\"updatedAt\":1760000000000}", "updatedAt": 1760000000000, "deleted": false }
  ],
  "local": {
    "wsop-admin-taxrate": { "value": 30, "updatedAt": 1760000050000, "deleted": false },
    "wsop-staking":       { "value": [], "updatedAt": 1760000123456, "deleted": false }
  }
}
```

| Field | Meaning |
|---|---|
| `mode`, `since` | `full` and `null` with no `since`; `delta` and the number echoed with one |
| `cursor` | the largest `updatedAt` in this answer (records and blobs), or `since` when nothing changed, or `0` for an empty full pull. Pass it as the next `since` (with the margin in trap 1) |
| `count` | `records.length`, tombstones included. `deleted` is how many of those are tombstones. `counts` is `count` split by store |
| `localCount` | the number of keys in `local` |
| `hash` | SHA-256, in hex, of the UTF-8 bytes of `JSON.stringify({ records, local })` over exactly the `records` and `local` sent |
| `records[]` | sync-protocol shape, sorted by `store` then `id`. `data` is the stored JSON **string**, verbatim, except `settings` (below). A tombstone has `data: null`, `deleted: true` |
| `local` | `{ value, updatedAt, deleted }` per key, in a fixed order. `value` is the parsed JSON. A deleted key has `value: null, deleted: true`; an unparseable one has `value: null, invalid: true`. **A key with no row is omitted**, so a full pull reads omission as "never set" |

Which data: stores `sessions`, `adjustments`, `expenses`, `backers`, `settings`; blobs
`wsop-staking`, `wsop-balances`, `wsop-notified-sessions`, `wsop-admin-taxrate`. Nothing else leaves:
not Health, Oura, HealthKit, lifts, reviews or the checklist, and not the other synced keys (home
lists, intention, nut shop, presets, admin checklist).

**Errors.** Everything about the credential is `404 {"error":"Not found"}` with `Cache-Control:
no-store`, so the route does not say whether it exists: no header, a wrong or empty bearer, the Basic
scheme, the token in the query string or the path, `DASHBOARD_TOKEN`, `ROSTER_TOKEN`,
`SESSION_LOG_TOKEN`, the ham credential, any method but `GET`, and a closed door. An authenticated
request with a bad `since` (empty, signed, fractional, repeated, non-numeric) is `400
{"error":"since must be …"}`. A read failure is `500 {"error":"export failed"}`.

**How the Phase 5 fetch should use it**
- Send the header, a 15 s timeout (§8.2), and treat anything that is not JSON with `app ===
  'wsop-console'` and `version === 1` as an error. A `404` means the door is closed or the token
  differs between the two services, not "no data".
- Verify before staging: `count === records.length`, the per-store `counts` add up, and
  `crypto.createHash('sha256').update(JSON.stringify({ records: body.records, local: body.local })).digest('hex') === body.hash`.
  JSON.stringify of the parsed body reproduces the server's bytes (V8 both sides, and no object key is integer-like, so key order survives).
- Keep the `cursor` of the last pull a run accepted in `money_import_runs`.
- A tombstone for a record the importer never saw is ignored. A tombstone for one it did is a
  "Deleted in the dashboard" item (§9.5).

**Where it differs from the spec, and why**
1. **The auth check.** §8.1 says "a generalised `checkSharedToken(token, 'LEDGER_TOKEN')` (WC:
   `lib/dashboard-token.js`'s logic)". It is generalised from `lib/roster-token.js` instead, which is
   the pattern the brief names: SHA-256 of both sides (the length does not leak), a 32-character
   minimum, a Bearer-only header, closed when unset. `dashboard-token.js` has a different contract
   (a path token in a 6 to 64 character shape, and the length leak). So the function takes the
   `Authorization` header and the env name, and lives in `lib/shared-token.js`.
2. **`settings` is cut to its money field.** The record becomes `{id, startingRoll, updatedAt}`. The
   dashboard's `Settings` also holds wake time, caffeine cut-off, a Home-module flag
   and the last backup time; §5.5 says none of it is money and none is imported. Everything else in
   every store is verbatim, including a backer's token, phone and email.
3. **`local` holds the four keys §5.6 maps**, not every `SYNCED_LOCAL_KEYS` entry, and an absent key is
   omitted rather than defaulted (§8.1's example showed `[]`, `{}` and `30`). A default would be
   indistinguishable from a real empty list.
4. **More response fields**: `mode`, `since`, `cursor`, `count`, `deleted`, `localCount`, `hash`.
   `counts` stays the per-store split §8.1 drew and now includes tombstones.
5. **Two more ways the door is shut.** (a) `LEDGER_TOKEN` equal to `DASHBOARD_TOKEN` (or its
   `_PREVIOUS`) is closed, because that value is compiled into the iOS builds and reusing it would put
   every backer's phone and email behind a secret anyone can lift out of an app; the boot line says
   so. (b) A request whose URL contains the secret (raw or percent-encoded) is refused even beside a
   valid header, and the log says to rotate it. A `LEDGER_TOKEN` equal to `ROSTER_TOKEN` or
   `SESSION_LOG_TOKEN` still works but warns at boot, because the two can then no longer be revoked
   apart.
6. **Not built, on purpose**: a rate limit (§8.1 asks for none; §11.1's 60 a minute is for the owner
   API) and paging (a 20,000-record, 9 MB body is built in about a quarter of a second,
   far past what one owner's ledger holds).

**The log.** One line per successful pull, counts only:
`[money-export] served 8 records (sessions 3, adjustments 1, expenses 1, backers 2, settings 1; 2 deleted; 4 local) full cursor=2500 hash=<12 hex> 1234B 5ms via=current`
(`delta since=<ms>` replaces `full` on a delta). Three more lines, each at most once an hour or ten
minutes and none with a token or a record: a bearer that did not open the door, a token in a URL, and a
`via=previous` use ("a consumer has not been rotated yet"). The suite asserts that no secret and no
record content appears anywhere in the log, and that no Authorization header value does.

**Traps for later phases**
1. **`updatedAt` is the writing device's clock.** The sync is last-write-wins on client stamps, so a
   phone that edited offline and syncs later delivers a record older than a cursor Phase 5 already
   holds, and a strict `since = cursor` delta misses it. The delta is therefore strict by design and
   Phase 5 must re-pull with a margin: **`since = cursor − 14 days`**, then de-duplicate by `(store,
   id)` and the record's `data`. §9.5 already does that comparison (`source_updated_at`,
   `source_hash`), so an unchanged row costs nothing and produces no review item.
2. **Freeze strands unsynced devices.** Phase 11's frozen sync stores nothing (§13 step 4). Before
   step 4 the owner opens the PWA on every device while online and lets it sync; otherwise a night
   still sitting in a phone's IndexedDB is rejected and never reaches step 5's delta.
3. **`LEDGER_TOKEN` outlives the export.** The owner API (§11.1) uses the same secret. When Phase 13
   removes `/api/money-export`, leave `LEDGER_TOKEN` on both services, unlike `ROSTER_TOKEN` (§2.2
   point 10).
4. **The WSL standby serves the same code.** It must not be given `LEDGER_TOKEN` (nor should the local
   pm2 `ecosystem.config.cjs`); without it the route is closed there, as designed.
5. **The hash covers `records` and `local` only.** `counts`, `count`, `cursor` and `exportedAt` are
   checked separately. `version` is `1`; change it if the shape changes.

**Rollout (owner does 1 to 2; the dashboard deploy is the lead's; nothing below is done yet)**

| # | Step | Where | Safe to stop after |
|---|---|---|---|
| 1 | Generate the secret (below). Never in a chat, a repo or a ticket | the owner's machine | yes |
| 2 | Set **`LEDGER_TOKEN`** to it on the **dashboard** Render service (`futuregame-dashboard`) and on the **futurega.me** Render service | Render env, both services, nowhere else | yes; inert on the old code (this app does not read it until Phase 5) |
| 3 | Merge `feat/money-export` to the dashboard's `main` (push auto-deploys) | dashboard repo | yes; the boot log says `[money-export] GET /api/money-export is open to LEDGER_TOKEN holders`, or says why it is CLOSED |
| 4 | Check the door | the owner's terminal | yes |
| 5 | Phase 5 ships the scheduler's fetch, which sends the header | scheduler | |

Env names: **`LEDGER_TOKEN`** (both services, §11.1), and **`LEDGER_TOKEN_PREVIOUS`** on the dashboard
only during a rotation (set it to the old value, roll the new one onto both services, then unset it;
`via=previous` in the log means the scheduler has not caught up). The scheduler needs no other new env
for this; it already has `DASHBOARD_BASE_URL`. Steps 2 and 3 can swap: a route deployed before its env
is set is simply closed.

Generate the secret (**Mac or PC**, identical; prints 64 hex characters and nothing else):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Check the door with an empty delta (`since` far in the future returns no records, so no ledger lands in
the terminal). Put the secret in the shell's environment first, for that window only.

**Mac:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $LEDGER_TOKEN" "https://dashboard.futurega.me/api/money-export?since=99999999999999"
```

**PC (PowerShell):**
```bash
curl.exe -s -o NUL -w "%{http_code}\n" -H "Authorization: Bearer $env:LEDGER_TOKEN" "https://dashboard.futurega.me/api/money-export?since=99999999999999"
```

Expect `200`. The same command with the header removed must print `404`.

Phases 3, 4 and 10 can run in parallel with anything after Phase 1. Phases 5 and 7 can run in
parallel after Phase 2.

### Backers view (read-only), ahead of Phase 8 (2026-10-14, branch `feat/backers-view`)

The owner manages backers on the dashboard app, and none showed in the futurega.me web app. This
shows them now, from data this app already holds and with no new table. **Read-only: no edit, no
Notify.** Editing stays on the dashboard app until Phase 8 moves it here.

- **Route.** `GET /api/staking/standing/backers` (`lib/staking/standing-routes.js`), under the
  `/api/staking` admin gate and **owner only** (`HAM_OWNER_ID`, as `parity`): another admin gets 403.
  The roster is one person's, and its links are credentials.
- **Data.** `backersView(db)` in `lib/backer-surface.js` takes every live roster record
  (`console_records`, `store = 'backers'`, `deleted = 0`, with a usable token) and builds it through
  `buildFeed(db, token, { source: pageSource() })`. So the running total, sessions, hours, opening,
  stakes line and share list are **exactly what that backer's `/b/` page shows**; nothing is
  recomputed. Ordered by name.
- **Per backer.** `{ id (the roster record's id, not the token), name, stakes, openingCents,
  cumulativeCents, sessions, hours, shares (the last 10: date, game, venue, hours,
  sessionResultCents, pct, shareCents), delivery: { sms, email } (booleans), link }`.
  `link` is `https://futurega.me/b/<token>`, the owner's own credential to copy and open.
- **Never returned.** A phone number, an email address, or a `backer_events.id` (it embeds the token,
  see the Phase 2 traps). Under `BACKER_PAGE_SOURCE=sql`, a token a `backers` row owns takes its
  delivery flags from that row, as the weekly email does.
- **UI.** Bankroll dashboard > Backers (`BankrollBackers.jsx`, `bankroll-backers.css`,
  `utils/bankroll-backers.js`): the Locations card plus an actions row (Copy link, Open page, and
  whether SMS and email are set up); tap a card for its last ten shares.
- **Tests.** `test/backers-view.test.js` (in `npm run test:backers`): shape, the gate (401, 403 for a
  user and for another admin), no number, address or event id in the body, and every field equal to
  `/api/backer/:token/feed` for the same token under both settings of the switch;
  `vite-app/src/utils/__tests__/bankroll-backers.test.mjs`. Guard views: `bankroll-backers*` in
  `scripts/check-control-centring.mjs`, the `bankroll-backers` pass in `scripts/check-text-clipping.mjs`.

---

## 16. Test plan per phase

All server tests boot `server.js` on a scratch port with a scratch `DB_PATH` and a stubbed
`./solver` (`npm run test:auth-limit` is the pattern). Fixtures are made up: no real backer, token,
amount or `.db` copy, ever.

| Phase | New / changed scripts | What they prove |
|---|---|---|
| 1 | `test:standing` (new: `node --test test/standing.test.js test/classify.test.js`), `test:money-merge` (new: the migration against the real server, then `test:standing`), `test:transactions`, `test:bankroll-reports`, `test:tax-report`, `test:account` | the 14 ported `backers.test.ts` cases; dated stakes; rounding parity sweep (≤ 1 cent over 10,000 pairs); the `formatOf` table row by row (one key per game, Q8), PLO8 before PLO, Big O before PLO8, the mixes first, 2-7 before NLH; the overlap returning both matches with `ask` (Q7); `correction`/`settlement` move balances and never profit (summary `moved` vs `results`); `affects_balance 0` rows absent from the ledger and present in the Expenses list and tax report; `equipment`/`fees` deducted at 100%; `time_known 0` facts have `hour: null`; account deletion clears every new table and leaves `backer_events` |
| 2 | `test:backers` (new: `test:backer-surface`, `test:backer-rotation` on the real function, `test:backer-parity` over HTTP), `test:backer-page`, `test:gates`, `test:roster` | feed identical from SQL and from `console_records` for seeded backers of all three §7.1 kinds; rename shows the SQL name; rotation moves all five places or none and refuses a token in use; deliveries skipped without `BACKER_DELIVERY`/`RENDER`; parity route `differ: []` and leaks no token; digest recipients from `notify_email` |
| 3 | `test:staking-settlement` (new: 39 server cases on ports 4570-4579, then 11 `node --test` cases on the panel's helpers); the guards' new staking settlement views (`scripts/seed-staking-demo.js`) | §10 point 8 |
| 4 | WC `server/test/money-export.test.js` (129, unit) and `server/test/money-export-http.test.js` (267, boots the real server eight times), both in `npm test` (1057 in all) | 404 without, with a wrong and with a path or query token (even beside a valid header); previous token accepted; unset, under 32 characters and equal to `DASHBOARD_TOKEN` closed; `DASHBOARD_TOKEN`, `ROSTER_TOKEN`, `SESSION_LOG_TOKEN` and the ham credential refused; deleted rows and the four local keys present; a delta with tombstones and a cursor; hash and count verified; a 20,000-record database; nothing logged but counts |
| 5 | `test:money-import` (new; a stub dashboard on a second scratch port serves fixtures) | every §5 mapping row; sign-follows-amount; transfer legs and `transfer_id`; fund results in the fund; chat ids verbatim; Personal `stable_id` deterministic; rounding correction and remainder; opening formula with prior deposits and pre-opening results; reconciliation equals a `computeBankroll` port on the fixture; scoring classes on crafted pairs (late-night ±1 day, alias rooms, unequal nets); one-to-one pairing; commit 409 with unanswered pairs; `same-keep`/`same-take`; re-fetch imports nothing; delta changed/deleted/conflict; undo removes exactly the run's rows; another admin gets 403; a non-JSON upstream is an error |
| 6 | `check:controls`, `check:clipping` (new steps), `vite-app` helper tests for the card model | every control on the grid with its label centred at 402 and 1440; no clipped glyph in a truncated 16g cell; the skipped count is 0 and the seed token is fresh |
| 7 | `test:standing-live` (new) | Notify posts one result (§1.1 Q1: nothing posts on save); each write path in §6.5 revises or voids a posted share and tells nobody (Q2); the overlap `ask` (Q7); live sessions never post; pre-`effective_from` never posts; overlap rule; exclusions; stake correction re-derives with preview; recalc of a dashboard event; drift lists a feed buy-in change and applies on request; posting off writes nothing; the sweep coalesces three edits into one delivery and survives a restart; a void deletes the event and keeps a revision |
| 8 | `check:controls`, `check:clipping` (Standing steps), helper tests | as Phase 6, for the Staking section and the form line |
| 9 | `test:owner-api` (new; ported `session-log` cases) | auth (404/503/previous token/rate limit); `/money` totals equal the ledger summary, `isWsopFund` by bankroll, extras present, live sessions absent; log preview writes nothing; commit writes once; same facts twice update one row; an imported `chat-` row is updated, not duplicated; kind change 409; backer cuts in the preview; deep-link routes open the right view (`vite-app` helper test) |
| 10 | `test:bankrolls` (extended), guards | target and progress from the fund bankroll; locations total and drift; set-aside line |
| 11 | WC `npm test` incl. `native-contract.test.js` run twice more against a stubbed money source (empty and populated), `money-source.test.js`, `money-proxy.test.js`; `app` vitest for the store loader | contract holds with `MONEY_SOURCE=scheduler`; summary roll/fund equal the feed's; cold boot uses the persisted copy; upstream down keeps last good and `freshness.money.ok=false`; frozen sync returns `rejected` and stores nothing; relay 410; MCP forwards preview and commit and refuses when frozen |
| 12 | the runbook's Verify column | — |
| 13 | both full suites; a backer page from each §7.1 source; `/api/backer/:token` (legacy) 404 when `backer_tokens` was empty | nothing still reads `console_records` (grep in the PR) |
| 14 | `test:standing` (payouts) | payout lowers the running total and the bankroll by the same amount; feed `paidCents` |

---

## 17. Owner questions: the defaults, and the owner's answers (2026-10-14)

The owner has answered all fourteen (§1.1). **The last column is final.** The middle column is what
the spec was first written to, kept so a reader can see what changed. Five rows differ: Q1, Q2, Q7,
Q8 and Q11.

| # | Question | Default the spec was written to | Owner's answer (final) |
|---|---|---|---|
| Q1 | Post a backer's share **when a result is saved**, or keep a "Notify" tap? | On save, with the cut shown on the form before saving and a per-result "not staked" switch. | **Differs. Keep a manual Notify tap.** Shares do not post on save; a share posts only when the owner taps Notify for a result. The engines stay pure; the trigger is a later phase. |
| Q2 | When a result is corrected, tell the backer? | Push only ("Corrected: …, was +$Y"), mark it on the page and in the digest; no SMS. | **Differs. Nothing.** The backer's page just updates: no push, no SMS, no mark. |
| Q3 | Opening balance: one computed deposit so the roll at the start of the dashboard's first day equals its starting roll? | **Yes**, shown and editable in the review (§5.8). | Default stands. |
| Q4 | What is "the roll" on the widget and Today? | **Every non-archived bankroll except the WSOP fund** (the dashboard's meaning); a bankroll can be marked "not in the roll". | Default stands. |
| Q5 | WSOP fund target? | **$65,000 by 2027-05-03**, the figure the PWA shows; the 50,000 server default was the drift. | Default stands. |
| Q6 | Imported dashboard expenses: do they lower the roll? | **No**, as in the dashboard (they were never in its roll); they still count in the tax report. New expenses logged here keep today's behaviour (they do lower the balance), with a "Paid outside the roll" switch. | Default stands. |
| Q7 | A backer with a standing stake and a series agreement on the same tournament: both shares? | No: the series agreement wins for that tournament (most specific wins). | **Differs. Ask the owner each time.** The engine returns both matches with an `ask` flag and does not choose. |
| Q8 | Which games count as a backer's "PLO", "PLO8", "Mixed"…? | The §6.3 families: 5- and 6-card PLO as PLO; PLO hi-lo (incl. PLO6 8/b) as PLO8; Big O on its own; HORSE / 8-game / dealer's choice as Mixed. | **Differs. Every game on its own.** The family table is dropped: a stake matches only that exact game, or `all`. PLO5 is not PLO; PLO6 8/b is not PLO8. |
| Q9 | Backers deleted in the dashboard whose pages still work: keep the pages? | **Keep the page and its history; end the agreement** (no new shares, no digest). | Default stands. |
| Q10 | Record payouts to standing backers (so their page's running total drops when paid)? | **Yes, as Phase 14** after cutover; nothing before it depends on it. | Default stands. |
| Q11 | Series settlements: does a backer pay for their piece up front or at settlement? | At settlement (netted), with an optional "prepaid" figure per agreement; the markup is paid by the backer (fixes the sign bug, §10). | **Differs. Up front, before the event.** Settlement is Phase 3; see "Q11 in §10": `prepaid` becomes the normal case and includes the markup. |
| Q12 | A cash session's share: of the net after tips and session expenses, or cash-out minus buy-in? | **After tips and expenses**: the result the bankroll records. Imported sessions have neither, so history is unaffected. | Default stands. |
| Q13 | Do Trends, Review and Settings stay on the dashboard? | **Yes**; they read the money feed. The tab bar gains Money ↗. | Default stands. |
| Q14 | Only if `backer_tokens` has rows: keep those legacy links? | **Keep them read-only, stop minting**, and decide per link. | Default stands. |

### 17.1 Open questions from Phase 3 (settlement), for the owner

Phase 3 built each of these to the standard staking-market meaning (the "Built" column), and each is
a switch (`STAKING_SETTLEMENT_RULES`, §10 item 5) or a per-agreement figure, so an answer is a
setting, not a rebuild. None changes a series already settled.

| # | Question | Built (the default) | The other answer, and how to get it |
|---|---|---|---|
| Q15 | **Crossbook: a bet or a swap?** | **A bet on who does better**, on net results: the worse result pays its percentage of the difference (10% each, me +4,000, them −500: they pay me $450). The old code read it as a swap, which pays **the other way**. | A swap: `crossbookMode: 'swap'`. Cashes instead of net results: `crossbookBasis: 'cash'` |
| Q16 | **Swap: of winnings or of net results?** | **Winnings** (cashes after tips); no buy-in changes hands. | Net results, buy-ins shared: `swapBasis: 'net'` |
| Q17 | **Profit share: of the series' net, or of each winning event?** | **The series' net**, never below 0 (a −1,000 and a +1,400 at 10% pay $40). The old code paid each winning event ($140). | `profitShareBasis: 'event'` |
| Q18 | **Budget cap: is the whole budget sent up front, and how is the event that crosses it shared?** | **The cap is prepaid**, so the unused part is refunded; the crossing event is shared **pro rata** (200 left of a 500 piece = 40% of it). | Only what was used: `prepaid: {"budget_capped": "used"}`. Back an event only if it fits whole: `budgetCrossing: 'exclude'` |
| Q19 | **Flat package: is an event not played refunded?** And is a package a fixed price? | **Refunded.** The price is the sum of the logged events' pieces; there is no package-price field. | No refund: `flatPackageUnplayed: 'keep'`. A fixed price needs a field (a later phase) |
| Q20 | **Makeup: do makeup backers pay up front?** | **Yes** (Q11), so a fully prepaid makeup agreement can never carry a loss and settles like pay-per-play; makeup arises only when the owner lowers `prepaid`. | A running account, nothing up front, losses carried (the dashboard's standing backers work this way): `prepaid: {"makeup": "none"}` |
| Q21 | **Open commitment: paid up front for every bullet?** | **Yes**, the price of every bullet logged. | A deposit topped up at settlement: type the deposit as Prepaid, or `prepaid: {"open_commitment": "none"}` for a netted deal |
| Q22 | **Book the up-front payment in the ledger?** (open since §10 item 5) | **No.** Only the final payment is booked (item 7). | An `income` transaction (category `staking`) or a `settlement` adjustment when a backer pays; needs a "received" action |
| Q23 | **Rows settled before Phase 3** keep their stored figures, the old markup sign included. Recompute them? | **Kept as stored**, flagged `legacy` on the sheet; the migration's log line counts them. | Reopen the series (unmark its payments first) and Finalize again |
| Q24 | **The ledger label.** The `settlement` kind reads "Paid to backers" (Phase 1) even when a backer paid the player. | The note says "paid to" or "received from"; the label is unchanged. | Rename it "Backer settlement" in `lib/ledger-sources/adjustments.js` and `Bankrolls.jsx` (two Phase 1 tests assert the label) |
| Q25 | **Events still marked pending, bought in or playing at settlement** | **Counted as played** (as before) and named on the card ("1 event still marked in progress"). | Count them as not played (refunded): a code change, not a rule |

---

## 18. Left alone, on purpose

- **Not touched:**
  - ~~the `swap` and `crossbook` settlement guesses~~ (built in Phase 3, at the lead's brief: §10
    item 5, with the open choices in §17.1 Q15 and Q16);
  - `swap_suggestions` not saving (`server.js:10246-10338`);
  - the missing rate limit on `/api/backer/*`;
  - historical FX rates (handoff decision 11);
  - the Shares sold row (handoff, 2026-10-13).
  Each is its own question or job.
- **Not built:** a second live-session system. The dashboard's live mode stays for its clock and
  stop-loss and logs here at the end. This app's live cash sessions stay as they are.
- **Not covered by the import:** receipts, which neither side has.
- **Not built: an undo past Phase 13.** Rollback after retire is the tagged redeploy.
