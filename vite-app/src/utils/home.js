// ── The home screen's arithmetic (the Dashboard tab) ─────────────────────────────────────────
// Pure and dependency-free: no utils.js, which reads localStorage at import, so this runs under
// `node --test` (src/utils/__tests__/home.test.mjs; `npm run test:home` from the repo root).
//
// MONEY. A tournament result has one rule everywhere in the app: the combined ledger's
// (lib/ledger-sources/tournaments.js), lib/analytics.js normaliseRow() and the Results tab's:
//
//     net = (cashed ? cash_amount : 0) - buyin x max(1, num_entries)
//
// in the event's OWN currency, taken from the ROW. GET /api/tracking joins t.buyin and t.venue
// onto every result, so nothing is looked up in GET /api/tournaments. That list keeps a 3-day
// grace window and never carries 'Personal' events, which is how every older result and every
// imported one used to count as a $0 buy-in under "Other" on the home.

/** One result's money in its own currency: bullets, what they cost, what came back, the net. */
export function resultMoney(row) {
  const r = row || {};
  const units = Math.max(1, Number(r.num_entries) || 1);
  const buyin = Math.max(0, Number(r.buyin) || 0);
  // A stray cash_amount on an entry that did not cash (an edit that unticked Cashed, an import)
  // is not money won.
  const cash = Number(r.cashed) ? Math.max(0, Number(r.cash_amount) || 0) : 0;
  const cost = buyin * units;
  return { units, cost, cash, net: cash - cost };
}

/**
 * `amount` from one currency into another with GET /api/exchange-rates's `rates` (units per USD;
 * USD itself is 1 whether or not it is listed). null when it cannot be done honestly: no rates
 * yet, or no rate for either side. utils.js convertAmount reads a missing rate as 1, which
 * silently counts a euro as a dollar; a total built from this never does.
 */
export function convertMoney(amount, from, to, rates) {
  const a = Number(amount) || 0;
  const f = from || 'USD', t = to || 'USD';
  if (f === t || a === 0) return a;
  if (!rates) return null;
  const rate = (c) => (c === 'USD' ? 1 : Number(rates[c]));
  const rf = rate(f), rt = rate(t);
  if (!(rf > 0) || !(rt > 0)) return null;
  return (a / rf) * rt;
}

/**
 * Totals over GET /api/tracking rows, every row converted from its own currency into `currency`.
 * There is no "native" total: adding euros to dollars gives a number in no currency at all.
 *
 *   opts.currency    the display currency (default 'USD')
 *   opts.rates       GET /api/exchange-rates `rates`, or null while they load
 *   opts.currencyOf  row -> its currency (the app's nativeCurrency(row.venue))
 *   opts.groupOf     row -> a group key for byGroup (the venue strip's abbreviation), optional
 *
 * Returns { currency, count, bullets, cashes, cost, cash, net, roi, byGroup, unconverted }.
 * roi is a percentage, or null when nothing was spent (an empty figure, never 0%). When any row
 * cannot be converted, cost / cash / net / roi and every byGroup figure are null and
 * `unconverted` counts those rows: a part-total presented as the whole is the bug this replaces.
 */
export function tournamentTotals(rows, opts = {}) {
  const currency = opts.currency || 'USD';
  const rates = opts.rates || null;
  const currencyOf = opts.currencyOf || (() => 'USD');
  const groupOf = opts.groupOf || null;
  let count = 0, bullets = 0, cashes = 0, cost = 0, cash = 0, unconverted = 0;
  const groups = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const m = resultMoney(row);
    count += 1;
    bullets += m.units;
    if (Number(row && row.cashed)) cashes += 1;
    const from = currencyOf(row) || 'USD';
    const c = convertMoney(m.cost, from, currency, rates);
    const w = convertMoney(m.cash, from, currency, rates);
    if (c == null || w == null) { unconverted += 1; continue; }
    cost += c;
    cash += w;
    if (groupOf) {
      const k = groupOf(row) || 'Other';
      const g = groups[k] || (groups[k] = { cost: 0, cash: 0, count: 0 });
      g.cost += c; g.cash += w; g.count += 1;
    }
  }
  if (unconverted) {
    const byGroup = {};
    for (const k of Object.keys(groups)) byGroup[k] = { cost: null, cash: null, count: groups[k].count };
    return { currency, count, bullets, cashes, cost: null, cash: null, net: null, roi: null, byGroup, unconverted };
  }
  const net = cash - cost;
  return {
    currency, count, bullets, cashes, cost, cash, net,
    roi: cost > 0 ? (net / cost) * 100 : null,
    byGroup: groups, unconverted: 0,
  };
}

/** The home's display currency from the shared 'trackingCurrency' setting: never Native. */
export function homeCurrency(stored, supported) {
  const c = String(stored || '').toUpperCase();
  if (!c || c === 'NATIVE') return 'USD';
  if (supported && !supported.includes(c)) return 'USD';
  return c;
}
