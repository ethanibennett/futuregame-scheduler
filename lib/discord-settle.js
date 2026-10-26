'use strict';
/*
 * The settling-day reminder, as a Discord DM to the player (owner, 2026-10-20: "a discord notification
 * for settling day reminders" ... "just the Discord DM").
 *
 * Sunday 09:00 New York (settlement is at noon, utils/backer-page.js), one direct message listing each
 * backer whose balance is not $0, as their page shows it, and who pays whom:
 *
 *   Settling today at noon ET:
 *   • You pay Sam Okafor $7,349
 *   • Dan Whitcombe pays you $499
 *
 * Nothing is sent when every backer is at $0. Names and amounts only: never a page link (a link is
 * a backer's whole credential).
 *
 * A DM needs a bot, not a webhook: DISCORD_BOT_TOKEN (the bot's token, from the Discord developer
 * portal) and DISCORD_USER_ID (the player's Discord user id). The bot must share a server with the
 * player. Both are server-only secrets, set on Render, never in a repo or a log.
 *
 * Gate, like backer delivery: on where RENDER is set, DISCORD_DM=1|0 overrides, and off whenever either
 * value is missing. Every boot logs the decision. One reminder per Sunday (discord_reminders), so a
 * restart near 09:00 cannot send it twice.
 *
 * SUNDAY NOON, BOTH PARTIES (owner, 2026-10-25: "a little bot that sends a gentle reminder on Sunday at
 * noon via Discord DM to both parties"): at settlement time each backer whose balance is not $0 and whose
 * Discord user id is on file (backer_discord, keyed by the page's link like every backer table, set from
 * their Backers card) gets one gentle DM in their own terms, and the player one DM listing who pays whom
 * and who was reached. Same bot, same gate; the bot must share a server with each backer, or Discord
 * refuses the DM (logged, never retried). Once per recipient per Sunday (discord_reminders,
 * '<day>#noon#<recipient>'). Names and amounts only, never a link.
 */
const ON = new Set(['1', 'true', 'yes', 'on']);
const OFF = new Set(['0', 'false', 'no', 'off']);
const API = () => (process.env.DISCORD_API_BASE || 'https://discord.com/api/v10').replace(/\/$/, '');

function decision(env = process.env) {
  if (!String(env.DISCORD_BOT_TOKEN || '').trim()) return { on: false, why: 'DISCORD_BOT_TOKEN is not set' };
  if (!/^\d{5,25}$/.test(String(env.DISCORD_USER_ID || '').trim())) return { on: false, why: 'DISCORD_USER_ID is not set (the numeric Discord user id)' };
  const raw = String(env.DISCORD_DM == null ? '' : env.DISCORD_DM).trim().toLowerCase();
  if (raw) {
    if (ON.has(raw)) return { on: true, why: 'DISCORD_DM is on' };
    return { on: false, why: OFF.has(raw) ? 'DISCORD_DM is off' : 'DISCORD_DM has a value this server does not recognise (use 1 or 0)' };
  }
  const render = String(env.RENDER == null ? '' : env.RENDER).trim().toLowerCase();
  if (render && !OFF.has(render)) return { on: true, why: 'RENDER is set (production)' };
  return { on: false, why: 'neither DISCORD_DM nor RENDER is set' };
}

const dollars = (cents) => '$' + Math.round(Math.abs(Number(cents) || 0) / 100).toLocaleString('en-US');

/** The message for these backers (the Backers view's entries), or null when nobody is owed anything. */
function reminderText(backers) {
  const lines = [];
  for (const b of backers || []) {
    const c = Math.round(Number(b.cumulativeCents) || 0);
    if (Math.round(c / 100) === 0) continue;
    const name = (b.name && String(b.name).trim()) || 'A backer';
    lines.push(c > 0 ? `• You pay ${name} ${dollars(c)}` : `• ${name} pays you ${dollars(c)}`);
  }
  if (!lines.length) return null;
  return ['**Settling today at noon ET:**', ...lines].join('\n');
}

/** DM the player, or `to` (a backer's Discord user id). -> { ok, status, error? }. The token goes in a
 *  header, never a URL or a log. */
