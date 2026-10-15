// Native ad attribution, server side (lib/attribution.js): postback copies stored, Apple Ads resolved once.
'use strict';
const assert = require('assert');
const initSqlJs = require('sql.js');
const attribution = require('../lib/attribution');
const growth = require('../lib/growth');

let passed = 0;
const t = async (name, fn) => { await fn(); passed += 1; console.log('  ok  ', name); };

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  growth.migrate(db); attribution.migrate(db); attribution.migrate(db);

  await t('a SKAdNetwork 4 postback copy is stored with its campaign and values', () => {
    const r = attribution.storePostback(db, 'skadnetwork', JSON.stringify({ version: '4.0', 'ad-network-id': 'v9wttpbfk9.skadnetwork',
      'source-identifier': '5239', 'app-id': 6449000000, 'transaction-id': 'abc', 'fidelity-type': 1, 'conversion-value': 12,
      'postback-sequence-index': 0, 'did-win': true, 'attribution-signature': 'MEUC' }));
    assert.deepStrictEqual(r, { kind: 'skadnetwork', campaign: '5239', fine: 12, coarse: null, sequence: 0, didWin: 1 });
    const c = attribution.storePostback(db, 'adattributionkit', { 'advertised-item-identifier': 6449000000, 'source-identifier': '77', 'coarse-conversion-value': 'medium', 'postback-sequence-index': 1 });
    assert.deepStrictEqual([c.coarse, c.sequence, c.fine], ['medium', 1, null]);
    assert.strictEqual(db.exec('SELECT COUNT(*) FROM attribution_postbacks')[0].values[0][0], 2);
  });

  await t('anything that is not a postback is refused', () => {
    assert.throws(() => attribution.storePostback(db, 'skadnetwork', '{"hello":1}'), /not a postback/);
    assert.throws(() => attribution.storePostback(db, 'skadnetwork', 'nope'), /not JSON/);
    assert.throws(() => attribution.storePostback(db, 'skadnetwork', 'x'.repeat(9000)), /too large/);
  });

  await t('Apple Ads: an attributed install is recorded once; an unknown token records nothing', async () => {
    const yes = async () => ({ ok: true, status: 200, json: async () => ({ attribution: true, orgId: 40669820, campaignId: 542370539, adGroupId: 542317095, keywordId: 87675432, conversionType: 'Download', secret: 'x' }) });
    const r = await attribution.resolveAppleAds(db, growth, 1, 'TOKEN-1234567890', { fetchImpl: yes, now: 1000 });
    assert.deepStrictEqual(r, { recorded: true, attribution: true, campaignId: 542370539 });
    const row = JSON.parse(db.exec("SELECT data FROM growth_events WHERE kind = 'apple_ads' AND user_id = 1")[0].values[0][0]);
    assert.deepStrictEqual(row, { orgId: 40669820, campaignId: 542370539, adGroupId: 542317095, keywordId: 87675432, conversionType: 'Download' });
    assert.strictEqual((await attribution.resolveAppleAds(db, growth, 1, 'TOKEN-1234567890', { fetchImpl: yes })).recorded, false, 'once');
    const notFound = async () => ({ ok: false, status: 404, json: async () => ({}) });
    assert.deepStrictEqual(await attribution.resolveAppleAds(db, growth, 2, 'TOKEN-1234567890', { fetchImpl: notFound }), { recorded: false, attribution: false });
    const organic = async () => ({ ok: true, status: 200, json: async () => ({ attribution: false }) });
    assert.strictEqual((await attribution.resolveAppleAds(db, growth, 3, 'TOKEN-1234567890', { fetchImpl: organic })).attribution, false);
    await assert.rejects(attribution.resolveAppleAds(db, growth, 3, 'short', { fetchImpl: yes }), /bad token/);
  });

  console.log(`attribution.test.js - ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
