'use strict';
/*
 * Subscribe to My Schedule in Apple, Google or Outlook Calendar (Features 1, 2026-11-11).
 *
 *   calendar_tokens (token, user_id, created_at, revoked_at): a private, revocable link per account, never
 *     the share token or a JWT. New link revokes the old; Turn off revokes it and makes none.
 *   GET /cal/<token>.ics: the player's saved events as iCalendar. Each event in UTC (the room's own zone,
 *     tournaments.timezone, converted; a row without one is read as the room's usual zone), ending at the
 *     late-reg close where the feed says when (a clock time, or "Level N" with the level length), else 8
 *     hours after the start. The room and its series as LOCATION; buy-in, bullets and the If I bust / If I
 *     bag plan in DESCRIPTION; an event behind a plan not yet decided is TENTATIVE. Travel Day and Day
 *     Off are all-day. A UID per (account, event), so an edit updates the entry in place.
 *   Calendar apps poll on their own schedule (Google can take hours), so the copy promises no minutes.
 */
const crypto = require('crypto');
const { normaliseDate } = require('./analytics');

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS calendar_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_calendar_tokens_user ON calendar_tokens(user_id)');
}

function rows(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

const WEST = /vegas|reno|los angeles|commerce|bicycle|hustler|gardens|hawaiian|california|arizona|phoenix|wildhorse|seattle|portland|san diego|san jose|bay 101|lucky chances|thunder valley|talking stick/i;
const CENTRAL = /texas|austin|houston|dallas|chicago|choctaw|winstar|tunica|new orleans|bossier|minneapolis|canterbury|st\.? louis|kansas city|oklahoma|tulsa|iowa|nebraska|wisconsin|milwaukee|potawatomi/i;

function zoneOf(t) {
  if (t.timezone && /^[A-Za-z_]+\/[A-Za-z_/+-]+$/.test(t.timezone)) return t.timezone;
  const v = `${t.venue || ''} ${t.property || ''}`;
  if (WEST.test(v)) return 'America/Los_Angeles';
  if (CENTRAL.test(v)) return 'America/Chicago';
  return 'America/New_York';
}

/** Minutes after midnight for "7:00 PM", "19:00", "11 AM"; null for TBD. */
function clockMinutes(s) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?\s*$/i.exec(String(s || '')) || /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s || ''));
  if (!m) return null;
  let h = Number(m[1]) % 24;
  const min = Number(m[2] || 0);
  if (m[3]) { const pm = /p/i.test(m[3]); h = (h % 12) + (pm ? 12 : 0); }
  return h * 60 + min;
}

/** The UTC instant of a wall-clock time in an IANA zone. */
function zonedToUtc(day, minutes, tz) {
  const [y, mo, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  const offsetAt = (ms) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    return asUtc - ms;
  };
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms);
  return ms;
}

/** When late reg closes, from the feed's words, as an instant; null when it does not say. */
function lateRegClose(t, startMs, startMin, day, tz) {
  const s = String(t.late_reg_end || '').trim();
  if (!s) return null;
  const lv = /level\s*(\d{1,2})/i.exec(s);
  const len = Number(String(t.level_duration || '').replace(/[^\d.]/g, '')) || 0;
  if (lv && len) return startMs + Number(lv[1]) * len * 60e3;
  const cm = clockMinutes(s.replace(/^(end|close)s?\s*(at)?\s*/i, ''));
  if (cm != null) {
    let ms = zonedToUtc(day, cm, tz);
    if (ms <= startMs) ms += 864e5;
    return ms;
  }
  return null;
}

const fold = (line) => {
  const out = [];
  let s = line;
  while (Buffer.byteLength(s, 'utf8') > 74) {
    let n = 74;
    while (Buffer.byteLength(s.slice(0, n), 'utf8') > 74) n -= 1;
    out.push(s.slice(0, n));
    s = ' ' + s.slice(n);
  }
  out.push(s);
  return out.join('\r\n');
};
const esc = (v) => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dayStamp = (day) => day.replace(/-/g, '');

function money(n, cur) {
  const v = Number(n) || 0;
  const sym = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$' }[String(cur || 'USD').toUpperCase()] || '';
  return sym ? `${sym}${v.toLocaleString('en-US')}` : `${v.toLocaleString('en-US')} ${cur}`;
}

