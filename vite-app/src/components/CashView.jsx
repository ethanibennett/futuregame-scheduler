import React, { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../utils/api.js';

// ── Cash watcher: Live now ──
// Admin-only. Reads the cash-game traffic watcher through the scheduler's
// Bearer-gated proxy (/api/cash/* -> cashwatcher.futurega.me). This first
// screen is "what's running right now" across the collected venues; heatmaps
// and history come later off the same proxy.

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

const SOURCE_LABEL = { bravo: 'Bravo', pokeratlas: 'PokerAtlas' };

// How long a game has been open = the length of its current unbroken run. The
// watcher polls every ~10 min, so a gap longer than ~2 polls means the game
// actually stopped and later restarted; anything shorter is just a missed poll.
const GAP_MAX_MS = 25 * 60 * 1000;
const HISTORY_HOURS = 16; // how far back to look for a run's start
const gameKey = (venueSlug, gameType, stakes) => `${venueSlug}|${gameType}|${stakes}`;

// Build, per running game, the timestamp its current run began, by walking its
// running snapshots backward from newest while the gaps stay within GAP_MAX_MS.
function buildRunStarts(rows) {
  const byGame = new Map();
  for (const r of (rows || [])) {
    if (!(r.tablesRunning > 0) || r.isInterest) continue;
    const t = Date.parse(r.ts);
    if (Number.isNaN(t)) continue;
    const k = gameKey(r.venueSlug, r.gameType, r.stakes);
    let arr = byGame.get(k);
    if (!arr) { arr = []; byGame.set(k, arr); }
    arr.push(t);
  }
  const starts = new Map();
  for (const [k, ts] of byGame) {
    ts.sort((a, b) => a - b);
    let start = ts[ts.length - 1];
    for (let i = ts.length - 1; i > 0; i--) {
      if (ts[i] - ts[i - 1] <= GAP_MAX_MS) start = ts[i - 1];
      else break;
    }
    starts.set(k, start);
  }
  return starts;
}

// "2h 10m" style, with a trailing + when the run reaches the history window edge
// (so the true open time may be longer than we looked back).
function openLabel(startMs, endMs, windowStartMs) {
  if (startMs == null || endMs == null) return null;
  const mins = Math.floor((endMs - startMs) / 60000);
  const capped = startMs <= windowStartMs + GAP_MAX_MS;
  let s;
  if (mins < 10) s = 'just opened';
  else if (mins < 60) s = `${mins}m`;
  else { const h = Math.floor(mins / 60), m = mins % 60; s = `${h}h${m ? ` ${m}m` : ''}`; }
  return (mins >= 10 && capped) ? s + '+' : s;
}

export default function CashView({ token }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [errMsg, setErrMsg] = useState('');
  const [fetchedAt, setFetchedAt] = useState(null);
  const [runStarts, setRunStarts] = useState(new Map());
  const [windowStartMs, setWindowStartMs] = useState(0);

  const load = useCallback(async () => {
    const headers = { Authorization: 'Bearer ' + token };
    const fromMs = Date.now() - HISTORY_HOURS * 3600 * 1000;
    const fromIso = new Date(fromMs).toISOString();
    try {
      // History drives the "open since" durations; it's best-effort — a failure
      // there just hides the durations, it doesn't fail the whole view.
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
    // The collector polls every ~10 min; refresh a bit inside that.
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const snapMs = (data && Date.parse(data.ts)) || Date.now();
  const venues = (data && Array.isArray(data.venues) ? data.venues : [])
    .map(v => ({ ...v, totalTables: (v.games || []).reduce((s, g) => s + (g.tablesRunning || 0), 0) }))
    .sort((a, b) => (b.totalTables - a.totalTables) || String(a.name).localeCompare(String(b.name)));

  const sortGames = (games) => [...(games || [])].sort((a, b) =>
    (b.tablesRunning || 0) - (a.tablesRunning || 0) ||
    (b.waitlistLen || 0) - (a.waitlistLen || 0) ||
    String(a.stakes).localeCompare(String(b.stakes)));

  return (
    <div className="cash-view" style={{ maxWidth: 680, margin: '0 auto', padding: 'var(--space-md, 16px)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-condensed, inherit)", textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '1.15rem', color: 'var(--text, #fff)' }}>
          Live cash games
        </h2>
        <button onClick={load}
          style={{ border: '1px solid var(--border, #333)', background: 'transparent', color: 'var(--text-muted, #aaa)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
          {status === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

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
            <div style={{ color: 'var(--text-muted, #aaa)', padding: 20, textAlign: 'center' }}>No venues reporting.</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {venues.map(v => {
              const games = sortGames(v.games);
              const running = games.filter(g => (g.tablesRunning || 0) > 0);
              const interest = games.filter(g => !(g.tablesRunning > 0) && (g.isInterest || (g.waitlistLen || 0) > 0));
              return (
                <section key={v.slug} style={{ border: '1px solid var(--border, #2a2a2a)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface, rgba(255,255,255,0.02))' }}>
                  <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border, #2a2a2a)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontFamily: "'Baskerville', 'Baskerville Old Face', 'Libre Baskerville', 'Hoefler Text', Garamond, serif", fontSize: '1.05rem', color: 'var(--text, #fff)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</span>
                      <span style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted, #888)', border: '1px solid var(--border,#333)', borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }}>
                        {SOURCE_LABEL[v.source] || v.source}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.66rem', color: 'var(--text-muted, #888)', whiteSpace: 'nowrap' }}>
                      {v.ok === false ? 'poll failed' : v.ok === null ? 'no data yet' : (ago(v.lastPollTs) || '')}
                    </span>
                  </header>

                  {v.ok === false ? (
                    <div style={{ padding: '10px 14px', color: 'var(--text-muted,#888)', fontSize: '0.78rem' }}>Couldn’t read this room’s feed{v.error ? ` (${v.error})` : ''}.</div>
                  ) : running.length === 0 && interest.length === 0 ? (
                    <div style={{ padding: '10px 14px', color: 'var(--text-muted,#888)', fontSize: '0.78rem' }}>Nothing running.</div>
                  ) : (
                    <div>
                      {running.map((g, i) => {
                        const open = openLabel(runStarts.get(gameKey(v.slug, g.gameType, g.stakes)), snapMs, windowStartMs);
                        return (
                          <div key={'r' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: i ? '1px solid var(--border, rgba(255,255,255,0.05))' : 'none' }}>
                            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text, #fff)', minWidth: 66 }}>{g.stakes}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #aaa)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {g.gameType}
                              {open && <span style={{ color: 'var(--text-muted, #777)' }}> · open {open}</span>}
                            </span>
                            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text, #fff)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                              {g.tablesRunning}<span style={{ color: 'var(--text-muted,#888)' }}> {g.tablesRunning === 1 ? 'table' : 'tables'}</span>
                            </span>
                            {(g.waitlistLen || 0) > 0 && (
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.72rem', color: 'var(--warning, #e0a458)', border: '1px solid var(--warning, #e0a458)', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>
                                WL {g.waitlistLen}
                              </span>
                            )}
                          </div>
                        );
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
    </div>
  );
}
