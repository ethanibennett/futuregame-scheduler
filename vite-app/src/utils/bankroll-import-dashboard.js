// The dashboard import's review (Bankroll › Import › From the dashboard app; docs/bankroll-merge.md
// §9.3, Phase 6): the pure parts of BankrollImportDashboard.jsx, tested in
// __tests__/bankroll-import-dashboard.test.mjs.
//
// The server builds the plan (lib/money-import/plan.js) and holds the answers; nothing here adds
// up money or decides anything the server would decide differently. This module:
//   - groups the plan into the review's sections (groupPlan);
//   - merges the owner's answers while they wait to be saved (mergePatch) and shows them on the plan
//     at once (applyPatch), so a tap reads as answered before the server has replied;
//   - says whether the import can be committed, and why not (commitReadiness);
//   - names what a commit writes, per table (writesList), and what an undo found edited (editedRows);
//   - finds what changed between two plans, for the "review the highlighted items" after a 409
//     stale (diffPlans);
//   - words the server's refusals as plain sentences (fetchError, commitError, undoError);
//   - formats money, days and times, and pages the long lists (pageOf: the Locations tab's pager).
import { rowsPage, FIRST_ROWS, PAGE_ROWS } from './bankroll-locations.js';

export { FIRST_ROWS, PAGE_ROWS };
export const MINUS = '−';
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
export const plural = (n, one, many = one + 's') => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;

// ── formatting ──────────────────────────────────────────────────────────────────────────────

/** Dollars, with cents only when there are any: "$1,234", "$449.85", "−$37.40"; sign adds "+". */
export function fmtMoney(v, { sign = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const cents = Math.round(Math.abs(n) * 100);
  const whole = cents % 100 === 0;
  const body = '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  if (cents === 0) return '$0';
  if (n < 0) return MINUS + body;
  return (sign ? '+' : '') + body;
}
/** A result in words as well as colour: "+$800 won", "−$1,200 lost", "$0 even". */
export function resultWords(v) {
  const n = Number(v) || 0;
  const c = Math.round(n * 100);
  return c > 0 ? `${fmtMoney(n, { sign: true })} won` : c < 0 ? `${fmtMoney(n)} lost` : '$0 even';
}
/** 'pos' | 'neg' | '' for a figure (an-pos / an-neg). */
export const toneOf = (v) => { const c = Math.round((Number(v) || 0) * 100); return c > 0 ? 'pos' : c < 0 ? 'neg' : ''; };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' -> 'Mar 5, 2026' (the date as written; no zone moves it). */
export function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '—';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}
/** An ISO timestamp -> 'Oct 14, 2026, 3:05 PM' in the viewer's zone (or `timeZone`). */
export function fmtWhen(iso, timeZone) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
}
export function fmtHours(h) {
  if (h == null || !Number.isFinite(Number(h))) return '—';
  const n = Math.round(Number(h) * 100) / 100;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} h`;
}

// ── the runs ────────────────────────────────────────────────────────────────────────────────

const STATUS_WORD = { staged: 'In review', committed: 'Imported', undone: 'Undone', discarded: 'Discarded' };
/** The run in review (newest staged) and the newest committed one (the one Undo may reverse). */
export function currentRuns(runs) {
  const list = Array.isArray(runs) ? runs : [];
  return {
    staged: list.find((r) => r.status === 'staged') || null,
    committed: list.find((r) => r.status === 'committed') || null,
  };
}
/** One past run as a row: "#3 Imported" | "131 rows · Oct 14, 2026, 3:05 PM". */
export function runLine(r, timeZone) {
  const status = STATUS_WORD[r.status] || r.status;
  const mode = r.mode === 'delta' ? ' (changes)' : '';
  let detail;
  if (r.status === 'committed') detail = `${plural(r.undoCount || 0, 'row')} · ${fmtWhen(r.committedAt, timeZone)}`;
  else if (r.status === 'undone') detail = `undone ${fmtWhen(r.undoneAt, timeZone)}`;
  else if (r.status === 'staged') detail = r.undecided ? `${plural(r.undecided, 'pair')} to answer` : `fetched ${fmtWhen(r.fetchedAt, timeZone)}`;
  else detail = `fetched ${fmtWhen(r.fetchedAt, timeZone)}`;
  return { id: r.id, title: `#${r.id} ${status}${mode}`, detail, status: r.status };
}

