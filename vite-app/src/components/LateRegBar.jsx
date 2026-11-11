import React, { useState, useEffect } from 'react';
import { getVenueBrandColor, getNow, parseDateTimeInTz, parseDateTime, parseLateRegEnd, lateRegCtx, lateRegLevel, fmtCloseInRoom, isTbd } from '../utils/utils.js';

// ── Late Reg Bar ──
// The expanded schedule card's and the Dashboard card's late-registration bar: "Until Start" before
// the start, then the time left in late reg on a bar that empties over its last 12 hours.
// startAt: the room's own clock start (PokerAtlas), when it has one, over the published time.
export default function LateRegBar({ lateRegEnd, date, time, venueAbbr, venue, startAt, completed, levelMin = null, reentry = null }) {
  const [now, setNow] = useState(getNow());
  useEffect(() => {
    const id = setInterval(() => setNow(getNow()), 30000);
    return () => clearInterval(id);
  }, []);

  // The room's clock showed the tournament finished (server: clock_ended_at / state 'ended').
  if (completed) {
    return (
      <div className="late-reg-wrap">
        <div className="late-reg-label-row">
          <span className="late-reg-label event-completed-label">Event Completed</span>
        </div>
        <div className="late-reg-bar-bg">
          <div className="late-reg-bar-fill" style={{ width: '0%', background: 'var(--border)' }} />
        </div>
      </div>
    );
  }

  // Pre-start countdown
  // No start announced (App improvements 9): say so, no countdown, no late-reg line.
  if (isTbd(time) && !startAt) {
    return (
      <div className="late-reg-wrap">
        <div className="late-reg-label-row">
          <span className="late-reg-label pending">Start</span>
          <span className="late-reg-sep"></span>
          <span className="late-reg-time pending">not announced yet</span>
        </div>
      </div>
    );
  }
  if (date || startAt) {
    const startMs = startAt ?? (venue ? parseDateTimeInTz(date, time, venue) : parseDateTime(date, time || '12:00 AM'));
    if (now < startMs) {
      const totalSec = Math.floor((startMs - now) / 1000);
      const d = Math.floor(totalSec / 86400);
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const parts = [];
      if (d > 0) parts.push(`${d} day${d !== 1 ? 's' : ''}`);
      if (h > 0) parts.push(`${h} hour${h !== 1 ? 's' : ''}`);
      parts.push(`${m} minute${m !== 1 ? 's' : ''}`);
      return (
        <div className="late-reg-wrap">
          <div className="late-reg-label-row">
            <span className="late-reg-label pending">Until Start</span>
            <span className="late-reg-sep"></span>
            <span className="late-reg-time pending">{parts.join(', ')}</span>
          </div>
        </div>
      );
    }
  }

  if (!lateRegEnd) return null;
  // The close in the room's zone, a level as the end of that level (App improvements 1, 2).
  const endMs = parseLateRegEnd(lateRegEnd, date, venue, lateRegCtx({ date, time, venue, level_duration: levelMin, reentry }));
  if (isNaN(endMs)) return null;
  const diffMs = endMs - now;
  const diffMin = Math.floor(diffMs / 60000);
  const endDate = new Date(endMs);
  const level = lateRegLevel(lateRegEnd);
  const endClock = (level != null ? `Level ${level}, ≈ ` : '') + fmtCloseInRoom(endMs, venue, date);

  let status, label, timeStr;
  if (diffMs <= 0) {
    status = 'closed'; label = 'Late Reg Closed'; timeStr = null;
  } else if (diffMin < 30) {
    status = 'urgent'; label = 'Late Reg — Closing Soon';
    timeStr = `${diffMin}m left | ${endClock}`;
  } else if (diffMin < 120) {
    const h = Math.floor(diffMin / 60); const m2 = diffMin % 60;
    status = 'soon'; label = 'Late Reg Open';
    timeStr = (h > 0 ? `${h}h ${m2}m left` : `${m2}m left`) + ` | ${endClock}`;
  } else {
    const h = Math.floor(diffMin / 60); const m2 = diffMin % 60;
    status = 'open'; label = 'Late Reg Open';
    timeStr = (h > 0 ? `${h}h ${m2}m left` : `${m2}m left`) + ` | ${endClock}`;
  }

  const windowMs = 12 * 60 * 60 * 1000;
  const pct = status === 'closed' ? 0 : Math.min(100, Math.max(0, (diffMs / windowMs) * 100));
  const brandColor = getVenueBrandColor(venueAbbr);
  const critical = status !== 'closed' && pct <= 15;

  return (
    <div className="late-reg-wrap">
      <div className="late-reg-label-row">
        <span className={`late-reg-label ${status}`}>{label}</span>
        {timeStr && <span className={`late-reg-time ${status}`}>{timeStr}</span>}
      </div>
      <div className="late-reg-bar-bg">
        <div
          className={`late-reg-bar-fill ${critical ? 'critical' : ''}`}
          style={{ width: `${pct}%`, background: critical ? undefined : (status === 'closed' ? 'var(--border)' : brandColor) }}
        />
      </div>
    </div>
  );
}
