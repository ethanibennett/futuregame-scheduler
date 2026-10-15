'use strict';
/*
 * The commit (docs/bankroll-merge.md §9.4): the owner's answers applied to a plan, every write
 * through the journal (journal.js) so the run can be undone exactly. The caller holds ONE savepoint
 * around it: all of it lands, or none of it.
 *
 * Order (§9.4, with one change): the fund; the backers, their standing agreements and stakes; the
 * results; the confirmed duplicates (same-keep / same-take); the slate; the adjustments, transfers,
 * settlements and the opening; the expenses; the balance locations and settings; the changes and
 * deletions a delta brings; the backer_events links; the rounding corrections; the keys alongside
 * each record. The slate comes BEFORE the adjustments (the spec lists it after) so a settled deal's
 * settlement row exists when its `settlement` adjustment is written, and the adjustment carries its
 * settlement_ref from the start.
 *
 * Nothing here posts a share or calls syncSharesFor (§6.5: the import never does), and nothing writes
 * console_records, backer_public or a backer_events figure: a backer's page cannot change.
 */
const M = require('./map');
const R = require('./reconcile');
const { Journal, selectRow } = require('./journal');
const P = require('./plan');

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const roundAway = (v) => Math.sign(v) * Math.round(Math.abs(v));
function rowsOf(db, sql, params = []) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}
const oneOf = (db, sql, params) => rowsOf(db, sql, params)[0] || null;

/** The owner's answer for each kind of item, defaults filled in. assumeUndecided: what an unanswered pair is taken as. */
function choicesFor(internal, decisions, { assumeUndecided = 'same-keep' } = {}) {
  const d = decisions || internal.decisions;
  return {
    pair: (id) => {
      const p = internal.pairById.get(id);
      const a = d.pairs[id];
      if (p && P.PAIR_ANSWERS.includes(a) && !(a === 'same-take' && !p.canTake)) return a;
      return assumeUndecided;
    },
    change: (it) => (it.change.options.includes(d.changes[it.fp]) ? d.changes[it.fp] : it.change.default),
    deletion: (it) => (it.deletion.options.includes(d.deletions[it.fp]) ? d.deletions[it.fp] : it.deletion.default),
  };
}

/** The dashboard state as this commit leaves it: which records are imported, same, kept or not linked. */
function nextState(internal, choices) {
  const st = JSON.parse(JSON.stringify(internal.state));
  const imported = (rec, m) => { rec.link = 'imported'; rec.rRoll = m.rounded.roll; rec.rFund = m.rounded.fund; };
  const plain = (rec, link) => { rec.link = link; delete rec.rRoll; delete rec.rFund; };
  for (const it of internal.items) {
    if (it.store !== 'sessions' && it.store !== 'adjustments' && it.store !== 'expenses') continue;
    const rec = st.records[it.fp];
    if (!rec) continue;
    if (it.status === 'new' || it.status === 'reimport') {
      if (it.pairId) { if (choices.pair(it.pairId) === 'different') imported(rec, it.mapped); else plain(rec, 'same'); } else imported(rec, it.mapped);
    } else if (it.status === 'changed') {
      if (choices.change(it) === 'apply') imported(rec, it.mapped); else plain(rec, 'kept');
    } else if (it.status === 'unchanged') {
      if (rec.link === 'kept') continue;
      if (it.key && it.key.decision === 'same') plain(rec, 'same'); else imported(rec, it.mapped);
    } else plain(rec, null);
  }
  return st;
}

// ── the writers ──────────────────────────────────────────────────────────────────────────

function makeCtx(db, uid, internal, { decisions, choices, now, runId }) {
  const J = new Journal(db);
  const nowIso = now.toISOString();
  const ctx = {
    db, uid, J, internal, decisions: decisions || internal.decisions, choices, runId: runId == null ? null : runId,
    nowIso, nowMs: now.getTime(), today: M.etDay(now.getTime()), targetId: internal.target.id,
    fundId: internal.fund.bankrollId, fundCreated: false, backerIds: new Map(), settlementRef: new Map(), linkable: new Map(),
    summary: { cash: 0, tournaments: 0, adjustments: 0, transfers: 0, settlements: 0, expenses: 0, backers: 0, agreements: 0, stakes: 0, series: 0, deals: 0,
      slateSettlements: 0, locations: 0, same: 0, taken: [], changed: 0, kept: 0, removed: 0, ended: 0, linkedEvents: 0, opening: null, corrections: [], fundCreated: false },
  };
  ctx.fund = () => {
    if (ctx.fundId != null) return ctx.fundId;
    const f = internal.fund;
    const mx = oneOf(db, 'SELECT COALESCE(MAX(sort_order), -1) AS mx FROM bankrolls WHERE user_id = ?', [uid]).mx;
    ctx.fundId = J.insert('bankrolls', { user_id: uid, name: f.name, starting_balance: 0, currency: 'USD', archived: 0, sort_order: mx + 1, created_at: nowIso,
      role: 'fund', in_roll: 0, target_amount: f.target, target_date: f.targetDate }, 'dash:fund');
    ctx.fundCreated = true; ctx.summary.fundCreated = true;
    return ctx.fundId;
  };
  ctx.bankrollFor = (sym) => (sym === 'fund' ? ctx.fund() : ctx.targetId);
  return ctx;
}

