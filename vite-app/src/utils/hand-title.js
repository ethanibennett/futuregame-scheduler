// ── A saved hand's title when none was typed (UX pick 69) ───────────────────
// "NLH Hand", ten times over, told the saved list nothing: the rows could be told apart only by
// their card thumbnails. A blank title is built from the hand instead: the hero's cards, "v" and the
// cards an opponent showed, the pot type from the preflop raises (limped, raised, 3-bet, 4-bet), and
// the flop. A♠K♦ · v Q♥Q♣ · 3-bet pot · K♠7♦2♣. Stud names the door cards (the up card each player
// was dealt on 3rd street); a draw hand names the hero's dealt hand. Pure, for the list, the entry's
// placeholder and the save alike.

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const cardsIn = (text) => {
  const out = [];
  const s = String(text || '').replace(/\s+/g, '');
  for (let i = 0; i + 1 < s.length; i += 2) {
    const r = s[i].toUpperCase(), su = s[i + 1].toLowerCase();
    if ('23456789TJQKA'.includes(r) && SUIT[su]) out.push(r + SUIT[su]);
  }
  return out;
};
const isStudGame = (g) => /stud|razz/i.test(g || '') && !/^(Five|5) Card/i.test(g || '');
const isDrawGame = (h) => (h.streets || []).some((st) => /Draw/.test(st.name || '')) || /draw|badugi|badacy|badeucy|archie|dramadugi/i.test(h.gameType || '');

/** The default title for a hand, or '' when it has too little to say anything. */
export function autoTitle(hand) {
  const h = hand && hand.handData && !hand.streets ? hand.handData : hand;
  if (!h || !Array.isArray(h.streets) || !h.streets.length) return '';
  const heroIdx = h.heroIdx != null ? h.heroIdx : 0;
  const parts = [];
  const first = h.streets[0] || {};
  const stud = isStudGame(h.gameType);
  if (stud) {
    // The hero's three on 3rd street, the third being the door card.
    const mine = cardsIn((first.cards || {}).hero);
    if (mine.length) parts.push(mine.slice(0, 3).join(''));
  } else {
    const mine = cardsIn((first.cards || {}).hero);
    if (mine.length) parts.push(mine.join(''));
  }
  // An opponent's shown cards: the latest street that carries them.
  for (let si = h.streets.length - 1; si >= 0; si--) {
    const opps = ((h.streets[si] || {}).cards || {}).opponents || [];
    const shown = opps.map((o) => (o && String(o).toUpperCase() !== 'MUCK' ? cardsIn(o) : [])).filter((c) => c.length);
    if (shown.length) { parts.push('v ' + shown.map((c) => c.join('')).join(' & ')); break; }
  }
  if (!stud) {
    const acts = (first.actions || []).filter((a) => a && a.action !== 'fold' && a.action !== 'check');
    const raises = acts.filter((a) => a.action === 'raise' || a.action === 'bet' || a.action === 'all-in').length;
    const folds = (first.actions || []).filter((a) => a && a.action === 'fold').length;
    const players = (h.players || []).length;
    if (!acts.length && players > 1 && folds === players - 1) parts.push('Walk');
    else if (raises === 0 && acts.length) parts.push('Limped pot');
    else if (raises === 1) parts.push('Raised pot');
    else if (raises >= 2) parts.push(Math.min(raises + 1, 5) + '-bet pot');
  }
  if (!stud && !isDrawGame(h)) {
    const flop = cardsIn(((h.streets[1] || {}).cards || {}).board);
    if (flop.length >= 3) parts.push(flop.slice(0, 3).join(''));
  }
  return parts.join(' · ');
}

/** What the list shows: the typed title, or the built one where the saved title is blank or the old
 *  "<game> Hand" default. */
export function displayTitle(row) {
  const t = (row && row.title) || '';
  const g = (row && row.gameType) || '';
  if (t && t !== g + ' Hand') return t;
  return autoTitle(row) || t || 'Untitled';
}
