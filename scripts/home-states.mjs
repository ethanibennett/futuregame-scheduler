// The home's NUMBERS in the states a scratch account does not show by itself, for the two WebKit
// guards (check-control-centring.mjs, check-text-clipping.mjs). Each state is staged by answering
// the home's own requests in the page (Playwright routes): nothing is written to the server the
// guard checks, so it is safe on :3001 too. stageHome(page, kind) installs the routes and returns
// the function that removes them; reload the page after staging (the home asks at load).
//
//   trip    a trip covering today, with a cash session played inside it and a tagged expense: the
//           period block in trip mode (the trip page's own tripPnl), its long name truncating in
//           the header (admins; everyone else never asks for trips)
//   series  the schedule's rows within 6 days of today tagged as one feed series with a long title:
//           the block in series mode, with "Still on your schedule"
//   edge    the bankroll rule's longest pill ('Move up to $2,000+'), and an empty month: no ledger
//           rows and no results, so the net and the comparison are dashes with their reasons and the
//           Last result card is its empty state; the schedule's series tags removed (month mode)
//   empty   nothing on the schedule, nothing in play and no cash session running: Up Next is its one 5r prompt
//           ("Nothing scheduled" over the week's events near the user)
//   noise-progress  the signal-or-noise line under 30 entries: GET /api/analytics answered with a
//           history of 18 entries, so the line is progress ('18 of 30 entries before ...') (admins)
//   noise-cash      the line about cash: two losing timed sessions this month, big enough to move the
//           month's net more than its tournaments, and 40 more timed sessions behind them in the
//           whole ledger, so the hourly rate is judged against its spread (admins)
//   layout-custom   Edit home (utils/home-layout.js): the phone order Bankroll, Up Next, This month,
//           Last result, with To log and Signal or noise switched off; on desktop NOW is Up Next,
//           Last result and NUMBERS Bankroll, This month (the period header states its own scope,
//           the bankroll line no longer right above it on the phone)
//   layout-numbers-empty  Bankroll and This month switched off: on desktop the NUMBERS pane is its
//           3r header and the EDIT prompt
// The layout states answer GET /api/user/home-layout and clear the cached copy (localStorage
// homeLayout:u<id>) on the way in and out, so the next view loads the server's own layout.
// HOME_LAYOUT_PUT: the guards' context-wide answer to PUT /api/user/home-layout (the sheet's
// changes, Reset), echoing the layout back: the guards never write a layout to the server.

const day = (off) => {
  const d = new Date();
  d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const TRIP_ID = 990001;

const LAYOUTS = {
  'layout-custom': { v: 1, sections: [
    { id: 'bankroll', on: true }, { id: 'upnext', on: true }, { id: 'period', on: true }, { id: 'last', on: true },
    { id: 'tolog', on: false }, { id: 'noise', on: false }, { id: 'goals', on: true },
  ] },
  'layout-numbers-empty': { v: 1, sections: [
    { id: 'upnext', on: true }, { id: 'tolog', on: true }, { id: 'last', on: true },
    { id: 'bankroll', on: false }, { id: 'period', on: false }, { id: 'noise', on: true }, { id: 'goals', on: true },
  ] },
};
export const LAYOUT_KINDS = Object.keys(LAYOUTS);
const clearLayoutCache = (p) => p.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('homeLayout:')) localStorage.removeItem(k);
}).catch(() => {});
// For a context: PUT /api/user/home-layout answered in the page, the layout echoed back.
export async function routeHomeLayoutPut(ctx) {
  await ctx.route('**/api/user/home-layout', (r) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    let layout = null;
    try { layout = JSON.parse(r.request().postData() || '{}').layout ?? null; } catch { layout = null; }
    return r.fulfill({ json: { layout: layout ? { ...layout, updatedAt: new Date().toISOString() } : null } });
  });
}

