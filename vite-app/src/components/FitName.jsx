import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * A person's name in the room its box gives it, the house order (owner): the full name, then first
 * initial and last name ("E. Bennett"), then the last name alone, and only then a cut with an
 * ellipsis. Measured against the rendered box, never a character budget: real names run 0.40-0.50
 * of the font size per character, and a count refused forms that fit.
 *
 * The span takes its width from its parent (min-width 0, overflow hidden, one line); a form fits when
 * the span's content is no wider than the span. Re-measured when the name or the box's width changes.
 */
export function nameForms(name) {
  const t = String(name || '').trim();
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [t];
  const last = parts[parts.length - 1];
  // Only a name shaped like a person's ("Opp 1" stays whole).
  if (!/^[A-Za-z][A-Za-z'’-]*$/.test(last)) return [t];
  return [t, parts[0][0].toUpperCase() + '. ' + last, last];
}

export default function FitName({ name, className = '', style = null }) {
  const ref = useRef(null);
  const forms = nameForms(name);
  const [i, setI] = useState(0);
  const [w, setW] = useState(0);
  // The box's width: a narrower header (or a wider one) starts the search again from the full name.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => { setI(0); }, [name, w]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth + 0.5 && i < forms.length - 1) setI(i + 1);
  });
  return (
    <span ref={ref} className={className} title={forms[0]}
      style={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(style || {}) }}>
      {forms[Math.min(i, forms.length - 1)]}
    </span>
  );
}