function writeKey(ctx, fp, table, id, item, decision) {
  const { J, uid } = ctx;
  const pk = { user_id: uid, fingerprint: fp };
  if (selectRow(ctx.db, 'bankroll_import_keys', pk)) J.delete('bankroll_import_keys', pk, fp); // a stale key
  J.insert('bankroll_import_keys', { user_id: uid, fingerprint: fp, ref_table: table, ref_id: id, created_at: ctx.nowIso, run_id: ctx.runId, decision,
    source_updated_at: item && item.updatedAt != null ? item.updatedAt : null, source_hash: item ? item.hash : null }, fp);
}
function touchKey(ctx, fp, item, hash) {
  ctx.J.update('bankroll_import_keys', { user_id: ctx.uid, fingerprint: fp }, { source_hash: hash || item.hash, source_updated_at: item && item.updatedAt != null ? item.updatedAt : null }, fp);
}
function dropKey(ctx, fp) { ctx.J.delete('bankroll_import_keys', { user_id: ctx.uid, fingerprint: fp }, fp); }

function upsertExtras(ctx, table, id, extras, fp, { onlyIfMissing = false } = {}) {
  const pk = { ref_table: table, ref_id: id };
  const have = selectRow(ctx.db, 'session_extras', pk);
  if (have) { if (!onlyIfMissing) ctx.J.update('session_extras', pk, { ...extras, updated_at: ctx.nowIso }, fp); return; }
  ctx.J.insert('session_extras', { user_id: ctx.uid, ref_table: table, ref_id: id, ...extras, updated_at: ctx.nowIso }, fp);
}
function unlinkEvents(ctx, table, id, fp) {
  for (const e of rowsOf(ctx.db, 'SELECT id FROM backer_events WHERE ref_table = ? AND ref_id = ?', [table, id])) ctx.J.update('backer_events', { id: e.id }, { ref_table: null, ref_id: null }, fp);
}

// results
function insertResult(ctx, it) {
  const { J, uid, db } = ctx;
  const m = it.mapped;
  const bid = ctx.bankrollFor(m.bankroll);
  if (m.kind === 'cash') {
    const id = J.insert('cash_sessions', { user_id: uid, bankroll_id: bid, ...m.rows.cash_sessions, created_at: ctx.nowIso }, it.fp);
    upsertExtras(ctx, 'cash_sessions', id, m.rows.session_extras, it.fp);
    ctx.summary.cash++;
    return { table: 'cash_sessions', id };
  }
  const t = m.rows.tournaments;
  const existing = oneOf(db, 'SELECT id, venue, uploaded_by FROM tournaments WHERE stable_id = ?', [t.stable_id]);
  let tid;
  if (existing) { // the Personal event of a result deleted here since an earlier import (deleting a result leaves its event)
    if (existing.venue !== 'Personal' || Number(existing.uploaded_by) !== uid) throw new Error('a tournament with this import id is not the owner\'s Personal event');
    const { stable_id, ...rest } = t;
    J.update('tournaments', { id: existing.id }, rest, it.fp);
    tid = existing.id;
  } else tid = J.insert('tournaments', { ...t }, it.fp);
  const eid = J.insert('tracking_entries', { user_id: uid, tournament_id: tid, bankroll_id: bid, ...m.rows.tracking_entries }, it.fp);
  upsertExtras(ctx, 'tracking_entries', eid, m.rows.session_extras, it.fp);
  ctx.summary.tournaments++;
  return { table: 'tracking_entries', id: eid };
}
function updateResult(ctx, it) {
  const { J, uid, db } = ctx;
  const m = it.mapped, key = it.key;
  const bid = ctx.bankrollFor(m.bankroll);
  if (m.kind === 'cash') {
    J.update('cash_sessions', { id: key.ref_id }, { bankroll_id: bid, ...m.rows.cash_sessions, updated_at: ctx.nowIso }, it.fp);
    upsertExtras(ctx, 'cash_sessions', key.ref_id, m.rows.session_extras, it.fp);
  } else {
    const e = oneOf(db, 'SELECT tournament_id FROM tracking_entries WHERE id = ? AND user_id = ?', [key.ref_id, uid]);
    J.update('tracking_entries', { id: key.ref_id }, { bankroll_id: bid, ...m.rows.tracking_entries }, it.fp);
    const t = oneOf(db, 'SELECT venue, uploaded_by FROM tournaments WHERE id = ?', [e.tournament_id]);
    if (t && t.venue === 'Personal' && Number(t.uploaded_by) === uid) { const { stable_id, uploaded_by, ...rest } = m.rows.tournaments; J.update('tournaments', { id: e.tournament_id }, rest, it.fp); }
    upsertExtras(ctx, 'tracking_entries', key.ref_id, m.rows.session_extras, it.fp);
  }
  touchKey(ctx, it.fp, it);
}
function removeResult(ctx, it) {
  const { J, uid, db } = ctx;
  const key = it.key;
  unlinkEvents(ctx, key.ref_table, key.ref_id, it.fp);
  J.delete('session_extras', { ref_table: key.ref_table, ref_id: key.ref_id }, it.fp);
  if (key.ref_table === 'cash_sessions') J.delete('cash_sessions', { id: key.ref_id }, it.fp);
  else {
    const e = oneOf(db, 'SELECT tournament_id FROM tracking_entries WHERE id = ? AND user_id = ?', [key.ref_id, uid]);
    J.delete('tracking_entries', { id: key.ref_id }, it.fp);
    const t = e && oneOf(db, 'SELECT id, venue, uploaded_by FROM tournaments WHERE id = ?', [e.tournament_id]);
    if (t && t.venue === 'Personal' && Number(t.uploaded_by) === uid && !oneOf(db, 'SELECT id FROM tracking_entries WHERE tournament_id = ?', [t.id])) J.delete('tournaments', { id: t.id }, it.fp);
  }
  dropKey(ctx, it.fp);
}

