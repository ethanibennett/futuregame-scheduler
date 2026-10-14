'use strict';
/*
 * The Notify tap (docs/bankroll-merge.md, "Notify tap (built ahead of Phase 7)"): the owner sends a
 * result's backer shares from futurega.me, the way the dashboard app's Sessions edit sheet does
 * (WC:app/src/screens/BackersUI.tsx BackerNotify, WC:app/src/db/backerClient.ts notifyBackers).
 * The owner's answers of 2026-10-14 (§1.1) it is built to:
 *
 *   Q1  A manual tap. Nothing posts on save. preview() shows the cuts; commitWrite() records them
 *       and deliver() messages each backer once.
 *   Q2  A correction tells nobody. follow() moves a notified result's shares with the result,
 *       silently, and writes a revision row; a deleted result's shares are voided the same way.
 *       A result nobody notified is never touched.
 *   Q7  A standing stake and a series agreement on the same tournament: flagged, and the owner
 *       confirms. Until the import links the two `backers`, the series side is found by NAME.
 *   Q8  Every game on its own (lib/staking/classify.js).
 *   Q12 A cash share is of the net after tips and session expenses (standing.js cashNetCents).
 *
 * WHO IS STAKED: the backers whose /b/ page this app serves.
 *   - The synced roster, console_records store 'backers' (deleted = 0): the dashboard's undated
 *     stakes, its delivery.sms and its opening. The first live record for a token wins, as for the
 *     page (backer-surface.js consoleIndex).
 *   - Under BACKER_PAGE_SOURCE=sql, a backers row of the owner's that owns a public_token: its
 *     standing agreements with their dated stakes and exclusions, notify_sms with a phone, and the
 *     agreements' openings. Such a row decides for its own token, as the page does (buildFeed).
 *
 * THE FIGURES ARE THE SERVER'S. The client sends a reference ({ refTable, refId }) and never a
 * figure. resultCents is the result's net in USD cents (a tournament: the ledger's
 * cash - buy-in x bullets; a cash session: cash-out - buy-in - tips - expenses), another currency
 * converted at the cached rate (rates are units per 1 USD, standing.js usdCents). The pct is the
 * stake that applies (standing.js matchStake through resultCuts); the share is shareCents.
 *
 * THE EVENT. A backer_events row with id `<token>:<session>` and session `fg-te-<id>` or
 * `fg-cs-<id>`. The dashboard's session ids are UUIDs and `chat-<sha1>`, neither of which can
 * start with `fg-`, so the two apps cannot collide. source 'ledger', ref_table / ref_id the result,
 * notified_share_cents / notified_at set at the tap: the delivery sweep takes only
 * notified_at IS NULL, so it can never send one of these a second time. A 'post' revision row
 * records the basis (game, channel, currency, rate) that follow() re-derives from.
 *
 * NOTHING THAT IDENTIFIES A PAGE LEAVES THE SERVER. Tokens are capabilities and event ids embed
 * them, so a backer is named to the client by `key` (the roster record's id, or `b<backers.id>`).
 */

const { hasTable, hasColumn } = require('../money-merge');
const surface = require('../backer-surface');
const { resultCuts, shareCents, usdCents, tournamentNetCents, cashNetCents, loadAgreements, loadExclusions } = require('./standing');
const { classifyTournament, classifyCash, FORMAT_LABEL } = require('./classify');
const { normaliseDate, nativeCurrency } = require('../analytics');

const REF = { tracking_entries: 'te', cash_sessions: 'cs' };
const REF_TABLES = Object.keys(REF);
const sessionIdFor = (table, id) => `fg-${REF[table]}-${id}`;
const isSet = (v) => typeof v === 'string' && v.trim() !== '';
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const normName = (s) => String(s == null ? '' : s).trim().toLowerCase();

// ── small SQL helpers ────────────────────────────────────────────────────────────────────

