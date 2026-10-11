'use strict';
/*
 * Bankroll management — BETA, app admins only (behind the /api/bankrolls gate). Three things a
 * bankroll tracker usually has, computed from the caller's own ledger and results:
 *
 *   RULES  per bankroll (and for "All"), one rule per game type, each a number of buy-ins:
 *            MTT   the roll should hold N buy-ins of the event: max buy-in per entry = roll / N
 *            cash  the roll should hold N buy-ins of the game: max buy-in for a stake = roll / N
 *          The DEFAULTS are 100 (MTT) and 30 (cash). They are defaults — a starting point the UI
 *          labels as such — not advice; every player sets their own.
 *          The GUIDE turns a rule into a signal from the player's own recent play:
 *            'down'  the average buy-in of the last RECENT_N tournament entries is above the cap
 *                    (or the roll is at or below zero)
 *            'up'    the cap reaches the next buy-in tier above that average (the tiers are
 *                    lib/analytics.js BUYIN_BANDS, cut in USD)
 *            'hold'  neither; null when there are fewer than MIN_RECENT recent entries to judge by
 *   GOALS  per bankroll: a monthly or yearly target for profit (money) or volume (events and
 *          sessions played). Progress is computed client-side from the ledger.
 *   RISK   a risk-of-ruin estimate for tournaments from the player's own results (riskOfRuin()).
 *
 * Storage: bankroll_prefs, one JSON row per (user, bankroll key) — key 'all', 'main' or the id.
 */

const analytics = require('./analytics');
const bankrolls = require('./bankrolls');
const ledgerLib = require('./bankroll-ledger');

const DEFAULT_RULES = Object.freeze({ mtt: { buyins: 100 }, cash: { buyins: 30 } });
const RECENT_N = 20;
const MIN_RECENT = 5;
const MAX_GOALS = 6;
// Risk of ruin is not offered below this many tournament entries. See riskOfRuin().
const RISK_MIN_ENTRIES = 100;

function one(db, sql, params = []) {
  const s = db.prepare(sql);
  try { s.bind(params); return s.step() ? s.getAsObject() : null; } finally { s.free(); }
}
function rows(db, sql, params = []) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS bankroll_prefs (
    user_id INTEGER NOT NULL,
    bankroll_key TEXT NOT NULL,
    prefs TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, bankroll_key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
}

// ── Prefs ────────────────────────────────────────────────────────────────────────────────
function cleanRules(raw, base) {
  const out = { mtt: { ...base.mtt }, cash: { ...base.cash } };
  if (raw === undefined) return { value: out };
  if (!raw || typeof raw !== 'object') return { error: 'rules must be an object' };
  for (const g of ['mtt', 'cash']) {
    if (raw[g] === undefined) continue;
    const n = Number(raw[g] && raw[g].buyins);
    if (!Number.isInteger(n) || n < 1 || n > 10000) return { error: `${g} buy-ins must be a whole number from 1 to 10,000` };
    out[g] = { buyins: n };
  }
  return { value: out };
}
function cleanGoals(raw, base) {
  if (raw === undefined) return { value: base };
  if (!Array.isArray(raw)) return { error: 'goals must be a list' };
  if (raw.length > MAX_GOALS) return { error: `At most ${MAX_GOALS} goals` };
  const out = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') return { error: 'Bad goal' };
    if (g.period !== 'month' && g.period !== 'year') return { error: 'A goal is monthly or yearly' };
    if (g.metric !== 'profit' && g.metric !== 'volume') return { error: 'A goal is for profit or volume' };
    const t = Number(g.target);
    if (!Number.isFinite(t) || t <= 0 || t > 1e10) return { error: 'A goal needs a target above 0' };
    const id = /^[A-Za-z0-9_-]{1,20}$/.test(String(g.id || '')) ? String(g.id) : Math.random().toString(36).slice(2, 10);
    out.push({ id, period: g.period, metric: g.metric, target: g.metric === 'volume' ? Math.round(t) : Math.round(t) });
  }
  return { value: out };
}