// adjustments
function insertAdjustment(ctx, it) {
  const { J, uid } = ctx;
  let primary = null;
  const ref = ctx.settlementRef.get(it.fp) || null;
  for (const leg of it.mapped.legs) {
    const id = J.insert('bankroll_adjustments', { user_id: uid, bankroll_id: ctx.bankrollFor(leg.bankroll), kind: leg.kind, amount: leg.amount, transfer_id: leg.transfer_id,
      occurred_on: leg.occurred_on, note: leg.note, created_at: ctx.nowIso, settlement_ref: leg.primary ? ref : null }, it.fp);
    if (leg.primary) primary = id;
  }
  if (it.mapped.kind === 'transfer') ctx.summary.transfers++; else if (it.mapped.kind === 'settlement') ctx.summary.settlements++; else ctx.summary.adjustments++;
  return { table: 'bankroll_adjustments', id: primary };
}
function adjustmentLegs(ctx, key) {
  return P.recordRows(ctx.db, ctx.uid, key).map(([, pk]) => selectRow(ctx.db, 'bankroll_adjustments', pk)).filter(Boolean);
}
function updateAdjustment(ctx, it) {
  const legs = adjustmentLegs(ctx, it.key);
  const want = it.mapped.legs;
  const prim = legs.find((l) => l.id === it.key.ref_id);
  const other = legs.filter((l) => l.id !== it.key.ref_id);
  const pairs = [[prim, want.find((w) => w.primary)], [other[0], want.find((w) => !w.primary)]];
  for (const [row, leg] of pairs) {
    if (!row || !leg) continue;
    ctx.J.update('bankroll_adjustments', { id: row.id }, { bankroll_id: ctx.bankrollFor(leg.bankroll), kind: leg.kind, amount: leg.amount, occurred_on: leg.occurred_on, note: leg.note }, it.fp);
  }
  touchKey(ctx, it.fp, it);
}
function removeAdjustment(ctx, it) {
  for (const l of adjustmentLegs(ctx, it.key)) ctx.J.delete('bankroll_adjustments', { id: l.id }, it.fp);
  dropKey(ctx, it.fp);
}

// expenses
function insertExpense(ctx, it) {
  const id = ctx.J.insert('bankroll_transactions', { user_id: ctx.uid, bankroll_id: ctx.targetId, ...it.mapped.rows.bankroll_transactions, tournament_id: null, series: null, trip_id: null, created_at: ctx.nowIso }, it.fp);
  ctx.summary.expenses++;
  return { table: 'bankroll_transactions', id };
}
function updateExpense(ctx, it) {
  const tx = it.mapped.rows.bankroll_transactions;
  ctx.J.update('bankroll_transactions', { id: it.key.ref_id }, { occurred_on: tx.occurred_on, category: tx.category, amount: tx.amount, note: tx.note, updated_at: ctx.nowIso }, it.fp);
  touchKey(ctx, it.fp, it);
}
function removeExpense(ctx, it) { ctx.J.delete('bankroll_transactions', { id: it.key.ref_id }, it.fp); dropKey(ctx, it.fp); }

