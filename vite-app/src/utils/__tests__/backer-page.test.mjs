// node --test src/utils/__tests__/backer-page.test.mjs   (from vite-app/; or `npm run test:backer-page` from the root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKER_TOKEN_RE, backerTokenFromPath, fmtCents, fmtSignedCents, tone, fmtHours, plural, fmtDay, fmtShort,
  monthLabel, chronological, newestFirst, summarize, groupByMonth, rangeFrom, rangeOptions, shareSeries,
  stepGeometry, stripFor, ONLINE_ROOM, playerBbHr, bbStats, eventBb,
} from '../backer-page.js';

const ev = (date, shareCents, extra = {}) => ({ date, shareCents, ts: Date.parse(date + 'T20:00:00Z'), hours: 4, sessionResultCents: shareCents * 5, pct: 20, game: '5/5/10 PLO', venue: 'Borgata', ...extra });

test('token: the server\'s pattern, from a /b/ path only', () => {
  assert.equal(backerTokenFromPath('/b/DemoSam7Kq2Vx'), 'DemoSam7Kq2Vx');
  assert.equal(backerTokenFromPath('/b/DemoSam7Kq2Vx/'), 'DemoSam7Kq2Vx');
  assert.equal(backerTokenFromPath('/b/' + 'a'.repeat(32)), 'a'.repeat(32));   // legacy 32-hex
  assert.equal(backerTokenFromPath('/b/abc12'), null);                         // under 6
  assert.equal(backerTokenFromPath('/b/' + 'a'.repeat(65)), null);             // over 64
  assert.equal(backerTokenFromPath('/b/abc-def12'), null);
  assert.equal(backerTokenFromPath('/b/sw.js'), null);
  assert.equal(backerTokenFromPath('/b/DemoSam7Kq2Vx/feed'), null);
  assert.equal(backerTokenFromPath('/shared/abcdef'), null);
  assert.equal(backerTokenFromPath('/'), null);
  assert.equal(backerTokenFromPath(undefined), null);
  assert.ok(BACKER_TOKEN_RE.test('Ab3456'));
});

test('money: whole dollars, signed with a true minus, zero unsigned and untoned', () => {
  assert.equal(fmtSignedCents(124000), '+$1,240');
  assert.equal(fmtSignedCents(-38049), '−$380');
  assert.equal(fmtSignedCents(0), '$0');
  assert.equal(fmtSignedCents(40), '$0');          // rounds to $0: no sign
  assert.equal(fmtSignedCents(null), '$0');
  assert.equal(fmtCents(123456789), '$1,234,568');
  assert.equal(fmtCents(-500), '−$5');
  assert.equal(tone(100), 'is-pos');
  assert.equal(tone(-100), 'is-neg');
  assert.equal(tone(40), '');                      // reads "$0": never coloured
});

test('hours, counts, dates', () => {
  assert.equal(fmtHours(4.5), '4.5h');
  assert.equal(fmtHours(5), '5h');
  assert.equal(fmtHours(201.04), '201h');
  assert.equal(fmtHours(undefined), '0h');
  assert.equal(plural(1, 'session'), '1 session');
  assert.equal(plural(1200, 'session'), '1,200 sessions');
  assert.equal(fmtDay('2026-10-11'), 'Sun, Oct 11');
  assert.equal(fmtDay('2026-02-28'), 'Sat, Feb 28');
  assert.equal(fmtShort('2026-10-11', 2026), 'Oct 11');
  assert.equal(fmtShort('2025-12-31', 2026), 'Dec 31, 2025');
  assert.deepEqual(monthLabel('2026-10'), { mon: 'Oct', year: '2026' });
});

test('order: session date first, then when it was recorded', () => {
  const late = { date: '2026-03-07', ts: 900, shareCents: 1 };
  const early = { date: '2026-03-08', ts: 100, shareCents: 2 };   // logged earlier, played later
  const same = { date: '2026-03-07', ts: 50, shareCents: 3 };
  assert.deepEqual(chronological([early, late, same]).map((e) => e.shareCents), [3, 1, 2]);
  assert.deepEqual(newestFirst([early, late, same]).map((e) => e.shareCents), [2, 1, 3]);
});

