/* Friends' breaks and dinner breaks, and how they line up with yours (owner, 2026-11-19: "show connected
   friends' breaks/dinner breaks and how they align"). Pure, so it is tested without a clock
   (__tests__/break-align.test.mjs); HomeFriends draws it.

   What a room clock tells of breaks (utils/live-clocks.js answers, server lib/live-clocks.js):
   - WSOP+ publishes the structure, so every break ahead with its length (`breaks`: [{ inMins, mins }]) and the
     length of one on now (`breakMins`);
   - PokerAtlas and Bravo say only when the next break starts (`minsToBreak`): its length is not known, and is
     never guessed.
   Nothing names a dinner break: a break of DINNER_MINS or more is one. */

export const DINNER_MINS = 45;
const MIN = 60000;

/** A room clock's breaks as windows on this device's clock, soonest first: { start, end, mins, dinner, now }.
 *  `end` and `mins` are null when the room does not say how long. A break on now ends `remainingSecs` after the
 *  answer arrived. A clock that is not running (or paused) has none. */
export function breakWindows(c, now = Date.now()) {
  if (!c || (c.state !== 'running' && c.state !== 'paused')) return [];
  const at = Number.isFinite(c.receivedAt) ? c.receivedAt : now;
  const out = [];
  if (c.onBreak && Number.isFinite(Number(c.remainingSecs)) && c.remainingSecs != null) {
    const end = at + Number(c.remainingSecs) * 1000;
    if (end > now) {
      const mins = Number(c.breakMins) || null;
      out.push({ start: mins ? Math.min(now, end - mins * MIN) : now, end, mins, dinner: !!mins && mins >= DINNER_MINS, now: true });
    }
  }
  const list = Array.isArray(c.breaks) && c.breaks.length ? c.breaks
    : !c.onBreak && Number.isFinite(Number(c.minsToBreak)) && c.minsToBreak != null ? [{ inMins: Number(c.minsToBreak), mins: null }] : [];
  for (const b of list) {
    if (!b || !Number.isFinite(Number(b.inMins))) continue;
    const start = at + Number(b.inMins) * MIN;
    const mins = Number(b.mins) || null;
    const end = mins ? start + mins * MIN : null;
    if ((end ?? start) < now) continue;
    out.push({ start, end, mins, dinner: !!mins && mins >= DINNER_MINS, now: start <= now });
  }
  return out.sort((a, b) => a.start - b.start);
}

const overlap = (a, b) => (a.end != null && b.end != null ? Math.min(a.end, b.end) - Math.max(a.start, b.start) : -Infinity);

/** How a friend's breaks meet yours. The first of theirs that shares a minute or more with one of yours
 *  ('overlap'), or, where a length is unknown, starts within 5 minutes of yours ('same-start'); else their next
 *  against the nearest of yours ('apart', diffMins > 0 when theirs is later); 'theirs' when you have none. */
export function alignBreaks(mine, theirs) {
  const m = Array.isArray(mine) ? mine : [];
  const t = Array.isArray(theirs) ? theirs : [];
  for (const b of t) {
    for (const a of m) {
      const o = overlap(a, b);
      if (o >= MIN) return { kind: 'overlap', mine: a, theirs: b, overlapMins: Math.round(o / MIN), from: Math.max(a.start, b.start), to: Math.min(a.end, b.end) };
      if ((a.end == null || b.end == null) && Math.abs(a.start - b.start) <= 5 * MIN) return { kind: 'same-start', mine: a, theirs: b };
    }
  }
  if (!t.length) return null;
  const first = t[0];
  if (!m.length) return { kind: 'theirs', theirs: first };
  let near = m[0];
  for (const a of m) if (Math.abs(a.start - first.start) < Math.abs(near.start - first.start)) near = a;
  return { kind: 'apart', mine: near, theirs: first, diffMins: Math.round((first.start - near.start) / MIN) };
}