// a confirmed duplicate (§9.4 steps 4 and 5)
function writeSame(ctx, it, pair, take) {
  const { J, db, uid } = ctx;
  const h = pair.here;
  writeKey(ctx, it.fp, h.table, h.id, it, 'same');
  ctx.summary.same++;
  if (it.store === 'sessions') upsertExtras(ctx, h.table, h.id, it.mapped.rows.session_extras, it.fp, { onlyIfMissing: true });
  if (!take) return;
  const before = { ...pair.here };
  if (h.table === 'cash_sessions') {
    J.update('cash_sessions', { id: h.id }, { buy_in: it.mapped.rows.cash_sessions.buy_in, cash_out: it.mapped.rows.cash_sessions.cash_out, updated_at: ctx.nowIso }, it.fp);
  } else if (h.table === 'tracking_entries') {
    const te = it.mapped.rows.tracking_entries;
    J.update('tracking_entries', { id: h.id }, { num_entries: te.num_entries, cash_amount: te.cash_amount, cashed: te.cashed }, it.fp);
    const e = oneOf(db, 'SELECT tournament_id FROM tracking_entries WHERE id = ? AND user_id = ?', [h.id, uid]);
    const t = e && oneOf(db, 'SELECT id, venue, uploaded_by, buyin FROM tournaments WHERE id = ?', [e.tournament_id]);
    const buyin = it.mapped.rows.tournaments.buyin;
    if (t && Number(t.buyin) !== buyin) {
      if (!(t.venue === 'Personal' && Number(t.uploaded_by) === uid)) throw new Error('a schedule event\'s buy-in cannot take the dashboard\'s figure');
      J.update('tournaments', { id: t.id }, { buyin }, it.fp);
    }
  } else if (h.table === 'bankroll_adjustments') {
    J.update('bankroll_adjustments', { id: h.id }, { amount: it.mapped.legs[0].amount }, it.fp);
  } else if (h.table === 'bankroll_transactions') {
    J.update('bankroll_transactions', { id: h.id }, { amount: it.mapped.rows.bankroll_transactions.amount, updated_at: ctx.nowIso }, it.fp);
  }
  ctx.summary.taken.push({ pairId: pair.id, table: h.table, id: h.id, from: before.result != null ? before.result : before.amount, to: pair.dash.result != null ? pair.dash.result : pair.dash.amount });
}

// backers (§7)
function writeBacker(ctx, b) {
  const { J, uid, db } = ctx;
  const m = b.mapped;
  const s = m.secret;
  let bid;
  if (b.choice === 'new' || b.choice == null) {
    bid = J.insert('backers', { user_id: uid, name: m.name || 'Backer', email: s.email, phone: s.phone, notes: 'Imported from the dashboard',
      public_token: s.token, notify_sms: s.phone ? 1 : 0, notify_email: s.email ? 1 : 0 }, b.fp);
    writeKey(ctx, b.fp, 'backers', bid, b, 'imported');
    ctx.summary.backers++;
  } else {
    bid = Number(b.choice);
    const ex = oneOf(db, 'SELECT * FROM backers WHERE id = ? AND user_id = ?', [bid, uid]);
    if (!ex) throw new Error('the staking backer chosen for a dashboard backer is gone');
    if (ex.public_token && ex.public_token !== s.token) throw new Error('the staking backer chosen already has another link');
    // Delivery is opt-in (§4.2): the dashboard's address or number is what the backer opted in with.
    // An existing staking backer keeps the address on file; the flag is set only when that address IS
    // the dashboard's (or there was none and the dashboard's is written), so nobody is emailed or
    // texted at an address they never gave for this.
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    const set = {};
    if (!ex.public_token) set.public_token = s.token;
    if (!ex.email && s.email) set.email = s.email;
    if (!ex.phone && s.phone) set.phone = s.phone;
    set.notify_email = s.email && (!ex.email || same(ex.email, s.email)) ? 1 : 0;
    set.notify_sms = s.phone && (!ex.phone || same(ex.phone, s.phone)) ? 1 : 0;
    J.update('backers', { id: bid }, set, b.fp);
    writeKey(ctx, b.fp, 'backers', bid, b, 'same');
  }
  ctx.backerIds.set(b.fp, bid);
  const active = b.kindNo === 1; // §7.1: kinds 2 and 3 import as ENDED agreements (§17 Q9)
  const from = ctx.today;
  const aid = J.insert('standing_agreements', { user_id: uid, backer_id: bid, effective_from: from, effective_to: active ? null : from, status: active ? 'active' : 'ended',
    opening_cents: m.openingCents, opening_note: 'Imported from the dashboard', created_at: ctx.nowIso, updated_at: ctx.nowIso }, b.fp);
  writeKey(ctx, b.standingFp, 'standing_agreements', aid, b, 'imported');
  ctx.summary.agreements++;
  for (const st of m.stakes) {
    J.insert('standing_stakes', { agreement_id: aid, format: st.format, channel: st.channel, pct: st.pct, valid_from: from, valid_to: active ? null : from, created_at: ctx.nowIso }, b.fp);
    ctx.summary.stakes++;
  }
}
function agreementOf(ctx, b) {
  const k = oneOf(ctx.db, 'SELECT ref_id FROM bankroll_import_keys WHERE user_id = ? AND fingerprint = ?', [ctx.uid, b.standingFp]);
  return k ? oneOf(ctx.db, 'SELECT * FROM standing_agreements WHERE id = ? AND user_id = ?', [k.ref_id, ctx.uid]) : null;
}
function updateBacker(ctx, b) {
  const { J, db } = ctx;
  const m = b.mapped, s = m.secret;
  J.update('backers', { id: b.key.ref_id }, { name: m.name || 'Backer', email: s.email, phone: s.phone, notify_sms: s.phone ? 1 : 0, notify_email: s.email ? 1 : 0 }, b.fp);
  const ag = agreementOf(ctx, b);
  if (ag) {
    J.update('standing_agreements', { id: ag.id }, { opening_cents: m.openingCents, updated_at: ctx.nowIso }, b.fp);
    for (const st of rowsOf(db, 'SELECT id FROM standing_stakes WHERE agreement_id = ?', [ag.id])) J.delete('standing_stakes', { id: st.id }, b.fp);
    for (const st of m.stakes) J.insert('standing_stakes', { agreement_id: ag.id, format: st.format, channel: st.channel, pct: st.pct, valid_from: ag.effective_from, valid_to: ag.effective_to, created_at: ctx.nowIso }, b.fp);
  }
  touchKey(ctx, b.fp, b);
}
function endBacker(ctx, b) {
  const ag = agreementOf(ctx, b);
  if (ag && ag.status === 'active') {
    ctx.J.update('standing_agreements', { id: ag.id }, { status: 'ended', effective_to: ctx.today, updated_at: ctx.nowIso }, b.fp);
    for (const st of rowsOf(ctx.db, 'SELECT id FROM standing_stakes WHERE agreement_id = ? AND valid_to IS NULL', [ag.id])) ctx.J.update('standing_stakes', { id: st.id }, { valid_to: ctx.today }, b.fp);
  }
  touchKey(ctx, b.fp, b, 'deleted');
  ctx.summary.ended++;
}

