// ── Hand history: handing the text to the user (UI only) ─────────────────────
// File names and delivery for the export actions in HandReplayerView.jsx. Not
// imported by the tests: it touches the DOM through export.js.
//
// Delivery: the native app (iOS, Android, Mac Catalyst) opens the share sheet —
// there is no Downloads folder to save into; every web browser downloads, even
// where Web Share exists (Windows Chrome's share dialog is not where a .txt
// for PokerTracker should go).

import { shareOrDownloadBlob } from '../export.js';
import { writePokerStarsFile } from './index.js';
import { singleHandFileName, handsFileName } from './rows.js';

export { playedAtOf, handOfRow, singleHandFileName, handsFileName } from './rows.js';

const isNative = () => {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
  catch (_) { return false; }
};

/* Write and deliver. Built synchronously before anything is awaited, so iOS
   still counts the tap as the user activation navigator.share needs.
   entries: [{ hand, playedAt }]. Resolves to { result, filename, written, skipped }
   where result is 'shared' | 'downloaded' | 'cancelled', or 'empty' when not one hand
   could be written (nothing is delivered then: a file of only a BOM helps no one). */
export function exportHandHistory(entries, { heroName, filename, shared } = {}) {
  const r = writePokerStarsFile(entries, { heroName, shared });
  if (!r.written.length) return Promise.resolve({ result: 'empty', filename: null, written: [], skipped: r.skipped });
  const name = filename || (r.written.length === 1 && entries.length === 1 ? singleHandFileName(r.written[0].handId) : handsFileName());
  const blob = new Blob([r.text], { type: 'text/plain;charset=utf-8' });
  const done = shareOrDownloadBlob(blob, name, 'text/plain', { mode: isNative() ? 'share' : 'download' });
  return done.then(result => ({ result, filename: name, written: r.written, skipped: r.skipped }));
}
