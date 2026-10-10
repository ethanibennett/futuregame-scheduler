'use strict';
/*
 * Multiple bankrolls — BETA, app admins only (requireAppAdmin on every route here).
 *
 * A user's results have always been one pot. A bankroll splits that pot: "Main", "Staked",
 * "Online", each with its own starting balance and its own ledger of deposits, withdrawals and
 * transfers, so that
 *
 *     balance = starting_balance + SUM(bankroll_adjustments.amount) + net results
 *
 * where net results = SUM(cash_amount - buyin * num_entries) over the tracking_entries filed
 * under it.
 *
 * "Main" is VIRTUAL. It has no row: a tracking entry or an adjustment with bankroll_id NULL is in
 * Main. That is what lets every existing result keep working untouched (bankroll_id is NULL on
 * every row that predates this), and it is why a non-admin — who can never create a bankroll —
 * sees exactly what they saw before. Main is always USD with a starting balance of 0; an opening
 * balance for Main is recorded as a deposit.
 *
 * Currency is per bankroll (default USD). The app already files results in EUR/GBP (Irish Poker
 * Open, WSOPE …) and staking_series carries its own currency, so an unlabelled "deposit 500" is
 * ambiguous the moment a bankroll lives on a non-USD site. The starting balance and every
 * adjustment are denominated in the bankroll's currency; results stay in each event's native
 * currency and are converted at display time, exactly as the Results tab already does. That
 * conversion needs the venue -> currency map, which lives client-side (utils.js VENUE_CURRENCY),
 * so balances are summed by the client helper in vite-app/src/utils/bankrolls.js — this module
 * returns the ledger side (starting_balance, adjustments_net) and the entry counts.
 *
 * Amounts are whole currency units (INTEGER), the same unit as tracking_entries.cash_amount and
 * tournaments.buyin.
 *
 * ── The shared filter ───────────────────────────────────────────────────────────────────────
 * One query param for every feature that reads results: `?bankroll=<all|main|id>`.
 *   absent / 'all'  every entry (the pre-bankroll behaviour — the default)
 *   'main'          bankroll_id IS NULL
 *   '<id>'          bankroll_id = id, after checking the bankroll is the CALLER'S (404 if not)
 * Use filterFromQuery(db, userId, req.query.bankroll, 'te.bankroll_id'); see docs/bankrolls.md.
 */

const MAIN = 'main';
const ALL = 'all';
const MAX_BANKROLLS = 20;
const MAX_NAME = 40;
const MAX_NOTE = 200;
const MAX_AMOUNT = 1e10;
const RESERVED_NAMES = new Set([MAIN, ALL]);

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

