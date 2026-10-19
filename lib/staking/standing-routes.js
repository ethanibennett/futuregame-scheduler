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
const live = require('./live');

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireAppAdmin, requireRegistered, limiter, getOwnerId, getRates, deliverShare, notifySettle } = deps;
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

  // The owner's Settled press on a backer's card (Bankroll > Backers; lib/staking/backer-settle.js).
  // :id is the card's id (the roster record's), never a token. { action: 'confirm' | 'undo', amountCents }.
  app.post('/api/staking/standing/backers/:id/settle', authenticateToken, requireAppAdmin, requireRegistered || noop, limiter || noop, async (req, res) => {
    const owner = getOwnerId();
    if (owner == null || Number(req.user.id) !== Number(owner)) return res.status(403).json({ error: 'Forbidden' });
    try {
      res.set('Cache-Control', 'no-store');
      const db = getDb();
      const token = surface.tokenForViewId(db, req.params.id);
      if (!token) return res.status(404).json({ error: 'No such backer' });
      const out = surface.settleOnPage(db, token, 'owner', req.body, { ownerId: owner });
      if (out.status === 200) {
        await saveDatabase();
        if (out.body.completed) console.log('[backers] a settlement was confirmed by both sides (owner last)');
        if (notifySettle) notifySettle(token, out.notice);
      }
      res.status(out.status).json(out.body);
    } catch (err) {
      console.error('[backers] settle failed:', err && err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // The Notify tap (lib/staking/notify.js; docs/bankroll-merge.md "Notify tap"): one result's
  // backer shares. { refTable: 'tracking_entries'|'cash_sessions', refId, preview: bool, confirm? }.
  // preview (the default) computes the Backers block and writes nothing. preview: false records
  // every share not sent yet and messages those backers once (only where delivery is on); a second
  // tap on an unchanged result sends nothing and says so (already: true). A share that needs the
  // owner's second confirm (the dashboard sent that backer a share on the same date, or a series
  // agreement covers the tournament) is a 409 with the block until confirm: true; skip: [keys]
  // leaves those backers unsent this time (the confirm's "Send the others"). The owner's alone,
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
      // Phase 7: the money state gates the tap (§1.1 Q1). Unset is on; an explicit 'off' refuses a
      // commit, and the preview says so.
      const state = live.moneyState(db, owner);
      if (b.preview !== false) {
        const r = notify.preview(db, ctx);
        return res.status(r.status).json(r.status === 200 ? { ...r.body, posting: state.posting, cutover: state.cutover } : r.body);
      }
      if (!state.notify) return res.status(409).json({ error: 'Posting is switched off (the money cutover). Nothing was recorded.', posting: 'off' });
      const skip = Array.isArray(b.skip) ? b.skip.slice(0, 200).map(String) : [];
      const answers = b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers) ? b.answers : null;
      const w = notify.commitWrite(db, { ...ctx, confirm: b.confirm === true, skip, answers, now: Date.now() });
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

  // ── Phase 7: standing shares live (lib/staking/live.js; docs/bankroll-merge.md "Phase 7: as built") ──
  // The owner-only routes (the roster is one person's): the money state and its switch, exclusions,
  // a dashboard share's recalc and remove, drift, and the unsaved-result preview. The agreements'
  // own routes are scoped to req.user.id, as every staking route is. No token, no event id, no
  // phone number in any answer; a link is shown by its last four characters, and a NEW link is
  // returned once, to the owner who made it.
  const ownerOnly = (req, res) => {
    const owner = getOwnerId();
    if (owner == null || Number(req.user.id) !== Number(owner)) { res.status(403).json({ error: 'Forbidden' }); return null; }
    return owner;
  };
  const refOf = (b) => {
    const refId = Number(b && b.refId);
    if (!notify.REF_TABLES.includes(b && b.refTable) || !Number.isSafeInteger(refId) || refId <= 0) return null;
    return { table: b.refTable, id: refId };
  };
  const ratesNow = async () => { const c = getRates ? await getRates() : null; return c && c.rates; };
  const wrap = (fn) => async (req, res) => {
    try { res.set('Cache-Control', 'no-store'); await fn(req, res); } catch (err) {
      const status = err && Number.isInteger(err.status) ? err.status : 500;
      if (status === 500) console.error('[standing] route failed:', err && err.message);
      res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : err.message });
    }
  };
  const send = async (res, out, { save = true } = {}) => {
    if (out.status < 300 && save) await saveDatabase();
    res.status(out.status).json(out.body);
  };
  const wr = [authenticateToken, requireAppAdmin, requireRegistered || noop, limiter || noop];
  const rd = [authenticateToken, requireAppAdmin];

  // The money state and the cutover switch (§11.4): { posting?, postingSince?, cutover? }.
  app.get('/api/bankrolls/money/cutover', ...rd, wrap((req, res) => {
    const owner = ownerOnly(req, res); if (owner == null) return;
    res.json({ state: live.moneyState(getDb(), owner) });
  }));
  app.put('/api/bankrolls/money/cutover', ...wr, wrap(async (req, res) => {
    const owner = ownerOnly(req, res); if (owner == null) return;
    const out = live.setCutover(getDb(), owner, req.body);
    if (out.status === 200) console.log(`[staking] money state: posting ${out.body.state.posting || 'unset'}, cutover ${out.body.state.cutover}${out.body.moved ? `, ${out.body.moved} imported agreement(s) moved to ${out.body.state.postingSince}` : ''}`);
    await send(res, out);
  }));

  // Exclusions: { refTable, refId, key } excludes that backer from that result (its posted share is
  // voided); DELETE with the same body undoes the exclusion (nothing is re-posted: tap Notify).
  const exclusion = (undo) => wrap(async (req, res) => {
    const owner = ownerOnly(req, res); if (owner == null) return;
    const ref = refOf(req.body);
    if (!ref) return res.status(400).json({ error: 'refTable must be tracking_entries or cash_sessions, refId a positive id' });
    if (req.body.key == null) return res.status(400).json({ error: 'key is required' });
    const out = live.exclude(getDb(), { ownerId: owner, ref, key: req.body.key, undo, source: surface.pageSource(), rates: await ratesNow() });
    if (out.status === 200) console.log(`[staking] ${undo ? 'included' : 'excluded'} a backer on ${ref.table} #${ref.id}`);
    await send(res, out);
  });
  app.post('/api/staking/standing/exclusions', ...wr, exclusion(false));
  app.delete('/api/staking/standing/exclusions', ...wr, exclusion(true));

  // A dashboard-era share linked to a result: Recalculate (a ledger share at its own pct) or Remove.
  for (const action of ['recalc', 'remove']) {
    app.post(`/api/staking/standing/events/${action}`, ...wr, wrap(async (req, res) => {
      const owner = ownerOnly(req, res); if (owner == null) return;
      const ref = refOf(req.body);
      if (!ref) return res.status(400).json({ error: 'refTable must be tracking_entries or cash_sessions, refId a positive id' });
      if (req.body.key == null) return res.status(400).json({ error: 'key is required' });
      const out = live.dashboardShare(getDb(), { ownerId: owner, ref, key: req.body.key, action, source: surface.pageSource(), rates: await ratesNow() });
      if (out.status === 200) console.log(`[staking] ${action} of a dashboard share on ${ref.table} #${ref.id}`);
      await send(res, out);
    }));
  }

  // Drift: the ledger shares a fresh derivation would change (a feed edit moved a result under
  // them). Nothing applies by itself; POST /drift/apply { refTable, refId } follows one result.
  app.get('/api/staking/standing/drift', ...rd, wrap(async (req, res) => {
    const owner = ownerOnly(req, res); if (owner == null) return;
    res.json(live.drift(getDb(), { ownerId: owner, source: surface.pageSource(), rates: await ratesNow() }));
  }));
  app.post('/api/staking/standing/drift/apply', ...wr, wrap(async (req, res) => {
    const owner = ownerOnly(req, res); if (owner == null) return;
    const ref = refOf(req.body);
    if (!ref) return res.status(400).json({ error: 'refTable must be tracking_entries or cash_sessions, refId a positive id' });
    const out = live.applyDrift(getDb(), { ownerId: owner, ref, source: surface.pageSource(), rates: await ratesNow() });
    if (out.status === 200 && (out.body.revised || out.body.voided)) console.log(`[staking] drift applied on ${ref.table} #${ref.id}: ${out.body.revised} revised, ${out.body.voided} voided`);
    await send(res, out, { save: out.status === 200 && !!(out.body.revised || out.body.voided) });
  }));

  // The cuts for figures not saved yet ("Posts to backers: +$248 (20%)").
  app.get('/api/staking/standing/preview', ...rd, wrap(async (req, res) => {
    const owner = ownerOnly(req, res); if (owner == null) return;
    const out = live.previewUnsaved(getDb(), { ownerId: owner, query: req.query, source: surface.pageSource(), rates: await ratesNow() });
    res.status(out.status).json(out.body);
  }));

  // The standing agreements (§6.10), the player's own.
  app.get('/api/staking/standing', ...rd, wrap((req, res) => { res.json(live.listAgreements(getDb(), req.user.id)); }));
  app.post('/api/staking/standing', ...wr, wrap(async (req, res) => {
    const out = live.createAgreement(getDb(), req.user.id, req.body);
    if (out.status === 201) console.log(`[staking] standing agreement #${out.body.id} created for backer #${out.body.backerId}${out.body.link ? ' with a new link' : ''}`);
    await send(res, out);
  }));
  app.put('/api/staking/standing/backers/:backerId/delivery', ...wr, wrap(async (req, res) => {
    const backerId = Number(req.params.backerId);
    if (!Number.isInteger(backerId) || backerId <= 0) return res.status(400).json({ error: 'Bad backer id' });
    await send(res, live.setDelivery(getDb(), req.user.id, backerId, req.body));
  }));
  const idOf = (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Bad agreement id' }); return null; }
    return id;
  };
  app.put('/api/staking/standing/:id', ...wr, wrap(async (req, res) => {
    const id = idOf(req, res); if (id == null) return;
    await send(res, live.updateAgreement(getDb(), req.user.id, id, req.body));
  }));
  app.post('/api/staking/standing/:id/stakes', ...wr, wrap(async (req, res) => {
    const id = idOf(req, res); if (id == null) return;
    const out = live.setStakes(getDb(), req.user.id, id, req.body, { source: surface.pageSource(), rates: await ratesNow() });
    if (out.status === 200 && !out.body.preview) console.log(`[staking] stakes of agreement #${id} set (${out.body.mode}); ${out.body.count || 0} share(s) re-derived`);
    await send(res, out, { save: out.status === 200 && !out.body.preview });
  }));
  app.get('/api/staking/standing/:id/events', ...rd, wrap((req, res) => {
    const id = idOf(req, res); if (id == null) return;
    const out = live.agreementEvents(getDb(), req.user.id, id, { source: req.query.source, since: req.query.since });
    res.status(out.status).json(out.body);
  }));

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
