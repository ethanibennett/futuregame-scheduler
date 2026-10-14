'use strict';
/*
 * The reconciliation (docs/bankroll-merge.md §5.8): the dashboard's roll and fund (its own
 * computeBankroll, dashboard-bankroll.js) against this app's, and the difference explained line by
 * line. Shown before a commit (on a simulated commit, rolled back) and checked after it.
 *
 * Every ledger entry of a roll bankroll (or of the fund) falls in exactly one class:
 *   linked      written for a dashboard record (its key, or a transfer's second leg)
 *   mechanics   the opening deposit (dash:opening) or a rounding correction (dash:rounding:*)
 *   unlinked    everything else, before the opening date D or on/after it
 * and every dashboard record in exactly one of: imported, same (a confirmed duplicate), kept (changed
 * in the dashboard, futurega.me's row kept), or not linked (skipped). So
 *
 *   here − dashboard = opening    starts + unlinked before D + the opening − startingRoll
 *                    + onlyHere   unlinked on or after D (listed)
 *                    + pairs      same / kept records: what is here − what the dashboard counted
 *                    + editedHere imported records: what is here now − what the import wrote
 *                    + rounding   imported records: what the import wrote − the exact figure,
 *                                 plus the rounding corrections (under $0.50 per pocket)
 *                    + skipped    records not written (errors, $0 rows): −what the dashboard counted
 *                    + deletedThere rows still here for records the dashboard has deleted
 *
 * which is an identity; `unexplained` is what is left after the lines, and is 0 unless a class is
 * missing. The roll is every non-archived bankroll with in_roll = 1 except the fund (§17 Q4), in USD.
 */
const ledger = require('../bankroll-ledger');
const bankrolls = require('../bankrolls');
const { convert } = require('../analytics');
const { totals } = require('./dashboard-bankroll');

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const LIST_CAP = 200;
const isDashFp = (fp) => typeof fp === 'string' && (fp.startsWith('dash:') || fp.startsWith('chat-'));
const isMechanic = (fp) => fp === 'dash:opening' || (typeof fp === 'string' && fp.startsWith('dash:rounding:'));

function rowsOf(db, sql, params = []) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
function bankrollMeta(db, uid) {
  return rowsOf(db, 'SELECT id, role, in_roll, archived, currency, starting_balance FROM bankrolls WHERE user_id = ?', [uid]);
}
/** 'roll' | 'fund' | null for a ledger bankroll key ('main' or an id). */
function sideOf(metaById, fundId, key) {
  if (key === 'main' || key == null) return 'roll';
  if (fundId != null && key === fundId) return 'fund';
  const b = metaById.get(key);
  if (!b || b.archived || b.role === 'fund' || !Number(b.in_roll)) return null;
  return 'roll';
}
function fundIdOf(db, uid) {
  const r = rowsOf(db, "SELECT id FROM bankrolls WHERE user_id = ? AND role = 'fund' ORDER BY id LIMIT 1", [uid]);
  return r.length ? r[0].id : null;
}

/**
 * The ledger seen from the import: per pocket, the starting balances and every entry classified.
 * -> { fundId, starts, entries: [{ side, amount (USD), date, fp, mech, label, kind, ref }] }
 */
function classifiedLedger(db, uid, { rates, sources }) {
  const fundId = fundIdOf(db, uid);
  const meta = bankrollMeta(db, uid);
  const metaById = new Map(meta.map((b) => [b.id, b]));
  const list = bankrolls.listBankrolls(db, uid);
  const { entries } = ledger.collect(db, uid, { bankroll: 'all' }, sources);
  const run = ledger.runningBalances(entries, { bankrollList: list, scope: 'all', currency: 'USD', rates });
  const refFp = new Map();
  for (const k of rowsOf(db, 'SELECT fingerprint, ref_table, ref_id FROM bankroll_import_keys WHERE user_id = ?', [uid])) {
    if (isDashFp(k.fingerprint)) refFp.set(`${k.ref_table}:${k.ref_id}`, k.fingerprint);
  }
  const starts = { roll: 0, fund: 0 };
  for (const b of list) {
    const side = sideOf(metaById, fundId, b.id);
    if (side) starts[side] += convert(Number(b.starting_balance) || 0, b.currency || 'USD', 'USD', rates);
  }
  const out = [];
  for (const e of run.entries) {
    const side = sideOf(metaById, fundId, e.bankroll);
    if (!side) continue;
    let fp = refFp.get(`${e.ref.table}:${e.ref.id}`) || null;
    if (!fp && e.ref.table === 'bankroll_adjustments' && typeof e.transfer_id === 'string' && e.transfer_id.startsWith('dash:')) {
      fp = 'dash:adjustments:' + e.transfer_id.slice(5);
    }
    out.push({ side, amount: e.amount_display, date: e.date, fp, mech: isMechanic(fp), label: e.label, kind: e.kind, ref: e.ref });
  }
  return { fundId, starts, entries: out };
}

