#!/usr/bin/env node
// Post-deploy smoke test for futurega.me (or any origin running this server).
//
//   node scripts/smoke.mjs                      # https://futurega.me
//   node scripts/smoke.mjs http://localhost:3199
//   SMOKE_BUDGET_MS=8000 node scripts/smoke.mjs  # slower response-time budget
//
// READ-ONLY by construction: every request is an unauthenticated GET. No login,
// no token, no write, so it is safe to point at production at any time.
//
// What it checks, and why each one:
//   spa        `/` serves the SPA shell (200, HTML, a #root mount point) and names
//              a hashed `/assets/index-<hash>.js` bundle.
//   bundle     that bundle actually loads — 200 with a JavaScript content type.
//              The server falls back to index.html for unknown paths, so a
//              deploy whose HTML names a bundle that is not there answers 200
//              text/html; the content type is what catches it.
//   auth       `/api/tournaments` with no token is refused with 401. A 500 here
//              means the auth path itself is broken; a 200 means it is open.
//   health     `/health` answers 200 JSON {status:"ok"}.
//   public     `/api/hands/public` (no login) answers 200 with a JSON array —
//              unlike /health, this one touches the database.
//
// Every check also records its response time and fails if it exceeds the budget
// (SMOKE_BUDGET_MS, default 5000 ms). One line per check; exit 1 if any failed,
// exit 2 on bad usage.

const DEFAULT_ORIGIN = 'https://futurega.me';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 15000;
const BUDGET_MS = Number(process.env.SMOKE_BUDGET_MS) || 5000;

let origin;
try {
  origin = new URL(process.argv[2] || process.env.SMOKE_ORIGIN || DEFAULT_ORIGIN).origin;
} catch {
  console.error(`usage: node scripts/smoke.mjs [origin]  (got "${process.argv[2]}", not a URL)`);
  process.exit(2);
}

class CheckError extends Error {}
const fail = (msg) => { throw new CheckError(msg); };

async function get(pathname, headers = {}) {
  const url = new URL(pathname, origin).href;
  const t0 = performance.now();
  let res, body;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'futuregame-smoke/1', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = await res.text();
  } catch (err) {
    // undici hides the useful part (ECONNREFUSED, ENOTFOUND, a TLS error) in `cause`,
    // sometimes an AggregateError of one attempt per resolved address.
    const c = err.cause;
    const why = err.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS} ms`
      : (c?.code || c?.errors?.[0]?.code || c?.message || err.message);
    fail(`GET ${pathname} failed: ${why}`);
  }
  const ms = Math.round(performance.now() - t0);
  return { res, body, ms, type: res.headers.get('content-type') || '(none)' };
}

function parseJson(r, pathname) {
  if (!/\bjson\b/i.test(r.type)) fail(`${pathname} content-type is ${r.type}, expected JSON`);
  try { return JSON.parse(r.body); } catch { fail(`${pathname} body is not valid JSON`); }
}

const results = [];
let bundlePath = null;

async function check(name, fn) {
  let ms = null;
  try {
    const out = await fn();
    ms = out.ms;
    if (ms > BUDGET_MS) fail(`took ${ms} ms, over the ${BUDGET_MS} ms budget`);
    results.push({ name, ok: true, ms, detail: out.detail });
  } catch (err) {
    if (!(err instanceof CheckError)) err = new CheckError(`unexpected error: ${err.message}`);
    results.push({ name, ok: false, ms, detail: err.message });
  }
}

await check('spa', async () => {
  const r = await get('/');
  if (r.res.status !== 200) fail(`/ returned ${r.res.status}, expected 200`);
  if (!/text\/html/i.test(r.type)) fail(`/ content-type is ${r.type}, expected text/html`);
  if (!/id=["']root["']/.test(r.body)) fail('/ has no #root mount point — not the SPA shell');
  const m = r.body.match(/<script[^>]*\bsrc=["']([^"']*\/assets\/index-[A-Za-z0-9_-]+\.js)["']/);
  if (!m) fail('/ names no hashed /assets/index-<hash>.js bundle');
  bundlePath = m[1];
  return { ms: r.ms, detail: `SPA shell, bundle ${bundlePath}` };
});

await check('bundle', async () => {
  if (!bundlePath) fail('skipped — no bundle found on / (see spa)');
  const r = await get(bundlePath);
  if (r.res.status !== 200) fail(`${bundlePath} returned ${r.res.status}, expected 200`);
  if (!/javascript/i.test(r.type)) fail(`${bundlePath} content-type is ${r.type}, expected JavaScript (missing asset served as SPA fallback?)`);
  if (r.body.length < 1000) fail(`${bundlePath} is only ${r.body.length} bytes`);
  return { ms: r.ms, detail: `${(r.body.length / 1024).toFixed(0)} KB, ${r.type.split(';')[0]}` };
});

await check('auth', async () => {
  const r = await get('/api/tournaments');
  if (r.res.status === 200) fail('/api/tournaments answered 200 with no token — auth is OPEN');
  if (r.res.status !== 401) fail(`/api/tournaments with no token returned ${r.res.status}, expected 401`);
  return { ms: r.ms, detail: '401 without a token' };
});

await check('health', async () => {
  const r = await get('/health');
  if (r.res.status !== 200) fail(`/health returned ${r.res.status}, expected 200`);
  const j = parseJson(r, '/health');
  if (j?.status !== 'ok') fail(`/health status is ${JSON.stringify(j?.status)}, expected "ok"`);
  return { ms: r.ms, detail: '{"status":"ok"}' };
});

await check('public', async () => {
  const r = await get('/api/hands/public');
  if (r.res.status !== 200) fail(`/api/hands/public returned ${r.res.status}, expected 200`);
  const j = parseJson(r, '/api/hands/public');
  if (!Array.isArray(j)) fail('/api/hands/public is not a JSON array');
  return { ms: r.ms, detail: `${j.length} public hands` };
});

console.log(`smoke ${origin}  (budget ${BUDGET_MS} ms per request)`);
for (const { name, ok, ms, detail } of results) {
  const t = ms == null ? '     -  ' : `${String(ms).padStart(6)} ms`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(7)}${t}  ${detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} of ${results.length} checks FAILED` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
