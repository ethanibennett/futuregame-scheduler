import React, { useState, useMemo, useEffect } from 'react';
import { fetchApi } from '../utils/api.js';
import Card from './SolverCard.jsx';
import StrategyRibbon from './StrategyRibbon.jsx';

// ── Live Solver tool ────────────────────────────────────────
// React port of solver/razz-solver-gui.html into the app's design
// system. Edit a Razz / Stud 8 spot and hit Solve; the inputs are
// POSTed (via fetchApi) to the Express bridge that runs the Python
// solve_server, which returns the EXACT range-form CFR+ solution:
// equilibrium strategy, hero EV (chips), exploitability.
//
// Two modes:
//   (A) node-locked  → /api/solver/exact   (opponent range pinned)
//   (B) range-vs-range → /api/solver/range (r0 vs r1, optional hero line)
//
// Result rendering mirrors the reference GUI: big ± EV (green/red),
// metadata badges, an auto-summary line, and a strategy tree of
// per-node action-frequency bars with the best action highlighted.
//
// Layout: the whole view is the app's 4-column layout grid. The Spot
// and Solution panels span all four columns and are CSS subgrids, so
// every field/control lands on the real column rails (a pair of
// fields = 2 columns each, a full field = all 4) rather than on
// arbitrary card-inset widths.

