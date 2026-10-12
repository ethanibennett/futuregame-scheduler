import React from 'react';
import { CURRENCY_CONFIG } from '../utils/utils.js';
import { fmtMoney } from '../utils/home.js';
import { bankrollLine } from '../utils/home-period.js';

// ── The home's bankroll line (verdict section 4; admins, the bankroll beta) ────────────────────
// One 35g x 5r bar under what is next: the balance of every roll, the tournament cap a bullet under
// the All rule, and the rule's move signal as a pill (Hold / Move down / Move up to $2,000+). It is
// the server's summary (GET /api/bankrolls/summary, App's useBankrolls, the same one the Results
// tab shows), so the two never disagree. Under the rule's minimum of recent entries there is no
// signal at all, never a '0'. Tapping it opens the Bankroll dashboard on Rules.
// No planned-spend line yet (owner, 2026-10-12: balance, cap and signal only).
export default function HomeBankrollLine({ summary, onOpen }) {
  const cur = CURRENCY_CONFIG[(summary && summary.currency) || 'USD'] || CURRENCY_CONFIG.USD;
  const money = (v) => fmtMoney(v, cur);
  const line = bankrollLine(summary, money);
  if (!line) return null;
  const label = `Balance ${money(line.balance)}, all rolls. Tournament cap ${line.cap.value} a bullet`
    + `${line.signal ? `: ${line.signal.label}` : ''}. Open the bankroll rules`;
  return (
    <section className="dashboard-section hm-bank" aria-label="Bankroll">
      <button type="button" className="hm-bank-bar" onClick={onOpen} aria-label={label}>
        <span className="hm-bank-col">
          <span className="hm-cell hm-f-2xs hm-bank-k"><span className="hm-clip">All rolls</span></span>
          <span className="hm-cell hm-f-md-b hm-bank-v">
            <span className="hm-clip"><span className="hm-bank-w">Balance </span>{money(line.balance)}</span>
          </span>
        </span>
        <span className="hm-bank-col hm-bank-col--cap" title={line.cap.title}>
          <span className="hm-cell hm-f-2xs hm-bank-k"><span className="hm-clip">{line.rule ? `Cap · ${line.rule} rule` : 'Cap'}</span></span>
          <span className="hm-cell hm-f-md-b hm-bank-v">
            <span className="hm-clip">{line.cap.value}<span className="hm-bank-w"> a bullet</span></span>
          </span>
        </span>
        {line.signal && (
          <span className={`hm-bank-pill snap-g is-${line.signal.key}`} title={line.signal.title}>
            <span className="hm-tag-t">{line.signal.label}</span>
          </span>
        )}
      </button>
    </section>
  );
}
