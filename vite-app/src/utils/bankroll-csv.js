// ── CSV import for the bankroll ledger (beta, app admins) ──────────────────────────────────
// Pure and dependency-free (runs under `node --test`). Parses a file, recognises the formats we
// can SHOW are documented, maps columns, and produces the normalised rows POST
// /api/bankrolls/import takes (lib/bankroll-import.js):
//   { type: 'tournament', date, name, buyin (per entry), entries, cash, place, field, game, currency, note }
//   { type: 'deposit' | 'withdrawal', date, amount (> 0), currency, note }
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
//   - cash-game rows are SKIPPED with a reason (cash sessions belong to the cash-sessions ledger
//     source), as are PBT's Costs / Casino Games / Jackpot rows.
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
export function parseDate(raw, { dayFirst = false } = {}) {
  const s = String(raw || '').trim();
  let y, m, d, x;
  if ((x = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s))) [y, m, d] = [x[1], x[2], x[3]].map(Number);
  else if ((x = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s.*)?$/.exec(s))) [d, m, y] = [x[1], x[2], x[3]].map(Number);
  else if ((x = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})(?:\s.*)?$/.exec(s))) {
    let a = Number(x[1]), b = Number(x[2]);
    y = Number(x[3]); if (y < 100) y += 2000;
    if (dayFirst || a > 12) [d, m] = [a, b]; else [m, d] = [a, b];
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
      if (variant === 'cash game') return { skip: 'Cash game session (cash sessions are not imported here)' };
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
  { key: 'game', label: 'Game', synonyms: ['game', 'variant', 'game type'] },
  { key: 'note', label: 'Note', synonyms: ['note', 'notes', 'comment', 'comments', 'memo', 'location', 'venue'] },
];

/** First header matching each field's synonyms: { field: columnIndex | -1 }. */
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
export function applyMapping(rows, mapping, { rowsAre = 'tournament', currency = 'USD', dayFirst = false, headerRow = 0 } = {}) {
  const col = (row, key) => (mapping[key] >= 0 ? String(row[mapping[key]] == null ? '' : row[mapping[key]]).trim() : '');
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const date = parseDate(col(r, 'date'), { dayFirst });
    if (!date) { out.push({ line, error: `Unreadable date "${col(r, 'date')}"` }); continue; }
    const cur = (col(r, 'currency') || currency).toUpperCase();
    const note = col(r, 'note');
    if (rowsAre === 'adjustment') {
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
        place: intOrNull(col(r, 'place')), field: intOrNull(col(r, 'field')), currency: cur, note,
      },
    });
  }
  return out;
}
