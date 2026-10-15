import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './short-deck-rule.css';

/**
 * The one Short Deck rule rooms disagree on (owner, 2026-10-15: "it is different on different sites
 * and venues"): does three of a kind beat a straight? Asked when Short Deck is chosen in the
 * replayer; the answer is stored on the hand (hand.tripsBeatStraight) so it replays, shares and
 * exports the way that room ranked it (utils/poker-engine.js gameEvalFor). The last answer is
 * preselected (per device).
 *
 * Layout: the shared 35g modal (styles.css .modal-content, snap-place), its h3 and p on whole-r
 * lines; two answers, each 31g x 5r with its label centred (.ctl), 1r apart.
 */
export default function ShortDeckRuleDialog({ value, onChoose, onClose }) {
  const first = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    if (first.current) first.current.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const opt = (v, label, note, ref) => (
    <button ref={ref} type="button" role="radio" aria-checked={value === v}
      className={'sdr-btn ctl' + (value === v ? ' is-on' : '')} onClick={() => onChoose(v)}>
      <span className="sdr-face"><span className="sdr-top">{label}</span><span className="sdr-sub">{note}</span></span>
    </button>
  );
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content snap-place sdr" role="dialog" aria-modal="true" aria-labelledby="sdr-t" onClick={(e) => e.stopPropagation()}>
        <h3 id="sdr-t">Short Deck: what beats what here?</h3>
        <p>Rooms rank one hand differently. Triton and GGPoker put three of a kind above a straight; many others keep the straight higher. The hand keeps your answer, so it replays the way this room ranked it.</p>
        <div className="sdr-choices" role="radiogroup" aria-labelledby="sdr-t">
          {opt(false, 'A straight beats trips', 'the usual ranking', value === false || value == null ? first : undefined)}
          {opt(true, 'Trips beat a straight', 'Triton, GGPoker', value === true ? first : undefined)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
