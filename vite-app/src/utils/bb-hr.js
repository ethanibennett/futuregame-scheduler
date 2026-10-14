// ── bb/hr: big blinds won per hour (cash games only) ──────────────────────────────────────
// Pure and dependency-free (runs under `node --test`, and on the public backer page, which loads
// no bankroll code). One definition for every surface that shows it: the bankroll Overview,
// Sessions, Locations, Reports and Cash stats, and the backer page with the owner's Backers tab.
// Definition, units and decisions: docs/bankrolls.md "bb/hr".
//
//   bb/hr = sum(session net ÷ that session's big blind) ÷ sum(hours)
//
// over cash sessions that have a known big blind and some hours. Each session is divided by its OWN
// big blind, so stakes combine fairly (a 1/2 night and a 5/10 night add up in blinds, not dollars);
// never an average blind. The net is the cash net the app already shows ($/h's numerator: after tips
// and session expenses), in the session's own currency, because the blind is written in it too —
// the count of blinds has no currency, so a EUR session needs no conversion.
//
// Two units, never added together (owner, 2026-10-14: "Big bets for limit, big blinds for big bet
// games"):
//   'bb'  big blinds    no-limit and pot-limit games          labelled "bb/hr"
//   'BB'  big bets      limit games (the BIG BET is the second number: 4/8 is 8)    "BB/hr"
// A figure that covers both kinds is two figures. Tournaments have no fixed blind and never get one.

export const UNIT_BB = 'bb';
export const UNIT_BIG_BET = 'BB';
export const UNITS = [UNIT_BB, UNIT_BIG_BET];
/** The label a unit's rate carries: "bb/hr" or "BB/hr". */
export const unitLabel = (unit) => (unit === UNIT_BIG_BET ? 'BB/hr' : 'bb/hr');

/** A session shorter than this has no per-session rate (a rate over minutes is noise), as the
 *  $/h of one session everywhere in the app. Aggregates take any positive length, as the Overview. */
export const MIN_SESSION_HOURS = 0.25;

const MINUS = '−'; // U+2212, plus-width in the app's faces so signed figures align (utils.js MINUS)

// ── The big blind ──────────────────────────────────────────────────────────────────────────
// A currency marker before a number: a symbol ($ € £ ¥ ...) with up to three letters stuck to it
// ("C$", "US$", "CHF"), or an ISO code with an optional space ("EUR 2/5").
const SYMBOLS = '$€£¥₹₩₪₽₺฿₫₱₴₦₡₲';
const CODES = 'usd|eur|gbp|cad|aud|nzd|chf|nok|sek|dkk|pln|czk|huf|mxn|brl|cny|rmb|jpy|inr|rub|try|ron|zar|sgd|hkd';
const CURRENCY_MARK = new RegExp(`[A-Za-z]{0,3}[${SYMBOLS}]|\\b(?:${CODES})(?=\\s*[\\d.])`, 'gi');
// One number: "5", "2.50", ".50", "1,000", "0,50" (a decimal comma), then an optional k ("5k").
const NUM = '(?:\\d{1,3}(?:,\\d{3})+(?!\\d)|\\d+)(?:[.,]\\d+)?|[.,]\\d+';
const AMOUNT = `(${NUM})(k(?![a-z]))?`;
const SEP = '\\s*[/\\-\\u2013\\u2014]\\s*';
// Two or three amounts joined by / or -, not glued to a word or number before them ("NL200" has
// one number and no group; "6-max" is not a group).
const GROUP = new RegExp(`(?<![\\w.,])${AMOUNT}${SEP}${AMOUNT}(?:${SEP}${AMOUNT})?`, 'i');

function amount(numText, k) {
  let t = String(numText);
  if (/^\d{1,3}(?:,\d{3})+$/.test(t)) t = t.replace(/,/g, '');   // 1,000 is a thousand ...
  else t = t.replace(',', '.');                                    // ... 0,50 is a half
  const v = Number(t) * (k ? 1000 : 1);
  return Number.isFinite(v) ? v : null;
}

/**
 * The big blind written in a stakes text, or null when there is none to read.
 *
 *   "1/2" "$2/$5" "2-5" "2 / 5" "5/10 NLH" "1/2 PLO" "25/50" "€2/€5" "£1/£2"  → the SECOND number
 *   "1/2/5" "1/3/5" "5/5/10"  a third number still leaves the second as the big blind (a straddle
 *                             or an ante is not a blind) — an owner question, docs/bankrolls.md
 *   "4/8" (limit)             the second number, the BIG BET (unit: unitOf)
 *   "0.25/0.50" ".50/1" "0,5/1" "1,000/2,000" "5k/10k"   decimals, a decimal comma, thousands
 *
 * null for no stakes, a single number ("NL200", "5"), a small blind above the big ("5/2"), a zero
 * ("0/0") or anything that is not text. Only the first group of numbers in the text is read.
 */
