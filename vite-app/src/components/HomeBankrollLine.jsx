import React from 'react';
import { CURRENCY_CONFIG } from '../utils/utils.js';
import { fmtMoney } from '../utils/home.js';
import { bankrollLine } from '../utils/home-period.js';

// ── The home's bankroll line (verdict section 4; admins, the bankroll beta) ────────────────────
// A 3r section header like every other block's ('BANKROLL', the scope 'All bankrolls · USD' on the
// right: so on desktop its card starts on the same line as the Up Next card beside it), then one
// 35g x 5r bar: the balance of every roll, the tournament cap a bullet under the All rule, and the
// rule's move signal as a pill (Hold / Move down / Move up to $2,000+). It is
// the server's summary (GET /api/bankrolls/summary, App's useBankrolls, the same one the Results
// tab shows), so the two never disagree. Under the rule's minimum of recent entries there is no
// signal at all, never a '0'. Tapping it opens the Bankroll dashboard on Rules.
// No planned-spend line yet (owner, 2026-10-12: balance, cap and signal only).
export default function HomeBankrollLine({ summary, onOpen }) {
  const cur = CURRENCY_CONFIG[(summary && summary.currency) || 'USD'] || CURRENCY_CONFIG.USD;
  const money = (v) => fmtMoney(v, cur);
  const line = bankrollLine(summary, money);
  if (!line) return null;
  const label = `Balance ${money(line.balance)}, all bankrolls. Tournament cap ${line.cap.note ? `none, ${line.cap.note}` : `${line.cap.value} a bullet`}`
    + `${line.signal ? `: ${line.signal.label}` : ''}. Open the bankroll rules`;
  return (
    <section className="dashboard-section hm-bank" aria-label="Bankroll">
      <div className="dashboard-section-header hm-period-head">
        <div className="hm-cell hm-sec-title"><span className="hm-clip">Bankroll</span></div>
        <span className="hm-cell hm-f-2xs hm-period-scope">{`All bankrolls · ${line.currency}`}</span>
      </div>
      <button type="button" className="hm-bank-bar" onClick={onOpen} aria-label={label}>
        <span className="hm-bank-col">
          <span className="hm-cell hm-f-2xs hm-bank-k"><span className="hm-clip">Balance</span></span>
          <span className="hm-cell hm-f-md-b hm-bank-v"><span className="hm-clip">{money(line.balance)}</span></span>
        </span>
        <span className="hm-bank-col hm-bank-col--cap" title={line.cap.title}>
          <span className="hm-cell hm-f-2xs hm-bank-k"><span className="hm-clip">{line.rule ? `Cap · ${line.rule} rule` : 'Cap'}</span></span>
          <span className="hm-cell hm-f-md-b hm-bank-v">
            {/* No cap: the dash and its reason, in words (a title never shows on a phone). */}
            <span className="hm-clip">{line.cap.value}<span className="hm-bank-w">{line.cap.note ? ` ${line.cap.note}` : ' a bullet'}</span></span>
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
