import React from 'react';

/**
 * One strategy ribbon, replacing five hand-rolled frequency bars.
 *
 * SolverView, SolverPlayView, SolverTrainerView, RazzTrainerView and
 * Multiway3TrainerView each rendered the same data — a probability simplex over
 * 2–4 actions — in a different visual grammar. They disagreed on track height
 * (16 / full-row / 9 / 8 / 7), on track colour (`--surface2` vs `--border` vs
 * `rgba(128,128,128,0.12)`), on fill colour (`--pos` for best vs
 * `rgba(74,158,255,0.20)` for chosen vs `--accent` for chosen), on label column
 * width (52 / 86 / 92 / none) and on what got highlighted at all. One of them
 * drew the UNCHOSEN actions in the muted-text grey — which is also the colour of
 * the label beside them.
 *
 * The important change is not consistency, it is form. Frequency over actions is
 * a PART-TO-WHOLE, and five separate bars asked the reader to sum them. A single
 * segmented track sums to 100% by construction, so a 70/30 mix looks like 70/30.
 *
 * Two encodings are kept deliberately separate:
 *   - each segment carries its ACTION's identity colour (--act-*), so the
 *     colour language matches the felt and the timeline;
 *   - the sampled action gets an inset ring INSIDE its own segment rather than a
 *     colour change, so highlighting cannot destroy that identity. The old bars
 *     recoloured the chosen action, which is why a 30%-frequency action could
 *     look more important than a 60% one.
 *
 * Per-action EV, where the caller has it, becomes a second diverging strip
 * centred on zero — the one thing none of the five renderings showed spatially,
 * and the number a trainer is actually grading.
 */

const ACT_ORDER = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

function actKey(id = '') {
  const s = String(id).toLowerCase();
  if (s.startsWith('f')) return 'fold';
  if (s.startsWith('x') || s.startsWith('ch')) return 'check';
  if (s.startsWith('c')) return 'call';
  if (s.startsWith('b')) return 'bet';
  if (s.startsWith('r')) return 'raise';
  if (s.includes('all')) return 'allin';
  return 'call';
}

export default function StrategyRibbon({
  actions = [],      // [{ id, label, prob (0..1 or 0..100), ev? }]
  chosen = null,     // id sampled / played
  best = null,       // id with the highest frequency or EV
  showEv = false,
}) {
  if (!actions.length) return null;

  const norm = actions.map(a => ({
    ...a,
    key: actKey(a.id || a.label),
    pct: Math.max(0, a.prob > 1 ? a.prob : a.prob * 100),
  }));
  const total = norm.reduce((s, a) => s + a.pct, 0) || 1;
  // Escalation order, so the ribbon always reads left-to-right the same way.
  norm.sort((a, b) => ACT_ORDER.indexOf(a.key) - ACT_ORDER.indexOf(b.key));

  const evs = norm.map(a => (typeof a.ev === 'number' ? a.ev : null)).filter(v => v !== null);
  const evMax = evs.length ? Math.max(...evs.map(Math.abs)) || 1 : 0;

  return (
    <div className="freq-ribbon">
      <div className="freq-ribbon-track" role="img"
        aria-label={norm.map(a => `${a.label} ${Math.round((a.pct / total) * 100)}%`).join(', ')}>
        {norm.map(a => {
          const w = (a.pct / total) * 100;
          const isChosen = chosen != null && a.id === chosen;
          return (
            <div
              key={a.id || a.label}
              className={'freq-seg' + (isChosen ? ' is-chosen' : '')}
              style={{ width: `${w}%`, background: `var(--act-${a.key})` }}
            >
              {/* Labels only where the segment can hold them; the rest drop to
                  the legend below rather than shrinking below legibility. */}
              {w >= 12 && <span className="freq-seg-pct">{Math.round(w)}%</span>}
            </div>
          );
        })}
      </div>

      {showEv && evs.length > 0 && (
        <div className="freq-ev" aria-hidden="true">
          {norm.map(a => {
            if (typeof a.ev !== 'number') return null;
            const half = (Math.abs(a.ev) / evMax) * 50;
            return (
              <span
                key={(a.id || a.label) + '-ev'}
                className={'freq-ev-bar ' + (a.ev >= 0 ? 'pos' : 'neg')}
                style={a.ev >= 0
                  ? { left: '50%', width: `${half}%` }
                  : { right: '50%', width: `${half}%` }}
              />
            );
          })}
        </div>
      )}

      <div className="freq-legend">
        {norm.map(a => {
          const w = (a.pct / total) * 100;
          const isBest = best != null && a.id === best;
          return (
            <span key={(a.id || a.label) + '-l'} className={'freq-legend-item' + (isBest ? ' is-best' : '')}>
              <i style={{ background: `var(--act-${a.key})` }} />
              {a.label}
              {w < 12 && <b>{Math.round(w)}%</b>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