function rowsOf(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const oneRow = (db, sql, params) => rowsOf(db, sql, params)[0] || null;

const EVENT_COLUMNS = ['source', 'ref_table', 'ref_id', 'agreement_id', 'stake_id', 'revised_at', 'notified_share_cents', 'notified_at'];
const readyCache = new WeakMap();
/** Has the money-merge migration given backer_events its ledger columns (and the revisions table)? */
function schemaReady(db) {
  if (readyCache.get(db)) return true;
  const ok = hasTable(db, 'backer_events') && hasTable(db, 'backer_event_revisions') && hasTable(db, 'console_records')
    && EVENT_COLUMNS.every((c) => hasColumn(db, 'backer_events', c));
  if (ok) readyCache.set(db, true);
  return ok;
}

// ── the result ───────────────────────────────────────────────────────────────────────────

/**
 * The game as a backer reads it, in the dashboard's style (sessionGameLabel): "NLH MTT" for a
 * tournament, "2/5 NLH" for a cash game. A game classify.js has no key for keeps its own words
 * ("LHE MTT", "4/8 Stud Hi") rather than reading "Other".
 */
function gameLabel(kind, format, rawGame, stakes) {
  const base = format && format !== 'other' ? (FORMAT_LABEL[format] || format) : (clip(rawGame, 40) || 'Other');
  if (kind === 'tournament') return `${base} MTT`.slice(0, 120);
  const st = clip(stakes, 20);
  return (st ? `${st} ${base}` : base).slice(0, 120);
}

function extrasOf(db, table, id, userId) {
  if (!hasTable(db, 'session_extras')) return null;
  return oneRow(db, 'SELECT format, channel, hours FROM session_extras WHERE ref_table = ? AND ref_id = ? AND user_id = ?', [table, id, userId]);
}

/**
 * One result as it is in the database now, or null when it is gone (or, for a tournament result,
 * its event row is: such a result has left every list and the ledger). Not scoped to a user: the
 * caller checks userId. -> { table, id, userId, kind, tournamentId, ended, date, format, channel,
 *   game, venue, hours, currency, nativeCents }
 */
function readResult(db, ref) {
  const id = Number(ref && ref.id);
  if (!ref || !REF[ref.table] || !Number.isSafeInteger(id) || id <= 0) return null;
  if (ref.table === 'tracking_entries') {
    const r = oneRow(db, `SELECT te.id, te.user_id, te.tournament_id, te.num_entries, te.cashed, te.cash_amount, te.created_at,
        t.date, t.buyin, t.venue, t.property, t.site, t.game_variant, t.is_online
      FROM tracking_entries te JOIN tournaments t ON t.id = te.tournament_id WHERE te.id = ?`, [id]);
    if (!r) return null;
    const ex = extrasOf(db, 'tracking_entries', id, r.user_id);
    const c = classifyTournament(r, ex);
    const online = Number(r.is_online) === 1;
    return {
      table: 'tracking_entries', id, userId: r.user_id, kind: 'tournament', tournamentId: r.tournament_id, ended: true,
      date: normaliseDate(r.date) || normaliseDate(String(r.created_at || '').slice(0, 10)) || null,
      format: c.format, channel: c.channel,
      game: gameLabel('tournament', c.format, r.game_variant),
      venue: clip((online ? (r.site || r.property) : r.property) || r.venue, 80),
      hours: ex && Number(ex.hours) > 0 ? round2(ex.hours) : 0,
      currency: nativeCurrency(r.venue),
      nativeCents: tournamentNetCents(r),
    };
  }
  const r = oneRow(db, `SELECT id, user_id, started_at, ended_at, session_date, room, game, stakes, buy_in, cash_out, tips, expenses, currency
    FROM cash_sessions WHERE id = ?`, [id]);
  if (!r) return null;
  const ex = extrasOf(db, 'cash_sessions', id, r.user_id);
  const c = classifyCash(r, ex);
  const ended = r.ended_at != null;
  const ms = ended ? Date.parse(r.ended_at) - Date.parse(r.started_at) : 0;
  return {
    table: 'cash_sessions', id, userId: r.user_id, kind: 'cash', tournamentId: null, ended,
    date: normaliseDate(r.session_date) || null,
    format: c.format, channel: c.channel,
    game: gameLabel('cash', c.format, r.game, r.stakes),
    venue: clip(r.room, 80),
    hours: ms > 0 ? round2(ms / 3600e3) : 0,
    currency: r.currency || 'USD',
    nativeCents: ended ? cashNetCents(r) : 0,
  };
}

/** Units of `currency` per 1 USD; 1 for USD. Throws (status 503) when the rates do not have it. */
function rateFor(currency, rates) {
  if (!currency || currency === 'USD') return 1;
  const r = rates && Number(rates[currency]);
  if (!(r > 0)) throw Object.assign(new Error(`There is no exchange rate for ${currency} on this server right now. Try again in a minute.`), { status: 503 });
  return r;
}
const toUsdCents = (nativeCents, currency, rate) => usdCents(nativeCents, currency, { [currency]: rate });

// ── the backers ──────────────────────────────────────────────────────────────────────────

/** A roster stake as the share math takes it, or null. The dashboard's stakes are undated. */
function rosterStake(s) {
  if (!s || typeof s !== 'object') return null;
  const pct = Number(s.pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return {
    id: null,
    format: typeof s.format === 'string' && s.format ? s.format : 'all',
    channel: s.channel === 'live' || s.channel === 'online' ? s.channel : 'any',
    pct,
  };
}

/** token -> { recId, rec } for every live roster record (the first record for a token wins). */
function rosterRecords(db) {
  const out = new Map();
  for (const row of rowsOf(db, "SELECT id, data FROM console_records WHERE store = 'backers' AND deleted = 0")) {
    let rec = null;
    try { rec = JSON.parse(row.data); } catch (_) { continue; }
    if (rec && typeof rec.token === 'string' && !out.has(rec.token)) out.set(rec.token, { recId: String(row.id), rec });
  }
  return out;
}

const publicName = (db, token) => (oneRow(db, 'SELECT name FROM backer_public WHERE token = ?', [token]) || {}).name || null;

/**
 * Every backer whose page this app serves, with what decides their share:
 *   [{ key, token, kind: 'roster'|'sql', backerId, name, agreements, sms, openingCents }]
 * `agreements` is resultCuts' input: a roster backer has one, always active, with no window.
 */
function stakedBackers(db, ownerId, { source = 'console' } = {}) {
  const sqlOn = source === 'sql' && surface.sqlReady(db);
  const all = sqlOn ? loadAgreements(db, ownerId) : [];
  const sqlEntry = (b, token) => {
    const agreements = all.filter((a) => a.backerId === b.id);
    return {
      key: `b${b.id}`, token, kind: 'sql', backerId: b.id,
      name: clip(b.name, 80) || publicName(db, token),
      agreements,
      sms: Number(b.notify_sms) && isSet(b.phone) ? b.phone.trim() : null,
      openingCents: agreements.reduce((s, a) => s + (Number(a.openingCents) || 0), 0),
    };
  };
  const out = [];
  const seen = new Set();
  for (const [token, { recId, rec }] of rosterRecords(db)) {
    if (!surface.BACKER_TOKEN_RE.test(token)) continue;
    seen.add(token);
    const owned = sqlOn ? oneRow(db, 'SELECT id, name, phone, notify_sms FROM backers WHERE public_token = ? AND user_id = ?', [token, ownerId]) : null;
    if (owned) { out.push(sqlEntry(owned, token)); continue; }
    const d = rec.delivery || {};
    out.push({
      key: recId, token, kind: 'roster', backerId: null,
      name: clip(rec.name, 80) || publicName(db, token),
      agreements: [{
        id: null, backerId: null, status: 'active', effectiveFrom: null, effectiveTo: null,
        stakes: (Array.isArray(rec.stakes) ? rec.stakes : []).map(rosterStake).filter(Boolean),
      }],
      sms: isSet(d.sms) ? d.sms.trim() : null,
      openingCents: Math.round((Number(rec.opening) || 0) * 100),
    });
  }
  if (sqlOn) {
    for (const b of rowsOf(db, 'SELECT id, name, phone, notify_sms, public_token FROM backers WHERE user_id = ? AND public_token IS NOT NULL ORDER BY id', [ownerId])) {
      if (seen.has(b.public_token) || !surface.BACKER_TOKEN_RE.test(b.public_token)) continue;
      seen.add(b.public_token);
      out.push(sqlEntry(b, b.public_token));
    }
  }
  return out;
}

/**
 * Owner Q7, for now: the series agreements of the owner's that cover this tournament (a
 * backer_event_status row under an active agreement). The `backers` a series agreement names are
 * not yet linked to the roster's backers (the import does that), so a standing backer is matched
 * to them by name; a backers row is matched by id as well.
 * -> { byName: Map(normName -> [series name]), byId: Map(backers.id -> [series name]), ids: Set }
 */
function seriesOverlap(db, ownerId, tournamentId) {
  const byName = new Map(), byId = new Map();
  if (tournamentId == null) return { byName, byId, ids: new Set() };
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(v)) m.get(k).push(v); };
  for (const r of rowsOf(db, `SELECT b.id AS backer_id, b.name AS backer, ss.name AS series
      FROM backer_event_status bes
      JOIN backer_agreements ba ON ba.id = bes.agreement_id
      JOIN staking_series ss ON ss.id = ba.series_id
      JOIN backers b ON b.id = ba.backer_id
      WHERE bes.tournament_id = ? AND ba.is_active = 1 AND ss.user_id = ?
      ORDER BY ss.id`, [tournamentId, ownerId])) {
    const series = clip(r.series, 80) || 'a series';
    if (normName(r.backer)) add(byName, normName(r.backer), series);
    add(byId, r.backer_id, series);
  }
  return { byName, byId, ids: new Set(byId.keys()) };
}