test('summary: totals from the feed, falling back to the sessions it holds', () => {
  const events = [ev('2026-03-01', 10000), ev('2026-03-02', -4000)];
  const s = summarize({ openingCents: 50000, cumulativeCents: 56000, sessions: 2, hours: 8, events });
  assert.deepEqual(s, { total: 56000, sessions: 2, hours: 8, opening: 50000, paid: 0, base: 50000, complete: true });
  // A payout (Phase 14) lowers the total, not the shares: the curve's base adds it back, so the
  // history still reads complete.
  const p = summarize({ openingCents: 50000, cumulativeCents: 51000, paidCents: 5000, sessions: 2, hours: 8, events });
  assert.deepEqual([p.total, p.paid, p.base, p.complete], [51000, 5000, 50000, true]);
  // An older feed without the totals: the sessions it carries.
  const o = summarize({ openingCents: 0, events });
  assert.equal(o.total, 6000);
  assert.equal(o.sessions, 2);
  assert.equal(o.hours, 8);
  // 200 of 250 sessions sent: the curve starts from what the older 50 left ("carried in").
  const t = summarize({ openingCents: 0, cumulativeCents: 90000, sessions: 250, hours: 1000, events });
  assert.equal(t.base, 84000);
  assert.equal(t.complete, false);
  // Nothing at all (an unknown token answers an empty feed).
  assert.deepEqual(summarize({ name: null, events: [] }), { total: 0, sessions: 0, hours: 0, opening: 0, paid: 0, base: 0, complete: true });
});

test('months: newest first, newest session first inside, with the month\'s share and hours', () => {
  const g = groupByMonth([ev('2026-02-14', 100), ev('2026-03-02', -50), ev('2026-03-20', 300), ev('2026-02-01', 25)]);
  assert.deepEqual(g.map((m) => m.key), ['2026-03', '2026-02']);
  assert.deepEqual(g[0].events.map((e) => e.date), ['2026-03-20', '2026-03-02']);
  assert.equal(g[0].shareCents, 250);
  assert.equal(g[1].shareCents, 125);
  assert.equal(g[1].hours, 8);
  assert.deepEqual(groupByMonth([]), []);
});

test('ranges: 1M / 3M / YTD from today, clamped to the month', () => {
  assert.equal(rangeFrom('1m', '2026-10-13'), '2026-09-14');
  assert.equal(rangeFrom('3m', '2026-05-31'), '2026-03-01');   // Feb 28 + 1
  assert.equal(rangeFrom('ytd', '2026-10-13'), '2026-01-01');
  assert.equal(rangeFrom('all', '2026-10-13'), null);
});

test('range switch only with enough history; each range only when it differs from All', () => {
  const today = '2026-10-13';
  assert.deepEqual(rangeOptions([], today), []);
  assert.deepEqual(rangeOptions([ev('2026-10-11', 5)], today), []);                       // one session
  assert.deepEqual(rangeOptions([ev('2026-10-01', 5), ev('2026-10-11', 5)], today), []);  // two, both this month
  // Eight months, all this year: YTD would equal All, so it is not offered.
  const season = [];
  for (let m = 2; m <= 10; m++) season.push(ev(`2026-${String(m).padStart(2, '0')}-05`, 100), ev(`2026-${String(m).padStart(2, '0')}-12`, -40));
  assert.deepEqual(rangeOptions(season, today).map(([k]) => k), ['1m', '3m', 'all']);
  // Across a new year: YTD differs.
  const span = [ev('2025-11-02', 1), ev('2025-12-02', 1), ev('2026-01-05', 1), ev('2026-02-05', 1), ev('2026-02-06', 1)];
  assert.deepEqual(rangeOptions(span, '2026-03-01').map(([k]) => k), ['1m', '3m', 'ytd', 'all']);
});

