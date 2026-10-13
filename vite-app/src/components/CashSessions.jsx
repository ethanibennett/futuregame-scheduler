// Cash game sessions (beta, app admins): the Cash half of the Results tab (ResultsKindTabs in
// CashLive.jsx switches to it). Lazy-loaded by TrackingView.
//
// Laid out the way a serious session tracker is (Poker Bankroll Tracker's structure, in this app's
// own type, colours and grid): one screen at a time —
//   list    head (Cash · CSV · Add · Start) · Sessions | Stats strip · the running session's row ·
//           Sessions: the cumulative ("chip") graph with net and per hour over it, then every session
//           grouped by month, each month's net and hours in its header, each row LEADING with the
//           big signed, coloured result (then game, room, date, length, per hour, a line of notes).
//           Stats: label-left / value-right rows, then the breakdown by stakes / game / room.
//   detail  one session: result, what and when, its in-session stack graph, every field as a row,
//           the notes in full; Edit and Delete.
//   form    add a session (few fields, the last session's room/game/stakes/times/buy-in already in,
//           length by end time OR hours, big money inputs; the rest behind More) / edit / start.
//   live    the running session, focused: a large clock, what is in play, the stack now and the
//           swing graph built from STACK UPDATES, rebuy, cash out. Opens by itself while one runs.
// Tournament results are not in this list: they are the Tournaments half of the Results tab, and
// these totals, months and stats are cash-only (mixing them would change what every number means).
// It follows the Results tab's bankroll (bk.selected) like the tournament half does. Server:
// lib/cash-sessions.js. Styles: CashSessions.css (every box whole g x whole r, baselines on r).
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { CURRENCY_CONFIG, formatCurrencyAmount } from '../utils/utils.js';
import { BANKROLL_MAIN, bankrollQuery, defaultBankrollFor } from '../utils/bankrolls.js';
import { shareOrDownloadBlob } from '../utils/export.js';
import {
  CASH_GAMES, formatClock, formatHours, liveElapsed, localDay, localTime, sessionInstants, sessionGame,
  parseTagInput, amountOrUndefined, roomSuggestions, slugForRoom, monthLabel, groupByMonth, monthTotals,
  sessionHourly, sessionDefaults, hoursBetweenTimes, endTimeAfter, instantsFromHours, parseHours, hoursInput,
  swingSeries, swingSummary, chartPath,
} from '../utils/cash-sessions.js';
import useLiveCashSession, { setLiveSession } from '../hooks/useLiveCashSession.js';
import { useResultsFocus, clearResultsFocus, revealInScroller } from '../hooks/useResultsFocus.js';
import { useTick } from './CashLive.jsx';

