import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../contexts/ToastContext.jsx';
import { formatCurrencyAmount, MINUS, getToday } from '../utils/utils.js';
import { BANKROLL_ALL } from '../utils/bankrolls.js';
import { goalProgress, ledgerToCsv, fmtRule } from '../utils/bankroll-ledger.js';
import BankrollOverview, { Segmented } from './BankrollOverview.jsx';
import BankrollImport from './BankrollImport.jsx';
import './analytics.css';
import './bankroll-dashboard.css';

/**
 * The bankroll dashboard — BETA, app admins only (TrackingView mounts the launcher only for
 * admins; every route behind it is requireAppAdmin). A full-height sheet like AnalyticsView,
 * built on the server's combined ledger (lib/bankroll-ledger.js):
 *   Overview (BankrollOverview.jsx): balance and profit, the cumulative graph over a range, grouped
 *     statistics for tournaments, cash and the roll, and the latest sessions;
 *   Rules: the bankroll-management rule, its move up / move down signal, and risk of ruin;
 *   Goals; Import: CSV export / import.
 * Currency: a bankroll is shown in its own currency; All is shown in USD (as the switcher).
 * Wording is descriptive: what the player's own numbers and own rule say.
 */

// Portalled where AnalyticsView portals (see its portalTarget): inside the app root, under the
// admin grid overlay.
function portalTarget() {
  const shell = document.querySelector('.app-shell');
  return (shell && shell.parentElement) || document.body;
}
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
// The sheet's tabs, in order. The strip is one 35g segmented control whose segments share the
// width in whole g (bankroll-dashboard.css .bd-seg[data-n]): add a tab here and render it below,
// and the strip re-divides itself (4 tabs 9+9+9+8g, 5 tabs 5 x 7g, 6 tabs 5 x 6g + 5g).
const TABS = [
  ['balance', 'Overview'],
  ['rules', 'Rules'],
  ['goals', 'Goals'],
  ['data', 'Import'],
];

