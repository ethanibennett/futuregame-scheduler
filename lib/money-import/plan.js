'use strict';
/*
 * The import's PLAN (docs/bankroll-merge.md §5, §7.1, §9): a staged pull, read against this
 * database, becomes the list of what a commit would write and what the owner has to answer first.
 * It reads only; the reconciliation's "after" figures come from a commit run inside a savepoint and
 * rolled back (apply.simulate), so the figure shown is the figure a commit produces.
 *
 *   buildPlan(db, uid, { run, base, decisions, rates, sources, journals, now })
 *     run        { id, payload (the verified export), mode, since, cursor, sourceHash }
 *     base       the last committed, not undone, run's dashboard state (null for a first import)
 *     decisions  the owner's answers so far (normaliseDecisions)
 *     journals   every committed, not undone, run's journal (for "edited here since the import")
 *   -> { plan, internal }   `plan` is JSON for the owner (no token, phone or email: masked tokens and
 *                           booleans only) and carries planHash; `internal` is what apply.js writes.
 *
 * Statuses, per dashboard record:
 *   new        no key: written, unless it is in a pair
 *   reimport   a key whose row was deleted here since: imports again (the CSV importer's rule)
 *   unchanged  a key, its row alive, the same source hash: nothing (a delta's 14-day margin re-sends
 *              rows already imported; this is where they cost nothing)
 *   changed    a key, its row alive, a different source hash: "Changed in the dashboard"
 *   deleted    a tombstone for a record a key points at: "Deleted in the dashboard"
 *   error      fails validation: skipped and listed
 *   skipped    deliberately not written ($0 adjustment): listed
 */
const crypto = require('crypto');
const M = require('./map');
const S = require('./score');
const { effectOf } = require('./dashboard-bankroll');
const R = require('./reconcile');
const Jn = require('./journal');
const { refExists } = require('../bankroll-import');
const { normaliseDate, nativeCurrency } = require('../analytics');
const { shareCents } = require('../staking/standing');
const { stakesSummary } = require('../backer-surface');
const { ONLINE_ROOM } = require('../staking/classify');

const PLAN_VERSION = 1;
const FUND = { name: 'WSOP fund', target: 65000, targetDate: '2027-05-03' }; // §17 Q5
const PAIR_ANSWERS = ['same-keep', 'same-take', 'different'];
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function rowsOf(db, sql, params = []) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const oneOf = (db, sql, params) => rowsOf(db, sql, params)[0] || null;
const hasTable = (db, t) => !!oneOf(db, "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", [t]);
const seriesFp = (event) => 'dash:wsop-staking-series:' + M.sha1(event.toLowerCase()).slice(0, 16);
const slateBackerFp = (name) => 'dash:wsop-staking-backer:' + M.sha1(String(name || '').toLowerCase()).slice(0, 16);
// A §7.1 kind-3 backer has no dashboard id, only its link. Its fingerprint is a KEYED hash of the
// token (HMAC with the server's own secret): stable on this database, and not a hash anyone holding a
// plan could brute-force back into the link (an 8-character token is a small space for plain sha1).
const tokenFp = (token) => 'dash:backer-token:' + crypto.createHmac('sha256', String(process.env.JWT_SECRET || 'money-import')).update(String(token)).digest('hex').slice(0, 16);
const standingFpOf = (fp) => fp.startsWith('dash:backers:') ? 'dash:standing:' + fp.slice('dash:backers:'.length) : 'dash:standing-token:' + fp.slice('dash:backer-token:'.length);

// ── decisions ────────────────────────────────────────────────────────────────────────────

function normaliseDecisions(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : {});
  return {
    pairs: obj(d.pairs), backers: obj(d.backers), slate: obj(d.slate), changes: obj(d.changes), deletions: obj(d.deletions),
    opening: d.opening && typeof d.opening === 'object' ? { amount: d.opening.amount, date: d.opening.date } : null,
    target: d.target == null ? 'main' : d.target,
  };
}

// ── keys and rows here ───────────────────────────────────────────────────────────────────

/** Every import key of the dashboard's (dash:* and chat-*): by fingerprint and by the row it names. */
function loadKeys(db, uid) {
  const byFp = new Map(), byRef = new Map();
  for (const k of rowsOf(db, 'SELECT * FROM bankroll_import_keys WHERE user_id = ?', [uid])) {
    if (!R.isDashFp(k.fingerprint)) continue;
    byFp.set(k.fingerprint, k);
    byRef.set(`${k.ref_table}:${k.ref_id}`, k);
  }
  return { byFp, byRef };
}
function refAlive(db, uid, key) {
  if (!key) return false;
  if (key.ref_table === 'staking_series') return !!oneOf(db, 'SELECT id FROM staking_series WHERE id = ? AND user_id = ?', [key.ref_id, uid]);
  if (key.ref_table === 'money_settings') return !!oneOf(db, 'SELECT user_id FROM money_settings WHERE user_id = ?', [uid]);
  return refExists(db, uid, key.ref_table, key.ref_id);
}
/** The rows one record put here, from its key: [[table, pk]]. */
function recordRows(db, uid, key) {
  const t = key.ref_table, id = key.ref_id;
  const out = [];
  if (t === 'tracking_entries') {
    const e = oneOf(db, 'SELECT id, tournament_id FROM tracking_entries WHERE id = ? AND user_id = ?', [id, uid]);
    if (e) { out.push(['tracking_entries', { id }]); out.push(['tournaments', { id: e.tournament_id }]); }
    out.push(['session_extras', { ref_table: t, ref_id: id }]);
  } else if (t === 'cash_sessions') {
    out.push(['cash_sessions', { id }], ['session_extras', { ref_table: t, ref_id: id }]);
  } else if (t === 'bankroll_adjustments') {
    out.push(['bankroll_adjustments', { id }]);
    const a = oneOf(db, 'SELECT transfer_id FROM bankroll_adjustments WHERE id = ? AND user_id = ?', [id, uid]);
    if (a && a.transfer_id) for (const l of rowsOf(db, 'SELECT id FROM bankroll_adjustments WHERE user_id = ? AND transfer_id = ? AND id <> ?', [uid, a.transfer_id, id])) out.push(['bankroll_adjustments', { id: l.id }]);
  } else out.push([t, { id }]);
  return out;
}
function editedSince(db, uid, key, after) {
  for (const [t, pk] of recordRows(db, uid, key)) {
    const h = after.get(Jn.keyOf(t, pk));
    if (!h) continue;
    const row = Jn.selectRow(db, t, pk);
    if (row && Jn.hashRow(row) !== h) return true;
  }
  return false;
}

