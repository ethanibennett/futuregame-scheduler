'use strict';
/*
 * Cash game sessions — BETA, app admins only (requireAppAdmin on every route here).
 *
 * A cash session is one sitting at one game: where (free text, plus the cash watcher's venue slug
 * when the player picked a room the app knows), what (game + stakes), when (started_at/ended_at,
 * ISO instants, and session_date, the LOCAL calendar day it started — the server cannot know the
 * player's zone, and a session that starts at 8pm on Dec 31 in New York belongs to that year, not
 * to the UTC day it began on), and money: buy_in is the TOTAL put on the table (first buy-in plus
 * every rebuy, `rebuys` counts the rebuys), cash_out what came off it, tips and expenses (food,
 * parking) optional costs of playing.
 *
 *     result = cash_out - buy_in                  what the table did
 *     net    = cash_out - buy_in - tips - expenses   what the bankroll did
 *
 * ended_at NULL = a LIVE session: started at the table, still running. It has no cash_out yet and
 * contributes nothing to stats or to the bankroll ledger until it is ended. At most one live session
 * per user (409 on a second start), which is what lets the app show one running clock.
 *
 * bankroll_id NULL = Main, as everywhere in lib/bankrolls.js; the shared ?bankroll= filter applies
 * with column cs.bankroll_id. Amounts are whole currency units (INTEGER), like the rest of the
 * bankroll beta; currency defaults to the bankroll's.
 *
 * The bankroll ledger reads ended sessions through lib/ledger-sources/cash-sessions.js.
 *
 * Stack updates (cash_session_stacks): during a live session the player can record what is in front
 * of them; each row keeps the buy-in at that moment, so the client draws the session's swing. They are
 * a record of the session, not money: nothing in stats or the ledger reads them.
 */

const bankrolls = require('./bankrolls');

const MAX_AMOUNT = 1e9;
const MAX_HOURS = 72;
const MAX_ROOM = 60;
const MAX_GAME = 24;
const MAX_STAKES = 20;
const MAX_NOTES = 500;
const MAX_TAGS = 10;
const MAX_TAG = 24;
const LIST_LIMIT = 5000;

// The app's own variant names (vite-app utils GAME_VARIANT colours / hand-shorthand), in the order a
// cash player reaches for them. The server accepts any short label; this is the client's menu.
const CASH_GAMES = ['NLH', 'PLO', 'PLO5', 'PLO6', 'PLO8', 'Big O', 'LHE', 'O8', 'Stud Hi', 'Stud 8', 'Razz', 'Mixed'];

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

// ── Schema ── run from server.js dataMigrations ('cash-sessions-2026-10'), after the bankrolls one.
function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS cash_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bankroll_id INTEGER,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    session_date TEXT NOT NULL,
    room TEXT NOT NULL DEFAULT '',
    venue_slug TEXT,
    game TEXT NOT NULL DEFAULT 'NLH',
    stakes TEXT NOT NULL DEFAULT '',
    buy_in INTEGER NOT NULL DEFAULT 0,
    rebuys INTEGER NOT NULL DEFAULT 0,
    cash_out INTEGER,
    tips INTEGER NOT NULL DEFAULT 0,
    expenses INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    notes TEXT,
    subtitle TEXT,   -- the line under the game on a backer's card (owner, 2026-10-15); old databases get it at boot
    tags TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (bankroll_id) REFERENCES bankrolls(id)
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_cash_sessions_user ON cash_sessions(user_id, session_date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_cash_sessions_bankroll ON cash_sessions(user_id, bankroll_id)');
}

