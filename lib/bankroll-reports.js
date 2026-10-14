'use strict';
/*
 * Bankroll reports — BETA, app admins only (authenticateToken + requireAppAdmin, like every
 * /api/bankrolls route).
 *
 * The Reports tab of the bankroll dashboard filters and breaks down results by room, game, stakes /
 * buy-in, day of week, start time, session length and month. The ledger (lib/bankroll-ledger.js)
 * carries money, not those dimensions — a tournament's room, game and online flag live on
 * `tournaments`, a cash session's start and length on `cash_sessions` — so this route returns one
 * FACT per thing played or spent, with its dimensions, amounts already in the display currency.
 * The client filters and groups them (vite-app/src/utils/bankroll-filters.js): chip counts need
 * the unfiltered set anyway, and a few thousand rows is nothing to filter in the page.
 *
 *     GET /api/bankrolls/reports?bankroll=&from=&to=&currency=
 *     → { currency, bankroll, from, to, rates_stale, facts: [...] }
 *
 * A fact:
 *   { id: 't12' | 'c3' | 'x5', type: 'tournament' | 'cash' | 'expense' | 'income',
 *     bankroll: 'main' | id, date: 'YYYY-MM-DD', label,
 *     profit,                 signed, display currency (the same nets as the ledger sources)
 *     room, game, online,     where and what ('' when unknown; expenses have none)
 *     hour,                   0-23 local start hour for tournaments (the event's own time), else null
 *     started_at, hours,      cash: the ISO start (the client reads the player's local hour from it;
 *                             null when the session's start time is not known, cash_sessions.time_known = 0)
 *                             and the length in hours
 *     stakes,                 cash: '2/5' (as stored, normalised by lib/cash-sessions.js)
 *     native_profit,          cash: the same net in the session's own currency (native_currency), whole
 *                             units. bb/hr divides it by the big blind read from `stakes`, which is
 *                             written in that same money (utils/bb-hr.js); `profit` is converted
 *                             and would need the rate back
 *     buyin, buyin_usd,       tournament: per bullet (display currency / USD — bands cut on USD)
 *     bullets, cost, cash,    tournament: bullets, total cost and the cash, display currency
 *     category,               expense / income: its category
 *     native_currency }       the currency it was played or spent in, before conversion
 *                             (a tournament: its venue's; a session or a row: its own)
 *
 * Money follows the existing rules exactly: a tournament nets (cashed ? cash : 0) - buyin x
 * max(1, entries) in the venue's currency (lib/analytics.js normaliseRow), a cash session
 * cash_out - buy_in - tips - expenses (lib/ledger-sources/cash-sessions.js), a transaction its
 * amount, negative for an expense. Converted through USD at the current rates, as everywhere.
 * A live cash session (ended_at NULL) is not a fact, as it is not in the ledger.
 *
 * Live vs online: tournaments carry is_online. Cash sessions have no such column; a session is
 * online when its room names a known online site (ONLINE_ROOM below), else live.
 */

const bankrolls = require('./bankrolls');
const { convert, normaliseRow, nativeCurrency } = require('./analytics');

// The online-room test moved to lib/staking/classify.js, which the standing-% classifier shares; it
// is re-exported below so existing callers keep working.
const { ONLINE_ROOM } = require('./staking/classify');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const round2 = (v) => Math.round(v * 100) / 100;

function tableExists(db, name) {
  const r = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${name}'`);
  return !!(r.length && r[0].values.length);
}
function rows(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
function hasColumn(db, table, col) {
  const r = db.exec(`PRAGMA table_info(${table})`);
  return !!(r.length && r[0].values.some((v) => v[1] === col));
}

/** "11:00 AM", "7:30 pm", "14:00" → 0..23, or null when the time does not parse. */
function startHour(time) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$/.exec(String(time || ''));
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) { if (h < 1 || h > 12) return null; h = h % 12; if (/p/i.test(m[3])) h += 12; }
  return h >= 0 && h <= 23 ? h : null;
}

