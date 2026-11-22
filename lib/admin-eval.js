'use strict';
/*
 * The hand parser's live eval, started from the Admin screen (2026-10-15). The launch plan opens quick
 * add to everyone only if test/quick-add/eval.js passes against the REAL model, and only the server has
 * the key (ANTHROPIC_API_KEY, the Table Scanner's). So the server runs the eval itself, in the
 * background, one run at a time: `node test/quick-add/eval.js --out <dir>` in its default mode, which
 * calls lib/quick-add.js directly with that key. The report it writes (Markdown) is kept in memory and
 * served to admins. Nothing here is reachable by anyone else.
 *
 * Each run picks what it measures (2026-11-21): the model and its thinking effort (lib/quick-add/prompt.js
 * requestShape), the corpus (the 266 hands, or the 1,000 shorthand hands), and optionally a sample. A
 * finished run's headline figures and its report are kept in quick_add_eval_runs, so the baseline and each
 * candidate can be read side by side after a restart (Admin › Hand parser, live eval). The runs to make:
 * docs/quick-add-model-runs.md.
 *
 * A finished run whose parses are still kept can be rescored (2026-11-22): a new run that scores those
 * parses with today's scorer and corpus (eval.js --parses), no model call, no key, no cost. It is how a
 * fix to the eval reaches runs already paid for (the suits the server fills in, cards a text names that
 * the corpus had left out).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVAL = path.join(ROOT, 'test', 'quick-add', 'eval.js');
const LOG_MAX = 6000;
const KEEP_RUNS = 40;
// A finished run's parses are kept for the newest few runs, to read a hand as the model returned it.
const KEEP_CASE_RUNS = 3;

/* What a run may ask for. The models are the ones worth measuring for the parse (any claude-* id is
   accepted from the API); '' effort is the model's own request with no effort set: today's forced tool
   on Claude Sonnet 5, effort medium on the models that only take the thinking shape. */
const OPTIONS = {
  models: ['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-opus-5'],
  efforts: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
  corpora: {
    main: { label: '266 corpus hands', path: null, cases: 266 },
    shorthand: { label: '1,000 shorthand hands', path: path.join('test', 'quick-add', 'shorthand-corpus.json'), cases: 1000 },
  },
};

/* A rough cost per hand before anything is measured, for the confirm step: the cached prompt (~11,700
   tokens: the system prompt and record_hand's schema, read from the cache), ~400 tokens of description,
   and a GUESS at the output, thinking included, by effort. A run's report has the real figure, and the
   Admin screen uses that once a run of the same model and effort exists. */
const GUESS_OUTPUT_TOKENS = { forced: 1200, low: 2400, medium: 4200, high: 7500, xhigh: 11000, max: 15000 };
function estimates() {
  const { requestShape } = require('./quick-add/prompt');
  const { costUsd } = require('./quick-add/pricing');
  const out = {};
  for (const model of OPTIONS.models) {
    out[model] = {};
    for (const effort of OPTIONS.efforts) {
      const s = requestShape(model, effort);
      const c = costUsd({ input_tokens: 400, cache_read_input_tokens: 11700, output_tokens: GUESS_OUTPUT_TOKENS[s.mode === 'forced' ? 'forced' : s.effort] }, model);
      out[model][effort] = c == null ? null : Math.round(c * 10000) / 10000;
    }
  }
  return out;
}

let deps = null;
let state = { running: false, startedAt: null, finishedAt: null, exitCode: null, progress: null, log: '', report: null, reportName: null, error: null, options: null, summary: null };

function init(d) { deps = d; }

/* Runs survive a restart (2026-11-21: a deploy killed a full Opus run 7 hands from the end, and the
   eval writes its report only when it ends). A kept run is a row from the moment it starts (status
   'running', then 'done'); each hand's parse is kept as it finishes (quick_add_eval_cases, from eval.js
   --emit-cases); a 'running' row this process is not running was cut off by a restart: it reads
   'interrupted', and start({ resume: id }) runs only the hands it is missing (eval.js --resume). */
