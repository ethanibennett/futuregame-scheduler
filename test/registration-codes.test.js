// Registration codes (lib/registration-codes.js; owner, 2026-11-21: "Add a registration code field for new accounts,
// and only include the BTG card back option for users that register with code BTG"). The code's rules, then the real
// routes on a scratch server: Create Account with BTG (in any case) unlocks its back, on register and every sign-in;
// no code unlocks nothing; an unknown code is refused and makes no account.
//
//   node test/registration-codes.test.js        (npm run test:registration-codes; ports 4770-4779)
'use strict';
const assert = require('assert');
const { createScratch, boot } = require('./helpers/scratch-server');
const codes = require('../lib/registration-codes');

let passed = 0;
const ok = (name) => { passed += 1; console.log('  ok  ', name); };

(async () => {
  assert.deepStrictEqual(codes.checkCode(''), { code: null });
  assert.deepStrictEqual(codes.checkCode(undefined), { code: null });
  assert.deepStrictEqual(codes.checkCode(' btg '), { code: 'BTG' });
  assert.ok(codes.checkCode('BTGX').error);
  assert.deepStrictEqual(codes.cardBacksFor('BTG'), ['btg']);
  assert.deepStrictEqual(codes.cardBacksFor(null), []);
  ok('codes: none, BTG in any case, an unknown one refused; BTG unlocks its back');

  const scratch = await createScratch({ ports: [4770, 4779], prefix: 'fg-regcode-' });
  const srv = await boot(scratch.dbPath, {}, { ports: [4770, 4779] });
  const base = `http://127.0.0.1:${srv.port}`;
  const call = async (path, body) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  try {
    const btg = await call('/api/register', { email: 'btg@x.test', password: 'reg-code-password-1', realName: 'Bea Tee', code: 'btg ' });
    assert.strictEqual(btg.status, 201, JSON.stringify(btg.body));
    assert.deepStrictEqual(btg.body.cardBacks, ['btg']);
    ok('Create Account with "btg " unlocks the BTG back');

    const back = await call('/api/login', { email: 'btg@x.test', password: 'reg-code-password-1' });
    assert.strictEqual(back.status, 200);
    assert.deepStrictEqual(back.body.cardBacks, ['btg']);
    ok('and every sign-in says so');

    const plain = await call('/api/register', { email: 'plain@x.test', password: 'reg-code-password-1', realName: 'Pat Plain' });
    assert.strictEqual(plain.status, 201);
    assert.deepStrictEqual(plain.body.cardBacks, []);
    const plainIn = await call('/api/login', { email: 'plain@x.test', password: 'reg-code-password-1' });
    assert.deepStrictEqual(plainIn.body.cardBacks, []);
    ok('no code unlocks nothing');

    const bad = await call('/api/register', { email: 'typo@x.test', password: 'reg-code-password-1', realName: 'Tia Typo', code: 'BGT' });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.body.error, /registration code/i);
    const after = await call('/api/register', { email: 'typo@x.test', password: 'reg-code-password-1', realName: 'Tia Typo', code: 'BTG' });
    assert.strictEqual(after.status, 201, 'the refused attempt made no account, so the address is still free');
    assert.deepStrictEqual(after.body.cardBacks, ['btg']);
    ok('an unknown code is refused with a message and makes no account');
  } finally {
    await srv.stop();
    scratch.cleanup?.();
  }
  console.log(`registration-codes: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
