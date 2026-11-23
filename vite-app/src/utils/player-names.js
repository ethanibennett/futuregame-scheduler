/* Names for the entry's seats (owner, 2026-11-23: "an autopopulate function for the name fields in the hand
 * replayer entry screen"). Pure, Node-testable.
 *
 * The names come from the account's own saved hands: every player named there, its spelling as last written,
 * how often it was seen and how recently. A seat's suggestions are those names, minus anyone already at the
 * table; typed letters narrow them (the whole name, then any word of it, then the initials, then anywhere).
 *
 * The table's order is remembered too: a hand's players are stored in seat order, so the name after Chino Rheem
 * in the last hand he played is likely the one after him now. A seat next to a named one leads with that
 * player, and `restOfTable` fills every unnamed seat after a named one the same way.
 */

// The names the entry gives a seat nobody named: Hero, Opp 3, Seat 4, Player 2, You.
const DEFAULT_RE = /^(hero|you|opp(onent)?\s*\d*|seat\s*\d+|player\s*\d+|p\d+|villain\s*\d*)$/i;
// Position labels a hand may carry as a name (an import with no names).
const POSITION_RE = /^(btn|bu|button|sb|bb|utg(\+?\d)?|ep\d?|mp\d?|lj|hj|co|d)$/i;

export function nameKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isDefaultName(name) {
  const t = String(name || '').trim();
  return !t || DEFAULT_RE.test(t) || POSITION_RE.test(t);
}

/* The book of names: { names: Map(key -> { name, count, last, pos }), tables: [[name, ...], ...] }, `last` being
   the index of the newest hand it was seen in (0 = the newest) and `pos` its seat there, `tables` every hand's seat
   order, newest first.
   `hands` is the saved-hands list as the server sends it, newest first. */
export function nameBook(hands) {
  const names = new Map();
  const tables = [];
  (Array.isArray(hands) ? hands : []).forEach((h, idx) => {
    const players = h && Array.isArray(h.players) ? h.players : [];
    const seats = players.map((p) => String((p && p.name) || '').trim());
    tables.push(seats);
    const seen = new Set();
    seats.forEach((name, pos) => {
      if (isDefaultName(name)) return;
      const key = nameKey(name);
      if (seen.has(key)) return;
      seen.add(key);
      const had = names.get(key);
      if (had) had.count += 1;
      else names.set(key, { name, count: 1, last: idx, pos });
    });
  });
  return { names, tables };
}

// The newest hand with this name in it, preferring one with as many players as the table now has.
function tableWith(book, key, size) {
  let any = null;
  for (const seats of book.tables) {
    const j = seats.findIndex((s) => nameKey(s) === key);
    if (j < 0 || seats.length < 3) continue;
    if (seats.length === size) return { seats, j };
    if (!any) any = { seats, j };
  }
  return any;
}

/* Who the table's order puts at `seat`: from the nearest named seat, k seats away (before it on a tie), the player
   k seats from that name in its newest hand. `players` is the hand's seats as entered. Returns a name or null. */
export function predictSeat(book, players, seat) {
  const n = players.length;
  const taken = new Set(players.map((p) => nameKey(p && p.name)));
  const from = (dir) => {
    for (let k = 1; k < n; k++) {
      const at = ((seat - dir * k) % n + n) % n;
      const name = players[at] && players[at].name;
      if (isDefaultName(name)) continue;
      const found = tableWith(book, nameKey(name), n);
      if (!found || k >= found.seats.length) return { k, guess: null };
      const { seats, j } = found;
      const guess = seats[((j + dir * k) % seats.length + seats.length) % seats.length];
      return { k, guess: isDefaultName(guess) || taken.has(nameKey(guess)) ? null : guess };
    }
    return { k: n, guess: null };
  };
  const before = from(1), after = from(-1);
  const [near, far] = after.k < before.k ? [after, before] : [before, after];
  return near.guess || far.guess || null;
}

