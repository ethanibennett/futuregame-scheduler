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
      {!s || (!s.running && !s.report) ? (
        <p className="an-p">The corpus of real hands through the live model, scored. Decides whether quick add opens to everyone.</p>
      ) : null}
      {s && s.running && (
        <p className="an-p">Running{s.progress ? `: ${s.progress.done} of ${s.progress.total} hands` : ''}. This page checks every 5 seconds.</p>
      )}
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
        <button type="button" className="parser-eval-btn ctl" onClick={() => setConfirming(true)}>Run the parser eval</button>
      ))}
    </section>
  );
}
