// ── PRE-DRAW RANGES ─────────────────────────────────────────────────────────
// The browser face of docs/LJ-OPENING-RANGE.md: four 6-max 2-7 triple draw
// pre-draw ranges read off a 6-seat MCCFR solve, served by
// GET /api/solver/ranges/:gameId.
//
// WHERE THE NUMBERS COME FROM, because that is the whole value of this screen.
// Nothing here is typed by hand or parsed out of the document. The route serves
// two JSON files written by the solver's own tools, and the ladder file can only
// be produced by a PASSING run of `solver/multiway/range-doc-gate.js` — the gate
// that holds the document to an independent re-derivation from the snapshots.
// So this view, the document and the snapshots cannot silently disagree, which
// is exactly the drift that cost this project six weeks on a stale stud8 figure.
//
// 🛑 THREE THINGS THIS VIEW MUST NOT MISREPRESENT:
//  1. A ROW IS NOT ALWAYS ONE HAND. Where `holds` lists several holdings the
//     solve has ONE number for all of them — that is the resolution ceiling of
//     the abstraction, not a rounding choice, and a threshold finer than a row
//     is not available at any iteration count. Rows say how many they pool.
//  2. AN UNDETERMINED ROW IS MARKED. A row whose play% moves ≥5 pp across the
//     six seeds has not been resolved by this solve. Hiding that would turn a
//     noisy row into advice.
//  3. THE FOUR NODES ARE DIFFERENT SITUATIONS, NOT ONE RANGE AT FOUR SEATS.
//     Their play% columns are not a ladder and must not be read as one.
import { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../utils/api';
import { StudyHead } from './StudyHead.jsx';

const T = (b, lh) => (lh ? { '--hs-b': b, '--hs-lh': lh } : { '--hs-b': b });

// The four betting nodes the solve covers, in the order a hand reaches them.
// `line` is the raw action sequence the solver keys on, and it is what joins a
// pill to its table — never the label, which is prose.
const NODES = [
  ['', 'Opening', 'Nobody has acted yet.'],
  ['c', 'Over a limp', 'One caller in front, nobody raised.'],
  ['r', 'Facing an open', 'Someone opened, so this is the 3-bet range.'],
  ['rr', 'Facing a 3-bet', 'You are cold 4-betting.'],
];
const SEATS = ['LJ', 'HJ', 'CO', 'BTN', 'SB'];
const NODE_KIND = { '': 'ladder', c: 'limp', r: '3bet', rr: '4bet' };

/** A play bar with the raise share drawn inside it: raise-first-in is a SUBSET of
 *  play, so nesting is the honest geometry. Two side-by-side bars would imply
 *  they add up, and a reader would double-count the aggressive part of the range. */
function PlayBar({ play, raise, max }) {
  const w = Math.max(0, Math.min(100, (play / max) * 100));
  const r = Math.max(0, Math.min(100, (raise / max) * 100));
  return (
    <div className="hs-meter-track" style={{ '--hs-track': 'var(--border)', position: 'relative' }}>
      <div className="hs-meter-fill" style={{ width: w + '%', background: 'var(--accent)', opacity: 0.4 }} />
      <div className="hs-meter-fill"
        style={{ width: r + '%', background: 'var(--accent)', position: 'absolute', top: 0, bottom: 0, left: 0 }} />
    </div>
  );
}

export default function RangesView({ onBack }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [node, setNode] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetchApi('/solver/ranges/td27');
        const json = await res.json().catch(() => ({ error: 'HTTP ' + res.status }));
        if (!live) return;
        if (!res.ok) setErr(json.error || 'HTTP ' + res.status);
        else setData(json);
      } catch (e) {
        if (live) setErr(e.message || 'request failed');
      }
    })();
    return () => { live = false; };
  }, []);

  const ladder = useMemo(() => {
    if (!data) return [];
    const by = {};
    for (const r of data.nodes.rows) if (r.kind === 'ladder') by[r.label] = r;
    return SEATS.map((s) => by[s]).filter(Boolean);
  }, [data]);

  const line = useMemo(() => {
    if (!data) return null;
    return data.hands.lines.find((l) => l.line === node) || null;
  }, [data, node]);

  // The gated figure(s) for the selected node, so the headline over the table is
  // the number the gate verified rather than a second derivation from the rows.
  // The OPENING node is deliberately excluded: its gated figures are the
  // positional ladder, which is already drawn above, and printing the same table
  // twice on one screen reads as two measurements of different things.
  const nodeFigs = useMemo(() => {
    if (!data || node === '') return [];
    return data.nodes.rows.filter((r) => r.kind === NODE_KIND[node]);
  }, [data, node]);

  const rows = useMemo(() => {
    if (!line) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return line.rows;
    return line.rows.filter((r) =>
      (r.hold + ' ' + r.what + ' ' + r.holds.join(' ')).toLowerCase().includes(needle));
  }, [line, q]);

  const head = (
    <StudyHead title="Pre-draw ranges" onBack={onBack}
      note="Six-max 2-7 triple draw, read off a 6-seat solve of the pre-draw betting game." />
  );

  if (err) {
    return (
      <div className="hs-view">
        {head}
        <p className="hs-t hs-sm" style={{ ...T(3, 2), marginTop: 'calc(var(--subrow) * 2)' }}>{err}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="hs-view">
        {head}
        <p className="hs-t hs-xs hs-mut" style={{ ...T(2, 2), marginTop: 'calc(var(--subrow) * 2)' }}>Loading…</p>
      </div>
    );
  }

  const v = data.nodes.verified || {};
  const maxPlay = Math.max.apply(null, ladder.map((r) => r.play).concat([1]));
  const nodeNote = (NODES.find((n) => n[0] === node) || [])[2] || '';

  return (
    <div className="hs-view">
      {head}

      {/* THE RULE. One sentence, and a measured claim rather than a slogan: the
          same two features are on the Pareto frontier at all four nodes and the
          9-group ordering is identical at all four, so what changes with the
          node is the thresholds. */}
      <div className="hs-panel hs-stack" style={{ marginTop: 'calc(var(--subrow) * 2)', '--hs-gap': 1 }}>
        <span className="hs-t hs-cap hs-mut" style={T(2, 2)}>The rule</span>
        <span className="hs-t hs-sm hs-bold" style={T(3, 2)}>A deuce, or a made low, or a one-card draw.</span>
        <span className="hs-t hs-xs hs-mut" style={T(2, 2)}>
          The same two features — how many cards you draw, and whether you hold a deuce — organise
          the range at every one of the four nodes below. Only the thresholds move.
        </span>
      </div>

      {/* THE POSITIONAL LADDER */}
      <h3 className="hs-t hs-cap" style={{ ...T(3, 2), marginTop: 'calc(var(--subrow) * 3)' }}>
        How wide, by seat
      </h3>
      <p className="hs-t hs-xs hs-mut" style={T(2, 2)}>
        First in, nobody has acted. The solid bar is raise-first-in; the pale bar is everything you play.
      </p>
      <div style={{ marginTop: 'var(--subrow)' }}>
        {ladder.map((r) => (
          <div key={r.label} className="hs-meter"
            style={{ '--hs-lab': 'calc(var(--gu) * 4)', '--hs-val': 'calc(var(--gu) * 8)' }}>
            <span className="hs-t hs-xs hs-bold" style={T(2)}>{r.label}</span>
            <PlayBar play={r.play} raise={r.raise} max={maxPlay} />
            <span className="hs-t hs-xs hs-num" style={T(2)}>
              {r.play.toFixed(1)}%
              {r.playSD != null && <span className="hs-mut"> ±{r.playSD.toFixed(2)}</span>}
            </span>
          </div>
        ))}
      </div>
      <p className="hs-t hs-xs hs-mut" style={{ ...T(2, 2), marginTop: 'var(--subrow)' }}>
        Both columns climb monotonically. The small blind is a different object — it has a blind in
        already and faces one opponent, so it folds almost nothing.
      </p>

      {/* THE NODE SELECTOR */}
      <h3 className="hs-t hs-cap" style={{ ...T(3, 2), marginTop: 'calc(var(--subrow) * 3)' }}>
        The range as hands
      </h3>
      <div className="hs-cols" style={{ '--hs-n': 4, marginTop: 'var(--subrow)' }}>
        {NODES.map(([id, label]) => (
          <button key={id || 'open'} type="button" className="hs-btn hs-pill" aria-pressed={id === node}
            onClick={() => setNode(id)}
            style={{
              '--hs-h': 4, padding: 0, fontSize: 'var(--fs-xs)', letterSpacing: '0.04em',
              fontWeight: id === node ? 'var(--fw-bold)' : 'var(--fw-semibold, 600)',
              '--hs-edge': id === node ? 'var(--text)' : 'var(--border)',
              '--hs-fill': id === node ? 'var(--text)' : 'transparent',
              '--hs-ink': id === node ? 'var(--bg)' : 'var(--text-muted)',
            }}>
            <span className="hs-t" style={T(3)}>{label}</span>
          </button>
        ))}
      </div>
      <p className="hs-t hs-xs hs-mut" style={{ ...T(2, 2), marginTop: 'var(--subrow)' }}>
        {nodeNote} These are four different situations, not one range at four seats — their play%
        figures are not a ladder.
      </p>

      {line && (
        <div className="hs-panel hs-stack" style={{ marginTop: 'calc(var(--subrow) * 2)', '--hs-gap': 1 }}>
          <div className="hs-split">
            <span className="hs-t hs-xs hs-mut" style={T(2)}>{line.name}</span>
            <span className="hs-t hs-xs hs-num" style={T(2)}>
              plays {line.playPct.toFixed(1)}% · raises {line.raisePct.toFixed(1)}%
            </span>
          </div>
          {nodeFigs.length > 0 && (
            // The hand table below is ONE seat's. These are the same decision at
            // the other seats, and saying so is the difference between context
            // and four figures a reader will attach to the wrong table.
            <span className="hs-t hs-xs hs-mut" style={T(2, 2)}>
              The same decision at each seat — the hand table below is {line.name}.
            </span>
          )}
          {nodeFigs.map((r) => (
            <div key={r.what} className="hs-split">
              <span className="hs-t hs-xs hs-mut" style={T(2)}>{r.label}</span>
              <span className="hs-t hs-xs hs-num hs-mut" style={T(2)}>
                plays {r.play.toFixed(1)}%
                {r.playSD != null ? ' ±' + r.playSD.toFixed(2) : ''} · raises {r.raise.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <input className="hs-input" type="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Find a holding — 8-7-6-5, pat 8, draw 2…"
        style={{ marginTop: 'calc(var(--subrow) * 2)' }} />

      {/* THE HAND ROWS */}
      <div style={{ marginTop: 'calc(var(--subrow) * 2)' }}>
        {rows.length === 0 && <p className="hs-t hs-xs hs-mut" style={T(2, 2)}>No row matches that.</p>}
        {rows.map((r, i) => {
          // THRESHOLD DIVIDERS, drawn where play% crosses 90 / 50 / 10. They are
          // read off the VISIBLE rows rather than a stored list, so a filtered
          // view cannot show a divider at a crossing its own rows do not make.
          const prev = i > 0 ? rows[i - 1] : null;
          const cut = [90, 50, 10].find((c) => prev && prev.play >= c && r.play < c);
          const pooled = r.holds.length > 1 ? r.holds.length : 0;
          const undet = r.playSD >= 5;
          return (
            <div key={r.cls}>
              {cut != null && (
                <div className="hs-split hs-rule" style={{ marginTop: 'var(--subrow)' }}>
                  <span className="hs-t hs-xs hs-cap hs-mut" style={T(2)}>below {cut}%</span>
                  <span className="hs-t hs-xs hs-mut hs-num" style={T(2)}>
                    {prev.play.toFixed(1)} → {r.play.toFixed(1)}
                  </span>
                </div>
              )}
              <div className="hs-meter"
                style={{ '--hs-lab': 'calc(var(--gu) * 13)', '--hs-val': 'calc(var(--gu) * 7)' }}>
                <span className="hs-t hs-xs hs-clip" style={T(2)}>
                  {r.hold}
                  {undet && (
                    <span className="hs-mut"
                      title="play% moves 5 points or more across the six seeds — this solve has not resolved this row">
                      {' ~'}
                    </span>
                  )}
                </span>
                <PlayBar play={r.play} raise={r.raise} max={100} />
                <span className="hs-t hs-xs hs-num" style={T(2)}>
                  {r.play.toFixed(0)}<span className="hs-mut">/{r.raise.toFixed(0)}</span>
                </span>
              </div>
              <div className="hs-meter"
                style={{ '--hs-lab': 'calc(var(--gu) * 13)', '--hs-val': 'calc(var(--gu) * 7)' }}>
                <span className="hs-t hs-xs hs-mut hs-clip" style={T(2)}>
                  {r.what}{pooled ? ' · ' + pooled + ' holdings, one number' : ''}
                </span>
                <span />
                <span className="hs-t hs-xs hs-mut hs-num" style={T(2)}>
                  {r.outs != null ? r.outs.toFixed(0) + '/47' : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* PROVENANCE. Not decoration: this screen's only claim to being worth
          reading is that its figures are the gated ones, so it says so, with the
          counts taken from the file rather than written in here. */}
      <div className="hs-panel hs-stack"
        style={{ marginTop: 'calc(var(--subrow) * 3)', '--hs-gap': 1, '--hs-bg': 'transparent' }}>
        <span className="hs-t hs-cap hs-mut" style={T(2, 2)}>Where this comes from</span>
        <span className="hs-t hs-xs hs-mut" style={T(2, 2)}>
          A 6-seat MCCFR solve of the pre-draw betting game at{' '}
          {Number(data.nodes.rung).toLocaleString('en-US')} iterations, averaged over{' '}
          {data.hands.nSeeds} independent seeds. {v.claims} of its figures are re-derived from the
          snapshots by a second, independent implementation whenever the deliverable changes, and{' '}
          {v.drifted || 0} disagree. A tilde marks a row this solve has not resolved: its play%
          moves 5 points or more between seeds.
        </span>
        <span className="hs-t hs-xs hs-mut" style={T(2, 2)}>
          Rows that pool several holdings have one number for all of them. That is the resolution of
          the abstraction the solver trained on, so a threshold finer than a row is not available —
          at any iteration count.
        </span>
      </div>
    </div>
  );
}
