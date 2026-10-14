/* The Backers block on a result (components/BackerNotify.jsx): its wording, free of the DOM and of
 * utils.js (which reads localStorage at load) so node can test it
 * (utils/__tests__/backer-notify.test.mjs).
 *
 * The data is POST /api/staking/standing/notify (lib/staking/notify.js): the owner's backers staked
 * in one result, each with the pct and share the SERVER computed, and whether it has been sent.
 * Nothing here adds up, rounds or recomputes a share: it words what the server sent, with the
 * backer page's own formatters (utils/backer-page.js), so a figure reads the same here as on the
 * backer's page.
 *
 *   { result: { refTable, refId, kind, date, game, venue, hours, currency, nativeCents, resultCents },
 *     backers: [{ key, name, pct, shareCents, resultCents, status: 'new'|'sent', sentAt, sentShareCents,
 *                 updated, warnings: [{ kind: 'dashboard', date, game, venue, shareCents } |
 *                                     { kind: 'series', series: [name] }] }],
 *     pending, sent, needsConfirm, state: 'none'|'preview'|'partial'|'sent', rosterSize, delivery: 'on'|'off' }
 */
import { fmtSignedCents, fmtShort, plural, tone } from './backer-page.js';

export { fmtSignedCents };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const text = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export const NO_NAME = 'Unnamed backer';

/** The response made safe to draw: an unexpected shape is null, a missing field a quiet default. */
export function normalise(data) {
  if (!data || typeof data !== 'object' || !data.result || !Array.isArray(data.backers)) return null;
  const r = data.result;
  return {
    result: {
      refTable: text(r.refTable), refId: num(r.refId), kind: r.kind === 'cash' ? 'cash' : 'tournament',
      date: text(r.date), game: text(r.game).trim(), venue: text(r.venue), resultCents: num(r.resultCents),
      currency: text(r.currency) || 'USD',
    },
    backers: data.backers.filter((b) => b && typeof b === 'object').map((b, i) => ({
      key: text(b.key) || `backer-${i}`,
      name: text(b.name).trim() || null,
      pct: num(b.pct),
      shareCents: num(b.shareCents),
      resultCents: num(b.resultCents),
      status: b.status === 'sent' ? 'sent' : 'new',
      sentAt: Number.isFinite(Number(b.sentAt)) && b.sentAt != null ? Number(b.sentAt) : null,
      updated: !!b.updated,
      warnings: (Array.isArray(b.warnings) ? b.warnings : []).filter((w) => w && (w.kind === 'dashboard' || w.kind === 'series')).map((w) => (
        w.kind === 'dashboard'
          ? { kind: 'dashboard', date: text(w.date), game: text(w.game), shareCents: num(w.shareCents) }
          : { kind: 'series', series: (Array.isArray(w.series) ? w.series : []).map(text).filter(Boolean) }
      )),
    })),
    pending: Math.max(0, Math.floor(num(data.pending))),
    sent: Math.max(0, Math.floor(num(data.sent))),
    needsConfirm: !!data.needsConfirm,
    state: ['none', 'preview', 'partial', 'sent'].includes(data.state) ? data.state : 'none',
    rosterSize: Math.max(0, Math.floor(num(data.rosterSize))),
    delivery: data.delivery === 'on' ? 'on' : 'off',
  };
}

/** A percentage as the stake is written: 20 -> "20%", 12.5 -> "12.5%", and no float noise. */
export function fmtPct(p) {
  return `${Math.round(num(p) * 100) / 100}%`;
}

