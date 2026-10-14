'use strict';
/*
 * Expenses, non-game income and trips — BETA, app admins only (the /api/bankrolls gate).
 *
 * A bankroll tracker that only knows tournament results misses most of what a travelling player
 * spends: flights, rooms, food, dealer tips, coaching, software — and the money that comes in
 * outside a cash: rakeback, promotions, staking settlements, sponsorship, coaching fees. This adds
 *
 *   bankroll_transactions  one row per expense or income. `amount` is POSITIVE; the sign comes
 *                          from `kind` ('expense' = money out, 'income' = money in). Filed under a
 *                          bankroll (bankroll_id NULL = the virtual "Main", as everywhere else),
 *                          in its own currency (a dinner in Dublin is EUR even in a USD bankroll),
 *                          optionally tagged to a tournament, a series/venue string and a trip.
 *   bankroll_trips         a name and a date range (plus a bankroll scope) so a trip's whole P&L
 *                          can be read at once: every result whose event date falls inside it,
 *                          plus every transaction tagged to it.
 *
 * Amounts are stored to the cent (REAL, rounded on write): unlike a buy-in, a receipt has cents,
 * and the tax report wants them. Sums are rounded again on the way out.
 *
 * Every query is scoped by req.user.id; another user's id answers 404, the same as a missing one.
 * The ledger view of these rows (signed, for the bankroll dashboard) is
 * lib/ledger-sources/transactions.js. Docs: docs/bankrolls.md ("Expenses, income and trips").
 */

const bankrolls = require('./bankrolls');
const cashSource = require('./ledger-sources/cash-sessions');
const moneyMerge = require('./money-merge');

const KINDS = ['expense', 'income'];
// Category keys per kind. Labels live client-side (vite-app/src/utils/transactions.js), which must
// list the same keys — test/bankroll-transactions.test.js checks that.
const CATEGORIES = {
  // equipment and fees arrive with the bankroll merge (docs/bankroll-merge.md §5.4): the dashboard
  // had both, and mapping them to 'other' would drop them from the tax report (rate 0).
  expense: ['travel', 'lodging', 'food', 'entry_fees', 'coaching', 'software', 'tips', 'equipment', 'fees', 'other'],
  income: ['rakeback', 'bonus', 'staking', 'sponsorship', 'coaching', 'other'],
};
const MAX_NOTE = 200;
const MAX_SERIES = 80;
const MAX_TRIP_NAME = 60;
const MAX_TRIP_DAYS = 366;
const MAX_AMOUNT = 1e9;
const MAX_TRIPS = 200;
const LIST_DEFAULT = 500;
const LIST_MAX = 5000;

// ── sql.js helpers ── Statement.get() returns a truthy [] on no match, so always step().
function one(db, sql, params = []) {
  const s = db.prepare(sql);
  try { s.bind(params); return s.step() ? s.getAsObject() : null; } finally { s.free(); }
}
function rows(db, sql, params = []) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const cents = (v) => Math.round((Number(v) || 0) * 100) / 100;

