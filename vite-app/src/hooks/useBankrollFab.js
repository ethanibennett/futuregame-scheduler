// React side of utils/bankroll-fab.js: a view holds the Results/bankroll "+" away while `on`, and
// the + reads whether anything holds it.
import { useEffect, useSyncExternalStore } from 'react';
import { holdFab, fabHeld, subscribeFab } from '../utils/bankroll-fab.js';

/** Hide the + (scope 'page', or 'sheet' inside the dashboard sheet) while `on`. */
export function useHideBankrollFab(on, scope = 'page') {
  useEffect(() => (on ? holdFab(scope) : undefined), [on, scope]);
}

/** Is anything holding this scope's + away? */
export function useBankrollFabHeld(scope = 'page') {
  return useSyncExternalStore(subscribeFab, () => fabHeld(scope), () => false);
}
