// Quick add, learning from real use (2026-11-21). Every parse the server runs is logged with the hand it
// returned, and when the player saves that hand the saved version is logged beside it: the difference is
// the parser's error, measured on what players really type and say rather than on the corpus.
//
//   quick_add_parses   one row per POST /api/quick-add/parse: the text, the model and effort, the cost, the
//                      parsed hand (or the error), and, once saved, the final hand and a fact-level diff.
//
// The link: the parse response's hand carries the row's id as a top-level quickAddParseId, an unknown key
// that normalizeHand (answers), QuickAddView's toReplayable and the replayer all keep, and the save routes
// (POST / PUT /api/replayer/hands) call onHandSaved, which pairs the row with the hand only when the row is
// the saver's own. A later edit of the saved hand updates the pair: it is the hand as last saved.
//
// The raw text stays in the database. App admins see it (Admin › Quick add log) and can download the
// saved hands as corpus cases; the repo is public, so a case is paraphrased before it is committed
// (test/quick-add/README.md). The log is cleared with the account (lib/feature-mounts.js USER_TABLES) and
// keeps the newest KEEP rows.
'use strict';

const { GAMES } = require('./games');

const KEEP = 5000;
const MAX_JSON = 200 * 1024;

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS quick_add_parses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT,
    text TEXT,
    hints TEXT,
    model TEXT,
    served_by TEXT,
    mode TEXT,
    effort TEXT,
    fast_path TEXT,
    ms INTEGER,
    usage TEXT,
    cost_usd REAL,
    status INTEGER,
    error TEXT,
    parsed_hand TEXT,
    notes TEXT,
    saved_hand_id INTEGER,
    saved_at TEXT,
    final_hand TEXT,
    diff TEXT
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_quick_add_parses_user ON quick_add_parses(user_id)');
}

