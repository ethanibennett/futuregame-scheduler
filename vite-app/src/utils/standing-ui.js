/* The standing agreements' UI (components/StandingView.jsx, the Staking tab; docs/bankroll-merge.md
 * Phase 8) and the "Posts to backers" line on the result forms: the wording and the request bodies,
 * free of the DOM so node can test them (utils/__tests__/standing-ui.test.mjs).
 *
 * The data is Phase 7's routes (lib/staking/live.js): GET /api/staking/standing lists the player's
 * agreements with the engine's own format keys; nothing here adds up a share. Figures are the
 * server's, worded with the backer page's formatters so they read the same everywhere.
 */
import { fmtSignedCents, fmtShort, plural, tone } from './backer-page.js';

export { fmtSignedCents, plural, tone };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const text = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
export const CHANNEL_WORD = { any: 'live and online', live: 'live', online: 'online' };

/** A percentage as the stake is written: 20 -> "20%", 12.5 -> "12.5%". */
export const fmtPct = (p) => `${Math.round(num(p) * 100) / 100}%`;

/** The list made safe to draw. */
export function normaliseList(data) {
  const d = data && typeof data === 'object' ? data : {};
  const formats = (Array.isArray(d.formats) ? d.formats : []).filter((f) => f && typeof f.key === 'string').map((f) => ({ key: f.key, label: text(f.label) || f.key }));
  return {
    formats: formats.length ? formats : [{ key: 'all', label: 'Every game' }],
    channels: Array.isArray(d.channels) && d.channels.length ? d.channels.map(text) : ['any', 'live', 'online'],
    agreements: (Array.isArray(d.agreements) ? d.agreements : []).filter((a) => a && typeof a === 'object').map((a) => ({
      id: num(a.id),
      backer: { id: num(a.backer && a.backer.id), key: text(a.backer && a.backer.key), name: text(a.backer && a.backer.name).trim() || 'Unnamed backer', link: text(a.backer && a.backer.link) || null, hasLink: !!(a.backer && a.backer.hasLink) },
      status: a.status === 'ended' ? 'ended' : 'active', active: !!a.active,
      effectiveFrom: text(a.effectiveFrom), effectiveTo: text(a.effectiveTo) || null,
      openingCents: num(a.openingCents), openingNote: text(a.openingNote) || null,
      stakes: (Array.isArray(a.stakes) ? a.stakes : []).map((s) => ({ id: num(s.id), format: text(s.format), channel: text(s.channel) || 'any', pct: num(s.pct), validFrom: text(s.validFrom), validTo: text(s.validTo) || null, inForce: !!s.inForce })),
      inForce: text(a.inForce),
      sharesCount: num(a.sharesCount), sharesCents: num(a.sharesCents), paidCents: num(a.paidCents), runningCents: num(a.runningCents),
      delivery: { sms: !!(a.delivery && a.delivery.sms), email: !!(a.delivery && a.delivery.email) },
    })),
  };
}

/** One stake in words: "20% PLO, live and online" / "10% every game, live". */
export function stakeWords(s, formats) {
  const f = (formats || []).find((x) => x.key === s.format);
  const game = s.format === 'all' ? 'every game' : (f ? f.label : s.format);
  return `${fmtPct(s.pct)} ${game}, ${CHANNEL_WORD[s.channel] || s.channel}`;
}

/**
 * An agreement's card: the title line, the status line, the stakes in force (or the stakes to
 * come), the money line and the link line.
 */
export function agreementView(a, { thisYear, today } = {}) {
  const from = fmtShort(a.effectiveFrom, thisYear);
  const status = a.status === 'ended'
    ? `Ended ${a.effectiveTo ? fmtShort(a.effectiveTo, thisYear) : ''}`.trim()
    : a.active ? `Since ${from}` : a.effectiveFrom > (today || '') ? `Starts ${from}` : `Since ${from}`;
  const current = a.stakes.filter((s) => s.inForce);
  return {
    key: a.id,
    name: a.backer.name,
    status,
    tone: a.status === 'ended' ? 'is-muted' : '',
    stakes: current.length ? a.inForce || current.map((s) => `${fmtPct(s.pct)} ${s.format}`).join(' · ') : 'No stakes in force',
    money: `${plural(a.sharesCount, 'share')} · ${fmtSignedCents(a.sharesCents)}` + (a.openingCents ? ` · opening ${fmtSignedCents(a.openingCents)}` : '') + (a.paidCents ? ` · paid ${fmtSignedCents(-a.paidCents)}` : ''),
    running: fmtSignedCents(a.runningCents),
    runningTone: tone(a.runningCents),
    link: a.backer.hasLink ? `Link ${a.backer.link || ''}`.trim() : 'No link yet',
    delivery: [a.delivery.sms ? 'texts on' : null, a.delivery.email ? 'weekly email on' : null].filter(Boolean).join(' · ') || 'no delivery set',
  };
}

