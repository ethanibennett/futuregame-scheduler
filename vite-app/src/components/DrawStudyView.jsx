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

const GAMES = [
  { id: 'td27', label: '2-7 Triple Draw', cards: 5 },
  { id: 'a5td', label: 'A-5 Triple Draw', cards: 5 },
  { id: 'badugi', label: 'Badugi', cards: 4 },
];
const STREETS = ['Pre-draw', 'After 1st draw', 'After 2nd draw', 'After 3rd draw'];

export default function DrawStudyView({ pendingSpot, onConsumeSpot }) {
  const [game, setGame] = useState('td27');
  const [hero, setHero] = useState('7h 5c 4d 2s Kh');
  const [opp, setOpp] = useState('');
  const [seat, setSeat] = useState(0);
  const [hist, setHist] = useState('c k');
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
  // "Study this draw" button sends the hand you are LOOKING at: the hero's cards
  // as they stood at that street, and both seats' actions in engine order with
  // each discard as an explicit `d:<cards>` token. The notes travel with it,
  // because what was assumed in the conversion matters as much as the numbers --
  // a multiway hand loses its extra opponents, an all-in becomes a bet, and a
  // discard with no recorded suit falls back to a COUNT, which is the very thing
  // the drill already grades.
  useEffect(() => {
    if (!pendingSpot) return;
    if (pendingSpot.game) setGame(pendingSpot.game);
    if (pendingSpot.hero) setHero(pendingSpot.hero);
    if (pendingSpot.seat !== undefined) setSeat(Number(pendingSpot.seat));
    setHist(pendingSpot.hist || '');
    setOpp('');            // the replay rarely records the villain's holding
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
  function take(action) {
    const next = (hist.trim() ? hist.trim() + ' ' : '') + action;
    run('now', next);
  }

  const t = data && data.table;
  const uncertified = data && data.trust && data.trust.level !== 'exact-forward';

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '0 4px 48px' }}>
      <h2 style={{ margin: '0 0 2px' }}>Draw study</h2>
      <p style={{ margin: '0 0 16px', opacity: 0.7, fontSize: 13 }}>
        Every betting and drawing option at one decision — including the ones the
        blueprint cannot offer you. Click an action to take it and move on.
      </p>

      {/* ── inputs ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', marginBottom: 12 }}>
        <label style={lbl}>Game
          <select value={game} onChange={(e) => { setGame(e.target.value); setData(null); }} style={inp}>
            {GAMES.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
        <label style={lbl}>Your seat
          <select value={seat} onChange={(e) => setSeat(Number(e.target.value))} style={inp}>
            <option value={0}>0 — acts first pre-draw</option>
            <option value={1}>1 — BB, draws first</option>
          </select>
        </label>
        <label style={lbl}>Your hand
          <input value={hero} onChange={(e) => setHero(e.target.value)} style={inp}
            placeholder="7h 5c 4d 2s Kh" />
        </label>
        <label style={lbl}>Villain <span style={{ opacity: 0.55 }}>(optional)</span>
          <input value={opp} onChange={(e) => setOpp(e.target.value)} style={inp}
            placeholder="sampled if blank" />
        </label>
      </div>

      <label style={{ ...lbl, marginBottom: 10 }}>History — both seats, in order
        <input value={hist} onChange={(e) => setHist(e.target.value)} style={{ ...inp, fontFamily: 'ui-monospace, monospace' }}
          placeholder="c k d2" />
      </label>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <label style={lblSm}>Shuffles
          <input type="number" min={1} max={16} value={shuffles}
            onChange={(e) => setShuffles(Number(e.target.value))} style={inpSm} />
        </label>
        <label style={lblSm}>Particles
          <input type="number" min={1} max={400} value={particles}
            onChange={(e) => setParticles(Number(e.target.value))} style={inpSm} />
        </label>
        <label style={lblSm}>Ranges
          <input type="number" min={1} max={4} value={rangeSeeds}
            onChange={(e) => setRangeSeeds(Number(e.target.value))} style={inpSm} />
        </label>
        <button onClick={() => run('steps')} disabled={!!busy} style={btn}>
          {busy === 'steps' ? 'Reading…' : 'Whose turn?'}
        </button>
        <button onClick={() => run('now')} disabled={!!busy} style={{ ...btn, fontWeight: 600 }}>
          {busy === 'now' ? 'Pricing…' : 'Price this spot'}
        </button>
      </div>

      {handoff && (
        <div style={{ ...card, background: 'rgba(120,150,190,.09)', borderColor: 'rgba(120,150,190,.45)' }}>
          <div style={h3}>From the replayer — {handoff.source || 'a replayed hand'}</div>
          <div style={{ fontSize: 12.5, opacity: 0.8, marginBottom: 6 }}>
            Hand and history are pre-filled below. Check them, then price the spot.
          </div>
          {(handoff.notes || []).length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, opacity: 0.85 }}>
              {handoff.notes.map((n, i) => <li key={i} style={{ marginBottom: 3 }}>{n}</li>)}
            </ul>
          )}
        </div>
      )}

      {err && <div style={bad}>{err}</div>}

      {data && (
        <>
          {/* ── the line, with provenance ─────────────────────────────── */}
          <div style={card}>
            <div style={h3}>The hand so far</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, opacity: 0.85, marginBottom: 8, overflowX: 'auto' }}>
              {data.line || '(nothing yet)'}
            </div>
            <table style={tbl}>
              <tbody>
                {data.steps.map((s) => (
                  <tr key={s.i}>
                    <td style={{ ...td, width: 28, opacity: 0.5 }}>{s.i}</td>
                    <td style={{ ...td, width: 110 }}>
                      seat {s.actor} {s.you ? <b>(you)</b> : <span style={{ opacity: 0.6 }}>(villain)</span>}
                    </td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace', width: 90 }}>{s.action}</td>
                    <td style={{ ...td, fontSize: 12, opacity: s.guessed ? 1 : 0.55 }}>
                      {s.guessed
                        ? <span style={{ color: '#b4690e' }}>blueprint guessed this — replace it if you know</span>
                        : 'you entered'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.terminal
              ? <div style={{ marginTop: 10, fontWeight: 600 }}>
                  {data.folded !== null
                    ? `Fold — seat ${data.folded} folded, no showdown.`
                    : 'Showdown.'}{' '}
                  {data.heroBB !== null && <>You {data.heroBB >= 0 ? 'win' : 'lose'} {Math.abs(data.heroBB).toFixed(2)} BB.</>}
                </div>
              : data.next && <div style={{ marginTop: 10 }}>
                  <b>Next:</b> seat {data.next.seat} {data.next.you ? '(you)' : '(villain)'} at{' '}
                  {STREETS[data.next.street] || `street ${data.next.street}`} {data.next.phase}
                  {data.next.legal.length > 0 && <>
                    {' — '}<span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>
                      {data.next.legal.join('  ')}
                    </span>
                  </>}
                </div>}
          </div>

          {data.warnings.length > 0 && (
            <div style={warn}>
              {data.warnings.map((w, i) => <div key={i} style={{ marginBottom: 4 }}>⚠ {w}</div>)}
            </div>
          )}

          {/* ── the priced table ──────────────────────────────────────── */}
          {t && (
            <div style={card}>
              <div style={h3}>
                {STREETS[t.street] || `street ${t.street}`} {t.phase} — {t.nRows} option
                {t.nRows === 1 ? '' : 's'} priced
                {t.offeredActions && <span style={{ opacity: 0.65, fontWeight: 400 }}>
                  {', '}the blueprint offers {t.offeredActions.length}
                </span>}
              </div>

              {t.bandWidth > 1 && (
                <div style={{ ...warn, background: '#fbf3de', borderColor: '#d9b464', marginTop: 0 }}>
                  <b>{t.bandWidth} of {t.nRows} are not separable</b> at this much evidence
                  {t.bandRule && <> (z={Number(t.bandRule.z).toFixed(2)}, family-wise 5% over K={t.bandRule.K})</>}.
                  They are shown level, with no winner, because their order here is
                  noise. Raise shuffles to narrow it.
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table style={tbl}>
                  <thead>
                    <tr>
                      <th style={th}>action</th>
                      <th style={{ ...th, textAlign: 'right' }}>EV (chips)</th>
                      <th style={{ ...th, textAlign: 'right' }}>EV (BB)</th>
                      <th style={{ ...th, textAlign: 'right' }}>SD</th>
                      <th style={th}>on the menu?</th>
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r) => (
                      <tr key={r.action} style={{ background: r.tied ? 'rgba(120,160,120,.09)' : 'transparent' }}>
                        <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>{r.action}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.ev.toFixed(3)}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.evBB.toFixed(3)}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.6 }}>
                          {r.sd.toFixed(2)}{r.seIsLowerBound ? '+' : ''}
                        </td>
                        <td style={{ ...td, fontSize: 12 }}>
                          {r.offered
                            ? <span style={{ color: '#2d6a4f' }}>yes</span>
                            : <span style={{ opacity: 0.5 }}>no — drill cannot suggest it</span>}
                        </td>
                        <td style={td}>
                          <button onClick={() => take(r.action)} disabled={!!busy} style={btnTiny}>take</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {t.nRows > t.rows.length && (
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
                  showing {t.rows.length} of {t.nRows}
                </div>
              )}
            </div>
          )}

          {/* ── certify the band exactly, where that is possible ─────── */}
          {t && (() => {
            // The route's own constraints, mirrored here so the button explains
            // itself instead of failing: street 2 is the LAST draw (after it the
            // final betting round is what the exact resolver solves), and seat 1
            // draws FIRST, so only at seat 0 has the villain already drawn --
            // which is what makes the posterior a POST-draw range.
            const isLastDraw = t.street === 2 && t.phase === 'draw';
            const bandOpts = t.rows.filter((r) => r.tied && /^d:/.test(r.action));
            const why = !isLastDraw
              ? `Exact grading covers the LAST draw only. This is ${STREETS[t.street] || ('street ' + t.street)} ${t.phase}: earlier draws have further draws ahead of them.`
              : seat !== 0
              ? 'Exact grading needs seat 0: seat 1 draws first, so only at seat 0 has the villain already drawn — which is what makes the opponent range a post-draw one.'
              : !bandOpts.length ? 'No explicit-discard options in the band.' : null;
            return (
              <div style={card}>
                <div style={h3}>Certify the band exactly</div>
                <div style={{ fontSize: 12.5, opacity: 0.8, marginBottom: 8 }}>
                  The table above cannot separate {t.bandWidth} of {t.nRows} options. An exact
                  solve can — one full solve per option, ~0.2–5 s each.
                </div>
                {why
                  ? <div style={{ ...warn, marginBottom: 0 }}>{why}</div>
                  : <button onClick={certify} disabled={exactBusy || !!busy} style={{ ...btn, fontWeight: 600 }}>
                      {exactBusy
                        ? `Solving ${Math.min(8, bandOpts.length)} option(s)…`
                        : `Grade ${Math.min(8, bandOpts.length)} banded option(s) exactly`}
                    </button>}
                {exactErr && <div style={{ ...bad, marginTop: 10, marginBottom: 0 }}>{exactErr}</div>}
                {exact && exact.options && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={tbl}>
                        <thead>
                          <tr>
                            <th style={th}>option</th>
                            <th style={{ ...th, textAlign: 'right' }}>EXACT EV (chips)</th>
                            <th style={{ ...th, textAlign: 'right' }}>outcomes</th>
                            <th style={{ ...th, textAlign: 'right' }}>sampled</th>
                            <th style={{ ...th, textAlign: 'right' }}>secs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {exact.options.map((o, i) => (
                            <tr key={i} style={{ background: i === 0 ? 'rgba(120,160,120,.14)' : 'transparent' }}>
                              <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>
                                {o.label || ('keep ' + (o.keep || []).join(','))}
                              </td>
                              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: i === 0 ? 600 : 400 }}>
                                {o.ev.toFixed(4)}
                              </td>
                              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.6 }}>
                                {o.outcomes.toLocaleString()}
                              </td>
                              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.6 }}>
                                {o.sampled}{o.enumerated ? ' (all)' : ''}
                              </td>
                              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.6 }}>
                                {o.secs.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* What "exact" does and does NOT mean. Shown with the number,
                        not in a footnote: the whole risk of an exact label is that
                        it gets read as more than it is. */}
                    <div style={{ ...warn, background: 'rgba(120,160,120,.10)', borderColor: 'rgba(120,160,120,.5)', marginTop: 10, marginBottom: 0 }}>
                      <b>Exact means:</b> the final betting round, solved exactly given both
                      post-draw ranges. <b>It does not mean</b> an equilibrium value for the whole
                      hand — the opponent range is a particle posterior from your history
                      {exact.oppRange ? ` (${exact.oppRange.kept} of ${exact.oppRange.distinct} distinct holdings, strided over reach — not a top-K head)` : ''}.
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
            <div style={{ ...card, background: uncertified ? '#fdf4f1' : '#f1f6f3',
              borderColor: uncertified ? '#dcae9f' : '#9ec7ae' }}>
              <div style={h3}>{uncertified ? 'These numbers are UNCERTIFIED' : 'Certified'}</div>
              <div style={{ fontSize: 13, marginBottom: 6 }}>{data.trust.note}</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, opacity: 0.85 }}>
                <li>Villain past your decision: {data.trust.villainContinuation}.</li>
                <li>Dead cards: {data.trust.deadCards}.</li>
                <li>
                  Error bar {data.trust.seCoversRangeAxis
                    ? 'covers both the shuffle and the opponent-range axis.'
                    : 'is a LOWER BOUND — one opponent range, so the between-range variance is not estimable. Raise Ranges above 1.'}
                </li>
              </ul>
              {data.budget && (
                <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 8, fontFamily: 'ui-monospace, monospace' }}>
                  used: {data.budget.shuffles} shuffles · {data.budget.particles} particles ·{' '}
                  {data.budget.rangeSeeds} range{data.budget.rangeSeeds === 1 ? '' : 's'} · seed {data.budget.seed}
                  {' '}(capped at {data.budget.caps.shuffles}/{data.budget.caps.particles}/{data.budget.caps.rangeSeeds} — this box also runs datagen)
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 500 };
const lblSm = { ...lbl, fontSize: 11.5, width: 86 };
const inp = { padding: '7px 9px', fontSize: 14, borderRadius: 5, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit', fontWeight: 400 };
const inpSm = { ...inp, padding: '6px 8px', fontSize: 13 };
const btn = { padding: '8px 15px', fontSize: 13.5, borderRadius: 5, border: '1px solid rgba(128,128,128,.45)', background: 'transparent', color: 'inherit', cursor: 'pointer' };
const btnTiny = { padding: '2px 8px', fontSize: 11.5, borderRadius: 4, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit', cursor: 'pointer' };
const card = { border: '1px solid rgba(128,128,128,.28)', borderRadius: 7, padding: '12px 14px', marginBottom: 12 };
const h3 = { fontSize: 13.5, fontWeight: 600, marginBottom: 8 };
const tbl = { borderCollapse: 'collapse', width: '100%', fontSize: 13 };
const th = { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', opacity: 0.55, fontWeight: 500, padding: '4px 8px 4px 0', borderBottom: '1px solid rgba(128,128,128,.25)' };
const td = { padding: '4px 8px 4px 0', borderBottom: '1px solid rgba(128,128,128,.12)' };
const warn = { border: '1px solid #d9b464', background: 'rgba(217,180,100,.12)', borderRadius: 6, padding: '9px 11px', fontSize: 12.5, marginBottom: 12 };
const bad = { border: '1px solid #c0705c', background: 'rgba(192,112,92,.12)', borderRadius: 6, padding: '9px 11px', fontSize: 13, marginBottom: 12 };
