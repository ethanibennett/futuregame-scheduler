// ── DRAW STUDY ──────────────────────────────────────────────────────────────
// The browser face of solver/draw-trainer/study (whose CLI is study/cli.js),
// talking to POST /api/solver/draw-study.
//
// WHAT IT IS FOR, and why it is not the trainer tab. The drill grades you
// against what the BLUEPRINT offers: `cfg.drawOptions` gives at most 2 of 6 draw
// counts with one card-set each from `chooseKeep` — 2 of the 32 legal discard
// subsets in 2-7 and A-5, 2 of 16 in badugi — and a made hand gets a forced pat.
// `grade.js` then clamps anything better than its best offer away. This prices
// EVERY subset, so you can see the best play was not on the menu. The `offered`
// column is which ones the drill could have named.
//
// PLAY-THROUGH IS THE CLICK LOOP. Clicking an action appends it to the history
// and re-posts, so stepping a hand to showdown falls out of the same two calls.
// That is deliberately better than the CLI's --auto, which picks for you out of
// a band it has just called unrankable.
//
// 🛑 TWO THINGS THIS VIEW MUST NOT MISREPRESENT, because the tool's whole history
// is confident wrong answers:
//  1. The TIED BAND IS NOT A RANKING. Rows inside it are not separable at the
//     evidence bought and their order is noise, so they render as equals with no
//     winner styling. The server sends `tied` and `bandWidth`; this does not
//     recompute them.
//  2. Only street-3 BETTING is exact. Everything else is Monte-Carlo and
//     UNCERTIFIED, and `trust.level` comes from the engine's own flag. Never
//     infer it here from a street number.
import { useEffect, useState } from 'react';
import { fetchApi } from '../utils/api';
import { StudyHead, StudyPills, shortGameName, useSolverAvailability, offered } from './StudyHead.jsx';

const T = (b, lh) => (lh ? { '--hs-b': b, '--hs-lh': lh } : { '--hs-b': b });

const GAMES = [
  { id: 'td27', label: '2-7 Triple Draw', cards: 5 },
  { id: 'a5td', label: 'A-5 Triple Draw', cards: 5 },
  { id: 'badugi', label: 'Badugi', cards: 4 },
];
/** Where in the hand: the phase matters, since a street's draw comes after its betting. */
function spotName(street, phase) {
  const draw = ['First draw', 'Second draw', 'Third draw'][street];
  const bet = ['Before the first draw', 'After the first draw', 'After the second draw', 'After the third draw'][street];
  return (phase === 'draw' ? draw : bet) || `Street ${street}`;
}
/** An engine token in words: d:2s4d throws those two cards, d1 draws one, d0 and d: stand pat. */
function actionName(a) {
  const s = String(a);
  if (s === 'd0' || s === 'd:') return 'Stand pat';
  if (s.startsWith('d:')) return 'Throw ' + (s.slice(2).match(/.{2}/g) || []).join(' ');
  const m = /^d(\d)$/.exec(s);
  if (m) return `Draw ${m[1]}`;
  return { c: 'Call', k: 'Check', b: 'Bet', r: 'Raise', f: 'Fold' }[s] || s;
}

