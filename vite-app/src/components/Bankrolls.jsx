// Bankrolls (beta, app admins only). Three pieces the Results tab mounts:
//   BankrollSwitcher  the strip at the top of the tab: one 8g cell per bankroll (All, Main, then
//                     each active bankroll) with its balance; picking one filters the summary,
//                     ROI, the curve and the list below it.
//   BankrollManager   the sheet behind "Manage" (portalled to document.body): create, rename,
//                     archive, delete, deposits / withdrawals / transfers, and the ledger.
//   BankrollPicker    the "Bankroll" field in the log / edit result form.
// Data and API calls: hooks/useBankrolls.js. Arithmetic: utils/bankrolls.js. Server: lib/bankrolls.js.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../contexts/ToastContext.jsx';
import { CURRENCY_CONFIG, formatCurrencyAmount, getToday } from '../utils/utils.js';
import { BANKROLL_ALL, BANKROLL_MAIN, entryBankrollKey } from '../utils/bankrolls.js';

const money = (v, cur) => formatCurrencyAmount(Math.round(v || 0), cur || 'USD');
const signed = (v, cur) => (v > 0 ? '+' : '') + money(v, cur);
const tone = (v) => (v < 0 ? ' is-neg' : '');

// ── Switcher ────────────────────────────────────────────────────────────────
export function BankrollSwitcher({ bk, balances, onManage }) {
  const cells = [{ id: BANKROLL_ALL, name: 'All' }, ...bk.visible];
  return (
    <section className="bk-bar" aria-label="Bankroll">
      <div className="bk-head">
        <span className="bk-head-title">Bankroll</span>
        <span className="bk-beta">Beta</span>
        <button type="button" className="bk-head-btn" onClick={onManage}><span>Manage</span></button>
      </div>
      <div className="bk-grid" role="radiogroup" aria-label="Show results for">
        {cells.map((b) => {
          const bal = balances.get(b.id) || { balance: 0, currency: 'USD' };
          const on = bk.selected === b.id;
          return (
            <button key={b.id} type="button" role="radio" aria-checked={on}
              className={'bk-cell' + (on ? ' is-on' : '')} onClick={() => bk.setSelected(b.id)}>
              <span className="bk-cell-name">{b.name}</span>
              <span className={'bk-cell-bal' + tone(bal.balance)}>{money(bal.balance, bal.currency)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Picker (log / edit result form) ─────────────────────────────────────────
// Lists the active bankrolls, plus the entry's current one if it has since been archived.
export function BankrollPicker({ bankrolls, value, onChange }) {
  const options = (bankrolls || []).filter((b) => !b.archived || b.id === value);
  return (
    <div className="filter-group bk-picker">
      <label>Bankroll</label>
      <select value={String(value)} onChange={(e) => onChange(e.target.value === BANKROLL_MAIN ? BANKROLL_MAIN : Number(e.target.value))}>
        {options.map((b) => <option key={b.id} value={String(b.id)}>{b.name}{b.archived ? ' (archived)' : ''}</option>)}
      </select>
    </div>
  );
}

// ── Manager sheet ───────────────────────────────────────────────────────────
const CURRENCIES = Object.keys(CURRENCY_CONFIG);

function Field({ label, wide, children }) {
  return (
    <label className={'bk-field' + (wide ? ' is-wide' : '')}>
      <span className="bk-field-label">{label}</span>
      {children}
    </label>
  );
}

function Btn({ kind = 'ghost', w = 8, children, ...rest }) {
  return <button type="button" className={`bk-btn bk-btn--${kind} bk-w${w}`} {...rest}><span>{children}</span></button>;
}

function BankrollEditor({ b, bal, bk, onDone, toast }) {
  const [name, setName] = useState(b.name);
  const [start, setStart] = useState(String(b.starting_balance || 0));
  const [currency, setCurrency] = useState(b.currency);
  const run = async (fn, ok) => { try { await fn(); if (ok) toast.success(ok); onDone(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="bk-editor">
      <p className="bk-line">
        Start {money(bal.start, bal.currency)} · Moved {signed(bal.adjustments, bal.currency)} · Results {signed(bal.results, bal.currency)}
      </p>
      {b.is_main ? (
        <p className="bk-line bk-muted">Main holds every result not filed under another bankroll.</p>
      ) : (
        <>
          <div className="bk-fields">
            <Field label="Name" wide><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Starting balance"><input type="number" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Currency">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div className="bk-actions">
            <Btn kind="brand" onClick={() => run(() => bk.update(b.id, { name, startingBalance: Number(start) || 0, currency }), 'Saved')}>Save</Btn>
            <Btn onClick={() => run(() => bk.update(b.id, { archived: !b.archived }), b.archived ? 'Restored' : 'Archived')}>{b.archived ? 'Restore' : 'Archive'}</Btn>
            <Btn kind="danger" disabled={b.entry_count > 0 || b.adjustment_count > 0}
              title={b.entry_count || b.adjustment_count ? 'Has results or transactions: archive it instead' : undefined}
              onClick={() => run(() => bk.remove(b.id), 'Deleted')}>Delete</Btn>
          </div>
        </>
      )}
    </div>
  );
}

function NewBankroll({ bk, toast }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [currency, setCurrency] = useState('USD');
  const submit = async () => {
    try {
      await bk.create({ name, startingBalance: Number(start) || 0, currency });
      toast.success('Bankroll created'); setName(''); setStart(''); setCurrency('USD');
    } catch (e) { toast.error(e.message); }
  };
  return (
    <section className="bk-section">
      <h3 className="bk-section-title">New bankroll</h3>
      <div className="bk-fields">
        <Field label="Name" wide><input value={name} maxLength={40} placeholder="e.g. Staked" onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Starting balance"><input type="number" inputMode="numeric" value={start} placeholder="0" onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Currency">
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <div className="bk-actions"><Btn kind="brand" disabled={!name.trim()} onClick={submit}>Create</Btn></div>
    </section>
  );
}

function MoveMoney({ bk, toast, onMoved }) {
  const active = bk.visible;
  const [kind, setKind] = useState('deposit');
  const [target, setTarget] = useState(BANKROLL_MAIN);
  const [from, setFrom] = useState(BANKROLL_MAIN);
  const [to, setTo] = useState(active[1] ? active[1].id : BANKROLL_MAIN);
  const [amount, setAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [date, setDate] = useState(getToday());
  const [note, setNote] = useState('');
  const keyOf = (v) => (v === BANKROLL_MAIN ? BANKROLL_MAIN : Number(v));
  const cur = (id) => (active.find((b) => b.id === id) || { currency: 'USD' }).currency;
  const cross = kind === 'transfer' && cur(from) !== cur(to);
  const select = (value, set) => (
    <select value={String(value)} onChange={(e) => set(keyOf(e.target.value))}>
      {active.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
    </select>
  );
  const submit = async () => {
    try {
      if (kind === 'transfer') await bk.transfer({ from, to, amount: Number(amount), toAmount: cross ? Number(toAmount) : undefined, date, note });
      else await bk.adjust({ bankroll: target, kind, amount: Number(amount), date, note });
      toast.success(kind === 'transfer' ? 'Transfer recorded' : kind === 'deposit' ? 'Deposit recorded' : 'Withdrawal recorded');
      setAmount(''); setToAmount(''); setNote('');
      onMoved();
    } catch (e) { toast.error(e.message); }
  };
  return (
    <section className="bk-section">
      <h3 className="bk-section-title">Move money</h3>
      <div className="bk-seg" role="radiogroup" aria-label="Kind">
        {[['deposit', 'Deposit'], ['withdrawal', 'Withdraw'], ['transfer', 'Transfer']].map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={'bk-seg-btn' + (kind === k ? ' is-on' : '')} onClick={() => setKind(k)}>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="bk-fields">
        {kind === 'transfer' ? (
          <>
            <Field label="From">{select(from, setFrom)}</Field>
            <Field label="To">{select(to, setTo)}</Field>
          </>
        ) : (
          <Field label="Bankroll" wide>{select(target, setTarget)}</Field>
        )}
        <Field label={`Amount (${kind === 'transfer' ? cur(from) : cur(target)})`}>
          <input type="number" inputMode="numeric" min="1" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {cross && (
          <Field label={`Received (${cur(to)})`}>
            <input type="number" inputMode="numeric" min="1" value={toAmount} placeholder="0" onChange={(e) => setToAmount(e.target.value)} />
          </Field>
        )}
        <Field label="Note" wide><input value={note} maxLength={200} placeholder="Optional" onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="bk-actions">
        <Btn kind="brand" disabled={!(Number(amount) > 0) || (cross && !(Number(toAmount) > 0)) || (kind === 'transfer' && from === to)} onClick={submit}>Record</Btn>
      </div>
    </section>
  );
}

const KIND_LABEL = { deposit: 'Deposit', withdrawal: 'Withdrawal', transfer_in: 'Transfer in', transfer_out: 'Transfer out' };

function Ledger({ bk, rows, toast, onChanged }) {
  const nameOf = (id) => (bk.bankrolls.find((b) => b.id === entryBankrollKey({ bankroll_id: id })) || { name: '?' }).name;
  const curOf = (id) => (bk.bankrolls.find((b) => b.id === entryBankrollKey({ bankroll_id: id })) || { currency: 'USD' }).currency;
  return (
    <section className="bk-section">
      <h3 className="bk-section-title">History</h3>
      {rows.length === 0 ? <p className="bk-line bk-muted">No deposits, withdrawals or transfers yet.</p> : rows.map((a) => (
        <div key={a.id} className="bk-ledger-row">
          <span className="bk-ledger-date">{a.occurred_on}</span>
          <span className="bk-ledger-what">{nameOf(a.bankroll_id)} · {KIND_LABEL[a.kind] || a.kind}{a.note ? ` · ${a.note}` : ''}</span>
          <span className={'bk-ledger-amt' + tone(a.amount)}>{signed(a.amount, curOf(a.bankroll_id))}</span>
          <button type="button" className="bk-ledger-x" aria-label={a.transfer_id ? 'Delete this transfer (both sides)' : 'Delete'}
            onClick={async () => { try { await bk.removeAdjustment(a.id); onChanged(); } catch (e) { toast.error(e.message); } }}>
            <span>×</span>
          </button>
        </div>
      ))}
    </section>
  );
}

export function BankrollManager({ bk, balances, onClose }) {
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const [ledger, setLedger] = useState([]);
  const loadLedger = useCallback(() => { bk.listAdjustments().then(setLedger).catch(() => {}); }, [bk.listAdjustments]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bk.refresh(); loadLedger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const archived = useMemo(() => bk.bankrolls.filter((b) => b.archived), [bk.bankrolls]);
  const row = (b) => {
    const bal = balances.get(b.id) || { start: 0, adjustments: 0, results: 0, balance: 0, currency: b.currency };
    return (
      <React.Fragment key={b.id}>
        <button type="button" className={'bk-row' + (open === b.id ? ' is-open' : '')} aria-expanded={open === b.id}
          onClick={() => setOpen(open === b.id ? null : b.id)}>
          <span className="bk-row-name">{b.name}</span>
          <span className="bk-row-meta">{b.entry_count} result{b.entry_count === 1 ? '' : 's'} · {b.currency}</span>
          <span className={'bk-row-bal' + tone(bal.balance)}>{money(bal.balance, bal.currency)}</span>
        </button>
        {open === b.id && <BankrollEditor b={b} bal={bal} bk={bk} toast={toast} onDone={() => { setOpen(null); loadLedger(); }} />}
      </React.Fragment>
    );
  };
  return createPortal(
    <div className="bk-scrim" onClick={onClose}>
      <div className="bk-sheet" role="dialog" aria-modal="true" aria-label="Bankrolls" onClick={(e) => e.stopPropagation()}>
        <div className="bk-sheet-head">
          <h2 className="bk-sheet-title">Bankrolls</h2>
          <Btn w={6} onClick={onClose}>Done</Btn>
        </div>
        <section className="bk-section">
          {bk.visible.map(row)}
          {archived.length > 0 && <h3 className="bk-section-title bk-muted">Archived</h3>}
          {archived.map(row)}
        </section>
        <MoveMoney bk={bk} toast={toast} onMoved={loadLedger} />
        <NewBankroll bk={bk} toast={toast} />
        <Ledger bk={bk} rows={ledger} toast={toast} onChanged={loadLedger} />
      </div>
    </div>,
    document.body
  );
}