test('series: from the base, one point per session in date order; a range carries in its start', () => {
  const events = [ev('2026-08-10', 1000), ev('2026-09-10', -3000), ev('2026-10-02', 500), ev('2026-10-09', 2500)];
  const all = shareSeries(events, { base: 50000 });
  assert.deepEqual(all.points.map((p) => p.value), [51000, 48000, 48500, 51000]);
  assert.equal(all.start, 50000);
  assert.equal(all.end, 51000);
  assert.equal(all.change, 1000);
  assert.equal(all.lo, 48000);
  assert.equal(all.hi, 51000);
  assert.equal(all.first, '2026-08-10');
  assert.equal(all.last, '2026-10-09');
  const m1 = shareSeries(events, { base: 50000, range: '1m', today: '2026-10-13' });
  assert.equal(m1.start, 48000);           // what Aug and Sep left
  assert.deepEqual(m1.points.map((p) => p.value), [48500, 51000]);
  assert.equal(m1.change, 3000);
  assert.equal(shareSeries([], { base: 0 }), null);
  assert.equal(shareSeries(events, { base: 0, range: '1m', today: '2027-06-01' }), null);   // nothing in the window
});

test('geometry: 0, 1, 2 and 200 sessions', () => {
  assert.equal(stepGeometry(null), null);
  // One session: flat at the start to the middle, one step, flat to the end.
  const one = stepGeometry(shareSeries([ev('2026-10-11', -49900)], { base: 0 }), { w: 35, h: 16, inset: 1 });
  assert.deepEqual(one.line, [[0, 1], [17.5, 1], [17.5, 15], [35, 15]]);
  assert.equal(one.baseY, 1);
  assert.deepEqual(one.last, [35, 15]);
  // Two: steps at a quarter and three quarters.
  const two = stepGeometry(shareSeries([ev('2026-09-20', -100), ev('2026-10-12', -100)], { base: 0 }), { w: 35, h: 16, inset: 1 });
  assert.deepEqual(two.line.map(([x]) => x), [0, 8.75, 8.75, 26.25, 26.25, 35]);
  assert.deepEqual(two.line.map(([, y]) => y), [1, 1, 8, 8, 15, 15]);
  // A flat run (every result zero): the line sits in the middle.
  const flat = stepGeometry(shareSeries([ev('2026-10-01', 0), ev('2026-10-02', 0)], { base: 0 }), { w: 35, h: 16 });
  assert.ok(flat.line.every(([, y]) => y === 8));
  // Two hundred: every vertex inside the plot, inset 1r top and bottom, x rising.
  const many = [];
  for (let i = 0; i < 200; i++) many.push(ev(`2026-${String(1 + Math.floor(i / 20)).padStart(2, '0')}-${String(1 + (i % 20)).padStart(2, '0')}`, ((i * 7919) % 2000) - 900));
  const g = stepGeometry(shareSeries(many, { base: 0 }), { w: 35, h: 16, inset: 1 });
  assert.equal(g.line.length, 2 + 2 * 200);
  assert.ok(g.line.every(([x, y]) => x >= 0 && x <= 35 && y >= 1 - 1e-9 && y <= 15 + 1e-9));
  assert.ok(g.line.every(([x], i) => i === 0 || x >= g.line[i - 1][0]));
});

