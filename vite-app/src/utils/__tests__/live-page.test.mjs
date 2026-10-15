// futurega.me/live's helpers (utils/live-page.js): campaign, store and web links, figures, first touch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignFrom, storeLink, webLink, liveFigures, rememberSource } from '../live-page.js';

test('campaignFrom keeps a plain tag and drops anything else', () => {
  assert.equal(campaignFrom('?ct=meta-m1'), 'meta-m1');
  assert.equal(campaignFrom('?ct=a%20b'), '');
  assert.equal(campaignFrom('?ct=' + 'x'.repeat(41)), '');
  assert.equal(campaignFrom(''), '');
});

test('the store link is Apple campaign link, only once the app is listed', () => {
  assert.equal(storeLink(null, 'meta-m1'), null);
  assert.equal(storeLink({ id: '1234567890', pt: '123456' }, 'meta-m1'), 'https://apps.apple.com/app/apple-store/id1234567890?pt=123456&ct=meta-m1&mt=8');
  assert.equal(storeLink({ id: '1234567890', pt: '123456' }, ''), 'https://apps.apple.com/app/apple-store/id1234567890?pt=123456&ct=live&mt=8');
  assert.equal(webLink('reddit'), '/?src=reddit');
  assert.equal(webLink(''), '/');
});

test('liveFigures reads the summary, and blanks while it loads', () => {
  assert.deepEqual(liveFigures(null), { headline: '', note: '' });
  assert.deepEqual(liveFigures({ events: 1198, series: 71, rooms: 40 }), { headline: '1,198 live events', note: 'in 71 series at 40 rooms' });
  assert.deepEqual(liveFigures({ events: 1, series: 1, rooms: 0 }), { headline: '1 live event', note: 'in 1 series' });
});

test('rememberSource keeps the first touch only', () => {
  const m = new Map();
  const store = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  assert.equal(rememberSource('meta-m1', 'https://l.instagram.com/x', store), true);
  assert.equal(rememberSource('reddit', '', store), false);
  const s = JSON.parse(m.get('acqSource'));
  assert.equal(s.ct, 'meta-m1'); assert.equal(s.ref, 'l.instagram.com'); assert.equal(s.landing, 'live');
});

test('captureLanding: tags or an outside referrer, first path segment only, never a backer page', async () => {
  const { captureLanding, landingTags } = await import('../live-page.js');
  const mk = () => { const m = new Map(); return { m, store: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) } }; };
  assert.deepEqual(landingTags('?utm_source=meta&utm_campaign=2701-midatl&fbclid=abc&ct=bad tag'), { utm_source: 'meta', utm_campaign: '2701-midatl' });
  let a = mk();
  assert.equal(captureLanding('', '', '/', a.store), false, 'a plain visit keeps nothing');
  assert.equal(captureLanding('?utm_source=meta', '', '/shared/abc123secret', a.store), true);
  const s = JSON.parse(a.m.get('acqSource'));
  assert.equal(s.landing, 'shared'); assert.equal(s.utm_source, 'meta'); assert.ok(!JSON.stringify(s).includes('abc123secret'));
  assert.equal(captureLanding('?utm_source=x', '', '/', a.store), false, 'first touch only');
  a = mk();
  assert.equal(captureLanding('?utm_source=meta', 'https://l.instagram.com/', '/b/DemoSam7Kq2Vx', a.store), false, 'never on a backer page');
  assert.equal(a.m.size, 0);
});
