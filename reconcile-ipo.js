/**
 * reconcile-ipo.js
 *
 * Fetches the full IPO 2026 schedule from the Irish Poker Open API,
 * compares it against the local poker-tournaments.db, and inserts
 * missing events or updates changed ones.
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ── helpers ──────────────────────────────────────────────────────────

/** Fetch JSON over HTTPS, return a promise. */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

/** Convert ISO date string to { date, time } in DB format.
 *  "2026-03-26T12:00:00" → { date: "March 26, 2026", time: "12:00 PM" }
 */
function convertDateTime(isoStr) {
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  // Parse manually to avoid timezone issues
  const [datePart, timePart] = isoStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);

  const monthName = months[month - 1];
  const dayNum = day; // no leading zero

  // 12-hour format
  let h12 = hour % 12;
  if (h12 === 0) h12 = 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  const minStr = minute.toString().padStart(2, '0');

  return {
    date: `${monthName} ${dayNum}, ${year}`,
    time: `${h12}:${minStr} ${ampm}`
  };
}

/** Parse buy-in string like "€485 + €515 + €150" → { buyin, rake_dollars }
 *  2-part: €215+€35  → buyin=250, rake=35
 *  3-part (bounty): €485+€515+€150 → buyin=1150, rake=150
 */
function parseBuyIn(buyInStr) {
  if (!buyInStr || buyInStr === '-') return { buyin: 0, rake_dollars: 0 };
  const parts = buyInStr.split('+').map(s => {
    const m = s.match(/[\d,]+/);
    return m ? parseInt(m[0].replace(/,/g, ''), 10) : 0;
  });
  const buyin = parts.reduce((a, b) => a + b, 0);
  // rake is always the last part
  const rake_dollars = parts.length >= 2 ? parts[parts.length - 1] : 0;
  return { buyin, rake_dollars };
}

/** Detect game variant from event title. */
function detectVariant(title) {
  const t = title || '';
  if (/PLO\s*5\s*Card/i.test(t)) return 'PLO';
  if (/PLO\s*4\/5\/6/i.test(t)) return 'PLO';
  if (/Sviten/i.test(t)) return 'Sviten Special';
  if (/8-Game/i.test(t)) return '8-Game Mix';
  if (/HORSE/i.test(t)) return 'HORSE';
  if (/Big\s*O/i.test(t)) return 'Big O';
  if (/Triple\s*Draw|Deuce.to.Seven/i.test(t)) return 'NL 2-7 Triple Draw';
  if (/OFC/i.test(t)) return 'OFC Pineapple';
  if (/Triathlon/i.test(t)) return 'Mixed';
  if (/PLO|Omaha/i.test(t)) return 'PLO';
  // These should come after variant checks above
  if (/Heads.Up/i.test(t)) return 'NLH';
  if (/Flip\s*(and|&|n)\s*Go/i.test(t)) return 'NLH';
  if (/Spin/i.test(t)) return 'NLH';
  return 'NLH';
}

/** Detect if event is a satellite from title. */
function isSatellite(title) {
  return /Satellite/i.test(title || '') ? 1 : 0;
}

/** Detect if event is a restart (Day 2+, Final, Round 2+). */
function isRestart(apiEvent) {
  if (apiEvent.day && apiEvent.day > 1) return 1;
  const t = apiEvent.title || '';
  if (/\bFinal\b/i.test(t)) return 1;
  if (/\bDay\s*[2-9]\b/i.test(t)) return 1;
  if (/\bRound\s*[2-9]\b/i.test(t)) return 1;
  return 0;
}

/** Build event_number string from API number. */
function buildEventNumber(num) {
  return `IPO-${num}`;
}

/** Extract flight letter from the API event (if present). */
function getFlight(apiEvent) {
  return apiEvent.flight || null;
}

// ── main ─────────────────────────────────────────────────────────────