/** The add form -> the POST body, or { error }. Pct and cents are checked here so the form can say so. */
/** The editor's rows -> clean stakes, or { error }. */
export function cleanStakes(rows) {
  const stakes = (rows || []).map((s) => ({ format: text(s.format) || 'all', channel: text(s.channel) || 'any', pct: Number(s.pct) }));
  if (!stakes.length) return { error: 'Add at least one stake.' };
  for (const s of stakes) if (!(s.pct > 0 && s.pct <= 100)) return { error: 'Each stake needs a percentage above 0 and at most 100.' };
  const seen = new Set();
  for (const s of stakes) { const k = `${s.format}|${s.channel}`; if (seen.has(k)) return { error: 'Two stakes name the same game and channel.' }; seen.add(k); }
  return { stakes };
}
export function toCreateBody(f) {
  const c = cleanStakes(f.stakes);
  if (c.error) return { error: c.error };
  const stakes = c.stakes;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(f.effectiveFrom))) return { error: 'Pick the day the agreement starts.' };
  const opening = f.openingCents === '' || f.openingCents == null ? 0 : Math.round(Number(f.openingCents) * 100);
  if (!Number.isFinite(opening)) return { error: 'The opening must be a dollar amount.' };
  const body = { effectiveFrom: f.effectiveFrom, openingCents: opening, stakes };
  if (f.openingNote) body.openingNote = text(f.openingNote).slice(0, 200);
  if (f.backerId && f.backerId !== 'new') body.backerId = Number(f.backerId);
  else {
    const name = text(f.newName).trim();
    if (!name) return { error: 'Name the backer.' };
    body.newBacker = { name };
    if (text(f.newPhone).trim()) body.newBacker.phone = text(f.newPhone).trim();
    if (text(f.newEmail).trim()) body.newBacker.email = text(f.newEmail).trim();
  }
  return { body };
}

/** The stakes editor's rows -> POST /:id/stakes body, or { error }. */
export function toStakesBody(rows, mode, confirm = false) {
  const c = cleanStakes(rows);
  if (c.error) return { error: c.error };
  return { body: { mode: mode === 'correct' ? 'correct' : 'from-today', stakes: c.stakes, ...(confirm ? { confirm: true } : {}) } };
}

/**
 * A payout form -> POST /:id/payments body, or { error }. direction 'out' = the player paid the
 * backer (+ cents), 'in' = the backer paid the player (− cents). Whole dollars, as the ledger keeps it.
 */
