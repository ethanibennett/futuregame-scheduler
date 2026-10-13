import React, { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import Icon from './Icon.jsx';
import { FirstRun } from './EmptyState.jsx';
import ShareMenu from './ShareMenu.jsx';
import WrapUpViewer from './WrapUpViewer.jsx';
import { API_URL } from '../utils/api.js';
import {
  getVenueInfo, normaliseDate, getToday, currencySymbol, nativeCurrency,
  CURRENCY_CONFIG, formatCurrencyAmount, convertAmount, isPOYEligible,
  calculatePOYPoints, isSixMax, haptic, ordinalSuffix, parseTournamentTime,
} from '../utils/utils.js';
import ResultsCurve from './ResultsCurve.jsx';
import { BankrollSwitcher, BankrollManager, BankrollPicker } from './Bankrolls.jsx';
import { filterByBankroll, balancesFromSummary, defaultBankrollFor } from '../utils/bankrolls.js';
import BankrollDashboardSheet from './BankrollDashboardSheet.jsx';
import ResetResults from './ResetResults.jsx';
import { resetScope } from '../utils/reset-results.js';
import { resultMoney, awaitingResults, eventNo } from '../utils/home.js';
import { resolveConditions } from '../utils/home-upnext.js';
import { publishDisplayCurrency } from '../hooks/useDisplayCurrency.js';
import AnalyticsLauncher from './AnalyticsLauncher.jsx';
import { ResultsKindTabs } from './CashLive.jsx';
import { useResultsKind, setResultsKind } from '../hooks/useLiveCashSession.js';
// BETA cash sessions, admins only: lazy like the tax report.
const CashSessionsView = lazy(() => import('./CashSessions.jsx'));
// BETA tax report, admins only: lazy so nobody else downloads it (or its jsPDF export).
const TaxReportView = lazy(() => import('./TaxReportView.jsx'));
// BETA expenses, income and trips, admins only, lazy for the same reason.
const ExpensesSection = lazy(() => import('./Expenses.jsx'));

// ── Tracking Entry Form ─────────────────────────────────────
// isNew with isEdit: a NEW result for one known event (the home's To log), so no event picker,
// but it reads as logging, not editing.
function TrackingEntryForm({ tournaments, mySchedule, existingEntryIds, initialValues, tournamentLabel, entryForPOY, onSubmit, onCancel, isEdit, isNew = false, bankrolls }) {
  const [tournamentId, setTournamentId] = useState(initialValues?.tournamentId || '');
  const [numEntries, setNumEntries] = useState(initialValues?.numEntries || 1);
  const [cashed, setCashed] = useState(initialValues?.cashed || false);
  const [finishPlace, setFinishPlace] = useState(initialValues?.finishPlace || '');
  const [cashAmount, setCashAmount] = useState(initialValues?.cashAmount || '');
  const [notes, setNotes] = useState(initialValues?.notes || '');
  const [totalFieldSize, setTotalFieldSize] = useState(initialValues?.totalEntries || '');
  const [showLfg, setShowLfg] = useState(false);
  const [bankrollId, setBankrollId] = useState(initialValues?.bankrollId || 'main'); // beta: only sent when `bankrolls` is

  const tournamentOptions = useMemo(() => {
    if (isEdit) return [];
    const scheduleIds = new Set((mySchedule || []).map(t => t.id));
    return (tournaments || [])
      .filter(t => !existingEntryIds || !existingEntryIds.has(t.id))
      .sort((a, b) => {
        const aS = scheduleIds.has(a.id) ? 0 : 1;
        const bS = scheduleIds.has(b.id) ? 0 : 1;
        if (aS !== bS) return aS - bS;
        return new Date(a.date) - new Date(b.date);
      });
  }, [tournaments, mySchedule, existingEntryIds, isEdit]);

  const showFieldSize = useMemo(() => {
    if (isEdit && entryForPOY) return isPOYEligible(entryForPOY);
    if (!tournamentId || !tournaments) return false;
    const t = tournaments.find(t => t.id === parseInt(tournamentId));
    return t ? isPOYEligible(t) : false;
  }, [isEdit, entryForPOY, tournamentId, tournaments]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isEdit && !tournamentId) return;
    onSubmit({
      tournamentId: parseInt(tournamentId),
      numEntries: parseInt(numEntries) || 1,
      cashed,
      finishPlace: cashed && finishPlace ? parseInt(finishPlace) : null,
      cashAmount: cashed && cashAmount ? parseInt(cashAmount) : 0,
      notes: notes || null,
      totalFieldSize: totalFieldSize ? parseInt(totalFieldSize) : null,
      ...(bankrolls ? { bankrollId } : {})
    });
  };

  return (
    <form onSubmit={handleSubmit} className="tracking-card" style={{marginBottom:'calc(var(--subrow) * 2)'}}>
      {/* Every row of the form a whole number of r (a 3r title, 2r labels over 5r fields, 2r
          between groups), so its controls and everything under the form start on r lines. */}
      <div style={{fontSize:'calc(var(--gu) * 1.325)',fontWeight:700,color:'var(--text)',lineHeight:'calc(var(--subrow) * 3)',marginBottom:'var(--subrow)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
        {isEdit ? `${isNew ? 'Log' : 'Edit'}: ${tournamentLabel}` : 'Log Tournament Result'}
      </div>

      {!isEdit && (
        <div className="filter-group" style={{marginBottom:'calc(var(--subrow) * 2)'}}>
          <label>Tournament</label>
          <select value={tournamentId} onChange={e => setTournamentId(e.target.value)} required>
            <option value="">Select event...</option>
            {tournamentOptions.map(t => (
              <option key={t.id} value={t.id}>
                #{t.event_number} &mdash; {t.event_name} ({t.date}) &mdash; {currencySymbol(t.venue)}{Number(t.buyin).toLocaleString()}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="tracking-form-grid">
        <div className="filter-group">
          <label>Buy-ins (incl. re-entries)</label>
          <input type="number" min="1" max="50" value={numEntries}
            onChange={e => setNumEntries(e.target.value)} />
        </div>
        <div className="filter-group">
          <label>Cashed?</label>
          <div style={{display:'flex',gap:'var(--gu)',alignItems:'center'}}>
            <button type="button" className={`filter-chip ${!cashed ? 'active' : ''}`}
              onClick={() => { setCashed(false); setShowLfg(false); }}>No</button>
            <button type="button" className={`filter-chip ${cashed ? 'active' : ''}`}
              onClick={() => { if (!cashed) { setCashed(true); setShowLfg(true); setTimeout(() => setShowLfg(false), 1000); } }}>Yes</button>
            {showLfg && <span className="lfg-burst" style={{fontSize:'calc(var(--gu) * 1.325)',marginLeft:'var(--space-xs)'}}>lfg!</span>}
          </div>
        </div>
      </div>

      {cashed && (
        <div className="tracking-form-grid">
          <div className="filter-group">
            <label>Finish Place</label>
            <input type="number" min="1" value={finishPlace}
              onChange={e => setFinishPlace(e.target.value)} placeholder="e.g. 3" />
          </div>
          <div className="filter-group">
            <label>Cash Amount ($)</label>
            <input type="number" min="0" value={cashAmount}
              onChange={e => setCashAmount(e.target.value)} placeholder="e.g. 15000" />
          </div>
        </div>
      )}

      {showFieldSize && (
        <div className="filter-group" style={{marginBottom:'calc(var(--subrow) * 2)'}}>
          <label>Field Size (total entries)</label>
          <input type="number" min="1" value={totalFieldSize}
            onChange={e => setTotalFieldSize(e.target.value)} placeholder="e.g. 8500"
            style={{padding:'var(--space-ml) var(--space-lg)',border:'var(--bw-1) solid var(--border)',borderRadius:'var(--radius-sm)',
              background:'var(--bg)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'calc(var(--gu) * 1.325)',width:'100%'}} />
          <span style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',lineHeight:'calc(var(--subrow) * 2)',display:'block'}}>
            Used for POY points calculation
          </span>
        </div>
      )}

      {bankrolls && <BankrollPicker bankrolls={bankrolls} value={bankrollId} onChange={setBankrollId} />}

      <div className="filter-group" style={{marginBottom:'calc(var(--subrow) * 2)'}}>
        <label>Notes (optional)</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Optional notes about this session"
          style={{padding:'var(--space-ml) var(--space-lg)',border:'var(--bw-1) solid var(--border)',borderRadius:'var(--radius-sm)',
            background:'var(--bg)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'calc(var(--gu) * 1.325)',width:'100%'}} />
      </div>

      <div style={{display:'flex',gap:'var(--gu)'}}>
        <button type="submit" className="btn btn-primary btn-sm" style={{width:'calc(var(--gu) * 10)',padding:0}}>
          {isEdit && !isNew ? 'Save Changes' : 'Log Result'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" style={{width:'calc(var(--gu) * 6)',padding:0}} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ── Tracking Entry Row ──────────────────────────────────────
function TrackingEntryRow({ entry, onEdit, onDelete, isEditing, onUpdate, onCancelEdit, displayCurrency, exchangeRates, bankrolls }) {
  const from = nativeCurrency(entry.venue);
  const to = displayCurrency === 'NATIVE' ? from : displayCurrency;
  const cv = (val) => convertAmount(val, from, to, exchangeRates);
  const fmt = (val) => formatCurrencyAmount(val, to);
  const fmtSigned = (val) => { const c = cv(val); return (c >= 0 ? '+' : '') + formatCurrencyAmount(c, to); };

  // The ledger's rule (utils/home.js): a cash counts only when the entry cashed.
  const { cost: totalCost, net: profit } = resultMoney(entry);
  const poyEligible = isPOYEligible(entry);
  const poyPoints = poyEligible
    ? calculatePOYPoints(entry.buyin, entry.finish_place, entry.total_entries, !!entry.cashed, entry.event_name)
    : null;

  if (isEditing) {
    return (
      <TrackingEntryForm
        initialValues={{
          tournamentId: entry.tournament_id,
          numEntries: entry.num_entries,
          cashed: !!entry.cashed,
          finishPlace: entry.finish_place,
          cashAmount: entry.cash_amount,
          notes: entry.notes,
          totalEntries: entry.total_entries,
          bankrollId: entry.bankroll_id ?? 'main'
        }}
        bankrolls={bankrolls}
        entryForPOY={entry}
        tournamentLabel={`#${entry.event_number} ${entry.event_name}`}
        onSubmit={onUpdate}
        onCancel={onCancelEdit}
        isEdit
      />
    );
  }

  return (
    <div className="tracking-card" data-entry={entry.id}>
      {/* Date on its 2r line, the event name's first baseline 3r below it, the profit seated on
          line 3 at the right: 5r, then 1r. */}
      <div className="tracking-head">
        <div>
          <div className="tr-seat tr-seat-2" style={{fontSize:'calc(var(--gu) * 1.060)',color:'var(--text-muted)',fontFamily:"'Univers Condensed','Univers',sans-serif",letterSpacing:'0.03em'}}>
            {entry.date} · #{entry.event_number}
          </div>
          <div className="tr-seat tr-seat-3" style={{fontSize:'calc(var(--gu) * 1.296)',fontWeight: 'var(--fw-bold)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
            {entry.event_name}
          </div>
        </div>
        <div style={{textAlign:'right',flexShrink:0}}>
          <div style={{fontFamily:"var(--serif)",fontSize:'calc(var(--gu) * 1.473)',fontWeight:700}}
            className={'tr-seat tr-seat-3 ' + (profit >= 0 && entry.cashed ? 'tracking-profit-pos' : 'tracking-profit-neg')}>
            {fmtSigned(profit)}
          </div>
        </div>
      </div>

      <div className="cal-detail-grid" style={{marginBottom:'var(--space-md)'}}>
        <div className="cal-detail-item">
          <span className="cal-detail-label">Cost</span>
          <span className="cal-detail-value">{fmt(cv(totalCost))}</span>
        </div>
        <div className="cal-detail-item">
          <span className="cal-detail-label">Entries</span>
          <span className="cal-detail-value">{entry.num_entries || 1}</span>
        </div>
        {entry.cashed ? (
          <React.Fragment>
            <div className="cal-detail-item">
              <span className="cal-detail-label">Cashed</span>
              <span className="cal-detail-value">{fmt(cv(entry.cash_amount))}</span>
            </div>
            <div className="cal-detail-item">
              <span className="cal-detail-label">Finish</span>
              <span className="cal-detail-value">{entry.finish_place ? `${entry.finish_place}${ordinalSuffix(entry.finish_place)}` : '\u2014'}</span>
            </div>
          </React.Fragment>
        ) : (
          <div className="cal-detail-item">
            <span className="cal-detail-label">Result</span>
            <span className="cal-detail-value" style={{color:'var(--text-muted)'}}>No cash</span>
          </div>
        )}
        {poyEligible && (
          <div className="cal-detail-item">
            <span className="cal-detail-label">POY Pts</span>
            <span className={`cal-detail-value ${poyPoints > 0 ? 'tracking-poy' : ''}`}>
              {poyPoints !== null ? poyPoints.toFixed(1) : '\u2014'}
            </span>
          </div>
        )}
      </div>

      {poyEligible && !entry.total_entries && (
        <p className="tr-seat tr-seat-2" style={{fontSize:'calc(var(--gu) * 1.060)',color:'#d97706',margin:'0 0 var(--space-md)'}}>
          \u2691 Edit to add field size for POY points
        </p>
      )}

      {entry.notes && (
        <p className="tr-seat tr-seat-2" style={{fontSize:'calc(var(--gu) * 1.149)',color:'var(--text-muted)',fontStyle:'italic',margin:'0 0 var(--space-md)'}}>{entry.notes}</p>
      )}

      <div className="tracking-actions">
        <button className="btn btn-ghost btn-sm" style={{width:'calc(var(--gu) * 5)'}} onClick={onEdit}>Edit</button>
        <button className="btn btn-ghost btn-sm" style={{width:'calc(var(--gu) * 7)',color:'var(--accent2)'}} onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

// ── Tracking View (main export) ─────────────────────────────
export default function TrackingView({ trackingData: allTrackingData, tournaments, mySchedule, onAdd, onUpdate, onDelete, onResetResults, myActiveUpdates, isAdmin, token, bk, intent = null, onIntentDone }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [pendingFormId, setPendingFormId] = useState(null);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showWrapUp, setShowWrapUp] = useState(false);
  const [showTaxReport, setShowTaxReport] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState(
    () => localStorage.getItem('trackingCurrency') || 'NATIVE'
  );
  const [exchangeRates, setExchangeRates] = useState(null);
  const [ratesStale, setRatesStale] = useState(false);

  useEffect(() => {
    fetch(API_URL + '/exchange-rates')
      .then(r => r.json())
      .then(data => { setExchangeRates(data.rates); setRatesStale(data.stale); })
      .catch(() => { setExchangeRates({ EUR:0.91, GBP:0.79, CAD:1.36, AUD:1.53, JPY:149.5, USD:1 }); setRatesStale(true); });
  }, []);

  // Bankrolls (beta, admins only): App's useBankrolls, shared with the home (one summary). For
  // everyone else `bk.selected` is 'all', the filter is the identity, and `formBankrolls` is null
  // so the form neither shows nor sends a bankroll.
  const [showBankrolls, setShowBankrolls] = useState(false);
  const [showBankrollDashboard, setShowBankrollDashboard] = useState(false);
  const closeBankrollDashboard = useCallback(() => setShowBankrollDashboard(false), []);
  const trackingData = useMemo(() => filterByBankroll(allTrackingData, bk.selected), [allTrackingData, bk.selected]);
  // Balances come from the server's combined ledger (every ledger source), not from summing the
  // results this tab happens to hold — see docs/bankrolls.md "The combined ledger".
  const bankrollBalances = useMemo(() => balancesFromSummary(bk.summary), [bk.summary]);
  const formBankrolls = bk.enabled && bk.bankrolls.length ? bk.bankrolls : null;
  const resultsKind = useResultsKind();
  const newEntryBankroll = { bankrollId: defaultBankrollFor(bk.selected, bk.bankrolls) };

  const onCurrencyChange = useCallback((c) => {
    setDisplayCurrency(c);
    // Stored and announced: the home follows this setting, at once (hooks/useDisplayCurrency.js).
    publishDisplayCurrency(c);
  }, []);

  const stats = useMemo(() => {
    let totalBuyins = 0, totalCashes = 0, eventsCashed = 0;
    const poyScores = [];
    for (const e of trackingData) {
      const from = nativeCurrency(e.venue);
      // Native is per row; a total of euros and dollars is in no currency, so it sums in USD
      // (which fmtStat labels it).
      const to = displayCurrency === 'NATIVE' ? 'USD' : displayCurrency;
      const cost = (e.buyin || 0) * (e.num_entries || 1);
      totalBuyins += convertAmount(cost, from, to, exchangeRates);
      if (e.cashed) { totalCashes += convertAmount(e.cash_amount || 0, from, to, exchangeRates); eventsCashed++; }
      if (isPOYEligible(e)) {
        const pts = calculatePOYPoints(e.buyin, e.finish_place, e.total_entries, !!e.cashed, e.event_name);
        if (pts !== null) poyScores.push(pts);
      }
    }
    const profit = totalCashes - totalBuyins;
    const roi = totalBuyins > 0 ? ((profit / totalBuyins) * 100) : 0;
    poyScores.sort((a, b) => b - a);
    const totalPOY = poyScores.slice(0, 15).reduce((s, p) => s + p, 0);
    return { totalBuyins, totalCashes, profit, roi, totalEntries: trackingData.length, eventsCashed,
             totalPOY, poyEventCount: poyScores.length, hasMoreThan15: poyScores.length > 15 };
  }, [trackingData, displayCurrency, exchangeRates]);

  const fmtStat = (val) => {
    const code = displayCurrency === 'NATIVE' ? 'USD' : displayCurrency;
    return formatCurrencyAmount(val, code);
  };

  const existingEntryIds = useMemo(() => new Set(allTrackingData.map(e => e.tournament_id)), [allTrackingData]);

  // The newest scheduled event that is over with no result: the home's To log rule (utils/home.js
  // awaitingResults), so a bagged or running event, today's not yet played, one marked "Didn't
  // play", and a plan's branch that resolved off (never played) are not asked about here either.
  const pendingEvent = useMemo(() => {
    // The plans resolved exactly as the home resolves them (DashboardView: the feed names a parent
    // that is not on the schedule), so the two never disagree about a branch.
    const plans = resolveConditions(mySchedule, myActiveUpdates, allTrackingData, { events: tournaments, startOf: parseTournamentTime });
    const first = awaitingResults(mySchedule, allTrackingData, myActiveUpdates, { today: getToday(), startOf: parseTournamentTime, plans })[0];
    return first ? first.event : null;
  }, [mySchedule, allTrackingData, myActiveUpdates, tournaments]);

  // What the home asked for (App's resultsIntent): a form, an entry, a sheet. The cash and
  // expense ones are handed to the view that owns that form, which reports back itself.
  const [intentForm, setIntentForm] = useState(null); // { tournamentId, label, event, initial }
  const [focusEntry, setFocusEntry] = useState(null);
  const intentFormRef = React.useRef(null);
  const kind = intent ? intent.kind : null;
  const cashIntent = isAdmin && kind && kind.startsWith('cash') ? intent : null;
  const expenseIntent = isAdmin && (kind === 'expense' || kind === 'trip') ? intent : null;
  useEffect(() => {
    if (!intent) return;
    if (intent.kind.startsWith('cash')) {
      if (isAdmin) setResultsKind('cash'); else onIntentDone && onIntentDone();
      return;
    }
    setResultsKind('tournaments');
    // Expenses & income (the Log menu's choice) and a trip's page (the home's period block in trip
    // mode) belong to ExpensesSection, which reports back itself.
    if (intent.kind === 'expense' || intent.kind === 'trip') { if (!isAdmin) onIntentDone && onIntentDone(); return; }
    if (intent.kind === 'tournament') {
      setEditingId(null);
      setPendingFormId(null);
      if (intent.tournamentId) {
        const ev = intent.event || (mySchedule || []).find((t) => t.id === intent.tournamentId) || {};
        setShowAddForm(false);
        setIntentForm({
          tournamentId: intent.tournamentId,
          event: ev,
          label: [eventNo(ev.event_number), ev.event_name].filter(Boolean).join(' '),
          initial: { tournamentId: intent.tournamentId, ...(intent.prefill || {}), ...newEntryBankroll },
        });
      } else {
        setIntentForm(null);
        setShowAddForm(true);
      }
    } else if (intent.kind === 'entry') {
      setFocusEntry({ id: intent.entryId, at: intent.at || Date.now() });
    } else if (intent.kind === 'import') {
      if (bk.enabled) setShowBankrollDashboard(true);
    } else if (intent.kind === 'awaiting') {
      setFocusEntry({ id: 'pending', at: intent.at || Date.now() });
    }
    onIntentDone && onIntentDone();
  }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bring what was asked for into view: the form, or the entry (briefly ringed). The tab's own
  // scroller moves (the content area, or the desktop pane), never the window: scrollIntoView
  // would scroll the document too and slide the top bar off the screen.
  const bringIntoView = (el, centre) => {
    const sc = el && el.closest('.content-area, .dk-scroll');
    if (!sc) return;
    const box = sc.getBoundingClientRect(), r = el.getBoundingClientRect();
    sc.scrollTop += centre ? (r.top + r.height / 2) - (box.top + box.height / 2) : r.top - box.top;
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    if (!intentForm && !showAddForm) return;
    requestAnimationFrame(() => bringIntoView(intentFormRef.current, false));
  }, [intentForm, showAddForm]);
  useEffect(() => {
    if (!focusEntry) return undefined;
    let t1 = 0;
    const t0 = setTimeout(() => {
      const el = document.querySelector(focusEntry.id === 'pending'
        ? '.tab-panel[data-tab="tracking"] .tracking-pending'
        : `.tab-panel[data-tab="tracking"] [data-entry="${focusEntry.id}"]`);
      if (!el) return;
      bringIntoView(el, true);
      el.classList.add('is-focus');
      t1 = setTimeout(() => el.classList.remove('is-focus'), 2000);
    }, 50);
    return () => { clearTimeout(t0); clearTimeout(t1); };
  }, [focusEntry]);

  if (showTaxReport && isAdmin) {
    return (
      <Suspense fallback={null}>
        <TaxReportView token={token} onClose={() => setShowTaxReport(false)} />
      </Suspense>
    );
  }

  return (
    <div>
      {bk.enabled && (
        <BankrollSwitcher bk={bk} balances={bankrollBalances} onManage={() => setShowBankrolls(true)}
          onDashboard={() => setShowBankrollDashboard(true)} />
      )}
      {showBankrolls && (
        <BankrollManager bk={bk} balances={bankrollBalances} onClose={() => setShowBankrolls(false)} />
      )}
      {/* Cash sessions (beta, admins): Tournaments | Cash. Everyone else sees no strip. */}
      {isAdmin && <ResultsKindTabs />}
      {isAdmin && resultsKind === 'cash' ? (
        <Suspense fallback={null}><CashSessionsView token={token} bk={bk} intent={cashIntent} onIntentDone={onIntentDone} /></Suspense>
      ) : (<>
      <div className="section-header">
        <h2>Tracking</h2>
        <div style={{display:'flex',gap:'var(--gu)',alignItems:'center'}}>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" style={{width:'var(--col)',padding:0}} onClick={() => setShowTaxReport(true)} title="Tax report (beta)">
              Tax report
            </button>
          )}
          {trackingData.length > 0 && (
            <button className="btn-share-overlay ctl" style={{width:'calc(var(--gu) * 7)',height:'calc(var(--subrow) * 4)',padding:0}} onClick={() => setShowShareMenu(true)} title="Share & Social">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Share
            </button>
          )}
          <button className="btn btn-primary btn-sm" style={{width:'var(--col)',padding:0}} onClick={() => { setShowAddForm(f => !f); setEditingId(null); }}>
            {showAddForm ? 'Cancel' : '+ Log Result'}
          </button>
        </div>
      </div>

      {trackingData.length > 0 && (
        <div className="tracking-card" style={{marginBottom:'calc(var(--subrow) * 2)'}}>
          <div className="tracking-summary-head">
            <span className="tr-seat tr-seat-3" style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Summary</span>
            {exchangeRates && (
              <select value={displayCurrency} onChange={e => onCurrencyChange(e.target.value)}
                style={{fontSize:'calc(var(--gu) * 1.031)',padding:'0 var(--space-sm)',border:'var(--bw-hair) solid var(--border)',borderRadius:'calc(var(--subrow) * 0.75)',
                  background:'var(--surface)',color:'var(--text)',cursor:'pointer',fontWeight: 'var(--fw-bold)'}}>
                <option value="NATIVE">Native</option>
                {(exchangeRates ? Object.keys(CURRENCY_CONFIG) : ['USD','EUR']).map(c => (
                  <option key={c} value={c}>{(CURRENCY_CONFIG[c]||{}).symbol} {c}</option>
                ))}
              </select>
            )}
          </div>
          <div className="tracking-stats">
            <div className="cal-detail-item">
              <span className="cal-detail-label">Total Buyins</span>
              <span className="cal-detail-value">{fmtStat(stats.totalBuyins)}</span>
            </div>
            <div className="cal-detail-item">
              <span className="cal-detail-label">Total Cashes</span>
              <span className="cal-detail-value">{fmtStat(stats.totalCashes)}</span>
            </div>
            <div className="cal-detail-item">
              <span className="cal-detail-label">Profit</span>
              <span className={`cal-detail-value ${stats.profit >= 0 ? 'tracking-profit-pos' : 'tracking-profit-neg'}`}>
                {/* formatCurrencyAmount already prepends its own sign, so the
                    manual '-' rendered a losing series as two minus signs -
                    and the row formatter twelve lines up did it correctly, so
                    the summary card and the rows disagreed on one page. */}
                {stats.profit >= 0 ? '+' : ''}{fmtStat(stats.profit)}
              </span>
            </div>
            <div className="cal-detail-item">
              <span className="cal-detail-label">ROI</span>
              <span className={`cal-detail-value ${stats.roi >= 0 ? 'tracking-profit-pos' : 'tracking-profit-neg'}`}>
                {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
              </span>
            </div>
            {stats.poyEventCount > 0 && (
              <div className="cal-detail-item">
                <span className="cal-detail-label">POY Pts{stats.hasMoreThan15 ? ' (Top 15)' : ''}</span>
                <span className="cal-detail-value tracking-poy">{stats.totalPOY.toFixed(1)}</span>
              </div>
            )}
          </div>
          <ResultsCurve
            entries={trackingData}
            convert={(v) => convertAmount(v, 'USD', displayCurrency === 'NATIVE' ? 'USD' : displayCurrency, exchangeRates)}
            format={fmtStat}
          />
          <p className="tr-seat tr-seat-2" style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',margin:0}}>
            {stats.totalEntries} event{stats.totalEntries !== 1 ? 's' : ''} played · {stats.eventsCashed} cash{stats.eventsCashed !== 1 ? 'es' : ''}
            {stats.poyEventCount > 0 && <> · {stats.poyEventCount} POY event{stats.poyEventCount !== 1 ? 's' : ''}</>}
            {displayCurrency !== 'NATIVE' && exchangeRates && (
              <> · {ratesStale ? 'fallback rates' : 'live rates'}</>
            )}
          </p>
        </div>
      )}

      {/* Analytics BETA: app admins only (staged rollout); everyone else sees no change. */}
      {bk.enabled && showBankrollDashboard && <BankrollDashboardSheet bk={bk} onClose={closeBankrollDashboard} />}
      {isAdmin && trackingData.length > 0 && <AnalyticsLauncher bankroll={bk.selected} />}

      {/* Expenses & income BETA: app admins only; follows the bankroll switcher's selection. */}
      {isAdmin && bk.enabled && (
        <Suspense fallback={null}>
          <ExpensesSection token={token} bankroll={bk.selected} bankrolls={bk.bankrolls} rates={exchangeRates}
            events={allTrackingData} onChanged={bk.refresh} intent={expenseIntent} onIntentDone={onIntentDone} />
        </Suspense>
      )}

      {pendingEvent && !showAddForm && !intentForm && pendingFormId !== pendingEvent.id && (
        <div className="tracking-card tracking-pending" style={{padding:'calc(var(--subrow) * 2) var(--gu)', marginBottom:'calc(var(--subrow) * 2)', border:0, outline:'var(--bw-1) dashed var(--accent)', outlineOffset:'calc(var(--bw-1) * -1)'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:'calc(var(--gu) * 1.031)', lineHeight:'calc(var(--subrow) * 2)', color:'var(--text-muted)', fontFamily:"'Univers Condensed','Univers',sans-serif", letterSpacing:'0.03em'}}>
                {pendingEvent.date} · #{pendingEvent.event_number?.replace(/^[A-Za-z]+-/, '')}
              </div>
              <div style={{fontSize:'calc(var(--gu) * 1.252)', lineHeight:'calc(var(--subrow) * 3)', fontWeight: 'var(--fw-bold)', color:'var(--text)', fontFamily:"'Univers Condensed','Univers',sans-serif", overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                {pendingEvent.event_name}
              </div>
              <div style={{fontSize:'calc(var(--gu) * 1.060)', lineHeight:'calc(var(--subrow) * 2)', color:'var(--text-muted)'}}>
                Awaiting result
              </div>
            </div>
            <button className="btn btn-primary btn-sm" style={{flexShrink:0, marginLeft:'var(--gu)', width:'var(--col)', padding:0}}
              onClick={() => setPendingFormId(pendingEvent.id)}>
              Log Result
            </button>
          </div>
        </div>
      )}

      {pendingFormId && pendingEvent && (
        <TrackingEntryForm
          tournaments={tournaments}
          mySchedule={mySchedule}
          existingEntryIds={existingEntryIds}
          initialValues={{ tournamentId: pendingFormId, ...newEntryBankroll }}
          bankrolls={formBankrolls}
          tournamentLabel={`#${(pendingEvent.event_number || '').replace(/^[A-Za-z]+-/, '')} ${pendingEvent.event_name}`}
          entryForPOY={pendingEvent}
          onSubmit={(data) => { onAdd({ ...data, tournamentId: pendingFormId }); setPendingFormId(null); }}
          onCancel={() => setPendingFormId(null)}
          isEdit
        />
      )}

      <div ref={intentFormRef}>
      {/* The home's To log "Cashed": this event's form, prefilled from its bust (bullets, a deal's
          place and payout, the field). It logs and never edits: a result already there (another
          device, the live-update Finish) is refused, not overwritten (ifAbsent). */}
      {intentForm && (
        <TrackingEntryForm
          key={'intent-' + intentForm.tournamentId}
          tournaments={tournaments}
          mySchedule={mySchedule}
          existingEntryIds={existingEntryIds}
          initialValues={intentForm.initial}
          bankrolls={formBankrolls}
          tournamentLabel={intentForm.label}
          entryForPOY={intentForm.event}
          onSubmit={(data) => { onAdd({ ...data, tournamentId: intentForm.tournamentId, ifAbsent: true }); setIntentForm(null); }}
          onCancel={() => setIntentForm(null)}
          isEdit
          isNew
        />
      )}

      {showAddForm && (
        <TrackingEntryForm
          tournaments={tournaments}
          mySchedule={mySchedule}
          existingEntryIds={existingEntryIds}
          initialValues={newEntryBankroll}
          bankrolls={formBankrolls}
          onSubmit={(data) => { onAdd(data); setShowAddForm(false); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}
      </div>

      {trackingData.length === 0 && !showAddForm && !pendingFormId ? (
        <FirstRun
          icon="tracking"
          title="Log your first result"
          body="Cashes and bust-outs both count — your ROI needs a few before it tells you anything."
          actionLabel="Log result"
          onAction={() => { setShowAddForm(true); setEditingId(null); }}
        />
      ) : (
        trackingData.map(entry => (
          <TrackingEntryRow
            key={entry.id}
            entry={entry}
            onEdit={() => setEditingId(entry.id)}
            onDelete={() => onDelete(entry.id)}
            isEditing={editingId === entry.id}
            onUpdate={(data) => { onUpdate(entry.id, data); setEditingId(null); }}
            onCancelEdit={() => setEditingId(null)}
            displayCurrency={displayCurrency}
            exchangeRates={exchangeRates}
            bankrolls={formBankrolls}
          />
        ))
      )}

      {/* Delete results: the bankroll on show only, typed confirmation (moved off the home). */}
      {onResetResults && trackingData.length > 0 && (() => {
        const scope = resetScope(bk.selected, { bankrolls: bk.bankrolls, enabled: bk.enabled });
        return (
          <ResetResults
            key={String(scope.key)}
            count={trackingData.length}
            imported={trackingData.reduce((n, e) => n + (Number(e.imported) ? 1 : 0), 0)}
            scope={scope}
            onReset={onResetResults}
          />
        );
      })()}

      {showShareMenu && (
        <ShareMenu
          trackingData={allTrackingData}
          tournaments={tournaments}
          mySchedule={mySchedule}
          myActiveUpdates={myActiveUpdates || []}
          onClose={() => setShowShareMenu(false)}
          onOpenWrapUp={() => setShowWrapUp(true)}
        />
      )}

      {showWrapUp && (
        <WrapUpViewer
          trackingData={allTrackingData}
          tournaments={tournaments}
          onClose={() => setShowWrapUp(false)}
        />
      )}
      </>)}
    </div>
  );
}
