import React, { useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { bankrollQuery } from '../utils/bankrolls.js';
import { convertAmount, formatCurrencyAmount, getToday } from '../utils/utils.js';
import { BANKROLL_RANGES, chronological, rangeFrom, stepGeometry, fmtSignedCents, fmtShort } from '../utils/backer-page.js';
import { shapePath, useLineStyle } from '../utils/line-style.js';
import { BankrollGraph, MonthBreak } from './ResultCardParts.jsx';
import { RangeStrip } from './BackerChart.jsx';
import { SessionRow } from './CashSessions.jsx';
import { MoneyParts } from './SwissParts.jsx';
import { openInResults } from '../hooks/useResultsFocus.js';
import { useToast } from '../contexts/ToastContext.jsx';

/*
 * Bankroll › Logs › All (owner, 2026-10-20: "Add 'All' to the MTT/cash dropdown and give the option to
 * show the graph as overlaid or combined"): tournament results and cash sessions together.
 *
 *   - The summary: the combined profit, then MTT and Cash each, in US dollars (the Tournaments half's
 *     graph converts the same way: every figure at today's rates).
 *   - The graph, two ways, chosen under it and remembered on this device:
 *       Combined: one running total of both, the Tournaments graph exactly (BankrollGraph).
 *       Overlaid: MTT and Cash as two lines on one time axis: every result and session is a step
 *       along the bottom in date order, and each line moves only at its own.
 *   - The list: both, by month, newest first. A result opens in place as on the MTT half; a cash
 *     session opens on the Cash half, as it does in the Overview's latest sessions.
 */

const MODE_KEY = 'resultsAllGraph';
const MODES = [['overlay', 'Overlaid'], ['combined', 'Combined']];
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'combined' ? 'combined' : 'overlay'; } catch { return 'overlay'; } };
const RANGE_KEY = 'bankrollGraphRange';   // shared with BankrollGraph: one range for every graph here
const readRange = () => { try { const v = localStorage.getItem(RANGE_KEY); return BANKROLL_RANGES.some(([k]) => k === v) ? v : 'all'; } catch { return 'all'; } };

const W = 35;
const H = 16;
const usd = (cents) => fmtSignedCents(cents);

/** The two running totals over one axis: a point per result or session in date order, each line
 *  moving only at its own kind. Before the window, both totals carry in. Null when nothing is in it. */
export function overlaySeries(events, { range = 'all', today = null } = {}) {
  const list = chronological(events);
  const from = range === 'all' || !today ? null : rangeFrom(range, today);
  let m = 0, c = 0, m0 = 0, c0 = 0;
  const points = [];
  for (const e of list) {
    const v = Number(e.shareCents) || 0;
    if (e.kind === 'cash') c += v; else m += v;
    if (from && String(e.date) < from) { m0 = m; c0 = c; continue; }
    points.push({ date: e.date, kind: e.kind, share: v, game: e.game || null, m, c });
  }
  if (!points.length) return null;
  const values = [m0, c0, ...points.flatMap((p) => [p.m, p.c])];
  const lo = Math.min(...values), hi = Math.max(...values);
  const last = points[points.length - 1];
  return {
    points, lo, hi, n: points.length,
    first: points[0].date, last: last.date,
    mtt: { start: m0, end: last.m, change: last.m - m0 },
    cash: { start: c0, end: last.c, change: last.c - c0 },
  };
}

