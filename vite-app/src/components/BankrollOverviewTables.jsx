import React, { useEffect, useMemo, useState } from 'react';
import { CURRENCY_CONFIG } from '../utils/utils.js';
import { RANGES } from '../utils/bankroll-ledger.js';
import {
  SECTIONS, OPEN_STORE_KEY, parseOpen, overviewTables, groupTable, ledgerScope, sameScope,
  fmtMoney, moneySign, fmtPct, fmtCount, fmtHours, fmtRatio, DASH,
} from '../utils/bankroll-overview.js';
import { Glyph } from './Icon.jsx';
import './bankroll-overview-tables.css';

/**
 * The bankroll Overview's figures as collapsible tables (beta, app admins), the layout of a
 * dedicated tracker's overview: columns Cash | Tournaments | Total, zebra rows, right-aligned
 * tabular figures. Six sections, each a disclosure row (name, the range and bankroll it covers, a
 * chevron, and when closed its headline figure on the right):
 *   Summary   buy-ins, cash-outs, tips & costs, net, expenses & income, total result (= the hero's
 *             profit), money moved, the balance change
 *   Sessions  sessions / events, bullets, hours and $/h (cash), ROI (tournaments), won % / ITM,
 *             averages, biggest win and loss
 *   Games, Rooms   one row per game / room, cash and tournaments apart (report facts)
 *   Bankroll  balance, all-time peak, below it, deepest drawdown in the range, money moved, risk
 *   By month (By year for All)
 * Summary and Sessions start open; the open / closed state is per device (localStorage
 * `bankrollOverviewOpen`, never required). Data: the ledger the Overview already holds (`d`, every
 * entry of the bankroll in the display currency), the risk estimate, and GET /api/bankrolls/reports
 * for the games and rooms. The arithmetic is utils/bankroll-overview.js, tested.
 * Whose figures: the dashboard keeps the previous ledger on screen while the next one loads, but
 * its bankroll chip and display currency change at once. So the scope line, the currency and the
 * reports query all come from the ledger in hand (ledgerScope), never from the chip — and Games and
 * Rooms take theirs from the report facts in hand, which can be a round trip behind the ledger.
 * Until they are the ones asked for, a section is busy: its figures stay where they are, dimmed,
 * with aria-busy, so an open Games never collapses to "Loading…" and back.
 * Not shown, on purpose: hands and $/100 (no hands are recorded), tournament hours (results carry
 * no playing time), and shares sold. Staking does keep per-event numbers (backer_event_status per
 * agreement x tournament, per-event overrides, an effective % per event in the settlement route),
 * but they are filed by staking series, not by bankroll or ledger row, they hold their own copy of
 * the buy-ins and cashes, and swaps, crossbooks, markup, makeup and budget caps make a backer's cut
 * something other than a plain share of a result. So the results here are gross; whether to add the
 * row is the owner's call (docs/bankrolls.md, "The dashboard").
 */

const readOpen = () => { try { return parseOpen(localStorage.getItem(OPEN_STORE_KEY)); } catch { return parseOpen(null); } };
const saveOpen = (v) => { try { localStorage.setItem(OPEN_STORE_KEY, JSON.stringify(v)); } catch { /* private mode */ } };
// Green / red by the sign AS DRAWN (whole units), so a rate of −0.38 is a plain "$0", not a red one.
const tone = (v) => { const s = moneySign(v); return s > 0 ? ' an-pos' : s < 0 ? ' an-neg' : ''; };
const RANGE_TEXT = { ...Object.fromEntries(RANGES), all: 'All time' };
const plural = (n, word) => `${fmtCount(n)} ${word}${n === 1 ? '' : 's'}`;

