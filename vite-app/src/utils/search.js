/* The Schedule's search, forgiving (Laws of UX pick 16, owner 2026-11-10). One matcher for the list and
   the Calendar: case, accents, curly quotes, hyphens and punctuation never decide a match; every word of
   the query must be found somewhere in the event (its name, number, game, series, room, the strip's
   abbreviation and long name), and a figure can be the buy-in ("$600", "1500", "1.5k").
   A few shorthands stand for what players type: omaha, holdem, 6max, hu, dtd.
   Pure: the venue lookup is passed in (utils.js getVenueInfo), so this runs under plain Node too. */

/** Lower case, no accents, no quotes or apostrophes, every other mark a space, single spaces. */
export function normaliseText(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’‚‛′'`´]/g, '')
    .replace(/[^a-z0-9$.]+/g, ' ')
    .replace(/(^|\s)\.+|\.+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// What a word may also be found as (each alternative is a phrase in the normalised haystack).
const ALIASES = {
  omaha: ['plo', 'o8', 'omaha'],
  holdem: ['nlh', 'hold em', 'holdem', 'lhe'],
  '6max': ['6 max', '6max', 'six max'],
  '9max': ['9 max', '9max'],
  '8max': ['8 max', '8max'],
  hu: ['heads up', 'hu'],
  dtd: ['dusk till dawn', 'dtd'],
  pko: ['bounty', 'pko'],
};

/** The query as words: each { text, alts, amount, dollar }. "hold em" is read as one word. */
export function searchTokens(query) {
  const q = normaliseText(query).replace(/\bhold em\b/g, 'holdem').replace(/\b(\d) max\b/g, '$1max');
  if (!q) return [];
  return q.split(' ').filter(Boolean).map((text) => {
    const m = /^(\$)?(\d+(?:\.\d+)?)(k)?$/.exec(text);
    const amount = m ? Math.round(Number(m[2]) * (m[3] ? 1000 : 1)) : null;
    const bare = text.replace(/^\$/, '');
    return { text: bare, alts: ALIASES[bare] || [bare], amount, dollar: !!(m && m[1]) };
  });
}

/** The words an event can be found by, normalised once per event (cached on the row). */
const HAY = new WeakMap();
export function haystackFor(t, venueInfo) {
  if (!t || typeof t !== 'object') return '';
  const hit = HAY.get(t);
  if (hit !== undefined) return hit;
  let v = null;
  try { v = venueInfo ? venueInfo(t.venue, t.property) : null; } catch { v = null; }
  const parts = [t.event_name, t.event_number, t.game_variant, t.venue, t.property,
    v && v.abbr, v && v.longName, t.notes && String(t.notes).length < 120 ? t.notes : null];
  const hay = ' ' + normaliseText(parts.filter(Boolean).join(' ')) + ' ';
  HAY.set(t, hay);
  return hay;
}

/** Whether the event answers every word of the query. An empty query matches everything. */
export function matchesSearch(t, tokens, venueInfo) {
  if (!tokens || !tokens.length) return true;
  const hay = haystackFor(t, venueInfo);
  const buyin = Number(t && t.buyin) || 0;
  return tokens.every((tok) => {
    if (tok.amount != null) {
      // "$600" is a buy-in; a bare figure of 3 digits or more may be one, or an event number or a word.
      if (tok.amount === buyin && (tok.dollar || tok.text.length >= 3 || /k$/.test(tok.text))) return true;
      if (tok.dollar) return false;
    }
    return tok.alts.some((a) => hay.includes(a.length <= 2 && !/\d/.test(a) ? ' ' + a : a));
  });
}
