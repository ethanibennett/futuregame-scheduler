import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from '../utils/api.js';
import Card from './SolverCard.jsx';

// ── CFR Solver Self-Play Viewer ─────────────────────────────
// Deals a full hand and plays both seats from the trained strategy,
// then steps through every decision so you can watch the solver act:
// both hands are shown face-up, the acting seat is highlighted, and
// the solver's mixed strategy is rendered as frequency bars with the
// sampled action marked. Reuses the app's theme tokens + Univers font.

const FONT = "'Univers Condensed', 'Univers', sans-serif";
const label = { fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' };
const panel = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' };

// One strategy row: action label, frequency bar, percentage. The
// sampled action is accented and check-marked.
function StrategyRow({ action, chosen }) {
  const pct = Math.round(action.prob * 100);
  const isChosen = action.id === chosen;
  return (
    <div style={{ position: 'relative', overflow: 'hidden', padding: '8px 10px', borderRadius: 8, marginBottom: 5,
      border: '1px solid ' + (isChosen ? 'var(--accent)' : 'var(--border)') }}>
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`,
        background: isChosen ? 'rgba(74,158,255,0.20)' : 'rgba(128,128,128,0.12)' }} />
      <span style={{ position: 'relative', display: 'flex', justifyContent: 'space-between',
        fontSize: '0.82rem', fontWeight: 'var(--fw-bold)', color: 'var(--text)' }}>
        <span>{isChosen ? '✓ ' : ''}{action.label}</span>
        <span style={{ color: isChosen ? 'var(--accent)' : 'var(--text-muted)' }}>{pct}%</span>
      </span>
    </div>
  );
}

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

  const ctrlBtn = (txt, onClick, disabled, primary) => (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '7px 12px', borderRadius: 8, fontFamily: FONT, fontSize: '0.78rem', fontWeight: 700,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
      border: '1px solid ' + (primary ? 'var(--accent)' : 'var(--border)'),
      background: primary ? 'var(--accent)' : 'transparent', color: primary ? '#fff' : 'var(--text)',
    }}>{txt}</button>
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '12px 14px 80px', maxWidth: 560, margin: '0 auto', fontFamily: FONT }}>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' }}>Solver Self-Play</h2>
      <p style={{ ...label, margin: '0 0 10px' }}>Watch the trained strategy play both seats</p>

      {/* Game picker */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {(games || []).map(g => (
          <button key={g.id} onClick={() => setGameId(g.id)} disabled={!g.trained}
            style={{ padding: '6px 12px', borderRadius: 16, cursor: g.trained ? 'pointer' : 'default',
              border: '1px solid ' + (g.id === gameId ? 'var(--accent)' : 'var(--border)'),
              background: g.id === gameId ? 'var(--accent)' : 'transparent',
              color: g.id === gameId ? '#fff' : (g.trained ? 'var(--text)' : 'var(--text-muted)'),
              fontFamily: FONT, fontSize: '0.75rem', fontWeight: 'var(--fw-bold)', opacity: g.trained ? 1 : 0.5 }}>
            {g.name}{!g.trained && ' (untrained)'}
          </button>
        ))}
      </div>

      {error && <div style={{ ...panel, color: '#ef4444', marginBottom: 12 }}>{error}</div>}
      {loading && <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Dealing…</div>}

      {play && seats && !loading && (
        <>
          {/* Street + pot header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 2px 8px' }}>
            <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.9rem' }}>
              {atEnd ? 'Showdown' : step.streetName}
            </span>
            <span style={label}>
              Pot {atEnd ? play.result.pot : step.pot}
              {' · '}{atEnd ? 'hand complete' : `decision ${idx + 1} of ${play.steps.length}`}
            </span>
          </div>

          {/* Oval felt table (reuses the replayer's table + seat graphics) */}
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

          {/* Dead cards discarded so far (draw games), kept off the felt */}
          {!isStud && (seats[0].discards?.length > 0 || seats[1].discards?.length > 0) && (
            <div className="solver-deadstrip">
              {[seats[0], seats[1]].map((s, si) => s.discards?.length > 0 && (
                <div key={si} className="solver-dead-row">
                  <span className="solver-dead-label">{si === 0 ? 'Button' : 'BB'} dead</span>
                  {s.discards.map((c, i) => cardImg(c, si + '-' + i, true))}
                </div>
              ))}
            </div>
          )}

          {/* Strategy bars for the current decision */}
          {step && (
            <div style={{ ...panel, marginBottom: 10 }}>
              <div style={{ ...label, marginBottom: 8 }}>
                {(isStud ? `Player ${step.actor + 1}` : (step.actor === 0 ? 'Button' : 'Big Blind'))} ·
                {step.kind === 'draw' ? ' draw strategy' : ' betting strategy'}
                {!step.trained && ' · (unvisited — uniform)'}
              </div>
              {step.actions.map(a => <StrategyRow key={a.id} action={a} chosen={step.chosen} />)}
              {step.explain && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)',
                  fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  <span style={{ ...label, color: 'var(--accent)', marginRight: 6 }}>Why</span>
                  {step.explain}
                </div>
              )}
            </div>
          )}

          {/* Result */}
          {atEnd && (
            <div style={{ ...panel, marginBottom: 10 }}>
              <div style={{ ...label, marginBottom: 8 }}>Result</div>
              <ResultBody result={play.result} isStud={isStud} />
            </div>
          )}

          {/* Controls */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            {ctrlBtn('⏮', () => { setAuto(false); setIdx(0); }, idx === 0)}
            {ctrlBtn('◀ Prev', () => { setAuto(false); setIdx(i => Math.max(0, i - 1)); }, idx === 0)}
            {ctrlBtn(auto ? '⏸ Pause' : '▶ Play', () => setAuto(a => !a), atEnd)}
            {ctrlBtn('Next ▶', () => { setAuto(false); setIdx(i => Math.min(play.steps.length, i + 1)); }, atEnd)}
            {ctrlBtn('Deal New Hand', () => deal(gameId), false, true)}
          </div>

          {/* Action log */}
          {logSource && logSource.length > 0 && (
            <div style={{ ...panel }}>
              <div style={{ ...label, marginBottom: 6 }}>Action log</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {logSource.map((e, i) => (
                  <div key={i}><b style={{ color: 'var(--text)' }}>{e.who}</b> {e.what}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ResultBody({ result, isStud }) {
  if (!isStud) {
    const outcome = result.winner < 0
      ? 'Split pot'
      : `${result.winner === 0 ? 'Button' : 'Big Blind'} wins ${result.profit}` +
        (result.type === 'fold' ? ' (opponent folded)' : '');
    return (
      <div>
        <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{outcome}</div>
        {result.players.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ ...label, width: 64 }}>{i === 0 ? 'Button' : 'Big Blind'}</span>
            {p.cards.map((c, j) => <Card key={j} str={c} size="sm" />)}
            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginLeft: 4 }}>{p.label}</span>
          </div>
        ))}
      </div>
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
    <div>
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{summary}</div>
      {result.players.map((p, i) => (
        <div key={i} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ ...label, width: 64 }}>Player {i + 1}</span>
            {p.down.map((c, j) => <Card key={'d' + j} str={c} dim size="sm" />)}
            {p.up.map((c, j) => <Card key={'u' + j} str={c} size="sm" />)}
          </div>
          <div style={{ ...label, marginLeft: 64, marginTop: 2 }}>hi: {p.hi} · lo: {p.lo}</div>
        </div>
      ))}
    </div>
  );
}
