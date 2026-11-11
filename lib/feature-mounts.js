'use strict';
/*
 * The Features catalogue's server modules (docs/catalogues/features; owner picks, 2026-11-11), set up in one
 * place so server.js carries only the hooks into its existing routes. server.js calls:
 *
 *   features.init(deps)        once, at load: the senders that need server.js's push and mail plumbing
 *   features.migrateAll(db)    in initDatabase, every boot (each CREATE is IF NOT EXISTS)
 *   features.mountAll(app)     at boot, beside the MCP endpoint
 *
 * and reads features.push / features.notices / features.safety / features.accountSecurity in its hooks.
 */

const playerPush = require('./player-push');
const notices = require('./notices');
const safety = require('./safety');
const accountSecurity = require('./account-security');
const invites = require('./invites');
const feedback = require('./feedback');
const appleSignin = require('./apple-signin');
const dataExport = require('./data-export');
const calendarFeed = require('./calendar-feed');
const eventChanges = require('./event-changes');
const roomFollows = require('./room-follows');
const backerExtras = require('./backer-extras');
const eventPayouts = require('./event-payouts');
const sessionStop = require('./session-stop');
const handSocial = require('./hand-social');
const taxLinks = require('./tax-links');
const tickets = require('./tickets');
const packages = require('./staking/packages');
const cashAlerts = require('./cash-alerts');

/** Tables keyed by user_id that go with a deleted account (server.js deleteUserAccount). */
const USER_TABLES = ['notification_prefs', 'player_push_log', 'player_notices', 'user_sessions', 'email_changes',
  'invite_tokens', 'feedback', 'calendar_tokens', 'event_change_seen', 'room_follows', 'event_payouts', 'cash_session_stops', 'tax_links', 'tickets', 'cash_alerts'];

let deps = null;
let push = null;

function init(d) {
  deps = d;
  push = playerPush.createPlayerPush({
    getDb: d.getDb, saveDatabase: d.saveDatabase, webpush: d.webpush,
    vapidConfigured: d.vapidConfigured, sendApnsOne: d.sendApnsOne, apnsConfigured: d.apnsConfigured,
  });
}

function migrateAll(db) {
  appleSignin.migrate(db);
  playerPush.migrate(db);
  notices.migrate(db);
  safety.migrate(db);
  accountSecurity.migrate(db);
  invites.migrate(db);
  feedback.migrate(db);
  calendarFeed.migrate(db);
  eventChanges.migrate(db);
  roomFollows.migrate(db);
  backerExtras.migrate(db);
  eventPayouts.migrate(db);
  sessionStop.migrate(db);
  handSocial.migrate(db);
  taxLinks.migrate(db);
  tickets.migrate(db);
  packages.migrate(db);
  cashAlerts.migrate(db);
}

function mountAll(app) {
  const base = {
    getDb: deps.getDb, saveDatabase: deps.saveDatabase,
    authenticateToken: deps.authenticateToken, requireRegistered: deps.requireRegistered,
  };
  playerPush.mountRoutes(app, base);
  notices.mountRoutes(app, base);
  safety.mountRoutes(app, { ...base, isAppAdmin: deps.isAppAdmin, sendPushToAdmin: deps.sendPushToAdmin, onMessageRemoved: deps.onMessageRemoved });
  accountSecurity.mountRoutes(app, {
    ...base, bcrypt: deps.bcrypt, signSession: deps.signSession, sendMail: deps.sendMail, appUrl: deps.appUrl, limiter: deps.accountLimiter,
  });
  invites.mountRoutes(app, {
    ...base, siteUrl: deps.appUrl, isBlocked: safety.isBlocked, publicLimiter: deps.publicLimiter,
    onRequest: (inviterId, from) => push.send(inviterId, 'requests', { title: 'Connection request', body: `${from.username} scanned your code`, url: '/#/social', ref: `req:${from.id}` }).catch(() => {}),
  });
  feedback.mountRoutes(app, { ...base, isAppAdmin: deps.isAppAdmin, sendPushToAdmin: deps.sendPushToAdmin, notify });
  appleSignin.mountRoutes(app, {
    ...base, jwt: deps.jwt, issueSession: deps.issueSession, deriveUsername: deps.deriveUsername, bcrypt: deps.bcrypt,
    growth: deps.growth, limiter: deps.appleLimiter, setSessionCookie: deps.setSessionCookie, parseOnboarding: deps.parseOnboarding,
    acceptInvite: invites.acceptAtSignup,
  });
  dataExport.mountRoutes(app, { ...base, bcrypt: deps.bcrypt, limiter: deps.accountLimiter });
  calendarFeed.mountRoutes(app, { ...base, siteUrl: deps.appUrl, publicLimiter: deps.publicLimiter });
  eventChanges.mountRoutes(app, { ...base, dismissNotice: notices.dismissRef });
  roomFollows.mountRoutes(app, base);
  eventPayouts.mountRoutes(app, base);
  sessionStop.mountRoutes(app, base);
  handSocial.mountRoutes(app, {
    ...base, blockSet: safety.blockSet, broadcastToGroup: deps.broadcastToGroup,
    notify: (uid, kind, msg) => notify(uid, kind, msg),
    optionalAuth: handSocial.optionalAuthWith(deps.jwt, deps.jwtSecret),
  });
  taxLinks.mountRoutes(app, {
    ...base, requireAppAdmin: deps.requireAppAdmin, taxEntriesFor: deps.taxEntriesFor, siteUrl: deps.appUrl, publicLimiter: deps.publicLimiter,
    listTransactions: require('./bankroll-transactions').listForUser, readSettings: (db, uid) => require('./staking/live').readSettings(db, uid),
  });
  tickets.mountRoutes(app, { ...base, followShares: deps.followShares });
  packages.mountRoutes(app, { ...base, requireAppAdmin: deps.requireAppAdmin, publicLimiter: deps.publicLimiter, siteUrl: deps.appUrl, notify: (uid, kind, msg) => notify(uid, kind, msg) });
  cashAlerts.mountRoutes(app, {
    ...base, requireAppAdmin: deps.requireAppAdmin, fetchCurrent: deps.fetchCashCurrent,
    sendPush: (uid, kind, msg) => push.send(uid, kind, msg), deliveryOn: playerPush.deliveryDecision().on,
  });
  backerExtras.mountRoutes(app, { ...base, requireAppAdmin: deps.requireAppAdmin, getOwnerId: deps.getOwnerId, tokenForViewId: deps.tokenForViewId });
  // Links that open in the app (Features 47): Apple and Android check these before they hand a
  // futurega.me/h/, /shared/ or /i/ link to the installed app. Android's needs the signing key's
  // fingerprint (ANDROID_CERT_SHA256); without it the file is not served and links stay in the browser.
  app.get('/.well-known/apple-app-site-association', (req, res) => {
    const team = process.env.APNS_TEAM_ID || '27TK6846H8';
    const bundle = process.env.APNS_BUNDLE_ID || 'app.futurega.me.beta';
    const id = `${team}.${bundle}`;
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/json').send(JSON.stringify({
      applinks: {
        apps: [],
        details: [{
          appID: id, appIDs: [id],
          paths: ['/h/*', '/shared/*', '/i/*'],
          components: [{ '/': '/h/*' }, { '/': '/shared/*' }, { '/': '/i/*' }],
        }],
      },
    }));
  });
  app.get('/.well-known/assetlinks.json', (req, res) => {
    const fp = String(process.env.ANDROID_CERT_SHA256 || '').trim();
    if (!fp) return res.status(404).type('application/json').send('[]');
    res.set('Cache-Control', 'public, max-age=3600');
    res.json([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: process.env.ANDROID_PACKAGE || 'app.futurega.me.beta', sha256_cert_fingerprints: fp.split(',').map((x) => x.trim()) } }]);
  });
  const g = playerPush.deliveryDecision();
  console.log(`[push] player delivery is ${g.on ? 'ON' : 'OFF'} on this instance (${g.why})`);
}

