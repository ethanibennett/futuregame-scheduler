// ── Tax-ready year-end report (BETA, app admins only) ──────────────────────
// Pure functions: no imports, no DOM, no clock. Every figure the report shows comes from here, so
// it is all unit-tested (src/utils/__tests__/tax-report.test.mjs). The view (TaxReportView.jsx) and
// the exports (tax-report-export.js) only format what this returns.
//
// NOT TAX ADVICE. The rules below were checked against primary sources on 2026-10-10; each carries
// its citation. Re-verify them every filing season — the W-2G threshold is now indexed to
// inflation, so a year this table has not seen falls back to the newest rule and is marked
// provisional rather than silently trusted.
//
// Dates: tournaments.date is ISO 'YYYY-MM-DD' and is read by hand. `new Date('YYYY-MM-DD')` is UTC
// midnight, which is the previous day (and on Jan 1, the previous YEAR) everywhere west of UTC.

// ── W-2G reporting threshold for poker tournaments ──────────────────────────
// Through payments made in 2025:
//   "File Form W-2G for each person to whom you pay more than $5,000 in winnings, reduced by the
//    amount of the wager or buy-in, from each poker tournament you have sponsored."
//   — Instructions for Forms W-2G and 5754 (Rev. January 2021), "4. Poker Tournaments"
//     https://www.irs.gov/pub/irs-prior/iw2g--2021.pdf
// From payments made in 2026 (One Big Beautiful Bill Act, P.L. 119-21, raised the §6041 floor):
//   "File Form W-2G for each person to whom you pay gambling winnings meeting or exceeding the
//    applicable reporting threshold, reduced by the amount of the wager or buy-in, from each poker
//    tournament you have sponsored." ... "The minimum threshold amount for payments made in
//    calendar year 2026 is $2,000." (adjusted yearly for inflation after 2025)
//   — Instructions for Forms W-2G and 5754 (Rev. January 2026), What's New + "4. Poker Tournaments"
//     https://www.irs.gov/instructions/iw2g
//   — Publication 1099 (2026), W-2G row: "poker tournaments ... Generally, $2,000 or more"
//     https://www.irs.gov/pub/irs-prior/p1099--2026.pdf
// Note the comparison changed too: "more than" $5,000 (strict) became "meeting or exceeding" (>=).
// Each tournament is tested on its own; other tournaments at the same sponsor don't count.
export const W2G_POKER_RULES = [
  { fromYear: 2026, amount: 2000, inclusive: true,
    source: 'Instructions for Forms W-2G and 5754 (Rev. January 2026); Pub. 1099 (2026)' },
  { fromYear: 0, amount: 5000, inclusive: false,
    source: 'Instructions for Forms W-2G and 5754 (Rev. January 2021)' },
];
// The newest year whose threshold has actually been published. Later years use the newest rule
// but are flagged provisional, because the amount is inflation-indexed from 2027 on.
export const W2G_LAST_PUBLISHED_YEAR = 2026;

export function w2gThreshold(year) {
  const rule = W2G_POKER_RULES.find((r) => year >= r.fromYear);
  return { ...rule, provisional: year > W2G_LAST_PUBLISHED_YEAR };
}

// A cash "likely" produced a W-2G when its winnings net of ONE buy-in reach the threshold. One, not
// all of them: the instructions reduce by "the wager or buy-in" of the payout, and re-entries the
// venue may or may not net. Subtracting a single buy-in flags more cashes, never fewer — the right
// direction for a "look for this form" list. Never certain: the venue decides.
export function isLikelyW2G(cash, buyin, year) {
  const net = (Number(cash) || 0) - (Number(buyin) || 0);
  if (!(Number(cash) > 0)) return false;
  const t = w2gThreshold(year);
  return t.inclusive ? net >= t.amount : net > t.amount;
}

// ── Wagering-loss deduction, IRC §165(d) ────────────────────────────────────
// Tax years beginning after Dec 31, 2025 (OBBBA §70114, P.L. 119-21):
//   "(d)(1) ... the amount allowed as a deduction for any taxable year— (A) shall be equal to 90
//    percent of the amount of such losses during such taxable year, and (B) shall be allowed only
//    to the extent of the gains from such transactions during such taxable year.
//    (2) ... 'losses from wagering transactions' includes any deduction otherwise allowable under
//    this chapter incurred in carrying on any wagering transaction."
//   — 26 U.S.C. §165(d), https://www.law.cornell.edu/uscode/text/26/165 (note: §70114(b) effective
//     date); CRS R48611, Tax Provisions in P.L. 119-21 — "limits the deduction for all wagering
//     losses (for casual and professional gamblers) to 90% of the loss amount"
//     https://www.congress.gov/crs_external_products/R/PDF/R48611/R48611.3.pdf
//   Proposed regs: REG-113229-25, IRB 2026-19 (https://www.irs.gov/irb/2026-19_IRB).
// Earlier years: 100% of losses, to the extent of gains.
// Order matters and follows the statute: take 90% of the losses FIRST, then cap at gains.
export function lossDeductionRate(year) {
  return year >= 2026 ? 0.9 : 1;
}