/** The local calendar day of a moment (ms), YYYY-MM-DD. */
export function dayOfMs(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The game the block is about, as the server labels it ("NLH MTT", "2/5 NLH"). */
const gameOf = (block) => (block && block.result && block.result.game) || 'this game';

/** The block's title: "Backers · NLH MTT". */
export const blockTitle = (block) => `Backers · ${gameOf(block)}`;

/** No stake matched (the dashboard's words): "No backers staked in Razz MTT." */
export const emptyText = (block) => `No backers staked in ${gameOf(block)}.`;

/** One "the dashboard sent" or "a series covers it" line under a backer. */
export function warningText(w, thisYear) {
  if (w.kind === 'dashboard') {
    return `The dashboard sent ${fmtSignedCents(w.shareCents)} on ${fmtShort(w.date, thisYear)}${w.game ? ` (${w.game})` : ''}`;
  }
  return `Also backs this event in ${w.series.length ? w.series.join(', ') : 'a series'}`;
}

/**
 * One backer's row: the name with their share at the right (green up, red down), then
 * "20% of +$1,240 · Not sent" (or "Sent Oct 14", "Sent Oct 14 · Updated" when a later edit moved
 * the share), then any warning, one line each.
 *   opts: { thisYear, dayOf } (dayOf turns sentAt ms into YYYY-MM-DD; the local day by default)
 */
export function rowView(b, { thisYear, dayOf = dayOfMs } = {}) {
  const status = b.status === 'sent'
    ? `Sent ${b.sentAt != null ? fmtShort(dayOf(b.sentAt), thisYear) : ''}`.trim() + (b.updated ? ' · Updated' : '')
    : 'Not sent';
  return {
    key: b.key,
    name: b.name || NO_NAME,
    share: fmtSignedCents(b.shareCents),
    shareTone: tone(b.shareCents),
    detail: `${fmtPct(b.pct)} of ${fmtSignedCents(b.resultCents)} · ${status}`,
    warnings: b.warnings.map((w) => warningText(w, thisYear)),
  };
}

/** The Notify button: "Notify 2 backers". */
export const notifyLabel = (n) => `Notify ${plural(Math.max(0, n), 'backer')}`;

const listOf = (names) => {
  const a = names.filter(Boolean);
  if (a.length <= 1) return a[0] || 'A backer';
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
};

/**
 * The second confirm, when a new share may double one the backer already has: the dashboard app
 * sent them a share on the same date, or a series agreement covers this event (owner Q7).
 */
export function confirmText(block, { thisYear } = {}) {
  const pending = block.backers.filter((b) => b.status === 'new');
  const warned = pending.filter((b) => b.warnings.length);
  const what = pending.length === 1 ? 'the share' : `all ${pending.length} shares`;
  if (warned.length !== 1) {
    return `${listOf(warned.map((b) => b.name || NO_NAME))} may already have this night: the lines under each name say why. Send ${what} anyway?`;
  }
  const w = warned[0].warnings;
  const dates = [...new Set(w.filter((x) => x.kind === 'dashboard').map((x) => fmtShort(x.date, thisYear)))];
  const why = [
    dates.length ? `the dashboard app sent a share on ${dates.join(', ')}` : null,
    w.some((x) => x.kind === 'series') ? 'a series agreement covers this event' : null,
  ].filter(Boolean).join(', and ');
  return `${warned[0].name || NO_NAME} may already have this night: ${why}. Send ${what} anyway?`;
}

/** The line under the block: what a tap does here, or what an edit does once it is sent. */
export function footNote(block) {
  if (!block || !block.backers.length) return null;
  if (block.pending > 0) {
    return block.delivery === 'on'
      ? 'Nothing posts on save. Notify records each share on its page and messages that backer once.'
      : 'Delivery is off on this server: Notify records the shares on their pages and messages nobody.';
  }
  return 'Sent. An edit to this result updates their pages without telling them.';
}

/** The toast after a tap, from the server's answer. */
export function sentToast(data) {
  const d = data || {};
  if (d.already) return 'Already sent. Nothing new to send.';
  const n = Math.max(0, Math.floor(num(d.sentNow)));
  if (!n) return 'Nothing to send.';
  if (d.delivery !== 'on') return `Recorded for ${plural(n, 'backer')}. Delivery is off on this server.`;
  const noPush = (Array.isArray(d.results) ? d.results : []).filter((r) => r && !num(r.subs)).length;
  return `Sent to ${plural(n, 'backer')}${noPush ? ` · ${noPush} not on push yet` : ''}`;
}
