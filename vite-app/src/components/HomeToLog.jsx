import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { getVenueInfo, getVenueBrandColor, formatBuyin, parseTournamentTime, getNow } from '../utils/utils.js';
import { awaitingResults, eventNo, dayName } from '../utils/home.js';
import { useToast } from '../contexts/ToastContext.jsx';

// ── The home's To log (verdict section 2) ──────────────────────────────────────────────────
// Events that are over with no result logged (utils/home.js awaitingResults), newest first: the
// two newest as rows, and "+N more", which shows every one of them here, in place, with the same
// answers ("Fewer" folds it back to two). It used to open Results, whose Awaiting card only ever
// shows the newest, so the rest could not be reached at all. A branch of a plan that resolved off
// (Up Next's resolveConditions: "If bag #12" after #12 busted on Day 1) is not asked about: the
// app knows it was never played. Each row is the event's venue strip with its day ("BORGATA ·
// YESTERDAY") over one line ("#10 $600 PLO 8-Max") and the answers, each on its own column so they
// line up from row to row (an answer a row does not offer leaves its column empty):
//   Busted       logs a no-cash result in one tap: bullets from the bust's live update (else 1),
//                the place and field when the bust's Finish recorded them. Not offered when that
//                update carries a deal's payout (a chop is a cash);
//   Cashed       opens the result form in Results, prefilled (bullets, a deal's place and payout,
//                the field);
//   Didn't play  clears the row (user_schedules.not_played, synced across devices). Not offered
//                for an event with any live update (a bust, or a Start the player forgot to bust
//                out of): the live record says it was played.
// Busted and Didn't play turn the row, where it is, into what was done and an Undo for a few
// seconds: a second tap of a double tap lands on that row's text, not on the next event's Busted
// (it did, before: the row left at once and the next one slid under the finger). Undo deletes the
// result just logged, or clears the flag. A held row still counts as one of the two shown, so the
// section keeps its height through the hold and the next event slides in only when it ends.
// Every number further down the home is only as true as the log, and players forget busts, not
// cashes: Bust and Finish on the Up Next card post live updates and stay that.
// Writes never edit a result: POST /api/tracking with ifAbsent is a 409 when one exists (logged on
// another device, or by the live-update Finish). The section takes no room when nothing waits.

const SHOWN = 2;          // rows on the home until "+N more" shows the rest
const HOLD_MS = 8000;     // how long a row stays as "done, Undo" after Busted or Didn't play
const SETTLE_MS = 600;    // an Undo tap this soon after the row changed is the double tap's second half

const labelOf = (e) => [eventNo(e.event_number), e.event_name].filter(Boolean).join(' ');
const plural = (n) => `${n} bullet${n === 1 ? '' : 's'}`;

// The row's line: the number, the cost and the name. The day is on the strip above it, so the
// 18g line holds the name ('#14 $1,100 PLO 6-Max Mystery Bounty').
function rowText(item) {
  const e = item.event;
  const price = formatBuyin(e.buyin, e.venue);
  const cost = item.bullets > 1 ? `${item.bullets} × ${price}` : price;
  return [eventNo(e.event_number), cost, e.event_name].filter(Boolean).join(' ');
}

// The venue strip, its name and the day ('BORGATA SPRING POKER OPEN · YESTERDAY'), centred: a long
// name truncates, the day never does.
function Strip({ event, today }) {
  const v = getVenueInfo(event.venue, event.property);
  const day = dayName(event.date, today);
  return (
    <div className="hm-tolog-strip" style={{ background: getVenueBrandColor(v.abbr) }}>
      <span className="hm-tolog-strip-t">{v.longName || v.abbr}</span>
      {day && <span className="hm-tolog-strip-d">{` · ${day}`}</span>}
    </div>
  );
}

// An answer column a row does not offer: its hairline only, so the next row's answers line up.
// quiet: the 5g Didn't play column.
const Gap = ({ quiet = false }) => <span className={'hm-tolog-gap' + (quiet ? ' hm-tolog-gap--quiet' : '')} aria-hidden="true" />;