/** The dashboard's shares for this backer on this date: the same night may already be notified. */
function dashboardSharesOn(db, token, date) {
  if (!date) return [];
  return rowsOf(db, `SELECT date, game, venue, share_cents FROM backer_events
    WHERE token = ? AND date = ? AND session_id NOT LIKE 'fg-%' AND COALESCE(source, 'dashboard') = 'dashboard'
    ORDER BY ts`, [token, date]);
}

// ── the block (preview) ──────────────────────────────────────────────────────────────────

const ledgerEventsOf = (db, table, id) =>
  rowsOf(db, "SELECT * FROM backer_events WHERE ref_table = ? AND ref_id = ? AND source = 'ledger' ORDER BY ts, id", [table, id]);

/**
 * Everything the Backers block shows for one result, computed here.
 *   opts: { ownerId, ref: { table, id }, source, rates, env }
 * -> { status, body } where a 200 body is
 *   { result: { refTable, refId, kind, date, game, venue, hours, currency, nativeCents, resultCents, rate, format, channel },
 *     backers: [{ key, name, pct, shareCents, resultCents, status: 'new'|'sent', sentAt, sentShareCents, updated, warnings }],
 *     pending, sent, needsConfirm, state: 'none'|'preview'|'partial'|'sent', rosterSize, delivery: 'on'|'off' }
 *   warnings: [{ kind: 'dashboard', date, game, venue, shareCents } | { kind: 'series', series: [name] }]
 * and, for the module's own use, `fact` and `entries` (with each new entry's backer and cut).
 */