export default function DrawStudyView({ pendingSpot, onConsumeSpot, onBack }) {
  const avail = useSolverAvailability();
  const [game, setGame] = useState('td27');
  const [hero, setHero] = useState('7h 5c 4d 2s Kh');
  const [opp, setOpp] = useState('');
  const [seat, setSeat] = useState(0);
  const [hist, setHist] = useState('c k');
  // The hero's real replacement cards, from the replayer; null for a hand typed in, whose draws the tool deals.
  const [drawn, setDrawn] = useState(null);
  const [shuffles, setShuffles] = useState(8);
  const [particles, setParticles] = useState(200);
  const [rangeSeeds, setRangeSeeds] = useState(1);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [data, setData] = useState(null);
  const [handoff, setHandoff] = useState(null);
  const [exactBusy, setExactBusy] = useState(false);
  const [exactErr, setExactErr] = useState(null);
  const [exact, setExact] = useState(null);

  // ── A SPOT HANDED OVER BY THE REPLAYER ─────────────────────────────────
  // Reading a 32-row table is the hard part of this tool, so the replayer's
  // "Study this draw" button sends the hand you are LOOKING at (utils/draw-study-spot.js):
  // the STARTING hand, both seats' actions in engine order, and the cards the hero
  // really drew, so the priced hand is the one in the replay. The notes travel with
  // it, because what was assumed in the conversion matters as much as the numbers.
  useEffect(() => {
    if (!pendingSpot) return;
    if (pendingSpot.game) setGame(pendingSpot.game);
    if (pendingSpot.hero) setHero(pendingSpot.hero);
    if (pendingSpot.seat !== undefined) setSeat(Number(pendingSpot.seat));
    setHist(pendingSpot.hist || '');
    setDrawn(pendingSpot.drawn === undefined ? null : pendingSpot.drawn);
    setOpp('');            // the opponent's cards stay out: the hero did not know them
    setData(null);
    setErr(null);
    setHandoff(pendingSpot);
    if (onConsumeSpot) onConsumeSpot();
  }, [pendingSpot, onConsumeSpot]);

  async function run(mode, histOverride) {
    setBusy(mode); setErr(null);
    const body = {
      game, hero, seat, mode,
      hist: histOverride === undefined ? hist : histOverride,
      shuffles, particles, rangeSeeds,
    };
    if (opp.trim()) body.opp = opp;
    if (drawn !== null) body.drawn = drawn;
    // While the history is still the one handed over, it must land on that draw.
    if (handoff && handoff.street !== undefined && body.hist === handoff.hist) body.spotStreet = handoff.street;
    try {
      const res = await fetchApi('/solver/draw-study', { method: 'POST', body });
      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setExact(null); setExactErr(null);
      if (!res.ok) {
        // ⚠ SHOW THE `detail`. The route sends one and this dropped it, so a
        // 503 for a game whose blueprint is simply not installed read as a bare
        // failure -- indistinguishable from the solver being unable to do that
        // game at all, which is not true of a5td.
        setErr((json.error || `HTTP ${res.status}`) + (json.detail ? ' — ' + json.detail : ''));
        setData(null);
      }
      else { setData(json); if (histOverride !== undefined) setHist(histOverride); }
    } catch (e) {
      setErr(e.message || 'request failed');
    } finally { setBusy(null); }
  }

  // ── CERTIFY THE BAND ────────────────────────────────────────────────────
  // The Monte-Carlo table prices every option but cannot certify the LEVEL of
  // any of them. This sends the band it CANNOT separate to the exact grade: one
  // full solve per option over that option's post-draw hero range, with the
  // final betting round solved exactly. Breadth from MC, certainty from the
  // exact solve -- which is why both exist.
  //
  // ⚠ Only the BAND is sent, not all 32 options. Each is a full CFR solve
  // (~0.2 s pat, ~1 s for a 1-card draw, ~5 s for a 2-card draw), so grading
  // everything would be minutes; the band is precisely the set where the cheap
  // meter has run out of discrimination, which is the set worth the cost.
  async function certify() {
    if (!data || !data.table) return;
    const t = data.table;
    // the route accepts d:<cards> and d0 only: a COUNT does not say which cards
    // go, and naming them is the whole distinction this tool adds over the drill
    const opts = t.rows.filter((r) => r.tied && /^d:/.test(r.action))
      .slice(0, 8).map((r) => r.action);
    if (!opts.length) {
      setExactErr('No explicit-discard options in the band to certify.');
      return;
    }
    setExactBusy(true); setExactErr(null); setExact(null);
    const body = { game, hero, seat, hist, options: opts, particles };
    if (opp.trim()) body.opp = opp;
    if (drawn !== null) body.drawn = drawn;
    try {
      const res = await fetchApi('/solver/draw-study/exact', { method: 'POST', body });
      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok) setExactErr((json.error || `HTTP ${res.status}`)
        + (json.detail ? ' — ' + json.detail : ''));
      else setExact(json);
    } catch (e) {
      setExactErr(e.message || 'request failed');
    } finally { setExactBusy(false); }
  }

  // Clicking an action is the play-through: append it and ask again.
  // From the line the server just read, guessed actions included, and not from the box: the box can
  // stop short of the opponent's next action, and a token added there would land on the opponent.
  function take(action) {
    const sofar = data && data.line !== undefined ? data.line : hist.trim();
    run('now', (sofar ? sofar + ' ' : '') + seat + ':' + action);
  }

  const t = data && data.table;
  const uncertified = data && data.trust && data.trust.level !== 'exact-forward';

  return (
    <div className="hs-view study-tool">
      <StudyHead title="Price a draw" onBack={onBack}
        note="Every bet and every discard at one decision, including the ones the trained strategy cannot offer you. Tap an action to take it and move on." />

      <StudyPills games={GAMES.filter((g) => offered(avail, g.id)).map((g) => [g.id, shortGameName(g.label)])} value={game}
        onPick={(id) => { setGame(id); setData(null); }} />

      {/* ── inputs ───────────────────────────────────────────────────── */}
      <div className="hs-cols" style={{ '--hs-n': 2, marginTop: 'calc(var(--subrow) * 2)' }}>
        <label className="ds-field">Your seat
          <select value={seat} onChange={(e) => setSeat(Number(e.target.value))}>
            <option value={0}>Acts first before the draw</option>
            <option value={1}>Big blind, draws first</option>
          </select>
        </label>
        <label className="ds-field">{drawn === null ? 'Your hand' : 'Your starting hand'}
          <input value={hero} onChange={(e) => setHero(e.target.value)} placeholder="7h 5c 4d 2s Kh" />
        </label>
        {drawn !== null && (
          <label className="ds-field">Cards you drew, in order
            <input value={drawn} onChange={(e) => setDrawn(e.target.value)} placeholder="none yet" />
          </label>
        )}
        <label className="ds-field">Opponent's hand (optional)
          <input value={opp} onChange={(e) => setOpp(e.target.value)} placeholder="sampled if blank" />
        </label>
        <label className="ds-field">The action so far
          <input className="ds-mono" value={hist} onChange={(e) => setHist(e.target.value)} placeholder="c k d2" />
        </label>
      </div>
      <p className="hs-t hs-xs hs-mut" style={{ ...T(2, 2), marginTop: 'var(--subrow)' }}>
        Both seats, in order: c call, k check, b bet, r raise, f fold, d2 draw two.
      </p>

      <details className="study-more" style={{ marginTop: 'var(--subrow)' }}>
        <summary className="hs-t hs-xs" style={T(2)}>Accuracy</summary>
        <div className="hs-cols" style={{ '--hs-n': 3, marginTop: 'var(--subrow)' }}>
          <label className="ds-field">Deals
            <input type="number" min={1} max={16} value={shuffles} onChange={(e) => setShuffles(Number(e.target.value))} />
          </label>
          <label className="ds-field">Samples
            <input type="number" min={1} max={400} value={particles} onChange={(e) => setParticles(Number(e.target.value))} />
          </label>
          <label className="ds-field">Ranges
            <input type="number" min={1} max={4} value={rangeSeeds} onChange={(e) => setRangeSeeds(Number(e.target.value))} />
          </label>
        </div>
      </details>

      <div className="hs-cols" style={{ '--hs-n': 2, marginTop: 'calc(var(--subrow) * 2)' }}>
        <button type="button" className="hs-btn" onClick={() => run('steps')} disabled={!!busy}>
          <span className="hs-t" style={T(3)}>{busy === 'steps' ? 'Reading…' : 'Whose turn?'}</span>
        </button>
        <button type="button" className="hs-btn" onClick={() => run('now')} disabled={!!busy}
          style={{ '--hs-edge': 'transparent', '--hs-fill': 'var(--brand)', '--hs-ink': 'var(--on-brand)' }}>
          <span className="hs-t" style={T(3)}>{busy === 'now' ? 'Pricing…' : 'Price this spot'}</span>
        </button>
      </div>

      {handoff && (
        <div className="hs-panel ds-panel">
          <div className="ds-panel-title">From the replayer: {handoff.source || 'a replayed hand'}</div>
          <div>
            {handoff.now && <>Your hand at this draw: <b>{handoff.now}</b>. </>}
            Hand and history are filled in above. Check them, then price the spot.
          </div>
          {(handoff.notes || []).length > 0 && (
            <ul className="ds-list">
              {handoff.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </div>
      )}

      {err && <div className="ds-note is-bad">{err}</div>}

      {data && (
        <>
          {/* ── the line, with provenance ─────────────────────────────── */}
          <div className="hs-panel ds-panel">
            <div className="ds-panel-title">The hand so far</div>
            <div className="ds-scroll">
              <table className="ds-table">
                <tbody>
                  {data.steps.map((s) => (
                    <tr key={s.i}>
                      <td>{s.you ? <b>You</b> : 'Opponent'}</td>
                      <td>{actionName(s.action)}</td>
                      <td className="is-dim">
                        {s.guessed
                          ? <span style={{ color: 'var(--warn, #f59e0b)' }}>guessed from the trained strategy; replace it if you know</span>
                          : 'you entered'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.terminal
              ? <div style={{ marginTop: 'var(--subrow)', fontWeight: 'var(--fw-bold)' }}>
                  {data.folded !== null
                    ? (data.folded === seat ? 'You folded.' : 'Your opponent folded.')
                    : 'Showdown.'}{' '}
                  {data.heroBB !== null && <>You {data.heroBB >= 0 ? 'win' : 'lose'} {Math.abs(data.heroBB).toFixed(2)} BB.</>}
                </div>
              : data.next && <div style={{ marginTop: 'var(--subrow)' }}>
                  <b>Next:</b> {data.next.you ? 'you' : 'your opponent'}, {spotName(data.next.street, data.next.phase).toLowerCase()}
                  {data.next.legal.length > 0 && <>: {data.next.legal.map(actionName).join(', ')}</>}
                </div>}
          </div>

          {data.warnings.length > 0 && (
            <div className="ds-note is-warn">
              {data.warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}

          {/* ── the priced table ──────────────────────────────────────── */}
          {t && (
            <div className="hs-panel ds-panel">
              <div className="ds-panel-title">
                {spotName(t.street, t.phase)}: {t.nRows} option{t.nRows === 1 ? '' : 's'} priced
                {t.offeredActions && <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--fw-regular)' }}>
                  {', '}the trained strategy offers {t.offeredActions.length}
                </span>}
              </div>

              {t.bandWidth > 1 && (
                <div className="ds-note is-warn" style={{ marginTop: 0, marginBottom: 'var(--subrow)' }}
                  title={t.bandRule ? `z=${Number(t.bandRule.z).toFixed(2)}, family-wise 5% over K=${t.bandRule.K}` : undefined}>
                  <b>{t.bandWidth} of {t.nRows} are too close to separate</b> at this much evidence.
                  They are shown level, with no winner, because their order here is
                  noise. Raise the deals under Accuracy to narrow it.
                </div>
              )}

              <div className="ds-scroll">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th className="is-num">EV (chips)</th>
                      <th className="is-num">EV (BB)</th>
                      <th className="is-num ds-sd">SD</th>
                      <th>Offered</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r) => (
                      <tr key={r.action} className={r.tied ? 'is-level' : undefined}>
                        <td>{actionName(r.action)}</td>
                        <td className="is-num">{r.ev.toFixed(3)}</td>
                        <td className="is-num">{r.evBB.toFixed(3)}</td>
                        <td className="is-num is-dim ds-sd">{r.sd.toFixed(2)}{r.seIsLowerBound ? '+' : ''}</td>
                        <td className={r.offered ? undefined : 'is-dim'}>{r.offered ? 'Yes' : 'No'}</td>
                        <td>
                          {/* A made hand's table prices breaking it, but the engine can only play on from the pat. */}
                          {(!data.next || !data.next.forced || r.action === 'd0' || r.action === 'd:') && (
                            <button type="button" className="hs-btn ds-take" onClick={() => take(r.action)} disabled={!!busy}>
                              <span className="hs-t" style={T(2)}>Take</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {t.nRows > t.rows.length && (
                <div className="is-dim" style={{ marginTop: 'var(--subrow)', color: 'var(--text-muted)' }}>
                  Showing {t.rows.length} of {t.nRows}
                </div>
              )}
            </div>
          )}

          {/* ── certify the band exactly, where that is possible ─────── */}
          {t && (() => {
            // The route's own constraints, mirrored here so the button explains
            // itself instead of failing: street 2 is the LAST draw (after it the
            // final betting round is what the exact resolver solves), and seat 1
            // draws FIRST, so only at seat 0 has the opponent already drawn --
            // which is what makes the posterior a POST-draw range.
            const isLastDraw = t.street === 2 && t.phase === 'draw';
            const bandOpts = t.rows.filter((r) => r.tied && /^d:/.test(r.action));
            const why = !isLastDraw
              ? `Exact grading covers the last draw only. This is ${spotName(t.street, t.phase).toLowerCase()}, and earlier spots have more draws ahead of them.`
              : seat !== 0
              ? 'Exact grading needs you to draw last: only then has your opponent already drawn, which is what makes their range a post-draw one.'
              : !bandOpts.length ? 'None of the level options names its discards.' : null;
            return (
              <div className="hs-panel ds-panel">
                <div className="ds-panel-title">Separate them exactly</div>
                <div>
                  The table above cannot separate {t.bandWidth} of {t.nRows} options. An exact
                  solve can, at one full solve per option, up to about 5 seconds each.
                </div>
                {why
                  ? <div className="ds-note is-warn">{why}</div>
                  : <button type="button" className="hs-btn" onClick={certify} disabled={exactBusy || !!busy} style={{ marginTop: 'var(--subrow)' }}>
                      <span className="hs-t" style={T(3)}>{exactBusy
                        ? `Solving ${Math.min(8, bandOpts.length)} option(s)…`
                        : `Grade ${Math.min(8, bandOpts.length)} level option(s) exactly`}</span>
                    </button>}
                {exactErr && <div className="ds-note is-bad">{exactErr}</div>}
                {exact && exact.options && (
                  <div style={{ marginTop: 'var(--subrow)' }}>
                    <div className="ds-scroll">
                      <table className="ds-table">
                        <thead>
                          <tr>
                            <th>Option</th>
                            <th className="is-num">Exact EV (chips)</th>
                            <th className="is-num">Outcomes</th>
                            <th className="is-num">Sampled</th>
                            <th className="is-num">Secs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {exact.options.map((o, i) => (
                            <tr key={i} className={i === 0 ? 'is-level' : undefined}>
                              <td className="ds-mono">{o.label || ('keep ' + (o.keep || []).join(','))}</td>
                              <td className="is-num" style={{ fontWeight: i === 0 ? 'var(--fw-bold)' : undefined }}>{o.ev.toFixed(4)}</td>
                              <td className="is-num is-dim">{o.outcomes.toLocaleString()}</td>
                              <td className="is-num is-dim">{o.sampled}{o.enumerated ? ' (all)' : ''}</td>
                              <td className="is-num is-dim">{o.secs.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* What "exact" does and does NOT mean. Shown with the number,
                        not in a footnote: the whole risk of an exact label is that
                        it gets read as more than it is. */}
                    <div className="ds-note is-good">
                      <b>Exact means:</b> the final betting round, solved exactly given both
                      post-draw ranges. <b>It does not mean</b> an equilibrium value for the whole
                      hand: your opponent's range is an estimate from the action so far
                      {exact.oppRange ? ` (${exact.oppRange.kept} of ${exact.oppRange.distinct} possible holdings)` : ''}.
                      {exact.provenance && exact.provenance.bias_note
                        ? ' ' + exact.provenance.bias_note : ''}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── trust, stated rather than implied ─────────────────────── */}
          {data.trust && (
            <div className={'ds-note ' + (uncertified ? 'is-warn' : 'is-good')}>
              <div className="ds-panel-title">{uncertified ? 'These numbers are estimates, not certified' : 'Certified'}</div>
              <div>{data.trust.note}</div>
              <ul className="ds-list">
                <li>Opponent past your decision: {data.trust.villainContinuation}.</li>
                <li>Dead cards: {data.trust.deadCards}.</li>
                <li>
                  Error bar {data.trust.seCoversRangeAxis
                    ? 'covers both the deal and your opponent\'s range.'
                    : 'is a lower bound: with one opponent range, the variance between ranges cannot be estimated. Raise Ranges above 1.'}
                </li>
              </ul>
              {data.budget && (
                <div className="ds-mono" style={{ marginTop: 'var(--subrow)', color: 'var(--text-muted)' }}>
                  Used {data.budget.shuffles} deals · {data.budget.particles} samples ·{' '}
                  {data.budget.rangeSeeds} range{data.budget.rangeSeeds === 1 ? '' : 's'} · seed {data.budget.seed}
                  {' '}(most allowed: {data.budget.caps.shuffles} / {data.budget.caps.particles} / {data.budget.caps.rangeSeeds})
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
