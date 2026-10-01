/* Numeric fields clear on focus, ready for a new number (Ethan, 2026-10-01).
 *
 * App-wide, by delegation, so every field qualifies without each one opting in: an
 * <input type="number">, or any input whose inputmode is numeric/decimal. Opt a field
 * out with data-no-clear.
 *
 * The clear is VISUAL only. React state is not touched until the person types, so an
 * accidental tap costs nothing: the old value shows as the placeholder while the field
 * is empty, and leaving without typing puts it back in the field (state never changed,
 * so nothing re-renders). Clearing state on focus instead would push a transient ''
 * through every stack/blind calculation that reads these fields.
 *
 * One trap: a re-render while the field sits untouched makes React write the old value
 * back (it resyncs a controlled input whose DOM value differs from state). So the FIRST
 * keystroke clears again before it lands — `beforeinput` fires before the browser
 * inserts the character — and typing "5" always yields 5, never "2005".
 *
 * If the person types and then deletes everything, the field is left empty: that was a
 * deliberate edit and state already says ''.
 */
const saved = new WeakMap();

function isNumericField(el) {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.readOnly || el.disabled || el.dataset.noClear !== undefined) return false;
  if (el.type === 'number') return true;
  const mode = el.inputMode || el.getAttribute('inputmode') || '';
  return el.type === 'text' || el.type === 'tel' || el.type === '' ? /^(numeric|decimal)$/i.test(mode) : false;
}

function onFocusIn(e) {
  const el = e.target;
  if (!isNumericField(el) || el.value === '') return;
  saved.set(el, { value: el.value, placeholder: el.getAttribute('placeholder'), typed: false });
  el.setAttribute('placeholder', el.value);
  el.value = '';
}

// The native setter, past React's own value tracker: React wraps the instance's `value`
// property to remember what it last saw, so a write through el.value makes the following
// input event look like no change and onChange never fires.
const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

function onBeforeInput(e) {
  const el = e.target;
  const s = saved.get(el);
  if (!s || s.typed) return;
  s.typed = true;
  if (el.value === '') return; // still clear: let the keystroke land normally
  // React put the old value back while the field sat untouched. Clearing it here and
  // letting the browser insert does not work — WebKit drops the pending insertion once
  // the value changes under it (measured: typing 7 left the field empty). So take the
  // edit over: the new value is just what was typed (or nothing, for a delete), written
  // past the tracker and announced the way a real keystroke is.
  e.preventDefault();
  const next = typeof e.data === 'string' && /^insert/.test(e.inputType || '') ? e.data : '';
  nativeValueSetter.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function onFocusOut(e) {
  const el = e.target;
  const s = saved.get(el);
  if (!s) return;
  saved.delete(el);
  if (s.placeholder == null) el.removeAttribute('placeholder');
  else el.setAttribute('placeholder', s.placeholder);
  if (!s.typed) el.value = s.value;
}

export function installNumericFocusClear() {
  if (typeof document === 'undefined' || document.__numericFocusClear) return;
  document.__numericFocusClear = true;
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('beforeinput', onBeforeInput, true);
  document.addEventListener('focusout', onFocusOut, true);
}
