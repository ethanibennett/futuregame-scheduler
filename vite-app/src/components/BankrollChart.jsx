import React from 'react';

/**
 * Bankroll over time (beta, app admins) — the dashboard's chart.
 *
 *   - One y scale, from the lowest to the highest balance IN THE WINDOW, so the two labels name
 *     exactly the values the line reaches: the top edge is the high, the bottom edge the low.
 *   - A STEP line, as ResultsCurve: a balance holds until money moves; a diagonal would draw
 *     balances that never existed.
 *   - Drawdown from the peak is shaded: the area between the running peak (dashed) and the
 *     balance, on the same scale, so a shaded band's height is the drawdown's size.
 *   - x is calendar time across the window (to today for the current month / year).
 *
 * points: [{ date, value }] from utils/bankroll-ledger balanceSeries; dd: drawdowns(points).
 */
const W = 350;
const H = 160;
const t = (d) => Date.parse(d + 'T00:00:00Z');

export default function BankrollChart({ points, dd, start, end, money, fmtDate }) {
  if (!points || points.length < 2) {
    return (
      <div className="bd-block">
        <div className="bd-axis"><span className="an-cell an-note">No movement in this period</span><span /></div>
        <div className="bd-chart-empty" aria-hidden="true" />
        <div className="bd-axis"><span className="an-cell an-note" /><span /></div>
      </div>
    );
  }
  const values = points.map((p) => p.value);
  const hi = Math.max(...values), lo = Math.min(...values);
  const span = hi - lo || 1;
  const t0 = t(start || points[0].date);
  const t1 = Math.max(t(end || points[points.length - 1].date), t0 + 864e5);
  const x = (d) => Math.max(0, Math.min(W, ((t(d) - t0) / (t1 - t0)) * W));
  const y = (v) => (hi === lo ? H / 2 : H - ((v - lo) / span) * H);

  // Step vertices for the balance and its running peak, on the same x breakpoints.
  const bal = [], peak = [];
  points.forEach((p, i) => {
    const xi = i === 0 ? 0 : x(p.date);
    if (i > 0) { bal.push([xi, y(points[i - 1].value)]); peak.push([xi, y(dd.per[i - 1].peak)]); }
    bal.push([xi, y(p.value)]); peak.push([xi, y(dd.per[i].peak)]);
  });
  const last = points[points.length - 1];
  bal.push([W, y(last.value)]); peak.push([W, y(dd.per[dd.per.length - 1].peak)]);
  const path = (pts) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const area = path(peak) + ' ' + [...bal].reverse().map(([a, b]) => `L${a.toFixed(1)},${b.toFixed(1)}`).join(' ') + ' Z';
  const anyDd = dd.per.some((p) => p.dd > 0);

  return (
    <div className="bd-block">
      <div className="bd-axis">
        <span className="an-cell an-note">High {money(hi)}</span>
        <span className="an-cell an-note">{anyDd ? 'Shaded: below the peak' : ''}</span>
      </div>
      <div className="bd-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
          aria-label={`Balance from ${money(points[0].value)} to ${money(last.value)}; high ${money(hi)}, low ${money(lo)}`}>
          <line x1="0" y1="0" x2={W} y2="0" className="bd-edge" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1={H} x2={W} y2={H} className="bd-edge" vectorEffect="non-scaling-stroke" />
          {anyDd && <path d={area} className="bd-dd" />}
          {anyDd && <path d={path(peak)} className="bd-peak" vectorEffect="non-scaling-stroke" />}
          <path d={path(bal)} className="bd-line" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="bd-axis">
        <span className="an-cell an-note">Low {money(lo)}</span>
        <span className="an-cell an-note">{fmtDate(start || points[0].date)} – {fmtDate(end || last.date)}</span>
      </div>
    </div>
  );
}
