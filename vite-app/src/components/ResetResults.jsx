// Results > Delete results. Moved off the home (2026-10-11), where one inline confirm wiped every
// result in every bankroll, imported history included. Here it deletes only what the Results tab
// is showing (the bankroll switcher's selection; everyone outside the bankrolls beta has one
// pot), says exactly how many and from where, and asks for the count to be typed back:
// "DELETE 214 RESULTS". The server holds it to that count (?expect=) — see utils/reset-results.js
// and DELETE /api/tracking in server.js.
import React, { useState, useEffect, useId } from 'react';
import { resetPhrase, phraseMatches, resetSummary } from '../utils/reset-results.js';
import './reset-results.css';

/**
 * count     how many results the reset would delete (the tab's filtered list)
 * imported  how many of them came from a CSV import
 * scope     resetScope(...) for the tab's selection
 * onReset   (scope, count) => Promise<boolean>   true when they were deleted
 */
export default function ResetResults({ count, imported = 0, scope, onReset }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const phrase = resetPhrase(count);
  const ok = phraseMatches(typed, phrase);

  // A different count (a result logged meanwhile, a 409 from the server) is a different phrase:
  // whatever was typed for the old number no longer confirms anything.
  useEffect(() => { setTyped(''); }, [count, scope.key]);

  const submit = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    let done = false;
    try { done = await onReset(scope, count); } finally { setBusy(false); }
    if (done) { setOpen(false); setTyped(''); }
  };

  return (
    <section className="rr" aria-labelledby={id + '-t'}>
      <h3 id={id + '-t'} className="rr-cell rr-title">Delete results</h3>
      <p className="rr-p" id={id + '-d'}>{resetSummary(count, scope, imported)}</p>
      {!open ? (
        <div className="rr-actions">
          <button type="button" className="bk-btn bk-btn--danger rr-w14" onClick={() => setOpen(true)} aria-describedby={id + '-d'}>
            <span>Delete results…</span>
          </button>
        </div>
      ) : (
        <form className="rr-form" onSubmit={submit}>
          <label className="rr-cell rr-label" htmlFor={id + '-i'}>
            Type <b>{phrase}</b> to confirm
          </label>
          <input
            id={id + '-i'}
            className="rr-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="done"
            aria-describedby={id + '-d'}
          />
          <div className="rr-actions">
            <button type="submit" className="bk-btn bk-btn--danger rr-w14" disabled={!ok || busy}>
              <span>{`Delete ${count.toLocaleString('en-US')} result${count === 1 ? '' : 's'}`}</span>
            </button>
            <button type="button" className="bk-btn bk-w6" onClick={() => { setOpen(false); setTyped(''); }}>
              <span>Cancel</span>
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
