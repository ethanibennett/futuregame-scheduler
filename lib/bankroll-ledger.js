'use strict';
/*
 * The combined bankroll ledger — BETA, app admins only (the /api/bankrolls gate in
 * lib/bankrolls.js covers every route here).
 *
 * One ledger, many sources. Every module in lib/ledger-sources/*.js is a SOURCE, loaded at boot
 * and in filename order:
 *
 *     module.exports = {
 *       name: 'tournaments',                       // unique; tags every entry it returns
 *       entries(db, userId, opts) { return [...] } // opts = { bankroll, from, to }
 *     };
 *
 *   opts.bankroll  'all' | 'main' | <bankroll id, a number> — already checked to be the
 *                  caller's. 'main' means bankroll_id IS NULL. A source SHOULD filter on it (the
 *                  loader filters again, so one that ignores it is wrong only in cost).
 *   opts.from/to   'YYYY-MM-DD' or null, inclusive. The loader asks with from = null, because a
 *                  running balance needs every entry before the window; honour them anyway.
 *
 * Each entry:
 *     { date: 'YYYY-MM-DD',          // the day the money moved
 *       ts: ISO string | null,       // finer order within a day, when the source knows it
 *       amount: number,              // SIGNED, in `currency`: + money in, − money out
 *       currency: 'USD',             // ISO code
 *       bankroll_id: number | null,  // null = Main (lib/bankrolls.js: Main is virtual)
 *       kind: 'tournament',          // the entry's own kind (deposit, transfer_in, expense…)
 *       label: 'Event name',         // one line for a person
 *       ref: { table, id } }         // the row it came from
 * Extra fields are kept and passed through (the tournaments source adds units/cost/cash).
 * An entry that breaks the shape is dropped and counted (`invalid` in the source report); a
 * source that THROWS is reported (`ok: false`) and contributes nothing, so one broken source
 * cannot take the ledger down, and the client can say which part is missing.
 *
 * ── Balances ──────────────────────────────────────────────────────────────────────────────
 *     balance(bankroll) = starting_balance + Σ entries filed under it
 * kept in the BANKROLL'S currency (an entry in another currency is converted into it), and
 * converted to the requested display currency for the running total. Conversion is through USD
 * at the CURRENT rates (fetchExchangeRates, the same table the Results tab and lib/analytics.js
 * use) — not the rate on the day. That is what the Results tab has always done, so the two
 * agree; it also means a EUR result's USD value moves with the rate.
 *
 * Order: date, then ts (an entry with no ts first: a deposit funds that day's play), then source
 * name, then ref id. Deterministic, so a reload never reshuffles the running balance.
 */

const fs = require('fs');
const path = require('path');
const { convert, BUYIN_BANDS } = require('./analytics');
const bankrolls = require('./bankrolls');