// ── the answers ─────────────────────────────────────────────────────────────────────────────

const MAPS = ['pairs', 'backers', 'slate', 'changes', 'deletions'];
/**
 * Two batches of answers as one PUT /decisions body. The maps merge key by key (a later answer for
 * the same item wins; null, "clear this answer", is kept as an answer). `opening` (the whole
 * override, amount AND date, or null to go back to the computed figure) and `target` are replaced.
 */
export function mergePatch(a, b) {
  const out = {};
  for (const src of [a || {}, b || {}]) {
    for (const [k, v] of Object.entries(src)) {
      if (MAPS.includes(k)) out[k] = { ...(out[k] || {}), ...(v || {}) };
      else if (v !== undefined) out[k] = v;
    }
  }
  return out;
}
export function isEmptyPatch(p) {
  if (!p) return true;
  return Object.entries(p).every(([k, v]) => (MAPS.includes(k) ? !v || Object.keys(v).length === 0 : v === undefined));
}

/** The plan as it reads with answers not yet saved. Recounts `undecided`; touches no figure. */
export function applyPatch(plan, patch) {
  if (!plan || isEmptyPatch(patch)) return plan;
  const p = patch;
  const pairs = plan.pairs.map((x) => (p.pairs && has(p.pairs, x.id) ? { ...x, decision: p.pairs[x.id] } : x));
  const backers = plan.backers.map((b) => (p.backers && has(p.backers, b.fp) ? { ...b, choice: p.backers[b.fp] } : b));
  const slate = { ...plan.slate, backers: plan.slate.backers.map((s) => (p.slate && has(p.slate, s.key) ? { ...s, choice: String(p.slate[s.key]) } : s)) };
  const changes = plan.changes.map((c) => (p.changes && has(p.changes, c.itemId) ? { ...c, decision: p.changes[c.itemId] } : c));
  const deletions = plan.deletions.map((c) => (p.deletions && has(p.deletions, c.itemId) ? { ...c, decision: p.deletions[c.itemId] } : c));
  let opening = plan.opening;
  if (opening && has(p, 'opening')) {
    const c = opening.computed;
    if (p.opening === null) opening = { ...opening, amount: Math.round(c.amount), date: c.date, override: false };
    else {
      const amount = p.opening.amount == null || p.opening.amount === '' ? Math.round(c.amount) : Math.round(Number(p.opening.amount));
      opening = { ...opening, amount, date: p.opening.date || c.date, override: true };
    }
    opening.kind = opening.amount > 0 ? 'deposit' : opening.amount < 0 ? 'withdrawal' : null;
  }
  const target = has(p, 'target') ? { ...plan.target, bankroll: p.target } : plan.target;
  return { ...plan, pairs, backers, slate, changes, deletions, opening, target, undecided: pairs.filter((x) => !x.decision).length };
}

/** "Fill the likely ones": every Likely pair still unanswered, as Same, keep futurega.me's. */
export function fillLikely(plan) {
  const ids = (plan ? plan.pairs : []).filter((x) => x.class === 'likely' && !x.decision).map((x) => x.id);
  return ids.length ? { pairs: Object.fromEntries(ids.map((id) => [id, 'same-keep'])) } : null;
}

/** The three answers to a pair, worded for its kind. `take` is off where the server says it cannot be. */
export function pairOptions(pair) {
  const same = pair.kind === 'cash' || pair.kind === 'tournament' ? 'Same night'
    : pair.kind === 'deposit' ? 'Same deposit' : pair.kind === 'withdrawal' ? 'Same withdrawal' : pair.kind === 'expense' ? 'Same expense' : 'Same';
  return [
    { value: 'same-keep', top: same, sub: "keep futurega.me's", disabled: false },
    { value: 'same-take', top: same, sub: "take the dashboard's", disabled: !pair.canTake, why: pair.takeWhy || null },
    { value: 'different', top: 'Different', sub: 'import it too', disabled: false },
  ];
}