// ── Schema ── run from server.js dataMigrations ('bankroll-transactions-2026-10').
// tournament_id carries no FOREIGN KEY on purpose: feed rows are pruned and re-keyed by the
// watcher sync, and a tag on an expense must never block that. It is listed in server.js
// FEED_REF_TABLES instead, so a tagged event is protected from pruning and follows a re-key.
function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS bankroll_trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    bankroll_all INTEGER NOT NULL DEFAULT 1,
    bankroll_id INTEGER,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (bankroll_id) REFERENCES bankrolls(id)
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_bankroll_trips_user ON bankroll_trips(user_id, start_date)');
  db.run(`CREATE TABLE IF NOT EXISTS bankroll_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bankroll_id INTEGER,
    occurred_on TEXT NOT NULL,
    kind TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    note TEXT,
    tournament_id INTEGER,
    series TEXT,
    trip_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (bankroll_id) REFERENCES bankrolls(id),
    FOREIGN KEY (trip_id) REFERENCES bankroll_trips(id)
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_bankroll_tx_user ON bankroll_transactions(user_id, occurred_on)');
  db.run('CREATE INDEX IF NOT EXISTS idx_bankroll_tx_trip ON bankroll_transactions(trip_id)');
}

// ── Validation ──
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function cleanDate(raw, { required = false, field = 'Date' } = {}) {
  if (raw === undefined || raw === null || raw === '') return required ? { error: `${field} is required` } : { value: today() };
  const s = String(raw);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { error: `${field} must be YYYY-MM-DD` };
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return { error: `${field} is not a real date` };
  return { value: s };
}
function cleanAmount(raw) {
  const n = Number(raw);
  if (raw === null || raw === '' || raw === undefined || typeof raw === 'boolean' || !Number.isFinite(n)) return { error: 'Amount must be a number' };
  const v = cents(n);
  if (v <= 0) return { error: 'Amount must be greater than 0' };
  if (v > MAX_AMOUNT) return { error: 'Amount is too large' };
  return { value: v };
}
function cleanText(raw, max) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}
function cleanKind(raw) {
  return KINDS.includes(raw) ? { value: raw } : { error: 'kind must be expense or income' };
}
function cleanCategory(kind, raw) {
  return CATEGORIES[kind] && CATEGORIES[kind].includes(raw)
    ? { value: raw }
    : { error: `category for ${kind} must be one of: ${(CATEGORIES[kind] || []).join(', ')}` };
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

// tournaments.date is mostly ISO, but Personal events (and some older imports) carry
// 'October 9, 2026'. Same reading as the client's normaliseDate(), at noon so no zone shifts a day.
function eventDate(d) {
  if (!d) return '';
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dt = new Date(s + ' 12:00:00');
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// A bankroll reference in a body: 'main' | id -> { id, currency } for the caller (any archived
// bankroll is refused unless it is the row's current one).
function resolveBankroll(db, uid, raw, current) {
  if (raw === null || raw === '' || raw === bankrolls.MAIN) return { id: null, currency: 'USD' };
  const ref = bankrolls.parseBankrollRef(raw);
  if (ref.error || ref.kind !== 'id') return { status: 400, error: 'bankroll must be "main" or a bankroll id' };
  const b = one(db, 'SELECT id, currency, archived FROM bankrolls WHERE id = ? AND user_id = ?', [ref.id, uid]);
  if (!b) return { status: 404, error: 'Bankroll not found' };
  if (b.archived && current !== b.id) return { status: 400, error: 'That bankroll is archived' };
  return { id: b.id, currency: b.currency };
}

// A tournament the caller may tag: any shared event, or a Personal event of their own.
function resolveTournament(db, uid, raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { error: 'tournamentId must be an event id' };
  const t = one(db, 'SELECT id, venue, uploaded_by, stable_id FROM tournaments WHERE id = ?', [id]);
  const mine = t && (t.venue !== 'Personal' || t.uploaded_by === uid || String(t.stable_id || '').startsWith(`PERSONAL-${uid}-`));
  if (!mine) return { status: 404, error: 'Event not found' };
  return { value: id };
}

function ownTrip(db, uid, raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return one(db, 'SELECT * FROM bankroll_trips WHERE id = ? AND user_id = ?', [id, uid]);
}

const TX_COLS_BASE = `bt.id, bt.bankroll_id, bt.occurred_on, bt.kind, bt.category, bt.amount, bt.currency, bt.note,
  bt.tournament_id, bt.series, bt.trip_id, bt.created_at, bt.updated_at,
  t.event_name AS tournament_name, t.date AS tournament_date, t.venue AS tournament_venue, tr.name AS trip_name`;
// affects_balance (0 = paid from outside the roll, so the ledger skips it; the list still shows it
// and the tax report still counts it) arrives with the 'money-merge-2026-10' migration. A database
// that has not run it reads every row as 1.
function txCols(db) {
  return `${TX_COLS_BASE}, ${moneyMerge.hasColumn(db, 'bankroll_transactions', 'affects_balance') ? 'bt.affects_balance' : '1 AS affects_balance'}`;
}
const TX_FROM = `bankroll_transactions bt
  LEFT JOIN tournaments t ON t.id = bt.tournament_id
  LEFT JOIN bankroll_trips tr ON tr.id = bt.trip_id AND tr.user_id = bt.user_id`;
const shapeTx = (r) => ({
  ...r,
  amount: cents(r.amount),
  // The ledger convention: + money in, - money out. `amount` itself is always positive.
  signed_amount: r.kind === 'expense' ? -cents(r.amount) : cents(r.amount),
  bankroll_id: r.bankroll_id == null ? bankrolls.MAIN : r.bankroll_id,
});
function getTx(db, uid, id) {
  const r = one(db, `SELECT ${txCols(db)} FROM ${TX_FROM} WHERE bt.id = ? AND bt.user_id = ?`, [id, uid]);
  return r ? shapeTx(r) : null;
}

/**
 * The list/totals filters, shared by GET /transactions and /transactions/totals.
 * ?bankroll=all|main|id  ?from=&to= (occurred_on, inclusive)  ?kind=  ?category=  ?trip=id|none
 * Returns { sql, params } (a WHERE tail after `bt.user_id = ?`) or { status, error }.
 */
function listFilter(db, uid, q) {
  const bk = bankrolls.filterFromQuery(db, uid, q.bankroll, 'bt.bankroll_id');
  if (bk.error) return bk;
  let sql = bk.sql;
  const params = [...bk.params];
  for (const [key, op] of [['from', '>='], ['to', '<=']]) {
    if (q[key] === undefined || q[key] === '') continue;
    const d = cleanDate(q[key], { required: true, field: key });
    if (d.error) return { status: 400, error: d.error };
    sql += ` AND bt.occurred_on ${op} ?`; params.push(d.value);
  }
  if (q.kind !== undefined && q.kind !== '') {
    const k = cleanKind(q.kind);
    if (k.error) return { status: 400, error: k.error };
    sql += ' AND bt.kind = ?'; params.push(k.value);
  }
  if (q.category !== undefined && q.category !== '') {
    const cats = String(q.category).split(',');
    const all = new Set([...CATEGORIES.expense, ...CATEGORIES.income]);
    if (!cats.every((c) => all.has(c))) return { status: 400, error: 'Unknown category' };
    sql += ` AND bt.category IN (${cats.map(() => '?').join(',')})`; params.push(...cats);
  }
  if (q.trip !== undefined && q.trip !== '') {
    if (q.trip === 'none') sql += ' AND bt.trip_id IS NULL';
    else {
      const trip = ownTrip(db, uid, q.trip);
      if (!trip) return { status: 404, error: 'Trip not found' };
      sql += ' AND bt.trip_id = ?'; params.push(trip.id);
    }
  }
  return { sql, params };
}

function totalsFor(db, uid, f) {
  return rows(db, `SELECT bt.kind, bt.category, bt.currency, SUM(bt.amount) AS amount, COUNT(*) AS count
    FROM bankroll_transactions bt WHERE bt.user_id = ?${f.sql}
    GROUP BY bt.kind, bt.category, bt.currency ORDER BY bt.kind, bt.category, bt.currency`, [uid, ...f.params])
    .map((r) => ({ ...r, amount: cents(r.amount) }));
}

// ── Trips ──
function shapeTrip(r, stats) {
  const s = stats || {};
  return {
    id: r.id,
    name: r.name,
    start_date: r.start_date,
    end_date: r.end_date,
    bankroll: r.bankroll_all ? bankrolls.ALL : (r.bankroll_id == null ? bankrolls.MAIN : r.bankroll_id),
    note: r.note || null,
    transaction_count: s.n || 0,
    created_at: r.created_at,
    updated_at: r.updated_at || null,
  };
}
function listTrips(db, uid) {
  const counts = new Map(rows(db, 'SELECT trip_id, COUNT(*) AS n FROM bankroll_transactions WHERE user_id = ? AND trip_id IS NOT NULL GROUP BY trip_id', [uid])
    .map((r) => [r.trip_id, r]));
  return rows(db, 'SELECT * FROM bankroll_trips WHERE user_id = ? ORDER BY start_date DESC, id DESC', [uid])
    .map((r) => shapeTrip(r, counts.get(r.id)));
}
// 'all' | 'main' | id -> { all, id } for a trip's bankroll scope.
function resolveTripScope(db, uid, raw, current) {
  if (raw === undefined || raw === null || raw === '' || raw === bankrolls.ALL) return { all: 1, id: null };
  const b = resolveBankroll(db, uid, raw, current);
  if (b.error) return b;
  return { all: 0, id: b.id };
}
// The results a trip covers: the caller's tracking entries whose event date is inside the range,
// in the trip's bankroll scope. Same columns as GET /api/tracking.
function tripResults(db, uid, trip) {
  const scope = trip.bankroll_all ? bankrolls.ALL : (trip.bankroll_id == null ? bankrolls.MAIN : trip.bankroll_id);
  const bk = bankrolls.filterFromQuery(db, uid, scope, 'te.bankroll_id');
  if (bk.error) return [];
  return rows(db, `SELECT te.*, t.event_number, t.event_name, t.date, t.time, t.buyin,
      t.game_variant, t.venue, t.is_satellite, t.total_entries
    FROM tracking_entries te JOIN tournaments t ON te.tournament_id = t.id
    WHERE te.user_id = ?${bk.sql}`, [uid, ...bk.params])
    .map((r) => ({ ...r, date_iso: eventDate(r.date) }))
    .filter((r) => r.date_iso && r.date_iso >= trip.start_date && r.date_iso <= trip.end_date)
    .sort((a, b) => (a.date_iso < b.date_iso ? -1 : a.date_iso > b.date_iso ? 1 : 0));
}
// The cash sessions a trip covers: the caller's ENDED sessions whose day is inside the range, in
// the trip's bankroll scope. Read through the combined ledger's own source
// (lib/ledger-sources/cash-sessions.js), so a session's amount here is the ledger's
// (cash_out - buy_in - tips - expenses) and the trip page and the home's trip block, which both
// add these in, agree with the bankroll Overview. A live session counts once it is ended.
function tripCashSessions(db, uid, trip) {
  const scope = trip.bankroll_all ? undefined : (trip.bankroll_id == null ? bankrolls.MAIN : trip.bankroll_id);
  return cashSource.entries(db, uid, { bankroll: scope, from: trip.start_date, to: trip.end_date })
    .map((e) => ({
      id: e.ref && e.ref.id, date: e.date, amount: Math.round(e.amount * 100) / 100, currency: e.currency,
      hours: e.hours, label: e.label, bankroll_id: e.bankroll_id,
    }));
}

/**
 * Mounts /api/bankrolls/transactions/* and /api/bankrolls/trips/*. Call AFTER
 * bankrolls.mountRoutes so the /api/bankrolls gate (authenticateToken + requireAppAdmin) is
 * already in front; it is also applied here so the routes stay gated if the order changes.
 * deps: { getDb, saveDatabase, authenticateToken, requireAppAdmin, currencies }.
 */
function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireAppAdmin, currencies } = deps;
  const CURRENCIES = new Set(currencies || ['USD']);
  app.use('/api/bankrolls/transactions', authenticateToken, requireAppAdmin);
  app.use('/api/bankrolls/trips', authenticateToken, requireAppAdmin);

  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res, getDb(), req.user.id); } catch (err) {
      console.error('[bankroll-transactions]', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  const fail = (res, r) => res.status(r.status || 400).json({ error: r.error });
  const cleanCurrency = (raw, fallback) => {
    if (raw === undefined || raw === null || raw === '') return { value: fallback };
    const c = String(raw).toUpperCase();
    return CURRENCIES.has(c) ? { value: c } : { error: 'Unsupported currency' };
  };

  // ── Transactions ──
  app.get('/api/bankrolls/transactions', wrap((req, res, db, uid) => {
    const f = listFilter(db, uid, req.query);
    if (f.error) return fail(res, f);
    const n = Number(req.query.limit);
    const limit = Number.isInteger(n) && n > 0 ? Math.min(n, LIST_MAX) : LIST_DEFAULT;
    const list = rows(db, `SELECT ${txCols(db)} FROM ${TX_FROM} WHERE bt.user_id = ?${f.sql}
      ORDER BY bt.occurred_on DESC, bt.id DESC LIMIT ${limit}`, [uid, ...f.params]).map(shapeTx);
    const total = one(db, `SELECT COUNT(*) AS n FROM bankroll_transactions bt WHERE bt.user_id = ?${f.sql}`, [uid, ...f.params]).n;
    res.json({ transactions: list, total, truncated: total > list.length });
  }));

  // Totals by kind x category x currency (never summed across currencies here: the client converts).
  app.get('/api/bankrolls/transactions/totals', wrap((req, res, db, uid) => {
    const f = listFilter(db, uid, req.query);
    if (f.error) return fail(res, f);
    res.json({ totals: totalsFor(db, uid, f) });
  }));

  // Validates a body against an existing row (`cur`, for PUT) or none (POST). Returns the full
  // column set to write, or { status, error }.
  const validate = (db, uid, body, cur) => {
    const pick = (k, fallback) => (body[k] !== undefined ? body[k] : fallback);
    const kind = cleanKind(pick('kind', cur && cur.kind));
    if (kind.error) return kind;
    const category = cleanCategory(kind.value, pick('category', cur && cur.category));
    if (category.error) return category;
    const amount = body.amount !== undefined || !cur ? cleanAmount(body.amount) : { value: cur.amount };
    if (amount.error) return amount;
    const date = body.date !== undefined || !cur ? cleanDate(body.date) : { value: cur.occurred_on };
    if (date.error) return date;

    let trip = cur ? cur.trip_id : null;
    if (body.tripId !== undefined) {
      if (body.tripId === null || body.tripId === '') trip = null;
      else {
        const t = ownTrip(db, uid, body.tripId);
        if (!t) return { status: 404, error: 'Trip not found' };
        trip = t.id;
      }
    }
    let bankrollId = cur ? cur.bankroll_id : null;
    let bankrollCurrency = null;
    if (body.bankroll !== undefined) {
      const b = resolveBankroll(db, uid, body.bankroll, cur ? cur.bankroll_id : undefined);
      if (b.error) return b;
      bankrollId = b.id; bankrollCurrency = b.currency;
    } else if (!cur && trip) {
      // A new row on a trip that is filed under one bankroll defaults to that bankroll.
      const t = one(db, 'SELECT bankroll_all, bankroll_id FROM bankroll_trips WHERE id = ?', [trip]);
      if (t && !t.bankroll_all && t.bankroll_id != null) {
        const b = resolveBankroll(db, uid, t.bankroll_id);
        if (!b.error) { bankrollId = b.id; bankrollCurrency = b.currency; }
      }
    }
    if (bankrollCurrency == null) {
      bankrollCurrency = bankrollId == null ? 'USD'
        : ((one(db, 'SELECT currency FROM bankrolls WHERE id = ?', [bankrollId]) || {}).currency || 'USD');
    }
    // An unlabelled amount is in the bankroll's currency; a receipt abroad says otherwise.
    const currency = cleanCurrency(body.currency, cur ? cur.currency : bankrollCurrency);
    if (currency.error) return currency;
    let tournamentId = cur ? cur.tournament_id : null;
    if (body.tournamentId !== undefined) {
      const t = resolveTournament(db, uid, body.tournamentId);
      if (t.error) return t;
      tournamentId = t.value;
    }
    return {
      kind: kind.value, category: category.value, amount: amount.value, occurred_on: date.value,
      bankroll_id: bankrollId, currency: currency.value, trip_id: trip, tournament_id: tournamentId,
      note: body.note !== undefined ? cleanText(body.note, MAX_NOTE) : (cur ? cur.note : null),
      series: body.series !== undefined ? cleanText(body.series, MAX_SERIES) : (cur ? cur.series : null),
    };
  };

  app.post('/api/bankrolls/transactions', wrap(async (req, res, db, uid) => {
    const v = validate(db, uid, req.body || {}, null);
    if (v.error) return fail(res, v);
    db.run(`INSERT INTO bankroll_transactions (user_id, bankroll_id, occurred_on, kind, category, amount, currency,
        note, tournament_id, series, trip_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, v.bankroll_id, v.occurred_on, v.kind, v.category, v.amount, v.currency, v.note, v.tournament_id, v.series, v.trip_id, now()]);
    const id = one(db, 'SELECT last_insert_rowid() AS id').id;
    await saveDatabase();
    res.status(201).json({ transaction: getTx(db, uid, id) });
  }));

  app.put('/api/bankrolls/transactions/:txId', wrap(async (req, res, db, uid) => {
    const id = Number(req.params.txId);
    const cur = Number.isInteger(id) && id > 0 ? one(db, 'SELECT * FROM bankroll_transactions WHERE id = ? AND user_id = ?', [id, uid]) : null;
    if (!cur) return fail(res, { status: 404, error: 'Not found' });
    const v = validate(db, uid, req.body || {}, cur);
    if (v.error) return fail(res, v);
    db.run(`UPDATE bankroll_transactions SET bankroll_id = ?, occurred_on = ?, kind = ?, category = ?, amount = ?,
        currency = ?, note = ?, tournament_id = ?, series = ?, trip_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    [v.bankroll_id, v.occurred_on, v.kind, v.category, v.amount, v.currency, v.note, v.tournament_id, v.series, v.trip_id, now(), id, uid]);
    await saveDatabase();
    res.json({ transaction: getTx(db, uid, id) });
  }));

  app.delete('/api/bankrolls/transactions/:txId', wrap(async (req, res, db, uid) => {
    const id = Number(req.params.txId);
    if (!Number.isInteger(id) || id <= 0) return fail(res, { status: 404, error: 'Not found' });
    db.run('DELETE FROM bankroll_transactions WHERE id = ? AND user_id = ?', [id, uid]);
    const removed = db.getRowsModified();
    if (!removed) return fail(res, { status: 404, error: 'Not found' });
    await saveDatabase();
    res.json({ removed });
  }));

  // ── Trips ──
  const validateTrip = (db, uid, body, cur) => {
    const name = cleanText(body.name !== undefined ? body.name : cur && cur.name, MAX_TRIP_NAME);
    if (!name) return { error: 'Name is required' };
    const start = body.startDate !== undefined || !cur ? cleanDate(body.startDate, { required: true, field: 'Start date' }) : { value: cur.start_date };
    if (start.error) return start;
    const end = body.endDate !== undefined || !cur ? cleanDate(body.endDate, { required: true, field: 'End date' }) : { value: cur.end_date };
    if (end.error) return end;
    if (end.value < start.value) return { error: 'The trip ends before it starts' };
    if (daysBetween(start.value, end.value) >= MAX_TRIP_DAYS) return { error: `A trip is at most ${MAX_TRIP_DAYS} days` };
    let scope = cur ? { all: cur.bankroll_all, id: cur.bankroll_id } : { all: 1, id: null };
    if (body.bankroll !== undefined) {
      scope = resolveTripScope(db, uid, body.bankroll, cur ? cur.bankroll_id : undefined);
      if (scope.error) return scope;
    }
    return {
      name, start_date: start.value, end_date: end.value, bankroll_all: scope.all, bankroll_id: scope.id,
      note: body.note !== undefined ? cleanText(body.note, MAX_NOTE) : (cur ? cur.note : null),
    };
  };

  app.get('/api/bankrolls/trips', wrap((req, res, db, uid) => {
    res.json({ trips: listTrips(db, uid) });
  }));

  app.post('/api/bankrolls/trips', wrap(async (req, res, db, uid) => {
    const v = validateTrip(db, uid, req.body || {}, null);
    if (v.error) return fail(res, v);
    if (one(db, 'SELECT COUNT(*) AS n FROM bankroll_trips WHERE user_id = ?', [uid]).n >= MAX_TRIPS) {
      return fail(res, { status: 409, error: `At most ${MAX_TRIPS} trips` });
    }
    db.run(`INSERT INTO bankroll_trips (user_id, name, start_date, end_date, bankroll_all, bankroll_id, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [uid, v.name, v.start_date, v.end_date, v.bankroll_all, v.bankroll_id, v.note, now()]);
    const id = one(db, 'SELECT last_insert_rowid() AS id').id;
    await saveDatabase();
    res.status(201).json({ trip: listTrips(db, uid).find((t) => t.id === id) });
  }));

  // One trip with everything its P&L needs: the trip, its transactions, the results whose event
  // date falls inside it and the cash sessions played inside it. Totals are the client's (results
  // are in each venue's currency, and the venue -> currency map lives client-side):
  // vite-app/src/utils/transactions.js tripPnl(), which the trip page and the home both use.
  app.get('/api/bankrolls/trips/:tripId', wrap((req, res, db, uid) => {
    const trip = ownTrip(db, uid, req.params.tripId);
    if (!trip) return fail(res, { status: 404, error: 'Trip not found' });
    const transactions = rows(db, `SELECT ${txCols(db)} FROM ${TX_FROM} WHERE bt.user_id = ? AND bt.trip_id = ?
      ORDER BY bt.occurred_on, bt.id`, [uid, trip.id]).map(shapeTx);
    res.json({
      trip: listTrips(db, uid).find((t) => t.id === trip.id),
      transactions,
      results: tripResults(db, uid, trip),
      cash_sessions: tripCashSessions(db, uid, trip),
    });
  }));

  app.put('/api/bankrolls/trips/:tripId', wrap(async (req, res, db, uid) => {
    const cur = ownTrip(db, uid, req.params.tripId);
    if (!cur) return fail(res, { status: 404, error: 'Trip not found' });
    const v = validateTrip(db, uid, req.body || {}, cur);
    if (v.error) return fail(res, v);
    db.run(`UPDATE bankroll_trips SET name = ?, start_date = ?, end_date = ?, bankroll_all = ?, bankroll_id = ?, note = ?,
      updated_at = ? WHERE id = ? AND user_id = ?`, [v.name, v.start_date, v.end_date, v.bankroll_all, v.bankroll_id, v.note, now(), cur.id, uid]);
    await saveDatabase();
    res.json({ trip: listTrips(db, uid).find((t) => t.id === cur.id) });
  }));

  // Deleting a trip keeps its expenses and income: they are untagged, not deleted.
  app.delete('/api/bankrolls/trips/:tripId', wrap(async (req, res, db, uid) => {
    const cur = ownTrip(db, uid, req.params.tripId);
    if (!cur) return fail(res, { status: 404, error: 'Trip not found' });
    db.run('BEGIN');
    let untagged = 0;
    try {
      db.run('UPDATE bankroll_transactions SET trip_id = NULL, updated_at = ? WHERE trip_id = ? AND user_id = ?', [now(), cur.id, uid]);
      untagged = db.getRowsModified();
      db.run('DELETE FROM bankroll_trips WHERE id = ? AND user_id = ?', [cur.id, uid]);
      db.run('COMMIT');
    } catch (e) { try { db.run('ROLLBACK'); } catch (_) { /* nothing open */ } throw e; }
    await saveDatabase();
    res.json({ deleted: true, untagged });
  }));
}

/** Rows a bankroll still holds here, for the bankroll delete check in lib/bankrolls.js. */
function bankrollUsage(db, uid, bankrollId) {
  const has = (t) => !!one(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [t]);
  return {
    transactions: has('bankroll_transactions') ? one(db, 'SELECT COUNT(*) AS n FROM bankroll_transactions WHERE user_id = ? AND bankroll_id = ?', [uid, bankrollId]).n : 0,
    trips: has('bankroll_trips') ? one(db, 'SELECT COUNT(*) AS n FROM bankroll_trips WHERE user_id = ? AND bankroll_id = ?', [uid, bankrollId]).n : 0,
  };
}

module.exports = { KINDS, CATEGORIES, migrate, mountRoutes, eventDate, bankrollUsage };