const DEFAULT_SOURCES_DIR = path.join(__dirname, 'ledger-sources');
// Money moved between pockets or in/out of poker, not won or lost at the table.
const MOVE_KINDS = new Set(['deposit', 'withdrawal', 'transfer_in', 'transfer_out']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const round2 = (v) => Math.round(v * 100) / 100;

// ── Loader ───────────────────────────────────────────────────────────────────────────────
/**
 * Every *.js in `dir` (default lib/ledger-sources, or BANKROLL_LEDGER_SOURCES_DIR — tests point it
 * at a temp dir). Returns { sources: [{ name, entries, file }], errors: [{ file, error }] }.
 */
function loadSources(dir) {
  const d = dir || process.env.BANKROLL_LEDGER_SOURCES_DIR || DEFAULT_SOURCES_DIR;
  const out = { sources: [], errors: [] };
  let files = [];
  try { files = fs.readdirSync(d).filter((f) => f.endsWith('.js')).sort(); } catch (e) {
    out.errors.push({ file: d, error: 'cannot read sources dir: ' + e.message });
    return out;
  }
  const seen = new Set();
  for (const f of files) {
    try {
      const mod = require(path.join(d, f));
      if (!mod || typeof mod.name !== 'string' || !mod.name || typeof mod.entries !== 'function') {
        out.errors.push({ file: f, error: 'a source exports { name, entries(db, userId, opts) }' });
        continue;
      }
      if (seen.has(mod.name)) { out.errors.push({ file: f, error: `duplicate source name "${mod.name}"` }); continue; }
      seen.add(mod.name);
      out.sources.push({ name: mod.name, entries: mod.entries, file: f });
    } catch (e) {
      out.errors.push({ file: f, error: e.message });
    }
  }
  return out;
}

function validEntry(e) {
  return !!e && typeof e === 'object'
    && typeof e.date === 'string' && DATE_RE.test(e.date)
    && typeof e.amount === 'number' && Number.isFinite(e.amount)
    && typeof e.currency === 'string' && /^[A-Z]{3}$/.test(e.currency)
    && (e.bankroll_id === null || (Number.isInteger(e.bankroll_id) && e.bankroll_id > 0))
    && typeof e.kind === 'string' && !!e.kind
    && (e.ts === null || e.ts === undefined || typeof e.ts === 'string')
    && !!e.ref && typeof e.ref === 'object';
}

function inScope(bankrollId, bankroll) {
  if (bankroll === 'all' || bankroll == null) return true;
  if (bankroll === 'main') return bankrollId === null;
  return bankrollId === bankroll;
}

/**
 * Every source's entries for the caller, validated, tagged with `source`, filtered to the scope
 * and range, and sorted. opts = { bankroll: 'all'|'main'|id, from, to }.
 * Returns { entries, report: [{ name, ok, count, invalid, error? }] }.
 */
function collect(db, userId, opts, loaded) {
  const { bankroll = 'all', from = null, to = null } = opts || {};
  const L = loaded || loadSources();
  const entries = [];
  const report = [];
  for (const src of L.sources) {
    const r = { name: src.name, ok: true, count: 0, invalid: 0 };
    let list;
    try { list = src.entries(db, userId, { bankroll, from, to }); } catch (e) {
      console.error(`[ledger] source ${src.name} failed:`, e.message);
      report.push({ ...r, ok: false, error: e.message });
      continue;
    }
    for (const e of Array.isArray(list) ? list : []) {
      if (!validEntry(e)) { r.invalid++; continue; }
      if (!inScope(e.bankroll_id, bankroll)) continue;
      if ((from && e.date < from) || (to && e.date > to)) continue;
      entries.push({ ...e, ts: e.ts || null, label: e.label == null ? '' : String(e.label), source: src.name });
      r.count++;
    }
    report.push(r);
  }
  for (const e of L.errors) report.push({ name: e.file, ok: false, count: 0, invalid: 0, error: e.error });
  entries.sort(compareEntries);
  return { entries, report };
}

function compareEntries(a, b) {
  return a.date.localeCompare(b.date)
    || (a.ts || '').localeCompare(b.ts || '')
    || a.source.localeCompare(b.source)
    || String(a.ref.table || '').localeCompare(String(b.ref.table || ''))
    || (Number(a.ref.id) || 0) - (Number(b.ref.id) || 0);
}

// ── The running balance ──────────────────────────────────────────────────────────────────
const keyOf = (bankrollId) => (bankrollId == null ? bankrolls.MAIN : bankrollId);

/**
 * Pure. Running balances over SORTED entries (collect()'s output, unfiltered by date).
 *   bankrollList  lib/bankrolls listBankrolls() rows: { id: 'main'|n, currency, starting_balance }
 *   scope         'all' | 'main' | id — which bankrolls' starting balances count
 *   currency      display currency; rates = units per 1 USD
 *   from / to     the window to RETURN; everything before `from` still builds the opening balance
 * Each returned entry gains: bankroll ('main'|id), bankroll_currency, amount_bankroll,
 * amount_display, balance (that bankroll, its currency), balance_display (that bankroll, display),
 * total_display (every bankroll in scope, display). Plus per-bankroll opening/closing balances.
 */
function runningBalances(entries, { bankrollList, scope = 'all', currency = 'USD', rates = null, from = null, to = null }) {
  const books = new Map();
  for (const b of bankrollList || []) {
    if (!inScope(b.id === bankrolls.MAIN ? null : b.id, scope)) continue;
    books.set(b.id, { id: b.id, name: b.name, currency: b.currency || 'USD', start: Number(b.starting_balance) || 0, run: 0 });
  }
  for (const bk of books.values()) bk.run = bk.start;
  const disp = (v, cur) => convert(v, cur, currency, rates);
  let total = 0;
  for (const bk of books.values()) total += disp(bk.start, bk.currency);

  const snapshot = () => {
    const per = {};
    for (const bk of books.values()) per[bk.id] = { balance: round2(bk.run), currency: bk.currency, balance_display: round2(disp(bk.run, bk.currency)) };
    return { per, total_display: round2(total) };
  };
  const out = [];
  let opening = null;
  let dropped = 0;
  for (const e of entries) {
    if (from && opening === null && e.date >= from) opening = snapshot();
    if (to && e.date > to) break;
    const bk = books.get(keyOf(e.bankroll_id));
    if (!bk) { dropped++; continue; }
    const amtB = convert(e.amount, e.currency, bk.currency, rates);
    bk.run += amtB;
    total += disp(amtB, bk.currency);
    if (from && e.date < from) continue;
    out.push({
      ...e,
      bankroll: bk.id,
      bankroll_currency: bk.currency,
      amount_bankroll: round2(amtB),
      amount_display: round2(disp(amtB, bk.currency)),
      balance: round2(bk.run),
      balance_display: round2(disp(bk.run, bk.currency)),
      total_display: round2(total),
    });
  }
  if (opening === null) opening = from ? snapshot() : null;
  // Without a `from`, the opening balance is the starting balances.
  if (!from) {
    const per = {};
    let t = 0;
    for (const bk of books.values()) { per[bk.id] = { balance: bk.start, currency: bk.currency, balance_display: round2(disp(bk.start, bk.currency)) }; t += disp(bk.start, bk.currency); }
    opening = { per, total_display: round2(t) };
  }
  return { entries: out, opening, closing: snapshot(), dropped };
}

/**
 * Pure. Totals per bankroll (in its currency) and for everything in scope (display currency):
 * start, by source, by kind, moved (deposits/withdrawals/transfers), results (everything else),
 * balance. `entries` = runningBalances(...).entries over the whole history.
 */
function summarise(ledger, { bankrollList, scope = 'all', currency = 'USD', rates = null }) {
  const rows = new Map();
  for (const b of bankrollList || []) {
    if (!inScope(b.id === bankrolls.MAIN ? null : b.id, scope)) continue;
    const start = Number(b.starting_balance) || 0;
    rows.set(b.id, {
      id: b.id, name: b.name, currency: b.currency || 'USD', archived: !!b.archived, is_main: b.id === bankrolls.MAIN,
      start, moved: 0, results: 0, balance: start, by_source: {}, by_kind: {}, count: 0,
    });
  }
  const all = { currency, start: 0, moved: 0, results: 0, balance: 0, by_source: {}, by_kind: {}, count: 0 };
  for (const r of rows.values()) { all.start += convert(r.start, r.currency, currency, rates); }
  for (const e of ledger.entries) {
    const r = rows.get(e.bankroll);
    if (!r) continue;
    const a = e.amount_bankroll;
    const d = convert(a, r.currency, currency, rates);
    const move = MOVE_KINDS.has(e.kind);
    r.balance += a; r.count++;
    if (move) r.moved += a; else r.results += a;
    r.by_source[e.source] = (r.by_source[e.source] || 0) + a;
    r.by_kind[e.kind] = (r.by_kind[e.kind] || 0) + a;
    all.count++;
    if (move) all.moved += d; else all.results += d;
    all.by_source[e.source] = (all.by_source[e.source] || 0) + d;
    all.by_kind[e.kind] = (all.by_kind[e.kind] || 0) + d;
  }
  const fix = (o) => {
    for (const f of ['start', 'moved', 'results', 'balance']) o[f] = round2(o[f]);
    for (const m of ['by_source', 'by_kind']) for (const k of Object.keys(o[m])) o[m][k] = round2(o[m][k]);
    return o;
  };
  const list = [...rows.values()].map(fix);
  all.balance = all.start + all.moved + all.results;
  return { bankrolls: list, all: fix(all) };
}

/** Recent per-bullet buy-ins (tournament entries, newest last) for the rules guide. */
function recentBuyins(entries, n = 20) {
  const out = [];
  for (let i = entries.length - 1; i >= 0 && out.length < n; i--) {
    const e = entries[i];
    if (e.source !== 'tournaments' || !(e.buyin_per_entry > 0)) continue;
    out.push({ buyin: e.buyin_per_entry, currency: e.currency });
  }
  return out.reverse();
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────
/**
 * deps: { getDb, authenticateToken, requireAppAdmin, currencies, fetchExchangeRates,
 *         sourcesDir?, management? }   (management = lib/bankroll-management, for the guide)
 */
function mountRoutes(app, deps) {
  const { getDb, authenticateToken, requireAppAdmin, fetchExchangeRates } = deps;
  const CURRENCIES = new Set(deps.currencies || ['USD']);
  const loaded = loadSources(deps.sourcesDir);
  for (const e of loaded.errors) console.error('[ledger] source not loaded:', e.file, e.error);
  console.log('[ledger] sources:', loaded.sources.map((s) => s.name).join(', ') || '(none)');

  const fail = (res, status, error) => res.status(status).json({ error });
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res, getDb(), req.user.id); } catch (err) {
      console.error('[ledger]', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  const parseCurrency = (raw) => {
    const c = String(raw || 'USD').toUpperCase();
    return CURRENCIES.has(c) ? c : null;
  };
  const parseDate = (raw) => (raw === undefined || raw === '' ? null : DATE_RE.test(String(raw)) ? String(raw) : undefined);
  const scopeOf = (f) => (f.ref.kind === 'all' ? 'all' : f.ref.kind === 'main' ? 'main' : f.ref.id);

  async function build(db, uid, { bankroll, from, to, currency }) {
    const cache = await fetchExchangeRates();
    const list = bankrolls.listBankrolls(db, uid);
    const { entries, report } = collect(db, uid, { bankroll, from: null, to }, loaded);
    const ledger = runningBalances(entries, { bankrollList: list, scope: bankroll, currency, rates: cache.rates, from, to });
    return { cache, list, all: entries, ledger, report };
  }

  // GET /api/bankrolls/ledger?bankroll=&from=&to=&currency=
  app.get('/api/bankrolls/ledger', authenticateToken, requireAppAdmin, wrap(async (req, res, db, uid) => {
    const f = bankrolls.filterFromQuery(db, uid, req.query.bankroll, 'bankroll_id');
    if (f.error) return fail(res, f.status, f.error);
    const currency = parseCurrency(req.query.currency);
    if (!currency) return fail(res, 400, 'Unsupported currency');
    const from = parseDate(req.query.from), to = parseDate(req.query.to);
    if (from === undefined || to === undefined) return fail(res, 400, 'from / to must be YYYY-MM-DD');
    if (from && to && from > to) return fail(res, 400, 'from is after to');
    const scope = scopeOf(f);
    const { cache, ledger, report } = await build(db, uid, { bankroll: scope, from, to, currency });
    res.json({
      currency, bankroll: scope, from, to,
      rates_stale: !!cache.stale,
      opening: ledger.opening, closing: ledger.closing,
      entries: ledger.entries.map(({ buyin_per_entry, ...e }) => e),
      dropped: ledger.dropped,
      sources: report,
    });
  }));

  // GET /api/bankrolls/summary?currency= — every bankroll's balance (its currency) and the total.
  app.get('/api/bankrolls/summary', authenticateToken, requireAppAdmin, wrap(async (req, res, db, uid) => {
    const currency = parseCurrency(req.query.currency);
    if (!currency) return fail(res, 400, 'Unsupported currency');
    const { cache, list, all, ledger, report } = await build(db, uid, { bankroll: 'all', from: null, to: null, currency });
    const sum = summarise(ledger, { bankrollList: list, scope: 'all', currency, rates: cache.rates });
    let guide = null;
    if (deps.management) guide = deps.management.guideFor(db, uid, { summary: sum, entries: all, currency, rates: cache.rates });
    res.json({ currency, rates: cache.rates, rates_stale: !!cache.stale, ...sum, guide, sources: report });
  }));
}

module.exports = {
  loadSources, collect, runningBalances, summarise, recentBuyins, compareEntries, validEntry, mountRoutes,
  MOVE_KINDS, DEFAULT_SOURCES_DIR, BUYIN_BANDS,
};
