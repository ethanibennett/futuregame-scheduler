'use strict';
/*
 * First-party growth measurement (launch plan, action 5; 2026-10-15). No SDK, no ATT prompt: the
 * server counts what the plan's KPIs need from its own tables.
 *
 *   growth_events  one row per moment that matters, never deleted by the thing it records:
 *                  'signup'    data { ct, landing, ref, src, heard, platform }, the first touch the
 *                              browser kept (vite-app utils/live-page.js rememberSource) and the
 *                              sign-up form's "How did you hear about us?"
 *                  'activated' the first event saved to My Schedule, once per account, so a later
 *                              delete cannot erase it (the plan's activation KPI)
 *                  'onboarded', 'result_logged', 'share_sent', 'followed': the first time an account
 *                              finished setup, logged a tournament result, took its schedule's share
 *                              link, and sent a buddy request (once each; the scorecard's rates)
 *   user_days      (user_id, day): an account was active that UTC day (any signed-in request);
 *                  D7 = any day 7-13 after sign-up, D30 = any day 28-34.
 *
 * report(db) is the weekly cohort table: per sign-up week (Monday, UTC), sign-ups, activated within
 * 7 days, D7 and D30 retention (each only once the cohort is old enough to have it), by source.
 * GET /api/admin/growth serves it to app admins.
 *
 * scorecard(db) is the Monday scorecard (launch plan v2, sections 7 and 12): last week's new accounts
 * and each cohort figure from the newest week old enough to have it, against the day-90 KPIs, with the
 * week's ad spend the owner enters per channel (growth_spend) for the cost per activated user. What only
 * the ad platforms and App Store Connect know is listed with where to read it. GET /api/admin/growth/
 * scorecard and PUT /api/admin/growth/spend, app admins.
 */

const HEARD = ['instagram', 'facebook', 'reddit', 'tiktok', 'youtube', 'friend', 'room', 'appstore', 'search', 'press', 'podcast', 'other'];
const DAY = 864e5;

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS growth_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    at INTEGER NOT NULL,
    data TEXT
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_growth_events_user ON growth_events(user_id, kind)');
  // Ad spend per week and channel, as the owner reads it off each platform (whole cents).
  db.run(`CREATE TABLE IF NOT EXISTS growth_spend (
    week TEXT NOT NULL,
    channel TEXT NOT NULL,
    cents INTEGER NOT NULL,
    PRIMARY KEY (week, channel)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS user_days (
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  )`);
}

const tag = (v, max = 40) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9._-]{1,40}$/.test(s) ? s.slice(0, max) : null;
};
const host = (v) => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /^[a-z0-9.-]{1,80}$/.test(s) ? s : null;
};

/** The sign-up's source, from the client's body.source; unknown or malformed fields are dropped. */
function cleanSource(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {
    ct: tag(r.ct), landing: tag(r.landing), ref: host(r.ref), src: tag(r.src),
    // UTM tags from any landing (launch plan §13 naming: utm_source meta, utm_campaign 2701-midatl, ...).
    // Click ids (fbclid, gclid) are NOT kept: they only matter if sent back to an ad platform, which
    // would be tracking, and the app ships none.
    utm_source: tag(r.utm_source), utm_medium: tag(r.utm_medium), utm_campaign: tag(r.utm_campaign), utm_content: tag(r.utm_content),
    heard: HEARD.includes(r.heard) ? r.heard : null,
    platform: ['ios', 'android', 'web'].includes(r.platform) ? r.platform : null,
    // An invite link's sign-up (Features 37): who invited them.
    inviter: Number.isInteger(r.inviter) && r.inviter > 0 ? r.inviter : null,
  };
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return out;
}

function recordSignup(db, userId, source, now = Date.now()) {
  if (!userId) return;
  db.run('INSERT INTO growth_events (user_id, kind, at, data) VALUES (?, ?, ?, ?)',
    [userId, 'signup', now, JSON.stringify(cleanSource(source))]);
  touchDay(db, userId, now);
}

