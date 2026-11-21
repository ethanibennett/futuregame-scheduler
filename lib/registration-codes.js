'use strict';
/*
 * Registration codes (owner, 2026-11-21: "Add a registration code field for new accounts, and only include the BTG
 * card back option for users that register with code BTG"). Create Account (and Sign in with Apple, when it makes the
 * account) takes an optional code; a known one is kept on the account (users.registration_code) and decides what the
 * account unlocks. An unknown one is refused with a message, never dropped: a typo must not quietly cost a BTG
 * member their back. Matched in any case ("btg", " BTG ").
 *
 * What a code unlocks goes to the app as `cardBacks` on register and every sign-in (utils/card-back.js keeps it with
 * the session), so it follows the account to every device.
 */

const CODES = {
  BTG: { cardBacks: ['btg'] },
};

function normalizeCode(v) {
  return String(v == null ? '' : v).trim().toUpperCase();
}

/** { code: null } for none, { code } for a known one, { error } for anything else. */
function checkCode(v) {
  const code = normalizeCode(v);
  if (!code) return { code: null };
  if (Object.prototype.hasOwnProperty.call(CODES, code)) return { code };
  return { error: 'That registration code isn’t one we know. Check it, or leave the field empty.' };
}

/** The card backs an account with this code may use (ids beyond the standard back). */
function cardBacksFor(code) {
  const c = CODES[normalizeCode(code)];
  return c ? [...c.cardBacks] : [];
}

module.exports = { CODES, normalizeCode, checkCode, cardBacksFor };
