'use strict';
/*
 * Two things a backer's page can show, each off until the player turns it on for that backer in Standing
 * (Features 21 and 23, owner picks 2026-11-11). Kept per link, re-keyed with it on rotation
 * (lib/backer-surface.js TOKEN_COLUMNS):
 *
 *   backer_page_options (token, coming_up, sweat, updated_at)
 *
 * Coming up this week (21): the player's saved events from today to six days on that fall inside the
 * backer's stakes, by the same game and channel rule the Notify tap uses (lib/staking/standing.js
 * matchStake), with the share; and a count of the saved events outside them. Events only: never a plan,
 * a travel day or a note. The feed carries `comingUp` only when on, so a page without it is unchanged.
 *
 * Sweat a run (23): while the player is live in a tournament inside the backer's stakes, the beacon adds
 * the latest stack, big blind, blinds and entries, and this run's stack updates (chips only). This reverses
 * the beacon's "no stack" line on purpose, only where the player said so, never money.
 */
const { stakedBackers } = require('./staking/notify');
const { matchStake } = require('./staking/standing');
const { classifyTournament, FORMAT_LABEL } = require('./staking/classify');
const { normaliseDate } = require('./analytics');

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS backer_page_options (
    token TEXT PRIMARY KEY,
    coming_up INTEGER NOT NULL DEFAULT 0,
    sweat INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER
  )`);
}

function all(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

function optionsOf(db, token) {
  try {
    const r = all(db, 'SELECT coming_up, sweat FROM backer_page_options WHERE token = ?', [String(token)])[0];
    return { comingUp: !!(r && Number(r.coming_up)), sweat: !!(r && Number(r.sweat)) };
  } catch (_) { return { comingUp: false, sweat: false }; }
}

function setOptions(db, token, { comingUp, sweat }) {
  const cur = optionsOf(db, token);
  const next = { comingUp: comingUp === undefined ? cur.comingUp : !!comingUp, sweat: sweat === undefined ? cur.sweat : !!sweat };
  db.run('INSERT OR REPLACE INTO backer_page_options (token, coming_up, sweat, updated_at) VALUES (?, ?, ?, ?)',
    [String(token), next.comingUp ? 1 : 0, next.sweat ? 1 : 0, Date.now()]);
  return next;
}

function stakesFor(db, ownerId, token, source) {
  const b = stakedBackers(db, ownerId, { source }).find((x) => x.token === token);
  if (!b) return [];
  return b.agreements.filter((a) => !a.status || a.status === 'active').flatMap((a) => a.stakes || []);
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** { inAction: [...], outside: n } for the backer's page, or null when the stakes cannot be read. */
function comingUp(db, ownerId, token, { source = 'console', now = Date.now() } = {}) {
  if (ownerId == null) return null;
  const stakes = stakesFor(db, ownerId, token, source);
  const from = isoDay(now), to = isoDay(now + 6 * 864e5);
  const rows = all(db, `SELECT t.id, t.event_name, t.date, t.time, t.venue, t.property, t.site, t.buyin, t.currency, t.game_variant, t.is_online
    FROM user_schedules us JOIN tournaments t ON t.id = us.tournament_id
    WHERE us.user_id = ? AND t.venue != 'Personal' AND COALESCE(us.not_played, 0) = 0`, [Number(ownerId)]);
  const inAction = [];
  let outside = 0;
  for (const t of rows) {
    const day = normaliseDate(t.date);
    if (!day || day < from || day > to) continue;
    const c = classifyTournament(t, null);
    const st = matchStake(stakes, { date: day, format: c.format, channel: c.channel });
    if (!st || !(Number(st.pct) > 0)) { outside += 1; continue; }
    inAction.push({
      name: t.event_name, room: (Number(t.is_online) ? (t.site || t.property) : t.property) || t.venue,
      date: day, time: t.time || null, buyin: Number(t.buyin) || 0, currency: t.currency || 'USD',
      pct: Number(st.pct), format: st.format === 'all' ? null : (FORMAT_LABEL[st.format] || st.format),
    });
  }
  inAction.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  return { inAction, outside };
}

/** The chips of the run in progress, for a backer in its action; null when not in their action. */
function sweat(db, ownerId, token, tournamentId, { source = 'console' } = {}) {
  if (ownerId == null || !tournamentId) return null;
  const t = all(db, 'SELECT id, date, game_variant, is_online, starting_chips FROM tournaments WHERE id = ?', [Number(tournamentId)])[0];
  if (!t) return null;
  const c = classifyTournament(t, null);
  const st = matchStake(stakesFor(db, ownerId, token, source), { date: normaliseDate(t.date), format: c.format, channel: c.channel });
  if (!st || !(Number(st.pct) > 0)) return null;
  const ups = all(db, `SELECT stack, sb, bb, bb_ante, total_entries, created_at FROM live_updates
    WHERE user_id = ? AND tournament_id = ? AND COALESCE(is_busted, 0) = 0 ORDER BY id`, [Number(ownerId), Number(tournamentId)]);
  if (!ups.length) return null;
  const last = ups[ups.length - 1];
  const entries = [...ups].reverse().find((u) => Number(u.total_entries) > 0);
  return {
    stack: Number(last.stack) || 0,
    bb: Number(last.bb) || null, sb: Number(last.sb) || null, ante: Number(last.bb_ante) || null,
    entries: entries ? Number(entries.total_entries) : null,
    startingStack: Number(t.starting_chips) || null,
    points: ups.filter((u) => Number(u.stack) > 0).map((u) => ({ at: u.created_at, stack: Number(u.stack) })),
  };
}

/** The owner's switches on a Backers card: GET/PUT /api/staking/standing/backers/:id/page-options. */
function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireAppAdmin, getOwnerId, tokenForViewId }) {
  const guard = (req, res) => {
    const owner = getOwnerId();
    if (owner == null || Number(req.user.id) !== Number(owner)) { res.status(403).json({ error: 'Forbidden' }); return null; }
    const token = tokenForViewId(getDb(), req.params.id);
    if (!token) { res.status(404).json({ error: 'No such backer' }); return null; }
    return token;
  };
  app.get('/api/staking/standing/backers/:id/page-options', authenticateToken, requireAppAdmin, (req, res) => {
    const token = guard(req, res);
    if (!token) return;
    res.set('Cache-Control', 'no-store');
    res.json(optionsOf(getDb(), token));
  });
  app.put('/api/staking/standing/backers/:id/page-options', authenticateToken, requireAppAdmin, async (req, res) => {
    const token = guard(req, res);
    if (!token) return;
    const b = req.body || {};
    const next = setOptions(getDb(), token, { comingUp: b.comingUp, sweat: b.sweat });
    await saveDatabase();
    res.json(next);
  });
}

module.exports = { migrate, optionsOf, setOptions, comingUp, sweat, mountRoutes };
