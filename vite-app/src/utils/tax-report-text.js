// Words and formatting for the BETA tax report, shared by the on-screen view and the PDF so the two
// can never say different things. No imports; the figures come from tax-report.js.

export const TAX_DISCLAIMER =
  'Not tax advice. Every figure here comes from the results you logged in this app — anything you '
  + 'did not log, or logged wrong, is missing or wrong here too. Which W-2Gs you actually received is '
  + 'up to each venue. Tax rules change; consult a tax professional before you file.';

export const TAX_SOURCES = [
  { label: 'Instructions for Forms W-2G and 5754 (Rev. January 2026)', url: 'https://www.irs.gov/instructions/iw2g' },
  { label: 'Instructions for Forms W-2G and 5754 (Rev. January 2021)', url: 'https://www.irs.gov/pub/irs-prior/iw2g--2021.pdf' },
  { label: 'Publication 1099 (2026), W-2G thresholds', url: 'https://www.irs.gov/pub/irs-prior/p1099--2026.pdf' },
  { label: '26 U.S.C. §165(d) Wagering losses', url: 'https://www.law.cornell.edu/uscode/text/26/165' },
  { label: 'CRS R48611, Tax Provisions in P.L. 119-21 (OBBBA §70114)', url: 'https://www.congress.gov/crs_external_products/R/PDF/R48611/R48611.3.pdf' },
  { label: 'IRS Topic 419, Gambling income and losses', url: 'https://www.irs.gov/taxtopics/tc419' },
  { label: 'Instructions for Schedule A, line 16', url: 'https://www.irs.gov/instructions/i1040sca' },
];

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Whole dollars unless there are cents (conversions produce them). ASCII minus: the PDF's standard
// font has no U+2212.
export function usd(v) {
  const n = Number(v) || 0;
  const cents = Math.round(Math.abs(n) * 100) % 100 !== 0;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + s;
}
export function signedUsd(v) {
  const n = Number(v) || 0;
  return (n > 0 ? '+' : '') + usd(n);
}

// 'YYYY-MM-DD' -> 'Mar 4', by hand (no Date: no zone shift).
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${MONTH_SHORT[Number(m[2]) - 1]} ${Number(m[3])}` : '';
}

export function w2gRuleText(report) {
  const t = report.threshold;
  const rule = t.inclusive
    ? `${usd(t.amount)} or more`
    : `more than ${usd(t.amount)}`;
  return `For ${report.year}, a poker tournament reports a W-2G when one payout, minus the buy-in, is ${rule}`
    + `${t.provisional ? ' (provisional: the amount is adjusted for inflation each year after 2026 — check the current IRS figure)' : ''}.`
    + ' Listed here: cashes whose amount minus one buy-in reaches that, at US rooms, in US dollars. Whether a'
    + ' form was issued is the venue\'s call — a list of what to look for, not of what you received.';
}

export function lossRuleText(report, f) {
  const base = report.lossRate < 1
    ? `From tax year 2026, only ${Math.round(report.lossRate * 100)}% of gambling losses are deductible, and never more than winnings`
      + ` (IRC §165(d) as amended by the One Big Beautiful Bill Act).`
      + (f.disallowedLoss > 0 ? ` ${usd(f.disallowedLoss)} of these losses is not deductible either way.` : '')
    : `For ${report.year}, gambling losses are deductible up to winnings (IRC §165(d)).`
      + (f.disallowedLoss > 0 ? ` ${usd(f.disallowedLoss)} of losses exceeds winnings and is not deductible.` : '');
  return base;
}

// The side-by-side rows. Both columns use the same loss cap; they differ in where the figures go on
// the return and what reaches AGI. Professional expenses are not tracked, so not deducted.
export function filingRows(f) {
  return [
    { key: 'income', label: 'Winnings reported', rec: usd(f.recreational.income), pro: usd(f.professional.grossReceipts),
      recNote: 'Schedule 1', proNote: 'Schedule C' },
    { key: 'loss', label: 'Loss deduction', rec: usd(f.recreational.itemizedDeduction), pro: usd(f.professional.lossDeduction),
      recNote: 'Sch. A, itemizers only', proNote: 'Schedule C' },
    { key: 'agi', label: 'Added to AGI', rec: usd(f.recreational.agiAdded), pro: usd(f.professional.agiAdded) },
    { key: 'net', label: 'Net taxable (itemizing)', rec: usd(f.recreational.taxableIfItemizing), pro: usd(f.professional.netProfit) },
    { key: 'std', label: 'Net taxable (standard ded.)', rec: usd(f.recreational.taxableIfStandard), pro: usd(f.professional.netProfit) },
    { key: 'se', label: 'Self-employment tax base', rec: usd(0), pro: usd(f.professional.selfEmploymentIncome) },
  ];
}
