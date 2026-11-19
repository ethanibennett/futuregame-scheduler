#!/usr/bin/env node
// Print the highest build number App Store Connect has on record for a given
// bundle ID. Exits with status 0 + "0" if the app isn't found or has no builds
// (so the caller can use it as a baseline for bumping).
//
// Usage:
//   node scripts/asc-latest-build.js <p8KeyPath> <keyId> <issuerId> <bundleId> [--version]
//
// --version (owner, 2026-11-19: "let's start changing the version number when we push to testflight, next should
// be 1.01 etc"): print instead the highest version string (CFBundleShortVersionString) App Store Connect has, as
// "1.0" or "1.04", compared number by number; "0" when there is none.
//
// Auth uses the App Store Connect REST API with an ES256 JWT signed by the p8
// key. Token TTL is capped at 20 minutes by Apple; we use 10 minutes.

const fs = require('fs');
const https = require('https');

const [,, keyPath, keyId, issuerId, bundleId, mode] = process.argv;
const WANT_VERSION = mode === '--version';
if (!keyPath || !keyId || !issuerId || !bundleId) {
  console.error('Usage: asc-latest-build.js <p8KeyPath> <keyId> <issuerId> <bundleId>');
  process.exit(2);
}

// jsonwebtoken is already a runtime dep of this project.
const jwt = require('jsonwebtoken');

const privateKey = fs.readFileSync(keyPath, 'utf8');
const now = Math.floor(Date.now() / 1000);
const token = jwt.sign(
  { iss: issuerId, iat: now, exp: now + 10 * 60, aud: 'appstoreconnect-v1' },
  privateKey,
  { algorithm: 'ES256', header: { kid: keyId, typ: 'JWT' } }
);

function ascGet(path) {
  return new Promise((resolve, reject) => {
    const url = `https://api.appstoreconnect.apple.com${path}`;
    https.get(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`ASC ${res.statusCode}: ${data.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('parse fail: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

(async () => {
  // 1. App lookup by bundle ID. Apple's filter[bundleId] is NOT an exact match
  //    — it does substring/prefix-ish matching, so searching for
  //    "app.futurega.me" also returns "app.futurega.me.beta". We have to list
  //    and exact-match client-side.
  const apps = await ascGet(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=20&fields[apps]=bundleId`);
  const app = (apps && apps.data || []).find(a => a.attributes && a.attributes.bundleId === bundleId);
  if (!app) {
    // Brand-new bundle that's never been uploaded — start from 0.
    console.log('0');
    return;
  }
  const appId = app.id;

  if (WANT_VERSION) {
    const pre = await ascGet(`/v1/preReleaseVersions?filter[app]=${appId}&limit=200&fields[preReleaseVersions]=version`);
    const parts = (v) => String(v).split('.').map((x) => parseInt(x, 10) || 0);
    const cmp = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
    const list = (pre.data || []).map((p) => p.attributes && p.attributes.version).filter((v) => /^\d+(\.\d+){0,2}$/.test(String(v || '')));
    console.log(list.length ? list.sort(cmp).pop() : '0');
    return;
  }

  // 2. Highest build number across all versions. Apple's `sort=-version` is a
  //    string sort, so "9" > "10" — we pull a page and max ourselves.
  const builds = await ascGet(`/v1/builds?filter[app]=${appId}&limit=200&fields[builds]=version`);
  const versions = (builds.data || [])
    .map((b) => parseInt(b.attributes?.version, 10))
    .filter((n) => Number.isFinite(n));
  const max = versions.length ? Math.max(...versions) : 0;
  console.log(String(max));
})().catch((err) => {
  // Swallow errors so the caller can fall back to local counter; log to stderr
  // for diagnostics.
  console.error('[asc-latest-build] ' + (err && err.message ? err.message : err));
  console.log('0');
});
