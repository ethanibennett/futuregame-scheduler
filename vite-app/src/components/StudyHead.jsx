import React, { useEffect, useState } from 'react';
import { fetchApi } from '../utils/api.js';

/*
 * What every Study tool shares (owner, 2026-11-04: one training experience; StudyHub.jsx is the way in): the
 * header, the game pills, and which games this server can really deal.
 */

/** An .hs-t text block's style: b r tall to its baseline, lh r for each further line. */
export const T = (b, lh) => (lh ? { '--hs-b': b, '--hs-lh': lh } : { '--hs-b': b });
/** n subrows (r) as a CSS length. */
export const R = (n) => `calc(var(--subrow) * ${n})`;

/** Back to Study, the tool's name, and one sentence on what it does. */
export function StudyHead({ title, note, onBack }) {
  return (
    <div className="study-head">
      <div className="study-head-row">
        {onBack && (
          <button type="button" className="hs-btn" onClick={onBack} style={{ '--hs-h': 4, padding: 0 }}>
            <span className="hs-t" style={T(3)}>Back</span>
          </button>
        )}
        <h2 className="screen-title hs-t hs-title" style={T(3)}>{title}</h2>
      </div>
      {note && <p className="hs-t hs-xs hs-mut" style={{ ...T(2, 2), marginTop: 'var(--subrow)' }}>{note}</p>}
    </div>
  );
}

/** A game pill's style: one look for "selected" across every Study tool. */
export function studyPill(active, disabled) {
  return {
    '--hs-h': 4, padding: 0, fontSize: 'var(--fs-xs)',
    fontWeight: active ? 'var(--fw-bold)' : 'var(--fw-semibold, 600)', letterSpacing: '0.04em',
    '--hs-edge': active ? 'var(--text)' : 'var(--border)',
    '--hs-fill': active ? 'var(--text)' : 'transparent',
    '--hs-ink': active ? 'var(--bg)' : 'var(--text-muted)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled && !active ? 0.5 : 1,
  };
}

/** One game name everywhere: the solver's list says "2-7 Triple Draw", the pills say "2-7 TD". */
export function shortGameName(name) {
  return String(name || '').replace(/\s*Triple Draw$/, ' TD').replace(/\s*or Better$/, '');
}

/** The row of game pills. games: [[id, label]]. */
export function StudyPills({ games, value, onPick, disabled, style }) {
  return (
    <div className="hs-cols" style={{ '--hs-n': 4, marginTop: 'calc(var(--subrow) * 2)', ...style }}>
      {games.map(([id, label]) => (
        <button key={id} type="button" className="hs-btn hs-pill" aria-pressed={id === value}
          onClick={() => onPick(id)} disabled={disabled} style={studyPill(id === value, disabled)}>
          <span className="hs-t" style={T(3)}>{label}</span>
        </button>
      ))}
    </div>
  );
}

// GET /api/solver/availability: which blueprints are on this server's disk. Asked once a session, and an
// unanswered ask offers everything, each game's own 503 still saying so.
let asked = null;
function askAvailability() {
  if (!asked) {
    asked = fetchApi('/solver/availability').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return asked;
}

/** { [gameId]: boolean, razz3: boolean }, or null until it is known. A game it does not name is offered. */
export function useSolverAvailability() {
  const [avail, setAvail] = useState(null);
  useEffect(() => {
    let on = true;
    askAvailability().then((a) => { if (on) setAvail(a || {}); });
    return () => { on = false; };
  }, []);
  return avail;
}

export const offered = (avail, id) => !avail || avail[id] !== false;
