'use strict';
/*
 * Classifying a result for a standing agreement (docs/bankroll-merge.md §6.3).
 *
 * A backer's standing stake names a GAME and a CHANNEL. This module answers, for one result, which
 * game and which channel it was. Pure functions over plain rows, plus classifyResult(), which reads
 * the row and its session_extras from the database.
 *
 *   format   one key from GAMES — the exact game, never a family
 *   channel  'live' | 'online'
 *
 * Where each comes from, in order:
 *   1. session_extras.format / .channel — imported from the dashboard, chat-logged, or set by the
 *      owner on the result sheet. Only a valid key counts; anything else is ignored.
 *   2. derivation: a tournament's channel is tournaments.is_online and its game formatOf(game_variant);
 *      a cash session's channel is ONLINE_ROOM.test(room) and its game formatOf(game).
 *
 * EVERY GAME ON ITS OWN (owner, 2026-10-14, Q8). The spec's original table folded games into
 * families (5- and 6-card PLO into PLO, PLO hi-lo of any size into PLO8, HORSE and the N-game mixes
 * into Mixed). The owner dropped the families: a stake matches only the exact game, or 'all'. So
 * PLO5 is not PLO, PLO6 8/b is not PLO8, and HORSE is not an 8-game mix. Different spellings of
 * the SAME game still map to one key (NLH / NL / No-Limit Hold'em; Big O / 5-card PLO8).
 * Anything this table does not name is 'other'. Labels that merely say "mix" are 'mixed'.
 *
 * The rules are an ORDERED table (formatOf walks it top to bottom, first hit wins). The order is
 * load-bearing and tested row by row:
 *   - the mixes come first, so "PLO/NLH Mix", "Mixed PLO" and "Mixed Triple Draw" are mixes and not
 *     PLO, NLH or 2-7 (the spec's table listed the Mixed row last, which made its own `plo/nlh`
 *     pattern unreachable);
 *   - Big O before PLO8 before PLO (the 5-card hi-lo game is Big O; "PLO8" contains "PLO");
 *   - the sized PLO games before plain PLO;
 *   - the 2-7 games before NLH, because "NL 2-7 Single Draw" carries the token `nl`.
 */

// The exact games, in the order a stake editor lists them. The first nine keys are the dashboard's
// (WC:app/src/db/types.ts Format) and keep their meaning for imported stakes; the rest are the
// games the dashboard folded into those keys.
const GAMES = [
  { key: 'NLH', label: 'NLH' },
  { key: 'PLO', label: 'PLO' },
  { key: 'PLO5', label: 'PLO5' },
  { key: 'PLO6', label: 'PLO6' },
  { key: 'PLO8', label: 'PLO8' },
  { key: 'PLO6_8', label: 'PLO6 8/b' },
  { key: 'BigO', label: 'Big O' },
  { key: 'stud8', label: 'Stud 8' },
  { key: 'razz', label: 'Razz' },
  { key: '2-7', label: '2-7 triple draw' },
  { key: '2-7sd', label: '2-7 single draw' },
  { key: 'HORSE', label: 'HORSE' },
  { key: '8-game', label: '8-game' },
  { key: '9-game', label: '9-game' },
  { key: '10-game', label: '10-game' },
  { key: 'dealers-choice', label: "Dealer's choice" },
  { key: 'plo-nlh', label: 'PLO/NLH mix' },
  { key: 'mixed', label: 'Mixed' },
  { key: 'other', label: 'Other' },
];
const FORMATS = GAMES.map((g) => g.key);
const FORMAT_LABEL = Object.fromEntries(GAMES.map((g) => [g.key, g.label]));
const CHANNELS = ['live', 'online'];
// What a stake may name.
const STAKE_FORMATS = ['all', ...FORMATS];
const STAKE_CHANNELS = ['any', ...CHANNELS];

const isFormat = (v) => typeof v === 'string' && FORMATS.includes(v);
const isChannel = (v) => typeof v === 'string' && CHANNELS.includes(v);