/** A pair's field rows, both sides: [{ key, label, dash, here, same, tone }]. */
export function pairFields(pair) {
  const d = pair.dash || {}, h = pair.here || {}, s = pair.same || {};
  const row = (key, label, fmt, toneKey) => ({ key, label, dash: fmt(d), here: fmt(h), same: !!s[key], dashTone: toneKey ? toneOf(d[toneKey]) : '', hereTone: toneKey ? toneOf(h[toneKey]) : '' });
  const date = row('date', 'Date', (x) => fmtDay(x.date));
  if (pair.kind === 'cash' || pair.kind === 'tournament') {
    const inOut = { ...row('in', 'In → out', (x) => `${fmtMoney(x.in)} → ${fmtMoney(x.out)}`), same: !!(s.in && s.out) };
    return [
      date,
      row('room', 'Room', (x) => x.room || '—'),
      row('game', 'Game', (x) => x.game || '—'),
      inOut,
      row('result', 'Result', (x) => resultWords(x.result), 'result'),
      row('hours', 'Hours', (x) => fmtHours(x.hours)),
    ];
  }
  if (pair.kind === 'expense') {
    return [date, row('category', 'Category', (x) => x.category || '—'), row('amount', 'Amount', (x) => fmtMoney(x.amount)), row('note', 'Note', (x) => x.note || '—')];
  }
  return [date, row('kind', 'Kind', (x) => (x.kind ? x.kind[0].toUpperCase() + x.kind.slice(1) : '—')), row('amount', 'Amount', (x) => fmtMoney(x.amount, { sign: true }), 'amount'), row('note', 'Note', (x) => x.note || '—')];
}

// ── grouping ────────────────────────────────────────────────────────────────────────────────

export const COUNT_ROWS = [
  ['sessions', 'Cash sessions'], ['tournaments', 'Tournaments'], ['adjustments', 'Adjustments'], ['expenses', 'Expenses'],
  ['backers', 'Backers'], ['slate', 'Slate deals'], ['balances', 'Balances'], ['settings', 'Settings'],
];
const CAT_LABEL = {
  sessions: 'Results', adjustments: 'Adjustments', expenses: 'Expenses', backer: 'Backers', backers: 'Backers',
  deal: 'Slate deals', 'wsop-staking': 'Slate deals', location: 'Balances', 'wsop-balances': 'Balances', taxrate: 'Settings', 'wsop-admin-taxrate': 'Settings',
};
const SOURCE_LABEL = {
  roster: 'Live in the dashboard', 'deleted-in-dashboard': 'Deleted in the dashboard', 'roster-here-only': 'On this app’s roster only', 'history-only': 'History only',
};
export const sourceLabel = (s) => SOURCE_LABEL[s] || 'Dashboard';

const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));
function groupBy(list, keyOf) {
  const m = new Map();
  for (const x of list) { const k = keyOf(x); (m.get(k) || m.set(k, []).get(k)).push(x); }
  return [...m].map(([label, items]) => ({ label, items }));
}

/** The review's sections, in the order the screen shows them. */
export function groupPlan(plan) {
  const pairs = [...plan.pairs].sort((a, b) => (a.class === b.class ? 0 : a.class === 'likely' ? -1 : 1) || (b.score - a.score) || byDateDesc(a.dash, b.dash) || a.id.localeCompare(b.id));
  const answerable = (b) => b.status === 'new' || b.status === 'reimport';
  return {
    counts: COUNT_ROWS.filter(([k]) => plan.counts && plan.counts[k]).map(([k, label]) => {
      const c = plan.counts[k];
      return { key: k, label, new: c.new || 0, toReview: c.toReview || 0, unchanged: c.unchanged || 0 };
    }),
    pairs: {
      list: pairs,
      likely: pairs.filter((x) => x.class === 'likely').length,
      possible: pairs.filter((x) => x.class !== 'likely').length,
      answered: pairs.filter((x) => !!x.decision).length,
      fillable: pairs.filter((x) => x.class === 'likely' && !x.decision).length,
    },
    backers: { review: plan.backers.filter(answerable), other: plan.backers.filter((b) => !answerable(b)) },
    slate: plan.slate,
    balances: plan.balances,
    changes: groupBy(plan.changes, (c) => CAT_LABEL[c.cat] || CAT_LABEL[c.store] || 'Other'),
    deletions: groupBy(plan.deletions, (c) => CAT_LABEL[c.store] || 'Other'),
    opening: plan.opening,
    reconciliation: plan.reconciliation,
    errors: plan.errors,
    info: {
      inside: plan.inside || [], divergences: plan.divergences || [], consistency: plan.consistency || null,
      flags: plan.flags || { signs: [], otherExpenses: { count: 0, total: 0, items: [] }, onlineRoomsUnknown: [], rows: [] },
      settings: plan.settings || null,
    },
  };
}