const json = (v) => {
  if (v == null) return null;
  const s = JSON.stringify(v);
  return s.length > MAX_JSON ? null : s;
};
const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** Logs one parse (or a failed one); returns its id, or null. Never throws. */
function recordParse(db, e) {
  try {
    const m = e.meta || {};
    db.run(`INSERT INTO quick_add_parses (user_id, source, text, hints, model, served_by, mode, effort, fast_path, ms, usage, cost_usd, status, error, parsed_hand, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      Number(e.userId) || 0, e.source || null, String(e.text || '').slice(0, 8000), json(e.hints && Object.keys(e.hints).length ? e.hints : null),
      m.model || e.model || null, m.servedBy || null, m.mode || null, m.effort || null, e.fastPath || null,
      Number.isFinite(e.ms) ? Math.round(e.ms) : null, json(e.usage || null), Number.isFinite(m.costUsd) ? m.costUsd : null,
      e.status || 200, e.error ? String(e.error).slice(0, 500) : null, json(e.hand || null), json(e.notes && e.notes.length ? e.notes : null),
    ]);
    const st = db.prepare('SELECT last_insert_rowid() AS id');
    st.step();
    const { id } = st.getAsObject();
    st.free();
    db.run(`DELETE FROM quick_add_parses WHERE id <= (SELECT id FROM quick_add_parses ORDER BY id DESC LIMIT 1 OFFSET ${KEEP})`);
    return Number(id) || null;
  } catch {
    return null;
  }
}

/** A saved hand that came from a parse: store it beside the parse. The caller saves the database. */
function onHandSaved(db, userId, hand, savedId) {
  try {
    const pid = Number(hand && hand.quickAddParseId);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    const st = db.prepare('SELECT parsed_hand FROM quick_add_parses WHERE id = ? AND user_id = ?');
    st.bind([pid, Number(userId) || 0]);
    const found = st.step() ? st.getAsObject() : null;
    st.free();
    if (!found) return false;
    const diff = handDiff(parseJson(found.parsed_hand), hand);
    db.run(`UPDATE quick_add_parses SET saved_hand_id = ?, saved_at = datetime('now'), final_hand = ?, diff = ? WHERE id = ? AND user_id = ?`,
      [Number(savedId) || null, json(hand), json(diff), pid, Number(userId) || 0]);
    return true;
  } catch {
    return false;
  }
}

/* ── What the player changed ─────────────────────────────────────────────────────────────────────── */

/* The facts of a hand, flat, by name: what the diff compares. Street facts are named by the street
   ("Flop board"); a player's by seat index (the replayer's order, first to act first). */
function handFacts(h) {
  const f = {};
  if (!h || typeof h !== 'object') return f;
  f.game = h.gameType || null;
  f.mode = h.gameMode || null;
  if (h.currency) f.currency = h.currency;
  const b = h.blinds || {};
  for (const k of ['sb', 'bb', 'ante', 'anteType', 'bigBet', 'bringIn', 'straddleAmount']) if (b[k] != null && b[k] !== '') f['blinds ' + k] = b[k];
  const straddles = Object.keys(b).filter((k) => k.startsWith('straddle_') && b[k]).map((k) => k.slice(9)).sort();
  if (straddles.length) f.straddles = straddles.join(', ');
  const players = Array.isArray(h.players) ? h.players : [];
  f.players = players.length;
  if (Number.isInteger(h.heroIdx) && !h.heroless) f.hero = (players[h.heroIdx] && players[h.heroIdx].position) || 'seat ' + (h.heroIdx + 1);
  if (h.heroless) f.hero = 'none (observer)';
  players.forEach((p, i) => {
    if (p && p.position) f[`seat ${i + 1} position`] = p.position;
    if (p && Number.isFinite(p.startingStack)) f[`seat ${i + 1} stack`] = p.startingStack;
  });
  (Array.isArray(h.streets) ? h.streets : []).forEach((s, si) => {
    if (!s) return;
    const name = s.name || 'street ' + (si + 1);
    const c = s.cards || {};
    if (c.hero) f[`${name} hero cards`] = c.hero;
    if (c.board) f[`${name} board`] = c.board;
    (Array.isArray(c.opponents) ? c.opponents : []).forEach((o, k) => { if (o) f[`${name} opponent ${k + 1} cards`] = o; });
    const acts = (Array.isArray(s.actions) ? s.actions : []).map((a) => `${Number.isInteger(a && a.player) ? 'seat ' + (a.player + 1) : '?'} ${a && a.action}${a && a.amount != null ? ' ' + a.amount : ''}`);
    if (acts.length) f[`${name} actions`] = acts.join(', ');
    const draws = (Array.isArray(s.draws) ? s.draws : []).map((d) => `seat ${(d && d.player) + 1} ${d && d.discarded}`);
    if (draws.length) f[`${name} draws`] = draws.join(', ');
  });
  const r = h.result;
  if (r && Array.isArray(r.winners) && r.winners.length) f.winners = r.winners.map((w) => 'seat ' + (w.playerIdx + 1) + (w.split ? ' (split)' : '')).join(', ');
  return f;
}

/** [{ fact, parsed, saved, kind: 'changed'|'filled'|'dropped' }]: where the saved hand differs from the parse. */
function handDiff(parsed, saved) {
  const a = handFacts(parsed), b = handFacts(saved);
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] == null ? null : a[k], y = b[k] == null ? null : b[k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    out.push({ fact: k, parsed: x, saved: y, kind: x == null ? 'filled' : y == null ? 'dropped' : 'changed' });
  }
  return out.slice(0, 60);
}

/* ── Reading the log (Admin) ──────────────────────────────────────────────────────────────────────── */

function rows(db, sql, params = []) {
  const r = db.exec(sql, params);
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
}

/** The newest parses, newest first, with the diff's counts; `full` adds the text, the hands and the diff. */
function listParses(db, { limit = 50, before = null, savedOnly = false, full = false } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const where = [];
  const params = [];
  if (Number.isInteger(Number(before)) && Number(before) > 0) { where.push('p.id < ?'); params.push(Number(before)); }
  if (savedOnly) where.push('p.final_hand IS NOT NULL');
  const list = rows(db, `SELECT p.*, u.username FROM quick_add_parses p LEFT JOIN users u ON u.id = p.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT ${lim}`, params);
  return list.map((r) => {
    const diff = parseJson(r.diff) || [];
    const count = (k) => diff.filter((d) => d.kind === k).length;
    const usage = parseJson(r.usage);
    const out = {
      id: r.id, at: r.created_at, user: r.username || null, source: r.source, chars: (r.text || '').length,
      preview: String(r.text || '').replace(/\s+/g, ' ').slice(0, 140),
      model: r.model, servedBy: r.served_by, mode: r.mode, effort: r.effort, fastPath: r.fast_path,
      ms: r.ms, costUsd: r.cost_usd, outputTokens: usage ? usage.output_tokens || 0 : null,
      status: r.status, error: r.error,
      saved: !!r.final_hand, savedAt: r.saved_at,
      changed: count('changed'), filled: count('filled'), dropped: count('dropped'),
    };
    if (full) Object.assign(out, { text: r.text, notes: parseJson(r.notes) || [], parsedHand: parseJson(r.parsed_hand), finalHand: parseJson(r.final_hand), diff });
    return out;
  });
}

/** Totals for the Admin header: parses, saved, failed, the share saved unchanged, cost. */
function summary(db) {
  const [s] = rows(db, `SELECT COUNT(*) AS parses, SUM(final_hand IS NOT NULL) AS saved, SUM(status <> 200) AS failed,
    SUM(final_hand IS NOT NULL AND (diff IS NULL OR diff = '[]')) AS unchanged, SUM(cost_usd) AS cost FROM quick_add_parses`);
  return { parses: s.parses || 0, saved: s.saved || 0, failed: s.failed || 0, savedUnchanged: s.unchanged || 0, costUsd: s.cost || 0 };
}

/* ── The saved hands as corpus cases ──────────────────────────────────────────────────────────────── */

const CORPUS_STREET_KEYS = {
  community: ['preflop', 'flop', 'turn', 'river'],
  draw_triple: ['predraw', 'draw1', 'draw2', 'draw3'],
  draw_single: ['predraw', 'draw'],
  stud: ['3rd', '4th', '5th', '6th', '7th'],
};
const BACK_SEATS = ['BB', 'SB', 'BTN', 'CO', 'HJ', 'LJ'];
/* The name a player uses for seat index i at an n-handed table (the corpus's refs): the last six count
   back from the big blind, the first seats are UTG, UTG+1, UTG+2, then MP2 at ten-handed. The inverse of
   test/quick-add/eval.js semanticIndex. */
function seatName(i, n) {
  if (!Number.isInteger(i) || !Number.isInteger(n) || i < 0 || i >= n) return null;
  if (n === 2) return i === 0 ? 'BTN/SB' : 'BB';
  const back = n - i;
  if (back <= BACK_SEATS.length) return BACK_SEATS[back - 1];
  return ['UTG', 'UTG+1', 'UTG+2', 'MP2'][i] || null;
}
const cardsOf = (s) => String(s || '').replace(/\s+/g, '');
const firstCard = (s) => { const m = /^([2-9TJQKA][hdcsx])/i.exec(cardsOf(s)); return m ? m[1][0].toUpperCase() + m[1][1].toLowerCase() : null; };

/**
 * A logged parse whose hand was saved → a draft corpus case (test/quick-add/README.md format), its expect
 * built from the SAVED hand. Returns { case, problems }: what could not be carried over.
 */
function caseFromLog(row) {
  const h = row.finalHand;
  const problems = [];
  if (!h || typeof h !== 'object') return { case: null, problems: ['no saved hand'] };
  const game = h.gameType;
  const info = GAMES[game];
  if (!info) return { case: null, problems: [`game ${game || '(none)'} is not one quick add knows`] };
  const cat = info.category;
  const keys = CORPUS_STREET_KEYS[cat];
  const players = Array.isArray(h.players) ? h.players : [];
  const n = players.length;
  const heroIdx = Number.isInteger(h.heroIdx) && !h.heroless ? h.heroIdx : null;
  const slotHero = heroIdx == null ? 0 : heroIdx;
  const slotOf = (i) => (i < slotHero ? i : i - 1);
  const streets = Array.isArray(h.streets) ? h.streets : [];
  const oppCards = (si, i) => {
    const c = (streets[si] && streets[si].cards) || {};
    if (heroIdx == null && i === 0) return cardsOf(c.hero);
    return cardsOf((Array.isArray(c.opponents) ? c.opponents : [])[slotOf(i)]);
  };
  // Refs: positions in flop and draw games, "hero" and "@<door>" in stud.
  const ref = (i) => {
    if (!Number.isInteger(i) || i < 0 || i >= n) return null;
    if (cat === 'stud') {
      if (i === heroIdx) return 'hero';
      const door = firstCard(oppCards(0, i));
      return door ? '@' + door : null;
    }
    return seatName(i, n);
  };
  const ex = {};
  ex.gameType = game;
  if (h.gameMode === 'cash' || h.gameMode === 'mtt') ex.gameMode = h.gameMode;
  if (h.currency && ex.gameMode === 'cash') ex.currency = h.currency;
  const b = h.blinds || {};
  const blinds = {};
  for (const k of ['sb', 'bb', 'ante', 'bigBet', 'bringIn']) if (Number.isFinite(b[k]) && b[k] >= 0) blinds[k] = b[k];
  const straddles = ['utg', 'button', 'mississippi', 'rock'].filter((t) => b['straddle_' + t]);
  if (straddles.length) blinds.straddle = straddles;
  if (b.straddleAmount) problems.push(`a ${b.straddleAmount} straddle: the corpus has no straddle size`);
  if (Object.keys(blinds).length) ex.blinds = blinds;
  if (n >= 2 && n <= 10) ex.players = n;
  if (h.heroless) ex.observer = true;
  else if (heroIdx != null) {
    if (cat !== 'stud') ex.heroPosition = seatName(heroIdx, n);
    const hc = cardsOf(streets[0] && streets[0].cards && streets[0].cards.hero);
    if (hc) ex.heroCards = hc;
    if (cat === 'stud') {
      const later = {};
      keys.slice(1).forEach((k, j) => { const c = cardsOf(streets[j + 1] && streets[j + 1].cards && streets[j + 1].cards.hero); if (c) later[k] = c; });
      if (Object.keys(later).length) ex.heroStreetCards = later;
    }
  }
  // One stack for the whole table is written once (stacksAll), as a player says it ("everyone 20k"); it
  // also covers stud seats that have no door card to name them by.
  const stackList = players.map((p) => (p && Number.isFinite(p.startingStack) && p.startingStack > 0 ? p.startingStack : null));
  if (n >= 2 && stackList.every((s) => s != null && s === stackList[0])) ex.stacksAll = stackList[0];
  else {
    const stacks = {};
    let unnamedStacks = 0;
    stackList.forEach((s, i) => { if (s == null) return; const r = ref(i); if (r) stacks[r] = s; else unnamedStacks++; });
    if (Object.keys(stacks).length) ex.stacks = stacks;
    if (unnamedStacks) problems.push(`${unnamedStacks} stack(s) of players who could not be named`);
  }
  if (cat === 'community') {
    const board = {};
    ['flop', 'turn', 'river'].forEach((k, j) => { const c = cardsOf(streets[j + 1] && streets[j + 1].cards && streets[j + 1].cards.board); if (c) board[k] = c; });
    if (Object.keys(board).length) ex.board = board;
  }
  const actions = {}, draws = {};
  let unnamed = 0;
  keys.forEach((k, si) => {
    const st = streets[si];
    if (!st) return;
    const list = [];
    for (const a of Array.isArray(st.actions) ? st.actions : []) {
      const r = ref(a && a.player);
      if (!r) { unnamed++; continue; }
      list.push(['call', 'bet', 'raise', 'all-in', 'bring-in'].includes(a.action) ? [r, a.action, Number.isFinite(a.amount) ? a.amount : null] : [r, a.action]);
    }
    if (list.length) actions[k] = list;
    const dl = [];
    for (const d of Array.isArray(st.draws) ? st.draws : []) {
      const r = ref(d && d.player);
      if (!r || !Number.isInteger(d.discarded)) continue;
      const e = [r, d.discarded];
      if (d.discardedCards || d.newCards) e.push(cardsOf(d.discardedCards) || '', cardsOf(d.newCards) || '');
      dl.push(e);
    }
    if (dl.length) draws[k] = dl;
  });
  if (unnamed) problems.push(`${unnamed} action(s) by a player who could not be named`);
  if (Object.keys(actions).length) ex.actions = actions;
  if (Object.keys(draws).length) ex.draws = draws;
  const showdown = {}, studUp = {};
  players.forEach((p, i) => {
    if (i === heroIdx) return;
    const r = ref(i);
    if (!r) return;
    if (cat === 'stud') {
      const ups = [0, 1, 2, 3].map((si) => oppCards(si, i)).join('');
      if (ups.length > 2) studUp[r] = ups;
      const rest = oppCards(4, i);
      if (rest) showdown[r] = ups + rest;
    } else {
      const c = oppCards(0, i);
      if (c) showdown[r] = c;
    }
  });
  if (Object.keys(studUp).length) ex.studUp = studUp;
  if (Object.keys(showdown).length) ex.showdown = showdown;
  const res = h.result;
  const winnersOf = (ws) => {
    const list = (Array.isArray(ws) ? ws : []).map((w) => ref(w && w.playerIdx)).filter(Boolean);
    return (Array.isArray(ws) && ws.some((w) => w && w.split)) ? { refs: list, split: true } : list;
  };
  if (res && Array.isArray(res.winners) && res.winners.length) ex.winners = winnersOf(res.winners);
  if (res && Array.isArray(res.pots) && res.pots.length) ex.pots = res.pots.map((p) => ({ name: p.name || 'pot', winners: winnersOf(p.winners) }));

  const diff = Array.isArray(row.diff) ? row.diff : [];
  const said = diff.length
    ? 'The parse differed from the saved hand on ' + diff.length + ' fact(s): ' + diff.slice(0, 12).map((d) => `${d.fact} ${d.kind}${d.parsed != null ? ' (parsed ' + JSON.stringify(d.parsed) + ')' : ''}`).join('; ') + '.'
    : 'The player saved the parse unchanged.';
  const c = {
    id: 'live-' + row.id,
    source: row.source === 'speech' ? 'speech' : 'text',
    game,
    tags: ['live', 'needs-review'],
    text: String(row.text || ''),
    expect: ex,
    notes: `From the quick-add log (parse ${row.id}, ${row.at || ''}, ${row.model || ''}${row.effort ? ' at ' + row.effort : ''}). RAW TEXT: paraphrase it before it goes in the public corpus (README). The expect is the hand as saved, answers to questions included: strike any fact the text does not state. ${said}${problems.length ? ' Not carried over: ' + problems.join('; ') + '.' : ''}`,
  };
  return { case: c, problems };
}

/** The saved hands in the log as draft corpus cases, newest first. */
function exportCases(db, { limit = 200 } = {}) {
  const list = listParses(db, { limit, savedOnly: true, full: true });
  const cases = [], skipped = [];
  for (const r of list) {
    const { case: c, problems } = caseFromLog(r);
    if (c) cases.push(c); else skipped.push({ id: r.id, why: problems.join('; ') });
  }
  return { cases, skipped };
}

module.exports = {
  migrate, recordParse, onHandSaved, handFacts, handDiff, listParses, summary, caseFromLog, exportCases, seatName, KEEP,
};
