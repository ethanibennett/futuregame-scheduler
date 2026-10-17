import React, { useLayoutEffect, useRef, useState } from 'react';
import { shapePath, useLineStyle, lineStyleLabel } from '../utils/line-style.js';
import { niceTicks, drawdownBand } from '../utils/bankroll-ledger.js';

/**
 * The bankroll dashboard's graph (beta, app admins), as a poker tracker's trend chart: in Profit
 * mode up to three cumulative lines on one date axis (Total, Tournaments, Cash — each from 0 at
 * the range's start), in Balance mode the one balance line.
 *
 *   - The pills under the head are the legend AND the switch: each carries its line's colour and
 *     its end value; any mix of lines can be on, never none (the last one does not turn off).
 *     Fill (the fourth pill, On / Off) shades each line down to 0 in a low alpha of its colour
 *     (one alpha per line, so each fill stands off the sheet as much as the others); the fills
 *     overlap translucently. Total is drawn first, under the other two and (with them) a hairline
 *     wider: on a day only one game type moves, Total runs along it and shows as a half-hairline
 *     edge.
 *   - One y scale over every line that is ON (hidden ones do not stretch it), rounded out to
 *     "nice" gridlines (utils/bankroll-ledger niceTicks): 2, 3 or 4 steps of 1/2/2.5/5 × 10^n, so
 *     with the 24r plot every gridline sits on an r line. Profit always takes in 0, the zero line
 *     a touch stronger. Labels are HTML, not SVG text (the SVG stretches): each sits level with its
 *     gridline in a 5g gutter at the left, its baseline on that r line. Nothing is drawn in the
 *     gutter: the gridlines, the zero line and the data lines all start at x = 5g. Each label is
 *     its gridline's exact value (compactMoney's precision follows the step), so a balance that
 *     barely moved can ask for a long one (MX$999,985); a label that would come within 0.5g of the
 *     lines coarsens the scale a power of ten at a time until every label fits (measured after
 *     layout, before paint).
 *   - STEP lines, as ResultsCurve: a total holds until money moves; a diagonal would draw totals
 *     that never existed.
 *   - Drawdown from the peak (the band between the running peak, dashed, and the line) only when
 *     ONE line is drawn, from that line's own points; with several it is clutter. The band is
 *     always its full depth, so the red is the drawdown; with Fill on the line's fill gives way
 *     under it (drawdownBand's edge) rather than the band stopping at the fill: stacked, the two
 *     translucent layers mix to a neutral grey and both colours are lost.
 *   - x is calendar time from start to end (utils/bankroll-ledger chartSpan: today, or for All a
 *     later-dated entry's day).
 *
 * lines: [{ key, label, on, has, points: [{ date, value }], end }] — every candidate, in legend
 *        order (Total, Tournaments, Cash; or the one Balance). has = it had entries in the range;
 *        an ON line without any is drawn flat at 0 and its pill says None.
 * money: the pills' formatter; tick(v, step): the gridlines' (compact, the currency's own form,
 *        precise enough for the step that every gridline reads as its own exact value).
 * zero: the scale takes in 0 (Profit). control: the head row's right end (Profit | Balance).
 * busy: the figures are the previous bankroll's, kept on screen while the next ledger loads —
 *       dimmed and aria-busy, as the Overview tables do.
 * Layout (bankroll-dashboard.css): a 4r head, a 5r row of pills, the plot (2r of label room over
 * the 35g x 24r grid), a 2r foot with the range's dates.
 */
const W = 350;              // viewBox units: 10 per g across the 35g plot ...
const H = 240;              // ... and 10 per r down its 24r (the SVG is stretched to that box)
const X0 = 50;              // the lines start 5g in, clear of the gridline labels
const ROWS = 24;            // the plot's height in r
const COUNTS = [2, 3, 4];   // gridline steps; each divides 24, so every gridline is on an r line
const DD_MIN = 0.25;        // the shallowest drawdown band drawn, in r (any shallower is not seen)
const t = (d) => Date.parse(d + 'T00:00:00Z');
const NOUN = { total: 'results', tourn: 'tournaments', cash: 'cash sessions', balance: 'movement' };
const f2 = (n) => n.toFixed(2);
const path = (pts, style) => shapePath(pts, style, { fmt: f2 });

