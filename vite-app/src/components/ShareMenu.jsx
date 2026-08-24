import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  computeScorecardData, drawSeriesScorecard, drawCountdownStory,
  drawPollEventVsEvent, shareOrDownloadCanvas, ensureExportFonts,
} from '../utils/export.js';
import {
  parseDateTimeInTz, parseDateTime,
} from '../utils/utils.js';

export default function ShareMenu({ trackingData, tournaments, mySchedule, myActiveUpdates, onClose, onOpenWrapUp }) {
  const scorecardData = useMemo(() => computeScorecardData(trackingData, null, tournaments), [trackingData, tournaments]);

  const hasTrackingData = trackingData && trackingData.length > 0;
  const hasActiveUpdate = myActiveUpdates && myActiveUpdates.some(u => !u.is_busted);

  // Find next upcoming event from schedule
  const nextEvent = useMemo(() => {
    if (!mySchedule || mySchedule.length === 0) return null;
    const now = Date.now();
    // Compute each timestamp ONCE then filter+sort by the cached value.
    const decorated = mySchedule
      .filter(t => t.date)
      .map(t => ({ t, ts: t.venue ? parseDateTimeInTz(t.date, t.time, t.venue) : parseDateTime(t.date, t.time) }))
      .filter(x => !isNaN(x.ts) && x.ts > now)
      .sort((a, b) => a.ts - b.ts);
    return decorated[0]?.t || null;
  }, [mySchedule]);

  // Countdown text for next event
  const nextCountdown = useMemo(() => {
    if (!nextEvent) return null;
    const ts = nextEvent.venue ? parseDateTimeInTz(nextEvent.date, nextEvent.time, nextEvent.venue) : parseDateTime(nextEvent.date, nextEvent.time);
    if (isNaN(ts)) return '\u2014';
    const diff = ts - Date.now();
    if (diff <= 0) return 'now';
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hrs > 24) return Math.floor(hrs / 24) + 'd ' + (hrs % 24) + 'h';
    if (hrs > 0) return hrs + 'h ' + mins + 'm';
    return mins + 'm';
  }, [nextEvent]);

  // Find two upcoming events for poll
  const nextTwoEvents = useMemo(() => {
    if (!mySchedule || mySchedule.length < 2) return null;
    const now = new Date();
    // Decorate by venue-TZ aware timestamp so cross-venue events sort by
    // absolute time, not user-local date.
    const upcoming = mySchedule
      .filter(t => t.date && new Date(t.date + 'T23:59:59') >= now)
      .map(t => ({ t, ts: t.venue ? parseDateTimeInTz(t.date, t.time, t.venue) : parseDateTime(t.date, t.time) }))
      .sort((a, b) => a.ts - b.ts)
      .map(x => x.t)
      .slice(0, 2);
    return upcoming.length === 2 ? upcoming : null;
  }, [mySchedule]);

  const handleGenerate = async (type) => {
    // BEFORE the first fillText, not after: canvas neither triggers webfont
    // loading nor waits for it, so drawing first would set the type in Arial
    // and awaiting afterwards would only help the next export.
    await ensureExportFonts();
    const canvas = document.createElement('canvas');
    let ctx, filename;

    if (type === 'scorecard') {
      canvas.width = 1080; canvas.height = 1080;
      ctx = canvas.getContext('2d');
      drawSeriesScorecard(ctx, 1080, 1080, scorecardData);
      filename = 'series-scorecard.png';
    } else if (type === 'countdown') {
      if (!nextEvent) return;
      canvas.width = 1080; canvas.height = 1920;
      ctx = canvas.getContext('2d');
      drawCountdownStory(ctx, 1080, 1920, {
        tournamentName: nextEvent.event_name,
        buyin: nextEvent.buyin,
        venue: nextEvent.venue,
        gameType: nextEvent.game_variant,
        timeUntil: nextCountdown,
        date: nextEvent.date,
        time: nextEvent.time
      });
      filename = 'next-event.png';
    } else if (type === 'wrapup') {
      onClose();
      if (onOpenWrapUp) onOpenWrapUp();
      return;
    } else if (type === 'poll-events') {
      if (!nextTwoEvents) return;
      canvas.width = 1080; canvas.height = 1920;
      ctx = canvas.getContext('2d');
      drawPollEventVsEvent(ctx, 1080, 1920, {
        event1: { name: nextTwoEvents[0].event_name, buyin: nextTwoEvents[0].buyin, time: nextTwoEvents[0].time },
        event2: { name: nextTwoEvents[1].event_name, buyin: nextTwoEvents[1].buyin, time: nextTwoEvents[1].time }
      });
      filename = 'poll-events.png';
    } else {
      return;
    }

    await shareOrDownloadCanvas(canvas, filename);
    onClose();
  };

  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel">
        <h3>Share & Social</h3>
        <div className="share-menu-grid">
          {/* Scorecard */}
          <div
            className={'share-menu-item' + (!hasTrackingData ? ' disabled' : '')}
            onClick={() => hasTrackingData && handleGenerate('scorecard')}
          >
            <span className="share-icon">{'\uD83D\uDCCA'}</span>
            <span className="share-label">Series Scorecard</span>
            <span className="share-desc">Stats card with P&L, ROI, streak</span>
          </div>
          {/* Countdown */}
          <div
            className={'share-menu-item' + (!nextEvent ? ' disabled' : '')}
            onClick={() => nextEvent && handleGenerate('countdown')}
          >
            <span className="share-icon">{'\u23F0'}</span>
            <span className="share-label">Next Event</span>
            <span className="share-desc">Countdown story graphic</span>
          </div>
          {/* Wrap-up */}
          <div
            className={'share-menu-item' + (!hasTrackingData ? ' disabled' : '')}
            onClick={() => hasTrackingData && handleGenerate('wrapup')}
          >
            <span className="share-icon">{'\uD83C\uDFAC'}</span>
            <span className="share-label">Series Wrap</span>
            <span className="share-desc">Spotify Wrapped style recap</span>
          </div>
          {/* Poll: Event vs Event */}
          <div
            className={'share-menu-item' + (!nextTwoEvents ? ' disabled' : '')}
            onClick={() => nextTwoEvents && handleGenerate('poll-events')}
          >
            <span className="share-icon">{'\uD83D\uDCCA'}</span>
            <span className="share-label">Event Poll</span>
            <span className="share-desc">A vs B poll template</span>
          </div>
          {/* Import from Hendon Mob placeholder */}
          <div className="share-menu-item disabled" onClick={() => {}}>
            <span className="share-icon">{'\uD83C\uDF0D'}</span>
            <span className="share-label">Import Hendon Mob</span>
            <span className="share-desc">Coming soon</span>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
