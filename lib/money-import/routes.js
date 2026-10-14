'use strict';
/*
 * Routes of the dashboard import (docs/bankroll-merge.md §8.2), under /api/bankrolls/import/dashboard:
 * the /api/bankrolls admin gate (lib/bankrolls.js), and then the OWNER only (req.user.id must be
 * HAM_OWNER_ID), so no other admin can pull the owner's money into their own account. JSON only;
 * Phase 6 builds the review on them.
 *
 *   GET    /                    { pull: { on, why }, runs: [run] }
 *   POST   /fetch               { mode?: 'auto'|'full'|'delta' } -> { runId, mode, since, discarded, plan }
 *   GET    /:runId              { run, plan, decisions, summary }    (a staged plan is rebuilt first)
 *   PUT    /:runId/decisions    { pairs?, fillLikely?, backers?, slate?, opening?, target?, changes?, deletions? } -> { runId, plan, ignored }
 *   POST   /:runId/commit       { planHash } -> { ok, runId, summary }  (409: stale, unanswered, blocked)
 *   POST   /:runId/undo         { expect } -> { ok, runId, removed, restored, reinserted, missing } (409: count, edited)
 *   DELETE /:runId              discard a staged run
 *
 * Every answer is Cache-Control: no-store. Nothing here logs a token, a payload or a backer's
 * address: the log lines carry counts and run ids.
 */
