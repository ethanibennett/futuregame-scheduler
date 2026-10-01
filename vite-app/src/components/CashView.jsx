import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';
import { deriveVenueInfo } from '../utils/utils.js';
import { readLocalLocation } from '../utils/location-prefs.js';
import { useToast } from '../contexts/ToastContext.jsx';
import LocationDropdown from './LocationDropdown.jsx';
import Icon from './Icon.jsx';
import CashHeatmap from './CashHeatmap.jsx';

// ── Cash watcher: Live now ──
// Admin-only. Reads the cash-game traffic watcher through the scheduler's
// Bearer-gated proxy (/api/cash/* -> cashwatcher.futurega.me). This screen is
// "what's running right now" per venue, with each game's open duration derived
// from the watcher's history, and a persistent variant filter.

const BASKERVILLE = "'Baskerville', 'Baskerville Old Face', 'Libre Baskerville', 'Hoefler Text', Garamond, serif";
const UNIVERS = "var(--font-condensed, 'Univers Condensed', 'Univers', sans-serif)";
// Grid constants: control height 32 (4 baseline rows), chip 24 (3 rows), gaps
// on the 8px baseline. Every interactive box is sized to a whole number of rows
// rather than to font + literal padding, so heights land on the grid.
const CTRL_H = 'calc(var(--subrow) * 4)';
const CHIP_H = 'calc(var(--subrow) * 3)';
const SOURCE_LABEL = { bravo: 'Bravo', pokeratlas: 'PokerAtlas' };
const HIDDEN_KEY = 'cashHiddenVariants'; // persisted set of variant labels to hide

// How long a game has been open = the length of its current unbroken run. The
// watcher polls every ~10 min, so a gap longer than ~2 polls means the game
// actually stopped and later restarted; anything shorter is just a missed poll.
const GAP_MAX_MS = 25 * 60 * 1000;
const HISTORY_HOURS = 16;
const gameKey = (venueSlug, gameType, stakes) => `${venueSlug}|${gameType}|${stakes}`;

/* The game as the room lists it. The watcher's normalised gameType is for grouping, filters and
   history; shown to a person it can be wrong (Bravo's "BIG O/OE 8" read as PLO5, 2026-10-01),
   so the card shows the room's own label, minus the stakes it starts with ("10-20 …"), which
   have their own column. Falls back to gameType when there is no label. */
const STAKES_PREFIX = /^\s*\$?\d+(?:[.,]\d+)?(?:\s*[-\/]\s*\$?\d+(?:[.,]\d+)?){1,2}\s+/;
function listedGame(g) {
  const raw = String((g && g.gameRaw) || '').trim();
  const name = raw.replace(STAKES_PREFIX, '').trim();
  return name || (g && g.gameType) || '';
}

function ago(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// One open-time PER TABLE, derived from the count time-series: the watcher
// reports a table COUNT per game, not individual tables, so the Nth table's
// start is the last time the count rose to ≥N and stayed there through to now.
// Returns gameKey -> [start times], longest-open first (index 0 = top row).
function buildRunStarts(rows) {
  const byGame = new Map();
  for (const r of (rows || [])) {
    if (!(r.tablesRunning > 0) || r.isInterest) continue;
    const t = Date.parse(r.ts);
    if (Number.isNaN(t)) continue;
    const k = gameKey(r.venueSlug, r.gameType, r.stakes);
    let arr = byGame.get(k);
    if (!arr) { arr = []; byGame.set(k, arr); }
    arr.push({ t, c: r.tablesRunning });
  }
  const starts = new Map();
  for (const [k, snaps] of byGame) {
    snaps.sort((a, b) => a.t - b.t);
    // The current unbroken run: from the latest snapshot back while each gap
    // is a missed poll rather than a genuine close-and-reopen.
    let s = snaps.length - 1;
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i].t - snaps[i - 1].t <= GAP_MAX_MS) s = i - 1; else break;
    }
    const run = snaps.slice(s);
    const cnt = run[run.length - 1].c;
    // minSuffix[i] = the smallest count from snapshot i through the end, so a
    // level L was open continuously from the earliest i where that stays ≥ L.
    const minSuf = new Array(run.length);
    minSuf[run.length - 1] = run[run.length - 1].c;
    for (let i = run.length - 2; i >= 0; i--) minSuf[i] = Math.min(run[i].c, minSuf[i + 1]);
    const perTable = [];
    for (let L = 1; L <= cnt; L++) {
      let startT = run[run.length - 1].t;
      for (let i = 0; i < run.length; i++) { if (minSuf[i] >= L) { startT = run[i].t; break; } }
      perTable.push(startT);
    }
    perTable.sort((a, b) => a - b); // earliest start = longest open = top row
    starts.set(k, perTable);
  }
  return starts;
}

