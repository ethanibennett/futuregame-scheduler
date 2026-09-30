import React from 'react';

// Shared playing-card for the solver views. Renders the same card-face
// SVGs the Hand Replayer uses (/cards/cards_gui_<rank><suit>.svg) so the
// solver shows hands graphically and consistently with the replayer.
// Card strings match the asset names directly: 'Ah' -> cards_gui_Ah.svg.
//
// Grid: sized by .hs-card-* in styles.css — sm 2g × 4r, md 3g × 6r, lg 4g × 8r
// (whole g wide, whole r tall; 0.704 against the artwork's 0.714). Raised stud
// upcards lift 2r (.hs-card-raised). No px anywhere.

export default function SolverCard({ str, faceDown, dim, size = 'md', raised }) {
  const cls = 'hs-card hs-card-' + (size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : 'md') +
    (raised ? ' hs-card-raised' : '') + (dim ? ' hs-card-dim' : '');

  if (faceDown || !str) return <span className={'card-back ' + cls} />;

  return <img className={'card-img ' + cls} src={`/cards/cards_gui_${str}.svg`} alt={str} loading="eager" />;
}
