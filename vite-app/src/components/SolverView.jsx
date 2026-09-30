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
//
// Vertical grid: every piece is a whole number of r (text = .hs-t blocks whose
// baseline is their bottom edge, controls 3/5/6r, gaps 1/2r), so every block
// starts on an r-line from the top bar. Classes live in styles.css (.hs-*).

// Text block helper: className + baseline offset b (r) [+ line pitch lh (r)].
const T = (b, lh) => (lh ? { '--hs-b': b, '--hs-lh': lh } : { '--hs-b': b });

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

// One decision node: who acts, a readable context label, and one
// strategy ribbon. Grid: 2r header line (both baselines on its bottom),
// 1r, then the ribbon (all whole r — see .hs-view .freq-*).
function StrategyNode({ hist, node }) {
  const who = node.who === 'me' ? 'Hero' : 'Opp';
  const pcts = (node.freq || []).map((f) => +(f * 100).toFixed(1));
  const best = pcts.length ? Math.max(...pcts) : -1;
  return (
    <div className="hs-stack">
      <div className="hs-split">
        <span className="hs-t hs-sm hs-bold" style={{ ...T(2), color: who === 'Hero' ? 'var(--text)' : 'var(--accent)' }}>{who} to act</span>
        <span className="hs-t hs-xs hs-mut hs-clip" style={T(2)}>{ctxLabel(hist)}</span>
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

  // ── grid rails ──
  // Panels span all 4 columns and are subgrids, so their fields land on
  // the app's real column lines. `half` = a 2-column field (paired),
  // `full` = a field/control across all 4 columns.
  // Vertical: 2r between rows; a field = 2r label + 1r + 5r control = 8r.
  const panelStyle = {
    gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'subgrid',
    rowGap: 'calc(var(--subrow) * 2)', background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 'calc(var(--subrow) * 2) 0',
  };
  const half = { gridColumn: 'span 2', minWidth: 0 };
  const full = { gridColumn: '1 / -1', minWidth: 0 };
  const dim = { opacity: 0.6 };
  // Pill button: 5r, label baseline 3r down ((5 + 1.1 cap) / 2 = 3.05 → 3).
  const pill = (active) => ({
    '--hs-h': 5, '--hs-edge': active ? 'var(--text)' : 'var(--border)',
    '--hs-fill': active ? 'var(--text)' : 'transparent', '--hs-ink': active ? 'var(--bg)' : 'var(--text-muted)',
    fontSize: 'var(--fs-xs)', fontWeight: active ? 'var(--fw-bold)' : 'var(--fw-semibold, 600)', letterSpacing: '0.04em',
  });

  const sum = result ? summarize(result, parseFloat(pot) || 0) : null;
  // exact path returns `holdings`; range path returns `n`.
  const n = result ? (result.n ?? result.holdings) : null;
  const meStratNodes = result && result.me_strategy ? sortedNodes(result.me_strategy) : null;

  return (
    <div className="hs-view hs-solver" style={{
      maxWidth: 'calc(var(--subrow) * 110)',
      /* Grid: 1g column gaps make the four columns land on the app's 8g lines; 2r row gap. */
      display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', columnGap: 'var(--gu)', rowGap: 'calc(var(--subrow) * 2)',
      alignContent: 'start',
    }}>
      {/* Header — 5r row: title (baseline 4r down) on cols 1–2, game pills (5r) on cols 3–4 */}
      <div style={{ ...full, display: 'grid', gridTemplateColumns: 'subgrid', height: 'calc(var(--subrow) * 5)' }}>
        <h2 className="screen-title hs-t hs-title" style={{ ...T(4), gridColumn: '1 / 3' }}>Solver</h2>
        <div style={{ gridColumn: '3 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--gu)' }}>
          {GAMES.map(([id, lbl]) => (
            <button key={id} className="hs-btn hs-pill" onClick={() => { setGame(id); if (id !== 'stud8') setAbstraction('hilo'); }} style={pill(game === id)}>
              <span className="hs-t" style={T(3)}>{lbl}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="hs-t hs-cap" style={{ ...full, ...T(2, 2) }}>Live range-form CFR+ · exact subgame solve</p>

      {/* Handoff note — appears when a spot is imported from the replayer.
          Pre-filled from a frozen replay spot; spells out the up/down split
          assumptions and any ambiguity. Inputs below are editable.
          Grid: box 1..36 with 2r × 2g padding (text on 3..34); 2r lines, 1r apart. */}
      {handoffNote && (
        <div className="hs-panel hs-stack" style={{ ...full, '--hs-bg': 'var(--surface2)', '--hs-edge': 'var(--accent)', position: 'relative' }}>
          <div className="hs-t hs-xs" style={{ ...T(2, 2), paddingRight: 'calc(var(--gu) * 3)' }}>
            <b>Spot imported from the replayer.</b>{handoffNote.source ? ` ${handoffNote.source}.` : ''} Review the inputs, then Solve.
          </div>
          {handoffNote.notes.map((nt, i) => (
            <div key={i} className="hs-t hs-xs hs-mut" style={{ ...T(2, 2), paddingLeft: 'var(--gu)' }}>• {nt}</div>
          ))}
          {/* Dismiss: 3r × 2g hit box at the top-right, x 32..34, y 1r..4r. */}
          <button onClick={() => setHandoffNote(null)} aria-label="Dismiss" className="hs-btn"
            style={{ '--hs-h': 3, '--hs-edge': 'transparent', '--hs-ink': 'var(--text-muted)', position: 'absolute', top: 'var(--subrow)', right: 'calc(var(--gu) * 2)', width: 'calc(var(--gu) * 2)', padding: 0, fontSize: 'var(--fs-md)' }}>
            <span className="hs-t" style={T(2)}>×</span>
          </button>
        </div>
      )}

      {/* Mode switch — two 5r buttons, each spanning 2 columns (17g) */}
      <div style={{ ...full, display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--gu)' }}>
        {[['exact', 'Node-locked'], ['range', 'Range vs range']].map(([id, lbl]) => (
          <button key={id} className="hs-btn" onClick={() => setMode(id)}
            style={{
              '--hs-h': 5, '--hs-edge': mode === id ? 'var(--accent)' : 'var(--border)',
              '--hs-fill': mode === id ? 'var(--surface2)' : 'var(--surface)', '--hs-ink': mode === id ? 'var(--text)' : 'var(--text-muted)',
              fontSize: 'var(--fs-xs)',
            }}>
            <span className="hs-t" style={T(3)}>{lbl}</span>
          </button>
        ))}
      </div>

      {/* ── Spot panel (subgrid across all 4 columns) ── */}
      <div style={panelStyle}>
        <div className="hs-t hs-cap hs-bold" style={{ ...full, ...T(2), letterSpacing: '0.14em' }}>Spot</div>

        <div style={half}>
          <FieldLab>Game</FieldLab>
          <select className="hs-input" value={game} onChange={(e) => setGame(e.target.value)}>
            {GAMES.map(([id, lbl]) => <option key={id} value={id}>{lbl}</option>)}
          </select>
        </div>
        <div style={half}>
          <FieldLab>Street</FieldLab>
          <select className="hs-input" value={street} onChange={(e) => setStreet(+e.target.value)}>
            {STREETS.map((s) => <option key={s} value={s}>{s}th street</option>)}
          </select>
        </div>

        <div style={half}>
          <FieldLab>Your upcards</FieldLab>
          <input className="hs-input" value={up0} onChange={(e) => setUp0(e.target.value)} placeholder="As4s3d2c" />
        </div>
        <div style={half}>
          <FieldLab>Opp upcards</FieldLab>
          <input className="hs-input" value={up1} onChange={(e) => setUp1(e.target.value)} placeholder="KhQdJc9h" />
        </div>

        {/* Hero hand — needed for node-locked; optional line for range mode */}
        {mode === 'exact' ? (
          <div style={full}>
            <FieldLab>Your hole cards <span style={dim}>({downN} down)</span></FieldLab>
            <input className="hs-input" value={me} onChange={(e) => setMe(e.target.value)} placeholder={downN === 3 ? '5h6h7c' : '5h6h'} />
          </div>
        ) : (
          <div style={full}>
            <FieldLab>Hero hand <span style={dim}>(optional — show this hand's own line)</span></FieldLab>
            <input className="hs-input" value={rangeMe} onChange={(e) => setRangeMe(e.target.value)} placeholder={downN === 3 ? '5h6h7c' : '5h6h'} />
          </div>
        )}

        {/* Card preview for hero + opponent upcards: 2r label, 1r, 4r card row (sm cards 2g × 4r).
            Hero: upcards, a 1g gap, then the hole cards — so 4 upcards fill 1..9
            and the hole cards start on the 10g column line. */}
        <div style={half}>
          <FieldLab>Hero</FieldLab>
          <div className="hs-cards" style={{ height: 'calc(var(--subrow) * 4)', overflow: 'hidden' }}>
            {heroCards.length
              ? heroCards.map((c, i) => <span key={i} style={{ display: 'contents' }}>
                  {i === splitCards(up0).length && i > 0 && <span style={{ width: 'var(--gu)', flex: '0 0 auto' }} />}
                  <Card str={c} size="sm" />
                </span>)
              : <span className="hs-t hs-cap" style={T(2)}>—</span>}
          </div>
        </div>
        <div style={half}>
          <FieldLab>Opp upcards</FieldLab>
          <div className="hs-cards" style={{ height: 'calc(var(--subrow) * 4)', overflow: 'hidden' }}>
            {oppCards.length ? oppCards.map((c, i) => <Card key={i} str={c} size="sm" />) : <span className="hs-t hs-cap" style={T(2)}>—</span>}
          </div>
        </div>

        {/* Mode-specific range inputs */}
        {mode === 'exact' ? (
          <div style={{ ...full, display: 'flex', flexDirection: 'column' }}>
            <FieldLab>Opponent range <span style={dim}>(node-locked — comma-separated)</span></FieldLab>
            <input className="hs-input" value={oppRange} onChange={(e) => setOppRange(e.target.value)} placeholder="Kc Kd 2h, Qs Js Tc" />
            {/* 1r, then a 2r note line (baseline on its bottom). */}
            <div className="hs-t hs-xs hs-mut" style={{ ...T(2, 2), marginTop: 'var(--subrow)' }}>
              Keep it narrow (a few holdings). Each holding is {downN} cards.
            </div>
            {oppHoldings.length > 0 && (
              /* 1r, then 3r chips on the four 8g rails. */
              <div className="hs-cols" style={{ '--hs-n': 4, marginTop: 'var(--subrow)' }}>
                {oppHoldings.map((h, i) => (
                  <span key={i} className="hs-badge" style={{ '--hs-bg': 'var(--surface2)', '--hs-ink': 'var(--text)', borderRadius: 'var(--radius-xs)', padding: 0, textAlign: 'center' }}>
                    <span className="hs-t hs-xs hs-num" style={T(2)}>{h}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={half}>
              <FieldLab>Your range (r0)</FieldLab>
              <input className="hs-input" value={r0} onChange={(e) => setR0(e.target.value)} placeholder="all" />
            </div>
            <div style={half}>
              <FieldLab>Opp range (r1)</FieldLab>
              <input className="hs-input" value={r1} onChange={(e) => setR1(e.target.value)} placeholder="all" />
            </div>
            <div className="hs-t hs-xs hs-mut" style={{ ...full, ...T(2, 2) }}>
              Use <b style={{ color: 'var(--text)' }}>all</b> or a comma-separated holding list. Each holding is {downN} cards.
            </div>
            <div style={half}>
              <FieldLab>Abstraction {!emdAvailable && <span style={dim}>(EMD is Stud 8 only)</span>}</FieldLab>
              {/* Two 8g pills inside the 17g half: 8 + 1 + 8. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--gu)' }}>
                {[['hilo', 'Hi/Lo'], ['emd', 'EMD']].map(([id, lbl]) => {
                  const disabled = id === 'emd' && !emdAvailable;
                  const active = abstraction === id;
                  return (
                    <button key={id} className="hs-btn hs-pill" disabled={disabled} onClick={() => setAbstraction(id)}
                      style={{ ...pill(active), cursor: disabled ? 'not-allowed' : 'pointer' }}>
                      <span className="hs-t" style={T(3)}>{lbl}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div style={half}>
          <FieldLab>Pot (chips)</FieldLab>
          <input className="hs-input" value={pot} onChange={(e) => setPot(e.target.value)} inputMode="decimal" />
        </div>
        <div style={half}>
          <FieldLab>Dead cards <span style={dim}>(optional)</span></FieldLab>
          <input className="hs-input" value={dead} onChange={(e) => setDead(e.target.value)} placeholder="Th 8c" />
        </div>

        {/* Solve: 6r, label baseline 4r down ((6 + 1.2 cap) / 2 = 3.6 → 4). */}
        <button onClick={runSolve} disabled={solving} className="hs-btn"
          style={{
            ...full, '--hs-h': 6, '--hs-edge': 'transparent', '--hs-fill': 'var(--text)', '--hs-ink': 'var(--bg)',
            fontSize: 'var(--fs-sm)', letterSpacing: '0.08em', textTransform: 'uppercase',
            cursor: solving ? 'wait' : 'pointer', opacity: solving ? 0.6 : 1,
          }}>
          <span className="hs-t" style={T(4)}>{solving ? 'Solving…' : 'Solve spot'}</span>
        </button>
      </div>

      {/* ── Solution panel (subgrid across all 4 columns) ── */}
      <div style={panelStyle}>
        <div className="hs-t hs-cap hs-bold" style={{ ...full, ...T(2), letterSpacing: '0.14em' }}>Solution</div>

        {solving && (
          <div className="hs-t hs-sm hs-mut" style={{ ...full, ...T(3, 3) }}>
            <span style={{ display: 'inline-block', width: 'var(--icon-xs)', height: 'var(--icon-xs)', marginRight: 'var(--gu)', borderRadius: '50%', boxShadow: 'inset 0 0 0 calc(var(--subrow) * 0.25) var(--border)', borderTop: 'calc(var(--subrow) * 0.25) solid var(--accent)', boxSizing: 'border-box', animation: 'fgspin 0.8s linear infinite', verticalAlign: 'baseline' }} />
            Solving the subgame… range-form CFR+ over the {game} tree.
            <style>{'@keyframes fgspin{to{transform:rotate(360deg)}}'}</style>
          </div>
        )}

        {/* Error: box 1..36, 1r × 2g padding, 3r lines (baseline on each line's bottom). */}
        {error && !solving && (
          <div className="hs-box" style={{ ...full, '--hs-edge': 'var(--neg, #ef4444)', '--hs-bg': 'rgba(239,68,68,.08)', padding: 'var(--subrow) calc(var(--gu) * 2)' }}>
            <div className="hs-t hs-sm" style={{ ...T(3, 3), color: 'var(--neg, #ef4444)' }}>
              {error.offline
                ? <><b>Solver offline.</b> Start it with <code style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 'var(--fs-xs)', lineHeight: 0 }}>cd solver/neural &amp;&amp; python3 solve_server.py</code>, then Solve again.</>
                : <><b>Could not solve:</b> {error.message}</>}
            </div>
          </div>
        )}

        {/* Empty prompt: accent rule on the left edge (inset, adds no width), text on 3g; 3r lines. */}
        {!solving && !error && !result && (
          <div className="hs-t hs-sm hs-mut" style={{ ...full, ...T(3, 3), boxShadow: 'inset calc(var(--subrow) * 0.25) 0 0 var(--accent)', paddingLeft: 'calc(var(--gu) * 2)' }}>
            Edit the spot on the left and hit <b style={{ color: 'var(--text)' }}>Solve spot</b> to run it live.
          </div>
        )}

        {result && !solving && sum && (
          <>
            {/* Big ± EV — one 4r line, baseline on its bottom (fs-3xl cap ≈ 2.8r). */}
            <div className="hs-t hs-num" style={{ ...full, ...T(4, 5), fontSize: 'var(--fs-3xl)', fontWeight: 'var(--fw-bold)', letterSpacing: '-0.01em', color: sum.ev >= 0 ? 'var(--pos, #22c55e)' : 'var(--neg, #ef4444)' }}>
              {sum.ev >= 0 ? '+' : ''}{sum.ev.toFixed(2)}
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-regular)', letterSpacing: 0, marginLeft: 'var(--gu)' }}>chips · hero EV</span>
            </div>

            {/* Badges — 3r pills on two 17g columns, 1r row gap. */}
            <div className="hs-cols" style={{ ...full, '--hs-n': 2 }}>
              {(() => {
                const badge = (txt) => (
                  <span key={txt} className="hs-badge" style={{ '--hs-bg': 'var(--surface2)' }}>
                    <span className="hs-t hs-xs" style={{ ...T(2), letterSpacing: '0.03em' }}>{txt}</span>
                  </span>
                );
                const badges = [badge(`${result.game || game} · ${n} ${mode === 'exact' ? 'holdings' : 'buckets'}`)];
                if (result.mode) badges.push(badge(`mode ${result.mode}${result.abstraction ? ` · ${result.abstraction}` : ''}`));
                if ('exploitability' in result) badges.push(badge(`exploitability ${result.exploitability.toFixed(2)}`));
                badges.push(badge(result.street === 7 ? 'exact (7th)' : `street ${result.street}`));
                return badges;
              })()}
            </div>

            {/* Auto-summary — rule on the left edge, text on 3g, 3r lines. */}
            <div className="hs-t hs-sm hs-mut" style={{ ...full, ...T(3, 3), boxShadow: 'inset calc(var(--subrow) * 0.25) 0 0 var(--border)', paddingLeft: 'calc(var(--gu) * 2)' }}>
              You are <b style={{ color: 'var(--text)' }}>{sum.lead}</b> for <b style={{ color: 'var(--text)' }}>{sum.ev >= 0 ? '+' : ''}{sum.ev.toFixed(2)}</b> chips.{sum.act}
            </div>

            {/* Hero's own line (range mode with a pinned hero hand) */}
            {meStratNodes && meStratNodes.length > 0 && (
              <div className="hs-panel hs-stack" style={{ ...full, '--hs-bg': 'var(--surface2)', '--hs-gap': 2 }}>
                <div className="hs-t hs-cap" style={T(2)}>
                  This hand's line{result.me_bucket != null ? ` · bucket ${result.me_bucket}` : ''}
                </div>
                {meStratNodes.map(([hist, node]) => <StrategyNode key={'me' + hist} hist={hist} node={node} />)}
              </div>
            )}

            {/* Full strategy tree */}
            <div className="hs-t hs-cap" style={{ ...full, ...T(2), letterSpacing: '0.14em' }}>GTO strategy</div>
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

// Field label: 2r caps line (baseline on its bottom) + 1r, then the 5r control.
function FieldLab({ children }) {
  return <div className="hs-t hs-cap hs-clip" style={{ '--hs-b': 2, marginBottom: 'calc(var(--subrow) - 0.3em)' }}>{children}</div>;
}
