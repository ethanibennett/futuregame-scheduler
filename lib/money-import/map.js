'use strict';
/*
 * The dashboard-to-futurega.me mapping (docs/bankroll-merge.md §5), as PURE functions: a dashboard
 * record in, the rows it becomes out. No database, no clock. lib/money-import/plan.js decides which
 * records are written (new, paired, changed ...) and lib/money-import/apply.js writes them.
 *
 * Every mapper returns { ok: true, ... } or { ok: false, error }. An error row is skipped and listed
 * (§9.2 "Errors"); nothing is guessed about money.
 *
 * Money (§5.7): the dashboard is USD floats; results, adjustments and cash sessions here are whole
 * dollars, expenses keep their cents. Every mapper reports two effects per pocket:
 *   exact    what the row did to the DASHBOARD's roll / fund (its computeBankroll, ported in
 *            dashboard-bankroll.js)
 *   rounded  what the rows written here do to this app's roll / fund
 * so the per-bankroll residue Σ(exact − rounded) can become one `correction` (§5.7).
 */
const crypto = require('crypto');
const { cleanStakes } = require('../cash-sessions');
const { STAKE_FORMATS, STAKE_CHANNELS } = require('../staking/classify');

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = 'America/New_York';

// §5.2 variant labels (this app's naming, CLAUDE.md conventions). The dashboard's nine keys.
const VARIANT_LABEL = {
  PLO: 'PLO', PLO8: 'PLO8', NLH: 'NLH', mixed: 'Mixed', stud8: 'Stud 8', razz: 'Razz', '2-7': '2-7', BigO: 'Big O', other: 'Other',
};
// §5.4 expense categories.
const EXPENSE_CATEGORY = {
  travel: 'travel', lodging: 'lodging', meals: 'food', coaching: 'coaching', equipment: 'equipment', fees: 'fees', other: 'other',
};
// §5.3: the three adjustment types with a meaning of their own; every other type follows its sign.
const ADJ_SPECIAL = new Set(['correction', 'wsop-fund-transfer', 'backer-settlement']);

const MAX_ROOM = 60, MAX_GAME = 24, MAX_STAKES = 20, MAX_NOTES = 500, MAX_TAGS = 10, MAX_TAG = 24;
const MAX_EVENT = 120, MAX_ADJ_NOTE = 200, MAX_TX_NOTE = 200, MAX_NAME = 80;
const MAX_MONEY = 1e9, MAX_HOURS_CASH = 72, MAX_ENTRIES = 100;

const text = (v, max) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));
const r2 = (v) => Math.round(v * 100) / 100;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ── ids ──────────────────────────────────────────────────────────────────────────────────

/** §5.1: a chat-logged session keeps its id verbatim; everything else is dash:<store>:<id>. */
function fingerprintOf(store, id) {
  return store === 'sessions' && /^chat-/.test(id) ? id : `dash:${store}:${id}`;
}
/** A record's source hash: its `data` string, verbatim (a blob item: its JSON). */
const sourceHashOf = (data) => sha1(data == null ? '' : typeof data === 'string' ? data : JSON.stringify(data));
/** The deterministic Personal stable_id (§5.2), so undo and re-import are exact. */
const personalStableId = (uid, sessionId) => `PERSONAL-${uid}-dash-${sha1(sessionId).slice(0, 12)}`;

// ── dates ────────────────────────────────────────────────────────────────────────────────

function validDay(s) {
  if (!DAY_RE.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
function etDay(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}
/** A dashboard date: YYYY-MM-DD as is; a full ISO instant becomes its day in New York. -> { day, hadTime } | null */
function dayOf(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (validDay(s)) return { day: s, hadTime: false };
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    if (Number.isFinite(t)) return { day: etDay(t), hadTime: true };
  }
  return null;
}
/** 12:00 in New York on `day`, as a UTC ISO instant (§5.2: the day is exact, the time a placeholder). */
function etNoonIso(day) {
  const [y, m, d] = day.split('-').map(Number);
  const hourIn = (t) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(t));
  for (const h of [16, 17]) { // 12:00 EDT is 16:00Z, 12:00 EST is 17:00Z
    const t = Date.UTC(y, m - 1, d, h);
    if (hourIn(t) === 12) return new Date(t).toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d, 17)).toISOString();
}
const addMinutes = (iso, min) => new Date(Date.parse(iso) + min * 60000).toISOString();