// the slate (§5.6)
function slateBackerId(ctx, name) {
  const k = (name || 'Unnamed slate backer').toLowerCase();
  const sb = ctx.internal.slateNames.get(k);
  const choice = sb ? (ctx.decisions.slate[k] != null && sb.options.includes(String(ctx.decisions.slate[k])) ? String(ctx.decisions.slate[k]) : sb.choice) : 'new';
  const fp = P.slateBackerFp(name || 'Unnamed slate backer');
  if (choice.startsWith('key:')) return Number(choice.slice(4));
  if (choice.startsWith('roster:')) {
    const rfp = choice.slice(7);
    let id = ctx.backerIds.get(rfp);
    if (id == null) { const k2 = oneOf(ctx.db, 'SELECT ref_id FROM bankroll_import_keys WHERE user_id = ? AND fingerprint = ?', [ctx.uid, rfp]); id = k2 ? k2.ref_id : null; }
    if (id == null) throw new Error('the roster backer chosen for a slate backer was not imported');
    writeKey(ctx, fp, 'backers', id, null, 'same');
    return id;
  }
  if (choice !== 'new') { const id = Number(choice); writeKey(ctx, fp, 'backers', id, null, 'same'); return id; }
  const id = ctx.J.insert('backers', { user_id: ctx.uid, name: name || 'Unnamed slate backer', notes: 'Slate backer imported from the dashboard' }, fp);
  writeKey(ctx, fp, 'backers', id, null, 'imported');
  ctx.summary.backers++;
  return id;
}
function seriesIdFor(ctx, event) {
  const fp = P.seriesFp(event);
  const k = oneOf(ctx.db, 'SELECT ref_id FROM bankroll_import_keys WHERE user_id = ? AND fingerprint = ?', [ctx.uid, fp]);
  if (k && oneOf(ctx.db, 'SELECT id FROM staking_series WHERE id = ? AND user_id = ?', [k.ref_id, ctx.uid])) return k.ref_id;
  const all = ctx.internal.slateAll.filter((d) => d.event.toLowerCase() === event.toLowerCase());
  const settled = all.length > 0 && all.every((d) => d.settled);
  const id = ctx.J.insert('staking_series', { user_id: ctx.uid, name: event, currency: 'USD', status: settled ? 'settled' : 'active' }, fp);
  writeKey(ctx, fp, 'staking_series', id, null, 'imported');
  ctx.summary.series++;
  return id;
}
function settlementRow(ctx, { seriesId, backerId, agreementId, deal, link }) {
  const share = Math.abs(link.amount);
  const face = r2(deal.buyIn * deal.pctSold / 100);
  const pays = r2(face * deal.markup);
  const id = ctx.J.insert('backer_settlements', {
    series_id: seriesId, backer_id: backerId, agreement_id: agreementId, gross_investment: face, gross_return: share, markup_amount: r2(pays - face),
    net_pnl: r2(share - pays), amount_owed: share, computed_owed: share, adjustment: 0, prepaid: pays, settled_at: link.date, is_paid: 1, paid_at: link.date,
    notes: 'Imported from the dashboard slate', snapshot: JSON.stringify({ imported: true, backerType: 'pay_per_play', percentage: deal.pctSold, markup: deal.markup, buyIn: deal.buyIn, events: [], needs: [] }),
  }, 'dash:wsop-staking:' + deal.id);
  ctx.summary.slateSettlements++;
  return id;
}
function linkSettlement(ctx, deal, link, ids) {
  const bs = settlementRow(ctx, { ...ids, deal, link });
  if (link.prior) ctx.J.update('bankroll_adjustments', { id: link.adjId }, { settlement_ref: 'bs:' + bs }, link.fp);
  else ctx.settlementRef.set(link.fp, 'bs:' + bs);
}
function insertDeal(ctx, it) {
  const d = it.mapped;
  const seriesId = seriesIdFor(ctx, d.event);
  const backerId = slateBackerId(ctx, d.backer);
  const agId = ctx.J.insert('backer_agreements', { series_id: seriesId, backer_id: backerId, backer_type: 'pay_per_play', percentage: d.pctSold, markup: d.markup, is_active: 1,
    notes: `Slate buy-in $${d.buyIn} (imported)` }, it.fp);
  writeKey(ctx, it.fp, 'backer_agreements', agId, it, 'imported');
  ctx.summary.deals++;
  if (d.settled && it.settlement) linkSettlement(ctx, d, it.settlement, { seriesId, backerId, agreementId: agId });
}
function updateDeal(ctx, it) {
  const d = it.mapped;
  const ag = oneOf(ctx.db, 'SELECT id, series_id, backer_id FROM backer_agreements WHERE id = ?', [it.key.ref_id]);
  ctx.J.update('backer_agreements', { id: ag.id }, { percentage: d.pctSold, markup: d.markup, notes: `Slate buy-in $${d.buyIn} (imported)` }, it.fp);
  if (d.settled && it.settlement && !oneOf(ctx.db, 'SELECT id FROM backer_settlements WHERE agreement_id = ?', [ag.id])) {
    linkSettlement(ctx, d, it.settlement, { seriesId: ag.series_id, backerId: ag.backer_id, agreementId: ag.id });
    const all = ctx.internal.slateAll.filter((x) => x.event.toLowerCase() === d.event.toLowerCase());
    if (all.length && all.every((x) => x.settled)) ctx.J.update('staking_series', { id: ag.series_id }, { status: 'settled' }, it.fp);
  }
  touchKey(ctx, it.fp, it);
}
function removeDeal(ctx, it) {
  const ag = it.key.ref_id;
  for (const s of rowsOf(ctx.db, 'SELECT id FROM backer_settlements WHERE agreement_id = ?', [ag])) {
    for (const a of rowsOf(ctx.db, 'SELECT id FROM bankroll_adjustments WHERE user_id = ? AND settlement_ref = ?', [ctx.uid, 'bs:' + s.id])) ctx.J.update('bankroll_adjustments', { id: a.id }, { settlement_ref: null }, it.fp);
    ctx.J.delete('backer_settlements', { id: s.id }, it.fp);
  }
  ctx.J.delete('backer_agreements', { id: ag }, it.fp);
  dropKey(ctx, it.fp);
}

