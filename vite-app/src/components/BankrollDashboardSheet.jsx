import React, { Suspense, lazy } from 'react';

// The bankroll dashboard (beta) is its own chunk: only an admin who opens it (the Dashboard
// button in the Results tab's bankroll strip) downloads it.
const BankrollDashboard = lazy(() => import('./BankrollDashboard.jsx'));

// initialTab / initialKey pass through (the home opens it on a tab: Rules, Goals, the Overview).
// onLog is App's hand-off to Results (a form to open there): the sheet's floating + uses it.
export default function BankrollDashboardSheet({ bk, onClose, initialTab, initialKey, onLog }) {
  return (
    <Suspense fallback={null}>
      <BankrollDashboard bk={bk} onClose={onClose} initialTab={initialTab} initialKey={initialKey} onLog={onLog} />
    </Suspense>
  );
}
