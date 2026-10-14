// The floating "+" on the bankroll pages (components/BankrollFab.jsx): what it offers, and the small
// store through which a form or sheet that the + would open says "hide the +".
//
// The choices are the home's Log menu (components/HomeLastResult.jsx) less its "Open the live
// session": a live session already has its bar over the nav (LiveCashBar), so the + offers Start
// only when none runs. Each choice is an intent App hands to Results (App's resultsIntent): the
// form that already exists opens, nothing is built twice.

/**
 * The menu's choices, in order. Cash sessions and expenses are admin-only (the bankroll beta), so
 * everyone else has the one choice and the + skips the menu and opens that form.
 * live: a cash session is running (no second one starts).
 */
export function fabItems({ isAdmin, live }) {
  const items = [{ key: 'tournament', label: 'Tournament result', intent: { kind: 'tournament' } }];
  if (!isAdmin) return items;
  items.push({ key: 'cash-add', label: 'Cash session', intent: { kind: 'cash-add' } });
  if (!live) items.push({ key: 'cash-start', label: 'Start live session', intent: { kind: 'cash-start' } });
  items.push({ key: 'expense', label: 'Expense or income', intent: { kind: 'expense' } });
  return items;
}

/** A menu is worth opening for two or more choices; one is just that action. */
export const fabHasMenu = (items) => items.length > 1;

// ── Hiding the + ──────────────────────────────────────────────────────────────────────────────
// A view holds the + away while a form or sheet the + would open is already open (or while the live
// cash screen has the Results tab to itself). Holds are counted per scope, so two views can hold at
// once and the + returns only when both let go: 'page' is the + on the Results tab, 'sheet' the one
// inside the bankroll dashboard sheet (which holds the page's, it covers it).
const holds = { page: 0, sheet: 0 };
const subs = new Set();
const emit = () => { for (const f of subs) f(); };
const scopeOf = (s) => (s === 'sheet' ? 'sheet' : 'page');

/** Take a hold on a scope; returns the release (safe to call twice). */
export function holdFab(scope = 'page') {
  const k = scopeOf(scope);
  holds[k] += 1;
  emit();
  let done = false;
  return () => { if (done) return; done = true; holds[k] -= 1; emit(); };
}
export const fabHeld = (scope = 'page') => holds[scopeOf(scope)] > 0;
export const subscribeFab = (f) => { subs.add(f); return () => subs.delete(f); };
