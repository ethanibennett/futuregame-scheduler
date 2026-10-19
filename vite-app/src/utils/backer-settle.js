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
 *   { button: { label, action: 'confirm' | 'undo', primary } | null, status, confirm: string | null }
 * `confirm` is the question asked before a confirm press is sent.
 */
export function settleView({ settlement, totalCents, side, player = 'Ethan', backer = 'your backer' }) {
  const total = Math.round(Number(totalCents) || 0);
  const s = settlement || null;
  const open = s && s.open ? s.open : null;
  if (total === 0 && !open) {
    return s && s.last ? { button: null, status: `Settled ${dayET(s.last.at)}`, confirm: null } : null;
  }
  const amt = usd(total);
  const me = side === 'owner' ? 'ownerAt' : 'backerAt';
  const them = side === 'owner' ? 'backerAt' : 'ownerAt';
  const other = side === 'owner' ? backer : player;
  const done = 'The balance goes to $0 once you have both confirmed.';
  // Who sends the money: + = the player pays the backer.
  const question = side === 'owner'
    ? (total > 0 ? `Confirm you have paid ${backer} ${amt}?` : `Confirm ${backer} has paid you ${amt}?`)
    : (total > 0 ? `Confirm ${player} has paid you ${amt}?` : `Confirm you have paid ${player} ${amt}?`);
  if (open && open[me] && !open[them]) {
    return { button: { label: 'Undo', action: 'undo', primary: false }, status: `You marked ${amt} settled · waiting for ${other}`, confirm: null };
  }
  if (open && open[them] && !open[me]) {
    return { button: { label: 'Confirm', action: 'confirm', primary: true }, status: `${other} marked ${amt} settled`, confirm: `${question} ${done}` };
  }
  const when = side === 'owner'
    ? (total > 0 ? `Once you have paid ${backer} ${amt}` : `Once ${backer} has paid you ${amt}`)
    : (total > 0 ? `Once ${player} has paid you ${amt}` : `Once you have paid ${player} ${amt}`);
  return { button: { label: 'Settled', action: 'confirm', primary: true }, status: when, confirm: `${question} ${done}` };
}
