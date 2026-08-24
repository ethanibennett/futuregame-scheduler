import React, { useState, useEffect, useMemo, useCallback } from 'react';
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

// ── Tracking Entry Form ─────────────────────────────────────
function TrackingEntryForm({ tournaments, mySchedule, existingEntryIds, initialValues, tournamentLabel, entryForPOY, onSubmit, onCancel, isEdit }) {
  const [tournamentId, setTournamentId] = useState(initialValues?.tournamentId || '');
  const [numEntries, setNumEntries] = useState(initialValues?.numEntries || 1);
  const [cashed, setCashed] = useState(initialValues?.cashed || false);
  const [finishPlace, setFinishPlace] = useState(initialValues?.finishPlace || '');
  const [cashAmount, setCashAmount] = useState(initialValues?.cashAmount || '');
  const [notes, setNotes] = useState(initialValues?.notes || '');
  const [totalFieldSize, setTotalFieldSize] = useState(initialValues?.totalEntries || '');
  const [showLfg, setShowLfg] = useState(false);

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
      totalFieldSize: totalFieldSize ? parseInt(totalFieldSize) : null
    });
  };

  return (
    <form onSubmit={handleSubmit} className="tracking-card" style={{padding:'16px',marginBottom:'12px'}}>
      <div style={{fontSize:'0.9rem',fontWeight:700,color:'var(--text)',marginBottom:'12px',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
        {isEdit ? `Edit: ${tournamentLabel}` : 'Log Tournament Result'}
      </div>

      {!isEdit && (
        <div className="filter-group" style={{marginBottom:'12px'}}>
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
          <div style={{display:'flex',gap:'8px',marginTop:'4px',alignItems:'center'}}>
            <button type="button" className={`filter-chip ${!cashed ? 'active' : ''}`}
              onClick={() => { setCashed(false); setShowLfg(false); }}>No</button>
            <button type="button" className={`filter-chip ${cashed ? 'active' : ''}`}
              onClick={() => { if (!cashed) { setCashed(true); setShowLfg(true); setTimeout(() => setShowLfg(false), 1000); } }}>Yes</button>
            {showLfg && <span className="lfg-burst" style={{fontSize:'0.9rem',marginLeft:'4px'}}>lfg!</span>}
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
        <div className="filter-group" style={{marginBottom:'12px'}}>
          <label>Field Size (total entries)</label>
          <input type="number" min="1" value={totalFieldSize}
            onChange={e => setTotalFieldSize(e.target.value)} placeholder="e.g. 8500"
            style={{padding:'10px 12px',border:'1.5px solid var(--border)',borderRadius:'var(--radius-sm)',
              background:'var(--bg)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'0.9rem',width:'100%'}} />
          <span style={{fontSize:'0.7rem',color:'var(--text-muted)',marginTop:'2px',display:'block'}}>
            Used for POY points calculation
          </span>
        </div>
      )}

      <div className="filter-group" style={{marginBottom:'14px'}}>
        <label>Notes (optional)</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Optional notes about this session"
          style={{padding:'10px 12px',border:'1.5px solid var(--border)',borderRadius:'var(--radius-sm)',
            background:'var(--bg)',color:'var(--text)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'0.9rem',width:'100%'}} />
      </div>

      <div style={{display:'flex',gap:'8px'}}>
        <button type="submit" className="btn btn-primary btn-sm">
          {isEdit ? 'Save Changes' : 'Log Result'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ── Tracking Entry Row ──────────────────────────────────────
function TrackingEntryRow({ entry, onEdit, onDelete, isEditing, onUpdate, onCancelEdit, displayCurrency, exchangeRates }) {
  const from = nativeCurrency(entry.venue);
  const to = displayCurrency === 'NATIVE' ? from : displayCurrency;
  const cv = (val) => convertAmount(val, from, to, exchangeRates);
  const fmt = (val) => formatCurrencyAmount(val, to);
  const fmtSigned = (val) => { const c = cv(val); return (c >= 0 ? '+' : '') + formatCurrencyAmount(c, to); };

  const totalCost = (entry.buyin || 0) * (entry.num_entries || 1);
  const profit = (entry.cash_amount || 0) - totalCost;
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
          totalEntries: entry.total_entries
        }}
        entryForPOY={entry}
        tournamentLabel={`#${entry.event_number} ${entry.event_name}`}
        onSubmit={onUpdate}
        onCancel={onCancelEdit}
        isEdit
      />
    );
  }

  return (
    <div className="tracking-card">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'6px'}}>
        <div>
          <div style={{fontSize:'0.72rem',color:'var(--text-muted)',fontFamily:"'Univers Condensed','Univers',sans-serif",letterSpacing:'0.03em'}}>
            {entry.date} \u00b7 #{entry.event_number}
          </div>
          <div style={{fontSize:'0.88rem',fontWeight: 'var(--fw-bold)',color:'var(--text)',marginTop:'2px',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
            {entry.event_name}
          </div>
        </div>
        <div style={{textAlign:'right',flexShrink:0}}>
          <div style={{fontFamily:"var(--serif)",fontSize:'1rem',fontWeight:700}}
            className={profit >= 0 && entry.cashed ? 'tracking-profit-pos' : 'tracking-profit-neg'}>
            {fmtSigned(profit)}
          </div>
        </div>
      </div>

      <div className="cal-detail-grid" style={{marginBottom:'8px'}}>
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
        <p style={{fontSize:'0.72rem',color:'#d97706',marginBottom:'4px'}}>
          \u2691 Edit to add field size for POY points
        </p>
      )}

      {entry.notes && (
        <p style={{fontSize:'0.78rem',color:'var(--text-muted)',fontStyle:'italic',marginBottom:'8px'}}>{entry.notes}</p>
      )}

      <div style={{display:'flex',gap:'8px'}}>
        <button className="btn btn-ghost btn-sm" onClick={onEdit}>Edit</button>
        <button className="btn btn-ghost btn-sm" style={{color:'var(--accent2)'}} onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

// ── Tracking View (main export) ─────────────────────────────
export default function TrackingView({ trackingData, tournaments, mySchedule, onAdd, onUpdate, onDelete, myActiveUpdates }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [pendingFormId, setPendingFormId] = useState(null);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showWrapUp, setShowWrapUp] = useState(false);
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

  const onCurrencyChange = useCallback((c) => {
    setDisplayCurrency(c);
    localStorage.setItem('trackingCurrency', c);
  }, []);

  const stats = useMemo(() => {
    let totalBuyins = 0, totalCashes = 0, eventsCashed = 0;
    const poyScores = [];
    for (const e of trackingData) {
      const from = nativeCurrency(e.venue);
      const to = displayCurrency === 'NATIVE' ? from : displayCurrency;
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

  const existingEntryIds = useMemo(() => new Set(trackingData.map(e => e.tournament_id)), [trackingData]);

  // Find most recent scheduled event that hasn't been tracked yet
  const pendingEvent = useMemo(() => {
    if (!mySchedule || mySchedule.length === 0) return null;
    const todayISO = getToday();
    return [...mySchedule]
      .filter(t => t.venue !== 'Personal' && !existingEntryIds.has(t.id) && normaliseDate(t.date) <= todayISO)
      .sort((a, b) => {
        const da = parseTournamentTime(a);
        const db = parseTournamentTime(b);
        return db - da; // most recent first
      })[0] || null;
  }, [mySchedule, existingEntryIds]);

  return (
    <div>
      <div className="section-header">
        <h2>Tracking</h2>
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
          {trackingData.length > 0 && (
            <button className="btn-share-overlay" onClick={() => setShowShareMenu(true)} title="Share & Social">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Share
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => { setShowAddForm(f => !f); setEditingId(null); }}>
            {showAddForm ? 'Cancel' : '+ Log Result'}
          </button>
        </div>
      </div>

      {trackingData.length > 0 && (
        <div className="tracking-card" style={{padding:'16px',marginBottom:'12px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
            <span style={{fontSize:'0.7rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Summary</span>
            {exchangeRates && (
              <select value={displayCurrency} onChange={e => onCurrencyChange(e.target.value)}
                style={{fontSize:'0.7rem',padding:'3px 6px',border:'1px solid var(--border)',borderRadius:'6px',
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
          <p style={{fontSize:'0.75rem',color:'var(--text-muted)',marginTop:'8px'}}>
            {stats.totalEntries} event{stats.totalEntries !== 1 ? 's' : ''} played \u00b7 {stats.eventsCashed} cash{stats.eventsCashed !== 1 ? 'es' : ''}
            {stats.poyEventCount > 0 && <> \u00b7 {stats.poyEventCount} POY event{stats.poyEventCount !== 1 ? 's' : ''}</>}
            {displayCurrency !== 'NATIVE' && exchangeRates && (
              <> \u00b7 {ratesStale ? 'fallback rates' : 'live rates'}</>
            )}
          </p>
        </div>
      )}

      {pendingEvent && !showAddForm && pendingFormId !== pendingEvent.id && (
        <div className="tracking-card" style={{padding:'14px', marginBottom:'12px', border:'1.5px dashed var(--accent)'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:'0.7rem', color:'var(--text-muted)', fontFamily:"'Univers Condensed','Univers',sans-serif", letterSpacing:'0.03em'}}>
                {pendingEvent.date} \u00b7 #{pendingEvent.event_number?.replace(/^[A-Za-z]+-/, '')}
              </div>
              <div style={{fontSize:'0.85rem', fontWeight: 'var(--fw-bold)', color:'var(--text)', marginTop:'2px', fontFamily:"'Univers Condensed','Univers',sans-serif", overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                {pendingEvent.event_name}
              </div>
              <div style={{fontSize:'0.72rem', color:'var(--text-muted)', marginTop:'2px'}}>
                Awaiting result
              </div>
            </div>
            <button className="btn btn-primary btn-sm" style={{flexShrink:0, marginLeft:'12px'}}
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
          initialValues={{ tournamentId: pendingFormId }}
          tournamentLabel={`#${(pendingEvent.event_number || '').replace(/^[A-Za-z]+-/, '')} ${pendingEvent.event_name}`}
          entryForPOY={pendingEvent}
          onSubmit={(data) => { onAdd({ ...data, tournamentId: pendingFormId }); setPendingFormId(null); }}
          onCancel={() => setPendingFormId(null)}
          isEdit
        />
      )}

      {showAddForm && (
        <TrackingEntryForm
          tournaments={tournaments}
          mySchedule={mySchedule}
          existingEntryIds={existingEntryIds}
          onSubmit={(data) => { onAdd(data); setShowAddForm(false); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

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
          />
        ))
      )}

      {showShareMenu && (
        <ShareMenu
          trackingData={trackingData}
          tournaments={tournaments}
          mySchedule={mySchedule}
          myActiveUpdates={myActiveUpdates || []}
          onClose={() => setShowShareMenu(false)}
          onOpenWrapUp={() => setShowWrapUp(true)}
        />
      )}

      {showWrapUp && (
        <WrapUpViewer
          trackingData={trackingData}
          tournaments={tournaments}
          onClose={() => setShowWrapUp(false)}
        />
      )}
    </div>
  );
}