// ── Online rooms ─────────────────────────────────────────────────────────────────────────
// Online card rooms a cash session's free-text room may name, matched as whole words. Moved here
// from lib/bankroll-reports.js (which re-exports it); gains betrivers, borgata online and phenom.
// "The online venues the import finds" (§6.3) join it when the import is built.
const ONLINE_ROOM = /\b(acr|americas ?cardroom|winning ?poker|gg ?poker|ggpoker|natural ?8|pokerstars|wsop\.com|wsop online|club ?wpt|partypoker|party ?poker|bovada|ignition|bet ?online|888 ?poker|coinpoker|global ?poker|bet ?rivers|borgata online|phenom|online)\b/i;

// ── formatOf ─────────────────────────────────────────────────────────────────────────────
function normalise(label) {
  return String(label == null ? '' : label)
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .replace(/(?<=[a-z])\.(?=[a-z])/g, '') // H.O.R.S.E. -> horse.
    .replace(/\s+/g, ' ')
    .trim();
}

// Whole-token match: not glued to a letter or digit on either side.
const tok = (alts) => new RegExp(`(?<![a-z0-9])(?:${alts.join('|')})(?![a-z0-9])`);

const OMAHA = "(?:plo|pot[- ]?limit omaha|omaha)";
// A bare 8 is the hi-lo marker only when it is not the front of a stake ("PLO6 8/16" is PLO6).
const HILO = '(?:8(?![0-9/])|8/b|hi[- ]?lo|hi/lo|h/l|8 or better|8-or-better)';

const RULES = [
  // ── mixes (see the header for why they lead) ──
  ['plo-nlh', tok(['plo ?[/&+] ?nlhe?', 'nlhe? ?[/&+] ?plo'])],
  ['HORSE', tok(['horse'])],
  ['8-game', tok(['8[- ]?games?'])],
  ['9-game', tok(['9[- ]?games?'])],
  ['10-game', tok(['10[- ]?games?'])],
  ['dealers-choice', tok(["dealer'?s'? choice"])],
  ['mixed', tok(['mix(?:ed)?', '\\d+[- ]?games?', 'rotation'])],
  // ── the Omaha line, most specific first ──
  ['BigO', tok(['big[- ]?o8?', `5[- ]?card ${OMAHA} ?${HILO}`, `plo5 ?${HILO}`])],
  ['PLO6_8', tok([`plo6 ?${HILO}`, `6[- ]?card ${OMAHA} ?${HILO}`])],
  ['PLO8', tok([
    'plo4? ?8(?![0-9/])', 'plo4? ?8/b', 'plo4? (?:hi[- ]?lo|hi/lo|h/l|8 or better|8-or-better)',
    'o8', 'omaha ?8(?![0-9/])', 'omaha ?8/b', 'omaha (?:hi[- ]?lo|hi/lo|h/l|8 or better|8-or-better)',
  ])],
  ['PLO5', tok(['plo5', `5[- ]?card ${OMAHA}`])],
  ['PLO6', tok(['plo6', `6[- ]?card ${OMAHA}`])],
  ['PLO', tok(['plo4?', `4[- ]?card ${OMAHA}`, 'pot[- ]?limit omaha', 'pl omaha', 'omaha'])],
  // ── stud, razz, draw ──
  ['stud8', tok([
    'stud ?8(?![0-9/])', 'stud ?8/b', 'stud hi[- ]?lo', 'stud hi/lo', 'stud eight or better',
    '(?:7|seven)[- ]?card stud 8(?![0-9/])',
  ])],
  ['razz', tok(['razz'])],
  ['2-7sd', tok(['single draw', '2-7 ?(?:sd|single)', 'nl ?2-7'])],
  ['2-7', tok(['2-7', 'deuce', 'triple draw'])],
];
// No-limit hold'em needs more than a token (see nlh()), so it is a function rule.
const NLH_TOKEN = tok(['nlhe?', 'nl', 'no[- ]?limit']);
const HOLDEM = /hold ?'?em/;
const LIMIT_HOLDEM = /(?<![a-z0-9])(?:limit|pot[- ]?limit|fixed[- ]?limit|pl|l) hold/;
function nlh(s) {
  if (NLH_TOKEN.test(s)) return true; // "nl hold'em" and "no-limit hold'em" land here
  if (HOLDEM.test(s)) return !LIMIT_HOLDEM.test(s); // limit and pot-limit hold'em are other games
  return false;
}

