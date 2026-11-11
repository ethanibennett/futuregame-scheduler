// The Features catalogue's first batch (2026-11-11): push switches (39), report and block (38), account
// security (42), invite links (37/36) and Report a problem (48). Boots server.js on a scratch DB
// (ports 4750-4759). Delivery stays off (no RENDER), so nothing is pushed.
const assert = require('assert');
const { createScratch, boot } = require('./helpers/scratch-server');

(async () => {
  const scratch = await createScratch({ ports: [4750, 4759], prefix: 'fg-feat-social-' });
  const srv = await boot(scratch.dbPath, {}, { ports: [4750, 4759] });
  const base = `http://127.0.0.1:${srv.port}`;
  let pass = 0, fail = 0;
  const t = async (name, fn) => { try { await fn(); pass += 1; console.log('  ok   ' + name); } catch (e) { fail += 1; console.log('  FAIL ' + name + '\n       ' + e.message); } };
  const call = async (method, p, body, token) => {
    const r = await fetch(base + p, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})), headers: r.headers };
  };
  const reg = async (u, extra = {}) => {
    const r = await call('POST', '/api/register', { username: u, email: `${u}@x.test`, password: `${u}-password-1`, realName: u.toUpperCase(), ...extra });
    return r.json;
  };
  try {
    const a = await reg('alice'), b = await reg('bobby'), c = await reg('carol');

    await t('push switches: defaults, a change, a refused value, a muted group', async () => {
      let r = await call('GET', '/api/notification-prefs', null, a.token);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.prefs.groups, 'mentions');
      assert.strictEqual(r.json.prefs.friends, 'off');
      assert.strictEqual(r.json.delivery, false);
      r = await call('PUT', '/api/notification-prefs', { kind: 'friends', value: 'on' }, a.token);
      assert.strictEqual(r.json.prefs.friends, 'on');
      r = await call('PUT', '/api/notification-prefs', { kind: 'groups', value: 'loud' }, a.token);
      assert.strictEqual(r.status, 400);
      r = await call('PUT', '/api/notification-prefs', { kind: 'group:7', value: 'off' }, a.token);
      assert.deepStrictEqual(r.json.prefs.mutedGroups, [7]);
    });

    await t('a player is not pushed with delivery off (scratch servers stay silent)', async () => {
      const pp = require('../lib/player-push');
      assert.strictEqual(pp.deliveryDecision({}).on, false);
      assert.strictEqual(pp.deliveryDecision({ RENDER: '1' }).on, true);
      assert.strictEqual(pp.deliveryDecision({ RENDER: '1', PLAYER_DELIVERY: '0' }).on, false);
      assert.strictEqual(pp.deliveryDecision({ PLAYER_DELIVERY: 'yes' }).on, false);
      assert.ok(pp.mentions('hi @Bobby, you in?', 'bobby'));
      assert.ok(!pp.mentions('hi @bobby2', 'bobby'));
      assert.ok(!pp.mentions('email bob@bobby.com', 'bobby'));
    });

    // A group with alice and bobby, and a message from bobby.
    let gid, msgId;
    await t('setup: connected, a group, a message carrying its id', async () => {
      await call('POST', '/api/share-request', { username: 'bobby' }, a.token);
      const n = await call('GET', '/api/notifications', null, b.token);
      const reqId = n.json.buddyRequests[0].id;
      await call('PUT', `/api/share-request/${reqId}/accept`, null, b.token);
      const g = await call('POST', '/api/groups', { name: 'Harbor Crew' }, a.token);
      gid = g.json.id || g.json.groupId;
      const inv = await call('POST', `/api/groups/${gid}/members`, { username: 'bobby' }, a.token);
      assert.strictEqual(inv.status, 201);
      const n2 = await call('GET', '/api/notifications', null, b.token);
      await call('PUT', `/api/group-invites/${n2.json.groupInvites[0].id}/accept`, null, b.token);
      await call('POST', `/api/groups/${gid}/messages`, { message: 'rude words' }, b.token);
      const feed = await call('GET', `/api/groups/${gid}/feed`, null, a.token);
      msgId = feed.json.find((m) => m.content === 'rude words').id;
      assert.ok(msgId);
    });

    await t('a report of a message: filed once, listed for the admin only', async () => {
      let r = await call('POST', '/api/reports', { kind: 'message', refId: msgId, text: 'abusive' }, a.token);
      assert.strictEqual(r.status, 201);
      r = await call('POST', '/api/reports', { kind: 'message', refId: msgId }, c.token);
      assert.strictEqual(r.status, 403, 'carol is not in the group');
      r = await call('GET', '/api/admin/reports', null, a.token);
      assert.strictEqual(r.status, 403);
    });

    await t('block: the connection ends, the feed hides them, search leaves them out, a request goes nowhere', async () => {
      let r = await call('POST', '/api/blocks', { userId: b.userId }, a.token);
      assert.strictEqual(r.status, 200);
      const buddies = await call('GET', '/api/share-buddies', null, a.token);
      assert.ok(!JSON.stringify(buddies.json).includes('"bobby"'), 'no longer connected');
      const feed = await call('GET', `/api/groups/${gid}/feed`, null, a.token);
      assert.ok(!feed.json.some((m) => m.user_id === b.userId), 'bobby hidden from alice');
      const feedB = await call('GET', `/api/groups/${gid}/feed`, null, b.token);
      assert.ok(!feedB.json.some((m) => m.user_id === a.userId), 'alice hidden from bobby');
      const s = await call('GET', '/api/users/search?q=al', null, b.token);
      assert.ok(!s.json.some((u) => u.username === 'alice'));
      r = await call('POST', '/api/share-request', { username: 'alice' }, b.token);
      assert.strictEqual(r.status, 200, 'answered as sent');
      const n = await call('GET', '/api/notifications', null, a.token);
      assert.strictEqual(n.json.buddyRequests.length, 0, 'and nothing arrived');
      r = await call('GET', '/api/blocks', null, a.token);
      assert.strictEqual(r.json.blocked[0].username, 'bobby');
      r = await call('GET', '/api/blocks', null, b.token);
      assert.strictEqual(r.json.blocked.length, 0, 'bobby is never told');
      await call('DELETE', `/api/blocks/${b.userId}`, null, a.token);
    });

    await t('sessions: listed with this device, Sign out others ends the rest and hands back a token', async () => {
      const l2 = await call('POST', '/api/login', { email: 'carol@x.test', password: 'carol-password-1', device: 'iPhone app' });
      let r = await call('GET', '/api/account/security', null, c.token);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.sessions.length, 2);
      assert.ok(r.json.sessions.some((s) => s.device === 'iPhone app'));
      r = await call('POST', '/api/account/sessions/sign-out-others', {}, c.token);
      assert.ok(r.json.token);
      const fresh = r.json.token;
      assert.strictEqual((await call('GET', '/api/account/security', null, l2.json.token)).status, 401, 'the other device is out');
      assert.strictEqual((await call('GET', '/api/account/security', null, c.token)).status, 401, 'the old token of this device too (version bumped)');
      r = await call('GET', '/api/account/security', null, fresh);
      assert.strictEqual(r.json.sessions.length, 1);
      c.token = fresh;
    });

    await t('password change: wrong current refused; right one bumps the version and returns a token', async () => {
      let r = await call('PUT', '/api/account/password', { current: 'nope-nope', next: 'carol-password-2' }, c.token);
      assert.strictEqual(r.status, 400);
      r = await call('PUT', '/api/account/password', { current: 'carol-password-1', next: 'carol-password-2' }, c.token);
      assert.strictEqual(r.status, 200);
      assert.strictEqual((await call('GET', '/api/account/security', null, c.token)).status, 401);
      c.token = r.json.token;
      assert.strictEqual((await call('GET', '/api/account/security', null, c.token)).status, 200);
      const l = await call('POST', '/api/login', { email: 'carol@x.test', password: 'carol-password-2' });
      assert.ok(l.json.token);
    });

    await t('email change: needs the password, waits for the link, a bad link reads as expired', async () => {
      let r = await call('POST', '/api/account/email', { email: 'carol2@x.test', password: 'wrong' }, c.token);
      assert.strictEqual(r.status, 400);
      r = await call('POST', '/api/account/email', { email: 'alice@x.test', password: 'carol-password-2' }, c.token);
      assert.strictEqual(r.status, 409);
      r = await call('POST', '/api/account/email', { email: 'carol2@x.test', password: 'carol-password-2' }, c.token);
      assert.strictEqual(r.json.pendingEmail, 'carol2@x.test');
      const sec = await call('GET', '/api/account/security', null, c.token);
      assert.strictEqual(sec.json.email, 'carol@x.test', 'unchanged until confirmed');
      assert.strictEqual(sec.json.pendingEmail, 'carol2@x.test');
      const bad = await call('GET', '/api/account/email/confirm/not-a-token');
      assert.strictEqual(bad.status, 302);
      assert.ok(/email=expired/.test(bad.headers.get('location')));
    });

    await t('invite link: info for the card, a sign-up connects, a scan sends a request', async () => {
      let r = await call('GET', '/api/invite', null, a.token);
      const tok = r.json.token;
      assert.ok(/\/i\//.test(r.json.url));
      r = await call('GET', `/api/invite/${tok}/info`);
      assert.strictEqual(r.json.username, 'alice');
      const d = await reg('dana', { invite: tok });
      assert.strictEqual(d.invitedBy, a.userId);
      const bud = await call('GET', '/api/share-buddies', null, d.token);
      assert.ok(JSON.stringify(bud.json).includes('alice'), 'dana is connected to alice');
      r = await call('POST', `/api/invite/${tok}/connect`, {}, c.token);
      assert.strictEqual(r.json.status, 'sent');
      r = await call('POST', `/api/invite/${tok}/connect`, {}, c.token);
      assert.strictEqual(r.json.status, 'pending');
      r = await call('POST', '/api/invite/rotate', {}, a.token);
      assert.notStrictEqual(r.json.token, tok);
      assert.strictEqual((await call('GET', `/api/invite/${tok}/info`)).status, 404, 'the old code is dead');
    });

    await t('Report a problem: saved, a non-JPEG picture refused, admins only read them', async () => {
      let r = await call('POST', '/api/feedback', { text: 'The pot is wrong', view: 'hands', version: 'test', image: 'data:image/png;base64,AAAA' }, b.token);
      assert.strictEqual(r.status, 400);
      r = await call('POST', '/api/feedback', { text: 'The pot is wrong', view: 'hands', version: 'test' }, b.token);
      assert.strictEqual(r.status, 201);
      r = await call('GET', '/api/admin/feedback', null, b.token);
      assert.strictEqual(r.status, 403);
    });

    await t('Download everything: the password is asked, the ZIP is served once made', async () => {
      let r = await call('POST', '/api/account/export', { password: 'wrong' }, a.token);
      assert.strictEqual(r.status, 400);
      r = await call('POST', '/api/account/export', { password: 'alice-password-1' }, a.token);
      assert.strictEqual(r.status, 200);
      assert.ok(r.json.files >= 3);
      const z = await fetch(base + r.json.url);
      assert.strictEqual(z.headers.get('content-type'), 'application/zip');
      const buf = Buffer.from(await z.arrayBuffer());
      assert.strictEqual(buf.slice(0, 2).toString(), 'PK');
      assert.ok(buf.includes(Buffer.from('my-schedule.csv')));
      assert.strictEqual((await fetch(base + '/api/account/export/nope')).status, 404);
    });

    await t('Sign in with Apple: a token signed by a listed key passes; another audience or key does not', async () => {
      const crypto = require('crypto');
      const jwt = require('jsonwebtoken');
      const { verifyIdentityToken } = require('../lib/apple-signin');
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
      const sign = (aud, kid = 'k1') => jwt.sign({ sub: '001.abc', email: 'x@privaterelay.appleid.com', email_verified: true }, privateKey,
        { algorithm: 'RS256', issuer: 'https://appleid.apple.com', audience: aud, keyid: kid, expiresIn: '5m' });
      const ok = await verifyIdentityToken(jwt, sign('app.futurega.me.beta'), { keys: [jwk], aud: ['app.futurega.me.beta'] });
      assert.strictEqual(ok.sub, '001.abc');
      await assert.rejects(verifyIdentityToken(jwt, sign('com.other.app'), { keys: [jwk], aud: ['app.futurega.me.beta'] }));
      await assert.rejects(verifyIdentityToken(jwt, sign('app.futurega.me.beta', 'k2'), { keys: [jwk], aud: ['app.futurega.me.beta'] }));
      const r = await call('POST', '/api/auth/apple', { identityToken: 'not-a-token' });
      assert.strictEqual(r.status, 401);
    });

    await t('the app-link files: Apple\'s served as JSON, Android\'s only with its fingerprint', async () => {
      const r = await fetch(base + '/.well-known/apple-app-site-association');
      assert.strictEqual(r.status, 200);
      const j = await r.json();
      assert.ok(j.applinks.details[0].paths.includes('/h/*'));
      assert.strictEqual((await fetch(base + '/.well-known/assetlinks.json')).status, 404);
    });

    await t('a deleted account takes its new rows with it', async () => {
      const r = await call('DELETE', '/api/account', { confirm: 'bobby' }, b.token);
      assert.strictEqual(r.status, 200);
    });
  } finally {
    await srv.stop();
    scratch.cleanup();
  }
  console.log(`\nfeatures-social.test.js - ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
