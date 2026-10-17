'use strict';
/*
 * Standing shares live (docs/bankroll-merge.md §15 row 7; §6.5 to §6.10, §11.4; the owner's answers
 * in §1.1). The Notify tap (./notify.js) creates a share and `follow` keeps it true. This module is
 * everything around that:
 *
 *   the money state     money_settings { posting, cutover, postingSince } per owner, and the one
 *                        switch the cutover flips (PUT /api/bankrolls/money/cutover). The Notify tap
 *                        is refused while posting is 'off'. Unset is treated as ON, because the owner
 *                        asked for the tap before the cutover ("Where it differs", 1).
 *   the Q7 answer       standing_result_answers (token, result) -> 'series' | 'standing' | 'excluded'.
 *                        'series' and 'excluded' keep that backer out of the result's block for good;
 *                        'standing' stops the series flag so the share goes without a confirm.
 *   exclusions          "not staked" for one backer on one result: the answer above, a
 *                        standing_exclusions row per standing agreement (what resultCuts reads), and
 *                        the posted share voided (cause 'exclude'). DELETE undoes the first two.
 *   recalc / remove     a dashboard-era share (source 'dashboard') linked to a result by the import:
 *                        Recalculate turns it into a ledger share at its own recorded pct; Remove
 *                        deletes it. Both keep a revision.
 *   drift               the ledger shares a fresh derivation would change (a feed edit moved a
 *                        buy-in; feeds are not owner writes, so nothing followed). Apply = follow.
 *   agreements          the standing agreements' own routes (§6.10): list, create (a new backer is
 *                        minted a link), update, the stakes editor ("from today" closes the old rows
 *                        the day before and opens new ones; "correct" edits in place and re-derives
 *                        every share it changes, after a preview and a confirm), delivery flags, and
 *                        a backer's recorded shares with their revisions.
 *   preview             the cuts for an UNSAVED result ("Posts to backers: +$248 (20%)").
 *
 * The figures are the engine's (standing.js, classify.js, notify.js). No function here logs or
 * returns a token, an event id or a phone number: a backer is named by `key` (notify.js), a link is
 * shown by its last four characters.
 */
const { hasTable } = require('../money-merge');
const surface = require('../backer-surface');
const notify = require('./notify');
const { resultCuts, shareCents, matchStake, stakesInForce, inWindow, newToken, loadAgreements } = require('./standing');
const { formatOf, STAKE_FORMATS, STAKE_CHANNELS, FORMAT_LABEL, classifyTournament, classifyCash } = require('./classify');

const MIGRATION_NAME = 'standing-live-2026-10';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ANSWERS = ['series', 'standing', 'excluded'];
const isDate = (v) => typeof v === 'string' && DATE_RE.test(v);
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const maskLink = (t) => (typeof t === 'string' && t.length >= 2 ? '••••' + t.slice(t.length >= 8 ? -4 : -2) : null);
const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });

