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
import { fmtCents, fmtSignedCents, fmtHours, fmtShort, plural, tone, bbStats, fmtPct } from './backer-page.js';

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

export { fmtPct };

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
    // What Settled settles: the total less this week's shares (server: lib/staking/backer-settle.js).
    dueCents: b.dueCents == null ? num(b.cumulativeCents) : num(b.dueCents),
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
    // The Sunday noon Discord reminder: the id's last four digits when one is on file, else null.
    discord: b.discord && typeof b.discord === 'object' && text(b.discord.hint) ? { hint: text(b.discord.hint) } : null,
    // Payment records (owner, 2026-10-24): completed settlements, partial payments and payouts.
    payments: (Array.isArray(b.payments) ? b.payments : []).filter((x) => x && typeof x === 'object').map((x) => ({
      date: text(x.date), at: text(x.at), amountCents: num(x.amountCents), kind: text(x.kind),
    })),
  }));
}

/** The open card's rows: the shares shown with the payments of the same span laid in by date, newest
 *  first, a payment above the sessions of its day. [{ type: 'share', s } | { type: 'payment', p }] */
export function cardRows(b) {
  const shares = b.shares.map((s) => ({ type: 'share', s, date: s.date }));
  const oldest = shares.length ? shares[shares.length - 1].date : '';
  const pays = b.payments.filter((p) => !oldest || p.date >= oldest).map((p) => ({ type: 'payment', p, date: p.date }));
  return [...shares, ...pays].sort((a, c) => c.date.localeCompare(a.date) || (a.type === c.type ? 0 : a.type === 'payment' ? -1 : 1));
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

// ── Bankroll design upgrades, part C ─────────────────────────────────────────────────────────
/**
 * The list's two sides (Bankroll design 51), in the owner's terms: + cumulativeCents is what the player owes a
 * backer. → { owedToYou, youOwe (cents, both positive), nOwed, nOwe, toConfirm (backers who pressed and wait for
 * the player), oweBefore (what the player owes from before this week) }.
 */
export function ledgerSides(backers) {
  const s = { owedToYou: 0, youOwe: 0, nOwed: 0, nOwe: 0, toConfirm: 0, oweBefore: 0 };
  for (const b of backers || []) {
    const c = Math.round(Number(b.cumulativeCents) || 0);
    if (c < 0) { s.owedToYou += -c; s.nOwed += 1; } else if (c > 0) { s.youOwe += c; s.nOwe += 1; if (b.dueCents > 0) s.oweBefore += Math.round(b.dueCents); }
    const o = b.settlement && b.settlement.open;
    if (o && o.backerAt && !o.ownerAt) s.toConfirm += 1;
  }
  return s;
}
/** Two initials for a backer's tile (Bankroll design 56): the first and last name's, or the one name's first two. */
export function monogram(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
/** Whether a backer's half-confirmed settlement waits on the player (Bankroll design 58). */
export const needsYou = (b) => !!(b.settlement && b.settlement.open && b.settlement.open.backerAt && !b.settlement.open.ownerAt);
/**
 * A long roster by state (Bankroll design 58): who needs the player first, then the open balances by their
 * size, then the all-square. → [{ key, label, backers, netCents? }] (empty groups left out).
 */
export function backerGroups(backers) {
  const needs = [], open = [], square = [];
  for (const b of backers || []) {
    const c = Math.round(Number(b.cumulativeCents) || 0);
    if (needsYou(b)) needs.push(b); else if (c !== 0 || (b.settlement && b.settlement.open)) open.push(b); else square.push(b);
  }
  open.sort((a, c) => Math.abs(c.cumulativeCents) - Math.abs(a.cumulativeCents));
  return [
    { key: 'needs', label: 'Needs you', backers: needs },
    { key: 'open', label: 'Open', backers: open, netCents: open.reduce((t, b) => t + Math.round(Number(b.cumulativeCents) || 0), 0) },
    { key: 'square', label: 'All square', backers: square },
  ].filter((g) => g.backers.length);
}
/**
 * An open card's rows grouped at the settlement line (Bankroll design 54): the shares dated in the week in
 * progress (on or after `weekStart`, the last Sunday's date in New York), then the earlier weeks still owed
 * (down to the last completed payment, which its band already marks). → [{ key, rows, sumCents }].
 */
export function weekGroups(rows, weekStart) {
  const week = [], earlier = [];
  let past = false;
  for (const row of rows || []) {
    if (row.type === 'payment') past = true;
    if (!past && row.type === 'share' && row.date >= weekStart) week.push(row);
    else if (!past) earlier.push(row);
  }
  const sum = (list) => list.reduce((t, r) => t + (r.type === 'share' ? Math.round(Number(r.s.shareCents) || 0) : 0), 0);
  return { week, earlier, weekSum: sum(week), earlierSum: sum(earlier) };
}
