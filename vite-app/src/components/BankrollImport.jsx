import React, { useMemo, useRef, useState } from 'react';
import { formatCurrencyAmount, CURRENCY_CONFIG } from '../utils/utils.js';
import { BANKROLL_ALL, BANKROLL_MAIN } from '../utils/bankrolls.js';
import { parseCsv, detectPreset, applyPreset, guessMapping, applyMapping, columnSample, detectDateOrder, FIELDS, FIELDS_FOR, FIELD_LABELS } from '../utils/bankroll-csv.js';
import { IMPORT_GUIDES } from '../utils/import-guides.js';

/**
 * CSV import into the ledger (beta, app admins) — the dashboard's import step.
 *   1. pick the bankroll and the file;
 *   2. a recognised format (utils/bankroll-csv.js PRESETS: Poker Bankroll Tracker, Pokerbase's
 *      Custom Sheet) maps itself; anything else gets the column mapping;
 *   3. PREVIEW: the server checks every row (new / already imported / error) and writes nothing;
 *   4. import the new rows. Re-importing the same file finds them all and imports nothing.
 */
const STATUS = { new: 'New', duplicate: 'Have it', error: 'Error', skip: 'Skipped', bad: 'Unread' };
// What the rows of an unrecognised file are (the column matching's first question).
const ROWS_ARE = [
  ['tournament', 'Tournament results'],
  ['cash', 'Cash sessions'],
  ['mixed', 'Both (a column says which)'],
  ['adjustment', 'Deposits and withdrawals'],
];
const ROWS_HINT = {
  tournament: 'One tournament per row: buy-in per entry, entries (default 1) and the total cashed (0 for a bust).',
  cash: 'One cash session per row: when it started (with the time), when it ended or how many hours, the total bought in and the cash out. Tips and costs are optional.',
  mixed: 'One session per row, cash or tournament as the type column says; other types (deposits, expenses) are left out.',
  adjustment: 'One signed amount per row: positive is a deposit, negative a withdrawal, in the bankroll\u2019s currency.',
};

/** "Moving from another app?": the four biggest trackers' export steps (utils/import-guides.js), one at a
 *  time, as the Schedule's kind toggles. */
function ImportGuides() {
  const [open, setOpen] = useState(null);
  const g = IMPORT_GUIDES.find((x) => x.id === open);
  return (
    <section className="bd-section" style={{ marginTop: 0 }} aria-labelledby="bd-guides">
      <h3 className="an-cell an-sec" id="bd-guides">Moving from another app</h3>
      <p className="an-p">Pick the app you use for how to export from it.</p>
      <div className="kind-toggles bd-block" role="tablist" aria-label="Your current app" style={{ marginBottom: 'calc(var(--subrow) * 2)' }}>
        {IMPORT_GUIDES.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={open === x.id} title={x.name}
            className={'kind-toggle' + (open === x.id ? ' active' : '')} onClick={() => setOpen(open === x.id ? null : x.id)}>
            <span className="kind-toggle-label">{x.tab}</span>
          </button>
        ))}
      </div>
      {g && (
        <div role="tabpanel" aria-label={g.name}>
          <p className="an-p"><strong>{g.name}</strong>{g.recognised ? ' · recognised on sight' : ''}</p>
          {g.steps.map((t, i) => <p key={i} className="an-p">{i + 1}. {t}</p>)}
        </div>
      )}
    </section>
  );
}

