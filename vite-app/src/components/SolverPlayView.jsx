import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from '../utils/api.js';
import Card from './SolverCard.jsx';
import StrategyRibbon from './StrategyRibbon.jsx';

// ── CFR Solver Self-Play Viewer ─────────────────────────────
// Deals a full hand and plays both seats from the trained strategy,
// then steps through every decision so you can watch the solver act:
// both hands are shown face-up, the acting seat is highlighted, and
// the solver's mixed strategy is rendered as frequency bars with the
// sampled action marked. Reuses the app's theme tokens + Univers font.

// Grid (classes in styles.css, .hs-*): every piece is whole r — text is an
// .hs-t block whose baseline is its bottom edge (b r tall, +lh r per extra
// line), controls 4r, gaps 1/2r, the table 41r — so every block starts on an
// r-line from the top bar. Panels pad 2g (content 3..34); control rows sit on
// the 8g column rails.
const T = (b, lh) => (lh ? { '--hs-b': b, '--hs-lh': lh } : { '--hs-b': b });
const R = (n) => `calc(var(--subrow) * ${n})`;

// Bare card image (no inline sizing) so the replayer's seat-card CSS
// (.replayer-seat-cards .card-row img) sizes + fans them like the replayer.
function cardImg(c, key, dim) {
  return <img key={key} className="card-img" src={`/cards/cards_gui_${c}.svg`} alt={c}
    style={dim ? { opacity: 0.5, filter: 'grayscale(0.4)' } : undefined} />;
}

// A seat on the oval felt, rendered with the replayer's own seat classes
// (plaque + fanned cards) so it matches the Hand Replayer exactly.
function TableSeat({ player, isStud, active, badge, chipLabel, pos }) {
  const cards = isStud
    ? [...player.down.map((c, i) => cardImg(c, 'd' + i, true)), ...player.up.map((c, i) => cardImg(c, 'u' + i, false))]
    : player.cards.map((c, i) => cardImg(c, i, false));
  return (
    <div className={'replayer-seat solver-rseat solver-rseat-' + pos + (active ? ' active-turn' : '')}
      style={{ left: '50%', top: pos === 'top' ? '20%' : '80%' }}>
      <div className="replayer-seat-cards"><div className="card-row">{cards}</div></div>
      <div className="replayer-seat-info">
        <div className="replayer-seat-name">
          {badge}{active && <span className="solver-toact"> ●</span>}
        </div>
        <div className="replayer-seat-stack">
          {player.handLabel || player.label}
          {chipLabel != null && <span className="solver-contrib"> · {chipLabel}</span>}
        </div>
      </div>
    </div>
  );
}