function buildBlock(db, { ownerId, ref, source = 'console', rates = null, env = process.env } = {}) {
  if (!schemaReady(db)) return { status: 503, body: { error: 'The backer tables are not ready on this server yet.' } };
  const fact = readResult(db, ref);
  if (!fact || ownerId == null || Number(fact.userId) !== Number(ownerId)) return { status: 404, body: { error: 'Result not found' } };
  if (!fact.ended) return { status: 409, body: { error: 'A live session has no result yet. End it, then notify its backers.', live: true } };
  const rate = rateFor(fact.currency, rates);
  const resultCents = toUsdCents(fact.nativeCents, fact.currency, rate);
  const backers = stakedBackers(db, ownerId, { source });
  const events = ledgerEventsOf(db, fact.table, fact.id);
  const byToken = new Map(events.map((e) => [e.token, e]));
  const exclusions = source === 'sql' && surface.sqlReady(db) ? loadExclusions(db, ownerId) : new Set();
  const overlap = fact.kind === 'tournament' ? seriesOverlap(db, ownerId, fact.tournamentId) : seriesOverlap(db, ownerId, null);
  const result = { table: fact.table, id: fact.id, kind: fact.kind, date: fact.date, format: fact.format, channel: fact.channel, resultCents, ended: true };

  const entries = [];
  const sentEntry = (b, ev, key) => ({
    key, name: b ? b.name : publicName(db, ev.token),
    pct: Number(ev.pct), shareCents: ev.share_cents, resultCents: ev.session_result_cents,
    status: 'sent', sentAt: ev.notified_at == null ? ev.ts : ev.notified_at,
    sentShareCents: ev.notified_share_cents == null ? ev.share_cents : ev.notified_share_cents,
    updated: ev.notified_share_cents != null && ev.share_cents !== ev.notified_share_cents,
    warnings: [],
  });
  for (const b of backers) {
    const ev = byToken.get(b.token);
    if (ev) { entries.push(sentEntry(b, ev, b.key)); byToken.delete(b.token); continue; }
    const { cuts } = resultCuts({ agreements: b.agreements, result, exclusions, seriesBackerIds: overlap.ids });
    if (!cuts.length) continue;
    const cut = cuts[0];
    const warnings = dashboardSharesOn(db, b.token, fact.date)
      .map((d) => ({ kind: 'dashboard', date: d.date, game: d.game || '', venue: d.venue || '', shareCents: d.share_cents }));
    const series = [...new Set([
      ...(overlap.byName.get(normName(b.name)) || []),
      ...(b.backerId != null ? overlap.byId.get(b.backerId) || [] : []),
    ])];
    if (series.length) warnings.push({ kind: 'series', series });
    entries.push({
      key: b.key, name: b.name, pct: cut.pct, shareCents: cut.shareCents, resultCents,
      status: 'new', sentAt: null, sentShareCents: null, updated: false, warnings,
      backer: b, cut,
    });
  }
  // A share sent to a backer who has since left the roster is still on their page: it stays listed.
  let n = 0;
  for (const ev of byToken.values()) entries.push(sentEntry(null, ev, `e${++n}`));
  entries.sort((x, y) => Math.abs(y.shareCents) - Math.abs(x.shareCents) || String(x.name || '').localeCompare(String(y.name || '')));

  const pending = entries.filter((e) => e.status === 'new');
  const sent = entries.length - pending.length;
  const body = {
    result: {
      refTable: fact.table, refId: fact.id, kind: fact.kind, date: fact.date, game: fact.game, venue: fact.venue, hours: fact.hours,
      currency: fact.currency, nativeCents: fact.nativeCents, resultCents, rate, format: fact.format, channel: fact.channel,
    },
    backers: entries.map(({ backer, cut, ...pub }) => pub),
    pending: pending.length,
    sent,
    needsConfirm: pending.some((e) => e.warnings.length > 0),
    state: !entries.length ? 'none' : !pending.length ? 'sent' : sent ? 'partial' : 'preview',
    rosterSize: backers.length,
    delivery: surface.deliveryOn(env) ? 'on' : 'off',
  };
  return { status: 200, body, fact, entries, rate };
}

