require('dotenv').config({ path: require('path').join(__dirname, '.env') });
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
const webpush = require('web-push');
const sampleTournaments = require('./sample-data');
const Anthropic = require('@anthropic-ai/sdk');

// ── Schedule document archiving ──
// Folder layout: schedule-docs/<Venue>/schedules/  — event listings, PDFs, images
//                schedule-docs/<Venue>/structures/ — blind structures, level sheets
const SCHEDULE_DOCS_DIR = path.join(__dirname, 'schedule-docs');
async function archiveScheduleDoc(venue, filename, buffer, docType) {
  try {
    const safeVenue = (venue || 'unknown').replace(/[^a-zA-Z0-9 _\-\/]/g, '').trim();
    const subDir = docType === 'structure' ? 'structures' : 'schedules';
    const venueDir = path.join(SCHEDULE_DOCS_DIR, safeVenue, subDir);
    await fs.mkdir(venueDir, { recursive: true });
    const safeName = filename.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const ts = new Date().toISOString().slice(0, 10);
    const dest = path.join(venueDir, `${ts}_${safeName}`);
    await fs.writeFile(dest, buffer);
    console.log(`[ScheduleDocs] Archived ${(buffer.length / 1024).toFixed(0)}KB ${subDir} → ${dest}`);
    return dest;
  } catch (err) {
    console.error('[ScheduleDocs] Archive failed:', err.message);
    return null;
  }
}

// ── Web Push (VAPID) setup ──
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@futurega.me',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log('Web Push configured');
} else {
  console.log('Web Push not configured — VAPID keys missing');
}

const app = express();
const PORT = process.env.PORT || 3001;

// ── Exchange rate cache ─────────────────────────────────────
const SUPPORTED_CURRENCIES = ['USD','EUR','GBP','CAD','AUD','JPY','CHF','SEK','DKK','NOK','CZK','PLN','HKD','SGD','BRL','MXN','INR','CNY'];
const RATE_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const exchangeRateCache = { rates: null, base: 'USD', fetchedAt: 0, stale: false };
const FALLBACK_RATES = { EUR:0.91, GBP:0.79, CAD:1.36, AUD:1.53, JPY:149.5, CHF:0.88, SEK:10.3, DKK:6.8, NOK:10.5, CZK:23.1, PLN:4.0, HKD:7.8, SGD:1.34, BRL:5.0, MXN:17.2, INR:83.1, CNY:7.24, USD:1 };
async function fetchExchangeRates() {
  if (exchangeRateCache.rates && Date.now() - exchangeRateCache.fetchedAt < RATE_CACHE_TTL) {
    return exchangeRateCache;
  }
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const filtered = {};
    for (const c of SUPPORTED_CURRENCIES) {
      if (data.rates[c]) filtered[c] = data.rates[c];
    }
    exchangeRateCache.rates = filtered;
    exchangeRateCache.fetchedAt = Date.now();
    exchangeRateCache.stale = false;
    console.log('Exchange rates updated');
    return exchangeRateCache;
  } catch (e) {
    console.log('Exchange rate fetch failed:', e.message);
    if (exchangeRateCache.rates) {
      exchangeRateCache.stale = true;
      return exchangeRateCache;
    }
    exchangeRateCache.rates = FALLBACK_RATES;
    exchangeRateCache.fetchedAt = 0;
    exchangeRateCache.stale = true;
    return exchangeRateCache;
  }
}
// Pre-fetch on startup (non-blocking)
fetchExchangeRates().catch(() => {});

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
  : ['http://localhost:3001', 'http://localhost:3000', 'http://localhost:5173', 'capacitor://localhost', 'http://localhost', 'https://futurega.me', 'http://futurega.me', 'https://www.futurega.me', 'http://www.futurega.me'];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, same-origin)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`CORS: unlisted origin ${origin}`);
      callback(null, true); // Allow all origins — app is public
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
  console.log('SMTP not configured — password reset emails will be logged to console');
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

app.use(express.json({ limit: '50mb' }));

// Health check for zero-downtime deploys
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Serve frontend — now the Vite build output in public-vite/.
// Vite fingerprints bundled JS/CSS under /assets/*, so those are safe to cache
// aggressively; HTML stays uncached so new deploys pick up new asset hashes.
app.use(express.static(path.join(__dirname, 'public-vite'), {
  index: false, // Don't auto-serve index.html — we handle it explicitly below
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Surrogate-Control', 'no-store');
    } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      // Hashed filenames — safe to cache forever
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.set('Cache-Control', 'no-cache'); // always revalidate un-hashed scripts
    }
  }
}));

// WSOP 2027 Console — a self-contained, offline-first PWA (its own Vite build
// in wsop-console/app/, base '/console/'). No shared API/auth: all its data is
// local to the browser (IndexedDB), so we just serve its static build under
// /console. Registered before the route handlers so it wins those paths.
//
// Access is restricted to the "ham" account via HTTP Basic Auth: the console is
// loaded by document navigation, which never carries the app's bearer token, so
// we can't reuse authenticateToken. Basic creds are verified (bcrypt) against
// the users table; only username "ham" passes. Enter "ham" (or ham's email) as
// the username and the account password.
// ── Shared session cookie ──
// The main app authenticates via a Bearer JWT in localStorage (header-only, so
// it never rides a plain navigation to /console). To make "logged into
// futurega.me ⇒ logged into the console" work, we ALSO issue that same JWT as an
// httpOnly cookie at login; /console then accepts a valid cookie for the owner
// (username 'ham'). Basic Auth stays as a fallback (native app + first-time seed).
const SESSION_COOKIE = 'fg_session';
const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // match the JWT's 90d expiry
function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,   // JS can't read it → XSS can't exfiltrate (unlike localStorage)
    secure: true,     // HTTPS only
    sameSite: 'lax',  // sent on top-level navigation, NOT on cross-site POST (CSRF-safe)
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  });
}
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { return null; }
    }
  }
  return null;
}
// True iff a valid, unexpired session cookie belongs to the console owner (ham).
// The console owner's STABLE user id — resolved once at boot. Authorizing on the
// id (not the mutable, case-variant `username` string) is what prevents a
// look-alike account like 'HAM' from being treated as the owner. Resolves to the
// ORIGINAL 'ham' (lowest id whose username case-insensitively equals 'ham');
// env CONSOLE_OWNER_USER_ID overrides.
let HAM_OWNER_ID = null;
function resolveHamOwnerId() {
  const envId = Number(process.env.CONSOLE_OWNER_USER_ID);
  if (Number.isInteger(envId) && envId > 0) { HAM_OWNER_ID = envId; console.log(`[console] owner id = ${envId} (env)`); return; }
  try {
    const s = db.prepare("SELECT id FROM users WHERE LOWER(username) = 'ham' ORDER BY id ASC LIMIT 1");
    let id = null; while (s.step()) id = s.getAsObject().id; s.free();
    HAM_OWNER_ID = id != null ? Number(id) : null;
  } catch (e) { console.error('[console] resolveHamOwnerId:', e && e.message); }
  console.log(HAM_OWNER_ID != null
    ? `[console] owner id = ${HAM_OWNER_ID}`
    : '[console] owner id UNRESOLVED — /console cookie SSO disabled (Basic Auth only)');
}
function consoleSessionOk(req) {
  if (HAM_OWNER_ID == null) return false; // owner unknown → never trust a cookie
  const tok = readCookie(req, SESSION_COOKIE);
  if (!tok) return false;
  try {
    // Pin HS256 so a forged alg:none / algorithm-confusion token can't verify.
    const decoded = jwt.verify(tok, JWT_SECRET, { algorithms: ['HS256'] });
    // Authorize on the STABLE id, never the username string. Exclude guests.
    return !!decoded && !decoded.isGuest && Number(decoded.id) === HAM_OWNER_ID;
  } catch (_) {
    return false;
  }
}

async function requireHamBasic(req, res, next) {
  const challenge = () => {
    res.set('WWW-Authenticate', 'Basic realm="WSOP 2027 Console", charset="UTF-8"');
    res.status(401).type('txt').send('Authentication required — WSOP 2027 Console is private.');
  };
  // (1) Accept a valid futurega.me session cookie for the owner — no popup.
  if (consoleSessionOk(req)) return next();
  // (2) Fall back to Basic Auth (native app, or first-time seed of the cookie).
  try {
    const [scheme, encoded] = (req.headers['authorization'] || '').split(' ');
    if (scheme !== 'Basic' || !encoded) return challenge();
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const login = sep >= 0 ? decoded.slice(0, sep) : decoded;
    const password = sep >= 0 ? decoded.slice(sep + 1) : '';

    if (HAM_OWNER_ID == null) return challenge(); // owner unresolved → deny
    // Load the OWNER by stable id — NOT by the client-supplied login string — so
    // a look-alike account ('HAM', or a row matching by email) can't be used to
    // authenticate. The password is checked against the owner's hash only.
    const stmt = db.prepare('SELECT id, username, email, password FROM users WHERE id = ?');
    stmt.bind([HAM_OWNER_ID]);
    let owner = null;
    while (stmt.step()) owner = stmt.getAsObject();
    stmt.free();
    if (!owner) return challenge();

    const loginNamesOwner =
      String(login).toLowerCase() === String(owner.username || '').toLowerCase() ||
      String(login).toLowerCase() === String(owner.email || '').toLowerCase();
    const ok = loginNamesOwner && (await bcrypt.compare(password, owner.password));
    if (!ok) return challenge();
    // Seed the shared session cookie so subsequent requests (and the main app)
    // recognise the session without re-prompting — this is what stops the popup
    // recurring, and unifies with the futurega.me login.
    try {
      const tok = jwt.sign({ id: owner.id, username: owner.username }, JWT_SECRET, { expiresIn: '90d' });
      setSessionCookie(res, tok);
    } catch (_) { /* non-fatal: auth still succeeds without the cookie */ }
    next();
  } catch (err) {
    console.error('[console] basic-auth error:', err);
    return challenge();
  }
}

// ── Backer-facing public surface (NOT under /console — backers have no creds) ──
// Access is gated purely by the unguessable token in the URL; each token sees
// only its own feed. Registered before the console gate + the SPA catch-all so
// these win.
const BACKER_TOKEN_RE = /^[A-Za-z0-9]{6,64}$/; // short base62 codes + legacy 32-hex

// Push service worker for the backer page (scope /b/). Must be registered
// before /b/:token so 'sw.js' isn't captured as a token.
app.get('/b/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  res.send(
    "self.addEventListener('push',function(e){var d={};try{d=e.data.json();}catch(_){}" +
    "e.waitUntil(self.registration.showNotification(d.title||'Update',{body:d.body||'',data:{url:d.url||'/'},tag:d.tag||'action'}));});" +
    "self.addEventListener('notificationclick',function(e){e.notification.close();" +
    "var u=(e.notification.data&&e.notification.data.url)||'/';" +
    "e.waitUntil(clients.matchAll({type:'window'}).then(function(cl){for(var i=0;i<cl.length;i++){if(cl[i].url.indexOf(u)>-1&&'focus'in cl[i])return cl[i].focus();}return clients.openWindow(u);}));});"
  );
});

