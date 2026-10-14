// Link rotation (docs/bankroll-merge.md §7.5): rotateBackerToken and rotateBackerLink from
// lib/backer-surface.js, the REAL functions (this replaces scripts/test-backer-rotation.mjs, whose
// header admitted it mirrored the SQL), run against a database whose schema is the real one:
// server.js is booted once on a scratch DB so every dataMigration has run, then the file is opened
// in this process.
//
//   node test/backer-rotation.test.js        (npm run test:backer-rotation)
//
// What it protects: a backer's token is the whole of their authentication AND the foreign key five
// tables find their data by. The link must move across ALL FIVE (backer_public, backer_events,
// backer_push_subs, backers.public_token, backer_event_revisions) or none, must refuse to merge two
// backers, and must kill the old link at once.
//
// Boots server.js on a scratch port (4540-4549, never 3001) against a scratch DB, with the
// production secrets scrubbed (test/helpers/scratch-server.js). Every token and name is invented.
'use strict';
const assert = require('assert');
const surface = require('../lib/backer-surface');
const { createScratch, one, rowsOf, runner } = require('./helpers/scratch-server');
const fx = require('./helpers/backer-fixtures');

const FIVE = ['backer_public', 'backer_events', 'backer_push_subs', 'backers', 'backer_event_revisions'];

/** A backer holding rows in all five places. */
function seedAll(db, token = 'k7Qm2xR9', { userId = 1, roster = true } = {}) {
  fx.addPublicName(db, token, 'Rotation Test Backer');
  for (let i = 1; i <= 5; i++) fx.addEvent(db, { token, sessionId: 's' + i, ts: 1000 + i, date: '2026-07-0' + i, result: -10000 * i, pct: 50, share: -5000 * i });
  fx.addSub(db, token);
  const backerId = fx.addSqlBacker(db, { userId, name: 'Rotation Test Backer', token, agreements: [{ openingCents: 2500, stakes: [{ format: 'PLO', pct: 50 }] }] });
  for (let i = 1; i <= 3; i++) {
    db.run(`INSERT INTO backer_event_revisions (event_id, token, at, action, share_before, share_after) VALUES (?, ?, ?, 'revise', 1, 2)`, [`${token}:s${i}`, token, 2000 + i]);
  }
  if (roster) fx.addRoster(db, { id: 'rec-' + token, token, name: 'Rotation Test Backer', stakes: [{ format: 'PLO', pct: 50, channel: 'any' }], opening: 25 }, { updatedAt: 5000 });
  return backerId;
}
const countAt = (db, table, col, tok) => one(db, `SELECT COUNT(*) FROM ${table} WHERE ${col} = ?`, [tok]);
const COL = { backer_public: 'token', backer_events: 'token', backer_push_subs: 'token', backers: 'public_token', backer_event_revisions: 'token' };

