// Bankrolls (beta, app admins): the list, the Results tab's selected bankroll, and the API calls.
// With `enabled` false (every non-admin) it fetches nothing and selects 'all', so the Results tab
// renders exactly what it rendered before bankrolls existed.
import { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../utils/api.js';
import { BANKROLL_ALL, toBankrollKey } from '../utils/bankrolls.js';

const STORE_KEY = 'resultsBankroll';
const readSelected = () => { try { return toBankrollKey(localStorage.getItem(STORE_KEY)); } catch { return BANKROLL_ALL; } };

export default function useBankrolls({ enabled, token }) {
  const [bankrolls, setBankrolls] = useState([]);
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

  const refresh = useCallback(async () => {
    if (!enabled || !token) return;
    try { setBankrolls((await call('GET', '')).bankrolls || []); } catch (e) { console.error('Fetch bankrolls:', e); }
  }, [enabled, token, call]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!enabled) setSelectedState(BANKROLL_ALL); }, [enabled]);

  // A selection that no longer exists (deleted, archived, another account's) falls back to All.
  const visible = bankrolls.filter((b) => !b.archived);
  const effective = enabled && (selected === BANKROLL_ALL || visible.some((b) => b.id === selected)) ? selected : BANKROLL_ALL;

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
