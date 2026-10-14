'use strict';
/*
 * The import's write journal: every row a commit creates, changes or removes, so an undo can put the
 * database back exactly (docs/bankroll-merge.md §8.2 undo, §13 step 2's rollback).
 *
 *   insert   { op: 'insert', table, pk, fp, after }            undo deletes the row
 *   update   { op: 'update', table, pk, fp, before, after }    undo writes `before` back (only the
 *                                                              columns the commit changed)
 *   delete   { op: 'delete', table, pk, fp, row }              undo re-inserts the whole row, same id
 *
 * `after` is a hash of the whole row as the commit left it. An undo first re-reads every row and
 * refuses when one no longer hashes the same: the owner has edited it since, and putting the old
 * figures back would destroy that edit. It lists them instead.
 *
 * A row inserted by this commit and then updated by it is journaled once, as the insert (its `after`
 * is taken when the commit finishes). A row inserted and then deleted by the same commit is dropped.
 *
 * Ids are never reused: undo deletes rows, it does not reset sqlite_sequence (AUTOINCREMENT exists so
 * that an id, once handed out, never means a second row).
 */
const crypto = require('crypto');

const PK = {
  session_extras: ['ref_table', 'ref_id'],
  bankroll_import_keys: ['user_id', 'fingerprint'],
  money_settings: ['user_id'],
  backer_events: ['id'],
  standing_exclusions: ['agreement_id', 'ref_table', 'ref_id'],
};
const pkCols = (table) => PK[table] || ['id'];
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s) => { if (!IDENT.test(s)) throw new Error('journal: bad identifier ' + s); return s; };

