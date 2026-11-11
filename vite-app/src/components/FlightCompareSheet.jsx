import React from 'react';
import { createPortal } from 'react-dom';
import useBackToClose from '../hooks/useBackToClose.js';
import { flightLetter, clashWith } from '../utils/flights.js';
import { normaliseDate, formatBuyin } from '../utils/utils.js';

/* Compare a multi-flight event's flights (Features 2, 2026-11-11): one row per Day 1 flight with its day and
   start, level length and late reg, a tag for the one saved (and its bullets) or the saved event it clashes
   with, and Save. With a flight saved, a later one offers "If I bust A, play C": the plan My Schedule already
   keeps (schedule_conditions), so the second flight goes on only if the first one busts. */
export default function FlightCompareSheet({ group, mySchedule = [], onToggle, onSetCondition, onClose }) {
  useBackToClose(true, onClose);
  const savedIds = new Set((mySchedule || []).map((t) => t.id));
  const saved = group.flights.filter((f) => savedIds.has(f.id));
  const first = saved[0] || null;
  const day = (t) => {
    const d = normaliseDate(t.date);
    return d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : t.date;
  };
  const f0 = group.flights[0];
  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet flt-sheet" role="dialog" aria-label="Compare flights">
        <h3>{group.base}</h3>
        <p className="flt-sub">{[
          f0.starting_chips ? `${Number(f0.starting_chips).toLocaleString('en-US')} stack` : null,
          f0.reentry ? `re-entry: ${f0.reentry}` : null,
          formatBuyin(f0.buyin, f0.venue),
          group.dayTwo ? `Day 2 ${day(group.dayTwo)}` : null,
        ].filter(Boolean).join(' · ')}</p>
        {group.flights.map((f) => {
          const isSaved = savedIds.has(f.id);
          const clash = isSaved ? null : clashWith(f, mySchedule);
          const later = first && !isSaved && new Date(f.date) >= new Date(first.date) && f.id !== first.id;
          const me = (mySchedule || []).find((t) => t.id === f.id);
          return (
            <div key={f.id} className={'flt-row' + (isSaved ? ' is-saved' : '')}>
              <span className="flt-letter">{flightLetter(f)}</span>
              <span className="flt-main">
                <span className="flt-when">{`${day(f)} · ${f.time || 'TBD'}`}</span>
                <span className="flt-meta">{[f.level_duration ? `${String(f.level_duration).replace(/\D+$/, '')}-min levels` : null, f.late_reg_end ? `late reg ${f.late_reg_end}` : null].filter(Boolean).join(' · ') || ' '}</span>
                {isSaved && <span className="flt-tag is-saved">{`Saved${me && me.planned_entries > 1 ? ` · ${me.planned_entries} bullets` : ''}`}</span>}
                {clash && <span className="flt-tag is-clash">{`Overlaps · ${clash.event_name} ${clash.time || ''}`}</span>}
              </span>
              <span className="flt-acts">
                {later && onSetCondition && (
                  <button type="button" className="btn btn-ghost ctl flt-btn" onClick={() => { onToggle && !isSaved && onToggle(f); onSetCondition(f.id, [{ type: 'IF_BUST', dependsOnId: first.id }], true); onClose(); }}>
                    <span>{`If I bust ${flightLetter(first)}`}</span>
                  </button>
                )}
                {!later && onToggle && (
                  <button type="button" className={'btn ctl flt-btn' + (isSaved ? ' btn-ghost' : ' btn-primary')} onClick={() => onToggle(f)}>
                    <span>{isSaved ? 'Remove' : 'Save'}</span>
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </>,
    document.body,
  );
}
