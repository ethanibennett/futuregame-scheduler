import React from 'react';
import { niceTicks, drawdowns } from '../utils/bankroll-ledger.js';

/**
 * The bankroll dashboard's graph (beta, app admins), as a poker tracker's trend chart: in Profit
 * mode up to three cumulative lines on one date axis (Total, Tournaments, Cash — each from 0 at
 * the range's start), in Balance mode the one balance line.
 *
 *   - The pills under the head are the legend AND the switch: each carries its line's colour and
 *     its end value; any mix of lines can be on, never none (the last one does not turn off).
 *     Fill (the fourth pill, On / Off) shades each line down to 0 in a low alpha of its colour;
 *     the fills overlap translucently. Total is drawn first, wider, under the other two: on a day
 *     only one game type moves, Total runs along it and shows as an edge either side.
 *   - One y scale over every line that is ON (hidden ones do not stretch it), rounded out to
 *     "nice" gridlines (utils/bankroll-ledger niceTicks): 2, 3 or 4 steps of 1/2/2.5/5 × 10^n, so
 *     with the 24r plot every gridline sits on an r line. Profit always takes in 0, the zero line
 *     a touch stronger. Labels are HTML, not SVG text (the SVG stretches): each sits ON its
 *     gridline at the left, its baseline on that r line, in a 5g column the lines never enter —
 *     every line starts at x = 5g.
 *   - STEP lines, as ResultsCurve: a total holds until money moves; a diagonal would draw totals
 *     that never existed.
 *   - Drawdown from the peak (the band between the running peak, dashed, and the line) only when
 *     ONE line is drawn, from that line's own points; with several it is clutter.
 *   - x is calendar time across the window (to today).
 *
 * lines: [{ key, label, on, has, points: [{ date, value }], end }] — every candidate, in legend
 *        order (Total, Tournaments, Cash; or the one Balance). has = it had entries in the range;
 *        an ON line without any is drawn flat at 0 and its pill says None.
 * money: the pills' formatter; tick: the gridlines' (compact, the currency's own form).
 * zero: the scale takes in 0 (Profit). control: the head row's right end (Profit | Balance).
 * Layout (bankroll-dashboard.css): a 4r head, a 5r row of pills, the plot (2r of label room over
 * the 35g x 24r grid), a 2r foot with the range's dates.
 */
