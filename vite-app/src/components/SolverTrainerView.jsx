import React, { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../utils/api.js';
import Card from './SolverCard.jsx';

// ── CFR Solver Trainer ──────────────────────────────────────
// Quiz mode against pre-trained MCCFR strategies (2-7 Triple Draw,
// Badugi, Stud 8 or Better). The server deals a hand, plays both
// seats from the solved strategy to a random decision point, and we
// ask the user what they'd do; then reveal the solver's mixed
// strategy and keep a running score.
//
// Grid (classes in styles.css, .hs-*): every piece is whole r — text is an
// .hs-t block whose baseline is its bottom edge (b r tall, +lh r per extra
// line), controls 4/5r, gaps 1/2r — so every block starts on an r-line from
// the top bar. Horizontally: full width 1..36, panels pad 2g (content 3..34),
// rows of controls are 8g/17g grid columns on the page rails.

const T = (b, lh) => (lh ? { '--hs-b': b, '--hs-lh': lh } : { '--hs-b': b });
const R = (n) => `calc(var(--subrow) * ${n})`;

export default function SolverTrainerView() {
  const [games, setGames] = useState(null);
  const [gameId, setGameId] = useState(null);
  const [spot, setSpot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(null); // chosen action id (reveals answer)
  const [score, setScore] = useState({ spots: 0, best: 0, probSum: 0 });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchApi('/solver/games');
        if (!res.ok) throw new Error('Failed to load games');
        const list = await res.json();
        setGames(list);
        const firstTrained = list.find(g => g.trained) || list[0];
        if (firstTrained) setGameId(firstTrained.id);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, []);

  const dealSpot = useCallback(async (id) => {
    setLoading(true); setError(null); setPicked(null);
    try {
      const res = await fetchApi(`/solver/spot/${id}`);
      if (!res.ok) throw new Error('Failed to deal a spot');
      setSpot(await res.json());
    } catch (e) {
      setError(e.message); setSpot(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (gameId) dealSpot(gameId); }, [gameId, dealSpot]);

  const pick = (actionId) => {
    if (picked || !spot) return;
    setPicked(actionId);
    const chosen = spot.actions.find(a => a.id === actionId);
    const maxProb = Math.max(...spot.actions.map(a => a.prob));
    setScore(s => ({
      spots: s.spots + 1,
      best: s.best + (chosen.prob >= maxProb - 0.001 ? 1 : 0),
      probSum: s.probSum + chosen.prob,
    }));
  };

  const game = games && games.find(g => g.id === gameId);
  const d = spot && spot.description;
  // From the spot itself, not the picker: switching game re-renders with the
  // new gameId one frame before the new spot arrives, and keying this off
  // gameId read the old draw spot as stud (d.oppUp undefined → crash).
  const isStud = !!(d && Array.isArray(d.oppUp));

  return (
    <div className="hs-view" style={{ maxWidth: R(70) }}>
      {/* Title: 4r block, baseline 4r below the view top; subtitle 2r caps line under it. */}
      <h2 className="screen-title hs-t hs-title" style={T(4)}>Solver Trainer</h2>
      <p className="hs-t hs-cap" style={T(2, 2)}>Heads-up fixed limit · CFR strategies</p>

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
      {!games && !error && <div className="hs-t hs-sm hs-mut" style={{ ...T(3, 3), marginTop: R(2) }}>Loading…</div>}

      {game && (
        <div className="hs-t hs-cap" style={{ ...T(2, 2), marginTop: R(2) }}>
          {game.stakes}{game.trained ? ` · ${game.iterations.toLocaleString()} iterations · ${game.infosets.toLocaleString()} infosets` : ''}
        </div>
      )}

      {loading && <div className="hs-t hs-sm hs-mut" style={{ ...T(3, 3), marginTop: R(2) }}>Dealing…</div>}

      {spot && d && !loading && (
        <>
          {/* Situation — panel 2r × 2g; 3r header line, then 1r-spaced rows. */}
          <div className="hs-panel hs-stack" style={{ marginTop: R(2) }}>
            <div className="hs-split">
              <span className="hs-t hs-md hs-bold" style={T(3)}>{d.streetName}</span>
              <span className="hs-t hs-cap hs-clip" style={T(3)}>{d.position} · Pot {d.pot}{d.toCall > 0 ? ` · ${d.toCall} to call` : ''}</span>
            </div>

            {isStud ? (
              <>
                <div className="hs-t hs-cap" style={T(2, 2)}>Opponent shows</div>
                <div className="hs-cards">
                  {d.oppUp.map((c, i) => <Card key={i} str={c} />)}
                </div>
                <div className="hs-t hs-cap" style={T(2, 2)}>Your hand (first {d.heroDown.length === 2 ? 'two' : 'cards'} hidden)</div>
                <div className="hs-cards">
                  {d.heroDown.map((c, i) => <Card key={'d' + i} str={c} />)}
                  {d.heroUp.map((c, i) => <Card key={'u' + i} str={c} />)}
                </div>
              </>
            ) : (
              <>
                <div className="hs-t hs-cap" style={T(2, 2)}>
                  Your hand · {d.handLabel}
                  {d.oppDraws.length > 0 && ` · opp drew ${d.oppDraws.join(', ')}`}
                </div>
                <div className="hs-cards">{d.heroCards.map((c, i) => <Card key={i} str={c} />)}</div>
                {d.myDiscards && d.myDiscards.length > 0 && (
                  /* 4r row: caps label (baseline 3r down) then 2g × 4r dead cards from 12g. */
                  <div style={{ display: 'grid', gridTemplateColumns: 'calc(var(--gu) * 9) 1fr', columnGap: 0, alignItems: 'start' }}>
                    <span className="hs-t hs-cap" style={T(3)}>your dead cards</span>
                    <div className="hs-cards">{d.myDiscards.map((c, i) => <Card key={'x' + i} str={c} dim size="sm" />)}</div>
                  </div>
                )}
              </>
            )}

            {/* Action log — hairline rule (inset, no height) + 1r, then 2r lines. */}
            {d.log.length > 0 && (
              <div className="hs-rule">
                {d.log.map((e, i) => (
                  <div key={i} className="hs-t hs-xs hs-mut" style={T(2, 2)}>
                    <b style={{ color: e.who === 'Hero' ? 'var(--accent)' : 'inherit' }}>{e.who}</b> {e.what}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions / answer — 2r caps label, 1r, then 5r buttons 1r apart across 3..34. */}
          <div className="hs-panel hs-stack" style={{ marginTop: 'var(--subrow)' }}>
            <div className="hs-t hs-cap" style={T(2)}>{picked ? 'Solver strategy' : 'What do you do?'}</div>
            {spot.actions.map(a => {
              const isPick = picked === a.id;
              const isBest = picked && a.prob >= Math.max(...spot.actions.map(x => x.prob)) - 0.001;
              return (
                <button key={a.id} className="hs-btn hs-left" onClick={() => pick(a.id)}
                  style={{
                    '--hs-h': 5, position: 'relative', overflow: 'hidden', cursor: picked ? 'default' : 'pointer',
                    '--hs-edge': isPick ? 'var(--accent)' : isBest ? '#22c55e' : 'var(--border)',
                  }}>
                  {picked && (
                    <span style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      width: `${Math.round(a.prob * 100)}%`,
                      background: isBest ? 'rgba(34,197,94,0.18)' : 'rgba(128,128,128,0.12)',
                      transition: 'width 0.4s ease',
                    }} />
                  )}
                  <span className="hs-split" style={{ position: 'relative' }}>
                    <span className="hs-t" style={T(3)}>{a.label}{isPick ? ' ←' : ''}</span>
                    {picked && <span className="hs-t" style={{ ...T(3), color: isBest ? '#22c55e' : 'var(--text-muted)' }}>{Math.round(a.prob * 100)}%</span>}
                  </span>
                </button>
              );
            })}
            {picked && !spot.trained && (
              <div className="hs-t hs-cap" style={{ ...T(2, 2), color: '#eab308' }}>
                Note: this exact spot wasn't visited enough in training — strategy shown is uniform.
              </div>
            )}
          </div>

          {/* Footer — 5r row: score on cols 1–3 (baseline 3r down), button on col 4 (28..36). */}
          <div className="hs-cols" style={{ '--hs-n': 4, marginTop: 'var(--subrow)' }}>
            <span className="hs-t hs-cap" style={{ ...T(3, 2), gridColumn: '1 / 4' }}>
              {score.spots > 0 && `${score.best}/${score.spots} matched solver · avg weight ${Math.round((score.probSum / score.spots) * 100)}%`}
            </span>
            <button className="hs-btn" onClick={() => dealSpot(gameId)}
              style={{ '--hs-h': 5, gridColumn: '4', '--hs-edge': 'transparent', '--hs-fill': 'var(--brand)', '--hs-ink': 'var(--on-brand)' }}>
              <span className="hs-t" style={T(3)}>{picked ? 'Next Spot' : 'Skip'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
