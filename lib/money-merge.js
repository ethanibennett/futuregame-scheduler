'use strict';
/*
 * Schema for the bankroll merge (docs/bankroll-merge.md §4): futurega.me becomes the one money
 * store. Run from server.js dataMigrations as 'money-merge-2026-10', after
 * 'bankroll-transactions-2026-10'.
 *
 * SAFE ON THE LIVE DATABASE. Additive only: new tables, new nullable-or-defaulted columns, new
 * indexes. No existing column changes meaning and no existing row is rewritten, with ONE exception
 * the spec names (§4.2): backer_events rows that exist when the columns are added are the
 * dashboard's (`source` takes its 'dashboard' default) and were already delivered, so
 * notified_share_cents / notified_at are set from the row's own share and ts.
 *
 * IDEMPOTENT. Every table is CREATE ... IF NOT EXISTS, every index IF NOT EXISTS, every column is
 * added only when PRAGMA table_info does not list it. The whole migration runs inside one
 * SAVEPOINT, so a failure half way leaves the database exactly as it was (the dataMigrations
 * runner swallows a throw and retries at the next boot; without the savepoint the half-applied
 * state would be saved by the next migration's saveDatabase()).
 *
 * The tables the ALTERs reach (backers, backer_events, backer_agreements, backer_settlements,
 * staking_series, bankrolls, bankroll_adjustments, bankroll_transactions, bankroll_import_keys,
 * cash_sessions) are all created by earlier dataMigrations, so on a fresh database this finds them.
 *
 * Owner answers of 2026-10-14 that touch this schema (docs/bankroll-merge.md §1): shares are posted
 * by a manual Notify tap (not on save) and a correction tells the backer nothing. The columns the
 * spec drew for an automatic delivery sweep (backer_events.revised_at / notified_*) are still
 * added, because they are additive and a later phase may use them; nothing in Phase 1 reads them.
 */

const MIGRATION_NAME = 'money-merge-2026-10';

