import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { shapePath, useLineStyle, lineStyleLabel } from '../utils/line-style.js';
import { niceTicks, drawdownBand } from '../utils/bankroll-ledger.js';
import { timeBands } from '../utils/chart-time.js';
import { Bone } from './SkeletonBankroll.jsx';

/**
 * The bankroll dashboard's graph (beta, app admins), as a poker tracker's trend chart: in Profit
 * mode up to three cumulative lines on one date axis (Total, Tournaments, Cash — each from 0 at
 * the range's start), in Balance mode the one balance line.
 *
 *   - The pills under the head are the legend AND the switch: each carries its line's colour and
 *     its end value; any mix of lines can be on, never none (the last one does not turn off).
 *   - ONE fill (Bankroll design 6), under the top line on show (Total, else the first), down to zero
 *     and clipped there: --pos-quiet above, --neg-quiet below, so a losing range is shaded as one.
 *     The zero line outranks the grid (a hairline in --text-muted over the fill, the grid a fine
 *     line in --border) and its "$0" label is in --text.
 *   - One y scale over every line that is ON (hidden ones do not stretch it), rounded out to
 *     "nice" gridlines (utils/bankroll-ledger niceTicks): 2, 3 or 4 steps of 1/2/2.5/5 × 10^n, so
 *     with the 24r plot every gridline sits on an r line. Labels are HTML, not SVG text (the SVG
 *     stretches), level with their gridline in a 5g gutter at the left; a label that would come
 *     within 0.5g of the lines coarsens the scale a power of ten at a time until every label fits.
 *   - The time axis is calendar bands (Bankroll design 7; utils/chart-time.js): a fine vertical at
 *     each week's, month's, quarter's or year's start and its name under the plot (J F M …; a band
 *     under 1g keeps its line and drops its letter), the year in the gutter under the labels.
 *   - The pointer (Bankroll design 8): over the plot a cursor line, a dot on each line, the pills'
 *     figures become that day's and the day is printed on the axis. On touch, press and drag
 *     (touch-action: pan-y, so a vertical drag still scrolls the page).
 *   - Drawdown from the peak (the band between the running peak, dashed, and the line) only when
 *     ONE line is drawn. Its peak and its deepest point are named on the plot (Bankroll design 9),
 *     and in Balance mode the peak is named even with no drawdown.
 *   - A young bankroll (Bankroll design 12, `lead`): the axis starts at its first entry with 1g of
 *     lead-in, the left label says that day, and while a line has few entries each is a dot.
 *   - No entries (Bankroll design 13): the frame stays (grid, a zero line at mid-height, "$0"), the
 *     note above the zero line, and the pills step back. `loading` draws the same frame with quiet
 *     blocks for the figures (Bankroll design 4).
 *   - A line may be `straight` (the fund's pace, Bankroll design 14): a dashed diagonal through its
 *     points, never a step; `endDots` marks where each line ends.
 *
 * lines: [{ key, label, on, has, points: [{ date, value }], end, straight?, fixed? }] — every
 *        candidate, in legend order. has = it had entries in the range. fixed = its pill is not a switch.
 * money: the pills' formatter; tick(v, step): the gridlines'; compact(v): the plot's own labels.
 */
const W = 350;              // viewBox units: 10 per g across the 35g plot ...
const H = 240;              // ... and 10 per r down its 24r (the SVG is stretched to that box)
const X0 = 50;              // the lines start 5g in, clear of the gridline labels
const ROWS = 24;            // the plot's height in r
const COUNTS = [2, 3, 4];   // gridline steps; each divides 24, so every gridline is on an r line
const DD_MIN = 0.25;        // the shallowest drawdown band drawn, in r (any shallower is not seen)
const DOTS_MAX = 12;        // a line with at most this many entries marks each one
const DAY = 864e5;
const t = (d) => Date.parse(d + 'T00:00:00Z');
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const NOUN = { total: 'results', tourn: 'tournaments', cash: 'cash sessions', balance: 'movement' };
const f2 = (n) => n.toFixed(2);
const path = (pts, style) => shapePath(pts, style, { fmt: f2 });
// viewBox units to the plot box's own: x in g, y in r below its 2r of label room.
const gx = (x) => `calc(var(--gu) * ${(x / 10).toFixed(3)})`;
const ry = (y, off = 0) => `calc(var(--subrow) * ${(2 + y / 10 + off).toFixed(3)})`;

/** A line's value on day `ms`: the last point on or before it (a total holds until money moves);
 *  a straight line is read along its segment. */
