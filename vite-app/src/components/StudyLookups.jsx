import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ODDS_GAMES, icm, chipChop } from '../utils/odds.js';
import { useToast } from '../contexts/ToastContext.jsx';

/* Study › Look up, the two tools that need no solver (Features 34, 35; 2026-11-11). Both are arithmetic in
   the browser; neither is advice. */

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const num = (s) => Number(String(s || '').replace(/[^\d.]/g, '')) || 0;

export function DealCalculatorView({ onBack }) {
  const toast = useToast();
  const [rows, setRows] = useState([{ name: 'Player 1', chips: '' }, { name: 'Player 2', chips: '' }, { name: 'Player 3', chips: '' }]);
  const [prizes, setPrizes] = useState('');
  const [keep, setKeep] = useState('');
  const pz = useMemo(() => prizes.split(/[\s,/]+/).map(num).filter((x) => x > 0).sort((a, b) => b - a), [prizes]);
  const stacks = rows.map((r) => num(r.chips));
  const ready = stacks.length >= 2 && stacks.every((x) => x > 0) && pz.length >= stacks.length;
  const kept = Math.min(num(keep), pz[0] || 0);
  const pay = ready ? [pz[0] - kept, ...pz.slice(1, stacks.length)] : [];
  const iv = ready ? icm(stacks, pay) : [];
  const cc = ready ? chipChop(stacks, pay) : [];
  const total = pay.reduce((a, x) => a + x, 0);
  const set = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const copy = () => {
    const lines = rows.map((r, i) => `${r.name}: ${stacks[i].toLocaleString('en-US')} chips · ICM ${money(iv[i])} · chip chop ${money(cc[i])}`);
    if (kept) lines.push(`Left to play for: ${money(kept)}`);
    navigator.clipboard.writeText(lines.join('\n')).then(() => toast && toast.success('The figures are copied'), () => {});
  };
  return (
    <div className="hs-view lk-view">
      <div className="lk-head"><button type="button" className="lk-back" onClick={onBack}>‹ Study</button><h2 className="lk-title">Deal calculator</h2></div>
      <p className="lk-note">ICM assumes equal skill and ignores the blinds; the figures are a reference for a deal, not a ruling.</p>
      <div className="lk-table">
        <div className="lk-tr is-head"><span>Player</span><span>Chips</span><span>ICM</span><span>Chip chop</span></div>
        {rows.map((r, i) => (
          <div key={i} className="lk-tr">
            <input className="lk-in" value={r.name} onChange={(e) => set(i, 'name', e.target.value)} aria-label={`Player ${i + 1} name`} />
            <input className="lk-in is-num" inputMode="numeric" value={r.chips} placeholder="0" onChange={(e) => set(i, 'chips', e.target.value)} aria-label={`${r.name} chips`} />
            <b className="lk-fig">{ready ? money(iv[i]) : '—'}</b>
            <span className="lk-fig">{ready ? money(cc[i]) : '—'}</span>
          </div>
        ))}
      </div>
      <div className="lk-btns">
        {rows.length < 10 && <button type="button" className="btn btn-ghost ctl lk-btn" onClick={() => setRows([...rows, { name: `Player ${rows.length + 1}`, chips: '' }])}><span>+ Player</span></button>}
        {rows.length > 2 && <button type="button" className="btn btn-ghost ctl lk-btn" onClick={() => setRows(rows.slice(0, -1))}><span>− Player</span></button>}
      </div>
      <label className="lk-field"><span>Left to pay, 1st first</span><input value={prizes} placeholder="52,400 33,100 22,600 16,050" onChange={(e) => setPrizes(e.target.value)} /></label>
      <label className="lk-field"><span>Leave this much to play for</span><input inputMode="numeric" value={keep} placeholder="0" onChange={(e) => setKeep(e.target.value)} /></label>
      {ready && <p className="lk-note">{`${money(total)} dealt${kept ? `, ${money(kept)} left to play for` : ''}. Each column adds up to it.`}</p>}
      {!ready && <p className="lk-note">Every player’s chips, and at least as many prizes as players.</p>}
      <button type="button" className="btn btn-primary ctl lk-btn is-wide" disabled={!ready} onClick={copy}><span>Copy the figures</span></button>
    </div>
  );
}

