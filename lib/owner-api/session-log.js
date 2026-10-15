'use strict';
/*
 * Logging a poker session from outside the app: the validation half of POST /api/owner/sessions/log
 * (docs/bankroll-merge.md §11.3), PORTED VERBATIM from the dashboard app (WC:server/lib/session-log.js
 * normalizeSession, describeSession, sessionId, etDay) so a session the model parses lands the same
 * here as it did there, and the 46 ported cases still hold.
 *
 * The division of labour that makes this safe: the MODEL parses prose into fields, and this module
 * refuses anything it cannot vouch for. No regex here tries to understand "in for three hundred";
 * if the caller could not produce a number, that is a question for the human, not a guess for the
 * server. Every rejection names the field and what it wanted, because the caller is an agent that
 * will try to fix it and retry. Nothing is inferred silently, and the same session told twice must
 * not become two rows (see sessionId).
 */
const crypto = require('crypto');

const CHANNELS = new Set(['live', 'online']);
// The dashboard's own spellings (WC:app/src/db/types.ts Format). Matched case-insensitively so
// "plo8" and "PLO8" both land, but never coerced into 'other': an unrecognised format is a parse
// failure worth surfacing. The import's formatOfSession maps these onto the engine's keys.
const FORMATS = ['PLO', 'PLO8', 'NLH', 'mixed', 'stud8', 'razz', '2-7', 'BigO', 'other'];
const FORMAT_BY_LOWER = new Map(FORMATS.map((f) => [f.toLowerCase(), f]));

