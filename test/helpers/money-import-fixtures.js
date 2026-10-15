'use strict';
/*
 * Made-up money for the import test (test/money-import.test.js): what the stub dashboard serves, and
 * what the owner already holds in futurega.me before the import. Every name, token, address, phone
 * number and figure is invented. Nothing here is, or was copied from, a real ledger.
 */
const DAY = 864e5;
const T0 = Date.parse('2026-10-01T00:00:00Z'); // the dashboard's last write before the first pull
const TOKEN = { sam: 'SamTok01', mo: 'MoTok002', lee: 'LeeTok03', gone: 'GoneTok4', hist: 'HistTok5' };

/** The dashboard's records and blobs (the first pull). Sessions of every kind, the fund, adjustments
 *  of every kind, expenses, three live backers, a deleted one, tombstones. */
function seedDashboard(stub, { clean = false } = {}) {
  const s = (id, o, at = T0 - 30 * DAY) => stub.put('sessions', id, { id, channel: 'live', isMTT: false, format: 'NLH', hours: 4, ...o }, at);
  s('s-cash-1', { date: '2026-03-05', gameLabel: '2/5 NLH', venue: 'Parx', stakeLevel: '2/5', buyInTotal: 500, cashOut: 1300, hours: 6, result: 800, place: 3, moodRating: 4, tags: ['grind'] });
  s('s-cash-2', { date: '2026-03-13', format: 'PLO', gameLabel: '5/5/10 PLO', venue: 'Parx Casino', stakeLevel: '5/5/10', buyInTotal: 1000, cashOut: 2000, hours: 7.5, result: 1000 });
  s('s-cash-3', { date: '2026-02-01', channel: 'online', gameLabel: 'NL200 6-max', venue: 'ACR', buyInTotal: 200.25, cashOut: 650.1, hours: 2.5, result: 449.85, hands: 800,
    tiltNote: 'stayed calm', journal: 'good session', tags: ['zoom', '6max'] }, T0 - 2 * DAY);
  s('s-fund-1', { date: '2026-05-20', isMTT: true, format: 'PLO', gameLabel: 'WSOP $1,500 PLO', venue: 'Horseshoe Las Vegas', buyInTotal: 1500, entries: 1, cashOut: 4200.75,
    place: 31, fieldSize: 1200, result: 2700.75, hours: 9, isWsopFund: true });
  s('s-fund-2', { date: '2026-06-01', format: 'mixed', gameLabel: '10/20 mix', venue: 'Aria', buyInTotal: 2000, cashOut: 1500, result: -500, isWsopFund: true });
  s('s-mtt-1', { date: '2026-04-02', isMTT: true, gameLabel: '600 NLH Deepstack', venue: 'Borgata', buyInTotal: 1200, entries: 2, cashOut: 0, result: -1200, hours: 5 });
  s('s-mtt-2', { date: '2026-04-10', isMTT: true, channel: 'online', format: 'PLO8', gameLabel: 'Sunday PLO8 Major', venue: 'WSOP.com', buyInTotal: 315, entries: 3, cashOut: 0, result: -315 });
  s('s-mtt-3', { date: '2026-04-11', isMTT: true, gameLabel: 'Live! $400 Bounty', venue: 'Live! Casino', buyInTotal: 400, entries: 3, cashOut: 1000, result: 600, hours: 6 });
  s('chat-1a2b3c4d5e6f', { date: '2026-08-01', gameLabel: '1/3 NLH', venue: 'Parx', buyInTotal: 300, cashOut: 0, result: -300, hours: 3 }, T0 - 3 * DAY);
  if (!clean) s('s-err-1', { date: '2026-07-05', gameLabel: '1/2 NLH', venue: 'Parx', buyInTotal: 100, cashOut: 300, result: 250 });
  s('s-wynn', { date: '2026-07-10', gameLabel: '2/5 NLH', venue: 'Wynn', buyInTotal: 200, cashOut: 500, result: 300, hours: 5 });
  s('s-dup-a', { date: '2026-07-20', gameLabel: '2/5 NLH', venue: 'Parx', buyInTotal: 300, cashOut: 500, result: 200 }, T0 - 5 * DAY);
  s('s-dup-b', { date: '2026-07-20', gameLabel: '2/5 NLH', venue: 'Parx', buyInTotal: 300, cashOut: 500, result: 200 });
  s('s-bigo', { date: '2026-08-05', channel: 'online', format: 'BigO', gameLabel: 'Big O 1/2', venue: 'Ace Poker Club', buyInTotal: 100, cashOut: 180, result: 80, hours: 2 });
  stub.tomb('sessions', 's-gone', T0 - 40 * DAY);

  const a = (id, o, at = T0 - 30 * DAY) => stub.put('adjustments', id, { id, ...o }, at);
  a('a-dep-1', { date: '2026-05-03', type: 'deposit', amount: 2000, note: 'from bank' });
  a('a-wd-1', { date: '2026-06-15', type: 'withdrawal', amount: -1500, note: 'rent' });
  a('a-wd-pos', { date: '2026-06-20', type: 'withdrawal', amount: 500, note: 'typed without the minus' });
  a('a-corr', { date: '2026-06-25', type: 'correction', amount: -37.4, note: 'count' });
  a('a-xfer-1', { date: '2026-02-10', type: 'wsop-fund-transfer', amount: 5000.4, note: 'first feed' });
  a('a-xfer-2', { date: '2026-09-01', type: 'wsop-fund-transfer', amount: -1000, note: 'back to the roll' });
  a('a-settle-1', { date: '2026-05-25', type: 'backer-settlement', amount: -1260, note: "WSOP $1,500 PLO: backers' 30% of $4,200.75 → Sam Okafor" });
  a('a-settle-2', { date: '2026-09-05', type: 'backer-settlement', amount: -100, note: "Mystery event: backers' 10% of $1,000" });
  if (!clean) a('a-zero', { date: '2026-06-30', type: 'deposit', amount: 0 });
  stub.tomb('adjustments', 'a-gone', T0 - 40 * DAY);

  const e = (id, o, at = T0 - 30 * DAY) => stub.put('expenses', id, { id, ...o }, at);
  e('e-1', { date: '2026-06-10', category: 'travel', amount: 412.5, note: 'flight to Vegas' });
  e('e-2', { date: '2026-05-19', category: 'lodging', amount: 899.99 });
  e('e-3', { date: '2026-05-21', category: 'meals', amount: 64.2 });
  e('e-4', { date: '2026-05-22', category: 'coaching', amount: 250 });
  e('e-5', { date: '2026-03-01', category: 'equipment', amount: 1299 });
  e('e-6', { date: '2026-03-02', category: 'fees', amount: 4.99 });
  e('e-7', { date: '2026-03-03', category: 'other', amount: 20, note: 'misc' });

  if (!clean) {
    const b = (id, o, at = T0 - 30 * DAY) => stub.put('backers', id, { id, createdAt: 1, ...o }, at);
    b('b-sam', { token: TOKEN.sam, name: 'Sam Okafor', stakes: [{ format: 'PLO', channel: 'any', pct: 20 }, { format: 'NLH', channel: 'live', pct: 10 }], delivery: { email: 'sam@example.test' }, opening: 125.5 });
    b('b-mo', { token: TOKEN.mo, name: 'Mo Chen', stakes: [{ format: 'all', channel: 'online', pct: 5 }], delivery: { sms: '+15555550100' }, opening: 0 });
    b('b-lee', { token: TOKEN.lee, name: 'Lee Park', stakes: [{ format: 'mixed', channel: 'any', pct: 15 }], opening: -80 });
    stub.tomb('backers', 'b-gone', T0 - 35 * DAY);
  }
  stub.put('settings', 'app', { id: 'app', startingRoll: 25000.4, updatedAt: T0 }, T0);

  if (!clean) {
    stub.setLocal('wsop-staking', [
      { id: 'd-1', event: 'WSOP $1,500 PLO', buyIn: 1500, pctSold: 30, markup: 1.1, backer: 'Sam Okafor', settled: true },
      { id: 'd-2', event: 'WSOP $1,500 PLO', buyIn: 1500, pctSold: 10, markup: 1.2, backer: 'Dana Slate' },
      { id: 'd-3', event: 'WSOP $10K Main', buyIn: 10000, pctSold: 50, markup: 1 },
      { id: 'd-4', event: 'Old Event', buyIn: 500, pctSold: 20, markup: 1, backer: 'Lee Park', settled: true },
    ], T0 - 20 * DAY);
    stub.setLocal('wsop-balances', { entries: [{ id: 'bank', name: 'Bank', amount: 30000 }, { id: 'parx', name: 'Parx front', amount: 1500.5 }], updatedAt: '2026-09-01T00:00:00Z' }, T0 - 20 * DAY);
    stub.setLocal('wsop-admin-taxrate', 28, T0 - 20 * DAY);
    stub.setLocal('wsop-notified-sessions', ['s-cash-1', 's-cash-2', 's-ghost'], T0 - 20 * DAY);
  }
}

