'use strict';
/*
 * The hand parser's live eval, started from the Admin screen (2026-10-15). The launch plan opens quick
 * add to everyone only if test/quick-add/eval.js passes against the REAL model, and only the server has
 * the key (ANTHROPIC_API_KEY, the Table Scanner's). So the server runs the eval itself, in the
 * background, one run at a time: `node test/quick-add/eval.js --out <dir>` in its default mode, which
 * calls lib/quick-add.js directly with that key. About 90 model calls a run. The report it writes
 * (Markdown) is kept in memory and served to admins. Nothing here is reachable by anyone else.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVAL = path.join(ROOT, 'test', 'quick-add', 'eval.js');
const LOG_MAX = 6000;

let state = { running: false, startedAt: null, finishedAt: null, exitCode: null, progress: null, log: '', report: null, reportName: null, error: null };

/** The current run, as the Admin screen shows it. */
function status() {
  return { ...state, log: state.log.slice(-LOG_MAX) };
}

/**
 * Starts a run. Returns { started: true } or { error, status } (409 while one runs, 503 without a key).
 * opts.args replaces the mode (tests pass ['--oracle'], which needs no key and no model).
 */
function start({ args = null, env = process.env, onDone = null } = {}) {
  if (state.running) return { error: 'An eval is already running', status: 409 };
  const live = !args;
  if (live && !env.ANTHROPIC_API_KEY) return { error: 'ANTHROPIC_API_KEY is not set on this server', status: 503 };
  if (!fs.existsSync(EVAL)) return { error: 'test/quick-add/eval.js is not deployed here', status: 503 };
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-eval-'));
  state = { running: true, startedAt: Date.now(), finishedAt: null, exitCode: null, progress: null, log: '', report: null, reportName: null, error: null };
  const child = spawn(process.execPath, [EVAL, ...(args || []), '--verbose', '--out', out], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
      const md = fs.readdirSync(out).filter((f) => f.endsWith('.md')).sort().pop();
      if (md) { state.report = fs.readFileSync(path.join(out, md), 'utf8'); state.reportName = md; }
    } catch (e) { state.error = e.message; }
    try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* temp dir */ }
    if (onDone) onDone(status());
  });
  return { started: true };
}

module.exports = { start, status };
