import React, { useState } from 'react';
import { parseMoney, moneyEcho } from '../utils/money.js';

/* A money input (UX pick 73): a drop-in for <input type="number"> on an amount. It is a text field
   with the decimal keypad, so "$1,200", "1.2k" and "12,50" can be typed, and no spinner steps the
   dollars. Each reading goes to onChange as the plain number ("1200"), the way a number field's value
   did, so a form's own state and submit are unchanged; empty text sends ''. While the field has the
   focus it keeps what was typed and shows, 1g in from its right edge, what that read as ("= $1,200")
   whenever it is not simply the number, or, in the danger colour, why it cannot be read. Leaving the
   field puts the last good reading back. */
export default function MoneyField({ value, onChange, allowNegative = false, sym = '$', onFocus, onBlur, ...rest }) {
  const [text, setText] = useState(null);
  const shown = text != null ? text : (value == null ? '' : String(value));
  const r = text != null && text.trim() !== '' ? parseMoney(text, { allowNegative }) : null;
  const echo = r && !r.error ? moneyEcho(text, r.value, sym) : null;
  const send = (v) => { if (onChange) onChange({ target: { value: v } }); };
  return (
    <span className={'money-field' + (r && r.error ? ' is-invalid' : '')}>
      <input {...rest} type="text" inputMode="decimal" value={shown}
        aria-invalid={r && r.error ? true : undefined}
        onFocus={(e) => { setText(shown); if (onFocus) onFocus(e); }}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (t.trim() === '') { send(''); return; }
          const p = parseMoney(t, { allowNegative });
          if (!p.error) send(String(p.value));
        }}
        onBlur={(e) => { setText(null); if (onBlur) onBlur(e); }} />
      {echo && <span className="money-echo" aria-hidden="true">{'= ' + echo}</span>}
      {r && r.error && <span className="money-echo is-bad" role="alert">{r.error}</span>}
    </span>
  );
}
