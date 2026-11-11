/**
 * Every tab has an address (App improvements 453): Back goes to the previous tab instead of leaving the app, and a
 * reload (or a relaunch of the Home Screen app) opens the same tab. The form is "#/<tab>", apart from the admin
 * deep links ("#bankroll/<tab>", "#tax", "#staking/standing", parsed by utils/deep-links.js) and the "#h/" hand and
 * "#reset" links, which keep their meaning. Only the tabs everyone has; an admin's own tabs open through their deep
 * links as before.
 */
const TAB_PATH = {
  dashboard: 'home',
  tournaments: 'schedule',
  schedule: 'schedule/mine',
  calendar: 'calendar',
  tracking: 'bankroll',
  hands: 'hands',
  social: 'social',
  settings: 'settings',
};
const PATH_TAB = Object.fromEntries(Object.entries(TAB_PATH).map(([k, v]) => [v, k]));

/** "#/bankroll" for a tab, or null for a tab with no address. */
export function tabHash(view) {
  return TAB_PATH[view] ? '#/' + TAB_PATH[view] : null;
}

/** The tab a "#/<tab>" address names, or null. */
export function viewFromHash(hash) {
  // A query after the tab ("#/settings?email=changed") belongs to the tab, not to its address.
  const m = /^#\/([a-z/]+)$/.exec(String(hash || '').trim().toLowerCase().split('?')[0]);
  return m && PATH_TAB[m[1]] ? PATH_TAB[m[1]] : null;
}