/** Records `kind` for the account the first time only; true when it wrote. */
function recordOnce(db, userId, kind, data = null, now = Date.now()) {
  if (!userId) return false;
  const r = db.exec('SELECT 1 FROM growth_events WHERE user_id = ? AND kind = ? LIMIT 1', [userId, kind]);
  if (r[0] && r[0].values.length) return false;
  db.run('INSERT INTO growth_events (user_id, kind, at, data) VALUES (?, ?, ?, ?)', [userId, kind, now, data ? JSON.stringify(data) : null]);
  return true;
}

// Active days: one INSERT per account per day, remembered in memory so a busy session costs one write.
const seen = new Set();
let seenDay = '';
function touchDay(db, userId, now = Date.now()) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return;
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== seenDay) { seen.clear(); seenDay = day; }
  const key = `${id}:${day}`;
  if (seen.has(key)) return;
  seen.add(key);
  try { db.run('INSERT OR IGNORE INTO user_days (user_id, day) VALUES (?, ?)', [id, day]); } catch { /* table not there yet */ }
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
function mondayOf(ms) {
  const d = new Date(ms);
  const back = (d.getUTCDay() + 6) % 7;
  return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
}
const rows = (db, sql, p = []) => { const r = db.exec(sql, p); return r[0] ? r[0].values : []; };

/* The paid channels (launch plan section 10). A sign-up is paid when an Apple Ads install names its
   campaign, its UTM medium is 'paid', or its App Store / landing ct starts with a paid channel
   ("meta-ad02-phl-2701"). Everything else, "How did you hear" included, is organic. */
const SPEND_CHANNELS = ['apple', 'meta', 'creators', 'podcasts', 'reddit', 'x', 'other'];
const PAID_CT = new Set(['apple', 'meta', 'reddit', 'x', 'tiktok']);
function isPaid(src, aa) {
  if (aa && aa.campaignId != null) return true;
  if (src.utm_medium === 'paid') return true;
  const head = String(src.ct || '').toLowerCase().split(/[-_.]/)[0];
  return PAID_CT.has(head);
}

const TOTAL_KEYS = ['signups', 'activated7', 'd1', 'd7', 'd30', 'd1Ready', 'd7Ready', 'd30Ready', 'onboarded7', 'results7', 'shared7', 'followed7', 'savesFirst7', 'paid', 'paidActivated7'];

/**
 * The weekly cohort table. Accounts with a 'signup' event (every account made since this shipped);
 * older ones have no source and are left out rather than guessed. { weeks: [{ week, signups,
 * activated7, d7, d30, d7Ready, d30Ready, sources: { [source]: signups } }], totals }.
 */
