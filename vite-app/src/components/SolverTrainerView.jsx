import React, { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../utils/api.js';
import Card from './SolverCard.jsx';

// ── CFR Solver Trainer ──────────────────────────────────────
// Quiz mode against pre-trained MCCFR strategies (2-7 Triple Draw,
// Badugi, Stud 8 or Better). The server deals a hand, plays both
// seats from the solved strategy to a random decision point, and we
// ask the user what they'd do; then reveal the solver's mixed
// strategy and keep a running score.

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
  const isStud = gameId === 'stud8';

  const label = { fontSize: 'calc(var(--gu) * 0.913)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 'calc(var(--subrow) * 2)' };
  // Grid: 1px border absorbed into padding so panel inner content lands on 2g / subrow lines.
  const panel = { background: 'var(--surface)', border: 'var(--bw-hair) solid var(--border)', borderRadius: 'var(--radius)', padding: 'calc(var(--subrow) * 2 - calc(var(--subrow)*0.125)) calc(var(--gu) - calc(var(--subrow)*0.125))' };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '0 0 calc(var(--subrow) * 10)', maxWidth: 'calc(var(--subrow) * 70)', margin: '0 auto', fontFamily: "'Univers Condensed', 'Univers', sans-serif" }}>
      {/* Grid: title box 4 subrows, baseline seated on T12; subtitle a 2-subrow box. */}
      <h2 className="screen-title" style={{ fontSize: 'calc(var(--gu) * 1.767)', margin: 0, height: 'calc(var(--subrow) * 4)', boxSizing: 'border-box', lineHeight: 'calc(var(--subrow) * 4)', paddingTop: 'calc(var(--subrow) * 0.125)' }}>Solver Trainer</h2>
      <p style={{ ...label, margin: '0 0 var(--subrow)', height: 'calc(var(--subrow) * 2)' }}>Heads-up fixed limit · CFR strategies</p>

      {/* Game picker — 4-subrow pills, 1-subrow row gap when they wrap */}
      <div style={{ display: 'flex', columnGap: 'var(--space-sm)', rowGap: 'var(--space-md)', marginBottom: 'calc(var(--subrow) * 2)', flexWrap: 'wrap' }}>
        {(games || []).map(g => (
          <button key={g.id} onClick={() => setGameId(g.id)} disabled={!g.trained}
            style={{
              height: 'calc(var(--subrow) * 4)', boxSizing: 'border-box', padding: '0 var(--space-lg)', borderRadius: 'var(--radius-lg)', cursor: g.trained ? 'pointer' : 'default',
              border: 'var(--bw-hair) solid ' + (g.id === gameId ? 'var(--accent)' : 'var(--border)'),
              background: g.id === gameId ? 'var(--accent)' : 'transparent',
              color: g.id === gameId ? '#fff' : (g.trained ? 'var(--text)' : 'var(--text-muted)'),
              fontFamily: 'inherit', fontSize: 'calc(var(--gu) * 1.104)', fontWeight: 'var(--fw-bold)', opacity: g.trained ? 1 : 0.5,
            }}>
            {g.name}{!g.trained && ' (untrained)'}
          </button>
        ))}
      </div>

      {error && <div style={{ ...panel, color: '#ef4444', marginBottom: 'var(--subrow)' }}>{error}</div>}
      {!games && !error && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}

      {game && (
        <div style={{ ...label, marginBottom: 'var(--subrow)' }}>
          {game.stakes}{game.trained ? ` · ${game.iterations.toLocaleString()} iterations · ${game.infosets.toLocaleString()} infosets` : ''}
        </div>
      )}

      {loading && <div style={{ color: 'var(--text-muted)', padding: 'var(--space-2xl) 0' }}>Dealing…</div>}

      {spot && d && !loading && (
        <>
          {/* Situation */}
          <div style={{ ...panel, marginBottom: 'var(--subrow)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', height: 'calc(var(--subrow) * 3)', marginBottom: 'var(--subrow)' }}>
              <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 'calc(var(--gu) * 1.325)', lineHeight: 'calc(var(--subrow) * 3)' }}>{d.streetName}</span>
              <span style={{ ...label, lineHeight: 'calc(var(--subrow) * 3)' }}>{d.position} · Pot {d.pot}{d.toCall > 0 ? ` · ${d.toCall} to call` : ''}</span>
            </div>

            {isStud ? (
              <>
                <div style={{ ...label, marginBottom: 'var(--space-md)' }}>Opponent shows</div>
                <div style={{ marginBottom: 'var(--space-md)' }}>
                  {d.oppUp.map((c, i) => <Card key={i} str={c} />)}
                </div>
                <div style={{ ...label, marginBottom: 'var(--space-md)' }}>Your hand (first {d.heroDown.length === 2 ? 'two' : 'cards'} hidden)</div>
                <div>
                  {d.heroDown.map((c, i) => <Card key={'d' + i} str={c} />)}
                  {d.heroUp.map((c, i) => <Card key={'u' + i} str={c} />)}
                </div>
              </>
            ) : (
              <>
                <div style={{ ...label, marginBottom: 'var(--space-md)' }}>
                  Your hand · {d.handLabel}
                  {d.oppDraws.length > 0 && ` · opp drew ${d.oppDraws.join(', ')}`}
                </div>
                <div>{d.heroCards.map((c, i) => <Card key={i} str={c} />)}</div>
                {d.myDiscards && d.myDiscards.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', marginTop: 'var(--space-md)' }}>
                    <span style={{ ...label, marginRight: 'var(--space-md)' }}>your dead cards</span>
                    {d.myDiscards.map((c, i) => <Card key={'x' + i} str={c} dim size="sm" />)}
                  </div>
                )}
              </>
            )}

            {/* Action log */}
            {d.log.length > 0 && (
              <div style={{ marginTop: 'var(--subrow)', paddingTop: 'calc(var(--subrow) - calc(var(--subrow)*0.125))', borderTop: 'var(--bw-hair) solid var(--border)', fontSize: 'calc(var(--gu) * 1.060)', color: 'var(--text-muted)', lineHeight: 'calc(var(--subrow) * 2)' }}>
                {d.log.map((e, i) => <div key={i}><b style={{ color: e.who === 'Hero' ? 'var(--accent)' : 'inherit' }}>{e.who}</b> {e.what}</div>)}
              </div>
            )}
          </div>

          {/* Actions / answer */}
          <div style={{ ...panel, marginBottom: 'var(--subrow)' }}>
            <div style={{ ...label, marginBottom: 'var(--subrow)' }}>{picked ? 'Solver strategy' : 'What do you do?'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {spot.actions.map(a => {
                const isPick = picked === a.id;
                const isBest = picked && a.prob >= Math.max(...spot.actions.map(x => x.prob)) - 0.001;
                return (
                  <button key={a.id} onClick={() => pick(a.id)}
                    style={{
                      position: 'relative', overflow: 'hidden', textAlign: 'left',
                      display: 'flex', alignItems: 'center', height: 'calc(var(--subrow) * 5)', boxSizing: 'border-box',
                      padding: '0 var(--space-lg)', borderRadius: 'var(--radius-sm)', cursor: picked ? 'default' : 'pointer',
                      border: 'var(--bw-hair) solid ' + (isPick ? 'var(--accent)' : isBest ? '#22c55e' : 'var(--border)'),
                      background: 'transparent', color: 'var(--text)', fontFamily: 'inherit', fontSize: 'calc(var(--gu) * 1.252)', fontWeight: 'var(--fw-bold)',
                    }}>
                    {picked && (
                      <span style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: `${Math.round(a.prob * 100)}%`,
                        background: isBest ? 'rgba(34,197,94,0.18)' : 'rgba(128,128,128,0.12)',
                        transition: 'width 0.4s ease',
                      }} />
                    )}
                    <span style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span>{a.label}{isPick ? ' ←' : ''}</span>
                      {picked && <span style={{ color: isBest ? '#22c55e' : 'var(--text-muted)' }}>{Math.round(a.prob * 100)}%</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {picked && !spot.trained && (
              <div style={{ ...label, marginTop: 'var(--space-md)', color: '#eab308' }}>
                Note: this exact spot wasn't visited enough in training — strategy shown is uniform.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 'calc(var(--subrow) * 5)' }}>
            <span style={label}>
              {score.spots > 0 && `${score.best}/${score.spots} matched solver · avg weight ${Math.round((score.probSum / score.spots) * 100)}%`}
            </span>
            <button onClick={() => dealSpot(gameId)}
              style={{
                height: 'calc(var(--subrow) * 5)', boxSizing: 'border-box', padding: '0 calc(var(--subrow) * 2.25)', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--brand)',
                color: 'var(--on-brand)', fontFamily: 'inherit', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-bold)', cursor: 'pointer',
              }}>
              {picked ? 'Next Spot' : 'Skip'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
