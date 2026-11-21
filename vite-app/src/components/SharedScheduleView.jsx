import React, { useState, useEffect } from 'react';
import Icon from './Icon.jsx';
import { FirstRun } from './EmptyState.jsx';
import Avatar from './Avatar.jsx';
import ThemeButton from './ThemeButton.jsx';
import useThemeChoice from '../hooks/useThemeChoice.js';
import CalendarEventRow from './CalendarEventRow.jsx';
import DateBreak from './DateBreak.jsx';
import { API_URL } from '../utils/api.js';
import { withoutDnpMarkers } from '../utils/didnt-play.js';
import {
  normaliseDate, getToday, parseTournamentTime, extractConditions,
  getStoredSeasonLabel,
  registerRowTimezones, registerRowCurrencies,
} from '../utils/utils.js';

export default function SharedScheduleView({ shareToken }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  /* The app's own theme button and rule (UX pick 91), as the backer page: it follows the visitor's light
     or dark until pressed, then steps through the four themes. Its own copy cycled six, the admins'
     Swiss two among them, and opened in Dark whatever the device. */
  const theme = useThemeChoice({ followDevice: true });

  useEffect(() => {
    fetch(`${API_URL}/shared/${shareToken}`)
      .then(r => { if (!r.ok) throw new Error('Schedule not found'); return r.json(); })
      .then(d => {
        const rows = Object.values(d || {}).filter(Array.isArray).flat();
        registerRowTimezones(rows);
        registerRowCurrencies(rows);
        // The server leaves the Didn't play markers out; this is the backstop.
        setData(d && Array.isArray(d.tournaments) ? { ...d, tournaments: withoutDnpMarkers(d.tournaments) } : d);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [shareToken]);

  if (loading) return (
    <div className="auth-wrap">
      <div className="auth-card" style={{textAlign:'center'}}>
        <div className="auth-logo"><h1>futurega.me</h1><p>{getStoredSeasonLabel()}</p></div>
        <p style={{color:'var(--text-muted)',marginTop:'var(--space-xl)'}}>Loading schedule...</p>
      </div>
    </div>
  );

  if (error || !data) return (
    <div className="auth-wrap">
      <div className="auth-card" style={{textAlign:'center'}}>
        <div className="auth-logo"><h1>futurega.me</h1><p>{getStoredSeasonLabel()}</p></div>
        <p style={{color:'var(--text-muted)',marginTop:'var(--space-xl)'}}>{error || 'Schedule not found'}</p>
      </div>
    </div>
  );

  const todayISO = getToday();
  const sorted = [...data.tournaments].sort((a, b) => {
    const da = parseTournamentTime(a);
    const db2 = parseTournamentTime(b);
    return da - db2;
  });

  return (
    <div className="app-shell">
      <header className="top-bar">
        {/* The owner is named once, in the heading (UX pick 94): the top bar says what the page is,
            and carries only the theme button. */}
        <div className="top-bar-title">
          <h1>futurega.me</h1>
          <small>shared schedule</small>
        </div>
        <div className="top-bar-actions">
          <ThemeButton theme={theme.theme} nextThemeLabel={theme.nextThemeLabel} onToggle={theme.toggleTheme} />
        </div>
      </header>
      <main className="content-area">
        {/* A whole 4r header, so the day groups under it start on r lines (content-high it was
            3.4r); the count a whole-g badge (snap-g) with its label centred. */}
        <div className="section-header" style={{height:'calc(var(--subrow) * 4)'}}>
          <h2 style={{display:'flex',alignItems:'center',gap:'var(--space-md)'}}>
            <Avatar src={data.avatar} username={data.username} size={26} />
            {(data.real_name || data.username)}'s Schedule
          </h2>
          <span className="event-count-badge snap-g">{sorted.filter(t => !t.is_restart).length} event{sorted.filter(t => !t.is_restart).length !== 1 ? 's' : ''}</span>
        </div>
        <div style={{minHeight:'100vh'}}>
        {sorted.length === 0 ? (
          <FirstRun icon="star" title="This schedule is empty" body="Whoever shared it has not added any events yet." />
        ) : (
          // Grouped by day, like every other schedule surface. A thirty-event
          // trip used to render as thirty undifferentiated cards with no way to
          // see where Tuesday ended - on the only page a non-user ever opens.
          Object.entries(
            sorted.reduce((acc, t) => {
              const d = normaliseDate(t.date);
              (acc[d] = acc[d] || []).push(t);
              return acc;
            }, {})
          ).map(([date, events], gi) => (
            <div key={date} data-date-group={date} style={{marginTop: gi === 0 ? 0 : 'var(--space-md)'}}>
              <DateBreak date={date} top={0} isToday={date === todayISO} eventCount={events.filter(t => !t.is_restart).length} />
              {events.map(t => (
                <div key={t.id} style={{contentVisibility:'auto', containIntrinsicSize:'auto calc(var(--subrow) * 13)'}}>
                  <CalendarEventRow
                    tournament={t}
                    isInSchedule={true}
                    onToggle={() => {}}
                    isPast={normaliseDate(t.date) < todayISO}
                    readOnly={true}
                    conditions={extractConditions(t, true)}
                    isAnchor={!!t.is_anchor}
                  />
                </div>
              ))}
            </div>
          ))
        )}
        </div>
        {/* The page ends on a next step (UX pick 94, Peak-End): a visitor who liked it gets a way in. */}
        <section className="shared-end" aria-label="Plan your own">
          <h3 className="shared-end-title">Plan your own series</h3>
          <p className="shared-end-text">Every live and online event in one schedule, with the clocks, your results and your bankroll beside it.</p>
          <a className="shared-end-btn ctl" href="/live">Open futurega.me</a>
        </section>
      </main>
    </div>
  );
}