/** Owner rows here that no dashboard key names: the other side of the duplicate review (§9.1). */
function hereRows(db, uid, keys) {
  const linked = (t, id) => keys.byRef.has(`${t}:${id}`);
  const hoursOf = (a, b) => { const ms = Date.parse(b) - Date.parse(a); return Number.isFinite(ms) && ms > 0 ? ms / 3600e3 : null; };
  const extrasHours = new Map();
  if (hasTable(db, 'session_extras')) for (const x of rowsOf(db, "SELECT ref_id, hours FROM session_extras WHERE user_id = ? AND ref_table = 'tracking_entries'", [uid])) extrasHours.set(x.ref_id, x.hours);
  const cash = hasTable(db, 'cash_sessions') ? rowsOf(db, `SELECT id, session_date, room, game, stakes, buy_in, cash_out, tips, expenses, started_at, ended_at, bankroll_id, currency
      FROM cash_sessions WHERE user_id = ? AND ended_at IS NOT NULL`, [uid])
    .filter((r) => !linked('cash_sessions', r.id) && (r.currency || 'USD') === 'USD')
    .map((r) => ({
      table: 'cash_sessions', id: r.id, date: r.session_date, room: r.room, game: [r.stakes, r.game].filter(Boolean).join(' '),
      in: r.buy_in, out: r.cash_out, result: (r.cash_out || 0) - (r.buy_in || 0) - (r.tips || 0) - (r.expenses || 0),
      hours: hoursOf(r.started_at, r.ended_at), bankrollId: r.bankroll_id,
    })) : [];
  const mtt = rowsOf(db, `SELECT te.id, te.num_entries, te.cashed, te.cash_amount, te.bankroll_id, te.created_at,
      t.id AS tournament_id, t.date, t.event_name, t.buyin, t.venue, t.property, t.site, t.uploaded_by
      FROM tracking_entries te JOIN tournaments t ON t.id = te.tournament_id WHERE te.user_id = ?`, [uid])
    .filter((r) => !linked('tracking_entries', r.id) && nativeCurrency(r.venue) === 'USD')
    .map((r) => {
      const units = Math.max(1, Number(r.num_entries) || 1);
      const cashAmt = Number(r.cashed) ? Math.max(0, Number(r.cash_amount) || 0) : 0;
      const buyin = Math.max(0, Number(r.buyin) || 0);
      return {
        table: 'tracking_entries', id: r.id, tournamentId: r.tournament_id, date: normaliseDate(r.date) || normaliseDate(String(r.created_at || '').slice(0, 10)),
        room: r.property || r.site || (r.venue === 'Personal' ? '' : r.venue), property: r.property, site: r.site, venue: r.venue,
        game: r.event_name, in: buyin * units, out: cashAmt, result: cashAmt - buyin * units, buyinPerEntry: buyin, entries: units,
        hours: extrasHours.has(r.id) ? extrasHours.get(r.id) : null, bankrollId: r.bankroll_id,
        personal: r.venue === 'Personal' && Number(r.uploaded_by) === uid,
      };
    });
  const adj = rowsOf(db, `SELECT a.id, a.kind, a.amount, a.occurred_on, a.bankroll_id, a.note, COALESCE(b.currency, 'USD') AS currency
      FROM bankroll_adjustments a LEFT JOIN bankrolls b ON b.id = a.bankroll_id
      WHERE a.user_id = ? AND a.kind IN ('deposit', 'withdrawal') AND a.transfer_id IS NULL`, [uid])
    .filter((r) => !linked('bankroll_adjustments', r.id) && r.currency === 'USD')
    .map((r) => ({ table: 'bankroll_adjustments', id: r.id, date: r.occurred_on, kind: r.kind, amount: r.amount, note: r.note, bankrollId: r.bankroll_id }));
  const exp = hasTable(db, 'bankroll_transactions') ? rowsOf(db, `SELECT id, category, amount, occurred_on, currency, note, bankroll_id
      FROM bankroll_transactions WHERE user_id = ? AND kind = 'expense'`, [uid])
    .filter((r) => !linked('bankroll_transactions', r.id) && (r.currency || 'USD') === 'USD')
    .map((r) => ({ table: 'bankroll_transactions', id: r.id, date: r.occurred_on, category: r.category, amount: Number(r.amount), note: r.note, bankrollId: r.bankroll_id })) : [];
  return { cash, mtt, adj, exp };
}

// ── the build ────────────────────────────────────────────────────────────────────────────

function parseRecords(body) {
  const out = { sessions: [], adjustments: [], expenses: [], backers: [], settings: [] };
  for (const r of body.records || []) {
    let data = null, parseError = false;
    if (!r.deleted && typeof r.data === 'string') { try { data = JSON.parse(r.data); } catch (_) { parseError = true; } }
    out[r.store].push({ store: r.store, id: r.id, fp: M.fingerprintOf(r.store, r.id), hash: M.sourceHashOf(r.deleted ? null : r.data), updatedAt: r.updatedAt, deleted: !!r.deleted, data, parseError });
  }
  return out;
}
const blobOf = (body, key) => {
  const b = body.local && body.local[key];
  if (!b) return { present: false };
  if (b.deleted || b.invalid) return { present: true, value: null, updatedAt: b.updatedAt, deleted: !!b.deleted, invalid: !!b.invalid };
  return { present: true, value: b.value, updatedAt: b.updatedAt };
};

/** The merged dashboard state: the base, then this pull on top (a full pull replaces the records). */
function mergeState(base, body, recs, mode) {
  const st = { startingRoll: 0, settingsHash: null, openingDate: base ? base.openingDate || null : null, records: {} };
  if (base && mode === 'delta') { st.startingRoll = base.startingRoll || 0; st.settingsHash = base.settingsHash || null; Object.assign(st.records, JSON.parse(JSON.stringify(base.records || {}))); }
  const carried = base ? base.records || {} : {};
  const settings = recs.settings.find((r) => !r.deleted && r.data);
  if (settings) { st.startingRoll = Number(settings.data.startingRoll) || 0; st.settingsHash = settings.hash; }
  // Expenses are in the state too, with no effect: the dashboard's roll never read them, and a
  // confirmed duplicate of one is then a pair line (the row here lowers this roll), not an orphan.
  for (const store of ['sessions', 'adjustments', 'expenses']) {
    for (const r of recs[store]) {
      if (r.deleted) { delete st.records[r.fp]; continue; }
      const eff = store === 'expenses' ? (r.data ? { roll: 0, fund: 0 } : null) : effectOf(store, r.data);
      if (!eff) continue;
      const d = r.data ? M.dayOf(r.data.date) : null;
      const prev = carried[r.fp] || {};
      st.records[r.fp] = {
        store, id: r.id, date: d ? d.day : null, roll: eff.roll, fund: eff.fund, hash: r.hash,
        label: store === 'sessions' ? String((r.data && (r.data.gameLabel || r.data.venue)) || 'Session') : store === 'expenses' ? `Expense · ${String((r.data && r.data.category) || '')}` : String((r.data && r.data.type) || 'Adjustment'),
        // carried from the base until nextState() decides for this build
        link: prev.link || null, rRoll: prev.rRoll, rFund: prev.rFund,
      };
    }
  }
  return st;
}

