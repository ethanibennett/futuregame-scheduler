// ── Hand-history import: the registry of site parsers ─────────────────────────
// A site parser is { id, label, detect(text) -> boolean, parse(text, { onError })
// -> Hand[] } where a Hand is the replayer's own hand object (the shape
// HandReplayerView.jsx saves, docs/quick-add-contract.md) plus an `import`
// block saying where it came from. To add a site: write its module beside these,
// export the parser, and list it in PARSERS (docs/hand-history-io.md section 8).
//
// Nothing mounts this yet. server.js, which is CommonJS, can later
//   const { parseHandHistory } = await import('./lib/hh-import/index.mjs');

import { pokerstars } from './pokerstars.mjs';
import { wsopReplay } from './wsop-replay.mjs';
import { HandHistoryError } from './errors.mjs';

export { HandHistoryError };
export const PARSERS = [pokerstars, wsopReplay];

export function getParser(id) {
  return PARSERS.find(p => p.id === id) || null;
}

/* The id of the first parser that recognises the text, or null. */
export function detectSite(text) {
  const s = typeof text === 'string' ? text : '';
  for (const p of PARSERS) {
    try { if (p.detect(s)) return p.id; } catch (_) { /* a detector never throws the caller */ }
  }
  return null;
}

/* Read a hand-history file. { site } forces a parser; otherwise it is detected.
   One hand that cannot be read does not stop the others: it is listed in
   `errors` ({ index, handId, code, message, excerpt }) and the rest returned.
   Throws HandHistoryError 'unknown-format' when no parser recognises the text,
   and propagates a parser's own refusal ('needs-sample'). */
export function parseHandHistory(text, { site } = {}) {
  const id = site || detectSite(text);
  if (!id) throw new HandHistoryError('unknown-format', 'This text is not a hand history format the app reads.');
  const parser = getParser(id);
  if (!parser) throw new HandHistoryError('unknown-format', 'No parser for ' + JSON.stringify(id) + '.');
  const errors = [];
  const hands = parser.parse(String(text == null ? '' : text), { onError: (e) => errors.push(e) });
  return { site: id, hands, errors };
}
