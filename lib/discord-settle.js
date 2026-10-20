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

/** DM the player. -> { ok, status, error? }. The token goes in a header, never a URL or a log. */
async function sendDm(content, { env = process.env, fetchImpl = fetch } = {}) {
  const d = decision(env);
  if (!d.on) return { ok: false, status: 0, error: d.why };
  const headers = { Authorization: `Bot ${String(env.DISCORD_BOT_TOKEN).trim()}`, 'Content-Type': 'application/json' };
  try {
    const ch = await fetchImpl(`${API()}/users/@me/channels`, { method: 'POST', headers, body: JSON.stringify({ recipient_id: String(env.DISCORD_USER_ID).trim() }) });
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

module.exports = { decision, reminderText, sendDm, runReminder, ensureTable };
