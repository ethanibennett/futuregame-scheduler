'use strict';
/*
 * The owner API (docs/bankroll-merge.md §11; Phase 9): what the dashboard app reads and writes once
 * this app owns the money. Server to server only.
 *
 *   auth    Authorization: Bearer <LEDGER_TOKEN> (LEDGER_TOKEN_PREVIOUS accepted inbound), the same
 *           constant-time check as the roster and import seams (lib/shared-token.js). 404 on a
 *           mismatch or when unset, 503 while the owner is unresolved, 60 requests a minute per IP,
 *           Cache-Control: no-store. It acts as HAM_OWNER_ID. Nothing here takes a session cookie.
 *   GET  /api/owner/money            the roll, the fund, the bankrolls and every ended result
 *                                     (§11.2), the ledger's own figures (lib/bankroll-ledger.js)
 *   POST /api/owner/sessions/log     a session told from outside (§11.3): the dashboard's
 *                                     normalizeSession ported verbatim (./session-log.js), the
 *                                     import's own mapping (lib/money-import/map.js mapSession), the
 *                                     fingerprint in bankroll_import_keys so the same session told
 *                                     twice updates one row; commit:false (the default) writes
 *                                     nothing and shows the cuts
 *
 * The token never appears in a log line; a log names counts and ids. Why not DASHBOARD_TOKEN: that
 * one is compiled into the iOS binaries and only ever reads; this API writes money and must be
 * revocable on its own (§11.1).
 */