function OverlayGraph({ events, control }) {
  const today = getToday();
  const thisYear = Number(String(today).slice(0, 4));
  const [range, setRange] = useState(readRange);
  const pickRange = (k) => { setRange(k); try { localStorage.setItem(RANGE_KEY, k); } catch { /* private mode */ } };
  const [lineStyle] = useLineStyle();
  const plotRef = useRef(null);
  const [sel, setSel] = useState(null);
  const s = useMemo(() => overlaySeries(events, { range, today }), [events, range, today]);
  useEffect(() => { setSel(null); }, [s]);
  useEffect(() => {
    if (sel == null) return undefined;
    const off = (ev) => { if (plotRef.current && !plotRef.current.contains(ev.target)) setSel(null); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [sel]);
  const strip = <RangeStrip options={BANKROLL_RANGES} value={range} onChange={pickRange} />;
  if (!events || events.length < 2) return null;
  if (!s) {
    return (
      <div className="tr-chart">
        <div className="bp-chart-block">
          <div className="an-cell an-note an-clip tr-chart-empty">Nothing played {range === '7d' ? 'in the last 7 days' : range === 'mtd' ? 'this month' : 'this year'}.</div>
          {strip}
          {control}
        </div>
      </div>
    );
  }
  const n = s.n;
  // One geometry per line on the shared scale (stepGeometry maps lo..hi the same for both).
  const line = (key, start) => {
    const geo = stepGeometry({ start, points: s.points.map((p) => ({ value: p[key] })), lo: s.lo, hi: s.hi }, { w: W, h: H, inset: 1 });
    const knots = [geo.line[0], ...s.points.map((_, i) => geo.line[2 + 2 * i]), geo.last];
    return { geo, d: shapePath(knots, lineStyle) };
  };
  const mt = line('m', s.mtt.start);
  const ca = line('c', s.cash.start);
  const zero = stepGeometry({ start: 0, points: [{ value: 0 }], lo: s.lo, hi: s.hi }, { w: W, h: H, inset: 1 }).baseY;
  const pick = (ev) => {
    const box = plotRef.current && plotRef.current.getBoundingClientRect();
    if (!box || !box.width) return;
    setSel(Math.min(n - 1, Math.max(0, Math.floor(((ev.clientX - box.left) / box.width) * n))));
  };
  const onKey = (ev) => {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      const step = ev.key === 'ArrowLeft' ? -1 : 1;
      setSel((i) => (i == null ? (step < 0 ? n - 1 : 0) : Math.min(n - 1, Math.max(0, i + step))));
    } else if (ev.key === 'Escape') setSel(null);
  };
  const p = sel != null ? s.points[sel] : null;
  const pg = p ? (p.kind === 'cash' ? ca : mt).geo : null;
  const [sx, sy] = p ? pg.line[2 + 2 * sel] : [0, 0];
  const tone = (v) => (v > 0 ? 'is-pos' : v < 0 ? 'is-neg' : '');
  const total = s.mtt.change + s.cash.change;
  const dot = (geo, cls) => (
    <span className={'bp-dot ' + cls} aria-hidden="true"
      style={{ left: `calc(var(--gu) * ${geo.last[0].toFixed(4)})`, top: `calc(var(--subrow) * ${geo.last[1].toFixed(4)})` }} />
  );
  const aria = `MTT ${usd(s.mtt.change)} and Cash ${usd(s.cash.change)} from ${fmtShort(s.first, thisYear)} to ${fmtShort(s.last, thisYear)}, over ${n} results and sessions`;
  return (
    <div className="tr-chart">
      <div className="bp-chart-block">
        <div className="bp-chart-head">
          {p ? (
            <>
              <span className="an-cell an-sec an-clip">{fmtShort(p.date, thisYear)} · {p.kind === 'cash' ? 'Cash' : 'MTT'} · {p.game || (p.kind === 'cash' ? 'Session' : 'Result')}</span>
              <span className={'an-cell an-val bp-chart-change ' + tone(p.share)}>{usd(p.share)}</span>
            </>
          ) : (
            <>
              {/* The legend is the label: each word in its line's colour. */}
              <span className="an-cell an-sec an-clip ra-legend">
                <span className="ra-key ra-key-mtt">MTT</span> {usd(s.mtt.change)} · <span className="ra-key ra-key-cash">Cash</span> {usd(s.cash.change)}
              </span>
              <span className={'an-cell an-val bp-chart-change ' + tone(total)}>{usd(total)}</span>
            </>
          )}
        </div>
        <div className="bp-chart" ref={plotRef} tabIndex={0}
          aria-label="MTT and Cash: tap or use the arrow keys to read each result or session"
          onPointerDown={pick} onPointerMove={(ev) => { if (ev.pointerType === 'mouse' || ev.buttons) pick(ev); }}
          onPointerLeave={(ev) => { if (ev.pointerType === 'mouse') setSel(null); }}
          onKeyDown={onKey}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={aria}>
            <line x1="0" y1={zero} x2={W} y2={zero} className="bp-base" vectorEffect="non-scaling-stroke" />
            <path d={mt.d} className="bp-line ra-line-mtt" vectorEffect="non-scaling-stroke" />
            <path d={ca.d} className="bp-line ra-line-cash" vectorEffect="non-scaling-stroke" />
          </svg>
          {dot(mt.geo, 'ra-dot-mtt')}
          {dot(ca.geo, 'ra-dot-cash')}
          {p && (
            <>
              <span className="bp-mark" aria-hidden="true" style={{ left: `calc(var(--gu) * ${sx.toFixed(4)})` }} />
              <span className={'bp-dot ' + (p.kind === 'cash' ? 'ra-dot-cash' : 'ra-dot-mtt')} aria-hidden="true"
                style={{ left: `calc(var(--gu) * ${sx.toFixed(4)})`, top: `calc(var(--subrow) * ${sy.toFixed(4)})` }} />
            </>
          )}
        </div>
        <div className="bp-chart-foot ra-foot">
          <span className="an-cell an-note an-clip">{fmtShort(s.first, thisYear)} · start {usd(s.mtt.start + s.cash.start)}</span>
          <span className="an-cell an-note an-num an-clip">{fmtShort(s.last, thisYear)} · now {usd(s.mtt.end + s.cash.end)}</span>
        </div>
        {strip}
        {control}
      </div>
    </div>
  );
}

/** Newest month first, newest item first within it, as both halves list. */
function byMonth(items) {
  const out = [];
  const sorted = [...items].sort((a, b) => (String(b.date) < String(a.date) ? -1 : String(b.date) > String(a.date) ? 1 : 0));
  for (const it of sorted) {
    const key = String(it.date || '').slice(0, 7) || 'undated';
    let g = out[out.length - 1];
    if (!g || g.key !== key) { g = { key, items: [], net: 0 }; out.push(g); }
    g.items.push(it);
    g.net += it.cents / 100;
  }
  return out;
}

export default function ResultsAll({ token, bk, entries, isoDay, resultNet, exchangeRates, renderEntry }) {
  const toast = useToast();
  const [sessions, setSessions] = useState([]);
  const [mode, setMode] = useState(readMode);
  const pickMode = (k) => { setMode(k); try { localStorage.setItem(MODE_KEY, k); } catch { /* private mode */ } };
  const q = bankrollQuery(bk.selected);
  useEffect(() => {
    let on = true;
    fetch(`${API_URL}/cash-sessions${q}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || 'Request failed'); return d; }))
      .then((d) => { if (on) setSessions(d.sessions || []); })
      .catch((e) => { if (on && toast) toast.error(e.message); });
    return () => { on = false; };
  }, [token, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const toUsdCents = (amount, cur) => Math.round(convertAmount(Number(amount) || 0, cur || 'USD', 'USD', exchangeRates) * 100);
  const items = useMemo(() => [
    ...entries.map((e) => ({ kind: 'mtt', date: isoDay(e.date), cents: resultNet(e), entry: e, game: e.event_name || null })),
    ...sessions.filter((s) => s.session_date && s.net != null).map((s) => ({
      kind: 'cash', date: s.session_date, cents: toUsdCents(s.net, s.currency), session: s,
      game: [s.game, s.room].filter(Boolean).join(' · ') || null,
    })),
  ].filter((it) => it.date), [entries, sessions, exchangeRates]); // eslint-disable-line react-hooks/exhaustive-deps
  const events = useMemo(() => items.map((it) => ({ date: it.date, shareCents: it.cents, game: it.game, kind: it.kind })), [items]);
  const months = useMemo(() => byMonth(items), [items]);

  const sum = (k) => items.reduce((t, it) => t + (it.kind === k ? it.cents : 0), 0);
  const mttCents = sum('mtt'), cashCents = sum('cash'), totalCents = mttCents + cashCents;
  const nMtt = items.filter((it) => it.kind === 'mtt').length;
  const nCash = items.length - nMtt;
  const tone = (v) => (v > 0 ? ' is-pos' : v < 0 ? ' is-neg' : '');
  const modeStrip = <RangeStrip options={MODES} value={mode} onChange={pickMode} label="Graph" />;

  return (
    <div className="ra-all">
      {items.length > 0 && (
        <div className="tracking-card" style={{ marginBottom: 'calc(var(--subrow) * 2)' }}>
          <div className="tracking-summary-head">
            <span className="tr-seat tr-seat-3" style={{ fontSize: 'calc(var(--gu) * 1.031)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Profit</span>
          </div>
          <div className={'tr-seat tr-sum-net' + tone(totalCents)}><MoneyParts text={fmtSignedCents(totalCents)} /></div>
          <p className="tr-seat tr-seat-2 tr-sum-sub">
            {nMtt} event{nMtt !== 1 ? 's' : ''} · {nCash} session{nCash !== 1 ? 's' : ''}
          </p>
          <div className="tracking-stats tr-sum-stats">
            <div className="cal-detail-item">
              <span className="cal-detail-label">MTT</span>
              <span className={'cal-detail-value' + tone(mttCents)}>{fmtSignedCents(mttCents)}</span>
            </div>
            <div className="cal-detail-item">
              <span className="cal-detail-label">Cash</span>
              <span className={'cal-detail-value' + tone(cashCents)}>{fmtSignedCents(cashCents)}</span>
            </div>
          </div>
        </div>
      )}

      {mode === 'combined'
        ? <BankrollGraph events={events} label="Profit" control={modeStrip} />
        : <OverlayGraph events={events} control={modeStrip} />}

      {items.length === 0 ? (
        <div className="an-cell an-note">Nothing logged yet: results and cash sessions show here together.</div>
      ) : (
        <div className="tr-months">
          {months.map((g) => (
            <div key={g.key} className="tr-month">
              <MonthBreak monthKey={g.key} count={g.items.length} net={g.net}
                fmtNet={(v) => (v > 0 ? '+' : '') + formatCurrencyAmount(Math.round(v), 'USD')} noun="result" />
              {g.items.map((it) => (it.kind === 'cash'
                ? <SessionRow key={'cs-' + it.session.id} s={it.session} onOpen={() => openInResults('cash', it.session.id)} />
                : <div key={it.entry.id} data-entry-id={it.entry.id}>{renderEntry(it.entry)}</div>))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

