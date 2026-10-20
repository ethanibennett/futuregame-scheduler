// Cash sessions (beta, app admins): the ONE live session, shared by the bar above the bottom nav
// (LiveCashBar, mounted in App) and the Results tab's Cash view, so starting, rebuying or ending
// in one updates the other at once. The session lives on the server (GET /api/cash-sessions/live),
// which is what makes the running clock survive a reload, a closed app, or a second device; this
// store only mirrors it, re-reading on mount, when the app comes back to the foreground, and every
// few minutes. It also holds the session's stack updates (`stacks`, oldest first), which /live,
// /rebuy and /stack all return, so the live screen's swing graph is the same on every device.
//
// Also here: which half of the Results tab is showing (Tournaments | Cash), so the bar can open
// the Cash half and hide itself while that half — which shows the full live card — is on screen.
import { useEffect, useSyncExternalStore } from 'react';
import { API_URL } from '../utils/api.js';

let state = { session: null, stacks: [], skew: 0, loaded: false };
const subs = new Set();
const emit = () => { for (const f of subs) f(); };
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

/**
 * Put a session the server just returned (or null) into the store. serverNow: the response's `now`.
 * stacks: its stack updates, when the response carried them; omitted, the ones already held for the
 * same session are kept (a different session starts with none).
 */
export function setLiveSession(session, serverNow, stacks) {
  const skew = serverNow ? Date.parse(serverNow) - Date.now() : state.skew;
  const next = session && session.live ? session : null;
  const keep = next && state.session && state.session.id === next.id ? state.stacks : [];
  state = { session: next, stacks: next ? (Array.isArray(stacks) ? stacks : keep) : [], skew: Number.isFinite(skew) ? skew : 0, loaded: true };
  emit();
}

export async function refreshLiveSession(token) {
  if (!token) return;
  try {
    const res = await fetch(`${API_URL}/cash-sessions/live`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const data = await res.json();
    setLiveSession(data.session, data.now, data.stacks);
  } catch { /* offline: keep what we had */ }
}

let pollers = 0;
let stopPolling = null;
/** Read the live session; `enabled` (admins) also keeps it fresh while mounted. */
export default function useLiveCashSession({ enabled, token }) {
  const snap = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!enabled || !token) return undefined;
    pollers += 1;
    if (pollers === 1) {
      refreshLiveSession(token);
      const onVis = () => { if (document.visibilityState === 'visible') refreshLiveSession(token); };
      document.addEventListener('visibilitychange', onVis);
      const id = setInterval(() => refreshLiveSession(token), 5 * 60 * 1000);
      stopPolling = () => { document.removeEventListener('visibilitychange', onVis); clearInterval(id); };
    }
    return () => { pollers -= 1; if (pollers === 0 && stopPolling) { stopPolling(); stopPolling = null; } };
  }, [enabled, token]);
  return enabled ? snap : { session: null, stacks: [], skew: 0, loaded: false };
}

/**
 * The running session (or null), read-only: no polling, no fetch. For a view that only needs to know
 * whether one runs and leaves keeping it fresh to the bar over the nav (LiveCashBar, mounted in App
 * for admins). Empty for everyone else, since nothing fills the store.
 */
export function useLiveSessionNow() {
  return useSyncExternalStore(subscribe, () => state).session;
}

// ── The Bankroll tab's section: 'tournaments' | 'cash', or one of the retired bankroll dashboard's
// tabs, drawn on the page itself (owner, 2026-10-16): 'balance' (Overview), 'locations', 'reports',
// 'backers', 'rules', 'goals', 'data' (Import). ──
export const RESULTS_SECTIONS = [
  ['tournaments', 'Tournaments'], ['cash', 'Cash'], ['all', 'All'], ['balance', 'Overview'], ['locations', 'Locations'],
  ['reports', 'Reports'], ['backers', 'Backers'], ['rules', 'Rules'], ['goals', 'Goals'], ['data', 'Import'],
];
const SECTION_KEYS = new Set(RESULTS_SECTIONS.map(([k]) => k));
const KIND_KEY = 'resultsKind';
const asSection = (k) => (k === 'sessions' ? 'tournaments' : SECTION_KEYS.has(k) ? k : 'tournaments');
let kind = (() => { try { return asSection(localStorage.getItem(KIND_KEY)); } catch { return 'tournaments'; } })();
const kindSubs = new Set();
export function setResultsKind(k) {
  kind = asSection(k);
  // Only the halves are remembered on this device: a launch opens on Tournaments or Cash, never on
  // Import or Rules from last time.
  if (kind === 'tournaments' || kind === 'cash' || kind === 'all') { try { localStorage.setItem(KIND_KEY, kind); } catch { /* private mode */ } }
  for (const f of kindSubs) f();
}
export function useResultsKind() {
  return useSyncExternalStore((f) => { kindSubs.add(f); return () => kindSubs.delete(f); }, () => kind);
}
