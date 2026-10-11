// Expenses, non-game income and trips (beta, app admins only). The Results tab mounts the default
// export below the summary when isAdmin; it is a lazy chunk, so nobody else downloads it.
//   ExpensesSection  "Expenses & income": this year's totals for the selected bankroll, the latest
//                    rows, and the way into the sheets below.
//   TxSheet          quick add / edit — amount first (decimal keypad), category chips, done. Built
//                    for one thumb at the table or in a hotel lobby.
//   AllSheet         every row, totals by category, CSV export.
//   TripsSheet       trips: create, and a trip's whole P&L — results dated inside it plus the
//                    expenses and income tagged to it.
// Sheets are portalled to document.body and reuse the bankroll sheet's grid classes (bk-*).
// Data: /api/bankrolls/transactions and /api/bankrolls/trips (lib/bankroll-transactions.js).
// Arithmetic: utils/transactions.js. No receipts: this app keeps uploads only as base64 in the DB
// (avatars, staking proofs), which is not acceptable for receipts, so photos are left out.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../contexts/ToastContext.jsx';
import { API_URL } from '../utils/api.js';
import { CURRENCY_CONFIG, convertAmount, nativeCurrency, getToday, normaliseDate, MINUS } from '../utils/utils.js';
import { BANKROLL_ALL, BANKROLL_MAIN, bankrollQuery, entryBankrollKey } from '../utils/bankrolls.js';
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryLabel, totalsByCategory, inYear, tripPnl,
  transactionsToCsv, parseAmount, shortDay, tripRange, signedAmount,
} from '../utils/transactions.js';

const CURRENCIES = Object.keys(CURRENCY_CONFIG);
const RECENT = 5;

// Whole units unless there are cents.
function money(v, cur = 'USD') {
  const n = Number(v) || 0;
  const cfg = CURRENCY_CONFIG[cur] || CURRENCY_CONFIG.USD;
  const a = Math.abs(n);
  const cents = Math.round(a * 100) % 100 !== 0;
  const num = a.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
  const sign = n < 0 ? MINUS : '';
  return cfg.pos === 'suf' ? `${sign}${num} ${cfg.symbol}` : `${sign}${cfg.symbol}${num}`;
}
const signed = (v, cur) => (v > 0 ? '+' : '') + money(v, cur);
const tone = (v) => (v < 0 ? ' is-neg' : v > 0 ? ' is-pos' : '');