/** The Backers block for one result (POST /api/staking/standing/notify with preview). */
function preview(db, opts) {
  const r = buildBlock(db, opts);
  return { status: r.status, body: r.body };
}

// ── commit ───────────────────────────────────────────────────────────────────────────────

/** What follow() re-derives from: the classification and the rate the share was computed at. */
const basisOf = (fact, rate) => ({
  format: fact.format, channel: fact.channel, date: fact.date, currency: fact.currency, rate, nativeCents: fact.nativeCents,
});

function revision(db, ev, { at, action, before, after, cause, basis }) {
  db.run(`INSERT INTO backer_event_revisions (event_id, token, at, action, share_before, share_after, result_before, result_after, pct_before, pct_after, cause, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [ev.id, ev.token, at, action,
    before ? before.share_cents : null, after ? after.share_cents : null,
    before ? before.session_result_cents : null, after ? after.session_result_cents : null,
    before ? before.pct : null, after ? after.pct : null,
    cause, basis ? JSON.stringify({ basis }) : null]);
}

/**
 * Records the shares of every staked backer who has not been sent this result yet, in one
 * savepoint. Writes nothing when there is nothing new ("already sent"), or when a new share needs
 * the owner's second confirm (a dashboard share on the same date, or a series agreement on the
 * same tournament) and `confirm` is not true.
 *   opts: buildBlock's, plus { confirm, now }
 * -> { status, body, inserted: [{ key, name, token, sms, openingCents, event }] }
 * The caller saves the database, then calls deliver() with `inserted`.
 */
function commitWrite(db, opts = {}) {
  const built = buildBlock(db, opts);
  if (built.status !== 200) return { status: built.status, body: built.body, inserted: [] };
  const news = built.entries.filter((e) => e.status === 'new');
  if (!news.length) return { status: 200, body: { ...built.body, already: built.body.sent > 0, sentNow: 0 }, inserted: [] };
  if (built.body.needsConfirm && opts.confirm !== true) {
    return {
      status: 409,
      body: { ...built.body, error: 'Some of these backers may already have this night from the dashboard app. Confirm to send anyway.' },
      inserted: [],
    };
  }
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const f = built.fact;
  const sid = sessionIdFor(f.table, f.id);
  const basis = basisOf(f, built.rate);
  const inserted = [];
  db.run('SAVEPOINT notify_tap');
  try {
    for (const e of news) {
      const b = e.backer, c = e.cut;
      const ev = {
        id: `${b.token}:${sid}`, token: b.token, session_id: sid, ts: now,
        date: f.date || '', game: f.game, venue: f.venue, hours: f.hours,
        session_result_cents: e.resultCents, pct: c.pct, share_cents: c.shareCents,
      };
      db.run(`INSERT OR IGNORE INTO backer_events
          (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents,
           source, agreement_id, stake_id, ref_table, ref_id, notified_share_cents, notified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ledger', ?, ?, ?, ?, ?, ?)`,
      [ev.id, ev.token, ev.session_id, ev.ts, ev.date, ev.game, ev.venue, ev.hours, ev.session_result_cents, ev.pct, ev.share_cents,
        c.agreementId, c.stakeId, f.table, f.id, ev.share_cents, now]);
      if (!db.getRowsModified()) continue; // recorded meanwhile: never twice
      // As the dashboard's relay does: the page's name is the one the last share was sent under.
      if (b.name) {
        db.run(`INSERT INTO backer_public (token, name, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(token) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`, [b.token, b.name, now]);
      }
      revision(db, ev, { at: now, action: 'post', after: ev, cause: 'notify', basis });
      inserted.push({ key: e.key, name: b.name, token: b.token, sms: b.sms, openingCents: b.openingCents, event: ev });
    }
    db.run('RELEASE notify_tap');
  } catch (err) {
    try { db.run('ROLLBACK TO notify_tap'); db.run('RELEASE notify_tap'); } catch (_) { /* nothing open */ }
    throw err;
  }
  const after = buildBlock(db, opts);
  return { status: 200, body: { ...after.body, already: false, sentNow: inserted.length }, inserted };
}

