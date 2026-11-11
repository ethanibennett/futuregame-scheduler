// ── CSV import for the bankroll ledger (beta, app admins) ──────────────────────────────────
// Pure and dependency-free (runs under `node --test`). Parses a file, recognises the formats we
// can SHOW are documented, maps columns, and produces the normalised rows POST
// /api/bankrolls/import takes (lib/bankroll-import.js):
//   { type: 'tournament', date, name, buyin (per entry), entries, cash, place, field, game, currency, note }
//   { type: 'deposit' | 'withdrawal', date, amount (> 0), currency, note }
//   { type: 'cash', date (the local day it started), startedAt, endedAt (ISO instants), room, game,
//     stakes, buyin (TOTAL put on the table), rebuys, cashout, tips, expenses, currency, note }
//
// PRESETS — only formats whose columns are published by their maker:
//   Poker Bankroll Tracker (PBT) export / import file
//     evidence: https://pokerbankrolltracker.net/faq/ ("How to create/edit and import a CSV file
//     into the Poker Bankroll Tracker App?") and the vendor's sample file
//     https://pokerbankrolltracker.net/PBT_Bankroll_CSV_example.csv: first line
//     "---PBT Bankroll Export---" (the FAQ prints it with em dashes), then the header
//     id,starttime,endtime,…,variant,game,limit,…,location,type,currency,exchangerate,buyin,
//     cashout,netprofit,grossprofit,rebuys,rebuycosts,addoncosts,bounties,bountycosts,…,place,
//     player,itm,mttname,…,sessionnote,…  Dates "YYYY-MM-DD HH:MM:SS". The sample writes decimal
//     commas inside quotes ("0,5"), so numbers are read either way.
//   Pokerbase "Custom Sheet (CSV)" layout
//     evidence: https://devizerhq.notion.site/Custom-Sheet-CSV-12033703389780e39b15e07a9118432c —
//     Pokerbase's documented IMPORT template (currency_code,location,stake,table_size,game,type,
//     tournament_name,is_online,start,end,buyin_amount,total_rebuy_amount,number_of_rebuys,
//     total_addon_amount,…,total_bounties_amount,…,cashout,…,tournament_position,
//     total_tournament_entries,note). Pokerbase's own EXPORT has no published header, so it is
//     not a preset.
// Poker Income, Poker Analytics, Poker Journal: no published column list was found, so those
// files go through the generic mapping (pick a column for each field) and nothing is guessed.
//
// Choices both presets share, stated rather than hidden:
//   - cost of a tournament = buy-in + rebuy costs + add-on costs; entries = 1 + rebuys; the
//     per-entry buy-in is cost / entries, or — when that is not whole — one entry of the whole
//     cost, so the cost always survives exactly as buyin x num_entries.
//   - cash = cashout + bounties: both apps list bounty winnings in their own column beside the
//     cashout. PBT's bountycosts is not added to the cost (its relation to buyin is not documented).
//   - cash-game rows become CASH SESSIONS (owner, 2026-11-01): the cash-sessions ledger source, as if
//     logged in the app. PBT's own arithmetic, checked against its sample (netprofit and grossprofit):
//       net   = cashout - (buyin + rebuycosts)          (cashout is what left the table)
//       gross = net + expensesfromstack                  (tips and the like, paid from the stack)
//     so a session is buy-in = buyin + rebuycosts, cash out = cashout + expensesfromstack, tips =
//     expensesfromstack, expenses = expenses: the app's net (cash out - buy-in - tips - expenses) is
//     PBT's net, and its result (cash out - buy-in) PBT's gross. The length is playingminutes (breaks
//     out) when PBT gives it, else end - start. Times carry no zone: they are read in the browser's.
//     PBT's Costs / Casino Games / Jackpot rows are still skipped.
//   - a PBT "Deposit/Payout" row moves money by cashout - buyin: positive is a deposit into the
//     roll, negative a withdrawal.

