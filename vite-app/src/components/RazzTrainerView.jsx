import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchApi } from '../utils/api.js';
import Card from './SolverCard.jsx';
import GridBadge from './GridBadge.jsx';

// ── Stud Trainer (Razz / Stud 8) ─────────────────────────────────────────
// Play a full heads-up hand of the selected game (Razz or Stud 8) against the
// blueprint, one decision at a time, then get a per-decision GTO grading
// report (blueprint mixed strategy as frequency bars + range-aware per-action
// EV + EV-loss in chips). The grading report is game-agnostic; only the
// showdown/result display differs (Razz is low-only, Stud 8 is hi/lo split).
//
// Backend contract (stateless, seeded deterministic replay), game ∈ {razz, stud8}:
//   POST /api/solver/trainer/:game/deal  {}  -> { seed, heroSeat, state }
//   POST /api/solver/trainer/:game/step  { seed, heroActions:[id,...] }
//        -> { state, legalActions:[{id,label}]|null, handOver, result?, grades? }
//
// The server REPLAYS the whole hand from `seed`, applies our accumulated
// heroActions at each hero decision node, and advances to the NEXT hero
// decision OR terminal. We keep the running heroActions list locally and POST
// the full list each step (the server is the source of truth for state).

// Grid (classes in styles.css, .hs-*): every piece is whole r — text is an
// .hs-t block whose baseline is its bottom edge (b r tall, +lh r per extra
// line), controls 3/4/5r, cards 2g × 4r, gaps 1/2r — so every block starts on
// an r-line from the top bar. Panels pad 2r × 2g (content on 3..34); rows of
// controls sit on the 8g column rails or on 15g / 9g panel columns whose edges
// are subcolumn lines. Badges are whole-g wide (GridBadge measures them).
const T = (b, lh) => (lh ? { '--hs-b': b, '--hs-lh': lh } : { '--hs-b': b });
const R = (n) => `calc(var(--subrow) * ${n})`;

// ── explicit-discard encoding (mirrors solver/draw-trainer/play.js) ────────
// FULL DISCARD CONTROL: the hero's draw action is a STATELESS string
//   'd:' + the THROWN cards' 2-char strings, sorted by card INTEGER.
// The integer is the engine-native encoding: (rank-2)*4 + suit, ace HIGH (=14),
// suit order c<d<h<s — identical to engine/cards.js so the action round-trips
// byte-for-byte through play.parseDiscard. 'd:' (no cards) = stand pat.
const SUIT_ORDER = { c: 0, d: 1, h: 2, s: 3 };
const RANK_VAL = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
// integer rank of a card string ('9s' -> 31) — matches cards.js cardFromStr.
function cardInt(str) {
  if (!str || str.length < 2) return 0;
  const r = RANK_VAL[str[0].toUpperCase()];
  const s = SUIT_ORDER[str[1].toLowerCase()];
  return (((r || 2) - 2) * 4) + (s == null ? 0 : s);
}
// Encode an explicit discard from the THROWN card strings, sorted by int.
//   encodeDiscard(['Kc','9s']) -> 'd:9sKc' ;  encodeDiscard([]) -> 'd:'
function encodeDiscard(thrownStrs) {
  const sorted = thrownStrs.slice().sort((a, b) => cardInt(a) - cardInt(b));
  return 'd:' + sorted.join('');
}

const STREET_NAMES = ['3rd', '4th', '5th', '6th', '7th'];

// DRAW games (td27) have 4 "streets" (0..3) but the meaning is a draw round,
// not a stud street. street+phase maps to a human label: the bet phase is the
// round of betting AFTER a draw, the draw phase is the draw declaration itself.
const DRAW_BET_NAMES = ['Pre-draw', 'After draw 1', 'After draw 2', 'After draw 3'];
const DRAW_PHASE_NAMES = ['Draw 1', 'Draw 2', 'Draw 3'];

// Per-game street-name resolver used by the (game-agnostic) grading report +
// scoreboard. Stud games index 3rd..7th; draw games index the bet-round label.
function streetName(game, street, phase) {
  if (catOf(game) === 'draw') {
    return phase === 'draw' ? (DRAW_PHASE_NAMES[street] || `draw ${street + 1}`) : (DRAW_BET_NAMES[street] || `street ${street}`);
  }
  return STREET_NAMES[street] || `street ${street}`;
}

// Selectable games. `id` is the backend path segment; the legacy razz path
// (game=razz) keeps working exactly as before. Stud games render StudTable;
// DRAW games (td27) render DrawTable.
// stud8 retrained from 23.4 → ~1.9 chips/hand exploitable (on par with td27), so
// it's re-enabled. (Was hidden from the selector while undertrained.)
// See solver/strategies/BLUEPRINT_TRUST.md / CLAUDE.md.
const STUD8_READY = true;
const GAMES = [['razz', 'Razz'], ['stud8', 'Stud 8'], ['td27', '2-7 TD'], ['badugi', 'Badugi'], ['a5td', 'A-5 TD']]
  .filter(([id]) => STUD8_READY || id !== 'stud8');
const GAME_LABEL = { razz: 'Razz', stud8: 'Stud 8', td27: '2-7 Triple Draw', badugi: 'Badugi', a5td: 'A-5 Triple Draw' };
const DRAW_GAMES = new Set(['td27', 'badugi', 'a5td']);
// Game category: 'stud' (razz, stud8 → StudTable, upcards) vs 'draw' (td27 →
// DrawTable, hidden opponent, draw decisions). Everything keyed off this.
function catOf(game) { return DRAW_GAMES.has(game) ? 'draw' : 'stud'; }

// ── Pro mode (true-GTO / exact-resolve grading) ───────────────────────────
// Opt-in oracle grading: when ON, /step is POSTed with { oracle:true } and the
// backend routes eligible decisions through the neural exact re-solver
// (gradeHandWithOracle) instead of the bucketed blueprint:
//   • STUD (razz/stud8): 7th-street decisions (snap.street === 4).
//   • DRAW (badugi/td27): POST-LAST-DRAW bet decisions (snap.street === 3, the
//     final betting round) — the exact draw re-solver (M2). a5td has NO resolver,
//     so it is NOT offered Pro mode.
// Every other decision (earlier streets, all draw decisions) keeps the blueprint
// grade regardless. The toggle is shown only for the games with an oracle; for
// any other game it isn't shown and `oracle` is never sent.
const PRO_MODE_GAMES = new Set(['razz', 'stud8', 'badugi', 'td27']);
function proModeAvailable(game) { return PRO_MODE_GAMES.has(game); }
// The oracle-eligible street differs by category: 7th street (index 4) for stud,
// the post-last-draw final betting round (index 3) for draw. Used to tell an
// honest "oracle fell back to blueprint" grade apart from a normal earlier-street
// blueprint grade, and to word the toggle copy.
const SEVENTH_STREET = 4;              // stud: 3rd..7th → 7th = index 4
const DRAW_FINAL_STREET = 3;           // draw: post-3rd-draw final betting round
function oracleStreet(game) { return catOf(game) === 'draw' ? DRAW_FINAL_STREET : SEVENTH_STREET; }
// The human name of the oracle-eligible street, for toggle/badge copy.
function oracleStreetLabel(game) { return catOf(game) === 'draw' ? 'post-last-draw' : '7th-street'; }
// A grade is on the oracle-eligible street for its game (draw: must also be a BET,
// not a draw decision — draw decisions are never oracle-graded).
function onOracleStreet(game, g) {
  if (catOf(game) === 'draw') {
    const kind = g.kind || (g.phase === 'draw' ? 'draw' : 'bet');
    return g.street === DRAW_FINAL_STREET && kind === 'bet';
  }
  return g.street === SEVENTH_STREET;
}
// Per-game blueprint trust, from the LBR / fixed-exploiter meter (chips/hand a
// strong opponent could win — lower is better). Surfaced so users know how far
// to trust the EV-loss grades. Source: solver/strategies/BLUEPRINT_TRUST.md.
// All numbers are best-response LOWER BOUNDS (true exploitability >= shown).
// razz = the v2 hole-aware blueprint (shipped 2026-07-05): best-response stud
// LBR 1.42 ± 0.24 chips/hand at 3000 hands/seat. Its old badge said 0.0, but
// that was the weaker fixed-exploiter bound — the frozen v1 measured 3.51 by
// this same LBR meter, so the honest number ROSE while the bot got BETTER.
const GAME_TRUST = {
  razz:   { expl: 1.42, ok: true },
  stud8:  { expl: 2.0,  ok: true },
  td27:   { expl: 2.84, ok: true },
  badugi: { expl: 0.0,  ok: true },
  a5td:   { expl: 0.0,  ok: true },
};
// Per-game scoreboard storage so each game's stats never mix.
const ssKey = (game) => `studTrainer.session.${game}.v1`;

// The evLoss the running SCOREBOARD should count for a grade. On a RANGE-SENSITIVE
// oracle grade ("shown, not charged") the grader zeroes the charge and sends
// chargedEvLoss:0 while keeping the display evLoss — so the scoreboard must count
// chargedEvLoss when present, falling back to evLoss on the default (blueprint)
// path where the field is absent.
function chargedLossOf(g) {
  const charged = g && g.chargedEvLoss != null ? +g.chargedEvLoss : +g.evLoss;
  return Math.max(0, charged || 0);
}

// ── session scoreboard persistence ──────────────────────────────────────
const emptySession = () => ({
  hands: 0,
  totalEvLoss: 0,
  decisions: 0,            // total hero decisions graded
  byStreet: [             // per-street aggregates (index 0..4 = 3rd..7th)
    { loss: 0, n: 0 }, { loss: 0, n: 0 }, { loss: 0, n: 0 }, { loss: 0, n: 0 }, { loss: 0, n: 0 },
  ],
  // recurring leaks: keyed by "street|chosen→best", accumulate count + chips
  leaks: {},
});

function loadSession(game) {
  try {
    const raw = localStorage.getItem(ssKey(game));
    if (!raw) return emptySession();
    const s = JSON.parse(raw);
    // shape guard — fall back to empty if an old/corrupt blob is present
    if (!s || !Array.isArray(s.byStreet) || s.byStreet.length !== 5 || typeof s.leaks !== 'object') return emptySession();
    return s;
  } catch {
    return emptySession();
  }
}

function saveSession(game, s) {
  try { localStorage.setItem(ssKey(game), JSON.stringify(s)); } catch { /* quota / private mode */ }
}

// Fold one hand's grades into the running session totals (immutable).
function applyHandToSession(prev, grades, game) {
  const s = {
    hands: prev.hands + 1,
    totalEvLoss: prev.totalEvLoss,
    decisions: prev.decisions,
    byStreet: prev.byStreet.map((b) => ({ ...b })),
    leaks: { ...prev.leaks },
  };
  for (const g of grades || []) {
    // "shown, not charged": a range-sensitive oracle grade contributes 0 to the
    // running score (chargedEvLoss is 0), even though its display evLoss is shown.
    const loss = chargedLossOf(g);
    s.totalEvLoss += loss;
    s.decisions += 1;
    const st = Math.max(0, Math.min(4, g.street | 0));
    s.byStreet[st] = { loss: s.byStreet[st].loss + loss, n: s.byStreet[st].n + 1 };
    // a leak = a decision where the hero's action wasn't the best one AND it was
    // actually charged (a range-sensitive spot is not counted as a leak).
    if (g.bestActionId != null && g.heroActionId != null && g.bestActionId !== g.heroActionId && loss > 0.01) {
      const bestLabel = labelFor(g, g.bestActionId);
      const kindTag = catOf(game) === 'draw' ? (g.kind === 'draw' ? 'DRAW' : 'BET') + ' ' : '';
      const key = `${streetName(game, st, g.phase)}|${kindTag}${g.heroActionLabel || g.heroActionId} → ${bestLabel}`;
      const cur = s.leaks[key] || { n: 0, chips: 0 };
      s.leaks[key] = { n: cur.n + 1, chips: cur.chips + loss };
    }
  }
  return s;
}

