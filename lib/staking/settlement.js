'use strict';
/*
 * Series staking settlement — docs/bankroll-merge.md §10 (Phase 3 of the bankroll merge).
 *
 * One calculator for the settlement sheet. GET /settlement, POST /settlement/preview and
 * POST /settle all call computeSheet(); nothing the client sends is a figure, only the three
 * inputs a person has to supply (what a backer actually prepaid, a negotiated adjustment, and the
 * other player's result on a swap or crossbook).
 *
 * ── The sign, said once ──────────────────────────────────────────────────────────────────
 * Every amount is from the PLAYER's side, in the SERIES' currency:
 *     amountOwed > 0   the player pays the backer      (direction 'to_backer')
 *     amountOwed < 0   the backer pays the player      (direction 'to_player')
 * A ledger row is the mirror image: paying a backer takes money OUT of the bankroll (−), being
 * paid by one puts it IN (+).
 *
 * ── The owner's rule (§1.1 Q11, 2026-10-14): a backer pays for their piece UP FRONT ──────
 * For the action types (everything but profit share, swap and crossbook):
 *     price of a piece   = buy-in × bullets × currency_rate × pct × markup      (one event)
 *     investment         = Σ price over the events PLAYED                      (gross_investment)
 *     markupAmount       = Σ buy-in × bullets × rate × pct × (markup − 1)      (inside investment;
 *                                                                              the player keeps it)
 *     grossReturn        = Σ (cash − tip) × rate × pct  over the events played
 *     prepaid            = what the backer paid up front (default: the price of every piece sold,
 *                          played or not — the normal case)
 *     owed               = grossReturn − (investment − prepaid)
 * So a fully prepaid backer is owed exactly their share of the cashes; an event that was not
 * played (status 'cancelled') is in prepaid and not in investment, so its price comes back as a
 * refund; a backer who has not paid yet has the unpaid price netted off.
 *
 * Per type (the formulas, worked, are in docs/bankroll-merge.md §10):
 *   pay_per_play, open_commitment, tiered_markup  the formula above (tiered: markup by buy-in tier)
 *   flat_package    the formula above; rule flatPackageUnplayed 'keep' charges an unplayed event
 *   budget_capped   the backer's spend stops at the cap (events in date order, the crossing event
 *                   pro-rated — rule budgetCrossing); prepaid defaults to the CAP, so an unused
 *                   budget is refunded by the same formula
 *   makeup          the formula above, then a running balance carried between series:
 *                   total = owed + makeupOpening; computedOwed = max(0, total);
 *                   makeupClosing = min(0, total)    (negative = the backer's loss, carried)
 *   profit_share_only  no piece, nothing prepaid: owed = pct × max(0, Σ net) over the series
 *                   (rule profitShareBasis 'event' = Σ pct × max(0, net) per event, the old code)
 *   swap            no money up front: owed = myPct × myResult − theirPct × theirResult, a result
 *                   being cashes net of tips (rule swapBasis 'net' = cashes − tips − buy-ins)
 *   crossbook       a bet on who does better (rule crossbookMode 'bet'): D = myResult −
 *                   theirResult (net, rule crossbookBasis); if D < 0 the player pays myPct × |D|,
 *                   else the other player pays theirPct × D. crossbookMode 'swap' = a swap.
 * Then for every type: amountOwed = computedOwed + adjustment.
 *
 * Figures are rounded to the cent (half away from zero) at the agreement level, and owed is worked
 * from the rounded parts, so every line on the sheet adds up exactly. The ledger is whole units:
 * a paid settlement posts round(amountOwed) and its note keeps the exact figure.
 *
 * ── Settled series ───────────────────────────────────────────────────────────────────────
 * A settled series is NEVER recomputed: GET returns the stored rows (one per agreement), whose
 * `snapshot` holds the sheet entry exactly as it was settled. Recomputing settled series was the
 * root of the makeup double count, and an edit to an event after settlement must not move money
 * that has been paid.
 */

const TYPES = ['pay_per_play', 'open_commitment', 'budget_capped', 'flat_package', 'profit_share_only', 'makeup', 'tiered_markup', 'swap', 'crossbook'];
const ACTION_TYPES = new Set(['pay_per_play', 'open_commitment', 'budget_capped', 'flat_package', 'makeup', 'tiered_markup']);
const MUTUAL_TYPES = new Set(['swap', 'crossbook']);
// Logged but not finished: counted as played (as the old code did), and reported, because at
// settlement they are almost always an event someone forgot to update.
const UNFINISHED = new Set(['pending', 'bought_in', 'playing']);

const MIGRATION_NAME = 'staking-settlement-2026-10';
const MAX_ABS = 1e10;
const MAX_NOTE = 200;

