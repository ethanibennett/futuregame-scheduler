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
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVAL = path.join(ROOT, 'test', 'quick-add', 'eval.js');
const LOG_MAX = 6000;
const KEEP_RUNS = 40;

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

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS quick_add_eval_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT,
    finished_at TEXT,
    options TEXT,
    summary TEXT,
    report TEXT
  )`);
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
  const args = ['--model', model, '--effort', effort || 'off', '--concurrency', '3', '--timeout', '200000'];
  if (OPTIONS.corpora[corpus].path) args.push('--corpus', OPTIONS.corpora[corpus].path);
  if (sample) args.push('--sample', String(sample));
  return { options: { model, effort: effort || null, corpus, sample }, args };
}

/**
 * Starts a run. Returns { started: true, options } or { error, status } (409 while one runs, 503 without a
 * key, 400 for bad options). opts.args replaces the mode (tests pass ['--oracle'], which needs no key and
 * no model); opts.options is the request body (model, effort, corpus, sample).
 */
function start({ args = null, env = process.env, onDone = null, options = null, keepRun = false } = {}) {
  if (state.running) return { error: 'An eval is already running', status: 409 };
  const live = !args;
  if (live && !env.ANTHROPIC_API_KEY) return { error: 'ANTHROPIC_API_KEY is not set on this server', status: 503 };
  if (!fs.existsSync(EVAL)) return { error: 'test/quick-add/eval.js is not deployed here', status: 503 };
  let runArgs = args, runOptions = null;
  if (live) {
    const o = readOptions(options || {});
    if (o.error) return { error: o.error, status: 400 };
    runArgs = o.args;
    runOptions = o.options;
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-eval-'));
  state = { running: true, startedAt: Date.now(), finishedAt: null, exitCode: null, progress: null, log: '', report: null, reportName: null, error: null, options: runOptions, summary: null };
  const child = spawn(process.execPath, [EVAL, ...runArgs, '--verbose', '--out', out], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const take = (buf) => {
    const text = buf.toString('utf8');
    state.log = (state.log + text).slice(-LOG_MAX * 2);
    const m = text.match(/^\s*\d+\/\d+ \S+\s+recall/gm);   // eval's --verbose per-case lines
    if (m) { const last = m[m.length - 1].match(/(\d+)\/(\d+)/); state.progress = { done: Number(last[1]), total: Number(last[2]) }; }
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  child.on('error', (e) => { state.running = false; state.error = e.message; state.finishedAt = Date.now(); });
  child.on('close', (code) => {
    state.running = false;
    state.exitCode = code;
    state.finishedAt = Date.now();
    try {
      const files = fs.readdirSync(out);
      const md = files.filter((f) => f.endsWith('.md')).sort().pop();
      if (md) { state.report = fs.readFileSync(path.join(out, md), 'utf8'); state.reportName = md; }
      const js = files.filter((f) => f.endsWith('.json')).sort().pop();
      if (js) state.summary = summarize(JSON.parse(fs.readFileSync(path.join(out, js), 'utf8')), runOptions);
    } catch (e) { state.error = e.message; }
    try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* temp dir */ }
    if (state.summary && (live || keepRun)) keep(state);
    if (onDone) onDone(status());
  });
  return { started: true, ...(runOptions ? { options: runOptions } : {}) };
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

function keep(s) {
  if (!deps || !deps.getDb) return;
  try {
    const db = deps.getDb();
    if (!db) return;
    db.run('INSERT INTO quick_add_eval_runs (started_at, finished_at, options, summary, report) VALUES (?, ?, ?, ?, ?)', [
      new Date(s.startedAt).toISOString(), new Date(s.finishedAt).toISOString(), JSON.stringify(s.options || {}),
      JSON.stringify({ ...s.summary, exitCode: s.exitCode }), s.report ? s.report.slice(0, 400000) : null,
    ]);
    db.run(`DELETE FROM quick_add_eval_runs WHERE id <= (SELECT id FROM quick_add_eval_runs ORDER BY id DESC LIMIT 1 OFFSET ${KEEP_RUNS})`);
    if (deps.saveDatabase) Promise.resolve(deps.saveDatabase()).catch(() => {});
  } catch (e) {
    state.error = 'The run finished but could not be kept: ' + e.message;
  }
}

const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** The kept runs, newest first, without their reports. */
function runs() {
  const db = deps && deps.getDb ? deps.getDb() : null;
  if (!db) return [];
  try {
    const r = db.exec('SELECT id, started_at, finished_at, summary FROM quick_add_eval_runs ORDER BY id DESC LIMIT ' + KEEP_RUNS);
    if (!r.length) return [];
    return r[0].values.map(([id, startedAt, finishedAt, summary]) => ({ id, startedAt, finishedAt, ...(parseJson(summary) || {}) }));
  } catch { return []; }
}

/** One kept run with its report. */
function run(id) {
  const db = deps && deps.getDb ? deps.getDb() : null;
  if (!db || !Number.isInteger(id)) return null;
  try {
    const r = db.exec('SELECT id, started_at, finished_at, options, summary, report FROM quick_add_eval_runs WHERE id = ?', [id]);
    if (!r.length || !r[0].values.length) return null;
    const [rid, startedAt, finishedAt, options, summary, report] = r[0].values[0];
    return { id: rid, startedAt, finishedAt, options: parseJson(options), ...(parseJson(summary) || {}), report };
  } catch { return null; }
}

module.exports = { init, migrate, start, status, runs, run, readOptions, summarize, estimates, OPTIONS };
