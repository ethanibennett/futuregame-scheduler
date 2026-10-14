// ── Hand history I/O: the public API ────────────────────────────────────────
// Saved hands as PokerStars-format hand-history text — the format PokerTracker
// 4, Hold'em Manager, Hand2Note, GTO Wizard and fpdb all import — and the
// pieces the importer (lib/hh-import/) reads it back with.
//
//   writePokerStarsHand(hand, opts) -> { text, handId, warnings, lines }   throws HandExportError
//   writePokerStarsFile(entries, opts) -> { text, written, skipped, warnings }
//   checkExportable(hand, opts?)     -> { ok, pt4, pt4Why, gameName, warnings } | { ok:false, code, message, short }
//                                       pt4Why (when !pt4): 'stud-draw' | 'big-omaha'
//   prepareHand(hand, opts)          -> { model, events, meta, settle, warnings }
//   handHistoryId(hand, opts?)       -> '8' + 15 digits
//   canonicalHand(hand)              -> comparison form (canonical.js)
//
// opts: { site='PokerStars', heroName, shared (true: the hand came by someone else's
//   share link; refused with 'not-yours'), playedAt (Date; required for one hand
//   unless the hand was imported with one), tableName, maxSeats,
//   tournament: { id, buyIn, fee, currency, level }, showFoldedCards=false,
//   eol='\r\n' and bom=true (files) }
// Pure: the same input gives the same bytes. No Date.now(), no DOM, no React.
// See docs/hand-history-io.md.

import { prepareHand, normalizeInput, seatPlayers, layOut } from './prepare.js';
import { renderPokerStars } from './pokerstars-writer.js';
import { HandExportError } from './errors.js';
import {
  CURRENCIES, SITE_RE, sortedJSON, fnv1a64, etDay, toCents, money, GAME_TABLE, canonicalGameName,
} from './ps-format.js';
import { gameConfig, gameCategory } from '../quick-add/game.js';

export { prepareHand, HandExportError };
export { canonicalHand } from './canonical.js';

const DEFAULTS = { site: 'PokerStars', eol: '\r\n', bom: true, showFoldedCards: false };
/* The options over the defaults; an option passed as undefined keeps its default. */
const withDefaults = (opts) => {
  const o = { ...DEFAULTS };
  for (const [k, v] of Object.entries(opts || {})) if (v !== undefined) o[k] = v;
  return o;
};

/* The poker content a hand id is a hash of: what was dealt and done, never what
   it is called (names, title, notes, felt, visuals and quick-add state are left
   out, so renaming a player or retitling a hand keeps its id). */
function idContent(hand) {
  let h;
  try {
    h = normalizeInput(hand).hand;
    const cfg = gameConfig(h.gameType);
    if (cfg) {
      h = layOut(h);
      try { h = seatPlayers(h, !!cfg.isStud); } catch (_) { /* unseatable: hash as saved */ }
    }
  } catch (_) {
    h = hand || {};
  }
  return idContentOf(h);
}

/* The hashed content of a hand already normalised and seated (prepareHand's
   meta.seated is one: the writer hashes that rather than normalising twice). */
function idContentOf(h) {
  const cash = h.gameMode === 'cash';
  return {
    v: 1,
    gameType: h.gameType,
    gameMode: cash ? 'cash' : 'mtt',
    currency: cash ? h.currency : undefined,
    blinds: h.blinds || {},
    players: (h.players || []).map(p => ({ position: p.position, startingStack: p.startingStack })),
    heroIdx: h.heroIdx,
    streets: (h.streets || []).map(st => ({
      cards: st.cards || {},
      actions: (st.actions || []).map(a => ({ player: a.player, action: a.action, amount: a.amount })),
      draws: (st.draws || []).map(d => ({ player: d.player, discarded: d.discarded, discardedCards: d.discardedCards, newCards: d.newCards })),
    })),
    result: h.result || null,
  };
}

const importedId = (hand, site) => {
  const imp = hand && typeof hand === 'object' ? (hand.import || (hand.handData && hand.handData.import)) : null;
  return imp && imp.site === 'pokerstars' && /^\d{1,19}$/.test(String(imp.handId || '')) && (imp.siteName || 'PokerStars') === site ? String(imp.handId) : null;
};
const hashId = (content) => '8' + String(fnv1a64(sortedJSON(content)) % 1000000000000000n).padStart(15, '0');

/* A deterministic hand number: a hand imported from PokerStars keeps its own
   (when written under the same site name); any other is '8' followed by 15
   digits of a 64-bit FNV-1a hash of its poker content — 16 digits, far above
   PokerStars' own (12 digits today), within a signed 64-bit integer. PT4
   de-duplicates on site + hand number, so the same hand exported twice is one
   hand there, and an edited hand is a new one. */
export function handHistoryId(hand, opts = {}) {
  const site = opts.site || DEFAULTS.site;
  return importedId(hand, site) || hashId(idContent(hand));
}

/* A tournament number for a hand with none: '7' + 9 digits, one per game per
   ET day, so a day's hands of one game group as one tournament in PT4. */
