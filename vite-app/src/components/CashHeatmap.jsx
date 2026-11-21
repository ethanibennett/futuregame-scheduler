import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { API_URL } from '../utils/api.js';

// ── Cash watcher: Heatmaps ──
// Day-of-week × hour traffic for one game at one venue, from /api/heatmap. Pick
// a venue + game/stake; the grid shows when it runs and how busy. Needs ~2 weeks
// of collected history to be meaningful.

// Heatmap geometry: a 4g hour column (labels end 1g short of it), then seven 4g day columns
// that touch — told apart by the inset hairline each cell draws, so the gaps are hairlines and
// cost no width. 32g, placed with the labels from 2g: cells on 6g..34g, every edge a whole g.
// Every row 2r.
const HEAT_COLS = 'calc(var(--gu) * 4) repeat(7, calc(var(--gu) * 4))';
const HEAT_COL_GAP = 0;
const HEAT_W = 'calc(var(--gu) * 32)';
const HEAT_ROW_H = 'calc(var(--subrow) * 2)';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UNIVERS = "var(--font-condensed, 'Univers Condensed', 'Univers', sans-serif)";
/* The Game list's order (owner, 2026-11-21: "First list the NLH games in ascending stakes, then PLO, then
   anything else"): NLH, then PLO, then every other game by name; within a game by ascending stakes, the big
   blind first, then the small blind, then any third figure (a straddle or a "5/10/20"). */