function readPrefs(db, userId) {
  const map = {};
  for (const r of rows(db, 'SELECT bankroll_key, prefs FROM bankroll_prefs WHERE user_id = ?', [userId])) {
    try { map[r.bankroll_key] = JSON.parse(r.prefs); } catch (_) { /* a broken row reads as defaults */ }
  }
  return map;
}
/** Stored prefs merged over the defaults; `custom` says which rules the player has set. */
function prefsFor(map, key) {
  const p = map[String(key)] || {};
  const rules = cleanRules(p.rules, DEFAULT_RULES).value || { mtt: { ...DEFAULT_RULES.mtt }, cash: { ...DEFAULT_RULES.cash } };
  const custom = { mtt: !!(p.rules && p.rules.mtt), cash: !!(p.rules && p.rules.cash) };
  return { rules, custom, goals: Array.isArray(p.goals) ? p.goals : [] };
}

// ── The rules guide ──────────────────────────────────────────────────────────────────────
/**
 * Pure. balance and recent buy-ins in the roll's currency; usdToRoll converts a USD amount into
 * it (the tiers are cut in USD). Returns the cap and the signal described in the header.
 */
function mttGuide({ balance, buyins, recent, usdToRoll = (v) => v, rollToUsd = (v) => v }) {
  const cap = balance > 0 ? balance / buyins : 0;
  const n = recent.length;
  const avg = n ? recent.reduce((s, v) => s + v, 0) / n : null;
  const out = { buyins, percent: 100 / buyins, cap, recentAvg: avg, recentN: n, signal: null, tier: null, nextTier: null };
  if (n < MIN_RECENT) return { ...out, reason: 'few' };
  const band = analytics.BUYIN_BANDS.find((b) => rollToUsd(avg) >= b.min && rollToUsd(avg) < b.max) || null;
  const idx = band ? analytics.BUYIN_BANDS.indexOf(band) : -1;
  const next = idx >= 0 ? analytics.BUYIN_BANDS[idx + 1] || null : null;
  out.tier = band ? { label: band.label } : null;
  if (next) out.nextTier = { label: next.label, min: usdToRoll(next.min) };
  if (balance <= 0 || avg > cap) return { ...out, signal: 'down', reason: balance <= 0 ? 'empty' : 'over' };
  if (next && cap >= usdToRoll(next.min)) return { ...out, signal: 'up', reason: 'covers-next' };
  return { ...out, signal: 'hold', reason: 'within' };
}

/**
 * Per key ('all', 'main', each bankroll id): balance, rules, the MTT guide and the cash cover.
 * summary = bankroll-ledger summarise(); entries = collect()'s sorted entries (every bankroll).
 */
function guideFor(db, userId, { summary, entries, currency, rates }) {
  const map = readPrefs(db, userId);
  const conv = (v, from, to) => analytics.convert(v, from, to, rates);
  const recentFor = (inScope, cur) => {
    const out = [];
    for (let i = entries.length - 1; i >= 0 && out.length < RECENT_N; i--) {
      const e = entries[i];
      if (e.source !== 'tournaments' || !(e.buyin_per_entry > 0) || !inScope(e)) continue;
      out.push(conv(e.buyin_per_entry, e.currency, cur));
    }
    return out;
  };
  const one = (key, balance, cur, inScope) => {
    const p = prefsFor(map, key);
    const mtt = mttGuide({
      balance, buyins: p.rules.mtt.buyins, recent: recentFor(inScope, cur),
      usdToRoll: (v) => conv(v, 'USD', cur), rollToUsd: (v) => conv(v, cur, 'USD'),
    });
    return {
      key, currency: cur, balance, rules: p.rules, custom: p.custom, goals: p.goals,
      mtt, cash: { buyins: p.rules.cash.buyins, cap: balance > 0 ? balance / p.rules.cash.buyins : 0 },
    };
  };
  const out = { all: one('all', summary.all.balance, currency, () => true) };
  for (const b of summary.bankrolls) {
    const id = b.id === bankrolls.MAIN ? null : b.id;
    out[b.id] = one(b.id, b.balance, b.currency, (e) => e.bankroll_id === id);
  }
  return { defaults: DEFAULT_RULES, recentN: RECENT_N, minRecent: MIN_RECENT, byKey: out };
}

