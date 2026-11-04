// The replayer drill: play a hand against the solver on the replayer's own table, the way the Trainer
// plays one, then see every decision graded (owner, 2026-11-03). The hand comes from the Trainer's
// deal and step routes, the same seed-and-replay contract, and is saved to the same history. A draw
// is graded by both tools, each labelled: the drill grader, and the study tool over every discard.
// The table is HandReplayerView's, handed in as `Replay` so the two files do not import each other.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchApi } from '../utils/api.js';
import { GradeCard, ResultBanner, applyHandToSession, loadSession, saveSession } from './RazzTrainerView.jsx';
import {
  DRILL_GAMES, drillGame, drillStart, drillStep, buildDrillHand, encodeDiscard, opponentDrawNote,
  heroActionIndexForStreet, studyVerdict, drillOptimalCaveat, drillGradeSource,
} from '../utils/replayer-drill.js';
import './replayer-drill.css';

const T = (b, lh) => (lh ? { '--hs-b': b, '--hs-lh': lh } : { '--hs-b': b });
const GAME_KEY = 'replayerDrillGame';

function storedGame() {
  try { const v = localStorage.getItem(GAME_KEY); return drillGame(v) ? v : 'td27'; } catch { return 'td27'; }
}
function storeGame(id) {
  try { localStorage.setItem(GAME_KEY, id); } catch { /* the choice just is not remembered */ }
}

