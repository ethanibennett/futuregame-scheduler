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

const isNative = () => {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
  catch (_) { return false; }
};

/* A saved row's time: SQLite's created_at is UTC without a zone ('2026-10-13 18:30:05'). */
export function playedAtOf(row) {
  const s = row && row.created_at;
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/* The hand a list row holds: the list endpoint spreads hand_data into the row,
   and the oldest saves wrapped it once more under .handData. */
export function handOfRow(row) {
  if (!row) return null;
  if (row.handData && typeof row.handData === 'object' && !Array.isArray(row.streets)) return row.handData;
  return row;
}

export function singleHandFileName(handId) {
  return 'futuregame-hand-' + handId + '.txt';
}

/* futuregame-hands-YYYY-MM-DD.txt, the local date. */
export function handsFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return 'futuregame-hands-' + now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate()) + '.txt';
}

/* Write and deliver. Built synchronously before anything is awaited, so iOS
   still counts the tap as the user activation navigator.share needs.
   entries: [{ hand, playedAt }]. Resolves to { result, filename, written, skipped }
   where result is 'shared' | 'downloaded' | 'cancelled'. */
export function exportHandHistory(entries, { heroName, filename } = {}) {
  const r = writePokerStarsFile(entries, { heroName });
  const name = filename || (r.written.length === 1 && entries.length === 1 ? singleHandFileName(r.written[0].handId) : handsFileName());
  const blob = new Blob([r.text], { type: 'text/plain;charset=utf-8' });
  const done = shareOrDownloadBlob(blob, name, 'text/plain', { mode: isNative() ? 'share' : 'download' });
  return done.then(result => ({ result, filename: name, written: r.written, skipped: r.skipped }));
}