// Public VAPID key so a backer's browser can subscribe.
app.get('/api/backer/vapid', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// A backer's own feed (their name, running share, per-session log).
app.get('/api/backer/:token/feed', (req, res) => {
  const token = String(req.params.token || '');
  if (!BACKER_TOKEN_RE.test(token)) return res.status(404).json({ error: 'Not found' });
  try {
    let name = null;
    const nstmt = db.prepare('SELECT name FROM backer_public WHERE token = ?');
    nstmt.bind([token]); if (nstmt.step()) name = nstmt.getAsObject().name; nstmt.free();
    // Fall back to the synced backer object for name + stakes, so a freshly
    // created backer's page is presentable before the first session is notified.
    let stakes = '';
    let openingCents = 0;
    const rec = backerRecordByToken(token);
    if (rec) {
      if (!name) name = rec.name || null;
      stakes = stakesSummaryServer(rec.stakes || []);
      openingCents = Math.round((Number(rec.opening) || 0) * 100);
    }
    const events = [];
    // Newest session FIRST, by the session's own date — not by `ts`, which is
    // when notify fired. The two diverge whenever a session is logged late (a
    // Saturday session notified after Sunday's has a larger ts but an earlier
    // date), which put older sessions above newer ones on the page. `date` is
    // an ISO YYYY-MM-DD string, so it orders correctly as text; ts breaks ties
    // within a day.
    const estmt = db.prepare(
      'SELECT ts, date, game, venue, hours, session_result_cents, pct, share_cents FROM backer_events WHERE token = ? ORDER BY date DESC, ts DESC LIMIT 200'
    );
    estmt.bind([token]);
    while (estmt.step()) {
      const r = estmt.getAsObject();
      events.push({
        ts: r.ts, date: r.date, game: r.game, venue: r.venue, hours: r.hours,
        sessionResultCents: r.session_result_cents, pct: r.pct, shareCents: r.share_cents,
      });
    }
    estmt.free();
    let grossCents = 0, netSessionCents = 0;
    for (const e of events) {
      grossCents += e.sessionResultCents || 0;
      netSessionCents += e.shareCents || 0;
    }
    res.json({
      name, stakes, openingCents, grossCents, netSessionCents,
      cumulativeCents: backerCumulativeCents(token) + openingCents,
      events,
    });
  } catch (err) {
    console.error('Backer feed error:', err);
    res.status(500).json({ error: 'feed failed' });
  }
});

// A backer enables push from their page.
app.post('/api/backer/:token/subscribe', async (req, res) => {
  const token = String(req.params.token || '');
  if (!BACKER_TOKEN_RE.test(token)) return res.status(404).json({ error: 'Not found' });
  try {
    const { subscription } = req.body || {};
    if (!subscription || !subscription.endpoint || !subscription.keys ||
        !subscription.keys.p256dh || !subscription.keys.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    db.run('DELETE FROM backer_push_subs WHERE endpoint = ?', [subscription.endpoint]);
    db.run(
      'INSERT INTO backer_push_subs (token, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?, ?)',
      [token, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
    );
    await saveDatabase();
    res.json({ message: 'Subscribed' });
  } catch (err) {
    console.error('Backer subscribe error:', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// A backer turns push off from their page.
app.post('/api/backer/:token/unsubscribe', async (req, res) => {
  const token = String(req.params.token || '');
  if (!BACKER_TOKEN_RE.test(token)) return res.status(404).json({ error: 'Not found' });
  try {
    const { endpoint } = req.body || {};
    if (endpoint) db.run('DELETE FROM backer_push_subs WHERE token = ? AND endpoint = ?', [token, endpoint]);
    else db.run('DELETE FROM backer_push_subs WHERE token = ?', [token]);
    await saveDatabase();
    res.json({ message: 'Unsubscribed' });
  } catch (err) {
    console.error('Backer unsubscribe error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// The backer's private page (same shell for every token; JS reads the token
// from the URL and fetches its own feed).
app.get('/b/:token', (req, res) => {
  const token = String(req.params.token || '');
  if (!BACKER_TOKEN_RE.test(token)) return res.status(404).send('Not found');
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(BACKER_PAGE_HTML);
});

// ── Dashboard seam #2 (the ONLY dashboard surface left on the scheduler) ──
// The dashboard itself (summary/series/screensaver page) moved to the standalone
// service at dashboard.futurega.me (cutover 2026-08-09). What remains here is
// the cross-domain seam: the dashboard has no user_schedules/tournaments tables,
// so it fetches the upcoming schedule from us, gated by the shared
// DASHBOARD_TOKEN (404 on mismatch, matching the backer routes' posture).
// Seam #2 (departures board): the standalone console fetches the dashboard user's
// upcoming schedule here (it has no user_schedules/tournaments tables of its own).
// Same DASHBOARD_TOKEN gate + posture as the other dashboard routes; the response
// is the already-mapped events array from computeDashboardEvents.
app.get('/api/schedule/:token/upcoming', (req, res) => {
  const token = String(req.params.token || '');
  if (!dashboardTokenOk(token)) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'no-store');
  try {
    res.json(computeDashboardEvents(new Date()));
  } catch (err) {
    console.error('Dashboard upcoming error:', err);
    res.status(500).json({ error: 'upcoming failed' });
  }
});

// Backer routes kept under their historical /console/api/backers/* paths (the
// standalone dashboard POSTs here over HTTP — seam #1) — each ham-gated
// directly now that the blanket /console gate is gone.
{

  // Backer notifications (gated — only ham can send). The client sends a
  // session summary + the computed per-backer cuts; we append each backer's
  // event (dedup on token+session), recompute their running share, and fire
  // their web-push. Returns per-recipient delivery + running total.
  app.post('/console/api/backers/notify', requireHamBasic, async (req, res) => {
    try {
      const { session, recipients } = req.body || {};
      if (!session || typeof session.id !== 'string' || !Array.isArray(recipients)) {
        return res.status(400).json({ error: 'Bad payload' });
      }
      const ts = Date.now();
      const results = [];
      let changed = false;
      for (const r of recipients) {
        if (!r || typeof r.token !== 'string' || !/^[A-Za-z0-9]{6,64}$/.test(r.token)) continue;
        const pct = Number(r.pct) || 0;
        const shareCents = Math.round(Number(r.shareCents) || 0);
        db.run(
          `INSERT INTO backer_public (token, name, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(token) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
          [r.token, String(r.name || '').slice(0, 80), ts]
        );
        db.run(
          `INSERT OR IGNORE INTO backer_events
             (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `${r.token}:${session.id}`, r.token, session.id, ts,
            String(session.date || ''), String(session.game || '').slice(0, 120),
            String(session.venue || '').slice(0, 80), Number(session.hours) || 0,
            Math.round(Number(session.resultCents) || 0), pct, shareCents,
          ]
        );
        const inserted = db.getRowsModified() > 0;
        if (inserted) changed = true;
        // Cumulative is computed AFTER the insert-or-ignore, so it reflects this
        // session once (a re-send finds the row already there and the sum is
        // unchanged — never double-counted). Add the backer's carry-in so the
        // "Running" figure matches their page.
        const cum = backerCumulativeCents(r.token) + Math.round(Number(r.openingCents) || 0);
        // Always attempt the push (not only on first record): a backer who
        // enabled notifications AFTER the first send still gets reached on a
        // re-send, while the dedup above keeps their running total correct.
        const title = `${session.game} — ${fmtSignedCents(shareCents)}`;
        const body =
          `${session.venue} · ${fmtHours(session.hours)} · session ${fmtSignedCents(session.resultCents)}. ` +
          `Your ${pct}% = ${fmtSignedCents(shareCents)}. Running: ${fmtSignedCents(cum)}.`;
        const out = await sendBackerPush(r.token, title, body, `/b/${r.token}`);
        if (out.changed) changed = true;
        // Per-session text (Twilio), if this backer has a phone on file.
        let smsStatus = 'none';
        if (r.sms && typeof r.sms === 'string') {
          smsStatus = await sendBackerSms(
            r.sms,
            `${session.game} at ${session.venue}: session ${fmtSignedCents(session.resultCents)} over ${fmtHours(session.hours)}. ` +
            `Your ${pct}% = ${fmtSignedCents(shareCents)}. Running ${fmtSignedCents(cum)}. futurega.me/b/${r.token}`
          );
        }
        results.push({ token: r.token, name: r.name, sent: out.sent, subs: out.subs, cumulativeCents: cum, duplicate: !inserted, sms: smsStatus });
      }
      if (changed) await saveDatabase();
      res.json({ results });
    } catch (err) {
      console.error('Backer notify error:', err);
      res.status(500).json({ error: 'notify failed' });
    }
  });

  // A backer's recorded shares (gated) — so the console can review + remove
  // events (e.g. a test/miscategorised session). Includes session_id (the delete
  // key) that the public feed omits.
  app.get('/console/api/backers/:token/events', requireHamBasic, (req, res) => {
    try {
      const token = String(req.params.token || '');
      if (!/^[A-Za-z0-9]{6,64}$/.test(token)) return res.status(400).json({ error: 'bad token' });
      // Same order as the backer's own page (see the feed route) so the review
      // list here matches what they see.
      const s = db.prepare(
        'SELECT session_id, date, game, venue, hours, session_result_cents, pct, share_cents, ts FROM backer_events WHERE token = ? ORDER BY date DESC, ts DESC LIMIT 500'
      );
      s.bind([token]);
      const events = [];
      while (s.step()) {
        const r = s.getAsObject();
        events.push({
          sessionId: r.session_id, date: r.date, game: r.game, venue: r.venue,
          hours: r.hours, resultCents: r.session_result_cents, pct: r.pct,
          shareCents: r.share_cents, ts: r.ts,
        });
      }
      s.free();
      res.json({ events });
    } catch (err) {
      console.error('Backer events error:', err);
      res.status(500).json({ error: 'events failed' });
    }
  });

  // Un-notify (gated): remove a backer's recorded share for a session — the
  // reverse of notify. Deletes the (token, session_id) event so the backer's
  // page + running total (SUM(share_cents)) self-correct. No push is sent.
  app.post('/console/api/backers/unnotify', requireHamBasic, async (req, res) => {
    try {
      const { token, sessionId } = req.body || {};
      if (!token || !/^[A-Za-z0-9]{6,64}$/.test(String(token))) return res.status(400).json({ error: 'bad token' });
      if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'sessionId required' });
      db.run('DELETE FROM backer_events WHERE token = ? AND session_id = ?', [String(token), sessionId]);
      const removed = db.getRowsModified();
      if (removed) await saveDatabase();
      res.json({ ok: true, removed, cumulativeCents: backerCumulativeCents(String(token)) });
    } catch (err) {
      console.error('Backer unnotify error:', err);
      res.status(500).json({ error: 'unnotify failed' });
    }
  });

}

// Serve index.html with injected build version to bust any cache
const BUILD_VERSION = Date.now().toString();
function serveIndex(req, res) {
  const fs = require('fs');
  let html = fs.readFileSync(path.join(__dirname, 'public-vite', 'index.html'), 'utf8');
  html = html.replace('</head>', `<meta name="build-version" content="${BUILD_VERSION}">\n</head>`);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('ETag', BUILD_VERSION);
  res.type('html').send(html);
}
app.get('/', serveIndex);

// Hendon Mob lookup — resolve via DuckDuckGo, redirect user straight to Hendon Mob
const hendonCache = new Map();
const hendonWinningsCache = new Map();

// Find Hendon Mob profile URL for a player name
async function findHendonUrl(name) {
  const key = name.toLowerCase().trim();
  if (hendonCache.has(key)) return hendonCache.get(key);

  const ddgUrl = `https://duckduckgo.com/?q=${encodeURIComponent('\\ site:thehendonmob.com ' + name)}`;
  try {
    const resp = await fetch(ddgUrl, { redirect: 'manual', headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }});
    const html = await resp.text();
    const match = html.match(/uddg=(https?[^&"]+)/);
    if (match) {
      const finalUrl = decodeURIComponent(match[1]);
      if (finalUrl.includes('thehendonmob.com') && finalUrl.includes('/player.php')) {
        hendonCache.set(key, finalUrl);
        return finalUrl;
      }
    }
  } catch {}
  return null;
}

// Scrape lifetime winnings from a Hendon Mob profile page
async function scrapeHendonWinnings(profileUrl) {
  if (hendonWinningsCache.has(profileUrl)) return hendonWinningsCache.get(profileUrl);
  try {
    const resp = await fetch(profileUrl, { headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }});
    const html = await resp.text();
    // Look for "All Time Money List" or total winnings — typically in a format like "$1,234,567"
    // Hendon Mob shows "Total Live Earnings" with the dollar amount
    const earningsMatch = html.match(/Total\s+Live\s+Earnings[^$]*\$([\d,]+)/i)
      || html.match(/All\s+Time\s+Money[^$]*\$([\d,]+)/i)
      || html.match(/<div[^>]*class="[^"]*earnings[^"]*"[^>]*>[^$]*\$([\d,]+)/i);
    if (earningsMatch) {
      const amount = '$' + earningsMatch[1];
      hendonWinningsCache.set(profileUrl, amount);
      return amount;
    }
    // Try broader pattern — find the largest dollar amount on the page (likely total earnings)
    const allAmounts = [...html.matchAll(/\$([\d,]{4,})/g)].map(m => parseInt(m[1].replace(/,/g, '')));
    if (allAmounts.length) {
      const max = Math.max(...allAmounts);
      const amount = '$' + max.toLocaleString();
      hendonWinningsCache.set(profileUrl, amount);
      return amount;
    }
  } catch {}
  return null;
}

// Batch lookup: resolve Hendon Mob winnings for multiple players
app.post('/api/hendon-winnings', authenticateToken, async (req, res) => {
  const { names } = req.body;
  if (!names || !Array.isArray(names)) return res.status(400).json({ error: 'names array required' });

  const results = {};
  await Promise.all(names.slice(0, 10).map(async (name) => {
    const url = await findHendonUrl(name);
    if (!url) return;
    const winnings = await scrapeHendonWinnings(url);
    if (winnings) results[name] = { url, winnings };
  }));

  res.json(results);
});
app.get('/api/hendon-redirect', async (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).send('name required');

  const url = await findHendonUrl(name);
  if (url) return res.redirect(url);

  const ddgUrl = `https://duckduckgo.com/?q=${encodeURIComponent('site:thehendonmob.com ' + name)}`;
  res.redirect(ddgUrl);
});

// File upload configuration
const upload = multer({ dest: 'uploads/' });

// Database initialization
let db;
let SQL;
const DB_PATH = process.env.DB_PATH || 'poker-tournaments.db';

// ── Re-entry normalization ──
function normalizeLevelDuration(val) {
  if (val == null) return val;
  return String(val).replace(/\s*min(ute)?s?\s*$/i, '').trim();
}

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

  // Strip "Ring Event" marker — it's a category label, not part of the name
  n = n.replace(/\s+Ring\s+Event\b/gi, '');

  // Normalize "PLO/NLH" → "NLH/PLO"
  n = n.replace(/\bPLO\/NLH\b/g, 'NLH/PLO');

  // De-dot acronyms: "H.O.R.S.E." → "HORSE" (convention: no periods in acronyms).
  n = n.replace(/\b(?:[A-Za-z]\.){2,}[A-Za-z]?\.?/g, (m) => m.replace(/\./g, ''));

  // Abbreviate spelled-out game types. These arrive from the WSOP upload path, which does not
  // share the MTT feed's normalizer, and they sit alongside rows that already use the short form —
  // "Daily Deepstack: No Limit Hold'em" next to 97 rows of "Daily Deepstack: NLH Turbo".
  // Replaced rather than stripped: the variant is the only distinguishing part of those names, so
  // removing it would collapse three different events onto one title.
  // "No" is required before "Limit Hold'em" so the Limit Hold'em variant is left alone.
  n = n.replace(/\bNo[\s-]?Limit\s+Hold\s*'?\s*em\b/gi, 'NLH');
  n = n.replace(/\bPot[\s-]?Limit\s+Omaha(?:\s+Hi[\s-]?Lo)?\b/gi, 'PLO');
  n = n.replace(/\bLimit\s+HORSE\b/gi, 'HORSE');

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
      'Razz': 'Razz', 'Badugi': 'Badugi', 'Stud 8': 'Stud 8',
      '7-Card Stud': '7-Card Stud', 'Limit Hold\'em': 'Limit Hold\'em',
      'NL 2-7 Single Draw': 'NL 2-7 Single Draw',
      'NL 2-7 Triple Draw': '2-7 Triple Draw',
      'OFC Pineapple': 'OFC Pineapple', 'Sviten Special': 'Sviten Special',
      'TORSE': 'TORSE', 'Dealer\'s Choice': 'Dealer\'s Choice',
    };
    const abbrev = VARIANT_MAP[gameVariant] || gameVariant;
    const KNOWN_STARTS = [
      'NLH', 'PLO8', 'PLO', 'O8', 'HORSE', 'Mixed', 'Big O', 'Razz',
      'Badugi', 'Stud 8', '7-Card', 'Limit', 'NL 2-7', '2-7', 'OFC',
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

  // Final cleanup. The trailing-separator strip has to run HERE, after the variant prepend and
  // dedup, not just at line ~793: those rules can empty the tail of a name and strand the
  // separator that preceded it. "Satellite to NLH" becomes "Satellite - NLH", then the prepend
  // strips the now-redundant NLH from the middle and leaves "NLH Satellite -". Looped because one
  // pass only removes the outermost.
  n = n.replace(/\s{2,}/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const before = n;
    n = n.replace(/\s*[-–—:,]\s*$/, '').trim();
    if (n === before) break;
  }

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
       AND (venue LIKE '%WSOP%' OR venue LIKE '%Horseshoe%' OR venue LIKE '%Paris Las Vegas%')
       AND venue != 'WSOP Europe'
       AND venue NOT LIKE '%WSOPC%'`
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

  // Migrate: add hand_replayer_access to users
  try {
    db.run('ALTER TABLE users ADD COLUMN hand_replayer_access INTEGER DEFAULT 0');
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
    { file: 'wsope-events.json', label: 'WSOP Europe', check: "venue = 'WSOP Europe'" },
    { file: 'wynn-events.json', label: 'Wynn Summer Classic', check: "venue = 'Wynn Las Vegas'" },
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

  // ── Venue colors table ──
  db.run(`CREATE TABLE IF NOT EXISTS venue_colors (
    venue_abbr TEXT PRIMARY KEY,
    color TEXT NOT NULL
  )`);

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
      // Re-runs normalizeEventName after adding the de-dot and spelled-out-variant rules above.
      // Skips MTT-feed rows on purpose: those are owned by mtt-series-watcher, which emits them
      // pre-normalized and UPSERTs hourly, so anything rewritten here would be reverted at :20.
      // Their equivalent fix lives in that repo's src/normalize/event-name.ts.
      name: 'normalize-spelled-out-variants-2026-08',
      fn: () => {
        const stmt = db.prepare(
          "SELECT id, event_name, game_variant FROM tournaments WHERE venue != 'Personal' AND (stable_id IS NULL OR stable_id NOT LIKE 'MTT-%')",
        );
        const updates = [];
        while (stmt.step()) {
          const { id, event_name, game_variant } = stmt.getAsObject();
          const normalized = normalizeEventName(event_name, game_variant);
          if (normalized !== event_name) updates.push([normalized, id]);
        }
        stmt.free();
        for (const [name, id] of updates) {
          db.run('UPDATE tournaments SET event_name = ? WHERE id = ?', [name, id]);
        }
        console.log(`Spelled-out variant normalization: ${updates.length} rows updated`);
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
      name: 'swap-suggestions-table-2026-03',
      fn: () => {
        db.run(`CREATE TABLE IF NOT EXISTS swap_suggestions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_user_id INTEGER NOT NULL,
          to_user_id INTEGER NOT NULL,
          tournament_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          my_pct REAL NOT NULL,
          their_pct REAL NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          responded_at DATETIME,
          FOREIGN KEY (from_user_id) REFERENCES users(id),
          FOREIGN KEY (to_user_id) REFERENCES users(id),
          FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
        )`);
        console.log('Created swap_suggestions table');
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
    {
      name: 'wsope-rename-events-2026-03',
      fn: () => {
        // Re-read seed file and update event names to match WSOP naming format
        const seedPath = path.join(__dirname, 'wsope-events.json');
        if (!require('fs').existsSync(seedPath)) return;
        const rows = JSON.parse(require('fs').readFileSync(seedPath, 'utf8'));
        let updated = 0;
        for (const t of rows) {
          db.run(
            `UPDATE tournaments SET event_name = ?
             WHERE venue = 'WSOP Europe' AND event_number = ? AND date = ? AND time = ?`,
            [t.event_name, t.event_number, t.date, t.time]
          );
          updated += db.getRowsModified();
        }
        console.log(`WSOPE event rename: ${updated} rows updated`);
      }
    },
    {
      name: 'wsope-clear-wrong-rake-2026-03',
      fn: () => {
        db.run(
          `UPDATE tournaments SET rake_pct = NULL, rake_dollars = NULL,
           house_fee = NULL, prize_pool = NULL, opt_add_on = NULL
           WHERE venue = 'WSOP Europe'`
        );
        const updated = db.getRowsModified();
        console.log(`WSOPE: cleared incorrect rake data from ${updated} events`);
      }
    },
    {
      name: 'fix-1149-buyin-2026-03',
      fn: () => {
        db.run(`UPDATE tournaments SET buyin = 1150 WHERE buyin = 1149`);
        const updated = db.getRowsModified();
        console.log(`Fixed $1149 → $1150 buyin: ${updated} events`);
      }
    },
    {
      name: 'stud8-to-stud-8-2026-03',
      fn: () => {
        db.run(`UPDATE tournaments SET game_variant = 'Stud 8' WHERE game_variant = 'Stud8'`);
        const v = db.getRowsModified();
        db.run(`UPDATE tournaments SET event_name = REPLACE(event_name, 'Stud8', 'Stud 8') WHERE event_name LIKE '%Stud8%'`);
        const n = db.getRowsModified();
        console.log(`Stud8 → Stud 8: ${v} variants, ${n} event names updated`);
      }
    },
    {
      name: 'remove-non-wsop-venues-2026-03',
      fn: () => {
        const venues = ['Wynn Las Vegas', 'Wynn', 'Aria Resort & Casino', 'Aria', 'Golden Nugget', 'MGM Grand', 'Orleans', 'Resorts World'];
        let total = 0;
        for (const v of venues) {
          db.run('DELETE FROM tournaments WHERE venue = ?', [v]);
          total += db.getRowsModified();
        }
        console.log(`Removed ${total} events from non-WSOP Vegas venues`);
      }
    },
    {
      name: 'remove-south-point-2026-03',
      fn: () => {
        db.run("DELETE FROM tournaments WHERE venue = 'South Point'");
        const d = db.getRowsModified();
        console.log(`Removed ${d} South Point events`);
      }
    },
    {
      name: 'push-subscriptions-table-2026-03',
      fn: () => {
        db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          endpoint TEXT NOT NULL UNIQUE,
          keys_p256dh TEXT NOT NULL,
          keys_auth TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
        console.log('Created push_subscriptions table');
      }
    },
    {
      name: 'console-records-sync-2026-07',
      fn: () => {
        // Cross-device sync store for the single-user (ham) console. One generic
        // table holds every client store's records + delete tombstones; the
        // client full-state pushes and the server last-write-wins merges.
        db.run(`CREATE TABLE IF NOT EXISTS console_records (
          store TEXT NOT NULL,
          id TEXT NOT NULL,
          data TEXT,
          updated_at INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (store, id)
        )`);
        console.log('Created console_records table');
      }
    },
    {
      name: 'backer-notifications-2026-07',
      fn: () => {
        // Backer-facing notification system. Ethan's backers aren't console
        // users — each has an unguessable token that keys their private page
        // (/b/<token>) and their web-push subscription. backer_public holds
        // their display name; backer_events is the append-only per-session log
        // (unique on token+session so a re-send never double-counts); their
        // running share = SUM(share_cents).
        db.run(`CREATE TABLE IF NOT EXISTS backer_public (
          token TEXT PRIMARY KEY,
          name TEXT,
          updated_at INTEGER
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS backer_events (
          id TEXT PRIMARY KEY,
          token TEXT NOT NULL,
          session_id TEXT NOT NULL,
          ts INTEGER NOT NULL,
          date TEXT,
          game TEXT,
          venue TEXT,
          hours REAL,
          session_result_cents INTEGER,
          pct REAL,
          share_cents INTEGER,
          UNIQUE (token, session_id)
        )`);
        db.run('CREATE INDEX IF NOT EXISTS idx_backer_events_token ON backer_events(token, ts)');
        db.run(`CREATE TABLE IF NOT EXISTS backer_push_subs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token TEXT NOT NULL,
          endpoint TEXT NOT NULL UNIQUE,
          keys_p256dh TEXT NOT NULL,
          keys_auth TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        db.run('CREATE INDEX IF NOT EXISTS idx_backer_subs_token ON backer_push_subs(token)');
        console.log('Created backer notification tables');
      }
    },
    {
      name: 'ipo-full-rebuild-2026-03',
      fn: () => {
        db.run("DELETE FROM tournaments WHERE venue = 'Irish Poker Open'");
        const deleted = db.getRowsModified();
        const events = [
["IPO-1","NLH Luxon Mystery Bounty - Flight A","March 26, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-3","NLH Irish Open Deaf Championship - Flight A","March 26, 2026","1:00 PM",200,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-2","Satellite to Luxon Mystery Bounty","March 26, 2026","1:00 PM",255,25000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-4","Big O Championship","March 26, 2026","2:00 PM",350,25000,"20","Unlimited","Big O",0,0,0,0,0,0,"",""],
["IPO-5","Super Seniors Championships (60 Years Young)","March 26, 2026","3:00 PM",250,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-6","NLH Mini Irish Open - Flight A","March 26, 2026","6:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-102","Spin n' Go - On Demand","March 26, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-8","PLO Irish Open Deaf Championship","March 26, 2026","7:00 PM",120,10000,"20","1","PLO",0,0,0,0,0,0,"",""],
["IPO-7","Satellite to #14 €3,000 Cuatro PLO High Roller","March 26, 2026","7:00 PM",650,30000,"20","Unlimited","PLO",0,0,0,0,1,0,"",""],
["IPO-9","Satellite to Luxon Mystery Bounty","March 26, 2026","8:00 PM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-501","Spin n' Go - On Demand","March 26, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-10","Satellite to Luxon Mystery Bounty","March 27, 2026","11:00 AM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-1","NLH Luxon Mystery Bounty - Flight B","March 27, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-3","NLH Irish Open Deaf Championship - Flight B","March 27, 2026","1:00 PM",200,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-11","Satellite to #14 €3,000 Cuatro PLO High Roller","March 27, 2026","1:00 PM",650,30000,"20","","PLO",0,0,0,0,1,0,"",""],
["IPO-14","PLO Cuatro High Roller 8-Max - Day 1","March 27, 2026","2:00 PM",3000,50000,"30","Unlimited","PLO",0,0,0,0,0,0,"",""],
["IPO-13","Satellite to Luxon Mystery Bounty","March 27, 2026","2:00 PM",255,25000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-12","Sviten Special Championship","March 27, 2026","2:00 PM",350,25000,"20","Unlimited","Sviten Special",0,0,0,0,0,0,"",""],
["IPO-15","NLH APAT Championship - Day 1","March 27, 2026","3:00 PM",250,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-16","Flutter Invitational Tournament","March 27, 2026","6:00 PM",0,10000,"20","","NLH",0,0,0,0,0,0,"",""],
["IPO-6","NLH Mini Irish Open - Flight B","March 27, 2026","6:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-102","Spin n' Go - On Demand","March 27, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-17","NLH Irish Open Deaf Championship","March 27, 2026","7:00 PM",120,10000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-18","Satellite to Luxon Mystery Bounty","March 27, 2026","8:00 PM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-502","Spin n' Go - On Demand","March 27, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-19","Satellite to Luxon Mystery Bounty","March 28, 2026","11:00 AM",255,25000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-15","NLH APAT Championship - Final","March 28, 2026","12:00 PM",250,25000,"20","1","NLH",0,0,0,0,0,1,"IPO-15",""],
["IPO-3","NLH Irish Open Deaf Championship - Final","March 28, 2026","12:00 PM",200,25000,"20","1","NLH",0,0,0,0,0,1,"IPO-3",""],
["IPO-1","NLH Luxon Mystery Bounty - Flight C","March 28, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-14","PLO Cuatro High Roller 8-Max - Final","March 28, 2026","1:00 PM",3000,50000,"30","Unlimited","PLO",0,0,0,0,0,1,"IPO-14",""],
["IPO-20","PLO 7-Max","March 28, 2026","1:00 PM",1150,50000,"30","1","PLO",0,0,0,0,0,0,"",""],
["IPO-22","NLH Irish Open Deaf Mystery Bounty","March 28, 2026","2:00 PM",150,10000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-23","Mixed 8-Game Championship - Day 1","March 28, 2026","2:00 PM",350,25000,"20","Unlimited","Mixed",0,0,0,0,0,0,"",""],
["IPO-21","Satellite to Luxon Mystery Bounty","March 28, 2026","2:00 PM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-24","Satellite to Luxon Mystery Bounty","March 28, 2026","5:00 PM",255,25000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-6","NLH Mini Irish Open - Flight C","March 28, 2026","6:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-102","Spin n' Go - On Demand","March 28, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-1","NLH Luxon Mystery Bounty - Flight D","March 28, 2026","8:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-503","Spin n' Go - On Demand","March 28, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-25","Satellite to Irish Open","March 29, 2026","11:00 AM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-101","Select Invitational Tournament","March 29, 2026","11:00 AM",0,10000,"20","","NLH",0,0,0,0,0,0,"",""],
["IPO-26","NLH Irish Open Main Event - Flight A","March 29, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-1","NLH Luxon Mystery Bounty - Day 2","March 29, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,1,"IPO-1",""],
["IPO-23","Mixed 8-Game Championship - Final","March 29, 2026","12:00 PM",350,25000,"20","Unlimited","Mixed",0,0,0,0,0,1,"IPO-23",""],
["IPO-27","Satellite to #31 €3,000 Cuatro NLH High Roller","March 29, 2026","1:00 PM",650,30000,"20","","NLH",0,0,0,0,1,0,"",""],
["IPO-31","NLH Cuatro High Roller 8-Max - Day 1","March 29, 2026","2:00 PM",3000,50000,"30","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-28","HORSE Championship - Day 1","March 29, 2026","2:00 PM",350,25000,"20","Unlimited","HORSE",0,0,0,0,0,0,"",""],
["IPO-30","NLH Irish Open Deaf High Roller","March 29, 2026","2:00 PM",350,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-29","Satellite to Irish Open","March 29, 2026","2:00 PM",255,25000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-32","Kings and Queens - Flight A","March 29, 2026","3:00 PM",250,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-32","Kings and Queens - Flight B","March 29, 2026","6:00 PM",250,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-6","NLH Mini Irish Open - Flight D","March 29, 2026","6:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-102","Spin n' Go - On Demand","March 29, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-33","Satellite to Irish Open","March 29, 2026","8:00 PM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-504","Spin n' Go - On Demand","March 29, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-34","NLH Flip and Go - Day 1","March 29, 2026","9:00 PM",115,10000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-35","2-7 Triple Draw Championship","March 30, 2026","12:00 PM",350,25000,"20","Unlimited","2-7 Triple Draw",0,0,0,0,0,0,"",""],
["IPO-34","NLH Flip and Go - Final","March 30, 2026","12:00 PM",115,10000,"20","Unlimited","NLH",0,0,0,0,0,1,"IPO-34",""],
["IPO-28","HORSE Championship - Final","March 30, 2026","12:00 PM",350,25000,"20","Unlimited","HORSE",0,0,0,0,0,1,"IPO-28",""],
["IPO-32","Kings and Queens - Final","March 30, 2026","12:00 PM",250,25000,"20","","NLH",0,0,0,0,0,1,"IPO-32",""],
["IPO-1","NLH Luxon Mystery Bounty - Day 3","March 30, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,1,"IPO-1",""],
["IPO-31","NLH Cuatro High Roller 8-Max - Final","March 30, 2026","1:00 PM",3000,50000,"30","Unlimited","NLH",0,0,0,0,0,1,"IPO-31",""],
["IPO-36","Satellite to #38 PLO High Roller","March 30, 2026","1:00 PM",550,30000,"20","Unlimited","PLO",0,0,0,0,1,0,"",""],
["IPO-37","NLH 6-Max Championship - Day 1","March 30, 2026","2:00 PM",350,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-38","PLO High Roller 8-Max - Day 1","March 30, 2026","2:00 PM",5000,100000,"40","Unlimited","PLO",0,0,0,0,0,0,"",""],
["IPO-39","Satellite to Irish Open Main Event","March 30, 2026","5:00 PM",255,25000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-6","NLH Mini Irish Open - Flight E","March 30, 2026","6:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-102","Spin n' Go - On Demand","March 30, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-40","NLH 8-Max - Day 1","March 30, 2026","7:00 PM",1150,50000,"30","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-41","Satellite to Irish Open","March 30, 2026","8:00 PM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-505","Spin n' Go - On Demand","March 30, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-43","NLH Irish Open Heads-Up Championship Event - Round 1","March 31, 2026","12:00 PM",350,25000,"20","","NLH",0,0,0,0,0,0,"",""],
["IPO-42","Mixed 8-Game Championship High Roller - Day 1","March 31, 2026","12:00 PM",1150,50000,"30","Unlimited","Mixed",0,0,0,0,0,0,"",""],
["IPO-37","NLH 6-Max Championship - Final","March 31, 2026","12:00 PM",350,25000,"20","1","NLH",0,0,0,0,0,1,"IPO-37",""],
["IPO-1","NLH Luxon Mystery Bounty - Final","March 31, 2026","1:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,1,"IPO-1",""],
["IPO-40","NLH 8-Max - Final","March 31, 2026","1:00 PM",1150,50000,"30","Unlimited","NLH",0,0,0,0,0,1,"IPO-40",""],
["IPO-38","PLO High Roller 8-Max - Final","March 31, 2026","1:00 PM",5000,100000,"40","Unlimited","PLO",0,0,0,0,0,1,"IPO-38",""],
["IPO-44","Satellite to #46 NLH High Roller","March 31, 2026","1:00 PM",550,30000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-46","NLH High Roller 8-Max - Day 1","March 31, 2026","2:00 PM",5000,100000,"40","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-45","NLH The Hendon Mob Championship \"THMC\" - Day 1","March 31, 2026","2:00 PM",350,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-43","NLH Irish Open Heads-Up Championship Event - Round 2","March 31, 2026","3:00 PM",350,25000,"20","","NLH",0,0,0,0,0,1,"IPO-43",""],
["IPO-47","Satellite to Irish Open Main Event","March 31, 2026","5:00 PM",255,25000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-43","NLH Irish Open Heads-Up Championship Event - Round 3","March 31, 2026","6:00 PM",350,25000,"20","","NLH",0,0,0,0,0,1,"IPO-43",""],
["IPO-6","NLH Mini Irish Open - Flight F","March 31, 2026","6:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-102","Spin n' Go - On Demand","March 31, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-49","PLO 8-Max - Day 1","March 31, 2026","7:00 PM",1150,50000,"30","Unlimited","PLO",0,0,0,0,0,0,"",""],
["IPO-50","Satellite to Irish Open","March 31, 2026","8:00 PM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-506","Spin n' Go - On Demand","March 31, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-43","NLH Irish Open Heads-Up Championship Event - Round 4","March 31, 2026","9:00 PM",350,25000,"20","","NLH",0,0,0,0,0,1,"IPO-43",""],
["IPO-51","Satellite to Irish Open Main Event","April 1, 2026","11:00 AM",255,25000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-26","NLH Irish Open Main Event - Flight B","April 1, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-43","NLH Irish Open Heads-Up Championship Event - Quarter-Final","April 1, 2026","12:00 PM",350,25000,"20","","NLH",0,0,0,0,0,1,"IPO-43",""],
["IPO-42","Mixed 8-Game Championship High Roller - Final","April 1, 2026","12:00 PM",1150,50000,"30","Unlimited","Mixed",0,0,0,0,0,1,"IPO-42",""],
["IPO-52","OFC Pineapple Championship","April 1, 2026","12:00 PM",350,25000,"20","Unlimited","OFC Pineapple",0,0,0,0,0,0,"",""],
["IPO-49","PLO 8-Max - Final","April 1, 2026","12:00 PM",1150,50000,"30","Unlimited","PLO",0,0,0,0,0,1,"IPO-49",""],
["IPO-45","NLH The Hendon Mob Championship \"THMC\" - Final","April 1, 2026","12:00 PM",350,25000,"20","1","NLH",0,0,0,0,0,1,"IPO-45",""],
["IPO-46","NLH High Roller 8-Max - Final","April 1, 2026","1:00 PM",5000,100000,"40","Unlimited","NLH",0,0,0,0,0,1,"IPO-46",""],
["IPO-54","NLH Super High Roller 8-Max - Day 1","April 1, 2026","1:00 PM",10000,100000,"40","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-53","Satellite to #54 NLH Super High Roller","April 1, 2026","1:00 PM",1050,50000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-55","NLH America's Cup - Day 1","April 1, 2026","2:00 PM",350,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-43","NLH Irish Open Heads-Up Championship Event - Semi-Final","April 1, 2026","3:00 PM",350,25000,"20","","NLH",0,0,0,0,0,1,"IPO-43",""],
["IPO-56","Satellite to Irish Open","April 1, 2026","4:00 PM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-43","NLH Irish Open Heads-Up Championship Event - Final","April 1, 2026","6:00 PM",350,25000,"20","","NLH",0,0,0,0,0,1,"IPO-43",""],
["IPO-6","NLH Mini Irish Open - Flight G","April 1, 2026","6:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-57","PLO 6-Max Championship - Day 1","April 1, 2026","6:00 PM",350,25000,"20","1","PLO",0,0,0,0,0,0,"",""],
["IPO-102","Spin n' Go - On Demand","April 1, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-58","Satellite to Irish Open","April 1, 2026","8:00 PM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-507","Spin n' Go - On Demand","April 1, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-59","NLH Flip and Go - Day 1","April 1, 2026","9:00 PM",115,10000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-60","Satellite to Irish Open Main Event","April 2, 2026","11:00 AM",255,25000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-55","NLH America's Cup - Final","April 2, 2026","12:00 PM",350,25000,"20","1","NLH",0,0,0,0,0,1,"IPO-55",""],
["IPO-59","NLH Flip and Go - Final","April 2, 2026","12:00 PM",115,10000,"20","Unlimited","NLH",0,0,0,0,0,1,"IPO-59",""],
["IPO-26","NLH Irish Open Main Event - Flight C","April 2, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-61","Ladies Championship - Day 1","April 2, 2026","1:00 PM",250,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-54","NLH Super High Roller 8-Max - Final","April 2, 2026","1:00 PM",10000,100000,"40","Unlimited","NLH",0,0,0,0,0,1,"IPO-54",""],
["IPO-57","PLO 6-Max Championship - Final","April 2, 2026","1:00 PM",350,25000,"20","1","PLO",0,0,0,0,0,1,"IPO-57",""],
["IPO-62","NLH Spraggy Mystery Bounty","April 2, 2026","2:00 PM",550,30000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-63","Seniors High Roller Championship (50 Years Young) - Day 1","April 2, 2026","3:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-64","Satellite to Irish Open","April 2, 2026","4:00 PM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-102","Spin n' Go - On Demand","April 2, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-6","NLH Mini Irish Open - Flight H","April 2, 2026","7:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-65","Satellite to Irish Open","April 2, 2026","8:00 PM",140,10000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-508","Spin n' Go - On Demand","April 2, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-66","Satellite to Irish Open Main Event","April 3, 2026","11:00 AM",255,25000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-26","NLH Irish Open Main Event - Flight D","April 3, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-61","Ladies Championship - Final","April 3, 2026","12:00 PM",250,25000,"20","1","NLH",0,0,0,0,0,1,"IPO-61",""],
["IPO-63","Seniors High Roller Championship (50 Years Young) - Final","April 3, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,1,"IPO-63",""],
["IPO-67","NLH Shoot-out Championship - Round 1","April 3, 2026","12:00 PM",550,30000,"30","","NLH",0,0,0,0,0,0,"",""],
["IPO-68","Turbo Satellite to Irish Open","April 3, 2026","2:00 PM",140,10000,"15","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-69","PLO 5 Card","April 3, 2026","3:00 PM",550,30000,"30","1","PLO",0,0,0,0,0,0,"",""],
["IPO-67","NLH Shoot-out Championship - Round 2","April 3, 2026","3:00 PM",550,30000,"30","","NLH",0,0,0,0,0,1,"IPO-67",""],
["IPO-70","Turbo Satellite to Irish Open","April 3, 2026","4:00 PM",255,25000,"15","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-71","Hyper Turbo Satellite to Irish Open","April 3, 2026","6:00 PM",255,25000,"15","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-6","NLH Mini Irish Open - Flight I","April 3, 2026","6:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-102","Spin n' Go - On Demand","April 3, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-67","NLH Shoot-out Championship - Final","April 3, 2026","7:00 PM",550,30000,"30","","NLH",0,0,0,0,0,1,"IPO-67",""],
["IPO-26","NLH Irish Open Main Event - Flight E","April 3, 2026","8:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-509","Spin n' Go - On Demand","April 3, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-6","NLH Mini Irish Open - Flight J","April 4, 2026","11:00 AM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-26","NLH Irish Open Main Event - Day 2","April 4, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,1,"IPO-26",""],
["IPO-72","Satellite to #74 €3,000 High Roller","April 4, 2026","1:00 PM",650,30000,"20","Unlimited","NLH",0,0,0,0,1,0,"",""],
["IPO-73","NLH JP Poker Masters - Day 1","April 4, 2026","2:00 PM",550,30000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-74","NLH High Roller 8-Max - Day 1","April 4, 2026","4:00 PM",3000,50000,"30","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-6","NLH Mini Irish Open - Flight K","April 4, 2026","6:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-102","Spin n' Go - On Demand","April 4, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-75","Old Dogs and Young Pups - Flight A","April 4, 2026","7:00 PM",250,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-75","Old Dogs and Young Pups - Flight B","April 4, 2026","7:00 PM",250,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-76","PLO Mystery Bounty 8-Max - Day 1","April 4, 2026","8:00 PM",1150,50000,"30","Unlimited","PLO",0,0,0,0,0,0,"",""],
["IPO-510","Spin n' Go - On Demand","April 4, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-6","NLH Mini Irish Open - Flight L","April 5, 2026","11:00 AM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-74","NLH High Roller 8-Max - Final","April 5, 2026","12:00 PM",3000,50000,"30","Unlimited","NLH",0,0,0,0,0,1,"IPO-74",""],
["IPO-26","NLH Irish Open Main Event - Day 3","April 5, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,1,"IPO-26",""],
["IPO-73","NLH JP Poker Masters - Final","April 5, 2026","12:00 PM",550,30000,"30","1","NLH",0,0,0,0,0,1,"IPO-73",""],
["IPO-77","NLH Mystery Bounty - Day 1","April 5, 2026","12:00 PM",1150,50000,"30","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-75","Old Dogs and Young Pups - Final","April 5, 2026","1:00 PM",250,25000,"20","1","NLH",0,0,0,0,0,1,"IPO-75",""],
["IPO-76","PLO Mystery Bounty 8-Max - Final","April 5, 2026","1:00 PM",1150,50000,"30","Unlimited","PLO",0,0,0,0,0,1,"IPO-76",""],
["IPO-78","Ladies High Roller Championship - Day 1","April 5, 2026","2:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,0,"",""],
["IPO-6","NLH Mini Irish Open - Flight M","April 5, 2026","3:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-79","PLO 4/5/6","April 5, 2026","4:00 PM",550,30000,"30","1","PLO",0,0,0,0,0,0,"",""],
["IPO-80","Seniors Championship - Day 1","April 5, 2026","6:00 PM",350,25000,"20","1","NLH",0,0,0,0,0,0,"",""],
["IPO-102","Spin n' Go - On Demand","April 5, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-6","NLH Mini Irish Open - Flight N","April 5, 2026","8:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-511","Spin n' Go - On Demand","April 5, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-81","NLH Flip and Go - Day 1","April 5, 2026","9:00 PM",115,10000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-81","NLH Flip and Go - Final","April 6, 2026","12:00 PM",115,10000,"20","Unlimited","NLH",0,0,0,0,0,1,"IPO-81",""],
["IPO-78","Ladies High Roller Championship - Final","April 6, 2026","12:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,1,"IPO-78",""],
["IPO-6","NLH Mini Irish Open - Final","April 6, 2026","12:00 PM",250,25000,"20","Unlimited","NLH",0,0,0,0,0,1,"IPO-6",""],
["IPO-77","NLH Mystery Bounty - Final","April 6, 2026","12:00 PM",1150,50000,"30","Unlimited","NLH",0,0,0,0,0,1,"IPO-77",""],
["IPO-83","PLO 6-Max","April 6, 2026","12:00 PM",550,30000,"30","1","PLO",0,0,0,0,0,0,"",""],
["IPO-82","NLH Triathlon Championship","April 6, 2026","12:00 PM",350,25000,"20","Unlimited","NLH",0,0,0,0,0,0,"",""],
["IPO-26","NLH Irish Open Main Event - Final","April 6, 2026","1:00 PM",1150,50000,"30","1","NLH",0,0,0,0,0,1,"IPO-26",""],
["IPO-80","Seniors Championship - Final","April 6, 2026","1:00 PM",350,25000,"20","1","NLH",0,0,0,0,0,1,"IPO-80",""],
["IPO-84","NLH Turbo 8-Max","April 6, 2026","2:00 PM",1150,50000,"15","1","NLH",0,0,0,0,0,0,"",""],
["IPO-85","NLH Liam Flood Memorial 6-Max Turbo","April 6, 2026","4:00 PM",350,25000,"15","1","NLH",0,0,0,0,0,0,"",""],
["IPO-86","NLH Turbo","April 6, 2026","6:00 PM",250,25000,"15","1","NLH",0,0,0,0,0,0,"",""],
["IPO-512","Spin n' Go - On Demand","April 6, 2026","8:00 PM",50,10000,"20","","NLH",0,0,0,0,0,0,"","side"],
["IPO-102","Spin n' Go - Final","April 7, 2026","6:00 PM",50,10000,"20","","NLH",0,0,0,0,0,1,"IPO-102","side"]
        ];
        const ins = db.prepare("INSERT INTO tournaments (event_number, event_name, date, time, buyin, starting_chips, level_duration, reentry, game_variant, venue, source_pdf, house_fee, rake_pct, rake_dollars, is_deepstack, is_satellite, is_restart, parent_event, category) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        for (const e of events) {
          ins.run([e[0],e[1],e[2],e[3],e[4],e[5],e[6],e[7],e[8],'Irish Poker Open','IPO Website 2026',e[9],e[10],e[11],e[12],e[13],e[14],e[15],e[16]]);
        }
        ins.free();
        console.log('IPO rebuild: deleted ' + deleted + ', inserted ' + events.length + ' events');
      }
    },
    {
      name: 'ipo-spinandgo-side-2026-03',
      fn: () => {
        db.run("UPDATE tournaments SET category = 'side' WHERE venue = 'Irish Poker Open' AND event_name LIKE 'Spin n%'");
        console.log(`IPO Spin n Go set to side: ${db.getRowsModified()} rows`);
      }
    },
    {
      name: 'rename-triathlon-2026-03',
      fn: () => {
        db.run(`UPDATE tournaments SET event_name = 'NLH Triathlon Championship - Unlimited Re-Entry' WHERE event_name LIKE '%Triathlon Championship%' AND venue = 'Irish Poker Open'`);
        console.log(`Renamed Triathlon Championship: ${db.getRowsModified()} rows`);
      }
    },
    {
      name: 'add-stable-id-2026-03',
      fn: () => {
        // Add column if not exists
        try { db.run(`ALTER TABLE tournaments ADD COLUMN stable_id TEXT`); } catch (e) { /* already exists */ }

        // Build venue abbreviation map (server-side copy)
        const VENUE_ABBR = {
          'Horseshoe / Paris Las Vegas': 'WSOP',
          'Horseshoe Las Vegas': 'WSOP',
          'Paris Las Vegas': 'PRS',
          'Wynn Las Vegas': 'WYNN',
          'Wynn': 'WYNN',
          'Aria': 'ARIA',
          'Aria Resort & Casino': 'ARIA',
          'Resorts World': 'RW',
          'Venetian': 'VEN',
          'Golden Nugget': 'GN',
          'South Point': 'SP',
          'Orleans': 'ORL',
          'MGM Grand': 'MGM',
          'MGM National Harbor': 'MGMNH',
          'Irish Poker Open': 'IPO',
          'Personal': 'PERSONAL',
          'Turning Stone Casino': 'WSOPC-TS',
          'Texas Card House': 'WSOPC-TCH',
          'Caesars Palace': 'CAESARS',
          'Seminole Hard Rock': 'SHR',
          'WSOP Europe': 'WSOPE',
          'WSOPC Horseshoe Las Vegas': 'WSOPC-LV',
        };

        function generateStableId(row) {
          const abbr = VENUE_ABBR[row.venue] || row.venue.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
          const date = row.date; // already YYYY-MM-DD

          // Extract event number
          let evNum = String(row.event_number || '').replace(/^(IPO-|WSOP-|#)/i, '').trim();

          // Extract flight letter from event name
          const flightMatch = row.event_name.match(/Flight\s+([A-Z])\b/i) || row.event_name.match(/- ([A-Z])$/);
          const flight = flightMatch ? flightMatch[1].toUpperCase() : '';

          // Extract Day number for restarts
          const dayMatch = row.event_name.match(/Day\s+(\d+)/i);
          const day = dayMatch ? 'D' + dayMatch[1] : '';

          if (evNum) {
            return `${abbr}-${evNum}${flight}${day}-${date}`;
          }

          // No event number — use sanitized event name
          const namePart = row.event_name
            .replace(/[^a-zA-Z0-9 ]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 40)
            .toUpperCase();
          return `${abbr}-${namePart}${flight}${day}-${date}`;
        }

        // Backfill all tournaments
        const stmt = db.prepare('SELECT id, event_number, event_name, date, venue FROM tournaments WHERE stable_id IS NULL');
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();

        const update = db.prepare('UPDATE tournaments SET stable_id = ? WHERE id = ?');
        const usedIds = new Set();
        let count = 0;
        for (const row of rows) {
          let sid = generateStableId(row);
          // Ensure uniqueness — append row id if collision
          if (usedIds.has(sid)) sid = sid + '-' + row.id;
          usedIds.add(sid);
          update.run([sid, row.id]);
          count++;
        }
        update.free();

        // Create unique index
        try { db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_stable_id ON tournaments(stable_id)`); } catch (e) { console.log('stable_id index:', e.message); }

        console.log(`Backfilled stable_id for ${count} tournaments`);
      }
    },
    {
      name: 'ipo-chips-levels-fix-2026-03',
      fn: () => {
        // Fix IPO starting chips and level durations to match 2026 website data
        const fixes = [
          ["UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-1A-March 26, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-3A-March 26, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-2-March 26, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-4-March 26, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '25' WHERE stable_id = 'IPO-5-March 26, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6A-March 26, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-March 26, 2026'"],
          ["UPDATE tournaments SET starting_chips = 20000 WHERE stable_id = 'IPO-8-March 26, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-7-March 26, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-501-March 26, 2026'"],
          ["UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-1B-March 27, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-3B-March 27, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-11-March 27, 2026'"],
          ["UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-14D1-March 27, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-13-March 27, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-12-March 27, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '25' WHERE stable_id = 'IPO-15D1-March 27, 2026'"],
          ["UPDATE tournaments SET level_duration = '10' WHERE stable_id = 'IPO-16-March 27, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6B-March 27, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-March 27, 2026'"],
          ["UPDATE tournaments SET starting_chips = 20000 WHERE stable_id = 'IPO-17-March 27, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-502-March 27, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-19-March 28, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '25' WHERE stable_id = 'IPO-15-March 28, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-3-March 28, 2026'"],
          ["UPDATE tournaments SET level_duration = '20' WHERE stable_id = 'IPO-1C-March 28, 2026'"],
          ["UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-14-March 28, 2026'"],
          ["UPDATE tournaments SET level_duration = '25' WHERE stable_id = 'IPO-20-March 28, 2026'"],
          ["UPDATE tournaments SET starting_chips = 20000 WHERE stable_id = 'IPO-22-March 28, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-23D1-March 28, 2026'"],
          ["UPDATE tournaments SET level_duration = '15' WHERE stable_id = 'IPO-21-March 28, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000, level_duration = '15' WHERE stable_id = 'IPO-24-March 28, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6C-March 28, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-March 28, 2026'"],
          ["UPDATE tournaments SET level_duration = '20' WHERE stable_id = 'IPO-1D-March 28, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-503-March 28, 2026'"],
          ["UPDATE tournaments SET level_duration = '10' WHERE stable_id = 'IPO-101-March 29, 2026'"],
          ["UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-26A-March 29, 2026'"],
          ["UPDATE tournaments SET level_duration = '60' WHERE stable_id = 'IPO-1D2-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-23-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-27-March 29, 2026'"],
          ["UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-31D1-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-28D1-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '25' WHERE stable_id = 'IPO-30-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-29-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '25' WHERE stable_id = 'IPO-32A-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '25' WHERE stable_id = 'IPO-32B-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6D-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-504-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-34D1-March 29, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-35-March 30, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-34-March 30, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-28-March 30, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '25' WHERE stable_id = 'IPO-32-March 30, 2026'"],
          ["UPDATE tournaments SET level_duration = '60' WHERE stable_id = 'IPO-1D3-March 30, 2026'"],
          ["UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-31-March 30, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-36-March 30, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-37D1-March 30, 2026'"],
          ["UPDATE tournaments SET starting_chips = 50000 WHERE stable_id = 'IPO-38D1-March 30, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-39-March 30, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6E-March 30, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-March 30, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-505-March 30, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-37-March 31, 2026'"],
          ["UPDATE tournaments SET level_duration = '60' WHERE stable_id = 'IPO-1-March 31, 2026'"],
          ["UPDATE tournaments SET starting_chips = 50000 WHERE stable_id = 'IPO-38-March 31, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-44-March 31, 2026'"],
          ["UPDATE tournaments SET starting_chips = 50000 WHERE stable_id = 'IPO-46D1-March 31, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-45D1-March 31, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-47-March 31, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6F-March 31, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-March 31, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-506-March 31, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-51-April 1, 2026'"],
          ["UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-26B-April 1, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-52-April 1, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-45-April 1, 2026'"],
          ["UPDATE tournaments SET starting_chips = 50000 WHERE stable_id = 'IPO-46-April 1, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-53-April 1, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-55D1-April 1, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6G-April 1, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '25' WHERE stable_id = 'IPO-57D1-April 1, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-April 1, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-507-April 1, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-60-April 2, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-55-April 2, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-59-April 2, 2026'"],
          ["UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-26C-April 2, 2026'"],
          ["UPDATE tournaments SET level_duration = '30' WHERE stable_id = 'IPO-61D1-April 2, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-57-April 2, 2026'"],
          ["UPDATE tournaments SET level_duration = '25' WHERE stable_id = 'IPO-62-April 2, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-April 2, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6H-April 2, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-508-April 2, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-66-April 3, 2026'"],
          ["UPDATE tournaments SET level_duration = '20' WHERE stable_id = 'IPO-26D-April 3, 2026'"],
          ["UPDATE tournaments SET level_duration = '30' WHERE stable_id = 'IPO-61-April 3, 2026'"],
          ["UPDATE tournaments SET starting_chips = 20000, level_duration = '20' WHERE stable_id = 'IPO-67-April 3, 2026'"],
          ["UPDATE tournaments SET starting_chips = 20000, level_duration = '20' WHERE stable_id = 'IPO-67-April 3, 2026-1507'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-70-April 3, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000, level_duration = '10' WHERE stable_id = 'IPO-71-April 3, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6I-April 3, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-April 3, 2026'"],
          ["UPDATE tournaments SET starting_chips = 20000, level_duration = '20' WHERE stable_id = 'IPO-67-April 3, 2026-1512'"],
          ["UPDATE tournaments SET level_duration = '20' WHERE stable_id = 'IPO-26E-April 3, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-509-April 3, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6J-April 4, 2026'"],
          ["UPDATE tournaments SET level_duration = '60' WHERE stable_id = 'IPO-26D2-April 4, 2026'"],
          ["UPDATE tournaments SET starting_chips = 10000 WHERE stable_id = 'IPO-72-April 4, 2026'"],
          ["UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-74D1-April 4, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6K-April 4, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-April 4, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '25' WHERE stable_id = 'IPO-75A-April 4, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '25' WHERE stable_id = 'IPO-75B-April 4, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-510-April 4, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '15' WHERE stable_id = 'IPO-6L-April 5, 2026'"],
          ["UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-74-April 5, 2026'"],
          ["UPDATE tournaments SET level_duration = '60' WHERE stable_id = 'IPO-26D3-April 5, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '25' WHERE stable_id = 'IPO-75-April 5, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '15' WHERE stable_id = 'IPO-6M-April 5, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-80D1-April 5, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-April 5, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '15' WHERE stable_id = 'IPO-6N-April 5, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-511-April 5, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-6-April 6, 2026'"],
          ["UPDATE tournaments SET level_duration = '25' WHERE stable_id = 'IPO-83-April 6, 2026'"],
          ["UPDATE tournaments SET level_duration = '60' WHERE stable_id = 'IPO-26-April 6, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000, level_duration = '30' WHERE stable_id = 'IPO-80-April 6, 2026'"],
          ["UPDATE tournaments SET level_duration = '20' WHERE stable_id = 'IPO-84-April 6, 2026'"],
          ["UPDATE tournaments SET starting_chips = 30000 WHERE stable_id = 'IPO-85-April 6, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-512-April 6, 2026'"],
          ["UPDATE tournaments SET starting_chips = 4000, level_duration = '4' WHERE stable_id = 'IPO-102-April 7, 2026'"],
        ];
        let count = 0;
        for (const [sql] of fixes) {
          db.run(sql);
          count++;
        }
        console.log(`Fixed IPO chips/levels for ${count} events`);
      }
    },
    {
      name: 'ipo-chips-levels-fix2-2026-03',
      fn: () => {
        db.run("UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-1C-March 28, 2026'");
        db.run("UPDATE tournaments SET level_duration = '40' WHERE stable_id = 'IPO-26D-April 3, 2026'");
        db.run("UPDATE tournaments SET level_duration = '20' WHERE stable_id = 'IPO-6L-April 5, 2026'");
        db.run("UPDATE tournaments SET level_duration = '20' WHERE stable_id = 'IPO-6M-April 5, 2026'");
        console.log('Fixed 4 remaining IPO level mismatches');
        // Fix TCH Deepstack events - should be side events
        db.run("UPDATE tournaments SET category = 'side' WHERE stable_id = 'WSOPC-TCH-NLH-DEEPSTACK-April 26, 2026'");
        db.run("UPDATE tournaments SET category = 'side' WHERE stable_id = 'WSOPC-TCH-NLH-DEEPSTACK-May 2, 2026'");
        console.log('Fixed TCH Deepstack categories to side');
      }
    },
    {
      name: 'wynn-summer-classic-2026-03',
      fn: () => {
        // Clear any old Wynn placeholder events and re-seed with full schedule
        db.run("DELETE FROM tournaments WHERE venue = 'Wynn Las Vegas' OR venue = 'Wynn'");
        const d = db.getRowsModified();
        if (d > 0) console.log(`Cleared ${d} old Wynn events`);
        // Re-seed from wynn-events.json
        const seedPath = path.join(__dirname, 'wynn-events.json');
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
          console.log(`Seeded ${rows.length} Wynn Summer Classic events`);
        }
      }
    },
    {
      name: 'wynn-naming-conventions-2026-03',
      fn: () => {
        // Remove "Mixed " prefix from Wynn event names to match WSOP conventions
        db.run("UPDATE tournaments SET event_name = REPLACE(event_name, 'Mixed TORSE', 'TORSE') WHERE venue = 'Wynn Las Vegas' AND event_name LIKE '%Mixed TORSE%'");
        db.run("UPDATE tournaments SET event_name = REPLACE(event_name, 'Mixed TOE', 'TOE') WHERE venue = 'Wynn Las Vegas' AND event_name LIKE '%Mixed TOE%'");
        db.run("UPDATE tournaments SET event_name = REPLACE(event_name, 'Mixed Wynn Mix', 'Wynn Mix') WHERE venue = 'Wynn Las Vegas' AND event_name LIKE '%Mixed Wynn Mix%'");
        console.log('Fixed Wynn event naming conventions (removed Mixed prefix from TORSE, TOE, Wynn Mix)');
      }
    },
    {
      name: 'remove-borgata-2026-04',
      fn: () => {
        db.run("DELETE FROM tournaments WHERE venue LIKE '%Borgata%' OR venue LIKE '%borgata%'");
        const d = db.getRowsModified();
        if (d > 0) console.log(`Removed ${d} Borgata events`);
      }
    },
    {
      name: 'remove-deepstack-category-2026-04',
      fn: () => {
        // Convert all deepstack category events to side events
        db.run("UPDATE tournaments SET category = 'side' WHERE category = 'deepstack'");
        const d = db.getRowsModified();
        if (d > 0) console.log(`Converted ${d} deepstack events to side`);
      }
    },
    {
      name: 'remove-borgata-before-2026-04-03',
      fn: () => {
        db.run("DELETE FROM tournaments WHERE (venue LIKE '%Borgata%' OR venue LIKE '%borgata%') AND date < '2026-04-03'");
        const d = db.getRowsModified();
        if (d > 0) console.log(`Removed ${d} Borgata events before 2026-04-03`);
      }
    },
    {
      name: 'nuke-all-borgata-2026-04-03',
      fn: () => {
        // All Borgata imports had bad data from AI hallucinating wrong years — wipe clean for re-import
        db.run("DELETE FROM tournaments WHERE venue LIKE '%Borgata%' OR venue LIKE '%borgata%'");
        const d = db.getRowsModified();
        if (d > 0) console.log(`Nuked all ${d} remaining Borgata events for clean re-import`);
      }
    },
    {
      name: 'fix-all-past-year-dates-2026-04',
      fn: () => {
        // AI hallucinated years like 2020, 2023 from PDF headers — fix all dates before 2025 to 2026
        const rows = db.exec("SELECT id, date FROM tournaments WHERE date < '2025-01-01'");
        if (!rows.length || !rows[0].values.length) return;
        let fixed = 0;
        for (const [id, date] of rows[0].values) {
          if (date && /^\d{4}-/.test(date)) {
            const newDate = '2026' + date.slice(4);
            db.run("UPDATE tournaments SET date = ? WHERE id = ?", [newDate, id]);
            fixed++;
          }
        }
        if (fixed > 0) console.log(`Fixed ${fixed} tournament dates from past years to 2026`);
      }
    },
    {
      name: 'delete-events-before-april-2026',
      fn: () => {
        // After fixing years, remove any events that are still before April 2026 (clearly wrong)
        db.run("DELETE FROM tournaments WHERE date < '2026-04-01' AND venue NOT IN ('Horseshoe / Paris Las Vegas', 'Personal')");
        const d = db.getRowsModified();
        if (d > 0) console.log(`Removed ${d} events dated before April 2026`);
      }
    },
    {
      name: 'smart-category-detection-2026-04',
      fn: () => {
        // Re-detect Main Events per venue instead of trusting AI category
        // First reset all non-WSOP to side (WSOP seed data has correct categories)
        db.run("UPDATE tournaments SET category = 'side' WHERE venue NOT IN ('Horseshoe / Paris Las Vegas') AND category = 'main'");
        const reset = db.getRowsModified();

        // For each non-WSOP venue, find the Main Event
        const venueRows = db.exec("SELECT DISTINCT venue FROM tournaments WHERE venue NOT IN ('Horseshoe / Paris Las Vegas', 'Personal') AND venue IS NOT NULL");
        if (!venueRows.length) return;
        let mainCount = 0;
        for (const [venue] of venueRows[0].values) {
          // Check for explicitly named Main Event
          const explicit = db.exec("SELECT event_number FROM tournaments WHERE venue = ? AND event_name LIKE '%Main Event%' AND is_satellite = 0 AND is_restart = 0 LIMIT 1", [venue]);
          let mainNum = null;
          if (explicit.length && explicit[0].values.length) {
            mainNum = explicit[0].values[0][0];
          } else {
            // Pick highest buy-in event that has flights
            const best = db.exec("SELECT event_number, buyin FROM tournaments WHERE venue = ? AND is_satellite = 0 AND is_restart = 0 AND (event_name LIKE '%Flight%' OR event_name LIKE '%Day 1%') ORDER BY buyin DESC LIMIT 1", [venue]);
            if (best.length && best[0].values.length) {
              mainNum = best[0].values[0][0];
            } else {
              // Fallback: highest buy-in event
              const fallback = db.exec("SELECT event_number, buyin FROM tournaments WHERE venue = ? AND is_satellite = 0 AND is_restart = 0 ORDER BY buyin DESC LIMIT 1", [venue]);
              if (fallback.length && fallback[0].values.length) {
                mainNum = fallback[0].values[0][0];
              }
            }
          }
          if (mainNum) {
            db.run("UPDATE tournaments SET category = 'main' WHERE venue = ? AND (event_number = ? OR (is_restart = 1 AND parent_event = ?))", [venue, mainNum, mainNum]);
            mainCount += db.getRowsModified();
          }
        }
        if (reset > 0 || mainCount > 0) console.log(`Smart category: reset ${reset} to side, marked ${mainCount} as main`);
      }
    },
    {
      name: 'primary-side-categories-2026-04',
      fn: () => {
        // Reclassify: numbered events → primary, unnumbered → side
        // Satellites stay side, restarts → primary (continuation of numbered events)
        db.run("UPDATE tournaments SET category = 'primary' WHERE event_number IS NOT NULL AND event_number != '' AND is_satellite = 0");
        const primary = db.getRowsModified();
        db.run("UPDATE tournaments SET category = 'side' WHERE (event_number IS NULL OR event_number = '') AND is_satellite = 0 AND is_restart = 0");
        const side = db.getRowsModified();
        db.run("UPDATE tournaments SET category = 'primary' WHERE is_restart = 1");
        const restarts = db.getRowsModified();
        db.run("UPDATE tournaments SET category = 'side' WHERE is_satellite = 1");
        const sats = db.getRowsModified();
        console.log(`Categories: ${primary} primary, ${side} side, ${restarts} restarts→primary, ${sats} satellites→side`);
      }
    },
    {
      name: 'orleans-summer-open-2026-04',
      fn: () => {
        // Rename "Orleans Open" → "Orleans Summer Open" in event names
        db.run("UPDATE tournaments SET event_name = REPLACE(event_name, 'Orleans Open', 'Orleans Summer Open') WHERE event_name LIKE '%Orleans Open%'");
        const renamed = db.getRowsModified();
        console.log(`Orleans Open → Orleans Summer Open: ${renamed} events renamed`);

        // All Orleans events except "Bankroll Builder" are primary (not side events)
        db.run("UPDATE tournaments SET category = 'primary' WHERE venue LIKE '%Orleans%' AND event_name NOT LIKE '%Bankroll%' AND is_satellite = 0 AND is_restart = 0");
        const primary = db.getRowsModified();

        // Bankroll Builder events stay as side events
        db.run("UPDATE tournaments SET category = 'side' WHERE venue LIKE '%Orleans%' AND event_name LIKE '%Bankroll%'");
        const side = db.getRowsModified();
        console.log(`Orleans categories: ${primary} → primary, ${side} bankroll builders → side`);
      }
    },
    {
      name: 'strip-side-from-notes-2026-04',
      fn: () => {
        // Remove ", side" suffix from tournament notes (e.g. "$5,000 Guaranteed, side" → "$5,000 Guaranteed")
        db.run(`UPDATE tournaments SET notes = TRIM(REPLACE(REPLACE(notes, ', side', ''), ',side', '')) WHERE LOWER(notes) LIKE '%side%'`);
        // Clear notes that were just "side" alone
        db.run(`UPDATE tournaments SET notes = NULL WHERE LOWER(TRIM(notes)) = 'side' OR TRIM(notes) = ''`);
        const modified = db.getRowsModified();
        console.log(`Stripped 'side' from ${modified} tournament notes`);
      }
    },
    {
      name: 'wsopc-cherokee-venue-2026-04',
      fn: () => {
        // Events between May 7-18 were incorrectly assigned to Horseshoe/Paris by the schedule parser.
        // They are actually WSOPC Cherokee events.
        const mayDays = [];
        for (let d = 7; d <= 18; d++) mayDays.push(`May ${d}, 2026`);
        const isoStart = '2026-05-07';
        const isoEnd = '2026-05-18';
        // Handle human-readable date format
        const humanPlaceholders = mayDays.map(() => '?').join(',');
        db.run(
          `UPDATE tournaments SET venue = 'WSOPC Cherokee'
           WHERE venue = 'Horseshoe / Paris Las Vegas'
           AND (date IN (${humanPlaceholders}) OR (date >= ? AND date <= ?))`,
          [...mayDays, isoStart, isoEnd]
        );
        const changed = db.getRowsModified();
        console.log(`Reassigned ${changed} events from Horseshoe/Paris to WSOPC Cherokee (May 7-18)`);
      }
    },
    {
      name: 'strip-primary-notes-2026-04',
      fn: () => {
        // Remove "primary" from notes (case-insensitive), e.g. "Primary" → null
        // If notes is exactly "primary" (any case), set to null
        db.run(`UPDATE tournaments SET notes = NULL WHERE LOWER(TRIM(notes)) = 'primary'`);
        const exact = db.getRowsModified();
        // If notes contains "primary" among other text, strip it out
        db.run(`UPDATE tournaments SET notes = TRIM(REPLACE(REPLACE(notes, 'Primary', ''), 'primary', '')) WHERE notes LIKE '%primary%' OR notes LIKE '%Primary%'`);
        const partial = db.getRowsModified();
        // Clean up any notes that became empty after stripping
        db.run(`UPDATE tournaments SET notes = NULL WHERE TRIM(notes) = ''`);
        console.log(`Stripped "primary" from notes: ${exact} exact, ${partial} partial matches`);
      }
    },
    {
      name: 'retire-is-deepstack-2026-04',
      fn: () => {
        // Deepstacks are just side events — ensure all is_deepstack=1 events have category='side', then clear the flag
        db.run("UPDATE tournaments SET category = 'side' WHERE is_deepstack = 1 AND (category IS NULL OR category != 'side')");
        const c1 = db.getRowsModified();
        db.run("UPDATE tournaments SET is_deepstack = 0 WHERE is_deepstack = 1");
        const c2 = db.getRowsModified();
        if (c1 > 0 || c2 > 0) console.log(`Retired is_deepstack: ${c1} recategorized to side, ${c2} flags cleared`);
      }
    },
    {
      name: 'clear-cherokee-rake-2026-04',
      fn: () => {
        // The schedule parser hallucinated rake data for WSOPC Cherokee events —
        // the wsop.com schedule page has no rake information at all.
        db.run(`UPDATE tournaments SET rake_pct = NULL, rake_dollars = NULL, house_fee = NULL WHERE venue = 'WSOPC Cherokee'`);
        const changed = db.getRowsModified();
        console.log(`Cleared hallucinated rake data from ${changed} WSOPC Cherokee events`);
      }
    },
    {
      name: 'dedup-daily-deepstacks-2026-04',
      fn: () => {
        db.run(`DELETE FROM tournaments WHERE venue = 'Horseshoe / Paris Las Vegas' AND event_name LIKE '%Daily Deepstack%' AND stable_id IS NULL`);
        const deleted = db.getRowsModified();
        db.run(`UPDATE tournaments SET is_deepstack = 1 WHERE venue = 'Horseshoe / Paris Las Vegas' AND event_name LIKE '%Daily Deepstack%'`);
        console.log(`Removed ${deleted} duplicate Daily Deepstack events`);
      }
    },
    {
      name: 'strip-ring-event-titles-2026-04',
      fn: () => {
        db.run(`UPDATE tournaments SET event_name = TRIM(REPLACE(event_name, ' Ring Event', '')) WHERE event_name LIKE '%Ring Event%'`);
        const updated = db.getRowsModified();
        console.log(`Stripped "Ring Event" from ${updated} tournament titles`);
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
  // Runs after dataMigrations so the added columns (prize_pool/house_fee/rake_*) already
  // exist. Also re-runs hourly at :20 via cron (see app.listen) so the schedule tracks the
  // watcher's :15 emits without needing a restart.
  await ingestMttFeed();

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

  // ── Custom Game Definitions (Hand Replayer) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS replayer_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // ── Trainer graded hands (durable per-hand record for the mixed-games
  // trainer). The localStorage scoreboard stays the per-device session
  // aggregate; this table is the durable, cross-device record of every
  // graded hand so it can be reviewed later. per_round_json/hand_json hold
  // the per-street EV-loss array and the full graded-hand object the /step
  // route already produces (enough to re-display the hand). ──
  db.run(`
    CREATE TABLE IF NOT EXISTS trainer_hands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      game TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      ev_loss_total REAL NOT NULL,
      per_round_json TEXT,
      hand_json TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_trainer_hands_user_game ON trainer_hands(user_id, game, played_at)');

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
          t.startingChips || null, normalizeLevelDuration(t.levelDuration) || null,
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

  // Enable foreign key enforcement
  db.run('PRAGMA foreign_keys = ON');

  // Performance indexes for common tournament queries
  db.run('CREATE INDEX IF NOT EXISTS idx_tournaments_date ON tournaments(date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tournaments_buyin ON tournaments(buyin)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tournaments_game_variant ON tournaments(game_variant)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tournaments_venue ON tournaments(venue)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tournaments_venue_date ON tournaments(venue, date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_user_schedules_user_id ON user_schedules(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_user_schedules_tournament_id ON user_schedules(tournament_id)');

  // ── Subscriptions (monetization foundation) ──
  // One table holds every subscription event from every source (Apple,
  // Stripe, manual). The user's "current" tier is derived by querying
  // active rows and picking the highest-rank one. See MONETIZATION-PLAN
  // §11 for the design rationale.
  db.run(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tier TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER,
      trial_ends_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(user_id, status, ends_at)');

  // Track whether the user has ever started a trial — one trial per user lifetime.
  try {
    db.run('ALTER TABLE users ADD COLUMN trial_used_at INTEGER');
  } catch (e) { /* already exists */ }

  console.log('Database initialized');
}

// Save database to file
async function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  await fs.writeFile(DB_PATH, buffer);
}

// ── Stable ID generation (server-side) ──
const VENUE_ABBR_MAP = {
  'Horseshoe / Paris Las Vegas': 'WSOP', 'Horseshoe Las Vegas': 'WSOP',
  'Paris Las Vegas': 'PRS', 'Wynn Las Vegas': 'WYNN', 'Wynn': 'WYNN',
  'Aria': 'ARIA', 'Aria Resort & Casino': 'ARIA', 'Resorts World': 'RW',
  'Venetian': 'VEN', 'Golden Nugget': 'GN', 'South Point': 'SP',
  'Orleans': 'ORL', 'MGM Grand': 'MGM', 'MGM National Harbor': 'MGMNH',
  'Irish Poker Open': 'IPO', 'Personal': 'PERSONAL',
  'Turning Stone Casino': 'WSOPC-TS', 'Texas Card House': 'WSOPC-TCH',
  'Caesars Palace': 'CAESARS', 'Seminole Hard Rock': 'SHR', 'WSOP Europe': 'WSOPE',
  'Foxwoods': 'FOX', 'Thunder Valley': 'TV', 'Bellagio': 'BEL',
  'Lodge Poker Club': 'LODGE', 'bestbet Jacksonville': 'BESTBET',
  "Bally's Lake Tahoe": 'BALLY', "Harrah's Cherokee": 'CHEROKEE',
  'Choctaw Casino': 'CHOCTAW', 'Horseshoe Tunica': 'TUNICA',
  'WSOPC Horseshoe Las Vegas': 'WSOPC-LV',
};

function generateStableId(venue, eventNumber, eventName, date, time, buyin) {
  const abbr = VENUE_ABBR_MAP[venue] || (venue || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  let evNum = String(eventNumber || '').replace(/^(IPO-|WSOP-|#)/i, '').trim();
  const flightMatch = eventName.match(/Flight\s+([A-Z])\b/i) || eventName.match(/- ([A-Z])$/);
  const flight = flightMatch ? flightMatch[1].toUpperCase() : '';
  const dayMatch = eventName.match(/Day\s+(\d+)/i);
  const day = dayMatch ? 'D' + dayMatch[1] : '';
  // With event number: deterministic key regardless of AI-generated name
  if (evNum) return `${abbr}-${evNum}${flight}${day}-${date}`;
  // Without event number: use date + time + buyin as objective identifiers
  // This stays stable across re-parses even if the AI names things differently
  const timeKey = (time || '').replace(/[^0-9APMapm]/g, '').toUpperCase() || 'NOTIME';
  const buyinKey = buyin ? String(buyin) : '0';
  return `${abbr}-${date}-${timeKey}-${buyinKey}${flight}${day}`;
}

// ── Upsert tournament (safe update — never deletes, preserves id) ──
function upsertTournament(data) {
  const sid = data.stable_id || generateStableId(data.venue, data.event_number, data.event_name, data.date, data.time, data.buyin);
  db.run(`INSERT INTO tournaments (stable_id, event_number, event_name, date, time, buyin, starting_chips, level_duration, reentry, late_reg, late_reg_end, game_variant, venue, notes, category, is_satellite, target_event, is_restart, parent_event, day_length)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stable_id) DO UPDATE SET
      event_number=excluded.event_number, event_name=excluded.event_name,
      date=excluded.date, time=excluded.time, buyin=excluded.buyin,
      starting_chips=excluded.starting_chips, level_duration=excluded.level_duration,
      reentry=excluded.reentry, late_reg=excluded.late_reg, late_reg_end=excluded.late_reg_end,
      game_variant=excluded.game_variant, venue=excluded.venue, notes=excluded.notes,
      category=excluded.category, is_satellite=excluded.is_satellite, target_event=excluded.target_event,
      is_restart=excluded.is_restart, parent_event=excluded.parent_event, day_length=excluded.day_length`,
    [sid, data.event_number || null, data.event_name, data.date, data.time || '', data.buyin || 0,
     data.starting_chips || null, data.level_duration || null, data.reentry || null,
     data.late_reg || null, data.late_reg_end || null, data.game_variant, data.venue,
     data.notes || null, data.category || null, data.is_satellite || 0, data.target_event || null,
     data.is_restart || 0, data.parent_event || null, data.day_length || null]);
  return sid;
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

// Broadcast an event to every connected SSE client (all users).
// Used for tournament data changes that affect the global schedule view.
function broadcastToAll(eventType, payload) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const [userId, clients] of sseClients) {
    for (const res of clients) {
      try {
        res.write(message);
      } catch (err) {
        // Connection is dead — drop it from the set
        try { clients.delete(res); } catch {}
      }
    }
    if (clients.size === 0) sseClients.delete(userId);
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

    // Reject case-insensitive duplicate username/email. The UNIQUE index is
    // BINARY-collated, so without this a look-alike account (e.g. 'HAM' vs 'ham')
    // could be registered — which is exactly what would defeat username-based
    // owner/admin checks elsewhere. Case-fold the namespace here.
    const dup = db.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)');
    dup.bind([username, email]);
    let exists = false;
    if (dup.step()) exists = true;
    dup.free();
    if (exists) return res.status(409).json({ error: 'Username or email already taken' });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    db.run(
      'INSERT INTO users (username, email, password, real_name) VALUES (?, ?, ?, ?)',
      [username, email, hashedPassword, realName.trim()]
    );

    await saveDatabase();

    // Notify admin of new registration
    sendPushToAdmin('New User', `${username} (${realName.trim()}) just registered`).catch(() => {});

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
      expiresIn: '90d'
    });

    // Also drop the JWT as an httpOnly session cookie so a same-origin navigation
    // to /console carries it (shared login with the console). Header-based
    // Bearer auth for the main app is unchanged.
    setSessionCookie(res, token);

    res.json({ token, username: user.username, userId: user.id, avatar: user.avatar || null, realName: user.real_name || null, handReplayerAccess: !!user.hand_replayer_access });
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
      const evName = normalizeEventName(tournament.eventName || 'Unknown Event', tournament.gameVariant);
      const evVenue = tournament.venue || 'Horseshoe / Paris Las Vegas';
      const sid = generateStableId(evVenue, tournament.eventNumber, evName, tournament.date, tournament.time, tournament.buyin);
      db.run(
        `INSERT INTO tournaments (stable_id, event_number, event_name, date, time, buyin, starting_chips, level_duration, reentry, late_reg, game_variant, venue, notes, is_satellite, target_event, is_restart, parent_event, prize_pool, house_fee, opt_add_on, rake_pct, rake_dollars, uploaded_by, source_pdf, is_deepstack)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(stable_id) DO UPDATE SET
           event_name=excluded.event_name, date=excluded.date, time=excluded.time,
           buyin=excluded.buyin, starting_chips=excluded.starting_chips, level_duration=excluded.level_duration,
           reentry=excluded.reentry, late_reg=excluded.late_reg, game_variant=excluded.game_variant,
           venue=excluded.venue, notes=excluded.notes, is_satellite=excluded.is_satellite,
           target_event=excluded.target_event, is_restart=excluded.is_restart, parent_event=excluded.parent_event`,
        [
          sid,
          tournament.eventNumber || '',
          evName,
          tournament.date,
          tournament.time || '12:00PM',
          tournament.buyin,
          tournament.startingChips || null,
          normalizeLevelDuration(tournament.levelDuration) || null,
          normalizeReentry(tournament.reentry) || null,
          tournament.lateReg || null,
          tournament.gameVariant,
          evVenue,
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

    if (tournaments.length > 0) {
      broadcastToAll('schedule-refetch', { source: 'upload-schedule', count: tournaments.length });
    }

    // Archive the uploaded file instead of deleting
    const detectedVenue = tournaments.length > 0 ? (tournaments[0].venue || 'unknown') : 'unknown';
    await archiveScheduleDoc(detectedVenue, req.file.originalname, dataBuffer);
    await fs.unlink(req.file.path);

    res.json({
      message: 'Schedule uploaded successfully',
      format: format,
      tournamentsCount: tournaments.length,
      tournaments: tournaments.slice(0, 5) // Return first 5 as preview
    });
  } catch (error) {
    console.error('Upload error:', error);
    if (req.file?.path) {
      try { await fs.unlink(req.file.path); } catch (_) {}
    }
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
    const personalSid = `PERSONAL-${req.user.id}-${Date.now()}`;
    db.run(
      `INSERT INTO tournaments (stable_id, event_number, event_name, date, time, buyin, game_variant, venue, notes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [personalSid, '', type, humanDate, '12:00 AM', 0, 'Personal', 'Personal', notes || '', req.user.id]
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

// Search users by username or real_name (prefix match)
app.get('/api/users/search', authenticateToken, requireRegistered, (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const pattern = q + '%';
    const stmt = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.avatar
      FROM users u
      WHERE (u.username LIKE ? OR u.real_name LIKE ?) AND u.id != ?
        AND u.id NOT IN (
          SELECT CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END
          FROM share_requests
          WHERE (from_user_id = ? OR to_user_id = ?)
            AND status IN ('pending', 'accepted')
        )
      LIMIT 10
    `);
    stmt.bind([pattern, pattern, req.user.id, req.user.id, req.user.id, req.user.id]);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    res.json(results);
  } catch (err) {
    console.error('User search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Send a share request to another user
app.post('/api/share-request', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { username } = req.body;
    const stmt = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)');
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

    // Pending incoming swap suggestions
    const swapStmt = db.prepare(`
      SELECT ss.*, u.username AS from_username, u.avatar AS from_avatar, u.real_name AS from_real_name,
             t.event_name, t.date, t.time, t.buyin, t.venue
      FROM swap_suggestions ss
      JOIN users u ON ss.from_user_id = u.id
      JOIN tournaments t ON ss.tournament_id = t.id
      WHERE ss.to_user_id = ? AND ss.status = 'pending'
      ORDER BY ss.created_at DESC
    `);
    swapStmt.bind([uid]);
    const swapSuggestions = [];
    while (swapStmt.step()) swapSuggestions.push(swapStmt.getAsObject());
    swapStmt.free();

    res.json({ groupInvites, buddyRequests, acceptedBuddies, swapSuggestions, lastSeenNotifications: lastSeen });
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

    const parsedEntries = parseInt(totalEntries);
    db.run('UPDATE tournaments SET total_entries = ? WHERE id = ?', [parsedEntries, id]);
    await saveDatabase();
    broadcastToAll('tournament-changed', { id: parseInt(id), fields: { total_entries: parsedEntries } });
    res.json({ message: 'Total entries updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Exchange rates endpoint ─────────────────────────────────
app.get('/api/exchange-rates', async (req, res) => {
  const cache = await fetchExchangeRates();
  res.json({
    base: 'USD',
    rates: cache.rates,
    currencies: SUPPORTED_CURRENCIES,
    fetchedAt: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
    stale: cache.stale
  });
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

// Bulk-clear every tracking entry for the caller — the Dashboard "Reset"
// button. The client has called this since a929d70 but the route was never
// added, so it 404'd and surfaced as "Failed to reset results".
// Returns { count } because the client reports how many were cleared.
app.delete('/api/tracking', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const countStmt = db.prepare('SELECT COUNT(*) AS n FROM tracking_entries WHERE user_id = ?');
    countStmt.bind([req.user.id]);
    countStmt.step();
    const count = countStmt.getAsObject().n || 0;
    countStmt.free();

    // Only touch the DB when there is something to remove, so a no-op reset
    // does not rewrite the database file.
    if (count > 0) {
      db.run('DELETE FROM tracking_entries WHERE user_id = ?', [req.user.id]);
      await saveDatabase();
    }
    res.json({ message: 'Results cleared', count });
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
      const uStmt = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)');
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
        const uStmt = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)');
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
      const uStmt = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)');
      uStmt.bind([swapUsername]);
      if (uStmt.step()) swapUserId = uStmt.getAsObject().id;
      uStmt.free();
      if (!swapUserId) return res.status(404).json({ error: `Swap user "${swapUsername}" not found` });
    }

    let crossbookUserId = null;
    if (backerType === 'crossbook' && crossbookUsername) {
      const uStmt = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)');
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

// ── Backer Summary (P&L + 1099 tracking) ─────────────────
// Returns per-backer aggregate stats across ALL series for this user.
// YTD winnings = gross_return - gross_investment summed over settled series
// where the settlement year matches the current calendar year.
app.get('/api/staking/backers/summary', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const currentYear = new Date().getFullYear();

    // Get all backers for this user
    const backerStmt = db.prepare(
      `SELECT id, name, email, phone, notes FROM backers WHERE user_id = ? ORDER BY name`
    );
    backerStmt.bind([userId]);
    const backers = [];
    while (backerStmt.step()) backers.push(backerStmt.getAsObject());
    backerStmt.free();

    if (backers.length === 0) return res.json([]);

    // Get all settled backer_settlements for this user (across all series)
    const settledStmt = db.prepare(
      `SELECT bs.backer_id, bs.gross_investment, bs.gross_return, bs.net_pnl,
              ss.end_date, ss.start_date
       FROM backer_settlements bs
       JOIN staking_series ss ON bs.series_id = ss.id
       WHERE ss.user_id = ?`
    );
    settledStmt.bind([userId]);
    const allSettlements = [];
    while (settledStmt.step()) allSettlements.push(settledStmt.getAsObject());
    settledStmt.free();

    // Get active (non-settled) agreements with their series info for "active_count"
    const activeStmt = db.prepare(
      `SELECT ba.backer_id, ba.percentage, ba.backer_type,
              ss.name AS series_name, ss.id AS series_id
       FROM backer_agreements ba
       JOIN staking_series ss ON ba.series_id = ss.id
       WHERE ss.user_id = ? AND ba.is_active = 1 AND ss.status != 'settled'`
    );
    activeStmt.bind([userId]);
    const activeAgreements = [];
    while (activeStmt.step()) activeAgreements.push(activeStmt.getAsObject());
    activeStmt.free();

    // Get event statuses for active (unsettled) series to calculate unsettled invested/returned
    const unsettledEventsStmt = db.prepare(
      `SELECT ba.backer_id, ba.percentage, ba.markup, ba.backer_type,
              bes.buyin_amount, bes.cash_amount, bes.bullets_used, bes.tip_amount,
              bes.currency_rate, bes.status,
              t.event_name, t.date, ss.name AS series_name, ss.id AS series_id,
              t.buyin AS t_buyin
       FROM backer_event_status bes
       JOIN backer_agreements ba ON bes.agreement_id = ba.id
       JOIN staking_series ss ON ba.series_id = ss.id
       JOIN tournaments t ON bes.tournament_id = t.id
       WHERE ss.user_id = ? AND ss.status != 'settled' AND bes.status != 'cancelled'`
    );
    unsettledEventsStmt.bind([userId]);
    const unsettledEvents = [];
    while (unsettledEventsStmt.step()) unsettledEvents.push(unsettledEventsStmt.getAsObject());
    unsettledEventsStmt.free();

    // Build summary per backer
    const result = backers.map(b => {
      const backerSettlements = allSettlements.filter(s => s.backer_id === b.id);

      // All-time totals from settled series
      const totalInvested = backerSettlements.reduce((sum, s) => sum + (s.gross_investment || 0), 0);
      const totalReturned = backerSettlements.reduce((sum, s) => sum + (s.gross_return || 0), 0);

      // YTD winnings: sum of (gross_return - gross_investment) for series that ended/started this year
      // We consider a settlement "this year" if the series end_date (or start_date) falls in current year
      let ytdWinnings = 0;
      for (const s of backerSettlements) {
        const yearStr = (s.end_date || s.start_date || '').substring(0, 4);
        if (parseInt(yearStr, 10) === currentYear) {
          const profit = (s.gross_return || 0) - (s.gross_investment || 0);
          if (profit > 0) ytdWinnings += profit;
        }
      }

      // Unsettled: compute running invested/returned from event statuses
      const backerEvents = unsettledEvents.filter(e => e.backer_id === b.id);
      let unsettledInvested = 0;
      let unsettledReturned = 0;
      for (const ev of backerEvents) {
        const pct = (ev.percentage || 0) / 100;
        const markup = ev.markup || 1.0;
        const buyin = (ev.buyin_amount || ev.t_buyin || 0) * (ev.bullets_used || 1);
        const cash = ev.cash_amount || 0;
        const tip = ev.tip_amount || 0;
        const rate = ev.currency_rate || 1.0;
        const buyinC = buyin * rate;
        const cashC = cash * rate;
        const tipC = tip * rate;

        if (ev.backer_type === 'profit_share_only') {
          const net = cashC - buyinC - tipC;
          if (net > 0) unsettledReturned += net * pct;
        } else {
          unsettledInvested += buyinC * pct * markup;
          unsettledReturned += (cashC - tipC) * pct;
        }
      }

      const grandTotalInvested = totalInvested + unsettledInvested;
      const grandTotalReturned = totalReturned + unsettledReturned;
      const netPl = grandTotalReturned - grandTotalInvested;

      // Active agreements (de-duped by series)
      const backerActive = activeAgreements.filter(a => a.backer_id === b.id);
      const activeCount = backerActive.length;

      // Build agreement list for active deals — include series name + estimated $ amount
      // Dollar amount = percentage * (typical or last known buyin) — we don't have a single buyin here,
      // so we just return pct and series context. Client can format as needed.
      const agreements = backerActive.map(a => ({
        series_name: a.series_name,
        series_id: a.series_id,
        pct: a.percentage,
        backer_type: a.backer_type,
      }));

      return {
        id: b.id,
        name: b.name,
        email: b.email || null,
        phone: b.phone || null,
        notes: b.notes || null,
        total_invested: Math.round(grandTotalInvested * 100) / 100,
        total_returned: Math.round(grandTotalReturned * 100) / 100,
        net_pl: Math.round(netPl * 100) / 100,
        ytd_winnings: Math.round(ytdWinnings * 100) / 100,
        active_count: activeCount,
        agreements,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Backer summary error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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

/// ── Hand Replayer API ──────────────────────────────────

// /replayer used to serve a standalone replayer.html; the Vite SPA now owns that
// view, so we just serve the SPA shell and let the client route to it.
app.get('/replayer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public-vite', 'index.html'));
});

// Replayer hands — reuse saved_hands table with replayer-specific endpoints
app.get('/api/replayer/hands', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, hand_data, game_type, title, notes, created_at FROM saved_hands WHERE user_id = ? ORDER BY created_at DESC');
    stmt.bind([req.user.id]);
    const hands = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      try { row.hand_data = JSON.parse(row.hand_data); } catch(e) {}
      hands.push(row);
    }
    stmt.free();
    // Re-map to replayer format
    res.json(hands.map(h => {
      const data = typeof h.hand_data === 'object' ? h.hand_data : {};
      return { id: h.id, title: h.title || data.title, notes: h.notes || data.notes, ...data, created_at: h.created_at };
    }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load hands' });
  }
});

app.get('/api/replayer/hands/:id', authenticateToken, (req, res) => {
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
    res.status(500).json({ error: 'Failed to load hand' });
  }
});

app.post('/api/replayer/hands', authenticateToken, requireRegistered, async (req, res) => {
  try {
    // Body shape: { handData: <hand object>, gameType, title, notes, isPublic }
    const { handData: hand, gameType: bodyGameType, title, notes, isPublic } = req.body;
    if (!hand) return res.status(400).json({ error: 'handData is required' });
    const gameType = bodyGameType || hand.gameType || 'custom';
    db.run(
      'INSERT INTO saved_hands (user_id, hand_data, game_type, title, notes, is_public) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, JSON.stringify(hand), gameType, title || hand.title || null, notes || hand.notes || null, isPublic ? 1 : 0]
    );
    await saveDatabase();
    const idStmt = db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const { id } = idStmt.getAsObject();
    idStmt.free();
    res.status(201).json({ id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save hand' });
  }
});

app.put('/api/replayer/hands/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    const checkStmt = db.prepare('SELECT id FROM saved_hands WHERE id = ? AND user_id = ?');
    checkStmt.bind([id, req.user.id]);
    if (!checkStmt.step()) { checkStmt.free(); return res.status(404).json({ error: 'Not found' }); }
    checkStmt.free();
    const { handData: hand, gameType: bodyGameType, title, notes, isPublic } = req.body;
    if (!hand) return res.status(400).json({ error: 'handData is required' });
    const gameType = bodyGameType || hand.gameType || 'custom';
    db.run('UPDATE saved_hands SET hand_data = ?, game_type = ?, title = ?, notes = ?, is_public = ? WHERE id = ? AND user_id = ?',
      [JSON.stringify(hand), gameType, title || hand.title || null, notes || hand.notes || null, isPublic ? 1 : 0, id, req.user.id]);
    await saveDatabase();
    res.json({ message: 'Updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update hand' });
  }
});

app.delete('/api/replayer/hands/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    db.run('DELETE FROM saved_hands WHERE id = ? AND user_id = ?', [id, req.user.id]);
    await saveDatabase();
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete hand' });
  }
});

// Custom game definitions
app.get('/api/replayer/games', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, name, definition, created_at FROM replayer_games WHERE user_id = ? ORDER BY created_at DESC');
    stmt.bind([req.user.id]);
    const games = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      try { row.definition = JSON.parse(row.definition); } catch(e) {}
      games.push({ id: row.id, name: row.name, ...row.definition, created_at: row.created_at });
    }
    stmt.free();
    res.json(games);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load games' });
  }
});

app.post('/api/replayer/games', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const game = req.body;
    db.run('INSERT INTO replayer_games (user_id, name, definition) VALUES (?, ?, ?)',
      [req.user.id, game.name || 'Custom Game', JSON.stringify(game)]);
    await saveDatabase();
    const idStmt = db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const { id } = idStmt.getAsObject();
    idStmt.free();
    res.status(201).json({ id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save game' });
  }
});

app.delete('/api/replayer/games/:id', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { id } = req.params;
    db.run('DELETE FROM replayer_games WHERE id = ? AND user_id = ?', [id, req.user.id]);
    await saveDatabase();
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete game' });
  }
});

/// ── CFR Solver Trainer API ─────────────────────────────
// Games + strategies live in solver/. Strategies are trained offline
// with `node solver/train.js --game <id> --iters N` and saved to
// solver/strategies/<id>.json; they're lazily loaded and cached here.

const { GAMES: solverGames, GAME_META: solverGameMeta } = require('./solver/games');
const { generateSpot: generateSolverSpot } = require('./solver/spot');
const { playHand: playSolverHand } = require('./solver/playout');
const { makeRng: makeSolverRng } = require('./solver/engine/cards');
const solverRng = makeSolverRng(Date.now() & 0x7fffffff);
const solverStrategies = {}; // gameId -> { strategy, iterations, trainedAt } | null
const solverMeta = {};       // gameId -> { iterations, infosets } | null

// ── Stud trainer wiring (razz + stud8) ───────────────────────────────────
// Stateless, seeded-deterministic heads-up stud trainer, game-parameterized.
// The hand is REPLAYED from `seed` on every request: makeRng(seed) drives the
// deal + the opponent's blueprint σ-sampling + chance; the hero's actions are
// injected from the request body. Same seed + same heroActions ⇒ byte-identical
// replay. The grading engine (solver/razz-trainer/{play,grade}.js) is itself
// game-parameterized — pass it the right game module + blueprint.
const razzPlay = require('./solver/razz-trainer/play');
const razzGrade = require('./solver/razz-trainer/grade');
const { makeRng: makeRazzRng } = require('./solver/engine/cards');
const razzGame = solverGames['razz'];

// The DRAW games run on a SEPARATE trainer engine (solver/draw-trainer/{play,
// grade}.js) — the opponent draws fresh hidden cards three times, so its hidden
// hand is a belief reshaped by every draw, not a fixed combo. The stud trainer's
// fixed-hidden-card reach-weighting has no draw analogue.
const drawPlay = require('./solver/draw-trainer/play');
const drawGrade = require('./solver/draw-trainer/grade');

// The set of games the trainer serves. :game in the route must be one of these.
// Stud games (razz/stud8) replay via the razz-trainer; draw games (td27) replay
// via the draw-trainer. DRAW_TRAINER_GAMES is the category gate used to branch
// the shared :game route.
const TRAINER_GAMES = {
  razz: solverGames['razz'],
  stud8: solverGames['stud8'],
  td27: solverGames['td27'],
  badugi: solverGames['badugi'],
  a5td: solverGames['a5td'],
};
const DRAW_TRAINER_GAMES = { td27: true, badugi: true, a5td: true };
function isDrawTrainerGame(gameId) { return !!DRAW_TRAINER_GAMES[gameId]; }
// Draw games that have an EXACT post-last-draw grading oracle (M2 resolver —
// resolve_draw_final.DRAW_FINAL_GAMES). a5td is deliberately absent (no resolver),
// so Pro mode is never offered for it and body.oracle is ignored server-side.
const DRAW_ORACLE_GAMES = { td27: true, badugi: true };

// Per-game blueprint cache. Training may be actively rewriting the file, so we
// read a single consistent snapshot at first use rather than risk a half-written
// parse mid-session. `undefined` = not yet loaded; `null` = load failed.
const _trainerBp = {}; // gameId -> blueprint | null
function getTrainerBp(gameId) {
  if (!(gameId in _trainerBp)) {
    try { _trainerBp[gameId] = loadSolverStrategy(gameId) || null; }
    catch (e) { console.error(`${gameId} blueprint load failed:`, e.message); _trainerBp[gameId] = null; }
  }
  return _trainerBp[gameId] || {};
}
// Back-compat alias used by the legacy razz step route below.
function getRazzBp() { return getTrainerBp('razz'); }
// heroSeat is a deterministic function of the seed so /step can recompute it
// from {seed} alone (the contract's /step body has no heroSeat). /deal returns
// it for the client to display.
function razzHeroSeat(seed) { return seed & 1; }

// Convert a live engine snapshot to the contract `state`. Cards are engine ints;
// the API speaks 2-char strings. The opponent's DOWN cards are never serialized
// here (hidden until showdown) — only oppUp. `decisionsSoFar` are the recorded
// decision nodes (both seats) used to build the contract log.
function razzToState(s, heroSeat, decisionsSoFar, game = razzGame, deadCards = []) {
  const opp = 1 - heroSeat;
  return {
    street: s.street,
    pot: s.contrib[0] + s.contrib[1],
    heroUp: s.up[heroSeat].map(razzPlay.cardStr),
    heroDown: s.down[heroSeat].map(razzPlay.cardStr),
    oppUp: s.up[opp].map(razzPlay.cardStr),
    // Folded opponents' exposed door cards (2-char strings). Shown to the hero,
    // excluded from the opponent range + future rollout deck by the grader. The
    // SAME list every street (fixed for the hand). [] when there are none.
    deadCards: (deadCards || []).map(razzPlay.cardStr),
    toAct: s.toAct,
    bringInSeat: s.bringIn,
    log: decisionsSoFar.map(d => ({
      seat: d.actor,
      street: d.street,
      actionId: d.chosen,
      label: game.actionLabel(d.chosen, d.state),
    })),
  };
}

// Replay a razz hand deterministically from `seed`, injecting `heroActions` at
// the hero's decision nodes and letting the opponent sample the blueprint σ. A
// thin reimplementation of play.runHand's loop (play.js:81-115) so we can stop
// at the FIRST un-supplied hero node and return the decisions recorded SO FAR
// (the opponent's actions before it) — runHand only returns decisions for a
// fully completed hand, which loses the pre-hero opponent line we need for the
// log/state. Returns either a pending hero node or a completed handRecord.
// DEAD CARDS for a stud trainer hand. Folded opponents' exposed door cards,
// modeled by play.makeDeadCards (drawn from the post-3rd-street deck tail,
// biased high for razz / mildly for stud8, never a hero/bot card). Two
// requirements drive how the rng is sourced:
//   - DETERMINISTIC from the seed (so /deal and every /step for the same seed
//     produce the SAME dead cards, fixed for the whole hand), and
//   - it must NOT consume from the hand's own rng, or it would shift every
//     subsequent opponent-σ sample / chance deal and change the heads-up line
//     (regression). So we pull a SEPARATE seed-derived stream.
// Draw games have no dead cards; this is only called on the stud path.
function razzDeadCards(seed, game, freshState) {
  const deadRng = makeRazzRng(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
  // freshState is the post-3rd-street deal (deck still full); makeDeadCards
  // reserves the last 8 deck entries (future live cards) and draws from the
  // front. Returns card INTS; [] semantics preserved when dead:false.
  return razzPlay.makeDeadCards(game, freshState, deadRng, { dead: true });
}

function replayRazz(seed, heroActions, game = razzGame) {
  const strategyMap = razzPlay.strategyMapOf(getTrainerBp(game.id));
  const heroSeat = razzHeroSeat(seed);
  const rng = makeRazzRng(seed >>> 0);
  let state = game.newHand(rng);
  // Dead cards are computed ONCE from the fresh post-deal state, off a separate
  // seed-derived rng, so they are fixed for the hand and don't perturb the line.
  const deadCards = razzDeadCards(seed, game, state);
  const decisions = []; // every decision node (both seats), in order
  let idx = 0;          // index into heroActions
  let guard = 0;

  while (!game.isTerminal(state)) {
    if (++guard > 500) break;
    if (game.isChance(state)) { state = game.sampleChance(state, rng); continue; }
    const acts = game.legalActions(state);
    if (acts.length <= 1) { state = game.applyAction(state, acts[0]); continue; }

    const actor = game.currentPlayer(state);
    const key = game.infosetKey(state);
    const strat = razzPlay.strategyFor(strategyMap, key, acts);
    const snap = razzPlay.snapshotState(state);

    let chosen;
    if (actor === heroSeat) {
      if (idx >= heroActions.length) {
        // Hero's turn but no action supplied: stop here. This is a decision node.
        return {
          done: false, heroSeat, state: snap, acts: acts.slice(), decisions, deadCards,
        };
      }
      chosen = heroActions[idx++];
      if (acts.indexOf(chosen) < 0) {
        const err = new Error(`illegal hero action '${chosen}' (legal: ${acts.join(',')})`);
        err.illegal = true;
        throw err;
      }
    } else {
      chosen = acts[razzPlay.sampleIndex(strat.probs, rng)];
    }

    decisions.push({
      actor,
      isHero: actor === heroSeat,
      street: state.street,
      key,
      acts: acts.slice(),
      chosen,
      gtoProbs: strat.probs.slice(),
      gtoTrained: strat.trained,
      state: snap,
    });
    state = game.applyAction(state, chosen);
  }

  // Terminal: assemble a handRecord identical in shape to play.runHand's output.
  const handRecord = {
    game: game.id,
    heroSeat,
    decisions,
    deadCards, // folded opponents' exposed door cards (card ints); grade.js reads these
    terminal: razzPlay.snapshotState(state),
    utility: game.utility(state),
    result: game.result(state),
  };
  return { done: true, heroSeat, terminal: state, decisions, handRecord, deadCards };
}

// ── DRAW trainer (td27) ────────────────────────────────────────────────────
// The draw analogue of razzToState/replayRazz/trainerResultPayload, running on
// the SEPARATE draw engine (draw-game.js) via solver/draw-trainer/{play,grade}.
// The opponent's cards are ENTIRELY hidden until showdown (no upcards/bring-in
// in draw poker), so drawToState NEVER serializes them; the draw result reveals
// them only on an actual showdown, mirroring the stud fold-leak guard.

// For a DRAW node, the contract wants one entry per legal draw COUNT with the
// indices (into the player's CURRENT five cards) of the cards that would be
// THROWN for that count — the complement of cfg.chooseKeep's keep set — so the
// UI can highlight keep vs throw.
function drawDiscardIdx(game, hand, count) {
  if (count <= 0) return []; // stand pat: throw nothing
  const keep = game.cfg.chooseKeep(hand, count); // engine-int cards kept
  const idx = [];
  const used = []; // guard against duplicate-rank collisions in indexOf
  for (let i = 0; i < hand.length; i++) {
    // a card is thrown iff it is NOT in the keep set (match by identity, and
    // mark matched keep slots so two equal ints don't both "keep")
    let kept = false;
    for (let k = 0; k < keep.length; k++) {
      if (!used[k] && keep[k] === hand[i]) { used[k] = true; kept = true; break; }
    }
    if (!kept) idx.push(i);
  }
  return idx;
}

// Build the contract legalActions array for the live node `snap` (a draw-engine
// snapshot, toAct === hero). Betting node -> [{id,label}]; draw node -> one
// {id,label,discardIdx} per legal draw count.
//
// FULL DISCARD CONTROL: at a draw node these abstraction options are the
// RECOMMENDED hints (what the blueprint models — stand pat / draw-to-best). The
// hero is NOT limited to them: the GUI lets the hero CLICK any cards to throw and
// submits an explicit 'd:<thrown>' action (composed client-side from the hero's
// cards). See drawDecisionMeta for the draw marker + hero hand the GUI needs.
function drawLegalActions(game, snap, acts) {
  if (snap.phase === 'draw') {
    const hand = snap.hands[snap.toAct];
    return acts.map(id => {
      const count = parseInt(id.slice(1), 10);
      return {
        id,                                          // abstraction 'dK' (the recommended hint)
        label: game.actionLabel(id, snap),
        discardIdx: drawDiscardIdx(game, hand, count), // indices into heroCards thrown by this option
      };
    });
  }
  return acts.map(id => ({ id, label: game.actionLabel(id, snap) }));
}

// Draw-decision metadata for the GUI's card-click selector. At a DRAW node the
// hero composes an explicit 'd:<thrown>' action by clicking specific cards to
// throw — this returns the marker + the hero's CURRENT cards (2-char strings, in
// the same order as state.heroCards) so the client can build the encoded action.
// `discardEncoding` documents the round-trip: 'd:' + the thrown cards' 2-char
// strings concatenated in card-INTEGER-sorted order (matching play.encodeDiscard
// / grade.parseDiscard); 'd:' = stand pat. handSize bounds the draw count.
// Returns null at a betting node (no draw decision).
function drawDecisionMeta(game, snap) {
  if (snap.phase !== 'draw') return null;
  const hand = snap.hands[snap.toAct];
  return {
    isDraw: true,
    heroCards: hand.map(drawPlay.cardStr), // click any subset of these to throw
    handSize: game.cfg.handSize,
    // The client composes 'd:' + sorted(thrown).join('') and submits it as the
    // hero action; 'd:' (no cards) = stand pat. The server applies the explicit
    // keep (hand minus thrown) deterministically off the seeded deck.
    discardEncoding: "d:<thrown cards concatenated, sorted by card int> (e.g. 'd:9sKc'); 'd:' = stand pat",
  };
}

// Convert a live draw-engine snapshot to the contract DRAW `state`. Cards are
// engine ints; the API speaks 2-char strings. NO upcards/bring-in; the opponent
// is hidden. `decisionsSoFar` are the recorded decision nodes (both seats).
//   myLastDiscards = hero's discards from the MOST RECENT draw (or []).
//   oppDrawCounts  = how many the opponent drew on each COMPLETED draw round.
function drawToState(s, heroSeat, decisionsSoFar, game) {
  const opp = 1 - heroSeat;
  // hero's most-recent-draw discards: discards[] accumulates ALL dead cards, so
  // slice off the cards thrown on the latest draw = last drawCounts[hero] entry.
  const heroDraws = s.drawCounts[heroSeat];
  const lastCount = heroDraws.length ? heroDraws[heroDraws.length - 1] : 0;
  const heroDisc = s.discards[heroSeat];
  const myLastDiscards = lastCount > 0
    ? heroDisc.slice(heroDisc.length - lastCount).map(drawPlay.cardStr)
    : [];
  return {
    game: game.id,
    street: s.street,
    phase: s.phase,
    pot: s.contrib[0] + s.contrib[1],
    heroCards: s.hands[heroSeat].map(drawPlay.cardStr),
    myLastDiscards,
    oppDrawCounts: s.drawCounts[opp].slice(),
    toAct: s.toAct,
    log: decisionsSoFar.map(d => ({
      seat: d.actor,
      street: d.street,
      phase: d.phase,
      actionId: d.chosen,
      label: game.actionLabel(d.chosen, d.state),
    })),
  };
}

// Replay a draw hand deterministically from `seed`, injecting `heroActions` at
// the hero's decision nodes and letting the opponent sample the blueprint σ.
// Parallel to replayRazz, but driven through the draw engine and recording the
// `phase` field (so grade.js can tell a draw node from a bet node) plus the
// draw-grade-compatible decision shape. Stops at the FIRST un-supplied hero node.
function replayDraw(seed, heroActions, game) {
  const strategyMap = drawPlay.strategyMapOf(getTrainerBp(game.id));
  const heroSeat = razzHeroSeat(seed);
  const rng = makeRazzRng(seed >>> 0);
  let state = game.newHand(rng);
  const decisions = [];
  let idx = 0;
  let guard = 0;

  while (!game.isTerminal(state)) {
    if (++guard > 500) break;
    if (game.isChance(state)) { state = game.sampleChance(state, rng); continue; }
    const acts = game.legalActions(state);
    if (acts.length <= 1) { state = game.applyAction(state, acts[0]); continue; }

    const actor = game.currentPlayer(state);
    const key = game.infosetKey(state);
    const strat = drawPlay.strategyFor(strategyMap, key, acts);
    const snap = drawPlay.snapshotState(state);
    const phase = state.phase; // 'bet' | 'draw'

    let chosen;
    if (actor === heroSeat) {
      if (idx >= heroActions.length) {
        return { done: false, heroSeat, state: snap, acts: acts.slice(), decisions };
      }
      chosen = heroActions[idx++];
      // FULL DISCARD CONTROL: at a DRAW node the hero may submit an EXPLICIT
      // discard 'd:<thrown cards>' (any specific cards), which is NOT one of the
      // abstraction's 'dK' options. Validate it's a legal draw-node discard (the
      // thrown cards must be in-hand); the opponent's draws stay on 'dK'.
      if (drawPlay.isExplicitDiscard(chosen)) {
        if (phase !== 'draw') {
          const err = new Error(`explicit discard '${chosen}' at a non-draw node (legal: ${acts.join(',')})`);
          err.illegal = true;
          throw err;
        }
        try {
          drawPlay.keepForDiscard(state.hands[actor], chosen); // throws if a thrown card isn't in-hand
        } catch (e) {
          const err = new Error(e.message);
          err.illegal = true;
          throw err;
        }
      } else if (acts.indexOf(chosen) < 0) {
        const err = new Error(`illegal hero action '${chosen}' (legal: ${acts.join(',')})`);
        err.illegal = true;
        throw err;
      }
    } else {
      chosen = acts[drawPlay.sampleIndex(strat.probs, rng)];
    }

    decisions.push({
      actor,
      isHero: actor === heroSeat,
      kind: phase === 'draw' ? 'draw' : 'bet',
      street: state.street,
      phase,
      key,
      acts: acts.slice(),
      chosen,               // may be an explicit-discard 'd:...' at a hero draw node
      gtoProbs: strat.probs.slice(),
      gtoTrained: strat.trained,
      state: snap,
    });
    // Apply: an explicit hero discard goes through game.applyDraw with the
    // explicit keep (same chance/deck mechanics as 'dK', explicit keep instead
    // of cfg.chooseKeep); everything else (abstraction 'dK' / betting) through
    // the normal applyAction. The opponent's 'dK' draws stay on applyAction.
    if (drawPlay.isExplicitDiscard(chosen)) {
      state = game.applyDraw(state, drawPlay.keepForDiscard(state.hands[actor], chosen));
    } else {
      state = game.applyAction(state, chosen);
    }
  }

  const handRecord = {
    game: game.id,
    heroSeat,
    decisions,
    terminal: drawPlay.snapshotState(state),
    utility: game.utility(state),
    result: game.result(state),
  };
  return { done: true, heroSeat, terminal: state, decisions, handRecord };
}

// Build the per-hand `result` payload for a DRAW terminal — single-low whole-pot
// (no hi/lo split), revealing the opponent's hand ONLY on showdown (mucked/null
// on a fold, mirroring the stud fold-leak guard).
function drawResultPayload(game, term, heroDelta, heroSeat) {
  const resu = game.result(term); // {type:'fold'|'showdown', winner:seat|-1, players:[{cards,label,...}]}
  const opp = 1 - heroSeat;
  let winner;
  if (heroDelta > 0) winner = 'hero';
  else if (heroDelta < 0) winner = 'opp';
  else winner = 'split';
  const showdown = resu.type === 'showdown'
    ? {
        heroHand: resu.players[heroSeat].label,
        oppHand: resu.players[opp].label,
        oppCards: resu.players[opp].cards, // already strings; revealed only here
      }
    : null;
  return { heroDelta, winner, endType: resu.type, showdown };
}

// Map a drawGrade.gradeHand grade to the contract grade shape.
//
// FULL DISCARD CONTROL fields (set when the hero used an explicit 'd:<thrown>'
// discard at a draw node): perActionEV carries the hero's actual-discard EV as an
// EXTRA key (the explicit 'd:...' id) alongside the abstraction options; the note
// + confidence + offBookCount surface whether the discard was the recommended
// natural draw or a non-standard / off-book keep (an estimate). The bet-grade and
// abstraction-draw path are unchanged (additive).
function drawGradeToContract(g) {
  return {
    street: g.street,
    phase: g.phase,
    kind: g.kind,                       // 'bet' | 'draw'
    heroActionId: g.heroActionId,       // may be an explicit 'd:...' discard
    heroActionLabel: g.heroActionLabel,
    explicitDiscard: g.explicitDiscard, // true → hero used FULL DISCARD CONTROL
    heroDrawCount: g.heroDrawCount,     // # cards the hero threw (explicit only)
    offBookCount: g.offBookCount,       // draw count not in cfg.drawOptions(hand)
    discardNote: g.discardNote,         // human note (explicit hero only)
    gtoMix: {
      actions: g.gtoMix.actions,        // abstraction options (the recommended hints)
      labels: g.gtoMix.labels,
      probs: g.gtoMix.probs,
    },
    perActionEV: g.perActionEV,         // {abstraction ids... + hero 'd:...'} → chips
    bestActionId: g.bestActionId,       // EV-best ABSTRACTION option (the benchmark)
    bestActionLabel: g.bestActionLabel,
    evLoss: g.evLoss,                   // bestEV − hero-discard EV, clamped >= 0
    evLossSE: g.evLossSE,
    rangeDegraded: g.rangeDegraded,     // posterior collapsed OR off-book count
    confidence: g.confidence,           // 'low' when rangeDegraded / ESS-degraded
    // ── Pro-mode oracle metadata (present only when oracle grading is on; the
    // default blueprint path leaves these undefined so the payload is byte-
    // identical to today). Mirrors the stud trainerStep mapping. ──
    gradeSource: g.gradeSource,                         // 'oracle' | 'certified-net' | 'blueprint' | undefined
    blueprintEvLoss: g.blueprintEvLoss,
    oracleGradeTrusted: g.oracleGradeTrusted,
    oracleGradeTrust: g.oracleGradeTrust,
    oracleResolveExploitability: g.oracleResolveExploitability,
    oracleIters: g.oracleIters,
    oracleExploitability: g.oracleExploitability,       // back-compat alias
    // ── CERTIFIED-NET metadata (first neural grade; pre-last-draw badugi). Present
    // only when gradeSource === 'certified-net'. HONEST: certificationSB is the
    // net's certified mean grade error (0.059 SB) — NOT an exact/GTO guarantee. ──
    certificationSB: g.certificationSB,                 // certified mean grade error (SB)
    netValueGauge: g.netValueGauge,                     // net zero-sum residual (~0 = in-distribution)
    forwardMode: g.forwardMode,                         // 'certified-net' | 'oracle-exact' | 'exact-forward' | 'mc-forward'
    // ── RANGE-SENSITIVE honesty flag (present only when oracle grading is on) ──
    // rangeSensitive → the oracle best action flipped or the evLoss spread > ~2
    // chips across a prior ensemble; the grade is SHOWN but chargedEvLoss is 0
    // ("shown, not charged"). The client scoreboard counts chargedEvLoss (falls
    // back to evLoss when the field is absent, i.e. the default blueprint path).
    rangeSensitive: g.rangeSensitive,
    rangeSensitiveSpread: g.rangeSensitiveSpread,
    rangeSensitiveFlip: g.rangeSensitiveFlip,
    chargedEvLoss: g.chargedEvLoss,
  };
}

// Lightweight metadata for the games list. Reads a tiny <id>.meta.json
// sidecar so we never parse the multi-MB strategy files just to show
// iteration/infoset counts (parsing all of them at once OOMs small
// instances). Falls back to the full file's header only if no sidecar.
function loadSolverMeta(gameId) {
  if (gameId in solverMeta) return solverMeta[gameId];
  let m = null;
  try {
    const fsSync = require('fs');
    const metaFile = path.join(__dirname, 'solver', 'strategies', `${gameId}.meta.json`);
    const fullFile = path.join(__dirname, 'solver', 'strategies', `${gameId}.json`);
    if (fsSync.existsSync(metaFile)) {
      m = JSON.parse(fsSync.readFileSync(metaFile, 'utf8'));
    } else if (fsSync.existsSync(fullFile)) {
      const full = loadSolverStrategy(gameId);
      if (full) m = { iterations: full.iterations, infosets: full.infosets };
    }
  } catch (e) {
    console.error(`Failed to load solver meta for ${gameId}:`, e.message);
  }
  if (m) solverMeta[gameId] = m;
  return m;
}

// Full strategy map. Lazily loaded one game at a time and cached; only
// the spot/playout endpoints need it.
function loadSolverStrategy(gameId) {
  if (gameId in solverStrategies) return solverStrategies[gameId];
  let loaded = null;
  try {
    const fsSync = require('fs'); // top-level fs is the promises API
    const file = path.join(__dirname, 'solver', 'strategies', `${gameId}.json`);
    if (fsSync.existsSync(file)) {
      // Memory guard: JSON.parse of a big blueprint inflates ~10x in V8 and
      // OOM-kills small instances (Render starter = 512MB; stud8.json alone
      // is 61MB on disk). BP_MAX_BYTES caps what this process will load;
      // unset = no cap (local dev).
      const cap = Number(process.env.BP_MAX_BYTES || 0);
      const sz = fsSync.statSync(file).size;
      if (cap > 0 && sz > cap) {
        console.error(`${gameId} blueprint is ${Math.round(sz / 1e6)}MB > BP_MAX_BYTES=${Math.round(cap / 1e6)}MB — refusing to load (memory guard)`);
        return null;
      }
      loaded = JSON.parse(fsSync.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`Failed to load solver strategy for ${gameId}:`, e.message);
  }
  // don't cache misses — a strategy trained later should be picked up live
  if (loaded) solverStrategies[gameId] = loaded;
  return loaded;
}

app.get('/api/solver/games', authenticateToken, (req, res) => {
  res.json(solverGameMeta.map(meta => {
    const m = loadSolverMeta(meta.id);
    return {
      ...meta,
      trained: !!m,
      iterations: m ? m.iterations : 0,
      infosets: m ? m.infosets : 0,
    };
  }));
});

app.get('/api/solver/spot/:gameId', authenticateToken, (req, res) => {
  try {
    const game = solverGames[req.params.gameId];
    if (!game) return res.status(404).json({ error: 'Unknown game' });
    const strat = loadSolverStrategy(req.params.gameId);
    const spot = generateSolverSpot(game, strat ? strat.strategy : {}, solverRng);
    if (!spot) return res.status(500).json({ error: 'Could not generate a spot' });
    res.json(spot);
  } catch (error) {
    console.error('Solver spot error:', error);
    res.status(500).json({ error: 'Failed to generate spot' });
  }
});

app.get('/api/solver/playout/:gameId', authenticateToken, (req, res) => {
  try {
    const game = solverGames[req.params.gameId];
    if (!game) return res.status(404).json({ error: 'Unknown game' });
    const strat = loadSolverStrategy(req.params.gameId);
    const playout = playSolverHand(game, strat ? strat.strategy : {}, solverRng);
    res.json({ ...playout, trained: !!strat });
  } catch (error) {
    console.error('Solver playout error:', error);
    res.status(500).json({ error: 'Failed to generate playout' });
  }
});

// ── Stud trainer (stateless, seeded deterministic replay; razz + stud8) ──
// Admin-authed exactly like the other /api/solver/* routes (plain
// authenticateToken — the Hands tab is admin-gated client-side). Cards in the
// API are 2-char strings; the engine's internal ints are converted via cardStr.

// Build the per-hand `result` payload from a terminal state. Game-aware:
//  - winner: a coarse hero/opp/split label. For stud8 (hi/lo split) it reflects
//    the actual chip outcome — scoop / quarter / split / lost — since a single
//    'winner' word can't carry the hi/lo breakdown.
//  - showdown: revealed ONLY on an actual showdown (mucked on fold, mirroring
//    the razz fold-leak fix — never leak the opponent's hole cards otherwise).
//    For stud8 it carries the hi winner+hand AND the lo winner+qualifying low
//    so the GUI can render the split; for razz it carries the single low.
function trainerResultPayload(game, term, heroDelta, heroSeat) {
  const resu = game.result(term);
  const opp = 1 - heroSeat;
  const isStud8 = game.id === 'stud8';

  // Coarse winner label.
  let winner;
  if (resu.type === 'fold') {
    winner = resu.hiWinner === heroSeat ? 'hero' : 'opp';
  } else if (isStud8) {
    // hi/lo split: derive the hero's share from the chip delta.
    if (heroDelta > 0) winner = resu.scoop && resu.hiWinner === heroSeat ? 'hero-scoop' : 'hero';
    else if (heroDelta < 0) winner = resu.scoop && resu.hiWinner === opp ? 'opp-scoop' : 'opp';
    else winner = 'split';
  } else {
    winner = resu.hiWinner === heroSeat ? 'hero'
      : (resu.hiWinner === -1 ? 'split' : 'opp');
  }

  let showdown = null;
  if (resu.type === 'showdown') {
    if (isStud8) {
      // hi/lo detail. hiWinner/loWinner are seats (or -1 split, or null no-low);
      // map to 'hero'/'opp'/'split'/null relative to the hero seat for the GUI.
      const seatLabel = w => (w == null ? null : w === -1 ? 'split' : (w === heroSeat ? 'hero' : 'opp'));
      showdown = {
        hi: {
          winner: seatLabel(resu.hiWinner),
          heroHand: resu.players[heroSeat].hi,
          oppHand: resu.players[opp].hi,
        },
        lo: {
          // loWinner === null => nobody qualified for low; the pot played as hi-only.
          winner: seatLabel(resu.loWinner),
          qualified: resu.loWinner !== null,
          heroLow: resu.players[heroSeat].lo, // 'no qualifying low' if none
          oppLow: resu.players[opp].lo,
        },
        scoop: resu.scoop,
        oppDown: resu.players[opp].down, // already strings
      };
    } else {
      showdown = {
        heroLow: resu.players[heroSeat].lo,
        oppLow: resu.players[opp].lo,
        oppDown: resu.players[opp].down, // already strings
      };
    }
  }

  return {
    heroDelta,
    winner,
    endType: resu.type, // 'fold' | 'showdown'
    showdown,
  };
}

// Shared deal handler for any trainer game. body: {} -> { seed, heroSeat, state }
//   (state stops at the hero's first decision, or terminal if the hero never
//   gets to act in this deal)
function trainerDeal(game, req, res) {
  if (isDrawTrainerGame(game.id)) return drawTrainerDeal(game, req, res);
  try {
    const seed = (Math.random() * 0x7fffffff) | 0;
    const heroSeat = razzHeroSeat(seed);
    const r = replayRazz(seed, [], game); // no hero actions -> stop at hero's first node
    const snap = r.done ? r.terminal : r.state;
    const state = razzToState(snap, heroSeat, r.decisions, game, r.deadCards);
    res.json({ seed, heroSeat, game: game.id, state });
  } catch (error) {
    console.error(`${game.id} trainer deal error:`, error);
    res.status(500).json({ error: `Failed to deal ${game.id} hand` });
  }
}

// DRAW-game deal: same contract ({ seed, heroSeat, state }) but the state is the
// DRAW shape (heroCards/phase/oppDrawCounts, opponent hidden).
function drawTrainerDeal(game, req, res) {
  try {
    const seed = (Math.random() * 0x7fffffff) | 0;
    const heroSeat = razzHeroSeat(seed);
    const r = replayDraw(seed, [], game);
    const snap = r.done ? r.terminal : r.state;
    const state = drawToState(snap, heroSeat, r.decisions, game);
    res.json({ seed, heroSeat, game: game.id, state });
  } catch (error) {
    console.error(`${game.id} draw trainer deal error:`, error);
    res.status(500).json({ error: `Failed to deal ${game.id} hand` });
  }
}

// Shared step handler. body: { seed, heroActions:[actionId,...] }
//   Replays the hand from `seed`, applies `heroActions` in order at the hero's
//   decision nodes, advances (opponent samples σ; chance deals) to the NEXT
//   hero decision OR terminal.
//   -> on hero turn:  { state, legalActions:[{id,label}], handOver:false }
//   -> on terminal:   { state, legalActions:null, handOver:true, result, grades }
async function trainerStep(game, req, res) {
  if (isDrawTrainerGame(game.id)) return drawTrainerStep(game, req, res);
  try {
    const body = req.body || {};
    const seed = body.seed | 0;
    const heroActions = Array.isArray(body.heroActions) ? body.heroActions : [];
    if (body.seed == null) return res.status(400).json({ error: 'seed is required' });

    let r;
    try {
      r = replayRazz(seed, heroActions, game);
    } catch (e) {
      if (e.illegal) return res.status(400).json({ error: e.message });
      throw e;
    }
    const heroSeat = r.heroSeat;

    if (!r.done) {
      // Hero's turn: return the legal actions, no grades yet.
      const legalActions = r.acts.map(id => ({ id, label: game.actionLabel(id, r.state) }));
      return res.json({
        state: razzToState(r.state, heroSeat, r.decisions, game, r.deadCards),
        legalActions,
        handOver: false,
      });
    }

    // Terminal: build result + grades.
    const hr = r.handRecord;
    const term = r.terminal;
    const result = trainerResultPayload(game, term, hr.utility[heroSeat], heroSeat);

    // Oracle grading is OPT-IN (body.oracle === true): for 7th-street hero
    // decisions the grade is sourced from the TRUE-GTO neural re-solver instead
    // of the bucketed blueprint. gradeHandWithOracle runs the blueprint grade
    // first and overlays the oracle per eligible decision, gracefully falling
    // back to the blueprint grade on any oracle failure/timeout. Default stays
    // the pure-JS blueprint grader.
    const useOracle = body.oracle === true;
    // entryPrior toggles the full-ring realistic 3rd-street entry prior on the
    // ORACLE opponent range (razz only; default ON). Pass body.entryPrior:false
    // to A/B the prior's grade impact (prior OFF = the wide HU-blueprint range).
    const oracleOpts = { seed, samples: 2000, game, entryPrior: body.entryPrior };
    const graded = useOracle
      ? await razzGrade.gradeHandWithOracle(hr, getTrainerBp(game.id), oracleOpts)
      : razzGrade.gradeHand(hr, getTrainerBp(game.id), { seed, samples: 2000, game });
    const grades = graded.grades.map(g => {
      const dec = hr.decisions[g.gradeIdx];
      return {
        street: g.street,
        heroActionId: g.chosen,
        heroActionLabel: game.actionLabel(g.chosen, dec.state),
        gtoMix: {
          actions: g.gtoMix.actions,
          labels: g.gtoMix.actions.map(id => game.actionLabel(id, dec.state)),
          probs: g.gtoMix.probs,
        },
        perActionEV: g.perActionEV,
        bestActionId: g.bestAction,
        evLoss: g.evLoss,
        evLossSE: g.evLossSE,
        // oracle metadata (present only when oracle grading is on)
        gradeSource: g.gradeSource,
        blueprintEvLoss: g.blueprintEvLoss,
        // HONEST self-consistency gauge (Fix 2): the grade is trusted on
        // EV-CONVERGENCE, not on the resolver's own <0.06 exploitability bar. At
        // the trainer default (300 iters) the resolver's self-play gap is ~0.33 —
        // that is NOT a "grade broken / not fully solved" signal, so we surface it
        // under an honest name and publish an EV-convergence trust flag instead.
        oracleGradeTrusted: g.oracleGradeTrusted,
        oracleGradeTrust: g.oracleGradeTrust,
        oracleResolveExploitability: g.oracleResolveExploitability,
        oracleFullySolved: g.oracleFullySolved,
        oracleIters: g.oracleIters,
        // BACK-COMPAT alias (unchanged key; no client thresholds on it).
        oracleExploitability: g.oracleExploitability,
        // ── RANGE-SENSITIVE honesty flag (present only when oracle grading is on) ──
        // rangeSensitive → best action flipped / evLoss spread > ~2 chips across a
        // prior ensemble; SHOWN but chargedEvLoss zeroed ("shown, not charged").
        // For STUD, whether chargedEvLoss is actually zeroed is gated in the grader
        // by STUD_RANGE_FLAG (parent's deploy decision); the flag is always shown.
        rangeSensitive: g.rangeSensitive,
        rangeSensitiveSpread: g.rangeSensitiveSpread,
        rangeSensitiveFlip: g.rangeSensitiveFlip,
        chargedEvLoss: g.chargedEvLoss,
        // ── 6th-STREET oracle metadata (present only for gradeSource==='oracle-6th') ──
        // Approximate bucketed 6th->7th grade: SHOWN, never charged; the abstraction-gap
        // badge is per-game (stud8 tight, razz coarse). forwardMode + oracle6th* let the
        // client render this distinct from the near-exact 7th 'oracle'.
        forwardMode: g.forwardMode,
        oracle6thApproximate: g.oracle6thApproximate,
        oracle6thAbstractionChips: g.oracle6thAbstractionChips,
        // 5th-street oracle (net-leaf, gradeSource==='oracle-5th'): approximate
        // laddered grade, SHOWN not charged. gradeSource/forwardMode/chargedEvLoss/
        // oracleGradeTrust already flow through above.
        oracle5thApproximate: g.oracle5thApproximate,
      };
    });

    res.json({
      state: razzToState(term, heroSeat, hr.decisions, game, hr.deadCards),
      legalActions: null,
      handOver: true,
      result,
      grades,
    });
  } catch (error) {
    console.error(`${game.id} trainer step error:`, error);
    res.status(500).json({ error: `Failed to step ${game.id} hand` });
  }
}

// DRAW-game step. Same contract as trainerStep but routed through the draw
// engine + draw-trainer grader. legalActions carry discardIdx at draw nodes; the
// terminal reveals the opponent only on showdown and emits both 'bet' and 'draw'
// kind grades.
async function drawTrainerStep(game, req, res) {
  try {
    const body = req.body || {};
    const seed = body.seed | 0;
    const heroActions = Array.isArray(body.heroActions) ? body.heroActions : [];
    if (body.seed == null) return res.status(400).json({ error: 'seed is required' });

    let r;
    try {
      r = replayDraw(seed, heroActions, game);
    } catch (e) {
      if (e.illegal) return res.status(400).json({ error: e.message });
      throw e;
    }
    const heroSeat = r.heroSeat;

    if (!r.done) {
      // Hero's turn: bet OR draw legalActions (draw entries carry discardIdx).
      // At a DRAW node, drawDecision signals a draw decision + carries the hero's
      // current cards so the GUI does card-click discard selection; the hero
      // submits an explicit 'd:<thrown>' action (the abstraction options in
      // legalActions are the RECOMMENDED hint). Null at a betting node.
      const legalActions = drawLegalActions(game, r.state, r.acts);
      const drawDecision = drawDecisionMeta(game, r.state);
      return res.json({
        state: drawToState(r.state, heroSeat, r.decisions, game),
        legalActions,
        drawDecision,
        handOver: false,
      });
    }

    // Terminal: build result + grades via the draw grader.
    const hr = r.handRecord;
    const term = r.terminal;
    const result = drawResultPayload(game, term, hr.utility[heroSeat], heroSeat);

    // ADAPTIVE post-hand grading — early-street draw/bet decisions roll out through
    // chance nodes, so a fixed small sample count leaves their paired evLoss SE at
    // ±1.5–2 chips (noisy/untrustworthy grades). targetSE drives each noisy
    // (mc-forward) node's SE down to ~0.3 chips by averaging more independent
    // rollouts per particle (gradeHand doubles evRepeats up to maxRepeats), while
    // leaving the trusted EXACT-FORWARD (post-last-draw) grades byte-identical.
    // Tuning: targetSE 0.3 + maxRepeats 16 → early-street SE p90 ~2.0 → ~0.8 chips,
    // per-hand wall-time ~0.15–0.2s (well under any interactive budget).
    //
    // Oracle grading is OPT-IN (body.oracle === true): for POST-LAST-DRAW (street 3)
    // hero BET decisions the grade is sourced from the TRUE-GTO exact draw
    // re-solver (gradeHandWithOracle) instead of the bucketed blueprint. It is
    // offered ONLY for the games with an M2 resolver (badugi/td27 — a5td has none);
    // gradeHandWithOracle overlays the oracle per eligible decision and gracefully
    // falls back to the blueprint grade on any oracle failure/timeout. Every other
    // decision (earlier streets, all draw decisions) stays blueprint. When oracle
    // is off the payload is byte-identical to the default draw path.
    const bpOpts = { seed, samples: 60, targetSE: 0.3, maxRepeats: 16, game };
    const useOracle = body.oracle === true && drawGrade.oracleEligible &&
      DRAW_ORACLE_GAMES[game.id] === true;
    const graded = useOracle
      ? await drawGrade.gradeHandWithOracle(hr, getTrainerBp(game.id), bpOpts)
      : drawGrade.gradeHand(hr, getTrainerBp(game.id), bpOpts);
    const grades = graded.grades.map(drawGradeToContract);

    res.json({
      state: drawToState(term, heroSeat, hr.decisions, game),
      legalActions: null,
      handOver: true,
      result,
      grades,
    });
  } catch (error) {
    console.error(`${game.id} draw trainer step error:`, error);
    res.status(500).json({ error: `Failed to step ${game.id} hand` });
  }
}

// Resolve :game to a registered trainer game module, or 404. The legacy
// /razz-trainer/* routes pin razz directly (no :game param).
function resolveTrainerGame(req, res) {
  const game = TRAINER_GAMES[req.params.game];
  if (!game) { res.status(404).json({ error: `Unknown trainer game '${req.params.game}'` }); return null; }
  return game;
}

// New game-parameterized routes: :game in {razz, stud8}. Each loads its own
// cached blueprint (solver/strategies/<game>.json) and threads the right game
// module + card<->string + actionLabel through the shared handlers.
//   POST /api/solver/trainer/:game/deal
//   POST /api/solver/trainer/:game/step
// A game whose blueprint the memory guard refused (BP_MAX_BYTES) must fail
// with an honest 503, not silently play a uniform-random bot.
function requireTrainerBp(game, res) {
  const bp = getTrainerBp(game.id);
  for (const k in bp) return true; // O(1) non-empty check (bp can be 788k keys)
  res.status(503).json({ error: `${game.id} trainer is temporarily unavailable on this server (blueprint too large for this instance)` });
  return false;
}
app.post('/api/solver/trainer/:game/deal', authenticateToken, (req, res) => {
  const game = resolveTrainerGame(req, res); if (!game) return;
  if (!requireTrainerBp(game, res)) return;
  trainerDeal(game, req, res);
});
app.post('/api/solver/trainer/:game/step', authenticateToken, (req, res) => {
  const game = resolveTrainerGame(req, res); if (!game) return;
  if (!requireTrainerBp(game, res)) return;
  Promise.resolve(trainerStep(game, req, res)).catch(err => {
    console.error(`${game.id} trainer step (async) error:`, err);
    if (!res.headersSent) res.status(500).json({ error: `Failed to step ${game.id} hand` });
  });
});

// Legacy razz-only routes — kept working as aliases (game=razz) so existing
// clients don't break.
app.post('/api/solver/razz-trainer/deal', authenticateToken, (req, res) => {
  trainerDeal(razzGame, req, res);
});
app.post('/api/solver/razz-trainer/step', authenticateToken, (req, res) => {
  Promise.resolve(trainerStep(razzGame, req, res)).catch(err => {
    console.error('razz trainer step (async) error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to step razz hand' });
  });
});

// ── MULTIWAY (3-player razz) TRAINER — trainer3 ───────────────────────────────
// The 3-seat analogue of the heads-up stud trainer above. Stateless + seeded-
// deterministic: a hand is REPLAYED from `seed` on every request — makeRng(seed)
// drives the deal + the TWO non-hero seats' blueprint σ-sampling + chance; the
// hero's actions are injected from the request body. Same seed + same heroActions
// ⇒ byte-identical replay. The engine (solver/multiway/razz3-game.js) and the
// grader (solver/multiway/grade3.js) are the FROZEN, gated foundation — this is
// pure wiring on top of them.
//
//   POST /api/solver/trainer3/razz3/deal  {}                     -> { seed, heroSeat, game, state }
//   POST /api/solver/trainer3/razz3/step  { seed, heroActions:[] } -> { state, legalActions|null, handOver, result?, grades?, profile? }
//
// HONESTY (product requirement, general-sum 3-player razz has NO equilibrium):
// grade3 already bans the GTO label (grade7.gradeLabel throws on "gto") and
// stamps `certified-EV-loss-vs-stated-profile`. Every field this endpoint emits
// is framed as EV-loss-vs-the-stated-profile; the exploitability number is
// carried as a per-seat LOWER bound (exploitLowerBound). No "GTO"/"equilibrium"/
// "optimal"/"solved" strings anywhere in this section or its payloads.
const play3 = require('./solver/multiway/play3');
const grade3 = require('./solver/multiway/grade3');
// The multiway grade (grade3.gradeHand3) is ~5.8s median / ~13.5s worst — heavy
// pure JS whose exact 7th-street enumeration would BLOCK the event loop for every
// user if run inline. Offload it to a persistent worker thread (blueprint cached
// once IN the worker) so /step `await`s it without blocking. grade3 stays the
// direct synchronous API for the CLI/tests; the worker calls the very same fn.
const { getManager: getGrade3Manager } = require('./solver/multiway/grade3-manager');
const { makeGame: makeRazz3 } = require('./solver/multiway/razz3-game');
const { bestLowRazz: razz3BestLow } = require('./solver/eval/razz');
const razz3Game = makeRazz3({ cap: 2, antes: 8 }); // blueprint training params

// Human low-hand string for a seat's revealed 7 cards (ace-to-five, no straights/
// flushes). Picks the 5 distinct-rank cards forming the best low and renders them
// high→low, e.g. "8-6-4-3-A". Purely for showdown display; the pot is decided by
// razz3Game.utility (bestLowRazz), never by this string.
const RAZZ3_RANKCH = { 14: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' };
function razz3LowString(cardStrs) {
  // ace low; dedupe ranks; take the 5 lowest distinct ranks.
  const lowVal = r => (r === 14 ? 1 : r);
  const seen = new Set(); const ranks = [];
  for (const cs of cardStrs) {
    const r = RANK_VAL_R3(cs);
    if (r == null) continue;
    if (seen.has(r)) continue; seen.add(r); ranks.push(r);
  }
  ranks.sort((a, b) => lowVal(a) - lowVal(b));
  const five = ranks.slice(0, 5);
  if (five.length < 5) return null;
  // display high→low by low value
  return five.slice().sort((a, b) => lowVal(b) - lowVal(a)).map(r => RAZZ3_RANKCH[r]).join('-');
}
function RANK_VAL_R3(cs) {
  if (!cs || cs.length < 1) return null;
  const map = { A: 14, K: 13, Q: 12, J: 11, T: 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
  return map[cs[0].toUpperCase()] || null;
}

// The 3-player blueprint PROFILE the two non-hero seats sample and the grader
// certifies EV-loss against. It is the 70MB razz3.best-750k.json (NOT the live
// razz3.json the grind is actively rewriting). Loaded ONCE, lazily, and cached —
// a per-request 70MB JSON.parse would dominate latency. `undefined` = not loaded;
// `null` = load failed / refused by the memory guard.
// Absolute path to the blueprint file — shared by the in-process cache (below)
// and the grade WORKER (which parses its OWN copy once, off the event loop).
const RAZZ3_BP_FILE = path.join(__dirname, 'solver', 'strategies', 'razz3.best-750k.json');
let _razz3Bp; // razz3 blueprint (whole file {meta,strategy}) | null
function getRazz3Bp() {
  if (_razz3Bp === undefined) {
    try {
      const fsSync = require('fs');
      const file = RAZZ3_BP_FILE;
      const cap = Number(process.env.BP_MAX_BYTES || 0);
      const sz = fsSync.existsSync(file) ? fsSync.statSync(file).size : 0;
      if (!sz) { console.error('razz3 blueprint missing:', file); _razz3Bp = null; }
      else if (cap > 0 && sz > cap) {
        console.error(`razz3 blueprint is ${Math.round(sz / 1e6)}MB > BP_MAX_BYTES=${Math.round(cap / 1e6)}MB — refusing to load (memory guard)`);
        _razz3Bp = null;
      } else {
        console.log(`Loading razz3 blueprint (${Math.round(sz / 1e6)}MB) — one-time...`);
        _razz3Bp = JSON.parse(fsSync.readFileSync(file, 'utf8'));
        console.log(`razz3 blueprint loaded: ${Object.keys(play3.strategyMapOf(_razz3Bp)).length} infosets`);
      }
    } catch (e) { console.error('razz3 blueprint load failed:', e.message); _razz3Bp = null; }
  }
  return _razz3Bp || null;
}
// Grading budget. The 7th-street grade is the EXACT multiway certificate; its
// opponent-range enumeration is the cost, so oppCap is bounded and the published
// error bar is the LOWER bound only (withTrueBR:false — the tighter true bound
// roughly doubles the 7th-street cost and the LLB is exactly the honest number we
// publish). Earlier streets are the blueprint MC estimate (samples/oppCapEarly
// tuned so a full hand grades in ~1.5s avg / <8s worst on this box).
const RAZZ3_GRADE_OPTS = { oppCap: 8, withTrueBR: false, oppCapEarly: 5, samples: 60, game: razz3Game };
// Plain-scalar view of the grade budget for the WORKER (the `game` object can't
// cross a thread boundary — the worker rebuilds its own identical razz3 game).
const { game: _razz3GradeGameUnused, ...RAZZ3_GRADE_OPTS_PLAIN } = RAZZ3_GRADE_OPTS;
// Lazy accessor for the persistent grade worker. First call fixes the blueprint
// path + game params (cap/antes) and warms the worker (parses the 70MB blueprint
// ONCE in the worker); later calls reuse it. Kept separate from getRazz3Bp: the
// in-process blueprint is still used for the fast deterministic REPLAY (~ms), the
// worker owns only the heavy GRADE.
function razz3GradeManager() {
  return getGrade3Manager({ bpFile: RAZZ3_BP_FILE, gameOpts: { cap: 2, antes: 8 } });
}
// heroSeat is a deterministic function of the seed so /step recomputes it from
// {seed} alone (3 seats → mod 3). /deal returns it for the client.
function razz3HeroSeat(seed) { return ((seed >>> 0) % 3); }

// Serialize a live razz3 snapshot to the contract `state`. All THREE seats'
// upcards are public; the hero's down cards are shown; the two opponents' down
// cards are hidden until showdown (never serialized here). `decisionsSoFar` are
// the recorded decision nodes (all seats) → the public action log.
function razz3ToState(s, heroSeat, decisionsSoFar) {
  const opps = [0, 1, 2].filter(p => p !== heroSeat);
  return {
    street: s.street,
    // total live pot including the owner-less dead-money overlay (deadPot).
    pot: s.deadPot + s.contrib.reduce((a, b) => a + b, 0),
    deadPot: s.deadPot,
    heroSeat,
    // per-seat public view (index-aligned to seats 0..2)
    seats: [0, 1, 2].map(p => ({
      seat: p,
      isHero: p === heroSeat,
      up: s.up[p].map(play3.cardStr),
      down: p === heroSeat ? s.down[p].map(play3.cardStr) : s.down[p].map(() => null), // opp downs hidden
      contrib: s.contrib[p],
      folded: !!s.folded[p],
    })),
    heroUp: s.up[heroSeat].map(play3.cardStr),
    heroDown: s.down[heroSeat].map(play3.cardStr),
    oppSeats: opps,
    toAct: s.toAct,
    bringInSeat: s.bringIn,
    log: decisionsSoFar.map(d => ({
      seat: d.actor,
      street: d.street,
      actionId: d.chosen,
      label: razz3Game.actionLabel(d.chosen, d.state),
    })),
  };
}

// Deterministic replay of a razz3 hand from `seed`, injecting `heroActions` at the
// hero's decision nodes; the two non-hero seats sample the blueprint σ. A thin
// reimplementation of play3.runHand3's loop that STOPS at the first un-supplied
// hero node (returning the decisions recorded so far — the opponents' pre-hero
// line we need for the state/log), or runs to terminal and returns a full
// handRecord for grade3.gradeHand3. Mirrors replayRazz (the HU path).
function replayRazz3(seed, heroActions) {
  const bp = getRazz3Bp();
  const strategyMap = play3.strategyMapOf(bp);
  const heroSeat = razz3HeroSeat(seed);
  const rng = makeRazzRng(seed >>> 0);
  let state = razz3Game.newHand(rng);
  const decisions = [];
  let idx = 0;   // index into heroActions
  let guard = 0;

  while (!razz3Game.isTerminal(state)) {
    if (++guard > 500) break;
    if (razz3Game.isChance(state)) { state = razz3Game.sampleChance(state, rng); continue; }
    const acts = razz3Game.legalActions(state);
    if (acts.length <= 1) { state = razz3Game.applyAction(state, acts[0]); continue; }

    const actor = razz3Game.currentPlayer(state);
    const key = razz3Game.infosetKey(state);
    const strat = play3.strategyFor(strategyMap, key, acts);
    const snap = play3.snapshotState(state);

    let chosen;
    if (actor === heroSeat) {
      if (idx >= heroActions.length) {
        return { done: false, heroSeat, state: snap, acts: acts.slice(), decisions };
      }
      chosen = heroActions[idx++];
      if (acts.indexOf(chosen) < 0) {
        const err = new Error(`illegal hero action '${chosen}' (legal: ${acts.join(',')})`);
        err.illegal = true;
        throw err;
      }
    } else {
      chosen = acts[play3.sampleIndex(strat.probs, rng)];
    }

    decisions.push({
      actor, isHero: actor === heroSeat, street: state.street, key,
      acts: acts.slice(), chosen, gtoProbs: strat.probs.slice(), gtoTrained: strat.trained,
      state: snap,
    });
    state = razz3Game.applyAction(state, chosen);
  }

  const handRecord = {
    game: razz3Game.id, heroSeat, nseat: 3, decisions,
    terminal: play3.snapshotState(state), utility: razz3Game.utility(state),
  };
  return { done: true, heroSeat, terminal: state, decisions, handRecord };
}

// Build the per-hand result payload from a 3-seat terminal state. `heroDelta` is
// the hero's chip utility. Coarse label + showdown reveal (only on a real
// showdown — never leak folded seats' hole cards). All three seats' rank strings
// are shown at showdown so the GUI can render the 3-way low.
function razz3ResultPayload(term, heroDelta, heroSeat) {
  const live = razz3Game.liveSeats(term);
  const isShowdown = live.length > 1; // >1 live seat reaching the end = showdown
  let winner;
  if (heroDelta > 0) winner = 'hero';
  else if (heroDelta < 0) winner = 'opp';
  else winner = 'split';
  const util = razz3Game.utility(term);
  const seats = [0, 1, 2].map(p => ({
    seat: p,
    folded: !!term.folded[p],
    delta: util[p],
    // reveal every live seat's hand at showdown; folded/mucked seats stay hidden.
    up: term.up[p].map(play3.cardStr),
    down: (isShowdown && !term.folded[p]) ? term.down[p].map(play3.cardStr) : term.down[p].map(() => null),
    lowRank: (isShowdown && !term.folded[p])
      ? razz3LowString(term.up[p].concat(term.down[p]).map(play3.cardStr))
      : null,
  }));
  return { heroDelta, winner, endType: isShowdown ? 'showdown' : 'fold', seats };
}

// Map a grade3 grade object to the API contract. Preserves the HONEST framing:
// gradeSource + forwardMode ('exact-multiway-oracle' for 7th, 'blueprint-graded'
// for earlier streets), certified string, and the per-seat exploitability LOWER
// bound bar. actionLabels are resolved through the engine so the UI can show
// human labels without re-deriving them.
function razz3GradeToContract(g, handRecord) {
  const dec = handRecord.decisions[g.gradeIdx];
  const st = dec.state;
  const actions = (g.actions || (g.gtoMix && g.gtoMix.actions) || []).slice();
  // per-seat exploitability LOWER bound (the published error bar on the profile).
  let exploitBar = null;
  const bar = g.exploitabilityBar;
  if (bar) {
    const src = bar.bounds || bar.lower; // withTrueBR:false → bar.lower is the array
    if (Array.isArray(src)) {
      exploitBar = src.map(b => ({
        seat: b.seat,
        // LOWER bound only (honest): what a strong opponent can provably win.
        exploitLowerBound: (b.exploitLowerBound != null ? b.exploitLowerBound : b.exploit),
      }));
    }
  }
  return {
    gradeIdx: g.gradeIdx,
    seat: g.seat,
    street: g.street,
    streetName: g.streetName,
    heroActionId: g.chosen,
    heroActionLabel: razz3Game.actionLabel(g.chosen, st),
    // The blueprint PROFILE's action mix at this node (frequencies the two
    // opponents play). Emitted under a neutral key — the payload makes no
    // perfect-play claim of any kind.
    profileMix: {
      actions: g.gtoMix.actions,
      labels: g.gtoMix.actions.map(id => razz3Game.actionLabel(id, st)),
      probs: g.gtoMix.probs,
      trained: g.gtoMix.trained,
    },
    actions,
    actionLabels: actions.map(id => razz3Game.actionLabel(id, st)),
    perActionEV: g.perActionEV,
    bestActionId: g.bestAction,
    evLoss: g.evLoss,
    evLossSE: g.evLossSE,           // present only on blueprint-graded (earlier) streets
    // HONEST provenance the UI badges from:
    //   'exact-multiway-oracle'  → 7th-street exact certificate
    //   'blueprint-graded'       → earlier-street MC estimate vs the profile
    forwardMode: g.forwardMode,
    gradeSource: g.gradeSource,
    certified: g.certified,         // 'certified-…' or 'estimated-EV-loss-vs-stated-profile'
    exactPath: g.exactPath,         // 'grade7th-first-actor' | 'snapshot-exact' (7th only)
    exploitBar,                     // per-seat LOWER-bound bar (7th only)
    oppRangeSizes: g.oppRangeSizes,
    oppCoverage: g.oppCoverage,
  };
}

// deal → { seed, heroSeat, game, state } (state stops at the hero's first node,
// or terminal if the hero never acts this deal).
function trainer3Deal(req, res) {
  if (!getRazz3Bp()) return res.status(503).json({ error: 'razz3 blueprint unavailable on this server' });
  try {
    const seed = (Math.random() * 0x7fffffff) | 0;
    const heroSeat = razz3HeroSeat(seed);
    const r = replayRazz3(seed, []);
    const snap = r.done ? r.terminal : r.state;
    res.json({ seed, heroSeat, game: 'razz3', state: razz3ToState(snap, heroSeat, r.decisions) });
  } catch (error) {
    console.error('razz3 trainer3 deal error:', error);
    res.status(500).json({ error: 'Failed to deal razz3 hand' });
  }
}

// step → replay from seed + heroActions, advance to the next hero node OR
// terminal. On terminal: grade every hero decision (7th exact, earlier MC) and
// return the honest per-decision report + the per-seat exploitability bar.
async function trainer3Step(req, res) {
  if (!getRazz3Bp()) return res.status(503).json({ error: 'razz3 blueprint unavailable on this server' });
  try {
    const body = req.body || {};
    if (body.seed == null) return res.status(400).json({ error: 'seed is required' });
    const seed = body.seed | 0;
    const heroActions = Array.isArray(body.heroActions) ? body.heroActions : [];

    let r;
    try { r = replayRazz3(seed, heroActions); }
    catch (e) { if (e.illegal) return res.status(400).json({ error: e.message }); throw e; }
    const heroSeat = r.heroSeat;

    if (!r.done) {
      const legalActions = r.acts.map(id => ({ id, label: razz3Game.actionLabel(id, r.state) }));
      return res.json({
        state: razz3ToState(r.state, heroSeat, r.decisions),
        legalActions, handOver: false,
      });
    }

    // Terminal: result + honest grades. The REPLAY above is cheap (~ms) and stays
    // on the event loop; the HEAVY grade (grade3.gradeHand3, ~5.8s median) is
    // offloaded to the persistent worker thread so the loop stays free for other
    // users while this hand grades. The worker calls the identical gradeHand3
    // against the same handRecord + blueprint → byte-identical to the direct call.
    const hr = r.handRecord;
    const term = r.terminal;
    const result = razz3ResultPayload(term, hr.utility[heroSeat], heroSeat);
    let graded;
    try {
      graded = await razz3GradeManager().grade(hr, RAZZ3_GRADE_OPTS_PLAIN);
    } catch (e) {
      // A worker crash/timeout must NOT wedge the server or lose the hand — the
      // hand already played out (result is valid), only the grade failed. Return
      // a clean 502 so the client can surface "grading unavailable, try again".
      console.error('razz3 trainer3 grade worker failed:', e.message);
      if (!res.headersSent) res.status(502).json({ error: 'grading temporarily unavailable', gradeFailed: true, result });
      return;
    }
    const grades = graded.grades.map(g => razz3GradeToContract(g, hr));

    res.json({
      state: razz3ToState(term, heroSeat, hr.decisions),
      legalActions: null,
      handOver: true,
      result,
      grades,
      // HONEST profile framing carried to the client verbatim. label is the
      // certified-EV-loss string; claimsPerfectPlay:false records that the grade
      // asserts no single-correct-strategy claim (general-sum). The UI must not
      // relabel these. (grade3.gtoBanned===true → we assert perfect-play false.)
      profile: { label: graded.label, claimsPerfectPlay: !graded.gtoBanned, oracleGraded: graded.oracleGraded },
    });
  } catch (error) {
    console.error('razz3 trainer3 step error:', error);
    res.status(500).json({ error: 'Failed to step razz3 hand' });
  }
}

app.post('/api/solver/trainer3/razz3/deal', authenticateToken, (req, res) => { trainer3Deal(req, res); });
app.post('/api/solver/trainer3/razz3/step', authenticateToken, (req, res) => {
  // trainer3Step is async: the cheap replay runs on the loop, the heavy grade is
  // AWAITED on a worker thread (event loop free meanwhile). The catch is a
  // last-resort net so any unexpected rejection is a clean 500, not an unhandled
  // rejection that could wedge the process.
  Promise.resolve(trainer3Step(req, res)).catch(err => {
    console.error('razz3 trainer3 step (async) error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to step razz3 hand' });
  });
});

// ── Trainer graded-hand persistence (durable per-hand history) ───────────────
// These mirror the auth + style of the /api/solver/trainer/:game/(deal|step)
// routes above. The frontend posts the graded-hand object it already gets back
// from /step; we derive ev_loss_total + a per-round EV-loss array (so history
// rows are self-describing) and store the full object for later re-display.
//   POST /api/solver/trainer/:game/save-hand   -> { ok, id }
//   GET  /api/solver/trainer/:game/history?limit=50 -> [{ id, played_at, ev_loss_total, per_round }]
//   GET  /api/solver/trainer/:game/hand/:id    -> the full stored hand_json

// Sum positive per-decision EV-loss, and bucket it by street index (0-based),
// matching the scoreboard's byStreet semantics. Returns { total, perRound }.
function summarizeTrainerGrades(grades) {
  const perRound = [];
  let total = 0;
  for (const g of (Array.isArray(grades) ? grades : [])) {
    const loss = Math.max(0, +(g && g.evLoss) || 0);
    total += loss;
    const st = Math.max(0, g && g.street | 0);
    perRound[st] = (perRound[st] || 0) + loss;
  }
  for (let i = 0; i < perRound.length; i++) if (perRound[i] == null) perRound[i] = 0;
  return { total, perRound };
}

app.post('/api/solver/trainer/:game/save-hand', authenticateToken, async (req, res) => {
  const game = resolveTrainerGame(req, res); if (!game) return;
  try {
    const hand = req.body || {};
    const grades = Array.isArray(hand.grades) ? hand.grades : [];
    const { total, perRound } = summarizeTrainerGrades(grades);
    const playedAt = Date.now();

    db.run(
      `INSERT INTO trainer_hands (user_id, game, played_at, ev_loss_total, per_round_json, hand_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, game.id, playedAt, total, JSON.stringify(perRound), JSON.stringify(hand)]
    );
    // Read the new rowid BEFORE saveDatabase() — persisting reloads the in-memory
    // db, after which last_insert_rowid() resets to 0 (sql.js quirk).
    const idStmt = db.prepare('SELECT last_insert_rowid() as id');
    idStmt.step();
    const { id } = idStmt.getAsObject();
    idStmt.free();
    await saveDatabase();
    res.json({ ok: true, id });
  } catch (error) {
    console.error(`${game.id} trainer save-hand error:`, error);
    res.status(500).json({ error: `Failed to save ${game.id} hand` });
  }
});

app.get('/api/solver/trainer/:game/history', authenticateToken, (req, res) => {
  const game = resolveTrainerGame(req, res); if (!game) return;
  try {
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    limit = Math.min(limit, 200);

    const stmt = db.prepare(`
      SELECT id, played_at, ev_loss_total, per_round_json
      FROM trainer_hands
      WHERE user_id = ? AND game = ?
      ORDER BY played_at DESC, id DESC
      LIMIT ?
    `);
    stmt.bind([req.user.id, game.id, limit]);
    const hands = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      let perRound = [];
      try { perRound = JSON.parse(row.per_round_json || '[]'); } catch { perRound = []; }
      hands.push({
        id: row.id,
        played_at: row.played_at,
        ev_loss_total: row.ev_loss_total,
        per_round: perRound,
      });
    }
    stmt.free();
    res.json(hands);
  } catch (error) {
    console.error(`${game.id} trainer history error:`, error);
    res.status(500).json({ error: `Failed to load ${game.id} history` });
  }
});

app.get('/api/solver/trainer/:game/hand/:id', authenticateToken, (req, res) => {
  const game = resolveTrainerGame(req, res); if (!game) return;
  try {
    const stmt = db.prepare(`
      SELECT id, played_at, ev_loss_total, per_round_json, hand_json
      FROM trainer_hands
      WHERE id = ? AND user_id = ? AND game = ?
    `);
    stmt.bind([req.params.id, req.user.id, game.id]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(404).json({ error: 'Hand not found' });
    }
    const row = stmt.getAsObject();
    stmt.free();
    let hand = null, perRound = [];
    try { hand = JSON.parse(row.hand_json || 'null'); } catch { hand = null; }
    try { perRound = JSON.parse(row.per_round_json || '[]'); } catch { perRound = []; }
    res.json({
      id: row.id,
      played_at: row.played_at,
      ev_loss_total: row.ev_loss_total,
      per_round: perRound,
      hand,
    });
  } catch (error) {
    console.error(`${game.id} trainer hand error:`, error);
    res.status(500).json({ error: `Failed to load ${game.id} hand` });
  }
});

// ── Neural solver bridge (proxy to the Python solve_server) ──────────────────
// The Stud8/razz neural solver runs as a separate local Python HTTP service
// (solver/neural/solve_server.py, default 127.0.0.1:8000). These proxies let the
// React app reach it WITH the app's own auth (authenticateToken) and WITHOUT
// CORS — the browser only ever talks to this Express origin. Set SOLVER_URL to
// point at a non-default host/port. Node 18+ provides a global fetch().
const SOLVER_URL = process.env.SOLVER_URL || 'http://localhost:8000';

async function proxyToSolver(solverPath, req, res) {
  let upstream;
  try {
    upstream = await fetch(`${SOLVER_URL}${solverPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
  } catch (err) {
    // Connection refused / DNS / network -> the Python service isn't running.
    console.error(`Solver proxy (${solverPath}) unreachable:`, err.message);
    return res.status(503).json({ error: 'solver offline — start solve_server.py' });
  }
  // Forward the solver's status + JSON verbatim (it already returns
  // {error} on 400/500 and the solve JSON on 200).
  const text = await upstream.text();
  res.status(upstream.status).type('application/json').send(text);
}

// EXACT node-locked spot -> solve_server /solve
app.post('/api/solver/exact', authenticateToken, (req, res) =>
  proxyToSolver('/solve', req, res));

// Range-vs-range equilibrium -> solve_server /solve/range
app.post('/api/solver/range', authenticateToken, (req, res) =>
  proxyToSolver('/solve/range', req, res));

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

// Admin: list users (JWT auth, hardcoded admin username)
app.get('/api/admin/users-list', authenticateToken, requireRegistered, (req, res) => {
  if (!['ham', 'ham5'].includes((req.user.username || '').toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const stmt = db.prepare('SELECT id, username, email, real_name, avatar, created_at, hand_replayer_access FROM users ORDER BY created_at DESC');
    const users = [];
    while (stmt.step()) users.push(stmt.getAsObject());
    stmt.free();
    res.json(users);
  } catch (error) {
    console.error('Admin users-list error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin: toggle hand replayer access
app.put('/api/admin/users/:id/replayer-access', authenticateToken, requireRegistered, async (req, res) => {
  if (!['ham', 'ham5'].includes((req.user.username || '').toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { enabled } = req.body;
    db.run('UPDATE users SET hand_replayer_access = ? WHERE id = ?', [enabled ? 1 : 0, req.params.id]);
    await saveDatabase();
    res.json({ success: true });
  } catch (error) {
    console.error('Admin replayer-access error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Admin: update tournament fields
app.put('/api/tournaments/:id', authenticateToken, requireRegistered, async (req, res) => {
  if (!['ham', 'ham5'].includes((req.user.username || '').toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const id = parseInt(req.params.id);
    const allowedFields = [
      'event_name', 'event_number', 'date', 'time', 'buyin', 'game_variant',
      'starting_chips', 'level_duration', 'reentry', 'late_reg', 'late_reg_end',
      'venue', 'notes', 'category', 'is_satellite', 'is_restart', 'rake_pct',
      'rake_dollars', 'house_fee', 'opt_add_on', 'prize_pool', 'total_entries'
    ];
    const updates = [];
    const values = [];
    const changedFields = {};
    for (const [key, val] of Object.entries(req.body)) {
      if (allowedFields.includes(key)) {
        const normalized = val === '' ? null : val;
        updates.push(`${key} = ?`);
        values.push(normalized);
        changedFields[key] = normalized;
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    values.push(id);
    db.run(`UPDATE tournaments SET ${updates.join(', ')} WHERE id = ?`, values);
    if (db.getRowsModified() === 0) return res.status(404).json({ error: 'Tournament not found' });
    await saveDatabase();
    // Return updated tournament
    const stmt = db.prepare('SELECT * FROM tournaments WHERE id = ?');
    stmt.bind([id]);
    let updated = null;
    if (stmt.step()) updated = stmt.getAsObject();
    stmt.free();
    broadcastToAll('tournament-changed', { id, fields: changedFields });
    res.json(updated);
  } catch (error) {
    console.error('Admin update tournament error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Venue Colors ────────────────────────────────────────────
// Get all custom venue colors
app.get('/api/venue-colors', (req, res) => {
  try {
    const stmt = db.prepare('SELECT venue_abbr, color FROM venue_colors');
    const colors = {};
    while (stmt.step()) {
      const row = stmt.getAsObject();
      colors[row.venue_abbr] = row.color;
    }
    stmt.free();
    res.json(colors);
  } catch (err) {
    res.json({});
  }
});

// Set a venue color (admin only)
app.put('/api/venue-colors/:abbr', authenticateToken, requireRegistered, async (req, res) => {
  if (!['ham', 'ham5'].includes((req.user.username || '').toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { color } = req.body;
  const abbr = req.params.abbr;
  if (!color || !abbr) return res.status(400).json({ error: 'Missing color or abbr' });
  try {
    db.run('INSERT INTO venue_colors (venue_abbr, color) VALUES (?, ?) ON CONFLICT(venue_abbr) DO UPDATE SET color = ?', [abbr, color, color]);
    await saveDatabase();
    broadcastToAll('venue-colors-changed', { [abbr]: color });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Swap / Crossbook Suggestions ────────────────────────────

// Send a swap/crossbook suggestion
app.post('/api/swap-suggest', authenticateToken, requireRegistered, (req, res) => {
  try {
    const { toUserId, tournamentId, type, myPct, theirPct } = req.body;
    if (!toUserId || !tournamentId) return res.status(400).json({ error: 'Missing required fields' });
    if (!['swap', 'crossbook'].includes(type)) return res.status(400).json({ error: 'Type must be swap or crossbook' });
    const my = parseFloat(myPct) || 0;
    const their = parseFloat(theirPct) || 0;
    if (my <= 0 || my > 100 || their <= 0 || their > 100) return res.status(400).json({ error: 'Percentages must be 1-100' });
    if (toUserId === req.user.id) return res.status(400).json({ error: "Can't swap with yourself" });

    // Check for existing pending suggestion for same pair + tournament
    const chk = db.prepare(
      `SELECT id FROM swap_suggestions WHERE from_user_id = ? AND to_user_id = ? AND tournament_id = ? AND status = 'pending'`
    );
    chk.bind([req.user.id, toUserId, tournamentId]);
    if (chk.step()) { chk.free(); return res.status(400).json({ error: 'You already have a pending suggestion for this event' }); }
    chk.free();

    db.run(
      `INSERT INTO swap_suggestions (from_user_id, to_user_id, tournament_id, type, my_pct, their_pct) VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, toUserId, tournamentId, type, my, their]
    );
    res.json({ message: 'Suggestion sent' });
  } catch (err) {
    console.error('Swap suggest error:', err);
    res.status(500).json({ error: 'Failed to send suggestion' });
  }
});

// Get your swap suggestions (incoming + outgoing)
app.get('/api/swap-suggestions', authenticateToken, requireRegistered, (req, res) => {
  try {
    // Incoming
    const inStmt = db.prepare(`
      SELECT ss.*, u.username AS from_username, u.avatar AS from_avatar, u.real_name AS from_real_name,
             t.event_name, t.date, t.time, t.buyin, t.venue
      FROM swap_suggestions ss
      JOIN users u ON ss.from_user_id = u.id
      JOIN tournaments t ON ss.tournament_id = t.id
      WHERE ss.to_user_id = ? AND ss.status = 'pending'
      ORDER BY ss.created_at DESC
    `);
    inStmt.bind([req.user.id]);
    const incoming = [];
    while (inStmt.step()) incoming.push(inStmt.getAsObject());
    inStmt.free();

    // Outgoing
    const outStmt = db.prepare(`
      SELECT ss.*, u.username AS to_username, u.avatar AS to_avatar, u.real_name AS to_real_name,
             t.event_name, t.date, t.time, t.buyin, t.venue
      FROM swap_suggestions ss
      JOIN users u ON ss.to_user_id = u.id
      JOIN tournaments t ON ss.tournament_id = t.id
      WHERE ss.from_user_id = ? AND ss.status = 'pending'
      ORDER BY ss.created_at DESC
    `);
    outStmt.bind([req.user.id]);
    const outgoing = [];
    while (outStmt.step()) outgoing.push(outStmt.getAsObject());
    outStmt.free();

    res.json({ incoming, outgoing });
  } catch (err) {
    console.error('Swap suggestions error:', err);
    res.status(500).json({ error: 'Failed to load suggestions' });
  }
});

// Respond to a swap suggestion
app.put('/api/swap-suggest/:id/respond', authenticateToken, requireRegistered, (req, res) => {
  try {
    const { response } = req.body;
    if (!['accepted', 'declined'].includes(response)) return res.status(400).json({ error: 'Response must be accepted or declined' });

    const stmt = db.prepare('SELECT * FROM swap_suggestions WHERE id = ? AND to_user_id = ? AND status = ?');
    stmt.bind([req.params.id, req.user.id, 'pending']);
    let suggestion = null;
    if (stmt.step()) suggestion = stmt.getAsObject();
    stmt.free();

    if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });

    db.run(
      `UPDATE swap_suggestions SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [response, req.params.id]
    );
    res.json({ message: `Suggestion ${response}` });
  } catch (err) {
    console.error('Swap respond error:', err);
    res.status(500).json({ error: 'Failed to respond' });
  }
});

// ── Geocoding (city/postal code → lat/lng via Nominatim) ────
app.get('/api/geocode', authenticateToken, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query' });

  try {
    const url = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'FutureGame-PokerScheduler/1.0' }
    });
    const data = await resp.json();
    const results = data.map(r => ({
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      display: r.display_name,
      short: [r.address?.city || r.address?.town || r.address?.village || r.address?.county, r.address?.state, r.address?.country_code?.toUpperCase()].filter(Boolean).join(', '),
    }));
    res.json({ results });
  } catch (err) {
    console.error('[Geocode] Error:', err.message);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

// ── Push Notifications ──────────────────────────────────────

// VAPID public key (needed by frontend to subscribe)
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// Save push subscription
app.post('/api/push-subscribe', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    // Upsert: replace if endpoint already exists
    db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [subscription.endpoint]);
    db.run(
      'INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?, ?)',
      [req.user.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
    );
    await saveDatabase();
    res.json({ message: 'Subscribed' });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// Remove push subscription
app.post('/api/push-unsubscribe', authenticateToken, requireRegistered, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) {
      db.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [endpoint, req.user.id]);
    } else {
      db.run('DELETE FROM push_subscriptions WHERE user_id = ?', [req.user.id]);
    }
    await saveDatabase();
    res.json({ message: 'Unsubscribed' });
  } catch (err) {
    console.error('Push unsubscribe error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// Helper: send push notification to admin user(s)
async function sendPushToAdmin(title, body, url) {
  if (!process.env.VAPID_PUBLIC_KEY) return { configured: false, results: [], pruned: 0 };
  try {
    const stmt = db.prepare(`
      SELECT ps.endpoint, ps.keys_p256dh, ps.keys_auth
      FROM push_subscriptions ps
      JOIN users u ON ps.user_id = u.id
      WHERE LOWER(u.username) = 'ham'
    `);
    const subs = [];
    while (stmt.step()) subs.push(stmt.getAsObject());
    stmt.free();

    const payload = JSON.stringify({ title, body, url: url || '/', tag: 'admin' });
    const results = [];
    let pruned = 0;
    for (const sub of subs) {
      let host = 'unknown';
      try { host = new URL(sub.endpoint).host; } catch (_) {}
      try {
        const r = await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth }
        }, payload);
        results.push({ host, status: r && r.statusCode ? r.statusCode : 201, ok: true });
      } catch (err) {
        results.push({ host, status: err.statusCode || null, ok: false });
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired — remove it
          db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
          pruned++;
        } else {
          console.error('Push send error:', err.statusCode || err.message);
        }
      }
    }
    // sql.js holds the DB in memory: without this the prune above is discarded on the next
    // restart, so dead endpoints accumulate forever (13 stale Apple ones had piled up by
    // 2026-08-18). The console's copy of this function has always saved; this one never did.
    if (pruned) await saveDatabase();
    return { configured: true, results, pruned };
  } catch (err) {
    console.error('sendPushToAdmin error:', err);
    return { configured: true, results: [], pruned: 0, error: err.message };
  }
}

// ── Cron plumbing (backer weekly digests) ──
// The console nudge/checklist/Oura crons moved to the standalone dashboard
// service (dashboard.futurega.me). What remains on this clock: the Sunday
// backer digest, fired on the user's Eastern clock regardless of server TZ.
const cron = require('node-cron');
const CONSOLE_TZ = 'America/New_York';


// ── Backer notification helpers ──
function backerCumulativeCents(token) {
  let c = 0;
  const s = db.prepare('SELECT COALESCE(SUM(share_cents),0) AS c FROM backer_events WHERE token = ?');
  s.bind([token]); if (s.step()) c = s.getAsObject().c; s.free();
  return c || 0;
}
function backerSubCount(token) {
  let n = 0;
  const s = db.prepare('SELECT COUNT(*) AS n FROM backer_push_subs WHERE token = ?');
  s.bind([token]); if (s.step()) n = s.getAsObject().n; s.free();
  return n || 0;
}
// The synced backer object (from console_records) for a token, or null. Lets the
// backer page show a name + stakes the moment the backer is created in the app,
// before any session has been notified (backer_public is only set on notify).
function backerRecordByToken(token) {
  const s = db.prepare("SELECT data FROM console_records WHERE store = 'backers' AND deleted = 0");
  let found = null;
  while (s.step()) {
    try {
      const b = JSON.parse(s.getAsObject().data);
      if (b && b.token === token) { found = b; break; }
    } catch (_) { /* skip malformed */ }
  }
  s.free();
  return found;
}

// ── MTT feed ingest (mtt-series-watcher → scheduler) ──
// The MTT series watcher (sibling repo mtt-series-watcher) emits pre-normalized snake_case
// seed files + a manifest into ./mtt-feed/ hourly at :15. Unlike seedFiles (idempotent
// per-venue) this UPSERTS by (venue, event_number), so re-emitted schedules update existing
// rows and add new events. Rows are already normalized (event_name/reentry/game_variant),
// so the JSON-seed path's lack of normalizeEventName()/normalizeReentry() is fine.
// Runs at boot (from initDatabase, after dataMigrations) + hourly at :20. No-ops when
// ./mtt-feed is absent. After each ingest, pushMttFeedToProd() mirrors the feed rows to
// production (SYNC_TOKEN-gated; self-disables without the token, so the seam is opt-in).

// Deterministic id for feed rows so /api/tournaments/feed-sync can upsert by stable_id.
// event_number is unique within a venue (watcher-assigned, e.g. "PA-291042-20260811");
// the MTT- prefix keeps these ids disjoint from the migration-era legacy ids.
function feedStableId(t) {
  if (!t.event_number) return null;
  const v = String(t.venue || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase();
  return `MTT-${v}-${t.event_number}`;
}

// Tables holding user work that references a tournament. A feed row touched by any of
// them is never pruned: a series dropping out of the watcher's window usually means it
// ENDED, and those are exactly the events someone has results or a saved entry for.
// Deleting them would destroy real history to tidy up a schedule.
const FEED_REF_TABLES = [
  'user_schedules', 'schedule_conditions', 'tracking_entries', 'live_updates',
  'backer_event_overrides', 'backer_event_status', 'swap_suggestions',
];
function feedRefGuardSql() {
  const present = FEED_REF_TABLES.filter(name => {
    const s = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
    s.bind([name]);
    const found = s.step();
    s.free();
    return found;
  });
  return present
    .map(t => ` AND NOT EXISTS (SELECT 1 FROM ${t} r WHERE r.tournament_id = tournaments.id)`)
    .join('');
}

// Delete feed-managed rows whose series is no longer in `keepVenues`. Shared by the local
// ingest and the production feed-sync endpoint so both databases prune by the same rule.
// Returns {pruned, skipped} — skipped counts rows kept only because of the guard above.
function pruneFeedVenues(keepVenues, label) {
  const keep = new Set(keepVenues);
  const distinct = db.exec("SELECT DISTINCT venue FROM tournaments WHERE source_pdf = 'mtt-feed'");
  if (!distinct.length) return { pruned: 0, skipped: 0 };
  const guard = feedRefGuardSql();
  let pruned = 0, skipped = 0;
  for (const [venue] of distinct[0].values) {
    if (keep.has(venue)) continue;
    const before = db.exec(
      "SELECT COUNT(*) FROM tournaments WHERE source_pdf = 'mtt-feed' AND venue = ?",
      [venue]
    )[0].values[0][0];
    db.run(`DELETE FROM tournaments WHERE source_pdf = 'mtt-feed' AND venue = ?${guard}`, [venue]);
    const gone = db.getRowsModified();
    pruned += gone;
    skipped += before - gone;
  }
  if (skipped > 0) {
    console.log(`[${label}] kept ${skipped} row(s) from dropped series — referenced by saved schedules or results`);
  }
  return { pruned, skipped };
}

async function ingestMttFeed() {
  const fs = require('fs');
  try {
    const manifestPath = path.join(__dirname, 'mtt-feed', 'manifest.json');
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let upserts = 0, inserts = 0, pruned = 0;
    // Prune feed-managed rows (source_pdf='mtt-feed') for series no longer in the manifest — i.e.
    // series that ended or dropped out of the watcher's forward window. Keeps the schedule in sync
    // with the feed (add/update/remove) without touching non-feed tournaments.
    const manifestVenues = manifest.map(e => e.venue);
    pruned = pruneFeedVenues(manifestVenues, 'MTT feed').pruned;
    for (const entry of manifest) {
      const filePath = path.join(__dirname, 'mtt-feed', entry.file);
      if (!fs.existsSync(filePath)) continue;
      const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const t of rows) {
        // COALESCE: backfill stable_id on rows that predate feedStableId without ever
        // overwriting a legacy id production may already key on.
        db.run(
          `UPDATE tournaments SET
             event_name = ?, date = ?, time = ?, buyin = ?, starting_chips = ?,
             level_duration = ?, reentry = ?, late_reg = ?, late_reg_end = ?, game_variant = ?,
             notes = ?, category = ?, is_satellite = ?, is_restart = ?, prize_pool = ?,
             house_fee = ?, opt_add_on = ?, rake_pct = ?, rake_dollars = ?, is_deepstack = ?,
             source_pdf = ?, stable_id = COALESCE(stable_id, ?)
           WHERE venue = ? AND event_number = ?`,
          [t.event_name, t.date, t.time, t.buyin, t.starting_chips,
           t.level_duration, t.reentry, t.late_reg, t.late_reg_end, t.game_variant,
           t.notes, t.category, t.is_satellite || 0, t.is_restart || 0, t.prize_pool,
           t.house_fee, t.opt_add_on, t.rake_pct, t.rake_dollars, t.is_deepstack || 0,
           t.source_pdf || 'mtt-feed', feedStableId(t),
           t.venue, t.event_number]
        );
        if (db.getRowsModified() > 0) { upserts++; continue; }
        db.run(
          `INSERT INTO tournaments (event_number, event_name, date, time, buyin,
           starting_chips, level_duration, reentry, late_reg, late_reg_end,
           game_variant, venue, notes, category, is_satellite, target_event,
           is_restart, parent_event, prize_pool, house_fee, opt_add_on,
           rake_pct, rake_dollars, source_pdf, is_deepstack, stable_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.event_number || '', t.event_name, t.date, t.time, t.buyin,
           t.starting_chips, t.level_duration, t.reentry, t.late_reg, t.late_reg_end,
           t.game_variant, t.venue, t.notes, t.category, t.is_satellite || 0, t.target_event,
           t.is_restart || 0, t.parent_event, t.prize_pool, t.house_fee, t.opt_add_on,
           t.rake_pct, t.rake_dollars, t.source_pdf, t.is_deepstack || 0, feedStableId(t)]
        );
        inserts++;
      }
    }
    if (upserts + inserts + pruned > 0) {
      await saveDatabase();
      console.log(`MTT feed sync: ${inserts} inserted, ${upserts} updated, ${pruned} pruned from ${manifest.length} file(s)`);
    }
  } catch (e) {
    console.log('MTT feed sync skipped:', e.message);
  }
}

// Mirror feed-managed rows to production so futurega.me tracks the watcher without a
// deploy or manual import. Only rows with a stable_id are sent (the endpoint upserts by
// stable_id). Never runs ON production; requires SYNC_TOKEN to match Render's env.
const FEED_SYNC_BASE_URL = process.env.FEED_SYNC_BASE_URL || 'https://futurega.me';
async function pushMttFeedToProd() {
  const token = process.env.SYNC_TOKEN;
  if (!token) return;
  if (process.env.RENDER || process.env.IS_PRODUCTION) return;
  try {
    const stmt = db.prepare("SELECT * FROM tournaments WHERE source_pdf = 'mtt-feed' AND stable_id IS NOT NULL");
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    if (!rows.length) return;
    // feedVenues is the authoritative list of series we still carry. The receiver prunes
    // feed rows outside it, so a series ending here also ends there — without it, prod
    // accumulated series the watcher had long dropped.
    const feedVenues = [...new Set(rows.map(r => r.venue))];
    const res = await fetch(`${FEED_SYNC_BASE_URL}/api/tournaments/feed-sync/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournaments: rows, feedVenues })
    });
    if (!res.ok) { console.log('[MTT feed] prod push failed:', res.status); return; }
    const result = await res.json();
    const prunedNote = result.pruned ? `, ${result.pruned} pruned` : '';
    console.log(`[MTT feed] → prod: ${result.inserted} new, ${result.updated} updated, ${result.skipped} skipped${prunedNote}`);
  } catch (err) {
    console.error('[MTT feed] prod push error:', err.message);
  }
}

// ── Backer-roster seam (dashboard → scheduler) ──
// The backer roster (names/stakes) is authored in the standalone dashboard now;
// our console_records 'backers' store froze at the 2026-08-09 cutover. Pull the
// current roster over HTTP (DASHBOARD_TOKEN-gated, sync-protocol shape) and
// LWW-merge it, so /b/:token pages + the weekly digest see new/renamed backers.
// Runs at boot + hourly (:35); self-disables without DASHBOARD_TOKEN.
const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL || 'https://dashboard.futurega.me';
async function syncBackerRoster() {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`${DASHBOARD_BASE_URL}/api/roster/${token}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const records = Array.isArray(body && body.records) ? body.records : [];
    let changed = 0;
    for (const r of records) {
      if (!r || r.store !== 'backers' || typeof r.id !== 'string' || typeof r.updatedAt !== 'number') continue;
      db.run(
        `INSERT INTO console_records (store, id, data, updated_at, deleted)
         VALUES ('backers', ?, ?, ?, 0)
         ON CONFLICT(store, id) DO UPDATE SET
           data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
         WHERE excluded.updated_at >= console_records.updated_at`,
        [r.id, typeof r.data === 'string' ? r.data : null, r.updatedAt]
      );
      changed += db.getRowsModified();
    }
    if (changed) {
      await saveDatabase();
      console.log(`[roster] backer roster synced from dashboard: ${changed} row(s) updated`);
    }
  } catch (err) {
    console.error('[roster] backer roster sync failed:', err.message);
  }
}

// ── Dashboard seam-#2 helpers ────────────────────────────────────────────────
// The dashboard itself lives at dashboard.futurega.me; the only surface left
// here is the token-gated upcoming-schedule feed (seam #2).

// Constant-time token check against process.env.DASHBOARD_TOKEN. Shape-gate
// first (so a malformed token can't reach the compare), then length-guard
// timingSafeEqual (it throws on unequal-length buffers). Returns false — the
// caller 404s — on any mismatch, matching the backer routes' unguessable posture.
function dashboardTokenOk(token) {
  const expected = process.env.DASHBOARD_TOKEN || '';
  if (!expected || !BACKER_TOKEN_RE.test(token)) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Dashboard events: the user's upcoming SCHEDULED tournaments (his MTT picks) ──
// Same sql.js db holds tournaments/user_schedules/users alongside console_records.
// Resolve the owner by DASHBOARD_USER_ID or DASHBOARD_USER_EMAIL (default Ethan),
// join his picks, parse the mixed date formats (ISO + 'Month D, YYYY'), return the
// next N upcoming. Empty (never throws) if no user / no picks / no tables.
function dashboardUserId() {
  const envId = Number(process.env.DASHBOARD_USER_ID);
  if (Number.isFinite(envId) && envId >= 0) return envId;
  const who = process.env.DASHBOARD_USER_EMAIL || 'ethanibennett@gmail.com';
  try {
    const s = db.prepare('SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1');
    s.bind([who, who]);
    let id = null;
    if (s.step()) id = s.getAsObject().id;
    s.free();
    return id == null ? null : Number(id);
  } catch (_) { return null; }
}
// Local (not UTC) YYYY-MM-DD. computeDashboardEvents below has called this since
// it was written, but the definition left with the console extraction - so every
// request to /api/schedule/:token/upcoming threw ReferenceError and returned 500.
// The dashboard's refreshDepartures() swallows that and serves [] forever, which
// is why the departures board looked like an empty calendar rather than a fault.
// Must stay LOCAL-date: it is compared against tournament dates entered as local
// days, and a UTC version shifts every evening event a day early.
function dashLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function computeDashboardEvents(now = new Date(), limit = 6) {
  const uid = dashboardUserId();
  if (uid == null) return [];
  const rows = [];
  try {
    const s = db.prepare(
      'SELECT t.date AS date, t.event_name AS event, t.buyin AS buyin, t.game_variant AS variant, us.is_anchor AS anchor ' +
      'FROM user_schedules us JOIN tournaments t ON t.id = us.tournament_id WHERE us.user_id = ?'
    );
    s.bind([uid]);
    while (s.step()) rows.push(s.getAsObject());
    s.free();
  } catch (_) { return []; }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date(dashLocalDate(now) + 'T00:00:00').getTime();
  const parse = (d) => {
    if (!d) return null;
    const str = String(d);
    const iso = /^\d{4}-\d{2}-\d{2}/.test(str);
    const dt = new Date(iso ? str.slice(0, 10) + 'T00:00:00' : str);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };
  const out = [];
  for (const r of rows) {
    const dt = parse(r.date);
    if (!dt) continue;
    const daysAway = Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() - today) / 86400000);
    if (daysAway < 0) continue;
    out.push({
      dateISO: dashLocalDate(dt),
      dateLabel: MON[dt.getMonth()] + ' ' + dt.getDate(),
      weekday: WD[dt.getDay()],
      daysAway,
      event: String(r.event || ''),
      buyin: Number(r.buyin) || 0,
      variant: String(r.variant || ''),
      anchor: !!r.anchor,
    });
  }
  out.sort((a, b) => a.daysAway - b.daysAway || a.event.localeCompare(b.event));
  return out.slice(0, limit);
}


const SRV_FMT_LABEL = {
  PLO: 'PLO', PLO8: 'PLO8', NLH: 'NLH', mixed: 'Mixed', stud8: 'Stud8',
  razz: 'Razz', '2-7': '2-7', BigO: 'Big O', other: 'Other', all: 'all games',
};
function stakesSummaryServer(stakes) {
  if (!Array.isArray(stakes) || !stakes.length) return '';
  return stakes
    .map((s) => {
      const f = SRV_FMT_LABEL[s.format] || s.format;
      const c = s.channel && s.channel !== 'any' ? ` (${s.channel})` : '';
      return `${s.pct}% ${f}${c}`;
    })
    .join(' · ');
}
async function sendBackerPush(token, title, body, url) {
  let sent = 0, subs = 0, changed = false;
  if (!process.env.VAPID_PUBLIC_KEY) return { sent, subs, changed };
  const list = [];
  const s = db.prepare('SELECT endpoint, keys_p256dh, keys_auth FROM backer_push_subs WHERE token = ?');
  s.bind([token]); while (s.step()) list.push(s.getAsObject()); s.free();
  subs = list.length;
  if (!subs) return { sent, subs, changed };
  const payload = JSON.stringify({ title, body, url, tag: 'action' });
  for (const sub of list) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
        payload
      );
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.run('DELETE FROM backer_push_subs WHERE endpoint = ?', [sub.endpoint]);
        changed = true;
      } else {
        console.error('Backer push send error:', err.statusCode || err.message);
      }
    }
  }
  return { sent, subs, changed };
}
function fmtSignedCents(cents) {
  const v = (Number(cents) || 0) / 100;
  const n = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (v < 0 ? '−' : '+') + '$' + n;
}
function fmtHours(h) {
  return (Math.round((Number(h) || 0) * 10) / 10) + 'h';
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Generic console email via the existing SMTP transporter (password resets use
// the same one). Returns true on send, false if SMTP isn't configured.
async function sendConsoleEmail(to, subject, html) {
  if (!mailTransporter) {
    console.log('[console] email skipped (SMTP unconfigured):', to, '·', subject);
    return false;
  }
  try {
    await mailTransporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html });
    return true;
  } catch (err) {
    console.error('Console email error:', err.message);
    return false;
  }
}

// Per-session backer text via Twilio's REST API (no SDK dependency). Inert
// until TWILIO_* env vars are set — returns 'unconfigured' so the UI can say so.
async function sendBackerSms(phone, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM || process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return 'unconfigured';
  if (typeof fetch !== 'function') return 'error';
  try {
    const params = new URLSearchParams({ To: phone, From: from, Body: body });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) {
      console.error('Twilio SMS failed:', res.status);
      return 'error';
    }
    return 'sent';
  } catch (err) {
    console.error('Twilio SMS error:', err.message);
    return 'error';
  }
}

// Weekly email digest for backers with an email on file: the past 7 days of
// their recorded sessions + their running total. Reads backer objects from the
// synced console_records (store='backers'); events from backer_events.
async function sendBackerWeeklyDigests() {
  try {
    const backers = [];
    const s = db.prepare("SELECT data FROM console_records WHERE store = 'backers' AND deleted = 0");
    while (s.step()) {
      try {
        const b = JSON.parse(s.getAsObject().data);
        if (b && b.token && b.delivery && b.delivery.email) backers.push(b);
      } catch (_) { /* skip malformed */ }
    }
    s.free();
    if (!backers.length) return;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const b of backers) {
      const evs = [];
      const es = db.prepare(
        'SELECT date, game, venue, hours, session_result_cents, pct, share_cents FROM backer_events WHERE token = ? AND ts >= ? ORDER BY ts DESC'
      );
      es.bind([b.token, weekAgo]);
      while (es.step()) evs.push(es.getAsObject());
      es.free();
      if (!evs.length) continue; // nothing to report this week
      const cum = backerCumulativeCents(b.token) + Math.round((Number(b.opening) || 0) * 100);
      const weekShare = evs.reduce((a, e) => a + (e.share_cents || 0), 0);
      const rows = evs.map((e) => {
        const col = (e.share_cents || 0) >= 0 ? '#2c7a52' : '#c0544c';
        return `<tr>
          <td style="padding:6px 10px 6px 0;">${escapeHtml(e.game)}</td>
          <td style="padding:6px 10px 6px 0;color:#888;">${escapeHtml(e.venue)} · ${fmtHours(e.hours)} · ${escapeHtml(e.date)}</td>
          <td style="padding:6px 0;text-align:right;font-weight:600;color:${col};">${fmtSignedCents(e.share_cents)}</td>
        </tr>`;
      }).join('');
      const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111;">
        <h2 style="margin:0 0 2px;">Your week with Ethan</h2>
        <p style="color:#888;margin:0 0 16px;">${evs.length} session${evs.length > 1 ? 's' : ''} · your week ${fmtSignedCents(weekShare)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
        <p style="margin:18px 0 4px;font-size:16px;"><strong>Running total: ${fmtSignedCents(cum)}</strong></p>
        <p style="color:#888;font-size:12px;">Full detail anytime: <a href="https://futurega.me/b/${b.token}">your private page</a>.</p>
      </div>`;
      await sendConsoleEmail(b.delivery.email, 'Your weekly staking digest', html);
    }
  } catch (err) {
    console.error('Backer weekly digest error:', err);
  }
}

// The backer page — one self-contained shell for every token. Client JS reads
// the token from the URL, fetches its own feed, and (opt-in) enables web push.
const BACKER_PAGE_HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#111111">
<title>Your action</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@700&display=swap" rel="stylesheet">
<style>
@font-face{font-family:'Univers Condensed';src:url('/bfonts/univers-condensed.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'Univers Condensed';src:url('/bfonts/univers-bold-condensed.woff2') format('woff2');font-weight:700;font-display:swap}
@font-face{font-family:'Univers';src:url('/bfonts/univers-regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'Univers';src:url('/bfonts/univers-bold.woff2') format('woff2');font-weight:700;font-display:swap}
:root{--ink:#111111;--surface:#1a1a1a;--surface-2:#242424;--line:#333333;--bone:#e8e8e8;--muted:#808080;--good:#5a9e7a;--bad:#c96b6b}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--bone);font-family:'Univers Condensed','Univers',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
.wrap{max-width:520px;margin:0 auto;padding:26px 18px 64px}
.title{font-family:'Libre Baskerville',Georgia,serif;font-weight:700;font-size:26px;letter-spacing:-.03em;margin:0}
.sub{font-family:'Univers Condensed','Univers',monospace;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-top:4px}
.stakes{color:var(--muted);font-size:13px;margin-top:10px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0 14px}
.card-label{font-family:'Univers Condensed','Univers',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.big{font-family:'Univers Condensed','Univers',monospace;font-weight:700;font-size:40px;letter-spacing:-.01em;line-height:1;font-variant-numeric:tabular-nums}
.small{color:var(--muted);font-size:12px;margin-top:8px}
.pos{color:var(--good)}.neg{color:var(--bad)}
.muted{color:var(--muted)}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0;padding-top:0}
.row-label{font-weight:700;font-size:15px}
.row-meta{color:var(--muted);font-size:12.5px;margin-top:4px;line-height:1.4}
.row-result{font-family:'Univers Condensed','Univers',monospace;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.btn{display:block;width:100%;margin:2px 0 8px;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--surface-2);color:var(--bone);font-family:inherit;font-size:14px;font-weight:700;cursor:pointer}
.btn:active{opacity:.8}
.pushnote{color:var(--muted);font-size:12px;text-align:center;margin:6px 0 10px}
.pushrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);margin:2px 0 8px}
.pushon{font-size:14px;font-weight:700}
.btn-off{flex:0 0 auto;width:auto;margin:0;padding:8px 14px;font-size:13px;font-weight:600;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--muted);font-family:inherit;cursor:pointer}
.btn-off:active{opacity:.8}
.foot{color:#5f5f5f;font-size:10.5px;text-align:center;margin-top:30px;font-family:'Univers Condensed','Univers',monospace;letter-spacing:.06em;text-transform:uppercase}
</style></head><body>
<div id="app"><div class="wrap"><p class="muted">Loading…</p></div></div>
<script>
(function(){
  var token=location.pathname.split('/').filter(Boolean).pop();
  var app=document.getElementById('app');
  var feed=null;
  function money(c){var v=(c||0)/100;var neg=v<0;var n=Math.abs(v).toLocaleString('en-US',{maximumFractionDigits:0});return (neg?'−':'+')+'$'+n;}
  function fmtH(h){return (Math.round((h||0)*10)/10)+'h';}
  function esc(s){var d=document.createElement('div');d.textContent=(s==null?'':String(s));return d.innerHTML;}
  function urlB64(s){var pad='='.repeat((4-s.length%4)%4);var b=(s+pad).replace(/-/g,'+').replace(/_/g,'/');var raw=atob(b);var a=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i);return a;}
  function render(){
    var evs=(feed&&feed.events)||[];
    var cum=(feed&&feed.cumulativeCents)||0;
    var name=(feed&&feed.name)||'Your action';
    var stakes=(feed&&feed.stakes)||'';
    var openingCents=(feed&&feed.openingCents)||0;
    var grossCents=(feed&&feed.grossCents)||0;
    var rows=evs.map(function(e){
      var cls=e.shareCents>=0?'pos':'neg';
      return '<div class="row"><div><div class="row-label">'+esc(e.game)+'</div>'
        +'<div class="row-meta">'+esc(e.venue)+' · '+fmtH(e.hours)+' · '+esc(e.date)+' · gross '+money(e.sessionResultCents)+' · your '+esc(e.pct)+'%</div></div>'
        +'<div class="row-result '+cls+'">'+money(e.shareCents)+'</div></div>';
    }).join('');
    var openingRow=openingCents?('<div class="row"><div><div class="row-label">Opening balance</div>'
      +'<div class="row-meta">carried in</div></div>'
      +'<div class="row-result '+(openingCents>=0?'pos':'neg')+'">'+money(openingCents)+'</div></div>'):'';
    var sessionsInner=(rows+openingRow)||'<div class="muted" style="font-size:13px">No sessions yet — they\\'ll show up here as Ethan logs them.</div>';
    app.innerHTML='<div class="wrap">'
      +'<h1 class="title">'+esc(name)+'</h1>'
      +'<div class="sub">your action with Ethan</div>'
      +(stakes?'<div class="stakes">Staked: '+esc(stakes)+'</div>':'')
      +'<div class="card"><div class="card-label">Net · your share</div>'
        +'<div class="big '+(cum>=0?'pos':'neg')+'">'+money(cum)+'</div>'
        +'<div class="small">running position — what settles up with Ethan</div>'
        +(grossCents?'<div class="small">Gross across your games: <span class="'+(grossCents>=0?'pos':'neg')+'">'+money(grossCents)+'</span></div>':'')
        +'</div>'
      +'<div id="pushbox"></div>'
      +'<div class="card"><div class="card-label">Sessions</div>'
        +sessionsInner
        +'</div>'
      +'<div class="foot">Private link · only you can see this</div></div>';
    renderPush();
  }
  function renderPush(){
    var box=document.getElementById('pushbox'); if(!box)return;
    if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){box.innerHTML='';return;}
    if(Notification.permission==='denied'){box.innerHTML='<div class="pushnote">Notifications are blocked in your browser settings.</div>';return;}
    box.innerHTML='<div class="pushnote">…</div>';
    navigator.serviceWorker.getRegistration('/b/').then(function(reg){
      return reg?reg.pushManager.getSubscription():null;
    }).then(function(sub){
      if(sub){
        box.innerHTML='<div class="pushrow"><span class="pushon">🔔 Notifications on</span><button class="btn-off" id="pushoff">Turn off</button></div>';
        document.getElementById('pushoff').onclick=disablePush;
      }else{
        box.innerHTML='<button class="btn" id="enable">🔔 Notify me after each session</button>';
        document.getElementById('enable').onclick=enablePush;
      }
    }).catch(function(){
      box.innerHTML='<button class="btn" id="enable">🔔 Notify me after each session</button>';
      var e=document.getElementById('enable'); if(e)e.onclick=enablePush;
    });
  }
  function enablePush(){
    var b=document.getElementById('enable'); if(b){b.textContent='Enabling…';b.disabled=true;}
    navigator.serviceWorker.register('/b/sw.js',{scope:'/b/'}).then(function(reg){
      return Notification.requestPermission().then(function(p){
        if(p!=='granted')throw new Error('permission denied');
        return fetch('/api/backer/vapid').then(function(r){return r.json();}).then(function(v){
          if(!v.key)throw new Error('unavailable');
          return reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64(v.key)});
        });
      });
    }).then(function(sub){
      return fetch('/api/backer/'+token+'/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub})});
    }).then(function(){renderPush();}).catch(function(err){
      var box=document.getElementById('pushbox'); if(box)box.innerHTML='<div class="pushnote">Notifications unavailable here ('+esc(err&&err.message||'error')+'). You can still open this link anytime.</div>';
    });
  }
  function disablePush(){
    var b=document.getElementById('pushoff'); if(b){b.textContent='…';b.disabled=true;}
    navigator.serviceWorker.getRegistration('/b/').then(function(reg){
      return reg?reg.pushManager.getSubscription():null;
    }).then(function(sub){
      if(!sub)return null;
      var endpoint=sub.endpoint;
      return sub.unsubscribe().then(function(){
        return fetch('/api/backer/'+token+'/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:endpoint})});
      });
    }).then(function(){renderPush();}).catch(function(){renderPush();});
  }
  fetch('/api/backer/'+token+'/feed').then(function(r){return r.json();}).then(function(d){feed=d;render();}).catch(function(){render();});
})();
</script></body></html>`;

// ── Schedule Parser: extract tournament data from PDF/image via Claude Vision ──
const scheduleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Shared schedule parsing helpers ──
function getSchedulePrompts() {
  // Pass 1: verbatim transcription
  const TRANSCRIBE_PROMPT = `Transcribe every tournament event row from this poker schedule into a plain text table. Read EXACTLY what is printed — do not interpret, rephrase, or add anything.

For each event row, output one line in this pipe-delimited format:
DATE | TIME | EVENT# | EVENT NAME (exactly as printed) | BUY-IN | STARTING CHIPS | LEVELS | GUARANTEE | RE-ENTRY | LATE REG | TABLE SIZE

Rules:
- Copy text EXACTLY as it appears. If it says "HOSE", write "HOSE" — not "HORSE". Count letters carefully.
- If a field is not shown, write "—" (em dash)
- Include EVERY event row — do not skip any, including satellites, Day 2s, and finals
- Preserve the exact event name as printed on the schedule
- For dates, use the format shown on the schedule
- For buy-ins, include the dollar amount as shown
- Also output the venue/series name from the document header on the FIRST line, prefixed with "VENUE:"
- IMPORTANT: The WSOP has many different venues. "WSOP" alone is NOT a venue name.
  Look for the specific location: e.g. "WSOP Circuit Harrah's Cherokee", "WSOP Circuit Choctaw",
  "WSOP Circuit Thunder Valley", "Horseshoe/Paris Las Vegas", "WSOP Europe", etc.
  Always include the specific casino/location name, not just "WSOP".

Example:
VENUE: Borgata Summer Poker Open
Jun 3 | 11:00 AM | 1 | No-Limit Hold'em Deepstack | $600 | 30,000 | 30 min | $200,000 GTD | Unlimited | Level 10 | —
Jun 3 | 7:00 PM | 2 | Pot-Limit Omaha | $1,100 | 50,000 | 40 min | — | Freezeout | — | 8-Max`;

  // Pass 2: structure into JSON
  const STRUCTURE_PROMPT = `Convert this raw transcription of a poker tournament schedule into a JSON array. The transcription was copied verbatim from a schedule document.

For each event line, output a JSON object with these fields:
- "date": normalize to "Month DD, YYYY" (assume 2026 if no year). e.g. "June 15, 2026"
- "time": normalize to "H:MM AM/PM". e.g. "11:00 AM"
- "buyin": integer dollars (just the number, no $). e.g. 600
- "venue": from the VENUE: line. Must be specific — include the casino/location name.
    WSOP Circuit stops should be the casino name (e.g. "Harrah's Cherokee", "Choctaw Casino", "Thunder Valley", "Horseshoe Tunica").
    The main WSOP summer series is at "Horseshoe / Paris Las Vegas".
- "game_variant": Map the event name to ONE of these codes:
    NLH, PLO, PLO8, O8, "Limit Hold'em", "Big O", "7-Card Stud", "Stud 8", Razz,
    HORSE, HOSE, TORSE, "2-7 Triple Draw", "NL 2-7 Single Draw", Badugi,
    "Dealer's Choice", Mixed, "9-Game Mix", "8-Game Mix", "Mixed Triple Draw",
    OE, TOE, "5-Card PLO", "Big Bet Dealer's Choice", "PLO/NLH Mix", "Mixed PLO", "10-Game Mix"
  RULES:
    • Default to NLH unless the name EXPLICITLY says otherwise
    • "No-Limit Hold'em" / "NLHE" / "Hold'em" → NLH
    • "Pot-Limit Omaha" → PLO
    • "Omaha Hi-Lo" / "Omaha H/L" / "Omaha 8" / "O/8" → PLO8 (this is NOT "O8" — O8 is limit)
    • "HOSE" → "HOSE" (4 games — NOT HORSE)
    • "HORSE" → "HORSE" (5 games)
    • Words like Championship, Classic, Open, Hybrid, Kickoff, Closer, Frenzy, Monster Stack, Survivor, Bounty, C-Note, Mystery describe FORMAT — they do NOT indicate a variant. Default to NLH.
    • "Hybrid" means online-to-live format — it is NLH, NOT Mixed
- "event_name": Build from ONLY what is printed on the schedule — NEVER invent words:
    • Prepend variant abbreviation (NLH, PLO, etc.) to ALL events including demographic events (Seniors, Ladies, Kings & Queens). ONLY exception: pure Satellites keep their original naming without variant prefix.
    • Strip: buy-in amounts, GTD amounts, re-entry policy, variant text (since it's in the prefix)
    • After stripping, use ONLY the remaining descriptive words from the original text
    • If no descriptive words remain after stripping, the name is JUST the variant prefix (e.g. "NLH")
    • NEVER add words like "Championship", "Classic", "Open", "Tournament" unless they appear in the original text
    • Multi-flight → append "Flight A", "Flight B" (parse "1A" as Flight A, "1B" as Flight B, etc.)
    • Continuation days → append "Day 2", "Day 3"
    • Final tables → append "Final"
    Examples:
      "$600 No Limit Hold'em 1A $150K GTD (2Day)" → "NLH Flight A" (event_number: "1")
      "$400 PLO 8-Max" → "PLO 8-Max"
      "$1,100 NLH Monster Stack" → "NLH Monster Stack"
      "$300 Seniors No Limit Hold'em" → "NLH Seniors"
      "$500 Ladies PLO" → "PLO Ladies"
      "$2,200 NLH Championship" → "NLH Championship" (Championship IS in the original text)
- "event_number": as shown, or null
- "starting_chips": integer, or null
- "level_duration": minutes as string (e.g. "30", "40", "20,30"), or null
- "guarantee": integer dollars, or null
- "reentry": policy text (e.g. "Unlimited", "1", "Freezeout"), or null
- "late_reg": as shown, or null
- "is_satellite": true if the event is a satellite/qualifier. Detection clues:
    • Name contains: Satellite, Qualifier, Mega, Super Satellite, Win Your Way, Big 4, Big 5, "Seat"
    • Very low buy-in relative to the series (e.g. $65-$200 when most events are $300+)
    • Guarantees a "seat" or "entry" to another event rather than a cash prize
    • Even if not explicitly labeled, a $65 "Win Your Way" or $100 event in a $400+ series is almost certainly a satellite
- "target_event": what the satellite feeds into (e.g. "Main Event", "Event 15"), or null
- "is_multi_flight": true if multi-flight (Day 1A, 1B, etc.)
- "flight_letter": "A", "B", "C", or null
- "is_restart": true if this is a continuation day (Day 2, Day 3, Final Table, Final Day). Detection clues:
    • Name contains: Day 2, Day 3, Final, Final Table, Final Day
    • No buy-in listed (or $0) — players already paid on Day 1
    • Set buyin to 0 for all restarts
- "parent_event": for restarts, the parent event number or name, or null
- "category": ALWAYS set to "side". The server determines this automatically.
- "table_size": "9-max", "8-max", "6-max", "heads-up", or null
- "bounty_amount": integer bounty if knockout/bounty event, or null

Return ONLY a JSON array. No markdown, no code fences, no explanation.`;

  return { TRANSCRIBE_PROMPT, STRUCTURE_PROMPT };
}

function repairTruncatedJsonArray(str) {
  try { return JSON.parse(str); } catch (_) {}
  let s = str.trim();
  if (!s.startsWith('[')) return null;
  const quickRepairs = [s + ']', s + '}]', s + '"}]', s + 'null}]', s + '"null"}]'];
  for (const attempt of quickRepairs) { try { return JSON.parse(attempt); } catch (_) {} }
  let lastSafeEnd = -1, depth = 0, inString = false, escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 1 && ch === '}') {
        let j = i + 1;
        while (j < s.length && ' \n\r\t'.includes(s[j])) j++;
        if (j >= s.length || s[j] === ',' || s[j] === ']') lastSafeEnd = (s[j] === ',') ? j : i;
      }
    }
  }
  if (lastSafeEnd > 0) {
    const trimmed = s.slice(0, lastSafeEnd + 1).replace(/,\s*$/, '') + ']';
    try { const p = JSON.parse(trimmed); console.log(`[ParseSchedule] Repair: recovered ${p.length} events`); return p; } catch (_) {}
  }
  const lco = s.lastIndexOf('},');
  if (lco > 0) { try { return JSON.parse(s.slice(0, lco + 1) + ']'); } catch (_) {} }
  const lo = s.lastIndexOf('}');
  if (lo > 0) { try { return JSON.parse(s.slice(0, lo + 1) + ']'); } catch (_) {} }
  return null;
}

function extractJsonArray(text) {
  let json = text;
  if (json.includes('```')) json = json.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  if (!json.startsWith('[')) { const idx = json.indexOf('['); if (idx >= 0) json = json.slice(idx); }
  try { return JSON.parse(json); } catch (e) {
    console.warn(`[ParseSchedule] Direct parse failed (${e.message}), repairing...`);
    const repaired = repairTruncatedJsonArray(json);
    if (repaired) return repaired;
    console.error(`[ParseSchedule] Unrepairable JSON, first 300: ${json.slice(0, 300).replace(/\n/g, '\\n')}`);
    return null;
  }
}

async function runTwoPassExtraction(client, visionContent, pageErrors) {
  const { TRANSCRIBE_PROMPT, STRUCTURE_PROMPT } = getSchedulePrompts();
  const allEvents = [];

  // Pass 1: Verbatim transcription (Sonnet for accuracy)
  // Use continuation loop to handle long schedules that exceed token limits
  console.log(`[ParseSchedule] Pass 1: Transcribing with Sonnet...`);
  visionContent.push({ type: 'text', text: TRANSCRIBE_PROMPT });

  let transcription = '';
  let pass1Messages = [{ role: 'user', content: visionContent }];
  let pass1Attempts = 0;
  const MAX_CONTINUATIONS = 3;

  while (pass1Attempts < MAX_CONTINUATIONS) {
    pass1Attempts++;
    const pass1 = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 32768,
      messages: pass1Messages,
    });

    const chunk = pass1.content[0]?.text?.trim() || '';
    transcription += (transcription ? '\n' : '') + chunk;
    console.log(`[ParseSchedule] Pass 1 chunk ${pass1Attempts}: ${chunk.length} chars, stop: ${pass1.stop_reason}`);

    if (pass1.stop_reason !== 'max_tokens') break;

    // Continue from where it left off
    console.log(`[ParseSchedule] Pass 1 truncated, requesting continuation...`);
    pass1Messages = [
      ...pass1Messages,
      { role: 'assistant', content: chunk },
      { role: 'user', content: 'Continue transcribing from where you left off. Do not repeat any events already listed above.' },
    ];
  }

  console.log(`[ParseSchedule] Pass 1 done: ${transcription.length} chars, ${transcription.split('\n').length} lines (${pass1Attempts} chunk${pass1Attempts > 1 ? 's' : ''})`);
  console.log(`[ParseSchedule] Transcription preview: ${transcription.slice(0, 300).replace(/\n/g, '\\n')}`);
  console.log(`[ParseSchedule] Transcription tail: ${transcription.slice(-200).replace(/\n/g, '\\n')}`);

  if (!transcription || transcription.length < 20) {
    pageErrors.push({ page: 1, error: 'Could not read any text from the document' });
    return allEvents;
  }

  // Pass 2: Structure into JSON (Haiku for speed)
  // Also uses continuation loop for large event lists
  console.log(`[ParseSchedule] Pass 2: Structuring into JSON...`);
  let fullJsonText = '[';
  let pass2Messages = [
    { role: 'user', content: `Here is the raw transcription of a poker tournament schedule:\n\n${transcription}\n\n${STRUCTURE_PROMPT}` },
    { role: 'assistant', content: '[' },
  ];
  let pass2Attempts = 0;

  while (pass2Attempts < MAX_CONTINUATIONS) {
    pass2Attempts++;
    const pass2 = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 32768,
      messages: pass2Messages,
    });

    const chunk = pass2.content[0]?.text?.trim() || '';
    fullJsonText += chunk;
    console.log(`[ParseSchedule] Pass 2 chunk ${pass2Attempts}: ${chunk.length} chars, stop: ${pass2.stop_reason}`);

    if (pass2.stop_reason !== 'max_tokens') break;

    // Continue — feed back the accumulated JSON and ask for more
    console.log(`[ParseSchedule] Pass 2 truncated, requesting continuation...`);
    pass2Messages = [
      { role: 'user', content: `Here is the raw transcription of a poker tournament schedule:\n\n${transcription}\n\n${STRUCTURE_PROMPT}` },
      { role: 'assistant', content: fullJsonText },
      { role: 'user', content: 'The JSON array was cut off. Continue the JSON array from EXACTLY where it stopped. Do not repeat any events. Start your response with the next comma or closing bracket.' },
      { role: 'assistant', content: ',' },
    ];
    fullJsonText += ',';
  }

  console.log(`[ParseSchedule] Pass 2 done: ${fullJsonText.length} chars (${pass2Attempts} chunk${pass2Attempts > 1 ? 's' : ''})`);

  const events = extractJsonArray(fullJsonText);
  if (events && Array.isArray(events)) {
    for (const ev of events) allEvents.push(ev);
    console.log(`[ParseSchedule] Extracted ${events.length} events`);
    if (pass2Attempts >= MAX_CONTINUATIONS) pageErrors.push({ page: 1, error: 'Schedule was very long — some events at the end may be missing' });
  } else {
    pageErrors.push({ page: 1, error: 'Failed to parse structured response — try again' });
  }

  return allEvents;
}

function postProcessEvents(allEvents, userVenue) {
  const processed = [];
  const warnings = [];

  const KNOWN_VENUES_MAP = {
    'WYNN': 'Wynn Las Vegas', 'ENCORE': 'Wynn Las Vegas',
    'VENETIAN': 'Venetian', 'PALAZZO': 'Venetian',
    'ARIA': 'Aria', 'BELLAGIO': 'Bellagio',
    'RESORTS WORLD': 'Resorts World',
    'GOLDEN NUGGET': 'Golden Nugget',
    'SOUTH POINT': 'South Point',
    'ORLEANS': 'Orleans',
    'HORSESHOE': 'Horseshoe / Paris Las Vegas',
    'PARIS': 'Horseshoe / Paris Las Vegas',
    'MGM NATIONAL HARBOR': 'MGM National Harbor',
    'MGM GRAND': 'MGM Grand',
    'SEMINOLE': 'Seminole Hard Rock',
    'HARD ROCK': 'Seminole Hard Rock',
    'BORGATA': 'Borgata',
    'FOXWOODS': 'Foxwoods',
    'THUNDER VALLEY': 'Thunder Valley',
    'CAESARS': 'Caesars Palace',
    'TURNING STONE': 'Turning Stone Casino',
    'TEXAS CARD HOUSE': 'Texas Card House',
    'LODGE': 'Lodge Poker Club',
    'BESTBET': 'bestbet Jacksonville', "BALLY'S": "Bally's Lake Tahoe",
    'CHEROKEE': 'WSOPC Cherokee', "HARRAH'S CHEROKEE": 'WSOPC Cherokee',
    'WSOPC CHEROKEE': 'WSOPC Cherokee',
    'CHOCTAW': 'Choctaw Casino', 'WSOPC CHOCTAW': 'Choctaw Casino',
    'TUNICA': 'Horseshoe Tunica',
  };

  for (const ev of allEvents) {
    const w = [];
    if (!ev.date) w.push('Missing date');
    if (!ev.time) w.push('Missing time');
    if (ev.buyin == null && !ev.is_restart) w.push('Missing buyin');
    if (!ev.game_variant) { ev.game_variant = 'NLH'; w.push('Defaulted game variant to NLH'); }
    if (!ev.event_name) w.push('Missing event name');
    if (!ev.date && !ev.time && ev.buyin == null) continue;

    if (userVenue) {
      ev.venue = userVenue;
    } else if (ev.venue) {
      const upper = ev.venue.toUpperCase();
      let matched = false;
      for (const [key, val] of Object.entries(KNOWN_VENUES_MAP)) {
        if (upper.includes(key)) { ev.venue = val; matched = true; break; }
      }
      if (!matched) w.push(`Unknown venue: ${ev.venue}`);
    } else {
      w.push('No venue detected');
    }

    if (ev.game_variant === 'Mixed' && ev.event_name && /\bhybrid\b/i.test(ev.event_name)) {
      ev.game_variant = 'NLH';
    }

    if (ev.event_name) {
      ev.event_name = ev.event_name
        .replace(/\b(Omaha\s*(?:Hi[\s/-]*Lo|H[\s/-]*L|8(?:-or-better)?|High[\s/-]*Low))\b/gi, '')
        .replace(/\bPot[\s-]*Limit\s+Omaha\b/gi, '')
        .replace(/\bNo[\s-]*Limit\s+Hold'?e?m\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    if (ev.event_name) {
      const isSatellite = ev.is_satellite ||
        /\b(Satellite)\b/i.test(ev.event_name);
      ev.event_name = normalizeEventName(ev.event_name, isSatellite ? null : ev.game_variant);
    }

    if (ev.buyin != null) ev.buyin = parseInt(String(ev.buyin).replace(/[$,]/g, '')) || 0;
    if (ev.is_restart) ev.buyin = 0;
    if (ev.guarantee != null) ev.guarantee = parseInt(String(ev.guarantee).replace(/[$,]/g, '')) || null;
    if (ev.starting_chips != null) ev.starting_chips = parseInt(String(ev.starting_chips).replace(/[,]/g, '')) || null;
    if (ev.bounty_amount != null) ev.bounty_amount = parseInt(String(ev.bounty_amount).replace(/[$,]/g, '')) || null;
    if (ev.reentry) ev.reentry = normalizeReentry(ev.reentry);

    // Generate stable_id so it persists across re-imports
    if (!ev.stable_id && ev.venue && ev.date) {
      ev.stable_id = generateStableId(ev.venue, ev.event_number || '', ev.event_name || '', ev.date, ev.time, ev.buyin);
    }

    ev._warnings = w;
    if (w.length > 0) warnings.push({ event: ev.event_name || '(unnamed)', warnings: w });
    processed.push(ev);
  }

  // Deduplicate
  const seen = new Set();
  const deduplicated = [];
  for (const ev of processed) {
    const key = `${ev.date}|${ev.time}|${ev.buyin}|${ev.venue}|${(ev.event_name || '').slice(0, 30)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push(ev);
  }

  // ── Category detection: "primary" vs "side" ──
  // primary = numbered events in the series schedule (the events you plan your trip around)
  // side = unnumbered dailies, turbos, extras
  // Satellites are already flagged with is_satellite — they get "side"
  for (const ev of deduplicated) {
    if (ev.is_satellite) {
      ev.category = 'side';
    } else if (ev.is_restart) {
      // Restarts inherit their parent's category — default to primary since
      // Day 2/3/Final are continuations of numbered events
      ev.category = 'primary';
    } else if (ev.event_number && ev.event_number.trim()) {
      // Has an event number → part of the primary series schedule
      ev.category = 'primary';
    } else {
      // No event number → side event (daily, turbo, etc.)
      ev.category = 'side';
    }
  }

  return { deduplicated, warnings };
}

// ── Parse schedule from file upload ──
app.post('/api/parse-schedule', authenticateToken, requireRegistered, scheduleUpload.array('file', 20), async (req, res) => {
  const files = req.files || (req.file ? [req.file] : []);
  if (files.length === 0) return res.status(400).json({ error: 'No files provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  const userVenue = req.body?.venue || '';

  try {
    const client = new Anthropic({ apiKey, timeout: 180000 });

    const visionContent = [];
    const sourceNames = [];
    for (const file of files) {
      const mime = file.mimetype || '';
      const isImage = mime.startsWith('image/');
      const isPdf = mime === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');

      if (!isImage && !isPdf) {
        console.log(`[ParseSchedule] Skipping unsupported file: ${file.originalname} (${mime})`);
        continue;
      }

      console.log(`[ParseSchedule] Processing ${(file.size / 1024).toFixed(0)}KB ${isPdf ? 'PDF' : 'image'} (${mime}): ${file.originalname}`);
      sourceNames.push(file.originalname);

      const base64 = file.buffer.toString('base64');
      if (isPdf) {
        visionContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
      } else {
        visionContent.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } });
      }
    }

    if (visionContent.length === 0) {
      return res.status(400).json({ error: 'No valid PDF or image files found' });
    }

    const pageErrors = [];
    const allEvents = await runTwoPassExtraction(client, visionContent, pageErrors);
    const { deduplicated, warnings } = postProcessEvents(allEvents, userVenue);

    console.log(`[ParseSchedule] Total: ${allEvents.length} raw -> ${deduplicated.length} deduplicated events from ${visionContent.length} file(s)`);

    // Archive uploaded files
    const detectedVenue = deduplicated.length > 0 ? deduplicated[0].venue : (userVenue || 'unknown');
    for (const file of files) {
      archiveScheduleDoc(detectedVenue, file.originalname, file.buffer);
    }

    res.json({
      events: deduplicated,
      pageCount: visionContent.length,
      rawCount: allEvents.length,
      eventCount: deduplicated.length,
      warnings,
      pageErrors,
      sourceFile: sourceNames.join(', '),
      detectedVenue: deduplicated.length > 0 ? deduplicated[0].venue : null,
    });
  } catch (err) {
    console.error('[ParseSchedule] Error:', err.message);
    res.status(err.status || 500).json({ error: `Schedule parsing failed: ${err.message}` });
  }
});

// ── Parse schedule from URL ──
app.post('/api/parse-schedule-url', authenticateToken, requireRegistered, express.json(), async (req, res) => {
  const { url, venue } = req.body || {};
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  // Try to detect venue from URL if user didn't specify one
  let userVenue = venue || '';
  if (!userVenue) {
    const urlLower = url.toLowerCase();

    // WSOP Circuit stops — check these BEFORE the generic 'wsop' match
    // wsop.com hosts schedules for many venues across the circuit
    const WSOPC_URL_STOPS = {
      'cherokee': 'WSOPC Cherokee',
      'harrahs-cherokee': 'WSOPC Cherokee',
      'choctaw': 'Choctaw Casino',
      'thunder-valley': 'Thunder Valley',
      'thundervalley': 'Thunder Valley',
      'turning-stone': 'Turning Stone Casino',
      'turningstone': 'Turning Stone Casino',
      'horseshoe-tunica': 'Horseshoe Tunica',
      'tunica': 'Horseshoe Tunica',
      'lake-tahoe': "Bally's Lake Tahoe",
      'ballys': "Bally's Lake Tahoe",
      'bestbet': 'bestbet Jacksonville',
      'lodge': 'Lodge Poker Club',
      'seminole': 'Seminole Hard Rock',
      'hard-rock': 'Seminole Hard Rock',
      'hardrock': 'Seminole Hard Rock',
      'foxwoods': 'Foxwoods',
      'borgata': 'Borgata',
      'mgm-national-harbor': 'MGM National Harbor',
      'mgmnationalharbor': 'MGM National Harbor',
      'horseshoe-las-vegas': 'Horseshoe / Paris Las Vegas',
      'paris-las-vegas': 'Horseshoe / Paris Las Vegas',
    };

    const URL_VENUE_MAP = {
      'venetian': 'Venetian', 'palazzo': 'Venetian',
      'borgata': 'Borgata',
      'wynn': 'Wynn Las Vegas', 'encore': 'Wynn Las Vegas',
      'aria': 'Aria', 'bellagio': 'Bellagio',
      'resortsworld': 'Resorts World', 'resorts-world': 'Resorts World', 'rwlasvegas': 'Resorts World',
      'goldennugget': 'Golden Nugget', 'golden-nugget': 'Golden Nugget',
      'southpoint': 'South Point', 'south-point': 'South Point',
      'orleans': 'Orleans',
      'horseshoe': 'Horseshoe / Paris Las Vegas',
      'mgmnationalharbor': 'MGM National Harbor', 'mgm-national-harbor': 'MGM National Harbor',
      'mgmgrand': 'MGM Grand',
      'seminole': 'Seminole Hard Rock', 'hardrock': 'Seminole Hard Rock',
      'foxwoods': 'Foxwoods',
      'thundervalley': 'Thunder Valley', 'thunder-valley': 'Thunder Valley',
      'caesars': 'Caesars Palace',
      'turningstone': 'Turning Stone Casino', 'turning-stone': 'Turning Stone Casino',
      'texascardhouse': 'Texas Card House',
      'lodgepoker': 'Lodge Poker Club', 'thelodge': 'Lodge Poker Club',
      'bestbet': 'bestbet Jacksonville', 'ballys': "Bally's Lake Tahoe",
      'harrahs': 'WSOPC Cherokee', 'cherokee': 'WSOPC Cherokee',
      'choctaw': 'Choctaw Casino', 'tunica': 'Horseshoe Tunica',
    };

    // For wsop.com URLs, check circuit stop names in the path first
    if (urlLower.includes('wsop.com') || urlLower.includes('wsop.')) {
      for (const [key, val] of Object.entries(WSOPC_URL_STOPS)) {
        if (urlLower.includes(key)) { userVenue = val; break; }
      }
      // If no specific circuit stop found, DON'T default to Horseshoe/Paris —
      // let the AI detect the venue from the document content instead.
      // Only default to Horseshoe/Paris if the URL explicitly says so.
      if (!userVenue && (urlLower.includes('horseshoe') || urlLower.includes('paris-las-vegas'))) {
        userVenue = 'Horseshoe / Paris Las Vegas';
      }
      if (userVenue) console.log(`[ParseURL] Detected WSOP Circuit venue from URL: ${userVenue}`);
      else console.log(`[ParseURL] wsop.com URL but no specific venue detected — will use AI detection from content`);
    } else {
      for (const [key, val] of Object.entries(URL_VENUE_MAP)) {
        if (urlLower.includes(key)) { userVenue = val; break; }
      }
      if (userVenue) console.log(`[ParseURL] Detected venue from URL: ${userVenue}`);
    }
  }

  try {
    const client = new Anthropic({ apiKey, timeout: 180000 });
    console.log(`[ParseURL] Fetching ${url}`);

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FutureGame/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`Failed to fetch URL: HTTP ${resp.status}`);

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    const pageErrors = [];
    let allEvents = [];

    // Track fetched content for archiving
    const _urlArchiveBuffers = [];

    if (contentType.includes('application/pdf') || url.toLowerCase().endsWith('.pdf')) {
      // PDF — download and run through vision pipeline
      console.log(`[ParseURL] Detected PDF`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      console.log(`[ParseURL] Downloaded ${(buffer.length / 1024).toFixed(0)}KB PDF`);
      _urlArchiveBuffers.push({ name: url.split('/').pop() || 'schedule.pdf', buffer });
      const visionContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
      ];
      allEvents = await runTwoPassExtraction(client, visionContent, pageErrors);

    } else if (contentType.includes('image/')) {
      // Image — download and run through vision pipeline
      const imgType = contentType.includes('png') ? 'image/png' : contentType.includes('webp') ? 'image/webp' : 'image/jpeg';
      console.log(`[ParseURL] Detected image (${imgType})`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      console.log(`[ParseURL] Downloaded ${(buffer.length / 1024).toFixed(0)}KB image`);
      const ext = imgType.includes('png') ? '.png' : imgType.includes('webp') ? '.webp' : '.jpg';
      _urlArchiveBuffers.push({ name: (url.split('/').pop() || 'schedule') + ext, buffer });
      const visionContent = [
        { type: 'image', source: { type: 'base64', media_type: imgType, data: buffer.toString('base64') } },
      ];
      allEvents = await runTwoPassExtraction(client, visionContent, pageErrors);

    } else {
      // HTML web page — extract images and/or text
      console.log(`[ParseURL] Detected HTML page`);
      const html = await resp.text();
      // Archive the HTML snapshot
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      _urlArchiveBuffers.push({ name: `${hostname}.html`, buffer: Buffer.from(html) });

      // ── Extract embedded images (tweets, social media posts, etc.) ──
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      const twitterImageMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
      const candidateUrls = new Set();

      // Add og:image and twitter:image (high priority for tweets)
      if (ogImageMatch) candidateUrls.add(ogImageMatch[1]);
      if (twitterImageMatch) candidateUrls.add(twitterImageMatch[1]);

      // Add img src URLs that look like schedule images (large images, not icons/avatars)
      let imgMatch;
      while ((imgMatch = imgRegex.exec(html)) !== null) {
        const src = imgMatch[1];
        // Skip tiny icons, avatars, tracking pixels, emojis
        if (/avatar|icon|emoji|pixel|logo|badge|button|\.svg/i.test(src)) continue;
        if (/width=["']?\d{1,2}['"px]/i.test(imgMatch[0])) continue; // tiny images
        candidateUrls.add(src);
      }

      // Resolve relative URLs
      const baseUrl = new URL(url);
      const resolvedUrls = [...candidateUrls].map(u => {
        try { return new URL(u, baseUrl).href; } catch { return null; }
      }).filter(Boolean);

      console.log(`[ParseURL] Found ${resolvedUrls.length} candidate image URLs`);

      // Download images and check if they're large enough to be schedule images
      const scheduleImages = [];
      for (const imgUrl of resolvedUrls.slice(0, 10)) { // cap at 10 to avoid abuse
        try {
          const imgResp = await fetch(imgUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FutureGame/1.0)' },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
          });
          if (!imgResp.ok) continue;
          const imgCt = (imgResp.headers.get('content-type') || '').toLowerCase();
          if (!imgCt.includes('image/')) continue;
          const imgBuf = Buffer.from(await imgResp.arrayBuffer());
          // Skip small images (< 20KB — probably not a schedule)
          if (imgBuf.length < 20000) {
            console.log(`[ParseURL] Skipping small image (${(imgBuf.length / 1024).toFixed(0)}KB): ${imgUrl.slice(0, 80)}`);
            continue;
          }
          const imgType = imgCt.includes('png') ? 'image/png' : imgCt.includes('webp') ? 'image/webp' : 'image/jpeg';
          console.log(`[ParseURL] Downloaded schedule image (${(imgBuf.length / 1024).toFixed(0)}KB): ${imgUrl.slice(0, 80)}`);
          scheduleImages.push({ type: 'image', source: { type: 'base64', media_type: imgType, data: imgBuf.toString('base64') } });
        } catch (e) {
          console.log(`[ParseURL] Failed to download image: ${imgUrl.slice(0, 80)} — ${e.message}`);
        }
      }

      // If we found schedule images, run them through vision pipeline
      if (scheduleImages.length > 0) {
        console.log(`[ParseURL] Running ${scheduleImages.length} image(s) through vision pipeline`);
        allEvents = await runTwoPassExtraction(client, scheduleImages, pageErrors);
        if (allEvents.length > 0) {
          console.log(`[ParseURL] Vision extracted ${allEvents.length} events from images`);
        }
      }

      // If vision didn't find events (or no images), fall back to text extraction
      if (allEvents.length === 0) {
      // Try to extract just the schedule table(s) first — much cleaner than full page text
      const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
      let relevantHtml = '';
      for (const table of tables) {
        const rows = (table.match(/<tr/gi) || []).length;
        // A schedule table typically has many rows with dollar amounts
        const hasDollarAmounts = (table.match(/\$\d/g) || []).length;
        if (rows > 10 && hasDollarAmounts > 5) {
          relevantHtml += table + '\n';
          console.log(`[ParseURL] Found schedule table: ${rows} rows, ${hasDollarAmounts} dollar amounts, ${table.length} chars`);
        }
      }

      // Fall back to full page text if no schedule tables found
      const sourceHtml = relevantHtml || html;
      const textContent = sourceHtml
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#?\w+;/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();

      if (relevantHtml) {
        console.log(`[ParseURL] Extracted ${textContent.length} chars from schedule table(s) (full page was ${html.length} chars)`);
      }

      console.log(`[ParseURL] Extracted ${textContent.length} chars of text from HTML (raw HTML was ${html.length} chars)`);

      if (textContent.length < 50) {
        pageErrors.push({ page: 1, error: 'Could not extract meaningful text from the web page' });
      } else {
        const { STRUCTURE_PROMPT } = getSchedulePrompts();
        const venueHint = userVenue ? `\nIMPORTANT: The venue for ALL events is "${userVenue}". Set venue to "${userVenue}" for every event.\n` : '';

        // Estimate expected event count from text
        const estimatedEvents = (textContent.match(/\$\d[\d,]*\s+(?:No Limit|Pot.Limit|Limit|NL|PL|Hold|Omaha|PLO|Stud|Mixed|HORSE|HOSE|Bounty|Satellite|Mystery|Monster|Mega|Big|Seniors|Ladies)/gi) || []).length;
        console.log(`[ParseURL] Estimated ~${estimatedEvents} events in text`);

        // Split text into chunks of ~100 events worth for parallel processing
        // Each chunk fits in a single Haiku call (no slow continuation needed)
        const MAX_EVENTS_PER_CHUNK = 100;
        const textLines = textContent.split('\n');
        const textChunks = [];

        if (estimatedEvents > MAX_EVENTS_PER_CHUNK) {
          // Find date-line boundaries to split at
          const dateLineIndices = [];
          for (let i = 0; i < textLines.length; i++) {
            if (/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/.test(textLines[i])) {
              dateLineIndices.push(i);
            }
          }
          // Split roughly in half by date lines
          const numChunks = Math.ceil(estimatedEvents / MAX_EVENTS_PER_CHUNK);
          const datesPerChunk = Math.ceil(dateLineIndices.length / numChunks);
          for (let c = 0; c < numChunks; c++) {
            const startDateIdx = c * datesPerChunk;
            const endDateIdx = Math.min((c + 1) * datesPerChunk, dateLineIndices.length);
            if (startDateIdx >= dateLineIndices.length) break;
            const startLine = dateLineIndices[startDateIdx];
            const endLine = endDateIdx < dateLineIndices.length ? dateLineIndices[endDateIdx] : textLines.length;
            textChunks.push(textLines.slice(startLine, endLine).join('\n'));
          }
          console.log(`[ParseURL] Split into ${textChunks.length} chunks: ${textChunks.map(c => c.length + ' chars').join(', ')}`);
        } else {
          textChunks.push(textContent);
        }

        // Process all chunks in parallel
        const chunkPromises = textChunks.map((chunkText, ci) => {
          const chunkLabel = textChunks.length > 1 ? ` (part ${ci + 1} of ${textChunks.length})` : '';
          const chunkEventEst = Math.round(estimatedEvents / textChunks.length);
          console.log(`[ParseURL] Starting chunk ${ci + 1}/${textChunks.length} (~${chunkEventEst} events)...`);

          return (async () => {
            const prompt = `Here is a section of a poker tournament schedule from a web page${chunkLabel} (${url}):\n${venueHint}\nThis section contains approximately ${chunkEventEst} events. Extract ALL of them.\n\n${chunkText}\n\n${STRUCTURE_PROMPT}`;
            const pass = await client.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 32768,
              messages: [
                { role: 'user', content: prompt },
                { role: 'assistant', content: '[' },
              ],
            });
            const raw = '[' + (pass.content[0]?.text?.trim() || '');
            console.log(`[ParseURL] Chunk ${ci + 1}: ${raw.length} chars, stop: ${pass.stop_reason}`);
            return { ci, raw, truncated: pass.stop_reason === 'max_tokens' };
          })();
        });

        const chunkResults = await Promise.all(chunkPromises);

        for (const { ci, raw, truncated } of chunkResults) {
          const events = extractJsonArray(raw);
          if (events && Array.isArray(events)) {
            for (const ev of events) allEvents.push(ev);
            console.log(`[ParseURL] Chunk ${ci + 1}: extracted ${events.length} events`);
            if (truncated) pageErrors.push({ page: ci + 1, error: `Chunk ${ci + 1} was truncated — some events may be missing` });
          } else {
            pageErrors.push({ page: ci + 1, error: `Failed to parse events from chunk ${ci + 1}` });
          }
        }

        console.log(`[ParseURL] Total extracted: ${allEvents.length} events (expected ~${estimatedEvents})`);
        if (allEvents.length < estimatedEvents * 0.8) {
          pageErrors.push({ page: 0, error: `Found ${allEvents.length} events but expected ~${estimatedEvents} — some may be missing` });
        }
      }
      } // end if (allEvents.length === 0) text fallback
    }

    const { deduplicated, warnings } = postProcessEvents(allEvents, userVenue);
    console.log(`[ParseURL] Total: ${allEvents.length} raw -> ${deduplicated.length} deduplicated events`);

    // Archive the fetched content + a URL reference
    const detectedVenue = deduplicated.length > 0 ? deduplicated[0].venue : (userVenue || 'unknown');
    for (const arch of _urlArchiveBuffers) {
      archiveScheduleDoc(detectedVenue, arch.name, arch.buffer);
    }
    // Also save a small reference file linking the URL to what was extracted
    try {
      const refName = url.replace(/[^a-zA-Z0-9._\-]/g, '_').slice(-80) + '.ref.txt';
      await archiveScheduleDoc(detectedVenue, refName, Buffer.from(
        `Source URL: ${url}\nFetched: ${new Date().toISOString()}\nContent-Type: ${contentType}\nEvents extracted: ${deduplicated.length}\nVenue: ${detectedVenue}\n`
      ));
    } catch (_) {}

    res.json({
      events: deduplicated,
      pageCount: 1,
      rawCount: allEvents.length,
      eventCount: deduplicated.length,
      warnings,
      pageErrors,
      sourceFile: url,
      detectedVenue: deduplicated.length > 0 ? deduplicated[0].venue : null,
    });
  } catch (err) {
    console.error('[ParseURL] Error:', err.message);
    res.status(err.status || 500).json({ error: `URL parsing failed: ${err.message}` });
  }
});

// ── Schedule documents listing ──
app.get('/api/schedule-docs', authenticateToken, async (req, res) => {
  try {
    const venues = [];
    try {
      const entries = await fs.readdir(SCHEDULE_DOCS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const venuePath = path.join(SCHEDULE_DOCS_DIR, entry.name);
        const schedules = [];
        const structures = [];
        for (const subDir of ['schedules', 'structures']) {
          const subPath = path.join(venuePath, subDir);
          try {
            const files = await fs.readdir(subPath);
            for (const f of files) {
              const stat = await fs.stat(path.join(subPath, f));
              const item = { name: f, size: stat.size, modified: stat.mtime };
              if (subDir === 'structures') structures.push(item);
              else schedules.push(item);
            }
          } catch (e) { if (e.code !== 'ENOENT') throw e; }
        }
        // Also list any files directly in the venue folder (legacy)
        try {
          const topFiles = await fs.readdir(venuePath, { withFileTypes: true });
          for (const f of topFiles) {
            if (f.isFile()) {
              const stat = await fs.stat(path.join(venuePath, f.name));
              schedules.push({ name: f.name, size: stat.size, modified: stat.mtime });
            }
          }
        } catch (_) {}
        if (schedules.length > 0 || structures.length > 0) {
          venues.push({ venue: entry.name, schedules, structures });
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    res.json({ docs: venues });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public — structure sheets and event-listing PDFs are non-sensitive
// reference docs that need to be reachable from a plain <a target="_blank">
// (no auth header), so we don't require a JWT here. Path traversal is still
// blocked by the regex + dot-dot strip below.
app.get('/api/schedule-docs/:venue/:type/:filename', async (req, res) => {
  const safeVenue = req.params.venue.replace(/[^a-zA-Z0-9 _\-]/g, '');
  const safeType = req.params.type === 'structures' ? 'structures' : 'schedules';
  const safeFile = req.params.filename.replace(/\.\./g, '');
  const filePath = path.join(SCHEDULE_DOCS_DIR, safeVenue, safeType, safeFile);
  try {
    await fs.access(filePath);
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// ── Parse structure sheet and update tournament records ──
app.post('/api/parse-structure', authenticateToken, requireRegistered, scheduleUpload.array('file', 20), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'No files provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  const userVenue = req.body?.venue || '';

  try {
    const client = new Anthropic({ apiKey, timeout: 180000 });

    const visionContent = [];
    const sourceNames = [];
    for (const file of files) {
      const mime = file.mimetype || '';
      const isImage = mime.startsWith('image/');
      const isPdf = mime === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
      if (!isImage && !isPdf) continue;
      sourceNames.push(file.originalname);
      const base64 = file.buffer.toString('base64');
      if (isPdf) {
        visionContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
      } else {
        visionContent.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } });
      }
    }

    if (visionContent.length === 0) return res.status(400).json({ error: 'No valid files' });

    const structurePrompt = `Extract tournament structure data from this structure sheet. Return a JSON array where each object represents one event/structure with these fields:
- event_name: string (event title as shown)
- event_number: string or null (e.g. "Event #5" → "5")
- buyin: number (total buy-in in dollars)
- starting_chips: number
- level_duration: string (e.g. "30", "40", "60" in minutes)
- levels: array of {level: number, small_blind: number, big_blind: number, ante: number} (as many as shown)
- reentry: string ("Unlimited", "1", "2", or null)
- late_reg: string (e.g. "end of level 12" or "4 hours")
- late_reg_end: string (specific time if shown, e.g. "Level 12")
- day_length: string (e.g. "10 levels", "end of level 15")
- game_variant: string (NLH, PLO, Mixed, etc.)
- venue: string (if identifiable from the document)
- notes: string (any additional info: add-ons, bounty amounts, flight info, etc.)

Return ONLY the JSON array, no markdown or explanation.`;

    const result = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [...visionContent, { type: 'text', text: structurePrompt }],
      }],
    });

    let text = result.content.map(c => c.type === 'text' ? c.text : '').join('');
    // Strip code fences if present
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let structures;
    try { structures = JSON.parse(text); } catch {
      // Try to repair
      const match = text.match(/\[[\s\S]*\]/);
      if (match) structures = JSON.parse(match[0]);
      else return res.status(422).json({ error: 'Could not parse structure data from AI response' });
    }
    if (!Array.isArray(structures)) structures = [structures];

    // Archive source files
    const detectedVenue = structures[0]?.venue || userVenue || 'unknown';
    for (const file of files) {
      archiveScheduleDoc(detectedVenue, file.originalname, file.buffer, 'structure');
    }

    // Match structures to existing tournament records and update
    let matched = 0;
    let unmatched = 0;
    const updates = [];

    for (const s of structures) {
      const venue = s.venue || userVenue;
      if (!venue) { unmatched++; continue; }

      // Try to match by event number + venue first, then by name + buyin
      let row = null;
      if (s.event_number) {
        row = db.prepare('SELECT id, event_name, stable_id FROM tournaments WHERE venue = ? AND event_number = ? LIMIT 1').get(venue, s.event_number);
      }
      if (!row && s.event_name && s.buyin) {
        row = db.prepare('SELECT id, event_name, stable_id FROM tournaments WHERE venue = ? AND event_name LIKE ? AND buyin = ? LIMIT 1').get(venue, `%${s.event_name.slice(0, 30)}%`, s.buyin);
      }

      if (row) {
        const setClauses = [];
        const params = [];
        if (s.starting_chips) { setClauses.push('starting_chips = ?'); params.push(s.starting_chips); }
        if (s.level_duration) { setClauses.push('level_duration = ?'); params.push(String(s.level_duration)); }
        if (s.reentry) { setClauses.push('reentry = ?'); params.push(s.reentry); }
        if (s.late_reg) { setClauses.push('late_reg = ?'); params.push(s.late_reg); }
        if (s.late_reg_end) { setClauses.push('late_reg_end = ?'); params.push(s.late_reg_end); }
        if (s.day_length) { setClauses.push('day_length = ?'); params.push(s.day_length); }
        if (sourceNames.length > 0) {
          setClauses.push('structure_sheet_path = ?');
          params.push(sourceNames.join(', '));
        }

        if (setClauses.length > 0) {
          params.push(row.id);
          db.run(`UPDATE tournaments SET ${setClauses.join(', ')} WHERE id = ?`, params);
          updates.push({ id: row.id, event: row.event_name, fields: setClauses.length });
          matched++;
        }
      } else {
        unmatched++;
      }
    }

    if (matched > 0) {
      await saveDatabase();
      broadcastToAll('schedule-refetch', { source: 'parse-structure', matched });
    }

    console.log(`[ParseStructure] Extracted ${structures.length} structures, matched ${matched}, unmatched ${unmatched}`);

    res.json({
      structures,
      matched,
      unmatched,
      updates,
      sourceFile: sourceNames.join(', '),
    });
  } catch (err) {
    console.error('[ParseStructure] Error:', err.message);
    res.status(err.status || 500).json({ error: `Structure parsing failed: ${err.message}` });
  }
});

// ── Batch import schedules from multiple URLs ──
app.post('/api/batch-import-urls', authenticateToken, requireRegistered, express.json(), async (req, res) => {
  const { urls } = req.body || {};
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'No URLs provided. Expected { urls: [{ url, venue }, ...] }' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  console.log(`[BatchImport] Starting batch import of ${urls.length} URLs`);
  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const { url, venue } = urls[i];
    if (!url) {
      results.push({ url: url || '(empty)', venue, success: false, error: 'No URL provided', eventCount: 0 });
      continue;
    }

    console.log(`[BatchImport] Processing ${i + 1}/${urls.length}: ${url} (venue: ${venue || 'auto-detect'})`);

    try {
      // Build an internal request to the parse-schedule-url handler
      const innerReqBody = JSON.stringify({ url, venue: venue || '' });
      const internalResp = await new Promise((resolve, reject) => {
        const mockRes = {
          statusCode: 200,
          _body: null,
          status(code) { this.statusCode = code; return this; },
          json(body) { this._body = body; resolve(this); },
        };
        const mockReq = {
          body: { url, venue: venue || '' },
          user: req.user,
        };

        // Re-use the same logic: detect venue from URL, fetch, parse
        (async () => {
          let userVenue = venue || '';
          if (!userVenue) {
            const urlLower = url.toLowerCase();
            const URL_VENUE_MAP = {
              'venetian': 'Venetian', 'palazzo': 'Venetian',
              'borgata': 'Borgata',
              'wynn': 'Wynn Las Vegas', 'encore': 'Wynn Las Vegas',
              'aria': 'Aria', 'bellagio': 'Bellagio',
              'resortsworld': 'Resorts World', 'resorts-world': 'Resorts World', 'rwlasvegas': 'Resorts World',
              'goldennugget': 'Golden Nugget', 'golden-nugget': 'Golden Nugget',
              'southpoint': 'South Point', 'south-point': 'South Point',
              'orleans': 'Orleans',
              'horseshoe': 'Horseshoe / Paris Las Vegas',
              'mgmnationalharbor': 'MGM National Harbor', 'mgm-national-harbor': 'MGM National Harbor',
              'mgmgrand': 'MGM Grand',
              'seminole': 'Seminole Hard Rock', 'hardrock': 'Seminole Hard Rock',
              'foxwoods': 'Foxwoods',
              'thundervalley': 'Thunder Valley', 'thunder-valley': 'Thunder Valley',
              'caesars': 'Caesars Palace',
              'turningstone': 'Turning Stone Casino', 'turning-stone': 'Turning Stone Casino',
              'texascardhouse': 'Texas Card House',
              'wsop': 'Horseshoe / Paris Las Vegas',
              'lodgepoker': 'Lodge Poker Club', 'thelodge': 'Lodge Poker Club',
              'bestbet': 'bestbet Jacksonville', 'ballys': "Bally's Lake Tahoe",
              'harrahs': "Harrah's Cherokee", 'cherokee': "Harrah's Cherokee",
              'choctaw': 'Choctaw Casino', 'tunica': 'Horseshoe Tunica',
            };
            for (const [key, val] of Object.entries(URL_VENUE_MAP)) {
              if (urlLower.includes(key)) { userVenue = val; break; }
            }
            if (userVenue) console.log(`[BatchImport] Detected venue from URL: ${userVenue}`);
          }

          const client = new Anthropic({ apiKey, timeout: 180000 });
          const fetchResp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FutureGame/1.0)' },
            redirect: 'follow',
            signal: AbortSignal.timeout(30000),
          });
          if (!fetchResp.ok) throw new Error(`HTTP ${fetchResp.status}`);

          const contentType = (fetchResp.headers.get('content-type') || '').toLowerCase();
          const pageErrors = [];
          let allEvents = [];

          if (contentType.includes('application/pdf') || url.toLowerCase().endsWith('.pdf')) {
            const buffer = Buffer.from(await fetchResp.arrayBuffer());
            const visionContent = [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
            ];
            allEvents = await runTwoPassExtraction(client, visionContent, pageErrors);
          } else if (contentType.includes('image/')) {
            const imgType = contentType.includes('png') ? 'image/png' : contentType.includes('webp') ? 'image/webp' : 'image/jpeg';
            const buffer = Buffer.from(await fetchResp.arrayBuffer());
            const visionContent = [
              { type: 'image', source: { type: 'base64', media_type: imgType, data: buffer.toString('base64') } },
            ];
            allEvents = await runTwoPassExtraction(client, visionContent, pageErrors);
          } else {
            const html = await fetchResp.text();
            const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
            let relevantHtml = '';
            for (const table of tables) {
              const rows = (table.match(/<tr/gi) || []).length;
              const hasDollarAmounts = (table.match(/\$\d/g) || []).length;
              if (rows > 10 && hasDollarAmounts > 5) relevantHtml += table + '\n';
            }
            const sourceHtml = relevantHtml || html;
            const textContent = sourceHtml
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, '')
              .replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();

            if (textContent.length >= 50) {
              const { STRUCTURE_PROMPT } = getSchedulePrompts();
              const venueHint = userVenue ? `\nIMPORTANT: The venue for ALL events is "${userVenue}". Set venue to "${userVenue}" for every event.\n` : '';
              const prompt = `Here is a poker tournament schedule from a web page (${url}):\n${venueHint}\n${textContent}\n\n${STRUCTURE_PROMPT}`;
              const pass = await client.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 32768,
                messages: [
                  { role: 'user', content: prompt },
                  { role: 'assistant', content: '[' },
                ],
              });
              const raw = '[' + (pass.content[0]?.text?.trim() || '');
              const events = extractJsonArray(raw);
              if (events && Array.isArray(events)) {
                for (const ev of events) allEvents.push(ev);
              }
            }
          }

          const { deduplicated, warnings } = postProcessEvents(allEvents, userVenue);
          resolve({
            statusCode: 200,
            _body: {
              events: deduplicated,
              rawCount: allEvents.length,
              eventCount: deduplicated.length,
              warnings,
              pageErrors,
              sourceFile: url,
              detectedVenue: deduplicated.length > 0 ? deduplicated[0].venue : null,
            },
          });
        })().catch(reject);
      });

      results.push({
        url,
        venue: internalResp._body.detectedVenue || venue || 'Unknown',
        success: internalResp.statusCode === 200,
        eventCount: internalResp._body.eventCount || 0,
        events: internalResp._body.events || [],
        warnings: internalResp._body.warnings || [],
        pageErrors: internalResp._body.pageErrors || [],
      });
      console.log(`[BatchImport] ${i + 1}/${urls.length} done: ${internalResp._body.eventCount || 0} events from ${url}`);
    } catch (err) {
      console.error(`[BatchImport] ${i + 1}/${urls.length} failed: ${err.message}`);
      results.push({ url, venue: venue || 'Unknown', success: false, error: err.message, eventCount: 0 });
    }
  }

  const totalEvents = results.reduce((sum, r) => sum + (r.eventCount || 0), 0);
  const successCount = results.filter(r => r.success).length;
  console.log(`[BatchImport] Complete: ${successCount}/${urls.length} URLs succeeded, ${totalEvents} total events`);

  res.json({
    totalUrls: urls.length,
    successCount,
    failCount: urls.length - successCount,
    totalEvents,
    results,
  });
});

// ── Check for duplicate events before import ──
app.post('/api/check-schedule-duplicates', authenticateToken, express.json({ limit: '5mb' }), async (req, res) => {
  const { events } = req.body;
  if (!events || !Array.isArray(events)) return res.json({ existing: 0, new: 0 });

  try {
    let existing = 0;
    let newEvents = 0;
    const existingVenues = new Set();

    for (const ev of events) {
      if (!ev.date || !ev.game_variant) continue;
      if (!ev.venue) ev.venue = 'Unknown Venue';

      let date = ev.date;
      if (!/^\d{4}-\d{2}-\d{2}/.test(date)) {
        const dt = new Date(date + ' 12:00:00');
        if (!isNaN(dt.getTime())) date = dt.toISOString().slice(0, 10);
      } else {
        date = date.slice(0, 10);
      }

      const sid = generateStableId(ev.venue, ev.event_number || '', ev.event_name || '', date, ev.time, ev.buyin);
      const row = db.prepare('SELECT stable_id, uploaded_by FROM tournaments WHERE stable_id = ?').get(sid);
      if (row) {
        existing++;
        existingVenues.add(ev.venue);
      } else {
        newEvents++;
      }
    }

    res.json({ existing, new: newEvents, total: events.length, existingVenues: [...existingVenues] });
  } catch (err) {
    console.error('[CheckDuplicates] Error:', err.message);
    res.json({ existing: 0, new: events.length, total: events.length, existingVenues: [] });
  }
});

// ── Import parsed schedule events into database ──
app.post('/api/import-parsed-schedule', authenticateToken, requireRegistered, express.json({ limit: '5mb' }), async (req, res) => {
  const { events, sourceFile } = req.body;
  if (!events || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'No events provided' });
  }

  try {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const ev of events) {
      if (!ev.date || !ev.game_variant) {
        skipped++;
        continue;
      }
      // Use event venue, or fall back
      if (!ev.venue) {
        ev.venue = 'Unknown Venue';
      }

      // Normalize date to YYYY-MM-DD for consistency with seed data
      let date = ev.date;
      if (!/^\d{4}-\d{2}-\d{2}/.test(date)) {
        const dt = new Date(date + ' 12:00:00');
        if (!isNaN(dt.getTime())) {
          date = dt.toISOString().slice(0, 10);
        }
      } else {
        date = date.slice(0, 10);
      }
      // Fix wrong years — AI sometimes hallucinates past years from document headers
      // All tournament schedules on this platform are for 2025-2027
      if (date && /^\d{4}/.test(date)) {
        const year = parseInt(date.slice(0, 4));
        if (year < 2025) {
          date = '2026' + date.slice(4);
          console.log(`[ImportSchedule] Fixed past year ${year} -> 2026 for ${ev.event_name}`);
        }
      }

      let evName = ev.event_name || 'Unknown Event';
      // Normalize brand casing
      evName = evName.replace(/\bbetmgm\b/gi, 'BetMGM');
      // Auto-prepend variant prefix for Seniors/Ladies events that lack it
      if (/\b(Seniors|Ladies)\b/i.test(evName) && ev.game_variant && !new RegExp(`\\b${ev.game_variant}\\b`, 'i').test(evName)) {
        evName = `${ev.game_variant} ${evName}`;
      }
      const evVenue = ev.venue ? ev.venue.replace(/\bbetmgm\b/gi, 'BetMGM') : ev.venue;
      const evNumber = ev.event_number || '';
      const sid = ev.stable_id || generateStableId(evVenue, evNumber, evName, date, ev.time, ev.buyin);

      // Check if this event already exists
      const existingRow = db.prepare('SELECT stable_id FROM tournaments WHERE stable_id = ?').get(sid);

      // Build notes from optional fields
      const notes = [];
      if (ev.guarantee) notes.push(`$${ev.guarantee.toLocaleString()} Guaranteed`);
      if (ev.bounty_amount) notes.push(`$${ev.bounty_amount} Bounty`);
      if (ev.table_size) notes.push(ev.table_size);

      db.run(
        `INSERT INTO tournaments (stable_id, event_number, event_name, date, time, buyin, starting_chips, level_duration, reentry, late_reg, game_variant, venue, notes, is_satellite, target_event, is_restart, parent_event, prize_pool, day_length, uploaded_by, source_pdf, is_deepstack, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(stable_id) DO UPDATE SET
           event_name=excluded.event_name, date=excluded.date, time=excluded.time,
           buyin=excluded.buyin, starting_chips=excluded.starting_chips, level_duration=excluded.level_duration,
           reentry=excluded.reentry, late_reg=excluded.late_reg, game_variant=excluded.game_variant,
           venue=excluded.venue, notes=excluded.notes, is_satellite=excluded.is_satellite,
           target_event=excluded.target_event, is_restart=excluded.is_restart, parent_event=excluded.parent_event,
           prize_pool=excluded.prize_pool, day_length=excluded.day_length, category=excluded.category`,
        [
          sid,
          evNumber,
          evName,
          date,
          ev.time || '12:00 PM',
          ev.buyin || 0,
          ev.starting_chips || null,
          ev.level_duration || null,
          ev.reentry || null,
          ev.late_reg || null,
          ev.game_variant,
          evVenue,
          notes.length > 0 ? notes.join(', ') : null,
          ev.is_satellite ? 1 : 0,
          ev.target_event || null,
          ev.is_restart ? 1 : 0,
          ev.parent_event || null,
          ev.guarantee || null,
          ev.day_length || null,
          req.user.id,
          sourceFile || 'Vision Upload',
          0,
          (ev.category === 'deepstack' ? 'side' : ev.category) || null
        ]
      );
      if (existingRow) updated++;
      else inserted++;
    }

    await saveDatabase();

    console.log(`[ImportSchedule] ${inserted} new, ${updated} updated, ${skipped} skipped from "${sourceFile}"`);

    if (inserted > 0 || updated > 0) {
      broadcastToAll('schedule-refetch', { source: 'import-parsed-schedule', inserted, updated });
    }

    // Notify admin of new schedule upload
    const uploaderName = req.user.username || 'Unknown';
    const venue = events[0]?.venue || 'Unknown venue';
    sendPushToAdmin(
      'Schedule Uploaded',
      `${uploaderName} imported ${inserted} new + ${updated} updated events for ${venue}`,
      '/'
    ).catch(() => {});

    // Auto-sync to production in background
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) syncToRemote(token).catch(err => console.error('[AutoSync] Background error:', err.message));

    res.json({ inserted, updated, skipped, total: events.length });
  } catch (err) {
    console.error('[ImportSchedule] Error:', err.message);
    res.status(500).json({ error: 'Failed to import events: ' + err.message });
  }
});

// ── Cross-environment sync helper ──
// After local imports, push changed events to production (and vice versa)
async function syncToRemote(localToken) {
  const PROD_URL = 'https://futurega.me';
  const LOCAL_URL = `http://localhost:${PORT}`;
  const isProduction = process.env.RENDER || process.env.IS_PRODUCTION;
  if (isProduction) return; // Production doesn't need to sync to itself

  try {
    // Export from local
    const exportRes = await fetch(`${LOCAL_URL}/api/tournaments/export`, {
      headers: { Authorization: `Bearer ${localToken}` }
    });
    if (!exportRes.ok) { console.log('[AutoSync] Local export failed:', exportRes.status); return; }
    const exportData = await exportRes.json();

    // Log in to production
    const adminUser = process.env.ADMIN_USER || 'ham';
    const adminPass = process.env.ADMIN_PASS || '';
    if (!adminPass) { console.log('[AutoSync] No ADMIN_PASS set, skipping remote sync'); return; }

    const loginRes = await fetch(`${PROD_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: adminUser, password: adminPass })
    });
    if (!loginRes.ok) { console.log('[AutoSync] Production login failed'); return; }
    const { token: prodToken } = await loginRes.json();

    // Sync to production
    const syncRes = await fetch(`${PROD_URL}/api/tournaments/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${prodToken}` },
      body: JSON.stringify({ tournaments: exportData.tournaments })
    });
    if (!syncRes.ok) { console.log('[AutoSync] Production sync failed:', syncRes.status); return; }
    const result = await syncRes.json();
    console.log(`[AutoSync] → Production: ${result.inserted} new, ${result.updated} updated, ${result.skipped} skipped`);
  } catch (err) {
    console.error('[AutoSync] Error:', err.message);
  }
}

// ── Tournament Data Sync ──
// Export all tournaments as JSON (for syncing between environments)
app.get('/api/tournaments/export', authenticateToken, (req, res) => {
  if (!['ham', 'ham5'].includes((req.user.username || '').toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const stmt = db.prepare("SELECT * FROM tournaments WHERE venue != 'Personal' ORDER BY date, time");
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    res.json({ tournaments: rows, exportedAt: new Date().toISOString(), count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Shared upsert-by-stable_id used by both sync endpoints. Rows without a stable_id are
// skipped (there is nothing stable to key the upsert on).
async function upsertTournamentsByStableId(tournaments, source) {
  let inserted = 0, updated = 0, skipped = 0;
  for (const t of tournaments) {
    if (!t.stable_id || !t.date || !t.event_name) { skipped++; continue; }

    // Genuine existence check — sql.js Statement.get() returns a truthy empty array on
    // no-match, which made every insert count as an update (and muted the admin push).
    const sel = db.prepare('SELECT id FROM tournaments WHERE stable_id = ?');
    sel.bind([t.stable_id]);
    const existing = sel.step();
    sel.free();

    db.run(
      `INSERT INTO tournaments (stable_id, event_number, event_name, date, time, buyin, starting_chips, level_duration, reentry, late_reg, late_reg_end, game_variant, venue, notes, category, is_satellite, target_event, is_restart, parent_event, day_length, prize_pool, house_fee, opt_add_on, rake_pct, rake_dollars, is_deepstack, source_pdf, structure_sheet_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(stable_id) DO UPDATE SET
         event_number=excluded.event_number, event_name=excluded.event_name, date=excluded.date,
         time=excluded.time, buyin=excluded.buyin, starting_chips=excluded.starting_chips,
         level_duration=excluded.level_duration, reentry=excluded.reentry, late_reg=excluded.late_reg,
         late_reg_end=excluded.late_reg_end, game_variant=excluded.game_variant, venue=excluded.venue,
         notes=excluded.notes, category=excluded.category, is_satellite=excluded.is_satellite,
         target_event=excluded.target_event, is_restart=excluded.is_restart, parent_event=excluded.parent_event,
         day_length=excluded.day_length, prize_pool=excluded.prize_pool, house_fee=excluded.house_fee,
         opt_add_on=excluded.opt_add_on, rake_pct=excluded.rake_pct, rake_dollars=excluded.rake_dollars,
         is_deepstack=excluded.is_deepstack, structure_sheet_path=excluded.structure_sheet_path`,
      [
        t.stable_id, t.event_number || '', t.event_name, t.date, t.time || '12:00 PM',
        t.buyin || 0, t.starting_chips || null, t.level_duration || null,
        t.reentry || null, t.late_reg || null, t.late_reg_end || null,
        t.game_variant || 'NLH', t.venue || 'Unknown', t.notes || null,
        t.category || null, t.is_satellite ? 1 : 0, t.target_event || null,
        t.is_restart ? 1 : 0, t.parent_event || null, t.day_length || null,
        t.prize_pool || null, t.house_fee || null, t.opt_add_on || null,
        t.rake_pct || null, t.rake_dollars || null, t.is_deepstack ? 1 : 0,
        t.source_pdf || null, t.structure_sheet_path || null
      ]
    );
    if (existing) updated++; else inserted++;
  }

  await saveDatabase();
  console.log(`[Sync:${source}] ${inserted} new, ${updated} updated, ${skipped} skipped`);
  if (inserted > 0 || updated > 0) {
    broadcastToAll('schedule-refetch', { source: 'tournaments-sync', inserted, updated });
  }
  if (inserted > 0) {
    sendPushToAdmin('Events Synced', `${inserted} new events added via sync`).catch(() => {});
  }
  return { inserted, updated, skipped };
}

// Import/sync tournaments from another environment (upserts by stable_id)
app.post('/api/tournaments/sync', authenticateToken, express.json({ limit: '50mb' }), async (req, res) => {
  if (!['ham', 'ham5'].includes((req.user.username || '').toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { tournaments } = req.body;
  if (!tournaments || !Array.isArray(tournaments)) {
    return res.status(400).json({ error: 'Expected { tournaments: [...] }' });
  }

  try {
    const result = await upsertTournamentsByStableId(tournaments, 'admin');
    res.json({ ...result, total: tournaments.length });
  } catch (err) {
    console.error('[Sync] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// MTT-feed seam: the Windows box's pm2 instance ingests ./mtt-feed/ hourly and mirrors the
// rows here (see pushMttFeedToProd). Token-gated like the dashboard seams — no JWT login,
// just a shared SYNC_TOKEN in both environments. 403s when SYNC_TOKEN is unset (opt-in).
app.post('/api/tournaments/feed-sync/:token', express.json({ limit: '50mb' }), async (req, res) => {
  const expected = process.env.SYNC_TOKEN;
  if (!expected || req.params.token !== expected) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { tournaments, feedVenues } = req.body;
  if (!tournaments || !Array.isArray(tournaments)) {
    return res.status(400).json({ error: 'Expected { tournaments: [...] }' });
  }

  try {
    const result = await upsertTournamentsByStableId(tournaments, 'mtt-feed');
    // Reconcile deletions. Guarded three ways so a truncated or malformed push can't
    // empty the production schedule: the venue list must be present and non-empty, the
    // upsert must have actually landed rows, and pruneFeedVenues() skips anything a user
    // has saved or logged results against. The second guard counts upserted rows rather
    // than payload length — a payload of malformed rows is all skipped, and that must not
    // be read as "the feed is now empty, delete everything else".
    let pruned = 0;
    if (Array.isArray(feedVenues) && feedVenues.length && (result.inserted + result.updated) > 0) {
      pruned = pruneFeedVenues(feedVenues, 'FeedSync').pruned;
      if (pruned > 0) {
        await saveDatabase();
        console.log(`[FeedSync] pruned ${pruned} row(s) from series no longer in the feed`);
        broadcastToAll('schedule-refetch', { source: 'mtt-feed-prune', pruned });
      }
    }
    res.json({ ...result, pruned, total: tournaments.length });
  } catch (err) {
    console.error('[FeedSync] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// New-series alert from the MTT watcher (mtt-series-watcher/src/notify/new-series.ts). Token-gated
// like the feed seam above, but the token rides in a header instead of the path — URLs land in proxy
// and access logs, headers don't. This only does anything in PRODUCTION: sendPushToAdmin needs VAPID
// keys and a 'ham' push subscription, and the local box has neither.
app.post('/api/admin/notify/new-series', express.json({ limit: '256kb' }), async (req, res) => {
  const expected = process.env.SYNC_TOKEN;
  if (!expected || req.get('x-sync-token') !== expected) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { title, body, series, dryRun } = req.body || {};
  if (!dryRun && (!title || !body)) {
    return res.status(400).json({ error: 'Expected { title, body }' });
  }
  // Report how many subscriptions the push can actually reach, selected exactly as
  // sendPushToAdmin selects them. Without this a 200 is unfalsifiable: sendPushToAdmin catches its
  // own errors and returns nothing, so "sent to nobody" and "delivered" look identical to a caller.
  // dryRun answers that question without putting a test notification on the admin's phone.
  let subscribers = 0;
  try {
    const sub = db.prepare(
      `SELECT COUNT(*) AS n FROM push_subscriptions ps
       JOIN users u ON ps.user_id = u.id
       WHERE LOWER(u.username) = 'ham'`
    );
    if (sub.step()) subscribers = sub.getAsObject().n;
    sub.free();
  } catch (err) {
    console.error('[NewSeries] subscriber count failed:', err.message);
  }
  const vapidConfigured = !!process.env.VAPID_PUBLIC_KEY;
  if (dryRun) {
    // Aggregate by push-service host + age so "N subscribers" is interpretable. Endpoint URLs are
    // deliberately NOT returned: they are capability URLs — anyone holding one can push to that
    // device — so only the host and the created_at dates leave this endpoint.
    const byHost = {};
    try {
      const rows = db.prepare(
        `SELECT ps.endpoint, ps.created_at FROM push_subscriptions ps
         JOIN users u ON ps.user_id = u.id
         WHERE LOWER(u.username) = 'ham'`
      );
      while (rows.step()) {
        const r = rows.getAsObject();
        let host = 'unknown';
        try { host = new URL(r.endpoint).host; } catch (_) {}
        const day = String(r.created_at || '').slice(0, 10);
        if (!byHost[host]) byHost[host] = { count: 0, oldest: day, newest: day };
        byHost[host].count++;
        if (day && day < byHost[host].oldest) byHost[host].oldest = day;
        if (day && day > byHost[host].newest) byHost[host].newest = day;
      }
      rows.free();
    } catch (err) {
      console.error('[NewSeries] breakdown failed:', err.message);
    }
    return res.json({ ok: true, dryRun: true, subscribers, vapidConfigured, byHost });
  }
  try {
    const count = Array.isArray(series) ? series.length : 0;
    const send = await sendPushToAdmin(String(title), String(body), '/');
    const delivered = (send.results || []).filter((r) => r.ok).length;
    console.log(`[NewSeries] pushed "${title}" (${count} series → ${delivered}/${subscribers} accepted)`);
    res.json({ ok: true, seriesCount: count, subscribers, vapidConfigured, delivered, pruned: send.pruned, results: send.results });
  } catch (err) {
    console.error('[NewSeries] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Table Scanner: parse seating list image via Claude Vision ──
const scanUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/scan-table', authenticateToken, scanUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  try {
    const client = new Anthropic({ apiKey, timeout: 30000 });
    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype || 'image/jpeg';
    console.log(`[ScanTable] Processing ${(req.file.size / 1024).toFixed(0)}KB image (${mediaType})`);

    const format = req.body?.format || 'pokerstars';

    const promptByFormat = {
      pokerstars: `This is a PokerStars Live tournament seating list. Each row has 4 columns:
1. Position/rank number (ignore this)
2. Player name + country flag
3. Chip count
4. Seat assignment in "table-seat" format (e.g. "12-5", "13-2")

Extract every player row. For each return:
- name: player name only (no country, no position number)
- chips: chip count exactly as shown (e.g. "30,000", "51,000", "27K")
- seat: the value from column 4 only — the "table-seat" number like "12-5" or "13-2". Do NOT use the position number from column 1.
- isHero: true if this row has a DIFFERENT background color from the other rows (it could be any color — green, pink, purple, blue, yellow, etc.). Exactly one row will stand out with a unique background. That row is the hero. All others are false.

Return ONLY valid JSON array with keys "name", "chips", "seat", "isHero". No markdown.
Example: [{"name":"John Smith","chips":"30,000","seat":"12-5","isHero":false},{"name":"Ethan Bennett","chips":"32,700","seat":"13-7","isHero":true}]`,

      wsop: `This is a WSOP Live poker tournament table screenshot. Players are seated around a green felt oval table. Above the table there is a row showing the table info (e.g. "Day 2 010" means Table 10).

STEP 1 — Determine table_size from the LAYOUT, not the player count:
CRITICAL: When players bust, the WSOP Live app does NOT reflow the table. A 7-max table stays a 7-max table even if only 4 players are left — the busted seats are simply BLANK at their original positions. Counting visible names will give you the wrong size. Instead, judge by the geometry of where seats are drawn:

- 6-max layout: 3 rows down each side, NO bottom-center slot. Vertical row spacing is the WIDEST.
- 7-max layout: 3 rows down each side + a lone slot at bottom-center. Same row spacing as 6-max, just with the extra bottom-center.
- 8-max layout: 4 rows down each side, NO bottom-center slot. Vertical row spacing is TIGHTER than 6/7-max.
- 9-max layout: 4 rows down each side + a lone slot at bottom-center. Same row spacing as 8-max, plus bottom-center.

How to tell:
1. Look at how many ROW POSITIONS are drawn down each side (count the vertical positions occupied by either a name OR a noticeable empty slot). 3 rows per side → 6 or 7 max. 4 rows per side → 8 or 9 max.
2. Then check if there is a lone slot at bottom-center (player or empty space between bottom-left and bottom-right). If yes → odd (7 or 9). If no → even (6 or 8).
3. The vertical distance between adjacent row positions is wider on 6/7-max than on 8/9-max because there are fewer rows packed into the same felt height.

Empty seats: do NOT include them in the players array, but DO use them as evidence of the layout, and DO leave their seat numbers unused (the remaining players keep their original seats).

STEP 2 — Use the seat map for that size:
The WSOP Live app draws players at FIXED relative positions for each table size. Match each player to a seat by their visual position on the felt.

9-max layout (4 down each side + 1 bottom-center):
  Seat 1: top-right corner
  Seat 2: right side, upper
  Seat 3: right side, lower
  Seat 4: bottom-right corner
  Seat 5: bottom-center
  Seat 6: bottom-left corner
  Seat 7: left side, lower
  Seat 8: left side, upper
  Seat 9: top-left corner

8-max layout (4 down each side, no bottom-center seat — common for PLO/short events):
  Seat 1: top-right corner
  Seat 2: right side, upper
  Seat 3: right side, lower
  Seat 4: bottom-right corner
  Seat 5: bottom-left corner
  Seat 6: left side, lower
  Seat 7: left side, upper
  Seat 8: top-left corner

7-max layout (3 rows down each side + 1 lone seat at bottom-center):
  Seat 1: top-right
  Seat 2: right side, upper-middle
  Seat 3: right side, lower-middle (NOT a corner — there's no bottom-corner seat in 7-max)
  Seat 4: bottom-center
  Seat 5: left side, lower-middle
  Seat 6: left side, upper-middle
  Seat 7: top-left

6-max layout (3 rows down each side, NO bottom-center):
  Seat 1: top-right
  Seat 2: right side, middle
  Seat 3: bottom-right
  Seat 4: bottom-left
  Seat 5: left side, middle
  Seat 6: top-left

KEY DISAMBIGUATION:
- 6-max vs 7-max: both have 3 rows down each side. The difference is whether there's a 7th player alone at bottom-center. If yes → 7-max. If no → 6-max.
- 8-max vs 9-max: both have 4 rows down each side. The difference is whether there's a 9th player alone at bottom-center.
- 6-max and 7-max have noticeably WIDER vertical row spacing than 8-max and 9-max because they have fewer rows to fit in the same vertical space.

Numbering ALWAYS starts at top-right and goes CLOCKWISE around the oval.

STEP 3 — Extract the table number from the header above the table. Format is like "Day 2 010" → table 10 (strip leading zeros).

Return ONLY valid JSON. Schema:
{"table": <int|null>, "table_size": <6|7|8|9>, "players": [{"name": "...", "chips": "405.0K"|"1.1M"|null, "seat": <int>}]}

No markdown, no explanation. Example for an 8-max PLO table:
{"table":57,"table_size":8,"players":[{"name":"Christopher Power","chips":"215.5K","seat":8},{"name":"Jiayi Yao","chips":"236.5K","seat":1},{"name":"Nitin Gupta","chips":"200.0K","seat":2},{"name":"Shanna Gathright","chips":"401.0K","seat":3},{"name":"David Valden","chips":"532.0K","seat":4},{"name":"Lawrence Wayne","chips":"184.0K","seat":5},{"name":"Ryan Haas","chips":"161.0K","seat":6},{"name":"Thomas Gawlik","chips":"701.0K","seat":7}]}`,
    };

    const prompt = promptByFormat[format] || promptByFormat.pokerstars;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const text = message.content[0]?.text?.trim() || '';
    // Strip markdown code fences if present
    const json = text.includes('```') ? text.replace(/^[\s\S]*?```(?:json)?\s*/i, '').replace(/\s*```[\s\S]*$/, '').trim() : text.trim();
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      console.error('[ScanTable] Failed to parse Claude response:', text);
      return res.status(422).json({ error: 'Could not parse player data from image', raw: text });
    }

    // WSOP format returns { table, players }, PokerStars returns array directly
    let players, tableNumber = null;
    if (format === 'wsop' && parsed && !Array.isArray(parsed)) {
      tableNumber = parsed.table || null;
      players = parsed.players || [];
    } else {
      players = Array.isArray(parsed) ? parsed : [];
    }

    console.log(`[ScanTable] Extracted ${players.length} players${tableNumber ? ' at table ' + tableNumber : ''}:`, players.map(p => `${p.name} seat=${p.seat} hero=${p.isHero}`).join(', '));
    res.json({ players, tableNumber });
  } catch (err) {
    console.error('[ScanTable] Error:', err.status || '', err.message, err.error?.message || '');
    const msg = err.status === 401 ? 'API key invalid or expired'
      : err.status === 429 ? 'Rate limit exceeded, try again shortly'
      : err.status === 400 ? 'Image could not be processed'
      : `Scan failed (${err.status || 500})`;
    res.status(err.status || 500).json({ error: msg });
  }
});

// ── Subscriptions ─────────────────────────────────────────────
// Monetization foundation. See MONETIZATION-PLAN.md §11 for the full design.

const TIER_RANK = {
  suite_pro_plus: 1,
  suite_pro: 2,
  planner_pro: 3,
  replayer_pro: 3,
  manager_pro: 3,
  free: 99,
};
const TRIAL_DAYS = 14;
const SUBSCRIPTION_GRACE_DAYS = 7;

function getActiveSubscriptionRow(userId) {
  const now = Date.now();
  const stmt = db.prepare(`
    SELECT id, tier, status, source, source_id, starts_at, ends_at, trial_ends_at, created_at, updated_at
    FROM subscriptions
    WHERE user_id = ?
      AND status IN ('trial', 'active', 'grace')
      AND (ends_at IS NULL OR ends_at > ?)
  `);
  stmt.bind([userId, now]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    const ra = TIER_RANK[a.tier] ?? 99;
    const rb = TIER_RANK[b.tier] ?? 99;
    if (ra !== rb) return ra - rb;
    return (b.ends_at || Infinity) - (a.ends_at || Infinity);
  });
  return rows[0];
}

function subscriptionToClient(row) {
  if (!row) return { tier: 'free', status: 'free', renewsAt: null, trial: null };
  const trialDaysLeft = row.trial_ends_at ? Math.max(0, Math.ceil((row.trial_ends_at - Date.now()) / 86400000)) : null;
  return {
    tier: row.tier,
    status: row.status,
    source: row.source,
    renewsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    startedAt: new Date(row.starts_at).toISOString(),
    trial: row.status === 'trial' && row.trial_ends_at
      ? { endsAt: new Date(row.trial_ends_at).toISOString(), remainingDays: trialDaysLeft }
      : null,
  };
}

app.get('/api/subscription', authenticateToken, (req, res) => {
  try {
    const row = getActiveSubscriptionRow(req.user.id);
    res.json(subscriptionToClient(row));
  } catch (e) {
    console.error('GET /api/subscription error:', e);
    res.status(500).json({ error: 'Failed to load subscription' });
  }
});

app.post('/api/subscription/trial/start', authenticateToken, requireRegistered, async (req, res) => {
  try {
    // One trial per user, ever.
    const u = db.prepare('SELECT trial_used_at FROM users WHERE id = ?');
    u.bind([req.user.id]);
    if (!u.step()) { u.free(); return res.status(404).json({ error: 'User not found' }); }
    const { trial_used_at } = u.getAsObject();
    u.free();
    if (trial_used_at) return res.status(409).json({ error: 'Trial already used' });

    const now = Date.now();
    const trialEnd = now + TRIAL_DAYS * 86400000;
    db.run(
      `INSERT INTO subscriptions (user_id, tier, status, source, starts_at, ends_at, trial_ends_at, created_at, updated_at)
       VALUES (?, 'suite_pro', 'trial', 'system', ?, ?, ?, ?, ?)`,
      [req.user.id, now, trialEnd, trialEnd, now, now]
    );
    db.run('UPDATE users SET trial_used_at = ? WHERE id = ?', [now, req.user.id]);
    await saveDatabase();
    res.json(subscriptionToClient(getActiveSubscriptionRow(req.user.id)));
  } catch (e) {
    console.error('POST /api/subscription/trial/start error:', e);
    res.status(500).json({ error: 'Failed to start trial' });
  }
});

// Admin-only: grant a subscription manually. Used for promo codes, support,
// and giving comp accounts. Same shape as the payment-provider webhook will
// eventually populate.
app.post('/api/subscription/grant', authenticateToken, requireRegistered, async (req, res) => {
  if (!['ham', 'ham5'].includes((req.user.username || '').toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { userId, tier, days, source = 'manual', sourceId = null } = req.body || {};
    if (!userId || !tier || !Number.isFinite(days)) return res.status(400).json({ error: 'userId, tier, days required' });
    if (!(tier in TIER_RANK)) return res.status(400).json({ error: 'Unknown tier' });
    const now = Date.now();
    const ends = now + days * 86400000;
    db.run(
      `INSERT INTO subscriptions (user_id, tier, status, source, source_id, starts_at, ends_at, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      [userId, tier, source, sourceId, now, ends, now, now]
    );
    await saveDatabase();
    res.json(subscriptionToClient(getActiveSubscriptionRow(userId)));
  } catch (e) {
    console.error('POST /api/subscription/grant error:', e);
    res.status(500).json({ error: 'Failed to grant subscription' });
  }
});

// Provider webhooks (skeletons — verification + signature checks come
// during the Apple/Stripe integration phase). They live here so the route
// surface exists from day one and the frontend can wire to stable URLs.
app.post('/api/subscription/apple/webhook', express.json({ limit: '256kb' }), async (req, res) => {
  // TODO: verify signedPayload JWS with Apple's root certs (per Apple docs
  // for App Store Server Notifications v2), then upsert a row keyed by
  // originalTransactionId. For now, accept-and-log so the endpoint URL is
  // stable for App Store Connect's notification config.
  console.log('[apple webhook]', JSON.stringify(req.body)?.slice(0, 500));
  res.json({ ok: true });
});

app.post('/api/subscription/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  // TODO: verify signature with STRIPE_WEBHOOK_SECRET (constructEvent), then
  // upsert subscriptions row using the customer/subscription IDs. For now,
  // accept-and-log so Stripe webhook config has a target.
  console.log('[stripe webhook] received', req.headers['stripe-signature'] ? 'signed' : 'unsigned');
  res.json({ ok: true });
});

// SPA catch-all for /shared/* routes
app.get('/shared/:token', serveIndex);

// Start server
initDatabase().then(() => {
  resolveHamOwnerId(); // console owner id, for cookie-SSO + Basic-Auth id-pinning
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    // Weekly backer email digest — Sunday 18:00 ET.
    try {
      cron.schedule('0 18 * * 0', () => { sendBackerWeeklyDigests(); }, { timezone: CONSOLE_TZ });
    } catch (err) {
      console.error('Backer digest cron setup error:', err.message);
    }
    // Backer-roster seam: pull the current roster from the dashboard at boot +
    // hourly (:35, offset from the mtt-emit :15), self-disables w/o token.
    try {
      syncBackerRoster();
      cron.schedule('35 * * * *', () => { syncBackerRoster(); }, { timezone: CONSOLE_TZ });
    } catch (err) {
      console.error('[roster] cron setup error:', err.message);
    }
    // MTT-feed seam: re-ingest hourly at :20 (the watcher emits at :15) and mirror the
    // feed rows to production. Boot ingest already ran in initDatabase; the boot push
    // here catches anything ingested while the server was down. Both self-disable
    // appropriately (no ./mtt-feed → ingest no-ops; no SYNC_TOKEN → push no-ops).
    try {
      pushMttFeedToProd();
      cron.schedule('20 * * * *', async () => {
        await ingestMttFeed();
        await pushMttFeedToProd();
      }, { timezone: CONSOLE_TZ });
    } catch (err) {
      console.error('[MTT feed] cron setup error:', err.message);
    }
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
