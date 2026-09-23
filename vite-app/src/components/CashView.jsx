import React, { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../utils/api.js';
import { deriveVenueInfo } from '../utils/utils.js';
import CashHeatmap from './CashHeatmap.jsx';

// ── Cash watcher: Live now ──
// Admin-only. Reads the cash-game traffic watcher through the scheduler's
// Bearer-gated proxy (/api/cash/* -> cashwatcher.futurega.me). This screen is
// "what's running right now" per venue, with each game's open duration derived
// from the watcher's history, and a persistent variant filter.

const BASKERVILLE = "'Baskerville', 'Baskerville Old Face', 'Libre Baskerville', 'Hoefler Text', Garamond, serif";
const UNIVERS = "var(--font-condensed, 'Univers Condensed', 'Univers', sans-serif)";
const SOURCE_LABEL = { bravo: 'Bravo', pokeratlas: 'PokerAtlas' };
const HIDDEN_KEY = 'cashHiddenVariants'; // persisted set of variant labels to hide

// How long a game has been open = the length of its current unbroken run. The
// watcher polls every ~10 min, so a gap longer than ~2 polls means the game
// actually stopped and later restarted; anything shorter is just a missed poll.
const GAP_MAX_MS = 25 * 60 * 1000;
const HISTORY_HOURS = 16;
const gameKey = (venueSlug, gameType, stakes) => `${venueSlug}|${gameType}|${stakes}`;

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
function CashLocationPicker({ token }) {
  const [loc, setLoc] = useState(null);
  const [editing, setEditing] = useState(false);
  const [city, setCity] = useState('');
  const [radius, setRadius] = useState('100');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const loadLoc = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/cash/location`, { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) setLoc(await r.json());
    } catch { /* leave unknown */ }
  }, [token]);
  useEffect(() => { loadLoc(); }, [loadLoc]);

  const startEdit = () => {
    setCity(loc && loc.label && loc.label !== 'Home' ? loc.label : '');
    setRadius(String((loc && loc.radiusMiles) || 100));
    setMsg('');
    setEditing(true);
  };

  const save = async () => {
    const q = city.trim();
    if (!q) { setMsg('Enter a city or address.'); return; }
    const miles = Math.max(5, Math.min(1000, Number(radius) || 100));
    setBusy(true); setMsg('');
    try {
      const g = await fetch(`${API_URL}/geocode?q=${encodeURIComponent(q)}`, { headers: { Authorization: 'Bearer ' + token } });
      const results = g.ok ? await g.json() : [];
      if (!results.length) { setMsg('Couldn’t find that place.'); setBusy(false); return; }
      const top = results[0];
      const body = { lat: top.lat, lon: top.lng, radiusMiles: miles, label: top.short || q };
      const p = await fetch(`${API_URL}/cash/location`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!p.ok) { setMsg('Save failed.'); setBusy(false); return; }
      setLoc(await p.json());
      setEditing(false);
    } catch { setMsg('Save failed.'); }
    setBusy(false);
  };

  const inputStyle = { background: 'var(--surface, rgba(255,255,255,0.04))', color: 'var(--text, #fff)', border: '1px solid var(--border, #333)', borderRadius: 8, padding: '5px 9px', fontSize: '0.78rem' };
  const btnStyle = (primary) => ({ border: '1px solid ' + (primary ? 'var(--text, #fff)' : 'var(--border, #333)'), background: primary ? 'var(--text, #fff)' : 'transparent', color: primary ? 'var(--bg, #111)' : 'var(--text-muted, #aaa)', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontSize: '0.72rem', whiteSpace: 'nowrap' });

  return (
    <div style={{ marginBottom: 12 }}>
      {!editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: UNIVERS, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted, #999)' }}>
            {'📍 '}{loc ? `${loc.label} · ${loc.radiusMiles} mi` : 'Location…'}
          </span>
          <button onClick={startEdit} style={btnStyle(false)}>Change</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <input value={city} onChange={e => setCity(e.target.value)} placeholder="City or address"
            onKeyDown={e => { if (e.key === 'Enter') save(); }} style={{ ...inputStyle, flex: '1 1 160px', minWidth: 120 }} autoFocus />
          <input value={radius} onChange={e => setRadius(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric" style={{ ...inputStyle, width: 56, textAlign: 'right' }} title="Radius in miles" />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #888)' }}>mi</span>
          <button onClick={save} disabled={busy} style={btnStyle(true)}>{busy ? 'Saving…' : 'Set'}</button>
          <button onClick={() => setEditing(false)} disabled={busy} style={btnStyle(false)}>Cancel</button>
        </div>
      )}
      {msg && <div style={{ fontSize: '0.7rem', color: 'var(--warning, #e0a458)', marginTop: 4 }}>{msg}</div>}
      {editing && !msg && (
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted, #777)', marginTop: 4 }}>
          The collector picks up a new location within a few minutes.
        </div>
      )}
    </div>
  );
}

export default function CashView({ token }) {
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
  const setModePersist = useCallback((m) => { setMode(m); try { localStorage.setItem('cashMode', m); } catch { /* ignore */ } }, []);

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
    <div className="cash-view" style={{ maxWidth: 680, margin: '0 auto', padding: 'var(--space-md, 16px)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontFamily: BASKERVILLE, fontSize: '1.6rem', fontWeight: 600, color: 'var(--text, #fff)' }}>
          {mode === 'heatmap' ? 'Cash Heatmaps' : 'Live Cash Games'}
        </h2>
        {mode === 'live' && (
          <button onClick={load}
            style={{ border: '1px solid var(--border, #333)', background: 'transparent', color: 'var(--text-muted, #aaa)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
            {status === 'loading' ? 'Loading…' : 'Refresh'}
          </button>
        )}
      </div>

      {/* Live / Heatmaps mode */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[['live', 'Live'], ['heatmap', 'Heatmaps']].map(([m, lbl]) => (
          <button key={m} onClick={() => setModePersist(m)}
            style={{
              fontFamily: UNIVERS, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em',
              padding: '5px 14px', borderRadius: 999, cursor: 'pointer',
              border: '1px solid ' + (mode === m ? 'var(--text, #fff)' : 'var(--border, #333)'),
              background: mode === m ? 'var(--text, #fff)' : 'transparent',
              color: mode === m ? 'var(--bg, #111)' : 'var(--text-muted, #888)',
            }}>{lbl}</button>
        ))}
      </div>

      {mode === 'heatmap' && <CashHeatmap token={token} />}

      {mode === 'live' && (<>

      {/* Persistent location picker — what the watcher polls around (SPEC §5) */}
      <CashLocationPicker token={token} />

      {/* Persistent variant filter */}
      {availableVariants.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {availableVariants.map(vt => {
            const on = !hidden.has(vt);
            return (
              <button key={vt} onClick={() => toggleVariant(vt)}
                style={{
                  fontFamily: UNIVERS, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em',
                  padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                  border: '1px solid ' + (on ? 'var(--text-muted, #999)' : 'var(--border, #333)'),
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
        <div style={{ border: '1px solid var(--border, #333)', borderRadius: 10, padding: 16, color: 'var(--text-muted, #aaa)' }}>
          {errMsg || 'Something went wrong.'}
          <div style={{ marginTop: 10 }}>
            <button onClick={load} style={{ border: '1px solid var(--border,#333)', background: 'transparent', color: 'var(--text,#fff)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: '0.78rem' }}>Try again</button>
          </div>
        </div>
      )}

      {status === 'loading' && !data && (
        <div style={{ color: 'var(--text-muted, #aaa)', padding: 20, textAlign: 'center' }}>Loading live traffic…</div>
      )}

      {status !== 'error' && data && (
        <>
          <div style={{ color: 'var(--text-muted, #999)', fontSize: '0.7rem', marginBottom: 12 }}>
            Snapshot {ago(data.ts) || '—'}{fetchedAt ? ` · refreshed ${ago(new Date(fetchedAt).toISOString())}` : ''}
          </div>

          {venues.length === 0 && (
            <div style={{ color: 'var(--text-muted, #aaa)', padding: 20, textAlign: 'center' }}>
              {filterActive ? 'Nothing running in the selected variants.' : 'No venues reporting.'}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {venues.map(v => {
              const color = deriveVenueInfo(v.name).color;
              const running = v._running, interest = v._interest;
              return (
                <section key={v.slug} style={{ border: '1px solid var(--border, #2a2a2a)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface, rgba(255,255,255,0.02))' }}>
                  {/* Venue strip — same treatment as the Up Next banner: a
                      brand-coloured bar, full venue name in Univers, uppercase. */}
                  <div style={{ background: color, color: '#fff', textAlign: 'center', padding: '6px 14px', fontFamily: UNIVERS, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 14px', borderBottom: '1px solid var(--border, #2a2a2a)' }}>
                    <span style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted, #888)', border: '1px solid var(--border,#333)', borderRadius: 5, padding: '1px 6px' }}>
                      {SOURCE_LABEL[v.source] || v.source}
                    </span>
                    <span style={{ fontSize: '0.66rem', color: 'var(--text-muted, #888)', whiteSpace: 'nowrap' }}>
                      {v.ok === false ? 'poll failed' : v.ok === null ? 'no data yet' : (ago(v.lastPollTs) || '')}
                    </span>
                  </div>

                  {v.ok === false ? (
                    <div style={{ padding: '10px 14px', color: 'var(--text-muted,#888)', fontSize: '0.78rem' }}>Couldn’t read this room’s feed{v.error ? ` (${v.error})` : ''}.</div>
                  ) : running.length === 0 && interest.length === 0 ? (
                    <div style={{ padding: '10px 14px', color: 'var(--text-muted,#888)', fontSize: '0.78rem' }}>Nothing running.</div>
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
                            <div key={gi + '-' + ti} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isTop ? '8px 14px' : '3px 14px', borderTop: (gi === 0 && isTop) ? 'none' : (isTop ? '1px solid var(--border, rgba(255,255,255,0.08))' : 'none') }}>
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text, #fff)', minWidth: 62 }}>{isTop ? g.stakes : ''}</span>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #aaa)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isTop ? g.gameType : ''}</span>
                              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted, #888)', whiteSpace: 'nowrap', minWidth: 96, textAlign: 'right' }}>{open || ''}</span>
                              <span style={{ minWidth: 54, textAlign: 'right' }}>
                                {isTop && (g.waitlistLen || 0) > 0 && (
                                  <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.72rem', color: 'var(--warning, #e0a458)', border: '1px solid var(--warning, #e0a458)', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>
                                    WL {g.waitlistLen}
                                  </span>
                                )}
                              </span>
                            </div>
                          );
                        });
                      })}
                      {interest.length > 0 && (
                        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border, rgba(255,255,255,0.05))', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <span style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted,#777)', alignSelf: 'center' }}>Interest</span>
                          {interest.map((g, i) => (
                            <span key={'i' + i} style={{ fontSize: '0.7rem', color: 'var(--text-muted,#999)', border: '1px dashed var(--border,#333)', borderRadius: 5, padding: '1px 6px' }}>
                              {g.stakes} {g.gameType}{(g.waitlistLen || 0) > 0 ? ` · WL ${g.waitlistLen}` : ''}
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
