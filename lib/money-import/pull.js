'use strict';
/*
 * The server-to-server pull from the dashboard (docs/bankroll-merge.md §8, "Phase 4: as built"):
 *
 *   GET <DASHBOARD_BASE_URL>/api/money-export[?since=<ms>]
 *   Authorization: Bearer <LEDGER_TOKEN>
 *
 * LEDGER_TOKEN is a server-only secret held by exactly two Render services (this one and the
 * dashboard's). It goes in the Authorization header and NOWHERE else: never in a URL, never in a
 * log line, never in an error message. Missing, shorter than 32 characters, holding whitespace, or
 * equal to DASHBOARD_TOKEN (which is compiled into the iOS builds) means the pull is OFF, and the
 * boot log says which.
 *
 * Nothing here writes anything. A pull is verified before it is staged:
 *   - the answer is JSON with app 'wsop-console' and version 1 (a non-JSON answer is an error,
 *     never an empty success: the 2026-09-11 lesson);
 *   - count === records.length, the per-store counts add up, the tombstone count and localCount
 *     match;
 *   - hash === sha256(JSON.stringify({ records, local })) over exactly what was parsed.
 */
const crypto = require('crypto');

const TOKEN_NAME = 'LEDGER_TOKEN';
const MIN_LENGTH = 32;
const DEFAULT_TIMEOUT_MS = 15000;
const DAY_MS = 24 * 3600 * 1000;
// "Phase 4: as built", trap 1: updatedAt is the writing device's clock, so a phone that synced late
// delivers a record OLDER than a cursor already held. Every delta re-pulls this far back.
const DELTA_MARGIN_MS = 14 * DAY_MS;
const APP = 'wsop-console';
const VERSION = 1;
const STORES = ['sessions', 'adjustments', 'expenses', 'backers', 'settings'];
const LOCAL_KEYS = ['wsop-admin-taxrate', 'wsop-balances', 'wsop-notified-sessions', 'wsop-staking'];

const trim = (v) => String(v == null ? '' : v).trim();

/**
 * Can this process pull? -> { on, why }. `why` is for the boot log and the 503; it never holds the
 * value.
 */
function ledgerTokenStatus(env = process.env) {
  const v = trim(env[TOKEN_NAME]);
  if (!v) return { on: false, why: `${TOKEN_NAME} is not set` };
  if (v.length < MIN_LENGTH) return { on: false, why: `${TOKEN_NAME} is shorter than ${MIN_LENGTH} characters` };
  if (/\s/.test(v)) return { on: false, why: `${TOKEN_NAME} contains whitespace` };
  const clientBound = [env.DASHBOARD_TOKEN, env.DASHBOARD_TOKEN_PREVIOUS].map(trim).filter(Boolean);
  if (clientBound.includes(v)) return { on: false, why: `${TOKEN_NAME} is the same value as DASHBOARD_TOKEN, which is compiled into the iOS builds` };
  return { on: true, why: `${TOKEN_NAME} is set` };
}

/** The one boot line. */
function bootLine(env = process.env) {
  const s = ledgerTokenStatus(env);
  return s.on
    ? '[money-import] the dashboard pull is available to the owner (POST /api/bankrolls/import/dashboard/fetch)'
    : `[money-import] the dashboard pull is OFF: ${s.why}. Set LEDGER_TOKEN (64 hex characters, the same value as the dashboard's) on the production Render service only.`;
}

function payloadHash(records, local) {
  return crypto.createHash('sha256').update(JSON.stringify({ records, local })).digest('hex');
}