// ── Logged expenses and non-game income (bankroll_transactions) ─────────────
// Checked 2026-10-11. NOT TAX ADVICE: the report trusts the category the player chose.
//
// Professional (trade or business of gambling): ordinary and necessary business expenses are
//   deductible (IRC §162(a); §162(a)(2) covers "traveling expenses (including amounts expended for
//   meals and lodging ...) while away from home in the pursuit of a trade or business"). Since
//   2018 they count as "losses from wagering transactions":
//     §165(d)(2) "the term 'losses from wagering transactions' includes any deduction otherwise
//     allowable under this chapter incurred in carrying on any wagering transaction."
//   TCJA made that temporary (2018-2025); P.L. 119-21 §70114 struck the sunset, and from tax years
//   beginning after Dec 31, 2025 the WHOLE pool (wagering losses + those expenses) is deductible at
//   90% and only up to gambling gains (§165(d)(1)(A)-(B)).
//   — 26 U.S.C. §165(d), https://www.law.cornell.edu/uscode/text/26/165 (amendment notes)
//   — CRS R48611, §70114: "Professional gamblers could additionally claim other allowable business
//     deductions (such as the cost of travel), but all deductions together (gambling losses and
//     business deductions) were limited by the amount of gambling income ... it limits the deduction
//     for all wagering losses (for casual and professional gamblers) to 90% of the loss amount ...
//     Second, it permanently extends the limitation on gambling losses for professional gamblers."
//     https://www.congress.gov/crs_external_products/R/PDF/R48611/R48611.3.pdf
//   Order, as the statute reads: the expense's own deduction rule first ("otherwise allowable" —
//   e.g. meals at 50%), then 90% of the pool, then the cap at gains.
// Meals: "In most cases, you can deduct only 50% of your business meal expenses, including meals
//   incurred while away from home on business." — Instructions for Schedule C (2025), line 24b,
//   https://www.irs.gov/instructions/i1040sc (IRC §274(n)). The 2026 instructions were not yet
//   published when this was checked.
// Travel and lodging: "lodging and transportation connected with overnight travel for business while
//   away from your tax home" — same instructions, line 24a. The app cannot tell whether a trip was
//   away from the player's tax home; it counts what the player filed as travel or lodging.
// Recreational: no deduction for any of it. "a casual gambler not engaged in the trade or business of
//   gambling would not have deductible business expenses. The casual gambler's expenses to engage in
//   gambling are nondeductible personal expenses under § 262." — IRS Chief Counsel AM 2008-013
//   (footnote 1), https://www.irs.gov/pub/irs-counsel/am2008013.pdf (its conclusion on §165(d) was
//   overtaken by the 2017 §165(d)(2); the footnote's point is unchanged). CRS R48611: "casual
//   gamblers could only deduct losses from the gambling activity itself (such as losing bets)".
// 'other' expenses are listed but not deducted in either column: the report cannot tell what they
// are. Entry/registration fees logged HERE are separate from the buy-ins already counted as
// wagers; a fee that was part of a tournament's buy-in belongs in the buy-in.
export const PRO_EXPENSE_RULES = {
  travel: { rate: 1, line: 'Sch. C line 24a' },
  lodging: { rate: 1, line: 'Sch. C line 24a' },
  food: { rate: 0.5, line: 'Sch. C line 24b (50%)' },
  entry_fees: { rate: 1, line: 'Sch. C' },
  coaching: { rate: 1, line: 'Sch. C' },
  software: { rate: 1, line: 'Sch. C' },
  tips: { rate: 1, line: 'Sch. C' },
  // equipment and fees come from the dashboard (bankroll merge); under 'other' they would be dropped
  equipment: { rate: 1, line: 'Sch. C' },
  fees: { rate: 1, line: 'Sch. C' },
  other: { rate: 0, line: 'not counted' },
};
const EXPENSE_LABELS = {
  travel: 'Travel', lodging: 'Lodging', food: 'Food (meals)', entry_fees: 'Entry / registration fees',
  coaching: 'Coaching', software: 'Software / subscriptions', tips: 'Dealer tips',
  equipment: 'Equipment', fees: 'Fees', other: 'Other',
};
// Non-game income: shown on its own line and added to NEITHER column. Income is generally taxable
// ("Gambling winnings are taxable income", "Prizes or awards you receive are generally included in
// your gross income" — Pub. 525, https://www.irs.gov/publications/p525), but no IRS guidance was
// found on how rakeback, site bonuses or promotions are classified (gambling winnings, a reduction of
// the rake paid, business income or other income), nor on a staking settlement's character. The
// report says so rather than guessing.
const INCOME_LABELS = {
  rakeback: 'Rakeback', bonus: 'Bonus / promotion', staking: 'Staking settlement received',
  sponsorship: 'Prop / sponsorship', coaching: 'Coaching income', other: 'Other income',
};

