// App Store purchases on the account (lib/billing/apple.js): the JWS chain checks, the purchase report,
// and the server notifications, signed with a TEST ONLY chain (test/fixtures/apple-test-chain: a fake
// root, intermediate and leaf carrying Apple's marker extensions; only the leaf's key is kept).
//
//   node test/apple-billing.test.js        (npm run test:apple-billing)
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const apple = require('../lib/billing/apple');

const FIX = path.join(__dirname, 'fixtures', 'apple-test-chain');
const pem = (f) => fs.readFileSync(path.join(FIX, f));
const der = (f) => new crypto.X509Certificate(pem(f)).raw.toString('base64');
const ROOTS = [pem('root.pem')];
const KEY = crypto.createPrivateKey(pem('leaf.pkcs8.pem'));
const X5C = [der('leaf.pem'), der('inter.pem'), der('root.pem')];
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function sign(payload, { x5c = X5C, key = KEY } = {}) {
  const h = b64u(JSON.stringify({ alg: 'ES256', x5c }));
  const p = b64u(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64u(sig)}`;
}

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log('  ok  ', name); };
const NOW = Date.UTC(2027, 2, 2, 12);
const DAY = 864e5;

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
  db.run(`CREATE TABLE subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, tier TEXT NOT NULL,
    status TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT, starts_at INTEGER NOT NULL, ends_at INTEGER,
    trial_ends_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  db.run("INSERT INTO users (id, username) VALUES (1, 'alice'), (2, 'bob')");
  apple.migrate(db);
  apple.migrate(db);
  const sub = (id) => { const r = db.exec(`SELECT tier, status, ends_at, user_id FROM subscriptions WHERE source = 'apple' AND source_id = '${id}'`); return r[0] ? r[0].values[0] : null; };

  t('verifyJws: a good chain and signature verify; the real Apple root is the default', () => {
    assert.deepStrictEqual(apple.verifyJws(sign({ a: 1 }), { roots: ROOTS, now: NOW }), { a: 1 });
    assert.throws(() => apple.verifyJws(sign({ a: 1 }), { now: NOW }), /untrusted root/);
  });

  t('verifyJws: a forged signature, a short chain, a wrong alg and an expired chain are refused', () => {
    const good = sign({ a: 1 }).split('.');
    const forged = [good[0], b64u(JSON.stringify({ a: 2 })), good[2]].join('.');
    assert.throws(() => apple.verifyJws(forged, { roots: ROOTS, now: NOW }), /bad signature/);
    assert.throws(() => apple.verifyJws(sign({ a: 1 }, { x5c: X5C.slice(0, 2) }), { roots: ROOTS, now: NOW }), /no certificate chain/);
    const otherKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
    assert.throws(() => apple.verifyJws(sign({ a: 1 }, { key: otherKey }), { roots: ROOTS, now: NOW }), /bad signature/);
    assert.throws(() => apple.verifyJws(sign({ a: 1 }, { x5c: [X5C[1], X5C[1], X5C[2]] }), { roots: ROOTS, now: NOW }), /broken chain|not an App Store/);
    assert.throws(() => apple.verifyJws(sign({ a: 1 }), { roots: ROOTS, now: Date.UTC(2200, 0, 1) }), /out of date/);
    assert.throws(() => apple.verifyJws('a.b', { roots: ROOTS }), /not a JWS/);
  });

  const token1 = apple.accountToken(db, 1);
  t('accountToken: one UUID per account, kept', () => {
    assert.match(token1, /^[0-9a-f-]{36}$/);
    assert.strictEqual(apple.accountToken(db, 1), token1);
  });

  const tx = (o = {}) => ({ originalTransactionId: '2000001', transactionId: '2000001', productId: 'app.futurega.me.pro.annual',
    bundleId: 'app.futurega.me.beta', appAccountToken: token1, purchaseDate: NOW, expiresDate: NOW + 365 * DAY, environment: 'Sandbox', ...o });

  t('verifyPurchase: the app reports a purchase and the account gets the plan; a trial closes', () => {
    db.run("INSERT INTO subscriptions (user_id, tier, status, source, starts_at, ends_at, trial_ends_at, created_at, updated_at) VALUES (1, 'suite_pro', 'trial', 'system', 1, 9e15, 9e15, 1, 1)");
    const plan = apple.verifyPurchase(db, 1, sign(tx()), { roots: ROOTS, now: NOW });
    assert.strictEqual(plan.status, 'active');
    assert.deepStrictEqual(sub('2000001'), ['suite_pro', 'active', NOW + 365 * DAY, 1]);
    assert.strictEqual(db.exec("SELECT status FROM subscriptions WHERE source = 'system'")[0].values[0][0], 'cancelled');
  });

  t('verifyPurchase refuses another app, an unknown product, and someone else\'s purchase', () => {
    assert.throws(() => apple.verifyPurchase(db, 1, sign(tx({ bundleId: 'com.other' })), { roots: ROOTS, now: NOW }), /another app/);
    assert.throws(() => apple.verifyPurchase(db, 1, sign(tx({ productId: 'x.y' })), { roots: ROOTS, now: NOW }), /unknown product/);
    assert.throws(() => apple.verifyPurchase(db, 2, sign(tx()), { roots: ROOTS, now: NOW }), /another account/);
  });

  const note = (type, subtype, txo, extra = {}) => sign({ notificationType: type, subtype, notificationUUID: crypto.randomUUID(),
    data: { bundleId: 'app.futurega.me.beta', environment: 'Sandbox', signedTransactionInfo: sign(txo), ...extra } });

  t('notifications: renewal extends, grace holds, expiry and refund end it', () => {
    const later = NOW + 365 * DAY;
    let r = apple.handleNotification(db, note('DID_RENEW', null, tx({ transactionId: '2000002', purchaseDate: later, expiresDate: later + 365 * DAY })), { roots: ROOTS, now: later });
    assert.strictEqual(r.userId, 1);
    assert.deepStrictEqual(sub('2000001').slice(0, 3), ['suite_pro', 'active', later + 365 * DAY]);
    const grace = later + 365 * DAY + 16 * DAY;
    r = apple.handleNotification(db, note('DID_FAIL_TO_RENEW', 'GRACE_PERIOD', tx({ expiresDate: later + 365 * DAY }),
      { signedRenewalInfo: sign({ gracePeriodExpiresDate: grace }) }), { roots: ROOTS, now: later + 365 * DAY + DAY });
    assert.deepStrictEqual(sub('2000001').slice(0, 3), ['suite_pro', 'grace', grace]);
    apple.handleNotification(db, note('EXPIRED', 'VOLUNTARY', tx({ expiresDate: later + 365 * DAY })), { roots: ROOTS, now: grace + DAY });
    assert.strictEqual(sub('2000001')[1], 'expired');
    apple.handleNotification(db, note('REFUND', null, tx({ revocationDate: grace + 2 * DAY })), { roots: ROOTS, now: grace + 2 * DAY });
    assert.strictEqual(sub('2000001')[1], 'cancelled');
  });

  t('notifications: a repeat is ignored, a forgery throws, an unknown account is recorded but changes nothing', () => {
    const n = note('DID_RENEW', null, tx());
    assert.strictEqual(apple.handleNotification(db, n, { roots: ROOTS, now: NOW }).duplicate, undefined);
    assert.strictEqual(apple.handleNotification(db, n, { roots: ROOTS, now: NOW }).duplicate, true);
    assert.throws(() => apple.handleNotification(db, n.slice(0, -4) + 'AAAA', { roots: ROOTS, now: NOW }), /bad signature|bad payload/);
    const stranger = apple.handleNotification(db, note('SUBSCRIBED', 'INITIAL_BUY', tx({ originalTransactionId: '9', appAccountToken: crypto.randomUUID() })), { roots: ROOTS, now: NOW });
    assert.strictEqual(stranger.userId, null);
    assert.strictEqual(sub('9'), null);
  });

  t('a Summer Pass (no expiresDate) ends on 1 August of the year it was bought', () => {
    const p = apple.planFor(apple.readTransaction({ productId: 'app.futurega.me.pro.summer', purchaseDate: Date.UTC(2027, 3, 10) }), Date.UTC(2027, 3, 10));
    assert.deepStrictEqual([p.tier, p.status, new Date(p.endsAt).toISOString().slice(0, 10)], ['suite_pro', 'active', '2027-08-01']);
  });

  console.log(`apple-billing.test.js - ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
