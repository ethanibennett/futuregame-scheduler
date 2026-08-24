import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchApi } from '../utils/api.js';
import Card from './SolverCard.jsx';
import StrategyRibbon from './StrategyRibbon.jsx';

// ── MULTIWAY (3-player razz) TRAINER — MVP ────────────────────────────────────
// Play a full 3-handed razz hand as the hero against TWO blueprint-profile seats,
// one decision at a time, then get an HONEST per-decision report:
//   • 7th-street decisions are graded by the EXACT multiway oracle (a certified
//     EV-loss-vs-the-stated-profile) and carry a per-seat exploitability LOWER
//     bound bar on the profile.
//   • Earlier streets (3rd–6th) are a blueprint-graded Monte-Carlo ESTIMATE of
//     EV-loss vs the profile.
//
// HONESTY (product requirement): 3-player razz is general-sum — there is no
// single correct strategy, so the four banned "perfect-play" claims never appear
// in user-facing copy. Grades are framed as EV-loss vs the STATED PROFILE (the
// blueprint the two opponents play); the exploitability number is a LOWER bound.
// The backend enforces the same (grade3's label helper throws on the banned
// claim); this UI presents the honest labels it returns verbatim.
//
// Backend contract (stateless, seeded deterministic replay):
//   POST /api/solver/trainer3/razz3/deal  {}                       -> { seed, heroSeat, game, state }
//   POST /api/solver/trainer3/razz3/step  { seed, heroActions:[id] } -> { state, legalActions|null, handOver, result?, grades?, profile? }