/**
 * One thing a player should hear of: a line in the bell (player_notices) and, where they want that
 * kind and delivery is on, a push. Never throws; resolves to the push's answer.
 */
async function notify(userId, kind, { title, body = null, url = null, ref = null, pushKind = kind, groupId = null, mention = false, bell = true } = {}) {
  try {
    if (bell) notices.add(deps.getDb(), userId, { kind, title, body, url, ref });
    return await push.send(userId, pushKind, { title, body, url, ref: ref ? `${kind}:${ref}` : null, groupId, mention });
  } catch (err) {
    console.error('[notify] failed:', err && err.message);
    return { sent: false, why: 'error' };
  }
}

/**
 * After a feed upsert (Features 4), given the snapshot eventChanges.before(db) took before it: tell each
 * player who saved a changed event, in the bell and (for a date, time, buy-in or a cancellation) by push.
 * `carried(row)` says whether the run still holds a row; `venues` which series it covered.
 */
/** What a feed run is compared against (Features 4 and 8): the saved feed rows and the series held. */
function beforeFeedRun(db) {
  let saved = null, venues = null;
  try { saved = eventChanges.before(db); } catch (_) { saved = null; }
  try { venues = roomFollows.venuesNow(db); } catch (_) { venues = null; }
  return { saved, venues };
}

async function afterFeedRun(db, snap, { carried = null, venues = null } = {}) {
  if (!snap) return 0;
  // A new series at a room someone follows (Features 8).
  try {
    const fresh = roomFollows.newSeries(db, snap.venues);
    for (const { userId, series } of roomFollows.followersOf(db, fresh)) {
      await notify(userId, 'follows', {
        title: `New at ${series.room}: ${series.venue}`,
        body: `${series.count} event${series.count === 1 ? '' : 's'}${series.first ? `, from ${series.first}` : ''}`,
        url: `/?find=${encodeURIComponent(series.venue)}`, ref: series.venue,
      });
    }
  } catch (err) { console.error('[follows] new series:', err.message); }
  if (!snap.saved || !snap.saved.size) return 0;
  try {
    const changes = eventChanges.after(db, snap.saved, { carried, venues });
    for (const { userId, change } of eventChanges.audience(db, changes)) {
      await notify(userId, 'changes', {
        title: `${change.name || 'A saved event'}: ${eventChanges.describe(change)}`,
        body: change.date ? String(change.date) : null, url: '/#/schedule/mine', ref: String(change.id),
        pushKind: change.alert ? 'changes' : 'none',
      });
    }
    if (changes.length) {
      console.log(`[event-changes] ${changes.length} change(s) to saved events`);
      if (deps && deps.saveDatabase) await deps.saveDatabase();
    }
    return changes.length;
  } catch (err) {
    console.error('[event-changes] compare failed:', err.message);
    return 0;
  }
}

module.exports = {
  beforeFeedRun, afterFeedRun, eventChanges,
  init, migrateAll, mountAll, notify, USER_TABLES,
  get push() { return push; },
  notices, safety, accountSecurity, playerPush, invites, feedback, appleSignin, handSocial,
};