export default function SolverPlayView() {
  const [games, setGames] = useState(null);
  const [gameId, setGameId] = useState(null);
  const [play, setPlay] = useState(null);   // current playout
  const [idx, setIdx] = useState(0);        // 0..steps.length (last = result screen)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [auto, setAuto] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchApi('/solver/games');
        if (!res.ok) throw new Error('Failed to load games');
        const list = await res.json();
        setGames(list);
        const first = list.find(g => g.trained) || list[0];
        if (first) setGameId(first.id);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  const deal = useCallback(async (id) => {
    setLoading(true); setError(null); setAuto(false); setIdx(0);
    try {
      const res = await fetchApi(`/solver/playout/${id}`);
      if (!res.ok) throw new Error('Failed to deal a hand');
      setPlay(await res.json());
    } catch (e) { setError(e.message); setPlay(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (gameId) deal(gameId); }, [gameId, deal]);

  const atEnd = play && idx >= play.steps.length;

  // Autoplay: advance one decision at a time, stop at the result screen.
  useEffect(() => {
    if (!auto || !play) return;
    if (idx >= play.steps.length) { setAuto(false); return; }
    timer.current = setTimeout(() => setIdx(i => i + 1), 1700);
    return () => clearTimeout(timer.current);
  }, [auto, idx, play]);

  const step = play && !atEnd ? play.steps[idx] : null;
  const isStud = play && play.isStud;

  // Table seats come from the current step (or the result players at the end)
  const seats = step ? step.players : (play ? play.result.players : null);
  const logSource = step ? step.log : (play && play.steps.length ? play.steps[play.steps.length - 1].log : []);

  // Transport / deal buttons: 4r, label baseline 3r down ((4 + 1.1 cap) / 2 = 2.55 → 3).
  const ctrlBtn = (txt, onClick, disabled, primary, extra) => (
    <button className="hs-btn" onClick={onClick} disabled={disabled} style={{
      '--hs-h': 4, padding: 0,
      '--hs-edge': primary ? 'var(--accent)' : 'var(--border)',
      '--hs-fill': primary ? 'var(--brand)' : 'transparent', '--hs-ink': primary ? 'var(--on-brand)' : 'var(--text)',
      ...extra,
    }}><span className="hs-t" style={T(3)}>{txt}</span></button>
  );

  return (
    <div className="hs-view" style={{ maxWidth: R(70) }}>
      {/* Title: 4r block (baseline on its bottom); subtitle 2r caps line under it. */}
      <h2 className="screen-title hs-t hs-title" style={T(4)}>Solver Self-Play</h2>
      <p className="hs-t hs-cap" style={T(2, 2)}>Watch the trained strategy play both seats</p>

      {/* Game picker — 4r pills on the four 8g rails, 1r between rows; 2r above. */}
      {games && games.length > 0 && (
        <div className="hs-cols" style={{ '--hs-n': 4, marginTop: R(2) }}>
          {games.map(g => (
            <button key={g.id} className="hs-btn hs-pill" onClick={() => setGameId(g.id)} disabled={!g.trained}
              style={{
                '--hs-h': 4, padding: 0, fontSize: 'var(--fs-xs)',
                '--hs-edge': g.id === gameId ? 'var(--accent)' : 'var(--border)',
                '--hs-fill': g.id === gameId ? 'var(--accent)' : 'transparent',
                '--hs-ink': g.id === gameId ? '#fff' : (g.trained ? 'var(--text)' : 'var(--text-muted)'),
              }}>
              <span className="hs-t" style={T(3)}>{g.name}{!g.trained && ' (untrained)'}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="hs-panel" style={{ marginTop: R(2), '--hs-edge': 'var(--neg, #ef4444)' }}>
          <div className="hs-t hs-sm" style={{ ...T(3, 3), color: 'var(--neg, #ef4444)' }}>{error}</div>
        </div>
      )}
      {loading && <div className="hs-t hs-sm hs-mut" style={{ ...T(3, 3), marginTop: R(2) }}>Dealing…</div>}

      {play && seats && !loading && (
        <>
          {/* Street + pot header — one 3r line, 2r above. */}
          <div className="hs-split" style={{ marginTop: R(2) }}>
            <span className="hs-t hs-md hs-bold" style={T(3)}>{atEnd ? 'Showdown' : step.streetName}</span>
            <span className="hs-t hs-cap hs-clip" style={T(3)}>
              Pot {atEnd ? play.result.pot : step.pot}
              {' · '}{atEnd ? 'hand complete' : `decision ${idx + 1} of ${play.steps.length}`}
            </span>
          </div>

          {/* Oval felt table (reuses the replayer's table + seat graphics).
              .solver-table: 35g × 41r, 1r above, 2r below; the felt, seats and
              cards inside scale with it (container units). */}
          <div className="solver-table">
            <div className="replayer-table-rail" style={{ '--rail-color': '#6b5b8a' }} />
            <div className="replayer-table-felt" />
            <div className="solver-tpot">POT {atEnd ? play.result.pot : step.pot}</div>
            <TableSeat pos="top" player={seats[1]} isStud={isStud}
              badge={isStud ? 'Player 2' : 'Big Blind'}
              active={!atEnd && step.actor === 1}
              chipLabel={step ? step.contrib[1] : null} />
            <TableSeat pos="bottom" player={seats[0]} isStud={isStud}
              badge={isStud ? 'Player 1' : 'Button (SB)'}
              active={!atEnd && step.actor === 0}
              chipLabel={step ? step.contrib[0] : null} />
          </div>

          {/* Dead cards discarded so far (draw games), kept off the felt.
              Each row 4r: caps label on 1..9 (baseline 3r down), 2g × 4r cards from 10g. */}
          {!isStud && (seats[0].discards?.length > 0 || seats[1].discards?.length > 0) && (
            <div className="hs-stack" style={{ marginBottom: R(2) }}>
              {[seats[0], seats[1]].map((s, si) => s.discards?.length > 0 && (
                <div key={si} style={{ display: 'grid', gridTemplateColumns: 'calc(var(--gu) * 9) 1fr', alignItems: 'start' }}>
                  <span className="hs-t hs-cap" style={T(3)}>{si === 0 ? 'Button' : 'BB'} dead</span>
                  <div className="hs-cards">{s.discards.map((c, i) => <Card key={si + '-' + i} str={c} dim size="sm" />)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Strategy for the current decision — panel: 2r caps label, 1r, ribbon, 1r, why. */}
          {step && (
            <div className="hs-panel hs-stack">
              <div className="hs-t hs-cap" style={T(2, 2)}>
                {(isStud ? `Player ${step.actor + 1}` : (step.actor === 0 ? 'Button' : 'Big Blind'))} ·
                {step.kind === 'draw' ? ' draw strategy' : ' betting strategy'}
                {!step.trained && ' · (unvisited — uniform)'}
              </div>
              {/* One ribbon instead of a row per action: the mix now sums to 100% by construction. */}
              <StrategyRibbon actions={step.actions.map(a => ({ id: a.id, label: a.label, prob: a.prob, ev: a.ev }))} chosen={step.chosen} best={step.best} showEv />
              {step.explain && (
                /* Hairline rule (inset, no height) + 1r, then 3r lines. */
                <div className="hs-rule">
                  <div className="hs-t hs-sm hs-mut" style={T(3, 3)}>
                    {/* lineHeight 0: a smaller inline font with the block's 3r line-height sits lower and would grow the line box by 0.19r */}
                    <span style={{ fontSize: 'var(--fs-2xs)', lineHeight: 0, textTransform: 'uppercase', letterSpacing: 'var(--track-caps)', color: 'var(--accent)', marginRight: 'var(--gu)' }}>Why</span>
                    {step.explain}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Result */}
          {atEnd && (
            <div className="hs-panel hs-stack">
              <div className="hs-t hs-cap" style={T(2)}>Result</div>
              <ResultBody result={play.result} isStud={isStud} />
            </div>
          )}

          {/* Controls — four 8g transport buttons on the column rails, the deal
              button across all four below; 4r each, 1r gaps, 1r above. */}
          <div className="hs-cols" style={{ '--hs-n': 4, marginTop: 'var(--subrow)' }}>
            {ctrlBtn('⏮', () => { setAuto(false); setIdx(0); }, idx === 0)}
            {ctrlBtn('◀ Prev', () => { setAuto(false); setIdx(i => Math.max(0, i - 1)); }, idx === 0)}
            {ctrlBtn(auto ? '⏸ Pause' : '▶ Play', () => setAuto(a => !a), atEnd)}
            {ctrlBtn('Next ▶', () => { setAuto(false); setIdx(i => Math.min(play.steps.length, i + 1)); }, atEnd)}
            {ctrlBtn('Deal New Hand', () => deal(gameId), false, true, { gridColumn: '1 / -1' })}
          </div>

          {/* Action log — panel: 2r caps label, 1r, 2r lines. */}
          {logSource && logSource.length > 0 && (
            <div className="hs-panel hs-stack" style={{ marginTop: 'var(--subrow)' }}>
              <div className="hs-t hs-cap" style={T(2)}>Action log</div>
              <div>
                {logSource.map((e, i) => (
                  <div key={i} className="hs-t hs-xs hs-mut" style={T(2, 2)}><b style={{ color: 'var(--text)' }}>{e.who}</b> {e.what}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Result rows: a 4r row per player — caps name on 3..10 (baseline 3r down),
// 2g × 4r cards from the 10g line, the hand label after them.
const resRow = { display: 'grid', gridTemplateColumns: 'calc(var(--gu) * 7) auto minmax(0, 1fr)', columnGap: 'var(--gu)', alignItems: 'start' };

function ResultBody({ result, isStud }) {
  if (!isStud) {
    const outcome = result.winner < 0
      ? 'Split pot'
      : `${result.winner === 0 ? 'Button' : 'Big Blind'} wins ${result.profit}` +
        (result.type === 'fold' ? ' (opponent folded)' : '');
    return (
      <>
        <div className="hs-t hs-sm hs-bold" style={T(3, 3)}>{outcome}</div>
        {result.players.map((p, i) => (
          <div key={i} style={{ ...resRow, columnGap: 0 }}>
            <span className="hs-t hs-cap" style={T(3)}>{i === 0 ? 'Button' : 'Big Blind'}</span>
            <div className="hs-cards">{p.cards.map((c, j) => <Card key={j} str={c} size="sm" />)}</div>
            {/* wrapper: a grid item with overflow:hidden gets a 0 min-content height under text-box-trim in WebKit */}
            <div style={{ minWidth: 0, paddingLeft: 'var(--gu)' }}><span className="hs-t hs-xs hs-mut hs-clip" style={T(3)}>{p.label}</span></div>
          </div>
        ))}
      </>
    );
  }
  // Stud 8: hi/lo split summary
  const who = w => (w < 0 ? 'split' : `Player ${w + 1}`);
  let summary;
  if (result.type === 'fold') summary = `Player ${result.hiWinner + 1} wins ${result.profit} (opponent folded)`;
  else if (result.scoop) summary = `Player ${result.hiWinner + 1} scoops`;
  else if (result.loWinner === null) summary = `${who(result.hiWinner)} wins high (no qualifying low)`;
  else summary = `High: ${who(result.hiWinner)} · Low: ${who(result.loWinner)}`;
  return (
    <>
      <div className="hs-t hs-sm hs-bold" style={T(3, 3)}>{summary}</div>
      {result.players.map((p, i) => (
        <div key={i}>
          <div style={{ ...resRow, columnGap: 0, gridTemplateColumns: 'calc(var(--gu) * 7) minmax(0, 1fr)' }}>
            <span className="hs-t hs-cap" style={T(3)}>Player {i + 1}</span>
            <div className="hs-cards">
              {p.down.map((c, j) => <Card key={'d' + j} str={c} dim size="sm" />)}
              {p.up.map((c, j) => <Card key={'u' + j} str={c} size="sm" />)}
            </div>
          </div>
          <div className="hs-t hs-cap" style={{ ...T(2, 2), paddingLeft: 'calc(var(--gu) * 7)' }}>hi: {p.hi} · lo: {p.lo}</div>
        </div>
      ))}
    </>
  );
}
