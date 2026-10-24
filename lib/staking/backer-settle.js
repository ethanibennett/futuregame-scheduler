'use strict';
/*
 * Settled: both sides confirm that a backer's balance has been paid, and the page goes back to $0
 * (owner, 2026-10-19: "a settled button on the backer page to indicate payment has been sent, and
 * one in the backers section of the app. Reset the page balance to 0 when both sides have confirmed").
 *
 *   backer_page_settlements  one row per settlement, keyed by the page's link (token), so every page can be
 *                       settled, roster-era or SQL-era, with or without a standing agreement:
 *                       amount_cents   the page's balance when the first side pressed (signed as the
 *                                      page shows it: + = the player owes the backer)
 *                       backer_at / owner_at   when each side pressed (NULL = not yet)
 *                       completed_at   both pressed: the balance is settled
 *                       voided_at      withdrawn by both, or the balance moved before the second press
 *   the running total   backerCumulativeCents (lib/backer-surface.js) subtracts every completed
 *                       settlement, as it does a payout, so the page, the Backers view, the weekly email
 *                       and the Standing view all read $0 at once.
 *   the ledger          a completed settlement writes ONE `settlement` adjustment into the player's Main
 *                       bankroll, settlement_ref 'bks:<id>' (money leaving when the player paid, arriving
 *                       when the backer did), the way a payout does ('sp:<id>'). Whole dollars, as the
 *                       ledger keeps them; the page's figure keeps its cents.
 *
 * The handshake. A press carries the balance its side SAW; a different balance now is a 409 with the
 * new figure, so nobody confirms a number they were not shown. The first press opens a settlement
 * for that balance; the other side's press completes it. If the balance moves while one side has
 * pressed (a new session's share), that half-confirmed settlement is void and both press again: a
 * page never reads $0 over a share nobody settled. Either side can withdraw its press until both have.
 *
 * A PARTIAL PAYMENT (owner, 2026-10-23: "partial settlement, for when we hit Zelle limits"; 2026-10-24:
 * "both sides need to be able to enter partial payments"): kind 'part'. Either side may open one at
 * ANY time the running total is not $0, this week's shares included, for an amount up to the whole
 * running total (settleCents, the same way as the balance). The other side confirms THAT amount; the
 * running total comes down by it. balance_cents keeps the running total it was taken from, so a share
 * landing in between still voids it. A full Settled (kind 'due', or NULL on older rows) is unchanged:
 * what earlier weeks owe.
 *
 * week_cents: the part of a completed payment that went past what earlier weeks owed, into the week in
 * progress. dueCents adds back the week_cents of payments completed this week, so a mid-week payment
 * lowers "this week" rather than turning "from last week" into a debt the other way.
 */
const { hasTable, hasColumn } = require('../money-merge');

// Bumped for each added column (2026-10-23 balance_cents; 2026-10-24 kind, week_cents). migrate() is
// idempotent, so a bump just makes it run once more on a DB that has the table.
const MIGRATION_NAME = 'backer-page-settlements-2026-10-24';
const SIDES = { backer: 'backer_at', owner: 'owner_at' };