// A figure cell: right-aligned, tabular; green / red only when it is signed money.
function Fig({ v, text, toned, title, bold }) {
  return (
    <span role="cell" title={title}
      className={'an-cell an-td an-num an-clip ovt-fig' + (toned && v != null ? tone(v) : '') + (bold ? ' is-strong' : '')}>
      {text}
    </span>
  );
}
// One row of a Cash | Tournaments | Total table.
function Row3({ label, cells, strong, title }) {
  return (
    <div role="row" className={'ovt-row ovt-c4' + (strong ? ' is-strong' : '')}>
      <span role="rowheader" className="an-cell an-td an-clip ovt-lab" title={title}>{label}</span>
      {cells.map((c, i) => <Fig key={i} {...c} bold={strong || i === 2} />)}
    </div>
  );
}
// A Total-only row: the label spans the Cash and Tournaments columns.
function RowTotal({ label, v, text, toned, title }) {
  return (
    <div role="row" className="ovt-row ovt-c4">
      <span role="rowheader" aria-colspan={3} className="an-cell an-td an-clip ovt-lab ovt-span3" title={title}>{label}</span>
      <Fig v={v} text={text} toned={toned} bold />
    </div>
  );
}
function Head3() {
  return (
    <div role="row" className="ovt-thead ovt-c4">
      <span role="columnheader" className="an-cell an-lbl an-lbl-3b ovt-th" aria-label="Figure" />
      <span role="columnheader" className="an-cell an-lbl an-lbl-3b an-num ovt-th is-key is-cash"><span>Cash</span></span>
      <span role="columnheader" className="an-cell an-lbl an-lbl-3b an-num ovt-th is-key is-tourn"><span>Tournaments</span></span>
      <span role="columnheader" className="an-cell an-lbl an-lbl-3b an-num ovt-th is-key is-total"><span>Total</span></span>
    </div>
  );
}

