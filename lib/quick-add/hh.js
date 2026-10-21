// Quick-add: a hand-history fast path (owner decision H, 2026-10-14).
//
// A pasted PokerStars / GGPoker / Full Tilt hand history, or a converter's compact
// "Stacks: … / Flop ($1.20) 7c 8d 2h: BB checks, Hero bets $0.60" layout, is exact. Reading it in
// code is free, cannot invent a card, and keeps screen names away from the API: every name is
// replaced by a seat label before anything is sent.
//
//   parseHandHistory(text) → null when the text is not a hand history, else
//     { format, game, anonymised, unread, build(resolved) }
//       format      'pokerstars' | 'gg' | 'fulltilt' | 'converter'
//       game        the replayer game the header names, or null (stud, draw, no header)
//       anonymised  the text with every player name replaced ("Player 3", "Hero"); this is what
//                   goes to the model when the code cannot finish the job
//       unread      [{ id, street, line }] action-looking lines the code could not read, with
//                   the names already replaced. The caller may have the model read them (line
//                   by line) and hand the answers to build(); without answers they are dropped
//       build(res)  → { draft, notes }: a record_hand tool input (the same shape the model
//                   returns) for normalizeDraft. res maps an unread id to an action
//                   ({ player, action, toAmount?, amount? }) or null to skip it.
//
// draft.players carry seatNumber and startingStack and no name; positions come from the button
// seat (normalize.js seatByNumbers). A raw history is read line by line: a line that is neither
// understood nor ignorable is "unread". A converter layout is all or nothing: one clause the
// grammar cannot read and the whole text goes to the model.
'use strict';