function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS quick_add_eval_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT,
    finished_at TEXT,
    options TEXT,
    summary TEXT,
    report TEXT
  )`);
  const cols = new Set((db.exec('PRAGMA table_info(quick_add_eval_runs)')[0] || { values: [] }).values.map((v) => v[1]));
  for (const [c, t] of [['status', 'TEXT'], ['done_cases', 'INTEGER'], ['total_cases', 'INTEGER']]) {
    if (!cols.has(c)) db.run(`ALTER TABLE quick_add_eval_runs ADD COLUMN ${c} ${t}`);
  }
  db.run(`CREATE TABLE IF NOT EXISTS quick_add_eval_cases (
    run_id INTEGER NOT NULL,
    case_id TEXT NOT NULL,
    result TEXT,
    PRIMARY KEY (run_id, case_id)
  )`);
}

const dbOf = () => (deps && deps.getDb ? deps.getDb() : null);
let saveTimer = null;
/* Every kept parse is a write; the database is saved at most every 15 s while a run goes (a restart
   then costs at most that much), and at once when it ends. */
function saveSoon(now = false) {
  if (!deps || !deps.saveDatabase) return;
  if (now) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    Promise.resolve(deps.saveDatabase()).catch(() => {});
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; Promise.resolve(deps.saveDatabase()).catch(() => {}); }, 15000);
  if (saveTimer.unref) saveTimer.unref();
}

/** The current run, as the Admin screen shows it. */
function status() {
  return { ...state, log: state.log.slice(-LOG_MAX) };
}

/* A run's options from a request body → { options, args } or { error }. */
function readOptions(body = {}) {
  const env = process.env;
  const model = String(body.model || env.QUICK_ADD_PARSE_MODEL || 'claude-sonnet-5').trim();
  if (!/^claude-[a-z0-9.-]{2,48}$/.test(model)) return { error: 'model must be a claude-… model id' };
  const effort = String(body.effort != null ? body.effort : (env.QUICK_ADD_EFFORT || '')).trim().toLowerCase();
  if (effort && !OPTIONS.efforts.includes(effort)) return { error: `effort must be one of ${OPTIONS.efforts.filter(Boolean).join(', ')}, or empty` };
  const corpus = String(body.corpus || 'main');
  if (!OPTIONS.corpora[corpus]) return { error: `corpus must be one of ${Object.keys(OPTIONS.corpora).join(', ')}` };
  let sample = null;
  if (body.sample != null && body.sample !== '') {
    sample = Number(body.sample);
    if (!Number.isInteger(sample) || sample < 1 || sample > 1000) return { error: 'sample must be a whole number from 1 to 1000' };
  }
  // Named cases only (a rerun of the hands one run got wrong): the eval's --filter, once per id.
  let cases = null;
  if (body.cases != null && body.cases !== '') {
    cases = (Array.isArray(body.cases) ? body.cases : String(body.cases).split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean);
    if (!cases.length || cases.length > 60 || cases.some((x) => !/^[a-z0-9][a-z0-9-]{2,80}$/.test(x))) return { error: 'cases must be 1 to 60 case ids' };
  }
  const args = ['--model', model, '--effort', effort || 'off', '--concurrency', '3', '--timeout', '200000'];
  if (OPTIONS.corpora[corpus].path) args.push('--corpus', OPTIONS.corpora[corpus].path);
  if (sample) args.push('--sample', String(sample));
  for (const id of cases || []) args.push('--filter', id);
  return { options: { model, effort: effort || null, corpus, sample, ...(cases ? { cases } : {}) }, args };
}

/**
 * Starts a run, resumes an interrupted one (opts.resume = its id), or rescores a finished one from its kept
 * parses (opts.rescore = its id: 409 when they are no longer kept). Returns { started: true, options,
 * runId } or { error, status } (409 while one runs or when the run is not interrupted, 404 for no such run,
 * 503 without a key, 400 for bad options). opts.args replaces the mode (tests pass ['--oracle'], which
 * needs no key and no model); opts.options is the request body (model, effort, corpus, sample). A live run
 * is kept, and so is a test's run with keepRun, when there is a database.
 */
function start({ args = null, env = process.env, onDone = null, options = null, keepRun = false, resume = null, rescore = null } = {}) {
  if (state.running) return { error: 'An eval is already running', status: 409 };
  const live = !args;
  if (live && rescore == null && !env.ANTHROPIC_API_KEY) return { error: 'ANTHROPIC_API_KEY is not set on this server', status: 503 };
  if (!fs.existsSync(EVAL)) return { error: 'test/quick-add/eval.js is not deployed here', status: 503 };
  const db = dbOf();
  let runArgs = args, runOptions = null, runId = null, carried = [], rescored = null;
  if (rescore != null) {
    const prev = db && Number.isInteger(Number(rescore)) ? run(Number(rescore)) : null;
    if (!prev) return { error: 'No such run', status: 404 };
    if (prev.status !== 'done') return { error: 'Only a finished run can be rescored', status: 409 };
    // A rescore of a rescore scores the parses of the run they both came from.
    const src = prev.rescoreOf || prev.id;
    rescored = keptCases(db, src);
    if (!rescored.length) return { error: `Run ${src}'s parses are no longer kept (the newest ${KEEP_CASE_RUNS} runs with parses keep theirs)`, status: 409 };
    const o = prev.options || {};
    runOptions = { model: o.model || null, effort: o.effort || null, corpus: o.corpus || 'main', sample: o.sample || null, ...(o.cases ? { cases: o.cases } : {}), rescoreOf: src };
  } else if (resume != null) {
    const prev = db && Number.isInteger(Number(resume)) ? run(Number(resume)) : null;
    if (!prev) return { error: 'No such run', status: 404 };
    if (prev.status !== 'interrupted') return { error: 'Only an interrupted run can be resumed', status: 409 };
    runOptions = prev.options || {};
    if (live) {
      const o = readOptions({ ...runOptions, effort: runOptions.effort || '' });
      if (o.error) return { error: o.error, status: 400 };
      runArgs = o.args;
    }
    runId = prev.id;
    carried = keptCases(db, runId);
  } else if (live) {
    const o = readOptions(options || {});
    if (o.error) return { error: o.error, status: 400 };
    runArgs = o.args;
    runOptions = o.options;
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-eval-'));
  const extra = [];
  if (rescored) {
    // The kept parses, scored as they were returned: eval.js runs only the cases the file holds.
    const file = path.join(out, `run-${runOptions.rescoreOf}-parses.json`);
    fs.writeFileSync(file, JSON.stringify({ model: runOptions.model, effort: runOptions.effort, cases: rescored }));
    const corpus = OPTIONS.corpora[runOptions.corpus] || OPTIONS.corpora.main;
    runArgs = ['--parses', file, ...(corpus.path ? ['--corpus', corpus.path] : [])];
  }
  if (carried.length) {
    const file = path.join(out, 'resume.json');
    fs.writeFileSync(file, JSON.stringify({ cases: carried }));
    extra.push('--resume', file);
  }
  // Kept from the moment it starts, so a restart leaves a row to resume from.
  if (db && (live || keepRun)) {
    try {
      if (runId) db.run("UPDATE quick_add_eval_runs SET status = 'running' WHERE id = ?", [runId]);
      else {
        db.run("INSERT INTO quick_add_eval_runs (started_at, options, status, done_cases) VALUES (?, ?, 'running', 0)", [new Date().toISOString(), JSON.stringify(runOptions || {})]);
        runId = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]) || null;
      }
      if (runId && !rescored) extra.push('--emit-cases');   // a rescore's parses stay with the run it scores
      saveSoon(true);
    } catch (e) { runId = null; }
  }
  state = { running: true, runId, startedAt: Date.now(), finishedAt: null, exitCode: null, progress: null, log: '', report: null, reportName: null, error: null, options: runOptions, summary: null, resumed: carried.length || 0 };
  const child = spawn(process.execPath, [EVAL, ...runArgs, ...extra, '--verbose', '--out', out], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  // Whole lines only: a kept parse ("@@case {json}") can arrive split across chunks.
  const reader = () => {
    let pending = '';
    return (buf) => {
      const lines = (pending + buf.toString('utf8')).split('\n');
      pending = lines.pop();
      for (const line of lines) take(line);
    };
  };
  const take = (line) => {
    if (line.startsWith('@@case ')) { keepCase(runId, line.slice(7)); return; }
    state.log = (state.log + line + '\n').slice(-LOG_MAX * 2);
    const m = /^\s*(\d+)\/(\d+) \S+\s+recall/.exec(line);   // eval's --verbose per-case lines
    if (m) {
      state.progress = { done: Number(m[1]), total: Number(m[2]) };
      if (runId && db && state.progress.done === 1) { try { db.run('UPDATE quick_add_eval_runs SET total_cases = ? WHERE id = ?', [state.progress.total, runId]); } catch { /* best effort */ } }
    }
  };
  child.stdout.on('data', reader());
  child.stderr.on('data', reader());
  child.on('error', (e) => { state.running = false; state.error = e.message; state.finishedAt = Date.now(); });
  child.on('close', (code) => {
    state.running = false;
    state.exitCode = code;
    state.finishedAt = Date.now();
    try {
      const files = fs.readdirSync(out);
      const md = files.filter((f) => f.endsWith('.md')).sort().pop();
      if (md) { state.report = fs.readFileSync(path.join(out, md), 'utf8'); state.reportName = md; }
      const js = files.filter((f) => f.endsWith('.json') && f !== 'resume.json' && !(f.startsWith('run-') && f.endsWith('-parses.json'))).sort().pop();
      if (js) state.summary = summarize(JSON.parse(fs.readFileSync(path.join(out, js), 'utf8')), runOptions);
    } catch (e) { state.error = e.message; }
    try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* temp dir */ }
    if (runId) finish(runId, state);
    if (onDone) onDone(status());
  });
  return { started: true, runId, ...(runOptions ? { options: runOptions } : {}), ...(carried.length ? { resumed: carried.length } : {}), ...(rescored ? { rescored: rescored.length } : {}) };
}