export function bigBlindOf(stakes) {
  if (typeof stakes !== 'string') return null;
  const s = stakes.replace(CURRENCY_MARK, ' ').replace(/\s+/g, ' ');
  const m = GROUP.exec(s);
  if (!m) return null;
  // Groups: [1] n1 [2] k1 [3] n2 [4] k2 [5] n3 [6] k3 (the third is read for nothing)
  const sb = amount(m[1], m[2]);
  const bb = amount(m[3], m[4]);
  if (sb == null || bb == null || !(sb > 0) || !(bb > 0) || sb > bb) return null;
  return bb;
}

// ── The betting structure, which sets the unit ─────────────────────────────────────────────
// A tournament has no fixed blind: its blinds climb. Text that says so is never a cash game.
const TOURNAMENT = /\b(?:mtt|tournaments?|sng|sit\s*(?:&|and|n|-)?\s*go|satellite|freezeout|bounty|pko|main event)\b/i;
// No-limit and pot-limit games (and a "cap" game, which is no-limit with a cap): NL, PL, NLH, PLO,
// PLO5, PLO6, PLO8, NL200, "no limit", "pot-limit", Big O.
const BIG_BET_GAME = /(?<![a-z])(?:nl[a-z0-9]*|plo[a-z0-9]*|pl\d*|no[\s-]?limit|pot[\s-]?limit|big[\s-]?o|cap)(?![a-z])/i;
// Limit games: LHE, FL, Fixed, Limit, Stud, Razz, O8 / Omaha 8 / Omaha hi-lo, HORSE, 8-game, Mixed,
// triple draw, badugi. (Checked after the above, so "no limit" and "pot limit" are not "limit".)
const LIMIT_GAME = /(?<![a-z])(?:lhe?|l\.h\.e|fl|fixed|limit|stud|razz|o\/?8|omaha[\s-]*(?:8|hi[\s/-]?lo|h\/l|eight)|horse|8[\s-]?game|mixed|triple[\s-]?draw|27td|badugi)(?![a-z])/i;

/**
 * The unit a cash session is measured in: 'bb' (big blinds: no-limit and pot-limit), 'BB' (big
 * bets: limit games, "Mixed" included unless its text says no-limit or pot-limit), or null for
 * text that says tournament. Judged on the session's own game and stakes text, so a mixed room
 * holds both kinds. No structure named (a bare "2/5") is a big-blind game: the app's default game
 * is NLH.
 */
export function unitOf(game, stakes) {
  const text = [game, stakes].filter((x) => typeof x === 'string' && x).join(' ');
  if (TOURNAMENT.test(text)) return null;
  if (BIG_BET_GAME.test(text)) return UNIT_BB;
  if (LIMIT_GAME.test(text)) return UNIT_BIG_BET;
  return UNIT_BB;
}

// ── One session ───────────────────────────────────────────────────────────────────────────
/**
 * One cash session in blinds: { unit, bigBlind, blinds (net ÷ big blind), hours } — or null when
 * it cannot be measured (no readable big blind, no net, no hours, or a tournament). Hours must be
 * positive; the per-session display floor is MIN_SESSION_HOURS (sessionBbHr).
 *   s: { game, stakes, net (the cash net in the session's own currency), hours }
 */
export function sessionBlinds(s) {
  if (!s) return null;
  const net = Number(s.net), hours = Number(s.hours);
  if (s.net == null || s.net === '' || !Number.isFinite(net) || !(hours > 0)) return null;
  const bigBlind = bigBlindOf(s.stakes);
  if (bigBlind == null) return null;
  const unit = unitOf(s.game, s.stakes);
  if (!unit) return null;
  return { unit, bigBlind, blinds: net / bigBlind, hours };
}

/** One session's rate: { unit, rate, blinds, hours } or null; null also under MIN_SESSION_HOURS. */
export function sessionBbHr(s, { minHours = MIN_SESSION_HOURS } = {}) {
  const b = sessionBlinds(s);
  if (!b || b.hours < minHours) return null;
  return { unit: b.unit, rate: b.blinds / b.hours, blinds: b.blinds, hours: b.hours };
}

// ── Many sessions ─────────────────────────────────────────────────────────────────────────
/**
 * An accumulator for the loops the tables already run: add(session) per cash session, result()
 * for { bb, BB } — each null with no qualifying session, else
 * { rate (blinds per hour), blinds, hours, n (sessions in it) }. The two units are kept apart.
 */
export function bbAccumulator() {
  const acc = { bb: { blinds: 0, hours: 0, n: 0 }, BB: { blinds: 0, hours: 0, n: 0 } };
  return {
    add(s) {
      const b = sessionBlinds(s);
      if (!b) return this;
      const a = acc[b.unit];
      a.blinds += b.blinds; a.hours += b.hours; a.n++;
      return this;
    },
    result() {
      const fig = (a) => (a.n ? { rate: a.blinds / a.hours, blinds: a.blinds, hours: a.hours, n: a.n } : null);
      return { bb: fig(acc.bb), BB: fig(acc.BB) };
    },
  };
}

/** The same over a list: bbHourly([{ game, stakes, net, hours }, ...]) → { bb, BB }. */
export function bbHourly(sessions) {
  const a = bbAccumulator();
  for (const s of sessions || []) a.add(s);
  return a.result();
}