// ── Parsing ──────────────────────────────────────────────────────────────────────────────
/** RFC 4180-ish: quoted fields, doubled quotes, CRLF/LF/CR, BOM. The separator is sniffed. */
export function parseCsv(text) {
  let s = String(text || '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const firstLine = s.split(/\r\n|\n|\r/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const sep = [',', ';', '\t'].reduce((a, b) => (count(b) > count(a) ? b : a), ',');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

/**
 * "1,234.50" "1.234,50" "0,5" "$1,200" "(100)" "-75" → number; '' → null; junk → NaN.
 * A lone comma followed by 1-2 digits is a decimal comma; groups of three are thousands.
 */
export function parseNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[\s$€£¥]|[A-Z]{3}$/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');      // 1.234,50
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');                    // 1,234.50
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');                                  // 0,5
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return neg ? -n : n;
}

/**
 * → 'YYYY-MM-DD' or null. YYYY-MM-DD[ T]time, YYYY/MM/DD, DD.MM.YYYY, and N/N/YYYY which is
 * ambiguous: month-first unless dayFirst (or the first number is over 12).
 */
export function parseDate(raw, { dayFirst = false, strict = false } = {}) {
  const s = String(raw || '').trim();
  let y, m, d, x;
  if ((x = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s))) [y, m, d] = [x[1], x[2], x[3]].map(Number);
  else if ((x = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s.*)?$/.exec(s))) [d, m, y] = [x[1], x[2], x[3]].map(Number);
  else if ((x = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})(?:\s.*)?$/.exec(s))) {
    let a = Number(x[1]), b = Number(x[2]);
    y = Number(x[3]); if (y < 100) y += 2000;
    // strict: the file's order holds for every row; a row that cannot be read that way is an error, not
    // quietly read the other way (App improvements 208).
    if (dayFirst || (a > 12 && !strict)) [d, m] = [a, b]; else [m, d] = [a, b];
  } else return null;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1970 && y <= 2100)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const norm = (h) => String(h || '').trim().toLowerCase();
