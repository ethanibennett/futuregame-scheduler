// node --test src/utils/__tests__/home-noise.test.mjs   (from vite-app/; or `npm run test:home` from the root)
// The home's signal-or-noise line (utils/home-noise.js, verdict section 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resultsVersion, summaryVersion, cashSpread, normCdf, cashWindowOdds, cashInterval, ciVerdict, oneIn,
  fmtBuyins, fmtHours, windowGame, noiseLine, analyticsPath, MIN_SAMPLE,
} from '../home-noise.js';
import { buildPeriod } from '../home-period.js';
import { fmtMoney } from '../home.js';

const money = (v, signed) => fmtMoney(v, null, { signed: !!signed });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !== ${b}`);

test('versions: a result edit, add or delete changes it; order does not', () => {
  const a = [{ id: 1, tournament_id: 9, num_entries: 1, cashed: 0, cash_amount: 0, date: '2026-10-01', buyin: 300 },
    { id: 2, tournament_id: 8, num_entries: 2, cashed: 1, cash_amount: 900, date: '2026-10-02', buyin: 400 }];
  const v = resultsVersion(a);
  assert.equal(resultsVersion([a[1], a[0]]), v);
  assert.notEqual(resultsVersion([a[0], { ...a[1], cash_amount: 901 }]), v);
  assert.notEqual(resultsVersion([a[0]]), v);
  assert.notEqual(resultsVersion([...a, { id: 3, tournament_id: 7 }]), v);
  assert.equal(resultsVersion(null), resultsVersion([]));
  const s = { all: { count: 4, results: 120, moved: 0, by_source: { tournaments: 100, 'cash-sessions': 20 } } };
  assert.equal(summaryVersion(s), summaryVersion(JSON.parse(JSON.stringify(s))));
  assert.notEqual(summaryVersion({ all: { ...s.all, by_source: { tournaments: 100, 'cash-sessions': 25 } } }), summaryVersion(s));
  assert.equal(summaryVersion(null), '0');
});

// Four timed sessions: 4 h +400, 2 h -100, 5 h +300, 1 h -200 (and one with no hours, one tournament).
const CASH = [
  { source: 'cash-sessions', amount_display: 400, hours: 4 }, { source: 'cash-sessions', amount_display: -100, hours: 2 },
  { source: 'cash-sessions', amount_display: 300, hours: 5 }, { source: 'cash-sessions', amount_display: -200, hours: 1 },
  { source: 'cash-sessions', amount_display: 50, hours: null }, { source: 'tournaments', amount_display: -300 },
];

test('cash spread: hourly over timed sessions, sd per hour with variance growing with hours', () => {
  const s = cashSpread(CASH);
  assert.equal(s.sessions, 4); assert.equal(s.hours, 12); assert.equal(s.profit, 400);
  const mu = 400 / 12;
  close(s.hourly, mu);
  const ss = [[400, 4], [-100, 2], [300, 5], [-200, 1]].reduce((a, [p, h]) => a + (p - mu * h) ** 2 / h, 0);
  close(s.sd, Math.sqrt(ss / 3));
  assert.equal(cashSpread([CASH[0]]).sd, null);
  assert.equal(cashSpread([CASH[5]]), null);
  assert.equal(cashSpread(null), null);
});

test('normal CDF and the cash window odds', () => {
  close(normCdf(0), 0.5, 1e-7); close(normCdf(1.959964), 0.975, 1e-6); close(normCdf(-1), 0.158655, 1e-6);
  assert.equal(normCdf(Infinity), 1); assert.equal(normCdf(-Infinity), 0);
  const s = { hourly: 30, sd: 100, hours: 400, sessions: 80 };
  // 8 h at -$650/h: z = (-5200 - 240) / (100 sqrt 8)
  const o = cashWindowOdds(s, -5200, 8);
  close(o.rate, -650); close(o.pct, normCdf(-5440 / (100 * Math.sqrt(8))));
  close(o.pct + o.pctAbove, 1);
  // Exactly at the rate: half and half.
  close(cashWindowOdds(s, 240, 8).pct, 0.5, 1e-7);
  // No spread: on the point is both sides; off it, one.
  assert.deepEqual([cashWindowOdds({ ...s, sd: 0 }, 240, 8).pct, cashWindowOdds({ ...s, sd: 0 }, 240, 8).pctAbove], [1, 1]);
  assert.deepEqual([cashWindowOdds({ ...s, sd: 0 }, 0, 8).pct, cashWindowOdds({ ...s, sd: 0 }, 0, 8).pctAbove], [1, 0]);
  assert.equal(cashWindowOdds(s, 100, 0), null);
  assert.equal(cashWindowOdds({ ...s, sd: null }, 100, 8), null);
  const ci = cashInterval(s);
  close(ci.low, 30 - 1.959964 * 100 / 20); close(ci.high, 30 + 1.959964 * 100 / 20);
});

test('words: verdicts, odds, buy-ins and hours', () => {
  assert.equal(ciVerdict(-0.22, 0.71), 'includes');
  assert.equal(ciVerdict(0.05, 0.71), 'above');
  assert.equal(ciVerdict(-0.6, -0.1), 'below');
  assert.equal(ciVerdict(0, 0.4), 'includes');
  assert.equal(oneIn(0.81), 'most');
  assert.equal(oneIn(0.5), 'about half of');
  assert.equal(oneIn(0.46), 'about half of');
  assert.equal(oneIn(0.397), 'about 2 in 5');
  assert.equal(oneIn(0.33), 'about 1 in 3');
  assert.equal(oneIn(0.29), 'about 1 in 3');
  assert.equal(oneIn(0.24), 'about 1 in 4');
  assert.equal(oneIn(0.07), 'about 1 in 14');
  assert.equal(oneIn(0.026), 'about 1 in 40');
  assert.equal(oneIn(0.004), 'fewer than 1 in 100');
  assert.equal(oneIn(null), null);
  assert.equal(fmtBuyins(-11.2), '−11 buy-ins');
  assert.equal(fmtBuyins(2.46), '+2.5 buy-ins');
  assert.equal(fmtBuyins(-1), '−1 buy-in');
  assert.equal(fmtBuyins(0.02), '0 buy-ins');
  assert.equal(fmtBuyins(null), '—');
  assert.equal(fmtHours(8), '8 h'); assert.equal(fmtHours(2.54), '2.5 h'); assert.equal(fmtHours(212.4), '212 h');
});

test('the window is about the game that moved its net more', () => {
  const mtt = { events: 9, profit: -3100 }, cash = { sessions: 3, hours: 19, profit: 650 };
  assert.equal(windowGame({ mtt, cash }), 'mtt');
  assert.equal(windowGame({ mtt, cash: { ...cash, profit: -4000 } }), 'cash');
  assert.equal(windowGame({ mtt: { events: 0, profit: 0 }, cash }), 'cash');
  assert.equal(windowGame({ mtt, cash: { sessions: 2, hours: 0, profit: -9000 } }), 'mtt'); // no hours, no rate
  assert.equal(windowGame({ mtt: { events: 0 }, cash: { sessions: 0, hours: 0 } }), null);
  assert.equal(windowGame(null), null);
});

const A = (o = {}) => ({
  totals: { entries: 212, events: 180, roi: 0.12 },
  variance: { roiCI: { low: -0.22, high: 0.71 } },
  window: { events: 14, n: 38, sumBuyins: -11.2, pct: 0.31, pctAbove: 0.72 },
  ...o,
});
const MTT = { mtt: { events: 14, profit: -4200 }, cash: { sessions: 0, hours: 0, profit: 0 } };

test('tournaments: the window against the long run, and the long run against break-even', () => {
  const l = noiseLine({ stats: MTT, analytics: A(), cash: null, money });
  assert.equal(l.kind, 'window'); assert.equal(l.game, 'mtt');
  assert.equal(l.text, '−11 buy-ins over 38 bullets: about 1 in 3 stretches this long do no better at your long-run rate. '
    + 'Its interval over 212 entries, −22% to +71%, includes break-even.');
  // The figures are marked for the full ink colour.
  assert.deepEqual(l.segs.filter((s) => typeof s !== 'string').map((s) => s.em),
    ['−11 buy-ins', '38 bullets', 'about 1 in 3', '212 entries', '−22% to +71%']);
  // A good stretch says how often one does as well; a clear interval says so.
  const g = noiseLine({ stats: MTT, analytics: A({ window: { events: 14, n: 38, sumBuyins: 24, pct: 0.95, pctAbove: 0.06 }, variance: { roiCI: { low: 0.04, high: 0.9 } } }), money });
  assert.equal(g.text, '+24 buy-ins over 38 bullets: about 1 in 17 stretches this long do as well at your long-run rate. '
    + 'Its interval over 212 entries, +4% to +90%, is above break-even.');
});

test('tournaments: under 30 entries it is progress, not a verdict; an empty window states the long run', () => {
  const p = noiseLine({ stats: MTT, analytics: A({ totals: { entries: 18, roi: -0.3 }, window: { events: 4, n: 6, sumBuyins: -6, pct: null, pctAbove: null } }), money });
  assert.equal(p.kind, 'progress');
  assert.equal(p.text, '18 of 30 entries before this can separate skill from luck.');
  const empty = { mtt: { events: 0, profit: 0 }, cash: { sessions: 0, hours: 0, profit: 0 } };
  const e = noiseLine({ stats: empty, analytics: A({ window: { events: 0, n: 0, sumBuyins: null, pct: null } }), money });
  assert.equal(e.kind, 'longrun');
  assert.equal(e.text, 'Your ROI over 212 entries is +12%; its interval, −22% to +71%, includes break-even.');
  // Freerolls only in the window (no buy-in, no figure): the long run.
  assert.equal(noiseLine({ stats: MTT, analytics: A({ window: { events: 2, n: 2, sumBuyins: null, pct: null } }), money }).kind, 'longrun');
  // Under 30 with an empty window: still progress. No history at all: nothing.
  assert.equal(noiseLine({ stats: empty, analytics: A({ totals: { entries: 5 } }), money }).kind, 'progress');
  assert.equal(noiseLine({ stats: empty, analytics: A({ totals: { entries: 0 } }), money }), null);
  // Still loading, or failed: nothing yet.
  assert.equal(noiseLine({ stats: MTT, analytics: null, money }), null);
  assert.equal(noiseLine({ stats: MTT, analytics: false, money }), null);
  assert.equal(MIN_SAMPLE, 30);
});

test('cash: per hour against the long-run spread; progress under 30 sessions', () => {
  const stats = { mtt: { events: 1, profit: -300 }, cash: { sessions: 3, hours: 8, profit: -5200 } };
  const spread = { sessions: 62, hours: 400, profit: 12000, hourly: 30, sd: 100 };
  const c = noiseLine({ stats, analytics: A(), cash: spread, money });
  assert.equal(c.game, 'cash'); assert.equal(c.kind, 'window');
  const z = (-5200 - 240) / (100 * Math.sqrt(8));
  const lo = 30 - 1.959964 * 100 / 20, hi = 30 + 1.959964 * 100 / 20;
  assert.equal(c.text, `−$650/h over 8 h: ${oneIn(normCdf(z))} stretches this long do no better at your long-run rate. `
    + `Its interval over 400 h, ${money(lo, true)} to ${money(hi, true)} an hour, is above break-even.`);
  assert.equal(noiseLine({ stats, analytics: A(), cash: { ...spread, sessions: 12 }, money }).text,
    '12 of 30 sessions before this can separate skill from luck.');
  // Waiting for the cash history: nothing yet. It failed: the window's tournaments instead.
  assert.equal(noiseLine({ stats, analytics: A(), cash: null, money }), null);
  assert.equal(noiseLine({ stats, analytics: A(), cash: false, money }).game, 'mtt');
});

test('the request for a window, and buildPeriod hands the window over', () => {
  assert.equal(analyticsPath({ from: '2026-10-01', to: '2026-10-12', venue: null, scope: 'all' }, 'USD'),
    '/analytics?currency=USD&from=2026-10-01&to=2026-10-12');
  assert.equal(analyticsPath({ from: '2026-10-01', to: '2026-10-12', venue: 'Borgata Fall Poker Open 2026', scope: '7' }, 'EUR'),
    '/analytics?currency=EUR&from=2026-10-01&to=2026-10-12&venue=Borgata%20Fall%20Poker%20Open%202026&bankroll=7');
  const ledger = [
    { date: '2026-10-03', source: 'tournaments', kind: 'result', amount_display: -300, cost: 300, cash: 0, units: 1, fx: 1 },
    { date: '2026-10-05', source: 'cash-sessions', kind: 'result', amount_display: 420, hours: 6 },
  ];
  const m = buildPeriod({ today: '2026-10-12', isAdmin: true, currency: 'USD', money, ledger, results: [], schedule: [] });
  assert.deepEqual(m.window, { from: '2026-10-01', to: '2026-10-12', venue: null, scope: 'all' });
  assert.equal(m.stats.mtt.events, 1); assert.equal(m.stats.cash.sessions, 1); assert.equal(m.stats.cash.hours, 6);
  // A trip's window is the trip's own dates, the span its figures (the trip page's) cover.
  const t = buildPeriod({ today: '2026-10-12', isAdmin: true, currency: 'USD', money, ledger, results: [], schedule: [],
    trip: { id: 3, name: 'AC', start_date: '2026-10-04', end_date: '2026-10-20', bankroll: 'main' },
    tripData: { results: [], cash_sessions: [{ amount: 420, currency: 'USD', hours: 6 }], transactions: [] } });
  assert.deepEqual(t.window, { from: '2026-10-04', to: '2026-10-20', venue: null, scope: 'main' });
  assert.equal(t.stats.cash.sessions, 1); assert.equal(t.stats.cash.hours, 6);
});
