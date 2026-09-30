import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchApi } from '../utils/api.js';
import Card from './SolverCard.jsx';
import StrategyRibbon from './StrategyRibbon.jsx';
import GridBadge from './GridBadge.jsx';

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

// Grid (classes in styles.css, .hs-*): every piece is whole r — text is an
// .hs-t block whose baseline is its bottom edge (b r tall, +lh r per extra
// line), controls 3/5r, cards 2g × 4r, gaps 1/2r — so every block starts on an
// r-line from the top bar. Panels pad 2r × 2g (content on 3..34).
const T = (b, lh) => (lh ? { '--hs-b': b, '--hs-lh': lh } : { '--hs-b': b });
const R = (n) => `calc(var(--subrow) * ${n})`;
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
    <div className="hs-view trainer-shell" style={{ maxWidth: R(77.5) }}>
      {/* Full-width top band (header + subtitle + error). Spans above the two
          columns on wide screens; top of the stack on narrow.
          Grid: 4r title line (title | tag, both baselines on its bottom), 1r,
          2r copy lines. */}
      <div className="trainer-top">
      <div className="hs-split">
        <h2 className="screen-title hs-t hs-title" style={T(4)}>3-Way Razz Trainer</h2>
        <span className="hs-t hs-xs hs-mut" style={{ ...T(4), whiteSpace: 'nowrap' }}>MVP · multiway</span>
      </div>
      <p className="hs-t hs-xs hs-mut" style={{ ...T(2, 2), marginTop: 'var(--subrow)' }}>
        You are the hero against two seats playing a fixed blueprint <b>profile</b>. Grades are the
        certified EV-loss <b>versus that stated profile</b> — 3-player razz is general-sum, so there is
        no single correct strategy. 7th-street decisions are graded by an exact oracle; earlier streets
        are a Monte-Carlo estimate.
      </p>

      {error && (
        <div className="hs-panel" style={{ marginTop: R(2), '--hs-edge': 'var(--neg, #ef4444)' }}>
          <div className="hs-t hs-sm" style={{ ...T(3, 3), color: 'var(--neg, #ef4444)' }}>
            {error.offline ? 'Trainer unavailable on this server. ' : ''}{error.message}
          </div>
        </div>
      )}

      </div>{/* .trainer-top */}

      {/* Two-column split on wide screens: LEFT = play, RIGHT = feedback.
          Collapses to a single stacked column below 900px (see styles.css). */}
      <div className="trainer-cols">
      <div className="trainer-col trainer-col-play">

      {/* felt */}
      {state && <Felt3 state={state} heroSeat={heroSeat} handOver={handOver} result={result} />}

      {/* action panel — 2r caps label, 1r, 5r buttons on the panel's 15g halves
          (or 9g thirds for three actions). */}
      {heroOnTurn && legalActions && (
        <div className="hs-panel hs-stack" style={{ marginTop: 'var(--subrow)' }}>
          <div className="hs-t hs-cap" style={T(2)}>Your action</div>
          <div className={legalActions.length === 3 ? 'hs-cols3' : 'hs-cols'} style={{ '--hs-n': 2, rowGap: 'var(--subrow)' }}>
            {legalActions.map((a) => (
              <button key={a.id} className="hs-btn" onClick={() => pickAction(a.id)} disabled={stepping}
                style={{ '--hs-h': 5, '--hs-edge': 'transparent', '--hs-fill': 'var(--brand)', '--hs-ink': 'var(--on-brand)', fontSize: 'var(--fs-sm)', cursor: stepping ? 'default' : 'pointer', opacity: stepping ? 0.5 : 1 }}>
                <span className="hs-t" style={T(3)}>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(loading || stepping) && !handOver && (
        <div className="hs-t hs-xs hs-mut" style={{ ...T(3), marginTop: 'var(--subrow)', textAlign: 'center' }}>
          {stepping ? 'replaying + grading…' : 'dealing…'}
        </div>
      )}

      {/* result banner — play side (the hand's conclusion, shown with the felt) */}
      {handOver && result && <ResultBanner3 result={result} heroSeat={heroSeat} />}

      </div>{/* .trainer-col-play */}

      {/* Feedback side: grading basis + per-decision grades + deal-next + scoreboard. */}
      <div className="trainer-col trainer-col-feedback">

      {handOver && result && (
        <>
          {profile && (
            <div className="hs-panel hs-stack" style={{ marginTop: 'var(--subrow)' }}>
              <span className="hs-t hs-cap" style={T(2)}>Grading basis</span>
              <div className="hs-t hs-xs" style={T(2, 2)}>
                {profile.label} — the two opponents play a fixed blueprint profile; this is a general-sum
                game with no single correct strategy. The exploitability bars below are per-seat <b>lower bounds</b>.
              </div>
            </div>
          )}

          {grades && grades.length > 0 && (
            <div className="hs-stack" style={{ marginTop: R(2) }}>
              <div className="hs-split">
                <span className="hs-t hs-cap hs-bold" style={{ ...T(3), letterSpacing: '0.12em' }}>Per-decision grade</span>
                <span className="hs-t hs-sm hs-bold" style={{ ...T(3), color: lossColor(totalEvLoss) }}>hand EV-loss {totalEvLoss.toFixed(2)} chips</span>
              </div>
              {grades.map((g, i) => <GradeCard3 key={i} g={g} heroSeat={heroSeat} />)}
            </div>
          )}
          {grades && grades.length === 0 && (
            <div className="hs-panel" style={{ marginTop: 'var(--subrow)' }}>
              <div className="hs-t hs-xs hs-mut" style={{ ...T(3), textAlign: 'center' }}>No hero decisions to grade this hand.</div>
            </div>
          )}
        </>
      )}

      {/* next hand — 5r, full width, 2r above */}
      <button className="hs-btn" onClick={deal} disabled={loading || stepping}
        style={{ '--hs-h': 5, '--hs-fill': 'var(--surface)', width: '100%', marginTop: R(2), fontSize: 'var(--fs-sm)', opacity: (loading || stepping) ? 0.5 : 1 }}>
        <span className="hs-t" style={T(3)}>{handOver ? 'Deal next hand' : 'New hand'}</span>
      </button>

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
// Grid: panel 2r × 2g, 2r above; 3r header; each seat a box 1r × 2g (content
// 5..32): 2r label line, 1r, 6r card row (2r lift + 4r cards); 1r between.
function Felt3({ state, heroSeat, handOver, result }) {
  const seats = state.seats || [];
  const resultSeats = handOver && result && Array.isArray(result.seats) ? result.seats : null;
  return (
    <div className="hs-panel hs-stack" style={{ marginTop: R(2) }}>
      <div className="hs-split">
        <span className="hs-t hs-md hs-bold" style={T(3)}>{STREET_NAMES[state.street] || `street ${state.street}`} street</span>
        <span className="hs-t hs-cap hs-clip" style={T(3)}>
          Pot {state.pot}{state.deadPot ? ` (incl. ${state.deadPot} dead)` : ''} · bring-in seat {state.bringInSeat}
        </span>
      </div>

      {seats.map((s) => {
        const rs = resultSeats ? resultSeats.find(x => x.seat === s.seat) : null;
        const revealed = rs && rs.down && rs.down.some(c => c != null) ? rs.down : null;
        const isToAct = state.toAct === s.seat && !handOver;
        return (
          <div key={s.seat} className="hs-box hs-stack" style={{
            padding: 'var(--subrow) calc(var(--gu) * 2)',
            '--hs-edge': s.isHero ? POS : 'var(--border)',
            '--hs-bg': s.isHero ? 'color-mix(in srgb, var(--pos, #22c55e) 8%, transparent)' : 'transparent',
            opacity: s.folded ? 0.5 : 1,
          }}>
            <div style={{ display: 'flex', columnGap: 'var(--gu)', alignItems: 'flex-start', minWidth: 0 }}>
              <span className="hs-t hs-cap hs-bold" style={{ ...T(2), color: s.isHero ? POS : 'var(--text-muted)' }}>{s.isHero ? 'You' : `Seat ${s.seat}`}</span>
              {s.folded && <span className="hs-t hs-cap" style={T(2)}>folded</span>}
              {isToAct && <span className="hs-t hs-cap" style={{ ...T(2), color: s.isHero ? POS : 'var(--accent)' }}>to act</span>}
              <span className="hs-t hs-xs hs-mut" style={{ ...T(2), marginLeft: 'auto' }}>in {s.contrib}</span>
              {rs && rs.lowRank && <span className="hs-t hs-xs hs-bold" style={T(2)}>{rs.lowRank}</span>}
            </div>
            <div className="hs-cards hs-raise">
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

      {/* Action log — hairline rule (inset, no height) + 1r, 2r lines, at most 17r. */}
      {state.log && state.log.length > 0 && (
        <div className="hs-rule" style={{ maxHeight: R(17), overflowY: 'auto' }}>
          {state.log.map((e, i) => (
            <div key={i} className="hs-t hs-xs hs-mut" style={T(2, 2)}>
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
// Grid: panel 2r × 2g, 1r above; one 3r line (verdict | detail).
function ResultBanner3({ result, heroSeat }) {
  const w = result.winner;
  const won = w === 'hero';
  const split = w === 'split';
  const color = won ? POS : split ? 'var(--accent)' : 'var(--neg, #ef4444)';
  const text = won ? 'You win' : split ? 'Split pot' : 'You lose';
  return (
    <div className="hs-panel" style={{ marginTop: 'var(--subrow)', '--hs-edge': color }}>
      <div className="hs-split">
        <span className="hs-t hs-md hs-bold" style={{ ...T(3), color, whiteSpace: 'nowrap' }}>{text}</span>
        <span className="hs-t hs-sm" style={T(3, 3)}>
          {result.endType === 'fold' ? 'by fold' : 'at showdown'} · net {result.heroDelta > 0 ? '+' : ''}{result.heroDelta} chips
        </span>
      </div>
    </div>
  );
}

// ── provenance badge ──────────────────────────────────────────────────────────
// EXACT (7th) vs blueprint estimate (earlier). Honest wording only.
// Grid: a whole-g 3r GridBadge + its sub-label, both baselines 2r down.
function ProvenanceBadge({ g }) {
  const exact = g.forwardMode === 'exact-multiway-oracle';
  const bg = exact ? POS : 'var(--accent)';
  const txt = exact ? 'exact multiway oracle' : 'blueprint estimate';
  const sub = exact
    ? (g.exactPath === 'snapshot-exact' ? 'mid-round exact' : 'certificate')
    : 'MC vs profile';
  return (
    <div className="hs-gbadges">
      <GridBadge edge={bg} ink="#fff" bg={bg}>{txt}</GridBadge>
      <span className="hs-t hs-xs hs-mut" style={T(2)}>{sub}</span>
    </div>
  );
}

// ── per-seat exploitability bar (LOWER bound) ─────────────────────────────────
// Grid: rule + 1r, 2r caps label, then 2r meter rows — label 4g (3..7) | track
// to 27 | 6g value (28..34).
function ExploitBar({ bar, heroSeat }) {
  if (!Array.isArray(bar) || !bar.length) return null;
  const max = Math.max(0.01, ...bar.map(b => Math.abs(b.exploitLowerBound || 0)));
  return (
    <div className="hs-rule">
      <div className="hs-t hs-cap" style={T(2, 2)}>Per-seat exploitability (lower bound, chips)</div>
      {bar.map((b) => {
        const v = Math.abs(b.exploitLowerBound || 0);
        const isHero = b.seat === heroSeat;
        return (
          <div key={b.seat} className="hs-meter" style={{ '--hs-lab': 'calc(var(--gu) * 4)', '--hs-val': 'calc(var(--gu) * 6)' }}>
            <span className="hs-t hs-xs" style={{ ...T(2), color: isHero ? POS : 'var(--text-muted)', fontWeight: isHero ? 'var(--fw-bold)' : 'var(--fw-regular)' }}>
              {isHero ? 'You' : `Seat ${b.seat}`}
            </span>
            <div className="hs-meter-track" style={{ '--hs-track': 'var(--border)' }}>
              <div className="hs-meter-fill" style={{ width: `${Math.min(100, (v / max) * 100)}%`, background: isHero ? POS : 'var(--accent)' }} />
            </div>
            <span className="hs-t hs-xs" style={T(2)}>≥ {v.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── grade card ────────────────────────────────────────────────────────────────
// Grid: panel 2r × 2g; 3r header, badge row (3r), 2r caps label, ribbon,
// 2r verdict line, 2r certification line, exploit bar — 1r apart.
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
    <div className="hs-panel hs-stack">
      <span className="hs-t hs-sm hs-bold" style={T(3)}>{g.streetName} street</span>
      <ProvenanceBadge g={g} />

      {/* profile action mix as frequency bars (the blueprint's mix, not a claim of perfect play) */}
      <div className="hs-t hs-cap" style={T(2, 2)}>Profile action mix{mix.trained === false ? ' (untrained → uniform)' : ''}</div>
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
      <div className="hs-split">
        <span className="hs-t hs-xs hs-mut" style={T(2, 2)}>
          You chose <b style={{ color: 'var(--text)' }}>{g.heroActionLabel}</b>
          {!rightChoice && <> · best <b style={{ color: 'var(--text)' }}>{labels[actions.indexOf(best)] || best}</b></>}
        </span>
        <span className="hs-t hs-xs hs-bold" style={{ ...T(2), whiteSpace: 'nowrap', color: lossColor(evLoss) }}>
          EV-loss {evLoss.toFixed(2)}{g.evLossSE != null ? ` ±${(+g.evLossSE).toFixed(2)}` : ''} chips
        </span>
      </div>
      {g.certified && <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>{g.certified}</div>}

      {/* exploitability bar (7th only) */}
      {g.exploitBar && <ExploitBar bar={g.exploitBar} heroSeat={heroSeat} />}
    </div>
  );
}

// ── session scoreboard ────────────────────────────────────────────────────────
// Grid: panel 2r × 2g, 2r above. 3r header (label | 6g reset on 28..34), 1r,
// three 9g stat columns (3..12, 14..23, 25..34), 2r, caps label, 1r, 2r meter
// rows (label 4g | track to 27 | 6g value), 1r, 2r note lines.
function SessionScoreboard3({ session, onReset }) {
  const s = session || emptySession();
  const avg = s.hands ? s.totalEvLoss / s.hands : 0;
  const max = Math.max(0.01, ...s.byStreet.map(x => x || 0));
  return (
    <div className="hs-panel" style={{ marginTop: R(2) }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) calc(var(--gu) * 6)', columnGap: 'var(--gu)', alignItems: 'start' }}>
        <span className="hs-t hs-cap hs-bold" style={{ ...T(2), letterSpacing: '0.14em' }}>Session scoreboard</span>
        <button className="hs-btn" onClick={onReset}
          style={{ '--hs-h': 3, padding: 0, fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-regular)', '--hs-ink': 'var(--text-muted)' }}>
          <span className="hs-t" style={T(2)}>reset</span>
        </button>
      </div>
      <div className="hs-cols3" style={{ marginTop: 'var(--subrow)' }}>
        <Stat label="Hands" value={s.hands} />
        <Stat label="Avg EV-loss" value={`${avg.toFixed(2)}`} unit="chips" color={lossColor(avg)} />
        <Stat label="Clean hands" value={`${s.clean}/${s.hands}`} />
      </div>
      <div className="hs-t hs-cap" style={{ ...T(2), marginTop: R(2) }}>EV-loss by street (total, chips)</div>
      <div style={{ marginTop: 'var(--subrow)' }}>
        {s.byStreet.map((v, i) => (
          <div key={i} className="hs-meter" style={{ '--hs-lab': 'calc(var(--gu) * 4)', '--hs-val': 'calc(var(--gu) * 6)' }}>
            <span className="hs-t hs-xs hs-mut" style={T(2)}>{STREET_NAMES[i]}</span>
            <div className="hs-meter-track" style={{ '--hs-track': 'var(--border)' }}>
              <div className="hs-meter-fill" style={{ width: `${Math.min(100, ((v || 0) / max) * 100)}%`, background: i === 4 ? POS : 'var(--accent)' }} />
            </div>
            <span className="hs-t hs-xs hs-mut hs-num" style={T(2)}>{(v || 0).toFixed(1)}</span>
          </div>
        ))}
      </div>
      <div className="hs-t hs-xs hs-mut" style={{ ...T(2, 2), marginTop: 'var(--subrow)' }}>
        {s.exactGraded7th} of your 7th-street decisions this session were graded by the exact multiway
        oracle. Earlier-street numbers are Monte-Carlo estimates vs the profile. Stored on this device only.
      </div>
    </div>
  );
}

// Stat: centred 3r value (baseline on its bottom) over a 2r caps label.
function Stat({ label: l, value, unit, color }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <div className="hs-t hs-lg hs-bold hs-num" style={{ ...T(3), fontSize: 'var(--fs-lg)', color: color || 'var(--text)' }}>{value}</div>
      <div className="hs-t hs-cap" style={T(2, 2)}>{l}{unit ? ` (${unit})` : ''}</div>
    </div>
  );
}
