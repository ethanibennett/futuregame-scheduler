'use strict';
/*
 * The dashboard import (docs/bankroll-merge.md §8, §9; Phase 5): pull, stage, plan, decide, commit,
 * undo, and the delta. The routes are in routes.js; this file is the engine they call, and the one
 * migration it needs.
 *
 *   stage(db, uid, body, { mode, since })      a verified export -> a 'staged' money_import_runs row
 *   planFor(db, uid, run, { rates, sources })  the plan, built fresh against this database
 *   commit(db, uid, run, { planHash, ... })    the owner's answers, in ONE savepoint
 *   undo(db, uid, run, { expect })             the run, reversed exactly
 *
 * money_import_runs (lib/money-merge.js) gains, here: source_hash (the export's own hash, checked
 * again before a commit), cursor / mode / since (the delta), plan_hash, journal (every write, for the
 * undo), state (the dashboard's figures as this run leaves them, record by record, so a delta can be
 * reconciled without the whole history) and undone_at.
 *
 * The payload holds the backers' tokens, phones and emails. It is cleared when a run is discarded or
 * undone, and 7 days after a commit (purgePayloads). Plans hold masked tokens and booleans only.
 */
const pull = require('./pull');
const P = require('./plan');
const A = require('./apply');
const Jn = require('./journal');
const { hasColumn, hasTable } = require('../money-merge');

const MIGRATION_NAME = 'money-import-2026-10';
const PAYLOAD_KEEP_DAYS = 7;
const COLUMNS = [
  ['money_import_runs', 'source_hash', 'TEXT'],
  ['money_import_runs', 'cursor', 'INTEGER'],
  ['money_import_runs', 'mode', 'TEXT'],
  ['money_import_runs', 'since', 'INTEGER'],
  ['money_import_runs', 'plan_hash', 'TEXT'],
  ['money_import_runs', 'journal', 'TEXT'],
  ['money_import_runs', 'state', 'TEXT'],
  ['money_import_runs', 'undone_at', 'TEXT'],
  // §5.6: a slate deal's agreement carries "Slate buy-in $X (imported)"; backer_agreements had no notes.
  ['backer_agreements', 'notes', 'TEXT'],
];

