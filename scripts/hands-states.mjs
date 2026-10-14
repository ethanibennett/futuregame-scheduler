// The Hands tab's saved list in the states a scratch account does not show by itself, for the two
// WebKit guards (check-control-centring.mjs, check-text-clipping.mjs). Staged by answering the list's
// own request in the page (a Playwright route): nothing is written to the server the guard checks, so
// it is safe on :3001 too. Reload the page after staging (the list asks at load).
//
//   stageHands(page)      GET /api/replayer/hands answers with the account's own hands PLUS made-up
//                         ones of every kind the Export for PokerTracker sheet sorts: a stud hand and
//                         the five- and six-card Omaha ones (PokerTracker 4 skips those: the "Every
//                         game" option and the longest of its lines), NLO8 (it takes), a game that has
//                         no export yet (Short Deck) and a hand that stops before it is decided (the
//                         "Not exported" list, both wordings). The hands are the repo's own made-up
//                         fixtures (test/hh-io/fixtures).
//   SHARED_HAND_CODE      a made-up share link (#h/<code>) for a hand someone else played: opened by
//                         a logged-in user it is a shared hand, whose replay Share sheet shows the
//                         hand-history tile disabled, with its reason.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'hh-io', 'fixtures');

const STAGED = [
  ['24-stud-hi.json', 'A stud hand'],
  ['15b-plo-five-cards.json', 'Five-card PLO'],
  ['22b-big-easy-legacy.json', 'Six-card PLO hi-lo, saved before the rename'],
  ['36-nlo8.json', 'No-limit Omaha hi-lo'],
  ['error-game-short-deck.json', 'A Short Deck hand'],
  ['error-unfinished.json', 'A hand that stops before it is decided'],
];

export async function stageHands(p) {
  const rows = STAGED.map(([f, title], i) => {
    const hand = JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')).hand;
    return { id: 990100 + i, title, notes: '', is_public: 0, created_at: '2026-10-13 18:30:05', ...hand };
  });
  const pattern = '**/api/replayer/hands';
  await p.route(pattern, async (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    const res = await r.fetch();
    let json = null;
    try { json = await res.json(); } catch { return r.fulfill({ response: res }); }
    await r.fulfill({ response: res, json: (Array.isArray(json) ? json : []).concat(rows) });
  });
  return async () => { await p.unroute(pattern).catch(() => {}); };
}

// A made-up three-handed no-limit hand, as hand-shorthand.js's encodeHand writes it.
export const SHARED_HAND_CODE = 'N30.1-2~200.AsKd,-,-/bKs7d2c//.0r6,1f,2c4/2x,0b8,2f//.w0.$USD';
