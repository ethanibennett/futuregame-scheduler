/* The header subtitle's wording, from ISO days: pure, so test/season-label.test.js can hold the server's copy
   (lib/season-label.js, which labels the sign-in screen before any events have loaded) to it. */

/* Abbreviated: the season label sits under the wordmark in the header, where
   "september-december 2026" is the longest string in a block that is otherwise
   a logotype. Three letters each, so a two-month range is a fixed width no
   matter which months it spans. */
const MONTH_NAMES = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/** The span of the days from `today` on: "aug 2026", "aug-nov 2026", "dec 2026-feb 2027"; '' for none. */
export function seasonLabelOf(days, today) {
  let min = '';
  let max = '';
  for (const d of days || []) {
    if (!d || d < today) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  if (!min) return '';
  const fromYear = min.slice(0, 4);
  const toYear = max.slice(0, 4);
  const fromMonth = MONTH_NAMES[Number(min.slice(5, 7)) - 1];
  const toMonth = MONTH_NAMES[Number(max.slice(5, 7)) - 1];
  if (!fromMonth || !toMonth) return '';
  if (fromYear !== toYear) return `${fromMonth} ${fromYear}-${toMonth} ${toYear}`;
  return fromMonth === toMonth ? `${fromMonth} ${fromYear}` : `${fromMonth}-${toMonth} ${fromYear}`;
}