export async function stageHome(p, kind) {
  const patterns = [];
  const on = async (pattern, handler) => { patterns.push(pattern); await p.route(pattern, handler); };
  const edit = (fn) => async (r) => {
    const res = await r.fetch();
    let json = null;
    try { json = await res.json(); } catch { return r.fulfill({ response: res }); }
    await r.fulfill({ response: res, json: fn(json) });
  };
  if (kind === 'trip') {
    const trip = { id: TRIP_ID, name: 'Atlantic City and the Borgata Fall Poker Open run', start_date: day(-4), end_date: day(3),
      bankroll: 'all', note: null, transaction_count: 1, created_at: 'x', updated_at: null };
    await on('**/api/bankrolls/trips', (r) => r.fulfill({ json: { trips: [trip] } }));
    await on(`**/api/bankrolls/trips/${TRIP_ID}`, (r) => r.fulfill({ json: {
      trip, results: [],
      cash_sessions: [{ id: 1, date: day(-2), amount: -553, currency: 'USD', hours: 6.5, label: 'Cash NLH 2/5 · Guard Room', bankroll_id: null }],
      transactions: [{ id: 1, kind: 'expense', category: 'lodging', amount: 640, signed_amount: -640, currency: 'USD', occurred_on: day(-4), trip_id: TRIP_ID }],
    } }));
  } else if (kind === 'series') {
    const lo = day(-6), hi = day(6);
    await on('**/api/my-schedule', edit((rows) => (Array.isArray(rows) ? rows.map((e) => {
      const d = String(e.date || '').slice(0, 10);
      if (e.venue === 'Personal' || Number(e.is_online) || d < lo || d > hi) return e;
      return { ...e, venue: 'Guard Series of Poker Main Festival Championship 2026', property: 'Guard Room', source_pdf: 'mtt-feed',
        event_number: e.event_number || String(e.id) };
    }) : rows)));
  } else if (kind === 'edge') {
    await on('**/api/bankrolls/summary*', edit((j) => {
      const m = j && j.guide && j.guide.byKey && j.guide.byKey.all && j.guide.byKey.all.mtt;
      if (m) Object.assign(m, { signal: 'up', reason: 'covers-next', nextTier: { label: '$2,000–4,999', min: 2000 } });
      return j;
    }));
    await on('**/api/bankrolls/ledger*', edit((j) => ({ ...j, entries: [] })));
    await on('**/api/tracking', edit(() => []));
    await on('**/api/my-schedule', edit((rows) => (Array.isArray(rows) ? rows.map((e) => ({ ...e, source_pdf: null })) : rows)));
  } else if (kind === 'empty') {
    await on('**/api/my-schedule', (r) => r.fulfill({ json: [] }));
    await on('**/api/live-updates/active', (r) => r.fulfill({ json: [] }));
    await on('**/api/cash-sessions/live', (r) => r.fulfill({ json: { session: null, stacks: [], now: new Date().toISOString() } }));
  } else if (kind === 'noise-progress') {
    await on('**/api/analytics*', edit((j) => ({ ...j, totals: { ...(j.totals || {}), entries: 18, events: 14 } })));
  } else if (kind === 'noise-cash') {
    const cashEntry = (date, amount, hours, n) => ({
      date, ts: `${date}T23:00:00.000Z`, amount, currency: 'USD', bankroll_id: null, kind: 'cash_session',
      label: 'Cash NLH 2/5 · Guard Room', ref: { table: 'cash_sessions', id: 980000 + n }, started_at: `${date}T19:00:00.000Z`, hours,
      source: 'cash-sessions', bankroll: 'main', bankroll_currency: 'USD', amount_bankroll: amount, amount_display: amount, fx_display: 1,
    });
    // This month: two sessions, -$5,200 over 8 h (inside the month whatever today is: its 1st, at worst).
    const first = `${day(0).slice(0, 8)}01`;
    const recent = [cashEntry(first, -2600, 4, 1), cashEntry(first, -2600, 4, 2)];
    // The history: 40 sessions of 3-6 h through last year, winning about $40 an hour with a spread.
    const older = Array.from({ length: 40 }, (_, i) => cashEntry(`2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(3 + (i % 20)).padStart(2, '0')}`,
      [620, -380, 410, -150, 900, -700, 260, 50][i % 8], 3 + (i % 4), 10 + i));
    await on('**/api/bankrolls/ledger*', async (r) => {
      const res = await r.fetch();
      let json = null;
      try { json = await res.json(); } catch { return r.fulfill({ response: res }); }
      const whole = !/[?&]from=/.test(r.request().url());
      const add = whole ? [...older, ...recent] : recent;
      await r.fulfill({ response: res, json: { ...json, entries: [...add, ...(json.entries || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) } });
    });
  } else if (LAYOUTS[kind]) {
    const layout = LAYOUTS[kind];
    await clearLayoutCache(p);
    await on('**/api/user/home-layout', (r) => (r.request().method() === 'GET'
      ? r.fulfill({ json: { layout } })
      : r.fallback()));
  } else {
    throw new Error(`unknown home state ${kind}`);
  }
  const layoutState = !!LAYOUTS[kind];
  return async () => {
    for (const pt of patterns) await p.unroute(pt).catch(() => {});
    if (layoutState) await clearLayoutCache(p);
  };
}