const engine = require('./index');
const P = require('./plan');
const ledger = require('../bankroll-ledger');

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireAppAdmin, fetchExchangeRates, getOwnerId } = deps;
  const env = deps.env || process.env;
  const baseUrl = () => (deps.getDashboardBaseUrl ? deps.getDashboardBaseUrl() : (env.DASHBOARD_BASE_URL || 'https://dashboard.futurega.me'));
  const timeoutMs = Number(env.MONEY_IMPORT_FETCH_TIMEOUT_MS) > 0 ? Number(env.MONEY_IMPORT_FETCH_TIMEOUT_MS) : engine.pull.DEFAULT_TIMEOUT_MS;
  const sources = ledger.loadSources(deps.sourcesDir);
  const BASE = '/api/bankrolls/import/dashboard';
  let pulling = false;

  const owner = (req, res, next) => {
    const id = getOwnerId();
    if (id == null || Number(req.user && req.user.id) !== Number(id)) return res.status(403).json({ error: 'Forbidden' });
    res.set('Cache-Control', 'no-store');
    next();
  };
  const gate = [authenticateToken, requireAppAdmin, owner];
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res, getDb(), Number(req.user.id)); } catch (err) {
      console.error('[money-import]', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Nothing was written.' });
    }
  };
  const rates = async () => ((await fetchExchangeRates()) || {}).rates || null;
  const runOf = (req, res, db, uid) => {
    const id = Number(req.params.runId);
    const run = Number.isInteger(id) && id > 0 ? engine.getRun(db, uid, id) : null;
    if (!run) { res.status(404).json({ error: 'Import run not found' }); return null; }
    return run;
  };

  app.get(BASE, ...gate, wrap((req, res, db, uid) => {
    const q = db.exec('SELECT id FROM money_import_runs WHERE user_id = ? ORDER BY id DESC LIMIT 50', [uid]);
    const ids = q.length ? q[0].values.map((v) => v[0]) : [];
    res.json({ pull: engine.pull.ledgerTokenStatus(env), runs: ids.map((id) => engine.runView(engine.getRun(db, uid, id))) });
  }));

  app.post(`${BASE}/fetch`, ...gate, wrap(async (req, res, db, uid) => {
    const wanted = String((req.body && req.body.mode) || 'auto');
    if (!['auto', 'full', 'delta'].includes(wanted)) return res.status(400).json({ error: 'mode must be auto, full or delta' });
    const status = engine.pull.ledgerTokenStatus(env);
    if (!status.on) return res.status(503).json({ error: `The dashboard pull is off on this server: ${status.why}.` });
    if (pulling) return res.status(409).json({ error: 'A pull is already running.' });
    const m = engine.pullMode(db, uid, wanted);
    if (wanted === 'delta' && m.mode !== 'delta') return res.status(409).json({ error: 'There is no committed import to pull a delta from; fetch everything first.' });
    pulling = true;
    let got;
    try { got = await engine.pull.pullExport({ baseUrl: baseUrl(), env, since: m.since, timeoutMs }); } finally { pulling = false; }
    if (!got.ok) {
      console.warn(`[money-import] pull refused: ${got.error}`);
      return res.status(got.status).json({ error: got.error });
    }
    const b = got.body;
    const { runId, discarded } = engine.stage(db, uid, b, { mode: m.mode, since: m.since, baseCursor: m.baseCursor });
    const run = engine.getRun(db, uid, runId);
    const built = engine.refreshPlan(db, uid, run, { rates: await rates(), sources });
    await saveDatabase();
    console.log(`[money-import] staged run #${runId}: ${b.count} records (${Object.entries(b.counts).map(([k, v]) => `${k} ${v}`).join(', ')}; ${b.deleted} deleted; ${b.localCount} local) ${m.mode}${m.since != null ? ` since=${m.since}` : ''} cursor=${b.cursor} hash=${String(b.hash).slice(0, 12)} ${got.bytes}B ${got.ms}ms`);
    if (built.error) return res.status(built.status || 500).json({ error: built.error, runId });
    res.json({ runId, mode: m.mode, since: m.since, discarded, plan: built.plan });
  }));

  app.get(`${BASE}/:runId`, ...gate, wrap(async (req, res, db, uid) => {
    const run = runOf(req, res, db, uid); if (!run) return;
    let plan = engine.parse(run.plan);
    if (run.status === 'staged') {
      const built = engine.refreshPlan(db, uid, run, { rates: await rates(), sources });
      if (built.error) return res.status(built.status || 500).json({ error: built.error });
      plan = built.plan;
      await saveDatabase();
    }
    const fresh = engine.getRun(db, uid, run.id);
    res.json({ run: engine.runView(fresh), plan, decisions: engine.parse(fresh.decisions, {}), summary: engine.parse(fresh.summary) });
  }));

  app.put(`${BASE}/:runId/decisions`, ...gate, wrap(async (req, res, db, uid) => {
    const run = runOf(req, res, db, uid); if (!run) return;
    if (run.status !== 'staged') return res.status(409).json({ error: `This run is ${run.status}, not staged.` });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const r = await rates();
    const current = engine.planFor(db, uid, run, { rates: r, sources });
    if (current.error) return res.status(current.status || 500).json({ error: current.error });
    const merged = mergeDecisions(db, uid, engine.parse(run.decisions, {}), body, current);
    if (merged.error) return res.status(400).json({ error: merged.error });
    db.run('UPDATE money_import_runs SET decisions = ? WHERE id = ?', [JSON.stringify(merged.decisions), run.id]);
    const built = engine.refreshPlan(db, uid, engine.getRun(db, uid, run.id), { rates: r, sources });
    if (built.error) return res.status(built.status || 500).json({ error: built.error });
    await saveDatabase();
    res.json({ runId: run.id, plan: built.plan, ignored: merged.ignored });
  }));

  app.post(`${BASE}/:runId/commit`, ...gate, wrap(async (req, res, db, uid) => {
    const run = runOf(req, res, db, uid); if (!run) return;
    const out = engine.commit(db, uid, run, { planHash: req.body && req.body.planHash, rates: await rates(), sources });
    if (out.status !== 200) return res.status(out.status).json(out.body);
    await saveDatabase();
    const s = out.body.summary;
    console.log(`[money-import] committed run #${run.id}: ${s.created} row(s) created (cash ${s.cash}, tournaments ${s.tournaments}, adjustments ${s.adjustments}, transfers ${s.transfers}, settlements ${s.settlements}, expenses ${s.expenses}, backers ${s.backers}, deals ${s.deals}; same ${s.same}, changed ${s.changed}, removed ${s.removed})`);
    res.json(out.body);
  }));

  app.post(`${BASE}/:runId/undo`, ...gate, wrap(async (req, res, db, uid) => {
    const run = runOf(req, res, db, uid); if (!run) return;
    const out = engine.undo(db, uid, run, { expect: req.body && req.body.expect });
    if (out.status !== 200) return res.status(out.status).json(out.body);
    await saveDatabase();
    console.log(`[money-import] undid run #${run.id}: ${out.body.removed} row(s) removed, ${out.body.restored} restored, ${out.body.reinserted} put back`);
    res.json(out.body);
  }));

  app.delete(`${BASE}/:runId`, ...gate, wrap(async (req, res, db, uid) => {
    const run = runOf(req, res, db, uid); if (!run) return;
    const out = engine.discard(db, uid, run);
    if (out.status !== 200) return res.status(out.status).json(out.body);
    await saveDatabase();
    res.json(out.body);
  }));
}

