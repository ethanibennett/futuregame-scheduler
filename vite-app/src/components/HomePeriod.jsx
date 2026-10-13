import React, { useEffect, useMemo, useState } from 'react';
import { CURRENCY_CONFIG, nativeCurrency } from '../utils/utils.js';
import { fmtMoney, convertMoney } from '../utils/home.js';
import { buildPeriod, currentTrip, ledgerFrom, goalLines } from '../utils/home-period.js';
import HomeNoiseLine from './HomeNoiseLine.jsx';

// ── The home's period block (verdict section 5) and the goals under it ─────────────────────────
// One block whose window follows what is running (utils/home-period.js buildPeriod): a trip covering
// today (admins), else a series detected with confidence, else the month to date beside the same
// days of last month. Its header names the window and the scope ('All bankrolls · USD'); a 7r lead
// carries the net in the display face with its sample, and the comparison (or the trip's or
// series' dates) on the right; then label/value rows for what happened, each rate with its sample.
// Admins' figures are the combined ledger through the Overview's own arithmetic; everyone else's
// are their tournament results. A goal (admins: the All roll's) adds a pace bar.
// Under the card (admins), the signal-or-noise line about the same window (HomeNoiseLine.jsx).
// Taps: the block opens the Bankroll Overview (admins), the trip's page (trip mode) or Results; the
// goals open the dashboard's Goals; the noise line Analytics (onOpenNoise).
// Data (admins only, every request gated on `admin`): the ledger from last month's first (or a
// yearly goal's Jan 1), the trip list and the current trip's own payload (GET /trips/:id: its
// results, cash sessions and tagged transactions, which the trip page adds up the same way). All
// are refetched whenever the shared summary is (App's useBankrolls refetches it when the results
// change, and after any bankroll change).