function where(pk) {
  const cols = Object.keys(pk);
  return { sql: cols.map((c) => `${ident(c)} = ?`).join(' AND '), params: cols.map((c) => pk[c]) };
}
function selectRow(db, table, pk) {
  const w = where(pk);
  const s = db.prepare(`SELECT * FROM ${ident(table)} WHERE ${w.sql}`);
  try { s.bind(w.params); return s.step() ? s.getAsObject() : null; } finally { s.free(); }
}
const hashRow = (row) => (row ? crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex') : null);
const keyOf = (table, pk) => table + '|' + JSON.stringify(pk);

class Journal {
  constructor(db) { this.db = db; this.ops = []; this.inserted = new Map(); this.touched = new Map(); }

  insert(table, values, fp = null) {
    const cols = Object.keys(values).map(ident);
    this.db.run(`INSERT INTO ${ident(table)} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => (values[c] === undefined ? null : values[c])));
    const pc = pkCols(table);
    let pk;
    if (pc.length === 1 && pc[0] === 'id' && values.id === undefined) {
      const r = this.db.exec('SELECT last_insert_rowid()');
      pk = { id: r[0].values[0][0] };
    } else pk = Object.fromEntries(pc.map((c) => [c, values[c]]));
    const op = { op: 'insert', table, pk, fp };
    this.ops.push(op);
    this.inserted.set(keyOf(table, pk), op);
    return pk.id !== undefined ? pk.id : pk;
  }

  update(table, pk, changes, fp = null) {
    const cols = Object.keys(changes).map(ident);
    if (!cols.length) return 0;
    const k = keyOf(table, pk);
    if (!this.inserted.has(k)) {
      const row = selectRow(this.db, table, pk);
      if (!row) throw new Error(`journal: no ${table} row to update`);
      const seen = this.touched.get(k);
      if (seen) {
        for (const c of cols) if (!(c in seen.before)) seen.before[c] = row[c];
      } else {
        const op = { op: 'update', table, pk, fp, before: Object.fromEntries(cols.map((c) => [c, row[c]])) };
        this.ops.push(op);
        this.touched.set(k, op);
      }
    }
    const w = where(pk);
    this.db.run(`UPDATE ${ident(table)} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${w.sql}`, [...cols.map((c) => (changes[c] === undefined ? null : changes[c])), ...w.params]);
    return this.db.getRowsModified();
  }

  delete(table, pk, fp = null) {
    const k = keyOf(table, pk);
    const w = where(pk);
    if (this.inserted.has(k)) {
      const op = this.inserted.get(k);
      this.ops = this.ops.filter((o) => o !== op);
      this.inserted.delete(k);
    } else {
      const row = selectRow(this.db, table, pk);
      if (!row) return 0;
      const upd = this.touched.get(k);
      if (upd) { // changed then removed by this commit: restore needs the row as it was before both
        for (const [c, v] of Object.entries(upd.before)) row[c] = v;
        this.ops = this.ops.filter((o) => o !== upd);
        this.touched.delete(k);
      }
      const op = { op: 'delete', table, pk, fp, row };
      // A table keyed by something other than its integer id still has a hidden rowid, and a plain
      // re-insert would take a new one: keep it, so the undo puts the row back where it was.
      if (PK[table]) {
        const r = this.db.exec(`SELECT rowid FROM ${ident(table)} WHERE ${w.sql}`, w.params);
        if (r.length && r[0].values.length) op.rowid = r[0].values[0][0];
      }
      this.ops.push(op);
    }
    this.db.run(`DELETE FROM ${ident(table)} WHERE ${w.sql}`, w.params);
    return this.db.getRowsModified();
  }

  /** Seal: the hash of every row as the commit left it. Returns the ops (JSON-safe). */
  finish() {
    for (const op of this.ops) if (op.op !== 'delete') op.after = hashRow(selectRow(this.db, op.table, op.pk));
    return this.ops;
  }
}

/** The rows a run created, per table (what the undo's typed confirmation counts). */
function createdCount(ops) { return ops.filter((o) => o.op === 'insert').length; }

/**
 * Who else points at a row the undo would delete? `inserted` is the set of keyOf() the run created
 * (those go too, so they do not count). -> [{ table, by }]
 */
const DEPENDENTS = {
  tournaments: [['tracking_entries', 'tournament_id'], ['user_schedules', 'tournament_id'], ['bankroll_transactions', 'tournament_id'], ['live_updates', 'tournament_id'],
    ['backer_event_status', 'tournament_id'], ['backer_event_overrides', 'tournament_id'], ['schedule_conditions', 'tournament_id'], ['swap_suggestions', 'tournament_id']],
  cash_sessions: [['cash_session_stacks', 'session_id']],
  backers: [['backer_agreements', 'backer_id'], ['standing_agreements', 'backer_id'], ['backer_settlements', 'backer_id']],
  standing_agreements: [['standing_stakes', 'agreement_id'], ['standing_exclusions', 'agreement_id']],
  staking_series: [['backer_agreements', 'series_id'], ['backer_settlements', 'series_id']],
  backer_agreements: [['backer_event_status', 'agreement_id'], ['backer_event_overrides', 'agreement_id'], ['backer_settlements', 'agreement_id'], ['backer_tokens', 'agreement_id']],
  bankrolls: [['tracking_entries', 'bankroll_id'], ['cash_sessions', 'bankroll_id'], ['bankroll_adjustments', 'bankroll_id'], ['bankroll_transactions', 'bankroll_id'],
    ['bankroll_trips', 'bankroll_id'], ['staking_series', 'bankroll_id']],
};
function tableExists(db, t) {
  const r = db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [t]);
  return !!(r.length && r[0].values.length);
}
function columnExists(db, t, c) {
  const r = db.exec(`PRAGMA table_info(${ident(t)})`);
  return !!(r.length && r[0].values.some((v) => v[1] === c));
}
function dependents(db, table, id, inserted) {
  const out = [];
  for (const [t, col] of DEPENDENTS[table] || []) {
    if (!tableExists(db, t) || !columnExists(db, t, col)) continue;
    const pkc = pkCols(t);
    const s = db.prepare(`SELECT ${pkc.map(ident).join(', ')} FROM ${ident(t)} WHERE ${ident(col)} = ?`);
    try {
      s.bind([id]);
      while (s.step()) {
        const r = s.getAsObject();
        if (!inserted.has(keyOf(t, r))) out.push({ table: t, by: col });
      }
    } finally { s.free(); }
  }
  // A recorded share or an exclusion that names the result (backer_events / standing_exclusions carry
  // a ref, not a foreign key).
  if (table === 'tracking_entries' || table === 'cash_sessions') {
    for (const t of ['backer_events', 'standing_exclusions']) {
      if (!tableExists(db, t) || !columnExists(db, t, 'ref_table')) continue;
      const pkc = pkCols(t);
      const s = db.prepare(`SELECT ${pkc.map(ident).join(', ')} FROM ${ident(t)} WHERE ref_table = ? AND ref_id = ?`);
      try {
        s.bind([table, id]);
        while (s.step()) { const r = s.getAsObject(); if (!inserted.has(keyOf(t, r))) out.push({ table: t, by: 'ref' }); }
      } finally { s.free(); }
    }
  }
  return out;
}

/**
 * Can these ops be undone? -> { ok, edited: [{ table, id?, why }], missing: n }
 *   edited   a row the run wrote that hashes differently now (changed since), a row it removed that
 *            is back, or a row it created that something else now points at. The undo refuses.
 *   missing  rows the run created that are already gone (deleted here since). Not a refusal: the
 *            undo would have removed them anyway.
 */
function checkUndo(db, ops) {
  // Rows the run wrote itself (created, or changed: the recorded shares it linked) do not count as
  // "something else points at it"; a change to one of THEM since is caught by its own hash.
  const inserted = new Set(ops.filter((o) => o.op !== 'delete').map((o) => keyOf(o.table, o.pk)));
  const edited = [];
  let missing = 0;
  const label = (o) => ({ table: o.table, ...(o.pk.id !== undefined ? { id: o.pk.id } : {}) });
  for (const o of ops) {
    const row = selectRow(db, o.table, o.pk);
    if (o.op === 'delete') {
      if (row) edited.push({ ...label(o), why: 'a row this import removed is there again' });
      continue;
    }
    if (!row) {
      if (o.op === 'insert') missing++;
      else edited.push({ ...label(o), why: 'a row this import changed has been deleted since' });
      continue;
    }
    if (hashRow(row) !== o.after) { edited.push({ ...label(o), why: 'edited since the import' }); continue; }
    if (o.op === 'insert' && o.pk.id !== undefined) {
      for (const d of dependents(db, o.table, o.pk.id, inserted)) edited.push({ ...label(o), why: `used since the import (${d.table})` });
    }
  }
  return { ok: edited.length === 0, edited, missing };
}

/** Reverse the ops, last first. Call inside a savepoint. -> { removed, restored, reinserted } */
function undoOps(db, ops) {
  let removed = 0, restored = 0, reinserted = 0;
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    const w = where(o.pk);
    if (o.op === 'insert') {
      db.run(`DELETE FROM ${ident(o.table)} WHERE ${w.sql}`, w.params);
      removed += db.getRowsModified();
    } else if (o.op === 'update') {
      const cols = Object.keys(o.before).map(ident);
      db.run(`UPDATE ${ident(o.table)} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${w.sql}`, [...cols.map((c) => o.before[c]), ...w.params]);
      restored += db.getRowsModified();
    } else if (o.op === 'delete') {
      const cols = Object.keys(o.row).map(ident);
      const vals = cols.map((c) => o.row[c]);
      if (o.rowid != null) {
        const taken = db.exec(`SELECT 1 FROM ${ident(o.table)} WHERE rowid = ?`, [o.rowid]);
        if (!(taken.length && taken[0].values.length)) { cols.unshift('rowid'); vals.unshift(o.rowid); }
      }
      db.run(`INSERT INTO ${ident(o.table)} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
      reinserted++;
    }
  }
  return { removed, restored, reinserted };
}

/** row key -> the latest `after` hash any committed run left on it (for "edited here since the import"). */
function afterIndex(journals) {
  const m = new Map();
  for (const ops of journals) for (const o of ops || []) {
    const k = keyOf(o.table, o.pk);
    if (o.op === 'delete') m.delete(k); else if (o.after) m.set(k, o.after);
  }
  return m;
}

module.exports = { Journal, PK, pkCols, selectRow, hashRow, keyOf, createdCount, checkUndo, undoOps, afterIndex, dependents };
