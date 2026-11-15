'use strict';
// node test/backer-live-action.test.js — Playing now only for a backer with action in what is being played (owner,
// 2026-11-15): lib/backer-extras.js hasAction, on the real schema (a scratch server's database), source 'sql'.
// Every name, token and figure here is made up.
const assert = require('assert');
const { createScratch, runner } = require('./helpers/scratch-server');
const fx = require('./helpers/backer-fixtures');
const { hasAction } = require('../lib/backer-extras');
const { liveSession } = require('../lib/backer-live');
const { classifyTournament, classifyCash } = require('../lib/staking/classify');

(async () => {
  const t = runner('backer live: action');
  const scratch = await createScratch({ prefix: 'fg-backer-live-action-' });
  try {
    const db = scratch.open();
    const OWNER = 1;
    const DAY = '2026-11-15';
    const NOW = Date.parse(DAY + 'T20:00:00Z');
    const nlh = classifyTournament({ game_variant: 'NLH', is_online: 0 }, null);
    const plo = classifyCash({ game: 'PLO', room: 'Parx' }, null);

    db.run(`INSERT INTO tournaments (id, event_name, date, time, venue, property, game_variant, is_online, buyin)
            VALUES (901, 'NLH Deepstack', ?, '12:00 PM', 'Fall Series', 'Borgata', 'NLH', 0, 600)`, [DAY]);
    const nlhOnly = fx.addSqlBacker(db, { userId: OWNER, name: 'Nora Live', token: 'tkNLHonly00000000001', agreements: [{ stakes: [{ format: nlh.format, channel: nlh.channel, pct: 20 }] }] });
    fx.addSqlBacker(db, { userId: OWNER, name: 'Paul Omaha', token: 'tkPLOonly00000000002', agreements: [{ stakes: [{ format: plo.format, channel: 'any', pct: 15 }] }] });
    fx.addSqlBacker(db, { userId: OWNER, name: 'Ann Everything', token: 'tkALL0000000000000003', agreements: [{ stakes: [{ format: 'all', channel: 'any', pct: 10 }] }] });
    fx.addSqlBacker(db, { userId: OWNER, name: 'Zero Pct', token: 'tkZERO000000000000004', agreements: [{ stakes: [{ format: 'all', channel: 'any', pct: 0 }] }] });
    fx.addSqlBacker(db, { userId: OWNER, name: 'Ended Deal', token: 'tkENDED00000000000005', agreements: [{ status: 'ended', stakes: [{ format: 'all', channel: 'any', pct: 25 }] }] });
    void nlhOnly;
    const run = { kind: 'tournament', tournamentId: 901 };
    const opt = { source: 'sql' };

    await t.test('a tournament: shown to a backer staked in its game, or in everything', () => {
      assert.strictEqual(hasAction(db, OWNER, 'tkNLHonly00000000001', run, opt), true);
      assert.strictEqual(hasAction(db, OWNER, 'tkALL0000000000000003', run, opt), true);
    });
    await t.test('a tournament: not to a backer staked only in another game, at 0%, or under an ended agreement', () => {
      assert.strictEqual(hasAction(db, OWNER, 'tkPLOonly00000000002', run, opt), false);
      assert.strictEqual(hasAction(db, OWNER, 'tkZERO000000000000004', run, opt), false);
      assert.strictEqual(hasAction(db, OWNER, 'tkENDED00000000000005', run, opt), false);
      assert.strictEqual(hasAction(db, OWNER, 'tkNobodyKnowsThis0006', run, opt), false, 'a token no backer owns');
    });

    db.run(`INSERT INTO cash_sessions (user_id, started_at, ended_at, session_date, room, game, stakes, created_at)
            VALUES (?, ?, NULL, ?, 'Parx', 'PLO', '5/5', ?)`, [OWNER, new Date(NOW - 2 * 3600e3).toISOString(), DAY, DAY + 'T18:00:00Z']);
    const live = liveSession(db, OWNER, NOW, { withRun: true });
    await t.test('the beacon carries the cash session for the server, and never in its public shape', () => {
      assert.strictEqual(live.kind, 'cash');
      assert.ok(live.cashSessionId > 0);
      assert.strictEqual('cashSessionId' in liveSession(db, OWNER, NOW), false);
    });
    await t.test('a cash session: shown to the PLO backer and the everything backer, not the NLH one', () => {
      assert.strictEqual(hasAction(db, OWNER, 'tkPLOonly00000000002', live, opt), true);
      assert.strictEqual(hasAction(db, OWNER, 'tkALL0000000000000003', live, opt), true);
      assert.strictEqual(hasAction(db, OWNER, 'tkNLHonly00000000001', live, opt), false);
    });

    // A series piece of the event gives action too (matched by the backer's id, as the Notify tap's Q7 does).
    db.run("INSERT INTO staking_series (user_id, name) VALUES (?, 'Fall Series')", [OWNER]);
    const sid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    const paul = db.exec("SELECT id FROM backers WHERE public_token = 'tkPLOonly00000000002'")[0].values[0][0];
    db.run("INSERT INTO backer_agreements (series_id, backer_id, backer_type, percentage, is_active) VALUES (?, ?, 'piece', 20, 1)", [sid, paul]);
    const aid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    db.run('INSERT INTO backer_event_status (agreement_id, tournament_id) VALUES (?, 901)', [aid]);
    await t.test('a tournament: shown to a backer holding a series piece of the event', () => {
      assert.strictEqual(hasAction(db, OWNER, 'tkPLOonly00000000002', run, opt), true);
    });
    await t.test('nothing playing, or no owner: no action', () => {
      assert.strictEqual(hasAction(db, OWNER, 'tkALL0000000000000003', null, opt), false);
      assert.strictEqual(hasAction(db, null, 'tkALL0000000000000003', run, opt), false);
    });
  } finally {
    scratch.cleanup();
  }
  t.done();
})().catch((e) => { console.error(e); process.exit(1); });