// ── The rules where a type's meaning is a choice (docs/bankroll-merge.md §10, open questions).
// The defaults are the standard staking-market meanings; STAKING_SETTLEMENT_RULES (JSON) on the
// server overrides any of them. A settled series stores the rules it was settled under in each
// row's snapshot, so changing a rule never changes history.
const DEFAULT_RULES = Object.freeze({
  // What a backer is assumed to have paid up front, per type (the owner can change it per
  // agreement on the sheet): 'price' = the price of every piece sold, played or not; 'used' = only
  // the events played (no refunds); 'cap' = the budget cap; 'none' = nothing (a netted deal).
  prepaid: Object.freeze({
    pay_per_play: 'price', open_commitment: 'price', budget_capped: 'cap', flat_package: 'price',
    makeup: 'price', tiered_markup: 'price', profit_share_only: 'none',
  }),
  flatPackageUnplayed: 'refund', // 'refund' | 'keep': a package's unplayed event is refunded, or kept (charged, no return)
  budgetCrossing: 'prorate',     // 'prorate' | 'exclude': the event that crosses the cap is shared pro rata, or not at all
  profitShareBasis: 'series',    // 'series' | 'event': pct of the series' net profit, or of each winning event
  swapBasis: 'cash',             // 'cash' | 'net': a swap of winnings (cashes − tips), or of net results
  crossbookMode: 'bet',          // 'bet' | 'swap': a bet on who does better, or treated as a swap
  crossbookBasis: 'net',         // 'cash' | 'net': what "doing better" is measured on
});
const CHOICES = {
  prepaid: ['price', 'used', 'cap', 'none'],
  flatPackageUnplayed: ['refund', 'keep'],
  budgetCrossing: ['prorate', 'exclude'],
  profitShareBasis: ['series', 'event'],
  swapBasis: ['cash', 'net'],
  crossbookMode: ['bet', 'swap'],
  crossbookBasis: ['cash', 'net'],
};

/**
 * Merges an override (an object, or a JSON string such as STAKING_SETTLEMENT_RULES) over the
 * defaults. -> { rules, errors: [string], custom: bool }. An invalid key or value is dropped and
 * reported; the rest still applies.
 */
function resolveRules(override) {
  const errors = [];
  let o = override;
  if (typeof o === 'string') {
    if (!o.trim()) o = null;
    else { try { o = JSON.parse(o); } catch (e) { errors.push('not JSON: ' + e.message); o = null; } }
  }
  const rules = { ...DEFAULT_RULES, prepaid: { ...DEFAULT_RULES.prepaid } };
  let custom = false;
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'prepaid') {
        if (!v || typeof v !== 'object') { errors.push('prepaid must be an object'); continue; }
        for (const [t, mode] of Object.entries(v)) {
          if (!DEFAULT_RULES.prepaid[t]) errors.push(`prepaid.${t}: not a type with a prepayment`);
          else if (!CHOICES.prepaid.includes(mode)) errors.push(`prepaid.${t}: one of ${CHOICES.prepaid.join(', ')}`);
          else if (rules.prepaid[t] !== mode) { rules.prepaid[t] = mode; custom = true; }
        }
      } else if (!CHOICES[k]) errors.push(`${k}: unknown rule`);
      else if (!CHOICES[k].includes(v)) errors.push(`${k}: one of ${CHOICES[k].join(', ')}`);
      else if (rules[k] !== v) { rules[k] = v; custom = true; }
    }
  }
  return { rules, errors, custom };
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────
/** Round to the cent, half away from zero, never −0. (1e-6 of a cent absorbs 1.005*100 = 100.4999…) */
function r2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const c = Math.round(Math.abs(n) * 100 + 1e-6);
  return c === 0 ? 0 : (n < 0 ? -c : c) / 100;
}
/** Whole currency units for the ledger, half away from zero, never −0. */
function wholeUnits(v) {
  const n = Number(v) || 0;
  const u = Math.round(Math.abs(n) + 1e-9);
  return u === 0 ? 0 : (n < 0 ? -u : u);
}
const num = (v, d = 0) => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? d : n; };
const posNum = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

function rowsOf(db, sql, params = []) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
function one(db, sql, params = []) { const r = rowsOf(db, sql, params); return r.length ? r[0] : null; }
function hasColumn(db, table, column) {
  const r = db.exec(`PRAGMA table_info(${table})`);
  return !!(r.length && r[0].values.some((v) => v[1] === column));
}

/** Minutes after midnight from '7:00 PM', '19:00' or '11:00 AM'; unknown sorts last in its day. */
function minutesOf(time) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(String(time || ''));
  if (!m) return 24 * 60;
  let h = Number(m[1]) % (m[3] ? 12 : 24);
  if (m[3] && /p/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}
function byEventOrder(a, b) {
  const da = a.date || '9999-99-99', dbb = b.date || '9999-99-99';
  if (da !== dbb) return da < dbb ? -1 : 1;
  const ma = minutesOf(a.time), mb = minutesOf(b.time);
  if (ma !== mb) return ma - mb;
  return (Number(a.tournament_id) || 0) - (Number(b.tournament_id) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0);
}

function tierMarkup(ag, perBullet) {
  if (!ag.tiered_rules) return null;
  let tiers;
  try { tiers = JSON.parse(ag.tiered_rules); } catch (_) { return null; }
  if (!Array.isArray(tiers)) return null;
  const t = tiers.find((x) => x && perBullet >= Number(x.minBuyin) && perBullet <= Number(x.maxBuyin));
  return t && Number.isFinite(Number(t.markup)) ? Number(t.markup) : null;
}

// ── The calculator, one agreement ─────────────────────────────────────────────────────────
/**
 * One agreement's sheet entry. Pure: `ag` is a backer_agreements row (+ backer_name), `events`
 * its backer_event_status rows joined to the tournament (t_buyin, event_name, date, time),
 * `overrides` a Map tournament_id -> backer_event_overrides row, `input` { prepaid, adjustment,
 * adjustmentNote, partner } (each number or null), `rules` from resolveRules().
 */
