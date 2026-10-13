// ── The bankroll Overview's tables (beta, app admins) ─────────────────────────────────────
// Pure and dependency-free apart from bankroll-ledger.js (runs under `node --test`). The Overview
// tab (components/BankrollOverviewTables.jsx) shows its figures as collapsible tables, the way a
// dedicated tracker lays out its overview: columns Cash | Tournaments | Total.
//
//   summaryTable(entries)    buy-ins, cash-outs, tips & costs, net, expenses & income, the total
//                            result (= the hero's profit), money moved, the balance change
//   sessionsTable(entries)   volume and rates: sessions / events, bullets, hours, $/h, ROI, won %,
//                            averages, biggest win and loss
//   groupTable(facts, dim)   one row per game or room, cash and tournaments apart
//   bankrollFigures(...)     balance, the all-time peak, below it, deepest drawdown, money moved
//
// Inputs: ledger rows (GET /api/bankrolls/ledger, already in the display currency, cut to the
// range) and report facts (GET /api/bankrolls/reports). A figure with nothing under it is null —
// the table draws a dash, never $0 or NaN. A Total cell is null when it would mix a column it
// cannot account for (a ratio that means different things for cash and tournaments).
// See docs/bankrolls.md "The dashboard".

import { MOVE_KINDS, rangeWindow, within, balanceSeries, drawdowns, peakOf, periodTable } from './bankroll-ledger.js';

export const DASH = '—';
const MINUS = '−'; // as utils.js MINUS: plus-width in the app's faces, so signed columns align

// ── The sections and their open / closed state ──────────────────────────────────────────
export const SECTIONS = [
  { key: 'summary', label: 'Summary', open: true },
  { key: 'sessions', label: 'Sessions', open: true },
  { key: 'games', label: 'Games', open: false },
  { key: 'rooms', label: 'Rooms', open: false },
  { key: 'bankroll', label: 'Bankroll', open: false },
  { key: 'periods', label: 'By month', open: false },
];
export const OPEN_STORE_KEY = 'bankrollOverviewOpen';

/** The open / closed map from what localStorage held (JSON, or junk, or nothing): defaults filled in. */
export function parseOpen(raw) {
  const out = {};
  for (const s of SECTIONS) out[s.key] = s.open;
  let saved = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const s of SECTIONS) if (typeof saved[s.key] === 'boolean') out[s.key] = saved[s.key];
  }
  return out;
}

// ── Whose figures these are ──────────────────────────────────────────────────────────────
/**
 * The bankroll and currency the figures in hand belong to. The dashboard keeps the previous ledger
 * on screen while the next one loads, but its bankroll chip and display currency change at once —
 * so the tables name their scope, format their money and query the reports from the LEDGER
 * (`d.bankroll`, `d.currency`), and are `stale` until it is the one asked for.
 *   d          the ledger response: { bankroll: 'all' | 'main' | id, currency }
 *   key        the bankroll asked for ('all' | 'main' | id); `currency` the one asked for
 *   bankrolls  the user's bankrolls ({ id, name }), to name it
 * Returns { key (a string), currency, name, stale }.
 */
export function ledgerScope(d, { key, currency, bankrolls = [] } = {}) {
  const k = d && d.bankroll != null ? String(d.bankroll) : String(key);
  const cur = (d && d.currency) || currency;
  const found = k === 'all' ? null : (bankrolls || []).find((x) => String(x.id) === k);
  const name = k === 'all' ? 'All bankrolls' : found ? found.name : 'Bankroll';
  return { key: k, currency: cur, name, stale: k !== String(key) || cur !== currency };
}
/** Whether a response that names its scope (/risk, /reports: { bankroll, currency }) is for `scope`. */
export function sameScope(res, scope) {
  return !!res && !!scope && res.bankroll != null && String(res.bankroll) === scope.key && res.currency === scope.currency;
}

// ── Formatting ───────────────────────────────────────────────────────────────────────────
const fin = (v) => v != null && Number.isFinite(Number(v));