// Resolve a readable label for an actionId within a grade's gtoMix.
function labelFor(g, actionId) {
  const mix = g.gtoMix || {};
  const i = (mix.actions || []).indexOf(actionId);
  if (i >= 0 && mix.labels && mix.labels[i]) return mix.labels[i];
  return actionId;
}

// ── one GTO strategy bar ──────────────────────────────────────────────────
// Grid: one 2r row inside a panel (content 3..34): name 7g (3..10) | 1r track
// on the row's baseline line, 18g (10..28), 2g clear | percent 4g (30..34).
function ActionBar({ name, pct, best, marker }) {
  return (
    <div className="hs-meter" style={{ '--hs-lab': 'calc(var(--gu) * 7)', '--hs-val': 'calc(var(--gu) * 4)' }}>
      {/* wrapper: a trimmed overflow:hidden GRID item loses its content height in WebKit */}
      <div style={{ minWidth: 0, paddingRight: 'var(--gu)' }}>
        <span className="hs-t hs-xs hs-mut hs-clip" style={{ ...T(2), textTransform: 'capitalize' }}>{name}{marker ? ' ' + marker : ''}</span>
      </div>
      <div className="hs-meter-track" style={{ marginRight: 'calc(var(--gu) * 2)' }}>
        <div className="hs-meter-fill" style={{ width: `${pct}%`, background: best ? 'var(--pos, #22c55e)' : 'var(--accent2)' }} />
      </div>
      <span className="hs-t hs-xs hs-num" style={T(2)}>{pct}%</span>
    </div>
  );
}