function computeEntry(ag, events, overrides, input = {}, rules = DEFAULT_RULES) {
  const known = TYPES.includes(ag.backer_type);
  const type = known ? ag.backer_type : 'pay_per_play';
  const isAction = ACTION_TYPES.has(type);
  const isMutual = MUTUAL_TYPES.has(type);
  const ov = overrides || new Map();

  let investment = 0, markupAmount = 0, grossReturn = 0, unplayed = 0;
  let myCash = 0, myBuyin = 0;           // the player's own (100%) results, swap / crossbook / profit share
  let shareNet = 0, sharePos = 0;        // profit share, the two bases
  let unfinished = 0;
  const cap = type === 'budget_capped' && num(ag.budget_cap) > 0 ? num(ag.budget_cap) : null;
  let budgetLeft = cap;
  const detail = [];

  for (const ev of (events || []).slice().sort(byEventOrder)) {
    const o = ov.get(Number(ev.tournament_id));
    if (o && o.opt_out) continue; // the backer is out of this event: not part of the deal at all
    const rate = posNum(ev.currency_rate, 1);
    const bullets = ev.bullets_used == null ? 1 : Math.max(0, num(ev.bullets_used));
    const perBullet = num(ev.buyin_amount) || num(ev.t_buyin);
    const buyin = perBullet * bullets * rate;
    const cash = num(ev.cash_amount) * rate;
    const tip = num(ev.tip_amount) * rate;
    const played = ev.status !== 'cancelled';
    if (played && UNFINISHED.has(ev.status)) unfinished++;

    let pct, mk;
    if (type === 'swap') { pct = num(ag.swap_my_pct); mk = 1; }
    else if (type === 'crossbook') { pct = num(ag.crossbook_my_pct) || 50; mk = 1; }
    else {
      pct = o && o.override_percentage != null ? num(o.override_percentage) : num(ag.percentage);
      if (type === 'profit_share_only') mk = 1;
      else if (o && o.override_markup != null) mk = num(o.override_markup, 1);
      else if (type === 'tiered_markup') { const t = tierMarkup(ag, perBullet); mk = t != null ? t : num(ag.markup, 1); }
      else mk = num(ag.markup, 1);
    }
    const p = pct / 100;
    const d = {
      tournamentId: Number(ev.tournament_id), eventName: ev.event_name || null, date: ev.date || null,
      status: ev.status || 'pending', played, bullets, rate,
      buyin: r2(buyin), cash: r2(cash), tip: r2(tip), pct, markup: mk, price: 0, share: 0,
    };

    if (isAction) {
      let price = buyin * p * mk;
      let mkPart = buyin * p * (mk - 1);
      let ret = (cash - tip) * p;
      if (!played) {
        if (type === 'flat_package' && rules.flatPackageUnplayed === 'keep') {
          investment += price; markupAmount += mkPart; d.price = r2(price); d.kept = true;
        } else {
          unplayed += price; d.refundable = r2(price);
        }
        detail.push(d);
        continue;
      }
      if (budgetLeft != null) {
        let f = 1;
        if (budgetLeft <= 1e-9) f = 0;
        else if (price > budgetLeft + 1e-9) f = rules.budgetCrossing === 'prorate' && price > 0 ? budgetLeft / price : 0;
        price *= f; mkPart *= f; ret *= f;
        d.pct = pct * f;
        if (f < 1) d.capped = true;
        budgetLeft = Math.max(0, budgetLeft - price);
      }
      investment += price; markupAmount += mkPart; grossReturn += ret;
      d.price = r2(price); d.share = r2(ret);
    } else if (played) {
      myCash += cash - tip; myBuyin += buyin;
      if (type === 'profit_share_only') {
        const s = (cash - tip - buyin) * p;
        shareNet += s; sharePos += Math.max(0, s);
        d.share = r2(s);
      }
    }
    detail.push(d);
  }

  const e = {
    agreementId: Number(ag.id), backerId: Number(ag.backer_id), backerName: ag.backer_name || 'Backer',
    backerType: ag.backer_type, knownType: known, percentage: num(ag.percentage), markup: num(ag.markup, 1),
    isActive: !!ag.is_active,
    grossInvestment: 0, markupAmount: 0, grossReturn: 0, unplayed: 0,
    prepaidDefault: 0, prepaid: 0, refund: 0, unpaid: 0,
    budgetCap: cap, budgetLeft: null,
    myPct: null, theirPct: null, myResult: null, partnerResult: null, mineToThem: null, theirsToMe: null, difference: null,
    makeupOpening: null, makeupClosing: null,
    owed: 0, computedOwed: 0, adjustment: 0, adjustmentNote: null, amountOwed: 0, direction: 'none', netPnl: 0,
    unfinishedEvents: unfinished, needs: [], events: detail,
  };

  let owed;
  if (isMutual) {
    const myPct = type === 'swap' ? num(ag.swap_my_pct) : (num(ag.crossbook_my_pct) || 50);
    const theirPct = type === 'swap' ? num(ag.swap_their_pct) : (num(ag.crossbook_their_pct) || 50);
    const basis = type === 'swap' ? rules.swapBasis : rules.crossbookBasis;
    const mine = r2(basis === 'net' ? myCash - myBuyin : myCash);
    const partner = input.partner == null ? null : r2(input.partner);
    if (partner == null) e.needs.push('partnerResult');
    const theirs = partner == null ? 0 : partner;
    e.myPct = myPct; e.theirPct = theirPct; e.myResult = mine; e.partnerResult = partner; e.resultBasis = basis;
    if (type === 'crossbook' && rules.crossbookMode === 'bet') {
      const D = r2(mine - theirs);
      e.difference = D;
      owed = D < 0 ? r2(-D * myPct / 100) : r2(-D * theirPct / 100);
      e.mode = 'bet';
    } else {
      e.mineToThem = r2(mine * myPct / 100);
      e.theirsToMe = r2(theirs * theirPct / 100);
      owed = r2(e.mineToThem - e.theirsToMe);
      e.mode = 'swap';
      e.grossReturn = e.mineToThem;
    }
    e.netPnl = owed;
  } else {
    e.grossInvestment = r2(investment);
    e.markupAmount = r2(markupAmount);
    e.grossReturn = type === 'profit_share_only'
      ? r2(rules.profitShareBasis === 'event' ? sharePos : Math.max(0, shareNet))
      : r2(grossReturn);
    if (type === 'profit_share_only') e.profitShareBasis = rules.profitShareBasis;
    e.unplayed = r2(unplayed);
    if (cap != null) e.budgetLeft = r2(Math.max(0, cap - e.grossInvestment));
    const mode = rules.prepaid[type] || 'price';
    e.prepaidRule = mode;
    e.prepaidDefault = mode === 'none' ? 0
      : mode === 'used' ? e.grossInvestment
        : mode === 'cap' && cap != null ? r2(cap)
          : r2(e.grossInvestment + e.unplayed);
    e.prepaid = input.prepaid == null ? e.prepaidDefault : r2(input.prepaid);
    e.refund = r2(Math.max(0, e.prepaid - e.grossInvestment));
    e.unpaid = r2(Math.max(0, e.grossInvestment - e.prepaid));
    owed = r2(e.grossReturn - (e.grossInvestment - e.prepaid));
    e.netPnl = r2(e.grossReturn - e.grossInvestment);
  }
  e.owed = owed;

  if (type === 'makeup') {
    const opening = r2(num(ag.makeup_opening));
    const total = r2(owed + opening);
    e.makeupOpening = opening;
    e.computedOwed = Math.max(0, total);
    e.makeupClosing = Math.min(0, total);
  } else {
    e.computedOwed = owed;
  }
  e.adjustment = input.adjustment == null ? 0 : r2(input.adjustment);
  e.adjustmentNote = input.adjustmentNote || null;
  e.amountOwed = r2(e.computedOwed + e.adjustment);
  e.direction = e.amountOwed > 0 ? 'to_backer' : e.amountOwed < 0 ? 'to_player' : 'none';
  return e;
}