/** A backer's answer: the select's options. A link already owned by a staking backer is that backer. */
export function backerOptions(b) {
  const opts = [{ value: 'new', label: 'New backer' }];
  for (const m of b.matches || []) opts.push({ value: String(m.backerId), label: `Same as ${m.name}` });
  if (b.default !== 'new' && b.default != null && !opts.some((o) => o.value === String(b.default))) opts.push({ value: String(b.default), label: 'Already yours (this link)' });
  return { options: opts, value: b.choice == null ? 'new' : String(b.choice), locked: b.default !== 'new' && b.default != null };
}
/** A slate backer's answer, worded: 'new', 'roster:<fp>', '<backer id>', 'key:<id>'. */
export function slateOptions(s, plan) {
  const nameOf = (fp) => { const b = (plan.backers || []).find((x) => x.fp === fp); return b && b.name ? b.name : 'the dashboard backer'; };
  const label = (v) => (v === 'new' ? 'New staking backer'
    : v.startsWith('roster:') ? `${nameOf(v.slice(7))} (from the dashboard)`
      : v.startsWith('key:') ? 'The one an earlier import made'
        : `Your staking backer ${s.name}`);
  const values = [...s.options];
  if (s.choice && !values.includes(s.choice)) values.push(s.choice);
  return { options: values.map((v) => ({ value: v, label: label(v) })), value: s.choice };
}
const OPTION_WORD = { apply: 'Apply', keep: 'Keep mine', remove: 'Remove', end: 'End it' };
export const optionWord = (o) => OPTION_WORD[o] || o;
/** What a change or a deletion names: { title, detail }. */
export function itemLine(c) {
  const to = c.to || null;
  if (c.store === 'backers') return { title: (to && to.name) || 'Backer', detail: to ? [to.stakes || 'no stakes', `opening ${fmtMoney((to.openingCents || 0) / 100, { sign: true })}`].join(' · ') : '' };
  if (to && (to.result != null || to.room)) return { title: [fmtDay(to.date), to.game || to.room].filter(Boolean).join(' · '), detail: `${to.room || ''}${to.room ? ' · ' : ''}${resultWords(to.result)}` };
  if (to && to.amount != null) return { title: [fmtDay(to.date), to.type || to.category || to.note].filter(Boolean).join(' · '), detail: fmtMoney(to.amount, { sign: true }) };
  if (c.was) return { title: [c.was.date ? fmtDay(c.was.date) : null, c.was.label].filter(Boolean).join(' · ') || `${c.store} ${c.id || ''}`.trim(), detail: c.was.amount == null ? '' : fmtMoney(c.was.amount, { sign: true }) };
  if (to && to.money_locations) return { title: to.money_locations.name, detail: fmtMoney(to.money_locations.amount) };
  if (to && to.value != null) return { title: 'Tax set-aside', detail: `${to.value}%` };
  return { title: `${c.store}${c.id ? ' ' + c.id : ''}`, detail: '' };
}

// ── readiness ───────────────────────────────────────────────────────────────────────────────

/**
 * Can the import be committed now? `plan` is the plan as shown (applyPatch over the server's),
 * `pending` whether answers are still waiting to be saved or on their way.
 * -> { ok, reasons: [sentence], undecided, rows, label, waiting }
 */