// ── small cleaners ───────────────────────────────────────────────────────────────────────

function cleanTags(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const t of raw) {
    if (typeof t !== 'string' && typeof t !== 'number') continue;
    const v = text(t, MAX_TAG);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}
const optInt = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const optText = (v, max) => { const s = text(v, max); return s || null; };
const STAKES_TOKEN = /^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?){1,2}$/;

/**
 * §5.2: stakes = stakeLevel, else the stakes token of gameLabel (through cleanStakes). When the
 * label says more than stakes plus format ("40/80 mix"), the whole label goes into notes.
 */
function stakesAndNote(gameLabel, stakeLevel, formatKey) {
  const label = text(gameLabel, 200);
  const words = label ? label.split(' ') : [];
  let stakes = '';
  let used = -1;
  if (text(stakeLevel, MAX_STAKES)) {
    stakes = cleanStakes(stakeLevel);
    used = words.findIndex((w) => cleanStakes(w) === stakes);
  } else {
    used = words.findIndex((w) => STAKES_TOKEN.test(cleanStakes(w)));
    if (used >= 0) stakes = cleanStakes(words[used]);
  }
  const rest = words.filter((_, i) => i !== used).join(' ').toLowerCase();
  const fmt = [String(VARIANT_LABEL[formatKey] || '').toLowerCase(), String(formatKey || '').toLowerCase()];
  const note = rest && !fmt.includes(rest) ? label.slice(0, MAX_NOTES) : null;
  return { stakes: stakes.slice(0, MAX_STAKES), note };
}

function formatOfSession(raw) {
  if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(VARIANT_LABEL, raw)) return { key: raw, flag: null };
  return { key: 'other', flag: `format "${text(raw, 20) || '(none)'}" is not one of the dashboard's nine; filed as Other` };
}
function channelOf(raw) {
  return raw === 'live' || raw === 'online' ? { key: raw, flag: null } : { key: null, flag: 'no channel; the game\'s channel will be derived' };
}

// ── sessions (§5.2) ──────────────────────────────────────────────────────────────────────

/**
 * One dashboard Session -> a cash session or a Personal tournament, plus session_extras.
 * ctx = { uid }. -> { ok, kind: 'cash'|'tournament', date, bankroll: 'target'|'fund', rows, exact, rounded, flags, view }
 */
