'use strict';
/*
 * Standing-% share math (docs/bankroll-merge.md §6.4). A port of the dashboard's
 * WC:app/src/db/backers.ts (matchPct, backerShare, cutsForSession and the three small helpers its
 * test file covers), with three differences the spec calls for:
 *
 *   - money is INTEGER CENTS, never floats of dollars;
 *   - stakes are DATED (valid_from / valid_to, both inclusive), and matching looks only at the
 *     stakes in force on the result's date;
 *   - a loss rounds to the same magnitude as the equal win (see shareCents).
 *
 * Pure: no database, no clock, no I/O — except the small readers at the bottom (loadAgreements,
 * loadExclusions, seriesBackerIds), which only SELECT. Nothing here posts anything. The owner's
 * answers of 2026-10-14 (docs/bankroll-merge.md §1) keep it that way: a share is posted by a manual
 * Notify tap, which is a later phase; this module only says what a share WOULD be.
 *
 * Shapes
 *   stake       { id?, format: 'all' | <classify.js game key>, channel: 'any'|'live'|'online', pct,
 *                 valid_from?, valid_to? }          (the standing_stakes row; the dates are optional
 *                                                    only so the dashboard's undated cases port 1:1)
 *   session     { date: 'YYYY-MM-DD', format, channel, resultCents }
 *   agreement   { id, backerId, status, effectiveFrom, effectiveTo, stakes: [stake] }
 */

const crypto = require('crypto');
const { FORMAT_LABEL } = require('./classify');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v) => typeof v === 'string' && DATE_RE.test(v);

// ── Stakes in force, and which one applies ───────────────────────────────────────────────

/**
 * Is `date` inside [from, to]? Both ends inclusive, either may be absent (open). Plain string
 * compare on YYYY-MM-DD, which sorts as dates do and shifts no zone.
 */
function inWindow(date, from, to) {
  if (from && !(date >= from)) return false;
  if (to && !(date <= to)) return false;
  return true;
}

/**
 * The stakes whose window contains `date`. A stake with NO window is always in force. A stake WITH
 * a window needs a dated result: with no usable date it cannot be placed on the calendar, so it is
 * not in force (nothing is guessed about money).
 */
function stakesInForce(stakes, date) {
  const dated = isDate(date);
  return (stakes || []).filter((st) => {
    if (!st) return false;
    const windowed = !!(st.valid_from || st.valid_to);
    if (!windowed) return true;
    return dated && inWindow(date, st.valid_from || null, st.valid_to || null);
  });
}

/**
 * The stake that applies to a session, or null if the backer is not staked in it.
 * Among the stakes in force on the session's date that match its game and channel, the most
 * specific wins: an exact game scores 2, an exact channel scores 1 ('all' and 'any' score 0), the
 * highest score wins, and a tie goes to the larger pct (first listed on an exact tie).
 * A stake's game matches ONLY that exact game, or 'all' (owner, 2026-10-14, Q8): PLO5 is not PLO.
 */
function matchStake(stakes, session) {
  const s = session || {};
  let best = null;
  let bestScore = -1;
  for (const st of stakesInForce(stakes, s.date)) {
    const pct = Number(st.pct);
    if (!Number.isFinite(pct) || pct < 0) continue;
    const fOk = st.format === 'all' || st.format === s.format;
    const cOk = st.channel === 'any' || st.channel === s.channel;
    if (!fOk || !cOk) continue;
    const score = (st.format !== 'all' ? 2 : 0) + (st.channel !== 'any' ? 1 : 0);
    if (score > bestScore || (score === bestScore && pct > Number(best.pct))) {
      best = st;
      bestScore = score;
    }
  }
  return best;
}

/** The backer's applicable pct for a session, or null if not staked in it. */
function matchPct(stakes, session) {
  const st = matchStake(stakes, session);
  return st ? Number(st.pct) : null;
}

// ── Money ────────────────────────────────────────────────────────────────────────────────

/**
 * share_cents = sign(r) x round_half_up(|r| x pct / 100), exactly.
 *
 * The dashboard computed Math.round(result x pct / 100 x 100) in floats, which rounds -0.5 toward
 * zero (a $0.005 loss share of -0.5 cents became 0 while the equal win became 1) and picks up float
 * noise at x.5 boundaries. Here the multiply and the rounding run in BigInt on pct scaled by 1e12
 * (pct.toFixed(12) is the exact decimal of the double to 12 places), so the answer is the
 * mathematical one for the pct as typed. The parity sweep in test/standing.test.js shows it never
 * differs from the dashboard's formula by more than one cent.
 *
 * resultCents must be a safe integer (signed). pct is a percentage, 0..1000.
 */
