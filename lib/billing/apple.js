'use strict';
/*
 * App Store purchases on the account (launch plan, action 10; MONETIZATION-PLAN.md §11; 2026-10-15).
 * The owner's answer to launch question 3: a sign-up through the App Store keeps its plan on the web,
 * because the purchase is recorded on the ACCOUNT, server side, and every client reads
 * GET /api/subscription.
 *
 * Everything Apple sends is a JWS signed by a key whose certificate chains to Apple Root CA - G3
 * (lib/billing/AppleRootCA-G3.cer, downloaded from apple.com/certificateauthority on 2026-10-15,
 * SHA-256 63:34:3A:BF:...:91:79). verifyJws checks the chain, Apple's marker extensions on the
 * intermediate and the leaf, the dates, and the ES256 signature, all offline. No App Store Server API
 * call and no key is needed for this part.
 *
 *   POST /api/subscription/apple/verify   the app sends Transaction.jwsRepresentation after a purchase
 *   POST /api/subscription/apple/webhook  App Store Server Notifications v2 (renewals, lapses, refunds)
 *
 * The purchase is tied to the account by appAccountToken: a UUID per account
 * (users.app_account_token) the app passes to Product.purchase(options: [.appAccountToken(uuid)]),
 * which Apple then echoes in every transaction and notification.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APPLE_ROOT = fs.readFileSync(path.join(__dirname, 'AppleRootCA-G3.cer'));
// Apple's marker extensions: 1.2.840.113635.100.6.2.1 on the WWDR intermediate,
// 1.2.840.113635.100.6.11.1 on the App Store signing leaf (DER: OID tag, length, value).
const OID_INTERMEDIATE = Buffer.from('060a2a864886f76364060201', 'hex');
const OID_LEAF = Buffer.from('060a2a864886f76364060b01', 'hex');

class AppleVerifyError extends Error {}

const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Verifies a JWS from Apple and returns its payload. opts.roots: trusted root certificates (DER or
 * PEM Buffers; default Apple Root CA - G3); opts.now: the time the certificates must be valid at.
 * Throws AppleVerifyError on anything wrong.
 */
function verifyJws(jws, { roots = [APPLE_ROOT], now = Date.now() } = {}) {
  const parts = typeof jws === 'string' ? jws.split('.') : [];
  if (parts.length !== 3) throw new AppleVerifyError('not a JWS');
  let header;
  try { header = JSON.parse(b64url(parts[0]).toString('utf8')); } catch { throw new AppleVerifyError('bad header'); }
  if (header.alg !== 'ES256') throw new AppleVerifyError('unexpected alg');
  if (!Array.isArray(header.x5c) || header.x5c.length < 3) throw new AppleVerifyError('no certificate chain');
  let leaf, inter, root;
  try {
    [leaf, inter, root] = header.x5c.slice(0, 3).map((c) => new crypto.X509Certificate(Buffer.from(c, 'base64')));
  } catch { throw new AppleVerifyError('bad certificate'); }
  const trusted = roots.map((r) => new crypto.X509Certificate(r).raw);
  if (!trusted.some((t) => t.equals(root.raw))) throw new AppleVerifyError('untrusted root');
  if (!inter.verify(root.publicKey) || !leaf.verify(inter.publicKey)) throw new AppleVerifyError('broken chain');
  if (!inter.raw.includes(OID_INTERMEDIATE) || !leaf.raw.includes(OID_LEAF)) throw new AppleVerifyError('not an App Store certificate');
  for (const c of [leaf, inter, root]) {
    if (now < Date.parse(c.validFrom) || now > Date.parse(c.validTo)) throw new AppleVerifyError('certificate out of date');
  }
  const ok = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, b64url(parts[2]));
  if (!ok) throw new AppleVerifyError('bad signature');
  try { return JSON.parse(b64url(parts[1]).toString('utf8')); } catch { throw new AppleVerifyError('bad payload'); }
}

/* Product ids -> plans. The owner creates these in App Store Connect (docs/app-store-listing.md,
   "In-app purchases"); APPLE_PRODUCTS (JSON, the same shape) overrides. A Summer Pass is a
   non-renewing subscription with no expiresDate from Apple, so its end is fixed here: 1 Aug of the
   year it was bought (MONETIZATION-PLAN.md §4). */
