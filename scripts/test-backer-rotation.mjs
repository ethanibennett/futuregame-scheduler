// rotateBackerToken, against a real SQLite database.
//
// Not a unit test with a fake db: the thing being verified is that five rows of
// somebody's financial history survive a token change, and that is a property of
// the SQL and the schema, not of a mock. So this builds the three token-keyed
// tables for real, seeds them, rotates, and counts.
//
//   node scripts/test-backer-rotation.mjs
//
// The function under test lives in server.js, which cannot be imported without
// booting the whole app, so the SQL is mirrored here. That duplication is the
// weakness of this test and is the first thing to check if it ever disagrees
// with production: the statements below must match rotateBackerToken().

import initSqlJs from 'sql.js';

const BACKER_TOKEN_RE = /^[A-Za-z0-9]{6,64}$/;

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + ' — expected ' + e + ', got ' + a); }
};
const ok = (label, cond) => eq(label, !!cond, true);

const SQL = await initSqlJs();

function freshDb() {
  const db = new SQL.Database();
  db.run(`CREATE TABLE backer_public (token TEXT PRIMARY KEY, name TEXT, updated_at INTEGER)`);
  db.run(`CREATE TABLE backer_events (
    id TEXT PRIMARY KEY, token TEXT NOT NULL, session_id TEXT NOT NULL, ts INTEGER NOT NULL,
    date TEXT, game TEXT, venue TEXT, hours REAL, session_result_cents INTEGER,
    pct REAL, share_cents INTEGER, UNIQUE (token, session_id))`);
  db.run(`CREATE TABLE backer_push_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL, keys_auth TEXT NOT NULL)`);
  return db;
}

/** Mirrors rotateBackerToken() in server.js. */
function rotateBackerToken(db, oldToken, newToken) {
  if (!BACKER_TOKEN_RE.test(String(oldToken || '')) || !BACKER_TOKEN_RE.test(String(newToken || ''))) {
    return { ok: false, error: 'invalid token shape' };
  }
  if (oldToken === newToken) return { ok: false, error: 'tokens are identical' };
  const inUse = (tok) => {
    for (const sql of [
      'SELECT 1 FROM backer_public WHERE token = ? LIMIT 1',
      'SELECT 1 FROM backer_events WHERE token = ? LIMIT 1',
      'SELECT 1 FROM backer_push_subs WHERE token = ? LIMIT 1',
    ]) {
      const r = db.exec(sql, [tok]);
      if (r.length && r[0].values.length) return true;
    }
    return false;
  };
  if (inUse(newToken)) return { ok: false, error: 'new token already carries data' };
  const counts = {};
  try {
    db.run('BEGIN');
    db.run('UPDATE backer_public SET token = ? WHERE token = ?', [newToken, oldToken]);
    counts.backer_public = db.getRowsModified();
    db.run('UPDATE backer_events SET token = ? WHERE token = ?', [newToken, oldToken]);
    counts.backer_events = db.getRowsModified();
    db.run('UPDATE backer_push_subs SET token = ? WHERE token = ?', [newToken, oldToken]);
    counts.backer_push_subs = db.getRowsModified();
    db.run('COMMIT');
  } catch (err) {
    try { db.run('ROLLBACK'); } catch (_) { /* ignore */ }
    return { ok: false, error: err.message };
  }
  return { ok: true, counts };
}

const one = (db, sql, args = []) => {
  const r = db.exec(sql, args);
  return r.length && r[0].values.length ? r[0].values[0][0] : null;
};

/** The shape of the real exposure: one backer, five sessions, one subscription. */
function seed(db, token = 'k7Qm2xR9') {
  db.run('INSERT INTO backer_public (token, name, updated_at) VALUES (?, ?, ?)', [token, 'David Mulle', 1]);
  for (let i = 1; i <= 5; i++) {
    db.run(`INSERT INTO backer_events (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents)
            VALUES (?, ?, ?, ?, ?, 'NLH', 'Bally', 4.5, ?, 50, ?)`,
      ['e' + i, token, 's' + i, 1000 + i, '2026-07-0' + i, -10000 * i, -5000 * i]);
  }
  db.run('INSERT INTO backer_push_subs (token, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?, ?)',
    [token, 'https://push.example/sub1', 'p', 'a']);
  return token;
}

