/* The signed session token's own claims, read in the browser without verifying them: the server
 * verifies the token on every call. Shared by App.jsx and the backer page (BackerPage.jsx).
 *
 * The admin gates read the username claim INSIDE the signed session token, never the 'username'
 * storage key: that key is plain localStorage, and setting it to 'ham' by hand used to unlock every
 * admin surface (Hands/Solver, Staking, Admin, Cash, the grid and demo toggles) on a session that
 * kept working. A hand-made token can claim any name too, but the server refuses it on the first
 * authenticated call and guardedFetch signs the session out. Display still uses the stored
 * username; only authorisation-shaped decisions use this. */

export const APP_ADMIN_USERNAMES = ['ham', 'ham5', 'claude'];   // mirrors server.js APP_ADMIN_USERNAMES

/** The token's payload (base64url JSON), or null for no token or one that does not parse. */
export function tokenClaims(tok) {
  try {
    const part = String(tok || '').split('.')[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) || null;
  } catch { return null; }
}

/** The signed-in username, lower case; '' for a guest or no session. */
export function tokenUsername(tok) {
  const claims = tokenClaims(tok);
  if (!claims || claims.isGuest) return '';
  return typeof claims.username === 'string' ? claims.username.toLowerCase() : '';
}

/** The account id from the token's own claim (null for a guest or no session): the key of the
 *  user's cached home layout (hooks/useHomeLayout.js), so one account never reads another's. */
export function tokenUserId(tok) {
  const claims = tokenClaims(tok);
  if (!claims || claims.isGuest) return null;
  const id = Number(claims.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Whether a token is an app admin's (APP_ADMIN_USERNAMES). */
export const isAppAdminToken = (tok) => APP_ADMIN_USERNAMES.includes(tokenUsername(tok));
