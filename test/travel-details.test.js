// A Travel Day's flights, stays and rental cars (lib/travel-details.js; owner, 2026-11-27: "Add the option to enter
// flight information, stay information (hotel name, check in time etc), rental car info etc"). The rules in plain
// Node, then the real routes on a scratch server: the owner saves and reads them back, the day's note follows the
// flights, nobody else can read or write them, none of it rides in the schedule a share link shows, and they go
// with the day.
//
//   node test/travel-details.test.js        (npm run test:travel-details; ports 4780-4789)
'use strict';
const assert = require('assert');
const { createScratch, boot, runner, one } = require('./helpers/scratch-server');
const travel = require('../lib/travel-details');

const t = runner('travel-details');
const FLIGHT = { kind: 'flight', number: ' AA 1234 ', from: 'PHL', to: 'DFW', departs: '08:05', arrives: '10:40', conf: 'ABC123' };
const FLIGHT2 = { kind: 'flight', number: 'AA 99', from: 'DFW', to: 'LAS', departs: '12:00', arrives: '13:30' };
const STAY = { kind: 'stay', name: 'Wynn Las Vegas', checkIn: '2026-12-08T15:00', checkOut: '2026-12-14T11:00', conf: 'W-81234567' };
const CAR = { kind: 'car', company: 'Hertz', pickUp: '2026-12-08T14:00', pickUpAt: 'LAS airport', conf: 'K1234567' };

