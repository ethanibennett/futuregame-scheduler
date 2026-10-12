// The home's NUMBERS in the states a scratch account does not show by itself, for the two WebKit
// guards (check-control-centring.mjs, check-text-clipping.mjs). Each state is staged by answering
// the home's own requests in the page (Playwright routes): nothing is written to the server the
// guard checks, so it is safe on :3001 too. stageHome(page, kind) installs the routes and returns
// the function that removes them; reload the page after staging (the home asks at load).
//
//   trip    a trip covering today, with a tagged expense: the period block in trip mode, its long
//           name truncating in the header (admins; everyone else never asks for trips)
//   series  the schedule's rows within 6 days of today tagged as one feed series with a long title:
//           the block in series mode, with "Still on your schedule"
//   edge    the bankroll rule's longest pill ('Move up to $2,000+'), and an empty month: no ledger
//           rows and no results, so the net and the comparison are dashes with their reasons and the
//           Last result card is its empty state; the schedule's series tags removed (month mode)

const day = (off) => {
  const d = new Date();
  d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const TRIP_ID = 990001;

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
  } else {
    throw new Error(`unknown home state ${kind}`);
  }
  return async () => { for (const pt of patterns) await p.unroute(pt).catch(() => {}); };
}