const MAX_MONEY = 10_000_000;  // a session bigger than this is a typo, not a score
const MAX_HOURS = 24;          // a longer sitting is two sessions
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function money(v) {
  const n = typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

// ET day string, so "today" means the day the owner is living in rather than the day UTC happens
// to be having.
function etDay(now = new Date(), timeZone = process.env.CONSOLE_TZ || 'America/New_York') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
    .reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Idempotency. The id is derived from the facts that identify a sitting, so the same session
// described twice (a retry, a dropped connection, telling the story again next morning) upserts one
// row instead of inventing a second win. A caller that genuinely wants two identical sessions on
// one day passes its own distinct id.
function sessionId(s) {
  const seed = [s.date, s.venue.toLowerCase(), s.gameLabel.toLowerCase(), s.buyInTotal, s.cashOut, s.hours].join('|');
  return 'chat-' + crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
}

// { ok, session, errors, notes }. `notes` carries what was defaulted rather than supplied, so a dry
// run can show the human what the server decided for them.
function normalizeSession(input, now = new Date()) {
  const errors = [];
  const notes = [];
  const raw = input && typeof input === 'object' ? input : {};

  let date = str(raw.date, 32);
  if (!date) {
    date = etDay(now);
    notes.push(`date defaulted to today (${date})`);
  } else if (!DATE_RE.test(date)) {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) errors.push('date: expected YYYY-MM-DD');
    else { date = etDay(parsed); notes.push(`date normalized to ${date}`); }
  }

  const channelRaw = str(raw.channel, 16);
  const channel = channelRaw ? channelRaw.toLowerCase() : 'live';
  if (!CHANNELS.has(channel)) errors.push(`channel: expected live or online, got "${channelRaw}"`);
  if (!channelRaw) notes.push('channel defaulted to live');

  const formatRaw = str(raw.format, 24);
  const format = formatRaw ? FORMAT_BY_LOWER.get(formatRaw.toLowerCase()) : null;
  if (!formatRaw) errors.push(`format: required, one of ${FORMATS.join(', ')}`);
  else if (!format) errors.push(`format: "${formatRaw}" is not one of ${FORMATS.join(', ')}`);

  const gameLabel = str(raw.gameLabel, 80);
  if (!gameLabel) errors.push('gameLabel: required, e.g. "2/5 PLO" or "Sunday Major"');

  const venue = str(raw.venue, 60);
  if (!venue) errors.push('venue: required, e.g. "Parx" or "WSOP.com"');

  const buyInTotal = money(raw.buyInTotal);
  if (buyInTotal == null) errors.push('buyInTotal: required number (include rebuys and re-entries)');
  else if (buyInTotal < 0) errors.push('buyInTotal: cannot be negative');
  else if (buyInTotal > MAX_MONEY) errors.push(`buyInTotal: ${buyInTotal} exceeds the ${MAX_MONEY} sanity cap`);

  const cashOut = money(raw.cashOut);
  if (cashOut == null) errors.push('cashOut: required number (0 if you busted)');
  else if (cashOut < 0) errors.push('cashOut: cannot be negative');
  else if (cashOut > MAX_MONEY) errors.push(`cashOut: ${cashOut} exceeds the ${MAX_MONEY} sanity cap`);

  const hours = money(raw.hours);
  if (hours == null) errors.push('hours: required number');
  else if (hours <= 0) errors.push('hours: must be greater than 0');
  else if (hours > MAX_HOURS) errors.push(`hours: ${hours} exceeds ${MAX_HOURS} — log a longer sitting as two sessions`);

  // result is ALWAYS computed. If the caller sent one too, a disagreement means the prose was
  // misread: surface it instead of silently trusting either.
  const result = buyInTotal != null && cashOut != null ? Math.round((cashOut - buyInTotal) * 100) / 100 : null;
  const claimed = raw.result === undefined ? null : money(raw.result);
  if (claimed != null && result != null && Math.abs(claimed - result) > 0.005) {
    errors.push(`result: you sent ${claimed}, but cashOut - buyInTotal is ${result} — one of the three numbers is wrong`);
  }

  const session = {
    id: str(raw.id, 64) || null,
    date,
    channel,
    isMTT: raw.isMTT === true,
    format: format || null,
    gameLabel,
    venue,
    buyInTotal,
    cashOut,
    hours,
    result,
  };

  const stakeLevel = str(raw.stakeLevel, 24);
  if (stakeLevel) session.stakeLevel = stakeLevel;
  if (raw.isWsopFund === true) session.isWsopFund = true;

  const optionalInts = { hands: [1, 200000], entries: [1, 100], place: [1, 100000], fieldSize: [1, 1000000] };
  for (const [key, [lo, hi]] of Object.entries(optionalInts)) {
    if (raw[key] === undefined || raw[key] === null) continue;
    const n = money(raw[key]);
    if (n == null || !Number.isInteger(n) || n < lo || n > hi) errors.push(`${key}: expected a whole number between ${lo} and ${hi}`);
    else session[key] = n;
  }

  if (raw.moodRating !== undefined && raw.moodRating !== null) {
    const m = money(raw.moodRating);
    if (![1, 2, 3, 4, 5].includes(m)) errors.push('moodRating: expected 1-5');
    else session.moodRating = m;
  }

  const tiltNote = str(raw.tiltNote, 500);
  if (tiltNote) session.tiltNote = tiltNote;
  const journal = str(raw.journal, 2000);
  if (journal) session.journal = journal;

  if (raw.tags !== undefined && raw.tags !== null) {
    if (!Array.isArray(raw.tags)) errors.push('tags: expected an array of strings');
    else {
      const tags = raw.tags.map((t) => str(t, 32)).filter(Boolean).slice(0, 10);
      if (tags.length) session.tags = tags;
    }
  }

  if (errors.length) return { ok: false, errors, notes, session: null };

  if (!session.id) session.id = sessionId(session);
  // An MTT with no entries stated is one entry: the only inference in here, and only because "I
  // played the Sunday Major" cannot mean zero.
  if (session.isMTT && session.entries === undefined) {
    session.entries = 1;
    notes.push('entries defaulted to 1');
  }
  return { ok: true, errors: [], notes, session };
}

// One line a human can check at a glance, which is the whole point of dryRun:
// "2026-09-08 · Parx · 2/5 PLO · in 300, out 1,150, 5h → +850".
function describeSession(s) {
  const m = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US');
  const sign = s.result >= 0 ? '+' : '';
  return `${s.date} · ${s.venue} · ${s.gameLabel} · in ${m(s.buyInTotal)}, out ${m(s.cashOut)}, ${s.hours}h → ${sign}${m(s.result)}`;
}

module.exports = { normalizeSession, describeSession, sessionId, etDay, FORMATS, MAX_MONEY, MAX_HOURS };
