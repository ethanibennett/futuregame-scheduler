'use strict';
/*
 * CSV import into the bankroll ledger — BETA, app admins only (behind the /api/bankrolls gate).
 *
 * The CLIENT parses the file and maps its columns (vite-app/src/utils/bankroll-csv.js: presets
 * for the documented Poker Bankroll Tracker export and the Pokerbase "Custom Sheet" layout, plus a
 * generic column mapping), then sends NORMALISED rows here:
 *
 *   POST /api/bankrolls/import  { bankroll: 'main' | id, commit: false | true, rows: [
 *     { type: 'tournament', date: 'YYYY-MM-DD', name, buyin, entries, cash, place?, field?,
 *       game?, currency?, note? }
 *     { type: 'deposit' | 'withdrawal', date, amount (> 0), currency?, note? } ] }
 *
 * commit:false is the PREVIEW: every row comes back with a status ('new' | 'duplicate' |
 * 'error') and nothing is written. commit:true writes the 'new' rows in one transaction.
 *
 * Where rows go:
 *   tournament  a private tournaments row (venue 'Personal', the app's only per-user event —
 *               invisible to every other user and swept by account deletion, stable_id
 *               PERSONAL-<uid>-imp-…, source_pdf 'bankroll-import') + a tracking_entries row
 *               filed under the chosen bankroll. So an imported result is a result everywhere:
 *               the Results tab, analytics, the tax report and the ledger.
 *               Personal events are USD (VENUE_CURRENCY has no entry for them), so a row in
 *               another currency is converted to USD at TODAY's rate on the way in, and the
 *               original amounts are kept in the entry's notes. The preview says so per row.
 *   deposit /   bankroll_adjustments, in the bankroll's currency. A row in another currency is
 *   withdrawal  an error rather than a silent conversion (lib/bankrolls.js: a ledger is
 *               denominated in its bankroll's currency).
 *
 * DEDUPE: each row has a fingerprint — sha1 of its normalised content plus its occurrence number
 * among identical rows in the same file — stored in bankroll_import_keys with what it created.
 * Re-importing the same file finds every fingerprint and imports nothing; two genuinely identical
 * rows in one file are both kept (occurrences 1 and 2). If the row a key points to has since been
 * deleted, the key is stale and the row imports again.
 */

const crypto = require('crypto');
const analytics = require('./analytics');
const bankrolls = require('./bankrolls');

const MAX_ROWS = 5000;
const MAX_AMOUNT = 1e10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function one(db, sql, params = []) {
  const s = db.prepare(sql);
  try { s.bind(params); return s.step() ? s.getAsObject() : null; } finally { s.free(); }
}

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS bankroll_import_keys (
    user_id INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    ref_table TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, fingerprint),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const text = (v, max) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));

/** Validate + normalise one row. Returns { value } or { error }. */
function cleanRow(raw, currencies) {
  if (!raw || typeof raw !== 'object') return { error: 'Not a row' };
  const type = raw.type;
  const date = String(raw.date || '');
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) return { error: 'Date must be YYYY-MM-DD' };
  const currency = String(raw.currency || 'USD').toUpperCase();
  if (!currencies.has(currency)) return { error: `Unsupported currency ${currency}` };
  const note = text(raw.note, 200);
  if (type === 'tournament') {
    const buyin = num(raw.buyin), cash = num(raw.cash) ?? 0, entries = num(raw.entries) ?? 1;
    if (buyin === null || !Number.isFinite(buyin) || buyin < 0 || buyin > MAX_AMOUNT) return { error: 'Buy-in must be a number' };
    if (!Number.isFinite(cash) || cash < 0 || cash > MAX_AMOUNT) return { error: 'Cash must be 0 or more' };
    if (!Number.isInteger(entries) || entries < 1 || entries > 100) return { error: 'Entries must be a whole number from 1' };
    const place = num(raw.place), field = num(raw.field);
    return {
      value: {
        type, date, currency, note,
        name: text(raw.name, 120) || 'Imported tournament',
        game: text(raw.game, 40),
        buyin, cash, entries,
        place: Number.isInteger(place) && place > 0 ? place : null,
        field: Number.isInteger(field) && field > 0 ? field : null,
      },
    };
  }
  if (type === 'deposit' || type === 'withdrawal') {
    const amount = num(raw.amount);
    if (amount === null || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return { error: 'Amount must be above 0' };
    return { value: { type, date, currency, note, amount } };
  }
  return { error: 'type must be tournament, deposit or withdrawal' };
}

function fingerprintBase(r) {
  const parts = r.type === 'tournament'
    ? [r.type, r.date, r.name.toLowerCase(), r.buyin, r.entries, r.cash, r.currency]
    : [r.type, r.date, r.amount, r.currency, r.note.toLowerCase()];
  return JSON.stringify(parts);
}
/** Pure: one fingerprint per row, numbering identical rows within the file. */
function fingerprints(cleanRows) {
  const seen = new Map();
  return cleanRows.map((r) => {
    if (!r) return null;
    const base = fingerprintBase(r);
    const k = (seen.get(base) || 0) + 1;
    seen.set(base, k);
    return crypto.createHash('sha1').update(base + '#' + k).digest('hex');
  });
}

function refExists(db, uid, table, id) {
  if (table === 'tracking_entries') return !!one(db, 'SELECT id FROM tracking_entries WHERE id = ? AND user_id = ?', [id, uid]);
  if (table === 'bankroll_adjustments') return !!one(db, 'SELECT id FROM bankroll_adjustments WHERE id = ? AND user_id = ?', [id, uid]);
  return false;
}

