// Bankrolls (beta, app admins): the list, the Results tab's selected bankroll, the server ledger's
// summary (balances — lib/bankroll-ledger.js), and the API calls.
// With `enabled` false (every non-admin) it fetches nothing and selects 'all', so the Results tab
// renders exactly what it rendered before bankrolls existed.
import { useState, useEffect, useCallback, useRef } from 'react';
import { API_URL } from '../utils/api.js';
import { BANKROLL_ALL, BANKROLL_MAIN, toBankrollKey } from '../utils/bankrolls.js';

const STORE_KEY = 'resultsBankroll';
/* Main is the default (owner, 2026-10-16: the bankrolls became one dropdown, "main as the default").
   Nothing stored is Main; a browser that stored All before then (All was the default, so that was
   almost always the default, not a choice) moves to Main once; a choice made after that is kept. */
const MAIN_DEFAULT_KEY = 'resultsBankrollMainDefault';
const readSelected = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!localStorage.getItem(MAIN_DEFAULT_KEY)) {
      localStorage.setItem(MAIN_DEFAULT_KEY, '1');
      if (raw == null || raw === BANKROLL_ALL) { localStorage.setItem(STORE_KEY, BANKROLL_MAIN); return BANKROLL_MAIN; }
    }
    return raw == null ? BANKROLL_MAIN : toBankrollKey(raw);
  } catch { return BANKROLL_MAIN; }
};

// `version` is anything that changes when results change (App passes its tracking entries), so the
// balances, which the server now computes, are refetched after a result is logged or edited.
// App creates it once and hands it to the home and to the Results tab: one summary for both.
export default function useBankrolls({ enabled, token, version }) {
  const [bankrolls, setBankrolls] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selected, setSelectedState] = useState(() => (enabled ? readSelected() : BANKROLL_ALL));

  const call = useCallback(async (method, path, body) => {
    const res = await fetch(`${API_URL}/bankrolls${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [token]);

  const refreshSummary = useCallback(async () => {
    if (!enabled || !token) return;
    try {
      const s = await call('GET', '/summary?currency=USD');
      setSummary(s);
    } catch (e) { console.error('Fetch bankroll summary:', e); }
  }, [enabled, token, call]);

  // rev counts the refreshes after the first load: each follows a change to the bankroll data (a
  // bankroll, a deposit, a cash session saved in Results > Cash), so anything that reads that data
  // beside the summary (the home's Last result, which lists cash sessions) can key a refetch on it.
  const [rev, setRev] = useState(0);
  const loadedOnce = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || !token) return;
    try { setBankrolls((await call('GET', '')).bankrolls || []); } catch (e) { console.error('Fetch bankrolls:', e); }
    await refreshSummary();
    if (loadedOnce.current) setRev((n) => n + 1);
    loadedOnce.current = true;
  }, [enabled, token, call, refreshSummary]);

  useEffect(() => { refresh(); }, [refresh]);
  // Results changed: only the balances move, the list does not.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    refreshSummary();
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  // App holds this hook for the whole session (the home and Results share it), so an admin who signs
  // in after the app opened picks up their remembered selection here rather than at mount.
  useEffect(() => { setSelectedState(enabled ? readSelected() : BANKROLL_ALL); }, [enabled]);

  // A selection that no longer exists (deleted, archived, another account's) falls back to Main
  // while the list is loading or when Main is in it, else to All.
  const visible = bankrolls.filter((b) => !b.archived);
  const known = selected === BANKROLL_ALL || visible.some((b) => b.id === selected) || (selected === BANKROLL_MAIN && !bankrolls.length);
  const fallback = !bankrolls.length || visible.some((b) => b.id === BANKROLL_MAIN) ? BANKROLL_MAIN : BANKROLL_ALL;
  const effective = enabled ? (known ? selected : fallback) : BANKROLL_ALL;

  const setSelected = useCallback((key) => {
    const k = toBankrollKey(key);
    setSelectedState(k);
    try { localStorage.setItem(STORE_KEY, String(k)); } catch { /* private mode */ }
  }, []);

  // Each mutation refreshes the list, so balances and counts never go stale.
  const mutate = useCallback(async (method, path, body) => {
    const data = await call(method, path, body);
    await refresh();
    return data;
  }, [call, refresh]);

  return {
    enabled: !!enabled,
    bankrolls,
    summary,
    rev,
    call,
    token, // for the dashboard's reads outside /api/bankrolls (the Sessions tab: /api/tracking, /api/cash-sessions)
    visible,
    selected: effective,
    setSelected,
    refresh,
    create: (b) => mutate('POST', '', b),
    update: (id, b) => mutate('PUT', `/${id}`, b),
    remove: (id) => mutate('DELETE', `/${id}`),
    reorder: (order) => mutate('PUT', '/order', { order }),
    adjust: (b) => mutate('POST', '/adjustments', b),
    transfer: (b) => mutate('POST', '/transfers', b),
    removeAdjustment: (id) => mutate('DELETE', `/adjustments/${id}`),
    listAdjustments: () => call('GET', '/adjustments').then((d) => d.adjustments || []),
  };
}
