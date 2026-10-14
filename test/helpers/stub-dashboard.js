'use strict';
/*
 * A stub of the dashboard's GET /api/money-export (wsop-console "Phase 4: as built" in
 * docs/bankroll-merge.md), served from the test process on a scratch port. It builds the answer the
 * way WC:server/lib/money-export.js buildExport does: records sorted by store then id, tombstones
 * with data null, `local` in a fixed key order with absent keys omitted, counts by store, a cursor,
 * and hash = sha256(JSON.stringify({ records, local })).
 *
 * Bearer-only, 404 on anything else, like the real door. `mode` breaks the answer on purpose:
 * 'bad-hash', 'bad-count', 'html', '404', 'slow'. Every request is recorded (url and the
 * Authorization header) so a test can prove the token travelled in the header and never in a URL.
 * Every name, token, address and figure a test puts in it is invented.
 */
const crypto = require('crypto');
const http = require('http');

const STORES = ['sessions', 'adjustments', 'expenses', 'backers', 'settings'];
const LOCAL_KEYS = ['wsop-admin-taxrate', 'wsop-balances', 'wsop-notified-sessions', 'wsop-staking'];

function createStub({ token }) {
  const records = new Map(); // `${store}|${id}` -> { store, id, data (string|null), updatedAt, deleted }
  const local = new Map();   // key -> { value, updatedAt, deleted }
  const requests = [];
  const stub = { mode: 'ok', requests, records, local, port: null, server: null };

  stub.put = (store, id, obj, updatedAt) => records.set(`${store}|${id}`, { store, id, data: JSON.stringify(obj), updatedAt, deleted: false });
  stub.tomb = (store, id, updatedAt) => records.set(`${store}|${id}`, { store, id, data: null, updatedAt, deleted: true });
  stub.setLocal = (key, value, updatedAt) => local.set(key, { value, updatedAt, deleted: false });
  stub.live = (store) => [...records.values()].filter((r) => r.store === store && !r.deleted).map((r) => JSON.parse(r.data));

  stub.build = (since) => {
    const delta = since != null;
    const recs = [...records.values()].filter((r) => !delta || r.updatedAt > since)
      .map((r) => ({ store: r.store, id: r.id, data: r.deleted ? null : r.data, updatedAt: r.updatedAt, deleted: r.deleted }))
      .sort((a, b) => (a.store !== b.store ? (a.store < b.store ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const loc = {};
    for (const k of LOCAL_KEYS) {
      const v = local.get(k);
      if (!v || (delta && !(v.updatedAt > since))) continue;
      loc[k] = { value: v.value, updatedAt: v.updatedAt, deleted: false };
    }
    const counts = Object.fromEntries(STORES.map((s) => [s, 0]));
    let tomb = 0, cursor = delta ? since : 0;
    for (const r of recs) { counts[r.store]++; if (r.deleted) tomb++; if (r.updatedAt > cursor) cursor = r.updatedAt; }
    for (const k of Object.keys(loc)) if (loc[k].updatedAt > cursor) cursor = loc[k].updatedAt;
    return {
      app: 'wsop-console', version: 1, exportedAt: new Date().toISOString(), mode: delta ? 'delta' : 'full', since: delta ? since : null,
      cursor, count: recs.length, deleted: tomb, counts, localCount: Object.keys(loc).length,
      hash: crypto.createHash('sha256').update(JSON.stringify({ records: recs, local: loc })).digest('hex'),
      records: recs, local: loc,
    };
  };

  stub.server = http.createServer((req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization || null, method: req.method });
    const u = new URL(req.url, 'http://stub.test');
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (req.method !== 'GET' || u.pathname !== '/api/money-export' || req.headers.authorization !== `Bearer ${token}`) return send(404, { error: 'Not found' });
    if (stub.mode === '404') return send(404, { error: 'Not found' });
    if (stub.mode === 'html') return send(200, '<!doctype html><html><body>Dashboard</body></html>', 'text/html');
    if (stub.mode === 'slow') return setTimeout(() => { try { send(200, stub.build(null)); } catch (_) { /* gone */ } }, 6000);
    const raw = u.searchParams.get('since');
    const since = raw == null ? null : Number(raw);
    const body = stub.build(since);
    if (stub.mode === 'bad-hash') body.hash = (body.hash[0] === 'a' ? 'b' : 'a') + body.hash.slice(1);
    if (stub.mode === 'bad-count') body.count += 1;
    return send(200, body);
  });

  stub.listen = (port) => new Promise((resolve, reject) => {
    stub.server.once('error', reject);
    stub.server.listen(port, '127.0.0.1', () => { stub.port = port; resolve(stub); });
  });
  stub.close = () => new Promise((r) => { stub.server.closeAllConnections && stub.server.closeAllConnections(); stub.server.close(() => r()); });
  return stub;
}

module.exports = { createStub, STORES, LOCAL_KEYS };
