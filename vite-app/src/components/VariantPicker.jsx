import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FAMILIES, rowStrip, search, recentRows } from '../utils/variant-catalog.js';
import { getVenueInfo } from '../utils/utils.js';
import './variant-picker.css';

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

export function Palette({ rows, mixes, history, current, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [openMix, setOpenMix] = useState(null);
  const [hi, setHi] = useState(0);
  const desktop = isDesktopNow();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { if (desktop && inputRef.current) inputRef.current.focus(); }, [desktop]);
  useEffect(() => { setHi(0); }, [q]);

  const found = useMemo(() => search(rows, mixes, q), [rows, mixes, q]);
  const recent = useMemo(() => recentRows(rows, history), [rows, history]);
  // The flat list of what can be picked, in display order (for ↑↓ and ↵).
  const items = useMemo(() => {
    if (q.trim()) return [...found.rows.map((r) => ({ row: r })), ...found.mixes.flatMap((m) => m.games.map((g) => ({ row: g, mix: m.mix })))];
    const out = recent.map((x) => ({ row: x.row, mix: x.mix }));
    for (const f of FAMILIES) {
      if (f.id === 'mixed') { if (openMix) { const m = mixes.find((x) => x.mix === openMix); if (m) out.push(...m.games.map((g) => ({ row: g, mix: m.mix }))); } continue; }
      out.push(...rows.filter((r) => r.family === f.id && !r.rare).map((r) => ({ row: r })));
    }
    return out;
  }, [q, found, recent, rows, mixes, openMix]);

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
        <Tag row={r} />
      </button>
    );
  };

  const body = q.trim() ? (
    <>
      {found.rows.length === 0 && found.mixes.length === 0 && <div className="vp-empty">No game matches “{q}”</div>}
      {found.rows.map((r) => rowEl(r))}
      {found.mixes.length > 0 && <div className="vp-sec"><span>Mixes that deal it</span></div>}
      {found.mixes.map((m) => (
        <div key={m.key} className="vp-mixblock">
          <div className="vp-mixname"><span>{m.mix}</span></div>
          {m.games.map((g) => rowEl(g, m.mix))}
        </div>
      ))}
    </>
  ) : (
    <>
      {recent.length > 0 && <div className="vp-sec"><span>Recent</span></div>}
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
            : rows.filter((r) => r.family === f.id && !r.rare).map((r) => rowEl(r))}
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