const recordOf = (headers, row) => {
  const r = {};
  headers.forEach((h, i) => { r[norm(h)] = row[i] == null ? '' : String(row[i]).trim(); });
  return r;
};
const n0 = (v) => { const n = parseNumber(v); return Number.isFinite(n) ? n : 0; };
const int0 = (v) => { const n = parseNumber(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
const intOrNull = (v) => { const n = parseNumber(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };

// ── Cash sessions ─────────────────────────────────────────────────────────────────────────
/** 'YYYY-MM-DD HH:MM[:SS]' (or T), 'YYYY/MM/DD …', a date alone (noon) → { at: Date, timed } in the
 *  browser's zone, or null. N/N/YYYY dates follow dayFirst as parseDate does. */
export function parseLocalDateTime(raw, { dayFirst = false } = {}) {
  const s = String(raw || '').trim();
  const day = parseDate(s, { dayFirst });
  if (!day) return null;
  const t = /(?:[ T])(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(s);
  const [y, m, d] = day.split('-').map(Number);
  if (!t) return { at: new Date(y, m - 1, d, 12, 0, 0), timed: false };
  let h = Number(t[1]);
  const ap = (t[4] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || Number(t[2]) > 59) return null;
  return { at: new Date(y, m - 1, d, h, Number(t[2]), Number(t[3] || 0)), timed: true };
}
const pad2 = (n) => String(n).padStart(2, '0');
const localDay = (dt) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
const blind = (v) => { const n = parseNumber(v); return Number.isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : null; };
/** Blinds → "1/2", "0.5/1", "1/2/5" (a third blind or straddle when given), else ''. */
export function stakesFrom(sb, bb, third) {
  const a = blind(sb), b = blind(bb), c = blind(third);
  if (!a || !b) return '';
  return c ? `${a}/${b}/${c}` : `${a}/${b}`;
}
/** A game and its limit as the app names cash games (NLH, PLO, PLO8, LHE…), else both as written. */
export function gameLabel(game, limit) {
  const g = norm(game).replace(/[^a-z0-9/ ]/g, ''), l = norm(limit);
  const lim = /no ?limit|^nl$/.test(l) ? 'NL' : /pot ?limit|^pl$/.test(l) ? 'PL' : /fixed|^limit$|^fl$/.test(l) ? 'L' : '';
  const hold = /hold ?em|holdem|nlh|nlhe/.test(g);
  const omaha = /omaha|plo/.test(g);
  const hilo = /hi ?\/? ?lo|8 ?or ?better|o8|\/8/.test(g);
  const five = /5 ?card|plo5|five/.test(g), six = /6 ?card|plo6|six/.test(g);
  if (hold) return lim === 'L' ? 'LHE' : lim === 'PL' ? 'PLH' : 'NLH';
  if (omaha) {
    if (lim === 'L') return hilo ? 'O8' : 'LO';
    return (five ? 'PLO5' : six ? 'PLO6' : 'PLO') + (hilo ? (five || six ? ' 8/b' : '8') : '');
  }
  if (/stud/.test(g)) return hilo ? 'Stud 8' : 'Stud Hi';
  if (/razz/.test(g)) return 'Razz';
  if (/big ?o/.test(g)) return 'Big O';
  if (/mix|horse|dealer/.test(g)) return 'Mixed';
  return [limit, game].map((x) => String(x || '').trim()).filter(Boolean).join(' ').slice(0, 24) || 'NLH';
}
/**
 * One cash session. start / end are raw strings; minutes (playing time) wins over end when given; hours
 * (a number) when there is no end. Amounts are in the file's currency. → { row } | { error }.
 */
function cashRow({ start, end, minutes, hours, room, game, stakes, buyin, rebuys, cashout, tips, expenses, currency, note, tags, dayFirst = false }) {
  const st = parseLocalDateTime(start, { dayFirst });
  if (!st) return { error: `Unreadable start "${String(start || '').trim()}"` };
  let ms = null;
  if (Number.isFinite(minutes) && minutes > 0) ms = minutes * 60000;
  else if (end) {
    const en = parseLocalDateTime(end, { dayFirst });
    if (!en || !en.timed) return { error: `Unreadable end "${String(end).trim()}"` };
    ms = en.at - st.at;
  } else if (Number.isFinite(hours) && hours > 0) ms = hours * 3600000;
  if (ms == null) return { error: 'No end time or length' };
  if (ms <= 0) return { error: 'Ends before it starts' };
  if (ms > 72 * 3600000) return { error: 'Longer than 72 hours' };
  if (!Number.isFinite(buyin) || buyin < 0) return { error: 'No buy-in' };
  if (!Number.isFinite(cashout) || cashout < 0) return { error: 'No cash out' };
  return {
    row: {
      type: 'cash', date: localDay(st.at), startedAt: st.at.toISOString(), endedAt: new Date(st.at.getTime() + ms).toISOString(),
      room: String(room || '').trim().slice(0, 60), game: game || 'NLH', stakes: String(stakes || '').trim().slice(0, 20),
      buyin, rebuys: Number.isInteger(rebuys) && rebuys > 0 ? rebuys : 0, cashout,
      tips: Number.isFinite(tips) && tips > 0 ? tips : 0, expenses: Number.isFinite(expenses) && expenses > 0 ? expenses : 0,
      currency: (currency || 'USD').toUpperCase(), note: String(note || '').trim().slice(0, 500),
      tags: String(tags || '').split(/[,;]/).map((t) => t.trim()).filter(Boolean).slice(0, 10),
    },
  };
}

function tournamentRow({ date, name, buyin, rebuyCost, addonCost, rebuys, cashout, bounties, place, field, game, currency, note }) {
  if (!date) return { error: 'No readable date' };
  let entries = 1 + rebuys;
  const cost = buyin + rebuyCost + addonCost;
  // Results store a whole buy-in per entry (tournaments.buyin x num_entries). When the cost does
  // not split evenly over the entries (an add-on, a discounted rebuy), keep the COST exact and
  // count it as one entry rather than round a per-entry figure.
  let folded = false;
  if (!Number.isInteger(cost / entries)) { entries = 1; folded = rebuys > 0 || addonCost > 0; }
  return {
    row: {
      type: 'tournament', date, name: name || 'Imported tournament', game: game || '',
      buyin: cost / entries, entries, cash: cashout + bounties,
      place, field, currency: (currency || 'USD').toUpperCase(),
      note: [note, folded ? `rebuys/add-ons folded into one ${cost} buy-in` : ''].filter(Boolean).join(' · '),
    },
  };
}

// ── Presets ──────────────────────────────────────────────────────────────────────────────
export const PRESETS = [
  {
    id: 'pbt',
    name: 'Poker Bankroll Tracker',
    evidence: 'pokerbankrolltracker.net/faq and the vendor sample PBT_Bankroll_CSV_example.csv',
    required: ['starttime', 'variant', 'buyin', 'cashout', 'currency'],
    /** Index of the header row, or -1. The sentinel line is optional (a hand-made file may lack it). */
    headerRow(rows) {
      const i = rows.length && /PBT Bankroll Export/i.test(String(rows[0][0] || '')) ? 1 : 0;
      const h = (rows[i] || []).map(norm);
      return this.required.every((c) => h.includes(c)) ? i : -1;
    },
    toRow(r) {
      const date = parseDate(r.starttime);
      const variant = norm(r.variant);
      if (variant === 'tournament') {
        return tournamentRow({
          date, name: r.mttname || [r.game, r.location].filter(Boolean).join(' · '),
          buyin: n0(r.buyin), rebuyCost: n0(r.rebuycosts), addonCost: n0(r.addoncosts), rebuys: int0(r.rebuys),
          cashout: n0(r.cashout), bounties: n0(r.bounties), place: intOrNull(r.place), field: intOrNull(r.player),
          game: [r.limit, r.game].filter(Boolean).join(' '), currency: r.currency,
          note: [r.location, r.sessionnote].filter(Boolean).join(' · '),
        });
      }
      if (variant === 'deposit/payout') {
        if (!date) return { error: 'No readable date' };
        const net = n0(r.cashout) - n0(r.buyin);
        if (!net) return { skip: 'Deposit/Payout of 0' };
        return { row: { type: net > 0 ? 'deposit' : 'withdrawal', date, amount: Math.abs(net), currency: (r.currency || 'USD').toUpperCase(), note: r.sessionnote || 'Poker Bankroll Tracker' } };
      }
      if (variant === 'cash game') {
        const fromStack = n0(r.expensesfromstack);
        const res = cashRow({
          start: r.starttime, end: r.endtime, minutes: parseNumber(r.playingminutes),
          room: r.location, game: gameLabel(r.game, r.limit), stakes: stakesFrom(r.smallblind, r.bigblind, r['3rdblind']),
          buyin: n0(r.buyin) + n0(r.rebuycosts), rebuys: int0(r.rebuys), cashout: n0(r.cashout) + fromStack,
          tips: fromStack, expenses: n0(r.expenses), currency: r.currency,
          note: [r.sessionnote, r.notes].filter(Boolean).join(' · '), tags: r.tags,
        });
        // PBT states its own net: say so when ours (cash out - buy-in - tips - expenses) would differ.
        const pbtNet = parseNumber(r.netprofit);
        if (res.row && Number.isFinite(pbtNet)) {
          const ours = res.row.cashout - res.row.buyin - res.row.tips - res.row.expenses;
          if (Math.abs(ours - pbtNet) > 1) res.warn = `PBT's net is ${pbtNet}, this reads ${Math.round(ours * 100) / 100}`;
        }
        return res;
      }
      return { skip: `${r.variant || 'Unknown'} row (only tournaments and deposits/payouts import)` };
    },
  },
  {
    id: 'pokerbase-custom',
    name: 'Pokerbase Custom Sheet',
    evidence: "Pokerbase's documented Custom Sheet (CSV) template",
    required: ['currency_code', 'type', 'start', 'buyin_amount', 'cashout'],
    headerRow(rows) {
      const h = (rows[0] || []).map(norm);
      return this.required.every((c) => h.includes(c)) ? 0 : -1;
    },
    toRow(r) {
      const type = norm(r.type);
      if (type === 'cashgame' || type === 'cash game') return { skip: 'Cash game session (cash sessions are not imported here)' };
      if (type !== 'tournament') return { skip: `type "${r.type}" (only tournament rows import)` };
      return tournamentRow({
        date: parseDate(r.start), name: r.tournament_name || r.location,
        buyin: n0(r.buyin_amount), rebuyCost: n0(r.total_rebuy_amount), addonCost: n0(r.total_addon_amount),
        rebuys: int0(r.number_of_rebuys), cashout: n0(r.cashout), bounties: n0(r.total_bounties_amount),
        place: intOrNull(r.tournament_position), field: intOrNull(r.total_tournament_entries),
        game: r.game, currency: r.currency_code, note: [r.location, r.note].filter(Boolean).join(' · '),
      });
    },
  },
];

/** The preset a parsed file matches, with its header row index, or null. */
export function detectPreset(rows) {
  for (const p of PRESETS) {
    const i = p.headerRow(rows);
    if (i >= 0) return { preset: p, headerRow: i };
  }
  return null;
}

/** Apply a preset: [{ line, row } | { line, skip } | { line, error }] (line = 1-based file line). */
export function applyPreset(rows, { preset, headerRow }) {
  const headers = rows[headerRow];
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const res = preset.toRow(recordOf(headers, rows[i]));
    out.push({ line: i + 1, ...res });
  }
  return out;
}

// ── Generic mapping ──────────────────────────────────────────────────────────────────────
export const FIELDS = [
  { key: 'date', label: 'Date', required: true, synonyms: ['date', 'start', 'starttime', 'start time', 'day', 'played', 'session date'] },
  { key: 'name', label: 'Event / description', synonyms: ['event', 'name', 'tournament', 'event name', 'tournament name', 'mttname', 'description', 'title'] },
  { key: 'buyin', label: 'Buy-in (per entry)', synonyms: ['buyin', 'buy-in', 'buy in', 'entry fee', 'cost'] },
  { key: 'entries', label: 'Entries (bullets)', synonyms: ['entries', 'bullets', 'num entries', 'rebuys'] },
  { key: 'cash', label: 'Cash (winnings)', synonyms: ['cash', 'cashout', 'cash out', 'winnings', 'won', 'prize', 'payout'] },
  { key: 'place', label: 'Finish place', synonyms: ['place', 'finish', 'position', 'finish place', 'rank'] },
  { key: 'field', label: 'Field size', synonyms: ['field', 'field size', 'entrants', 'players', 'total entries'] },
  { key: 'amount', label: 'Amount (+ in, − out)', synonyms: ['amount', 'net', 'value', 'deposit', 'profit'] },
  { key: 'currency', label: 'Currency', synonyms: ['currency', 'currency code', 'ccy'] },
  // Cash sessions (owner, 2026-11-01), and a type column for a file holding both kinds.
  { key: 'kind', label: 'Type (cash or tournament)', synonyms: ['type', 'session type', 'kind', 'category', 'format'] },
  { key: 'end', label: 'End (date and time)', synonyms: ['end', 'endtime', 'end time', 'end date', 'finished', 'stop'] },
  { key: 'hours', label: 'Hours played', synonyms: ['hours', 'duration', 'length', 'hours played', 'time played'] },
  { key: 'room', label: 'Room / location', synonyms: ['location', 'room', 'casino', 'venue', 'place played', 'site'] },
  { key: 'stakes', label: 'Stakes (1/2)', synonyms: ['stakes', 'stake', 'blinds', 'limit level', 'level'] },
  { key: 'tips', label: 'Tips / costs', synonyms: ['tips', 'tip', 'dealer tips', 'expenses', 'costs'] },
  { key: 'game', label: 'Game', synonyms: ['game', 'variant', 'game type'] },
  { key: 'note', label: 'Note', synonyms: ['note', 'notes', 'comment', 'comments', 'memo'] },
];
/** Which fields each kind of row reads. */
export const FIELDS_FOR = {
  tournament: ['date', 'name', 'buyin', 'entries', 'cash', 'place', 'field', 'room', 'currency', 'game', 'note'],
  cash: ['date', 'end', 'hours', 'room', 'game', 'stakes', 'buyin', 'cash', 'tips', 'currency', 'note'],
  adjustment: ['date', 'amount', 'currency', 'note', 'name'],
  mixed: ['kind', 'date', 'end', 'hours', 'name', 'room', 'game', 'stakes', 'buyin', 'entries', 'cash', 'tips', 'place', 'field', 'currency', 'note'],
};
/** A field's label where its meaning changes with the kind of row. */
export const FIELD_LABELS = {
  cash: { date: 'Start (date and time)', buyin: 'Buy-in (total)', cash: 'Cash out' },
  mixed: { date: 'Date / start', buyin: 'Buy-in', cash: 'Cash / cash out' },
};
/** A type column's value: 'cash' | 'tournament' | null (neither: skipped, with its value). */
export function kindOf(v) {
  const t = norm(v);
  if (/tourn|mtt|sng|sit ?(and|&|n) ?go|satellite|spin/.test(t)) return 'tournament';
  if (/cash|ring|live game|session/.test(t)) return 'cash';
  return null;
}

/** First header matching each field's synonyms: { field: columnIndex | -1 }. */
/**
 * The first values of a column, blanks skipped (Bankroll design 81): what a column picker will read from
 * the file, shown under the picker before Preview. `rows` is parseCsv's output, its first row the headers.
 */
export function columnSample(rows, col, n = 3) {
  if (!Array.isArray(rows) || col == null || col < 0) return [];
  const out = [];
  for (let i = 1; i < rows.length && out.length < n; i++) {
    const v = rows[i] && rows[i][col] != null ? String(rows[i][col]).trim() : '';
    if (v) out.push(v);
  }
  return out;
}

export function guessMapping(headers) {
  const h = headers.map(norm);
  const used = new Set();
  const out = {};
  for (const f of FIELDS) {
    let idx = -1;
    for (const syn of f.synonyms) { const i = h.findIndex((x, j) => x === syn && !used.has(j)); if (i >= 0) { idx = i; break; } }
    if (idx >= 0) used.add(idx);
    out[f.key] = idx;
  }
  return out;
}

/**
 * Rows through a column mapping. opts.rowsAre: 'tournament' (results: date, buy-in, cash…) or
 * 'adjustment' (one signed amount per row: + deposit, − withdrawal). opts.currency is the
 * default when no currency column is mapped. opts.dayFirst reads N/N/YYYY as day/month.
 */
/**
 * The order of a file's N/N/YYYY dates, from the file (App improvements 208): a first number over 12 can only
 * be a day, a second over 12 only a month. -> { order: 'day' | 'month' | null, line, value, conflict }: the
 * line that decided it, and conflict when the file has both. null: every date fits both (the select decides).
 */
export function detectDateOrder(rows, col, headerRow = 0) {
  if (!Array.isArray(rows) || col == null || col < 0) return { order: null, line: null, value: null, conflict: false };
  let day = null, month = null;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const v = String((rows[i] && rows[i][col]) == null ? '' : rows[i][col]).trim();
    const x = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})/.exec(v);
    if (!x) continue;
    if (Number(x[1]) > 12 && !day) day = { line: i + 1, value: v };
    if (Number(x[2]) > 12 && !month) month = { line: i + 1, value: v };
  }
  if (day && !month) return { order: 'day', line: day.line, value: day.value, conflict: false };
  if (month && !day) return { order: 'month', line: month.line, value: month.value, conflict: false };
  if (day && month) return { order: null, line: day.line, value: day.value, conflict: true };
  return { order: null, line: null, value: null, conflict: false };
}