const { parseCards, cleanText } = require('./cards');
const G = require('./games');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const money = (s) => {
  // "650k" is 650,000 and "1.2m" 1,200,000: read without the suffix they recorded a wrong hand
  // with no question asked (shorthand eval, 2026-10-20).
  const str = String(s);
  const n = Number(str.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = /k\s*$/i.test(str) ? 1e3 : /m\s*$/i.test(str) ? 1e6 : 1;
  return Math.round(n * mult * 100) / 100;
};
const AMT = '[$€£]?\\s?([0-9][0-9,]*(?:\\.[0-9]+)?(?:\\s?[kKmM]\\b)?)';
const CURRENCY_OF = { $: 'USD', '€': 'EUR', '£': 'GBP' };

/* ── The game, from any header or prose in the text ─────────────────────────── */

function detectGame(text) {
  const t = String(text);
  const has = (re) => re.test(t);
  if (has(/\b(?:7|seven)[- ]?card stud|\bstud\b|\brazz\b|\bbadugi\b|triple draw|single draw|\b5[- ]?card draw\b|\bdraw\b.*\bpot\b/i)) return { game: null, unsupported: true };
  const hilo = has(/hi\/?lo|hi-lo|8\/b|eight or better|\bO8\b|\bPLO8\b|\bNLO8\b/i);
  const limitWord = has(/no[- ]?limit|\bNL[A-Z]?\b|\bNLHE\b/i) ? 'nl' : has(/pot[- ]?limit|\bPL[A-Z]?\b/i) ? 'pl' : has(/\blimit\b|\bFL\b/i) ? 'fl' : null;
  if (has(/short[- ]?deck|6\+ ?hold/i)) return { game: 'Short Deck' };
  if (has(/omaha|\bPLO\d?\b|\bNLO\d?\b|\bO8\b/i)) {
    const cards = has(/\b(?:6|six)[- ]?card omaha|\bPLO6\b|omaha ?6|big ?easy/i) ? 6 : has(/\b(?:5|five)[- ]?card omaha|\bPLO5\b|omaha ?5|big ?o\b/i) ? 5 : 4;
    if (cards === 6) return { game: hilo ? 'PLO6 8/b' : 'PLO6' };
    if (cards === 5) return { game: hilo ? 'Big O' : 'PLO5' };
    if (limitWord === 'fl') return { game: hilo ? 'O8' : 'LO Hi' };
    if (limitWord === 'nl') return { game: hilo ? 'NLO8' : null };
    return { game: hilo ? 'PLO8' : 'PLO' };
  }
  if (has(/hold'?em|\bNLHE?\b|\bLHE\b|\bPLH\b/i)) {
    if (limitWord === 'pl') return { game: 'PLH' };
    if (limitWord === 'fl') return { game: 'LHE' };
    if (limitWord === 'nl') return { game: 'NLH' };
    return { game: null };
  }
  return { game: null };
}

/* ── Format detection ──────────────────────────────────────────────────────── */

function detectFormat(lines) {
  const text = lines.join('\n');
  const seatLines = lines.filter((l) => /^\s*Seat \d+: .+ \(.+\)/.test(l)).length;
  const sections = /\*\*\* (?:HOLE CARDS|FLOP|SUMMARY|PRE-?FLOP) \*\*\*/i.test(text);
  if (/^\s*Full Tilt Poker Game #\d+/im.test(text)) return 'fulltilt';
  if (/^\s*PokerStars (?:Zoom |Home Games )?Hand #\d+/im.test(text) && seatLines >= 2) return 'pokerstars';
  if (seatLines >= 2 && /\bis the button\b/i.test(text) && /^\s*The button is in seat #\d+/im.test(text) && !sections) return 'fulltilt';
  if (/^\s*Poker Hand #[A-Z]{0,4}\d+/im.test(text) && seatLines >= 2) return 'gg';
  if (seatLines >= 2 && sections) return /Full Tilt/i.test(text) ? 'fulltilt' : 'pokerstars';
  if (seatLines >= 2 && /^\s*(?:The button is in seat #\d+|Seat #\d+ is the button)/im.test(text) && /\b(?:folds|calls|raises|bets|checks)\b/.test(text)) {
    return /^\s*The button is in seat/im.test(text) ? 'fulltilt' : 'pokerstars';
  }
  if (/^\s*Stacks?:/im.test(text) && /^\s*(?:Pre(?:flop)?|Pf|Flop|Turn|River)\b[^:\n]*:/im.test(text)) return 'converter';
  return null;
}

/* ── Anonymising ───────────────────────────────────────────────────────────── */

function anonymiser(names) {
  // names: [{ name, label }], longest first so "Bob" never eats "Bobby".
  const list = names.slice().sort((a, b) => b.name.length - a.name.length);
  return (s) => {
    let out = String(s);
    for (const { name, label } of list) {
      if (!name) continue;
      out = out.replace(new RegExp('(?<![A-Za-z0-9_])' + esc(name) + '(?![A-Za-z0-9_])', 'g'), label);
    }
    return out;
  };
}
const scrubTable = (s) => String(s).replace(/Table '[^']*'/g, "Table 'T'").replace(/Table [^\s(]+ \((\d+) max\)/g, 'Table T ($1 max)');

/* ── A raw history (PokerStars, GGPoker, Full Tilt) ────────────────────────── */

const IGNORABLE = [
  /^\s*$/,
  /^\s*\*\*\* (?:HOLE CARDS|SHOW ?DOWN|SUMMARY|SHOWDOWN|PRE-?FLOP|ANTE\/BLINDS) \*\*\*/i,
  /^\s*(?:Total pot|Board \[|Hand was run|Rake|Table '|Table |Uncalled bet|Seat \d+: .+ (?:folded|showed|mucked|collected|did not show|lost|won|\(|bet)|Main pot|Side pot)/i,
  /(?:^|\s)(?:said,|has timed out|is disconnected|is connected|was removed from the table|sits out|sitting out|will be allowed to play|has returned|joins the table|leaves the table|is sitting out|finished the tournament|wins the tournament|re-entered|received a|doesn't show|does not show|mucks hand|muck|shows? down)/i,
  /^\s*(?:Dealt to \S+ \[[^\]]*\]|Dealt to [^\[]+$)/,
  /^\s*\(?(?:Chat|Hand|PokerStars|Poker Hand|Full Tilt)[^\n]*\)?$/i,
];

/** Pulls the cards out of "[Ah Kd]" / "Ah Kd" text as a compact string ("AhKd"), or null. */
function cardsOf(s) {
  const body = String(s).replace(/[\[\],]/g, ' ').trim();
  const pc = parseCards(body.replace(/\s+/g, ''));
  return pc && pc.cards.length ? pc.cards.join('') : null;
}

function parseRaw(lines, format, text) {
  const info = detectGame(text);
  // Seats.
  const seats = []; // { seat, name, stack, sittingOut }
  const summaryAt = lines.findIndex((x) => /^\s*\*\*\* SUMMARY \*\*\*/.test(x));
  for (const l of summaryAt >= 0 ? lines.slice(0, summaryAt) : lines) {
    const m = /^\s*Seat (\d+): (.+?) \(([^)]*)\)(.*)$/.exec(l);
    if (!m) continue;
    const stackM = /([$€£]?\s?[0-9][0-9,]*(?:\.[0-9]+)?)/.exec(m[3]);
    if (!stackM) continue;
    if (seats.some((s) => s.seat === Number(m[1]))) continue;
    seats.push({ seat: Number(m[1]), name: m[2].trim(), stack: money(stackM[1]), sittingOut: /sitting out/i.test(m[4]) || /sitting out/i.test(m[3]), sym: (/([$€£])/.exec(m[3]) || [])[1] || null });
  }
  if (seats.length < 2) return null;
  const dealt = seats.filter((s) => !s.sittingOut);
  const btnM = /Seat #(\d+) is the button/i.exec(text) || /The button is in seat #(\d+)/i.exec(text);
  const buttonSeat = btnM ? Number(btnM[1]) : null;
  const names = dealt.map((s, i) => ({ name: s.name, label: 'Player ' + s.seat, idx: i, seat: s.seat }));
  const byName = new Map(names.map((n) => [n.name, n]));
  const nameRe = names.slice().sort((a, b) => b.name.length - a.name.length).map((n) => esc(n.name)).join('|');
  // Hero: the one dealt visible cards.
  let hero = null, heroCards = null;
  for (const l of lines) {
    const m = /^\s*Dealt to (.+?) \[([^\]]+)\]/.exec(l);
    if (m && byName.has(m[1].trim())) {
      const c = cardsOf(m[2]);
      if (c) { hero = byName.get(m[1].trim()); heroCards = c; break; }
    }
  }
  if (hero) hero.label = 'Hero';
  const anon = anonymiser(names);
  // Stakes, antes and posts.
  const blinds = {};
  let shortSb = false, shortBb = false;   // a blind posted "and is all-in" can be less than the blind
  const antes = [];
  const sym = (seats.find((s) => s.sym) || {}).sym || (/([$€£])/.exec(text) || [])[1] || null;
  const tournament = /Tournament #|\bLevel [IVXLC\d]+\b|\bMTT\b|\bSNG\b|Buy-?in/i.test(text);
  const streets = [{ name: 'Preflop', items: [], board: '' }];
  const cardsByPlayer = new Map(); // idx -> cards shown at showdown
  const collect = []; // { idx, pot, amount }
  const unread = [];
  let st = 0, afterSummary = false, inSecondRun = false, runTwice = false;
  const push = (item) => streets[st].items.push(item);
  const actorRe = nameRe ? new RegExp('^\\s*(' + nameRe + '):?\\s+(.*)$') : null;
  const header = lines.find((l) => /(?:Hand #|Game #)\d+/.test(l)) || '';
  const hdrBlinds = /\(([$€£]?[0-9.,]+)\s*\/\s*([$€£]?[0-9.,]+)(?:\s*[A-Z]{3})?\)/.exec(header) || /\$([0-9.]+)\/\$([0-9.]+)/.exec(header);
  lines.forEach((raw, li) => {
    const l = raw.replace(/\s+$/, '');
    if (afterSummary) return;
    let m;
    if (/^\s*\*\*\* SUMMARY \*\*\*/.test(l)) { afterSummary = true; return; }
    if (/^\s*\*\*\* (?:SECOND|2ND) /i.test(l)) { inSecondRun = true; runTwice = true; return; }
    if (inSecondRun) return;
    if (/^\s*\*\*\* FIRST /i.test(l)) runTwice = true;
    if ((m = /^\s*\*\*\* (?:FIRST |SECOND )?FLOP \*\*\*\s*\[([^\]]+)\]/i.exec(l))) { st = 1; streets[1] = streets[1] || { name: 'Flop', items: [], board: '' }; streets[1].board = cardsOf(m[1]) || ''; return; }
    if ((m = /^\s*\*\*\* (?:FIRST |SECOND )?TURN \*\*\*\s*\[[^\]]+\]\s*\[([^\]]+)\]/i.exec(l))) { st = 2; streets[2] = streets[2] || { name: 'Turn', items: [], board: '' }; streets[2].board = cardsOf(m[1]) || ''; return; }
    if ((m = /^\s*\*\*\* (?:FIRST |SECOND )?RIVER \*\*\*\s*\[[^\]]+\]\s*\[([^\]]+)\]/i.exec(l))) { st = 3; streets[3] = streets[3] || { name: 'River', items: [], board: '' }; streets[3].board = cardsOf(m[1]) || ''; return; }
    if (/^\s*\*\*\* /.test(l)) return;
    if (/^\s*Seat \d+: /.test(l) && !st) return;
    // Lines that are about no one in particular.
    if (/^\s*(?:Table |Total pot|Uncalled bet|Board \[|Rake|Main pot|Side pot|Hand was run|Dealt to )/i.test(l)) return;
    if (!actorRe) return;
    const am = actorRe.exec(l);
    if (!am) {
      // Not a line about a known player: header, prose around the history, chat.
      return;
    }
    const who = byName.get(am[1]);
    const rest = am[2].trim();
    const idx = who.idx;
    const allIn = /,?\s*and is all[- ]?in\b/i.test(rest);
    const r = rest.replace(/,?\s*and is all[- ]?in\b/i, '').trim();
    let x;
    if (/^folds\b/i.test(r)) return push({ kind: 'action', a: { player: idx, action: 'fold' } });
    if (/^checks\b/i.test(r)) return push({ kind: 'action', a: { player: idx, action: 'check' } });
    if ((x = new RegExp('^calls\\s+' + AMT + '\\b', 'i').exec(r))) return push({ kind: 'action', a: { player: idx, action: 'call', amount: money(x[1]) } });
    if ((x = new RegExp('^raises\\s+' + AMT + '\\s+to\\s+' + AMT, 'i').exec(r)) || (x = new RegExp('^raises\\s+to\\s+' + AMT, 'i').exec(r))) {
      const to = money(x[x.length - 1]);
      return push({ kind: 'action', a: { player: idx, action: allIn ? 'all-in' : 'raise', toAmount: to } });
    }
    if ((x = new RegExp('^bets\\s+' + AMT, 'i').exec(r))) return push({ kind: 'action', a: { player: idx, action: allIn ? 'all-in' : 'bet', toAmount: money(x[1]) } });
    if ((x = new RegExp('^posts\\s+(?:the\\s+)?small blind(?:\\s+of)?\\s+' + AMT, 'i').exec(r))) { blinds.sb = money(x[1]); shortSb = shortSb || allIn; return; }
    if ((x = new RegExp('^posts\\s+(?:the\\s+)?big blind(?:\\s+of)?\\s+' + AMT, 'i').exec(r))) { blinds.bb = money(x[1]); shortBb = shortBb || allIn; return; }
    if ((x = new RegExp('^posts\\s+(?:the\\s+)?ante(?:\\s+of)?\\s+' + AMT, 'i').exec(r)) || (x = new RegExp('^antes\\s+' + AMT, 'i').exec(r))) { antes.push({ idx, amount: money(x[1]) }); return; }
    if (/^posts\s+small\s*&\s*big blinds?\b/i.test(r) || /^posts\s+(?:a\s+)?dead\b/i.test(r)) return;
    if ((x = /^shows?\s+\[([^\]]+)\]/i.exec(r))) { const c = cardsOf(x[1]); if (c && !(hero && idx === hero.idx)) cardsByPlayer.set(idx, c); return; }
    if (/^(?:mucks|doesn't show|does not show|shows? down)\b/i.test(r)) return;
    if ((x = new RegExp('^collected\\s+' + AMT + '\\s+from\\s+((?:main |side )?pot(?:-?\\s?\\d+)?|second side pot)', 'i').exec(r))) {
      return void collect.push({ idx, pot: potName(x[2]), amount: money(x[1]) });
    }
    if ((x = new RegExp('^(?:wins|ties for) the ((?:main |side )?pot)\\s*\\(' + AMT, 'i').exec(r))) {
      return void collect.push({ idx, pot: potName(x[1]), amount: money(x[2]), tie: /^ties/i.test(r) });
    }
    if ((x = new RegExp('^collected\\s+' + AMT, 'i').exec(r))) return void collect.push({ idx, pot: 'main', amount: money(x[1]) });
    if (IGNORABLE.some((re) => re.test(l))) return;
    // Something about a known player that the code cannot read.
    const id = unread.length;
    unread.push({ id, street: st, line: anon(l.trim()) });
    push({ kind: 'unread', id });
  });
  // A big blind who is all-in for less than the blind (an ante, or just a short stack) posts what he has:
  // the stakes are the header's, not the post. Limit headers read big blind / big bet, not sb / bb, so
  // they keep the post.
  const limitHeader = /\bLimit\b/.test(header) && !/\b(?:Pot|No) Limit\b/.test(header);
  if (hdrBlinds && !limitHeader) {
    if (shortSb) blinds.sb = money(hdrBlinds[1]);
    if (shortBb) blinds.bb = money(hdrBlinds[2]);
  }
  if (!blinds.sb && !blinds.bb && hdrBlinds) { blinds.sb = money(hdrBlinds[1]); blinds.bb = money(hdrBlinds[2]); }
  const anonymised = anon(scrubTable(text));
  const cards = (idx) => (hero && idx === hero.idx ? heroCards : cardsByPlayer.get(idx) || null);
  const build = (res = new Map()) => {
    const notes = ['This was read from a pasted hand history without the model; player names were removed.'];
    const draftStreets = streets.map((s, si) => {
      const actions = [];
      for (const it of s.items) {
        if (it.kind === 'action') actions.push({ ...it.a });
        else {
          const r = res instanceof Map ? res.get(it.id) : res && res[it.id];
          if (r && Number.isInteger(r.player) && r.action) actions.push({ ...r });
        }
      }
      const entry = { name: s.name, actions };
      if (s.board) entry.board = s.board;
      if (si === 0) {
        const pc = [];
        dealt.forEach((_, idx) => { const c = cards(idx); if (c) pc.push({ player: idx, cards: c }); });
        if (pc.length) entry.cards = pc;
      }
      return entry;
    });
    // Antes: every player's, or one player's (a big blind ante).
    const out = {};
    if (blinds.sb != null) out.sb = blinds.sb;
    if (blinds.bb != null) out.bb = blinds.bb;
    if (antes.length) {
      const a = antes[0].amount;
      if (antes.length >= 2) { out.ante = a; out.anteType = 'per_player'; } else { out.ante = a; out.anteType = 'bb'; }
    } else out.ante = tournament ? null : 0;
    if (!tournament && out.ante == null) out.ante = 0;
    // Winners per pot.
    let result = null;
    if (collect.length) {
      const potNames = [];
      collect.forEach((c) => { if (!potNames.includes(c.pot)) potNames.push(c.pot); });
      potNames.sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''))));
      const pots = potNames.map((name) => {
        const ws = collect.filter((c) => c.pot === name);
        const players = [...new Set(ws.map((c) => c.idx))];
        return { name, winners: players.map((p) => ({ playerIdx: p, split: players.length > 1 })) };
      });
      result = { winners: pots[0].winners };
      if (pots.length > 1) result.pots = pots;
    }
    const draft = {
      gameType: info.game,
      gameMode: tournament ? 'mtt' : (sym ? 'cash' : null),
      currency: !tournament && sym ? CURRENCY_OF[sym] : null,
      tableSize: dealt.length,
      buttonSeat,
      blinds: out,
      players: dealt.map((s, idx) => ({ seatNumber: s.seat, startingStack: s.stack, isHero: !!(hero && idx === hero.idx) })),
      streets: draftStreets,
      ...(result ? { result } : {}),
      ...(runTwice ? { format: { runouts: 2 } } : {}),
      notes: [],
    };
    return { draft, notes };
  };
  const heroIndex = hero ? hero.idx : null;
  const playerIndexBySeat = (seat) => { const n = names.find((x) => x.seat === seat); return n ? n.idx : null; };
  return { format, game: info.game, unsupported: !!info.unsupported, anonymised, unread, build, players: dealt.length, heroIndex, playerIndexBySeat };
}
function potName(s) {
  const t = String(s).toLowerCase();
  if (/main/.test(t) || t === 'pot') return 'main';
  const n = /(\d+)/.exec(t);
  if (/second side/.test(t)) return 'side 2';
  return 'side ' + (n ? n[1] : 1);
}

/* ── A converter's compact layout ──────────────────────────────────────────── */

const POS_WORD = '(?:UTG\\+?\\d?|UTG1|MP\\d?|LJ|HJ|CO|BTN|BU|BN|SB|BB|Hero|Villain|V\\d)';

function parseConverter(lines, text) {
  const info = detectGame(text);
  const stackLine = lines.find((l) => /^\s*Stacks?:/i.test(l));
  if (!stackLine) return null;
  const players = []; // { label, position, stack, isHero }
  const items = stackLine.replace(/^\s*Stacks?:\s*/i, '').split(/\s*[\/;]\s*|,\s*(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
  for (const it of items) {
    const m = new RegExp('^(?:(' + POS_WORD + ')\\s+)?(?:(Hero)\\s+)?(?:in\\s+)?(' + POS_WORD + ')?\\s*\\(?\\s*' + AMT + '[^)]*\\)?\\s*$', 'i').exec(it);
    if (!m) return null;
    const words = [m[1], m[2], m[3]].filter(Boolean);
    const hero = words.some((w) => /^hero$/i.test(w));
    const posWord = words.find((w) => !/^hero$/i.test(w) && !/^v\d?$|^villain$/i.test(w));
    const position = posWord ? G.canonicalPosition(posWord) : null;
    if (!position && !hero) return null;
    players.push({ label: position || 'Hero', position, stack: money(m[4]), isHero: hero });
  }
  if (players.length < 2 || players.filter((p) => p.isHero).length > 1) return null;
  const find = (word) => {
    const w = String(word).replace(/^the\s+/i, '').trim();
    if (/^(?:hero|i|me|we)$/i.test(w)) return players.findIndex((p) => p.isHero);
    const pos = G.canonicalPosition(w);
    return pos ? players.findIndex((p) => p.position === pos) : -1;
  };
  const streetNames = { pre: 0, preflop: 0, pf: 0, flop: 1, turn: 2, river: 3 };
  const streets = [];
  let heroCards = null;
  for (const l of lines) {
    const m = /^\s*(Pre(?:flop)?|Pf|Flop|Turn|River)\b([^:]*):\s*(.*)$/i.exec(l);
    if (!m) continue;
    const si = streetNames[m[1].toLowerCase()];
    if (streets[si]) return null;
    const meta = m[2];
    const potM = /\(\s*[$€£]?\s?([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(meta);
    const boardM = /((?:[2-9TJQKA10][♠♥♦♣shdc❤️]\s*){1,5})/.exec(meta.replace(/\([^)]*\)/g, ' '));
    const board = boardM ? cardsOf(boardM[1].trim().split(/\s+/).join(' ')) : '';
    let body = m[3].trim().replace(/\.\s*$/, '');
    // "Hero UTG with A♦ A♣ makes it $0.08" / "Hero gets Jc Js in MP."
    const withM = new RegExp('\\bHero\\b\\s*(?:' + POS_WORD + '\\s+)?with\\s+((?:[2-9TJQKA10][♠♥♦♣shdc❤️]\\s*){2,6})', 'i').exec(body);
    if (withM) {
      heroCards = cardsOf(withM[1].trim().split(/\s+/).join(' '));
      body = body.replace(withM[0], 'Hero').replace(/^Hero\s*[.,]\s*/, '');
    }
    const getsM = /\bHero gets\s+((?:[2-9TJQKA10][♠♥♦♣shdc❤️]\s*){2,6})(?:\s+in\s+\w+)?\s*[.,]?/i.exec(body);
    if (getsM) { heroCards = cardsOf(getsM[1].trim().split(/\s+/).join(' ')); body = body.replace(getsM[0], '').replace(/^[\s.,]+/, ''); }
    const clauses = body.split(/\s*,\s*|\s*\.\s+/).map((c) => c.trim()).filter(Boolean);
    const actions = [];
    for (const cl of clauses) {
      const got = clause(cl, find, players);
      if (!got) return null;
      actions.push(...got);
    }
    streets[si] = { name: ['Preflop', 'Flop', 'Turn', 'River'][si], board: board || undefined, ...(potM && si > 0 ? { potBefore: money(potM[1]) } : {}), actions };
  }
  if (!streets.some(Boolean)) return null;
  const draftStreets = streets.map((s, i) => s || { name: ['Preflop', 'Flop', 'Turn', 'River'][i], actions: [] }).slice(0, streets.length);
  const heroIdx = players.findIndex((p) => p.isHero);
  if (heroCards && heroIdx >= 0) draftStreets[0].cards = [{ player: heroIdx, cards: heroCards }];
  const headerBlinds = /(?:\$|€|£)\s?([0-9.]+)\s*\/\s*(?:\$|€|£)?\s?([0-9.]+)/.exec(text);
  const sym = (/([$€£])/.exec(stackLine) || [])[1] || null;
  const draft = {
    gameType: info.game,
    gameMode: sym ? 'cash' : null,
    currency: sym ? CURRENCY_OF[sym] : null,
    tableSize: players.length,
    blinds: headerBlinds ? { sb: money(headerBlinds[1]), bb: money(headerBlinds[2]), ante: 0 } : {},
    players: players.map((p) => ({ position: p.position || null, startingStack: p.stack, isHero: p.isHero })),
    streets: draftStreets,
    notes: [],
  };
  return { format: 'converter', game: info.game, unsupported: !!info.unsupported, anonymised: text, unread: [], build: () => ({ draft, notes: ['This was read from a converter\'s layout without the model.'] }), players: players.length };
}

function clause(cl, find, players) {
  let c = cl.replace(/\s+/g, ' ').trim();
  let m;
  const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  if ((m = /^(\d+|one|two|three|four|five|six|seven|eight|nine)\s+folds?$/i.exec(c))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDNUM[m[1].toLowerCase()];
    return [{ player: null, action: 'fold', group: 'rest', count: n }];
  }
  if (/^(?:everyone|all|the rest|others) folds?$/i.test(c)) return [{ player: null, action: 'fold', group: 'rest' }];
  // Actors then a verb: "BTN SB BB fold", "the BB calls", "Hero checks".
  m = new RegExp('^((?:(?:the\\s+)?' + POS_WORD + '\\s*)+?)\\s+(fold|folds|check|checks|call|calls|bet|bets|raise|raises|shove|shoves|jams?|makes it|3-?bets?|4-?bets?|5-?bets?|(?:goes )?all[- ]?in)(?:\\s+(.*))?$', 'i').exec(c);
  if (!m) return null;
  const actors = m[1].trim().split(/\s+/).filter((w) => !/^the$/i.test(w));
  const idxs = actors.map((a) => find(a));
  if (idxs.some((i) => i < 0)) return null;
  const verb = m[2].toLowerCase().replace(/\s+/g, ' ');
  let tail = (m[3] || '').trim();
  const allIn = /\ball[- ]?in\b/i.test(tail) || /all[- ]?in/.test(verb);
  tail = tail.replace(/\ball[- ]?in\b/ig, '').replace(/\bhis last\b|\bthe\b/ig, ' ').trim();
  const amtM = new RegExp('(?:to\\s+)?' + AMT).exec(tail);
  const amount = amtM ? money(amtM[1]) : null;
  if (/^fold/.test(verb)) return idxs.map((p) => ({ player: p, action: 'fold' }));
  if (/^check/.test(verb)) return idxs.map((p) => ({ player: p, action: 'check' }));
  if (idxs.length !== 1) return null;
  const p = idxs[0];
  if (/^call/.test(verb)) return [{ player: p, action: 'call', ...(amount != null && /last/.test(cl) ? { amount } : {}) }];
  if (/^(?:shove|jam)|all/.test(verb)) return [{ player: p, action: 'all-in', ...(amount != null ? { toAmount: amount } : {}) }];
  if (/^bet/.test(verb)) return amount != null ? [{ player: p, action: allIn ? 'all-in' : 'bet', toAmount: amount }] : null;
  if (/^raise|^makes it|bet\??s?$|^[345]-?bet/.test(verb)) return amount != null ? [{ player: p, action: allIn ? 'all-in' : 'raise', toAmount: amount }] : null;
  return null;
}

/* ── Entry point ───────────────────────────────────────────────────────────── */

function parseHandHistory(text) {
  if (typeof text !== 'string' || text.length < 40) return null;
  const lines = text.split(/\r?\n/);
  const format = detectFormat(lines);
  if (!format) return null;
  if (format === 'converter') return parseConverter(lines, text);
  return parseRaw(lines, format, text);
}

module.exports = { parseHandHistory, detectGame, detectFormat, anonymiser };