async function sendDm(content, { env = process.env, fetchImpl = fetch, to } = {}) {
  const d = decision(env);
  if (!d.on) return { ok: false, status: 0, error: d.why };
  const recipient = String(to || env.DISCORD_USER_ID).trim();
  const headers = { Authorization: `Bot ${String(env.DISCORD_BOT_TOKEN).trim()}`, 'Content-Type': 'application/json' };
  try {
    const ch = await fetchImpl(`${API()}/users/@me/channels`, { method: 'POST', headers, body: JSON.stringify({ recipient_id: recipient }) });
    if (!ch.ok) return { ok: false, status: ch.status, error: `opening the DM channel failed (HTTP ${ch.status})` };
    const { id } = await ch.json();
    const msg = await fetchImpl(`${API()}/channels/${encodeURIComponent(id)}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: String(content).slice(0, 1900), allowed_mentions: { parse: [] } }) });
    if (!msg.ok) return { ok: false, status: msg.status, error: `sending the message failed (HTTP ${msg.status})` };
    return { ok: true, status: msg.status };
  } catch (e) {
    return { ok: false, status: 0, error: `Discord could not be reached: ${e && e.message}` };
  }
}

function ensureTable(db) {
  db.run('CREATE TABLE IF NOT EXISTS discord_reminders (day TEXT PRIMARY KEY, sent_at TEXT NOT NULL)');
}
const dayET = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/**
 * The Sunday run. deps: { backers: () => [...], save: async () => {} }. -> { sent, why }.
 * force: the owner's test (sends even with nobody owed, and does not mark the day).
 */
async function runReminder(db, { backers, save, nowMs = Date.now(), force = false, env = process.env, fetchImpl } = {}) {
  ensureTable(db);
  const day = dayET(nowMs);
  if (!force) {
    const s = db.prepare('SELECT 1 AS x FROM discord_reminders WHERE day = ?');
    s.bind([day]); const already = s.step(); s.free();
    if (already) return { sent: false, why: 'already sent today' };
  }
  let text = reminderText(backers());
  if (!text) {
    if (!force) return { sent: false, why: 'every backer is at $0' };
    text = '**Settling reminder test:** every backer is at $0 right now, so Sunday would send nothing.';
  } else if (force) {
    text = '_(test)_ ' + text;
  }
  const r = await sendDm(text, { env, fetchImpl });
  if (r.ok && !force) {
    db.run('INSERT OR IGNORE INTO discord_reminders (day, sent_at) VALUES (?, ?)', [day, new Date(nowMs).toISOString()]);
    if (save) await save();
  }
  return r.ok ? { sent: true, why: 'sent' } : { sent: false, why: r.error };
}

// ── Sunday noon: a gentle reminder to both parties ─────────────────────────────────────────────

const USER_ID_RE = /^\d{15,25}$/;
function ensureBackerTable(db) {
  db.run('CREATE TABLE IF NOT EXISTS backer_discord (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, updated_at TEXT NOT NULL)');
}
const hasBackerTable = (db) => {
  const r = db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'backer_discord'");
  return !!(r.length && r[0].values.length);
};
/** A backer's Discord user id, or null. */
function backerDiscordId(db, token) {
  if (!token || !hasBackerTable(db)) return null;
  const s = db.prepare('SELECT user_id FROM backer_discord WHERE token = ?');
  try { s.bind([token]); return s.step() ? String(s.getAsObject().user_id) : null; } finally { s.free(); }
}
/** Set (a numeric Discord user id) or clear (null / '') a backer's id. -> { ok, error? }. */
function setBackerDiscord(db, token, userId, now = new Date().toISOString()) {
  ensureBackerTable(db);
  const id = userId == null ? '' : String(userId).trim();
  if (!id) { db.run('DELETE FROM backer_discord WHERE token = ?', [token]); return { ok: true, cleared: true }; }
  if (!USER_ID_RE.test(id)) return { ok: false, error: 'A Discord user id is 15 to 25 digits (Developer Mode, then Copy User ID).' };
  db.run('INSERT INTO backer_discord (token, user_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at', [token, id, now]);
  return { ok: true, cleared: false };
}
/** What the owner's card shows for a backer's id: its last four digits, or null. */
function discordHint(db, token) {
  const id = backerDiscordId(db, token);
  return id ? id.slice(-4) : null;
}

const firstName = (name) => (String(name || '').trim().split(/\s+/)[0]) || 'there';
const dueOf = (b) => Math.round(Number(b && b.dueCents != null ? b.dueCents : b && b.cumulativeCents) || 0);
const owes = (b) => Math.round(dueOf(b) / 100) !== 0;

/** The backer's DM, in their terms (+ = the player pays the backer), or null at $0. */
function noonBackerText(b, { player = 'Ethan' } = {}) {
  const c = dueOf(b);
  if (Math.round(c / 100) === 0) return null;
  const hi = `Hi ${firstName(b.name)}, a gentle reminder that today is settling day.`;
  return c > 0
    ? `${hi} ${player} owes you ${dollars(c)} for the week. Once it arrives, press Settled on your page.`
    : `${hi} The week comes to ${dollars(c)} from you to ${player}. Once it is sent, press Settled on your page, or Partial payment if it goes in parts.`;
}

/** The player's DM: who pays whom, and who was reached on Discord. null when nobody owes anything. */
function noonPlayerText(backers, reached = []) {
  const lines = [];
  for (const b of backers || []) {
    if (!owes(b)) continue;
    const name = (b.name && String(b.name).trim()) || 'A backer';
    const c = dueOf(b);
    lines.push(c > 0 ? `• You pay ${name} ${dollars(c)}` : `• ${name} pays you ${dollars(c)}`);
  }
  if (!lines.length) return null;
  const who = reached.length ? `Reminded on Discord: ${reached.join(', ')}.` : 'No backer has a Discord id on file, so only you were reminded.';
  return ['**A gentle reminder: it is settling day.**', ...lines, who].join('\n');
}

function markOnce(db, key, nowMs) {
  const s = db.prepare('SELECT 1 AS x FROM discord_reminders WHERE day = ?');
  s.bind([key]); const already = s.step(); s.free();
  return already;
}

/**
 * The Sunday noon run. deps: { backers: () => [{ name, dueCents, token }], save }. -> { sent, why, reached,
 * missing, failed }. force: the owner's test, sent to the PLAYER ONLY (what they and each backer would
 * get), never to a backer, and the day is not marked.
 */
async function runNoonReminder(db, { backers, save, nowMs = Date.now(), force = false, env = process.env, fetchImpl, player = 'Ethan' } = {}) {
  ensureTable(db);
  ensureBackerTable(db);
  const day = dayET(nowMs);
  const list = (backers() || []).filter(owes);
  const reached = [], missing = [], failed = [];
  if (!list.length && !force) return { sent: false, why: 'every backer is at $0', reached, missing, failed };

  if (force) {
    const parts = [noonPlayerText(list, list.filter((b) => backerDiscordId(db, b.token)).map((b) => b.name)) || 'Every backer is at $0, so Sunday noon would send nothing.'];
    for (const b of list) {
      const id = backerDiscordId(db, b.token);
      parts.push(`\n${b.name || 'A backer'}${id ? '' : ' (no Discord id on file, would not be sent)'}:\n> ${noonBackerText(b, { player })}`);
    }
    const r = await sendDm('_(test)_ ' + parts.join('\n'), { env, fetchImpl });
    return { sent: r.ok, why: r.ok ? 'sent (test, to you only)' : r.error, reached, missing, failed };
  }

  let wrote = false;
  for (const b of list) {
    const id = backerDiscordId(db, b.token);
    const name = (b.name && String(b.name).trim()) || 'A backer';
    if (!id) { missing.push(name); continue; }
    const key = `${day}#noon#${id}`;
    if (markOnce(db, key)) { reached.push(name); continue; }
    const r = await sendDm(noonBackerText(b, { player }), { env, fetchImpl, to: id });
    if (r.ok) {
      reached.push(name);
      db.run('INSERT OR IGNORE INTO discord_reminders (day, sent_at) VALUES (?, ?)', [key, new Date(nowMs).toISOString()]);
      wrote = true;
    } else {
      failed.push(name);
      console.error(`[discord] noon reminder to ${name} failed: ${r.error}`);
    }
  }
  const pkey = `${day}#noon#player`;
  let sent = reached.length > 0;
  let why = 'sent';
  if (!markOnce(db, pkey)) {
    const r = await sendDm(noonPlayerText(list, reached), { env, fetchImpl });
    if (r.ok) {
      db.run('INSERT OR IGNORE INTO discord_reminders (day, sent_at) VALUES (?, ?)', [pkey, new Date(nowMs).toISOString()]);
      wrote = true; sent = true;
    } else why = r.error;
  } else why = 'already sent today';
  if (wrote && save) await save();
  return { sent, why, reached, missing, failed };
}

module.exports = {
  decision, reminderText, sendDm, runReminder, ensureTable,
  ensureBackerTable, backerDiscordId, setBackerDiscord, discordHint, noonBackerText, noonPlayerText, runNoonReminder,
};