/**
 * The owner's answers merged into what is stored. Validates every value against the current plan.
 * -> { decisions, ignored } | { error }
 */
function mergeDecisions(db, uid, stored, body, built) {
  const d = P.normaliseDecisions(stored);
  const plan = built.plan;
  const ignored = [];
  const pairs = new Map(plan.pairs.map((p) => [p.id, p]));
  if (body.pairs !== undefined) {
    if (!body.pairs || typeof body.pairs !== 'object') return { error: 'pairs must be an object of pairId: answer' };
    for (const [id, v] of Object.entries(body.pairs)) {
      const p = pairs.get(id);
      if (!p) { ignored.push(id); continue; }
      if (v === null) { delete d.pairs[id]; continue; }
      if (!P.PAIR_ANSWERS.includes(v)) return { error: `a pair's answer is one of ${P.PAIR_ANSWERS.join(', ')}` };
      if (v === 'same-take' && !p.canTake) return { error: `${id}: ${p.takeWhy}` };
      d.pairs[id] = v;
    }
  }
  if (body.fillLikely !== undefined) {
    if (!['same-keep', 'same-take'].includes(body.fillLikely)) return { error: 'fillLikely is same-keep or same-take' };
    for (const p of plan.pairs) if (p.class === 'likely' && !d.pairs[p.id]) d.pairs[p.id] = body.fillLikely === 'same-take' && !p.canTake ? 'same-keep' : body.fillLikely;
  }
  if (body.backers !== undefined) {
    if (!body.backers || typeof body.backers !== 'object') return { error: 'backers must be an object of fingerprint: "new" | backer id' };
    const byFp = new Map(plan.backers.map((b) => [b.fp, b]));
    for (const [fp, v] of Object.entries(body.backers)) {
      const b = byFp.get(fp);
      if (!b || (b.status !== 'new' && b.status !== 'reimport')) { ignored.push(fp); continue; }
      if (v === 'new') { d.backers[fp] = 'new'; continue; }
      const n = Number(v);
      if (!b.matches.some((m) => m.backerId === n) && b.default !== n) return { error: `${fp}: pick "new" or one of the staking backers it matches` };
      d.backers[fp] = n;
    }
  }
  if (body.slate !== undefined) {
    if (!body.slate || typeof body.slate !== 'object') return { error: 'slate must be an object of backer name: choice' };
    const byKey = new Map(plan.slate.backers.map((s) => [s.key, s]));
    for (const [k, v] of Object.entries(body.slate)) {
      const s = byKey.get(String(k).toLowerCase());
      if (!s) { ignored.push(k); continue; }
      if (!s.options.includes(String(v))) return { error: `${k}: pick one of ${s.options.join(', ')}` };
      d.slate[s.key] = String(v);
    }
  }
  if (body.opening !== undefined) {
    if (body.opening === null) d.opening = null;
    else {
      const o = body.opening || {};
      if (o.amount != null && (!Number.isFinite(Number(o.amount)) || Math.abs(Number(o.amount)) > 1e10)) return { error: 'opening.amount must be a number' };
      if (o.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(o.date))) return { error: 'opening.date must be YYYY-MM-DD' };
      if (!plan.opening) return { error: 'This import has no opening deposit (it is not the first one).' };
      d.opening = { amount: o.amount == null ? null : Number(o.amount), date: o.date == null ? null : String(o.date) };
    }
  }
  if (body.target !== undefined) {
    const t = P.resolveTarget(db, uid, body.target);
    if (t.error) return { error: `The import target cannot be that bankroll: ${t.error}.` };
    d.target = t.key;
  }
  for (const [field, list] of [['changes', plan.changes], ['deletions', plan.deletions]]) {
    if (body[field] === undefined) continue;
    if (!body[field] || typeof body[field] !== 'object') return { error: `${field} must be an object of itemId: answer` };
    const byId = new Map(list.map((c) => [c.itemId, c]));
    for (const [id, v] of Object.entries(body[field])) {
      const c = byId.get(id);
      if (!c) { ignored.push(id); continue; }
      if (v === null) { delete d[field][id]; continue; }
      if (!c.options.includes(v)) return { error: `${id}: pick one of ${c.options.join(', ')}` };
      d[field][id] = v;
    }
  }
  return { decisions: d, ignored };
}

module.exports = { mountRoutes, mergeDecisions };
