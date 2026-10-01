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
const SEL_KEY = 'cashHeatmapSel';
const METRIC_KEY = 'cashHeatmapMetric';
const gLabel = (g) => `${g.stakes} ${g.gameType}`;
const hourLabel = (h) => h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;

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

export default function CashHeatmap({ token }) {
  const [catalog, setCatalog] = useState(null); // { vNames, byVenue }
  const [sel, setSel] = useState(() => { try { return JSON.parse(localStorage.getItem(SEL_KEY)) || null; } catch { return null; } });
  const [metric, setMetric] = useState(() => localStorage.getItem(METRIC_KEY) || 'tables'); // 'tables' | 'reliability'
  const [cells, setCells] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [err, setErr] = useState('');
  const [pick, setPick] = useState(null); // a tapped cell, for the readout

  // Catalog (venues + games) for the pickers.
  useEffect(() => {
    let live = true;
    (async () => {
      const headers = { Authorization: 'Bearer ' + token };
      try {
        const [gRes, vRes] = await Promise.all([
          fetch(`${API_URL}/cash/games`, { headers }),
          fetch(`${API_URL}/cash/venues`, { headers }).catch(() => null),
        ]);
        if (!gRes.ok) {
          setErr(gRes.status === 403 ? 'This account is not an admin.' : gRes.status === 503 ? 'Cash watcher is offline.' : 'Could not load the game catalog.');
          setStatus('error');
          return;
        }
        const g = await gRes.json();
        const vNames = {};
        if (vRes && vRes.ok) { try { const v = await vRes.json(); (v.venues || []).forEach(x => { vNames[x.slug] = x.name; }); } catch { /* names optional */ } }
        /* /cash/games is every (venue, game, stakes) the watcher has EVER recorded, but names
           come only from /cash/venues, its ACTIVE list — so rooms it sampled for a day or two and
           dropped (pa-9319, maryland-live, ...) surfaced as bare slugs. A venue is offered if it is
           on the active list OR has data from the last two days: the hosted copy's list arrives by
           push from the box and can lag it (mohegan-pa showed bare while the box had it active),
           and trusting the list alone hid a room that was being collected right then. A live room
           with no name gets its slug prettified. If the list didn't load, everything is offered. */
        const named = Object.keys(vNames).length > 0;
        const RECENT_MS = 2 * 24 * 3600 * 1000;
        const lastBySlug = {};
        (g.games || []).forEach(row => {
          const t = Date.parse(row.lastTs || '');
          if (Number.isFinite(t)) lastBySlug[row.venueSlug] = Math.max(lastBySlug[row.venueSlug] || 0, t);
        });
        const live = slug => Date.now() - (lastBySlug[slug] || 0) < RECENT_MS;
        const rows = (g.games || []).filter(row => !named || vNames[row.venueSlug] || live(row.venueSlug));
        rows.forEach(row => {
          if (!vNames[row.venueSlug]) vNames[row.venueSlug] = String(row.venueSlug).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        });
        const byVenue = {};
        rows.forEach(row => { (byVenue[row.venueSlug] = byVenue[row.venueSlug] || []).push(row); });
        for (const k of Object.keys(byVenue)) byVenue[k].sort((a, b) => (b.samples || 0) - (a.samples || 0));
        if (!live) return;
        setCatalog({ vNames, byVenue });
        setSel(prev => {
          if (prev && byVenue[prev.venue] && byVenue[prev.venue].some(x => x.gameType === prev.gameType && x.stakes === prev.stakes)) return prev;
          const best = rows.slice().sort((a, b) => (b.samples || 0) - (a.samples || 0))[0];
          return best ? { venue: best.venueSlug, gameType: best.gameType, stakes: best.stakes } : null;
        });
        setStatus('ready');
      } catch { if (live) { setErr('Could not reach the server.'); setStatus('error'); } }
    })();
    return () => { live = false; };
  }, [token]);

  // Heatmap for the current selection.
  useEffect(() => {
    if (!sel) return;
    let live = true;
    setCells(null);
    (async () => {
      const headers = { Authorization: 'Bearer ' + token };
      const tz = -new Date().getTimezoneOffset(); // minutes UTC->local, as the API wants
      const qs = new URLSearchParams({ venue: sel.venue, game: sel.gameType, stakes: sel.stakes, tz: String(tz) });
      try {
        const res = await fetch(`${API_URL}/cash/heatmap?${qs.toString()}`, { headers });
        const j = res.ok ? await res.json() : { cells: [] };
        if (live) setCells(j.cells || []);
      } catch { if (live) setCells([]); }
    })();
    return () => { live = false; };
  }, [sel, token]);

  const persistSel = useCallback((s) => { setSel(s); try { localStorage.setItem(SEL_KEY, JSON.stringify(s)); } catch { /* ignore */ } setPick(null); }, []);
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
  const wrap = { maxWidth: 'calc(var(--subrow) * 85)', margin: '0 auto', padding: 'var(--space-md, calc(var(--subrow) * 2))', width: '100%', flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' };
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
      {/* Pickers */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', marginBottom: 'var(--space-ml)' }}>
        <select value={sel.venue} style={{ ...selectStyle, flex: '1 1 calc(var(--subrow) * 20)' }}
          onChange={(e) => {
            const venue = e.target.value;
            const list = catalog.byVenue[venue] || [];
            const top = list[0];
            persistSel(top ? { venue, gameType: top.gameType, stakes: top.stakes } : { venue, gameType: sel.gameType, stakes: sel.stakes });
          }}>
          {venueSlugs.map(s => <option key={s} value={s}>{catalog.vNames[s] || s}</option>)}
        </select>
        <select value={`${sel.gameType}|${sel.stakes}`} style={{ ...selectStyle, flex: '1 1 calc(var(--subrow) * 17.5)' }}
          onChange={(e) => { const [gameType, stakes] = e.target.value.split('|'); persistSel({ venue: sel.venue, gameType, stakes }); }}>
          {gamesForVenue.map(g => <option key={gLabel(g)} value={`${g.gameType}|${g.stakes}`}>{gLabel(g)} · {g.samples}</option>)}
        </select>
      </div>

      {/* Metric toggle */}
      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'calc(var(--subrow) * 1.75)' }}>
        {[['tables', 'Avg tables'], ['reliability', 'Reliability']].map(([m, lbl]) => (
          <button key={m} onClick={() => persistMetric(m)}
            style={{
              fontFamily: UNIVERS, fontSize: 'calc(var(--gu) * 1.031)', textTransform: 'uppercase', letterSpacing: '0.04em',
              padding: 'var(--space-xs) var(--space-ml)', borderRadius: 999, cursor: 'pointer',
              border: 'var(--bw-hair) solid ' + (metric === m ? 'var(--text-muted,#999)' : 'var(--border,#333)'),
              background: metric === m ? 'var(--text-muted,#999)' : 'transparent',
              color: metric === m ? 'var(--bg,#111)' : 'var(--text-muted,#777)',
            }}>{lbl}</button>
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
                <div key={d} style={{ fontSize: 'calc(var(--gu) * 0.884)', color: 'var(--text-muted,#999)', textAlign: 'center', fontFamily: UNIVERS, textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{day}</div>
              ))}
            </div>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ display: 'grid', gridTemplateColumns: HEAT_COLS, gridAutoRows: HEAT_ROW_H, columnGap: HEAT_COL_GAP, rowGap: 0, flex: 'none' }}>
                <div style={{ fontSize: 'calc(var(--gu) * 0.884)', color: 'var(--text-muted,#999)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 'var(--gu)', fontFamily: UNIVERS, fontVariantNumeric: 'tabular-nums' }}>{hourLabel(h)}</div>
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
                        position: 'relative',
                        /* Exactly the 4g x 2r track: no border (the pick ring and the
                           separating hairline are inset shadows), so nothing adds size. */
                        boxSizing: 'border-box', width: '100%', height: '100%', minHeight: 0, border: 0, margin: 0,
                        boxShadow: active ? 'inset 0 0 0 calc(var(--bw-hair) * 2) var(--text,#fff)' : 'inset 0 0 0 var(--bw-hair) var(--bg,#111)',
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
                : 'Tap a cell for detail'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
