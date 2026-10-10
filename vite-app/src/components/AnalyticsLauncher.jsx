import React, { Suspense, lazy, useCallback, useState } from 'react';
import './analytics.css';

// The sheet is its own chunk: only an admin who opens it downloads it.
const AnalyticsView = lazy(() => import('./AnalyticsView.jsx'));

/**
 * Results-tab entry point for the analytics BETA. TrackingView renders this only for
 * app admins (isAdmin, the staged-rollout flag), so everyone else sees no change; the
 * server gates GET /api/analytics on requireAppAdmin as well.
 */
export default function AnalyticsLauncher({ bankroll = 'all' }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className="an-cell an-launch" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span>Analytics<span className="an-beta">Beta</span></span>
        <span className="an-launch-go" aria-hidden="true">Breakdowns, variance, edge ›</span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <AnalyticsView onClose={close} bankroll={bankroll} />
        </Suspense>
      )}
    </>
  );
}