const rateLimit = require('express-rate-limit');
const { checkSharedToken, bearerOf } = require('../shared-token');
const ledger = require('../bankroll-ledger');
const bankrolls = require('../bankrolls');
const { mapSession } = require('../money-import/map');
const { hasTable } = require('../money-merge');
const { classifyTournament, classifyCash } = require('../staking/classify');
const { tournamentNetCents, cashNetCents, resultCuts } = require('../staking/standing');
const notify = require('../staking/notify');
const live = require('../staking/live');
const { normaliseDate, nativeCurrency } = require('../analytics');
const sessionLog = require('./session-log');

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
function rowsOf(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const oneRow = (db, sql, params) => rowsOf(db, sql, params)[0] || null;
const lastId = (db) => db.exec('SELECT last_insert_rowid()')[0].values[0][0];

/** Is the inbound token the ledger token? -> { ok, via, why } */
function checkLedgerToken(token, env = process.env) {
  const current = String(env.LEDGER_TOKEN || '').trim();
  if (!current || current.length < 32) return { ok: false, via: null, why: 'unset' };
  return checkSharedToken(token, { current, previous: env.LEDGER_TOKEN_PREVIOUS });
}

// ── GET /money ───────────────────────────────────────────────────────────────────────────

/** The fund bankroll row (role 'fund'), or null. */
function fundRow(db, uid) {
  return oneRow(db, "SELECT id, name, target_amount, target_date FROM bankrolls WHERE user_id = ? AND role = 'fund' ORDER BY id LIMIT 1", [uid]);
}

/** Every ended result of the owner, newest first, in the dashboard's session shape (§11.2). */
function ownerSessions(db, uid, { rates, since = null, fundId = null }) {
  const extras = hasTable(db, 'session_extras');
  const conv = (cents, currency) => (currency && currency !== 'USD' && rates && rates[currency] > 0 ? cents / rates[currency] : cents);
  const out = [];
  const exOf = (table, id) => (extras ? oneRow(db, 'SELECT format, channel, hours, hands, mood_rating, tilt_note, journal, tags FROM session_extras WHERE ref_table = ? AND ref_id = ?', [table, id]) : null);
  const tags = (ex, own) => { const raw = ex && ex.tags != null ? ex.tags : own; try { const t = JSON.parse(raw || '[]'); return Array.isArray(t) ? t : []; } catch (_) { return []; } };
  for (const r of rowsOf(db, `SELECT te.id, te.num_entries, te.cashed, te.cash_amount, te.finish_place, te.bankroll_id, te.created_at,
      t.date, t.buyin, t.event_name, t.venue, t.property, t.site, t.game_variant, t.is_online, t.total_entries
    FROM tracking_entries te JOIN tournaments t ON t.id = te.tournament_id WHERE te.user_id = ?`, [uid])) {
    const date = normaliseDate(r.date) || normaliseDate(String(r.created_at || '').slice(0, 10)) || null;
    if (since && (!date || date < since) && !(String(r.created_at || '').slice(0, 10) >= since)) continue;
    const ex = exOf('tracking_entries', r.id);
    const c = classifyTournament(r, ex);
    const currency = nativeCurrency(r.venue);
    const entries = Number(r.num_entries) || 1;
    const buyIn = round2(conv((Number(r.buyin) || 0) * entries * 100, currency) / 100);
    const cash = Number(r.cashed) ? round2(conv((Number(r.cash_amount) || 0) * 100, currency) / 100) : 0;
    out.push({
      id: `te:${r.id}`, date, channel: c.channel, isMTT: true, format: c.format,
      gameLabel: String(r.event_name || `${c.format} tournament`).slice(0, 80), venue: String((Number(r.is_online) ? (r.site || r.property) : r.property) || r.venue || '').slice(0, 60),
      stakeLevel: null, buyInTotal: buyIn, cashOut: cash, hours: ex && Number(ex.hours) > 0 ? round2(ex.hours) : null,
      result: round2(conv(tournamentNetCents(r), currency) / 100), isWsopFund: fundId != null && Number(r.bankroll_id) === Number(fundId),
      hands: ex && ex.hands != null ? ex.hands : null, entries, place: r.finish_place == null ? null : r.finish_place, fieldSize: r.total_entries == null ? null : r.total_entries,
      moodRating: ex && ex.mood_rating != null ? ex.mood_rating : null, tiltNote: ex && ex.tilt_note ? ex.tilt_note : null, journal: ex && ex.journal ? ex.journal : null, tags: tags(ex, null),
      sortKey: `${date || ''}|${String(r.created_at || '')}`,
    });
  }
  for (const r of rowsOf(db, `SELECT id, started_at, ended_at, session_date, room, game, stakes, buy_in, rebuys, cash_out, tips, expenses, currency, bankroll_id, tags, created_at
    FROM cash_sessions WHERE user_id = ? AND ended_at IS NOT NULL`, [uid])) {
    const date = normaliseDate(r.session_date) || null;
    if (since && (!date || date < since) && !(String(r.created_at || '').slice(0, 10) >= since)) continue;
    const ex = exOf('cash_sessions', r.id);
    const c = classifyCash(r, ex);
    const currency = r.currency || 'USD';
    const ms = Date.parse(r.ended_at) - Date.parse(r.started_at);
    out.push({
      id: `cs:${r.id}`, date, channel: c.channel, isMTT: false, format: c.format,
      gameLabel: `${r.stakes ? r.stakes + ' ' : ''}${r.game || ''}`.trim().slice(0, 80), venue: String(r.room || '').slice(0, 60),
      stakeLevel: r.stakes || null, buyInTotal: round2(conv((Number(r.buy_in) || 0) * 100, currency) / 100), cashOut: round2(conv((Number(r.cash_out) || 0) * 100, currency) / 100),
      hours: ms > 0 ? round2(ms / 3600e3) : null,
      result: round2(conv(cashNetCents(r), currency) / 100), isWsopFund: fundId != null && Number(r.bankroll_id) === Number(fundId),
      hands: ex && ex.hands != null ? ex.hands : null, entries: null, place: null, fieldSize: null,
      moodRating: ex && ex.mood_rating != null ? ex.mood_rating : null, tiltNote: ex && ex.tilt_note ? ex.tilt_note : null, journal: ex && ex.journal ? ex.journal : null, tags: tags(ex, r.tags),
      sortKey: `${date || ''}|${String(r.created_at || '')}`,
    });
  }
  out.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
  return out.map(({ sortKey, ...s }) => s);
}

/** §11.2, whole. `loaded` is the ledger's sources (ledger.loadSources()). */
function money(db, uid, { rates, loaded, since = null, now = new Date(), withSessions = true }) {
  const list = bankrolls.listBankrolls(db, uid);
  const fund = fundRow(db, uid);
  const { entries } = ledger.collect(db, uid, { bankroll: 'all', from: null, to: null }, loaded);
  const all = ledger.runningBalances(entries, { bankrollList: list, scope: 'all', currency: 'USD', rates });
  const sum = ledger.summarise(all, { bankrollList: list, scope: 'all', currency: 'USD', rates });
  const inRoll = (b) => Number(b.in_roll == null ? 1 : b.in_roll) === 1 && !(fund && b.id === fund.id);
  const rollList = list.filter(inRoll);
  const roll = ledger.runningBalances(entries, { bankrollList: rollList, scope: 'all', currency: 'USD', rates });
  let rollPeak = roll.opening ? roll.opening.total_display : 0;
  for (const e of roll.entries) if (e.total_display > rollPeak) rollPeak = e.total_display;
  const fundSum = fund ? sum.bankrolls.find((b) => b.id === fund.id) : null;
  const fundFirst = fund ? entries.filter((e) => Number(e.bankroll_id) === Number(fund.id)).map((e) => e.date).sort()[0] || null : null;
  const lastChange = entries.map((e) => e.date).sort().pop() || null;
  return {
    generatedAt: now.toISOString(),
    lastChangeAt: lastChange ? `${lastChange}T00:00:00.000Z` : null,
    currency: 'USD',
    roll: round2(roll.closing.total_display),
    wsopFund: fundSum ? round2(fundSum.balance) : 0,
    rollPeak: round2(rollPeak),
    fund: fund ? { bankrollId: fund.id, saved: fundSum ? round2(fundSum.balance) : 0, target: fund.target_amount == null ? null : Number(fund.target_amount), targetDate: fund.target_date || null, firstActivityDate: fundFirst } : null,
    bankrolls: sum.bankrolls.map((b) => ({ id: b.id, name: b.name, balance: round2(b.balance), inRoll: rollList.some((x) => x.id === b.id), isFund: !!(fund && b.id === fund.id) })),
    sessions: withSessions ? ownerSessions(db, uid, { rates, since, fundId: fund ? fund.id : null }) : [],
  };
}

// ── POST /sessions/log ───────────────────────────────────────────────────────────────────

const TABLE_OF = { cash: 'cash_sessions', tournament: 'tracking_entries' };

/** Which bankroll a logged session lands in: the fund when asked, else money_settings.defaultBankroll. */
function targetBankrollId(db, uid, isFund) {
  if (isFund) {
    const f = fundRow(db, uid);
    return f ? f.id : null; // no fund yet: Main (the preview says so)
  }
  const s = live.readSettings(db, uid);
  const d = s.defaultBankroll;
  if (d == null || d === 'main') return null;
  const row = oneRow(db, 'SELECT id FROM bankrolls WHERE id = ? AND user_id = ?', [Number(d), uid]);
  return row ? row.id : null;
}

/** The row a fingerprint names, if it is still alive. -> { key, kind, table, id } | null */
function existingFor(db, uid, fp) {
  if (!hasTable(db, 'bankroll_import_keys')) return null;
  const k = oneRow(db, 'SELECT ref_table, ref_id FROM bankroll_import_keys WHERE user_id = ? AND fingerprint = ?', [uid, fp]);
  if (!k) return null;
  if (k.ref_table === 'cash_sessions') {
    const r = oneRow(db, 'SELECT id, ended_at FROM cash_sessions WHERE id = ? AND user_id = ?', [k.ref_id, uid]);
    return r ? { key: k, kind: 'cash', table: 'cash_sessions', id: r.id } : null;
  }
  if (k.ref_table === 'tracking_entries') {
    const r = oneRow(db, 'SELECT te.id, te.tournament_id FROM tracking_entries te JOIN tournaments t ON t.id = te.tournament_id WHERE te.id = ? AND te.user_id = ?', [k.ref_id, uid]);
    return r ? { key: k, kind: 'tournament', table: 'tracking_entries', id: r.id, tournamentId: r.tournament_id } : null;
  }
  return null;
}

function upsertExtras(db, uid, table, id, ex, nowIso) {
  if (!hasTable(db, 'session_extras')) return;
  db.run(`INSERT INTO session_extras (user_id, ref_table, ref_id, format, channel, hours, hands, mood_rating, tilt_note, journal, tags, origin, origin_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ref_table, ref_id) DO UPDATE SET format = excluded.format, channel = excluded.channel, hours = excluded.hours, hands = excluded.hands,
      mood_rating = excluded.mood_rating, tilt_note = excluded.tilt_note, journal = excluded.journal, tags = excluded.tags, origin = excluded.origin, origin_id = excluded.origin_id, updated_at = excluded.updated_at`,
  [uid, table, id, ex.format, ex.channel, ex.hours, ex.hands, ex.mood_rating, ex.tilt_note, ex.journal, ex.tags, ex.origin, ex.origin_id, nowIso]);
}

/**
 * Writes (or updates) the result mapSession produced. -> { table, id, created }
 * The rows are mapSession's (the import's shape), the bankroll the caller's.
 */
function writeMapped(db, uid, m, { bankrollId, existing, fp, nowIso }) {
  const rows = m.rows;
  if (m.kind === 'cash') {
    const c = rows.cash_sessions;
    if (existing) {
      db.run(`UPDATE cash_sessions SET started_at = ?, ended_at = ?, session_date = ?, room = ?, game = ?, stakes = ?, buy_in = ?, cash_out = ?, notes = ?, tags = ?, bankroll_id = ?, time_known = 0 WHERE id = ?`,
        [c.started_at, c.ended_at, c.session_date, c.room, c.game, c.stakes, c.buy_in, c.cash_out, c.notes, c.tags, bankrollId, existing.id]);
      upsertExtras(db, uid, 'cash_sessions', existing.id, rows.session_extras, nowIso);
      return { table: 'cash_sessions', id: existing.id, created: false };
    }
    db.run(`INSERT INTO cash_sessions (user_id, bankroll_id, started_at, ended_at, session_date, room, venue_slug, game, stakes, buy_in, rebuys, cash_out, tips, expenses, currency, notes, tags, time_known, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?, 0, 0, 'USD', ?, ?, 0, ?)`,
    [uid, bankrollId, c.started_at, c.ended_at, c.session_date, c.room, c.game, c.stakes, c.buy_in, c.cash_out, c.notes, c.tags, nowIso]);
    const id = lastId(db);
    upsertExtras(db, uid, 'cash_sessions', id, rows.session_extras, nowIso);
    db.run('INSERT INTO bankroll_import_keys (user_id, fingerprint, ref_table, ref_id, created_at) VALUES (?, ?, ?, ?, ?)', [uid, fp, 'cash_sessions', id, nowIso]);
    return { table: 'cash_sessions', id, created: true };
  }
  const t = rows.tournaments, e = rows.tracking_entries;
  if (existing) {
    db.run(`UPDATE tournaments SET event_name = ?, date = ?, buyin = ?, game_variant = ?, is_online = ?, site = ?, property = ?, total_entries = ? WHERE id = ? AND venue = 'Personal'`,
      [t.event_name, t.date, t.buyin, t.game_variant, t.is_online, t.site, t.property, t.total_entries, existing.tournamentId]);
    db.run('UPDATE tracking_entries SET num_entries = ?, cashed = ?, finish_place = ?, cash_amount = ?, bankroll_id = ? WHERE id = ?',
      [e.num_entries, e.cashed, e.finish_place, e.cash_amount, bankrollId, existing.id]);
    upsertExtras(db, uid, 'tracking_entries', existing.id, rows.session_extras, nowIso);
    return { table: 'tracking_entries', id: existing.id, created: false };
  }
  db.run(`INSERT INTO tournaments (stable_id, event_number, event_name, date, time, buyin, game_variant, venue, notes, uploaded_by, total_entries, source_pdf, is_online, site, property)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Personal', ?, ?, ?, 'owner-api', ?, ?, ?)`,
  [t.stable_id, t.event_number, t.event_name, t.date, t.time, t.buyin, t.game_variant, t.notes, uid, t.total_entries, t.is_online, t.site, t.property]);
  const tid = lastId(db);
  db.run('INSERT OR IGNORE INTO user_schedules (user_id, tournament_id) VALUES (?, ?)', [uid, tid]);
  db.run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, finish_place, cash_amount, notes, bankroll_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [uid, tid, e.num_entries, e.cashed, e.finish_place, e.cash_amount, 'Logged from chat', bankrollId]);
  const id = lastId(db);
  upsertExtras(db, uid, 'tracking_entries', id, rows.session_extras, nowIso);
  db.run('INSERT INTO bankroll_import_keys (user_id, fingerprint, ref_table, ref_id, created_at) VALUES (?, ?, ?, ?, ?)', [uid, fp, 'tracking_entries', id, nowIso]);
  return { table: 'tracking_entries', id, created: true };
}

