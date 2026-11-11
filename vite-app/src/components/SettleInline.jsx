import React, { useState } from 'react';
import { parseMoney, formatMoney } from '../utils/money.js';
import { partCents, usd } from '../utils/backer-settle.js';
import './settle-inline.css';

/* The Settled handshake's controls, in the card, on both sides (the backer's page, the owner's Backers
   card): UX picks 74, 75 and 79.
     - Where it stands, in words, on its own full-width line above the buttons ("Tap Settled once you
       have sent Ethan $573."). It was cut to "Once you have se…" in a 9g cell beside them.
     - Settled asks in the card: the question, then Yes / Cancel. It was the browser's confirm dialog.
     - Partial payment opens an amount field and Mark paid in the card, with a line saying what the
       field read ("Reads $1,200.00 of $7,349") or why it cannot be read. It was the browser's prompt,
       and its reading dropped every non-digit: "1.2k" was $1.20.
   view: utils/backer-settle.js settleView. onSend({ part, settleCents }) does the press. btnClass is
   each side's own button style; primary decides which button, if any, is the filled one. */
/* steps (Bankroll design 52): a half-confirmed settlement as two steps in press order, [{ label, done }], drawn
   in the status line's place, the button at the row's end beside the step it completes or undoes. */
export default function SettleInline({ view, busy = false, onSend, btnClass, primary = (v) => !!(v.button && v.button.primary), steps = null }) {
  const [mode, setMode] = useState(null);           // null | 'confirm' | 'part'
  const [text, setText] = useState('');
  if (!view) return null;
  const close = () => { setMode(null); setText(''); };
  const max = view.part ? usd(view.part.maxCents) : '';
  const read = mode === 'part' && text.trim() ? parseMoney(text) : null;
  const cents = read && !read.error ? partCents(text, view.part.maxCents) : null;
  const echo = !read ? `Dollars, up to ${max}.`
    : read.error ? read.error + '.'
      : cents == null ? (read.value > 0 ? `More than the ${max} balance.` : 'Type an amount over $0.')
        : `Reads ${formatMoney(read.value).replace(/^(\$[\d,]+)$/, '$1.00')} of ${max}.`;
  const say = view.button && view.button.label === 'Settled' && view.status
    ? 'Tap Settled ' + view.status.charAt(0).toLowerCase() + view.status.slice(1) + '.'
    : view.status;
  const btn = (extra = '') => btnClass + (extra ? ' ' + extra : '');
  return (
    <div className={'si' + (steps && mode === null ? ' has-steps' : '')}>
      {mode === null && steps && (
        <ol className="si-steps" aria-label="Both sides confirm">
          {steps.map((s, i) => (
            <li key={i} className={'si-step' + (s.done ? ' is-done' : '')}>
              <i className="si-pip" aria-hidden="true">{s.done ? '✓' : ''}</i>
              <span className="si-step-l">{s.label}{s.done ? '' : ' to confirm'}</span>
            </li>
          ))}
        </ol>
      )}
      {mode === null && !steps && say && <p className="si-say">{say}</p>}
      {mode === 'confirm' && <p className="si-say si-ask">{view.confirm}</p>}
      {mode === 'part' && (
        <>
          <p className="si-say si-ask">{view.part.prompt}</p>
          <div className="si-row">
            <input className="si-amount" type="text" inputMode="decimal" autoFocus value={text} aria-label="Amount paid"
              placeholder={'up to ' + max} aria-invalid={read && (read.error || cents == null) ? true : undefined}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && cents != null && !busy) { onSend({ part: true, settleCents: cents }); close(); } else if (e.key === 'Escape') close(); }} />
            <button type="button" className={btn('si-mark is-primary')} disabled={busy || cents == null}
              onClick={() => { onSend({ part: true, settleCents: cents }); close(); }}><span>Mark paid</span></button>
          </div>
          <p className={'si-say' + (read && (read.error || cents == null) ? ' is-bad' : '')} role="status">{echo}</p>
        </>
      )}
      <div className="si-row">
        {mode === null && view.button && (
          <button type="button" className={btn(primary(view) ? 'is-primary' : '')} disabled={busy}
            onClick={() => (view.confirm ? setMode('confirm') : onSend({ part: false }))}><span>{view.button.label}</span></button>
        )}
        {mode === null && view.part && (
          <button type="button" className={btn()} disabled={busy} onClick={() => setMode('part')}><span>{view.part.label}</span></button>
        )}
        {mode === 'confirm' && (
          <>
            <button type="button" className={btn('is-primary')} disabled={busy}
              onClick={() => { onSend({ part: false }); close(); }}><span>{view.button.label === 'Confirm' ? 'Confirm' : 'Yes, settled'}</span></button>
            <button type="button" className={btn()} onClick={close}><span>Cancel</span></button>
          </>
        )}
        {mode === 'part' && <button type="button" className={btn()} onClick={close}><span>Cancel</span></button>}
      </div>
    </div>
  );
}
