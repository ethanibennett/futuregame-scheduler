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

export default function CashView({ token }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [errMsg, setErrMsg] = useState('');
  const [fetchedAt, setFetchedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/cash/current`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        if (res.status === 403) msg = 'This account is not an admin.';
        else if (res.status === 503) msg = 'Cash watcher is offline.';
        else if (res.status === 502) msg = 'Cash watcher rejected the session.';
        else { try { const j = await res.json(); if (j && j.error) msg = j.error; } catch { /* keep */ } }
        setErrMsg(msg);
        setStatus('error');
        return;
      }
      const json = await res.json();
      setData(json);
      setFetchedAt(Date.now());
      setStatus('ok');
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
                      {running.map((g, i) => (
                        <div key={'r' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: i ? '1px solid var(--border, rgba(255,255,255,0.05))' : 'none' }}>
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text, #fff)', minWidth: 66 }}>{g.stakes}</span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #aaa)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.gameType}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text, #fff)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                            {g.tablesRunning}<span style={{ color: 'var(--text-muted,#888)' }}> {g.tablesRunning === 1 ? 'table' : 'tables'}</span>
                          </span>
                          {(g.waitlistLen || 0) > 0 && (
                            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.72rem', color: 'var(--warning, #e0a458)', border: '1px solid var(--warning, #e0a458)', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>
                              WL {g.waitlistLen}
                            </span>
                          )}
                        </div>
                      ))}
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
