import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FAMILIES, rowStrip, search, recentRows, historyFromHands, playCounts, familyRows } from '../utils/variant-catalog.js';
import { getVenueInfo } from '../utils/utils.js';
import './variant-picker.css';
import { rulesFor } from '../utils/game-rules.js';
import useBackToClose from '../hooks/useBackToClose.js';

/* The rules of a game (Features 33): the betting, the order of play and how the pot is won, as the replayer
   plays it, with Create a hand of it. */
function RulesSheet({ row, onCreate, onClose }) {
  useBackToClose(true, onClose);
  const r = rulesFor(row);
  if (!r) return null;
  return createPortal(
    <>
      <div className="share-menu-backdrop vp-rules-backdrop" onClick={onClose} />
      <div className="share-menu-panel grid-sheet vp-rules" role="dialog" aria-label={`The rules of ${r.title}`}>
        <h3>{r.title}</h3>
        <p className="vp-rules-p">{r.structure}</p>
        <ol className="vp-rules-order">{r.order.map((o, i) => <li key={i}>{o}</li>)}</ol>
        {r.halves.map(([t, rule]) => (
          <div key={t} className="vp-rules-half"><b>{t}</b><span>{rule}</span></div>
        ))}
        {r.split && <p className="vp-rules-p">{r.split}</p>}
        <div className="rp-actions">
          <button type="button" className="btn btn-ghost ctl rp-btn" onClick={onClose}><span>Close</span></button>
          <button type="button" className="btn btn-primary ctl rp-btn" onClick={() => { onClose(); onCreate(row); }}><span>{`Create a ${row.name} hand`}</span></button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/*
 * The New Hand variant picker (owner, 2026-10-20: "implement the new variant picker"), the Variant
 * Picker study's recommendation: 8 (a game palette) with 10 (a best guess) on top, on one data layer
 * (utils/variant-catalog.js). It replaces the favourites, the family tabs, More and the Structure
 * block: every game AND structure is its own row (LHE, O8 and PLO8 apart), so a pick is one tap.
 *
 *   The best-guess card   what the player is in on My Schedule (playing now, starting soon, earlier
 *                         today), with the reason; a mix shows its rotation as chips. Tapping the card
 *                         or a chip picks it (the Create under the launcher makes the hand).
 *   The launcher          one 35g x 5r row: the family tag, the game, a chevron (⌘K on desktop). Opens
 *                         the palette.
 *   The palette           a bottom sheet on the phone, a centred 46g modal on desktop (⌘K or /).
 *                         Search (names, abbreviations, slang: "o8", "deuce", "27td"), jump chips to a
 *                         family, Recent, every family, the rotations (a mix opens into its games).
 *                         Tapping a row makes the hand at once; on desktop ↑↓ move, ↵ makes it, Esc
 *                         closes. Rare structures (NL Stud, PL Razz) come up in search only.
 */
const FAMILY_LABEL = Object.fromEntries(FAMILIES.map((f) => [f.id, f.label]));

function Tag({ row }) {
  const s = rowStrip(row);
  return <span className="vp-tag" style={{ background: s.color }}><span>{s.abbr}</span></span>;
}

const isDesktopNow = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 1024px)').matches : false);

export function Palette({ rows, mixes, history, current, onPick, onClose, hands = null }) {
  const [q, setQ] = useState('');
  const [rulesRow, setRulesRow] = useState(null);
  const [openMix, setOpenMix] = useState(null);
  const [hi, setHi] = useState(0);
  const desktop = isDesktopNow();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { if (desktop && inputRef.current) inputRef.current.focus(); }, [desktop]);
  useEffect(() => { setHi(0); }, [q]);

  const found = useMemo(() => search(rows, mixes, q), [rows, mixes, q]);
  /* A game found by name lists the mixes that deal it folded under one line: ten mixes under the one
     game buried the row being looked for (entry audit 34). A mix found by its own name stays open. */
  const [mixesOpen, setMixesOpen] = useState(false);
  useEffect(() => { setMixesOpen(false); }, [q]);
  const shownMixes = useMemo(() => {
    if (!found.byGame || found.rows.length === 0 || mixesOpen) return found.mixes;
    return found.mixes.filter((m) => !found.byGame.has(m.key));
  }, [found, mixesOpen]);
  const foldedMixes = found.mixes.length - shownMixes.length;
  /* Recent is this device's picks; with none, the saved hands' games ("From your saved hands"). Each
     family shows its 3 most-played rows and folds the rest under "+ N more" (UX pick 63): the palette
     opened on 64 rows. Search ignores the fold. */
  const seeded = !(history && history.length) && !!(hands && hands.length);
  const recent = useMemo(() => recentRows(rows, seeded ? historyFromHands(rows, hands) : history), [rows, history, hands, seeded]);
  const counts = useMemo(() => playCounts(rows, history, hands), [rows, history, hands]);
  const [openFams, setOpenFams] = useState(() => new Set());
  const famView = useMemo(() => Object.fromEntries(FAMILIES.filter((f) => f.id !== 'mixed').map((f) => {
    const all = rows.filter((r) => r.family === f.id && !r.rare);
    return [f.id, openFams.has(f.id) ? { shown: all, hidden: 0 } : familyRows(all, counts, current)];
  })), [rows, counts, current, openFams]);
  // The flat list of what can be picked, in display order (for ↑↓ and ↵).
  const items = useMemo(() => {
    if (q.trim()) return [...found.rows.map((r) => ({ row: r })), ...shownMixes.flatMap((m) => m.games.map((g) => ({ row: g, mix: m.mix })))];
    const out = recent.map((x) => ({ row: x.row, mix: x.mix }));
    for (const f of FAMILIES) {
      if (f.id === 'mixed') { if (openMix) { const m = mixes.find((x) => x.mix === openMix); if (m) out.push(...m.games.map((g) => ({ row: g, mix: m.mix }))); } continue; }
      out.push(...famView[f.id].shown.map((r) => ({ row: r })));
    }
    return out;
  }, [q, found, shownMixes, recent, rows, mixes, openMix, famView]);

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((i) => Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
      return;
    }
    if (e.key === 'Enter' && items[hi]) { e.preventDefault(); onPick(items[hi].row, { mix: items[hi].mix || null, create: true }); }
  };
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('.vp-row.is-hi');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const jump = (id) => {
    const el = listRef.current && listRef.current.querySelector(`[data-fam="${id}"]`);
    if (el) listRef.current.scrollTop = el.offsetTop - listRef.current.offsetTop;
  };
  let n = -1;   // the running index into items, to light the highlighted row
  const rowEl = (r, mix = null, extra = '') => {
    n += 1;
    const i = n;
    const on = current && current.key === r.key && (current.mix || null) === mix;
    return (
      <button key={(mix || '') + r.key + extra} type="button" role="option" aria-selected={on}
        className={'vp-row' + (on ? ' is-on' : '') + (desktop && i === hi ? ' is-hi' : '')}
        onMouseEnter={() => desktop && setHi(i)}
        onClick={() => onPick(r, { mix, create: true })}>
        <span className="vp-row-check" aria-hidden="true">{on ? '✓' : ''}</span>
        <span className="vp-row-name">{r.name}{mix ? <span className="vp-row-mix"> · {mix}</span> : null}</span>
        {!r.custom && (
          <span className="vp-row-info" role="button" tabIndex={-1} aria-label={`The rules of ${r.name}`}
            onClick={(e) => { e.stopPropagation(); setRulesRow(r); }}>i</span>
        )}
        <Tag row={r} />
      </button>
    );
  };

  const body = q.trim() ? (
    <>
      {found.rows.length === 0 && found.mixes.length === 0 && <div className="vp-empty">No game matches “{q}”</div>}
      {found.rows.map((r) => rowEl(r))}
      {shownMixes.length > 0 && <div className="vp-sec"><span>Mixes that deal it</span></div>}
      {shownMixes.map((m) => (
        <div key={m.key} className="vp-mixblock">
          <div className="vp-mixname"><span>{m.mix}</span></div>
          {m.games.map((g) => rowEl(g, m.mix))}
        </div>
      ))}
      {foldedMixes > 0 && (
        <button type="button" className="vp-row vp-mixrow" aria-expanded={false} onClick={() => setMixesOpen(true)}>
          <span className="vp-row-check" aria-hidden="true">▸</span>
          <span className="vp-row-name">Mixes containing it</span>
          <span className="vp-row-count">{foldedMixes}</span>
        </button>
      )}
    </>
  ) : (
    <>
      {recent.length > 0 && <div className="vp-sec"><span>{seeded ? 'From your saved hands' : 'Recent'}</span></div>}
      {recent.map((x) => rowEl(x.row, x.mix, '|recent'))}
      {FAMILIES.map((f) => (
        <React.Fragment key={f.id}>
          <div className="vp-sec" data-fam={f.id}><span>{f.label}</span></div>
          {f.id === 'mixed'
            ? mixes.map((m) => (
              <div key={m.key} className="vp-mixblock">
                <button type="button" className={'vp-row vp-mixrow' + (openMix === m.mix ? ' is-open' : '')} aria-expanded={openMix === m.mix}
                  onClick={() => setOpenMix(openMix === m.mix ? null : m.mix)}>
                  <span className="vp-row-check" aria-hidden="true">{openMix === m.mix ? '▾' : '▸'}</span>
                  <span className="vp-row-name">{m.mix}</span>
                  <span className="vp-row-count">{m.games.length} games</span>
                </button>
                {openMix === m.mix && m.games.map((g) => rowEl(g, m.mix))}
              </div>
            ))
            : <>
              {famView[f.id].shown.map((r) => rowEl(r))}
              {famView[f.id].hidden > 0 && (
                <button type="button" className="vp-row vp-mixrow vp-more" aria-expanded={false}
                  onClick={() => setOpenFams((s) => new Set(s).add(f.id))}>
                  <span className="vp-row-check" aria-hidden="true">+</span>
                  <span className="vp-row-name">{famView[f.id].hidden} more {f.label} {famView[f.id].hidden === 1 ? 'game' : 'games'}</span>
                  {/* The row's right column, as a rotation's "N games": its count, so the row reads across. */}
                  <span className="vp-row-count">Show all</span>
                </button>
              )}
            </>}
        </React.Fragment>
      ))}
    </>
  );

  // Desktop: the 46g modal centred on the SHELL's grid (its width in g is App's --dk-shell-n, which a
  // portal to the body does not inherit), at a whole-g offset from the shell's left edge.
  const shellN = desktop && typeof document !== 'undefined'
    ? parseFloat(getComputedStyle(document.querySelector('.app-shell') || document.body).getPropertyValue('--dk-shell-n')) || 0 : 0;
  const sheetStyle = desktop && shellN
    ? { left: `calc(50% - var(--gu) * ${shellN / 2} + var(--gu) * ${Math.round((shellN - 46) / 2)})` } : undefined;
  return createPortal(
    <div className={'vp-scrim' + (desktop ? ' is-desktop' : '')} onClick={onClose}>
      <div className="vp-sheet" style={sheetStyle} role="dialog" aria-label="Choose a game" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        {!desktop && <div className="vp-grabber" aria-hidden="true" />}
        <div className="vp-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>
          <input ref={inputRef} type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search games: PLO8, O8, deuce…" aria-label="Search games" autoComplete="off" autoCorrect="off" spellCheck={false} />
          {!desktop && <button type="button" className="vp-close" onClick={onClose}>Close</button>}
        </div>
        {!q.trim() && (
          <div className="vp-jumps">
            {FAMILIES.map((f) => <button key={f.id} type="button" className="vp-jump" onClick={() => jump(f.id)}><span>{f.label}</span></button>)}
          </div>
        )}
        <div className="vp-list" ref={listRef} role="listbox" aria-label="Games">{body}</div>
        {desktop && (
          <div className="vp-foot">
            <span>↑↓ move · ↵ create · esc close</span>
          </div>
        )}
      </div>
      {rulesRow && <RulesSheet row={rulesRow} onClose={() => setRulesRow(null)} onCreate={(r) => onPick(r, { create: true })} />}
    </div>,
    document.body,
  );
}

