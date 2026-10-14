#!/usr/bin/env node
'use strict';
/*
 * Made-up staking series for a SCRATCH database, so the settlement sheet (docs/bankroll-merge.md
 * §10) can be looked at and the guards can visit it: check-control-centring.mjs (views
 * staking-settlement-open / -settled) and check-text-clipping.mjs find the series by name.
 *
 *   node scripts/seed-staking-demo.js <scratch.db> [username]      (username default ham5)
 *
 * Boot server.js on the database once first (so its tables and the staking-settlement migration
 * exist), and stop it: this writes the file directly. It adds, for that user:
 *   "Guard Open"     an open series: pay-per-play at a markup, makeup carrying a loss, a budget cap,
 *                    profit share, a swap and a crossbook (the inputs the sheet asks for), an event
 *                    not played (a refund) and one still marked in progress.
 *   "Guard Settled"  a settled series (through lib/staking/settlement.js settleSeries, as the route
 *                    does), one settlement marked paid into Main (one ledger row).
 *
 * NEVER point this at poker-tournaments.db: the live DB is production-sensitive (CLAUDE.md, seam
 * #3). It refuses that file by name. Every name and figure here is invented.
 */
const fs = require('fs');
const path = require('path');
const settlement = require('../lib/staking/settlement');

(async () => {
  const file = process.argv[2];
  const username = process.argv[3] || 'ham5';
  if (!file) { console.error('usage: node scripts/seed-staking-demo.js <scratch.db> [username]'); process.exit(2); }
  if (/poker-tournaments\.db$/i.test(path.basename(file))) { console.error('refusing the live database'); process.exit(2); }
  const SQL = await require('sql.js')();
  const db = new SQL.Database(fs.readFileSync(file));
  const one = (sql, args = []) => { const r = db.exec(sql, args); return r.length && r[0].values.length ? r[0].values[0][0] : null; };
  const ins = (sql, args) => { db.run(sql, args); return one('SELECT last_insert_rowid()'); };
  const uid = one('SELECT id FROM users WHERE lower(username) = lower(?)', [username]);
  if (!uid) { console.error(`no user ${username}`); process.exit(2); }
  if (one("SELECT COUNT(*) FROM staking_series WHERE user_id = ? AND name IN ('Guard Open', 'Guard Settled')", [uid])) {
    console.error('already seeded'); process.exit(0);
  }
  const now = new Date().toISOString();
  const backer = (name) => ins('INSERT INTO backers (user_id, name) VALUES (?, ?)', [uid, name]);
  const t = (name, date, buyin) => ins("INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, notes) VALUES ('', ?, ?, '12:00 PM', ?, 'NLH', 'Guard Casino', '')", [name, date, buyin]);
  const series = (name, start, end) => ins("INSERT INTO staking_series (user_id, name, venue, start_date, end_date, currency, status, created_at) VALUES (?, ?, 'Guard Casino', ?, ?, 'USD', 'active', ?)", [uid, name, start, end, now]);
  const agreement = (seriesId, backerId, type, o = {}) => ins(`INSERT INTO backer_agreements (series_id, backer_id, backer_type, percentage, markup,
      swap_my_pct, swap_their_pct, crossbook_my_pct, crossbook_their_pct, budget_cap, makeup_balance, makeup_opening, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`, [seriesId, backerId, type, o.pct || 0, o.markup || 1,
    o.swapMy || null, o.swapTheir || null, o.cbMy || null, o.cbTheir || null, o.cap || null, o.makeup || 0, type === 'makeup' ? (o.makeup || 0) : null, now]);
  const log = (agreementId, tId, o) => db.run(`INSERT INTO backer_event_status (agreement_id, tournament_id, bullets_used, buyin_amount, cash_amount, status, tip_amount, currency_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1.0)`, [agreementId, tId, o.bullets || 1, o.buyin, o.cash || null, o.status || 'busted', o.tip || 0]);

  const sam = backer('Sam Okafor');
  const priya = backer('Priya Raman');
  const dan = backer('Daniel Whitcombe-Fairweather');
  const mo = backer('Mo Chen');
  const kim = backer('Kim Swapwell');

  const e1 = t('Guard Event 1 - NLH Freezeout', '2026-06-02', 1500);
  const e2 = t('Guard Event 2 - PLO 6-Max', '2026-06-04', 3000);
  const e3 = t('Guard Event 3 - NLH Main Event - Day 1', '2026-06-08', 10000);
  const e4 = t('Guard Event 4 - HORSE', '2026-06-10', 2500);
  const e5 = t('Guard Event 5 - NLH Monster Stack', '2026-06-12', 1500);

  // ── Guard Open ──
  const open = series('Guard Open', '2026-06-01', '2026-07-15');
  const aSam = agreement(open, sam, 'pay_per_play', { pct: 10, markup: 1.2 });
  log(aSam, e1, { buyin: 1500, bullets: 2 });
  log(aSam, e3, { buyin: 10000, cash: 48500, status: 'cashed', tip: 500 });
  log(aSam, e4, { buyin: 2500, status: 'cancelled' });
  log(aSam, e5, { buyin: 1500, status: 'pending' });
  const aDan = agreement(open, dan, 'makeup', { pct: 20, markup: 1, makeup: -1250 });
  log(aDan, e2, { buyin: 3000, cash: 9000, status: 'cashed' });
  const aPriya = agreement(open, priya, 'budget_capped', { pct: 10, markup: 1.1, cap: 1000 });
  log(aPriya, e1, { buyin: 1500 });
  log(aPriya, e3, { buyin: 10000, cash: 48500, status: 'cashed', tip: 500 });
  const aMo = agreement(open, mo, 'profit_share_only', { pct: 5 });
  log(aMo, e3, { buyin: 10000, cash: 48500, status: 'cashed', tip: 500 });
  const aKim = agreement(open, kim, 'swap', { swapMy: 5, swapTheir: 5 });
  log(aKim, e3, { buyin: 10000, cash: 48500, status: 'cashed', tip: 500 });
  const aKim2 = agreement(open, kim, 'crossbook', { cbMy: 10, cbTheir: 10 });
  log(aKim2, e2, { buyin: 3000, cash: 9000, status: 'cashed' });
  void aKim2;

  // ── Guard Settled ──
  const done = series('Guard Settled', '2026-05-01', '2026-05-20');
  const sSam = agreement(done, sam, 'pay_per_play', { pct: 15, markup: 1.1 });
  log(sSam, e1, { buyin: 1500, cash: 6200, status: 'cashed' });
  const sMo = agreement(done, mo, 'pay_per_play', { pct: 10, markup: 1.2 });
  log(sMo, e2, { buyin: 3000 });
  const sKim = agreement(done, kim, 'swap', { swapMy: 5, swapTheir: 5 });
  log(sKim, e1, { buyin: 1500, cash: 6200, status: 'cashed' });
  const sheet = settlement.settleSeries(db, done, uid, { prepaid: [{ agreementId: sMo, amount: 0 }], partner: [{ agreementId: sKim, amount: 2400 }] });
  const paid = sheet.settlements.find((e) => e.agreementId === sSam);
  const r = settlement.setPaid(db, uid, paid.id, { isPaid: true, date: '2026-05-22' });
  if (r.status !== 200) throw new Error('mark paid: ' + JSON.stringify(r.body));

  fs.writeFileSync(file, Buffer.from(db.export()));
  db.close();
  console.log(`seeded "Guard Open" (${open}) and "Guard Settled" (${done}) for ${username}`);
})().catch((e) => { console.error(e); process.exit(1); });
