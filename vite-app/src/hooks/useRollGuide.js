// The bankroll summary for places outside the Results tab (beta, app admins): an event card's
// "of your roll" line. One shared copy for every card — a module-level store, fetched once a
// minute at most, and refreshed for free whenever useBankrolls fetches it (publishSummary).
import { useEffect, useState } from 'react';
import { fetchApi } from '../utils/api.js';

let state = { summary: null, at: 0, loading: null };
const subs = new Set();
const FRESH_MS = 60 * 1000;

export function publishSummary(summary) {
  state = { ...state, summary, at: Date.now() };
  subs.forEach((fn) => fn(summary));
}

function load() {
  if (state.loading || (state.summary && Date.now() - state.at < FRESH_MS)) return;
  state.loading = fetchApi('/bankrolls/summary?currency=USD')
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => { if (s) publishSummary(s); })
    .catch(() => {})
    .finally(() => { state.loading = null; });
}

/** The latest GET /api/bankrolls/summary, or null (always null when `enabled` is false). */
export default function useRollGuide(enabled) {
  const [summary, setSummary] = useState(state.summary);
  useEffect(() => {
    if (!enabled) return undefined;
    subs.add(setSummary);
    if (state.summary) setSummary(state.summary);
    load();
    return () => { subs.delete(setSummary); };
  }, [enabled]);
  return enabled ? summary : null;
}