export function commitReadiness(plan, { pending = false } = {}) {
  if (!plan) return { ok: false, reasons: ['There is nothing to import yet.'], undecided: 0, rows: 0, label: 'Import', waiting: false };
  const reasons = [];
  const undecided = plan.pairs.filter((x) => !x.decision).length;
  if (undecided) reasons.push(`${plural(undecided, 'pair')} still to answer.`);
  for (const b of plan.blocking || []) reasons.push(b);
  const rec = plan.reconciliation || null;
  const u = rec && rec.unexplained ? rec.unexplained : { roll: 0, fund: 0 };
  if (Math.round((u.roll || 0) * 100) !== 0 || Math.round((u.fund || 0) * 100) !== 0) {
    reasons.push(`The reconciliation does not balance: ${fmtMoney(u.roll)} on the roll and ${fmtMoney(u.fund)} on the fund are unexplained.`);
  } else if (rec && rec.fundWithinRemainder === false) {
    reasons.push('The fund does not match the dashboard’s within its rounding remainder.');
  }
  const rows = plan.writes ? Number(plan.writes.rows) || 0 : 0;
  return { ok: reasons.length === 0 && !pending, reasons, undecided, rows, label: `Import ${plural(rows, 'record')}`, waiting: !!pending };
}
/** The reconciliation must balance: true when it does not (the blocking warning). */
export function reconciliationBlocks(rec) {
  if (!rec || !rec.unexplained) return false;
  return Math.round((rec.unexplained.roll || 0) * 100) !== 0 || Math.round((rec.unexplained.fund || 0) * 100) !== 0 || rec.fundWithinRemainder === false;
}
/** The reconciliation's lines, in the order the identity adds them (lib/money-import/reconcile.js). */
export const REC_LINES = [
  ['opening', 'The opening deposit'], ['onlyHere', 'Results only here'], ['pairs', 'Matched pairs'], ['editedHere', 'Edited here since'],
  ['rounding', 'Rounding'], ['skipped', 'Skipped records'], ['deletedThere', 'Deleted in the dashboard'],
];
export const REC_LISTS = [
  ['onlyHere', 'Results only here, after the opening date'], ['pairs', 'Pairs whose figures differ'], ['editedHere', 'Edited here since the import'],
  ['skipped', 'Skipped records'], ['deletedThere', 'Rows for records the dashboard has deleted'],
];

// ── what is written ─────────────────────────────────────────────────────────────────────────

const TABLES = [
  ['cash_sessions', 'cash session'], ['tournaments', 'Personal tournament'], ['tracking_entries', 'tournament result'],
  ['session_extras', 'result detail', 'result details'], ['bankroll_adjustments', 'adjustment'], ['bankroll_transactions', 'expense'],
  ['bankrolls', 'bankroll (the WSOP fund)', 'bankrolls'], ['backers', 'staking backer'], ['standing_agreements', 'standing agreement'],
  ['standing_stakes', 'stake'], ['staking_series', 'staking series', 'staking series'], ['backer_agreements', 'slate agreement'],
  ['backer_settlements', 'settlement'], ['money_locations', 'money location'], ['money_settings', 'money settings row'],
  ['backer_events', 'recorded share'], ['backer_event_revisions', 'share revision'], ['bankroll_import_keys', 'import key'],
];
const TABLE_INDEX = new Map(TABLES.map((t, i) => [t[0], i]));
export function tableLabel(table, n) {
  const t = TABLES.find((x) => x[0] === table);
  if (!t) return plural(n, table.replace(/_/g, ' '), table.replace(/_/g, ' '));
  return plural(n, t[1], t[2] || t[1] + 's');
}
/**
 * plan.writes.tables or summary.tables ({ insert, update, delete } of table: n) as lines, in a fixed
 * order: { insert: [{ table, n, text }], update: [...], delete: [...], created }.
 */
export function writesList(tables) {
  const t = tables || {};
  const lines = (m) => Object.entries(m || {}).filter(([, n]) => n > 0)
    .sort(([a], [b]) => (TABLE_INDEX.has(a) ? TABLE_INDEX.get(a) : 99) - (TABLE_INDEX.has(b) ? TABLE_INDEX.get(b) : 99) || a.localeCompare(b))
    .map(([table, n]) => ({ table, n, text: tableLabel(table, n) }));
  const insert = lines(t.insert), update = lines(t.update), del = lines(t.delete);
  return { insert, update, delete: del, created: insert.reduce((a, x) => a + x.n, 0) };
}

