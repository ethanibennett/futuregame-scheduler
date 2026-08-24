import React, { useMemo } from 'react';

/**
 * Cumulative P&L, and the shape of the results behind it.
 *
 * There was no chart anywhere in the app — a grep for "chart" or "sparkline"
 * across the components returned nothing, and the only charts in the codebase
 * were the canvas donut and the day-of-week bars inside export.js. The tracking
 * screen computed totals and threw the sequence away, so it was a 2×2 stat grid
 * over a flat list of cards.
 *
 * Two deliberate form choices:
 *
 *   - A STEP line, not a smooth curve. Results are discrete events, and
 *     interpolating between two tournaments draws a value that never existed.
 *   - No axes, no gridlines, no legend. The zero baseline and the endpoint are
 *     the entire chart; everything else is furniture. A downswing reads as
 *     distance below the line rather than as a wall of red numerals, which is
 *     the same argument as making a losing row quieter than a winning one.
 *
 * The distribution strip under it exists because in tournaments the mean is
 * meaningless and the tail is everything: "24 events · 3 cashes" cannot tell
 * you whether those cashes were one 40× or three min-cashes, which is the only
 * fact that matters about the series.
 */
export default function ResultsCurve({ entries, convert, format }) {
  const data = useMemo(() => {
    if (!entries || entries.length < 2) return null;
    const rows = [...entries]
      .filter(e => e && e.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (rows.length < 2) return null;

    let run = 0;
    const pts = [];
    const bars = [];
    let biggest = { mult: 0, idx: -1 };
    for (let i = 0; i < rows.length; i++) {
      const e = rows[i];
      const cost = (e.buyin || 0) * (e.num_entries || 1);
      const cash = e.cash_amount || 0;
      run += convert(cash - cost);
      pts.push(run);
      const mult = cost > 0 ? cash / cost : 0;
      bars.push({ cashed: cash > 0, mult });
      if (cash > 0 && mult > biggest.mult) biggest = { mult, idx: i };
    }
    const max = Math.max(...pts, 0);
    const min = Math.min(...pts, 0);
    const span = (max - min) || 1;
    return { pts, bars, max, min, span, biggest, final: run };
  }, [entries, convert]);

  if (!data) return null;

  const W = 300;
  const H = 70;
  const { pts, bars, max, span, biggest, final } = data;
  const x = i => (i / (pts.length - 1)) * W;
  const y = v => H - ((v - data.min) / span) * H;
  const zeroY = y(0);

  // Step path: hold the value, then jump. Never a diagonal between two events.
  let d = `M0,${y(pts[0]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L${x(i).toFixed(1)},${y(pts[i - 1]).toFixed(1)} L${x(i).toFixed(1)},${y(pts[i]).toFixed(1)}`;
  }
  const areaUp = `${d} L${W},${zeroY.toFixed(1)} L0,${zeroY.toFixed(1)} Z`;

  const maxMult = Math.max(...bars.map(b => b.mult), 1);

  return (
    <div className="results-curve">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="results-curve-svg" aria-hidden="true">
        <defs>
          <clipPath id="rc-above"><rect x="0" y="0" width={W} height={zeroY} /></clipPath>
          <clipPath id="rc-below"><rect x="0" y={zeroY} width={W} height={H - zeroY} /></clipPath>
        </defs>
        <path d={areaUp} className="rc-fill-pos" clipPath="url(#rc-above)" />
        <path d={areaUp} className="rc-fill-neg" clipPath="url(#rc-below)" />
        <line x1="0" y1={zeroY} x2={W} y2={zeroY} className="rc-zero" vectorEffect="non-scaling-stroke" />
        <path d={d} className="rc-line" vectorEffect="non-scaling-stroke" />
        {biggest.idx >= 0 && (
          <circle cx={x(biggest.idx)} cy={y(pts[biggest.idx])} r="3" className="rc-dot-big" />
        )}
        <circle cx={W} cy={y(final)} r="3.5" className={final >= 0 ? 'rc-dot-pos' : 'rc-dot-neg'} />
      </svg>

      <div className="results-curve-foot">
        <span className="rc-zero-label">0</span>
        <span className={'rc-final ' + (final >= 0 ? 'pos' : 'neg')}>
          {final >= 0 ? '+' : ''}{format(final)}
        </span>
      </div>

      {/* One cell per event, chronological. A bust is a tick on the baseline; a
          cash is a bar whose height is log-scaled, so a single 40× tower stands
          clear of twenty grey ticks instead of flattening them. */}
      <div className="results-dist" aria-hidden="true">
        {bars.map((b, i) => (
          <i
            key={i}
            className={b.cashed ? 'is-cash' : ''}
            style={b.cashed
              ? { height: `${4 + (Math.log10(1 + b.mult) / Math.log10(1 + maxMult)) * 10}px` }
              : undefined}
          />
        ))}
      </div>
    </div>
  );
}