const keyOf = (id) => (id == null ? bankrolls.MAIN : Number(id));

function inRange(date, from, to) {
  return !!date && (!from || date >= from) && (!to || date <= to);
}

/**
 * Every fact for one user. Reads `db`, writes nothing. The bankroll is already checked to be the
 * caller's (the route runs bankrolls.filterFromQuery first).
 * opts = { bankroll: 'all' | 'main' | id, from, to, currency, rates }.
 */
function collectFacts(db, userId, opts = {}) {
  const { bankroll = 'all', from = null, to = null, currency = 'USD', rates = null } = opts;
  const scope = (col) => {
    if (bankroll === 'all' || bankroll == null) return { sql: '', params: [] };
    if (bankroll === 'main') return { sql: ` AND ${col} IS NULL`, params: [] };
    return { sql: ` AND ${col} = ?`, params: [bankroll] };
  };
  const facts = [];

  // Tournaments: tracking rows joined to their event.
  {
    const s = scope('te.bankroll_id');
    const cols = ['property', 'is_online', 'site'].map((c) => (hasColumn(db, 'tournaments', c) ? `t.${c}` : `NULL AS ${c}`)).join(', ');
    const list = rows(db, `SELECT te.id, te.num_entries, te.cashed, te.cash_amount, te.bankroll_id, te.created_at,
        t.event_name, t.date, t.time, t.buyin, t.game_variant, t.venue, ${cols}
      FROM tracking_entries te JOIN tournaments t ON t.id = te.tournament_id
      WHERE te.user_id = ?${s.sql}`, [userId, ...s.params]);
    for (const r of list) {
      const n = normaliseRow(r, currency, rates);
      const date = n.date || String(r.created_at || '').slice(0, 10);
      if (!DATE_RE.test(date) || !inRange(date, from, to)) continue;
      facts.push({
        id: 't' + r.id, type: 'tournament', bankroll: keyOf(r.bankroll_id), date,
        label: String(r.event_name || 'Tournament'),
        profit: round2(n.profit), room: n.room === 'Unknown' ? '' : n.room,
        game: n.variant === 'Unknown' ? '' : n.variant, online: n.online,
        hour: startHour(r.time), started_at: null, hours: null, stakes: '',
        buyin: round2(n.buyin), buyin_usd: round2(n.buyinUSD), bullets: n.bullets,
        cost: round2(n.cost), cash: round2(n.cash), category: '',
        native_currency: nativeCurrency(r.venue),
      });
    }
  }

  // Cash sessions: ended ones only.
  if (tableExists(db, 'cash_sessions')) {
    const s = scope('cs.bankroll_id');
    // time_known = 0 (an imported or chat-logged session: a day and a length, no start time) carries
    // a PLACEHOLDER started_at. The client reads a cash fact's hour of day from started_at, so such a
    // fact must not carry it, or the start-time and daypart reports would see a made-up noon.
    // `hours` still comes from the stored span. A database that predates the column reads every row
    // as known.
    const timeCol = hasColumn(db, 'cash_sessions', 'time_known') ? 'cs.time_known' : '1 AS time_known';
    const list = rows(db, `SELECT cs.id, cs.bankroll_id, cs.started_at, cs.ended_at, cs.session_date, cs.room, cs.game,
        cs.stakes, cs.buy_in, cs.cash_out, cs.tips, cs.expenses, cs.currency, ${timeCol}
      FROM cash_sessions cs WHERE cs.user_id = ? AND cs.ended_at IS NOT NULL${s.sql}`, [userId, ...s.params]);
    for (const r of list) {
      if (!inRange(r.session_date, from, to)) continue;
      const net = (Number(r.cash_out) || 0) - (Number(r.buy_in) || 0) - (Number(r.tips) || 0) - (Number(r.expenses) || 0);
      const ms = Date.parse(r.ended_at) - Date.parse(r.started_at);
      const room = String(r.room || '').trim();
      const what = [r.game, r.stakes].filter(Boolean).join(' ');
      facts.push({
        id: 'c' + r.id, type: 'cash', bankroll: keyOf(r.bankroll_id), date: r.session_date,
        label: `Cash ${what || 'session'}${room ? ' · ' + room : ''}`,
        profit: round2(convert(net, r.currency || 'USD', currency, rates)), native_profit: net,
        room, game: String(r.game || '').trim(), online: ONLINE_ROOM.test(room),
        hour: null, started_at: Number(r.time_known) === 0 ? null : r.started_at,
        hours: Number.isFinite(ms) && ms > 0 ? round2(ms / 36e5) : 0,
        stakes: String(r.stakes || '').trim(),
        buyin: null, buyin_usd: null, bullets: null, cost: null, cash: null, category: '',
        native_currency: r.currency || 'USD',
      });
    }
  }

  // Expenses and non-game income.
  if (tableExists(db, 'bankroll_transactions')) {
    const s = scope('bt.bankroll_id');
    const list = rows(db, `SELECT bt.id, bt.bankroll_id, bt.occurred_on, bt.kind, bt.category, bt.amount, bt.currency, bt.note
      FROM bankroll_transactions bt WHERE bt.user_id = ?${s.sql}`, [userId, ...s.params]);
    for (const r of list) {
      if (!inRange(r.occurred_on, from, to)) continue;
      const kind = r.kind === 'income' ? 'income' : 'expense';
      const amt = Math.abs(Number(r.amount) || 0) * (kind === 'income' ? 1 : -1);
      facts.push({
        id: 'x' + r.id, type: kind, bankroll: keyOf(r.bankroll_id), date: r.occurred_on,
        label: String(r.note || r.category || kind),
        profit: round2(convert(amt, r.currency || 'USD', currency, rates)),
        room: '', game: '', online: false, hour: null, started_at: null, hours: null, stakes: '',
        buyin: null, buyin_usd: null, bullets: null, cost: null, cash: null, category: String(r.category || 'other'),
        native_currency: r.currency || 'USD',
      });
    }
  }

  facts.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return facts;
}