function report(db, { now = Date.now(), weeks = 13 } = {}) {
  const since = now - weeks * 7 * DAY;
  const signups = rows(db, "SELECT user_id, at, data FROM growth_events WHERE kind = 'signup' AND at >= ? ORDER BY at", [since]);
  const activated = new Map(rows(db, "SELECT user_id, at FROM growth_events WHERE kind = 'activated'"));
  const firstOf = (kind) => new Map(rows(db, 'SELECT user_id, MIN(at) FROM growth_events WHERE kind = ? GROUP BY user_id', [kind]));
  // An Apple Ads install (lib/attribution.js) names its campaign; it outranks a self-reported answer.
  const appleAds = new Map(rows(db, "SELECT user_id, data FROM growth_events WHERE kind = 'apple_ads'").map(([u, d]) => { try { return [u, JSON.parse(d)]; } catch { return [u, {}]; } }));
  const moments = { onboarded7: firstOf('onboarded'), results7: firstOf('result_logged'), shared7: firstOf('share_sent'), followed7: firstOf('followed') };
  // Saves in the first 7 days (user_schedules.added_at is SQLite's UTC 'YYYY-MM-DD HH:MM:SS').
  const savesByUser = new Map();
  try {
    for (const [uid, added] of rows(db, 'SELECT user_id, added_at FROM user_schedules')) {
      const ms = Date.parse(String(added || '').replace(' ', 'T') + 'Z');
      if (!Number.isFinite(ms)) continue;
      if (!savesByUser.has(uid)) savesByUser.set(uid, []);
      savesByUser.get(uid).push(ms);
    }
  } catch { /* no user_schedules table (tests) */ }
  const days = new Map();
  for (const [uid, day] of rows(db, 'SELECT user_id, day FROM user_days WHERE day >= ?', [isoDay(since)])) {
    if (!days.has(uid)) days.set(uid, new Set());
    days.get(uid).add(day);
  }
  const activeBetween = (uid, start, from, to) => {
    const set = days.get(uid);
    if (!set) return false;
    for (let k = from; k <= to; k++) if (set.has(isoDay(start + k * DAY))) return true;
    return false;
  };
  const byWeek = new Map();
  for (const [uid, at, data] of signups) {
    let src = {};
    try { src = JSON.parse(data || '{}') || {}; } catch { src = {}; }
    const aa = appleAds.get(uid);
    const source = src.ct || (aa && aa.campaignId != null ? 'apple-ads/' + aa.campaignId : null) || (src.utm_source ? src.utm_source + (src.utm_campaign ? '/' + src.utm_campaign : '') : null)
      || src.heard || src.src || (src.ref ? `ref:${src.ref}` : 'unknown');
    const week = mondayOf(at);
    if (!byWeek.has(week)) byWeek.set(week, { week, ...Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0])), sources: {} });
    const w = byWeek.get(week);
    w.signups += 1;
    w.sources[source] = (w.sources[source] || 0) + 1;
    const paid = isPaid(src, aa);
    if (paid) w.paid += 1;
    const act = activated.get(uid);
    if (act != null && act - at <= 7 * DAY) {
      w.activated7 += 1;
      if (paid) w.paidActivated7 += 1;
      w.savesFirst7 += (savesByUser.get(uid) || []).filter((ms) => ms >= at && ms - at <= 7 * DAY).length;
    }
    for (const [k, m] of Object.entries(moments)) { const t = m.get(uid); if (t != null && t - at <= 7 * DAY) w[k] += 1; }
    if (now - at >= 2 * DAY) { w.d1Ready += 1; if (activeBetween(uid, at, 1, 1)) w.d1 += 1; }
    if (now - at >= 14 * DAY) { w.d7Ready += 1; if (activeBetween(uid, at, 7, 13)) w.d7 += 1; }
    if (now - at >= 35 * DAY) { w.d30Ready += 1; if (activeBetween(uid, at, 28, 34)) w.d30 += 1; }
  }
  const list = [...byWeek.values()].sort((a, b) => (a.week < b.week ? 1 : -1));
  const totals = list.reduce((t, w) => {
    for (const k of TOTAL_KEYS) t[k] += w[k];
    for (const [s, n] of Object.entries(w.sources)) t.sources[s] = (t.sources[s] || 0) + n;
    return t;
  }, { ...Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0])), sources: {} });
  return { weeks: list, totals };
}

const addDays = (iso, n) => isoDay(Date.parse(iso + 'T00:00:00Z') + n * DAY);
const LAUNCH = '2027-01-05';

/* The day-90 KPIs (launch plan v2, section 7): good at or past `target`, act past `act`. Weekly new
   accounts: 2,500 by day 90 is about 190 a week; the plan acts under 150. Cost in cents. */
const KPIS = {
  newAccounts: { target: 190, act: 150, higher: true },
  organicShare: { target: 0.40, act: 0.25, higher: true },
  activation: { target: 0.55, act: 0.40, higher: true },
  d7: { target: 0.25, act: 0.18, higher: true },
  d30: { target: 0.12, act: 0.08, higher: true },
  costPerActivated: { target: 1200, act: 2000, higher: false },
};
function statusOf(key, value, live) {
  const k = KPIS[key];
  if (!k || value == null || !live) return null;
  if (k.higher ? value >= k.target : value <= k.target) return 'ok';
  if (k.higher ? value < k.act : value > k.act) return 'act';
  return 'watch';
}

/** Saves one channel's spend for a week (whole cents; 0 removes it). Throws on a bad week or channel. */
function setSpend(db, week, channel, cents) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week)) || mondayOf(Date.parse(week + 'T12:00:00Z')) !== week) throw new Error('week must be a Monday, YYYY-MM-DD');
  if (!SPEND_CHANNELS.includes(channel)) throw new Error('unknown channel');
  if (!Number.isInteger(cents) || cents < 0 || cents > 1e9) throw new Error('cents must be a whole number, 0 or more');
  if (cents === 0) db.run('DELETE FROM growth_spend WHERE week = ? AND channel = ?', [week, channel]);
  else db.run('INSERT INTO growth_spend (week, channel, cents) VALUES (?, ?, ?) ON CONFLICT(week, channel) DO UPDATE SET cents = excluded.cents', [week, channel, cents]);
}

