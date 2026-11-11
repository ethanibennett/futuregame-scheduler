// Undo start and the single-update delete (App improvements 112): a delete that matches nothing is a 404,
// ?all=1 removes every update of that event for the player, and buddies hear "cleared" only when nothing of
// that event is left. Boots server.js on a scratch DB (ports 4740-4749).
const assert = require('assert');
const { createScratch, boot } = require('./helpers/scratch-server');

(async () => {
  const scratch = await createScratch({ ports: [4740, 4749], prefix: 'fg-lu-undo-' });
  // A fresh database misses live_updates' later columns (their migration runs before the table is created);
  // add them as production has them.
  { const db = scratch.open(); db.run('CREATE TABLE IF NOT EXISTS live_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, tournament_id INTEGER NOT NULL, update_text TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)'); for (const c of ["stack INTEGER", "sb INTEGER", "bb INTEGER", "bb_ante INTEGER", "is_itm INTEGER DEFAULT 0", "total_entries INTEGER", "is_bagged INTEGER DEFAULT 0", "bag_day INTEGER", "locked_amount INTEGER", "is_final_table INTEGER DEFAULT 0", "places_left INTEGER", "first_place_prize INTEGER", "is_reg_closed INTEGER DEFAULT 0", "bubble INTEGER", "is_busted INTEGER DEFAULT 0", "is_deal INTEGER DEFAULT 0", "deal_place INTEGER", "deal_payout INTEGER", "play_started_at DATETIME"]) { try { db.run('ALTER TABLE live_updates ADD COLUMN ' + c); } catch (_) { /* there */ } } scratch.save(db); }
  const srv = await boot(scratch.dbPath, {}, { ports: [4740, 4749] });
  const base = `http://127.0.0.1:${srv.port}`;
  let pass = 0, fail = 0;
  const t = async (name, fn) => { try { await fn(); pass += 1; console.log('  ok   ' + name); } catch (e) { fail += 1; console.log('  FAIL ' + name + '\n       ' + e.message); } };
  const call = async (method, p, body, token) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  try {
    await call('POST', '/api/register', { username: 'undoer', email: 'undo@x.test', password: 'undo-password-1', realName: 'Un Doer' });
    const { json: login } = await call('POST', '/api/login', { email: 'undo@x.test', password: 'undo-password-1' });
    const tok = login.token;
    const { json: list } = await call('GET', '/api/tournaments', null, tok);
    const tid = (Array.isArray(list) ? list : []).find((x) => x.venue !== 'Personal').id;
    await call('POST', '/api/schedule', { tournamentId: tid }, tok);
    for (const stack of [30000, 41000, 47500]) await call('POST', '/api/live-update', { tournamentId: tid, stack }, tok);
    const active = async () => (await call('GET', '/api/live-updates/active', null, tok)).json.filter((u) => u.tournament_id === tid);

    await t('a delete that matches nothing is a 404, not "Update removed"', async () => {
      const r = await call('DELETE', '/api/live-update/987654', null, tok);
      assert.strictEqual(r.status, 404);
    });
    await t('a single delete removes the latest only, and says one is left', async () => {
      const [u] = await active();
      assert.strictEqual(Number(u.stack), 47500);
      const r = await call('DELETE', `/api/live-update/${u.id}`, null, tok);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.left, 1);
      const [v] = await active();
      assert.strictEqual(Number(v.stack), 41000);
    });
    await t('Undo start (?all=1) removes every update of the event', async () => {
      const [u] = await active();
      const r = await call('DELETE', `/api/live-update/${u.id}?all=1`, null, tok);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.left, 0);
      assert.strictEqual((await active()).length, 0);
    });
  } finally {
    await srv.stop();
    scratch.cleanup();
  }
  console.log(`\nlive-update-undo.test.js - ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
