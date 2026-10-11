// Cash game sessions (beta, app admins): the Cash half of the Results tab (ResultsKindTabs in
// CashLive.jsx switches to it). Lazy-loaded by TrackingView.
//   head       Cash · CSV · Log past · Start
//   live card  while a session runs: the clock, what is in play, Rebuy, Cash out
//   forms      start a session / log a past one / edit (one at a time)
//   stats      net, per hour, hours, sessions, won-lost, average length, best, worst; then a
//              breakdown by stakes / game / room
//   list       one 7r row per session, tap to open its notes, Edit and Delete
// It follows the Results tab's bankroll (bk.selected) like the tournament half does. Server:
// lib/cash-sessions.js. Styles: CashSessions.css (every box whole g x whole r, baselines on r).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { CURRENCY_CONFIG, formatCurrencyAmount } from '../utils/utils.js';
import { BANKROLL_MAIN, bankrollQuery, defaultBankrollFor } from '../utils/bankrolls.js';
import { shareOrDownloadBlob } from '../utils/export.js';
import {
  CASH_GAMES, formatClock, formatHours, liveElapsed, localDay, localTime, sessionInstants, sessionGame,
  parseTagInput, amountOrUndefined, roomSuggestions, slugForRoom,
} from '../utils/cash-sessions.js';
import useLiveCashSession, { setLiveSession } from '../hooks/useLiveCashSession.js';
import { useTick } from './CashLive.jsx';