function rowsOf(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const oneRow = (db, sql, params) => rowsOf(db, sql, params)[0] || null;

function migrate(db) {
  db.run('SAVEPOINT backer_page_settlements');
  try {
    db.run(`CREATE TABLE IF NOT EXISTS backer_page_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      backer_at TEXT,
      owner_at TEXT,
      completed_at TEXT,
      voided_at TEXT,
      created_at TEXT NOT NULL)`);
    db.run('CREATE INDEX IF NOT EXISTS idx_backer_page_settlements_token ON backer_page_settlements(token)');
    // Partial settlements (owner, 2026-10-23): amount_cents is what this settlement clears, balance_cents
    // the balance it was a part of when opened (NULL on rows from before = the amount itself).
    if (!hasColumn(db, 'backer_page_settlements', 'balance_cents')) db.run('ALTER TABLE backer_page_settlements ADD COLUMN balance_cents INTEGER');
    // kind 'part' = a partial payment against the running total; 'due' (or NULL) = Settled, what earlier
    // weeks owe. week_cents: the part of a completed payment that went into the week in progress.
    if (!hasColumn(db, 'backer_page_settlements', 'kind')) db.run('ALTER TABLE backer_page_settlements ADD COLUMN kind TEXT');
    if (!hasColumn(db, 'backer_page_settlements', 'week_cents')) db.run('ALTER TABLE backer_page_settlements ADD COLUMN week_cents INTEGER');
    db.run('RELEASE backer_page_settlements');
  } catch (e) {
    try { db.run('ROLLBACK TO backer_page_settlements'); db.run('RELEASE backer_page_settlements'); } catch (_) { /* */ }
    throw e;
  }
}

const ready = (db) => hasTable(db, 'backer_page_settlements');

// ── The settlement week (the page's: utils/backer-page.js nextSettlement / weekStart) ──────────
// Settled clears what EARLIER weeks owe, never the week in progress (owner, 2026-10-20: "Settled
// should settle only the amount from last week; this week rolls on"). A week runs from Sunday 12:00
// in New York; a share belongs to the week its row was recorded in (backer_events.ts, epoch ms).
const SETTLE_TZ = 'America/New_York';
const WEEK_MS = 7 * 24 * 3600e3;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function etParts(ms) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: SETTLE_TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { dow: DOW.indexOf(o.weekday), h: Number(o.hour) % 24, m: Number(o.minute), s: Number(o.second) };
}
/** The Sunday 12:00 in New York that began the current settlement week. */
function weekStartMs(nowMs = Date.now()) {
  const p = etParts(nowMs);
  let since = (((p.dow * 24 + p.h - 12) * 60 + p.m) * 60 + p.s) * 1000;
  if (since < 0) since += WEEK_MS;
  let start = nowMs - (((nowMs % 1000) + 1000) % 1000) - since;
  const q = etParts(start);
  if (q.h !== 12) start += (12 - q.h) * 3600e3;   // a clock change in between: back on noon
  return start;
}
/** Σ week_cents of payments completed since this week began: what this week's payments took off the
 *  week in progress rather than off earlier weeks. */
function weekPaidCents(db, token, nowMs = Date.now()) {
  if (!ready(db) || !hasColumn(db, 'backer_page_settlements', 'week_cents')) return 0;
  const r = oneRow(db, 'SELECT COALESCE(SUM(week_cents), 0) AS c FROM backer_page_settlements WHERE token = ? AND completed_at IS NOT NULL AND completed_at >= ?',
    [token, new Date(weekStartMs(nowMs)).toISOString()]);
  return (r && r.c) || 0;
}
/** What a Settled press settles: the running total less this week's shares, plus what this week's
 *  payments took off this week (cents, signed as the page). */
function dueCents(db, token, cumulativeCents, nowMs = Date.now()) {
  const r = oneRow(db, 'SELECT COALESCE(SUM(share_cents), 0) AS c FROM backer_events WHERE token = ? AND ts >= ?', [token, weekStartMs(nowMs)]);
  return (Number(cumulativeCents) || 0) - ((r && r.c) || 0) + weekPaidCents(db, token, nowMs);
}
/** How much of a payment `amount` comes off what earlier weeks owe (`due`): the overlap when both point
 *  the same way, capped at the due. The rest is the week in progress's. Pure. */
function earlierShare(amount, due) {
  if (!due || !amount || Math.sign(amount) !== Math.sign(due)) return 0;
  return Math.sign(amount) * Math.min(Math.abs(amount), Math.abs(due));
}
const isPart = (o) => o && o.kind === 'part';

/** Σ completed settlements on this link, in cents (0 without the table). */
function settledCentsForToken(db, token) {
  if (!ready(db)) return 0;
  const r = oneRow(db, 'SELECT COALESCE(SUM(amount_cents), 0) AS c FROM backer_page_settlements WHERE token = ? AND completed_at IS NOT NULL', [token]);
  return (r && r.c) || 0;
}

/** The balance an open settlement was taken from (rows from before the column: the amount itself). */
const openBalance = (o) => (o.balance_cents == null ? o.amount_cents : o.balance_cents);
const openRow = (db, token) => oneRow(db,
  'SELECT * FROM backer_page_settlements WHERE token = ? AND completed_at IS NULL AND voided_at IS NULL ORDER BY id DESC LIMIT 1', [token]);