// "open 2h 10m", with a trailing + when the run reaches the history window edge.
function openLabel(startMs, endMs, windowStartMs) {
  if (startMs == null || endMs == null) return null;
  const mins = Math.floor((endMs - startMs) / 60000);
  const capped = startMs <= windowStartMs + GAP_MAX_MS;
  let s;
  if (mins < 10) return 'just opened';
  else if (mins < 60) s = `${mins}m`;
  else { const h = Math.floor(mins / 60), m = mins % 60; s = `${h}h${m ? ` ${m}m` : ''}`; }
  return 'open ' + s + (capped ? '+' : '');
}

// The persistent location the watcher polls around (SPEC §5). Sticky until
// changed, independent of the scheduler's own location filter. Reads/writes
// through the cash proxy → hosted watcher; the box picks it up within a cycle.
// Same auto-populating location picker as the MTT Schedule tab: the shared
// filter chip + LocationDropdown (pointOnly — no region/jurisdiction, since the
// cash location is a single poll point the watcher steers around). It seeds from
// the user's saved scheduler location so it is never empty, then the watcher's
// own /cash/location (if set) overrides that, and picking a point POSTs it back.
function CashLocationPicker({ token }) {
  const toast = useToast();
  const [filters, setFiltersState] = useState(() => {
    const saved = readLocalLocation() || {};
    return {
      userLocation: saved.userLocation || null,
      maxDistance: saved.maxDistance || '100',
      locationRegion: null,
      locationLabel: saved.locationLabel || null,
      jurisdiction: saved.jurisdiction || null,
      jurisdictionManual: !!saved.jurisdictionManual,
    };
  });
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);

  // The watcher's own cash location wins over the scheduler default when set.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/cash/location`, { headers: { Authorization: 'Bearer ' + token } });
        if (r.ok) {
          const loc = await r.json();
          if (loc && loc.lat != null) {
            setFiltersState(f => ({ ...f, userLocation: { lat: loc.lat, lng: loc.lon }, maxDistance: String(loc.radiusMiles || 100), locationLabel: loc.label || 'Location' }));
          }
        }
      } catch { /* keep the scheduler default */ }
    })();
  }, [token]);

  // A point selection steers the watcher; region/jurisdiction are hidden here so
  // there is always a point to save.
  const saveToCash = useCallback((f) => {
    if (!f.userLocation) return;
    const body = { lat: f.userLocation.lat, lon: f.userLocation.lng, radiusMiles: Math.max(5, Math.min(1000, Number(f.maxDistance) || 100)), label: f.locationLabel || 'Location' };
    fetch(`${API_URL}/cash/location`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  }, [token]);

  const setFilters = useCallback((updater) => {
    setFiltersState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveToCash(next);
      return next;
    });
  }, [saveToCash]);

  const label = filters.userLocation && filters.maxDistance
    ? `${filters.locationLabel || 'Location'} · ${filters.maxDistance} mi`
    : 'Set location';

  return (
    /* Where the Schedule tab's location field is, and the same field: 2r under the header,
       26g wide (three columns, 1g..27g) and 4r tall, lit when a point is set. Shown on Live
       and Heatmaps alike, above the mode strip. */
    <div style={{ marginTop: 'calc(var(--subrow) * 2)', marginBottom: 'var(--subrow)' }}>
      <button ref={btnRef} type="button" className={'filter-chip' + (filters.userLocation ? ' active' : '')} onClick={() => setOpen(o => !o)}
        style={{ width: 'calc(var(--col) * 3 + var(--gu) * 2)', minWidth: 0, height: 'calc(var(--subrow) * 4)', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 'calc(var(--subrow) * 1)', padding: '0 calc(var(--subrow) * 1.25)' }}>
        <Icon.mapPin />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'calc(var(--gu) * 1.149)', fontFamily: 'var(--font-condensed)', lineHeight: 'calc(var(--subrow) * 2)' }}>{label}</span>
      </button>
      {open && createPortal(<div className="dropdown-backdrop" onClick={() => setOpen(false)} />, document.body)}
      {open && btnRef.current && createPortal(
        <LocationDropdown rect={btnRef.current.getBoundingClientRect()} filters={filters} setFilters={setFilters} onClose={() => setOpen(false)} toast={toast} token={token} pointOnly />,
        document.body
      )}
    </div>
  );
}

