#!/usr/bin/env node
'use strict';
/*
 * Made-up standing agreements in a SCRATCH database, so the Staking tab's Standing view
 * (components/StandingView.jsx; docs/bankroll-merge.md Phase 8) can be looked at and the guards can
 * walk it (check-control-centring.mjs staking-standing*, check-text-clipping.mjs staking-standing).
 *
 *   node scripts/seed-standing-demo.js <scratch.db> [--owner <userId>]
 *
 * The database must have every migration (boot server.js on it once) and the server must be STOPPED
 * while this runs. It writes, for the owner: three staking backers with links (one agreement with two
 * dated stakes and three recorded shares, one with a dashboard-era share on a result, one ended), the
 * results those shares point at (a Personal tournament, a cash session), and one share a feed edit
 * has moved under (the drift report). NEVER against poker-tournaments.db: it refuses that name.
 * Every name, link and figure is invented.
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith('--'));
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const die = (m) => { console.error(`seed-standing-demo: ${m}`); process.exit(1); };
if (!dbPath) die('usage: node scripts/seed-standing-demo.js <scratch.db> [--owner <userId>]');
if (/poker-tournaments/i.test(path.basename(dbPath))) die('refusing the live database');
if (!fs.existsSync(dbPath)) die(`${dbPath} does not exist: boot server.js on it once first`);

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const rows = (sql, p = []) => { const r = db.exec(sql, p); return r.length ? r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]]))) : []; };
  const one = (sql, p = []) => rows(sql, p)[0] || null;
  const lastId = () => db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  if (!one("SELECT name FROM sqlite_master WHERE name = 'standing_agreements'")) die('no standing tables: boot server.js on this database once');
  let uid = opt('--owner') != null ? Number(opt('--owner')) : null;
  if (uid == null) uid = (one("SELECT id FROM users WHERE username IN ('ham', 'ham5') ORDER BY username = 'ham' DESC LIMIT 1") || one('SELECT id FROM users ORDER BY id LIMIT 1') || {}).id;
  if (uid == null) die('no users in this database');
  if (one("SELECT id FROM backers WHERE user_id = ? AND name = 'Demo Standing Sam'", [uid])) { console.log('already seeded'); process.exit(0); }
  const now = '2026-10-14T00:00:00Z';
  const backer = (name, token, phone) => { db.run('INSERT INTO backers (user_id, name, phone, public_token, notify_sms, notify_email) VALUES (?, ?, ?, ?, ?, 0)', [uid, name, phone || null, token, phone ? 1 : 0]); return lastId(); };
  const agreement = (b, from, stakes, status = 'active', to = null, opening = 0) => {
    db.run('INSERT INTO standing_agreements (user_id, backer_id, effective_from, effective_to, status, opening_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [uid, b, from, to, status, opening, now]);
    const id = lastId();
    for (const s of stakes) db.run('INSERT INTO standing_stakes (agreement_id, format, channel, pct, valid_from, valid_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, s.format, s.channel, s.pct, s.from || from, s.to || null, now]);
    return id;
  };
  const sam = backer('Demo Standing Sam', 'DemoSam0001', '+15555550111');
  const lee = backer('Demo Standing Lee Park-Whitcombe', 'DemoLee0001');
  const mo = backer('Demo Standing Mo', 'DemoMo00001');
  const agSam = agreement(sam, '2026-01-01', [{ format: 'NLH', channel: 'live', pct: 25, to: '2026-09-30' }, { format: 'NLH', channel: 'live', pct: 30, from: '2026-10-01' }, { format: 'PLO', channel: 'any', pct: 20, from: '2026-10-01' }], 'active', null, 12550);
  const agLee = agreement(lee, '2026-03-01', [{ format: 'all', channel: 'online', pct: 15 }]);
  agreement(mo, '2026-02-01', [{ format: 'PLO', channel: 'live', pct: 10 }], 'ended', '2026-06-30');

  // Results the shares point at: a Personal event (the owner's) and a cash session.
  db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, property, is_online, notes, uploaded_by)
          VALUES ('', 'Demo home game $600 NLH', '2026-10-10', '12:00 PM', 600, 'NLH', 'Personal', NULL, 0, '', ?)`, [uid]);
  const t1 = lastId();
  db.run('INSERT INTO user_schedules (user_id, tournament_id) VALUES (?, ?)', [uid, t1]);
  db.run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, cash_amount) VALUES (?, ?, 1, 1, 2400)', [uid, t1]);
  const te1 = lastId();
  db.run(`INSERT INTO cash_sessions (user_id, bankroll_id, started_at, ended_at, session_date, room, game, stakes, buy_in, rebuys, cash_out, tips, expenses, currency, created_at)
          VALUES (?, NULL, '2026-10-08T22:00:00Z', '2026-10-09T03:00:00Z', '2026-10-08', 'Demo Casino Parx', 'NLH', '2/5', 1000, 0, 1800, 40, 60, 'USD', ?)`, [uid, now]);
  const cs1 = lastId();
  const ts = Date.parse('2026-10-11T03:00:00Z');
  const ev = (token, sid, agreementId, table, id, date, game, venue, hours, result, pct, share, source = 'ledger', told = share) => {
    db.run(`INSERT INTO backer_events (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents, source, agreement_id, ref_table, ref_id, notified_share_cents, notified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [`${token}:${sid}`, token, sid, ts, date, game, venue, hours, result, pct, share, source, agreementId, table, id, told, ts]);
    db.run("INSERT INTO backer_event_revisions (event_id, token, at, action, share_after, result_after, pct_after, cause) VALUES (?, ?, ?, 'post', ?, ?, ?, 'notify')", [`${token}:${sid}`, token, ts, share, result, pct]);
  };
  // Sam: the home game (its share told at 25%, since corrected to 30%: "told"), the cash night, and a
  // share a feed edit moved under (the stale 15000 against the result's 1800 x 30% = 54000... the
  // drift report lists it).
  ev('DemoSam0001', `fg-te-${te1}`, agSam, 'tracking_entries', te1, '2026-10-10', 'NLH MTT', 'Personal', 0, 180000, 30, 15000, 'ledger', 45000);
  ev('DemoSam0001', `fg-cs-${cs1}`, agSam, 'cash_sessions', cs1, '2026-10-08', '2/5 NLH', 'Demo Casino Parx', 5, 70000, 30, 21000);
  ev('DemoSam0001', '0b9c2f3e-2222-4a5b-9c8d-000000000021', null, 'tracking_entries', te1, '2026-09-05', 'PLO MTT', 'Demo Borgata', 4, -40000, 20, -8000, 'dashboard');
  ev('DemoLee0001', '0b9c2f3e-2222-4a5b-9c8d-000000000022', null, null, null, '2026-09-02', '$109 NLH Online', 'GGPoker', 3, 50000, 15, 7500, 'dashboard');
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  console.log(`seeded standing demo for user ${uid}: 3 backers, 3 agreements, 4 shares (one adrift), a Personal event and a cash session`);
})().catch((e) => { console.error(e); process.exit(2); });