function shareCents(resultCents, pct) {
  if (!Number.isSafeInteger(resultCents)) throw new TypeError('shareCents: resultCents must be an integer number of cents');
  const p = Number(pct);
  if (!Number.isFinite(p) || p < 0 || p > 1000) throw new RangeError('shareCents: pct must be between 0 and 1000');
  if (resultCents === 0 || p === 0) return 0;
  const scaled = BigInt(p.toFixed(12).replace('.', '')); // pct x 1e12
  const n = BigInt(Math.abs(resultCents)) * scaled;
  const D = 100000000000000n; // 100 x 1e12
  const q = (2n * n + D) / (2n * D); // floor(n / D + 1/2) for n >= 0
  const out = Number(q);
  return resultCents < 0 ? (out === 0 ? 0 : -out) : out;
}

/** The backer's share of a session in cents (negative on a loss), or null when not staked. */
function backerShare(stakes, session) {
  const pct = matchPct(stakes, session);
  return pct == null ? null : shareCents(session.resultCents, pct);
}

/**
 * Backers staked in a session, with their pct and share, biggest |share| first (equal shares keep
 * their input order). backers: [{ ...anything, stakes }]. -> [{ backer, pct, shareCents }]
 */
function cutsForSession(backers, session) {
  const out = [];
  for (const b of backers || []) {
    const pct = matchPct(b.stakes, session);
    if (pct == null) continue;
    out.push({ backer: b, pct, shareCents: shareCents(session.resultCents, pct) });
  }
  return out.sort((a, b) => Math.abs(b.shareCents) - Math.abs(a.shareCents));
}

// The result's net, in integer cents of the result's own currency (the ledger's formulas, §6.4).

/** (cashed ? cash_amount : 0) - buyin x max(1, num_entries), whole units -> cents. */
function tournamentNetCents(row) {
  const r = row || {};
  const units = Math.max(1, Number(r.num_entries) || 1);
  const buyin = Math.max(0, Number(r.buyin) || 0);
  const cash = Number(r.cashed) ? Math.max(0, Number(r.cash_amount) || 0) : 0;
  return Math.round((cash - buyin * units) * 100);
}
/** cash_out - buy_in - tips - expenses (Q12: the result the bankroll records), whole units -> cents. */
function cashNetCents(row) {
  const r = row || {};
  return Math.round(((Number(r.cash_out) || 0) - (Number(r.buy_in) || 0) - (Number(r.tips) || 0) - (Number(r.expenses) || 0)) * 100);
}
/** A result in `currency` cents -> USD cents at `rates` (units per 1 USD, as lib/analytics convert). */
function usdCents(cents, currency, rates) {
  const cur = currency || 'USD';
  if (cur === 'USD' || !rates) return cents;
  const rate = rates[cur];
  if (!(rate > 0)) throw new RangeError(`usdCents: no rate for ${cur}`);
  return Math.round(cents / rate);
}

// ── Which agreements give a backer a share of this result ────────────────────────────────

const exclusionKey = (agreementId, table, id) => `${agreementId}:${table}:${id}`;

/**
 * Decides, per standing agreement, whether and how much of one result the backer is owed.
 *
 *   agreements       [agreement]            the player's standing agreements (any status)
 *   result           { table, id, kind: 'tournament'|'cash', date, format, channel, resultCents,
 *                      ended? }               ended === false is a live cash session
 *   exclusions       Set of exclusionKey(...) the "not staked" opt-outs
 *   seriesBackerIds  Set|array of backers.id  backers who hold a series agreement covering this
 *                                             tournament (seriesBackerIds() below)
 *
 * -> { cuts, skipped, needsAsk }
 *   cuts     [{ agreementId, backerId, stakeId, pct, shareCents, ask, seriesOverlap }], biggest
 *            |share| first. `ask` is true when the same backer ALSO holds a series agreement on this
 *            tournament: the owner decides each time (owner, 2026-10-14, Q7) and the engine does
 *            NOT choose the series agreement — both matches are returned, flagged. It never
 *            drops the standing cut because of the overlap.
 *   skipped  [{ agreementId, backerId, reason }]  reason is one of
 *            'ended' | 'outside-window' | 'live' | 'excluded' | 'not-staked'
 *   needsAsk true when any cut carries ask
 *
 * Not decided here (later phases): a result that already carries a dashboard event for the backer,
 * and whether the owner has answered an `ask` before. The import never calls this.
 */