/**
 * What the page and the Backers view show, or null when this link has never been settled (so a page
 * without settlements is byte for byte what it was). { open: { amountCents, balanceCents, kind, backerAt,
 * ownerAt } | null, last: { amountCents, at } | null, settledCents, weekPaidCents? }. An open settlement
 * whose balance is not today's (the running total for a partial payment, the due for Settled) is shown
 * as nothing open: the next press voids it.
 */
function stateFor(db, token, balanceCents, cumulativeCents = balanceCents, nowMs = Date.now()) {
  if (!ready(db)) return null;
  const any = oneRow(db, 'SELECT 1 AS x FROM backer_page_settlements WHERE token = ? LIMIT 1', [token]);
  if (!any) return null;
  const o = openRow(db, token);
  const last = oneRow(db, 'SELECT amount_cents, completed_at FROM backer_page_settlements WHERE token = ? AND completed_at IS NOT NULL ORDER BY completed_at DESC, id DESC LIMIT 1', [token]);
  const base = o ? (isPart(o) ? cumulativeCents : balanceCents) : null;
  const weekPaid = weekPaidCents(db, token, nowMs);
  return {
    open: o && openBalance(o) === base
      ? { amountCents: o.amount_cents, balanceCents: base, kind: isPart(o) ? 'part' : 'due', backerAt: o.backer_at || null, ownerAt: o.owner_at || null }
      : null,
    last: last ? { amountCents: last.amount_cents, at: last.completed_at } : null,
    // Σ completed: they lower the total but are not shares, so the page's curve adds them back.
    settledCents: settledCentsForToken(db, token),
    // What this week's payments took off this week (the page's "This week" figure), only when any.
    ...(weekPaid ? { weekPaidCents: weekPaid } : {}),
  };
}

/** Every completed payment on this link, newest first, for the session list: { date (YYYY-MM-DD, New
 *  York), at, amountCents (signed as the page: + = the player paid the backer), kind 'settled' | 'part' }. */
function paymentsFor(db, token) {
  if (!ready(db)) return [];
  const hasKind = hasColumn(db, 'backer_page_settlements', 'kind');
  return rowsOf(db, `SELECT amount_cents, completed_at${hasKind ? ', kind' : ''} FROM backer_page_settlements
    WHERE token = ? AND completed_at IS NOT NULL ORDER BY completed_at DESC, id DESC LIMIT 100`, [token]).map((r) => ({
    date: new Date(r.completed_at).toLocaleDateString('en-CA', { timeZone: SETTLE_TZ }),
    at: r.completed_at,
    amountCents: r.amount_cents,
    kind: r.kind === 'part' ? 'part' : 'settled',
  }));
}

/**
 * One side presses Settled, or withdraws its press. -> { status, body }.
 *   side         'backer' | 'owner'
 *   action       'confirm' | 'undo'
 *   balanceCents the page's balance now (the caller works it out from the feed)
 *   seenCents    the balance this side was shown (required for confirm)
 *   settleCents  a partial payment's amount (with kind 'part'; omitted = confirm the open one)
 *   kind         'part' (balanceCents is then the running total) | 'due' (Settled: earlier weeks)
 *   dueCents     what earlier weeks owe now, to split a completed payment (week_cents)
 *   ledger       { userId, name } where the completed settlement is entered (userId null = none)
 */