/** Additive, idempotent, one savepoint. -> [added 'table.column'] */
function migrate(db) {
  const added = [];
  db.run('SAVEPOINT money_import_migrate');
  try {
    for (const [t, c, def] of COLUMNS) {
      if (!hasTable(db, t)) throw new Error(`money-import: table ${t} does not exist (an earlier migration has not run)`);
      if (hasColumn(db, t, c)) continue;
      db.run(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
      added.push(`${t}.${c}`);
    }
    db.run('CREATE INDEX IF NOT EXISTS idx_money_import_runs_user ON money_import_runs(user_id, status)');
    db.run('RELEASE money_import_migrate');
  } catch (e) {
    try { db.run('ROLLBACK TO money_import_migrate'); db.run('RELEASE money_import_migrate'); } catch (_) { /* nothing open */ }
    throw e;
  }
  return added;
}

function rowsOf(db, sql, params = []) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const oneOf = (db, sql, params) => rowsOf(db, sql, params)[0] || null;
const parse = (s, fallback = null) => { if (s == null) return fallback; try { return JSON.parse(s); } catch (_) { return fallback; } };

function getRun(db, uid, id) { return oneOf(db, 'SELECT * FROM money_import_runs WHERE id = ? AND user_id = ?', [id, uid]); }
/** The newest committed (not undone) run: the base a new plan is read against. */
function lastCommitted(db, uid, exceptId = 0) {
  return oneOf(db, "SELECT * FROM money_import_runs WHERE user_id = ? AND status = 'committed' AND id <> ? ORDER BY id DESC LIMIT 1", [uid, exceptId]);
}
function committedJournals(db, uid, exceptId = 0) {
  return rowsOf(db, "SELECT journal FROM money_import_runs WHERE user_id = ? AND status = 'committed' AND id <> ? ORDER BY id", [uid, exceptId]).map((r) => parse(r.journal, []));
}

/** What a fetch should ask for: a delta from the last accepted cursor less the margin, else everything. */
function pullMode(db, uid, wanted = 'auto') {
  const last = lastCommitted(db, uid);
  const since = last ? pull.deltaSince(last.cursor) : null;
  if (wanted === 'full' || since == null) return { mode: 'full', since: null, baseRunId: last ? last.id : null, baseCursor: last ? Number(last.cursor) || 0 : 0 };
  return { mode: 'delta', since, baseRunId: last.id, baseCursor: Number(last.cursor) || 0 };
}

/** A verified export becomes a staged run. Older staged runs are discarded (their payloads cleared). -> { runId, discarded } */
function stage(db, uid, body, { mode, since, baseCursor = 0, now = new Date() }) {
  // The accepted cursor never moves back. An empty delta echoes the `since` it was sent (the last
  // cursor less the margin), and a delta of re-sent rows tops out below the last cursor; taken as they
  // come, either would walk every later delta another 14 days into the past.
  const cursor = Math.max(Number(body.cursor) || 0, Number(baseCursor) || 0);
  const discarded = rowsOf(db, "SELECT id FROM money_import_runs WHERE user_id = ? AND status = 'staged'", [uid]).map((r) => r.id);
  db.run('SAVEPOINT money_import_stage');
  try {
    for (const id of discarded) db.run("UPDATE money_import_runs SET status = 'discarded', payload = NULL WHERE id = ?", [id]);
    db.run(`INSERT INTO money_import_runs (user_id, source, fetched_at, payload, plan, decisions, status, source_hash, cursor, mode, since)
            VALUES (?, 'dashboard', ?, ?, NULL, ?, 'staged', ?, ?, ?, ?)`,
      [uid, now.toISOString(), JSON.stringify(body), JSON.stringify(P.normaliseDecisions(null)), body.hash, cursor, mode, since == null ? null : since]);
    const runId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    db.run('RELEASE money_import_stage');
    return { runId, discarded };
  } catch (e) {
    try { db.run('ROLLBACK TO money_import_stage'); db.run('RELEASE money_import_stage'); } catch (_) { /* */ }
    throw e;
  }
}

/**
 * The plan for a run, built now. -> { plan, internal } | { error, status }.
 * opts = { rates, sources, now, decisions (override the stored ones) }
 */
function planFor(db, uid, run, opts = {}) {
  if (!run.payload) return { status: 410, error: 'This run\'s payload has been cleared; fetch again.' };
  const body = parse(run.payload);
  if (!body) return { status: 500, error: 'This run\'s payload cannot be read; fetch again.' };
  const base = lastCommitted(db, uid, run.id);
  const built = P.buildPlan(db, uid, {
    run: { id: run.id, payload: body, mode: run.mode, since: run.since, cursor: run.cursor, sourceHash: run.source_hash },
    base: base ? parse(base.state) : null,
    decisions: opts.decisions || parse(run.decisions, {}),
    rates: opts.rates, sources: opts.sources,
    journals: committedJournals(db, uid, run.id),
  });
  const before = require('./reconcile').reconcile(db, uid, { dashState: built.internal.state, rates: opts.rates, sources: opts.sources });
  const sim = A.simulate(db, uid, built.internal, { decisions: built.internal.decisions, now: opts.now, runId: run.id, rates: opts.rates, sources: opts.sources });
  const rec = sim.reconciliation;
  built.plan.fund.create = sim.fundCreated;
  built.plan.rounding = sim.summary.corrections;
  built.plan.writes = { rows: sim.created, tables: sim.tables, ...summaryCounts(sim.summary) };
  built.plan.reconciliation = {
    dashboard: rec.dashboard,
    before: before.here,
    after: rec.here,
    openingDate: rec.openingDate,
    lines: rec.lines, lists: rec.lists, unexplained: rec.unexplained, fundWithinRemainder: rec.fundWithinRemainder,
    provisional: built.plan.undecided > 0,
    assumes: built.plan.undecided > 0 ? 'unanswered pairs counted as the same night, keeping futurega.me\'s figures' : null,
  };
  built.plan.planHash = P.planHashOf(built.plan);
  return built;
}
function summaryCounts(s) {
  const { taken, corrections, opening, ...rest } = s;
  return { ...rest, taken: taken.length, corrections: corrections.length, opening: !!opening };
}

/** Rebuild, store and return the plan of a staged run. */
function refreshPlan(db, uid, run, opts) {
  const built = planFor(db, uid, run, opts);
  if (built.error) return built;
  db.run('UPDATE money_import_runs SET plan = ?, plan_hash = ? WHERE id = ?', [JSON.stringify(built.plan), built.plan.planHash, run.id]);
  return built;
}

/**
 * Commit a staged run. opts = { planHash (the one the owner reviewed), rates, sources, now }.
 * -> { status: 200, body } | { status, body: { error, ... } }
 */
function commit(db, uid, run, opts = {}) {
  const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });
  if (run.status !== 'staged') return fail(409, `This run is ${run.status}, not staged.`);
  if (!opts.planHash) return fail(400, 'Send the planHash of the plan you reviewed.');
  if (opts.planHash !== run.plan_hash) return fail(409, 'This is not the plan you reviewed: read the plan again before importing.', { stale: true, planHash: run.plan_hash });
  const body = parse(run.payload);
  if (!body) return fail(410, 'This run\'s payload has been cleared; fetch again.');
  if (pull.payloadHash(body.records, body.local) !== run.source_hash) return fail(409, 'The staged payload no longer matches the hash it was pulled with; fetch again.', { stale: true });
  const later = lastCommitted(db, uid, run.id);
  if (later && later.id > run.id) return fail(409, `A later import (#${later.id}) has been committed; fetch again.`, { stale: true });
  const fresh = planFor(db, uid, run, opts);
  if (fresh.error) return fail(fresh.status, fresh.error);
  if (fresh.plan.planHash !== run.plan_hash) {
    return fail(409, 'Something here changed since the plan was read (a result logged, a key written, or the answers changed): read the plan again before importing.', { stale: true, planHash: fresh.plan.planHash });
  }
  if (fresh.plan.undecided > 0) return fail(409, `${fresh.plan.undecided} pair${fresh.plan.undecided === 1 ? '' : 's'} still to answer.`, { undecided: fresh.plan.undecided });
  if (fresh.plan.blocking.length) return fail(409, fresh.plan.blocking[0], { blocking: fresh.plan.blocking });
  const now = opts.now || new Date();
  db.run('SAVEPOINT money_import_commit');
  try {
    const r = A.apply(db, uid, fresh.internal, { decisions: fresh.internal.decisions, now, runId: run.id, rates: opts.rates, sources: opts.sources });
    const summary = {
      ...r.summary, created: Jn.createdCount(r.ops), undoCount: Jn.createdCount(r.ops), tables: Jn.tableCounts(r.ops),
      reconciliation: { dashboard: r.reconciliation.dashboard, after: r.reconciliation.here, lines: r.reconciliation.lines, lists: r.reconciliation.lists,
        unexplained: r.reconciliation.unexplained, fundWithinRemainder: r.reconciliation.fundWithinRemainder, fundId: r.fundId },
    };
    db.run(`UPDATE money_import_runs SET status = 'committed', committed_at = ?, summary = ?, journal = ?, state = ?, plan = ? WHERE id = ?`,
      [now.toISOString(), JSON.stringify(summary), JSON.stringify(r.ops), JSON.stringify(r.state), JSON.stringify(fresh.plan), run.id]);
    db.run('RELEASE money_import_commit');
    return { status: 200, body: { ok: true, runId: run.id, summary } };
  } catch (e) {
    try { db.run('ROLLBACK TO money_import_commit'); db.run('RELEASE money_import_commit'); } catch (_) { /* */ }
    throw e;
  }
}