export default function BankrollChart({
  lines, onToggle = null, fill = true, onFill, zero = false, start, end, money, tick, fmtDate, note = '', control = null,
  what = 'Balance', busy = false,
}) {
  const [lineStyle, cycleLineStyle] = useLineStyle();   // steps, lines or curves (utils/line-style.js)
  const shown = lines.filter((l) => l.on);
  const live = shown.filter((l) => l.has);

  // One scale over the lines that are on; an on line with no entries is flat at 0.
  let lo = Infinity, hi = -Infinity;
  for (const l of live) for (const p of l.points) { if (p.value < lo) lo = p.value; if (p.value > hi) hi = p.value; }
  if (live.length < shown.length) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  // The label gutter: each label is its gridline's exact value, so a scale finer than the gutter
  // can write (MX$999,985 … MX$1,000,000) coarsens a power of ten at a time — the minimum step ×10
  // per level — until every label's ink ends 0.5g short of the lines. Measured after layout and
  // before paint; a new extent starts again at level 0.
  const scaleKey = `${lo}|${hi}|${zero}`;
  const [fit, setFit] = useState({ key: scaleKey, level: 0 });
  const level = fit.key === scaleKey ? fit.level : 0;
  const plotRef = useRef(null);
  useLayoutEffect(() => {
    const el = plotRef.current;
    const svg = el && el.querySelector('svg');
    if (!svg || !(Number(svg.dataset.step) > 0) || level >= 6) return undefined;
    if (document.fonts && document.fonts.status === 'loading') {
      // Not the face the labels will wear yet: measure again once it is in.
      let on = true;
      document.fonts.ready.then(() => { if (on) setFit((f) => ({ ...f, n: (f.n || 0) + 1 })); });
      return () => { on = false; };
    }
    const over = [...el.querySelectorAll('.bd-tick')].some((tk) => {
      const r = document.createRange();
      r.selectNodeContents(tk);
      return r.getBoundingClientRect().width > tk.getBoundingClientRect().width * 0.9; // 4.5g of 5g
    });
    if (over) setFit({ key: scaleKey, level: level + 1 });
    return undefined;
  });

  const head = (
    <div className="bd-chart-head">
      <span className="an-cell an-note bd-note-4 an-clip" title={note || undefined}>{note}</span>
      <button type="button" className="bp-style bd-style ctl" onClick={cycleLineStyle}
        aria-label={`Line: ${lineStyleLabel(lineStyle)}. Change the line`} title="Steps, lines or curves">{lineStyleLabel(lineStyle)}</button>
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
      <div className={'bd-chart-block' + (busy ? ' is-busy' : '')} aria-busy={busy ? 'true' : undefined}>
        {head}
        {legend}
        <div className="bd-chart is-empty"><span className="an-cell an-note bd-chart-msg">{msg}</span></div>
        {foot('')}
      </div>
    );
  }

  const ax0 = niceTicks(lo, hi, { counts: COUNTS, zero });
  const ax = level && ax0.step ? niceTicks(lo, hi, { counts: COUNTS, zero, minStep: ax0.step * 10 ** level }) : ax0;
  const y = (v) => (ax.step === 0 ? H / 2 : ((ax.hi - v) / (ax.hi - ax.lo)) * H);
  const t0 = t(start);
  const t1 = Math.max(t(end), t0 + 864e5);
  const x = (d) => X0 + Math.max(0, Math.min(1, (t(d) - t0) / (t1 - t0))) * (W - X0);
  // The points a line goes through (vals[i] at pts[i], held to the right edge); its shape (steps,
  // lines or curves) is the shared choice (utils/line-style.js).
  const steps = (pts, vals) => {
    const v = pts.map((p, i) => [i === 0 ? X0 : x(p.date), y(vals[i])]);
    v.push([W, y(vals[vals.length - 1])]);
    return v;
  };
  // Gridlines by index, so each is exactly on its r line: row k of 24 from the plot's top.
  const n = ax.ticks.length - 1;
  const grid = ax.ticks.map((v, j) => ({ v, k: n ? (ROWS * (n - j)) / n : ROWS / 2 }));
  const floor = Math.min(Math.max(0, ax.lo), ax.hi); // fills run to 0 (or the nearer edge)
  const base = y(floor);

  const geo = shown.map((l) => {
    const pts = l.has ? l.points : [{ date: start, value: 0 }];
    const v = steps(pts, pts.map((p) => p.value));
    return { l, pts, v, f: v };
  });

  // Drawdown below the running peak: one line only, from its own points, always its full depth
  // (peak to line). With Fill on, the line's fill gives way under the band (drawdownBand's edge),
  // so the two translucent layers never stack. A band under DD_MIN r deep at its deepest is not
  // drawn (nor named in the foot): a coarsened scale can leave a real drawdown thinner than a
  // pixel (a MX$15 expense on a MX$950k–1.05M scale), and the foot would name red nobody can see.
  // Only lines with entries in the range are drawn: an on line with none says None on its pill, and
  // a flat line of it would only paint the zero line in its colour. The band follows the one drawn.
  const drawn = geo.filter((g) => g.l.has);
  let dd = null;
  if (drawn.length === 1 && ax.hi > ax.lo) {
    const g0 = drawn[0];
    const band = drawdownBand(g0.pts, { floor });
    const deepest = band.reduce((m, b) => Math.max(m, b.peak - b.bottom), 0);
    if ((deepest / (ax.hi - ax.lo)) * ROWS >= DD_MIN) {
      g0.f = steps(g0.pts, band.map((b) => b.edge));
      const top = steps(g0.pts, band.map((b) => b.peak));
      const bottom = steps(g0.pts, band.map((b) => b.bottom));
      dd = { peak: path(top, lineStyle), area: path(top, lineStyle) + ' ' + shapePath([...bottom].reverse(), lineStyle, { move: false, fmt: f2 }) + ' Z' };
    }
  }

  // Draw order: Total first, under the others and, with others drawn, a hairline wider (.bd-under in
  // bankroll-dashboard.css), so where it runs along Tournaments or Cash (every day only one of them
  // moves) a thin edge of it shows. Alone, it is drawn at the others' weight.
  // The labels' precision comes from the step, so each gridline reads as its own exact value.
  const label = (v) => tick(v, ax.step);
  const aria = `${what}, ${fmtDate(start)} to ${fmtDate(end)}: ` + shown.map((l) => `${l.label} ${l.has ? money(l.end) : 'none'}`).join(', ')
    + (ax.step ? `; gridlines every ${label(ax.step)} from ${label(ax.lo)} to ${label(ax.hi)}` : '');

  return (
    <div className={'bd-chart-block' + (busy ? ' is-busy' : '')} aria-busy={busy ? 'true' : undefined}>
      {head}
      {legend}
      <div className="bd-chart" ref={plotRef}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={aria}
          data-lo={ax.lo} data-hi={ax.hi} data-step={ax.step} data-x0={X0} data-start={start}
          data-t1={new Date(t1).toISOString().slice(0, 10)}>
          {grid.map((g) => (
            <line key={'g' + g.v} x1={X0} y1={g.k * (H / ROWS)} x2={W} y2={g.k * (H / ROWS)}
              className={g.v === 0 ? 'bd-zero' : 'bd-grid'} vectorEffect="non-scaling-stroke" />
          ))}
          {fill && drawn.map(({ l, f }) => (
            <path key={'a' + l.key} d={`${path(f, lineStyle)} L${W},${f2(base)} L${X0},${f2(base)} Z`} className={`bd-area bd-c-${l.key}`} />
          ))}
          {dd && <path d={dd.area} className="bd-dd" />}
          {dd && <path d={dd.peak} className="bd-peak" vectorEffect="non-scaling-stroke" />}
          {drawn.map(({ l, v }) => (
            <path key={'l' + l.key} d={path(v, lineStyle)} data-series={l.key} data-end={l.end}
              className={`bd-line bd-c-${l.key}` + (l.key === 'total' && drawn.length > 1 ? ' bd-under' : '')}
              vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {grid.map((g) => (
          <span key={'t' + g.v} className="an-cell an-note bd-tick" style={{ '--k': g.k }} aria-hidden="true">{label(g.v)}</span>
        ))}
      </div>
      {foot(dd ? 'Red: drawdown' : '')}
    </div>
  );
}
