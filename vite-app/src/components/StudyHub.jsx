import React, { lazy, Suspense } from 'react';
import { useSolverAvailability, offered } from './StudyHead.jsx';
import './study-hub.css';
import { studyTags } from '../utils/study-tags.js';
import { getVariantStrip } from '../utils/utils.js';

/*
 * Hands > Study (owner, 2026-11-04: one training experience). Every solver tool used to be its own chip in the
 * Hands row, under names like Solver Trainer beside Trainer. They are one list now, leading with Play a hand,
 * and each opens under the same header (StudyHead.jsx). App.jsx holds which tool is open, so the replayer's
 * "Solve this spot" and "Study this draw" can open one directly.
 */

const RazzTrainerView = lazy(() => import('./RazzTrainerView.jsx'));
const SolverTrainerView = lazy(() => import('./SolverTrainerView.jsx'));
const Multiway3TrainerView = lazy(() => import('./Multiway3TrainerView.jsx'));
const SolverPlayView = lazy(() => import('./SolverPlayView.jsx'));
const SolverView = lazy(() => import('./SolverView.jsx'));
const DrawStudyView = lazy(() => import('./DrawStudyView.jsx'));
const RangesView = lazy(() => import('./RangesView.jsx'));
// The look-ups that need no solver (Features 34, 35).
const DealCalculatorView = lazy(() => import('./StudyLookups.jsx').then((m) => ({ default: m.DealCalculatorView })));
const OddsView = lazy(() => import('./StudyLookups.jsx').then((m) => ({ default: m.OddsView })));

const T = (b, lh) => (lh ? { '--hs-b': b, '--hs-lh': lh } : { '--hs-b': b });

export const STUDY_GROUPS = [
  ['Practice', [
    ['play', 'Play a hand', 'A full hand on the table against the solver, graded when it ends.'],
    ['hands', 'Hand trainer', 'Full hands with a running score and your biggest leaks.'],
    ['spots', 'Quick spots', 'One decision at a time, then what the solver does there.'],
    ['three-way', 'Three-way Razz', 'Razz against two opponents playing a fixed strategy.'],
  ]],
  ['Look up', [
    ['watch', 'Watch the solver', 'It plays both seats, and says why at each decision.'],
    ['solve', 'Solve a spot', 'Set up a Razz or Stud 8 spot and get the exact answer.'],
    ['draw', 'Price a draw', 'Every bet and every discard at one decision, priced.'],
    ['ranges', 'Pre-draw ranges', 'Which hands to open, limp, 3-bet and 4-bet in 2-7 triple draw.'],
    ['odds', 'Odds', 'Type the hands and the board, in any board or stud game.'],
    ['deal', 'Deal calculator', 'ICM and chip-chop figures for a final table.'],
  ]],
];

export default function StudyHub({ tool, onTool, onPlayHand, fallback, pendingSolverSpot, onConsumeSolverSpot, pendingDrawSpot, onConsumeDrawSpot }) {
  const avail = useSolverAvailability();
  const back = () => onTool(null);
  const open = (id) => { if (id === 'play') onPlayHand(); else onTool(id); };

  if (tool) {
    return (
      <Suspense fallback={fallback}>
        {tool === 'hands' && <RazzTrainerView onBack={back} />}
        {tool === 'spots' && <SolverTrainerView onBack={back} />}
        {tool === 'three-way' && <Multiway3TrainerView onBack={back} />}
        {tool === 'watch' && <SolverPlayView onBack={back} />}
        {tool === 'solve' && <SolverView onBack={back} pendingSpot={pendingSolverSpot} onConsumeSpot={onConsumeSolverSpot} />}
        {tool === 'draw' && <DrawStudyView onBack={back} pendingSpot={pendingDrawSpot} onConsumeSpot={onConsumeDrawSpot} />}
        {tool === 'ranges' && <RangesView onBack={back} />}
        {tool === 'odds' && <OddsView onBack={back} />}
        {tool === 'deal' && <DealCalculatorView onBack={back} />}
      </Suspense>
    );
  }

  return (
    <div className="hs-view study-hub">
      {STUDY_GROUPS.map(([group, items]) => (
        <section key={group} className="study-group" aria-label={group}>
          <h2 className="hs-t hs-cap" style={T(3, 2)}>{group}</h2>
          {items.filter(([id]) => id !== 'three-way' || offered(avail, 'razz3')).map(([id, name, note]) => (
            <button key={id} type="button" className="hs-btn hs-left hs-row study-row" onClick={() => open(id)} style={{ '--hs-h': 8 }}>
              <span className="hs-t hs-sm hs-bold hs-clip" style={T(3)}>{name}</span>
              <span className="hs-t hs-xs hs-mut hs-clip" style={T(2)}>{note}</span>
              {/* The games it covers (UX pick 72), coloured as the saved list's strips. */}
              {studyTags(id, avail).length > 0 && (
                <span className="study-tags" aria-label={'Games: ' + studyTags(id, avail).map((t) => t.label).join(', ')}>
                  {studyTags(id, avail).map((t) => (
                    <span key={t.id} className="study-tag" style={{ background: getVariantStrip(t.gameType).color }}>{t.label}</span>
                  ))}
                </span>
              )}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
