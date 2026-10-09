import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { API_URL } from '../utils/api.js';
import { getToday, normaliseDate, registerRowTimezones } from '../utils/utils.js';
import CalendarEventRow, { CalendarEventRowLite } from './CalendarEventRow.jsx';
import DateBreak from './DateBreak.jsx';

// Admin-only "New events": what one admin alert added. Two kinds, one shape: a new-series push
// (the watcher found series) and a new-events push (a feed sync or an import inserted events — the
// server groups those by series). Reached by the push's /?batch=<id> deep link, or from the user
// menu / Admin header (which opens the newest batch).
// The server resolves each series to its schedule rows at read time, so a series the feed has not
// ingested yet reads "Not in the schedule yet" rather than an empty list.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' by hand, not via Date: a date with no zone must not shift a day west of UTC.
function ymd(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
  return m ? { m: Number(m[2]) - 1, d: Number(m[3]) } : null;
}
function dateRange(start, end) {
  const s = ymd(start), e = ymd(end);
  if (!s && !e) return null;
  if (!s) return `through ${MONTHS[e.m]} ${e.d}`;
  if (!e) return `from ${MONTHS[s.m]} ${s.d}`;
  if (s.m === e.m && s.d === e.d) return `${MONTHS[s.m]} ${s.d}`;
  if (s.m === e.m) return `${MONTHS[s.m]} ${s.d}–${e.d}`;
  return `${MONTHS[s.m]} ${s.d} – ${MONTHS[e.m]} ${e.d}`;
}
function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// A list built from the schedule's own date breaks and cards, held to a whole number of r. Each of
// those is meant to be whole r, but WebKit lays them out in 1/64 px units and each lands a hair
// short (measured at 402 wide: a 5r break 4.997r, a 14r card 13.994r), so a long list drifts off the
// grid — 0.13r by the end of an 18-event series, and every block below inherits it. The outer box
// takes the content's height rounded to the nearest r (re-measured when a card opens), so the next
// series starts back on a line. The inner box is a flow-root so the last card's 1r margin counts.
function WholeRows({ className, children }) {
  const outer = useRef(null);
  const inner = useRef(null);
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return undefined;
    const apply = () => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
      o.appendChild(probe);
      const r = probe.getBoundingClientRect().height / 100;
      probe.remove();
      if (r > 0) o.style.height = `calc(var(--subrow) * ${Math.round(i.getBoundingClientRect().height / r)})`;
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(apply);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return <div ref={outer} className={className}><div ref={inner} className="batch-events-inner">{children}</div></div>;
}

// Day groups in order, each headed by the schedule's own DateBreak (as SharedScheduleView does).
function groupByDay(events) {
  const groups = [];
  for (const t of events) {
    const day = normaliseDate(t.date) || String(t.date);
    const last = groups[groups.length - 1];
    if (last && last[0] === day) last[1].push(t);
    else groups.push([day, [t]]);
  }
  return groups;
}

