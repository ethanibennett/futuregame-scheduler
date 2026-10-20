import React, { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import Icon from './Icon.jsx';
import { FirstRun } from './EmptyState.jsx';
import ShareMenu from './ShareMenu.jsx';
import WrapUpViewer from './WrapUpViewer.jsx';
import { API_URL } from '../utils/api.js';
import { tournamentPreviewQuery } from '../utils/standing-ui.js';
import {
  getVenueInfo, normaliseDate, getToday, getNow, currencySymbol, nativeCurrency,
  CURRENCY_CONFIG, formatCurrencyAmount, convertAmount, isPOYEligible,
  calculatePOYPoints, isSixMax, haptic, ordinalSuffix, parseTournamentTime,
  getVenueBrandColor, getStripAbbr, splitEventStage,
} from '../utils/utils.js';
import { fmtDay, monthLabel, shareSeries, rangeOptions } from '../utils/backer-page.js';
import './tracking-cards.css';
import { MoneyParts, SwissLines } from './SwissParts.jsx';
import { CardStrip, CardName, CardChevron, MonthBreak, barKeys, stop, BankrollGraph } from './ResultCardParts.jsx';
import ResultsCurve from './ResultsCurve.jsx';
import { BankrollSwitcher, BankrollManager, BankrollPicker } from './Bankrolls.jsx';
import { filterByBankroll, balancesFromSummary, defaultBankrollFor } from '../utils/bankrolls.js';
import ResetResults from './ResetResults.jsx';
import { resetScope } from '../utils/reset-results.js';
import { resultMoney, awaitingResults, eventNo, isoDay } from '../utils/home.js';
import { resolveConditions } from '../utils/home-upnext.js';
import { publishDisplayCurrency } from '../hooks/useDisplayCurrency.js';
import AnalyticsLauncher from './AnalyticsLauncher.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { ResultsKindTabs } from './CashLive.jsx';
import { useResultsKind, setResultsKind } from '../hooks/useLiveCashSession.js';
import { useResultsFocus, clearResultsFocus } from '../hooks/useResultsFocus.js';
import { useHideBankrollFab } from '../hooks/useBankrollFab.js';
// BETA cash sessions, admins only: lazy like the tax report.
const CashSessionsView = lazy(() => import('./CashSessions.jsx'));
// The retired bankroll dashboard's tabs, drawn on this page under the section chips (owner, 2026-10-16).
const BankrollDashboard = lazy(() => import('./BankrollDashboard.jsx'));
// BETA tax report, admins only: lazy so nobody else downloads it (or its jsPDF export).
const TaxReportView = lazy(() => import('./TaxReportView.jsx'));
// BETA expenses, income and trips, admins only, lazy for the same reason.
const ExpensesSection = lazy(() => import('./Expenses.jsx'));
// The Backers block on a result's edit form (the Notify tap), the owner's only: lazy likewise.
const BackerNotify = lazy(() => import('./BackerNotify.jsx'));
const PostsToBackers = lazy(() => import('./PostsToBackers.jsx'));

// ── Tracking Entry Form ─────────────────────────────────────
// isNew with isEdit: a NEW result for one known event (the home's To log), so no event picker,
// but it reads as logging, not editing. conflict: the sentence saying a result is already logged
// for the event (the server refused to log over it); the form keeps what was typed, and its
// submit becomes Replace it (onSubmit's second argument, { replace: true }).
// notify: { token, refId } on an admin's edit of a saved result, for the Backers block under the
// form (components/BackerNotify.jsx: the saved result's backer shares and the Notify tap).
function TrackingEntryForm({ previewToken = null, tournaments, mySchedule, existingEntryIds, initialValues, tournamentLabel, entryForPOY, onSubmit, onCancel, isEdit, isNew = false, bankrolls, conflict = null, notify = null }) {
  const [tournamentId, setTournamentId] = useState(initialValues?.tournamentId || '');
  const [numEntries, setNumEntries] = useState(initialValues?.numEntries || 1);
  const [cashed, setCashed] = useState(initialValues?.cashed || false);
  const [finishPlace, setFinishPlace] = useState(initialValues?.finishPlace || '');
  const [cashAmount, setCashAmount] = useState(initialValues?.cashAmount || '');
  const [notes, setNotes] = useState(initialValues?.notes || '');
  // The line under the game on a backer's session card (owner, 2026-10-15).
  const [subtitle, setSubtitle] = useState(initialValues?.subtitle || '');
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
      subtitle: subtitle.trim() || null,
      totalFieldSize: totalFieldSize ? parseInt(totalFieldSize) : null,
      ...(bankrolls ? { bankrollId } : {})
    }, conflict ? { replace: true } : undefined);
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
        <label>Subheading (optional)</label>
        <input type="text" value={subtitle} maxLength={60} onChange={e => setSubtitle(e.target.value)}
          placeholder="Under the game on backer pages"
          style={{padding:'var(--space-ml) var(--space-lg)',border:'var(--bw-1) solid var(--border)',borderRadius:'var(--radius-sm)',
            background:'var(--bg)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'calc(var(--gu) * 1.325)',width:'100%'}} />
      </div>

      <div className="filter-group" style={{marginBottom:'calc(var(--subrow) * 2)'}}>
        <label>Notes (optional)</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Optional notes about this session"
          style={{padding:'var(--space-ml) var(--space-lg)',border:'var(--bw-1) solid var(--border)',borderRadius:'var(--radius-sm)',
            background:'var(--bg)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'calc(var(--gu) * 1.325)',width:'100%'}} />
      </div>

      {/* Seated like the rest of the card's text (.tr-seat: each line's baseline on a 2r line), so
          the form stays whole r with it. */}
      {conflict && (
        <p className="tr-seat tr-seat-2" role="alert" style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text)',margin:'0 0 calc(var(--subrow) * 2)'}}>
          {conflict}
        </p>
      )}

      <div style={{display:'flex',gap:'var(--gu)'}}>
        <button type="submit" className="btn btn-primary btn-sm" style={{width:'calc(var(--gu) * 10)',padding:0}}>
          {conflict ? 'Replace it' : isEdit && !isNew ? 'Save Changes' : 'Log Result'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" style={{width:'calc(var(--gu) * 6)',padding:0}} onClick={onCancel}>Cancel</button>
      </div>

      {/* The owner's cut of what is typed, before it is saved (Phase 8): the server's own figures;
          nothing posts here. Anyone else gets nothing. */}
      {previewToken && (() => {
        /* An edit is opened from the saved result, with no tournaments list (it crashed here, a blank
           screen, from 2026-10-14 to 10-16): the result row carries its event's fields itself. */
        const t = (tournaments || []).find((x) => String(x.id) === String(tournamentId))
          || (isEdit && entryForPOY ? { ...entryForPOY, id: entryForPOY.tournament_id } : null);
        return (
          <Suspense fallback={null}>
            <PostsToBackers token={previewToken} query={tournamentPreviewQuery({
              tournament: t, numEntries, cashed, cashAmount, currency: t ? nativeCurrency(t.venue) : 'USD',
            })} />
          </Suspense>
        );
      })()}
      {/* Backers (the owner's): the SAVED result's shares and the Notify tap. Nothing posts on
          save; the block draws nothing for any other account. */}
      {notify && (
        <Suspense fallback={null}>
          <BackerNotify token={notify.token} refTable="tracking_entries" refId={notify.refId} />
        </Suspense>
      )}
    </form>
  );
}

// ── Tracking Entry Row ──────────────────────────────────────
function TrackingEntryRow({ entry, onEdit, onDelete, isEditing, onUpdate, onCancelEdit, displayCurrency, exchangeRates, bankrolls, notifyToken = null }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((v) => !v);
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
          subtitle: entry.subtitle,
          totalEntries: entry.total_entries,
          bankrollId: entry.bankroll_id ?? 'main'
        }}
        bankrolls={bankrolls}
        entryForPOY={entry}
        tournamentLabel={`#${entry.event_number} ${entry.event_name}`}
        onSubmit={onUpdate}
        onCancel={onCancelEdit}
        isEdit
        notify={notifyToken ? { token: notifyToken, refId: entry.id } : null}
        previewToken={notifyToken}
      />
    );
  }

  const entries = Number(entry.num_entries) || 1;
  const place = entry.finish_place ? `${entry.finish_place}${ordinalSuffix(entry.finish_place)}` : '';
  const under = entry.cashed
    ? [place, 'cashed ' + fmt(cv(entry.cash_amount))].filter(Boolean).join(' · ')
    : 'cost ' + fmt(cv(totalCost));
  const tone = profit > 0 ? ' is-pos' : profit < 0 ? ' is-neg' : '';
  return (
    <div className={'cal-event-row tr-card' + (open ? ' open' : '')} data-entry={entry.id}>
      <CardStrip venue={entry.venue} property={entry.property} open={open} onToggle={toggle} />
      <div className="cal-event-row-content">
        <div className="cal-event-bar" onClick={toggle} role="button" tabIndex={0} aria-expanded={open} onKeyDown={barKeys(toggle)}>
          <div className="cal-bar-row1">
            <span className="cal-event-time">{[fmtDay(isoDay(entry.date)), entries > 1 ? entries + ' entries' : ''].filter(Boolean).join(' · ')}</span>
            <SwissLines name={entry.event_name} time={[fmtDay(isoDay(entry.date)), entries > 1 ? entries + ' entries' : ''].filter(Boolean).join(' · ')} />
            <span className="cal-event-money">
              <span className={'cal-event-buyin tr-amt' + tone}>{fmtSigned(profit)}</span>
              <span className="cal-event-gtd">{under}</span>
            </span>
          </div>
          <div className="cal-bar-row2">
            <CardName name={entry.event_name} />
          </div>
        </div>
        <CardChevron open={open} onToggle={toggle} />
        <div className={'cal-event-detail-wrap' + (open ? ' open' : '')}>
          <div className="cal-event-detail-inner">
            <div className="cal-event-detail">
              <div className="cal-detail-grid">
                <div className="cal-detail-item">
                  <span className="cal-detail-label">Cost</span>
                  <span className="cal-detail-value">{fmt(cv(totalCost))}</span>
                </div>
                <div className="cal-detail-item">
                  <span className="cal-detail-label">Entries</span>
                  <span className="cal-detail-value">{entries}</span>
                </div>
                {entry.cashed ? (
                  <React.Fragment>
                    <div className="cal-detail-item">
                      <span className="cal-detail-label">Cashed</span>
                      <span className="cal-detail-value">{fmt(cv(entry.cash_amount))}</span>
                    </div>
                    <div className="cal-detail-item">
                      <span className="cal-detail-label">Finish</span>
                      <span className="cal-detail-value">{place || '\u2014'}</span>
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
                {entry.subtitle && (
                  <div className="cal-detail-item">
                    <span className="cal-detail-label">Subheading</span>
                    <span className="cal-detail-value">{entry.subtitle}</span>
                  </div>
                )}
              </div>
              {poyEligible && !entry.total_entries && (
                <p className="tr-seat tr-seat-2" style={{fontSize:'calc(var(--gu) * 1.060)',color:'#d97706',margin:'0 0 var(--space-md)'}}>
                  \u2691 Edit to add field size for POY points
                </p>
              )}
              {entry.notes && <p className="tr-seat tr-seat-2 tr-card-notes">{entry.notes}</p>}
              <div className="tracking-actions">
                <button className="btn btn-ghost btn-sm" style={{width:'calc(var(--gu) * 5)'}} onClick={stop(onEdit)}>Edit</button>
                <button className="btn btn-ghost btn-sm" style={{width:'calc(var(--gu) * 7)',color:'var(--accent2)'}} onClick={stop(onDelete)}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The Schedule's card (owner, 2026-10-16: "bring the bankroll page more in line with the design
// scheme of the schedule tab") ──
// A result is drawn as the Schedule's event card: CalendarEventRow's markup and classes (styles.css),
// so the room strip, the type, the money column and the opening are the Schedule's own. The day is
// the Schedule's date pill above the cards; the row-1 line is the event's start time (and the
// entries, when more than one); the result takes the buy-in's place, what it is of under it; the
// details and Edit / Delete are behind the chevron. tracking-cards.css holds the little that differs.
// The card parts (strip, name, chevron, month break) live in ResultCardParts.jsx, shared with Cash.

// ── Didn't play (owner, 2026-10-16) ──────────────────────────
// Results' Didn't play: the event stays on the schedule, marked not played
// (user_schedules.not_played, the home's To log action), with the note this card asks for. It is
// not a result, so no buy-in, ROI, ledger or backer figure moves; the card sits in the list among
// the results by its date, and Played it takes it back to awaiting a result.
const DNP_LINE = { fontSize: 'calc(var(--gu) * 1.060)', color: 'var(--text-muted)', fontFamily: "'Univers Condensed','Univers',sans-serif", letterSpacing: '0.03em' };
const DNP_NAME = { fontSize: 'calc(var(--gu) * 1.296)', fontWeight: 'var(--fw-bold)', color: 'var(--text)', fontFamily: "'Univers Condensed','Univers',sans-serif" };
const dnpLabel = (e) => [eventNo(e.event_number), e.event_name].filter(Boolean).join(' ');

function DidNotPlayForm({ event, initialNote = '', onSave, onCancel }) {
  const [note, setNote] = useState(initialNote || '');
  const [busy, setBusy] = useState(false);
  const id = 'dnp-note-' + event.id;
  return (
    <form className="tracking-card" style={{marginBottom:'calc(var(--subrow) * 2)'}}
      onSubmit={async (e) => { e.preventDefault(); if (busy) return; setBusy(true); await onSave(note); setBusy(false); }}>
      <div style={{fontSize:'calc(var(--gu) * 1.325)',fontWeight:700,color:'var(--text)',lineHeight:'calc(var(--subrow) * 3)',marginBottom:'var(--subrow)',fontFamily:"'Univers Condensed','Univers',sans-serif",overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
        Didn&rsquo;t play: {dnpLabel(event)}
      </div>
      <div className="filter-group" style={{marginBottom:'calc(var(--subrow) * 2)'}}>
        <label htmlFor={id}>Notes (optional)</label>
        <input id={id} type="text" value={note} maxLength={1000} autoFocus onChange={(e) => setNote(e.target.value)}
          placeholder="Why you skipped it, what you did instead"
          style={{padding:'var(--space-ml) var(--space-lg)',border:'var(--bw-1) solid var(--border)',borderRadius:'var(--radius-sm)',
            background:'var(--bg)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'calc(var(--gu) * 1.325)',width:'100%'}} />
      </div>
      <div style={{display:'flex',gap:'var(--gu)'}}>
        <button type="submit" className="btn btn-primary btn-sm" style={{width:'calc(var(--gu) * 10)',padding:0}} disabled={busy}>Save</button>
        <button type="button" className="btn btn-ghost btn-sm" style={{width:'calc(var(--gu) * 6)',padding:0}} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function DidNotPlayRow({ event, onEdit, onPlayed, busy }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((v) => !v);
  const note = (event.not_played_note || '').trim();
  return (
    <div className={'cal-event-row tr-card tr-card-dnp' + (open ? ' open' : '')} data-not-played={event.id}>
      <CardStrip venue={event.venue} property={event.property} open={open} onToggle={toggle} />
      <div className="cal-event-row-content">
        <div className="cal-event-bar" onClick={toggle} role="button" tabIndex={0} aria-expanded={open} onKeyDown={barKeys(toggle)}>
          <div className="cal-bar-row1">
            <span className="cal-event-time">{fmtDay(isoDay(event.date))}</span>
            <SwissLines name={event.event_name} time={fmtDay(isoDay(event.date))} />
            <span className="cal-event-money">
              <span className="cal-event-gtd">Didn&rsquo;t play</span>
            </span>
          </div>
          <div className="cal-bar-row2">
            <CardName name={event.event_name} />
          </div>
        </div>
        <CardChevron open={open} onToggle={toggle} />
        <div className={'cal-event-detail-wrap' + (open ? ' open' : '')}>
          <div className="cal-event-detail-inner">
            <div className="cal-event-detail">
              {note && <p className="tr-seat tr-seat-2 tr-card-notes">{note}</p>}
              <div className="tracking-actions">
                <button className="btn btn-ghost btn-sm" style={{width:'calc(var(--gu) * 5)'}} onClick={stop(onEdit)} disabled={busy}>Edit</button>
                <button className="btn btn-ghost btn-sm" style={{width:'calc(var(--gu) * 8)'}} onClick={stop(onPlayed)} disabled={busy}
                  aria-label={`Played ${event.event_name}: ask for its result again`}>Played it</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tracking View (main export) ─────────────────────────────
export default function TrackingView({ trackingData: allTrackingData, tournaments, mySchedule, onAdd, onUpdate, onDelete, onResetResults, myActiveUpdates, isAdmin, token, bk, intent = null, onIntentDone, onLog, deepLink = null, onSetPlayed = null }) {
  const toast = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [pendingFormId, setPendingFormId] = useState(null);
  // Didn't play (owner, 2026-10-16): the form open for an event ({ event, note }), and a write in flight.
  const [dnpForm, setDnpForm] = useState(null);
  const [dnpBusy, setDnpBusy] = useState(false);
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
  // A deep link (§11.5): #bankroll/<tab> opens that section of this page (the dashboard's tabs live
  // here now), #tax the tax report.
  useEffect(() => {
    if (!deepLink) return;
    if (deepLink.bankrollTab && bk.enabled) setResultsKind(deepLink.bankrollTab);
    if (deepLink.tax) setShowTaxReport(true);
  }, [deepLink, bk.enabled]);
  const trackingData = useMemo(() => filterByBankroll(allTrackingData, bk.selected), [allTrackingData, bk.selected]);
  // Balances come from the server's combined ledger (every ledger source), not from summing the
  // results this tab happens to hold — see docs/bankrolls.md "The combined ledger".
  const bankrollBalances = useMemo(() => balancesFromSummary(bk.summary), [bk.summary]);
  const formBankrolls = bk.enabled && bk.bankrolls.length ? bk.bankrolls : null;
  const resultsKind = useResultsKind();
  // "Edit in Results" from the bankroll dashboard's Sessions tab: open that result's edit form and
  // bring it into view (hooks/useResultsFocus.js).
  const focusId = useResultsFocus('tournaments');
  useEffect(() => {
    if (focusId == null || resultsKind !== 'tournaments') return undefined;
    if (!allTrackingData.some((e) => e.id === focusId)) return undefined;   // not loaded yet
    clearResultsFocus();
    setShowAddForm(false);
    setPendingFormId(null);
    setIntentForm(null);
    setEditingId(focusId);
    // Once the form has rendered and the sheet has gone: its top to the top of the tab's scroller
    // (bringIntoView, as the home's intents). No cleanup: clearing the focus above re-runs this
    // effect at once, and cancelling there would cancel the scroll.
    setTimeout(() => bringIntoView(document.querySelector(`.tab-panel[data-tab="tracking"] [data-entry-id="${focusId}"]`), false), 50);
    return undefined;
  }, [focusId, resultsKind, allTrackingData]); // eslint-disable-line react-hooks/exhaustive-deps
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
    const first = awaitingResults(mySchedule, allTrackingData, myActiveUpdates, { today: getToday(), now: getNow(), startOf: parseTournamentTime, plans })[0];
    return first ? first.event : null;
  }, [mySchedule, allTrackingData, myActiveUpdates, tournaments]);

  // Didn't play: user_schedules.not_played and its note (App's setNotPlayed, the home's own call), so
  // the event stops being asked about everywhere; its card joins the list by date.
  const saveDnp = async (note) => {
    if (!onSetPlayed || !dnpForm) return;
    const ok = await onSetPlayed(dnpForm.event.id, true, note);
    if (ok) setDnpForm(null);
    else toast?.error('Could not save it');
  };
  const markPlayed = async (event) => {
    if (!onSetPlayed || dnpBusy) return;
    setDnpBusy(true);
    const ok = await onSetPlayed(event.id, false);
    setDnpBusy(false);
    if (!ok) toast?.error('Could not change it');
  };
  // The not-played events, newest first, each placed among the results before the first older one
  // (the results keep the order they come in).
  const notPlayedEvents = useMemo(() => (mySchedule || [])
    .filter((e) => Number(e.not_played) && e.venue !== 'Personal' && !Number(e.is_restart))
    .sort((a, b) => (isoDay(b.date) || '').localeCompare(isoDay(a.date) || '')), [mySchedule]);
  const listItems = useMemo(() => {
    const out = [];
    let k = 0;
    // Newest first by the real date: the server orders by the stored text ("September 3" after
    // "September 27"), which scrambled days within a month and months within the list.
    const byDate = trackingData.map((e, i) => [e, i]).sort((x, y) => (isoDay(y[0].date) || '').localeCompare(isoDay(x[0].date) || '') || x[1] - y[1]).map((x) => x[0]);
    for (const entry of byDate) {
      const day = isoDay(entry.date) || '';
      while (k < notPlayedEvents.length && (isoDay(notPlayedEvents[k].date) || '') > day) out.push({ dnp: notPlayedEvents[k++] });
      out.push({ entry });
    }
    while (k < notPlayedEvents.length) out.push({ dnp: notPlayedEvents[k++] });
    return out;
  }, [trackingData, notPlayedEvents]);
  // The backer page's interactive graph (owner, 2026-10-16): the running total of these results, one
  // step per result in date order, in dollars (BackerChart / utils/backer-page.js shareSeries).
  const chartEvents = useMemo(() => trackingData
    .map((e) => ({
      date: isoDay(e.date),
      shareCents: Math.round(convertAmount(resultMoney(e).net, nativeCurrency(e.venue), 'USD', exchangeRates) * 100),
      game: e.event_name || null,
    }))
    .filter((e) => e.date), [trackingData, exchangeRates]);
  const netCode = displayCurrency === 'NATIVE' ? 'USD' : displayCurrency;
  const fmtMonthNet = (v) => (v > 0 ? '+' : '') + formatCurrencyAmount(Math.round(v), netCode);
  const months = useMemo(() => {
    const out = [];
    for (const it of listItems) {
      const row = it.dnp || it.entry;
      const key = (isoDay(row.date) || '').slice(0, 7) || 'undated';
      let g = out[out.length - 1];
      if (!g || g.key !== key) { g = { key, items: [], net: 0 }; out.push(g); }
      g.items.push(it);
      if (it.entry) g.net += convertAmount(resultMoney(it.entry).net, nativeCurrency(it.entry.venue), netCode, exchangeRates);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listItems, netCode, exchangeRates]);

  // What the home asked for (App's resultsIntent): a form, an entry, a sheet. The cash and
  // expense ones are handed to the view that owns that form, which reports back itself.
  const [intentForm, setIntentForm] = useState(null); // { tournamentId, label, event, initial, conflict }
  const [focusEntry, setFocusEntry] = useState(null);
  const intentFormRef = React.useRef(null);
  const intentSending = React.useRef(false);
  // The intent form LOGS (ifAbsent): a result already there is refused, not overwritten. Then the
  // form stays open with what was typed, says what is logged, and offers Replace it (a plain
  // upsert) or Cancel (keep the logged one). It used to close as if it had logged, and the cash
  // typed into it was gone without a word.
  const submitIntent = async (data, opts = {}) => {
    if (!intentForm || intentSending.current) return;
    const { tournamentId, label } = intentForm;
    intentSending.current = true;
    try {
      const r = await onAdd({ ...data, tournamentId, ifAbsent: !opts.replace });
      if (r && r.ok) { setIntentForm(null); return; }
      if (r && r.status === 409) {
        setIntentForm((f) => (f && f.tournamentId === tournamentId ? { ...f, conflict: true } : f));
        toast?.info(`${label || 'This event'} already has a result. What you typed is still in the form.`);
      }
      // Anything else: App has said what went wrong; the form stays open with what was typed.
    } finally { intentSending.current = false; }
  };
  // The logged result the conflict sentence describes (the list is refetched on the 409).
  const intentConflict = useMemo(() => {
    if (!intentForm || !intentForm.conflict) return null;
    const e = allTrackingData.find((x) => x.tournament_id === intentForm.tournamentId);
    const n = e ? (e.num_entries || 1) : 0;
    const what = !e ? '' : ` (${e.cashed
      ? `cashed ${formatCurrencyAmount(e.cash_amount || 0, nativeCurrency(e.venue))}${e.finish_place ? `, ${e.finish_place}${ordinalSuffix(e.finish_place)}` : ''}`
      : 'no cash'}, ${n} bullet${n === 1 ? '' : 's'})`;
    return `A result is already logged for this event${what}, from another device or a live update's Finish. Replace it with these figures, or Cancel to keep it.`;
  }, [intentForm, allTrackingData]);
  const kind = intent ? intent.kind : null;
  const cashIntent = isAdmin && kind && kind.startsWith('cash') ? intent : null;
  const expenseIntent = isAdmin && (kind === 'expense' || kind === 'trip') ? intent : null;
  useEffect(() => {
    if (!intent) return;
    if (intent.kind.startsWith('cash')) {
      if (isAdmin) setResultsKind('cash'); else onIntentDone && onIntentDone();
      return;
    }
    if (intent.kind === 'section') {
      if (bk.enabled) setResultsKind(intent.section);
      onIntentDone && onIntentDone();
      return;
    }
    if (intent.kind !== 'import') setResultsKind('tournaments');
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
      if (bk.enabled) setResultsKind('data');
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

  // The floating + (BankrollFab, mounted by App) steps aside while a form it would open is open here
  // (the Log Result form, however it was opened, or a row in edit; not while the Cash half has the
  // tab, which keeps the form's state but not its screen) and for the tax report, which is the whole
  // tab. Cash sessions and expenses hold it from their own views.
  const tournamentsHalf = !(isAdmin && resultsKind !== 'tournaments');
  const dashSection = bk.enabled && resultsKind !== 'tournaments' && resultsKind !== 'cash';
  useHideBankrollFab((tournamentsHalf && (showAddForm || !!intentForm || !!pendingFormId || !!editingId)) || (showTaxReport && isAdmin));

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
        <BankrollSwitcher bk={bk} balances={bankrollBalances} onManage={() => setShowBankrolls(true)} />
      )}
      {showBankrolls && (
        <BankrollManager bk={bk} balances={bankrollBalances} onClose={() => setShowBankrolls(false)} />
      )}
      {/* Cash sessions (beta, admins): Tournaments | Cash. Everyone else sees no strip. */}
      {isAdmin && <ResultsKindTabs />}
      {dashSection ? (
        <Suspense fallback={null}><BankrollDashboard inline tab={resultsKind} bk={bk} onLog={onLog} /></Suspense>
      ) : isAdmin && resultsKind === 'cash' ? (
        <Suspense fallback={null}><CashSessionsView token={token} bk={bk} intent={cashIntent} onIntentDone={onIntentDone} /></Suspense>
      ) : (<>
      {/* One row, as the Schedule's location | filter | calendar (owner, 2026-10-16): Log Result spans
          three primary columns (26g), then a 4g Share square and the 3g Tax report square, 1g apart. */}
      <div className="tr-head-row">
        <button type="button" className={'filter-chip tr-log-btn' + (showAddForm ? ' is-cancel' : '')}
          onClick={() => { setShowAddForm(f => !f); setEditingId(null); }}>
          {showAddForm ? null : <Icon.plus />}
          <span className="tr-log-label">{showAddForm ? 'Cancel' : 'Log Result'}</span>
        </button>
        {trackingData.length > 0 && (
          <button type="button" className="filter-chip filter-chip-square tr-head-square" onClick={() => setShowShareMenu(true)} title="Share & Social" aria-label="Share">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
        )}
        {isAdmin && (
          <button type="button" className="filter-chip filter-chip-square" onClick={() => setShowTaxReport(true)} title="Tax report (beta)" aria-label="Tax report">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
          </button>
        )}
      </div>

      {trackingData.length > 0 && (
        <div className="tracking-card" style={{marginBottom:'calc(var(--subrow) * 2)'}}>
          <div className="tracking-summary-head">
            <span className="tr-seat tr-seat-3" style={{fontSize:'calc(var(--gu) * 1.031)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Profit</span>
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
          {/* The profit first and largest, in the Schedule's money face (owner, 2026-10-16), then what
              it is made of: the events and cashes, and the ROI, on one line. */}
          <div className={'tr-seat tr-sum-net ' + (stats.profit > 0 ? 'is-pos' : stats.profit < 0 ? 'is-neg' : '')}>
            <MoneyParts text={(stats.profit >= 0 ? '+' : '') + fmtStat(stats.profit)} />
          </div>
          <p className="tr-seat tr-seat-2 tr-sum-sub">
            {stats.totalEntries} event{stats.totalEntries !== 1 ? 's' : ''} · {stats.eventsCashed} cash{stats.eventsCashed !== 1 ? 'es' : ''} · ROI {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
          </p>
          <div className="tracking-stats tr-sum-stats">
            <div className="cal-detail-item">
              <span className="cal-detail-label">Total Buyins</span>
              <span className="cal-detail-value">{fmtStat(stats.totalBuyins)}</span>
            </div>
            <div className="cal-detail-item">
              <span className="cal-detail-label">Total Cashes</span>
              <span className="cal-detail-value">{fmtStat(stats.totalCashes)}</span>
            </div>
            {stats.poyEventCount > 0 && (
              <div className="cal-detail-item">
                <span className="cal-detail-label">POY Pts{stats.hasMoreThan15 ? ' (Top 15)' : ''}</span>
                <span className="cal-detail-value tracking-poy">{stats.totalPOY.toFixed(1)}</span>
              </div>
            )}
          </div>
          <p className="tr-seat tr-seat-2" style={{fontSize:'calc(var(--gu) * 1.104)',color:'var(--text-muted)',margin:0}}>
            {[
              stats.poyEventCount > 0 ? `${stats.poyEventCount} POY event${stats.poyEventCount !== 1 ? 's' : ''}` : '',
              displayCurrency !== 'NATIVE' && exchangeRates ? (ratesStale ? 'fallback rates' : 'live rates') : '',
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}

      <BankrollGraph events={chartEvents} label="Profit" />

      {/* Analytics BETA: app admins only (staged rollout); everyone else sees no change. */}
      {isAdmin && trackingData.length > 0 && <AnalyticsLauncher bankroll={bk.selected} />}

      {/* Expenses & income BETA: app admins only; follows the bankroll switcher's selection. */}
      {isAdmin && bk.enabled && (
        <Suspense fallback={null}>
          <ExpensesSection token={token} bankroll={bk.selected} bankrolls={bk.bankrolls} rates={exchangeRates}
            events={allTrackingData} onChanged={bk.refresh} intent={expenseIntent} onIntentDone={onIntentDone} />
        </Suspense>
      )}

      {dnpForm && !dnpForm.fromList && !showAddForm && !intentForm && (
        <DidNotPlayForm key={'dnp-' + dnpForm.event.id} event={dnpForm.event} initialNote={dnpForm.note}
          onSave={saveDnp} onCancel={() => setDnpForm(null)} />
      )}

      {(!dnpForm || dnpForm.fromList) && pendingEvent && !showAddForm && !intentForm && pendingFormId !== pendingEvent.id && (
        /* The Schedule's card too (owner, 2026-10-16), dashed while it waits: the room strip, the day,
           the name over its flight, "Awaiting result" in the money column, the two actions under it. */
        <div className="cal-event-row tr-card tracking-pending">
          <CardStrip venue={pendingEvent.venue} property={pendingEvent.property} open={false} onToggle={() => setPendingFormId(pendingEvent.id)} />
          <div className="cal-event-row-content">
            <div className="cal-event-bar tr-pending-bar">
              <div className="cal-bar-row1">
                <span className="cal-event-time">{fmtDay(isoDay(pendingEvent.date))}</span>
                <SwissLines name={pendingEvent.event_name} time={fmtDay(isoDay(pendingEvent.date))} />
                <span className="cal-event-money"><span className="cal-event-gtd">Awaiting result</span></span>
              </div>
              <div className="cal-bar-row2">
                <CardName name={pendingEvent.event_name} />
              </div>
            </div>
            <div className="tracking-actions tr-pending-actions">
              {onSetPlayed && (
                <button className="btn btn-ghost btn-sm" style={{width:'var(--col)', padding:0}}
                  onClick={() => setDnpForm({ event: pendingEvent, note: '' })} aria-label={`Didn't play ${pendingEvent.event_name}: stop asking for its result`}>
                  Didn&rsquo;t play
                </button>
              )}
              <button className="btn btn-primary btn-sm" style={{width:'var(--col)', padding:0}}
                onClick={() => setPendingFormId(pendingEvent.id)}>
                Log Result
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingFormId && pendingEvent && (
        <TrackingEntryForm
          previewToken={isAdmin ? token : null}
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
          place and payout, the field). It logs and never edits on its own: a result already there
          (another device, the live-update Finish) is refused (ifAbsent), and the form then asks
          before replacing it (submitIntent). */}
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
          onSubmit={submitIntent}
          onCancel={() => setIntentForm(null)}
          isEdit
          isNew
          conflict={intentConflict}
        />
      )}

      {showAddForm && (
        <TrackingEntryForm
          previewToken={isAdmin ? token : null}
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

      {trackingData.length === 0 && notPlayedEvents.length === 0 && !showAddForm && !pendingFormId ? (
        <FirstRun
          icon="tracking"
          title="Log your first result"
          body="Cashes and bust-outs both count — your ROI needs a few before it tells you anything."
          actionLabel="Log result"
          onAction={() => { setShowAddForm(true); setEditingId(null); }}
        />
      ) : (
        <div className="tr-months">
          {months.map((g) => (
            <div key={g.key} className="tr-month">
              <MonthBreak monthKey={g.key} count={g.items.length} net={g.net} fmtNet={fmtMonthNet} />
              {g.items.map(({ entry, dnp }) => dnp ? (
                <div key={'dnp-' + dnp.id}>
                  {dnpForm && dnpForm.fromList && dnpForm.event.id === dnp.id ? (
                    <DidNotPlayForm event={dnp} initialNote={dnpForm.note} onSave={saveDnp} onCancel={() => setDnpForm(null)} />
                  ) : (
                    <DidNotPlayRow event={dnp} busy={dnpBusy}
                      onEdit={() => setDnpForm({ event: dnp, note: dnp.not_played_note || '', fromList: true })}
                      onPlayed={() => markPlayed(dnp)} />
                  )}
                </div>
              ) : (
                <div key={entry.id} data-entry-id={entry.id}>
                  <TrackingEntryRow
                    entry={entry}
                    onEdit={() => setEditingId(entry.id)}
                    onDelete={() => onDelete(entry.id)}
                    isEditing={editingId === entry.id}
                    onUpdate={(data) => { onUpdate(entry.id, data); setEditingId(null); }}
                    onCancelEdit={() => setEditingId(null)}
                    displayCurrency={displayCurrency}
                    exchangeRates={exchangeRates}
                    bankrolls={formBankrolls}
                    notifyToken={isAdmin ? token : null}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
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