/** The standing cuts of a session not yet saved: [{ name, pct, shareCents }]. */
function cutsFor(db, uid, m, source) {
  const result = { table: TABLE_OF[m.kind], id: 0, kind: m.kind, date: m.date, format: m.rows.session_extras.format, channel: m.rows.session_extras.channel, resultCents: Math.round((m.exact.roll + m.exact.fund) * 100), ended: true };
  const out = [];
  for (const b of notify.stakedBackers(db, uid, { source })) {
    const { cuts } = resultCuts({ agreements: b.agreements, result });
    if (cuts.length) out.push({ name: b.name, pct: cuts[0].pct, shareCents: cuts[0].shareCents });
  }
  return out;
}

/**
 * §11.3. body: { session: {...}, commit } or the flat form. -> { status, body }
 *   preview  { ok, dryRun: true, session, summary, notes, replacesExisting, ref?, rollBefore, rollAfter, backerCuts }
 *   commit   the same plus { committed: true, ref }; the caller saves and runs follow
 */
function logSession(db, uid, body, { rates, loaded, source, now = new Date() }) {
  const b = body && typeof body === 'object' ? body : {};
  const input = b.session && typeof b.session === 'object' ? b.session : b;
  const commit = b.commit === true;
  const n = sessionLog.normalizeSession(input, now);
  if (!n.ok) return { status: 400, body: { ok: false, errors: n.errors, notes: n.notes } };
  const s = n.session;
  const m = mapSession(s.id, s, { uid });
  if (!m.ok) return { status: 400, body: { ok: false, errors: [m.error], notes: n.notes } };
  const existing = existingFor(db, uid, s.id);
  if (existing && existing.kind !== m.kind) {
    return { status: 409, body: { ok: false, errors: [`"${s.id}" is already a ${existing.kind === 'cash' ? 'cash session' : 'tournament result'} here; delete it in the app first to log it as a ${m.kind === 'cash' ? 'cash session' : 'tournament'}.`], ref: { table: existing.table, id: existing.id } } };
  }
  const fund = !!s.isWsopFund;
  const bankrollId = targetBankrollId(db, uid, fund);
  const notes = [...n.notes, ...m.flags];
  if (fund && bankrollId == null) notes.push('no fund bankroll exists yet: it lands in Main');
  const before = money(db, uid, { rates, loaded, now });
  const base = {
    ok: true, session: s, summary: sessionLog.describeSession(s), notes, replacesExisting: !!existing,
    ...(existing ? { ref: { table: existing.table, id: existing.id } } : {}),
    rollBefore: before.roll, backerCuts: cutsFor(db, uid, m, source),
  };
  if (!commit) {
    const delta = fund ? 0 : m.rounded.roll;
    return { status: 200, body: { ...base, dryRun: true, rollAfter: round2(before.roll + delta) } };
  }
  const nowIso = now.toISOString();
  db.run('SAVEPOINT owner_log');
  let ref;
  try {
    ref = writeMapped(db, uid, m, { bankrollId, existing, fp: s.id, nowIso });
    db.run('RELEASE owner_log');
  } catch (e) {
    try { db.run('ROLLBACK TO owner_log'); db.run('RELEASE owner_log'); } catch (_) { /* */ }
    throw e;
  }
  const after = money(db, uid, { rates, loaded, now });
  return { status: existing ? 200 : 201, body: { ...base, dryRun: false, committed: true, ref: { table: ref.table, id: ref.id }, created: ref.created, rollAfter: after.roll } };
}

