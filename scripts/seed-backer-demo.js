#!/usr/bin/env node
'use strict';
/*
 * Made-up backers for a SCRATCH database, so the backer page (/b/<token>) can be looked at and the
 * guards can visit it (check-control-centring.mjs / check-text-clipping.mjs, CHECK_BACKER_TOKENS).
 *
 *   node scripts/seed-backer-demo.js <scratch.db>
 *
 * The database must already exist (boot server.js on it once so its tables are made). Writes, as
 * the dashboard's roster sync and notify route would: console_records (store 'backers', the
 * backer object: token, name, stakes, opening), backer_public (the name), backer_events (one row
 * per session). Prints the tokens as CHECK_BACKER_TOKENS wants them: full,empty,one,two.
 *
 * NEVER point this at poker-tournaments.db: the live DB holds real backer tokens, which are the
 * whole of each backer's authentication (CLAUDE.md, seam #3). It refuses that file by name.
 * Every token, name and figure here is invented.
 */
const fs = require('fs');
const path = require('path');

const BACKERS = [
  // A season's history: 40 sessions over eight months, PLO and NLH, live and online.
  { key: 'full', token: 'DemoSam7Kq2Vx', name: 'Sam Okafor', opening: 500,
    stakes: [{ format: 'PLO', pct: 20, channel: 'any' }, { format: 'NLH', pct: 10, channel: 'online' }], sessions: 40 },
  // Created on the dashboard, nothing logged yet.
  { key: 'empty', token: 'DemoPriya9xLm', name: 'Priya Raman', opening: 0,
    stakes: [{ format: 'all', pct: 15, channel: 'any' }], sessions: 0 },
  { key: 'one', token: 'DemoDan4WmQe8', name: 'Daniel Whitcombe', opening: 0,
    stakes: [{ format: 'PLO', pct: 25, channel: 'live' }], sessions: 1 },
  { key: 'two', token: 'DemoMo2Pz8Rt5', name: 'Mo Chen', opening: -250,
    stakes: [{ format: 'NLH', pct: 10, channel: 'any' }], sessions: 2 },
];

// Real rooms (vite-app/src/utils/utils.js VENUE_MAP / PROPERTY_COORDS) and two it does not know.
const LIVE = ['Borgata', 'Parx Casino', 'Live! Casino Philadelphia', 'Bellagio', 'Wynn', 'Aria',
  'MGM National Harbor', 'Maryland Live! Casino at Arundel Mills', "Harrah's Philadelphia", 'Delaware Park'];
const ONLINE = ['WSOP.com', 'BetRivers', 'ACR'];
const GAMES = [
  { game: '5/5/10 PLO', format: 'PLO', live: true, spread: 3200, hours: [4, 9] },
  { game: '2/5/5 PLO', format: 'PLO', live: true, spread: 1600, hours: [3, 8] },
  { game: '5/10 NLH', format: 'NLH', live: true, spread: 2600, hours: [4, 10] },
  { game: '2/5 NLH', format: 'NLH', live: true, spread: 1200, hours: [3, 7] },
  { game: 'PLO MTT', format: 'PLO', live: false, spread: 2400, hours: [3, 7] },
  { game: 'NLH MTT', format: 'NLH', live: false, spread: 1800, hours: [2, 6] },
  { game: '1/2 PLO', format: 'PLO', live: false, spread: 900, hours: [2, 4] },
];

// Deterministic, so the pages (and their screenshots) are the same on every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const iso = (t) => new Date(t).toISOString().slice(0, 10);

function sessionsFor(b, seed) {
  const r = rng(seed);
  const out = [];
  const end = Date.parse('2026-10-12T00:00:00Z');
  const span = b.sessions > 2 ? 240 : 20; // days back from Oct 12: eight months, or a fortnight
  for (let i = 0; i < b.sessions; i++) {
    const g = GAMES[Math.floor(r() * GAMES.length)];
    const stake = b.stakes.find((s) => s.format === g.format || s.format === 'all') || b.stakes[0];
    const room = g.live ? LIVE[Math.floor(r() * LIVE.length)] : ONLINE[Math.floor(r() * ONLINE.length)];
    const hours = Math.round((g.hours[0] + r() * (g.hours[1] - g.hours[0])) * 2) / 2;
    // A winning player's spread: slightly more wins than losses, the odd big one.
    const swing = (r() - 0.42) * 2 * g.spread * (r() < 0.12 ? 2.5 : 1);
    const resultCents = Math.round(swing) * 100;
    const pct = stake.pct;
    const day = Math.round(((b.sessions - 1 - i) / Math.max(1, b.sessions - 1)) * span + r() * 3);
    out.push({
      id: `demo-${b.key}-${i + 1}`, date: iso(end - day * 864e5), game: g.game, venue: room, hours,
      resultCents, pct, shareCents: Math.round(resultCents * pct / 100),
      ts: end - day * 864e5 + 6 * 3600e3 + i * 1000,
    });
  }
  return out;
}

/** Writes the demo backers into an open sql.js Database. Returns { full, empty, one, two } tokens. */
function seedBackerDemo(db) {
  const now = Date.now();
  const tokens = {};
  BACKERS.forEach((b, n) => {
    tokens[b.key] = b.token;
    const obj = { id: `demo-${b.key}`, token: b.token, name: b.name, stakes: b.stakes, opening: b.opening, createdAt: now };
    db.run(`INSERT OR REPLACE INTO console_records (store, id, data, updated_at, deleted) VALUES ('backers', ?, ?, ?, 0)`,
      [obj.id, JSON.stringify(obj), now]);
    db.run('DELETE FROM backer_events WHERE token = ?', [b.token]);
    db.run('DELETE FROM backer_public WHERE token = ?', [b.token]);
    const rows = sessionsFor(b, 20261013 + n * 7919);
    if (rows.length) db.run('INSERT INTO backer_public (token, name, updated_at) VALUES (?, ?, ?)', [b.token, b.name, now]);
    for (const s of rows) {
      db.run(`INSERT INTO backer_events (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`${b.token}:${s.id}`, b.token, s.id, s.ts, s.date, s.game, s.venue, s.hours, s.resultCents, s.pct, s.shareCents]);
    }
  });
  return tokens;
}

module.exports = { seedBackerDemo, BACKERS };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/seed-backer-demo.js <scratch.db>'); process.exit(2); }
  if (/poker-tournaments\.db$/i.test(path.basename(file))) {
    console.error('Refusing: poker-tournaments.db is the live database (it holds real backer tokens). Use a scratch DB.');
    process.exit(2);
  }
  if (!fs.existsSync(file)) { console.error(`${file} does not exist: boot server.js on it once first (DB_PATH=${file}).`); process.exit(2); }
  (async () => {
    const SQL = await require('sql.js')();
    const db = new SQL.Database(fs.readFileSync(file));
    const tokens = seedBackerDemo(db);
    fs.writeFileSync(file, Buffer.from(db.export()));
    console.log(`CHECK_BACKER_TOKENS=${tokens.full},${tokens.empty},${tokens.one},${tokens.two}`);
  })().catch((e) => { console.error(e); process.exit(1); });
}
