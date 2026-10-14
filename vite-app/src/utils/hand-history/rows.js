// ── Hand history: saved rows and file names (pure) ───────────────────────────
// What the export actions read off a saved hand's list row, and the names they
// give the files. Split from save.js (which touches the DOM through export.js,
// and so cannot load under Node) so the tests can hold them.

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

/* futuregame-hands-YYYY-MM-DD.txt, the local date; futuregame-hands-YYYY-MM-DD-all.txt for the
   every-game file, so the two exports of one day do not collide (the browser would rename the
   second to "(1)"). */
export function handsFileName(now = new Date(), suffix = '') {
  const p = (n) => String(n).padStart(2, '0');
  return 'futuregame-hands-' + now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate()) + (suffix ? '-' + suffix : '') + '.txt';
}