function valueAt(l, ms) {
  const pts = l.points;
  if (!pts.length) return 0;
  if (l.straight) {
    for (let i = 1; i < pts.length; i++) {
      const a = t(pts[i - 1].date), b = t(pts[i].date);
      if (ms <= b) return b > a ? pts[i - 1].value + ((pts[i].value - pts[i - 1].value) * (Math.max(ms, a) - a)) / (b - a) : pts[i].value;
    }
    return pts[pts.length - 1].value;
  }
  let v = pts[0].value;
  for (const p of pts) { if (t(p.date) <= ms) v = p.value; else break; }
  return v;
}

export default function BankrollChart({
  lines, onToggle = null, fill = true, onFill, zero = false, start, end, money, tick, fmtDate, note = '', control = null,
  what = 'Balance', busy = false, loading = false, lead = false, compact = null, markPeaks = false, endDots = false,
}) {
  const uid = useId().replace(/:/g, '');
  const [lineStyle, cycleLineStyle] = useLineStyle();   // steps, lines or curves (utils/line-style.js)
  const shown = lines.filter((l) => l.on);
  const live = loading ? [] : shown.filter((l) => l.has);
  const short = (d) => fmtDate(d).replace(/,\s*\d{4}$/, '');
  const small = compact || money;

  // One scale over the lines that are on; an on line with no entries is flat at 0.
  let lo = Infinity, hi = -Infinity;
  for (const l of live) for (const p of l.points) { if (p.value < lo) lo = p.value; if (p.value > hi) hi = p.value; }
  if (live.length < shown.length) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  // The label gutter: each label is its gridline's exact value, so a scale finer than the gutter
  // can write coarsens a power of ten at a time until every label's ink ends 0.5g short of the lines.
  const scaleKey = `${lo}|${hi}|${zero}`;
  const [fit, setFit] = useState({ key: scaleKey, level: 0 });
  const level = fit.key === scaleKey ? fit.level : 0;
  const plotRef = useRef(null);
  const drag = useRef(false);
  const [hover, setHover] = useState(null); // the day under the pointer (ms, UTC midnight)
  useLayoutEffect(() => {
    const el = plotRef.current;
    const svg = el && el.querySelector('svg');
    if (!svg || !(Number(svg.dataset.step) > 0) || level >= 6) return undefined;
    if (document.fonts && document.fonts.status === 'loading') {
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

  // The time axis: from the range's start, or (a young bankroll) from its first entry less 1g of
  // lead-in, i.e. 1/29 of the span after it (30g of plot, 1g of it before the first entry).
  const tStart = t(start);
  const t1 = Math.max(t(end), tStart + DAY);
  const t0 = lead ? tStart - (t1 - tStart) / 29 : tStart;
  const xMs = (ms) => X0 + Math.max(0, Math.min(1, (ms - t0) / (t1 - t0))) * (W - X0);
  const x = (d) => xMs(t(d));

  const head = (
    <div className="bd-chart-head is-options">
      {control}
      <button type="button" className="bd-opt bd-style ctl" onClick={cycleLineStyle}
        aria-label={`Line: ${lineStyleLabel(lineStyle)}. Change the line`} title="Steps, lines or curves">{lineStyleLabel(lineStyle)}</button>
      <button type="button" className={'bd-opt bd-fill-opt ctl' + (fill ? ' is-on' : '')} aria-pressed={fill}
        aria-label="Fill under the lines" onClick={onFill}>{fill ? 'Fill on' : 'Fill off'}</button>
    </div>
  );
  const noteLine = note ? <span className="an-cell an-note bd-note-3 bd-chart-note">{note}</span> : null;
  const legend = (
    <div className={'bd-series is-lines' + (!loading && !live.length ? ' is-none' : '')} role="group" aria-label="Lines on the graph"
      style={{ gridTemplateColumns: `repeat(${lines.length}, calc(var(--gu) * ${lines.length > 3 ? 8 : 11}))` }}>
      {lines.map((l) => {
        const locked = l.on && shown.length === 1;
        const fixed = l.fixed || !onToggle;
        const v = hover != null && l.has ? valueAt(l, hover) : l.end;
        return (
          <button key={l.key} type="button" className={`bd-sp bd-sp-${l.key}` + (l.on ? ' is-on' : '') + (l.straight ? ' is-dashed' : '')}
            aria-pressed={fixed ? undefined : l.on} aria-disabled={locked || fixed ? 'true' : undefined}
            title={locked && !fixed ? 'One line always stays on' : undefined}
            onClick={() => { if (!locked && !fixed) onToggle(l.key); }}>
            <span className="bd-sp-name"><i className="bd-sw" aria-hidden="true" /><span>{l.label}</span></span>
            <span className="bd-sp-val">{loading ? <Bone w={4} /> : l.has ? money(v) : 'None'}</span>
          </button>
        );
      })}
    </div>
  );

  // The calendar bands and their labels (Bankroll design 7).
  const tb = timeBands(tStart, t1);
  const edges = tb.bands.filter((b) => b.edge).map((b) => xMs(b.from));
  const startLabel = lead ? short(start) : null;
  const xFirst = xMs(tStart);
  const bandLabels = tb.bands.map((b) => {
    const x1 = xMs(b.from), x2 = xMs(b.to), w = (x2 - x1) / 10;
    const text = tb.unit === 'month' ? (w >= 3 ? b.long : w >= 1 ? b.short : '')
      : tb.unit === 'week' ? (w >= 3.5 ? b.short : '') : (w >= (tb.unit === 'year' ? 3 : 1.5) ? b.short : '');
    // The young bankroll's first-day label takes the first 4g after its entry.
    if (startLabel && (x1 + x2) / 20 < xFirst / 10 + 4) return null;
    return text ? { key: b.start, x1, x2, text } : null;
  }).filter(Boolean);
  const nowX = hover != null ? xMs(hover) : null;
  const foot = (
    <div className={'bd-axis' + (hover != null ? ' is-reading' : '')}>
      <span className="an-cell an-note an-clip bd-axis-year">{loading ? '' : tb.year}</span>
      {!loading && bandLabels.map((l) => (
        <span key={l.key} className="an-cell an-note bd-axis-band" style={{ left: gx(l.x1), width: gx(l.x2 - l.x1) }}>{l.text}</span>
      ))}
      {!loading && startLabel && <span className="an-cell an-note bd-axis-start" style={{ left: gx(xFirst) }}>{startLabel}</span>}
      {nowX != null && (
        <span className={'an-cell an-note bd-axis-now' + (nowX > W - 50 ? ' is-end' : nowX < X0 + 50 ? ' is-start' : '')}
          style={{ left: gx(nowX) }}>{fmtDate(iso(hover))}</span>
      )}
    </div>
  );

  if (!live.length) {
    // Nothing to draw: the frame stays (Bankroll design 13), with four gridlines, the zero line at
    // mid-height and its "$0", and the note above the zero line, naming what is missing. Loading
    // (Bankroll design 4) draws the frame alone.
    const all = shown.find((l) => l.key === 'total' || l.key === 'balance');
    const msg = `No ${(all ? [NOUN[all.key]] : shown.map((l) => NOUN[l.key])).join(' or ')} in this range`;
    return (
      <div className={'bd-chart-block' + (busy ? ' is-busy' : '')} aria-busy={busy || loading ? 'true' : undefined}>
        {head}
        {legend}
        {noteLine}
        <div className="bd-chart is-empty">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {[0, 6, 18, 24].map((k) => <line key={k} x1={X0} y1={k * 10} x2={W} y2={k * 10} className="bd-grid" vectorEffect="non-scaling-stroke" />)}
            {!loading && <line x1={X0} y1={120} x2={W} y2={120} className="bd-zero" vectorEffect="non-scaling-stroke" />}
          </svg>
          {!loading && <span className="an-cell an-note bd-tick is-zero" style={{ '--k': 12 }} aria-hidden="true">{tick(0, 1)}</span>}
          {!loading && <span className="an-cell an-note bd-chart-msg">{msg}</span>}
        </div>
        {foot}
      </div>
    );
  }

  const ax0 = niceTicks(lo, hi, { counts: COUNTS, zero });
  const ax = level && ax0.step ? niceTicks(lo, hi, { counts: COUNTS, zero, minStep: ax0.step * 10 ** level }) : ax0;
  const y = (v) => (ax.step === 0 ? H / 2 : ((ax.hi - v) / (ax.hi - ax.lo)) * H);
  // The points a line goes through (vals[i] at pts[i], held to the right edge); its shape (steps,
  // lines or curves) is the shared choice. A straight line goes through its points and stops.
  const steps = (pts, vals) => {
    const v = pts.map((p, i) => [i === 0 ? X0 : x(p.date), y(vals[i])]);
    v.push([W, y(vals[vals.length - 1])]);
    return v;
  };
  const n = ax.ticks.length - 1;
  const grid = ax.ticks.map((v, j) => ({ v, k: n ? (ROWS * (n - j)) / n : ROWS / 2 }));
  const floor = Math.min(Math.max(0, ax.lo), ax.hi); // the fill runs to 0 (or the nearer edge)
  const base = y(floor);

  const geo = shown.map((l) => {
    const pts = l.has ? l.points : [{ date: start, value: 0 }];
    const v = l.straight ? pts.map((p) => [x(p.date), y(p.value)]) : steps(pts, pts.map((p) => p.value));
    return { l, pts, v, f: v };
  });

  // Drawdown below the running peak: one line only, from its own points, always its full depth.
  // With Fill on, the fill gives way under the band (drawdownBand's edge), so they never stack.
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
      // The band comes back along the line right to left. A step drawn backwards puts its corner on the
      // other side (it holds the right point's value leftwards), so the outline crossed itself and left
      // holes wherever the line jumped: its corners are traced forwards first, then walked back straight.
      const stepped = lineStyle !== 'lines' && lineStyle !== 'curves';
      const back = stepped ? bottom.flatMap((q, i) => (i ? [[q[0], bottom[i - 1][1]], q] : [q])) : bottom;
      dd = { peak: path(top, lineStyle), area: path(top, lineStyle) + ' ' + shapePath([...back].reverse(), stepped ? 'lines' : lineStyle, { move: false, fmt: f2 }) + ' Z' };
    }
  }

  // The peak and the deepest point below it, named (Bankroll design 9): the deepest fall from a
  // running peak, and that peak. In Balance mode with no fall, the peak alone.
  let marks = [];
  if (drawn.length === 1 && (dd || markPeaks)) {
    const pts = drawn[0].pts;
    let pv = -Infinity, pd = null, best = null, top = pts[0];
    for (const p of pts) {
      if (p.value > pv) { pv = p.value; pd = p.date; }
      if (p.value > top.value) top = p;
      const depth = pv - p.value;
      if (depth > 0 && (!best || depth > best.depth)) best = { depth, tv: p.value, td: p.date, pv, pd };
    }
    if (dd && best) {
      marks = [
        { kind: 'peak', d: best.pd, v: best.pv, text: `Peak ${small(best.pv)} · ${short(best.pd)}` },
        { kind: 'trough', d: best.td, v: best.tv, text: `${small(-best.depth)} · ${short(best.td)}` },
      ];
    } else if (markPeaks && top) {
      marks = [{ kind: 'peak', d: top.date, v: top.value, text: `Peak ${small(top.value)} · ${short(top.date)}` }];
    }
    marks = marks.map((m) => ({ ...m, x: m.d === pts[0].date ? X0 : x(m.d), y: y(m.v) }));
  }

  // The fill: under the top line on show, clipped at zero.
  const fillOf = fill ? (drawn.find((g) => g.l.key === 'total' || g.l.key === 'balance') || drawn.find((g) => !g.l.straight)) : null;
  const fillPath = fillOf ? `${path(fillOf.f, lineStyle)} L${W},${f2(base)} L${X0},${f2(base)} Z` : null;

  const label = (v) => tick(v, ax.step);
  const aria = `${what}, ${fmtDate(start)} to ${fmtDate(end)}: ` + shown.map((l) => `${l.label} ${l.has ? money(l.end) : 'none'}`).join(', ')
    + (ax.step ? `; gridlines every ${label(ax.step)} from ${label(ax.lo)} to ${label(ax.hi)}` : '')
    + marks.map((m) => `; ${m.text}`).join('');

  // The pointer: the day under it, within the data's span.
  const read = (e) => {
    const el = plotRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const xu = ((e.clientX - r.left) / r.width) * W;
    if (xu < X0 - 10 && e.pointerType === 'mouse') { setHover(null); return; }
    const ms = t0 + Math.max(0, Math.min(1, (xu - X0) / (W - X0))) * (t1 - t0);
    const day = Math.floor(Math.max(tStart, Math.min(t1, ms)) / DAY) * DAY;
    setHover((h) => (h === day ? h : day));
  };
  const handlers = {
    onPointerMove: (e) => { if (e.pointerType !== 'touch' || drag.current) read(e); },
    onPointerDown: (e) => {
      if (e.pointerType === 'touch') { drag.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* gone */ } }
      read(e);
    },
    onPointerUp: (e) => { if (e.pointerType === 'touch') { drag.current = false; setHover(null); } },
    onPointerCancel: () => { drag.current = false; setHover(null); },
    onPointerLeave: (e) => { if (e.pointerType !== 'touch') setHover(null); },
  };
  const dots = [];
  for (const g of drawn) {
    if (hover != null) dots.push({ key: 'h' + g.l.key, x: nowX, y: y(valueAt(g.l, hover)), c: g.l.key });
    else {
      if (!g.l.straight && g.pts.length - 1 <= DOTS_MAX) g.pts.slice(1).forEach((p, i) => dots.push({ key: `e${g.l.key}${i}`, x: x(p.date), y: y(p.value), c: g.l.key, small: true }));
      if (endDots) { const last = g.v[g.v.length - 1]; dots.push({ key: 'z' + g.l.key, x: last[0], y: last[1], c: g.l.key }); }
    }
  }

  return (
    <div className={'bd-chart-block' + (busy ? ' is-busy' : '')} aria-busy={busy ? 'true' : undefined}>
      {head}
      {legend}
      {noteLine}
      <div className={'bd-chart' + (hover != null ? ' is-reading' : '')} ref={plotRef} {...handlers}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={aria}
          data-lo={ax.lo} data-hi={ax.hi} data-step={ax.step} data-x0={X0} data-start={start}
          data-t1={new Date(t1).toISOString().slice(0, 10)}>
          <defs>
            <clipPath id={`bd-above-${uid}`}><rect x="0" y={-H} width={W} height={H + base} /></clipPath>
            <clipPath id={`bd-below-${uid}`}><rect x="0" y={base} width={W} height={H * 2} /></clipPath>
          </defs>
          {grid.filter((g) => g.v !== 0).map((g) => (
            <line key={'g' + g.v} x1={X0} y1={g.k * (H / ROWS)} x2={W} y2={g.k * (H / ROWS)} className="bd-grid" vectorEffect="non-scaling-stroke" />
          ))}
          {edges.map((ex) => <line key={'m' + ex} x1={ex} y1={0} x2={ex} y2={H} className="bd-grid" vectorEffect="non-scaling-stroke" />)}
          {fillPath && <path d={fillPath} className="bd-area is-pos" clipPath={`url(#bd-above-${uid})`} />}
          {fillPath && <path d={fillPath} className="bd-area is-neg" clipPath={`url(#bd-below-${uid})`} />}
          {dd && <path d={dd.area} className="bd-dd" />}
          {grid.filter((g) => g.v === 0).map((g) => (
            <line key="zero" x1={X0} y1={g.k * (H / ROWS)} x2={W} y2={g.k * (H / ROWS)} className="bd-zero" vectorEffect="non-scaling-stroke" />
          ))}
          {dd && <path d={dd.peak} className="bd-peak" vectorEffect="non-scaling-stroke" />}
          {drawn.map(({ l, v }) => (
            <path key={'l' + l.key} d={l.straight ? 'M' + v.map((p) => `${f2(p[0])},${f2(p[1])}`).join(' L') : path(v, lineStyle)}
              data-series={l.key} data-end={l.end}
              className={`bd-line bd-c-${l.key}` + (l.key === 'total' && drawn.length > 1 ? ' bd-under' : '') + (l.straight ? ' is-dashed' : '')}
              vectorEffect="non-scaling-stroke" />
          ))}
          {nowX != null && <line x1={nowX} y1={0} x2={nowX} y2={H} className="bd-cursor" vectorEffect="non-scaling-stroke" />}
        </svg>
        {grid.map((g) => (
          <span key={'t' + g.v} className={'an-cell an-note bd-tick' + (g.v === 0 ? ' is-zero' : '')} style={{ '--k': g.k }} aria-hidden="true">{label(g.v)}</span>
        ))}
        {dots.map((d) => (
          <i key={d.key} className={`bd-dot bd-c-${d.c}` + (d.small ? ' is-small' : '')} aria-hidden="true" style={{ left: gx(d.x), top: ry(d.y) }} />
        ))}
        {hover == null && marks.map((m) => {
          const right = m.x > W * 0.6;
          // Above the peak, below the trough; a label that would leave the plot box goes to the other side.
          const above = m.kind === 'peak' ? m.y / 10 >= 0.5 : m.y / 10 > ROWS - 2.5;
          return (
            <React.Fragment key={m.kind}>
              <i className={'bd-dot bd-mark-dot is-' + m.kind} aria-hidden="true" style={{ left: gx(m.x), top: ry(m.y) }} />
              <span className={'an-cell an-note bd-mark is-' + m.kind + (right ? ' is-right' : '')} aria-hidden="true"
                style={{ [right ? 'right' : 'left']: right ? gx(W - m.x + 5) : gx(m.x + 5), top: ry(m.y, above ? -2.5 : 0.5) }}>{m.text}</span>
            </React.Fragment>
          );
        })}
      </div>
      {foot}
    </div>
  );
}
