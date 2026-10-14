'use strict';
/*
 * Made-up backers for the backer-surface tests, written into an open sql.js Database whose schema
 * is the real one (test/helpers/scratch-server.js createScratch). Every name, token, address,
 * phone number and figure here is invented; none belongs to a real person.
 */

/** A dashboard-era roster record (console_records, store 'backers'). */
function addRoster(db, rec, { deleted = 0, updatedAt = 1000 } = {}) {
  db.run("INSERT OR REPLACE INTO console_records (store, id, data, updated_at, deleted) VALUES ('backers', ?, ?, ?, ?)",
    [rec.id, JSON.stringify(rec), updatedAt, deleted]);
}

/** A recorded share (backer_events). Defaults to the dashboard's: source 'dashboard', never notified_*. */
function addEvent(db, e) {
  const ts = e.ts == null ? 1_700_000_000_000 : e.ts;
  db.run(`INSERT INTO backer_events (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`${e.token}:${e.sessionId}`, e.token, e.sessionId, ts, e.date || '2026-09-01', e.game || '5/5/10 PLO', e.venue || 'Test Room',
      e.hours == null ? 5 : e.hours, e.result == null ? 100000 : e.result, e.pct == null ? 20 : e.pct,
      e.share == null ? Math.round((e.result == null ? 100000 : e.result) * (e.pct == null ? 20 : e.pct) / 100) : e.share]);
  const sets = [], args = [];
  for (const k of ['source', 'agreement_id', 'stake_id', 'ref_table', 'ref_id', 'revised_at', 'notified_share_cents', 'notified_at']) {
    if (e[k] !== undefined) { sets.push(`${k} = ?`); args.push(e[k]); }
  }
  if (sets.length) db.run(`UPDATE backer_events SET ${sets.join(', ')} WHERE id = ?`, [...args, `${e.token}:${e.sessionId}`]);
}

function addPublicName(db, token, name) {
  db.run('INSERT OR REPLACE INTO backer_public (token, name, updated_at) VALUES (?, ?, ?)', [token, name, 1000]);
}

/**
 * A merged-roster backer: a backers row with a public_token and its standing agreements.
 * agreements: [{ status = 'active', from = '2026-01-01', to = null, openingCents = 0, stakes: [{ format, channel, pct, from?, to? }] }]
 * -> backers.id
 */
function addSqlBacker(db, b) {
  db.run('INSERT INTO backers (user_id, name, email, phone, public_token, notify_sms, notify_email) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [b.userId == null ? 1 : b.userId, b.name, b.email || null, b.phone || null, b.token === undefined ? null : b.token,
      b.notifySms ? 1 : 0, b.notifyEmail ? 1 : 0]);
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  for (const a of b.agreements || []) {
    db.run(`INSERT INTO standing_agreements (user_id, backer_id, effective_from, effective_to, status, opening_cents, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [b.userId == null ? 1 : b.userId, id, a.from || '2026-01-01', a.to || null, a.status || 'active', a.openingCents || 0, '2026-01-01T00:00:00Z']);
    const aid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    for (const s of a.stakes || []) {
      db.run('INSERT INTO standing_stakes (agreement_id, format, channel, pct, valid_from, valid_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [aid, s.format, s.channel || 'any', s.pct, s.from || a.from || '2026-01-01', s.to || null, '2026-01-01T00:00:00Z']);
    }
  }
  return id;
}

/** A push subscription for a token. */
function addSub(db, token, n = 1) {
  db.run('INSERT INTO backer_push_subs (token, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?, ?)',
    [token, `https://push.example.test/${token}/${n}`, 'p256dh-test', 'auth-test']);
}

const { seedBackerDemo } = require('../../scripts/seed-backer-demo');
const { rowsOf } = require('./scratch-server');

// "Now" for the fixtures: this week's sessions are dated against it, and the digest tests pass it in.
const NOW = Date.parse('2026-10-14T12:00:00Z');
const TODAY = '2026-10-14';
const DAY = 86400000;

/** The dashboard-era world, as the live database holds it: roster records, names, events. */
function seedDashboardEra(db) {
  const tk = seedBackerDemo(db); // four backers, 43 sessions, openings 500 / 0 / 0 / -250
  const rosterOf = (token) => JSON.parse(rowsOf(db, "SELECT data FROM console_records WHERE store = 'backers'").map((r) => r.data).find((d) => JSON.parse(d).token === token));
  // Two take the weekly email.
  for (const [token, email] of [[tk.full, 'sam.okafor@example.test'], [tk.two, 'mo.chen@example.test']]) {
    const rec = rosterOf(token);
    rec.delivery = { email };
    addRoster(db, rec, { updatedAt: 2000 });
  }
  // Awkward cases the page has always had to survive.
  addRoster(db, { id: 'odd-games', token: 'OddGames1', name: 'Odd Games Backer', opening: 12.345, stakes: [
    { format: 'PLO5', pct: 12.5, channel: 'live' }, { format: 'stud8', pct: 5, channel: 'any' }, { format: '2-7', pct: 5, channel: 'any' },
    { format: 'BigO', pct: 7, channel: 'online' }, { format: 'all', pct: 1, channel: 'any' }] });
  addRoster(db, { id: 'no-name', token: 'NoNameTok1', stakes: [{ format: 'NLH', pct: 10, channel: 'any' }], opening: -1 });
  addRoster(db, { id: 'gone', token: 'GoneInDash1', name: 'Deleted In Dashboard', stakes: [{ format: 'PLO', pct: 10, channel: 'any' }], opening: 77 }, { deleted: 1 });
  db.run("INSERT INTO console_records (store, id, data, updated_at, deleted) VALUES ('backers', 'broken', '{not json', 1, 0)");
  addPublicName(db, 'GoneInDash1', 'Deleted In Dashboard');
  addEvent(db, { token: 'GoneInDash1', sessionId: 'g1', date: '2026-08-01', result: 50000, pct: 10 });
  // History only: a name row and events, no record anywhere (§7.1 kind 3).
  addPublicName(db, 'HistoryOnly1', 'History Only');
  for (let i = 1; i <= 3; i++) addEvent(db, { token: 'HistoryOnly1', sessionId: 'h' + i, date: '2026-07-0' + i, result: 10000 * i, pct: 15 });
  // A long history: the list stops at 200, the totals do not.
  addRoster(db, { id: 'long', token: 'LongHist001', name: 'Long History', stakes: [{ format: 'NLH', pct: 10, channel: 'any' }], opening: 0 });
  for (let i = 1; i <= 250; i++) addEvent(db, { token: 'LongHist001', sessionId: 'l' + i, ts: 1_700_000_000_000 + i, date: `2026-0${1 + (i % 9)}-${String(1 + (i % 27)).padStart(2, '0')}`, result: 1000 * i, pct: 10 });
  // Only a push subscription.
  addSub(db, 'SubOnly0001');
  // This week's sessions, so the weekly email has something to say.
  addEvent(db, { token: tk.full, sessionId: 'wk1', ts: NOW - DAY, date: '2026-10-13', game: '2/5 NLH', venue: 'Parx Casino', hours: 6.5, result: 84000, pct: 10, share: 8400 });
  addEvent(db, { token: tk.full, sessionId: 'wk2', ts: NOW - 2 * DAY, date: '2026-10-12', game: '5/5/10 PLO', venue: 'Bellagio', hours: 8, result: -120000, pct: 20, share: -24000 });
  addEvent(db, { token: tk.two, sessionId: 'wk3', ts: NOW - 3 * DAY, date: '2026-10-11', game: '5/10 NLH', venue: 'Wynn', hours: 5, result: 30000, pct: 10, share: 3000 });
  return tk;
}
const allTokens = (db) => {
  const set = new Set(['Unknown0Token1', 'SubOnly0001']);
  for (const r of rowsOf(db, "SELECT data FROM console_records WHERE store = 'backers'")) { try { const t = JSON.parse(r.data).token; if (t) set.add(t); } catch (_) { /* broken */ } }
  for (const r of rowsOf(db, 'SELECT DISTINCT token FROM backer_events UNION SELECT token FROM backer_public')) set.add(r.token);
  return [...set].sort();
};

/** Mirror a dashboard-era roster record into the merged tables, the way the import will (Phase 5). */
function mirror(db, rec, { status = 'active', email = null, userId = 1 } = {}) {
  return addSqlBacker(db, {
    userId, name: rec.name || 'Unnamed', token: rec.token, email, notifyEmail: !!email,
    agreements: [{ status, to: status === 'ended' ? '2026-09-30' : null, openingCents: Math.round((Number(rec.opening) || 0) * 100),
      stakes: (rec.stakes || []).map((s) => ({ format: s.format, channel: s.channel, pct: s.pct, to: status === 'ended' ? '2026-09-30' : null })) }],
  });
}
const recOf = (db, token) => { for (const r of rowsOf(db, "SELECT data FROM console_records WHERE store = 'backers'")) { try { const b = JSON.parse(r.data); if (b.token === token) return b; } catch (_) { /* broken */ } } return null; };


module.exports = { NOW, TODAY, DAY, addRoster, addEvent, addPublicName, addSqlBacker, addSub, seedDashboardEra, allTokens, mirror, recOf };
