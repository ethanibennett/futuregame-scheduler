import React from 'react';
import TableScanner from './TableScanner.jsx';

// Hands > Scanner: the Table Scanner as a Hands tool. It used to be a section of the home; since
// 2026-10-12 the home reaches it from a Playing card (Scan), and this keeps it one tap from the
// replayer, whose seats take the names it finds (TableScanner: localStorage tableScanPlayers).
// Laid out as the home's old section: a .dashboard-view, so the 3r header seats its title on +2r.
export default function HandsScanner() {
  return (
    <div className="dashboard-view hands-scan">
      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div className="dashboard-section-title">Table Scanner</div>
        </div>
        <TableScanner />
      </div>
    </div>
  );
}