// ── Loading a series ──────────────────────────────────────────────────────────────────────
function loadSeries(db, seriesId, userId) {
  return one(db, 'SELECT * FROM staking_series WHERE id = ? AND user_id = ?', [seriesId, userId]);
}

function seriesBankroll(db, series) {
  const id = series.bankroll_id == null ? null : Number(series.bankroll_id);
  if (id == null) return { id: null, name: 'Main', currency: 'USD', missing: false };
  const b = one(db, 'SELECT id, name, currency, archived FROM bankrolls WHERE id = ? AND user_id = ?', [id, series.user_id]);
  if (!b) return { id, name: null, currency: null, missing: true };
  return { id: Number(b.id), name: b.name, currency: b.currency || 'USD', archived: !!b.archived, missing: false };
}

/** The agreements a sheet covers: every active one, and an inactive one only if it has events. */
function loadInputsForCompute(db, seriesId) {
  const agreements = rowsOf(db, `SELECT ba.*, b.name AS backer_name
    FROM backer_agreements ba LEFT JOIN backers b ON b.id = ba.backer_id
    WHERE ba.series_id = ? ORDER BY ba.created_at, ba.id`, [seriesId]);
  const events = rowsOf(db, `SELECT bes.*, t.buyin AS t_buyin, t.event_name, t.date, t.time
    FROM backer_event_status bes
    JOIN backer_agreements ba ON ba.id = bes.agreement_id
    LEFT JOIN tournaments t ON t.id = bes.tournament_id
    WHERE ba.series_id = ?`, [seriesId]);
  const overrides = rowsOf(db, `SELECT beo.* FROM backer_event_overrides beo
    JOIN backer_agreements ba ON ba.id = beo.agreement_id WHERE ba.series_id = ?`, [seriesId]);
  const evBy = new Map();
  for (const ev of events) {
    const k = Number(ev.agreement_id);
    if (!evBy.has(k)) evBy.set(k, []);
    evBy.get(k).push(ev);
  }
  const ovBy = new Map();
  for (const o of overrides) {
    const k = Number(o.agreement_id);
    if (!ovBy.has(k)) ovBy.set(k, new Map());
    ovBy.get(k).set(Number(o.tournament_id), o);
  }
  const covered = agreements.filter((ag) => ag.is_active || (evBy.get(Number(ag.id)) || []).length > 0);
  return { agreements: covered, evBy, ovBy };
}

function totalsOf(entries) {
  let toBackers = 0, toPlayer = 0;
  for (const e of entries) {
    if (e.amountOwed > 0) toBackers += e.amountOwed;
    else toPlayer += -e.amountOwed;
  }
  return { toBackers: r2(toBackers), toPlayer: r2(toPlayer), net: r2(toBackers - toPlayer) };
}

/** The computed (unsettled) entries. inputs: Map agreementId -> { prepaid, adjustment, adjustmentNote, partner }. */
function computeEntries(db, seriesId, inputs, rules) {
  const { agreements, evBy, ovBy } = loadInputsForCompute(db, seriesId);
  return agreements.map((ag) => computeEntry(ag, evBy.get(Number(ag.id)) || [], ovBy.get(Number(ag.id)), (inputs && inputs.get(Number(ag.id))) || {}, rules));
}

// ── Stored (settled) rows ─────────────────────────────────────────────────────────────────
const STORED_COLS = ['id', 'series_id', 'backer_id', 'agreement_id', 'gross_investment', 'gross_return', 'markup_amount', 'net_pnl',
  'amount_owed', 'computed_owed', 'adjustment', 'adjustment_note', 'prepaid', 'makeup_opening', 'makeup_closing',
  'settled_at', 'is_paid', 'paid_at', 'notes', 'snapshot'];