// ── §4.1 New tables ──────────────────────────────────────────────────────────────────────
// Each entry: { name, ddl: [statements] } — the table first, then its indexes.
const TABLES = [
  {
    name: 'standing_agreements',
    // Standing % agreements (the dashboard's model). One ACTIVE per (player, backer).
    ddl: [
      `CREATE TABLE IF NOT EXISTS standing_agreements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,              -- the player
        backer_id INTEGER NOT NULL,            -- backers.id
        effective_from TEXT NOT NULL,          -- YYYY-MM-DD: results dated before never derive
        effective_to TEXT,                     -- inclusive last day; NULL = open
        status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'ended'
        opening_cents INTEGER NOT NULL DEFAULT 0, -- signed, + = player owes backer (dashboard \`opening\`)
        opening_note TEXT,
        created_at TEXT NOT NULL, updated_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (backer_id) REFERENCES backers(id))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_standing_active ON standing_agreements(user_id, backer_id) WHERE status = 'active'`,
    ],
  },
  {
    name: 'standing_stakes',
    // Dated stakes. An edit "from today" closes a row and opens a new one; a "correction" edits in
    // place. valid_to is the INCLUSIVE last day, like standing_agreements.effective_to.
    // format is an exact game key (lib/staking/classify.js GAMES) or 'all'; the owner's 2026-10-14
    // answer (Q8) is that a stake matches only that game, so the set is open-ended.
    ddl: [
      `CREATE TABLE IF NOT EXISTS standing_stakes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agreement_id INTEGER NOT NULL,
        format TEXT NOT NULL,                  -- 'all' | an exact game key (PLO, PLO8, NLH, ...)
        channel TEXT NOT NULL,                 -- 'any' | 'live' | 'online'
        pct REAL NOT NULL,                     -- 0 < pct <= 100
        valid_from TEXT NOT NULL, valid_to TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (agreement_id) REFERENCES standing_agreements(id))`,
    ],
  },
  {
    name: 'standing_exclusions',
    // Per (backer agreement, result) opt-out: "not staked" / "exclude from backers".
    ddl: [
      `CREATE TABLE IF NOT EXISTS standing_exclusions (
        agreement_id INTEGER NOT NULL, ref_table TEXT NOT NULL, ref_id INTEGER NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY (agreement_id, ref_table, ref_id))`,
    ],
  },
  {
    name: 'session_extras',
    // What a result knows beyond money: the dashboard's session fields that have no column here.
    ddl: [
      `CREATE TABLE IF NOT EXISTS session_extras (
        user_id INTEGER NOT NULL,
        ref_table TEXT NOT NULL,               -- 'tracking_entries' | 'cash_sessions'
        ref_id INTEGER NOT NULL,
        format TEXT, channel TEXT,             -- explicit classification; NULL = derive (classify.js)
        hours REAL,                            -- tournaments only (cash hours come from started/ended)
        hands INTEGER, mood_rating INTEGER, tilt_note TEXT, journal TEXT,
        tags TEXT,                             -- JSON, tournaments only (cash_sessions has its own)
        origin TEXT, origin_id TEXT,           -- 'dashboard' | 'chat' | 'app', and the source id
        updated_at TEXT NOT NULL,
        PRIMARY KEY (ref_table, ref_id))`,
      `CREATE INDEX IF NOT EXISTS idx_session_extras_user ON session_extras(user_id)`,
    ],
  },
  {
    name: 'backer_event_revisions',
    // Audit trail for every change to a posted share. Kept with backer_events, which account
    // deletion leaves alone on purpose.
    ddl: [
      `CREATE TABLE IF NOT EXISTS backer_event_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL, token TEXT NOT NULL, at INTEGER NOT NULL,
        action TEXT NOT NULL,                  -- 'post' | 'revise' | 'void' | 'recalc' | 'link'
        share_before INTEGER, share_after INTEGER,
        result_before INTEGER, result_after INTEGER,
        pct_before REAL, pct_after REAL,
        cause TEXT,                            -- 'owner-edit' | 'import' | 'recalc' | 'drift' | 'exclude' | 'stake-correction'
        note TEXT)`,
      `CREATE INDEX IF NOT EXISTS idx_ber_token ON backer_event_revisions(token, at)`,
    ],
  },
  {
    name: 'money_locations',
    // "Where's the money" (the dashboard's wsop-balances).
    ddl: [
      `CREATE TABLE IF NOT EXISTS money_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        name TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
        sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`,
    ],
  },
  {
    name: 'money_settings',
    // Owner-level money settings (JSON): { posting, cutover: 'none'|'imported'|'live',
    //   postingSince, defaultBankroll: 'main'|id, taxSetAsidePct }. What `posting` means under the
    //   2026-10-14 answers (a manual Notify tap) is for the phase that builds it.
    ddl: [
      `CREATE TABLE IF NOT EXISTS money_settings (user_id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    ],
  },
  {
    name: 'money_import_runs',
    // Staged pulls. payload holds PII (tokens, phones, emails): cleared 7 days after commit or on discard.
    ddl: [
      `CREATE TABLE IF NOT EXISTS money_import_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        source TEXT NOT NULL,                  -- 'dashboard'
        fetched_at TEXT NOT NULL, payload TEXT, plan TEXT, decisions TEXT,
        status TEXT NOT NULL,                  -- 'staged' | 'committed' | 'discarded' | 'undone'
        committed_at TEXT, summary TEXT)`,
    ],
  },
];

// ── §4.2 New columns ─────────────────────────────────────────────────────────────────────
// { table, column, def } — `def` is what follows "ALTER TABLE <table> ADD COLUMN <column> ".
const COLUMNS = [
  { table: 'backers', column: 'public_token', def: 'TEXT' },
  { table: 'backers', column: 'notify_sms', def: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'backers', column: 'notify_email', def: 'INTEGER NOT NULL DEFAULT 0' },

  { table: 'backer_events', column: 'agreement_id', def: 'INTEGER' },
  { table: 'backer_events', column: 'stake_id', def: 'INTEGER' },
  { table: 'backer_events', column: 'ref_table', def: 'TEXT' },
  { table: 'backer_events', column: 'ref_id', def: 'INTEGER' },
  { table: 'backer_events', column: 'source', def: "TEXT NOT NULL DEFAULT 'dashboard'" },
  { table: 'backer_events', column: 'revised_at', def: 'INTEGER' },
  { table: 'backer_events', column: 'notified_share_cents', def: 'INTEGER' },
  { table: 'backer_events', column: 'notified_at', def: 'INTEGER' },

  { table: 'bankroll_import_keys', column: 'run_id', def: 'INTEGER' },
  { table: 'bankroll_import_keys', column: 'decision', def: 'TEXT' }, // 'imported' | 'same' | 'skipped'
  { table: 'bankroll_import_keys', column: 'source_updated_at', def: 'INTEGER' },
  { table: 'bankroll_import_keys', column: 'source_hash', def: 'TEXT' },

  { table: 'bankrolls', column: 'role', def: 'TEXT' }, // 'fund' or NULL
  { table: 'bankrolls', column: 'in_roll', def: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'bankrolls', column: 'target_amount', def: 'INTEGER' },
  { table: 'bankrolls', column: 'target_date', def: 'TEXT' },

  { table: 'bankroll_adjustments', column: 'settlement_ref', def: 'TEXT' }, // 'bs:<id>' | 'sp:<id>'
  { table: 'bankroll_transactions', column: 'affects_balance', def: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'cash_sessions', column: 'time_known', def: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'staking_series', column: 'bankroll_id', def: 'INTEGER' }, // NULL = Main

  { table: 'backer_settlements', column: 'agreement_id', def: 'INTEGER' },
  { table: 'backer_settlements', column: 'computed_owed', def: 'REAL' },
  { table: 'backer_settlements', column: 'adjustment', def: 'REAL NOT NULL DEFAULT 0' },
  { table: 'backer_settlements', column: 'adjustment_note', def: 'TEXT' },
  { table: 'backer_settlements', column: 'prepaid', def: 'REAL NOT NULL DEFAULT 0' },
  { table: 'backer_settlements', column: 'makeup_opening', def: 'REAL' },
  { table: 'backer_settlements', column: 'makeup_closing', def: 'REAL' },
  { table: 'backer_settlements', column: 'settled_at', def: 'TEXT' },

  { table: 'backer_agreements', column: 'makeup_opening', def: 'REAL' },
];

// Indexes that need a column from COLUMNS, so they are created after it.
const INDEXES = [
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_backers_public_token ON backers(public_token) WHERE public_token IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_backer_events_ref ON backer_events(ref_table, ref_id)',
];

// ── helpers ──────────────────────────────────────────────────────────────────────────────
function hasTable(db, name) {
  const r = db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);
  return !!(r.length && r[0].values.length);
}
function columnNames(db, table) {
  const r = db.exec(`PRAGMA table_info(${table})`);
  return r.length ? r[0].values.map((v) => v[1]) : [];
}
function hasColumn(db, table, column) {
  return columnNames(db, table).includes(column);
}

/**
 * Applies the migration. Returns { tables: [created], columns: ['table.column' added],
 * backfilled: n } — empty arrays and 0 on a second call.
 */
function migrate(db) {
  const added = { tables: [], columns: [], backfilled: 0 };
  db.run('SAVEPOINT money_merge');
  try {
    for (const t of TABLES) {
      const existed = hasTable(db, t.name);
      for (const stmt of t.ddl) db.run(stmt);
      if (!existed) added.tables.push(t.name);
    }
    for (const c of COLUMNS) {
      if (!hasTable(db, c.table)) throw new Error(`money-merge: table ${c.table} does not exist (an earlier migration has not run)`);
      if (hasColumn(db, c.table, c.column)) continue;
      db.run(`ALTER TABLE ${c.table} ADD COLUMN ${c.column} ${c.def}`);
      added.columns.push(`${c.table}.${c.column}`);
    }
    for (const stmt of INDEXES) db.run(stmt);

    // The one existing-row write (§4.2): the dashboard's events were already delivered. Only in the
    // run that added the columns, and only to rows that have never been touched by the new code.
    if (added.columns.includes('backer_events.notified_share_cents')) {
      db.run(`UPDATE backer_events SET notified_share_cents = share_cents, notified_at = ts
              WHERE notified_share_cents IS NULL AND notified_at IS NULL AND source = 'dashboard'`);
      added.backfilled = db.getRowsModified();
    }
    db.run('RELEASE money_merge');
  } catch (e) {
    try { db.run('ROLLBACK TO money_merge'); db.run('RELEASE money_merge'); } catch (_) { /* nothing open */ }
    throw e;
  }
  return added;
}

module.exports = {
  MIGRATION_NAME, TABLES, COLUMNS, INDEXES,
  NEW_TABLES: TABLES.map((t) => t.name),
  migrate, hasTable, hasColumn, columnNames,
};