// ── Schema ── run from server.js dataMigrations ('bankrolls-beta-2026-10').
function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS bankrolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    starting_balance INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    archived INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_bankrolls_user ON bankrolls(user_id)');
  // The ledger. `amount` is SIGNED in the bankroll's currency (+ money in, - money out), so a
  // balance is a plain SUM. A transfer is two rows sharing a transfer_id; deleting either leg
  // deletes both. bankroll_id NULL = Main.
  db.run(`CREATE TABLE IF NOT EXISTS bankroll_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bankroll_id INTEGER,
    kind TEXT NOT NULL,
    amount INTEGER NOT NULL,
    transfer_id TEXT,
    occurred_on TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (bankroll_id) REFERENCES bankrolls(id)
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_bankroll_adj_user ON bankroll_adjustments(user_id, bankroll_id)');
  // tracking_entries is created AFTER dataMigrations, so on a fresh DB it does not exist yet and
  // its CREATE TABLE already carries bankroll_id. Only an existing table needs the column.
  if (one(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracking_entries'")) {
    const cols = db.exec('PRAGMA table_info(tracking_entries)')[0].values.map((v) => v[1]);
    if (!cols.includes('bankroll_id')) db.run('ALTER TABLE tracking_entries ADD COLUMN bankroll_id INTEGER');
  }
}

// ── Parsing ──
function parseBankrollRef(raw) {
  if (raw === undefined || raw === null || raw === '' || raw === ALL) return { kind: ALL };
  if (raw === MAIN) return { kind: MAIN };
  const s = String(raw);
  if (/^[1-9]\d{0,9}$/.test(s)) return { kind: 'id', id: Number(s) };
  return { error: 'bankroll must be "all", "main" or a bankroll id' };
}

function ownBankroll(db, userId, id) {
  return one(db, 'SELECT * FROM bankrolls WHERE id = ? AND user_id = ?', [id, userId]);
}

/**
 * The shared filter. `raw` is the ?bankroll= value, `column` the SQL column holding the entry's
 * bankroll (a constant chosen by the caller — never input). Returns
 *   { sql, params, ref }            sql is '' or ' AND <column> ...', ready to append to a WHERE
 *   { status, error }               400 malformed, 404 not the caller's bankroll
 */
function filterFromQuery(db, userId, raw, column = 'te.bankroll_id') {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(column)) throw new Error('bankroll filter: bad column');
  const ref = parseBankrollRef(raw);
  if (ref.error) return { status: 400, error: ref.error };
  if (ref.kind === ALL) return { sql: '', params: [], ref };
  if (ref.kind === MAIN) return { sql: ` AND ${column} IS NULL`, params: [], ref };
  if (!ownBankroll(db, userId, ref.id)) return { status: 404, error: 'Bankroll not found' };
  return { sql: ` AND ${column} = ?`, params: [ref.id], ref };
}

/**
 * bankrollId on POST/PUT /api/tracking. `current` is the entry's existing bankroll_id (undefined
 * for a new entry). Returns { set: false } when the body says nothing (leave it alone),
 * { set: true, value } to write, or { status, error }.
 */
function resolveEntryBankroll(db, req, raw, current, isAppAdmin) {
  if (raw === undefined) return { set: false };
  if (raw === null || raw === '' || raw === MAIN) return { set: true, value: null };
  const ref = parseBankrollRef(raw);
  if (ref.error || ref.kind !== 'id') return { status: 400, error: 'bankrollId must be "main" or a bankroll id' };
  // Beta: only app admins file results under a bankroll. A non-admin owns none anyway; this makes
  // the gate explicit rather than incidental.
  if (!isAppAdmin(req)) return { status: 403, error: 'Forbidden' };
  const b = ownBankroll(db, req.user.id, ref.id);
  if (!b) return { status: 400, error: 'Bankroll not found' };
  if (b.archived && current !== ref.id) return { status: 400, error: 'That bankroll is archived' };
  return { set: true, value: ref.id };
}

// ── Validation ──
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function cleanName(raw) {
  const name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'Name is required' };
  if (name.length > MAX_NAME) return { error: `Name is at most ${MAX_NAME} characters` };
  if (RESERVED_NAMES.has(name.toLowerCase())) return { error: `"${name}" is reserved` };
  return { value: name };
}
function cleanAmount(raw, { positive = false } = {}) {
  const n = Number(raw);
  if (raw === null || raw === '' || raw === undefined || !Number.isFinite(n)) return { error: 'Amount must be a number' };
  const v = Math.round(n);
  if (Math.abs(v) > MAX_AMOUNT) return { error: 'Amount is too large' };
  if (positive && v <= 0) return { error: 'Amount must be greater than 0' };
  return { value: v };
}
function cleanDate(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: today() };
  const s = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) return { error: 'Date must be YYYY-MM-DD' };
  return { value: s };
}
function cleanNote(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s ? s.slice(0, MAX_NOTE) : null;
}

function nameTaken(db, userId, name, exceptId) {
  return !!one(db, 'SELECT id FROM bankrolls WHERE user_id = ? AND lower(name) = lower(?) AND id != ?', [userId, name, exceptId || 0]);
}

// Main + every bankroll, with ledger totals and entry counts. Main is first and is id 'main'.
function listBankrolls(db, userId) {
  const adj = new Map();
  for (const r of rows(db, 'SELECT bankroll_id, SUM(amount) AS net, COUNT(*) AS n FROM bankroll_adjustments WHERE user_id = ? GROUP BY bankroll_id', [userId])) {
    adj.set(r.bankroll_id == null ? MAIN : r.bankroll_id, { net: r.net || 0, n: r.n || 0 });
  }
  const ent = new Map();
  for (const r of rows(db, 'SELECT bankroll_id, COUNT(*) AS n FROM tracking_entries WHERE user_id = ? GROUP BY bankroll_id', [userId])) {
    ent.set(r.bankroll_id == null ? MAIN : r.bankroll_id, r.n || 0);
  }
  const shape = (key, b) => ({
    id: key,
    name: b.name,
    currency: b.currency,
    starting_balance: b.starting_balance || 0,
    archived: !!b.archived,
    sort_order: b.sort_order,
    is_main: key === MAIN,
    adjustments_net: (adj.get(key) || {}).net || 0,
    adjustment_count: (adj.get(key) || {}).n || 0,
    entry_count: ent.get(key) || 0,
    created_at: b.created_at || null,
  });
  const out = [shape(MAIN, { name: 'Main', currency: 'USD', starting_balance: 0, archived: 0, sort_order: -1 })];
  for (const b of rows(db, 'SELECT * FROM bankrolls WHERE user_id = ? ORDER BY sort_order, id', [userId])) out.push(shape(b.id, b));
  return out;
}

// A bankroll reference in a request body ('main' or an id) -> { key, id, currency } for the CALLER.
function resolveOwnRef(db, userId, raw) {
  const ref = parseBankrollRef(raw);
  if (ref.error || ref.kind === ALL) return { status: 400, error: 'bankroll must be "main" or a bankroll id' };
  if (ref.kind === MAIN) return { key: MAIN, id: null, currency: 'USD' };
  const b = ownBankroll(db, userId, ref.id);
  if (!b) return { status: 404, error: 'Bankroll not found' };
  return { key: b.id, id: b.id, currency: b.currency };
}

const ADJ_COLS = 'id, bankroll_id, kind, amount, transfer_id, occurred_on, note, created_at';
const shapeAdj = (r) => ({ ...r, bankroll_id: r.bankroll_id == null ? MAIN : r.bankroll_id });

/**
 * Mounts /api/bankrolls/*. deps: { getDb, saveDatabase, authenticateToken, requireAppAdmin,
 * currencies }. Every query below is scoped by req.user.id; an id that is not the caller's is a
 * 404, the same answer as an id that does not exist.
 */
function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireAppAdmin, currencies } = deps;
  const CURRENCIES = new Set(currencies || ['USD']);
  app.use('/api/bankrolls', authenticateToken, requireAppAdmin);

  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res, getDb(), req.user.id); } catch (err) {
      console.error('[bankrolls]', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  const fail = (res, r) => res.status(r.status || 400).json({ error: r.error });

  app.get('/api/bankrolls', wrap((req, res, db, uid) => {
    res.json({ bankrolls: listBankrolls(db, uid) });
  }));

  app.post('/api/bankrolls', wrap(async (req, res, db, uid) => {
    const body = req.body || {};
    const name = cleanName(body.name);
    if (name.error) return fail(res, name);
    if (nameTaken(db, uid, name.value)) return fail(res, { status: 409, error: 'You already have a bankroll with that name' });
    const start = body.startingBalance === undefined ? { value: 0 } : cleanAmount(body.startingBalance);
    if (start.error) return fail(res, start);
    const currency = String(body.currency || 'USD').toUpperCase();
    if (!CURRENCIES.has(currency)) return fail(res, { error: 'Unsupported currency' });
    const count = one(db, 'SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), -1) AS mx FROM bankrolls WHERE user_id = ?', [uid]);
    if (count.n >= MAX_BANKROLLS) return fail(res, { status: 409, error: `At most ${MAX_BANKROLLS} bankrolls` });
    db.run('INSERT INTO bankrolls (user_id, name, starting_balance, currency, archived, sort_order, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [uid, name.value, start.value, currency, count.mx + 1, now()]);
    const id = one(db, 'SELECT last_insert_rowid() AS id').id;
    await saveDatabase();
    res.status(201).json({ bankroll: listBankrolls(db, uid).find((b) => b.id === id) });
  }));

  // Reorder: { order: [id, id, ...] } — every id must be the caller's. Before /:id.
  app.put('/api/bankrolls/order', wrap(async (req, res, db, uid) => {
    const order = Array.isArray(req.body && req.body.order) ? req.body.order.map(Number) : null;
    if (!order || !order.every((n) => Number.isInteger(n) && n > 0) || new Set(order).size !== order.length) {
      return fail(res, { error: 'order must be a list of bankroll ids' });
    }
    for (const id of order) if (!ownBankroll(db, uid, id)) return fail(res, { status: 404, error: 'Bankroll not found' });
    order.forEach((id, i) => db.run('UPDATE bankrolls SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?', [i, now(), id, uid]));
    await saveDatabase();
    res.json({ bankrolls: listBankrolls(db, uid) });
  }));

  // ── Ledger ── (before /:id so 'adjustments' / 'transfers' are never read as an id)
  app.get('/api/bankrolls/adjustments', wrap((req, res, db, uid) => {
    const f = filterFromQuery(db, uid, req.query.bankroll, 'bankroll_id');
    if (f.error) return fail(res, f);
    const list = rows(db, `SELECT ${ADJ_COLS} FROM bankroll_adjustments WHERE user_id = ?${f.sql} ORDER BY occurred_on DESC, id DESC LIMIT 500`, [uid, ...f.params]);
    res.json({ adjustments: list.map(shapeAdj) });
  }));

  app.post('/api/bankrolls/adjustments', wrap(async (req, res, db, uid) => {
    const body = req.body || {};
    if (body.kind !== 'deposit' && body.kind !== 'withdrawal') return fail(res, { error: 'kind must be deposit or withdrawal' });
    const target = resolveOwnRef(db, uid, body.bankroll);
    if (target.error) return fail(res, target);
    const amount = cleanAmount(body.amount, { positive: true });
    if (amount.error) return fail(res, amount);
    const date = cleanDate(body.date);
    if (date.error) return fail(res, date);
    const signed = body.kind === 'deposit' ? amount.value : -amount.value;
    db.run('INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, transfer_id, occurred_on, note, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
      [uid, target.id, body.kind, signed, date.value, cleanNote(body.note), now()]);
    const id = one(db, 'SELECT last_insert_rowid() AS id').id;
    await saveDatabase();
    res.status(201).json({ adjustment: shapeAdj(one(db, `SELECT ${ADJ_COLS} FROM bankroll_adjustments WHERE id = ?`, [id])) });
  }));

  // { from, to, amount, toAmount?, date?, note? }. toAmount is required when the two bankrolls'
  // currencies differ (what arrived, in the destination's currency) and ignored otherwise.
  app.post('/api/bankrolls/transfers', wrap(async (req, res, db, uid) => {
    const body = req.body || {};
    const from = resolveOwnRef(db, uid, body.from);
    if (from.error) return fail(res, from);
    const to = resolveOwnRef(db, uid, body.to);
    if (to.error) return fail(res, to);
    if (from.key === to.key) return fail(res, { error: 'Pick two different bankrolls' });
    const amount = cleanAmount(body.amount, { positive: true });
    if (amount.error) return fail(res, amount);
    let inAmount = amount.value;
    if (from.currency !== to.currency) {
      const t = cleanAmount(body.toAmount, { positive: true });
      if (t.error) return fail(res, { error: `Different currencies: give the amount received in ${to.currency} (toAmount)` });
      inAmount = t.value;
    }
    const date = cleanDate(body.date);
    if (date.error) return fail(res, date);
    const note = cleanNote(body.note);
    const tid = require('crypto').randomUUID();
    const ins = 'INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, transfer_id, occurred_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    db.run('BEGIN');
    try {
      db.run(ins, [uid, from.id, 'transfer_out', -amount.value, tid, date.value, note, now()]);
      db.run(ins, [uid, to.id, 'transfer_in', inAmount, tid, date.value, note, now()]);
      db.run('COMMIT');
    } catch (e) { try { db.run('ROLLBACK'); } catch (_) { /* nothing open */ } throw e; }
    await saveDatabase();
    const legs = rows(db, `SELECT ${ADJ_COLS} FROM bankroll_adjustments WHERE user_id = ? AND transfer_id = ? ORDER BY id`, [uid, tid]);
    res.status(201).json({ transfer_id: tid, adjustments: legs.map(shapeAdj) });
  }));

  app.delete('/api/bankrolls/adjustments/:adjId', wrap(async (req, res, db, uid) => {
    const id = Number(req.params.adjId);
    const row = Number.isInteger(id) ? one(db, 'SELECT id, transfer_id FROM bankroll_adjustments WHERE id = ? AND user_id = ?', [id, uid]) : null;
    if (!row) return fail(res, { status: 404, error: 'Not found' });
    if (row.transfer_id) db.run('DELETE FROM bankroll_adjustments WHERE transfer_id = ? AND user_id = ?', [row.transfer_id, uid]);
    else db.run('DELETE FROM bankroll_adjustments WHERE id = ? AND user_id = ?', [id, uid]);
    const removed = db.getRowsModified();
    await saveDatabase();
    res.json({ removed });
  }));

  // ── One bankroll ──
  const own = (req, res, db, uid) => {
    const id = Number(req.params.id);
    const b = Number.isInteger(id) && id > 0 ? ownBankroll(db, uid, id) : null;
    if (!b) { fail(res, { status: 404, error: 'Bankroll not found' }); return null; }
    return b;
  };

  // { name?, startingBalance?, currency?, archived? }
  app.put('/api/bankrolls/:id', wrap(async (req, res, db, uid) => {
    const b = own(req, res, db, uid); if (!b) return;
    const body = req.body || {};
    const next = { name: b.name, starting_balance: b.starting_balance, currency: b.currency, archived: b.archived };
    if (body.name !== undefined) {
      const n = cleanName(body.name);
      if (n.error) return fail(res, n);
      if (nameTaken(db, uid, n.value, b.id)) return fail(res, { status: 409, error: 'You already have a bankroll with that name' });
      next.name = n.value;
    }
    if (body.startingBalance !== undefined) {
      const s = cleanAmount(body.startingBalance);
      if (s.error) return fail(res, s);
      next.starting_balance = s.value;
    }
    if (body.currency !== undefined) {
      const c = String(body.currency).toUpperCase();
      if (!CURRENCIES.has(c)) return fail(res, { error: 'Unsupported currency' });
      // Its ledger is denominated in the old currency; relabelling would silently revalue it.
      if (c !== b.currency && one(db, 'SELECT id FROM bankroll_adjustments WHERE user_id = ? AND bankroll_id = ? LIMIT 1', [uid, b.id])) {
        return fail(res, { status: 409, error: 'This bankroll has deposits or transfers in ' + b.currency + '; its currency can no longer change' });
      }
      next.currency = c;
    }
    if (body.archived !== undefined) next.archived = body.archived ? 1 : 0;
    db.run('UPDATE bankrolls SET name = ?, starting_balance = ?, currency = ?, archived = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [next.name, next.starting_balance, next.currency, next.archived, now(), b.id, uid]);
    await saveDatabase();
    res.json({ bankroll: listBankrolls(db, uid).find((x) => x.id === b.id) });
  }));

  // Only an EMPTY bankroll can be deleted: results and ledger rows filed under it would otherwise
  // be orphaned or silently re-filed. Archive hides it instead.
  app.delete('/api/bankrolls/:id', wrap(async (req, res, db, uid) => {
    const b = own(req, res, db, uid); if (!b) return;
    const used = one(db, `SELECT
        (SELECT COUNT(*) FROM tracking_entries WHERE user_id = ? AND bankroll_id = ?) AS entries,
        (SELECT COUNT(*) FROM bankroll_adjustments WHERE user_id = ? AND bankroll_id = ?) AS adjustments`, [uid, b.id, uid, b.id]);
    if (used.entries || used.adjustments) {
      return res.status(409).json({ error: 'This bankroll has results or transactions. Archive it instead.', ...used });
    }
    db.run('DELETE FROM bankrolls WHERE id = ? AND user_id = ?', [b.id, uid]);
    await saveDatabase();
    res.json({ deleted: true });
  }));
}

module.exports = {
  MAIN, ALL, migrate, parseBankrollRef, filterFromQuery, resolveEntryBankroll, listBankrolls, mountRoutes,
};
