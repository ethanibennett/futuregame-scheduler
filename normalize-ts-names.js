const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, 'poker-tournaments.db');
  const db = new SQL.Database(fs.readFileSync(dbPath));

  // Get all TS events
  const stmt = db.prepare("SELECT id, event_number, event_name FROM tournaments WHERE venue = 'Turning Stone Casino'");
  const events = [];
  while (stmt.step()) events.push(stmt.getAsObject());
  stmt.free();

  function clean(name) {
    let n = name;
    // Remove (Re-Entry), (1 Re-Entry per Flight)
    n = n.replace(/\s*\((?:\d+ )?Re-Entry(?:\s+per Flight)?\)\s*/gi, ' ');
    // Remove (X day event - Official Ring Event) various formats
    n = n.replace(/\s*\(\d+\s*day\s*event\s*-?\s*Official Ring Event\)\s*/gi, '');
    // Remove guarantee amounts: $50K Guarantee, $500K Guarantee, $1M GTD, etc.
    n = n.replace(/\s*\$[\d,.]+[KMB]?\s*(?:Guarantee|Guaranteed|GTD)\s*/gi, ' ');
    // Remove 'Play to 9'
    n = n.replace(/\s*Play to 9\s*/gi, ' ');
    // Clean "Limited to age XX+" -> "(XX+)"
    n = n.replace(/\s*\(Limited to age (\d+\+)\)\s*/gi, ' ($1)');
    // Remove standalone "Re-entry" or "Re-Entry" at end
    n = n.replace(/\s+Re-[Ee]ntry\s*$/i, '');
    // Replace 'No Limit Hold'em' / "No Limit Hold'em" with NLH
    n = n.replace(/No Limit Hold.?em/gi, 'NLH');
    // Replace 'Pot Limit Omaha' with PLO
    n = n.replace(/Pot Limit Omaha/gi, 'PLO');
    // Reorder: move variant prefix to front
    n = n.replace(/^30K Opener NLH/, 'NLH 30K Opener');
    n = n.replace(/^Mini Main NLH/, 'NLH Mini Main');
    n = n.replace(/^Seniors NLH/, 'NLH Seniors');
    n = n.replace(/^Black Chip Bounty NLH/, 'NLH Black Chip Bounty');
    n = n.replace(/^Six Max NLH/, 'NLH 6-Max');
    n = n.replace(/^Monster Stack NLH/, 'NLH Monster Stack');
    n = n.replace(/^Main Event\.?\s*NLH/, 'NLH Main Event');
    n = n.replace(/^Ladies NLH/, 'NLH Ladies');
    n = n.replace(/^Turbo NLH/, 'NLH Turbo');
    n = n.replace(/^Double Stack NLH/, 'NLH Double Stack');
    n = n.replace(/^Tag Team NLH/, 'NLH Tag Team');
    n = n.replace(/^40\/40\/40 NLH/, 'NLH 40/40/40');
    // Remove leftover $200/$200
    n = n.replace(/\s*\$\d+\/\$\d+\s*/g, ' ');
    // Landmark Mega
    n = n.replace(/Landmark Mega NLH Pays \$\d+/, 'NLH Landmark Mega Satellite');
    // NLH / PLO standalone
    n = n.replace(/^NLH \/ PLO\s*$/, 'NLH / PLO');
    // If just "NLH" with flight letter, add flight
    // Clean double spaces and trim
    n = n.replace(/\s+/g, ' ').trim();
    return n;
  }

  let updated = 0;
  for (const e of events) {
    const newName = clean(e.event_name);
    if (newName !== e.event_name) {
      db.run('UPDATE tournaments SET event_name = ? WHERE id = ?', [newName, e.id]);
      console.log((e.event_number || '  -').padEnd(6), '|', e.event_name.substring(0, 55).padEnd(55), '=>', newName);
      updated++;
    }
  }
  console.log('\nUpdated:', updated, 'events');

  // Mark Landmark Mega as satellites
  db.run("UPDATE tournaments SET is_satellite = 1 WHERE event_name LIKE '%Landmark Mega%' AND venue = 'Turning Stone Casino'");
  const satR = db.exec('SELECT changes()');
  console.log('Marked as satellite:', satR[0].values[0][0]);

  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  console.log('Saved');

  // Final verify
  console.log('\n=== Final names ===');
  const r2 = db.prepare("SELECT event_number, event_name FROM tournaments WHERE venue = 'Turning Stone Casino' ORDER BY id");
  while (r2.step()) {
    const row = r2.getAsObject();
    console.log((row.event_number || '  -').padEnd(6), '|', row.event_name);
  }
  r2.free();
})();