export default function RazzTrainerView() {
  // selected game (Razz | Stud 8); the backend path uses this segment.
  const [game, setGame] = useState('razz');
  const [seed, setSeed] = useState(null);
  const [heroSeat, setHeroSeat] = useState(0);
  const [state, setState] = useState(null);
  const [legalActions, setLegalActions] = useState(null);
  const [heroActions, setHeroActions] = useState([]); // accumulated hero action ids
  const [handOver, setHandOver] = useState(false);
  const [result, setResult] = useState(null);
  const [grades, setGrades] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [error, setError] = useState(null); // { offline, message }
  // Pro mode = opt-in true-GTO oracle grading (7th-street stud only). OFF by
  // default so the blueprint path stays byte-identical to today.
  const [proMode, setProMode] = useState(false);
  // scoreboard is keyed per-game so Razz and Stud 8 stats stay separate.
  const [session, setSession] = useState(() => loadSession('razz'));

  // guard so we only fold a finished hand into the session once.
  const [scoredSeed, setScoredSeed] = useState(null);
  // bumped whenever a hand is durably saved, to refetch an open History panel.
  const [historyRev, setHistoryRev] = useState(0);

  // ── deal a fresh hand ──
  const deal = useCallback(async (g = game) => {
    setLoading(true); setError(null);
    setState(null); setLegalActions(null); setHeroActions([]);
    setHandOver(false); setResult(null); setGrades(null);
    try {
      const res = await fetchApi(`/solver/trainer/${g}/deal`, { method: 'POST', body: {} });
      let data = null; try { data = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) {
        setError({ offline: res.status === 503, message: (data && data.error) || `server returned ${res.status}` });
        return;
      }
      setSeed(data.seed);
      setHeroSeat(data.heroSeat);
      setState(data.state);
      // if the deal already starts at a hero decision the backend may include
      // legalActions; otherwise step once to advance to the first hero node.
      if (data.legalActions) {
        setLegalActions(data.legalActions);
        setHandOver(!!data.handOver);
        if (data.handOver) { setResult(data.result || null); setGrades(data.grades || null); }
      } else {
        await advance(data.seed, [], g);
      }
    } catch (e) {
      setError({ offline: true, message: e.message || 'network error' });
    } finally {
      setLoading(false);
    }
  }, [game]);

  // ── advance the replay to the next hero decision / terminal ──
  // POSTs the full accumulated heroActions list; the server replays from seed.
  const advance = useCallback(async (sd, actions, g = game) => {
    setStepping(true); setError(null);
    try {
      // Pro mode → route eligible (7th-street stud) decisions through the true-GTO
      // oracle. Only send oracle:true when the toggle is on AND the game actually
      // has an oracle (razz/stud8); otherwise the body is byte-identical to today.
      const body = { seed: sd, heroActions: actions };
      if (proMode && proModeAvailable(g)) body.oracle = true;
      const res = await fetchApi(`/solver/trainer/${g}/step`, { method: 'POST', body });
      let data = null; try { data = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) {
        setError({ offline: res.status === 503, message: (data && data.error) || `server returned ${res.status}` });
        return null;
      }
      setState(data.state);
      setHandOver(!!data.handOver);
      if (data.handOver) {
        setLegalActions(null);
        setResult(data.result || null);
        setGrades(data.grades || null);
      } else {
        setLegalActions(data.legalActions || null);
        setResult(null); setGrades(null);
      }
      return data;
    } catch (e) {
      setError({ offline: true, message: e.message || 'network error' });
      return null;
    } finally {
      setStepping(false);
    }
  }, [game, proMode]);

  // first deal on mount
  useEffect(() => { deal(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // when a hand finishes, fold its grades into the per-game session ONCE, and
  // persist the graded hand to the durable DB record (fire-and-forget — never
  // blocks or breaks the UI; failure offline is silently tolerated).
  useEffect(() => {
    if (handOver && grades && seed != null && scoredSeed !== seed) {
      setSession((prev) => {
        const next = applyHandToSession(prev, grades, game);
        saveSession(game, next);
        return next;
      });
      setScoredSeed(seed);
      // durable persistence — post the full graded-hand object; bump a counter
      // on success so an open History panel refetches.
      const g = game;
      fetchApi(`/solver/trainer/${g}/save-hand`, {
        method: 'POST',
        body: { seed, heroSeat, result, grades },
      })
        .then(() => { if (g === game) setHistoryRev((r) => r + 1); })
        .catch(() => { /* offline / transient — the localStorage scoreboard still has it */ });
    }
  }, [handOver, grades, seed, scoredSeed, game, heroSeat, result]);

  // hero picks a legal action → append + step.
  const pickAction = useCallback(async (actionId) => {
    if (stepping || handOver || !legalActions) return;
    const next = [...heroActions, actionId];
    setHeroActions(next);
    setLegalActions(null); // optimistic: hide buttons while the server replays
    await advance(seed, next);
  }, [stepping, handOver, legalActions, heroActions, seed, advance]);

  // switch game → load that game's scoreboard + deal a fresh hand for it.
  const selectGame = useCallback((g) => {
    if (g === game || loading || stepping) return;
    setGame(g);
    setSession(loadSession(g));
    setScoredSeed(null);
    deal(g);
  }, [game, loading, stepping, deal]);

  const resetSession = useCallback(() => {
    const fresh = emptySession();
    saveSession(game, fresh);
    setSession(fresh);
    setScoredSeed(null); // allow the current finished hand to be re-counted into the fresh session
  }, [game]);

  // ── derived view data ──
  const heroOnTurn = !!(state && !handOver && legalActions && state.toAct === heroSeat);
  // Per-hand total = what the scoreboard CHARGES (range-sensitive grades count 0).
  const totalEvLoss = useMemo(() => (grades || []).reduce((a, g) => a + chargedLossOf(g), 0), [grades]);
  const cat = catOf(game);
  // A draw node = a draw game whose current phase is 'draw'. Its decision UI
  // (Stand pat / Draw K, with keep-vs-throw card highlighting) lives INSIDE the
  // DrawTable so hovering a count lights up the affected hero cards. Betting
  // nodes (in any game) use the generic action panel below.
  const isDrawNode = cat === 'draw' && state && state.phase === 'draw';
  const drawDecisionInTable = isDrawNode && heroOnTurn;

  // ── render ──
  const gameName = GAME_LABEL[game] || game;
  return (
    <div className="hs-view trainer-shell" style={{ maxWidth: R(70) }}>
      {/* Full-width top band (header + game pills + trust badge + pro toggle + error).
          On wide screens it spans above the two columns; on narrow it's the top of the stack.
          Grid: title 4r (baseline on its bottom), 2r, 4r pills on the four 8g rails
          (1r between rows), 1r, 2r caps subtitle lines, 1r, 2r trust lines, 2r. */}
      <div className="trainer-top">
      <h2 className="screen-title hs-t hs-title" style={T(4)}>{gameName} Trainer</h2>
      <div className="hs-cols" style={{ '--hs-n': 4, marginTop: R(2) }}>
        {GAMES.map(([id, lbl]) => (
          <button key={id} className="hs-btn hs-pill" onClick={() => selectGame(id)} disabled={loading || stepping} style={gamePill(game === id, loading || stepping)}>
            <span className="hs-t" style={T(3)}>{lbl}</span>
          </button>
        ))}
      </div>
      <p className="hs-t hs-cap" style={{ ...T(2, 2), marginTop: 'var(--subrow)' }}>
        Heads-up {gameName} · play vs the blueprint · range-aware EV grading
        {game === 'stud8' ? ' · hi/lo split' : ''}
        {cat === 'draw' ? ' · single low · hidden opponent' : ''}
      </p>

      {/* Blueprint trust badge — how far to trust this game's EV-loss grades */}
      {GAME_TRUST[game] && (GAME_TRUST[game].ok ? (
        <div className="hs-t hs-xs hs-mut" style={{ ...T(2, 2), marginTop: 'var(--subrow)' }}>
          <span style={{ color: 'var(--pos, #22c55e)', marginRight: 'var(--gu)' }}>✓</span>
          Trustworthy bot — {GAME_TRUST[game].expl < 0.5 ? '≈0' : `≥${GAME_TRUST[game].expl}`} chips/hand exploitable (best-response LBR, lower bound)
        </div>
      ) : (
        <div className="hs-panel" style={{ marginTop: 'var(--subrow)', '--hs-edge': 'var(--warn, #f59e0b)', '--hs-bg': 'rgba(245,158,11,.10)' }}>
          <div className="hs-t hs-xs" style={T(2, 2)}>
            <span style={{ marginRight: 'var(--gu)' }}>⚠</span>
            <b>Approximate grades.</b> The {gameName} bot is {GAME_TRUST[game].note} (≈{GAME_TRUST[game].expl} chips/hand exploitable). Use its EV-loss as a rough guide, not gospel — it’s being sharpened.
          </div>
        </div>
      ))}

      {/* Pro mode toggle — opt-in true-GTO oracle grading. Only meaningful for
          the stud games (razz/stud8), where 7th-street decisions can be graded
          by the exact re-solver; hidden for the draw games. OFF by default. */}
      {proModeAvailable(game) && (
        <ProModeToggle on={proMode} onToggle={() => setProMode((v) => !v)} disabled={loading || stepping} game={game} />
      )}

      {error && (
        <div className="hs-panel hs-stack" style={{ marginTop: R(2), '--hs-edge': 'var(--neg, #ef4444)', '--hs-bg': 'rgba(239,68,68,.08)' }}>
          <div className="hs-t hs-sm" style={{ ...T(3, 3), color: 'var(--neg, #ef4444)' }}>
            {error.offline
              ? <><b>Trainer offline.</b> The {gameName} trainer backend isn’t reachable. {error.message ? `(${error.message})` : ''}</>
              : <><b>Could not deal:</b> {error.message}</>}
          </div>
          {/* Retry: 5r × 9g on 3..12 (both edges on subcolumn lines). */}
          <button className="hs-btn" onClick={() => deal()} style={{ ...primaryBtn, width: 'calc(var(--gu) * 9)' }}>
            <span className="hs-t" style={T(3)}>Retry</span>
          </button>
        </div>
      )}

      </div>{/* .trainer-top */}

      {/* Two-column split on wide screens: LEFT = play, RIGHT = feedback.
          Collapses to a single stacked column below 900px (see styles.css). */}
      <div className="trainer-cols">
      <div className="trainer-col trainer-col-play">

      {loading && !state && <div className="hs-t hs-sm hs-mut" style={{ ...T(3, 3), marginTop: R(2) }}>Dealing…</div>}

      {state && cat === 'stud' && (
        <StudTable state={state} heroSeat={heroSeat} handOver={handOver} result={result} />
      )}
      {state && cat === 'draw' && (
        <DrawTable
          state={state} heroSeat={heroSeat} handOver={handOver} result={result}
          drawDecision={drawDecisionInTable
            ? { legalActions, onPick: pickAction, stepping, gtoMix: state.gtoMix || (legalActions && legalActions.gtoMix) }
            : null}
        />
      )}

      {/* ── action buttons (hero's turn) ── betting nodes use this generic
          panel; draw nodes render their decision inside DrawTable so the
          keep/throw highlight can react to button hover.
          Grid: 2r caps label, 1r, 5r buttons — 3 across on 9g + 2g + 9g + 2g + 9g,
          otherwise 2 across on 15g + 1g + 15g (content 3..34). ── */}
      {heroOnTurn && !drawDecisionInTable && (
        <div className="hs-panel hs-stack" style={{ marginTop: 'var(--subrow)' }}>
          <div className="hs-t hs-cap" style={T(2)}>Your action {stepping ? '· …' : ''}</div>
          <div className={legalActions.length === 3 ? 'hs-cols3' : 'hs-cols'} style={{ '--hs-n': 2, rowGap: 'var(--subrow)' }}>
            {legalActions.map((a) => (
              <button key={a.id} className="hs-btn" onClick={() => pickAction(a.id)} disabled={stepping}
                style={{ '--hs-h': 5, '--hs-edge': 'var(--accent)', fontSize: 'var(--fs-md)', cursor: stepping ? 'wait' : 'pointer', opacity: stepping ? 0.6 : 1 }}>
                <span className="hs-t" style={T(3)}>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* waiting on opponent / chance between hero turns */}
      {state && !handOver && !heroOnTurn && (
        <div className="hs-panel hs-stack" style={{ marginTop: 'var(--subrow)' }}>
          <div className="hs-t hs-sm hs-mut" style={T(3, 3)}>{stepping ? 'Advancing the hand…' : 'Opponent to act…'}</div>
          {stepping && proMode && proModeAvailable(game) && (
            <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>
              Pro mode — if the hand ends, each {oracleStreetLabel(game)} decision runs an exact GTO re-solve (~1–5s){game === 'badugi' ? '; each pre-last-draw bet is graded by the certified value net (~0.06 SB)' : ''}.
            </div>
          )}
        </div>
      )}

      {/* ── result banner (play side — the hand's conclusion, shown with the felt) ── */}
      {handOver && result && (
        <ResultBanner result={result} heroSeat={heroSeat} game={game} />
      )}

      </div>{/* .trainer-col-play */}

      {/* Feedback side: grading report + deal-next + scoreboard + history. */}
      <div className="trainer-col trainer-col-feedback">

      {/* Grading report — 3r header line (label | total), pro badges (3r, 1r
          between lines) 1r under it, then the grade cards 1r apart. 2r above. */}
      {handOver && grades && (
        <div className="hs-stack" style={{ marginTop: R(2) }}>
          <div className="hs-split">
            <span className="hs-t hs-cap hs-bold" style={{ ...T(3), letterSpacing: '0.14em' }}>Grading report</span>
            <span className="hs-t hs-sm hs-mut" style={T(3)}>
              total EV-loss <b style={{ color: totalEvLoss > 0.5 ? 'var(--neg, #ef4444)' : 'var(--pos, #22c55e)', fontVariantNumeric: 'tabular-nums' }}>
                {totalEvLoss.toFixed(2)}
              </b> chips
            </span>
          </div>
          {/* Pro-mode provenance: shown when at least one decision in this
              hand was graded by the true-GTO oracle / certified net / 6th / 5th
              re-solves. Per-decision badges on each card below say exactly which. */}
          {grades.some((g) => ['oracle', 'certified-net', 'oracle-6th', 'oracle-5th'].includes(g.gradeSource)) && (
            <div className="hs-gbadges">
              {grades.some((g) => g.gradeSource === 'oracle') && (
                <GridBadge edge="var(--accent)" ink="var(--accent)"
                  title={`Pro mode — ${oracleStreetLabel(game)} decisions in this hand were graded by the exact GTO re-solve (oracle); other streets by the blueprint. Each card is tagged with its grade source.`}>
                  pro · true-GTO {catOf(game) === 'draw' ? 'final' : '7th'}
                </GridBadge>
              )}
              {/* CERTIFIED-NET provenance (first neural grade): pre-last-draw badugi
                  bet decisions graded by the trained value net. Kept visually
                  DISTINCT from 'true-GTO' — a certified approximator, not exact. */}
              {grades.some((g) => g.gradeSource === 'certified-net') && (
                <GridBadge edge="var(--accent)" ink="var(--accent)" dashed
                  title="Pro mode — pre-last-draw badugi bet decisions in this hand were graded by the CERTIFIED value net (a neural approximator of GTO, mean grade error ~0.06 small bets), NOT an exact re-solve. Each card is tagged with its grade source.">
                  pro · certified net ~0.06 SB
                </GridBadge>
              )}
              {/* 6th-STREET ORACLE provenance: bucketed 6th→7th re-solve, APPROXIMATE
                  (bucket abstraction), shown but NOT charged. Dashed amber = distinct
                  from the solid-accent near-exact 7th 'true-GTO' and 'certified net'. */}
              {grades.some((g) => g.gradeSource === 'oracle-6th') && (
                <GridBadge edge="var(--accent2, #eab308)" ink="var(--accent2, #eab308)" dashed
                  title="Pro mode — 6th-street decisions in this hand were graded by the bucketed 6th→7th re-solve: APPROXIMATE (bucket abstraction), SHOWN but NOT charged to your score. Distinct from the near-exact 7th-street oracle. Each card is tagged with its grade source.">
                  pro · 6th approx
                </GridBadge>
              )}
              {grades.some((g) => g.gradeSource === 'oracle-5th') && (
                <GridBadge edge="var(--accent2, #eab308)" ink="var(--accent2, #eab308)" dashed
                  title="Pro mode — 5th-street decisions were graded by a depth-limited re-solve with the 6th value net as the leaf: APPROXIMATE (net-leaf, no exact anchor below 6th), SHOWN but NOT charged. The softest tier.">
                  pro · 5th laddered
                </GridBadge>
              )}
            </div>
          )}
          {grades.map((g, i) => <GradeCard key={i} g={g} game={game} />)}
        </div>
      )}

      {/* ── deal next ── 5r button on cols 3–4 (19..36), 2r above. */}
      {handOver && (
        <div className="hs-cols" style={{ '--hs-n': 4, marginTop: R(2) }}>
          <button className="hs-btn" onClick={() => deal()} disabled={loading} style={{ ...primaryBtn, gridColumn: '3 / -1' }}>
            <span className="hs-t" style={T(3)}>{loading ? 'Dealing…' : 'Deal Next Hand'}</span>
          </button>
        </div>
      )}

      {/* ── session scoreboard (per-game) ── */}
      <SessionScoreboard session={session} onReset={resetSession} gameName={gameName} game={game} />

      {/* ── durable per-hand history (DB-backed, per-game) ── */}
      <TrainerHistory game={game} gameName={gameName} rev={historyRev} />

      </div>{/* .trainer-col-feedback */}
      </div>{/* .trainer-cols */}
    </div>
  );
}

// Primary action button: 5r, brand fill, label baseline 3r down.
const primaryBtn = {
  '--hs-h': 5, '--hs-edge': 'transparent', '--hs-fill': 'var(--accent)', '--hs-ink': '#fff',
  fontSize: 'var(--fs-sm)',
};

// ── Pro mode toggle (true-GTO / exact-resolve grading) ────────────────────
// A clearly-labelled opt-in switch. When ON, 7th-street stud decisions are
// graded by the exact re-solver (true GTO) instead of the bucketed blueprint —
// far more accurate, but each eligible decision runs an exact solve (~4-5s), so
// finishing a hand is slower. OFF by default. Matches the app's surface/border/
// accent tokens and the existing switch look.
// Grid: panel 2r × 2g (content 3..34). Row 1 (3r): "Pro mode" (baseline 2r
// down) + a 3r badge, the 3r × 4g switch on 30..34. Then 1r and 2r copy lines
// on 3..28 (clear of the switch column).
function ProModeToggle({ on, onToggle, disabled, game }) {
  const streetLbl = oracleStreetLabel(game);
  const isDraw = catOf(game) === 'draw';
  return (
    <div className="hs-panel" style={{
      marginTop: R(2),
      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) calc(var(--gu) * 4)', columnGap: 'calc(var(--gu) * 2)', rowGap: 'var(--subrow)', alignItems: 'start',
      '--hs-edge': on ? 'var(--accent)' : 'var(--border)',
      '--hs-bg': on ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))' : 'var(--surface)',
      transition: 'background .2s ease',
    }}>
      <div className="hs-gbadges" style={{ alignItems: 'flex-start' }}>
        <span className="hs-t hs-sm hs-bold" style={T(2)}>Pro mode</span>
        <GridBadge edge="var(--accent)" ink="var(--accent)">true GTO</GridBadge>
      </div>
      {/* switch: 3r × 4g, knob 2r inset 0.5r */}
      <button
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        role="switch"
        aria-checked={on}
        aria-label="Pro mode — true-GTO grading"
        title={on ? `Pro mode ON — ${streetLbl} decisions graded by exact GTO re-solve` : 'Pro mode OFF — blueprint grading (fast)'}
        style={{
          position: 'relative', width: 'calc(var(--gu) * 4)', height: R(3), borderRadius: 'var(--radius-pill)', border: 'none', margin: 0,
          boxShadow: 'inset 0 0 0 var(--bw-hair) ' + (on ? 'var(--accent)' : 'var(--border)'),
          background: on ? 'var(--accent)' : 'var(--surface2)',
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
          padding: 0, transition: 'background .18s ease',
          touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
        }}>
        <span style={{
          position: 'absolute', top: 'calc(var(--subrow) * 0.5)', left: on ? 'calc(var(--gu) * 4 - var(--subrow) * 2.5)' : 'calc(var(--subrow) * 0.5)', width: R(2), height: R(2), borderRadius: '50%',
          background: '#fff', transition: 'left .18s cubic-bezier(.4,0,.2,1)',
          boxShadow: '0 calc(var(--subrow) * 0.125) calc(var(--subrow) * 0.25) rgba(0,0,0,.3)',
        }} />
      </button>
      <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>
        Grade {streetLbl} {isDraw ? 'bet' : ''} decisions against an <b style={{ color: 'var(--text)' }}>exact GTO re-solve</b> instead
        of the blueprint bot. Much more accurate — but each {streetLbl} decision runs a full solve ({isDraw ? '~1–2s' : '~4–5s'}), so
        finishing a hand is slower. {isDraw ? 'Earlier draws and every draw decision' : 'Earlier streets'} stay on the blueprint grade.
      </div>
    </div>
  );
}

// pill matching SolverView's game pills (filled when active): 4r, label 3r down.
const gamePill = (active, disabled) => ({
  '--hs-h': 4, padding: 0, fontSize: 'var(--fs-xs)', fontWeight: active ? 'var(--fw-bold)' : 'var(--fw-semibold, 600)', letterSpacing: '0.04em',
  '--hs-edge': active ? 'var(--text)' : 'var(--border)',
  '--hs-fill': active ? 'var(--text)' : 'transparent',
  '--hs-ink': active ? 'var(--bg)' : 'var(--text-muted)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled && !active ? 0.5 : 1,
});

// Seat label row: 2r — caps name + a caps "to act" flag, both baselines on its bottom.
function SeatLabel({ name, toAct, color }) {
  return (
    <div style={{ display: 'flex', columnGap: 'var(--gu)', alignItems: 'flex-start' }}>
      <span className="hs-t hs-cap" style={T(2)}>{name}</span>
      {toAct && <span className="hs-t hs-cap" style={{ ...T(2), color }}>to act</span>}
    </div>
  );
}

// Action log — hairline rule (inset, no height) + 1r, 2r lines, at most 16r tall.
function ActionLog({ log, heroSeat, streetOf }) {
  if (!log || !log.length) return null;
  return (
    <div className="hs-rule" style={{ maxHeight: R(17), overflowY: 'auto' }}>
      {log.map((e, i) => (
        <div key={i} className="hs-t hs-xs hs-mut" style={T(2, 2)}>
          <b style={{ color: e.seat === heroSeat ? 'var(--pos, #22c55e)' : 'var(--accent)' }}>
            {e.seat === heroSeat ? 'You' : 'Opp'}
          </b>
          <span style={{ opacity: 0.7 }}> · {streetOf(e)}</span> {e.label}
        </div>
      ))}
    </div>
  );
}

// ── heads-up stud table (game-agnostic: down + up cards) ──────────────────
// Grid: panel 2r × 2g, rows 1r apart — 3r header, [dead-card box], opponent
// (2r label, 1r, 6r card row: 2r lift + 4r cards), hero (same), log.
function StudTable({ state, heroSeat, handOver, result }) {
  const oppShowdown = handOver && result && result.showdown ? result.showdown.oppDown : null;
  const bringInIsHero = state.bringInSeat === heroSeat;
  // Folded opponents' exposed door cards — visible removal the player should
  // read at a glance. Backend supplies these on state.deadCards for stud games.
  const deadCards = Array.isArray(state.deadCards) ? state.deadCards : [];

  return (
    <div className="hs-panel hs-stack" style={{ marginTop: R(2) }}>
      <div className="hs-split">
        <span className="hs-t hs-md hs-bold" style={T(3)}>{STREET_NAMES[state.street] || `street ${state.street}`} street</span>
        <span className="hs-t hs-cap hs-clip" style={T(3)}>Pot {state.pot} · bring-in {bringInIsHero ? 'hero' : 'opp'}</span>
      </div>

      {/* Dead cards — folded opponents' exposed door cards, dimmed/face-up so the
          player can read removal at a glance. Box 1r × 2g (content 5..32). */}
      {deadCards.length > 0 && (
        <div className="hs-box hs-stack" style={{ padding: 'var(--subrow) calc(var(--gu) * 2)', '--hs-bg': 'color-mix(in srgb, var(--surface) 70%, #000)' }}>
          <span className="hs-t hs-cap" style={T(2)}>Dead (folded): {deadCards.length} {deadCards.length === 1 ? 'card' : 'cards'}</span>
          <div className="hs-cards" style={{ opacity: 0.85 }}>
            {deadCards.map((c, i) => <Card key={'dc' + i} str={c} dim size="sm" />)}
          </div>
        </div>
      )}

      {/* Opponent */}
      <SeatLabel name="Opponent" toAct={state.toAct === (1 - heroSeat) && !handOver} color="var(--accent)" />
      {/* Card order: [2 hole cards] [upcards raised] [7th-street river, not raised].
          The river is a down card but sits at the END (right of the 6th upcard) and
          at hole-card level. Hidden pre-showdown; revealed face-up at showdown. */}
      <div className="hs-cards hs-raise">
        {oppShowdown
          ? oppShowdown.slice(0, 2).map((c, i) => <Card key={'od' + i} str={c} size="sm" />)
          : Array.from({ length: 2 }).map((_, i) => <Card key={'ob' + i} faceDown size="sm" />)}
        {(state.oppUp || []).map((c, i) => <Card key={'ou' + i} str={c} size="sm" raised />)}
        {state.street === 4 && (oppShowdown
          ? oppShowdown.slice(2).map((c, i) => <Card key={'or' + i} str={c} size="sm" />)
          : <Card key="orb" faceDown size="sm" />)}
      </div>

      {/* Hero */}
      <SeatLabel name="You" toAct={state.toAct === heroSeat && !handOver} color="var(--pos, #22c55e)" />
      <div className="hs-cards hs-raise">
        {(state.heroDown || []).slice(0, 2).map((c, i) => <Card key={'hd' + i} str={c} size="sm" />)}
        {(state.heroUp || []).map((c, i) => <Card key={'hu' + i} str={c} size="sm" raised />)}
        {(state.heroDown || []).slice(2).map((c, i) => <Card key={'hr' + i} str={c} size="sm" />)}
      </div>

      <ActionLog log={state.log} heroSeat={heroSeat} streetOf={(e) => STREET_NAMES[e.street] || `s${e.street}`} />
    </div>
  );
}

// ── heads-up DRAW table (td27) ────────────────────────────────────────────
// NO upcards. One hero row of 5 face-up cards; one opponent row that is
// ENTIRELY face-down until showdown. The header reads the round off
// street+phase. We surface the opponent's completed draw counts, the hero's
// last discards (dimmed), and the pot. When it is a hero DRAW node the decision
// buttons live here (passed via `drawDecision`) so hovering a "Draw K" count
// highlights exactly which hero cards that count would KEEP vs THROW — the
// abstraction picks WHICH cards (discardIdx), the player picks the COUNT.
// Grid: panel 2r × 2g, rows 1r apart. Hero cards are 2g × 4r with a 1g gap
// (the keep/throw ring is an outer shadow, so it takes no room), plus a 2r
// keep/throw caption while choosing; a thrown card drops 1r.
function DrawTable({ state, heroSeat, handOver, result, drawDecision }) {
  // hover/focus highlight: indices into heroCards that the previewed draw THROWS
  // (used by the SOLVER-RECOMMENDATION hint — hovering a suggested count lights up
  // which cards it would throw, exactly as the old count buttons did).
  const [hoverThrow, setHoverThrow] = React.useState(null);

  // FULL DISCARD CONTROL — the hero's own selection: a Set of heroCards INDICES
  // the hero has chosen to THROW. Click a card to toggle. Reset whenever the hand
  // identity (the actual 5 cards) changes so a new draw node starts fresh.
  const heroCards = state.heroCards || [];
  const handKey = heroCards.join('');
  const [thrownSet, setThrownSet] = React.useState(() => new Set());
  React.useEffect(() => { setThrownSet(new Set()); }, [handKey, drawDecision ? 1 : 0]);

  const picking = !!drawDecision; // hero is AT a draw node, cards are clickable
  const toggleCard = (i) => {
    if (!picking || drawDecision.stepping) return;
    setThrownSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };
  const standPat = () => { if (picking && !drawDecision.stepping) setThrownSet(new Set()); };
  const confirmDiscard = () => {
    if (!picking || drawDecision.stepping) return;
    const thrownStrs = heroCards.filter((_, i) => thrownSet.has(i));
    drawDecision.onPick(encodeDiscard(thrownStrs)); // 'd:' + sorted thrown 2-char
  };
  const throwCount = thrownSet.size;
  const oppDraws = state.oppDrawCounts || [];
  const myDiscards = state.myLastDiscards || [];
  const handSize = heroCards.length || 5;
  const oppShowdown = handOver && result && result.showdown ? result.showdown.oppCards : null;

  // Round header from street+phase. (game-agnostic across draw games; state.game
  // is td27 or badugi — both map to the same 'draw' street labels.)
  const drawGame = state.game || 'td27';
  const roundLabel = streetName(drawGame, state.street, state.phase);
  const phaseTag = state.phase === 'draw' ? 'draw' : 'bet';
  const anyCaption = picking || hoverThrow != null;

  return (
    <div className="hs-panel hs-stack" style={{ marginTop: R(2) }}>
      <div className="hs-split">
        <span className="hs-t hs-md hs-bold" style={T(3)}>
          {roundLabel}
          <span style={{ fontSize: 'var(--fs-2xs)', lineHeight: 0, fontWeight: 'var(--fw-regular)', textTransform: 'uppercase', letterSpacing: 'var(--track-caps)', color: 'var(--text-muted)', marginLeft: 'var(--gu)' }}>{phaseTag}</span>
        </span>
        <span className="hs-t hs-cap" style={T(3)}>Pot {state.pot}</span>
      </div>

      {/* Opponent — entirely hidden until showdown. */}
      <div style={{ display: 'flex', columnGap: 'var(--gu)', alignItems: 'flex-start', minWidth: 0 }}>
        <span className="hs-t hs-cap" style={T(2)}>Opponent</span>
        {state.toAct === (1 - heroSeat) && !handOver && <span className="hs-t hs-cap" style={{ ...T(2), color: 'var(--accent)' }}>to act</span>}
        {oppDraws.length > 0 && <span className="hs-t hs-xs hs-mut hs-clip" style={T(2)}>{oppDraws.map((k) => `Opp drew ${k}`).join(' · ')}</span>}
      </div>
      <div className="hs-cards">
        {oppShowdown
          ? oppShowdown.map((c, i) => <Card key={'oc' + i} str={c} size="sm" />)
          : Array.from({ length: handSize }).map((_, i) => <Card key={'ob' + i} faceDown size="sm" />)}
      </div>

      {/* Hero — five face-up cards; on draw-button hover, ring kept vs throw. */}
      <SeatLabel name="You" toAct={state.toAct === heroSeat && !handOver} color="var(--pos, #22c55e)" />
      <div className="hs-cards" style={{ columnGap: 'var(--gu)', paddingBottom: 'var(--subrow)' }}>
        {heroCards.map((c, i) => {
          // When the hero is PICKING, the source of truth is their click
          // selection (thrownSet); the solver-hint hover preview only applies
          // when nothing is being actively chosen at a non-pick node.
          const selThrown = picking && thrownSet.has(i);
          const previewing = !picking && hoverThrow != null;
          const hoverT = previewing && hoverThrow.includes(i);
          // visual state: a card is "throw" if selected (pick) or hover-throw.
          const isThrow = picking ? selThrown : hoverT;
          // a "keep" ring shows on every card while picking, or on the
          // non-thrown cards during a hint hover.
          const showKeep = picking ? !selThrown : (previewing && !hoverT);
          const ring = isThrow ? 'var(--neg, #ef4444)' : showKeep ? 'var(--pos, #22c55e)' : 'transparent';
          return (
            <span key={'hc' + i}
              onClick={picking ? () => toggleCard(i) : undefined}
              onKeyDown={picking ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(i); } } : undefined}
              role={picking ? 'button' : undefined}
              tabIndex={picking ? 0 : undefined}
              aria-pressed={picking ? selThrown : undefined}
              aria-label={picking ? `${selThrown ? 'Throwing' : 'Keeping'} ${c} — click to ${selThrown ? 'keep' : 'throw'}` : undefined}
              title={picking ? (selThrown ? 'Click to KEEP' : 'Click to THROW') : undefined}
              style={{
                touchAction: 'manipulation', userSelect: 'none', WebkitTapHighlightColor: 'transparent',
                display: 'flex', flexDirection: 'column', alignItems: 'center', width: 'calc(var(--gu) * 2)',
                cursor: picking ? (drawDecision.stepping ? 'wait' : 'pointer') : 'default',
                transition: 'transform .08s ease',
                transform: selThrown ? 'translateY(var(--subrow))' : 'none',
              }}>
              <span style={{ display: 'block', borderRadius: 'var(--radius-xs)', boxShadow: `0 0 0 calc(var(--subrow) * 0.25) ${ring}`, transition: 'box-shadow .12s ease' }}>
                <Card str={c} size="sm" dim={isThrow} />
              </span>
              {anyCaption && (
                <span className="hs-t" style={{ ...T(2), fontSize: 'var(--fs-2xs)', textTransform: 'uppercase', letterSpacing: '0.04em', color: isThrow ? 'var(--neg, #ef4444)' : 'var(--pos, #22c55e)', visibility: (picking || previewing) ? 'visible' : 'hidden' }}>
                  {isThrow ? 'throw' : 'keep'}
                </span>
              )}
            </span>
          );
        })}
      </div>

      {/* hero's most recent discards (dimmed): 4r row, caps label (baseline 3r down) on 3..12, cards from 12g. */}
      {myDiscards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'calc(var(--gu) * 9) minmax(0, 1fr)', alignItems: 'start' }}>
          <span className="hs-t hs-cap" style={T(3)}>you discarded</span>
          <div className="hs-cards">{myDiscards.map((c, i) => <Card key={'md' + i} str={c} dim size="sm" />)}</div>
        </div>
      )}

      {/* DRAW decision — FULL DISCARD CONTROL. Click the cards above to choose
          EXACTLY which to throw, then Confirm; or Stand Pat to throw none. The
          solver's abstraction recommendation is shown as a hint (hovering it
          lights up which cards IT would throw). The submitted action is the
          explicit string 'd:' + sorted thrown 2-char codes.
          Grid: rule + 1r, 2r caps label, 1r, 3r count line, 1r, 5r buttons on
          the two 15g halves, 1r, the hint box. */}
      {drawDecision && (
        <div className="hs-rule hs-stack">
          <div className="hs-t hs-cap" style={T(2, 2)}>
            Choose your discard {drawDecision.stepping ? '· …' : ''}
            <span style={{ textTransform: 'none', marginLeft: 'var(--gu)' }}>(click any cards to throw them)</span>
          </div>

          <div className="hs-t hs-md hs-bold" style={T(3, 3)}>
            {throwCount === 0 ? 'Standing pat — drawing 0' : `Throwing ${throwCount} — drawing ${throwCount}`}
            {throwCount > 0 && (
              <span style={{ fontSize: 'var(--fs-xs)', lineHeight: 0, fontWeight: 'var(--fw-regular)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', marginLeft: 'var(--gu)' }}>
                ({heroCards.filter((_, i) => thrownSet.has(i)).join(' ')})
              </span>
            )}
          </div>

          <div className="hs-cols" style={{ '--hs-n': 2 }}>
            <button className="hs-btn" onClick={standPat} disabled={drawDecision.stepping || throwCount === 0}
              style={{ '--hs-h': 5, '--hs-ink': 'var(--text-muted)', cursor: drawDecision.stepping ? 'wait' : (throwCount === 0 ? 'default' : 'pointer') }}>
              <span className="hs-t" style={T(3)}>Stand Pat</span>
            </button>
            <button className="hs-btn" onClick={confirmDiscard} disabled={drawDecision.stepping}
              style={{ '--hs-h': 5, '--hs-edge': 'transparent', '--hs-fill': 'var(--brand)', '--hs-ink': 'var(--on-brand)', cursor: drawDecision.stepping ? 'wait' : 'pointer' }}>
              <span className="hs-t" style={T(3)}>{throwCount === 0 ? 'Confirm — Stand Pat' : `Confirm Discard — Draw ${throwCount}`}</span>
            </button>
          </div>

          {/* SOLVER RECOMMENDATION hint (so the trainer still teaches GTO). Built
              from the abstraction draw options in legalActions: each carries a
              label + discardIdx (which cards that count throws). Hovering a
              suggestion lights up those cards above. If the contract supplies a
              gtoMix (probs), show the frequencies; otherwise just the options. */}
          <SolverDrawHint
            legalActions={drawDecision.legalActions}
            gtoMix={drawDecision.gtoMix}
            heroCards={heroCards}
            onHover={setHoverThrow}
          />
        </div>
      )}

      {/* Action log (shared shape with StudTable; draw rounds included). */}
      <ActionLog log={state.log} heroSeat={heroSeat} streetOf={(e) => streetName(drawGame, e.street, e.phase)} />
    </div>
  );
}