const FONT = "'Univers Condensed', 'Univers', sans-serif";
const label = { fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' };
const panel = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' };
const STREET_NAMES = ['3rd', '4th', '5th', '6th', '7th'];
const POS = 'var(--pos, #22c55e)';

// ── session scoreboard (localStorage, per-device) ─────────────────────────────
const SS_KEY = 'razz3trainer.session.v1';
function emptySession() { return { hands: 0, totalEvLoss: 0, byStreet: [0, 0, 0, 0, 0], clean: 0, exactGraded7th: 0 }; }
function loadSession() {
  try {
    const raw = localStorage.getItem(SS_KEY);
    if (!raw) return emptySession();
    const s = JSON.parse(raw);
    return { ...emptySession(), ...s, byStreet: Array.isArray(s.byStreet) ? s.byStreet : [0, 0, 0, 0, 0] };
  } catch { return emptySession(); }
}
function saveSession(s) { try { localStorage.setItem(SS_KEY, JSON.stringify(s)); } catch { /* quota */ } }
function applyHandToSession(prev, grades) {
  const next = { ...prev, byStreet: prev.byStreet.slice() };
  let handLoss = 0, exact7 = 0;
  for (const g of (grades || [])) {
    const loss = Math.max(0, +g.evLoss || 0);
    handLoss += loss;
    const st = Math.max(0, Math.min(4, g.street | 0));
    next.byStreet[st] = (next.byStreet[st] || 0) + loss;
    if (g.forwardMode === 'exact-multiway-oracle') exact7++;
  }
  next.hands += 1;
  next.totalEvLoss += handLoss;
  next.exactGraded7th += exact7;
  if (handLoss < 0.05) next.clean += 1;
  return next;
}

// Color an EV-loss value: clean=green, small=accent, large=red.
function lossColor(v) {
  if (v < 0.05) return POS;
  if (v < 1.0) return 'var(--accent)';
  return 'var(--neg, #ef4444)';
}

export default function Multiway3TrainerView() {
  const [seed, setSeed] = useState(null);
  const [heroSeat, setHeroSeat] = useState(0);
  const [state, setState] = useState(null);
  const [legalActions, setLegalActions] = useState(null);
  const [heroActions, setHeroActions] = useState([]);
  const [handOver, setHandOver] = useState(false);
  const [result, setResult] = useState(null);
  const [grades, setGrades] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(() => loadSession());
  const [scoredSeed, setScoredSeed] = useState(null);

  // ── deal a fresh hand ──
  const deal = useCallback(async () => {
    setLoading(true); setError(null);
    setState(null); setLegalActions(null); setHeroActions([]);
    setHandOver(false); setResult(null); setGrades(null); setProfile(null);
    try {
      const res = await fetchApi('/solver/trainer3/razz3/deal', { method: 'POST', body: {} });
      let data = null; try { data = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) {
        setError({ offline: res.status === 503, message: (data && data.error) || `server returned ${res.status}` });
        return;
      }
      setSeed(data.seed); setHeroSeat(data.heroSeat); setState(data.state);
      // advance once to reach the first hero decision (or terminal).
      await advance(data.seed, []);
    } catch (e) {
      setError({ offline: true, message: e.message || 'network error' });
    } finally { setLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── advance the replay to the next hero decision / terminal ──
  const advance = useCallback(async (sd, actions) => {
    setStepping(true); setError(null);
    try {
      const res = await fetchApi('/solver/trainer3/razz3/step', { method: 'POST', body: { seed: sd, heroActions: actions } });
      let data = null; try { data = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) {
        setError({ offline: res.status === 503, message: (data && data.error) || `server returned ${res.status}` });
        return null;
      }
      setState(data.state);
      setHandOver(!!data.handOver);
      if (data.handOver) {
        setLegalActions(null); setResult(data.result || null);
        setGrades(data.grades || null); setProfile(data.profile || null);
      } else {
        setLegalActions(data.legalActions || null);
        setResult(null); setGrades(null);
      }
      return data;
    } catch (e) {
      setError({ offline: true, message: e.message || 'network error' });
      return null;
    } finally { setStepping(false); }
  }, []);

  useEffect(() => { deal(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // fold a finished hand into the scoreboard ONCE.
  useEffect(() => {
    if (handOver && grades && seed != null && scoredSeed !== seed) {
      setSession((prev) => { const next = applyHandToSession(prev, grades); saveSession(next); return next; });
      setScoredSeed(seed);
    }
  }, [handOver, grades, seed, scoredSeed]);

  const pickAction = useCallback(async (actionId) => {
    if (stepping || handOver || !legalActions) return;
    const next = [...heroActions, actionId];
    setHeroActions(next);
    setLegalActions(null); // hide buttons while the server replays
    await advance(seed, next);
  }, [stepping, handOver, legalActions, heroActions, seed, advance]);

  const resetSession = useCallback(() => {
    const fresh = emptySession(); saveSession(fresh); setSession(fresh); setScoredSeed(null);
  }, []);

  const heroOnTurn = !!(state && !handOver && legalActions && state.toAct === heroSeat);
  const totalEvLoss = useMemo(() => (grades || []).reduce((a, g) => a + Math.max(0, +g.evLoss || 0), 0), [grades]);

  return (
    <div className="trainer-shell" style={{ height: '100%', overflowY: 'auto', padding: '12px 14px 80px', maxWidth: 620, margin: '0 auto', fontFamily: FONT }}>
      {/* Full-width top band (header + subtitle + error). Spans above the two
          columns on wide screens; top of the stack on narrow. */}
      <div className="trainer-top">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' }}>3-Way Razz Trainer</h2>
        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>MVP · multiway</span>
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
        You are the hero against two seats playing a fixed blueprint <b>profile</b>. Grades are the
        certified EV-loss <b>versus that stated profile</b> — 3-player razz is general-sum, so there is
        no single correct strategy. 7th-street decisions are graded by an exact oracle; earlier streets
        are a Monte-Carlo estimate.
      </p>

      {error && (
        <div style={{ ...panel, borderColor: 'var(--neg, #ef4444)', marginBottom: 12 }}>
          <span style={{ color: 'var(--neg, #ef4444)', fontSize: '0.8rem' }}>
            {error.offline ? 'Trainer unavailable on this server. ' : ''}{error.message}
          </span>
        </div>
      )}

      </div>{/* .trainer-top */}

      {/* Two-column split on wide screens: LEFT = play, RIGHT = feedback.
          Collapses to a single stacked column below 900px (see styles.css). */}
      <div className="trainer-cols">
      <div className="trainer-col trainer-col-play">

      {/* felt */}
      {state && <Felt3 state={state} heroSeat={heroSeat} handOver={handOver} result={result} />}

      {/* action panel */}
      {heroOnTurn && legalActions && (
        <div style={{ ...panel, marginTop: 12 }}>
          <div style={{ ...label, marginBottom: 8 }}>Your action</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {legalActions.map((a) => (
              <button key={a.id} onClick={() => pickAction(a.id)} disabled={stepping}
                style={{
                  padding: '8px 18px', borderRadius: 10, fontFamily: 'inherit', fontSize: '0.82rem',
                  fontWeight: 'var(--fw-bold)', cursor: stepping ? 'default' : 'pointer', color: 'var(--on-brand)',
                  border: '1px solid var(--brand)', background: 'var(--brand)', opacity: stepping ? 0.5 : 1,
                }}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {(loading || stepping) && !handOver && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', padding: '10px 0' }}>
          {stepping ? 'replaying + grading…' : 'dealing…'}
        </div>
      )}

      {/* result banner — play side (the hand's conclusion, shown with the felt) */}
      {handOver && result && (
        <div style={{ marginTop: 12 }}>
          <ResultBanner3 result={result} heroSeat={heroSeat} />
        </div>
      )}

      </div>{/* .trainer-col-play */}

      {/* Feedback side: grading basis + per-decision grades + deal-next + scoreboard. */}
      <div className="trainer-col trainer-col-feedback">

      {handOver && result && (
        <>
          {profile && (
            <div style={{ ...panel, marginTop: 10, padding: '8px 12px' }}>
              <span style={label}>Grading basis</span>
              <div style={{ fontSize: '0.72rem', color: 'var(--text)', marginTop: 3, lineHeight: 1.5 }}>
                {profile.label} — the two opponents play a fixed blueprint profile; this is a general-sum
                game with no single correct strategy. The exploitability bars below are per-seat <b>lower bounds</b>.
              </div>
            </div>
          )}

          {grades && grades.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ ...label, letterSpacing: '0.12em', fontWeight: 700 }}>Per-decision grade</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: lossColor(totalEvLoss) }}>
                  hand EV-loss {totalEvLoss.toFixed(2)} chips
                </span>
              </div>
              {grades.map((g, i) => <GradeCard3 key={i} g={g} heroSeat={heroSeat} />)}
            </div>
          )}
          {grades && grades.length === 0 && (
            <div style={{ ...panel, marginTop: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              No hero decisions to grade this hand.
            </div>
          )}
        </>
      )}

      {/* next hand */}
      <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
        <button onClick={deal} disabled={loading || stepping}
          style={{
            flex: 1, padding: '10px', borderRadius: 10, fontFamily: 'inherit', fontSize: '0.85rem',
            fontWeight: 700, cursor: (loading || stepping) ? 'default' : 'pointer',
            border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
            opacity: (loading || stepping) ? 0.5 : 1,
          }}>
          {handOver ? 'Deal next hand' : 'New hand'}
        </button>
      </div>

      {/* scoreboard */}
      <SessionScoreboard3 session={session} onReset={resetSession} />

      </div>{/* .trainer-col-feedback */}
      </div>{/* .trainer-cols */}
    </div>
  );
}

// ── 3-seat felt ───────────────────────────────────────────────────────────────
// One row per seat. Hero seat highlighted; each seat shows its public upcards +
// (hidden) down cards; at showdown every live seat's hand is revealed. The seat
// to act is flagged. A public action log sits below.
function Felt3({ state, heroSeat, handOver, result }) {
  const seats = state.seats || [];
  const resultSeats = handOver && result && Array.isArray(result.seats) ? result.seats : null;
  return (
    <div style={{ ...panel, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.95rem' }}>
          {STREET_NAMES[state.street] || `street ${state.street}`} street
        </span>
        <span style={label}>
          Pot {state.pot}{state.deadPot ? ` (incl. ${state.deadPot} dead)` : ''} · bring-in seat {state.bringInSeat}
        </span>
      </div>

      {seats.map((s) => {
        const rs = resultSeats ? resultSeats.find(x => x.seat === s.seat) : null;
        const revealed = rs && rs.down && rs.down.some(c => c != null) ? rs.down : null;
        const isToAct = state.toAct === s.seat && !handOver;
        return (
          <div key={s.seat} style={{
            marginBottom: 10, padding: '8px 10px', borderRadius: 10,
            border: '1px solid ' + (s.isHero ? POS : 'var(--border)'),
            background: s.isHero ? 'color-mix(in srgb, var(--pos, #22c55e) 8%, transparent)' : 'transparent',
            opacity: s.folded ? 0.5 : 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ ...label, color: s.isHero ? POS : 'var(--text-muted)', fontWeight: 700 }}>
                {s.isHero ? 'You' : `Seat ${s.seat}`}
              </span>
              {s.folded && <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>folded</span>}
              {isToAct && (
                <span style={{ fontSize: '0.6rem', color: s.isHero ? POS : 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>to act</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: 'var(--text-muted)' }}>in {s.contrib}</span>
              {rs && rs.lowRank && <span style={{ fontSize: '0.62rem', color: 'var(--text)', fontWeight: 700 }}>{rs.lowRank}</span>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', minHeight: 46, paddingTop: 12 }}>
              {/* 2 hole cards: hero always face-up; opponents hidden until showdown */}
              {s.isHero
                ? (s.down || []).slice(0, 2).map((c, i) => <Card key={'d' + i} str={c} size="sm" />)
                : revealed
                  ? revealed.slice(0, 2).map((c, i) => <Card key={'d' + i} str={c} size="sm" />)
                  : Array.from({ length: 2 }).map((_, i) => <Card key={'d' + i} faceDown size="sm" />)}
              {/* upcards (3rd door + 4th/5th/6th), raised */}
              {(s.up || []).map((c, i) => <Card key={'u' + i} str={c} size="sm" raised />)}
              {/* 7th-street river — down card AFTER the upcards, at hole level, not raised */}
              {s.isHero
                ? (s.down || []).slice(2).map((c, i) => <Card key={'r' + i} str={c} size="sm" />)
                : revealed
                  ? revealed.slice(2).map((c, i) => <Card key={'r' + i} str={c} size="sm" />)
                  : (state.street === 4 ? <Card key="rb" faceDown size="sm" /> : null)}
            </div>
          </div>
        );
      })}

      {state.log && state.log.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6, maxHeight: 132, overflowY: 'auto' }}>
          {state.log.map((e, i) => (
            <div key={i}>
              <b style={{ color: e.seat === heroSeat ? POS : 'var(--accent)' }}>
                {e.seat === heroSeat ? 'You' : `Seat ${e.seat}`}
              </b>
              <span style={{ opacity: 0.7 }}> · {STREET_NAMES[e.street] || `s${e.street}`}</span> {e.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── result banner ─────────────────────────────────────────────────────────────
function ResultBanner3({ result, heroSeat }) {
  const w = result.winner;
  const won = w === 'hero';
  const split = w === 'split';
  const color = won ? POS : split ? 'var(--accent)' : 'var(--neg, #ef4444)';
  const text = won ? 'You win' : split ? 'Split pot' : 'You lose';
  return (
    <div style={{ ...panel, borderColor: color, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontWeight: 700, color, fontSize: '0.95rem' }}>{text}</span>
      <span style={{ fontSize: '0.8rem', color: 'var(--text)' }}>
        {result.endType === 'fold' ? 'by fold' : 'at showdown'} · net {result.heroDelta > 0 ? '+' : ''}{result.heroDelta} chips
      </span>
    </div>
  );
}

// ── provenance badge ──────────────────────────────────────────────────────────
// EXACT (7th) vs blueprint estimate (earlier). Honest wording only.
function ProvenanceBadge({ g }) {
  const exact = g.forwardMode === 'exact-multiway-oracle';
  const bg = exact ? POS : 'var(--accent)';
  const txt = exact ? 'exact multiway oracle' : 'blueprint estimate';
  const sub = exact
    ? (g.exactPath === 'snapshot-exact' ? 'mid-round exact' : 'certificate')
    : 'MC vs profile';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
        color: '#fff', background: bg, borderRadius: 6, padding: '2px 6px',
      }}>{txt}</span>
      <span style={{ fontSize: '0.56rem', color: 'var(--text-muted)' }}>{sub}</span>
    </span>
  );
}

// ── per-seat exploitability bar (LOWER bound) ─────────────────────────────────
function ExploitBar({ bar, heroSeat }) {
  if (!Array.isArray(bar) || !bar.length) return null;
  const max = Math.max(0.01, ...bar.map(b => Math.abs(b.exploitLowerBound || 0)));
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
      <div style={{ ...label, marginBottom: 5 }}>Per-seat exploitability (lower bound, chips)</div>
      {bar.map((b) => {
        const v = Math.abs(b.exploitLowerBound || 0);
        const isHero = b.seat === heroSeat;
        return (
          <div key={b.seat} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: '0.62rem', width: 46, color: isHero ? POS : 'var(--text-muted)', fontWeight: isHero ? 700 : 400 }}>
              {isHero ? 'You' : `Seat ${b.seat}`}
            </span>
            <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, (v / max) * 100)}%`, height: '100%', background: isHero ? POS : 'var(--accent)' }} />
            </div>
            <span style={{ fontSize: '0.62rem', width: 44, textAlign: 'right', color: 'var(--text)' }}>≥ {v.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── grade card ────────────────────────────────────────────────────────────────
function GradeCard3({ g, heroSeat }) {
  const mix = g.profileMix || {};
  const actions = g.actions || mix.actions || [];
  const labels = g.actionLabels || mix.labels || actions;
  const probs = mix.probs || [];
  const evLoss = Math.max(0, +g.evLoss || 0);
  const chose = g.heroActionId;
  const best = g.bestActionId;
  const rightChoice = chose === best;
  return (
    <div style={{ ...panel, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.82rem' }}>{g.streetName} street</span>
        <ProvenanceBadge g={g} />
      </div>

      {/* profile action mix as frequency bars (the blueprint's mix, not a claim of perfect play) */}
      <div style={{ ...label, marginBottom: 4 }}>Profile action mix{mix.trained === false ? ' (untrained → uniform)' : ''}</div>
      {/* One ribbon. This was the fifth hand-rolled rendering of a mix, and
          the one that drew UNCHOSEN actions in the muted-text grey - the same
          colour as the label beside them. perActionEV rides along as the
          diverging strip, which is the number being graded. */}
      <StrategyRibbon
        actions={actions.map((a, i) => ({
          id: a,
          label: labels[i] || a,
          prob: probs[i] != null ? probs[i] : 0,
          ev: (g.perActionEV && g.perActionEV[a] != null) ? g.perActionEV[a] : undefined,
        }))}
        chosen={chose}
        best={best}
        showEv
      />

      {/* verdict */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.74rem' }}>
        <span style={{ color: 'var(--text-muted)' }}>
          You chose <b style={{ color: 'var(--text)' }}>{g.heroActionLabel}</b>
          {!rightChoice && <> · best <b style={{ color: 'var(--text)' }}>{labels[actions.indexOf(best)] || best}</b></>}
        </span>
        <span style={{ fontWeight: 700, color: lossColor(evLoss) }}>
          EV-loss {evLoss.toFixed(2)}{g.evLossSE != null ? ` ±${(+g.evLossSE).toFixed(2)}` : ''} chips
        </span>
      </div>
      <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: 3 }}>
        {g.certified}
      </div>

      {/* exploitability bar (7th only) */}
      {g.exploitBar && <ExploitBar bar={g.exploitBar} heroSeat={heroSeat} />}
    </div>
  );
}

// ── session scoreboard ────────────────────────────────────────────────────────
function SessionScoreboard3({ session, onReset }) {
  const s = session || emptySession();
  const avg = s.hands ? s.totalEvLoss / s.hands : 0;
  return (
    <div style={{ ...panel, marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ ...label, letterSpacing: '0.14em', fontWeight: 700 }}>Session scoreboard</span>
        <button onClick={onReset}
          style={{ fontFamily: 'inherit', fontSize: '0.6rem', color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '2px 8px', cursor: 'pointer' }}>
          reset
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
        <Stat label="Hands" value={s.hands} />
        <Stat label="Avg EV-loss" value={`${avg.toFixed(2)}`} unit="chips" color={lossColor(avg)} />
        <Stat label="Clean hands" value={`${s.clean}/${s.hands}`} />
      </div>
      <div style={{ ...label, marginBottom: 4 }}>EV-loss by street (total, chips)</div>
      {s.byStreet.map((v, i) => {
        const max = Math.max(0.01, ...s.byStreet.map(x => x || 0));
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: '0.62rem', width: 34, color: 'var(--text-muted)' }}>{STREET_NAMES[i]}</span>
            <div style={{ flex: 1, height: 7, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, ((v || 0) / max) * 100)}%`, height: '100%', background: i === 4 ? POS : 'var(--accent)' }} />
            </div>
            <span style={{ fontSize: '0.6rem', width: 44, textAlign: 'right', color: 'var(--text-muted)' }}>{(v || 0).toFixed(1)}</span>
          </div>
        );
      })}
      <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
        {s.exactGraded7th} of your 7th-street decisions this session were graded by the exact multiway
        oracle. Earlier-street numbers are Monte-Carlo estimates vs the profile. Stored on this device only.
      </div>
    </div>
  );
}

function Stat({ label: l, value, unit, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
      <div style={{ ...label, marginTop: 2 }}>{l}{unit ? ` (${unit})` : ''}</div>
    </div>
  );
}
