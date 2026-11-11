// The Settled handshake's wording, shared by the backer's page (components/BackerPage.jsx) and the
// owner's Backers card (components/BankrollBackers.jsx). Pure, so both read the same sentence for the
// same state. The server keeps the state (lib/staking/backer-settle.js); a balance goes to $0 once both
// sides have pressed. Signs are the page's: totalCents > 0 = the player owes the backer.
import { fmtSignedCents } from './backer-page.js';
import { parseMoney } from './money.js';

// In whole dollars, the way the page's figure reads (utils/backer-page.js fmtSignedCents), unsigned.
export const usd = (cents) => fmtSignedCents(Math.abs(Math.round(Number(cents) || 0))).replace(/^\+/, '');

const dayET = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  } catch { return ''; }
};

/**
 * What one side sees. side 'backer' | 'owner'; player = the player's first name (the page's "Ethan");
 * backer = the backer's name.
 *   totalCents    what earlier weeks owe (Settled's figure)
 *   runningCents  the whole running total, this week included (a partial payment's ceiling)
 * -> null (nothing to show) or
 *   { button: { label, action: 'confirm' | 'undo', primary } | null, status, confirm: string | null,
 *     sendCents, part: { label, prompt, maxCents } | null }
 * `confirm` is the question asked before the button's press; sendCents is the balance that press sends
 * (amountCents: the server refuses a different one). `part` is the Partial payment button (owner,
 * 2026-10-23/24: "both sides need to be able to enter partial payments", for Zelle limits), offered
 * whenever the running total is not $0 and nothing is waiting: its prompt asks for dollars, partCents
 * turns the answer into settleCents, and the press sends runningCents as amountCents.
 */
export function settleView({ settlement, totalCents, runningCents, side, player = 'Ethan', backer = 'your backer' }) {
  const total = Math.round(Number(totalCents) || 0);
  const running = runningCents == null ? total : Math.round(Number(runningCents) || 0);
  const s = settlement || null;
  const open = s && s.open ? s.open : null;
  if (total === 0 && running === 0 && !open) {
    return s && s.last ? { button: null, status: `Settled ${dayET(s.last.at)}`, confirm: null, sendCents: 0, part: null } : null;
  }
  const me = side === 'owner' ? 'ownerAt' : 'backerAt';
  const them = side === 'owner' ? 'backerAt' : 'ownerAt';
  const other = side === 'owner' ? backer : player;

  if (open) {
    const isPart = open.kind === 'part';
    const base = Number.isFinite(Number(open.balanceCents)) ? Math.round(Number(open.balanceCents)) : (isPart ? running : total);
    const amtCents = Number.isFinite(Number(open.amountCents)) ? Math.round(Number(open.amountCents)) : base;
    const amt = usd(amtCents);
    const shown = isPart ? `a ${amt} payment` : amt;
    // Who sent it: + = the player pays the backer.
    const question = side === 'owner'
      ? (amtCents > 0 ? `Confirm you have paid ${backer} ${amt}?` : `Confirm ${backer} has paid you ${amt}?`)
      : (amtCents > 0 ? `Confirm ${player} has paid you ${amt}?` : `Confirm you have paid ${player} ${amt}?`);
    const after = isPart
      ? `${amt} comes off the balance once you have both confirmed; ${usd(base - amtCents)} stays owed.`
      : "Last week's balance clears once you have both confirmed; this week carries on.";
    if (open[me] && !open[them]) {
      return { button: { label: 'Undo', action: 'undo', primary: false }, status: `You marked ${shown} · waiting for ${other}`, confirm: null, sendCents: base, part: null };
    }
    if (open[them] && !open[me]) {
      return { button: { label: 'Confirm', action: 'confirm', primary: true }, status: `${other} marked ${shown}`, confirm: `${question} ${after}`, sendCents: base, part: null };
    }
  }

  const amt = usd(total);
  const part = running !== 0 ? {
    label: 'Partial payment',
    maxCents: running,
    prompt: side === 'owner'
      ? (running > 0 ? `How much have you sent ${backer}? Dollars, up to ${usd(running)}.` : `How much has ${backer} paid you? Dollars, up to ${usd(running)}.`)
      : (running > 0 ? `How much has ${player} paid you? Dollars, up to ${usd(running)}.` : `How much have you sent ${player}? Dollars, up to ${usd(running)}.`),
  } : null;
  if (total === 0) {
    // Nothing from earlier weeks: only a partial payment against this week's running total.
    return { button: null, status: 'This week settles Sunday', confirm: null, sendCents: running, part };
  }
  const question = side === 'owner'
    ? (total > 0 ? `Confirm you have paid ${backer} ${amt}?` : `Confirm ${backer} has paid you ${amt}?`)
    : (total > 0 ? `Confirm ${player} has paid you ${amt}?` : `Confirm you have paid ${player} ${amt}?`);
  const when = side === 'owner'
    ? (total > 0 ? `Once you have sent ${backer} ${amt}` : `Once ${backer} has paid you ${amt}`)
    : (total > 0 ? `Once ${player} has paid you ${amt}` : `Once you have sent ${player} ${amt}`);
  return {
    button: { label: 'Settled', action: 'confirm', primary: true }, status: when,
    confirm: `${question} Last week's balance clears once you have both confirmed; this week carries on.`,
    sendCents: total, part,
  };
}

/** A partial payment's dollar answer ("500", "$1,200.50") -> settleCents, signed like the running total,
 *  or null when it is not a number, is $0, or is more than the running total. */
export function partCents(answer, maxCents) {
  const max = Math.round(Number(maxCents) || 0);
  // Read as every money field reads (utils/money.js, UX pick 73): "1.2k" is $1,200 and "12,50" $12.50,
  // where every non-digit used to be dropped ("1.2k" was $1.20); "500 dollars" is refused.
  const r = parseMoney(answer);
  if (!max || r.error || !(r.value > 0)) return null;
  const cents = r.cents * (max < 0 ? -1 : 1);
  if (Math.abs(cents) > Math.abs(max)) return null;
  return cents;
}

/** One payment record for a session list (feed.payments; owner, 2026-10-24): who paid whom, the amount
 *  and what it was. side 'backer' (the page) | 'owner' (the Backers card). */
export function paymentView(p, { side, player = 'Ethan', backer = 'your backer' }) {
  const cents = Math.round(Number(p && p.amountCents) || 0);
  const playerPaid = cents > 0;
  // The backer's page says "sent" (owner, 2026-10-25); the owner's card keeps "paid".
  const title = side === 'owner'
    ? (playerPaid ? `Paid ${backer}` : `${backer} paid you`)
    : (playerPaid ? `${player} sent you` : `You sent ${player}`);
  const kind = p && p.kind === 'part' ? 'Partial payment' : p && p.kind === 'payout' ? 'Payout' : 'Settled';
  return { title, amount: usd(cents), kind, playerPaid };
}