// ── Showing it ────────────────────────────────────────────────────────────────────────────
/** A rate to one decimal with its sign: "+3.4", "−1.2"; "0.0" (no sign) when it rounds to zero;
 *  "—" for null / not a number, never 0 for unknown. */
export function fmtBbRate(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return '—';
  const v = Number(rate);
  const digits = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (Number(digits.replace(/,/g, '')) === 0) return '0.0';
  return (v < 0 ? MINUS : '+') + digits;
}

/** 1, -1 or 0 by the sign AS DRAWN (a rate that reads "0.0" is neither green nor red). */
export function bbTone(rate) {
  const t = fmtBbRate(rate);
  return t.startsWith('+') ? 1 : t.startsWith(MINUS) ? -1 : 0;
}

/** "+3.4 bb/hr", "−1.2 BB/hr"; "—" with no rate (the unit is dropped: nothing to measure). */
export function fmtBbHr(rate, unit = UNIT_BB) {
  return rate == null || !Number.isFinite(Number(rate)) ? '—' : `${fmtBbRate(rate)} ${unitLabel(unit)}`;
}

/**
 * The figures to show for a { bb, BB } result: the units that have qualifying sessions, bb first —
 * [{ unit, rate, n, hours, text ("+3.4"), full ("+3.4 bb/hr"), label ("bb/hr"), tone }]. Empty
 * when none qualifies; the caller draws one "—" then.
 */
export function bbFigures(res) {
  const out = [];
  for (const unit of UNITS) {
    const f = res && res[unit];
    if (!f) continue;
    out.push({
      unit, rate: f.rate, n: f.n, hours: f.hours,
      text: fmtBbRate(f.rate), full: fmtBbHr(f.rate, unit), label: unitLabel(unit), tone: bbTone(f.rate),
    });
  }
  return out;
}

/** "3 sessions, 12.5 hours" for a figure's title / screen-reader text. */
export function bbBasis(fig) {
  if (!fig) return '';
  const h = Math.round(fig.hours * 10) / 10;
  return `${fig.n} ${fig.n === 1 ? 'session' : 'sessions'}, ${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/**
 * One column of a table whose rows each hold a { bb, BB } result (a row per room, game, stakes ...):
 * how it is headed and how a cell is drawn. The head says "bb/hr", or "BB/hr" when every figure in
 * the column is in big bets; in a column that holds both, the head says "bb/hr" and a big-bet figure
 * carries its unit ("+0.8 BB") so the two are never read as one. A cell is one line per unit that
 * qualifies (two lines for a room with both), or a single "—" line when none does.
 *   column(results) → { label, lines(result) → [{ unit, text, tone, full, n, hours }] }
 */
export function bbColumn(results) {
  let hasBb = false, hasBig = false;
  for (const r of results || []) { if (r && r.bb) hasBb = true; if (r && r.BB) hasBig = true; }
  const label = hasBig && !hasBb ? unitLabel(UNIT_BIG_BET) : unitLabel(UNIT_BB);
  const mixed = hasBb && hasBig;
  return {
    label, mixed,
    lines(res) {
      const figs = bbFigures(res).map((f) => ({ ...f, text: mixed && f.unit === UNIT_BIG_BET ? `${f.text} ${UNIT_BIG_BET}` : f.text }));
      return figs.length ? figs : [{ unit: null, text: '—', tone: 0, full: '—', n: 0, hours: 0 }];
    },
  };
}

// ── The Cash stats view's groups ──────────────────────────────────────────────────────────
/**
 * bb/hr for the cash sessions list (GET /api/cash-sessions: { game, stakes, room, venue_slug, net,
 * hours, live, ended_at }), overall and in the three breakdowns of the Cash stats view. The group
 * keys are the server's (lib/cash-sessions.js computeStats: stakes `game|stakes`, game, room
 * `slug:<slug>` or `room:<name>`, all lower-cased) so a row of byStakes / byGame / byRoom finds its
 * figures by its own `key`; test/cash-sessions.test.js holds the two sets of keys together.
 *   → { overall: { bb, BB }, stakes: Map, game: Map, room: Map }   (each Map: key → { bb, BB })
 */
export function cashBbGroups(sessions) {
  const overall = bbAccumulator();
  const maps = { stakes: new Map(), game: new Map(), room: new Map() };
  const keys = (s) => ({
    stakes: `${s.game}|${s.stakes}`.toLowerCase(),
    game: String(s.game).toLowerCase(),
    room: s.venue_slug ? `slug:${s.venue_slug}` : `room:${(s.room || '').toLowerCase()}`,
  });
  for (const s of sessions || []) {
    if (!s || s.live || !s.ended_at) continue;
    const row = { game: s.game, stakes: s.stakes, net: s.net, hours: s.hours };
    overall.add(row);
    const k = keys(s);
    for (const dim of Object.keys(maps)) {
      let a = maps[dim].get(k[dim]);
      if (!a) { a = bbAccumulator(); maps[dim].set(k[dim], a); }
      a.add(row);
    }
  }
  const done = (m) => new Map([...m].map(([k, a]) => [k, a.result()]));
  return { overall: overall.result(), stakes: done(maps.stakes), game: done(maps.game), room: done(maps.room) };
}
