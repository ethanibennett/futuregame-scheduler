// The Backers block on a result (vite-app components/BackerNotify.jsx, the Notify tap) in the
// states a scratch account does not hold by itself, for the two WebKit guards
// (check-control-centring.mjs, check-text-clipping.mjs). Each is staged by answering the block's own
// request in the page (a Playwright route on POST /api/staking/standing/notify), so a guard NEVER
// notifies a backer or writes a share: a commit (preview: false) reaching a staged route is answered
// here with a refusal and is never forwarded. The real answer (the seed's backers, unstaged) is the
// "previewed" state.
//
//   sent     every backer sent ("Sent Oct 14"), the first moved by a later edit ("· Updated");
//            no Notify button, the "an edit updates their pages" note
//   warning  two backers not sent, the first with both warnings (a dashboard share on the same date,
//            a series agreement on the event): Notify opens the confirm, "Send anyway" | "Cancel"
//   none     no backer staked: "No backers staked in <game>."
//   long     long names, a long series title and big figures, so every truncating line truncates
//
// stageNotify(page, kind) installs the route and returns the function that removes it. Open the
// view after staging (the block asks when it mounts).

const NOTIFY = '**/api/staking/standing/notify';

function fixture(kind, result) {
  const r = result || { refTable: 'tracking_entries', refId: 1, kind: 'tournament', date: '2026-10-12', game: 'NLH MTT', venue: 'Borgata', hours: 0, currency: 'USD', nativeCents: -120000, resultCents: -120000, rate: 1 };
  const res = r.resultCents;
  const at = Date.now() - 3 * 3600e3;
  const base = { result: r, rosterSize: 4, delivery: 'off' };
  const backer = (key, name, pct, extra = {}) => ({
    key, name, pct, shareCents: Math.round(res * pct / 100), resultCents: res,
    status: 'new', sentAt: null, sentShareCents: null, updated: false, warnings: [], ...extra,
  });
  if (kind === 'none') return { ...base, backers: [], pending: 0, sent: 0, needsConfirm: false, state: 'none' };
  if (kind === 'sent') {
    const backers = [
      backer('demo-empty', 'Priya Raman', 15, { status: 'sent', sentAt: at, sentShareCents: Math.round(res * 0.12), updated: true }),
      backer('demo-two', 'Mo Chen', 10, { status: 'sent', sentAt: at }),
    ].map((b) => (b.sentShareCents == null ? { ...b, sentShareCents: b.shareCents } : b));
    return { ...base, backers, pending: 0, sent: 2, needsConfirm: false, state: 'sent' };
  }
  if (kind === 'warning') {
    const backers = [
      backer('demo-two', 'Mo Chen', 10, { warnings: [
        { kind: 'dashboard', date: r.date, game: '5/10 NLH', venue: 'Maryland Live! Casino at Arundel Mills', shareCents: -18700 },
        { kind: 'series', series: ['Borgata Fall Poker Open'] },
      ] }),
      backer('demo-empty', 'Priya Raman', 15),
    ];
    return { ...base, backers, pending: 2, sent: 0, needsConfirm: true, state: 'preview' };
  }
  // long
  const big = { ...r, resultCents: 123456700, game: r.kind === 'cash' ? '25/50/100 PLO6 8/b' : "Dealer's choice MTT" };
  const b2 = (key, name, pct, extra) => ({ ...backer(key, name, pct, extra), resultCents: big.resultCents, shareCents: Math.round(big.resultCents * pct / 100) });
  return {
    ...base, result: big,
    backers: [
      b2('l1', 'Bartholomew Featherstonehaugh-Montgomery the Third', 33.33, { warnings: [
        { kind: 'dashboard', date: r.date, game: '25/50/100 Pot-Limit Omaha Hi-Lo Eight or Better', venue: 'x', shareCents: -9876500 },
        { kind: 'series', series: ['The Borgata Winter Poker Open Championship Series', 'WSOP Circuit Atlantic City Ring Events'] },
      ] }),
      b2('l2', 'Priya Raman', 12.5, { status: 'sent', sentAt: at, sentShareCents: 1000, updated: true }),
    ],
    pending: 1, sent: 1, needsConfirm: true, state: 'partial',
  };
}

export async function stageNotify(p, kind) {
  await p.route(NOTIFY, async (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* no body */ }
    if (body.preview === false) return route.fulfill({ status: 409, json: { error: 'staged by a guard: nothing is sent' } });
    // The real result (its game, venue and figures) when the server gives it, the made-up one if not.
    let result = null;
    try {
      const res = await route.fetch();
      const json = await res.json();
      if (res.status() === 200 && json && json.result) result = json.result;
    } catch { /* not reachable: the default */ }
    await route.fulfill({ status: 200, json: fixture(kind, result) });
  });
  return () => p.unroute(NOTIFY);
}