export default function HomeToLog({ schedule, results, updates, plans = null, today, canLog = true, onAddTracking, onDeleteTracking, onSetPlayed, onLog }) {
  const toast = useToast();
  const [all, setAll] = useState(false);                    // "+N more": every row, in place
  const listId = useId();
  const [busy, setBusy] = useState(() => new Set());        // ids with a request in flight
  const [logged, setLogged] = useState(() => new Set());    // logged here; the refetch is on its way
  // Rows turned into "done, Undo": [{ id, item, kind: 'busted' | 'skipped', index, at, entryId? }].
  const [held, setHeld] = useState([]);
  const timers = useRef(new Set());
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);
  // The tap guard. State lands on the next render, so two taps inside one frame both saw an idle
  // row; a ref is claimed at once.
  const inflight = useRef(new Set());
  const claim = (id) => { if (inflight.current.has(id)) return false; inflight.current.add(id); return true; };
  const release = (id) => { inflight.current.delete(id); };
  const setFlag = (set, id, on) => set((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  // now: a Start updated in the last 18 h is still being played whatever its day (playingEnded).
  // Bucketed to the minute with the home's own clock, so a row comes in when that runs out.
  const nowMinute = Math.floor(getNow() / 60000);
  const items = useMemo(() => awaitingResults(schedule, results, updates, {
    today, now: nowMinute * 60000, logged: [...logged], startOf: parseTournamentTime, plans,
  }), [schedule, results, updates, today, nowMinute, logged, plans]);

  const drop = (id) => setHeld((h) => h.filter((x) => x.id !== id));
  const hold = (entry) => {
    setHeld((h) => [...h.filter((x) => x.id !== entry.id), entry]);
    const t = setTimeout(() => { timers.current.delete(t); drop(entry.id); }, HOLD_MS);
    timers.current.add(t);
  };
  const indexOf = (id) => Math.max(0, items.findIndex((x) => x.id === id));

  const busted = async (item) => {
    const id = item.id;
    if (logged.has(id) || (results || []).some((r) => Number(r.tournament_id) === id)) return;
    if (!claim(id)) return;
    const index = indexOf(id);
    setFlag(setBusy, id, true);
    const res = await onAddTracking({
      tournamentId: id,
      numEntries: item.bullets,
      cashed: false,
      cashAmount: 0,
      finishPlace: item.busted ? item.place : null,
      notes: null,
      totalFieldSize: item.busted && item.update && Number(item.update.total_entries) ? Number(item.update.total_entries) : null,
      ifAbsent: true,
    });
    release(id);
    setFlag(setBusy, id, false);
    if (res && res.ok) {
      setFlag(setLogged, id, true);
      hold({ id, item, kind: 'busted', index, at: Date.now(), entryId: res.id });
    } else if (res && res.status === 409) {
      setFlag(setLogged, id, true);
      toast?.info(`${labelOf(item.event)} already has a result`);
    } else toast?.error(`Could not log ${labelOf(item.event)}`);
  };

  const cashed = (item) => onLog({
    kind: 'tournament',
    tournamentId: item.id,
    event: item.event,
    prefill: {
      numEntries: item.bullets,
      cashed: true,
      finishPlace: item.place || '',
      cashAmount: item.payout || '',
      totalEntries: item.field || '',
    },
  });

  const notPlayed = async (item) => {
    const id = item.id;
    if (!claim(id)) return;
    const index = indexOf(id);
    setFlag(setBusy, id, true);
    const ok = await onSetPlayed(id, true);
    release(id);
    setFlag(setBusy, id, false);
    if (ok) hold({ id, item, kind: 'skipped', index, at: Date.now() });
    else toast?.error('Could not clear the row');
  };

  const undo = async (h) => {
    if (Date.now() - h.at < SETTLE_MS) return;
    if (!claim(h.id)) return;
    setFlag(setBusy, h.id, true);
    let ok = false;
    if (h.kind === 'skipped') ok = await onSetPlayed(h.id, false);
    else if (h.entryId && onDeleteTracking) ok = await onDeleteTracking(h.entryId);
    release(h.id);
    setFlag(setBusy, h.id, false);
    if (!ok) { toast?.error('Could not undo'); return; }
    if (h.kind === 'busted') setFlag(setLogged, h.id, false);
    drop(h.id);
  };

  if (!canLog) return null;
  const heldIds = new Set(held.map((x) => x.id));
  const rows = items.filter((x) => !heldIds.has(x.id));
  if (!rows.length && !held.length) return null;
  // The rows on show, with every held row back at the place it had, so nothing moves under a tap.
  // A held row takes one of the SHOWN places: the section stays its height through the hold, and
  // the next event comes in when the hold ends (it used to come in at once, and everything below
  // To log dropped a row and came back up 8 s later).
  const room = all ? rows.length : Math.max(0, SHOWN - held.length);
  const shown = rows.slice(0, room).map((item) => ({ item }));
  for (const h of [...held].sort((a, b) => a.index - b.index)) shown.splice(Math.min(h.index, shown.length), 0, { held: h });
  const more = rows.length - Math.min(rows.length, room);
  const folds = rows.length + held.length > SHOWN;          // there is more than the two to fold

  return (
    <section className="dashboard-section hm-tolog" aria-label="To log">
      <div className="dashboard-section-header">
        <div className="dashboard-section-title">To log</div>
        {(all ? folds : more > 0) && (
          <button type="button" className="hm-head-pill hm-head-pill--wide" onClick={() => setAll((a) => !a)}
            aria-expanded={all} aria-controls={listId}
            aria-label={all ? 'Show only the newest two' : `Show ${more} more to log`}>
            <span className="hm-hp-t">{all ? 'Fewer' : `+${more} more`}</span>
          </button>
        )}
      </div>
      <ul className="hm-tolog-list" id={listId}>
        {shown.map(({ item, held: h }) => {
          if (h) {
            const what = h.kind === 'busted' ? `Logged: no cash, ${plural(h.item.bullets)}` : 'Not played';
            return (
              <li key={'held-' + h.id} className="hm-tolog-row is-held" aria-live="polite">
                <Strip event={h.item.event} today={today} />
                <div className="hm-tolog-body">
                  <span className="hm-tolog-text hm-cell hm-f-sm">
                    <span className="hm-clip"><span className="hm-tolog-muted">{what} </span>{labelOf(h.item.event)}</span>
                  </span>
                  <button type="button" className="hm-tolog-seg hm-tolog-seg--undo" disabled={busy.has(h.id)}
                    onClick={() => undo(h)}
                    aria-label={h.kind === 'busted' ? `Undo: delete the result just logged for ${h.item.event.event_name}` : `Undo: ask for ${h.item.event.event_name}'s result again`}>
                    <span className="hm-seg-t">Undo</span>
                  </button>
                </div>
              </li>
            );
          }
          const e = item.event;
          const wait = busy.has(item.id);
          const name = e.event_name || 'this event';
          return (
            <li key={item.id} className="hm-tolog-row">
              <Strip event={e} today={today} />
              <div className="hm-tolog-body">
                <span className="hm-tolog-text hm-cell hm-f-sm" title={rowText(item)}><span className="hm-clip">{rowText(item)}</span></span>
                {/* A bust whose update carries a deal's payout was a chop, a cash: no one-tap
                    no-cash answer for it, only Cashed (prefilled with the deal). */}
                {item.payout > 0 ? <Gap /> : (
                  <button type="button" className="hm-tolog-seg" disabled={wait} aria-busy={wait || undefined}
                    onClick={() => busted(item)}
                    aria-label={`Busted: log ${name} as no cash, ${plural(item.bullets)}`}
                    title={`Log a no-cash result, ${plural(item.bullets)}`}>
                    <span className="hm-seg-t">Busted</span>
                  </button>
                )}
                <button type="button" className="hm-tolog-seg" disabled={wait}
                  onClick={() => cashed(item)}
                  aria-label={`Cashed: log ${name}'s cash in Results`}>
                  <span className="hm-seg-t">Cashed</span>
                </button>
                {/* Played, as the live record says (a bust, or a Start never busted out of): no
                    "Didn't play" for it, its column left empty. */}
                {item.busted || item.update ? <Gap quiet /> : (
                  <button type="button" className="hm-tolog-seg hm-tolog-seg--quiet" disabled={wait}
                    onClick={() => notPlayed(item)}
                    aria-label={`Didn't play ${name}: stop asking for its result`}>
                    <span className="hm-seg-t hm-seg-t--2">Didn&rsquo;t</span>
                    <span className="hm-seg-t hm-seg-t--2">play</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