const DEFAULT_PRODUCTS = {
  'app.futurega.me.pro.monthly': { tier: 'suite_pro' },
  'app.futurega.me.pro.annual': { tier: 'suite_pro' },
  'app.futurega.me.pro.summer': { tier: 'suite_pro', endsAugust: true },
  'app.futurega.me.proplus.monthly': { tier: 'suite_pro_plus' },
  'app.futurega.me.proplus.annual': { tier: 'suite_pro_plus' },
  'app.futurega.me.proplus.summer': { tier: 'suite_pro_plus', endsAugust: true },
};
function products() {
  try { return process.env.APPLE_PRODUCTS ? JSON.parse(process.env.APPLE_PRODUCTS) : DEFAULT_PRODUCTS; }
  catch { return DEFAULT_PRODUCTS; }
}
const bundleId = () => process.env.APPLE_BUNDLE_ID || 'app.futurega.me.beta';

/** The fields we use from a JWSTransactionDecodedPayload. */
function readTransaction(p) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    originalTransactionId: p.originalTransactionId ? String(p.originalTransactionId) : null,
    transactionId: p.transactionId ? String(p.transactionId) : null,
    productId: p.productId || null,
    bundleId: p.bundleId || null,
    appAccountToken: p.appAccountToken ? String(p.appAccountToken).toLowerCase() : null,
    purchaseDate: num(p.purchaseDate),
    originalPurchaseDate: num(p.originalPurchaseDate),
    expiresDate: num(p.expiresDate),
    revocationDate: num(p.revocationDate),
    environment: p.environment || null,
  };
}

/** What the subscriptions row should say for a transaction: { tier, status, startsAt, endsAt } or null. */
function planFor(tx, now = Date.now()) {
  const product = products()[tx.productId];
  if (!product) return null;
  const startsAt = tx.purchaseDate || tx.originalPurchaseDate || now;
  let endsAt = tx.expiresDate;
  if (!endsAt && product.endsAugust) {
    const y = new Date(startsAt).getUTCFullYear();
    endsAt = Date.UTC(y, 7, 1);
  }
  let status = 'active';
  if (tx.revocationDate) status = 'cancelled';
  else if (endsAt && endsAt <= now) status = 'expired';
  return { tier: product.tier, status, startsAt, endsAt: endsAt || null };
}

function rows(db, sql, p = []) { const r = db.exec(sql, p); return r[0] ? r[0].values : []; }

function migrate(db) {
  const info = db.exec('PRAGMA table_info(users)');
  if (info[0] && !info[0].values.some((v) => v[1] === 'app_account_token')) db.run('ALTER TABLE users ADD COLUMN app_account_token TEXT');
  db.run(`CREATE TABLE IF NOT EXISTS apple_notifications (
    uuid TEXT PRIMARY KEY,
    type TEXT, subtype TEXT,
    original_transaction_id TEXT,
    user_id INTEGER,
    environment TEXT,
    received_at INTEGER NOT NULL
  )`);
}

/** The account's appAccountToken, made on first ask. */
function accountToken(db, userId) {
  const r = rows(db, 'SELECT app_account_token FROM users WHERE id = ?', [userId]);
  if (!r.length) return null;
  if (r[0][0]) return r[0][0];
  const t = crypto.randomUUID();
  db.run('UPDATE users SET app_account_token = ? WHERE id = ?', [t, userId]);
  return t;
}
function userForToken(db, token) {
  if (!token) return null;
  const r = rows(db, 'SELECT id FROM users WHERE lower(app_account_token) = ?', [String(token).toLowerCase()]);
  return r.length ? r[0][0] : null;
}
function userForOriginal(db, originalTransactionId) {
  const r = rows(db, "SELECT user_id FROM subscriptions WHERE source = 'apple' AND source_id = ? ORDER BY updated_at DESC LIMIT 1", [originalTransactionId]);
  return r.length ? r[0][0] : null;
}

/**
 * Writes a verified transaction onto the account: one subscriptions row per original transaction
 * (source 'apple', source_id = originalTransactionId), updated in place as Apple reports changes.
 * An active App Store plan closes a running trial. `override` lets a notification set the status
 * (grace, expired) where the transaction alone cannot say it. Returns the plan written, or null.
 */
