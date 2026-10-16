import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { bankrollLine } from '../utils/home-period.js';
import useLiveCashSession from '../hooks/useLiveCashSession.js';

// The Analytics sheet is its own chunk (as in Results): only an admin who taps the noise line loads it.
const AnalyticsView = lazy(() => import('./AnalyticsView.jsx'));

// ── The home's NUMBERS (verdict sections 4 and 5): what the bankroll line and the period block share ──
// A hook, not a column, since Edit home (2026-10-13): the user orders the home's sections, and on
// the phone the bankroll line and the period block can now be apart (Bankroll above Up Next, This
// month at the foot), so DashboardView renders HomeBankrollLine and HomePeriod as two sections and
// this keeps what they had in common: the sheets they open and the refresh of the shared summary.
// Tiers: everyone gets the period block for their tournaments; admins (the bankroll beta:
// bk.enabled) also get the bankroll line, cash, trips, expenses and goals, and every admin request is
// made only for them.
// The taps go to the deep views: the bankroll line to the Bankroll dashboard's Rules, the goals to
// its Goals and the block to its Overview, all on All bankrolls, in a sheet over the home (closing
// it comes back here); a trip's block to that trip's page in Results; anyone else's block to Results.
// The signal-or-noise line under the block (admins) opens the Analytics sheet over the home, on the
// block's scope; a sentence about cash opens the dashboard's Overview instead.
//
//   const num = useHomeNumbers({ isAdmin, token, bk, onLog });
//   num.admin       the bankroll beta is on for this account
//   num.bankLine    the bankroll line's model (null: none, or the summary not loaded)
//   num.onOpenRules / onOpenBlock / onOpenGoals / onOpenNoise   the sections' taps
//   num.sheets      the sheets, rendered once at the home's root (they portal to the body)
export function useHomeNumbers({ isAdmin, token, bk, onLog }) {
  const admin = !!(isAdmin && bk && bk.enabled);
  const [analytics, setAnalytics] = useState(null); // the bankroll scope to open Analytics on
  // Stable: the sheet focuses its Done button whenever its onClose changes.
  const closeAnalytics = useCallback(() => setAnalytics(null), []);

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

  // The bankroll dashboard retired (owner, 2026-10-16): its tabs are sections of the Bankroll tab, so
  // the home's Overview, Rules and Goals taps go there.
  const openSection = (section) => { if (onLog) onLog({ kind: 'section', section }); };
  const onOpenBlock = (o) => {
    if (o && o.kind === 'trip' && onLog) onLog({ kind: 'trip', tripId: o.tripId });
    else if (admin && onLog) openSection('balance');
    else if (onLog) onLog({ kind: 'results' });
  };
  const onOpenRules = () => openSection('rules');
  const onOpenGoals = () => openSection('goals');
  const onOpenNoise = (game, scope) => (game === 'cash' ? openSection('balance') : setAnalytics(scope || 'all'));
  // The bankroll line's header states the scope ('All bankrolls · USD'); the period block right
  // under it (DashboardView: immediately under it, in the same column) leaves its own out when it is
  // the same.
  const bankLine = admin ? bankrollLine(bk.summary, String) : null;
  const sheets = (
    <>
      {admin && analytics && (
        <Suspense fallback={null}>
          <AnalyticsView bankroll={analytics} onClose={closeAnalytics} />
        </Suspense>
      )}
    </>
  );
  return { admin, bankLine, sheets, onOpenRules, onOpenBlock, onOpenGoals, onOpenNoise };
}

export default useHomeNumbers;