/** Checks an export body. -> { ok, problems: [string] } (problems name fields, never contents). */
function verifyExport(body, { since = null } = {}) {
  const p = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, problems: ['the answer is not an object'] };
  if (body.app !== APP) p.push('app is not wsop-console');
  if (body.version !== VERSION) p.push('version is not 1');
  const records = body.records;
  const local = body.local;
  if (!Array.isArray(records)) p.push('records is not a list');
  if (!local || typeof local !== 'object' || Array.isArray(local)) p.push('local is not an object');
  if (p.length) return { ok: false, problems: p };
  if (body.count !== records.length) p.push(`count says ${body.count} but ${records.length} records came`);
  const counts = body.counts && typeof body.counts === 'object' ? body.counts : null;
  if (!counts) p.push('counts is missing');
  let tomb = 0;
  const per = Object.fromEntries(STORES.map((s) => [s, 0]));
  let shapeBad = 0;
  for (const r of records) {
    if (!r || typeof r !== 'object' || typeof r.store !== 'string' || typeof r.id !== 'string' || !Number.isFinite(r.updatedAt)
      || typeof r.deleted !== 'boolean' || !(r.data === null || typeof r.data === 'string') || !STORES.includes(r.store)) { shapeBad++; continue; }
    per[r.store]++;
    if (r.deleted) tomb++;
  }
  if (shapeBad) p.push(`${shapeBad} record(s) are not in the export's shape`);
  if (counts) {
    for (const s of STORES) if (Number(counts[s] || 0) !== per[s]) p.push(`counts.${s} says ${counts[s]} but ${per[s]} came`);
    const extra = Object.keys(counts).filter((k) => !STORES.includes(k));
    if (extra.length) p.push('counts names a store the import does not know');
  }
  if (body.deleted !== undefined && body.deleted !== tomb) p.push(`deleted says ${body.deleted} but ${tomb} tombstones came`);
  if (body.localCount !== undefined && body.localCount !== Object.keys(local).length) p.push('localCount does not match local');
  for (const k of Object.keys(local)) if (!LOCAL_KEYS.includes(k)) p.push('local holds a key the import does not know');
  if (typeof body.hash !== 'string' || !/^[0-9a-f]{64}$/.test(body.hash)) p.push('hash is missing');
  else if (payloadHash(records, local) !== body.hash) p.push('hash does not match what came');
  if (!Number.isFinite(body.cursor) || body.cursor < 0) p.push('cursor is missing');
  const wantMode = since == null ? 'full' : 'delta';
  if (body.mode !== undefined && body.mode !== wantMode) p.push(`mode is ${body.mode}, asked for ${wantMode}`);
  if (since != null && body.since !== undefined && body.since !== since) p.push('since was not echoed');
  return { ok: p.length === 0, problems: p };
}

/**
 * Pull the export. opts = { baseUrl, env, since (ms | null), timeoutMs, fetchImpl }.
 * -> { ok: true, body, bytes, ms } | { ok: false, status, error }
 *
 * `error` is safe to show and to log: it names what went wrong, never the token or the payload.
 */
async function pullExport({ baseUrl, env = process.env, since = null, timeoutMs, fetchImpl = fetch } = {}) {
  const status = ledgerTokenStatus(env);
  if (!status.on) return { ok: false, status: 503, error: `The dashboard pull is off on this server: ${status.why}.` };
  if (since != null && (!Number.isInteger(since) || since < 0 || String(since).length > 15)) return { ok: false, status: 400, error: 'since must be whole milliseconds' };
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  let url;
  try {
    url = new URL('/api/money-export', String(baseUrl || '').replace(/\/+$/, '') + '/');
  } catch (_) { return { ok: false, status: 500, error: 'DASHBOARD_BASE_URL is not a URL' }; }
  if (since != null) url.searchParams.set('since', String(since));
  const started = Date.now();
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${trim(env[TOKEN_NAME])}`, Accept: 'application/json' },
      // A redirect would carry the header somewhere this code did not choose.
      redirect: 'manual',
      signal: AbortSignal.timeout(ms),
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return { ok: false, status: 504, error: `The dashboard did not answer within ${ms} ms.` };
    const code = err && err.cause && err.cause.code ? ` (${err.cause.code})` : '';
    return { ok: false, status: 502, error: `Could not reach the dashboard${code}.` };
  }
  if (res.status === 404) return { ok: false, status: 502, error: 'The dashboard refused the pull (404): its door is closed, or LEDGER_TOKEN is not the same value on the two services.' };
  if (res.status >= 300 && res.status < 400) return { ok: false, status: 502, error: `The dashboard answered with a redirect (${res.status}); the pull does not follow redirects.` };
  if (!res.ok) return { ok: false, status: 502, error: `The dashboard answered HTTP ${res.status}.` };
  let text;
  try { text = await res.text(); } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return { ok: false, status: 504, error: `The dashboard did not finish answering within ${ms} ms.` };
    return { ok: false, status: 502, error: 'The dashboard\'s answer could not be read.' };
  }
  let body;
  try { body = JSON.parse(text); } catch (_) {
    return { ok: false, status: 502, error: 'The dashboard answered with something that is not JSON, so nothing was staged.' };
  }
  const v = verifyExport(body, { since });
  if (!v.ok) return { ok: false, status: 502, error: `The export failed its checks, so nothing was staged: ${v.problems.join('; ')}.` };
  return { ok: true, body, bytes: Buffer.byteLength(text), ms: Date.now() - started };
}

/** The `since` for a delta: the last accepted cursor less the margin, or null (a full pull). */
function deltaSince(cursor) {
  const c = Number(cursor);
  if (!Number.isFinite(c) || c <= 0) return null;
  const s = Math.floor(c - DELTA_MARGIN_MS);
  return s > 0 ? s : null;
}

module.exports = {
  TOKEN_NAME, MIN_LENGTH, DEFAULT_TIMEOUT_MS, DELTA_MARGIN_MS, STORES, LOCAL_KEYS, APP, VERSION,
  ledgerTokenStatus, bootLine, payloadHash, verifyExport, pullExport, deltaSince,
};
