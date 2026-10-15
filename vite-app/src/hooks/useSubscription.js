import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../utils/api.js';

/*
 * The signed-in account's plan and what it unlocks (MONETIZATION-PLAN.md §11 "Frontend Hook"). The
 * server decides (GET /api/subscription: tier, status, paywallLive, features), so a plan bought in the
 * app holds on the web. Until PAYWALL_LIVE is on, every feature reads as open, so gating a screen on
 * has('replayer') changes nothing before 1 March. While loading, everything reads as open too: a
 * paywall must never flash at someone who has the plan.
 */
export default function useSubscription(token) {
  const [sub, setSub] = useState(null);
  const reload = useCallback(() => {
    if (!token) { setSub(null); return; }
    fetch(`${API_URL}/subscription`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSub(d))
      .catch(() => {});
  }, [token]);
  useEffect(() => { reload(); }, [reload]);
  const features = (sub && sub.features) || null;
  return {
    sub,
    reload,
    paywallLive: !!(sub && sub.paywallLive),
    /** true when the plan includes it (or the paywall is off, or it is still loading). */
    has: (key) => !features || !(key in features) || features[key] === true || features[key] === null || typeof features[key] === 'number',
    /** the plan's limit for a counted feature (saves, results_per_month), or null = unlimited. */
    limit: (key) => (features && typeof features[key] === 'number' ? features[key] : null),
    tier: (sub && sub.tier) || 'free',
    isTrialing: !!(sub && sub.status === 'trial'),
    trialDaysLeft: sub && sub.trial ? sub.trial.remainingDays : null,
  };
}
