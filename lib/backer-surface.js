'use strict';
/*
 * The backer surface (docs/bankroll-merge.md §6.7, §7): everything behind /b/<token> that is
 * decided by data rather than by HTTP, moved out of server.js so it can be tested against a real
 * database without booting the app. Phase 2 of the bankroll merge.
 *
 *   FEED       buildFeed(db, token, { source })
 *              The page's data. `source` is 'console' (the dashboard-era path: the roster lives in
 *              console_records, the page reads name / stakes / opening from there) or 'sql' (the
 *              merged path: the backers table and standing agreements). 'console' is byte for byte
 *              what server.js served before this module existed; the parity route proves it.
 *   PARITY     parity(db) computes the feed both ways for every token and says where they differ.
 *   DIGEST     weeklyDigests(db, { source }) builds the Sunday emails (recipients + html).
 *   GATE       deliveryOn(env): push, SMS and the digest are sent only where BACKER_DELIVERY is on
 *              (default: on when RENDER is set). The local pm2 box can never message a backer.
 *   SWEEP      sweep(db, ...) delivers a posted share exactly once. Dormant until a later phase
 *              creates 'ledger' events; it never touches the dashboard's.
 *   ROTATION   rotateBackerToken(db, old, new) moves a link across every table that carries it.
 *
 * Nothing here changes what a live backer sees: pageSource() defaults to 'console', and even with
 * 'sql' a token that no backers.public_token claims is served by the console path, so until the
 * import (Phase 5) gives a backers row a public_token the two paths are the same code.
 *
 * Tokens are capabilities (the whole authentication on /b/<token>). Nothing in this file logs one,
 * and parity() returns none.
 */

const { hasTable, hasColumn } = require('./money-merge');
const { stakesInForce, inWindow, newToken } = require('./staking/standing');
const { FORMAT_LABEL } = require('./staking/classify');

const BACKER_TOKEN_RE = /^[A-Za-z0-9]{6,64}$/; // short base62 codes + legacy 32-hex
const TZ = 'America/New_York'; // the owner's clock (server.js CONSOLE_TZ)

// ── small SQL helpers ────────────────────────────────────────────────────────────────────