export const clockTime = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** One short line for a friend's row: "break 6:40 PM, with yours", "dinner 7:45 PM, 45 min with yours",
 *  "on break, 12 min left", "break 6:55 PM, 15 min after yours", "break 6:40 PM". */
export function breakNote(a, now = Date.now(), fmt = clockTime) {
  if (!a) return null;
  const b = a.theirs;
  const what = b.dinner ? 'dinner' : 'break';
  if (b.now) {
    const left = b.end != null ? Math.max(1, Math.round((b.end - now) / MIN)) : null;
    const withYou = a.kind === 'overlap' && a.mine.now ? ', with you' : '';
    return left != null ? `on ${what}, ${left} min left${withYou}` : `on ${what}${withYou}`;
  }
  const at = `${what} ${fmt(b.start)}`;
  switch (a.kind) {
    case 'overlap': {
      const whole = b.mins != null && a.overlapMins >= b.mins - 1 && a.mine.mins != null && a.overlapMins >= a.mine.mins - 1;
      return whole ? `${at}, with yours` : `${at}, ${a.overlapMins} min with yours`;
    }
    case 'same-start': return `${at}, as yours`;
    case 'apart': {
      const d = a.diffMins;
      if (!d) return `${at}, as yours`;
      return `${at}, ${Math.abs(d) >= 120 ? Math.round(Math.abs(d) / 60) + ' h' : Math.abs(d) + ' min'} ${d > 0 ? 'after' : 'before'} yours`;
    }
    default: return at;
  }
}

/** The timeline: who has breaks in the window from now, each as blocks in percent of it (left, width), a
 *  friend's time shared with yours marked, and the hour ticks. A break of unknown length is a mark at its
 *  start (`open`). The window runs at least `minHours` and stretches, up to `maxHours`, to take in the first
 *  dinner break anyone has. */
export function breakTimeline(people, now = Date.now(), { minHours = 3, maxHours = 6, fmt = clockTime } = {}) {
  const all = (people || []).filter((p) => p && p.windows && p.windows.length);
  if (!all.length) return null;
  let span = minHours * 60 * MIN;
  const dinner = all.flatMap((p) => p.windows).filter((w) => w.dinner).sort((x, y) => x.start - y.start)[0];
  if (dinner) span = Math.min(maxHours * 60 * MIN, Math.max(span, (dinner.end ?? dinner.start) - now + 15 * MIN));
  const end = now + span;
  const pct = (ms) => Math.max(0, Math.min(100, ((ms - now) / span) * 100));
  const mine = (all.find((p) => p.me) || {}).windows || [];
  const rows = all.map((p) => {
    const blocks = p.windows.filter((w) => w.start < end).map((w) => {
      const left = pct(w.start);
      if (w.end == null) return { left, width: 0, open: true, dinner: false, now: w.now };
      return { left, width: Math.max(0.5, pct(w.end) - left), open: false, dinner: w.dinner, now: w.now };
    });
    const shared = p.me ? [] : p.windows.flatMap((w) => mine.map((m) => {
      const o = overlap(m, w);
      if (o < MIN) return null;
      const from = Math.max(m.start, w.start), to = Math.min(m.end, w.end);
      if (from >= end) return null;
      return { left: pct(from), width: Math.max(0.5, pct(to) - pct(from)) };
    })).filter(Boolean);
    return { key: p.key, name: p.name, me: !!p.me, blocks, shared };
  }).filter((r) => r.blocks.length);
  if (!rows.length) return null;
  const ticks = [];
  const first = new Date(now);
  first.setMinutes(60, 0, 0); // the next whole hour
  for (let t = first.getTime(); t < end; t += 60 * MIN) {
    const left = pct(t);
    // Clear of the "Now" at the left edge and of the card's right edge.
    if (left > 15 && left < 90) ticks.push({ left, label: fmt(t).replace(':00', '') });
  }
  return { rows, ticks, hours: Math.round(span / (60 * MIN)) };
}