(async () => {
  await t.test('items: known kinds and fields only, trimmed, an empty item dropped, anything else refused', () => {
    assert.deepStrictEqual(travel.cleanItems([FLIGHT, { kind: 'car', company: '  ' }, { ...STAY, extra: 'x' }]),
      [{ ...FLIGHT, number: 'AA 1234' }, STAY]);
    assert.strictEqual(travel.cleanItems([{ kind: 'boat', name: 'x' }]), null);
    assert.strictEqual(travel.cleanItems([{ kind: 'flight', number: 1234 }]), null);
    assert.strictEqual(travel.cleanItems(Array.from({ length: 13 }, () => CAR)), null);
    assert.strictEqual(travel.cleanItems('flight'), null);
    assert.strictEqual(travel.cleanItems([{ kind: 'stay', name: 'x'.repeat(500) }])[0].name.length, 120);
  });
  await t.test("the note is the picker's, from the first departure and the last arrival", () => {
    assert.strictEqual(travel.notesFor([FLIGHT, STAY, FLIGHT2]), 'Depart 8:05 AM → Arrive 1:30 PM');
    assert.strictEqual(travel.notesFor([{ kind: 'flight', departs: '00:15', arrives: '12:00' }]), 'Depart 12:15 AM → Arrive 12:00 PM');
    assert.strictEqual(travel.notesFor([STAY, CAR]), null, 'no flight, no note');
    assert.strictEqual(travel.notesFor([{ kind: 'flight', departs: '08:00' }]), null, 'no arrival, no note');
  });

  const scratch = await createScratch({ ports: [4780, 4789], prefix: 'fg-travel-' });
  const srv = await boot(scratch.dbPath, {}, { ports: [4780, 4789] });
  const base = `http://127.0.0.1:${srv.port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = {};
    try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
    return { status: r.status, body: json, text };
  };
  try {
    const a = (await call('POST', '/api/register', { email: 'traveler@x.test', password: 'travel-password-1', realName: 'Tara Vell' })).body.token;
    const b = (await call('POST', '/api/register', { email: 'other@x.test', password: 'travel-password-1', realName: 'Otto Her' })).body.token;
    assert.ok(a && b, 'two accounts');
    const made = await call('POST', '/api/personal-event', { date: '2026-12-08', type: 'Travel Day', notes: 'Depart 8:00 AM → Arrive 2:00 PM' }, a);
    assert.strictEqual(made.status, 201, made.text);
    const id = made.body.tournamentId;
    const off = await call('POST', '/api/personal-event', { date: '2026-12-09', type: 'Day Off' }, a);
    const offId = off.body.tournamentId;

    await t.test('the owner saves a flight, a connection, a stay and a car and reads them back', async () => {
      const put = await call('PUT', `/api/personal-event/${id}/travel`, { items: [FLIGHT, FLIGHT2, STAY, CAR] }, a);
      assert.strictEqual(put.status, 200, put.text);
      assert.strictEqual(put.body.items.length, 4);
      assert.strictEqual(put.body.items[0].number, 'AA 1234');
      const got = await call('GET', `/api/personal-event/${id}/travel`, null, a);
      assert.deepStrictEqual(got.body.items, put.body.items);
    });
    await t.test("the day's note follows the flights, so the band and the card's times do", async () => {
      const mine = await call('GET', '/api/my-schedule', null, a);
      const day = (Array.isArray(mine.body) ? mine.body : mine.body.tournaments || []).find((x) => x.id === id);
      assert.ok(day, 'the Travel Day is in My Schedule');
      assert.strictEqual(day.notes, 'Depart 8:05 AM → Arrive 1:30 PM');
    });
    await t.test('none of it rides in the schedule: not My Schedule, not a share link', async () => {
      const mine = await call('GET', '/api/my-schedule', null, a);
      for (const secret of ['ABC123', 'Wynn', 'Hertz', 'K1234567']) assert.ok(!mine.text.includes(secret), `My Schedule carries ${secret}`);
      const tok = (await call('POST', '/api/share-token', {}, a)).body.token;
      const shared = await call('GET', `/api/shared/${tok}`);
      assert.strictEqual(shared.status, 200, shared.text);
      for (const secret of ['ABC123', 'Wynn', 'Hertz', 'K1234567', '8:05 AM']) assert.ok(!shared.text.includes(secret), `the share link carries ${secret}`);
    });
    await t.test("nobody else reads or writes them, and a Day Off has none", async () => {
      assert.strictEqual((await call('GET', `/api/personal-event/${id}/travel`, null, b)).status, 404);
      assert.strictEqual((await call('PUT', `/api/personal-event/${id}/travel`, { items: [] }, b)).status, 404);
      assert.strictEqual((await call('GET', `/api/personal-event/${id}/travel`)).status, 401);
      assert.strictEqual((await call('GET', `/api/personal-event/${offId}/travel`, null, a)).status, 404);
      const still = await call('GET', `/api/personal-event/${id}/travel`, null, a);
      assert.strictEqual(still.body.items.length, 4, 'the refused write changed nothing');
    });
    await t.test('a bad list is refused with a message and changes nothing', async () => {
      const bad = await call('PUT', `/api/personal-event/${id}/travel`, { items: [{ kind: 'boat', name: 'x' }] }, a);
      assert.strictEqual(bad.status, 400);
      assert.ok(bad.body.error);
      assert.strictEqual((await call('GET', `/api/personal-event/${id}/travel`, null, a)).body.items.length, 4);
    });
    await t.test('an empty list clears them', async () => {
      const put = await call('PUT', `/api/personal-event/${id}/travel`, { items: [] }, a);
      assert.deepStrictEqual(put.body.items, []);
      assert.deepStrictEqual((await call('GET', `/api/personal-event/${id}/travel`, null, a)).body.items, []);
    });
    await t.test('they go with the day', async () => {
      await call('PUT', `/api/personal-event/${id}/travel`, { items: [STAY] }, a);
      const del = await call('DELETE', `/api/personal-event/${id}`, null, a);
      assert.strictEqual(del.status, 200, del.text);
      assert.strictEqual((await call('GET', `/api/personal-event/${id}/travel`, null, a)).status, 404);
      await srv.stop();
      const db = scratch.open();
      assert.strictEqual(one(db, 'SELECT COUNT(*) FROM travel_details WHERE tournament_id = ?', [id]), 0);
      db.close();
    });
  } finally {
    await srv.stop().catch(() => {});
    scratch.cleanup();
  }
  t.done();
})().catch((e) => { console.error(e); process.exit(1); });
