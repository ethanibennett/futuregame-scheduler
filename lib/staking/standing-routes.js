'use strict';
/*
 * Routes under /api/staking/standing (docs/bankroll-merge.md §6.10). Phase 2 mounts two:
 *
 *   GET  /api/staking/standing/parity                       the owner only (§7.6)
 *   POST /api/staking/standing/backers/:backerId/rotate-link  "New link" (§7.5), scoped to req.user.id
 *
 * Both sit behind the /api/staking admin gate that server.js applies to the whole prefix; they
 * repeat authenticateToken and requireAppAdmin the way the other staking routes do. The standing
 * agreements' own routes (agreements, stakes, exclusions, events, preview, drift) are later phases.
 *
 * Neither route logs or returns a token the caller did not just ask for: parity names backers by
 * id and returns no token; rotate-link returns the NEW link to the owner who asked for it and
 * logs only counts.
 */
const surface = require('../backer-surface');

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireAppAdmin, requireRegistered, limiter, getOwnerId } = deps;
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