/** A game label ("PLO8", "No-Limit Hold'em", "5-card PLO") -> one GAMES key. Never throws. */
function formatOf(label) {
  const s = normalise(label);
  if (!s) return 'other';
  for (const [key, re] of RULES) if (re.test(s)) return key;
  return nlh(s) ? 'NLH' : 'other';
}

// ── classification ───────────────────────────────────────────────────────────────────────
const trimOrNull = (v) => (v == null ? '' : String(v).trim());

/**
 * extras: a session_extras row ({ format, channel }) or null. Only valid keys count.
 * Returns { format, channel, formatSource: 'extras'|'derived', channelSource: 'extras'|'derived' }.
 */
function pick(extras, derivedFormat, derivedChannel) {
  const ef = extras && isFormat(extras.format) ? extras.format : null;
  const ec = extras && isChannel(extras.channel) ? extras.channel : null;
  return {
    format: ef || derivedFormat,
    channel: ec || derivedChannel,
    formatSource: ef ? 'extras' : 'derived',
    channelSource: ec ? 'extras' : 'derived',
  };
}

/** row: { game_variant, is_online } (tournaments). */
function classifyTournament(row, extras) {
  const r = row || {};
  return pick(extras, formatOf(r.game_variant), Number(r.is_online) ? 'online' : 'live');
}

/** row: { game, room } (cash_sessions). */
function classifyCash(row, extras) {
  const r = row || {};
  return pick(extras, formatOf(r.game), ONLINE_ROOM.test(trimOrNull(r.room)) ? 'online' : 'live');
}

function oneRow(db, sql, params) {
  const s = db.prepare(sql);
  try { s.bind(params); return s.step() ? s.getAsObject() : null; } finally { s.free(); }
}
function tableExists(db, name) {
  const r = db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);
  return !!(r.length && r[0].values.length);
}

/**
 * Reads one of the caller's results and classifies it.
 *   ref = { table: 'tracking_entries' | 'cash_sessions', id }
 * Returns null when the row is not the user's. Otherwise
 *   { table, id, kind: 'tournament'|'cash', format, channel, formatSource, channelSource,
 *     game, room, ended }
 * `ended` is false for a live cash session (which never posts). Reads only.
 */
function classifyResult(db, userId, ref) {
  if (!ref || !Number.isInteger(Number(ref.id))) return null;
  const id = Number(ref.id);
  const extras = tableExists(db, 'session_extras')
    ? oneRow(db, 'SELECT format, channel FROM session_extras WHERE ref_table = ? AND ref_id = ? AND user_id = ?', [ref.table, id, userId])
    : null;
  if (ref.table === 'tracking_entries') {
    const r = oneRow(db, `SELECT t.game_variant, t.is_online, t.venue, t.property, t.site
      FROM tracking_entries te JOIN tournaments t ON t.id = te.tournament_id
      WHERE te.id = ? AND te.user_id = ?`, [id, userId]);
    if (!r) return null;
    return {
      table: 'tracking_entries', id, kind: 'tournament', ...classifyTournament(r, extras),
      game: trimOrNull(r.game_variant), room: trimOrNull((Number(r.is_online) ? (r.site || r.property) : r.property) || r.venue), ended: true,
    };
  }
  if (ref.table === 'cash_sessions') {
    const r = oneRow(db, 'SELECT game, room, ended_at FROM cash_sessions WHERE id = ? AND user_id = ?', [id, userId]);
    if (!r) return null;
    return {
      table: 'cash_sessions', id, kind: 'cash', ...classifyCash(r, extras),
      game: trimOrNull(r.game), room: trimOrNull(r.room), ended: !!r.ended_at,
    };
  }
  return null;
}

module.exports = {
  GAMES, FORMATS, FORMAT_LABEL, CHANNELS, STAKE_FORMATS, STAKE_CHANNELS, isFormat, isChannel,
  ONLINE_ROOM, normalise, formatOf, classifyTournament, classifyCash, classifyResult,
};
