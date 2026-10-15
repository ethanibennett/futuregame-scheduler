'use strict';
/*
 * Native ad attribution, server side (launch plan §13, "Tracking and attribution": first-party, no SDKs;
 * 2026-10-15).
 *
 *   Install postbacks  Apple sends a COPY of each SKAdNetwork / AdAttributionKit install postback to the
 *                      app's own domain when Info.plist names it (NSAdvertisingAttributionReportEndpoint,
 *                      and AttributionCopyEndpoint in the AdAttributionKit dictionary, both
 *                      https://futurega.me). They are anonymous by design: no user, no device. Stored as
 *                      sent in attribution_postbacks for the conversion-value counts Meta cannot decode
 *                      without its SDK.
 *   Apple Ads          The app posts AAAttribution.attributionToken() after sign-in (it lives 24 hours);
 *                      the server asks Apple's attribution API which campaign, ad group and keyword the
 *                      install came from and records it once on the account (growth_events 'apple_ads').
 */
const APPLE_ADS_URL = 'https://api-adservices.apple.com/api/v1/';
const MAX_POSTBACK = 8192;

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS attribution_postbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,                 -- 'skadnetwork' | 'adattributionkit'
    received_at INTEGER NOT NULL,
    campaign TEXT,                      -- source-identifier, or campaign-id on older versions
    fine_value INTEGER, coarse_value TEXT,
    sequence INTEGER, did_win INTEGER,
    body TEXT NOT NULL
  )`);
}

/** Stores one postback copy. Returns the row's fields, or throws on a body that is not one. */
function storePostback(db, kind, body, now = Date.now()) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (raw.length > MAX_POSTBACK) throw new Error('too large');
  let p;
  try { p = typeof body === 'string' ? JSON.parse(body) : body; } catch { throw new Error('not JSON'); }
  if (!p || typeof p !== 'object' || !(p['ad-network-id'] || p['advertised-item-identifier'] || p['app-id'] || p['source-identifier'] || p['campaign-id'])) {
    throw new Error('not a postback');
  }
  const num = (v) => (Number.isInteger(Number(v)) && v !== '' && v != null ? Number(v) : null);
  const row = {
    kind,
    campaign: p['source-identifier'] != null ? String(p['source-identifier']) : (p['campaign-id'] != null ? String(p['campaign-id']) : null),
    fine: num(p['conversion-value'] ?? p['fine-conversion-value']),
    coarse: p['coarse-conversion-value'] ? String(p['coarse-conversion-value']).slice(0, 16) : null,
    sequence: num(p['postback-sequence-index']),
    didWin: p['did-win'] === true ? 1 : p['did-win'] === false ? 0 : null,
  };
  db.run('INSERT INTO attribution_postbacks (kind, received_at, campaign, fine_value, coarse_value, sequence, did_win, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [kind, now, row.campaign, row.fine, row.coarse, row.sequence, row.didWin, raw]);
  return row;
}

/**
 * Resolves an Apple Ads attribution token for an account and records it once. fetchImpl is injected
 * for tests. Returns { recorded, attribution, campaignId? }. A token Apple does not know (404) or one
 * past its 24 hours is not an error: there is simply nothing to record.
 */
async function resolveAppleAds(db, growth, userId, token, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) throw new Error('bad token');
  const r = await fetchImpl(APPLE_ADS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: token, signal: AbortSignal.timeout(15000) });
  if (r.status === 404 || r.status === 400) return { recorded: false, attribution: false };
  if (!r.ok) throw new Error(`Apple answered ${r.status}`);
  const a = await r.json();
  if (!a || a.attribution !== true) return { recorded: false, attribution: false };
  const keep = {};
  for (const k of ['orgId', 'campaignId', 'adGroupId', 'keywordId', 'adId', 'countryOrRegion', 'conversionType', 'clickDate']) {
    if (a[k] != null) keep[k] = typeof a[k] === 'number' ? a[k] : String(a[k]).slice(0, 64);
  }
  const recorded = growth.recordOnce(db, userId, 'apple_ads', keep, now);
  return { recorded, attribution: true, campaignId: keep.campaignId ?? null };
}

module.exports = { APPLE_ADS_URL, migrate, storePostback, resolveAppleAds };