function useApi(token) {
  return useCallback(async (method, path, body) => {
    const res = await fetch(`${API_URL}/bankrolls${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [token]);
}

function Btn({ kind = 'ghost', w = 8, children, ...rest }) {
  return <button type="button" className={`bk-btn bk-btn--${kind} bk-w${w}`} {...rest}><span>{children}</span></button>;
}
function Field({ label, wide, children }) {
  return (
    <label className={'bk-field' + (wide ? ' is-wide' : '')}>
      <span className="bk-field-label">{label}</span>
      {children}
    </label>
  );
}

// A sheet: scrim + 37g panel, Escape closes.
function Sheet({ title, label, onClose, closeText = 'Done', children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="bk-scrim" onClick={onClose}>
      <div className="bk-sheet tx-sheet" role="dialog" aria-modal="true" aria-label={label || title} onClick={(e) => e.stopPropagation()}>
        <div className="bk-sheet-head">
          <h2 className="bk-sheet-title">{title}</h2>
          <Btn w={6} onClick={onClose}>{closeText}</Btn>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

// One transaction as a row: date | category · note | amount. A button when it can be edited.
function TxRow({ t, onOpen }) {
  const what = [categoryLabel(t.kind, t.category), t.note || t.series || t.tournament_name || t.trip_name].filter(Boolean).join(' · ');
  const inner = (
    <>
      <span className="tx-row-date">{shortDay(t.occurred_on)}</span>
      <span className="tx-row-what">{what}</span>
      <span className={'tx-row-amt' + tone(signedAmount(t))}>{signed(signedAmount(t), t.currency)}</span>
    </>
  );
  return onOpen
    ? <button type="button" className="tx-row" onClick={() => onOpen(t)}>{inner}</button>
    : <div className="tx-row">{inner}</div>;
}

function PlRow({ label, value, cur, total, plain }) {
  return (
    <div className={'tx-pl-row' + (total ? ' is-total' : '')}>
      <span className="tx-pl-label">{label}</span>
      <span className={'tx-pl-val' + (plain ? '' : tone(value))}>{plain ? value : signed(value, cur)}</span>
    </div>
  );
}

// ── Quick add / edit ────────────────────────────────────────────────────────
function TxSheet({ api, toast, tx, preset, bankrolls, trips, events, onSaved, onClose }) {
  const editing = !!tx;
  const start = tx || preset || {};
  const [kind, setKind] = useState(start.kind || 'expense');
  const [amount, setAmount] = useState(tx ? String(tx.amount) : '');
  const [category, setCategory] = useState(start.category || (start.kind === 'income' ? 'rakeback' : 'food'));
  const activeRolls = bankrolls.filter((b) => !b.archived || (tx && b.id === tx.bankroll_id));
  const [bankroll, setBankroll] = useState(start.bankroll_id != null ? start.bankroll_id : (start.bankroll || BANKROLL_MAIN));
  const curOf = (key) => (bankrolls.find((b) => b.id === key) || { currency: 'USD' }).currency;
  const [currency, setCurrency] = useState(tx ? tx.currency : curOf(start.bankroll_id != null ? start.bankroll_id : (start.bankroll || BANKROLL_MAIN)));
  const [currencyTouched, setCurrencyTouched] = useState(editing);
  const [date, setDate] = useState(start.occurred_on || getToday());
  const [tripId, setTripId] = useState(start.trip_id || start.tripId || '');
  const [tournamentId, setTournamentId] = useState(start.tournament_id || '');
  const [series, setSeries] = useState(start.series || '');
  const [note, setNote] = useState(start.note || '');
  const [busy, setBusy] = useState(false);
  const parsed = parseAmount(amount);
  const cats = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const pickKind = (k) => {
    setKind(k);
    if (!(k === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).some((c) => c.key === category)) setCategory(k === 'income' ? 'rakeback' : 'food');
  };
  const pickBankroll = (raw) => {
    const key = raw === BANKROLL_MAIN ? BANKROLL_MAIN : Number(raw);
    setBankroll(key);
    if (!currencyTouched) setCurrency(curOf(key));
  };
  // The most recent results first, for tagging an expense to an event.
  const eventOptions = useMemo(() => [...(events || [])]
    .map((e) => ({ id: e.tournament_id, date: normaliseDate(e.date), name: e.event_name }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 60), [events]);

  const save = async () => {
    if (!parsed || busy) return;
    setBusy(true);
    const body = {
      kind, category, amount: parsed, currency, date, bankroll,
      tripId: tripId === '' ? null : Number(tripId),
      tournamentId: tournamentId === '' ? null : Number(tournamentId),
      series, note,
    };
    try {
      if (editing) await api('PUT', `/transactions/${tx.id}`, body);
      else await api('POST', '/transactions', body);
      toast.success(editing ? 'Saved' : (kind === 'income' ? 'Income added' : 'Expense added'));
      onSaved();
    } catch (e) { toast.error(e.message); setBusy(false); }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try { await api('DELETE', `/transactions/${tx.id}`); toast.success('Deleted'); onSaved(); } catch (e) { toast.error(e.message); setBusy(false); }
  };

  return (
    <Sheet title={editing ? 'Edit' : (kind === 'income' ? 'Add income' : 'Add expense')} onClose={onClose} closeText="Cancel">
      <div className="tx-seg2" role="radiogroup" aria-label="Type">
        {[['expense', 'Expense'], ['income', 'Income']].map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={'bk-seg-btn' + (kind === k ? ' is-on' : '')} onClick={() => pickKind(k)}>
            <span>{l}</span>
          </button>
        ))}
      </div>
      <div className="tx-amount">
        <label className="tx-amount-field">
          <span className="bk-field-label">Amount</span>
          <input className="tx-amount-input" type="text" inputMode="decimal" autoComplete="off" placeholder="0"
            value={amount} autoFocus={!editing} onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
        </label>
        <label className="tx-amount-field">
          <span className="bk-field-label">Currency</span>
          <select className="tx-amount-cur" value={currency} onChange={(e) => { setCurrency(e.target.value); setCurrencyTouched(true); }}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <span className="tx-label">Category</span>
      <div className="tx-chips" role="radiogroup" aria-label="Category">
        {cats.map((c) => (
          <button key={c.key} type="button" role="radio" aria-checked={category === c.key}
            className={'tx-chip' + (category === c.key ? ' is-on' : '')} onClick={() => setCategory(c.key)}>
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      <div className="bk-fields tx-fields">
        <Field label="Note" wide><input value={note} maxLength={200} placeholder="Optional" onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Bankroll">
          <select value={String(bankroll)} onChange={(e) => pickBankroll(e.target.value)}>
            {activeRolls.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Trip" wide>
          <select value={String(tripId)} onChange={(e) => setTripId(e.target.value)}>
            <option value="">None</option>
            {trips.map((t) => <option key={t.id} value={String(t.id)}>{t.name} · {tripRange(t.start_date, t.end_date)}</option>)}
          </select>
        </Field>
        <Field label="Event" wide>
          <select value={String(tournamentId)} onChange={(e) => setTournamentId(e.target.value)}>
            <option value="">None</option>
            {tx && tx.tournament_id && !eventOptions.some((o) => o.id === tx.tournament_id) && (
              <option value={String(tx.tournament_id)}>{tx.tournament_name || `Event ${tx.tournament_id}`}</option>
            )}
            {eventOptions.map((o) => <option key={o.id} value={String(o.id)}>{shortDay(o.date)} · {o.name}</option>)}
          </select>
        </Field>
        <Field label="Series / venue" wide><input value={series} maxLength={80} placeholder="Optional" onChange={(e) => setSeries(e.target.value)} /></Field>
      </div>
      <div className="bk-actions">
        <Btn kind="brand" disabled={!parsed || busy} onClick={save}>{editing ? 'Save' : 'Add'}</Btn>
        {editing && <Btn kind="danger" disabled={busy} onClick={remove}>Delete</Btn>}
      </div>
    </Sheet>
  );
}

// ── Every row, totals, CSV ──────────────────────────────────────────────────
function AllSheet({ list, cur, convert, nameOf, onOpen, onClose, toast }) {
  const [kind, setKind] = useState('all');
  const rows = useMemo(() => (kind === 'all' ? list : list.filter((t) => t.kind === kind)), [list, kind]);
  const totals = useMemo(() => totalsByCategory(rows, { currency: cur, convert }), [rows, cur, convert]);
  const [busy, setBusy] = useState(false);
  const exportCsv = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { shareOrDownloadBlob } = await import('../utils/export.js');
      const blob = new Blob([transactionsToCsv(rows, { bankrollName: nameOf })], { type: 'text/csv;charset=utf-8' });
      await shareOrDownloadBlob(blob, `futuregame-expenses-income-${getToday()}.csv`, 'text/csv');
    } catch (e) { toast.error('Export failed'); console.error(e); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Expenses & income" onClose={onClose}>
      <div className="bk-seg tx-seg3" role="radiogroup" aria-label="Show">
        {[['all', 'All'], ['expense', 'Expenses'], ['income', 'Income']].map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={'bk-seg-btn' + (kind === k ? ' is-on' : '')} onClick={() => setKind(k)}>
            <span>{l}</span>
          </button>
        ))}
      </div>
      <section className="bk-section">
        <h3 className="bk-section-title">By category</h3>
        {totals.count === 0 && <p className="bk-line bk-muted">Nothing logged yet.</p>}
        {totals.expense.map((c) => <PlRow key={'e' + c.key} label={c.label} value={-c.amount} cur={cur} />)}
        {totals.income.map((c) => <PlRow key={'i' + c.key} label={c.label} value={c.amount} cur={cur} />)}
        {totals.count > 0 && <PlRow total label={kind === 'all' ? 'Net' : 'Total'} value={totals.net} cur={cur} />}
      </section>
      <section className="bk-section">
        <h3 className="bk-section-title">{rows.length} row{rows.length === 1 ? '' : 's'}</h3>
        {rows.map((t) => <TxRow key={t.id} t={t} onOpen={onOpen} />)}
      </section>
      <div className="bk-actions">
        <Btn kind="brand" disabled={!rows.length || busy} onClick={exportCsv}>{busy ? 'Saving…' : 'CSV'}</Btn>
      </div>
    </Sheet>
  );
}

// ── Trips ───────────────────────────────────────────────────────────────────
function TripForm({ trip, bankrolls, onSubmit, submitText }) {
  const [name, setName] = useState(trip ? trip.name : '');
  const [startDate, setStart] = useState(trip ? trip.start_date : getToday());
  const [endDate, setEnd] = useState(trip ? trip.end_date : getToday());
  const [bankroll, setBankroll] = useState(trip ? String(trip.bankroll) : BANKROLL_ALL);
  const submit = async () => {
    const ok = await onSubmit({ name, startDate, endDate, bankroll: bankroll === BANKROLL_ALL || bankroll === BANKROLL_MAIN ? bankroll : Number(bankroll) });
    if (ok && !trip) { setName(''); }
  };
  return (
    <>
      <div className="bk-fields">
        <Field label="Name" wide><input value={name} maxLength={60} placeholder="e.g. WSOP 2026" onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="From"><input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Results from" wide>
          <select value={bankroll} onChange={(e) => setBankroll(e.target.value)}>
            <option value={BANKROLL_ALL}>All bankrolls</option>
            {bankrolls.filter((b) => !b.archived || String(b.id) === bankroll).map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="bk-actions"><Btn kind="brand" disabled={!name.trim() || !startDate || !endDate} onClick={submit}>{submitText}</Btn></div>
    </>
  );
}

function TripDetail({ api, toast, tripId, bankrolls, rates, onAdd, onOpen, onBack, onChanged, version }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => {
    api('GET', `/trips/${tripId}`).then(setData).catch((e) => toast.error(e.message));
  }, [api, tripId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, version]);
  if (!data) return <p className="bk-line bk-muted">Loading…</p>;
  const trip = data.trip;
  const scopeRoll = trip.bankroll === BANKROLL_ALL ? null : bankrolls.find((b) => b.id === trip.bankroll);
  const cur = scopeRoll ? scopeRoll.currency : 'USD';
  const convert = (v, from, to) => convertAmount(v, from, to, rates);
  const p = tripPnl(data, { currency: cur, convert, nativeCurrency });
  const scopeName = trip.bankroll === BANKROLL_ALL ? 'All bankrolls' : (scopeRoll ? scopeRoll.name : 'Main');
  const update = async (body) => {
    try { await api('PUT', `/trips/${trip.id}`, body); toast.success('Saved'); setEditing(false); load(); onChanged(); return true; } catch (e) { toast.error(e.message); return false; }
  };
  const remove = async () => {
    try { await api('DELETE', `/trips/${trip.id}`); toast.success('Trip deleted'); onChanged(); onBack(); } catch (e) { toast.error(e.message); }
  };
  return (
    <>
      <p className="bk-line bk-muted">{tripRange(trip.start_date, trip.end_date)} · {scopeName}</p>
      <section className="bk-section">
        <h3 className="bk-section-title">Profit and loss</h3>
        <PlRow label={`Results · ${p.events} event${p.events === 1 ? '' : 's'}`} value={p.results} cur={cur} />
        <PlRow label="Expenses" value={-p.expenses} cur={cur} />
        <PlRow label="Income" value={p.income} cur={cur} />
        <PlRow total label="Trip net" value={p.net} cur={cur} />
      </section>
      {p.byCategory.expense.length > 0 && (
        <section className="bk-section">
          <h3 className="bk-section-title">Expenses by category</h3>
          {p.byCategory.expense.map((c) => <PlRow key={c.key} label={c.label} value={-c.amount} cur={cur} />)}
        </section>
      )}
      <section className="bk-section">
        <h3 className="bk-section-title">Results</h3>
        {data.results.length === 0 && <p className="bk-line bk-muted">No results dated inside this trip.</p>}
        {data.results.map((e) => {
          const from = nativeCurrency(e.venue);
          const net = (e.cashed ? Number(e.cash_amount) || 0 : 0) - (Number(e.buyin) || 0) * Math.max(1, Number(e.num_entries) || 1);
          return (
            <div key={e.id} className="tx-row">
              <span className="tx-row-date">{shortDay(e.date_iso)}</span>
              <span className="tx-row-what">{e.event_name}</span>
              <span className={'tx-row-amt' + tone(net)}>{signed(net, from)}</span>
            </div>
          );
        })}
      </section>
      <section className="bk-section">
        <h3 className="bk-section-title">Expenses and income</h3>
        {data.transactions.length === 0 && <p className="bk-line bk-muted">Nothing tagged to this trip yet.</p>}
        {data.transactions.map((t) => <TxRow key={t.id} t={t} onOpen={onOpen} />)}
      </section>
      <div className="bk-actions">
        <Btn kind="brand" onClick={() => onAdd({ kind: 'expense', tripId: trip.id, bankroll: scopeRoll ? scopeRoll.id : BANKROLL_MAIN })}>+ Expense</Btn>
        <Btn onClick={() => onAdd({ kind: 'income', tripId: trip.id, bankroll: scopeRoll ? scopeRoll.id : BANKROLL_MAIN })}>+ Income</Btn>
        <Btn onClick={() => setEditing(!editing)}>{editing ? 'Close' : 'Edit'}</Btn>
        <Btn kind="danger" onClick={remove}>Delete</Btn>
      </div>
      {editing && (
        <section className="bk-section">
          <h3 className="bk-section-title">Edit trip</h3>
          <TripForm trip={trip} bankrolls={bankrolls} onSubmit={update} submitText="Save" />
        </section>
      )}
      <div className="bk-actions"><Btn onClick={onBack}>‹ Trips</Btn></div>
    </>
  );
}

function TripsSheet({ api, toast, trips, bankrolls, rates, openId, onOpenTrip, onAdd, onOpen, onChanged, onClose, version }) {
  const create = async (body) => {
    try {
      const r = await api('POST', '/trips', body);
      toast.success('Trip created');
      onChanged();
      onOpenTrip(r.trip.id);
      return true;
    } catch (e) { toast.error(e.message); return false; }
  };
  const open = openId ? trips.find((t) => t.id === openId) : null;
  return (
    <Sheet title={open ? open.name : 'Trips'} label="Trips" onClose={onClose}>
      {openId ? (
        <TripDetail api={api} toast={toast} tripId={openId} bankrolls={bankrolls} rates={rates} version={version}
          onAdd={onAdd} onOpen={onOpen} onBack={() => onOpenTrip(null)} onChanged={onChanged} />
      ) : (
        <>
          <section className="bk-section">
            {trips.length === 0 && <p className="bk-line bk-muted">No trips yet. A trip adds up the results dated inside it and the expenses you tag to it.</p>}
            {trips.map((t) => (
              <button key={t.id} type="button" className="tx-trip-row" onClick={() => onOpenTrip(t.id)}>
                <span className="tx-trip-name">{t.name}</span>
                <span className="tx-trip-count">{t.transaction_count} tagged</span>
                <span className="tx-trip-meta">{tripRange(t.start_date, t.end_date)}</span>
              </button>
            ))}
          </section>
          <section className="bk-section">
            <h3 className="bk-section-title">New trip</h3>
            <TripForm bankrolls={bankrolls} onSubmit={create} submitText="Create" />
          </section>
        </>
      )}
    </Sheet>
  );
}

// ── The Results-tab section ─────────────────────────────────────────────────
export default function ExpensesSection({ token, bankroll = BANKROLL_ALL, bankrolls = [], rates, events, onChanged }) {
  const toast = useToast();
  const api = useApi(token);
  const [list, setList] = useState(null);
  const [trips, setTrips] = useState([]);
  // One sheet at a time: { type: 'add', tx?, preset?, back? } | { type: 'all' } | { type: 'trips', tripId? }
  const [sheet, setSheet] = useState(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const [t, tr] = await Promise.all([
        api('GET', `/transactions?limit=5000${bankrollQuery(bankroll, '&')}`),
        api('GET', '/trips'),
      ]);
      setList(t.transactions || []);
      setTrips(tr.trips || []);
    } catch (e) { setList([]); console.error('Expenses:', e); }
  }, [api, bankroll]);
  useEffect(() => { load(); }, [load]);
  const changed = useCallback(() => { load(); setVersion((v) => v + 1); if (onChanged) onChanged(); }, [load, onChanged]);

  const selectedRoll = bankrolls.find((b) => b.id === bankroll);
  const cur = selectedRoll ? selectedRoll.currency : 'USD';
  const convert = useCallback((v, from, to) => convertAmount(v, from, to, rates), [rates]);
  const year = getToday().slice(0, 4);
  const yearTotals = useMemo(() => totalsByCategory(inYear(list || [], year), { currency: cur, convert }), [list, year, cur, convert]);
  const nameOf = useCallback((id) => {
    const key = entryBankrollKey({ bankroll_id: id });
    return (bankrolls.find((b) => b.id === key) || { name: key === BANKROLL_MAIN ? 'Main' : String(key) }).name;
  }, [bankrolls]);
  const rolls = bankrolls.length ? bankrolls : [{ id: BANKROLL_MAIN, name: 'Main', currency: 'USD' }];
  const presetBankroll = bankroll === BANKROLL_ALL ? BANKROLL_MAIN : bankroll;

  // Seat the section on an r line. What sits above it in the Results tab (the summary card, the
  // curve, the Analytics launcher) predates the grid and ends a fraction of an r off it (measured
  // 0.06r at 402 wide), so the section's content is pushed down to the next r line counted from the
  // .top-bar (the origin the grid overlay and check:controls use). Padding, not margin: a margin
  // collapses into the launcher's. Re-measured whenever the tab re-lays out.
  const secRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const el = secRef.current;
    if (!el || !el.parentElement) return undefined;
    const apply = () => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
      el.appendChild(probe);
      const r = probe.getBoundingClientRect().height / 100;
      probe.remove();
      const bar = document.querySelector('.top-bar');
      if (!(r > 0) || !bar) return;
      // Laid-out position: a scrolled content area is added back, as the overlay counts lines.
      const ca = el.closest('.content-area');
      const cur = parseFloat(getComputedStyle(el).paddingTop) || 0;
      const pos = el.getBoundingClientRect().top + (ca ? ca.scrollTop : 0) - bar.getBoundingClientRect().top;
      const frac = pos / r - Math.floor(pos / r);
      const need = frac > 0.005 && frac < 0.995 ? 1 - frac : 0; // in r
      if (Math.abs(need * r - cur) > 0.01) el.style.paddingTop = need ? `calc(var(--subrow) * ${need.toFixed(4)})` : '';
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(apply); });
    ro.observe(el.parentElement);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const openTx = (back) => (t) => setSheet({ type: 'add', tx: t, back });
  const closeAdd = () => setSheet(sheet && sheet.back ? sheet.back : null);

  return (
    <section ref={secRef} className="tx-sec" aria-label="Expenses and income">
      <div className="tx-head">
        <span className="tx-title">Expenses &amp; Income</span>
        <span className="bk-beta">Beta</span>
        <button type="button" className="bk-head-btn" onClick={() => setSheet({ type: 'add', preset: { kind: 'expense', bankroll: presetBankroll } })}>
          <span>+ Add</span>
        </button>
      </div>
      <div className="tx-sum">
        <div className="tx-cell">
          <span className="tx-cell-label">Expenses {year}</span>
          <span className="tx-cell-val">{money(yearTotals.expenses, cur)}</span>
        </div>
        <div className="tx-cell">
          <span className="tx-cell-label">Income {year}</span>
          <span className="tx-cell-val">{money(yearTotals.income_total, cur)}</span>
        </div>
        <div className="tx-cell">
          <span className="tx-cell-label">Net {year}</span>
          <span className={'tx-cell-val' + tone(yearTotals.net)}>{signed(yearTotals.net, cur)}</span>
        </div>
      </div>
      <div className="tx-list">
        {list && list.length === 0 && <p className="tx-line">Log travel, rooms, food, tips and rakeback here.</p>}
        {(list || []).slice(0, RECENT).map((t) => <TxRow key={t.id} t={t} onOpen={openTx(null)} />)}
      </div>
      <div className="bk-actions">
        <Btn onClick={() => setSheet({ type: 'trips' })}>Trips{trips.length ? ` · ${trips.length}` : ''}</Btn>
        <Btn disabled={!list || !list.length} onClick={() => setSheet({ type: 'all' })}>All{list && list.length > RECENT ? ` · ${list.length}` : ''}</Btn>
      </div>

      {sheet && sheet.type === 'add' && (
        <TxSheet api={api} toast={toast} tx={sheet.tx} preset={sheet.preset} bankrolls={rolls} trips={trips} events={events}
          onSaved={() => { changed(); closeAdd(); }} onClose={closeAdd} />
      )}
      {sheet && sheet.type === 'all' && (
        <AllSheet list={list || []} cur={cur} convert={convert} nameOf={nameOf} toast={toast}
          onOpen={openTx({ type: 'all' })} onClose={() => setSheet(null)} />
      )}
      {sheet && sheet.type === 'trips' && (
        <TripsSheet api={api} toast={toast} trips={trips} bankrolls={rolls} rates={rates} openId={sheet.tripId || null} version={version}
          onOpenTrip={(id) => setSheet({ type: 'trips', tripId: id })}
          onAdd={(preset) => setSheet({ type: 'add', preset, back: { type: 'trips', tripId: preset.tripId } })}
          onOpen={(t) => setSheet({ type: 'add', tx: t, back: { type: 'trips', tripId: t.trip_id } })}
          onChanged={changed} onClose={() => setSheet(null)} />
      )}
    </section>
  );
}