export default function AdminBatchesView({ token, batchId, onSelectBatch, onShowInSchedule, tournaments, mySchedule, onToggle, isAdmin, onAdminEdit, onClearOverrides }) {
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [activated, setActivated] = useState(() => new Set());

  const authed = useCallback((path) => fetch(`${API_URL}${path}`, { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'That alert no longer exists.' : 'Could not load alerts.')))),
  [token]);

  useEffect(() => {
    let live = true;
    authed('/admin/batches?limit=20').then((j) => { if (live) setList(j.batches || []); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [authed, batchId]);

  // No id (opened from a menu): the newest batch.
  const shownId = batchId || (list && list.length ? list[0].id : null);
  useEffect(() => {
    if (!shownId) { setDetail(null); return; }
    let live = true;
    setDetail(null);
    setError(null);
    setActivated(new Set());
    authed(`/admin/batches/${shownId}`).then((j) => {
      if (!live) return;
      registerRowTimezones((j.series || []).flatMap((s) => s.events || []));
      setDetail(j);
    }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [authed, shownId]);

  const scheduleIds = useMemo(() => new Set((mySchedule || []).map((t) => t.id)), [mySchedule]);
  const byId = useMemo(() => new Map((tournaments || []).map((t) => [t.id, t])), [tournaments]);
  const today = getToday();

  const series = detail ? detail.series : [];
  const batch = detail ? detail.batch : null;

  return (
    <div className="batch-view">
      <div className="dashboard-section-header">
        <div className="dashboard-section-title">New Events</div>
        {batch && <span className="dashboard-section-badge dashboard-section-badge--wide">{plural(batch.seriesCount, 'series', 'series')}</span>}
      </div>

      {error && <div className="batch-msg">{error}</div>}
      {!error && !batch && <div className="batch-msg">{list && !list.length ? 'No alerts yet.' : 'Loading…'}</div>}

      {batch && (
        <div className="batch-head">
          <div className="batch-title">{batch.title}</div>
          <div className="batch-sub">{when(batch.created_at)} &middot; {plural(batch.eventCount, 'event', 'events')} in the schedule</div>
        </div>
      )}

      {series.map((s, i) => {
        const where = [s.venueName, s.cityState, dateRange(s.startDate, s.endDate)].filter(Boolean).join(' · ');
        const pending = s.status !== 'scheduled';
        return (
          <div key={(s.seriesId || '') + ':' + i} className={'batch-series' + (pending ? ' is-empty' : '')}>
            <div className="batch-series-card">
              <div className="batch-series-top">
                <div className="batch-series-name">{s.name || s.shortName || `Series ${s.seriesId}`}</div>
                {!pending && (
                  <button className="batch-show-btn" onClick={() => onShowInSchedule(s.venues[0] || s.name)}>
                    <span>Show in schedule</span>
                  </button>
                )}
              </div>
              <div className="batch-series-meta">{where || ' '}</div>
              <div className={'batch-series-count' + (pending ? ' is-pending' : '')}>
                {pending
                  ? 'Not in the schedule yet — its events arrive with the next feed sync'
                  : plural(s.eventCount, 'event', 'events') + (s.match === 'loose' ? ` · listed as “${s.venues.join(', ')}”` : '')}
              </div>
            </div>
            {!pending && (
              <WholeRows className="batch-events">
                {groupByDay(s.events.map((ev) => byId.get(ev.id) || ev)).map(([day, events]) => (
                  <div key={day}>
                    <DateBreak date={day} top={0} isToday={day === today} eventCount={events.length} />
                    {events.map((t) => (activated.has(t.id) ? (
                      <CalendarEventRow
                        key={t.id}
                        tournament={t}
                        isInSchedule={scheduleIds.has(t.id)}
                        onToggle={onToggle}
                        isPast={day < today}
                        allTournaments={tournaments}
                        scheduleIds={scheduleIds}
                        isAdmin={isAdmin}
                        onAdminEdit={onAdminEdit}
                        onClearOverrides={onClearOverrides}
                        initialOpen
                      />
                    ) : (
                      <CalendarEventRowLite
                        key={t.id}
                        tournament={t}
                        isInSchedule={scheduleIds.has(t.id)}
                        isPast={day < today}
                        onExpand={() => setActivated((prev) => new Set(prev).add(t.id))}
                      />
                    )))}
                  </div>
                ))}
              </WholeRows>
            )}
          </div>
        );
      })}

      {list && list.length > 0 && (
        <div className="batch-recent">
          <div className="dashboard-section-header">
            <div className="dashboard-section-title">Recent Alerts</div>
          </div>
          {list.map((b) => (
            <button key={b.id} className={'batch-recent-row' + (b.id === shownId ? ' is-current' : '')} onClick={() => onSelectBatch(b.id)}>
              <span className="batch-recent-title">{b.title}</span>
              <span className="batch-recent-meta">{plural(b.eventCount, 'event', 'events')} &middot; {when(b.created_at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
