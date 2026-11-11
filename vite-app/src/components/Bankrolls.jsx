// Bankrolls (beta, app admins only). Three pieces the Results tab mounts:
//   BankrollSwitcher  the strip at the top of the tab: one 8g cell per bankroll (All, Main, then
//                     each active bankroll) with its balance; picking one filters the summary,
//                     ROI, the curve and the list below it. Its head opens the dashboard
//                     (BankrollDashboard.jsx) and the manager.
//   BankrollManager   the sheet behind "Manage" (portalled to document.body): create, rename,
//                     archive, delete, deposits / withdrawals / transfers, and the ledger.
//   BankrollPicker    the "Bankroll" field in the log / edit result form.
// Data and API calls: hooks/useBankrolls.js. Arithmetic: utils/bankrolls.js. Server: lib/bankrolls.js.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Icon from './Icon.jsx';
import { createPortal } from 'react-dom';
import { useToast } from '../contexts/ToastContext.jsx';
import { CURRENCY_CONFIG, formatCurrencyAmount, getToday } from '../utils/utils.js';
import { BANKROLL_ALL, BANKROLL_MAIN, entryBankrollKey } from '../utils/bankrolls.js';
import MoneyField from './MoneyField.jsx';
import { shortDay } from '../utils/transactions.js';
import { Bone } from './SkeletonBankroll.jsx';

const money = (v, cur) => formatCurrencyAmount(Math.round(v || 0), cur || 'USD');
const signed = (v, cur) => (v > 0 ? '+' : '') + money(v, cur);
const tone = (v) => (v < 0 ? ' is-neg' : '');