/**
 * Tells each backer just recorded, once: a push to their page's subscriptions and, where they take
 * texts, an SMS, with the dashboard relay's own wording (backer-surface.js shareMessages). Only
 * where delivery is on (BACKER_DELIVERY, or Render): elsewhere `deliver` is never called.
 *   deliver({ token, sms, messages }) -> { push: { sent, subs, changed? }, sms: 'sent'|'none'|... }
 * -> { delivery: 'on'|'off', results: [{ key, name, pushed, subs, sms }], changed }
 */
async function deliver(db, inserted, { env = process.env, deliver: send, log = console } = {}) {
  const list = inserted || [];
  if (!surface.deliveryOn(env) || typeof send !== 'function') {
    return { delivery: 'off', results: list.map((i) => ({ key: i.key, name: i.name, pushed: 0, subs: 0, sms: 'off' })), changed: false };
  }
  const results = [];
  let changed = false;
  for (const i of list) {
    const cumulative = surface.backerCumulativeCents(db, i.token) + (Number(i.openingCents) || 0);
    const messages = surface.shareMessages(i.event, cumulative);
    try {
      const r = (await send({ token: i.token, sms: i.sms, messages })) || {};
      const push = r.push || {};
      if (push.changed) changed = true;
      results.push({ key: i.key, name: i.name, pushed: push.sent || 0, subs: push.subs || 0, sms: r.sms || 'none' });
    } catch (err) {
      log.error('[backers] notify: a delivery failed:', err && err.message);
      results.push({ key: i.key, name: i.name, pushed: 0, subs: 0, sms: 'error', error: true });
    }
  }
  return { delivery: 'on', results, changed };
}

