import React, { useEffect, useState } from 'react';

/* The header subtitle on the schedule views: the season's date range and the app's name,
   alternating with a crossfade. Both labels sit in the SAME grid cell and only their
   opacity changes, so the line never shifts and each baseline stays where the single
   label's was (styles.css, .top-bar-alt). The swap is skipped when the page is hidden. */
const HOLD_MS = 4000;

export default function AlternatingSubtitle({ labels }) {
  const list = (labels || []).filter(Boolean);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (list.length < 2) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setI(n => (n + 1) % list.length);
    }, HOLD_MS);
    return () => clearInterval(id);
  }, [list.length]);
  if (!list.length) return null;
  const shown = i % list.length;
  return (
    <small className="top-bar-alt" aria-live="off">
      {list.map((l, k) => (
        <span key={k} className={'top-bar-alt-label' + (k === shown ? ' is-shown' : '')} aria-hidden={k === shown ? undefined : 'true'}>{l}</span>
      ))}
    </small>
  );
}
