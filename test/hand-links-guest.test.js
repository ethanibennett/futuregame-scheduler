// Short hand links for everyone (owner, 2026-11-28: "Let guests get short links too"; server.js POST /api/hand-links).
// On a scratch server: a guest and a signed-out viewer mint a futurega.me/h/<id> link as an account does; their link
// has no sharer (no guest may retitle another's link or see a question link's hand uncovered, since every guest is
// id 0); it holds only what a #h/ link could carry (fragment-safe characters; a preview title in plain characters or
// "Poker hand"); and a guest or a signed-out viewer mints 30 an IP every 10 minutes, an account without that limit.
//
//   node test/hand-links-guest.test.js        (npm run test:hand-links; ports 4790-4799)
'use strict';
const assert = require('assert');
const { createScratch, boot } = require('./helpers/scratch-server');

let passed = 0;
const ok = (name) => { passed += 1; console.log('  ok  ', name); };

(async () => {
  const scratch = await createScratch({ ports: [4790, 4799], prefix: 'fg-handlinks-' });
  const srv = await boot(scratch.dbPath, {}, { ports: [4790, 4799] });
  const base = `http://127.0.0.1:${srv.port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => ({})), text: r.headers.get('content-type') || '' };
  };
  const preview = async (id) => /<title>([^<]*)<\/title>/.exec(await (await fetch(`${base}/h/${id}`)).text())[1];
  const hand = (k) => `N90.1000-2500-2500~106000,50000,160000.AdKc,-,-/bKd6s2h/b6d/b9c.0r5000,1f,2c${k}`;
  let anonymous = 0;   // mints that count against this IP's 30
  try {
    const guest = (await call('POST', '/api/guest-login', {})).body.token;
    assert.ok(guest, 'a guest token');
    const g = await call('POST', '/api/hand-links', { shorthand: hand(1), title: 'NLH 1K/2.5K/2.5K' }, guest);
    anonymous += 1;
    assert.strictEqual(g.status, 200, JSON.stringify(g.body));
    assert.match(g.body.id, /^[A-Za-z0-9]{8}$/);
    assert.strictEqual((await call('GET', `/api/hand-links/${g.body.id}`)).body.shorthand, hand(1));
    assert.strictEqual(await preview(g.body.id), 'NLH 1K/2.5K/2.5K · futurega.me');
    ok('a guest gets a short link, which opens the hand and previews its title');

    const none = await call('POST', '/api/hand-links', { shorthand: hand(2), title: 'PLO 5/10' });
    anonymous += 1;
    assert.strictEqual(none.status, 200, JSON.stringify(none.body));
    assert.strictEqual((await call('GET', `/api/hand-links/${none.body.id}`)).body.shorthand, hand(2));
    ok('so does a signed-out viewer, with no token at all');

    const again = await call('POST', '/api/hand-links', { shorthand: hand(1), title: 'Something else' }, guest);
    anonymous += 1;
    assert.strictEqual(again.body.id, g.body.id, 'the same hand, the same link');
    assert.strictEqual(await preview(g.body.id), 'NLH 1K/2.5K/2.5K · futurega.me', 'no guest retitles a guest link');
    ok('the same hand shared again is the same link, and a guest cannot retitle it');

    const q = await call('POST', '/api/hand-links', { shorthand: hand(3), title: 'NLH 1K/2.5K', question: { shorthand: hand(3).slice(0, 40), street: 1, action: 0 } }, guest);
    anonymous += 1;
    assert.strictEqual(q.status, 200, JSON.stringify(q.body));
    const seen = await call('GET', `/api/hand-links/${q.body.id}`, null, guest);
    assert.strictEqual(seen.body.answered, false, 'a guest is never the sharer: the question still stops at the decision');
    assert.strictEqual(seen.body.shorthand, hand(3).slice(0, 40));
    ok('a guest\'s question link has no sharer: every guest sees it stop at the decision');

    const bad = await call('POST', '/api/hand-links', { shorthand: 'N90 <script>alert(1)</script>', title: 'x' }, guest);
    anonymous += 1;
    assert.strictEqual(bad.status, 400);
    const odd = await call('POST', '/api/hand-links', { shorthand: hand(4), title: 'Verify your account <a href=x>' });
    anonymous += 1;
    assert.strictEqual(odd.status, 200);
    assert.strictEqual(await preview(odd.body.id), 'Poker hand · futurega.me');
    ok('a guest\'s link holds only fragment-safe characters, and a title in anything but plain characters previews as "Poker hand"');

    const reg = await call('POST', '/api/register', { email: 'links@x.test', password: 'hand-links-password-1', realName: 'Lee Links' });
    assert.strictEqual(reg.status, 201, JSON.stringify(reg.body));
    const acct = reg.body.token;
    const mine = await call('POST', '/api/hand-links', { shorthand: hand(5), title: 'NLH 1/2' }, acct);
    assert.strictEqual(mine.status, 200);
    await call('POST', '/api/hand-links', { shorthand: hand(5), title: 'NLH 1/2/2' }, acct);
    assert.strictEqual(await preview(mine.body.id), 'NLH 1/2/2 · futurega.me');
    const aq = await call('POST', '/api/hand-links', { shorthand: hand(6), question: { shorthand: hand(6).slice(0, 40), street: 1, action: 0 } }, acct);
    assert.strictEqual((await call('GET', `/api/hand-links/${aq.body.id}`, null, acct)).body.answered, true, 'its sharer sees it all');
    assert.strictEqual((await call('GET', `/api/hand-links/${aq.body.id}`, null, guest)).body.answered, false);
    ok('an account is still its links\' sharer: it retitles them and sees its question uncovered');

    let last = null;
    while (anonymous < 30) { last = await call('POST', '/api/hand-links', { shorthand: hand(100 + anonymous), title: 'NLH' }, guest); anonymous += 1; assert.strictEqual(last.status, 200); }
    const over = await call('POST', '/api/hand-links', { shorthand: hand(999), title: 'NLH' }, guest);
    assert.strictEqual(over.status, 429, 'the 31st in 10 minutes from one IP');
    const overNone = await call('POST', '/api/hand-links', { shorthand: hand(998), title: 'NLH' });
    assert.strictEqual(overNone.status, 429, 'signed out, the same IP');
    for (let i = 0; i < 5; i += 1) assert.strictEqual((await call('POST', '/api/hand-links', { shorthand: hand(500 + i), title: 'NLH' }, acct)).status, 200);
    ok('a guest or a signed-out viewer mints 30 an IP every 10 minutes; an account is not held to it');
  } finally {
    await srv.stop();
    scratch.cleanup?.();
  }
  console.log(`hand-links: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