function rowsOf(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const oneRow = (db, sql, params) => rowsOf(db, sql, params)[0] || null;

/** YYYY-MM-DD on the owner's clock. */
function todayET(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// ── the two switches ─────────────────────────────────────────────────────────────────────

const ON = new Set(['1', 'true', 'on', 'yes']);
const OFF = new Set(['0', 'false', 'off', 'no']);

/**
 * May this process message a backer (web push, SMS, the weekly email)?
 *
 *   BACKER_DELIVERY=1|0   an explicit answer wins.
 *   otherwise             on when RENDER is set (production), off everywhere else.
 *
 * An unrecognised value is OFF: a typo must never be the thing that texts a backer from the
 * Windows box. -> { on, why } ; `why` is for the boot log.
 */
function deliveryDecision(env = process.env) {
  const raw = String(env.BACKER_DELIVERY == null ? '' : env.BACKER_DELIVERY).trim().toLowerCase();
  if (raw) {
    if (ON.has(raw)) return { on: true, why: 'BACKER_DELIVERY is on' };
    if (OFF.has(raw)) return { on: false, why: 'BACKER_DELIVERY is off' };
    return { on: false, why: 'BACKER_DELIVERY has a value this server does not recognise (use 1 or 0), so it is treated as off' };
  }
  const render = String(env.RENDER == null ? '' : env.RENDER).trim().toLowerCase();
  if (render && !OFF.has(render)) return { on: true, why: 'RENDER is set (production)' };
  return { on: false, why: 'neither BACKER_DELIVERY nor RENDER is set' };
}
const deliveryOn = (env = process.env) => deliveryDecision(env).on;

/**
 * Where /b/<token> reads the backer's name, stakes and opening: 'console' (the default; the
 * dashboard-era roster in console_records) or 'sql' (BACKER_PAGE_SOURCE=sql; the backers table
 * and standing agreements, with console_records as the fallback for a token no backers row owns).
 */
function pageSource(env = process.env) {
  return String(env.BACKER_PAGE_SOURCE == null ? '' : env.BACKER_PAGE_SOURCE).trim().toLowerCase() === 'sql' ? 'sql' : 'console';
}

// ── money text (moved from server.js unchanged) ──────────────────────────────────────────

function fmtSignedCents(cents) {
  const v = (Number(cents) || 0) / 100;
  const n = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (v < 0 ? '−' : '+') + '$' + n;
}
function fmtHours(h) {
  return (Math.round((Number(h) || 0) * 10) / 10) + 'h';
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── stakes line ──────────────────────────────────────────────────────────────────────────

// The dashboard's nine format keys and the labels its page has always shown (moved from server.js
// unchanged). The old path uses exactly these; the SQL path falls back to classify.js GAMES for a
// game the dashboard never had (PLO5, PLO6 8/b ...).
const SRV_FMT_LABEL = {
  PLO: 'PLO', PLO8: 'PLO8', NLH: 'NLH', mixed: 'Mixed', stud8: 'Stud8',
  razz: 'Razz', '2-7': '2-7', BigO: 'Big O', other: 'Other', all: 'all games',
};
function summarizeStakes(stakes, labelFor) {
  if (!Array.isArray(stakes) || !stakes.length) return '';
  return stakes
    .map((s) => {
      const f = labelFor(s.format);
      const c = s.channel && s.channel !== 'any' ? ` (${s.channel})` : '';
      return `${s.pct}% ${f}${c}`;
    })
    .join(' · ');
}
/** The dashboard-era stakes line, byte for byte. */
function stakesSummaryServer(stakes) {
  return summarizeStakes(stakes, (f) => SRV_FMT_LABEL[f] || f);
}
/** The same line for stakes that may name any game: the nine keys read as above. */
function stakesSummary(stakes) {
  return summarizeStakes(stakes, (f) => SRV_FMT_LABEL[f] || FORMAT_LABEL[f] || f);
}

// ── the console_records roster (the dashboard-era store) ─────────────────────────────────

/** token -> backer object, for every live (not deleted) roster record. The first record wins. */
function consoleIndex(db) {
  const map = new Map();
  const s = db.prepare("SELECT data FROM console_records WHERE store = 'backers' AND deleted = 0");
  try {
    while (s.step()) {
      try {
        const b = JSON.parse(s.getAsObject().data);
        if (b && typeof b.token === 'string' && !map.has(b.token)) map.set(b.token, b);
      } catch (_) { /* skip malformed */ }
    }
  } finally { s.free(); }
  return map;
}
/** The roster object for one token, or null. (Stops at the first match, as the old route did.) */
function recordByToken(db, token) {
  const s = db.prepare("SELECT data FROM console_records WHERE store = 'backers' AND deleted = 0");
  let found = null;
  try {
    while (s.step()) {
      try {
        const b = JSON.parse(s.getAsObject().data);
        if (b && b.token === token) { found = b; break; }
      } catch (_) { /* skip malformed */ }
    }
  } finally { s.free(); }
  return found;
}

// ── the merged roster (backers + standing agreements) ────────────────────────────────────

const readyCache = new WeakMap(); // db -> true once the merge schema is seen (never cached false)
/** Has the money-merge migration run on this database? */
function sqlReady(db) {
  if (readyCache.get(db)) return true;
  const ok = hasTable(db, 'standing_agreements') && hasTable(db, 'standing_stakes') && hasColumn(db, 'backers', 'public_token');
  if (ok) readyCache.set(db, true);
  return ok;
}

/** The agreements of one backer, each with its stakes. */
function agreementsOf(db, backerId) {
  const list = rowsOf(db, `SELECT id, status, effective_from, effective_to, opening_cents
    FROM standing_agreements WHERE backer_id = ? ORDER BY id`, [backerId]);
  if (!list.length) return [];
  const stakes = rowsOf(db, `SELECT id, agreement_id, format, channel, pct, valid_from, valid_to
    FROM standing_stakes WHERE agreement_id IN (${list.map(() => '?').join(',')}) ORDER BY id`, list.map((a) => a.id));
  return list.map((a) => ({ ...a, stakes: stakes.filter((s) => s.agreement_id === a.id) }));
}

/**
 * The backers row that owns this token, with what the page shows from it, or null when none does
 * (the caller then falls back to the console roster).
 *
 *   stakes        the stakes in force TODAY, across the agreements that are active today. An agreement
 *                 that has ended contributes none: the page keeps its history and shows no stakes.
 *   openingCents  the sum of EVERY agreement's opening (active or ended), because a new agreement
 *                 starts at 0 and the running total carries through the token (§6.1).
 */
function sqlBackerByToken(db, token, today = todayET()) {
  if (!sqlReady(db)) return null;
  const b = oneRow(db, 'SELECT id, user_id, name, email, phone, notify_sms, notify_email FROM backers WHERE public_token = ?', [token]);
  if (!b) return null;
  const agreements = agreementsOf(db, b.id);
  const active = agreements.filter((a) => a.status === 'active' && inWindow(today, a.effective_from || null, a.effective_to || null));
  const inForce = [];
  for (const a of active) inForce.push(...stakesInForce(a.stakes, today));
  return {
    id: b.id, userId: b.user_id, name: b.name, email: b.email, phone: b.phone,
    notifySms: !!b.notify_sms, notifyEmail: !!b.notify_email,
    stakes: stakesSummary(inForce),
    openingCents: agreements.reduce((a, g) => a + (Number(g.opening_cents) || 0), 0),
    hasActiveAgreement: active.length > 0,
  };
}

// ── the feed ─────────────────────────────────────────────────────────────────────────────

/* Lines an importer writes into a result's notes, not the owner's own words: never shown. */
const MACHINE_NOTES = new Set(['imported from the dashboard', 'logged from chat']);
/** 'table:id' -> the owner's notes on those results (tracking entries and cash sessions), trimmed. */
function sessionNotes(db, refs) {
  const out = new Map();
  for (const table of ['tracking_entries', 'cash_sessions']) {
    const ids = [...new Set(refs.filter((r) => r.table === table).map((r) => r.id))].filter(Number.isSafeInteger);
    if (!ids.length || !hasTable(db, table) || !hasColumn(db, table, 'notes')) continue;
    for (const r of rowsOf(db, `SELECT id, notes FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`, ids)) {
      const t = typeof r.notes === 'string' ? r.notes.trim() : '';
      if (t && !MACHINE_NOTES.has(t.toLowerCase())) out.set(`${table}:${r.id}`, t.slice(0, 2000));
    }
  }
  return out;
}

/**
 * A backer's running total before the opening: every recorded share less every payout (Phase 14,
 * lib/staking/payouts.js; owner Q10). Callers add the opening. The page, the push wording, the weekly
 * digest and the Standing view all read this, so a payout drops the total everywhere at once.
 */
function backerCumulativeCents(db, token) {
  const r = oneRow(db, 'SELECT COALESCE(SUM(share_cents),0) AS c FROM backer_events WHERE token = ?', [token]);
  return ((r && r.c) || 0) - require('./staking/payouts').paidCentsForToken(db, token);
}

/**
 * A backer's own feed: their name, running share and per-session log.
 *
 * `source: 'console'` is the route as it was in server.js before this module (name from the last
 * notify, else the roster record; stakes and opening from the roster record). `source: 'sql'`
 * reads the backers row first: the NAME is backers.name, then the last notify's, so a rename
 * shows (§6.7); stakes and opening come from the standing agreements. A token no backers row owns
 * is served by the console path in either mode.
 *
 * opts.index   a prebuilt consoleIndex(db) (parity builds one for hundreds of tokens)
 * opts.today   YYYY-MM-DD, for the stakes in force
 */
function buildFeed(db, token, opts = {}) {
  const source = opts.source === 'sql' ? 'sql' : 'console';
  const publicName = oneRow(db, 'SELECT name FROM backer_public WHERE token = ?', [token]);

  let name = null;
  let stakes = '';
  let openingCents = 0;
  const sql = source === 'sql' ? sqlBackerByToken(db, token, opts.today) : null;
  if (sql) {
    name = sql.name || (publicName && publicName.name) || null;
    stakes = sql.stakes;
    openingCents = sql.openingCents;
  } else {
    name = publicName ? publicName.name : null;
    // Fall back to the synced backer object for name + stakes, so a freshly created backer's page
    // is presentable before the first session is notified. Not after the money cutover
    // (opts.strict, Phase 7): then the backers table is the only roster.
    const rec = opts.strict ? null : opts.index ? (opts.index.get(token) || null) : recordByToken(db, token);
    if (rec) {
      if (!name) name = rec.name || null;
      stakes = stakesSummaryServer(rec.stakes || []);
      openingCents = Math.round((Number(rec.opening) || 0) * 100);
    }
  }

  const events = [];
  // A session's notes (owner, 2026-10-15: "the session cards on the backer pages should expand like
  // in the schedule to reveal the notes I've added"): the notes on the result the share was posted
  // from (a ledger share's ref, or a dashboard share the import linked). Only when there are any, so
  // a page with none is byte for byte the old one.
  const withRef = hasColumn(db, 'backer_events', 'ref_table') && hasColumn(db, 'backer_events', 'ref_id');
  // Newest session FIRST, by the session's own date — not by `ts`, which is when notify fired. The
  // two diverge whenever a session is logged late (a Saturday session notified after Sunday's has a
  // larger ts but an earlier date), which put older sessions above newer ones on the page. `date`
  // is an ISO YYYY-MM-DD string, so it orders correctly as text; ts breaks ties within a day.
  for (const r of rowsOf(db,
    `SELECT ts, date, game, venue, hours, session_result_cents, pct, share_cents${withRef ? ', ref_table, ref_id' : ''} FROM backer_events WHERE token = ? ORDER BY date DESC, ts DESC LIMIT 200`, [token])) {
    events.push({
      ts: r.ts, date: r.date, game: r.game, venue: r.venue, hours: r.hours,
      sessionResultCents: r.session_result_cents, pct: r.pct, shareCents: r.share_cents,
      _ref: withRef && r.ref_table && r.ref_id != null ? { table: r.ref_table, id: Number(r.ref_id) } : null,
    });
  }
  const notes = sessionNotes(db, events.map((e) => e._ref).filter(Boolean));
  for (const e of events) {
    const n = e._ref ? notes.get(`${e._ref.table}:${e._ref.id}`) : null;
    delete e._ref;
    if (n) e.notes = n;
  }
  let grossCents = 0, netSessionCents = 0;
  for (const e of events) {
    grossCents += e.sessionResultCents || 0;
    netSessionCents += e.shareCents || 0;
  }
  // Totals over EVERY recorded session (the list stops at 200), for the page's headline.
  const t = oneRow(db, 'SELECT COUNT(*) AS n, COALESCE(SUM(hours), 0) AS h FROM backer_events WHERE token = ?', [token]);
  // paidCents (Phase 14) only when there are payouts, so a page with none is byte for byte the old one.
  const paid = require('./staking/payouts').paidCentsForToken(db, token);
  return {
    name, stakes, openingCents, grossCents, netSessionCents,
    cumulativeCents: backerCumulativeCents(db, token) + openingCents,
    sessions: (t && t.n) || 0, hours: (t && t.h) || 0,
    events,
    ...(paid ? { paidCents: paid } : {}),
  };
}

// ── the owner's Backers view ─────────────────────────────────────────────────────────────

const PAGE_LINK_BASE = 'https://futurega.me/b/';
const SHARES_SHOWN = 10;

/** True when a roster delivery value (a phone number or an address) is set. Never returns the value. */
const isSet = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * The owner's read-only Backers view (GET /api/staking/standing/backers): one entry per live roster
 * record (console_records, store 'backers', deleted = 0) that has a link.
 *
 * Every figure comes out of buildFeed for that backer's token, with the same source the page uses,
 * so the owner sees exactly what the backer's /b/ page shows: nothing here adds, rounds or
 * recomputes a share. The roster supplies only what the page does not carry: the record's id and
 * whether texts and the weekly email are set up.
 *
 *   { id, name, stakes, openingCents, cumulativeCents, sessions, hours,
 *     shares: [last SHARES_SHOWN of the feed's events, newest first:
 *              { date, game, venue, hours, sessionResultCents, pct, shareCents }],
 *     played: [[game, hours, sessionResultCents] for EVERY event the feed holds (the page's newest
 *              200), newest first]: what the owner's tab needs to work out the player's bb/hr over
 *              the same sessions the backer's page does (vite-app/src/utils/bb-hr.js; the page does
 *              it in the browser from the feed, which gains nothing). No date, venue, share or
 *              token: they are not needed and the owner's view stays as small as it can be.
 *     delivery: { sms, email },          booleans: the number and the address stay on the server
 *     link }                             https://futurega.me/b/<token>: the owner's to copy and open
 *
 * `id` is the roster record's id, an opaque string the dashboard mints that is not the token.
 * Neither backer_events.id nor backer_event_revisions.event_id is returned: both embed the token
 * (<token>:<session>, docs/bankroll-merge.md, Phase 2 traps), so a retired token would ride out in
 * them. The only token in the answer is the live one, inside `link`, which is the owner's own
 * credential to hand on.
 *
 * Under source 'sql', a token a backers row owns takes its delivery flags from that row (a flag on
 * and an address or number on file), as the weekly email does; any other token takes them from the
 * roster record. Ordered by name, then by id.
 */
function backersView(db, opts = {}) {
  const source = opts.source === 'sql' ? 'sql' : 'console';
  const today = opts.today || todayET();
  const index = consoleIndex(db); // token -> record: the first live record wins, as for the page
  const ids = new Map();          // token -> console_records.id of that record
  const s = db.prepare("SELECT id, data FROM console_records WHERE store = 'backers' AND deleted = 0");
  try {
    while (s.step()) {
      const row = s.getAsObject();
      try {
        const b = JSON.parse(row.data);
        if (b && typeof b.token === 'string' && index.get(b.token) && !ids.has(b.token)) ids.set(b.token, String(row.id));
      } catch (_) { /* skip malformed */ }
    }
  } finally { s.free(); }

  const out = [];
  for (const [token, rec] of index) {
    if (!BACKER_TOKEN_RE.test(token)) continue; // no usable link, so no page to show
    const feed = buildFeed(db, token, { source, index, today });
    const d = rec.delivery || {};
    let sms = isSet(d.sms), email = isSet(d.email);
    const owned = source === 'sql' ? sqlBackerByToken(db, token, today) : null;
    if (owned) {
      sms = owned.notifySms && isSet(owned.phone);
      email = owned.notifyEmail && isSet(owned.email);
    }
    out.push({
      id: ids.get(token),
      name: feed.name || (typeof rec.name === 'string' && rec.name.trim()) || null,
      stakes: feed.stakes,
      openingCents: feed.openingCents,
      cumulativeCents: feed.cumulativeCents,
      sessions: feed.sessions,
      hours: feed.hours,
      shares: feed.events.slice(0, SHARES_SHOWN).map((e) => ({
        date: e.date, game: e.game, venue: e.venue, hours: e.hours,
        sessionResultCents: e.sessionResultCents, pct: e.pct, shareCents: e.shareCents,
      })),
      played: feed.events.map((e) => [e.game, e.hours, e.sessionResultCents]),
      delivery: { sms, email },
      link: PAGE_LINK_BASE + token,
    });
  }
  const label = (b) => String(b.name || '').toLowerCase();
  out.sort((a, b) => label(a).localeCompare(label(b)) || String(a.id).localeCompare(String(b.id)));
  return out;
}

// ── the weekly digest ────────────────────────────────────────────────────────────────────

/**
 * Who gets the Sunday email. -> [{ token, to, openingCents, via }] where via is 'sql' or 'console'.
 *
 *   console   every live roster record with delivery.email (the dashboard-era rule).
 *   sql       every backers row with a public_token, notify_email on, an address, and an ACTIVE
 *             standing agreement (an ended one sends nothing, §7.7); then the console recipients
 *             whose token no backers row owns. A backers row decides for its own token, so a
 *             backer who turned email off there is not emailed because the old record says so.
 */
function digestRecipients(db, { source = 'console', today = todayET(), index } = {}) {
  const idx = index || consoleIndex(db);
  const out = [];
  const owned = new Set();
  if (source === 'sql' && sqlReady(db)) {
    for (const b of rowsOf(db, 'SELECT public_token FROM backers WHERE public_token IS NOT NULL ORDER BY id')) {
      owned.add(b.public_token);
      let sql = null;
      // One backer's unreadable rows must not stop everyone else's Sunday email (nor the parity run).
      try { sql = sqlBackerByToken(db, b.public_token, today); } catch (err) { console.error('[backers] digest: could not read a backer row:', err && err.message); }
      if (sql && sql.notifyEmail && sql.hasActiveAgreement && String(sql.email || '').trim()) {
        out.push({ token: b.public_token, to: String(sql.email).trim(), openingCents: sql.openingCents, via: 'sql' });
      }
    }
  }
  for (const [token, b] of idx) {
    if (!token || owned.has(token)) continue;
    if (b.delivery && b.delivery.email) {
      out.push({ token, to: b.delivery.email, openingCents: Math.round((Number(b.opening) || 0) * 100), via: 'console' });
    }
  }
  return out;
}

/** The Sunday emails, ready to send: [{ token, to, subject, html }]. A backer with no session this week gets none. */
function weeklyDigests(db, { source = 'console', now = Date.now(), today, index } = {}) {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const out = [];
  for (const r of digestRecipients(db, { source, today, index })) {
    const evs = rowsOf(db,
      'SELECT date, game, venue, hours, session_result_cents, pct, share_cents FROM backer_events WHERE token = ? AND ts >= ? ORDER BY ts DESC',
      [r.token, weekAgo]);
    if (!evs.length) continue; // nothing to report this week
    const cum = backerCumulativeCents(db, r.token) + r.openingCents;
    const weekShare = evs.reduce((a, e) => a + (e.share_cents || 0), 0);
    const rows = evs.map((e) => {
      const col = (e.share_cents || 0) >= 0 ? '#2c7a52' : '#c0544c';
      return `<tr>
          <td style="padding:6px 10px 6px 0;">${escapeHtml(e.game)}</td>
          <td style="padding:6px 10px 6px 0;color:#888;">${escapeHtml(e.venue)} · ${fmtHours(e.hours)} · ${escapeHtml(e.date)}</td>
          <td style="padding:6px 0;text-align:right;font-weight:600;color:${col};">${fmtSignedCents(e.share_cents)}</td>
        </tr>`;
    }).join('');
    const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111;">
        <h2 style="margin:0 0 2px;">Your week with Ethan</h2>
        <p style="color:#888;margin:0 0 16px;">${evs.length} session${evs.length > 1 ? 's' : ''} · your week ${fmtSignedCents(weekShare)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
        <p style="margin:18px 0 4px;font-size:16px;"><strong>Running total: ${fmtSignedCents(cum)}</strong></p>
        <p style="color:#888;font-size:12px;">Full detail anytime: <a href="https://futurega.me/b/${r.token}">your private page</a>.</p>
      </div>`;
    out.push({ token: r.token, to: r.to, subject: 'Your weekly staking digest', html });
  }
  return out;
}

/**
 * Send the Sunday emails, if this process may message a backer. `sendEmail(to, subject, html)` is
 * the caller's (server.js passes sendConsoleEmail). Where delivery is off it sends nothing and
 * says so in the log, which is what keeps the Windows box's weekly cron from emailing anyone.
 * -> { sent } | { skipped: 'delivery-off', sent: 0 }
 */
async function sendWeeklyDigests(db, { env = process.env, source = pageSource(env), sendEmail, now = Date.now(), log = console } = {}) {
  const gate = deliveryDecision(env);
  if (!gate.on) {
    log.log(`[backers] weekly digest not sent - delivery is off here (${gate.why})`);
    return { skipped: 'delivery-off', sent: 0 };
  }
  let sent = 0;
  for (const d of weeklyDigests(db, { source, now })) {
    if (await sendEmail(d.to, d.subject, d.html)) sent++;
  }
  return { sent };
}

// ── the parity route's engine (§7.6) ─────────────────────────────────────────────────────

/** Every token the surface can serve, in a stable order. */
function allTokens(db, index) {
  const set = new Set();
  if (sqlReady(db)) for (const r of rowsOf(db, 'SELECT public_token AS t FROM backers WHERE public_token IS NOT NULL')) set.add(r.t);
  for (const sql of ['SELECT token AS t FROM backer_public', 'SELECT token AS t FROM backer_events', 'SELECT token AS t FROM backer_push_subs']) {
    for (const r of rowsOf(db, sql)) set.add(r.t);
  }
  for (const t of index.keys()) set.add(t);
  return [...set].filter((t) => typeof t === 'string' && BACKER_TOKEN_RE.test(t)).sort();
}

/**
 * The feed (and the digest decision) computed both ways for every token.
 *
 *   -> { tokens, identical, sqlBacked, fallback, differ: [{ backerId, name, fields, detail }],
 *        legacyBackerTokens }
 *
 * `sqlBacked` counts the tokens a backers row owns (the only ones the two paths can disagree on),
 * `fallback` the rest, which the SQL path serves from console_records exactly as the old path does.
 * `fields` names the feed fields that differ (plus 'digest' when the weekly email would go to a
 * different place); `detail` gives both sides of every scalar field. Money and names, never a token
 * and never an address: this is safe to show the owner and to paste into a chat.
 */
function parity(db, { today = todayET() } = {}) {
  const index = consoleIndex(db);
  const tokens = allTokens(db, index);
  const digestTo = (source) => new Map(digestRecipients(db, { source, today, index }).map((r) => [r.token, r.to]));
  const consoleDigest = digestTo('console');
  const sqlDigest = digestTo('sql');
  const SCALARS = ['name', 'stakes', 'openingCents', 'grossCents', 'netSessionCents', 'cumulativeCents', 'sessions', 'hours'];

  const differ = [];
  let identical = 0, sqlBacked = 0;
  for (const token of tokens) {
    const owner = sqlReady(db) ? oneRow(db, 'SELECT id, name FROM backers WHERE public_token = ?', [token]) : null;
    if (owner) sqlBacked++;
    let a, b, error = null;
    try {
      a = buildFeed(db, token, { source: 'console', index, today });
      b = buildFeed(db, token, { source: 'sql', index, today });
    } catch (err) { error = err; }
    const fields = [];
    const detail = {};
    if (error) {
      fields.push('error');
    } else {
      for (const k of [...SCALARS, 'events']) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
          fields.push(k);
          if (k !== 'events') detail[k] = { console: a[k], sql: b[k] };
        }
      }
      const ca = consoleDigest.get(token) || null, sa = sqlDigest.get(token) || null;
      if (ca !== sa) {
        fields.push('digest');
        detail.digest = {
          console: ca ? 'sends' : 'none',
          sql: sa ? (ca ? 'sends to a different address' : 'sends') : 'none',
        };
      }
    }
    if (fields.length) {
      differ.push({ backerId: owner ? owner.id : null, name: owner ? owner.name : (a && a.name) || null, fields, detail });
    } else identical++;
  }
  let legacy = 0;
  if (hasTable(db, 'backer_tokens')) legacy = (oneRow(db, 'SELECT COUNT(*) AS n FROM backer_tokens') || {}).n || 0;
  return { tokens: tokens.length, identical, sqlBacked, fallback: tokens.length - sqlBacked, differ, legacyBackerTokens: legacy };
}

// ── rotation (§7.5) ──────────────────────────────────────────────────────────────────────

/*
 * A backer's token is a CAPABILITY — it is the whole of the authentication on /b/:token — so it has
 * to be rotatable. But it is also the FOREIGN KEY five tables use to find that backer's data:
 *
 *     backer_public           their display name
 *     backer_events           every session they are staked in
 *     backer_push_subs        their push subscriptions
 *     backers.public_token    the merged roster's link
 *     backer_event_revisions  the audit trail of their shares
 *
 * Change the token without moving all of them and the new link resolves a name and a stake and
 * shows ZERO sessions while push stops: worse than the leak, and silent. So all five move together
 * or none of them do (one savepoint, so it also nests inside a caller's transaction).
 */
const TOKEN_COLUMNS = [
  ['backer_public', 'token'],
  ['backer_events', 'token'],
  ['backer_push_subs', 'token'],
  ['backers', 'public_token'],
  ['backer_event_revisions', 'token'],
];
const presentTokenColumns = (db) => TOKEN_COLUMNS.filter(([t, c]) => hasTable(db, t) && hasColumn(db, t, c));

/** Does any table that carries a link already carry this token? */
function tokenInUse(db, token) {
  for (const [t, c] of presentTokenColumns(db)) {
    if (oneRow(db, `SELECT 1 AS x FROM ${t} WHERE ${c} = ? LIMIT 1`, [token])) return true;
  }
  return false;
}

/**
 * Move a backer's page from one token to another. -> { ok: true, counts } | { ok: false, error }.
 * `counts` is the rows moved per table, so a caller can assert on it rather than trust it.
 * A new token that is already in use would MERGE two backers, so it is refused before any write.
 */
function rotateBackerToken(db, oldToken, newToken) {
  if (!BACKER_TOKEN_RE.test(String(oldToken || '')) || !BACKER_TOKEN_RE.test(String(newToken || ''))) {
    return { ok: false, error: 'invalid token shape' };
  }
  if (oldToken === newToken) return { ok: false, error: 'tokens are identical' };
  if (tokenInUse(db, newToken)) return { ok: false, error: 'new token already carries data' };

  const counts = {};
  try {
    db.run('SAVEPOINT backer_rotate');
    for (const [t, c] of presentTokenColumns(db)) {
      db.run(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ?`, [newToken, oldToken]);
      counts[t] = db.getRowsModified();
    }
    db.run('RELEASE backer_rotate');
  } catch (err) {
    try { db.run('ROLLBACK TO backer_rotate'); db.run('RELEASE backer_rotate'); } catch (_) { /* the savepoint may not have landed */ }
    return { ok: false, error: err.message };
  }
  return { ok: true, counts };
}

/**
 * "New link" for one of the player's backers (POST /api/staking/standing/backers/:id/rotate-link):
 * mint a fresh token, move every table, and move the roster record in console_records with it.
 *
 * The roster record matters: it is the fallback the page reads for any token no backers row owns,
 * so a record left on the old token would keep the old link serving a name, stakes and opening
 * after the owner killed it. Its updated_at moves forward so the roster seam's last-write-wins
 * guard rejects the dashboard's older copy instead of rotating the link back. A LATER edit of that
 * backer in the dashboard sends the old token again, though; until the roster seam retires
 * (Phase 13) a leaked link is best rotated in the dashboard, which this app then follows.
 *
 * -> { status: 200, token, counts, rosterRecord: 'updated'|'none' } | { status, error }
 */
function rotateBackerLink(db, { userId, backerId, mint = newToken, now = Date.now() }) {
  if (!sqlReady(db)) return { status: 503, error: 'The merged backer tables are not there yet.' };
  const backer = oneRow(db, 'SELECT id, public_token FROM backers WHERE id = ? AND user_id = ?', [backerId, userId]);
  if (!backer) return { status: 404, error: 'Backer not found' };
  const old = backer.public_token;
  if (!old) return { status: 409, error: 'This backer has no link to replace.' };

  const index = consoleIndex(db);
  let fresh = null;
  for (let i = 0; i < 8 && !fresh; i++) {
    const t = mint();
    if (t !== old && BACKER_TOKEN_RE.test(t) && !index.has(t) && !tokenInUse(db, t)) fresh = t;
  }
  if (!fresh) return { status: 500, error: 'Could not mint an unused link. Try again.' };

  try {
    db.run('SAVEPOINT backer_link');
    const moved = rotateBackerToken(db, old, fresh);
    if (!moved.ok) throw Object.assign(new Error(moved.error), { moved });
    let rosterRecord = 'none';
    for (const r of rowsOf(db, "SELECT id, data, updated_at FROM console_records WHERE store = 'backers' AND deleted = 0")) {
      let b = null;
      try { b = JSON.parse(r.data); } catch (_) { continue; }
      if (!b || b.token !== old) continue;
      b.token = fresh;
      db.run("UPDATE console_records SET data = ?, updated_at = ? WHERE store = 'backers' AND id = ?",
        [JSON.stringify(b), Math.max(now, (Number(r.updated_at) || 0) + 1), r.id]);
      rosterRecord = 'updated';
    }
    db.run('RELEASE backer_link');
    return { status: 200, token: fresh, counts: moved.counts, rosterRecord };
  } catch (err) {
    try { db.run('ROLLBACK TO backer_link'); db.run('RELEASE backer_link'); } catch (_) { /* nothing open */ }
    return { status: 500, error: 'Could not move the link: ' + err.message };
  }
}

// ── the delivery sweep (§6.7, as amended by §1.1 Q1 and Q2) ──────────────────────────────

/** Is posting switched on for any owner (money_settings.posting = 'on')? Nothing sets it before Phase 7. */
function postingOn(db) {
  if (!hasTable(db, 'money_settings')) return false;
  for (const r of rowsOf(db, 'SELECT data FROM money_settings')) {
    try { if (JSON.parse(r.data).posting === 'on') return true; } catch (_) { /* skip malformed */ }
  }
  return false;
}

/** The first-post wording (the notify relay's, kept identical). */
function shareMessages(e, cumulativeCents) {
  const share = fmtSignedCents(e.share_cents);
  return {
    title: `${e.game} — ${share}`,
    body: `${e.venue} · ${fmtHours(e.hours)} · session ${fmtSignedCents(e.session_result_cents)}. `
      + `Your ${e.pct}% = ${share}. Running: ${fmtSignedCents(cumulativeCents)}.`,
    sms: `${e.game} at ${e.venue}: session ${fmtSignedCents(e.session_result_cents)} over ${fmtHours(e.hours)}. `
      + `Your ${e.pct}% = ${share}. Running ${fmtSignedCents(cumulativeCents)}. futurega.me/b/${e.token}`,
  };
}

/**
 * Deliver each posted share once. A share is created by the owner's Notify tap (Q1); the sweep
 * tells the backer about it a couple of minutes later, so a typo fixed right away is never sent.
 * A CORRECTION after delivery sends nothing (Q2): the page simply shows the new figure.
 *
 * It delivers an event only when ALL of these hold:
 *   - delivery is on for this process (deliveryOn: Render, or BACKER_DELIVERY=1);
 *   - posting is on (money_settings.posting);
 *   - source = 'ledger'. The dashboard's events (source 'dashboard', the column's default, which
 *     is what the live notify relay's rows take) were delivered inline by the relay and are never
 *     the sweep's, however their notified_* columns read;
 *   - notified_at IS NULL (never delivered), and COALESCE(revised_at, ts) is at least minAgeMs old.
 *
 * deliver({ event, backer, cumulativeCents, messages }) is the caller's: it pushes, and texts when
 * the backer opted in. The event is marked delivered after deliver returns; if deliver throws it
 * is left for the next sweep.
 * -> { skipped } | { delivered, failed }
 */
async function sweep(db, { now = Date.now(), minAgeMs = 2 * 60 * 1000, env = process.env, deliver, saveDatabase, log = console, limit = 50 } = {}) {
  if (!deliveryOn(env)) return { skipped: 'delivery-off' };
  if (!hasColumn(db, 'backer_events', 'notified_at') || !hasColumn(db, 'backer_events', 'source')) return { skipped: 'schema' };
  if (!postingOn(db)) return { skipped: 'posting-off' };
  const due = rowsOf(db, `SELECT * FROM backer_events
    WHERE source = 'ledger' AND notified_at IS NULL AND COALESCE(revised_at, ts) <= ?
    ORDER BY ts, id LIMIT ?`, [now - minAgeMs, limit]);
  let delivered = 0, failed = 0;
  for (const event of due) {
    const backer = sqlReady(db) ? oneRow(db, 'SELECT id, name, phone, notify_sms FROM backers WHERE public_token = ?', [event.token]) : null;
    const open = backer ? (oneRow(db, 'SELECT COALESCE(SUM(opening_cents), 0) AS c FROM standing_agreements WHERE backer_id = ?', [backer.id]) || {}).c || 0 : 0;
    const cumulativeCents = backerCumulativeCents(db, event.token) + open;
    try {
      await deliver({ event, backer, cumulativeCents, messages: shareMessages(event, cumulativeCents) });
    } catch (err) {
      failed++;
      log.error('[backers] sweep: delivery failed, will retry:', err && err.message);
      continue;
    }
    db.run('UPDATE backer_events SET notified_share_cents = share_cents, notified_at = ? WHERE id = ? AND notified_at IS NULL', [now, event.id]);
    delivered++;
  }
  if (delivered && saveDatabase) await saveDatabase();
  return { delivered, failed };
}

module.exports = {
  BACKER_TOKEN_RE, TZ, todayET,
  deliveryDecision, deliveryOn, pageSource,
  fmtSignedCents, fmtHours, escapeHtml,
  SRV_FMT_LABEL, stakesSummaryServer, stakesSummary,
  consoleIndex, recordByToken, sqlReady, sqlBackerByToken, backerCumulativeCents,
  buildFeed, backersView, PAGE_LINK_BASE, SHARES_SHOWN, digestRecipients, weeklyDigests, sendWeeklyDigests, parity,
  tokenInUse, rotateBackerToken, rotateBackerLink,
  postingOn, shareMessages, sweep,
};
