import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { useHideBankrollFab } from '../hooks/useBankrollFab.js';
import { openInResults } from '../hooks/useResultsFocus.js';
import { BANKROLL_ALL } from '../utils/bankrolls.js';
import {
  fmtMoney, fmtDay, fmtWhen, resultWords, toneOf, plural, currentRuns, runLine, mergePatch, isEmptyPatch, applyPatch, fillLikely,
  pairOptions, pairFields, groupPlan, backerOptions, slateOptions, sourceLabel, optionWord, itemLine, commitReadiness,
  reconciliationBlocks, REC_LINES, REC_LISTS, writesList, editedRows, fetchError, commitError, undoError, diffPlans, pageOf, FIRST_ROWS,
} from '../utils/bankroll-import-dashboard.js';
import './analytics.css';
import './bankroll-locations.css';
import './bankroll-import-dashboard.css';

/**
 * Bankroll › Import › From the dashboard app (docs/bankroll-merge.md §9.3; the bankroll merge's
 * Phase 6) — the review of the dashboard import. OWNER ONLY: every route under
 * /api/bankrolls/import/dashboard answers 403 to anyone else, and on a 403 this section is not shown.
 *
 *   status    whether the pull is on (and why not), Fetch from the dashboard, the past runs
 *   review    a staged run's plan as a list grouped the way the plan groups it: the likely and
 *             possible duplicate pairs (both sides, the score and its reason, Same keep / Same take /
 *             Different, and "Fill the likely ones"), the backers (new or the staking backer it
 *             matches), the staking slate, the balances, what changed and what was deleted in the
 *             dashboard (a delta), the opening deposit (editable, owner answer Q3), the
 *             reconciliation (each pocket's "unexplained" must be 0), the errors and the flags
 *   commit    "Import N records", only with every pair answered and nothing blocking, behind a
 *             confirm step that names every table it writes; a 409 stale reloads the plan and
 *             highlights what moved (never a retry of the same hash)
 *   summary   a committed run: what was written, its reconciliation, and Undo behind a typed count;
 *             a 409 lists the rows edited since, each with where it lives
 *
 * Answers save as they are given (PUT /decisions), debounced, one write at a time; the group's head
 * says "Saving…" then "Saved". Nothing is written to the ledger before the commit (owner answer Q4).
 * The arithmetic and the wording live in utils/bankroll-import-dashboard.js (tested).
 *
 * Layout: 35g content, every box whole g by whole r, every baseline on an r line; controls are
 * whole-g boxes with centred labels. bankroll-import-dashboard.css lists every row.
 */

const SAVE_DELAY_MS = 600;
// The Results tab's panel is laid out (App hides every other tab's panel): only then can "Open in
// Results" land (BankrollSessions.jsx has the same test).
const resultsOnScreen = () => {
  const el = document.querySelector('.tab-panel[data-tab="tracking"]');
  return !!(el && el.getClientRects().length);
};
const tone = (v) => { const t = toneOf(v); return t ? ` an-${t}` : ''; };

