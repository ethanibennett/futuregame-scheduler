// ── Results > Delete results (components/ResetResults.jsx) ───────────────────────────────────
// Pure and dependency-free apart from bankrolls.js (also pure), so it runs under `node --test`
// (src/utils/__tests__/reset-results.test.mjs).
//
// What a reset deletes is always the bankroll the Results tab is showing, said in words, and the
// server is asked for exactly that (DELETE /api/tracking, server.js): ?bankroll=main|<id> for one
// bankroll, ?all=true only when the switcher shows All (or, for everyone outside the bankrolls
// beta, who has one pot). ?expect=<n> carries the count the confirmation showed, so a result
// logged elsewhere meanwhile turns the delete into a 409 instead of a surprise.
import { BANKROLL_ALL, BANKROLL_MAIN, toBankrollKey } from './bankrolls.js';

/**
 * The scope for the Results tab's selection. `enabled` is the bankrolls beta (bk.enabled):
 * without it there is no switcher and the reset covers every result the user has.
 *   { key, query, name }   name: 'Main', a bankroll's name, 'every bankroll', or null (no beta)
 */
export function resetScope(selected, { bankrolls = [], enabled = false } = {}) {
  const k = enabled ? toBankrollKey(selected) : BANKROLL_ALL;
  if (k === BANKROLL_ALL) return { key: BANKROLL_ALL, query: 'all=true', name: enabled ? 'every bankroll' : null };
  if (k === BANKROLL_MAIN) return { key: BANKROLL_MAIN, query: 'bankroll=main', name: 'Main' };
  const b = (bankrolls || []).find((x) => x.id === k);
  return { key: k, query: `bankroll=${encodeURIComponent(String(k))}`, name: b ? b.name : 'this bankroll' };
}

/** The words to type: 'DELETE 214 RESULTS' (digits without separators, so it can be typed). */
export function resetPhrase(n) {
  const c = Math.max(0, Math.floor(Number(n) || 0));
  return `DELETE ${c} RESULT${c === 1 ? '' : 'S'}`;
}

/** Whether what was typed is the phrase: case, runs of spaces and a thousands comma forgiven. */
export function phraseMatches(typed, phrase) {
  const t = String(typed || '').trim().replace(/\s+/g, ' ').replace(/(\d),(?=\d{3}\b)/g, '$1').toUpperCase();
  return !!phrase && t === phrase;
}

/** The request path (after API_URL) for deleting `n` results in `scope`. */
export function resetPath(scope, n) {
  return `/tracking?${scope.query}&expect=${Math.max(0, Math.floor(Number(n) || 0))}`;
}

const fmt = (n) => Number(n).toLocaleString('en-US');

/**
 * The sentence above the button: how many, from where, how many of them were imported, and what
 * stays. `imported` is how many of the n came from a CSV import (GET /api/tracking `imported`).
 */
export function resetSummary(n, scope, imported = 0) {
  const what = n === 1 ? 'tournament result' : 'tournament results';
  const imp = imported > 0 ? (imported === n ? (n === 1 ? ', which was imported' : ', all of them imported') : `, ${fmt(imported)} of them imported`) : '';
  let lead;
  if (!scope.name) lead = n === 1 ? `Deletes your 1 ${what}${imp}.` : `Deletes all ${fmt(n)} of your ${what}${imp}.`;
  else if (scope.key === BANKROLL_ALL) lead = `Deletes ${n === 1 ? 'the 1' : `all ${fmt(n)}`} ${what} in every bankroll${imp}.`;
  else lead = `Deletes the ${fmt(n)} ${what} in ${scope.name}${imp}.`;
  const stays = !scope.name ? ''
    : scope.key === BANKROLL_ALL ? ' Cash sessions, expenses and deposits stay.'
      : ' Other bankrolls, cash sessions, expenses and deposits stay.';
  return `${lead}${stays} This cannot be undone.`;
}