const FONT = "'Univers Condensed', 'Univers', sans-serif";
const label = { fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' };
const panel = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' };

// Split a free-text holding/upcard string ("As4s3d2c" / "Kc Kd 2h")
// into individual two-char card tokens for the SolverCard preview.
const splitCards = (s) => ((s || '').replace(/[,\s]/g, '').match(/.{1,2}/g) || []);

// Readable label for a betting-history node key (k=check, b=bet,
// r=raise, c=call, co=complete, br=bring-in). Ported from the GUI.
function ctxLabel(hist) {
  if (hist === '(root)' || hist === '') return 'first to act';
  const last = hist[hist.length - 1];
  const m = {
    b: 'facing a bet', r: 'facing a raise', k: 'after a check',
    c: 'after a call', o: 'after a complete',
  };
  return (m[last] || `after “${hist}”`) + ` · line ${hist}`;
}

// One legal action → a horizontal frequency bar. Best action (max
// frequency at the node) is accent-green, matching the reference GUI.
function ActionBar({ name, pct, best }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
      <span style={{ width: 52, fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{name}</span>
      <div style={{ flex: 1, height: 16, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, borderRadius: 4,
          background: best ? 'var(--pos, #22c55e)' : 'var(--accent2)',
          transition: 'width .5s cubic-bezier(.4,0,.2,1)',
        }} />
      </div>
      <span style={{ width: 44, textAlign: 'right', fontSize: '0.72rem', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{pct}%</span>
    </div>
  );
}

// One decision node: who acts, a readable context label, and one
// ActionBar per legal action.
function StrategyNode({ hist, node }) {
  const who = node.who === 'me' ? 'Hero' : 'Opp';
  const pcts = (node.freq || []).map((f) => +(f * 100).toFixed(1));
  const best = pcts.length ? Math.max(...pcts) : -1;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: who === 'Hero' ? 'var(--text)' : 'var(--accent)' }}>{who} to act</span>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>{ctxLabel(hist)}</span>
      </div>
      {/* One ribbon: five separate bars asked the reader to sum them. */}
      <StrategyRibbon
        actions={(node.actions || []).map((nm, i) => ({ id: nm, label: nm, prob: pcts[i] }))}
        best={(node.actions || [])[pcts.indexOf(best)]}
      />
    </div>
  );
}

// Order decision nodes root-first, then by betting-history length —
// a readable top-down tree walk (same sort as the reference GUI).
function sortedNodes(decisions) {
  return Object.entries(decisions || {}).sort((a, b) => {
    const la = a[0] === '(root)' ? 0 : a[0].length;
    const lb = b[0] === '(root)' ? 0 : b[0].length;
    return la - lb || a[0].localeCompare(b[0]);
  });
}

// Short auto-summary derived from the actual root decision + EV.
function summarize(res, pot) {
  const ev = res.value.me;
  const root = (res.decisions || {})['(root)'];
  const p = res.pot || pot || 0;
  let lead;
  if (ev > p * 0.25) lead = 'well ahead';
  else if (ev > 0.5) lead = 'slightly ahead';
  else if (ev < -p * 0.25) lead = 'well behind';
  else if (ev < -0.5) lead = 'slightly behind';
  else lead = 'roughly break-even';
  let act = '';
  if (root && root.freq && root.freq.length) {
    const i = root.freq.indexOf(Math.max(...root.freq));
    act = ` First to act (${root.who === 'me' ? 'hero' : 'opp'}) mostly ${root.actions[i]}s (${(root.freq[i] * 100).toFixed(0)}%).`;
  }
  return { lead, ev, act };
}

const GAMES = [['razz', 'Razz'], ['stud8', 'Stud 8']];
const STREETS = [3, 4, 5, 6, 7];

export default function SolverView({ pendingSpot, onConsumeSpot } = {}) {
  const [game, setGame] = useState('razz');
  const [street, setStreet] = useState(7);
  const [mode, setMode] = useState('exact'); // 'exact' (node-locked) | 'range'
  const [up0, setUp0] = useState('As4s3d2c');
  const [up1, setUp1] = useState('KhQdJc9h');
  const [me, setMe] = useState('5h6h7c');
  const [pot, setPot] = useState('20');
  const [dead, setDead] = useState('');
  // node-locked
  const [oppRange, setOppRange] = useState('Kc Kd 2h, Qs Js Tc');
  // range-vs-range
  const [r0, setR0] = useState('all');
  const [r1, setR1] = useState('all');
  const [rangeMe, setRangeMe] = useState('');
  const [abstraction, setAbstraction] = useState('hilo'); // hilo | emd (stud8 only)

  const [solving, setSolving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null); // { offline, message }

  // "Solve this spot" handoff from the hand replayer. When a spot
  // arrives we pre-fill the inputs (node-locked mode, opponent = full
  // range) and surface a note describing the mapping + any ambiguity
  // (e.g. unknown hero down cards, multiway → heads-up). We DON'T
  // auto-solve: the user reviews/tweaks the editable inputs first.
  const [handoffNote, setHandoffNote] = useState(null); // { source, notes[] }
  useEffect(() => {
    if (!pendingSpot) return;
    const s = pendingSpot;
    if (s.game) setGame(s.game);
    if (s.street != null) setStreet(s.street);
    setMode('exact');
    setUp0(s.up0 || '');
    setUp1(s.up1 || '');
    setMe(s.me || '');
    if (s.pot != null) setPot(String(s.pot));
    setOppRange(s.oppRange || 'all');
    setR0('all');
    setR1(s.oppRange || 'all');
    setRangeMe(s.me || '');
    setDead('');
    if (s.game !== 'stud8') setAbstraction('hilo');
    setResult(null);
    setError(null);
    setHandoffNote({ source: s.source || null, notes: s.notes || [] });
    onConsumeSpot && onConsumeSpot();
  }, [pendingSpot, onConsumeSpot]);

  const downN = street === 7 ? 3 : 2;
  const emdAvailable = game === 'stud8';

  // Card previews from the current inputs.
  const heroCards = useMemo(() => [...splitCards(up0), ...splitCards(me)], [up0, me]);
  const oppCards = useMemo(() => splitCards(up1), [up1]);
  const oppHoldings = useMemo(
    () => oppRange.split(',').map((s) => s.trim()).filter(Boolean),
    [oppRange]
  );

  async function runSolve() {
    setSolving(true);
    setError(null);
    setResult(null);
    const potNum = parseFloat(pot) || 0;
    const path = mode === 'exact' ? '/solver/exact' : '/solver/range';
    const body = mode === 'exact'
      ? { game, street, up0, up1, dead, me, oppRange, pot: potNum }
      : {
          game, street, up0, up1, dead, pot: potNum, r0, r1,
          ...(rangeMe.trim() ? { me: rangeMe.trim() } : {}),
          abstraction: emdAvailable ? abstraction : 'hilo',
        };
    try {
      const res = await fetchApi(path, { method: 'POST', body });
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON body */ }
      if (!res.ok) {
        const msg = (data && data.error) ? data.error : `server returned ${res.status}`;
        setError({ offline: res.status === 503, message: msg });
      } else {
        setResult(data);
      }
    } catch (e) {
      // Network failure reaching the app server itself.
      setError({ offline: true, message: e.message || 'network error' });
    } finally {
      setSolving(false);
    }
  }

  // ── shared input styles ──
  // Controls are a fixed 40px (5×8) so they sit on the 8px baseline; height
  // does the vertical sizing, horizontal padding stays. One constant, every
  // field and button inherits it.
  const CTRL_H = 40;
  const input = {
    width: '100%', height: CTRL_H, boxSizing: 'border-box',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.78rem', padding: '0 10px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--surface2)',
    color: 'var(--text)', letterSpacing: '0.02em',
  };
  const fieldLab = { ...label, display: 'flex', alignItems: 'flex-end', height: 24, marginBottom: 0, lineHeight: 1 };

  const pill = (active) => ({
    height: CTRL_H, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center',
    padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: '0.72rem', fontWeight: active ? 700 : 600, letterSpacing: '0.04em',
    border: '1px solid ' + (active ? 'var(--text)' : 'var(--border)'),
    background: active ? 'var(--text)' : 'transparent',
    color: active ? 'var(--bg)' : 'var(--text-muted)',
  });

  // ── grid rails ──
  // Panels span all 4 columns and are subgrids, so their fields land on
  // the app's real column lines. `half` = a 2-column field (paired),
  // `full` = a field/control across all 4 columns.
  const panelStyle = {
    gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'subgrid',
    rowGap: 16, background: 'var(--surface)', borderRadius: 12, padding: '16px 0',
  };
  const half = { gridColumn: 'span 2' };
  const full = { gridColumn: '1 / -1' };

  const sum = result ? summarize(result, parseFloat(pot) || 0) : null;
  // exact path returns `holdings`; range path returns `n`.
  const n = result ? (result.n ?? result.holdings) : null;
  const meStratNodes = result && result.me_strategy ? sortedNodes(result.me_strategy) : null;

  return (
    <div style={{
      height: '100%', overflowY: 'auto', padding: '0 0 80px', maxWidth: 880,
      margin: '0 auto', fontFamily: FONT,
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', columnGap: 12, rowGap: 16,
      alignContent: 'start',
    }}>
      {/* Header — title on cols 1–2, game pills on cols 3–4 */}
      <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'subgrid', alignItems: 'center', rowGap: 8 }}>
        <h2 style={{ gridColumn: '1 / 3', fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>Solver</h2>
        {/* Game pills */}
        <div style={{ gridColumn: '3 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {GAMES.map(([id, lbl]) => (
            <button key={id} onClick={() => { setGame(id); if (id !== 'stud8') setAbstraction('hilo'); }} style={pill(game === id)}>{lbl}</button>
          ))}
        </div>
      </div>
      <p style={{ ...label, ...full, margin: 0 }}>Live range-form CFR+ · exact subgame solve</p>

      {/* Handoff note — appears when a spot is imported from the replayer.
          Pre-filled from a frozen replay spot; spells out the up/down split
          assumptions and any ambiguity. Inputs below are editable. */}
      {handoffNote && (
        <div style={{
          ...full, padding: '12px', borderRadius: 10,
          background: 'var(--surface2)', border: '1px solid var(--accent)',
          fontSize: '0.74rem', color: 'var(--text)', lineHeight: 1.5,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: handoffNote.notes.length ? 8 : 0 }}>
            <span><b>Spot imported from the replayer.</b>{handoffNote.source ? ` ${handoffNote.source}.` : ''} Review the inputs, then Solve.</span>
            <button onClick={() => setHandoffNote(null)} aria-label="Dismiss"
              style={{ flex: '0 0 auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: 0 }}>×</button>
          </div>
          {handoffNote.notes.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-muted)' }}>
              {handoffNote.notes.map((n, i) => <li key={i} style={{ marginBottom: 2 }}>{n}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Mode switch — two buttons, each spanning 2 columns */}
      <div style={{ ...full, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[['exact', 'Node-locked'], ['range', 'Range vs range']].map(([id, lbl]) => (
          <button key={id} onClick={() => setMode(id)}
            style={{
              height: 40, boxSizing: 'border-box', padding: '0 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
              fontSize: '0.74rem', fontWeight: 'var(--fw-bold)',
              border: '1px solid ' + (mode === id ? 'var(--accent)' : 'var(--border)'),
              background: mode === id ? 'var(--surface2)' : 'var(--surface)',
              color: mode === id ? 'var(--text)' : 'var(--text-muted)',
            }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* ── Spot panel (subgrid across all 4 columns) ── */}
      <div style={panelStyle}>
        <div style={{ ...label, ...full, letterSpacing: '0.14em', fontWeight: 700, height: 24, display: 'flex', alignItems: 'center', lineHeight: 1 }}>Spot</div>

        <div style={half}>
          <div style={fieldLab}>Game</div>
          <select value={game} onChange={(e) => setGame(e.target.value)} style={{ ...input, fontFamily: 'inherit' }}>
            {GAMES.map(([id, lbl]) => <option key={id} value={id}>{lbl}</option>)}
          </select>
        </div>
        <div style={half}>
          <div style={fieldLab}>Street</div>
          <select value={street} onChange={(e) => setStreet(+e.target.value)} style={{ ...input, fontFamily: 'inherit' }}>
            {STREETS.map((s) => <option key={s} value={s}>{s}th street</option>)}
          </select>
        </div>

        <div style={half}>
          <div style={fieldLab}>Your upcards</div>
          <input value={up0} onChange={(e) => setUp0(e.target.value)} placeholder="As4s3d2c" style={input} />
        </div>
        <div style={half}>
          <div style={fieldLab}>Opp upcards</div>
          <input value={up1} onChange={(e) => setUp1(e.target.value)} placeholder="KhQdJc9h" style={input} />
        </div>

        {/* Hero hand — needed for node-locked; optional line for range mode */}
        {mode === 'exact' ? (
          <div style={full}>
            <div style={fieldLab}>Your hole cards <span style={{ opacity: 0.6 }}>({downN} down)</span></div>
            <input value={me} onChange={(e) => setMe(e.target.value)} placeholder={downN === 3 ? '5h6h7c' : '5h6h'} style={input} />
          </div>
        ) : (
          <div style={full}>
            <div style={fieldLab}>Hero hand <span style={{ opacity: 0.6 }}>(optional — show this hand's own line)</span></div>
            <input value={rangeMe} onChange={(e) => setRangeMe(e.target.value)} placeholder={downN === 3 ? '5h6h7c' : '5h6h'} style={input} />
          </div>
        )}

        {/* Card preview for hero + opponent upcards */}
        <div style={half}>
          <div style={fieldLab}>Hero</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', minHeight: 44 }}>
            {heroCards.length ? heroCards.map((c, i) => <Card key={i} str={c} size="sm" />) : <span style={{ ...label }}>—</span>}
          </div>
        </div>
        <div style={half}>
          <div style={fieldLab}>Opp upcards</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', minHeight: 44 }}>
            {oppCards.length ? oppCards.map((c, i) => <Card key={i} str={c} size="sm" />) : <span style={{ ...label }}>—</span>}
          </div>
        </div>

        {/* Mode-specific range inputs */}
        {mode === 'exact' ? (
          <div style={full}>
            <div style={fieldLab}>Opponent range <span style={{ opacity: 0.6 }}>(node-locked — comma-separated)</span></div>
            <input value={oppRange} onChange={(e) => setOppRange(e.target.value)} placeholder="Kc Kd 2h, Qs Js Tc" style={input} />
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 8 }}>
              Keep it narrow (a few holdings). Each holding is {downN} cards.
            </div>
            {oppHoldings.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 8 }}>
                {oppHoldings.map((h, i) => (
                  <span key={i} style={{
                    fontSize: '0.68rem', fontVariantNumeric: 'tabular-nums', padding: '6px 9px', borderRadius: 6,
                    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
                  }}>{h}</span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={half}>
              <div style={fieldLab}>Your range (r0)</div>
              <input value={r0} onChange={(e) => setR0(e.target.value)} placeholder="all" style={input} />
            </div>
            <div style={half}>
              <div style={fieldLab}>Opp range (r1)</div>
              <input value={r1} onChange={(e) => setR1(e.target.value)} placeholder="all" style={input} />
            </div>
            <div style={{ ...full, fontSize: '0.62rem', color: 'var(--text-muted)' }}>
              Use <b style={{ color: 'var(--text)' }}>all</b> or a comma-separated holding list. Each holding is {downN} cards.
            </div>
            <div style={half}>
              <div style={fieldLab}>Abstraction {!emdAvailable && <span style={{ opacity: 0.6 }}>(EMD is Stud 8 only)</span>}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[['hilo', 'Hi/Lo'], ['emd', 'EMD']].map(([id, lbl]) => {
                  const disabled = id === 'emd' && !emdAvailable;
                  const active = abstraction === id;
                  return (
                    <button key={id} disabled={disabled} onClick={() => setAbstraction(id)}
                      style={{ ...pill(active), opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.7rem' }}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div style={half}>
          <div style={fieldLab}>Pot (chips)</div>
          <input value={pot} onChange={(e) => setPot(e.target.value)} inputMode="decimal" style={input} />
        </div>
        <div style={half}>
          <div style={fieldLab}>Dead cards <span style={{ opacity: 0.6 }}>(optional)</span></div>
          <input value={dead} onChange={(e) => setDead(e.target.value)} placeholder="Th 8c" style={input} />
        </div>

        <button onClick={runSolve} disabled={solving}
          style={{
            ...full, fontFamily: 'inherit', fontSize: '0.8rem', letterSpacing: '0.08em',
            textTransform: 'uppercase', fontWeight: 700, height: 48, boxSizing: 'border-box', borderRadius: 8, border: 'none',
            background: 'var(--text)', color: 'var(--bg)', cursor: solving ? 'wait' : 'pointer', opacity: solving ? 0.6 : 1,
          }}>
          {solving ? 'Solving…' : 'Solve spot'}
        </button>
      </div>

      {/* ── Solution panel (subgrid across all 4 columns) ── */}
      <div style={panelStyle}>
        <div style={{ ...label, ...full, letterSpacing: '0.14em', fontWeight: 700, height: 24, display: 'flex', alignItems: 'center', lineHeight: 1 }}>Solution</div>

        {solving && (
          <div style={{ ...full, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.55, animation: 'none' }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, marginRight: 8, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'fgspin 0.8s linear infinite', verticalAlign: 'middle' }} />
            Solving the subgame… range-form CFR+ over the {game} tree.
            <style>{'@keyframes fgspin{to{transform:rotate(360deg)}}'}</style>
          </div>
        )}

        {error && !solving && (
          <div style={{
            ...full, fontSize: '0.78rem', color: 'var(--neg, #ef4444)', background: 'rgba(239,68,68,.08)',
            border: '1px solid var(--neg, #ef4444)', borderRadius: 8, padding: '9px 11px', lineHeight: 1.5,
          }}>
            {error.offline
              ? <><b>Solver offline.</b> Start it with <code style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '0.72rem' }}>cd solver/neural &amp;&amp; python3 solve_server.py</code>, then Solve again.</>
              : <><b>Could not solve:</b> {error.message}</>}
          </div>
        )}

        {!solving && !error && !result && (
          <div style={{ ...full, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.55, borderLeft: '2px solid var(--accent)', paddingLeft: 12 }}>
            Edit the spot on the left and hit <b style={{ color: 'var(--text)' }}>Solve spot</b> to run it live.
          </div>
        )}

        {result && !solving && sum && (
          <>
            {/* Big ± EV */}
            <div style={{ ...full, display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{
                fontSize: '2.1rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
                color: sum.ev >= 0 ? 'var(--pos, #22c55e)' : 'var(--neg, #ef4444)',
              }}>
                {sum.ev >= 0 ? '+' : ''}{sum.ev.toFixed(2)}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>chips · hero EV</span>
            </div>

            {/* Badges */}
            <div style={{ ...full, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(() => {
                const badge = (txt) => (
                  <span key={txt} style={{
                    fontSize: '0.66rem', padding: '3px 9px', borderRadius: 999, background: 'var(--surface2)',
                    border: '1px solid var(--border)', color: 'var(--text-muted)', letterSpacing: '0.03em',
                  }}>{txt}</span>
                );
                const badges = [badge(`${result.game || game} · ${n} ${mode === 'exact' ? 'holdings' : 'buckets'}`)];
                if (result.mode) badges.push(badge(`mode ${result.mode}${result.abstraction ? ` · ${result.abstraction}` : ''}`));
                if ('exploitability' in result) badges.push(badge(`exploitability ${result.exploitability.toFixed(2)}`));
                badges.push(badge(result.street === 7 ? 'exact (7th)' : `street ${result.street}`));
                return badges;
              })()}
            </div>

            {/* Auto-summary */}
            <div style={{ ...full, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.55, borderLeft: '2px solid var(--border)', paddingLeft: 12 }}>
              You are <b style={{ color: 'var(--text)' }}>{sum.lead}</b> for <b style={{ color: 'var(--text)' }}>{sum.ev >= 0 ? '+' : ''}{sum.ev.toFixed(2)}</b> chips.{sum.act}
            </div>

            {/* Hero's own line (range mode with a pinned hero hand) */}
            {meStratNodes && meStratNodes.length > 0 && (
              <div style={{ ...panel, ...full, background: 'var(--surface2)' }}>
                <div style={{ ...label, marginBottom: 10 }}>
                  This hand's line{result.me_bucket != null ? ` · bucket ${result.me_bucket}` : ''}
                </div>
                {meStratNodes.map(([hist, node]) => <StrategyNode key={'me' + hist} hist={hist} node={node} />)}
              </div>
            )}

            {/* Full strategy tree */}
            <div style={{ ...label, ...full, letterSpacing: '0.14em' }}>GTO strategy</div>
            {sortedNodes(result.decisions).map(([hist, node]) => (
              <div key={hist} style={full}>
                <StrategyNode hist={hist} node={node} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
