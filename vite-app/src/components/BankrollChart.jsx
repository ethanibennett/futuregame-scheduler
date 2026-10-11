import React from 'react';

/**
 * The bankroll dashboard's graph (beta, app admins): cumulative profit or the balance, over the
 * overview's range. A tracker's "chip graph", drawn the way this app draws money over time:
 *
 *   - One y scale, from the lowest to the highest value IN THE WINDOW, so the two labels name
 *     exactly the values the line reaches: the top edge is the high, the bottom edge the low.
 *     With `zero` (the profit graph) the scale always takes in 0 and a hairline marks it, so a
 *     losing stretch reads as below the line it started on.
 *   - A STEP line, as ResultsCurve: a total holds until money moves; a diagonal would draw totals
 *     that never existed.
 *   - Drawdown from the peak is shaded: the area between the running peak (dashed) and the line,
 *     on the same scale, so a shaded band's height is the drawdown's size.
 *   - x is calendar time across the window (to today).
 *
 * points: [{ date, value }] (utils/bankroll-ledger balanceSeries / profitSeries); dd: drawdowns(points).
 * control: an element for the head row's right end (the overview's Profit | Balance switch).
 * Layout (bankroll-dashboard.css): a 4r head row, the 35g x 24r plot, a 2r foot row.
 */
const W = 350;
const H = 240;
const t = (d) => Date.parse(d + 'T00:00:00Z');

export default function BankrollChart({ points, dd, start, end, money, fmtDate, zero = false, control = null, what = 'Balance' }) {
  const head = (text) => (
    <div className="bd-chart-head">
      <span className="an-cell an-note bd-note-4 an-clip">{text}</span>
      {control}
    </div>
  );
  if (!points || points.length < 2) {
    return (
      <div className="bd-chart-block">
        {head('No movement in this range')}
        <div className="bd-chart-empty" aria-hidden="true" />
        <div className="bd-axis"><span className="an-cell an-note" /><span /></div>
      </div>
    );
  }
  const values = points.map((p) => p.value);
  let hi = Math.max(...values), lo = Math.min(...values);
  if (zero) { hi = Math.max(hi, 0); lo = Math.min(lo, 0); }
  const span = hi - lo || 1;
  const t0 = t(start || points[0].date);
  const t1 = Math.max(t(end || points[points.length - 1].date), t0 + 864e5);
  const x = (d) => Math.max(0, Math.min(W, ((t(d) - t0) / (t1 - t0)) * W));
  const y = (v) => (hi === lo ? H / 2 : H - ((v - lo) / span) * H);

  // Step vertices for the line and its running peak, on the same x breakpoints.
  const line = [], peak = [];
  points.forEach((p, i) => {
    const xi = i === 0 ? 0 : x(p.date);
    if (i > 0) { line.push([xi, y(points[i - 1].value)]); peak.push([xi, y(dd.per[i - 1].peak)]); }
    line.push([xi, y(p.value)]); peak.push([xi, y(dd.per[i].peak)]);
  });
  const last = points[points.length - 1];
  line.push([W, y(last.value)]); peak.push([W, y(dd.per[dd.per.length - 1].peak)]);
  const path = (pts) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const area = path(peak) + ' ' + [...line].reverse().map(([a, b]) => `L${a.toFixed(1)},${b.toFixed(1)}`).join(' ') + ' Z';
  const anyDd = dd.per.some((p) => p.dd > 0);
  const showZero = zero && lo < 0 && hi > 0;

  return (
    <div className="bd-chart-block">
      {head(`High ${money(hi)}${anyDd ? ' · shaded: below the peak' : ''}`)}
      <div className="bd-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
          aria-label={`${what} from ${money(points[0].value)} to ${money(last.value)}; high ${money(hi)}, low ${money(lo)}`}>
          <line x1="0" y1="0" x2={W} y2="0" className="bd-edge" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1={H} x2={W} y2={H} className="bd-edge" vectorEffect="non-scaling-stroke" />
          {showZero && <line x1="0" y1={y(0)} x2={W} y2={y(0)} className="bd-zero" vectorEffect="non-scaling-stroke" />}
          {anyDd && <path d={area} className="bd-dd" />}
          {anyDd && <path d={path(peak)} className="bd-peak" vectorEffect="non-scaling-stroke" />}
          <path d={path(line)} className={'bd-line' + (zero ? (last.value < 0 ? ' is-neg' : ' is-pos') : '')} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="bd-axis">
        <span className="an-cell an-note an-clip">Low {money(lo)}</span>
        <span className="an-cell an-note an-clip">{fmtDate(start || points[0].date)} – {fmtDate(end || last.date)}</span>
      </div>
    </div>
  );
}
