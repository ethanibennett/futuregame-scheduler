// ── A saved hand's title when none was typed (UX pick 69; the format, owner, 2026-11-22) ──────────
// "NLH Hand", ten times over, told the saved list nothing. A blank title is built from the hand:
//   [game] | [pot type] | [MTT or Cash] | [stakes]        2-7 TD | SRP | Cash | $40/$80
// No cards and no suits (owner, 2026-11-22: "take out the suits altogether"; the row's card thumbnails
// already show the hero's hand). The pot type is read off the first street's raises: Walk, Limped,
// SRP (one raise), 3BP, 4BP, 5BP. A stud hand's completion counts as its raise, the bring-in does not.
// A tournament's blinds are written short (1K/2K, compactChips) so the title fits the row (owner, 2026-11-22).
// The stakes are the caller's formatter (the felt's and the row's, formatStakes in HandReplayerView),
// so they read the same everywhere. Pure, for the list, the entry's placeholder and the save alike.

const isStudGame = (g) => /stud|razz/i.test(g || '') && !/^(Five|5) Card/i.test(g || '');

const handOf = (hand) => (hand && hand.handData && !hand.streets ? hand.handData : hand);

/** Tournament chips the way the title writes them (owner, 2026-11-22: "1k/2k is also fine", so a long title fits the
 *  row): 300, 1K, 1.5K, 25K, 1.2M. Up to two decimals, none trailing. */
export function compactChips(v) {
  const n = Number(v) || 0;
  const trim = (x) => String(Math.round(x * 100) / 100);
  if (Math.abs(n) >= 1e6) return trim(n / 1e6) + 'M';
  if (Math.abs(n) >= 1e3) return trim(n / 1e3) + 'K';
  return trim(n);
}

/** The pot type off the first street: 'Walk', 'Limped', 'SRP', '3BP', '4BP', '5BP', or '' with no actions.
 *  An all-in counts as a raise only where it puts in more than the bet it faces (an all-in call is a call). */
export function potType(hand) {
  const h = handOf(hand);
  if (!h || !Array.isArray(h.streets) || !h.streets.length) return '';
  const actions = ((h.streets[0] || {}).actions || []).filter(Boolean);
  if (!actions.length) return '';
  const b = h.blinds || {};
  const stud = isStudGame(h.gameType);
  // What each player has in on this street (the amounts are what each action added), and the bet to match.
  const inFor = new Map();
  if (!stud) (h.players || []).forEach((p, i) => {
    const pos = String((p && p.position) || '').toUpperCase();
    if (pos === 'SB') inFor.set(i, Number(b.sb) || 0);
    if (pos === 'BB') inFor.set(i, Number(b.bb) || 0);
  });
  let level = stud ? 0 : Math.max(Number(b.bb) || 0, ...inFor.values());
  let raises = 0, inPlay = 0, folds = 0;
  for (const a of actions) {
    const who = a.player != null ? a.player : a.playerIdx;
    const after = (inFor.get(who) || 0) + (Number(a.amount) || 0);
    if (a.action === 'fold') { folds++; continue; }
    if (a.action === 'check') continue;
    inPlay++;
    if (a.action === 'raise' || a.action === 'bet' || (a.action === 'all-in' && after > level + 1e-9)) raises++;
    level = Math.max(level, after);
    inFor.set(who, after);
  }
  const players = (h.players || []).length;
  if (!inPlay && players > 1 && folds === players - 1) return 'Walk';
  if (!raises) return inPlay ? 'Limped' : '';
  if (raises === 1) return 'SRP';
  return Math.min(raises + 1, 5) + 'BP';
}

/** The default title for a hand, or '' when it has too little to say anything.
 *  opts.stakes: (hand) => the stakes as the app writes them ("$40/$80", "3,000/6,000/(6,000)"). */
export function autoTitle(hand, opts = {}) {
  const h = handOf(hand);
  if (!h || !Array.isArray(h.streets) || !h.streets.length) return '';
  const parts = [];
  if (h.gameType) parts.push(String(h.gameType));
  const pot = potType(h);
  if (pot) parts.push(pot);
  parts.push(h.gameMode === 'cash' ? 'Cash' : 'MTT');
  const stakes = typeof opts.stakes === 'function' ? opts.stakes(h) : '';
  if (stakes) parts.push(stakes);
  return parts.length > 1 ? parts.join(' | ') : '';
}

/* A title the app made rather than the player, in either form it has had: today's ("2-7 TD | SRP | Cash |
   $40/$80") and the one saved until 2026-11-22, cards with their suits ("6♦5♣4♠2♠6♣ · v 8♥7♦… · Raised pot ·
   K♠7♦2♣"). Read off the text, not by rebuilding it, so a hand edited since it was saved still counts. */
const CARDS = '(?:[2-9TJQKA][♠♥♦♣])+';
const OLD_PART = new RegExp(`^(?:${CARDS}|v ${CARDS}(?: & ${CARDS})*|Walk|Limped pot|Raised pot|\\d-bet pot)$`);
const NEW_FORM = /^[^|]+ \| (?:(?:Walk|Limped(?: pot)?|SRP|\dBP) \| )?(?:MTT|Cash)(?: \| [^|]+)?$/;   // "Limped pot" for the hour it was saved so
export function isBuiltTitle(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  if (NEW_FORM.test(s)) return true;
  return /[♠♥♦♣]/.test(s) && s.split(' · ').every((p) => OLD_PART.test(p));
}

/** What the list shows: the typed title, or the built one where the saved title is blank, the old
 *  "<game> Hand" default, or a title the app built (isBuiltTitle). */
export function displayTitle(row, opts = {}) {
  const t = (row && row.title) || '';
  const g = (row && row.gameType) || '';
  if (t && t !== g + ' Hand' && !isBuiltTitle(t)) return t;
  return autoTitle(row, opts) || (isBuiltTitle(t) ? '' : t) || 'Untitled';
}