// ── SOLVER RECOMMENDATION hint at a hero DRAW node ────────────────────────
// Surfaces the blueprint's ABSTRACTION strategy (stand pat / draw-to-best) so
// the trainer still teaches GTO even though the hero now has full discard
// control. Each legalAction entry carries { id:'dK', label, discardIdx } — the
// indices (into heroCards) the abstraction would THROW for that count. We map
// each option to the actual thrown card strings and, when a gtoMix (probs) is
// present, the play frequency. Hovering an option lights up its cards above.
// Grid: box 1r × 2g (text on 5..32), 2r lines.
function SolverDrawHint({ legalActions, gtoMix, heroCards, onHover }) {
  const opts = Array.isArray(legalActions) ? legalActions : [];
  if (opts.length === 0) return null;

  // Frequencies, if the contract forwarded the draw infoset's gtoMix.
  const probFor = (id) => {
    if (!gtoMix || !Array.isArray(gtoMix.actions)) return null;
    const i = gtoMix.actions.indexOf(id);
    return i >= 0 && Array.isArray(gtoMix.probs) ? gtoMix.probs[i] : null;
  };

  // Pretty per-option text: "stand pat" or "draw N (throw Kc, 9s)".
  const optText = (a) => {
    const idx = Array.isArray(a.discardIdx) ? a.discardIdx : [];
    if (idx.length === 0) return 'stand pat';
    const cards = idx.map((i) => heroCards[i]).filter(Boolean).join(', ');
    return `draw ${idx.length}${cards ? ` (throw ${cards})` : ''}`;
  };

  // sort by frequency desc when we have it, so the top recommendation reads first.
  const sorted = opts
    .map((a) => ({ a, p: probFor(a.id), idx: Array.isArray(a.discardIdx) ? a.discardIdx : [] }))
    .sort((x, y) => (y.p ?? 0) - (x.p ?? 0));

  return (
    <div className="hs-box" style={{ '--hs-bg': 'var(--surface2)', padding: 'var(--subrow) calc(var(--gu) * 2)' }}>
      <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>
        <span style={{ fontSize: 'var(--fs-2xs)', lineHeight: 0, textTransform: 'uppercase', letterSpacing: 'var(--track-caps)', marginRight: 'var(--gu)' }}>Solver</span>
        {/* The separator sits OUTSIDE the nowrap option spans: inside them there was
            no break opportunity anywhere in the line, so a long option ran out of the box. */}
        {sorted.map(({ a, p, idx }, i) => (
          <React.Fragment key={a.id}>
            <span
              onMouseEnter={() => onHover(idx)}
              onMouseLeave={() => onHover(null)}
              style={{ cursor: 'help', whiteSpace: 'nowrap' }}>
              <b style={{ color: 'var(--text)' }}>{optText(a)}</b>
              {p != null ? <span style={{ color: 'var(--accent)' }}> {Math.round(p * 100)}%</span> : null}
            </span>
            {i < sorted.length - 1 ? <span style={{ opacity: 0.6 }}>{' · '}</span> : null}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// who-won label for a single board (hi or lo). `who` ∈ {'hero','opp','split',null}.
function sideWinnerLabel(who) {
  if (who === 'hero') return 'You';
  if (who === 'opp') return 'Opp';
  if (who === 'split') return 'Split';
  return '—';
}

// ── result banner ─────────────────────────────────────────────────────────
// Razz: low-only — show winner + each player's low.
// Stud 8: hi/lo split — classify the pot outcome (scoop / split / quarter) and
//   show BOTH boards: the hi winner + winning hi hand, and the lo winner +
//   qualifying low (or "no qualifier").
// Grid: panel 2r × 2g; 3r headline line (headline | ± chips), then 1r-spaced rows.
function ResultBanner({ result, heroSeat, game }) {
  const delta = +result.heroDelta || 0;
  const sd = result.showdown || {};
  const isStud8 = game === 'stud8';
  const isDraw = catOf(game) === 'draw';

  // headline outcome
  let headline;
  if (result.endType === 'fold') {
    headline = result.winner === 'hero' ? 'You win' : result.winner === 'opp' ? 'Opponent wins' : 'Hand over';
  } else if (isStud8) {
    // Classify from the hi/lo sub-winners. A "scoop" = same player wins both
    // (or wins hi while no low qualifies). A "quarter" = you split one board
    // and lose/tie the other → quarter of the pot. Otherwise a clean split.
    const hiW = sd.hi ? sd.hi.winner : result.winner;
    const loQualifies = !!(sd.lo && sd.lo.winner && sd.lo.winner !== 'none');
    const loW = loQualifies ? sd.lo.winner : null;
    headline = classifyStud8(hiW, loW, loQualifies);
  } else {
    const won = result.winner === 'hero';
    const split = result.winner === 'split';
    headline = split ? 'Split pot' : won ? 'You win' : result.winner === 'opp' ? 'Opponent wins' : 'Hand over';
  }

  return (
    <div className="hs-panel hs-stack" style={{ marginTop: 'var(--subrow)', '--hs-edge': delta > 0 ? 'var(--pos, #22c55e)' : delta < 0 ? 'var(--neg, #ef4444)' : 'var(--border)' }}>
      <div className="hs-split">
        <span className="hs-t hs-md hs-bold" style={T(3)}>
          {headline}
          {result.endType === 'fold' && <span style={{ fontSize: 'var(--fs-2xs)', lineHeight: 0, fontWeight: 'var(--fw-regular)', textTransform: 'uppercase', letterSpacing: 'var(--track-caps)', color: 'var(--text-muted)', marginLeft: 'var(--gu)' }}>(by fold)</span>}
        </span>
        <span className="hs-t hs-bold hs-num" style={{ ...T(3), fontSize: 'var(--fs-xl)', '--hs-lh': 4, color: delta > 0 ? 'var(--pos, #22c55e)' : delta < 0 ? 'var(--neg, #ef4444)' : 'var(--text-muted)' }}>
          {delta > 0 ? '+' : ''}{delta} chips
        </span>
      </div>

      {/* per-board breakdown */}
      {result.endType !== 'fold' && (isStud8
        ? <Stud8Boards sd={sd} />
        : isDraw
        ? ((sd.heroHand || sd.oppHand) && (
            <>
              {sd.heroHand && <div className="hs-t hs-sm hs-mut" style={T(3, 3)}>Your hand: <b style={{ color: 'var(--text)' }}>{sd.heroHand}</b></div>}
              {sd.oppHand && <div className="hs-t hs-sm hs-mut" style={T(3, 3)}>Opp hand: <b style={{ color: 'var(--text)' }}>{sd.oppHand}</b></div>}
              {Array.isArray(sd.oppCards) && sd.oppCards.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'calc(var(--gu) * 7) minmax(0, 1fr)', alignItems: 'start' }}>
                  <span className="hs-t hs-cap" style={T(3)}>opp shows</span>
                  <div className="hs-cards">{sd.oppCards.map((c, i) => <Card key={'os' + i} str={c} size="sm" />)}</div>
                </div>
              )}
            </>
          ))
        : ((sd.heroLow || sd.oppLow) && (
            <>
              {sd.heroLow && <div className="hs-t hs-sm hs-mut" style={T(3, 3)}>Your low: <b style={{ color: 'var(--text)' }}>{sd.heroLow}</b></div>}
              {sd.oppLow && <div className="hs-t hs-sm hs-mut" style={T(3, 3)}>Opp low: <b style={{ color: 'var(--text)' }}>{sd.oppLow}</b></div>}
            </>
          )))}
    </div>
  );
}

// Map (hiWinner, loWinner) → human outcome for the hero's perspective.
function classifyStud8(hiW, loW, loQualifies) {
  // no qualifying low → the whole pot rides on the hi board.
  if (!loQualifies) {
    if (hiW === 'hero') return 'You scoop';
    if (hiW === 'opp') return 'Opponent scoops';
    return 'Split pot'; // hi tie, no low
  }
  // both boards live.
  if (hiW === 'hero' && loW === 'hero') return 'You scoop';
  if (hiW === 'opp' && loW === 'opp') return 'Opponent scoops';
  if (hiW === 'split' && loW === 'split') return 'Split pot';
  // mixed: hero wins exactly one half (or shares one) → quarter territory.
  const heroHalves = (hiW === 'hero' ? 1 : hiW === 'split' ? 0.5 : 0) + (loW === 'hero' ? 1 : loW === 'split' ? 0.5 : 0);
  if (heroHalves > 0 && heroHalves < 2) {
    if (heroHalves === 0.5 || heroHalves === 1.5) return 'You get a quarter';
    return 'Split pot'; // heroHalves === 1: one each
  }
  return 'Split pot';
}

// Stud 8 hi/lo board breakdown: hi winner + winning hi hand, lo winner +
// qualifying low (or "no qualifier"). Tolerant of partial fields.
// Grid: two 15g boxes (3..18, 19..34), 1r × 2g padding (text on 5.. / 21..).
function Stud8Boards({ sd }) {
  const hi = sd.hi || {};
  const lo = sd.lo || {};
  const loQualifies = !!(lo.winner && lo.winner !== 'none');
  const box = { '--hs-bg': 'var(--surface2)', padding: 'var(--subrow) calc(var(--gu) * 2)' };
  return (
    <div className="hs-cols" style={{ '--hs-n': 2, alignItems: 'start' }}>
      <div className="hs-box hs-stack" style={box}>
        <div className="hs-t hs-cap" style={T(2, 2)}>High · {sideWinnerLabel(hi.winner)}</div>
        <div className="hs-t hs-sm" style={T(3, 3)}>
          {hi.hand ? <b>{hi.hand}</b> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </div>
        {(hi.heroHand || hi.oppHand) && (
          <div>
            {hi.heroHand && <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>You: {hi.heroHand}</div>}
            {hi.oppHand && <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>Opp: {hi.oppHand}</div>}
          </div>
        )}
      </div>
      <div className="hs-box hs-stack" style={box}>
        <div className="hs-t hs-cap" style={T(2, 2)}>Low · {loQualifies ? sideWinnerLabel(lo.winner) : 'no qualifier'}</div>
        {loQualifies ? (
          <>
            <div className="hs-t hs-sm" style={T(3, 3)}>
              {lo.hand ? <b>{lo.hand}</b> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </div>
            {(lo.heroLow || lo.oppLow) && (
              <div>
                {lo.heroLow && <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>You: {lo.heroLow}</div>}
                {lo.oppLow && <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>Opp: {lo.oppLow}</div>}
              </div>
            )}
          </>
        ) : (
          <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>No 8-or-better low — hi takes it all</div>
        )}
      </div>
    </div>
  );
}

// ── one hero decision's grade card ────────────────────────────────────────
// Game-agnostic GTO-mix + per-action-EV report. For DRAW games it tags each
// decision DRAW vs BET (e.g. "DRAW · you drew 2" / "BET · you called") and
// shows a range-degraded / low-confidence badge when grade.confidence==='low'.
// Grid: panel 2r × 2g; 3r header line (head | EV-loss), [badges], then a 2r bar
// row per action (+ a 2r EV line), 1r apart; rule-topped footers.
function GradeCard({ g, game }) {
  const mix = g.gtoMix || { actions: [], labels: [], probs: [] };
  const acts = mix.actions || [];
  const labels = mix.labels || [];
  const probs = mix.probs || [];
  const maxProb = probs.length ? Math.max(...probs) : 0;
  const evLoss = Math.max(0, +g.evLoss || 0);
  const isLeak = evLoss > 0.5;
  const se = g.evLossSE != null ? +g.evLossSE : null;
  const isDraw = catOf(game) === 'draw';
  // 'draw' | 'bet' — the grader sends g.kind; fall back to phase for safety.
  const kind = g.kind || (g.phase === 'draw' ? 'draw' : 'bet');
  const lowConf = g.confidence === 'low';

  // ── Pro mode grade provenance ───────────────────────────────────────────
  // gradeSource is present ONLY when the hand was graded with the oracle on
  // (Pro mode). 'oracle' = this decision was graded by the exact true-GTO
  // re-solve; 'blueprint' = it used the bucketed blueprint. undefined = the
  // default (blueprint) grader ran and never tagged provenance → show nothing.
  const gradeSource = g.gradeSource; // 'oracle' | 'certified-net' | 'blueprint' | undefined
  const isOracleGrade = gradeSource === 'oracle';
  // CERTIFIED NET (first neural grade): pre-last-draw badugi bet graded by the
  // trained value net (torch-free numpy serving). This is HONESTLY distinct from
  // the exact 'true GTO' oracle — it is an APPROXIMATOR with a certified mean grade
  // error (certificationSB, ~0.06 SB), NOT an exact/GTO guarantee.
  const isNetGrade = gradeSource === 'certified-net';
  const certSB = (typeof g.certificationSB === 'number') ? g.certificationSB : 0.06;
  // 6th-STREET ORACLE (bucketed 6th→7th re-solve): APPROXIMATE by design (bucket
  // abstraction), distinct from BOTH 'true GTO' (7th, near-exact) and 'certified
  // net'. Shown but NEVER charged. Per-game abstraction badge (stud8 tight, razz
  // coarse) from the cert.
  const isOracle6thGrade = gradeSource === 'oracle-6th';
  const oracle6thChips = (typeof g.oracle6thAbstractionChips === 'number') ? g.oracle6thAbstractionChips : 2.0;
  // 5th-STREET ORACLE: depth-limited 5th resolve with the 6th net as the leaf.
  // The MOST approximate tier (net leaf + no exact anchor below 6th) — 'laddered'.
  const isOracle5thGrade = gradeSource === 'oracle-5th';
  // A decision on an oracle/net-eligible street (stud 7th / draw post-last-draw bet
  // / badugi pre-last-draw bet) that still came back as 'blueprint' under Pro mode
  // means the exact/net path was unavailable and it fell back — surface that
  // honestly rather than passing it off as true-GTO / certified.
  const netEligibleStreet = catOf(game) === 'draw' && game === 'badugi'
    && g.street === 2 && (g.kind || (g.phase === 'draw' ? 'draw' : 'bet')) === 'bet';
  const oracleFellBack = gradeSource === 'blueprint'
    && (onOracleStreet(game, g) || netEligibleStreet);
  // trust flag from the oracle (Fix 2): grade is trusted on EV-convergence.
  const oracleUnconverged = isOracleGrade && g.oracleGradeTrust && g.oracleGradeTrust !== 'ev-converged';
  // RANGE-SENSITIVE ("shown, not charged"): the oracle best action flipped or the
  // evLoss spread exceeded ~2 chips across a prior ensemble, so the grade is shown
  // but its evLoss is not charged to the running score. Distinct from the true-GTO
  // badge. The spread is the [min,max] evLoss across the ensemble.
  const rangeSensitive = !!g.rangeSensitive;
  const rsSpread = Array.isArray(g.rangeSensitiveSpread) ? g.rangeSensitiveSpread : null;
  // Whether the charge was actually zeroed (== the display loss differs from the
  // charged loss). For draw this is always true when flagged; for stud it depends
  // on the deploy gate — chargedEvLoss reflects the truth.
  const notCharged = rangeSensitive && g.chargedEvLoss != null && +g.chargedEvLoss === 0 && evLoss > 0.01;

  // FULL DISCARD CONTROL — was this a hero DRAW decision made by explicit card
  // selection ('d:...')? Show which cards they actually threw, the EV of that
  // discard, and the solver note. Tolerant of older grade shapes: an action id
  // starting 'd:' is an explicit discard even if the explicitDiscard flag is
  // absent; the thrown cards parse out of the id itself.
  const heroId = g.heroActionId || '';
  const isExplicit = kind === 'draw' && (g.explicitDiscard || (typeof heroId === 'string' && heroId.startsWith('d:')));
  const thrownCards = isExplicit
    ? heroId.slice(2).match(/.{1,2}/g) || []
    : [];
  const heroDiscardEV = g.perActionEV ? g.perActionEV[heroId] : undefined;

  // street/round header text + a DRAW/BET prefix for draw games.
  const head = isDraw
    ? `${(kind === 'draw' ? 'DRAW' : 'BET')} · ${streetName(game, g.street, g.phase)}`
    : `${streetName(game, g.street, g.phase)} street`;

  const AMBER = 'var(--accent2, #eab308)';
  const WARN = 'var(--warn, #f59e0b)';
  const badges = [
    lowConf && <GridBadge key="lc" edge={AMBER} ink={AMBER} title="Opponent range degraded (low particle-filter confidence) — treat this EV as approximate.">range-degraded · low confidence</GridBadge>,
    // ── Pro-mode grade-source badges (only when gradeSource is tagged,
    //    i.e. the hand was graded with the oracle on) ──
    isOracleGrade && <GridBadge key="or" edge="var(--accent)" ink="var(--accent)"
      title={`Graded by the exact GTO re-solve (true GTO), not the blueprint bot.${g.oracleIters ? ` ${g.oracleIters} CFR+ iters` : ''}${g.oracleResolveExploitability != null ? ` · resolver self-play gap ${Number(g.oracleResolveExploitability).toFixed(2)} chips` : ''}`}>true GTO</GridBadge>,
    isNetGrade && <GridBadge key="net" edge="var(--accent)" ink="var(--accent)"
      title={`Graded by the CERTIFIED value net (torch-free) — a neural approximator of GTO for this pre-last-draw badugi spot, NOT an exact re-solve. Certified mean grade error ~${certSB.toFixed(2)} small bets.${g.netValueGauge != null ? ` · net zero-sum residual ${Number(g.netValueGauge).toExponential(1)}` : ''}`}>certified net · ~{certSB.toFixed(2)} SB</GridBadge>,
    isOracle6thGrade && <GridBadge key="o6" edge={AMBER} ink={AMBER} dashed
      title={`Graded by the bucketed 6th→7th re-solve — APPROXIMATE (bucket abstraction), NOT exact. SHOWN but NOT charged to your score. Estimated abstraction gap ~${oracle6thChips.toFixed(1)} chips for this game.${g.oracleIters ? ` · ${g.oracleIters} CFR+ iters` : ''}`}>6th oracle · approx ~{oracle6thChips.toFixed(1)}ch</GridBadge>,
    isOracle5thGrade && <GridBadge key="o5" edge={AMBER} ink={AMBER} dashed
      title={`Graded by a depth-limited 5th-street re-solve using the 6th value net as the leaf — APPROXIMATE (net leaf + public up-card sampling, and NO exact anchor below 6th street). SHOWN but NOT charged to your score. The softest tier — one street below the last exactly-referenceable street.${g.oracleIters ? ` · ${g.oracleIters} CFR+ iters` : ''}`}>5th oracle · laddered</GridBadge>,
    oracleFellBack && <GridBadge key="fb" edge={WARN} ink={WARN}
      title={`Pro mode was on, but the ${netEligibleStreet ? 'certified value net' : 'exact re-solver'} was unavailable for this decision — this grade fell back to the blueprint bot. Treat it as an ordinary blueprint grade, not ${netEligibleStreet ? 'a certified-net grade' : 'true GTO'}.`}>
      {netEligibleStreet ? 'net unavailable · blueprint grade' : 'oracle unavailable · blueprint grade'}</GridBadge>,
    gradeSource === 'blueprint' && !oracleFellBack && <GridBadge key="bp"
      title={`Graded by the blueprint bot — the Pro-mode oracle covers only ${oracleStreetLabel(game)} decisions.`}>blueprint</GridBadge>,
    oracleUnconverged && <GridBadge key="uc" edge={WARN} ink={WARN}
      title={`The oracle's per-action EV had not converged at ${g.oracleIters || '?'} iters — treat this grade as approximate.`}>unconverged</GridBadge>,
    rangeSensitive && <GridBadge key="rs" edge={AMBER} ink={AMBER} dashed
      title={`This decision's grade depends on the ASSUMED opponent range: across a spread of plausible ranges the oracle's best action flips or the EV-loss swings by more than a small bet${rsSpread ? ` (EV-loss ranged ${rsSpread[0].toFixed(1)}–${rsSpread[1].toFixed(1)} chips)` : ''}. It is shown for study but ${notCharged ? 'NOT counted' : 'still counted'} in your session score.`}>
      range-sensitive · {notCharged ? 'shown, not charged' : 'shown'}</GridBadge>,
  ].filter(Boolean);

  return (
    <div className="hs-panel hs-stack" style={{ '--hs-edge': isLeak ? 'var(--neg, #ef4444)' : 'var(--border)' }}>
      <div className="hs-split">
        <span className="hs-t hs-sm hs-bold hs-clip" style={T(3)}>
          {head}
          <span style={{ fontWeight: 'var(--fw-regular)', color: 'var(--text-muted)' }}>{' '}· you {g.heroActionLabel || g.heroActionId}</span>
        </span>
        <span className="hs-t hs-sm hs-bold hs-num" style={{ ...T(3), whiteSpace: 'nowrap', color: isLeak ? 'var(--neg, #ef4444)' : evLoss > 0.01 ? 'var(--accent)' : 'var(--pos, #22c55e)' }}>
          {evLoss <= 0.01 ? 'optimal' : `−${evLoss.toFixed(2)} chips`}
          {se != null && evLoss > 0.01 ? <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--fw-regular)' }}> ±{se.toFixed(2)}</span> : null}
        </span>
      </div>
      {badges.length > 0 && <div className="hs-gbadges">{badges}</div>}

      {/* GTO mix bars + per-action EV */}
      {acts.map((id, i) => {
        const lbl = labels[i] || id;
        const isHero = id === g.heroActionId;
        const isBest = id === g.bestActionId;
        const ev = g.perActionEV ? g.perActionEV[id] : undefined;
        const marker = isHero && isBest ? '✓←' : isBest ? '✓' : isHero ? '←' : '';
        return (
          <div key={id}>
            <ActionBar
              name={lbl}
              pct={Math.round((probs[i] || 0) * 100)}
              best={(probs[i] || 0) >= maxProb - 0.001}
              marker={marker}
            />
            {ev !== undefined && (
              <div className="hs-t hs-xs hs-mut hs-num" style={{ ...T(2, 2), paddingLeft: 'calc(var(--gu) * 7)' }}>
                EV {ev >= 0 ? '+' : ''}{Number(ev).toFixed(2)} chips{isBest ? ' · best' : ''}{isHero ? ' · your pick' : ''}
              </div>
            )}
          </div>
        );
      })}

      {/* FULL DISCARD CONTROL — the hero's actual explicit discard: which cards
          they threw, the EV of that exact discard vs the solver-recommended
          play, and the note (recommended keep vs non-standard / off-book). */}
      {isExplicit && (
        <div className="hs-rule hs-stack">
          <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>
            <span style={{ fontSize: 'var(--fs-2xs)', lineHeight: 0, textTransform: 'uppercase', letterSpacing: 'var(--track-caps)', marginRight: 'var(--gu)' }}>Your discard</span>
            {thrownCards.length === 0
              ? <b style={{ color: 'var(--text)' }}>stand pat (threw nothing)</b>
              : <b style={{ color: 'var(--text)' }}>threw {thrownCards.length}</b>}
            {heroDiscardEV !== undefined && (
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {' '}· EV {heroDiscardEV >= 0 ? '+' : ''}{Number(heroDiscardEV).toFixed(2)}
                {evLoss > 0.01
                  ? <span style={{ color: isLeak ? 'var(--neg, #ef4444)' : 'var(--accent)' }}> ({'−'}{evLoss.toFixed(2)} vs solver)</span>
                  : <span style={{ color: 'var(--pos, #22c55e)' }}> (matches solver)</span>}
              </span>
            )}
          </div>
          {thrownCards.length > 0 && (
            <div className="hs-cards">{thrownCards.map((c, i) => <Card key={'td' + i} str={c} dim size="sm" />)}</div>
          )}
          {g.discardNote && (
            <div className="hs-t hs-xs" style={{ ...T(2, 2), fontStyle: 'italic', color: lowConf ? AMBER : 'var(--text-muted)' }}>
              {g.discardNote}
            </div>
          )}
        </div>
      )}

      {/* ── Pro-mode oracle provenance footer ── only on oracle-graded decisions.
          States the oracle EV-loss explicitly (the headline number above IS the
          oracle's — exact showdown, SE 0), the EV-convergence trust flag, and the
          blueprint's EV-loss for comparison when it was actually computed (it is
          skipped on the fast path, so it's usually present only on fallback/debug). */}
      {isOracleGrade && (
        <div className="hs-rule">
          <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>
            <span style={{ fontSize: 'var(--fs-2xs)', lineHeight: 0, textTransform: 'uppercase', letterSpacing: 'var(--track-caps)', marginRight: 'var(--gu)' }}>Oracle</span>
            exact GTO re-solve · EV-loss{' '}
            <b style={{ color: lossColor(evLoss), fontVariantNumeric: 'tabular-nums' }}>
              {evLoss <= 0.01 ? '0.00' : `−${evLoss.toFixed(2)}`}
            </b> chips (exact showdown)
            {g.blueprintEvLoss != null && (
              <span> · blueprint would grade <span style={{ fontVariantNumeric: 'tabular-nums' }}>−{Math.max(0, +g.blueprintEvLoss).toFixed(2)}</span></span>
            )}
            {oracleUnconverged
              ? <span style={{ color: WARN }}> · EV not fully converged — approximate</span>
              : g.oracleGradeTrust === 'ev-converged'
              ? <span style={{ color: 'var(--pos, #22c55e)' }}> · EV-converged</span>
              : null}
          </div>
          {rangeSensitive && (
            <div className="hs-t hs-xs" style={{ ...T(2, 2), color: AMBER }}>
              range-sensitive{rsSpread ? ` · EV-loss spans ${rsSpread[0].toFixed(2)}–${rsSpread[1].toFixed(2)} chips across plausible opponent ranges` : ''}
              {notCharged ? ' · not charged to your score' : ' · counted in your score'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── session scoreboard (per-game) ─────────────────────────────────────────
// Grid: panel 2r × 2g (surface2), 2r above. 3r header (label | 9g reset on
// 25..34), 1r, three 9g stat boxes (3..12, 14..23, 25..34), 2r, by-street
// meters (2r each), 2r, leaks (2r lines).
function SessionScoreboard({ session, onReset, gameName, game }) {
  const avg = session.decisions > 0 ? session.totalEvLoss / session.hands : 0;
  const topLeaks = useMemo(() => {
    return Object.entries(session.leaks || {})
      .map(([k, v]) => ({ key: k, n: v.n, chips: v.chips }))
      .sort((a, b) => b.chips - a.chips)
      .slice(0, 5);
  }, [session.leaks]);
  // draw games index 4 rounds (0..3); stud games index 5 streets (3rd..7th).
  const nRows = catOf(game) === 'draw' ? 4 : 5;
  const rowLabel = (i) => (catOf(game) === 'draw' ? DRAW_BET_NAMES[i] : STREET_NAMES[i]);
  const max = Math.max(0.001, ...session.byStreet.slice(0, nRows).map((x) => (x.n > 0 ? x.loss / x.n : 0)));

  return (
    <div className="hs-panel" style={{ marginTop: R(2), '--hs-bg': 'var(--surface2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) calc(var(--gu) * 9)', columnGap: 'var(--gu)', alignItems: 'start' }}>
        {/* wrapper: a trimmed overflow:hidden GRID item loses its content height in WebKit */}
        <div style={{ minWidth: 0 }}><span className="hs-t hs-cap hs-bold hs-clip" style={{ ...T(2), letterSpacing: '0.14em' }}>{gameName ? `${gameName} scoreboard` : 'Session scoreboard'}</span></div>
        <button className="hs-btn" onClick={onReset}
          style={{ '--hs-h': 3, padding: 0, fontSize: 'var(--fs-2xs)', fontWeight: 'var(--fw-regular)', textTransform: 'uppercase', letterSpacing: 'var(--track-caps)', '--hs-ink': 'var(--text-muted)', borderRadius: 'calc(var(--subrow) * 0.75)' }}>
          <span className="hs-t" style={T(2)}>Reset session</span>
        </button>
      </div>

      <div className="hs-cols3" style={{ marginTop: 'var(--subrow)' }}>
        <Stat label="Hands" value={session.hands} />
        <Stat label="Total EV-loss" value={`${session.totalEvLoss.toFixed(1)}`} unit="chips" />
        <Stat label="Avg / hand" value={session.hands ? avg.toFixed(2) : '—'} unit={session.hands ? 'chips' : ''}
          tone={avg > 0.5 ? 'neg' : avg > 0 ? 'mut' : 'pos'} />
      </div>

      {/* by street / draw-round — label 4g (stud, 3..7) or 7g (draw, 3..10) | track to 27 | 6g value on 28..34 */}
      <div className="hs-t hs-cap" style={{ ...T(2), marginTop: R(2) }}>Avg EV-loss by {catOf(game) === 'draw' ? 'round' : 'street'}</div>
      <div style={{ marginTop: 'var(--subrow)' }}>
        {session.byStreet.slice(0, nRows).map((b, i) => {
          const a = b.n > 0 ? b.loss / b.n : 0;
          return (
            <div key={i} className="hs-meter" style={{ '--hs-lab': `calc(var(--gu) * ${catOf(game) === 'draw' ? 7 : 4})`, '--hs-val': 'calc(var(--gu) * 6)' }}>
              <div style={{ minWidth: 0 }}><span className="hs-t hs-xs hs-mut hs-clip" style={T(2)}>{rowLabel(i)}</span></div>
              <div className="hs-meter-track" style={{ '--hs-track': 'var(--surface)' }}>
                <div className="hs-meter-fill" style={{ width: `${Math.round((a / max) * 100)}%`, background: a > 0.5 ? 'var(--neg, #ef4444)' : 'var(--accent2)' }} />
              </div>
              <span className="hs-t hs-xs hs-num" style={T(2)}>
                {b.n > 0 ? `${a.toFixed(2)}` : '—'}
                <span style={{ color: 'var(--text-muted)' }}> ({b.n})</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* recurring leaks */}
      <div className="hs-t hs-cap" style={{ ...T(2), marginTop: R(2) }}>Biggest recurring leaks</div>
      <div style={{ marginTop: 'var(--subrow)' }}>
        {topLeaks.length === 0 ? (
          <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>
            {session.hands ? 'No leaks yet — clean session.' : 'Play a hand to start tracking leaks.'}
          </div>
        ) : topLeaks.map((l) => (
          <div key={l.key} className="hs-split">
            <span className="hs-t hs-xs hs-clip" style={T(2)}>{l.key}</span>
            <span className="hs-t hs-xs hs-num" style={{ ...T(2), whiteSpace: 'nowrap', color: 'var(--neg, #ef4444)' }}>
              −{l.chips.toFixed(1)} <span style={{ color: 'var(--text-muted)' }}>×{l.n}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Stat box: 9g, 1r × 2g padding (text on the next subcolumn line), 2r caps
// label + 3r value = 7r with the padding.
function Stat({ label: lab, value, unit, tone }) {
  const color = tone === 'neg' ? 'var(--neg, #ef4444)' : tone === 'pos' ? 'var(--pos, #22c55e)' : 'var(--text)';
  return (
    <div className="hs-box" style={{ '--hs-bg': 'var(--surface)', padding: 'var(--subrow) calc(var(--gu) * 2)' }}>
      {/* wraps (2r lines) rather than clipping: the 5g text column fits "HANDS" but not "TOTAL EV-LOSS";
          the three boxes stretch to the tallest, which is whole r */}
      <div className="hs-t hs-cap" style={T(2, 2)}>{lab}</div>
      <div className="hs-t hs-md hs-bold hs-num hs-clip" style={{ ...T(3), color }}>
        {value}{unit ? <span style={{ fontSize: 'var(--fs-2xs)', lineHeight: 0, fontWeight: 'var(--fw-regular)', color: 'var(--text-muted)' }}> {unit}</span> : null}
      </div>
    </div>
  );
}

// Color a total EV-loss like the scoreboard does: clean = green, small = accent,
// leak-sized (>0.5 chips) = red.
function lossColor(total) {
  if (total > 0.5) return 'var(--neg, #ef4444)';
  if (total > 0.01) return 'var(--accent)';
  return 'var(--pos, #22c55e)';
}

// Tiny per-round EV-loss bar strip — one cell per round, shaded by that round's
// loss (red if it's a leak, accent if small, faint if clean). Gives an at-a-
// glance "where did this hand bleed" indicator without expanding the row.
// Grid: 6g wide, one 1r cell per round sitting on the row's baseline line.
function PerRoundStrip({ perRound, game }) {
  const n = catOf(game) === 'draw' ? 4 : 5;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const v = (perRound && perRound[i]) || 0;
    const bg = v > 0.5 ? 'var(--neg, #ef4444)' : v > 0.01 ? 'var(--accent2)' : 'var(--surface2)';
    const op = v > 0.01 ? 1 : 0.5;
    cells.push(
      <div key={i} title={`${catOf(game) === 'draw' ? DRAW_BET_NAMES[i] : STREET_NAMES[i]}: −${v.toFixed(2)}`}
        style={{ flex: 1, height: 'var(--subrow)', background: bg, opacity: op, borderRadius: 'calc(var(--subrow) * 0.25)' }} />
    );
  }
  return <div style={{ display: 'flex', gap: 'calc(var(--subrow) * 0.375)', width: 'calc(var(--gu) * 6)', flex: '0 0 auto', marginTop: R(2) }}>{cells}</div>;
}

// Durable per-hand history for the current game (DB-backed). Collapsed by
// default; opening it fetches the user's recent graded hands for this game.
// Clicking a row fetches + expands that hand's recorded grades (reusing the
// same GradeCard markup as the live grading report). The localStorage
// scoreboard stays the session aggregate; this is the durable record.
// Grid: panel 2r × 2g (surface2), 2r above; 2r header line; rows are 5r boxes
// (1r × 2g padding around a 3r line), 1r apart.
function TrainerHistory({ game, gameName, rev }) {
  const [open, setOpen] = useState(false);
  const [hands, setHands] = useState(null); // null = not loaded; [] = loaded empty
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null); // { id, hand } for expandedId
  const [detailLoading, setDetailLoading] = useState(false);

  // (re)load the list when opened, on game switch, or when a new hand saves.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(false);
    fetchApi(`/solver/trainer/${game}/history?limit=50`, { method: 'GET' })
      .then((res) => res.json())
      .then((data) => { if (alive) setHands(Array.isArray(data) ? data : []); })
      .catch(() => { if (alive) { setError(true); setHands([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, game, rev]);

  // collapse + clear any open detail when the game changes.
  useEffect(() => { setExpandedId(null); setDetail(null); }, [game]);

  const toggleRow = useCallback((id) => {
    if (expandedId === id) { setExpandedId(null); setDetail(null); return; }
    setExpandedId(id);
    setDetail(null);
    setDetailLoading(true);
    fetchApi(`/solver/trainer/${game}/hand/${id}`, { method: 'GET' })
      .then((res) => res.json())
      .then((data) => setDetail(data && data.hand ? { id, hand: data.hand } : { id, hand: null }))
      .catch(() => setDetail({ id, hand: null }))
      .finally(() => setDetailLoading(false));
  }, [expandedId, game]);

  const note = (txt) => <div className="hs-t hs-xs hs-mut" style={T(2, 2)}>{txt}</div>;

  return (
    <div className="hs-panel" style={{ marginTop: R(2), '--hs-bg': 'var(--surface2)' }}>
      <button className="hs-btn hs-left" onClick={() => setOpen((o) => !o)}
        style={{ '--hs-h': 2, '--hs-edge': 'transparent', padding: 0, width: '100%', fontWeight: 'var(--fw-regular)' }}>
        <span className="hs-split">
          <span className="hs-t hs-cap hs-bold" style={{ ...T(2), letterSpacing: '0.14em' }}>
            {gameName ? `${gameName} history` : 'Hand history'}
          </span>
          <span className="hs-t hs-xs hs-mut" style={T(2)}>{open ? 'Hide ▲' : 'Show ▼'}</span>
        </span>
      </button>

      {open && (
        <div className="hs-stack" style={{ marginTop: 'var(--subrow)' }}>
          {loading && hands == null ? note('Loading history…')
            : error ? note('Couldn’t load history (offline?). Played hands are saved when you’re back online.')
            : hands && hands.length === 0 ? note('No saved hands yet — play one to start your history.')
            : (hands || []).map((h) => {
              const isOpen = expandedId === h.id;
              return (
                <div key={h.id} className="hs-box" style={{ '--hs-bg': 'var(--surface)', padding: 0, overflow: 'hidden' }}>
                  {/* Row: 5r — 1r pad, then time | per-round strip | loss | caret, baselines 4r down. */}
                  <button onClick={() => toggleRow(h.id)} className="hs-btn"
                    style={{ '--hs-h': 5, '--hs-edge': 'transparent', width: '100%', flexDirection: 'row', alignItems: 'flex-start', columnGap: 'var(--gu)', padding: 'var(--subrow) calc(var(--gu) * 2) 0', fontWeight: 'var(--fw-regular)' }}>
                    <span className="hs-t hs-xs hs-mut hs-num" style={{ ...T(3), flex: '0 0 auto' }}>{fmtPlayedAt(h.played_at)}</span>
                    <PerRoundStrip perRound={h.per_round} game={game} />
                    <span style={{ flex: 1 }} />
                    <span className="hs-t hs-sm hs-bold hs-num" style={{ ...T(3), color: lossColor(+h.ev_loss_total || 0), flex: '0 0 auto' }}>
                      {(+h.ev_loss_total || 0) <= 0.01 ? 'optimal' : `−${(+h.ev_loss_total || 0).toFixed(2)}`}
                    </span>
                    <span className="hs-t hs-xs hs-mut" style={{ ...T(3), flex: '0 0 auto' }}>{isOpen ? '▲' : '▼'}</span>
                  </button>

                  {isOpen && (
                    <div className="hs-rule hs-stack" style={{ padding: 'var(--subrow) calc(var(--gu) * 2) calc(var(--subrow) * 2)' }}>
                      {/* 1r top (under the rule) / 2r bottom, 2g sides: the nested grade cards sit on 5..32 */}
                      {detailLoading || !detail || detail.id !== h.id ? note('Loading hand…')
                        : !detail.hand || !Array.isArray(detail.hand.grades) || detail.hand.grades.length === 0 ? note('No recorded decisions for this hand.')
                        : detail.hand.grades.map((g, i) => <GradeCard key={i} g={g} game={game} />)}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// Format a saved-hand timestamp (epoch ms) for a history row.
function fmtPlayedAt(ms) {
  const d = new Date(+ms || 0);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}