function useApi(token) {
  return useCallback(async (method, path, body) => {
    try {
      const res = await fetch(`${API_URL}/bankrolls/import/dashboard${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    } catch (_) { return { status: 0, data: {} }; }
  }, [token]);
}

/** Ten rows, then fifty more a tap, then all; Show fewer goes back to ten (the Locations pager). */
function usePager(total) {
  const [shown, setShown] = useState(FIRST_ROWS);
  const pg = pageOf(shown, total);
  return { pg, more: () => pg.more && setShown(pg.more.next), fewer: () => setShown(FIRST_ROWS) };
}
function Pager({ pager, label }) {
  const { pg, more, fewer } = pager;
  if (!pg.more && !pg.fewer) return null;
  return (
    <div className="bl-pager bid-pager">
      {pg.more && <button type="button" className="bk-btn bl-more" onClick={more} aria-label={`${pg.more.label} ${label}`}><span>{pg.more.label}</span></button>}
      {pg.fewer && <button type="button" className="bk-btn bl-more bl-fewer" onClick={fewer}><span>Show fewer</span></button>}
      {pg.count && <span className="an-cell bl-count" aria-live="polite">{pg.count}</span>}
    </div>
  );
}

/** A group's head: its title, and at the right whether the answers given in it are saved. */
function GroupHead({ id, title, state, changed }) {
  return (
    <div className="bid-head">
      <h4 className="an-cell an-sec an-clip" id={id}>{title}</h4>
      <span className={'an-cell bid-state an-clip' + (state === 'error' ? ' is-err' : '')} aria-live="polite">
        {changed ? 'Changed' : state === 'saving' || state === 'pending' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved' : ''}
      </span>
    </div>
  );
}

/** Radio segments: one row of whole-g buttons; a two-line face (top over sub) when given. */
function Seg({ label, options, value, onChange, className = '' }) {
  return (
    <div className={'bid-seg ' + className} data-n={options.length} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          aria-disabled={o.disabled ? 'true' : undefined} title={o.disabled && o.why ? o.why : undefined}
          className={'bk-seg-btn' + (value === o.value ? ' is-on' : '') + (o.sub ? ' bid-opt' : '')}
          onClick={() => { if (!o.disabled) onChange(o.value); }}>
          {o.sub
            ? <span className="bid-opt-face"><span className="bid-opt-top">{o.top}</span><span className="bid-opt-sub">{o.sub}</span></span>
            : <span>{o.top}</span>}
        </button>
      ))}
    </div>
  );
}

// ── the duplicate pairs ─────────────────────────────────────────────────────────────────────
const KIND_WORD = { cash: 'Cash', tournament: 'Tournament', deposit: 'Deposit', withdrawal: 'Withdrawal', expense: 'Expense' };
function reasonOf(p) {
  const parts = p.parts || {};
  const bits = [];
  if (parts.date != null) bits.push(parts.date >= 3 ? 'same day' : parts.date > 0 ? 'a day apart' : 'dates apart');
  if (p.kind === 'cash' || p.kind === 'tournament') bits.push(parts.room >= 3 ? 'same room' : parts.room > 0 ? 'similar room' : parts.room < 0 ? 'another room' : 'room unknown');
  if (parts.amount != null) bits.push(parts.amount >= 3 ? 'same figures' : parts.amount > 0 ? 'close figures' : 'figures differ');
  if (parts.other > 0) bits.push(p.kind === 'cash' ? 'same length' : p.kind === 'tournament' ? 'similar event' : p.kind === 'expense' ? 'same category' : '');
  return bits.filter(Boolean).join(', ');
}
function PairCard({ p, onAnswer, changed }) {
  const [open, setOpen] = useState(false);
  const fields = pairFields(p);
  const opts = pairOptions(p);
  const take = opts.find((o) => o.value === 'same-take');
  const resultRow = (f) => f.key === 'result' || f.key === 'amount';
  return (
    <li className={'bid-card bid-pair' + (open ? ' is-open' : '') + (changed ? ' is-changed' : '')}>
      <div className="bid-pair-head">
        <span className="an-cell bid-pair-date an-clip">{fmtDay(p.dash.date)}<span className="bid-pair-kind"> · {KIND_WORD[p.kind] || p.kind}{changed ? ' · changed' : ''}</span></span>
        <span className={'bid-pill snap-g' + (p.class === 'likely' ? ' is-likely' : '')}>{p.class === 'likely' ? 'Likely' : 'Possible'} · {p.score}</span>
      </div>
      <p className="an-cell an-note bid-reason an-clip" title={reasonOf(p)}>{reasonOf(p)}</p>
      <div className="bid-pair-cols" aria-hidden="true">
        <span className="an-cell an-lbl an-lbl-3">Dashboard</span>
        <span className="an-cell an-lbl an-lbl-3">futurega.me</span>
      </div>
      {/* The fields: tap to show long values whole (the full value is in each cell's title too). */}
      <div className="bid-pair-fields" onClick={() => setOpen((v) => !v)}>
        {fields.map((f) => (
          <div key={f.key} className="bid-pair-row" role="group" aria-label={`${f.label}: dashboard ${f.dash}, futurega.me ${f.here}${f.same ? ', the same' : ''}`}>
            <span className={'an-cell bid-v an-clip' + (resultRow(f) ? ' bid-v-money' : '') + (f.dashTone ? ' an-' + f.dashTone : '')} title={f.dash} aria-hidden="true">{f.dash}</span>
            <span className="an-cell bid-eq" aria-hidden="true">{f.same ? '=' : ''}</span>
            <span className={'an-cell bid-v an-clip' + (resultRow(f) ? ' bid-v-money' : '') + (f.hereTone ? ' an-' + f.hereTone : '')} title={f.here} aria-hidden="true">{f.here}</span>
          </div>
        ))}
      </div>
      <Seg className="bid-pair-seg" label={`The ${fmtDay(p.dash.date)} pair`} options={opts} value={p.decision} onChange={(v) => onAnswer(p.id, v)} />
      {take.disabled && <p className="an-p bid-card-note">Take is off for this pair: {take.why}.</p>}
    </li>
  );
}
function PairsGroup({ g, onAnswer, onFill, state, highlight }) {
  const pager = usePager(g.list.length);
  if (!g.list.length) return null;
  const left = g.list.length - g.answered;
  return (
    <section className="bid-group" aria-labelledby="bid-g-pairs">
      <GroupHead id="bid-g-pairs" title={`Likely duplicates (${g.list.length})`} state={state} />
      <p className="an-p">
        A night logged in both apps. <strong>Same, keep futurega.me&rsquo;s</strong> links the two and writes no money;
        {' '}<strong>take the dashboard&rsquo;s</strong> also changes this app&rsquo;s figures to the dashboard&rsquo;s;
        {' '}<strong>Different</strong> imports the dashboard&rsquo;s as another night. {left ? `${plural(left, 'pair')} left to answer.` : 'Every pair is answered.'}
      </p>
      <div className="bd-actions">
        <button type="button" className="bk-btn bid-w17" disabled={!g.fillable} onClick={onFill}>
          <span>{g.fillable ? `Fill the likely ones (${g.fillable})` : 'Likely ones filled'}</span>
        </button>
      </div>
      <p className="an-p">Fills each unanswered Likely pair with Same, keep futurega.me&rsquo;s, for you to check. Possible pairs always need their own answer.</p>
      <ul className="bid-cards">
        {g.list.slice(0, pager.pg.rows).map((p) => <PairCard key={p.id} p={p} onAnswer={onAnswer} changed={highlight.has('pair:' + p.id)} />)}
      </ul>
      <Pager pager={pager} label="pairs" />
    </section>
  );
}

// ── backers ─────────────────────────────────────────────────────────────────────────────────
function deliveryWord(d) {
  if (!d) return 'no delivery';
  const on = [d.sms && 'SMS', d.email && 'Email'].filter(Boolean);
  return on.length ? on.join(' + ') : 'no delivery';
}
function BackerCard({ b, onAnswer, changed }) {
  const id = useId();
  const o = backerOptions(b);
  const stats = [b.stakes || 'no stakes', `opening ${fmtMoney((b.openingCents || 0) / 100, { sign: true })}`, deliveryWord(b.delivery)];
  return (
    <li className={'bid-card bid-backer' + (changed ? ' is-changed' : '')}>
      <div className="bid-backer-head">
        <span className="an-cell bl-name an-clip" title={b.name || 'Backer'}>{b.name || 'Backer'}</span>
        <span className="an-cell bid-token an-clip" title="The link's last characters">{b.token}</span>
      </div>
      <span className="an-cell bl-meta an-clip">{sourceLabel(b.source)} · agreement {b.agreement || 'none'}{changed ? ' · changed' : ''}</span>
      <span className="an-cell bl-stats bid-backer-stats an-clip" title={stats.join(' • ')}>
        {stats.map((s, i) => <React.Fragment key={i}>{i > 0 && <span className="bl-sep" aria-hidden="true">{' • '}</span>}{s}</React.Fragment>)}
      </span>
      {b.status === 'error' ? (
        <p className="an-p bid-card-note"><strong>Not imported:</strong> {b.error}.</p>
      ) : o.options.length < 2 ? (
        <p className="an-p bid-card-note">Imports as a new staking backer: none of yours has this name.</p>
      ) : o.locked ? (
        <p className="an-p bid-card-note">This link already belongs to one of your staking backers, so it imports onto that backer.</p>
      ) : (
        <div className="bk-fields bid-card-fields">
          <label className="bk-field is-wide" htmlFor={id}>
            <span className="bk-field-label">Import as</span>
            <select id={id} value={o.value} onChange={(e) => onAnswer(b.fp, e.target.value === 'new' ? 'new' : Number(e.target.value))}>
              {o.options.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </label>
        </div>
      )}
    </li>
  );
}
function BackersGroup({ g, onAnswer, state, highlight }) {
  const list = [...g.review, ...g.other.filter((b) => b.status === 'error')];
  const pager = usePager(list.length);
  if (!list.length) return null;
  return (
    <section className="bid-group" aria-labelledby="bid-g-backers">
      <GroupHead id="bid-g-backers" title={`Backers (${list.length})`} state={state} />
      <p className="an-p">
        Each dashboard backer becomes a staking backer here with a standing agreement, its stakes and its opening, and
        keeps its link, so its page keeps working. Pick an existing staking backer where it is the same person.
      </p>
      <ul className="bid-cards">
        {list.slice(0, pager.pg.rows).map((b) => <BackerCard key={b.fp} b={b} onAnswer={onAnswer} changed={highlight.has('backer:' + b.fp)} />)}
      </ul>
      <Pager pager={pager} label="backers" />
    </section>
  );
}

// ── the slate and the balances ──────────────────────────────────────────────────────────────
function SlateGroup({ plan, onAnswer, state, highlight }) {
  const s = plan.slate || { deals: [], backers: [], unlinkedSettlements: [] };
  const pager = usePager(s.deals.length);
  const ids = useId();
  if (!s.deals.length && !s.backers.length) return null;
  return (
    <section className="bid-group" aria-labelledby="bid-g-slate">
      <GroupHead id="bid-g-slate" title={`Staking slate (${s.deals.length})`} state={state} />
      <p className="an-p">The dashboard&rsquo;s slate becomes a staking series per event, with an agreement for each deal.</p>
      <ul className="bid-rows">
        {s.deals.slice(0, pager.pg.rows).map((d) => (
          <li key={d.fp} className={'bid-row2' + (highlight.has('deal:' + d.fp) ? ' is-changed' : '')}>
            <span className="an-cell an-td an-clip" title={d.event}>{d.event}</span>
            <span className="an-cell an-td an-num an-clip">{d.pctSold}% at {d.markup}</span>
            <span className="an-cell an-td an-num an-clip">{fmtMoney(d.buyIn)}</span>
            <span className="an-cell an-note an-clip" title={d.backer || 'No backer named'}>{d.backer || 'No backer named'}</span>
            <span className="an-cell an-note bid-row2-wide an-clip">
              {highlight.has('deal:' + d.fp) ? 'changed · ' : ''}{d.status !== 'new' && d.status !== 'reimport' ? `${d.status} · ` : ''}
              {d.settled ? (d.settlement ? `settled ${fmtDay(d.settlement.date)}, ${fmtMoney(d.settlement.amount, { sign: true })}` : 'settled, no matching settlement') : 'open'}
            </span>
          </li>
        ))}
      </ul>
      <Pager pager={pager} label="deals" />
      {s.backers.length > 0 && (
        <div className="bk-fields bd-fields bd-block">
          {s.backers.map((sb, i) => {
            const o = slateOptions(sb, plan);
            return (
              <label key={sb.key} className={'bk-field' + (highlight.has('slate:' + sb.key) ? ' is-changed' : '')} htmlFor={`${ids}-${i}`}>
                <span className="bk-field-label" title={sb.name}>{sb.name}{highlight.has('slate:' + sb.key) ? ' · changed' : ''}</span>
                <select id={`${ids}-${i}`} value={o.value} onChange={(e) => onAnswer(sb.key, e.target.value)}>
                  {o.options.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}
      {s.unlinkedSettlements.length > 0 && (
        <p className="an-p">
          {plural(s.unlinkedSettlements.length, 'settlement')} in the dashboard name{s.unlinkedSettlements.length === 1 ? 's' : ''} no deal on the slate:
          {' '}{s.unlinkedSettlements.map((u) => `${fmtDay(u.date)} ${fmtMoney(u.amount, { sign: true })}`).join('; ')}. They import as payments to backers, unlinked.
        </p>
      )}
    </section>
  );
}
function BalancesGroup({ plan, highlight }) {
  const list = plan.balances || [];
  const pager = usePager(list.length);
  if (!list.length) return null;
  return (
    <section className="bid-group" aria-labelledby="bid-g-bal">
      <GroupHead id="bid-g-bal" title={`Where the money is (${list.length})`} />
      <ul className="bid-rows">
        {list.slice(0, pager.pg.rows).map((b) => (
          <li key={b.fp} className={'bid-row1' + (highlight.has('balance:' + b.fp) ? ' is-changed' : '')}>
            <span className="an-cell an-td an-clip" title={b.name}>{b.name}</span>
            <span className="an-cell an-td an-num an-clip">{highlight.has('balance:' + b.fp) ? 'changed' : b.status === 'new' || b.status === 'reimport' ? 'new' : b.status}</span>
            <span className="an-cell an-td an-num an-clip">{fmtMoney(b.amount)}</span>
          </li>
        ))}
      </ul>
      <Pager pager={pager} label="balances" />
    </section>
  );
}

// ── a delta: changed and deleted in the dashboard ───────────────────────────────────────────
function ItemCard({ c, kind, onAnswer, changed }) {
  const line = itemLine(c);
  const value = c.decision || c.default;
  const note = [c.conflict ? 'Edited here as well since the import: keeping yours is the default.' : null, c.why ? `Only "keep": ${c.why}.` : null].filter(Boolean).join(' ');
  return (
    <li className={'bid-card bid-item' + (changed ? ' is-changed' : '')}>
      <div className="bid-item-head">
        <span className="an-cell an-td bid-item-title an-clip" title={line.title}>{line.title}</span>
        <span className="an-cell an-td an-num an-clip" title={line.detail}>{line.detail}</span>
      </div>
      <span className="an-cell an-note an-clip">{kind === 'change' ? 'Changed in the dashboard' : 'Deleted in the dashboard'}{c.decision ? '' : ` · default: ${optionWord(c.default).toLowerCase()}`}{changed ? ' · changed' : ''}</span>
      {note && <p className="an-p bid-card-note">{note}</p>}
      <Seg className="bid-item-seg" label={line.title} options={c.options.map((o) => ({ value: o, top: optionWord(o) }))} value={value} onChange={(v) => onAnswer(c.itemId, v)} />
    </li>
  );
}
function ItemsGroup({ groups, kind, onAnswer, state, highlight }) {
  const all = groups.flatMap((g) => g.items.map((c) => ({ ...c, group: g.label })));
  const pager = usePager(all.length);
  if (!all.length) return null;
  const id = kind === 'change' ? 'bid-g-changes' : 'bid-g-deletions';
  return (
    <section className="bid-group" aria-labelledby={id}>
      <GroupHead id={id} title={`${kind === 'change' ? 'Changed' : 'Deleted'} in the dashboard (${all.length})`} state={state} />
      <p className="an-p">
        {kind === 'change'
          ? 'Records the dashboard has edited since the last import. Apply takes the dashboard’s version; Keep mine leaves this app’s.'
          : 'Records the dashboard has deleted since the last import. Remove deletes this app’s copy; Keep mine leaves it; a backer’s agreement can be ended instead.'}
        {' '}{groups.map((g) => `${g.label} ${g.items.length}`).join(', ')}.
      </p>
      <ul className="bid-cards">
        {all.slice(0, pager.pg.rows).map((c) => <ItemCard key={c.itemId} c={c} kind={kind} onAnswer={onAnswer} changed={highlight.has(`${kind}:${c.itemId}`)} />)}
      </ul>
      <Pager pager={pager} label={kind === 'change' ? 'changes' : 'deletions'} />
    </section>
  );
}

// ── the opening deposit (Q3: computed, editable) ────────────────────────────────────────────
function OpeningGroup({ opening, target, onAnswer, state, changed }) {
  const ids = useId();
  const [amount, setAmount] = useState(String(opening.amount));
  const [date, setDate] = useState(opening.date);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) { setAmount(String(opening.amount)); setDate(opening.date); } }, [opening.amount, opening.date]);
  const c = opening.computed;
  const send = (a, d) => {
    const n = a.trim() === '' ? null : Number(a);
    if (n != null && !Number.isFinite(n)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    onAnswer({ amount: n, date: d });
  };
  const parts = c.parts || { starts: 0, moved: 0, results: 0 };
  return (
    <section className="bid-group" aria-labelledby="bid-g-open">
      <GroupHead id="bid-g-open" title="The opening deposit" state={state} changed={changed} />
      <p className="an-p">
        One {opening.kind || 'entry'} of <strong>{fmtMoney(opening.amount, { sign: true })}</strong> in {target} on <strong>{fmtDay(opening.date)}</strong>
        {opening.override ? ' (your figure)' : ''}, so the roll on the dashboard&rsquo;s first day equals its starting roll.
      </p>
      <div className="bk-fields bd-fields bd-block">
        <label className="bk-field" htmlFor={`${ids}-a`}>
          <span className="bk-field-label">Amount (USD)</span>
          <input id={`${ids}-a`} type="number" inputMode="decimal" step="1" value={amount}
            onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }}
            onChange={(e) => { setAmount(e.target.value); send(e.target.value, date); }} />
        </label>
        <label className="bk-field" htmlFor={`${ids}-d`}>
          <span className="bk-field-label">Date</span>
          <input id={`${ids}-d`} type="date" value={date}
            onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }}
            onChange={(e) => { setDate(e.target.value); send(amount, e.target.value); }} />
        </label>
      </div>
      {opening.override && (
        <div className="bd-actions">
          <button type="button" className="bk-btn bid-w17" onClick={() => { focused.current = false; onAnswer(null); }}><span>Use the computed figure</span></button>
        </div>
      )}
      <p className="an-p bid-formula">
        The formula: the dashboard&rsquo;s starting roll, <strong>{fmtMoney(c.startingRoll)}</strong>, less what your roll
        bankrolls held before {fmtDay(c.date)}, <strong>{fmtMoney(c.priorBalance)}</strong> (starting balances {fmtMoney(parts.starts)},
        deposits and transfers {fmtMoney(parts.moved, { sign: true })}, results {fmtMoney(parts.results, { sign: true })}),
        is <strong>{fmtMoney(c.amount, { sign: true })}</strong>, dated on the dashboard&rsquo;s first record. It is written in whole
        dollars; the cents join the rounding correction. Anything you had already recorded here before that day is absorbed, not doubled.
      </p>
    </section>
  );
}

// ── the reconciliation ──────────────────────────────────────────────────────────────────────
function RecList({ name, title, items }) {
  const pager = usePager(items.length);
  if (!items.length) return null;
  return (
    <div className="bid-reclist">
      <div className="an-cell an-lbl an-lbl-3">{title} ({items.length})</div>
      <ul className="bid-rows">
        {items.slice(0, pager.pg.rows).map((x, i) => (
          <li key={`${name}-${i}`} className="bid-row1 bid-row-dated">
            <span className="an-cell bl-res-date an-clip">{x.date ? fmtDay(x.date) : '—'}</span>
            <span className="an-cell an-td an-clip" title={`${x.label || x.fp || ''}${x.side === 'fund' ? ' (fund)' : ''}`}>{x.label || x.fp}{x.side === 'fund' ? ' (fund)' : ''}</span>
            <span className={'an-cell an-td an-num bl-res-amt an-clip' + tone(x.amount)}>{fmtMoney(x.amount, { sign: true })}</span>
          </li>
        ))}
      </ul>
      <Pager pager={pager} label={title.toLowerCase()} />
    </div>
  );
}
function Reconciliation({ rec, title = 'The reconciliation', changed, after = 'After the import' }) {
  if (!rec) return null;
  const blocks = reconciliationBlocks(rec);
  const row = (label, roll, fund, cls = '') => (
    <div className={'an-row is-body bid-cols-rec' + cls} role="row">
      <span className="an-cell an-td an-clip" role="cell">{label}</span>
      <span className={'an-cell an-td an-num an-clip' + (cls.includes('is-line') ? tone(roll) : '')} role="cell">{roll == null ? '—' : fmtMoney(roll, { sign: cls.includes('is-line') })}</span>
      <span className={'an-cell an-td an-num an-clip' + (cls.includes('is-line') ? tone(fund) : '')} role="cell">{fund == null ? '—' : fmtMoney(fund, { sign: cls.includes('is-line') })}</span>
    </div>
  );
  const L = rec.lines || { roll: {}, fund: {} };
  return (
    <section className="bid-group" aria-labelledby="bid-g-rec">
      <GroupHead id="bid-g-rec" title={title} changed={changed} />
      {blocks && (
        <div className="bid-warn" role="alert">
          <p className="an-p"><strong>This does not balance, so nothing can be imported.</strong> Every dollar on both sides should
            fall on one of the lines below; {fmtMoney(rec.unexplained.roll)} on the roll and {fmtMoney(rec.unexplained.fund)} on the fund
            do not{rec.fundWithinRemainder === false ? ', and the fund is not within its rounding remainder' : ''}. Fetch again; if it stays, the import needs a fix before it runs.</p>
        </div>
      )}
      <div className="an-table" role="table" aria-label="The roll and the fund, the dashboard's against this app's">
        <div className="an-row is-head bid-cols-rec" role="row">
          <span className="an-cell an-lbl an-lbl-3b" role="columnheader">&nbsp;</span>
          <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">Roll</span>
          <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">Fund</span>
        </div>
        {row('The dashboard', rec.dashboard.roll, rec.dashboard.fund)}
        {rec.before && row('Here now', rec.before.roll, rec.before.fund)}
        {row(after, rec.after.roll, rec.after.fund, ' is-clear')}
        {row('Difference', L.roll.difference, L.fund.difference, ' is-line is-clear')}
        {REC_LINES.map(([k, label]) => ((L.roll[k] || L.fund[k]) ? <React.Fragment key={k}>{row(label, L.roll[k] || 0, L.fund[k] || 0, ' is-line is-small')}</React.Fragment> : null))}
        {row('Unexplained (must be $0)', rec.unexplained.roll, rec.unexplained.fund, ' is-line is-clear' + (blocks ? ' is-bad' : ''))}
      </div>
      <p className="an-p">
        {rec.fundWithinRemainder ? 'The fund matches the dashboard’s within its rounding remainder.' : 'The fund does not match within its rounding remainder.'}
        {rec.provisional ? ` Until every pair is answered, this counts them as ${rec.assumes ? rec.assumes.replace(/^unanswered pairs counted as /, '') : 'the same night'}.` : ''}
        {' '}The figures after the import are a real commit run and rolled back, so they are what an import writes.
      </p>
      {REC_LISTS.map(([k, label]) => <RecList key={k} name={k} title={label} items={(rec.lists && rec.lists[k]) || []} />)}
    </section>
  );
}

// ── errors, flags and information ───────────────────────────────────────────────────────────
function ErrorsGroup({ errors, changed }) {
  const pager = usePager(errors.length);
  if (!errors.length) return null;
  return (
    <section className="bid-group" aria-labelledby="bid-g-err">
      <GroupHead id="bid-g-err" title={`Not imported (${errors.length})`} changed={changed} />
      <p className="an-p">Records that fail a check are skipped and listed here; nothing is written for them. Fix one in the dashboard and fetch again to bring it in.</p>
      <ul className="bid-rows">
        {errors.slice(0, pager.pg.rows).map((e, i) => (
          <li key={`${e.fp || e.store}-${i}`} className="bid-row2">
            <span className="an-cell an-td an-clip">{e.date ? fmtDay(e.date) : '—'}</span>
            <span className="an-cell an-td bid-row2-span an-clip" title={`${e.store} ${e.id || ''}`}>{e.store}{e.id ? ` · ${e.id}` : ''}</span>
            <span className="an-cell an-note bid-row2-full an-clip" title={e.error}>{e.skipped ? 'Skipped: ' : 'Error: '}{e.error}</span>
          </li>
        ))}
      </ul>
      <Pager pager={pager} label="errors" />
    </section>
  );
}
function InfoGroup({ info }) {
  const f = info.flags;
  const lines = [];
  if (f.signs.length) lines.push(`${plural(f.signs.length, 'sign')} turned as the dashboard counted ${f.signs.length === 1 ? 'it' : 'them'}: ${f.signs.map((s) => s.note).join(' ')}`);
  if (f.otherExpenses.count) lines.push(`${plural(f.otherExpenses.count, 'expense')} filed as "other", ${fmtMoney(f.otherExpenses.total)} in all; they are listed in the tax report under other.`);
  if (f.onlineRoomsUnknown.length) lines.push(`Online rooms the classifier does not know yet: ${f.onlineRoomsUnknown.join(', ')}. Their sessions are marked online anyway.`);
  if (info.inside.length) lines.push(`${plural(info.inside.length, 'pair')} of dashboard nights look like the same night (${info.inside.map((x) => `${fmtDay(x.date)} ${x.room}`).join('; ')}). Both import, as the dashboard’s roll counted both.`);
  if (info.divergences.length) lines.push(`${plural(info.divergences.length, 'recorded share')} no longer match${info.divergences.length === 1 ? 'es' : ''} the session as it is now (edited after the notify). The backer keeps what they were told.`);
  if (info.consistency && (info.consistency.notifiedWithoutEvent.length || info.consistency.eventWithoutNotified.length)) {
    lines.push(`Notify records out of step: ${info.consistency.notifiedWithoutEvent.length} notified with no share, ${info.consistency.eventWithoutNotified.length} shares not in the notified list. For information only.`);
  }
  if (info.settings && info.settings.change) lines.push(info.settings.change.note);
  const rows = f.rows || [];
  const pager = usePager(rows.length);
  if (!lines.length && !rows.length) return null;
  return (
    <section className="bid-group" aria-labelledby="bid-g-info">
      <GroupHead id="bid-g-info" title="For your information" />
      {lines.map((t, i) => <p key={i} className="an-p">{t}</p>)}
      {rows.length > 0 && (
        <>
          <div className="an-cell an-lbl an-lbl-3">Notes on single records ({rows.length})</div>
          <ul className="bid-rows">
            {rows.slice(0, pager.pg.rows).map((r, i) => (
              <li key={i} className="bid-row1 bid-row-note">
                <span className="an-cell an-td an-clip" title={`${r.store || ''} ${r.id || ''}`}>{r.id || r.store || '—'}</span>
                <span className="an-cell an-note bd-note-4 an-clip" title={r.flag}>{r.flag}</span>
              </li>
            ))}
          </ul>
          <Pager pager={pager} label="notes" />
        </>
      )}
    </section>
  );
}

// ── what a commit writes, and what it wrote ────────────────────────────────────────────────
function WritesTable({ tables, label }) {
  const w = writesList(tables);
  const block = (title, list) => (list.length ? (
    <div className="an-table" role="table" aria-label={`${label}: ${title}`}>
      <div className="an-row is-head bid-cols-w" role="row">
        <span className="an-cell an-lbl an-lbl-3b" role="columnheader">{title}</span>
        <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">Rows</span>
      </div>
      {list.map((x) => (
        <div key={x.table} className="an-row is-body bid-cols-w" role="row">
          <span className="an-cell an-td an-clip" role="cell">{x.text.replace(/^[\d,]+ /, '').replace(/^./, (ch) => ch.toUpperCase())}</span>
          <span className="an-cell an-td an-num" role="cell">{x.n.toLocaleString('en-US')}</span>
        </div>
      ))}
    </div>
  ) : null);
  return <>{block('Creates', w.insert)}{block('Changes', w.update)}{block('Removes', w.delete)}</>;
}

function CommitBlock({ view, ready, pending, busy, confirm, setConfirm, onCommit, onDiscard, msg }) {
  const id = useId();
  const confirmRef = useRef(null);
  useLayoutEffect(() => { if (confirm && confirmRef.current) confirmRef.current.focus({ preventScroll: false }); }, [confirm]);
  const label = pending ? 'Saving answers…' : ready.label;
  return (
    <section className="bid-group bid-commit" aria-labelledby={`${id}-t`}>
      <GroupHead id={`${id}-t`} title="Import" state={pending ? 'saving' : ''} />
      {ready.reasons.map((r, i) => <p key={i} className="an-p bid-reason-line" id={i === 0 ? `${id}-why` : undefined}><strong>{r}</strong></p>)}
      {msg && <p className={'an-p' + (msg.kind === 'stale' ? ' bid-alert' : '')} role="alert"><strong>{msg.text}</strong></p>}
      {confirm !== 'commit' && confirm !== 'discard' && (
        <div className="bd-actions">
          <button type="button" className="bk-btn bk-btn--brand bid-w17" aria-disabled={!ready.ok || busy ? 'true' : undefined}
            aria-describedby={ready.reasons.length ? `${id}-why` : undefined}
            onClick={() => { if (ready.ok && !busy) setConfirm('commit'); }}><span>{label}</span></button>
          <button type="button" className="bk-btn bk-w8" disabled={!!busy} onClick={() => setConfirm('discard')}><span>Discard</span></button>
        </div>
      )}
      {confirm === 'commit' && (
        <div className="bid-confirm" role="group" aria-labelledby={`${id}-c`}>
          <h5 className="an-cell an-sec" id={`${id}-c`} tabIndex={-1} ref={confirmRef}>Import these records?</h5>
          <p className="an-p">
            One write, in one go. It creates <strong>{plural(view.writes.rows, 'row')}</strong>
            {view.writes.same ? `, links ${plural(view.writes.same, 'pair')} as the same night` : ''}
            {view.writes.taken ? ` (${view.writes.taken} taking the dashboard’s figures)` : ''}
            {view.writes.fundCreated ? ', and creates the WSOP fund' : ''}. Undo stays available: it removes exactly these rows and puts back what it changed.
          </p>
          <WritesTable tables={view.writes.tables} label="What the import writes" />
          <div className="bd-actions">
            <button type="button" className="bk-btn bk-btn--brand bid-w17" disabled={!!busy || !ready.ok} onClick={onCommit}><span>{busy === 'commit' ? 'Importing…' : ready.label}</span></button>
            <button type="button" className="bk-btn bk-w8" disabled={!!busy} onClick={() => setConfirm(null)}><span>Cancel</span></button>
          </div>
        </div>
      )}
      {confirm === 'discard' && (
        <div className="bid-confirm" role="group" aria-labelledby={`${id}-d`}>
          <h5 className="an-cell an-sec" id={`${id}-d`} tabIndex={-1} ref={confirmRef}>Discard this review?</h5>
          <p className="an-p">Nothing has been written, and nothing will be. Your answers go with it; a new fetch starts a fresh review.</p>
          <div className="bd-actions">
            <button type="button" className="bk-btn bk-btn--danger bk-w8" disabled={!!busy} onClick={onDiscard}><span>Discard</span></button>
            <button type="button" className="bk-btn bk-w8" disabled={!!busy} onClick={() => setConfirm(null)}><span>Keep</span></button>
          </div>
        </div>
      )}
    </section>
  );
}

function SummaryBlock({ run, summary, plan, busy, onUndo, undoErr, onOpen, canOpen }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  useEffect(() => { setOpen(false); setTyped(''); }, [run.id]);
  const n = summary.undoCount || 0;
  const ok = typed.trim() === String(n);
  const opening = summary.opening;
  const sentence = [
    summary.cash && plural(summary.cash, 'cash session'), summary.tournaments && plural(summary.tournaments, 'tournament'),
    summary.adjustments && plural(summary.adjustments, 'adjustment'), summary.transfers && plural(summary.transfers, 'transfer'),
    summary.settlements && plural(summary.settlements, 'settlement'), summary.expenses && plural(summary.expenses, 'expense'),
    summary.backers && plural(summary.backers, 'backer'), summary.deals && plural(summary.deals, 'slate deal'),
    summary.locations && plural(summary.locations, 'money location'),
  ].filter(Boolean).join(', ');
  return (
    <section className="bid-group bid-summary" aria-labelledby={`${id}-t`}>
      <GroupHead id={`${id}-t`} title={`Imported: #${run.id}`} />
      <p className="an-p">
        <strong>{fmtWhen(run.committedAt)}.</strong> {sentence || 'No new records'}
        {summary.same ? `; ${plural(summary.same, 'pair')} linked as the same night` : ''}
        {summary.taken && summary.taken.length ? ` (${summary.taken.length} with the dashboard’s figures)` : ''}
        {summary.changed ? `; ${plural(summary.changed, 'record')} changed` : ''}{summary.removed ? `; ${summary.removed} removed` : ''}
        {opening ? `; an opening ${opening.amount < 0 ? 'withdrawal' : 'deposit'} of ${fmtMoney(opening.amount)} on ${fmtDay(opening.date)}` : ''}.
        {' '}{plural(n, 'row')} in all.
      </p>
      <WritesTable tables={summary.tables} label="What the import wrote" />
      {summary.corrections && summary.corrections.length > 0 && (
        <p className="an-p">Rounding: {summary.corrections.map((c) => `${fmtMoney(c.amount, { sign: true })} on the ${c.side}`).join(', ')}, so each pocket lands within half a dollar of the dashboard&rsquo;s.</p>
      )}
      <Reconciliation rec={summary.reconciliation} title="After the import" after="Here after" />
      <div className="bid-undo">
        {!open ? (
          <div className="bd-actions">
            <button type="button" className="bk-btn bk-btn--danger bid-w11" disabled={!!busy} onClick={() => setOpen(true)}><span>Undo this import</span></button>
          </div>
        ) : (
          <form className="bid-confirm" onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onUndo(n); }} aria-labelledby={`${id}-u`}>
            <h5 className="an-cell an-sec" id={`${id}-u`}>Undo import #{run.id}?</h5>
            <p className="an-p">
              Undo removes the <strong>{plural(n, 'row')}</strong> this import created and puts back what it changed, so every table
              is as it was before it. Rows you have deleted since are simply gone; a row you have edited since stops the undo, and it says which.
            </p>
            <WritesTable tables={summary.tables} label="What the undo reverses" />
            <div className="bk-fields bd-fields bd-block">
              <label className="bk-field" htmlFor={`${id}-i`}>
                <span className="bk-field-label">Type {n} to undo</span>
                <input id={`${id}-i`} value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" autoComplete="off" autoFocus />
              </label>
            </div>
            <div className="bd-actions">
              <button type="submit" className="bk-btn bk-btn--danger bid-w17" disabled={!ok || !!busy}><span>{busy === 'undo' ? 'Undoing…' : `Undo ${plural(n, 'row')}`}</span></button>
              <button type="button" className="bk-btn bk-w8" disabled={!!busy} onClick={() => { setOpen(false); setTyped(''); }}><span>Cancel</span></button>
            </div>
          </form>
        )}
        {undoErr && (
          <div className="bid-undo-err" role="alert">
            <p className="an-p bid-alert"><strong>{undoErr.text}</strong></p>
            {undoErr.rows && undoErr.rows.length > 0 && (
              <ul className="bid-rows">
                {undoErr.rows.map((r) => (
                  <li key={r.key} className="bid-row-edit">
                    <span className="an-cell an-td an-clip" title={r.label}>{r.label}</span>
                    <span className="an-cell an-note an-clip" title={`${r.where}: ${r.why}`}>{r.where} · {r.why}</span>
                    {r.open && canOpen
                      ? <button type="button" className="bk-btn bl-more bid-open" onClick={() => onOpen(r.open)}><span>Open in Results</span></button>
                      : <span className="an-cell an-note bid-open-none" aria-hidden="true" />}
                  </li>
                ))}
              </ul>
            )}
            {undoErr.kind === 'edited' && (
              <p className="an-p">A route that saves a row stamps it, so putting one back by hand does not always count; deleting it does, and then the undo goes through.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function RunsGroup({ runs }) {
  const pager = usePager(runs.length);
  if (!runs.length) return null;
  return (
    <section className="bid-group" aria-labelledby="bid-g-runs">
      <GroupHead id="bid-g-runs" title={`Past fetches (${runs.length})`} />
      <ul className="bid-rows">
        {runs.slice(0, pager.pg.rows).map((r) => {
          const l = runLine(r);
          return (
            <li key={r.id} className="bid-row-run">
              <span className="an-cell an-td an-clip">{l.title}</span>
              <span className="an-cell an-td an-num an-clip" title={l.detail}>{l.detail}</span>
            </li>
          );
        })}
      </ul>
      <Pager pager={pager} label="fetches" />
    </section>
  );
}

// ── the section ─────────────────────────────────────────────────────────────────────────────
export default function BankrollImportDashboard({ bk, onClose, onChanged }) {
  const api = useApi(bk.token);
  const [list, setList] = useState({ status: 'loading', pull: null, runs: [] });
  const [cur, setCur] = useState(null);           // { run, plan, decisions, summary } of the run on screen
  const [overlay, setOverlay] = useState(null);   // answers given, not yet saved (or on their way)
  const [save, setSave] = useState({ state: '', group: null, error: '' });
  const [busy, setBusy] = useState(null);         // 'fetch' | 'commit' | 'undo' | 'discard'
  const [fetchMsg, setFetchMsg] = useState(null);
  const [commitMsg, setCommitMsg] = useState(null);
  const [undoErr, setUndoErr] = useState(null);
  const [undone, setUndone] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [highlight, setHighlight] = useState(() => new Set());
  const pendingRef = useRef(null), sentRef = useRef(null), inflight = useRef(false), timer = useRef(null);
  const runIdRef = useRef(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; clearTimeout(timer.current); }, []);

  const loadRun = useCallback(async (id) => {
    const r = await api('GET', `/${id}`);
    if (!live.current) return r;
    if (r.status === 200) { setCur(r.data); runIdRef.current = id; } else setCur(null);
    return r;
  }, [api]);
  const loadList = useCallback(async () => {
    const r = await api('GET', '');
    if (!live.current) return null;
    if (r.status === 401 || r.status === 403) { setList({ status: 'hidden', pull: null, runs: [] }); return null; }
    if (r.status !== 200) { setList((l) => ({ ...l, status: 'error' })); return null; }
    setList({ status: 'ready', pull: r.data.pull, runs: r.data.runs || [] });
    const c = currentRuns(r.data.runs);
    const want = c.staged || c.committed;
    if (want) await loadRun(want.id); else { setCur(null); runIdRef.current = null; }
    return r.data;
  }, [api, loadRun]);
  useEffect(() => { loadList(); }, [loadList]);

  const staged = cur && cur.run && cur.run.status === 'staged' ? cur : null;
  const committed = cur && cur.run && cur.run.status === 'committed' ? cur : null;
  useHideBankrollFab(!!staged || !!committed, 'sheet');

  // ── answers: debounced, one write at a time ──
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (inflight.current) return;
    const body = pendingRef.current;
    const runId = runIdRef.current;
    if (isEmptyPatch(body) || runId == null) return;
    pendingRef.current = null; sentRef.current = body; inflight.current = true;
    setSave((s) => ({ ...s, state: 'saving' }));
    const r = await api('PUT', `/${runId}/decisions`, body);
    inflight.current = false; sentRef.current = null;
    if (!live.current) return;
    if (r.status === 200 && runIdRef.current === runId) {
      setCur((c) => (c && c.run && c.run.id === runId ? { ...c, plan: r.data.plan } : c));
      setSave((s) => ({ ...s, state: pendingRef.current ? 'pending' : 'saved', error: '' }));
    } else {
      // A refused answer is dropped and the plan read again, so the screen shows what the server holds.
      setSave((s) => ({ ...s, state: 'error', error: (r.data && r.data.error) || 'The answer was not saved.' }));
      await loadRun(runId);
    }
    setOverlay(mergePatch(sentRef.current, pendingRef.current));
    if (!isEmptyPatch(pendingRef.current)) flush();
  }, [api, loadRun]);
  const answer = useCallback((patch, group) => {
    if (!patch) return;
    pendingRef.current = mergePatch(pendingRef.current, patch);
    setOverlay(mergePatch(sentRef.current, pendingRef.current));
    setSave({ state: 'pending', group, error: '' });
    setCommitMsg(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);
  const pending = !isEmptyPatch(overlay) || save.state === 'saving' || save.state === 'pending';
  const view = useMemo(() => (staged ? applyPatch(staged.plan, overlay) : null), [staged, overlay]);
  const groups = useMemo(() => (view ? groupPlan(view) : null), [view]);
  const ready = useMemo(() => commitReadiness(view, { pending }), [view, pending]);
  const stateOf = (g) => (save.group === g ? save.state : '');

  // ── actions ──
  const resetRunState = () => {
    pendingRef.current = null; sentRef.current = null; clearTimeout(timer.current);
    setOverlay(null); setSave({ state: '', group: null, error: '' }); setConfirm(null); setCommitMsg(null); setUndoErr(null); setHighlight(new Set());
  };
  const doFetch = async () => {
    if (busy) return;
    setBusy('fetch'); setFetchMsg(null); setUndone(null);
    const r = await api('POST', '/fetch', {});
    if (!live.current) return;
    setBusy(null);
    if (r.status !== 200) { setFetchMsg(fetchError(r.status, r.data)); await loadList(); return; }
    resetRunState();
    await loadList();
  };
  const doCommit = async () => {
    if (!staged || busy || pending) return;
    const shown = staged.plan;
    setBusy('commit'); setCommitMsg(null);
    const r = await api('POST', `/${staged.run.id}/commit`, { planHash: shown.planHash });
    if (!live.current) return;
    setBusy(null);
    if (r.status === 200) {
      resetRunState();
      await loadList();
      if (onChanged) onChanged();
      return;
    }
    const e = commitError(r.status, r.data);
    setConfirm(null);
    if (e.kind === 'stale' || e.kind === 'undecided' || e.kind === 'blocking') {
      // Read the plan again and show what moved. Never send the same hash again: the owner reviews first.
      const again = await loadRun(staged.run.id);
      if (again.status === 200) setHighlight(diffPlans(shown, again.data.plan));
    }
    if (e.kind === 'gone') await loadList();
    setCommitMsg(e);
  };
  const doDiscard = async () => {
    if (!staged || busy) return;
    setBusy('discard');
    const r = await api('DELETE', `/${staged.run.id}`);
    if (!live.current) return;
    setBusy(null);
    resetRunState();
    if (r.status !== 200) setFetchMsg(fetchError(r.status, r.data));
    await loadList();
  };
  const doUndo = async (expect) => {
    if (!committed || busy) return;
    setBusy('undo'); setUndoErr(null);
    const r = await api('POST', `/${committed.run.id}/undo`, { expect });
    if (!live.current) return;
    setBusy(null);
    if (r.status === 200) {
      setUndone({ id: committed.run.id, ...r.data });
      resetRunState();
      await loadList();
      if (onChanged) onChanged();
      return;
    }
    const e = undoError(r.status, r.data);
    setUndoErr(e);
    if (e.kind === 'expect') await loadRun(committed.run.id);
  };
  const openRow = (o) => {
    if (bk.setSelected) bk.setSelected(BANKROLL_ALL);
    openInResults(o.kind, o.id);
    if (onClose) onClose();
  };

  if (list.status === 'hidden') return null;
  const pull = list.pull;
  const runs = list.runs || [];
  const cr = currentRuns(runs);
  const past = runs.filter((r) => !(staged && r.id === staged.run.id) && !(committed && r.id === committed.run.id));

  return (
    <section className="bd-section bid" style={{ marginTop: 0 }} aria-labelledby="bid-title">
      <h3 className="an-cell an-sec" id="bid-title">From the dashboard app</h3>
      <p className="an-p">
        Brings in the dashboard app&rsquo;s sessions, adjustments, expenses, backers and staking slate. Nothing is written until
        you have answered the review below and pressed Import, and an import can be undone.
      </p>
      {list.status === 'loading' && <p className="an-p">Loading…</p>}
      {list.status === 'error' && <p className="an-p" role="alert">The import could not load. Close the dashboard and try again.</p>}
      {list.status === 'ready' && (
        <>
          <p className="an-p bid-pull">
            {pull && pull.on
              ? <><strong>The pull is on.</strong> It reads the dashboard&rsquo;s export server to server; no file passes through a phone.{cr.committed ? ' A fetch after an import brings only what changed since.' : ''}</>
              : <><strong>The pull is off on this server:</strong> {pull ? pull.why : 'unknown'}. It turns on once LEDGER_TOKEN is set on both Render services.</>}
          </p>
          <div className="bd-actions">
            <button type="button" className="bk-btn bk-btn--brand bid-w17" disabled={!pull || !pull.on || !!busy} onClick={doFetch}>
              <span>{busy === 'fetch' ? 'Fetching…' : staged ? 'Fetch again' : 'Fetch from the dashboard'}</span>
            </button>
          </div>
          {staged && <p className="an-p">Fetching again starts a fresh review; the answers below are not carried over.</p>}
          {fetchMsg && <p className="an-p bid-alert" role="alert"><strong>{fetchMsg}</strong></p>}
          {undone && (
            <p className="an-p" role="status">
              <strong>Import #{undone.id} undone.</strong> {plural(undone.removed || 0, 'row')} removed
              {undone.restored ? `, ${plural(undone.restored, 'row')} put back as they were` : ''}
              {undone.reinserted ? `, ${plural(undone.reinserted, 'row')} restored` : ''}
              {undone.missing ? `; ${plural(undone.missing, 'row')} you had deleted since ${undone.missing === 1 ? 'was' : 'were'} already gone` : ''}.
            </p>
          )}
        </>
      )}

      {staged && view && groups && (
        <div className="bid-review" aria-labelledby="bid-rev">
          <GroupHead id="bid-rev" title={`Review: fetch #${staged.run.id}`} state={save.state === 'error' ? 'error' : ''} changed={highlight.has('counts') || highlight.has('writes')} />
          <p className="an-p">
            Fetched {fmtWhen(staged.run.fetchedAt)}{view.mode === 'delta' ? ', the changes since the last import' : ', everything'}. Playing-roll
            rows go into <strong>{view.target.name}</strong>{view.fund.create ? '; fund nights into a new WSOP fund bankroll' : view.fund.exists ? `; fund nights into ${view.fund.name}` : ''}.
            Answers save as you give them.
          </p>
          {save.state === 'error' && <p className="an-p bid-alert" role="alert"><strong>Not saved: {save.error}</strong></p>}
          <div className="an-stats bid-totals">
            <div className="an-stat">
              <div className="an-cell an-lbl an-lbl-2 an-clip">Dashboard roll</div>
              <div className="an-cell an-val an-clip">{fmtMoney(view.reconciliation.dashboard.roll)}</div>
              <div className="an-cell an-note an-clip">here now {fmtMoney(view.reconciliation.before.roll)}</div>
            </div>
            <div className="an-stat">
              <div className="an-cell an-lbl an-lbl-2 an-clip">Roll after import</div>
              <div className="an-cell an-val an-clip">{fmtMoney(view.reconciliation.after.roll)}</div>
              <div className={'an-cell an-note an-clip' + tone(view.reconciliation.lines.roll.difference)}>{fmtMoney(view.reconciliation.lines.roll.difference, { sign: true })} from the dashboard&rsquo;s</div>
            </div>
            <div className="an-stat">
              <div className="an-cell an-lbl an-lbl-2 an-clip">Dashboard fund</div>
              <div className="an-cell an-val an-clip">{fmtMoney(view.reconciliation.dashboard.fund)}</div>
              <div className="an-cell an-note an-clip">here now {fmtMoney(view.reconciliation.before.fund)}</div>
            </div>
            <div className="an-stat">
              <div className="an-cell an-lbl an-lbl-2 an-clip">Fund after import</div>
              <div className="an-cell an-val an-clip">{fmtMoney(view.reconciliation.after.fund)}</div>
              <div className={'an-cell an-note an-clip' + tone(view.reconciliation.lines.fund.difference)}>{fmtMoney(view.reconciliation.lines.fund.difference, { sign: true })} from the dashboard&rsquo;s</div>
            </div>
          </div>
          {groups.counts.length > 0 && (
            <div className="an-table bid-counts" role="table" aria-label="What the dashboard sent">
              <div className="an-row is-head bid-cols-counts" role="row">
                <span className="an-cell an-lbl an-lbl-3b" role="columnheader">The dashboard sent</span>
                <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">New</span>
                <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">To review</span>
              </div>
              {groups.counts.map((c) => (
                <div key={c.key} className="an-row is-body bid-cols-counts" role="row">
                  <span className="an-cell an-td an-clip" role="cell">{c.label}</span>
                  <span className="an-cell an-td an-num" role="cell">{c.new.toLocaleString('en-US')}</span>
                  <span className="an-cell an-td an-num" role="cell">{c.toReview.toLocaleString('en-US')}</span>
                </div>
              ))}
            </div>
          )}

          <PairsGroup g={groups.pairs} state={stateOf('pairs')} highlight={highlight}
            onAnswer={(id, v) => answer({ pairs: { [id]: v } }, 'pairs')} onFill={() => answer(fillLikely(view), 'pairs')} />
          <BackersGroup g={groups.backers} state={stateOf('backers')} highlight={highlight}
            onAnswer={(fp, v) => answer({ backers: { [fp]: v } }, 'backers')} />
          <SlateGroup plan={view} state={stateOf('slate')} highlight={highlight} onAnswer={(k, v) => answer({ slate: { [k]: v } }, 'slate')} />
          <BalancesGroup plan={view} highlight={highlight} />
          <ItemsGroup groups={groups.changes} kind="change" state={stateOf('changes')} highlight={highlight}
            onAnswer={(k, v) => answer({ changes: { [k]: v } }, 'changes')} />
          <ItemsGroup groups={groups.deletions} kind="deletion" state={stateOf('deletions')} highlight={highlight}
            onAnswer={(k, v) => answer({ deletions: { [k]: v } }, 'deletions')} />
          {view.opening && (
            <OpeningGroup opening={view.opening} target={view.target.name} state={stateOf('opening')} changed={highlight.has('opening')}
              onAnswer={(o) => answer({ opening: o }, 'opening')} />
          )}
          <Reconciliation rec={view.reconciliation} changed={highlight.has('reconciliation')} />
          <ErrorsGroup errors={view.errors || []} changed={highlight.has('errors')} />
          <InfoGroup info={groups.info} />
          <CommitBlock view={view} ready={ready} pending={pending} busy={busy} confirm={confirm} setConfirm={setConfirm}
            onCommit={doCommit} onDiscard={doDiscard} msg={commitMsg} />
        </div>
      )}

      {!staged && committed && committed.summary && (
        <SummaryBlock run={committed.run} summary={committed.summary} plan={committed.plan} busy={busy} onUndo={doUndo} undoErr={undoErr}
          onOpen={openRow} canOpen={resultsOnScreen()} />
      )}
      {list.status === 'ready' && <RunsGroup runs={past} />}
    </section>
  );
}
