import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { portalTarget } from '../utils/grid-panel.js';
import useInkBalance from '../hooks/useInkBalance.js';
import { balanceInkX } from '../utils/ink-balance.js';
import {
  DIMENSIONS, DATE_PRESETS, optionsFor, facetCounts, rangeCounts, yearOptions, toggle, setRange, activeCount, applyFilters, clearAll,
} from '../utils/bankroll-filters.js';

/**
 * The bankroll Reports filter sheet — BETA, app admins. A full-height sheet over the dashboard,
 * portalled where the dashboard portals (the app root, under the admin grid overlay).
 *
 * Every section is a grid of chips, each "label count": the count is FACETED (what tapping it
 * would leave, under every other filter; utils/bankroll-filters.js facetCounts). A chip that would
 * leave nothing is disabled unless it is already on, so it can still be turned off. Filters apply
 * as they are tapped; Clear empties them all, Done closes.
 *
 * Layout (37g sheet, 35g content): the head is the dashboard's 8r bar — title, Clear 8g on 19g,
 * Done 8g on 28g, both 4r on 2r. Sections 2r apart: a 3r title, 1r, then chips 4r tall with 1r
 * between rows, in 4 x 8g, 3 x 11g or 2 x 17g columns (1g gaps, 35g).
 */

// Columns per section, by the kind of label (Bankroll design 44): names two to a row (bankrolls, rooms), games
// three, short ladders four (cash stakes) or three (buy-in bands, "$300–799"), the rest as they were.
const COLS = { types: 3, bankrolls: 2, games: 3, stakes: 4, buyins: 3, rooms: 2, formats: 2, weekdays: 4, dayparts: 4 };
// "Stakes / buy-in" reads as two ladders, each rising left to right: the cash stakes (cs:) and the
// tournament buy-in bands (bi:). One filter underneath; only the drawing is split.
const PARTS = { stakes: [['stakes', 'Cash stakes', (o) => String(o.key).startsWith('cs:')], ['buyins', 'Buy-in', (o) => String(o.key).startsWith('bi:')]] };

export function Chip({ on, n, disabled, onClick, children }) {
  // The name and its count centred on their ink, not their advances (utils/ink-balance.js).
  const ref = useRef(null);
  useInkBalance(ref, [typeof children === 'object' ? '' : String(children), n], balanceInkX);
  return (
    <button type="button" ref={ref} className={'br-chip ctl' + (on ? ' is-on' : '')} aria-pressed={on} disabled={disabled} onClick={onClick}>
      <span className="br-opt-name">{children}</span>
      {n != null && <span className="br-opt-n">{n}</span>}
    </button>
  );
}

export default function BankrollFilters({ facts, filters, onChange, onClose, today, names }) {
  const doneRef = useRef(null);
  useEffect(() => {
    doneRef.current && doneRef.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const years = useMemo(() => yearOptions(facts), [facts]);
  const ranges = useMemo(() => [...DATE_PRESETS, ...years], [years]);
  const rCounts = useMemo(() => rangeCounts(facts, filters, today, ranges), [facts, filters, today, ranges]);
  const matching = useMemo(() => applyFilters(facts, filters, today).length, [facts, filters, today]);
  const active = activeCount(filters);

  const sections = DIMENSIONS.map((d) => {
    const opts = optionsFor(facts, d.key, { selected: filters[d.key], names });
    if (!opts.length) return null;
    // A dimension with a single value everywhere filters nothing; leave it out unless it is on.
    if (opts.length < 2 && !(filters[d.key] || []).length && d.key !== 'types') return null;
    const counts = facetCounts(facts, filters, d.key, today);
    const chip = (o) => {
      const on = (filters[d.key] || []).includes(o.key);
      const n = counts[o.key] || 0;
      return (
        <Chip key={o.key} on={on} n={n} disabled={!on && n === 0}
          onClick={() => onChange(toggle(filters, d.key, o.key))}>{o.label}</Chip>
      );
    };
    const parts = (PARTS[d.key] || [[d.key, d.label, () => true]]).map(([k, label, has]) => [k, label, opts.filter(has)]).filter((p) => p[2].length);
    return parts.map(([k, label, list]) => (
      <section key={k} className="br-fsec" aria-labelledby={`br-f-${k}`}>
        <h3 className="an-cell an-sec" id={`br-f-${k}`}>{label}</h3>
        <div className={`br-grid br-grid-${COLS[k]}`} role="group" aria-labelledby={`br-f-${k}`}>
          {list.map(chip)}
        </div>
      </section>
    ));
  });

  return createPortal(
    <>
      <div className="an-scrim br-fscrim" onClick={onClose} />
      <div className="an-sheet br-fsheet" role="dialog" aria-modal="true" aria-labelledby="br-f-title">
        <header className="an-head">
          <h2 className="an-title-row br-ftitle" id="br-f-title"><span className="an-cell an-title snap-g">Filters</span></h2>
          <button type="button" className="bk-btn bk-w8 br-fclear" disabled={!active} onClick={() => onChange(clearAll())}>
            <span>Clear all</span>
          </button>
          <button ref={doneRef} type="button" className="bk-btn bk-btn--brand bk-w8 br-fdone" onClick={onClose}><span>Done</span></button>
        </header>
        <div className="an-body">
          <p className="an-p br-fcount" aria-live="polite">
            <strong>{matching.toLocaleString()}</strong> of {facts.length.toLocaleString()} results, sessions and expenses match.
          </p>
          <section className="br-fsec" aria-labelledby="br-f-range">
            <h3 className="an-cell an-sec" id="br-f-range">Dates</h3>
            <div className="br-grid br-grid-4" role="radiogroup" aria-labelledby="br-f-range">
              {ranges.map((r) => (
                <Chip key={r.key} on={filters.range === r.key} n={rCounts[r.key]} disabled={filters.range !== r.key && !rCounts[r.key]}
                  onClick={() => onChange(setRange(filters, r.key))}>{r.label}</Chip>
              ))}
            </div>
          </section>
          {sections}
        </div>
      </div>
    </>,
    portalTarget(),
  );
}