// balance locations, settings
function insertLocation(ctx, it) {
  const id = ctx.J.insert('money_locations', { user_id: ctx.uid, ...it.mapped.rows.money_locations, updated_at: ctx.nowIso }, it.fp);
  writeKey(ctx, it.fp, 'money_locations', id, it, 'imported');
  ctx.summary.locations++;
}
function writeSettings(ctx, { taxRate }) {
  const { db, uid, J } = ctx;
  const row = oneOf(db, 'SELECT data FROM money_settings WHERE user_id = ?', [uid]);
  let data = {};
  if (row) { try { data = JSON.parse(row.data) || {}; } catch (_) { data = {}; } }
  const next = { ...data };
  if (!next.posting) next.posting = 'off';
  if (next.cutover !== 'live') next.cutover = 'imported'; // §9.4: posting stays off
  if (taxRate != null) next.taxSetAsidePct = taxRate;
  if (JSON.stringify(next) === JSON.stringify(data)) return;
  if (row) J.update('money_settings', { user_id: uid }, { data: JSON.stringify(next), updated_at: ctx.nowIso }, 'dash:settings');
  else J.insert('money_settings', { user_id: uid, data: JSON.stringify(next), updated_at: ctx.nowIso }, 'dash:settings');
}

/**
 * Apply. opts = { decisions, choices, now, runId, rates, sources }. Runs inside the caller's
 * savepoint. -> { ops, summary, state (the dashboard state this run leaves), reconciliation }
 */