// ── routes ───────────────────────────────────────────────────────────────────────────────

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, getOwnerId, getRates, loaded, followShares, log = console } = deps;
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });
  const gate = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const c = checkLedgerToken(bearerOf(req), process.env);
    if (!c.ok) return res.status(404).json({ error: 'Not found' });
    const owner = getOwnerId();
    if (owner == null) return res.status(503).json({ error: 'The owner is not resolved on this server yet.' });
    req.ownerId = owner;
    next();
  };
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (err) {
      log.error('[owner-api]', err && err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  const rates = async () => { const c = getRates ? await getRates() : null; return c && c.rates; };
  app.get('/api/owner/money', limiter, gate, wrap(async (req, res) => {
    const since = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.since || '')) ? String(req.query.since) : null;
    res.json(money(getDb(), req.ownerId, { rates: await rates(), loaded, since }));
  }));
  app.post('/api/owner/sessions/log', limiter, gate, wrap(async (req, res) => {
    const db = getDb();
    const out = logSession(db, req.ownerId, req.body, { rates: await rates(), loaded, source: require('../backer-surface').pageSource() });
    if (out.body.committed) {
      if (followShares && out.ref !== null) followShares(out.body.ref.table, [out.body.ref.id]);
      await saveDatabase();
      log.log(`[owner-api] session ${out.body.created ? 'logged' : 'updated'}: ${out.body.ref.table} #${out.body.ref.id} (${out.body.session.id})`);
    }
    res.status(out.status).json(out.body);
  }));
}

module.exports = { checkLedgerToken, money, ownerSessions, logSession, mountRoutes, sessionLog };