export function tournamentIdFor(playedAt, gameType) {
  const hash = fnv1a64(sortedJSON({ d: etDay(playedAt), gameType }));
  return '7' + String(hash % 1000000000n).padStart(9, '0');
}

function buyInText(t, imp) {
  if (t && t.buyIn != null) {
    if (typeof t.buyIn === 'string') return t.buyIn.trim() || 'Freeroll ';
    const cur = (t.currency || 'USD').toUpperCase();
    const sym = (CURRENCIES[cur] || CURRENCIES.USD).sym;
    const parts = [t.buyIn].concat(t.fee != null ? [t.fee] : []).map(x => money(toCents(x), sym));
    return parts.join('+') + ' ' + cur;
  }
  if (imp && typeof imp.buyIn === 'string' && imp.buyIn) return imp.buyIn === 'Freeroll' ? 'Freeroll ' : imp.buyIn;
  return 'Freeroll ';
}

function header(prep, hand, o) {
  const m = prep.meta;
  const imp = m.imp || {};
  const site = o.site || DEFAULTS.site;
  if (!SITE_RE.test(site)) throw new TypeError('hand-history: site name ' + JSON.stringify(site) + ' is not one the header can carry');
  const playedAt = o.playedAt instanceof Date ? o.playedAt : (imp.playedAt ? new Date(imp.playedAt) : null);
  if (!playedAt || Number.isNaN(playedAt.getTime())) throw new TypeError('hand-history: playedAt (a Date) is required');
  const handId = importedId(hand, site) || hashId(idContentOf(m.seated));
  const t = o.tournament || {};
  const tournamentId = m.cash ? null : String(t.id != null ? t.id : (imp.tournamentId != null ? imp.tournamentId : tournamentIdFor(playedAt, m.gameType)));
  const level = t.level != null ? t.level : (imp.level != null ? imp.level : 1);
  const tableName = String(o.tableName != null ? o.tableName : (imp.tableName != null ? imp.tableName : (m.cash ? 'futuregame' : tournamentId + ' 1'))).replace(/'/g, '') || 'futuregame';
  const maxSeen = Math.max(m.n, ...m.seatNumbers);
  const fallback = m.isStud ? 8 : (m.n <= 2 ? 2 : m.n <= 6 ? 6 : m.n <= 9 ? 9 : 10);
  let maxSeats = Number(o.maxSeats != null ? o.maxSeats : (imp.maxSeats != null ? imp.maxSeats : fallback));
  if (!Number.isInteger(maxSeats) || maxSeats < maxSeen) maxSeats = Math.max(fallback, maxSeen);
  return { site, handId, tournamentId, buyInText: buyInText(o.tournament, imp), level, tableName, maxSeats, playedAt, showFoldedCards: !!o.showFoldedCards };
}

export function writePokerStarsHand(hand, opts = {}) {
  const o = withDefaults(opts);
  const prep = prepareHand(hand, o);
  const h = header(prep, hand, o);
  const lines = renderPokerStars(prep, h);
  return { text: lines.join('\n'), handId: h.handId, warnings: prep.warnings, lines };
}

/* Many hands to one file: hands sorted by playedAt (ascending, stable), UTF-8
   with a BOM, CRLF line ends, three blank lines after every hand. A hand that
   cannot be written is skipped and listed; the rest are written. */
export function writePokerStarsFile(entries, opts = {}) {
  const o = withDefaults(opts);
  const eol = o.eol;
  const sorted = (entries || []).map((e, index) => ({ ...e, index }))
    .sort((a, b) => (a.playedAt?.getTime?.() ?? 0) - (b.playedAt?.getTime?.() ?? 0) || a.index - b.index);
  const written = [], skipped = [], warnings = new Set();
  let text = o.bom ? '﻿' : '';
  for (const e of sorted) {
    try {
      const r = writePokerStarsHand(e.hand, { ...o, playedAt: e.playedAt });
      text += r.lines.join(eol) + eol + eol + eol + eol;
      written.push({ index: e.index, handId: r.handId });
      r.warnings.forEach(w => warnings.add(w));
    } catch (err) {
      if (!(err instanceof HandExportError)) throw err;
      skipped.push({ index: e.index, code: err.code, message: err.message, short: err.short });
    }
  }
  return { text, written, skipped, warnings: [...warnings] };
}

/* Can this hand be written, and does PokerTracker 4 take it? The writer's own
   code path (prepare + settle) without rendering. */
export function checkExportable(hand, opts = {}) {
  try {
    const prep = prepareHand(hand, withDefaults(opts));
    const g = prep.meta.stars;
    return { ok: true, pt4: prep.meta.pt4, pt4Why: prep.meta.pt4 ? null : (g.pt4Why || null), gameName: g.game + ' ' + g.limit, warnings: prep.warnings };
  } catch (err) {
    if (err instanceof HandExportError) return { ok: false, code: err.code, message: err.message, short: err.short };
    return { ok: false, code: 'internal', message: "This hand can't be exported", short: "This hand can't be exported" };
  }
}

/* Is the game one this format has at all (for a quick filter before checking). */
export function hasPokerStarsGame(gameType) {
  const g = canonicalGameName(gameType);
  return !!GAME_TABLE[g] && !!gameCategory(g);
}
