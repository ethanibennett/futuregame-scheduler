// ── Bankrolls (beta, app admins) ─────────────────────────────────────────────
// The client half of lib/bankrolls.js. Pure and dependency-free (no utils.js, which reads
// localStorage at import) so it runs under `node --test` and so the analytics and tax-report
// views can adopt it as-is. See docs/bankrolls.md.
//
// A bankroll KEY is what the server's `?bankroll=` param takes and what GET /api/bankrolls
// returns as `id`:
//   'all'   every entry (the default; the pre-bankroll behaviour)
//   'main'  entries with bankroll_id NULL — every result that predates bankrolls is here
//   <n>     one of the user's bankrolls (a number)

export const BANKROLL_ALL = 'all';
export const BANKROLL_MAIN = 'main';

/** The key an entry (a GET /api/tracking row, or an adjustment) is filed under. */
export function entryBankrollKey(entry) {
  const id = entry && entry.bankroll_id;
  return id == null || id === BANKROLL_MAIN ? BANKROLL_MAIN : Number(id);
}

/** Normalise anything (a select value, a localStorage string, a query value) to a key. */
export function toBankrollKey(raw) {
  if (raw == null || raw === '' || raw === BANKROLL_ALL) return BANKROLL_ALL;
  if (raw === BANKROLL_MAIN) return BANKROLL_MAIN;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : BANKROLL_ALL;
}

/** Client-side filter, identical in meaning to the server's ?bankroll=. */
export function filterByBankroll(entries, key) {
  const k = toBankrollKey(key);
  if (!Array.isArray(entries)) return [];
  if (k === BANKROLL_ALL) return entries;
  return entries.filter((e) => entryBankrollKey(e) === k);
}

/** '?bankroll=…' for a fetch URL, or '' for All (so an unfiltered call is byte-identical to before). */
export function bankrollQuery(key, joiner = '?') {
  const k = toBankrollKey(key);
  return k === BANKROLL_ALL ? '' : `${joiner}bankroll=${encodeURIComponent(String(k))}`;
}

/** Net result of one tracking entry, in the event's native currency. */
export function entryNet(entry) {
  return (Number(entry.cash_amount) || 0) - (Number(entry.buyin) || 0) * (Number(entry.num_entries) || 1);
}

/**
 * balance = starting_balance + adjustments_net + net results, per bankroll, in the BANKROLL'S
 * currency. `bankrolls` is GET /api/bankrolls's list; `entries` GET /api/tracking's rows.
 * opts.nativeCurrency(venue) and opts.convert(amount, from, to) come from utils.js
 * (nativeCurrency / convertAmount with the live rates), so results in EUR land in a USD
 * bankroll converted, as the Results tab already converts them.
 * Returns Map<key, { start, adjustments, results, balance, entries, currency }> plus an 'all'
 * row whose figures are converted into opts.allCurrency (default 'USD').
 */
export function computeBalances(bankrolls, entries, opts = {}) {
  const nativeCurrency = opts.nativeCurrency || (() => 'USD');
  const convert = opts.convert || ((v) => v);
  const allCurrency = opts.allCurrency || 'USD';
  const out = new Map();
  for (const b of bankrolls || []) {
    const start = Number(b.starting_balance) || 0;
    const adjustments = Number(b.adjustments_net) || 0;
    out.set(b.id === BANKROLL_MAIN ? BANKROLL_MAIN : Number(b.id), {
      start, adjustments, results: 0, balance: start + adjustments, entries: 0, currency: b.currency || 'USD',
    });
  }
  for (const e of entries || []) {
    const row = out.get(entryBankrollKey(e));
    if (!row) continue;
    const net = convert(entryNet(e), nativeCurrency(e.venue), row.currency);
    row.results += net;
    row.balance += net;
    row.entries += 1;
  }
  const all = { start: 0, adjustments: 0, results: 0, balance: 0, entries: 0, currency: allCurrency };
  for (const row of out.values()) {
    for (const f of ['start', 'adjustments', 'results', 'balance']) all[f] += convert(row[f], row.currency, allCurrency);
    all.entries += row.entries;
  }
  out.set(BANKROLL_ALL, all);
  return out;
}

/** The bankroll a NEW result defaults to: the one being viewed, else Main. */
export function defaultBankrollFor(selectedKey, bankrolls) {
  const k = toBankrollKey(selectedKey);
  if (k === BANKROLL_ALL || k === BANKROLL_MAIN) return BANKROLL_MAIN;
  const b = (bankrolls || []).find((x) => x.id === k);
  return b && !b.archived ? k : BANKROLL_MAIN;
}