/** The delta: what changed in the dashboard after the first pull (T0). */
function seedDelta(stub) {
  // A phone that edited offline and synced late: stamped BEFORE the cursor the import holds.
  stub.put('sessions', 's-late-1', { id: 's-late-1', date: '2026-09-20', channel: 'live', isMTT: false, format: 'NLH', gameLabel: '2/5 NLH', venue: 'Parx',
    buyInTotal: 200, cashOut: 450, result: 250, hours: 3 }, T0 - 3 * DAY);
  const wynn = stub.live('sessions').find((x) => x.id === 's-wynn');
  stub.put('sessions', 's-wynn', { ...wynn, cashOut: 650, result: 450 }, T0 + DAY);
  const c3 = stub.live('sessions').find((x) => x.id === 's-cash-3');
  stub.put('sessions', 's-cash-3', { ...c3, cashOut: 700.1, result: 499.85 }, T0 + DAY);
  stub.tomb('expenses', 'e-6', T0 + DAY);
  const mo = stub.live('backers').find((x) => x.id === 'b-mo');
  stub.put('backers', 'b-mo', { ...mo, opening: 50 }, T0 + DAY);
}

const run = (db, sql, p = []) => db.run(sql, p);
const lastId = (db) => db.exec('SELECT last_insert_rowid()')[0].values[0][0];