/* One parse as it finishes (eval.js --emit-cases): kept under its run until the run is done. */
function keepCase(runId, json) {
  const db = dbOf();
  if (!runId || !db) return;
  try {
    const r = JSON.parse(json);
    if (!r || typeof r.id !== 'string') return;
    db.run('INSERT OR REPLACE INTO quick_add_eval_cases (run_id, case_id, result) VALUES (?, ?, ?)', [runId, r.id, json]);
    db.run('UPDATE quick_add_eval_runs SET done_cases = (SELECT COUNT(*) FROM quick_add_eval_cases WHERE run_id = ?) WHERE id = ?', [runId, runId]);
    saveSoon();
  } catch { /* a line that is not a parse: skipped */ }
}

function keptCases(db, runId) {
  try {
    const r = db.exec('SELECT result FROM quick_add_eval_cases WHERE run_id = ?', [runId]);
    return r.length ? r[0].values.map(([s]) => parseJson(s)).filter(Boolean) : [];
  } catch { return []; }
}

/* The figures the Admin table compares, from eval.js's JSON report. */
function summarize(report, options) {
  const a = report.aggregate || {};
  const o = a.overall || {};
  const h = a.halluc || {};
  const c = a.cost || {};
  const meta = report.meta || {};
  // A run with no effort set is passed to eval.js as `--effort off`: stored as null, read as "no thinking".
  const effort = options ? options.effort : meta.options && meta.options.effort;
  return {
    model: (options && options.model) || (meta.options && meta.options.model) || null,
    effort: effort && effort !== 'off' ? effort : null,
    shape: meta.options && meta.options.shape ? meta.options.shape : null,
    corpus: (options && options.corpus) || null,
    sample: (options && options.sample) || null,
    cases: o.cases ?? null,
    recall: o.recall ?? null,
    precision: o.precision ?? null,
    perfect: o.perfect ?? null,
    hallucinatedCards: h.cards ?? null,
    inventedSuits: h.suits ?? null,
    filledSuits: h.filledSuits ?? null,
    hallucinatedStacks: h.stacks ?? null,
    errors: o.errors ?? null,
    gapRecall: a.gaps ? a.gaps.recall : null,
    latencyP50: a.latency ? a.latency.p50 : null,
    latencyP90: a.latency ? a.latency.p90 : null,
    costUsd: c.totalUsd ?? null,
    costPerCase: c.perCaseUsd ?? null,
    outputTokensPerCase: c.outputTokensPerCase ?? null,
    fallbacks: c.fallbacks ?? null,
    git: meta.git || null,
  };
}

