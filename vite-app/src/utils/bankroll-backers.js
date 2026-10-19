/* The bankroll dashboard's Backers tab (components/BankrollBackers.jsx): its pure arithmetic and
 * wording, free of the DOM and of utils.js (which reads localStorage at load) so node can test it
 * (utils/__tests__/bankroll-backers.test.mjs).
 *
 * The data is GET /api/staking/standing/backers (lib/backer-surface.js backersView), the owner's
 * roster built through each backer's own feed, so every figure here is one the backer's /b/ page
 * shows. Nothing in this file adds up, rounds or recomputes a share: it formats what the server
 * sent, with the page's own formatters (utils/backer-page.js), so a figure reads the same here as
 * there.
 *
 *   { backers: [{ id, name, stakes, openingCents, cumulativeCents, sessions, hours,
 *                 shares: [{ date, game, venue, hours, sessionResultCents, pct, shareCents }],
 *                 played: [[game, hours, sessionResultCents], ...]   every event the page holds,
 *                 delivery: { sms, email }, link }] }
 * `played` is for bb/hr alone (bbItems below): the player's blinds per hour over the same events
 * the backer's page works it out from, with the page's own function (backer-page.js bbStats).
 */
import { fmtCents, fmtSignedCents, fmtHours, fmtShort, plural, tone, bbStats } from './backer-page.js';

export { fmtCents, fmtSignedCents, fmtHours, fmtShort, plural };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const text = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export const NO_NAME = 'Unnamed backer';
export const NO_STAKES = 'No stakes in force';

/** The tone class a signed figure takes in the bankroll sheet: ' an-pos', ' an-neg' or ''. By
 *  whole dollars (backer-page.js tone), so a figure that reads "$0" is never coloured. */
export function toneClass(cents) {
  const t = tone(cents);
  return t === 'is-pos' ? ' an-pos' : t === 'is-neg' ? ' an-neg' : '';
}

/** A percentage as the stake is written: 20 -> "20%", 12.5 -> "12.5%", and no float noise. */
export function fmtPct(p) {
  return `${Math.round(num(p) * 100) / 100}%`;
}

/**
 * The response made safe to draw: an unexpected shape is an empty list, a missing field a quiet
 * default. The link is kept only when it is an https URL, since it goes into an href.
 */
export function normalise(data) {
  const list = data && Array.isArray(data.backers) ? data.backers : [];
  return list.filter((b) => b && typeof b === 'object').map((b, i) => ({
    id: text(b.id) || `backer-${i}`,
    name: text(b.name).trim() || null,
    stakes: text(b.stakes).trim(),
    openingCents: num(b.openingCents),
    cumulativeCents: num(b.cumulativeCents),
    sessions: Math.max(0, Math.floor(num(b.sessions))),
    hours: num(b.hours),
    shares: (Array.isArray(b.shares) ? b.shares : []).filter((s) => s && typeof s === 'object').map((s) => ({
      date: text(s.date), game: text(s.game), venue: text(s.venue), hours: num(s.hours),
      sessionResultCents: num(s.sessionResultCents), pct: num(s.pct), shareCents: num(s.shareCents),
    })),
    played: (Array.isArray(b.played) ? b.played : []).filter((p) => Array.isArray(p)).map((p) => [text(p[0]), num(p[1]), num(p[2])]),
    delivery: { sms: !!(b.delivery && b.delivery.sms), email: !!(b.delivery && b.delivery.email) },
    link: /^https:\/\//.test(text(b.link)) ? text(b.link) : '',
    // The Settled handshake's state (lib/staking/backer-settle.js), as the backer's page has it.
    settlement: b.settlement && typeof b.settlement === 'object' ? b.settlement : null,
  }));
}

/** The card's title: the backer's name, or a stand-in for a record that has none. */
export const displayName = (b) => b.name || NO_NAME;

/** The line under the name: the stakes in force, as the page words them. */
export const stakesLine = (b) => b.stakes || NO_STAKES;

/** The card's stats line: sessions, hours, the opening balance. [{ key, text }] */
export function statItems(b) {
  return [
    { key: 'sessions', text: plural(b.sessions, 'session') },
    { key: 'hours', text: fmtHours(b.hours) },
    { key: 'opening', text: `Opening ${fmtCents(b.openingCents)}` },
  ];
}

/**
 * The card's second stats line: the player's bb/hr (BB/hr for limit games) over the backer's cash
 * sessions, as the backer's page shows it. [{ key, text ("+3.4 bb/hr"), tone (' an-pos' | ' an-neg' | '') }];
 * empty when no session names its big blind and has hours (no line is drawn, nothing is zero).
 */
export function bbItems(b) {
  const events = ((b && b.played) || []).map(([game, hours, sessionResultCents]) => ({ game, hours, sessionResultCents }));
  return bbStats(events).map((f) => ({
    key: 'bb-' + f.unit, text: f.full, tone: f.tone === 'is-pos' ? ' an-pos' : f.tone === 'is-neg' ? ' an-neg' : '',
    label: `${f.text} ${f.unit === 'BB' ? 'big bets' : 'big blinds'} per hour over ${f.n} ${f.n === 1 ? 'session' : 'sessions'}`,
  }));
}

/** Whether texts and the weekly email are set up, in the words the card shows (and the longer
 *  ones a screen reader gets). The number and the address never reach the browser; only whether
 *  each is on file. */
export function deliveryText(d) {
  const sms = !!(d && d.sms), email = !!(d && d.email);
  if (sms && email) return { short: 'SMS • Email', long: 'Texts and the weekly email are set up' };
  if (sms) return { short: 'SMS only', long: 'Texts are set up; the weekly email is not' };
  if (email) return { short: 'Email only', long: 'The weekly email is set up; texts are not' };
  return { short: 'No delivery', long: 'Neither texts nor the weekly email are set up' };
}

/** One share row, formatted: date and hours (left), game and venue, the backer's cut (right, with
 *  its tone) and "20% of +$840" (the percentage of the session's result that made it). */
export function shareRow(s, thisYear) {
  return {
    date: fmtShort(s.date, thisYear),
    hours: s.hours ? fmtHours(s.hours) : '',
    game: s.game || 'Session',
    venue: s.venue || '',
    share: fmtSignedCents(s.shareCents),
    shareTone: toneClass(s.shareCents),
    of: `${fmtPct(s.pct)} of ${fmtSignedCents(s.sessionResultCents)}`,
  };
}

/** "10 of 250 sessions" under a card whose history is longer than the ten rows it shows, else null. */
export function moreLine(b) {
  return b.sessions > b.shares.length && b.shares.length > 0
    ? `Last ${b.shares.length} of ${b.sessions.toLocaleString('en-US')} sessions`
    : null;
}

/** The list's heading figures: how many backers, how many sessions they share, and what the
 *  backers are up in all (the sum of their running totals, each as their page shows it). */
export function listSummary(backers) {
  return backers.reduce((a, b) => ({
    count: a.count + 1,
    sessions: a.sessions + b.sessions,
    totalCents: a.totalCents + b.cumulativeCents,
  }), { count: 0, sessions: 0, totalCents: 0 });
}