function ledgerFor(db, userId, settlementId) {
  if (!hasColumn(db, 'bankroll_adjustments', 'settlement_ref')) return null;
  const a = one(db, 'SELECT id, bankroll_id, amount, occurred_on, note FROM bankroll_adjustments WHERE user_id = ? AND settlement_ref = ?', [userId, 'bs:' + settlementId]);
  return a ? { adjustmentId: Number(a.id), bankrollId: a.bankroll_id == null ? null : Number(a.bankroll_id), amount: Number(a.amount), date: a.occurred_on, note: a.note } : null;
}

/** One stored row as a sheet entry: the snapshot as settled, the money from the columns. */
function storedEntry(db, row, userId) {
  let snap = null;
  if (row.snapshot) { try { snap = JSON.parse(row.snapshot); } catch (_) { snap = null; } }
  const ag = row.agreement_id != null ? one(db, 'SELECT backer_type, percentage, markup FROM backer_agreements WHERE id = ?', [row.agreement_id]) : null;
  const backer = one(db, 'SELECT name FROM backers WHERE id = ?', [row.backer_id]);
  const base = snap || {
    // A row settled before Phase 3: figures as the old code stored them (client-supplied, the
    // markup sign as it was), no breakdown. Shown, never recomputed.
    backerType: ag ? ag.backer_type : null, percentage: ag ? num(ag.percentage) : null, markup: ag ? num(ag.markup, 1) : null,
    legacy: true, events: [], needs: [],
  };
  const amountOwed = r2(row.amount_owed);
  const adjustment = r2(row.adjustment);
  const e = {
    ...base,
    id: Number(row.id),
    agreementId: row.agreement_id == null ? null : Number(row.agreement_id),
    backerId: Number(row.backer_id),
    backerName: backer ? backer.name : (base.backerName || 'Backer'),
    grossInvestment: r2(row.gross_investment),
    grossReturn: r2(row.gross_return),
    markupAmount: r2(row.markup_amount),
    netPnl: r2(row.net_pnl),
    prepaid: r2(row.prepaid),
    computedOwed: row.computed_owed == null ? r2(amountOwed - adjustment) : r2(row.computed_owed),
    adjustment,
    adjustmentNote: row.adjustment_note || null,
    makeupOpening: row.makeup_opening == null ? (base.makeupOpening == null ? null : base.makeupOpening) : r2(row.makeup_opening),
    makeupClosing: row.makeup_closing == null ? (base.makeupClosing == null ? null : base.makeupClosing) : r2(row.makeup_closing),
    amountOwed,
    direction: amountOwed > 0 ? 'to_backer' : amountOwed < 0 ? 'to_player' : 'none',
    isPaid: !!row.is_paid,
    paidAt: row.paid_at || null,
    settledAt: row.settled_at || null,
    notes: row.notes || null,
    ledger: ledgerFor(db, userId, row.id),
  };
  return e;
}

function storedEntries(db, seriesId, userId) {
  const cols = STORED_COLS.filter((c) => hasColumn(db, 'backer_settlements', c));
  const rows = rowsOf(db, `SELECT ${cols.join(', ')} FROM backer_settlements WHERE series_id = ? ORDER BY id`, [seriesId]);
  return rows.map((r) => storedEntry(db, r, userId));
}

/**
 * The sheet. For a settled series, the stored rows; otherwise computed with `inputs`.
 * -> null when the series is not the user's.
 */
function computeSheet(db, seriesId, userId, { inputs = null, rules = DEFAULT_RULES } = {}) {
  const series = loadSeries(db, seriesId, userId);
  if (!series) return null;
  const isSettled = series.status === 'settled';
  const settlements = isSettled ? storedEntries(db, series.id, userId) : computeEntries(db, series.id, inputs, rules);
  if (!isSettled) for (const e of settlements) { e.id = null; e.isPaid = false; e.paidAt = null; e.settledAt = null; e.ledger = null; }
  return {
    series,
    currency: series.currency || 'USD',
    status: series.status,
    isSettled,
    bankroll: seriesBankroll(db, series),
    rules: isSettled ? null : rules,
    settlements,
    totals: totalsOf(settlements),
  };
}

// ── Inputs (the settle / preview body) ──────────────────────────────────────────────────────
/**
 * body = { prepaid?: [{ agreementId, amount }], adjustments?: [{ agreementId, amount, note }],
 *          partner?: [{ agreementId, amount }] }  — the only things a person supplies.
 * Anything else in the body (the old client's `settlements` array of figures) is ignored.
 * -> { inputs: Map, error? }
 */