/**
 * opts = { dashState, rates, sources }. dashState = { startingRoll, openingDate, records: { fp: { roll,
 * fund, link: 'imported'|'same'|'kept'|null, rRoll, rFund, label, date } } }.
 */
function reconcile(db, uid, { dashState, rates, sources }) {
  const state = dashState || { startingRoll: 0, records: {} };
  const D = state.openingDate || null;
  const { fundId, starts, entries } = classifiedLedger(db, uid, { rates, sources });
  const dashboard = totals(state);
  const here = { roll: starts.roll, fund: starts.fund };
  const zero = () => ({ opening: 0, onlyHere: 0, pairs: 0, editedHere: 0, rounding: 0, skipped: 0, deletedThere: 0 });
  const lines = { roll: zero(), fund: zero() };
  lines.roll.opening = starts.roll - (Number(state.startingRoll) || 0);
  lines.fund.opening = starts.fund;
  const L = new Map(); // fp -> { roll, fund }
  const lists = { onlyHere: [], pairs: [], editedHere: [], skipped: [], deletedThere: [] };
  const push = (name, item) => { if (lists[name].length < LIST_CAP) lists[name].push(item); };
  for (const e of entries) {
    here[e.side] += e.amount;
    if (e.mech) {
      if (e.fp === 'dash:opening') lines[e.side].opening += e.amount; else lines[e.side].rounding += e.amount;
    } else if (e.fp) {
      const v = L.get(e.fp) || { roll: 0, fund: 0 };
      v[e.side] += e.amount;
      L.set(e.fp, v);
    } else if (D && e.date < D) {
      lines[e.side].opening += e.amount;
    } else {
      lines[e.side].onlyHere += e.amount;
      push('onlyHere', { side: e.side, date: e.date, amount: r2(e.amount), kind: e.kind, label: e.label, ref: e.ref });
    }
  }
  for (const [fp, rec] of Object.entries(state.records || {})) {
    const got = L.get(fp) || { roll: 0, fund: 0 };
    L.delete(fp);
    for (const side of ['roll', 'fund']) {
      const exact = Number(rec[side]) || 0;
      const have = got[side];
      if (rec.link === 'imported') {
        const rounded = Number(side === 'roll' ? rec.rRoll : rec.rFund) || 0;
        lines[side].rounding += rounded - exact;
        lines[side].editedHere += have - rounded;
        if (Math.abs(have - rounded) >= 0.005) push('editedHere', { side, fp, date: rec.date || null, label: rec.label || null, amount: r2(have - rounded) });
      } else if (rec.link === 'same' || rec.link === 'kept') {
        lines[side].pairs += have - exact;
        if (Math.abs(have - exact) >= 0.005) push('pairs', { side, fp, date: rec.date || null, label: rec.label || null, amount: r2(have - exact), link: rec.link });
      } else {
        lines[side].skipped += have - exact;
        if (Math.abs(have - exact) >= 0.005) push('skipped', { side, fp, date: rec.date || null, label: rec.label || null, amount: r2(have - exact) });
      }
    }
  }
  for (const [fp, got] of L) { // linked rows whose record the dashboard no longer has
    for (const side of ['roll', 'fund']) {
      lines[side].deletedThere += got[side];
      if (Math.abs(got[side]) >= 0.005) push('deletedThere', { side, fp, amount: r2(got[side]) });
    }
  }
  const out = { dashboard, here: { roll: r2(here.roll), fund: r2(here.fund) }, fundId, openingDate: D, lines: {}, unexplained: {}, lists };
  for (const side of ['roll', 'fund']) {
    const l = lines[side];
    const sum = Object.values(l).reduce((a, b) => a + b, 0);
    out.lines[side] = Object.fromEntries(Object.entries(l).map(([k, v]) => [k, r2(v)]));
    out.unexplained[side] = r2(here[side] - dashboard[side] - sum);
    out.lines[side].difference = r2(here[side] - dashboard[side]);
  }
  // The fund must match to within its rounding remainder (§5.8): everything else on the fund side
  // is a listed line (rows here only, pairs, skipped rows), so that is what is compared.
  out.fundWithinRemainder = Math.abs(out.lines.fund.rounding) < 0.5 && out.unexplained.fund === 0;
  return out;
}

/** Σ over roll bankrolls of their balance strictly before `date` (the opening formula's subtrahend), in USD. */
function rollBalanceBefore(db, uid, date, { rates, sources }) {
  const { starts, entries } = classifiedLedger(db, uid, { rates, sources });
  let v = starts.roll;
  const parts = { starts: r2(starts.roll), moved: 0, results: 0 };
  for (const e of entries) {
    if (e.side !== 'roll' || !(e.date < date)) continue;
    v += e.amount;
    if (ledger.MOVE_KINDS.has(e.kind)) parts.moved += e.amount; else parts.results += e.amount;
  }
  return { total: r2(v), parts: { starts: parts.starts, moved: r2(parts.moved), results: r2(parts.results) } };
}

module.exports = { reconcile, rollBalanceBefore, classifiedLedger, fundIdOf, sideOf, isDashFp, isMechanic };
