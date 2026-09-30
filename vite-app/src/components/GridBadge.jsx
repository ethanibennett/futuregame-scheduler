import React, { useLayoutEffect, useRef, useState } from 'react';

// A 3r caps badge whose WIDTH is a whole number of g. Its label is text, so its
// natural width is arbitrary; this measures the label once (after the web
// fonts are in) and sets width = ceil(label / g) + 2g — 1g of padding a side.
// Every font size in the app is a multiple of g, so the label's width IN g does
// not change with the screen width and one measurement holds at every size.
//
// Used by the Hands › Trainer / 3-Way views (.hs-view). Border: `dashed` draws
// an inset outline instead of the inset box-shadow, so neither adds size.
//   <GridBadge edge="var(--accent)" ink="var(--accent)">true GTO</GridBadge>
export default function GridBadge({ children, edge = 'var(--border)', ink = 'var(--text-muted)', bg = 'transparent', dashed = false, title }) {
  const ref = useRef(null);
  const [n, setN] = useState(null);
  const text = typeof children === 'string' ? children : null;

  useLayoutEffect(() => {
    let alive = true;
    const measure = () => {
      const el = ref.current;
      if (!el || !alive) return;
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:calc(var(--gu) * 100);height:0';
      el.appendChild(probe);
      const G = probe.getBoundingClientRect().width / 100;
      probe.remove();
      const label = el.firstChild;
      if (!label || !G) return;
      const range = document.createRange();
      range.selectNodeContents(label);
      const w = range.getBoundingClientRect().width / G;
      // 0.02g slack so a label that is a hair over a whole g by float noise does not jump a whole g.
      setN(Math.ceil(w - 0.02) + 2);
    };
    measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    return () => { alive = false; };
  }, [text, children]);

  return (
    <span ref={ref} className="hs-gbadge" title={title} style={{
      '--hs-edge': edge, '--hs-ink': ink, '--hs-bg': bg,
      width: n ? `calc(var(--gu) * ${n})` : undefined,
      ...(dashed ? { boxShadow: 'none', outline: `var(--bw-hair) dashed ${edge}`, outlineOffset: 'calc(var(--bw-hair) * -1)' } : null),
    }}>
      <span className="hs-t" style={{ '--hs-b': 2 }}>{children}</span>
    </span>
  );
}