export function toPaymentBody({ amount, direction, paidOn, note }) {
  const n = Number(String(amount == null ? '' : amount).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return { error: 'Enter how much changed hands.' };
  if (!Number.isInteger(n)) return { error: 'A payout is in whole dollars.' };
  const body = { amountCents: (direction === 'in' ? -1 : 1) * n * 100 };
  if (paidOn) body.paidOn = paidOn;
  if (text(note).trim()) body.note = text(note).trim().slice(0, 200);
  return { body };
}
/** One payout as a line: "Oct 14 · You paid · −$500" (the backer's total goes down when they are paid). */
export function paymentView(p, { thisYear } = {}) {
  const out = num(p.amountCents) > 0;
  return { key: p.id, when: fmtShort(p.paidOn, thisYear), what: (out ? 'You paid' : 'They paid you') + (p.note ? ` · ${p.note}` : ''), amount: fmtSignedCents(-num(p.amountCents)), tone: tone(-num(p.amountCents)) };
}

/** The correction's preview: "2 shares change: −$155 in all for this backer". */
export function correctionText(pv) {
  const n = num(pv && pv.count);
  if (!n) return 'No recorded share changes.';
  return `${plural(n, 'share')} change${n === 1 ? 's' : ''}: ${fmtSignedCents(num(pv.totalDeltaCents))} in all for this backer.`;
}

/** A recorded share's line: "Oct 10 · NLH MTT · 30% of +$2,400" and its state. */
export function eventView(e, { thisYear } = {}) {
  const moved = e.sentShareCents != null && num(e.sentShareCents) !== num(e.shareCents);
  return {
    key: `${e.refTable || e.source}-${e.refId || ''}-${e.date}-${e.game}`,
    when: fmtShort(e.date, thisYear),
    what: `${e.game || 'Session'}${e.venue ? ` · ${e.venue}` : ''}`,
    detail: `${fmtPct(e.pct)} of ${fmtSignedCents(e.resultCents)}` + (e.source === 'dashboard' ? ' · from the dashboard' : moved ? ` · told ${fmtSignedCents(e.sentShareCents)}` : ''),
    share: fmtSignedCents(e.shareCents),
    shareTone: tone(e.shareCents),
    dashboard: e.source === 'dashboard',
    canExclude: e.source !== 'dashboard' && !!e.refTable && e.refId != null,
    revisions: Array.isArray(e.revisions) ? e.revisions.length : 0,
  };
}

/** A drift line: "Oct 10 · NLH MTT · Sam Okafor: +$240 → +$220". */
export function driftView(l, { thisYear } = {}) {
  return {
    key: `${l.refTable}-${l.refId}-${l.key}`,
    text: `${fmtShort(l.date, thisYear)} · ${l.game} · ${l.name || 'a backer'}: ${fmtSignedCents(l.shareCents)} → ${l.action === 'void' ? 'removed' : fmtSignedCents(l.freshShareCents)}`,
    refTable: l.refTable, refId: l.refId,
  };
}

/** The money state as one line. */
export function stateLine(s) {
  if (!s) return null;
  const posting = s.posting === 'off' ? 'Posting is off: Notify is refused until you turn it on.' : s.posting === 'on' ? 'Posting is on.' : 'Posting is on (unset).';
  const cut = s.cutover === 'live' ? ' Cutover live: this app owns the backers.' : s.cutover === 'imported' ? ' The dashboard is imported.' : '';
  return posting + cut;
}

// ── the "Posts to backers" line on a form ────────────────────────────────────────────────

/** The unsaved tournament result's query for GET /api/staking/standing/preview, or null. */
export function tournamentPreviewQuery({ tournament, numEntries, cashed, cashAmount, currency }) {
  const t = tournament;
  if (!t) return null;
  const n = Math.max(1, parseInt(numEntries, 10) || 1);
  const won = cashed ? Math.round(Number(cashAmount) || 0) : 0;
  const net = won - Math.round(Number(t.buyin) || 0) * n;
  return {
    kind: 'tournament', date: text(t.date).slice(0, 10), game: text(t.game_variant), online: Number(t.is_online) ? '1' : '0',
    resultCents: String(Math.round(net * 100)), currency: text(currency) || 'USD', tournamentId: String(t.id),
  };
}
/** The unsaved cash session's query (the net after tips and expenses, Q12), or null while it has no cash-out. */
export function cashPreviewQuery({ date, room, game, stakes, buyIn, cashOut, tips, expenses, currency }) {
  if (cashOut === '' || cashOut == null) return null;
  const net = (Number(cashOut) || 0) - (Number(buyIn) || 0) - (Number(tips) || 0) - (Number(expenses) || 0);
  return { kind: 'cash', date: text(date).slice(0, 10), game: text(game), room: text(room), resultCents: String(Math.round(net * 100)), currency: text(currency) || 'USD' };
}
export const toQueryString = (q) => Object.entries(q || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

// ── the Notify block's Q7 ask ────────────────────────────────────────────────────────────

/**
 * The confirm a flagged backer's Notify opens, per flag kind. A series overlap asks the owner's
 * answer (Q7) and stores it: "Both" sends the standing share and stops the flag; "Series only"
 * keeps this backer off the result for good. A dashboard-sent night asks "Send anyway".
 */
export function confirmActions(b) {
  const series = b.warnings.some((w) => w.kind === 'series');
  const dash = b.warnings.some((w) => w.kind === 'dashboard');
  if (series) {
    return [
      { label: 'Both', w: 7, body: { confirm: true, answers: { [b.key]: 'standing' } }, tone: 'warn', title: 'Send the standing share as well; the series agreement settles on its own' },
      { label: 'Series only', w: 10, body: { answers: { [b.key]: 'series' } }, tone: '', title: 'No standing share for this result, and no more asking' },
      ...(dash ? [] : []),
    ];
  }
  return [{ label: 'Send anyway', w: 11, body: { confirm: true }, tone: 'warn', title: 'The dashboard app already sent this night; send this share too' }];
}