(async () => {
  console.log('Fetching IPO 2026 schedule from API...');
  const response = await fetchJSON(
    'https://irishpokeropen.com/wp-json/api/v2/kholdem/yearly-schedule?year=2026'
  );
  const apiEvents = response.result;
  console.log(`Fetched ${apiEvents.length} events from API.`);

  // Load database
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, 'poker-tournaments.db');
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const venue = 'Irish Poker Open';
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  // Build a lookup of existing IPO events for fast matching
  // Key: event_number + '|' + date + '|' + flight (or 'null')
  const existingStmt = db.prepare(
    `SELECT id, event_number, event_name, date, time, buyin, starting_chips,
            level_duration, late_reg_end, is_restart, is_satellite,
            rake_dollars, rake_pct, game_variant
     FROM tournaments WHERE venue = ?`
  );
  existingStmt.bind([venue]);

  const existingMap = new Map(); // key → row object
  while (existingStmt.step()) {
    const row = existingStmt.getAsObject();
    // Try to extract flight from event_name (e.g. "Day 1/I" → flight "I")
    let flight = null;
    const flightMatch = row.event_name.match(/Day\s*1\s*\/\s*([A-Z])/i);
    if (flightMatch) flight = flightMatch[1].toUpperCase();
    // Also check for flight-like patterns like "Queens Flight", "Kings Flight" etc.
    // For Final Day events or Day 2+, flight is null

    const key = `${row.event_number}|${row.date}|${flight || 'null'}`;
    // If there are duplicates in existing data (which there are), keep the first
    if (!existingMap.has(key)) {
      existingMap.set(key, row);
    }
  }
  existingStmt.free();
  console.log(`Found ${existingMap.size} existing IPO events in DB (deduplicated by key).`);

  // Prepare statements
  const insertStmt = db.prepare(
    `INSERT INTO tournaments (
      event_number, event_name, date, time, buyin, starting_chips,
      level_duration, late_reg_end, game_variant, venue, is_restart,
      is_satellite, rake_dollars, rake_pct, reentry, source_pdf
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const updateStmt = db.prepare(
    `UPDATE tournaments SET
      event_name = ?, buyin = ?, starting_chips = ?,
      level_duration = ?, late_reg_end = ?, is_restart = ?,
      is_satellite = ?, rake_dollars = ?, rake_pct = ?,
      game_variant = ?
    WHERE id = ?`
  );

  const allProcessed = []; // for JSON export

  for (const apiEv of apiEvents) {
    const eventNumber = buildEventNumber(apiEv.number);
    const { date, time } = convertDateTime(apiEv.date);
    const { buyin, rake_dollars } = parseBuyIn(apiEv.buyIn);
    const chips = apiEv.chips || null;
    const levelDuration = apiEv.levelDuration || null;
    const lateRegEnd = (apiEv.registration && apiEv.registration !== '-')
      ? apiEv.registration : null;
    const variant = detectVariant(apiEv.title);
    const restart = isRestart(apiEv);
    const satellite = isSatellite(apiEv.title);
    const rake_pct = buyin > 0 ? Math.round(rake_dollars / buyin * 100) : 0;
    const eventName = apiEv.title;
    const flight = getFlight(apiEv);

    // Detect re-entry type from title
    let reentry = null;
    if (/Unlimited Re.?Entry/i.test(apiEv.title)) reentry = 'Unlimited Re-Entry';
    else if (/Single Re.?Entry/i.test(apiEv.title)) reentry = 'Single Re-Entry';
    else if (/Re.?Entry/i.test(apiEv.title)) reentry = 'Re-Entry';

    // Build match key
    const matchKey = `${eventNumber}|${date}|${flight || 'null'}`;

    const record = {
      event_number: eventNumber,
      event_name: eventName,
      date,
      time,
      buyin,
      starting_chips: chips,
      level_duration: levelDuration,
      late_reg_end: lateRegEnd,
      game_variant: variant,
      venue,
      is_restart: restart,
      is_satellite: satellite,
      rake_dollars,
      rake_pct,
      reentry,
      flight: flight || null,
      api_id: apiEv.id
    };

    allProcessed.push(record);

    const existing = existingMap.get(matchKey);

    if (!existing) {
      // INSERT
      insertStmt.run([
        eventNumber, eventName, date, time, buyin, chips,
        levelDuration, lateRegEnd, variant, venue, restart,
        satellite, rake_dollars, rake_pct, reentry,
        'IPO 2026 API'
      ]);
      inserted++;
    } else {
      // Check if anything changed
      const changed =
        existing.event_name !== eventName ||
        existing.buyin !== buyin ||
        existing.starting_chips !== chips ||
        existing.level_duration !== levelDuration ||
        existing.late_reg_end !== lateRegEnd ||
        existing.is_restart !== restart ||
        existing.is_satellite !== satellite ||
        existing.rake_dollars !== rake_dollars ||
        existing.rake_pct !== rake_pct ||
        existing.game_variant !== variant;

      if (changed) {
        updateStmt.run([
          eventName, buyin, chips,
          levelDuration, lateRegEnd, restart,
          satellite, rake_dollars, rake_pct,
          variant, existing.id
        ]);
        updated++;
      } else {
        unchanged++;
      }
    }
  }

  insertStmt.free();
  updateStmt.free();

  // Save database
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log('Database saved.');

  // Export to JSON
  const jsonPath = path.join(__dirname, 'ipo-events.json');
  fs.writeFileSync(jsonPath, JSON.stringify(allProcessed, null, 2));
  console.log(`Exported ${allProcessed.length} events to ipo-events.json`);

  // Summary
  console.log('\n=== RECONCILIATION SUMMARY ===');
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Total API events: ${apiEvents.length}`);

  // Verify final count
  const countResult = db.exec(
    `SELECT COUNT(*) FROM tournaments WHERE venue = 'Irish Poker Open'`
  );
  console.log(`  Total IPO events in DB: ${countResult[0].values[0][0]}`);

  const totalResult = db.exec('SELECT COUNT(*) FROM tournaments');
  console.log(`  Total tournaments in DB: ${totalResult[0].values[0][0]}`);

  db.close();
})();
