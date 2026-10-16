import React, { useEffect, useRef, useState } from 'react';
import { stepGeometry, fmtSignedCents, fmtShort } from '../utils/backer-page.js';
import './analytics.css';
import './backer-chart.css';

/** The graph's range: N whole-g segments across 35g, one on (backer-page.js rangeOptions). */
export function RangeStrip({ options, value, onChange }) {
  return (
    <div className="bp-seg" data-n={options.length} role="radiogroup" aria-label="Range">
      {options.map(([k, text]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k}
          className={value === k ? 'is-on' : ''} onClick={() => onChange(k)}>
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * A backer's share over time (BackerPage.jsx): their running total from the window's start, one
 * step per session in date order. Drawn in ResultsCurve's language, sized as BankrollChart is:
 *
 *   - A STEP line, never a diagonal: results are discrete, so the total holds until a session
 *     moves it. Each session's step sits in the middle of its slice of the width, which reads the
 *     same for one session (a single step) as for two hundred.
 *   - The baseline is where the window starts: the opening balance (or $0) for every session, the
 *     total carried in for a shorter range. The area between it and the line is filled, --pos-quiet
 *     above and --neg-quiet below, so a run is read as distance from where it began.
 *   - The last point is a dot in its tone. It is an element over the plot rather than an SVG
 *     circle: the plot stretches (preserveAspectRatio none) and a circle would stretch with it.
 *   - No text inside the plot: every label sits in a whole-r row above or below it, seated on its
 *     line (the head row and the foot row; analytics.css an-cell).
 *
 *   - Tap, drag or hover across the plot to read one session (owner, 2026-10-14): the head row then
 *     names it (date · game) and shows its result, and a hairline and a dot mark its step. The
 *     arrow keys do the same; Escape, a tap elsewhere or the pointer leaving puts the range back.
 *
 * The SVG's units are the grid's: x in g (35, the content width), y in r (the plot's height), so
 * the dot is placed in g and r with no conversion.
 */
const W = 35;
const H = 16;

export default function BackerChart({ series, label, today, baseNote = 'start', control = null }) {
  const thisYear = today ? Number(String(today).slice(0, 4)) : null;
  const plotRef = useRef(null);
  const [sel, setSel] = useState(null);   // the index of the session being read, or null
  useEffect(() => { setSel(null); }, [series]);
  // A tap anywhere else lets go of the session.
  useEffect(() => {
    if (sel == null) return undefined;
    const off = (ev) => { if (plotRef.current && !plotRef.current.contains(ev.target)) setSel(null); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [sel]);
  if (!series) return null;
  const n = series.points.length;
  const pick = (ev) => {
    const box = plotRef.current && plotRef.current.getBoundingClientRect();
    if (!box || !box.width) return;
    setSel(Math.min(n - 1, Math.max(0, Math.floor(((ev.clientX - box.left) / box.width) * n))));
  };
  const onKey = (ev) => {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      const step = ev.key === 'ArrowLeft' ? -1 : 1;
      setSel((i) => (i == null ? (step < 0 ? n - 1 : 0) : Math.min(n - 1, Math.max(0, i + step))));
    } else if (ev.key === 'Escape') setSel(null);
  };
  const geo = stepGeometry(series, { w: W, h: H, inset: 1 });
  const d = geo.line.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(3)},${y.toFixed(3)}`).join(' ');
  // Close the area along the baseline.
  const area = `${d} L${W},${geo.baseY.toFixed(3)} L0,${geo.baseY.toFixed(3)} Z`;
  const up = series.change > 0 ? 'is-pos' : series.change < 0 ? 'is-neg' : '';
  const [dx, dy] = geo.last;
  const p = sel != null ? series.points[sel] : null;
  // The step's top: the line's vertex after the session's jump (stepGeometry pushes two per session).
  const [sx, sy] = p ? geo.line[2 + 2 * sel] : [0, 0];
  const pTone = p ? (p.share > 0 ? 'is-pos' : p.share < 0 ? 'is-neg' : '') : '';
  const aria = `${label}: from ${fmtSignedCents(series.start)} on ${fmtShort(series.first, thisYear)} to ${fmtSignedCents(series.end)} `
    + `on ${fmtShort(series.last, thisYear)}, over ${series.n} ${series.n === 1 ? 'session' : 'sessions'}; `
    + `high ${fmtSignedCents(series.hi)}, low ${fmtSignedCents(series.lo)}`;

  return (
    <div className="bp-chart-block">
      <div className="bp-chart-head">
        {p ? (
          <>
            <span className="an-cell an-sec an-clip">{fmtShort(p.date, thisYear)} · {p.game || 'Session'}</span>
            <span className={'an-cell an-val bp-chart-change ' + pTone}>{fmtSignedCents(p.share)}</span>
          </>
        ) : (
          <>
            <span className="an-cell an-sec an-clip">{label}</span>
            <span className={'an-cell an-val bp-chart-change ' + up}>{fmtSignedCents(series.change)}</span>
          </>
        )}
      </div>
      <div className="bp-chart" ref={plotRef} tabIndex={0}
        aria-label={`${label}: tap or use the arrow keys to read each session`}
        onPointerDown={pick} onPointerMove={(ev) => { if (ev.pointerType === 'mouse' || ev.buttons) pick(ev); }}
        onPointerLeave={(ev) => { if (ev.pointerType === 'mouse') setSel(null); }}
        onKeyDown={onKey}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={aria}>
          <defs>
            <clipPath id="bp-above"><rect x="0" y="0" width={W} height={geo.baseY} /></clipPath>
            <clipPath id="bp-below"><rect x="0" y={geo.baseY} width={W} height={H - geo.baseY} /></clipPath>
          </defs>
          <path d={area} className="bp-fill-pos" clipPath="url(#bp-above)" />
          <path d={area} className="bp-fill-neg" clipPath="url(#bp-below)" />
          <line x1="0" y1={geo.baseY} x2={W} y2={geo.baseY} className="bp-base" vectorEffect="non-scaling-stroke" />
          <path d={d} className="bp-line" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className={'bp-dot ' + up} aria-hidden="true"
          style={{ left: `calc(var(--gu) * ${dx.toFixed(4)})`, top: `calc(var(--subrow) * ${dy.toFixed(4)})` }} />
        {p && (
          <>
            <span className="bp-mark" aria-hidden="true" style={{ left: `calc(var(--gu) * ${sx.toFixed(4)})` }} />
            <span className={'bp-dot ' + pTone} aria-hidden="true"
              style={{ left: `calc(var(--gu) * ${sx.toFixed(4)})`, top: `calc(var(--subrow) * ${sy.toFixed(4)})` }} />
          </>
        )}
      </div>
      <div className="bp-chart-foot">
        <span className="an-cell an-note an-clip">{fmtShort(series.first, thisYear)} · {baseNote} {fmtSignedCents(series.start)}</span>
        <span className="an-cell an-note an-num an-clip">{fmtShort(series.last, thisYear)} · now {fmtSignedCents(series.end)}</span>
      </div>
      {control}
    </div>
  );
}