function mapSession(id, s, ctx) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, error: 'not a session' };
  const d = dayOf(s.date);
  if (!d) return { ok: false, error: 'a bad date' };
  const flags = [];
  if (d.hadTime) flags.push('the date carried a time; its day in New York is used');
  const buy = s.buyInTotal, cash = s.cashOut, result = s.result;
  if (!finite(buy) || buy < 0 || buy > MAX_MONEY) return { ok: false, error: 'the buy-in is not 0 or more', date: d.day };
  if (!finite(cash) || cash < 0 || cash > MAX_MONEY) return { ok: false, error: 'the cash-out is not 0 or more', date: d.day };
  if (!finite(result)) return { ok: false, error: 'no result', date: d.day };
  // The dashboard's result is cashOut - buyInTotal. One that disagrees cannot be reproduced here.
  if (Math.abs(result - (cash - buy)) > 0.01) {
    return { ok: false, error: `the result (${r2(result)}) is not cash-out minus buy-in (${r2(cash - buy)})`, date: d.day, exact: s.isWsopFund ? { roll: 0, fund: result } : { roll: result, fund: 0 } };
  }
  const hours = s.hours == null ? null : s.hours;
  if (hours !== null && (!finite(hours) || hours < 0)) return { ok: false, error: 'a bad hours figure', date: d.day };
  const fmt = formatOfSession(s.format);
  if (fmt.flag) flags.push(fmt.flag);
  const ch = channelOf(s.channel);
  if (ch.flag) flags.push(ch.flag);
  const fund = !!s.isWsopFund;
  const origin = /^chat-/.test(id) ? 'chat' : 'dashboard';
  const tags = cleanTags(s.tags);
  const extrasBase = {
    format: fmt.key, channel: ch.key,
    hands: optInt(s.hands, 0, 1e7), mood_rating: optInt(s.moodRating, 1, 5),
    tilt_note: optText(s.tiltNote, MAX_NOTES), journal: optText(s.journal, 2000),
    origin, origin_id: String(id),
  };
  const label = VARIANT_LABEL[fmt.key];
  const exact = fund ? { roll: 0, fund: result } : { roll: result, fund: 0 };

  if (!s.isMTT) {
    if (hours !== null && hours > MAX_HOURS_CASH) return { ok: false, error: `${hours} hours is longer than a cash session can be`, date: d.day, exact };
    for (const k of ['entries', 'place', 'fieldSize']) if (s[k] != null) flags.push(`${k} on a cash session is ignored`);
    const started = etNoonIso(d.day);
    const ended = hours ? addMinutes(started, Math.round(hours * 60)) : started;
    const sn = stakesAndNote(s.gameLabel, s.stakeLevel, fmt.key);
    const buyIn = Math.round(buy), cashOut = Math.round(cash);
    const room = text(s.venue, MAX_ROOM);
    return {
      ok: true, kind: 'cash', date: d.day, bankroll: fund ? 'fund' : 'target', flags,
      rows: {
        cash_sessions: {
          started_at: started, ended_at: ended, session_date: d.day, room, venue_slug: null,
          game: label.slice(0, MAX_GAME), stakes: sn.stakes, buy_in: buyIn, rebuys: 0, cash_out: cashOut, tips: 0, expenses: 0,
          currency: 'USD', notes: sn.note, tags: tags.length ? JSON.stringify(tags) : null, time_known: 0,
        },
        session_extras: { ...extrasBase, hours: null, tags: null },
      },
      exact,
      rounded: fund ? { roll: 0, fund: cashOut - buyIn } : { roll: cashOut - buyIn, fund: 0 },
      view: { date: d.day, room, game: text(s.gameLabel, MAX_EVENT) || label, in: buy, out: cash, result, hours },
    };
  }

  // Tournament: a Personal tournaments row + a tracking_entries row (lib/bankroll-import.js's shape).
  let entries = 1;
  if (s.entries != null) {
    if (!Number.isInteger(s.entries) || s.entries < 1 || s.entries > MAX_ENTRIES) return { ok: false, error: 'entries is not a whole number from 1 to 100', date: d.day, exact };
    entries = s.entries;
  }
  const per = buy / entries;
  const buyin = Number.isInteger(per) ? per : Math.round(per);
  if (!Number.isInteger(per)) flags.push(`a buy-in of ${r2(buy)} over ${entries} entries is not whole dollars; each entry is ${buyin}`);
  const cashAmount = Math.round(cash);
  const venue = text(s.venue, MAX_ROOM);
  const online = ch.key === 'online';
  return {
    ok: true, kind: 'tournament', date: d.day, bankroll: fund ? 'fund' : 'target', flags,
    rows: {
      tournaments: {
        stable_id: personalStableId(ctx.uid, String(id)), event_number: '', event_name: text(s.gameLabel, MAX_EVENT) || `${label} tournament`,
        date: d.day, time: '', buyin, game_variant: label, venue: 'Personal', notes: '', uploaded_by: ctx.uid,
        total_entries: optInt(s.fieldSize, 1, 1e7), source_pdf: 'dashboard-import',
        is_online: online ? 1 : 0, site: online ? (venue || null) : null, property: venue || null,
      },
      tracking_entries: {
        num_entries: entries, cashed: cashAmount > 0 ? 1 : 0, finish_place: optInt(s.place, 1, 1e7), cash_amount: cashAmount,
        notes: 'Imported from the dashboard',
      },
      session_extras: { ...extrasBase, hours: hours, tags: tags.length ? JSON.stringify(tags) : null },
    },
    exact,
    rounded: fund ? { roll: 0, fund: cashAmount - buyin * entries } : { roll: cashAmount - buyin * entries, fund: 0 },
    view: { date: d.day, room: venue, game: text(s.gameLabel, MAX_EVENT) || label, in: buy, out: cash, result, hours, entries, buyinPerEntry: per },
  };
}

// ── adjustments (§5.3) ───────────────────────────────────────────────────────────────────

/**
 * One dashboard adjustment -> one or two bankroll_adjustments legs.
 * -> { ok, kind, date, legs: [{ bankroll, kind, amount, transfer_id, occurred_on, note, primary }], exact, rounded, flags, view }
 */