(async () => {
  const { test, done } = runner('backer-rotation.test.js');
  const scratch = await createScratch();
  try {
    console.log('rotateBackerToken: the history moves with the token');
    await test('all five places move, and the counts say so', () => {
      const db = scratch.open();
      seedAll(db);
      const before = one(db, 'SELECT SUM(share_cents) FROM backer_events WHERE token = ?', ['k7Qm2xR9']);
      const res = surface.rotateBackerToken(db, 'k7Qm2xR9', 'Zx4Lm8Qt');
      assert.strictEqual(res.ok, true);
      assert.deepStrictEqual(res.counts, { backer_public: 1, backer_events: 5, backer_push_subs: 1, backers: 1, backer_event_revisions: 3 });
      for (const t of FIVE) {
        assert.ok(countAt(db, t, COL[t], 'Zx4Lm8Qt') > 0, `${t} is on the new token`);
        assert.strictEqual(countAt(db, t, COL[t], 'k7Qm2xR9'), 0, `${t} has nothing left on the old token`);
      }
      assert.strictEqual(one(db, 'SELECT SUM(share_cents) FROM backer_events WHERE token = ?', ['Zx4Lm8Qt']), before, 'the running total is unchanged');
      assert.strictEqual(one(db, 'SELECT name FROM backer_public WHERE token = ?', ['Zx4Lm8Qt']), 'Rotation Test Backer');
      db.close();
    });

    await test('the page follows: the new link shows the history, the old link shows nothing', () => {
      const db = scratch.open();
      seedAll(db);
      surface.rotateBackerToken(db, 'k7Qm2xR9', 'Zx4Lm8Qt');
      // The roster record is the fallback; rotateBackerToken alone leaves it (the roster sync moves it itself).
      const fresh = surface.buildFeed(db, 'Zx4Lm8Qt', { source: 'sql' });
      assert.strictEqual(fresh.name, 'Rotation Test Backer');
      assert.strictEqual(fresh.sessions, 5);
      assert.strictEqual(fresh.openingCents, 2500, 'the opening came with the backers row');
      const old = surface.buildFeed(db, 'k7Qm2xR9', { source: 'sql' });
      assert.strictEqual(old.sessions, 0);
      assert.strictEqual(old.events.length, 0);
      db.close();
    });

    console.log('rotateBackerToken: a rotation that would merge two backers is refused');
    for (const target of FIVE) {
      await test(`refused when the new token already lives in ${target}, and nothing moved`, () => {
        const db = scratch.open();
        seedAll(db, 'aaaaaa11');
        const squat = 'bbbbbb22';
        if (target === 'backer_public') fx.addPublicName(db, squat, 'Someone Else');
        if (target === 'backer_events') fx.addEvent(db, { token: squat, sessionId: 'x1' });
        if (target === 'backer_push_subs') fx.addSub(db, squat);
        if (target === 'backers') fx.addSqlBacker(db, { name: 'Someone Else', token: squat });
        if (target === 'backer_event_revisions') db.run(`INSERT INTO backer_event_revisions (event_id, token, at, action) VALUES ('e', ?, 1, 'post')`, [squat]);
        const snapshot = FIVE.map((t) => countAt(db, t, COL[t], 'aaaaaa11'));
        const res = surface.rotateBackerToken(db, 'aaaaaa11', squat);
        assert.strictEqual(res.ok, false);
        assert.match(res.error, /already carries data/);
        assert.deepStrictEqual(FIVE.map((t) => countAt(db, t, COL[t], 'aaaaaa11')), snapshot, 'the first backer is untouched');
        db.close();
      });
    }

    console.log('rotateBackerToken: the guards');
    await test('identical, too short, punctuation, empty and null tokens are refused and leave the history alone', () => {
      const db = scratch.open();
      seedAll(db);
      const O = 'k7Qm2xR9';
      assert.strictEqual(surface.rotateBackerToken(db, O, O).ok, false);
      assert.strictEqual(surface.rotateBackerToken(db, O, 'abc').ok, false);
      assert.strictEqual(surface.rotateBackerToken(db, O, 'abc-def!').ok, false);
      assert.strictEqual(surface.rotateBackerToken(db, O, '').ok, false);
      assert.strictEqual(surface.rotateBackerToken(db, '', 'Zx4Lm8Qt').ok, false);
      assert.strictEqual(surface.rotateBackerToken(db, null, null).ok, false);
      assert.strictEqual(countAt(db, 'backer_events', 'token', O), 5);
      assert.strictEqual(countAt(db, 'backers', 'public_token', O), 1);
      db.close();
    });

    await test('rotating a backer with no data yet succeeds and moves nothing (a new backer must not log a false failure)', () => {
      const db = scratch.open();
      const res = surface.rotateBackerToken(db, 'ccccc111', 'ddddd222');
      assert.strictEqual(res.ok, true);
      assert.deepStrictEqual(res.counts, { backer_public: 0, backer_events: 0, backer_push_subs: 0, backers: 0, backer_event_revisions: 0 });
      db.close();
    });

    await test('rotating twice, the way a second leak would go: neither old token resolves', () => {
      const db = scratch.open();
      seedAll(db, 'tokenone1');
      assert.ok(surface.rotateBackerToken(db, 'tokenone1', 'tokentwo2').ok);
      assert.ok(surface.rotateBackerToken(db, 'tokentwo2', 'tokenthree3').ok);
      assert.strictEqual(countAt(db, 'backer_events', 'token', 'tokenthree3'), 5);
      assert.strictEqual(one(db, "SELECT COUNT(*) FROM backer_events WHERE token IN ('tokenone1', 'tokentwo2')"), 0);
      assert.strictEqual(countAt(db, 'backers', 'public_token', 'tokenthree3'), 1);
      db.close();
    });

    console.log('rotateBackerToken: all or none');
    await test('a failure on the LAST table puts the other four back', () => {
      const db = scratch.open();
      seedAll(db);
      db.run(`CREATE TRIGGER boom BEFORE UPDATE ON backer_event_revisions BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
      const snapshot = FIVE.map((t) => countAt(db, t, COL[t], 'k7Qm2xR9'));
      const res = surface.rotateBackerToken(db, 'k7Qm2xR9', 'Zx4Lm8Qt');
      assert.strictEqual(res.ok, false);
      assert.match(res.error, /forced failure/);
      assert.deepStrictEqual(FIVE.map((t) => countAt(db, t, COL[t], 'k7Qm2xR9')), snapshot, 'every table is back on the old token');
      assert.deepStrictEqual(FIVE.map((t) => countAt(db, t, COL[t], 'Zx4Lm8Qt')), [0, 0, 0, 0, 0], 'and none is on the new one');
      // The database is still usable: no savepoint left open.
      db.run('DROP TRIGGER boom');
      assert.strictEqual(surface.rotateBackerToken(db, 'k7Qm2xR9', 'Zx4Lm8Qt').ok, true);
      db.close();
    });

    await test('inside a caller\'s transaction it neither commits it nor leaks out of its rollback', () => {
      const db = scratch.open();
      seedAll(db);
      db.run('BEGIN');
      assert.strictEqual(surface.rotateBackerToken(db, 'k7Qm2xR9', 'Zx4Lm8Qt').ok, true);
      assert.strictEqual(countAt(db, 'backer_events', 'token', 'Zx4Lm8Qt'), 5, 'visible inside the transaction');
      db.run('ROLLBACK');
      assert.strictEqual(countAt(db, 'backer_events', 'token', 'k7Qm2xR9'), 5, 'the caller\'s rollback put it back');
      db.close();
    });

    console.log('rotateBackerLink: "New link" for one of the player\'s backers');
    await test('mints a fresh 8-character link, moves all five places and the roster record, and kills the old link', () => {
      const db = scratch.open();
      const id = seedAll(db, 'oldlink01');
      const r = surface.rotateBackerLink(db, { userId: 1, backerId: id, now: 9000 });
      assert.strictEqual(r.status, 200);
      assert.match(r.token, /^[A-Za-z0-9]{8}$/);
      assert.notStrictEqual(r.token, 'oldlink01');
      assert.deepStrictEqual(r.counts, { backer_public: 1, backer_events: 5, backer_push_subs: 1, backers: 1, backer_event_revisions: 3 });
      assert.strictEqual(r.rosterRecord, 'updated');
      assert.strictEqual(one(db, 'SELECT public_token FROM backers WHERE id = ?', [id]), r.token);
      // The roster record (the fallback the page reads for a token no backers row owns) moved too,
      // with a newer updated_at so the roster seam's last-write-wins guard keeps the dashboard's
      // older copy from rotating the link back.
      const rec = rowsOf(db, "SELECT data, updated_at FROM console_records WHERE store = 'backers'")[0];
      assert.strictEqual(JSON.parse(rec.data).token, r.token);
      assert.ok(rec.updated_at >= 9000 && rec.updated_at > 5000);
      for (const source of ['console', 'sql']) {
        const fresh = surface.buildFeed(db, r.token, { source });
        assert.strictEqual(fresh.name, 'Rotation Test Backer', source);
        assert.strictEqual(fresh.sessions, 5, source);
        const old = surface.buildFeed(db, 'oldlink01', { source });
        assert.deepStrictEqual([old.name, old.sessions, old.stakes, old.openingCents, old.events.length], [null, 0, '', 0, 0], `${source}: the old link is dead, including its roster fallback`);
      }
      db.close();
    });

    await test('another player\'s backer is a 404, an unknown id is a 404, a backer with no link is a 409', () => {
      const db = scratch.open();
      const id = seedAll(db, 'ownedby1x', { userId: 1 });
      assert.strictEqual(surface.rotateBackerLink(db, { userId: 2, backerId: id }).status, 404);
      assert.strictEqual(surface.rotateBackerLink(db, { userId: 1, backerId: 99999 }).status, 404);
      const bare = fx.addSqlBacker(db, { userId: 1, name: 'No Link Yet', token: null });
      const r = surface.rotateBackerLink(db, { userId: 1, backerId: bare });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(one(db, 'SELECT public_token FROM backers WHERE id = ?', [id]), 'ownedby1x', 'the refused ones moved nothing');
      db.close();
    });

    await test('no roster record: still rotates, and says the record was not there', () => {
      const db = scratch.open();
      const id = seedAll(db, 'noroster1', { roster: false });
      const r = surface.rotateBackerLink(db, { userId: 1, backerId: id });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.rosterRecord, 'none');
      db.close();
    });

    await test('a minted token that is already taken (in a table or in the roster) is not used; the next one is', () => {
      const db = scratch.open();
      const id = seedAll(db, 'mintme001');
      fx.addPublicName(db, 'taken0001', 'Someone');
      fx.addRoster(db, { id: 'other', token: 'taken0002', name: 'Roster Other' });
      const queue = ['taken0001', 'taken0002', 'mintme001', 'fresh0003'];
      const r = surface.rotateBackerLink(db, { userId: 1, backerId: id, mint: () => queue.shift() });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.token, 'fresh0003');
      db.close();
    });

    await test('if every minted token is taken it gives up with a 500 and moves nothing', () => {
      const db = scratch.open();
      const id = seedAll(db, 'mintme002');
      fx.addPublicName(db, 'taken0009', 'Someone');
      const r = surface.rotateBackerLink(db, { userId: 1, backerId: id, mint: () => 'taken0009' });
      assert.strictEqual(r.status, 500);
      assert.strictEqual(one(db, 'SELECT public_token FROM backers WHERE id = ?', [id]), 'mintme002');
      db.close();
    });

    await test('a failure part-way puts back the tables AND the roster record', () => {
      const db = scratch.open();
      const id = seedAll(db, 'atomic001');
      db.run(`CREATE TRIGGER boom2 BEFORE UPDATE ON backer_event_revisions BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
      const recBefore = rowsOf(db, "SELECT data, updated_at FROM console_records WHERE store = 'backers'")[0];
      const r = surface.rotateBackerLink(db, { userId: 1, backerId: id });
      assert.strictEqual(r.status, 500);
      assert.strictEqual(one(db, 'SELECT public_token FROM backers WHERE id = ?', [id]), 'atomic001');
      assert.strictEqual(countAt(db, 'backer_events', 'token', 'atomic001'), 5);
      assert.deepStrictEqual(rowsOf(db, "SELECT data, updated_at FROM console_records WHERE store = 'backers'")[0], recBefore);
      db.close();
    });
  } finally {
    scratch.cleanup();
  }
  done();
})().catch((e) => { console.error(e); process.exit(1); });
