import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL } from '../utils/api.js';
import QuickAddLog from './QuickAddLog.jsx';
import './analytics.css';
import './quick-add-admin.css';

/*
 * Run the hand parser's live eval from the Admin screen (2026-10-15): the server runs
 * test/quick-add/eval.js with its own ANTHROPIC_API_KEY (lib/admin-eval.js), so no terminal and no
 * token are needed. It decides launch plan action 2: quick add opens to everyone only if this passes.
 *
 * Each run picks its model, thinking effort, corpus and size (2026-11-21), and every finished run is kept
 * on the server, so the baseline and each candidate read side by side: recall, precision, perfect
 * parses, hallucinated cards, cost per hand and the slow end of latency. The runs to make, and what each
 * costs: docs/quick-add-model-runs.md. The parse log (what players really typed, and what they fixed
 * before saving) is under it.
 */

const MODEL_NAMES = {
  'claude-sonnet-5': 'Sonnet 5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5', 'claude-opus-5': 'Opus 5',
  'claude-haiku-5-5': 'Haiku 5.5', 'claude-haiku-4-5-20251001': 'Haiku 4.5', 'claude-fable-5-2': 'Fable 5.2',
};
export const modelName = (m) => MODEL_NAMES[m] || String(m || '?').replace(/^claude-/, '');
// The models that only take the thinking request (prompt.js NO_FORCED_TOOL): no effort means medium there.
const THINKING_ONLY = /^claude-(?:opus-5-5|sonnet-5-5|fable-5-[12])/;
// No effort set: '' in the form, null in a kept run, 'off' in a run kept before 2026-11-21's fix.
const effortOf = (e) => (e && e !== 'off' ? e : '');
function effortLabel(model, effort) {
  if (effortOf(effort)) return effort;
  return THINKING_ONLY.test(model || '') ? 'medium' : 'no thinking';
}
const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
const usd = (x, d = 3) => (x == null ? '—' : '$' + Number(x).toFixed(d));
const secs = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's');
const when = (t) => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function ParserEval({ token }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [runs, setRuns] = useState([]);
  const [opts, setOpts] = useState(null);
  const [estimates, setEstimates] = useState({});
  const [pick, setPick] = useState({ model: 'claude-sonnet-5', effort: '', corpus: 'main', sample: '' });
  const [openRun, setOpenRun] = useState(null);
  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const load = useCallback(() => fetch(`${API_URL}/admin/quick-add-eval`, { headers: auth })
    .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setS(d); }).catch(() => {}), [auth]);
  const loadRuns = useCallback(() => fetch(`${API_URL}/admin/quick-add-eval/runs`, { headers: auth })
    .then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setRuns(d.runs || []); setOpts(d.options || null); setEstimates(d.estimates || {});
    }).catch(() => {}), [auth]);
  useEffect(() => { load(); loadRuns(); }, [load, loadRuns]);
  // Tell the app a run is going, so its Admin row and the rail can show how far (UX pick 111).
  useEffect(() => {
    if (!s) return;
    const p = s.running && s.progress && s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : 0;
    window.dispatchEvent(new CustomEvent('fg:eval', { detail: { running: !!s.running, pct: p } }));
  }, [s]);
  useEffect(() => {
    if (!s || !s.running) return undefined;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [s, load]);
  // A run that just finished joins the table.
  const running = !!(s && s.running);
  useEffect(() => { if (!running) loadRuns(); }, [running, loadRuns]);

  const corpusCases = opts && opts.corpora && opts.corpora[pick.corpus] ? opts.corpora[pick.corpus].cases : 266;
  const hands = pick.sample ? Math.min(Number(pick.sample), corpusCases) : corpusCases;
  // Finished runs have figures; a run a restart cut off (2026-11-21) is listed and can be resumed.
  const doneRuns = runs.filter((r) => !r.status || r.status === 'done');
  const interrupted = running ? null : runs.find((r) => r.status === 'interrupted') || null;
  // A measured cost per hand for this model and effort, else the server's rough estimate.
  const perHandFor = (model, effort) => {
    const m = doneRuns.find((r) => r.model === model && effortOf(r.effort) === effortOf(effort) && r.costPerCase != null);
    return { usd: m ? m.costPerCase : (estimates[model] || {})[effortOf(effort)], measured: !!m };
  };
  const { usd: perHand, measured } = perHandFor(pick.model, pick.effort);
  const cost = perHand == null ? null : perHand * hands;

  const post = async (body) => {
    setConfirming(false); setError('');
    const r = await fetch(`${API_URL}/admin/quick-add-eval`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.error || 'Could not start the eval'); return; }
    setS(d);
    loadRuns();
  };
  const run = () => post({ model: pick.model, effort: pick.effort, corpus: pick.corpus, sample: pick.sample || null });
  const resume = () => post({ resume: interrupted.id });
  const showRun = async (id) => {
    if (!id) { setOpenRun(null); return; }
    const r = await fetch(`${API_URL}/admin/quick-add-eval/runs/${id}`, { headers: auth }).catch(() => null);
    const d = r && r.ok ? await r.json().catch(() => null) : null;
    setOpenRun(d);
  };
  const runName = (r) => `${modelName(r.model)} ${effortLabel(r.model, r.effort)}${r.corpus === 'shorthand' ? ' · sh' : ''}${r.sample ? ` · ${r.cases || r.totalCases || r.sample}` : ''}`;
  // The table is loaded when a run starts and ends; the run going now takes its count from the 5 s status poll.
  const progressOf = (r) => {
    const live = s && s.running && s.runId === r.id && s.progress ? s.progress : null;
    const done = Math.max(r.doneCases || 0, live ? live.done || 0 : 0);
    const total = r.totalCases || (live ? live.total : null);
    return `${done}${total ? ` of ${total}` : ''} hands`;
  };
  const set = (k) => (e) => { setConfirming(false); setPick((p) => ({ ...p, [k]: e.target.value })); };
  const summary = s && s.report ? s.report.split('\n').filter((l) => /recall|precision|halluc|cases|cost/i.test(l)).slice(0, 7) : [];

  return (
    <>
      <section className="parser-eval" aria-label="Hand parser eval">
        <h3 className="an-cell an-sec">Hand parser, live eval</h3>
        {/* A run that stopped without a report says so (App improvements 440): it read exactly like one never run. */}
        {s && !s.running && !s.report && (s.exitCode || s.error) ? (() => {
          const p = s.progress || null;
          const lastErr = String(s.error || s.log || '').split(String.fromCharCode(10)).filter((l) => /error/i.test(l)).pop() || (s.error ? String(s.error) : '');
          return (
            <>
              <p className="an-p" role="status">The last run stopped{p && p.total ? ` at ${p.done} of ${p.total} hands` : ''}{s.finishedAt ? `, ${when(s.finishedAt)}` : ''}{s.exitCode ? ` (exit code ${s.exitCode})` : ''}. Nothing was scored.</p>
              {lastErr && <p className="an-p parser-eval-err">{lastErr.slice(0, 300)}</p>}
            </>
          );
        })() : !s || (!s.running && !s.report) ? (
          <p className="an-p">The corpus of real hands through the live model, scored. Decides whether quick add opens to everyone. Pick the model and effort to measure; each finished run joins the table below.</p>
        ) : null}
        {s && s.running && (() => {
          /* How far it has got (UX pick 111, Goal-Gradient): a 35g x 1r bar and the time left at the rate
             so far, and that the page can be left. */
          const p = s.progress || null;
          const frac = p && p.total ? Math.min(1, p.done / p.total) : 0;
          const ms = p && p.done > 0 && s.startedAt ? ((Date.now() - s.startedAt) / p.done) * (p.total - p.done) : null;
          const left = ms == null ? '' : ms < 90e3 ? ' · about a minute left' : ` · about ${Math.round(ms / 60e3)} min left`;
          const o = s.options;
          return (
            <>
              <div className="parser-eval-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
                <div className="parser-eval-fill" style={{ width: (frac * 100).toFixed(1) + '%' }} />
              </div>
              <p className="an-p">{o ? `${modelName(o.model)}, ${effortLabel(o.model, o.effort)}: ` : ''}{p ? `${p.done} of ${p.total} hands${left}.` : 'Starting.'} You can leave this page.</p>
            </>
          );
        })()}
        {s && !s.running && s.report && (
          <>
            <p className="an-p">Last run {new Date(s.finishedAt).toLocaleString()}{s.options ? ` (${modelName(s.options.model)}, ${effortLabel(s.options.model, s.options.effort)})` : ''}{s.exitCode ? ', finished with errors' : ''}.</p>
            {summary.map((l, i) => <p key={i} className="an-p parser-eval-line">{l.replace(/[|*`]/g, ' ').replace(/\s+/g, ' ').trim()}</p>)}
            <details className="parser-eval-report"><summary className="an-p">The full report</summary><pre>{s.report}</pre></details>
          </>
        )}

        {runs.length > 0 && (
          <>
            <div className="an-table qa-table" role="table" aria-label="Eval runs side by side">
              <div className="an-row is-head qa-runs-cols" role="row">
                {['Run', 'Recall', 'Prec.', 'Perfect', 'Cards', '$/hand', 'p90'].map((h, i) => (
                  <span key={h} role="columnheader" className={'an-cell an-lbl an-lbl-3b' + (i ? ' an-num' : '')}>{h}</span>
                ))}
              </div>
              {runs.map((r) => (r.status && r.status !== 'done' ? (
                <div key={r.id} className="an-row is-body qa-runs-cols is-small" role="row">
                  <span role="cell" className="an-cell an-td an-clip">{runName(r)}</span>
                  <span role="cell" className="an-cell an-td an-clip qa-span-rest">{r.status === 'running' ? `running: ${progressOf(r)} kept` : `interrupted at ${progressOf(r)}: resume below`}</span>
                </div>
              ) : (
                <div key={r.id} className="an-row is-body qa-runs-cols" role="row">
                  <span role="cell" className="an-cell an-td an-clip">{runName(r)}</span>
                  <span role="cell" className="an-cell an-td an-num">{pct(r.recall)}</span>
                  <span role="cell" className="an-cell an-td an-num">{pct(r.precision)}</span>
                  <span role="cell" className="an-cell an-td an-num">{r.perfect ?? '—'}</span>
                  <span role="cell" className={'an-cell an-td an-num' + (r.hallucinatedCards ? ' an-neg' : '')}>{r.hallucinatedCards ?? '—'}</span>
                  <span role="cell" className="an-cell an-td an-num">{usd(r.costPerCase)}</span>
                  <span role="cell" className="an-cell an-td an-num">{secs(r.latencyP90)}</span>
                </div>
              )))}
            </div>
            <div className="qa-eval-opts">
              <label className="qa-eval-field"><span className="an-cell an-lbl an-lbl-2">A run in full</span>
                <select className="qa-eval-select" value={openRun ? String(openRun.id) : ''} onChange={(e) => showRun(Number(e.target.value) || null)}>
                  <option value="">Pick a run</option>
                  {doneRuns.map((r) => <option key={r.id} value={String(r.id)}>{runName(r)}, {when(r.finishedAt)}</option>)}
                </select>
              </label>
            </div>
            {openRun && (
              <div className="qa-detail">
                <p className="an-p">{runName(openRun)}, {when(openRun.startedAt)} to {when(openRun.finishedAt)}: {openRun.cases} hands, {openRun.perfect} perfect, recall {pct(openRun.recall)}, precision {pct(openRun.precision)}, {openRun.hallucinatedCards} hallucinated cards, {openRun.inventedSuits ?? 0} invented suits, {openRun.hallucinatedStacks ?? 0} invented stacks, {openRun.errors ?? 0} errors. Latency p50 {secs(openRun.latencyP50)}, p90 {secs(openRun.latencyP90)}. Cost {usd(openRun.costUsd, 2)} ({usd(openRun.costPerCase, 4)} a hand, {openRun.outputTokensPerCase ?? '—'} output tokens a parse){openRun.fallbacks ? `, ${openRun.fallbacks} served by a fallback model` : ''}.{openRun.git ? ` Commit ${openRun.git}.` : ''}</p>
                <details className="parser-eval-report"><summary className="an-p">The full report</summary><pre>{openRun.report || 'No report kept.'}</pre></details>
              </div>
            )}
          </>
        )}

        {error && <p className="an-p" role="alert">{error}</p>}
        {interrupted && (() => {
          // A restart cut this run off: resuming parses only the hands it had not kept.
          const left = interrupted.totalCases ? Math.max(0, interrupted.totalCases - (interrupted.doneCases || 0)) : null;
          const ph = perHandFor(interrupted.model, interrupted.effort).usd;
          return (
            <div className="parser-eval-actions qa-resume">
              <p className="an-p" role="status">{runName(interrupted)} was interrupted at {progressOf(interrupted)} (the server restarted). Resume parses only the {left != null ? `${left} left` : 'hands it did not keep'}{left != null && ph != null ? `, about $${(left * ph).toFixed(2)}` : ''}.</p>
              <button type="button" className="parser-eval-btn ctl is-primary" onClick={resume}>Resume the run</button>
            </div>
          );
        })()}
        {!running && (
          <>
            <div className="qa-eval-opts">
              <label className="qa-eval-field"><span className="an-cell an-lbl an-lbl-2">Model</span>
                <select className="qa-eval-select" value={pick.model} onChange={set('model')}>
                  {((opts && opts.models) || ['claude-sonnet-5']).map((m) => <option key={m} value={m}>{modelName(m)}</option>)}
                </select>
              </label>
              <label className="qa-eval-field"><span className="an-cell an-lbl an-lbl-2">Thinking effort</span>
                <select className="qa-eval-select" value={pick.effort} onChange={set('effort')}>
                  {((opts && opts.efforts) || ['']).map((e) => <option key={e || 'none'} value={e}>{e || (THINKING_ONLY.test(pick.model) ? 'Default (medium)' : 'None (today’s request)')}</option>)}
                </select>
              </label>
              <label className="qa-eval-field"><span className="an-cell an-lbl an-lbl-2">Hands</span>
                <select className="qa-eval-select" value={pick.corpus} onChange={set('corpus')}>
                  {Object.entries((opts && opts.corpora) || { main: { label: '266 corpus hands' } }).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
                </select>
              </label>
              <label className="qa-eval-field"><span className="an-cell an-lbl an-lbl-2">Size</span>
                <select className="qa-eval-select" value={pick.sample} onChange={set('sample')}>
                  <option value="">Every hand</option>
                  <option value="40">A 40-hand pilot</option>
                  <option value="100">100 hands</option>
                </select>
              </label>
            </div>
            {confirming ? (
              <div className="parser-eval-actions">
                <p className="an-p">{modelName(pick.model)}, {effortLabel(pick.model, pick.effort)}: {hands} hands on the server's key{cost != null ? `, about $${cost < 10 ? cost.toFixed(2) : Math.round(cost)} (${measured ? 'measured on an earlier run' : 'a rough estimate: run a pilot to measure it'})` : ''}, three at a time. Start?</p>
                <button type="button" className="parser-eval-btn ctl is-primary" onClick={run}>Start the eval</button>
                <button type="button" className="parser-eval-btn ctl" onClick={() => setConfirming(false)}>Not now</button>
              </div>
            ) : (
              <button type="button" className="parser-eval-btn ctl" onClick={() => setConfirming(true)}>{s && !s.running && !s.report && (s.exitCode || s.error) ? 'Run it again' : 'Run the parser eval'}</button>
            )}
          </>
        )}
      </section>
      <QuickAddLog token={token} />
    </>
  );
}