export default function BankrollImport({ bk, toast, defaultKey, onDone }) {
  const fileRef = useRef(null);
  const targets = bk.visible;
  const [target, setTarget] = useState(defaultKey === BANKROLL_ALL || !targets.some((b) => b.id === defaultKey) ? BANKROLL_MAIN : defaultKey);
  const [file, setFile] = useState(null);          // { name, rows }
  const [preset, setPreset] = useState(null);      // detectPreset() result, or null for the mapping
  const [usePreset, setUsePreset] = useState(true);
  const [mapping, setMapping] = useState({});
  const [guessed, setGuessed] = useState({});     // what the headers matched by name, for the tick
  const [rowsAre, setRowsAre] = useState('tournament');
  const [currency, setCurrency] = useState('USD');
  const [dayFirst, setDayFirst] = useState(false);
  const [preview, setPreview] = useState(null);    // { items, server }
  const [busy, setBusy] = useState(false);

  const tb = targets.find((b) => b.id === target) || { currency: 'USD', name: 'Main' };
  const money = (v, cur) => formatCurrencyAmount(Math.round(v || 0), cur || tb.currency);

  const pick = async (f) => {
    if (!f) return;
    const text = await f.text();
    const rows = parseCsv(text);
    if (rows.length < 2) { toast.error('That file has no rows to import'); return; }
    const p = detectPreset(rows);
    setFile({ name: f.name, rows });
    setPreset(p);
    setUsePreset(!!p);
    const g = guessMapping(rows[0]);
    setMapping(g);
    setGuessed(g);
    // The file says which way its dates run when one can only be read one way (App improvements 208).
    const det = detectDateOrder(rows, g.date);
    if (det.order) setDayFirst(det.order === 'day');
    setPreview(null);
  };

  const items = useMemo(() => {
    if (!file) return [];
    if (preset && usePreset) return applyPreset(file.rows, preset);
    return applyMapping(file.rows, mapping, { rowsAre, currency, dayFirst });
  }, [file, preset, usePreset, mapping, rowsAre, currency, dayFirst]);

  const send = async (commit) => {
    const good = items.filter((i) => i.row);
    if (!good.length) { toast.error('No importable rows'); return null; }
    setBusy(true);
    try {
      return await bk.call('POST', '/import', { bankroll: target, commit, rows: good.map((i) => i.row) });
    } catch (e) { toast.error(e.message); return null; } finally { setBusy(false); }
  };
  const runPreview = async () => {
    const res = await send(false);
    if (res) setPreview({ items, server: res });
  };
  const runImport = async () => {
    const res = await send(true);
    if (!res) return;
    toast.success(`Imported ${res.imported} row${res.imported === 1 ? '' : 's'}${res.counts.duplicate ? `; ${res.counts.duplicate} already there` : ''}`);
    onDone();
  };

  // Client verdicts (skipped / unreadable) + the server's (new / have it / error), in file order.
  const lines = useMemo(() => {
    if (!preview) return [];
    let k = 0;
    return preview.items.map((i) => {
      if (!i.row) return { line: i.line, status: i.skip ? 'skip' : 'bad', what: i.skip || i.error, date: '', amount: null };
      const s = preview.server.rows[k++] || {};
      const r = i.row;
      const amount = r.type === 'tournament' ? r.cash - r.buyin * r.entries
        : r.type === 'cash' ? r.cashout - r.buyin - r.tips - r.expenses
          : (r.type === 'deposit' ? r.amount : -r.amount);
      const label = r.type === 'tournament' ? r.name + (s.note ? ` (${r.currency} to USD)` : '')
        : r.type === 'cash' ? ['Cash', r.stakes, r.game, r.room ? `· ${r.room}` : ''].filter(Boolean).join(' ')
          : r.type === 'deposit' ? 'Deposit' : 'Withdrawal';
      return { line: i.line, status: s.status, what: s.error || (i.warn ? `${label} (${i.warn})` : label), date: r.date, amount, cur: r.currency };
    });
  }, [preview]);
  const clientSkips = preview ? preview.items.filter((i) => !i.row).length : 0;

  const field = (label, control, key) => (
    <label className="bk-field" key={key}>
      <span className="bk-field-label">{label}</span>
      {control}
    </label>
  );
  // A column picker with what it will read (Bankroll design 81): the chosen column's first values on a 2r
  // line under it, a tick where the header matched by name, "not in this file" where the picker is empty.
  const sampleOf = (key) => {
    const col = mapping[key] ?? -1;
    if (col < 0) return <span className="an-cell an-note bd-sample is-none an-clip">not in this file</span>;
    const vals = columnSample(file && file.rows, col);
    const matched = guessed[key] === col;
    return (
      <span className="an-cell an-note bd-sample an-clip" title={vals.join(' · ')}>
        {matched && <svg className="bd-sample-tick" viewBox="0 0 16 16" aria-label="matched by name" role="img"><path d="M3 8.5l3.2 3.2L13 4.8" /></svg>}
        {vals.length ? vals.join(' · ') : 'empty in the first rows'}
      </span>
    );
  };
  const fieldS = (label, control, key) => (
    <label className="bk-field has-sample" key={key}>
      <span className="bk-field-label">{label}</span>
      {control}
      {sampleOf(key)}
    </label>
  );
  const headers = file ? file.rows[0] : [];

  return (
    <>
      <ImportGuides />
      <section className="bd-section" aria-labelledby="bd-imp">
        <h3 className="an-cell an-sec" id="bd-imp">Import CSV</h3>
        <div className="bk-fields bd-fields">
          {field('Into bankroll', (
            <select value={String(target)} onChange={(e) => { setTarget(e.target.value === BANKROLL_MAIN ? BANKROLL_MAIN : Number(e.target.value)); setPreview(null); }}>
              {targets.map((b) => <option key={b.id} value={String(b.id)}>{b.name} ({b.currency})</option>)}
            </select>
          ), 'target')}
        </div>
        <input ref={fileRef} className="bd-file" type="file" accept=".csv,text/csv,text/plain"
          onChange={(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ''; }} />
        <div className="bd-actions">
          <button type="button" className="bk-btn bk-btn--brand bk-w8" onClick={() => fileRef.current && fileRef.current.click()}>
            <span>{file ? 'Other file' : 'Choose file'}</span>
          </button>
        </div>
        {file && <p className="an-p"><strong>{file.name}</strong>: {file.rows.length - 1 - (preset ? preset.headerRow : 0)} rows.</p>}
        {file && preset && (
          <p className="an-p">
            Recognised a <strong>{preset.preset.name}</strong> file (its columns are published: {preset.preset.evidence}).
            Tournaments: cost = buy-in + rebuys + add-ons, cash = cashout + bounties. Cash games become cash
            sessions with the same net as in the app you are leaving.
          </p>
        )}
        {file && !preset && (
          <p className="an-p">
            Not a format we recognise, so say what the rows are and pick a column for each field. Pokerbase, Poker
            Analytics and Poker Income publish no column list, so their files come through here.
          </p>
        )}
      </section>

      {file && preset && (
        <div className="bd-block">
          <div className="bd-seg2" role="radiogroup" aria-label="Mapping">
            {[[true, preset.preset.name], [false, 'Map columns']].map(([v, text]) => (
              <button key={String(v)} type="button" role="radio" aria-checked={usePreset === v}
                className={'bk-seg-btn' + (usePreset === v ? ' is-on' : '')} onClick={() => { setUsePreset(v); setPreview(null); }}>
                <span>{text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {file && !(preset && usePreset) && (
        <section className="bd-section" aria-labelledby="bd-map">
          <h3 className="an-cell an-sec" id="bd-map">Columns</h3>
          <div className="bk-fields bd-fields">
            {field('Rows are', (
              <select value={rowsAre} onChange={(e) => { setRowsAre(e.target.value); setPreview(null); }}>
                {ROWS_ARE.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            ), 'rows-are')}
          </div>
          <div className="bk-fields bd-fields bd-block">
            {FIELDS_FOR[rowsAre].map((k) => FIELDS.find((f) => f.key === k)).filter(Boolean).map((f) => fieldS(((FIELD_LABELS[rowsAre] || {})[f.key] || f.label) + (f.required || (rowsAre === 'mixed' && f.key === 'kind') ? ' *' : ''), (
              <select value={String(mapping[f.key] ?? -1)} onChange={(e) => { setMapping({ ...mapping, [f.key]: Number(e.target.value) }); setPreview(null); }}>
                <option value="-1">—</option>
                {headers.map((h, i) => <option key={i} value={String(i)}>{h || `Column ${i + 1}`}</option>)}
              </select>
            ), f.key))}
            {field('Currency if none', (
              <select value={currency} onChange={(e) => { setCurrency(e.target.value); setPreview(null); }}>
                {Object.keys(CURRENCY_CONFIG).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ), 'cur')}
            {(() => {
              const det = detectDateOrder(file.rows, mapping.date ?? -1);
              const say = det.conflict ? `This file has dates both ways (line ${det.line} says ${det.value}); the rows that disagree won't import.`
                : det.order === 'day' ? `Day first: line ${det.line} says ${det.value}, which can only be read day first.`
                : det.order === 'month' ? `Month first: line ${det.line} says ${det.value}, which can only be read month first.` : null;
              return (
                <label className={'bk-field' + (say ? ' has-sample' : '')} key="df">
                  <span className="bk-field-label">Dates like 03/04/2025</span>
                  <select value={det.order ? (det.order === 'day' ? 'd' : 'm') : (dayFirst ? 'd' : 'm')} disabled={!!det.order} onChange={(e) => { setDayFirst(e.target.value === 'd'); setPreview(null); }}>
                    <option value="m">Month first</option>
                    <option value="d">Day first</option>
                  </select>
                  {say && <span className={'an-cell an-note bd-sample an-clip' + (det.conflict ? ' is-warn' : '')} title={say}>{say}</span>}
                </label>
              );
            })()}
          </div>
          <p className="an-p">{ROWS_HINT[rowsAre]}</p>
        </section>
      )}

      {file && (
        <div className="bd-actions">
          <button type="button" className="bk-btn bk-w8" disabled={busy || !items.some((i) => i.row)} onClick={runPreview}><span>Preview</span></button>
          <button type="button" className="bk-btn bk-btn--brand bk-w8" disabled={busy || !preview || !preview.server.counts.new} onClick={runImport}>
            <span>{preview ? `Import ${preview.server.counts.new}` : 'Import'}</span>
          </button>
        </div>
      )}

      {preview && (
        <section className="bd-section" aria-labelledby="bd-prev">
          <h3 className="an-cell an-sec" id="bd-prev">Preview</h3>
          <p className="an-p">
            <strong>{preview.server.counts.new} new</strong>, {preview.server.counts.duplicate} already imported,
            {' '}{preview.server.counts.error + preview.items.filter((i) => i.error).length} with errors, {clientSkips - preview.items.filter((i) => i.error).length} skipped.
            Nothing is saved until you import.
          </p>
          <div className="an-table" role="table" aria-label="Rows to import">
            <div className="an-row is-head bd-cols-preview" role="row">
              <span className="an-cell an-lbl an-lbl-3b" role="columnheader">Line</span>
              <span className="an-cell an-lbl an-lbl-3b" role="columnheader">Date</span>
              <span className="an-cell an-lbl an-lbl-3b" role="columnheader">Row</span>
              <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">Net</span>
              <span className="an-cell an-lbl an-lbl-3b an-num" role="columnheader">Status</span>
            </div>
            {lines.slice(0, 40).map((l) => (
              <div key={l.line} className="an-row is-body bd-cols-preview" role="row">
                <span className="an-cell an-td" role="cell">{l.line}</span>
                <span className="an-cell an-td an-clip" role="cell">{l.date}</span>
                <span className="an-cell an-td an-clip" role="cell" title={l.what}>{l.what}</span>
                <span className={'an-cell an-td an-num an-clip' + (l.amount > 0 ? ' an-pos' : l.amount < 0 ? ' an-neg' : '')} role="cell">
                  {l.amount == null ? '' : money(l.amount, l.cur)}
                </span>
                <span className={'an-cell an-td an-num an-clip bd-status-' + l.status} role="cell">{STATUS[l.status] || l.status}</span>
              </div>
            ))}
          </div>
          {lines.length > 40 && <p className="an-p">And {lines.length - 40} more rows.</p>}
          <p className="an-p">
            Tournament results are filed as private events (only you see them) and appear on the Results tab. A result
            in another currency is converted to USD at today&rsquo;s rate, with the original amounts kept in its notes.
            Cash sessions land on the Cash tab in their own currency, as if you had logged them there. Deposits and
            withdrawals must be in the bankroll&rsquo;s currency.
          </p>
        </section>
      )}
    </>
  );
}