/**
 * Pure-ish (reads only): the preview. Returns [{ index, status, error?, fingerprint, row, note? }].
 */
function plan(db, uid, rawRows, { bankrollCurrency, currencies }) {
  const cleaned = rawRows.map((r) => cleanRow(r, currencies));
  const fps = fingerprints(cleaned.map((c) => c.value || null));
  return cleaned.map((c, index) => {
    if (c.error) return { index, status: 'error', error: c.error };
    const r = c.value;
    if (r.type !== 'tournament' && r.currency !== bankrollCurrency) {
      return { index, status: 'error', error: `This bankroll is in ${bankrollCurrency}; the row is in ${r.currency}`, row: r };
    }
    const key = one(db, 'SELECT ref_table, ref_id FROM bankroll_import_keys WHERE user_id = ? AND fingerprint = ?', [uid, fps[index]]);
    const dup = key && refExists(db, uid, key.ref_table, key.ref_id);
    const out = { index, status: dup ? 'duplicate' : 'new', fingerprint: fps[index], row: r };
    if (r.type === 'tournament' && r.currency !== 'USD') out.note = `${r.currency} converted to USD at today's rate`;
    return out;
  });
}

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireAppAdmin, fetchExchangeRates } = deps;
  const CURRENCIES = new Set(deps.currencies || ['USD']);

  app.post('/api/bankrolls/import', authenticateToken, requireAppAdmin, async (req, res) => {
    const db = getDb();
    const uid = req.user.id;
    try {
      const body = req.body || {};
      const list = body.rows;
      if (!Array.isArray(list) || !list.length) return res.status(400).json({ error: 'rows must be a non-empty list' });
      if (list.length > MAX_ROWS) return res.status(400).json({ error: `At most ${MAX_ROWS} rows per import` });
      const ref = bankrolls.parseBankrollRef(body.bankroll == null ? 'main' : body.bankroll);
      if (ref.error || ref.kind === 'all') return res.status(400).json({ error: 'bankroll must be "main" or a bankroll id' });
      let bankrollId = null, bankrollCurrency = 'USD';
      if (ref.kind === 'id') {
        const b = one(db, 'SELECT id, currency, archived FROM bankrolls WHERE id = ? AND user_id = ?', [ref.id, uid]);
        if (!b) return res.status(404).json({ error: 'Bankroll not found' });
        if (b.archived) return res.status(400).json({ error: 'That bankroll is archived' });
        bankrollId = b.id; bankrollCurrency = b.currency;
      }
      const rows = plan(db, uid, list, { bankrollCurrency, currencies: CURRENCIES });
      const counts = { new: 0, duplicate: 0, error: 0 };
      for (const r of rows) counts[r.status]++;
      if (!body.commit) return res.json({ commit: false, counts, rows });

      const { rates } = await fetchExchangeRates();
      const toUSD = (v, cur) => Math.round(analytics.convert(v, cur, 'USD', rates));
      const now = new Date().toISOString();
      const stamp = Date.now();
      let imported = 0;
      db.run('BEGIN');
      try {
        for (const p of rows) {
          if (p.status !== 'new') continue;
          const r = p.row;
          db.run('DELETE FROM bankroll_import_keys WHERE user_id = ? AND fingerprint = ?', [uid, p.fingerprint]); // a stale key
          let table, id;
          if (r.type === 'tournament') {
            const conv = r.currency !== 'USD';
            const buyin = conv ? toUSD(r.buyin, r.currency) : Math.round(r.buyin);
            const cash = conv ? toUSD(r.cash, r.currency) : Math.round(r.cash);
            const notes = [r.note, conv ? `Imported in ${r.currency}: buy-in ${r.buyin}, cash ${r.cash}` : 'Imported'].filter(Boolean).join(' · ');
            db.run(`INSERT INTO tournaments (stable_id, event_number, event_name, date, time, buyin, game_variant, venue, notes, uploaded_by, total_entries, source_pdf)
                    VALUES (?, '', ?, ?, '', ?, ?, 'Personal', '', ?, ?, 'bankroll-import')`,
              [`PERSONAL-${uid}-imp-${stamp}-${p.index}`, r.name, r.date, buyin, r.game, uid, r.field]);
            const tid = one(db, 'SELECT last_insert_rowid() AS id').id;
            db.run(`INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, finish_place, cash_amount, notes, bankroll_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [uid, tid, r.entries, cash > 0 ? 1 : 0, r.place, cash, notes, bankrollId]);
            table = 'tracking_entries'; id = one(db, 'SELECT last_insert_rowid() AS id').id;
          } else {
            const amount = Math.round(r.amount) * (r.type === 'deposit' ? 1 : -1);
            db.run(`INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, transfer_id, occurred_on, note, created_at)
                    VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`, [uid, bankrollId, r.type, amount, r.date, r.note || 'Imported', now]);
            table = 'bankroll_adjustments'; id = one(db, 'SELECT last_insert_rowid() AS id').id;
          }
          db.run('INSERT INTO bankroll_import_keys (user_id, fingerprint, ref_table, ref_id, created_at) VALUES (?, ?, ?, ?, ?)',
            [uid, p.fingerprint, table, id, now]);
          imported++;
        }
        db.run('COMMIT');
      } catch (e) { try { db.run('ROLLBACK'); } catch (_) { /* nothing open */ } throw e; }
      if (imported) await saveDatabase();
      res.json({ commit: true, imported, counts, rows: rows.map(({ row, ...r }) => r) });
    } catch (err) {
      console.error('[bankroll-import]', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });
}

module.exports = { migrate, mountRoutes, cleanRow, fingerprints, plan, MAX_ROWS };
