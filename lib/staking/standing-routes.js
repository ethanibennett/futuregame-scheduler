'use strict';
/*
 * Routes under /api/staking/standing (docs/bankroll-merge.md §6.10). Phase 2 mounts two, the
 * read-only Backers view a third, and the Notify tap (built ahead of Phase 7) a fourth:
 *
 *   GET  /api/staking/standing/parity                       the owner only (§7.6)
 *   GET  /api/staking/standing/backers                      the owner only: the roster as each backer's page shows it
 *   POST /api/staking/standing/notify                       the owner only: a result's Backers block, and the tap
 *   POST /api/staking/standing/backers/:backerId/rotate-link  "New link" (§7.5), scoped to req.user.id
 *
 * All of them sit behind the /api/staking admin gate that server.js applies to the whole prefix; they
 * repeat authenticateToken and requireAppAdmin the way the other staking routes do. The standing
 * agreements' own routes (agreements, stakes, exclusions, events, preview, drift) are later phases.
 *
 * No route logs a token. parity names backers by id and returns no token; rotate-link returns the
 * NEW link to the owner who asked for it and logs only counts; the Backers view returns each live
 * link (the owner's own credential to copy and open) and never a phone number, an address or a
 * backer_events.id.
 */
const surface = require('../backer-surface');
const notify = require('./notify');

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireAppAdmin, requireRegistered, limiter, getOwnerId, getRates, deliverShare } = deps;
  const noop = (req, res, next) => next();

  // Is the switch on? What would flipping it change? Run this before BACKER_PAGE_SOURCE=sql, and
  // again after every import: `differ` is the list of pages whose name, stakes, opening, totals,
  // history or weekly email would change. [] means the switch is invisible to every backer.
  app.get('/api/staking/standing/parity', authenticateToken, requireAppAdmin, (req, res) => {
    const owner = getOwnerId();
    if (owner == null || Number(req.user.id) !== Number(owner)) return res.status(403).json({ error: 'Forbidden' });
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ source: surface.pageSource(), ...surface.parity(getDb()) });
    } catch (err) {
      console.error('[backers] parity failed:', err && err.message);
      res.status(500).json({ error: 'parity failed' });
    }
  });

  // The owner's Backers view in the bankroll dashboard (read-only): each backer on the roster with
  // the figures their /b/ page shows (lib/backer-surface.js backersView, built through buildFeed),
  // their last ten shares, whether texts and the weekly email are set up, and the page link. The
  // roster (console_records) is one person's, so it is the owner's alone, like parity: another admin
  // is refused. Editing stays on the dashboard app until the merge moves it here.
  app.get('/api/staking/standing/backers', authenticateToken, requireAppAdmin, (req, res) => {
    const owner = getOwnerId();
    if (owner == null || Number(req.user.id) !== Number(owner)) return res.status(403).json({ error: 'Forbidden' });
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ backers: surface.backersView(getDb(), { source: surface.pageSource() }) });
    } catch (err) {
      console.error('[backers] view failed:', err && err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // The Notify tap (lib/staking/notify.js; docs/bankroll-merge.md "Notify tap"): one result's
  // backer shares. { refTable: 'tracking_entries'|'cash_sessions', refId, preview: bool, confirm? }.
  // preview (the default) computes the Backers block and writes nothing. preview: false records
  // every share not sent yet and messages those backers once (only where delivery is on); a second
  // tap on an unchanged result sends nothing and says so (already: true). A share that needs the
  // owner's second confirm (the dashboard sent that backer a share on the same date, or a series
  // agreement covers the tournament) is a 409 with the block until confirm: true. The owner's alone,
  // like parity: the roster is one person's. No token and no event id is ever in the answer.
  // Only the commit is rate limited: the block previews whenever a result's edit form opens.
  const commitLimit = (req, res, next) => (req.body && req.body.preview === false && limiter ? limiter(req, res, next) : next());
  app.post('/api/staking/standing/notify', authenticateToken, requireAppAdmin, requireRegistered || noop, commitLimit, async (req, res) => {
    const owner = getOwnerId();
    if (owner == null || Number(req.user.id) !== Number(owner)) return res.status(403).json({ error: 'Forbidden' });
    const b = req.body || {};
    const refId = Number(b.refId);
    if (!notify.REF_TABLES.includes(b.refTable)) return res.status(400).json({ error: 'refTable must be tracking_entries or cash_sessions' });
    if (!Number.isSafeInteger(refId) || refId <= 0) return res.status(400).json({ error: 'Bad refId' });
    res.set('Cache-Control', 'no-store');
    try {
      const cache = getRates ? await getRates() : null;
      const ctx = { ownerId: owner, ref: { table: b.refTable, id: refId }, source: surface.pageSource(), rates: cache && cache.rates, env: process.env };
      const db = getDb();
      if (b.preview !== false) {
        const r = notify.preview(db, ctx);
        return res.status(r.status).json(r.body);
      }
      const w = notify.commitWrite(db, { ...ctx, confirm: b.confirm === true, now: Date.now() });
      if (w.status !== 200) return res.status(w.status).json(w.body);
      // Saved before anyone is messaged: a crash mid-delivery leaves the share recorded, so a second
      // tap finds it and sends nothing again.
      if (w.inserted.length) await saveDatabase();
      const d = await notify.deliver(db, w.inserted, { env: process.env, deliver: deliverShare });
      if (d.changed) await saveDatabase();
      if (w.inserted.length) {
        console.log(`[backers] notify: ${b.refTable} #${refId} recorded for ${w.inserted.length} backer(s); delivery ${d.delivery}`);
      }
      res.json({ ...w.body, delivery: d.delivery, results: d.results });
    } catch (err) {
      const status = err && Number.isInteger(err.status) ? err.status : 500;
      if (status === 500) console.error('[backers] notify failed:', err && err.message);
      res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : err.message });
    }
  });

  app.post('/api/staking/standing/backers/:backerId/rotate-link',
    authenticateToken, requireAppAdmin, requireRegistered || noop, limiter || noop, async (req, res) => {
      const backerId = Number(req.params.backerId);
      if (!Number.isInteger(backerId) || backerId <= 0) return res.status(400).json({ error: 'Bad backer id' });
      try {
        const r = surface.rotateBackerLink(getDb(), { userId: req.user.id, backerId });
        if (r.status !== 200) return res.status(r.status).json({ error: r.error });
        await saveDatabase();
        console.log(`[backers] link replaced for backer #${backerId} — moved ${JSON.stringify(r.counts)}, roster record ${r.rosterRecord}`);
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, token: r.token, path: `/b/${r.token}`, moved: r.counts, rosterRecord: r.rosterRecord });
      } catch (err) {
        console.error('[backers] rotate-link failed:', err && err.message);
        res.status(500).json({ error: 'Something went wrong. Please try again.' });
      }
    });
}

module.exports = { mountRoutes };
