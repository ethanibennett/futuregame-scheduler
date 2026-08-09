require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { PDFParse } = require('pdf-parse');
const initSqlJs = require('sql.js');
const { parseWSOP2025Schedule, getWSOPRake } = require('./parsers/wsop-parser');
const { parseGenericSchedule, detectFormat } = require('./parsers/generic-parser');
const nodemailer = require('nodemailer');
const sampleTournaments = require('./sample-data');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Secrets ──────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required.');
  process.exit(1);
}

// ── Security middleware ──────────────────────────────────────

// Helmet — security headers (CSP disabled: single-file React app with Babel standalone
// requires unsafe-inline + unsafe-eval + script-src-attr which defeats CSP purpose)
app.use(helmet({
  contentSecurityPolicy: false,
}));

// CORS — restrict to known origins
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3001', 'http://localhost:3000'];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, same-origin)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow but log — tighten later if needed
      console.log(`CORS: request from unlisted origin ${origin}`);
    }
  },
  credentials: true,
}));

// Rate limiters for sensitive endpoints (applied per-route below)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts.' },
});

// ── Email transporter (password resets) ──────────────────────
let mailTransporter = null;
if (process.env.SMTP_HOST) {
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log('Mail transporter configured');
} else {
  console.warn('SMTP not configured — password reset emails will be logged to console');
}