export default function CashView({ token, onModeChange }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [errMsg, setErrMsg] = useState('');
  const [fetchedAt, setFetchedAt] = useState(null);
  const [runStarts, setRunStarts] = useState(new Map());
  const [windowStartMs, setWindowStartMs] = useState(0);
  // Persistent variant filter — the SET OF HIDDEN variants, so a variant we've
  // never seen defaults to visible. Survives until the user toggles it.
  const [hidden, setHidden] = useState(() => {
    try { const s = localStorage.getItem(HIDDEN_KEY); return new Set(s ? JSON.parse(s) : []); } catch { return new Set(); }
  });
  const [mode, setMode] = useState(() => localStorage.getItem('cashMode') || 'live'); // 'live' | 'heatmap'
  const setModePersist = useCallback((m) => {
    setMode(m);
    try { localStorage.setItem('cashMode', m); } catch { /* ignore */ }
    if (onModeChange) onModeChange(m); // the top bar's subtitle names the mode
  }, [onModeChange]);

  const toggleVariant = useCallback((variant) => {
    setHidden(prev => {
      const n = new Set(prev);
      if (n.has(variant)) n.delete(variant); else n.add(variant);
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...n])); } catch { /* ignore */ }
      return n;
    });
  }, []);

  const load = useCallback(async () => {
    const headers = { Authorization: 'Bearer ' + token };
    const fromMs = Date.now() - HISTORY_HOURS * 3600 * 1000;
    const fromIso = new Date(fromMs).toISOString();
    try {
      const [curRes, histRes] = await Promise.all([
        fetch(`${API_URL}/cash/current`, { headers }),
        fetch(`${API_URL}/cash/history?from=${encodeURIComponent(fromIso)}&limit=10000`, { headers }).catch(() => null),
      ]);
      if (!curRes.ok) {
        let msg = 'HTTP ' + curRes.status;
        if (curRes.status === 403) msg = 'This account is not an admin.';
        else if (curRes.status === 503) msg = 'Cash watcher is offline.';
        else if (curRes.status === 502) msg = 'Cash watcher rejected the session.';
        else { try { const j = await curRes.json(); if (j && j.error) msg = j.error; } catch { /* keep */ } }
        setErrMsg(msg);
        setStatus('error');
        return;
      }
      const json = await curRes.json();
      setData(json);
      setFetchedAt(Date.now());
      setStatus('ok');
      if (histRes && histRes.ok) {
        try {
          const h = await histRes.json();
          setRunStarts(buildRunStarts(h && h.rows));
          setWindowStartMs(fromMs);
        } catch { /* leave durations as-is */ }
      }
    } catch (e) {
      setErrMsg('Could not reach the server.');
      setStatus('error');
    }
  }, [token]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const snapMs = (data && Date.parse(data.ts)) || Date.now();
  const rawVenues = (data && Array.isArray(data.venues) ? data.venues : []);

  // The variant chips are every variant currently seen anywhere, so the filter
  // offers exactly what's on the table.
  const availableVariants = [...new Set(
    rawVenues.flatMap(v => (v.games || []).map(g => g.gameType)).filter(Boolean)
  )].sort();

  const sortGames = (games) => [...(games || [])].sort((a, b) =>
    (b.tablesRunning || 0) - (a.tablesRunning || 0) ||
    (b.waitlistLen || 0) - (a.waitlistLen || 0) ||
    String(a.stakes).localeCompare(String(b.stakes)));

  const filterActive = hidden.size > 0;
  const venues = rawVenues.map(v => {
    const games = sortGames(v.games).filter(g => !hidden.has(g.gameType));
    const running = games.filter(g => (g.tablesRunning || 0) > 0);
    const interest = games.filter(g => !(g.tablesRunning > 0) && (g.isInterest || (g.waitlistLen || 0) > 0));
    const totalTables = running.reduce((s, g) => s + (g.tablesRunning || 0), 0);
    return { ...v, _running: running, _interest: interest, _totalTables: totalTables };
  })
    // With a filter on, drop venues that no longer have anything to show. With
    // no filter, keep them all (an idle-but-watched room is informative).
    .filter(v => v.ok === false || !filterActive || v._running.length || v._interest.length)
    .sort((a, b) => (b._totalTables - a._totalTables) || String(a.name).localeCompare(String(b.name)));

  return (
    <div className="cash-view" style={{ maxWidth: 'calc(var(--subrow) * 85)', margin: '0 auto', padding: 0, display: 'flex', flexDirection: 'column', height: mode === 'heatmap' ? '100%' : undefined }}>
      {/* The cash location, in the Schedule tab's location-field spot, on both views. */}
      <CashLocationPicker token={token} />

      {/* Live / Heatmaps: the same segmented strip as the hand entry's MTT / Cash, 1r under the
          location field on BOTH views (7r under the header), so it never moves when you switch.
          Live's Refresh row sits below it. */}
      <div className="live-update-tabs cash-mode-tabs" style={{ marginTop: 0, marginBottom: 'var(--space-xl)' }}>
        {[['live', 'Live'], ['heatmap', 'Heatmaps']].map(([m, lbl]) => (
          <button key={m} type="button" className={mode === m ? 'active' : ''} aria-pressed={mode === m}
            onClick={() => setModePersist(m)}>{lbl}</button>
        ))}
      </div>

      {mode === 'heatmap' && (
        <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <CashHeatmap token={token} />
        </div>
      )}

      {mode === 'live' && (<>

      {/* Refresh, right-aligned under the mode strip (Live only). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-lg)', minHeight: 'calc(var(--subrow) * 4)', marginBottom: 'var(--space-xl)' }}>
        <button onClick={load}
          style={{ height: CTRL_H, boxSizing: 'border-box', border: 'var(--bw-hair) solid var(--border, #333)', background: 'transparent', color: 'var(--text-muted, #aaa)', borderRadius: 'var(--radius-sm)', padding: '0 var(--space-lg)', cursor: 'pointer', fontSize: 'calc(var(--gu) * 1.060)', whiteSpace: 'nowrap' }}>
          {status === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>


      {/* Persistent variant filter */}
      {availableVariants.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
          {availableVariants.map(vt => {
            const on = !hidden.has(vt);
            return (
              <button key={vt} onClick={() => toggleVariant(vt)}
                style={{
                  fontFamily: UNIVERS, fontSize: 'calc(var(--gu) * 1.031)', textTransform: 'uppercase', letterSpacing: '0.04em',
                  height: CHIP_H, boxSizing: 'border-box', padding: '0 var(--space-ml)', borderRadius: 999, cursor: 'pointer',
                  border: 'var(--bw-hair) solid ' + (on ? 'var(--text-muted, #999)' : 'var(--border, #333)'),
                  background: on ? 'var(--text-muted, #999)' : 'transparent',
                  color: on ? 'var(--bg, #111)' : 'var(--text-muted, #777)',
                }}>
                {vt}
              </button>
            );
          })}
        </div>
      )}

      {status === 'error' && (
        <div style={{ boxShadow: 'inset 0 0 0 calc(var(--subrow) * 0.125) var(--border, #333)', borderRadius: 'calc(var(--subrow) * 1.25)', padding: 'var(--space-xl)', lineHeight: 'calc(var(--subrow) * 3)', color: 'var(--text-muted, #aaa)' }}>
          {errMsg || 'Something went wrong.'}
          <div style={{ marginTop: 'var(--space-md)', display: 'flex' }}>
            <button onClick={load} style={{ height: CTRL_H, boxSizing: 'border-box', border: 'var(--bw-hair) solid var(--border,#333)', background: 'transparent', color: 'var(--text,#fff)', borderRadius: 'var(--radius-sm)', padding: '0 var(--space-lg)', cursor: 'pointer', fontSize: 'calc(var(--gu) * 1.149)' }}>Try again</button>
          </div>
        </div>
      )}

      {status === 'loading' && !data && (
        <div style={{ color: 'var(--text-muted, #aaa)', padding: 'var(--space-2xl)', textAlign: 'center' }}>Loading live traffic…</div>
      )}

      {status !== 'error' && data && (
        <>
          <div style={{ color: 'var(--text-muted, #999)', fontSize: 'calc(var(--gu) * 1.031)', marginBottom: 'var(--space-lg)' }}>
            Snapshot {ago(data.ts) || '—'}{fetchedAt ? ` · refreshed ${ago(new Date(fetchedAt).toISOString())}` : ''}
          </div>

          {venues.length === 0 && (
            <div style={{ color: 'var(--text-muted, #aaa)', padding: 'var(--space-2xl)', textAlign: 'center' }}>
              {filterActive ? 'Nothing running in the selected variants.' : 'No venues reporting.'}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            {venues.map(v => {
              const color = deriveVenueInfo(v.name).color;
              const running = v._running, interest = v._interest;
              return (
                <section key={v.slug} style={{ border: 'var(--bw-hair) solid var(--border, #2a2a2a)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface, rgba(255,255,255,0.02))' }}>
                  {/* Venue strip — same treatment as the Up Next banner: a
                      brand-coloured bar, full venue name in Univers, uppercase. */}
                  <div style={{ background: color, color: '#fff', textAlign: 'center', padding: 'var(--space-sm) calc(var(--subrow) * 1.75)', fontFamily: UNIVERS, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, fontSize: 'calc(var(--gu) * 1.208)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)', padding: 'var(--space-sm) calc(var(--subrow) * 1.75)', borderBottom: 'var(--bw-hair) solid var(--border, #2a2a2a)' }}>
                    <span style={{ fontSize: 'calc(var(--gu) * 0.884)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted, #888)', border: 'var(--bw-hair) solid var(--border,#333)', borderRadius: 'calc(var(--subrow) * 0.625)', padding: 'calc(var(--subrow) * 0.125) var(--space-sm)' }}>
                      {SOURCE_LABEL[v.source] || v.source}
                    </span>
                    <span style={{ fontSize: 'calc(var(--gu) * 0.972)', color: 'var(--text-muted, #888)', whiteSpace: 'nowrap' }}>
                      {v.ok === false ? 'poll failed' : v.ok === null ? 'no data yet' : (ago(v.lastPollTs) || '')}
                    </span>
                  </div>

                  {v.ok === false ? (
                    <div style={{ padding: 'var(--space-ml) calc(var(--subrow) * 1.75)', color: 'var(--text-muted,#888)', fontSize: 'calc(var(--gu) * 1.149)' }}>Couldn’t read this room’s feed{v.error ? ` (${v.error})` : ''}.</div>
                  ) : running.length === 0 && interest.length === 0 ? (
                    <div style={{ padding: 'var(--space-ml) calc(var(--subrow) * 1.75)', color: 'var(--text-muted,#888)', fontSize: 'calc(var(--gu) * 1.149)' }}>Nothing running.</div>
                  ) : (
                    <div>
                      {running.map((g, gi) => {
                        // One row PER TABLE, each with its own open duration; the
                        // stakes and variant name only on the top row of the group.
                        const starts = runStarts.get(gameKey(v.slug, g.gameType, g.stakes)) || [];
                        const n = Math.max(g.tablesRunning || 0, starts.length) || 1;
                        return Array.from({ length: n }, (_, ti) => {
                          const isTop = ti === 0;
                          const open = openLabel(starts[ti], snapMs, windowStartMs);
                          return (
                            <div key={gi + '-' + ti} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-ml)', padding: isTop ? 'var(--space-md) calc(var(--subrow) * 1.75)' : 'calc(var(--subrow) * 0.375) calc(var(--subrow) * 1.75)', borderTop: (gi === 0 && isTop) ? 'none' : (isTop ? 'var(--bw-hair) solid var(--border, rgba(255,255,255,0.08))' : 'none') }}>
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text, #fff)', minWidth: 'calc(var(--subrow) * 7.75)' }}>{isTop ? g.stakes : ''}</span>
                              <span style={{ fontSize: 'calc(var(--gu) * 1.060)', color: 'var(--text-muted, #aaa)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isTop ? listedGame(g) : ''}</span>
                              <span style={{ fontSize: 'calc(var(--gu) * 1.001)', color: 'var(--text-muted, #888)', whiteSpace: 'nowrap', minWidth: 'calc(var(--subrow) * 12)', textAlign: 'right' }}>{open || ''}</span>
                              <span style={{ minWidth: 'calc(var(--subrow) * 6.75)', textAlign: 'right' }}>
                                {isTop && (g.waitlistLen || 0) > 0 && (
                                  <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'calc(var(--gu) * 1.060)', color: 'var(--warning, #e0a458)', border: 'var(--bw-hair) solid var(--warning, #e0a458)', borderRadius: 'calc(var(--subrow) * 0.625)', padding: 'calc(var(--subrow) * 0.125) var(--space-sm)', whiteSpace: 'nowrap' }}>
                                    WL {g.waitlistLen}
                                  </span>
                                )}
                              </span>
                            </div>
                          );
                        });
                      })}
                      {interest.length > 0 && (
                        <div style={{ padding: 'var(--space-md) calc(var(--subrow) * 1.75)', borderTop: 'var(--bw-hair) solid var(--border, rgba(255,255,255,0.05))', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                          <span style={{ fontSize: 'calc(var(--gu) * 0.913)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted,#777)', alignSelf: 'center' }}>Interest</span>
                          {interest.map((g, i) => (
                            <span key={'i' + i} style={{ fontSize: 'calc(var(--gu) * 1.031)', color: 'var(--text-muted,#999)', border: 'var(--bw-hair) dashed var(--border,#333)', borderRadius: 'calc(var(--subrow) * 0.625)', padding: 'calc(var(--subrow) * 0.125) var(--space-sm)' }}>
                              {g.stakes} {listedGame(g)}{(g.waitlistLen || 0) > 0 ? ` · WL ${g.waitlistLen}` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      </>)}
    </div>
  );
}