// ── follow: a notified result changed ────────────────────────────────────────────────────

function lastBasis(db, eventId) {
  const r = oneRow(db, `SELECT note FROM backer_event_revisions WHERE event_id = ? AND action IN ('post', 'revise') AND note IS NOT NULL
    ORDER BY id DESC LIMIT 1`, [eventId]);
  if (!r) return null;
  try { return JSON.parse(r.note).basis || null; } catch (_) { return null; }
}

function voidEvent(db, ev, now, cause) {
  db.run('DELETE FROM backer_events WHERE id = ?', [ev.id]);
  revision(db, ev, { at: now, action: 'void', before: ev, cause });
}

const same = (a, b) => (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : String(a == null ? '' : a) === String(b == null ? '' : b));

/**
 * Makes a result's notified shares match the result as it is now (owner Q2: silently). Run after
 * every write to a result; a result with no ledger share returns at once and is never touched.
 *
 *   gone (deleted, or its tournament row is)   each share is voided: the event is deleted (the
 *                                              page's total drops with it), a 'void' revision kept
 *   changed                                    each share is re-derived and a 'revise' revision
 *                                              written. Its pct stays the one it was sent at,
 *                                              unless the game or channel changed (or, for a
 *                                              backer whose stakes are dated, the date): then it is
 *                                              re-matched against the backer's stakes, and voided
 *                                              when they no longer cover the result. Another
 *                                              currency keeps the rate it was sent at (a share
 *                                              follows the result, not the exchange rate).
 *   unchanged                                  nothing is written
 *
 * notified_share_cents and notified_at are never touched: they record what the backer was told,
 * and the Backers block reads "Updated" where the share has moved since. Nothing is sent.
 * Not scoped to a caller: it only ever makes the shares agree with the row. -> { revised, voided }
 */