const GAME_RANK = { NLH: 0, PLO: 1 };
const stakesNums = (s) => String(s || '').split('/').map(x => parseFloat(String(x).replace(/[^0-9.]/g, '')) || 0);
const stakesKey = (s) => { const n = stakesNums(s); return n.length >= 2 ? [n[1], n[0], ...n.slice(2)] : n; };
export function gameOrder(a, b) {
  const ra = GAME_RANK[a.gameType] ?? 2, rb = GAME_RANK[b.gameType] ?? 2;
  if (ra !== rb) return ra - rb;
  if (ra === 2 && a.gameType !== b.gameType) return String(a.gameType).localeCompare(String(b.gameType));
  const x = stakesKey(a.stakes), y = stakesKey(b.stakes);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const SEL_KEY = 'cashHeatmapSel';
const METRIC_KEY = 'cashHeatmapMetric';
const gLabel = (g) => `${g.stakes} ${g.gameType}`;
const hourLabel = (h) => h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;

// Compact avg-tables label for a tiny cell: "1.8", "2", "12", ".5", "0".
function fmtTables(n) {
  const r = Math.round((n || 0) * 10) / 10;
  if (r >= 10) return String(Math.round(r));
  if (r >= 1) return Number.isInteger(r) ? String(r) : r.toFixed(1);
  if (r <= 0) return '0';
  return '.' + Math.round(r * 10);
}

// Green heat, alpha ramped by intensity, over the card surface.
function cellColor(intensity, hasData) {
  if (!hasData) return 'var(--surface-sunken, rgba(255,255,255,0.03))';
  const a = 0.10 + 0.90 * Math.max(0, Math.min(1, intensity));
  return `rgba(74, 170, 120, ${a.toFixed(3)})`;
}

export default function CashHeatmap({ token, locationVersion = 0 }) {
  const [catalog, setCatalog] = useState(null); // { vNames, byVenue }
  // The cash location picker steers which rooms the watcher collects; the heatmap offers the
  // same rooms. While the watcher is still switching to a newly picked location the list can't
  // be trusted yet, so it says so and re-checks (pending = the label it is switching to).
  const [pending, setPending] = useState(null);
  const [recheck, setRecheck] = useState(0);
  const [sel, setSel] = useState(() => { try { return JSON.parse(localStorage.getItem(SEL_KEY)) || null; } catch { return null; } });
  const [metric, setMetric] = useState(() => localStorage.getItem(METRIC_KEY) || 'tables'); // 'tables' | 'reliability'
  const [cells, setCells] = useState(null);
  // Where the cells came from: the 10-minute collector, or the hourly nationwide sweep for a room the
  // collector has barely watched; both over the watcher's rolling window (eight weeks).
  const [basis, setBasis] = useState(null); // { source, days, windowDays }
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [err, setErr] = useState('');
  const [pick, setPick] = useState(null); // a tapped cell, for the readout
  // Counts the catalog's loads, so the heatmap on screen is asked for again each time (below).
  const [catalogAt, setCatalogAt] = useState(0);
  // The selection as last rendered, and whether it was made for the viewer (not picked from the lists): a stored
  // pick is the viewer's; a location whose rooms do not include it makes the next one automatic.
  const selRef = useRef(sel);
  selRef.current = sel;
  const autoSel = useRef(!sel);

  // Catalog (venues + games) for the pickers.
  useEffect(() => {
    let live = true;
    (async () => {
      const headers = { Authorization: 'Bearer ' + token };
      try {
        const [gRes, vRes, lRes] = await Promise.all([
          fetch(`${API_URL}/cash/games`, { headers }),
          fetch(`${API_URL}/cash/venues`, { headers }).catch(() => null),
          fetch(`${API_URL}/cash/location`, { headers }).catch(() => null),
        ]);
        if (!gRes.ok) {
          setErr(gRes.status === 403 ? 'This account is not an admin.' : gRes.status === 503 ? 'Cash watcher is offline.' : 'Could not load the game catalog.');
          setStatus('error');
          return;
        }
        const g = await gRes.json();
        const vNames = {};
        if (vRes && vRes.ok) { try { const v = await vRes.json(); (v.venues || []).forEach(x => { vNames[x.slug] = x.name; }); } catch { /* names optional */ } }
        /* /cash/games is every (venue, game, stakes) the watcher has EVER recorded, but names come only from
           /cash/venues, its ACTIVE list, so a room it sampled and dropped would surface as a bare slug. Only rooms
           on the active list are offered (below). Until 2026-11-21 rooms with data from the last two days were
           offered too, because the hosted list could lag the box by many minutes; it now follows within seconds. */
        const named = Object.keys(vNames).length > 0;
        let loc = null;
        if (lRes && lRes.ok) { try { loc = await lRes.json(); } catch { /* treat as unknown */ } }
        const switching = !!(loc && loc.pending);
        /* The active list IS the set of rooms near the picked location (the watcher derives it from that
           point and radius), so it is the whole answer. Only the current location's named rooms (owner, 2026-11-21: "the venue dropdown has a bunch of Bravo
           nonsense and still has the Texas rooms"): the allowance for rooms with recent data during a switch, and
           offering everything when the list did not load, put the last locations' rooms on the list as bare ids
           ("Bravo Bela"). A switch now applies within seconds, so it waits on the list instead. */
        if (!named) {
          if (!live) return;
          // Mid-switch, pending drives the 2 s recheck below; without it this message never cleared on its own.
          setPending(switching ? ((loc.requested && loc.requested.label) || loc.label || 'the new location') : null);
          setErr(switching ? 'Updating the rooms for the new location…' : 'Could not load the room names. Try again.');
          setStatus('error');
          return;
        }
        // A row with no stakes ("NLH null", a listing the room gave no blinds) has no heatmap to show.
        const rows = (g.games || []).filter(row => vNames[row.venueSlug] && row.stakes && row.stakes !== 'null');
        const byVenue = {};
        rows.forEach(row => { (byVenue[row.venueSlug] = byVenue[row.venueSlug] || []).push(row); });
        for (const k of Object.keys(byVenue)) byVenue[k].sort(gameOrder);
        if (!live) return;
        setPending(switching ? ((loc.requested && loc.requested.label) || loc.label || 'the new location') : null);
        setCatalog({ vNames, byVenue });
        setCatalogAt(n => n + 1);
        /* The selection: the one on screen while this location still has it and it was the viewer's choice, else
           the most-seen game. A choice made for the viewer is made again at each load, because the first load
           after a switch counts only the collector's few polls (the sweep's weeks arrive seconds later), so it
           would keep a minor game. Worked out here, not in a state updater, which React may run again. */
        const prev = selRef.current;
        const valid = !!(prev && byVenue[prev.venue] && byVenue[prev.venue].some(x => x.gameType === prev.gameType && x.stakes === prev.stakes));
        if (!valid) autoSel.current = true;
        if (!valid || autoSel.current) {
          const best = rows.slice().sort((a, b) => (b.samples || 0) - (a.samples || 0))[0];
          const next = best ? { venue: best.venueSlug, gameType: best.gameType, stakes: best.stakes } : null;
          if (!next || !prev || next.venue !== prev.venue || next.gameType !== prev.gameType || next.stakes !== prev.stakes) setSel(next);
        }
        setStatus('ready');
      } catch { if (live) { setErr('Could not reach the server.'); setStatus('error'); } }
    })();
    return () => { live = false; };
  }, [token, locationVersion, recheck]);

  // While the watcher is switching, look again every 2 s (the box pulls the pick within 1 s and posts the
  // new room list the moment it is derived); stop after ~4 minutes rather than polling forever. Once the
  // switch applies, look again as the new rooms' games and sweep heatmaps arrive (owner, 2026-11-21:
  // "We have to get this to update much faster to a new location"; "no heatmaps for columbus, oh": the box
  // sends a room's weeks of sweep a few seconds after its room list, so the first look has only its own polls).
  const rechecks = useRef(0);
  const wasPending = useRef(false);
  useEffect(() => { rechecks.current = 0; }, [locationVersion]);
  useEffect(() => {
    if (!pending || rechecks.current >= 120) return undefined;
    const id = setTimeout(() => { rechecks.current += 1; setRecheck(n => n + 1); }, 2000);
    return () => clearTimeout(id);
  }, [pending, recheck]);
  useEffect(() => {
    if (pending) { wasPending.current = true; return undefined; }
    if (!wasPending.current) return undefined;
    wasPending.current = false;
    const ids = [3000, 8000, 15000, 30000, 60000].map(ms => setTimeout(() => setRecheck(n => n + 1), ms));
    return () => ids.forEach(clearTimeout);
  }, [pending]);

  /* Heatmap for the current selection, asked for again whenever the catalog reloads: a room picked moments ago
     answers from its few collector polls until the box's sweep summaries land, and the selection usually stays
     the same across those reloads, so keying on it alone kept that first, nearly empty answer on screen. A
     refresh of the same selection keeps its cells until the new ones arrive (no flash of Loading). */
  const shownKey = useRef('');
  useEffect(() => {
    if (!sel) return;
    let live = true;
    const key = `${sel.venue}|${sel.gameType}|${sel.stakes}`;
    if (key !== shownKey.current) { shownKey.current = key; setCells(null); setBasis(null); }
    (async () => {
      const headers = { Authorization: 'Bearer ' + token };
      const tz = -new Date().getTimezoneOffset(); // minutes UTC->local, as the API wants
      const qs = new URLSearchParams({ venue: sel.venue, game: sel.gameType, stakes: sel.stakes, tz: String(tz) });
      try {
        const res = await fetch(`${API_URL}/cash/heatmap?${qs.toString()}`, { headers });
        const j = res.ok ? await res.json() : { cells: [] };
        if (live) { setCells(j.cells || []); setBasis(j.source ? { source: j.source, days: j.days, windowDays: j.windowDays } : null); }
      } catch { if (live) setCells(c => c || []); }
    })();
    return () => { live = false; };
  }, [sel, token, catalogAt]);

  const persistSel = useCallback((s) => { autoSel.current = false; setSel(s); try { localStorage.setItem(SEL_KEY, JSON.stringify(s)); } catch { /* ignore */ } setPick(null); }, []);
  const persistMetric = useCallback((m) => { setMetric(m); try { localStorage.setItem(METRIC_KEY, m); } catch { /* ignore */ } }, []);

  /* Seat the grid on the r lines: the pickers and metric buttons above it are not whole-r
     tall, so its top landed 0.19r off a line (measured). Drop it onto the next line,
     measured from the grid origin (the top bar's top) with a 100r probe for r. */
  const gridRef = useRef(null);
  const [gridDrop, setGridDrop] = useState(0);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return undefined;
    const snap = () => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;height:calc(var(--subrow) * 100);width:0;visibility:hidden';
      document.body.appendChild(probe);
      const r = probe.getBoundingClientRect().height / 100;
      probe.remove();
      const bar = document.querySelector('.top-bar');
      if (!(r > 0) || !bar) return;
      // The container's own top does not move with its padding-top, so this is stable.
      const t = (el.getBoundingClientRect().top - bar.getBoundingClientRect().top) / r;
      const frac = t - Math.floor(t);
      const drop = frac < 0.01 || frac > 0.99 ? 0 : 1 - frac;
      if (Math.abs(drop - gridDrop) > 0.005) setGridDrop(drop);
    };
    snap();
    window.addEventListener('resize', snap);
    return () => window.removeEventListener('resize', snap);
  });

  const cellMap = useMemo(() => {
    const m = new Map();
    for (const c of (cells || [])) m.set(`${c.dow}-${c.hour}`, c);
    return m;
  }, [cells]);
  const maxMean = useMemo(() => Math.max(0.0001, ...(cells || []).map(c => c.meanTables || 0)), [cells]);

  const venueSlugs = catalog ? Object.keys(catalog.byVenue).sort((a, b) =>
    String(catalog.vNames[a] || a).localeCompare(String(catalog.vNames[b] || b))) : [];
  const gamesForVenue = (catalog && sel && catalog.byVenue[sel.venue]) || [];

  // Fill the height CashView hands us (heatmap mode is a flex-fill column) so the
  // 24 hour-rows scale to fit the screen instead of overflowing into a scroll.
  const wrap = { maxWidth: 'calc(var(--subrow) * 85)', margin: '0 auto', padding: 'var(--subrow) 0', width: '100%', flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' };
  /* The hour you are in (UX pick 101): today's column and this hour's row marked, its cell ringed, and
     the readout at rest says it, with the week's busiest hour. The grid's days and hours are the
     device's own (the tz goes to the API). */
  const nowAt = new Date();
  const nowDow = nowAt.getDay(), nowHour = nowAt.getHours();
  const selectStyle = { background: 'var(--surface, #1a1a1a)', color: 'var(--text, #fff)', border: 'var(--bw-hair) solid var(--border, #333)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-sm) var(--space-md)', fontSize: 'calc(var(--gu) * 1.178)', maxWidth: '100%' };

  if (status === 'error') {
    return <div style={wrap}><div style={{ border: 'var(--bw-hair) solid var(--border,#333)', borderRadius: 'calc(var(--subrow) * 1.25)', padding: 'var(--space-xl)', color: 'var(--text-muted,#aaa)' }}>{err}</div></div>;
  }
  if (status === 'loading' || !catalog) {
    return <div style={wrap}><div style={{ color: 'var(--text-muted,#aaa)', padding: 'var(--space-2xl)', textAlign: 'center' }}>Loading…</div></div>;
  }
  if (!sel) {
    return <div style={wrap}><div style={{ color: 'var(--text-muted,#aaa)', padding: 'var(--space-2xl)', textAlign: 'center' }}>No games collected yet.</div></div>;
  }

  return (
    <div style={wrap}>
      {pending && (
        <div style={{ height: 'calc(var(--subrow) * 3)', lineHeight: 'calc(var(--subrow) * 3)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted,#aaa)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 'var(--space-sm)' }}>
          Switching rooms to {pending}. The list updates in a few seconds.
        </div>
      )}
      {/* Room and Game as the app's own fields (UX pick 102): two 17g x 5r tiles, a caption over the
          value and a caret, the native select laid over each at no opacity, so the tap still opens the
          system's own list. They were native selects 17.32g and 15.55g wide, on no line. */}
      <div className="cash-picks">
        <label className="cash-pick">
          <span className="cash-pick-cap">Room</span>
          <span className="cash-pick-val">{catalog.vNames[sel.venue] || sel.venue}</span>
          <span className="cash-pick-caret" aria-hidden="true">{'\u2304'}</span>
        <select value={sel.venue} className="cash-pick-select" aria-label="Room"
          onChange={(e) => {
            const venue = e.target.value;
            const list = catalog.byVenue[venue] || [];
            // The room's busiest game, not the first in the list (which is ordered by game and stakes).
            const top = list.slice().sort((a, b) => (b.samples || 0) - (a.samples || 0))[0];
            persistSel(top ? { venue, gameType: top.gameType, stakes: top.stakes } : { venue, gameType: sel.gameType, stakes: sel.stakes });
          }}>
          {venueSlugs.map(s => <option key={s} value={s}>{catalog.vNames[s] || s}</option>)}
        </select>
        </label>
        <label className="cash-pick">
          <span className="cash-pick-cap">Game</span>
          <span className="cash-pick-val">{(() => { const g = gamesForVenue.find(x => x.gameType === sel.gameType && x.stakes === sel.stakes); return g ? gLabel(g) : sel.stakes + ' ' + sel.gameType; })()}</span>
          <span className="cash-pick-caret" aria-hidden="true">{'\u2304'}</span>
        <select value={`${sel.gameType}|${sel.stakes}`} className="cash-pick-select" aria-label="Game"
          onChange={(e) => { const [gameType, stakes] = e.target.value.split('|'); persistSel({ venue: sel.venue, gameType, stakes }); }}>
          {gamesForVenue.map(g => <option key={gLabel(g)} value={`${g.gameType}|${g.stakes}`}>{gLabel(g)}</option>)}
        </select>
        </label>
      </div>

      {/* The metric as the app's segmented strip (UX pick 102): 35g x 3r, 2r above the grid. */}
      <div className="live-update-tabs cash-metric" role="group" aria-label="Show">
        {[['tables', 'Avg tables'], ['reliability', 'Reliability']].map(([m, lbl]) => (
          <button key={m} type="button" className={metric === m ? 'active' : ''} aria-pressed={metric === m} onClick={() => persistMetric(m)}>{lbl}</button>
        ))}
      </div>

      {cells === null ? (
        <div style={{ color: 'var(--text-muted,#aaa)', padding: 'var(--space-2xl)', textAlign: 'center' }}>Loading heatmap…</div>
      ) : cells.length === 0 ? (
        <div style={{ color: 'var(--text-muted,#aaa)', padding: 'var(--space-2xl)', textAlign: 'center' }}>Not enough history yet — this fills in after about two weeks of collection.</div>
      ) : (
        <>
          {/* Vertical orientation: hours run DOWN as rows, the 7 days ACROSS as
              columns. Seven columns fit the phone width, so no horizontal scroll —
              the grid grows downward instead. */}
          {/* Every cell is 3g x 2r, columns 1g apart, every edge on a whole g (see HEAT_COLS);
              24 rows x 2r = 48r with no row gap. Vertically adjacent cells are told apart by an
              inset hairline in the background colour, which costs no size. */}
          <div ref={gridRef} style={{ flex: 'none', display: 'flex', flexDirection: 'column', width: HEAT_W, maxWidth: '100%', margin: '0 auto', position: 'relative', left: 'calc(var(--gu) * -0.5)', paddingTop: `calc(var(--subrow) * ${gridDrop.toFixed(4)})` }}>
            {/* Day axis (column headers), one 2r line */}
            <div style={{ display: 'grid', gridTemplateColumns: HEAT_COLS, gridAutoRows: HEAT_ROW_H, columnGap: HEAT_COL_GAP, rowGap: 0, flexShrink: 0 }}>
              <div />
              {DOW.map((day, d) => (
                <div key={d} style={{ fontSize: 'calc(var(--gu) * 0.884)', color: d === nowDow ? 'var(--brand)' : 'var(--text-muted,#999)', fontWeight: d === nowDow ? 'var(--fw-bold)' : undefined, textAlign: 'center', fontFamily: UNIVERS, textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{day}</div>
              ))}
            </div>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ display: 'grid', gridTemplateColumns: HEAT_COLS, gridAutoRows: HEAT_ROW_H, columnGap: HEAT_COL_GAP, rowGap: 0, flex: 'none' }}>
                <div style={{ fontSize: 'calc(var(--gu) * 0.884)', color: h === nowHour ? 'var(--brand)' : 'var(--text-muted,#999)', fontWeight: h === nowHour ? 'var(--fw-bold)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 'var(--gu)', fontFamily: UNIVERS, fontVariantNumeric: 'tabular-nums' }}>{hourLabel(h)}</div>
                {DOW.map((day, d) => {
                  const c = cellMap.get(`${d}-${h}`);
                  const hasData = !!(c && c.samples > 0);
                  const intensity = !hasData ? 0 : metric === 'reliability' ? (c.ranFraction || 0) : (c.meanTables || 0) / maxMean;
                  const active = pick && pick.dow === d && pick.hour === h;
                  const val = !hasData ? '' : metric === 'reliability' ? String(Math.round((c.ranFraction || 0) * 100)) : fmtTables(c.meanTables);
                  return (
                    <button key={d}
                      className={'cash-heat-cell' + (hasData ? '' : ' no-data')}
                      onClick={() => setPick(hasData ? { dow: d, hour: h, ...c } : null)}
                      onMouseEnter={() => { if (hasData) setPick({ dow: d, hour: h, ...c }); }}
                      title={hasData ? `${day} ${hourLabel(h)} · ${(c.meanTables || 0).toFixed(1)} tables avg · ran ${Math.round((c.ranFraction || 0) * 100)}% · ${c.samples} polls` : `${day} ${hourLabel(h)} · no data`}
                      style={{
                        /* The cell's share of the busiest hour, for the Swiss theme's ink tint
                           (theme-swiss.css); an unused custom property everywhere else. */
                        '--heat': intensity.toFixed(3),
                        position: 'relative',
                        /* Exactly the 4g x 2r track: no border (the pick ring and the
                           separating hairline are inset shadows), so nothing adds size. */
                        boxSizing: 'border-box', width: '100%', height: '100%', minHeight: 0, border: 0, margin: 0,
                        boxShadow: active ? 'inset 0 0 0 calc(var(--bw-hair) * 2) var(--text,#fff)'
                          : d === nowDow && h === nowHour ? 'inset 0 0 0 calc(var(--bw-hair) * 3) var(--brand)'
                          : 'inset 0 0 0 var(--bw-hair) var(--bg,#111)',
                        borderRadius: 'calc(var(--subrow) * 0.25)', background: cellColor(intensity, hasData), cursor: hasData ? 'pointer' : 'default', padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 'calc(var(--gu) * 0.736)', lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                        color: 'rgba(255,255,255,0.92)', textShadow: '0 calc(var(--subrow) * 0.125) calc(var(--subrow) * 0.125) rgba(0,0,0,0.55)',
                      }}>{val}</button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Legend + tapped-cell readout */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-lg)', marginTop: 'var(--space-lg)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'calc(var(--gu) * 0.913)', color: 'var(--text-muted,#888)' }}>
              <span>{metric === 'reliability' ? '0%' : '0'}</span>
              <span style={{ width: 'calc(var(--subrow) * 11.25)', height: 'calc(var(--subrow) * 1)', borderRadius: 'var(--radius-xs)', background: `linear-gradient(90deg, ${cellColor(0.1, true)}, ${cellColor(1, true)})` }} />
              <span>{metric === 'reliability' ? '100%' : `${maxMean.toFixed(1)} tables`}</span>
            </div>
            <div style={{ fontSize: 'calc(var(--gu) * 0.972)', color: 'var(--text-muted,#aaa)', fontVariantNumeric: 'tabular-nums' }}>
              {pick
                ? `${DOW[pick.dow]} ${hourLabel(pick.hour)} — ${(pick.meanTables || 0).toFixed(1)} tables avg · ran ${Math.round((pick.ranFraction || 0) * 100)}%`
                : (() => {
                  const c = cellMap.get(`${nowDow}-${nowHour}`);
                  const nowTxt = `Now, ${DOW[nowDow]} ${hourLabel(nowHour)}: ${c && c.samples > 0 ? fmtTables(c.meanTables) + ' tables' : 'no data'}`;
                  let best = null;
                  for (const x of cells) if (x.samples > 0 && (!best || (x.meanTables || 0) > (best.meanTables || 0))) best = x;
                  return best ? `${nowTxt} \u00b7 busiest ${DOW[best.dow]} ${hourLabel(best.hour)}, ${fmtTables(best.meanTables)}` : nowTxt;
                })()}
            </div>
          </div>
          {basis && (
            <div style={{ marginTop: 'var(--subrow)', fontSize: 'calc(var(--gu) * 0.913)', color: 'var(--text-muted,#888)' }}>
              {basis.source === 'sweep'
                ? `Hourly, from the nationwide sweep: ${basis.days} days`
                : 'Every 10 minutes, from the watched rooms'}
              {basis.windowDays ? ` · last ${Math.round(basis.windowDays / 7)} weeks` : ''}
            </div>
          )}
        </>
      )}
    </div>
  );
}