/* A run that ended: with a report it is done; without one (the eval failed part-way) it stays resumable.
   Old runs past the newest KEEP_RUNS go, and the parses of done runs past the newest KEEP_CASE_RUNS (an
   interrupted run keeps its own, to be resumed). */
function finish(runId, s) {
  const db = dbOf();
  if (!db) return;
  try {
    if (s.summary) {
      db.run(`UPDATE quick_add_eval_runs SET finished_at = ?, summary = ?, report = ?, status = 'done', done_cases = ?, total_cases = ? WHERE id = ?`, [
        new Date(s.finishedAt).toISOString(), JSON.stringify({ ...s.summary, exitCode: s.exitCode, resumed: s.resumed || 0 }),
        s.report ? s.report.slice(0, 400000) : null, s.summary.cases, s.summary.cases, runId,
      ]);
    } else {
      db.run("UPDATE quick_add_eval_runs SET status = 'interrupted' WHERE id = ?", [runId]);
    }
    db.run(`DELETE FROM quick_add_eval_runs WHERE id <= (SELECT id FROM quick_add_eval_runs ORDER BY id DESC LIMIT 1 OFFSET ${KEEP_RUNS})`);
    db.run('DELETE FROM quick_add_eval_cases WHERE run_id NOT IN (SELECT id FROM quick_add_eval_runs)');
    // The newest runs that HAVE parses keep them: a rescore keeps none, and must not push a paid run's out.
    db.run(`DELETE FROM quick_add_eval_cases WHERE run_id NOT IN (SELECT DISTINCT run_id FROM quick_add_eval_cases ORDER BY run_id DESC LIMIT ${KEEP_CASE_RUNS})
      AND run_id NOT IN (SELECT id FROM quick_add_eval_runs WHERE status IN ('running', 'interrupted'))`);
    saveSoon(true);
  } catch (e) {
    state.error = 'The run finished but could not be kept: ' + e.message;
  }
}