// ── Risk of ruin ─────────────────────────────────────────────────────────────────────────
/**
 * Risk of ruin for tournaments — the classic DIFFUSION (Brownian-motion) approximation:
 *
 *     RoR = exp(-2 * mu * B / sigma^2)        (mu <= 0  =>  RoR = 100%)
 *
 *   mu, sigma  mean and sample standard deviation of the return PER ENTRY, in buy-ins — the same
 *              per-entry sample lib/analytics.js uses for "std dev per entry" (perEntryReturns:
 *              a row of k bullets and one cash is one bullet worth (cash - B)/B and k-1 bullets
 *              worth -1; freerolls left out)
 *   B          the bankroll in average buy-ins: balance / (total buy-ins / entries)
 *
 * It is the probability of EVER losing the whole roll, over an unlimited number of entries,
 * if the player keeps playing the same average buy-in at the same edge and never tops up or
 * withdraws. Assumptions, all of which MTTs strain:
 *   1. entries are independent and identically distributed — one stake, one field, one edge;
 *   2. mu and sigma are the TRUE values — they are estimates, and with tournament variance the
 *      estimate of mu is very loose, which is why a second figure is given at the low end of the
 *      ROI's 95% bootstrap interval (analytics.roiBootstrapCI), and why nothing is shown below
 *      RISK_MIN_ENTRIES entries;
 *   3. the diffusion limit — returns treated as small, normal-ish steps. Tournament returns are a
 *      long right tail over a floor of -1 buy-in; the approximation is the standard one for
 *      poker but it is still an approximation, and the sample sees no tail it has not reached;
 *   4. no rebuying the roll, no withdrawals, no moving down after losses (moving down when the
 *      roll falls lowers the real risk well below this figure).
 * Descriptive: what the player's own numbers imply under that model, not a recommendation.
 *
 * rows = analytics normaliseRow() rows (display currency); balance in the same currency.
 */