export function OddsView({ onBack }) {
  const [game, setGame] = useState('NLH');
  const meta = ODDS_GAMES.find((g) => g[0] === game);
  const [hands, setHands] = useState(['', '']);
  const [board, setBoard] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const worker = useRef(null);
  const seq = useRef(0);
  useEffect(() => () => { if (worker.current) worker.current.terminate(); }, []);
  const run = () => {
    if (!worker.current) worker.current = new Worker(new URL('../utils/odds-worker.js', import.meta.url), { type: 'module' });
    const id = ++seq.current;
    setBusy(true);
    worker.current.onmessage = (e) => { if (e.data.id !== seq.current) return; setResult(e.data.result); setBusy(false); };
    worker.current.postMessage({ id, game, hands, board: meta[3] === 'board' ? board : '' });
  };
  const split = ['PLO8', 'PLO6 8/b', 'NL Big O', 'Stud 8'].includes(game);
  return (
    <div className="hs-view lk-view">
      <div className="lk-head"><button type="button" className="lk-back" onClick={onBack}>‹ Study</button><h2 className="lk-title">Odds</h2></div>
      <div className="lk-games" role="radiogroup" aria-label="Game">
        {ODDS_GAMES.map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={game === id} className={'hx-tag' + (game === id ? ' is-on' : '')} onClick={() => { setGame(id); setResult(null); }}><span>{label}</span></button>
        ))}
      </div>
      {meta[3] === 'board' && (
        <label className="lk-field"><span>Board (0, 3, 4 or 5 cards)</span><input value={board} placeholder="4s 5d Th" autoCapitalize="off" onChange={(e) => { setBoard(e.target.value); setResult(null); }} /></label>
      )}
      {hands.map((h, i) => (
        <div key={i} className="lk-hand">
          <label className="lk-field"><span>{`Hand ${i + 1}${meta[3] === 'board' ? ` · ${meta[2]} cards` : ' · every card it holds'}`}</span>
            <input value={h} placeholder={meta[3] === 'board' ? (meta[2] === 2 ? 'As Kd' : 'Ah Kh Qc Jc'.split(' ').slice(0, Math.min(4, meta[2])).join(' ')) : 'As 2s 3d'} autoCapitalize="off"
              onChange={(e) => { setHands(hands.map((x, j) => (j === i ? e.target.value : x))); setResult(null); }} />
          </label>
          {result && result.players && result.players[i] && (
            <span className="lk-share">
              <b>{`${(result.players[i].equity * 100).toFixed(1)}%`}</b>
              {split && <i>{`scoops ${(result.players[i].scoop * 100).toFixed(1)}%`}</i>}
            </span>
          )}
        </div>
      ))}
      <div className="lk-btns">
        {hands.length < 6 && <button type="button" className="btn btn-ghost ctl lk-btn" onClick={() => setHands([...hands, ''])}><span>+ Hand</span></button>}
        {hands.length > 2 && <button type="button" className="btn btn-ghost ctl lk-btn" onClick={() => setHands(hands.slice(0, -1))}><span>− Hand</span></button>}
      </div>
      <button type="button" className="btn btn-primary ctl lk-btn is-wide" disabled={busy || hands.some((h) => !h.trim())} onClick={run}><span>{busy ? 'Counting…' : 'Work out the odds'}</span></button>
      {result && result.error && <p className="lk-note rp-err">{result.error}</p>}
      {result && result.players && (
        <p className="lk-note">{result.exact ? `Every run-out: ${result.runs.toLocaleString('en-US')}.` : `A sample of ${result.runs.toLocaleString('en-US')} run-outs, within ${(result.margin * 100).toFixed(1)} points either way.`}
          {split && result.noLow ? ` No low in ${(result.noLow * 100).toFixed(1)}%.` : ''} Shares of the pot, by the replayer’s own rules.</p>
      )}
    </div>
  );
}