test('strips: the room as logged, the curated colour when the venue list knows it, online said', () => {
  const map = {
    Borgata: { abbr: 'BORGATA', color: '#6b21a8', longName: 'Borgata Spring Poker Open' },
    "RGPS Philly '26": { abbr: 'LIVE! PHILLY', color: '#4a1c5f', longName: 'Live! Casino Philadelphia' },
    'WSOP.com': { abbr: 'WSOP.COM', color: '#186186', longName: 'WSOP Online' },
    'Some Series': { abbr: 'PARX', color: '#126812', longName: 'Parx Casino' },
  };
  assert.deepEqual(stripFor('Borgata', map), { name: 'Borgata', label: 'Borgata', abbr: 'BORGATA', online: false });
  assert.equal(stripFor('borgata', map).abbr, 'BORGATA');                       // case
  assert.equal(stripFor('Live! Casino Philadelphia', map).abbr, 'LIVE! PHILLY'); // by the room's full name
  assert.equal(stripFor('Live Philly', map).abbr, 'LIVE! PHILLY');               // by the abbreviation, punctuation aside
  assert.equal(stripFor('Parx', map).abbr, 'PARX');
  assert.deepEqual(stripFor('Delaware Park', map), { name: 'Delaware Park', label: 'Delaware Park', abbr: null, online: false });
  assert.deepEqual(stripFor('WSOP.com', map), { name: 'WSOP.com', label: 'WSOP.com · Online', abbr: 'WSOP.COM', online: true });
  assert.deepEqual(stripFor('BetRivers', map), { name: 'BetRivers', label: 'BetRivers · Online', abbr: null, online: true });
  assert.equal(stripFor('WSOP Online', map).label, 'WSOP Online');               // already says so
  assert.equal(stripFor('', map).label, 'Room not given');
  assert.equal(stripFor(null, map).abbr, null);
  for (const r of ['ACR', 'GGPoker', 'PokerStars', 'BetMGM', 'ClubWPT', 'Phenom']) assert.ok(ONLINE_ROOM.test(r), r);
  for (const r of ['Borgata', 'Parx Casino', 'Bellagio', "Harrah's Philadelphia"]) assert.ok(!ONLINE_ROOM.test(r), r);
});

// ── bb/hr, the player's (utils/bb-hr.js) ──────────────────────────────────────────────────────
test('bb/hr: the player\'s, over the sessions whose game names a big blind, from the feed\'s own fields', () => {
  const events = [
    ev('2026-10-01', 4000, { game: '2/5 NLH', hours: 4, sessionResultCents: 50000 }),    // +$500 at BB 5 = +100 bb
    ev('2026-10-02', -1000, { game: '1/2 PLO', hours: 2, sessionResultCents: -20000 }),   // -$200 at BB 2 = -100 bb
    ev('2026-10-03', 900, { game: 'PLO MTT', hours: 6, sessionResultCents: 450000 }),     // a tournament: no blind, out
    ev('2026-10-04', 100, { game: '5/5/10 PLO', hours: 5, sessionResultCents: 25000 }),   // BB 5 (the second number): +$250 = +50 bb
  ];
  const [s] = bbStats(events);
  assert.equal(s.unit, 'bb');
  assert.equal(s.text, '+4.5');                       // (100 - 100 + 50) bb / 11 h
  assert.equal(s.full, '+4.5 bb/hr');
  assert.equal(s.tone, 'is-pos');
  assert.equal(s.n, 3);
  assert.equal(playerBbHr(events).BB, null);
  assert.equal(bbStats(events).length, 1);
});

test('bb/hr: limit games are in big bets, shown beside the big blinds and never added to them', () => {
  const events = [
    ev('2026-10-01', 0, { game: '2/5 NLH', hours: 5, sessionResultCents: 25000 }),        // +50 bb / 5 h = 10
    ev('2026-10-02', 0, { game: '4/8 LHE', hours: 4, sessionResultCents: 8000 }),         // +10 BB / 4 h = 2.5
  ];
  assert.deepEqual(bbStats(events).map((s) => [s.unit, s.full, s.tone]), [['bb', '+10.0 bb/hr', 'is-pos'], ['BB', '+2.5 BB/hr', 'is-pos']]);
});

test('bb/hr: nothing qualifying is no stat at all (never 0): tournaments, no blind in the text, no hours', () => {
  assert.deepEqual(bbStats([]), []);
  assert.deepEqual(bbStats(null), []);
  assert.deepEqual(bbStats([ev('2026-10-01', 0, { game: 'NLH MTT', sessionResultCents: 9000 }), ev('2026-10-02', 0, { game: 'NLH', sessionResultCents: 9000 })]), []);
  assert.deepEqual(bbStats([ev('2026-10-01', 0, { game: '2/5 NLH', hours: 0, sessionResultCents: 9000 })]), []);
  assert.deepEqual(bbStats([ev('2026-10-01', 0, { game: '2/5 NLH', hours: null, sessionResultCents: 9000 })]), []);
  assert.deepEqual(bbStats([ev('2026-10-01', 0, { game: '2/5 NLH', hours: 4, sessionResultCents: null })]), [], 'an unknown result is not a break-even one');
});