function matchTier(key, q) {
  if (!q) return 0;
  if (key.startsWith(q)) return 0;
  const words = key.split(/[\s.\-']+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 1;
  if (q.length >= 2 && !q.includes(' ') && words.map((w) => w[0]).join('').startsWith(q)) return 2;
  if (q.length >= 3 && key.includes(q)) return 3;
  return -1;
}

/* The pro list (scripts/build-pro-names.mjs, data/pro-names.json): names in rank order, most results first, each
   with its key and its words' keys, made once. */
export function proIndex(names) {
  return (Array.isArray(names) ? names : []).map((name) => {
    const key = nameKey(name);
    return { name, key, words: key.split(/[\s.\-']+/).filter(Boolean) };
  });
}

/* The names to offer at `seat`: `query` is what the field holds (a default name counts as nothing typed).
   Anyone seated elsewhere is left out, and so is a name the field already holds exactly.
   Your own names come first. The pro list (`pros`, from proIndex) is searched only once two letters are typed, by
   the whole name or a word of it, in its rank order; your names that match only by initials or inside a word come
   after it. */
export function nameSuggestions(book, { players = [], seat = 0, query = '', limit = 4, pros = null } = {}) {
  const q = isDefaultName(query) ? '' : nameKey(query);
  const taken = new Set(players.map((p, i) => (i === seat ? '' : nameKey(p && p.name))).filter(Boolean));
  const predicted = q ? null : predictSeat(book, players, seat);
  const predictedKey = predicted ? nameKey(predicted) : '';
  const rows = [];
  for (const [key, entry] of book.names) {
    if (taken.has(key) || (q && key === q)) continue;
    const tier = matchTier(key, q);
    if (tier < 0) continue;
    rows.push({ ...entry, key, tier, lead: key === predictedKey ? 0 : 1 });
  }
  rows.sort((a, b) => a.lead - b.lead || a.tier - b.tier
    || (q ? b.count - a.count || a.last - b.last : a.last - b.last || a.pos - b.pos)
    || a.name.localeCompare(b.name));
  const strong = rows.filter((r) => r.tier <= 1), weak = rows.filter((r) => r.tier > 1);
  const out = strong.slice(0, limit).map((r) => r.name);
  if (pros && q.length >= 2 && out.length < limit) {
    const have = new Set([...taken, ...rows.map((r) => r.key), q]);
    const whole = [], word = [];
    for (const pro of pros) {
      if (have.has(pro.key)) continue;
      if (pro.key.startsWith(q)) whole.push(pro.name);
      else if (word.length < limit && pro.words.some((w) => w.startsWith(q))) word.push(pro.name);
      if (whole.length >= limit) break;
    }
    out.push(...[...whole, ...word].slice(0, limit - out.length));
  }
  out.push(...weak.slice(0, Math.max(0, limit - out.length)).map((r) => r.name));
  return out;
}

/* Every unnamed seat after the named seat before `seat`, filled in that player's newest hand's order: a list of
   { seat, name }. Only where the order agrees with the table as entered: a named seat holding someone else than
   that hand had there, or a name from it seated elsewhere, means another table, and nothing is filled. The hero's
   seat is never filled. Empty when there are fewer than two seats to fill. */
export function restOfTable(book, players, seat, { hero = -1 } = {}) {
  const n = players.length;
  const named = (i) => !isDefaultName(players[i] && players[i].name);
  let anchor = -1;
  for (let k = 1; k < n; k++) {
    const at = ((seat - k) % n + n) % n;
    if (named(at)) { anchor = at; break; }
  }
  if (anchor < 0) return [];
  const found = tableWith(book, nameKey(players[anchor].name), n);
  if (!found) return [];
  const { seats, j } = found;
  const seatOf = new Map(players.map((p, i) => [nameKey(p && p.name), i]));
  const out = [];
  for (let k = 1; k < Math.min(n, seats.length); k++) {
    const at = (anchor + k) % n;
    const name = seats[(j + k) % seats.length];
    const key = nameKey(name);
    if (named(at)) {
      if (!isDefaultName(name) && key !== nameKey(players[at].name)) return [];
      continue;
    }
    if (isDefaultName(name)) continue;
    if (seatOf.has(key)) return [];
    if (at === hero) continue;
    out.push({ seat: at, name });
  }
  return out.length >= 2 ? out : [];
}
