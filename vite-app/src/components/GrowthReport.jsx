import React, { useEffect, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { growthRows, topSources } from '../utils/growth-report.js';
import './analytics.css';

/*
 * The Admin screen's growth table (launch plan, action 5; 2026-10-15): GET /api/admin/growth, the
 * weekly cohorts lib/growth.js counts on the server. Sign-ups per week, the share that saved an event
 * within 7 days, D7 and D30 retention once a week is old enough, and where sign-ups came from. The
 * users table's own styles (.admin-table), so it sits on the same grid. Counting began 15 Oct 2026;
 * accounts made before have no source and are not in it.
 */
export default function GrowthReport({ token }) {
  const [report, setReport] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let on = true;
    fetch(`${API_URL}/admin/growth?weeks=13`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (on) setReport(d); })
      .catch(() => { if (on) setFailed(true); });
    return () => { on = false; };
  }, [token]);
  if (failed) return null;
  const rows = growthRows(report);
  const sources = topSources(report);
  return (
    <section className="growth-report" aria-label="Growth">
      <h3 className="an-cell an-sec">Growth, last 13 weeks</h3>
      {report && rows.length === 0 && (
        <p className="an-p">No sign-ups counted yet. Counting began 15 Oct 2026.</p>
      )}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table growth-table">
            <colgroup>
              <col />
              <col style={{ width: 'calc(var(--gu) * 6)' }} />
              <col style={{ width: 'calc(var(--gu) * 7)' }} />
              <col style={{ width: 'calc(var(--gu) * 5)' }} />
              <col style={{ width: 'calc(var(--gu) * 5)' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Week of</th>
                <th style={{ textAlign: 'right' }} title="Sign-ups that week">New</th>
                <th style={{ textAlign: 'right' }} title="Saved an event within 7 days of signing up">Activated</th>
                <th style={{ textAlign: 'right' }} title="Used the app on any day 7 to 13 after signing up">D7</th>
                <th style={{ textAlign: 'right' }} title="Used the app on any day 28 to 34 after signing up">D30</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td style={{ color: 'var(--text)' }}>{r.week}</td>
                  <td style={{ textAlign: 'right' }}>{r.signups}</td>
                  <td style={{ textAlign: 'right' }}>{r.activated}</td>
                  <td style={{ textAlign: 'right' }}>{r.d7}</td>
                  <td style={{ textAlign: 'right' }}>{r.d30}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sources && <p className="an-p">Sources: {sources}</p>}
    </section>
  );
}
