import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL } from '../utils/api.js';
import './analytics.css';
import './quick-add-admin.css';

/*
 * Admin › Quick add log (2026-11-21; lib/quick-add/learn.js): every parse the server ran, newest first,
 * and, for each hand the player saved, what they changed before saving it. That difference is the parser's
 * error on real use. The saved hands download as draft corpus cases (test/quick-add/README.md format) to
 * paraphrase and add to the eval: the raw text never goes in the public repo.
 */

const when = (t) => (t ? new Date(t.replace(' ', 'T') + (t.endsWith('Z') ? '' : 'Z')).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const short = (t) => (t ? new Date(t.replace(' ', 'T') + (t.endsWith('Z') ? '' : 'Z')).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
function outcome(p) {
  if (p.status !== 200) return `failed (${p.status})`;
  if (!p.saved) return 'not saved';
  const fixes = p.changed + p.dropped;
  if (!fixes && !p.filled) return 'saved as parsed';
  return [fixes ? `${fixes} fixed` : '', p.filled ? `${p.filled} added` : ''].filter(Boolean).join(' · ');
}
const fmt = (v) => (v == null ? 'empty' : typeof v === 'string' ? v : JSON.stringify(v));

export default function QuickAddLog({ token }) {
  const [data, setData] = useState(null);
  const [refused, setRefused] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const load = useCallback(() => fetch(`${API_URL}/quick-add/log?limit=50${savedOnly ? '&saved=1' : ''}`, { headers: auth })
    .then((r) => { if (r.status === 403 || r.status === 404) { setRefused(true); return null; } return r.ok ? r.json() : null; })
    .then((d) => { if (d) setData(d); }).catch(() => {}), [auth, savedOnly]);
  useEffect(() => { load(); }, [load]);
  if (refused) return null; // not an app admin, or a server without the log

  const show = async (id) => {
    if (!id) { setOpen(null); return; }
    const r = await fetch(`${API_URL}/quick-add/log/${id}`, { headers: auth }).catch(() => null);
    setOpen(r && r.ok ? await r.json().catch(() => null) : null);
  };
  const download = async () => {
    setNote('');
    const r = await fetch(`${API_URL}/quick-add/log/export?limit=200`, { headers: auth }).catch(() => null);
    const d = r && r.ok ? await r.json().catch(() => null) : null;
    if (!d) { setNote('Could not export the log.'); return; }
    if (!d.cases.length) { setNote('No saved hands to export yet.'); return; }
    const blob = new Blob([JSON.stringify(d.cases, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `quick-add-live-cases-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setNote(`${d.cases.length} case${d.cases.length === 1 ? '' : 's'} downloaded${d.skipped.length ? `, ${d.skipped.length} left out (no game to file them under)` : ''}. They hold the RAW text: paraphrase each before it goes in the public corpus, then check them with eval.js --dry-run.`);
  };

  const s = data && data.summary;
  const parses = (data && data.parses) || [];
  return (
    <section className="parser-eval" aria-label="Quick add log">
      <h3 className="an-cell an-sec">Quick add log</h3>
      <p className="an-p">
        {s ? <>{s.parses} parse{s.parses === 1 ? '' : 's'} kept, {s.saved} saved ({s.savedUnchanged} as parsed), {s.failed} failed{s.costUsd ? `, $${s.costUsd.toFixed(2)} at list price` : ''}. </> : null}
        What players typed or said, and what they fixed before saving: the parser's error on real hands.
      </p>
      {parses.length > 0 && (
        <div className="an-table qa-table" role="table" aria-label="Recent parses">
          <div className="an-row is-head qa-log-cols" role="row">
            {['When', 'Description', 'Outcome'].map((h) => <span key={h} role="columnheader" className="an-cell an-lbl an-lbl-3b">{h}</span>)}
          </div>
          {parses.map((p) => (
            <div key={p.id} className={'an-row is-body qa-log-cols' + (p.saved || p.status !== 200 ? '' : ' is-small')} role="row">
              <span role="cell" className="an-cell an-td">{short(p.at)}</span>
              <span role="cell" className="an-cell an-td an-clip" title={`${p.source}, ${p.chars} characters · ${p.model || ''}${p.effort ? ' at ' + p.effort : ''} · ${p.ms ?? '?'} ms${p.costUsd != null ? ' · $' + p.costUsd.toFixed(4) : ''}`}>{p.fastPath ? '[history] ' : ''}{p.preview}</span>
              <span role="cell" className={'an-cell an-td an-clip' + (p.status !== 200 ? ' an-neg' : '')}>{outcome(p)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="qa-eval-opts">
        {parses.length > 0 && (
          <label className="qa-eval-field"><span className="an-cell an-lbl an-lbl-2">A parse in full</span>
            <select className="qa-eval-select" value={open ? String(open.id) : ''} onChange={(e) => show(Number(e.target.value) || null)}>
              <option value="">Pick a parse</option>
              {parses.map((p) => <option key={p.id} value={String(p.id)}>{short(p.at)} {p.user || ''}: {outcome(p)}</option>)}
            </select>
          </label>
        )}
        <label className="qa-eval-field"><span className="an-cell an-lbl an-lbl-2">Show</span>
          <select className="qa-eval-select" value={savedOnly ? 'saved' : 'all'} onChange={(e) => { setOpen(null); setSavedOnly(e.target.value === 'saved'); }}>
            <option value="all">Every parse</option>
            <option value="saved">Saved hands only</option>
          </select>
        </label>
      </div>
      {open && (
        <div className="qa-detail">
          <p className="an-p">{when(open.at)}, {open.user || 'unknown'}, {open.source === 'speech' ? 'said' : 'typed'} ({open.chars} characters). {open.model}{open.effort ? ` at effort ${open.effort}` : ''}{open.servedBy && open.servedBy !== open.model ? `, answered by ${open.servedBy}` : ''}{open.fastPath ? `, read in code (${open.fastPath})` : ''}; {open.ms ?? '?'} ms{open.costUsd != null ? `, $${open.costUsd.toFixed(4)}` : ''}.{open.error ? ` ${open.error}` : ''}</p>
          <pre>{open.text}</pre>
          {open.notes && open.notes.length > 0 && <p className="an-p">Notes to the player: {open.notes.join(' · ')}</p>}
          {open.saved ? (open.diff && open.diff.length ? (
            <>
              <p className="an-p"><strong>What the player changed before saving</strong> ({open.savedAt ? when(open.savedAt) : 'saved'}):</p>
              <ul className="qa-diff">
                {open.diff.map((d, i) => (
                  <li key={i}><strong>{d.fact}</strong> {d.kind === 'filled' ? `added: ${fmt(d.saved)}` : d.kind === 'dropped' ? `removed (was ${fmt(d.parsed)})` : `${fmt(d.parsed)} → ${fmt(d.saved)}`}</li>
                ))}
              </ul>
            </>
          ) : <p className="an-p">Saved exactly as parsed.</p>) : open.status === 200 ? <p className="an-p">Not saved (yet).</p> : null}
        </div>
      )}
      <div className="qa-actions">
        <button type="button" className="parser-eval-btn ctl" onClick={download}>Export as eval cases</button>
      </div>
      {note && <p className="an-p" role="status">{note}</p>}
    </section>
  );
}
