import React, { Suspense, lazy } from 'react';

// The bankroll dashboard (beta) is its own chunk: only an admin who opens it (the Dashboard
// button in the Results tab's bankroll strip) downloads it.
const BankrollDashboard = lazy(() => import('./BankrollDashboard.jsx'));

export default function BankrollDashboardSheet({ bk, onClose }) {
  return (
    <Suspense fallback={null}>
      <BankrollDashboard bk={bk} onClose={onClose} />
    </Suspense>
  );
}