const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/* A kept run's state: a 'running' row this process is not running was cut off by a restart. A row from
   before runs were kept from their start has no status: it is done. */
function runStatus(id, stored) {
  if (stored === 'running') return state.running && state.runId === id ? 'running' : 'interrupted';
  return stored || 'done';
}
function runRow(v) {
  const [id, startedAt, finishedAt, options, summary, status, doneCases, totalCases] = v;
  const o = parseJson(options) || {};
  return {
    id, startedAt, finishedAt, status: runStatus(id, status), doneCases, totalCases,
    model: o.model || null, effort: o.effort || null, corpus: o.corpus || null, sample: o.sample || null,
    rescoreOf: o.rescoreOf || null,
    ...(parseJson(summary) || {}),
  };
}

/** The kept runs, newest first, without their reports: done, running and interrupted. */
function runs() {
  const db = dbOf();
  if (!db) return [];
  try {
    const r = db.exec('SELECT id, started_at, finished_at, options, summary, status, done_cases, total_cases FROM quick_add_eval_runs ORDER BY id DESC LIMIT ' + KEEP_RUNS);
    // How many parses each run still keeps: a finished run with some can be rescored.
    const k = db.exec('SELECT run_id, COUNT(*) FROM quick_add_eval_cases GROUP BY run_id');
    const kept = new Map(k.length ? k[0].values : []);
    return r.length ? r[0].values.map((v) => ({ ...runRow(v), keptCases: kept.get(v[0]) || 0 })) : [];
  } catch { return []; }
}

/** One kept run with its report and options. */
function run(id) {
  const db = dbOf();
  if (!db || !Number.isInteger(id)) return null;
  try {
    const r = db.exec('SELECT id, started_at, finished_at, options, summary, status, done_cases, total_cases, report FROM quick_add_eval_runs WHERE id = ?', [id]);
    if (!r.length || !r[0].values.length) return null;
    const v = r[0].values[0];
    return { ...runRow(v.slice(0, 8)), options: parseJson(v[3]), report: v[8] };
  } catch { return null; }
}

/** A kept run's parses, one line each: the case, whether it failed, and what the parse holds. */
function runCases(id) {
  const db = dbOf();
  if (!db || !Number.isInteger(id)) return null;
  return keptCases(db, id).map((c) => {
    const h = c.hand && typeof c.hand === 'object' ? c.hand : null;
    const streets = h && Array.isArray(h.streets) ? h.streets : [];
    return {
      id: c.id, error: c.error || null, gameType: (h && h.gameType) || null,
      players: h && Array.isArray(h.players) ? h.players.length : 0,
      actions: streets.reduce((n, st) => n + (Array.isArray(st.actions) ? st.actions.length : 0), 0),
      model: (c.meta && (c.meta.servedBy || c.meta.model)) || null, calls: (c.meta && c.meta.calls) || null,
      outputTokens: (c.usage && c.usage.output_tokens) || null, latencyMs: c.latencyMs ?? null,
    };
  });
}
/** One kept parse in full: the hand, its notes, the error, usage and meta. */
function runCase(id, caseId) {
  const db = dbOf();
  if (!db || !Number.isInteger(id)) return null;
  return keptCases(db, id).find((c) => c.id === caseId) || null;
}

module.exports = { init, migrate, start, status, runs, run, runCases, runCase, readOptions, summarize, estimates, OPTIONS };