const ROW_PLACES = {
  cash_sessions: ['Cash session', 'Results › Cash', 'cash'],
  tracking_entries: ['Tournament result', 'Results › Tournaments', 'tournaments'],
  tournaments: ['Personal tournament', 'Results › Tournaments', null],
  session_extras: ['A result’s details', 'Results', null],
  bankroll_adjustments: ['Deposit, withdrawal or transfer', 'Bankroll › Manage bankrolls', null],
  bankroll_transactions: ['Expense', 'Results › Expenses & income', null],
  bankrolls: ['The WSOP fund bankroll', 'Bankroll › Manage bankrolls', null],
  backers: ['Staking backer', 'Staking', null],
  standing_agreements: ['Standing agreement', 'Staking', null],
  standing_stakes: ['Stake', 'Staking', null],
  staking_series: ['Staking series', 'Staking', null],
  backer_agreements: ['Slate agreement', 'Staking', null],
  backer_settlements: ['Settlement', 'Staking', null],
  money_locations: ['Money location', 'Bankroll', null],
  money_settings: ['Money settings', 'Bankroll', null],
  backer_events: ['Recorded share', 'Backers', null],
  bankroll_import_keys: ['Import key', 'the import’s own records', null],
};
/** An undo's 409 { edited: [{ table, id?, why }] } as rows the screen lists, each with where it lives
 *  and, for a cash session or a tournament result, the Results entry to open. */
export function editedRows(edited) {
  return (Array.isArray(edited) ? edited : []).map((e, i) => {
    const p = ROW_PLACES[e.table] || [String(e.table || 'Row').replace(/_/g, ' '), 'futurega.me', null];
    const id = e.id == null ? null : Number(e.id);
    return {
      key: `${e.table}:${e.id == null ? i : e.id}`, label: id == null ? p[0] : `${p[0]} #${id}`, where: p[1], why: e.why || 'edited since the import',
      open: p[2] && id != null ? { kind: p[2], id } : null,
    };
  });
}

// ── the server's refusals ───────────────────────────────────────────────────────────────────

const err = (body) => (body && typeof body.error === 'string' ? body.error : '');
/** POST /fetch refused -> one plain sentence. */
export function fetchError(status, body) {
  const e = err(body);
  if (status === 503) return e ? `${e} Nothing was fetched.` : 'The dashboard pull is off on this server. Nothing was fetched.';
  if (status === 502) return `The dashboard did not hand over a usable export${e ? ` (${e.replace(/\.$/, '')})` : ''}. Nothing was staged.`;
  if (status === 504) return `The dashboard did not answer in time${e ? ` (${e.replace(/\.$/, '')})` : ''}. Nothing was staged; try again in a minute.`;
  if (status === 409) return `${e || 'A pull is already running.'} Wait for it to finish, then look again.`;
  if (status === 403) return 'Only the account that owns the dashboard can import from it.';
  if (status === 0) return 'The server could not be reached. Nothing was fetched.';
  return e || 'Something went wrong. Nothing was written.';
}
/** POST /commit refused -> { kind: 'stale'|'undecided'|'blocking'|'gone'|'other', text }. */
export function commitError(status, body) {
  const b = body || {};
  if (status === 409 && b.stale) return { kind: 'stale', text: 'The plan changed; review the highlighted items.' };
  if (status === 409 && b.undecided) return { kind: 'undecided', text: `${plural(b.undecided, 'pair')} still to answer.` };
  if (status === 409 && b.blocking) return { kind: 'blocking', text: err(b) || 'Something in the plan blocks the import.' };
  if (status === 410) return { kind: 'gone', text: 'This review’s data has been cleared. Fetch again.' };
  if (status === 0) return { kind: 'other', text: 'The server could not be reached. Nothing was written.' };
  return { kind: 'other', text: err(b) || 'Something went wrong. Nothing was written.' };
}
/** POST /undo refused -> { kind: 'edited'|'expect'|'later'|'other', text, rows?, expect?, later? }. */
export function undoError(status, body) {
  const b = body || {};
  if (status === 409 && Array.isArray(b.edited)) {
    return {
      kind: 'edited', rows: editedRows(b.edited),
      text: `${plural(b.edited.length, 'row has', 'rows have')} been changed since the import, so it cannot be undone without losing that change. Delete or put back each one below, then undo again; or keep the import.`,
    };
  }
  if (status === 409 && b.expect != null) return { kind: 'expect', expect: Number(b.expect), text: `This import created ${plural(Number(b.expect), 'row')}; the count has changed since it was shown. Check the counts and type the new number.` };
  if (status === 409 && b.later != null) return { kind: 'later', later: Number(b.later), text: `Undo the later import (#${b.later}) first.` };
  if (status === 0) return { kind: 'other', text: 'The server could not be reached. Nothing was undone.' };
  return { kind: 'other', text: err(b) || 'Something went wrong. Nothing was undone.' };
}