function applyTransaction(db, userId, tx, { now = Date.now(), override = null } = {}) {
  const plan = planFor(tx, now);
  if (!plan || !tx.originalTransactionId) return null;
  const status = override && override.status ? override.status : plan.status;
  const endsAt = override && override.endsAt ? override.endsAt : plan.endsAt;
  const existing = rows(db, "SELECT id FROM subscriptions WHERE source = 'apple' AND source_id = ?", [tx.originalTransactionId]);
  if (existing.length) {
    db.run('UPDATE subscriptions SET user_id = ?, tier = ?, status = ?, ends_at = ?, updated_at = ? WHERE id = ?',
      [userId, plan.tier, status, endsAt, now, existing[0][0]]);
  } else {
    db.run(`INSERT INTO subscriptions (user_id, tier, status, source, source_id, starts_at, ends_at, created_at, updated_at)
            VALUES (?, ?, ?, 'apple', ?, ?, ?, ?, ?)`,
      [userId, plan.tier, status, tx.originalTransactionId, plan.startsAt, endsAt, now, now]);
  }
  if (status === 'active') {
    db.run("UPDATE subscriptions SET status = 'cancelled', updated_at = ? WHERE user_id = ? AND status = 'trial'", [now, userId]);
  }
  return { ...plan, status, endsAt };
}

/** A notification's effect on the row: the status Apple's type and subtype mean, or null for "as the transaction says". */
function overrideFor(type, subtype, renewal) {
  switch (type) {
    case 'EXPIRED':
    case 'GRACE_PERIOD_EXPIRED':
      return { status: 'expired' };
    case 'DID_FAIL_TO_RENEW':
      return subtype === 'GRACE_PERIOD'
        ? { status: 'grace', endsAt: renewal && Number(renewal.gracePeriodExpiresDate) ? Number(renewal.gracePeriodExpiresDate) : null }
        : { status: 'expired' };
    case 'REFUND':
    case 'REVOKE':
      return { status: 'cancelled' };
    default:
      return null; // SUBSCRIBED, DID_RENEW, OFFER_REDEEMED, DID_CHANGE_RENEWAL_*, RENEWAL_EXTENDED, ...
  }
}

/**
 * One App Store Server Notification v2: verify, ignore a repeat, find the account, apply.
 * Returns { ok, duplicate?, userId?, type, subtype, applied? }. Throws AppleVerifyError on a bad
 * signature (the route answers 400 so Apple retries; a good one always gets 200).
 */
function handleNotification(db, signedPayload, { roots, now = Date.now() } = {}) {
  const n = verifyJws(signedPayload, { roots, now });
  const type = n.notificationType || null, subtype = n.subtype || null;
  const uuid = n.notificationUUID ? String(n.notificationUUID) : null;
  if (uuid && rows(db, 'SELECT 1 FROM apple_notifications WHERE uuid = ?', [uuid]).length) return { ok: true, duplicate: true, type, subtype };
  const data = n.data || {};
  if (data.bundleId && data.bundleId !== bundleId()) throw new AppleVerifyError('another app');
  const tx = data.signedTransactionInfo ? readTransaction(verifyJws(data.signedTransactionInfo, { roots, now })) : null;
  const renewal = data.signedRenewalInfo ? verifyJws(data.signedRenewalInfo, { roots, now }) : null;
  let userId = null, applied = null;
  if (tx) {
    userId = userForToken(db, tx.appAccountToken) || userForOriginal(db, tx.originalTransactionId);
    if (userId) applied = applyTransaction(db, userId, tx, { now, override: overrideFor(type, subtype, renewal) });
  }
  if (uuid) {
    db.run('INSERT OR IGNORE INTO apple_notifications (uuid, type, subtype, original_transaction_id, user_id, environment, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuid, type, subtype, tx ? tx.originalTransactionId : null, userId, data.environment || null, now]);
  }
  return { ok: true, type, subtype, userId, applied };
}

/**
 * The app's own report of a purchase (Transaction.jwsRepresentation), for the signed-in account.
 * Returns the plan written. Throws AppleVerifyError on a bad signature, another app's transaction,
 * an unknown product, or a transaction bought for a different account.
 */
function verifyPurchase(db, userId, signedTransaction, { roots, now = Date.now() } = {}) {
  const tx = readTransaction(verifyJws(signedTransaction, { roots, now }));
  if (tx.bundleId !== bundleId()) throw new AppleVerifyError('another app');
  if (!products()[tx.productId]) throw new AppleVerifyError('unknown product');
  const mine = accountToken(db, userId);
  if (tx.appAccountToken && tx.appAccountToken !== String(mine).toLowerCase()) throw new AppleVerifyError('bought for another account');
  const owner = userForOriginal(db, tx.originalTransactionId);
  if (owner && owner !== userId) throw new AppleVerifyError('bought for another account');
  return applyTransaction(db, userId, tx, { now });
}

module.exports = {
  AppleVerifyError, verifyJws, readTransaction, planFor, migrate, accountToken, applyTransaction,
  overrideFor, handleNotification, verifyPurchase, DEFAULT_PRODUCTS,
};
