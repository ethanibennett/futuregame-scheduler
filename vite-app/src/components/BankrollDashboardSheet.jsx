import React, { Suspense, lazy } from 'react';

// The bankroll dashboard (beta) is its own chunk: only an admin who opens it (the Dashboard
// button in the Results tab's bankroll strip) downloads it.
const BankrollDashboard = lazy(() => import('./BankrollDashboard.jsx'));

// initialTab / initialKey pass through (the home opens it on a tab: Rules, Goals, the Overview).
export default function BankrollDashboardSheet({ bk, onClose, initialTab, initialKey }) {
  return (
    <Suspense fallback={null}>
      <BankrollDashboard bk={bk} onClose={onClose} initialTab={initialTab} initialKey={initialKey} />
    </Suspense>
  );
}
