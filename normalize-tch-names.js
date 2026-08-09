const fs = require('fs');
const path = require('path');

// Exact mapping of old event_name -> new event_name
const NAME_MAP = {
  'The First Lone Star Ring': 'NLH The First Lone Star',
  'Mini Main Ring Event - Flight A': 'NLH Mini Main - Flight A',
  'Mini Main Ring Event - Flight B': 'NLH Mini Main - Flight B',
  'Mini Main Ring Event - Flight C': 'NLH Mini Main - Flight C',
  'Mini Main Ring Event - Flight D': 'NLH Mini Main - Flight D',
  'Mini Main Ring Event - Flight E': 'NLH Mini Main - Flight E',
  'Big O Ring Event': 'Big O',
  'Ladies NLH Ring Event': 'NLH Ladies',
  'The Showdown At The Capitol NLH Ring Event': 'NLH The Showdown At The Capitol',
  'Seniors 50+ NLH Ring Event': 'NLH Seniors (50+)',
  'Big Tex High Roller Ring Event': 'NLH Big Tex High Roller',
  '8-Game Mix Ring Event': '8-Game Mix',
  'Monster Stack Ring Event - Flight A': 'NLH Monster Stack - Flight A',
  'Monster Stack Ring Event - Flight B': 'NLH Monster Stack - Flight B',
  'Monster Stack Ring Event - Flight C': 'NLH Monster Stack - Flight C',
  'H.O.R.S.E. Ring Event': 'HORSE',
  'Texas Trailblazer Ring Event': 'NLH Texas Trailblazer',
  'No Limit 2-7 Single Draw Ring Event': 'NL 2-7 Single Draw',
  'Pot Limit Omaha Ring Event': 'PLO',
  'Black Chip Bounty Turbo Ring Event': 'NLH Black Chip Bounty Turbo',
  'The Texas Stack Ring Event': 'NLH The Texas Stack',
  'Double Board Bomb Pot Ring Event': 'NLH Double Board Bomb Pot',
  'The Final Lone Star Ring Event': 'NLH The Final Lone Star',
  'WSOPC $1,700 Main Event - Flight A': 'NLH Main Event - Flight A',
  'WSOPC $1,700 Main Event - Flight B': 'NLH Main Event - Flight B',
  'WSOPC $1,700 Main Event - Flight C': 'NLH Main Event - Flight C',
  'The First Lone Star Ring Event Restart Livestream FT': 'NLH The First Lone Star - Final',
  'Mini Main Event Day 2 Restart': 'NLH Mini Main - Day 2',
  'Mini Main Event Day 3 Restart FT Livestream': 'NLH Mini Main - Final',
  'Big Tex High Roller Restart FT Livestream': 'NLH Big Tex High Roller - Final',
  'Monster Stack Ring Event Day 2 Restart': 'NLH Monster Stack - Day 2',
  'Texas Trailblazer Ring Event Restart Livestream FT': 'NLH Texas Trailblazer - Final',
  'WSOPC $1,700 Main Event Day 2 Restart': 'NLH Main Event - Day 2',
  'WSOPC $1,700 Main Event Day 3 Restart FT Stream': 'NLH Main Event - Final',
  '$600 Ring Event Milestone Satellite 1:6': 'NLH Satellite - $600 Ring Event',
  '$1,100 Texas Trailblazer Mega Satellite': 'NLH Satellite - Texas Trailblazer',
  '$1,700 Main Event Milestone Satellite 1:8': 'NLH Satellite - Main Event',
  'NLH Deepstack': 'NLH Deepstack',
};

async function main() {
  // --- 1. Update JSON file ---
  const jsonPath = path.join('D:/_snbwsop', 'tch-events.json');
  const events = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const changes = [];
  let unchanged = 0;

  for (const event of events) {
    const oldName = event.event_name;
    if (NAME_MAP.hasOwnProperty(oldName)) {
      const newName = NAME_MAP[oldName];
      if (newName !== oldName) {
        event.event_name = newName;
        changes.push({ id: event.id, eventNumber: event.event_number, oldName, newName });
      } else {
        unchanged++;
      }
    } else {
      console.warn(`WARNING: No mapping found for event_name: "${oldName}" (id=${event.id})`);
    }
  }

  fs.writeFileSync(jsonPath, JSON.stringify(events, null, 2) + '\n', 'utf8');

  console.log('\n=== JSON File Updated ===');
  console.log(`Total events: ${events.length}`);
  console.log(`Changed: ${changes.length}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log('\nChanges:');
  for (const c of changes) {
    console.log(`  [${c.eventNumber || 'no#'}] "${c.oldName}" → "${c.newName}"`);
  }

  // --- 2. Update SQLite database ---
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const dbPath = path.join('D:/_snbwsop', 'poker-tournaments.db');
  const db = new SQL.Database(fs.readFileSync(dbPath));

  let dbUpdated = 0;
  const dbChanges = [];

  for (const [oldName, newName] of Object.entries(NAME_MAP)) {
    if (oldName === newName) continue;

    const result = db.run(
      "UPDATE tournaments SET event_name = ? WHERE event_name = ? AND venue = 'Texas Card House'",
      [newName, oldName]
    );
    const rowsChanged = db.getRowsModified();
    if (rowsChanged > 0) {
      dbUpdated += rowsChanged;
      dbChanges.push({ oldName, newName, rows: rowsChanged });
    }
  }

  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  db.close();

  console.log('\n=== Database Updated ===');
  console.log(`Total rows updated: ${dbUpdated}`);
  for (const c of dbChanges) {
    console.log(`  "${c.oldName}" → "${c.newName}" (${c.rows} row${c.rows > 1 ? 's' : ''})`);
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