// ── Stack updates ── run from server.js dataMigrations ('cash-session-stacks-2026-10'), after the
// sessions one. One row per "my stack is now N" during a live session: `amount` is the chips in front
// of the player (whole currency units), `invested` the session's buy_in (rebuys included) at that
// moment, so amount - invested is where the session stood then — the in-session swing graph — and a
// later rebuy does not rewrite earlier points. Rows belong to the session's owner (user_id, for
// account deletion) and go when the session is deleted.
function migrateStacks(db) {
  db.run(`CREATE TABLE IF NOT EXISTS cash_session_stacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    at TEXT NOT NULL,
    amount INTEGER NOT NULL,
    invested INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES cash_sessions(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_cash_session_stacks_session ON cash_session_stacks(session_id, at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_cash_session_stacks_user ON cash_session_stacks(user_id)');
}
const MAX_STACKS = 500;
function shapeStack(r) {
  return { id: r.id, at: r.at, amount: r.amount, invested: r.invested, result: r.amount - r.invested };
}
/** A session's stack updates, oldest first. The caller has already checked the session is userId's. */
function listStacks(db, userId, sessionId) {
  return rows(db, 'SELECT id, at, amount, invested FROM cash_session_stacks WHERE session_id = ? AND user_id = ? ORDER BY at, id',
    [sessionId, userId]).map(shapeStack);
}

// ── Validation ──
const nowIso = () => new Date().toISOString();
const bad = (error, status = 400) => ({ status, error });

function cleanAmount(raw, label, { positive = false, optional = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    return optional ? { value: 0 } : bad(`${label} is required`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return bad(`${label} must be a number`);
  const v = Math.round(n);
  if (v < 0) return bad(`${label} cannot be negative`);
  if (v > MAX_AMOUNT) return bad(`${label} is too large`);
  if (positive && v <= 0) return bad(`${label} must be greater than 0`);
  return { value: v };
}
function cleanCount(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: 0 };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return bad('rebuys must be a whole number from 0 to 999');
  return { value: n };
}
function cleanInstant(raw, label) {
  if (raw === undefined || raw === null || raw === '') return bad(`${label} is required`);
  const t = Date.parse(String(raw));
  if (Number.isNaN(t)) return bad(`${label} must be a date and time`);
  // A session cannot start more than a day ahead (a clock or zone slip, not a plan).
  if (t > Date.now() + 24 * 3600e3) return bad(`${label} is in the future`);
  return { value: new Date(t).toISOString(), ms: t };
}
function cleanDay(raw, fallbackIso) {
  if (raw === undefined || raw === null || raw === '') return { value: String(fallbackIso).slice(0, 10) };
  const s = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) return bad('date must be YYYY-MM-DD');
  return { value: s };
}
function cleanText(raw, max) {
  if (raw === undefined || raw === null) return '';
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, max);
}
// "$2/$5", "2-5", "2 / 5", "1/2/5" -> "2/5", "1/2/5" so per-stakes stats group what the player
// typed in different ways. Anything else is kept as typed ("2/5 cap", "NL200").
function cleanStakes(raw) {
  const s = cleanText(raw, MAX_STAKES);
  const bare = s.replace(/[$\s]/g, '');
  if (/^\d+(?:\.\d+)?(?:[/-]\d+(?:\.\d+)?){1,2}$/.test(bare)) return bare.replace(/-/g, '/');
  return s;
}
function cleanGame(raw) {
  const s = cleanText(raw, MAX_GAME);
  if (!s) return 'NLH';
  const known = CASH_GAMES.find((g) => g.toLowerCase() === s.toLowerCase());
  return known || s;
}
function cleanSlug(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const s = String(raw).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(s)) return bad('venueSlug is not a venue slug');
  return { value: s };
}
function cleanTags(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: [] };
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const out = [];
  const seen = new Set();
  for (const t of list) {
    if (typeof t !== 'string' && typeof t !== 'number') return bad('tags must be a list of words');
    const v = cleanText(t, MAX_TAG);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  if (out.length > MAX_TAGS) return bad(`At most ${MAX_TAGS} tags`);
  return { value: out };
}
/* The line under the game on a backer's session card (owner, 2026-10-15): a few words of the owner's,
   typed with the session ("Main game, table 4"). One line, at most 60 characters; empty is none. */
const MAX_SUBTITLE = 60;
function cleanSubtitle(raw) {
  const s = raw === undefined || raw === null ? '' : String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_SUBTITLE);
  return s || null;
}

function cleanNotes(raw) {
  const s = raw === undefined || raw === null ? '' : String(raw).trim().slice(0, MAX_NOTES);
  return s || null;
}

/** 'main' | id | undefined in a body -> { set, id } for the CALLER (archived refused unless unchanged). */
function resolveBankroll(db, userId, raw, current) {
  if (raw === undefined) return { set: false };
  if (raw === null || raw === '' || raw === bankrolls.MAIN) return { set: true, id: null, currency: 'USD' };
  const ref = bankrolls.parseBankrollRef(raw);
  if (ref.error || ref.kind !== 'id') return bad('bankroll must be "main" or a bankroll id');
  const b = one(db, 'SELECT id, currency, archived FROM bankrolls WHERE id = ? AND user_id = ?', [ref.id, userId]);
  if (!b) return bad('Bankroll not found', 404);
  if (b.archived && current !== b.id) return bad('That bankroll is archived');
  return { set: true, id: b.id, currency: b.currency };
}

// ── Shape ──
function parseTags(s) {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : []; } catch (_) { return []; }
}
function hoursBetween(a, b) {
  const ms = Date.parse(b) - Date.parse(a);
  return Number.isFinite(ms) && ms > 0 ? ms / 3600e3 : 0;
}
function shapeSession(r) {
  const live = r.ended_at == null;
  const result = live ? null : (r.cash_out || 0) - (r.buy_in || 0);
  return {
    id: r.id,
    bankroll_id: r.bankroll_id == null ? bankrolls.MAIN : r.bankroll_id,
    started_at: r.started_at,
    ended_at: r.ended_at,
    session_date: r.session_date,
    room: r.room || '',
    venue_slug: r.venue_slug || null,
    game: r.game,
    stakes: r.stakes || '',
    buy_in: r.buy_in || 0,
    rebuys: r.rebuys || 0,
    cash_out: live ? null : (r.cash_out || 0),
    tips: r.tips || 0,
    expenses: r.expenses || 0,
    currency: r.currency || 'USD',
    notes: r.notes || null,
    subtitle: r.subtitle || null,
    tags: parseTags(r.tags),
    live,
    hours: live ? null : Math.round(hoursBetween(r.started_at, r.ended_at) * 1000) / 1000,
    result,
    net: live ? null : result - (r.tips || 0) - (r.expenses || 0),
    created_at: r.created_at,
    updated_at: r.updated_at || null,
  };
}

const COLS = 'cs.id, cs.bankroll_id, cs.started_at, cs.ended_at, cs.session_date, cs.room, cs.venue_slug, cs.game, cs.stakes, cs.buy_in, cs.rebuys, cs.cash_out, cs.tips, cs.expenses, cs.currency, cs.notes, cs.subtitle, cs.tags, cs.created_at, cs.updated_at';

/**
 * The caller's sessions, newest first. opts: { bankroll (raw ?bankroll=), from, to (YYYY-MM-DD on
 * session_date), endedOnly }. Returns { sessions } or { status, error }.
 */
function listSessions(db, userId, opts = {}) {
  const f = bankrolls.filterFromQuery(db, userId, opts.bankroll, 'cs.bankroll_id');
  if (f.error) return f;
  let sql = `SELECT ${COLS} FROM cash_sessions cs WHERE cs.user_id = ?${f.sql}`;
  const params = [userId, ...f.params];
  for (const [key, op] of [['from', '>='], ['to', '<=']]) {
    if (opts[key] === undefined || opts[key] === null || opts[key] === '') continue;
    const d = cleanDay(opts[key]);
    if (d.error) return bad(`${key} must be YYYY-MM-DD`);
    sql += ` AND cs.session_date ${op} ?`;
    params.push(d.value);
  }
  if (opts.endedOnly) sql += ' AND cs.ended_at IS NOT NULL';
  sql += ` ORDER BY cs.session_date DESC, cs.started_at DESC, cs.id DESC LIMIT ${LIST_LIMIT}`;
  return { sessions: rows(db, sql, params).map(shapeSession) };
}

// ── Stats ──
/**
 * Pure. `sessions` are shaped sessions (live ones are skipped). Every amount is converted into
 * `currency` with `convert(value, from, to)` (identity when omitted). Returns
 *   { currency, mixed, sessions, live, overall, byStakes, byGame, byRoom }
 * where overall and every group carry { sessions, hours, net, result, buy_ins, cash_outs, tips,
 * expenses, hourly, wins, losses, even, avg_hours }, overall adds biggest_win / biggest_loss
 * ({ id, amount, date } or null). hourly is net per hour (null with no time logged). Also byMonth
 * (the same groups per 'YYYY-MM', newest first) and series ([{ id, date, net, cum }], oldest first:
 * the cumulative graph).
 */
function computeStats(sessions, { currency = 'USD', convert } = {}) {
  const cv = convert || ((v) => v);
  const done = (sessions || []).filter((s) => !s.live && s.ended_at);
  const blank = () => ({ sessions: 0, hours: 0, net: 0, result: 0, buy_ins: 0, cash_outs: 0, tips: 0, expenses: 0, wins: 0, losses: 0, even: 0 });
  const add = (acc, s, net, money) => {
    acc.sessions += 1;
    acc.hours += s.hours || 0;
    acc.net += net;
    acc.result += money.result;
    acc.buy_ins += money.buy_in;
    acc.cash_outs += money.cash_out;
    acc.tips += money.tips;
    acc.expenses += money.expenses;
    if (net > 0) acc.wins += 1; else if (net < 0) acc.losses += 1; else acc.even += 1;
  };
  const finish = (acc) => {
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      ...acc,
      hours: r2(acc.hours),
      net: r2(acc.net), result: r2(acc.result), buy_ins: r2(acc.buy_ins), cash_outs: r2(acc.cash_outs),
      tips: r2(acc.tips), expenses: r2(acc.expenses),
      hourly: acc.hours > 0 ? r2(acc.net / acc.hours) : null,
      avg_hours: acc.sessions ? r2(acc.hours / acc.sessions) : null,
    };
  };
  const overall = blank();
  const groups = { stakes: new Map(), game: new Map(), room: new Map(), month: new Map() };
  let best = null, worst = null;
  const currencies = new Set();
  for (const s of done) {
    currencies.add(s.currency);
    const c = (v) => cv(v || 0, s.currency, currency);
    const money = { result: c(s.result), buy_in: c(s.buy_in), cash_out: c(s.cash_out), tips: c(s.tips), expenses: c(s.expenses) };
    const net = money.result - money.tips - money.expenses;
    add(overall, s, net, money);
    if (net > 0 && (!best || net > best.amount)) best = { id: s.id, amount: Math.round(net * 100) / 100, date: s.session_date };
    if (net < 0 && (!worst || net < worst.amount)) worst = { id: s.id, amount: Math.round(net * 100) / 100, date: s.session_date };
    const keys = {
      stakes: [`${s.game}|${s.stakes}`.toLowerCase(), s.stakes ? `${s.game} ${s.stakes}` : s.game],
      game: [String(s.game).toLowerCase(), s.game],
      room: [s.venue_slug ? `slug:${s.venue_slug}` : `room:${(s.room || '').toLowerCase()}`, s.room || 'No room'],
      month: [String(s.session_date).slice(0, 7), String(s.session_date).slice(0, 7)],
    };
    for (const k of Object.keys(groups)) {
      const [key, label] = keys[k];
      let g = groups[k].get(key);
      if (!g) { g = { key, label, ...blank() }; groups[k].set(key, g); }
      add(g, s, net, money);
    }
  }
  const order = (m) => [...m.values()].map(finish).sort((a, b) => b.hours - a.hours || b.sessions - a.sessions || String(a.label).localeCompare(String(b.label)));
  // The cumulative ("chip") graph, oldest first, in `currency`.
  const r2 = (v) => Math.round(v * 100) / 100;
  const chrono = [...done].sort((a, b) => String(a.session_date).localeCompare(String(b.session_date))
    || String(a.started_at).localeCompare(String(b.started_at)) || a.id - b.id);
  let cum = 0;
  const series = chrono.map((s) => {
    const c = (v) => cv(v || 0, s.currency, currency);
    const net = c(s.result) - c(s.tips) - c(s.expenses);
    cum += net;
    return { id: s.id, date: s.session_date, net: r2(net), cum: r2(cum) };
  });
  return {
    currency,
    mixed: currencies.size > 1 || (currencies.size === 1 && !currencies.has(currency)),
    sessions: done.length,
    live: (sessions || []).filter((s) => s.live).length,
    overall: { ...finish(overall), biggest_win: best, biggest_loss: worst },
    byStakes: order(groups.stakes),
    byGame: order(groups.game),
    byRoom: order(groups.room),
    // Calendar months (key 'YYYY-MM' of session_date), newest first: the session list's headers.
    byMonth: [...groups.month.values()].map(finish).sort((a, b) => b.key.localeCompare(a.key)),
    series,
  };
}

// ── CSV ──
// Text cells that a spreadsheet would read as a formula get a leading apostrophe.
function csvCell(v, { text = false } = {}) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const CSV_HEAD = ['id', 'date', 'started_at', 'ended_at', 'hours', 'room', 'venue_slug', 'game', 'stakes', 'bankroll',
  'buy_in', 'rebuys', 'cash_out', 'tips', 'expenses', 'result', 'net', 'currency', 'tags', 'notes'];
function toCsv(sessions, bankrollNames = new Map()) {
  const lines = [CSV_HEAD.join(',')];
  for (const s of sessions) {
    lines.push([
      csvCell(s.id), csvCell(s.session_date), csvCell(s.started_at), csvCell(s.ended_at), csvCell(s.hours),
      csvCell(s.room, { text: true }), csvCell(s.venue_slug, { text: true }), csvCell(s.game, { text: true }),
      csvCell(s.stakes, { text: true }), csvCell(bankrollNames.get(s.bankroll_id) || (s.bankroll_id === bankrolls.MAIN ? 'Main' : ''), { text: true }),
      csvCell(s.buy_in), csvCell(s.rebuys), csvCell(s.cash_out), csvCell(s.tips), csvCell(s.expenses),
      csvCell(s.result), csvCell(s.net), csvCell(s.currency), csvCell(s.tags.join('; '), { text: true }), csvCell(s.notes, { text: true }),
    ].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ── Routes ──
/**
 * Mounts /api/cash-sessions/*. deps: { getDb, saveDatabase, authenticateToken, requireAppAdmin,
 * currencies, getRates }. getRates() -> { rates (per USD), stale } for the stats conversion. Every
 * query is scoped by req.user.id; a session id that is not the caller's is a 404, the same answer
 * as one that does not exist.
 *
 * NB the prefix is /api/cash-sessions, NOT /api/cash/…: /api/cash/* is the cash-watcher proxy.
 */
function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireAppAdmin, currencies, getRates } = deps;
  // server.js: a session some backer was notified of carries its shares through an edit and voids
  // them when deleted, silently (lib/staking/notify.js follow). Runs before the save; never throws.
  const changed = (id) => { if (typeof deps.onResultChanged === 'function') deps.onResultChanged(id); };
  const CURRENCIES = new Set(currencies || ['USD']);
  const BASE = '/api/cash-sessions';
  app.use(BASE, authenticateToken, requireAppAdmin);

  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res, getDb(), req.user.id); } catch (err) {
      console.error('[cash-sessions]', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  const fail = (res, r) => res.status(r.status || 400).json({ error: r.error });
  const byId = (db, uid, id) => one(db, `SELECT ${COLS} FROM cash_sessions cs WHERE cs.id = ? AND cs.user_id = ?`, [id, uid]);
  const own = (req, res, db, uid) => {
    const id = Number(req.params.id);
    const r = Number.isInteger(id) && id > 0 ? byId(db, uid, id) : null;
    if (!r) { fail(res, bad('Session not found', 404)); return null; }
    return r;
  };
  const liveOf = (db, uid) => one(db, `SELECT ${COLS} FROM cash_sessions cs WHERE cs.user_id = ? AND cs.ended_at IS NULL ORDER BY cs.id DESC LIMIT 1`, [uid]);
  const lastId = (db) => one(db, 'SELECT last_insert_rowid() AS id').id;
  const cleanCurrency = (raw, fallback) => {
    if (raw === undefined || raw === null || raw === '') return { value: fallback || 'USD' };
    const c = String(raw).toUpperCase();
    return CURRENCIES.has(c) ? { value: c } : bad('Unsupported currency');
  };

  // The fields shared by "log a past session" and "start one now".
  function common(db, uid, body) {
    const bk = resolveBankroll(db, uid, body.bankroll === undefined ? bankrolls.MAIN : body.bankroll);
    if (bk.error) return bk;
    const cur = cleanCurrency(body.currency, bk.currency);
    if (cur.error) return cur;
    const slug = cleanSlug(body.venueSlug);
    if (slug.error) return slug;
    const tags = cleanTags(body.tags);
    if (tags.error) return tags;
    return {
      bankroll_id: bk.id, currency: cur.value, venue_slug: slug.value, tags: tags.value,
      room: cleanText(body.room, MAX_ROOM), game: cleanGame(body.game), stakes: cleanStakes(body.stakes),
      notes: cleanNotes(body.notes),
    };
  }
  // The card subtitle, written on its own after the row (only when the body names it), so the
  // long INSERT and UPDATE stay as they were.
  const setSubtitle = (db, uid, id, body) => {
    if (body.subtitle === undefined) return;
    db.run('UPDATE cash_sessions SET subtitle = ? WHERE id = ? AND user_id = ?', [cleanSubtitle(body.subtitle), id, uid]);
  };
  const INSERT = `INSERT INTO cash_sessions (user_id, bankroll_id, started_at, ended_at, session_date, room, venue_slug, game, stakes,
    buy_in, rebuys, cash_out, tips, expenses, currency, notes, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  // ── Reads ── (fixed paths before /:id)
  app.get(BASE, wrap((req, res, db, uid) => {
    const r = listSessions(db, uid, { bankroll: req.query.bankroll, from: req.query.from, to: req.query.to });
    if (r.error) return fail(res, r);
    res.json({ sessions: r.sessions, games: CASH_GAMES });
  }));

  app.get(`${BASE}/live`, wrap((req, res, db, uid) => {
    const r = liveOf(db, uid);
    res.json({ session: r ? shapeSession(r) : null, stacks: r ? listStacks(db, uid, r.id) : [], now: nowIso() });
  }));

  // ?bankroll=&from=&to=&currency=. currency: what to total in — default the sessions' own currency
  // when they share one, else USD; mixed currencies convert at the server's cached rates.
  app.get(`${BASE}/stats`, wrap(async (req, res, db, uid) => {
    const r = listSessions(db, uid, { bankroll: req.query.bankroll, from: req.query.from, to: req.query.to });
    if (r.error) return fail(res, r);
    let target = req.query.currency ? String(req.query.currency).toUpperCase() : null;
    if (target && !CURRENCIES.has(target)) return fail(res, bad('Unsupported currency'));
    const used = [...new Set(r.sessions.filter((s) => !s.live).map((s) => s.currency))];
    if (!target) target = used.length === 1 ? used[0] : 'USD';
    let rates = null, stale = false;
    if (used.some((c) => c !== target) && getRates) {
      const got = await getRates();
      rates = got && got.rates; stale = !!(got && got.stale);
    }
    const convert = (v, from, to) => {
      if (from === to || !rates) return v;
      const f = rates[from], t = rates[to];
      return f && t ? (v / f) * t : v;
    };
    res.json({ ...computeStats(r.sessions, { currency: target, convert }), rates_stale: stale });
  }));

  app.get(`${BASE}/export.csv`, wrap((req, res, db, uid) => {
    const r = listSessions(db, uid, { bankroll: req.query.bankroll, from: req.query.from, to: req.query.to });
    if (r.error) return fail(res, r);
    const names = new Map(rows(db, 'SELECT id, name FROM bankrolls WHERE user_id = ?', [uid]).map((b) => [b.id, b.name]));
    names.set(bankrolls.MAIN, 'Main');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="cash-sessions.csv"');
    res.set('Cache-Control', 'no-store');
    res.send(toCsv(r.sessions, names));
  }));

  // ── Log a finished session ── { startedAt, endedAt, date?, buyIn, rebuys?, cashOut, tips?,
  //    expenses?, room?, venueSlug?, game?, stakes?, bankroll?, currency?, notes?, tags? }
  app.post(BASE, wrap(async (req, res, db, uid) => {
    const body = req.body || {};
    const c = common(db, uid, body);
    if (c.error) return fail(res, c);
    const start = cleanInstant(body.startedAt, 'startedAt');
    if (start.error) return fail(res, start);
    const end = cleanInstant(body.endedAt, 'endedAt');
    if (end.error) return fail(res, end);
    if (end.ms <= start.ms) return fail(res, bad('The session must end after it starts'));
    if (end.ms - start.ms > MAX_HOURS * 3600e3) return fail(res, bad(`A session is at most ${MAX_HOURS} hours`));
    const day = cleanDay(body.date, start.value);
    if (day.error) return fail(res, day);
    const buyIn = cleanAmount(body.buyIn, 'Buy-in', { positive: true });
    if (buyIn.error) return fail(res, buyIn);
    const rebuys = cleanCount(body.rebuys);
    if (rebuys.error) return fail(res, rebuys);
    const cashOut = cleanAmount(body.cashOut, 'Cash-out');
    if (cashOut.error) return fail(res, cashOut);
    const tips = cleanAmount(body.tips, 'Tips', { optional: true });
    if (tips.error) return fail(res, tips);
    const expenses = cleanAmount(body.expenses, 'Expenses', { optional: true });
    if (expenses.error) return fail(res, expenses);
    db.run(INSERT, [uid, c.bankroll_id, start.value, end.value, day.value, c.room, c.venue_slug, c.game, c.stakes,
      buyIn.value, rebuys.value, cashOut.value, tips.value, expenses.value, c.currency, c.notes, JSON.stringify(c.tags), nowIso()]);
    const id = lastId(db);
    setSubtitle(db, uid, id, body);
    await saveDatabase();
    res.status(201).json({ session: shapeSession(byId(db, uid, id)) });
  }));

  // ── Start a live session ── { buyIn, room?, venueSlug?, game?, stakes?, bankroll?, currency?,
  //    startedAt? (default now), date? (the player's local day; default the UTC day), notes?, tags? }
  app.post(`${BASE}/start`, wrap(async (req, res, db, uid) => {
    const body = req.body || {};
    const running = liveOf(db, uid);
    if (running) return res.status(409).json({ error: 'A session is already running. End it first.', session: shapeSession(running) });
    const c = common(db, uid, body);
    if (c.error) return fail(res, c);
    const start = body.startedAt === undefined ? { value: nowIso() } : cleanInstant(body.startedAt, 'startedAt');
    if (start.error) return fail(res, start);
    const day = cleanDay(body.date, start.value);
    if (day.error) return fail(res, day);
    const buyIn = cleanAmount(body.buyIn, 'Buy-in', { positive: true });
    if (buyIn.error) return fail(res, buyIn);
    db.run(INSERT, [uid, c.bankroll_id, start.value, null, day.value, c.room, c.venue_slug, c.game, c.stakes,
      buyIn.value, 0, null, 0, 0, c.currency, c.notes, JSON.stringify(c.tags), nowIso()]);
    const id = lastId(db);
    setSubtitle(db, uid, id, body);
    await saveDatabase();
    res.status(201).json({ session: shapeSession(byId(db, uid, id)) });
  }));

  // ── Rebuy / add-on on a live session ── { amount }
  app.post(`${BASE}/:id/rebuy`, wrap(async (req, res, db, uid) => {
    const r = own(req, res, db, uid); if (!r) return;
    if (r.ended_at != null) return fail(res, bad('That session has ended', 409));
    const amount = cleanAmount((req.body || {}).amount, 'Rebuy', { positive: true });
    if (amount.error) return fail(res, amount);
    if (r.buy_in + amount.value > MAX_AMOUNT) return fail(res, bad('Buy-in is too large'));
    db.run('UPDATE cash_sessions SET buy_in = buy_in + ?, rebuys = rebuys + 1, updated_at = ? WHERE id = ? AND user_id = ? AND ended_at IS NULL',
      [amount.value, nowIso(), r.id, uid]);
    await saveDatabase();
    res.json({ session: shapeSession(byId(db, uid, r.id)), stacks: listStacks(db, uid, r.id) });
  }));

  // ── Stack update on a live session ── { amount (chips in front of the player now), at? (default
  //    now; not before the session started) } -> 201 { session, stacks }
  app.post(`${BASE}/:id/stack`, wrap(async (req, res, db, uid) => {
    const r = own(req, res, db, uid); if (!r) return;
    if (r.ended_at != null) return fail(res, bad('That session has ended', 409));
    const body = req.body || {};
    const amount = cleanAmount(body.amount, 'Stack');
    if (amount.error) return fail(res, amount);
    const at = body.at === undefined ? { value: nowIso(), ms: Date.now() } : cleanInstant(body.at, 'at');
    if (at.error) return fail(res, at);
    if (at.ms < Date.parse(r.started_at)) return fail(res, bad('That is before the session started'));
    const n = one(db, 'SELECT COUNT(*) AS n FROM cash_session_stacks WHERE session_id = ? AND user_id = ?', [r.id, uid]).n;
    if (n >= MAX_STACKS) return fail(res, bad(`At most ${MAX_STACKS} stack updates in a session`, 409));
    db.run('INSERT INTO cash_session_stacks (session_id, user_id, at, amount, invested, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [r.id, uid, at.value, amount.value, r.buy_in || 0, nowIso()]);
    await saveDatabase();
    res.status(201).json({ session: shapeSession(r), stacks: listStacks(db, uid, r.id) });
  }));

  // ── Remove a mistyped stack update ── (live or ended) -> { session, stacks }
  app.delete(`${BASE}/:id/stacks/:stackId`, wrap(async (req, res, db, uid) => {
    const r = own(req, res, db, uid); if (!r) return;
    const sid = Number(req.params.stackId);
    const hit = Number.isInteger(sid) && sid > 0
      ? one(db, 'SELECT id FROM cash_session_stacks WHERE id = ? AND session_id = ? AND user_id = ?', [sid, r.id, uid]) : null;
    if (!hit) return fail(res, bad('Stack update not found', 404));
    db.run('DELETE FROM cash_session_stacks WHERE id = ? AND user_id = ?', [sid, uid]);
    await saveDatabase();
    res.json({ session: shapeSession(r), stacks: listStacks(db, uid, r.id) });
  }));

  // ── One session with its stack updates ── (after the fixed paths above)
  app.get(`${BASE}/:id`, wrap((req, res, db, uid) => {
    const r = own(req, res, db, uid); if (!r) return;
    res.json({ session: shapeSession(r), stacks: listStacks(db, uid, r.id) });
  }));

  // ── End a live session ── { cashOut, tips?, expenses?, endedAt? (default now), notes?, tags? }
  app.post(`${BASE}/:id/end`, wrap(async (req, res, db, uid) => {
    const r = own(req, res, db, uid); if (!r) return;
    if (r.ended_at != null) return fail(res, bad('That session has already ended', 409));
    const body = req.body || {};
    const cashOut = cleanAmount(body.cashOut, 'Cash-out');
    if (cashOut.error) return fail(res, cashOut);
    const tips = cleanAmount(body.tips, 'Tips', { optional: true });
    if (tips.error) return fail(res, tips);
    const expenses = cleanAmount(body.expenses, 'Expenses', { optional: true });
    if (expenses.error) return fail(res, expenses);
    const end = body.endedAt === undefined ? { value: nowIso(), ms: Date.now() } : cleanInstant(body.endedAt, 'endedAt');
    if (end.error) return fail(res, end);
    const startMs = Date.parse(r.started_at);
    // Ending a moment after starting (a mis-tap, a clock a second behind) is still a session.
    const endIso = end.ms <= startMs ? new Date(startMs + 1000).toISOString() : end.value;
    if (Date.parse(endIso) - startMs > MAX_HOURS * 3600e3) return fail(res, bad(`A session is at most ${MAX_HOURS} hours — edit its start time`));
    const notes = body.notes === undefined ? r.notes : cleanNotes(body.notes);
    let tags = r.tags;
    if (body.tags !== undefined) { const t = cleanTags(body.tags); if (t.error) return fail(res, t); tags = JSON.stringify(t.value); }
    db.run(`UPDATE cash_sessions SET ended_at = ?, cash_out = ?, tips = ?, expenses = ?, notes = ?, tags = ?, updated_at = ?
            WHERE id = ? AND user_id = ? AND ended_at IS NULL`,
    [endIso, cashOut.value, tips.value, expenses.value, notes, tags, nowIso(), r.id, uid]);
    changed(r.id);
    await saveDatabase();
    res.json({ session: shapeSession(byId(db, uid, r.id)) });
  }));

  // ── Edit ── any field above (camelCase), partial. A live session stays live here: its end and
  // cash-out are set by /end, so endedAt / cashOut on a live session are a 400.
  app.put(`${BASE}/:id`, wrap(async (req, res, db, uid) => {
    const r = own(req, res, db, uid); if (!r) return;
    const body = req.body || {};
    const live = r.ended_at == null;
    if (live && (body.endedAt !== undefined || body.cashOut !== undefined)) return fail(res, bad('End a live session with its cash-out instead'));
    const next = { ...r };
    if (body.bankroll !== undefined) {
      const bk = resolveBankroll(db, uid, body.bankroll, r.bankroll_id);
      if (bk.error) return fail(res, bk);
      next.bankroll_id = bk.id;
    }
    if (body.currency !== undefined) { const c = cleanCurrency(body.currency); if (c.error) return fail(res, c); next.currency = c.value; }
    if (body.venueSlug !== undefined) { const s = cleanSlug(body.venueSlug); if (s.error) return fail(res, s); next.venue_slug = s.value; }
    if (body.tags !== undefined) { const t = cleanTags(body.tags); if (t.error) return fail(res, t); next.tags = JSON.stringify(t.value); }
    if (body.room !== undefined) next.room = cleanText(body.room, MAX_ROOM);
    if (body.game !== undefined) next.game = cleanGame(body.game);
    if (body.stakes !== undefined) next.stakes = cleanStakes(body.stakes);
    if (body.notes !== undefined) next.notes = cleanNotes(body.notes);
    for (const [k, col, label, o] of [['buyIn', 'buy_in', 'Buy-in', { positive: true }], ['cashOut', 'cash_out', 'Cash-out', {}],
      ['tips', 'tips', 'Tips', { optional: true }], ['expenses', 'expenses', 'Expenses', { optional: true }]]) {
      if (body[k] === undefined) continue;
      const a = cleanAmount(body[k], label, o);
      if (a.error) return fail(res, a);
      next[col] = a.value;
    }
    if (body.rebuys !== undefined) { const n = cleanCount(body.rebuys); if (n.error) return fail(res, n); next.rebuys = n.value; }
    if (body.startedAt !== undefined) { const s = cleanInstant(body.startedAt, 'startedAt'); if (s.error) return fail(res, s); next.started_at = s.value; }
    if (body.endedAt !== undefined) { const e = cleanInstant(body.endedAt, 'endedAt'); if (e.error) return fail(res, e); next.ended_at = e.value; }
    if (body.date !== undefined) { const d = cleanDay(body.date, next.started_at); if (d.error) return fail(res, d); next.session_date = d.value; }
    if (!live) {
      const ms = Date.parse(next.ended_at) - Date.parse(next.started_at);
      if (!(ms > 0)) return fail(res, bad('The session must end after it starts'));
      if (ms > MAX_HOURS * 3600e3) return fail(res, bad(`A session is at most ${MAX_HOURS} hours`));
    }
    db.run(`UPDATE cash_sessions SET bankroll_id = ?, started_at = ?, ended_at = ?, session_date = ?, room = ?, venue_slug = ?, game = ?,
              stakes = ?, buy_in = ?, rebuys = ?, cash_out = ?, tips = ?, expenses = ?, currency = ?, notes = ?, tags = ?, updated_at = ?
            WHERE id = ? AND user_id = ?`,
    [next.bankroll_id, next.started_at, next.ended_at, next.session_date, next.room, next.venue_slug, next.game, next.stakes,
      next.buy_in, next.rebuys, next.cash_out, next.tips, next.expenses, next.currency, next.notes, next.tags, nowIso(), r.id, uid]);
    setSubtitle(db, uid, r.id, body);
    changed(r.id);
    await saveDatabase();
    res.json({ session: shapeSession(byId(db, uid, r.id)) });
  }));

  app.delete(`${BASE}/:id`, wrap(async (req, res, db, uid) => {
    const r = own(req, res, db, uid); if (!r) return;
    db.run('DELETE FROM cash_session_stacks WHERE session_id = ? AND user_id = ?', [r.id, uid]);
    db.run('DELETE FROM cash_sessions WHERE id = ? AND user_id = ?', [r.id, uid]);
    changed(r.id);
    await saveDatabase();
    res.json({ deleted: true });
  }));
}

module.exports = {
  CASH_GAMES, migrate, migrateStacks, listSessions, listStacks, shapeSession, computeStats, toCsv, cleanStakes, cleanSubtitle, mountRoutes,
};