function Seg({ cols, options, value, onChange, label }) {
  return (
    <div className={cols} role="radiogroup" aria-label={label}>
      {options.map(([k, text]) => (
        <button key={String(k)} type="button" role="radio" aria-checked={value === k}
          className={'bk-seg-btn' + (value === k ? ' is-on' : '')} onClick={() => onChange(k)}>
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, tone = '', note }) {
  return (
    <div className="an-stat">
      <div className="an-cell an-lbl an-lbl-2 an-clip">{label}</div>
      <div className={'an-cell an-val an-clip' + tone}>{value}</div>
      {note && <div className="an-cell an-note an-clip">{note}</div>}
    </div>
  );
}


// ── Rules ────────────────────────────────────────────────────────────────────────────────
function Rules({ guide, prefs, money, onSave, saving }) {
  const [mtt, setMtt] = useState('');
  const [cash, setCash] = useState('');
  useEffect(() => {
    setMtt(String(prefs ? prefs.rules.mtt.buyins : 100));
    setCash(String(prefs ? prefs.rules.cash.buyins : 30));
  }, [prefs]);
  const g = guide && guide.mtt;
  let signal = null;
  if (g) {
    if (g.signal === 'down') {
      signal = { cls: 'bd-down', head: 'Move down', text: g.reason === 'empty'
        ? 'The roll is at or below zero.'
        : `Your last ${g.recentN} entries averaged ${money(g.recentAvg)}, above the ${money(g.cap)} cap.` };
    } else if (g.signal === 'up') {
      signal = { cls: 'bd-up', head: 'Room to move up', text: `The ${money(g.cap)} cap reaches the ${g.nextTier.label} tier, from ${money(g.nextTier.min)}.` };
    } else if (g.signal === 'hold') {
      signal = { cls: '', head: 'Within your rule', text: `Your last ${g.recentN} entries averaged ${money(g.recentAvg)}; the cap is ${money(g.cap)}.` };
    } else {
      signal = { cls: '', head: 'No signal yet', text: `It compares your last tournament entries with the cap; ${g.recentN} so far, it needs 5.` };
    }
  }
  const custom = prefs ? prefs.custom : { mtt: false, cash: false };
  return (
    <section className="bd-section" aria-labelledby="bd-rules">
      <h3 className="an-cell an-sec" id="bd-rules">Bankroll rule</h3>
      {g && (
        <div className="an-stats">
          <Stat label="MTT max buy-in" value={money(g.cap)}
            note={`${g.buyins} buy-ins · ${fmtRule(g.buyins)} of the roll${custom.mtt ? '' : ' (default)'}`} />
          <Stat label="Cash max buy-in" value={money(guide.cash.cap)}
            note={`${guide.cash.buyins} buy-ins for a stake${custom.cash ? '' : ' (default)'}`} />
        </div>
      )}
      {signal && (
        <p className="an-p"><strong className={signal.cls}>{signal.head}.</strong> {signal.text}</p>
      )}
      <div className="bk-fields bd-fields bd-block">
        <label className="bk-field">
          <span className="bk-field-label">MTT: buy-ins in the roll</span>
          <input type="number" inputMode="numeric" min="1" value={mtt} onChange={(e) => setMtt(e.target.value)} />
        </label>
        <label className="bk-field">
          <span className="bk-field-label">Cash: buy-ins in the roll</span>
          <input type="number" inputMode="numeric" min="1" value={cash} onChange={(e) => setCash(e.target.value)} />
        </label>
      </div>
      <div className="bd-actions">
        <button type="button" className="bk-btn bk-btn--brand bk-w8" disabled={saving}
          onClick={() => onSave({ rules: { mtt: { buyins: Number(mtt) }, cash: { buyins: Number(cash) } } })}><span>Save</span></button>
        <button type="button" className="bk-btn bk-w8" disabled={saving || (!custom.mtt && !custom.cash)}
          onClick={() => onSave({ reset: ['mtt', 'cash'] })}><span>Defaults</span></button>
      </div>
      <p className="an-p">
        Defaults: 100 buy-ins for tournaments (at most 1% of the roll per entry) and 30 buy-ins for a cash
        game. They are starting points, not advice; set your own. A move-down signal fires when your last
        20 entries average above the cap; move-up when the cap reaches the next buy-in tier.
      </p>
    </section>
  );
}

// ── Goals ────────────────────────────────────────────────────────────────────────────────
function Goals({ goals, entries, money, today, onSave, saving, currency }) {
  const [period, setPeriod] = useState('month');
  const [metric, setMetric] = useState('profit');
  const [target, setTarget] = useState('');
  const list = goals || [];
  const save = (next) => onSave({ goals: next });
  return (
    <section className="bd-section" aria-labelledby="bd-goals">
      <h3 className="an-cell an-sec" id="bd-goals">Goals</h3>
      {list.length === 0 && <p className="an-p">No goals yet. A goal is a monthly or yearly target for profit or for volume.</p>}
      {list.map((g) => {
        const p = goalProgress(g, entries, today);
        const what = `${g.period === 'month' ? 'Monthly' : 'Yearly'} ${g.metric === 'profit' ? 'profit' : 'volume'}`;
        const fmt = (v) => (g.metric === 'profit' ? money(v) : `${Math.round(v).toLocaleString()} played`);
        const pct = Math.max(0, Math.min(1, p.fraction));
        return (
          <div key={g.id} className="bd-goal">
            <div className="bd-goal-head">
              <span className="an-cell an-td an-clip">{what}</span>
              <span className={'an-cell an-td an-num an-clip' + (p.fraction >= 1 ? ' an-pos' : '')}>{fmt(p.done)} of {fmt(p.target)}</span>
              <button type="button" className="bd-x" aria-label={`Remove the ${what.toLowerCase()} goal`} disabled={saving}
                onClick={() => save(list.filter((x) => x.id !== g.id))}>
                <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1L9 9M9 1L1 9" /></svg>
              </button>
            </div>
            <div className="bd-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
              <div className={'bd-bar-fill' + (p.fraction >= 1 ? ' is-done' : '')} style={{ width: `${pct * 100}%` }} />
              {p.elapsed < 1 && <div className="bd-bar-pace" style={{ left: `${p.elapsed * 100}%` }} />}
            </div>
            <div className="an-cell an-note an-clip">
              {Math.round(p.fraction * 100)}% done · {Math.round(p.elapsed * 100)}% of the {g.period} gone{p.fraction >= 1 ? ' · reached' : p.ahead ? ' · ahead of pace' : ''}
            </div>
          </div>
        );
      })}
      <div className="bd-block">
        <Seg cols="bd-seg2" label="Goal period" options={[['month', 'Monthly'], ['year', 'Yearly']]} value={period} onChange={setPeriod} />
      </div>
      <div className="bd-block">
        <Seg cols="bd-seg2" label="Goal measure" options={[['profit', 'Profit'], ['volume', 'Volume']]} value={metric} onChange={setMetric} />
      </div>
      <div className="bk-fields bd-block">
        <label className="bk-field">
          <span className="bk-field-label">{metric === 'profit' ? `Target (${currency})` : 'Target (events + sessions)'}</span>
          <input type="number" inputMode="numeric" min="1" value={target} placeholder="0" onChange={(e) => setTarget(e.target.value)} />
        </label>
      </div>
      <div className="bd-actions">
        <button type="button" className="bk-btn bk-btn--brand bk-w8" disabled={saving || !(Number(target) > 0) || list.length >= 6}
          onClick={() => { save([...list, { period, metric, target: Number(target) }]); setTarget(''); }}><span>Add goal</span></button>
      </div>
      <p className="an-p">
        Profit counts every result in the ledger (tournaments, and cash games and expenses where they are
        recorded), not deposits or transfers. Volume counts tournament entries and cash sessions. The tick on
        the bar is how much of the period has gone.
      </p>
    </section>
  );
}

// ── Risk of ruin ─────────────────────────────────────────────────────────────────────────
function Risk({ risk, money }) {
  const pct = (x) => (x == null ? '—' : x >= 0.995 ? '100%' : x < 0.001 ? '<0.1%' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
  const sgn = (x) => (x < 0 ? MINUS : '+') + Math.abs(x).toFixed(2);
  const sgnPct = (x) => (x < 0 ? MINUS : '+') + Math.abs(x * 100).toFixed(0) + '%';
  return (
    <section className="bd-section" aria-labelledby="bd-risk">
      <h3 className="an-cell an-sec" id="bd-risk">Risk of ruin (tournaments)</h3>
      {!risk && <p className="an-p">Loading…</p>}
      {risk && risk.status === 'insufficient' && (
        <p className="an-p"><strong>Not enough data.</strong> The estimate needs {risk.minEntries} tournament entries with a
          buy-in; this bankroll has {risk.n}.</p>
      )}
      {risk && risk.status === 'empty' && <p className="an-p"><strong>No estimate:</strong> the roll is at or below zero.</p>}
      {risk && risk.status === 'ok' && (
        <div className="an-stats">
          <Stat label="Risk of ruin" value={pct(risk.ror)} tone={risk.ror > 0.05 ? ' an-neg' : ''}
            note={`μ ${sgn(risk.mean)} · σ ${risk.sd.toFixed(1)} buy-ins per entry`} />
          <Stat label="At the ROI's low end" value={pct(risk.rorAtLow)}
            note={risk.ci ? `ROI 95% interval from ${sgnPct(risk.ci.low)}` : 'No interval'} />
          <Stat label="Roll in buy-ins" value={risk.bankrollBuyins.toFixed(0)} note={`avg ${money(risk.avgBuyin)} per entry`} />
          <Stat label="Buy-ins for 5% risk" value={risk.buyinsFor.p5 == null ? '—' : Math.ceil(risk.buyinsFor.p5).toLocaleString()}
            note={risk.buyinsFor.p1 == null ? 'Needs a winning record' : `${Math.ceil(risk.buyinsFor.p1).toLocaleString()} for 1%`} />
        </div>
      )}
      <p className="an-p">
        Method: the diffusion approximation, RoR = exp({MINUS}2μB / σ²), with μ and σ your mean and standard
        deviation per entry in buy-ins and B the roll in average buy-ins. It assumes every entry is independent
        at the same average buy-in and the same edge, that your sample's μ and σ are the true ones, and that you
        never top up, withdraw or move down. Tournament results are long-tailed and the sample cannot see a
        tail it has not reached, so treat it as a rough guide. Shown from {risk ? risk.minEntries : 100} entries.
      </p>
    </section>
  );
}

// ── The sheet ────────────────────────────────────────────────────────────────────────────
export default function BankrollDashboard({ bk, onClose }) {
  const toast = useToast();
  const closeRef = useRef(null);
  const [key, setKey] = useState(bk.selected);
  const [tab, setTab] = useState('balance');
  const [ledger, setLedger] = useState({ status: 'loading', data: null });
  const [prefsAll, setPrefsAll] = useState(null);
  const [risk, setRisk] = useState(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [version, setVersion] = useState(0);
  const today = getToday();

  const b = key === BANKROLL_ALL ? null : bk.bankrolls.find((x) => x.id === key);
  const currency = b ? b.currency : 'USD';
  const money = useCallback((v) => formatCurrencyAmount(Math.round(v || 0), currency), [currency]);
  const signed = useCallback((v) => (v > 0 ? '+' : '') + formatCurrencyAmount(Math.round(v || 0), currency), [currency]);

  useEffect(() => {
    let live = true;
    setLedger((s) => ({ status: 'loading', data: s.data }));
    setRisk(null);
    const q = `bankroll=${encodeURIComponent(String(key))}&currency=${currency}`;
    bk.call('GET', `/ledger?${q}`).then((d) => { if (live) setLedger({ status: 'ready', data: d }); })
      .catch(() => { if (live) setLedger({ status: 'error', data: null }); });
    bk.call('GET', `/risk?${q}`).then((d) => { if (live) setRisk(d); }).catch(() => {});
    return () => { live = false; };
  }, [key, currency, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    bk.call('GET', '/prefs').then((d) => setPrefsAll(d.prefs || {})).catch(() => {});
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    closeRef.current && closeRef.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const prefs = prefsAll ? prefsAll[String(key)] : null;
  const guide = bk.summary && bk.summary.guide ? bk.summary.guide.byKey[String(key)] : null;

  const savePrefs = async (body) => {
    setSaving(true);
    try {
      const r = await bk.call('PUT', `/prefs/${encodeURIComponent(String(key))}`, body);
      setPrefsAll((p) => ({ ...(p || {}), [String(key)]: { rules: r.rules, custom: r.custom, goals: r.goals } }));
      await bk.refresh(); // the guide (in the summary) follows the rule
      toast.success('Saved');
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  const d = ledger.data;
  const entries = d ? d.entries : [];
  const exportCsv = async () => {
    try {
      const names = new Map(bk.bankrolls.map((x) => [x.id, x.name]));
      const csv = ledgerToCsv(entries, { currency, bankrollName: (id) => names.get(id) || String(id) });
      const { shareOrDownloadBlob } = await import('../utils/export.js');
      const label = b ? b.name.replace(/[^\w-]+/g, '-').toLowerCase() : 'all';
      await shareOrDownloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `futuregame-ledger-${label}-${today}.csv`, 'text/csv');
    } catch (e) { toast.error('Export failed'); console.error('Ledger export:', e); }
  };

  const chips = [[BANKROLL_ALL, 'All'], ...bk.visible.map((x) => [x.id, x.name])];

  return createPortal(
    <>
      <div className="an-scrim" onClick={onClose} />
      <div className="an-sheet bd-sheet" role="dialog" aria-modal="true" aria-labelledby="bd-title">
        <header className="an-head">
          <h2 className="an-title-row" id="bd-title"><span className="an-cell an-title snap-g">Bankroll</span><span className="an-beta">Beta</span></h2>
          <button ref={closeRef} type="button" className="bk-btn bk-w8 bd-close" onClick={importing ? () => setImporting(false) : onClose}>
            <span>{importing ? 'Back' : 'Done'}</span>
          </button>
        </header>
        <div className="an-body">
          {importing ? (
            <BankrollImport bk={bk} toast={toast} defaultKey={key}
              onDone={() => { setImporting(false); setVersion((v) => v + 1); bk.refresh(); }} />
          ) : (
            <>
              <Seg cols="bd-seg4" label="Bankroll" options={chips} value={key} onChange={setKey} />
              <Segmented className="bd-tabs" label="Show" options={TABS} value={tab} onChange={setTab} btnClass="bk-seg-btn bd-tab" />
              {ledger.status === 'error' && <p className="an-p">The ledger could not load. Close and try again.</p>}
              {d && d.sources.some((s) => !s.ok) && (
                <p className="an-p">Not included (a ledger source failed): {d.sources.filter((s) => !s.ok).map((s) => s.name).join(', ')}.</p>
              )}
              {tab === 'balance' && d && (
                <BankrollOverview d={d} risk={risk} bk={bk} bkKey={key} b={b} currency={currency} money={money}
                  signed={signed} today={today} fmtDate={fmtDate} onClose={onClose} />
              )}
              {/* One line per further tab, keyed as in TABS above. */}

              {tab === 'rules' && <Rules guide={guide} prefs={prefs} money={money} onSave={savePrefs} saving={saving} />}
              {tab === 'rules' && <Risk risk={risk} money={money} />}
              {tab === 'goals' && (
                <Goals goals={prefs ? prefs.goals : []} entries={entries} money={money} today={today}
                  onSave={savePrefs} saving={saving} currency={currency} />
              )}

              {tab === 'data' && <section className="bd-section" aria-labelledby="bd-data">
                <h3 className="an-cell an-sec" id="bd-data">Import and export</h3>
                <p className="an-p">Export: every ledger entry of {b ? b.name : 'every bankroll'} with its running balance, as CSV.
                  Import: past tournament results and deposits from a CSV, previewed before anything is saved.</p>
                <div className="bd-actions">
                  <button type="button" className="bk-btn bk-btn--brand bk-w8" disabled={!entries.length} onClick={exportCsv}><span>Export CSV</span></button>
                  <button type="button" className="bk-btn bk-w8" onClick={() => setImporting(true)}><span>Import CSV</span></button>
                </div>
              </section>}
            </>
          )}
        </div>
      </div>
    </>,
    portalTarget(),
  );
}