function parseInputs(body, entriesMeta) {
  const b = body && typeof body === 'object' ? body : {};
  const byId = new Map(entriesMeta.map((m) => [m.agreementId, m]));
  const inputs = new Map();
  const get = (id) => { if (!inputs.has(id)) inputs.set(id, {}); return inputs.get(id); };
  const readAmount = (raw) => {
    if (raw === null || raw === undefined || raw === '') return { value: null };
    const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
    if (!Number.isFinite(n)) return { error: 'must be a number' };
    if (Math.abs(n) > MAX_ABS) return { error: 'is too large' };
    return { value: n };
  };
  for (const [key, field] of [['prepaid', 'prepaid'], ['adjustments', 'adjustment'], ['partner', 'partner']]) {
    const list = b[key];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) return { error: `${key} must be a list of { agreementId, amount }` };
    const seen = new Set();
    for (const item of list) {
      const id = Number(item && item.agreementId);
      const m = byId.get(id);
      if (!Number.isInteger(id) || !m) return { error: `${key}: agreement ${item && item.agreementId} is not on this sheet` };
      if (seen.has(id)) return { error: `${key}: agreement ${id} is listed twice` };
      seen.add(id);
      const a = readAmount(item.amount);
      if (a.error) return { error: `${key}: the amount for agreement ${id} ${a.error}` };
      if (a.value == null) continue;
      if (field === 'prepaid') {
        if (m.mutual) return { error: `prepaid: agreement ${id} is a ${m.type}, which has no up-front payment` };
        if (a.value < 0) return { error: `prepaid: the amount for agreement ${id} cannot be negative` };
      }
      if (field === 'partner') {
        if (!m.mutual) return { error: `partner: agreement ${id} is not a swap or crossbook` };
        if (m.basis === 'cash' && a.value < 0) return { error: `partner: their cashes for agreement ${id} cannot be negative` };
      }
      get(id)[field] = a.value;
      if (field === 'adjustment') {
        const note = item.note == null ? null : String(item.note).trim().slice(0, MAX_NOTE);
        get(id).adjustmentNote = note || null;
      }
    }
  }
  return { inputs };
}

/** What parseInputs needs to know about each agreement on an unsettled sheet. */
function entriesMeta(db, seriesId, rules) {
  const { agreements } = loadInputsForCompute(db, seriesId);
  return agreements.map((ag) => ({
    agreementId: Number(ag.id),
    type: ag.backer_type,
    mutual: MUTUAL_TYPES.has(ag.backer_type),
    basis: ag.backer_type === 'swap' ? rules.swapBasis : ag.backer_type === 'crossbook' ? rules.crossbookBasis : null,
  }));
}

// ── Settle ───────────────────────────────────────────────────────────────────────────────
class SettleError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}

/**
 * Recomputes the sheet with the inputs and stores one row per agreement, then marks the series
 * settled. Throws SettleError(404|409|400). Returns the stored sheet (computeSheet of the settled
 * series). Does NOT write backer_agreements (§10 item 6).
 */