function rowsOf(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const oneRow = (db, sql, params) => rowsOf(db, sql, params)[0] || null;
const lastId = (db) => db.exec('SELECT last_insert_rowid()')[0].values[0][0];

// ── migration ────────────────────────────────────────────────────────────────────────────

/** The one table Phase 7 adds: where the owner's Q7 answer and a per-backer exclusion live. */
function migrate(db) {
  db.run('SAVEPOINT standing_live');
  try {
    db.run(`CREATE TABLE IF NOT EXISTS standing_result_answers (
      token TEXT NOT NULL, ref_table TEXT NOT NULL, ref_id INTEGER NOT NULL,
      answer TEXT NOT NULL,                  -- 'series' | 'standing' | 'excluded'
      created_at TEXT NOT NULL,
      PRIMARY KEY (token, ref_table, ref_id))`);
    db.run('RELEASE standing_live');
  } catch (e) {
    try { db.run('ROLLBACK TO standing_live'); db.run('RELEASE standing_live'); } catch (_) { /* */ }
    throw e;
  }
}

// ── the money state (§11.4) ──────────────────────────────────────────────────────────────

function readSettings(db, uid) {
  if (!hasTable(db, 'money_settings')) return {};
  const r = oneRow(db, 'SELECT data FROM money_settings WHERE user_id = ?', [uid]);
  if (!r) return {};
  try { const d = JSON.parse(r.data); return d && typeof d === 'object' ? d : {}; } catch (_) { return {}; }
}
function writeSettings(db, uid, data, now) {
  db.run(`INSERT INTO money_settings (user_id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, [uid, JSON.stringify(data), now]);
}
/**
 * The posting the dashboard import wrote, cleared (owner, 2026-10-17). The import set posting 'off'
 * on a fresh money state, for a cutover step that would turn it back on; the plain cutover the owner
 * ran ("Phase 11: as built") has no such step, so every Notify tap was refused. A posting 'off' with
 * no postingSince is that write (the owner had no control that could set it), so it goes and the
 * state falls back to unset, which is on. A posting turned on or off since keeps its value. Run once,
 * as a named migration. -> the number of owners cleared.
 */
function clearImportedPostingOff(db) {
  if (!hasTable(db, 'money_settings')) return 0;
  let n = 0;
  for (const r of rowsOf(db, 'SELECT user_id, data FROM money_settings')) {
    let d;
    try { d = JSON.parse(r.data); } catch (_) { continue; }
    if (!d || d.posting !== 'off' || d.postingSince) continue;
    delete d.posting;
    writeSettings(db, r.user_id, d, new Date().toISOString());
    n += 1;
  }
  return n;
}
/**
 * -> { posting: 'on'|'off'|null, cutover: 'none'|'imported'|'live', postingSince, notify }
 * `notify` is whether the Notify tap may record a share: everything but an explicit 'off'.
 */
function moneyState(db, uid) {
  const s = readSettings(db, uid);
  const posting = s.posting === 'on' ? 'on' : s.posting === 'off' ? 'off' : null;
  return {
    posting, cutover: s.cutover === 'imported' || s.cutover === 'live' ? s.cutover : 'none',
    postingSince: isDate(s.postingSince) ? s.postingSince : null,
    notify: posting !== 'off',
  };
}
/** Has any owner reached cutover 'live'? (The roster sync stands down; the feed stops falling back.) */
function cutoverLive(db) {
  if (!hasTable(db, 'money_settings')) return false;
  for (const r of rowsOf(db, 'SELECT data FROM money_settings')) {
    try { if (JSON.parse(r.data).cutover === 'live') return true; } catch (_) { /* */ }
  }
  return false;
}
/**
 * PUT /api/bankrolls/money/cutover: { posting?: 'on'|'off', postingSince?: 'YYYY-MM-DD', cutover?:
 * 'none'|'imported'|'live' }. Turning posting on with a postingSince moves effective_from to it on
 * every standing agreement an import created (bankroll_import_keys ref_table 'standing_agreements');
 * agreements made by hand keep their date. -> { status, body: { state, moved } }
 */
function setCutover(db, uid, body, { now = new Date().toISOString() } = {}) {
  const b = body || {};
  if (b.posting !== undefined && b.posting !== 'on' && b.posting !== 'off') return fail(400, 'posting must be on or off');
  if (b.cutover !== undefined && !['none', 'imported', 'live'].includes(b.cutover)) return fail(400, 'cutover must be none, imported or live');
  if (b.postingSince !== undefined && b.postingSince !== null && !isDate(b.postingSince)) return fail(400, 'postingSince must be YYYY-MM-DD');
  const data = readSettings(db, uid);
  if (b.posting !== undefined) data.posting = b.posting;
  if (b.cutover !== undefined) data.cutover = b.cutover;
  if (b.postingSince !== undefined) { if (b.postingSince === null) delete data.postingSince; else data.postingSince = b.postingSince; }
  let moved = 0;
  db.run('SAVEPOINT money_cutover');
  try {
    if (b.posting === 'on' && isDate(data.postingSince) && hasTable(db, 'bankroll_import_keys') && hasTable(db, 'standing_agreements')) {
      db.run(`UPDATE standing_agreements SET effective_from = ?, updated_at = ? WHERE user_id = ? AND effective_from <> ?
        AND id IN (SELECT ref_id FROM bankroll_import_keys WHERE user_id = ? AND ref_table = 'standing_agreements')`,
      [data.postingSince, now, uid, data.postingSince, uid]);
      moved = db.getRowsModified();
    }
    writeSettings(db, uid, data, now);
    db.run('RELEASE money_cutover');
  } catch (e) {
    try { db.run('ROLLBACK TO money_cutover'); db.run('RELEASE money_cutover'); } catch (_) { /* */ }
    throw e;
  }
  return { status: 200, body: { state: moneyState(db, uid), moved } };
}

// ── the Q7 answer and exclusions ─────────────────────────────────────────────────────────

const { answersFor, setAnswer, clearAnswer } = notify;

/** The staked backer a client named by `key`, or null. */
function backerByKey(db, ownerId, key, source) {
  return notify.stakedBackers(db, ownerId, { source }).find((b) => String(b.key) === String(key)) || null;
}
const ledgerEventFor = (db, token, ref) => oneRow(db, "SELECT * FROM backer_events WHERE token = ? AND ref_table = ? AND ref_id = ? AND source = 'ledger'", [token, ref.table, Number(ref.id)]);

/**
 * Exclude one backer from one result (POST /exclusions), or undo that (DELETE). The result must be
 * the owner's. -> { status, body: the Backers block after }
 */
function exclude(db, { ownerId, ref, key, undo = false, source, rates, now = Date.now() }) {
  const fact = notify.readResult(db, ref);
  if (!fact || Number(fact.userId) !== Number(ownerId)) return fail(404, 'Result not found');
  const b = backerByKey(db, ownerId, key, source);
  if (!b) return fail(404, 'No such backer');
  const nowIso = new Date(now).toISOString();
  db.run('SAVEPOINT standing_exclude');
  try {
    const agreementIds = (b.agreements || []).map((a) => a.id).filter((id) => id != null);
    if (!undo) {
      setAnswer(db, b.token, ref, 'excluded', nowIso);
      for (const id of agreementIds) {
        db.run('INSERT OR IGNORE INTO standing_exclusions (agreement_id, ref_table, ref_id, created_at) VALUES (?, ?, ?, ?)', [id, ref.table, Number(ref.id), nowIso]);
      }
      const ev = ledgerEventFor(db, b.token, ref);
      if (ev) notify.voidEvent(db, ev, now, 'exclude');
    } else {
      clearAnswer(db, b.token, ref);
      for (const id of agreementIds) db.run('DELETE FROM standing_exclusions WHERE agreement_id = ? AND ref_table = ? AND ref_id = ?', [id, ref.table, Number(ref.id)]);
    }
    db.run('RELEASE standing_exclude');
  } catch (e) {
    try { db.run('ROLLBACK TO standing_exclude'); db.run('RELEASE standing_exclude'); } catch (_) { /* */ }
    throw e;
  }
  return notify.preview(db, { ownerId, ref, source, rates });
}

// ── a dashboard-era share: recalc or remove (§6.6) ───────────────────────────────────────

const dashboardEventFor = (db, token, ref) => oneRow(db, "SELECT * FROM backer_events WHERE token = ? AND ref_table = ? AND ref_id = ? AND source = 'dashboard'", [token, ref.table, Number(ref.id)]);

/**
 * Recalculate turns a dashboard share linked to this result into a ledger share at its OWN recorded
 * pct from the result as it is now (a 'recalc' revision, cause 'recalc'); Remove deletes it (a
 * 'void' revision, cause 'owner-remove'). Only a share the import linked (ref_table/ref_id) can be
 * named, and only by the owner. -> { status, body: the Backers block after }
 */
function dashboardShare(db, { ownerId, ref, key, action, source, rates, now = Date.now() }) {
  const fact = notify.readResult(db, ref);
  if (!fact || Number(fact.userId) !== Number(ownerId)) return fail(404, 'Result not found');
  const b = backerByKey(db, ownerId, key, source);
  if (!b) return fail(404, 'No such backer');
  const ev = dashboardEventFor(db, b.token, ref);
  if (!ev) return fail(404, 'This backer has no share from the dashboard on this result');
  if (action === 'remove') {
    notify.voidEvent(db, ev, now, 'owner-remove');
  } else {
    const rate = notify.rateFor(fact.currency, rates);
    const resultCents = notify.toUsdCents(fact.nativeCents, fact.currency, rate);
    const pct = Number(ev.pct);
    const next = { date: fact.date || '', game: fact.game, venue: fact.venue, hours: fact.hours, session_result_cents: resultCents, pct, share_cents: shareCents(resultCents, pct) };
    db.run(`UPDATE backer_events SET source = 'ledger', date = ?, game = ?, venue = ?, hours = ?, session_result_cents = ?, share_cents = ?, revised_at = ? WHERE id = ?`,
      [next.date, next.game, next.venue, next.hours, next.session_result_cents, next.share_cents, now, ev.id]);
    notify.revision(db, ev, { at: now, action: 'recalc', before: ev, after: next, cause: 'recalc', basis: notify.basisOf(fact, rate) });
  }
  return notify.preview(db, { ownerId, ref, source, rates });
}

// ── drift (§6.6) ─────────────────────────────────────────────────────────────────────────

/**
 * Every ledger share of the owner's results that a fresh derivation would change: the result moved
 * under the share without an owner write (a feed re-ingest changed a buy-in). Nothing is applied.
 * -> { lines: [{ refTable, refId, key, name, date, game, action: 'revise'|'void', shareCents,
 *      freshShareCents, resultCents, freshResultCents, pct, freshPct }] }
 */
function drift(db, { ownerId, source, rates }) {
  const refs = rowsOf(db, "SELECT DISTINCT ref_table, ref_id FROM backer_events WHERE source = 'ledger' AND ref_table IS NOT NULL AND ref_id IS NOT NULL ORDER BY ref_table, ref_id");
  const lines = [];
  for (const r of refs) {
    const ref = { table: r.ref_table, id: Number(r.ref_id) };
    const fact = notify.readResult(db, ref);
    if (!fact) continue;                       // gone: that is follow's job at the delete, not drift
    if (Number(fact.userId) !== Number(ownerId)) continue;
    let plan;
    try { plan = notify.planFollow(db, ref, { rates, source }); } catch (_) { continue; } // a rate missing: not listed
    const keys = new Map(notify.stakedBackers(db, ownerId, { source }).map((b) => [b.token, b]));
    for (const c of plan.changes) {
      const b = keys.get(c.ev.token);
      lines.push({
        refTable: ref.table, refId: ref.id, key: b ? b.key : null, name: b ? b.name : null, date: fact.date, game: fact.game,
        action: c.kind, shareCents: c.ev.share_cents, freshShareCents: c.kind === 'void' ? 0 : c.next.share_cents,
        resultCents: c.ev.session_result_cents, freshResultCents: c.kind === 'void' ? null : c.next.session_result_cents,
        pct: Number(c.ev.pct), freshPct: c.kind === 'void' ? null : c.next.pct,
      });
    }
  }
  return { lines };
}
/** Apply the drift on one result: follow it (cause 'drift'). -> { status, body: { revised, voided } } */
function applyDrift(db, { ownerId, ref, source, rates, now = Date.now() }) {
  const fact = notify.readResult(db, ref);
  if (!fact || Number(fact.userId) !== Number(ownerId)) return fail(404, 'Result not found');
  const r = notify.follow(db, ref, { rates, source, now, cause: 'drift' });
  return { status: 200, body: r };
}

// ── the agreements (§6.10) ───────────────────────────────────────────────────────────────

function cleanStakes(list) {
  if (!Array.isArray(list) || !list.length) return { error: 'stakes must be a non-empty list' };
  const out = [];
  const seen = new Set();
  for (const s of list) {
    const format = s && typeof s.format === 'string' ? s.format : '';
    const channel = s && typeof s.channel === 'string' ? s.channel : 'any';
    const pct = Number(s && s.pct);
    if (!STAKE_FORMATS.includes(format)) return { error: `format must be all or a game key, not ${JSON.stringify(format)}` };
    if (!STAKE_CHANNELS.includes(channel)) return { error: 'channel must be any, live or online' };
    if (!(pct > 0 && pct <= 100)) return { error: 'pct must be above 0 and at most 100' };
    const k = `${format}|${channel}`;
    if (seen.has(k)) return { error: `two stakes for ${format} ${channel}` };
    seen.add(k);
    out.push({ format, channel, pct: Math.round(pct * 1000) / 1000 });
  }
  return { stakes: out };
}
const stakeWord = (s) => `${s.pct}% ${s.format === 'all' ? 'everything' : (FORMAT_LABEL[s.format] || s.format)}${s.channel === 'any' ? '' : ' ' + s.channel}`;

function agreementRow(db, uid, id) {
  return oneRow(db, 'SELECT * FROM standing_agreements WHERE id = ? AND user_id = ?', [Number(id), uid]);
}
function backerRow(db, uid, id) {
  return oneRow(db, 'SELECT id, name, email, phone, public_token, notify_sms, notify_email FROM backers WHERE id = ? AND user_id = ?', [Number(id), uid]);
}

/** GET /: the player's standing agreements as the Staking UI lists them. No token, no phone, no address. */
function listAgreements(db, uid, { today = surface.todayET() } = {}) {
  const formats = STAKE_FORMATS.map((k) => ({ key: k, label: k === 'all' ? 'Every game' : FORMAT_LABEL[k] || k }));
  if (!surface.sqlReady(db)) return { agreements: [], formats, channels: STAKE_CHANNELS };
  const list = rowsOf(db, `SELECT a.*, b.name AS backer_name, b.public_token AS token, b.notify_sms, b.notify_email, b.phone, b.email
    FROM standing_agreements a JOIN backers b ON b.id = a.backer_id WHERE a.user_id = ? ORDER BY a.status = 'active' DESC, b.name, a.id`, [uid]);
  const stakes = list.length ? rowsOf(db, `SELECT * FROM standing_stakes WHERE agreement_id IN (${list.map(() => '?').join(',')}) ORDER BY valid_from, id`, list.map((a) => a.id)) : [];
  return {
    formats, channels: STAKE_CHANNELS,
    agreements: list.map((a) => {
      const mine = stakes.filter((s) => s.agreement_id === a.id);
      const active = a.status === 'active' && inWindow(today, a.effective_from || null, a.effective_to || null);
      const shares = oneRow(db, "SELECT COUNT(*) AS n, COALESCE(SUM(share_cents), 0) AS c FROM backer_events WHERE agreement_id = ? AND source = 'ledger'", [a.id]) || { n: 0, c: 0 };
      const paidCents = require('./payouts').paidCentsForAgreement(db, a.id);
      return {
        id: a.id, backer: { id: a.backer_id, key: `b${a.backer_id}`, name: a.backer_name, link: maskLink(a.token), hasLink: !!a.token },
        status: a.status, active, effectiveFrom: a.effective_from, effectiveTo: a.effective_to || null,
        openingCents: Number(a.opening_cents) || 0, openingNote: a.opening_note || null,
        stakes: mine.map((s) => ({ id: s.id, format: s.format, channel: s.channel, pct: Number(s.pct), validFrom: s.valid_from, validTo: s.valid_to || null, inForce: !s.valid_to || s.valid_to >= today })),
        inForce: surface.stakesSummary(stakesInForce(mine, today)),
        sharesCount: shares.n, sharesCents: shares.c, paidCents,
        runningCents: a.token ? surface.backerCumulativeCents(db, a.token) + (Number(a.opening_cents) || 0) : 0,
        delivery: { sms: !!(Number(a.notify_sms) && a.phone), email: !!(Number(a.notify_email) && a.email) },
        createdAt: a.created_at, updatedAt: a.updated_at || null,
      };
    }),
  };
}

/**
 * POST /: { backerId | newBacker: { name, email?, phone? }, effectiveFrom, openingCents?, openingNote?,
 * stakes: [{ format, channel, pct }] }. A new backer is minted a link (newToken); an existing one
 * without a link gets one. One ACTIVE agreement per backer (409). -> { status, body: { id, backerId, link } }
 */
function createAgreement(db, uid, body, { now = new Date().toISOString() } = {}) {
  if (!surface.sqlReady(db)) return fail(503, 'The standing tables are not ready on this server yet.');
  const b = body || {};
  if (!isDate(b.effectiveFrom)) return fail(400, 'effectiveFrom must be YYYY-MM-DD');
  const st = cleanStakes(b.stakes);
  if (st.error) return fail(400, st.error);
  const opening = b.openingCents == null ? 0 : Number(b.openingCents);
  if (!Number.isSafeInteger(opening)) return fail(400, 'openingCents must be a whole number of cents');
  let backer = null;
  let minted = null;
  db.run('SAVEPOINT standing_create');
  try {
    if (b.newBacker && typeof b.newBacker === 'object') {
      const name = clip(b.newBacker.name, 80);
      if (!name) { db.run('RELEASE standing_create'); return fail(400, 'newBacker.name is required'); }
      let token = newToken();
      while (surface.tokenInUse(db, token)) token = newToken();
      db.run('INSERT INTO backers (user_id, name, email, phone, public_token, notify_sms, notify_email) VALUES (?, ?, ?, ?, ?, 0, 0)',
        [uid, name, clip(b.newBacker.email, 120) || null, clip(b.newBacker.phone, 32) || null, token]);
      backer = backerRow(db, uid, lastId(db));
      minted = token;
    } else {
      backer = backerRow(db, uid, b.backerId);
      if (!backer) { db.run('RELEASE standing_create'); return fail(404, 'No such backer'); }
      if (!backer.public_token) {
        let token = newToken();
        while (surface.tokenInUse(db, token)) token = newToken();
        db.run('UPDATE backers SET public_token = ? WHERE id = ?', [token, backer.id]);
        backer.public_token = token; minted = token;
      }
    }
    if (oneRow(db, "SELECT id FROM standing_agreements WHERE user_id = ? AND backer_id = ? AND status = 'active'", [uid, backer.id])) {
      db.run('RELEASE standing_create');
      return fail(409, `${backer.name} already has an active standing agreement. End it first, or edit its stakes.`);
    }
    db.run(`INSERT INTO standing_agreements (user_id, backer_id, effective_from, effective_to, status, opening_cents, opening_note, created_at)
      VALUES (?, ?, ?, NULL, 'active', ?, ?, ?)`, [uid, backer.id, b.effectiveFrom, opening, clip(b.openingNote, 200) || null, now]);
    const id = lastId(db);
    for (const s of st.stakes) {
      db.run('INSERT INTO standing_stakes (agreement_id, format, channel, pct, valid_from, valid_to, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)', [id, s.format, s.channel, s.pct, b.effectiveFrom, now]);
    }
    db.run('RELEASE standing_create');
    return { status: 201, body: { id, backerId: backer.id, link: minted ? `/b/${minted}` : null, linkEnd: maskLink(backer.public_token) } };
  } catch (e) {
    try { db.run('ROLLBACK TO standing_create'); db.run('RELEASE standing_create'); } catch (_) { /* */ }
    throw e;
  }
}

/** PUT /:id: { effectiveTo?, status?, openingCents?, openingNote? }. Ending without a date ends today. */
function updateAgreement(db, uid, id, body, { now = new Date().toISOString(), today = surface.todayET() } = {}) {
  const a = agreementRow(db, uid, id);
  if (!a) return fail(404, 'No such agreement');
  const b = body || {};
  const sets = [], params = [];
  if (b.effectiveTo !== undefined) {
    if (b.effectiveTo !== null && !isDate(b.effectiveTo)) return fail(400, 'effectiveTo must be YYYY-MM-DD or null');
    if (b.effectiveTo && b.effectiveTo < a.effective_from) return fail(400, 'effectiveTo is before effectiveFrom');
    sets.push('effective_to = ?'); params.push(b.effectiveTo);
  }
  if (b.status !== undefined) {
    if (b.status !== 'active' && b.status !== 'ended') return fail(400, 'status must be active or ended');
    if (b.status === 'active' && a.status !== 'active' && oneRow(db, "SELECT id FROM standing_agreements WHERE user_id = ? AND backer_id = ? AND status = 'active' AND id <> ?", [uid, a.backer_id, a.id])) {
      return fail(409, 'This backer already has an active agreement');
    }
    sets.push('status = ?'); params.push(b.status);
    if (b.status === 'ended' && b.effectiveTo === undefined && !a.effective_to) { sets.push('effective_to = ?'); params.push(today); }
  }
  if (b.openingCents !== undefined) {
    if (!Number.isSafeInteger(Number(b.openingCents))) return fail(400, 'openingCents must be a whole number of cents');
    sets.push('opening_cents = ?'); params.push(Number(b.openingCents));
  }
  if (b.openingNote !== undefined) { sets.push('opening_note = ?'); params.push(clip(b.openingNote, 200) || null); }
  if (!sets.length) return fail(400, 'Nothing to change');
  sets.push('updated_at = ?'); params.push(now, a.id);
  db.run(`UPDATE standing_agreements SET ${sets.join(', ')} WHERE id = ?`, params);
  return { status: 200, body: { ok: true, id: a.id } };
}

/** The day before `today` (YYYY-MM-DD), for closing a stake "from today". */
function dayBefore(today) {
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * POST /:id/stakes: { stakes: [...], mode: 'from-today' | 'correct', confirm? }.
 *   from-today  every open stake row is closed the day before today and the new rows open today:
 *               no past share changes (dated stakes).
 *   correct     the open rows are replaced in place (same valid_from), and every ledger share the
 *               agreement has whose pct the new stakes change is re-derived (cause
 *               'stake-correction'). Without confirm: the preview of what would change, nothing
 *               written (status 200, body { preview: true, affected, count, totalDeltaCents }).
 */
function setStakes(db, uid, id, body, { now = Date.now(), today = surface.todayET(), source, rates } = {}) {
  const a = agreementRow(db, uid, id);
  if (!a) return fail(404, 'No such agreement');
  const b = body || {};
  const mode = b.mode === 'correct' ? 'correct' : b.mode === 'from-today' ? 'from-today' : null;
  if (!mode) return fail(400, 'mode must be from-today or correct');
  const st = cleanStakes(b.stakes);
  if (st.error) return fail(400, st.error);
  const nowIso = new Date(now).toISOString();
  const open = rowsOf(db, 'SELECT * FROM standing_stakes WHERE agreement_id = ? AND (valid_to IS NULL OR valid_to >= ?) ORDER BY id', [a.id, today]);
  if (mode === 'from-today') {
    const from = today > a.effective_from ? today : a.effective_from;
    db.run('SAVEPOINT standing_stakes');
    try {
      for (const s of open) {
        if (s.valid_from >= from) db.run('DELETE FROM standing_stakes WHERE id = ?', [s.id]);   // opened today: replaced, not closed
        else db.run('UPDATE standing_stakes SET valid_to = ? WHERE id = ?', [dayBefore(from), s.id]);
      }
      for (const s of st.stakes) db.run('INSERT INTO standing_stakes (agreement_id, format, channel, pct, valid_from, valid_to, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)', [a.id, s.format, s.channel, s.pct, from, nowIso]);
      db.run('UPDATE standing_agreements SET updated_at = ? WHERE id = ?', [nowIso, a.id]);
      db.run('RELEASE standing_stakes');
    } catch (e) {
      try { db.run('ROLLBACK TO standing_stakes'); db.run('RELEASE standing_stakes'); } catch (_) { /* */ }
      throw e;
    }
    return { status: 200, body: { ok: true, mode, from, stakes: st.stakes.map(stakeWord) } };
  }
  // correct: what the new stakes change among this agreement's ledger shares.
  const newRows = st.stakes.map((s, i) => ({ id: -(i + 1), ...s, valid_from: open.length ? open[0].valid_from : a.effective_from, valid_to: null }));
  const events = rowsOf(db, "SELECT * FROM backer_events WHERE agreement_id = ? AND source = 'ledger' ORDER BY date, ts", [a.id]);
  const affected = [];
  for (const ev of events) {
    const fact = notify.readResult(db, { table: ev.ref_table, id: ev.ref_id });
    if (!fact) continue;
    const stake = matchStake(newRows, { date: fact.date, format: fact.format, channel: fact.channel });
    const pct = stake ? Number(stake.pct) : null;
    const share = pct == null ? 0 : shareCents(ev.session_result_cents, pct);
    if (pct === Number(ev.pct) && share === ev.share_cents) continue;
    affected.push({ refTable: ev.ref_table, refId: ev.ref_id, date: ev.date, game: ev.game, pctBefore: Number(ev.pct), pctAfter: pct, shareBefore: ev.share_cents, shareAfter: share, ev, stakeIndex: stake ? -stake.id - 1 : null });
  }
  const totalDeltaCents = affected.reduce((s, x) => s + (x.shareAfter - x.shareBefore), 0);
  const pub = affected.map(({ ev, stakeIndex, ...x }) => x);
  if (b.confirm !== true) return { status: 200, body: { preview: true, mode, affected: pub, count: pub.length, totalDeltaCents, stakes: st.stakes.map(stakeWord) } };
  db.run('SAVEPOINT standing_stakes');
  try {
    const from = open.length ? open[0].valid_from : a.effective_from;
    for (const s of open) db.run('DELETE FROM standing_stakes WHERE id = ?', [s.id]);
    const ids = [];
    for (const s of st.stakes) {
      db.run('INSERT INTO standing_stakes (agreement_id, format, channel, pct, valid_from, valid_to, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)', [a.id, s.format, s.channel, s.pct, from, nowIso]);
      ids.push(lastId(db));
    }
    for (const x of affected) {
      const ev = x.ev;
      if (x.pctAfter == null) { notify.voidEvent(db, ev, now, 'stake-correction'); continue; }
      const next = { date: ev.date, game: ev.game, venue: ev.venue, hours: ev.hours, session_result_cents: ev.session_result_cents, pct: x.pctAfter, share_cents: x.shareAfter };
      db.run('UPDATE backer_events SET pct = ?, share_cents = ?, stake_id = ?, revised_at = ? WHERE id = ?', [x.pctAfter, x.shareAfter, ids[x.stakeIndex] == null ? null : ids[x.stakeIndex], now, ev.id]);
      notify.revision(db, ev, { at: now, action: 'revise', before: ev, after: next, cause: 'stake-correction' });
    }
    db.run('UPDATE standing_agreements SET updated_at = ? WHERE id = ?', [nowIso, a.id]);
    db.run('RELEASE standing_stakes');
  } catch (e) {
    try { db.run('ROLLBACK TO standing_stakes'); db.run('RELEASE standing_stakes'); } catch (_) { /* */ }
    throw e;
  }
  return { status: 200, body: { ok: true, mode, affected: pub, count: pub.length, totalDeltaCents, stakes: st.stakes.map(stakeWord) } };
}

/** PUT /backers/:backerId/delivery: { sms?: phone | null, email?: address | null } sets notify_* and the value. */
function setDelivery(db, uid, backerId, body) {
  const b = backerRow(db, uid, backerId);
  if (!b) return fail(404, 'No such backer');
  const o = body || {};
  const sets = [], params = [];
  if (o.sms !== undefined) {
    const v = o.sms === null || o.sms === false ? null : clip(o.sms, 32);
    if (v !== null && !/^\+?[0-9][0-9 ()-]{5,}$/.test(v)) return fail(400, 'sms must be a phone number or null');
    sets.push('phone = COALESCE(?, phone)', 'notify_sms = ?'); params.push(v, v ? 1 : 0);
  }
  if (o.email !== undefined) {
    const v = o.email === null || o.email === false ? null : clip(o.email, 120);
    if (v !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return fail(400, 'email must be an address or null');
    sets.push('email = COALESCE(?, email)', 'notify_email = ?'); params.push(v, v ? 1 : 0);
  }
  if (!sets.length) return fail(400, 'Nothing to change');
  params.push(b.id);
  db.run(`UPDATE backers SET ${sets.join(', ')} WHERE id = ?`, params);
  const after = backerRow(db, uid, b.id);
  return { status: 200, body: { ok: true, delivery: { sms: !!(Number(after.notify_sms) && after.phone), email: !!(Number(after.notify_email) && after.email) } } };
}

/**
 * GET /:id/events?source=ledger|dashboard&since=YYYY-MM-DD: the backer's recorded shares (the
 * agreement's ledger shares, and the dashboard-era ones on the same link), each with its revisions.
 * No event id, no token.
 */
function agreementEvents(db, uid, id, { source = null, since = null } = {}) {
  const a = agreementRow(db, uid, id);
  if (!a) return fail(404, 'No such agreement');
  const b = backerRow(db, uid, a.backer_id);
  const token = b && b.public_token;
  const where = ['(e.agreement_id = ?' + (token ? ' OR (e.token = ? AND e.source = \'dashboard\')' : '') + ')'];
  const params = token ? [a.id, token] : [a.id];
  if (source === 'ledger' || source === 'dashboard') { where.push('e.source = ?'); params.push(source); }
  if (isDate(since)) { where.push('e.date >= ?'); params.push(since); }
  const events = rowsOf(db, `SELECT e.* FROM backer_events e WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.ts DESC LIMIT 500`, params);
  const ids = events.map((e) => e.id);
  const revs = ids.length ? rowsOf(db, `SELECT * FROM backer_event_revisions WHERE event_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids) : [];
  return {
    status: 200,
    body: {
      agreementId: a.id, backer: { id: a.backer_id, key: `b${a.backer_id}`, name: b ? b.name : null },
      events: events.map((e) => ({
        refTable: e.ref_table || null, refId: e.ref_id || null, source: e.source || 'dashboard',
        date: e.date, game: e.game, venue: e.venue, hours: e.hours, resultCents: e.session_result_cents, pct: Number(e.pct), shareCents: e.share_cents,
        sentShareCents: e.notified_share_cents, sentAt: e.notified_at, revisedAt: e.revised_at || null,
        revisions: revs.filter((r) => r.event_id === e.id).map((r) => ({ at: r.at, action: r.action, cause: r.cause, shareBefore: r.share_before, shareAfter: r.share_after, pctBefore: r.pct_before, pctAfter: r.pct_after })),
      })),
    },
  };
}

// ── the preview for an unsaved result (§6.5) ─────────────────────────────────────────────

const fmtSigned = (c) => (c < 0 ? '−' : '+') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
/**
 * GET /preview?kind=tournament|cash&date=&game=&online=0|1&resultCents=&tournamentId=: who would be
 * cut and how much, for figures not saved yet. -> { backers: [{ key, name, pct, shareCents, ask }], line }
 */
function previewUnsaved(db, { ownerId, query, source, rates }) {
  const q = query || {};
  const kind = q.kind === 'cash' ? 'cash' : 'tournament';
  const nativeCents = Math.round(Number(q.resultCents));
  if (!Number.isFinite(nativeCents)) return fail(400, 'resultCents must be a number');
  const currency = typeof q.currency === 'string' && /^[A-Z]{3}$/.test(q.currency) ? q.currency : 'USD';
  const rate = notify.rateFor(currency, rates);
  const resultCents = notify.toUsdCents(nativeCents, currency, rate);
  const date = isDate(q.date) ? q.date : surface.todayET();
  const online = q.online === '1' || q.online === 'true';
  const derived = kind === 'cash' ? classifyCash({ game: q.game, room: q.room }) : classifyTournament({ game_variant: q.game, is_online: online ? 1 : 0 });
  const format = typeof q.format === 'string' && STAKE_FORMATS.includes(q.format) ? q.format : derived.format;
  const tournamentId = q.tournamentId != null && Number.isSafeInteger(Number(q.tournamentId)) ? Number(q.tournamentId) : null;
  const overlap = kind === 'tournament' && tournamentId ? notify.seriesOverlap(db, ownerId, tournamentId) : null;
  const result = { table: kind === 'cash' ? 'cash_sessions' : 'tracking_entries', id: 0, kind, date, format, channel: kind === 'cash' ? derived.channel : (online ? 'online' : 'live'), resultCents, ended: true };
  const backers = [];
  for (const b of notify.stakedBackers(db, ownerId, { source })) {
    const { cuts } = resultCuts({ agreements: b.agreements, result, seriesBackerIds: overlap ? overlap.ids : [] });
    if (!cuts.length) continue;
    const c = cuts[0];
    const ask = !!overlap && (overlap.byName.has(String(b.name || '').trim().toLowerCase()) || (b.backerId != null && overlap.byId.has(b.backerId)));
    backers.push({ key: b.key, name: b.name, pct: c.pct, shareCents: c.shareCents, ask });
  }
  backers.sort((x, y) => Math.abs(y.shareCents) - Math.abs(x.shareCents));
  const line = backers.length ? `Posts to backers: ${backers.map((x) => `${fmtSigned(x.shareCents)} (${x.pct}%)`).join(', ')}` : 'Posts to no backers';
  return { status: 200, body: { backers, line, format, channel: result.channel, currency, rate, resultCents } };
}

module.exports = {
  MIGRATION_NAME, migrate, ANSWERS,
  readSettings, moneyState, cutoverLive, setCutover, clearImportedPostingOff,
  answersFor, setAnswer, clearAnswer, exclude, dashboardShare, drift, applyDrift,
  listAgreements, createAgreement, updateAgreement, setStakes, setDelivery, agreementEvents, previewUnsaved,
  maskLink, dayBefore,
};
