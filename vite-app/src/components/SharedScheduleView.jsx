import React, { useState, useEffect, useMemo } from 'react';
import Icon from './Icon.jsx';
import { FirstRun } from './EmptyState.jsx';
import Avatar from './Avatar.jsx';
import CalendarEventRow from './CalendarEventRow.jsx';
import { API_URL } from '../utils/api.js';
import {
  getVenueInfo, normaliseDate, getToday, parseTournamentTime, extractConditions,
  THEME_ORDER, THEME_LABEL, THEME_ICON, getStoredSeasonLabel,
} from '../utils/utils.js';

export default function SharedScheduleView({ shareToken }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    fetch(`${API_URL}/shared/${shareToken}`)
      .then(r => { if (!r.ok) throw new Error('Schedule not found'); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [shareToken]);

  if (loading) return (
    <div className="auth-wrap">
      <div className="auth-card" style={{textAlign:'center'}}>
        <div className="auth-logo"><h1>futurega.me</h1><p>{getStoredSeasonLabel()}</p></div>
        <p style={{color:'var(--text-muted)',marginTop:'16px'}}>Loading schedule...</p>
      </div>
    </div>
  );

  if (error || !data) return (
    <div className="auth-wrap">
      <div className="auth-card" style={{textAlign:'center'}}>
        <div className="auth-logo"><h1>futurega.me</h1><p>{getStoredSeasonLabel()}</p></div>
        <p style={{color:'var(--text-muted)',marginTop:'16px'}}>{error || 'Schedule not found'}</p>
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
        <div className="top-bar-title">
          <h1>futurega.me</h1>
          <small>{(data.real_name || data.username)}'s schedule</small>
        </div>
        <div className="top-bar-actions">
          <span style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <Avatar src={data.avatar} username={data.username} size={22} />
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setTheme(t => { const n = THEME_ORDER[(THEME_ORDER.indexOf(t)+1)%THEME_ORDER.length]; localStorage.setItem('theme', n); return n; })} title={`Switch to ${THEME_LABEL[THEME_ORDER[(THEME_ORDER.indexOf(theme)+1)%THEME_ORDER.length]]} mode`}>
            {React.createElement(Icon[THEME_ICON[theme]] || Icon.moon)}
          </button>
        </div>
      </header>
      <main className="content-area">
        <div className="section-header">
          <h2 style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <Avatar src={data.avatar} username={data.username} size={26} />
            {(data.real_name || data.username)}'s Schedule
          </h2>
          <span className="event-count-badge">{sorted.filter(t => !t.is_restart).length} event{sorted.filter(t => !t.is_restart).length !== 1 ? 's' : ''}</span>
        </div>
        <div style={{minHeight:'100vh'}}>
        {sorted.length === 0 ? (
          <FirstRun icon="star" title="This schedule is empty" body="Whoever shared it has not added any events yet." />
        ) : (
          sorted.map(t => (
            <CalendarEventRow
              key={t.id}
              tournament={t}
              isInSchedule={true}
              onToggle={() => {}}
              isPast={normaliseDate(t.date) < todayISO}
              readOnly={true}
              conditions={extractConditions(t, true)}
              isAnchor={!!t.is_anchor}
            />
          ))
        )}
        </div>
      </main>
    </div>
  );
}
