# Tax-ready year-end report (BETA)

Admins only. Results tab → **Tax report** (button beside Share / + Log Result). Normal users see
nothing new: the button renders on `isAdmin`, the view and its jsPDF export are lazy chunks, and
`GET /api/tax-report/entries` is `requireAppAdmin`.

**Not tax advice.** The report says so at the top and in the PDF. Every figure comes from what the
user logged.

## Where things are

| Piece | File |
|---|---|
| Math (pure, unit-tested) | `vite-app/src/utils/tax-report.js` |
| Words + formatting shared by screen and PDF | `vite-app/src/utils/tax-report-text.js` |
| CSV + PDF export | `vite-app/src/utils/tax-report-export.js` |
| View + grid CSS | `vite-app/src/components/TaxReportView.jsx`, `TaxReportView.css` |
| Data route | `server.js`, `GET /api/tax-report/entries` (after the tracking routes) |
| Tests | `npm run test:tax-report` (unit + scratch-port server test) |

The route returns the caller's tracking rows joined with the event, plus `property` (the room;
a WSOP stop's room from the directory when the row has none), `is_online`, `site`, `city_state`
(PokerAtlas directory, `data/venue-directory.json`), `region` (`venue_coords`) and `country`
(WSOP stop directory). All years; the client picks the year. No new tables.

## What it shows

Tax year defaults to the previous calendar year; ‹ › step through years that have results.

1. **Session log** — every result in the year (date, room, city/state, event, buy-in × entries,
   cash, net; online rows show the site). CSV export has every column, native and USD.
2. **Totals** — gross winnings (sum of cashes), total buy-ins, net, sessions, cashes; per-month
   subtotals. Also the per-event figures (each tournament netted on its own).
3. **Possible W-2Gs** — "likely", never certain (rule below).
4. **Recreational vs professional** — the same numbers both ways, side by side, on a gross or a
   per-event basis. It never says which one the user is.
5. **Export** — CSV session log and a PDF summary, both through `shareOrDownloadBlob()` (the
   share sheet in the iOS WKWebView, where `<a download>` does nothing; a download elsewhere).
   The PDF is the "printable page": `window.print()` is a no-op in the WKWebView, and the share
   sheet can print a PDF.

Dates are read by hand from `YYYY-MM-DD`; nothing goes through `new Date('YYYY-MM-DD')`.
Non-USD rows (Irish Poker Open, WSOP Europe) are converted with today's rates and the report says
so — the IRS wants the rate on the day of payment. They are never W-2G candidates.

## Rules, verified 2026-10-10

**W-2G threshold for poker tournaments** — net of the buy-in, per tournament:

- Payments through **2025**: *more than* **$5,000**. "File Form W-2G for each person to whom you
  pay more than $5,000 in winnings, reduced by the amount of the wager or buy-in, from each poker
  tournament you have sponsored." — Instructions for Forms W-2G and 5754 (Rev. January 2021),
  <https://www.irs.gov/pub/irs-prior/iw2g--2021.pdf>
- Payments from **2026**: *meeting or exceeding* the applicable threshold, **$2,000** for 2026,
  inflation-adjusted yearly after that. — Instructions for Forms W-2G and 5754 (Rev. January
  2026), What's New and "4. Poker Tournaments", <https://www.irs.gov/instructions/iw2g>;
  Publication 1099 (2026), W-2G row ("poker tournaments … Generally, $2,000 or more"),
  <https://www.irs.gov/pub/irs-prior/p1099--2026.pdf>

So the owner's "$5,000" is right for tax year 2025 and earlier, but **not** for 2026: the One
Big Beautiful Bill Act's §6041 change reached Form W-2G, and the 2026 instructions replaced the
$5,000 poker figure with the general $2,000 threshold (and "more than" with "meets or exceeds").
Years after 2026 use $2,000 and are flagged provisional until the IRS publishes the figure —
update `W2G_POKER_RULES` / `W2G_LAST_PUBLISHED_YEAR` each season.

"Likely" = cash minus **one** buy-in reaches the threshold, at a US room (or unknown), in USD.
One buy-in, not all re-entries: it can only flag more, never fewer.

**Gambling-loss deduction, IRC §165(d)** — tax years beginning after Dec 31, 2025 (OBBBA §70114,
P.L. 119-21): the deduction "shall be equal to 90 percent of the amount of such losses" and
"allowed only to the extent of the gains". Applies to recreational and professional alike, and
for professionals "losses from wagering transactions" includes their business expenses. Earlier
years: 100% of losses, to the extent of gains. The code takes 90% first, then caps at winnings,
as the statute orders it.
— 26 U.S.C. §165(d), <https://www.law.cornell.edu/uscode/text/26/165>;
CRS R48611, <https://www.congress.gov/crs_external_products/R/PDF/R48611/R48611.3.pdf>;
proposed regs REG-113229-25, IRB 2026-19, <https://www.irs.gov/irb/2026-19_IRB>.

**Recreational**: all winnings are income (Schedule 1); losses only as an itemized deduction
(Schedule A line 16), never more than winnings. — IRS Topic 419,
<https://www.irs.gov/taxtopics/tc419>; Schedule A instructions,
<https://www.irs.gov/instructions/i1040sca>.
**Professional**: Schedule C; net profit (never below zero from wagering) is self-employment
income. The report does not track expenses, so it does not deduct any.

### Not verified

- No IRS page found that states the Schedule C / self-employment treatment of professional
  gamblers in today's words; it rests on §165(d)(2), CRS R48611 and general Schedule C/SE rules.
- Whether US-regulated online sites issue W-2Gs for tournament cashes (the report treats online
  cashes like live ones and says the venue decides).
- How a venue nets re-entries for the W-2G (the report uses one buy-in).
- Bills to restore 100% loss deductibility (e.g. H.R. 6985) were introduced; §165(d) as published
  still reads 90%.

## Bankroll filter (left unwired)

`buildTaxReport(entries, { year, bankrollId })` and `<TaxReportView bankrollId>` accept an
optional bankroll id; `null` reports everything. The route's `te.*` will carry `bankroll_id` once
the bankrolls work adds it, so wiring it is: pass the selected bankroll from TrackingView.

## Grid

Measured in Playwright WebKit at 402×874 @3 with the overlay on: all 136 text baselines on r lines
and every box whole g / r. Blocks are held to whole r by a `WholeRows` wrapper that anchors each
block's bottom to the view's top — plain whole-r heights floor in WebKit's 1/64 px layout and
drifted 0.03r over the report.