async function sendResetEmail(toEmail, resetToken) {
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const resetLink = `${appUrl}/#reset?token=${resetToken}`;
  const subject = 'Password Reset - futuregame';
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Password Reset</h2>
      <p>You requested a password reset for your futuregame account.</p>
      <p><a href="${resetLink}" style="display:inline-block;padding:12px 24px;background:#555;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p>
      <p style="color:#888;font-size:0.85em;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    </div>
  `;

  if (mailTransporter) {
    await mailTransporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: toEmail,
      subject,
      html,
    });
  } else {
    console.log(`[DEV] Password reset link for ${toEmail}: ${resetLink}`);
  }
}

app.use(express.json());

// Health check for zero-downtime deploys
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Serve frontend — static assets can cache, but HTML must not
app.use(express.static(path.join(__dirname, 'public'), {
  index: false, // Don't auto-serve index.html — we handle it explicitly below
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Surrogate-Control', 'no-store');
    }
  }
}));

// Serve index.html with injected build version to bust any cache
const BUILD_VERSION = Date.now().toString();
function serveIndex(req, res) {
  const fs = require('fs');
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  html = html.replace('</head>', `<meta name="build-version" content="${BUILD_VERSION}">\n</head>`);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('ETag', BUILD_VERSION);
  res.type('html').send(html);
}
app.get('/', serveIndex);

// File upload configuration
const upload = multer({ dest: 'uploads/' });

// Database initialization
let db;
let SQL;
const DB_PATH = process.env.DB_PATH || 'poker-tournaments.db';

// ── Re-entry normalization ──
function normalizeReentry(val) {
  if (!val) return val;
  const v = val.trim();
  const lower = v.toLowerCase();
  if (lower === 'n/a' || lower === 'none' || lower === 'freezeout') return 'Freezeout';
  if (lower === 'unlimited re-entry' || lower === 'unlimited re entry'
      || lower === 'unlimited reentry' || lower === 'unlimited') return 'Unlimited';
  if (lower === 'single re-entry' || lower === 'single re entry'
      || lower === 'single reentry' || lower === 're-entry'
      || lower === 'reentry' || lower === '1 re-entry') return '1';
  // Already normalized: "1", "2", "1 Per Flight", "2 Per Flight", "Bust A Play B", etc.
  return v;
}

// ── Event name normalization (WSOP format) ──
// gameVariant is optional — when provided, ensures name starts with the variant abbreviation
function normalizeEventName(name, gameVariant) {
  if (!name) return name;
  let n = name;

  // Strip venue/series prefixes (venue is already a separate column)
  const prefixes = [
    'Aria Poker Classic ', 'Golden Nugget Grand ',
    'MGM Grand Poker Championship ', 'Orleans Open ',
    'Resorts World Summer Series ', 'South Point Summer Poker ',
    'Wynn Summer Classic ',
  ];
  for (const p of prefixes) {
    if (n.startsWith(p)) { n = n.slice(p.length); break; }
  }

  // Normalize "PLO/NLH" → "NLH/PLO"
  n = n.replace(/\bPLO\/NLH\b/g, 'NLH/PLO');

  // Strip ALL re-entry policies (dash optional — catches "Single Re-Entry" anywhere)
  n = n.replace(/\s*[-–]?\s*(Single|Unlimited)\s+Re[\s-]?Entr(y|ies)\s*(per Flight)?\s*/gi, ' ');

  // Strip GTD amounts (€ or $)
  n = n.replace(/\s*[-–]\s*[€$][\d,]+\s*(GTD|Guaranteed)\s*/gi, ' ');
  n = n.replace(/\s*[€$][\d,]+\s*(GTD|Guaranteed)\s*/gi, ' ');

  // Strip "Milestone 50K/100K" noise
  n = n.replace(/\s*[-–]\s*Milestone\s+\d+K\s*/gi, ' ');

  // Strip "N Seats GTD" / "N Seats Gtd"
  n = n.replace(/\s*[-–]\s*\d+\s+Seats?\s+GTD?\s*/gi, ' ');

  // Strip "(Capped N)" annotations
  n = n.replace(/\s*\(Capped\s+\d+\)\s*/gi, ' ');

  // Strip "(Open to all Players)" and similar parenthetical notes
  n = n.replace(/\s*\(Open to all Players\)\s*/gi, ' ');

  // Convert "Day 1/A" → "Flight A" (IPO format → WSOP format)
  n = n.replace(/Day\s*1\s*\/\s*([A-Z])/gi, (_, letter) => `Flight ${letter.toUpperCase()}`);

  // Normalize "Final Day" → "Final"
  n = n.replace(/\bFinal Day\b/gi, 'Final');

  // Convert "8-Handed" → "8-Max", "6-Handed" → "6-Max"
  n = n.replace(/(\d)-Handed\b/gi, '$1-Max');

  // Normalize age qualifiers: "(50 Years Young)" → "(50+)", "(60 Years Young)" → "(60+)"
  n = n.replace(/\((\d+)\s+Years?\s+Young\)/gi, '($1+)');

  // Normalize "Deuce-to-Seven Triple Draw" → "2-7 Triple Draw"
  n = n.replace(/Deuce-to-Seven Triple Draw/gi, '2-7 Triple Draw');

  // Clean satellite target format: "Satellite to #14 €3,000 ..." → "Satellite - ..."
  n = n.replace(/Satellite to\s+#\d+\s*[€$][\d,]+\s*/gi, 'Satellite - ');
  n = n.replace(/Satellite to\s+#\d+\s+/gi, 'Satellite - ');
  n = n.replace(/Satellite to\s+/gi, 'Satellite - ');

  // Fix inconsistent dash styles (en-dash → hyphen-minus)
  n = n.replace(/\s*–\s*/g, ' – ');

  // Collapse multiple spaces and trim
  n = n.replace(/\s{2,}/g, ' ').trim();

  // Clean trailing/leading dashes
  n = n.replace(/\s*[-–]\s*$/, '').replace(/^\s*[-–]\s*/, '');

  // Clean "- -" artifacts
  n = n.replace(/\s*[-–]\s+[-–]\s*/g, ' - ');

  // Ensure " - " before Flight/Day/Final/Round suffixes (WSOP format)
  n = n.replace(/([^\s-])\s+(Flight\s+[A-Z])/g, '$1 - $2');
  n = n.replace(/([^\s-])\s+(Day\s+\d)/g, '$1 - $2');
  n = n.replace(/([^\s-])\s+(Final)\s*$/g, '$1 - $2');
  n = n.replace(/([^\s-])\s+(Round\s+\d)/g, '$1 - $2');

  // Prepend variant abbreviation if name doesn't already start with a known one
  if (gameVariant) {
    const VARIANT_MAP = {
      'NLH': 'NLH', 'PLO': 'PLO', 'PLO8': 'PLO8', 'O8': 'O8',
      'HORSE': 'HORSE', 'Mixed': 'Mixed', 'Big O': 'Big O',
      'Razz': 'Razz', 'Badugi': 'Badugi', 'Stud8': 'Stud8',
      '7-Card Stud': '7-Card Stud', 'Limit Hold\'em': 'Limit Hold\'em',
      'NL 2-7 Single Draw': 'NL 2-7 Single Draw',
      'NL 2-7 Triple Draw': '2-7 Triple Draw',
      'OFC Pineapple': 'OFC Pineapple', 'Sviten Special': 'Sviten Special',
      'TORSE': 'TORSE', 'Dealer\'s Choice': 'Dealer\'s Choice',
    };
    const abbrev = VARIANT_MAP[gameVariant] || gameVariant;
    const KNOWN_STARTS = [
      'NLH', 'PLO8', 'PLO', 'O8', 'HORSE', 'Mixed', 'Big O', 'Razz',
      'Badugi', 'Stud8', '7-Card', 'Limit', 'NL 2-7', '2-7', 'OFC',
      'Sviten', 'TORSE', 'Dealer', '5-Card', '8-Game', '9-Game',
      'Pick Your', 'Daily Deepstack', 'WSOP',
    ];
    const startsWithKnown = KNOWN_STARTS.some(s => n.startsWith(s));
    if (!startsWithKnown) {
      // Before prepending, strip redundant variant from middle of name
      // e.g. "Cuatro NLH High Roller" → prepend NLH → "NLH Cuatro High Roller"
      const variantWord = abbrev.split(' ')[0]; // "NLH", "PLO", etc.
      n = n.replace(new RegExp('\\b' + variantWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b\\s*', 'g'), '');
      n = abbrev + ' ' + n.trim();
    }
  }

  // Deduplicate variant in name: "NLH Cuatro NLH High Roller" → "NLH Cuatro High Roller"
  // "PLO Irish Open PLO Deaf" → "PLO Irish Open Deaf"
  const DEDUP_VARIANTS = ['NLH', 'PLO8', 'PLO', 'O8'];
  for (const v of DEDUP_VARIANTS) {
    const re = new RegExp('^(' + v + '\\b.+?)\\b' + v + '\\b\\s*', 'i');
    if (re.test(n)) {
      n = n.replace(re, '$1');
    }
  }

  // Strip "PLO HR" step/landmark satellite noise with redundant variant
  // "PLO High Roller PLO/NL Landmark Satellite" → "PLO High Roller Landmark Satellite"
  n = n.replace(/(\bHigh Roller)\s+(?:PLO|NLH|NL)\/(?:PLO|NLH|NL)\s+/g, '$1 ');

  // Final cleanup
  n = n.replace(/\s{2,}/g, ' ').trim();

  return n;
}

async function initDatabase() {
  SQL = await initSqlJs();

  // Try to load existing database
  try {
    const filebuffer = await fs.readFile(DB_PATH);
    db = new SQL.Database(filebuffer);
    console.log(`Loaded database from ${DB_PATH}`);
  } catch (err) {
    // Create new database
    db = new SQL.Database();
    console.log(`Created new database (will save to ${DB_PATH})`);
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_number TEXT,
      event_name TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      buyin INTEGER NOT NULL,
      starting_chips INTEGER,
      level_duration TEXT,
      reentry TEXT,
      late_reg TEXT,
      late_reg_end TEXT,
      game_variant TEXT NOT NULL,
      venue TEXT NOT NULL,
      notes TEXT,
      category TEXT,
      is_satellite INTEGER DEFAULT 0,
      target_event TEXT,
      is_restart INTEGER DEFAULT 0,
      parent_event TEXT,
      day_length TEXT,
      structure_sheet_path TEXT,
      source_pdf TEXT,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tournament_id INTEGER NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
      UNIQUE(user_id, tournament_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS schedule_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      viewer_id INTEGER NOT NULL,
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (viewer_id) REFERENCES users(id),
      UNIQUE(owner_id, viewer_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS share_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME,
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id),
      UNIQUE(from_user_id, to_user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS share_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS schedule_conditions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tournament_id INTEGER NOT NULL,
      depends_on_tournament_id INTEGER,
      condition_type TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1,
      profit_threshold INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
      FOREIGN KEY (depends_on_tournament_id) REFERENCES tournaments(id),
      UNIQUE(user_id, tournament_id)
    )
  `);

  // Migrate: add profit_threshold column if missing (existing DBs)
  try {
    db.run('ALTER TABLE schedule_conditions ADD COLUMN profit_threshold INTEGER');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add total_entries column for POY points calculation
  try {
    db.run('ALTER TABLE tournaments ADD COLUMN total_entries INTEGER');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add conditions JSON column for multi-condition support
  try {
    db.run('ALTER TABLE schedule_conditions ADD COLUMN conditions TEXT');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate legacy single-condition rows to JSON conditions column
  try {
    const migStmt = db.prepare('SELECT id, condition_type, depends_on_tournament_id, profit_threshold FROM schedule_conditions WHERE conditions IS NULL AND condition_type IS NOT NULL');
    const legacyRows = [];
    while (migStmt.step()) legacyRows.push(migStmt.getAsObject());
    migStmt.free();
    for (const row of legacyRows) {
      const cond = { type: row.condition_type };
      if (row.depends_on_tournament_id) cond.dependsOnId = row.depends_on_tournament_id;
      if (row.profit_threshold) cond.profitThreshold = row.profit_threshold;
      db.run('UPDATE schedule_conditions SET conditions = ? WHERE id = ?', [JSON.stringify([cond]), row.id]);
    }
    if (legacyRows.length > 0) {
      await saveDatabase();
      console.log(`Migrated ${legacyRows.length} legacy condition rows to JSON format`);
    }
  } catch (e) {
    // ignore migration errors
  }

  // Migrate: add is_anchor column for must-play events
  try {
    db.run('ALTER TABLE user_schedules ADD COLUMN is_anchor INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add planned_entries column for max entries per event
  try {
    db.run('ALTER TABLE user_schedules ADD COLUMN planned_entries INTEGER DEFAULT 1');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add rake breakdown columns for tournament cost analysis
  const rakeColumns = [
    ['prize_pool', 'INTEGER'],
    ['house_fee', 'INTEGER'],
    ['opt_add_on', 'INTEGER'],
    ['rake_pct', 'REAL'],
    ['rake_dollars', 'INTEGER']
  ];
  for (const [col, type] of rakeColumns) {
    try {
      db.run(`ALTER TABLE tournaments ADD COLUMN ${col} ${type}`);
    } catch (e) {
      // Column already exists — ignore
    }
  }

  // Backfill rake data for existing WSOP events that are missing it
  try {
    const backfillStmt = db.prepare(
      `SELECT id, event_number, buyin FROM tournaments
       WHERE buyin > 0 AND rake_pct IS NULL
       AND (venue LIKE '%WSOP%' OR venue LIKE '%Horseshoe%' OR venue LIKE '%Paris Las Vegas%')`
    );
    let backfillCount = 0;
    while (backfillStmt.step()) {
      const row = backfillStmt.getAsObject();
      const rake = getWSOPRake(row.buyin, row.event_number);
      if (rake.rakePct !== null) {
        db.run(
          `UPDATE tournaments SET prize_pool = ?, house_fee = ?, opt_add_on = ?,
           rake_pct = ?, rake_dollars = ? WHERE id = ?`,
          [rake.prizePool, rake.houseFee, rake.optAddOn, rake.rakePct, rake.rakeDollars, row.id]
        );
        backfillCount++;
      }
    }
    backfillStmt.free();
    if (backfillCount > 0) {
      console.log(`Backfilled rake data for ${backfillCount} WSOP events`);
    }
  } catch (e) {
    console.log('Rake backfill skipped:', e.message);
  }

  // Migrate: add is_deepstack column
  try {
    db.run('ALTER TABLE tournaments ADD COLUMN is_deepstack INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add satellite/restart/category columns for filtering
  const tourneyMigCols = [
    ['is_satellite', 'INTEGER DEFAULT 0'],
    ['target_event', 'TEXT'],
    ['is_restart', 'INTEGER DEFAULT 0'],
    ['parent_event', 'TEXT'],
    ['category', 'TEXT'],
    ['late_reg_end', 'TEXT']
  ];
  for (const [col, type] of tourneyMigCols) {
    try {
      db.run(`ALTER TABLE tournaments ADD COLUMN ${col} ${type}`);
      console.log(`Added column tournaments.${col}`);
    } catch (e) {
      // Column already exists — ignore
    }
  }

  // Migrate: add last_seen_shares to users
  try {
    db.run('ALTER TABLE users ADD COLUMN last_seen_shares DATETIME');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add avatar to users
  try {
    db.run('ALTER TABLE users ADD COLUMN avatar TEXT');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: add real_name to users
  try {
    db.run('ALTER TABLE users ADD COLUMN real_name TEXT');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate: move schedule_permissions into share_requests
  try {
    const migChk = db.prepare("SELECT COUNT(*) as cnt FROM share_requests");
    migChk.step();
    const { cnt: srCount } = migChk.getAsObject();
    migChk.free();
    if (srCount === 0) {
      const oldPerms = db.prepare("SELECT owner_id, viewer_id, granted_at FROM schedule_permissions");
      let migrated = 0;
      while (oldPerms.step()) {
        const { owner_id, viewer_id, granted_at } = oldPerms.getAsObject();
        db.run(
          "INSERT OR IGNORE INTO share_requests (from_user_id, to_user_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)",
          [owner_id, viewer_id, granted_at, granted_at]
        );
        migrated++;
      }
      oldPerms.free();
      if (migrated > 0) {
        console.log(`Migrated ${migrated} old permissions to share_requests`);
        await saveDatabase();
      }
    }
  } catch (e) {
    console.log('Permission migration skipped:', e.message);
  }

  // Cleanup: remove pending share requests from users with email-like usernames
  try {
    const cleaned = db.run(
      `DELETE FROM share_requests WHERE status = 'pending'
       AND from_user_id IN (SELECT id FROM users WHERE username LIKE '%@%')`
    );
    const chkClean = db.prepare("SELECT changes() AS cnt");
    chkClean.step();
    const { cnt: cleanCount } = chkClean.getAsObject();
    chkClean.free();
    if (cleanCount > 0) {
      console.log(`Cleaned ${cleanCount} pending requests from email-username accounts`);
      await saveDatabase();
    }
  } catch (e) {
    console.log('Cleanup skipped:', e.message);
  }

  // Auto-seed extra venue data from JSON seed files
  const seedFiles = [
    { file: 'deepstack-events.json', label: 'deepstacks', check: "is_deepstack = 1" },
    { file: 'ipo-events.json', label: 'Irish Poker Open', check: "venue = 'Irish Poker Open'" },
    { file: 'turning-stone-events.json', label: 'Turning Stone', check: "venue = 'Turning Stone Casino'" },
    { file: 'tch-events.json', label: 'Texas Card House', check: "venue = 'Texas Card House'" },
  ];
  for (const seed of seedFiles) {
    try {
      const chk = db.prepare(`SELECT COUNT(*) as cnt FROM tournaments WHERE ${seed.check}`);
      chk.step();
      const { cnt } = chk.getAsObject();
      chk.free();
      if (cnt === 0) {
        const seedPath = path.join(__dirname, seed.file);
        if (require('fs').existsSync(seedPath)) {
          const rows = JSON.parse(require('fs').readFileSync(seedPath, 'utf8'));
          for (const t of rows) {
            db.run(
              `INSERT INTO tournaments (event_number, event_name, date, time, buyin,
               starting_chips, level_duration, reentry, late_reg, late_reg_end,
               game_variant, venue, notes, category, is_satellite, target_event,
               is_restart, parent_event, prize_pool, house_fee, opt_add_on,
               rake_pct, rake_dollars, source_pdf, is_deepstack)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                t.event_number || '', t.event_name, t.date, t.time, t.buyin,
                t.starting_chips, t.level_duration, t.reentry,
                t.late_reg, t.late_reg_end, t.game_variant, t.venue,
                t.notes, t.category, t.is_satellite || 0, t.target_event,
                t.is_restart || 0, t.parent_event, t.prize_pool, t.house_fee,
                t.opt_add_on, t.rake_pct, t.rake_dollars, t.source_pdf,
                t.is_deepstack || 0
              ]
            );
          }
          console.log(`Seeded ${rows.length} ${seed.label} events`);
          await saveDatabase();
        }
      }
    } catch (e) {
      console.log(`${seed.label} seeding skipped:`, e.message);
    }
  }

  // ── Data migrations (for updating existing persistent-disk DBs) ──
  db.run(`CREATE TABLE IF NOT EXISTS _applied_migrations (
    name TEXT PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const dataMigrations = [
    {
      name: 'ipo-rake-2026-02',
      fn: () => {
        // Update IPO events with rake data from the updated seed file
        const seedPath = path.join(__dirname, 'ipo-events.json');
        if (!require('fs').existsSync(seedPath)) return;
        const rows = JSON.parse(require('fs').readFileSync(seedPath, 'utf8'));
        for (const t of rows) {
          // Update rake + fixes by event_number
          db.run(
            `UPDATE tournaments SET
              rake_pct = ?, rake_dollars = ?, house_fee = ?, prize_pool = ?,
              event_name = ?, buyin = ?, time = ?
            WHERE venue = 'Irish Poker Open' AND event_number = ?`,
            [t.rake_pct, t.rake_dollars, t.house_fee, t.prize_pool,
             t.event_name, t.buyin, t.time, t.event_number]
          );
        }
        // Insert any new IPO events not in DB yet (e.g. Mini Irish Open Day 1/I, Select Invitational)
        for (const t of rows) {
          const chk = db.prepare(`SELECT COUNT(*) as cnt FROM tournaments WHERE venue = 'Irish Poker Open' AND event_number = ?`);
          chk.bind([t.event_number]);
          chk.step();
          const { cnt } = chk.getAsObject();
          chk.free();
          if (cnt === 0) {
            db.run(
              `INSERT INTO tournaments (event_number, event_name, date, time, buyin,
               starting_chips, level_duration, reentry, late_reg, late_reg_end,
               game_variant, venue, notes, category, is_satellite, target_event,
               is_restart, parent_event, prize_pool, house_fee, opt_add_on,
               rake_pct, rake_dollars, source_pdf, is_deepstack)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [t.event_number || '', t.event_name, t.date, t.time, t.buyin,
               t.starting_chips, t.level_duration, t.reentry, t.late_reg, t.late_reg_end,
               t.game_variant, t.venue, t.notes, t.category, t.is_satellite || 0, t.target_event,
               t.is_restart || 0, t.parent_event, t.prize_pool, t.house_fee, t.opt_add_on,
               t.rake_pct, t.rake_dollars, t.source_pdf, t.is_deepstack || 0]
            );
          }
        }
        console.log(`Applied IPO rake data to ${rows.length} events`);
      }
    },
    {
      name: 'ipo-cleanup-finals-2026-02',
      fn: () => {
        // Delete duplicate IPO entries (same event_number + date + time)
        const dupStmt = db.prepare(
          `SELECT event_number, date, time, MIN(id) as keep_id, GROUP_CONCAT(id) as all_ids
           FROM tournaments WHERE venue = 'Irish Poker Open'
           GROUP BY event_number, date, time HAVING COUNT(*) > 1`
        );
        let deletedDups = 0;
        while (dupStmt.step()) {
          const d = dupStmt.getAsObject();
          const ids = d.all_ids.split(',').map(Number).filter(id => id !== d.keep_id);
          for (const id of ids) {
            db.run('DELETE FROM tournaments WHERE id = ?', [id]);
            deletedDups++;
          }
        }
        dupStmt.free();

        // Mark "Final Day" / "Final Round" / "Final" events as restarts
        db.run(
          `UPDATE tournaments SET is_restart = 1, parent_event = event_number
           WHERE venue = 'Irish Poker Open'
           AND (event_name LIKE '%- Final Day' OR event_name LIKE '%- Final Round'
                OR event_name LIKE '%- Final' OR event_name LIKE '%- Final day')`
        );

        console.log(`IPO cleanup: deleted ${deletedDups} duplicates, marked finals as restarts`);
      }
    },
    {
      name: 'ipo-full-reconcile-2026-02',
      fn: () => {
        // Full reconciliation from IPO API data — inserts missing events, updates existing
        const seedPath = path.join(__dirname, 'ipo-events.json');
        if (!require('fs').existsSync(seedPath)) return;
        const rows = JSON.parse(require('fs').readFileSync(seedPath, 'utf8'));

        // Build lookup of existing IPO events keyed by event_number + date
        const existingStmt = db.prepare(
          `SELECT id, event_number, event_name, date, time, buyin, starting_chips,
                  level_duration, late_reg_end, is_restart, is_satellite,
                  rake_dollars, rake_pct, game_variant, reentry
           FROM tournaments WHERE venue = 'Irish Poker Open'`
        );
        const existingMap = new Map();
        while (existingStmt.step()) {
          const row = existingStmt.getAsObject();
          const key = `${row.event_number}|${row.date}`;
          // For multi-flight same-day events, append flight from name
          let flight = null;
          const fm = row.event_name.match(/Day\s*1\s*\/\s*([A-Z])/i);
          if (fm) flight = fm[1].toUpperCase();
          const fullKey = flight ? `${key}|${flight}` : key;
          if (!existingMap.has(fullKey)) existingMap.set(fullKey, row);
        }
        existingStmt.free();

        let inserted = 0, updated = 0;

        for (const t of rows) {
          // Build match key
          let flight = t.flight || null;
          if (!flight) {
            const fm = (t.event_name || '').match(/Day\s*1\s*\/\s*([A-Z])/i);
            if (fm) flight = fm[1].toUpperCase();
          }
          const key = flight
            ? `${t.event_number}|${t.date}|${flight}`
            : `${t.event_number}|${t.date}`;

          const existing = existingMap.get(key);

          if (existing) {
            // Update
            db.run(
              `UPDATE tournaments SET
                event_name = ?, buyin = ?, starting_chips = ?,
                level_duration = ?, late_reg_end = ?, is_restart = ?,
                is_satellite = ?, rake_dollars = ?, rake_pct = ?,
                game_variant = ?, reentry = ?
              WHERE id = ?`,
              [t.event_name, t.buyin, t.starting_chips,
               t.level_duration, t.late_reg_end, t.is_restart || 0,
               t.is_satellite || 0, t.rake_dollars, t.rake_pct,
               t.game_variant, t.reentry || null, existing.id]
            );
            updated++;
          } else {
            // Insert
            db.run(
              `INSERT INTO tournaments (event_number, event_name, date, time, buyin,
               starting_chips, level_duration, reentry, late_reg_end,
               game_variant, venue, is_satellite, is_restart,
               rake_pct, rake_dollars, source_pdf)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [t.event_number, t.event_name, t.date, t.time, t.buyin,
               t.starting_chips, t.level_duration, t.reentry || null,
               t.late_reg_end, t.game_variant, 'Irish Poker Open',
               t.is_satellite || 0, t.is_restart || 0,
               t.rake_pct, t.rake_dollars, 'IPO 2026 API']
            );
            inserted++;
          }
        }
        console.log(`IPO full reconcile: inserted ${inserted}, updated ${updated} events`);
      }
    },
    {
      name: 'ipo-dedup-stale-2026-02',
      fn: () => {
        // Delete old "Final Day/Final" entries that overlap with proper API entries
        const oldFinals = db.prepare(
          `SELECT id, event_number, date FROM tournaments
           WHERE venue = 'Irish Poker Open'
           AND (event_name LIKE '%Final Day%' OR event_name LIKE '%- Final')
           AND late_reg_end IS NULL`
        );
        let deletedFinals = 0;
        const finalsToDelete = [];
        while (oldFinals.step()) {
          const r = oldFinals.getAsObject();
          const chk = db.prepare(
            `SELECT COUNT(*) as cnt FROM tournaments
             WHERE venue = 'Irish Poker Open' AND event_number = ? AND date = ? AND id != ?
             AND event_name NOT LIKE '%Final Day%' AND event_name NOT LIKE '%- Final'`
          );
          chk.bind([r.event_number, r.date, r.id]);
          chk.step();
          if (chk.getAsObject().cnt > 0) finalsToDelete.push(r.id);
          chk.free();
        }
        oldFinals.free();
        for (const id of finalsToDelete) {
          db.run('DELETE FROM tournaments WHERE id = ?', [id]);
          deletedFinals++;
        }

        // Delete old "Guaranteed" entries with NULL late_reg_end duplicated by API entries
        const oldGuaranteed = db.prepare(
          `SELECT id, event_number, date FROM tournaments
           WHERE venue = 'Irish Poker Open'
           AND event_name LIKE '%Guaranteed%'
           AND late_reg_end IS NULL`
        );
        let deletedOld = 0;
        const oldToDelete = [];
        while (oldGuaranteed.step()) {
          const r = oldGuaranteed.getAsObject();
          const chk = db.prepare(
            `SELECT COUNT(*) as cnt FROM tournaments
             WHERE venue = 'Irish Poker Open' AND event_number = ? AND date = ? AND id != ?
             AND late_reg_end IS NOT NULL`
          );
          chk.bind([r.event_number, r.date, r.id]);
          chk.step();
          if (chk.getAsObject().cnt > 0) oldToDelete.push(r.id);
          chk.free();
        }
        oldGuaranteed.free();
        for (const id of oldToDelete) {
          db.run('DELETE FROM tournaments WHERE id = ?', [id]);
          deletedOld++;
        }

        // Delete exact duplicate entries (same event_number + date + time + event_name)
        const dups = db.prepare(
          `SELECT MIN(id) as keep_id, GROUP_CONCAT(id) as all_ids
           FROM tournaments WHERE venue = 'Irish Poker Open'
           GROUP BY event_number, date, time, event_name HAVING COUNT(*) > 1`
        );
        let deletedDups = 0;
        while (dups.step()) {
          const r = dups.getAsObject();
          const ids = r.all_ids.split(',').map(Number).filter(id => id !== r.keep_id);
          for (const id of ids) {
            db.run('DELETE FROM tournaments WHERE id = ?', [id]);
            deletedDups++;
          }
        }
        dups.free();

        console.log(`IPO dedup: deleted ${deletedFinals} stale finals, ${deletedOld} old Guaranteed, ${deletedDups} exact dups`);
      }
    },
    {
      name: 'tch-normalize-names-2026-02',
      fn: () => {
        const nameMap = {
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
        };
        let updated = 0;
        for (const [oldName, newName] of Object.entries(nameMap)) {
          const result = db.run(
            `UPDATE tournaments SET event_name = ? WHERE event_name = ? AND venue = 'Texas Card House'`,
            [newName, oldName]
          );
          updated += db.getRowsModified();
        }
        console.log(`TCH name normalization: ${updated} rows updated`);
      }
    },
    {
      name: 'normalize-all-event-names-2026-02',
      fn: () => {
        const stmt = db.prepare('SELECT id, event_name FROM tournaments');
        const updates = [];
        while (stmt.step()) {
          const { id, event_name } = stmt.getAsObject();
          const normalized = normalizeEventName(event_name);
          if (normalized !== event_name) {
            updates.push([normalized, id]);
          }
        }
        stmt.free();
        for (const [name, id] of updates) {
          db.run('UPDATE tournaments SET event_name = ? WHERE id = ?', [name, id]);
        }
        console.log(`Event name normalization: ${updates.length} rows updated`);
      }
    },
    {
      name: 'normalize-variant-prefix-2026-02',
      fn: () => {
        const stmt = db.prepare('SELECT id, event_name, game_variant FROM tournaments WHERE venue != \'Personal\'');
        const updates = [];
        while (stmt.step()) {
          const { id, event_name, game_variant } = stmt.getAsObject();
          const normalized = normalizeEventName(event_name, game_variant);
          if (normalized !== event_name) {
            updates.push([normalized, id]);
          }
        }
        stmt.free();
        for (const [name, id] of updates) {
          db.run('UPDATE tournaments SET event_name = ? WHERE id = ?', [name, id]);
        }
        console.log(`Variant prefix normalization: ${updates.length} rows updated`);
      }
    },
    {
      name: 'normalize-dedup-variant-v2-2026-02',
      fn: () => {
        const stmt = db.prepare('SELECT id, event_name, game_variant FROM tournaments WHERE venue != \'Personal\'');
        const updates = [];
        while (stmt.step()) {
          const { id, event_name, game_variant } = stmt.getAsObject();
          const normalized = normalizeEventName(event_name, game_variant);
          if (normalized !== event_name) {
            updates.push([normalized, id]);
          }
        }
        stmt.free();
        for (const [name, id] of updates) {
          db.run('UPDATE tournaments SET event_name = ? WHERE id = ?', [name, id]);
        }
        console.log(`Variant dedup normalization: ${updates.length} rows updated`);
      }
    },
    {
      name: 'normalize-reentry-2026-02',
      fn: () => {
        const stmt = db.prepare('SELECT id, reentry FROM tournaments WHERE reentry IS NOT NULL');
        let updated = 0;
        const updates = [];
        while (stmt.step()) {
          const { id, reentry } = stmt.getAsObject();
          const normalized = normalizeReentry(reentry);
          if (normalized !== reentry) {
            updates.push([normalized, id]);
          }
        }
        stmt.free();
        for (const [val, id] of updates) {
          db.run('UPDATE tournaments SET reentry = ? WHERE id = ?', [val, id]);
        }
        console.log(`Reentry normalization: ${updates.length} rows updated`);
      }
    },
    {
      name: 'normalize-handed-to-max-2026-02',
      fn: () => {
        db.run("UPDATE tournaments SET event_name = REPLACE(event_name, '-Handed', '-Max') WHERE event_name LIKE '%-Handed%'");
        const updated = db.getRowsModified();
        console.log(`Handed→Max normalization: ${updated} rows updated`);
      }
    },
    {
      name: 'live-updates-structured-fields-2026-02',
      fn: () => {
        db.run('ALTER TABLE live_updates ADD COLUMN stack INTEGER');
        db.run('ALTER TABLE live_updates ADD COLUMN sb INTEGER');
        db.run('ALTER TABLE live_updates ADD COLUMN bb INTEGER');
        db.run('ALTER TABLE live_updates ADD COLUMN bb_ante INTEGER');
        db.run('ALTER TABLE live_updates ADD COLUMN is_itm INTEGER DEFAULT 0');
        db.run('ALTER TABLE live_updates ADD COLUMN total_entries INTEGER');
        db.run('ALTER TABLE live_updates ADD COLUMN is_bagged INTEGER DEFAULT 0');
        db.run('ALTER TABLE live_updates ADD COLUMN bag_day INTEGER');
        console.log('Added structured fields to live_updates table');
      }
    },
    {
      name: 'live-updates-itm-ft-fields-2026-02',
      fn: () => {
        db.run('ALTER TABLE live_updates ADD COLUMN locked_amount INTEGER');
        db.run('ALTER TABLE live_updates ADD COLUMN is_final_table INTEGER DEFAULT 0');
        db.run('ALTER TABLE live_updates ADD COLUMN places_left INTEGER');
        db.run('ALTER TABLE live_updates ADD COLUMN first_place_prize INTEGER');
        console.log('Added ITM locked/FT fields to live_updates table');
      }
    },
    {
      name: 'live-updates-busted-deal-bubble-2026-02',
      fn: () => {
        db.run('ALTER TABLE live_updates ADD COLUMN is_reg_closed INTEGER DEFAULT 0');
        db.run('ALTER TABLE live_updates ADD COLUMN bubble INTEGER');
        db.run('ALTER TABLE live_updates ADD COLUMN is_busted INTEGER DEFAULT 0');
        db.run('ALTER TABLE live_updates ADD COLUMN is_deal INTEGER DEFAULT 0');
        db.run('ALTER TABLE live_updates ADD COLUMN deal_place INTEGER');
        db.run('ALTER TABLE live_updates ADD COLUMN deal_payout INTEGER');
        console.log('Added busted/deal/bubble/reg_closed fields to live_updates table');
      }
    },
    {
      name: 'flag-side-events-global-2026-02',
      fn: () => {
        // Flag all events with no event_number (that aren't already sats/restarts) as side events
        db.run(`UPDATE tournaments SET is_deepstack = 1
                WHERE (event_number = '' OR event_number IS NULL)
                AND is_satellite = 0 AND is_restart = 0 AND is_deepstack = 0`);
        const updated = db.getRowsModified();
        console.log(`Side events flagged globally: ${updated} rows updated`);
      }
    },
    {
      name: 'staking-system-tables-2026-02',
      fn: () => {
        // ── Staking Series ──
        db.run(`CREATE TABLE IF NOT EXISTS staking_series (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          venue TEXT,
          start_date TEXT,
          end_date TEXT,
          currency TEXT NOT NULL DEFAULT 'USD',
          currency_conversion_method TEXT NOT NULL DEFAULT 'at_cash',
          status TEXT NOT NULL DEFAULT 'pre',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        // ── Backers ──
        db.run(`CREATE TABLE IF NOT EXISTS backers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          notes TEXT,
          app_user_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (app_user_id) REFERENCES users(id)
        )`);

        // ── Backer Agreements ──
        db.run(`CREATE TABLE IF NOT EXISTS backer_agreements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          series_id INTEGER NOT NULL,
          backer_id INTEGER NOT NULL,
          backer_type TEXT NOT NULL,
          percentage REAL NOT NULL DEFAULT 0,
          markup REAL NOT NULL DEFAULT 1.0,
          swap_user_id INTEGER,
          swap_my_pct REAL,
          swap_their_pct REAL,
          crossbook_user_id INTEGER,
          crossbook_my_pct REAL,
          crossbook_their_pct REAL,
          budget_cap INTEGER,
          makeup_balance REAL DEFAULT 0,
          tiered_rules TEXT,
          buyin_range_min INTEGER,
          buyin_range_max INTEGER,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (series_id) REFERENCES staking_series(id),
          FOREIGN KEY (backer_id) REFERENCES backers(id),
          FOREIGN KEY (swap_user_id) REFERENCES users(id),
          FOREIGN KEY (crossbook_user_id) REFERENCES users(id)
        )`);

        // ── Backer Event Overrides ──
        db.run(`CREATE TABLE IF NOT EXISTS backer_event_overrides (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agreement_id INTEGER NOT NULL,
          tournament_id INTEGER NOT NULL,
          override_percentage REAL,
          override_markup REAL,
          opt_out INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          FOREIGN KEY (agreement_id) REFERENCES backer_agreements(id),
          FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
          UNIQUE(agreement_id, tournament_id)
        )`);

        // ── Backer Event Status ──
        db.run(`CREATE TABLE IF NOT EXISTS backer_event_status (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agreement_id INTEGER NOT NULL,
          tournament_id INTEGER NOT NULL,
          bullets_used INTEGER NOT NULL DEFAULT 1,
          buyin_amount INTEGER,
          cash_amount INTEGER,
          proof_image TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          tip_amount INTEGER DEFAULT 0,
          currency_rate REAL DEFAULT 1.0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (agreement_id) REFERENCES backer_agreements(id),
          FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
        )`);

        // ── Backer Settlements ──
        db.run(`CREATE TABLE IF NOT EXISTS backer_settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          series_id INTEGER NOT NULL,
          backer_id INTEGER NOT NULL,
          gross_investment REAL NOT NULL DEFAULT 0,
          gross_return REAL NOT NULL DEFAULT 0,
          markup_amount REAL NOT NULL DEFAULT 0,
          net_pnl REAL NOT NULL DEFAULT 0,
          amount_owed REAL NOT NULL DEFAULT 0,
          is_paid INTEGER NOT NULL DEFAULT 0,
          paid_at DATETIME,
          notes TEXT,
          FOREIGN KEY (series_id) REFERENCES staking_series(id),
          FOREIGN KEY (backer_id) REFERENCES backers(id)
        )`);

        // ── Backer Tokens ──
        db.run(`CREATE TABLE IF NOT EXISTS backer_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agreement_id INTEGER NOT NULL,
          token TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (agreement_id) REFERENCES backer_agreements(id)
        )`);

        console.log('Created all staking system tables');
      }
    },
    {
      name: 'live-updates-play-time-2026-02',
      fn: () => {
        db.run('ALTER TABLE live_updates ADD COLUMN play_started_at DATETIME');
        console.log('Added play_started_at column to live_updates table');
      }
    },
    {
      name: 'groups-tables-2026-03',
      fn: () => {
        db.run(`CREATE TABLE IF NOT EXISTS groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          created_by INTEGER NOT NULL,
          avatar TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS group_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (group_id) REFERENCES groups(id),
          FOREIGN KEY (user_id) REFERENCES users(id),
          UNIQUE(group_id, user_id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS group_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          message TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (group_id) REFERENCES groups(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        console.log('Created groups, group_members, group_messages tables');
      }
    },
    {
      name: 'group-invites-2026-03',
      fn: () => {
        db.run(`CREATE TABLE IF NOT EXISTS group_invites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL,
          invited_by INTEGER NOT NULL,
          invited_user_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          responded_at DATETIME,
          FOREIGN KEY (group_id) REFERENCES groups(id),
          FOREIGN KEY (invited_by) REFERENCES users(id),
          FOREIGN KEY (invited_user_id) REFERENCES users(id),
          UNIQUE(group_id, invited_user_id)
        )`);

        // Add last_seen_notifications column to users
        try {
          db.run('ALTER TABLE users ADD COLUMN last_seen_notifications DATETIME');
        } catch (e) {
          // Column may already exist
        }

        console.log('Created group_invites table, added last_seen_notifications column');
      }
    },
    {
      name: 'group-leaderboard-2026-03',
      fn: () => {
        try {
          db.run('ALTER TABLE groups ADD COLUMN leaderboard_enabled INTEGER NOT NULL DEFAULT 0');
        } catch (e) {
          // Column may already exist
        }
        console.log('Added leaderboard_enabled column to groups');
      }
    },
    {
      name: 'staking-agreement-enhancements-2026-03',
      fn: () => {
        const cols = [
          ['start_date', 'TEXT'],
          ['end_date', 'TEXT'],
          ['variant_filter', 'TEXT'],
          ['scope', "TEXT DEFAULT 'series'"],
          ['buyin_min', 'INTEGER'],
          ['buyin_max', 'INTEGER'],
        ];
        for (const [col, type] of cols) {
          try { db.run(`ALTER TABLE backer_agreements ADD COLUMN ${col} ${type}`); } catch(e) {}
        }
        console.log('Added scope/date/variant/buyin columns to backer_agreements');
      }
    },
    {
      name: 'staking-sell-params-2026-03',
      fn: () => {
        db.run(`CREATE TABLE IF NOT EXISTS staking_sell_params (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          param_type TEXT NOT NULL,
          param_key TEXT NOT NULL,
          sell_pct REAL NOT NULL DEFAULT 50,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          UNIQUE(user_id, param_type, param_key)
        )`);
        console.log('Created staking_sell_params table');
      }
    },
    {
      name: 'staking-markup-settings-2026-03',
      fn: () => {
        db.run(`CREATE TABLE IF NOT EXISTS staking_markup_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          setting_type TEXT NOT NULL,
          setting_key TEXT NOT NULL,
          markup REAL NOT NULL DEFAULT 1.0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          UNIQUE(user_id, setting_type, setting_key)
        )`);
        console.log('Created staking_markup_settings table');
      }
    },
    {
      name: 'backfill-satellite-restart-flags-2026-03',
      fn: () => {
        // Flag satellites by name keywords
        const satResult = db.run(
          `UPDATE tournaments SET is_satellite = 1
           WHERE is_satellite = 0
           AND (event_name LIKE '%Satellite%' OR event_name LIKE '%Super Sat%'
                OR event_name LIKE '%Mega Sat%' OR event_name LIKE '%Qualifier%')`
        );
        const satCount = db.getRowsModified();

        // Flag restarts (Day 2+, Final Table, etc.)
        const rstResult = db.run(
          `UPDATE tournaments SET is_restart = 1
           WHERE is_restart = 0
           AND (event_name LIKE '%Day 2%' OR event_name LIKE '%Day 3%'
                OR event_name LIKE '%Day 4%' OR event_name LIKE '%Day 5%'
                OR event_name LIKE '%Final Table%' OR event_name LIKE '%RESTART%')`
        );
        const rstCount = db.getRowsModified();

        console.log(`Backfill: flagged ${satCount} satellites, ${rstCount} restarts`);
      }
    },
    {
      name: 'tch-reentry-unlimited-2026-03',
      fn: () => {
        db.run(
          `UPDATE tournaments SET reentry = 'Unlimited' WHERE venue = 'Texas Card House' AND (reentry IS NULL OR reentry = '')`
        );
        const updated = db.getRowsModified();
        console.log(`TCH re-entry: set ${updated} events to Unlimited`);
      }
    },
  ];

  for (const mig of dataMigrations) {
    try {
      const chk = db.prepare('SELECT COUNT(*) as cnt FROM _applied_migrations WHERE name = ?');
      chk.bind([mig.name]);
      chk.step();
      const { cnt } = chk.getAsObject();
      chk.free();
      if (cnt === 0) {
        mig.fn();
        db.run('INSERT INTO _applied_migrations (name) VALUES (?)', [mig.name]);
        await saveDatabase();
        console.log(`Migration "${mig.name}" applied`);
      }
    } catch (e) {
      console.log(`Migration "${mig.name}" failed:`, e.message);
    }
  }

  // ── MTT feed sync (mtt-series-watcher) ──
  // The MTT series watcher (D:\projects\mtt-series-watcher) emits pre-normalized snake_case seed
  // files + a manifest into ./mtt-feed/. Unlike seedFiles (idempotent per-venue) this runs EVERY
  // startup and UPSERTS by (venue, event_number), so re-emitted schedules update existing rows and
  // add new events. Rows are already normalized (event_name/reentry/game_variant), so the JSON-seed
  // path's lack of normalizeEventName()/normalizeReentry() is fine.
  try {
    const manifestPath = path.join(__dirname, 'mtt-feed', 'manifest.json');
    if (require('fs').existsSync(manifestPath)) {
      const manifest = JSON.parse(require('fs').readFileSync(manifestPath, 'utf8'));
      let upserts = 0, inserts = 0, pruned = 0;
      // Prune feed-managed rows (source_pdf='mtt-feed') for series no longer in the manifest — i.e.
      // series that ended or dropped out of the watcher's forward window. Keeps snbwsop in sync with
      // the feed (add/update/remove) without touching non-feed tournaments.
      const manifestVenues = new Set(manifest.map(e => e.venue));
      const distinctFeed = db.exec("SELECT DISTINCT venue FROM tournaments WHERE source_pdf = 'mtt-feed'");
      if (distinctFeed.length) {
        for (const row of distinctFeed[0].values) {
          const v = row[0];
          if (!manifestVenues.has(v)) {
            db.run("DELETE FROM tournaments WHERE source_pdf = 'mtt-feed' AND venue = ?", [v]);
            pruned += db.getRowsModified();
          }
        }
      }
      for (const entry of manifest) {
        const filePath = path.join(__dirname, 'mtt-feed', entry.file);
        if (!require('fs').existsSync(filePath)) continue;
        const rows = JSON.parse(require('fs').readFileSync(filePath, 'utf8'));
        for (const t of rows) {
          db.run(
            `UPDATE tournaments SET
               event_name = ?, date = ?, time = ?, buyin = ?, starting_chips = ?,
               level_duration = ?, reentry = ?, late_reg = ?, late_reg_end = ?, game_variant = ?,
               notes = ?, category = ?, is_satellite = ?, is_restart = ?, prize_pool = ?,
               house_fee = ?, opt_add_on = ?, rake_pct = ?, rake_dollars = ?, is_deepstack = ?,
               source_pdf = ?
             WHERE venue = ? AND event_number = ?`,
            [t.event_name, t.date, t.time, t.buyin, t.starting_chips,
             t.level_duration, t.reentry, t.late_reg, t.late_reg_end, t.game_variant,
             t.notes, t.category, t.is_satellite || 0, t.is_restart || 0, t.prize_pool,
             t.house_fee, t.opt_add_on, t.rake_pct, t.rake_dollars, t.is_deepstack || 0,
             t.source_pdf || 'mtt-feed',
             t.venue, t.event_number]
          );
          if (db.getRowsModified() > 0) { upserts++; continue; }
          db.run(
            `INSERT INTO tournaments (event_number, event_name, date, time, buyin,
             starting_chips, level_duration, reentry, late_reg, late_reg_end,
             game_variant, venue, notes, category, is_satellite, target_event,
             is_restart, parent_event, prize_pool, house_fee, opt_add_on,
             rake_pct, rake_dollars, source_pdf, is_deepstack)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t.event_number || '', t.event_name, t.date, t.time, t.buyin,
             t.starting_chips, t.level_duration, t.reentry, t.late_reg, t.late_reg_end,
             t.game_variant, t.venue, t.notes, t.category, t.is_satellite || 0, t.target_event,
             t.is_restart || 0, t.parent_event, t.prize_pool, t.house_fee, t.opt_add_on,
             t.rake_pct, t.rake_dollars, t.source_pdf, t.is_deepstack || 0]
          );
          inserts++;
        }
      }
      if (upserts + inserts + pruned > 0) {
        await saveDatabase();
        console.log(`MTT feed sync: ${inserts} inserted, ${upserts} updated, ${pruned} pruned from ${manifest.length} file(s)`);
      }
    }
  } catch (e) {
    console.log('MTT feed sync skipped:', e.message);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS tracking_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tournament_id INTEGER NOT NULL,
      num_entries INTEGER NOT NULL DEFAULT 1,
      cashed INTEGER NOT NULL DEFAULT 0,
      finish_place INTEGER,
      cash_amount INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
      UNIQUE(user_id, tournament_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS live_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tournament_id INTEGER NOT NULL,
      update_text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
    )
  `);

  // ── Saved Hands (Hand Replayer) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS saved_hands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      hand_data TEXT NOT NULL,
      game_type TEXT NOT NULL,
      title TEXT,
      notes TEXT,
      is_public INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // ── Saved Hands (Hand Replayer) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS saved_hands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      hand_data TEXT NOT NULL,
      game_type TEXT NOT NULL,
      title TEXT,
      notes TEXT,
      is_public INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Auto-seed WSOP 2026 schedule if tournaments table is empty
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM tournaments');
  countStmt.step();
  const { count } = countStmt.getAsObject();
  countStmt.free();

  if (count === 0) {
    console.log(`Seeding ${sampleTournaments.length} WSOP 2026 tournaments...`);
    for (const t of sampleTournaments) {
      db.run(
        `INSERT INTO tournaments (
          event_number, event_name, date, time, buyin,
          starting_chips, level_duration, reentry, late_reg, late_reg_end,
          game_variant, venue, notes, category, is_satellite, target_event,
          is_restart, parent_event, prize_pool, house_fee, opt_add_on,
          rake_pct, rake_dollars, source_pdf
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.eventNumber, normalizeEventName(t.eventName, t.gameVariant), t.date, t.time, t.buyin,
          t.startingChips || null, t.levelDuration || null,
          normalizeReentry(t.reentry) || null, t.lateReg || null, t.lateRegEnd || null,
          t.gameVariant, t.venue, t.notes || null,
          t.category || null, t.isSatellite ? 1 : 0, t.targetEvent || null,
          t.isRestart ? 1 : 0, t.parentEvent || null,
          t.prizePool || null, t.houseFee || null, t.optAddOn || null,
          t.rakePct || null, t.rakeDollars || null,
          'WSOP 2026 Official Schedule'
        ]
      );
    }
    await saveDatabase();
    console.log('WSOP 2026 schedule seeded successfully');
  }

  console.log('Database initialized');
}

// Save database to file
async function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  await fs.writeFile(DB_PATH, buffer);
}

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

function requireRegistered(req, res, next) {
  if (req.user && req.user.isGuest) {
    return res.status(403).json({ error: 'Sign up to use this feature' });
  }
  next();
}

// ── SSE: real-time buddy updates ─────────────────────────────
// Map<userId: number, Set<http.ServerResponse>>
const sseClients = new Map();

function getBuddyIds(userId) {
  const stmt = db.prepare(`
    SELECT CASE WHEN sr.from_user_id = ? THEN sr.to_user_id ELSE sr.from_user_id END AS buddy_id
    FROM share_requests sr
    WHERE sr.status = 'accepted'
      AND (sr.from_user_id = ? OR sr.to_user_id = ?)
  `);
  stmt.bind([userId, userId, userId]);
  const ids = [];
  while (stmt.step()) ids.push(stmt.getAsObject().buddy_id);
  stmt.free();
  return ids;
}

function broadcastToBuddies(userId, eventType, payload) {
  const buddyIds = getBuddyIds(userId);
  const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const buddyId of buddyIds) {
    const clients = sseClients.get(buddyId);
    if (clients) {
      for (const res of clients) {
        res.write(message);
      }
    }
  }
}

function getGroupMemberIds(groupId) {
  const stmt = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?');
  stmt.bind([groupId]);
  const ids = [];
  while (stmt.step()) ids.push(stmt.getAsObject().user_id);
  stmt.free();
  return ids;
}

function getUserGroupIds(userId) {
  const stmt = db.prepare('SELECT group_id FROM group_members WHERE user_id = ?');
  stmt.bind([userId]);
  const ids = [];
  while (stmt.step()) ids.push(stmt.getAsObject().group_id);
  stmt.free();
  return ids;
}

function broadcastToGroup(groupId, eventType, payload, excludeUserId) {
  const memberIds = getGroupMemberIds(groupId);
  const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const memberId of memberIds) {
    if (excludeUserId && memberId === excludeUserId) continue;
    const clients = sseClients.get(memberId);
    if (clients) {
      for (const res of clients) {
        res.write(message);
      }
    }
  }
}

app.get('/api/events', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'Token required' });

  let user;
  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  if (!sseClients.has(user.id)) sseClients.set(user.id, new Set());
  sseClients.get(user.id).add(res);

  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const set = sseClients.get(user.id);
    if (set) {
      set.delete(res);
      if (set.size === 0) sseClients.delete(user.id);
    }
  });
});

// API Routes

// User registration
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password, realName } = req.body;

    // Validate real name
    if (!realName || realName.trim().length < 1 || realName.trim().length > 40) {
      return res.status(400).json({ error: 'Full name is required (max 40 characters)' });
    }

    // Validate username
    if (!username || username.length < 2 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 2–20 characters' });
    }
    if (/@/.test(username)) {
      return res.status(400).json({ error: 'Username cannot be an email address' });
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, hyphens, and dots' });
    }

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    // Validate password
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    db.run(
      'INSERT INTO users (username, email, password, real_name) VALUES (?, ?, ?, ?)',
      [username, email, hashedPassword, realName.trim()]
    );

    await saveDatabase();

    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username or email already taken' });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// User login
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    stmt.bind([email]);

    let user = null;
    while (stmt.step()) {
      user = stmt.getAsObject();
    }
    stmt.free();

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
      expiresIn: '24h'
    });

    res.json({ token, username: user.username, userId: user.id, avatar: user.avatar || null, realName: user.real_name || null });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Guest login — browse-only access, no account required
app.post('/api/guest-login', (req, res) => {
  const token = jwt.sign({ id: 0, username: 'Guest', isGuest: true }, JWT_SECRET, {
    expiresIn: '4h'
  });
  res.json({ token, username: 'Guest', userId: 0, avatar: null, isGuest: true });
});

// Update user profile (real name)
app.put('/api/profile', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { realName } = req.body;
    if (!realName || realName.trim().length < 1 || realName.trim().length > 40) {
      return res.status(400).json({ error: 'Full name is required (max 40 characters)' });
    }
    db.run('UPDATE users SET real_name = ? WHERE id = ?', [realName.trim(), req.user.id]);
    await saveDatabase();
    res.json({ realName: realName.trim() });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Forgot password — request reset link
app.post('/api/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const successMsg = { message: 'If an account with that email exists, a reset link has been sent.' };

    const stmt = db.prepare('SELECT id, email FROM users WHERE email = ?');
    stmt.bind([email.trim().toLowerCase()]);
    let user = null;
    if (stmt.step()) { user = stmt.getAsObject(); }
    stmt.free();

    if (!user) {
      return res.json(successMsg);
    }

    // Invalidate any existing unused tokens for this user
    db.run('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);

    // Generate new token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.run(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, resetToken, expiresAt]
    );
    await saveDatabase();

    sendResetEmail(user.email, resetToken).catch(err => {
      console.error('Failed to send reset email:', err);
    });

    res.json(successMsg);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Reset password — validate token and update password
app.post('/api/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const stmt = db.prepare(
      'SELECT id, user_id, expires_at, used FROM password_resets WHERE token = ?'
    );
    stmt.bind([token]);
    let resetRecord = null;
    if (stmt.step()) { resetRecord = stmt.getAsObject(); }
    stmt.free();

    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    if (resetRecord.used) {
      return res.status(400).json({ error: 'This reset link has already been used' });
    }
    if (new Date(resetRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, resetRecord.user_id]);
    db.run('UPDATE password_resets SET used = 1 WHERE id = ?', [resetRecord.id]);
    await saveDatabase();

    res.json({ message: 'Password updated successfully. You can now sign in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Upload and parse PDF
app.post('/api/upload-schedule', authenticateToken, requireRegistered, upload.single('pdf'), async (req, res) => {
  try {
    const dataBuffer = await fs.readFile(req.file.path);
    const uint8Array = new Uint8Array(dataBuffer);
    const parser = new PDFParse(uint8Array);
    const result = await parser.getText();
    const pdfText = result.text;

    // Auto-detect format and parse with appropriate parser
    const format = detectFormat(pdfText);
    const userVenue = req.body && req.body.venue ? req.body.venue : null;
    let tournaments;

    if (format === 'wsop') {
      tournaments = parseWSOP2025Schedule(pdfText, 2026);
    } else {
      tournaments = parseGenericSchedule(pdfText, { venue: userVenue });
    }

    // Insert tournaments into database
    for (const tournament of tournaments) {
      db.run(
        `INSERT INTO tournaments (event_number, event_name, date, time, buyin, starting_chips, level_duration, reentry, late_reg, game_variant, venue, notes, is_satellite, target_event, is_restart, parent_event, prize_pool, house_fee, opt_add_on, rake_pct, rake_dollars, uploaded_by, source_pdf, is_deepstack)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tournament.eventNumber || '',
          normalizeEventName(tournament.eventName || 'Unknown Event', tournament.gameVariant),
          tournament.date,
          tournament.time || '12:00PM',
          tournament.buyin,
          tournament.startingChips || null,
          tournament.levelDuration || null,
          normalizeReentry(tournament.reentry) || null,
          tournament.lateReg || null,
          tournament.gameVariant,
          tournament.venue || 'Horseshoe / Paris Las Vegas',
          tournament.notes || null,
          tournament.isSatellite ? 1 : 0,
          tournament.targetEvent || null,
          tournament.isRestart ? 1 : 0,
          tournament.parentEvent || null,
          tournament.prizePool || null,
          tournament.houseFee || null,
          tournament.optAddOn || null,
          tournament.rakePct || null,
          tournament.rakeDollars || null,
          req.user.id,
          req.file.originalname,
          (!tournament.eventNumber && !tournament.isSatellite && !tournament.isRestart) ? 1 : 0
        ]
      );
    }

    await saveDatabase();

    // Clean up uploaded file
    await fs.unlink(req.file.path);

    res.json({
      message: 'Schedule uploaded successfully',
      format: format,
      tournamentsCount: tournaments.length,
      tournaments: tournaments.slice(0, 5) // Return first 5 as preview
    });
  } catch (error) {
    console.error('Upload error:', error);
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Get all tournaments with filters
app.get('/api/tournaments', authenticateToken, (req, res) => {
  try {
    const { minBuyin, maxBuyin, gameVariant, venue, startDate, endDate } = req.query;
    
    let query = "SELECT * FROM tournaments WHERE venue != 'Personal'";
    const params = [];
    
    if (minBuyin) {
      query += ' AND buyin >= ?';
      params.push(parseInt(minBuyin));
    }
    
    if (maxBuyin) {
      query += ' AND buyin <= ?';
      params.push(parseInt(maxBuyin));
    }
    
    if (gameVariant && gameVariant !== 'all') {
      query += ' AND game_variant = ?';
      params.push(gameVariant);
    }
    
    if (venue && venue !== 'all') {
      query += ' AND venue = ?';
      params.push(venue);
    }
    
    query += ' ORDER BY date, time';
    
    const stmt = db.prepare(query);
    stmt.bind(params);
    
    const tournaments = [];
    while (stmt.step()) {
      tournaments.push(stmt.getAsObject());
    }
    stmt.free();
    
    res.json(tournaments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Add tournament to user's schedule
app.post('/api/schedule', authenticateToken, async (req, res) => {
  try {
    const { tournamentId } = req.body;
    
    db.run(
      'INSERT OR IGNORE INTO user_schedules (user_id, tournament_id) VALUES (?, ?)',
      [req.user.id, tournamentId]
    );

    await saveDatabase();
    broadcastToBuddies(req.user.id, 'buddy-schedule-change', {
      buddyId: req.user.id, username: req.user.username, action: 'added', tournamentId
    });

    res.json({ message: 'Tournament added to schedule' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Remove tournament from user's schedule
app.delete('/api/schedule/:tournamentId', authenticateToken, async (req, res) => {
  try {
    const { tournamentId } = req.params;

    db.run(
      'DELETE FROM schedule_conditions WHERE user_id = ? AND tournament_id = ?',
      [req.user.id, tournamentId]
    );
    db.run(
      'DELETE FROM user_schedules WHERE user_id = ? AND tournament_id = ?',
      [req.user.id, tournamentId]
    );

    await saveDatabase();
    broadcastToBuddies(req.user.id, 'buddy-schedule-change', {
      buddyId: req.user.id, username: req.user.username, action: 'removed', tournamentId: Number(tournamentId)
    });

    res.json({ message: 'Tournament removed from schedule' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Set or update a condition on a scheduled event
app.put('/api/schedule/:tournamentId/condition', authenticateToken, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { conditions, isPublic, dependsOnTournamentId, conditionType, profitThreshold } = req.body;
    const publicFlag = isPublic === undefined ? 1 : (isPublic ? 1 : 0);

    // Verify event is on user's schedule
    const checkStmt = db.prepare('SELECT 1 FROM user_schedules WHERE user_id = ? AND tournament_id = ?');
    checkStmt.bind([req.user.id, tournamentId]);
    const onSchedule = checkStmt.step();
    checkStmt.free();
    if (!onSchedule) {
      return res.status(400).json({ error: 'Event not on your schedule' });
    }

    // Build conditions JSON — support new array format or legacy single-condition format
    let conditionsJson;
    if (Array.isArray(conditions)) {
      conditionsJson = JSON.stringify(conditions);
    } else if (conditionType) {
      // Backward compat: construct array from legacy fields
      const cond = { type: conditionType };
      if (dependsOnTournamentId) cond.dependsOnId = dependsOnTournamentId;
      if (profitThreshold) cond.profitThreshold = profitThreshold;
      conditionsJson = JSON.stringify([cond]);
    } else {
      return res.status(400).json({ error: 'No conditions provided' });
    }

    // Upsert: delete existing then insert
    db.run('DELETE FROM schedule_conditions WHERE user_id = ? AND tournament_id = ?', [req.user.id, tournamentId]);
    db.run(
      'INSERT INTO schedule_conditions (user_id, tournament_id, condition_type, is_public, conditions) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, tournamentId, 'MULTI', publicFlag, conditionsJson]
    );

    await saveDatabase();
    res.json({ message: 'Condition set' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Toggle anchor/must-play status on a scheduled event
app.put('/api/schedule/:tournamentId/anchor', authenticateToken, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { isAnchor } = req.body;
    db.run(
      'UPDATE user_schedules SET is_anchor = ? WHERE user_id = ? AND tournament_id = ?',
      [isAnchor ? 1 : 0, req.user.id, tournamentId]
    );
    await saveDatabase();
    res.json({ message: isAnchor ? 'Event locked in' : 'Event unlocked' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Update planned entries for a scheduled event
app.put('/api/schedule/:tournamentId/entries', authenticateToken, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { plannedEntries } = req.body;
    const entries = Math.max(1, Math.min(99, parseInt(plannedEntries) || 1));
    db.run(
      'UPDATE user_schedules SET planned_entries = ? WHERE user_id = ? AND tournament_id = ?',
      [entries, req.user.id, tournamentId]
    );
    await saveDatabase();
    res.json({ message: 'Planned entries updated', plannedEntries: entries });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Remove condition from a scheduled event (make it firm)
app.delete('/api/schedule/:tournamentId/condition', authenticateToken, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    db.run('DELETE FROM schedule_conditions WHERE user_id = ? AND tournament_id = ?', [req.user.id, tournamentId]);
    await saveDatabase();
    res.json({ message: 'Condition removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Create a personal event (Travel Day / Day Off)
app.post('/api/personal-event', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { date, type, notes } = req.body;
    if (!['Travel Day', 'Day Off'].includes(type)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    // Convert ISO to human-readable format
    const dateObj = new Date(date + 'T12:00:00');
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const humanDate = `${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;

    // Check for duplicate
    const dupStmt = db.prepare(
      `SELECT t.id FROM tournaments t
       JOIN user_schedules us ON t.id = us.tournament_id
       WHERE us.user_id = ? AND t.event_name = ? AND t.date = ? AND t.venue = 'Personal'`
    );
    dupStmt.bind([req.user.id, type, humanDate]);
    const isDup = dupStmt.step();
    dupStmt.free();
    if (isDup) {
      return res.status(409).json({ error: `${type} already exists on this date` });
    }

    // Insert synthetic tournament
    db.run(
      `INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, notes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['', type, humanDate, '12:00 AM', 0, 'Personal', 'Personal', notes || '', req.user.id]
    );

    const idStmt = db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const { id: tournamentId } = idStmt.getAsObject();
    idStmt.free();

    // Add to user's schedule
    db.run('INSERT INTO user_schedules (user_id, tournament_id) VALUES (?, ?)',
      [req.user.id, tournamentId]);

    await saveDatabase();
    res.status(201).json({ message: `${type} created`, tournamentId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Update a personal event (e.g. travel time notes)
app.put('/api/personal-event/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    // Verify this is a personal event owned by this user
    const checkStmt = db.prepare(
      `SELECT t.id FROM tournaments t
       JOIN user_schedules us ON t.id = us.tournament_id
       WHERE t.id = ? AND us.user_id = ? AND t.venue = 'Personal'`
    );
    checkStmt.bind([id, req.user.id]);
    const isOwned = checkStmt.step();
    checkStmt.free();

    if (!isOwned) {
      return res.status(404).json({ error: 'Personal event not found' });
    }

    db.run('UPDATE tournaments SET notes = ? WHERE id = ?', [notes || '', id]);
    await saveDatabase();
    res.json({ message: 'Personal event updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Delete a personal event (removes tournament row + schedule link)
app.delete('/api/personal-event/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify this is a personal event owned by this user
    const checkStmt = db.prepare(
      `SELECT t.id FROM tournaments t
       JOIN user_schedules us ON t.id = us.tournament_id
       WHERE t.id = ? AND us.user_id = ? AND t.venue = 'Personal'`
    );
    checkStmt.bind([id, req.user.id]);
    const isOwned = checkStmt.step();
    checkStmt.free();

    if (!isOwned) {
      return res.status(404).json({ error: 'Personal event not found' });
    }

    db.run('DELETE FROM schedule_conditions WHERE tournament_id = ? AND user_id = ?', [id, req.user.id]);
    db.run('DELETE FROM user_schedules WHERE tournament_id = ? AND user_id = ?', [id, req.user.id]);
    db.run("DELETE FROM tournaments WHERE id = ? AND venue = 'Personal'", [id]);

    await saveDatabase();
    res.json({ message: 'Personal event deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Get user's schedule
app.get('/api/my-schedule', authenticateToken, (req, res) => {
  try {
    const query = `
      SELECT t.*, us.added_at, us.is_anchor, us.planned_entries,
             sc.conditions AS conditions_json,
             sc.is_public AS condition_is_public
      FROM tournaments t
      JOIN user_schedules us ON t.id = us.tournament_id
      LEFT JOIN schedule_conditions sc ON sc.tournament_id = t.id AND sc.user_id = us.user_id
      WHERE us.user_id = ?
      ORDER BY t.date, t.time
    `;

    const stmt = db.prepare(query);
    stmt.bind([req.user.id]);

    const tournaments = [];
    while (stmt.step()) {
      tournaments.push(stmt.getAsObject());
    }
    stmt.free();
    
    res.json(tournaments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Avatar Endpoints ─────────────────────────────────────────

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  }
});

app.put('/api/avatar', authenticateToken, requireRegistered, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    db.run('UPDATE users SET avatar = ? WHERE id = ?', [dataUri, req.user.id]);
    await saveDatabase();
    res.json({ avatar: dataUri });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/avatar', authenticateToken, requireRegistered, async (req, res) => {
  try {
    db.run('UPDATE users SET avatar = NULL WHERE id = ?', [req.user.id]);
    await saveDatabase();
    res.json({ message: 'Avatar removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/avatar/:userId', (req, res) => {
  try {
    const stmt = db.prepare('SELECT avatar FROM users WHERE id = ?');
    stmt.bind([req.params.userId]);
    let avatar = null;
    if (stmt.step()) avatar = stmt.getAsObject().avatar;
    stmt.free();
    res.json({ avatar });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Share Request Endpoints ───────────────────────────────────

// Send a share request to another user
app.post('/api/share-request', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { username } = req.body;
    const stmt = db.prepare('SELECT id FROM users WHERE username = ?');
    stmt.bind([username]);
    let target = null;
    if (stmt.step()) target = stmt.getAsObject();
    stmt.free();

    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === req.user.id) return res.status(400).json({ error: "Can't share with yourself" });

    // Check if already connected or pending (either direction)
    const chk = db.prepare(
      `SELECT id, status FROM share_requests
       WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)`
    );
    chk.bind([req.user.id, target.id, target.id, req.user.id]);
    let existing = null;
    if (chk.step()) existing = chk.getAsObject();
    chk.free();

    if (existing) {
      if (existing.status === 'accepted') return res.status(400).json({ error: 'Already connected' });
      if (existing.status === 'pending') return res.status(400).json({ error: 'Request already pending' });
    }

    db.run(
      "INSERT INTO share_requests (from_user_id, to_user_id, status) VALUES (?, ?, 'pending')",
      [req.user.id, target.id]
    );
    await saveDatabase();
    res.json({ message: `Request sent to ${username}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Get share buddies + pending counts
app.get('/api/share-buddies', authenticateToken, (req, res) => {
  try {
    const uid = req.user.id;

    // Accepted buddies (either direction)
    const buddyStmt = db.prepare(`
      SELECT u.id, u.username, u.avatar, u.real_name, sr.responded_at AS since
      FROM share_requests sr
      JOIN users u ON u.id = CASE WHEN sr.from_user_id = ? THEN sr.to_user_id ELSE sr.from_user_id END
      WHERE sr.status = 'accepted'
        AND (sr.from_user_id = ? OR sr.to_user_id = ?)
    `);
    buddyStmt.bind([uid, uid, uid]);
    const buddies = [];
    while (buddyStmt.step()) buddies.push(buddyStmt.getAsObject());
    buddyStmt.free();

    // Pending incoming
    const pendStmt = db.prepare(`
      SELECT sr.id, u.id AS from_user_id, u.username, u.avatar, u.real_name, sr.created_at
      FROM share_requests sr
      JOIN users u ON sr.from_user_id = u.id
      WHERE sr.to_user_id = ? AND sr.status = 'pending'
    `);
    pendStmt.bind([uid]);
    const pendingIncoming = [];
    while (pendStmt.step()) pendingIncoming.push(pendStmt.getAsObject());
    pendStmt.free();

    // Pending outgoing
    const outStmt = db.prepare(`
      SELECT sr.id, u.id AS to_user_id, u.username, u.avatar, u.real_name, sr.created_at
      FROM share_requests sr
      JOIN users u ON sr.to_user_id = u.id
      WHERE sr.from_user_id = ? AND sr.status = 'pending'
    `);
    outStmt.bind([uid]);
    const pendingOutgoing = [];
    while (outStmt.step()) pendingOutgoing.push(outStmt.getAsObject());
    outStmt.free();

    // Last seen shares
    const lss = db.prepare('SELECT last_seen_shares FROM users WHERE id = ?');
    lss.bind([uid]);
    let lastSeenShares = null;
    if (lss.step()) lastSeenShares = lss.getAsObject().last_seen_shares;
    lss.free();

    // Build map of tournament_id -> buddies playing it
    const buddyEvents = {};
    for (const b of buddies) {
      const bsStmt = db.prepare('SELECT tournament_id, is_anchor FROM user_schedules WHERE user_id = ?');
      bsStmt.bind([b.id]);
      while (bsStmt.step()) {
        const row = bsStmt.getAsObject();
        const tid = row.tournament_id;
        if (!buddyEvents[tid]) buddyEvents[tid] = [];
        buddyEvents[tid].push({ id: b.id, username: b.username, avatar: b.avatar || null, isAnchor: !!row.is_anchor });
      }
      bsStmt.free();
    }

    // Live updates from buddies (today only)
    const buddyLiveUpdates = {};
    for (const b of buddies) {
      const luStmt = db.prepare(`
        SELECT lu.tournament_id, lu.stack, lu.sb, lu.bb, lu.bb_ante,
               lu.is_reg_closed, lu.bubble, lu.is_itm, lu.locked_amount,
               lu.is_final_table, lu.places_left, lu.first_place_prize,
               lu.is_deal, lu.deal_place, lu.deal_payout, lu.is_busted,
               lu.total_entries, lu.is_bagged, lu.bag_day, lu.play_started_at,
               lu.update_text, lu.created_at,
               t.event_name, t.venue
        FROM live_updates lu
        JOIN tournaments t ON lu.tournament_id = t.id
        WHERE lu.user_id = ? AND lu.created_at >= date('now', 'start of day')
        ORDER BY lu.created_at DESC LIMIT 1
      `);
      luStmt.bind([b.id]);
      if (luStmt.step()) {
        const row = luStmt.getAsObject();
        buddyLiveUpdates[b.id] = {
          tournamentId: row.tournament_id,
          eventName: row.event_name,
          venue: row.venue,
          stack: row.stack,
          sb: row.sb,
          bb: row.bb,
          bbAnte: row.bb_ante,
          isItm: row.is_itm,
          totalEntries: row.total_entries,
          isRegClosed: row.is_reg_closed,
          bubble: row.bubble,
          lockedAmount: row.locked_amount,
          isFinalTable: row.is_final_table,
          placesLeft: row.places_left,
          firstPlacePrize: row.first_place_prize,
          isDeal: row.is_deal,
          dealPlace: row.deal_place,
          dealPayout: row.deal_payout,
          isBusted: row.is_busted,
          isBagged: row.is_bagged,
          bagDay: row.bag_day,
          playStartedAt: row.play_started_at,
          updateText: row.update_text,
          updatedAt: row.created_at
        };
      }
      luStmt.free();
    }

    res.json({ buddies, pendingIncoming, pendingOutgoing, lastSeenShares, buddyEvents, buddyLiveUpdates });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Accept a share request
app.put('/api/share-request/:id/accept', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const sr = db.prepare('SELECT * FROM share_requests WHERE id = ? AND to_user_id = ? AND status = ?');
    sr.bind([req.params.id, req.user.id, 'pending']);
    let row = null;
    if (sr.step()) row = sr.getAsObject();
    sr.free();
    if (!row) return res.status(404).json({ error: 'Request not found' });

    db.run("UPDATE share_requests SET status = 'accepted', responded_at = CURRENT_TIMESTAMP WHERE id = ?", [row.id]);
    await saveDatabase();

    // SSE: notify the sender that their request was accepted
    const senderClients = sseClients.get(row.from_user_id);
    if (senderClients) {
      const msg = `event: buddy-request\ndata: ${JSON.stringify({ action: 'accepted', byUserId: req.user.id })}\n\n`;
      for (const client of senderClients) client.write(msg);
    }

    res.json({ message: 'Request accepted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Reject a share request (deletes so sender can retry)
app.put('/api/share-request/:id/reject', authenticateToken, requireRegistered, async (req, res) => {
  try {
    db.run('DELETE FROM share_requests WHERE id = ? AND to_user_id = ? AND status = ?',
      [req.params.id, req.user.id, 'pending']);
    await saveDatabase();
    res.json({ message: 'Request rejected' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Cancel an outgoing share request
app.delete('/api/share-request/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    db.run('DELETE FROM share_requests WHERE id = ? AND from_user_id = ? AND status = ?',
      [req.params.id, req.user.id, 'pending']);
    await saveDatabase();
    res.json({ message: 'Request cancelled' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Remove a share buddy (both directions)
app.delete('/api/share-buddy/:userId', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const other = req.params.userId;
    db.run(
      "DELETE FROM share_requests WHERE status = 'accepted' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))",
      [req.user.id, other, other, req.user.id]
    );
    await saveDatabase();
    res.json({ message: 'Removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Groups ─────────────────────────────────────────────────────

// Create a group
app.post('/api/groups', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.trim().length < 1 || name.trim().length > 40) {
      return res.status(400).json({ error: 'Group name must be 1–40 characters' });
    }

    db.run('INSERT INTO groups (name, created_by) VALUES (?, ?)', [name.trim(), req.user.id]);
    const groupId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];

    // Auto-add creator as owner
    db.run('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)', [groupId, req.user.id, 'owner']);
    await saveDatabase();

    res.status(201).json({ id: groupId, name: name.trim(), message: 'Group created' });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// List user's groups
app.get('/api/groups', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT g.id, g.name, g.avatar, g.created_by, g.created_at, g.leaderboard_enabled,
             (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) + CASE WHEN NOT EXISTS (SELECT 1 FROM group_members gm_chk WHERE gm_chk.group_id = g.id AND gm_chk.user_id = g.created_by) THEN 1 ELSE 0 END AS member_count,
             (SELECT gm3.role FROM group_members gm3 WHERE gm3.group_id = g.id AND gm3.user_id = ?) AS my_role,
             (SELECT m.message FROM group_messages m WHERE m.group_id = g.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
             (SELECT u2.username FROM group_messages m2 JOIN users u2 ON m2.user_id = u2.id WHERE m2.group_id = g.id ORDER BY m2.created_at DESC LIMIT 1) AS last_message_by,
             (SELECT m3.created_at FROM group_messages m3 WHERE m3.group_id = g.id ORDER BY m3.created_at DESC LIMIT 1) AS last_message_at,
             (SELECT u_owner.username FROM users u_owner WHERE u_owner.id = g.created_by) AS owner_name
      FROM groups g
      JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
      ORDER BY COALESCE(
        (SELECT m4.created_at FROM group_messages m4 WHERE m4.group_id = g.id ORDER BY m4.created_at DESC LIMIT 1),
        g.created_at
      ) DESC
    `);
    stmt.bind([req.user.id, req.user.id]);
    const groups = [];
    while (stmt.step()) groups.push(stmt.getAsObject());
    stmt.free();

    res.json(groups);
  } catch (error) {
    console.error('List groups error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Delete a group (owner only)
app.delete('/api/groups/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const groupId = Number(req.params.id);

    // Verify ownership
    const chk = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?');
    chk.bind([groupId, req.user.id]);
    const row = chk.step() ? chk.getAsObject() : null;
    chk.free();
    if (!row || row.role !== 'owner') return res.status(403).json({ error: 'Only the group owner can delete this group' });

    // Get member IDs for SSE broadcast before deleting
    const memberIds = getGroupMemberIds(groupId);

    db.run('DELETE FROM group_invites WHERE group_id = ?', [groupId]);
    db.run('DELETE FROM group_messages WHERE group_id = ?', [groupId]);
    db.run('DELETE FROM group_members WHERE group_id = ?', [groupId]);
    db.run('DELETE FROM groups WHERE id = ?', [groupId]);
    await saveDatabase();

    // Broadcast to all former members (including owner)
    const message = `event: group-deleted\ndata: ${JSON.stringify({ groupId })}\n\n`;
    for (const memberId of memberIds) {
      const clients = sseClients.get(memberId);
      if (clients) {
        for (const c of clients) c.write(message);
      }
    }

    res.json({ message: 'Group deleted' });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Invite buddy to group (sends invite instead of direct-add)
app.post('/api/groups/:id/members', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    // Verify caller is a member of this group
    const memChk = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?');
    memChk.bind([groupId, req.user.id]);
    const callerRow = memChk.step() ? memChk.getAsObject() : null;
    memChk.free();
    if (!callerRow) return res.status(403).json({ error: 'You are not a member of this group' });

    // Look up the target user
    const uStmt = db.prepare('SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)');
    uStmt.bind([username]);
    const targetUser = uStmt.step() ? uStmt.getAsObject() : null;
    uStmt.free();
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // Check they are an existing buddy
    const buddyIds = getBuddyIds(req.user.id);
    if (!buddyIds.includes(targetUser.id)) {
      return res.status(400).json({ error: 'You can only invite your existing connections to a group' });
    }

    // Check not already a member
    const existChk = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?');
    existChk.bind([groupId, targetUser.id]);
    const already = existChk.step();
    existChk.free();
    if (already) return res.status(400).json({ error: 'User is already a member' });

    // Check not already invited (pending)
    const invChk = db.prepare('SELECT id FROM group_invites WHERE group_id = ? AND invited_user_id = ? AND status = ?');
    invChk.bind([groupId, targetUser.id, 'pending']);
    const alreadyInvited = invChk.step();
    invChk.free();
    if (alreadyInvited) return res.status(400).json({ error: 'Invite already pending for this user' });

    db.run(
      "INSERT INTO group_invites (group_id, invited_by, invited_user_id, status) VALUES (?, ?, ?, 'pending')",
      [groupId, req.user.id, targetUser.id]
    );
    await saveDatabase();

    // Get group name for the SSE payload
    const gStmt = db.prepare('SELECT name FROM groups WHERE id = ?');
    gStmt.bind([groupId]);
    const group = gStmt.step() ? gStmt.getAsObject() : null;
    gStmt.free();

    // Get the invite ID
    const lastId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];

    // SSE: notify the invited user
    const invitedClients = sseClients.get(targetUser.id);
    if (invitedClients) {
      const msg = `event: group-invite\ndata: ${JSON.stringify({
        inviteId: lastId,
        groupId,
        groupName: group ? group.name : 'Unknown',
        invitedBy: req.user.username
      })}\n\n`;
      for (const client of invitedClients) client.write(msg);
    }

    res.status(201).json({ message: `Invite sent to ${targetUser.username}` });
  } catch (error) {
    console.error('Invite group member error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// List group members
app.get('/api/groups/:id/members', authenticateToken, (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const memChk = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?');
    memChk.bind([groupId, req.user.id]);
    const isMember = memChk.step();
    memChk.free();
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });

    const stmt = db.prepare(`
      SELECT u.id, u.username, u.avatar, u.real_name, gm.role
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = ?
      ORDER BY gm.role DESC, u.username
    `);
    stmt.bind([groupId]);
    const members = [];
    while (stmt.step()) members.push(stmt.getAsObject());
    stmt.free();
    res.json(members);
  } catch (error) {
    console.error('List group members error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Remove member from group (owner removes, or self-leave)
app.delete('/api/groups/:id/members/:userId', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);

    // Verify caller is a member
    const memChk = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?');
    memChk.bind([groupId, req.user.id]);
    const callerRow = memChk.step() ? memChk.getAsObject() : null;
    memChk.free();
    if (!callerRow) return res.status(403).json({ error: 'You are not a member of this group' });

    if (targetUserId === req.user.id) {
      // Self-leave
      if (callerRow.role === 'owner') {
        return res.status(400).json({ error: 'Owners cannot leave their group. Delete it instead.' });
      }
      db.run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, req.user.id]);
    } else {
      // Only owner can remove others
      if (callerRow.role !== 'owner') {
        return res.status(403).json({ error: 'Only the group owner can remove members' });
      }
      db.run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, targetUserId]);
    }
    await saveDatabase();

    broadcastToGroup(groupId, 'group-updated', { groupId, action: 'member-removed', userId: targetUserId });

    // Also notify the removed user directly if they were removed by owner
    if (targetUserId !== req.user.id) {
      const removedClients = sseClients.get(targetUserId);
      if (removedClients) {
        const msg = `event: group-deleted\ndata: ${JSON.stringify({ groupId })}\n\n`;
        for (const c of removedClients) c.write(msg);
      }
    }

    res.json({ message: 'Member removed' });
  } catch (error) {
    console.error('Remove group member error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Get group feed (messages + live-update entries, paginated)
app.get('/api/groups/:id/feed', authenticateToken, (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const before = req.query.before; // ISO timestamp for pagination

    // Verify membership
    const memChk = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?');
    memChk.bind([groupId, req.user.id]);
    const isMember = memChk.step();
    memChk.free();
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });

    // Get messages
    let msgSql = `
      SELECT gm.id, 'message' AS type, gm.user_id, u.username, u.avatar, u.real_name,
             gm.message AS content, gm.created_at
      FROM group_messages gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = ?
    `;
    const msgParams = [groupId];

    if (before) {
      msgSql += ' AND gm.created_at < ?';
      msgParams.push(before);
    }
    msgSql += ' ORDER BY gm.created_at DESC LIMIT ?';
    msgParams.push(limit);

    const msgStmt = db.prepare(msgSql);
    msgStmt.bind(msgParams);
    const feed = [];
    while (msgStmt.step()) feed.push(msgStmt.getAsObject());
    msgStmt.free();

    // Sort chronologically (oldest first) for display
    feed.sort((a, b) => a.created_at < b.created_at ? -1 : 1);

    res.json(feed);
  } catch (error) {
    console.error('Group feed error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Post a message to group
app.post('/api/groups/:id/messages', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const { message } = req.body;
    if (!message || message.trim().length < 1 || message.trim().length > 500) {
      return res.status(400).json({ error: 'Message must be 1–500 characters' });
    }

    // Verify membership
    const memChk = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?');
    memChk.bind([groupId, req.user.id]);
    const isMember = memChk.step();
    memChk.free();
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });

    db.run('INSERT INTO group_messages (group_id, user_id, message) VALUES (?, ?, ?)',
      [groupId, req.user.id, message.trim()]);
    await saveDatabase();

    // Get avatar from DB (not in JWT)
    const avStmt = db.prepare('SELECT avatar FROM users WHERE id = ?');
    avStmt.bind([req.user.id]);
    const avRow = avStmt.step() ? avStmt.getAsObject() : {};
    avStmt.free();

    const now = new Date().toISOString();
    broadcastToGroup(groupId, 'group-message', {
      groupId,
      userId: req.user.id,
      username: req.user.username,
      avatar: avRow.avatar || null,
      message: message.trim(),
      createdAt: now
    });

    res.status(201).json({ message: 'Sent' });
  } catch (error) {
    console.error('Post group message error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Get merged group schedule
app.get('/api/groups/:id/schedule', authenticateToken, (req, res) => {
  try {
    const groupId = Number(req.params.id);

    // Verify membership
    const memChk = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?');
    memChk.bind([groupId, req.user.id]);
    const isMember = memChk.step();
    memChk.free();
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });

    // Get all member schedules with tournament data
    const stmt = db.prepare(`
      SELECT t.id AS tournament_id, t.event_number, t.event_name, t.date, t.time,
             t.buyin, t.game_variant, t.venue, t.notes,
             u.id AS user_id, u.username, u.avatar, u.real_name
      FROM user_schedules us
      JOIN tournaments t ON us.tournament_id = t.id
      JOIN users u ON us.user_id = u.id
      JOIN group_members gm ON gm.user_id = us.user_id AND gm.group_id = ?
      ORDER BY t.date, t.time
    `);
    stmt.bind([groupId]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    // Group by tournament — { tournamentId -> { ...tournament, members: [{id, username, avatar}] } }
    const byTournament = {};
    for (const row of rows) {
      if (!byTournament[row.tournament_id]) {
        byTournament[row.tournament_id] = {
          id: row.tournament_id,
          event_number: row.event_number,
          event_name: row.event_name,
          date: row.date,
          time: row.time,
          buyin: row.buyin,
          game_variant: row.game_variant,
          venue: row.venue,
          notes: row.notes,
          members: []
        };
      }
      byTournament[row.tournament_id].members.push({
        id: row.user_id,
        username: row.username,
        avatar: row.avatar
      });
    }

    res.json(Object.values(byTournament));
  } catch (error) {
    console.error('Group schedule error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ── Group Leaderboard Endpoints ───────────────────────────────

// Get leaderboard data for a group
app.get('/api/groups/:id/leaderboard', authenticateToken, (req, res) => {
  try {
    const groupId = Number(req.params.id);

    // Verify caller is a member
    const memChk = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?');
    memChk.bind([groupId, req.user.id]);
    const isMember = memChk.step();
    memChk.free();
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });

    // Check leaderboard is enabled
    const grpChk = db.prepare('SELECT leaderboard_enabled FROM groups WHERE id = ?');
    grpChk.bind([groupId]);
    const grp = grpChk.step() ? grpChk.getAsObject() : null;
    grpChk.free();
    if (!grp) return res.status(404).json({ error: 'Group not found' });
    if (!grp.leaderboard_enabled) return res.status(403).json({ error: 'Leaderboard is not enabled for this group' });

    const stmt = db.prepare(`
      SELECT u.id, u.username, u.avatar, u.real_name,
             COUNT(te.id) as events_played,
             SUM(CASE WHEN te.cashed = 1 THEN 1 ELSE 0 END) as cashes,
             SUM(COALESCE(t.buyin, 0) * COALESCE(te.num_entries, 1)) as total_buyins,
             SUM(CASE WHEN te.cashed = 1 THEN COALESCE(te.cash_amount, 0) ELSE 0 END) as total_won,
             SUM(CASE WHEN te.finish_place = 1 THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN te.finish_place IS NOT NULL AND te.finish_place <= 9 AND te.cashed = 1 THEN 1 ELSE 0 END) as final_tables
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      LEFT JOIN tracking_entries te ON te.user_id = u.id
      LEFT JOIN tournaments t ON te.tournament_id = t.id
      WHERE gm.group_id = ?
      GROUP BY u.id, u.username, u.avatar, u.real_name
    `);
    stmt.bind([groupId]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    // Compute net_pl and roi, sort by net_pl DESC
    const leaderboard = rows.map(r => ({
      id: r.id,
      username: r.username,
      avatar: r.avatar,
      events_played: r.events_played || 0,
      cashes: r.cashes || 0,
      total_buyins: r.total_buyins || 0,
      total_won: r.total_won || 0,
      wins: r.wins || 0,
      final_tables: r.final_tables || 0,
      net_pl: (r.total_won || 0) - (r.total_buyins || 0),
      roi: r.total_buyins > 0 ? Math.round(((r.total_won - r.total_buyins) / r.total_buyins) * 100) : 0
    })).sort((a, b) => b.net_pl - a.net_pl);

    res.json(leaderboard);
  } catch (error) {
    console.error('Group leaderboard error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Toggle leaderboard on/off (owner only)
app.put('/api/groups/:id/leaderboard', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const { enabled } = req.body;

    // Verify ownership
    const chk = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?');
    chk.bind([groupId, req.user.id]);
    const row = chk.step() ? chk.getAsObject() : null;
    chk.free();
    if (!row || row.role !== 'owner') return res.status(403).json({ error: 'Only the group owner can toggle the leaderboard' });

    db.run('UPDATE groups SET leaderboard_enabled = ? WHERE id = ?', [enabled ? 1 : 0, groupId]);
    await saveDatabase();

    // Broadcast to all group members
    const memberIds = getGroupMemberIds(groupId);
    const message = `event: group-updated\ndata: ${JSON.stringify({ groupId, leaderboard_enabled: enabled ? 1 : 0 })}\n\n`;
    for (const memberId of memberIds) {
      const clients = sseClients.get(memberId);
      if (clients) {
        for (const c of clients) c.write(message);
      }
    }

    res.json({ message: `Leaderboard ${enabled ? 'enabled' : 'disabled'}`, leaderboard_enabled: enabled ? 1 : 0 });
  } catch (error) {
    console.error('Toggle leaderboard error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ── Group Invite Endpoints ────────────────────────────────────

// Get pending invites for a specific group (visible to group members)
app.get('/api/groups/:id/invites', authenticateToken, (req, res) => {
  try {
    const groupId = Number(req.params.id);

    // Verify caller is a member
    const memChk = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?');
    memChk.bind([groupId, req.user.id]);
    const isMember = memChk.step();
    memChk.free();
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });

    const stmt = db.prepare(`
      SELECT gi.id, gi.invited_user_id, gi.invited_by, gi.created_at,
             u.username, u.avatar, u.real_name,
             inv.username AS invited_by_username, inv.real_name AS invited_by_real_name
      FROM group_invites gi
      JOIN users u ON gi.invited_user_id = u.id
      JOIN users inv ON gi.invited_by = inv.id
      WHERE gi.group_id = ? AND gi.status = 'pending'
      ORDER BY gi.created_at DESC
    `);
    stmt.bind([groupId]);
    const invites = [];
    while (stmt.step()) invites.push(stmt.getAsObject());
    stmt.free();

    res.json(invites);
  } catch (error) {
    console.error('Get group invites error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Accept a group invite
app.put('/api/group-invites/:id/accept', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const inviteId = Number(req.params.id);
    const stmt = db.prepare('SELECT * FROM group_invites WHERE id = ? AND invited_user_id = ? AND status = ?');
    stmt.bind([inviteId, req.user.id, 'pending']);
    let invite = null;
    if (stmt.step()) invite = stmt.getAsObject();
    stmt.free();

    if (!invite) return res.status(404).json({ error: 'Invite not found' });

    // Update invite status
    db.run("UPDATE group_invites SET status = 'accepted', responded_at = CURRENT_TIMESTAMP WHERE id = ?", [inviteId]);

    // Add user to group_members
    db.run('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)', [invite.group_id, req.user.id, 'member']);
    await saveDatabase();

    // Broadcast group-updated to all group members (including the new member)
    broadcastToGroup(invite.group_id, 'group-updated', { groupId: invite.group_id, action: 'member-added', username: req.user.username });

    // SSE: notify the inviter that invite was accepted
    const inviterClients = sseClients.get(invite.invited_by);
    if (inviterClients) {
      const msg = `event: group-invite-response\ndata: ${JSON.stringify({
        groupId: invite.group_id,
        username: req.user.username,
        action: 'accepted'
      })}\n\n`;
      for (const client of inviterClients) client.write(msg);
    }

    res.json({ message: 'Invite accepted' });
  } catch (error) {
    console.error('Accept group invite error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Decline a group invite (deletes so they can be re-invited)
app.put('/api/group-invites/:id/decline', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const inviteId = Number(req.params.id);
    const stmt = db.prepare('SELECT * FROM group_invites WHERE id = ? AND invited_user_id = ? AND status = ?');
    stmt.bind([inviteId, req.user.id, 'pending']);
    let invite = null;
    if (stmt.step()) invite = stmt.getAsObject();
    stmt.free();

    if (!invite) return res.status(404).json({ error: 'Invite not found' });

    // Delete the invite so they can be re-invited later
    db.run('DELETE FROM group_invites WHERE id = ?', [inviteId]);
    await saveDatabase();

    // SSE: notify the inviter that invite was declined
    const inviterClients = sseClients.get(invite.invited_by);
    if (inviterClients) {
      const msg = `event: group-invite-response\ndata: ${JSON.stringify({
        groupId: invite.group_id,
        username: req.user.username,
        action: 'declined'
      })}\n\n`;
      for (const client of inviterClients) client.write(msg);
    }

    res.json({ message: 'Invite declined' });
  } catch (error) {
    console.error('Decline group invite error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ── Notifications Endpoints ──────────────────────────────────

// Get all notifications for the authenticated user
app.get('/api/notifications', authenticateToken, (req, res) => {
  try {
    const uid = req.user.id;

    // Pending group invites
    const giStmt = db.prepare(`
      SELECT gi.id, gi.group_id, gi.invited_by, gi.created_at,
             g.name AS group_name,
             u.username AS invited_by_username, u.avatar AS invited_by_avatar, u.real_name AS invited_by_real_name
      FROM group_invites gi
      JOIN groups g ON gi.group_id = g.id
      JOIN users u ON gi.invited_by = u.id
      WHERE gi.invited_user_id = ? AND gi.status = 'pending'
      ORDER BY gi.created_at DESC
    `);
    giStmt.bind([uid]);
    const groupInvites = [];
    while (giStmt.step()) groupInvites.push(giStmt.getAsObject());
    giStmt.free();

    // Pending incoming buddy requests
    const brStmt = db.prepare(`
      SELECT sr.id, u.id AS from_user_id, u.username, u.avatar, u.real_name, sr.created_at
      FROM share_requests sr
      JOIN users u ON sr.from_user_id = u.id
      WHERE sr.to_user_id = ? AND sr.status = 'pending'
      ORDER BY sr.created_at DESC
    `);
    brStmt.bind([uid]);
    const buddyRequests = [];
    while (brStmt.step()) buddyRequests.push(brStmt.getAsObject());
    brStmt.free();

    // Recently accepted buddy requests (ones the user sent that were accepted)
    const lsnStmt = db.prepare('SELECT last_seen_notifications FROM users WHERE id = ?');
    lsnStmt.bind([uid]);
    let lastSeen = null;
    if (lsnStmt.step()) lastSeen = lsnStmt.getAsObject().last_seen_notifications;
    lsnStmt.free();

    let acceptedBuddies = [];
    if (lastSeen) {
      const abStmt = db.prepare(`
        SELECT sr.id, u.id AS user_id, u.username, u.avatar, u.real_name, sr.responded_at
        FROM share_requests sr
        JOIN users u ON sr.to_user_id = u.id
        WHERE sr.from_user_id = ? AND sr.status = 'accepted' AND sr.responded_at > ?
        ORDER BY sr.responded_at DESC
      `);
      abStmt.bind([uid, lastSeen]);
      while (abStmt.step()) acceptedBuddies.push(abStmt.getAsObject());
      abStmt.free();
    } else {
      // If never seen, show all recently accepted (last 7 days)
      const abStmt = db.prepare(`
        SELECT sr.id, u.id AS user_id, u.username, u.avatar, u.real_name, sr.responded_at
        FROM share_requests sr
        JOIN users u ON sr.to_user_id = u.id
        WHERE sr.from_user_id = ? AND sr.status = 'accepted'
          AND sr.responded_at > datetime('now', '-7 days')
        ORDER BY sr.responded_at DESC
      `);
      abStmt.bind([uid]);
      while (abStmt.step()) acceptedBuddies.push(abStmt.getAsObject());
      abStmt.free();
    }

    res.json({ groupInvites, buddyRequests, acceptedBuddies, lastSeenNotifications: lastSeen });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Mark notifications as seen
app.put('/api/seen-notifications', authenticateToken, requireRegistered, async (req, res) => {
  try {
    db.run('UPDATE users SET last_seen_notifications = CURRENT_TIMESTAMP WHERE id = ?', [req.user.id]);
    await saveDatabase();
    res.json({ message: 'ok' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Mark all shared schedules as seen
app.put('/api/seen-shares', authenticateToken, requireRegistered, async (req, res) => {
  try {
    db.run('UPDATE users SET last_seen_shares = CURRENT_TIMESTAMP WHERE id = ?', [req.user.id]);
    await saveDatabase();
    res.json({ message: 'ok' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Get specific user's schedule (if share buddy or own)
app.get('/api/schedule/:userId', authenticateToken, (req, res) => {
  try {
    const { userId } = req.params;

    // Check permission via share_requests
    if (parseInt(userId) !== req.user.id) {
      const permStmt = db.prepare(
        `SELECT id FROM share_requests
         WHERE status = 'accepted'
           AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`
      );
      permStmt.bind([userId, req.user.id, req.user.id, userId]);
      let hasPermission = false;
      if (permStmt.step()) hasPermission = true;
      permStmt.free();

      if (!hasPermission) {
        return res.status(403).json({ error: 'No permission to view this schedule' });
      }
    }

    const query = `
      SELECT t.*, us.is_anchor, us.planned_entries,
             sc.conditions AS conditions_json,
             sc.is_public AS condition_is_public
      FROM tournaments t
      JOIN user_schedules us ON t.id = us.tournament_id
      LEFT JOIN schedule_conditions sc ON sc.tournament_id = t.id AND sc.user_id = us.user_id
      WHERE us.user_id = ?
      ORDER BY t.date, t.time
    `;

    const stmt = db.prepare(query);
    stmt.bind([userId]);

    const tournaments = [];
    while (stmt.step()) tournaments.push(stmt.getAsObject());
    stmt.free();

    res.json(tournaments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Share Token Endpoints ─────────────────────────────────────

// Public shared schedule view (no auth required)
app.get('/api/shared/:token', (req, res) => {
  try {
    const { token } = req.params;
    const tokenStmt = db.prepare(
      'SELECT st.user_id, u.username, u.avatar, u.real_name FROM share_tokens st JOIN users u ON st.user_id = u.id WHERE st.token = ?'
    );
    tokenStmt.bind([token]);
    let tokenRow = null;
    if (tokenStmt.step()) { tokenRow = tokenStmt.getAsObject(); }
    tokenStmt.free();

    if (!tokenRow) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    const schedStmt = db.prepare(`
      SELECT t.*, us.is_anchor, us.planned_entries,
             sc.conditions AS conditions_json,
             sc.is_public AS condition_is_public
      FROM tournaments t
      JOIN user_schedules us ON t.id = us.tournament_id
      LEFT JOIN schedule_conditions sc ON sc.tournament_id = t.id AND sc.user_id = us.user_id
      WHERE us.user_id = ?
      ORDER BY t.date, t.time
    `);
    schedStmt.bind([tokenRow.user_id]);
    const tournaments = [];
    while (schedStmt.step()) { tournaments.push(schedStmt.getAsObject()); }
    schedStmt.free();

    res.json({ username: tokenRow.username, avatar: tokenRow.avatar || null, tournaments });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Get current user's share token
app.get('/api/share-token', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare('SELECT token FROM share_tokens WHERE user_id = ?');
    stmt.bind([req.user.id]);
    let existing = null;
    if (stmt.step()) { existing = stmt.getAsObject(); }
    stmt.free();
    res.json({ token: existing ? existing.token : null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Generate share token
app.post('/api/share-token', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const stmt = db.prepare('SELECT token FROM share_tokens WHERE user_id = ?');
    stmt.bind([req.user.id]);
    let existing = null;
    if (stmt.step()) { existing = stmt.getAsObject(); }
    stmt.free();

    if (existing) { return res.json({ token: existing.token }); }

    const token = crypto.randomBytes(16).toString('hex');
    db.run('INSERT INTO share_tokens (user_id, token) VALUES (?, ?)', [req.user.id, token]);
    await saveDatabase();
    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Revoke share token
app.delete('/api/share-token', authenticateToken, requireRegistered, async (req, res) => {
  try {
    db.run('DELETE FROM share_tokens WHERE user_id = ?', [req.user.id]);
    await saveDatabase();
    res.json({ message: 'Share link revoked' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Get available game variants
app.get('/api/game-variants', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare("SELECT DISTINCT game_variant FROM tournaments WHERE venue != 'Personal' ORDER BY game_variant");
    
    const variants = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      variants.push(row.game_variant);
    }
    stmt.free();
    
    res.json(variants);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Get available venues
app.get('/api/venues', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare("SELECT DISTINCT venue FROM tournaments WHERE venue != 'Personal' ORDER BY venue");
    
    const venues = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      venues.push(row.venue);
    }
    stmt.free();
    
    res.json(venues);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Tournament field size (for POY calculation) ─────────────

app.put('/api/tournaments/:id/total-entries', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    const { totalEntries } = req.body;
    if (!totalEntries || totalEntries < 1) {
      return res.status(400).json({ error: 'totalEntries must be a positive integer' });
    }
    const checkStmt = db.prepare('SELECT id FROM tournaments WHERE id = ?');
    checkStmt.bind([id]);
    const exists = checkStmt.step();
    checkStmt.free();
    if (!exists) return res.status(404).json({ error: 'Tournament not found' });

    db.run('UPDATE tournaments SET total_entries = ? WHERE id = ?', [parseInt(totalEntries), id]);
    await saveDatabase();
    res.json({ message: 'Total entries updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Tracking endpoints ──────────────────────────────────────

app.get('/api/tracking', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT te.*,
             t.event_number, t.event_name, t.date, t.time, t.buyin,
             t.game_variant, t.venue, t.is_satellite, t.total_entries
      FROM tracking_entries te
      JOIN tournaments t ON te.tournament_id = t.id
      WHERE te.user_id = ?
      ORDER BY t.date DESC, t.time DESC
    `);
    stmt.bind([req.user.id]);
    const entries = [];
    while (stmt.step()) { entries.push(stmt.getAsObject()); }
    stmt.free();
    res.json(entries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/tracking', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { tournamentId, numEntries, cashed, finishPlace, cashAmount, notes } = req.body;
    const checkStmt = db.prepare('SELECT id FROM tournaments WHERE id = ?');
    checkStmt.bind([tournamentId]);
    const exists = checkStmt.step();
    checkStmt.free();
    if (!exists) return res.status(400).json({ error: 'Tournament not found' });

    // Upsert: update existing entry if one exists for this user+tournament
    const existStmt = db.prepare('SELECT id FROM tracking_entries WHERE user_id = ? AND tournament_id = ?');
    existStmt.bind([req.user.id, tournamentId]);
    const existing = existStmt.step() ? existStmt.getAsObject() : null;
    existStmt.free();

    if (existing) {
      db.run(
        'UPDATE tracking_entries SET num_entries = ?, cashed = ?, finish_place = ?, cash_amount = ?, notes = ? WHERE id = ? AND user_id = ?',
        [numEntries || 1, cashed ? 1 : 0, finishPlace || null, cashAmount || 0, notes || null, existing.id, req.user.id]
      );
      await saveDatabase();
      broadcastToBuddies(req.user.id, 'buddy-tracking', { buddyId: req.user.id, username: req.user.username, tournamentId });
      res.json({ message: 'Entry updated' });
    } else {
      db.run(
        'INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, finish_place, cash_amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.user.id, tournamentId, numEntries || 1, cashed ? 1 : 0, finishPlace || null, cashAmount || 0, notes || null]
      );
      await saveDatabase();
      broadcastToBuddies(req.user.id, 'buddy-tracking', { buddyId: req.user.id, username: req.user.username, tournamentId });
      res.status(201).json({ message: 'Entry tracked' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.put('/api/tracking/:entryId', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { entryId } = req.params;
    const { numEntries, cashed, finishPlace, cashAmount, notes } = req.body;
    const checkStmt = db.prepare('SELECT id FROM tracking_entries WHERE id = ? AND user_id = ?');
    checkStmt.bind([entryId, req.user.id]);
    const owns = checkStmt.step();
    checkStmt.free();
    if (!owns) return res.status(404).json({ error: 'Entry not found' });

    db.run(
      'UPDATE tracking_entries SET num_entries = ?, cashed = ?, finish_place = ?, cash_amount = ?, notes = ? WHERE id = ? AND user_id = ?',
      [numEntries || 1, cashed ? 1 : 0, finishPlace || null, cashAmount || 0, notes || null, entryId, req.user.id]
    );
    await saveDatabase();
    res.json({ message: 'Entry updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/tracking/:entryId', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { entryId } = req.params;
    db.run('DELETE FROM tracking_entries WHERE id = ? AND user_id = ?', [entryId, req.user.id]);
    await saveDatabase();
    res.json({ message: 'Entry removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Live Updates ──────────────────────────────────────────

app.post('/api/live-update', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { tournamentId, stack, sb, bb, bbAnte, isRegClosed, bubble, isItm, lockedAmount, isFinalTable, placesLeft, firstPlacePrize, isDeal, dealPlace, dealPayout, isBusted, totalEntries, isBagged, bagDay, playStartedAt } = req.body;
    if (!tournamentId) return res.status(400).json({ error: 'Tournament is required' });
    if (!isBusted && (!stack || stack < 0)) return res.status(400).json({ error: 'Stack is required' });

    const checkStmt = db.prepare('SELECT id FROM tournaments WHERE id = ?');
    checkStmt.bind([tournamentId]);
    const exists = checkStmt.step();
    checkStmt.free();
    if (!exists) return res.status(400).json({ error: 'Tournament not found' });

    const schedCheck = db.prepare('SELECT id FROM user_schedules WHERE user_id = ? AND tournament_id = ?');
    schedCheck.bind([req.user.id, tournamentId]);
    const inSchedule = schedCheck.step();
    schedCheck.free();
    if (!inSchedule) return res.status(400).json({ error: 'Tournament not in your schedule' });

    db.run(
      `INSERT INTO live_updates (user_id, tournament_id, update_text, stack, sb, bb, bb_ante, is_reg_closed, bubble, is_itm, locked_amount, is_final_table, places_left, first_place_prize, is_deal, deal_place, deal_payout, is_busted, total_entries, is_bagged, bag_day, play_started_at)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, tournamentId,
       Math.round(Number(stack)) || 0,
       sb ? Math.round(Number(sb)) : null,
       bb ? Math.round(Number(bb)) : null,
       bbAnte ? Math.round(Number(bbAnte)) : null,
       isRegClosed ? 1 : 0,
       isRegClosed && !isItm && bubble ? Math.round(Number(bubble)) : null,
       isItm ? 1 : 0,
       isItm && lockedAmount ? Math.round(Number(lockedAmount)) : null,
       isFinalTable ? 1 : 0,
       isFinalTable && placesLeft ? Math.round(Number(placesLeft)) : null,
       isFinalTable && firstPlacePrize ? Math.round(Number(firstPlacePrize)) : null,
       isDeal ? 1 : 0,
       isDeal && dealPlace ? Math.round(Number(dealPlace)) : null,
       isDeal && dealPayout ? Math.round(Number(dealPayout)) : null,
       isBusted ? 1 : 0,
       totalEntries ? Math.round(Number(totalEntries)) : null,
       isBagged ? 1 : 0,
       isBagged && bagDay ? Math.round(Number(bagDay)) : null,
       playStartedAt || null]
    );
    await saveDatabase();

    // SSE: broadcast to buddies
    const tStmt = db.prepare('SELECT event_name, venue FROM tournaments WHERE id = ?');
    tStmt.bind([tournamentId]);
    const tInfo = tStmt.step() ? tStmt.getAsObject() : {};
    tStmt.free();
    broadcastToBuddies(req.user.id, 'buddy-live-update', {
      buddyId: req.user.id,
      username: req.user.username,
      tournamentId,
      eventName: tInfo.event_name || null,
      venue: tInfo.venue || null,
      stack: Math.round(Number(stack)) || 0,
      sb: sb ? Math.round(Number(sb)) : null,
      bb: bb ? Math.round(Number(bb)) : null,
      bbAnte: bbAnte ? Math.round(Number(bbAnte)) : null,
      isItm: !!isItm, isRegClosed: !!isRegClosed,
      bubble: isRegClosed && !isItm && bubble ? Math.round(Number(bubble)) : null,
      lockedAmount: isItm && lockedAmount ? Math.round(Number(lockedAmount)) : null,
      isFinalTable: !!isFinalTable,
      placesLeft: isFinalTable && placesLeft ? Math.round(Number(placesLeft)) : null,
      firstPlacePrize: isFinalTable && firstPlacePrize ? Math.round(Number(firstPlacePrize)) : null,
      isDeal: !!isDeal,
      dealPlace: isDeal && dealPlace ? Math.round(Number(dealPlace)) : null,
      dealPayout: isDeal && dealPayout ? Math.round(Number(dealPayout)) : null,
      isBusted: !!isBusted,
      totalEntries: totalEntries ? Math.round(Number(totalEntries)) : null,
      isBagged: !!isBagged,
      bagDay: isBagged && bagDay ? Math.round(Number(bagDay)) : null,
      playStartedAt: playStartedAt || null,
      updatedAt: new Date().toISOString()
    });

    // SSE: broadcast to user's groups
    const userGroups = getUserGroupIds(req.user.id);
    for (const gid of userGroups) {
      broadcastToGroup(gid, 'group-live-update', {
        groupId: gid,
        userId: req.user.id,
        username: req.user.username,
        tournamentId,
        eventName: tInfo.event_name || null,
        venue: tInfo.venue || null,
        stack: Math.round(Number(stack)) || 0,
        isItm: !!isItm, isBusted: !!isBusted, isBagged: !!isBagged,
        isFinalTable: !!isFinalTable,
        updatedAt: new Date().toISOString()
      }, req.user.id);
    }

    res.status(201).json({ message: 'Update posted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.get('/api/live-update/mine', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT lu.id, lu.tournament_id, lu.stack, lu.sb, lu.bb, lu.bb_ante,
             lu.is_reg_closed, lu.bubble, lu.is_itm, lu.locked_amount,
             lu.is_final_table, lu.places_left, lu.first_place_prize,
             lu.is_deal, lu.deal_place, lu.deal_payout, lu.is_busted,
             lu.total_entries, lu.is_bagged, lu.bag_day, lu.play_started_at,
             lu.update_text, lu.created_at,
             t.event_name, t.venue
      FROM live_updates lu
      JOIN tournaments t ON lu.tournament_id = t.id
      WHERE lu.user_id = ?
      ORDER BY lu.created_at DESC LIMIT 1
    `);
    stmt.bind([req.user.id]);
    let result = null;
    if (stmt.step()) result = stmt.getAsObject();
    stmt.free();
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.get('/api/live-updates/active', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT lu.id, lu.tournament_id, lu.stack, lu.sb, lu.bb, lu.bb_ante,
             lu.is_reg_closed, lu.bubble, lu.is_itm, lu.locked_amount,
             lu.is_final_table, lu.places_left, lu.first_place_prize,
             lu.is_deal, lu.deal_place, lu.deal_payout, lu.is_busted,
             lu.total_entries, lu.is_bagged, lu.bag_day, lu.play_started_at,
             lu.created_at, t.event_name, t.venue, t.date,
             (SELECT COUNT(*) FROM live_updates b WHERE b.user_id = lu.user_id AND b.tournament_id = lu.tournament_id AND b.is_busted = 1) AS bust_count
      FROM live_updates lu
      JOIN tournaments t ON lu.tournament_id = t.id
      WHERE lu.user_id = ?
        AND lu.id IN (
          SELECT MAX(id) FROM live_updates WHERE user_id = ? GROUP BY tournament_id
        )
      ORDER BY lu.created_at DESC
    `);
    stmt.bind([req.user.id, req.user.id]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.delete('/api/live-update/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    db.run('DELETE FROM live_updates WHERE id = ? AND user_id = ?', [id, req.user.id]);
    await saveDatabase();
    broadcastToBuddies(req.user.id, 'buddy-live-update', {
      buddyId: req.user.id, username: req.user.username, cleared: true
    });

    // SSE: broadcast to user's groups
    const userGroups = getUserGroupIds(req.user.id);
    for (const gid of userGroups) {
      broadcastToGroup(gid, 'group-live-update', {
        groupId: gid, userId: req.user.id, username: req.user.username, cleared: true
      }, req.user.id);
    }

    res.json({ message: 'Update removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Fetch all update history for a tournament (for stack graph overlay)
app.get('/api/live-updates/history/:tournamentId', authenticateToken, (req, res) => {
  try {
    const tournamentId = Number(req.params.tournamentId);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament ID' });

    const stmt = db.prepare(`
      SELECT stack, sb, bb, bb_ante, total_entries, places_left,
             is_itm, is_final_table, is_busted, created_at
      FROM live_updates
      WHERE user_id = ? AND tournament_id = ?
      ORDER BY created_at ASC
    `);
    stmt.bind([req.user.id, tournamentId]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ── Play Time Tracking ───────────────────────────────────────

app.get('/api/playtime/:tournamentId', authenticateToken, (req, res) => {
  try {
    const tournamentId = Number(req.params.tournamentId);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament ID' });

    // Get all updates for this user+tournament ordered by time
    const stmt = db.prepare(`
      SELECT play_started_at, is_bagged, is_busted, created_at
      FROM live_updates
      WHERE user_id = ? AND tournament_id = ?
      ORDER BY created_at ASC
    `);
    stmt.bind([req.user.id, tournamentId]);
    const updates = [];
    while (stmt.step()) updates.push(stmt.getAsObject());
    stmt.free();

    // Build sessions: a session starts when play_started_at is set,
    // ends when a bagged or busted update follows
    const sessions = [];
    let activeStart = null;

    for (const u of updates) {
      if (u.play_started_at && !activeStart) {
        activeStart = u.play_started_at;
      }
      if (activeStart && (u.is_bagged || u.is_busted)) {
        const startMs = new Date(activeStart).getTime();
        const endMs = new Date(u.created_at).getTime();
        const minutes = Math.round((endMs - startMs) / 60000);
        sessions.push({ start: activeStart, end: u.created_at, minutes });
        activeStart = null;
      }
    }

    // If there's an active session (started but not bagged/busted yet)
    if (activeStart) {
      const startMs = new Date(activeStart).getTime();
      const nowMs = Date.now();
      const minutes = Math.round((nowMs - startMs) / 60000);
      sessions.push({ start: activeStart, end: null, minutes, active: true });
    }

    const totalMinutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
    res.json({ totalMinutes, sessions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ── Staking System ────────────────────────────────────────────

// GUESS: Proof images stored as base64 data URIs (same pattern as avatars), limited to 2MB
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  }
});

// Rate limiter for staking (slightly more generous than auth)
const stakingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many staking requests, please try again later.' },
});

// ── Validation: check total action sold for a tournament doesn't exceed 100% ──
// Returns { totalPct, agreements[] } for a given series + tournament buyin
// GUESS: "profit_share_only" type doesn't count toward the 100% action cap since no buy-in money is exchanged
// GUESS: "swap" and "crossbook" types count swap_my_pct / crossbook_my_pct toward action sold (player is giving away action)
function getActionSoldForTournament(seriesId, tournamentId, excludeAgreementId) {
  // Get tournament buyin to check buyin_range filters
  const tStmt = db.prepare('SELECT buyin FROM tournaments WHERE id = ?');
  tStmt.bind([tournamentId]);
  let buyin = 0;
  if (tStmt.step()) buyin = tStmt.getAsObject().buyin;
  tStmt.free();

  // Get all active agreements for this series
  const aStmt = db.prepare(
    'SELECT * FROM backer_agreements WHERE series_id = ? AND is_active = 1'
  );
  aStmt.bind([seriesId]);
  const agreements = [];
  while (aStmt.step()) agreements.push(aStmt.getAsObject());
  aStmt.free();

  let totalPct = 0;
  const applicable = [];

  for (const ag of agreements) {
    // Skip the agreement we're excluding (for update validation)
    if (excludeAgreementId && ag.id === excludeAgreementId) continue;

    // Check buyin range filter
    if (ag.buyin_range_min && buyin < ag.buyin_range_min) continue;
    if (ag.buyin_range_max && buyin > ag.buyin_range_max) continue;

    // Check event-level override (might be opted out)
    const ovStmt = db.prepare(
      'SELECT opt_out, override_percentage FROM backer_event_overrides WHERE agreement_id = ? AND tournament_id = ?'
    );
    ovStmt.bind([ag.id, tournamentId]);
    let override = null;
    if (ovStmt.step()) override = ovStmt.getAsObject();
    ovStmt.free();

    if (override && override.opt_out) continue; // Backer opted out of this event

    // Determine effective percentage
    let effectivePct = 0;
    if (ag.backer_type === 'profit_share_only') {
      // Profit share doesn't consume buy-in action
      continue;
    } else if (ag.backer_type === 'swap') {
      effectivePct = ag.swap_my_pct || 0;
    } else if (ag.backer_type === 'crossbook') {
      effectivePct = ag.crossbook_my_pct || 0;
    } else {
      effectivePct = override && override.override_percentage != null
        ? override.override_percentage
        : ag.percentage;
    }

    totalPct += effectivePct;
    applicable.push({ agreementId: ag.id, backerId: ag.backer_id, type: ag.backer_type, pct: effectivePct });
  }

  return { totalPct, agreements: applicable, buyin };
}

// ── Staking Series CRUD ──────────────────────────────────────

// List user's staking series
app.get('/api/staking/series', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM staking_series WHERE user_id = ? ORDER BY start_date DESC');
    stmt.bind([req.user.id]);
    const series = [];
    while (stmt.step()) series.push(stmt.getAsObject());
    stmt.free();
    res.json(series);
  } catch (error) {
    console.error('Staking series list error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Create staking series
app.post('/api/staking/series', authenticateToken, requireRegistered, stakingLimiter, async (req, res) => {
  try {
    const { name, venue, startDate, endDate, currency, currencyConversionMethod } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Series name is required' });
    }

    const validCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CNY', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'MXN', 'BRL'];
    const cur = currency || 'USD';
    if (!validCurrencies.includes(cur)) {
      return res.status(400).json({ error: 'Invalid currency' });
    }

    const validMethods = ['at_buyin', 'at_cash', 'at_settlement'];
    const method = currencyConversionMethod || 'at_cash';
    if (!validMethods.includes(method)) {
      return res.status(400).json({ error: 'Invalid currency conversion method' });
    }

    db.run(
      `INSERT INTO staking_series (user_id, name, venue, start_date, end_date, currency, currency_conversion_method)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, name.trim(), venue || null, startDate || null, endDate || null, cur, method]
    );

    const idStmt = db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const { id } = idStmt.getAsObject();
    idStmt.free();

    await saveDatabase();
    res.status(201).json({ message: 'Series created', id });
  } catch (error) {
    console.error('Create staking series error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Update staking series
app.put('/api/staking/series/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, venue, startDate, endDate, currency, currencyConversionMethod, status } = req.body;

    // Verify ownership
    const chk = db.prepare('SELECT id FROM staking_series WHERE id = ? AND user_id = ?');
    chk.bind([id, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Series not found' });

    const validStatuses = ['pre', 'active', 'settled'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    db.run(
      `UPDATE staking_series SET name = COALESCE(?, name), venue = COALESCE(?, venue),
       start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date),
       currency = COALESCE(?, currency), currency_conversion_method = COALESCE(?, currency_conversion_method),
       status = COALESCE(?, status) WHERE id = ? AND user_id = ?`,
      [name || null, venue || null, startDate || null, endDate || null,
       currency || null, currencyConversionMethod || null, status || null, id, req.user.id]
    );

    await saveDatabase();
    res.json({ message: 'Series updated' });
  } catch (error) {
    console.error('Update staking series error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Delete staking series (cascades: agreements, overrides, event status, settlements, tokens)
app.delete('/api/staking/series/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const chk = db.prepare('SELECT id FROM staking_series WHERE id = ? AND user_id = ?');
    chk.bind([id, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Series not found' });

    // GUESS: Cascade delete all related data when a series is deleted
    // Get all agreement IDs for this series
    const agStmt = db.prepare('SELECT id FROM backer_agreements WHERE series_id = ?');
    agStmt.bind([id]);
    const agIds = [];
    while (agStmt.step()) agIds.push(agStmt.getAsObject().id);
    agStmt.free();

    for (const agId of agIds) {
      db.run('DELETE FROM backer_tokens WHERE agreement_id = ?', [agId]);
      db.run('DELETE FROM backer_event_overrides WHERE agreement_id = ?', [agId]);
      db.run('DELETE FROM backer_event_status WHERE agreement_id = ?', [agId]);
    }
    db.run('DELETE FROM backer_agreements WHERE series_id = ?', [id]);
    db.run('DELETE FROM backer_settlements WHERE series_id = ?', [id]);
    db.run('DELETE FROM staking_series WHERE id = ? AND user_id = ?', [id, req.user.id]);

    await saveDatabase();
    res.json({ message: 'Series deleted' });
  } catch (error) {
    console.error('Delete staking series error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Backers CRUD ─────────────────────────────────────────────

// List user's backers
app.get('/api/staking/backers', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare(
      `SELECT b.*, u.username AS app_username
       FROM backers b
       LEFT JOIN users u ON b.app_user_id = u.id
       WHERE b.user_id = ?
       ORDER BY b.name`
    );
    stmt.bind([req.user.id]);
    const backers = [];
    while (stmt.step()) backers.push(stmt.getAsObject());
    stmt.free();
    res.json(backers);
  } catch (error) {
    console.error('List backers error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Create backer profile
app.post('/api/staking/backers', authenticateToken, requireRegistered, stakingLimiter, async (req, res) => {
  try {
    const { name, email, phone, notes, appUsername } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Backer name is required' });
    }

    // GUESS: If appUsername is provided, look up the user to link them
    let appUserId = null;
    if (appUsername) {
      const uStmt = db.prepare('SELECT id FROM users WHERE username = ?');
      uStmt.bind([appUsername]);
      if (uStmt.step()) appUserId = uStmt.getAsObject().id;
      uStmt.free();
      if (!appUserId) {
        return res.status(404).json({ error: `App user "${appUsername}" not found` });
      }
    }

    db.run(
      'INSERT INTO backers (user_id, name, email, phone, notes, app_user_id) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, name.trim(), email || null, phone || null, notes || null, appUserId]
    );

    const idStmt = db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const { id } = idStmt.getAsObject();
    idStmt.free();

    await saveDatabase();
    res.status(201).json({ message: 'Backer created', id });
  } catch (error) {
    console.error('Create backer error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Update backer profile
app.put('/api/staking/backers/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, notes, appUsername } = req.body;

    const chk = db.prepare('SELECT id FROM backers WHERE id = ? AND user_id = ?');
    chk.bind([id, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Backer not found' });

    let appUserId = undefined; // undefined = don't update
    if (appUsername !== undefined) {
      if (appUsername) {
        const uStmt = db.prepare('SELECT id FROM users WHERE username = ?');
        uStmt.bind([appUsername]);
        if (uStmt.step()) appUserId = uStmt.getAsObject().id;
        uStmt.free();
        if (!appUserId) return res.status(404).json({ error: `App user "${appUsername}" not found` });
      } else {
        appUserId = null; // Explicitly unlink
      }
    }

    db.run(
      `UPDATE backers SET name = COALESCE(?, name), email = COALESCE(?, email),
       phone = COALESCE(?, phone), notes = COALESCE(?, notes)
       ${appUserId !== undefined ? ', app_user_id = ?' : ''}
       WHERE id = ? AND user_id = ?`,
      appUserId !== undefined
        ? [name || null, email || null, phone || null, notes || null, appUserId, id, req.user.id]
        : [name || null, email || null, phone || null, notes || null, id, req.user.id]
    );

    await saveDatabase();
    res.json({ message: 'Backer updated' });
  } catch (error) {
    console.error('Update backer error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Delete backer profile
// GUESS: Prevent deletion if backer has active agreements (require user to remove agreements first)
app.delete('/api/staking/backers/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;

    const chk = db.prepare('SELECT id FROM backers WHERE id = ? AND user_id = ?');
    chk.bind([id, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Backer not found' });

    // Check for active agreements
    const agChk = db.prepare('SELECT COUNT(*) as cnt FROM backer_agreements WHERE backer_id = ? AND is_active = 1');
    agChk.bind([id]);
    agChk.step();
    const { cnt } = agChk.getAsObject();
    agChk.free();
    if (cnt > 0) {
      return res.status(400).json({ error: 'Cannot delete backer with active agreements. Deactivate agreements first.' });
    }

    db.run('DELETE FROM backers WHERE id = ? AND user_id = ?', [id, req.user.id]);
    await saveDatabase();
    res.json({ message: 'Backer deleted' });
  } catch (error) {
    console.error('Delete backer error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Agreements CRUD ──────────────────────────────────────────

const VALID_BACKER_TYPES = [
  'pay_per_play', 'open_commitment', 'budget_capped', 'flat_package',
  'profit_share_only', 'makeup', 'tiered_markup', 'swap', 'crossbook'
];

// List agreements for a series
app.get('/api/staking/series/:seriesId/agreements', authenticateToken, (req, res) => {
  try {
    const { seriesId } = req.params;

    // Verify series ownership
    const sChk = db.prepare('SELECT id FROM staking_series WHERE id = ? AND user_id = ?');
    sChk.bind([seriesId, req.user.id]);
    const ownsSeries = sChk.step();
    sChk.free();
    if (!ownsSeries) return res.status(404).json({ error: 'Series not found' });

    const stmt = db.prepare(
      `SELECT ba.*, b.name AS backer_name, b.email AS backer_email,
              su.username AS swap_username, cu.username AS crossbook_username
       FROM backer_agreements ba
       JOIN backers b ON ba.backer_id = b.id
       LEFT JOIN users su ON ba.swap_user_id = su.id
       LEFT JOIN users cu ON ba.crossbook_user_id = cu.id
       WHERE ba.series_id = ?
       ORDER BY ba.created_at`
    );
    stmt.bind([seriesId]);
    const agreements = [];
    while (stmt.step()) agreements.push(stmt.getAsObject());
    stmt.free();
    res.json(agreements);
  } catch (error) {
    console.error('List agreements error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Create agreement (with validation)
app.post('/api/staking/series/:seriesId/agreements', authenticateToken, requireRegistered, stakingLimiter, async (req, res) => {
  try {
    const { seriesId } = req.params;
    const {
      backerId, backerType, percentage, markup,
      swapUsername, swapMyPct, swapTheirPct,
      crossbookUsername, crossbookMyPct, crossbookTheirPct,
      budgetCap, makeupBalance, tieredRules,
      buyinRangeMin, buyinRangeMax,
      scope, startDate, endDate, variantFilter, buyinMin, buyinMax
    } = req.body;

    // Verify series ownership
    const sChk = db.prepare('SELECT id FROM staking_series WHERE id = ? AND user_id = ?');
    sChk.bind([seriesId, req.user.id]);
    const ownsSeries = sChk.step();
    sChk.free();
    if (!ownsSeries) return res.status(404).json({ error: 'Series not found' });

    // Verify backer ownership
    const bChk = db.prepare('SELECT id FROM backers WHERE id = ? AND user_id = ?');
    bChk.bind([backerId, req.user.id]);
    const ownsBacker = bChk.step();
    bChk.free();
    if (!ownsBacker) return res.status(404).json({ error: 'Backer not found' });

    // Validate backer type
    if (!VALID_BACKER_TYPES.includes(backerType)) {
      return res.status(400).json({ error: `Invalid backer type. Must be one of: ${VALID_BACKER_TYPES.join(', ')}` });
    }

    // Type-specific validation
    const pct = parseFloat(percentage) || 0;
    const mkp = parseFloat(markup) || 1.0;

    if (backerType !== 'swap' && backerType !== 'crossbook' && backerType !== 'profit_share_only') {
      if (pct <= 0 || pct > 100) {
        return res.status(400).json({ error: 'Percentage must be between 0 and 100' });
      }
    }

    if (mkp < 1.0) {
      return res.status(400).json({ error: 'Markup must be >= 1.0 (1.0 = no markup)' });
    }

    // Resolve swap/crossbook users
    let swapUserId = null;
    if (backerType === 'swap' && swapUsername) {
      const uStmt = db.prepare('SELECT id FROM users WHERE username = ?');
      uStmt.bind([swapUsername]);
      if (uStmt.step()) swapUserId = uStmt.getAsObject().id;
      uStmt.free();
      if (!swapUserId) return res.status(404).json({ error: `Swap user "${swapUsername}" not found` });
    }

    let crossbookUserId = null;
    if (backerType === 'crossbook' && crossbookUsername) {
      const uStmt = db.prepare('SELECT id FROM users WHERE username = ?');
      uStmt.bind([crossbookUsername]);
      if (uStmt.step()) crossbookUserId = uStmt.getAsObject().id;
      uStmt.free();
      if (!crossbookUserId) return res.status(404).json({ error: `Crossbook user "${crossbookUsername}" not found` });
    }

    // Swap-specific validation
    if (backerType === 'swap') {
      const mySwapPct = parseFloat(swapMyPct) || 0;
      const theirSwapPct = parseFloat(swapTheirPct) || 0;
      if (mySwapPct <= 0 || mySwapPct > 100) return res.status(400).json({ error: 'Swap: your percentage must be 1-100' });
      if (theirSwapPct <= 0 || theirSwapPct > 100) return res.status(400).json({ error: 'Swap: their percentage must be 1-100' });
    }

    // Crossbook-specific validation
    if (backerType === 'crossbook') {
      const myCbPct = parseFloat(crossbookMyPct) || 50;
      const theirCbPct = parseFloat(crossbookTheirPct) || 50;
      if (myCbPct <= 0 || myCbPct > 100) return res.status(400).json({ error: 'Crossbook: your percentage must be 1-100' });
      if (theirCbPct <= 0 || theirCbPct > 100) return res.status(400).json({ error: 'Crossbook: their percentage must be 1-100' });
    }

    // Tiered-specific validation
    let tieredRulesJson = null;
    if (backerType === 'tiered_markup') {
      if (!tieredRules || !Array.isArray(tieredRules) || tieredRules.length === 0) {
        return res.status(400).json({ error: 'Tiered markup requires at least one tier rule' });
      }
      for (const rule of tieredRules) {
        if (typeof rule.minBuyin !== 'number' || typeof rule.maxBuyin !== 'number' || typeof rule.markup !== 'number') {
          return res.status(400).json({ error: 'Each tiered rule must have minBuyin, maxBuyin, and markup (numbers)' });
        }
      }
      tieredRulesJson = JSON.stringify(tieredRules);
    }

    // Budget cap validation
    if (backerType === 'budget_capped' && (!budgetCap || budgetCap <= 0)) {
      return res.status(400).json({ error: 'Budget-capped type requires a positive budget_cap amount' });
    }

    db.run(
      `INSERT INTO backer_agreements (
        series_id, backer_id, backer_type, percentage, markup,
        swap_user_id, swap_my_pct, swap_their_pct,
        crossbook_user_id, crossbook_my_pct, crossbook_their_pct,
        budget_cap, makeup_balance, tiered_rules,
        buyin_range_min, buyin_range_max,
        scope, start_date, end_date, variant_filter, buyin_min, buyin_max
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        seriesId, backerId, backerType, pct, mkp,
        swapUserId, backerType === 'swap' ? (parseFloat(swapMyPct) || 0) : null,
        backerType === 'swap' ? (parseFloat(swapTheirPct) || 0) : null,
        crossbookUserId, backerType === 'crossbook' ? (parseFloat(crossbookMyPct) || 50) : null,
        backerType === 'crossbook' ? (parseFloat(crossbookTheirPct) || 50) : null,
        backerType === 'budget_capped' ? budgetCap : null,
        backerType === 'makeup' ? (parseFloat(makeupBalance) || 0) : 0,
        tieredRulesJson,
        buyinRangeMin || null, buyinRangeMax || null,
        scope || 'series', startDate || null, endDate || null,
        variantFilter ? JSON.stringify(variantFilter) : null,
        buyinMin || null, buyinMax || null
      ]
    );

    const idStmt = db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const { id } = idStmt.getAsObject();
    idStmt.free();

    await saveDatabase();
    res.status(201).json({ message: 'Agreement created', id });
  } catch (error) {
    console.error('Create agreement error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Update agreement
app.put('/api/staking/agreements/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      percentage, markup, backerType,
      swapMyPct, swapTheirPct, crossbookMyPct, crossbookTheirPct,
      budgetCap, makeupBalance, tieredRules,
      buyinRangeMin, buyinRangeMax, isActive,
      scope, startDate, endDate, variantFilter, buyinMin, buyinMax
    } = req.body;

    // Verify ownership through series
    const chk = db.prepare(
      `SELECT ba.id FROM backer_agreements ba
       JOIN staking_series ss ON ba.series_id = ss.id
       WHERE ba.id = ? AND ss.user_id = ?`
    );
    chk.bind([id, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Agreement not found' });

    // Build dynamic update
    const fields = [];
    const params = [];

    if (percentage !== undefined) { fields.push('percentage = ?'); params.push(parseFloat(percentage)); }
    if (markup !== undefined) { fields.push('markup = ?'); params.push(parseFloat(markup)); }
    if (backerType !== undefined) {
      if (!VALID_BACKER_TYPES.includes(backerType)) {
        return res.status(400).json({ error: 'Invalid backer type' });
      }
      fields.push('backer_type = ?'); params.push(backerType);
    }
    if (swapMyPct !== undefined) { fields.push('swap_my_pct = ?'); params.push(parseFloat(swapMyPct)); }
    if (swapTheirPct !== undefined) { fields.push('swap_their_pct = ?'); params.push(parseFloat(swapTheirPct)); }
    if (crossbookMyPct !== undefined) { fields.push('crossbook_my_pct = ?'); params.push(parseFloat(crossbookMyPct)); }
    if (crossbookTheirPct !== undefined) { fields.push('crossbook_their_pct = ?'); params.push(parseFloat(crossbookTheirPct)); }
    if (budgetCap !== undefined) { fields.push('budget_cap = ?'); params.push(budgetCap); }
    if (makeupBalance !== undefined) { fields.push('makeup_balance = ?'); params.push(parseFloat(makeupBalance)); }
    if (tieredRules !== undefined) { fields.push('tiered_rules = ?'); params.push(JSON.stringify(tieredRules)); }
    if (buyinRangeMin !== undefined) { fields.push('buyin_range_min = ?'); params.push(buyinRangeMin); }
    if (buyinRangeMax !== undefined) { fields.push('buyin_range_max = ?'); params.push(buyinRangeMax); }
    if (isActive !== undefined) { fields.push('is_active = ?'); params.push(isActive ? 1 : 0); }
    if (scope !== undefined) { fields.push('scope = ?'); params.push(scope); }
    if (startDate !== undefined) { fields.push('start_date = ?'); params.push(startDate || null); }
    if (endDate !== undefined) { fields.push('end_date = ?'); params.push(endDate || null); }
    if (variantFilter !== undefined) { fields.push('variant_filter = ?'); params.push(variantFilter ? JSON.stringify(variantFilter) : null); }
    if (buyinMin !== undefined) { fields.push('buyin_min = ?'); params.push(buyinMin || null); }
    if (buyinMax !== undefined) { fields.push('buyin_max = ?'); params.push(buyinMax || null); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    db.run(`UPDATE backer_agreements SET ${fields.join(', ')} WHERE id = ?`, params);

    await saveDatabase();
    res.json({ message: 'Agreement updated' });
  } catch (error) {
    console.error('Update agreement error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Delete agreement (cascades overrides, event status, tokens)
app.delete('/api/staking/agreements/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;

    const chk = db.prepare(
      `SELECT ba.id FROM backer_agreements ba
       JOIN staking_series ss ON ba.series_id = ss.id
       WHERE ba.id = ? AND ss.user_id = ?`
    );
    chk.bind([id, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Agreement not found' });

    db.run('DELETE FROM backer_tokens WHERE agreement_id = ?', [id]);
    db.run('DELETE FROM backer_event_overrides WHERE agreement_id = ?', [id]);
    db.run('DELETE FROM backer_event_status WHERE agreement_id = ?', [id]);
    db.run('DELETE FROM backer_agreements WHERE id = ?', [id]);

    await saveDatabase();
    res.json({ message: 'Agreement deleted' });
  } catch (error) {
    console.error('Delete agreement error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Validate agreement — check if it would conflict with existing action
app.get('/api/staking/agreements/:id/validate', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;

    // Get the agreement
    const agStmt = db.prepare(
      `SELECT ba.*, ss.user_id FROM backer_agreements ba
       JOIN staking_series ss ON ba.series_id = ss.id
       WHERE ba.id = ? AND ss.user_id = ?`
    );
    agStmt.bind([id, req.user.id]);
    let agreement = null;
    if (agStmt.step()) agreement = agStmt.getAsObject();
    agStmt.free();
    if (!agreement) return res.status(404).json({ error: 'Agreement not found' });

    // Get all tournaments on the user's schedule within buyin range
    let tQuery = `SELECT t.id, t.event_name, t.buyin FROM tournaments t
                  JOIN user_schedules us ON t.id = us.tournament_id
                  WHERE us.user_id = ? AND t.venue != 'Personal'`;
    const tParams = [req.user.id];

    if (agreement.buyin_range_min) { tQuery += ' AND t.buyin >= ?'; tParams.push(agreement.buyin_range_min); }
    if (agreement.buyin_range_max) { tQuery += ' AND t.buyin <= ?'; tParams.push(agreement.buyin_range_max); }

    const tStmt = db.prepare(tQuery);
    tStmt.bind(tParams);
    const conflicts = [];
    while (tStmt.step()) {
      const t = tStmt.getAsObject();
      const action = getActionSoldForTournament(agreement.series_id, t.id, null);
      if (action.totalPct > 100) {
        conflicts.push({
          tournamentId: t.id,
          eventName: t.event_name,
          buyin: t.buyin,
          totalPct: action.totalPct,
          agreements: action.agreements
        });
      }
    }
    tStmt.free();

    res.json({
      valid: conflicts.length === 0,
      conflicts
    });
  } catch (error) {
    console.error('Validate agreement error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Event Status ─────────────────────────────────────────────

// Get event status across all backers for a series
app.get('/api/staking/series/:seriesId/events', authenticateToken, (req, res) => {
  try {
    const { seriesId } = req.params;

    const sChk = db.prepare('SELECT id FROM staking_series WHERE id = ? AND user_id = ?');
    sChk.bind([seriesId, req.user.id]);
    const ownsSeries = sChk.step();
    sChk.free();
    if (!ownsSeries) return res.status(404).json({ error: 'Series not found' });

    const stmt = db.prepare(
      `SELECT bes.*, ba.backer_type, ba.percentage, ba.markup,
              b.name AS backer_name,
              t.event_name, t.buyin, t.date, t.venue
       FROM backer_event_status bes
       JOIN backer_agreements ba ON bes.agreement_id = ba.id
       JOIN backers b ON ba.backer_id = b.id
       JOIN tournaments t ON bes.tournament_id = t.id
       WHERE ba.series_id = ?
       ORDER BY t.date, t.time, b.name`
    );
    stmt.bind([seriesId]);
    const events = [];
    while (stmt.step()) events.push(stmt.getAsObject());
    stmt.free();

    res.json(events);
  } catch (error) {
    console.error('List event status error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Update event status for a specific agreement + tournament
app.post('/api/staking/events/:agreementId/:tournamentId/status', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { agreementId, tournamentId } = req.params;
    const { bulletsUsed, buyinAmount, cashAmount, status, tipAmount, currencyRate } = req.body;

    // Verify ownership
    const chk = db.prepare(
      `SELECT ba.id FROM backer_agreements ba
       JOIN staking_series ss ON ba.series_id = ss.id
       WHERE ba.id = ? AND ss.user_id = ?`
    );
    chk.bind([agreementId, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Agreement not found' });

    // Verify tournament exists
    const tChk = db.prepare('SELECT id FROM tournaments WHERE id = ?');
    tChk.bind([tournamentId]);
    const tExists = tChk.step();
    tChk.free();
    if (!tExists) return res.status(404).json({ error: 'Tournament not found' });

    const validStatuses = ['pending', 'bought_in', 'playing', 'busted', 'cashed', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Upsert: check if record exists
    const existing = db.prepare(
      'SELECT id FROM backer_event_status WHERE agreement_id = ? AND tournament_id = ?'
    );
    existing.bind([agreementId, tournamentId]);
    const hasExisting = existing.step();
    let existingId = null;
    if (hasExisting) existingId = existing.getAsObject().id;
    existing.free();

    if (existingId) {
      // Update
      db.run(
        `UPDATE backer_event_status SET
         bullets_used = COALESCE(?, bullets_used),
         buyin_amount = COALESCE(?, buyin_amount),
         cash_amount = COALESCE(?, cash_amount),
         status = COALESCE(?, status),
         tip_amount = COALESCE(?, tip_amount),
         currency_rate = COALESCE(?, currency_rate)
         WHERE id = ?`,
        [bulletsUsed || null, buyinAmount || null, cashAmount || null,
         status || null, tipAmount !== undefined ? tipAmount : null,
         currencyRate || null, existingId]
      );
    } else {
      // Insert
      db.run(
        `INSERT INTO backer_event_status (agreement_id, tournament_id, bullets_used, buyin_amount, cash_amount, status, tip_amount, currency_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [agreementId, tournamentId,
         bulletsUsed || 1, buyinAmount || null, cashAmount || null,
         status || 'pending', tipAmount || 0, currencyRate || 1.0]
      );
    }

    await saveDatabase();
    res.json({ message: 'Event status updated' });
  } catch (error) {
    console.error('Update event status error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Upload proof image for event status
app.post('/api/staking/events/:agreementId/:tournamentId/proof', authenticateToken, requireRegistered, proofUpload.single('proof'), async (req, res) => {
  try {
    const { agreementId, tournamentId } = req.params;

    // Verify ownership
    const chk = db.prepare(
      `SELECT ba.id FROM backer_agreements ba
       JOIN staking_series ss ON ba.series_id = ss.id
       WHERE ba.id = ? AND ss.user_id = ?`
    );
    chk.bind([agreementId, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Agreement not found' });

    if (!req.file) return res.status(400).json({ error: 'No image provided' });

    const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    // Check if status record exists — if not, create one
    const existing = db.prepare(
      'SELECT id FROM backer_event_status WHERE agreement_id = ? AND tournament_id = ?'
    );
    existing.bind([agreementId, tournamentId]);
    const hasExisting = existing.step();
    existing.free();

    if (hasExisting) {
      db.run(
        'UPDATE backer_event_status SET proof_image = ? WHERE agreement_id = ? AND tournament_id = ?',
        [dataUri, agreementId, tournamentId]
      );
    } else {
      db.run(
        `INSERT INTO backer_event_status (agreement_id, tournament_id, proof_image, status)
         VALUES (?, ?, ?, 'pending')`,
        [agreementId, tournamentId, dataUri]
      );
    }

    await saveDatabase();
    res.json({ message: 'Proof uploaded' });
  } catch (error) {
    console.error('Upload proof error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Settlement ───────────────────────────────────────────────

// Auto-generate settlement sheet for a series
app.get('/api/staking/series/:seriesId/settlement', authenticateToken, (req, res) => {
  try {
    const { seriesId } = req.params;

    const sChk = db.prepare('SELECT * FROM staking_series WHERE id = ? AND user_id = ?');
    sChk.bind([seriesId, req.user.id]);
    let series = null;
    if (sChk.step()) series = sChk.getAsObject();
    sChk.free();
    if (!series) return res.status(404).json({ error: 'Series not found' });

    // Get all agreements for this series
    const agStmt = db.prepare(
      `SELECT ba.*, b.name AS backer_name, b.email AS backer_email
       FROM backer_agreements ba
       JOIN backers b ON ba.backer_id = b.id
       WHERE ba.series_id = ?`
    );
    agStmt.bind([seriesId]);
    const agreements = [];
    while (agStmt.step()) agreements.push(agStmt.getAsObject());
    agStmt.free();

    // Get all event statuses for this series
    const esStmt = db.prepare(
      `SELECT bes.*, t.buyin, t.event_name, t.date
       FROM backer_event_status bes
       JOIN backer_agreements ba ON bes.agreement_id = ba.id
       JOIN tournaments t ON bes.tournament_id = t.id
       WHERE ba.series_id = ?`
    );
    esStmt.bind([seriesId]);
    const allEventStatuses = [];
    while (esStmt.step()) allEventStatuses.push(esStmt.getAsObject());
    esStmt.free();

    // Get event overrides
    const ovStmt = db.prepare(
      `SELECT beo.* FROM backer_event_overrides beo
       JOIN backer_agreements ba ON beo.agreement_id = ba.id
       WHERE ba.series_id = ?`
    );
    ovStmt.bind([seriesId]);
    const overrides = [];
    while (ovStmt.step()) overrides.push(ovStmt.getAsObject());
    ovStmt.free();

    // Build override lookup: agreementId:tournamentId -> override
    const overrideMap = {};
    for (const ov of overrides) {
      overrideMap[`${ov.agreement_id}:${ov.tournament_id}`] = ov;
    }

    // Calculate settlement for each backer
    const settlements = [];

    for (const ag of agreements) {
      // Get event statuses for this agreement
      const agEvents = allEventStatuses.filter(es => es.agreement_id === ag.id);

      let grossInvestment = 0;  // Total buy-in money the backer is responsible for
      let grossReturn = 0;      // Total cash-out the backer gets back
      let markupAmount = 0;     // Total markup charged
      const eventDetails = [];

      for (const ev of agEvents) {
        if (ev.status === 'cancelled') continue; // Cancelled = refunded, no backer impact

        // Get effective percentage and markup for this event
        const ovKey = `${ag.id}:${ev.tournament_id}`;
        const override = overrideMap[ovKey];

        if (override && override.opt_out) continue; // Opted out

        let effectivePct, effectiveMarkup;

        if (ag.backer_type === 'swap') {
          // Swap: backer's "investment" is their results on the swap partner's events
          // Settlement handled differently — tracked as swap_my_pct of player's results
          effectivePct = ag.swap_my_pct || 0;
          effectiveMarkup = 1.0; // No markup on swaps
        } else if (ag.backer_type === 'crossbook') {
          effectivePct = ag.crossbook_my_pct || 50;
          effectiveMarkup = 1.0;
        } else if (ag.backer_type === 'tiered_markup' && ag.tiered_rules) {
          effectivePct = override && override.override_percentage != null ? override.override_percentage : ag.percentage;
          // Find matching tier for this buyin
          const tiers = JSON.parse(ag.tiered_rules);
          const buyinForEvent = ev.buyin_amount || ev.buyin || 0;
          const matchedTier = tiers.find(t => buyinForEvent >= t.minBuyin && buyinForEvent <= t.maxBuyin);
          effectiveMarkup = matchedTier ? matchedTier.markup : ag.markup;
        } else if (ag.backer_type === 'profit_share_only') {
          // No investment — only share of net profits
          effectivePct = override && override.override_percentage != null ? override.override_percentage : ag.percentage;
          effectiveMarkup = 1.0;
        } else {
          effectivePct = override && override.override_percentage != null ? override.override_percentage : ag.percentage;
          effectiveMarkup = override && override.override_markup != null ? override.override_markup : ag.markup;
        }

        const pctFraction = effectivePct / 100;
        const buyinCost = (ev.buyin_amount || ev.buyin || 0) * ev.bullets_used;
        const cashResult = ev.cash_amount || 0;
        const tipCost = ev.tip_amount || 0;
        const rate = ev.currency_rate || 1.0;

        // Convert to series currency if needed
        const buyinConverted = buyinCost * rate;
        const cashConverted = cashResult * rate;
        const tipConverted = tipCost * rate;

        if (ag.backer_type === 'profit_share_only') {
          // No buy-in share — only get cut of net profits
          const netResult = cashConverted - buyinConverted - tipConverted;
          if (netResult > 0) {
            grossReturn += netResult * pctFraction;
          }
          // GUESS: Profit share backers don't owe anything on losses
        } else {
          // Standard: backer's share of buy-in (with markup) and their share of return
          const backerBuyinShare = buyinConverted * pctFraction * effectiveMarkup;
          const backerReturnShare = (cashConverted - tipConverted) * pctFraction;
          const backerMarkupPortion = buyinConverted * pctFraction * (effectiveMarkup - 1.0);

          grossInvestment += backerBuyinShare;
          grossReturn += backerReturnShare;
          markupAmount += backerMarkupPortion;
        }

        eventDetails.push({
          tournamentId: ev.tournament_id,
          eventName: ev.event_name,
          date: ev.date,
          bullets: ev.bullets_used,
          buyin: buyinConverted,
          cash: cashConverted,
          tip: tipConverted,
          pct: effectivePct,
          markup: effectiveMarkup,
          status: ev.status
        });
      }

      // Net P&L from backer's perspective: what they got back minus what they put in
      let netPnl = grossReturn - grossInvestment;

      // For makeup/running account: apply existing makeup balance
      if (ag.backer_type === 'makeup') {
        // If prior makeup balance was negative (backer was owed), add it to net
        netPnl += (ag.makeup_balance || 0);
      }

      // Amount owed: positive = player owes backer, negative = backer owes player
      // GUESS: From player's perspective, if netPnl > 0 the backer profited so player owes them the return minus investment already provided
      const amountOwed = grossReturn - grossInvestment + markupAmount;
      // Simplified: amountOwed positive means player needs to send money to backer (backer had net gains after markup)
      // amountOwed negative means backer lost money (player keeps the difference — backer's risk)

      // GUESS: For budget-capped, cap the total investment at the budget cap
      let cappedInvestment = grossInvestment;
      if (ag.backer_type === 'budget_capped' && ag.budget_cap) {
        cappedInvestment = Math.min(grossInvestment, ag.budget_cap);
      }

      settlements.push({
        agreementId: ag.id,
        backerId: ag.backer_id,
        backerName: ag.backer_name,
        backerEmail: ag.backer_email,
        backerType: ag.backer_type,
        percentage: ag.percentage,
        markup: ag.markup,
        grossInvestment: ag.backer_type === 'budget_capped' ? cappedInvestment : grossInvestment,
        grossReturn,
        markupAmount,
        netPnl,
        amountOwed: ag.backer_type === 'budget_capped'
          ? grossReturn - cappedInvestment + (cappedInvestment - (grossInvestment - markupAmount)) // GUESS: Refund unused budget
          : amountOwed,
        newMakeupBalance: ag.backer_type === 'makeup' ? netPnl : null,
        events: eventDetails
      });
    }

    res.json({
      series,
      settlements,
      currency: series.currency,
      status: series.status
    });
  } catch (error) {
    console.error('Generate settlement error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Finalize settlement — create settlement records and update makeup balances
app.post('/api/staking/series/:seriesId/settle', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { seriesId } = req.params;
    const { settlements } = req.body; // Array of { backerId, amountOwed, notes }

    const sChk = db.prepare('SELECT id, status FROM staking_series WHERE id = ? AND user_id = ?');
    sChk.bind([seriesId, req.user.id]);
    let series = null;
    if (sChk.step()) series = sChk.getAsObject();
    sChk.free();
    if (!series) return res.status(404).json({ error: 'Series not found' });

    if (!settlements || !Array.isArray(settlements)) {
      return res.status(400).json({ error: 'Settlements array is required' });
    }

    // GUESS: Auto-generate settlement data by running the same calculation as GET, then persist
    // The client can pass overrides (e.g. adjusted amounts after negotiation)
    // But the base data comes from the server-side calculation

    // First, generate the settlement sheet
    const calcRes = { json: null };
    // Re-use the settlement calculation inline
    const agStmt = db.prepare(
      `SELECT ba.*, b.name AS backer_name FROM backer_agreements ba
       JOIN backers b ON ba.backer_id = b.id
       WHERE ba.series_id = ?`
    );
    agStmt.bind([seriesId]);
    const agreements = [];
    while (agStmt.step()) agreements.push(agStmt.getAsObject());
    agStmt.free();

    for (const settlementInput of settlements) {
      const { backerId, grossInvestment, grossReturn, markupAmount, netPnl, amountOwed, notes } = settlementInput;

      // Upsert settlement record
      const existChk = db.prepare(
        'SELECT id FROM backer_settlements WHERE series_id = ? AND backer_id = ?'
      );
      existChk.bind([seriesId, backerId]);
      const hasExisting = existChk.step();
      let existingId = null;
      if (hasExisting) existingId = existChk.getAsObject().id;
      existChk.free();

      if (existingId) {
        db.run(
          `UPDATE backer_settlements SET gross_investment = ?, gross_return = ?,
           markup_amount = ?, net_pnl = ?, amount_owed = ?, notes = ? WHERE id = ?`,
          [grossInvestment || 0, grossReturn || 0, markupAmount || 0,
           netPnl || 0, amountOwed || 0, notes || null, existingId]
        );
      } else {
        db.run(
          `INSERT INTO backer_settlements (series_id, backer_id, gross_investment, gross_return, markup_amount, net_pnl, amount_owed, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [seriesId, backerId, grossInvestment || 0, grossReturn || 0,
           markupAmount || 0, netPnl || 0, amountOwed || 0, notes || null]
        );
      }

      // Update makeup balance for makeup-type agreements
      const makeupAg = agreements.find(a => a.backer_id === backerId && a.backer_type === 'makeup');
      if (makeupAg) {
        db.run(
          'UPDATE backer_agreements SET makeup_balance = ? WHERE id = ?',
          [netPnl || 0, makeupAg.id]
        );
      }
    }

    // Mark series as settled
    db.run("UPDATE staking_series SET status = 'settled' WHERE id = ?", [seriesId]);

    await saveDatabase();
    res.json({ message: 'Settlement finalized', settledCount: settlements.length });
  } catch (error) {
    console.error('Finalize settlement error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Mark settlement as paid
app.put('/api/staking/settlements/:id/paid', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    const { isPaid } = req.body;

    // Verify ownership through series
    const chk = db.prepare(
      `SELECT bs.id FROM backer_settlements bs
       JOIN staking_series ss ON bs.series_id = ss.id
       WHERE bs.id = ? AND ss.user_id = ?`
    );
    chk.bind([id, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Settlement not found' });

    db.run(
      `UPDATE backer_settlements SET is_paid = ?, paid_at = ${isPaid !== false ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id = ?`,
      [isPaid !== false ? 1 : 0, id]
    );

    await saveDatabase();
    res.json({ message: isPaid !== false ? 'Marked as paid' : 'Marked as unpaid' });
  } catch (error) {
    console.error('Mark paid error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Backer Tokens (private shareable links) ──────────────────

// Generate private backer link
app.post('/api/staking/agreements/:id/token', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const chk = db.prepare(
      `SELECT ba.id FROM backer_agreements ba
       JOIN staking_series ss ON ba.series_id = ss.id
       WHERE ba.id = ? AND ss.user_id = ?`
    );
    chk.bind([id, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Agreement not found' });

    // Check for existing token
    const tokStmt = db.prepare('SELECT token FROM backer_tokens WHERE agreement_id = ?');
    tokStmt.bind([id]);
    let existingToken = null;
    if (tokStmt.step()) existingToken = tokStmt.getAsObject().token;
    tokStmt.free();

    if (existingToken) {
      return res.json({ token: existingToken });
    }

    const token = crypto.randomBytes(16).toString('hex');
    db.run('INSERT INTO backer_tokens (agreement_id, token) VALUES (?, ?)', [id, token]);

    await saveDatabase();
    res.json({ token });
  } catch (error) {
    console.error('Generate backer token error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// PUBLIC endpoint: backer's view via private token (no auth)
app.get('/api/backer/:token', (req, res) => {
  try {
    const { token } = req.params;

    // Look up token
    const tokStmt = db.prepare(
      `SELECT bt.agreement_id, ba.series_id, ba.backer_id, ba.backer_type,
              ba.percentage, ba.markup, ba.swap_my_pct, ba.swap_their_pct,
              ba.crossbook_my_pct, ba.crossbook_their_pct,
              ba.buyin_range_min, ba.buyin_range_max,
              b.name AS backer_name,
              ss.name AS series_name, ss.venue AS series_venue,
              ss.start_date, ss.end_date, ss.currency, ss.status AS series_status,
              u.username AS player_username
       FROM backer_tokens bt
       JOIN backer_agreements ba ON bt.agreement_id = ba.id
       JOIN backers b ON ba.backer_id = b.id
       JOIN staking_series ss ON ba.series_id = ss.id
       JOIN users u ON ss.user_id = u.id
       WHERE bt.token = ?`
    );
    tokStmt.bind([token]);
    let info = null;
    if (tokStmt.step()) info = tokStmt.getAsObject();
    tokStmt.free();

    if (!info) return res.status(404).json({ error: 'Invalid or expired backer link' });

    // Get event statuses for this agreement
    const esStmt = db.prepare(
      `SELECT bes.*, t.event_name, t.buyin, t.date, t.time, t.venue, t.game_variant,
              t.is_satellite, t.reentry
       FROM backer_event_status bes
       JOIN tournaments t ON bes.tournament_id = t.id
       WHERE bes.agreement_id = ?
       ORDER BY t.date, t.time`
    );
    esStmt.bind([info.agreement_id]);
    const events = [];
    while (esStmt.step()) {
      const ev = esStmt.getAsObject();
      events.push({
        tournamentId: ev.tournament_id,
        eventName: ev.event_name,
        buyin: ev.buyin,
        date: ev.date,
        time: ev.time,
        venue: ev.venue,
        gameVariant: ev.game_variant,
        isSatellite: ev.is_satellite,
        reentry: ev.reentry,
        bulletsUsed: ev.bullets_used,
        buyinAmount: ev.buyin_amount,
        cashAmount: ev.cash_amount,
        // GUESS: Show proof images on the backer's view so they can verify receipts
        proofImage: ev.proof_image,
        status: ev.status,
        tipAmount: ev.tip_amount,
        currencyRate: ev.currency_rate,
        createdAt: ev.created_at
      });
    }
    esStmt.free();

    // Get event overrides (opt-outs, adjusted percentages)
    const ovStmt = db.prepare(
      `SELECT beo.tournament_id, beo.override_percentage, beo.override_markup, beo.opt_out, beo.notes
       FROM backer_event_overrides beo
       WHERE beo.agreement_id = ?`
    );
    ovStmt.bind([info.agreement_id]);
    const overridesArr = [];
    while (ovStmt.step()) overridesArr.push(ovStmt.getAsObject());
    ovStmt.free();

    // Get settlement if exists
    const settStmt = db.prepare(
      'SELECT * FROM backer_settlements WHERE series_id = ? AND backer_id = ?'
    );
    settStmt.bind([info.series_id, info.backer_id]);
    let settlement = null;
    if (settStmt.step()) settlement = settStmt.getAsObject();
    settStmt.free();

    res.json({
      playerUsername: info.player_username,
      backerName: info.backer_name,
      series: {
        name: info.series_name,
        venue: info.series_venue,
        startDate: info.start_date,
        endDate: info.end_date,
        currency: info.currency,
        status: info.series_status
      },
      agreement: {
        type: info.backer_type,
        percentage: info.percentage,
        markup: info.markup,
        swapMyPct: info.swap_my_pct,
        swapTheirPct: info.swap_their_pct,
        crossbookMyPct: info.crossbook_my_pct,
        crossbookTheirPct: info.crossbook_their_pct,
        buyinRangeMin: info.buyin_range_min,
        buyinRangeMax: info.buyin_range_max
      },
      events,
      overrides: overridesArr,
      settlement
    });
  } catch (error) {
    console.error('Public backer view error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Action Validation Endpoint ───────────────────────────────

// Check total action sold for a specific tournament within a series
app.get('/api/staking/series/:seriesId/action-check/:tournamentId', authenticateToken, (req, res) => {
  try {
    const { seriesId, tournamentId } = req.params;

    // Verify series ownership
    const sChk = db.prepare('SELECT id FROM staking_series WHERE id = ? AND user_id = ?');
    sChk.bind([seriesId, req.user.id]);
    const ownsSeries = sChk.step();
    sChk.free();
    if (!ownsSeries) return res.status(404).json({ error: 'Series not found' });

    const result = getActionSoldForTournament(parseInt(seriesId), parseInt(tournamentId), null);

    res.json({
      tournamentId: parseInt(tournamentId),
      seriesId: parseInt(seriesId),
      totalActionSoldPct: result.totalPct,
      playerRetainedPct: 100 - result.totalPct,
      isValid: result.totalPct <= 100,
      buyin: result.buyin,
      agreements: result.agreements
    });
  } catch (error) {
    console.error('Action check error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Backer Event Overrides ───────────────────────────────────

// GUESS: Expose CRUD for event overrides so players can adjust or opt-out backers from specific events

// Set/update event override
app.post('/api/staking/agreements/:agreementId/overrides/:tournamentId', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { agreementId, tournamentId } = req.params;
    const { overridePercentage, overrideMarkup, optOut, notes } = req.body;

    // Verify ownership
    const chk = db.prepare(
      `SELECT ba.id FROM backer_agreements ba
       JOIN staking_series ss ON ba.series_id = ss.id
       WHERE ba.id = ? AND ss.user_id = ?`
    );
    chk.bind([agreementId, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Agreement not found' });

    // Upsert
    const existing = db.prepare(
      'SELECT id FROM backer_event_overrides WHERE agreement_id = ? AND tournament_id = ?'
    );
    existing.bind([agreementId, tournamentId]);
    const hasExisting = existing.step();
    existing.free();

    if (hasExisting) {
      db.run(
        `UPDATE backer_event_overrides SET
         override_percentage = ?, override_markup = ?, opt_out = ?, notes = ?
         WHERE agreement_id = ? AND tournament_id = ?`,
        [overridePercentage != null ? overridePercentage : null,
         overrideMarkup != null ? overrideMarkup : null,
         optOut ? 1 : 0, notes || null,
         agreementId, tournamentId]
      );
    } else {
      db.run(
        `INSERT INTO backer_event_overrides (agreement_id, tournament_id, override_percentage, override_markup, opt_out, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [agreementId, tournamentId,
         overridePercentage != null ? overridePercentage : null,
         overrideMarkup != null ? overrideMarkup : null,
         optOut ? 1 : 0, notes || null]
      );
    }

    await saveDatabase();
    res.json({ message: 'Override saved' });
  } catch (error) {
    console.error('Set override error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Delete event override
app.delete('/api/staking/agreements/:agreementId/overrides/:tournamentId', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { agreementId, tournamentId } = req.params;

    const chk = db.prepare(
      `SELECT ba.id FROM backer_agreements ba
       JOIN staking_series ss ON ba.series_id = ss.id
       WHERE ba.id = ? AND ss.user_id = ?`
    );
    chk.bind([agreementId, req.user.id]);
    const owns = chk.step();
    chk.free();
    if (!owns) return res.status(404).json({ error: 'Agreement not found' });

    db.run(
      'DELETE FROM backer_event_overrides WHERE agreement_id = ? AND tournament_id = ?',
      [agreementId, tournamentId]
    );

    await saveDatabase();
    res.json({ message: 'Override removed' });
  } catch (error) {
    console.error('Delete override error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Staking Sell Params ──────────────────────────────────

app.get('/api/staking/sell-params', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM staking_sell_params WHERE user_id = ?');
    stmt.bind([req.user.id]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.put('/api/staking/sell-params', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { params } = req.body; // Array of { param_type, param_key, sell_pct }
    if (!Array.isArray(params)) return res.status(400).json({ error: 'params must be an array' });

    for (const p of params) {
      if (!p.param_type || !p.param_key || p.sell_pct == null) continue;
      db.run(
        `INSERT INTO staking_sell_params (user_id, param_type, param_key, sell_pct) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, param_type, param_key) DO UPDATE SET sell_pct = excluded.sell_pct`,
        [req.user.id, p.param_type, p.param_key, p.sell_pct]
      );
    }
    await saveDatabase();
    res.json({ message: 'Sell params updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ── Staking Markup Settings ─────────────────────────────

app.get('/api/staking/markup-settings', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM staking_markup_settings WHERE user_id = ?');
    stmt.bind([req.user.id]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.put('/api/staking/markup-settings', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { settings } = req.body; // Array of { setting_type, setting_key, markup }
    if (!Array.isArray(settings)) return res.status(400).json({ error: 'settings must be an array' });

    for (const s of settings) {
      if (!s.setting_type || !s.setting_key || s.markup == null) continue;
      db.run(
        `INSERT INTO staking_markup_settings (user_id, setting_type, setting_key, markup) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, setting_type, setting_key) DO UPDATE SET markup = excluded.markup`,
        [req.user.id, s.setting_type, s.setting_key, s.markup]
      );
    }
    await saveDatabase();
    res.json({ message: 'Markup settings updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ── Saved Hands (Hand Replayer) ──────────────────────────

app.get('/api/hands', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT id, game_type, title, notes, is_public, created_at
      FROM saved_hands
      WHERE user_id = ?
      ORDER BY created_at DESC
    `);
    stmt.bind([req.user.id]);
    const hands = [];
    while (stmt.step()) hands.push(stmt.getAsObject());
    stmt.free();
    res.json(hands);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/hands', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { handData, gameType, title, notes, isPublic } = req.body;
    if (!handData || !gameType) return res.status(400).json({ error: 'Hand data and game type are required' });

    db.run(
      'INSERT INTO saved_hands (user_id, hand_data, game_type, title, notes, is_public) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, typeof handData === 'string' ? handData : JSON.stringify(handData), gameType, title || null, notes || null, isPublic ? 1 : 0]
    );
    await saveDatabase();
    // Get the inserted id
    const idStmt = db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const { id } = idStmt.getAsObject();
    idStmt.free();
    res.status(201).json({ message: 'Hand saved', id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/hands/public', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT sh.id, sh.game_type, sh.title, sh.notes, sh.hand_data, sh.created_at,
             u.username
      FROM saved_hands sh
      JOIN users u ON sh.user_id = u.id
      WHERE sh.is_public = 1
      ORDER BY sh.created_at DESC
      LIMIT 50
    `);
    const hands = [];
    while (stmt.step()) hands.push(stmt.getAsObject());
    stmt.free();
    res.json(hands);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/hands/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare(`
      SELECT sh.*, u.username
      FROM saved_hands sh
      JOIN users u ON sh.user_id = u.id
      WHERE sh.id = ? AND (sh.user_id = ? OR sh.is_public = 1)
    `);
    stmt.bind([id, req.user.id]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(404).json({ error: 'Hand not found' });
    }
    const hand = stmt.getAsObject();
    stmt.free();
    res.json(hand);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.put('/api/hands/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    const { handData, gameType, title, notes, isPublic } = req.body;
    const checkStmt = db.prepare('SELECT id FROM saved_hands WHERE id = ? AND user_id = ?');
    checkStmt.bind([id, req.user.id]);
    const owns = checkStmt.step();
    checkStmt.free();
    if (!owns) return res.status(404).json({ error: 'Hand not found' });

    db.run(
      'UPDATE saved_hands SET hand_data = ?, game_type = ?, title = ?, notes = ?, is_public = ? WHERE id = ? AND user_id = ?',
      [typeof handData === 'string' ? handData : JSON.stringify(handData), gameType, title || null, notes || null, isPublic ? 1 : 0, id, req.user.id]
    );
    await saveDatabase();
    res.json({ message: 'Hand updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/hands/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    db.run('DELETE FROM saved_hands WHERE id = ? AND user_id = ?', [id, req.user.id]);
    await saveDatabase();
    res.json({ message: 'Hand deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// SPA catch-all for backer view
app.get('/backer/:token', serveIndex);

// ── Saved Hands (Hand Replayer) ──────────────────────────

app.get('/api/hands', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT id, game_type, title, notes, is_public, created_at
      FROM saved_hands
      WHERE user_id = ?
      ORDER BY created_at DESC
    `);
    stmt.bind([req.user.id]);
    const hands = [];
    while (stmt.step()) hands.push(stmt.getAsObject());
    stmt.free();
    res.json(hands);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/hands', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { handData, gameType, title, notes, isPublic } = req.body;
    if (!handData || !gameType) return res.status(400).json({ error: 'Hand data and game type are required' });

    db.run(
      'INSERT INTO saved_hands (user_id, hand_data, game_type, title, notes, is_public) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, typeof handData === 'string' ? handData : JSON.stringify(handData), gameType, title || null, notes || null, isPublic ? 1 : 0]
    );
    await saveDatabase();
    const idStmt = db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const { id } = idStmt.getAsObject();
    idStmt.free();
    res.status(201).json({ message: 'Hand saved', id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/hands/public', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT sh.id, sh.game_type, sh.title, sh.notes, sh.hand_data, sh.created_at,
             u.username
      FROM saved_hands sh
      JOIN users u ON sh.user_id = u.id
      WHERE sh.is_public = 1
      ORDER BY sh.created_at DESC
      LIMIT 50
    `);
    const hands = [];
    while (stmt.step()) hands.push(stmt.getAsObject());
    stmt.free();
    res.json(hands);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/hands/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare(`
      SELECT sh.*, u.username
      FROM saved_hands sh
      JOIN users u ON sh.user_id = u.id
      WHERE sh.id = ? AND (sh.user_id = ? OR sh.is_public = 1)
    `);
    stmt.bind([id, req.user.id]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(404).json({ error: 'Hand not found' });
    }
    const hand = stmt.getAsObject();
    stmt.free();
    res.json(hand);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.put('/api/hands/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    const { handData, gameType, title, notes, isPublic } = req.body;
    const checkStmt = db.prepare('SELECT id FROM saved_hands WHERE id = ? AND user_id = ?');
    checkStmt.bind([id, req.user.id]);
    const owns = checkStmt.step();
    checkStmt.free();
    if (!owns) return res.status(404).json({ error: 'Hand not found' });

    db.run(
      'UPDATE saved_hands SET hand_data = ?, game_type = ?, title = ?, notes = ?, is_public = ? WHERE id = ? AND user_id = ?',
      [typeof handData === 'string' ? handData : JSON.stringify(handData), gameType, title || null, notes || null, isPublic ? 1 : 0, id, req.user.id]
    );
    await saveDatabase();
    res.json({ message: 'Hand updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/hands/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    db.run('DELETE FROM saved_hands WHERE id = ? AND user_id = ?', [id, req.user.id]);
    await saveDatabase();
    res.json({ message: 'Hand deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Admin: list users (secret key protected)
app.get('/api/admin/users', adminLimiter, (req, res) => {
  if (!process.env.ADMIN_KEY) {
    return res.status(503).json({ error: 'Admin endpoint not configured' });
  }
  const key = req.query.key;
  if (key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const stmt = db.prepare('SELECT id, username, email, created_at FROM users ORDER BY id');
    const users = [];
    while (stmt.step()) users.push(stmt.getAsObject());
    stmt.free();
    res.json(users);
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// SPA catch-all for /shared/* routes
app.get('/shared/:token', serveIndex);

// Start server
initDatabase().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  const shutdown = () => {
    console.log('Shutting down...');
    for (const [, clients] of sseClients) {
      for (const res of clients) res.end();
    }
    sseClients.clear();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
});
