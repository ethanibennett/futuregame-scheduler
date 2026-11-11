import React, { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../utils/api.js';
import './analytics.css';

/*
 * Run the hand parser's live eval from the Admin screen (2026-10-15): the server runs
 * test/quick-add/eval.js with its own ANTHROPIC_API_KEY (lib/admin-eval.js), so no terminal and no
 * token are needed. It decides launch plan action 2: quick add opens to everyone only if this passes.
 */
export default function ParserEval({ token }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const load = useCallback(() => fetch(`${API_URL}/admin/quick-add-eval`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setS(d); }).catch(() => {}), [token]);
  useEffect(() => { load(); }, [load]);
  // Tell the app a run is going, so its Admin row and the rail can show how far (UX pick 111).
  useEffect(() => {
    if (!s) return;
    const pct = s.running && s.progress && s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : 0;
    window.dispatchEvent(new CustomEvent('fg:eval', { detail: { running: !!s.running, pct } }));
  }, [s]);
  useEffect(() => {
    if (!s || !s.running) return undefined;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [s, load]);
  const run = async () => {
    setConfirming(false); setError('');
    const r = await fetch(`${API_URL}/admin/quick-add-eval`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.error || 'Could not start the eval'); return; }
    setS(d);
  };
  const summary = s && s.report ? s.report.split('\n').filter((l) => /recall|precision|halluc|cases/i.test(l)).slice(0, 6) : [];
  return (
    <section className="parser-eval" aria-label="Hand parser eval">
      <h3 className="an-cell an-sec">Hand parser, live eval</h3>
      {/* A run that stopped without a report says so (App improvements 440): it read exactly like one never run. */}
      {s && !s.running && !s.report && (s.exitCode || s.error) ? (() => {
        const p = s.progress || null;
        const when = s.finishedAt ? new Date(s.finishedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
        const lastErr = String(s.error || s.log || '').split(String.fromCharCode(10)).filter((l) => /error/i.test(l)).pop() || (s.error ? String(s.error) : '');
        return (
          <>
            <p className="an-p" role="status">The last run stopped{p && p.total ? ` at ${p.done} of ${p.total} hands` : ''}{when ? `, ${when}` : ''}{s.exitCode ? ` (exit code ${s.exitCode})` : ''}. Nothing was scored.</p>
            {lastErr && <p className="an-p parser-eval-err">{lastErr.slice(0, 300)}</p>}
          </>
        );
      })() : !s || (!s.running && !s.report) ? (
        <p className="an-p">The corpus of real hands through the live model, scored. Decides whether quick add opens to everyone.</p>
      ) : null}
      {s && s.running && (() => {
        /* How far it has got (UX pick 111, Goal-Gradient): a 35g x 1r bar and the time left at the rate
           so far, and that the page can be left. */
        const p = s.progress || null;
        const frac = p && p.total ? Math.min(1, p.done / p.total) : 0;
        const ms = p && p.done > 0 && s.startedAt ? ((Date.now() - s.startedAt) / p.done) * (p.total - p.done) : null;
        const left = ms == null ? '' : ms < 90e3 ? ' \u00b7 about a minute left' : ` \u00b7 about ${Math.round(ms / 60e3)} min left`;
        return (
          <>
            <div className="parser-eval-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
              <div className="parser-eval-fill" style={{ width: (frac * 100).toFixed(1) + '%' }} />
            </div>
            <p className="an-p">{p ? `${p.done} of ${p.total} hands${left}.` : 'Starting.'} You can leave this page.</p>
          </>
        );
      })()}
      {s && !s.running && s.report && (
        <>
          <p className="an-p">Last run {new Date(s.finishedAt).toLocaleString()}{s.exitCode ? ' (finished with errors)' : ''}.</p>
          {summary.map((l, i) => <p key={i} className="an-p parser-eval-line">{l.replace(/[|*`]/g, ' ').replace(/\s+/g, ' ').trim()}</p>)}
          <details className="parser-eval-report"><summary className="an-p">The full report</summary><pre>{s.report}</pre></details>
        </>
      )}
      {error && <p className="an-p" role="alert">{error}</p>}
      {!(s && s.running) && (confirming ? (
        <div className="parser-eval-actions">
          <p className="an-p">About 270 model calls on the server's key, roughly $5 to $15, and 45 minutes. Start?</p>
          <button type="button" className="parser-eval-btn ctl is-primary" onClick={run}>Start the eval</button>
          <button type="button" className="parser-eval-btn ctl" onClick={() => setConfirming(false)}>Not now</button>
        </div>
      ) : (
        <button type="button" className="parser-eval-btn ctl" onClick={() => setConfirming(true)}>{s && !s.running && !s.report && (s.exitCode || s.error) ? 'Run it again' : 'Run the parser eval'}</button>
      ))}
    </section>
  );
}