/**
 * The plan. See the header. Synchronous: everything it needs (rates) is passed in.
 */
function buildPlan(db, uid, o) {
  const body = o.run.payload;
  const dec = normaliseDecisions(o.decisions);
  const mode = o.run.mode === 'delta' ? 'delta' : 'full';
  const keys = loadKeys(db, uid);
  const after = Jn.afterIndex(o.journals || []);
  const recs = parseRecords(body);
  const state = mergeState(o.base || null, body, recs, mode);
  const ctx = { uid };
  const items = [];
  const errors = [];
  const flags = { signs: [], otherExpenses: { count: 0, total: 0, items: [] }, onlineRoomsUnknown: [], rows: [] };
  const blocking = [];

  const statusOf = (r) => {
    const key = keys.byFp.get(r.fp) || null;
    const alive = refAlive(db, uid, key);
    return { key, alive };
  };

  // ── sessions, adjustments, expenses ──
  const mapper = { sessions: (r) => M.mapSession(r.id, r.data, ctx), adjustments: (r) => M.mapAdjustment(r.id, r.data), expenses: (r) => M.mapExpense(r.id, r.data) };
  const onlineSeen = new Set();
  for (const store of ['sessions', 'adjustments', 'expenses']) {
    for (const r of recs[store]) {
      const { key, alive } = statusOf(r);
      const base = { fp: r.fp, store, id: r.id, hash: r.hash, updatedAt: r.updatedAt, key };
      if (r.deleted) {
        if (key && alive && key.source_hash !== 'deleted') { // 'deleted': answered on an earlier pull
          const conflict = key.decision === 'imported' && editedSince(db, uid, key, after);
          items.push({ ...base, status: 'deleted', deletion: { conflict, same: key.decision !== 'imported', default: key.decision !== 'imported' || conflict ? 'keep' : 'remove', options: key.decision === 'imported' ? ['remove', 'keep'] : ['keep'] } });
        }
        continue;
      }
      const mapped = r.parseError ? { ok: false, error: 'unreadable data' } : mapper[store](r);
      if (!mapped.ok) {
        const it = { ...base, status: mapped.skipped ? 'skipped' : 'error', error: mapped.error, date: mapped.date || null, kindGuess: store };
        items.push(it);
        errors.push({ fp: r.fp, store, id: r.id, date: mapped.date || null, error: mapped.error, skipped: !!mapped.skipped });
        continue;
      }
      // §6.3: an online room the classifier's pattern does not know (a cash session's channel is
      // derived from its room once the explicit one is gone). Listed, so the pattern can learn it.
      if (store === 'sessions' && r.data.channel === 'online' && r.data.venue && !ONLINE_ROOM.test(String(r.data.venue))) onlineSeen.add(String(r.data.venue));
      for (const f of mapped.flags || []) flags.rows.push({ fp: r.fp, store, id: r.id, flag: f });
      if (store === 'adjustments' && mapped.flags.some((f) => /— the dashboard/.test(f))) flags.signs.push({ fp: r.fp, id: r.id, date: mapped.date, amount: mapped.view.amount, type: mapped.view.type, note: mapped.flags.find((f) => /— the dashboard/.test(f)) });
      if (store === 'expenses' && mapped.rows.bankroll_transactions.category === 'other') {
        flags.otherExpenses.count++; flags.otherExpenses.total = r2(flags.otherExpenses.total + mapped.rows.bankroll_transactions.amount);
        flags.otherExpenses.items.push({ fp: r.fp, id: r.id, date: mapped.date, amount: mapped.rows.bankroll_transactions.amount, note: mapped.view.note });
      }
      let status;
      if (key && alive) {
        if (key.source_hash === r.hash) status = 'unchanged';
        else status = 'changed';
      } else status = key ? 'reimport' : 'new';
      const it = { ...base, status, mapped, date: mapped.date };
      if (status === 'changed') {
        const table = store === 'sessions' ? (mapped.kind === 'cash' ? 'cash_sessions' : 'tracking_entries') : store === 'adjustments' ? 'bankroll_adjustments' : 'bankroll_transactions';
        let applicable = key.decision === 'imported' && key.ref_table === table;
        let why = null;
        if (key.decision !== 'imported') why = 'this record was matched to a row of yours as the same night; your row stays as it is';
        else if (key.ref_table !== table) why = 'it changed between cash and tournament in the dashboard; delete it here first to take the new one';
        if (applicable && store === 'adjustments') {
          const legs = recordRows(db, uid, key).length;
          if (legs !== mapped.legs.length) { applicable = false; why = 'it changed between a transfer and a single entry in the dashboard'; }
        }
        const conflict = applicable && editedSince(db, uid, key, after);
        it.change = { conflict, applicable, why, default: applicable && !conflict ? 'apply' : 'keep', options: applicable ? ['apply', 'keep'] : ['keep'] };
      }
      if (status === 'reimport' && store === 'sessions' && mapped.kind === 'tournament') {
        const t = oneOf(db, 'SELECT id, venue, uploaded_by FROM tournaments WHERE stable_id = ?', [mapped.rows.tournaments.stable_id]);
        if (t && (t.venue !== 'Personal' || Number(t.uploaded_by) !== uid || oneOf(db, 'SELECT id FROM tracking_entries WHERE tournament_id = ? AND user_id = ?', [t.id, uid]))) {
          it.status = 'error'; it.error = 'its Personal event is already here with a result'; errors.push({ fp: r.fp, store, id: r.id, date: mapped.date, error: it.error });
        }
      }
      items.push(it);
    }
  }
  flags.onlineRoomsUnknown = [...onlineSeen].sort();

  // ── the duplicate review (§9.1) ──
  const here = hereRows(db, uid, keys);
  const byDay = (list, span) => {
    const m = new Map();
    for (const h of list) { if (!h.date) continue; (m.get(h.date) || m.set(h.date, []).get(h.date)).push(h); }
    return (date) => {
      const out = [];
      const t = Date.parse(date + 'T00:00:00Z');
      for (let k = -span; k <= span; k++) out.push(...(m.get(new Date(t + k * 864e5).toISOString().slice(0, 10)) || []));
      return out;
    };
  };
  const nearCash = byDay(here.cash, 1), nearMtt = byDay(here.mtt, 1), nearAdj = byDay(here.adj, 3), nearExp = byDay(here.exp, 0);
  const cands = [];
  const writable = items.filter((i) => i.status === 'new' || i.status === 'reimport');
  for (const it of writable) {
    const m = it.mapped;
    if (it.store === 'sessions' && m.kind === 'cash') {
      for (const h of nearCash(m.date)) { const s = S.scoreCash(m.view, h); if (s) cands.push({ dashKey: it.fp, hereKey: `cash_sessions:${h.id}`, kind: 'cash', h, it, ...s }); }
    } else if (it.store === 'sessions') {
      for (const h of nearMtt(m.date)) { const s = S.scoreTournament(m.view, h); if (s) cands.push({ dashKey: it.fp, hereKey: `tracking_entries:${h.id}`, kind: 'tournament', h, it, ...s }); }
    } else if (it.store === 'adjustments' && (m.kind === 'deposit' || m.kind === 'withdrawal')) {
      const dv = { kind: m.kind, date: m.date, amount: m.legs[0].amount };
      for (const h of nearAdj(m.date)) { const s = S.scoreAdjustment(dv, h); if (s) cands.push({ dashKey: it.fp, hereKey: `bankroll_adjustments:${h.id}`, kind: m.kind, h, it, ...s }); }
    } else if (it.store === 'expenses') {
      const tx = m.rows.bankroll_transactions;
      const dv = { date: m.date, amount: tx.amount, category: tx.category };
      for (const h of nearExp(m.date)) { const s = S.scoreExpense(dv, h); if (s) cands.push({ dashKey: it.fp, hereKey: `bankroll_transactions:${h.id}`, kind: 'expense', h, it, ...s }); }
    }
  }
  const pairs = S.pairUp(cands).map((c) => {
    const id = 'pair:' + c.it.fp;
    c.it.pairId = id;
    const dv = c.it.mapped.view;
    const h = c.h;
    let dash, hv, netsDiffer, canTake = true, takeWhy = null;
    if (c.kind === 'cash' || c.kind === 'tournament') {
      dash = { date: dv.date, room: dv.room, game: dv.game, in: r2(dv.in), out: r2(dv.out), result: r2(dv.result), hours: dv.hours == null ? null : dv.hours };
      hv = { date: h.date, room: h.room, game: h.game, in: h.in, out: h.out, result: h.result, hours: h.hours == null ? null : r2(h.hours) };
      netsDiffer = Math.abs(dash.result - hv.result) > 0.005;
      if (c.kind === 'tournament' && !h.personal && Math.abs(c.it.mapped.rows.tournaments.buyin - h.buyinPerEntry) > 0.005) {
        canTake = false; takeWhy = 'this is a schedule event; its buy-in is the event\'s, not this result\'s';
      }
    } else if (c.kind === 'expense') {
      const tx = c.it.mapped.rows.bankroll_transactions;
      dash = { date: dv.date, category: tx.category, amount: tx.amount, note: dv.note || null };
      hv = { date: h.date, category: h.category, amount: h.amount, note: h.note || null };
      netsDiffer = Math.round(dash.amount * 100) !== Math.round(hv.amount * 100);
    } else {
      dash = { date: dv.date, kind: c.kind, amount: c.it.mapped.legs[0].amount, note: dv.note || null };
      hv = { date: h.date, kind: h.kind, amount: h.amount, note: h.note || null };
      netsDiffer = dash.amount !== hv.amount;
    }
    const same = {};
    for (const k of Object.keys(dash)) {
      const a = dash[k], b = hv[k];
      same[k] = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : k === 'room' ? S.roomScore(a, b) === 3 : String(a == null ? '' : a).toLowerCase() === String(b == null ? '' : b).toLowerCase();
    }
    let decision = dec.pairs[id] || null;
    if (decision && !PAIR_ANSWERS.includes(decision)) decision = null;
    if (decision === 'same-take' && !canTake) decision = null;
    return {
      id, class: c.class, score: c.score, parts: c.parts, kind: c.kind, dashFp: c.it.fp, dashId: c.it.id,
      dash, here: { table: h.table, id: h.id, bankroll: h.bankrollId == null ? 'main' : h.bankrollId, ...hv, personal: !!h.personal, tournamentId: h.tournamentId || null },
      same, netsDiffer, canTake, takeWhy, decision,
    };
  });
  const pairById = new Map(pairs.map((p) => [p.id, p]));

  // Inside the dashboard: rows that look like the same night (information; both import).
  const groups = new Map();
  for (const it of writable) {
    if (it.store !== 'sessions') continue;
    const v = it.mapped.view;
    const k = [it.mapped.kind, v.date, S.roomKey(v.room), r2(v.result)].join('|');
    (groups.get(k) || groups.set(k, []).get(k)).push(it);
  }
  const inside = [...groups.values()].filter((g) => g.length > 1).map((g) => ({ date: g[0].mapped.view.date, room: g[0].mapped.view.room, result: r2(g[0].mapped.view.result), ids: g.map((i) => i.id) }));

  // ── backers: the §7.1 union ──
  const backerItems = [];
  const liveTokens = new Map();
  const consoleRoster = hasTable(db, 'console_records') ? rowsOf(db, "SELECT id, data FROM console_records WHERE store = 'backers' AND deleted = 0").map((r) => { try { return { id: r.id, b: JSON.parse(r.data) }; } catch (_) { return null; } }).filter(Boolean) : [];
  const tombIds = new Set(recs.backers.filter((r) => r.deleted).map((r) => r.id));
  const liveIds = new Set(recs.backers.filter((r) => !r.deleted).map((r) => r.id));
  const ownerBackers = rowsOf(db, 'SELECT id, name, public_token FROM backers WHERE user_id = ?', [uid]);
  const tokenOwner = (token) => ownerBackers.find((b) => b.public_token === token) || oneOf(db, 'SELECT id, user_id, name FROM backers WHERE public_token = ?', [token]);
  const pushBacker = (src, fp, recId, raw, hash, updatedAt, kind) => {
    const mapped = raw ? M.mapBacker(raw) : null;
    const key = keys.byFp.get(fp) || null;
    const alive = refAlive(db, uid, key);
    const base = { fp, standingFp: standingFpOf(fp), store: 'backers', id: recId, hash, updatedAt, key, source: src, kindNo: kind };
    if (!mapped || !mapped.ok) {
      items.push({ ...base, cat: 'backer', status: 'error', error: mapped ? mapped.error : 'unreadable data' });
      errors.push({ fp, store: 'backers', id: recId, error: mapped ? mapped.error : 'unreadable data' });
      return;
    }
    let status = key && alive ? (key.source_hash === hash ? 'unchanged' : 'changed') : key ? 'reimport' : 'new';
    const it = { ...base, cat: 'backer', status, mapped };
    if (status === 'changed') {
      const owner = Jn.selectRow(db, 'backers', { id: key.ref_id });
      const tokenMoved = owner && owner.public_token !== mapped.secret.token;
      const applicable = key.decision === 'imported' && !tokenMoved;
      const conflict = applicable && editedSince(db, uid, key, after);
      it.change = { conflict, applicable, why: tokenMoved ? 'the link changed in the dashboard; the roster sync moves links, not the import' : key.decision !== 'imported' ? 'this backer was matched to a staking backer of yours' : null, default: applicable && !conflict ? 'apply' : 'keep', options: applicable ? ['apply', 'keep'] : ['keep'] };
    }
    if (status === 'new' || status === 'reimport') {
      if (liveTokens.has(mapped.secret.token)) {
        blocking.push('Two dashboard backers carry the same link, which cannot happen; nothing can be imported until one is fixed in the dashboard.');
        it.status = 'error'; it.error = 'its link is the same as another backer\'s';
        errors.push({ fp, store: 'backers', id: recId, error: it.error });
      }
      liveTokens.set(mapped.secret.token, fp);
      const owned = tokenOwner(mapped.secret.token);
      const nameMatches = ownerBackers.filter((b) => mapped.name && String(b.name || '').toLowerCase() === mapped.name.toLowerCase()).map((b) => ({ backerId: b.id, name: b.name }));
      it.matches = nameMatches;
      it.tokenOwner = owned ? owned.id : null;
      if (owned && Number(owned.user_id == null ? uid : owned.user_id) !== uid) {
        it.status = 'error'; it.error = 'its link belongs to another account\'s backer'; errors.push({ fp, store: 'backers', id: recId, error: it.error });
      }
      it.default = owned ? owned.id : 'new';
      let choice = dec.backers[fp];
      if (choice !== undefined && choice !== 'new') {
        const n = Number(choice);
        choice = (owned && n === owned.id) || nameMatches.some((m) => m.backerId === n) ? n : undefined;
      }
      if (owned && choice === 'new') choice = owned.id; // the link is already that backer's: it cannot be a second one
      it.choice = choice === undefined ? it.default : choice;
    }
    backerItems.push(it);
    items.push(it);
  };
  for (const r of recs.backers) {
    if (r.deleted) {
      const key = keys.byFp.get(r.fp) || null;
      if (key && refAlive(db, uid, key) && key.source_hash !== 'deleted') {
        const it = { fp: r.fp, standingFp: standingFpOf(r.fp), store: 'backers', id: r.id, hash: r.hash, updatedAt: r.updatedAt, key, cat: 'backer', status: 'deleted',
          deletion: { conflict: false, same: key.decision !== 'imported', default: 'end', options: ['end', 'keep'] } };
        items.push(it); backerItems.push(it);
      }
      continue;
    }
    if (r.parseError) { pushBacker('roster', r.fp, r.id, null, r.hash, r.updatedAt, 1); continue; }
    pushBacker('roster', r.fp, r.id, r.data, r.hash, r.updatedAt, 1);
  }
  // Kind 2: live on this app's roster copy, not live in the dashboard (deleted there, or never there).
  for (const c of consoleRoster) {
    if (!c.b || typeof c.b.token !== 'string' || liveIds.has(c.id)) continue;
    const fp = 'dash:backers:' + c.id;
    if (mode === 'delta' && !tombIds.has(c.id)) continue;
    if (keys.byFp.has(fp) && refAlive(db, uid, keys.byFp.get(fp))) continue;
    if ([...liveTokens.keys()].includes(c.b.token)) continue;
    // A backer the dashboard has deleted is keyed as 'deleted' from the start: its tombstone then
    // asks nothing on the next pull (its agreement is already ended).
    pushBacker(tombIds.has(c.id) ? 'deleted-in-dashboard' : 'roster-here-only', fp, c.id, c.b, tombIds.has(c.id) ? 'deleted' : M.sourceHashOf(JSON.stringify(c.b)), null, 2);
  }
  // Kind 3: a link with history and no record anywhere.
  const known = new Set([...liveTokens.keys(), ...consoleRoster.map((c) => c.b && c.b.token).filter(Boolean)]);
  for (const b of ownerBackers) if (b.public_token) known.add(b.public_token);
  const histTokens = new Set();
  for (const t of ['backer_events', 'backer_public']) if (hasTable(db, t)) for (const r of rowsOf(db, `SELECT DISTINCT token FROM ${t}`)) histTokens.add(r.token);
  for (const token of [...histTokens].sort()) {
    if (known.has(token) || !/^[A-Za-z0-9]{6,64}$/.test(token)) continue;
    if (oneOf(db, 'SELECT id FROM backers WHERE public_token = ?', [token])) continue;
    const fp = tokenFp(token);
    if (keys.byFp.has(fp) && refAlive(db, uid, keys.byFp.get(fp))) continue;
    const pub = hasTable(db, 'backer_public') ? oneOf(db, 'SELECT name FROM backer_public WHERE token = ?', [token]) : null;
    pushBacker('history-only', fp, null, { token, name: (pub && pub.name) || 'Backer', stakes: [], opening: 0 }, fp, null, 3);
  }

  // ── the slate (wsop-staking) ──
  const slateBlob = blobOf(body, 'wsop-staking');
  const dealItems = [];
  const slateAll = []; // every deal in the blob, for the series status
  if (slateBlob.present && Array.isArray(slateBlob.value)) {
    for (const raw of slateBlob.value) {
      const m = M.mapDeal(raw);
      const fp = m.ok ? 'dash:wsop-staking:' + m.id : null;
      if (!m.ok) { errors.push({ store: 'wsop-staking', error: m.error }); continue; }
      slateAll.push(m);
      const key = keys.byFp.get(fp) || null;
      const alive = refAlive(db, uid, key);
      const hash = M.sourceHashOf(JSON.stringify(raw));
      const status = key && alive ? (key.source_hash === hash ? 'unchanged' : 'changed') : key ? 'reimport' : 'new';
      const it = { fp, store: 'wsop-staking', id: m.id, hash, updatedAt: slateBlob.updatedAt, key, cat: 'deal', status, mapped: m };
      if (status === 'changed') {
        const conflict = editedSince(db, uid, key, after);
        it.change = { conflict, applicable: true, why: null, default: conflict ? 'keep' : 'apply', options: ['apply', 'keep'] };
      }
      dealItems.push(it); items.push(it);
    }
    const inBlob = new Set(slateAll.map((d) => 'dash:wsop-staking:' + d.id));
    for (const [fp, key] of keys.byFp) {
      if (!/^dash:wsop-staking:[^:]+$/.test(fp) || fp.startsWith('dash:wsop-staking-') || inBlob.has(fp) || !refAlive(db, uid, key)) continue;
      if (key.source_hash === 'deleted') continue;
      const it = { fp, store: 'wsop-staking', id: fp.slice('dash:wsop-staking:'.length), hash: 'deleted', updatedAt: slateBlob.updatedAt, key, cat: 'deal', status: 'deleted',
        deletion: { conflict: editedSince(db, uid, key, after), default: 'remove', options: ['remove', 'keep'] } };
      if (it.deletion.conflict) it.deletion.default = 'keep';
      dealItems.push(it); items.push(it);
    }
  }
  // Slate backers: one per distinct name; matched to a roster backer by name, else an existing staking
  // backer, else a staking-only backer with no link (§5.6).
  const slateNames = new Map();
  for (const it of dealItems) {
    if (it.status !== 'new' && it.status !== 'reimport') continue;
    const name = it.mapped.backer || 'Unnamed slate backer';
    const k = name.toLowerCase();
    if (slateNames.has(k)) continue;
    const prevKey = keys.byFp.get(slateBackerFp(name));
    const roster = backerItems.filter((b) => b.mapped && b.mapped.ok && b.mapped.name && b.mapped.name.toLowerCase() === k && (b.status === 'new' || b.status === 'reimport' || b.status === 'unchanged' || b.status === 'changed'));
    const existing = ownerBackers.filter((b) => String(b.name || '').toLowerCase() === k);
    const options = ['new', ...roster.map((b) => 'roster:' + b.fp), ...existing.map((b) => String(b.id))];
    let def = roster.length === 1 ? 'roster:' + roster[0].fp : existing.length === 1 ? String(existing[0].id) : 'new';
    if (prevKey && refAlive(db, uid, prevKey)) def = 'key:' + prevKey.ref_id;
    let choice = dec.slate[k] != null ? String(dec.slate[k]) : def;
    if (!options.includes(choice) && !choice.startsWith('key:')) choice = def;
    slateNames.set(k, { name, key: k, fp: slateBackerFp(name), options, default: def, choice, unnamed: !it.mapped.backer });
  }
  // Settlement links: a settled deal and the backer-settlement adjustment whose note starts "<event>:".
  const settleAdj = items.filter((i) => i.store === 'adjustments' && i.mapped && i.mapped.ok && i.mapped.kind === 'settlement' && (i.status === 'new' || i.status === 'reimport'));
  const priorSettle = [];
  for (const [fp, key] of keys.byFp) {
    if (!fp.startsWith('dash:adjustments:') || key.decision !== 'imported') continue;
    const a = oneOf(db, "SELECT id, amount, note, occurred_on, settlement_ref FROM bankroll_adjustments WHERE id = ? AND user_id = ? AND kind = 'settlement'", [key.ref_id, uid]);
    if (a && !a.settlement_ref) priorSettle.push({ fp, adjId: a.id, amount: a.amount, note: String(a.note || '').replace(/^backer-settlement · /, ''), date: a.occurred_on });
  }
  const pool = [
    ...settleAdj.map((i) => ({ fp: i.fp, amount: i.mapped.legs[0].amount, note: i.mapped.settlementNote || '', date: i.mapped.date, prior: false })),
    ...priorSettle.map((p) => ({ ...p, prior: true })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.fp.localeCompare(b.fp));
  const usedAdj = new Set();
  const linkFor = (deal) => {
    const ev = deal.event.toLowerCase() + ':';
    const who = deal.backer ? deal.backer.toLowerCase() : null;
    const fits = (p) => !usedAdj.has(p.fp) && p.note.toLowerCase().startsWith(ev);
    const arrow = (p) => { const m = /→\s*(.+)$/.exec(p.note); return m ? m[1].trim().toLowerCase() : null; };
    const hit = pool.find((p) => fits(p) && who && arrow(p) === who) || pool.find((p) => fits(p) && !arrow(p)) || pool.find((p) => fits(p) && !who);
    if (hit) usedAdj.add(hit.fp);
    return hit || null;
  };
  for (const it of dealItems) {
    const m = it.mapped;
    if (!m || !m.settled) continue;
    const wasSettled = it.status === 'changed' && it.key && oneOf(db, 'SELECT id FROM backer_settlements WHERE agreement_id = ?', [it.key.ref_id]);
    if (it.status === 'unchanged' || wasSettled || it.status === 'deleted') continue;
    it.settlement = linkFor(m);
  }
  const unlinkedSettlements = pool.filter((p) => !usedAdj.has(p.fp) && !p.prior).map((p) => ({ fp: p.fp, date: p.date, amount: p.amount, note: p.note }));

  // ── balances, tax rate ──
  const balBlob = blobOf(body, 'wsop-balances');
  if (balBlob.present && balBlob.value && Array.isArray(balBlob.value.entries)) {
    const seen = new Set();
    balBlob.value.entries.forEach((e, i) => {
      const m = M.mapLocation(e, i);
      if (!m.ok) { errors.push({ store: 'wsop-balances', error: m.error }); return; }
      const fp = 'dash:wsop-balances:' + m.id;
      seen.add(fp);
      const key = keys.byFp.get(fp) || null;
      const alive = refAlive(db, uid, key);
      const hash = M.sourceHashOf(JSON.stringify(e) + '#' + i);
      const status = key && alive ? (key.source_hash === hash ? 'unchanged' : 'changed') : key ? 'reimport' : 'new';
      const it = { fp, store: 'wsop-balances', id: m.id, hash, updatedAt: balBlob.updatedAt, key, cat: 'location', status, mapped: m };
      if (status === 'changed') { const conflict = editedSince(db, uid, key, after); it.change = { conflict, applicable: true, default: conflict ? 'keep' : 'apply', options: ['apply', 'keep'] }; }
      items.push(it);
    });
    for (const [fp, key] of keys.byFp) {
      if (!fp.startsWith('dash:wsop-balances:') || seen.has(fp) || !refAlive(db, uid, key) || key.source_hash === 'deleted') continue;
      items.push({ fp, store: 'wsop-balances', id: fp.slice('dash:wsop-balances:'.length), hash: 'deleted', key, cat: 'location', status: 'deleted', deletion: { conflict: editedSince(db, uid, key, after), default: 'remove', options: ['remove', 'keep'] } });
    }
  }
  let taxRate = null;
  const taxBlob = blobOf(body, 'wsop-admin-taxrate');
  if (taxBlob.present && Number.isFinite(Number(taxBlob.value)) && taxBlob.value !== null) {
    const fp = 'dash:wsop-admin-taxrate';
    const key = keys.byFp.get(fp) || null;
    const hash = M.sourceHashOf(JSON.stringify(taxBlob.value));
    const v = Number(taxBlob.value);
    const status = key && refAlive(db, uid, key) ? (key.source_hash === hash ? 'unchanged' : 'changed') : 'new';
    taxRate = { fp, hash, updatedAt: taxBlob.updatedAt, key, value: v, status };
    items.push({ fp, store: 'wsop-admin-taxrate', id: null, hash, updatedAt: taxBlob.updatedAt, key, cat: 'taxrate', status, mapped: { value: v },
      ...(status === 'changed' ? { change: { conflict: false, applicable: true, default: 'apply', options: ['apply', 'keep'] } } : {}) });
  }

  // ── recorded shares and notify consistency (information, §9.2) ──
  const sessionsById = new Map(recs.sessions.filter((r) => !r.deleted && r.data).map((r) => [r.id, r.data]));
  const nameOf = new Map();
  for (const c of consoleRoster) if (c.b && c.b.token) nameOf.set(c.b.token, c.b.name || null);
  for (const r of recs.backers) if (r.data && r.data.token) nameOf.set(r.data.token, r.data.name || null);
  const divergences = [];
  const eventsBySession = new Map();
  if (hasTable(db, 'backer_events')) {
    for (const e of rowsOf(db, "SELECT token, session_id, date, game, session_result_cents, pct, share_cents FROM backer_events WHERE COALESCE(source, 'dashboard') = 'dashboard'")) {
      (eventsBySession.get(e.session_id) || eventsBySession.set(e.session_id, []).get(e.session_id)).push(e);
      const s = sessionsById.get(e.session_id);
      if (!s || !Number.isFinite(s.result)) continue;
      const now = Math.round(s.result * 100);
      if (now !== e.session_result_cents) {
        divergences.push({ backer: nameOf.get(e.token) || null, date: e.date, game: e.game, sessionId: e.session_id, pct: e.pct,
          recorded: { resultCents: e.session_result_cents, shareCents: e.share_cents }, now: { resultCents: now, shareCents: shareCents(now, Number(e.pct) || 0) } });
      }
    }
  }
  const notifiedBlob = blobOf(body, 'wsop-notified-sessions');
  let consistency = null;
  if (notifiedBlob.present && Array.isArray(notifiedBlob.value)) {
    const list = new Set(notifiedBlob.value.filter((v) => typeof v === 'string'));
    const dashSessionIds = new Set(recs.sessions.map((r) => r.id));
    consistency = {
      notifiedWithoutEvent: [...list].filter((id) => !eventsBySession.has(id)).sort(),
      eventWithoutNotified: [...eventsBySession.keys()].filter((id) => !list.has(id) && (mode === 'full' || dashSessionIds.has(id))).sort(),
    };
  }

  // ── target and fund ──
  const target = resolveTarget(db, uid, dec.target);
  if (target.error) flags.rows.push({ flag: `the import target (${dec.target}) is no longer usable (${target.error}); Main is used` });
  const fundRow = oneOf(db, "SELECT id, name, target_amount, target_date FROM bankrolls WHERE user_id = ? AND role = 'fund' ORDER BY id LIMIT 1", [uid]);
  const fund = fundRow ? { bankrollId: fundRow.id, exists: true, name: fundRow.name, target: fundRow.target_amount, targetDate: fundRow.target_date }
    : { bankrollId: null, exists: false, name: FUND.name, target: FUND.target, targetDate: FUND.targetDate };
  if (!fundRow) {
    if (oneOf(db, 'SELECT id FROM bankrolls WHERE user_id = ? AND lower(name) = lower(?)', [uid, FUND.name])) fund.name = 'WSOP fund (dashboard)';
  }

  // ── the opening deposit (§5.8, first import only) ──
  let opening = null;
  if (!o.base) {
    const dates = Object.values(state.records).map((r) => r.date).filter(Boolean).sort();
    const D = dates[0] || null;
    if (D) {
      const prior = R.rollBalanceBefore(db, uid, D, { rates: o.rates, sources: o.sources });
      const computed = r2((Number(state.startingRoll) || 0) - prior.total);
      let amount = Math.round(computed), date = D, override = false;
      if (dec.opening && dec.opening.amount != null && Number.isFinite(Number(dec.opening.amount))) { amount = Math.round(Number(dec.opening.amount)); override = true; }
      if (dec.opening && dec.opening.date && M.validDay(String(dec.opening.date))) { date = String(dec.opening.date); override = true; }
      opening = { fp: 'dash:opening', date, amount, computed: { amount: computed, date: D, startingRoll: r2(state.startingRoll), priorBalance: prior.total, parts: prior.parts }, override,
        kind: amount > 0 ? 'deposit' : amount < 0 ? 'withdrawal' : null, settingsHash: state.settingsHash };
      state.openingDate = D;
    }
    if (!recs.settings.some((r) => !r.deleted && r.data)) flags.rows.push({ flag: 'the dashboard sent no starting roll; the opening deposit uses 0' });
  }
  let settingsChange = null;
  if (o.base && state.settingsHash && o.base.settingsHash && state.settingsHash !== o.base.settingsHash) {
    settingsChange = { from: r2(o.base.startingRoll), to: r2(state.startingRoll), note: 'The starting roll changed in the dashboard. The opening deposit is not rewritten; edit it in the bankroll if the new figure is right.' };
  }

  const internal = {
    uid, mode, items, pairById, pairs, backerItems, dealItems, slateNames, slateAll, unlinkedSettlements, taxRate, opening, target, fund, state,
    runId: o.run.id, cursor: o.run.cursor, sourceHash: o.run.sourceHash,
  };
  internal.decisions = dec;

  // ── the plan the owner reads ──
  const view = (it) => {
    const out = { fp: it.fp, store: it.store, id: it.id, status: it.status, date: it.date || null };
    if (it.mapped && it.mapped.ok !== false) {
      if (it.store === 'sessions') { out.kind = it.mapped.kind; out.bankroll = it.mapped.bankroll; out.rows = it.mapped.rows; out.exact = it.mapped.exact; out.rounded = it.mapped.rounded; }
      if (it.store === 'adjustments') { out.kind = it.mapped.kind; out.legs = it.mapped.legs; out.exact = it.mapped.exact; out.rounded = it.mapped.rounded; }
      if (it.store === 'expenses') { out.kind = 'expense'; out.bankroll = 'target'; out.rows = it.mapped.rows; }
      if (it.mapped.flags && it.mapped.flags.length) out.flags = it.mapped.flags;
    }
    if (it.error) out.error = it.error;
    if (it.pairId) out.pairId = it.pairId;
    if (it.status === 'reimport') out.note = 'deleted here after an earlier import, so it imports again';
    return out;
  };
  const counts = {};
  const bump = (cat, st) => { counts[cat] = counts[cat] || { new: 0, toReview: 0, unchanged: 0, changed: 0, deleted: 0, error: 0, skipped: 0 }; const c = counts[cat]; c[st] = (c[st] || 0) + 1; };
  for (const it of items) {
    const cat = it.store === 'sessions' ? (it.mapped && it.mapped.kind === 'tournament' ? 'tournaments' : 'sessions') : it.cat === 'backer' ? 'backers' : it.store === 'wsop-staking' ? 'slate' : it.store === 'wsop-balances' ? 'balances' : it.store === 'wsop-admin-taxrate' ? 'settings' : it.store;
    const st = it.status === 'reimport' ? 'new' : it.status;
    bump(cat, st);
    if (it.pairId || it.status === 'changed' || it.status === 'deleted' || it.status === 'error') counts[cat].toReview++;
    if (it.pairId) counts[cat].new--;
  }
  const writableView = items.filter((i) => ['new', 'reimport', 'error', 'skipped'].includes(i.status) && ['sessions', 'adjustments', 'expenses'].includes(i.store)).map(view);
  const changes = items.filter((i) => i.status === 'changed').map((i) => ({
    itemId: i.fp, store: i.store, id: i.id, cat: i.cat || i.store, conflict: !!i.change.conflict, applicable: i.change.applicable, why: i.change.why || null,
    options: i.change.options, default: i.change.default, decision: validChoice(dec.changes[i.fp], i.change.options),
    to: i.store === 'backers' ? backerView(i) : i.mapped && i.mapped.view ? i.mapped.view : i.mapped && i.mapped.rows ? i.mapped.rows : i.mapped || null,
  }));
  // What a deleted record was, so the review can name it (Phase 6): a result or an adjustment from
  // the dashboard's state as the last import left it, anything else from the row its key names.
  const wasOf = (i) => {
    const rec = o.base && o.base.records ? o.base.records[i.fp] : null;
    const k = i.key;
    if (rec && (i.store === 'sessions' || i.store === 'adjustments')) return { date: rec.date || null, label: rec.label || null, amount: r2((Number(rec.roll) || 0) + (Number(rec.fund) || 0)) };
    if (!k) return null;
    if (k.ref_table === 'bankroll_transactions') { const t = oneOf(db, 'SELECT occurred_on, category, amount FROM bankroll_transactions WHERE id = ? AND user_id = ?', [k.ref_id, uid]); return t ? { date: t.occurred_on, label: `Expense · ${t.category}`, amount: r2(-t.amount) } : null; }
    if (k.ref_table === 'money_locations') { const l = oneOf(db, 'SELECT name, amount FROM money_locations WHERE id = ? AND user_id = ?', [k.ref_id, uid]); return l ? { date: null, label: l.name, amount: r2(l.amount) } : null; }
    if (k.ref_table === 'backers') { const b = oneOf(db, 'SELECT name FROM backers WHERE id = ? AND user_id = ?', [k.ref_id, uid]); return b ? { date: null, label: b.name, amount: null } : null; }
    if (k.ref_table === 'backer_agreements' && hasTable(db, 'staking_series')) {
      const a = oneOf(db, 'SELECT s.name AS series, b.name AS backer FROM backer_agreements a LEFT JOIN staking_series s ON s.id = a.series_id LEFT JOIN backers b ON b.id = a.backer_id WHERE a.id = ?', [k.ref_id]);
      return a ? { date: null, label: [a.series, a.backer].filter(Boolean).join(' · ') || null, amount: null } : null;
    }
    return null;
  };
  const deletions = items.filter((i) => i.status === 'deleted').map((i) => ({
    itemId: i.fp, store: i.store, id: i.id, conflict: !!i.deletion.conflict, options: i.deletion.options, default: i.deletion.default, decision: validChoice(dec.deletions[i.fp], i.deletion.options),
    was: wasOf(i),
  }));
  const plan = {
    version: PLAN_VERSION, runId: o.run.id, mode, since: o.run.since == null ? null : o.run.since, cursor: o.run.cursor, exportedAt: body.exportedAt || null, sourceHash: o.run.sourceHash,
    target: { bankroll: target.key, name: target.name },
    fund: { ...fund, create: false },
    counts,
    rows: writableView,
    pairs: pairs.map((p) => ({ ...p })),
    inside,
    backers: backerItems.map(backerView),
    slate: {
      deals: dealItems.map((d) => ({ fp: d.fp, id: d.id, status: d.status, event: d.mapped ? d.mapped.event : null, buyIn: d.mapped ? d.mapped.buyIn : null, pctSold: d.mapped ? d.mapped.pctSold : null,
        markup: d.mapped ? d.mapped.markup : null, backer: d.mapped ? d.mapped.backer : null, settled: d.mapped ? d.mapped.settled : null,
        settlement: d.settlement ? { adjustmentFp: d.settlement.fp, amount: d.settlement.amount, date: d.settlement.date } : null,
        unlinked: !!(d.mapped && d.mapped.settled && !d.settlement && (d.status === 'new' || d.status === 'reimport')) })),
      backers: [...slateNames.values()].map((s) => ({ key: s.key, name: s.name, options: s.options, default: s.default, choice: s.choice, unnamed: s.unnamed })),
      unlinkedSettlements,
    },
    balances: items.filter((i) => i.cat === 'location').map((i) => ({ fp: i.fp, id: i.id, status: i.status, name: i.mapped ? i.mapped.rows.money_locations.name : null, amount: i.mapped ? i.mapped.rows.money_locations.amount : null })),
    settings: { startingRoll: r2(state.startingRoll), taxSetAsidePct: taxRate ? { value: taxRate.value, status: taxRate.status } : null, change: settingsChange },
    changes, deletions,
    divergences, consistency,
    flags, errors, blocking: [...new Set(blocking)],
    opening: opening ? { date: opening.date, amount: opening.amount, kind: opening.kind, override: opening.override, computed: opening.computed } : null,
  };
  plan.undecided = pairs.filter((p) => !p.decision).length;
  return { plan, internal };
}

function validChoice(v, options) { return typeof v === 'string' && options.includes(v) ? v : null; }

function backerView(it) {
  const m = it.mapped && it.mapped.ok ? it.mapped : null;
  return {
    fp: it.fp, id: it.id, status: it.status, source: it.source || null, kind: it.kindNo || null,
    name: m ? m.name : null, token: m ? m.maskedToken : null, stakes: m ? stakesSummary(m.stakes) : null, openingCents: m ? m.openingCents : null,
    delivery: m ? m.delivery : null, agreement: it.kindNo === 1 ? 'active' : it.kindNo ? 'ended' : null,
    matches: it.matches || [], default: it.default === undefined ? null : it.default, choice: it.choice === undefined ? null : it.choice,
    ...(it.error ? { error: it.error } : {}), ...(it.change ? { change: it.change } : {}), ...(it.deletion ? { deletion: it.deletion } : {}),
  };
}

/** 'main' or a bankroll id -> { key, id (null = Main), name } | { error } (and Main) */
function resolveTarget(db, uid, raw) {
  if (raw == null || raw === 'main') return { key: 'main', id: null, name: 'Main' };
  const n = Number(raw);
  const b = Number.isInteger(n) && n > 0 ? oneOf(db, 'SELECT id, name, currency, archived, role, in_roll FROM bankrolls WHERE id = ? AND user_id = ?', [n, uid]) : null;
  const err = !b ? 'not your bankroll' : b.archived ? 'archived' : b.role === 'fund' ? 'the fund' : !Number(b.in_roll) ? 'not in the roll' : b.currency !== 'USD' ? 'not in USD' : null;
  if (err) return { key: 'main', id: null, name: 'Main', error: err };
  return { key: b.id, id: b.id, name: b.name };
}

/** The canonical JSON of a plan, for its hash: everything but the hash itself. */
function planHashOf(plan) {
  const { planHash, generatedAt, ...rest } = plan;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

module.exports = {
  PLAN_VERSION, FUND, PAIR_ANSWERS, normaliseDecisions, loadKeys, refAlive, recordRows, editedSince, hereRows, parseRecords, mergeState,
  buildPlan, resolveTarget, planHashOf, seriesFp, slateBackerFp, tokenFp, standingFpOf,
};