test('bb/hr: a losing player reads red with a true minus; a break-even one reads 0.0, unsigned and uncoloured', () => {
  const [lose] = bbStats([ev('2026-10-01', 0, { game: '2/5 NLH', hours: 5, sessionResultCents: -25000 })]);
  assert.equal(lose.full, '−10.0 bb/hr');
  assert.equal(lose.tone, 'is-neg');
  const [flat] = bbStats([ev('2026-10-01', 0, { game: '2/5 NLH', hours: 5, sessionResultCents: 0 })]);
  assert.equal(flat.full, '0.0 bb/hr');
  assert.equal(flat.tone, '');
});

test('bb/hr: the result is the PLAYER\'s, not the backer\'s share', () => {
  // A 20% backer's share is $100 of a $500 result; the player's rate uses the $500.
  const [s] = bbStats([ev('2026-10-01', 10000, { game: '2/5 NLH', hours: 4, pct: 20, sessionResultCents: 50000 })]);
  assert.equal(s.text, '+25.0');
});

test('bb/hr per session line: a game that names its blind, a quarter hour or more', () => {
  assert.deepEqual(eventBb(ev('2026-10-01', 0, { game: '2/5 NLH', hours: 4, sessionResultCents: 50000 })), { text: '+25.0 bb/hr', tone: 'is-pos' });
  assert.deepEqual(eventBb(ev('2026-10-01', 0, { game: '4/8 LHE', hours: 4, sessionResultCents: -3200 })), { text: '−1.0 BB/hr', tone: 'is-neg' });
  assert.equal(eventBb(ev('2026-10-01', 0, { game: 'PLO MTT', hours: 4, sessionResultCents: 50000 })), null);
  assert.equal(eventBb(ev('2026-10-01', 0, { game: '2/5 NLH', hours: 0.1, sessionResultCents: 50000 })), null);
  assert.equal(eventBb(null), null);
});

test('bb/hr: the feed is not touched (the parity tests compare it byte for byte): the figure is a function of what it carries', () => {
  const feed = { events: [ev('2026-10-01', 0, { game: '2/5 NLH', hours: 4, sessionResultCents: 50000 })] };
  const before = JSON.stringify(feed);
  bbStats(feed.events); eventBb(feed.events[0]); summarize(feed);
  assert.equal(JSON.stringify(feed), before);
});

// The settlement bar (owner, 2026-10-15): Sundays at noon, New York time, across both clock changes.
test('settlementCountdown counts down to Sunday noon Eastern', async () => {
  const { settlementCountdown, SETTLE_WEEK_MS } = await import('../backer-page.js');
  const at = (iso) => settlementCountdown(Date.parse(iso));
  assert.equal(new Date(at('2026-10-15T05:10:00Z').next).toISOString(), '2026-10-18T16:00:00.000Z');
  assert.equal(at('2026-10-15T05:10:00Z').text, '3 days, 10 hours');
  assert.equal(at('2026-10-18T15:59:00Z').text, '1 minute');
  const noon = at('2026-10-18T16:00:00Z');
  assert.equal(new Date(noon.next).toISOString(), '2026-10-25T16:00:00.000Z', 'at noon exactly, the next week');
  assert.equal(noon.pct, 100);
  assert.equal(noon.leftMs, SETTLE_WEEK_MS);
  assert.equal(new Date(at('2026-10-31T12:00:00Z').next).toISOString(), '2026-11-01T17:00:00.000Z', 'noon EST after the fall change');
  assert.equal(new Date(at('2026-03-05T12:00:00Z').next).toISOString(), '2026-03-08T16:00:00.000Z', 'noon EDT after the spring change');
  assert.equal(at('2026-10-18T13:30:00Z').text, '2 hours, 30 minutes');
});