/** Undo a committed run. opts = { expect, now }. */
function undo(db, uid, run, opts = {}) {
  const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });
  if (run.status !== 'committed') return fail(409, `This run is ${run.status}; only a committed import can be undone.`);
  const later = lastCommitted(db, uid, run.id);
  if (later && later.id > run.id) return fail(409, `Undo the later import (#${later.id}) first.`, { later: later.id });
  const ops = parse(run.journal, []);
  const count = Jn.createdCount(ops);
  if (Number(opts.expect) !== count) return fail(409, `This import created ${count} row${count === 1 ? '' : 's'}; type that number to undo it.`, { expect: count });
  const check = Jn.checkUndo(db, ops);
  if (!check.ok) {
    return fail(409, `${check.edited.length} row${check.edited.length === 1 ? ' has' : 's have'} been changed since the import. Undo would destroy that; put them back first, or keep the import.`, { edited: check.edited });
  }
  const now = opts.now || new Date();
  db.run('SAVEPOINT money_import_undo');
  try {
    const r = Jn.undoOps(db, ops);
    db.run("UPDATE money_import_runs SET status = 'undone', undone_at = ?, payload = NULL WHERE id = ?", [now.toISOString(), run.id]);
    db.run('RELEASE money_import_undo');
    return { status: 200, body: { ok: true, runId: run.id, ...r, missing: check.missing } };
  } catch (e) {
    try { db.run('ROLLBACK TO money_import_undo'); db.run('RELEASE money_import_undo'); } catch (_) { /* */ }
    throw e;
  }
}

/** Discard a staged run (its payload goes with it). */
function discard(db, uid, run) {
  if (run.status !== 'staged') return { status: 409, body: { error: `This run is ${run.status}, not staged.` } };
  db.run("UPDATE money_import_runs SET status = 'discarded', payload = NULL WHERE id = ?", [run.id]);
  return { status: 200, body: { ok: true, runId: run.id } };
}

/** Clear the payload of every run committed more than 7 days ago. -> rows cleared */
function purgePayloads(db, now = Date.now()) {
  if (!hasTable(db, 'money_import_runs')) return 0;
  const cutoff = new Date(now - PAYLOAD_KEEP_DAYS * 864e5).toISOString();
  db.run("UPDATE money_import_runs SET payload = NULL WHERE payload IS NOT NULL AND ((status = 'committed' AND committed_at < ?) OR status IN ('discarded', 'undone'))", [cutoff]);
  return db.getRowsModified();
}

/** A run for the owner: what the list shows. */
function runView(r) {
  const plan = parse(r.plan);
  const summary = parse(r.summary);
  return {
    id: r.id, status: r.status, mode: r.mode || null, since: r.since == null ? null : r.since, cursor: r.cursor == null ? null : r.cursor,
    fetchedAt: r.fetched_at, committedAt: r.committed_at || null, undoneAt: r.undone_at || null, payloadKept: r.payload != null,
    planHash: r.plan_hash || null, counts: plan ? plan.counts : null, undecided: plan ? plan.undecided : null,
    undoCount: summary ? summary.undoCount : null,
  };
}

module.exports = {
  MIGRATION_NAME, PAYLOAD_KEEP_DAYS, migrate, getRun, lastCommitted, pullMode, stage, planFor, refreshPlan, commit, undo, discard, purgePayloads, runView,
  pull, parse,
};