/** What the owner already holds here (futurega.me) before the import, plus the dashboard-era backer
 *  surface (the roster copy, names, recorded shares). -> ids */
function seedHere(db, uid) {
  const ids = {};
  const cash = (date, room, game, stakes, buy, out, startIso, hours) => {
    run(db, `INSERT INTO cash_sessions (user_id, bankroll_id, started_at, ended_at, session_date, room, game, stakes, buy_in, rebuys, cash_out, tips, expenses, currency, created_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 'USD', '2026-01-01T00:00:00Z')`,
    [uid, startIso, new Date(Date.parse(startIso) + hours * 3600e3).toISOString(), date, room, game, stakes, buy, out]);
    return lastId(db);
  };
  ids.preD = cash('2026-01-20', 'Parx', 'NLH', '1/3', 200, 450, '2026-01-20T23:00:00.000Z', 4);           // before the opening date
  ids.h1 = cash('2026-03-04', 'Parx Casino', 'NLH', '2/5', 500, 1300, '2026-03-04T23:30:00.000Z', 6);      // late night: the dashboard says 03-05
  ids.h2 = cash('2026-03-13', 'Parx', 'PLO', '5/5/10', 1000, 1950, '2026-03-13T22:00:00.000Z', 7.5);        // the same night, the net off by 50
  ids.h3 = cash('2026-07-10', 'Aria', 'NLH', '2/5', 300, 600, '2026-07-10T22:00:00.000Z', 2);              // same day as s-wynn, another room
  ids.h4 = cash('2026-07-22', 'Parx', 'NLH', '2/5', 300, 500, '2026-07-22T22:00:00.000Z', 4);              // two days from s-dup-a/b
  ids.h5 = cash('2026-08-15', 'Live! Casino', 'NLH', '2/5', 400, 900, '2026-08-15T22:00:00.000Z', 5);      // only here
  ids.h6 = cash('2026-04-10', 'WSOP.com', 'PLO8', '', 315, 0, '2026-04-10T22:00:00.000Z', 4);              // a cash row the day of an MTT: never pairs

  run(db, `INSERT INTO tournaments (stable_id, event_number, event_name, date, time, buyin, game_variant, venue, property, uploaded_by, source_pdf)
    VALUES ('TEST-BORGATA-0402', '12', '$600 NLH Deepstack', '2026-04-02', '11:00 AM', 600, 'NLH', 'Borgata Fall Poker Open 2026', 'Borgata Hotel Casino & Spa', NULL, 'mtt-feed')`);
  ids.feedT = lastId(db);
  run(db, 'INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, finish_place, cash_amount, notes) VALUES (?, ?, 2, 0, NULL, 0, NULL)', [uid, ids.feedT]);
  ids.feedE = lastId(db);
  run(db, `INSERT INTO tournaments (stable_id, event_number, event_name, date, time, buyin, game_variant, venue, property, uploaded_by, source_pdf)
    VALUES (?, '', 'Live! $400 NLH', '2026-08-20', '', 400, 'NLH', 'Personal', 'Live! Casino Philadelphia', ?, 'bankroll-import')`, [`PERSONAL-${uid}-imp-fixture-1`, uid]);
  ids.persT = lastId(db);
  run(db, 'INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, finish_place, cash_amount, notes) VALUES (?, ?, 1, 1, 3, 1900, NULL)', [uid, ids.persT]);
  ids.persE = lastId(db);

  const adj = (date, kind, amount, note) => { run(db, "INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, transfer_id, occurred_on, note, created_at) VALUES (?, NULL, ?, ?, NULL, ?, ?, '2026-01-01T00:00:00Z')", [uid, kind, amount, date, note]); return lastId(db); };
  ids.dep0 = adj('2026-01-15', 'deposit', 10000, 'opening here');
  ids.dep1 = adj('2026-05-01', 'deposit', 2000, 'bank');
  run(db, "INSERT INTO bankroll_transactions (user_id, bankroll_id, occurred_on, kind, category, amount, currency, note, created_at) VALUES (?, NULL, '2026-06-10', 'expense', 'travel', 412.5, 'USD', 'flight', '2026-01-01T00:00:00Z')", [uid]);
  ids.tx1 = lastId(db);

  run(db, "INSERT INTO backers (user_id, name, notes) VALUES (?, 'Lee Park', 'staking backer')", [uid]);
  ids.leeBacker = lastId(db);

  // The dashboard-era backer surface, as the live database holds it.
  const roster = (id, rec) => run(db, "INSERT INTO console_records (store, id, data, updated_at, deleted) VALUES ('backers', ?, ?, 1000, 0)", [id, JSON.stringify({ id, ...rec })]);
  roster('b-sam', { token: TOKEN.sam, name: 'Sam Okafor', stakes: [{ format: 'PLO', channel: 'any', pct: 20 }, { format: 'NLH', channel: 'live', pct: 10 }], delivery: { email: 'sam@example.test' }, opening: 125.5 });
  roster('b-mo', { token: TOKEN.mo, name: 'Mo Chen', stakes: [{ format: 'all', channel: 'online', pct: 5 }], delivery: { sms: '+15555550100' }, opening: 0 });
  roster('b-lee', { token: TOKEN.lee, name: 'Lee Park', stakes: [{ format: 'mixed', channel: 'any', pct: 15 }], opening: -80 });
  roster('b-gone', { token: TOKEN.gone, name: 'Ari Gone', stakes: [{ format: 'NLH', channel: 'any', pct: 10 }], delivery: { email: 'ari@example.test' }, opening: 40 });
  const pub = (t, n) => run(db, 'INSERT INTO backer_public (token, name, updated_at) VALUES (?, ?, 1000)', [t, n]);
  pub(TOKEN.sam, 'Sam O.'); // an older name the last notify left: the SQL path shows the roster's
  pub(TOKEN.mo, 'Mo Chen'); pub(TOKEN.gone, 'Ari Gone'); pub(TOKEN.hist, 'Hist Only');
  const ev = (t, sid, date, game, venue, hours, res, pct, share) => run(db, `INSERT INTO backer_events (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [`${t}:${sid}`, t, sid, Date.parse(date + 'T23:00:00Z'), date, game, venue, hours, res, pct, share]);
  ev(TOKEN.sam, 's-cash-1', '2026-03-05', '2/5 NLH', 'Parx', 6, 80000, 10, 8000);
  ev(TOKEN.sam, 's-cash-2', '2026-03-13', '5/5/10 PLO', 'Parx Casino', 7.5, 90000, 20, 18000); // the session was edited after notify
  ev(TOKEN.mo, 's-mtt-2', '2026-04-10', 'PLO8 MTT', 'WSOP.com', 4, -31500, 5, -1575);
  ev(TOKEN.hist, 'h-old-1', '2025-12-01', 'NLH', 'Parx', 5, 50000, 15, 7500);
  ev(TOKEN.gone, 'g-old', '2025-11-01', 'NLH', 'Parx', 5, 20000, 10, 2000);
  return ids;
}

module.exports = { DAY, T0, TOKEN, seedDashboard, seedDelta, seedHere };