async function postJson(path, body) {
  const res = await fetchApi(path, { method: 'POST', body });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `server returned ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// The action bar, in the replayer's bottom slot while the hand is live.
function DrillBar({ drill, game, thrown, busy, onAct }) {
  const { state, legalActions, drawDecision } = drill;
  const note = opponentDrawNote(state);
  const dead = state.deadCards && state.deadCards.length ? state.deadCards : null;

  if (drawDecision) {
    // The cards themselves are on the felt: the table marks them (HandReplayerView's `drill.discard`).
    const n = thrown.size;
    return (
      <div className="hs-view rd-bar snap-place">
        <div className="hs-t hs-sm rd-status" style={T(2)}>{note ? note + '. ' : ''}Tap your cards to throw</div>
        <button type="button" className="hs-btn rd-primary" disabled={busy} onClick={() => onAct(encodeDiscard([...thrown]))}>
          <span className="hs-t" style={T(3)}>{n === 0 ? 'Stand pat' : `Draw ${n}`}</span>
        </button>
      </div>
    );
  }

  const actions = legalActions || [];
  return (
    <div className="hs-view rd-bar snap-place">
      <div className="hs-t hs-sm rd-status" style={T(2)}>
        {game.label}{dead ? ' · dead ' + dead.join(' ') : ''}
      </div>
      <div className={actions.length === 3 ? 'hs-cols3' : 'hs-cols'} style={{ '--hs-n': 2 }}>
        {actions.map((a) => (
          <button key={a.id} type="button" className="hs-btn rd-act" disabled={busy} onClick={() => onAct(a.id)}>
            <span className="hs-t" style={T(3)}>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// The bar once the hand is over: the transport above it replays the hand.
function DrillOverBar({ onReview, onDeal, onBack, busy }) {
  return (
    <div className="hs-view rd-bar snap-place">
      <div className="hs-cols3" style={{ '--hs-n': 2 }}>
        <button type="button" className="hs-btn" onClick={onBack}><span className="hs-t" style={T(3)}>Back</span></button>
        <button type="button" className="hs-btn rd-primary" onClick={onReview}><span className="hs-t" style={T(3)}>Grades</span></button>
        <button type="button" className="hs-btn" disabled={busy} onClick={onDeal}><span className="hs-t" style={T(3)}>Deal</span></button>
      </div>
    </div>
  );
}

// The study tool's answer for one draw, labelled as such.
function StudyBlock({ entry, heroAction }) {
  const label = 'Study tool · every discard, Monte Carlo';
  if (!entry || entry.status === 'waiting') {
    return (
      <div className="hs-panel hs-stack rd-study">
        <div className="hs-t hs-cap" style={T(2)}>{label}</div>
        <div className="hs-t hs-sm hs-mut" style={T(3)}>Pricing…</div>
      </div>
    );
  }
  if (entry.status === 'failed') {
    return (
      <div className="hs-panel hs-stack rd-study">
        <div className="hs-t hs-cap" style={T(2)}>{label}</div>
        <div className="hs-t hs-sm hs-bold" style={T(3)}>Not priced</div>
        <div className="hs-t hs-xs hs-mut rd-wrap">{entry.message}</div>
      </div>
    );
  }
  const v = studyVerdict(entry.data.table, heroAction);
  const warnings = entry.data.warnings || [];
  return (
    <div className="hs-panel hs-stack rd-study">
      <div className="hs-t hs-cap" style={T(2)}>{label}</div>
      <div className={'hs-t hs-sm hs-bold rd-verdict is-' + v.kind} style={T(3)}>{v.headline}</div>
      {v.detail && <div className="hs-t hs-xs hs-mut rd-wrap">{v.detail}</div>}
      {v.band && v.band.length > 0 && (
        <div className="hs-t hs-xs hs-mut rd-wrap">Level with: {v.band.join(', ')}</div>
      )}
      {warnings.map((w) => <div key={w} className="hs-t hs-xs rd-wrap rd-warn">{w}</div>)}
      <div className="hs-t hs-xs hs-mut rd-wrap">Levels are uncertified; the tied band is about separation. The opponent plays the blueprint.</div>
    </div>
  );
}

function DrillReview({ drill, study, onTable, onDeal, onBack, busy }) {
  const grades = drill.grades || [];
  const total = grades.reduce((sum, g) => sum + Math.max(0, +g.evLoss || 0), 0);
  return (
    <div className="hs-view rd-review">
      <div className="hs-cols3 rd-review-nav" style={{ '--hs-n': 2 }}>
        <button type="button" className="hs-btn" onClick={onBack}><span className="hs-t" style={T(3)}>Back</span></button>
        <button type="button" className="hs-btn" onClick={onTable}><span className="hs-t" style={T(3)}>Table</span></button>
        <button type="button" className="hs-btn rd-primary" disabled={busy} onClick={onDeal}><span className="hs-t" style={T(3)}>Deal</span></button>
      </div>
      <ResultBanner result={drill.result} heroSeat={drill.heroSeat} game={drill.game} />
      <div className="hs-t hs-sm hs-bold" style={T(3)}>
        {grades.length} decision{grades.length === 1 ? '' : 's'} · drill grader {total <= 0.01 ? 'found no loss' : `−${total.toFixed(2)} chips`}
      </div>
      {grades.map((g, i) => {
        const isDraw = g.kind === 'draw';
        const caveat = drillOptimalCaveat(g);
        return (
          <div key={i} className="rd-decision">
            <div className="hs-t hs-cap" style={T(2)}>Drill grader · {drillGradeSource(g)}</div>
            <GradeCard g={g} game={drill.game} />
            {caveat && <div className="hs-t hs-xs rd-wrap rd-warn">{caveat}</div>}
            {isDraw && <StudyBlock entry={study[g.street]} heroAction={g.heroActionId} />}
          </div>
        );
      })}
    </div>
  );
}

export default function ReplayerDrill({ Replay, token, heroName, cardSplay, onBack }) {
  const [game, setGame] = useState(storedGame);
  const [drill, setDrill] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [returned, setReturned] = useState(false);
  const [study, setStudy] = useState({});
  const [thrown, setThrown] = useState(() => new Set());
  const dealGen = useRef(0);

  // The cards marked to throw, tapped on the felt. Each draw starts with none.
  const drawKey = drill && drill.drawDecision ? `${drill.seed}/${drill.heroActions.length}` : '';
  useEffect(() => { setThrown(new Set()); }, [drawKey]);
  const toggleThrown = useCallback((c) => setThrown((prev) => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c); else next.add(c);
    return next;
  }), []);

  const deal = useCallback(async (g) => {
    const gen = ++dealGen.current;
    setBusy(true); setError(null); setReviewing(false); setReturned(false); setStudy({});
    try {
      const dealt = await postJson(`/solver/trainer/${g}/deal`, {});
      const first = await postJson(`/solver/trainer/${g}/step`, { seed: dealt.seed, heroActions: [] });
      if (gen !== dealGen.current) return;
      setDrill(drillStep(drillStart(g, dealt), first));
    } catch (e) {
      if (gen === dealGen.current) { setDrill(null); setError(e.message || 'Could not deal'); }
    } finally {
      if (gen === dealGen.current) setBusy(false);
    }
  }, []);

  const pick = (g) => { setGame(g); storeGame(g); deal(g); };

  const act = useCallback(async (actionId) => {
    if (!drill || busy) return;
    setBusy(true); setError(null);
    const gen = dealGen.current;
    try {
      const next = [...drill.heroActions, actionId];
      const data = await postJson(`/solver/trainer/${drill.game}/step`, { seed: drill.seed, heroActions: next });
      if (gen === dealGen.current) setDrill((d) => drillStep(d, data, actionId));
    } catch (e) {
      if (gen === dealGen.current) setError(e.message || 'That did not go through. Try again.');
    } finally {
      if (gen === dealGen.current) setBusy(false);
    }
  }, [drill, busy]);

  // A finished hand: once into the Trainer's scoreboard and history, and each draw to the study
  // tool, one at a time because each is several seconds' work on the server.
  const finishedSeed = useRef(null);
  useEffect(() => {
    if (!drill || !drill.handOver || !drill.grades || finishedSeed.current === drill.seed) return;
    finishedSeed.current = drill.seed;
    const { game: g, seed, heroSeat, result, grades, heroActions, state } = drill;
    saveSession(g, applyHandToSession(loadSession(g), grades, g));
    fetchApi(`/solver/trainer/${g}/save-hand`, { method: 'POST', body: { seed, heroSeat, result, grades } })
      .catch(() => { /* offline: the scoreboard still has it */ });

    if (!drillGame(g) || !drillGame(g).draw) return;
    const draws = grades.filter((x) => x.kind === 'draw');
    const gen = dealGen.current;
    setStudy(Object.fromEntries(draws.map((x) => [x.street, { status: 'waiting' }])));
    (async () => {
      for (const x of draws) {
        if (gen !== dealGen.current) return;
        const index = heroActionIndexForStreet(state, heroSeat, x.street);
        let entry;
        try {
          const data = await postJson(`/solver/trainer/${g}/study-draw`, { seed, heroActions, index });
          entry = { status: 'done', data };
        } catch (e) {
          entry = { status: 'failed', message: e.message || 'The study tool did not answer.' };
        }
        if (gen === dealGen.current) setStudy((prev) => ({ ...prev, [x.street]: entry }));
      }
    })();
  }, [drill]);

  const hand = useMemo(() => buildDrillHand(drill, heroName || 'Hero'), [drill, heroName]);

  const replayDrill = useMemo(() => {
    if (!drill) return null;
    return {
      rev: drill.rev,
      over: drill.handOver,
      startAtEnd: returned,
      discard: drill.drawDecision ? { thrown, toggle: toggleThrown, disabled: busy } : null,
      bar: <DrillBar drill={drill} game={drillGame(drill.game)} thrown={thrown} busy={busy} onAct={act} />,
      overBar: <DrillOverBar busy={busy} onBack={onBack} onDeal={() => deal(drill.game)} onReview={() => setReviewing(true)} />,
    };
  }, [drill, thrown, toggleThrown, busy, act, returned, onBack, deal]);

  if (!drill || !hand) {
    return (
      <div className="replayer-view is-list">
        <div className="hs-view rd-setup">
          <h2 className="screen-title hs-t hs-title" style={T(4)}>Play a hand</h2>
          <div className="hs-t hs-sm hs-mut rd-wrap">Heads up against the solver, on the replayer's table. Every decision is graded when the hand ends.</div>
          <div className="hs-cols" style={{ '--hs-n': 2 }}>
            {DRILL_GAMES.map((g) => (
              <button key={g.id} type="button" className={'hs-btn' + (g.id === game ? ' rd-primary' : '')} disabled={busy} onClick={() => pick(g.id)}>
                <span className="hs-t" style={T(3)}>{g.label}</span>
              </button>
            ))}
          </div>
          {busy && <div className="hs-t hs-sm hs-mut" style={T(3)}>Dealing…</div>}
          {error && <div className="hs-t hs-sm rd-wrap rd-warn">{error}</div>}
          <button type="button" className="hs-btn" onClick={onBack}><span className="hs-t" style={T(3)}>Back</span></button>
        </div>
      </div>
    );
  }

  if (reviewing) {
    return (
      <div className="replayer-view is-list">
        <DrillReview drill={drill} study={study} busy={busy} onBack={onBack}
          onTable={() => { setReturned(true); setReviewing(false); }} onDeal={() => deal(drill.game)} />
      </div>
    );
  }

  return (
    <div className="replayer-view is-replay">
      {error && <div className="hs-view"><div className="hs-t hs-sm rd-wrap rd-warn rd-error">{error}</div></div>}
      <Replay key={drill.seed} hand={hand} token={token} heroName={heroName} cardSplay={cardSplay}
        onBack={onBack} onEdit={() => {}} drill={replayDrill} />
    </div>
  );
}
