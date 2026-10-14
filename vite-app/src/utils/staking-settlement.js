// The staking settlement sheet's view logic (docs/bankroll-merge.md §10), out of StakingView.jsx so
// it is tested with node --test (src/utils/__tests__/staking-settlement.test.mjs).
//
// The server computes every figure (lib/staking/settlement.js). Nothing here is arithmetic on
// money beyond formatting: the panel shows what the sheet says, and collects the three inputs a
// person supplies (what a backer prepaid, an adjustment with its note, the other player's result
// on a swap or crossbook), which are sent back for the server to recompute.
//
// Sign: an entry's amountOwed is from the player's side: + the player pays the backer
// (direction 'to_backer'), − the backer pays the player ('to_player').
import { CURRENCY_CONFIG, MINUS } from './utils.js';

export const BACKER_TYPE_LABELS = {
  pay_per_play: 'Pay Per Play',
  open_commitment: 'Open Commitment',
  budget_capped: 'Budget Capped',
  flat_package: 'Flat Package',
  profit_share_only: 'Profit Share',
  makeup: 'Makeup',
  tiered_markup: 'Tiered Markup',
  swap: 'Swap',
  crossbook: 'Crossbook',
};

export const isMutual = (e) => !!e && (e.backerType === 'swap' || e.backerType === 'crossbook');

/** Money to the cent, cents shown only when there are some: $1,455 · $299.50 · −€120. */
export function fmtSettle(v, currency = 'USD', { sign = false } = {}) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const cfg = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG.USD;
  const abs = Math.abs(n);
  const cents = Math.round(abs * 100) % 100 !== 0;
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
  const s = n < 0 ? MINUS : sign && n > 0 ? '+' : '';
  return cfg.pos === 'suf' ? `${s}${body} ${cfg.symbol}` : `${s}${cfg.symbol}${body}`;
}

/** The Paid toggle exists only for a stored settlement row. */
export const canMarkPaid = (entry) => !!(entry && entry.id);

/** Finalize shows on an unsettled sheet that has something to settle. */
export const showFinalize = (data) => !!data && !data.isSettled && Array.isArray(data.settlements) && data.settlements.length > 0;

/** "Pay Per Play · 10% · 1.2x", "Swap · 5% / 5%", "Profit Share · 5% of profit". */
export function typeLine(e) {
  const label = BACKER_TYPE_LABELS[e.backerType] || e.backerType || '';
  if (isMutual(e)) return `${label} · ${e.myPct ?? 0}% / ${e.theirPct ?? 0}%`;
  if (e.backerType === 'profit_share_only') return `${label} · ${e.percentage || 0}% of profit`;
  return `${label} · ${e.percentage || 0}%${e.markup > 1 ? ` · ${e.markup}x` : ''}`;
}

/** The headline: who pays whom. tone 'in' (money to the player), 'out', or 'none'. */
export function owedLine(e, currency = 'USD') {
  const name = e.backerName || 'Backer';
  const amt = fmtSettle(Math.abs(e.amountOwed || 0), currency);
  if (e.direction === 'to_backer' || e.amountOwed > 0) return { text: `You pay ${name} ${amt}`, tone: 'out' };
  if (e.direction === 'to_player' || e.amountOwed < 0) return { text: `${name} pays you ${amt}`, tone: 'in' };
  return { text: 'Nothing to pay', tone: 'none' };
}

/**
 * The figures shown on a card, in order: [{ key, label, value }]. Inputs are not here (the panel
 * renders those where the matching line would be, while the series is unsettled).
 */