export default function BankrollOverviewTables({ d, risk: riskIn, range, today, bk, bkKey, currency: asked, fmtDate }) {
  const [open, setOpen] = useState(readOpen);
  const toggle = (k) => setOpen((o) => { const n = { ...o, [k]: !o[k] }; saveOpen(n); return n; });
  // The bankroll and currency of the ledger in hand, which lag the chip by one round trip.
  const sc = ledgerScope(d, { key: bkKey, currency: asked, bankrolls: bk.bankrolls });
  const currency = sc.currency;
  // The risk estimate arrives on its own: only the one for this ledger's scope counts.
  const risk = sameScope(riskIn, sc) ? riskIn : null;
  const cfg = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG.USD;
  const m = (v) => fmtMoney(v, cfg);
  const sm = (v) => fmtMoney(v, cfg, { sign: true });
  // The hourly rate in the display currency's own symbol: $/h, €/h, kr/h.
  const perHour = `${cfg.symbol}/h`;

  const t = useMemo(() => overviewTables(d, range, today), [d, range, today]);

  // Games and rooms come from the report facts (the ledger carries money, not rooms or games),
  // fetched for the ledger in hand whenever a new one arrives (a new bankroll, currency or import).
  // The previous facts stay on screen until the new ones land; only a first load shows "Loading…".
  const [facts, setFacts] = useState({ status: 'loading', list: null, scope: null });
  useEffect(() => {
    let live = true;
    setFacts((f) => ({ ...f, status: 'loading' }));
    bk.call('GET', `/reports?bankroll=${encodeURIComponent(sc.key)}&currency=${encodeURIComponent(currency)}`)
      .then((r) => { if (live) setFacts({ status: 'ready', list: r.facts || [], scope: { bankroll: r.bankroll ?? sc.key, currency: r.currency || currency } }); })
      .catch(() => { if (live) setFacts({ status: 'error', list: null, scope: null }); });
    return () => { live = false; };
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  // The facts on screen can be a round trip behind the ledger, so Games and Rooms name, and format
  // their money in, the scope of the FACTS (a USD list must not draw with the next ledger's €).
  // Busy until they are the ones asked for.
  const fsc = facts.scope ? ledgerScope(facts.scope, { key: bkKey, currency: asked, bankrolls: bk.bankrolls }) : sc;
  const fcfg = CURRENCY_CONFIG[fsc.currency] || CURRENCY_CONFIG.USD;
  const fsm = (v) => fmtMoney(v, fcfg, { sign: true });
  const factsBusy = sc.stale || (facts.list != null && (facts.status === 'loading' || fsc.stale));
  const games = useMemo(() => (facts.list ? groupTable(facts.list, 'game', t.window) : null), [facts.list, t.window]);
  const rooms = useMemo(() => (facts.list ? groupTable(facts.list, 'room', t.window) : null), [facts.list, t.window]);

  const S = t.summary, X = t.sessions, B = t.bankroll;
  const scopeOf = (x) => `${RANGE_TEXT[range] || range} · ${x.name}`;
  const scope = scopeOf(sc), factsScope = scopeOf(fsc);
  const periodsLabel = t.bucket === 'year' ? 'By year' : 'By month';

  const ror = (() => {
    if (!risk) return { text: '…', note: 'tournaments' };
    if (risk.status === 'ok') {
      const x = risk.ror;
      return { text: x >= 0.995 ? '100%' : x < 0.001 ? '<0.1%' : fmtPct(x), note: 'tournaments' };
    }
    if (risk.status === 'insufficient') return { text: DASH, note: `needs ${risk.minEntries} tournaments` };
    return { text: DASH, note: 'roll at or below zero' };
  })();

  const played = X.total.count;
  const headline = {
    summary: { text: sm(S.total.result), v: S.total.result, toned: true },
    sessions: { text: played ? `${fmtCount(played)} played` : 'None played' },
    games: { text: games ? (games.named ? plural(games.named, 'game') : DASH) : '…' },
    rooms: { text: rooms ? (rooms.named ? plural(rooms.named, 'room') : DASH) : '…' },
    bankroll: { text: m(B.balance), v: Math.min(0, moneySign(B.balance)), toned: true },
    periods: { text: t.periods.length ? plural(t.periods.length, t.bucket) : DASH },
  };

  // Below the peak and the drawdown only count when they draw as at least one whole unit.
  const below = moneySign(B.below) > 0 ? B.below : 0;
  const dd = B.drawdown && moneySign(B.drawdown.amount) > 0 ? B.drawdown : null;

  const extreme = (x) => (x ? { v: x.amount, text: sm(x.amount), toned: true, title: `${x.label}, ${fmtDate(x.date)}` } : { text: DASH });

  const body = {
    summary: (
      <>
        <div className="ovt-table" role="table" aria-label={`Summary, ${scope}`}>
          <Head3 />
          <Row3 label="Buy-ins" cells={[{ text: m(S.cash.buyins) }, { text: m(S.tournaments.buyins) }, { text: m(S.total.buyins) }]} />
          <Row3 label="Cash-outs" cells={[{ text: m(S.cash.cashouts) }, { text: m(S.tournaments.cashouts) }, { text: m(S.total.cashouts) }]} />
          {S.showCosts && (
            <Row3 label="Tips & costs" title="Cash sessions: tips and table costs"
              cells={[{ v: S.cash.costs, text: sm(S.cash.costs), toned: true }, { text: DASH }, { v: S.total.costs, text: sm(S.total.costs), toned: true }]} />
          )}
          <Row3 label="Net profit" cells={[
            { v: S.cash.net, text: sm(S.cash.net), toned: true }, { v: S.tournaments.net, text: sm(S.tournaments.net), toned: true },
            { v: S.total.net, text: sm(S.total.net), toned: true }]} />
          <RowTotal label="Expenses & income" v={S.total.other} text={sm(S.total.other)} toned />
          <Row3 strong label="Total result" title="Every result in the range: the profit over the graph" cells={[
            { v: S.cash.result, text: sm(S.cash.result), toned: true }, { v: S.tournaments.result, text: sm(S.tournaments.result), toned: true },
            { v: S.total.result, text: sm(S.total.result), toned: true }]} />
          <RowTotal label="Deposits & withdrawals" title="Money moved in or out (transfers included); not a result"
            v={S.total.moved} text={sm(S.total.moved)} />
          <RowTotal label="Balance change" title="Total result plus money moved: what the balance did over the range"
            v={S.total.change} text={sm(S.total.change)} toned />
        </div>
        <p className="an-p ovt-note">Total result is the profit over the graph: every result, never money moved. Results are
          gross of any staking shares sold.</p>
      </>
    ),
    sessions: (
      <>
        <div className="ovt-table" role="table" aria-label={`Sessions, ${scope}`}>
          <Head3 />
          <Row3 label="Sessions / events" cells={[{ text: fmtCount(X.cash.count) }, { text: fmtCount(X.tournaments.count) }, { text: fmtCount(X.total.count) }]} />
          <Row3 label="Bullets" title="Tournament entries, re-entries included" cells={[{ text: DASH }, { text: fmtCount(X.tournaments.bullets) }, { text: DASH }]} />
          <Row3 label="Hours" cells={[{ text: fmtHours(X.cash.hours) }, { text: fmtHours(X.tournaments.hours) }, { text: fmtHours(X.total.hours) }]} />
          <Row3 label={perHour} cells={[
            { v: X.cash.hourly, text: sm(X.cash.hourly), toned: true }, { text: DASH }, { v: X.total.hourly, text: sm(X.total.hourly), toned: true }]} />
          <Row3 label="ROI" cells={[{ text: DASH }, { text: fmtPct(X.tournaments.roi, { sign: true }) }, { text: fmtPct(X.total.roi, { sign: true }) }]} />
          <Row3 label="Won % / ITM" title="Cash: winning sessions. Tournaments: cashes per entry (re-entries count), as in Analytics."
            cells={[{ text: fmtPct(X.cash.won) }, { text: fmtPct(X.tournaments.won) }, { text: fmtPct(X.total.won) }]} />
          <Row3 label="Avg buy-in" title="Buy-ins per session or event (rebuys and re-entries included)"
            cells={[{ text: m(X.cash.avgBuyin) }, { text: m(X.tournaments.avgBuyin) }, { text: m(X.total.avgBuyin) }]} />
          <Row3 label="Avg profit" cells={[
            { v: X.cash.avgProfit, text: sm(X.cash.avgProfit), toned: true }, { v: X.tournaments.avgProfit, text: sm(X.tournaments.avgProfit), toned: true },
            { v: X.total.avgProfit, text: sm(X.total.avgProfit), toned: true }]} />
          <Row3 label="Avg rebuys" title="Rebuys per cash session; re-entries per tournament"
            cells={[{ text: fmtRatio(X.cash.avgRebuys) }, { text: fmtRatio(X.tournaments.avgRebuys) }, { text: fmtRatio(X.total.avgRebuys) }]} />
          <Row3 label="Biggest win" cells={[extreme(X.cash.best), extreme(X.tournaments.best), extreme(X.total.best)]} />
          <Row3 label="Biggest loss" cells={[extreme(X.cash.worst), extreme(X.tournaments.worst), extreme(X.total.worst)]} />
        </div>
        <p className="an-p ovt-note">Hours and {perHour} are cash only: a tournament result carries no playing time. ROI is
          tournaments only. Hands are not recorded, so there is no {cfg.symbol}/100.</p>
      </>
    ),
    games: <Groups data={games} status={facts.status} dim="game" scope={factsScope} sm={fsm} perHour={`${fcfg.symbol}/h`} />,
    rooms: <Groups data={rooms} status={facts.status} dim="room" scope={factsScope} sm={fsm} perHour={`${fcfg.symbol}/h`} />,
    bankroll: (
      <>
        <div className="ovt-table" role="table" aria-label={`Bankroll, ${scope}`}>
          <BRow label="Balance" note={currency} text={m(B.balance)} v={Math.min(0, moneySign(B.balance))} />
          <BRow label="Peak" note={B.peak.date ? `all time · ${fmtDate(B.peak.date)}` : 'all time'} text={m(B.peak.value)} />
          <BRow label="Below the peak" text={below ? sm(-below) : 'At the peak'} v={-below} />
          <BRow label="Deepest drawdown" note={dd ? `${fmtDate(dd.from)} – ${fmtDate(dd.to)}` : RANGE_TEXT[range]}
            text={dd ? sm(-dd.amount) : 'None'} v={dd ? -dd.amount : 0} />
          <BRow label="Deposits & withdrawals" text={sm(B.moved)} />
          {/* A probability, not money: never green / red. */}
          <BRow label="Risk of ruin" note={ror.note} text={ror.text} />
        </div>
        <p className="an-p ovt-note">The peak is the highest the balance has ever been; the drawdown is the deepest fall
          from a peak inside the range. Risk of ruin is explained under Rules.</p>
      </>
    ),
    periods: t.periods.length ? (
      <div className="ovt-table" role="table" aria-label={`${periodsLabel}, ${scope}`}>
        <div role="row" className="ovt-thead ovt-c4">
          <span role="columnheader" className="an-cell an-lbl an-lbl-3b ovt-th">{t.bucket === 'year' ? 'Year' : 'Month'}</span>
          <span role="columnheader" className="an-cell an-lbl an-lbl-3b an-num ovt-th"><span>Results</span></span>
          <span role="columnheader" className="an-cell an-lbl an-lbl-3b an-num ovt-th"><span>Moved</span></span>
          <span role="columnheader" className="an-cell an-lbl an-lbl-3b an-num ovt-th"><span>Net</span></span>
        </div>
        {t.periods.map((r) => (
          <div key={r.key} role="row" className="ovt-row ovt-c4">
            <span role="rowheader" className="an-cell an-td an-clip ovt-lab">{r.label}</span>
            <Fig v={r.results} text={r.results ? sm(r.results) : DASH} toned />
            <Fig text={r.moved ? sm(r.moved) : DASH} />
            <Fig v={r.net} text={sm(r.net)} toned bold />
          </div>
        ))}
      </div>
    ) : <p className="an-p ovt-note">Nothing in the ledger for this range.</p>,
  };

  return (
    <div className="ovt">
      {SECTIONS.map((sec) => {
        const isOpen = !!open[sec.key];
        const label = sec.key === 'periods' ? periodsLabel : sec.label;
        const h = headline[sec.key];
        const isFacts = sec.key === 'games' || sec.key === 'rooms';
        const busy = isFacts ? factsBusy : sc.stale;
        return (
          <section key={sec.key} className={'ovt-sec' + (isOpen ? ' is-open' : '') + (busy ? ' is-busy' : '')}>
            <h3 className="ovt-h">
              <button type="button" className="ovt-head" id={`ovt-h-${sec.key}`} aria-expanded={isOpen}
                aria-controls={`ovt-b-${sec.key}`} onClick={() => toggle(sec.key)}>
                <span className="ovt-chev" aria-hidden="true"><Glyph name="chevronDown" /></span>
                <span className="ovt-title">
                  <span className="ovt-name">{label}</span>
                  <span className="ovt-scope">{isFacts ? factsScope : scope}</span>
                </span>
                <span className={'ovt-headline' + (h.toned && h.v != null ? tone(h.v) : '')} aria-hidden={isOpen ? 'true' : undefined}>{h.text}</span>
              </button>
            </h3>
            <div className="ovt-body" id={`ovt-b-${sec.key}`} role="region" aria-labelledby={`ovt-h-${sec.key}`}
              aria-busy={busy ? 'true' : undefined}>
              <div className="ovt-inner"><div className="ovt-content">{body[sec.key]}</div></div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

// Bankroll: label | a muted note (what the figure covers) | the value. Without a note the label
// takes the note's columns too.
function BRow({ label, note, text, v }) {
  return (
    <div role="row" className="ovt-row ovt-cb">
      <span role="rowheader" aria-colspan={note ? undefined : 2} className={'an-cell an-td an-clip ovt-lab' + (note ? '' : ' ovt-span2')}>{label}</span>
      {note && <span role="cell" className="an-cell an-note ovt-note-4 an-clip">{note}</span>}
      <span role="cell" className={'an-cell an-td an-num an-clip ovt-fig is-strong' + tone(v)}>{text}</span>
    </div>
  );
}

// Games / Rooms: cash sessions and tournaments in their own blocks (a cash rate is per hour, a
// tournament's is ROI), each led by a head row keyed to its column colour.
function Groups({ data, status, dim, scope, sm, perHour }) {
  if (!data) {
    return <p className="an-p ovt-note">{status === 'error' ? `The ${dim === 'game' ? 'games' : 'rooms'} could not load.` : 'Loading…'}</p>;
  }
  if (data.empty) return <p className="an-p ovt-note">No tournaments or cash sessions in this range.</p>;
  const what = dim === 'game' ? 'Game' : 'Room';
  const block = (rows, type) => rows.length > 0 && (
    <div className="ovt-table ovt-group" role="table" aria-label={`${what}s, ${type === 'cash' ? 'cash' : 'tournaments'}, ${scope}`}>
      <div role="row" className="ovt-thead ovt-c5">
        <span role="columnheader" className={'an-cell an-lbl an-lbl-3b ovt-th is-key ' + (type === 'cash' ? 'is-cash' : 'is-tourn')}>
          <span>{type === 'cash' ? 'Cash' : 'Tournaments'}</span>
        </span>
        <span role="columnheader" className="an-cell an-lbl an-lbl-3b an-num ovt-th"><span>{type === 'cash' ? 'Sessions' : 'Events'}</span></span>
        <span role="columnheader" className="an-cell an-lbl an-lbl-3b an-num ovt-th"><span>Hours</span></span>
        <span role="columnheader" className="an-cell an-lbl an-lbl-3b an-num ovt-th"><span className={type === 'cash' ? 'ovt-unit' : undefined}>{type === 'cash' ? perHour : 'ROI'}</span></span>
        <span role="columnheader" className="an-cell an-lbl an-lbl-3b an-num ovt-th"><span>Total</span></span>
      </div>
      {rows.map((r) => (
        <div key={r.key} role="row" className="ovt-row ovt-c5">
          <span role="rowheader" className={'an-cell an-td an-clip ovt-lab' + (r.label == null ? ' is-muted' : '')} title={r.label || undefined}>
            {r.label == null ? 'Not recorded' : r.label}
          </span>
          <Fig text={fmtCount(r.n)} />
          <Fig text={fmtHours(r.hours)} />
          {type === 'cash'
            ? <Fig v={r.rate} text={sm(r.rate)} toned />
            : <Fig text={fmtPct(r.rate, { sign: true })} />}
          <Fig v={r.total} text={sm(r.total)} toned bold />
        </div>
      ))}
    </div>
  );
  return (
    <>
      {block(data.cash, 'cash')}
      {block(data.tournament, 'tournament')}
      <p className="an-p ovt-note">Sorted by total. Hours are cash only: a tournament result carries no playing time.</p>
    </>
  );
}