function resultCuts({ agreements, result, exclusions, seriesBackerIds: sb }) {
  const r = result || {};
  const excl = exclusions instanceof Set ? exclusions : new Set(exclusions || []);
  const series = sb instanceof Set ? sb : new Set(sb || []);
  const cuts = [];
  const skipped = [];
  for (const a of agreements || []) {
    const skip = (reason) => skipped.push({ agreementId: a.id, backerId: a.backerId, reason });
    if (a.status !== 'active') { skip('ended'); continue; }
    if (!isDate(r.date) || !inWindow(r.date, a.effectiveFrom || null, a.effectiveTo || null)) { skip('outside-window'); continue; }
    if (r.ended === false) { skip('live'); continue; } // a live cash session never posts
    if (excl.has(exclusionKey(a.id, r.table, r.id))) { skip('excluded'); continue; }
    const stake = matchStake(a.stakes, r);
    if (!stake) { skip('not-staked'); continue; }
    const pct = Number(stake.pct);
    const overlap = r.kind === 'tournament' && series.has(a.backerId);
    cuts.push({
      agreementId: a.id, backerId: a.backerId, stakeId: stake.id == null ? null : stake.id,
      pct, shareCents: shareCents(r.resultCents, pct), ask: overlap, seriesOverlap: overlap,
    });
  }
  cuts.sort((x, y) => Math.abs(y.shareCents) - Math.abs(x.shareCents));
  return { cuts, skipped, needsAsk: cuts.some((c) => c.ask) };
}

// ── Readers (SELECT only) ────────────────────────────────────────────────────────────────

function allRows(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}

/** The player's standing agreements with their stakes (all of them; resultCuts filters). */
function loadAgreements(db, userId) {
  const list = allRows(db, `SELECT id, backer_id, effective_from, effective_to, status, opening_cents
    FROM standing_agreements WHERE user_id = ? ORDER BY id`, [userId]);
  const stakes = allRows(db, `SELECT s.id, s.agreement_id, s.format, s.channel, s.pct, s.valid_from, s.valid_to
    FROM standing_stakes s JOIN standing_agreements a ON a.id = s.agreement_id
    WHERE a.user_id = ? ORDER BY s.id`, [userId]);
  return list.map((a) => ({
    id: a.id, backerId: a.backer_id, status: a.status, effectiveFrom: a.effective_from, effectiveTo: a.effective_to || null,
    openingCents: a.opening_cents, stakes: stakes.filter((s) => s.agreement_id === a.id),
  }));
}

/** Every "not staked" opt-out under the player's agreements, as a Set of exclusionKey(...). */
function loadExclusions(db, userId) {
  return new Set(allRows(db, `SELECT e.agreement_id, e.ref_table, e.ref_id FROM standing_exclusions e
    JOIN standing_agreements a ON a.id = e.agreement_id WHERE a.user_id = ?`, [userId])
    .map((e) => exclusionKey(e.agreement_id, e.ref_table, e.ref_id)));
}

/**
 * The overlap rule's input (§6.2): the backers who have a backer_event_status row for this
 * tournament under an ACTIVE agreement of any of the player's series. A Set of backers.id.
 */
function seriesBackerIds(db, userId, tournamentId) {
  return new Set(allRows(db, `SELECT DISTINCT ba.backer_id AS id
    FROM backer_event_status bes
    JOIN backer_agreements ba ON ba.id = bes.agreement_id
    JOIN staking_series ss ON ss.id = ba.series_id
    WHERE bes.tournament_id = ? AND ba.is_active = 1 AND ss.user_id = ?`, [tournamentId, userId]).map((r) => r.id));
}

// ── The dashboard's other tested helpers ─────────────────────────────────────────────────

/** A concise "game being played" label for the notification: "5/5/10 PLO", "NLH MTT". */
function sessionGameLabel(session) {
  const s = session || {};
  const fmt = FORMAT_LABEL[s.format] || s.format || '';
  const stake = s.stakeLevel || (s.gameLabel && !String(s.gameLabel).includes(fmt) ? s.gameLabel : '');
  const kind = s.isMTT ? `${fmt} MTT` : fmt;
  return stake ? `${stake} ${kind}` : kind;
}

/**
 * Short labels for the channels a backer will actually receive on. The private link and push are
 * always available; text and the weekly email need the opt-in flag AND the address (§4.2: delivery
 * is opt-in, so a backer whose email is merely on file is not emailed).
 * backer: { notify_sms, notify_email, phone, email }
 */
function deliveryChannels(backer) {
  const b = backer || {};
  const out = ['link'];
  if (Number(b.notify_sms) && b.phone) out.push('text');
  if (Number(b.notify_email) && b.email) out.push('email digest');
  return out;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/**
 * A short, URL-clean token for a backer's private link: 8 base62 characters (~48 bits), crypto
 * random. Same shape as the dashboard's newToken(), but drawn by rejection sampling so no
 * character is likelier than another (a byte % 62 favours the first eight characters).
 */
function newToken() {
  let s = '';
  while (s.length < 8) {
    for (const b of crypto.randomBytes(16)) {
      if (b >= 248) continue; // 248 = 62 x 4: only whole turns of the alphabet
      s += ALPHABET[b % 62];
      if (s.length === 8) break;
    }
  }
  return s;
}

module.exports = {
  inWindow, stakesInForce, matchStake, matchPct, shareCents, backerShare, cutsForSession,
  tournamentNetCents, cashNetCents, usdCents,
  exclusionKey, resultCuts, loadAgreements, loadExclusions, seriesBackerIds,
  sessionGameLabel, deliveryChannels, newToken,
};