export function settlementLines(e, currency = 'USD') {
  const f = (v, o) => fmtSettle(v, currency, o);
  const out = [];
  const add = (key, label, value) => out.push({ key, label, value });
  if (e.legacy) {
    add('investment', 'Invested', f(e.grossInvestment));
    add('return', 'Returned', f(e.grossReturn));
    if (e.markupAmount > 0) add('markup', 'Markup', f(e.markupAmount));
    return out;
  }
  if (isMutual(e)) {
    const basis = e.resultBasis === 'net' ? 'net' : 'cashes';
    add('mine', `My ${basis}`, f(e.myResult));
    add('theirs', `Their ${basis}`, e.partnerResult == null ? '—' : f(e.partnerResult));
    if (e.mode === 'bet') add('difference', 'Difference', f(e.difference, { sign: true }));
    else { add('mineToThem', 'Mine to them', f(e.mineToThem)); add('theirsToMe', 'Theirs to me', f(e.theirsToMe)); }
  } else if (e.backerType === 'profit_share_only') {
    add('return', 'Profit share', f(e.grossReturn));
    if (e.prepaid > 0) add('prepaid', 'Prepaid', f(e.prepaid));
  } else {
    add('investment', 'Piece', f(e.grossInvestment));
    if (e.markupAmount > 0) add('markup', 'Markup in it', f(e.markupAmount));
    add('prepaid', 'Prepaid', f(e.prepaid));
    add('return', 'Share of cashes', f(e.grossReturn));
    if (e.budgetCap != null) add('budget', 'Budget left', `${f(e.budgetLeft)} of ${f(e.budgetCap)}`);
    if (e.refund > 0) add('refund', e.backerType === 'budget_capped' ? 'Unused budget' : 'Refund (not played)', f(e.refund));
    if (e.unpaid > 0) add('unpaid', 'Piece not paid', f(e.unpaid));
  }
  if (e.backerType === 'makeup' && e.makeupOpening != null) {
    add('makeupIn', 'Makeup in', f(e.makeupOpening));
    add('makeupOut', 'Makeup out', f(e.makeupClosing));
  }
  if (e.adjustment) add('adjustment', e.adjustmentNote ? `Adjusted: ${e.adjustmentNote}` : 'Adjusted', f(e.adjustment, { sign: true }));
  return out;
}

const parseAmount = (raw) => {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[,\s$€£]/g, '').replace('−', '-');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * The settle / preview body from the panel's drafts:
 *   drafts = { [agreementId]: { prepaid?, adjustment?, note?, partner? } }   (strings as typed)
 * -> { body, errors: [agreementId…] } — a draft that is not a number is an error, a blank is left out.
 */
export function inputsBody(drafts) {
  const body = { prepaid: [], adjustments: [], partner: [] };
  const errors = [];
  for (const [id, d] of Object.entries(drafts || {})) {
    const agreementId = Number(id);
    if (!d) continue;
    for (const [field, list] of [['prepaid', body.prepaid], ['adjustment', body.adjustments], ['partner', body.partner]]) {
      const n = parseAmount(d[field]);
      if (n === null) continue;
      if (Number.isNaN(n)) { if (!errors.includes(agreementId)) errors.push(agreementId); continue; }
      const item = { agreementId, amount: n };
      if (field === 'adjustment' && d.note && String(d.note).trim()) item.note = String(d.note).trim();
      list.push(item);
    }
  }
  for (const k of Object.keys(body)) if (!body[k].length) delete body[k];
  return { body, errors };
}

/** Swaps and crossbooks still waiting for the other player's result (Finalize stays off). */
export function missingPartner(data, drafts) {
  if (!data || data.isSettled) return [];
  return (data.settlements || []).filter((e) => isMutual(e) && parseAmount((drafts || {})[e.agreementId]?.partner) == null).map((e) => e.agreementId);
}

/** A paid row's ledger line: "In the ledger: Main, −$300 on 2026-07-02" (or why there is none). */
export function paidLine(e, bankroll, currency = 'USD') {
  if (!e || !e.isPaid) return null;
  const when = e.paidAt ? String(e.paidAt).slice(0, 10) : null;
  if (!e.ledger) return { text: `Paid${when ? ` · ${when}` : ''}${e.amountOwed ? ' · not in the ledger (marked before it was)' : ''}` };
  const cur = (bankroll && bankroll.currency) || currency;
  return { text: `Paid · ${e.ledger.date} · ${(bankroll && bankroll.name) || 'Main'} ${fmtSettle(e.ledger.amount, cur, { sign: true })}` };
}

/** The sheet's foot: what goes out and what comes in. */
export function totalsLine(data) {
  if (!data || !data.totals) return null;
  const cur = data.currency || 'USD';
  const parts = [];
  if (data.totals.toBackers > 0) parts.push(`You pay ${fmtSettle(data.totals.toBackers, cur)}`);
  if (data.totals.toPlayer > 0) parts.push(`backers pay you ${fmtSettle(data.totals.toPlayer, cur)}`);
  if (!parts.length) return 'Nothing changes hands';
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
