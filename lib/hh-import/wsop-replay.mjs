// ── WSOP.com replay data: a placeholder ───────────────────────────────────────
// The WSOP.com client (PA / NJ / NV) keeps hands on WSOP's own servers and shows
// them in a replay viewer; it writes no hand-history files on the player's
// computer. The format of that replay data is unknown until the owner sends a
// sanitised HAR of the viewer loading a few hands (docs/hand-history-io.md
// section 9 says exactly what it must contain). Nothing here guesses it.
//
// detect() is false, so nothing is ever routed here automatically; only an
// explicit { site: 'wsop-replay' } reaches parse(), which refuses.

import { HandHistoryError } from './errors.mjs';

export const wsopReplay = {
  id: 'wsop-replay',
  label: 'WSOP.com replay',
  status: 'needs-sample',
  detect: () => false,
  parse() {
    throw new HandHistoryError('needs-sample', 'WSOP.com replay data needs a sample before it can be read.');
  },
};

export default wsopReplay;
