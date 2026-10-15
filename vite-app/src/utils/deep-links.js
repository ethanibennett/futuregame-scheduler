/* Deep links into the app (docs/bankroll-merge.md §11.5, Phase 9): the hash routes the dashboard app
 * (and a push) can open, beside the #h/ hand links. Pure: App.jsx reads the hash, this says what it
 * means, App switches the view and clears the hash. Admins only; anyone else lands on the home.
 *
 *   #bankroll/<tab>            the bankroll dashboard on that tab (overview, balance, sessions, …)
 *   #results/tournaments       the Results tab
 *   #results/cash              the Cash tab
 *   #staking · #staking/standing   the Staking tab, the Standing section
 *   #expenses                  Results (the Expenses & Income list is under it)
 *   #tax                       the Results tab with the tax report open
 */
export const BANKROLL_TABS = ['overview', 'balance', 'sessions', 'trend', 'locations', 'backers', 'reports', 'rules', 'goals', 'data', 'import'];

/** -> { view, bankrollTab?, tax?, standing? } | null */
export function parseDeepLink(hash) {
  const h = String(hash || '').replace(/^#/, '').trim().toLowerCase();
  if (!h || h.startsWith('h/') || h.startsWith('reset')) return null;
  const [head, rest] = h.split('/', 2);
  if (head === 'bankroll') {
    const tab = rest === 'import' ? 'data' : rest && BANKROLL_TABS.includes(rest) ? rest : 'balance';
    return { view: 'tracking', bankrollTab: tab };
  }
  if (head === 'results') return { view: rest === 'cash' ? 'cash' : 'tracking' };
  if (head === 'staking') return { view: 'staking', standing: rest === 'standing' };
  if (head === 'expenses') return { view: 'tracking', expenses: true };
  if (head === 'tax') return { view: 'tracking', tax: true };
  return null;
}