function follow(db, ref, { rates = null, source = surface.pageSource(), now = Date.now() } = {}) {
  const none = { revised: 0, voided: 0 };
  const id = Number(ref && ref.id);
  if (!ref || !REF[ref.table] || !Number.isSafeInteger(id) || id <= 0 || !schemaReady(db)) return none;
  const events = ledgerEventsOf(db, ref.table, id);
  if (!events.length) return none;
  const fact = readResult(db, { table: ref.table, id });
  let revised = 0, voided = 0;
  let backers = null;
  const backerOf = (token) => {
    if (!backers) backers = new Map(stakedBackers(db, fact.userId, { source }).map((b) => [b.token, b]));
    return backers.get(token) || null;
  };
  db.run('SAVEPOINT notify_follow');
  try {
    for (const ev of events) {
      if (!fact) { voidEvent(db, ev, now, 'owner-delete'); voided++; continue; }
      if (!fact.ended) continue; // cannot happen: a session does not go back to live
      const basis = lastBasis(db, ev.id);
      let pct = Number(ev.pct);
      let stakeId = ev.stake_id == null ? null : ev.stake_id;
      const b = backerOf(ev.token);
      const reclassified = !!basis && (basis.format !== fact.format || basis.channel !== fact.channel);
      const redated = !!basis && basis.date !== fact.date && !!b && b.kind === 'sql';
      if (reclassified || redated) {
        // The stakes that cover the result as it now reads (an active agreement in its window).
        const { cuts } = b ? resultCuts({
          agreements: b.agreements,
          result: { table: fact.table, id: fact.id, kind: fact.kind, date: fact.date, format: fact.format, channel: fact.channel, resultCents: 0, ended: true },
        }) : { cuts: [] };
        if (!cuts.length) { voidEvent(db, ev, now, 'reclassified'); voided++; continue; }
        pct = Number(cuts[0].pct);
        stakeId = cuts[0].stakeId == null ? null : cuts[0].stakeId;
      }
      const rate = fact.currency === 'USD' ? 1
        : basis && basis.currency === fact.currency && Number(basis.rate) > 0 ? Number(basis.rate)
          : rateFor(fact.currency, rates);
      const resultCents = toUsdCents(fact.nativeCents, fact.currency, rate);
      const next = {
        date: fact.date || '', game: fact.game, venue: fact.venue, hours: fact.hours,
        session_result_cents: resultCents, pct, share_cents: shareCents(resultCents, pct),
      };
      if (Object.keys(next).every((k) => same(ev[k], next[k]))) continue;
      db.run(`UPDATE backer_events SET date = ?, game = ?, venue = ?, hours = ?, session_result_cents = ?, pct = ?, share_cents = ?,
          stake_id = ?, revised_at = ? WHERE id = ?`,
      [next.date, next.game, next.venue, next.hours, next.session_result_cents, next.pct, next.share_cents, stakeId, now, ev.id]);
      revision(db, ev, { at: now, action: 'revise', before: ev, after: next, cause: 'owner-edit', basis: { ...basisOf(fact, rate) } });
      revised++;
    }
    db.run('RELEASE notify_follow');
  } catch (err) {
    try { db.run('ROLLBACK TO notify_follow'); db.run('RELEASE notify_follow'); } catch (_) { /* nothing open */ }
    throw err;
  }
  return { revised, voided };
}

/** The ids in `table` that carry a ledger share (a bulk delete follows only those). */
function refsWithShares(db, table) {
  if (!REF[table] || !schemaReady(db)) return new Set();
  return new Set(rowsOf(db, "SELECT DISTINCT ref_id FROM backer_events WHERE source = 'ledger' AND ref_table = ?", [table]).map((r) => Number(r.ref_id)));
}

module.exports = {
  REF_TABLES, sessionIdFor, schemaReady, gameLabel, readResult, rateFor, stakedBackers, seriesOverlap, dashboardSharesOn,
  buildBlock, preview, commitWrite, deliver, follow, refsWithShares,
};