// ── what changed between two plans (after a 409 stale) ──────────────────────────────────────

const J = (v) => JSON.stringify(v == null ? null : v);
/** The items of `next` that are new or read differently from `prev`: a Set of 'pair:<id>',
 *  'backer:<fp>', 'slate:<key>', 'deal:<fp>', 'balance:<fp>', 'change:<id>', 'deletion:<id>',
 *  'opening', 'reconciliation', 'errors', 'counts', 'writes'. */
export function diffPlans(prev, next) {
  const out = new Set();
  if (!prev || !next) return out;
  const each = (tag, a, b, idOf, pick) => {
    const old = new Map((a || []).map((x) => [idOf(x), J(pick(x))]));
    for (const x of b || []) if (old.get(idOf(x)) !== J(pick(x))) out.add(`${tag}:${idOf(x)}`);
  };
  each('pair', prev.pairs, next.pairs, (x) => x.id, (x) => ({ c: x.class, s: x.score, d: x.dash, h: x.here, t: x.canTake }));
  each('backer', prev.backers, next.backers, (x) => x.fp, (x) => ({ s: x.status, n: x.name, t: x.token, k: x.stakes, o: x.openingCents, d: x.delivery, m: x.matches, src: x.source, def: x.default }));
  each('slate', prev.slate && prev.slate.backers, next.slate && next.slate.backers, (x) => x.key, (x) => ({ o: x.options, d: x.default }));
  each('deal', prev.slate && prev.slate.deals, next.slate && next.slate.deals, (x) => x.fp, (x) => ({ ...x }));
  each('balance', prev.balances, next.balances, (x) => x.fp, (x) => ({ ...x }));
  each('change', prev.changes, next.changes, (x) => x.itemId, (x) => ({ t: x.to, c: x.conflict, a: x.applicable, o: x.options, d: x.default }));
  each('deletion', prev.deletions, next.deletions, (x) => x.itemId, (x) => ({ c: x.conflict, o: x.options, d: x.default, w: x.was }));
  const op = (o) => (o ? { c: o.computed, a: o.override ? null : o.amount, d: o.override ? null : o.date } : null);
  if (J(op(prev.opening)) !== J(op(next.opening))) out.add('opening');
  const rec = (r) => (r ? { d: r.dashboard, b: r.before, a: r.after, l: r.lines, u: r.unexplained, f: r.fundWithinRemainder } : null);
  if (J(rec(prev.reconciliation)) !== J(rec(next.reconciliation))) out.add('reconciliation');
  if (J(prev.errors) !== J(next.errors) || J(prev.blocking) !== J(next.blocking)) out.add('errors');
  if (J(prev.counts) !== J(next.counts)) out.add('counts');
  if (J(prev.writes) !== J(next.writes)) out.add('writes');
  return out;
}

// ── paging ──────────────────────────────────────────────────────────────────────────────────

/** The Locations tab's pager (ten, then fifty more a tap): { rows, more, fewer, count }. */
export const pageOf = (shown, total) => rowsPage(shown, total, { first: FIRST_ROWS, page: PAGE_ROWS });
