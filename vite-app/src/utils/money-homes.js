/* Money homes (Phase 10): the wording of the fund line, the "Where the money is" section and the tax
 * set-aside line, free of the DOM (utils/__tests__/money-homes.test.mjs). The figures come from
 * GET /api/bankrolls/money/homes (lib/money-homes.js); nothing here recomputes a balance.
 */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function normaliseHomes(d) {
  if (!d || typeof d !== 'object') return null;
  const f = d.fund && typeof d.fund === 'object' ? d.fund : null;
  return {
    fund: f ? {
      bankrollId: f.bankrollId, name: f.name || 'WSOP fund', saved: num(f.saved), target: f.target == null ? null : num(f.target), targetDate: f.targetDate || null,
      pace: f.pace && typeof f.pace === 'object' ? { left: num(f.pace.left), monthsLeft: f.pace.monthsLeft == null ? null : num(f.pace.monthsLeft), needPerMonth: f.pace.needPerMonth == null ? null : num(f.pace.needPerMonth), perMonthSoFar: f.pace.perMonthSoFar == null ? null : num(f.pace.perMonthSoFar), onTrack: f.pace.onTrack == null ? null : !!f.pace.onTrack } : null,
    } : null,
    locations: (Array.isArray(d.locations) ? d.locations : []).map((l) => ({ id: l.id, name: String(l.name || ''), amount: num(l.amount), currency: l.currency || 'USD' })),
    locationsTotal: num(d.locationsTotal), roll: num(d.roll), wsopFund: num(d.wsopFund), drift: num(d.drift), foreign: num(d.foreign),
    taxSetAsidePct: d.taxSetAsidePct == null ? 30 : num(d.taxSetAsidePct),
  };
}

/**
 * The fund's rows, each a short value with its note (the Bankroll block's BRow: a long phrase in the
 * value column truncates). fmtDate formats the target day the app's way.
 * -> { label, text, note, pct, pace: { note, text, tone } | null, soFar: { note, text } | null }
 */
export function fundView(fund, money, fmtDate = (d) => d) {
  if (!fund) return null;
  const pct = fund.target > 0 ? Math.max(0, Math.min(1, fund.saved / fund.target)) : null;
  const p = fund.pace;
  let pace = null;
  if (p && fund.target > 0) {
    if (p.left <= 0) pace = { note: 'the target is met', text: 'Reached', tone: 1 };
    else if (p.monthsLeft == null) pace = { note: `${money(p.left)} to go`, text: '—', tone: 0 };
    else if (p.monthsLeft <= 0) pace = { note: 'the day has passed', text: `${money(p.left)} short`, tone: -1 };
    else pace = { note: `${money(p.needPerMonth)} a month needed`, text: p.onTrack == null ? '—' : p.onTrack ? 'On track' : 'Behind', tone: p.onTrack == null ? 0 : p.onTrack ? 1 : -1 };
  }
  const soFar = p && p.perMonthSoFar != null && fund.target > 0 && p.left > 0 ? { note: 'a month since its first entry', text: money(p.perMonthSoFar) } : null;
  return {
    label: fund.name,
    text: fund.target > 0 ? `${money(fund.saved)} of ${money(fund.target)}` : money(fund.saved),
    pct: pct == null ? null : Math.round(pct * 100),
    note: fund.targetDate && fund.target > 0 ? `${Math.round(pct * 100)}% · by ${fmtDate(fund.targetDate)}` : 'no target set',
    pace, soFar,
  };
}

/** The drift row: a short value (the difference) and its note (the ledger's total). */
export function driftView(h, money) {
  const total = h.roll + h.wsopFund;
  const d = Math.round(h.drift * 100) / 100;
  const note = `the ledger: ${money(total)}`;
  if (!h.locations.length) return { text: 'Not listed', note, tone: 0 };
  if (Math.abs(d) < 0.5) return { text: 'Adds up', note, tone: 1 };
  return { text: `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`, note, tone: -1 };
}

/** The tax set-aside line: pct of the net when it is a profit. */
export function setAsideView(net, pct, money) {
  const p = Number.isFinite(Number(pct)) ? Number(pct) : 30;
  const n = num(net);
  if (n <= 0) return { label: `Set aside for tax (${p}%)`, value: money(0), note: 'nothing to set aside on a losing year' };
  return { label: `Set aside for tax (${p}%)`, value: money(Math.round(n * p) / 100), note: `${p}% of the net` };
}