console.log('the history moves with the token');
{
  const db = freshDb();
  const OLD = seed(db), NEW = 'Zx4Lm8Qt';
  const before = one(db, 'SELECT SUM(share_cents) FROM backer_events WHERE token = ?', [OLD]);
  const res = rotateBackerToken(db, OLD, NEW);
  ok('the rotation succeeds', res.ok);
  eq('and reports what it moved', res.counts, { backer_public: 1, backer_events: 5, backer_push_subs: 1 });
  eq('all five sessions are on the new token', one(db, 'SELECT COUNT(*) FROM backer_events WHERE token = ?', [NEW]), 5);
  eq('and none are left on the old one', one(db, 'SELECT COUNT(*) FROM backer_events WHERE token = ?', [OLD]), 0);
  // The figures on his page are a sum of these rows: if any moved wrong, this moves.
  eq('the cumulative figure is unchanged', one(db, 'SELECT SUM(share_cents) FROM backer_events WHERE token = ?', [NEW]), before);
  eq('the name follows', one(db, 'SELECT name FROM backer_public WHERE token = ?', [NEW]), 'David Mulle');
  eq('the old name row is gone', one(db, 'SELECT COUNT(*) FROM backer_public WHERE token = ?', [OLD]), 0);
  eq('push follows, so notifications keep working', one(db, 'SELECT COUNT(*) FROM backer_push_subs WHERE token = ?', [NEW]), 1);
  eq('the old link is dead', one(db, 'SELECT COUNT(*) FROM backer_public WHERE token = ?', [OLD]), 0);
}

console.log('a rotation that would merge two backers is refused');
{
  const db = freshDb();
  const A = seed(db, 'aaaaaa11');
  // A second backer already holding the token we are about to rotate INTO.
  db.run('INSERT INTO backer_public (token, name, updated_at) VALUES (?, ?, ?)', ['bbbbbb22', 'Someone Else', 1]);
  db.run(`INSERT INTO backer_events (id, token, session_id, ts) VALUES ('x1','bbbbbb22','s9',1)`);
  const res = rotateBackerToken(db, A, 'bbbbbb22');
  eq('refused', res.ok, false);
  ok('and says why', /already carries data/.test(res.error || ''));
  // Nothing moved: the refusal happens before any write.
  eq("the first backer's history is untouched", one(db, 'SELECT COUNT(*) FROM backer_events WHERE token = ?', [A]), 5);
  eq("the second backer's is too", one(db, 'SELECT COUNT(*) FROM backer_events WHERE token = ?', ['bbbbbb22']), 1);
}

console.log('the guards');
{
  const db = freshDb();
  const OLD = seed(db);
  eq('identical tokens', rotateBackerToken(db, OLD, OLD).ok, false);
  eq('a token that is too short', rotateBackerToken(db, OLD, 'abc').ok, false);
  eq('a token with punctuation', rotateBackerToken(db, OLD, 'abc-def!').ok, false);
  eq('an empty new token', rotateBackerToken(db, OLD, '').ok, false);
  eq('an empty old token', rotateBackerToken(db, '', 'Zx4Lm8Qt').ok, false);
  eq('null', rotateBackerToken(db, null, null).ok, false);
  eq('every refusal left the history alone', one(db, 'SELECT COUNT(*) FROM backer_events WHERE token = ?', [OLD]), 5);
}

console.log('rotating a backer who has no data yet');
{
  const db = freshDb();
  // A backer created but never notified: no rows anywhere. Rotation is a no-op
  // that must still SUCCEED, or the roster sync would log a false failure every
  // hour for every new backer.
  const res = rotateBackerToken(db, 'ccccc111', 'ddddd222');
  ok('succeeds', res.ok);
  eq('having moved nothing', res.counts, { backer_public: 0, backer_events: 0, backer_push_subs: 0 });
}

console.log('rotating twice, the way a second leak would go');
{
  const db = freshDb();
  const T1 = seed(db), T2 = 'Zx4Lm8Qt', T3 = 'Pp9Rr3Kk';
  ok('first rotation', rotateBackerToken(db, T1, T2).ok);
  ok('second rotation', rotateBackerToken(db, T2, T3).ok);
  eq('the history is still five sessions', one(db, 'SELECT COUNT(*) FROM backer_events WHERE token = ?', [T3]), 5);
  eq('and neither old token resolves',
     one(db, 'SELECT COUNT(*) FROM backer_events WHERE token IN (?, ?)', [T1, T2]), 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