/**
 * The Monday scorecard. `week` is the last whole week (UTC Monday to Sunday). Each cohort figure comes
 * from the newest sign-up week whose every account is old enough to have it: D1 2 days after the week
 * ends, activation 7, D7 14, D30 35. Statuses (ok / watch / act) apply from launch day.
 */
function scorecard(db, { now = Date.now() } = {}) {
  const thisMonday = mondayOf(now);
  const week = addDays(thisMonday, -7);
  const r = report(db, { now, weeks: 9 });
  const at = (iso) => r.weeks.find((w) => w.week === iso) || null;
  // The newest sign-up week whose last account is `days` old: the Monday on or before now - 7 - days.
  const ready = (days) => { const iso = mondayOf(now - (7 + days) * DAY); return { iso, w: at(iso) }; };
  const ratio = (n, d) => (d > 0 ? n / d : null);
  const last = at(week);
  const act = ready(7); const d1 = ready(2); const d7 = ready(14); const d30 = ready(35);
  const spendRows = rows(db, 'SELECT week, channel, cents FROM growth_spend WHERE week IN (?, ?)', [week, act.iso]);
  const spendOf = (iso) => Object.fromEntries(spendRows.filter(([w]) => w === iso).map(([, c, cents]) => [c, cents]));
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const spendLast = spendOf(week); const spendAct = spendOf(act.iso);
  const live = isoDay(now) >= LAUNCH;
  const fig = (key, value, wk) => ({ key, week: wk, value, status: statusOf(key, value, live), ...(KPIS[key] ? { target: KPIS[key].target, act: KPIS[key].act } : {}) });
  return {
    week, live, launch: LAUNCH,
    figures: [
      fig('newAccounts', last ? last.signups : 0, week),
      fig('organicShare', last && last.signups ? 1 - last.paid / last.signups : null, week),
      fig('activation', act.w ? ratio(act.w.activated7, act.w.signups) : null, act.iso),
      fig('savesPerActivated', act.w ? ratio(act.w.savesFirst7, act.w.activated7) : null, act.iso),
      fig('sharesPer100', act.w && act.w.signups ? (100 * act.w.shared7) / act.w.signups : null, act.iso),
      fig('followsPer100', act.w && act.w.signups ? (100 * act.w.followed7) / act.w.signups : null, act.iso),
      fig('d1', d1.w ? ratio(d1.w.d1, d1.w.d1Ready) : null, d1.iso),
      fig('d7', d7.w ? ratio(d7.w.d7, d7.w.d7Ready) : null, d7.iso),
      fig('d30', d30.w ? ratio(d30.w.d30, d30.w.d30Ready) : null, d30.iso),
      fig('costPerPaidSignup', last && last.paid && sum(spendLast) ? Math.round(sum(spendLast) / last.paid) : null, week),
      fig('costPerActivated', act.w && act.w.paidActivated7 && sum(spendAct) ? Math.round(sum(spendAct) / act.w.paidActivated7) : null, act.iso),
    ],
    sources: last ? last.sources : {},
    spend: { week, channels: spendLast, totalCents: sum(spendLast) },
    channels: SPEND_CHANNELS,
    // What the server cannot see (launch plan section 12), and where the owner reads it.
    elsewhere: [
      { what: 'CPI by channel; spend against plan', where: 'Apple Ads and Meta Ads Manager' },
      { what: 'Product-page conversion; ratings', where: 'App Store Connect' },
      { what: '3-second view rate, 15-second hold, link CTR, frequency', where: 'Meta Ads Manager' },
      { what: 'Ad-account health', where: 'each ad platform' },
      { what: 'Trial starts and trial to paid (from 1 March)', where: 'App Store Connect' },
    ],
  };
}

module.exports = { HEARD, SPEND_CHANNELS, KPIS, migrate, cleanSource, recordSignup, recordOnce, touchDay, report, mondayOf, scorecard, setSpend, isPaid };
