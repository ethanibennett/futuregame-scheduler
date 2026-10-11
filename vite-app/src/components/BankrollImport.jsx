import React, { useMemo, useRef, useState } from 'react';
import { formatCurrencyAmount, CURRENCY_CONFIG } from '../utils/utils.js';
import { BANKROLL_ALL, BANKROLL_MAIN } from '../utils/bankrolls.js';
import { parseCsv, detectPreset, applyPreset, guessMapping, applyMapping, FIELDS } from '../utils/bankroll-csv.js';

/**
 * CSV import into the ledger (beta, app admins) — the dashboard's import step.
 *   1. pick the bankroll and the file;
 *   2. a recognised format (utils/bankroll-csv.js PRESETS: Poker Bankroll Tracker, Pokerbase's
 *      Custom Sheet) maps itself; anything else gets the column mapping;
 *   3. PREVIEW: the server checks every row (new / already imported / error) and writes nothing;
 *   4. import the new rows. Re-importing the same file finds them all and imports nothing.
 */
const STATUS = { new: 'New', duplicate: 'Have it', error: 'Error', skip: 'Skipped', bad: 'Unread' };

export default function BankrollImport({ bk, toast, defaultKey, onDone }) {
  const fileRef = useRef(null);
  const targets = bk.visible;
  const [target, setTarget] = useState(defaultKey === BANKROLL_ALL || !targets.some((b) => b.id === defaultKey) ? BANKROLL_MAIN : defaultKey);
  const [file, setFile] = useState(null);          // { name, rows }
  const [preset, setPreset] = useState(null);      // detectPreset() result, or null for the mapping
  const [usePreset, setUsePreset] = useState(true);
  const [mapping, setMapping] = useState({});
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
    setMapping(guessMapping(rows[0]));
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
      const amount = r.type === 'tournament' ? r.cash - r.buyin * r.entries : (r.type === 'deposit' ? r.amount : -r.amount);
      return { line: i.line, status: s.status, what: s.error || (r.type === 'tournament' ? r.name + (s.note ? ` (${r.currency} to USD)` : '') : r.type === 'deposit' ? 'Deposit' : 'Withdrawal'), date: r.date, amount, cur: r.currency };
    });
  }, [preview]);
  const clientSkips = preview ? preview.items.filter((i) => !i.row).length : 0;

  const field = (label, control, key) => (
    <label className="bk-field" key={key}>
      <span className="bk-field-label">{label}</span>
      {control}
    </label>
  );
  const headers = file ? file.rows[0] : [];

  return (
    <>
      <section className="bd-section" style={{ marginTop: 0 }} aria-labelledby="bd-imp">
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
            Tournaments: cost = buy-in + rebuys + add-ons, cash = cashout + bounties. Cash-game rows are skipped.
          </p>
        )}
        {file && !preset && (
          <p className="an-p">
            Not a format we recognise, so pick a column for each field. Poker Income and Poker Analytics publish no
            column list, so their files go through this mapping too.
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
          <div className="bd-seg2" role="radiogroup" aria-label="Rows are">
            {[['tournament', 'Results'], ['adjustment', 'Deposits (±)']].map(([v, text]) => (
              <button key={v} type="button" role="radio" aria-checked={rowsAre === v}
                className={'bk-seg-btn' + (rowsAre === v ? ' is-on' : '')} onClick={() => { setRowsAre(v); setPreview(null); }}>
                <span>{text}</span>
              </button>
            ))}
          </div>
          <div className="bk-fields bd-fields bd-block">
            {FIELDS.filter((f) => (rowsAre === 'adjustment'
              ? ['date', 'amount', 'currency', 'note', 'name'].includes(f.key)
              : f.key !== 'amount')).map((f) => field(f.label + (f.required ? ' *' : ''), (
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
            {field('Dates like 03/04/2025', (
              <select value={dayFirst ? 'd' : 'm'} onChange={(e) => { setDayFirst(e.target.value === 'd'); setPreview(null); }}>
                <option value="m">Month first</option>
                <option value="d">Day first</option>
              </select>
            ), 'df')}
          </div>
          <p className="an-p">{rowsAre === 'adjustment'
            ? 'One signed amount per row: positive is a deposit, negative a withdrawal, in the bankroll’s currency.'
            : 'One tournament per row: buy-in per entry, entries (default 1) and the total cashed (0 for a bust).'}</p>
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
            Deposits and withdrawals must be in the bankroll&rsquo;s currency.
          </p>
        </section>
      )}
    </>
  );
}