// ── Switcher ────────────────────────────────────────────────────────────────
export function BankrollSwitcher({ bk, balances, onManage, add = null }) {
  const cells = [{ id: BANKROLL_ALL, name: 'All' }, ...bk.visible];
  return (
    /* In the Schedule's scheme (owner, 2026-10-16): no title row (the top bar says Bankroll); the
       bankrolls and the two actions are one grid of 8g tiles, the tiles the Schedule's outlined chips
       with a caps name and the balance in its money face (tracking-cards.css). */
    <section className="bk-bar bk-bar--sched" aria-label="Bankroll">
      <div className="bk-grid bk-grid--row">
        {(() => {
          const cur = cells.find((c) => c.id === bk.selected) || cells[0];
          const bal = balances.get(cur.id) || { balance: 0, currency: 'USD' };
          // Until the summary lands nothing here is known (Bankroll design 4): quiet blocks, never "All $0".
          const loading = !bk.summary;
          return (
            <label className={'bk-cell bk-pick' + (loading ? ' is-loading' : '')} aria-busy={loading ? 'true' : undefined}>
              <span className="bk-cell-name">{loading ? <Bone w={5} /> : cur.name}</span>
              <span className={'bk-cell-bal' + (loading ? '' : tone(bal.balance))}>{loading ? <Bone w={6} h={2} /> : money(bal.balance, bal.currency)}</span>
              <svg className="bk-pick-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
              {/* The native list (on a phone, the system picker), laid over the whole tile. */}
              <select className="bk-pick-select" aria-label="Bankroll" value={String(cur.id)}
                onChange={(e) => { const c = cells.find((x) => String(x.id) === e.target.value); if (c) bk.setSelected(c.id); }}>
                {cells.map((b) => {
                  const bb = balances.get(b.id) || { balance: 0, currency: 'USD' };
                  return <option key={b.id} value={String(b.id)}>{b.name} · {money(bb.balance, bb.currency)}</option>;
                })}
              </select>
            </label>
          );
        })()}
        <button type="button" className="bk-cell bk-act" onClick={onManage} title="Manage bankrolls">
          <span className="bk-act-label">Manage</span>
        </button>
        {add}
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
  // Phase 10: the WSOP fund (one per player, outside the roll) and its target.
  const [isFund, setIsFund] = useState(b.role === 'fund');
  const [target, setTarget] = useState(b.target_amount == null ? '' : String(b.target_amount));
  const [targetDate, setTargetDate] = useState(b.target_date || '');
  const [inRoll, setInRoll] = useState(b.in_roll !== 0);
  const run = async (fn, ok) => { try { await fn(); if (ok) toast.success(ok); onDone(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="bk-editor">
      <p className="bk-line">
        Start {money(bal.start, bal.currency)} · Moved {signed(bal.adjustments, bal.currency)} · Results {signed(bal.results, bal.currency)}
      </p>
      <SetBalance b={b} bal={bal} bk={bk} toast={toast} onDone={onDone} />
      {b.is_main ? (
        <p className="bk-line bk-muted">Main holds every result not filed under another bankroll.</p>
      ) : (
        <>
          <div className="bk-fields">
            <Field label="Name" wide><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Starting balance"><MoneyField value={start} allowNegative onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Currency">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Role">
              <select value={isFund ? 'fund' : inRoll ? 'roll' : 'aside'} onChange={(e) => { setIsFund(e.target.value === 'fund'); setInRoll(e.target.value === 'roll'); }}>
                <option value="roll">Part of the roll</option>
                <option value="aside">Set aside (not in the roll)</option>
                <option value="fund">The WSOP fund</option>
              </select>
            </Field>
            {isFund && <Field label="Target"><MoneyField value={target} onChange={(e) => setTarget(e.target.value)} placeholder="65000" /></Field>}
            {isFund && <Field label="By"><input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></Field>}
          </div>
          <div className="bk-actions">
            <Btn kind="brand" onClick={() => run(() => bk.update(b.id, { name, startingBalance: Number(start) || 0, currency, role: isFund ? 'fund' : null, inRoll: isFund ? false : inRoll, targetAmount: isFund && target !== '' ? Number(target) : null, targetDate: isFund && targetDate ? targetDate : null }), 'Saved')}>Save</Btn>
            <Btn onClick={() => run(() => bk.update(b.id, { archived: !b.archived }), b.archived ? 'Restored' : 'Archived')}>{b.archived ? 'Restore' : 'Archive'}</Btn>
            <Btn kind="danger" disabled={b.entry_count > 0 || b.adjustment_count > 0 || b.transaction_count > 0}
              title={b.entry_count || b.adjustment_count || b.transaction_count ? 'Has results or transactions: archive it instead' : undefined}
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
        <Field label="Starting balance"><MoneyField value={start} allowNegative placeholder="0" onChange={(e) => setStart(e.target.value)} /></Field>
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
          {/* The sign and the currency in the field (Bankroll design 35): a deposit in, a withdrawal out, a
              transfer the currency alone. */}
          <MoneyField value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value)}
            mark={(() => {
              const c = CURRENCY_CONFIG[kind === 'transfer' ? cur(from) : cur(target)] || CURRENCY_CONFIG.USD;
              return kind === 'transfer' ? { text: c.symbol, tone: null }
                : { text: (kind === 'deposit' ? '+' : '−') + c.symbol, tone: kind === 'deposit' ? 'pos' : 'neg' };
            })()} />
        </Field>
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {cross && (
          <Field label={`Received (${cur(to)})`}>
            <MoneyField value={toAmount} placeholder="0" onChange={(e) => setToAmount(e.target.value)} />
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

const KIND_LABEL = {
  deposit: 'Deposit', withdrawal: 'Withdrawal', transfer_in: 'Transfer in', transfer_out: 'Transfer out',
  correction: 'Correction', settlement: 'Paid to backers',
};

/** The history's moves (Bankroll design 31): the two halves of a transfer (one transfer_id) are one move;
 *  a half whose partner is not in the list stays a row of its own. Grouped by month, in the list's order. */
export function ledgerMoves(rows) {
  const moves = [];
  const byT = new Map();
  for (const a of rows || []) {
    if (a.transfer_id) {
      let m = byT.get(a.transfer_id);
      if (!m) { m = { key: 't' + a.transfer_id, date: a.occurred_on, note: a.note || '', parts: [] }; byT.set(a.transfer_id, m); moves.push(m); }
      m.parts.push(a);
      if (!m.note && a.note) m.note = a.note;
    } else moves.push({ key: 'a' + a.id, date: a.occurred_on, note: a.note || '', parts: [a] });
  }
  const months = [];
  for (const m of moves) {
    const k = String(m.date || '').slice(0, 7);
    let g = months[months.length - 1];
    if (!g || g.key !== k) { g = { key: k, moves: [] }; months.push(g); }
    g.moves.push(m);
  }
  return months;
}
const MONTH_CAPS = (k) => { const [y, m] = String(k).split('-').map(Number); return y && m ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Undated'; };

function Ledger({ bk, rows, toast, onChanged }) {
  /* No one-tap delete (UX pick 78): a tap opens the row, and Delete is there, in the danger colour.
     One row per move, by month, in a neutral tone (Bankroll design 31): a transfer is one move between two
     bankrolls ("Main → WSOP fund"), its amount unsigned and quiet; a deposit or a withdrawal carries its sign
     in bold --text. No green or red here: a transfer or a withdrawal is not a loss. */
  const [openKey, setOpenKey] = useState(null);
  const nameOf = (id) => (bk.bankrolls.find((b) => b.id === entryBankrollKey({ bankroll_id: id })) || { name: '?' }).name;
  const curOf = (id) => (bk.bankrolls.find((b) => b.id === entryBankrollKey({ bankroll_id: id })) || { currency: 'USD' }).currency;
  const months = useMemo(() => ledgerMoves(rows), [rows]);
  const describe = (m) => {
    if (m.parts.length === 2) {
      const out = m.parts.find((p) => p.amount < 0) || m.parts[0];
      const inn = m.parts.find((p) => p !== out) || m.parts[1];
      return { what: `${nameOf(out.bankroll_id)} \u2192 ${nameOf(inn.bankroll_id)}`, amt: money(Math.abs(out.amount), curOf(out.bankroll_id)), quiet: true };
    }
    const a = m.parts[0];
    const verb = a.kind === 'deposit' ? `Deposit to ${nameOf(a.bankroll_id)}` : a.kind === 'withdrawal' ? `Withdrawal from ${nameOf(a.bankroll_id)}`
      : `${KIND_LABEL[a.kind] || a.kind} · ${nameOf(a.bankroll_id)}`;
    return { what: verb, amt: signed(a.amount, curOf(a.bankroll_id)), quiet: false };
  };
  return (
    <section className="bk-section">
      <h3 className="bk-section-title">History</h3>
      {rows.length === 0 ? <p className="bk-line bk-muted">No deposits, withdrawals or transfers yet.</p> : months.map((g) => (
        <React.Fragment key={g.key}>
          <div className="bk-ledger-month">{MONTH_CAPS(g.key)}</div>
          {g.moves.map((m) => {
            const d = describe(m);
            const open = openKey === m.key;
            const transfer = m.parts.some((p) => p.transfer_id);
            return (
              <React.Fragment key={m.key}>
                <div className={'bk-ledger-row is-move' + (open ? ' is-open' : '')} role="button" tabIndex={0} aria-expanded={open}
                  onClick={() => setOpenKey(open ? null : m.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenKey(open ? null : m.key); } }}>
                  <span className="bk-ledger-date">{shortDay(m.date) || m.date}</span>
                  <span className="bk-ledger-lines">
                    <span className="bk-ledger-what">{d.what}</span>
                    <span className="bk-ledger-note">{m.note}</span>
                  </span>
                  <span className={'bk-ledger-amt' + (d.quiet ? ' is-quiet' : '')}>{d.amt}</span>
                  <span className="bk-ledger-chev" aria-hidden="true">{open ? '\u2304' : '\u203A'}</span>
                </div>
                {open && (
                  <div className="bk-ledger-open">
                    <button type="button" className="bk-btn" onClick={() => setOpenKey(null)}><span>Keep</span></button>
                    <button type="button" className="bk-btn bk-danger"
                      onClick={async () => { try { await bk.removeAdjustment(m.parts[0].id); setOpenKey(null); onChanged(); toast.success(transfer ? 'Transfer deleted, both sides' : 'Deleted'); } catch (e) { toast.error(e.message); } }}>
                      <span>{transfer ? 'Delete transfer (both sides)' : 'Delete'}</span>
                    </button>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </React.Fragment>
      ))}
    </section>
  );
}

/** Set balance (owner, 2026-10-20: "need to be able to reset Main bankroll"): type what the bankroll
 *  actually holds and the difference is recorded as a deposit or a withdrawal dated today, noted "Balance
 *  reset". Results and history stay as they are, and a deposit or withdrawal moves the balance without
 *  being profit. Works for Main, which has no row of its own to edit. */
function SetBalance({ b, bal, bk, toast, onDone }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const target = Number(value);
    if (value === '' || !Number.isFinite(target)) { toast.error('Type the balance it should show'); return; }
    const diff = Math.round((target - (Number(bal.balance) || 0)) * 100) / 100;
    if (diff === 0) { toast.info('It already shows that balance'); return; }
    const kind = diff > 0 ? 'deposit' : 'withdrawal';
    const ok = window.confirm(`Set ${b.name} to ${money(target, bal.currency)}? This records a ${kind} of ${money(Math.abs(diff), bal.currency)} today. Results are not changed.`);
    if (!ok) return;
    setBusy(true);
    try {
      await bk.adjust({ kind, amount: Math.abs(diff), bankroll: b.is_main ? 'main' : b.id, note: `Balance reset to ${money(target, bal.currency)}` });
      toast.success(`${b.name} set to ${money(target, bal.currency)}`);
      setValue('');
      onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="bk-fields bk-setbal">
      <Field label="Set balance to"><MoneyField value={value} allowNegative placeholder={String(Math.round(Number(bal.balance) || 0))} onChange={(e) => setValue(e.target.value)} /></Field>
      <div className="bk-actions"><Btn kind="brand" w={11} disabled={busy || value === ''} onClick={go}>Set balance</Btn></div>
    </div>
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
  // Grouped by role (Bankroll design 32): what counts toward the roll, what is set aside (the WSOP fund,
  // or a bankroll kept out of the roll), and the archived; the roll's total closes the first group.
  const inRoll = bk.visible.filter((b) => b.role !== 'fund' && b.in_roll !== 0);
  const aside = bk.visible.filter((b) => b.role === 'fund' || b.in_roll === 0);
  const balOf = (b) => balances.get(b.id) || { start: 0, adjustments: 0, results: 0, balance: 0, currency: b.currency };
  const rollTotal = (() => {
    const by = new Map();
    for (const b of inRoll) { const x = balOf(b); by.set(x.currency, (by.get(x.currency) || 0) + (Number(x.balance) || 0)); }
    return [...by].map(([c, v]) => money(v, c)).join(' · ');
  })();
  const metaOf = (b) => (b.role === 'fund'
    ? `The WSOP fund${b.target_amount ? ` · target ${money(b.target_amount, b.currency)}` : ''}${b.target_date ? ` by ${new Date(b.target_date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : ''}`
    : `${b.entry_count} result${b.entry_count === 1 ? '' : 's'} · ${b.currency}`);
  const row = (b) => {
    const bal = balOf(b);
    const isOpen = open === b.id;
    const button = (
      <button type="button" className={'bk-row bk-row-6' + (isOpen ? ' is-open' : '')} aria-expanded={isOpen}
        onClick={() => setOpen(isOpen ? null : b.id)}>
        <span className="bk-row-l">
          <span className="bk-row-name">{b.name}</span>
          <span className="bk-row-meta">{metaOf(b)}</span>
        </span>
        <span className={'bk-row-bal' + tone(bal.balance)}>{money(bal.balance, bal.currency)}</span>
      </button>
    );
    // The opened bankroll is one card with its editor (Bankroll design 33), so its fields plainly belong to it.
    return isOpen ? (
      <div key={b.id} className="bk-open-card">
        {button}
        <BankrollEditor b={b} bal={bal} bk={bk} toast={toast} onDone={() => { setOpen(null); loadLedger(); }} />
      </div>
    ) : <React.Fragment key={b.id}>{button}</React.Fragment>;
  };
  return createPortal(
    <div className="bk-scrim" onClick={onClose}>
      <div className="bk-sheet" role="dialog" aria-modal="true" aria-label="Bankrolls" onClick={(e) => e.stopPropagation()}>
        <div className="bk-sheet-head">
          <h2 className="bk-sheet-title">Bankrolls</h2>
          <Btn w={6} onClick={onClose}>Done</Btn>
        </div>
        <section className="bk-section">
          <div className="bk-group-head">In the roll</div>
          {inRoll.map(row)}
          <div className="bk-roll-total"><span>The roll</span><span>{rollTotal}</span></div>
          {aside.length > 0 && <div className="bk-group-head">Set aside</div>}
          {aside.map(row)}
          {archived.length > 0 && <div className="bk-group-head">Archived</div>}
          <div className="bk-archived">{archived.map(row)}</div>
        </section>
        <MoveMoney bk={bk} toast={toast} onMoved={loadLedger} />
        <NewBankroll bk={bk} toast={toast} />
        <Ledger bk={bk} rows={ledger} toast={toast} onChanged={loadLedger} />
      </div>
    </div>,
    document.body
  );
}