function settleSeries(db, seriesId, userId, body, rules = DEFAULT_RULES) {
  const series = loadSeries(db, seriesId, userId);
  if (!series) throw new SettleError(404, 'Series not found');
  if (series.status === 'settled') throw new SettleError(409, 'This series is already settled');
  const meta = entriesMeta(db, series.id, rules);
  const parsed = parseInputs(body, meta);
  if (parsed.error) throw new SettleError(400, parsed.error);
  const entries = computeEntries(db, series.id, parsed.inputs, rules);
  if (!entries.length) throw new SettleError(400, 'There are no agreements to settle');
  const missing = entries.filter((e) => e.needs.includes('partnerResult'));
  if (missing.length) {
    throw new SettleError(400, `Enter the other player's result for ${missing.map((e) => e.backerName).join(', ')} (0 if they had none)`, { needs: missing.map((e) => e.agreementId) });
  }
  // A series reopened after an old settle can still hold rows; a paid one is real money.
  const old = rowsOf(db, 'SELECT id, is_paid FROM backer_settlements WHERE series_id = ?', [series.id]);
  if (old.some((r) => r.is_paid)) throw new SettleError(409, 'This series has payments marked from an earlier settlement. Mark them unpaid first.');

  const at = new Date().toISOString();
  db.run('SAVEPOINT staking_settle');
  try {
    db.run('DELETE FROM backer_settlements WHERE series_id = ?', [series.id]);
    for (const e of entries) {
      const snapshot = { ...e, rules, settledAt: at };
      delete snapshot.id; delete snapshot.isPaid; delete snapshot.paidAt; delete snapshot.ledger;
      db.run(`INSERT INTO backer_settlements (series_id, backer_id, agreement_id, gross_investment, gross_return, markup_amount, net_pnl,
          amount_owed, computed_owed, adjustment, adjustment_note, prepaid, makeup_opening, makeup_closing, settled_at, snapshot, is_paid, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      [series.id, e.backerId, e.agreementId, e.grossInvestment, e.grossReturn, e.markupAmount, e.netPnl,
        e.amountOwed, e.computedOwed, e.adjustment, e.adjustmentNote, e.prepaid, e.makeupOpening, e.makeupClosing, at, JSON.stringify(snapshot)]);
    }
    db.run("UPDATE staking_series SET status = 'settled' WHERE id = ?", [series.id]);
    db.run('RELEASE staking_settle');
  } catch (err) {
    try { db.run('ROLLBACK TO staking_settle'); db.run('RELEASE staking_settle'); } catch (_) { /* nothing open */ }
    throw err;
  }
  return computeSheet(db, series.id, userId, { rules });
}

/**
 * Reopening a settled series (PUT /series/:id with another status): refused while any of its
 * settlements is marked paid, otherwise its stored rows are removed (they stop being the truth;
 * the next settle writes fresh ones). -> { ok } | { status, error }
 */
function reopenSeries(db, seriesId) {
  const rows = rowsOf(db, 'SELECT id, is_paid FROM backer_settlements WHERE series_id = ?', [seriesId]);
  if (rows.some((r) => r.is_paid)) return { status: 409, error: 'Mark this series’ payments unpaid before reopening it' };
  db.run('DELETE FROM backer_settlements WHERE series_id = ?', [seriesId]);
  return { ok: true, removed: rows.length };
}

/** A new makeup agreement's suggested opening: the backer's most recent settled closing (or 0). */
function lastMakeupClosing(db, userId, backerId) {
  if (!hasColumn(db, 'backer_settlements', 'makeup_closing')) return 0;
  const r = one(db, `SELECT bs.makeup_closing AS c FROM backer_settlements bs
      JOIN staking_series ss ON ss.id = bs.series_id
      WHERE ss.user_id = ? AND bs.backer_id = ? AND bs.makeup_closing IS NOT NULL AND ss.status = 'settled'
      ORDER BY COALESCE(bs.settled_at, '') DESC, bs.id DESC LIMIT 1`, [userId, backerId]);
  return r ? r2(r.c) : 0;
}

// ── Paid → the ledger (bankrolls.md seam 2) ───────────────────────────────────────────────
/**
 * Marks a settlement paid or unpaid. Paid writes ONE `settlement` adjustment into the series'
 * bankroll (staking_series.bankroll_id, NULL = Main), settlement_ref 'bs:<id>': −amountOwed when
 * the player pays, +|amountOwed| when the backer does, in whole units. Unpaid deletes it. A
 * request that does not change the state writes nothing (idempotent).
 *
 * opts = { isPaid, amount?, date? }. `amount` (a positive number, in the BANKROLL's currency) is
 * required when the bankroll's currency is not the series' and refused when it is.
 * -> { status, body }
 */
function setPaid(db, userId, settlementId, opts = {}) {
  const row = one(db, `SELECT bs.*, ss.name AS series_name, ss.currency AS series_currency, ss.bankroll_id AS series_bankroll_id, ss.user_id AS owner_id
      FROM backer_settlements bs JOIN staking_series ss ON ss.id = bs.series_id
      WHERE bs.id = ? AND ss.user_id = ?`, [settlementId, userId]);
  if (!row) return { status: 404, body: { error: 'Settlement not found' } };
  const wantPaid = opts.isPaid !== false;
  const ref = 'bs:' + row.id;
  const ledgerOn = hasColumn(db, 'bankroll_adjustments', 'settlement_ref');
  const done = () => ({ status: 200, body: { settlement: storedEntry(db, one(db, `SELECT ${STORED_COLS.filter((c) => hasColumn(db, 'backer_settlements', c)).join(', ')} FROM backer_settlements WHERE id = ?`, [row.id]), userId) } });

  if (!wantPaid) {
    db.run('SAVEPOINT staking_paid');
    try {
      if (ledgerOn) db.run('DELETE FROM bankroll_adjustments WHERE user_id = ? AND settlement_ref = ?', [userId, ref]);
      db.run('UPDATE backer_settlements SET is_paid = 0, paid_at = NULL WHERE id = ?', [row.id]);
      db.run('RELEASE staking_paid');
    } catch (e) { try { db.run('ROLLBACK TO staking_paid'); db.run('RELEASE staking_paid'); } catch (_) { /* */ } throw e; }
    return done();
  }
  if (row.is_paid) return done(); // already paid: nothing to write

  const series = { bankroll_id: row.series_bankroll_id, user_id: row.owner_id };
  const target = seriesBankroll(db, series);
  if (target.missing) return { status: 409, body: { error: 'This series is filed under a bankroll that no longer exists. Pick another bankroll for the series first.' } };
  const owed = r2(row.amount_owed);
  const backer = one(db, 'SELECT name FROM backers WHERE id = ?', [row.backer_id]);
  const who = backer ? backer.name : 'backer';
  const seriesCur = row.series_currency || 'USD';
  let amount;
  if (target.currency === seriesCur) {
    if (opts.amount !== undefined && opts.amount !== null && opts.amount !== '') {
      return { status: 400, body: { error: `amount is only for a bankroll in another currency; this one is ${target.currency}, like the series` } };
    }
    amount = -wholeUnits(owed);
  } else {
    const n = Number(opts.amount);
    if (opts.amount === undefined || opts.amount === null || opts.amount === '' || !Number.isFinite(n) || n < 0 || n > MAX_ABS) {
      return { status: 409, body: { error: `This series is in ${seriesCur} and its bankroll (${target.name}) is in ${target.currency}. Give the amount that moved, in ${target.currency}.`, needsAmount: true, currency: target.currency, seriesCurrency: seriesCur } };
    }
    amount = owed > 0 ? -wholeUnits(n) : owed < 0 ? wholeUnits(n) : 0;
  }
  const date = opts.date == null || opts.date === '' ? new Date().toISOString().slice(0, 10) : String(opts.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) return { status: 400, body: { error: 'date must be YYYY-MM-DD' } };
  const exact = Math.abs(owed).toFixed(2);
  const roundedNote = target.currency === seriesCur && wholeUnits(owed) !== owed ? ` (exact ${seriesCur} ${exact})` : '';
  const crossNote = target.currency !== seriesCur ? ` (${seriesCur} ${exact})` : '';
  const verb = owed > 0 ? 'paid to' : 'received from';
  const note = `${row.series_name}: ${verb} ${who}${roundedNote}${crossNote}`.slice(0, MAX_NOTE);

  db.run('SAVEPOINT staking_paid');
  try {
    if (ledgerOn && amount !== 0 && !one(db, 'SELECT id FROM bankroll_adjustments WHERE user_id = ? AND settlement_ref = ?', [userId, ref])) {
      db.run(`INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, transfer_id, occurred_on, note, created_at, settlement_ref)
        VALUES (?, ?, 'settlement', ?, NULL, ?, ?, ?, ?)`, [userId, target.id, amount, date, note, new Date().toISOString(), ref]);
    }
    db.run('UPDATE backer_settlements SET is_paid = 1, paid_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
    db.run('RELEASE staking_paid');
  } catch (e) { try { db.run('ROLLBACK TO staking_paid'); db.run('RELEASE staking_paid'); } catch (_) { /* */ } throw e; }
  return done();
}

// ── Migration 'staking-settlement-2026-10' ───────────────────────────────────────────────
/**
 * Additive; one savepoint, all or nothing; idempotent.
 *  1. backer_settlements.snapshot (the entry as settled).
 *  2. agreement_id on rows settled by the old code, where exactly one agreement of that backer is
 *     in that series (the old upsert keyed on (series, backer), so two agreements were one row:
 *     those stay NULL and are counted).
 *  3. Makeup, §10 item 6: an unsettled series' makeup agreement gets makeup_opening =
 *     makeup_balance. A settled one's row gets makeup_closing = makeup_balance and
 *     makeup_opening = makeup_balance − raw (raw = that series' recomputed result, no makeup), and
 *     the agreement the same opening. makeup_balance is left in place, unread.
 *  4. Unique indexes: one settlement row per agreement; one ledger row per settlement.
 * -> counts for the log.
 */
function migrate(db) {
  const out = { snapshotColumn: false, legacyRows: 0, agreementLinked: 0, agreementAmbiguous: 0, makeupUnsettled: 0, makeupSettled: 0 };
  db.run('SAVEPOINT staking_settlement_mig');
  try {
    if (!hasColumn(db, 'backer_settlements', 'snapshot')) {
      db.run('ALTER TABLE backer_settlements ADD COLUMN snapshot TEXT');
      out.snapshotColumn = true;
    }
    for (const c of ['agreement_id', 'makeup_opening', 'makeup_closing']) {
      if (!hasColumn(db, 'backer_settlements', c)) throw new Error(`backer_settlements.${c} is missing (money-merge-2026-10 has not run)`);
    }
    if (!hasColumn(db, 'backer_agreements', 'makeup_opening')) throw new Error('backer_agreements.makeup_opening is missing (money-merge-2026-10 has not run)');

    const legacy = rowsOf(db, 'SELECT id, series_id, backer_id FROM backer_settlements WHERE agreement_id IS NULL AND snapshot IS NULL');
    out.legacyRows = legacy.length;
    const used = new Set(rowsOf(db, 'SELECT agreement_id FROM backer_settlements WHERE agreement_id IS NOT NULL').map((r) => Number(r.agreement_id)));
    for (const r of legacy) {
      const cands = rowsOf(db, 'SELECT id FROM backer_agreements WHERE series_id = ? AND backer_id = ?', [r.series_id, r.backer_id]);
      if (cands.length === 1 && !used.has(Number(cands[0].id))) {
        db.run('UPDATE backer_settlements SET agreement_id = ? WHERE id = ?', [cands[0].id, r.id]);
        used.add(Number(cands[0].id));
        out.agreementLinked++;
      } else out.agreementAmbiguous++;
    }

    db.run(`UPDATE backer_agreements SET makeup_opening = COALESCE(makeup_balance, 0)
      WHERE backer_type = 'makeup' AND makeup_opening IS NULL
        AND series_id IN (SELECT id FROM staking_series WHERE status != 'settled')`);
    out.makeupUnsettled = db.getRowsModified();

    const settledMakeup = rowsOf(db, `SELECT ba.*, b.name AS backer_name FROM backer_agreements ba
      JOIN staking_series ss ON ss.id = ba.series_id LEFT JOIN backers b ON b.id = ba.backer_id
      WHERE ba.backer_type = 'makeup' AND ss.status = 'settled' AND ba.makeup_opening IS NULL`);
    for (const ag of settledMakeup) {
      const { evBy, ovBy } = loadInputsForCompute(db, ag.series_id);
      // raw exactly as the old GET computed it: return − investment, netted, no makeup.
      const e = computeEntry({ ...ag, makeup_opening: 0 }, evBy.get(Number(ag.id)) || [], ovBy.get(Number(ag.id)), { prepaid: 0 }, DEFAULT_RULES);
      const balance = r2(ag.makeup_balance);
      const opening = r2(balance - e.netPnl);
      db.run('UPDATE backer_agreements SET makeup_opening = ? WHERE id = ?', [opening, ag.id]);
      db.run('UPDATE backer_settlements SET makeup_closing = ?, makeup_opening = ? WHERE agreement_id = ? AND makeup_closing IS NULL', [balance, opening, ag.id]);
      out.makeupSettled++;
    }

    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_backer_settlements_agreement ON backer_settlements(agreement_id) WHERE agreement_id IS NOT NULL');
    if (hasColumn(db, 'bankroll_adjustments', 'settlement_ref')) {
      db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_bankroll_adj_settlement_ref ON bankroll_adjustments(user_id, settlement_ref) WHERE settlement_ref IS NOT NULL');
    }
    db.run('RELEASE staking_settlement_mig');
  } catch (e) {
    try { db.run('ROLLBACK TO staking_settlement_mig'); db.run('RELEASE staking_settlement_mig'); } catch (_) { /* nothing open */ }
    throw e;
  }
  return out;
}

module.exports = {
  TYPES, ACTION_TYPES, MUTUAL_TYPES, DEFAULT_RULES, CHOICES, MIGRATION_NAME,
  resolveRules, r2, wholeUnits, minutesOf, computeEntry, computeEntries, computeSheet, parseInputs, entriesMeta,
  settleSeries, reopenSeries, lastMakeupClosing, setPaid, migrate, storedEntries, SettleError,
  // exposed for tests
  _internal: { byEventOrder, tierMarkup },
};