function apply(db, uid, internal, opts = {}) {
  const now = opts.now || new Date();
  const choices = opts.choices || choicesFor(internal, opts.decisions);
  const ctx = makeCtx(db, uid, internal, { decisions: opts.decisions, choices, now, runId: opts.runId });
  const { J } = ctx;
  const items = internal.items;
  const by = (pred) => items.filter(pred);
  const writes = (it) => it.status === 'new' || it.status === 'reimport';
  const pairAnswer = (it) => (it.pairId ? choices.pair(it.pairId) : null);

  // backers
  for (const b of internal.backerItems) {
    if (b.status === 'error') continue;
    if (writes(b)) writeBacker(ctx, b);
    else if (b.status === 'changed') { if (choices.change(b) === 'apply') { updateBacker(ctx, b); ctx.summary.changed++; } else { touchKey(ctx, b.fp, b); ctx.summary.kept++; } }
    else if (b.status === 'deleted') { if (choices.deletion(b) === 'end') endBacker(ctx, b); else touchKey(ctx, b.fp, b, 'deleted'); }
  }

  // results, and the confirmed duplicates
  for (const it of by((i) => i.store === 'sessions')) {
    if (writes(it)) {
      const a = pairAnswer(it);
      if (a === 'same-keep' || a === 'same-take') { writeSame(ctx, it, internal.pairById.get(it.pairId), a === 'same-take'); ctx.linkable.set(it.id, internal.pairById.get(it.pairId).here); continue; }
      const ref = insertResult(ctx, it);
      writeKey(ctx, it.fp, ref.table, ref.id, it, 'imported');
      ctx.linkable.set(it.id, ref);
    } else if (it.status === 'changed') {
      if (choices.change(it) === 'apply') { updateResult(ctx, it); ctx.summary.changed++; } else { touchKey(ctx, it.fp, it); ctx.summary.kept++; }
    } else if (it.status === 'deleted') {
      if (choices.deletion(it) === 'remove') { removeResult(ctx, it); ctx.summary.removed++; } else touchKey(ctx, it.fp, it, 'deleted');
    }
  }

  // the slate (before the adjustments: a settlement row's id goes on its adjustment)
  for (const it of internal.dealItems) {
    if (writes(it)) insertDeal(ctx, it);
    else if (it.status === 'changed') { if (choices.change(it) === 'apply') { updateDeal(ctx, it); ctx.summary.changed++; } else { touchKey(ctx, it.fp, it); ctx.summary.kept++; } }
    else if (it.status === 'deleted') { if (choices.deletion(it) === 'remove') { removeDeal(ctx, it); ctx.summary.removed++; } else touchKey(ctx, it.fp, it, 'deleted'); }
  }

  // adjustments, transfers, settlements
  for (const it of by((i) => i.store === 'adjustments')) {
    if (writes(it)) {
      const a = pairAnswer(it);
      if (a === 'same-keep' || a === 'same-take') { writeSame(ctx, it, internal.pairById.get(it.pairId), a === 'same-take'); continue; }
      const ref = insertAdjustment(ctx, it);
      writeKey(ctx, it.fp, ref.table, ref.id, it, 'imported');
    } else if (it.status === 'changed') {
      if (choices.change(it) === 'apply') { updateAdjustment(ctx, it); ctx.summary.changed++; } else { touchKey(ctx, it.fp, it); ctx.summary.kept++; }
    } else if (it.status === 'deleted') {
      if (choices.deletion(it) === 'remove') { removeAdjustment(ctx, it); ctx.summary.removed++; } else touchKey(ctx, it.fp, it, 'deleted');
    }
  }

  // the opening deposit (§5.8)
  const op = internal.opening;
  if (op && op.amount !== 0) {
    const days = op.date;
    const id = J.insert('bankroll_adjustments', { user_id: uid, bankroll_id: ctx.targetId, kind: op.amount > 0 ? 'deposit' : 'withdrawal', amount: op.amount, transfer_id: null,
      occurred_on: days, note: `Opening balance from the dashboard: its starting roll of $${op.computed.startingRoll} less $${op.computed.priorBalance} already here before ${op.computed.date}${op.override ? ' (set by hand in the review)' : ''}`.slice(0, M.MAX_ADJ_NOTE),
      created_at: ctx.nowIso, settlement_ref: null }, 'dash:opening');
    writeKey(ctx, 'dash:opening', 'bankroll_adjustments', id, { hash: op.settingsHash, updatedAt: null }, 'imported');
    ctx.summary.opening = { amount: op.amount, date: days };
  }

  // expenses
  for (const it of by((i) => i.store === 'expenses')) {
    if (writes(it)) {
      const a = pairAnswer(it);
      if (a === 'same-keep' || a === 'same-take') { writeSame(ctx, it, internal.pairById.get(it.pairId), a === 'same-take'); continue; }
      const ref = insertExpense(ctx, it);
      writeKey(ctx, it.fp, ref.table, ref.id, it, 'imported');
    } else if (it.status === 'changed') {
      if (choices.change(it) === 'apply') { updateExpense(ctx, it); ctx.summary.changed++; } else { touchKey(ctx, it.fp, it); ctx.summary.kept++; }
    } else if (it.status === 'deleted') {
      if (choices.deletion(it) === 'remove') { removeExpense(ctx, it); ctx.summary.removed++; } else touchKey(ctx, it.fp, it, 'deleted');
    }
  }

  // balance locations and settings
  for (const it of by((i) => i.cat === 'location')) {
    if (writes(it)) insertLocation(ctx, it);
    else if (it.status === 'changed') {
      if (choices.change(it) === 'apply') { ctx.J.update('money_locations', { id: it.key.ref_id }, { ...it.mapped.rows.money_locations, updated_at: ctx.nowIso }, it.fp); touchKey(ctx, it.fp, it); ctx.summary.changed++; }
      else { touchKey(ctx, it.fp, it); ctx.summary.kept++; }
    } else if (it.status === 'deleted') {
      if (choices.deletion(it) === 'remove') { ctx.J.delete('money_locations', { id: it.key.ref_id }, it.fp); dropKey(ctx, it.fp); ctx.summary.removed++; } else touchKey(ctx, it.fp, it, 'deleted');
    }
  }
  const tr = internal.taxRate;
  let taxValue = null;
  if (tr && (tr.status === 'new' || (tr.status === 'changed' && choices.change(items.find((i) => i.fp === tr.fp)) === 'apply'))) taxValue = tr.value;
  writeSettings(ctx, { taxRate: taxValue });
  if (tr && tr.status !== 'unchanged') {
    if (tr.status === 'new') writeKey(ctx, tr.fp, 'money_settings', uid, tr, 'imported'); else touchKey(ctx, tr.fp, tr);
  }

  // backer_events: link the dashboard's recorded shares to the results they were about (§6.8)
  if (ctx.linkable.size) {
    for (const e of rowsOf(db, "SELECT id, token, session_id, session_result_cents, pct, share_cents FROM backer_events WHERE ref_table IS NULL AND COALESCE(source, 'dashboard') = 'dashboard'")) {
      const ref = ctx.linkable.get(e.session_id);
      if (!ref) continue;
      J.update('backer_events', { id: e.id }, { ref_table: ref.table, ref_id: ref.id }, 'dash:link');
      J.insert('backer_event_revisions', { event_id: e.id, token: e.token, at: ctx.nowMs, action: 'link', share_before: e.share_cents, share_after: e.share_cents,
        result_before: e.session_result_cents, result_after: e.session_result_cents, pct_before: e.pct, pct_after: e.pct, cause: 'import', note: 'linked to the imported result' }, 'dash:link');
      ctx.summary.linkedEvents++;
    }
  }

  // the rounding corrections (§5.7): what is left of Σ(exact − written), per pocket
  const state = nextState(internal, choices);
  let rec = R.reconcile(db, uid, { dashState: state, rates: opts.rates, sources: opts.sources });
  // The opening deposit is whole dollars too: its own cents (computed − written, unless the owner
  // typed the figure) join the roll's remainder, so the roll lands within $0.50 of the dashboard's.
  const openingResidue = op && !op.override ? op.amount - op.computed.amount : 0;
  for (const side of ['roll', 'fund']) {
    const bucket = rec.lines[side].rounding + (side === 'roll' ? openingResidue : 0);
    if (Math.abs(bucket) < 0.5) continue;
    const c = -roundAway(bucket);
    if (c === 0) continue;
    const name = side === 'roll' ? 'main' : 'fund';
    const fp = oneOf(db, 'SELECT 1 AS x FROM bankroll_import_keys WHERE user_id = ? AND fingerprint = ?', [uid, `dash:rounding:${name}`]) ? `dash:rounding:${name}:r${ctx.runId}` : `dash:rounding:${name}`;
    const nImported = Object.values(state.records).filter((r) => r.link === 'imported' && (side === 'roll' ? Math.abs((r.rRoll || 0) - r.roll) : Math.abs((r.rFund || 0) - r.fund)) >= 0.005).length;
    const id = J.insert('bankroll_adjustments', { user_id: uid, bankroll_id: side === 'roll' ? ctx.targetId : ctx.fund(), kind: 'correction', amount: c, transfer_id: null,
      occurred_on: ctx.today, note: `Rounding: ${nImported} dashboard row(s) carried cents; their exact remainder was $${(-bucket).toFixed(2)}`, created_at: ctx.nowIso, settlement_ref: null }, fp);
    writeKey(ctx, fp, 'bankroll_adjustments', id, null, 'imported');
    ctx.summary.corrections.push({ side, amount: c, residue: r2(-bucket) });
  }
  rec = R.reconcile(db, uid, { dashState: state, rates: opts.rates, sources: opts.sources });
  const ops = J.finish();
  return { ops, summary: ctx.summary, state, reconciliation: rec, fundCreated: ctx.fundCreated, fundId: ctx.fundId };
}

/** The commit run inside a savepoint and rolled back: the plan's "after" figures. Writes nothing. */
function simulate(db, uid, internal, opts = {}) {
  db.run('SAVEPOINT money_import_simulate');
  try {
    const r = apply(db, uid, internal, opts);
    return { summary: r.summary, reconciliation: r.reconciliation, state: r.state, fundCreated: r.fundCreated, created: r.ops.filter((o) => o.op === 'insert').length,
      tables: require('./journal').tableCounts(r.ops) };
  } finally {
    db.run('ROLLBACK TO money_import_simulate');
    db.run('RELEASE money_import_simulate');
  }
}

module.exports = { apply, simulate, choicesFor, nextState };
