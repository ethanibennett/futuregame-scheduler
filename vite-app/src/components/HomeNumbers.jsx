import React, { useEffect, useRef, useState } from 'react';
import HomeBankrollLine from './HomeBankrollLine.jsx';
import HomePeriod from './HomePeriod.jsx';
import BankrollDashboardSheet from './BankrollDashboardSheet.jsx';
import useLiveCashSession from '../hooks/useLiveCashSession.js';

// ── The home's NUMBERS column, its top half (verdict sections 4 and 5) ─────────────────────────
// The bankroll line (admins) over the period block and its goals. Tiers: everyone gets the period
// block for their tournaments; admins (the bankroll beta: bk.enabled) also get the bankroll line,
// cash, trips, expenses and goals, and every admin request is made only for them.
// The taps go to the deep views: the bankroll line to the Bankroll dashboard's Rules, the goals to
// its Goals and the block to its Overview, all on All bankrolls, in a sheet over the home (closing
// it comes back here); a trip's block to that trip's page in Results; anyone else's block to Results.
export default function HomeNumbers({ isAdmin, token, bk, results, schedule, updates, rates, currency, today, onLog }) {
  const admin = !!(isAdmin && bk && bk.enabled);
  const [sheet, setSheet] = useState(null); // the dashboard tab to open: 'rules' | 'goals' | 'balance'

  // A cash session started or ended changes the ledger without changing a result: refresh the
  // shared summary (and with it the block) when the live session comes or goes.
  const { session: live, loaded } = useLiveCashSession({ enabled: admin, token });
  const liveKey = loaded ? (live ? live.id : 0) : null;
  const lastLive = useRef(null);
  useEffect(() => {
    if (liveKey == null) return;
    if (admin && lastLive.current != null && lastLive.current !== liveKey) bk.refresh();
    lastLive.current = liveKey;
  }, [liveKey, admin]); // eslint-disable-line react-hooks/exhaustive-deps

  const onOpen = (o) => {
    if (o && o.kind === 'trip' && onLog) onLog({ kind: 'trip', tripId: o.tripId });
    else if (admin) setSheet('balance');
    else if (onLog) onLog({ kind: 'results' });
  };
  return (
    <>
      {admin && <HomeBankrollLine summary={bk.summary} onOpen={() => setSheet('rules')} />}
      <HomePeriod admin={admin} bk={bk} results={results} schedule={schedule} updates={updates} rates={rates}
        currency={currency} today={today} onOpen={onOpen} onOpenGoals={() => setSheet('goals')} />
      {admin && sheet && (
        <BankrollDashboardSheet bk={bk} initialTab={sheet} initialKey="all" onClose={() => setSheet(null)} />
      )}
    </>
  );
}