function press(db, token, { side, action, balanceCents, seenCents, settleCents, kind = 'due', dueCents: dueNow, ledger = {}, now = new Date().toISOString(), today }) {
  const col = SIDES[side];
  if (!col) return { status: 400, body: { error: 'side must be backer or owner' } };
  if (action !== 'confirm' && action !== 'undo') return { status: 400, body: { error: 'action must be confirm or undo' } };
  const open = openRow(db, token);

  if (action === 'undo') {
    // `changed` false = nothing to withdraw (a repeated tap), so nobody is told.
    if (!open || !open[col]) return { status: 200, body: { ok: true, changed: false } };
    db.run(`UPDATE backer_page_settlements SET ${col} = NULL WHERE id = ?`, [open.id]);
    const other = side === 'backer' ? open.owner_at : open.backer_at;
    if (!other) db.run('UPDATE backer_page_settlements SET voided_at = ? WHERE id = ?', [now, open.id]);
    return { status: 200, body: { ok: true, changed: true, amountCents: open.amount_cents } };
  }

  const seen = Number(seenCents);
  if (!Number.isSafeInteger(seen)) return { status: 400, body: { error: 'amountCents (the balance you were shown) is required' } };
  if (seen !== balanceCents) return { status: 409, body: { error: 'The balance has changed since this page loaded.', balanceCents } };
  if (balanceCents === 0) return { status: 409, body: { error: 'Nothing to settle: the balance is $0.', balanceCents } };
  const named = settleCents != null && settleCents !== '';
  let amount = balanceCents;
  if (named) {
    const part = Number(settleCents);
    if (!Number.isSafeInteger(part) || part === 0 || Math.sign(part) !== Math.sign(balanceCents) || Math.abs(part) > Math.abs(balanceCents)) {
      return { status: 400, body: { error: 'A part must be more than $0 and no more than the balance.', balanceCents } };
    }
    amount = part;
  }

  db.run('SAVEPOINT backer_settle');
  try {
    let row = open;
    if (row && (isPart(row) ? 'part' : 'due') !== kind) {
      // The other side opened the other kind (Settled against a partial payment): that one stands until
      // it is confirmed or withdrawn.
      db.run('RELEASE backer_settle');
      return { status: 409, body: { error: isPart(row) ? 'A partial payment is waiting to be confirmed or withdrawn first.' : 'Settled is waiting to be confirmed or withdrawn first.', openAmountCents: row.amount_cents, balanceCents } };
    }
    if (row && openBalance(row) !== balanceCents) {
      // The balance moved while one side had pressed: that confirmation was for another number.
      db.run('UPDATE backer_page_settlements SET voided_at = ? WHERE id = ?', [now, row.id]);
      row = null;
    }
    if (row && named && row.amount_cents !== amount) {
      db.run('RELEASE backer_settle');
      return { status: 409, body: { error: 'The other side marked a different amount.', openAmountCents: row.amount_cents, balanceCents } };
    }
    if (!row && kind === 'part' && !named) {
      db.run('RELEASE backer_settle');
      return { status: 400, body: { error: 'A partial payment needs its amount (settleCents).', balanceCents } };
    }
    if (row) amount = row.amount_cents;
    let completed = false;
    let changed = true;
    if (!row) {
      db.run(`INSERT INTO backer_page_settlements (token, amount_cents, balance_cents, kind, ${col}, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [token, amount, balanceCents, kind, now, now]);
    } else if (row[col]) {
      changed = false; // this side had already pressed: a repeated tap
    } else if (!row[col]) {
      const other = side === 'backer' ? row.owner_at : row.backer_at;
      db.run(`UPDATE backer_page_settlements SET ${col} = ?${other ? ', completed_at = ?' : ''} WHERE id = ?`, other ? [now, now, row.id] : [now, row.id]);
      if (other) {
        completed = true;
        // What of it went past what earlier weeks owed, into the week in progress.
        const due = Number.isSafeInteger(Number(dueNow)) ? Number(dueNow) : (kind === 'part' ? 0 : amount);
        db.run('UPDATE backer_page_settlements SET week_cents = ? WHERE id = ?', [amount - earlierShare(amount, due), row.id]);
        const dollars = Math.round(amount / 100);
        if (ledger.userId != null && dollars !== 0 && hasColumn(db, 'bankroll_adjustments', 'settlement_ref')) {
          const who = ledger.name || 'a backer';
          const part = kind === 'part' ? ' (partial payment)' : '';
          const note = amount > 0 ? `Settled${part}: paid ${who}` : `Settled${part}: ${who} paid`;
          db.run(`INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, created_at, settlement_ref)
            VALUES (?, NULL, 'settlement', ?, ?, ?, ?, ?)`, [ledger.userId, -dollars, today || now.slice(0, 10), note.slice(0, 200), now, 'bks:' + row.id]);
        }
      }
    }
    db.run('RELEASE backer_settle');
    return { status: 200, body: { ok: true, completed, changed, amountCents: amount, partial: kind === 'part' } };
  } catch (e) {
    try { db.run('ROLLBACK TO backer_settle'); db.run('RELEASE backer_settle'); } catch (_) { /* */ }
    throw e;
  }
}

module.exports = { MIGRATION_NAME, migrate, settledCentsForToken, stateFor, paymentsFor, press, weekStartMs, dueCents, weekPaidCents, earlierShare, openRow, isPart };