/**
 * The sign of money AS fmtMoney DRAWS IT (whole units): 1, −1, or 0 for null and for anything that
 * rounds to 0. Colour a figure by this, never by the raw value, or −0.38 is a red "$0" — a figure
 * with no sign must not carry the colour of one.
 */
export function moneySign(v) {
  if (!fin(v)) return 0;
  const r = Math.round(Number(v));
  return r > 0 ? 1 : r < 0 ? -1 : 0;
}

/**
 * Money in whole units, compact from 10,000 up: $1,239 · $403.2k · $1.2M. `cfg` is the currency's
 * { symbol, pos } (utils.js CURRENCY_CONFIG); `sign` prefixes + / − (zero unsigned). null → dash.
 * Whole units decide the sign and the 10k threshold; the compact body rounds the UNROUNDED
 * magnitude once (rounding to whole units first would turn 13,349.63 into $13.4k).
 */
export function fmtMoney(v, cfg = { symbol: '$', pos: 'pre' }, { sign = false } = {}) {
  if (!fin(v)) return DASH;
  const x = Number(v);
  const r = Math.abs(Math.round(x));
  const a = Math.abs(x);
  let body;
  if (r >= 1e4) {
    const k = Math.round(a / 100) / 10;
    body = k >= 1000 ? (Math.round(a / 1e5) / 10).toFixed(1) + 'M' : k.toFixed(1) + 'k';
  } else {
    body = r.toLocaleString('en-US');
  }
  const sg = moneySign(x);
  const s = sg < 0 ? MINUS : sign && sg > 0 ? '+' : '';
  return cfg.pos === 'suf' ? `${s}${body} ${cfg.symbol}` : `${s}${cfg.symbol}${body}`;
}
/** A ratio as a percentage: one decimal under 10%, whole above. A value that shows as 0 is unsigned. */
export function fmtPct(x, { sign = false } = {}) {
  if (!fin(x)) return DASH;
  const v = Number(x) * 100;
  const a = Math.abs(v);
  const digits = a.toFixed(a < 10 ? 1 : 0);
  if (Number(digits) === 0) return '0%';
  return (v < 0 ? MINUS : sign ? '+' : '') + digits + '%';
}
export function fmtCount(n) { return fin(n) ? Math.round(Number(n)).toLocaleString('en-US') : DASH; }
export function fmtHours(h) {
  if (!fin(h)) return DASH;
  const v = Number(h);
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
}
export function fmtRatio(x) { return fin(x) ? Number(x).toFixed(2) : DASH; }