/** The best guess (utils/variant-catalog.js bestGuess) as a card: the reason, the game, a mix's chips. */
export function GuessCard({ guess, current, onPick }) {
  if (!guess) return null;
  const room = guess.property || (guess.venue ? getVenueInfo(guess.venue).longName || guess.venue : '');
  const shown = guess.games.find((g) => current && g.key === current.key) || guess.row;
  const s = rowStrip(shown);
  return (
    <div className="vp-guess">
      <span className="vp-guess-strip" style={{ background: s.color }} aria-hidden="true" />
      <button type="button" className="vp-guess-main" onClick={() => onPick(shown, { mix: guess.mix, create: false })}
        aria-label={`${guess.reason}${room ? ` at ${room}` : ''}: ${shown.name}${guess.mix ? `, ${guess.mix}` : ''}. Choose it`}>
        <span className="vp-guess-why"><span>{[guess.reason, room].filter(Boolean).join(' · ')}</span></span>
        <span className="vp-guess-name"><span>{shown.name}{guess.mix ? <span className="vp-guess-mix"> · {guess.mix}</span> : null}</span></span>
      </button>
      {guess.games.length > 1 && (
        <div className="vp-guess-chips">
          {guess.games.map((g) => (
            <button key={g.key} type="button" className={'vp-chip snap-g' + (current && current.key === g.key ? ' is-on' : '')}
              onClick={() => onPick(g, { mix: guess.mix, create: false })}><span>{rowStrip(g).abbr}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The launcher: the current pick, opening the palette. */
export function Launcher({ current, name, onOpen }) {
  const desktop = isDesktopNow();
  return (
    <button type="button" className="vp-launcher" onClick={onOpen} aria-haspopup="dialog" aria-label={`Game: ${name}. Change the game`}>
      {current && <Tag row={current} />}
      <span className="vp-launcher-name"><span>{name}</span></span>
      {desktop ? <span className="vp-kbd" aria-hidden="true">⌘K</span>
        : <svg className="vp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>}
    </button>
  );
}

export { FAMILY_LABEL };
