// The Settled handshake's wording, shared by the backer's page (components/BackerPage.jsx) and the
// owner's Backers card (components/BankrollBackers.jsx). Pure, so both read the same sentence for the
// same state. The server keeps the state (lib/staking/backer-settle.js); a balance goes to $0 once both
// sides have pressed. Signs are the page's: totalCents > 0 = the player owes the backer.
import { fmtSignedCents } from './backer-page.js';

// In whole dollars, the way the page's figure reads (utils/backer-page.js fmtSignedCents), unsigned.
const usd = (cents) => fmtSignedCents(Math.abs(Math.round(Number(cents) || 0))).replace(/^\+/, '');

const dayET = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  } catch { return ''; }
};

/**
 * What one side sees. side 'backer' | 'owner'; player = the player's first name (the page's "Ethan");
 * backer = the backer's name. -> null (nothing to show) or
 *   { button: { label, action: 'confirm' | 'undo', primary } | null, status, confirm: string | null,
 *     part: { label, prompt } | null }
 * `confirm` is the question asked before a confirm press is sent. `part` (owner, 2026-10-23: a partial
 * settlement, for Zelle limits) is offered beside a fresh Settled: its prompt asks for the dollar amount,
 * and partCents(answer, totalCents) turns the answer into the request's settleCents. An open part reads
 * "$500 of $1,200".
 */
export function settleView({ settlement, totalCents, side, player = 'Ethan', backer = 'your backer' }) {
  const total = Math.round(Number(totalCents) || 0);
  const s = settlement || null;
  const open = s && s.open ? s.open : null;
  if (total === 0 && !open) {
    return s && s.last ? { button: null, status: `Settled ${dayET(s.last.at)}`, confirm: null, part: null } : null;
  }
  const amt = usd(total);
  const me = side === 'owner' ? 'ownerAt' : 'backerAt';
  const them = side === 'owner' ? 'backerAt' : 'ownerAt';
  const other = side === 'owner' ? backer : player;
  // An open part: the amount it clears, against the balance it is a part of.
  const openAmt = open && Number.isFinite(Number(open.amountCents)) ? Math.round(Number(open.amountCents)) : total;
  const isPart = !!open && openAmt !== total;
  const partAmt = usd(openAmt);
  const shown = isPart ? `${partAmt} of ${amt}` : amt;
  const done = isPart
    ? `${partAmt} comes off the balance once you have both confirmed; ${usd(total - openAmt)} stays owed.`
    : "Last week's balance clears once you have both confirmed; this week carries on.";
  // Who sends the money: + = the player pays the backer.
  const question = side === 'owner'
    ? (total > 0 ? `Confirm you have paid ${backer} ${partAmt}?` : `Confirm ${backer} has paid you ${partAmt}?`)
    : (total > 0 ? `Confirm ${player} has paid you ${partAmt}?` : `Confirm you have paid ${player} ${partAmt}?`);
  if (open && open[me] && !open[them]) {
    return { button: { label: 'Undo', action: 'undo', primary: false }, status: `You marked ${shown} settled · waiting for ${other}`, confirm: null, part: null };
  }
  if (open && open[them] && !open[me]) {
    return { button: { label: 'Confirm', action: 'confirm', primary: true }, status: `${other} marked ${shown} settled`, confirm: `${question} ${done}`, part: null };
  }
  const when = side === 'owner'
    ? (total > 0 ? `Once you have sent ${backer} ${amt}` : `Once ${backer} has paid you ${amt}`)
    : (total > 0 ? `Once ${player} has paid you ${amt}` : `Once you have sent ${player} ${amt}`);
  const partPrompt = side === 'owner'
    ? (total > 0 ? `How much of the ${amt} have you sent ${backer}? (dollars)` : `How much of the ${amt} has ${backer} paid you? (dollars)`)
    : (total > 0 ? `How much of the ${amt} has ${player} paid you? (dollars)` : `How much of the ${amt} have you sent ${player}? (dollars)`);
  return {
    button: { label: 'Settled', action: 'confirm', primary: true }, status: when, confirm: `${question} ${done}`,
    part: { label: 'Part', prompt: partPrompt },
  };
}

/** A part's dollar answer ("500", "$1,200.50") -> settleCents, signed like the balance, or null when it
 *  is not a number, is $0, or is not short of the balance (that is the Settled button's job). */
export function partCents(answer, totalCents) {
  const total = Math.round(Number(totalCents) || 0);
  const n = Number(String(answer == null ? '' : answer).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const cents = Math.round(n * 100) * (total < 0 ? -1 : 1);
  if (Math.abs(cents) >= Math.abs(total)) return null;
  return cents;
}