// ── Helpers ──────────────────────────────────────────────────────────────────────────────
const num = (v) => Number(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;
const r2n = (v) => (v == null ? null : r2(v));
// Display units per one unit of the entry's own currency (the ledger's fx_display; 1 if absent).
const fx = (e) => (fin(e.fx_display) ? Number(e.fx_display) : 1);
const isMove = (e) => MOVE_KINDS.has(e.kind);
const isCash = (e) => e.source === 'cash-sessions';
const isTourn = (e) => e.source === 'tournaments';
const div = (a, b) => (b > 0 ? a / b : null);

// ── Summary ──────────────────────────────────────────────────────────────────────────────
/**
 * Columns cash / tournaments / total over ledger rows already cut to the range.
 *   buyins    cash: buy_in (rebuys included) · tournaments: cost (buy-in x bullets)
 *   cashouts  cash: cash_out · tournaments: the cash (only when cashed)
 *   costs     cash: tips + session expenses, as a negative (tournaments have none)
 *   net       the ledger amount: cash_out − buy_in − tips − expenses; cash − cost
 *   other     Total only: every result that is neither (expenses and income, any other source)
 *   result    net per column; Total = net + other = the Overview hero's profit
 *   moved     Total only: deposits, withdrawals and transfers
 *   change    Total only: result + moved (what the balance did over the range)
 * A column with no rows is all null. Cash buy-ins / cash-outs / costs are null when a session
 * lacks the money fields (an older server); the Total then refuses to add a part it cannot see.
 */
export function summaryTable(entries) {
  const c = { n: 0, priced: 0, buyins: 0, cashouts: 0, costs: 0, net: 0 };
  const t = { n: 0, buyins: 0, cashouts: 0, net: 0 };
  let other = 0, otherN = 0, moved = 0, movedN = 0, results = 0;
  for (const e of entries) {
    const a = num(e.amount_display);
    if (isMove(e)) { moved += a; movedN++; continue; }
    results += a;
    if (isCash(e)) {
      c.n++; c.net += a;
      if (fin(e.buy_in) && fin(e.cash_out)) {
        c.priced++;
        c.buyins += num(e.buy_in) * fx(e);
        c.cashouts += num(e.cash_out) * fx(e);
        c.costs -= (num(e.tips) + num(e.expenses)) * fx(e);
      }
    } else if (isTourn(e)) {
      t.n++; t.net += a;
      t.buyins += num(e.cost) * fx(e);
      t.cashouts += num(e.cash) * fx(e);
    } else {
      other += a; otherN++;
    }
  }
  const cPriced = c.n > 0 && c.priced === c.n;
  const cash = c.n ? {
    buyins: cPriced ? r2(c.buyins) : null, cashouts: cPriced ? r2(c.cashouts) : null, costs: cPriced ? r2(c.costs) : null,
    net: r2(c.net), result: r2(c.net),
  } : { buyins: null, cashouts: null, costs: null, net: null, result: null };
  const tournaments = t.n ? {
    buyins: r2(t.buyins), cashouts: r2(t.cashouts), costs: null, net: r2(t.net), result: r2(t.net),
  } : { buyins: null, cashouts: null, costs: null, net: null, result: null };
  const played = c.n + t.n > 0;
  // A Total of money parts: null when a column that has rows could not price them.
  const part = (k) => {
    if (!played || (c.n && cash[k] == null)) return null;
    return r2((cash[k] || 0) + (tournaments[k] || 0));
  };
  const total = {
    buyins: part('buyins'),
    cashouts: part('cashouts'),
    costs: c.n ? cash.costs : null,
    net: played ? r2(c.net + t.net) : null,
    other: otherN ? r2(other) : null,
    result: played || otherN ? r2(results) : null,
    moved: movedN ? r2(moved) : null,
    change: entries.length ? r2(results + moved) : null,
  };
  return {
    cash, tournaments, total,
    counts: { cash: c.n, tournaments: t.n, other: otherN, moved: movedN },
    // The tips & costs row only shows when some session had them.
    showCosts: cash.costs != null && cash.costs !== 0,
  };
}

// ── Sessions ─────────────────────────────────────────────────────────────────────────────
const pick = (a, b, better) => (!a ? b : !b ? a : better(b.amount, a.amount) ? b : a);
const best = (a, b) => pick(a, b, (x, y) => x > y);
const worst = (a, b) => pick(a, b, (x, y) => x < y);
const extreme = (e) => ({ amount: r2(num(e.amount_display)), label: e.label || '', date: e.date, source: e.source });

/**
 * Volume and rates per column. Every value null when its column has no rows; hours and $/h are
 * cash only (tournament results carry no playing time, so they are never guessed); ROI is
 * tournaments only (a cash buy-in is not a cost — the chips can go home again).
 *   count       sessions / events          bullets   tournament entries (re-entries included)
 *   hours       timed sessions' hours      hourly    their profit / their hours
 *   roi         profit / cost              won       cash: winning sessions · tournaments: cashes per entry
 *   avgBuyin    buy-ins / count            avgProfit net / count
 *   avgRebuys   cash: rebuys per session · tournaments: re-entries per event (bullets − events)
 *   best, worst the single best and worst result ({ amount, label, date, source })
 * Total: count, average buy-in, average profit and average rebuys over both columns; best and worst
 * of both; hours, $/h, ROI and won % only when one column has rows (they mean different things).
 */
export function sessionsTable(entries) {
  const c = { n: 0, net: 0, hours: 0, timedProfit: 0, wins: 0, buyins: 0, rebuys: 0, priced: 0, best: null, worst: null };
  const t = { n: 0, net: 0, bullets: 0, cost: 0, cashes: 0, best: null, worst: null };
  for (const e of entries) {
    if (isMove(e)) continue;
    const a = num(e.amount_display);
    let col = null;
    if (isCash(e)) {
      col = c; c.n++; c.net += a;
      if (a > 0) c.wins++;
      if (num(e.hours) > 0) { c.hours += num(e.hours); c.timedProfit += a; }
      if (fin(e.buy_in)) { c.priced++; c.buyins += num(e.buy_in) * fx(e); c.rebuys += num(e.rebuys); }
    } else if (isTourn(e)) {
      col = t; t.n++; t.net += a;
      t.bullets += num(e.units) > 0 ? num(e.units) : 1;
      t.cost += num(e.cost) * fx(e);
      if (num(e.cash) > 0) t.cashes++;
    }
    if (!col) continue;
    if (a > 0) col.best = best(col.best, extreme(e));
    if (a < 0) col.worst = worst(col.worst, extreme(e));
  }
  const cPriced = c.n > 0 && c.priced === c.n;
  const cash = c.n ? {
    count: c.n, bullets: null,
    hours: c.hours > 0 ? r2(c.hours) : null, hourly: r2n(div(c.timedProfit, c.hours)),
    roi: null, won: div(c.wins, c.n),
    avgBuyin: cPriced ? r2(c.buyins / c.n) : null, avgProfit: r2(c.net / c.n),
    avgRebuys: cPriced ? c.rebuys / c.n : null,
    best: c.best, worst: c.worst,
  } : null;
  const tournaments = t.n ? {
    count: t.n, bullets: t.bullets, hours: null, hourly: null,
    // ITM per ENTRY, the app's rule (lib/analytics.js, the Analytics tab): a re-entry that cashes
    // once is one cash in its bullets, so the two tabs never show two ITMs for the same results.
    roi: div(t.net, t.cost), won: div(t.cashes, t.bullets),
    avgBuyin: r2(t.cost / t.n), avgProfit: r2(t.net / t.n),
    avgRebuys: (t.bullets - t.n) / t.n,
    best: t.best, worst: t.worst,
  } : null;
  const n = c.n + t.n;
  const only = (k) => (c.n && !t.n ? cash[k] : t.n && !c.n ? tournaments[k] : null);
  const cashMoneyKnown = !c.n || cPriced;
  const total = n ? {
    count: n, bullets: null,
    hours: only('hours'), hourly: only('hourly'), roi: only('roi'), won: only('won'),
    avgBuyin: cashMoneyKnown ? r2((c.buyins + t.cost) / n) : null,
    avgProfit: r2((c.net + t.net) / n),
    avgRebuys: cashMoneyKnown ? (c.rebuys + t.bullets - t.n) / n : null,
    best: best(c.best, t.best), worst: worst(c.worst, t.worst),
  } : null;
  const blank = { count: null, bullets: null, hours: null, hourly: null, roi: null, won: null, avgBuyin: null, avgProfit: null, avgRebuys: null, best: null, worst: null };
  return { cash: cash || blank, tournaments: tournaments || blank, total: total || blank, counts: { cash: c.n, tournaments: t.n } };
}

// ── Games and rooms (from the report facts) ──────────────────────────────────────────────
const inWindow = (date, w) => !!date && (!w || ((!w.from || date >= w.from) && (!w.to || date <= w.to)));

/**
 * One row per game (dim 'game') or room (dim 'room'), cash sessions and tournaments apart (a
 * cash game's rate is per hour, a tournament's is ROI, so a row never mixes them), over the facts
 * of GET /api/bankrolls/reports inside window `w` ({ from, to }, null bounds open).
 *   row: { key, label (null = not recorded), n, hours (cash; tournaments null), rate (cash $/h,
 *          tournament ROI), total }
 * Sorted by total, best first; the not-recorded row last. `named` counts the distinct names
 * across both (case-folded), for the collapsed header. Totals per side equal that column's net.
 */
export function groupTable(facts, dim, w = null) {
  const sides = { cash: new Map(), tournament: new Map() };
  for (const f of facts || []) {
    if (f.type !== 'cash' && f.type !== 'tournament') continue;
    if (!inWindow(f.date, w)) continue;
    const raw = String(f[dim] || '').trim();
    const key = raw.toLowerCase();
    const map = sides[f.type];
    let g = map.get(key);
    if (!g) { g = { key, label: raw || null, n: 0, hours: 0, timedProfit: 0, cost: 0, total: 0 }; map.set(key, g); }
    const p = num(f.profit);
    g.n++; g.total += p;
    if (f.type === 'cash') { if (num(f.hours) > 0) { g.hours += num(f.hours); g.timedProfit += p; } }
    else g.cost += num(f.cost);
  }
  const rows = (map, type) => [...map.values()].map((g) => ({
    key: g.key, label: g.label, n: g.n,
    hours: type === 'cash' && g.hours > 0 ? r2(g.hours) : null,
    rate: type === 'cash' ? r2n(div(g.timedProfit, g.hours)) : div(g.total, g.cost),
    total: r2(g.total),
  })).sort((a, b) => (a.label == null) - (b.label == null) || b.total - a.total || b.n - a.n || String(a.label).localeCompare(String(b.label)));
  const cash = rows(sides.cash, 'cash'), tournament = rows(sides.tournament, 'tournament');
  const named = new Set([...cash, ...tournament].filter((r) => r.label != null).map((r) => r.key));
  return { cash, tournament, named: named.size, empty: cash.length + tournament.length === 0 };
}

// ── Bankroll ─────────────────────────────────────────────────────────────────────────────
/**
 * The roll itself, from the whole ledger response `d` ({ entries, opening, closing }, every entry
 * of the bankroll, all time) and the range: the balance now, the all-time peak and how far below it
 * the roll is, the deepest drawdown of the balance inside the range ({ amount, from, to } or null),
 * and the money moved in the range (null when none). The same arithmetic as the graph's.
 */
export function bankrollFigures(d, range, today) {
  const entries = d.entries || [];
  const w = rangeWindow(range, today);
  const win = within(entries, w);
  let opening = d.opening ? d.opening.total_display : 0;
  if (w.from) for (const e of entries) { if (e.date < w.from) opening = e.total_display; else break; }
  const balPts = balanceSeries(win, { opening, from: w.from });
  const allPts = balanceSeries(entries, { opening: d.opening ? d.opening.total_display : 0, from: entries[0] ? entries[0].date : null });
  const peak = peakOf(allPts);
  const balance = d.closing ? d.closing.total_display : 0;
  const dd = drawdowns(balPts).max;
  let moved = 0, movedN = 0;
  for (const e of win) if (isMove(e)) { moved += num(e.amount_display); movedN++; }
  return {
    balance, peak, below: r2(Math.max(0, peak.value - balance)),
    drawdown: dd.amount > 0 ? { amount: r2(dd.amount), from: dd.from, to: dd.to } : null,
    moved: movedN ? r2(moved) : null,
  };
}

/** Everything the tables read from the ledger, for one range: the window, its rows and each table. */
export function overviewTables(d, range, today) {
  const w = rangeWindow(range, today);
  const win = within(d.entries || [], w);
  const bucket = range === 'all' ? 'year' : 'month';
  return {
    window: w, win, bucket,
    summary: summaryTable(win),
    sessions: sessionsTable(win),
    bankroll: bankrollFigures(d, range, today),
    periods: periodTable(win, bucket),
  };
}