const W = 350;              // viewBox units: 10 per g across the 35g plot ...
const H = 240;              // ... and 10 per r down its 24r (the SVG is stretched to that box)
const X0 = 50;              // the lines start 5g in, clear of the gridline labels
const ROWS = 24;            // the plot's height in r
const COUNTS = [2, 3, 4];   // gridline steps; each divides 24, so every gridline is on an r line
const t = (d) => Date.parse(d + 'T00:00:00Z');
const NOUN = { total: 'results', tourn: 'tournaments', cash: 'cash sessions', balance: 'movement' };
const f2 = (n) => n.toFixed(2);
const path = (pts) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${f2(a)},${f2(b)}`).join(' ');

export default function BankrollChart({
  lines, onToggle = null, fill = true, onFill, zero = false, start, end, money, tick, fmtDate, note = '', control = null,
  what = 'Balance',
}) {
  const shown = lines.filter((l) => l.on);
  const live = shown.filter((l) => l.has);

  const head = (
    <div className="bd-chart-head">
      <span className="an-cell an-note bd-note-4 an-clip" title={note || undefined}>{note}</span>
      {control}
    </div>
  );
  const legend = (
    <div className="bd-series" role="group" aria-label="Lines on the graph">
      {lines.map((l) => {
        const locked = l.on && shown.length === 1;
        return (
          <button key={l.key} type="button" className={`bd-sp bd-sp-${l.key}` + (l.on ? ' is-on' : '')}
            aria-pressed={l.on} aria-disabled={locked || !onToggle ? 'true' : undefined}
            title={locked && onToggle ? 'One line always stays on' : undefined}
            onClick={() => { if (!locked && onToggle) onToggle(l.key); }}>
            <span className="bd-sp-name"><i className="bd-sw" aria-hidden="true" /><span>{l.label}</span></span>
            <span className="bd-sp-val">{l.has ? money(l.end) : 'None'}</span>
          </button>
        );
      })}
      <button type="button" className={'bd-fill-btn' + (fill ? ' is-on' : '')} aria-pressed={fill}
        aria-label="Fill under the lines" onClick={onFill}>
        <span className="bd-sp-name"><span>Fill</span></span>
        <span className="bd-sp-val">{fill ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
  const foot = (mid) => (
    <div className="bd-axis">
      <span />
      <span className="an-cell an-note an-clip">{fmtDate(start)}</span>
      <span className="an-cell an-note an-clip">{mid}</span>
      <span className="an-cell an-note an-clip">{fmtDate(end)}</span>
    </div>
  );

  if (!live.length) {
    // Nothing to draw: name what is missing ("No tournaments in this range"). Total and Balance
    // cover everything, so either alone says it.
    const all = shown.find((l) => l.key === 'total' || l.key === 'balance');
    const msg = `No ${(all ? [NOUN[all.key]] : shown.map((l) => NOUN[l.key])).join(' or ')} in this range`;
    return (
      <div className="bd-chart-block">
        {head}
        {legend}
        <div className="bd-chart is-empty"><span className="an-cell an-note bd-chart-msg">{msg}</span></div>
        {foot('')}
      </div>
    );
  }

  // One scale over the lines that are on; an on line with no entries is flat at 0.
  let lo = Infinity, hi = -Infinity;
  for (const l of live) for (const p of l.points) { if (p.value < lo) lo = p.value; if (p.value > hi) hi = p.value; }
  if (live.length < shown.length) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const ax = niceTicks(lo, hi, { counts: COUNTS, zero });
  const y = (v) => (ax.step === 0 ? H / 2 : ((ax.hi - v) / (ax.hi - ax.lo)) * H);
  const t0 = t(start);
  const t1 = Math.max(t(end), t0 + 864e5);
  const x = (d) => X0 + Math.max(0, Math.min(1, (t(d) - t0) / (t1 - t0))) * (W - X0);
  // Gridlines by index, so each is exactly on its r line: row k of 24 from the plot's top.
  const n = ax.ticks.length - 1;
  const grid = ax.ticks.map((v, j) => ({ v, k: n ? (ROWS * (n - j)) / n : ROWS / 2 }));
  const base = y(Math.min(Math.max(0, ax.lo), ax.hi)); // fills run to 0 (or the nearer edge)

  const geo = shown.map((l) => {
    const pts = l.has ? l.points : [{ date: start, value: 0 }];
    const v = [];
    pts.forEach((p, i) => {
      const xi = i === 0 ? X0 : x(p.date);
      if (i > 0) v.push([xi, y(pts[i - 1].value)]);
      v.push([xi, y(p.value)]);
    });
    v.push([W, y(pts[pts.length - 1].value)]);
    return { l, pts, v };
  });

  // Drawdown below the running peak: one line only, from its own points.
  let dd = null;
  if (geo.length === 1 && geo[0].l.has) {
    const { pts, v } = geo[0];
    const d = drawdowns(pts);
    if (d.per.some((p) => p.dd > 0)) {
      const peak = [];
      pts.forEach((p, i) => {
        const xi = i === 0 ? X0 : x(p.date);
        if (i > 0) peak.push([xi, y(d.per[i - 1].peak)]);
        peak.push([xi, y(d.per[i].peak)]);
      });
      peak.push([W, y(d.per[d.per.length - 1].peak)]);
      dd = { peak: path(peak), area: path(peak) + ' ' + [...v].reverse().map(([a, b]) => `L${f2(a)},${f2(b)}`).join(' ') + ' Z' };
    }
  }

  // Draw order: Total first, under the others and wider (bankroll-dashboard.css), so where it runs
  // along Tournaments or Cash (every day only one of them moves) both stay visible.
  const drawn = geo;
  const aria = `${what}, ${fmtDate(start)} to ${fmtDate(end)}: ` + shown.map((l) => `${l.label} ${l.has ? money(l.end) : 'none'}`).join(', ')
    + (ax.step ? `; gridlines every ${tick(ax.step)} from ${tick(ax.lo)} to ${tick(ax.hi)}` : '');

  return (
    <div className="bd-chart-block">
      {head}
      {legend}
      <div className="bd-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={aria}
          data-lo={ax.lo} data-hi={ax.hi} data-step={ax.step} data-x0={X0} data-start={start}
          data-t1={new Date(t1).toISOString().slice(0, 10)}>
          {grid.map((g) => (
            <line key={'g' + g.v} x1="0" y1={g.k * (H / ROWS)} x2={W} y2={g.k * (H / ROWS)}
              className={g.v === 0 ? 'bd-zero' : 'bd-grid'} vectorEffect="non-scaling-stroke" />
          ))}
          {fill && drawn.map(({ l, v }) => (
            <path key={'a' + l.key} d={`${path(v)} L${W},${f2(base)} L${X0},${f2(base)} Z`} className={`bd-area bd-c-${l.key}`} />
          ))}
          {dd && <path d={dd.area} className="bd-dd" />}
          {dd && <path d={dd.peak} className="bd-peak" vectorEffect="non-scaling-stroke" />}
          {drawn.map(({ l, v }) => (
            <path key={'l' + l.key} d={path(v)} className={`bd-line bd-c-${l.key}`} data-series={l.key} data-end={l.end}
              vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {grid.map((g) => (
          <span key={'t' + g.v} className="an-cell an-note bd-tick" style={{ '--k': g.k }} aria-hidden="true">{tick(g.v)}</span>
        ))}
      </div>
      {foot(dd ? 'Shaded: drawdown' : '')}
    </div>
  );
}