export default function HomePeriod({ admin, bk, results, schedule, updates, plans = null, rates, currency = 'USD', today, scopeAbove = null, onOpen, onOpenGoals, onOpenNoise }) {
  const summary = admin && bk ? bk.summary : null;
  const allGuide = summary && summary.guide && summary.guide.byKey ? summary.guide.byKey.all : null;
  const goals = useMemo(() => (allGuide && Array.isArray(allGuide.goals) ? allGuide.goals : []), [allGuide]);

  const [trips, setTrips] = useState(null);
  useEffect(() => {
    if (!admin || !summary) return undefined;
    let on = true;
    bk.call('GET', '/trips').then((d) => { if (on) setTrips(d.trips || []); }).catch(() => { if (on) setTrips([]); });
    return () => { on = false; };
  }, [admin, summary]); // eslint-disable-line react-hooks/exhaustive-deps
  const trip = useMemo(() => (admin ? currentTrip(trips, today) : null), [admin, trips, today]);
  const tripId = trip ? trip.id : null;

  // The current trip's payload, the trip page's own (its results, its cash sessions, its tagged
  // expenses and income), so the block's net is the page's 'Trip net'.
  const [tripData, setTripData] = useState(null); // { id, data | null (failed) }
  useEffect(() => {
    if (!admin || !tripId) { setTripData(null); return undefined; }
    let on = true;
    const keep = (data) => { if (on) setTripData({ id: tripId, data }); };
    bk.call('GET', `/trips/${tripId}`).then((d) => keep(d || null)).catch(() => keep(null));
    return () => { on = false; };
  }, [admin, tripId, summary]); // eslint-disable-line react-hooks/exhaustive-deps

  const from = ledgerFrom(today, { goals });
  const ledgerKey = `${from}|${currency}`;
  const [ledger, setLedger] = useState(null); // { key, entries | null (failed) }
  useEffect(() => {
    if (!admin || !summary) return undefined;
    let on = true;
    bk.call('GET', `/ledger?bankroll=all&from=${from}&currency=${encodeURIComponent(currency)}`)
      .then((d) => { if (on) setLedger({ key: ledgerKey, entries: Array.isArray(d.entries) ? d.entries : [] }); })
      .catch(() => { if (on) setLedger({ key: ledgerKey, entries: null }); });
    return () => { on = false; };
  }, [admin, summary, ledgerKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const ledgerReady = !!ledger && ledger.key === ledgerKey;
  const entries = ledgerReady ? ledger.entries : null;
  // The ledger could not load: the block falls back to the tournament results, labelled as such,
  // rather than staying empty.
  const ledgerFailed = ledgerReady && !entries;

  const cur = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG.USD;
  const model = useMemo(() => {
    const money = (v, signed) => fmtMoney(v, cur, { signed: !!signed });
    const base = { today, currency, money, results, schedule, updates, plans, rates, currencyOf: (r) => nativeCurrency(r.venue) };
    if (!admin || ledgerFailed) return buildPeriod({ ...base, isAdmin: false });
    // Wait for what decides the window (the trips, and the current trip's payload) and for the
    // ledger, so the block does not open on the month and jump to the trip.
    if (trips === null || (trip && !(tripData && tripData.id === trip.id)) || !entries) return null;
    if (trip && !tripData.data) return buildPeriod({ ...base, isAdmin: true, ledger: entries }); // the trip did not load
    const scopeName = trip && trip.bankroll !== 'all'
      ? (trip.bankroll === 'main' ? 'Main' : ((bk.bankrolls || []).find((b) => String(b.id) === String(trip.bankroll)) || {}).name || 'One bankroll')
      : null;
    return buildPeriod({
      ...base, isAdmin: true, ledger: entries, trip, tripData: trip ? tripData.data : null, tripScopeName: scopeName,
    });
  }, [admin, ledgerFailed, trips, trip, tripData, entries, results, schedule, updates, plans, rates, currency, today, summary]); // eslint-disable-line react-hooks/exhaustive-deps

  // The All roll's goals, against the same ledger. A profit target is set in the summary's currency.
  const goalRows = useMemo(() => {
    if (!admin || !entries || !goals.length) return [];
    const sumCur = (summary && summary.currency) || 'USD';
    const inCur = goals.map((g) => (g.metric === 'profit' && sumCur !== currency
      ? { ...g, target: convertMoney(g.target, sumCur, currency, summary.rates) ?? g.target }
      : g));
    return goalLines(inCur, entries, today, (v) => fmtMoney(v, cur));
  }, [admin, entries, goals, today, currency, summary]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!model) return null;
  const net = model.net == null ? '—' : fmtMoney(model.net, cur, { signed: true });
  const tone = model.net == null ? ' is-empty' : model.net > 0 ? ' is-pos' : model.net < 0 ? ' is-neg' : '';
  const open = () => onOpen && onOpen(model.mode === 'trip' && trip ? { kind: 'trip', tripId: trip.id } : { kind: 'overview' });
  const where = model.mode === 'trip' ? 'the trip' : admin && !ledgerFailed ? 'the bankroll overview' : 'Results';
  return (
    <section className="dashboard-section hm-period" aria-label={`${model.title}: the numbers`}>
      <div className="dashboard-section-header hm-period-head">
        <div className="hm-cell hm-sec-title"><span className="hm-clip">{model.title}</span></div>
        {/* Not twice in a row: the bankroll line's header above may already say it. */}
        {model.scope !== scopeAbove && <span className="hm-cell hm-f-2xs hm-period-scope">{model.scope}</span>}
      </div>
      <button type="button" className="hm-period-card" onClick={open}
        aria-label={`${model.title}: ${net}${model.sample ? `, ${model.sample}` : ''}. Open ${where}`}>
        <span className="hm-period-lead">
          <span className="hm-period-l">
            <span className={'hm-cell hm-f-disp hm-period-net' + tone}>{net}</span>
            <span className="hm-cell hm-f-xs hm-period-sample"><span className="hm-clip">{model.sample}</span></span>
          </span>
          <span className="hm-period-side">
            <span className="hm-cell hm-f-sm hm-period-s1" title={model.side[0].title}><span className="hm-clip">{model.side[0].text}</span></span>
            <span className="hm-cell hm-f-xs hm-period-s2" title={model.side[1].title}><span className="hm-clip">{model.side[1].text}</span></span>
          </span>
        </span>
        {model.rows.map((r) => (
          <span key={r.key} className="hm-prow" title={r.title}>
            <span className="hm-cell hm-f-sm hm-prow-l">
              <span className="hm-clip">{r.label}{r.sample ? <span className="hm-prow-s">{r.sample}</span> : null}</span>
            </span>
            <span className={'hm-cell hm-f-sm-b hm-prow-v' + (r.muted ? ' is-muted' : '')}><span className="hm-clip">{r.value}</span></span>
          </span>
        ))}
      </button>
      {admin && <HomeNoiseLine model={model} results={results} currency={currency} bk={bk} onOpen={onOpenNoise} />}
      {goalRows.length > 0 && (
        <button type="button" className="hm-goals" onClick={onOpenGoals}
          aria-label={`Goals: ${goalRows.map((g) => `${g.label}, ${g.value}, ${g.note}`).join('; ')}. Open them in the bankroll dashboard`}>
          {goalRows.map((g) => (
            <span key={g.id} className={`hm-goal is-${g.tone}`}>
              <span className="hm-prow hm-goal-line">
                <span className="hm-cell hm-f-sm hm-prow-l">
                  <span className="hm-clip">{g.label}<span className="hm-prow-s hm-goal-note">{g.note}</span></span>
                </span>
                <span className={'hm-cell hm-f-sm-b hm-prow-v' + (g.muted ? ' is-muted' : '')} title={g.title}><span className="hm-clip">{g.value}</span></span>
              </span>
              <span className="hm-goal-bar" aria-hidden="true">
                <span className="hm-goal-fill" style={{ width: `${g.fill * 100}%` }} />
                {g.tick != null && <span className="hm-goal-tick" style={{ left: `${g.tick * 100}%` }} />}
              </span>
            </span>
          ))}
        </button>
      )}
    </section>
  );
}