function riskOfRuin(rows, balance) {
  const per = analytics.perEntryReturns(rows);
  const ms = analytics.meanSd(per.xs);
  const events = rows.length;
  const base = { method: 'diffusion', minEntries: RISK_MIN_ENTRIES, n: ms.n, events };
  if (ms.n < RISK_MIN_ENTRIES || ms.sd == null || !(ms.sd > 0)) return { ...base, status: 'insufficient' };
  let cost = 0, bullets = 0;
  for (const r of rows) if (r.buyin > 0) { cost += r.cost; bullets += r.bullets; }
  const avgBuyin = bullets ? cost / bullets : 0;
  if (!(balance > 0) || !(avgBuyin > 0)) return { ...base, status: 'empty', balance, avgBuyin };
  const B = balance / avgBuyin;
  const v = ms.sd * ms.sd;
  const ror = (mu) => (mu <= 0 ? 1 : Math.exp(-2 * mu * B / v));
  const need = (mu, p) => (mu <= 0 ? null : -Math.log(p) * v / (2 * mu)); // buy-ins for a target RoR
  const ci = analytics.roiBootstrapCI(rows);
  return {
    ...base, status: 'ok',
    mean: ms.mean, sd: ms.sd, avgBuyin, balance, bankrollBuyins: B,
    ror: ror(ms.mean),
    ci: ci ? { low: ci.low, high: ci.high, level: ci.level } : null,
    rorAtLow: ci ? ror(ci.low) : null,
    buyinsFor: { p5: need(ms.mean, 0.05), p1: need(ms.mean, 0.01) },
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────
/** deps: { getDb, saveDatabase, authenticateToken, requireAppAdmin, currencies, fetchExchangeRates, sourcesDir? } */
function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireAppAdmin, fetchExchangeRates } = deps;
  const CURRENCIES = new Set(deps.currencies || ['USD']);
  const loaded = ledgerLib.loadSources(deps.sourcesDir);
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res, getDb(), req.user.id); } catch (err) {
      console.error('[bankroll-mgmt]', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  const fail = (res, status, error) => res.status(status).json({ error });
  // 'all' | 'main' | own id -> the stored key, or null when not the caller's.
  const keyFor = (db, uid, raw) => {
    if (raw === 'all' || raw === 'main') return raw;
    const ref = bankrolls.parseBankrollRef(raw);
    if (ref.kind !== 'id') return null;
    return one(db, 'SELECT id FROM bankrolls WHERE id = ? AND user_id = ?', [ref.id, uid]) ? String(ref.id) : null;
  };

  app.get('/api/bankrolls/prefs', authenticateToken, requireAppAdmin, wrap((req, res, db, uid) => {
    const map = readPrefs(db, uid);
    const keys = ['all', ...bankrolls.listBankrolls(db, uid).map((b) => String(b.id))];
    const prefs = {};
    for (const k of keys) prefs[k] = prefsFor(map, k);
    res.json({ defaults: DEFAULT_RULES, prefs });
  }));

  // { rules?: { mtt?: { buyins }, cash?: { buyins } }, goals?: [...], reset?: ['mtt'|'cash'] }
  app.put('/api/bankrolls/prefs/:key', authenticateToken, requireAppAdmin, wrap(async (req, res, db, uid) => {
    const key = keyFor(db, uid, req.params.key);
    if (!key) return fail(res, 404, 'Bankroll not found');
    const body = req.body || {};
    const stored = readPrefs(db, uid)[key] || {};
    const storedRules = stored.rules && typeof stored.rules === 'object' ? { ...stored.rules } : {};
    const rulesIn = body.rules === undefined ? undefined : body.rules;
    const r = cleanRules(rulesIn, { mtt: storedRules.mtt || DEFAULT_RULES.mtt, cash: storedRules.cash || DEFAULT_RULES.cash });
    if (r.error) return fail(res, 400, r.error);
    const g = cleanGoals(body.goals, Array.isArray(stored.goals) ? stored.goals : []);
    if (g.error) return fail(res, 400, g.error);
    // Only rules the player set are stored, so a default stays a default (and can change later).
    const nextRules = { ...storedRules };
    if (rulesIn && rulesIn.mtt !== undefined) nextRules.mtt = r.value.mtt;
    if (rulesIn && rulesIn.cash !== undefined) nextRules.cash = r.value.cash;
    for (const k of Array.isArray(body.reset) ? body.reset : []) if (k === 'mtt' || k === 'cash') delete nextRules[k];
    const next = { rules: nextRules, goals: g.value };
    db.run(`INSERT INTO bankroll_prefs (user_id, bankroll_key, prefs, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, bankroll_key) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`,
      [uid, key, JSON.stringify(next), new Date().toISOString()]);
    await saveDatabase();
    res.json({ key, ...prefsFor({ [key]: next }, key) });
  }));

  // GET /api/bankrolls/risk?bankroll=&currency= — tournaments only (the per-entry sample).
  app.get('/api/bankrolls/risk', authenticateToken, requireAppAdmin, wrap(async (req, res, db, uid) => {
    const f = bankrolls.filterFromQuery(db, uid, req.query.bankroll, 'te.bankroll_id');
    if (f.error) return fail(res, f.status, f.error);
    const currency = String(req.query.currency || 'USD').toUpperCase();
    if (!CURRENCIES.has(currency)) return fail(res, 400, 'Unsupported currency');
    const { rates } = await fetchExchangeRates();
    const raw = rows(db, `SELECT te.*, t.event_name, t.date, t.time, t.buyin, t.game_variant, t.venue,
        t.property, t.total_entries, t.is_online, t.site
      FROM tracking_entries te JOIN tournaments t ON te.tournament_id = t.id
      WHERE te.user_id = ?${f.sql}`, [uid, ...f.params]);
    const norm = raw.map((r) => analytics.normaliseRow(r, currency, rates));
    const scope = f.ref.kind === 'all' ? 'all' : f.ref.kind === 'main' ? 'main' : f.ref.id;
    const { entries } = ledgerLib.collect(db, uid, { bankroll: scope }, loaded);
    const led = ledgerLib.runningBalances(entries, { bankrollList: bankrolls.listBankrolls(db, uid), scope, currency, rates });
    res.json({ currency, bankroll: scope, ...riskOfRuin(norm, led.closing.total_display) });
  }));
}

module.exports = {
  migrate, mountRoutes, guideFor, mttGuide, riskOfRuin, prefsFor, readPrefs, cleanRules, cleanGoals,
  DEFAULT_RULES, RECENT_N, MIN_RECENT, RISK_MIN_ENTRIES, MAX_GOALS,
};