const money = (v, cur) => formatCurrencyAmount(Math.round(v || 0), cur || 'USD');
const signed = (v, cur) => (v > 0 ? '+' : '') + money(v, cur);
const tone = (v) => (v > 0 ? ' is-pos' : v < 0 ? ' is-neg' : '');
const CURRENCIES = Object.keys(CURRENCY_CONFIG);
const shortDay = (day) => {
  const d = new Date(day + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const clockTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function Btn({ kind = 'ghost', w = 8, h = 5, children, ...rest }) {
  return <button type="button" className={`cs-btn cs-btn--${kind}`} style={{ '--w': w, '--h': h }} {...rest}><span>{children}</span></button>;
}
function Field({ label, wide, children }) {
  return (
    <label className={'cs-field' + (wide ? ' is-wide' : '')}>
      <span className="cs-t cs-field-label">{label}</span>
      {children}
    </label>
  );
}
function BankrollSelect({ bk, value, onChange }) {
  const options = bk.bankrolls.filter((b) => !b.archived || b.id === value);
  return (
    <select value={String(value)} onChange={(e) => onChange(e.target.value === BANKROLL_MAIN ? BANKROLL_MAIN : Number(e.target.value))}>
      {options.map((b) => <option key={b.id} value={String(b.id)}>{b.name}{b.archived ? ' (archived)' : ''}</option>)}
    </select>
  );
}
function GameSelect({ value, onChange }) {
  const list = CASH_GAMES.includes(value) || !value ? CASH_GAMES : [value, ...CASH_GAMES];
  return <select value={value} onChange={(e) => onChange(e.target.value)}>{list.map((g) => <option key={g} value={g}>{g}</option>)}</select>;
}
function RoomInput({ value, onChange, rooms }) {
  return (
    <>
      <input value={value} maxLength={60} list="cs-rooms" placeholder="e.g. Borgata" autoComplete="off" onChange={(e) => onChange(e.target.value)} />
      <datalist id="cs-rooms">{rooms.map((r) => <option key={r.name} value={r.name} />)}</datalist>
    </>
  );
}
const Num = (props) => <input type="number" inputMode="numeric" min="0" {...props} />;

// ── Start a session ─────────────────────────────────────────────────────────
function StartForm({ bk, rooms, last, onStart, onCancel }) {
  const [room, setRoom] = useState(last ? last.room : '');
  const [game, setGame] = useState(last ? last.game : 'NLH');
  const [stakes, setStakes] = useState(last ? last.stakes : '');
  const [buyIn, setBuyIn] = useState('');
  const [bankroll, setBankroll] = useState(defaultBankrollFor(bk.selected, bk.bankrolls));
  const submit = () => onStart({
    room, venueSlug: slugForRoom(room, rooms), game, stakes, buyIn: Number(buyIn), bankroll, date: localDay(),
  });
  return (
    <section className="cs-form" style={{ '--rows': 3 }} aria-label="Start a session">
      <h3 className="cs-t cs-form-title">Start a session</h3>
      <div className="cs-fields">
        <Field label="Room" wide><RoomInput value={room} onChange={setRoom} rooms={rooms} /></Field>
        <Field label="Game"><GameSelect value={game} onChange={setGame} /></Field>
        <Field label="Stakes"><input value={stakes} maxLength={20} placeholder="e.g. 2/5" onChange={(e) => setStakes(e.target.value)} /></Field>
        <Field label="Buy-in"><Num value={buyIn} placeholder="0" onChange={(e) => setBuyIn(e.target.value)} /></Field>
        <Field label="Bankroll"><BankrollSelect bk={bk} value={bankroll} onChange={setBankroll} /></Field>
      </div>
      <div className="cs-actions">
        <Btn kind="brand" disabled={!(Number(buyIn) > 0)} onClick={submit}>Start</Btn>
        <Btn w={6} onClick={onCancel}>Cancel</Btn>
      </div>
    </section>
  );
}

// ── Log a past session / edit one ───────────────────────────────────────────
function SessionForm({ bk, rooms, session, onSave, onCancel }) {
  const s = session || null;
  const [day, setDay] = useState(s ? s.session_date : localDay());
  const [start, setStart] = useState(s ? localTime(s.started_at) : '19:00');
  const [end, setEnd] = useState(s && s.ended_at ? localTime(s.ended_at) : '23:00');
  const [room, setRoom] = useState(s ? s.room : '');
  const [game, setGame] = useState(s ? s.game : 'NLH');
  const [stakes, setStakes] = useState(s ? s.stakes : '');
  const [buyIn, setBuyIn] = useState(s ? String(s.buy_in) : '');
  const [rebuys, setRebuys] = useState(s ? String(s.rebuys) : '0');
  const [cashOut, setCashOut] = useState(s && s.cash_out != null ? String(s.cash_out) : '');
  const [tips, setTips] = useState(s && s.tips ? String(s.tips) : '');
  const [expenses, setExpenses] = useState(s && s.expenses ? String(s.expenses) : '');
  const [bankroll, setBankroll] = useState(s ? s.bankroll_id : defaultBankrollFor(bk.selected, bk.bankrolls));
  const [currency, setCurrency] = useState(s ? s.currency : '');
  const [tags, setTags] = useState(s ? s.tags.join(', ') : '');
  const [notes, setNotes] = useState(s && s.notes ? s.notes : '');
  const bankrollCurrency = (bk.bankrolls.find((b) => b.id === bankroll) || { currency: 'USD' }).currency;
  const times = sessionInstants(day, start, end);
  const ok = times && Number(buyIn) > 0 && cashOut !== '' && Number(cashOut) >= 0;
  const submit = () => onSave({
    ...times, date: day, room, venueSlug: slugForRoom(room, rooms) || (s && s.room === room ? s.venue_slug : null),
    game, stakes, buyIn: Number(buyIn), rebuys: Number(rebuys) || 0, cashOut: Number(cashOut),
    tips: amountOrUndefined(tips) ?? 0, expenses: amountOrUndefined(expenses) ?? 0,
    bankroll, currency: currency || bankrollCurrency, tags: parseTagInput(tags), notes,
  });
  return (
    <section className="cs-form" style={{ '--rows': 9 }} aria-label={s ? 'Edit session' : 'Log a session'}>
      <h3 className="cs-t cs-form-title">{s ? 'Edit session' : 'Log a session'}</h3>
      <div className="cs-fields">
        <Field label="Date"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label="Bankroll"><BankrollSelect bk={bk} value={bankroll} onChange={setBankroll} /></Field>
        <Field label="Started"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Ended"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Room" wide><RoomInput value={room} onChange={setRoom} rooms={rooms} /></Field>
        <Field label="Game"><GameSelect value={game} onChange={setGame} /></Field>
        <Field label="Stakes"><input value={stakes} maxLength={20} placeholder="e.g. 2/5" onChange={(e) => setStakes(e.target.value)} /></Field>
        <Field label="Total buy-in"><Num value={buyIn} placeholder="0" onChange={(e) => setBuyIn(e.target.value)} /></Field>
        <Field label="Rebuys"><Num value={rebuys} max="999" onChange={(e) => setRebuys(e.target.value)} /></Field>
        <Field label="Cash-out"><Num value={cashOut} placeholder="0" onChange={(e) => setCashOut(e.target.value)} /></Field>
        <Field label="Tips"><Num value={tips} placeholder="0" onChange={(e) => setTips(e.target.value)} /></Field>
        <Field label="Expenses"><Num value={expenses} placeholder="0" onChange={(e) => setExpenses(e.target.value)} /></Field>
        <Field label="Currency">
          <select value={currency || bankrollCurrency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Tags" wide><input value={tags} maxLength={200} placeholder="Comma-separated, e.g. deep, reg table" onChange={(e) => setTags(e.target.value)} /></Field>
        <Field label="Notes" wide><input value={notes} maxLength={500} placeholder="Optional" onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="cs-actions">
        <Btn kind="brand" disabled={!ok} onClick={submit}>{s ? 'Save' : 'Log it'}</Btn>
        <Btn w={6} onClick={onCancel}>Cancel</Btn>
      </div>
    </section>
  );
}

// ── The running session ─────────────────────────────────────────────────────
function LiveCard({ session, skew, onRebuy, onEnd, busy }) {
  useTick(true);
  const [panel, setPanel] = useState(null); // null | 'rebuy' | 'end'
  const [amount, setAmount] = useState('');
  const [cashOut, setCashOut] = useState('');
  const [tips, setTips] = useState('');
  const [expenses, setExpenses] = useState('');
  const [notes, setNotes] = useState(session.notes || '');
  const cur = session.currency;
  const what = [sessionGame(session), session.room].filter(Boolean).join(' · ');
  const firstBuyIn = session.rebuys ? null : session.buy_in;
  return (
    <section className="cs-live" style={{ '--rows': panel === 'end' ? 3 : panel === 'rebuy' ? 1 : 0 }} aria-label="Session running">
      <p className="cs-t cs-live-top"><span className="cs-dot" aria-hidden="true">●</span> Live{what ? ` · ${what}` : ''}</p>
      <div className="cs-live-main">
        <span className="cs-t cs-live-clock">{formatClock(liveElapsed(session, Date.now(), skew))}</span>
        <span className="cs-live-inplay">
          <span className="cs-t cs-cell-label">In play</span>
          <span className="cs-t cs-cell-value">{money(session.buy_in, cur)}</span>
        </span>
      </div>
      <p className="cs-t cs-live-sub">
        Started {clockTime(session.started_at)} · {session.rebuys ? `${session.rebuys} rebuy${session.rebuys === 1 ? '' : 's'}` : 'no rebuys'}
      </p>
      {panel === 'rebuy' && (
        <div className="cs-fields">
          <Field label={`Rebuy (${cur})`}>
            <Num value={amount} placeholder={firstBuyIn ? String(firstBuyIn) : '0'} autoFocus onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
      )}
      {panel === 'end' && (
        <div className="cs-fields">
          <Field label={`Cash-out (${cur})`}><Num value={cashOut} placeholder="0" autoFocus onChange={(e) => setCashOut(e.target.value)} /></Field>
          <Field label="Tips"><Num value={tips} placeholder="0" onChange={(e) => setTips(e.target.value)} /></Field>
          <Field label="Expenses"><Num value={expenses} placeholder="0" onChange={(e) => setExpenses(e.target.value)} /></Field>
          <Field label="Notes" wide><input value={notes} maxLength={500} placeholder="Optional" onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      )}
      <div className="cs-actions">
        {panel === null && (
          <>
            <Btn onClick={() => setPanel('rebuy')}>Rebuy</Btn>
            <Btn kind="brand" onClick={() => setPanel('end')}>Cash out</Btn>
          </>
        )}
        {panel === 'rebuy' && (
          <>
            <Btn kind="brand" disabled={busy || !(Number(amount || firstBuyIn) > 0)}
              onClick={async () => { if (await onRebuy(Number(amount || firstBuyIn))) { setPanel(null); setAmount(''); } }}>Add rebuy</Btn>
            <Btn w={6} onClick={() => setPanel(null)}>Cancel</Btn>
          </>
        )}
        {panel === 'end' && (
          <>
            <Btn kind="brand" w={9} disabled={busy || cashOut === '' || !(Number(cashOut) >= 0)}
              onClick={() => onEnd({ cashOut: Number(cashOut), tips: amountOrUndefined(tips), expenses: amountOrUndefined(expenses), notes })}>End session</Btn>
            <Btn w={6} onClick={() => setPanel(null)}>Cancel</Btn>
          </>
        )}
      </div>
    </section>
  );
}

// ── Stats ───────────────────────────────────────────────────────────────────
const BREAKDOWNS = [['byStakes', 'Stakes', 11], ['byGame', 'Game', 12], ['byRoom', 'Room', 12]];
function Stats({ stats }) {
  const [by, setBy] = useState('byStakes');
  if (!stats || !stats.sessions) return null;
  const o = stats.overall, cur = stats.currency;
  const cells = [
    ['Net', signed(o.net, cur), o.net],
    ['Per hour', o.hourly == null ? '—' : signed(o.hourly, cur), o.hourly],
    ['Hours', formatHours(o.hours)],
    ['Sessions', String(stats.sessions)],
    ['Won · lost', `${o.wins} · ${o.losses}`],
    ['Avg length', o.avg_hours == null ? '—' : formatHours(o.avg_hours)],
    ['Best', o.biggest_win ? signed(o.biggest_win.amount, cur) : '—', o.biggest_win ? 1 : 0],
    ['Worst', o.biggest_loss ? signed(o.biggest_loss.amount, cur) : '—', o.biggest_loss ? -1 : 0],
  ];
  const groups = stats[by] || [];
  return (
    <section className="cs-stats" aria-label="Cash stats">
      <div className="cs-grid">
        {cells.map(([label, value, sign]) => (
          <div key={label} className="cs-cell">
            <span className="cs-t cs-cell-label">{label}</span>
            <span className={'cs-t cs-cell-value' + tone(sign || 0)}>{value}</span>
          </div>
        ))}
      </div>
      {stats.mixed && <p className="cs-t cs-note">In {cur}, other currencies at {stats.rates_stale ? 'fallback' : "today's"} rates.</p>}
      <div className="live-update-tabs cash-mode-tabs cs-seg" role="tablist" aria-label="Break down by">
        {BREAKDOWNS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={by === k} className={by === k ? 'active' : ''} onClick={() => setBy(k)}>{label}</button>
        ))}
      </div>
      <div className="cs-brow cs-brow--head" aria-hidden="true">
        <span className="cs-t" />
        <span className="cs-t">Hours</span>
        <span className="cs-t">Net</span>
        <span className="cs-t">Per hour</span>
      </div>
      {groups.map((g) => (
        <div key={g.key} className="cs-brow">
          <span className="cs-t">{g.label}</span>
          <span className="cs-t">{formatHours(g.hours)}</span>
          <span className={'cs-t' + tone(g.net)}>{signed(g.net, cur)}</span>
          <span className={'cs-t' + tone(g.hourly || 0)}>{g.hourly == null ? '—' : signed(g.hourly, cur)}</span>
        </div>
      ))}
    </section>
  );
}

// ── One session in the list ─────────────────────────────────────────────────
function SessionRow({ s, open, onToggle, onEdit, onDelete }) {
  const cur = s.currency;
  // A rate over a few minutes is noise (+$83,333/h), so rows under 15 minutes show none.
  const hourly = s.hours >= 0.25 ? s.net / s.hours : null;
  const extra = [s.tags.length ? s.tags.join(', ') : null, s.tips ? `tips ${money(s.tips, cur)}` : null,
    s.expenses ? `expenses ${money(s.expenses, cur)}` : null, s.notes].filter(Boolean).join(' · ');
  return (
    <div className={'cs-row' + (open ? ' is-open' : '')}>
      <div className="cs-row-main" tabIndex={0} aria-expanded={open} onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <span className="cs-t cs-row-what">{shortDay(s.session_date)} · {sessionGame(s) || 'Cash'}</span>
        <span className={'cs-t cs-row-net' + tone(s.net)}>{signed(s.net, cur)}</span>
        <span className="cs-t cs-row-sub">{[s.room, formatHours(s.hours), `${money(s.buy_in, cur)} → ${money(s.cash_out, cur)}`].filter(Boolean).join(' · ')}</span>
        <span className="cs-t cs-row-rate">{hourly == null ? '' : `${signed(hourly, cur)}/h`}</span>
      </div>
      {open && (
        <div className="cs-row-more">
          {extra && <p className="cs-t cs-row-extra">{extra}</p>}
          <div className="cs-actions">
            <Btn w={6} onClick={onEdit}>Edit</Btn>
            <Btn kind="danger" w={6} onClick={onDelete}>Delete</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── The view ────────────────────────────────────────────────────────────────
export default function CashSessionsView({ token, bk }) {
  const toast = useToast();
  const { session: live, skew } = useLiveCashSession({ enabled: true, token });
  const [sessions, setSessions] = useState([]);
  const [stats, setStats] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(null); // null | 'start' | 'log' | { edit: id }
  const [openRow, setOpenRow] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [venues, setVenues] = useState([]);

  const call = useCallback(async (method, path, body) => {
    const res = await fetch(`${API_URL}/cash-sessions${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [token]);

  const q = bankrollQuery(bk.selected);
  const load = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([call('GET', q), call('GET', '/stats' + q)]);
      setSessions(list.sessions || []);
      setStats(st);
    } catch (e) { toast.error(e.message); }
    setLoaded(true);
  }, [call, q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  // A session ended elsewhere (another device) lands in the list when the live store notices.
  const liveId = live ? live.id : null;
  useEffect(() => { if (loaded) load(); }, [liveId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The cash watcher's rooms, for the room field (admin-only proxy; offline is fine).
  useEffect(() => {
    let on = true;
    fetch(`${API_URL}/cash/current`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (on && d && Array.isArray(d.venues)) setVenues(d.venues.filter((v) => v && v.name).map((v) => ({ slug: v.slug, name: v.name }))); })
      .catch(() => {});
    return () => { on = false; };
  }, [token]);
  const rooms = useMemo(() => roomSuggestions(venues, sessions), [venues, sessions]);

  const act = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast.success(ok); await load(); return r || true; }
    catch (e) { toast.error(e.message); return false; }
    finally { setBusy(false); }
  };
  const start = (body) => act(async () => {
    const r = await call('POST', '/start', body);
    setLiveSession(r.session);
    setForm(null);
  }, 'Session started');
  const rebuy = (amount) => act(async () => { const r = await call('POST', `/${live.id}/rebuy`, { amount }); setLiveSession(r.session); }, 'Rebuy added');
  const end = (body) => act(async () => { await call('POST', `/${live.id}/end`, body); setLiveSession(null); }, 'Session saved');
  const save = (body, id) => act(async () => {
    if (id) await call('PUT', `/${id}`, body); else await call('POST', '', body);
    setForm(null);
    setOpenRow(null);
  }, id ? 'Saved' : 'Session logged');
  const remove = (id) => act(async () => { await call('DELETE', `/${id}`); setConfirmDelete(null); setOpenRow(null); }, 'Deleted');
  const exportCsv = async () => {
    try {
      const res = await fetch(`${API_URL}/cash-sessions/export.csv${q}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = new Blob([await res.text()], { type: 'text/csv;charset=utf-8' });
      await shareOrDownloadBlob(blob, `cash-sessions-${localDay()}.csv`, 'text/csv');
    } catch (e) { toast.error(e.message); }
  };

  const ended = sessions.filter((s) => !s.live);
  const editing = form && form.edit ? sessions.find((s) => s.id === form.edit) : null;
  return (
    <div className="cs-view">
      <div className="cs-head">
        <h2 className="cs-t cs-title">Cash</h2>
        <Btn w={5} h={4} disabled={!ended.length} onClick={exportCsv} title="Export sessions as CSV">CSV</Btn>
        <Btn w={7} h={4} onClick={() => setForm(form === 'log' ? null : 'log')}>{form === 'log' ? 'Cancel' : 'Log past'}</Btn>
        {!live && <Btn kind="brand" w={7} h={4} onClick={() => setForm(form === 'start' ? null : 'start')}>{form === 'start' ? 'Cancel' : 'Start'}</Btn>}
      </div>

      {live && <LiveCard key={live.id} session={live} skew={skew} busy={busy} onRebuy={rebuy} onEnd={end} />}
      {form === 'start' && !live && <StartForm bk={bk} rooms={rooms} last={ended[0]} onStart={start} onCancel={() => setForm(null)} />}
      {form === 'log' && <SessionForm bk={bk} rooms={rooms} onSave={(b) => save(b)} onCancel={() => setForm(null)} />}

      <Stats stats={stats} />

      <section className="cs-list" aria-label="Cash sessions">
        <h3 className="cs-t cs-form-title">Sessions{ended.length ? ` · ${ended.length}` : ''}</h3>
        {loaded && !ended.length && (
          <p className="cs-t cs-note">No cash sessions{bk.selected !== 'all' ? ' in this bankroll' : ''} yet. Start one at the table, or log a past one.</p>
        )}
        {ended.map((s) => (editing && editing.id === s.id ? (
          <SessionForm key={s.id} bk={bk} rooms={rooms} session={s} onSave={(b) => save(b, s.id)} onCancel={() => setForm(null)} />
        ) : (
          <React.Fragment key={s.id}>
            <SessionRow s={s} open={openRow === s.id} onToggle={() => { setOpenRow(openRow === s.id ? null : s.id); setConfirmDelete(null); }}
              onEdit={() => setForm({ edit: s.id })} onDelete={() => setConfirmDelete(s.id)} />
            {confirmDelete === s.id && (
              <div className="cs-confirm">
                <p className="cs-t cs-note">Delete this session? This cannot be undone.</p>
                <div className="cs-actions">
                  <Btn kind="danger" disabled={busy} onClick={() => remove(s.id)}>Delete</Btn>
                  <Btn w={6} onClick={() => setConfirmDelete(null)}>Keep</Btn>
                </div>
              </div>
            )}
          </React.Fragment>
        )))}
      </section>
    </div>
  );
}