/**
 * The year's logged expenses and income, in USD.
 * transactions: GET /api/bankrolls/transactions rows ({ occurred_on, kind, category, amount, currency,
 *   bankroll_id }). opts: { year, toUSD, bankrollId } as buildTaxReport.
 */
export function summarizeTransactions(transactions, opts = {}) {
  const year = String(opts.year);
  const toUSD = typeof opts.toUSD === 'function' ? opts.toUSD : null;
  const bankrollId = opts.bankrollId == null ? null : opts.bankrollId;
  const exp = new Map(), inc = new Map();
  let unconverted = 0, converted = 0, count = 0;
  for (const t of transactions || []) {
    if (!t || typeof t.occurred_on !== 'string' || t.occurred_on.slice(0, 4) !== year) continue;
    if (bankrollId != null && String(t.bankroll_id) !== String(bankrollId)) continue;
    const m = t.kind === 'expense' ? exp : t.kind === 'income' ? inc : null;
    if (!m) continue;
    const cur = t.currency || 'USD';
    let usdC = null;
    if (cur === 'USD') usdC = toCents(t.amount);
    else if (toUSD) { const v = toUSD(Number(t.amount) || 0, cur); if (Number.isFinite(v)) { usdC = toCents(v); converted++; } }
    if (usdC == null) { unconverted++; continue; }
    count++;
    m.set(t.category, (m.get(t.category) || 0) + usdC);
  }
  const expenses = [...exp.entries()].map(([key, c]) => {
    const rule = PRO_EXPENSE_RULES[key] || PRO_EXPENSE_RULES.other;
    return { key, label: EXPENSE_LABELS[key] || key, amount: fromCents(c), proRate: rule.rate, line: rule.line,
      proDeductible: fromCents(Math.round(c * rule.rate)) };
  }).sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  const income = [...inc.entries()].map(([key, c]) => ({ key, label: INCOME_LABELS[key] || key, amount: fromCents(c) }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  const sumC = (list, f) => list.reduce((s, x) => s + toCents(x[f]), 0);
  return {
    expenses,
    income,
    expenseTotal: fromCents(sumC(expenses, 'amount')),
    proDeductible: fromCents(sumC(expenses, 'proDeductible')),
    notCounted: fromCents(sumC(expenses, 'amount') - sumC(expenses, 'proDeductible')),
    incomeTotal: fromCents(sumC(income, 'amount')),
    count, converted, unconverted,
  };
}

// ── Dates ───────────────────────────────────────────────────────────────────
export function parseIsoDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof v === 'string' ? v : '');
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

// The tax year a report defaults to: the calendar year before `todayIso`.
export function defaultTaxYear(todayIso) {
  const t = parseIsoDate(todayIso);
  return t ? t.y - 1 : null;
}

// Years with at least one logged result, newest first, always including the default year.
export function availableYears(entries, todayIso) {
  const set = new Set();
  const def = defaultTaxYear(todayIso);
  if (def != null) set.add(def);
  for (const e of entries || []) {
    const p = parseIsoDate(e && e.date);
    if (p) set.add(p.y);
  }
  return [...set].sort((a, b) => b - a);
}

// ── Payer location ──────────────────────────────────────────────────────────
// A W-2G is a US information return, so a cash paid by a room outside the US is never a candidate.
// `country` comes from the WSOP stop directory; `region` from venue_coords, which stores a US state
// code for US rooms and a country code or name otherwise (CLAUDE.md, "Venue geo"). Unknown = US.
const US_STATES = new Set(('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS '
  + 'MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR').split(' '));
export function isForeignPayer(e) {
  if (!e) return false;
  if (e.country) return String(e.country).toUpperCase() !== 'US';
  if (e.region) return !US_STATES.has(String(e.region).toUpperCase());
  return false;
}

// ── Money ───────────────────────────────────────────────────────────────────
// Summed in integer cents so a year of conversions doesn't drift.
const toCents = (v) => Math.round((Number(v) || 0) * 100);
const fromCents = (c) => c / 100;

// ── The report ──────────────────────────────────────────────────────────────
// entries: tracking rows joined with their event (GET /api/tax-report/entries), each optionally
//   carrying `currency` (the venue's native currency; default 'USD').
// opts.year:       the tax year (required).
// opts.toUSD:      (amount, currency) => USD, for non-USD rows. Without it those rows stay in the log
//                  but are left out of every total, and the report says how many.
// opts.transactions: OPTIONAL logged expenses / income (GET /api/bankrolls/transactions). Their
//                  deductible part reduces the PROFESSIONAL column only (summarizeTransactions).
// opts.bankrollId: OPTIONAL bankroll filter, deliberately unwired in the UI. When the bankrolls work
//                  adds `tracking_entries.bankroll_id`, pass an id to report one bankroll; null /
//                  undefined reports all. Rows without a bankroll_id never match a specific id.
export function buildTaxReport(entries, opts = {}) {
  const year = Number(opts.year);
  const toUSD = typeof opts.toUSD === 'function' ? opts.toUSD : null;
  const bankrollId = opts.bankrollId == null ? null : opts.bankrollId;
  const threshold = w2gThreshold(year);
  const rate = lossDeductionRate(year);

  const sessions = [];
  let undated = 0, unconverted = 0, converted = 0;
  for (const e of entries || []) {
    if (!e) continue;
    if (bankrollId != null && String(e.bankroll_id) !== String(bankrollId)) continue;
    const p = parseIsoDate(e.date);
    if (!p) { undated++; continue; }
    if (p.y !== year) continue;

    const currency = e.currency || 'USD';
    const entriesN = Math.max(1, Number(e.num_entries) || 1);
    const buyin = Number(e.buyin) || 0;
    const cashed = !!e.cashed && Number(e.cash_amount) > 0;
    const cash = cashed ? Number(e.cash_amount) : 0;
    const cost = buyin * entriesN;

    let usd = null;
    if (currency === 'USD') usd = { buyin, cost, cash };
    else if (toUSD) {
      const c = (v) => fromCents(toCents(toUSD(v, currency)));
      usd = { buyin: c(buyin), cost: c(cost), cash: c(cash) };
    }
    if (currency !== 'USD') { if (usd) converted++; else unconverted++; }

    const online = !!e.is_online;
    sessions.push({
      id: e.id,
      date: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`,
      month: p.m,
      venue: e.venue || '',
      room: e.property || '',
      location: online ? '' : (e.city_state || e.region || ''),
      online,
      site: online ? (e.site || e.venue || '') : '',
      eventNumber: e.event_number || '',
      event: e.event_name || '',
      buyin,
      entries: entriesN,
      cost,
      cash,
      net: cash - cost,
      finishPlace: cashed && e.finish_place ? Number(e.finish_place) : null,
      currency,
      usd: usd && { ...usd, net: fromCents(toCents(usd.cash) - toCents(usd.cost)) },
      // A foreign payer issues no W-2G, so only USD rows at US rooms (or unknown) are candidates.
      foreignPayer: currency !== 'USD' || isForeignPayer(e),
      likelyW2G: currency === 'USD' && !isForeignPayer(e) && cashed && isLikelyW2G(cash, buyin, year),
      w2gNet: cashed ? cash - buyin : 0,
    });
  }
  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, sessions: 0, cashes: 0, winC: 0, costC: 0 }));
  let winC = 0, costC = 0, sessWinC = 0, sessLossC = 0, cashes = 0, counted = 0;
  for (const s of sessions) {
    if (!s.usd) continue;
    counted++;
    const w = toCents(s.usd.cash), c = toCents(s.usd.cost);
    winC += w; costC += c;
    if (w > 0) cashes++;
    if (w - c > 0) sessWinC += w - c; else sessLossC += c - w;
    const mo = months[s.month - 1];
    mo.sessions++; mo.winC += w; mo.costC += c; if (w > 0) mo.cashes++;
  }

  const ledger = summarizeTransactions(opts.transactions, { year, toUSD, bankrollId });
  const totals = {
    sessions: counted,
    cashes,
    grossWinnings: fromCents(winC),
    totalBuyins: fromCents(costC),
    net: fromCents(winC - costC),
    // The per-session view: each tournament netted on its own (cash minus that event's buy-ins).
    sessionWinnings: fromCents(sessWinC),
    sessionLosses: fromCents(sessLossC),
  };

  return {
    year,
    bankrollId,
    threshold,
    lossRate: rate,
    sessions,
    months: months.map((m) => ({
      month: m.month, sessions: m.sessions, cashes: m.cashes,
      winnings: fromCents(m.winC), buyins: fromCents(m.costC), net: fromCents(m.winC - m.costC),
    })),
    totals,
    w2g: sessions.filter((s) => s.likelyW2G),
    filing: {
      gross: filingComparison(totals.grossWinnings, totals.totalBuyins, year, { proExpenses: ledger.proDeductible, expenses: ledger.expenseTotal }),
      session: filingComparison(totals.sessionWinnings, totals.sessionLosses, year, { proExpenses: ledger.proDeductible, expenses: ledger.expenseTotal }),
    },
    ledger,
    notes: { undated, converted, unconverted },
  };
}

// Recreational vs professional, from one pair of wins/losses. Both use the same §165(d) cap; what
// differs is where it lands on the return and what it does to AGI.
//   Recreational: all winnings are income (Schedule 1, "Gambling"); losses are an itemized deduction
//     only (Schedule A line 16), never more than winnings — so a standard-deduction filer deducts 0.
//     IRS Topic 419 https://www.irs.gov/taxtopics/tc419 ; Schedule A instructions line 16
//     https://www.irs.gov/instructions/i1040sca
//   Professional: Schedule C. Wagering losses AND business expenses count as "losses from wagering
//     transactions" (§165(d)(2)) under the same cap, so the net profit cannot go below zero; it is
//     self-employment income (Schedule SE).
// extra.proExpenses: logged business expenses after their own rules (meals 50%; summarizeTransactions),
//   pooled with the wagering losses BEFORE the 90% and the cap — professional column only.
// extra.expenses: everything logged (shown; the recreational column deducts none of it).
export function filingComparison(winnings, losses, year, extra = {}) {
  const rate = lossDeductionRate(year);
  const winC = toCents(winnings), lossC = toCents(losses);
  const expC = Math.max(0, toCents(extra.proExpenses));
  const allowedC = Math.min(Math.round(lossC * rate), winC);
  const proPoolC = lossC + expC;
  const proAllowedC = Math.min(Math.round(proPoolC * rate), winC);
  return {
    winnings: fromCents(winC),
    losses: fromCents(lossC),
    lossRate: rate,
    allowedLoss: fromCents(allowedC),
    disallowedLoss: fromCents(lossC - allowedC),
    recreational: {
      income: fromCents(winC),                   // Schedule 1, gambling
      itemizedDeduction: fromCents(allowedC),    // Schedule A line 16, itemizers only
      agiAdded: fromCents(winC),                 // winnings enter AGI in full
      taxableIfItemizing: fromCents(winC - allowedC),
      taxableIfStandard: fromCents(winC),
    },
    expensesLogged: fromCents(Math.max(0, toCents(extra.expenses))),
    professional: {
      grossReceipts: fromCents(winC),            // Schedule C
      businessExpenses: fromCents(expC),         // after meals at 50%; 'other' not counted
      // Wagering losses + business expenses: 90% from 2026, then capped at winnings.
      lossDeduction: fromCents(proAllowedC),
      disallowed: fromCents(proPoolC - proAllowedC),
      netProfit: fromCents(winC - proAllowedC),  // never below zero: the cap is at gains
      agiAdded: fromCents(winC - proAllowedC),
      selfEmploymentIncome: fromCents(winC - proAllowedC),
    },
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────
// Text cells that start with = + - @ (or a tab/CR) are prefixed with ' so a spreadsheet does not
// run them as formulas. Numbers are written bare.
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export const CSV_COLUMNS = [
  'Date', 'Venue', 'Room', 'City/State', 'Online site', 'Event #', 'Event', 'Currency',
  'Buy-in', 'Entries', 'Total buy-ins', 'Cash', 'Net', 'Finish',
  'Total buy-ins (USD)', 'Cash (USD)', 'Net (USD)', 'Possible W-2G',
];

export function sessionsToCsv(report) {
  const rows = [CSV_COLUMNS];
  for (const s of report.sessions) {
    rows.push([
      s.date, s.venue, s.room, s.location, s.online ? s.site : '', s.eventNumber, s.event, s.currency,
      s.buyin, s.entries, s.cost, s.cash, s.net, s.finishPlace,
      s.usd ? s.usd.cost : '', s.usd ? s.usd.cash : '', s.usd ? s.usd.net : '',
      s.likelyW2G ? 'likely' : '',
    ]);
  }
  // BOM so Excel reads UTF-8 (room names carry accents); CRLF per RFC 4180.
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