function buildIcs(db, userId, now = Date.now()) {
  const list = rows(db, `SELECT t.*, us.planned_entries, us.not_played FROM user_schedules us JOIN tournaments t ON t.id = us.tournament_id
    WHERE us.user_id = ? ORDER BY t.date, t.time`, [Number(userId)]);
  let conds = [];
  try {
    conds = rows(db, `SELECT c.*, d.event_name AS dep_name, d.date AS dep_date FROM schedule_conditions c
      LEFT JOIN tournaments d ON d.id = c.depends_on_tournament_id WHERE c.user_id = ?`, [Number(userId)]);
  } catch (_) { /* no plans table */ }
  const condBy = new Map();
  for (const c of conds) { if (!condBy.has(c.tournament_id)) condBy.set(c.tournament_id, []); condBy.get(c.tournament_id).push(c); }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//futurega.me//My Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:My Schedule · futurega.me', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  const since = new Date(now - 30 * 864e5).toISOString().slice(0, 10);
  for (const t of list) {
    const day = normaliseDate(t.date);
    if (!day || day < since) continue;
    if (t.venue === 'Personal' && t.event_name === "Didn't play") continue;
    const uid = `fg-${userId}-${t.id}@futurega.me`;
    const ev = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp(now)}`];
    if (t.venue === 'Personal') {
      const next = new Date(Date.parse(day + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
      ev.push(`DTSTART;VALUE=DATE:${dayStamp(day)}`, `DTEND;VALUE=DATE:${dayStamp(next)}`, `SUMMARY:${esc(t.event_name || 'Personal')}`, 'TRANSP:TRANSPARENT');
    } else {
      const tz = zoneOf(t);
      const startMin = clockMinutes(t.time);
      if (startMin == null) continue;
      const startMs = zonedToUtc(day, startMin, tz);
      const endMs = lateRegClose(t, startMs, startMin, day, tz) || (startMs + 8 * 3600e3);
      const bullets = Number(t.planned_entries) || 1;
      const plan = (condBy.get(t.id) || []).map((c) => {
        const kind = /bag|advance/i.test(c.condition_type || '') ? 'If I bag' : /profit|win|cash/i.test(c.condition_type || '') ? 'If I cash' : 'If I bust';
        return `Plan: ${kind} ${c.dep_name || 'the event before'}`;
      });
      const desc = [
        `Buy-in ${money(t.buyin, t.currency)}${bullets > 1 ? ` · up to ${bullets} bullets` : ''}`,
        t.late_reg_end ? `Late reg: ${t.late_reg_end}` : null,
        ...plan,
        'From futurega.me — edits there update this entry.',
      ].filter(Boolean).join('\n');
      ev.push(`DTSTART:${stamp(startMs)}`, `DTEND:${stamp(Math.max(endMs, startMs + 3600e3))}`,
        `SUMMARY:${esc((t.event_number ? `#${t.event_number} ` : '') + (t.event_name || 'Tournament'))}`,
        `LOCATION:${esc([t.property, t.venue].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · '))}`,
        `DESCRIPTION:${esc(desc)}`);
      // Waiting on a plan (it runs only if an earlier event goes one way): tentative until decided.
      const today = new Date(now).toISOString().slice(0, 10);
      const waiting = (condBy.get(t.id) || []).some((c) => c.depends_on_tournament_id && (normaliseDate(c.dep_date) || '9') >= today);
      ev.push(`STATUS:${waiting ? 'TENTATIVE' : 'CONFIRMED'}`);
    }
    ev.push('END:VEVENT');
    lines.push(...ev);
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

function liveToken(db, userId) {
  const r = rows(db, 'SELECT token FROM calendar_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1', [Number(userId)]);
  return r.length ? r[0].token : null;
}

function mint(db, userId) {
  db.run('UPDATE calendar_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Date.now(), Number(userId)]);
  const token = crypto.randomBytes(18).toString('base64url');
  db.run('INSERT INTO calendar_tokens (token, user_id, created_at) VALUES (?, ?, ?)', [token, Number(userId), Date.now()]);
  return token;
}

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered, siteUrl, publicLimiter }) {
  const urls = (t) => {
    const https = `${siteUrl()}/cal/${t}.ics`;
    const webcal = https.replace(/^https?:/, 'webcal:');
    return { token: t, url: https, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
  };
  app.get('/api/calendar-feed', authenticateToken, requireRegistered, (req, res) => {
    const t = liveToken(getDb(), req.user.id);
    res.json(t ? { on: true, ...urls(t) } : { on: false });
  });
  app.post('/api/calendar-feed', authenticateToken, requireRegistered, async (req, res) => {
    const t = mint(getDb(), req.user.id);
    await saveDatabase();
    res.json({ on: true, ...urls(t) });
  });
  app.delete('/api/calendar-feed', authenticateToken, requireRegistered, async (req, res) => {
    getDb().run('UPDATE calendar_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Date.now(), req.user.id]);
    await saveDatabase();
    res.json({ on: false });
  });
  app.get('/cal/:file', publicLimiter || ((req, res, next) => next()), (req, res) => {
    const m = /^([A-Za-z0-9_-]{10,40})\.ics$/.exec(String(req.params.file || ''));
    if (!m) return res.status(404).type('text/plain').send('Not found');
    const db = getDb();
    const r = rows(db, 'SELECT user_id FROM calendar_tokens WHERE token = ? AND revoked_at IS NULL', [m[1]]);
    if (!r.length) return res.status(404).type('text/plain').send('This calendar link was turned off. Make a new one in My Schedule › Export.');
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
    res.send(buildIcs(db, r[0].user_id));
  });
}

module.exports = { migrate, buildIcs, zonedToUtc, clockMinutes, lateRegClose, zoneOf, mountRoutes };