function mapAdjustment(id, a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, error: 'not an adjustment' };
  const d = dayOf(a.date);
  if (!d) return { ok: false, error: 'a bad date' };
  const amount = a.amount;
  const type = typeof a.type === 'string' ? a.type : '';
  if (!finite(amount) || Math.abs(amount) > MAX_MONEY) return { ok: false, error: 'the amount is not a number', date: d.day };
  const exact = type === 'wsop-fund-transfer' ? { roll: -amount, fund: amount }
    : type === 'backer-settlement' ? { roll: 0, fund: amount } : { roll: amount, fund: 0 };
  if (amount === 0) return { ok: false, skipped: true, error: 'an amount of 0 moves nothing', date: d.day, exact };
  const flags = [];
  if (d.hadTime) flags.push('the date carried a time; its day in New York is used');
  const note = (type || 'adjustment') + (text(a.note, MAX_ADJ_NOTE) ? ` · ${text(a.note, MAX_ADJ_NOTE)}` : '');
  const leg = (bankroll, kind, amt, extra = {}) => ({ bankroll, kind, amount: amt, transfer_id: null, occurred_on: d.day, note: note.slice(0, MAX_ADJ_NOTE), primary: true, ...extra });
  const n = Math.round(Math.abs(amount));
  const view = { date: d.day, type, amount, note: text(a.note, MAX_ADJ_NOTE) };
  if (type === 'correction') {
    const v = Math.round(amount);
    return { ok: true, kind: 'correction', date: d.day, legs: [leg('target', 'correction', v)], exact, rounded: { roll: v, fund: 0 }, flags, view };
  }
  if (type === 'wsop-fund-transfer') {
    const tid = `dash:${id}`;
    const legs = amount > 0
      ? [leg('target', 'transfer_out', -n, { transfer_id: tid }), leg('fund', 'transfer_in', n, { transfer_id: tid, primary: false })]
      : [leg('fund', 'transfer_out', -n, { transfer_id: tid }), leg('target', 'transfer_in', n, { transfer_id: tid, primary: false })];
    const r = amount > 0 ? { roll: -n, fund: n } : { roll: n, fund: -n };
    return { ok: true, kind: 'transfer', date: d.day, legs, exact, rounded: r, flags, view };
  }
  if (type === 'backer-settlement') {
    const v = Math.round(amount);
    return { ok: true, kind: 'settlement', date: d.day, legs: [leg('fund', 'settlement', v)], exact, rounded: { roll: 0, fund: v }, flags, view, settlementNote: text(a.note, 400) };
  }
  // Anything else follows its sign (§2.2 point 3: the dashboard added it regardless of the label).
  const kind = amount > 0 ? 'deposit' : 'withdrawal';
  if ((type === 'withdrawal' && amount > 0) || (type === 'deposit' && amount < 0)) {
    flags.push(`A ${type} of ${amount > 0 ? '+' : '−'}$${r2(Math.abs(amount))} — the dashboard ${amount > 0 ? 'added this to' : 'took this from'} the roll, so it imports as a ${kind}.`);
  } else if (type !== 'deposit' && type !== 'withdrawal') {
    flags.push(`type "${text(type, 30) || '(none)'}" is not one the dashboard names; it imports by its sign, as a ${kind}`);
  }
  const v = amount > 0 ? n : -n;
  return { ok: true, kind, date: d.day, legs: [leg('target', kind, v)], exact, rounded: { roll: v, fund: 0 }, flags, view };
}

// ── expenses (§5.4) ──────────────────────────────────────────────────────────────────────

function mapExpense(id, e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, error: 'not an expense' };
  const d = dayOf(e.date);
  if (!d) return { ok: false, error: 'a bad date' };
  if (!finite(e.amount) || e.amount <= 0 || e.amount > MAX_MONEY) return { ok: false, error: 'the amount is not above 0', date: d.day };
  const flags = [];
  let category = EXPENSE_CATEGORY[e.category];
  if (!category) { category = 'other'; flags.push(`category "${text(e.category, 20) || '(none)'}" is not one the dashboard names; filed as other`); }
  const amount = r2(e.amount);
  return {
    ok: true, kind: 'expense', date: d.day, bankroll: 'target', flags,
    rows: { bankroll_transactions: { occurred_on: d.day, kind: 'expense', category, amount, currency: 'USD', note: optText(e.note, MAX_TX_NOTE), affects_balance: 0 } },
    // Neither app's roll moves: the dashboard's never read expenses, and these rows are
    // affects_balance = 0 here (§17 Q6). They still count for tax.
    exact: { roll: 0, fund: 0 }, rounded: { roll: 0, fund: 0 },
    view: { date: d.day, category, dashCategory: e.category, amount, note: text(e.note, MAX_TX_NOTE) },
  };
}

