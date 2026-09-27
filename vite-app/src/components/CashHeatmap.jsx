import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { API_URL } from '../utils/api.js';

// ── Cash watcher: Heatmaps ──
// Day-of-week × hour traffic for one game at one venue, from /api/heatmap. Pick
// a venue + game/stake; the grid shows when it runs and how busy. Needs ~2 weeks
// of collected history to be meaningful.

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
        const byVenue = {};
        (g.games || []).forEach(row => { (byVenue[row.venueSlug] = byVenue[row.venueSlug] || []).push(row); });
        for (const k of Object.keys(byVenue)) byVenue[k].sort((a, b) => (b.samples || 0) - (a.samples || 0));
        if (!live) return;
        setCatalog({ vNames, byVenue });
        setSel(prev => {
          if (prev && byVenue[prev.venue] && byVenue[prev.venue].some(x => x.gameType === prev.gameType && x.stakes === prev.stakes)) return prev;
          const best = (g.games || []).slice().sort((a, b) => (b.samples || 0) - (a.samples || 0))[0];
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

  const cellMap = useMemo(() => {
    const m = new Map();
    for (const c of (cells || [])) m.set(`${c.dow}-${c.hour}`, c);
    return m;
  }, [cells]);
  const maxMean = useMemo(() => Math.max(0.0001, ...(cells || []).map(c => c.meanTables || 0)), [cells]);

  const venueSlugs = catalog ? Object.keys(catalog.byVenue).sort((a, b) =>
    String(catalog.vNames[a] || a).localeCompare(String(catalog.vNames[b] || b))) : [];
  const gamesForVenue = (catalog && sel && catalog.byVenue[sel.venue]) || [];

  const wrap = { maxWidth: 'calc(var(--subrow) * 85)', margin: '0 auto', padding: 'var(--space-md, calc(var(--subrow) * 2))' };
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
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 'calc(var(--subrow) * 70)' }}>
              {/* Hour axis */}
              <div style={{ display: 'grid', gridTemplateColumns: 'calc(var(--subrow) * 3.75) repeat(24, minmax(0, 1fr))', gap: 'var(--space-2xs)', marginBottom: 'calc(var(--subrow) * 0.375)' }}>
                <div />
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} style={{ fontSize: 'calc(var(--gu) * 0.736)', color: 'var(--text-muted,#888)', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                    {h % 6 === 0 ? hourLabel(h) : ''}
                  </div>
                ))}
              </div>
              {DOW.map((day, d) => (
                <div key={d} style={{ display: 'grid', gridTemplateColumns: 'calc(var(--subrow) * 3.75) repeat(24, minmax(0, 1fr))', gap: 'var(--space-2xs)', marginBottom: 'var(--space-2xs)' }}>
                  <div style={{ fontSize: 'calc(var(--gu) * 0.884)', color: 'var(--text-muted,#999)', display: 'flex', alignItems: 'center', fontFamily: UNIVERS, textTransform: 'uppercase' }}>{day}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const c = cellMap.get(`${d}-${h}`);
                    const hasData = !!(c && c.samples > 0);
                    const intensity = !hasData ? 0 : metric === 'reliability' ? (c.ranFraction || 0) : (c.meanTables || 0) / maxMean;
                    const active = pick && pick.dow === d && pick.hour === h;
                    const val = !hasData ? '' : metric === 'reliability' ? String(Math.round((c.ranFraction || 0) * 100)) : fmtTables(c.meanTables);
                    return (
                      <button key={h}
                        className={'cash-heat-cell' + (hasData ? '' : ' no-data')}
                        onClick={() => setPick(hasData ? { dow: d, hour: h, ...c } : null)}
                        onMouseEnter={() => { if (hasData) setPick({ dow: d, hour: h, ...c }); }}
                        title={hasData ? `${day} ${hourLabel(h)} · ${(c.meanTables || 0).toFixed(1)} tables avg · ran ${Math.round((c.ranFraction || 0) * 100)}% · ${c.samples} polls` : `${day} ${hourLabel(h)} · no data`}
                        style={{
                          position: 'relative',
                          aspectRatio: '1 / 1', minHeight: 'calc(var(--subrow) * 2.5)', border: active ? 'var(--bw-hair) solid var(--text,#fff)' : 'var(--bw-hair) solid transparent',
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
