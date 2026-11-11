/* The Schedule's filters as the player reads them (Laws of UX picks 17 and 28, owner 2026-11-10): which
   are on, each as a chip that removes itself, and a one-line value for each section of the sheet. A
   filter is "on" when it differs from DEFAULT_FILTERS; the standing choices that Clear all keeps (the
   location, the state, the online answers, the room rules) are facts about the player, not filters,
   and never show as chips. Pure, so it runs under plain Node. */
import { DEFAULT_FILTERS } from './shared-filters.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => { const [, m, d] = String(iso).split('-').map(Number); return m && d ? `${MONTHS[m - 1]} ${d}` : String(iso); };

export const BUYIN_LABEL = {
  '0-500': 'Under $500', '500-1500': '$500–$1.5K', '1500-5000': '$1.5K–$5K', '5000-10000': '$5K–$10K', '10000+': '$10K+',
};
export const RAKE_LABEL = { '0-5': 'Rake under 5%', '5-8': 'Rake 5–8%', '8-10': 'Rake 8–10%', '10-13': 'Rake 10–13%', '13+': 'Rake 13%+' };
export const SPECIAL = [
  ['ladiesOnly', 'Ladies'], ['seniorsOnly', 'Seniors'], ['bountyOnly', 'Bounty'], ['mysteryBountyOnly', 'Mystery Bounty'],
  ['headsUpOnly', 'Heads Up'], ['tagTeamOnly', 'Tag Team'], ['employeesOnly', 'Casino Employees'],
];
const without = (arr, v) => (arr || []).filter((x) => x !== v);

/** The filters that are on: [{ key, label, remove(f) -> f }], in the sheet's order. */
export function activeFilterChips(f) {
  if (!f) return [];
  const out = [];
  for (const g of f.selectedGames || []) out.push({ key: 'game:' + g, label: g, remove: (x) => ({ ...x, selectedGames: without(x.selectedGames, g) }) });
  if (f.mixedOnly) out.push({ key: 'mixed', label: 'Mixed', remove: (x) => ({ ...x, mixedOnly: false }) });
  for (const [k, label] of SPECIAL) if (f[k]) out.push({ key: k, label, remove: (x) => ({ ...x, [k]: false }) });
  for (const b of f.buyinRanges || []) out.push({ key: 'buyin:' + b, label: BUYIN_LABEL[b] || b, remove: (x) => ({ ...x, buyinRanges: without(x.buyinRanges, b) }) });
  if (f.minBuyin || f.maxBuyin) {
    out.push({ key: 'buyin:range', label: `$${f.minBuyin || 0}–${f.maxBuyin ? '$' + f.maxBuyin : '∞'}`, remove: (x) => ({ ...x, minBuyin: '', maxBuyin: '' }) });
  }
  for (const r of f.rakeRanges || []) out.push({ key: 'rake:' + r, label: RAKE_LABEL[r] || r, remove: (x) => ({ ...x, rakeRanges: without(x.rakeRanges, r) }) });
  const hv = (f.hiddenVenues || []).length;
  if (hv) out.push({ key: 'venues', label: `${hv} series off`, remove: (x) => ({ ...x, hiddenVenues: [] }) });
  const hm = (f.hiddenMonths || []).length;
  if (hm) out.push({ key: 'months', label: `${hm} month${hm === 1 ? '' : 's'} off`, remove: (x) => ({ ...x, hiddenMonths: [] }) });
  if (f.dateFrom || f.dateTo) {
    const label = f.dateFrom && f.dateTo ? `${day(f.dateFrom)}–${day(f.dateTo)}` : f.dateFrom ? `From ${day(f.dateFrom)}` : `To ${day(f.dateTo)}`;
    out.push({ key: 'dates', label, remove: (x) => ({ ...x, dateFrom: '', dateTo: '' }) });
  }
  if (f.hideSatellites === false) out.push({ key: 'sats', label: 'Satellites', remove: (x) => ({ ...x, hideSatellites: DEFAULT_FILTERS.hideSatellites }) });
  if (f.hideRestarts === false) out.push({ key: 'restarts', label: 'Restarts', remove: (x) => ({ ...x, hideRestarts: DEFAULT_FILTERS.hideRestarts }) });
  if (f.hideSideEvents === true) out.push({ key: 'side', label: 'No side events', remove: (x) => ({ ...x, hideSideEvents: DEFAULT_FILTERS.hideSideEvents }) });
  return out;
}

/** The value each section of the sheet shows beside its name (pick 28). */
export function sectionValues(f, { venueCount = 0, onlineRoomCount = 0, siteRuleCount = 0 } = {}) {
  const games = [...(f.selectedGames || []), ...(f.mixedOnly ? ['Mixed'] : [])];
  const bands = (f.buyinRanges || []).map((b) => BUYIN_LABEL[b] || b);
  if (f.minBuyin || f.maxBuyin) bands.push(`$${f.minBuyin || 0}–${f.maxBuyin || '∞'}`);
  const rakes = (f.rakeRanges || []).map((r) => (RAKE_LABEL[r] || r).replace(/^Rake /, 'rake '));
  const special = SPECIAL.filter(([k]) => k !== 'ladiesOnly' && k !== 'seniorsOnly' && f[k]).map(([, l]) => l);
  const hv = (f.hiddenVenues || []).length;
  const list = (xs, none) => (xs.length ? xs.join(', ') : none);
  return {
    online: siteRuleCount ? `${siteRuleCount} room rule${siteRuleCount === 1 ? '' : 's'}` : `All ${onlineRoomCount} room${onlineRoomCount === 1 ? '' : 's'}`,
    series: hv ? `${Math.max(0, venueCount - hv)} of ${venueCount}` : `All ${venueCount}`,
    buyin: list([...bands, ...rakes], 'Any'),
    variant: list(games, 'Any'),
    special: list(special, 'None'),
  };
}