// ── backers (§7) ─────────────────────────────────────────────────────────────────────────

/** "Ab••••••": the first two characters, never more (§9.2). */
const maskToken = (t) => (typeof t === 'string' && t.length >= 2 ? t.slice(0, 2) + '••••••' : '••••••••');

/**
 * A dashboard Backer -> the backers row, its standing agreement and stakes. The token moves
 * VERBATIM (§7.2). `secret` holds what may never be shown: token, phone, email.
 */
function mapBacker(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: 'not a backer' };
  if (typeof b.token !== 'string' || !/^[A-Za-z0-9]{6,64}$/.test(b.token)) return { ok: false, error: 'no usable link token' };
  const flags = [];
  const stakes = [];
  for (const st of Array.isArray(b.stakes) ? b.stakes : []) {
    if (!st || typeof st !== 'object') continue;
    const pct = Number(st.pct);
    if (!(pct > 0 && pct <= 100)) { flags.push('a stake whose percentage is not above 0 and at most 100 was left out'); continue; }
    let format = st.format;
    if (!STAKE_FORMATS.includes(format)) { flags.push(`a stake in "${text(format, 20)}" is filed as other`); format = 'other'; }
    const channel = STAKE_CHANNELS.includes(st.channel) ? st.channel : 'any';
    stakes.push({ format, channel, pct });
  }
  const delivery = b.delivery && typeof b.delivery === 'object' ? b.delivery : {};
  const phone = typeof delivery.sms === 'string' && delivery.sms.trim() ? delivery.sms.trim() : null;
  const email = typeof delivery.email === 'string' && delivery.email.trim() ? delivery.email.trim() : null;
  const opening = Number(b.opening) || 0;
  return {
    ok: true,
    name: text(b.name, MAX_NAME) || null,
    stakes,
    openingCents: Math.round(opening * 100), // as the feed has always computed it (server.js:590)
    delivery: { sms: !!phone, email: !!email },
    secret: { token: b.token, phone, email },
    maskedToken: maskToken(b.token),
    flags,
  };
}

// ── the synced blobs (§5.6) ──────────────────────────────────────────────────────────────

function mapDeal(d) {
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !d.id) return { ok: false, error: 'a slate deal without an id' };
  const event = text(d.event, MAX_EVENT);
  if (!event) return { ok: false, error: 'a slate deal without an event' };
  const buyIn = Number(d.buyIn), pct = Number(d.pctSold), markup = Number(d.markup);
  if (!(buyIn > 0) || buyIn > MAX_MONEY) return { ok: false, error: 'a slate deal whose buy-in is not above 0' };
  if (!(pct > 0 && pct <= 100)) return { ok: false, error: 'a slate deal whose percentage sold is not above 0 and at most 100' };
  return {
    ok: true, id: d.id, event, buyIn: r2(buyIn), pctSold: pct, markup: markup > 0 ? markup : 1,
    backer: text(d.backer, MAX_NAME) || null, settled: !!d.settled,
  };
}

function mapLocation(e, index) {
  if (!e || typeof e !== 'object') return { ok: false, error: 'not a balance entry' };
  const id = typeof e.id === 'string' && e.id ? e.id : null;
  const name = text(e.name, 60);
  if (!id || !name) return { ok: false, error: 'a balance entry without an id or a name' };
  const amount = Number(e.amount);
  if (!Number.isFinite(amount)) return { ok: false, error: 'a balance entry whose amount is not a number' };
  return { ok: true, id, rows: { money_locations: { name, amount: r2(amount), currency: 'USD', sort_order: index } } };
}

module.exports = {
  VARIANT_LABEL, EXPENSE_CATEGORY, ADJ_SPECIAL, MAX_ADJ_NOTE,
  sha1, fingerprintOf, sourceHashOf, personalStableId,
  validDay, dayOf, etDay, etNoonIso, stakesAndNote, cleanTags, maskToken,
  mapSession, mapAdjustment, mapExpense, mapBacker, mapDeal, mapLocation,
};