export function applyMapping(rows, mapping, { rowsAre = 'tournament', currency = 'USD', dayFirst: askedDayFirst = false, headerRow = 0 } = {}) {
  const col = (row, key) => (mapping[key] >= 0 ? String(row[mapping[key]] == null ? '' : row[mapping[key]]).trim() : '');
  const out = [];
  // One order for the whole file: the file's own when it shows one, else the select's (208).
  const det = detectDateOrder(rows, mapping.date, headerRow);
  const dayFirst = det.order === 'day' ? true : det.order === 'month' ? false : askedDayFirst;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    let kind = rowsAre;
    if (rowsAre === 'mixed') {
      kind = kindOf(col(r, 'kind'));
      if (!kind) { out.push({ line, skip: `Type "${col(r, 'kind') || 'blank'}" (only cash and tournament rows import)` }); continue; }
    }
    const cur = (col(r, 'currency') || currency).toUpperCase();
    const note = col(r, 'note');
    if (kind === 'cash') {
      const tips = parseNumber(col(r, 'tips'));
      out.push({
        line,
        ...cashRow({
          start: col(r, 'date'), end: col(r, 'end'), hours: parseNumber(col(r, 'hours')),
          room: col(r, 'room'), game: gameLabel(col(r, 'game'), ''), stakes: col(r, 'stakes'),
          buyin: parseNumber(col(r, 'buyin')), cashout: parseNumber(col(r, 'cash')),
          tips: Number.isFinite(tips) ? tips : 0, currency: cur, note: [col(r, 'name'), note].filter(Boolean).join(' · '), dayFirst,
        }),
      });
      continue;
    }
    const date = parseDate(col(r, 'date'), { dayFirst, strict: true });
    if (!date) { out.push({ line, error: `Unreadable date "${col(r, 'date')}"${det.conflict ? ' (this file has dates in both orders)' : ''}` }); continue; }
    if (kind === 'adjustment') {
      const amt = parseNumber(col(r, 'amount'));
      if (!Number.isFinite(amt)) { out.push({ line, error: 'No amount' }); continue; }
      if (amt === 0) { out.push({ line, skip: 'Amount of 0' }); continue; }
      out.push({ line, row: { type: amt > 0 ? 'deposit' : 'withdrawal', date, amount: Math.abs(amt), currency: cur, note: note || col(r, 'name') } });
      continue;
    }
    const buyin = parseNumber(col(r, 'buyin'));
    if (!Number.isFinite(buyin) || buyin < 0) { out.push({ line, error: 'No buy-in' }); continue; }
    const cash = parseNumber(col(r, 'cash'));
    const entries = parseNumber(col(r, 'entries'));
    out.push({
      line,
      row: {
        type: 'tournament', date, name: col(r, 'name') || 'Imported tournament', game: col(r, 'game'),
        buyin, entries: Number.isFinite(entries) && entries >= 1 ? Math.round(entries) : 1,
        cash: Number.isFinite(cash) && cash > 0 ? cash : 0,
        place: intOrNull(col(r, 'place')), field: intOrNull(col(r, 'field')), currency: cur,
        note: [col(r, 'room'), note].filter(Boolean).join(' · '),
      },
    });
  }
  return out;
}