const money = (v, cur) => formatCurrencyAmount(Math.round(v || 0), cur || 'USD');
const signed = (v, cur) => (v > 0 ? '+' : '') + money(v, cur);
const perHour = (v, cur) => (v == null ? '—' : `${signed(v, cur)}/h`);
const tone = (v) => (v > 0 ? ' is-pos' : v < 0 ? ' is-neg' : '');
const CURRENCIES = Object.keys(CURRENCY_CONFIG);
const asDate = (day) => new Date(day + 'T12:00:00');
const rowDay = (day) => {
  const d = asDate(day);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const longDay = (day) => {
  const d = asDate(day);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};
const clockTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Btn({ kind = 'ghost', w = 8, h = 5, children, ...rest }) {
  return <button type="button" className={`cs-btn cs-btn--${kind}`} style={{ '--w': w, '--h': h }} {...rest}><span>{children}</span></button>;
}
const XIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>
);
function Field({ label, wide, big, note, children }) {
  return (
    <label className={'cs-field' + (wide ? ' is-wide' : '') + (big ? ' is-big' : '') + (note ? ' is-note' : '')}>
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
const Notes = (props) => <textarea maxLength={500} rows={2} placeholder="Optional — the table, a hand, how you played" {...props} />;

// ── A line chart: the cumulative graph (x = session) and a session's swing (x = time) ────────────
const VW = 1000, VH = 300;
function Chart({ points, x = 't', className = '', label, empty }) {
  const id = 'cs' + useId().replace(/[^\w-]/g, '');
  const p = chartPath(points, { W: VW, H: VH, x });
  // Clip margins reach past the viewBox so round caps at the ends are not cut.
  const sides = p ? [['is-pos', -VH, p.zeroY + VH], ['is-neg', p.zeroY, VH * 2 - p.zeroY]] : [];
  return (
    <div className={'cs-chart ' + className}>
      <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <defs>
          {sides.map(([k, y, h]) => <clipPath key={k} id={`${id}-${k}`}><rect x={-VW} y={y} width={VW * 3} height={h} /></clipPath>)}
        </defs>
        <line x1="0" x2={VW} y1={p ? p.zeroY : VH / 2} y2={p ? p.zeroY : VH / 2} className="cs-chart-zero" vectorEffect="non-scaling-stroke" />
        {sides.map(([k]) => (
          <g key={k} clipPath={`url(#${id}-${k})`}>
            <path d={`${p.d} L${VW} ${p.zeroY} L0 ${p.zeroY} Z`} className={'cs-chart-area ' + k} />
            <path d={p.d} className={'cs-chart-line ' + k} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      {!p && empty && <p className="cs-t cs-chart-empty">{empty}</p>}
    </div>
  );
}

// ── Add / edit a finished session ───────────────────────────────────────────
function SessionForm({ bk, rooms, sessions, session, onSave, onCancel, busy }) {
  const s = session || null;
  const d = useMemo(() => sessionDefaults(sessions), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [day, setDay] = useState(s ? s.session_date : localDay());
  const [start, setStart] = useState(s ? localTime(s.started_at) : d.start);
  const [end, setEnd] = useState(s && s.ended_at ? localTime(s.ended_at) : d.end);
  const [hours, setHours] = useState(hoursInput(s && s.hours != null ? s.hours : hoursBetweenTimes(d.start, d.end)));
  const [room, setRoom] = useState(s ? s.room : d.room);
  const [game, setGame] = useState(s ? s.game : d.game);
  const [stakes, setStakes] = useState(s ? s.stakes : d.stakes);
  const [buyIn, setBuyIn] = useState(s ? String(s.buy_in) : d.buyIn);
  const [rebuys, setRebuys] = useState(s ? String(s.rebuys) : '0');
  const [cashOut, setCashOut] = useState(s && s.cash_out != null ? String(s.cash_out) : '');
  const [tips, setTips] = useState(s && s.tips ? String(s.tips) : '');
  const [expenses, setExpenses] = useState(s && s.expenses ? String(s.expenses) : '');
  const [bankroll, setBankroll] = useState(s ? s.bankroll_id : defaultBankrollFor(bk.selected, bk.bankrolls));
  const [currency, setCurrency] = useState(s ? s.currency : '');
  const [tags, setTags] = useState(s ? s.tags.join(', ') : '');
  const [notes, setNotes] = useState(s && s.notes ? s.notes : '');
  const bankrollCurrency = (bk.bankrolls.find((b) => b.id === bankroll) || { currency: 'USD' }).currency;
  const [more, setMore] = useState(!!(s && (s.rebuys || s.tips || s.expenses || s.tags.length || s.currency !== bankrollCurrency)));
  // Length by end time OR by hours: typing either fills in the other.
  const onEnd = (v) => { setEnd(v); setHours(hoursInput(hoursBetweenTimes(start, v))); };
  const onHours = (v) => { setHours(v); const e = endTimeAfter(start, parseHours(v)); if (e) setEnd(e); };
  const onStart = (v) => { setStart(v); const e = endTimeAfter(v, parseHours(hours)); if (e) setEnd(e); };
  const h = parseHours(hours);
  const times = h ? instantsFromHours(day, start, h) : sessionInstants(day, start, end);
  const ok = times && Number(buyIn) > 0 && cashOut !== '' && Number(cashOut) >= 0;
  const net = ok ? Number(cashOut) - Number(buyIn) - (Number(tips) || 0) - (Number(expenses) || 0) : null;
  const submit = () => onSave({
    ...times, date: day, room, venueSlug: slugForRoom(room, rooms) || (s && s.room === room ? s.venue_slug : (room === d.room ? d.venueSlug : null)),
    game, stakes, buyIn: Number(buyIn), rebuys: Number(rebuys) || 0, cashOut: Number(cashOut),
    tips: amountOrUndefined(tips) ?? 0, expenses: amountOrUndefined(expenses) ?? 0,
    bankroll, currency: currency || bankrollCurrency, tags: parseTagInput(tags), notes,
  });
  return (
    <section className="cs-form" aria-label={s ? 'Edit session' : 'Add a session'}>
      <div className="cs-fields">
        <Field label="Buy-in" big><Num value={buyIn} placeholder="0" onChange={(e) => setBuyIn(e.target.value)} /></Field>
        <Field label="Cash-out" big><Num value={cashOut} placeholder="0" autoFocus={!s} onChange={(e) => setCashOut(e.target.value)} /></Field>
        <Field label="Date"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label="Started"><input type="time" value={start} onChange={(e) => onStart(e.target.value)} /></Field>
        <Field label="Ended"><input type="time" value={end} onChange={(e) => onEnd(e.target.value)} /></Field>
        <Field label="Or hours"><input value={hours} inputMode="decimal" maxLength={8} placeholder="e.g. 4.5" onChange={(e) => onHours(e.target.value)} /></Field>
        <Field label="Room" wide><RoomInput value={room} onChange={setRoom} rooms={rooms} /></Field>
        <Field label="Game"><GameSelect value={game} onChange={setGame} /></Field>
        <Field label="Stakes"><input value={stakes} maxLength={20} placeholder="e.g. 2/5" onChange={(e) => setStakes(e.target.value)} /></Field>
        <Field label="Notes" wide note><Notes value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {more && (
          <>
            <Field label="Rebuys (count)"><Num value={rebuys} max="999" onChange={(e) => setRebuys(e.target.value)} /></Field>
            <Field label="Bankroll"><BankrollSelect bk={bk} value={bankroll} onChange={setBankroll} /></Field>
            <Field label="Tips"><Num value={tips} placeholder="0" onChange={(e) => setTips(e.target.value)} /></Field>
            <Field label="Expenses"><Num value={expenses} placeholder="0" onChange={(e) => setExpenses(e.target.value)} /></Field>
            <Field label="Currency">
              <select value={currency || bankrollCurrency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Tags"><input value={tags} maxLength={200} placeholder="deep, reg table" onChange={(e) => setTags(e.target.value)} /></Field>
          </>
        )}
      </div>
      <div className="cs-form-foot">
        {!more && <Btn w={13} h={4} onClick={() => setMore(true)}>Bankroll, tips, more</Btn>}
        <p className={'cs-t cs-form-net' + tone(net || 0)}>{net == null ? '' : `${signed(net, currency || bankrollCurrency)}${h || times ? ` · ${formatHours(h || hoursBetweenTimes(start, end) || 0)}` : ''}`}</p>
      </div>
      <div className="cs-actions">
        <Btn kind="brand" w={11} disabled={!ok || busy} onClick={submit}>{s ? 'Save' : 'Add session'}</Btn>
        <Btn w={8} onClick={onCancel}>Cancel</Btn>
      </div>
    </section>
  );
}

// ── Start a session ─────────────────────────────────────────────────────────
function StartForm({ bk, rooms, sessions, onStart, onCancel, busy }) {
  const d = useMemo(() => sessionDefaults(sessions), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [room, setRoom] = useState(d.room);
  const [game, setGame] = useState(d.game);
  const [stakes, setStakes] = useState(d.stakes);
  const [buyIn, setBuyIn] = useState(d.buyIn);
  const [bankroll, setBankroll] = useState(defaultBankrollFor(bk.selected, bk.bankrolls));
  const submit = () => onStart({
    room, venueSlug: slugForRoom(room, rooms) || (room === d.room ? d.venueSlug : null), game, stakes, buyIn: Number(buyIn), bankroll, date: localDay(),
  });
  return (
    <section className="cs-form" aria-label="Start a session">
      <div className="cs-fields">
        <Field label="Buy-in" big><Num value={buyIn} placeholder="0" autoFocus onChange={(e) => setBuyIn(e.target.value)} /></Field>
        <Field label="Stakes" big><input value={stakes} maxLength={20} placeholder="2/5" onChange={(e) => setStakes(e.target.value)} /></Field>
        <Field label="Room" wide><RoomInput value={room} onChange={setRoom} rooms={rooms} /></Field>
        <Field label="Game"><GameSelect value={game} onChange={setGame} /></Field>
        <Field label="Bankroll"><BankrollSelect bk={bk} value={bankroll} onChange={setBankroll} /></Field>
      </div>
      <div className="cs-actions">
        <Btn kind="brand" w={11} disabled={busy || !(Number(buyIn) > 0)} onClick={submit}>Start clock</Btn>
        <Btn w={8} onClick={onCancel}>Cancel</Btn>
      </div>
    </section>
  );
}

// ── The running session, focused ────────────────────────────────────────────
function LiveScreen({ session, stacks, skew, busy, onStack, onUnstack, onRebuy, onEnd }) {
  useTick(true);
  const [panel, setPanel] = useState(null); // null | 'rebuy' | 'end'
  const [stack, setStack] = useState('');
  const [amount, setAmount] = useState('');
  const [cashOut, setCashOut] = useState('');
  const [tips, setTips] = useState('');
  const [expenses, setExpenses] = useState('');
  const [notes, setNotes] = useState(session.notes || '');
  const cur = session.currency;
  const what = [sessionGame(session), session.room].filter(Boolean).join(' · ');
  const firstBuyIn = session.rebuys ? null : session.buy_in;
  const sw = swingSummary(stacks);
  const now = Date.now() + skew;
  const recent = [...stacks].reverse();
  const cashNet = cashOut === '' ? null : Number(cashOut) - session.buy_in - (Number(tips) || 0) - (Number(expenses) || 0);
  return (
    <section className="cs-livescreen" aria-label="Session running">
      <p className="cs-t cs-live-what">{what || 'Cash game'}</p>
      <p className="cs-t cs-live-clock" role="timer">{formatClock(liveElapsed(session, Date.now(), skew))}</p>
      <p className="cs-t cs-live-sub">Started {clockTime(session.started_at)} · {session.rebuys ? plural(session.rebuys, 'rebuy') : 'no rebuys'}</p>
      <div className="cs-tiles">
        <div className="cs-tile"><span className="cs-t cs-tile-label">In play</span><span className="cs-t cs-tile-value">{money(session.buy_in, cur)}</span></div>
        <div className="cs-tile"><span className="cs-t cs-tile-label">Stack</span><span className="cs-t cs-tile-value">{sw.last ? money(sw.last.amount, cur) : '—'}</span></div>
        <div className="cs-tile"><span className="cs-t cs-tile-label">Up / down</span><span className={'cs-t cs-tile-value' + tone(sw.last ? sw.last.result : 0)}>{sw.last ? signed(sw.last.result, cur) : '—'}</span></div>
      </div>
      <Chart className="cs-chart--live" points={swingSeries(session, stacks, now)} label="Stack over the session"
        empty={stacks.length ? null : 'Update your stack to draw the swing'} />

      {panel === null && (
        <div className="cs-entry-block">
          <span className="cs-t cs-field-label">Stack now ({cur})</span>
          <div className="cs-entry">
            <Num value={stack} placeholder={sw.last ? String(sw.last.amount) : String(session.buy_in)} onChange={(e) => setStack(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && stack !== '') { onStack(Number(stack)).then((r) => { if (r) setStack(''); }); } }} />
            <Btn kind="brand" w={11} h={6} disabled={busy || stack === '' || !(Number(stack) >= 0)}
              onClick={async () => { if (await onStack(Number(stack))) setStack(''); }}>Update</Btn>
          </div>
        </div>
      )}
      {panel === 'rebuy' && (
        <div className="cs-entry-block">
          <span className="cs-t cs-field-label">Rebuy / add-on ({cur})</span>
          <div className="cs-entry">
            <Num value={amount} placeholder={firstBuyIn ? String(firstBuyIn) : '0'} autoFocus onChange={(e) => setAmount(e.target.value)} />
            <Btn kind="brand" w={11} h={6} disabled={busy || !(Number(amount || firstBuyIn) > 0)}
              onClick={async () => { if (await onRebuy(Number(amount || firstBuyIn))) { setPanel(null); setAmount(''); } }}>Add</Btn>
          </div>
        </div>
      )}
      {panel === 'end' && (
        <div className="cs-fields cs-end">
          <Field label={`Cash-out (${cur})`} big wide><Num value={cashOut} placeholder="0" autoFocus onChange={(e) => setCashOut(e.target.value)} /></Field>
          <Field label="Tips"><Num value={tips} placeholder="0" onChange={(e) => setTips(e.target.value)} /></Field>
          <Field label="Expenses"><Num value={expenses} placeholder="0" onChange={(e) => setExpenses(e.target.value)} /></Field>
          <Field label="Notes" wide note><Notes value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      )}
      <div className="cs-actions">
        {panel === null && (
          <>
            <Btn w={11} onClick={() => setPanel('rebuy')}>Rebuy</Btn>
            <Btn kind="brand" w={11} onClick={() => setPanel('end')}>Cash out</Btn>
          </>
        )}
        {panel === 'rebuy' && <Btn w={8} onClick={() => setPanel(null)}>Cancel</Btn>}
        {panel === 'end' && (
          <>
            <Btn kind="brand" w={11} disabled={busy || cashOut === '' || !(Number(cashOut) >= 0)}
              onClick={() => onEnd({ cashOut: Number(cashOut), tips: amountOrUndefined(tips), expenses: amountOrUndefined(expenses), notes })}>End session</Btn>
            <Btn w={8} onClick={() => setPanel(null)}>Cancel</Btn>
            <p className={'cs-t cs-actions-net' + tone(cashNet || 0)}>{cashNet == null ? '' : signed(cashNet, cur)}</p>
          </>
        )}
      </div>

      {recent.length > 0 && (
        <div className="cs-upds">
          <h3 className="cs-t cs-sec-title">Stack updates · {recent.length}{sw.high != null ? ` · high ${signed(sw.high, cur)}, low ${signed(sw.low, cur)}` : ''}</h3>
          {recent.slice(0, 12).map((u) => (
            <div key={u.id} className="cs-upd">
              <span className="cs-t">{clockTime(u.at)}</span>
              <span className="cs-t cs-upd-amt">{money(u.amount, cur)}</span>
              <span className={'cs-t cs-upd-amt' + tone(u.result)}>{signed(u.result, cur)}</span>
              <Btn w={3} h={4} aria-label={`Remove the ${clockTime(u.at)} update`} disabled={busy} onClick={() => onUnstack(u.id)}><XIcon /></Btn>
            </div>
          ))}
          {recent.length > 12 && <p className="cs-t cs-note">and {recent.length - 12} earlier</p>}
        </div>
      )}
    </section>
  );
}

// ── Stats: label-left, value-right ──────────────────────────────────────────
const BREAKDOWNS = [['byStakes', 'Stakes'], ['byGame', 'Game'], ['byRoom', 'Room']];
function Stats({ stats }) {
  const [by, setBy] = useState('byStakes');
  if (!stats || !stats.sessions) return <p className="cs-t cs-note">No finished sessions yet.</p>;
  const o = stats.overall, cur = stats.currency;
  const winPct = stats.sessions ? Math.round((o.wins / stats.sessions) * 100) : 0;
  const rows = [
    ['Net', signed(o.net, cur), o.net],
    ['Per hour', perHour(o.hourly, cur), o.hourly],
    ['Hours', formatHours(o.hours)],
    ['Sessions', String(stats.sessions)],
    ['Won · lost', `${o.wins} · ${o.losses} (${winPct}%)`],
    ['Avg length', o.avg_hours == null ? '—' : formatHours(o.avg_hours)],
    ['Per session', signed(o.net / stats.sessions, cur), o.net],
    ['Best', o.biggest_win ? signed(o.biggest_win.amount, cur) : '—', o.biggest_win ? 1 : 0],
    ['Worst', o.biggest_loss ? signed(o.biggest_loss.amount, cur) : '—', o.biggest_loss ? -1 : 0],
    ['Bought in', money(o.buy_ins, cur)],
    ['Cashed out', money(o.cash_outs, cur)],
    ['Tips, costs', money(o.tips + o.expenses, cur)],
  ];
  const groups = stats[by] || [];
  return (
    <section className="cs-stats" aria-label="Cash stats">
      <div className="cs-kv2">
        {rows.map(([label, value, sign]) => (
          <div key={label} className="cs-kv">
            <span className="cs-t cs-kv-label">{label}</span>
            <span className={'cs-t cs-kv-value' + tone(sign || 0)}>{value}</span>
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

// ── Sessions: the chip graph, then month by month ────────────────────────────
function Summary({ stats }) {
  if (!stats || !stats.sessions) return null;
  const o = stats.overall, cur = stats.currency;
  const points = [{ v: 0 }, ...(stats.series || []).map((p) => ({ v: p.cum }))];
  return (
    <section className="cs-sum" aria-label="Cash results">
      <div className="cs-sum-line">
        <span className="cs-t cs-sum-label">Cash net{stats.mixed ? ` (${cur})` : ''}</span>
        <span className="cs-t cs-sum-label cs-r">{plural(stats.sessions, 'session')} · {formatHours(o.hours)}</span>
      </div>
      <div className="cs-sum-main">
        <span className={'cs-t cs-sum-net' + tone(o.net)}>{signed(o.net, cur)}</span>
        <span className={'cs-t cs-sum-rate cs-r' + tone(o.hourly || 0)}>{perHour(o.hourly, cur)}</span>
      </div>
      <Chart className="cs-chart--sum" points={points} x="i" label="Cumulative cash results, session by session" />
    </section>
  );
}

function SessionRow({ s, onOpen }) {
  const cur = s.currency;
  const hourly = sessionHourly(s);
  const what = [sessionGame(s) || 'Cash', s.room].filter(Boolean).join(' · ');
  return (
    <div className={'cs-row' + (s.notes ? ' has-note' : '')} role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <span className={'cs-t cs-row-net' + tone(s.net)}>{signed(s.net, cur)}</span>
      <span className="cs-t cs-row-what">{what}</span>
      <span className="cs-t cs-row-rate">{hourly == null ? '' : `${signed(hourly, cur)}/h`}</span>
      <span className="cs-t cs-row-when">{rowDay(s.session_date)} · {clockTime(s.started_at)} · {formatHours(s.hours)}</span>
      {s.notes && <span className="cs-t cs-row-note">{s.notes}</span>}
    </div>
  );
}

function SessionList({ sessions, stats, onOpen }) {
  const months = groupByMonth(sessions);
  const byMonth = new Map(((stats && stats.byMonth) || []).map((m) => [m.key, m]));
  const cur = stats ? stats.currency : (sessions[0] && sessions[0].currency) || 'USD';
  return (
    <section className="cs-list" aria-label="Cash sessions">
      {months.map((m) => {
        const t = byMonth.get(m.key) || monthTotals(m.sessions);
        return (
          <React.Fragment key={m.key}>
            <div className="cs-month">
              <h3 className="cs-t cs-month-name">{monthLabel(m.key)}</h3>
              <p className="cs-t cs-month-sum"><span className={tone(t.net)}>{signed(t.net, cur)}</span> · {formatHours(t.hours)} · {plural(m.sessions.length, 'session')}</p>
            </div>
            {m.sessions.map((s) => <SessionRow key={s.id} s={s} onOpen={() => onOpen(s.id)} />)}
          </React.Fragment>
        );
      })}
    </section>
  );
}

// ── One session ─────────────────────────────────────────────────────────────
function SessionDetail({ s, stacks, bk, busy, confirm, onConfirm, onDelete }) {
  const cur = s.currency;
  const hourly = sessionHourly(s);
  const bankroll = (bk.bankrolls.find((b) => b.id === s.bankroll_id) || { name: s.bankroll_id === BANKROLL_MAIN ? 'Main' : '—' }).name;
  const rows = [
    ['Length', formatHours(s.hours)],
    ['Buy-in', money(s.buy_in, cur) + (s.rebuys ? ` (${plural(s.rebuys, 'rebuy')})` : '')],
    ['Cash-out', money(s.cash_out, cur)],
    ['At the table', signed(s.result, cur), s.result],
    s.tips ? ['Tips', money(s.tips, cur)] : null,
    s.expenses ? ['Expenses', money(s.expenses, cur)] : null,
    ['Net', signed(s.net, cur), s.net],
    ['Per hour', perHour(hourly, cur), hourly],
    stacks.length ? ['High / low', `${signed(swingSummary(stacks).high, cur)} / ${signed(swingSummary(stacks).low, cur)}`] : null,
    ['Bankroll', bankroll],
    s.tags.length ? ['Tags', s.tags.join(', ')] : null,
  ].filter(Boolean);
  return (
    <section className="cs-detail" aria-label="Session">
      <div className="cs-hero">
        <span className={'cs-t cs-hero-net' + tone(s.net)}>{signed(s.net, cur)}</span>
        <span className={'cs-t cs-hero-rate cs-r' + tone(hourly || 0)}>{perHour(hourly, cur)}</span>
      </div>
      <p className="cs-t cs-detail-what">{[sessionGame(s) || 'Cash', s.room].filter(Boolean).join(' · ')}</p>
      <p className="cs-t cs-detail-when">{longDay(s.session_date)} · {clockTime(s.started_at)} – {clockTime(s.ended_at)}</p>
      {stacks.length > 0 && (
        <>
          <h3 className="cs-t cs-sec-title">Stack over the session · {plural(stacks.length, 'update')}</h3>
          <Chart className="cs-chart--detail" points={swingSeries(s, stacks)} label="Stack over the session" />
        </>
      )}
      <div className="cs-kv1">
        {rows.map(([label, value, sign]) => (
          <div key={label} className="cs-kv">
            <span className="cs-t cs-kv-label">{label}</span>
            <span className={'cs-t cs-kv-value' + tone(sign || 0)}>{value}</span>
          </div>
        ))}
      </div>
      <h3 className="cs-t cs-sec-title">Notes</h3>
      <p className={'cs-notes' + (s.notes ? '' : ' is-empty')}>{s.notes || 'No notes. Edit to add some.'}</p>
      {confirm && (
        <div className="cs-confirm">
          <p className="cs-t cs-note">Delete this session? This cannot be undone.</p>
          <div className="cs-actions">
            <Btn kind="danger" w={8} disabled={busy} onClick={onDelete}>Delete</Btn>
            <Btn w={8} onClick={() => onConfirm(false)}>Keep</Btn>
          </div>
        </div>
      )}
    </section>
  );
}

// ── The view ────────────────────────────────────────────────────────────────
export default function CashSessionsView({ token, bk }) {
  const toast = useToast();
  const { session: live, stacks: liveStacks, skew } = useLiveCashSession({ enabled: true, token });
  const [sessions, setSessions] = useState([]);
  const [stats, setStats] = useState(null);
  const [loaded, setLoaded] = useState(false);
  // null = automatic (the running session if there is one, else the list) | 'list' | 'live' |
  // 'add' | 'start' | { detail: id } | { edit: id }
  const [screen, setScreen] = useState(null);
  const [tab, setTab] = useState('sessions'); // the list's Sessions | Stats
  const [detailStacks, setDetailStacks] = useState({ id: null, stacks: [] });
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  // "Edit in Results" from the bankroll dashboard's Sessions tab: that session's edit screen, in view
  // (hooks/useResultsFocus.js). Taken once the session is in the list.
  const focusId = useResultsFocus('cash');
  useEffect(() => {
    if (focusId == null || !sessions.some((s) => s.id === focusId && !s.live)) return undefined;
    clearResultsFocus();
    setScreen({ edit: focusId });
    setConfirmDelete(false);
    const raf = requestAnimationFrame(() => revealInScroller(document.querySelector('.cs-view'), 0));
    return () => cancelAnimationFrame(raf);
  }, [focusId, sessions]);

  const ended = sessions.filter((s) => !s.live);
  const view = screen || (live ? 'live' : 'list');
  const shown = view === 'live' && !live ? 'list' : view;
  const detailId = shown && shown.detail ? shown.detail : null;
  const editId = shown && shown.edit ? shown.edit : null;
  const current = detailId || editId ? sessions.find((s) => s.id === (detailId || editId)) : null;

  // A session's stack updates, read when its detail opens.
  useEffect(() => {
    if (!detailId) return undefined;
    let on = true;
    call('GET', `/${detailId}`).then((r) => { if (on) setDetailStacks({ id: detailId, stacks: r.stacks || [] }); }).catch(() => {});
    return () => { on = false; };
  }, [detailId, call]);
  const stacksOf = (id) => (detailStacks.id === id ? detailStacks.stacks : []);

  const go = (next) => { setScreen(next); setConfirmDelete(false); };
  const act = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast.success(ok); await load(); return r || true; }
    catch (e) { toast.error(e.message); return false; }
    finally { setBusy(false); }
  };
  const start = (body) => act(async () => {
    const r = await call('POST', '/start', body);
    setLiveSession(r.session, null, []);
    go('live');
  }, 'Clock started');
  const rebuy = (amount) => act(async () => { const r = await call('POST', `/${live.id}/rebuy`, { amount }); setLiveSession(r.session, null, r.stacks); }, 'Rebuy added');
  const stackUpdate = async (amount) => {
    setBusy(true);
    try { const r = await call('POST', `/${live.id}/stack`, { amount }); setLiveSession(r.session, null, r.stacks); return true; }
    catch (e) { toast.error(e.message); return false; }
    finally { setBusy(false); }
  };
  const unstack = async (stackId) => {
    setBusy(true);
    try { const r = await call('DELETE', `/${live.id}/stacks/${stackId}`); setLiveSession(r.session, null, r.stacks); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const end = (body) => act(async () => {
    const id = live.id;
    await call('POST', `/${id}/end`, body);
    setLiveSession(null);
    go({ detail: id });
  }, 'Session saved');
  const save = (body, id) => act(async () => {
    if (id) { await call('PUT', `/${id}`, body); go({ detail: id }); }
    else { const r = await call('POST', '', body); go({ detail: r.session.id }); }
  }, id ? 'Saved' : 'Session added');
  const remove = (id) => act(async () => { await call('DELETE', `/${id}`); go('list'); }, 'Deleted');
  const exportCsv = async () => {
    try {
      const res = await fetch(`${API_URL}/cash-sessions/export.csv${q}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = new Blob([await res.text()], { type: 'text/csv;charset=utf-8' });
      await shareOrDownloadBlob(blob, `cash-sessions-${localDay()}.csv`, 'text/csv');
    } catch (e) { toast.error(e.message); }
  };

  const back = <Btn w={9} h={4} onClick={() => go('list')}>‹ Sessions</Btn>;
  let head, body, focus = true;
  if (shown === 'live' && live) {
    head = <>{back}<h2 className="cs-t cs-title cs-title--live"><span className="cs-dot" aria-hidden="true">●</span> Live</h2></>;
    body = <LiveScreen key={live.id} session={live} stacks={liveStacks || []} skew={skew} busy={busy}
      onStack={stackUpdate} onUnstack={unstack} onRebuy={rebuy} onEnd={end} />;
  } else if (shown === 'add' || shown === 'start' || editId) {
    head = <>{back}<h2 className="cs-t cs-title">{shown === 'start' ? 'Start a session' : editId ? 'Edit session' : 'Add a session'}</h2></>;
    body = shown === 'start'
      ? <StartForm bk={bk} rooms={rooms} sessions={ended} busy={busy} onStart={start} onCancel={() => go('list')} />
      : editId && !current ? null
        : <SessionForm key={editId || 'add'} bk={bk} rooms={rooms} sessions={ended} session={current} busy={busy}
          onSave={(b) => save(b, editId)} onCancel={() => go(editId ? { detail: editId } : 'list')} />;
  } else if (detailId && current) {
    head = (
      <>
        {back}
        <h2 className="cs-t cs-title">Session</h2>
        <Btn w={6} h={4} onClick={() => go({ edit: current.id })}>Edit</Btn>
        <Btn kind="danger" w={7} h={4} onClick={() => setConfirmDelete(true)}>Delete</Btn>
      </>
    );
    body = <SessionDetail s={current} stacks={stacksOf(current.id)} bk={bk} busy={busy} confirm={confirmDelete}
      onConfirm={setConfirmDelete} onDelete={() => remove(current.id)} />;
  } else {
    focus = false;
    head = (
      <>
        <h2 className="cs-t cs-title">Cash</h2>
        <Btn w={5} h={4} disabled={!ended.length} onClick={exportCsv} title="Export sessions as CSV">CSV</Btn>
        <Btn w={5} h={4} onClick={() => go('add')}>Add</Btn>
        {!live && <Btn kind="brand" w={6} h={4} onClick={() => go('start')}>Start</Btn>}
      </>
    );
    body = (
      <>
        <div className="live-update-tabs cash-mode-tabs cs-tabs" role="tablist" aria-label="Cash">
          {[['sessions', 'Sessions'], ['stats', 'Stats']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        {live && <LiveRow session={live} skew={skew} onOpen={() => go('live')} />}
        {tab === 'stats' ? <Stats stats={stats} /> : (
          <>
            <Summary stats={stats} />
            {loaded && !ended.length && (
              <p className="cs-t cs-note">No cash sessions{bk.selected !== 'all' ? ' in this bankroll' : ''} yet. Start the clock at the table, or add a past one.</p>
            )}
            <SessionList sessions={ended} stats={stats} onOpen={(id) => go({ detail: id })} />
          </>
        )}
      </>
    );
  }
  return (
    <div className={'cs-view' + (focus ? ' is-focus' : '')}>
      <div className="cs-head">{head}</div>
      {body}
    </div>
  );
}

// The running session at the top of the list: its clock and what is in play; Open goes to it.
function LiveRow({ session, skew, onOpen }) {
  useTick(true);
  const what = [sessionGame(session), session.room].filter(Boolean).join(' · ');
  return (
    <div className="cs-liverow">
      <span className="cs-t cs-bar-text">
        <span className="cs-dot" aria-hidden="true">●</span>{' '}
        <b className="cs-bar-clock">{formatClock(liveElapsed(session, Date.now(), skew))}</b>
        {what ? ` · ${what}` : ''} · {money(session.buy_in, session.currency)} in
      </span>
      <Btn kind="brand" w={6} h={3} onClick={onOpen}>Open</Btn>
    </div>
  );
}