/** deps: { getDb, authenticateToken, requireAppAdmin, currencies, fetchExchangeRates } */
function mountRoutes(app, deps) {
  const { getDb, authenticateToken, requireAppAdmin, fetchExchangeRates } = deps;
  const CURRENCIES = new Set(deps.currencies || ['USD']);
  app.get('/api/bankrolls/reports', authenticateToken, requireAppAdmin, async (req, res) => {
    try {
      const db = getDb();
      const uid = req.user.id;
      const f = bankrolls.filterFromQuery(db, uid, req.query.bankroll, 'bankroll_id');
      if (f.error) return res.status(f.status).json({ error: f.error });
      const currency = String(req.query.currency || 'USD').toUpperCase();
      if (!CURRENCIES.has(currency)) return res.status(400).json({ error: 'Unsupported currency' });
      const date = (raw) => (raw === undefined || raw === '' ? null : DATE_RE.test(String(raw)) ? String(raw) : undefined);
      const from = date(req.query.from), to = date(req.query.to);
      if (from === undefined || to === undefined) return res.status(400).json({ error: 'from / to must be YYYY-MM-DD' });
      if (from && to && from > to) return res.status(400).json({ error: 'from is after to' });
      const bankroll = f.ref.kind === 'all' ? 'all' : f.ref.kind === 'main' ? 'main' : f.ref.id;
      const cache = await fetchExchangeRates();
      const facts = collectFacts(db, uid, { bankroll, from, to, currency, rates: cache.rates });
      res.json({ currency, bankroll, from, to, rates_stale: !!cache.stale, facts });
    } catch (err) {
      console.error('[reports]', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });
}

module.exports = { collectFacts, mountRoutes, startHour, ONLINE_ROOM };
